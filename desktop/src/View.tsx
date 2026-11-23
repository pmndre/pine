// The view: a panel at the right of the window that draws all of pine at a glance, beside the side
// panel and the browser. What it draws is the owner's choice: a view, a script in <home>/views
// (src/views.ts, docs/references/views.md), named by `ui.view`. The panel runs it in a sandboxed frame
// (view.html, view-frame.ts) and tells it the shape of pine and nothing of its content (view-state.ts);
// the view tells the panel what to show or open. Around it the panel keeps what is the owner's to see
// in full: what asks them, on top, and below the view what happened and what is chosen, in words.
// Without a view (none in the folder, or `ui.view` "off") the app shows no button for the panel.
import { CircleCheckIcon, CircleXIcon, ClipboardListIcon, ClockIcon, CopyIcon, ExternalLinkIcon, HourglassIcon, PenLineIcon, RadarIcon, RadioIcon, ShieldIcon, ShieldOffIcon, SparklesIcon, TriangleAlertIcon, UserIcon, WebhookIcon, WrenchIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useMediaQuery } from "usehooks-ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AgentAvatar } from "@/components/agent-avatar";
import { HoverTooltip } from "@/components/hover-tooltip";
import { Pulse } from "@/components/pulse";
import { SideSheet } from "@/components/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ViewHappening, ViewTarget } from "../../src/view-kit.ts";
import { api } from "./api.ts";
import { boardLabel, taskLine } from "./Board.tsx";
import { useLoad } from "./use-load.ts";
import { ROOM, store, useModel } from "./model.ts";
import { AGENT_COLORS } from "./theme.ts";
import { type Holdings, happeningsOf, knownTarget, talkHappenings, viewStateOf } from "./view-state.ts";
import { colorFor, ENDED, type From, fromText, type Job, World } from "./view-world.ts";

export const VIEW_KEY = "pine.view.width";

const NARROW_TO_WIDE = ["manual", "plan", "safe", "auto", "bypass"];
/** Whether mode `a` is stricter than `b`. */
const stricter = (a: string, b: string) => NARROW_TO_WIDE.indexOf(a) >= 0 && NARROW_TO_WIDE.indexOf(a) < NARROW_TO_WIDE.indexOf(b);

/** What is chosen: an agent, or a piece of work. */
type Sel = { k: "agent"; id: string } | { k: "job"; id: number } | { k: "board"; id: number; task?: number } | undefined;

// ---- the world, fed from the start --------------------------------------------------------------------------------

/** The one world of this window. It takes every batch of events, also while the view is closed, so that it opens on the recent past. */
export const world = new World();
/** What an agent has, by name only: fetched with the agents (`holdings`), for the view. */
export const holdings = new Map<string, Holdings>();
/** Who hears what just happened: the frame of the view, while it is open. */
const happenings = new Set<(h: ViewHappening) => void>();
const announce = (list: ViewHappening[]) => {
	for (const h of list) for (const fn of happenings) fn(h);
};
/** What the events do not say and the view shows: asked again when an event says it may have changed. */
const stale = { conversations: true, schedules: true, boards: true };
store.taps.add((batch) => {
	world.take(batch);
	for (const e of batch) {
		// A conversation was made, removed, branched or given a worktree; work began or ended in one (a branch is new with its first work).
		if (e.topic === "pine/conversation" || /^agent\/[^/]+\/(started|done|failed)$/.test(e.topic)) stale.conversations = true;
		if (e.topic === "pine/board") stale.boards = true;
		if (e.source === "timer" || e.topic === "pine/settings" || /^agent\/[^/]+\/tool$/.test(e.topic)) stale.schedules ||= e.source === "timer" || e.topic === "pine/settings" || /schedule/.test(String((e.payload as { tool?: unknown })?.tool ?? ""));
	}
	if (!happenings.size) return;
	announce(happeningsOf(batch, world, holdings));
});

const PALETTE = AGENT_COLORS.map((c) => c.hex);
const colorOf = (agent: string) => colorFor(world.places.get(agent), PALETTE);

/**
 * The world, drawn again as it changes, but four times a second at most: while agents write, the daemon
 * sends many events a second, and the panel's words need not follow each one.
 */
let seen = 0;
let at = 0;
let later: number | undefined;
const calm = new Set<() => void>();
world.subscribe(() => {
	if (later !== undefined) return;
	later = window.setTimeout(() => {
		later = undefined;
		at = Date.now();
		seen = world.v;
		for (const fn of calm) fn();
	}, Math.max(0, 250 - (Date.now() - at)));
});
const subscribeCalm = (fn: () => void) => (calm.add(fn), () => void calm.delete(fn));

function useWorld(): World {
	useSyncExternalStore(subscribeCalm, () => seen);
	return world;
}

/** Draws again every `ms` while mounted: for times that count up. */
function useNow(ms: number): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), ms);
		return () => window.clearInterval(id);
	}, [ms]);
	return now;
}

