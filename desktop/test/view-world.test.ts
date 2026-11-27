// The view panel's world, built from events as the daemon sends them, without a window.
import assert from "node:assert/strict";
import { test } from "node:test";
import { colorFor, fromText, World } from "../src/view-world.ts";

let id = 100;
const ev = (topic: string, payload: any, more: { source?: string; trust?: string; cause?: number; ts?: number } = {}) => ({ id: id++, ts: more.ts ?? 1000 + id, topic, source: more.source ?? "agent:x", payload, trust: more.trust ?? "owner", cause: more.cause });
const ids = (task: number, agent: string, session: string, more: any = {}) => ({ task, agent, session, root: more.root ?? task, parent: more.parent, depth: more.depth ?? 0 });

test("a source wakes an agent, which hands a task on, waits, is asked about and gets the answer back", () => {
	const w = new World();
	w.setPlaces([
		{ id: "main", main: true, mode: "safe", description: "" },
		{ id: "house", main: false, mode: "safe", description: "" },
		{ id: "gonzo", main: false, mode: "bypass", description: "" },
	]);
	const camera = ev("source/camera/motion", { text: "someone at the door" }, { source: "source:camera", trust: "untrusted" });
	w.take([camera]);
	assert.equal(w.stations.get("source:camera")?.count, 1);

	w.take([ev("agent/house/started", { ...ids(1, "house", "_t1"), kind: "event", prompt: "motion at the door" }, { source: "agent:house", cause: camera.id })]);
	const job = w.jobs.get(1)!;
	assert.deepEqual(job.from, { k: "source", name: "camera" });
	assert.equal(job.doing, "thinking");
	assert.deepEqual(w.pulses.map((p) => [p.from, p.to, p.kind]), [["source:camera", "agent:house", "event"]]);
	// What happened is a line about that work, which names who was in it: the wording is the panel's own.
	assert.deepEqual([w.lines.at(-1)?.agent, w.lines.at(-1)?.job], ["house", 1]);
	assert.ok(["camera", "house"].every((name) => w.lines.at(-1)!.text.includes(name)), w.lines.at(-1)!.text);

	w.take([ev("agent/house/tool", { ...ids(1, "house", "_t1"), phase: "start", tool: "delegate", subject: "gonzo" })]);
	assert.equal(job.doing, "waiting");
	w.take([ev("agent/gonzo/started", { ...ids(2, "gonzo", "_t2", { root: 1, parent: 1, depth: 1 }), kind: "delegate", prompt: "[task from agent house]\nWho is it?" })]);
	const child = w.jobs.get(2)!;
	assert.deepEqual(child.from, { k: "agent", id: "house" });
	assert.equal(child.label, "Who is it?");
	assert.deepEqual(job.waitingOn, [2]);
	assert.equal(w.pulses.at(-1)?.kind, "hand");
	assert.deepEqual([w.lines.at(-1)?.agent, w.lines.at(-1)?.job], ["gonzo", 2]);
	assert.ok(["house", "gonzo", "Who is it?"].every((part) => w.lines.at(-1)!.text.includes(part)), w.lines.at(-1)!.text);

	w.take([ev("approval/requested", { id: "a1", agent: "gonzo", task: 2, root: 1, tool: "bash", summary: "bash: curl ..." }, { source: "approvals" })]);
	assert.equal(child.doing, "asking");
	assert.deepEqual(w.asks().map((j) => j.id), [2]);
	assert.equal(w.lines.at(-1)?.tone, "ask");
	w.take([ev("approval/decided", { id: "a1", allow: false, by: "owner" }, { source: "approvals" })]);
	assert.equal(child.doing, "thinking");
	assert.deepEqual(w.asks(), []);

	w.take([ev("agent/gonzo/done", { ...ids(2, "gonzo", "_t2", { root: 1, parent: 1, depth: 1 }), status: "done", text: "the postman" })]);
	assert.equal(child.doing, "done");
	assert.equal(job.doing, "thinking", "the agent that waited goes on");
	assert.deepEqual(w.pulses.at(-1) && [w.pulses.at(-1)!.from, w.pulses.at(-1)!.to, w.pulses.at(-1)!.kind], ["agent:gonzo", "agent:house", "answer"]);
	w.take([ev("agent/house/done", { ...ids(1, "house", "_t1"), status: "done" })]);
	assert.deepEqual(w.working(), []);
});

