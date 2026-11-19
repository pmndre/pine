import { cn } from "cn";
import type { MouseEvent, ReactNode } from "react";
import type { AgentNode, BirdviewModel, Link, Pulse, Satellite, SourceNode } from "../birdview.ts";
import { pathOf, type Point, pointAlong } from "../birdview-layout.ts";
import type { DrawProps } from "../Birdview.tsx";

// Direction C of the bird's-eye view, the town: a little office seen from above, like a sim game.
// Each agent is a character at a desk in a room of its own; its conversations are visitors on the
// chairs in front of the desk; sources are buildings along the west edge and schedules clock towers
// along the north; events are envelopes walking the streets to the rooms they wake; a delegation is
// one agent's character walking to another's room. Everything moves with the model's clock
// (`model.now`), never a timer of its own, so a story that stands still draws the same every time.

const ROOM_W = 236;
const ROOM_H = 188;
const GAP_X = 36;
const ROW_GAP = 84;
const LEFT = 250;
const TOP = 160;
const AVENUE_X = 200;
const ROAD = 26;
const TOP_STREET = 112;
const SEATS = 4;
/** How long an envelope or a walker takes from door to door, ms. */
const WALK = 3000;
/** How long a check, a cross or a sparkle stays over a room, ms. */
const POP = 1400;

const SHIRTS = ["fill-chart-1", "fill-chart-2", "fill-chart-3", "fill-chart-5", "fill-primary", "fill-chart-4"];
const STROKES = ["stroke-chart-1", "stroke-chart-2", "stroke-chart-3", "stroke-chart-5", "stroke-primary", "stroke-chart-4"];
const SKINS = ["#f1c7a1", "#c88d62", "#8b5a3c", "#e9b48c", "#a86f4a", "#f5d6b8"];
const HAIR = ["#3b2a20", "#151515", "#6b3f22", "#c79a4b", "#2c2c2c", "#8a4b2a"];

interface Room {
	agent: AgentNode;
	index: number;
	x: number;
	y: number;
	row: number;
	door: Point;
	street: number;
}

interface Layout {
	width: number;
	height: number;
	rooms: Map<string, Room>;
	sources: Map<string, Point & { node: SourceNode }>;
	towers: Map<string, Point>;
	streets: number[];
}

function layout(model: BirdviewModel): Layout {
	const n = Math.max(1, model.agents.length);
	const cols = n <= 3 ? n : Math.min(4, Math.ceil(n / 2));
	const rows = Math.ceil(n / cols);
	const rooms = new Map<string, Room>();
	model.agents.forEach((agent, index) => {
		const col = index % cols;
		const row = Math.floor(index / cols);
		const x = LEFT + col * (ROOM_W + GAP_X);
		const y = TOP + row * (ROOM_H + ROW_GAP);
		rooms.set(agent.id, { agent, index, x, y, row, door: { x: x + ROOM_W / 2, y: y + ROOM_H }, street: y + ROOM_H + ROW_GAP / 2 });
	});
	const width = LEFT + cols * (ROOM_W + GAP_X) + 4;
	const height = TOP + rows * (ROOM_H + ROW_GAP) + 4;
	const streets = Array.from({ length: rows }, (_, r) => TOP + r * (ROOM_H + ROW_GAP) + ROOM_H + ROW_GAP / 2);
	const sources = new Map<string, Point & { node: SourceNode }>();
	const count = model.sources.length;
	const span = height - TOP - 90;
	const step = count > 1 ? Math.min(118, span / (count - 1)) : 0;
	model.sources.forEach((node, i) => sources.set(node.id, { x: 92, y: TOP + 30 + i * step, node }));
	const towers = new Map<string, Point>();
	model.schedules.forEach((s, i) => towers.set(s.id, { x: LEFT + 70 + i * 150, y: 70 }));
	return { width, height, rooms, sources, towers, streets };
}

/** The agent whose room a node is drawn in. */
function agentIdOf(model: BirdviewModel, id: string): string | undefined {
	if (id.startsWith("agent:")) return id.slice(6);
	if (id.startsWith("conv:")) return id.slice(5).split("/")[0];
	return model.satellites.find((s) => s.id === id)?.agent;
}

/** The streets from a door to another, never through a room. */
function betweenRooms(a: Room, b: Room): Point[] {
	if (a.row === b.row) return [a.door, { x: a.door.x, y: a.street }, { x: b.door.x, y: b.street }, b.door];
	return [a.door, { x: a.door.x, y: a.street }, { x: AVENUE_X, y: a.street }, { x: AVENUE_X, y: b.street }, { x: b.door.x, y: b.street }, b.door];
}

