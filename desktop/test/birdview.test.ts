// The bird's-eye view's model: snapshots of the control API and events of the stream in, what the
// view draws out. No React, no daemon: the module is fed by hand with a fixed clock.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PineEvent } from "../src/api.ts";
import { applyEvents, applySnapshot, birdview, type Snapshot, view } from "../src/birdview.ts";

const T0 = 1_800_000_000_000;
let nextId = 1;
const ev = (topic: string, payload: any, at: number, trust: "owner" | "untrusted" = "owner"): PineEvent => ({ id: nextId++, ts: at, topic, source: "test", payload, trust });

const calm: Snapshot = {
	agents: [
		{ id: "main", main: true, description: "", workspace: "", model: "", mode: "safe", thinking: "off", delegates: [] },
		{ id: "kevin", main: false, description: "", workspace: "", model: "", mode: "safe", thinking: "off", delegates: ["ana"] },
		{ id: "ana", main: false, description: "", workspace: "", model: "", mode: "safe", thinking: "off", delegates: [] },
	],
	conversations: { kevin: [{ session: "main", tasks: 3, last: T0 - 60_000, pinned: false, open: true }] },
	status: { limiter: {}, running: [], sessions: [], modes: {}, agents: ["main", "kevin", "ana"], approvals: 0, bypassWhenTainted: false },
	sources: [{ name: "mail", scope: "global", type: "mail", trust: "untrusted", running: true, subscribers: ["kevin"], topic: "source/mail", events: 4 }],
	schedules: [{ name: "morning", scope: "ana", session: "main", when: "every day at 8:00", task: "Say hello", topic: "schedule/morning@ana" }],
	pending: [],
};

const started = (agent: string, session: string, task: number, at: number, more: Record<string, unknown> = {}, trust: "owner" | "untrusted" = "owner") =>
	ev(`agent/${agent}/started`, { task, agent, session, root: task, depth: 0, kind: "prompt", ...more }, at, trust);
const done = (agent: string, session: string, task: number, at: number, more: Record<string, unknown> = {}) =>
	ev(`agent/${agent}/done`, { task, agent, session, root: task, depth: 0, kind: "prompt", status: "done", ...more }, at);

const agentOf = (m: ReturnType<typeof view>, id: string) => m.agents.find((a) => a.id === id)!;
const satellite = (m: ReturnType<typeof view>, id: string) => m.satellites.find((s) => s.id === id);

test("every agent is shown, idle, with nobody working", () => {
	const bv = birdview();
	applySnapshot(bv, calm, T0);
	const m = view(bv, T0);
	assert.deepEqual(m.agents.map((a) => [a.id, a.state]), [["main", "idle"], ["kevin", "idle"], ["ana", "idle"]]);
	assert.equal(m.satellites.length, 0, "an idle conversation is not drawn");
});

test("an agent works on started, its conversation appears, and fades after done", () => {
	const bv = birdview();
	applySnapshot(bv, calm, T0);
	applyEvents(bv, [started("kevin", "main", 7, T0 + 1000)]);
	let m = view(bv, T0 + 1500);
	assert.equal(agentOf(m, "kevin").state, "working");
	assert.equal(satellite(m, "conv:kevin/main")?.state, "working");
	assert.equal(satellite(m, "conv:kevin/main")?.opacity, 1);

	applyEvents(bv, [done("kevin", "main", 7, T0 + 5000)]);
	m = view(bv, T0 + 5000);
	assert.equal(agentOf(m, "kevin").state, "idle");
	const fading = satellite(m, "conv:kevin/main");
	assert.equal(fading?.state, "idle");
	assert.equal(fading?.ended, "done");
	const later = satellite(view(bv, T0 + 20_000), "conv:kevin/main");
	assert.ok(later && later.opacity < fading!.opacity, "it fades as time passes");
	assert.equal(satellite(view(bv, T0 + 5000 + 10 * 60_000), "conv:kevin/main"), undefined, "and is gone in the end");
});

test("an agent counts its conversations that are not drawn, for a folded \"+N idle\"", () => {
	const bv = birdview();
	applySnapshot(bv, { ...calm, conversations: { kevin: ["main", "notes", "mail~u"].map((session) => ({ session, tasks: 1, last: T0 - 60_000, pinned: false, open: true })) } }, T0);
	applyEvents(bv, [started("kevin", "notes", 1, T0 + 100)]);
	const m = view(bv, T0 + 200);
	assert.equal(agentOf(m, "kevin").idle, 2);
	assert.equal(agentOf(m, "ana").idle, 0);
});

