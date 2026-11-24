// The window: the list of agents and conversations at the side, the tabs along the top, one
// conversation in the middle with its panel, and whatever lies over them for a moment (a list
// to pick from, a question, the palette).
import { ArrowUpIcon, AudioLinesIcon, DownloadIcon, HourglassIcon, RotateCwIcon, CheckIcon, RadarIcon, ChevronDownIcon, ChevronRightIcon, ChevronsUpDownIcon, LaptopIcon, ServerIcon, ExternalLinkIcon, FolderClosedIcon, FolderIcon, FolderOpenIcon, GitBranchIcon, GlobeIcon, ListIcon, MessageSquareIcon, PanelRightIcon, PlusIcon, SearchIcon, SettingsIcon, StarIcon, Trash2Icon, TriangleAlertIcon, UnplugIcon, XIcon } from "lucide-react";
import { useMediaQuery } from "usehooks-ts";
import { Toggle } from "@/components/ui/toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { type Layout, usePanelRef } from "react-resizable-panels";
import { Field } from "@/components/ui/field";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { type AgentInfo, api, type Conversation as Conv } from "./api.ts";
import { bridge } from "./bridge.ts";
import { CODE_KEY, CodePanel } from "./CodePanel.tsx";
import { COMMANDS } from "./commands.ts";
import { TabMenu, type TabMenuAction } from "@/components/tab-menu";
import { Conversation } from "./Conversation.tsx";
import { Events } from "./Events.tsx";
import { type Beside, ROOM, store, type Tab, type UpdatePhase, useModel, useSignal } from "./model.ts";
import { ASIDE_KEY, BrowserAside } from "./Browser.tsx";
import { VIEW_KEY, ViewAside } from "./View.tsx";
import { Breakable, MachineList, NewAgent, Settings } from "./Settings.tsx";
import { computerWord, firstScreen, isPaired, noMachineSaid } from "./machines.ts";
import { ApprovalDialog } from "./ApprovalDialog.tsx";
import { Palette } from "./Palette.tsx";
import { PairConfirm } from "./Pairing.tsx";
import { PickDialog } from "./PickDialog.tsx";
import { PublishDialog } from "./PublishDialog.tsx";
import { QuestionDialog } from "./QuestionDialog.tsx";
import { ago, newApp, shortcut, until } from "./text.ts";
import { Listbox, ListboxItem } from "@ui-sdk/react/listbox";
import { LISTBOX, onPick } from "./lists.tsx";
import { Logo } from "@/components/logo";
import { HoverTooltip } from "@/components/hover-tooltip";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AgentAvatar } from "@/components/agent-avatar";
import { AgentColorPicker, AgentNameInput } from "@/components/agent-identity";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Sidebar as SidebarRoot, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuAction, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { Pulse } from "@/components/pulse";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Printed } from "@/components/printed";

/**
 * How long a line that slides to show its end takes (`animate-slide-end`): long enough to read at the pace one
 * reads, about ten characters a second, and never less than the five seconds a short line takes.
 */
const slideFor = (text: string) => `${Math.max(5, Math.round(text.length / 10))}s`;

// Pieces of the frame drawn the same in several places.
const DOT = "size-2 flex-none rounded-full";

// ---- before pine answers -----------------------------------------------------------------------------

export function Gate() {
	const s = useModel(store);
	const state = s.service;
	const init = async () => {
		s.initRunning = true;
		s.initLines = [];
		s.touch();
		const code = await bridge.init().catch(() => 1);
		s.initRunning = false;
		s.touch();
		if (code === 0) await bridge.retry();
		else s.flash("pine init did not finish. What it said is shown above.", "bad");
	};
	const host = state.host;
	const key = s.keyToTrust;
	// With no local machine the machines are the only way to a pine: added, chosen or forgotten here,
	// also while one is being reached (that can take a minute), to switch to another.
	const machines = s.local ? null : (
		<div className="flex w-full flex-col gap-4 text-start" data-slot="gate-machines">
			<MachineList />
		</div>
	);
	type Screen = [React.ReactNode, React.ReactNode, React.ReactNode];
	// A machine by the name the owner sees: a paired computer by its name, never its id; user@host as written, in mono.
	const paired = host ? isPaired(host) : false;
	// The button back to this computer's pine, in the desktop app: "Use this Mac" on macOS.
	const useHere = `Use this ${computerWord(s.platform)}`;
	const named = host ? paired || s.prefs.names?.[host] ? <span>{s.nameOf(host)}</span> : <span className="font-mono"><Breakable host={host} /></span> : null;
	// Reaching another machine's pine and loading its agents are one wait: one screen, only what it says changes.
	const connecting = (about: string): Screen => [
		<>Connecting to {named}</>,
		about,
		<div key="s" className="flex w-full flex-col items-center gap-4">
			<div className="flex items-center gap-2"><Pulse label="Loading" />{s.local ? <Button variant="outline" onClick={() => void s.useMachine()}>{useHere}</Button> : null}</div>
			{machines}
		</div>,
	];
	// A pairing link being paired with (the web client's): the four digits the computer shows too, once it showed them.
	const pairing = firstScreen(state, s.device);
	// The sentence under the title follows the view shown, never the emptiness of the list (machines.ts).
	const said = state.status === "error" ? noMachineSaid(state, s.machinesShown.view, s.pairFailed) : undefined;
	const pairFirst = state.status === "error" && said === undefined && !s.prefs.hosts.length;
	const [title, about, actions]: Screen = pairing
		? [
				pairing.title,
				pairing.about,
				<div key="p" className="flex w-full flex-col items-center gap-4">
					{pairing.code ? <span className="font-mono text-4xl font-semibold tracking-widest select-text" data-slot="pairing-code">{pairing.code}</span> : null}
					<Pulse label="Loading" />
					{/* A pairing started from the owner's hand can be ended from here; the web client's has no way to. */}
					{s.canCancelPair ? <Button variant="outline" data-slot="cancel-pairing" onClick={() => void s.cancelPair()}>Cancel</Button> : null}
				</div>,
			]
		: state.status === "starting"
			? host
				? connecting(paired ? `Reaching ${s.nameOf(host)}, then the pine there…` : "Reaching pine on that machine over SSH, or starting it there…")
				: ["Starting pine", "Looking for a running pine, or starting one…", <Pulse label="Loading" key="s" />]
			: state.status === "error" && state.kind === "no-home"
				? [
						"Welcome to pine",
						`pine keeps your agents, their workspaces and pine's settings in a home folder (${s.prefs.home ?? s.home ?? "~/.pine"}). There is none yet. Setting it up copies the example home and fetches the browser that the web tools use (about 600 MB, once).`,
						<>
							{s.initLines.length ? <Printed sm className="w-full text-start" text={s.initLines.slice(-40).join("\n")} /> : null}
							<div className="flex items-center gap-2">
								{s.local ? <Button disabled={s.initRunning} onClick={() => void init()}>{s.initRunning ? <><Pulse label="Loading" data-icon="inline-start" />Setting up…</> : "Set up pine"}</Button> : null}
								<Button variant="outline" disabled={s.initRunning} onClick={() => void bridge.retry()}>Try again</Button>
							</div>
						</>,
					]
				: state.status === "error"
					? [
							state.kind === "no-node" ? "pine needs Node" : state.kind === "no-pine" ? "pine is not installed" : state.kind === "ssh" ? (host ? paired ? <>{named} is not reached</> : <>{named} is not reached over SSH</> : s.pairFailed ? "The pairing did not go through" : pairFirst ? `Pair this ${s.device} with your computer` : "Choose a machine") : host ? <>pine on {named} did not start</> : "pine did not start",
							// No machine in use in the pairing view: the list's three lines say how, once.
							said ?? "",
							<div key="b" className="flex w-full flex-col items-center gap-4">
								{/* A host key met for the first time: its fingerprint, and the owner's yes to exactly that one. */}
								{key ? <span className="font-mono text-xs break-all select-text" data-slot="host-key-fingerprint">{key.fingerprint}</span> : null}
								<div className="flex items-center gap-2">
									{key ? <Button data-slot="trust-host-key" onClick={() => void s.trustHostKey(key)}>Trust this key</Button> : null}
									{host || s.local ? <Button variant={key ? "outline" : "default"} onClick={() => void bridge.retry()}>Try again</Button> : null}
									{state.kind === "no-node" ? <Button variant="outline" onClick={() => void bridge.open("https://nodejs.org")}>nodejs.org</Button> : null}
									{host && s.local ? <Button variant="outline" onClick={() => void s.useMachine()}>{useHere}</Button> : null}
								</div>
								{machines}
							</div>,
						]
					: s.loadError
						? // The pine answered and its agents could not be loaded: said, with a way to ask again, never a wait that does not end.
							[
								host ? <>Could not load the agents of {named}</> : "Could not load your agents",
								s.loadError,
								<div key="l" className="flex w-full flex-col items-center gap-4">
									<div className="flex items-center gap-2">
										<Button data-slot="gate-reload" onClick={() => void s.reload()}>Try again</Button>
										{host && s.local ? <Button variant="outline" onClick={() => void s.useMachine()}>{useHere}</Button> : null}
									</div>
									{machines}
								</div>,
							]
						: host
							? // Another machine's pine answered and its agents are being asked for over SSH.
								connecting("Loading the agents…")
							: ["Loading your agents…", "", <Pulse label="Loading" key="s" />];
	// Before pine answers there is nothing to show yet: stock Empty, in a frame that moves the window.
	return (
		<div className="m-1.5 flex flex-1 overflow-y-auto rounded-xl border bg-background app-drag">
			<Empty className="app-no-drag">
				<EmptyHeader>
					<EmptyMedia>
						<Logo className="size-9" />
					</EmptyMedia>
					{/* A long host (a Tailscale Funnel name and its port) wraps instead of spilling past the card. */}
					<EmptyTitle className="max-w-full wrap-anywhere">{title}</EmptyTitle>
					{/* A host key's fingerprint is one long word: it breaks anywhere, or it overflows its centered line on a phone. */}
					{about ? <EmptyDescription className="wrap-anywhere select-text">{about}</EmptyDescription> : null}
				</EmptyHeader>
				<EmptyContent>{actions}</EmptyContent>
			</Empty>
		</div>
	);
}

