import assert from "node:assert/strict";
import dns from "node:dns";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { isLocalHost, isPrivateAddress, publicOnlyAgent } from "../src/net.ts";
import { sseParser, wire } from "../src/sources/stream.ts";
import { harness, mockMsg, sleep, until } from "./support/harness.ts";
import { wsServer } from "./support/ws.ts";

const owner = { trust: "owner" as const };
const call = (name: string, args: any) => ({ name, args });
const always = { type: "stream", start: "always" };

/** A name that is not local by what it says, and leads to an address that is not public, on this machine. */
async function privateName(): Promise<string | undefined> {
	for (const name of [os.hostname(), "broadcasthost", "ip6-localhost", "ip6-loopback"]) {
		if (!name || isLocalHost(name)) continue;
		const found = await dns.promises.lookup(name, { all: true }).catch(() => []);
		if (found.length && found.every((a) => isPrivateAddress(a.address))) return name;
	}
	return undefined;
}

/** A service that speaks Server-Sent Events: the test says what it sends, and when it hangs up. */
async function sseSite() {
	const state = { status: 200 };
	const open = new Set<http.ServerResponse>();
	const seen: Array<{ url: string; host: string; headers: http.IncomingHttpHeaders }> = [];
	const server = http.createServer((req, res) => {
		seen.push({ url: req.url ?? "", host: String(req.headers.host), headers: req.headers });
		if (req.url === "/plain") return void res.writeHead(200, { "content-type": "text/plain" }).end("just a page");
		if (req.url === "/moved") return void res.writeHead(302, { location: "/events" }).end();
		// Another host name for the same machine: to the source it is somewhere else.
		if (req.url === "/away") return void res.writeHead(302, { location: `http://localhost:${port()}/events` }).end();
		if (state.status !== 200) return void res.writeHead(state.status).end("no");
		res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
		// Come back quickly after a hang-up.
		res.write("retry: 30\n\n");
		open.add(res);
		res.on("close", () => open.delete(res));
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const port = () => (server.address() as any).port;
	return {
		state,
		seen,
		open,
		base: `http://127.0.0.1:${port()}`,
		push: (text: string) => open.forEach((res) => res.write(text)),
		hangUp: () => open.forEach((res) => res.end()),
		close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))),
	};
}

test("stream: Server-Sent Events are read field by field, whatever the pieces they arrive in", () => {
	const got: any[] = [];
	const retries: number[] = [];
	const feed = sseParser((e) => got.push(e), (ms) => retries.push(ms));
	feed("\uFEFF: a comment\nretry: 250\n\ndata: one\n\n");
	feed("id: 7\r\nevent: upd");
	feed("ate\r\ndata: {\"a\":\r");
	feed("\ndata: 1}\r\n\r\n");
	feed("event: empty\n\n");
	feed("data:no space\rdata\r\rid: 8\ndata: last\n");
	feed("\n");
	assert.deepEqual(got, [
		{ event: "message", data: "one" },
		{ event: "update", data: '{"a":\n1}', id: "7" },
		// An event without data is not one; an id stays until another is given.
		{ event: "message", data: "no space\n", id: "7" },
		{ event: "message", data: "last", id: "8" },
	]);
	assert.deepEqual(retries, [250]);
	// An event too large to be worth a turn is left out whole; the next one is read as usual.
	got.length = 0;
	feed(`data: ${"x".repeat(200_000)}\ndata: ${"y".repeat(100_000)}\n\ndata: small\n\n`);
	assert.deepEqual(got, [{ event: "message", data: "small", id: "8" }]);
});

