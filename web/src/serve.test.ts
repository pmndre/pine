// The web bridge's door: what the page asks through its `window.pine` reaches the bridge, and
// nothing else does. The bridge here records what reaches it; host.test.ts has the real one.
import assert from "node:assert/strict";
import test from "node:test";
import { door, tick } from "../testing/door.ts";
import type { FakeWindow } from "../testing/windows.ts";

/** Waits until `done()` holds, or a second has gone by (the assertions after it then say what is missing). */
async function until(done: () => boolean): Promise<void> {
	for (let waited = 0; !done() && waited < 1000; waited += 10) await tick();
}

/** What the frame hears from the top, as it arrives. */
function heard(frame: FakeWindow) {
	const said: any[] = [];
	frame.addEventListener("message", (e) => said.push(e.data));
	return said;
}

test("a call of the page's bridge reaches the web bridge, and its answer comes back", async () => {
	const { page, calls } = door();
	assert.equal(await page.call("POST", "/agents/main/message", { text: "hi" }), "answer of call");
	assert.deepEqual(calls, [["call", ["POST", "/agents/main/message", { text: "hi" }]]]);
});

test("a message from any window but the page's frame is ignored, and nothing is said back", async () => {
	const { topFromStranger, stranger, calls } = door();
	const said = heard(stranger);
	topFromStranger.postMessage({ pine: "call", id: 1, method: "call", args: ["GET", "/agents"] }, "*");
	topFromStranger.postMessage({ pine: "call", id: 2, method: "deviceKey", args: [] }, "*");
	await tick();
	assert.deepEqual(calls, []);
	assert.deepEqual(said, []);
});

test("a method that is not on the list is refused, whatever its name", async () => {
	const { parentOfFrame, frame, calls } = door();
	const said = heard(frame);
	for (const [id, method] of [[1, "eval"], [2, "constructor"], [3, "__proto__"], [4, "toString"], [5, "on"], [6, "voiceStart"]] as const) parentOfFrame.postMessage({ pine: "call", id, method, args: [] }, "*");
	await tick();
	assert.deepEqual(calls, []);
	assert.equal(said.length, 6);
	for (const reply of said) assert.match(reply.error, /not something the web bridge does/);
});

test("arguments that are not what a method takes are refused before the bridge sees them", async () => {
	const { parentOfFrame, frame, calls } = door();
	const said = heard(frame);
	const bad: [string, unknown[]][] = [
		["call", ["DELETE", "/agents"]],
		["call", ["GET", "//elsewhere.example/"]],
		["call", ["GET", "https://elsewhere.example/"]],
		// The path goes into a request line of HTTP/1.1 at the top: a break there would add headers and a second request.
		["call", ["GET", "/x HTTP/1.1\r\nX-Injected: 1\r\n\r\nGET /y"]],
		["call", ["GET", "/agents\nX: 1"]],
		["call", ["GET", "/agents x"]],
		["call", ["GET", "/agents\0"]],
		["call", ["GET", "/agents\x7f"]],
		["call", ["GET", "/agents#x"]],
		["call", ["GET"]],
		["prefs", ["notify"]],
		["prefs", [[]]],
		["use", [42]],
		["addHost", [{ host: "me@box" }]],
		["addHost", ["x".repeat(400)]],
		["trustHostKey", ["me@box", "MD5:aa"]],
		["state", ["more"]],
	];
	bad.forEach(([method, args], id) => parentOfFrame.postMessage({ pine: "call", id, method, args }, "*"));
	parentOfFrame.postMessage({ pine: "call", id: 99, method: "call" }, "*");
	await until(() => said.length >= bad.length + 1);
	assert.deepEqual(calls, []);
	assert.equal(said.length, bad.length + 1);
	for (const reply of said) assert.match(reply.error, /arguments/);
});

test("what the bridge tells reaches the page's listeners", async () => {
	const { page, emit } = door();
	const service: unknown[] = [];
	const events: unknown[] = [];
	page.onService((s: unknown) => service.push(s));
	page.onEvents((e: unknown) => events.push(e));
	emit("service", { status: "starting", host: "me@box" });
	emit("events", [{ topic: "a" }]);
	await tick();
	assert.deepEqual(service, [{ status: "starting", host: "me@box" }]);
	assert.deepEqual(events, [[{ topic: "a" }]]);
});