// ---- the side ----------------------------------------------------------------------------------------
// The side bar is the agents. One with a single conversation is one line that opens it. One with
// more is a group of its own: who it is, how many conversations it has, whether it is at work, and
// under it its conversations. What starts something new stands on the agent's own line, so it
// is never a question whom a new conversation or a folder is for.

/** How far a conversation's row stands in: a branch under the one it was made from, four steps at most. */
// A conversation's icon lies in a slot as wide as the agent's avatar, where the avatar lies (the button's padding, the chevron, the gap):
// the icons are on one line with the avatars, and the titles begin where the agents' names do. A branch or a group goes one step further in.
const INDENT = ["pl-8", "pl-12", "pl-16", "pl-20", "pl-24"];

/** The conversation being dragged in the side bar. One window, one drag: nothing of it rides on the event, which other pages could read. */
let dragging: { agent: string; session: string; group?: string } | undefined;

/**
 * A place in the side bar that a conversation of the agent's is dropped on: a group, or with null the
 * agent's own line and the conversations in no group. Shown as a target while one is held over it.
 */
function useDrop(agent: string, group: string | null) {
	const [over, setOver] = useState(false);
	const fits = () => dragging?.agent === agent && (dragging.group ?? null) !== group;
	return {
		"data-drop": over ? "" : undefined,
		onDragOver: (e: React.DragEvent) => {
			if (!fits()) return;
			e.preventDefault();
			e.stopPropagation();
			e.dataTransfer.dropEffect = "move";
			setOver(true);
		},
		onDragLeave: (e: React.DragEvent) => {
			if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
		},
		onDrop: (e: React.DragEvent) => {
			setOver(false);
			if (!fits()) return;
			e.preventDefault();
			e.stopPropagation();
			const held = dragging!;
			dragging = undefined;
			void store.moveToGroup(agent, held.session, group);
		},
	};
}

/** What a conversation's right click offers. An agent with one conversation offers the same on its own line. */
function conversationItems(c: Conv, movable: boolean) {
	const main = c.session === "main";
	return [
		{ id: "open", label: "Open" },
		...(c.tasks ? [{ id: "branch", label: "Branch" }] : []),
		...(c.tasks && c.folder ? [{ id: "branch-worktree", label: "Branch into a Worktree" }] : []),
		...(c.worktree ? [{ id: "worktree", label: "Worktree…" }] : []),
		...(main ? [] : [{ id: "pin", label: c.pinned ? "Unpin" : "Pin" }, { id: "rename", label: "Rename…" }]),
		...(movable ? [{ id: "move", label: "Move to Group…" }] : []),
		{ id: "sep", label: "", separator: true },
		main ? { id: "reset", label: "Start over…" } : { id: "remove", label: "Remove…" },
	];
}

/** Does what was picked from a conversation's menu. */
async function conversationPicked(agent: string, c: Conv, picked: string | undefined | null): Promise<void> {
	const s = store;
	if (picked === "open") await s.openTab(agent, c.session);
	if (picked === "move") await s.askMoveToGroup(agent, c.session, c.group);
	if (picked === "branch" || picked === "branch-worktree") await s.branch(agent, c.session, undefined, picked === "branch-worktree");
	if (picked === "worktree") {
		await s.openTab(agent, c.session);
		if (s.active?.kind === "chat") await s.worktreeMenu(s.active);
	}
	if (picked === "pin") await s.pin({ agent, session: c.session }, !c.pinned);
	if (picked === "rename") {
		const to = await s.pick({ title: `Another name for ${c.session}`, items: [], free: true, placeholder: "The new name" });
		if (to?.trim()) await s.rename(agent, c.session, to.trim());
	}
	if (picked === "remove") {
		const sure = await s.pick({ title: `Remove the conversation ${c.session} of ${agent}?`, items: [{ value: "yes", label: "Remove it for good", about: "The messages, what the agent may do without asking here, what it listens to and whatever was set up only for this conversation are all deleted.", tone: "bad" }, { value: "no", label: "Cancel" }] });
		if (sure === "yes") await s.removeConversation(agent, c.session);
	}
	if (picked === "reset") {
		await s.openTab(agent, c.session);
		if (s.active) await s.reset(s.active);
	}
}

/** A title that is not known yet (what was said is not loaded): a bar of a title's size in its place. */
function Title({ agent, session }: { agent: string; session: string }) {
	const s = store;
	return s.titleKnown(agent, session) ? <>{s.titleOf(agent, session)}</> : <Skeleton data-slot="title-skeleton" className="inline-block h-3 w-24 align-middle" />;
}

type ConversationRowProps = { skeleton?: false; agent: string; c: Conv; depth?: number; inset?: number } | { skeleton: true; agent?: string; c?: Conv; depth?: number; inset?: number };

/**
 * A side-bar row's shape while it loads: an icon and a label, as the stock menu skeleton draws them, but with a set
 * width (the stock one picks it at random, which a visual snapshot would see change at every run).
 */
function RowSkeleton({ width, className }: { width: string; className?: string }) {
	return (
		<div data-slot="row-skeleton" className={cn("flex h-8 items-center gap-2 rounded-md px-2", className)}>
			<Skeleton className="size-4 rounded-md" />
			<Skeleton className="h-4 max-w-(--skeleton-width) flex-1" style={{ "--skeleton-width": width } as CSSProperties} />
		</div>
	);
}

/** A conversation's row in the side bar; with `skeleton`, a row of its shape while the conversations load. */
export function ConversationRow(props: ConversationRowProps) {
	if (props.skeleton) return <SidebarMenuItem role="none"><RowSkeleton width={(props.depth ?? 0) % 2 ? "60%" : "75%"} className={INDENT[Math.min((props.depth ?? 0) + (props.inset ?? 0), INDENT.length - 1)]} /></SidebarMenuItem>;
	return <Row {...props} />;
}