test("a failed task is told apart from a finished one", () => {
	const bv = birdview();
	applySnapshot(bv, calm, T0);
	applyEvents(bv, [started("kevin", "main", 7, T0), ev("agent/kevin/failed", { task: 7, agent: "kevin", session: "main", root: 7, depth: 0, kind: "prompt", status: "failed" }, T0 + 100)]);
	assert.equal(satellite(view(bv, T0 + 200), "conv:kevin/main")?.ended, "failed");
});

test("a task is queued before it starts", () => {
	const bv = birdview();
	applySnapshot(bv, calm, T0);
	applyEvents(bv, [ev("agent/ana/queued", { task: 9, agent: "ana", session: "main", root: 9, depth: 0, kind: "event", label: "mail" }, T0)]);
	const m = view(bv, T0 + 10);
	assert.equal(agentOf(m, "ana").state, "queued");
	assert.equal(satellite(m, "conv:ana/main")?.state, "queued");
});

test("a pending task and a busy conversation in a snapshot are shown as such", () => {
	const bv = birdview();
	applySnapshot(bv, {
		...calm,
		status: { ...calm.status, running: [{ task: 3, agent: "kevin", session: "main", kind: "prompt" }], sessions: [{ agent: "kevin", session: "main", busy: true, trust: "owner", mode: "safe", tainted: "web" }] },
		pending: [{ id: 4, agent: "ana", session: "main", kind: "event", prompt: "", status: "pending", created: T0, depth: 0, meta: {} }],
	}, T0);
	const m = view(bv, T0);
	assert.equal(agentOf(m, "kevin").state, "working");
	assert.equal(satellite(m, "conv:kevin/main")?.outside, true, "a tainted conversation carries the mark");
	assert.equal(agentOf(m, "ana").state, "queued");
});

test("a conversation started by outside content is marked", () => {
	const bv = birdview();
	applySnapshot(bv, calm, T0);
	applyEvents(bv, [started("kevin", "mail~u", 11, T0, { kind: "event" }, "untrusted")]);
	const s = satellite(view(bv, T0 + 10), "conv:kevin/mail~u")!;
	assert.equal(s.untrusted, true);
	assert.equal(s.outside, true);
});

test("a delegation links two agents while it runs, then fades", () => {
	const bv = birdview();
	applySnapshot(bv, calm, T0);
	applyEvents(bv, [
		started("kevin", "main", 20, T0),
		started("ana", "kevin-delegate", 21, T0 + 100, { kind: "delegate", parent: 20, root: 20, depth: 1 }),
	]);
	let m = view(bv, T0 + 200);
	const d = satellite(m, "task:21")!;
	assert.equal(d.kind, "delegate");
	assert.equal(d.agent, "ana");
	const link = m.links.find((l) => l.kind === "delegation")!;
	assert.deepEqual([link.from, link.to], ["conv:kevin/main", "task:21"]);
	assert.equal(agentOf(m, "ana").state, "working");

	applyEvents(bv, [done("ana", "kevin-delegate", 21, T0 + 1000, { kind: "delegate", parent: 20, root: 20, depth: 1 })]);
	m = view(bv, T0 + 30_000);
	assert.ok(m.links.find((l) => l.kind === "delegation")!.opacity < 1, "the link fades when the task is done");
	assert.equal(view(bv, T0 + 30 * 60_000).links.find((l) => l.kind === "delegation"), undefined);
});

test("a sub-agent hangs on its conversation", () => {
	const bv = birdview();
	applySnapshot(bv, calm, T0);
	applyEvents(bv, [started("kevin", "main", 30, T0), started("kevin", "main/sub-1", 31, T0 + 10, { kind: "subagent", parent: 30, root: 30, depth: 1 })]);
	const m = view(bv, T0 + 20);
	assert.equal(satellite(m, "task:31")?.kind, "subagent");
	assert.ok(m.links.some((l) => l.kind === "subagent" && l.from === "conv:kevin/main" && l.to === "task:31"));
});

test("sources and schedules are drawn with their lasting links", () => {
	const bv = birdview();
	applySnapshot(bv, { ...calm, sources: [...calm.sources, { name: "door", scope: "ana", type: "mqtt", trust: "owner", running: true, subscribers: ["ana/hall"], topic: "source/door@ana", events: 0 }] }, T0);
	const m = view(bv, T0);
	assert.deepEqual(m.sources.map((s) => s.id), ["source:mail", "source:door@ana"]);
	assert.deepEqual(m.schedules.map((s) => s.id), ["schedule:morning@ana"]);
	const lasting = m.links.filter((l) => l.kind === "subscription" || l.kind === "schedule").map((l) => `${l.from} > ${l.to}`);
	assert.deepEqual(lasting, ["source:mail > agent:kevin", "source:door@ana > conv:ana/hall", "schedule:morning@ana > agent:ana"]);
});

