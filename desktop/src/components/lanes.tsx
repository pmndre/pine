import { cn } from "cn";
import { type ReactNode, useRef, useState, type RefObject } from "react";
import { useResizeObserver } from "usehooks-ts";
import type { BirdviewModel, Pulse } from "../birdview.ts";
import type { DrawProps } from "../Birdview.tsx";
import { lineTone, type Tone } from "./birdview-tone.ts";

// Direction C of the bird's-eye view, the lanes: a live timeline in the manner of a trace viewer.
// One lane per agent, "now" at the right edge, the window's past running off to the left. A task is
// a bar from queued (hatched) to started (solid) to its end; tool calls are notches in it; the
// conversations an agent works in open sub-rows under it while they are active. Events from sources
// and schedules are marks on an inputs lane at the top, with a thread down to the task they woke;
// a delegation is an arc from one lane to another. Everything is read from the model's pulses, so the
// trail that the view replays on opening is drawn the same way as what happens live.

/** A task as the timeline draws it: when it was queued, started and ended, and what happened in it. */
interface Bar {
	key: string;
	node: string;
	agent: string;
	queued: number;
	started?: number;
	ended?: number;
	end?: "done" | "failed";
	ticks: Array<{ ts: number; label: string; pulse: number }>;
	waits: Array<{ from: number; to?: number; pulse: number }>;
	outside: boolean;
	replayed: boolean;
	/** The pulse a hover on the bar describes: its start, or its queueing. */
	pulse: number;
}

interface Arc {
	key: string;
	hover: string;
	from: { node: string; ts: number };
	to: { node: string; ts: number };
	sameAgent: boolean;
}

interface Thread {
	key: string;
	pulse: Pulse;
	to?: { node: string; ts: number };
	/** A `send` goes up, from the task to the source. */
	up: boolean;
}

const TASK_TOPIC = /^agent\/([^/]+)\//;
/** How long after an event a task it woke may start being queued, ms. */
const CAUSE = 5000;

function agentOfNode(node: string, known: Map<string, string>): string | undefined {
	if (node.startsWith("agent:")) return node.slice(6);
	if (node.startsWith("conv:")) return node.slice(5).split("/")[0];
	return known.get(node);
}

