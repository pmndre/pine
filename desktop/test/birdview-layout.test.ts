// What the bird's-eye view's drawing is made of, without React: the layers the owner switches, the
// one line a hover shows, where a click goes, and the geometry of its lines. Fed with the fake
// activity at a fixed clock.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEvents, applySnapshot, birdview, view } from "../src/birdview.ts";
import { fakeActivity, fakeBusy, fakeCalm, replayAt } from "../src/birdview-fake.ts";
import { constellation, DEFAULT_LAYERS, describe, metroPath, pick, pointAlong, track, withLayers } from "../src/birdview-layout.ts";

const T0 = 1_800_000_000_000;

/** The fake activity as it stands `seconds` after it began. */
function at(seconds: number) {
	const fake = fakeActivity(T0);
	const bv = birdview();
	applySnapshot(bv, fake.snapshot, T0);
	applyEvents(bv, fake.events.filter((e) => e.ts <= T0 + seconds * 1000));
	return view(bv, T0 + seconds * 1000);
}

test("by default sources, schedules, conversations and tool calls are on, and routes, MCP servers and skills off", () => {
	assert.deepEqual([...DEFAULT_LAYERS].sort(), ["conversations", "schedules", "sources", "tools"]);
});

test("switching sources off takes away the sources, their lines and their pulses", () => {
	const m = withLayers(at(1.1), DEFAULT_LAYERS.filter((l) => l !== "sources"));
	assert.equal(m.sources.length, 0);
	assert.equal(m.links.filter((l) => l.kind === "subscription").length, 0);
	assert.equal(m.pulses.filter((p) => p.kind === "source" || p.kind === "send").length, 0);
	assert.equal(m.schedules.length, 1, "schedules stay");
});

test("switching schedules off takes away the schedules and their lines", () => {
	const m = withLayers(at(14.1), DEFAULT_LAYERS.filter((l) => l !== "schedules"));
	assert.equal(m.schedules.length, 0);
	assert.equal(m.links.filter((l) => l.kind === "schedule").length, 0);
	assert.equal(m.pulses.filter((p) => p.kind === "schedule").length, 0);
});

test("switching conversations off folds them into their agents: a delegation then joins two agents", () => {
	const m = withLayers(at(9), DEFAULT_LAYERS.filter((l) => l !== "conversations"));
	assert.equal(m.satellites.length, 0);
	const d = m.links.find((l) => l.kind === "delegation")!;
	assert.deepEqual([d.from, d.to], ["agent:kevin", "agent:ana"]);
	assert.ok(m.pulses.filter((p) => p.kind === "tool").every((p) => p.to.every((t) => t.startsWith("agent:"))));
});

test("switching tool calls off hides the tools' names and their pulses", () => {
	const on = at(9.2);
	assert.equal(on.agents.find((a) => a.id === "ana")?.tool, "read");
	const m = withLayers(on, DEFAULT_LAYERS.filter((l) => l !== "tools"));
	assert.equal(m.agents.find((a) => a.id === "ana")?.tool, undefined);
	assert.ok(m.satellites.every((s) => s.tool === undefined));
	assert.equal(m.pulses.filter((p) => p.kind === "tool").length, 0);
});

test("a hover over a pulse gives pine's word and the content on one plain line, marked outside", () => {
	const m = at(1.5);
	const mail = m.pulses.find((p) => p.kind === "source")!;
	const line = describe(m, `pulse:${mail.id}`)!;
	assert.equal(line.label, "mail: message");
	assert.equal(line.hover?.outside, true);
	assert.match(line.hover!.text, /^Invoice 4411 is overdue/);
	assert.doesNotMatch(line.hover!.text, /\n/);
});

test("a hover over a line reads what it carried last", () => {
	const m = at(2);
	const line = describe(m, "link:subscription:mail>kevin")!;
	assert.equal(line.label, "mail to kevin, last: message");
	assert.equal(line.hover?.outside, true);
	assert.deepEqual(describe(at(0), "link:subscription:mail>kevin"), { label: "mail to kevin" });
});

test("a hover over the owner's own content has no outside mark", () => {
	const m = at(6.1);
	const queued = m.pulses.find((p) => p.kind === "queued" && p.to[0] === "conv:kevin/main")!;
	assert.deepEqual(describe(m, `pulse:${queued.id}`)?.hover, { text: "Sum up this week's commits", outside: false });
});

test("a hover over a node names it in pine's words only", () => {
	const m = at(7);
	assert.deepEqual(describe(m, "agent:kevin"), { label: "kevin: waiting, approval asked" });
	assert.deepEqual(describe(m, "conv:kevin/mail~u"), { label: "kevin/mail~u: waiting, approval asked, outside content" });
	assert.deepEqual(describe(m, "source:mail"), { label: "mail: mail source, untrusted" });
	assert.deepEqual(describe(m, "schedule:morning@ana"), { label: "morning@ana: every day at 8:00" });
});

