import { cn } from "cn";
import { useRef, type RefObject } from "react";
import { useResizeObserver } from "usehooks-ts";
import type { AgentNode, BirdviewModel, Pulse, State } from "../birdview.ts";
import { chamfer, type Point, pointAlong } from "../birdview-layout.ts";
import type { DrawProps } from "../Birdview.tsx";

/** A place the river runs through: an input on the left, an agent in the middle, an output on the right. */
interface Place {
	id: string;
	col: 0 | 1 | 2;
	kind: "owner" | "source" | "schedule" | "agent" | "reply" | "failed" | "send";
	name: string;
	note?: string;
	/** What a hover or a click on it means to the frame: a node id of the model, or nothing. */
	target?: string;
	/** Its things come from outside (a source whose trust is not the owner's). */
	outside: boolean;
	agent?: AgentNode;
	x: number;
	y: number;
	w: number;
	h: number;
}

/** A stream between two places: its width is how much passed over it in the window. */
interface Band {
	id: string;
	from: string;
	to: string;
	kind: "owner" | "source" | "schedule" | "reply" | "send" | "failed" | "loop";
	value: number;
	outside: number;
	/** The lasting link it stands for, when there is one (a subscription, a schedule). */
	link?: string;
	pulses: Pulse[];
	width: number;
	y0: number;
	y1: number;
	points?: Point[];
	/** The corners of a loop, before they are rounded. */
	corners?: Point[];
}

/** How long a particle takes to run its band, ms. */
const TRAVEL = 3000;
/** Within this long after an event reaches an agent, a task queued there is that event's, not the owner's. */
const CAUSE = 2500;
const STATE_WORD: Record<State, string> = { idle: "idle", queued: "queued", working: "working", waiting: "waiting for you" };

const BAND_TONE: Record<Band["kind"], string> = {
	owner: "stroke-primary",
	source: "stroke-chart-2",
	schedule: "stroke-muted-foreground",
	reply: "stroke-primary",
	send: "stroke-chart-2",
	failed: "stroke-destructive",
	loop: "stroke-chart-3",
};

const agentOfTopic = (topic: string) => /^agent\/([^/]+)\//.exec(topic)?.[1];
const isOutside = (p: Pulse) => !!p.hover?.outside || p.to.some((t) => t.endsWith("~u"));

/**
 * Who sent what to whom over the window, read from the model's pulses: an event from a source or a
 * schedule into the agents it woke, the owner's messages (a task queued with no event before it),
 * replies (a conversation's task done), sends through a source, failures, and delegations (a task
 * queued for another agent right after a `delegate` call), which loop back into the agents.
 */
