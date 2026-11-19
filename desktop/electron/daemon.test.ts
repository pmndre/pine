// What the app's main process asks the daemon for on the page's behalf (electron/daemon.ts), on a
// stand-in for the daemon on a loopback port. No window.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { callDaemon, followEvents, MEDIA, mediaFromDaemon, pageCsp } from "./daemon.ts";

const TOKEN = "secret-token";
const seen: Array<{ method?: string; url?: string; auth?: string; body: string }> = [];
let server: http.Server;
let daemon: { base: string; token: string };

before(async () => {
	server = http.createServer((req, res) => {
		let body = "";
		req.on("data", (c) => (body += c));
		req.on("end", () => {
			seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
			if (req.url === "/agents") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify([{ id: "main" }]));
			if (req.url === "/echo") return void res.writeHead(201, { "content-type": "application/json" }).end(body);
			if (req.url === "/media/tool/pic") return void res.writeHead(200, { "content-type": "image/png" }).end("PNG");
			if (req.url === "/media/tool/page") return void res.writeHead(200, { "content-type": "text/html" }).end("<script></script>");
			if (req.url?.startsWith("/events/stream")) {
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.write('data: {"n":1}\n\n: comment\n\ndata: not json\n\n');
				res.write('data: {"n":2}\n\n');
				return;
			}
			res.writeHead(404).end();
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	daemon = { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token: TOKEN };
});
after(() => {
	server.closeAllConnections();
	server.close();
});

test("a call reaches the daemon with the token and returns its JSON", async () => {
	assert.deepEqual(await callDaemon(daemon, "GET", "/agents"), { ok: true, status: 200, data: [{ id: "main" }] });
	assert.equal(seen.at(-1)?.auth, `Bearer ${TOKEN}`);
	assert.deepEqual(await callDaemon(daemon, "POST", "/echo", { a: 1 }), { ok: true, status: 201, data: { a: 1 } });
});

test("a call that is not one of the control API reaches nothing", async () => {
	const before = seen.length;
	for (const [method, url] of [["DELETE", "/agents"], ["GET", "//evil.example/x"], ["GET", "agents"], ["GET", 42]] as const) {
		const r = await callDaemon(daemon, method, url as string);
		assert.equal(r.status, 400);
	}
	assert.equal((await callDaemon(undefined, "GET", "/agents")).status, 503);
	assert.equal(seen.length, before);
});

test("media: only the listed paths, and only what is drawn or played", async () => {
	assert.ok(MEDIA.some((m) => m.test("/media/tool/pic")));
	const ok = await mediaFromDaemon(daemon, "GET", "/media/tool/pic", "");
	assert.equal(ok.status, 200);
	assert.equal(await ok.text(), "PNG");
	assert.equal((await mediaFromDaemon(daemon, "GET", "/agents", "")).status, 404);
	assert.equal((await mediaFromDaemon(daemon, "POST", "/media/tool/pic", "")).status, 404);
	assert.equal((await mediaFromDaemon(daemon, "GET", "/media/tool/page", "")).status, 415);
});

test("the event stream comes in batches, malformed frames skipped", async () => {
	const abort = new AbortController();
	const got: unknown[] = [];
	const up: boolean[] = [];
	await new Promise<void>((done) => {
		followEvents(daemon, abort.signal, {
			batch: (events) => {
				got.push(...events);
				if (got.length === 2) done();
			},
			connection: (on) => up.push(on),
		});
	});
	abort.abort();
	assert.deepEqual(got, [{ n: 1 }, { n: 2 }]);
	assert.deepEqual(up, [true]);
});

test("the page's CSP loads nothing from the web, and names the media source it is given", () => {
	assert.match(pageCsp(), /img-src 'self' data: blob: pine-media:/);
	assert.match(pageCsp(), /connect-src 'self'(;|$)/);
	// Served from the page's own origin (the preview), media need no source of their own.
	const dev = pageCsp({ media: [], connect: ["ws://localhost:5173"] });
	assert.match(dev, /media-src 'self' blob:;/);
	assert.match(dev, /connect-src 'self' ws:\/\/localhost:5173/);
	assert.doesNotMatch(dev, /pine-media:/);
	assert.match(pageCsp({ script: ["'nonce-abc'"] }), /script-src 'self' 'nonce-abc';/);
});
