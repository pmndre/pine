// What the bird's-eye view's drawing is made of, on top of its model (birdview.ts): the layers the
// owner switches, the one line a hover shows, where a click goes, and the geometry of the lines.
// No React and no I/O, so that every direction of the view draws from the same rules.
import type { BirdviewModel, Hover, Link, State } from "./birdview.ts";

/** What the owner can switch on and off in the view. */
export type Layer = "sources" | "schedules" | "conversations" | "tools" | "routes" | "mcp" | "skills";

/** The layers in the order the toolbar shows them, with pine's word for each. */
export const LAYERS: ReadonlyArray<{ id: Layer; label: string }> = [
	{ id: "sources", label: "Sources" },
	{ id: "schedules", label: "Schedules" },
	{ id: "conversations", label: "Conversations" },
	{ id: "tools", label: "Tool calls" },
	{ id: "routes", label: "Routes" },
	{ id: "mcp", label: "MCP servers" },
	{ id: "skills", label: "Skills" },
];

export const DEFAULT_LAYERS: Layer[] = ["sources", "schedules", "conversations", "tools"];

/** The node a conversation, sub-agent or delegated task is drawn as when conversations are off: its agent. */
function anchorFor(m: BirdviewModel): (id: string) => string {
	const agentOf = new Map(m.satellites.map((s) => [s.id, s.agent]));
	return (id) => {
		if (id.startsWith("conv:")) return `agent:${id.slice(5).split("/")[0]}`;
		if (id.startsWith("task:")) return agentOf.has(id) ? `agent:${agentOf.get(id)}` : id;
		return id;
	};
}

/** The model with only what the layers that are on show. Routes, MCP servers and skills have nothing in the model yet. */
export function withLayers(m: BirdviewModel, on: readonly Layer[]): BirdviewModel {
	const has = (l: Layer) => on.includes(l);
	let { agents, satellites, sources, schedules, links, pulses } = m;
	if (!has("sources")) {
		sources = [];
		links = links.filter((l) => l.kind !== "subscription");
		pulses = pulses.filter((p) => p.kind !== "source" && p.kind !== "send");
	}
	if (!has("schedules")) {
		schedules = [];
		links = links.filter((l) => l.kind !== "schedule");
		pulses = pulses.filter((p) => p.kind !== "schedule");
	}
	if (!has("tools")) {
		agents = agents.map((a) => ({ ...a, tool: undefined }));
		satellites = satellites.map((s) => ({ ...s, tool: undefined }));
		pulses = pulses.filter((p) => p.kind !== "tool");
	}
	if (!has("conversations")) {
		const anchor = anchorFor(m);
		satellites = [];
		const seen = new Set<string>();
		links = links
			.map((l): Link => ({ ...l, from: anchor(l.from), to: anchor(l.to) }))
			.filter((l) => {
				const key = `${l.kind}:${l.from}>${l.to}`;
				if (l.from === l.to || seen.has(key)) return false;
				seen.add(key);
				return true;
			});
		pulses = pulses.map((p) => ({ ...p, from: p.from && anchor(p.from), to: p.to.map(anchor) }));
	}
	return { ...m, agents, satellites, sources, schedules, links, pulses };
}

const STATE_WORD: Record<State, string> = { idle: "idle", queued: "queued", working: "working", waiting: "waiting, approval asked" };

/** pine's name for a node: an agent, `agent/conversation`, a source's or a schedule's key. */
export function nameOf(m: BirdviewModel, id: string): string {
	const colon = id.indexOf(":");
	const rest = id.slice(colon + 1);
	if (id.startsWith("task:")) {
		const s = m.satellites.find((x) => x.id === id);
		return s ? `${s.agent}/${s.session}` : `task ${rest}`;
	}
	return rest;
}

/** What a hover shows: pine's words for the thing, and the content it carried as one plain line. */
export interface Line {
	label: string;
	hover?: Hover;
}