function streams(model: BirdviewModel): Map<string, Band> {
	const bands = new Map<string, Band>();
	const agents = new Set(model.agents.map((a) => a.id));
	const agentOfSat = new Map(model.satellites.map((s) => [s.id, s.agent]));
	const agentOf = (node: string) => (node.startsWith("agent:") ? node.slice(6) : node.startsWith("conv:") ? node.slice(5).split("/")[0] : agentOfSat.get(node));
	const add = (kind: Band["kind"], from: string, to: string, p?: Pulse, link?: string) => {
		const id = `${from}>${to}`;
		let b = bands.get(id);
		if (!b) {
			b = { id, from, to, kind, value: 0, outside: 0, pulses: [], width: 0, y0: 0, y1: 0 };
			bands.set(id, b);
		}
		if (link) b.link = link;
		if (p) {
			b.value++;
			if (isOutside(p)) b.outside++;
			b.pulses.push(p);
		}
	};
	// The lasting links run dry when nothing passes: they are drawn all the same.
	for (const l of model.links) {
		const a = agentOf(l.to);
		if (!a || !agents.has(a)) continue;
		if (l.kind === "subscription") add("source", l.from, `agent:${a}`, undefined, l.id);
		else if (l.kind === "schedule") add("schedule", l.from, `agent:${a}`, undefined, l.id);
		else if (l.kind === "delegation") {
			const from = agentOf(l.from);
			if (from && from !== a) add("loop", `agent:${from}`, `agent:${a}`, undefined, l.id);
		}
	}
	const lastIn = new Map<string, number>();
	const lastDelegate: { agent: string; ts: number }[] = [];
	for (const p of [...model.pulses].sort((a, b) => a.ts - b.ts)) {
		if (p.kind === "source" || p.kind === "schedule") {
			if (!p.from) continue;
			for (const t of p.to) {
				const a = agentOf(t);
				if (!a || !agents.has(a)) continue;
				add(p.kind, p.from, `agent:${a}`, p);
				lastIn.set(a, p.ts);
			}
		} else if (p.kind === "tool" && p.label === "delegate") {
			const a = agentOf(p.to[0] ?? "");
			if (a) lastDelegate.push({ agent: a, ts: p.ts });
		} else if (p.kind === "queued") {
			const a = agentOfTopic(p.topic);
			const node = p.to[0] ?? "";
			if (!a || !agents.has(a)) continue;
			if (node.startsWith("task:")) {
				const by = lastDelegate.filter((d) => d.agent !== a && p.ts - d.ts < CAUSE).at(-1);
				if (by) add("loop", `agent:${by.agent}`, `agent:${a}`, p);
				continue;
			}
			if (p.ts - (lastIn.get(a) ?? -Infinity) < CAUSE || isOutside(p)) continue;
			add("owner", "in:owner", `agent:${a}`, p);
		} else if (p.kind === "done" || p.kind === "failed") {
			const node = p.to[0] ?? "";
			const a = agentOfTopic(p.topic);
			if (!a || !agents.has(a)) continue;
			if (p.kind === "failed") add("failed", `agent:${a}`, "out:failed", p);
			else if (node.startsWith("conv:")) add("reply", `agent:${a}`, "out:reply", p);
		} else if (p.kind === "send") {
			const a = p.from && agentOf(p.from);
			const to = p.to[0];
			if (a && to && agents.has(a)) add("send", `agent:${a}`, `out:${to}`, p);
		}
	}
	return bands;
}

interface Layout {
	places: Map<string, Place>;
	bands: Band[];
	/** Where the delegation loops run under the agents. */
	floor: number;
}

/**
 * Three columns, Sankey-style: each place is as tall as what passed through it, stacked and
 * centred in its column, and each band leaves and enters its places in the order of the place at
 * its other end, so that bands cross as little as they can. The scale is the largest that fits.
 */
