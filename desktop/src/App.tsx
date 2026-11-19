// The window: the list of agents and conversations at the side, the tabs along the top, one
// conversation in the middle with its panel, and whatever lies over them for a moment (a list
// to pick from, a question, the palette).
import { ArrowUpIcon, AudioLinesIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, ChevronsUpDownIcon, LaptopIcon, ServerIcon, ExternalLinkIcon, FolderIcon, GitBranchIcon, GlobeIcon, ListIcon, MessageSquareIcon, PanelRightIcon, PlusIcon, SearchIcon, SettingsIcon, StarIcon, Trash2Icon, XIcon } from "lucide-react";
import { useMediaQuery } from "usehooks-ts";
import { Toggle } from "@/components/ui/toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { type Layout, usePanelRef } from "react-resizable-panels";
import { Field } from "@/components/ui/field";
import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { type AgentInfo, api, type Conversation as Conv } from "./api.ts";
import { bridge } from "./bridge.ts";
import { CODE_KEY, CodePanel } from "./CodePanel.tsx";
import { COMMANDS } from "./commands.ts";
import { Conversation } from "./Conversation.tsx";
import { Events } from "./Events.tsx";
import { type Beside, ROOM, store, type Tab, useModel, useSignal } from "./model.ts";
import { ASIDE_KEY, BrowserAside } from "./Browser.tsx";
import { Settings } from "./Settings.tsx";
import { ApprovalDialog } from "./ApprovalDialog.tsx";
import { Palette } from "./Palette.tsx";
import { PickDialog } from "./PickDialog.tsx";
import { PublishDialog } from "./PublishDialog.tsx";
import { QuestionDialog } from "./QuestionDialog.tsx";
import { ago, isSummon, until } from "./text.ts";
import { Listbox, ListboxItem } from "@ui-sdk/react/listbox";
import { LISTBOX, onPick } from "./lists.tsx";
import { Logo } from "@/components/logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AgentAvatar } from "@/components/agent-avatar";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { Sidebar as SidebarRoot, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuAction, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { Spinner } from "@/components/ui/spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Printed } from "@/components/printed";

// Pieces of the frame drawn the same in several places.
const DOT = "size-2 flex-none rounded-full";

// ---- before pine answers -----------------------------------------------------------------------------

function Gate() {
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
	const [title, about, actions]: [string, React.ReactNode, React.ReactNode] =
		state.status === "starting"
			? host
				? [`Connecting to ${host}`, "Reaching its pine over SSH, or starting one there…", <div key="s" className="flex items-center gap-2"><Spinner /><Button variant="outline" onClick={() => void s.useMachine()}>Use this Mac</Button></div>]
				: ["Starting pine", "Looking for a running pine, or starting one…", <Spinner key="s" />]
			: state.status === "error" && state.kind === "no-home"
				? [
						"Welcome to pine",
						`pine keeps its agents, their workspaces and its settings in a home folder (${s.prefs.home ?? s.home ?? "~/.pine"}). There is none yet. Setting it up copies the example home and fetches the browser its web tools drive (about 600 MB, once).`,
						<>
							{s.initLines.length ? <Printed sm className="w-full text-start" text={s.initLines.slice(-40).join("\n")} /> : null}
							<div className="flex items-center gap-2">
								<Button disabled={s.initRunning} onClick={() => void init()}>{s.initRunning ? <><Spinner data-icon="inline-start" />Setting up…</> : "Set up pine"}</Button>
								<Button variant="outline" disabled={s.initRunning} onClick={() => void bridge.retry()}>Try again</Button>
							</div>
						</>,
					]
				: state.status === "error"
					? [
							state.kind === "no-node" ? "pine needs Node" : state.kind === "no-pine" ? "pine is not installed" : state.kind === "ssh" ? `${host} is not reached over SSH` : host ? `pine on ${host} did not start` : "pine did not start",
							state.message,
							<div key="b" className="flex items-center gap-2">
								<Button onClick={() => void bridge.retry()}>Try again</Button>
								{state.kind === "no-node" ? <Button variant="outline" onClick={() => void bridge.open("https://nodejs.org")}>nodejs.org</Button> : null}
								{host ? <Button variant="outline" onClick={() => void s.useMachine()}>Use this Mac</Button> : null}
							</div>,
						]
					: ["Loading your agents…", "", <Spinner key="s" />];
	// Before pine answers there is nothing to show yet: stock Empty, in a frame that moves the window.
	return (
		<div className="m-1.5 flex flex-1 rounded-xl border bg-background app-drag">
			<Empty className="app-no-drag">
				<EmptyHeader>
					<EmptyMedia>
						<Logo className="size-9" />
					</EmptyMedia>
					<EmptyTitle>{title}</EmptyTitle>
					{about ? <EmptyDescription className="select-text">{about}</EmptyDescription> : null}
				</EmptyHeader>
				<EmptyContent>{actions}</EmptyContent>
			</Empty>
		</div>
	);
}

