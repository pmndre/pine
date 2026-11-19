import { cn } from "cn";
import { ClockIcon, CornerDownRightIcon, GitBranchIcon, HandIcon, MessageSquareIcon, ShieldAlertIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useResizeObserver } from "usehooks-ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentNode, BirdviewModel, Satellite, State } from "../birdview.ts";
import { pathOf, type Point, pointAlong, track, TRAVEL } from "../birdview-layout.ts";
import type { DrawProps } from "../Birdview.tsx";
import { DELEGATION_TONE, lineTone, PULSE_TONE, SCHEDULE_TONE, STATE_TONE, type Tone } from "./birdview-tone.ts";

interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

const RIPPLE = 900;
const FLASH = 1200;
const STATE_WORD: Record<State, string> = { idle: "idle", queued: "queued", working: "working", waiting: "waiting for you" };
const KIND_ICON = { conversation: MessageSquareIcon, subagent: GitBranchIcon, delegate: CornerDownRightIcon };

/** The space between parallel tracks, px. */
const SPACING = 4;

/**
 * The tracks of the switchboard, from the measured boxes: each line leaves its source sideways to
 * the trunk (or downward, when the sources lie above the cards), runs along the lane above the row
 * of the card it goes to, and drops into that card's top, at the chip it is for when there is one.
 * Parallel lines are kept apart, and a lane is filled so that no drop crosses another line's run.
 */
function tracks(model: BirdviewModel, rects: ReadonlyMap<string, Rect>): Map<string, { link: BirdviewModel["links"][number]; points: Point[] }> {
	const agentOf = new Map(model.satellites.map((s) => [s.id, s.agent]));
	const cardOf = (id: string) => (id.startsWith("agent:") ? id : id.startsWith("conv:") ? `agent:${id.slice(5).split("/")[0]}` : agentOf.has(id) ? `agent:${agentOf.get(id)}` : id);
	const cards = model.agents.flatMap((a) => rects.get(`agent:${a.id}`) ?? []);
	if (!cards.length) return new Map();
	const boardLeft = Math.min(...cards.map((c) => c.x));
	// In a narrow window the sources lie above the cards, and no track could reach a card without
	// crossing another: the lines are left out there, and pulses flash at both ends instead.
	const ends = [...model.sources, ...model.schedules].flatMap((n) => rects.get(n.id) ?? []);
	if (ends.some((r) => r.x + r.w > boardLeft)) return new Map();
	const lines = model.links.flatMap((link) => {
		const card = rects.get(cardOf(link.to));
		const from = rects.get(link.from) ?? rects.get(cardOf(link.from));
		if (!card || !from || cardOf(link.from) === cardOf(link.to)) return [];
		const chip = rects.get(link.to);
		const side = !link.from.startsWith("conv:") && !link.from.startsWith("task:");
		// A delegation leaves its card's top, above the chip it starts from.
		const start: Point = side ? { x: from.x + from.w, y: from.y + from.h / 2 } : { x: from.x + from.w / 2, y: (rects.get(cardOf(link.from)) ?? from).y };
		return [{ link, card, start, side, x: chip ? chip.x + chip.w / 2 : Number.NaN }];
	});
	// Lines into the same card without a chip are spread along its top.
	const byCard = new Map<Rect, typeof lines>();
	for (const l of lines) byCard.set(l.card, [...(byCard.get(l.card) ?? []), l]);
	for (const [card, group] of byCard) {
		group.sort((p, q) => p.start.y - q.start.y || p.start.x - q.start.x);
		const free = group.filter((l) => Number.isNaN(l.x));
		free.forEach((l, i) => (l.x = card.x + 24 + ((card.w - 48) * (i + 1)) / (free.length + 1)));
		group.filter((l) => !free.includes(l)).forEach((l, i) => (l.x += i * SPACING));
	}
	const trunkOrder = lines.filter((l) => l.side).sort((p, q) => p.start.y - q.start.y);
	const byRow = new Map<number, typeof lines>();
	for (const l of lines) byRow.set(Math.round(l.card.y), [...(byRow.get(Math.round(l.card.y)) ?? []), l]);
	const out = new Map<string, { link: BirdviewModel["links"][number]; points: Point[] }>();
	for (const [row, group] of byRow) {
		group.sort((p, q) => p.x - q.x);
		group.forEach((l, j) => {
			const lane = row - 12 - j * SPACING;
			const trunk = l.side ? boardLeft - 16 - trunkOrder.indexOf(l) * SPACING : undefined;
			out.set(`${l.link.from}>${l.link.to}`, { link: l.link, points: track(l.start, { x: l.x, y: row }, { trunk, lane }) });
		});
	}
	return out;
}

