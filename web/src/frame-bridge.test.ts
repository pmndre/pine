// The page's bridge in its iframe: it hears only its parent, and what only the desktop app does is
// refused without asking the web bridge.
import assert from "node:assert/strict";
import test from "node:test";
import { door, tick } from "../testing/door.ts";

test("the page hears only its parent: a message from elsewhere that looks like an answer is dropped", async () => {
	const { page, frame, stranger } = door();
	const service: unknown[] = [];
	page.onService((s: unknown) => service.push(s));
	frame.deliver({ pine: "event", event: "service", value: { status: "ready" } }, stranger);
	await tick();
	assert.deepEqual(service, []);
});

test("the page has no machine of its own and refuses what only the desktop app does, without asking the bridge", async () => {
	const { page, calls } = door();
	await assert.rejects(page.termOpen("a", undefined, 80, 24), /desktop app/);
	await assert.rejects(page.voiceStart(), /Mac/);
	await assert.rejects(page.restart(), /machine/);
	assert.deepEqual(calls, []);
});