function layout(model: BirdviewModel, w: number, h: number): Layout {
	const narrow = w < 720;
	const bandMap = streams(model);
	const bands = [...bandMap.values()];
	const places = new Map<string, Place>();
	const put = (p: Omit<Place, "x" | "y" | "w" | "h">) => places.set(p.id, { ...p, x: 0, y: 0, w: 0, h: 0 });

	put({ id: "in:owner", col: 0, kind: "owner", name: "owner", outside: false });
	for (const s of model.sources) put({ id: s.id, col: 0, kind: "source", name: s.scope === "global" ? s.name : `${s.name}@${s.scope}`, note: s.type, target: s.id, outside: s.trust !== "owner" });
	for (const s of model.schedules) put({ id: s.id, col: 0, kind: "schedule", name: s.scope === "global" ? s.name : `${s.name}@${s.scope}`, note: "schedule", target: s.id, outside: false });
	for (const a of model.agents) put({ id: `agent:${a.id}`, col: 1, kind: "agent", name: a.id, target: `agent:${a.id}`, outside: a.outside, agent: a });
	put({ id: "out:reply", col: 2, kind: "reply", name: "replies", outside: false });
	for (const b of bands) {
		if (b.kind === "send" && !places.has(b.to)) {
			const src = model.sources.find((s) => `out:${s.id}` === b.to);
			put({ id: b.to, col: 2, kind: "send", name: src ? (src.scope === "global" ? src.name : `${src.name}@${src.scope}`) : b.to.slice(4), note: "send", target: b.to.slice(4), outside: false });
		}
	}
	if (bands.some((b) => b.kind === "failed")) put({ id: "out:failed", col: 2, kind: "failed", name: "failed", outside: false });
	const live = bands.filter((b) => places.has(b.from) && places.has(b.to));
	const loops = live.filter((b) => b.kind === "loop");
	const flows = live.filter((b) => b.kind !== "loop");

	// Inputs in the order of the agents they feed, so that the river does not braid.
	const agentRank = new Map(model.agents.map((a, i) => [`agent:${a.id}`, i]));
	const rankOf = (id: string) => {
		const outs = flows.filter((b) => b.from === id);
		const ins = flows.filter((b) => b.to === id);
		const ends = [...outs.map((b) => agentRank.get(b.to)), ...ins.map((b) => agentRank.get(b.from))].filter((x) => x !== undefined) as number[];
		return ends.length ? ends.reduce((s, x) => s + x, 0) / ends.length : 999;
	};
	const column = (col: number) => {
		const list = [...places.values()].filter((p) => p.col === col);
		if (col === 1) return list;
		const fixed = (p: Place) => (p.kind === "owner" || p.kind === "reply" ? -1 : p.kind === "failed" ? 1000 : 0);
		return list.sort((a, b) => fixed(a) - fixed(b) || rankOf(a.id) - rankOf(b.id));
	};
	const cols = [column(0), column(1), column(2)];

	const label = narrow ? 92 : 150;
	const barW = 10;
	const agentW = narrow ? 104 : 148;
	const colX = [label, (w - agentW) / 2, w - label - barW];
	const top = 34;
	const minH = [16, 58, 16];
	const pad = [narrow ? 8 : 12, narrow ? 12 : 22, narrow ? 8 : 12];
	const loopGap = 6;

	const widthOf = (b: Band, k: number) => (b.value ? Math.max(3, 2 + b.value * k) : 1.5);
	const sideSum = (id: string, side: "in" | "out", k: number) => live.filter((b) => (side === "out" ? b.from : b.to) === id).reduce((s, b) => s + widthOf(b, k), 0);
	const heightOf = (p: Place, k: number) => Math.max(minH[p.col], p.col === 0 ? sideSum(p.id, "out", k) : p.col === 2 ? sideSum(p.id, "in", k) : Math.max(sideSum(p.id, "in", k), sideSum(p.id, "out", k)) + 12);
	const loopRoom = (k: number) => (loops.length ? 40 + loops.reduce((s, b) => s + widthOf(b, k) + loopGap, 0) : 0);
	const fits = (k: number) => {
		const room = h - top - 20 - loopRoom(k);
		return cols.every((c, i) => c.reduce((s, p) => s + heightOf(p, k), 0) + pad[i] * Math.max(0, c.length - 1) <= room);
	};
	const most = Math.max(1, ...cols.map((c) => c.reduce((s, p) => s + Math.max(sideSum(p.id, "in", 1), sideSum(p.id, "out", 1)), 0)));
	let k = Math.min(9, (h * 0.6) / most);
	for (let i = 0; i < 40 && !fits(k); i++) k *= 0.88;

	const room = h - top - 20 - loopRoom(k);
	cols.forEach((c, i) => {
		const total = c.reduce((s, p) => s + heightOf(p, k), 0) + pad[i] * Math.max(0, c.length - 1);
		let y = top + Math.max(0, (room - total) / 2);
		for (const p of c) {
			p.x = colX[i];
			p.w = i === 1 ? agentW : barW;
			p.h = heightOf(p, k);
			p.y = y;
			y += p.h + pad[i];
		}
	});
	for (const b of live) b.width = widthOf(b, k);

	// Each place's bands are stacked along its side, in the order of where they go; loops last.
	const centreY = (id: string) => {
		const p = places.get(id)!;
		return p.y + p.h / 2;
	};
	for (const p of places.values()) {
		for (const side of ["out", "in"] as const) {
			const own = live.filter((b) => (side === "out" ? b.from : b.to) === p.id);
			own.sort((a, b) => Number(a.kind === "loop") - Number(b.kind === "loop") || centreY(side === "out" ? a.to : a.from) - centreY(side === "out" ? b.to : b.from));
			const sum = own.reduce((s, b) => s + b.width, 0);
			let y = p.y + (p.h - sum) / 2;
			for (const b of own) {
				if (side === "out") b.y0 = y + b.width / 2;
				else b.y1 = y + b.width / 2;
				y += b.width;
			}
		}
	}

	// Delegations leave an agent's right side, dive under the agents and come back into the other's left.
	const agentsBottom = Math.max(top, ...cols[1].map((p) => p.y + p.h));
	let floor = agentsBottom + 18;
	const agentRight = colX[1] + agentW;
	let spread = 0;
	loops.sort((a, b) => centreY(a.from) - centreY(b.from));
	for (const b of loops) {
		const lane = floor + b.width / 2;
		const out = agentRight + 18 + spread + b.width / 2;
		const back = colX[1] - 18 - spread - b.width / 2;
		b.corners = [
			{ x: agentRight, y: b.y0 },
			{ x: out, y: b.y0 },
			{ x: out, y: lane },
			{ x: back, y: lane },
			{ x: back, y: b.y1 },
			{ x: colX[1], y: b.y1 },
		];
		b.points = chamfer(b.corners, 14 + b.width / 2);
		floor += b.width + loopGap;
		spread += b.width + loopGap;
	}
	return { places, bands: live, floor };
}