test("a click goes to the agent, the conversation, the setting or the event's topic", () => {
	const m = at(9);
	assert.deepEqual(pick(m, "agent:ana"), { to: "agent", agent: "ana" });
	assert.deepEqual(pick(m, "conv:kevin/main"), { to: "conversation", agent: "kevin", session: "main" });
	assert.deepEqual(pick(m, "task:103"), { to: "conversation", agent: "ana", session: "kevin" });
	assert.deepEqual(pick(m, "source:mail"), { to: "setting", id: "source:mail" });
	assert.deepEqual(pick(m, "schedule:morning@ana"), { to: "setting", id: "schedule:morning@ana" });
	const mail = m.pulses.find((p) => p.kind === "source")!;
	assert.deepEqual(pick(m, `pulse:${mail.id}`), { to: "events", topic: "source/mail/message" });
	assert.equal(pick(m, "nothing"), undefined);
});

test("a metro line runs straight, then at 45 degrees, then straight", () => {
	const points = metroPath({ x: 0, y: 0 }, { x: 200, y: 60 });
	assert.deepEqual(points[0], { x: 0, y: 0 });
	assert.deepEqual(points.at(-1), { x: 200, y: 60 });
	for (let i = 1; i < points.length; i++) {
		const dx = Math.abs(points[i].x - points[i - 1].x);
		const dy = Math.abs(points[i].y - points[i - 1].y);
		assert.ok(dx === 0 || dy === 0 || Math.abs(dx - dy) < 1e-9, `segment ${i} is straight or diagonal`);
	}
	const down = metroPath({ x: 0, y: 0 }, { x: 30, y: 300 });
	assert.ok(down.slice(1).every((p, i) => p.y >= down[i].y), "a line between rows runs downward");
});

test("a track runs along the trunk and the lane above its row, its corners cut at 45 degrees", () => {
	const points = track({ x: 0, y: 100 }, { x: 300, y: 40 }, { trunk: 60, lane: 20 });
	assert.deepEqual(points[0], { x: 0, y: 100 });
	assert.deepEqual(points.at(-1), { x: 300, y: 40 });
	assert.ok(points.some((p) => p.y === 20), "it runs along the lane");
	assert.ok(Math.min(...points.map((p) => p.y)) >= 20, "it never goes above the lane");
	for (let i = 1; i < points.length; i++) {
		const dx = Math.abs(points[i].x - points[i - 1].x);
		const dy = Math.abs(points[i].y - points[i - 1].y);
		assert.ok(dx === 0 || dy === 0 || Math.abs(dx - dy) < 1e-9, `segment ${i} is straight or diagonal`);
	}
	const down = track({ x: 50, y: 0 }, { x: 200, y: 120 }, { lane: 100 });
	assert.ok(down.every((p) => p.x >= 50 && p.x <= 200), "without a trunk it drops straight to the lane");
});

test("a point along a line is found by the fraction of its length", () => {
	const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
	assert.deepEqual(pointAlong(line, 0), { x: 0, y: 0 });
	assert.deepEqual(pointAlong(line, 0.25), { x: 50, y: 0 });
	assert.deepEqual(pointAlong(line, 0.75), { x: 100, y: 50 });
	assert.deepEqual(pointAlong(line, 1), { x: 100, y: 100 });
});

test("the busy fake keeps several agents working, has a trail for the strip, and a failure", () => {
	const fake = fakeBusy(T0);
	const m = replayAt(fake, T0 + 8000);
	assert.ok(m.agents.filter((a) => a.state !== "idle").length >= 4, m.agents.map((a) => `${a.id}:${a.state}`).join(" "));
	assert.ok(m.histogram.counts.slice(0, -2).some((n) => n > 0), "the trail fills the strip before now");
	assert.ok(m.pulses.some((p) => p.replayed));
	let failed = false;
	for (let t = T0; t <= fake.end; t += 500) failed ||= replayAt(fake, t).satellites.some((s) => s.ended === "failed");
	assert.ok(failed, "a failed task shows");
	assert.ok(replayAt(fakeCalm(T0), T0).pulses.length > 0, "a calm pine still has its trail");
});

test("on the constellation agents keep their place whatever happens, and sources lie outside their ring", () => {
	const calm = constellation(at(0), 800, 600);
	const busy = constellation(at(9), 800, 600);
	for (const id of ["agent:main", "agent:kevin", "agent:ana"]) assert.deepEqual(busy.get(id), calm.get(id), `${id} stays put`);
	const main = calm.get("agent:main")!;
	assert.deepEqual([main.x, main.y], [400, 300], "the main agent is at the centre");
	const ring = Math.hypot(calm.get("agent:kevin")!.x - 400, calm.get("agent:kevin")!.y - 300);
	for (const id of ["source:mail", "source:telegram", "schedule:morning@ana"]) {
		const p = calm.get(id)!;
		assert.ok(Math.hypot(p.x - 400, p.y - 300) > ring, `${id} is outside the agents' ring`);
	}
	assert.ok(busy.has("task:103") && busy.has("conv:kevin/main"), "satellites get a place too");
});