/** The hover line for a node, a link or a pulse (`pulse:<id>`), by its id. */
export function describe(m: BirdviewModel, id: string): Line | undefined {
	if (id.startsWith("pulse:")) {
		const p = m.pulses.find((x) => String(x.id) === id.slice(6));
		if (!p) return undefined;
		const where = p.from ?? p.to[0];
		const label = where ? `${nameOf(m, where)}: ${p.label}` : p.label;
		return p.hover ? { label, hover: p.hover } : { label };
	}
	if (id.startsWith("link:")) {
		const l = m.links.find((x) => x.id === id.slice(5));
		if (!l) return undefined;
		const label = `${nameOf(m, l.from)} to ${nameOf(m, l.to)}`;
		// What the line carried last, either way.
		const last = m.pulses.filter((p) => (p.from === l.from && p.to.includes(l.to)) || (p.from === l.to && p.to.includes(l.from))).at(-1);
		if (!last) return { label };
		return last.hover ? { label: `${label}, last: ${last.label}`, hover: last.hover } : { label: `${label}, last: ${last.label}` };
	}
	if (id.startsWith("agent:")) {
		const a = m.agents.find((x) => `agent:${x.id}` === id);
		return a && { label: `${a.id}: ${STATE_WORD[a.state]}${a.tool ? `, calling ${a.tool}` : ""}` };
	}
	const s = m.satellites.find((x) => x.id === id);
	if (s) {
		const ended = s.state === "idle" && s.ended ? s.ended : STATE_WORD[s.state];
		const kind = s.kind === "conversation" ? "" : s.kind === "delegate" ? ", delegated" : ", sub-agent";
		return { label: `${s.agent}/${s.session}: ${ended}${kind}${s.tool ? `, calling ${s.tool}` : ""}${s.outside ? ", outside content" : ""}` };
	}
	const src = m.sources.find((x) => x.id === id);
	if (src) return { label: `${nameOf(m, id)}: ${src.type} source, ${src.trust}${src.running ? "" : ", stopped"}` };
	const sch = m.schedules.find((x) => x.id === id);
	if (sch) return { label: `${nameOf(m, id)}: ${sch.when}` };
	return undefined;
}

/** Where a click goes. The view does nothing else: no stop, no approve. */
export type Pick =
	| { to: "agent"; agent: string }
	| { to: "conversation"; agent: string; session: string }
	| { to: "setting"; id: string }
	| { to: "events"; topic: string };

/** Where a click on a node or a pulse goes. */
export function pick(m: BirdviewModel, id: string): Pick | undefined {
	if (id.startsWith("agent:")) return { to: "agent", agent: id.slice(6) };
	if (id.startsWith("pulse:")) {
		const p = m.pulses.find((x) => String(x.id) === id.slice(6));
		return p && { to: "events", topic: p.topic };
	}
	if (id.startsWith("source:") || id.startsWith("schedule:")) return { to: "setting", id };
	const s = m.satellites.find((x) => x.id === id);
	if (s) return { to: "conversation", agent: s.agent, session: s.session };
	if (id.startsWith("conv:")) {
		const [agent, ...session] = id.slice(5).split("/");
		return { to: "conversation", agent, session: session.join("/") };
	}
	return undefined;
}

export interface Point {
	x: number;
	y: number;
}

/**
 * A transit-map line from `a` to `b`: straight, then at 45 degrees, then straight. It leaves
 * sideways when the two are further apart across than down, and downward otherwise.
 */
export function metroPath(a: Point, b: Point): Point[] {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const sx = Math.sign(dx);
	const sy = Math.sign(dy);
	let points: Point[];
	if (Math.abs(dx) >= Math.abs(dy)) {
		const run = (Math.abs(dx) - Math.abs(dy)) / 2;
		points = [a, { x: a.x + sx * run, y: a.y }, { x: b.x - sx * run, y: b.y }, b];
	} else {
		const run = (Math.abs(dy) - Math.abs(dx)) / 2;
		points = [a, { x: a.x, y: a.y + sy * run }, { x: b.x, y: b.y - sy * run }, b];
	}
	return points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
}