/** An SVG path through the corners of a loop, each corner rounded with a radius of `r` at most. */
function rounded(points: Point[], r: number): string {
	let d = `M${points[0].x},${points[0].y}`;
	for (let i = 1; i < points.length - 1; i++) {
		const [p, c, n] = [points[i - 1], points[i], points[i + 1]];
		const into = Math.hypot(c.x - p.x, c.y - p.y);
		const away = Math.hypot(n.x - c.x, n.y - c.y);
		const cut = Math.min(r, into / 2, away / 2);
		const a = { x: c.x - ((c.x - p.x) / into) * cut, y: c.y - ((c.y - p.y) / into) * cut };
		const b = { x: c.x + ((n.x - c.x) / away) * cut, y: c.y + ((n.y - c.y) / away) * cut };
		d += ` L${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`;
	}
	const last = points.at(-1)!;
	return `${d} L${last.x},${last.y}`;
}

/** The point at `t` on a band between two columns: a horizontal S curve. */
function onCurve(b: Band, a: Point, c: Point, t: number): Point {
	const m = (a.x + c.x) / 2;
	const u = 1 - t;
	return {
		x: u * u * u * a.x + 3 * u * u * t * m + 3 * u * t * t * m + t * t * t * c.x,
		y: u * u * u * a.y + 3 * u * u * t * a.y + 3 * u * t * t * c.y + t * t * t * c.y,
	};
}

const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * Direction "river": pine as a Sankey flow over the last fifteen minutes. Inputs on the left (the
 * owner, sources, schedules), agents in the middle, outputs on the right (replies, sends through a
 * source, failures). A band is as wide as what passed over it; each event runs along its band as a
 * particle, amber when it came from outside. Delegations loop under the agents from one to another.
 * A working agent glows; one waiting for the owner has a dam across what it would let out.
 */
