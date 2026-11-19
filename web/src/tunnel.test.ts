// The control API over the SSH connection: what never becomes a request, and a daemon that never answers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { callDaemon } from "./tunnel.ts";

test("a control API call whose path would break its request line is answered 400, and nothing is sent", async () => {
	const forwarded: string[] = [];
	const connection = {
		forward: async (host: string, port: number) => {
			forwarded.push(`${host}:${port}`);
			throw new Error("no tunnel in this test");
		},
	};
	const stand = { connection, host: "127.0.0.1", port: 1, token: "secret" } as unknown as Parameters<typeof callDaemon>[0];
	for (const bad of ["/x HTTP/1.1\r\nX-Injected: 1\r\n\r\nGET /y", "/agents\nX: 1", "/agents x", "/agents\tx", "/agents\0", "/agents\x7f", "/agents#x"]) {
		const answer = await callDaemon(stand, "GET", bad);
		assert.deepEqual(answer, { ok: false, status: 400, data: { error: "not a call of the control API" } }, JSON.stringify(bad));
	}
	assert.deepEqual(forwarded, []);
	assert.equal((await callDaemon(stand, "GET", "/agents")).status, 0);
	assert.deepEqual(forwarded, ["127.0.0.1:1"]);
});

test("a control API call the daemon takes and never answers ends after the time limit, with what to do, and its channel is closed", async () => {
	let closed = false;
	const channel = {
		onData: () => {},
		onStderr: () => {},
		send: async () => {},
		close: async () => void (closed = true),
		closed: new Promise(() => {}),
	};
	const stand = { connection: { forward: async () => channel }, host: "127.0.0.1", port: 1, token: "secret" } as unknown as Parameters<typeof callDaemon>[0];
	const started = Date.now();
	const answer = await callDaemon(stand, "GET", "/agents", undefined, 50);
	assert.ok(Date.now() - started < 1000);
	assert.equal(answer.ok, false);
	assert.equal(answer.status, 0);
	assert.match(answer.data.error, /^pine does not answer \(.+\)/);
	assert.match(answer.data.error, /Disconnect/);
	assert.equal(closed, true);
});