/**
 * Direction B, the switchboard: sources and schedules in a column, agents as cards with their
 * active conversations as chips, and transit-map lines between them over which events ride as
 * dots. Nodes are the app's own components; one SVG on top draws the lines from their measured
 * boxes. In a narrow window the column becomes rows above the cards and the lines run downward.
 */
export function Switchboard({ model, hovered, onHover, onPick }: DrawProps) {
	const board = useRef<HTMLDivElement>(null);
	const { width = 0, height = 0 } = useResizeObserver({ ref: board as RefObject<HTMLDivElement> });
	const [rects, setRects] = useState<ReadonlyMap<string, Rect>>(new Map());
	// What is drawn decides where things are; a change in it is measured again.
	const drawn = [...model.sources, ...model.schedules, ...model.agents, ...model.satellites].map((n) => n.id).join("|") + model.agents.map((a) => a.idle).join(",");
	useLayoutEffect(() => {
		const el = board.current;
		if (!el) return;
		const origin = el.getBoundingClientRect();
		const next = new Map<string, Rect>();
		for (const node of el.querySelectorAll<HTMLElement>("[data-node]")) {
			const r = node.getBoundingClientRect();
			next.set(node.dataset.node!, { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
		}
		setRects(next);
	}, [drawn, width, height]);

	const agentOf = new Map(model.satellites.map((s) => [s.id, s.agent]));
	const rectOf = (id: string) => {
		const own = rects.get(id);
		if (own) return own;
		if (id.startsWith("conv:")) return rects.get(`agent:${id.slice(5).split("/")[0]}`);
		const agent = agentOf.get(id);
		return agent ? rects.get(`agent:${agent}`) : undefined;
	};
	const types = model.sources.map((s) => s.type);
	const toneOfNode = (id: string): Tone => {
		const source = model.sources.find((s) => s.id === id);
		if (source) return lineTone(types, source.type);
		if (id.startsWith("schedule:")) return SCHEDULE_TONE;
		return DELEGATION_TONE;
	};

	const lines = [...tracks(model, rects)].map(([key, t]) => ({ key, ...t }));
	const routes = new Map(lines.map((l) => [l.key, l.points]));
	const routeOf = (from: string, to: string): Point[] | undefined => routes.get(`${from}>${to}`) ?? routes.get(`${to}>${from}`)?.slice().reverse();

	const live = model.pulses.filter((p) => !p.replayed);
	const warmth = (from: string, to: string) =>
		Math.max(0, ...model.pulses.filter((p) => (p.from === from && p.to.includes(to)) || (p.from === to && p.to.includes(from))).map((p) => p.opacity));
	const nodeHovered = hovered && !hovered.startsWith("link:") && !hovered.startsWith("pulse:") ? hovered : undefined;
	const hoverProps = (id: string) => ({ onMouseEnter: () => onHover(id), onMouseLeave: () => onHover(undefined) });

	const groups = new Map<string, BirdviewModel["sources"]>();
	for (const s of model.sources) groups.set(s.type, [...(groups.get(s.type) ?? []), s]);

	return (
		<div className="@container size-full overflow-auto">
			<div ref={board} className="relative flex min-h-full flex-col gap-8 p-4 @2xl:grid @2xl:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] @2xl:gap-24 @2xl:p-6">
				{model.sources.length || model.schedules.length ? (
					<div className="flex flex-wrap content-start gap-x-6 gap-y-3 @2xl:flex-col @2xl:flex-nowrap @2xl:gap-5">
						{[...groups].map(([type, sources]) => (
							<div key={type} className="flex flex-col gap-1.5">
								<span className="text-xs text-muted-foreground">{type}</span>
								<div className="flex flex-wrap gap-1.5 @2xl:flex-col @2xl:items-start">
									{sources.map((s) => (
										<Button key={s.id} data-node={s.id} variant="outline" size="sm" className={cn(!s.running && "text-muted-foreground")} onClick={() => onPick(s.id)} {...hoverProps(s.id)}>
											<span className={cn("size-2 rounded-full", lineTone(types, s.type).bg)} />
											{s.scope === "global" ? s.name : `${s.name}@${s.scope}`}
										</Button>
									))}
								</div>
							</div>
						))}
						{model.schedules.length ? (
							<div className="flex flex-col gap-1.5">
								<span className="text-xs text-muted-foreground">schedules</span>
								<div className="flex flex-wrap gap-1.5 @2xl:flex-col @2xl:items-start">
									{model.schedules.map((s) => (
										<Button key={s.id} data-node={s.id} variant="outline" size="sm" onClick={() => onPick(s.id)} {...hoverProps(s.id)}>
											<ClockIcon data-icon="inline-start" />
											{s.scope === "global" ? s.name : `${s.name}@${s.scope}`}
										</Button>
									))}
								</div>
							</div>
						) : null}
					</div>
				) : null}
				<div className="grid content-start gap-x-10 gap-y-6 @2xl:gap-y-16 @2xl:pt-12 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
					{model.agents.map((a) => (
						<AgentCard key={a.id} agent={a} satellites={model.satellites.filter((s) => s.agent === a.id)} hoverProps={hoverProps} onPick={onPick} />
					))}
				</div>
				<svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
					{lines.map(({ key, link }) => {
						const tone = link.kind === "subscription" ? toneOfNode(link.from) : link.kind === "schedule" ? SCHEDULE_TONE : DELEGATION_TONE;
						const warm = warmth(link.from, link.to);
						const dim = nodeHovered && link.from !== nodeHovered && link.to !== nodeHovered && rectOf(nodeHovered) !== rectOf(link.to) ? 0.2 : 1;
						const d = pathOf(routes.get(key)!);
						return (
							<g key={key}>
								<path
									d={d}
									fill="none"
									className={cn(tone.stroke, "transition-opacity")}
									strokeWidth={link.kind === "delegation" ? 3 : 2 + warm * 1.5}
									strokeLinejoin="round"
									strokeLinecap="round"
									strokeDasharray={link.kind === "schedule" ? "2 5" : link.kind === "subagent" ? "1 4" : undefined}
									opacity={(0.3 + 0.7 * warm) * link.opacity * dim}
								/>
								<path d={d} fill="none" stroke="transparent" strokeWidth={12} pointerEvents="stroke" {...hoverProps(`link:${link.id}`)} />
							</g>
						);
					})}
					{live.flatMap((p) => {
						if (!p.from) {
							const tone = PULSE_TONE[p.kind];
							const r = rectOf(p.to[0] ?? "");
							if (!tone || !r || p.age > FLASH || p.kind === "tool") return [];
							const grow = 2 + (p.age / FLASH) * 6;
							return [<rect key={`${p.id}`} x={r.x - grow} y={r.y - grow} width={r.w + grow * 2} height={r.h + grow * 2} rx={12} fill="none" strokeWidth={2} className={tone.stroke} opacity={1 - p.age / FLASH} />];
						}
						if (p.age > TRAVEL + RIPPLE) return [];
						const tone = toneOfNode(p.kind === "send" ? p.to[0] : p.from);
						return p.to.flatMap((to) => {
							const route = routeOf(p.from!, to);
							if (!route) {
								// No line to ride: both ends flash.
								if (p.age > FLASH) return [];
								const grow = 2 + (p.age / FLASH) * 6;
								return [p.from!, to].flatMap((end) => {
									const r = rectOf(end);
									return r ? [<rect key={`${p.id}>${to}|${end}`} x={r.x - grow} y={r.y - grow} width={r.w + grow * 2} height={r.h + grow * 2} rx={10} fill="none" strokeWidth={2} className={tone.stroke} opacity={1 - p.age / FLASH} />] : [];
								});
							}
							const id = `pulse:${p.id}`;
							if (p.age < TRAVEL) {
								const at = pointAlong(route, p.age / TRAVEL);
								return [
									<g key={`${p.id}>${to}`} className="cursor-pointer" pointerEvents="all" onClick={() => onPick(id)} {...hoverProps(id)}>
										<circle cx={at.x} cy={at.y} r={10} className={tone.fill} opacity={0.2} />
										<circle cx={at.x} cy={at.y} r={4.5} className={tone.fill} />
									</g>,
								];
							}
							const end = route.at(-1)!;
							const f = (p.age - TRAVEL) / RIPPLE;
							return [<circle key={`${p.id}>${to}`} cx={end.x} cy={end.y} r={4 + f * 14} fill="none" strokeWidth={2} className={tone.stroke} opacity={1 - f} />];
						});
					})}
				</svg>
			</div>
		</div>
	);
}

function AgentCard({ agent: a, satellites, hoverProps, onPick }: { agent: AgentNode; satellites: Satellite[]; hoverProps: (id: string) => object; onPick: (id: string) => void }) {
	const id = `agent:${a.id}`;
	const order = { conversation: 0, subagent: 1, delegate: 2 };
	const sorted = [...satellites].sort((p, q) => order[p.kind] - order[q.kind] || p.id.localeCompare(q.id));
	return (
		<Card
			size="sm"
			data-node={id}
			data-state={a.state}
			role="button"
			tabIndex={0}
			className={cn(
				"cursor-pointer transition-shadow",
				a.state === "working" && "ring-2 ring-primary",
				a.state === "queued" && "ring-2 ring-muted-foreground/40",
				a.state === "waiting" && "bg-chart-4/10 ring-2 ring-chart-4",
			)}
			onClick={() => onPick(id)}
			onKeyDown={(e) => e.key === "Enter" && onPick(id)}
			{...hoverProps(id)}
		>
			<CardHeader>
				<CardTitle className="flex min-w-0 items-center gap-2">
					<span className={cn("size-2.5 shrink-0 rounded-full", STATE_TONE[a.state].bg, a.state === "working" && "animate-pulse")} />
					<span className="truncate">{a.id}</span>
					{a.main ? <Badge variant="secondary">main</Badge> : null}
					{a.outside ? <ShieldAlertIcon aria-label="has read outside content" className="size-4 shrink-0 text-chart-4" /> : null}
				</CardTitle>
				<CardDescription className="flex min-w-0 items-center gap-1.5">
					{a.state === "waiting" ? <HandIcon className="size-3.5 shrink-0 text-chart-4" /> : null}
					<span className="shrink-0">{STATE_WORD[a.state]}</span>
					{a.tool ? <span className="truncate font-mono text-xs text-foreground">{a.tool}</span> : null}
				</CardDescription>
			</CardHeader>
			{sorted.length || a.idle ? (
				<CardContent className="flex flex-wrap gap-1.5">
					{sorted.map((s) => {
						const Icon = KIND_ICON[s.kind];
						return (
							<Badge
								key={s.id}
								data-node={s.id}
								data-state={s.state}
								variant="outline"
								render={<button type="button" />}
								style={{ opacity: s.opacity }}
								className={cn(
									"cursor-pointer transition-opacity",
									s.state === "working" && "border-primary",
									s.state === "waiting" && "border-chart-4 bg-chart-4/15",
									s.state === "queued" && "border-dashed border-muted-foreground",
									s.ended === "failed" && "border-destructive text-destructive",
								)}
								onClick={(e) => {
									e.stopPropagation();
									onPick(s.id);
								}}
								{...hoverProps(s.id)}
							>
								<Icon data-icon="inline-start" />
								{s.session.split("/").at(-1)}
								{s.outside ? <ShieldAlertIcon data-icon="inline-end" aria-label="outside content" className="text-chart-4" /> : null}
							</Badge>
						);
					})}
					{a.idle ? <Badge variant="ghost" className="text-muted-foreground">+{a.idle} idle</Badge> : null}
				</CardContent>
			) : null}
		</Card>
	);
}