export function River({ model, hovered, onHover, onPick }: DrawProps) {
	const box = useRef<HTMLDivElement>(null);
	const { width = 0, height = 0 } = useResizeObserver({ ref: box as RefObject<HTMLDivElement> });
	const { places, bands, floor } = layout(model, width, height);
	const narrow = width < 720;
	const hoverProps = (id?: string) => ({ onMouseEnter: () => onHover(id), onMouseLeave: () => onHover(undefined) });
	const press = (id?: string) =>
		id
			? { role: "button", tabIndex: 0, className: "cursor-pointer outline-none", onClick: () => onPick(id), onKeyDown: (e: { key: string }) => e.key === "Enter" && onPick(id), ...hoverProps(id) }
			: hoverProps(undefined);
	const ends = (b: Band) => {
		const a = places.get(b.from)!;
		const c = places.get(b.to)!;
		return [
			{ x: a.x + a.w, y: b.y0 },
			{ x: c.x, y: b.y1 },
		] as const;
	};
	const pathOfBand = (b: Band) => {
		if (b.corners) return rounded(b.corners, 14 + b.width / 2);
		const [a, c] = ends(b);
		const m = (a.x + c.x) / 2;
		return `M${a.x},${a.y} C${m},${a.y} ${m},${c.y} ${c.x},${c.y}`;
	};
	const pointOn = (b: Band, t: number) => {
		if (b.points) return pointAlong(b.points, t);
		const [a, c] = ends(b);
		return onCurve(b, a, c, t);
	};
	/** What a hover on a band says: the last thing it carried, or the lasting link, or its agent. */
	const bandTarget = (b: Band) => (b.pulses.length ? `pulse:${b.pulses.at(-1)!.id}` : b.link ? `link:${b.link}` : b.from.startsWith("agent:") ? b.from : b.to);
	const focus = hovered && (hovered.startsWith("agent:") || hovered.startsWith("source:") || hovered.startsWith("schedule:")) ? hovered : undefined;
	const touches = (b: Band) => !focus || b.from === focus || b.to === focus || b.to === `out:${focus}`;
	const waiting = model.agents.filter((a) => a.state === "waiting").map((a) => `agent:${a.id}`);
	const dammed = (b: Band) => waiting.includes(b.from);
	const glow = 0.5 + 0.5 * Math.sin(model.now / 320);

	return (
		<div ref={box} className="size-full overflow-hidden">
			{width && height ? (
				<svg width={width} height={height} className="block select-none">
					<defs>
						<filter id="river-glow" x="-50%" y="-50%" width="200%" height="200%">
							<feGaussianBlur stdDeviation={10} />
						</filter>
						<pattern id="river-dam" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
							<rect width={3} height={6} className="fill-chart-4" />
						</pattern>
					</defs>

					{(["in", "agents", "out"] as const).map((word, i) => {
						const col = [...places.values()].find((p) => p.col === i);
						if (!col) return null;
						const x = i === 0 ? col.x + col.w : i === 2 ? col.x : col.x + col.w / 2;
						return (
							<text key={word} x={x} y={18} textAnchor={i === 0 ? "end" : i === 2 ? "start" : "middle"} className="fill-muted-foreground text-[10px] tracking-widest uppercase">
								{word}
							</text>
						);
					})}

					{bands.map((b) => {
						const d = pathOfBand(b);
						const dry = !b.value;
						const outside = b.kind === "source" ? places.get(b.from)?.outside || b.outside > b.value / 2 : b.outside > b.value / 2;
						const tone = outside && b.kind !== "loop" && b.kind !== "failed" ? "stroke-chart-4" : BAND_TONE[b.kind];
						const lit = hovered === bandTarget(b) || (focus && touches(b) && focus !== undefined);
						const recent = Math.max(0, ...b.pulses.map((p) => (p.replayed ? 0 : p.opacity)));
						return (
							<g key={b.id} opacity={touches(b) ? 1 : 0.25}>
								<path
									d={d}
									fill="none"
									className={tone}
									strokeWidth={b.width}
									strokeLinecap="butt"
									strokeLinejoin="round"
									strokeDasharray={dry ? "2 4" : undefined}
									opacity={(dry ? 0.5 : (b.kind === "loop" ? 0.6 : 0.22) + 0.18 * recent + (lit ? 0.2 : 0)) * (dammed(b) ? 0.35 : 1)}
								/>
								<path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(10, b.width)} {...press(bandTarget(b))} />
							</g>
						);
					})}

					{waiting.map((id) => {
						const p = places.get(id);
						if (!p) return null;
						const out = bands.filter((b) => b.from === id);
						const lo = Math.min(p.y + 8, ...out.map((b) => b.y0 - b.width / 2));
						const hi = Math.max(p.y + p.h - 8, ...out.map((b) => b.y0 + b.width / 2));
						const x = p.x + p.w + 7;
						return (
							<g key={`dam:${id}`} data-dam={id} pointerEvents="none">
								<rect x={p.x + p.w} y={lo - 2} width={7} height={hi - lo + 4} className="fill-chart-4" opacity={0.18 + 0.12 * glow} />
								<rect x={x} y={lo - 6} width={7} height={hi - lo + 12} rx={2} fill="url(#river-dam)" className="stroke-chart-4" strokeWidth={1.5} />
								<text x={x + 12} y={lo - 8} className="fill-chart-4 text-[11px] font-medium">
									waiting for you
								</text>
							</g>
						);
					})}

					{[...places.values()].map((p) => {
						if (p.kind === "agent") return <AgentPlace key={p.id} place={p} model={model} glow={glow} narrow={narrow} hovered={hovered} press={press} />;
						const left = p.col === 0;
						const tone =
							p.kind === "owner"
								? "fill-primary"
								: p.kind === "schedule"
									? "fill-muted-foreground"
									: p.kind === "failed"
										? "fill-destructive"
										: p.kind === "reply"
											? "fill-primary"
											: p.outside
												? "fill-chart-4"
												: "fill-chart-2";
						return (
							<g key={p.id} data-place={p.id} {...press(p.target)}>
								<rect x={p.x} y={p.y} width={p.w} height={p.h} rx={3} className={tone} strokeDasharray={p.kind === "schedule" ? "3 2" : undefined} />
								<text x={left ? p.x - 8 : p.x + p.w + 8} y={p.y + p.h / 2 + (p.note && !narrow ? -1 : 4)} textAnchor={left ? "end" : "start"} className="fill-foreground text-xs font-medium">
									{p.name}
								</text>
								{p.note && !narrow ? (
									<text x={left ? p.x - 8 : p.x + p.w + 8} y={p.y + p.h / 2 + 12} textAnchor={left ? "end" : "start"} className="fill-muted-foreground text-[10px]">
										{p.note}
										{p.outside ? " · outside" : ""}
									</text>
								) : null}
							</g>
						);
					})}

					{bands.flatMap((b) =>
						b.pulses.flatMap((p) => {
							if (p.replayed || p.age < 0 || p.age > TRAVEL) return [];
							const t = ease(p.age / TRAVEL);
							const outside = isOutside(p);
							// Spread across the band's width, so that a burst reads as many.
							const lane = b.width > 8 && !b.points ? (((p.id * 37) % 100) / 100 - 0.5) * (b.width - 6) : 0;
							const at = (s: number) => {
								const q = pointOn(b, Math.max(0, Math.min(1, s)));
								return { x: q.x, y: q.y + lane };
							};
							const head = at(t);
							const id = `pulse:${p.id}`;
							return [
								<g key={`${b.id}#${p.id}`} className="cursor-pointer" onClick={() => onPick(id)} {...hoverProps(id)}>
									{[0.09, 0.06, 0.03].map((back, i) => {
										const q = at(t - back);
										return <circle key={back} cx={q.x} cy={q.y} r={2 + i * 0.6} className={outside ? "fill-chart-4" : "fill-primary"} opacity={0.15 + i * 0.15} />;
									})}
									<circle cx={head.x} cy={head.y} r={9} className={outside ? "fill-chart-4" : "fill-primary"} opacity={0.18} />
									<circle cx={head.x} cy={head.y} r={4} strokeWidth={1.5} className={outside ? "fill-chart-4 stroke-background" : "fill-primary stroke-background"} />
								</g>,
							];
						}),
					)}

					{bands.some((b) => b.kind === "loop") ? (
						<text x={width / 2} y={floor + 14} textAnchor="middle" className="fill-chart-3 text-[10px] tracking-widest uppercase">
							delegations
						</text>
					) : null}
					<text x={width - 12} y={height - 8} textAnchor="end" className="fill-muted-foreground text-[10px]">
						width: events over the last 15 min
					</text>
				</svg>
			) : null}
		</div>
	);
}

