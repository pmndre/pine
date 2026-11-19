import { cn } from "cn";
import { ClockIcon, CornerDownRightIcon, GitBranchIcon, MessageSquareIcon } from "lucide-react";
import { useRef, type RefObject } from "react";
import { useResizeObserver } from "usehooks-ts";
import type { AgentNode, BirdviewModel, Pulse, Satellite, State } from "../birdview.ts";
import type { DrawProps } from "../Birdview.tsx";
import { lineTone, type Tone } from "./birdview-tone.ts";

interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** The space between tiles, px. */
const GAP = 8;
/** How long a source tile, a beam or a counter flashes after an event, ms. */
const FLASH = 1400;
/** The sparkline: fifteen minutes in thirty buckets. */
const SPARK_WINDOW = 15 * 60_000;
const SPARK_BUCKETS = 30;
/** Recent activity counts for a tile's size with this half-life, ms. */
const SIZE_DECAY = 5 * 60_000;

const STATE_WORD: Record<State, string> = { idle: "idle", queued: "queued", working: "working", waiting: "waiting for you" };
const KIND_ICON = { conversation: MessageSquareIcon, subagent: GitBranchIcon, delegate: CornerDownRightIcon };

/** The fill, the solid band and the text colour of a tile in each state. Written out whole for Tailwind. */
const STATE_FILL: Record<State, { tile: string; band: string; word: string }> = {
	idle: { tile: "bg-card border-border", band: "bg-muted-foreground/30", word: "text-muted-foreground" },
	queued: { tile: "bg-muted border-dashed border-muted-foreground/60", band: "bg-muted-foreground", word: "text-muted-foreground" },
	working: { tile: "bg-primary/15 border-primary/60", band: "bg-primary", word: "text-primary" },
	waiting: { tile: "bg-chart-4/20 border-chart-4", band: "bg-chart-4", word: "text-chart-4" },
};

/**
 * Tiles for the agents, in the given order, filling the box: the list is cut where the weights on
 * either side are closest to equal, along the box's longer side, and each half is cut again. The
 * order never changes with the weights, so a tile that grows pushes its neighbours instead of
 * jumping across the wall.
 */
export function tiles(items: ReadonlyArray<{ id: string; weight: number }>, box: Rect): Map<string, Rect> {
	const out = new Map<string, Rect>();
	const cut = (list: typeof items, r: Rect) => {
		if (!list.length) return;
		if (list.length === 1) {
			out.set(list[0].id, r);
			return;
		}
		const total = list.reduce((s, i) => s + i.weight, 0);
		let k = 1;
		let acc = list[0].weight;
		let best = Math.abs(total / 2 - acc);
		for (let i = 1; i < list.length - 1; i++) {
			const next = acc + list[i].weight;
			if (Math.abs(total / 2 - next) >= best) break;
			acc = next;
			best = Math.abs(total / 2 - acc);
			k = i + 1;
		}
		const f = acc / total;
		if (r.w >= r.h) {
			cut(list.slice(0, k), { ...r, w: r.w * f });
			cut(list.slice(k), { ...r, x: r.x + r.w * f, w: r.w * (1 - f) });
		} else {
			cut(list.slice(0, k), { ...r, h: r.h * f });
			cut(list.slice(k), { ...r, y: r.y + r.h * f, h: r.h * (1 - f) });
		}
	};
	cut(items, box);
	return out;
}

/**
 * Direction C, the wall: a mission-control wall meant to be read from across the room. Each agent
 * is a large tile, sized by how much it did lately, filled with the colour of its state, with the
 * tool it calls in big type, a fifteen-minute sparkline, its active conversations as chips and a
 * counter of the events it received. Sources and schedules run in a thin strip along the top and
 * flash when they emit; a beam drops from the strip into the tile it wakes. A delegation draws an
 * animated connector between two tiles; an approval makes a tile's border pulse amber; outside
 * content puts a striped corner on it. Every animation runs on the model's clock, so that a frame
 * at a given time is always the same.
 */