function Row({ agent, c, depth = 0, inset = 0 }: { agent: string; c: Conv; depth?: number; inset?: number }) {
	const s = store;
	// A conversation is moved with its branches: a branch shown under its original is not moved by itself.
	const movable = depth === 0 && !c.session.endsWith("~u");
	const tab = s.tabs.find((t) => t.kind === "chat" && t.agent === agent && t.session === c.session);
	const main = c.session === "main";
	const { setOpenMobile } = useSidebar();
	const menu = async () => conversationPicked(agent, c, await bridge.contextMenu(conversationItems(c, movable)));
	const kept = main ? "the agent's own, always kept" : c.pinned ? "pinned" : c.group ? `kept in the group ${c.group}` : c.open ? "open in a tab" : c.expires ? `goes ${until(c.expires)}` : "kept";
	const working = tab?.busy || s.isBusy(agent, c.session);
	const on = Boolean(tab && tab === s.active);
	return (
		// The row is the stock menu button drawn as the list's option, so the list keeps its one tab stop and its arrows.
		<SidebarMenuItem
			role="none"
			className="app-no-drag"
			onContextMenu={(e) => (e.preventDefault(), void menu())}
			draggable={movable}
			onDragStart={movable ? (e) => ((dragging = { agent, session: c.session, group: c.group }), (e.dataTransfer.effectAllowed = "move"), e.dataTransfer.setData("text/plain", s.titleOf(agent, c.session))) : undefined}
			onDragEnd={() => (dragging = undefined)}
		>
			<SidebarMenuButton isActive={on} onClick={() => setOpenMobile(false)} className={cn(INDENT[Math.min(depth + inset, INDENT.length - 1)], c.tasks && "pr-16 group-has-data-[sidebar=menu-action]/menu-item:pr-16")} render={<ListboxItem value={c.session} label={s.titleOf(agent, c.session)} title={`${agent} · ${c.session} · ${kept}${c.branch ? ` · a branch of ${c.branch.from}` : ""}${c.worktree ? ` · in the worktree ${c.worktree.branch} of ${c.worktree.repo}` : c.folder ? ` · works in ${c.folder}` : ""}`} />}>
				<span className="grid h-4 w-6 flex-none place-items-center">{tab?.approvals.size ? <Badge variant="destructive" className="size-4 p-0">!</Badge> : working ? <Pulse /> : tab?.unread ? <Badge className="size-2 p-0" /> : main || c.pinned ? <StarIcon className="text-faint" /> : depth || c.worktree ? <GitBranchIcon className="text-faint" /> : c.folder ? <FolderIcon className="text-faint" /> : <MessageSquareIcon className="text-faint" />}</span>
				<span className="min-w-0 flex-1"><Title agent={agent} session={c.session} /></span>
			</SidebarMenuButton>
			{/* The badge is drawn over the button, so the button keeps the room for the time (stock pr-8 fits an action alone; the same selector as stock, so it takes the place of its pr-8). */}
			{c.tasks ? <SidebarMenuBadge className={cn(!main && "group-hover/menu-item:hidden")}>{ago(c.last).replace(" ago", "")}</SidebarMenuBadge> : null}
			{main ? null : (
				// Shown under the pointer only, so that it is no tab stop of its own; its keys are not the list's.
				<AlertDialog>
					<HoverTooltip>
						<TooltipTrigger render={<AlertDialogTrigger render={<SidebarMenuAction className="hidden group-hover/menu-item:flex" onKeyDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} />} aria-label="Remove this conversation for good"><Trash2Icon /></AlertDialogTrigger>} />
						<TooltipContent>Remove this conversation for good</TooltipContent>
					</HoverTooltip>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Remove the conversation {s.titleOf(agent, c.session)} for good?</AlertDialogTitle>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogCancel variant="destructive" onClick={() => void s.removeConversation(agent, c.session)}>Remove</AlertDialogCancel>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			)}
		</SidebarMenuItem>
	);
}

/** The conversations in their order, with each branch right under the one it was made from, newest first. */
function threaded(rows: Conv[]): Array<{ c: Conv; depth: number }> {
	const names = new Set(rows.map((c) => c.session));
	const kids = new Map<string, Conv[]>();
	for (const c of rows) if (c.branch && names.has(c.branch.from) && c.branch.from !== c.session) kids.set(c.branch.from, [...(kids.get(c.branch.from) ?? []), c]);
	const out: Array<{ c: Conv; depth: number }> = [];
	const seen = new Set<string>();
	const put = (c: Conv, depth: number) => {
		if (seen.has(c.session)) return;
		seen.add(c.session);
		out.push({ c, depth });
		for (const k of [...(kids.get(c.session) ?? [])].sort((x, y) => y.last - x.last)) put(k, depth + 1);
	};
	for (const c of rows) if (!(c.branch && names.has(c.branch.from))) put(c, 0);
	// What is left was part of a circle of names (renames can make one): shown as it comes.
	for (const c of rows) put(c, 0);
	return out;
}

/**
 * A group of an agent's conversations: its line folds it (Enter or Space where the keyboard is on it)
 * and is where conversations are dropped, and under it its conversations, each with its branches.
 * The same as an agent's group one step in: its own line, then its own list with its one tab stop.
 */
function ConversationGroup({ agent, name, rows }: { agent: string; name: string; rows: Conv[] }) {
	const s = store;
	const folded = s.folded.has(`${agent}:group:${name}`);
	const drop = useDrop(agent, name);
	const tabs = s.tabs.filter((t) => t.kind === "chat" && t.agent === agent && rows.some((c) => c.session === t.session));
	const waits = tabs.some((t) => t.approvals.size > 0);
	const working = rows.some((c) => s.isBusy(agent, c.session)) || tabs.some((t) => t.busy);
	const unread = tabs.some((t) => t.unread);
	const count = rows.filter((c) => c.session !== "main" || c.tasks).length;
	const menu = async () => {
		const picked = await bridge.contextMenu([
			{ id: "new", label: `New Conversation in ${name}` },
			{ id: "sep", label: "", separator: true },
			{ id: "rename", label: "Rename…" },
			{ id: "remove", label: "Remove Group…" },
		]);
		if (picked === "new") await s.newConversationIn(agent, name);
		if (picked === "rename") await s.renameGroup(agent, name);
		if (picked === "remove") await s.removeGroup(agent, name);
	};
	return (
		<div data-slot="conversation-group" {...drop} className="rounded-md data-[drop]:bg-accent">
			<Collapsible open={!folded} onOpenChange={() => s.toggleGroupFold(agent, name)}>
				<SidebarMenu>
					<SidebarMenuItem className="app-no-drag" onContextMenu={(e) => (e.preventDefault(), void menu())}>
						<CollapsibleTrigger render={<SidebarMenuButton className="pl-8 group-hover/menu-item:pr-8" title={`${name}: ${count === 1 ? "1 conversation" : `${count} conversations`}, kept however long they are not used`} />}>
							<span className="grid h-4 w-6 flex-none place-items-center">{waits ? <Badge variant="destructive" className="size-4 p-0">!</Badge> : working && folded ? <Pulse /> : unread && folded ? <Badge className="size-2 p-0" /> : folded ? <FolderClosedIcon className="text-faint" /> : <FolderOpenIcon className="text-faint" />}</span>
							<span data-slot="group-label" className="min-w-0 flex-1 truncate">{name}</span>
						</CollapsibleTrigger>
						<SidebarMenuBadge className="group-hover/menu-item:hidden">{count}</SidebarMenuBadge>
						<HoverTooltip><TooltipTrigger render={<SidebarMenuAction className="hidden group-hover/menu-item:flex" onClick={() => void s.newConversationIn(agent, name)} aria-label={`New conversation in ${name}`} />}><PlusIcon /></TooltipTrigger><TooltipContent>{`New conversation in ${name}`}</TooltipContent></HoverTooltip>
					</SidebarMenuItem>
				</SidebarMenu>
				<CollapsibleContent>
					<Listbox aria-label={`Conversations in ${name}`} className="outline-none" {...LISTBOX} value={s.active?.kind === "chat" && s.active.agent === agent ? s.active.session : null} onValueChange={onPick((session) => void s.openTab(agent, session))} render={<SidebarMenu />}>
						{threaded(rows).map(({ c, depth }) => <ConversationRow key={c.session} agent={agent} c={c} depth={depth} inset={1} />)}
					</Listbox>
				</CollapsibleContent>
			</Collapsible>
		</div>
	);
}

/** An agent's line in the side bar with its conversations; with `skeleton`, its shape while they load. */
export function AgentGroup(props: { skeleton?: false; a: AgentInfo } | { skeleton: true; a?: AgentInfo }) {
	if (props.skeleton)
		return (
			<SidebarMenu data-slot="agent-group-skeleton">
				<SidebarMenuItem><RowSkeleton width="50%" /></SidebarMenuItem>
				<ConversationRow skeleton depth={1} />
				<ConversationRow skeleton depth={1} />
			</SidebarMenu>
		);
	return <Group a={props.a} />;
}

