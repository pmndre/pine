// The page's Web Storage in its iframe: its opaque origin keeps nothing, so what the page writes
// under its own keys is handed to the web bridge (which keeps it with the preferences) and given
// back when the page loads again.
import assert from "node:assert/strict";
import { test } from "node:test";
import { keptStorage } from "./page-storage.ts";

const settle = () => new Promise((r) => setTimeout(r, 30));

test("what the bridge kept is there when the page starts", () => {
	const s = keptStorage({ "pine.sidebar.width": "300" }, () => {}, 5);
	assert.equal(s.getItem("pine.sidebar.width"), "300");
	assert.equal(s.getItem("pine.aside"), null);
	assert.equal(s.length, 1);
});

test("changes under the page's keys are handed over, all of them at once, after a short pause", async () => {
	const saved: Record<string, string>[] = [];
	const s = keptStorage({ "pine.aside": "hidden" }, (all) => saved.push(all), 5);
	s.setItem("pine.aside", "shown");
	s.setItem("pine.aside.width", 420 as unknown as string);
	s.setItem("pine.folded", '["main"]');
	s.removeItem("pine.folded");
	await settle();
	assert.deepEqual(saved, [{ "pine.aside": "shown", "pine.aside.width": "420" }]);
});

test("a key that is not the page's own stays for the page's life and is not handed over", async () => {
	const saved: Record<string, string>[] = [];
	const s = keptStorage({}, (all) => saved.push(all), 5);
	s.setItem("other", "x");
	await settle();
	assert.equal(s.getItem("other"), "x");
	assert.deepEqual(saved, []);
});
