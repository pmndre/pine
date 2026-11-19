import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { test } from "node:test";
import { element, notifications, security, timing as camTiming } from "./onvif.ts";
import { harness, mockMsg, sleep, until } from "../../testing/harness.ts";

const owner = { trust: "owner" as const };

const call = (name: string, args: any) => ({ name, args });

const eventsOf = (h: any, name: string): any[] => h.pine.bus.query({ topic: `source/${name}/#` }).sort((a: any, b: any) => a.id - b.id);

const infoOf = (h: any, name: string) => h.pine.sources.list().find((s: any) => s.name === name)!;

// ---- onvif ----------------------------------------------------------------------------------------

const TOPIC = "tns1:RuleEngine/CellMotionDetector/Motion";

const simple = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `<tt:SimpleItem Name="${k}" Value="${v}"/>`).join("");

const note = (topic: string, source: Record<string, string>, data: Record<string, string>, operation?: string) =>
	`<wsnt:NotificationMessage><wsnt:Topic Dialect="http://www.onvif.org/ver10/tev/topicExpression/ConcreteSet">${topic}</wsnt:Topic><wsnt:Message><tt:Message UtcTime="2026-11-16T10:00:00Z"${operation ? ` PropertyOperation="${operation}"` : ""}><tt:Source>${simple(source)}</tt:Source><tt:Data>${simple(data)}</tt:Data></tt:Message></wsnt:Message></wsnt:NotificationMessage>`;

const WHERE = { VideoSourceConfigurationToken: "1", Rule: "MyMotionDetectorRule" };

/**
 * A camera, as far as its events go. Its clock is an hour off, it checks the digest against its
 * own time, and every address it names lies on another machine: only the path may be used.
 */
async function camera(password: string) {
	const clockOff = 3_600_000;
	const state = { motion: false, queue: [] as string[], subs: 0, dead: new Set<string>(), fault: false, renewed: 0, unsubscribed: 0, hosts: new Set<string>(), paths: new Set<string>(), echoed: [] as boolean[], refused: 0 };
	const env = (body: string) =>
		`<?xml version="1.0" encoding="UTF-8"?><env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope" xmlns:tt="http://www.onvif.org/ver10/schema" xmlns:tev="http://www.onvif.org/ver10/events/wsdl" xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2" xmlns:wsa5="http://www.w3.org/2005/08/addressing" xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><env:Body>${body}</env:Body></env:Envelope>`;
	const fault = (text: string, sub = "ter:InvalidArgVal") => env(`<env:Fault><env:Code><env:Value>env:Sender</env:Value><env:Subcode><env:Value>${sub}</env:Value></env:Subcode></env:Code><env:Reason><env:Text xml:lang="en">${text}</env:Text></env:Reason></env:Fault>`);
	const authed = (xml: string) => {
		const pick = (name: string) => new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)<`).exec(xml)?.[1];
		const [user, digest, nonce, created] = [pick("Username"), pick("Password"), pick("Nonce"), pick("Created")];
		if (!user || !digest || !nonce || !created || xml.includes(password)) return false;
		if (Math.abs(Date.parse(created) - (Date.now() + clockOff)) > 5000) return false;
		return user === "admin" && digest === crypto.createHash("sha1").update(Buffer.concat([Buffer.from(nonce, "base64"), Buffer.from(created), Buffer.from(password)])).digest("base64");
	};
	const server = http.createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (d) => chunks.push(d));
		req.on("end", async () => {
			const xml = Buffer.concat(chunks).toString("utf8");
			state.hosts.add(String(req.headers.host));
			state.paths.add(String(req.url));
			const send = (status: number, body: string) => res.writeHead(status, { "content-type": "application/soap+xml; charset=utf-8" }).end(body);
			if (xml.includes("GetSystemDateAndTime")) {
				const d = new Date(Date.now() + clockOff);
				return send(200, env(`<tds:GetSystemDateAndTimeResponse><tds:SystemDateAndTime><tt:UTCDateTime><tt:Time><tt:Hour>${d.getUTCHours()}</tt:Hour><tt:Minute>${d.getUTCMinutes()}</tt:Minute><tt:Second>${d.getUTCSeconds()}</tt:Second></tt:Time><tt:Date><tt:Year>${d.getUTCFullYear()}</tt:Year><tt:Month>${d.getUTCMonth() + 1}</tt:Month><tt:Day>${d.getUTCDate()}</tt:Day></tt:Date></tt:UTCDateTime></tds:SystemDateAndTime></tds:GetSystemDateAndTimeResponse>`));
			}
			if (!authed(xml)) {
				state.refused++;
				return send(400, fault("Sender not authorized", "ter:NotAuthorized"));
			}
			if (xml.includes("GetCapabilities")) return send(200, env("<tds:GetCapabilitiesResponse><tds:Capabilities><tt:Events><tt:XAddr>http://10.9.9.9:1234/onvif/events_here</tt:XAddr><tt:WSPullPointSupport>true</tt:WSPullPointSupport></tt:Events></tds:Capabilities></tds:GetCapabilitiesResponse>"));
			if (xml.includes("CreatePullPointSubscription")) {
				const id = ++state.subs;
				// What a camera says first: where things stand.
				state.queue.unshift(note(TOPIC, WHERE, { IsMotion: String(state.motion) }, "Initialized"));
				return send(200, env(`<tev:CreatePullPointSubscriptionResponse><tev:SubscriptionReference><wsa5:Address>http://203.0.113.5/onvif/sub?id=${id}&amp;x=1</wsa5:Address><wsa5:ReferenceParameters><dom0:SubscriptionId xmlns:dom0="http://camera.example/sub">${id}</dom0:SubscriptionId></wsa5:ReferenceParameters></tev:SubscriptionReference><wsnt:CurrentTime>2026-11-16T10:00:00Z</wsnt:CurrentTime><wsnt:TerminationTime>2026-11-16T10:10:00Z</wsnt:TerminationTime></tev:CreatePullPointSubscriptionResponse>`));
			}
			const id = /[?&]id=(\d+)/.exec(String(req.url))?.[1] ?? "";
			state.echoed.push(xml.includes(`>${id}</dom0:SubscriptionId>`));
			if (xml.includes("Unsubscribe")) return (state.unsubscribed++, send(200, env("<wsnt:UnsubscribeResponse/>")));
			if (xml.includes("Renew")) return (state.renewed++, send(200, env("<wsnt:RenewResponse><wsnt:TerminationTime>2026-11-16T10:20:00Z</wsnt:TerminationTime></wsnt:RenewResponse>")));
			if (xml.includes("PullMessages")) {
				await sleep(15);
				if (state.fault) {
					state.fault = false;
					state.dead.add(id);
				}
				if (state.dead.has(id)) return send(500, fault("The subscription does not exist"));
				return send(200, env(`<tev:PullMessagesResponse><tev:CurrentTime>2026-11-16T10:00:00Z</tev:CurrentTime><tev:TerminationTime>2026-11-16T10:10:00Z</tev:TerminationTime>${state.queue.splice(0, 10).join("")}</tev:PullMessagesResponse>`));
			}
			send(400, fault("what?"));
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return { state, port: (server.address() as net.AddressInfo).port, close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))) };
}