/** The way from a node to another, along the streets: the walk an envelope or a visitor takes. */
function route(model: BirdviewModel, town: Layout, from: string, to: string): Point[] | undefined {
	const roomOf = (id: string) => {
		const agent = agentIdOf(model, id);
		return agent ? town.rooms.get(agent) : undefined;
	};
	const source = town.sources.get(from) ?? town.sources.get(to);
	const tower = town.towers.get(from);
	if (source) {
		const room = roomOf(source === town.sources.get(from) ? to : from);
		if (!room) return undefined;
		const way = [{ x: source.x + 52, y: source.y }, { x: AVENUE_X, y: source.y }, { x: AVENUE_X, y: room.street }, { x: room.door.x, y: room.street }, room.door];
		return town.sources.get(from) ? way : way.reverse();
	}
	if (tower) {
		const room = roomOf(to);
		if (!room) return undefined;
		return [{ x: tower.x, y: tower.y + 22 }, { x: tower.x, y: TOP_STREET }, { x: AVENUE_X, y: TOP_STREET }, { x: AVENUE_X, y: room.street }, { x: room.door.x, y: room.street }, room.door];
	}
	const a = roomOf(from);
	const b = roomOf(to);
	return a && b && a !== b ? betweenRooms(a, b) : undefined;
}

const wave = (now: number, period: number, offset = 0) => Math.sin(((now + offset) / period) * Math.PI * 2);

/** A person seen from above: shoulders, head and hair, and the hands where they are. */
function Person({ x, y, index, scale = 1, facing, hands, now, hat, faded }: { x: number; y: number; index: number; scale?: number; facing: "up" | "down"; hands: "typing" | "raised" | "rest" | "walking"; now: number; hat?: boolean; faded?: number }) {
	const f = facing === "down" ? 1 : -1;
	const tap = (side: number) => (hands === "typing" ? Math.max(0, wave(now, 260, side * 130)) * 3 : 0);
	const swing = hands === "walking" ? wave(now, 420) * 4 : 0;
	return (
		<g transform={`translate(${x} ${y}) scale(${scale})`} opacity={faded}>
			<ellipse cx={0} cy={2} rx={15} ry={9} className="fill-foreground/10" />
			{hands === "raised" ? (
				<>
					<line x1={11} y1={0} x2={15} y2={-22 + wave(now, 500) * 2} strokeWidth={4} strokeLinecap="round" className={STROKES[index % STROKES.length]} />
					<circle cx={15} cy={-24 + wave(now, 500) * 2} r={3.6} fill={SKINS[index % SKINS.length]} />
				</>
			) : null}
			<ellipse cx={0} cy={0} rx={13} ry={8} className={SHIRTS[index % SHIRTS.length]} />
			{hands !== "raised" ? (
				<>
					<circle cx={-9 - swing / 2} cy={f * (9 - tap(-1)) + swing} r={3.2} fill={SKINS[index % SKINS.length]} />
					<circle cx={9 + swing / 2} cy={f * (9 - tap(1)) - swing} r={3.2} fill={SKINS[index % SKINS.length]} />
				</>
			) : (
				<circle cx={-9} cy={f * 8} r={3.2} fill={SKINS[index % SKINS.length]} />
			)}
			<circle cx={0} cy={f * -1} r={7.5} fill={SKINS[index % SKINS.length]} />
			<path d={facing === "down" ? "M-7.5,-2 A7.5,7.5 0 0 1 7.5,-2 L6,-5 L-6,-5 Z" : "M-7.5,0 A7.5,7.5 0 0 0 7.5,0 A7.5,9 0 0 0 -7.5,0 Z"} fill={HAIR[index % HAIR.length]} />
			{hat ? (
				<>
					<ellipse cx={0} cy={f * -1} rx={12} ry={11} className="fill-chart-4/50 stroke-chart-4" strokeWidth={1.5} />
					<circle cx={0} cy={f * -1} r={6.5} className="fill-chart-4 stroke-foreground/40" strokeWidth={1} />
				</>
			) : null}
		</g>
	);
}

/** A little speech bubble with a few words of pine's, pointing down at what says it. */
function Bubble({ x, y, children, tone = "fill-card", text = "fill-foreground", width }: { x: number; y: number; children: ReactNode; tone?: string; text?: string; width: number }) {
	return (
		<g transform={`translate(${x} ${y})`}>
			<rect x={-width / 2} y={-18} width={width} height={16} rx={8} className={cn(tone, "stroke-foreground/25")} strokeWidth={1} />
			<path d="M-4,-2.5 L0,4 L4,-2.5 Z" className={tone} />
			<text x={0} y={-6.5} textAnchor="middle" className={cn(text, "font-mono text-[9.5px]")}>
				{children}
			</text>
		</g>
	);
}

function Bell({ x, y, now }: { x: number; y: number; now: number }) {
	return (
		<g transform={`translate(${x} ${y}) rotate(${wave(now, 300) * 18})`}>
			<path d="M-6,3 C-6,-6 6,-6 6,3 L8,5 L-8,5 Z" className="fill-chart-4 stroke-foreground/40" strokeWidth={1} />
			<circle cx={0} cy={7} r={1.8} className="fill-chart-4" />
			<path d="M-11,-4 Q-13,0 -11,4 M11,-4 Q13,0 11,4" fill="none" className="stroke-chart-4" strokeWidth={1.5} opacity={0.5 + 0.5 * wave(now, 300)} />
		</g>
	);
}

