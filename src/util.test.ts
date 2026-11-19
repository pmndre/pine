import assert from "node:assert/strict";
import { test } from "node:test";
import { callTiming, matchWhen, parseDuration, render, renderDeep, speedOf, speedText, topicMatches } from "./util.ts";

test("topic patterns follow MQTT rules", () => {
	assert.ok(topicMatches("cam/+/motion", "cam/front/motion"));
	assert.ok(!topicMatches("cam/+/motion", "cam/front/door/motion"));
	assert.ok(topicMatches("cam/#", "cam/front/door/motion"));
	assert.ok(topicMatches("cam/#", "cam"));
	assert.ok(topicMatches("#", "anything/at/all"));
	assert.ok(!topicMatches("cam/front", "cam/front/motion"));
});

test("templates and filters", () => {
	const ctx = { payload: { text: "hi", n: 3, nested: { a: [1, 2] } }, topic: "t/x" };
	assert.equal(render("{{payload.text}} on {{topic}} {{payload.missing}}|{{payload.nested}}", ctx), 'hi on t/x |{"a":[1,2]}');
	assert.deepEqual(renderDeep({ a: "{{payload.n}}", b: ["x{{payload.n}}"] }, ctx), { a: 3, b: ["x3"] });
	assert.ok(matchWhen({ "payload.n": 3, "payload.text": { regex: "^h" } }, ctx));
	assert.ok(!matchWhen({ "payload.n": { gt: 3 } }, ctx));
	assert.ok(matchWhen({ "payload.missing": { exists: false }, "payload.n": { in: [1, 3] } }, ctx));
	assert.equal(parseDuration("15m"), 900_000);
});

test("a model call is split at its first token into reading the prompt and writing, and a half that says nothing is left out", () => {
	// 18000 new tokens read in 12 s, then 420 written in 10 s.
	const call = callTiming(18_000, 420, 1000, 13_000, 23_000);
	assert.deepEqual(call, { readTokens: 18_000, readMs: 12_000, writeTokens: 420, writeMs: 10_000 });
	assert.deepEqual(speedOf(call), { read: 1500, write: 42 });
	assert.equal(speedText(speedOf(call)), "↑ 1.5k t/s ↓ 42 t/s");
	// After a cache hit the few new tokens measure the round trip, not the model: only the writing counts.
	assert.deepEqual(speedOf(callTiming(17, 420, 1000, 1300, 11_300)), { write: 42 });
	assert.equal(speedText({ write: 8.44 }), "↓ 8.4 t/s");
	// An answer that arrived in one piece, or was a few tokens, has no speed.
	assert.deepEqual(speedOf(callTiming(18_000, 420, 1000, 0, 13_000)), { read: 1500 }, "no token was seen before the end: all of it was waiting");
	assert.deepEqual(speedOf(callTiming(18_000, 3, 1000, 13_000, 13_900)), { read: 1500 });
	assert.deepEqual(speedOf(callTiming(120, 4, 1000, 1010, 1020)), {});
	assert.equal(speedText({}), "");
	assert.equal(speedText(undefined), "");
	assert.equal(speedText({ read: 23_456, write: 150.4 }), "↑ 23k t/s ↓ 150 t/s");
	// Several calls of a task: tokens over time, not the mean of the rates.
	const sum = { readTokens: 18_000 + 2000, readMs: 12_000 + 8000, writeTokens: 420 + 80, writeMs: 10_000 + 10_000 };
	assert.deepEqual(speedOf(sum), { read: 1000, write: 25 });
});