test("stream (SSE): every message is an event; a field, a pattern, only changes; a hang-up is connected to again from where it stopped", async (t) => {
	const web = await sseSite();
	t.after(() => web.close());
	const h = await harness({
		pine: {
			sources: {
				all: { ...always, url: `${web.base}/moved` },
				named: { ...always, url: `${web.base}/events?named`, event: "update", path: "data.state", changed: true, token: "sse-secret-token-1", tokenHeader: "x-api-key" },
				tagged: { ...always, url: `${web.base}/events?tagged`, match: "temp: ([0-9.]+)", token: "sse-secret-token-2" },
				few: { ...always, url: `${web.base}/events?few`, perMinute: 2 },
				page: { ...always, url: `${web.base}/plain` },
				away: { ...always, url: `${web.base}/away`, token: "not-for-other-hosts" },
			},
		},
		agents: { main: {} },
	});
	const events = (name: string): any[] => h.pine.bus.query({ topic: `source/${name}/#` }).sort((a: any, b: any) => a.id - b.id);
	const payloads = (name: string) => events(name).map((e: any) => e.payload);
	const info = (name: string) => h.pine.sources.list().find((s) => s.name === name)!;
	const live = ["all", "named", "tagged", "few"];
	await until(() => live.every((n) => /^connected since \d\d:\d\d:\d\d$/.test(info(n).status ?? "")) && web.open.size === 4, 5000, "the streams to be connected");
	assert.equal(h.pine.bus.query({ topic: "source/#" }).length, 0, "connecting is not an event");
	const asked = (q: string) => web.seen.findLast((r) => r.url === q)!.headers;
	assert.equal(asked("/events?named").accept, "text/event-stream");
	assert.equal(asked("/events?named")["x-api-key"], "sse-secret-token-1");
	assert.equal(asked("/events?tagged").authorization, "Bearer sse-secret-token-2");
	assert.equal(asked("/events?named")["last-event-id"], undefined);

	// One event in pieces, with a comment before it: everybody who takes it gets it once.
	web.push(': keep-alive\n\nid: 7\nevent: update\ndata: {"data":\ndata: {"state":"on"}}\n\n');
	await until(() => events("all").length === 1, 3000, "the first message");
	assert.deepEqual(payloads("all"), [{ value: { data: { state: "on" } }, event: "update", id: "7" }]);
	assert.equal(events("all")[0].trust, "untrusted");
	assert.equal(events("all")[0].topic, "source/all/message");
	// With "changed" the first value is the starting point, and the same value again is nothing.
	web.push('event: update\ndata: {"data":{"state":"on"}}\n\nevent: other\ndata: {"data":{"state":"never"}}\n\ndata: temp: 21.5 C\n\n');
	await until(() => events("tagged").length === 1, 3000, "what the pattern finds");
	// The id is the place in the stream: it stays the last one that was given.
	assert.deepEqual(payloads("tagged"), [{ value: "21.5", id: "7" }]);
	assert.deepEqual(payloads("named"), []);
	web.push('id: 9\nevent: update\ndata: {"data":{"state":"off"}}\n\n');
	await until(() => events("named").length === 1, 3000, "the changed value");
	assert.deepEqual(payloads("named"), [{ value: "off", event: "update", id: "9", previous: "on" }]);
	// A cap: two a minute get through, the rest are counted, and the next one that gets through says how many.
	assert.equal(events("few").length, 2);
	t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
	t.mock.timers.tick(61_000);
	web.push("data: after a minute\n\n");
	await until(() => events("few").length === 3, 3000, "the next message through the cap");
	t.mock.timers.reset();
	assert.deepEqual(payloads("few")[2], { value: "after a minute", id: "9", dropped: 3 });

	// The service hangs up: connected to again after the pause it asked for, saying which event was the last.
	const before = web.seen.length;
	web.hangUp();
	await until(() => web.seen.slice(before).filter((r) => r.url.startsWith("/events")).length === 4 && web.open.size === 4 && live.every((n) => /^connected since/.test(info(n).status ?? "")), 5000, "the streams to be connected again");
	assert.deepEqual(web.seen.slice(before).filter((r) => /^\/(events|moved)/.test(r.url)).map((r) => r.headers["last-event-id"]), ["9", "9", "9", "9", "9"], "four streams, one of them by way of a redirect");
	assert.equal(events("all").filter((e: any) => /down|up/.test(e.topic)).length, 0, "a hang-up that is mended is not an event");

	// It stops answering: said once, after three attempts, with a status anyone can read. Then it is back.
	web.state.status = 503;
	web.hangUp();
	await until(() => live.every((n) => events(n).some((e: any) => e.topic.endsWith("/down"))), 8000, "down to be reported");
	assert.deepEqual(events("all").filter((e: any) => e.topic.endsWith("/down")).map((e: any) => e.payload), [{ url: `${web.base}/moved`, error: "it answered 503" }]);
	assert.match(info("all").status!, /^cannot connect since \d\d:\d\d:\d\d \(\d+ attempts\): it answered 503$/);
	assert.equal(info("all").running, true, "a source that cannot connect right now is still there");
	web.state.status = 200;
	await until(() => live.every((n) => events(n).some((e: any) => e.topic.endsWith("/up"))), 10_000, "up to be reported");
	assert.equal(events("all").filter((e: any) => /down|up/.test(e.topic)).length, 2);
	assert.match(info("all").status!, /^connected since/);

	// What is not a stream says so, and what sends on to another host is not followed there.
	assert.match(info("page").status!, /cannot connect since .*it does not answer with an event stream\. If it is a page or a value to look at again and again, that is an "http" source$/);
	assert.match(info("away").status!, /cannot connect since .*it sends on to another address, which is not the one that was confirmed/);
	assert.equal(web.seen.filter((r) => r.host.startsWith("localhost")).length, 0);
	const everything = JSON.stringify([h.pine.bus.query({}), h.pine.sources.list()]);
	for (const secret of ["sse-secret-token-1", "sse-secret-token-2", "not-for-other-hosts"]) assert.ok(!everything.includes(secret), "a token is in no event and no status line");
	await h.close();
});

