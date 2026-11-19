import { cn } from "cn";
import { ArrowRightIcon, ClockIcon, RadioTowerIcon, SendIcon, ShieldAlertIcon } from "lucide-react";
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Avatar, AvatarBadge, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { AgentNode, BirdviewModel, Pulse, State } from "../birdview.ts";
import type { DrawProps } from "../Birdview.tsx";

/** How long after a source's or a schedule's event the task it caused is taken to be its answer, ms. */
const CAUSE = 2500;
/** How long before a delegated or sub-agent task its parent's `delegate` or `subagent` call is looked for, ms. */
const HANDOFF = 1500;
/** A line this young is new, and lit. */
const FRESH = 1500;

const STATE_WORD: Record<State, string> = { idle: "idle", queued: "queued", working: "working", waiting: "waits for you" };
const PRESENCE: Record<State, string> = { idle: "bg-[color-mix(in_oklab,var(--muted-foreground)_45%,var(--background))]", queued: "bg-muted-foreground", working: "bg-primary", waiting: "bg-chart-4" };

/** A part of a line: pine's own words only. */
type Part = { name: string; agent?: string } | { verb: string } | { tool: string } | { arrow: true } | { session: string };

interface WireLine {
	pulse: Pulse;
	/** Who the line is about: an agent's id, or a source or schedule's name. */
	actor: { agent: string } | { source: string } | { schedule: string } | { pine: true };
	parts: Part[];
	/** Whom it concerns, for the highlight when an agent is pointed at. */
	agents: Set<string>;
}

interface Thread {
	key: string;
	/** The agent the thread is about first, for the colour of its line. */
	agent?: string;
	lines: WireLine[];
	/** A task of it still runs. */
	open: boolean;
}

interface Run {
	thread: Thread;
	closed: boolean;
	started?: number;
}

const agentOfTopic = (topic: string) => /^agent\/([^/]+)\//.exec(topic)?.[1];
const sessionOfConv = (node: string) => node.slice(5).split("/").slice(1).join("/");

function seconds(ms: number): string {
	const s = ms / 1000;
	return s < 10 ? `${s.toFixed(1)}s` : s < 90 ? `${Math.round(s)}s` : `${Math.round(s / 60)}m`;
}

function ago(ms: number): string {
	if (ms < 1500) return "now";
	if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
	return `${Math.floor(ms / 60_000)}m`;
}

/**
 * The wire's threads, from the pulses alone. A thread is what one root task caused: the event that
 * woke it, its tool calls, the approvals it asked for, what it delegated and to whom, what it sent,
 * and how it ended. The model's pulses carry no root, so the threads are found the way a reader of a
 * log would: a task's lines follow its node (a conversation or `task:<id>`) from queued to its end; a
 * delegated task joins its parent's thread through the delegation link, or, once that has faded, the
 * `delegate` call just before it; a source's event joins the task it woke right after it.
 */
