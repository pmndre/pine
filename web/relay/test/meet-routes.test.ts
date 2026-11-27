// The Worker's routes for the meeting service and the relay's switch: /meet/config, the two
// WebSocket routes handed to one Durable Object per machine id, the per-address limit on them,
// and /ssh only while the relay is on.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOSE, DEFAULT_ICE } from "../src/meet.ts";
import { site, type SiteEnv } from "../src/site.ts";
import { limiter, pairs } from "./support.ts";
import { computerKey } from "./meet-support.ts";

const ASSETS = { fetch: async () => new Response("asset", { headers: { "content-type": "text/plain" } }) };

/** The Durable Object namespace: notes which object each request went to. */
function namespace() {
	const calls: { name: string; path: string }[] = [];
	return {
		calls,
		idFromName: (name: string) => ({ name }),
		get: (id: { name: string }) => ({
			fetch: async (request: Request) => (calls.push({ name: id.name, path: new URL(request.url).pathname }), new Response("to the object", { status: 200 })),
		}),
	};
}

function setup(env: Partial<SiteEnv> = {}, limit = 100) {
	const relayed: string[] = [];
	const { clients, upgrade } = pairs();
	const MEET = namespace();
	const handle = site({ relay: async (request) => (relayed.push(new URL(request.url).pathname), new Response("relayed")), upgrade });
	const full = { ASSETS, LIMITER: limiter(limit), MEET, RELAY: "on", ...env } as SiteEnv;
	const go = (path: string, init: RequestInit = {}, ip = "198.51.100.1") => handle(new Request(`https://pine.example${path}`, { ...init, headers: { "CF-Connecting-IP": ip, ...init.headers } }), full);
	const ws = (path: string, ip?: string) => go(path, { headers: { Upgrade: "websocket" } }, ip);
	return { relayed, clients, MEET, go, ws };
}

test("/meet/config answers the helping servers from the configuration, and whether the relay is on", async () => {
	const ice = [{ urls: ["stun:stun.example.org:3478", "stun:stun2.example.org:19302"] }];
	const r = await setup({ ICE: ice }).go("/meet/config");
	assert.equal(r.status, 200);
	assert.match(r.headers.get("content-type") ?? "", /application\/json/);
	assert.deepEqual(await r.json(), { ice, relay: true });
	assert.deepEqual(await (await setup({ RELAY: "off" }).go("/meet/config")).json(), { ice: DEFAULT_ICE, relay: false });
});

test("without helping servers in the configuration, or with ones that are not, a public STUN server is answered", async () => {
	for (const ICE of [undefined, [], [{ urls: "http://not.stun" }], "stun:x", [{}]]) {
		const body = (await (await setup({ ICE } as any).go("/meet/config")).json()) as any;
		assert.deepEqual(body.ice, DEFAULT_ICE, JSON.stringify(ICE));
		assert.match(body.ice[0].urls, /^stun:/);
	}
});

test("a computer and a browser that name the same id reach the same object", async () => {
	const t = setup();
	const { id } = computerKey();
	assert.equal(await (await t.ws(`/meet/host?id=${id}`)).text(), "to the object");
	assert.equal(await (await t.ws(`/meet/join?id=${id}`)).text(), "to the object");
	assert.deepEqual(t.MEET.calls, [
		{ name: id, path: "/meet/host" },
		{ name: id, path: "/meet/join" },
	]);
});

test("a meeting route without an upgrade or without a machine id reaches no object", async () => {
	const t = setup();
	const { id } = computerKey();
	assert.equal((await t.go(`/meet/host?id=${id}`)).status, 426);
	for (const bad of ["", "?id=", "?id=short", `?id=${id}x`, `?id=${id.slice(0, 42)}+`]) assert.equal((await t.ws(`/meet/join${bad}`)).status, 400, bad);
	assert.deepEqual(t.MEET.calls, []);
});

test("over the per-address limit, a meeting socket is closed with the over-limits code, and another address still gets through", async () => {
	const t = setup({}, 2);
	const { id } = computerKey();
	await t.ws(`/meet/join?id=${id}`, "203.0.113.9");
	await t.go("/meet/config", {}, "203.0.113.9");
	const over = await t.ws(`/meet/join?id=${id}`, "203.0.113.9");
	assert.equal(over.headers.get("x-upgraded"), "1");
	assert.equal((await t.clients[0].closes()).code, CLOSE.limits);
	assert.equal((await t.go("/meet/config", {}, "203.0.113.9")).status, 429);
	assert.equal(await (await t.ws(`/meet/join?id=${id}`, "203.0.113.10")).text(), "to the object");
	assert.equal(t.MEET.calls.length, 2);
});

test("without the meeting's binding, the meeting routes are not there, and the rest is as before", async () => {
	const t = setup({ MEET: undefined });
	const { id } = computerKey();
	for (const path of ["/meet/config", `/meet/host?id=${id}`, `/meet/join?id=${id}`]) {
		assert.equal((await t.go(path)).status, 404, path);
		assert.equal((await t.ws(path)).status, 404, path);
	}
	assert.equal(t.clients.length, 0);
	assert.deepEqual(t.MEET.calls, []);
	assert.equal(await (await t.go("/ssh?host=a&port=22")).text(), "relayed");
	assert.equal(await (await t.go("/")).text(), "asset");
});

test("with the relay on, /ssh is the relay as before", async () => {
	const t = setup({ RELAY: "on" });
	assert.equal(await (await t.go("/ssh?host=a&port=22")).text(), "relayed");
	assert.deepEqual(t.relayed, ["/ssh"]);
});

test("with the relay off, or not said to be on, /ssh is refused and never reaches the relay", async () => {
	for (const RELAY of ["off", undefined, "", "On", "1"]) {
		const t = setup({ RELAY });
		const r = await t.ws("/ssh?host=a&port=22");
		assert.equal(r.status, 404, String(RELAY));
		assert.match(await r.text(), /relay/, "it is the relay that is said to be off, not the address that is unknown");
		assert.deepEqual(t.relayed, []);
	}
});