let seededFor: string | undefined;
/** The pine whose recent past the world holds: until it is `seededFor`, the feed is loading, not empty. */
let seededDone: string | undefined;
/** Whether the world has been seeded for the pine it shows. */
export const isSeeded = () => seededDone !== undefined && seededDone === seededFor;

/** Fetches what the events do not repeat: recent tasks, open conversations, sources, open questions. The rooms again every few seconds. */
function useSeed(): void {
	const s = useModel(store);
	useEffect(() => {
		world.setPlaces(s.agents.map((a) => ({ id: a.id, main: a.main, color: a.color, mode: a.mode, description: a.description })));
		// What each agent has, by name: its MCP servers, skills, sources and schedules.
		let gone = false;
		void Promise.all(
			s.agents.map(async (a) => {
				const d = await api.agentDetail(a.id).catch(() => undefined);
				const h = d?.holdings;
				if (!gone && h) holdings.set(a.id, { servers: [...h.servers], skills: [...h.skills], sources: [...h.sources], schedules: [...h.schedules] });
			}),
		).then(() => !gone && world.touch());
		return () => void (gone = true);
	}, [s.agents]);
	useEffect(() => {
		let gone = false;
		// Another pine (Settings > Environments): what the world knew was about the one before.
		const which = `${s.remote ?? ""}|${s.home}`;
		if (seededFor !== undefined && seededFor !== which) world.reset();
		seededFor = which;
		void (async () => {
			const [tasks, sources, asks] = await Promise.all([api.tasks(undefined, 300).catch(() => []), api.sources().catch(() => []), api.approvals().catch(() => [])]);
			if (gone) return;
			world.seed(tasks as any);
			world.setSources(sources);
			world.setAsks(asks);
			seededDone = which;
			world.touch();
		})();
		// The mode each conversation works in and whether it read outside content come from the daemon's status, which
		// no event repeats: asked as soon as new work starts, often while work runs, now and then while all is quiet.
		let asked = 0;
		let known = "";
		const rooms = async () => {
			const at = (asked = Date.now());
			const st = await api.status().catch(() => undefined);
			if (gone || !st) return;
			const read = world.setRooms(st.sessions.map((r) => ({ agent: r.agent, session: r.session, busy: r.busy, outside: r.tainted, mode: r.mode, trust: r.trust })));
			// Work whose end went unheard (the daemon was restarted, the stream was down for a moment) is not at work for
			// ever: what the daemon no longer runs is ended here as its record of it says.
			for (const id of world.unheard(st.running.map((r) => r.task), at))
				void api.taskRecord(id).then(
					(t) => !gone && world.settle(id, t),
					() => !gone && world.settle(id),
				);
			announce(read.map((r) => ({ k: "outside" as const, agent: r.agent, ...(world.talks.has(`${r.agent}:${r.session}`) ? { conversation: world.talkId(r.agent, r.session) } : {}) })));
		};
		void rooms();
		// Each agent's conversations (which is a branch of which, which works in a worktree) and the schedules with
		// their next time: asked when an event says they may have changed, and now and then.
		let talked = 0;
		let timed = 0;
		let boarded = 0;
		// The boards (how many tasks stand how, and which work has one): asked when pine says one changed, and now and then.
		const boards = async () => {
			boarded = Date.now();
			stale.boards = false;
			const list = await api.allBoards().catch(() => undefined);
			if (!gone && list) world.setBoards(list);
		};
		const conversations = async () => {
			talked = Date.now();
			stale.conversations = false;
			await Promise.all(
				[...world.places.keys()].map(async (agent) => {
					const list = await api.sessions(agent).catch(() => undefined);
					if (!gone && list && world.places.has(agent)) announce(talkHappenings(world.setConversations(agent, list)));
				}),
			);
		};
		const schedules = async () => {
			timed = Date.now();
			stale.schedules = false;
			const list = await api.schedules().catch(() => undefined);
			if (!gone && list) world.setSchedules(list);
		};
		const id = window.setInterval(() => {
			const working = world.working();
			const now = working.map((j) => j.id).join(",");
			const fresh = now !== known;
			known = now;
			if (fresh || (working.length && Date.now() - asked > 1500) || Date.now() - asked > 8000) void rooms();
			const t = Date.now();
			if (world.places.size && ((stale.conversations && t - talked > 700) || t - talked > 20_000)) void conversations();
			// A schedule whose time has passed is asked about again: its next time is another.
			const due = world.schedules.some((s) => s.next !== undefined && s.next - world.skew < t - 1500);
			if ((stale.schedules && t - timed > 700) || (due && t - timed > 3000) || t - timed > 30_000) void schedules();
			if ((stale.boards && t - boarded > 500) || t - boarded > 30_000) void boards();
		}, 300);
		return () => ((gone = true), window.clearInterval(id));
	}, [s.home, s.remote]);
}

// ---- small parts all lenses use --------------------------------------------------------------------------------------