export function threads(model: BirdviewModel): Thread[] {
	const pulses = [...model.pulses].sort((a, b) => a.ts - b.ts || a.id - b.id);
	const all: Thread[] = [];
	const runs = new Map<string, Run>();
	/** The newest open top-level run of each agent, for what it sends. */
	const openOf = new Map<string, Run>();
	const handoffs: Array<{ ts: number; node: string; tool: string }> = [];
	const causes: Array<{ line: WireLine; targets: Set<string>; ts: number; taken: boolean }> = [];
	const agentOfTask = new Map(model.satellites.map((s) => [s.id, s.agent]));
	const parentOf = new Map(model.links.filter((l) => l.kind === "delegation" || l.kind === "subagent").map((l) => [l.to, l]));

	const thread = (key: string, agent?: string): Thread => {
		const t: Thread = { key, agent, lines: [], open: false };
		all.push(t);
		return t;
	};
	const agentOfNode = (node: string, p: Pulse) => (node.startsWith("conv:") ? node.slice(5).split("/")[0] : (agentOfTask.get(node) ?? agentOfTopic(p.topic) ?? "?"));

	for (const p of pulses) {
		const node = p.to[0];
		if (p.kind === "source" || p.kind === "schedule") {
			const name = p.from ? (model.sources.find((s) => s.id === p.from)?.name ?? model.schedules.find((s) => s.id === p.from)?.name ?? p.from.split(":")[1]) : p.label;
			const targets = p.to.map((n) => (n.startsWith("agent:") ? n.slice(6) : n.startsWith("conv:") ? n.slice(5).split("/")[0] : n));
			const parts: Part[] = [{ name }, { arrow: true }];
			targets.forEach((a, i) => parts.push({ name: i < targets.length - 1 ? `${a},` : a, agent: a }));
			if (!targets.length) parts.push({ verb: "nobody listens" });
			parts.push({ verb: p.kind === "schedule" ? "it is time" : p.label });
			const line: WireLine = { pulse: p, actor: p.kind === "schedule" ? { schedule: name } : { source: name }, parts, agents: new Set(targets) };
			causes.push({ line, targets: new Set(targets), ts: p.ts, taken: false });
			continue;
		}
		if (p.kind === "send") {
			const agent = p.from?.startsWith("agent:") ? p.from.slice(6) : undefined;
			const to = model.sources.find((s) => s.id === node)?.name ?? node?.split(":")[1] ?? "?";
			const line: WireLine = { pulse: p, actor: agent ? { agent } : { pine: true }, parts: [{ name: agent ?? "pine", agent }, { arrow: true }, { name: to }, { verb: "sent" }], agents: new Set(agent ? [agent] : []) };
			const run = agent ? openOf.get(agent) : undefined;
			(run?.thread ?? thread(`send:${p.id}`, agent)).lines.push(line);
			continue;
		}
		if (p.kind === "event" || !node) {
			thread(`event:${p.id}`).lines.push({ pulse: p, actor: { pine: true }, parts: [{ name: p.label }], agents: new Set() });
			continue;
		}

		const agent = agentOfNode(node, p);
		const child = node.startsWith("task:");
		let run = runs.get(node);
		if (!run || (run.closed && (p.kind === "queued" || p.kind === "started"))) {
			let into: Thread | undefined;
			let from: string | undefined;
			let how: "delegate" | "subagent" | undefined;
			if (child) {
				const link = parentOf.get(node);
				const handoff = handoffs.filter((h) => p.ts - h.ts <= HANDOFF && p.ts >= h.ts).at(-1);
				const parentNode = link?.from ?? handoff?.node;
				how = link ? (link.kind === "delegation" ? "delegate" : "subagent") : handoff?.tool === "subagent" ? "subagent" : "delegate";
				if (parentNode) {
					into = runs.get(parentNode)?.thread;
					from = agentOfNode(parentNode, p);
				}
			} else {
				const cause = causes.find((c) => !c.taken && p.ts >= c.ts && p.ts - c.ts <= CAUSE && c.targets.has(agent));
				if (cause) {
					cause.taken = true;
					into = thread(`run:${node}:${p.id}`, agent);
					into.lines.push(cause.line);
				}
			}
			run = { thread: into ?? thread(`run:${node}:${p.id}`, agent), closed: false };
			runs.set(node, run);
			if (!child) openOf.set(agent, run);
			if (child && p.kind === "queued") {
				const parts: Part[] = how === "subagent" ? [{ name: from ?? agent, agent: from ?? agent }, { arrow: true }, { verb: "a sub-agent" }] : [{ name: from ?? "?", agent: from }, { arrow: true }, { name: agent, agent }, { verb: "delegated" }];
				run.thread.lines.push({ pulse: p, actor: { agent: from ?? agent }, parts, agents: new Set([agent, ...(from ? [from] : [])]) });
				continue;
			}
		}
		const who: Part = { name: agent, agent };
		const where: Part[] = child ? [] : [{ session: sessionOfConv(node) }];
		let parts: Part[];
		if (p.kind === "queued") parts = [who, { verb: "queued" }, ...where];
		else if (p.kind === "started") {
			run.started = p.ts;
			parts = child ? [who, { verb: "took it" }] : [who, { verb: "started" }, ...where];
		} else if (p.kind === "tool") {
			if (p.label === "delegate" || p.label === "subagent") handoffs.push({ ts: p.ts, node, tool: p.label });
			parts = [who, { verb: "is using" }, { tool: p.label }];
		} else if (p.kind === "approval") parts = [who, { verb: "waits for you" }, { tool: p.label }];
		else if (p.kind === "done" || p.kind === "failed") {
			run.closed = true;
			const took = run.started === undefined ? "" : ` ${p.kind === "done" ? "in" : "after"} ${seconds(p.ts - run.started)}`;
			parts = [who, { verb: `${p.kind}${took}` }];
		} else parts = [who, { verb: p.label }];
		run.thread.lines.push({ pulse: p, actor: { agent }, parts, agents: new Set([agent]) });
	}
	for (const c of causes) if (!c.taken) thread(`cause:${c.line.pulse.id}`).lines.push(c.line);
	for (const run of runs.values()) if (!run.closed) run.thread.open = true;
	for (const t of all) t.lines.sort((a, b) => a.pulse.ts - b.pulse.ts || a.pulse.id - b.pulse.id);
	return all.filter((t) => t.lines.length).sort((a, b) => a.lines[0].pulse.ts - b.lines[0].pulse.ts);
}