test("where work came from: the owner, a schedule, a copy, an answer that was not waited for, another way in", () => {
	const w = new World();
	w.setPlaces([{ id: "main", main: true, mode: "auto", description: "" }, { id: "scout", main: false, mode: "safe", description: "" }]);
	w.take([ev("agent/main/started", { ...ids(1, "main", "main"), kind: "prompt", prompt: "hello" })]);
	assert.deepEqual(w.jobs.get(1)!.from, { k: "you" });
	assert.equal(w.pulses.at(-1)?.from, "you");

	const tick = ev("schedule/morning", { name: "morning" }, { source: "timer" });
	w.take([tick, ev("agent/main/started", { ...ids(2, "main", "main"), kind: "event", prompt: "brief me" }, { cause: tick.id })]);
	assert.deepEqual(w.jobs.get(2)!.from, { k: "clock", name: "morning" });
	assert.ok(fromText(w.jobs.get(2)!.from).includes("morning"), "said by the schedule's name");

	w.take([ev("agent/main/started", { ...ids(3, "main", "_t3", { root: 1, parent: 1, depth: 1 }), kind: "subagent", prompt: "look at a.txt" })]);
	assert.deepEqual(w.jobs.get(3)!.from, { k: "copy", id: "main" });
	assert.equal(w.jobs.get(1)!.doing, "waiting");

	w.take([ev("agent/main/started", { ...ids(4, "main", "main"), kind: "notify", prompt: "[answer to task #9 that you handed to agent scout]\nfound it" })]);
	assert.deepEqual(w.jobs.get(4)!.from, { k: "agent", id: "scout" });

	const hook = ev("hook/in", { text: "x" }, { source: "webhook:github", trust: "untrusted" });
	w.take([hook, ev("agent/scout/started", { ...ids(5, "scout", "main~u"), kind: "event", prompt: "x" }, { cause: hook.id })]);
	assert.deepEqual(w.jobs.get(5)!.from, { k: "outside", name: "webhook:github" });
	assert.ok(w.inputs().some((s) => s.id === "outside:webhook:github"));
	assert.deepEqual(w.inputs().map((s) => s.kind).slice(0, 2), ["you", "clock"]);
});

test("the tasks there were before the view opened are seeded, and ended work is forgotten after a while", () => {
	const w = new World();
	w.seed([
		{ id: 8, agent: "gonzo", session: "_t8", kind: "delegate", prompt: "[task from agent main]\nread it", status: "running", created: 5000, started: 5000, parent: 7, depth: 1, meta: { root: 7, chain: ["main"] } },
		{ id: 7, agent: "main", session: "main", kind: "prompt", prompt: "ask gonzo", status: "running", created: 4000, started: 4000, depth: 0, meta: {} },
		{ id: 6, agent: "main", session: "main", kind: "prompt", prompt: "earlier", status: "done", created: 1000, started: 1000, finished: 2000, depth: 0, meta: { stats: { tools: ["bash", "read"] } } },
	]);
	assert.deepEqual(w.jobs.get(8)!.from, { k: "agent", id: "main" });
	assert.equal(w.jobs.get(7)!.doing, "waiting", "it waits for gonzo");
	assert.equal(w.jobs.get(6)!.tools, 2);
	w.setAsks([{ id: "q", task: 8, tool: "bash", summary: "rm" }]);
	assert.equal(w.jobs.get(8)!.doing, "asking");
	w.setRooms([{ agent: "gonzo", session: "_t8", busy: true, mode: "safe", trust: "owner", outside: "a web page" }]);
	assert.equal(w.modeOf(w.jobs.get(8)!), "safe");
	assert.equal(w.outside(w.jobs.get(8)!), "a web page");

	w.prune(2000 + 31 * 60_000);
	assert.ok(!w.jobs.has(6), "ended half an hour ago");
	assert.ok(w.jobs.has(7) && w.jobs.has(8), "work that runs stays");
});

test("an agent without a color of its own gets one from the palette, the same every time", () => {
	const palette = ["#111111", "#222222", "#333333"];
	assert.equal(colorFor({ id: "scout", color: "#4a7fd9" }, palette), "#4a7fd9");
	assert.equal(colorFor({ id: "scout" }, palette), colorFor({ id: "scout" }, palette));
	assert.ok(palette.includes(colorFor({ id: "scout" }, palette)));
});