function Envelope({ x, y, outside, now }: { x: number; y: number; outside?: boolean; now: number }) {
	return (
		<g transform={`translate(${x} ${y - 8 + wave(now, 400) * 2})`}>
			<ellipse cx={0} cy={10} rx={7} ry={2} className="fill-foreground/15" />
			<rect x={-8} y={-5.5} width={16} height={11} rx={1.5} className="fill-card stroke-foreground/60" strokeWidth={1.2} />
			<path d="M-8,-5 L0,1.5 L8,-5" fill="none" className="stroke-foreground/60" strokeWidth={1.2} />
			<circle cx={0} cy={2} r={2.4} className={outside ? "fill-chart-4" : "fill-primary"} />
		</g>
	);
}

function PaperPlane({ x, y, now }: { x: number; y: number; now: number }) {
	return (
		<g transform={`translate(${x} ${y - 10 + wave(now, 500) * 3})`}>
			<path d="M-9,-2 L9,-7 L2,8 L-1,1 Z" className="fill-card stroke-chart-2" strokeWidth={1.4} strokeLinejoin="round" />
			<path d="M-1,1 L9,-7" className="stroke-chart-2" strokeWidth={1} />
		</g>
	);
}

/** A building on the west edge for an event source, drawn after its type. */
function Building({ x, y, node, busy, now }: { x: number; y: number; node: SourceNode; busy: number; now: number }) {
	const wall = "fill-card stroke-foreground/50";
	const roof = node.trust === "owner" ? "fill-primary/70" : "fill-chart-4/70";
	const shake = busy ? wave(now, 120) * 1.5 * busy : 0;
	let body: ReactNode;
	switch (node.type) {
		case "mail":
			body = (
				<>
					<rect x={-40} y={-20} width={60} height={34} className={wall} strokeWidth={1.2} />
					<path d="M-44,-20 L-10,-40 L24,-20 Z" className={cn(roof, "stroke-foreground/50")} strokeWidth={1.2} />
					<rect x={-17} y={-2} width={14} height={16} className="fill-muted stroke-foreground/40" strokeWidth={1} />
					<rect x={-33} y={-12} width={10} height={8} className="fill-chart-2/40" />
					<rect x={4} y={-12} width={10} height={8} className="fill-chart-2/40" />
					<rect x={30} y={-4} width={14} height={11} rx={5} className="fill-destructive/80 stroke-foreground/40" strokeWidth={1} />
					<line x1={37} y1={7} x2={37} y2={14} className="stroke-foreground/50" strokeWidth={2} />
					<rect x={43} y={busy ? -14 : -4} width={2} height={10} className="fill-foreground/60" />
					<rect x={43} y={busy ? -14 : -4} width={7} height={4} className="fill-chart-4" />
				</>
			);
			break;
		case "telegram":
		case "mqtt":
			body = (
				<>
					<path d="M-8,14 L0,-36 L8,14 M-6,0 L6,0 M-4,-14 L4,-14 M-6,0 L4,-14 M6,0 L-4,-14" fill="none" className="stroke-foreground/60" strokeWidth={1.6} />
					<circle cx={0} cy={-38} r={3.5} className={node.trust === "owner" ? "fill-primary" : "fill-chart-4"} />
					{[1, 2, 3].map((k) => (
						<path key={k} d={`M${-6 - k * 6},${-44 + k} A${8 + k * 6},${8 + k * 6} 0 0 1 ${6 + k * 6},${-44 + k}`} fill="none" className="stroke-chart-2" strokeWidth={1.4} opacity={busy ? (0.3 + 0.7 * Math.max(0, wave(now, 600, k * 150))) * busy : 0.15} />
					))}
					<rect x={14} y={-6} width={28} height={20} className={wall} strokeWidth={1.2} />
					<path d="M12,-6 L28,-16 L44,-6 Z" className={cn(roof, "stroke-foreground/50")} strokeWidth={1} />
				</>
			);
			break;
		case "webhook":
			body = (
				<>
					<rect x={-40} y={-14} width={64} height={28} className={wall} strokeWidth={1.2} />
					<path d="M-40,-14 L-30,-26 L-30,-14 L-18,-26 L-18,-14 L-6,-26 L-6,-14 L6,-26 L6,-14" className={cn(roof, "stroke-foreground/50")} strokeWidth={1.2} />
					<rect x={12} y={-44} width={9} height={30} className="fill-muted stroke-foreground/50" strokeWidth={1.2} />
					{[0, 1, 2].map((k) => {
						const rise = ((now / 1600 + k / 3) % 1) * 20;
						return <circle key={k} cx={17 + rise / 3} cy={-48 - rise} r={3 + rise / 6} className="fill-muted-foreground" opacity={(busy ? 0.55 : 0.2) * (1 - rise / 20)} />;
					})}
					<rect x={-32} y={-4} width={10} height={8} className="fill-chart-2/40" />
					<rect x={-16} y={-4} width={10} height={8} className="fill-chart-2/40" />
				</>
			);
			break;
		case "feed":
			body = (
				<>
					<rect x={-34} y={-12} width={52} height={26} className={wall} strokeWidth={1.2} />
					{[0, 1, 2, 3, 4, 5].map((k) => (
						<rect key={k} x={-38 + k * 10} y={-24} width={10} height={12} className={k % 2 ? "fill-card" : roof} />
					))}
					<rect x={-38} y={-24} width={60} height={12} fill="none" className="stroke-foreground/50" strokeWidth={1.2} />
					<rect x={-26} y={-6} width={14} height={16} className="fill-muted stroke-foreground/30" />
					<path d="M-24,-2 h10 M-24,2 h10 M-24,6 h7" className="stroke-foreground/40" strokeWidth={1} />
					<rect x={-6} y={-6} width={16} height={16} className="fill-muted stroke-foreground/30" />
				</>
			);
			break;
		default:
			body = (
				<>
					<rect x={-30} y={-14} width={48} height={28} className={wall} strokeWidth={1.2} />
					<path d="M-34,-14 L-6,-34 L22,-14 Z" className={cn(roof, "stroke-foreground/50")} strokeWidth={1.2} />
					<rect x={-12} y={0} width={12} height={14} className="fill-muted stroke-foreground/40" />
				</>
			);
	}
	return (
		<g transform={`translate(${x + shake} ${y})`} opacity={node.running ? 1 : 0.45}>
			<ellipse cx={0} cy={16} rx={50} ry={5} className="fill-foreground/10" />
			{body}
		</g>
	);
}