/** A hue of its own for each agent, from its place in the list, so that a thread's line and its faces match. */
function hueOf(model: BirdviewModel, agent?: string): number | undefined {
	const i = model.agents.findIndex((a) => a.id === agent);
	return i < 0 ? undefined : (155 + i * 67) % 360;
}

const faceStyle = (hue?: number): CSSProperties | undefined =>
	hue === undefined ? undefined : { backgroundColor: `oklch(0.78 0.1 ${hue})`, color: `oklch(0.28 0.06 ${hue})` };

const initials = (name: string) => name.slice(0, 2);

function Face({ model, agent, size = "sm" }: { model: BirdviewModel; agent: string; size?: "sm" | "default" }) {
	return (
		<Avatar size={size} className="ring-2 ring-background">
			<AvatarFallback style={faceStyle(hueOf(model, agent))} className="font-semibold uppercase">
				{initials(agent)}
			</AvatarFallback>
		</Avatar>
	);
}

function Glyph({ children }: { children: ReactNode }) {
	return <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-2 ring-background [&>svg]:size-3.5">{children}</span>;
}

function Text({ parts }: { parts: Part[] }) {
	return (
		<>
			{parts.map((part, i) => {
				if ("arrow" in part) return <ArrowRightIcon key={i} className="size-4 shrink-0 text-muted-foreground" />;
				if ("tool" in part)
					return (
						<code key={i} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]">
							{part.tool}
						</code>
					);
				if ("session" in part)
					return (
						<span key={i} className="truncate font-mono text-[0.85em] text-muted-foreground">
							{part.session}
						</span>
					);
				if ("verb" in part)
					return (
						<span key={i} className="text-muted-foreground">
							{part.verb}
						</span>
					);
				return (
					<span key={i} className="font-semibold">
						{part.name}
					</span>
				);
			})}
		</>
	);
}

