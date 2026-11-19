import assert from "node:assert/strict";
import { test } from "node:test";
import { Limiter } from "./limiter.ts";

test("the limiter orders by priority and lends a slot while a run waits for others", async () => {
	const lim = new Limiter(1);
	const order: string[] = [];
	const parent = await lim.acquire(0);
	const low = lim.acquire(0).then((s) => (order.push("low"), s.release()));
	const high = lim.acquire(5).then((s) => (order.push("high"), s.release()));
	// The parent waits for two "children" at once; both need the single slot.
	await parent.suspend(async () => {
		await Promise.all([low, high]);
	});
	assert.deepEqual(order, ["high", "low"]);
	assert.equal(lim.stats.active, 1);
	parent.release();
	assert.equal(lim.stats.active, 0);
});