function Group({ a }: { a: AgentInfo }) {
	const s = store;
	const folded = s.folded.has(a.id);
	const list = s.conversations.get(a.id) ?? [];
	const grouping = s.groups.get(a.id) ?? { order: "recent" as const, groups: [] };
	const rows: Conv[] = list.some((c) => c.session === "main") ? [...list] : [{ session: "main", tasks: 0, last: 0, pinned: false, open: false }, ...list];
	// A conversation that is open in a tab and has not been said anything in yet is not in the daemon's list.
	for (const t of s.tabs) if (t.kind === "chat" && t.agent === a.id && !rows.some((c) => c.session === t.session)) rows.push({ session: t.session, tasks: 0, last: Date.now(), pinned: s.pins.has(t.key), open: true, group: s.placed.get(`${a.id}:${t.session}`) });
	const names = grouping.groups.map((g) => g.name);
	const groupOf = (c: Conv) => (c.group && names.includes(c.group) ? c.group : undefined);
	// In every list the agent's own conversation first, then what is pinned, then by the agent's order.
	const byName = grouping.order === "name";
	const sort = (cs: Conv[]) => [...cs].sort((x, y) => Number(y.session === "main") - Number(x.session === "main") || Number(y.pinned) - Number(x.pinned) || (byName ? s.titleOf(a.id, x.session).localeCompare(s.titleOf(a.id, y.session)) : y.last - x.last));
	const members = (n: string) => sort(rows.filter((c) => groupOf(c) === n));
	const newest = (n: string) => Math.max(-1, ...rows.filter((c) => groupOf(c) === n).map((c) => c.last));
	const groups = byName ? [...names].sort((x, y) => x.localeCompare(y)) : [...names].sort((x, y) => newest(y) - newest(x));
	const loose = sort(rows.filter((c) => !groupOf(c)));
	// One conversation and no group to put one into: the agent's line is that conversation, with nothing to fold.
	// It is the agent's own (there always is one), so the line is called by the agent and needs no second name.
	const only = rows.length === 1 && !names.length ? rows[0] : undefined;
	const onlyTab = only && s.tabs.find((t) => t.kind === "chat" && t.agent === a.id && t.session === only.session);
	const { setOpenMobile } = useSidebar();
	// A fold from when it had more is forgotten, so that its conversations show when it has more again.
	useEffect(() => {
		if (only && folded) s.toggleFold(a.id);
	}, [only, folded, s, a.id]);
	const lineDrop = useDrop(a.id, null);
	const looseDrop = useDrop(a.id, null);
	const tabs = s.tabs.filter((t) => t.agent === a.id && t.kind === "chat");
	const waits = tabs.some((t) => t.approvals.size > 0);
	const working = s.isBusy(a.id) || tabs.some((t) => t.busy);
	const unread = tabs.some((t) => t.unread);
	const pickFolder = async () => {
		const dir = await s.chooseFolder(`A folder for a conversation with ${a.id}`);
		if (dir) await s.openFolder(dir, a.id);
	};
	// Its name and its color are changed where they are shown: the name turns into a field, the color opens over the avatar.
	const [renaming, setRenaming] = useState(false);
	const [coloring, setColoring] = useState(false);
	const menu = async () => {
		// On a line that is a conversation too, what that conversation's own row would offer comes first. One conversation is not sorted.
		const own = only ? conversationItems(only, true).filter((i) => !("separator" in i)) : [];
		const picked = await bridge.contextMenu([
			...(own.length ? [...own, { id: "sep-own", label: "", separator: true }] : []),
			{ id: "new", label: `New conversation with ${a.id}` },
			{ id: "folder", label: `Open a folder with ${a.id}…` },
			{ id: "group", label: "New Group…" },
			...(only ? [] : [{ id: "sep0", label: "", separator: true }, { id: "recent", label: "Sort by Last Used", checked: !byName }, { id: "name", label: "Sort by Name", checked: byName }]),
			{ id: "sep", label: "", separator: true },
			{ id: "rename", label: "Rename…" },
			{ id: "color", label: "Color…" },
			{ id: "settings", label: "Agent settings…" },
			// The main agent administers pine and stays.
			...(a.main ? [] : [{ id: "sep2", label: "", separator: true }, { id: "remove", label: `Remove ${a.id}…` }]),
		]);
		if (only && own.some((i) => i.id === picked)) return conversationPicked(a.id, only, picked);
		if (picked === "new") await s.newConversation(a.id);
		if (picked === "folder") await pickFolder();
		if (picked === "group") await s.newGroup(a.id);
		if ((picked === "recent" && byName) || (picked === "name" && !byName)) await s.sortConversations(a.id, picked);
		if (picked === "rename") setRenaming(true);
		if (picked === "color") setColoring(true);
		if (picked === "settings") s.openSettings("agents", a.id);
		if (picked === "remove") await s.removeAgent(a.id);
	};
	const count = rows.length === 1 ? "1 conversation" : `${rows.length} conversations`;
	const what = a.description || a.model;
	// An agent's name and, beside it on the same line, what it is for; a group says first how many conversations it holds. The name is whole;
	// the rest takes the room that is left and is cut off where that ends. With the pointer on the line, what was cut off slides through to its end and back.
	const label = (
		<span data-slot="agent-label" className="flex min-w-0 flex-1 items-baseline gap-2 font-semibold text-foreground">
			<span className="min-w-0 flex-initial truncate">{a.id}</span>
			<span className="@container min-w-0 flex-1 truncate text-xs font-normal text-faint group-hover/menu-item:text-clip"><span className="group-hover/menu-item:inline-block group-hover/menu-item:animate-slide-end motion-reduce:animate-none" style={{ animationDuration: slideFor(only ? what : `${count} · ${what}`) }}>{only ? null : <><span data-slot="agent-count">{count}</span>{" · "}</>}{what}</span></span>
		</span>
	);
	const line = (
		<SidebarMenu>
			{/* Dropped on the agent's line, a conversation leaves its group. */}
			<SidebarMenuItem {...lineDrop} className="app-no-drag rounded-md data-[drop]:bg-accent" title={`${a.id}: ${a.description || "no description"}\n${a.model} · ${a.mode}${only ? "" : `\n${count}`}`} onContextMenu={(e) => (e.preventDefault(), void menu())}>
				<AgentColorPicker agent={a} open={coloring} onOpenChange={setColoring} onChange={(c) => void s.colorAgent(a.id, c)} nativeButton={false} trigger={<span aria-hidden tabIndex={-1} className="pointer-events-none absolute top-1 left-8 size-6" />} />
				{renaming ? (
					<div className="flex h-8 items-center gap-2 px-2">
						<AgentAvatar agent={a} size="sm" />
						<AgentNameInput id={a.id} className="h-7" onDone={(to) => (setRenaming(false), to && void s.renameAgent(a.id, to))} />
					</div>
				) : (
					<>
						{/* Under the pointer the line makes room for all three buttons: `!`, since the stock button's room for one action (pr-8) comes later in the stylesheet and would win. */}
						{only ? (
							// The line is its one conversation: a click opens it, and it shows what that conversation's row would (it waits, works, has something new, when it was last used).
							// Nothing folds, and the avatar stays where the avatars of the groups are.
							<SidebarMenuButton data-slot="agent-conversation" isActive={Boolean(onlyTab && onlyTab === s.active)} className="group-hover/menu-item:pr-20!" onClick={() => (setOpenMobile(false), void s.openTab(a.id, only.session))}>
								<span aria-hidden className="size-4 flex-none" />
								<AgentAvatar agent={a} size="sm" />
								{label}
								{waits ? <Badge variant="destructive" className="size-4 p-0">!</Badge> : working ? <Pulse /> : unread ? <Badge className="size-2 p-0" /> : only.tasks ? <span className="flex-none text-xs font-normal text-faint tabular-nums group-hover/menu-item:hidden">{ago(only.last).replace(" ago", "")}</span> : null}
							</SidebarMenuButton>
						) : (
							// What folds the group is the agent's line but its buttons.
							<CollapsibleTrigger render={<SidebarMenuButton className="group-hover/menu-item:pr-20!" />}>
								{folded ? <ChevronRightIcon className="text-faint" /> : <ChevronDownIcon className="text-faint" />}
								<AgentAvatar agent={a} size="sm" />
								{label}
								{waits ? <Badge variant="destructive" className="size-4 p-0">!</Badge> : working ? <Pulse /> : unread && folded ? <Badge className="size-2 p-0" /> : null}
							</CollapsibleTrigger>
						)}
						<HoverTooltip><TooltipTrigger render={<SidebarMenuAction className="right-13 hidden group-hover/menu-item:flex" onClick={() => s.openSettings("agents", a.id)} aria-label={`Settings of ${a.id}`} />}><SettingsIcon /></TooltipTrigger><TooltipContent>{`Settings of ${a.id}`}</TooltipContent></HoverTooltip>
						<HoverTooltip><TooltipTrigger render={<SidebarMenuAction className="right-7 hidden group-hover/menu-item:flex" onClick={() => void pickFolder()} aria-label={`Open a folder for a conversation with ${a.id}`} />}><FolderIcon /></TooltipTrigger><TooltipContent>{`Open a folder for a conversation with ${a.id}`}</TooltipContent></HoverTooltip>
						<HoverTooltip><TooltipTrigger render={<SidebarMenuAction onClick={() => void s.newConversation(a.id)} aria-label={`New conversation with ${a.id}`} />}><PlusIcon /></TooltipTrigger><TooltipContent>{`New conversation with ${a.id}`}</TooltipContent></HoverTooltip>
					</>
				)}
			</SidebarMenuItem>
		</SidebarMenu>
	);
	if (only) return line;
	return (
		<Collapsible open={!folded} onOpenChange={() => s.toggleFold(a.id)}>
			{line}
			<CollapsibleContent>
				{groups.map((n) => <ConversationGroup key={n} agent={a.id} name={n} rows={members(n)} />)}
				<div {...looseDrop} className="rounded-md data-[drop]:bg-accent">
					<Listbox aria-label={`Conversations with ${a.id}`} className="outline-none" {...LISTBOX} value={s.active?.kind === "chat" && s.active.agent === a.id ? s.active.session : null} onValueChange={onPick((session) => void s.openTab(a.id, session))} render={<SidebarMenu />}>
						{threaded(loose).map(({ c, depth }) => <ConversationRow key={c.session} agent={a.id} c={c} depth={depth} />)}
					</Listbox>
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

export function Sidebar() {
	const s = useModel(store);
	const front = s.active;
	const update = s.updatePhase;
	const older = s.service.status === "ready" && s.service.olderThan ? s.service : undefined;
	const { isMobile } = useSidebar();
	// shadcn's stock Sidebar. In a wide window it is fixed in its place (the panel around it sets its width),
	// its background left to the window behind it, which is the system's material on a Mac, and where nothing
	// is to click it moves the window, like the bar along the top. In a narrow one it is stock's own sheet over
	// the page (`offcanvas` on a phone-wide window), opened by the same button and key.
	return (
		<SidebarRoot collapsible={isMobile ? "offcanvas" : "none"} className="w-full min-w-0 bg-transparent app-drag">
			<SidebarHeader className="h-11 flex-none flex-row items-center justify-end gap-0.5 py-0 pr-2 pl-window-buttons app-drag">
				<HoverTooltip><TooltipTrigger render={<SidebarTrigger size="icon" className="app-no-drag" aria-label="Hide the sidebar" />} /><TooltipContent>Hide the sidebar<Kbd>{shortcut("⌘B")}</Kbd></TooltipContent></HoverTooltip>
			</SidebarHeader>
			<SidebarContent>
				<ScrollArea className="flex min-h-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade flex-1">
					<SidebarGroup className="pt-1 pb-0">
						<SidebarMenu>
							<SidebarMenuItem className="app-no-drag">
								<HoverTooltip><TooltipTrigger render={<SidebarMenuButton onClick={() => void s.command("palette")} />}><SearchIcon /><span className="grow min-w-0 flex-1">Search</span><Kbd>{shortcut("⌘K")}</Kbd></TooltipTrigger><TooltipContent>Find a conversation by name or by what was said in it, or a command, an agent, a settings page</TooltipContent></HoverTooltip>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarGroup>
					<SidebarGroup>
						<SidebarGroupLabel>Agents</SidebarGroupLabel>
						<HoverTooltip><TooltipTrigger render={<SidebarGroupAction className="app-no-drag" onClick={() => ((s.newAgent = true), s.touch())} aria-label="New agent" />}><PlusIcon /></TooltipTrigger><TooltipContent>New agent</TooltipContent></HoverTooltip>
						<SidebarGroupContent className="flex flex-col gap-1">{s.agents.map((a) => (s.conversations.has(a.id) ? <AgentGroup key={a.id} a={a} /> : <AgentGroup key={a.id} skeleton />))}</SidebarGroupContent>
					</SidebarGroup>
				</ScrollArea>
			</SidebarContent>
			<SidebarFooter className="gap-0">
				<SidebarMenu>
					{update ? <SidebarMenuItem className="app-no-drag"><UpdateButton update={update} /></SidebarMenuItem> : null}
					{older ? (
						<SidebarMenuItem className="app-no-drag" data-notice="older-pine">
							<HoverTooltip><TooltipTrigger render={<SidebarMenuButton onClick={() => s.openSettings("general")} />}><TriangleAlertIcon /><span className="grow min-w-0 flex-1 truncate">An older pine runs</span></TooltipTrigger><TooltipContent>{`The pine this app attached to is ${older.version}, older than the app's own (${older.olderThan}). Restart it on the newer one: Settings › General says how.`}</TooltipContent></HoverTooltip>
						</SidebarMenuItem>
					) : null}
					<SidebarMenuItem className="app-no-drag">
						<SidebarMenuButton isActive={front?.kind === "events"} onClick={() => void s.openEvents()}><AudioLinesIcon /><span className="grow min-w-0 flex-1">Events</span></SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem className="app-no-drag">
						<SidebarMenuButton isActive={front?.kind === "settings"} onClick={() => s.openSettings()}><SettingsIcon /><span className="grow min-w-0 flex-1">Settings</span><Kbd>{shortcut("⌘,")}</Kbd></SidebarMenuButton>
					</SidebarMenuItem>
					<Machines />
				</SidebarMenu>
			</SidebarFooter>
		</SidebarRoot>
	);
}

/**
 * The pine the app uses, at the foot of the side bar, as large as the rows above it: its state and
 * version, and on which machine it runs. A click lists the machines (this one, and those added in
 * Settings > Environments) to use another, and leads to those settings. Under a bridge with no
 * local machine (`store.local`), only the machines added.
 */
export function Machines() {
	const s = useModel(store);
	const state = s.service;
	const here = `This ${computerWord(s.platform)}`;
	const on = state.status === "ready" ? state.label : state.host;
	// A paired computer by its name, never its id.
	const reached = state.host && s.nameOf(state.host);
	const text =
		state.status !== "ready"
			? reached
				? state.status === "error"
					? `${reached} not reached`
					: `connecting to ${reached}`
				: "starting"
			: !s.connected
				? "pine does not answer"
				: `pine${state.version ? ` ${state.version}` : ""} · ${on ?? (state.started ? "started here" : "attached")}`;
	const about = state.status === "ready" ? `${state.home} · ${state.host ? (isPaired(state.host) ? `paired with this ${s.device}` : `over SSH (${state.host})`) : state.started ? "started by this app" : "a pine that was already running"}` : "";
	return (
		<SidebarMenuItem className="app-no-drag">
			<DropdownMenu>
				<DropdownMenuTrigger render={<SidebarMenuButton data-slot="service-status" title={about} aria-label={`The pine the app uses: ${text}. Use another one`} />}>
					{/* The dot stands in the place of the icons in the rows above it: its middle under theirs, and what is written beside it under their names. */}
					<span className="grid size-4 flex-none place-items-center"><span className={cn(DOT, state.status === "error" ? "bg-destructive" : state.status !== "ready" ? "bg-warn" : s.connected ? "bg-primary" : "bg-destructive")} /></span>
					<span className="min-w-0 flex-1 truncate">{text}</span>
					<ChevronsUpDownIcon className="text-faint" />
				</DropdownMenuTrigger>
				<DropdownMenuContent side="top" className="min-w-56">
					<DropdownMenuGroup>
						<DropdownMenuLabel>Use the pine on</DropdownMenuLabel>
						<DropdownMenuRadioGroup value={state.host ?? ""} onValueChange={(host: string) => void s.useMachine(host || undefined)}>
							{s.local ? <DropdownMenuRadioItem value="" closeOnClick><LaptopIcon />{here}</DropdownMenuRadioItem> : null}
							{s.prefs.hosts.map((host) => (
								<DropdownMenuRadioItem key={host} value={host} closeOnClick data-host={host}>{isPaired(host) ? <LaptopIcon /> : <ServerIcon />}<span className="truncate">{s.nameOf(host)}</span></DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					{/* Back to the list of machines, the one in use kept: only a bridge with no local machine offers it (the web client's). */}
					{s.canDisconnect ? <DropdownMenuItem data-slot="disconnect" onClick={() => void s.disconnect()}><UnplugIcon />Disconnect</DropdownMenuItem> : null}
					<DropdownMenuItem onClick={() => s.openSettings("environments")}><SettingsIcon />Environments…</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</SidebarMenuItem>
	);
}

// ---- the tabs ------------------------------------------------------------------------------------------

function TabButton({ tab, index }: { tab: Tab; index: number }) {
	useModel(tab);
	const s = store;
	const [drop, setDrop] = useState(false);
	const on = s.active === tab;
	const kept = tab.kind === "chat" && (tab.session === "main" || s.pins.has(tab.key));
	// The tab brought to the front is scrolled into view when there are more tabs than the row shows.
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (on) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [on]);
	const act = (action: TabMenuAction) => {
		if (action === "close") return s.closeTab(tab);
		if (action === "pin" || action === "unpin") return void s.pin(tab, action === "pin");
		s.closeTabs(action, tab);
	};
	// The least width is what the tab holds besides its name (the avatar, the gaps, the close button) and a few letters of the
	// name: narrower, what does not shrink spills over the next tab. Past that, the row scrolls.
	return (
		<TabMenu
			pin={tab.kind !== "chat" ? undefined : tab.session === "main" ? "main" : kept ? "unpin" : "pin"}
			others={s.tabs.length > 1}
			right={index < s.tabs.length - 1}
			onAction={act}
			trigger={
				<div
					ref={ref}
					data-slot="tab"
					data-active={on || undefined}
					className={cn("group/tab relative flex h-8 max-w-55 min-w-28 flex-initial items-center gap-2 rounded-md pr-1.5 pl-2.5 app-no-drag", on ? "bg-background text-foreground ring-1 ring-border" : "text-muted-foreground hover:bg-accent hover:text-foreground", drop && "before:absolute before:inset-y-1 before:-left-0.5 before:w-0.5 before:rounded-full before:bg-primary")}
					draggable
					onDragStart={(e) => (e.dataTransfer.setData("application/x-pine-tab", String(index)), (e.dataTransfer.effectAllowed = "move"))}
					onDragOver={(e) => e.dataTransfer.types.includes("application/x-pine-tab") && (e.preventDefault(), setDrop(true))}
					onDragLeave={() => setDrop(false)}
					onDrop={(e) => (setDrop(false), s.moveTab(Number(e.dataTransfer.getData("application/x-pine-tab")), index))}
					onClick={() => s.activate(tab)}
					onAuxClick={(e) => e.button === 1 && s.closeTab(tab)}
					title={tab.kind === "chat" ? `${tab.agent} · ${tab.session}${tab.folder ? ` · ${tab.folder}` : ""}` : tab.kind === "task" ? `task #${tab.task}` : tab.kind}
				>
					<span className="grid min-w-3.5 flex-none place-items-center">
						{tab.approvals.size ? <Badge variant="destructive" className="size-4 p-0">!</Badge> : tab.busy ? <Pulse /> : tab.unread ? <Badge className="size-2 p-0" /> : tab.kind === "events" ? <AudioLinesIcon size={12} /> : tab.kind === "settings" ? <SettingsIcon size={12} /> : tab.kind === "task" ? <ListIcon size={12} /> : <AgentAvatar agent={{ id: tab.agent, color: s.agent(tab.agent)?.color, main: s.agent(tab.agent)?.main }} size="sm" />}
					</span>
					<span data-slot="tab-name" className="truncate">
						{tab.kind === "events" ? "Events" : tab.kind === "settings" ? "Settings" : tab.kind === "task" ? <><b className="font-medium">{tab.agent}</b> #{tab.task}</> : tab.session === "main" ? <b className="font-medium">{tab.agent}</b> : <><b className="font-medium">{tab.agent}</b> · <Title agent={tab.agent} session={tab.session} /></>}
					</span>
					{kept && tab.session !== "main" ? <StarIcon size={10} className="flex-none text-warn" /> : null}
					<Button variant="ghost" size="icon-xs" aria-label="Close this tab" className={cn(!on && "opacity-0 group-hover/tab:opacity-100")} onClick={(e) => (e.stopPropagation(), s.closeTab(tab))}><XIcon /></Button>
				</div>
			}
		/>
	);
}

/**
 * The icon of the side panel, the browser's aside or the view, at the top right of the title bar. Pressed while
 * it is open; open but behind the others (a window with too little room) it is pressed more lightly, and a click brings it
 * to the front. The side panel and the browser belong to a conversation: on another tab they stay in their place and
 * cannot be pressed. The view can be opened beside any tab, where there is one (`store.hasView`).
 */
function BesideToggle({ which, label, keys, icon }: { which: Beside; label: string; keys: string; icon: React.ReactNode }) {
	const s = store;
	const behind = s.behind(which);
	return (
		<HoverTooltip>
			<TooltipTrigger render={<Toggle size="sm" data-toggle={which === "aside" ? "browser" : which} data-behind={behind || undefined} className="app-no-drag aria-pressed:bg-background aria-pressed:ring-1 aria-pressed:ring-border data-behind:bg-transparent data-behind:text-muted-foreground" disabled={which !== "view" && s.active?.kind !== "chat"} pressed={s.isOpen(which)} onPressedChange={() => s.toggle(which)} aria-label={label} />}>{icon}</TooltipTrigger>
			<TooltipContent>{label}<Kbd>{shortcut(keys)}</Kbd></TooltipContent>
		</HoverTooltip>
	);
}

/**
 * Follows the width of the room beside the side bar, where the conversation, the side panel and the aside lie: with less
 * than `BOTH` or `THREE`, not all the panels beside it are drawn (`store.fits`). A ref of a callback, because the room is
 * there only once the app is ready.
 */
function measureRoom(el: HTMLDivElement | null): (() => void) | undefined {
	if (!el) return;
	const observer = new ResizeObserver(([entry]) => store.measure(entry.contentRect.width));
	observer.observe(el);
	return () => observer.disconnect();
}

export function TitleBar() {
	const s = useModel(store);
	// Drawn again when the window crosses the width where the panels become sheets: what the icons say depends on it.
	useMediaQuery(ROOM);
	const with_ = s.agentInFront();
	const { isMobile, setOpenMobile, toggleSidebar } = useSidebar();
	const column = s.sidebar && !isMobile;
	// The menu's Toggle Sidebar goes to the stock toggle, which knows whether the side bar is a column or a sheet.
	useSignal("sidebar", toggleSidebar);
	// The sheet of a narrow window is put away once another tab comes to the front (from the sheet, the palette,
	// a menu), and when the window gets wide. A click on the conversation already in front puts it away too (ConversationRow).
	useEffect(() => setOpenMobile(false), [s.active?.id, isMobile, setOpenMobile]);
	return (
		<header className={cn("flex h-11 flex-none items-center gap-1 app-drag", s.platform === "darwin" ? "pr-2" : "pr-window-controls", column ? "pl-0.5" : "pl-window-buttons")}>
			{column ? null : <HoverTooltip><TooltipTrigger render={<SidebarTrigger size="icon" className="app-no-drag" aria-label="Show the sidebar" />} /><TooltipContent>Show the sidebar<Kbd>{shortcut("⌘B")}</Kbd></TooltipContent></HoverTooltip>}
			{/* A row that scrolls cuts off what a tab draws outside itself (the line around the tab in front, the mark where a dragged tab
			    would land): the padding is the room for both, and the margin keeps the tabs where they were. It scrolls without a bar;
			    the fade at a cut end says there is more. */}
			<ScrollArea className="-mx-0.5 flex min-h-0 min-w-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade-x">
				<div className="flex items-center gap-0.5 px-0.5 py-px">
					{s.tabs.map((t, i) => <TabButton key={t.id} tab={t} index={i} />)}
				</div>
			</ScrollArea>
			<HoverTooltip><TooltipTrigger render={<Button variant="ghost" size="icon" className="app-no-drag" onClick={() => void s.newConversation()} aria-label={with_ ? `New conversation with ${with_}` : "New conversation: you are asked with which agent"} />}><PlusIcon /></TooltipTrigger><TooltipContent>{with_ ? `New conversation with ${with_}` : "New conversation: you are asked with which agent"}<Kbd>{shortcut("⌘T")}</Kbd></TooltipContent></HoverTooltip>
			<span className="min-w-0 flex-1" />
			<BesideToggle which="code" label="Side panel: the agent, files, changes, output and what is running" keys="⌥⌘B" icon={<PanelRightIcon />} />
			<BesideToggle which="aside" label="Browser: the page the agent works in" keys="⇧⌘B" icon={<GlobeIcon />} />
			{s.hasView ? <BesideToggle which="view" label={`View: all of pine at a glance, drawn by ${s.view}`} keys="⇧⌘O" icon={<RadarIcon />} /> : null}
		</header>
	);
}

/** What the window shows when every tab is closed: the conversations are all still in the side bar. */
function NoTab() {
	const s = store;
	const main = s.agents.find((a) => a.main) ?? s.agents[0];
	return (
		<Empty data-slot="no-tab">
			<EmptyHeader>
				<EmptyMedia variant="icon"><MessageSquareIcon /></EmptyMedia>
				<EmptyTitle>No tab is open</EmptyTitle>
				<EmptyDescription>All conversations are still in the side bar. Open one there, or start a new one.</EmptyDescription>
			</EmptyHeader>
			<EmptyContent className="flex-row justify-center">
				<Button onClick={() => void s.newConversation()}>New conversation<Kbd className="bg-black/15 text-current">{shortcut("⌘T")}</Kbd></Button>
				{main ? <Button variant="outline" onClick={() => void s.openTab(main.id, "main")}>Open {main.id}</Button> : null}
			</EmptyContent>
		</Empty>
	);
}

// ---- what lies over the window for a moment --------------------------------------------------------------

function Asking() {
	const s = useModel(store);
	if (!s.asking) return null;
	const req = s.tabs.map((t) => t.approvals.get(s.asking!)).find(Boolean)?.req;
	if (!req) return null;
	return req.tool === "question" ? <QuestionDialog key={req.id} req={req} /> : <ApprovalDialog key={req.id} req={req} />;
}

function Help({ close }: { close: () => void }) {
	const keys: Array<[string, string]> = [
		["↩", "Send. While the agent works, the message is given to that work and read at the agent's next step"],
		["⌥↩", "Send, but let the message wait until the agent is done"],
		["⇧↩", "New line"],
		["↑ ↓", "Earlier inputs, while the input is empty"],
		["esc", "Stop what the agent is doing"],
		["⇧⇥", "Next mode for this agent, while the input is empty"],
		["@", "Point at a file of the conversation's folder"],
		["/", "Commands, as in the terminal UI"],
		["⌘K", "Everything by name"],
		["⌘1 … ⌘9", "Go to that tab"],
		["⌃⇥", "Next tab"],
	];
	return (
		<Dialog open onOpenChange={(open) => open || close()}>
			<DialogContent showCloseButton={false} className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Keys and commands</DialogTitle>
				</DialogHeader>
				<ScrollArea className="-mx-4 max-h-(--dialog-scroll) min-w-0 wrap-break-word flex min-h-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade">
				<div className="flex flex-col gap-1.5 px-4 text-xs select-text">
					{keys.map(([k, about]) => (
						<Field key={k} orientation="horizontal" className="items-baseline">
							<span className="w-24 flex-none"><Kbd>{shortcut(k)}</Kbd></span>
							<span className="text-muted-foreground">{about}</span>
						</Field>
					))}
					{COMMANDS.map((c) => (
						<Field key={c.name} orientation="horizontal" className="items-baseline">
							<span className="w-24 flex-none font-mono">/{c.name}</span>
							<span className="text-muted-foreground">{c.about}{c.keys ? <> <Kbd>{shortcut(c.keys)}</Kbd></> : null}</span>
						</Field>
					))}
				</div>
				</ScrollArea>
				<DialogFooter>
					<Button variant="outline" onClick={close}>Close</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** The foot of the side bar for a newer app (`Store.updatePhase`): the wait and its call-off, Restart to update, the download, or the release's page. */
function UpdateButton({ update: u }: { update: UpdatePhase }) {
	const s = useModel(store);
	switch (u.phase) {
		case "waiting":
			return <HoverTooltip><TooltipTrigger render={<SidebarMenuButton onClick={() => s.cancelUpdateWait()} />}><HourglassIcon /><span className="grow min-w-0 flex-1 truncate">Restarts when the work is done</span><XIcon /></TooltipTrigger><TooltipContent>{`Pine ${u.version} is installed once no conversation is at work. Click to call it off: the update stays ready for a restart or a quit.`}</TooltipContent></HoverTooltip>;
		case "ready":
			return <HoverTooltip><TooltipTrigger render={<SidebarMenuButton className="text-primary hover:text-primary" onClick={() => void s.restartToUpdate()} />}><RotateCwIcon /><span className="grow min-w-0 flex-1 truncate">Restart to update</span></TooltipTrigger><TooltipContent>{`Pine ${u.version} is downloaded. Pine quits, puts the new app in place of this one (${u.mine}) and opens again, with the pine it started.`}</TooltipContent></HoverTooltip>;
		case "downloading":
			return <SidebarMenuButton disabled><DownloadIcon /><span className="grow min-w-0 flex-1 truncate">Downloading Pine {u.version}…</span></SidebarMenuButton>;
		case "link":
			return <HoverTooltip><TooltipTrigger render={<SidebarMenuButton className="text-primary hover:text-primary" onClick={() => void bridge.open(u.url)} />}><ArrowUpIcon /><span className="grow min-w-0 flex-1 truncate">Pine {u.version} is available</span><ExternalLinkIcon /></TooltipTrigger><TooltipContent>{`${u.reason ? `${u.reason} ` : ""}This is Pine ${u.mine}. Opens the release's page on GitHub in your browser. The new app is ${newApp().what} there: ${newApp().how}.`}</TooltipContent></HoverTooltip>;
	}
}

/**
 * After "Check for Updates…" found a newer app: ready to install with a restart, waiting for the
 * work to end before it restarts (the wait can be called off there), being downloaded, or
 * where it is when the app does not update itself (the setting off, a checkout, a download that failed).
 */
function UpdateAsk() {
	const s = useModel(store);
	const u = s.updatePhase;
	const close = () => ((s.updateAsk = false), s.touch());
	if (!u) return null;
	if (u.phase === "link") {
		return (
			<Dialog open onOpenChange={(open) => open || close()}>
				<DialogContent showCloseButton={false} className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>Pine {u.version} is available</DialogTitle>
					</DialogHeader>
					<div className="select-text">
						{u.reason ? <p className="mb-2.5 text-muted-foreground">{u.reason}</p> : null}
						<p className="text-muted-foreground">This is Pine {u.mine}. The new app is {newApp().what} on the release's page on GitHub: {newApp().how}. Your pine home, with your agents, conversations and settings, stays as it is.</p>
						<p className="mt-2.5 cursor-auto font-mono text-xs text-faint select-text">{u.url}</p>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={close}>Not now</Button>
						<Button onClick={() => (void bridge.open(u.url), close())}><ExternalLinkIcon data-icon="inline-start" />Open the release page</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		);
	}
	const title = { waiting: `Pine ${u.version} is ready`, ready: `Pine ${u.version} is ready`, downloading: `Pine ${u.version} is being downloaded` }[u.phase];
	const text = {
		waiting: `This is Pine ${u.mine}. Pine restarts to update once no conversation is at work. Call off the wait to keep working on this version: the update stays ready for a restart or a quit.`,
		ready: `This is Pine ${u.mine}. Restart to update: Pine quits, puts the new app in place of this one and opens again, with the pine it started. Or quit when you like: the update is installed then.`,
		downloading: `This is Pine ${u.mine}. The new app is downloaded in the background; "Restart to update" appears at the foot of the side bar when it is ready.`,
	}[u.phase];
	return (
		<Dialog open onOpenChange={(open) => open || close()}>
			<DialogContent showCloseButton={false} className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
				</DialogHeader>
				<p className="text-muted-foreground select-text">{text} Your pine home, with your agents, conversations and settings, stays as it is.</p>
				<DialogFooter>
					<Button variant="outline" onClick={close}>{u.phase === "ready" ? "Not now" : "Close"}</Button>
					{u.phase === "ready" ? <Button onClick={() => void s.restartToUpdate()}><RotateCwIcon data-icon="inline-start" />Restart to update</Button> : null}
					{u.phase === "waiting" ? <Button variant="outline" onClick={() => s.cancelUpdateWait()}><XIcon data-icon="inline-start" />Call off the wait</Button> : null}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * After the first pairing, where a web app on the home screen keeps this browser's key (machines.ts
 * `homeScreenKeeps`): the suggestion to put it there. Made once; closing it closes it for good.
 */
function HomeScreenTip() {
	const s = useModel(store);
	const close = () => ((s.homeScreen = false), s.touch());
	return (
		<Dialog open onOpenChange={(open) => open || close()}>
			<DialogContent showCloseButton={false} className="sm:max-w-lg" data-slot="home-screen-tip">
				<DialogHeader>
					<DialogTitle>Add Pine to your home screen</DialogTitle>
				</DialogHeader>
				<p className="text-muted-foreground select-text">In your browser's menu, choose Add to Home screen. Pine then opens like an app and connects to {s.service.host ? s.nameOf(s.service.host) : "your computer"} by itself: it keeps this browser's key, so there is nothing to pair again.</p>
				<DialogFooter>
					<Button onClick={close}>Got it</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * The browser the web tools drive is not on this computer in the build this pine needs: asked at the
 * start, once for a version of pine. Settings > General offers the same at any time. While it is
 * fetched, the dialog stays.
 */
function BrowserAsk() {
	const s = useModel(store);
	const later = () => void s.browserLater();
	return (
		<Dialog open onOpenChange={(open) => open || s.browserFetching || later()}>
			<DialogContent showCloseButton={false} className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>The browser for the web tools is not on this {computerWord(s.platform)}</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-3 select-text">
					<p className="text-muted-foreground">Your agents open pages that need a real browser with one that pine fetches for itself. Each version of pine uses a specific browser build, and the one for this version is not here yet: it was never fetched, or it is the build of an older pine. It is about 600 MB and is fetched once. Until then the browser tools do not work; web search and reading a page do.</p>
					{s.initLines.length ? <Printed sm text={s.initLines.slice(-12).join("\n")} /> : null}
				</div>
				<DialogFooter>
					<Button variant="outline" disabled={s.browserFetching} onClick={later}>Not now</Button>
					<Button disabled={s.browserFetching} onClick={() => void s.fetchBrowser()}>{s.browserFetching ? <><Pulse label="Loading" data-icon="inline-start" />Fetching…</> : "Fetch it"}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

const SIDE_KEY = "pine.sidebar.width";
const SIDE_WIDTH = 248;

/** Remembers how wide a panel is, in pixels, for the next start. Only what the owner did is kept: a narrow window squeezes a panel without changing what it is set to. */
const keepWidth = (layout: Layout, panel: string, key: string) => {
	// The layout is in shares of the room the panels have together, and is told before the panels are
	// drawn at their new widths (after a key): the room is the same before and after.
	const group = document.getElementById(panel)?.parentElement;
	const share = layout[panel];
	if (!group || share === undefined) return;
	const room = [...group.children].filter((el) => el.hasAttribute("data-panel")).reduce((sum, el) => sum + el.getBoundingClientRect().width, 0);
	localStorage.setItem(key, String(Math.round((share * room) / 100)));
};

export function App() {
	const s = useModel(store);
	const [help, setHelp] = useState(false);
	useEffect(() => void s.boot(), [s]);
	useSignal("help", () => setHelp(true));
	// A file dropped beside the input must not take the window to that file.
	useEffect(() => {
		const stop = (e: DragEvent) => e.preventDefault();
		window.addEventListener("dragover", stop);
		window.addEventListener("drop", stop);
		return () => (window.removeEventListener("dragover", stop), window.removeEventListener("drop", stop));
	}, []);
	const ready = s.service.status === "ready" && s.agents.length > 0 && s.opened;
	const tab = s.active;
	const side = usePanelRef();
	// Narrower than stock's breakpoint (Tailwind's `md`), the side bar lies over the page instead of beside it, as stock's
	// own sheet. (The panel beside a conversation does the same below `lg`: CodePanel.tsx.)
	const narrow = useIsMobile();
	const column = s.sidebar && !narrow;
	// Drawn again when the window crosses the width where the side panel and the aside become sheets, one at a time (`store.shown`).
	useMediaQuery(ROOM);
	const chat = tab?.kind === "chat";
	// The window itself: what shows between and around the panels. On a Mac the system's material lies behind it.
	return (
		<div className={cn("flex h-full", s.platform === "darwin" ? "bg-sidebar" : "bg-sunk")}>
			{!ready ? (
				<Gate />
			) : (
				// The stock provider follows the model: its own ⌘B, where the page gets the key before the menu, toggles the same
				// setting in a wide window, and its sheet in a narrow one. Its height is the window's (h-full), not the stock
				// min-h-svh: on a phone the page ends above the home indicator and the keyboard, short of the screen.
				<SidebarProvider className="min-h-0" open={s.sidebar} onOpenChange={(open) => s.showSidebar(open)}>
					{narrow ? <Sidebar /> : null}
					<ResizablePanelGroup orientation="horizontal" onLayoutChanged={(layout, meta) => meta.isUserInteraction && keepWidth(layout, "sidebar-panel", SIDE_KEY)}>
						{column ? (
							<>
								<ResizablePanel id="sidebar-panel" className="flex" panelRef={side} defaultSize={Number(localStorage.getItem(SIDE_KEY)) || SIDE_WIDTH} minSize={190} maxSize={460} groupResizeBehavior="preserve-pixel-size">
									<Sidebar />
								</ResizablePanel>
								<ResizableHandle className="bg-transparent" disableDoubleClick onDoubleClick={() => (side.current?.resize(SIDE_WIDTH), localStorage.setItem(SIDE_KEY, String(SIDE_WIDTH)))} title="Drag to make the side bar wider or narrower" />
							</>
						) : null}
						<ResizablePanel id="main" className="flex">
							<div className="flex min-w-0 flex-1 flex-col">
								<TitleBar />
								<div ref={measureRoom} data-slot="room" className={cn("flex min-h-0 flex-1 pr-1.5 pb-1.5", !column && "pl-1.5")}>
									{/* The conversation, the side panel beside it, and the browser's aside at the far right. Each panel's width is
									    its own: dragging the edge between the two changes both, and both are kept. */}
									<ResizablePanelGroup orientation="horizontal" onLayoutChanged={(layout, meta) => meta.isUserInteraction && (keepWidth(layout, "code-panel", CODE_KEY), keepWidth(layout, "browser-panel", ASIDE_KEY), keepWidth(layout, "view-panel", VIEW_KEY))}>
										<ResizablePanel id="view" className="flex" minSize={320}>
											{!tab ? <NoTab /> : tab.kind === "settings" ? <Settings /> : tab.kind === "events" ? <Events tab={tab} /> : <Conversation key={tab.id} tab={tab} />}
										</ResizablePanel>
										{chat && s.shown("code") ? <CodePanel key={`code:${tab!.id}`} tab={tab!} /> : null}
										{chat && s.shown("aside") ? <BrowserAside key={`aside:${tab!.id}`} tab={tab!} /> : null}
										{/* The view of all of pine, beside any tab. */}
										{s.shown("view") ? <ViewAside key="view" /> : null}
									</ResizablePanelGroup>
								</div>
							</div>
						</ResizablePanel>
					</ResizablePanelGroup>
				</SidebarProvider>
			)}
			{s.browserAsk ? <BrowserAsk /> : null}
			{s.updateAsk ? <UpdateAsk /> : null}
			{s.homeScreen ? <HomeScreenTip /> : null}
			{s.pairAsk ? <PairConfirm key={s.pairAsk.link} link={s.pairAsk} device={s.device} onPair={() => void s.confirmPair()} onCancel={() => s.dropPair()} /> : null}
			{s.picker ? <PickDialog key={s.picker.title} p={s.picker} /> : null}
			{s.publishing ? <PublishDialog /> : null}
			{/* A new agent is met in its conversation: once made, that opens in a tab, wherever the dialog was opened from. */}
			{s.newAgent ? <NewAgent close={() => ((s.newAgent = false), s.touch())} made={(id) => ((s.newAgent = false), s.touch(), void s.openTab(id, "main"))} /> : null}
			{s.palette ? <Palette /> : null}
			<Asking />
			{help ? <Help close={() => setHelp(false)} /> : null}
		</div>
	);
}