test("onvif: the password goes out as a digest, and a camera's answer is read whatever it calls its namespaces", () => {
	const nonce = Buffer.from("0123456789abcdef");
	const header = security("ad<min", "s3cret", new Date("2026-11-16T10:00:00.123Z"), nonce);
	assert.ok(!header.includes("s3cret"), "the password itself is never sent");
	assert.equal(element(header, "Created")!.inner, "2026-11-16T10:00:00Z");
	assert.equal(element(header, "Username")!.inner, "ad&lt;min");
	assert.equal(element(header, "Password")!.inner, crypto.createHash("sha1").update(Buffer.concat([nonce, Buffer.from("2026-11-16T10:00:00Z"), Buffer.from("s3cret")])).digest("base64"));
	assert.equal(element(header, "Nonce")!.inner, nonce.toString("base64"));

	const xml = `<s:Body><a:PullMessagesResponse>${note(TOPIC, WHERE, { IsMotion: "true" }, "Changed")}<b:NotificationMessage><b:Topic>tns1:Device/Trigger/DigitalInput</b:Topic><b:Message><c:Message><c:Source/><c:Data><c:SimpleItem Value='7' Name='Count'/><c:SimpleItem Name="Note" Value="a &amp; b &#x21; ${"x".repeat(400)}"/></c:Data></c:Message></b:Message></b:NotificationMessage></a:PullMessagesResponse></s:Body>`;
	const got = notifications(xml);
	assert.deepEqual(got[0], { topic: "RuleEngine/CellMotionDetector/Motion", source: WHERE, data: { IsMotion: true }, time: "2026-11-16T10:00:00Z", operation: "Changed" });
	assert.deepEqual([got[1].topic, got[1].source, got[1].data.Count, got[1].operation], ["Device/Trigger/DigitalInput", {}, 7, undefined]);
	assert.ok(String(got[1].data.Note).startsWith("a & b ! xxx") && String(got[1].data.Note).length <= 201, "what a camera says is cut to a sensible length");
	assert.deepEqual(notifications("<x>nothing</x>"), []);
});