function Presence({ model, agent, hovered, onHover, onPick }: { model: BirdviewModel; agent: AgentNode } & Omit<DrawProps, "model">) {
	const id = `agent:${agent.id}`;
	const rank: Record<State, number> = { waiting: 0, working: 1, queued: 2, idle: 3 };
	const active = model.satellites.filter((s) => s.agent === agent.id && s.state !== "idle").sort((a, b) => rank[a.state] - rank[b.state]);
	return (
		<div className={cn("flex w-28 shrink-0 flex-col items-center gap-1.5 text-center transition-opacity", agent.state === "idle" && "opacity-70", hovered === id && "opacity-100")}>
			<button type="button" className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50" onMouseEnter={() => onHover(id)} onMouseLeave={() => onHover(undefined)} onClick={() => onPick(id)}>
				<Avatar className={cn("size-14 transition-shadow", agent.state === "working" && "ring-3 ring-primary/40", agent.state === "waiting" && "ring-3 ring-chart-4/60")}>
					<AvatarFallback style={faceStyle(hueOf(model, agent.id))} className="text-lg font-semibold uppercase">
						{initials(agent.id)}
					</AvatarFallback>
					<AvatarBadge className={cn("size-4! ring-3", PRESENCE[agent.state], agent.state === "working" && "animate-pulse")} />
				</Avatar>
			</button>
			<span className="flex items-center gap-1 text-sm font-semibold">
				{agent.id}
				{agent.outside ? <ShieldAlertIcon aria-label="outside content" className="size-3.5 text-chart-4" /> : null}
			</span>
			<span className="h-5 max-w-full truncate text-xs">
				{agent.state === "working" && agent.tool ? <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{agent.tool}</code> : <span className={cn(agent.state === "waiting" ? "font-medium text-chart-4" : "text-muted-foreground")}>{STATE_WORD[agent.state]}</span>}
			</span>
			<span className="flex h-11 max-w-full flex-col items-center gap-1">
				{active.slice(0, 2).map((s) => (
					<Badge key={s.id} variant="outline" render={<button type="button" onClick={() => onPick(s.id)} onMouseEnter={() => onHover(s.id)} onMouseLeave={() => onHover(undefined)} />} className={cn("max-w-24 font-mono", s.outside && "border-chart-4/60", s.state === "waiting" && "border-chart-4 bg-chart-4/10")}>
						<span className="truncate">{s.kind === "conversation" ? s.session : s.kind === "delegate" ? "delegated" : "sub-agent"}</span>
					</Badge>
				))}
				{active.length > 2 ? <span className="text-xs text-muted-foreground">+{active.length - 2}</span> : null}
			</span>
		</div>
	);
}

/**
 * Direction C, the wire: pine as a group chat, or a sports live-ticker. The agents sit in a row at
 * the top, each a face with a presence dot (working, queued, waiting for you, idle), the tool it
 * calls and its open conversations. Below, everything that happens flows by as one line in pine's
 * own words, newest at the bottom, the lines of one root task strung on a thread of its agent's
 * colour, older lines fading. Content is never written on the wire: pointing at a line shows it in
 * the frame's hover line.
 */
