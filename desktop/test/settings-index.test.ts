// The search of Settings, without a window: that every place its index names is still drawn by a page, and
// that what fits comes first. The pages are not run here: each place's selector is looked for in their source,
// so that a renamed or removed part fails this test instead of being silently never found.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { AGENT_PLACES, entries, PLACES, search, type Shown } from "../src/settings-index.ts";

const src = path.join(import.meta.dirname, "../src");
const pages = ["Settings.tsx", "BrowserAccess.tsx"].map((f) => fs.readFileSync(path.join(src, f), "utf8")).join("\n");
const all: Shown = { local: true, updates: true, selfUpdate: true, access: true };

/** `[data-find="x"]` or `[data-setting=x]` as it is written in a page's markup: `data-find="x"`. */
const markup = (selector: string) => {
	const m = /^\[(data-[\w-]+)="?([^"\]]+)"?\]$/.exec(selector);
	assert.ok(m, `a selector of one attribute: ${selector}`);
	return `${m[1]}="${m[2]}"`;
};

test("every place the search names is drawn by a page", () => {
	for (const p of PLACES) if (p.find) assert.ok(pages.includes(markup(p.find)), `${p.id}: ${markup(p.find)} is on no page`);
	for (const f of AGENT_PLACES) assert.ok(pages.includes(`data-find="agent-${f.id}"`), `the agent's ${f.id}: data-find="agent-${f.id}" is not on its page`);
	// What pine has is marked by the lists that show it, with the same names the index builds.
	for (const mark of ["data-find={`model-server:", "data-find={`mcp:", "data-find={`skill:", "data-find={`source:", "data-find={`schedule:", "data-find={`route:", "data-provider={p.id}", "data-environment={h ??", "data-setting-key={s.key}"]) assert.ok(pages.includes(mark), `${mark} is on no page`);
});

test("pine's settings, agents and what pine has are found where their pages show them", () => {
	const list = entries(all, {
		settings: [
			{ key: "limits.maxDownloadMb", title: "Largest download", about: "How large a download may be.\nIn MB.", kind: { from: 1, to: 4096 }, now: "100", live: true },
			{ key: "tuning.warmSlots", about: "Not on the page.", kind: "boolean", now: "true", live: true },
		],
		agents: [
			{ id: "main", main: true, description: "Runs pine.", workspace: "/w", mode: "safe", thinking: "medium", delegates: [] } as any,
			{ id: "scout", main: false, description: "Looks things up.", workspace: "/w", mode: "auto", thinking: "low", delegates: [] } as any,
		],
		providers: [{ id: "mistral", name: "Mistral", signedIn: false, models: 3, oauth: false }, { id: "google", name: "Google", signedIn: false, models: 20, oauth: false }, { id: "mock", signedIn: true, models: 1, oauth: false }],
		machines: [{ host: "studio.local", name: "studio" }],
	});
	const one = (q: string) => search(list, q)[0];
	assert.deepEqual(one("largest download").place, { section: "general", find: `[data-setting-key="limits.maxDownloadMb"]` });
	assert.deepEqual(one("largest download").path, ["General", "Limits"]);
	assert.equal(one("largest download").about, "How large a download may be.", "only the first line of what a setting says");
	// A setting the page does not show is not found either.
	assert.equal(search(list, "warmSlots").length, 0);
	// By its key in pine.json too.
	assert.equal(one("maxDownloadMb").id, "setting:limits.maxDownloadMb");
	// A provider opens the Models page searched for it; the test provider is not there.
	assert.deepEqual(one("mistral").place, { section: "models", find: `[data-provider="mistral"]`, filter: "mistral" });
	assert.equal(search(list, "mock").filter((e) => e.id.startsWith("provider:")).length, 0);
	// By what people call it: pi's "Google" is found as Gemini, and as the subscription it cannot sign in with.
	assert.equal(one("gemini").id, "provider:google");
	assert.equal(one("gemini").title, "Google Gemini");
	assert.equal(one("antigravity").id, "provider:google");
	// An agent's fields, for each agent, but the main agent cannot be removed.
	assert.deepEqual(one("scout network").place, { section: "agents", agent: "scout", find: `[data-find="agent-network"]` });
	assert.ok(search(list, "remove this agent").every((e) => e.place.agent !== "main"));
	assert.equal(one("studio").place.find, `[data-environment="studio.local"]`);
});

test("what is not there in this state is not found", () => {
	const ids = (shown: Shown) => new Set(entries(shown, {}).map((e) => e.id));
	const away = ids({ local: false, updates: false, selfUpdate: false, access: false });
	for (const id of ["place:home", "place:keep-running", "place:updates", "place:auto-update", "place:access-devices"]) assert.ok(!away.has(id), id);
	assert.ok(away.has("place:theme") && away.has("place:notifications"));
	assert.ok(!ids({ ...all, selfUpdate: false }).has("place:auto-update"));
});

test("a title that fits comes before a place that only mentions the words, and letters in order come last", () => {
	const list = entries(all, {});
	const found = search(list, "theme").map((e) => e.id);
	assert.equal(found[0], "place:theme");
	assert.equal(search(list, "notif")[0].id, "place:notifications");
	// Words in any order, each somewhere in what is said of it.
	assert.equal(search(list, "ollama local")[0].id, "place:model-servers");
	// Letters in order, for a word typed half: last.
	const loose = search(list, "ntfc").map((e) => e.id);
	assert.ok(loose.includes("place:notifications"), loose.join());
	assert.deepEqual(search(list, "   "), []);
});