test("onvif: the state at the start is the starting point, a change is reported once, a lost subscription is made again", async (t) => {
	Object.assign(camTiming, { retryMs: 30, idleMs: 20, leaseSec: 0.2 });
	const password = "cam-pass-123";
	const cam = await camera(password);
	t.after(() => cam.close());
	const base = { type: "onvif", host: "127.0.0.1", port: cam.port, user: "admin", start: "always" };
	const h = await harness({ pine: { sources: { cam: { ...base, password, topics: ["motion", "person"] }, bad: { ...base, password: "wrong-pass-456" } } }, agents: { main: {} } });
	const events = () => eventsOf(h, "cam").map((e: any) => e.payload);
	const info = (name: string) => infoOf(h, name);

	await until(() => /subscribed to the camera, 0 events reported/.test(info("cam").status ?? ""), 5000, "the subscription");
	await sleep(120);
	assert.equal(events().length, 0, "what the camera says when the subscription begins is where things stand");

	// Motion starts: one event. Said again, and something on a topic nobody asked for: nothing.
	cam.state.motion = true;
	cam.state.queue.push(note(TOPIC, WHERE, { IsMotion: "true" }, "Changed"));
	await until(() => events().length === 1, 4000, "the motion");
	assert.deepEqual(events()[0], { topic: "RuleEngine/CellMotionDetector/Motion", source: WHERE, data: { IsMotion: true }, time: "2026-11-16T10:00:00Z", active: true });
	assert.equal(eventsOf(h, "cam")[0].trust, "untrusted");
	cam.state.queue.push(note(TOPIC, WHERE, { IsMotion: "true" }, "Changed"), note("tns1:RuleEngine/TamperDetector/Tamper", WHERE, { IsTamper: "true" }, "Changed"));
	await sleep(150);
	assert.equal(events().length, 1);
	// Something that happens rather than is: reported every time it does.
	const seen = note("tns1:RuleEngine/PersonDetector/Detected", { VideoSourceConfigurationToken: "1" }, { ObjectId: "7" });
	cam.state.queue.push(seen, seen);
	await until(() => events().length === 3, 4000, "the two detections");
	assert.deepEqual(events()[2], { topic: "RuleEngine/PersonDetector/Detected", source: { VideoSourceConfigurationToken: "1" }, data: { ObjectId: 7 }, time: "2026-11-16T10:00:00Z" });

	// The camera forgets the subscription (a restart): a new one is made, and the state it repeats is not news.
	cam.state.fault = true;
	await until(() => cam.state.subs >= 2 && /subscribed to the camera/.test(info("cam").status ?? ""), 5000, "a new subscription");
	await sleep(120);
	assert.equal(events().length, 3);
	cam.state.motion = false;
	cam.state.queue.push(note(TOPIC, WHERE, { IsMotion: "false" }, "Changed"));
	await until(() => events().length === 4, 4000, "the motion's end");
	assert.equal(events()[3].active, false);
	assert.match(info("cam").status!, /subscribed to the camera, 4 events reported/);

	// Every request went to the host that was confirmed, at the paths the camera named; its parameter came back; the subscription was renewed.
	assert.deepEqual([...cam.state.hosts], [`127.0.0.1:${cam.port}`]);
	assert.ok(["/onvif/device_service", "/onvif/events_here", "/onvif/sub?id=1&x=1", "/onvif/sub?id=2&x=1"].every((p) => cam.state.paths.has(p)), [...cam.state.paths].join(" "));
	assert.ok(cam.state.echoed.length > 3 && cam.state.echoed.every(Boolean), "the reference parameter is sent back");
	assert.ok(cam.state.renewed >= 1, "renewed before it ran out");

	// A wrong password: said in words of pine's own, tried again with a growing pause, and written nowhere.
	await until(() => /the camera refused the user name or the password; trying again every \d+ s/.test(info("bad").status ?? ""), 4000, "the refusal");
	assert.ok(cam.state.refused >= 1);
	const everything = JSON.stringify(h.pine.bus.query({})) + h.logs.join("\n") + JSON.stringify(h.pine.sources.list());
	assert.ok(!everything.includes(password) && !everything.includes("wrong-pass-456"), "a password is in no event, log or status");
	assert.ok(!JSON.stringify(h.pine.sources.list()).includes("not authorized"), "a status does not repeat what the camera wrote");
	await h.close();
	await until(() => cam.state.unsubscribed >= 1, 2000, "the camera to be told that nobody listens any more");
});

// ---- by asking ------------------------------------------------------------------------------------

