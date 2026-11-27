// The Durable Object that holds one machine id's meeting, on a stand-in for its state: sockets
// accepted for hibernation, with their attachments. Waking from hibernation is a new object on
// the same state, which has lost everything but the sockets.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOSE } from "../src/meet.ts";
import { Meeting, type HibernatingSocket } from "../src/meet-object.ts";
import { computerKey, ORIGIN } from "./meet-support.ts";

class Ws implements HibernatingSocket {
	sent: any[] = [];
	closed: { code?: number; reason?: string } | null = null;
	attachment: unknown = null;
	accepted: "plain" | null = null;
	accept() {
		this.accepted = "plain";
	}
	send(text: string) {
		if (this.closed) throw new Error("sent on a closed socket");
		this.sent.push(JSON.parse(text));
	}
	close(code?: number, reason?: string) {
		this.closed ??= { code, reason };
	}
	serializeAttachment(value: unknown) {
		if (this.closed) throw new Error("closed");
		this.attachment = structuredClone(value);
	}
	deserializeAttachment() {
		return structuredClone(this.attachment);
	}
}

function state() {
	const sockets: Ws[] = [];
	return {
		sockets,
		acceptWebSocket(ws: Ws) {
			sockets.push(ws);
		},
		getWebSockets() {
			return sockets.filter((ws) => !ws.closed);
		},
	};
}

function object(ctx: ReturnType<typeof state>, options = {}) {
	let last: Ws;
	const upgrade = () => {
		last = new Ws();
		return { socket: last, response: new Response(null, { status: 200, headers: { "x-upgraded": "1" } }) };
	};
	const meeting = new Meeting(ctx as any, {}, upgrade, options);
	const open = async (path: string, id: string) => {
		const response = await meeting.fetch(new Request(`${ORIGIN}${path}?id=${id}`, { headers: { Upgrade: "websocket" } }));
		return { response, ws: last };
	};
	return { meeting, open };
}

async function waiting(ctx: ReturnType<typeof state>, key = computerKey()) {
	const o = object(ctx);
	const { ws } = await o.open("/meet/host", key.id);
	const { nonce } = ws.sent[0];
	await o.meeting.webSocketMessage(ws, key.proof(nonce));
	assert.deepEqual(ws.sent.at(-1), { t: "waiting" });
	return { ws, key, o };
}

test("a computer proves its key over the object's socket, and a browser is put through", async () => {
	const ctx = state();
	const computer = await waiting(ctx);
	const { response, ws: browser } = await computer.o.open("/meet/join", computer.key.id);
	assert.equal(response.headers.get("x-upgraded"), "1");
	assert.deepEqual(browser.sent, [{ t: "ready" }]);
	const { s } = computer.ws.sent.at(-1);
	await computer.o.meeting.webSocketMessage(browser, JSON.stringify({ t: "signal", d: { sdp: { type: "offer", sdp: "o" } } }));
	assert.deepEqual(computer.ws.sent.at(-1), { t: "signal", s, d: { sdp: { type: "offer", sdp: "o" } } });
});

test("a computer keeps waiting across hibernation: a woken object finds it from its socket alone", async () => {
	const ctx = state();
	const computer = await waiting(ctx);
	const woken = object(ctx);
	const { ws: browser } = await woken.open("/meet/join", computer.key.id);
	assert.deepEqual(browser.sent, [{ t: "ready" }]);
	const { s } = computer.ws.sent.at(-1);
	// And an answer from the computer reaches the browser through yet another waking.
	const again = object(ctx);
	await again.meeting.webSocketMessage(computer.ws, JSON.stringify({ t: "signal", s, d: { sdp: { type: "answer", sdp: "a" } } }));
	assert.deepEqual(browser.sent.at(-1), { t: "signal", d: { sdp: { type: "answer", sdp: "a" } } });
});

test("a session's time limit holds after hibernation, when no timer is left to end it", async () => {
	const ctx = state();
	const computer = await waiting(ctx);
	const before = object(ctx);
	const { ws: browser } = await before.open("/meet/join", computer.key.id);
	const later = Date.now() + 31_000;
	const woken = object(ctx, { now: () => later });
	await woken.meeting.webSocketMessage(browser, JSON.stringify({ t: "signal", d: { ice: { candidate: "c", sdpMid: "0", sdpMLineIndex: 0 } } }));
	assert.equal(browser.closed?.code, CLOSE.timeout);
});

test("a browser that closes is told to the computer, and the object answers the close", async () => {
	const ctx = state();
	const computer = await waiting(ctx);
	const { ws: browser } = await computer.o.open("/meet/join", computer.key.id);
	const { s } = computer.ws.sent.at(-1);
	await computer.o.meeting.webSocketClose(browser, 1001, "gone", true);
	assert.deepEqual(computer.ws.sent.at(-1), { t: "close", s });
});

test("the object keeps no storage: everything it knows is on its sockets", async () => {
	const ctx = state();
	const storage = new Proxy({}, { get: () => assert.fail("storage was used") });
	(ctx as any).storage = storage;
	const computer = await waiting(ctx);
	await computer.o.open("/meet/join", computer.key.id);
});

test("a browser with no computer waiting is refused on a socket that is not kept for hibernation", async () => {
	const ctx = state();
	const o = object(ctx);
	const { ws } = await o.open("/meet/join", computerKey().id);
	assert.equal(ws.closed?.code, CLOSE.absent);
	assert.equal(ws.accepted, "plain");
	assert.equal(ctx.sockets.length, 0);
});

test("a request that is not a WebSocket upgrade to a meeting route is refused", async () => {
	const o = object(state());
	const key = computerKey();
	assert.equal((await o.meeting.fetch(new Request(`${ORIGIN}/meet/host?id=${key.id}`))).status, 426);
	assert.equal((await o.meeting.fetch(new Request(`${ORIGIN}/meet/host?id=short`, { headers: { Upgrade: "websocket" } }))).status, 400);
});
