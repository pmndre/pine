import { cn } from "cn";
import { type ReactNode, type RefObject, useRef } from "react";
import { useResizeObserver } from "usehooks-ts";
import type { BirdviewModel, State } from "../birdview.ts";
import type { Point } from "../birdview-layout.ts";
import type { DrawProps } from "../Birdview.tsx";
import { DELEGATION_TONE, lineTone, PULSE_TONE, SCHEDULE_TONE, STATE_TONE, type Tone } from "./birdview-tone.ts";

const TURN = Math.PI * 2;
/** One turn of the sweep, ms. Slow on purpose: the screen is something to glance at. */
const SWEEP = 6000;
/** How far behind the sweep line its afterglow reaches, radians. */
const TRAIL = 1.4;
/** How long an event's blip takes to come in from the rim to its agent, ms; then it ripples. */
const INBOUND = 1800;
const RIPPLE = 1100;
const FLASH = 1300;
/** How far back the range rings go: the model's trail. */
const WINDOW = 15 * 60_000;
/** The age that is half-way out, ms: the scale is logarithmic, so that a minute and a quarter of an hour both read. */
const KNEE = 4000;
/** Where the working agents sit, and where the range starts, as a fraction of the radius. */
const ACTIVE = 0.3;
const NEAR = 0.4;
const FAR = 0.9;
/** The range rings: an age each, labelled. */
const RINGS: ReadonlyArray<{ age: number; label: string }> = [
	{ age: 10_000, label: "10s" },
	{ age: 60_000, label: "1m" },
	{ age: 5 * 60_000, label: "5m" },
	{ age: WINDOW, label: "15m" },
];

/** The fraction of the radius at which something last active `age` ms ago lies. */
function range(age: number): number {
	const f = Math.log1p(Math.max(0, age) / KNEE) / Math.log1p(WINDOW / KNEE);
	return NEAR + (FAR - NEAR) * Math.min(1, f);
}

