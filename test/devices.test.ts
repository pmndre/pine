import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readings } from "../src/sources/modbus.ts";
import { element, notifications, security, timing as camTiming } from "../src/sources/onvif.ts";
import { answers, browseLine, dnsQuery, dnsRead, standIn as netStandIn, timing as netTiming, tracker } from "../src/sources/presence.ts";
import { lines, listen, portOf, timing as portTiming } from "../src/sources/serial.ts";
import { harness, mockMsg, sleep, until } from "./support/harness.ts";

const owner = { trust: "owner" as const };
const call = (name: string, args: any) => ({ name, args });
const eventsOf = (h: any, name: string): any[] => h.pine.bus.query({ topic: `source/${name}/#` }).sort((a: any, b: any) => a.id - b.id);
const infoOf = (h: any, name: string) => h.pine.sources.list().find((s: any) => s.name === name)!;

// ---- modbus ---------------------------------------------------------------------------------------

/** A Modbus TCP device whose registers the test changes. It answers the four reading functions and counts everything else. */
async function device() {
	const state = {
		holding: new Map<number, number>(),
		input: new Map<number, number>(),
		coil: new Map<number, boolean>(),
		discrete: new Map<number, boolean>(),
		/** address → the exception it answers with */
		exception: new Map<number, number>(),
		down: false,
		asked: [] as Array<{ fc: number; unit: number; address: number; count: number }>,
	};
	const server = net.createServer((sock) => {
		if (state.down) return void sock.destroy();
		let buf = Buffer.alloc(0);
		sock.on("error", () => {});
		sock.on("data", (d: Buffer) => {
			buf = Buffer.concat([buf, d]);
			while (buf.length >= 12) {
				const frame = buf.subarray(0, 12);
				buf = buf.subarray(12);
				const [tid, unit, fc, address, count] = [frame.readUInt16BE(0), frame[6], frame[7], frame.readUInt16BE(8), frame.readUInt16BE(10)];
				state.asked.push({ fc, unit, address, count });
				const answer = (pdu: Buffer) => {
					const head = Buffer.alloc(7);
					head.writeUInt16BE(tid, 0);
					head.writeUInt16BE(pdu.length + 1, 4);
					head[6] = unit;
					sock.write(Buffer.concat([head, pdu]));
				};
				if (state.exception.has(address)) answer(Buffer.from([fc | 0x80, state.exception.get(address)!]));
				else if (fc === 3 || fc === 4) {
					const data = Buffer.alloc(count * 2);
					for (let i = 0; i < count; i++) data.writeUInt16BE((fc === 3 ? state.holding : state.input).get(address + i) ?? 0, i * 2);
					answer(Buffer.concat([Buffer.from([fc, data.length]), data]));
				} else if (fc === 1 || fc === 2) answer(Buffer.from([fc, 1, (fc === 1 ? state.coil : state.discrete).get(address) ? 1 : 0]));
				else answer(Buffer.from([fc | 0x80, 1]));
			}
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return { state, port: (server.address() as net.AddressInfo).port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test("modbus: types, scale and word order are read as the device means them; a value is reported when it moved a step", async (t) => {
	const dev = await device();
	t.after(() => dev.close());
	const { holding, input, coil, discrete } = dev.state;
	holding.set(10, 0x10000 - 1500); // i16: -1500
	input.set(20, 215); // tenths
	holding.set(30, 0x0001).set(31, 0x86a0); // u32, high word first: 100000
	holding.set(40, 0xfffe).set(41, 0xffff); // i32, low word first: -2
	const f = Buffer.alloc(4);
	f.writeFloatBE(230.5);
	holding.set(50, f.readUInt16BE(0)).set(51, f.readUInt16BE(2));
	coil.set(5, true);
	discrete.set(6, false);
	const h = await harness({
		pine: {
			sources: {
				meter: {
					type: "modbus", host: "127.0.0.1", port: dev.port, unit: 7, every: "40ms", start: "always",
					read: [
						{ name: "power", address: 10, type: "i16", step: 100 },
						{ name: "temp", address: 20, kind: "input", scale: 0.1 },
						{ name: "energy", address: 30, type: "u32" },
						{ name: "total", address: 40, type: "i32", words: "le" },
						{ name: "volts", address: 50, type: "f32" },
						{ name: "pump", address: 5, kind: "coil" },
						{ name: "door", address: 6, kind: "discrete" },
					],
				},
			},
		},
		agents: { main: {} },
	});
	const events = () => eventsOf(h, "meter").map((e: any) => e.payload);
	const info = () => infoOf(h, "meter");

	// The starting point: read, remembered, nothing reported.
	await until(() => /^last looked/.test(info().status ?? ""), 4000, "the first look");
	await sleep(120);
	assert.equal(events().length, 0, "the first look is the starting point");
	assert.match(info().status!, /7 values: power -1500, temp 21\.5, energy 100000, total -2, \.\.\.$/);
	assert.ok(dev.state.asked.every((a) => a.unit === 7 && a.fc >= 1 && a.fc <= 4), "only the reading functions are ever sent, to the unit that was named");
	assert.deepEqual([...new Set(dev.state.asked.filter((a) => a.address === 30 || a.address === 10).map((a) => `${a.fc}:${a.address}:${a.count}`))].sort(), ["3:10:1", "3:30:2"]);

	// Less than a step: quiet. A step from what was last reported, not from what was last read: reported once.
	holding.set(10, 0x10000 - 1450);
	await sleep(150);
	holding.set(10, 0x10000 - 1380);
	input.set(20, 216);
	coil.set(5, false);
	f.writeFloatBE(231.25);
	holding.set(50, f.readUInt16BE(0)).set(51, f.readUInt16BE(2));
	await until(() => events().length === 4, 4000, "the changes");
	assert.deepEqual(
		events().sort((a: any, b: any) => a.name.localeCompare(b.name)),
		[
			{ name: "power", value: -1380, previous: -1500 },
			{ name: "pump", value: false, previous: true },
			{ name: "temp", value: 21.6, previous: 21.5 },
			{ name: "volts", value: 231.25, previous: 230.5 },
		],
	);
	assert.equal(eventsOf(h, "meter")[0].trust, "untrusted");
	await sleep(150);
	assert.equal(events().length, 4, "and then it is quiet again");

	// The device says no to one register: a failed look that says which value and why, not an event.
	dev.state.exception.set(20, 2);
	await until(() => /failing since .*the device says: illegal data address \(2\) for temp/.test(info().status ?? ""), 4000, "the exception to show");
	dev.state.exception.clear();
	await until(() => /^last looked/.test(info().status ?? ""), 4000, "it to work again");
	// Down, and back with another value: the failure shows, the change is reported when it is back.
	dev.state.down = true;
	await until(() => /failing since .*it closed the connection/.test(info().status ?? ""), 4000, "down to show");
	assert.equal(info().running, true);
	input.set(20, 220);
	dev.state.down = false;
	await until(() => events().length === 5, 6000, "what changed meanwhile");
	assert.deepEqual(events().at(-1), { name: "temp", value: 22, previous: 21.6 });
	await h.close();
});

test("modbus: a list of values that cannot work is refused with what to give instead", () => {
	assert.deepEqual(readings([{ name: "a", address: 0 }]), [{ name: "a", address: 0, kind: "holding", type: "u16", scale: 1, words: "be" }]);
	assert.deepEqual(readings([{ name: "on", address: 3, kind: "coil", type: "f32", step: 2 }])[0], { name: "on", address: 3, kind: "coil", type: "bit", scale: 1, words: "be" });
	for (const [raw, re] of [
		[[], /needs "read"/],
		[[{ name: "a", address: 70000 }], /counted from 0, up to 65535\. A list that counts from 40001/],
		[[{ name: "a", address: 65535, type: "u32" }], /up to 65535/],
		[[{ name: "a", address: 1 }, { name: "a", address: 2 }], /two values are called "a"/],
		[[{ name: "a b", address: 1 }], /"name" is a short word/],
		[[{ name: "a", address: 1, type: "u64" }], /"type" is u16, i16, u32, i32 or f32/],
		[[{ name: "a", address: 1, kind: "register" }], /"kind" is holding, input, coil or discrete/],
		[[{ name: "a", address: 1, scale: 0 }], /"scale"/],
		[[{ name: "a", address: 1, step: -1 }], /"step"/],
		[Array.from({ length: 33 }, (_, i) => ({ name: `v${i}`, address: i })), /32 values at most/],
	] as Array<[unknown, RegExp]>) assert.throws(() => readings(raw), re);
});

// ---- serial ---------------------------------------------------------------------------------------

test("serial: only a serial port is read; lines come out of bytes clean and whole", { skip: process.platform === "win32" && "a serial port cannot be read on Windows yet" }, () => {
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pine-serial-")), "ttyUSB0");
	fs.writeFileSync(file, "x");
	assert.throws(() => portOf(file), /is not a device: a serial port lies under \/dev/);
	assert.throws(() => portOf("ttyUSB0"), /"port" is the device's path/);
	assert.throws(() => portOf("/dev/ttyUSB-pine-none"), /is not there\. Is the device plugged in\?/);
	// Devices of the same kind that are not serial ports: nothing to read lines from, or somebody's keyboard.
	assert.throws(() => portOf("/dev/null"), /is not a serial port by name[\s\S]*A terminal is never read/);
	if (fs.existsSync("/dev/tty")) assert.throws(() => portOf("/dev/tty"), /is not a serial port/);
	assert.throws(() => portOf("/dev/../etc/hosts"), /is not a device|is not there/);
	fs.rmSync(path.dirname(file), { recursive: true, force: true });

	const got: string[] = [];
	const feed = lines((l) => got.push(l));
	feed(Buffer.from("temp=21"));
	assert.deepEqual(got, [], "a line is not a line until it ends");
	feed(Buffer.from(".5\r\nhum=40\n\n\rdone\r"));
	feed(Buffer.from("a\tb\u0007\u001b[31m c\n"));
	// A character of several bytes that arrives in two pieces.
	const euro = Buffer.from("1 €\n");
	feed(euro.subarray(0, 3));
	feed(euro.subarray(3));
	assert.deepEqual(got, ["temp=21.5", "hum=40", "done", "a b[31m c", "1 €"]);
	const long: string[] = [];
	lines((l) => long.push(l))(Buffer.from("x".repeat(5000)));
	assert.deepEqual(long.map((l) => l.length), [4096], "a device that never ends its line does not fill the memory");
});

const python = ["/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"].find((p) => fs.existsSync(p));
const hasPty = (() => {
	try {
		return Boolean(python) && execFileSync(python!, ["-c", "import pty, os\nm, s = pty.openpty()\nprint(os.ttyname(s))"], { timeout: 5000 }).toString().startsWith("/dev/");
	} catch {
		return false;
	}
})();

test("serial: what a device prints arrives line by line; a device that is gone is waited for", { skip: !hasPty && "needs python3 with pseudo-terminals" }, async (t) => {
	portTiming.retryMs = 40;
	// A pseudo-terminal: what the test writes into one end is what a device would send on the other.
	const dev = spawn(python!, ["-u", "-c", "import os, pty, sys\nm, s = pty.openpty()\nprint(os.ttyname(s), flush=True)\nwhile True:\n    d = os.read(0, 4096)\n    if not d:\n        break\n    os.write(m, d)\n"], { stdio: ["pipe", "pipe", "inherit"] });
	t.after(() => dev.kill("SIGKILL"));
	const name = await new Promise<string>((resolve) => dev.stdout!.once("data", (d: Buffer) => resolve(d.toString().trim())));
	assert.match(name, /^\/dev\//);
	const got: string[] = [];
	const states: string[] = [];
	const stop = listen(name, 115200, (l) => got.push(l), (s) => states.push(s));
	t.after(stop);
	await until(() => states.includes("listening"), 5000, "the port to be open at its speed");
	dev.stdin!.write('temp=21.5\r\n{"hum": 40}\n');
	await until(() => got.length === 2, 4000, "the lines");
	assert.deepEqual(got, ["temp=21.5", '{"hum": 40}']);
	stop();
	dev.stdin!.end();

	// One that is not there: nothing fails, it is looked for again and again.
	const gone: string[] = [];
	const stopGone = listen("/dev/cu.pine-test-none", 9600, () => {}, (s) => gone.push(s));
	await until(() => gone.length >= 3, 4000, "it to be looked for again");
	stopGone();
	assert.deepEqual([...new Set(gone)], ["waiting"]);
});

test("serial: a source whose device is unplugged says so and stays", { skip: process.platform === "win32" && "a serial port cannot be read on Windows yet" }, async () => {
	portTiming.retryMs = 40;
	const h = await harness({ pine: { sources: { meter: { type: "serial", port: "/dev/cu.pine-test-none", baud: 115200, start: "always" }, odd: { type: "serial", port: "/dev/null", start: "always" } } }, agents: { main: {} } });
	await until(() => /waiting for cu\.pine-test-none: it is not there \(unplugged\?\)/.test(infoOf(h, "meter").status ?? ""), 4000, "the status");
	assert.equal(infoOf(h, "meter").running, true);
	assert.match(infoOf(h, "odd").error ?? "", /is not a serial port by name/);
	assert.equal(h.pine.bus.query({ topic: "source/#" }).length, 0);
	await h.close();
});

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

// ---- presence -------------------------------------------------------------------------------------

test("presence: an announcement is read with its compressed names, a goodbye is one, and nonsense ends the reading", () => {
	const label = (s: string) => Buffer.concat([Buffer.from([Buffer.byteLength(s)]), Buffer.from(s)]);
	const full = (s: string) => Buffer.concat([...s.split(".").map(label), Buffer.from([0])]);
	const to = (offset: number) => Buffer.from([0xc0 | (offset >> 8), offset & 0xff]);
	const parts: Buffer[] = [];
	const at = () => parts.reduce((n, b) => n + b.length, 0);
	const record = (name: Buffer, type: number, ttl: number, data: Buffer) => {
		const head = Buffer.alloc(10);
		head.writeUInt16BE(type, 0);
		head.writeUInt16BE(1, 2);
		head.writeUInt32BE(ttl, 4);
		head.writeUInt16BE(data.length, 8);
		parts.push(name, head, data);
	};
	const head = Buffer.alloc(12);
	head.writeUInt16BE(0x8400, 2);
	head.writeUInt16BE(2, 6);
	head.writeUInt16BE(2, 10);
	parts.push(head);
	const service = at(); // "_ipp._tcp.local" is written once and pointed at from then on
	const local = service + 1 + 4 + 1 + 4;
	record(full("_ipp._tcp.local"), 12, 4500, Buffer.concat([label("Office Printer"), to(service)]));
	const instance = at() - (1 + 14 + 2);
	record(to(service), 12, 0, Buffer.concat([label("Old Printer"), to(service)]));
	const srv = Buffer.alloc(6);
	srv.writeUInt16BE(631, 4);
	const target = at() + 2 + 10 + 6;
	record(to(instance), 33, 120, Buffer.concat([srv, label("printer"), to(local)]));
	record(to(target), 1, 120, Buffer.from([192, 168, 1, 77]));
	const { response, records } = dnsRead(Buffer.concat(parts));
	assert.equal(response, true);
	assert.deepEqual(records, [
		{ name: ["_ipp", "_tcp", "local"], type: 12, ttl: 4500, ptr: ["Office Printer", "_ipp", "_tcp", "local"] },
		{ name: ["_ipp", "_tcp", "local"], type: 12, ttl: 0, ptr: ["Old Printer", "_ipp", "_tcp", "local"] },
		{ name: ["Office Printer", "_ipp", "_tcp", "local"], type: 33, ttl: 120, srv: { port: 631, target: ["printer", "local"] } },
		{ name: ["printer", "local"], type: 1, ttl: 120, address: "192.168.1.77" },
	]);

	// A question is not an answer, and reads back as what was asked.
	const q = dnsQuery(["_ipp._tcp.local", "_airplay._tcp.local"], true);
	assert.deepEqual([q.readUInt16BE(4), dnsRead(q)], [2, { response: false, records: [] }]);
	assert.equal(q.readUInt16BE(q.length - 2), 0x8001, "an answer to the asker alone is asked for");
	// A name that points at itself, a message that ends early, a length that leads out of it: no loop, no error.
	const loop = Buffer.concat([head, to(12), Buffer.alloc(10)]);
	assert.deepEqual(dnsRead(loop).records, []);
	assert.deepEqual(dnsRead(Buffer.concat(parts).subarray(0, 40)).records, []);
	assert.equal(dnsRead(Buffer.concat(parts).subarray(0, at() - 3)).records.length, 3);
	assert.deepEqual(dnsRead(Buffer.from([1, 2, 3])), { response: false, records: [] });

	// On a Mac the system's own browser is asked instead: a line of it is a device that came or went, on one interface.
	assert.deepEqual(browseLine(" 0:40:37.908  Add        3  26 local.               _airplay._tcp.       Living Room TV"), { add: true, iface: "26", service: "_airplay._tcp", name: "Living Room TV" });
	assert.deepEqual(browseLine("23:59:59.001  Rmv        0   1 local.               _IPP._tcp.           Printer (2)  "), { add: false, iface: "1", service: "_ipp._tcp", name: "Printer (2)" });
	for (const other of ["Timestamp     A/R    Flags  if Domain               Service Type         Instance Name", " 0:40:37.907  ...STARTING...", "DATE: ---Mon 16 Nov 2026---", ""]) assert.equal(browseLine(other), undefined);
});

test("presence: silence is not leaving until it has lasted; coming back says for how long it was gone", () => {
	const t = tracker(600_000);
	const phone = { name: "phone", address: "192.168.1.23" };
	const T = Date.parse("2026-11-16T10:00:00Z");
	// The starting point, in either state, says nothing.
	assert.equal(t.sight("host:phone", true, T, true, phone), undefined);
	assert.equal(t.sight("host:tv", false, T, true, { name: "tv" }), undefined);
	// A phone that sleeps: silent for some minutes, then heard again. Nothing happened.
	assert.equal(t.sight("host:phone", false, T + 300_000, false, phone), undefined);
	assert.equal(t.sight("host:phone", true, T + 400_000, false, phone), undefined);
	// Silent for as long as `away`: gone, since it was last heard.
	assert.equal(t.sight("host:phone", false, T + 900_000, false, phone), undefined);
	assert.deepEqual(t.sight("host:phone", false, T + 1_000_000, false, phone), { event: "left", payload: { ...phone, lastSeen: new Date(T + 400_000).toISOString() } });
	assert.equal(t.sight("host:phone", false, T + 1_100_000, false, phone), undefined, "said once");
	assert.deepEqual(t.sight("host:phone", true, T + 4_000_000, false, phone), { event: "arrived", payload: { ...phone, awayFor: 3600 } });
	// One that was not there at the start, and one nobody knew of.
	assert.deepEqual(t.sight("host:tv", true, T + 5000, false, { name: "tv", address: "192.168.1.30" }), { event: "arrived", payload: { name: "tv", address: "192.168.1.30" } });
	assert.deepEqual(t.sight("service:new._airplay._tcp.local", true, T, false, { name: "New", service: "_airplay._tcp" }), { event: "arrived", payload: { name: "New", service: "_airplay._tcp" } });
	assert.equal(t.sight("service:never", false, T, false, { name: "never" }), undefined);
	// A goodbye is leaving at once.
	assert.deepEqual(t.gone("service:new._airplay._tcp.local")?.event, "left");
	assert.equal(t.gone("service:new._airplay._tcp.local"), undefined);
});

test("presence: who is there at the start is not reported; a device that came and one that went are", async () => {
	Object.assign(netTiming, { probeMs: 300, listenMs: 50 });
	// The loopback is asked for real; an address that should lead nowhere may still be answered for by
	// the network the test runs on (a router that takes every connection to port 80), so it answers nothing.
	netStandIn.answers = (ip) => (ip === "127.0.0.1" ? answers(ip) : Promise.resolve(false));
	const net2 = { type: "presence", hosts: { here: "127.0.0.1", nobody: "192.0.2.1" }, every: "50ms", away: "200ms" };
	const h = await harness({ pine: { sources: { lan: { ...net2, start: "always" }, known: net2 } }, agents: { main: {} } });
	await until(() => /1 of 2 there$/.test(infoOf(h, "lan").status ?? ""), 6000, "the first look");
	await sleep(150);
	assert.equal(h.pine.bus.query({ topic: "source/#" }).length, 0, "the first look is the starting point");

	// A source that knows from before: the one that was gone is here now, the one that was here has been silent for too long.
	const now = Date.now();
	const kv = (h.pine.sources as any).kv;
	kv.set("source:known:began", true);
	kv.set("source:known:state", { "host:here": { there: false, last: now - 90_000, left: now - 90_000, name: "here", address: "127.0.0.1" }, "host:nobody": { there: true, last: now - 10_000, name: "nobody", address: "192.0.2.1" } });
	await h.pine.sources.subscribe("main", "known", { note: "Say who came and went.", throttle: "10ms" });
	await until(() => eventsOf(h, "known").length === 2, 6000, "the arrival and the departure");
	const by = Object.fromEntries(eventsOf(h, "known").map((e: any) => [e.topic.split("/").pop(), e.payload]));
	assert.deepEqual([by.arrived.name, by.arrived.address, by.left.name, by.left.address], ["here", "127.0.0.1", "nobody", "192.0.2.1"]);
	assert.ok(by.arrived.awayFor >= 89 && by.arrived.awayFor <= 100, String(by.arrived.awayFor));
	assert.ok(Math.abs(Date.parse(by.left.lastSeen) - (now - 10_000)) < 5, by.left.lastSeen);
	await sleep(200);
	assert.equal(eventsOf(h, "known").length, 2, "each is said once");
	await h.close();
	delete netStandIn.answers;
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
		process.platform === "win32" ? /cannot be read on Windows yet/ : /is not a device: a serial port lies under \/dev/,
		process.platform === "win32" ? /cannot be read on Windows yet/ : /is not a serial port by name/,
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
	assert.match(done[0], /Added the event source "inverter" \(modbus\)\. The first look is the starting point/);
	assert.match(done[1], /Added the event source "door" \(onvif\)/);
	assert.match(done[2], /Added the event source "home" \(presence\)\. Who is there now is the starting point/);
	const entry = JSON.parse(fs.readFileSync(path.join(h.home, "agents", "main", "agent.json"), "utf8")).sources;
	assert.equal(entry.door.password, "${PINE_SOURCE_DOOR_MAIN_PASSWORD}");
	assert.deepEqual([entry.home.hosts, entry.home.services], [{ phone: "192.168.1.23", tv: "tv.local" }, ["_airplay._tcp"]]);
	assert.ok(!JSON.stringify(h.mock.state.requests).includes("typed-by-the-owner-123"), "the password never passes a model");
	await h.close();
});