function AgentPlace({
	place: p,
	model,
	glow,
	narrow,
	hovered,
	press,
}: {
	place: Place;
	model: BirdviewModel;
	glow: number;
	narrow: boolean;
	hovered?: string;
	press: (id?: string) => object;
}) {
	const a = p.agent!;
	const sats = model.satellites.filter((s) => s.agent === a.id);
	const shown = sats.slice(0, narrow ? 5 : 9);
	const ring =
		a.state === "working" ? "stroke-primary" : a.state === "waiting" ? "stroke-chart-4" : a.state === "queued" ? "stroke-muted-foreground" : hovered === p.id ? "stroke-foreground" : "stroke-border";
	const note = a.state === "idle" ? (a.idle ? `idle · +${a.idle}` : "idle") : a.tool && a.state === "working" ? a.tool : STATE_WORD[a.state];
	return (
		<g data-node={p.id} data-state={a.state}>
			{a.state === "working" ? <rect x={p.x - 4} y={p.y - 4} width={p.w + 8} height={p.h + 8} rx={14} className="fill-primary" filter="url(#river-glow)" opacity={0.35 + 0.3 * glow} /> : null}
			{a.state === "waiting" ? <rect x={p.x - 4} y={p.y - 4} width={p.w + 8} height={p.h + 8} rx={14} className="fill-chart-4" filter="url(#river-glow)" opacity={0.25 + 0.2 * glow} /> : null}
			<g {...press(p.id)}>
				<rect
					x={p.x}
					y={p.y}
					width={p.w}
					height={p.h}
					rx={10}
					strokeWidth={a.state === "idle" ? 1 : 2}
					strokeDasharray={a.state === "queued" ? "4 3" : undefined}
					className={cn("fill-card", ring)}
				/>
				<text x={p.x + 12} y={p.y + 20} className={cn("fill-foreground text-[13px]", a.main ? "font-semibold" : "font-medium")}>
					{a.id}
				</text>
				{a.outside ? (
					<g>
						<circle cx={p.x + p.w - 12} cy={p.y + 15} r={4} className="fill-chart-4" />
					</g>
				) : null}
				<text x={p.x + 12} y={p.y + 35} className={cn("text-[11px]", a.state === "working" ? "fill-primary font-mono" : a.state === "waiting" ? "fill-chart-4" : "fill-muted-foreground")}>
					{note}
				</text>
			</g>
			{shown.map((s, i) => {
				const cx = p.x + 16 + i * 13;
				const cy = p.y + 48;
				if (cy + 4 > p.y + p.h) return null;
				const fill =
					s.ended === "failed" ? "fill-destructive" : s.state === "working" ? "fill-primary" : s.state === "waiting" ? "fill-chart-4" : s.state === "queued" ? "fill-background" : "fill-muted-foreground";
				return (
					<g key={s.id} opacity={s.opacity} {...press(s.id)}>
						{s.outside ? <circle cx={cx} cy={cy} r={6.5} fill="none" strokeWidth={1.2} strokeDasharray="2 1.5" className="stroke-chart-4" /> : null}
						<circle cx={cx} cy={cy} r={4} strokeWidth={1} className={cn(fill, s.state === "queued" ? "stroke-muted-foreground" : "stroke-background")} />
						{s.kind !== "conversation" ? <circle cx={cx} cy={cy} r={1.4} className="fill-background" /> : null}
					</g>
				);
			})}
			{sats.length > shown.length ? (
				<text x={p.x + 16 + shown.length * 13} y={p.y + 52} className="fill-muted-foreground text-[10px]">
					+{sats.length - shown.length}
				</text>
			) : null}
		</g>
	);
}