export function Wall({ model, hovered, onHover, onPick }: DrawProps) {
	const ref = useRef<HTMLDivElement>(null);
	const { width = 0, height = 0 } = useResizeObserver({ ref: ref as RefObject<HTMLDivElement> });
	const now = model.now;
	const hoverProps = (id: string) => ({ onMouseEnter: () => onHover(id), onMouseLeave: () => onHover(undefined) });

	// Which agent a node belongs to: pulses and links name conversations and tasks.
	const satAgent = new Map(model.satellites.map((s) => [s.id, s.agent]));
	const agentOf = (id: string): string | undefined => {
		if (id.startsWith("agent:")) return id.slice(6);
		if (id.startsWith("conv:")) return id.slice(5).split("/")[0];
		return satAgent.get(id);
	};
	const pulsesOf = new Map<string, Pulse[]>(model.agents.map((a) => [a.id, []]));
	for (const p of model.pulses) {
		const whom = new Set([...p.to, ...(p.kind === "send" && p.from ? [p.from] : [])].flatMap((n) => agentOf(n) ?? []));
		for (const a of whom) pulsesOf.get(a)?.push(p);
	}

	// The strip: sources, then schedules, in equal cells, as many rows as the width needs.
	const ends = [...model.sources.map((s) => ({ id: s.id, kind: "source" as const, name: s.scope === "global" ? s.name : `${s.name}@${s.scope}`, type: s.type, running: s.running })), ...model.schedules.map((s) => ({ id: s.id, kind: "schedule" as const, name: s.scope === "global" ? s.name : `${s.name}@${s.scope}`, type: "schedule", running: true }))];
	const cols = Math.max(1, Math.min(ends.length, Math.floor((width - GAP) / 120)));
	const rows = ends.length ? Math.ceil(ends.length / cols) : 0;
	const CELL = 48;
	const stripH = rows ? rows * CELL + (rows - 1) * GAP + GAP * 2 : 0;
	const cellW = Math.min(220, (width - GAP * (cols + 1)) / cols);
	const endRect = new Map(ends.map((e, i) => [e.id, { x: GAP + (i % cols) * (cellW + GAP), y: GAP + Math.floor(i / cols) * (CELL + GAP), w: cellW, h: CELL }]));

	// The tiles: a base weight, more while working or waiting, and the recent activity, compressed.
	const weightOf = (a: AgentNode) => {
		const recent = (pulsesOf.get(a.id) ?? []).reduce((s, p) => s + 0.5 ** (p.age / SIZE_DECAY), 0);
		return 1 + (a.state === "working" || a.state === "waiting" ? 1.2 : 0) + Math.sqrt(recent) * 0.6;
	};
	const area = { x: GAP / 2, y: stripH + GAP / 2, w: width - GAP, h: height - stripH - GAP };
	const rects = width && height ? tiles(model.agents.map((a) => ({ id: a.id, weight: weightOf(a) })), area) : new Map<string, Rect>();
	const inner = (r: Rect): Rect => ({ x: r.x + GAP / 2, y: r.y + GAP / 2, w: Math.max(0, r.w - GAP), h: Math.max(0, r.h - GAP) });

	const types = model.sources.map((s) => s.type);
	const toneOf = (id: string): Tone | undefined => {
		const s = model.sources.find((x) => x.id === id);
		return s ? lineTone(types, s.type) : undefined;
	};
	const live = model.pulses.filter((p) => !p.replayed && p.age < FLASH);

	return (
		<div ref={ref} className="relative size-full overflow-hidden bg-muted/40">
			{ends.map((e) => {
				const r = endRect.get(e.id)!;
				const emit = live.filter((p) => p.from === e.id).map((p) => 1 - p.age / FLASH);
				const sent = live.filter((p) => p.kind === "send" && p.to.includes(e.id)).map((p) => 1 - p.age / FLASH);
				const flash = Math.max(0, ...emit);
				const back = Math.max(0, ...sent);
				const tone = toneOf(e.id);
				return (
					<button
						key={e.id}
						type="button"
						data-node={e.id}
						className={cn(
							"absolute flex items-center gap-2 overflow-hidden rounded-md border bg-card px-3 text-left transition-colors",
							!e.running && "text-muted-foreground",
							hovered === e.id && "ring-2 ring-foreground",
						)}
						style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
						onClick={() => onPick(e.id)}
						{...hoverProps(e.id)}
					>
						<span aria-hidden className={cn("absolute inset-0", tone?.bg ?? "bg-muted-foreground")} style={{ opacity: flash * 0.85 }} />
						<span aria-hidden className="absolute inset-0 rounded-md border-2 border-primary" style={{ opacity: back }} />
						{e.kind === "schedule" ? (
							<ClockIcon className="relative size-4 shrink-0 text-muted-foreground" />
						) : (
							<span className={cn("relative size-2.5 shrink-0 rounded-full", tone?.bg)} />
						)}
						<span className="relative flex min-w-0 flex-col leading-tight">
							<span className="truncate text-sm font-semibold">{e.name}</span>
							<span className="truncate text-xs text-muted-foreground">{e.type}</span>
						</span>
					</button>
				);
			})}
			{model.agents.map((a) => {
				const r = rects.get(a.id);
				return r ? (
					<AgentTile
						key={a.id}
						agent={a}
						rect={inner(r)}
						now={now}
						pulses={pulsesOf.get(a.id) ?? []}
						satellites={model.satellites.filter((s) => s.agent === a.id)}
						hovered={hovered}
						hoverProps={hoverProps}
						onPick={onPick}
					/>
				) : null;
			})}
			<svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
				{/* Beams: an event drops from its source into the tile it wakes; a send rises back. */}
				{live.flatMap((p) => {
					const pairs: Array<{ end: string; agent: string; up: boolean }> = [];
					if ((p.kind === "source" || p.kind === "schedule") && p.from) for (const t of p.to) pairs.push({ end: p.from, agent: agentOf(t) ?? "", up: false });
					if (p.kind === "send" && p.from) for (const t of p.to) pairs.push({ end: t, agent: agentOf(p.from) ?? "", up: true });
					return pairs.flatMap(({ end, agent, up }, i) => {
						const s = endRect.get(end);
						const t = rects.get(agent);
						if (!s || !t) return [];
						const a = { x: s.x + s.w / 2, y: s.y + s.h };
						const b = { x: t.x + t.w / 2, y: t.y + GAP };
						const f = p.age / FLASH;
						const head = up ? 1 - Math.min(1, f * 1.6) : Math.min(1, f * 1.6);
						const at = { x: a.x + (b.x - a.x) * head, y: a.y + (b.y - a.y) * head };
						const tone = p.kind === "schedule" ? "stroke-muted-foreground" : up ? "stroke-primary" : (toneOf(end)?.stroke ?? "stroke-primary");
						const fill = p.kind === "schedule" ? "fill-muted-foreground" : up ? "fill-primary" : (toneOf(end)?.fill ?? "fill-primary");
						return [
							<g key={`${p.id}-${i}`} opacity={1 - f}>
								<line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={tone} strokeWidth={3} strokeDasharray="2 6" strokeLinecap="round" />
								<circle cx={at.x} cy={at.y} r={7} className={fill} />
							</g>,
						];
					});
				})}
				{/* Delegations: a connector from the tile that delegates to the tile that works on it. */}
				{model.links
					.filter((l) => l.kind === "delegation")
					.flatMap((l) => {
						const from = rects.get(agentOf(l.from) ?? "");
						const to = rects.get(agentOf(l.to) ?? "");
						if (!from || !to || from === to) return [];
						// From edge to edge, low in the tiles, so that the big type stays readable.
						const a = edgeToward(from, to);
						const b = edgeToward(to, from);
						const dx = b.x - a.x;
						const dy = b.y - a.y;
						const len = Math.hypot(dx, dy) || 1;
						const bend = Math.min(120, len * 0.25);
						const c = { x: (a.x + b.x) / 2 - (dy / len) * bend, y: (a.y + b.y) / 2 + (dx / len) * bend };
						const along = (t: number) => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t ** 2 * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t ** 2 * b.y });
						const d = `M${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`;
						const mid = along(0.5);
						const id = `link:${l.id}`;
						return [
							<g key={l.id} opacity={l.opacity}>
								<path d={d} fill="none" className="stroke-background" strokeWidth={14} strokeLinecap="round" />
								<path d={d} fill="none" className="stroke-chart-3" strokeWidth={6} strokeLinecap="round" strokeDasharray="14 10" strokeDashoffset={-((now / 20) % 24)} />
								{[0, 1, 2].map((n) => {
									const p = along(((now / 1400 + n / 3) % 1 + 1) % 1);
									return <circle key={n} cx={p.x} cy={p.y} r={8} className="fill-chart-3 stroke-background" strokeWidth={3} />;
								})}
								<circle cx={a.x} cy={a.y} r={10} className="fill-chart-3" />
								<circle cx={b.x} cy={b.y} r={14} fill="none" className="stroke-chart-3" strokeWidth={4} />
								<g className="pointer-events-auto cursor-pointer" {...hoverProps(id)} onClick={() => onPick(l.to)}>
									<rect x={mid.x - 48} y={mid.y - 15} width={96} height={30} rx={15} className="fill-chart-3" />
									<text x={mid.x} y={mid.y + 5} textAnchor="middle" className="fill-background text-sm font-semibold">
										delegate
									</text>
								</g>
							</g>,
						];
					})}
			</svg>
		</div>
	);
}