test("stream (WebSocket): says hello with the token, reports what is sent, and connects again when the line drops", async (t) => {
	const ws = await wsServer({ accept: (req) => !String(req.url).startsWith("/closed") });
	t.after(() => ws.close());
	// Port 1 of the loopback: nothing listens there, and no other test's server can take it meanwhile.
	const dead = 1;
	const h = await harness({
		pine: {
			sources: {
				ha: { ...always, url: `${ws.url}/api/websocket`, hello: [{ type: "auth", access_token: "{{token}}" }, { id: 1, type: "subscribe_events", event_type: "state_changed" }], token: 'ha-long-lived-"token"', path: "event.state" },
				door: { ...always, url: `${ws.url}/raw`, match: "door (open|closed)", changed: true, hello: "LISTEN doors" },
				keyed: { ...always, url: `${ws.url}/keyed`, kind: "websocket", token: "ws-header-token-xyz" },
				shut: { ...always, url: `${ws.url}/closed` },
				gone: { ...always, url: `ws://127.0.0.1:${dead}/x` },
			},
		},
		agents: { main: {} },
	});
	const events = (name: string): any[] => h.pine.bus.query({ topic: `source/${name}/#` }).sort((a: any, b: any) => a.id - b.id);
	const info = (name: string) => h.pine.sources.list().find((s) => s.name === name)!;
	const conn = (p: string) => ws.conns.findLast((c) => c.url === p && c.open)!;
	await until(() => ["ha", "door", "keyed"].every((n) => /^connected since/.test(info(n).status ?? "")) && conn("/api/websocket")?.received.length === 2 && conn("/raw")?.received.length === 1, 5000, "the sockets to be open");
	// The token is put where hello says, written the way JSON writes it, and is then not sent as a header too.
	assert.deepEqual(conn("/api/websocket").received, [{ type: "auth", access_token: 'ha-long-lived-"token"' }, { id: 1, type: "subscribe_events", event_type: "state_changed" }]);
	assert.equal(conn("/api/websocket").headers.authorization, undefined);
	assert.deepEqual(conn("/raw").received, ["LISTEN doors"]);
	assert.equal(conn("/keyed").headers.authorization, "Bearer ws-header-token-xyz");

	conn("/api/websocket").send({ type: "auth_ok" });
	conn("/api/websocket").send({ type: "event", event: { state: "home", entity: "person.anna" } });
	conn("/raw").send("door closed");
	conn("/raw").send("window open");
	conn("/raw").send("door closed");
	conn("/keyed").send("x".repeat(9000));
	await until(() => events("ha").length === 1 && events("keyed").length === 1, 3000, "the messages");
	assert.deepEqual(events("ha")[0].payload, { value: "home" });
	assert.equal(events("keyed")[0].payload.value.length, 4001, "a long message is cut");
	conn("/raw").send("door open");
	await until(() => events("door").length === 1, 3000, "the door's change");
	assert.deepEqual(events("door")[0].payload, { value: "open", previous: "closed" });
	// A ping of the service is answered.
	conn("/keyed").ping();
	await until(() => conn("/keyed").pongs === 1, 2000, "the pong");

	// The service closes, another time the line just drops: connected to again, hello said again.
	conn("/api/websocket").close(1001);
	conn("/raw").drop();
	await until(() => ws.conns.filter((c) => c.url === "/api/websocket").length === 2 && ws.conns.filter((c) => c.url === "/raw").length === 2 && conn("/api/websocket")?.received.length === 2 && conn("/raw")?.received.length === 1, 5000, "the sockets to be open again");
	await until(() => /^connected since/.test(info("ha").status ?? ""), 2000, "the status");
	conn("/api/websocket").send({ type: "event", event: { state: "away" } });
	await until(() => events("ha").length === 2, 3000, "a message on the new connection");
	assert.equal(events("ha").filter((e: any) => /down|up/.test(e.topic)).length, 0);

	// One that is there but takes no WebSocket, and one where nothing listens: said in words, reported once.
	await until(() => events("shut").some((e: any) => e.topic.endsWith("/down")) && events("gone").some((e: any) => e.topic.endsWith("/down")), 8000, "down to be reported");
	assert.match(info("shut").status!, /^cannot connect since \d\d:\d\d:\d\d \(\d+ attempts\): it is there but did not accept the WebSocket: a wrong path, or it wants a token$/);
	assert.match(info("gone").status!, /^cannot connect since .*: ECONNREFUSED$/);
	assert.deepEqual(events("gone").map((e: any) => e.payload), [{ url: `ws://127.0.0.1:${dead}/x`, error: "ECONNREFUSED" }]);
	const everything = JSON.stringify([h.pine.bus.query({}), h.pine.sources.list()]);
	for (const secret of ["ha-long-lived", "ws-header-token-xyz"]) assert.ok(!everything.includes(secret), "a token is in no event and no status line");
	await h.close();
	// The server hears of a closed connection a moment later.
	await until(() => ws.live().length === 0, 3000, "the connections to be closed");
	assert.equal(ws.live().length, 0, "a stopped source lets go of its connections");
});