// ---- the side ----------------------------------------------------------------------------------------
// The side bar is the agents. Each is a group of its own: who it is, whether it is at work, and
// under it its conversations. What starts something new stands on the agent's own line, so it
// is never a question whom a new conversation or a folder is for.

/** How far a conversation's row stands in: a branch under the one it was made from, four steps at most. */
const INDENT = ["pl-10", "pl-14", "pl-18", "pl-22", "pl-26"];

/**
 * A conversation's line. `summon`: a line of the Summons group, which is no agent's group: it says
 * whose the conversation is, does not stand in under an agent, and its value names the agent too.
 */
function ConversationRow({ agent, c, depth = 0, summon = false }: { agent: string; c: Conv; depth?: number; summon?: boolean }) {
	const s = store;
	const tab = s.tabs.find((t) => t.kind === "chat" && t.agent === agent && t.session === c.session);
	const waits = Boolean(tab?.approvals.size) || [...s.summonAsks.values()].includes(`${agent}:${c.session}`);
	const main = c.session === "main";
	const { setOpenMobile } = useSidebar();
	const menu = async () => {
		const picked = await bridge.contextMenu([
			{ id: "open", label: "Open" },
			...(isSummon(c.session) && c.tasks ? [{ id: "continue", label: "Continue in…" }] : []),
			...(c.tasks ? [{ id: "branch", label: "Branch" }] : []),
			...(c.tasks && c.folder ? [{ id: "branch-worktree", label: "Branch into a Worktree" }] : []),
			...(c.worktree ? [{ id: "worktree", label: "Worktree…" }] : []),
			...(main ? [] : [{ id: "pin", label: c.pinned ? "Unpin" : "Pin" }, { id: "rename", label: "Rename…" }]),
			{ id: "sep", label: "", separator: true },
			main ? { id: "reset", label: "Start over…" } : { id: "remove", label: "Remove…" },
		]);
		if (picked === "open") await s.openTab(agent, c.session);
		if (picked === "continue") await s.continueSummon(agent, c.session);
		if (picked === "branch" || picked === "branch-worktree") await s.branch(agent, c.session, undefined, picked === "branch-worktree");
		if (picked === "worktree") {
			await s.openTab(agent, c.session);
			if (s.active?.kind === "chat") await s.worktreeMenu(s.active);
		}
		if (picked === "pin") {
			await s.attempt(() => api.pinSession(agent, c.session, !c.pinned));
			await s.refreshConversations(agent);
		}
		if (picked === "rename") {
			const to = await s.pick({ title: `Another name for ${c.session}`, items: [], free: true, placeholder: "The new name" });
			if (to?.trim()) await s.rename(agent, c.session, to.trim());
		}
		if (picked === "remove") {
			const sure = await s.pick({ title: `Remove the conversation ${c.session} of ${agent}?`, items: [{ value: "yes", label: "Remove it for good", about: "Its history, what it may do without asking, what it listens to and whatever was set up for it alone all go.", tone: "bad" }, { value: "no", label: "Cancel" }] });
			if (sure === "yes") await s.removeConversation(agent, c.session);
		}
		if (picked === "reset") {
			await s.openTab(agent, c.session);
			if (s.active) await s.reset(s.active);
		}
	};
	const kept = main ? "the agent's own, always kept" : c.pinned ? "pinned" : c.open ? "open in a tab" : c.expires ? `goes ${until(c.expires)}` : "kept";
	const working = tab?.busy || s.isBusy(agent, c.session);
	const on = Boolean(tab && tab === s.active);
	return (
		// The row is the stock menu button drawn as the list's option, so the list keeps its one tab stop and its arrows.
		<SidebarMenuItem role="none" className="app-no-drag" onContextMenu={(e) => (e.preventDefault(), void menu())}>
			<SidebarMenuButton isActive={on} onClick={() => setOpenMobile(false)} className={cn(!summon && INDENT[Math.min(depth, INDENT.length - 1)], c.tasks && "pr-16 group-has-data-[sidebar=menu-action]/menu-item:pr-16")} render={<ListboxItem value={summon ? `${agent}:${c.session}` : c.session} label={`${summon ? `${agent} · ` : ""}${s.titleOf(agent, c.session)}`} title={`${agent} · ${c.session} · ${kept}${c.branch ? ` · a branch of ${c.branch.from}` : ""}${c.worktree ? ` · in the worktree ${c.worktree.branch} of ${c.worktree.repo}` : c.folder ? ` · works in ${c.folder}` : ""}`} />}>
				<span className="grid size-4 flex-none place-items-center">{waits ? <Badge variant="destructive" className="size-4 p-0">!</Badge> : working ? <Spinner aria-label="Working" className="size-3" /> : tab?.unread ? <Badge className="size-2 p-0" /> : main || c.pinned ? <StarIcon className="text-faint" /> : depth || c.worktree ? <GitBranchIcon className="text-faint" /> : c.folder ? <FolderIcon className="text-faint" /> : <MessageSquareIcon className="text-faint" />}</span>
				<span className="min-w-0 flex-1">{summon ? <><b className="font-medium">{agent}</b> · </> : null}{s.titleOf(agent, c.session)}</span>
			</SidebarMenuButton>
			{/* The badge is drawn over the button, so the button keeps the room for the time (stock pr-8 fits an action alone; the same selector as stock, so it takes the place of its pr-8). */}
			{c.tasks ? <SidebarMenuBadge className={cn(!main && "group-hover/menu-item:hidden")}>{ago(c.last).replace(" ago", "")}</SidebarMenuBadge> : null}
			{main ? null : (
				// Shown under the pointer only, so that it is no tab stop of its own; its keys are not the list's.
				<AlertDialog>
					<Tooltip>
						<TooltipTrigger render={<AlertDialogTrigger render={<SidebarMenuAction className="hidden group-hover/menu-item:flex" onKeyDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} />} aria-label="Remove this conversation for good"><Trash2Icon /></AlertDialogTrigger>} />
						<TooltipContent>Remove this conversation for good</TooltipContent>
					</Tooltip>
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

function AgentGroup({ a }: { a: AgentInfo }) {
	const s = store;
	const folded = s.folded.has(a.id);
	// Summons are listed in a group of their own (`Summons`).
	const list = (s.conversations.get(a.id) ?? []).filter((c) => !isSummon(c.session));
	// The agent's own conversation first, then what is pinned, then by when it was last used.
	const sorted = [...list].sort((x, y) => Number(y.session === "main") - Number(x.session === "main") || Number(y.pinned) - Number(x.pinned) || y.last - x.last);
	const rows = sorted.some((c) => c.session === "main") ? sorted : [{ session: "main", tasks: 0, last: 0, pinned: false, open: false }, ...sorted];
	// A conversation that is open in a tab and has not been said anything in yet is not in the daemon's list.
	for (const t of s.tabs) if (t.kind === "chat" && t.agent === a.id && !isSummon(t.session) && !rows.some((c) => c.session === t.session)) rows.push({ session: t.session, tasks: 0, last: Date.now(), pinned: false, open: true });
	const tabs = s.tabs.filter((t) => t.agent === a.id && t.kind === "chat");
	const waits = tabs.some((t) => t.approvals.size > 0);
	const working = s.isBusy(a.id) || tabs.some((t) => t.busy);
	const unread = tabs.some((t) => t.unread);
	const pickFolder = async () => {
		const dir = await s.chooseFolder(`A folder for a conversation with ${a.id}`);
		if (dir) await s.openFolder(dir, a.id);
	};
	const menu = async () => {
		const picked = await bridge.contextMenu([
			{ id: "new", label: `New conversation with ${a.id}` },
			{ id: "folder", label: `Open a folder with ${a.id}…` },
			{ id: "sep", label: "", separator: true },
			{ id: "settings", label: "Agent settings…" },
			// The main agent administers pine and stays.
			...(a.main ? [] : [{ id: "sep2", label: "", separator: true }, { id: "remove", label: `Remove ${a.id}…` }]),
		]);
		if (picked === "new") await s.newConversation(a.id);
		if (picked === "folder") await pickFolder();
		if (picked === "settings") s.openSettings("agents", a.id);
		if (picked === "remove") await s.removeAgent(a.id);
	};
	return (
		<Collapsible open={!folded} onOpenChange={() => s.toggleFold(a.id)}>
			<SidebarMenu>
				<SidebarMenuItem className="app-no-drag" title={`${a.id}: ${a.description || "no description"}\n${a.model} · ${a.mode}`} onContextMenu={(e) => (e.preventDefault(), void menu())}>
					{/* What folds the group is the agent's line but its buttons. Under the pointer the line makes room for all three. */}
					<CollapsibleTrigger render={<SidebarMenuButton className="group-hover/menu-item:pr-20" />}>
						{folded ? <ChevronRightIcon className="text-faint" /> : <ChevronDownIcon className="text-faint" />}
						<AgentAvatar agent={a} size="sm" />
						{/* An agent's name and, beside it on the same line, what it is for. The name is whole; what it is for takes the room that is left
						    and is cut off where that ends. With the pointer on the line, what was cut off slides through to its end and back. */}
						<span data-slot="agent-label" className="flex min-w-0 flex-1 items-baseline gap-2 font-semibold text-foreground">
							<span className="min-w-0 flex-initial truncate">{a.id}</span>
							<span className="@container min-w-0 flex-1 truncate text-xs font-normal text-faint group-hover/menu-item:text-clip"><span className="group-hover/menu-item:inline-block group-hover/menu-item:animate-slide-end motion-reduce:animate-none">{a.description || a.model}</span></span>
						</span>
						{waits ? <Badge variant="destructive" className="size-4 p-0">!</Badge> : working ? <Spinner aria-label="Working" className="size-3" /> : unread && folded ? <Badge className="size-2 p-0" /> : null}
					</CollapsibleTrigger>
					<Tooltip><TooltipTrigger render={<SidebarMenuAction className="right-13 hidden group-hover/menu-item:flex" onClick={() => s.openSettings("agents", a.id)} aria-label={`Settings of ${a.id}`} />}><SettingsIcon /></TooltipTrigger><TooltipContent>{`Settings of ${a.id}`}</TooltipContent></Tooltip>
					<Tooltip><TooltipTrigger render={<SidebarMenuAction className="right-7 hidden group-hover/menu-item:flex" onClick={() => void pickFolder()} aria-label={`Open a folder for a conversation with ${a.id}`} />}><FolderIcon /></TooltipTrigger><TooltipContent>{`Open a folder for a conversation with ${a.id}`}</TooltipContent></Tooltip>
					<Tooltip><TooltipTrigger render={<SidebarMenuAction onClick={() => void s.newConversation(a.id)} aria-label={`New conversation with ${a.id}`} />}><PlusIcon /></TooltipTrigger><TooltipContent>{`New conversation with ${a.id}`}</TooltipContent></Tooltip>
				</SidebarMenuItem>
			</SidebarMenu>
			<CollapsibleContent>
				<Listbox aria-label={`Conversations with ${a.id}`} className="outline-none" {...LISTBOX} value={s.active?.kind === "chat" && s.active.agent === a.id ? s.active.session : null} onValueChange={onPick((session) => void s.openTab(a.id, session))} render={<SidebarMenu />}>
					{threaded(rows).map(({ c, depth }) => <ConversationRow key={c.session} agent={a.id} c={c} depth={depth} />)}
				</Listbox>
			</CollapsibleContent>
		</Collapsible>
	);
}

/**
 * What was summoned from somewhere else (a source subscribed with trigger words), whichever agent
 * took it: below the agents, newest first, so that summons do not crowd the owner's conversations.
 * A summon opens no tab; its line is where it is opened.
 */
function Summons() {
	const s = store;
	const rows = s.agents.flatMap((a) => (s.conversations.get(a.id) ?? []).filter((c) => isSummon(c.session)).map((c) => ({ agent: a.id, c })));
	// One that is open in a tab and not in the daemon's list yet.
	for (const t of s.tabs) if (t.kind === "chat" && isSummon(t.session) && !rows.some((r) => r.agent === t.agent && r.c.session === t.session)) rows.push({ agent: t.agent, c: { session: t.session, tasks: 0, last: Date.now(), pinned: false, open: true } });
	if (!rows.length) return null;
	rows.sort((x, y) => y.c.last - x.c.last);
	const front = s.active?.kind === "chat" && isSummon(s.active.session) ? s.active.key : null;
	const open = (key: string) => {
		const at = key.indexOf(":");
		void s.openTab(key.slice(0, at), key.slice(at + 1));
	};
	return (
		<SidebarGroup>
			<SidebarGroupLabel>Summons</SidebarGroupLabel>
			<SidebarGroupContent>
				<Listbox aria-label="Summons" className="outline-none" {...LISTBOX} value={front} onValueChange={onPick(open)} render={<SidebarMenu />}>
					{rows.map(({ agent, c }) => <ConversationRow key={`${agent}:${c.session}`} agent={agent} c={c} summon />)}
				</Listbox>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}

function Sidebar() {
	const s = useModel(store);
	const front = s.active;
	const newer = s.update?.status === "newer" ? s.update : undefined;
	const { isMobile } = useSidebar();
	// shadcn's stock Sidebar. In a wide window it is fixed in its place (the panel around it sets its width),
	// its background left to the window behind it, which is the system's material on a Mac, and where nothing
	// is to click it moves the window, like the bar along the top. In a narrow one it is stock's own sheet over
	// the page (`offcanvas` on a phone-wide window), opened by the same button and key.
	return (
		<SidebarRoot collapsible={isMobile ? "offcanvas" : "none"} className="w-full min-w-0 bg-transparent app-drag">
			<SidebarHeader className="h-11 flex-none flex-row items-center justify-end gap-0.5 py-0 pr-2 pl-window-buttons app-drag">
				<Tooltip><TooltipTrigger render={<SidebarTrigger size="icon" className="app-no-drag" aria-label="Hide the sidebar" />} /><TooltipContent>Hide the sidebar<Kbd>⌘B</Kbd></TooltipContent></Tooltip>
			</SidebarHeader>
			<SidebarContent>
				<ScrollArea className="flex min-h-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade flex-1">
					<SidebarGroup className="pt-1 pb-0">
						<SidebarMenu>
							<SidebarMenuItem className="app-no-drag">
								<Tooltip><TooltipTrigger render={<SidebarMenuButton onClick={() => void s.command("palette")} />}><SearchIcon /><span className="grow min-w-0 flex-1">Search</span><Kbd>⌘K</Kbd></TooltipTrigger><TooltipContent>Find a conversation by its name or by what was said in it, or a command, an agent, a settings page</TooltipContent></Tooltip>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarGroup>
					<SidebarGroup>
						<SidebarGroupLabel>Agents</SidebarGroupLabel>
						<Tooltip><TooltipTrigger render={<SidebarGroupAction className="app-no-drag" onClick={() => s.openSettings("agents", "+")} aria-label="New agent" />}><PlusIcon /></TooltipTrigger><TooltipContent>New agent</TooltipContent></Tooltip>
						<SidebarGroupContent className="flex flex-col gap-1">{s.agents.map((a) => <AgentGroup key={a.id} a={a} />)}</SidebarGroupContent>
					</SidebarGroup>
					<Summons />
				</ScrollArea>
			</SidebarContent>
			<SidebarFooter className="gap-0">
				<SidebarMenu>
					{newer ? (
						<SidebarMenuItem className="app-no-drag">
							<Tooltip><TooltipTrigger render={<SidebarMenuButton className="text-primary hover:text-primary" onClick={() => void bridge.open(newer.url)} />}><ArrowUpIcon /><span className="grow min-w-0 flex-1 truncate">Pine {newer.version} is available</span><ExternalLinkIcon /></TooltipTrigger><TooltipContent>{`This is Pine ${newer.mine}. Opens the release's page on GitHub in your browser: download the disk image there and put the app in place of this one.`}</TooltipContent></Tooltip>
						</SidebarMenuItem>
					) : null}
					<SidebarMenuItem className="app-no-drag">
						<SidebarMenuButton isActive={front?.kind === "events"} onClick={() => void s.openEvents()}><AudioLinesIcon /><span className="grow min-w-0 flex-1">Events</span></SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem className="app-no-drag">
						<SidebarMenuButton isActive={front?.kind === "settings"} onClick={() => s.openSettings()}><SettingsIcon /><span className="grow min-w-0 flex-1">Settings</span><Kbd>⌘,</Kbd></SidebarMenuButton>
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
 * Settings > Environments) to use another, and leads to those settings.
 */
function Machines() {
	const s = useModel(store);
	const state = s.service;
	const here = s.platform === "darwin" ? "This Mac" : "This computer";
	const on = state.status === "ready" ? state.label : state.host;
	const text =
		state.status !== "ready"
			? state.host
				? state.status === "error"
					? `${state.host} not reached`
					: `connecting to ${state.host}`
				: "starting"
			: !s.connected
				? "pine does not answer"
				: `pine${state.version ? ` ${state.version}` : ""} · ${on ?? (state.started ? "started here" : "attached")}`;
	const about = state.status === "ready" ? `${state.home} · ${state.host ? `over SSH (${state.host})` : state.started ? "started by this app" : "a pine that was already running"}` : "";
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
							<DropdownMenuRadioItem value="" closeOnClick><LaptopIcon />{here}</DropdownMenuRadioItem>
							{s.prefs.hosts.map((host) => (
								<DropdownMenuRadioItem key={host} value={host} closeOnClick data-host={host}><ServerIcon /><span className="truncate">{host}</span></DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
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
	// The least width is what the tab holds besides its name (the avatar, the gaps, the close button) and a few letters of the
	// name: narrower, what does not shrink spills over the next tab. Past that, the row scrolls.
	return (
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
				{tab.approvals.size ? <Badge variant="destructive" className="size-4 p-0">!</Badge> : tab.busy ? <Spinner aria-label="Working" className="size-3" /> : tab.unread ? <Badge className="size-2 p-0" /> : tab.kind === "events" ? <AudioLinesIcon size={12} /> : tab.kind === "settings" ? <SettingsIcon size={12} /> : tab.kind === "task" ? <ListIcon size={12} /> : <AgentAvatar agent={{ id: tab.agent, color: s.agent(tab.agent)?.color }} size="sm" />}
			</span>
			<span data-slot="tab-name" className="truncate">
				{tab.kind === "events" ? "Events" : tab.kind === "settings" ? "Settings" : tab.kind === "task" ? <><b className="font-medium">{tab.agent}</b> #{tab.task}</> : tab.session === "main" ? <b className="font-medium">{tab.agent}</b> : <><b className="font-medium">{tab.agent}</b> · {s.titleOf(tab.agent, tab.session)}</>}
			</span>
			{kept && tab.session !== "main" ? <StarIcon size={10} className="flex-none text-warn" /> : null}
			<Button variant="ghost" size="icon-xs" aria-label="Close this tab" className={cn(!on && "opacity-0 group-hover/tab:opacity-100")} onClick={(e) => (e.stopPropagation(), s.closeTab(tab))}><XIcon /></Button>
		</div>
	);
}

/**
 * The icon of the side panel or of the browser's aside, at the top right of the title bar. Pressed while it is open; open
 * but behind the other (a window with room for one only) it is pressed more lightly, and a click brings it to the front.
 * Only a conversation has them: on another tab they stay in their place and cannot be pressed.
 */
function BesideToggle({ which, label, keys, icon }: { which: Beside; label: string; keys: string; icon: React.ReactNode }) {
	const s = store;
	const behind = s.behind(which);
	return (
		<Tooltip>
			<TooltipTrigger render={<Toggle size="sm" data-toggle={which === "aside" ? "browser" : "code"} data-behind={behind || undefined} className="app-no-drag aria-pressed:bg-background aria-pressed:ring-1 aria-pressed:ring-border data-behind:bg-transparent data-behind:text-muted-foreground" disabled={s.active?.kind !== "chat"} pressed={which === "code" ? s.code : s.aside} onPressedChange={() => s.toggle(which)} aria-label={label} />}>{icon}</TooltipTrigger>
			<TooltipContent>{label}<Kbd>{keys}</Kbd></TooltipContent>
		</Tooltip>
	);
}

/**
 * Follows the width of the room beside the side bar, where the conversation, the side panel and the aside lie: with less
 * than `BOTH`, the side panel and the aside are not both drawn (`store.one`). A ref of a callback, because the room is
 * there only once the app is ready.
 */
function measureRoom(el: HTMLDivElement | null): (() => void) | undefined {
	if (!el) return;
	const observer = new ResizeObserver(([entry]) => store.measure(entry.contentRect.width));
	observer.observe(el);
	return () => observer.disconnect();
}

function TitleBar() {
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
		<header className={cn("flex h-11 flex-none items-center gap-1 pr-2 app-drag", column ? "pl-0.5" : "pl-window-buttons")}>
			{column ? null : <Tooltip><TooltipTrigger render={<SidebarTrigger size="icon" className="app-no-drag" aria-label="Show the sidebar" />} /><TooltipContent>Show the sidebar<Kbd>⌘B</Kbd></TooltipContent></Tooltip>}
			{/* A row that scrolls cuts off what a tab draws outside itself (the line around the tab in front, the mark where a dragged tab
			    would land): the padding is the room for both, and the margin keeps the tabs where they were. It scrolls without a bar;
			    the fade at a cut end says there is more. */}
			<ScrollArea className="-mx-0.5 flex min-h-0 min-w-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade-x">
				<div className="flex items-center gap-0.5 px-0.5 py-px">
					{s.tabs.map((t, i) => <TabButton key={t.id} tab={t} index={i} />)}
				</div>
			</ScrollArea>
			<Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon" className="app-no-drag" onClick={() => void s.newConversation()} aria-label={with_ ? `New conversation with ${with_}` : "New conversation: you are asked with which agent"} />}><PlusIcon /></TooltipTrigger><TooltipContent>{with_ ? `New conversation with ${with_}` : "New conversation: you are asked with which agent"}<Kbd>⌘T</Kbd></TooltipContent></Tooltip>
			<span className="min-w-0 flex-1" />
			<BesideToggle which="code" label="Side panel: the agent, its files, changes, output and what is running" keys="⌥⌘B" icon={<PanelRightIcon />} />
			<BesideToggle which="aside" label="Browser: the page the agent works in" keys="⇧⌘B" icon={<GlobeIcon />} />
		</header>
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
		["↩", "Send. While the agent works, the message is given to that work and read at its next step"],
		["⌥↩", "Send, but let the message wait its turn"],
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
							<span className="w-24 flex-none"><Kbd>{k}</Kbd></span>
							<span className="text-muted-foreground">{about}</span>
						</Field>
					))}
					{COMMANDS.map((c) => (
						<Field key={c.name} orientation="horizontal" className="items-baseline">
							<span className="w-24 flex-none font-mono">/{c.name}</span>
							<span className="text-muted-foreground">{c.about}{c.keys ? <> <Kbd>{c.keys}</Kbd></> : null}</span>
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

/** After "Check for Updates…" found a newer app: where it is. The app fetches and installs nothing itself. */
function UpdateAsk() {
	const s = useModel(store);
	const u = s.update;
	const close = () => ((s.updateAsk = false), s.touch());
	if (u?.status !== "newer") return null;
	return (
		<Dialog open onOpenChange={(open) => open || close()}>
			<DialogContent showCloseButton={false} className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Pine {u.version} is available</DialogTitle>
				</DialogHeader>
				<div className="select-text">
					<p className="text-muted-foreground">This is Pine {u.mine}. The new app is a disk image on the release's page on GitHub: download it, quit Pine and put the new app in place of this one. Your pine home, with your agents, conversations and settings, stays as it is.</p>
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

/**
 * The browser the web tools drive is not on this Mac in the build this pine needs: asked at the
 * start, once for a version of pine. Settings > App offers the same at any time. While it is
 * fetched, the dialog stays.
 */
function BrowserAsk() {
	const s = useModel(store);
	const later = () => void s.browserLater();
	return (
		<Dialog open onOpenChange={(open) => open || s.browserFetching || later()}>
			<DialogContent showCloseButton={false} className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>The browser for the web tools is not on this Mac</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-3 select-text">
					<p className="text-muted-foreground">Your agents open pages that need a real browser with one that pine fetches for itself. Each version of pine drives a build of its own, and this one's is not here yet: it was never fetched, or it is the build of an older pine. It is about 600 MB and is fetched once. Until then the browser tools do not work; web search and reading a page do.</p>
					{s.initLines.length ? <Printed sm text={s.initLines.slice(-12).join("\n")} /> : null}
				</div>
				<DialogFooter>
					<Button variant="outline" disabled={s.browserFetching} onClick={later}>Not now</Button>
					<Button disabled={s.browserFetching} onClick={() => void s.fetchBrowser()}>{s.browserFetching ? <><Spinner data-icon="inline-start" />Fetching…</> : "Fetch it"}</Button>
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
	const ready = s.service.status === "ready" && s.agents.length > 0 && s.active;
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
				// setting in a wide window, and its sheet in a narrow one.
				<SidebarProvider open={s.sidebar} onOpenChange={(open) => s.showSidebar(open)}>
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
									<ResizablePanelGroup orientation="horizontal" onLayoutChanged={(layout, meta) => meta.isUserInteraction && (keepWidth(layout, "code-panel", CODE_KEY), keepWidth(layout, "browser-panel", ASIDE_KEY))}>
										<ResizablePanel id="view" className="flex" minSize={320}>
											{tab!.kind === "settings" ? <Settings /> : tab!.kind === "events" ? <Events tab={tab!} /> : <Conversation key={tab!.id} tab={tab!} />}
										</ResizablePanel>
										{chat && s.shown("code") ? <CodePanel key={`code:${tab!.id}`} tab={tab!} /> : null}
										{chat && s.shown("aside") ? <BrowserAside key={`aside:${tab!.id}`} tab={tab!} /> : null}
									</ResizablePanelGroup>
								</div>
							</div>
						</ResizablePanel>
					</ResizablePanelGroup>
				</SidebarProvider>
			)}
			{s.browserAsk ? <BrowserAsk /> : null}
			{s.updateAsk ? <UpdateAsk /> : null}
			{s.picker ? <PickDialog key={s.picker.title} p={s.picker} /> : null}
			{s.publishing ? <PublishDialog /> : null}
			{s.palette ? <Palette /> : null}
			<Asking />
			{help ? <Help close={() => setHelp(false)} /> : null}
		</div>
	);
}