/** The bars, arcs and threads of the timeline, from the model's pulses. */
export function timeline(model: BirdviewModel) {
	const pulses = [...model.pulses].sort((a, b) => a.ts - b.ts || a.id - b.id);
	const nodeAgent = new Map<string, string>();
	for (const p of pulses) {
		const m = TASK_TOPIC.exec(p.topic);
		if (m && p.to[0]) nodeAgent.set(p.to[0], m[1]);
	}
	for (const s of model.satellites) nodeAgent.set(s.id, s.agent);
	const waiting = new Set(model.satellites.filter((s) => s.state === "waiting").map((s) => s.id));
	for (const a of model.agents) if (a.state === "waiting") waiting.add(`agent:${a.id}`);

	const bars: Bar[] = [];
	const open = new Map<string, Bar>();
	const close = (b: Bar, ts: number, end?: "done" | "failed") => {
		b.ended = ts;
		b.end = end;
		for (const w of b.waits) w.to ??= ts;
		open.delete(b.node);
	};
	const begin = (p: Pulse, node: string, agent: string, startedToo: boolean) => {
		const b: Bar = { key: `${node}@${p.id}`, node, agent, queued: p.ts, started: startedToo ? p.ts : undefined, ticks: [], waits: [], outside: node.includes("~u") || !!p.hover?.outside, replayed: p.replayed, pulse: p.id };
		bars.push(b);
		open.set(node, b);
		return b;
	};
	for (const p of pulses) {
		const node = p.to[0];
		if (!node) continue;
		if (!["queued", "started", "done", "failed", "tool", "approval"].includes(p.kind)) continue;
		const agent = agentOfNode(node, nodeAgent);
		if (!agent) continue;
		let b = open.get(node);
		if (p.kind === "queued") {
			if (b) close(b, p.ts);
			begin(p, node, agent, false);
		} else if (p.kind === "started") {
			if (b && b.started === undefined) {
				b.started = p.ts;
				b.pulse = p.id;
			} else {
				if (b) close(b, p.ts);
				b = begin(p, node, agent, true);
			}
			if (p.hover?.outside) b.outside = true;
		} else if (p.kind === "done" || p.kind === "failed") {
			if (b) close(b, p.ts, p.kind);
		} else {
			b ??= begin(p, node, agent, true);
			b.started ??= p.ts;
			if (p.hover?.outside) b.outside = true;
			if (p.kind === "tool") {
				for (const w of b.waits) w.to ??= p.ts;
				b.ticks.push({ ts: p.ts, label: p.label, pulse: p.id });
			} else b.waits.push({ from: p.ts, pulse: p.id });
		}
	}
	// A bar still open runs to now; a wait on it does too only while the model says it waits.
	for (const b of open.values()) {
		const last = Math.max(b.queued, b.started ?? 0, ...b.ticks.map((t) => t.ts));
		for (const w of b.waits) if (w.to === undefined && !waiting.has(b.node) && !waiting.has(`agent:${b.agent}`)) w.to = last;
	}

	// Delegations and sub-agents: the model's links while they live, and in the trail a `delegate` or
	// `subagent` call followed closely by a task queued on a node of its own.
	const arcs: Arc[] = [];
	const firstOf = new Map<string, Bar>();
	for (const b of bars) if (!firstOf.has(b.node)) firstOf.set(b.node, b);
	const linked = new Set<string>();
	for (const l of model.links) {
		if (l.kind !== "delegation" && l.kind !== "subagent") continue;
		const to = firstOf.get(l.to);
		if (!to) continue;
		const from = bars.findLast((b) => b.node === l.from && b.queued <= to.queued) ?? firstOf.get(l.from);
		const call = from?.ticks.findLast((t) => t.ts <= to.queued && (t.label === "delegate" || t.label === "subagent"));
		linked.add(l.to);
		arcs.push({ key: `link:${l.id}`, hover: `link:${l.id}`, from: { node: l.from, ts: call?.ts ?? to.queued }, to: { node: l.to, ts: to.queued }, sameAgent: l.kind === "subagent" });
	}
	for (const b of bars) {
		for (const t of b.ticks) {
			if (t.label !== "delegate" && t.label !== "subagent") continue;
			const to = bars.find((x) => x.node.startsWith("task:") && !linked.has(x.node) && x.node !== b.node && x.queued >= t.ts && x.queued - t.ts < 3000);
			if (!to) continue;
			linked.add(to.node);
			arcs.push({ key: `arc:${t.pulse}`, hover: `pulse:${t.pulse}`, from: { node: b.node, ts: t.ts }, to: { node: to.node, ts: to.queued }, sameAgent: to.agent === b.agent });
		}
	}

	// Threads from an input to the task it woke, and from a task up to the source it sent through.
	const threads: Thread[] = [];
	for (const p of pulses) {
		if (p.kind === "source" || p.kind === "schedule") {
			const agents = new Set(p.to.flatMap((n) => agentOfNode(n, nodeAgent) ?? []));
			const caused = bars.filter((b) => agents.has(b.agent) && b.queued >= p.ts && b.queued - p.ts < CAUSE && !b.node.startsWith("task:"));
			// One thread per agent woken: its first task after the event.
			const seen = new Set<string>();
			for (const b of caused) {
				if (seen.has(b.agent)) continue;
				seen.add(b.agent);
				threads.push({ key: `${p.id}>${b.key}`, pulse: p, to: { node: b.node, ts: b.queued }, up: false });
			}
			if (!seen.size) threads.push({ key: `${p.id}`, pulse: p, up: false });
		} else if (p.kind === "send" || p.kind === "event") {
			const agent = p.from?.startsWith("agent:") ? p.from.slice(6) : undefined;
			const b = agent ? bars.findLast((x) => x.agent === agent && x.queued <= p.ts && (x.ended ?? Infinity) >= p.ts) : undefined;
			threads.push({ key: `${p.id}`, pulse: p, to: b && { node: b.node, ts: p.ts }, up: true });
		}
	}
	return { bars, arcs, threads };
}

/**
 * Where a moment lands: the last `focus` ms take the right two thirds of the width, the rest of the
 * window the left third, so that what is happening now has room and the fifteen minutes still fit.
 */