function Tower({ x, y, when, ringing, now }: { x: number; y: number; when: string; ringing: number; now: number }) {
	// The hands show the model's time, so the clock turns as the story plays.
	const minutes = (now / 60_000) % 60;
	const hours = (now / 3_600_000) % 12;
	return (
		<g transform={`translate(${x} ${y})`}>
			<title>{when}</title>
			<ellipse cx={0} cy={22} rx={26} ry={4} className="fill-foreground/10" />
			<rect x={-16} y={-34} width={32} height={56} className="fill-card stroke-foreground/50" strokeWidth={1.2} />
			<path d="M-20,-34 L0,-56 L20,-34 Z" className="fill-muted-foreground/60 stroke-foreground/50" strokeWidth={1.2} />
			<g transform={`translate(0 -48) rotate(${ringing ? wave(now, 260) * 20 * ringing : 0})`}>
				<path d="M-4,2 C-4,-4 4,-4 4,2 L5,4 L-5,4 Z" className="fill-chart-4" />
			</g>
			<circle cx={0} cy={-16} r={11} className="fill-background stroke-foreground/60" strokeWidth={1.4} />
			<line x1={0} y1={-16} x2={Math.sin((hours / 12) * 2 * Math.PI) * 6} y2={-16 - Math.cos((hours / 12) * 2 * Math.PI) * 6} className="stroke-foreground" strokeWidth={1.8} strokeLinecap="round" />
			<line x1={0} y1={-16} x2={Math.sin((minutes / 60) * 2 * Math.PI) * 9} y2={-16 - Math.cos((minutes / 60) * 2 * Math.PI) * 9} className="stroke-foreground" strokeWidth={1.2} strokeLinecap="round" />
			<rect x={-6} y={8} width={12} height={14} rx={6} className="fill-muted stroke-foreground/40" />
			{ringing ? (
				<g opacity={ringing}>
					<path d="M-24,-52 Q-30,-46 -24,-40 M24,-52 Q30,-46 24,-40" fill="none" className="stroke-chart-4" strokeWidth={1.6} />
				</g>
			) : null}
		</g>
	);
}

/** Where the visitors of a room sit, in front of the desk. */
const seat = (room: Room, k: number): Point => ({ x: room.x + 40 + k * 52, y: room.y + 140 });

/** The visitor a satellite is: who comes to the desk, and how they look. */
function visitorOf(model: BirdviewModel, s: Satellite, agentIndex: Map<string, number>) {
	if (s.kind === "subagent") return { index: agentIndex.get(s.agent) ?? 0, scale: 0.72, hat: false };
	if (s.kind === "delegate") {
		const link = model.links.find((l) => l.to === s.id);
		const from = link ? agentIdOf(model, link.from) : undefined;
		return { index: agentIndex.get(from ?? s.agent) ?? 0, scale: 0.92, hat: s.untrusted, from };
	}
	// The owner's conversations are the owner's visits; outside content is a stranger in a hat.
	return { index: 5, scale: 0.92, hat: s.untrusted || s.outside };
}