test("an event from a source travels to its subscribers, and its text shows only on hover, cut and marked outside", () => {
	const bv = birdview();
	applySnapshot(bv, calm, T0);
	const subject = `**Invoice** <b>overdue</b>\n[pay now](https://evil.example) ${"x".repeat(300)}`;
	applyEvents(bv, [ev("source/mail/message", { from: "a@b.c", subject }, T0, "untrusted")]);
	const m = view(bv, T0 + 100);
	const p = m.pulses.find((x) => x.topic === "source/mail/message")!;
	assert.equal(p.from, "source:mail");
	assert.deepEqual(p.to, ["agent:kevin"]);
	assert.equal(p.label, "message", "the permanent label is pine's word");
	assert.equal(p.hover?.outside, true);
	assert.ok(p.hover!.text.length <= 120);
	assert.doesNotMatch(p.hover!.text, /[<>*\n]|\]\(|https?:/);
	assert.match(p.hover!.text, /^Invoice overdue pay now x+/);
});

test("a tool call shows its name on the agent and its subject on hover", () => {
	const bv = birdview();
	applySnapshot(bv, calm, T0);
	applyEvents(bv, [started("kevin", "main", 7, T0), ev("agent/kevin/tool", { task: 7, agent: "kevin", session: "main", call: "c1", phase: "start", tool: "bash", subject: "ls -la" }, T0 + 10)]);
	let m = view(bv, T0 + 20);
	assert.equal(agentOf(m, "kevin").tool, "bash");
	assert.equal(satellite(m, "conv:kevin/main")?.tool, "bash");
	const p = m.pulses.find((x) => x.kind === "tool")!;
	assert.equal(p.label, "bash");
	assert.deepEqual(p.hover, { text: "ls -la", outside: false });
	applyEvents(bv, [ev("agent/kevin/tool", { task: 7, agent: "kevin", session: "main", call: "c1", phase: "end", tool: "bash", ok: true }, T0 + 30)]);
	m = view(bv, T0 + 40);
	assert.equal(agentOf(m, "kevin").tool, undefined);
});

test("a conversation waiting for an approval stands out until it is decided", () => {
	const bv = birdview();
	applySnapshot(bv, calm, T0);
	applyEvents(bv, [started("kevin", "main", 7, T0), ev("approval/requested", { id: "a1", agent: "kevin", task: 7, root: 7, tool: "send", summary: "send a mail", why: "", expires: T0 + 60_000 }, T0 + 10)]);
	let m = view(bv, T0 + 20);
	assert.equal(satellite(m, "conv:kevin/main")?.state, "waiting");
	assert.equal(agentOf(m, "kevin").state, "waiting");
	applyEvents(bv, [ev("approval/decided", { id: "a1", allow: true, agent: "kevin", tool: "send" }, T0 + 30)]);
	m = view(bv, T0 + 40);
	assert.equal(satellite(m, "conv:kevin/main")?.state, "working");
});

test("a schedule firing and a send through a source are pulses on their links", () => {
	const bv = birdview();
	applySnapshot(bv, calm, T0);
	applyEvents(bv, [
		ev("schedule/morning@ana", { name: "morning", task: "Say hello" }, T0),
		ev("out/source/mail", { agent: "kevin", text: "Reply" }, T0 + 10),
	]);
	const m = view(bv, T0 + 20);
	const fired = m.pulses.find((p) => p.kind === "schedule")!;
	assert.deepEqual([fired.from, fired.to], ["schedule:morning@ana", ["agent:ana"]]);
	const sent = m.pulses.find((p) => p.kind === "send")!;
	assert.deepEqual([sent.from, sent.to], ["agent:kevin", ["source:mail"]]);
});

test("token deltas, thinking and messages are not taken in", () => {
	const bv = birdview();
	applySnapshot(bv, calm, T0);
	applyEvents(bv, ["delta", "thinking", "message"].map((k) => ev(`agent/kevin/${k}`, { text: "x" }, T0)));
	const m = view(bv, T0);
	assert.equal(m.pulses.length, 0);
	assert.equal(m.histogram.counts.reduce((a, b) => a + b, 0), 0);
});