/** Every corner of a line of straight segments cut by a diagonal, `r` long on each side at most. */
export function chamfer(points: Point[], r: number): Point[] {
	const out: Point[] = [points[0]];
	for (let i = 1; i < points.length - 1; i++) {
		const [p, c, n] = [points[i - 1], points[i], points[i + 1]];
		const into = Math.hypot(c.x - p.x, c.y - p.y);
		const away = Math.hypot(n.x - c.x, n.y - c.y);
		const cut = Math.min(r, into / 2, away / 2);
		if (!cut) {
			out.push(c);
			continue;
		}
		out.push({ x: c.x - ((c.x - p.x) / into) * cut, y: c.y - ((c.y - p.y) / into) * cut });
		out.push({ x: c.x + ((n.x - c.x) / away) * cut, y: c.y + ((n.y - c.y) / away) * cut });
	}
	out.push(points.at(-1)!);
	return out.filter((p, i) => i === 0 || p.x !== out[i - 1].x || p.y !== out[i - 1].y);
}

/**
 * A switchboard track from `a` to `b`, never across a card: sideways to the trunk (the gap before
 * the first column of cards) when there is one, along it to the lane (the gap above the row `b`
 * lies in), along the lane, and down into `b`. Corners are cut at 45 degrees.
 */
export function track(a: Point, b: Point, route: { trunk?: number; lane: number }): Point[] {
	const turns = route.trunk === undefined ? [a, { x: a.x, y: route.lane }] : [a, { x: route.trunk, y: a.y }, { x: route.trunk, y: route.lane }];
	return chamfer([...turns, { x: b.x, y: route.lane }, b], 8);
}

/** The point at a fraction `t` (0 to 1) of a line's length. */
export function pointAlong(points: Point[], t: number): Point {
	const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
	let left = Math.max(0, Math.min(1, t)) * lengths.reduce((a, b) => a + b, 0);
	for (let i = 0; i < lengths.length; i++) {
		if (left <= lengths[i] || i === lengths.length - 1) {
			const f = lengths[i] ? left / lengths[i] : 0;
			return { x: points[i].x + (points[i + 1].x - points[i].x) * f, y: points[i].y + (points[i + 1].y - points[i].y) * f };
		}
		left -= lengths[i];
	}
	return points[0];
}

/** An SVG path through the points. */
export const pathOf = (points: Point[]) => points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

/** How long a pulse takes to ride its line, ms; after that it ripples on what it reached. */
export const TRAVEL = 1400;

export interface Placed extends Point {
	/** The radius it is drawn with. */
	r: number;
	/** The direction from the centre, radians, for a label that should lean outward. */
	angle: number;
}

const TURN = Math.PI * 2;

/** Below this width, px, the constellation puts every agent's conversations above it and its name below. */
export const NARROW = 560;

export interface Ellipse {
	rx: number;
	ry: number;
}

/**
 * The constellation's two rings in a box of `w` by `h`: ellipses, so that a tall, narrow window is
 * used to its height. The outer one leaves room at the sides for the sources' names, and the
 * agents' one lies well inside it.
 */
export function rings(w: number, h: number): { ring: Ellipse; outer: Ellipse } {
	const outer = { rx: Math.max(40, w / 2 - 100), ry: Math.max(40, h / 2 - 36) };
	return { outer, ring: { rx: outer.rx * 0.62, ry: outer.ry * 0.62 } };
}

/**
 * Where everything lies on the constellation, in a box of `w` by `h`: the main agent at the centre,
 * the others on a ring in the order of their names (so that they never move while things happen),
 * each one's active conversations orbiting it, and sources and schedules on an outer ring, each
 * beside the agents it wakes. Plain trigonometry, no physics: nothing jitters.
 */
