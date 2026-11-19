import assert from "node:assert/strict";
import { test } from "node:test";
import { harness, sleep } from "../testing/harness.ts";

test("events are stored, delivered by pattern, and a failing subscriber does not affect others", async () => {
	const h = await harness({ agents: { main: {} } });
	const { bus } = h.pine;
	const seen: string[] = [];
	bus.subscribe("cam/+/motion", () => {
		throw new Error("boom");
	});
	bus.subscribe("cam/#", (e) => void seen.push(e.topic));
	const first = bus.publish("cam/front/motion", { n: 1 }, { source: "test" });
	const second = bus.publish("cam/front/idle", { n: 2 }, { source: "test", cause: first, hop: true });
	bus.publish("telemetry/x", 1, { persist: false });
	await bus.drain();
	assert.deepEqual(seen, ["cam/front/motion", "cam/front/idle"]);
	assert.equal(second.cause, first.id);
	assert.equal(second.hops, 1);
	assert.equal(first.trust, "untrusted");
	assert.deepEqual(bus.query({ topic: "cam/#" }).map((e) => e.id), [first.id, second.id]);
	assert.equal(bus.query({ topic: "telemetry/#" }).length, 0);
	assert.throws(() => bus.publish("cam/+/x"));
	assert.ok(h.logs.some((l) => l.includes("boom")));
	await h.close();
});

test("shared state: writes are events, deletes work, patterns list", async () => {
	const h = await harness({ agents: { main: {} } });
	const { state, bus } = h.pine;
	state.set("house/mode", "away", { source: "test" });
	state.set("house/mode", "away", { source: "test" }); // unchanged: no second event
	state.set("house/door", { open: true });
	assert.equal(state.get("house/mode"), "away");
	assert.deepEqual(state.list("house/#").map((s) => s.key), ["house/door", "house/mode"]);
	assert.equal(bus.query({ topic: "state/house/mode" }).length, 1);
	state.set("house/door", null);
	assert.equal(state.get("house/door"), undefined);
	await sleep(10);
	await h.close();
});