test("stream: an address that is not said to be local stays on the public internet", async (t) => {
	const name = await privateName();
	if (!name) return t.skip("no name on this machine that leads to a private address without saying so");
	const guard = publicOnlyAgent(2000);
	t.after(() => guard.close());
	// The socket itself: refused before anything is sent, with a sentence that says what to do.
	await assert.rejects(wire(`wss://${name}:8443/x`, { guard, signal: new AbortController().signal, onMessage: () => {} }), /leads to an address on your own network\. If that is meant, set the source up again with "local": true/);
	const h = await harness({
		pine: { sources: { sock: { ...always, url: `wss://${name}:8443/x`, token: "never-sent-token-1" }, sse: { ...always, url: `https://${name}:8443/events`, token: "never-sent-token-2" } } },
		agents: { main: {} },
	});
	const info = (n: string) => h.pine.sources.list().find((s) => s.name === n)!;
	await until(() => /^cannot connect/.test(info("sock").status ?? "") && /^cannot connect/.test(info("sse").status ?? ""), 5000, "the refusals");
	assert.match(info("sock").status!, /leads to an address on your own network\. If that is meant, set the source up again with "local": true$/);
	assert.match(info("sse").status!, /the address leads into your own network\. If that is meant, set the source up again with "local": true$/);
	await h.close();
});