test("work whose end was never heard is not at work for ever: what the daemon no longer runs is ended as its record says", () => {
	const w = new World();
	w.setPlaces([
		{ id: "main", main: true, mode: "safe", description: "" },
		{ id: "ttt", main: false, mode: "auto", description: "" },
	]);
	// ttt is in a command when the daemon is restarted: it ends that work before anybody listens again.
	const t0 = Date.now() - 600_000;
	w.take([ev("agent/ttt/started", { ...ids(1, "ttt", "main"), kind: "prompt", prompt: "play" }, { source: "agent:ttt", ts: t0 }), ev("agent/ttt/tool", { ...ids(1, "ttt", "main"), phase: "start", tool: "bash", subject: "node move.js" }, { source: "agent:ttt", ts: t0 + 500 })]);
	w.skew = 0;
	assert.equal(w.jobs.get(1)!.doing, "tool");
	// Later it really works again, and main waits for work it handed on, which runs a long, silent command.
	const now = Date.now();
	w.take([
		ev("agent/main/started", { ...ids(3, "main", "main"), kind: "prompt", prompt: "ask" }, { source: "agent:main", ts: now - 60_000 }),
		ev("agent/ttt/started", { ...ids(4, "ttt", "_t4", { parent: 3, root: 3, depth: 1 }), kind: "delegate", prompt: "[task from agent main]\nsum" }, { source: "agent:ttt", ts: now - 50_000 }),
		ev("agent/ttt/started", { ...ids(2, "ttt", "main"), kind: "prompt", prompt: "why two robots" }, { source: "agent:ttt", ts: now - 300 }),
	]);
	w.skew = 0;
	assert.deepEqual(w.working("ttt").map((j) => j.id), [1, 4, 2], "two pieces of ttt's own work at once, as the view had it");
	// The daemon runs 3 and 4. Of the rest, only the work it has long said nothing of is doubted: 2 began this moment.
	assert.deepEqual(w.unheard([3, 4], now), [1]);
	assert.deepEqual(w.unheard([1, 3, 4], now), [], "what the daemon runs is left alone, however quiet it is");
	const lines = w.lines.length;
	const pulses = w.trail.length;
	w.settle(1, { status: "failed", finished: t0 + 4000, error: "interrupted by a daemon restart" });
	const one = w.jobs.get(1)!;
	assert.deepEqual([one.doing, one.finished, one.tool, one.error], ["failed", t0 + 4000, undefined, "interrupted by a daemon restart"]);
	assert.deepEqual([w.lines.length, w.trail.length], [lines, pulses], "it is no news: nothing is said of it and nothing travels");
	assert.deepEqual(w.working("ttt").map((j) => j.id), [4, 2]);
	// Work the record still has running, or that ended in the meantime, is not touched; a record that is gone ends it.
	w.settle(2, { status: "running" });
	assert.equal(w.jobs.get(2)!.doing, "thinking");
	w.settle(4);
	assert.equal(w.jobs.get(4)!.doing, "cancelled");
	assert.equal(w.jobs.get(3)!.doing, "thinking", "and who waited for it no longer waits");
	w.settle(1, { status: "done" });
	assert.equal(w.jobs.get(1)!.doing, "failed", "what has ended stays as it ended");
});

test("a source that was removed leaves the view, also one that had reported something", () => {
	const w = new World();
	w.setPlaces([{ id: "house", main: false, mode: "safe", description: "" }]);
	w.setSources([
		{ name: "camera", type: "onvif", events: 0, subscribers: ["house"] },
		{ name: "inbox", type: "mail", events: 2, subscribers: ["house"] },
	]);
	w.take([ev("source/camera/motion", { text: "someone at the door" }, { source: "source:camera", trust: "untrusted" })]);
	assert.deepEqual(w.inputs().filter((s) => s.kind === "source").map((s) => s.name), ["camera", "inbox"]);
	w.setSources([{ name: "inbox", type: "mail", events: 2, subscribers: ["house"] }]);
	assert.deepEqual(w.inputs().filter((s) => s.kind === "source").map((s) => s.name), ["inbox"]);
	assert.equal(w.sourceInfo.has("source:camera"), false);
	assert.equal(w.stations.has("you"), true, "the other ways in stay");
});