export function Wire({ model, hovered, onHover, onPick }: DrawProps) {
	const feed = useRef<HTMLDivElement>(null);
	const stuck = useRef(true);
	const all = threads(model);
	const lines = all.reduce((n, t) => n + t.lines.length, 0);
	const firstLive = all.findIndex((t) => t.lines.some((l) => !l.pulse.replayed));
	const pointed = hovered?.startsWith("agent:") ? hovered.slice(6) : undefined;
	const talking = model.links.filter((l) => (l.kind === "delegation" || l.kind === "subagent") && l.opacity >= 1);
	const agentName = (node: string) => (node.startsWith("conv:") ? node.slice(5).split("/")[0] : (model.satellites.find((s) => s.id === node)?.agent ?? node));

	// A ticker stays at its newest line unless the reader scrolled up to read.
	useLayoutEffect(() => {
		const el = feed.current;
		if (el && stuck.current) el.scrollTop = el.scrollHeight;
	}, [lines, model.now]);

	return (
		<div data-slot="wire" className="@container flex size-full min-h-0 flex-col">
			<div className="flex items-start gap-6 border-b px-6 pt-5 pb-3">
				<div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
					{model.agents.map((a) => (
						<Presence key={a.id} model={model} agent={a} hovered={hovered} onHover={onHover} onPick={onPick} />
					))}
				</div>
				{talking.length ? (
					<div className="hidden w-48 shrink-0 flex-col gap-1.5 @3xl:flex">
						<span className="text-xs text-muted-foreground">talking now</span>
						{talking.map((l) => (
							<button key={l.id} type="button" className="flex items-center gap-1.5 text-sm" onMouseEnter={() => onHover(`link:${l.id}`)} onMouseLeave={() => onHover(undefined)} onClick={() => onPick(l.to)}>
								<Face model={model} agent={agentName(l.from)} />
								<ArrowRightIcon className="size-4 text-muted-foreground" />
								<Face model={model} agent={agentName(l.to)} />
								<span className="text-muted-foreground">{l.kind === "delegation" ? "delegated" : "sub-agent"}</span>
							</button>
						))}
					</div>
				) : null}
			</div>
			<div
				ref={feed}
				className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
				onScroll={(e) => {
					const el = e.currentTarget;
					stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
				}}
			>
				<div className="mx-auto flex max-w-4xl flex-col gap-3">
					{all.length === 0 ? <p className="py-12 text-center text-muted-foreground">Nothing on the wire in the last fifteen minutes.</p> : null}
					{all.map((t, ti) => {
						const hue = hueOf(model, t.agent);
						const dim = pointed !== undefined && !t.lines.some((l) => l.agents.has(pointed));
						// Outside content is marked once, where it entered the thread, not on every line after.
						const firstOutside = t.lines.findIndex((l) => l.pulse.hover?.outside);
						return (
							<div key={t.key} className="flex flex-col">
								{ti === 0 && t.lines[0].pulse.replayed ? <Divider>earlier, replayed</Divider> : null}
								{ti === firstLive && firstLive > 0 ? <Divider>live</Divider> : null}
								<div className={cn("relative flex flex-col transition-opacity", dim && "opacity-25")}>
									{t.lines.length > 1 ? (
										<span
											aria-hidden
											className={cn("absolute top-3.5 bottom-3.5 left-20 w-0.5 -translate-x-1/2 rounded-full", t.open ? "opacity-100" : "opacity-45")}
											style={{ backgroundColor: hue === undefined ? "var(--border)" : `oklch(0.72 0.11 ${hue})` }}
										/>
									) : null}
									{t.lines.map((l, li) => {
										const id = `pulse:${l.pulse.id}`;
										const fresh = !l.pulse.replayed && l.pulse.age < FRESH;
										const last = t.open && li === t.lines.length - 1;
										return (
											<button
												key={l.pulse.id}
												type="button"
												data-pulse={l.pulse.kind}
												className={cn(
													"relative flex h-8 items-center gap-3 rounded-md pr-2 text-left text-[15px] transition-colors duration-700 hover:bg-muted/60",
													hovered === id && "bg-muted",
													fresh && "bg-primary/[0.07]",
												)}
												style={{ opacity: hovered === id ? 1 : 0.35 + 0.65 * l.pulse.opacity }}
												onMouseEnter={() => onHover(id)}
												onMouseLeave={() => onHover(undefined)}
												onClick={() => onPick(id)}
											>
												<span className="w-14 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">{ago(l.pulse.age)}</span>
												<span className="relative z-10 flex w-6 shrink-0 justify-center">
													{"agent" in l.actor ? (
														<Face model={model} agent={l.actor.agent} />
													) : "source" in l.actor ? (
														<Glyph>
															<RadioTowerIcon />
														</Glyph>
													) : "schedule" in l.actor ? (
														<Glyph>
															<ClockIcon />
														</Glyph>
													) : (
														<Glyph>
															<SendIcon />
														</Glyph>
													)}
												</span>
												<span className={cn("flex min-w-0 flex-1 items-center gap-1.5 truncate", l.pulse.kind === "failed" && "[&>span:last-child]:text-destructive", l.pulse.kind === "approval" && "[&>span]:text-chart-4")}>
													<Text parts={l.parts} />
												</span>
												{li === firstOutside ? (
													<Badge variant="outline" className="border-chart-4/50 text-chart-4">
														outside
													</Badge>
												) : null}
												{last ? <span className={cn("size-2 shrink-0 animate-pulse rounded-full", l.pulse.kind === "approval" ? "bg-chart-4" : "bg-primary")} aria-label="still running" /> : null}
											</button>
										);
									})}
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

function Divider({ children }: { children: ReactNode }) {
	return (
		<div className="my-2 flex items-center gap-3 text-xs text-muted-foreground">
			<span className="h-px flex-1 bg-border" />
			{children}
			<span className="h-px flex-1 bg-border" />
		</div>
	);
}