const ago = (ms: number) => (ms < 1000 ? "now" : ms < 60_000 ? `${Math.floor(ms / 1000)}s` : ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m` : `${Math.floor(ms / 3_600_000)}h`);

function FromIcon({ from, className }: { from: From; className?: string }) {
	const c = cn("size-3.5 flex-none text-muted-foreground", className);
	switch (from.k) {
		case "you":
			return <UserIcon className={c} />;
		case "clock":
			return <ClockIcon className={c} />;
		case "source":
			return <RadioIcon className={c} />;
		case "outside":
			return <WebhookIcon className={c} />;
		case "agent":
			return <span aria-hidden className={cn("inline-block size-2.5 flex-none rounded-full", className)} style={{ background: colorOf(from.id) }} />;
		case "copy":
			return <CopyIcon className={c} />;
		case "pine":
			return <SparklesIcon className={c} />;
	}
}

/** What a piece of work is doing, in a few words. */
function doingText(j: Job, w: World): string {
	switch (j.doing) {
		case "thinking":
			return "thinking";
		case "writing":
			return "writing";
		case "tool":
			return j.tool ? j.tool.replace(/^mcp__/, "").replace(/__/g, " ") : "a tool";
		case "waiting": {
			const on = j.waitingOn.map((c) => w.jobs.get(c)).filter((c): c is Job => Boolean(c && !ENDED.includes(c.doing)));
			const names = [...new Set(on.map((c) => (c.kind === "subagent" ? "copies" : c.agent)))];
			return names.length ? `waits for ${names.join(", ")}` : "waits";
		}
		case "asking":
			return "asks you";
		case "done":
			return "done";
		case "failed":
			return "failed";
		case "cancelled":
			return "stopped";
	}
}

function DoingIcon({ j }: { j: Job }) {
	const c = "size-3 flex-none";
	if (j.doing === "asking") return <span aria-hidden className="size-1.5 flex-none animate-pulse rounded-full bg-warn [animation-timing-function:steps(4,jump-none)]" />;
	if (j.doing === "tool") return <WrenchIcon className={c} />;
	if (j.doing === "writing") return <PenLineIcon className={c} />;
	if (j.doing === "waiting") return <HourglassIcon className={c} />;
	if (j.doing === "done") return <CircleCheckIcon className={c} />;
	if (j.doing === "failed") return <CircleXIcon className={cn(c, "text-destructive")} />;
	return <Pulse label={doingText(j, world)} className="size-1.5" />;
}

/** The marks that say how safe a piece of work is: read outside content, held to a stricter mode. */
function Marks({ j }: { j: Job }) {
	const outside = world.outside(j);
	const mode = world.modeOf(j);
	const own = world.places.get(j.agent)?.mode;
	const held = mode && own && mode !== own && stricter(mode, own);
	return (
		<>
			{held ? (
				<HoverTooltip>
					<TooltipTrigger render={<span className="flex-none text-warn" />}>
						<ShieldIcon className="size-3" aria-label={`held to ${mode} mode`} />
					</TooltipTrigger>
					<TooltipContent>Held to {mode} mode: it was handed on from work in that mode, and {j.agent} works in {own} by itself</TooltipContent>
				</HoverTooltip>
			) : null}
			{outside ? (
				<HoverTooltip>
					<TooltipTrigger render={<span className="flex-none text-warn" />}>
						<TriangleAlertIcon className="size-3" aria-label="read outside content" />
					</TooltipTrigger>
					<TooltipContent>The conversation read outside content ({outside}): sending something out asks you</TooltipContent>
				</HoverTooltip>
			) : null}
		</>
	);
}

function ModeBadge({ mode }: { mode: string }) {
	const open = mode === "auto" || mode === "bypass";
	return (
		<HoverTooltip>
			<TooltipTrigger render={<Badge variant="outline" className={cn("h-4.5 px-1.5", mode === "bypass" && "text-destructive")} />}>
				{open ? <ShieldOffIcon data-icon="inline-start" /> : <ShieldIcon data-icon="inline-start" />}
				{mode}
			</TooltipTrigger>
			<TooltipContent>{open ? "Works with your account, without a sandbox" : mode === "plan" ? "Plans: looks and changes nothing" : "Works in a sandbox"}{mode === "bypass" ? ", and asks nothing" : mode === "manual" ? ", and asks before each action" : ""}</TooltipContent>
		</HoverTooltip>
	);
}

/** Opens a piece of work where it can be read: its conversation, or the task by itself. */
function openJob(j: Job): void {
	if (j.depth === 0 && !j.session.startsWith("_t") && !j.session.endsWith("~u")) void store.openTab(j.agent, j.session);
	else void store.openTask(j.id);
}

// ---- the panel ---------------------------------------------------------------------------------------------------------

export function ViewAside() {
	const s = useModel(store);
	const sheet = !useMediaQuery(ROOM);
	const id = s.view ?? "";
	return (
		<SideSheet
			id="view-panel"
			slot="view-aside"
			title="View"
			sheet={sheet}
			widthKey={VIEW_KEY}
			defaultWidth={560}
			barClassName="pl-3 text-sm font-medium"
			onClose={() => void store.command("view")}
			bar={
				<>
					<RadarIcon className="size-3.5 text-muted-foreground" />
					<ViewSelect id={id} />
					<span className="min-w-0 flex-1" />
					<HoverTooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={() => void store.command("view")} aria-label="Close the view"><XIcon /></Button>} /><TooltipContent>Close the view<Kbd>⇧⌘O</Kbd></TooltipContent></HoverTooltip>
				</>
			}
		>
			<ViewPanel id={id} />
		</SideSheet>
	);
}

/**
 * Which view the panel shows, picked where its name stands: the views in the views folder of pine's home,
 * read again each time the list opens, so that a file just put there is offered. A file pine cannot
 * hand on is listed, greyed, with what is wrong with it. The choice is pine's setting `ui.view`.
 * There is no "off" here: with no view the panel and its button are gone, and with them this list.
 */
function ViewSelect({ id }: { id: string }) {
	const s = useModel(store);
	const items = s.views.map((v) => ({ value: v.id, label: v.id }));
	return (
		<Select items={items} value={id} onValueChange={(v) => v && v !== id && void s.setView(String(v))} onOpenChange={(open) => open && void s.refreshViews()}>
			<SelectTrigger size="sm" aria-label="Which view" data-slot="view-select" className="h-7 min-w-0 border-transparent bg-transparent px-1.5 font-medium shadow-none hover:bg-accent dark:bg-transparent">
				<SelectValue />
			</SelectTrigger>
			<SelectContent alignItemWithTrigger={false} align="start" className="min-w-56">
				{s.views.map((v) => (
					<SelectItem key={v.id} value={v.id} disabled={Boolean(v.problem)} title={v.problem}>
						<span className="truncate">{v.id}</span>
						{v.problem ? <span className="truncate text-xs text-muted-foreground">{v.problem}</span> : null}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export function ViewPanel({ id }: { id: string }) {
	useSeed();
	const w = useWorld();
	const [sel, setSel] = useState<Sel>();
	// What was chosen and is gone (an agent removed, work forgotten) is no longer chosen.
	const gone = sel && (sel.k === "agent" ? !w.places.has(sel.id) : sel.k === "job" ? !w.jobs.has(sel.id) : !w.boards.some((b) => b.id === sel.id));
	const chosen = gone ? undefined : sel;
	const pick = (next: Sel) => setSel((was) => (was && next && was.k === next.k && was.id === next.id && (was.k !== "board" || next.k !== "board" || was.task === next.task) ? undefined : next));
	return (
		<div data-slot="view" data-view={id} className="flex min-h-0 flex-1 flex-col">
			<NeedsYou pick={pick} />
			<div className="relative min-h-0 flex-1">
				<ViewFrame key={id} id={id} sel={chosen} pick={(t) => setSel(t)} />
			</div>
			<Separator />
			<Inspector sel={chosen} pick={pick} />
		</div>
	);
}

/**
 * The frame the view runs in. It is sandboxed with scripts and nothing else: an origin of its own, no
 * bridge, no storage of the page's, and a policy of its own that lets it reach no address (view.html).
 * It is handed the view's code once and pine's state as it changes, and asks the panel to show or
 * open something, which the panel checks against what it knows.
 */
function ViewFrame({ id, sel, pick }: { id: string; sel: Sel; pick: (s: Sel) => void }) {
	const frame = useRef<HTMLIFrameElement>(null);
	const [code, setCode] = useState<{ code: string } | { problem: string }>();
	const [error, setError] = useState<string>();
	const [ready, setReady] = useState(false);
	const live = useRef({ sel, pick });
	live.current = { sel, pick };

	useEffect(() => {
		let gone = false;
		setCode(undefined);
		setError(undefined);
		setReady(false);
		api.viewCode(id).then(
			(r) => !gone && setCode("code" in r ? { code: r.code } : { problem: r.problem }),
			(e) => !gone && setCode({ problem: e instanceof Error ? e.message : String(e) }),
		);
		return () => void (gone = true);
	}, [id]);

	useEffect(() => {
		const f = frame.current;
		if (!f || !code || !("code" in code)) return;
		const target = (): ViewTarget | undefined => {
			const s = live.current.sel;
			return s?.k === "agent" ? { agent: s.id } : s?.k === "job" ? { work: s.id } : s?.k === "board" ? { board: s.id, ...(s.task !== undefined ? { task: s.task } : {}) } : undefined;
		};
		const stateNow = () => viewStateOf(world, { colorOf, holdings, selected: target(), dark: document.documentElement.classList.contains("dark"), focused: store.focused });
		const post = (m: unknown) => f.contentWindow?.postMessage(m, "*");
		let loaded = false;
		let sent = 0;
		let pending: number | undefined;
		// The state as it changes, five times a second at most, and nothing while nothing changes: a view
		// counts time from the clock itself.
		const send = () => {
			if (!loaded) return;
			const wait = 200 - (Date.now() - sent);
			if (wait > 0) return void (pending ??= window.setTimeout(() => ((pending = undefined), send()), wait));
			sent = Date.now();
			post({ type: "state", state: stateNow() });
		};
		const unsubscribe = world.subscribe(send);
		const hear = (h: ViewHappening) => loaded && post({ type: "happening", happening: h });
		happenings.add(hear);
		const onMessage = (e: MessageEvent) => {
			// Only the frame this panel made speaks to it; what it says is checked, never taken at its word.
			if (e.source !== f.contentWindow) return;
			const m = e.data as { type?: unknown; target?: unknown; message?: unknown };
			if (m?.type === "booted" && !loaded) {
				loaded = true;
				post({ type: "load", code: code.code, state: stateNow() });
			} else if (m?.type === "ready") setReady(true);
			else if (m?.type === "error") setError(String(m.message ?? "").slice(0, 400));
			else if (m?.type === "select") {
				const t = knownTarget(world, m.target);
				live.current.pick(t && ("agent" in t ? { k: "agent", id: t.agent } : "work" in t ? { k: "job", id: t.work } : { k: "board", id: t.board, task: t.task }));
			} else if (m?.type === "open") {
				const t = knownTarget(world, m.target);
				if (t && "agent" in t) void store.openTab(t.agent, "main");
				else if (t && "work" in t) {
					const j = world.jobs.get(t.work);
					if (j) openJob(j);
				}
			}
		};
		window.addEventListener("message", onMessage);
		return () => {
			unsubscribe();
			if (pending) window.clearTimeout(pending);
			happenings.delete(hear);
			window.removeEventListener("message", onMessage);
		};
	}, [code]);

	// What is chosen in the panel goes to the view at once, and so does the window coming to the front or going behind.
	const focused = useModel(store).focused;
	useEffect(() => world.touch(), [sel, focused]);

	if (code && "problem" in code)
		return (
			<Empty data-slot="view-problem" className="absolute inset-0">
				<EmptyHeader>
					<EmptyMedia variant="icon"><TriangleAlertIcon /></EmptyMedia>
					<EmptyTitle>The view {id} cannot be shown</EmptyTitle>
					<EmptyDescription>{code.problem}</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	return (
		<>
			{code ? <iframe ref={frame} src="view.html" sandbox="allow-scripts" title={`The view ${id}`} data-slot="view-frame" data-ready={ready || undefined} className="absolute inset-0 size-full border-0" /> : null}
			{ready || error ? null : <ViewFrameSkeleton className="absolute inset-0" />}
			{error ? (
				<div data-slot="view-error" className="absolute inset-x-2 bottom-2 rounded-md border border-destructive/40 bg-background/95 px-2 py-1.5 text-xs text-destructive">
					The view {id} stopped: {error}
				</div>
			) : null}
		</>
	);
}

/** A view while its code loads and until it says it is ready: a few blocks, from stock Skeleton. */
export function ViewFrameSkeleton({ className }: { className?: string }) {
	return (
		<div data-slot="view-frame-skeleton" className={cn("grid grid-cols-3 content-start gap-3 bg-background p-4", className)}>
			<Skeleton className="col-span-3 h-6 w-1/3" />
			<Skeleton className="h-24" />
			<Skeleton className="h-24" />
			<Skeleton className="h-24" />
			<Skeleton className="col-span-2 h-16" />
			<Skeleton className="h-16" />
		</div>
	);
}

/** What waits for the owner, on top whatever the lens: each with the way to answer it. */
function NeedsYou({ pick }: { pick: (s: Sel) => void }) {
	const w = useWorld();
	const asks = w.asks();
	if (!asks.length) return null;
	return (
		<div data-slot="needs-you" className="flex flex-none flex-col gap-1 border-b border-line-soft bg-warn-soft px-2 py-1.5">
			{asks.slice(0, 3).map((j) => (
				<Item key={j.id} size="xs" className="py-1">
					<ItemContent className="min-w-0">
						<ItemTitle className="w-full min-w-0">
							<AgentAvatar agent={{ id: j.agent, color: colorOf(j.agent), main: store.agent(j.agent)?.main }} size="sm" className="size-4" />
							<button type="button" className="truncate text-start" onClick={() => pick({ k: "job", id: j.id })}>
								<b>{j.agent}</b> asks you: {j.ask!.summary}
							</button>
						</ItemTitle>
					</ItemContent>
					<ItemActions>
						<Button size="xs" onClick={() => store.ask(j.ask!.id)}>Answer</Button>
					</ItemActions>
				</Item>
			))}
			{asks.length > 3 ? <span className="px-3 text-xs text-muted-foreground">and {asks.length - 3} more</span> : null}
		</div>
	);
}

// ---- the inspector: what is chosen, or what happened ----------------------------------------------------------------------

function Inspector({ sel, pick }: { sel: Sel; pick: (s: Sel) => void }) {
	const w = useWorld();
	const now = useNow(1000);
	return (
		<ScrollArea data-slot="view-inspector" className="h-44 flex-none sm:h-52">
			<div className="flex flex-col gap-1.5 p-3 text-xs">
				{sel?.k === "board" ? <BoardDetail key={`${sel.id}:${sel.task ?? ""}`} id={sel.id} task={sel.task} pick={pick} /> : sel?.k === "job" && w.jobs.get(sel.id) ? <JobDetail j={w.jobs.get(sel.id)!} now={now} pick={pick} /> : sel?.k === "agent" && w.places.get(sel.id) ? (isSeeded() ? <AgentDetail id={sel.id} now={now} pick={pick} /> : <AgentDetail skeleton />) : <Feed now={now} pick={pick} />}
			</div>
		</ScrollArea>
	);
}

function Feed({ now, pick }: { now: number; pick: (s: Sel) => void }) {
	const w = useWorld();
	const lines = w.lines.slice(-30).reverse();
	return (
		<>
			<div className="flex items-baseline gap-2">
				<span className="font-medium text-muted-foreground">What happened</span>
				<span className="min-w-0 flex-1 truncate text-end text-faint">click anything to look closer · double-click to open it</span>
			</div>
			{!lines.length && !isSeeded() ? (
				[0, 1, 2].map((i) => <JobLine key={i} skeleton />)
			) : lines.length ? (
				lines.map((l, i) => (
					<button key={`${l.at}:${i}`} type="button" disabled={l.job === undefined || !w.jobs.has(l.job)} onClick={() => l.job !== undefined && pick({ k: "job", id: l.job })} className="flex items-baseline gap-2 rounded-sm text-start hover:enabled:bg-accent">
						<span className="w-8 flex-none text-end text-faint tabular-nums">{ago(now + w.skew - l.at)}</span>
						<span className={cn("min-w-0 flex-1 truncate", l.tone === "ask" && "text-warn", l.tone === "bad" && "text-destructive")}>{l.text}</span>
					</button>
				))
			) : (
				<span className="text-faint">Nothing yet. Ask an agent something, and watch it here. Click an agent or a piece of work to see more of it.</span>
			)}
		</>
	);
}

/** What an agent has and does; with `skeleton`, its shape while the world is seeded. */
export function AgentDetail(props: { id: string; now: number; pick: (s: Sel) => void; skeleton?: false } | { id?: undefined; now?: undefined; pick?: undefined; skeleton: true }) {
	if (props.skeleton) return <AgentDetailSkeleton />;
	return <AgentDetailLive {...props} />;
}

function AgentDetailSkeleton() {
	return (
		<div data-slot="agent-detail-skeleton" className="flex flex-col gap-1.5">
			<div className="flex items-center gap-2">
				<AgentAvatar skeleton size="sm" />
				<Skeleton className="h-4 w-24" />
			</div>
			<Skeleton className="h-3.5 w-2/3" />
			<Skeleton className="mt-1 h-3.5 w-16" />
			<JobLine skeleton />
			<JobLine skeleton />
		</div>
	);
}

function AgentDetailLive({ id, now, pick }: { id: string; now: number; pick: (s: Sel) => void }) {
	const w = useWorld();
	const a = w.places.get(id)!;
	const working = w.working(id);
	const rooms = [...w.rooms.values()].filter((r) => r.agent === id && !r.session.startsWith("_t"));
	const ended = [...w.jobs.values()].filter((j) => j.agent === id && j.finished !== undefined).sort((x, y) => y.finished! - x.finished!).slice(0, 4);
	return (
		<>
			<div className="flex items-center gap-2">
				<AgentAvatar agent={{ id, color: colorOf(id), main: store.agent(id)?.main }} size="sm" />
				<span className="truncate text-sm font-medium">{id}</span>
				{a.main ? <Badge variant="secondary" className="h-4.5">main</Badge> : null}
				<ModeBadge mode={a.mode} />
				<span className="min-w-0 flex-1" />
				<Button variant="outline" size="xs" onClick={() => void store.openTab(id, "main")}><ExternalLinkIcon data-icon="inline-start" />Open</Button>
				<Button variant="ghost" size="icon-xs" aria-label="Back to what happened" onClick={() => pick(undefined)}><XIcon /></Button>
			</div>
			{a.description ? <p className="text-muted-foreground">{a.description}</p> : null}
			<span className="mt-1 font-medium text-muted-foreground">{working.length ? `At work: ${working.length}` : "Idle"}</span>
			{working.map((j) => <JobLine key={j.id} j={j} now={now} pick={pick} />)}
			{rooms.length ? <span className="mt-1 font-medium text-muted-foreground">Conversations pine has open</span> : null}
			{rooms.map((r) => (
				<button key={r.session} type="button" className="flex items-center gap-2 rounded-sm text-start hover:bg-accent" onClick={() => !r.session.endsWith("~u") && void store.openTab(id, r.session)}>
					{r.busy ? <Pulse className="size-1.5" /> : <span className="size-1.5 flex-none" />}
					<span className="min-w-0 flex-1 truncate">{r.session.endsWith("~u") ? `${r.session.slice(0, -2)} (started from outside)` : r.session}</span>
					{r.outside ? <TriangleAlertIcon className="size-3 text-warn" aria-label="read outside content" /> : null}
					<span className="text-faint">{r.mode}</span>
				</button>
			))}
			{ended.length ? <span className="mt-1 font-medium text-muted-foreground">Lately</span> : null}
			{ended.map((j) => <JobLine key={j.id} j={j} now={now} pick={pick} />)}
		</>
	);
}

/** One piece of work on a line; with `skeleton`, a line's shape while the world is seeded. */
export function JobLine(props: { j: Job; now: number; pick: (s: Sel) => void; skeleton?: false } | { j?: undefined; now?: undefined; pick?: undefined; skeleton: true }) {
	if (props.skeleton)
		return (
			<div data-slot="job-line-skeleton" className="flex items-center gap-1.5 py-0.5">
				<Skeleton className="size-3.5 flex-none rounded-sm" />
				<Skeleton className="h-3.5 flex-1" />
				<Skeleton className="h-3.5 w-12 flex-none" />
			</div>
		);
	return <JobLineLive {...props} />;
}

function JobLineLive({ j, now, pick }: { j: Job; now: number; pick: (s: Sel) => void }) {
	const w = useWorld();
	const end = j.finished ?? now + w.skew;
	return (
		<button type="button" onClick={() => pick({ k: "job", id: j.id })} onDoubleClick={() => openJob(j)} className={cn("flex items-center gap-1.5 rounded-sm text-start hover:bg-accent", ENDED.includes(j.doing) && "text-muted-foreground")}>
			<FromIcon from={j.from} />
			<span className="min-w-0 flex-1 truncate">{j.label || "(no text)"}</span>
			<Marks j={j} />
			<span className={cn("flex flex-none items-center gap-1", j.doing === "asking" && "text-warn")}><DoingIcon j={j} />{doingText(j, w)}</span>
			<span className="w-7 flex-none text-end text-faint tabular-nums">{ago(end - j.started)}</span>
		</button>
	);
}

/**
 * A board, or one of its tasks, in the words that stand on it. The view that asked for it knows none of them: it named
 * a board and a task by their numbers, and the panel reads the rest from pine itself. Text of an agent's, drawn as text.
 */
function BoardDetail({ id, task, pick }: { id: number; task?: number; pick: (s: Sel) => void }) {
	const w = useWorld();
	const row = w.boards.find((b) => b.id === id);
	// Read again whenever the board changes: the counts the world keeps of it say when.
	const stamp = row ? JSON.stringify([row.counts, row.tasks.map((t) => t.state)]) : "";
	const view = useLoad(() => api.board(id), [id, stamp]);
	const v = view.data;
	const t = v && task !== undefined ? v.tasks.find((x) => x.id === task) : undefined;
	const notes = v ? v.notes.filter((n) => (t ? n.about === t.id : n.about === undefined)) : [];
	const head = (
		<div className="flex items-center gap-2">
			<ClipboardListIcon className="size-4 flex-none text-muted-foreground" />
			<span className="min-w-0 flex-1 truncate text-sm font-medium">{v ? boardLabel(v.board) : "Board"}{t ? ` · task #${t.id}` : ""}</span>
			{t ? <Button variant="outline" size="xs" onClick={() => pick({ k: "board", id })}>The whole board</Button> : null}
			<Button variant="ghost" size="icon-xs" aria-label="Back to what happened" onClick={() => pick(undefined)}><XIcon /></Button>
		</div>
	);
	if (!v) return <>{head}<span className="text-muted-foreground">{view.error ?? "Loading"}</span></>;
	if (t)
		return (
			<>
				{head}
				<p data-slot="view-task-text" className="whitespace-pre-wrap break-words">{t.text}</p>
				<dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1">
					<dt className="text-muted-foreground">Now</dt>
					<dd className={cn(t.state === "blocked" && "text-warn", t.state === "failed" && "text-destructive")}>{taskLine(t)}</dd>
					<dt className="text-muted-foreground">Posted by</dt>
					<dd>{t.by === "owner" ? "you" : t.by}{t.outside ? " · after reading outside content" : ""}</dd>
					{t.after.length ? <><dt className="text-muted-foreground">Comes after</dt><dd>{t.after.map((a) => <button key={a} type="button" className="mr-1.5 hover:underline" onClick={() => pick({ k: "board", id, task: a })}>#{a}</button>)}</dd></> : null}
					{t.result ? <><dt className="text-muted-foreground">{t.state === "blocked" ? "It asks" : t.state === "failed" ? "Why" : "Result"}</dt><dd className="whitespace-pre-wrap break-words">{t.result}</dd></> : null}
				</dl>
				{notes.length ? <span className="mt-1 font-medium text-muted-foreground">Notes about it</span> : null}
				{notes.map((n) => <p key={n.id} className="whitespace-pre-wrap break-words"><span className="text-muted-foreground">{n.by === "owner" ? "you" : n.by}: </span>{n.text}</p>)}
			</>
		);
	return (
		<>
			{head}
			<span className="text-muted-foreground">{v.tasks.length ? `${v.tasks.filter((x) => x.state === "done").length} of ${v.tasks.length} tasks done` : "No tasks yet"}</span>
			{v.tasks.map((x) => (
				<button key={x.id} type="button" className="flex items-baseline gap-2 text-left hover:underline" onClick={() => pick({ k: "board", id, task: x.id })}>
					<span className="w-8 flex-none tabular-nums text-muted-foreground">#{x.id}</span>
					<span className="min-w-0 flex-1 truncate">{x.text}</span>
					<span className={cn("flex-none text-muted-foreground", x.state === "blocked" && "text-warn", x.state === "failed" && "text-destructive")}>{taskLine(x)}</span>
				</button>
			))}
			{notes.length ? <span className="mt-1 font-medium text-muted-foreground">Notes for everyone</span> : null}
			{notes.map((n) => <p key={n.id} className="whitespace-pre-wrap break-words"><span className="text-muted-foreground">{n.by === "owner" ? "you" : n.by}: </span>{n.text}</p>)}
		</>
	);
}

function JobDetail({ j, now, pick }: { j: Job; now: number; pick: (s: Sel) => void }) {
	const w = useWorld();
	const parent = j.parent !== undefined ? w.jobs.get(j.parent) : undefined;
	const children = [...w.jobs.values()].filter((c) => c.parent === j.id);
	const mode = w.modeOf(j);
	const own = w.places.get(j.agent)?.mode;
	const outside = w.outside(j);
	const end = j.finished ?? now + w.skew;
	return (
		<>
			<div className="flex items-center gap-2">
				<AgentAvatar agent={{ id: j.agent, color: colorOf(j.agent), main: store.agent(j.agent)?.main }} size="sm" />
				<span className="min-w-0 flex-1 truncate text-sm font-medium">{j.label || "(no text)"}</span>
				<Button variant="outline" size="xs" onClick={() => openJob(j)}><ExternalLinkIcon data-icon="inline-start" />Open</Button>
				<Button variant="ghost" size="icon-xs" aria-label="Back to what happened" onClick={() => pick(undefined)}><XIcon /></Button>
			</div>
			<dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1">
				<dt className="text-muted-foreground">Agent</dt>
				<dd><button type="button" className="hover:underline" onClick={() => pick({ k: "agent", id: j.agent })}>{j.agent}</button>{j.kind === "subagent" ? ", a copy (sub-agent)" : ""}</dd>
				<dt className="text-muted-foreground">Came from</dt>
				<dd className="flex items-center gap-1.5"><FromIcon from={j.from} />{fromText(j.from)}{parent ? <> · <button type="button" className="hover:underline" onClick={() => pick({ k: "job", id: parent.id })}>{parent.agent}'s work</button></> : null}</dd>
				<dt className="text-muted-foreground">Now</dt>
				<dd className={cn("flex items-center gap-1.5", j.doing === "asking" && "text-warn")}><DoingIcon j={j} />{doingText(j, w)}{j.subject ? <span className="truncate text-muted-foreground">{j.subject}</span> : null}</dd>
				{j.ask ? <><dt className="text-muted-foreground">Asks you</dt><dd className="flex items-center gap-2"><span className="truncate">{j.ask.summary}</span><Button size="xs" onClick={() => store.ask(j.ask!.id)}>Answer</Button></dd></> : null}
				<dt className="text-muted-foreground">Mode</dt>
				<dd>{mode ?? own ?? "?"}{mode && own && mode !== own && stricter(mode, own) ? ` (held to it: ${j.agent} works in ${own} by itself)` : ""}</dd>
				{outside ? <><dt className="text-muted-foreground">Outside content</dt><dd className="text-warn">{outside}: sending something out asks you</dd></> : null}
				<dt className="text-muted-foreground">Time</dt>
				<dd className="tabular-nums">{ago(end - j.started)}{j.tools ? ` · ${j.tools} tool call${j.tools === 1 ? "" : "s"}` : ""}</dd>
				{j.error ? <><dt className="text-muted-foreground">Error</dt><dd className="text-destructive">{j.error}</dd></> : null}
			</dl>
			{children.length ? <span className="mt-1 font-medium text-muted-foreground">It handed on</span> : null}
			{children.map((c) => <JobLine key={c.id} j={c} now={now} pick={pick} />)}
		</>
	);
}

