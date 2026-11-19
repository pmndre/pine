// The bird's-eye view's model: what pine is doing, built from the control API's snapshots and the
// stream's events, and read at a given time. No React and no I/O, so that the mockup (fake events),
// the live view and the tests feed it the same way. Ages and fading come from the time the model is
// read at, never from a clock of its own.
//
// Text rule (rule 10 of AGENTS.md): what is drawn for good is pine's own words (names of agents,
// sources, conversations, topics, tools, states). Content (a mail's subject, a tool's subject, a
// task's label) is only `hover`: one line of plain text, cut, marked `outside` when its trust is not
// the owner's.
import type { AgentInfo, Conversation, PineEvent, Schedule, SourceInfo, Status, Task } from "./api.ts";
import { oneLine, short } from "./text.ts";

/** What the control API said, polled: the slow state. */
export interface Snapshot {
	agents: AgentInfo[];
	/** Each agent's conversations (`/agents/<id>/sessions`), which may say `working` and `outside`. */
	conversations: Record<string, Array<Conversation & { working?: boolean; outside?: unknown }>>;
	status: Status;
	sources: SourceInfo[];
	schedules: Schedule[];
	/** `/tasks?status=pending`. */
	pending: Task[];
}

export type State = "idle" | "queued" | "working" | "waiting";
/** One line of content for a hover, plain text, cut; `outside` when its trust is not the owner's. */
export interface Hover {
	text: string;
	outside: boolean;
}

export interface AgentNode {
	id: string;
	main: boolean;
	state: State;
	/** The tool it is calling now, by name. */
	tool?: string;
	/** One of its conversations has read outside content. */
	outside: boolean;
	/** How many of its conversations are not drawn, for a folded "+N idle". */
	idle: number;
}

/** A conversation, a sub-agent or a delegated task, drawn beside its agent while it works or waits, and fading after. */
export interface Satellite {
	/** `conv:<agent>/<session>` or `task:<id>`. */
	id: string;
	kind: "conversation" | "subagent" | "delegate";
	agent: string;
	session: string;
	state: State;
	tool?: string;
	/** How the last task ended, while it fades. */
	ended?: "done" | "failed";
	/** Started by outside content (a `~u` conversation, or an untrusted run). */
	untrusted: boolean;
	/** Has read outside content. */
	outside: boolean;
	/** 1 while active, down to 0 as it fades. */
	opacity: number;
}

export interface SourceNode {
	/** `source:<key>`, the key being the one in its topics (`mail`, `door@ana`). */
	id: string;
	name: string;
	scope: string;
	type: string;
	running: boolean;
	trust: string;
}

export interface ScheduleNode {
	/** `schedule:<key>`. */
	id: string;
	name: string;
	scope: string;
	when: string;
	next?: number;
}

export interface Link {
	id: string;
	kind: "subscription" | "schedule" | "delegation" | "subagent";
	/** Node ids. A `conv:` that is not drawn stands for its agent (`agentOfNode`). */
	from: string;
	to: string;
	opacity: number;
}

export type PulseKind = "source" | "send" | "schedule" | "queued" | "started" | "done" | "failed" | "tool" | "approval" | "event";

/** Something that happened, passing over a link or flashing on a node. */
export interface Pulse {
	id: number;
	kind: PulseKind;
	topic: string;
	from?: string;
	to: string[];
	/** pine's word for it: an event's name, a tool's name, a state. */
	label: string;
	hover?: Hover;
	ts: number;
	age: number;
	opacity: number;
	/** Read from the stored trail on opening, not seen live. */
	replayed: boolean;
}

export interface Histogram {
	/** The end of the last bucket. */
	end: number;
	/** The width of a bucket, ms. */
	size: number;
	counts: number[];
}

export interface BirdviewModel {
	now: number;
	agents: AgentNode[];
	satellites: Satellite[];
	sources: SourceNode[];
	schedules: ScheduleNode[];
	links: Link[];
	pulses: Pulse[];
	histogram: Histogram;
}

interface TaskRec {
	id: number;
	agent: string;
	session: string;
	kind: string;
	parent?: number;
	untrusted: boolean;
	state: "queued" | "working" | "done" | "failed";
	at: number;
	endedAt?: number;
	tool?: { call: string; name: string };
	waiting: Set<string>;
}

interface ConvRec {
	agent: string;
	session: string;
	outside: boolean;
	busy: boolean;
	endedAt?: number;
	ended?: "done" | "failed";
}

interface PulseRec extends Omit<Pulse, "age" | "opacity"> {}