test("devices by asking: each type says what it will do, refuses what cannot work, and a camera's password is typed into pine", async () => {
	const h = await harness({ agents: { main: {} } });
	const asked: any[] = [];
	h.pine.bus.subscribe("approval/requested", (e) => {
		const r = e.payload as any;
		asked.push(r);
		h.pine.approvals.decide(r.id, true, "test", false, r.inputs?.length ? { password: "typed-by-the-owner-123" } : undefined);
	});
	const add = (name: string, type: string, options: any) => call("add_source", { name, type, description: "x", options });
	const file = path.join(h.workspace("main"), "ttyUSB0");
	fs.writeFileSync(file, "");
	const r = await h.pine.agents.run({
		agent: "main",
		prompt: mockMsg([
			{
				tools: [
					add("a", "modbus", { host: "192.168.1.60", read: [{ name: "p", address: 70000 }] }),
					add("b", "modbus", { host: "http://192.168.1.60", read: [{ name: "p", address: 1 }] }),
					add("c", "modbus", { host: "192.168.1.60", every: "1s", read: [{ name: "p", address: 1 }] }),
					add("d", "serial", { port: file }),
					add("e", "serial", { port: "/dev/null" }),
					add("f", "onvif", { host: "http://192.168.1.40", user: "admin" }),
					add("g", "presence", { hosts: { dns: "8.8.8.8" } }),
					add("i", "presence", {}),
					add("j", "presence", { services: ["airplay"] }),
					add("k", "presence", { hosts: { phone: "192.168.1.23" }, every: "5s" }),
				],
			},
			{
				tools: [
					add("inverter", "modbus", { host: "192.168.1.60", unit: 3, read: [{ name: "power", address: 40083, type: "i16", step: 100 }, { name: "soc", address: 62852, type: "f32" }] }),
					add("door", "onvif", { host: "192.168.1.40", port: 8000, user: "admin", topics: ["Motion", "Person"] }),
					add("home", "presence", { hosts: { phone: "192.168.1.23", tv: "TV.local" }, services: ["_AirPlay._tcp.local."], away: "15m" }),
				],
			},
		]),
		...owner,
	});
	assert.equal(r.status, "done");
	const refused = h.toolResults(h.mock.state.requests[1]);
	for (const [i, re] of [
		/counted from 0, up to 65535/,
		/"http:\/\/192\.168\.1\.60" is not an address\. A Modbus device's looks like 192\.168\.1\.60/,
		/"every" must be at least "2s"/,
		/is not a device: a serial port lies under \/dev/,
		/is not a serial port by its name/,
		/is not an address\. A camera's looks like 192\.168\.1\.40/,
		/"8\.8\.8\.8" is not an address on your owner's own network/,
		/needs "hosts" \(devices by address[\s\S]*or "services"/,
		/"airplay" is not a service type\. One looks like _airplay\._tcp/,
		/"every" must be at least "10s"/,
	].entries())
		assert.match(refused[i], re);
	assert.deepEqual(asked.map((a) => a.tool), ["add_source", "add_source", "add_source"], "what cannot work is answered before the owner is asked anything");
	assert.match(asked[0].summary, /It will: connect to the Modbus device at 192\.168\.1\.60:502 \(an address on your own network or this computer\), unit 3, every 30s and read 2 values \(power, soc\); report each value when it changes\. It only reads: nothing on the device is switched or set\./);
	assert.match(asked[1].summary, /It will: connect to the camera at 192\.168\.1\.40:8000 \(an address on your own network or this computer\) as admin and report what it detects \(topics with Motion, Person\), at most 20 times a minute; with the password given, sent only to that camera and never in the clear; it only listens: nothing on the camera is changed\./);
	assert.deepEqual(asked[1].inputs.map((i: any) => i.name), ["password"]);
	assert.match(asked[2].summary, /It will: look every 30s whether phone \(192\.168\.1\.23\), tv \(tv\.local\) are on your network, with one ping each; ask your network every 30s which devices offer _airplay\._tcp; report a device when it joins, and when it has not answered for 15m\./);
	const done = h.toolResults().slice(-3);
	assert.match(done[0], /Added the event source "inverter" \(modbus\)\. Its first look is the starting point/);
	assert.match(done[1], /Added the event source "door" \(onvif\)/);
	assert.match(done[2], /Added the event source "home" \(presence\)\. Who is there now is the starting point/);
	const entry = JSON.parse(fs.readFileSync(path.join(h.home, "agents", "main", "agent.json"), "utf8")).sources;
	assert.equal(entry.door.password, "${PINE_SOURCE_DOOR_MAIN_PASSWORD}");
	assert.deepEqual([entry.home.hosts, entry.home.services], [{ phone: "192.168.1.23", tv: "tv.local" }, ["_airplay._tcp"]]);
	assert.ok(!JSON.stringify(h.mock.state.requests).includes("typed-by-the-owner-123"), "the password never passes a model");
	await h.close();
});