function RoomView({ room, model, satellites, agentIndex, pops, delegating, onHover, onPick, hovered }: { room: Room; model: BirdviewModel; satellites: Satellite[]; agentIndex: Map<string, number>; pops: Pulse[]; delegating?: string; hovered?: string } & Pick<DrawProps, "onHover" | "onPick">) {
	const { agent, x, y, index } = room;
	const now = model.now;
	const hover = (id: string) => ({ onMouseEnter: () => onHover(id), onMouseLeave: () => onHover(undefined), onClick: (e: MouseEvent) => {
			e.stopPropagation();
			onPick(id);
		}, className: "cursor-pointer" });
	const head: Point = { x: x + ROOM_W / 2, y: y + 46 };
	const shown = satellites.slice(0, SEATS);
	const more = satellites.length - shown.length + agent.idle;
	const waiting = agent.state === "waiting";
	const lit = agent.state === "working" || waiting;
	const tone = waiting ? "stroke-chart-4" : agent.state === "working" ? "stroke-primary" : "stroke-foreground/45";
	const flashFor = (id: string) => pops.filter((p) => p.to.includes(id) || p.to.includes(`agent:${agent.id}`));
	const popAt = (p: Pulse): Point => {
		const k = shown.findIndex((s) => p.to.includes(s.id));
		return k >= 0 ? { x: seat(room, k).x, y: seat(room, k).y - 22 } : { x: head.x - 30, y: head.y - 18 };
	};
	return (
		<g>
			{/* The room: floor, a rug, walls with a door to the street, a plant. */}
			<g {...hover(`agent:${agent.id}`)}>
				<rect x={x} y={y} width={ROOM_W} height={ROOM_H} rx={6} className={cn("fill-card", hovered === `agent:${agent.id}` && "fill-accent")} />
				<ellipse cx={x + ROOM_W / 2} cy={y + 146} rx={ROOM_W / 2 - 18} ry={34} className={cn(SHIRTS[index % SHIRTS.length], "opacity-[0.08]")} />
				{Array.from({ length: 5 }, (_, k) => (
					<line key={k} x1={x} y1={y + 32 + k * 32} x2={x + ROOM_W} y2={y + 32 + k * 32} className="stroke-foreground/5" />
				))}
				<path d={`M${room.door.x - 18},${y + ROOM_H} H${x + 6} Q${x},${y + ROOM_H} ${x},${y + ROOM_H - 6} V${y + 6} Q${x},${y} ${x + 6},${y} H${x + ROOM_W - 6} Q${x + ROOM_W},${y} ${x + ROOM_W},${y + 6} V${y + ROOM_H - 6} Q${x + ROOM_W},${y + ROOM_H} ${x + ROOM_W - 6},${y + ROOM_H} H${room.door.x + 18}`} fill="none" className={tone} strokeWidth={waiting ? 4 + wave(now, 700) * 1.5 : 4} strokeLinejoin="round" />
				<path d={`M${room.door.x - 18},${y + ROOM_H} A18,18 0 0 1 ${room.door.x},${y + ROOM_H - 18}`} fill="none" className="stroke-foreground/20" strokeDasharray="2 3" />
				<circle cx={x + ROOM_W - 20} cy={y + 20} r={9} className="fill-primary/40" />
				<circle cx={x + ROOM_W - 24} cy={y + 17} r={5} className="fill-primary/60" />
				<circle cx={x + ROOM_W - 16} cy={y + 23} r={4} className="fill-primary/50" />
				{/* The desk, the screen that lights up when the agent works, and the agent. */}
				<rect x={x + 68} y={y + 60} width={100} height={30} rx={3} className="fill-muted-foreground/30 stroke-foreground/30" />
				<rect x={x + 98} y={y + 76} width={40} height={6} rx={1} className={lit ? "fill-chart-2" : "fill-foreground/30"} />
				{lit ? <rect x={x + 92} y={y + 82} width={52} height={16} rx={8} className="fill-chart-2" opacity={0.15 + 0.08 * wave(now, 900)} /> : null}
				<rect x={x + 106} y={y + 64} width={24} height={7} rx={1} className="fill-foreground/15" />
				<Person x={head.x} y={head.y} index={index} facing="down" now={now} hands={agent.state === "working" ? "typing" : waiting ? "raised" : "rest"} />
			</g>
			{/* The plaque over the door: pine's name for the agent. */}
			<g transform={`translate(${x + 10} ${y - 10})`}>
				{agent.main ? <path d="M0,-12 L4,-4 L-4,-4 Z M0,-12 L0,2" className="fill-chart-4 stroke-foreground/50" transform="translate(4 0)" /> : null}
				<text x={agent.main ? 14 : 0} y={0} className="fill-foreground text-[13px] font-semibold">
					{agent.id}
				</text>
				{agent.outside ? (
					<g transform={`translate(${(agent.main ? 14 : 0) + agent.id.length * 8 + 8} -10)`}>
						<rect width={46} height={13} rx={6.5} className="fill-chart-4/25 stroke-chart-4" />
						<text x={23} y={9.5} textAnchor="middle" className="fill-foreground text-[8.5px]">
							outside
						</text>
					</g>
				) : null}
			</g>
			{/* What the agent is doing, over its head. */}
			{agent.state === "working" && agent.tool ? (
				<Bubble x={head.x + 58} y={head.y - 14} width={Math.max(46, agent.tool.length * 6 + 26)} tone="fill-primary/15" text="fill-foreground">
					{`⚒ ${agent.tool}`}
				</Bubble>
			) : null}
			{waiting ? <Bell x={head.x + 34} y={head.y - 22} now={now} /> : null}
			{agent.state === "queued" ? (
				<g transform={`translate(${head.x + 26} ${head.y - 18}) rotate(${(now / 8) % 180})`}>
					<path d="M-5,-7 H5 L0,0 L5,7 H-5 L0,0 Z" className="fill-muted stroke-foreground/60" strokeWidth={1.2} />
				</g>
			) : null}
			{agent.state === "idle"
				? [0, 1, 2].map((k) => {
						const t = ((now / 2400 + k / 3) % 1 + 1) % 1;
						return (
							<text key={k} x={head.x + 12 + t * 16} y={head.y - 10 - t * 24} className="fill-muted-foreground text-[11px] font-semibold" opacity={Math.sin(t * Math.PI)}>
								z
							</text>
						);
					})
				: null}
			{delegating ? (
				<Bubble x={head.x - 52} y={head.y - 14} width={delegating.length * 6 + 30} tone="fill-chart-3/20">
					{`→ ${delegating}`}
				</Bubble>
			) : null}
			{/* The visitors: a chair each, the conversation's name under it. */}
			{shown.map((s, k) => {
				const p = seat(room, k);
				const v = visitorOf(model, s, agentIndex);
				const id = s.id;
				const hands = s.state === "waiting" ? "raised" : "rest";
				return (
					<g key={id} {...hover(id)} opacity={s.opacity}>
						<rect x={p.x - 15} y={p.y - 6} width={30} height={22} rx={5} className={cn("fill-muted-foreground/35", hovered === id && "fill-accent-foreground/40")} />
						<Person x={p.x} y={p.y + 2} index={v.index} scale={v.scale} facing="up" hands={hands} now={now} hat={v.hat} />
						<text x={p.x} y={p.y + 30} textAnchor="middle" className="fill-muted-foreground font-mono text-[9px]">
							{s.kind === "subagent" ? "sub" : s.kind === "delegate" ? `from ${v.from ?? "?"}` : s.session.length > 9 ? `${s.session.slice(0, 8)}…` : s.session}
						</text>
						{v.hat ? (
							<g transform={`translate(${p.x + 6} ${p.y + 6})`}>
								<rect width={10} height={8} rx={1.5} className="fill-chart-4 stroke-foreground/50" strokeWidth={0.8} />
								<circle cx={5} cy={4} r={1.5} className="fill-card" />
							</g>
						) : null}
						{s.state === "working" ? (
							<g transform={`translate(${p.x} ${p.y - 22})`}>
								<rect x={-13} y={-6} width={26} height={12} rx={6} className="fill-card stroke-foreground/25" />
								{[0, 1, 2].map((d) => (
									<circle key={d} cx={-6 + d * 6} cy={0} r={1.8} className="fill-primary" opacity={0.3 + 0.7 * Math.max(0, wave(now, 900, -d * 200))} />
								))}
							</g>
						) : null}
						{s.state === "queued" ? (
							<path transform={`translate(${p.x} ${p.y - 22})`} d="M-4,-6 H4 L0,0 L4,6 H-4 L0,0 Z" className="fill-muted stroke-foreground/60" />
						) : null}
						{s.state === "waiting" ? <Bell x={p.x - 16} y={p.y - 20} now={now} /> : null}
						{s.state === "idle" && s.ended === "failed" ? (
							<g transform={`translate(${p.x} ${p.y - 22})`}>
								<circle r={7} className="fill-destructive" />
								<path d="M-3,-3 L3,3 M3,-3 L-3,3" className="stroke-card" strokeWidth={1.8} />
							</g>
						) : null}
					</g>
				);
			})}
			{more > 0 ? (
				<text x={x + ROOM_W - 10} y={y + ROOM_H - 10} textAnchor="end" className="fill-muted-foreground text-[10px]">
					{`+${more} idle`}
				</text>
			) : null}
			{/* What just happened, popping over whom it happened to. */}
			{flashFor(agent.id).map((p) => {
				const at = popAt(p);
				const t = p.age / POP;
				const rise = t * 14;
				const glyph = p.kind === "done" ? "✓" : p.kind === "failed" ? "✕" : "!";
				const fill = p.kind === "done" ? "fill-primary" : p.kind === "failed" ? "fill-destructive" : "fill-chart-2";
				return (
					<g key={p.id} transform={`translate(${at.x} ${at.y - rise})`} opacity={1 - t}>
						<circle r={8} className={fill} />
						<text y={3.5} textAnchor="middle" className="fill-primary-foreground text-[10px] font-bold">
							{glyph}
						</text>
					</g>
				);
			})}
		</g>
	);
}