/** Where the line from one tile to another starts in the first: toward a point low in the second, halfway to its border. */
function edgeToward(r: Rect, other: Rect): { x: number; y: number } {
	const a = { x: r.x + r.w / 2, y: r.y + r.h * 0.74 };
	const b = { x: other.x + other.w / 2, y: other.y + other.h * 0.74 };
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const tx = dx ? (dx > 0 ? r.x + r.w - a.x : r.x - a.x) / dx : Number.POSITIVE_INFINITY;
	const ty = dy ? (dy > 0 ? r.y + r.h - a.y : r.y - a.y) / dy : Number.POSITIVE_INFINITY;
	// Halfway to the border, so that the line spans both tiles even when they touch.
	const t = Math.min(tx, ty, 1) * 0.5;
	return { x: a.x + dx * t, y: a.y + dy * t };
}

function AgentTile({
	agent: a,
	rect: r,
	now,
	pulses,
	satellites,
	hovered,
	hoverProps,
	onPick,
}: {
	agent: AgentNode;
	rect: Rect;
	now: number;
	pulses: Pulse[];
	satellites: Satellite[];
	hovered?: string;
	hoverProps: (id: string) => object;
	onPick: (id: string) => void;
}) {
	const id = `agent:${a.id}`;
	const fill = STATE_FILL[a.state];
	const small = r.w < 240 || r.h < 170;
	const tiny = r.w < 150 || r.h < 110;
	const big = Math.max(18, Math.min(r.w / 7, r.h / 3.6, 112));
	const failed = satellites.some((s) => s.ended === "failed");

	// The sparkline: every pulse that touched the agent, by half-minute.
	const counts = Array.from({ length: SPARK_BUCKETS }, () => 0);
	for (const p of pulses) {
		const b = SPARK_BUCKETS - 1 - Math.floor(p.age / (SPARK_WINDOW / SPARK_BUCKETS));
		if (b >= 0) counts[b]++;
	}
	const peak = Math.max(1, ...counts);
	const line = counts.map((c, i) => `${(i / (SPARK_BUCKETS - 1)) * 100},${30 - (c / peak) * 28}`).join(" ");

	// Events received over the window, and a flash when one has just come in.
	const received = pulses.filter((p) => p.kind === "source" || p.kind === "schedule");
	const fresh = Math.max(0, ...received.filter((p) => !p.replayed && p.age < FLASH).map((p) => 1 - p.age / FLASH));
	const beat = 0.55 + 0.45 * Math.sin(now / 180);
	// While it waits, the tool it asked for is what the wall shows.
	const asked = a.state === "waiting" ? pulses.filter((p) => p.kind === "approval").at(-1)?.label : undefined;
	const shown = asked ?? a.tool;
	// The last tools it called, newest first, while they are recent: pine's names only.
	const recent = pulses.filter((p) => p.kind === "tool" && !p.replayed && p.age < 30_000 && p.label !== shown).slice(-3).reverse();

	const order = { conversation: 0, subagent: 1, delegate: 2 };
	const chips = [...satellites].sort((p, q) => order[p.kind] - order[q.kind] || p.id.localeCompare(q.id));

	return (
		<div
			data-node={id}
			data-state={a.state}
			role="button"
			tabIndex={0}
			className={cn(
				"absolute flex cursor-pointer flex-col overflow-hidden rounded-xl border-2 transition-[left,top,width,height,background-color] duration-700 ease-out",
				fill.tile,
				failed && a.state === "idle" && "bg-destructive/10 border-destructive/60",
				hovered === id && "ring-4 ring-foreground/70",
			)}
			style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
			onClick={() => onPick(id)}
			onKeyDown={(e) => e.key === "Enter" && onPick(id)}
			{...hoverProps(id)}
		>
			<span aria-hidden className={cn("h-2 w-full shrink-0", fill.band)} />
			{a.state === "waiting" ? <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[10px] border-[6px] border-chart-4" style={{ opacity: beat }} /> : null}
			{fresh ? <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[10px] border-4 border-chart-2" style={{ opacity: fresh }} /> : null}
			{a.outside ? (
				<span
					aria-label="has read outside content"
					className="pointer-events-none absolute top-0 right-0"
					style={{
						width: small ? 36 : 64,
						height: small ? 36 : 64,
						clipPath: "polygon(0 0, 100% 0, 100% 100%)",
						background: "repeating-linear-gradient(-45deg, var(--color-chart-4) 0 7px, transparent 7px 14px)",
					}}
				/>
			) : null}

			<div className="flex min-w-0 items-start gap-3 px-4 pt-3 pr-10">
				<div className="flex min-w-0 flex-1 flex-col">
					<span className={cn("truncate font-semibold tracking-tight", small ? "text-xl" : "text-3xl")}>{a.id}</span>
					<span className={cn("truncate text-xs font-semibold tracking-widest uppercase", fill.word)}>
						{a.main ? "main · " : ""}
						{STATE_WORD[a.state]}
					</span>
				</div>
				{tiny ? null : (
					<div className="flex shrink-0 flex-col items-end leading-none">
						<span className={cn("font-mono font-semibold tabular-nums", small ? "text-2xl" : "text-4xl", fresh ? "text-chart-2" : "text-foreground")}>{received.length}</span>
						<span className="text-[0.65rem] tracking-widest text-muted-foreground uppercase">events</span>
					</div>
				)}
			</div>

			<div className="flex min-h-0 flex-1 flex-col justify-center px-4">
				{a.state === "waiting" ? <span className="mb-1 text-xs font-semibold tracking-widest text-chart-4 uppercase">approval</span> : null}
				{shown ? (
					<span className={cn("truncate font-mono leading-none font-bold tracking-tight", a.state === "waiting" ? "text-chart-4" : "text-foreground")} style={{ fontSize: big }}>
						{shown}
					</span>
				) : (
					<span className="truncate font-mono leading-none font-bold tracking-tight text-muted-foreground/40" style={{ fontSize: big * 0.7 }}>
						{a.state === "working" ? "…" : a.state === "queued" ? "queued" : a.state === "waiting" ? "waiting" : "idle"}
					</span>
				)}
				{!small && recent.length ? (
					<span className="mt-2 flex min-w-0 gap-3 font-mono text-sm text-muted-foreground">
						{recent.map((p, i) => (
							<span key={p.id} className="truncate" style={{ opacity: 1 - i * 0.3 }}>
								{p.label}
							</span>
						))}
					</span>
				) : null}
			</div>

			{tiny ? null : (
				<div className="flex min-w-0 flex-col gap-2 px-4 pb-3">
					{chips.length || a.idle ? (
						<div className="flex min-w-0 flex-wrap gap-1.5 overflow-hidden" style={{ maxHeight: small ? 26 : 56 }}>
							{chips.map((s) => {
								const Icon = KIND_ICON[s.kind];
								return (
									<button
										key={s.id}
										type="button"
										data-node={s.id}
										data-state={s.state}
										style={{ opacity: Math.max(0.25, s.opacity) }}
										className={cn(
											"flex h-6 items-center gap-1 rounded-full border bg-background/70 px-2 text-xs font-medium",
											s.state === "working" && "border-primary text-primary",
											s.state === "waiting" && "border-chart-4 bg-chart-4/20 text-foreground",
											s.state === "queued" && "border-dashed border-muted-foreground",
											s.ended === "failed" && "border-destructive text-destructive",
											(s.outside || s.untrusted) && "border-chart-4",
											hovered === s.id && "ring-2 ring-foreground",
										)}
										onClick={(e) => {
											e.stopPropagation();
											onPick(s.id);
										}}
										{...hoverProps(s.id)}
									>
										<Icon className="size-3" />
										{s.session.split("/").at(-1)}
									</button>
								);
							})}
							{a.idle ? <span className="flex h-6 items-center px-1 text-xs text-muted-foreground">+{a.idle} idle</span> : null}
						</div>
					) : null}
					<div className="flex items-end gap-2">
						<svg viewBox="0 0 100 30" preserveAspectRatio="none" className={cn("w-full", small ? "h-6" : "h-10")}>
							<polygon points={`0,30 ${line} 100,30`} className={cn(a.state === "waiting" ? "fill-chart-4/25" : "fill-primary/20")} />
							<polyline points={line} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={2} strokeLinejoin="round" className={a.state === "waiting" ? "stroke-chart-4" : "stroke-primary"} />
						</svg>
						<span className="shrink-0 text-[0.65rem] tracking-widest text-muted-foreground uppercase">15 min</span>
					</div>
				</div>
			)}
		</div>
	);
}