export function constellation(m: BirdviewModel, w: number, h: number): Map<string, Placed> {
	const at = new Map<string, Placed>();
	const cx = w / 2;
	const cy = h / 2;
	const size = Math.min(w, h);
	const { ring, outer } = rings(w, h);
	const r = Math.max(12, Math.min(24, size * 0.035));
	// In a narrow box agents lie close together across: their conversations all go above them,
	// leaving the space below each for its name.
	const narrow = w < NARROW;
	/** At `angle` on an ellipse of radii `radius` around `from`, or on a circle when `radius` is a number. */
	const put = (id: string, angle: number, radius: number | Ellipse, rr: number, from = { x: cx, y: cy }) => {
		const { rx, ry } = typeof radius === "number" ? { rx: radius, ry: radius } : radius;
		at.set(id, { x: from.x + Math.cos(angle) * rx, y: from.y + Math.sin(angle) * ry, r: rr, angle });
	};

	const main = m.agents.find((a) => a.main);
	if (main) at.set(`agent:${main.id}`, { x: cx, y: cy, r: r * 1.25, angle: -Math.PI / 2 });
	const others = m.agents.filter((a) => a !== main);
	// An even number would put two agents in line with the main one: turned by half a step.
	const turn = others.length % 2 ? 0 : Math.PI / Math.max(1, others.length) / 2;
	others.forEach((a, i) => put(`agent:${a.id}`, -Math.PI / 2 + turn + (i * TURN) / Math.max(1, others.length), ring, r));

	// Satellites spread on an arc that faces away from the centre, or all around the main agent.
	const byAgent = new Map<string, string[]>();
	for (const s of m.satellites) byAgent.set(s.agent, [...(byAgent.get(s.agent) ?? []), s.id]);
	for (const [agent, ids] of byAgent) {
		const home = at.get(`agent:${agent}`);
		if (!home) continue;
		const isMain = agent === main?.id;
		const orbit = home.r + Math.max(16, size * 0.055);
		// The main agent's go on its upper half, leaving the space below it for its name.
		const step = isMain ? Math.min(0.6, Math.PI / ids.length) : Math.min(0.55, (Math.PI * 1.2) / ids.length);
		ids.sort().forEach((id, i) => {
			const angle = (isMain || narrow ? -Math.PI / 2 : home.angle) + (i - (ids.length - 1) / 2) * step;
			put(id, angle, orbit, Math.max(5, r * 0.32), home);
		});
	}

	// Sources and schedules: at the mean direction of the agents they wake, then pushed apart.
	const outerIds = [...m.sources.map((s) => s.id), ...m.schedules.map((s) => s.id)];
	const wanted = outerIds.map((id, i) => {
		let x = 0;
		let y = 0;
		for (const l of m.links) {
			if (l.from !== id) continue;
			const agent = l.to.startsWith("conv:") ? `agent:${l.to.slice(5).split("/")[0]}` : l.to;
			const p = at.get(agent);
			if (p && agent !== `agent:${main?.id}`) {
				x += Math.cos(p.angle);
				y += Math.sin(p.angle);
			}
		}
		const angle = x || y ? Math.atan2(y, x) : -Math.PI / 2 + ((i + 0.5) * TURN) / outerIds.length;
		return { id, angle };
	});
	wanted.sort((a, b) => a.angle - b.angle);
	const gap = Math.min(TURN / Math.max(1, wanted.length), 0.38);
	for (let pass = 0; pass < 4; pass++) {
		for (let i = 1; i < wanted.length; i++) if (wanted[i].angle - wanted[i - 1].angle < gap) wanted[i].angle = wanted[i - 1].angle + gap;
	}
	for (const { id, angle } of wanted) put(id, angle, outer, Math.max(6, r * 0.45));
	return at;
}