test("stream by asking: the type says what it will do, refuses what cannot work, and the token is typed into pine", async (t) => {
	const ws = await wsServer();
	t.after(() => ws.close());
	const h = await harness({ agents: { main: {} } });
	const asked: any[] = [];
	h.pine.bus.subscribe("approval/requested", (e) => {
		const r = e.payload as any;
		asked.push(r);
		h.pine.approvals.decide(r.id, true, "test", false, r.inputs?.length ? { token: "typed-by-the-owner-456" } : undefined);
	});
	const add = (name: string, options: any, more: any = {}) => call("add_source", { name, type: "stream", description: "x", options, ...more });
	const hello = [{ type: "auth", access_token: "{{token}}" }, { id: 1, type: "subscribe_events" }];
	const r = await h.pine.agents.run({
		agent: "main",
		prompt: mockMsg([
			{
				tools: [
					add("a", { url: "not an address" }),
					add("b", { url: "ftp://example.com/x" }),
					add("c", { url: "wss://user:pw@example.com/x" }),
					add("d", { url: "wss://example.com/x", kind: "sse" }),
					add("e", { url: "http://example.com/events" }),
					add("f", { url: "ws://example.com/socket" }),
					add("g", { url: "https://example.com/events", hello: "hi" }),
					add("i", { url: "wss://example.com/x", event: "update" }),
					add("j", { url: "wss://example.com/x", match: "(" }),
					add("k", { url: "wss://example.com/x", perMinute: 0 }),
					add("l", { url: "wss://example.com/x", headers: { Cookie: "a=b" } }),
					add("m", { url: "wss://example.com/x", hello: [1] }),
				],
			},
			{ tools: [add("home", { url: `${ws.url}/api/websocket`, hello, path: "event.data.new_state.state", changed: true }, { ask: ["token"] })] },
		]),
		...owner,
	});
	const refused = h.toolResults(h.mock.state.requests[1]);
	const expected = [
		/is not an address\. A stream's looks like https:\/\/ntfy\.sh\/mytopic\/sse or wss:\/\/example\.com\/socket/,
		/must start with https:\/\/, http:\/\/, wss:\/\/ or ws:\/\//,
		/user name or password in it is not taken/,
		/Server-Sent Events come from an https:\/\/ address/,
		/an address that is not on your own network must be https:\/\//,
		/an address that is not on your own network must be wss:\/\//,
		/"hello" is for a WebSocket/,
		/"event" is for Server-Sent Events/,
		/"match" is not a regular expression/,
		/"perMinute" is a number from 1 to 600/,
		/the header Cookie carries a secret: leave it out, name "token" in "ask" and give "tokenHeader": "cookie"/,
		/"hello" is one message or a list of messages/,
	];
	for (const [i, re] of expected.entries()) assert.match(refused[i], re);
	assert.equal(r.status, "done");
	assert.equal(asked.length, 1, "what cannot work is answered before the owner is asked anything");
	assert.match(asked[0].summary, /add event source "home" \(stream\)/);
	assert.ok(asked[0].summary.includes(`It will: stay connected to ${ws.url}/api/websocket (an address on your own network or this computer) over a WebSocket; send it 2 messages after connecting: [{"type":"auth","access_token":"{{token}}"},{"id":1,"type":"subscribe_events"}]; report the field event.data.new_state.state of each message whose value differs from the last one, at most 30 a minute.`), asked[0].summary);
	assert.deepEqual(asked[0].inputs.map((i: any) => i.name), ["token"]);
	assert.match(h.toolResults().at(-1)!, /Added the event source "home" \(stream\)\. It reports what the service sends from now on; nothing that was sent before\./);
	const entry = JSON.parse(fs.readFileSync(path.join(h.home, "agents", "main", "agent.json"), "utf8")).sources.home;
	assert.equal(entry.token, "${PINE_SOURCE_HOME_MAIN_TOKEN}");
	assert.equal(entry.kind, "websocket");
	assert.ok(!JSON.stringify(h.mock.state.requests).includes("typed-by-the-owner-456"), "the token never passes a model");
	// Nobody is subscribed, so nothing is connected yet: a source costs nothing until somebody listens.
	await sleep(150);
	assert.equal(ws.conns.length, 0);
	await h.pine.sources.subscribe("main", "home", { note: "Tell the owner who came home." });
	await until(() => ws.conns[0]?.received.length === 2, 4000, "hello, with the token the owner typed");
	assert.deepEqual(ws.conns[0].received[0], { type: "auth", access_token: "typed-by-the-owner-456" });
	await h.close();
});