const KNEE = 0.34;
function timeScale(now: number, window: number, focus: number, width: number) {
	const knee = focus >= window ? 0 : width * KNEE;
	return (ts: number) => {
		const age = Math.max(0, now - ts);
		if (focus >= window) return width * (1 - age / window);
		if (age <= focus) return width - (age / focus) * (width - knee);
		return knee * Math.max(0, 1 - (age - focus) / (window - focus));
	};
}

const HEAD = 148;
const AXIS = 22;
const INPUTS = 44;
const NOW_PAD = 76;
/** What stays a sub-row after its conversation has gone idle, ms. */
const LINGER = 45_000;

const QUIET: Tone = { stroke: "stroke-muted-foreground", fill: "fill-muted-foreground", bg: "bg-muted-foreground" };
const SCHEDULE: Tone = QUIET;

function ticksFor(focus: number, window: number): number[] {
	const all = [5_000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000];
	const near = all.filter((t) => t < focus).slice(-2);
	const far = all.filter((t) => t >= focus && t <= window);
	return [...near, ...far.filter((t, i) => i === 0 || t === window || t === 300_000)];
}

const ago = (ms: number) => (ms < 60_000 ? `${ms / 1000}s` : `${ms / 60_000}m`);

export function Lanes({ model, hovered, onHover, onPick }: DrawProps) {
	const box = useRef<HTMLDivElement>(null);
	const { width = 0, height = 0 } = useResizeObserver({ ref: box as RefObject<HTMLDivElement> });
	const window = model.histogram.size * model.histogram.counts.length;
	const [focus, setFocus] = useState(30_000);
	const { bars, arcs, threads } = timeline(model);
	const now = model.now;
	const plot = Math.max(0, width - HEAD - NOW_PAD);
	const scale = timeScale(now, window, focus, plot);
	const x = (ts: number) => HEAD + scale(ts);
	const sourceTypes = model.sources.map((s) => s.type);
	const toneOfSource = (id: string | undefined) => {
		const s = model.sources.find((x) => x.id === id);
		return s ? lineTone(sourceTypes, s.type) : SCHEDULE;
	};
	const satellite = new Map(model.satellites.map((s) => [s.id, s]));

	// Rows: a lane per agent, its spine first, then a sub-row for each node active lately.
	const rows: Array<{ node: string; agent: string; lane: boolean }> = [];
	for (const a of model.agents) {
		rows.push({ node: `agent:${a.id}`, agent: a.id, lane: true });
		const nodes: string[] = [];
		for (const b of bars) {
			if (b.agent !== a.id || b.node === `agent:${a.id}` || nodes.includes(b.node)) continue;
			const live = b.ended === undefined || now - b.ended < LINGER || satellite.has(b.node);
			if (live) nodes.push(b.node);
		}
		for (const s of model.satellites) if (s.agent === a.id && !nodes.includes(s.id) && s.state !== "idle") nodes.push(s.id);
		for (const n of nodes) rows.push({ node: n, agent: a.id, lane: false });
	}
	const lanes = model.agents.length;
	const subs = rows.length - lanes;
	const space = Math.max(0, height - AXIS - INPUTS - 8);
	const k = Math.min(2.4, Math.max(0.8, space / Math.max(1, lanes * 34 + subs * 24 + lanes * 8)));
	const laneH = 34 * k;
	const subH = 24 * k;
	const gap = 8 * k;
	/** Rows grow to fill the height; bars stop growing sooner, so that a quiet pine does not get fat bars. */
	const barH = 14 * Math.min(k, 1.3);
	const top = new Map<string, number>();
	let y = AXIS + INPUTS + 6;
	const laneBox = new Map<string, { y: number; h: number }>();
	for (const r of rows) {
		if (r.lane && laneBox.size) y += gap;
		if (r.lane) laneBox.set(r.agent, { y, h: 0 });
		top.set(r.node, y);
		y += r.lane ? laneH : subH;
		laneBox.get(r.agent)!.h = y - laneBox.get(r.agent)!.y;
	}
	const total = y + 8;
	/** The middle of the row a node is drawn in: its own, or its agent's spine when it has none. */
	const rowY = (node: string, agent?: string) => {
		const own = top.get(node);
		if (own !== undefined) return own + (node.startsWith("agent:") ? laneH : subH) / 2;
		const a = agent ?? agentOfNode(node, new Map(bars.map((b) => [b.node, b.agent])));
		return (top.get(`agent:${a}`) ?? AXIS + INPUTS) + laneH / 2;
	};
	const hasRow = (node: string) => top.has(node) && !node.startsWith("agent:");

	const hoverProps = (id: string) => ({ onMouseEnter: () => onHover(id), onMouseLeave: () => onHover(undefined), onClick: () => onPick(id) });
	const visible = (from: number, to: number) => to >= now - window && from <= now;
	// An input mark is named only where the name has room, the newest first.
	const named = new Set<string>();
	let room = Infinity;
	for (const t of [...threads].sort((a, b) => b.pulse.ts - a.pulse.ts)) {
		const at = x(t.pulse.ts);
		if (t.pulse.age >= focus || room - at < 56) continue;
		named.add(t.key);
		room = at;
	}

	return (
		<div
			ref={box}
			data-slot="lanes"
			className="absolute inset-0 overflow-y-auto overflow-x-hidden"
			onWheel={(e) => {
				if (!e.shiftKey && !e.altKey) return;
				setFocus((f) => Math.min(window, Math.max(10_000, f * (e.deltaY > 0 ? 1.25 : 0.8))));
			}}
		>
			{width > 0 ? (
				<svg width={width} height={Math.max(height, total)} className="block select-none" role="img" aria-label="Agents on a timeline">
					<defs>
						<pattern id="lanes-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
							<line x1="0" y1="0" x2="0" y2="6" className="stroke-muted-foreground" strokeWidth="1.5" />
						</pattern>
						<pattern id="lanes-stripe" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
							<rect width="3.5" height="8" className="fill-background" opacity="0.6" />
						</pattern>
						<pattern id="lanes-amber" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
							<rect width="8" height="8" className="fill-chart-4" />
							<rect width="3" height="8" className="fill-background" opacity="0.25" />
						</pattern>
						<linearGradient id="lanes-fade" x1="0" x2="1">
							<stop offset="0" stopColor="white" stopOpacity="0.15" />
							<stop offset="0.35" stopColor="white" stopOpacity="1" />
						</linearGradient>
						<mask id="lanes-past">
							<rect x={HEAD} y="0" width={plot + NOW_PAD} height={Math.max(height, total)} fill="url(#lanes-fade)" />
						</mask>
						<marker id="lanes-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
							<path d="M0 0 L8 4 L0 8 z" className="fill-chart-3" />
						</marker>
					</defs>

					{/* Lane backgrounds and the inputs lane. */}
					<rect x={0} y={AXIS} width={width} height={INPUTS} className="fill-muted" opacity="0.6" />
					<text x={16} y={AXIS + INPUTS / 2} dominantBaseline="middle" className="fill-muted-foreground text-[11px] font-medium tracking-widest uppercase">
						Inputs
					</text>
					{model.agents.map((a, i) => {
						const lb = laneBox.get(a.id)!;
						return <rect key={a.id} x={0} y={lb.y - gap / 2} width={width} height={lb.h + gap} className={i % 2 ? "fill-muted" : "fill-transparent"} opacity="0.35" />;
					})}

					{/* The time axis: the knee where the scale changes, and how long ago each line is. */}
					<g className="text-[10px]">
						{focus < window ? <rect x={HEAD} y={AXIS} width={plot * KNEE} height={total - AXIS} className="fill-foreground" opacity="0.025" /> : null}
						{ticksFor(focus, window).map((t) => (
							<g key={t}>
								<line x1={x(now - t)} x2={x(now - t)} y1={AXIS - 4} y2={total} className="stroke-border" strokeDasharray="2 4" />
								<text x={x(now - t)} y={AXIS - 8} textAnchor="middle" className="fill-muted-foreground tabular-nums">
									-{ago(t)}
								</text>
							</g>
						))}
						<text x={16} y={AXIS - 8} className="fill-muted-foreground">
							{focus < window ? `last ${ago(focus)} enlarged` : "linear"}
						</text>
					</g>

					<g mask="url(#lanes-past)">
						{/* Threads from inputs down to the tasks they woke, under everything else. */}
						{threads.map((t) => {
							if (!t.to || !visible(t.pulse.ts, t.pulse.ts)) return null;
							const x1 = x(t.pulse.ts);
							const x2 = x(t.to.ts);
							const y1 = AXIS + INPUTS / 2;
							const y2 = rowY(t.to.node);
							const tone = t.pulse.kind === "send" ? toneOfSource(t.pulse.to[0]) : toneOfSource(t.pulse.from);
							const on = hovered === `pulse:${t.pulse.id}`;
							return (
								<path
									key={t.key}
									d={`M${x1} ${y1} C${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`}
									className={cn("fill-none", tone.stroke)}
									strokeWidth={on ? 2 : 1}
									strokeDasharray={t.up ? "3 3" : undefined}
									opacity={on ? 1 : t.pulse.age < focus ? 0.8 : 0.35 * Math.max(0.4, t.pulse.opacity)}
								/>
							);
						})}

						{/* Lane spines. */}
						{model.agents.map((a) => (
							<line key={a.id} x1={HEAD} x2={HEAD + plot} y1={rowY(`agent:${a.id}`)} y2={rowY(`agent:${a.id}`)} className="stroke-border" strokeWidth="1" />
						))}

						{/* Bars: on their sub-row when it is shown, and always, thinner, on the agent's spine. */}
						{bars.flatMap((b) => {
							const end = b.ended ?? now;
							if (!visible(b.queued, end)) return [];
							const out: ReactNode[] = [];
							const spine = <TaskBar key={`${b.key}:spine`} bar={b} x={x} now={now} y={rowY(`agent:${b.agent}`)} h={hasRow(b.node) ? 6 : barH} ghost={hasRow(b.node)} hovered={hovered} hoverProps={hoverProps} />;
							out.push(spine);
							if (hasRow(b.node)) out.push(<TaskBar key={b.key} bar={b} x={x} now={now} y={rowY(b.node)} h={barH} hovered={hovered} hoverProps={hoverProps} tip={satellite.get(b.node)?.tool ?? (b.node.startsWith("agent:") ? undefined : "")} />);
							return out;
						})}

						{/* Delegations and sub-agents: arcs from the call to the task it queued. */}
						{arcs.map((a) => {
							if (!visible(a.from.ts, a.to.ts)) return null;
							const x1 = x(a.from.ts);
							const x2 = x(a.to.ts);
							const y1 = rowY(a.from.node);
							const y2 = rowY(a.to.node);
							const bend = Math.min(90, Math.abs(y2 - y1) * 0.45 + 18);
							const on = hovered === a.hover;
							return (
								<g key={a.key} className="cursor-pointer" {...hoverProps(a.hover)}>
									<path d={`M${x1} ${y1} C${x1 - bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} className="fill-none stroke-transparent" strokeWidth="10" />
									<path d={`M${x1} ${y1} C${x1 - bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} className="fill-none stroke-chart-3" strokeWidth={on ? 3 : 2} markerEnd="url(#lanes-arrow)" />
									<circle cx={x1} cy={y1} r="3" className="fill-chart-3" />
								</g>
							);
						})}
					</g>

					{/* Input marks: a diamond for a source's event, a circle for a schedule, a triangle for a send. */}
					{threads.map((t) => {
						const p = t.pulse;
						if (!visible(p.ts, p.ts)) return null;
						const cx = x(p.ts);
						const cy = AXIS + INPUTS / 2;
						const tone = p.kind === "send" ? toneOfSource(p.to[0]) : toneOfSource(p.from);
						const id = `pulse:${p.id}`;
						const on = hovered === id;
						const fresh = p.age < 1500;
						const r = on ? 7 : 5.5;
						const name = (p.kind === "send" ? p.to[0] : p.from)?.replace(/^\w+:/, "");
						return (
							<g key={t.key} className="cursor-pointer" opacity={Math.max(0.25, Math.min(1, p.opacity * 1.3))} {...hoverProps(id)}>
								{fresh ? <circle cx={cx} cy={cy} r={6 + (p.age / 1500) * 14} className={cn("fill-none", tone.stroke)} opacity={1 - p.age / 1500} strokeWidth="2" /> : null}
								{p.kind === "source" ? (
									<rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} transform={`rotate(45 ${cx} ${cy})`} className={tone.fill} />
								) : p.kind === "send" ? (
									<path d={`M${cx} ${cy - r - 1} L${cx + r} ${cy + r - 1} L${cx - r} ${cy + r - 1} z`} className={cn("fill-background stroke-2", tone.stroke)} />
								) : (
									<circle cx={cx} cy={cy} r={r - 0.5} className={cn("fill-background stroke-2", p.kind === "schedule" ? "stroke-muted-foreground" : "stroke-border")} />
								)}
								{named.has(t.key) && name ? (
									<text x={cx} y={cy + 17} textAnchor="middle" className="fill-muted-foreground text-[10px]">
										{name}
									</text>
								) : null}
							</g>
						);
					})}

					{/* Lane headers: pine's words only. */}
					<rect x={0} y={AXIS + INPUTS} width={HEAD - 6} height={total} className="fill-background" opacity="0.88" />
					{rows.map((r) => {
						const cy = rowY(r.node);
						if (r.lane) {
							const a = model.agents.find((x) => x.id === r.agent)!;
							const dot = a.state === "waiting" ? "fill-chart-4" : a.state === "working" ? "fill-primary" : a.state === "queued" ? "fill-muted-foreground" : "fill-border";
							return (
								<g key={r.node} className="cursor-pointer" {...hoverProps(r.node)}>
									<rect x={0} y={cy - laneH / 2} width={HEAD - 6} height={laneH} className="fill-transparent" />
									<circle cx={20} cy={cy} r={5} className={cn(dot, a.state !== "idle" && "animate-pulse")} />
									<text x={34} y={cy} dominantBaseline="central" className={cn("fill-foreground text-sm", a.main ? "font-bold" : "font-semibold", hovered === r.node && "underline")}>
										{a.id}
									</text>
									{a.outside ? (
										<g>
											<rect x={HEAD - 26} y={cy - 6} width={12} height={12} rx={2} className="fill-chart-5" />
											<rect x={HEAD - 26} y={cy - 6} width={12} height={12} rx={2} fill="url(#lanes-stripe)" />
										</g>
									) : null}
								</g>
							);
						}
						const s = satellite.get(r.node);
						const label = s ? s.session : r.node.startsWith("conv:") ? r.node.slice(5).split("/").slice(1).join("/") : "task";
						const kind = s?.kind === "delegate" ? "delegated" : s?.kind === "subagent" ? "sub-agent" : r.node.startsWith("task:") ? "task" : undefined;
						return (
							<g key={r.node} className="cursor-pointer" {...hoverProps(r.node)} opacity={s ? Math.max(0.5, s.opacity) : 0.6}>
								<line x1={22} x2={22} y1={cy - subH / 2} y2={cy} className="stroke-border" />
								<line x1={22} x2={30} y1={cy} y2={cy} className="stroke-border" />
								<text x={34} y={cy} dominantBaseline="central" className={cn("fill-muted-foreground text-xs", hovered === r.node && "underline")}>
									{label.length > 12 ? `${label.slice(0, 11)}…` : label}
									{kind ? <tspan className="fill-chart-3 text-[10px]"> {kind}</tspan> : null}
								</text>
							</g>
						);
					})}

					{/* Now. */}
					<line x1={HEAD + plot} x2={HEAD + plot} y1={AXIS - 4} y2={total} className="stroke-primary" strokeWidth="1.5" />
					<rect x={HEAD + plot} y={AXIS} width={NOW_PAD} height={total - AXIS} className="fill-primary" opacity="0.06" />
					<text x={HEAD + plot} y={AXIS - 8} textAnchor="end" className="fill-primary text-[10px] font-semibold">
						now
					</text>
				</svg>
			) : null}
		</div>
	);
}

