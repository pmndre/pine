import { cn } from "cn";
import { useRef, type RefObject } from "react";
import { useResizeObserver } from "usehooks-ts";
import { constellation, NARROW, type Placed, type Point, rings, TRAVEL } from "../birdview-layout.ts";
import type { DrawProps } from "../Birdview.tsx";
import { DELEGATION_TONE, lineTone, PULSE_TONE, SCHEDULE_TONE, STATE_TONE, type Tone } from "./birdview-tone.ts";

const RIPPLE = 900;
const FLASH = 1200;

/**
 * A link's curve. A source's is bent toward the centre, so that lines that go the same way bundle
 * there; a delegation's (`pull` below 0) bows sideways, so that it goes round the main agent
 * instead of through it.
 */
function curve(a: Point, b: Point, centre: Point, pull: number): [Point, Point, Point] {
	const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
	if (pull < 0) return [a, { x: mid.x - (b.y - a.y) * -pull, y: mid.y + (b.x - a.x) * -pull }, b];
	return [a, { x: mid.x + (centre.x - mid.x) * pull, y: mid.y + (centre.y - mid.y) * pull }, b];
}
const along = ([a, c, b]: [Point, Point, Point], t: number): Point => ({
	x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x,
	y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y,
});
const pathOf = ([a, c, b]: [Point, Point, Point]) => `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${c.x.toFixed(1)},${c.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
/** Where a label beside a node goes: outward from the centre, anchored on the side that faces it. */
function labelAt(p: Placed, gap: number): { x: number; y: number; anchor: "start" | "middle" | "end" } {
	const cos = Math.cos(p.angle);
	const sin = Math.sin(p.angle);
	const anchor = cos > 0.35 ? "start" : cos < -0.35 ? "end" : "middle";
	return { x: p.x + cos * (p.r + gap), y: p.y + sin * (p.r + gap) + (Math.abs(sin) > 0.6 ? Math.sign(sin) * 6 : 4), anchor };
}

/**
 * An agent's name and what it does, on the side of it that faces the centre, since its
 * conversations orbit on the side that faces away; the main agent's go above it.
 */
function AgentLabel({ place, below, name, note }: { place: Placed; below: boolean; name: string; note: string }) {
	const inward = below ? { ...place, angle: Math.PI / 2 } : { ...place, angle: place.angle + Math.PI };
	const at = labelAt(inward, 12);
	const up = Math.sin(inward.angle) < -0.6;
	return (
		<>
			<text x={at.x} y={up ? at.y - 14 : at.y + 8} textAnchor={at.anchor} className="fill-foreground text-sm font-medium">
				{name}
			</text>
			<text x={at.x} y={up ? at.y + 2 : at.y + 24} textAnchor={at.anchor} className="fill-muted-foreground font-mono text-xs">
				{note}
			</text>
		</>
	);
}

/**
 * Direction A, the constellation: the main agent at the centre, the others on a ring, each one's
 * active conversations orbiting it, sources and schedules on an outer ring, and links as curves
 * bundled through the centre, over which events ride as dots. One SVG, positions from plain
 * trigonometry, so that nothing moves unless something comes or goes.
 */
export function Constellation({ model, hovered, onHover, onPick }: DrawProps) {
	const box = useRef<HTMLDivElement>(null);
	const { width = 0, height = 0 } = useResizeObserver({ ref: box as RefObject<HTMLDivElement> });
	const at = constellation(model, width, height);
	const centre = { x: width / 2, y: height / 2 };
	const types = model.sources.map((s) => s.type);
	const agentOf = new Map(model.satellites.map((s) => [s.id, s.agent]));
	const placeOf = (id: string) => at.get(id) ?? (id.startsWith("conv:") ? at.get(`agent:${id.slice(5).split("/")[0]}`) : agentOf.has(id) ? at.get(`agent:${agentOf.get(id)}`) : undefined);
	const toneOf = (id: string): Tone => {
		const s = model.sources.find((x) => x.id === id);
		return s ? lineTone(types, s.type) : id.startsWith("schedule:") ? SCHEDULE_TONE : DELEGATION_TONE;
	};
	const pullOf = (kind: string) => (kind === "delegation" ? -0.45 : kind === "subagent" ? 0 : 0.55);
	const warmth = (from: string, to: string) =>
		Math.max(0, ...model.pulses.filter((p) => (p.from === from && p.to.includes(to)) || (p.from === to && p.to.includes(from))).map((p) => p.opacity));
	const nodeHovered = hovered && !hovered.startsWith("link:") && !hovered.startsWith("pulse:") ? hovered : undefined;
	const hoverProps = (id: string) => ({ onMouseEnter: () => onHover(id), onMouseLeave: () => onHover(undefined) });
	const press = (id: string) => ({ role: "button", tabIndex: 0, className: "cursor-pointer outline-none", onClick: () => onPick(id), onKeyDown: (e: { key: string }) => e.key === "Enter" && onPick(id), ...hoverProps(id) });
	const spin = (model.now / 40) % 1000;
	const small = Math.min(width, height) < 420;
	const narrow = width < NARROW;

	return (
		<div ref={box} className="size-full overflow-hidden">
			{width && height ? (
				<svg width={width} height={height} className="block">
					<ellipse cx={centre.x} cy={centre.y} rx={rings(width, height).ring.rx} ry={rings(width, height).ring.ry} fill="none" className="stroke-border" strokeDasharray="2 6" />
					{model.links.map((l) => {
						const a = placeOf(l.from);
						const b = placeOf(l.to);
						if (!a || !b) return null;
						const tone = l.kind === "subscription" ? toneOf(l.from) : l.kind === "schedule" ? SCHEDULE_TONE : DELEGATION_TONE;
						const d = pathOf(curve(a, b, centre, pullOf(l.kind)));
						const warm = warmth(l.from, l.to);
						const dim = nodeHovered && l.from !== nodeHovered && l.to !== nodeHovered && placeOf(nodeHovered) !== b ? 0.15 : 1;
						return (
							<g key={l.id}>
								<path d={d} fill="none" className={tone.stroke} strokeWidth={l.kind === "delegation" ? 3 : 1.5 + warm * 1.5} strokeLinecap="round" strokeDasharray={l.kind === "schedule" ? "2 5" : undefined} opacity={(0.25 + 0.75 * warm) * l.opacity * dim} />
								<path d={d} fill="none" stroke="transparent" strokeWidth={12} {...hoverProps(`link:${l.id}`)} />
							</g>
						);
					})}
					{model.satellites.map((s) => {
						const p = at.get(s.id);
						const home = at.get(`agent:${s.agent}`);
						if (!p || !home) return null;
						const label = labelAt(p, 4);
						return (
							<g key={s.id} opacity={s.opacity} {...press(s.id)}>
								<line x1={home.x} y1={home.y} x2={p.x} y2={p.y} className="stroke-border" />
								{s.outside ? <circle cx={p.x} cy={p.y} r={p.r + 4} fill="none" strokeWidth={1.5} strokeDasharray="2 2" className="stroke-chart-4" /> : null}
								<circle cx={p.x} cy={p.y} r={p.r} strokeWidth={1.5} className={cn(s.ended === "failed" ? "fill-destructive stroke-destructive" : s.state === "queued" ? "fill-background stroke-muted-foreground" : cn(STATE_TONE[s.state].fill, STATE_TONE[s.state].stroke))} strokeDasharray={s.state === "queued" ? "2 2" : undefined} />
								{small ? null : (
									<text x={label.x} y={label.y} textAnchor={label.anchor} className="fill-muted-foreground text-xs">
										{s.session.split("/").at(-1)}
									</text>
								)}
							</g>
						);
					})}
					{model.agents.map((a) => {
						const id = `agent:${a.id}`;
						const p = at.get(id);
						if (!p) return null;
						const tone = STATE_TONE[a.state];
						const breathe = a.state === "waiting" ? 2 * Math.sin(model.now / 250) : 0;
						return (
							<g key={a.id} data-node={id} data-state={a.state} {...press(id)}>
								{a.state === "idle" ? null : (
									<circle cx={p.x} cy={p.y} r={p.r + 6 + breathe} fill="none" strokeWidth={a.state === "waiting" ? 3 : 2.5} className={tone.stroke} strokeDasharray={a.state === "working" ? "10 6" : a.state === "queued" ? "3 4" : undefined} strokeDashoffset={a.state === "working" ? -spin : 0} />
								)}
								<circle cx={p.x} cy={p.y} r={p.r} strokeWidth={1.5} className="fill-card stroke-border" />
								<text x={p.x} y={p.y + 4} textAnchor="middle" className="fill-foreground text-xs font-medium">
									{a.id.slice(0, 2)}
								</text>
								{a.outside ? <circle cx={p.x + p.r * 0.75} cy={p.y - p.r * 0.75} r={4} className="fill-chart-4 stroke-background" strokeWidth={1.5} /> : null}
								<AgentLabel place={p} below={a.main || narrow} name={a.id} note={a.tool ?? (a.idle ? `+${a.idle} idle` : "")} />
							</g>
						);
					})}
					{[...model.sources, ...model.schedules].map((n) => {
						const p = at.get(n.id);
						if (!p) return null;
						const label = labelAt(p, 8);
						const isSchedule = n.id.startsWith("schedule:");
						const tone = toneOf(n.id);
						return (
							<g key={n.id} {...press(n.id)}>
								{isSchedule ? (
									<circle cx={p.x} cy={p.y} r={p.r} strokeWidth={2} className="fill-background stroke-muted-foreground" strokeDasharray="3 2" />
								) : (
									<rect x={p.x - p.r} y={p.y - p.r} width={p.r * 2} height={p.r * 2} rx={3} className={tone.fill} />
								)}
								<text x={label.x} y={label.y} textAnchor={label.anchor} className="fill-foreground text-xs">
									{n.scope === "global" ? n.name : `${n.name}@${n.scope}`}
								</text>
							</g>
						);
					})}
					{model.pulses.flatMap((p) => {
						if (p.replayed) return [];
						if (!p.from) {
							const tone = PULSE_TONE[p.kind];
							const place = placeOf(p.to[0] ?? "");
							if (!tone || !place || p.age > FLASH || p.kind === "tool") return [];
							const f = p.age / FLASH;
							return [<circle key={p.id} cx={place.x} cy={place.y} r={place.r + 4 + f * 16} fill="none" strokeWidth={2} className={tone.stroke} opacity={1 - f} />];
						}
						if (p.age > TRAVEL + RIPPLE) return [];
						const a = placeOf(p.from);
						const tone = toneOf(p.kind === "send" ? p.to[0] : p.from);
						return p.to.flatMap((to) => {
							const b = placeOf(to);
							if (!a || !b) return [];
							const link = model.links.find((l) => (l.from === p.from && l.to === to) || (l.to === p.from && l.from === to));
							const c = curve(a, b, centre, pullOf(link?.kind ?? "subscription"));
							const id = `pulse:${p.id}`;
							if (p.age < TRAVEL) {
								const q = along(c, p.age / TRAVEL);
								return [
									<g key={`${p.id}>${to}`} className="cursor-pointer" onClick={() => onPick(id)} {...hoverProps(id)}>
										<circle cx={q.x} cy={q.y} r={10} className={tone.fill} opacity={0.2} />
										<circle cx={q.x} cy={q.y} r={4.5} className={tone.fill} />
									</g>,
								];
							}
							const f = (p.age - TRAVEL) / RIPPLE;
							return [<circle key={`${p.id}>${to}`} cx={b.x} cy={b.y} r={b.r + 4 + f * 14} fill="none" strokeWidth={2} className={tone.stroke} opacity={1 - f} />];
						});
					})}
				</svg>
			) : null}
		</div>
	);
}