export interface Options {
	/** How far back the trail and the histogram go, ms. */
	window: number;
	buckets: number;
	/** How long a satellite or a delegation link takes to fade once done, ms. */
	fade: number;
	/** How long a pulse stays bright, ms; after that it is a faint trail until the window ends. */
	pulseLife: number;
	maxPulses: number;
	maxTasks: number;
}

const DEFAULTS: Options = { window: 15 * 60_000, buckets: 90, fade: 60_000, pulseLife: 8000, maxPulses: 500, maxTasks: 500 };

/** The view's state. Fed by `applySnapshot` and `applyEvents`, read by `view`. */
export interface Birdview {
	opts: Options;
	agents: AgentInfo[];
	sources: SourceInfo[];
	schedules: Schedule[];
	convs: Map<string, ConvRec>;
	tasks: Map<number, TaskRec>;
	approvals: Map<string, number>;
	pulses: PulseRec[];
	/** Events counted by bucket, keyed by `floor(ts / size)`. */
	slots: Map<number, number>;
}

/** A new, empty model. */
export function birdview(options: Partial<Options> = {}): Birdview {
	return { opts: { ...DEFAULTS, ...options }, agents: [], sources: [], schedules: [], convs: new Map(), tasks: new Map(), approvals: new Map(), pulses: [], slots: new Map() };
}

const convId = (agent: string, session: string) => `conv:${agent}/${session}`;
const isChild = (kind: string) => kind === "subagent" || kind === "delegate";
const sourceKey = (s: { name: string; scope: string }) => (s.scope === "global" ? s.name : `${s.name}@${s.scope}`);
const isUntrustedSession = (session: string) => session.endsWith("~u");

/** The agent a node id belongs to, for a renderer that draws a link to a conversation it does not show. */
export function agentOfNode(id: string, bv?: Birdview): string | undefined {
	if (id.startsWith("agent:")) return id.slice(6);
	if (id.startsWith("conv:")) return id.slice(5).split("/")[0];
	if (id.startsWith("task:") && bv) return bv.tasks.get(Number(id.slice(5)))?.agent;
	return undefined;
}

/**
 * One line of plain text for a hover: no markup, no control characters, no link syntax, cut to
 * about 120 characters. The renderer draws it as text all the same; this keeps markup from even
 * looking like markup.
 */