/** One task: hatched while queued, solid while it runs, notched by its tool calls, amber while it waits for the owner. */
function TaskBar({
	bar: b,
	x,
	now,
	y,
	h,
	ghost,
	tip,
	hovered,
	hoverProps,
}: {
	bar: Bar;
	x: (ts: number) => number;
	now: number;
	y: number;
	h: number;
	ghost?: boolean;
	/** The tool the task calls now, by name, to write at its tip; "" for none. */
	tip?: string;
	hovered?: string;
	hoverProps: (id: string) => object;
}) {
	const id = `pulse:${b.pulse}`;
	const on = hovered === id || hovered === b.node;
	const qx = x(b.queued);
	const sx = b.started === undefined ? undefined : x(b.started);
	const ex = x(b.ended ?? now);
	const live = b.ended === undefined;
	const top = y - h / 2;
	const fill = b.end === "failed" ? "fill-destructive" : "fill-primary";
	const opacity = (b.replayed ? 0.5 : 1) * (ghost ? 0.35 : 1);
	if (ghost) {
		return <rect x={qx} y={top} width={Math.max(2, ex - qx)} height={h} rx={h / 2} className={fill} opacity={opacity} />;
	}
	const running = live && b.started !== undefined;
	const tool = running && tip ? tip : undefined;
	const waiting = live && b.waits.some((w) => w.to === undefined);
	return (
		<g className="cursor-pointer" opacity={opacity} {...hoverProps(id)}>
			{/* Queued: hatched, from the queueing to the start (or to now). */}
			<rect x={qx} y={top} width={Math.max(2, (sx ?? ex) - qx)} height={h} rx={3} fill="url(#lanes-hatch)" className="stroke-muted-foreground" strokeWidth="1" strokeDasharray="2 2" />
			{sx !== undefined ? <rect x={sx} y={top} width={Math.max(2, ex - sx)} height={h} rx={3} className={fill} /> : null}
			{b.outside && sx !== undefined ? <rect x={sx} y={top} width={Math.max(2, ex - sx)} height={h} rx={3} fill="url(#lanes-stripe)" className="stroke-chart-5" strokeWidth="1.5" /> : null}
			{b.waits.map((w) => {
				const wx = x(w.from);
				const wend = x(w.to ?? now);
				return (
					<g key={w.pulse} {...hoverProps(`pulse:${w.pulse}`)}>
						<rect x={wx} y={top - 2} width={Math.max(3, wend - wx)} height={h + 4} rx={3} fill="url(#lanes-amber)" />
						{w.to === undefined ? <path d={`M${wend} ${top - 4} l6 ${h / 2 + 4} l-6 ${h / 2 + 4} z`} className="animate-pulse fill-chart-4" /> : null}
					</g>
				);
			})}
			{b.ticks.map((t) => {
				const tx = x(t.ts);
				return (
					<g key={t.pulse} {...hoverProps(`pulse:${t.pulse}`)}>
						<line x1={tx} x2={tx} y1={top - 3} y2={top + h + 3} className="stroke-foreground" strokeWidth={hovered === `pulse:${t.pulse}` ? 2.5 : 1.5} />
						<rect x={tx - 4} y={top - 3} width={8} height={h + 6} className="fill-transparent" />
					</g>
				);
			})}
			{b.end ? (
				<rect x={ex - 3} y={top - 2} width={3} height={h + 4} rx={1} className={b.end === "failed" ? "fill-destructive" : "fill-foreground"} opacity={b.end === "failed" ? 1 : 0.7} />
			) : null}
			{b.end === "failed" ? (
				<text x={ex + 4} y={y} dominantBaseline="central" className="fill-destructive text-[10px] font-bold">
					failed
				</text>
			) : null}
			{on ? <rect x={qx - 2} y={top - 3} width={Math.max(4, ex - qx + 4)} height={h + 6} rx={4} className="fill-none stroke-foreground" strokeWidth="1.5" /> : null}
			{tip !== undefined && waiting ? (
				<text x={ex + 10} y={y} dominantBaseline="central" className="fill-chart-4 text-[11px] font-bold">
					approval
				</text>
			) : tip && tool ? (
				<text x={ex + 6} y={y} dominantBaseline="central" className="fill-foreground font-mono text-[11px] font-semibold">
					{tool}
				</text>
			) : null}
			{tip !== undefined && live && sx === undefined ? (
				<text x={ex + 6} y={y} dominantBaseline="central" className="fill-muted-foreground text-[10px]">
					queued
				</text>
			) : null}
		</g>
	);
}
