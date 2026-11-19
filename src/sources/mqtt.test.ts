import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { test } from "node:test";
import { Aedes } from "aedes";
import mqtt from "mqtt";
import { harness, mockMsg, sleep, until } from "../../testing/harness.ts";

const owner = { trust: "owner" as const };

const call = (name: string, args: any) => ({ name, args });

const userText = (req: any) => {
	const m = req.body.messages.filter((x: any) => x.role === "user").at(-1);
	const text = typeof m.content === "string" ? m.content : m.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n");
	// Without the per-turn note pine puts in front (time, mode).
	return text.replace(/<pine-note>[\s\S]*?<\/pine-note>\s*/g, "");
};

const eventTasks = (h: any) => h.pine.tasks.list({}).filter((t: any) => t.kind === "event");

test("sources: webhook and mqtt", async (t) => {
	const broker = await Aedes.createBroker();
	const server = net.createServer(broker.handle);
	t.after(() => new Promise<void>((r) => broker.close(() => server.close(() => r()))));
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const url = `mqtt://127.0.0.1:${(server.address() as any).port}`;
	const h = await harness({
		pine: {
			http: { port: 0 },
			sources: {
				github: { type: "webhook", secret: "hook-secret-123456" },
				printer: { type: "mqtt", url, topics: ["device/+/report"], minInterval: "5s", trust: "owner", description: "the 3D printer" },
				broken: { type: "webhook" },
			},
		},
		agents: { main: { agent: { subscribe: { printer: { when: { "payload.value.state": "FINISH" }, throttle: "0s" } } } } },
	});
	const base = `http://127.0.0.1:${h.pine.http!.port}`;
	const post = (name: string, body: string, headers: Record<string, string> = {}) => fetch(`${base}/hook/${name}`, { method: "POST", body, headers });

	// A webhook nobody is subscribed to does not exist for the outside.
	assert.equal((await post("github", "{}", { authorization: "Bearer hook-secret-123456" })).status, 404);
	await h.pine.sources.subscribe("main", "github", { note: "summarise pushes" });
	assert.equal((await post("github", "{}")).status, 401);
	assert.equal((await post("github", "{}", { authorization: "Bearer wrong" })).status, 401);
	const body = JSON.stringify({ ref: "refs/heads/main", pusher: "sam" });
	const sig = crypto.createHmac("sha256", "hook-secret-123456").update(body).digest("hex");
	assert.equal((await post("github", body, { "x-hub-signature-256": `sha256=${sig}`, "x-github-event": "push" })).status, 202);
	await until(() => eventTasks(h).some((x: any) => x.meta.label === "github: source/github/received" && x.status === "done"), 6000, "the webhook to wake the agent");
	const hookEvent = h.pine.bus.query({ topic: "source/github/received" })[0];
	assert.deepEqual((hookEvent.payload as any).body, { ref: "refs/heads/main", pusher: "sam" });
	assert.equal((hookEvent.payload as any).headers["x-github-event"], "push");
	assert.equal((hookEvent.payload as any).headers.authorization, undefined);
	assert.ok(!JSON.stringify(h.pine.bus.query({})).includes("hook-secret-123456"), "the secret never shows up in an event");
	// One without a secret does not start, and says why instead of taking the daemon down.
	await assert.rejects(h.pine.sources.subscribe("main", "broken"), /subscribed, but the source could not start: needs a "secret"/);
	assert.match(h.pine.sources.list().find((s) => s.name === "broken")!.error ?? "", /needs a "secret"/);

	// The printer talks all the time; the subscription only wants to hear when a print is finished.
	await until(() => h.logs.some((l) => /connected to 127.0.0.1/.test(l)));
	await sleep(40);
	const outside = await mqtt.connectAsync(url);
	await outside.publishAsync("device/A1/report", JSON.stringify({ state: "RUNNING", percent: 40 }));
	await outside.publishAsync("device/A1/report", JSON.stringify({ state: "FINISH" })); // inside minInterval: dropped by the source
	await outside.publishAsync("device/B2/report", JSON.stringify({ state: "FINISH", file: "bracket.3mf" }));
	const printed = () => eventTasks(h).filter((x: any) => x.meta.label === "printer: source/printer/message");
	await until(() => printed().some((x: any) => x.status === "done"), 6000, "the finished print to wake the agent");
	await sleep(100);
	assert.equal(printed().length, 1);
	assert.equal(h.pine.bus.query({ topic: "source/printer/message" }).length, 2);
	assert.ok(userText(h.mock.state.requests.at(-1)).includes("bracket.3mf"));
	await outside.endAsync();
	await h.close();
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("mqtt: an agent acts on a device through the source, on the listed topics only", async (t) => {
	const broker = await Aedes.createBroker();
	const server = net.createServer(broker.handle);
	t.after(() => new Promise<void>((r) => broker.close(() => server.close(() => r()))));
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const url = `mqtt://127.0.0.1:${(server.address() as any).port}`;
	const h = await harness({ pine: { sources: { house: { type: "mqtt", url, topics: "house/#", publish: ["house/+/set"] }, ears: { type: "mqtt", url, topics: "garden/#" } } }, agents: { main: {} } });
	const outside = await mqtt.connectAsync(url);
	const got: Array<[string, string]> = [];
	await outside.subscribeAsync("#");
	outside.on("message", (topic, m) => void got.push([topic, m.toString()]));

	await h.pine.agents.run({
		agent: "main",
		prompt: mockMsg([{ tools: [call("sources", {}), call("send", { source: "house", data: '{"topic": "house/lamp/set", "message": {"state": "ON"}}' }), call("send", { source: "house", data: '{"topic": "garage/door/set", "message": "OPEN"}' }), call("send", { source: "house", data: '{"topic": "house/+/set", "message": "x"}' }), call("send", { source: "ears", data: '{"topic": "garden/pump/set", "message": "on"}' })] }]),
		...owner,
	});
	const out = h.toolResults().slice(-5);
	assert.ok(/house \(mqtt\)[\s\S]*can send \(tool: send\): an MQTT message/.test(out[0]), out[0]);
	assert.equal(out[1], "house: published to house/lamp/set");
	assert.match(out[2], /"garage\/door\/set" is not a topic this source may send to \(house\/\+\/set\)/);
	assert.match(out[3], /is not a topic this source may send to/);
	assert.match(out[4], /none: it was set up to listen only/);
	fs.writeFileSync(path.join(h.home, "agents", "main", "workspace", "lamp.png"), PNG);
	await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("send", { source: "house", data: '{"topic": "house/lamp/set", "message": "x"}', file: "lamp.png" })] }]), ...owner });
	assert.match(h.toolResults().at(-1)!, /house sends no files/);
	await until(() => got.length >= 1);
	await sleep(60);
	assert.deepEqual(got, [["house/lamp/set", '{"state":"ON"}']]);
	await outside.endAsync();
	await h.close();
});