const polar = (c: Point, r: number, a: number): Point => ({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
/** The signed turn from `a` to `b`, the short way. */
const turnTo = (a: number, b: number) => ((((b - a) % TURN) + TURN + Math.PI) % TURN) - Math.PI;
const wrap = (a: number) => ((a % TURN) + TURN) % TURN;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** A ring segment from `r0` to `r1` between the angles `a0` and `a1` (clockwise on screen). */
function wedge(c: Point, r0: number, r1: number, a0: number, a1: number): string {
	const big = a1 - a0 > Math.PI ? 1 : 0;
	const p = (r: number, a: number) => {
		const q = polar(c, r, a);
		return `${q.x.toFixed(1)},${q.y.toFixed(1)}`;
	};
	if (r0 <= 0) return `M${c.x},${c.y} L${p(r1, a0)} A${r1},${r1} 0 ${big} 1 ${p(r1, a1)} Z`;
	return `M${p(r0, a0)} L${p(r1, a0)} A${r1},${r1} 0 ${big} 1 ${p(r1, a1)} L${p(r0, a1)} A${r0},${r0} 0 ${big} 0 ${p(r0, a0)} Z`;
}

/** The blip of outside content: a triangle, so that it reads without colour. */
const triangle = (p: Point, r: number) =>
	`M${p.x},${p.y - r * 1.25} L${p.x + r * 1.1},${p.y + r * 0.75} L${p.x - r * 1.1},${p.y + r * 0.75} Z`;

/** A blip: a dot, or a triangle when it carries outside content. */
function Blip({ at, r, outside, className, opacity, strokeWidth }: { at: Point; r: number; outside?: boolean; className: string; opacity?: number; strokeWidth?: number }) {
	return outside ? (
		<path d={triangle(at, r)} className={className} opacity={opacity} strokeWidth={strokeWidth} strokeLinejoin="round" />
	) : (
		<circle cx={at.x} cy={at.y} r={r} className={className} opacity={opacity} strokeWidth={strokeWidth} />
	);
}

/** When each agent was last active: the newest pulse that touched it or one of its conversations. */
function lastActive(m: BirdviewModel): Map<string, number> {
	const agentOf = new Map(m.satellites.map((s) => [s.id, s.agent]));
	const owner = (id: string) => (id.startsWith("agent:") ? id.slice(6) : id.startsWith("conv:") ? id.slice(5).split("/")[0] : agentOf.get(id));
	const last = new Map<string, number>();
	for (const p of m.pulses) {
		for (const id of [p.from, ...p.to]) {
			const a = id && owner(id);
			if (a && p.ts > (last.get(a) ?? 0)) last.set(a, p.ts);
		}
	}
	return last;
}

interface Sector {
	id: string;
	/** The middle of its slice, radians. */
	angle: number;
	from: number;
	to: number;
	at: Point;
	r: number;
	state: State;
}

/**
 * Direction C, the radar: pine at the centre, each agent a slice of the screen, and the distance from
 * the centre how long ago it was last active (the range rings are ages), so that the ones at work
 * gather in the middle and the idle ones drift out to the rim. A sweep goes round and wakes what it
 * passes. An event comes in as a blip on the rim, at the bearing of its source, and runs inward to
 * the agent it wakes; conversations are smaller blips in their agent's slice, delegations chords
 * across the screen, an approval blinks amber, and outside content is a triangle, not a dot.
 */
export function Radar({ model, hovered, onHover, onPick }: DrawProps) {
	const box = useRef<HTMLDivElement>(null);
	const { width = 0, height = 0 } = useResizeObserver({ ref: box as RefObject<HTMLDivElement> });
	const c = { x: width / 2, y: height / 2 };
	const narrow = width < 640;
	const R = Math.max(60, Math.min(width / 2 - (narrow ? 40 : 150), height / 2 - 54));
	const now = model.now;
	const sweep = -Math.PI / 2 + ((now % SWEEP) / SWEEP) * TURN;
	/** How bright the sweep left something at `angle`: 1 just after it passed, fading for a turn. */
	const glow = (angle: number) => 0.4 + 0.6 * Math.exp(-wrap(sweep - angle) / 1.8);
	const blink = Math.floor(now / 420) % 2 === 0;

	// Each agent a slice, the main one at the top, the others in the order of their names: a slice never moves.
	const agents = [...model.agents].sort((a, b) => (a.main === b.main ? a.id.localeCompare(b.id) : a.main ? -1 : 1));
	const step = TURN / Math.max(1, agents.length);
	const last = lastActive(model);
	const sectors = new Map<string, Sector>();
	agents.forEach((a, i) => {
		const angle = -Math.PI / 2 + i * step;
		const at = a.state === "idle" ? range(now - (last.get(a.id) ?? now - WINDOW)) : ACTIVE;
		sectors.set(a.id, { id: a.id, angle, from: angle - step / 2, to: angle + step / 2, at: polar(c, at * R, angle), r: at * R, state: a.state });
	});

	// Conversations: small blips in their agent's slice, just outside it, spread across the slice.
	const place = new Map<string, Point>();
	for (const s of sectors.values()) place.set(`agent:${s.id}`, s.at);
	const byAgent = new Map<string, string[]>();
	for (const s of model.satellites) byAgent.set(s.agent, [...(byAgent.get(s.agent) ?? []), s.id]);
	for (const [agent, ids] of byAgent) {
		const s = sectors.get(agent);
		if (!s) continue;
		const r = s.r + 0.12 * R > 0.95 * R ? s.r - 0.12 * R : s.r + 0.12 * R;
		const spread = Math.min((step * 0.75) / ids.length, 26 / r);
		ids.sort().forEach((id, i) => place.set(id, polar(c, r, s.angle + (i - (ids.length - 1) / 2) * spread)));
	}
	const agentOf = new Map(model.satellites.map((s) => [s.id, s.agent]));
	const placeOf = (id: string): Point | undefined =>
		place.get(id) ?? (id.startsWith("conv:") ? place.get(`agent:${id.slice(5).split("/")[0]}`) : agentOf.has(id) ? place.get(`agent:${agentOf.get(id)}`) : undefined);
	const angleOf = (p: Point) => Math.atan2(p.y - c.y, p.x - c.x);

	// Sources and schedules: on the rim, at the bearing of the agents they wake, then pushed apart.
	const types = model.sources.map((s) => s.type);
	const rimIds = [...model.sources.map((s) => s.id), ...model.schedules.map((s) => s.id)];
	const bearings = rimIds.map((id, i) => {
		let x = 0;
		let y = 0;
		for (const l of model.links) {
			if (l.from !== id) continue;
			const p = placeOf(l.to);
			const s = p && sectors.get(agentOf.get(l.to) ?? (l.to.startsWith("conv:") ? l.to.slice(5).split("/")[0] : l.to.slice(6)));
			if (s) {
				x += Math.cos(s.angle);
				y += Math.sin(s.angle);
			}
		}
		return { id, angle: x || y ? Math.atan2(y, x) : -Math.PI / 2 + ((i + 0.5) * TURN) / rimIds.length };
	});
	bearings.sort((a, b) => a.angle - b.angle);
	const gap = Math.min(TURN / Math.max(1, bearings.length), 0.3);
	for (let pass = 0; pass < 4; pass++) for (let i = 1; i < bearings.length; i++) if (bearings[i].angle - bearings[i - 1].angle < gap) bearings[i].angle = bearings[i - 1].angle + gap;
	const bearing = new Map(bearings.map((b) => [b.id, b.angle]));
	const toneOf = (id: string): Tone => {
		const s = model.sources.find((x) => x.id === id);
		return s ? lineTone(types, s.type) : id.startsWith("schedule:") ? SCHEDULE_TONE : DELEGATION_TONE;
	};

	const hoverProps = (id: string) => ({ onMouseEnter: () => onHover(id), onMouseLeave: () => onHover(undefined) });
	const press = (id: string) => ({ role: "button", tabIndex: 0, className: "cursor-pointer outline-none", onClick: () => onPick(id), onKeyDown: (e: { key: string }) => e.key === "Enter" && onPick(id), ...hoverProps(id) });
	const hoveredAgent = hovered?.startsWith("agent:") ? hovered.slice(6) : hovered && agentOf.get(hovered);
	const hoveredRim = hovered && bearing.has(hovered) ? hovered : undefined;

	const blips: ReactNode[] = [];
	const rimFlashes: ReactNode[] = [];
	for (const p of model.pulses) {
		if (p.replayed) continue;
		const id = `pulse:${p.id}`;
		const outside = p.hover?.outside;
		if (!p.from) {
			// Something happened on a node: it pings.
			const tone = PULSE_TONE[p.kind];
			const at = placeOf(p.to[0] ?? "");
			if (!tone || !at || p.age > FLASH || p.kind === "tool") continue;
			const f = p.age / FLASH;
			blips.push(<circle key={id} cx={at.x} cy={at.y} r={6 + f * 22} fill="none" strokeWidth={2} className={tone.stroke} opacity={1 - f} />);
			continue;
		}
		const rimAngle = bearing.get(p.kind === "send" ? p.to[0] : p.from);
		if (rimAngle === undefined) continue;
		const tone = toneOf(p.kind === "send" ? p.to[0] : p.from);
		if (p.age < INBOUND + RIPPLE) {
			const f = Math.min(1, p.age / (INBOUND + RIPPLE));
			rimFlashes.push(<path key={id} d={wedge(c, R - 2, R + 10, rimAngle - 0.09, rimAngle + 0.09)} className={tone.fill} opacity={0.75 * (1 - f)} />);
		}
		const ends = p.kind === "send" ? (p.from ? [p.from] : []) : p.to;
		for (const end of ends) {
			const target = placeOf(end);
			if (!target) continue;
			const ta = angleOf(target);
			const tr = Math.hypot(target.x - c.x, target.y - c.y);
			if (p.age < INBOUND) {
				// Inward along a gentle spiral from the rim to the agent; a send goes the other way.
				const t = ease(p.kind === "send" ? 1 - p.age / INBOUND : p.age / INBOUND);
				const trail = [0, 0.06, 0.12, 0.18].map((d) => Math.max(0, Math.min(1, p.kind === "send" ? t + d : t - d)));
				blips.push(
					<g key={`${id}>${end}`} className="cursor-pointer" onClick={() => onPick(id)} {...hoverProps(id)}>
						{trail.map((u, i) => {
							const q = polar(c, R + (tr - R) * u, rimAngle + turnTo(rimAngle, ta) * u);
							return i ? <circle key={i} cx={q.x} cy={q.y} r={3.5 - i * 0.7} className={tone.fill} opacity={0.5 - i * 0.13} /> : <Blip key={i} at={q} r={5.5} outside={outside} className={cn(tone.fill, "stroke-background")} strokeWidth={1.5} />;
						})}
					</g>,
				);
			} else if (p.kind !== "send" && p.age < INBOUND + RIPPLE) {
				const f = (p.age - INBOUND) / RIPPLE;
				blips.push(<circle key={`${id}>${end}`} cx={target.x} cy={target.y} r={8 + f * 26} fill="none" strokeWidth={2} className={tone.stroke} opacity={1 - f} />);
			}
		}
	}

	return (
		<div ref={box} className="size-full overflow-hidden">
			{width && height ? (
				<svg width={width} height={height} className="block select-none" data-slot="radar">
					{/* The screen. */}
					<circle cx={c.x} cy={c.y} r={R + 10} className="fill-muted stroke-border" strokeWidth={1} />
					<circle cx={c.x} cy={c.y} r={R} className="fill-card stroke-border" strokeWidth={1.5} />
					{[...sectors.values()].map((s, i) => (
						<path
							key={s.id}
							d={wedge(c, 0, R, s.from, s.to)}
							className={cn(s.state === "waiting" ? "fill-chart-4" : "fill-foreground", "stroke-border")}
							fillOpacity={s.state === "waiting" ? (blink ? 0.12 : 0.05) : hoveredAgent === s.id ? 0.07 : i % 2 ? 0.025 : 0}
							strokeWidth={1}
							{...hoverProps(`agent:${s.id}`)}
						/>
					))}
					{RINGS.map((ring) => {
						// Labelled along the edge between the first two slices, where no agent lies.
						const at = polar(c, range(ring.age) * R + 3, -Math.PI / 2 + step / 2 - 0.035);
						return (
							<g key={ring.label} className="pointer-events-none">
								<circle cx={c.x} cy={c.y} r={range(ring.age) * R} fill="none" className="stroke-border" strokeDasharray="2 5" />
								<text x={at.x} y={at.y} textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
									{ring.label}
								</text>
							</g>
						);
					})}
					{/* Bearing ticks round the rim, every 10 degrees. */}
					{Array.from({ length: 36 }, (_, i) => {
						const a = (i * TURN) / 36;
						const p0 = polar(c, R, a);
						const p1 = polar(c, R + (i % 3 ? 4 : 9), a);
						return <line key={i} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} className="pointer-events-none stroke-muted-foreground" opacity={0.5} />;
					})}

					{/* The sweep and its afterglow. */}
					<g className="pointer-events-none">
						{/* Wedges that all start at the line and reach further back each: they add up to a smooth fade, without seams. */}
						{Array.from({ length: 32 }, (_, i) => (
							<path key={i} d={wedge(c, 0, R, sweep - ((i + 1) * TRAIL) / 32, sweep)} className="fill-primary" opacity={0.012 - i * 0.00025} />
						))}
						<line x1={c.x} y1={c.y} x2={polar(c, R, sweep).x} y2={polar(c, R, sweep).y} className="stroke-primary" strokeWidth={2} opacity={0.85} />
					</g>

					{rimFlashes}

					{/* Subscriptions, faintly, while their source or their agent is under the pointer. */}
					{model.links.map((l) => {
						if (l.kind !== "subscription" && l.kind !== "schedule") return null;
						const to = placeOf(l.to);
						const a = bearing.get(l.from);
						const agent = agentOf.get(l.to) ?? (l.to.startsWith("conv:") ? l.to.slice(5).split("/")[0] : l.to.slice(6));
						if (!to || a === undefined || (hoveredRim !== l.from && hoveredAgent !== agent)) return null;
						const from = polar(c, R, a);
						return <line key={l.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={cn(toneOf(l.from).stroke, "pointer-events-none")} strokeDasharray="3 4" strokeWidth={1.5} opacity={0.7} />;
					})}

					{/* Delegations and sub-agents: chords across the screen, bowed toward pine. */}
					{model.links.map((l) => {
						if (l.kind !== "delegation" && l.kind !== "subagent") return null;
						const a = placeOf(l.from);
						const b = placeOf(l.to);
						if (!a || !b) return null;
						const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
						const k = { x: mid.x + (c.x - mid.x) * 0.3, y: mid.y + (c.y - mid.y) * 0.3 };
						const d = `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${k.x.toFixed(1)},${k.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
						return (
							<g key={l.id} opacity={l.opacity}>
								<path d={d} fill="none" className={DELEGATION_TONE.stroke} strokeWidth={l.kind === "delegation" ? 2.5 : 1.5} strokeLinecap="round" strokeDasharray="6 5" strokeDashoffset={-(now / 30) % 1000} />
								<path d={d} fill="none" stroke="transparent" strokeWidth={12} {...hoverProps(`link:${l.id}`)} />
							</g>
						);
					})}

					{/* pine. */}
					<circle cx={c.x} cy={c.y} r={Math.max(14, 0.07 * R)} className="fill-background stroke-primary" strokeWidth={2} />
					<text x={c.x} y={c.y + 4} textAnchor="middle" className="pointer-events-none fill-foreground text-xs font-semibold tracking-wide">
						pine
					</text>

					{/* Conversations. */}
					{model.satellites.map((s) => {
						const p = place.get(s.id);
						const home = place.get(`agent:${s.agent}`);
						if (!p || !home) return null;
						const waiting = s.state === "waiting";
						const fill = s.ended === "failed" ? "fill-destructive" : waiting ? (blink ? "fill-chart-4" : "fill-background") : s.state === "idle" ? "fill-muted-foreground" : s.state === "queued" ? "fill-background" : STATE_TONE[s.state].fill;
						const stroke = waiting ? "stroke-chart-4" : s.ended === "failed" ? "stroke-destructive" : s.state === "idle" ? "stroke-muted-foreground" : STATE_TONE[s.state].stroke;
						return (
							<g key={s.id} {...press(s.id)} opacity={s.opacity * (s.state === "idle" ? glow(angleOf(p)) : 1)}>
								<line x1={home.x} y1={home.y} x2={p.x} y2={p.y} className="stroke-border" />
								<circle cx={p.x} cy={p.y} r={11} fill="transparent" />
								<Blip at={p} r={4.5} outside={s.outside} className={cn(fill, stroke)} strokeWidth={1.5} />
								{s.kind === "conversation" ? null : <circle cx={p.x} cy={p.y} r={8} fill="none" className="stroke-chart-3" strokeDasharray="2 2" />}
							</g>
						);
					})}

					{/* Agents: a blip on the middle of their slice, and their name at the rim. */}
					{agents.map((a) => {
						const s = sectors.get(a.id)!;
						const id = `agent:${a.id}`;
						const tone = STATE_TONE[a.state];
						const label = polar(c, R - 16, s.angle);
						const ping = (now % 1600) / 1600;
						const waiting = a.state === "waiting";
						return (
							<g key={a.id} data-node={id} data-state={a.state} {...press(id)}>
								<text x={label.x} y={label.y + 4} textAnchor="middle" className={cn("text-[11px] font-semibold tracking-[0.18em] uppercase", hoveredAgent === a.id ? "fill-foreground" : "fill-muted-foreground")}>
									{a.id}
								</text>
								{a.state === "working" ? <circle cx={s.at.x} cy={s.at.y} r={8 + ping * 20} fill="none" className="stroke-primary" strokeWidth={1.5} opacity={1 - ping} /> : null}
								{waiting ? <circle cx={s.at.x} cy={s.at.y} r={blink ? 17 : 12} fill="none" className="stroke-chart-4" strokeWidth={3} opacity={blink ? 1 : 0.4} /> : null}
								<circle cx={s.at.x} cy={s.at.y} r={14} fill="transparent" />
								<circle
									cx={s.at.x}
									cy={s.at.y}
									r={a.main ? 8 : 7}
									className={cn(waiting ? (blink ? "fill-chart-4" : "fill-background") : tone.fill, waiting ? "stroke-chart-4" : "stroke-background")}
									strokeWidth={2}
									strokeDasharray={a.state === "queued" ? "2 2" : undefined}
									opacity={a.state === "idle" ? glow(s.angle) : 1}
								/>
								{a.outside ? <path d={triangle({ x: s.at.x + 10, y: s.at.y - 9 }, 3.5)} className="fill-chart-4" /> : null}
								{a.tool || a.idle ? (
									<text x={s.at.x} y={s.at.y + 24} textAnchor="middle" paintOrder="stroke" strokeWidth={4} strokeLinejoin="round" className="fill-muted-foreground stroke-card font-mono text-[10px]">
										{a.tool ?? `+${a.idle} idle`}
									</text>
								) : null}
							</g>
						);
					})}

					{/* Sources and schedules, outside the rim at their bearing. */}
					{[...model.sources, ...model.schedules].map((n) => {
						const a = bearing.get(n.id);
						if (a === undefined) return null;
						const isSchedule = n.id.startsWith("schedule:");
						const tone = toneOf(n.id);
						const tip = polar(c, R + 12, a);
						const base = (side: number) => polar(c, R + 24, a + side * (7 / R));
						const at = polar(c, R + 18, a);
						const text = polar(c, R + 32, a);
						const cos = Math.cos(a);
						const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
						const dy = Math.sin(a) > 0.6 ? 10 : Math.sin(a) < -0.6 ? -2 : 4;
						return (
							<g key={n.id} {...press(n.id)}>
								{isSchedule ? (
									<circle cx={at.x} cy={at.y} r={5.5} strokeWidth={2} className="fill-background stroke-muted-foreground" strokeDasharray="3 2" />
								) : (
									<path d={`M${tip.x},${tip.y} L${base(1).x},${base(1).y} L${base(-1).x},${base(-1).y} Z`} className={tone.fill} />
								)}
								{narrow ? null : (
									<text x={text.x} y={text.y + dy} textAnchor={anchor} className={cn("text-xs", hoveredRim === n.id ? "fill-foreground font-medium" : "fill-muted-foreground")}>
										{n.scope === "global" ? n.name : `${n.name}@${n.scope}`}
									</text>
								)}
							</g>
						);
					})}

					{blips}
				</svg>
			) : null}
		</div>
	);
}