export function hoverText(text: unknown, trust: string): Hover | undefined {
	if (typeof text !== "string") return undefined;
	const plain = oneLine(
		text
			.replace(/<[^>]*>/g, " ")
			.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
			.replace(/[<>*`#|~]/g, " ")
			.replace(/(^|\s)_+|_+(\s|$)/g, "$1$2"),
	);
	return plain ? { text: short(plain, 120), outside: trust !== "owner" } : undefined;
}

function conv(bv: Birdview, agent: string, session: string): ConvRec {
	const key = `${agent}/${session}`;
	let c = bv.convs.get(key);
	if (!c) {
		c = { agent, session, outside: isUntrustedSession(session), busy: false };
		bv.convs.set(key, c);
	}
	return c;
}

/** Takes in what the control API said at `at`. Agents, sources and schedules are replaced; running and pending tasks are set. */
export function applySnapshot(bv: Birdview, snap: Snapshot, at: number): void {
	bv.agents = snap.agents;
	bv.sources = snap.sources;
	bv.schedules = snap.schedules;
	const known = new Set(snap.agents.map((a) => a.id));
	for (const [key, c] of bv.convs) if (!known.has(c.agent)) bv.convs.delete(key);
	for (const [agent, list] of Object.entries(snap.conversations)) {
		for (const c of list) {
			const rec = conv(bv, agent, c.session);
			if (c.outside) rec.outside = true;
		}
	}
	for (const c of bv.convs.values()) c.busy = false;
	for (const s of snap.status.sessions) {
		const rec = conv(bv, s.agent, s.session);
		if (s.tainted || s.trust !== "owner") rec.outside = true;
		rec.busy = s.busy;
	}
	const running = new Set(snap.status.running.map((r) => r.task));
	const pending = new Set(snap.pending.map((t) => t.id));
	// A task that the daemon no longer runs nor holds ended while nobody was listening.
	for (const t of bv.tasks.values()) {
		if ((t.state === "working" || t.state === "queued") && t.at <= at && !running.has(t.id) && !pending.has(t.id)) end(bv, t, "done", at);
	}
	for (const r of snap.status.running) {
		const t = bv.tasks.get(r.task);
		if (t) t.state = "working";
		else bv.tasks.set(r.task, { id: r.task, agent: r.agent, session: r.session, kind: r.kind, untrusted: isUntrustedSession(r.session), state: "working", at, waiting: new Set() });
	}
	for (const p of snap.pending) {
		if (!bv.tasks.has(p.id)) bv.tasks.set(p.id, { id: p.id, agent: p.agent, session: p.session, kind: p.kind, parent: p.parent, untrusted: p.meta.trust === "untrusted" || isUntrustedSession(p.session), state: "queued", at, waiting: new Set() });
	}
}

function end(bv: Birdview, t: TaskRec, how: "done" | "failed", at: number): void {
	t.state = how;
	t.endedAt = at;
	t.tool = undefined;
	t.waiting.clear();
	if (!isChild(t.kind)) {
		const c = conv(bv, t.agent, t.session);
		c.endedAt = at;
		c.ended = how;
		c.busy = false;
	}
}

const TASK_TOPIC = /^agent\/([^/]+)\/(queued|started|done|failed|tool|delta|thinking|message)$/;

/** The node a task is drawn as. */
const nodeOfTask = (t: TaskRec) => (isChild(t.kind) ? `task:${t.id}` : convId(t.agent, t.session));

function task(bv: Birdview, p: any, e: PineEvent): TaskRec | undefined {
	if (typeof p?.task !== "number") return undefined;
	let t = bv.tasks.get(p.task);
	if (!t && typeof p.agent === "string" && typeof p.session === "string") {
		t = { id: p.task, agent: p.agent, session: p.session, kind: String(p.kind ?? "prompt"), parent: p.parent, untrusted: false, state: "queued", at: e.ts, waiting: new Set() };
		bv.tasks.set(p.task, t);
	}
	if (t && (e.trust !== "owner" || isUntrustedSession(t.session))) t.untrusted = true;
	return t;
}

/** The first text a payload carries that says what it is about, for a hover. */
function aboutOf(p: any): unknown {
	if (!p || typeof p !== "object") return undefined;
	for (const k of ["subject", "title", "summary", "text", "message", "label", "name"]) if (typeof p[k] === "string" && p[k]) return p[k];
	return undefined;
}

function subscriberNode(s: string): string {
	const [agent, ...rest] = s.split("/");
	return rest.length ? convId(agent, rest.join("/")) : `agent:${agent}`;
}

/** Takes in events of the stream, in order. `replay` marks those read from the stored trail on opening. */
export function applyEvents(bv: Birdview, events: PineEvent[], opts: { replay?: boolean } = {}): void {
	const replayed = !!opts.replay;
	let latest = 0;
	for (const e of events) {
		const m = TASK_TOPIC.exec(e.topic);
		if (m && (m[2] === "delta" || m[2] === "thinking" || m[2] === "message")) continue;
		latest = Math.max(latest, e.ts);
		count(bv, e.ts);
		const p = e.payload ?? {};
		const pulse = (kind: PulseKind, label: string, to: string[], from?: string, hover?: Hover) => bv.pulses.push({ id: e.id, kind, topic: e.topic, from, to, label, hover, ts: e.ts, replayed });
		if (m) {
			const [, agent, what] = m;
			if (!bv.agents.some((a) => a.id === agent)) bv.agents = [...bv.agents, { id: agent, main: false, description: "", workspace: "", model: "", mode: "safe", thinking: "", delegates: [] }];
			const t = task(bv, p, e);
			if (!t) continue;
			const node = nodeOfTask(t);
			if (what === "queued") {
				if (t.state !== "working") t.state = "queued";
				if (!isChild(t.kind)) conv(bv, t.agent, t.session).endedAt = undefined;
				pulse("queued", "queued", [node], undefined, hoverText(p.label, e.trust));
			} else if (what === "started") {
				t.state = "working";
				t.at = e.ts;
				if (!isChild(t.kind)) {
					const c = conv(bv, t.agent, t.session);
					c.endedAt = undefined;
					if (t.untrusted) c.outside = true;
				}
				pulse("started", "started", [node], undefined, hoverText(p.label, e.trust));
			} else if (what === "done" || what === "failed") {
				end(bv, t, what, e.ts);
				pulse(what, what, [node]);
			} else if (what === "tool") {
				if (p.phase === "start") {
					t.tool = { call: String(p.call), name: String(p.tool) };
					pulse("tool", String(p.tool), [node], undefined, hoverText(p.subject, e.trust));
				} else if (p.phase === "end" && t.tool?.call === String(p.call)) t.tool = undefined;
			}
			continue;
		}
		if (e.topic === "approval/requested") {
			const t = bv.tasks.get(p.task);
			if (!t) continue;
			t.waiting.add(String(p.id));
			bv.approvals.set(String(p.id), t.id);
			pulse("approval", String(p.tool ?? "approval"), [nodeOfTask(t)], undefined, hoverText(p.summary, e.trust));
			continue;
		}
		if (e.topic === "approval/decided") {
			const id = String(p.id);
			const t = bv.tasks.get(bv.approvals.get(id) ?? -1);
			t?.waiting.delete(id);
			bv.approvals.delete(id);
			continue;
		}
		if (e.topic === "pine/conversation") {
			const key = `${p.agent}/${p.session}`;
			const c = bv.convs.get(key);
			if (p.change === "remove") {
				bv.convs.delete(key);
				for (const [id, t] of bv.tasks) if (t.agent === p.agent && t.session === p.session) bv.tasks.delete(id);
			} else if (p.change === "rename" && typeof p.to === "string") {
				bv.convs.delete(key);
				if (c) bv.convs.set(`${p.agent}/${p.to}`, { ...c, session: p.to });
				for (const t of bv.tasks.values()) if (t.agent === p.agent && t.session === p.session) t.session = p.to;
			}
			continue;
		}
		const out = /^out\/source\/(.+)$/.exec(e.topic);
		if (out) {
			pulse("send", "send", [`source:${out[1]}`], typeof p.agent === "string" ? `agent:${p.agent}` : undefined, hoverText(aboutOf(p), e.trust));
			continue;
		}
		const src = /^source\/([^/]+)\/(.+)$/.exec(e.topic);
		if (src) {
			const info = bv.sources.find((s) => sourceKey(s) === src[1]);
			pulse("source", src[2], (info?.subscribers ?? []).map(subscriberNode), `source:${src[1]}`, hoverText(aboutOf(p), e.trust));
			continue;
		}
		const schedule = bv.schedules.find((s) => s.topic === e.topic);
		if (schedule) {
			const to = scheduleTarget(bv, schedule);
			pulse("schedule", schedule.name, to ? [to] : [], `schedule:${sourceKey(schedule)}`, hoverText(p.task, e.trust));
			continue;
		}
		pulse("event", e.topic, [], undefined, hoverText(aboutOf(p), e.trust));
	}
	if (latest) prune(bv, latest);
}

function scheduleTarget(bv: Birdview, s: Schedule): string | undefined {
	if (s.scope !== "global") return `agent:${s.scope}`;
	const main = bv.agents.find((a) => a.main);
	return s.task && main ? `agent:${main.id}` : undefined;
}

const slotSize = (bv: Birdview) => bv.opts.window / bv.opts.buckets;

function count(bv: Birdview, ts: number): void {
	const slot = Math.floor(ts / slotSize(bv));
	bv.slots.set(slot, (bv.slots.get(slot) ?? 0) + 1);
}

/** Keeps the model bounded under a burst: old pulses, old buckets and tasks done long ago go. */
function prune(bv: Birdview, now: number): void {
	const { window, fade, maxPulses, maxTasks } = bv.opts;
	bv.pulses = bv.pulses.filter((p) => now - p.ts <= window);
	if (bv.pulses.length > maxPulses) {
		bv.pulses.sort((a, b) => a.ts - b.ts);
		bv.pulses = bv.pulses.slice(-maxPulses);
	}
	const oldest = Math.floor((now - window) / slotSize(bv)) - 1;
	for (const slot of bv.slots.keys()) if (slot < oldest) bv.slots.delete(slot);
	const finished = [...bv.tasks.values()].filter((t) => t.endedAt !== undefined);
	for (const t of finished) if (now - t.endedAt! > fade) bv.tasks.delete(t.id);
	if (bv.tasks.size > maxTasks) {
		const left = finished.filter((t) => bv.tasks.has(t.id)).sort((a, b) => a.endedAt! - b.endedAt!);
		for (const t of left.slice(0, bv.tasks.size - maxTasks)) bv.tasks.delete(t.id);
	}
}

const RANK: Record<State, number> = { idle: 0, queued: 1, working: 2, waiting: 3 };
const stronger = (a: State, b: State) => (RANK[b] > RANK[a] ? b : a);
const taskState = (t: TaskRec): State => (t.waiting.size ? "waiting" : t.state === "working" ? "working" : t.state === "queued" ? "queued" : "idle");

/** The model as it is at `now`: what the view draws. */
export function view(bv: Birdview, now: number): BirdviewModel {
	const { fade, window, pulseLife, buckets } = bv.opts;
	const fading = (endedAt: number | undefined) => (endedAt === undefined ? 0 : Math.max(0, 1 - (now - endedAt) / fade));
	const agentState = new Map<string, State>();
	const agentTool = new Map<string, { name: string; at: number }>();
	const convState = new Map<string, State>();
	const convTool = new Map<string, string>();
	for (const t of bv.tasks.values()) {
		const s = taskState(t);
		agentState.set(t.agent, stronger(agentState.get(t.agent) ?? "idle", s));
		if (t.tool && t.state === "working" && (agentTool.get(t.agent)?.at ?? -1) <= t.at) agentTool.set(t.agent, { name: t.tool.name, at: t.at });
		if (!isChild(t.kind)) {
			const key = `${t.agent}/${t.session}`;
			convState.set(key, stronger(convState.get(key) ?? "idle", s));
			if (t.tool && t.state === "working") convTool.set(key, t.tool.name);
		}
	}
	const satellites: Satellite[] = [];
	const outsideAgents = new Set<string>();
	const idle = new Map<string, number>();
	for (const [key, c] of bv.convs) {
		let state = convState.get(key) ?? "idle";
		if (state === "idle" && c.busy) state = "working";
		if (state !== "idle") agentState.set(c.agent, stronger(agentState.get(c.agent) ?? "idle", state));
		if (c.outside) outsideAgents.add(c.agent);
		const opacity = state === "idle" ? fading(c.endedAt) : 1;
		if (opacity <= 0) {
			idle.set(c.agent, (idle.get(c.agent) ?? 0) + 1);
			continue;
		}
		satellites.push({ id: convId(c.agent, c.session), kind: "conversation", agent: c.agent, session: c.session, state, tool: convTool.get(key), ended: state === "idle" ? c.ended : undefined, untrusted: isUntrustedSession(c.session), outside: c.outside, opacity });
	}
	const links: Link[] = [];
	for (const t of bv.tasks.values()) {
		if (!isChild(t.kind)) continue;
		const state = taskState(t);
		const opacity = state === "idle" ? fading(t.endedAt) : 1;
		if (opacity <= 0) continue;
		if (t.untrusted) outsideAgents.add(t.agent);
		satellites.push({ id: `task:${t.id}`, kind: t.kind as "subagent" | "delegate", agent: t.agent, session: t.session, state, tool: t.tool?.name, ended: state === "idle" && t.state !== "queued" && t.state !== "working" ? t.state : undefined, untrusted: t.untrusted, outside: t.untrusted, opacity });
		const parent = t.parent === undefined ? undefined : bv.tasks.get(t.parent);
		if (parent) links.push({ id: `${t.kind === "delegate" ? "delegation" : "subagent"}:${t.id}`, kind: t.kind === "delegate" ? "delegation" : "subagent", from: nodeOfTask(parent), to: `task:${t.id}`, opacity });
	}
	const agents: AgentNode[] = bv.agents.map((a) => ({ id: a.id, main: a.main, state: agentState.get(a.id) ?? "idle", tool: agentTool.get(a.id)?.name, outside: outsideAgents.has(a.id), idle: idle.get(a.id) ?? 0 }));
	const sources: SourceNode[] = bv.sources.map((s) => ({ id: `source:${sourceKey(s)}`, name: s.name, scope: s.scope, type: s.type, running: s.running, trust: s.trust }));
	const schedules: ScheduleNode[] = bv.schedules.map((s) => ({ id: `schedule:${sourceKey(s)}`, name: s.name, scope: s.scope, when: s.when, next: s.next }));
	const lasting: Link[] = [];
	for (const s of bv.sources) for (const sub of s.subscribers) lasting.push({ id: `subscription:${sourceKey(s)}>${sub}`, kind: "subscription", from: `source:${sourceKey(s)}`, to: subscriberNode(sub), opacity: 1 });
	for (const s of bv.schedules) {
		const to = scheduleTarget(bv, s);
		if (to) lasting.push({ id: `schedule:${sourceKey(s)}`, kind: "schedule", from: `schedule:${sourceKey(s)}`, to, opacity: 1 });
	}
	const pulses: Pulse[] = bv.pulses
		.filter((p) => now - p.ts <= window && p.ts <= now)
		.map((p) => {
			const age = now - p.ts;
			const bright = age < pulseLife ? 1 - (0.7 * age) / pulseLife : 0.3 * (1 - age / window);
			return { ...p, age, opacity: bright * (p.replayed ? 0.5 : 1) };
		});
	const size = slotSize(bv);
	const last = Math.ceil(now / size);
	const counts = Array.from({ length: buckets }, (_, i) => bv.slots.get(last - buckets + i) ?? 0);
	return { now, agents, satellites, sources, schedules, links: [...lasting, ...links], pulses, histogram: { end: last * size, size, counts } };
}