/**
 * Direction C, the town: agents in rooms, conversations as visitors, sources as buildings and
 * events as envelopes walking the streets. Drawn as one SVG on the app's tokens, so light is a
 * town by day and dark one by night.
 */
export function Town({ model, hovered, onHover, onPick }: DrawProps) {
	const town = layout(model);
	const now = model.now;
	const agentIndex = new Map(model.agents.map((a, i) => [a.id, i]));
	const hover = (id: string) => ({ onMouseEnter: () => onHover(id), onMouseLeave: () => onHover(undefined), onClick: () => onPick(id), className: "cursor-pointer" });

	// Paths worn by what walked them: a link's footprints darken with the pulses that took it.
	const warmth = (l: Link) => Math.max(0, ...model.pulses.filter((p) => (p.from === l.from && p.to.includes(l.to)) || (p.from === l.to && p.to.includes(l.from))).map((p) => p.opacity));
	const paths = model.links.flatMap((l) => {
		const points = route(model, town, l.from, l.to);
		return points ? [{ link: l, points }] : [];
	});
	const toneOf = (l: Link) => (l.kind === "delegation" ? "stroke-chart-3" : l.kind === "schedule" ? "stroke-muted-foreground" : town.sources.get(l.from)?.node.trust === "owner" ? "stroke-primary" : "stroke-chart-4");

	// Walkers: envelopes from sources and towers, paper planes to sources, agents on their way to delegate.
	const walkers = model.pulses.flatMap((p): Array<{ key: string; p: Pulse; at: Point; kind: "envelope" | "plane" }> => {
		if (p.replayed || p.age > WALK) return [];
		const t = p.age / WALK;
		if (p.kind === "source" || p.kind === "schedule") {
			return p.to.flatMap((to, k) => {
				const points = p.from && route(model, town, p.from, to);
				if (!points) return [];
				const at = pointAlong(points, t);
				return [{ key: `${p.id}-${k}`, p, at, kind: "envelope" as const }];
			});
		}
		if (p.kind === "send" && p.from) {
			const points = route(model, town, p.from, p.to[0]);
			return points ? [{ key: `${p.id}`, p, at: pointAlong(points, t), kind: "plane" as const }] : [];
		}
		return [];
	});
	const delegations = model.links.flatMap((l) => {
		if (l.kind !== "delegation") return [];
		const queued = model.pulses.find((p) => p.kind === "queued" && p.to.includes(l.to) && !p.replayed);
		if (!queued || queued.age > WALK) return [];
		const points = route(model, town, l.from, l.to);
		const from = agentIdOf(model, l.from);
		if (!points || !from) return [];
		return [{ key: l.id, link: l, points, at: pointAlong(points, queued.age / WALK), index: agentIndex.get(from) ?? 0, pulse: queued }];
	});
	// Who is sending somebody to another room right now, and to whom.
	const delegatingOf = new Map<string, string>();
	for (const l of model.links) {
		if (l.kind !== "delegation" || l.opacity < 1) continue;
		const from = agentIdOf(model, l.from);
		const to = agentIdOf(model, l.to);
		if (from && to) delegatingOf.set(from, to);
	}
	const pops = model.pulses.filter((p) => !p.replayed && !p.from && p.age < POP && (p.kind === "done" || p.kind === "failed" || p.kind === "started"));
	const busy = (id: string) => Math.max(0, ...model.pulses.filter((p) => !p.replayed && (p.from === id || p.to.includes(id)) && p.age < WALK).map((p) => 1 - p.age / WALK));

	const lastStreet = town.streets.at(-1) ?? TOP_STREET;
	const trees = [
		{ x: 30, y: 30 },
		{ x: 150, y: 46 },
		{ x: AVENUE_X + 34, y: 40 },
		{ x: town.width - 24, y: 36 },
		{ x: 30, y: town.height - 24 },
		...town.streets.slice(0, -1).map((s) => ({ x: town.width - 18, y: s })),
	];

	return (
		<svg viewBox={`0 0 ${town.width} ${town.height}`} preserveAspectRatio="xMidYMid meet" className="size-full font-sans select-none" role="img" aria-label="Agent town">
			<defs>
				<pattern id="town-grass" width={18} height={18} patternUnits="userSpaceOnUse">
					<circle cx={4} cy={5} r={1} className="fill-primary/25" />
					<circle cx={13} cy={13} r={0.8} className="fill-primary/20" />
				</pattern>
			</defs>
			{/* The ground, the streets and the avenue. */}
			<rect width={town.width} height={town.height} className="fill-primary/5" />
			<rect width={town.width} height={town.height} fill="url(#town-grass)" />
			<g className="fill-muted stroke-border" strokeWidth={1}>
				<rect x={AVENUE_X - ROAD / 2} y={TOP_STREET - ROAD / 2} width={ROAD} height={lastStreet - TOP_STREET + ROAD} />
				<rect x={AVENUE_X - ROAD / 2} y={TOP_STREET - ROAD / 2} width={town.width - AVENUE_X + ROAD / 2} height={ROAD} />
				{town.streets.map((s) => (
					<rect key={s} x={AVENUE_X - ROAD / 2} y={s - ROAD / 2} width={town.width - AVENUE_X + ROAD / 2} height={ROAD} />
				))}
				{[...town.sources.values()].map((s) => (
					<rect key={s.node.id} x={s.x + 46} y={s.y - 9} width={AVENUE_X - s.x - 46} height={18} />
				))}
				{[...town.rooms.values()].map((r) => (
					<rect key={r.agent.id} x={r.door.x - 12} y={r.door.y} width={24} height={r.street - r.door.y - ROAD / 2 + 1} className="stroke-none" />
				))}
				{[...town.towers].map(([id, t]) => (
					<rect key={id} x={t.x - 8} y={t.y + 22} width={16} height={TOP_STREET - t.y - 22 - ROAD / 2 + 1} className="stroke-none" />
				))}
			</g>
			<g className="stroke-background" strokeWidth={1.5} strokeDasharray="8 8" fill="none">
				<path d={`M${AVENUE_X},${TOP_STREET} V${lastStreet}`} />
				{[TOP_STREET, ...town.streets].map((s) => (
					<path key={s} d={`M${AVENUE_X},${s} H${town.width}`} />
				))}
			</g>
			{trees.map((t, k) => (
				<g key={k} transform={`translate(${t.x} ${t.y})`}>
					<circle r={11} className="fill-primary/35" />
					<circle cx={-3} cy={-3} r={6} className="fill-primary/45" />
				</g>
			))}
			{/* Footprints along every lasting way, worn darker by what walked it lately. */}
			{paths.map(({ link, points }) => {
				const id = `link:${link.id}`;
				const d = pathOf(points);
				return (
					<g key={link.id}>
						<path d={d} fill="none" className={toneOf(link)} strokeWidth={hovered === id ? 4 : 2.5} strokeDasharray={link.kind === "delegation" ? "1 6" : "3 7"} strokeLinecap="round" opacity={(0.25 + 0.75 * warmth(link)) * link.opacity} />
						<path d={d} fill="none" stroke="transparent" strokeWidth={14} pointerEvents="stroke" {...hover(id)} />
					</g>
				);
			})}
			{/* The sources on the west edge, the clock towers on the north. */}
			{model.sources.map((s) => {
				const at = town.sources.get(s.id)!;
				return (
					<g key={s.id} {...hover(s.id)}>
						<Building x={at.x - 10} y={at.y} node={s} busy={busy(s.id)} now={now} />
						<text x={at.x - 10} y={at.y + 32} textAnchor="middle" className={cn("text-[11px] font-medium", hovered === s.id ? "fill-primary" : "fill-foreground")}>
							{s.scope === "global" ? s.name : `${s.name}@${s.scope}`}
						</text>
					</g>
				);
			})}
			{model.schedules.map((s) => {
				const at = town.towers.get(s.id)!;
				const ringing = Math.max(0, ...model.pulses.filter((p) => p.from === s.id && !p.replayed && p.age < 1600).map((p) => 1 - p.age / 1600));
				return (
					<g key={s.id} {...hover(s.id)}>
						<Tower x={at.x} y={at.y} when={s.when} ringing={ringing} now={now} />
						<text x={at.x + 22} y={at.y + 4} className={cn("text-[11px] font-medium", hovered === s.id ? "fill-primary" : "fill-foreground")}>
							{s.scope === "global" ? s.name : `${s.name}@${s.scope}`}
						</text>
					</g>
				);
			})}
			{[...town.rooms.values()].map((room) => (
				<RoomView
					key={room.agent.id}
					room={room}
					model={model}
					satellites={model.satellites.filter((s) => s.agent === room.agent.id).sort((a, b) => b.opacity - a.opacity)}
					agentIndex={agentIndex}
					pops={pops}
					delegating={delegatingOf.get(room.agent.id)}
					hovered={hovered}
					onHover={onHover}
					onPick={onPick}
				/>
			))}
			{/* What walks the streets now. */}
			{delegations.map((d) => (
				<g key={d.key} {...hover(`link:${d.link.id}`)}>
					<Person x={d.at.x} y={d.at.y} index={d.index} scale={0.85} facing="down" hands="walking" now={now} />
				</g>
			))}
			{walkers.map((w) => (
				<g key={w.key} {...hover(`pulse:${w.p.id}`)}>
					{w.kind === "envelope" ? <Envelope x={w.at.x} y={w.at.y} outside={w.p.hover?.outside} now={now + w.p.id * 37} /> : <PaperPlane x={w.at.x} y={w.at.y} now={now} />}
				</g>
			))}
		</svg>
	);
}
