// The way between the page in its iframe and the web bridge at the top: what the page asks
// through its `window.pine` reaches the bridge, and nothing else does. The bridge here records
// what reaches it; test/bridge.test.ts has the real one.
import assert from "node:assert/strict";
import test from "node:test";
import { frameBridge } from "../src/frame-bridge.ts";
import { serve, type Served } from "../src/serve.ts";
import { windows, type FakeWindow } from "./support/windows.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
/** Waits until `done()` holds, or a second has gone by (the assertions after it then say what is missing). */
async function until(done: () => boolean): Promise<void> {
	for (let waited = 0; !done() && waited < 1000; waited += 10) await tick();
}

/** A bridge that records each call and answers with its name. */
function recorder() {
	const calls: [string, unknown[]][] = [];
	const listeners = new Map<string, Set<(value: unknown) => void>>();
	const bridge = new Proxy({} as Served, {
		get: (_t, name: string) => {
			if (name === "on")
				return (event: string, fn: (value: unknown) => void) => {
					const set = listeners.get(event) ?? new Set();
					listeners.set(event, set.add(fn));
				};
			return async (...args: unknown[]) => {
				calls.push([name, args]);
				return `answer of ${name}`;
			};
		},
	});
	const emit = (event: string, value: unknown) => listeners.get(event)?.forEach((fn) => fn(value));
	return { bridge, calls, emit };
}

function setUp() {
	const w = windows();
	const { bridge, calls, emit } = recorder();
	serve(bridge, w.top, () => w.frame);
	const page = frameBridge(w.parentOfFrame, w.frame);
	return { ...w, page, calls, emit };
}

/** What the frame hears from the top, as it arrives. */
function heard(frame: FakeWindow) {
	const said: any[] = [];
	frame.addEventListener("message", (e) => said.push(e.data));
	return said;
}

test("a call of the page's bridge reaches the web bridge, and its answer comes back", async () => {
	const { page, calls } = setUp();
	assert.equal(await page.call("POST", "/agents/main/message", { text: "hi" }), "answer of call");
	assert.deepEqual(calls, [["call", ["POST", "/agents/main/message", { text: "hi" }]]]);
});

test("a message from any window but the page's frame is ignored, and nothing is said back", async () => {
	const { topFromStranger, stranger, calls } = setUp();
	const said = heard(stranger);
	topFromStranger.postMessage({ pine: "call", id: 1, method: "call", args: ["GET", "/agents"] }, "*");
	topFromStranger.postMessage({ pine: "call", id: 2, method: "deviceKey", args: [] }, "*");
	await tick();
	assert.deepEqual(calls, []);
	assert.deepEqual(said, []);
});

test("a method that is not on the list is refused, whatever its name", async () => {
	const { parentOfFrame, frame, calls } = setUp();
	const said = heard(frame);
	for (const [id, method] of [[1, "eval"], [2, "constructor"], [3, "__proto__"], [4, "toString"], [5, "on"], [6, "voiceStart"]] as const) parentOfFrame.postMessage({ pine: "call", id, method, args: [] }, "*");
	await until(() => said.length >= 6);
	assert.deepEqual(calls, []);
	assert.equal(said.length, 6);
	for (const reply of said) assert.ok(typeof reply.error === "string" && reply.error.length > 0 && !("value" in reply), `refused with an error and no value: ${JSON.stringify(reply)}`);
});

test("arguments that are not what a method takes are refused before the bridge sees them", async () => {
	const { parentOfFrame, frame, calls } = setUp();
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
		["renameHost", ["me@box"]],
		["renameHost", ["me@box", 7]],
		["renameHost", [{}, "name"]],
		["renameHost", ["me@box", "x".repeat(300)]],
		["state", ["more"]],
	];
	bad.forEach(([method, args], id) => parentOfFrame.postMessage({ pine: "call", id, method, args }, "*"));
	parentOfFrame.postMessage({ pine: "call", id: 99, method: "call" }, "*");
	await until(() => said.length >= bad.length + 1);
	assert.deepEqual(calls, []);
	assert.equal(said.length, bad.length + 1);
	for (const reply of said) assert.ok(typeof reply.error === "string" && reply.error.length > 0 && !("value" in reply), `refused with an error and no value: ${JSON.stringify(reply)}`);
});

test("what the bridge tells reaches the page's listeners", async () => {
	const { page, emit } = setUp();
	const service: unknown[] = [];
	const events: unknown[] = [];
	page.onService((s: unknown) => service.push(s));
	page.onEvents((e: unknown) => events.push(e));
	emit("service", { status: "starting", host: "me@box" });
	emit("events", [{ topic: "a" }]);
	await until(() => service.length > 0 && events.length > 0);
	assert.deepEqual(service, [{ status: "starting", host: "me@box" }]);
	assert.deepEqual(events, [[{ topic: "a" }]]);
});

test("the page hears only its parent: a message from elsewhere that looks like an answer is dropped", async () => {
	const { page, frame, stranger } = setUp();
	const service: unknown[] = [];
	page.onService((s: unknown) => service.push(s));
	frame.deliver({ pine: "event", event: "service", value: { status: "ready" } }, stranger);
	await tick();
	assert.deepEqual(service, []);
});

test("the page has no machine of its own and refuses what only the desktop app does, without asking the bridge", async () => {
	const { page, calls } = setUp();
	await assert.rejects(page.termOpen("a", undefined, 80, 24));
	await assert.rejects(page.voiceStart());
	await assert.rejects(page.restart());
	assert.deepEqual(calls, []);
});