test("a conversation removed elsewhere goes; one renamed moves", () => {
	const bv = birdview();
	applySnapshot(bv, calm, T0);
	applyEvents(bv, [started("kevin", "main", 7, T0), ev("pine/conversation", { change: "rename", agent: "kevin", session: "main", to: "inbox" }, T0 + 10)]);
	assert.ok(satellite(view(bv, T0 + 20), "conv:kevin/inbox"));
	applyEvents(bv, [ev("pine/conversation", { change: "remove", agent: "kevin", session: "inbox" }, T0 + 30)]);
	assert.equal(satellite(view(bv, T0 + 40), "conv:kevin/inbox"), undefined);
});

test("agents and sources that appear or go in a snapshot follow", () => {
	const bv = birdview();
	applySnapshot(bv, calm, T0);
	applySnapshot(bv, { ...calm, agents: calm.agents.filter((a) => a.id !== "ana"), sources: [] }, T0 + 20_000);
	const m = view(bv, T0 + 20_000);
	assert.deepEqual(m.agents.map((a) => a.id), ["main", "kevin"]);
	assert.equal(m.sources.length, 0);
	assert.equal(m.links.filter((l) => l.kind === "subscription").length, 0);
});

test("the histogram counts what happened over the window", () => {
	const bv = birdview({ window: 60_000, buckets: 6 });
	applySnapshot(bv, calm, T0);
	applyEvents(bv, [
		ev("source/mail/message", {}, T0 - 55_000),
		ev("source/mail/message", {}, T0 - 25_000),
		ev("source/mail/message", {}, T0 - 24_000),
		ev("source/mail/message", {}, T0 - 1000),
		ev("source/mail/message", {}, T0 - 120_000),
	]);
	const h = view(bv, T0).histogram;
	assert.equal(h.end, T0);
	assert.equal(h.size, 10_000);
	assert.deepEqual(h.counts, [1, 0, 0, 2, 0, 1]);
});

test("replayed activity looks older than live activity", () => {
	const bv = birdview();
	applySnapshot(bv, calm, T0);
	applyEvents(bv, [ev("source/mail/message", {}, T0 - 5 * 60_000)], { replay: true });
	applyEvents(bv, [ev("source/mail/message", {}, T0)]);
	const [old, live] = view(bv, T0).pulses;
	assert.equal(old.replayed, true);
	assert.equal(live.replayed, false);
	assert.ok(old.opacity < live.opacity);
});

test("a burst of events does not make the model grow without bound", () => {
	const bv = birdview();
	applySnapshot(bv, calm, T0);
	for (let second = 0; second < 60; second++) {
		const batch: PineEvent[] = [];
		for (let i = 0; i < 100; i++) {
			const at = T0 + second * 1000 + i * 10;
			const task = second * 100 + i;
			batch.push(started("kevin", "main", task, at), ev("agent/kevin/tool", { task, agent: "kevin", session: "main", call: `c${task}`, phase: "start", tool: "read" }, at), done("kevin", "main", task, at + 5));
		}
		applyEvents(bv, batch);
	}
	const m = view(bv, T0 + 60_000);
	assert.ok(m.pulses.length <= 500, `pulses kept: ${m.pulses.length}`);
	assert.ok(bv.tasks.size <= 1000, `tasks kept: ${bv.tasks.size}`);
	assert.equal(m.histogram.counts.reduce((a, b) => a + b, 0), 18_000);
});

test("the fake activity plays a mail, kevin queued then working, a delegation to ana, a ~u run and an approval waiting", async () => {
	const { fakeActivity } = await import("../src/birdview-fake.ts");
	const fake = fakeActivity(T0);
	const bv = birdview();
	applySnapshot(bv, fake.snapshot, T0);
	const seen = new Set<string>();
	let delegated = false;
	let sawUntrusted = false;
	for (let at = T0; at <= fake.end; at += 250) {
		applyEvents(bv, fake.events.filter((e) => e.ts > at - 250 && e.ts <= at));
		const m = view(bv, at);
		for (const a of m.agents) seen.add(`${a.id}:${a.state}`);
		delegated ||= m.links.some((l) => l.kind === "delegation" && m.satellites.find((s) => s.id === l.to)?.agent === "ana");
		sawUntrusted ||= m.satellites.some((s) => s.untrusted && s.outside);
	}
	for (const s of ["kevin:queued", "kevin:working", "ana:working", "kevin:waiting"]) assert.ok(seen.has(s), `goes through ${s}`);
	assert.ok(delegated, "a delegation from kevin to ana is drawn");
	assert.ok(sawUntrusted, "a ~u run is drawn and marked");
	assert.ok(view(bv, fake.end).pulses.some((p) => p.kind === "source" && p.hover?.outside), "the mail arrived, its text marked outside");
	assert.ok(fake.events.every((e, i) => i === 0 || e.ts >= fake.events[i - 1].ts), "the events are in order");
});
