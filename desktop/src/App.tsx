// The window: the list of agents and conversations at the side, the tabs along the top, one
// conversation in the middle with its panel, and whatever lies over them for a moment (a list
// to pick from, a question, the palette).
import { ArrowUpIcon, AudioLinesIcon, BookOpenIcon, DownloadIcon, HourglassIcon, RotateCwIcon, CheckIcon, RadarIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronsUpDownIcon, EllipsisIcon, LaptopIcon, ServerIcon, ExternalLinkIcon, FolderClosedIcon, FolderIcon, FolderOpenIcon, GitBranchIcon, ListIcon, MenuIcon, MessageSquareIcon, PanelRightIcon, PlusIcon, SearchIcon, SettingsIcon, StarIcon, TerminalSquareIcon, Trash2Icon, TriangleAlertIcon, UnplugIcon, XIcon } from "lucide-react";
import { useMediaQuery } from "usehooks-ts";
import { Toggle } from "@/components/ui/toggle";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup } from "@/components/ui/field";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { type Layout, usePanelRef } from "react-resizable-panels";
import { type CSSProperties, Component, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { type AgentInfo, api, type Conversation as Conv } from "./api.ts";
import { bridge } from "./bridge.ts";
import { CodePanel } from "./CodePanel.tsx";
import { COMMANDS } from "./commands.ts";
import { TabMenu, type TabMenuAction } from "@/components/tab-menu";
import { contextMenu } from "@/components/page-menu";
import { Conversation } from "./Conversation.tsx";
import { Events } from "./Events.tsx";
import { type Beside, isPick, PANE, paneOf, ROOM, store, type Tab, type UpdatePhase, useModel, useSignal } from "./model.ts";
import * as dock from "./dock.ts";
import { ViewAside } from "./View.tsx";
import { Breakable, MachineList, NewAgent, Settings } from "./Settings.tsx";
import { Manual } from "./Manual.tsx";
import { computerWord, firstScreen, isPaired, noMachineSaid } from "./machines.ts";
import { ApprovalDialog } from "./ApprovalDialog.tsx";
import { Palette } from "./Palette.tsx";
import { PairConfirm } from "./Pairing.tsx";
import { PickDialog } from "./PickDialog.tsx";
import { PublishDialog } from "./PublishDialog.tsx";
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
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Sidebar as SidebarRoot, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuAction, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { Pulse } from "@/components/pulse";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Printed } from "@/components/printed";

/**
 * How long a line that slides to show its end takes (tw-animate-css's `animate-out` on an agent's row): long enough
 * to read at the pace one reads, about ten characters a second, and never less than the five seconds a short line takes.
 */
const slideFor = (text: string) => `${Math.max(5, Math.round(text.length / 10))}s`;

// Pieces of the frame drawn the same in several places.
const DOT = "size-2 flex-none rounded-full";
/**
 * What a side-bar row shows at its right end (a time, a count) makes way for the row's buttons wherever those show: under
 * the pointer, while the keyboard is on the row, and always in a narrow window (stock `showOnHover` shows them there).
 */
const UNDER_ACTIONS = "group-hover/menu-item:hidden group-focus-within/menu-item:hidden max-md:hidden";

// ---- before pine answers -----------------------------------------------------------------------------

/** The first screen's frame: stock Empty in a ScrollArea that moves the window. */
function GateFrame({ children, ...props }: { children: React.ReactNode; "data-slot"?: string }) {
	return (
		<ScrollArea className="m-1.5 min-h-0 min-w-0 flex-1 rounded-xl border bg-background text-sm [-webkit-app-region:drag] *:data-[slot=scroll-area-viewport]:scroll-fade">
			<Empty className="min-h-full [-webkit-app-region:no-drag]" {...props}>
				{children}
			</Empty>
		</ScrollArea>
	);
}

/**
 * Before the bridge has said what it is (`stateRead`), the screen to come is not known yet: the logo every screen has,
 * then skeletons where that screen's parts come, so that it takes their place without a jump. A bridge with no machine
 * of its own (the web client's, the mobile app's) is known by a function only it has (`trustHostKey`): its first screen
 * is how to pair, a column of blocks, drawn as stock Skeletons in a stock Card like the pairing view's. The app on a
 * computer comes to its own pine's wait ("Starting pine", "Loading your agents…"): a title, nothing under it.
 */
function GateSkeleton() {
	const elsewhere = typeof bridge.trustHostKey === "function";
	return (
		<GateFrame data-slot="gate-skeleton">
			<EmptyHeader className="w-full">
				<EmptyMedia>
					<Logo className="size-9" />
				</EmptyMedia>
				<Skeleton className="h-5 w-64 max-w-full" />
			</EmptyHeader>
			{elsewhere ? (
				<EmptyContent>
					{/* The pairing view's column, as a browser on a computer draws it: the app's button and its line, the card, the way to SSH. */}
					<FieldGroup>
						<Field>
							<Skeleton className="h-8 w-full" />
							<Skeleton className="h-4 w-full" />
							<Skeleton className="h-4 w-2/3" />
						</Field>
						<Card size="sm">
							<CardHeader>
								<Skeleton className="h-5 w-1/2" />
								<Skeleton className="h-4 w-full" />
								<Skeleton className="h-4 w-full" />
								<Skeleton className="h-4 w-1/3" />
							</CardHeader>
							<CardContent className="flex flex-col gap-2">
								<Skeleton className="h-4 w-3/4" />
								<Skeleton className="h-4 w-full" />
								<Skeleton className="h-4 w-1/2" />
							</CardContent>
							<CardFooter>
								<Skeleton className="h-7 w-36" />
							</CardFooter>
						</Card>
						<Skeleton className="h-7 w-56 self-center" />
					</FieldGroup>
				</EmptyContent>
			) : null}
		</GateFrame>
	);
}

export function Gate() {
	const s = useModel(store);
	if (!s.stateRead) return <GateSkeleton />;
	const state = s.service;
	const host = state.host;
	const key = s.keyToTrust;
	// With no local machine the machines are the only way to a pine: added, chosen or forgotten here,
	// also while one is being reached (that can take a minute), to switch to another.
	// One column of blocks (a list, a card, a section), the stock FieldGroup's gap between any two, as on a Settings page;
	// its text wraps as text does, not balanced like the centred header's.
	const machines = s.local ? null : (
		<FieldGroup className="text-start text-pretty" data-slot="gate-machines">
			<MachineList />
		</FieldGroup>
	);
	// The way back from the SSH view to pairing, above the header it changes, as a Settings page has its way back above its title:
	// at the start of the column, on the edge the cards below start on.
	const back = !s.local && s.machinesShown.back ? (
		<Button variant="ghost" size="sm" className="self-start" data-slot="back-to-pairing" onClick={() => s.showMachines("pair")}>
			<ChevronLeftIcon data-icon="inline-start" />
			Back to pairing
		</Button>
	) : null;
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
						// No home yet: this computer's is made without a question (setUp in model.ts), and what pine init says is shown as it comes.
						s.initRunning ? "Setting up pine" : "pine is not ready yet",
						s.local
							? `pine keeps your agents, their workspaces and pine's settings in a home folder (${s.prefs.home ?? s.home ?? "~/.pine"}). Making it copies the example home and fetches the browser that the web tools use (about 600 MB, once).`
							: "There is no pine home on that machine yet. Run pine init there, then try again.",
						<>
							{s.initLines.length ? <Printed sm className="w-full text-start text-wrap" text={s.initLines.slice(-40).join("\n")} /> : null}
							{s.initRunning ? <Pulse label="Loading" /> : <Button variant="outline" onClick={() => void bridge.retry()}>Try again</Button>}
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
								{/* Only a row with a button in it: an empty one would still take a gap above the machines. */}
								{key || host || s.local || state.kind === "no-node" ? (
									<div className="flex items-center gap-2">
										{key ? <Button data-slot="trust-host-key" onClick={() => void s.trustHostKey(key)}>Trust this key</Button> : null}
										{host || s.local ? <Button variant={key ? "outline" : "default"} onClick={() => void bridge.retry()}>Try again</Button> : null}
										{state.kind === "no-node" ? <Button variant="outline" onClick={() => void bridge.open("https://nodejs.org")}>nodejs.org</Button> : null}
										{host && s.local ? <Button variant="outline" onClick={() => void s.useMachine()}>{useHere}</Button> : null}
									</div>
								) : null}
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
		<GateFrame>
			{/* As wide as the column under it (both stop at the stock max-w-sm), so that its way back starts where the cards do. */}
			<EmptyHeader className="w-full">
				{back}
				<EmptyMedia>
					<Logo className="size-9" />
				</EmptyMedia>
				{/* A long host (a Tailscale Funnel name and its port) wraps instead of spilling past the card. */}
				<EmptyTitle className="max-w-full wrap-anywhere">{title}</EmptyTitle>
				{/* A host key's fingerprint is one long word: it breaks anywhere, or it overflows its centered line on a phone. */}
				{about ? <EmptyDescription className="wrap-anywhere select-text">{about}</EmptyDescription> : null}
			</EmptyHeader>
			<EmptyContent>{actions}</EmptyContent>
		</GateFrame>
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
		...(typeof bridge.newWindow === "function" ? [{ id: "open-in-new-window", label: "Open in New Window" }] : []),
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
	if (picked === "open-in-new-window") await s.openConversationInNewWindow(agent, c.session);
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
	const menu = async () => conversationPicked(agent, c, await contextMenu(conversationItems(c, movable)));
	const kept = main ? "the agent's own, always kept" : c.pinned ? "pinned" : c.group ? `kept in the group ${c.group}` : c.open ? "open in a tab" : c.expires ? `goes ${until(c.expires)}` : "kept";
	const working = tab?.busy || s.isBusy(agent, c.session);
	const on = Boolean(tab && tab === s.active);
	return (
		// The row is the stock menu button drawn as the list's option, so the list keeps its one tab stop and its arrows.
		<SidebarMenuItem
			role="none"
			className="[-webkit-app-region:no-drag]"
			onContextMenu={(e) => (e.preventDefault(), void menu())}
			draggable={movable}
			onDragStart={movable ? (e) => ((dragging = { agent, session: c.session, group: c.group }), (e.dataTransfer.effectAllowed = "move"), e.dataTransfer.setData("text/plain", s.titleOf(agent, c.session))) : undefined}
			onDragEnd={() => (dragging = undefined)}
		>
			<SidebarMenuButton isActive={on} onClick={() => setOpenMobile(false)} className={cn(INDENT[Math.min(depth + inset, INDENT.length - 1)], c.tasks && "pr-16 group-has-data-[sidebar=menu-action]/menu-item:pr-16")} render={<ListboxItem value={c.session} label={s.titleOf(agent, c.session)} title={`${agent} · ${c.session} · ${kept}${c.branch ? ` · a branch of ${c.branch.from}` : ""}${c.worktree ? ` · in the worktree ${c.worktree.branch} of ${c.worktree.repo}` : c.folder ? ` · works in ${c.folder}` : ""}`} />}>
				<span className="grid h-4 w-6 flex-none place-items-center">{tab && s.waits(tab) ? <Badge variant="destructive" className="size-4 p-0">!</Badge> : working ? <Pulse /> : tab?.unread ? <Badge className="size-2 p-0" /> : main || c.pinned ? <StarIcon className="text-faint" /> : depth || c.worktree ? <GitBranchIcon className="text-faint" /> : c.folder ? <FolderIcon className="text-faint" /> : <MessageSquareIcon className="text-faint" />}</span>
				<span className="min-w-0 flex-1"><Title agent={agent} session={c.session} /></span>
			</SidebarMenuButton>
			{/* The badge is drawn over the button, so the button keeps the room for the time (stock pr-8 fits an action alone; the same selector as stock, so it takes the place of its pr-8). */}
			{c.tasks ? <SidebarMenuBadge className={cn(!main && UNDER_ACTIONS)}>{ago(c.last).replace(" ago", "")}</SidebarMenuBadge> : null}
			{main ? null : (
				// A stop of its own after the row (Tab from the list), shown with the pointer or the keyboard on the row; its keys are not the list's.
				<AlertDialog>
					<HoverTooltip>
						<TooltipTrigger render={<AlertDialogTrigger render={<SidebarMenuAction showOnHover onKeyDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} />} aria-label="Remove this conversation for good"><Trash2Icon /></AlertDialogTrigger>} />
						<TooltipContent>Remove this conversation for good</TooltipContent>
					</HoverTooltip>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Remove the conversation {s.titleOf(agent, c.session)} for good?</AlertDialogTitle>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogPrimitive.Close render={<AlertDialogAction variant="destructive" />} onClick={() => void s.removeConversation(agent, c.session)}>Remove</AlertDialogPrimitive.Close>
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
	const waits = tabs.some((t) => s.waits(t));
	const working = rows.some((c) => s.isBusy(agent, c.session)) || tabs.some((t) => t.busy);
	const unread = tabs.some((t) => t.unread);
	const count = rows.filter((c) => c.session !== "main" || c.tasks).length;
	const menu = async () => {
		const picked = await contextMenu([
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
					<SidebarMenuItem className="[-webkit-app-region:no-drag]" onContextMenu={(e) => (e.preventDefault(), void menu())}>
						<CollapsibleTrigger render={<SidebarMenuButton className="pl-8" title={`${name}: ${count === 1 ? "1 conversation" : `${count} conversations`}, kept however long they are not used`} />}>
							<span className="grid h-4 w-6 flex-none place-items-center">{waits ? <Badge variant="destructive" className="size-4 p-0">!</Badge> : working && folded ? <Pulse /> : unread && folded ? <Badge className="size-2 p-0" /> : folded ? <FolderClosedIcon className="text-faint" /> : <FolderOpenIcon className="text-faint" />}</span>
							<span data-slot="group-label" className="min-w-0 flex-1 truncate">{name}</span>
						</CollapsibleTrigger>
						<SidebarMenuBadge className={UNDER_ACTIONS}>{count}</SidebarMenuBadge>
						<HoverTooltip><TooltipTrigger render={<SidebarMenuAction showOnHover onClick={() => void s.newConversationIn(agent, name)} aria-label={`New conversation in ${name}`} />}><PlusIcon /></TooltipTrigger><TooltipContent>{`New conversation in ${name}`}</TooltipContent></HoverTooltip>
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
	const waits = tabs.some((t) => s.waits(t));
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
		const picked = await contextMenu([
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
			<span className="@container min-w-0 flex-1 truncate text-xs font-normal text-faint group-hover/menu-item:text-clip"><span className="group-hover/menu-item:inline-block group-hover/menu-item:animate-out group-hover/menu-item:slide-out-to-left-[max(0px,100%_-_100cqw)] group-hover/menu-item:ease-linear group-hover/menu-item:delay-500 group-hover/menu-item:repeat-infinite group-hover/menu-item:direction-alternate motion-reduce:animate-none" style={{ animationDuration: slideFor(only ? what : `${count} · ${what}`) }}>{only ? null : <><span data-slot="agent-count">{count}</span>{" · "}</>}{what}</span></span>
		</span>
	);
	const line = (
		<SidebarMenu>
			{/* Dropped on the agent's line, a conversation leaves its group. */}
			<SidebarMenuItem {...lineDrop} className="[-webkit-app-region:no-drag] rounded-md data-[drop]:bg-accent" title={`${a.id}: ${a.description || "no description"}\n${a.model} · ${a.mode}${only ? "" : `\n${count}`}`} onContextMenu={(e) => (e.preventDefault(), void menu())}>
				<AgentColorPicker agent={a} open={coloring} onOpenChange={setColoring} onChange={(c) => void s.colorAgent(a.id, c)} nativeButton={false} trigger={<span aria-hidden tabIndex={-1} className="pointer-events-none absolute top-1 left-8 size-6" />} />
				{renaming ? (
					<div className="flex h-8 items-center gap-2 px-2">
						<AgentAvatar agent={a} size="sm" />
						<AgentNameInput id={a.id} className="h-7" onDone={(to) => (setRenaming(false), to && void s.renameAgent(a.id, to))} />
					</div>
				) : (
					<>
						{/* Where its buttons show (UNDER_ACTIONS) the line makes room for both, More and the plus: `!`, since the stock button's room for one action (pr-8) comes later in the stylesheet and would win. */}
						{only ? (
							// The line is its one conversation: a click opens it, and it shows what that conversation's row would (it waits, works, has something new, when it was last used).
							// Nothing folds, and the avatar stays where the avatars of the groups are.
							<SidebarMenuButton data-slot="agent-conversation" isActive={Boolean(onlyTab && onlyTab === s.active)} className="group-hover/menu-item:pr-14! group-focus-within/menu-item:pr-14! max-md:pr-14!" onClick={() => (setOpenMobile(false), void s.openTab(a.id, only.session))}>
								<span aria-hidden className="size-4 flex-none" />
								<AgentAvatar agent={a} size="sm" />
								{label}
								{waits ? <Badge variant="destructive" className="size-4 p-0">!</Badge> : working ? <Pulse /> : unread ? <Badge className="size-2 p-0" /> : only.tasks ? <span className={cn("flex-none text-xs font-normal text-faint tabular-nums", UNDER_ACTIONS)}>{ago(only.last).replace(" ago", "")}</span> : null}
							</SidebarMenuButton>
						) : (
							// What folds the group is the agent's line but its buttons.
							<CollapsibleTrigger render={<SidebarMenuButton className="group-hover/menu-item:pr-14! group-focus-within/menu-item:pr-14! max-md:pr-14!" />}>
								{folded ? <ChevronRightIcon className="text-faint" /> : <ChevronDownIcon className="text-faint" />}
								<AgentAvatar agent={a} size="sm" />
								{label}
								{waits ? <Badge variant="destructive" className="size-4 p-0">!</Badge> : working ? <Pulse /> : unread && folded ? <Badge className="size-2 p-0" /> : null}
							</CollapsibleTrigger>
						)}
						{/* The agent's other actions, as shadcn's sidebar puts them: a More action that opens a menu. The plus stays one click away. */}
						<DropdownMenu>
							<DropdownMenuTrigger render={<SidebarMenuAction showOnHover className="right-7" aria-label={`More for ${a.id}`} />}><EllipsisIcon /></DropdownMenuTrigger>
							<DropdownMenuContent side="right" align="start" className="min-w-56">
								<DropdownMenuGroup>
									<DropdownMenuItem onClick={() => void pickFolder()}><FolderIcon />Open a folder with {a.id}…</DropdownMenuItem>
									<DropdownMenuItem onClick={() => s.openSettings("agents", a.id)}><SettingsIcon />Agent settings…</DropdownMenuItem>
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
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
		<SidebarRoot collapsible={isMobile ? "offcanvas" : "none"} className="w-full min-w-0 bg-transparent text-sm [-webkit-app-region:drag]">
			<SidebarHeader className="h-11 flex-none flex-row items-center justify-end gap-0.5 py-0 pr-2 pl-window-buttons [-webkit-app-region:drag]">
				<HoverTooltip><TooltipTrigger render={<SidebarTrigger size="icon" className="[-webkit-app-region:no-drag]" aria-label="Hide the sidebar" />} /><TooltipContent>Hide the sidebar<Kbd>{shortcut("⌘B")}</Kbd></TooltipContent></HoverTooltip>
			</SidebarHeader>
			<SidebarContent>
				<ScrollArea className="flex min-h-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade flex-1">
					<SidebarGroup className="pt-1 pb-0">
						<SidebarMenu>
							<SidebarMenuItem className="[-webkit-app-region:no-drag]">
								<HoverTooltip><TooltipTrigger render={<SidebarMenuButton onClick={() => void s.command("palette")} />}><SearchIcon /><span className="min-w-0 flex-1">Search</span><Kbd>{shortcut("⌘K")}</Kbd></TooltipTrigger><TooltipContent>Find a conversation by name or by what was said in it, or a command, an agent, a settings page</TooltipContent></HoverTooltip>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarGroup>
					<SidebarGroup>
						<SidebarGroupLabel>Agents</SidebarGroupLabel>
						<HoverTooltip><TooltipTrigger render={<SidebarGroupAction className="[-webkit-app-region:no-drag]" onClick={() => ((s.newAgent = true), s.touch())} aria-label="New agent" />}><PlusIcon /></TooltipTrigger><TooltipContent>New agent</TooltipContent></HoverTooltip>
						<SidebarGroupContent className="flex flex-col gap-1">{s.agents.map((a) => (s.conversations.has(a.id) ? <AgentGroup key={a.id} a={a} /> : <AgentGroup key={a.id} skeleton />))}</SidebarGroupContent>
					</SidebarGroup>
				</ScrollArea>
			</SidebarContent>
			<SidebarFooter className="gap-0">
				<SidebarMenu>
					{update ? <SidebarMenuItem className="[-webkit-app-region:no-drag]"><UpdateButton update={update} /></SidebarMenuItem> : null}
					{older ? (
						<SidebarMenuItem className="[-webkit-app-region:no-drag]" data-notice="older-pine">
							<HoverTooltip><TooltipTrigger render={<SidebarMenuButton onClick={() => s.openSettings("general")} />}><TriangleAlertIcon /><span className="min-w-0 flex-1 truncate">An older pine runs</span></TooltipTrigger><TooltipContent>{`The pine this app attached to is ${older.version}, older than the app's own (${older.olderThan}). Restart it on the newer one: Settings › General says how.`}</TooltipContent></HoverTooltip>
						</SidebarMenuItem>
					) : null}
					<SidebarMenuItem className="[-webkit-app-region:no-drag]">
						<SidebarMenuButton isActive={front?.kind === "events"} onClick={() => void s.openEvents()}><AudioLinesIcon /><span className="min-w-0 flex-1">Events</span></SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem className="[-webkit-app-region:no-drag]">
						<SidebarMenuButton isActive={front?.kind === "settings"} onClick={() => s.openSettings()}><SettingsIcon /><span className="min-w-0 flex-1">Settings</span><Kbd>{shortcut("⌘,")}</Kbd></SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem className="[-webkit-app-region:no-drag]">
						<SidebarMenuButton isActive={front?.kind === "manual"} onClick={() => s.openManual()}><BookOpenIcon /><span className="min-w-0 flex-1">Manual</span></SidebarMenuButton>
					</SidebarMenuItem>
					<Machines />
				</SidebarMenu>
			</SidebarFooter>
		</SidebarRoot>
	);
}

/**
 * Shared dropdown content for switching this window's environment or opening any environment in a
 * new window (via CmdOrCtrl-click or the per-row action button). Used by both the side bar footer
 * (`Machines`) and the title bar environment pill (`EnvironmentPill`).
 */
function MachineMenuContent({ side, align, close }: { side: "top" | "bottom"; align?: "start" | "end"; close: () => void }) {
	const s = useModel(store);
	const state = s.service;
	const here = `This ${computerWord(s.platform)}`;
	const openNewRef = useRef(false);
	const iconFor = (host?: string) => (host?.startsWith("wsl:") ? <TerminalSquareIcon /> : host && !isPaired(host) ? <ServerIcon /> : <LaptopIcon />);
	const renderRow = (host: string | undefined, label: string) => (
		<div key={host ?? ""} className="flex items-center gap-0.5">
			<DropdownMenuRadioItem
				value={host ?? ""}
				closeOnClick
				data-host={host}
				className="min-w-0 flex-1"
				onClick={(e) => {
					if (s.canOpenWindow && (e.metaKey || e.ctrlKey)) {
						openNewRef.current = true;
						queueMicrotask(() => {
							openNewRef.current = false;
						});
						void s.openMachineWindow(host);
					}
				}}
			>
				{iconFor(host)}
				<span className="truncate">{label}</span>
			</DropdownMenuRadioItem>
			{s.canOpenWindow ? (
				<Button
					variant="ghost"
					size="icon-xs"
					data-slot="open-in-new-window"
					data-host={host ?? "local"}
					className="flex-none"
					aria-label={`Open ${label} in new window`}
					title="Open in new window"
					onClick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						close();
						void s.openMachineWindow(host);
					}}
				>
					<ExternalLinkIcon />
				</Button>
			) : null}
		</div>
	);
	return (
		<DropdownMenuContent side={side} align={align} className="min-w-56">
			<DropdownMenuGroup>
				<DropdownMenuLabel>Use the pine on</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={state.host ?? ""}
					onValueChange={(host: string) => {
						if (openNewRef.current) {
							openNewRef.current = false;
							return;
						}
						void s.useMachine(host || undefined);
					}}
				>
					{s.local ? renderRow(undefined, here) : null}
					{s.prefs.hosts.map((host) => renderRow(host, s.nameOf(host)))}
				</DropdownMenuRadioGroup>
			</DropdownMenuGroup>
			<DropdownMenuSeparator />
			{/* Back to the list of machines, the one in use kept: only a bridge with no local machine offers it (the web client's). */}
			<DropdownMenuGroup>
				{s.canDisconnect ? <DropdownMenuItem data-slot="disconnect" onClick={() => void s.disconnect()}><UnplugIcon />Disconnect</DropdownMenuItem> : null}
				<DropdownMenuItem onClick={() => s.openSettings("environments")}><SettingsIcon />Environments…</DropdownMenuItem>
			</DropdownMenuGroup>
		</DropdownMenuContent>
	);
}

/**
 * The pine the app uses, at the foot of the side bar, as large as the rows above it: its state and
 * version, and on which machine it runs. A click lists the machines (this one, and those added in
 * Settings > Environments) to use another or open one in a new window, and leads to those settings.
 * Under a bridge with no local machine (`store.local`), only the machines added.
 */
export function Machines() {
	const s = useModel(store);
	const [open, setOpen] = useState(false);
	const state = s.service;
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
		<SidebarMenuItem className="[-webkit-app-region:no-drag]">
			<DropdownMenu open={open} onOpenChange={setOpen}>
				<DropdownMenuTrigger render={<SidebarMenuButton data-slot="service-status" title={about} aria-label={`The pine the app uses: ${text}. Use another one`} />}>
					{/* The dot stands in the place of the icons in the rows above it: its middle under theirs, and what is written beside it under their names. */}
					<span className="grid size-4 flex-none place-items-center"><span className={cn(DOT, state.status === "error" ? "bg-destructive" : state.status !== "ready" ? "bg-warn" : s.connected ? "bg-primary" : "bg-destructive")} /></span>
					<span className="min-w-0 flex-1 truncate">{text}</span>
					<ChevronsUpDownIcon className="text-faint" />
				</DropdownMenuTrigger>
				<MachineMenuContent side="top" close={() => setOpen(false)} />
			</DropdownMenu>
		</SidebarMenuItem>
	);
}

/**
 * Clickable environment pill in the title bar: shown whenever viewing a remote environment or when
 * the side bar is collapsed, so every window always shows which machine it targets.
 */
function EnvironmentPill() {
	const s = useModel(store);
	const [open, setOpen] = useState(false);
	const state = s.service;
	const here = `This ${computerWord(s.platform)}`;
	const label = s.remote ?? here;
	const host = state.host;
	const icon = host?.startsWith("wsl:") ? <TerminalSquareIcon data-icon="inline-start" /> : host && !isPaired(host) ? <ServerIcon data-icon="inline-start" /> : <LaptopIcon data-icon="inline-start" />;
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger
				render={
					<Button
						variant="outline"
						size="sm"
						data-slot="window-environment"
						className="max-w-44 shrink-0 [-webkit-app-region:no-drag]"
						aria-label={`Environment: ${label}. Switch or open in new window`}
					/>
				}
			>
				<span className={cn("size-1.5 flex-none rounded-full", state.status === "error" ? "bg-destructive" : state.status !== "ready" ? "bg-warn" : s.connected ? "bg-primary" : "bg-destructive")} />
				{icon}
				{/* A phone has no room for the name: the dot and the icon say where, the label names it. */}
				<span className="min-w-0 truncate max-md:hidden">{label}</span>
				<ChevronsUpDownIcon data-icon="inline-end" className="max-md:hidden" />
			</DropdownMenuTrigger>
			<MachineMenuContent side="bottom" align="end" close={() => setOpen(false)} />
		</DropdownMenu>
	);
}

// ---- the tabs ------------------------------------------------------------------------------------------

const TAB_DRAG_NONCE = Math.random().toString(36).slice(2);
const tabDragOrigin = () => (store.windowId || TAB_DRAG_NONCE).toLowerCase();
/** What a drag of this window's own carries: the item (a tab's id, a pane's name) under a type only this window knows. */
const ownType = () => `application/x-pine-item-${tabDragOrigin()}`;
/**
 * What a drag over a part of the layout would bring: an item of this window ("own"), a tab of another window on this
 * machine's pine that the main process holds ("other"), or nothing it takes. Of another window's drag only that it is a
 * tab can be read here.
 */
const tabDragKind = (e: React.DragEvent): "own" | "other" | undefined =>
	e.dataTransfer.types.includes(ownType()) ? "own" : store.tabDragIn && e.dataTransfer.types.includes("application/x-pine-tab") ? "other" : undefined;
/** Which half of a tab the pointer is over: a tab let go there lands before it or after it. */
const halfOf = (e: React.DragEvent): "before" | "after" => {
	const r = e.currentTarget.getBoundingClientRect();
	return e.clientX < r.left + r.width / 2 ? "before" : "after";
};

/**
 * Something let go on the layout, to go into `group` (before `before`, at its end without one) or into a new group at
 * one of its edges: an item of this window moves there, a tab of another window is asked for and opened there.
 */
function landed(e: React.DragEvent, to: { group: string; before?: string; edge?: dock.Edge; window?: boolean }): void {
	const kind = tabDragKind(e);
	if (!kind) return;
	e.preventDefault();
	store.tookTheDrop();
	if (kind === "other") return void store.dropTab(to);
	const item = e.dataTransfer.getData(ownType());
	if (!item) return;
	if (to.edge && to.window) store.splitWindow(item, to.edge);
	else if (to.edge) store.splitGroup(item, to.group, to.edge);
	else store.putInGroup(item, to.group, to.before);
}

/** What a tab of a pane says: the side panel names the conversation it follows, the view the view in force. */
function PaneLabel({ which }: { which: Beside }) {
	const s = useModel(store);
	const tab = s.codeTab;
	if (which === "view") return <>View{s.view ? ` · ${s.view}` : null}</>;
	return <>Side panel{tab ? <> · {tab.session === "main" ? tab.agent : <>{tab.agent} · <Title agent={tab.agent} session={tab.session} /></>}</> : null}</>;
}

/**
 * What a tab shows of itself: its icon (or what calls for the owner: a question, work, something unread) and its name.
 * Drawn on the tab and on its line in the tab list.
 */
function TabFace({ item }: { item: string }) {
	const s = store;
	const tab = s.tabOf(item);
	useModel(tab ?? s);
	const pane = paneOf(item);
	if (!tab && !pane) return null;
	return (
		<>
			<span className="grid size-5 flex-none place-items-center">
				{!tab ? (pane === "code" ? <PanelRightIcon /> : <RadarIcon />) : s.waits(tab) ? <Badge variant="destructive" className="size-4 p-0">!</Badge> : tab.busy ? <Pulse /> : tab.unread ? <Badge className="size-2 p-0" /> : tab.kind === "events" ? <AudioLinesIcon /> : tab.kind === "settings" ? <SettingsIcon /> : tab.kind === "manual" ? <BookOpenIcon /> : tab.kind === "task" ? <ListIcon /> : <AgentAvatar agent={{ id: tab.agent, color: s.agent(tab.agent)?.color, main: s.agent(tab.agent)?.main }} size="sm" className="data-[size=sm]:size-5" />}
			</span>
			<span data-slot="tab-name" className="flex-1 truncate">
				{pane ? <PaneLabel which={pane} /> : tab!.kind === "events" ? "Events" : tab!.kind === "settings" ? "Settings" : tab!.kind === "manual" ? "Manual" : tab!.kind === "task" ? <>{tab!.agent} #{tab!.task}</> : tab!.session === "main" ? tab!.agent : <>{tab!.agent} · <Title agent={tab!.agent} session={tab!.session} /></>}
			</span>
		</>
	);
}

/**
 * A tab in a group's row: a tab of the window (a conversation, a task, the events, the settings) or one of the two
 * panes. Clicked, it comes to the front; dragged, it goes before or after another tab, into another group, or to an
 * edge of one, where it gets a group of its own. A conversation's tab can also go to another window, or out of every
 * window into one of its own.
 */
/** `end`: a tab is dragged over the end of the row, and the last tab draws the line where it would land. */
function DockTab({ item, row, index, end }: { item: string; row: string[]; index: number; end?: boolean }) {
	const s = store;
	const tab = s.tabOf(item);
	useModel(tab ?? s);
	const pane = paneOf(item);
	const holder = dock.groupHolding(s.dock, item);
	// Where a dragged tab would land: before this one or after it, by the half of it the pointer is over.
	const [over, setDrop] = useState<"before" | "after" | false>(false);
	const drop = over || (end ? "after" : false);
	const on = tab ? s.active === tab : false;
	const front = !s.sheets && holder?.front === item;
	const kept = tab?.kind === "chat" && (tab.session === "main" || s.pins.has(tab.key));
	// The tab brought to the front is scrolled into view when there are more tabs than the row shows.
	const ref = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (on || front) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [on, front]);
	if (!tab && !pane) return null;
	const close = () => s.closeItem(item);
	const act = (action: TabMenuAction) => {
		if (action === "close") return close();
		if (action === "split-right" || action === "split-down") return holder && s.splitGroup(item, holder.id, action === "split-right" ? "right" : "bottom");
		if (!tab) return;
		if (action === "pin" || action === "unpin") return void s.pin(tab, action === "pin");
		if (action === "move-to-window") return void s.moveTabToNewWindow(tab);
		s.closeTabs(action, tab);
	};
	const splits = !s.sheets && (holder?.items.length ?? 0) > 1;
	// The least width is what the tab holds besides its name (the avatar, the gaps, the close button) and a few letters of the
	// name: narrower, what does not shrink spills over the next tab. Past that, the row scrolls.
	// The stock tab, drawn as a div: it holds a button of its own (close), which a button cannot.
	return (
		<TabMenu
			pin={tab?.kind !== "chat" ? undefined : tab.session === "main" ? "main" : kept ? "unpin" : "pin"}
			moveToWindow={tab?.kind === "chat" && typeof bridge.newWindow === "function"}
			others={Boolean(tab) && s.siblings(tab).length > 1}
			right={Boolean(tab) && index < row.length - 1}
			closeMany={Boolean(tab)}
			split={splits}
			onAction={act}
			trigger={
				<TabsTrigger
					ref={ref}
					value={item}
					nativeButton={false}
					render={<div />}
					data-slot={pane ? "pane-tab" : "tab"}
					data-pane={pane}
					data-focus={on || undefined}
					data-drop={drop || undefined}
					className={cn("group/tab max-w-55 min-w-28 flex-initial justify-start gap-2 px-1 [-webkit-app-region:no-drag]", drop && "before:absolute before:inset-y-1 before:w-1 before:rounded-full before:bg-primary", drop && (drop === "after" ? "before:-right-1" : "before:-left-1"))}
					draggable
					onDragStart={(e) => {
						e.dataTransfer.setData(ownType(), item);
						e.dataTransfer.effectAllowed = "move";
						// A conversation's tab can go to another window too: the main process is told, and other windows take it.
						if (tab?.kind === "chat") e.dataTransfer.setData("application/x-pine-tab", JSON.stringify({ window: tabDragOrigin() }));
						if (tab) s.startTabDrag(tab);
						else s.startDrag(item);
					}}
					// Let go where nothing took it, and outside every window, a conversation's tab is torn off into a window of its own.
					onDragEnd={(e) => (tab ? void s.endTabDrag(tab, e.dataTransfer.dropEffect === "none", e.screenX, e.screenY) : s.endDrag())}
					onDragOver={(e) => {
						if (!tabDragKind(e)) return;
						e.preventDefault();
						e.stopPropagation();
						e.dataTransfer.dropEffect = "move";
						setDrop(halfOf(e));
					}}
					onDragLeave={() => setDrop(false)}
					onDrop={(e) => {
						const after = halfOf(e) === "after";
						setDrop(false);
						e.stopPropagation();
						if (holder) landed(e, { group: holder.id, before: after ? row[index + 1] : item });
					}}
					onClick={() => s.front(item)}
					onAuxClick={(e) => e.button === 1 && close()}
					title={tab ? (tab.kind === "chat" ? `${tab.agent} · ${tab.session}${tab.folder ? ` · ${tab.folder}` : ""}` : tab.kind === "task" ? `task #${tab.task}` : tab.kind) : pane === "code" ? "The side panel: the files, changes, output, terminal and browser of the conversation last in front" : "The view of all of pine"}
				>
					<TabFace item={item} />
					{kept && tab?.session !== "main" ? <StarIcon className="text-warn" /> : null}
					{/* No stop of its own: a row of tabs is one stop, and ⌘W closes the tab in front. */}
					<Button variant="ghost" size="icon-xs" tabIndex={-1} aria-label={pane ? `Close the ${pane === "code" ? "side panel" : "view"}` : "Close this tab"} className={cn("size-5", !on && !front && "opacity-0 group-hover/tab:opacity-100")} onClick={(e) => (e.stopPropagation(), close())}><XIcon className="size-3" /></Button>
				</TabsTrigger>
			}
		/>
	);
}

/**
 * The icon of the side panel or the view, at the top right of the window. Pressed while it is in front of its group;
 * open but behind another tab of its group it is drawn with an outline as well, and a click brings it to the front. The side
 * panel shows the conversation last in front, so it can be opened while any tab is; the view, where there is one
 * (`store.hasView`).
 */
function BesideToggle({ which, label, keys, icon }: { which: Beside; label: string; keys: string; icon: React.ReactNode }) {
	const s = store;
	const behind = s.behind(which);
	return (
		<HoverTooltip>
			<TooltipTrigger render={<Toggle size="sm" data-toggle={which} data-behind={behind || undefined} className="shrink-0 [-webkit-app-region:no-drag]" variant={behind ? "outline" : "default"} disabled={which === "code" && !s.codeTab} pressed={s.isOpen(which)} onPressedChange={() => s.toggle(which)} aria-label={label} />}>{icon}</TooltipTrigger>
			<TooltipContent>{label}<Kbd>{shortcut(keys)}</Kbd></TooltipContent>
		</HoverTooltip>
	);
}

/** What lies at the right end of the window's top row: the environment, the panes' icons, and the menu off a Mac. */
function WindowControls({ column }: { column: boolean }) {
	const s = useModel(store);
	return (
		<>
			{s.remote || !column ? <EnvironmentPill /> : null}
			<BesideToggle which="code" label="Side panel: the files, changes, output, terminal and browser of the conversation in front" keys="⌥⌘B" icon={<PanelRightIcon />} />
			{s.hasView ? <BesideToggle which="view" label={`View: all of pine at a glance, drawn by ${s.view}`} keys="⇧⌘O" icon={<RadarIcon />} /> : null}
			{/* Off a Mac the window shows no menu bar (electron/main.ts): its menus open from here, beside the system's window controls. */}
			{s.platform !== "darwin" && bridge.appMenu ? (
				<HoverTooltip>
					<TooltipTrigger render={<Button variant="ghost" size="icon" className="shrink-0 [-webkit-app-region:no-drag]" data-slot="app-menu" aria-label="Menu" onClick={(e) => {
						const at = e.currentTarget.getBoundingClientRect();
						void bridge.appMenu?.(at.left, at.bottom);
					}} />}><MenuIcon /></TooltipTrigger>
					<TooltipContent>Menu</TooltipContent>
				</HoverTooltip>
			) : null}
		</>
	);
}

function NewConversationButton({ group }: { group?: string }) {
	const s = store;
	const with_ = s.agentInFront();
	const say = with_ ? `New conversation with ${with_}` : "New conversation: you are asked with which agent";
	return <HoverTooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground [-webkit-app-region:no-drag]" onClick={() => (group && s.focusGroup(group), void s.newConversation())} aria-label={say} />}><PlusIcon /></TooltipTrigger><TooltipContent>{say}<Kbd>{shortcut("⌘T")}</Kbd></TooltipContent></HoverTooltip>;
}

/** A tab's name as text, for the tab list's search: what its face shows. */
function tabLabel(item: string): string {
	const s = store;
	const pane = paneOf(item);
	if (pane) return pane === "code" ? "Side panel" : "View";
	const tab = s.tabOf(item);
	if (!tab) return item;
	if (tab.kind === "events") return "Events";
	if (tab.kind === "manual") return "Manual";
	if (tab.kind === "settings") return "Settings";
	if (tab.kind === "task") return `${tab.agent} #${tab.task}`;
	return tab.session === "main" ? tab.agent : `${tab.agent} · ${s.titleOf(tab.agent, tab.session)}`;
}

/**
 * The list of a row's tabs, after its last tab, before the new conversation's button: stock's combobox in a popup, a
 * search over the tabs' names above every tab, the one in front checked, so that a tab the row has scrolled out of
 * sight is a few letters away. Beside the new conversation's button while the row has two tabs or more: after the
 * tabs, it moves none of them when it comes or goes. No shortcut of its own: ⇧⌘A, the browsers' key for it, attaches
 * files here, and the palette (⌘K) finds any tab by name.
 */
function TabListButton({ items, front }: { items: string[]; front?: string }) {
	const say = "Search the tabs";
	return (
		<Combobox<string> items={items} autoHighlight value={front ?? null} onValueChange={(item) => void (item && store.front(item))} itemToStringLabel={tabLabel}>
			<HoverTooltip>
				<TooltipTrigger render={<ComboboxPrimitive.Trigger render={<Button variant="ghost" size="icon-xs" data-slot="tab-list" className="shrink-0 text-muted-foreground [-webkit-app-region:no-drag]" aria-label={say} />} />}><ChevronDownIcon /></TooltipTrigger>
				<TooltipContent>{say}</TooltipContent>
			</HoverTooltip>
			<ComboboxContent align="end" className="w-72">
				{/* Stock means no ring in a combobox's popup, where the search always has the keyboard, but its focus-visible ring wins. */}
				<ComboboxInput showTrigger={false} placeholder="Search tabs" className="has-[[data-slot=input-group-control]:focus-visible]:border-input/30 has-[[data-slot=input-group-control]:focus-visible]:ring-0" />
				<ComboboxEmpty>No tab is called that.</ComboboxEmpty>
				<ComboboxList>{(item: string) => <ComboboxItem key={item} value={item} data-item={item}><TabFace item={item} /></ComboboxItem>}</ComboboxList>
			</ComboboxContent>
		</Combobox>
	);
}

/**
 * A row of tabs: a group's in a wide window, every tab of the window in a narrow one. Where nothing is to click, a
 * tab let go there goes to its end, and on the window's top row the bar moves the window. The stock tabs, one stop
 * for the keyboard: the arrows go from tab to tab, Enter brings one to the front. The row scrolls without a bar; the
 * fade at a cut end says there is more. The padding below is the room for the line stock draws under a tab (hidden in
 * this variant, but there): without it the row is taller than its room. The same above centres the tabs on the bar.
 */
function TabRow({ items, group, front }: { items: string[]; group?: string; front?: string }) {
	const s = useModel(store);
	const [end, setEnd] = useState(false);
	const dragging = s.dragging !== undefined || s.tabDragIn;
	// The row and its end are one box, so that the end, which takes no room, takes no gap of the bar either.
	return (
		<div data-slot="tab-row" className="flex min-w-0 items-center">
			<ScrollArea className="flex min-h-0 min-w-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade-x">
				<Tabs className="py-0.5" value={front ?? null} onValueChange={(item) => typeof item === "string" && store.front(item)}>
					<TabsList aria-label="Tabs" className="gap-1">
						{items.map((item, i) => <DockTab key={item} item={item} row={items} index={i} end={end && i === items.length - 1} />)}
					</TabsList>
				</Tabs>
			</ScrollArea>
			{/* The end of the row takes no room: while a tab is dragged it reaches over the gap and the new conversation's
			button, and the last tab draws its own line after itself, so that one place shows one line. An empty row draws it here. */}
			{group ? <span data-slot="row-end" className="relative h-8 w-0 flex-none">{dragging ? <span
				className={cn("absolute inset-y-0 left-0 z-10 w-10 [-webkit-app-region:no-drag]", end && !items.length && "before:absolute before:inset-y-1 before:left-1 before:w-1 before:rounded-full before:bg-primary")}
				onDragOver={(e) => {
					if (!tabDragKind(e)) return;
					e.preventDefault();
					e.dataTransfer.dropEffect = "move";
					setEnd(true);
				}}
				onDragLeave={() => setEnd(false)}
				onDrop={(e) => (setEnd(false), landed(e, { group }))}
			/> : null}</span> : null}
		</div>
	);
}

/**
 * A group's bar: its tabs, and its button for a new conversation. A group along the top of the window is the
 * window's title bar there too: it moves the window, the one at the left carries the side bar's button (or makes room
 * for a Mac's window buttons), the one at the right the window's controls.
 */
function GroupBar({ g, sides, column }: { g: dock.Group; sides: dock.Sides; column: boolean }) {
	const s = useModel(store);
	const items = g.items.filter((i) => !paneOf(i) || (paneOf(i) === "view" ? s.hasView : true));
	const lead = sides.top && sides.left && !column;
	const tail = sides.top && sides.right;
	// The tab list's button and the new conversation's go together, side by side without the bar's gap, on a row that
	// holds a conversation: a row of the panes alone (two tabs at most) has neither, an empty row only the new conversation's.
	const talks = items.some((i) => !paneOf(i));
	// The bar has no padding: the last control ends on the edge of the pane's frame below, and the first tab starts the
	// tab list's own 3px inside the other, room for its focus ring.
	return (
		<header
			data-slot="group-bar"
			data-group={g.id}
			className={cn("flex flex-none items-center gap-1 text-sm", sides.top ? "h-11 [-webkit-app-region:drag]" : "h-9", lead && "pl-window-buttons", tail && s.platform !== "darwin" && "pr-window-controls")}
		>
			{lead ? <HoverTooltip><TooltipTrigger render={<SidebarTrigger size="icon" className="shrink-0 [-webkit-app-region:no-drag]" aria-label="Show the sidebar" />} /><TooltipContent>Show the sidebar<Kbd>{shortcut("⌘B")}</Kbd></TooltipContent></HoverTooltip> : null}
			<TabRow items={items} group={g.id} front={g.front} />
			{talks || !items.length ? (
				<div className="flex shrink-0 items-center">
					{talks && items.length > 1 ? <TabListButton items={items} front={g.front} /> : null}
					<NewConversationButton group={g.id} />
				</div>
			) : null}
			{/* Only before the window's controls: at the end of the bar an empty span would still take a gap. */}
			{tail ? <><span className="min-w-0 flex-1" /><WindowControls column={column} /></> : null}
		</header>
	);
}

/** A narrow window's one row: the side bar's button, every tab of the window, and the window's controls. */
export function TitleBar() {
	const s = useModel(store);
	// Drawn again when the window crosses the width where the panes become sheets: what the icons say depends on it.
	useMediaQuery(ROOM);
	const { isMobile } = useSidebar();
	const column = s.sidebar && !isMobile;
	// This row runs to the window's edge, the pane's frame below stops `pr-1.5` short of it: the last control ends on that
	// frame's edge, and the first tab starts the tab list's own 3px inside its other, as in a group's bar.
	return (
		<header className={cn("flex h-11 flex-none items-center gap-1 text-sm [-webkit-app-region:drag]", s.platform === "darwin" ? "pr-1.5" : "pr-window-controls", !column && "pl-window-buttons")}>
			{column ? null : <HoverTooltip><TooltipTrigger render={<SidebarTrigger size="icon" className="shrink-0 [-webkit-app-region:no-drag]" aria-label="Show the sidebar" />} /><TooltipContent>Show the sidebar<Kbd>{shortcut("⌘B")}</Kbd></TooltipContent></HoverTooltip>}
			<TabRow items={s.ordered.map((t) => t.item)} front={s.active?.item} />
			<div className="flex shrink-0 items-center">
				{s.ordered.length > 1 ? <TabListButton items={s.ordered.map((t) => t.item)} front={s.active?.item} /> : null}
				<NewConversationButton />
			</div>
			<span className="min-w-0 flex-1" />
			<WindowControls column={column} />
		</header>
	);
}

/**
 * What a tab draws, and what happens when drawing it throws. Every payload the daemon sends is taken as it comes
 * (api.ts declares shapes, it does not check them): one tone, field or answer that this page did not expect used to
 * blank the whole window — the side bar, the tabs and every other conversation with it. Here only the tab that
 * failed says so, the rest of the window goes on, and closing the tab is the way out of it.
 */
class TabBoundary extends Component<{ what: string; close: () => void; children: ReactNode }, { error?: Error }> {
	state: { error?: Error } = {};
	static getDerivedStateFromError(error: Error) {
		return { error };
	}
	componentDidCatch(error: Error) {
		console.error(`pine: ${this.props.what} could not be drawn`, error);
	}
	render() {
		const error = this.state.error;
		if (!error) return this.props.children;
		return (
			<PaneFrame>
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<TriangleAlertIcon />
						</EmptyMedia>
						<EmptyTitle>That tab could not be drawn</EmptyTitle>
						<EmptyDescription>{error.message || String(error)}</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button variant="outline" size="sm" onClick={this.props.close}>
							Close it
						</Button>
					</EmptyContent>
				</Empty>
			</PaneFrame>
		);
	}
}

/** What a tab or a pane shows, in its group's body or alone in a narrow window. */
function Body({ item }: { item: string }) {
	const s = useModel(store);
	const pane = paneOf(item);
	if (pane === "code") return s.codeTab ? <CodePanel key={`code:${s.codeTab.id}`} tab={s.codeTab} /> : <PaneFrame><Empty><EmptyHeader><EmptyMedia variant="icon"><PanelRightIcon /></EmptyMedia><EmptyTitle>No conversation is open</EmptyTitle><EmptyDescription>The side panel shows the files, changes, terminal and browser of the conversation last in front. Open one.</EmptyDescription></EmptyHeader></Empty></PaneFrame>;
	if (pane === "view") return <ViewAside />;
	const tab = s.tabOf(item);
	if (!tab) return <NoTab />;
	return (
		<TabBoundary key={tab.id} what={tab.kind === "chat" ? `conversation` : tab.kind} close={() => s.closeTab(tab)}>
			{tab.kind === "settings" ? <Settings /> : tab.kind === "manual" ? <Manual /> : tab.kind === "events" ? <Events tab={tab} /> : <Conversation key={tab.id} tab={tab} />}
		</TabBoundary>
	);
}

/** The frame of a pane in a group: the card every tab's content is drawn on. */
function PaneFrame({ children }: { children: React.ReactNode }) {
	return <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background text-sm">{children}</div>;
}

/** How near an edge of the window a dragged tab has to be for that edge, not the edge of the group under it. */
const WINDOW_BAND = 48;

/**
 * Where a dragged tab would go when let go over a group: the group itself, a new group at one of its edges, or, in
 * the band along an edge of the window, a new group along that whole edge. Lies over the group's body only while a
 * tab is dragged, so that what is drawn there (a view's frame, the app's own browser page) cannot take the drag for
 * itself. `rect` and `area` (the whole window's room) are in the same coordinates.
 */
function DropZones({ group, rect, sides, area }: { group: string; rect: dock.Rect; sides: dock.Sides; area: dock.Rect }) {
	const [zone, setZone] = useState<{ zone: dock.Zone; window: boolean }>();
	const at = (e: React.DragEvent) => {
		const r = e.currentTarget.getBoundingClientRect();
		const x = rect.x + e.clientX - r.left;
		const y = rect.y + e.clientY - r.top;
		const edge = dock.windowEdgeOf(sides, rect, area, x, y, WINDOW_BAND);
		return edge ? { zone: edge, window: true } : { zone: dock.zoneOf(rect, x, y), window: false };
	};
	const whole = zone ? (zone.window ? dock.windowRect(area, zone.zone as dock.Edge) : dock.zoneRect(rect, zone.zone)) : undefined;
	// Drawn from this body's corner: a mark along the window's edge reaches over the groups beside it.
	const mark = whole ? { x: whole.x - rect.x, y: whole.y - rect.y, width: whole.width, height: whole.height } : undefined;
	const tag = zone ? `${zone.window ? "window-" : ""}${zone.zone}` : undefined;
	return (
		<div
			data-slot="drop-zones"
			data-group={group}
			data-zone={tag}
			className="absolute z-20"
			style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
			onDragOver={(e) => {
				if (!tabDragKind(e)) return;
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
				const z = at(e);
				if (z.zone !== zone?.zone || z.window !== zone?.window) setZone(z);
			}}
			onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setZone(undefined)}
			onDrop={(e) => {
				const z = at(e);
				setZone(undefined);
				landed(e, z.zone === "center" ? { group } : { group, edge: z.zone, window: z.window });
			}}
		>
			{mark ? <div className="pointer-events-none absolute rounded-xl bg-primary/15 ring-2 ring-primary/60 ring-inset transition-all duration-100" style={{ left: mark.x, top: mark.y, width: mark.width, height: mark.height }} /> : null}
		</div>
	);
}

/** The one empty group a window with no tab shows. */
const NONE: dock.Group = { kind: "group", id: "g-none", items: [] };

/** The room between two groups: the edge that is dragged. */
const GAP = 6;
/** The page's root font size in pixels, which rem are of. */
const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
/**
 * The least a group is wide or tall, in pixels, however its edges are dragged or its tabs are moved: room for a
 * conversation's input and its buttons on one row. A window too small for every group at that size makes them all
 * smaller alike: what a group shows then fits itself to the group, and nothing is drawn past its edge.
 */
const least = (): dock.Least => ({ row: 21.25 * rem(), column: 10 * rem() });
/** How tall a group's bar is (h-11 along the top of the window, h-9 elsewhere), in pixels at the page's root font size. */
const barHeight = (top: boolean) => (top ? 2.75 : 2.25) * rem();

/**
 * The edge between two groups: dragged, it moves the room from one to the other; double-clicked, it shares it
 * equally; focused (with the stock handle's focus ring), the arrow keys move it. `next` names the panes of the group after it (the side panel, the view),
 * for whoever looks for the edge before one.
 */
function Edge({ h, next }: { h: dock.Handle; next?: string }) {
	const row = h.dir === "row";
	// From the shares as drawn, which keep each group at its least whatever the tree says: the edge moves from where it is seen.
	const by = (px: number) => store.resizeSplit(h.split, dock.dragEdge(h.sizes, h.index, px, h.length, h.least), true);
	return (
		<div
			data-slot="dock-edge"
			data-split={h.split}
			data-next={next}
			role="separator"
			tabIndex={0}
			aria-orientation={row ? "vertical" : "horizontal"}
			onKeyDown={(e) => {
				const step = e.shiftKey ? 100 : 20;
				const keys: Record<string, number> = row ? { ArrowLeft: -step, ArrowRight: step } : { ArrowUp: -step, ArrowDown: step };
				if (!(e.key in keys)) return;
				e.preventDefault();
				by(keys[e.key]);
			}}
			title={`Drag to make the groups ${row ? "wider or narrower" : "taller or shorter"}`}
			className={cn("absolute z-10 touch-none rounded-full after:absolute after:rounded-full after:bg-ring/0 after:transition-colors hover:after:bg-ring/50 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden", row ? "cursor-col-resize after:inset-y-2 after:left-1/2 after:w-0.5 after:-translate-x-1/2" : "cursor-row-resize after:inset-x-2 after:top-1/2 after:h-0.5 after:-translate-y-1/2")}
			style={{ left: h.rect.x, top: h.rect.y, width: h.rect.width, height: h.rect.height }}
			onPointerDown={(e) => {
				e.preventDefault();
				e.currentTarget.setPointerCapture(e.pointerId);
				const from = row ? e.clientX : e.clientY;
				const { sizes, length, least } = h;
				const move = (ev: PointerEvent, done: boolean) => store.resizeSplit(h.split, dock.dragEdge(sizes, h.index, (row ? ev.clientX : ev.clientY) - from, length, least), done);
				const el = e.currentTarget;
				const onMove = (ev: PointerEvent) => move(ev, false);
				const onUp = (ev: PointerEvent) => {
					move(ev, true);
					el.removeEventListener("pointermove", onMove);
					el.removeEventListener("pointerup", onUp);
					el.removeEventListener("pointercancel", onUp);
				};
				el.addEventListener("pointermove", onMove);
				el.addEventListener("pointerup", onUp);
				el.addEventListener("pointercancel", onUp);
			}}
			onDoubleClick={() => {
				const split = dock.findNode(store.dock, h.split);
				if (split?.kind === "split") store.resizeSplit(h.split, split.sizes.map(() => 1), true);
			}}
		/>
	);
}

/**
 * The window's tabs arranged in groups, as the layout says (dock.ts): each group a bar of tabs over the content of the
 * one in front. Everything is laid out here and drawn in one flat layer each (bars, bodies, edges), keyed by what it
 * is and never by where it lies: a tab moved to another group, or a group split in two, moves on the screen without
 * being drawn anew, so that a conversation keeps its place, the terminal its shell and the view its frame.
 */
function DockArea({ column }: { column: boolean }) {
	const s = useModel(store);
	const [room, setRoom] = useState<{ width: number; height: number }>();
	// A ref of a callback that stays the same, so that the room is observed once, from when it is there.
	const measure = useCallback((el: HTMLDivElement | null) => {
		if (!el) return;
		const observer = new ResizeObserver(([entry]) => {
			const { width, height } = entry.contentRect;
			setRoom((was) => (was && was.width === width && was.height === height ? was : { width, height }));
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	const dragging = s.dragging !== undefined || s.tabDragIn;
	// With no tab open the window says so, whatever panes were open: they come back with the next tab.
	const tree = s.tabs.length ? s.dock : NONE;
	const groups = dock.groupsOf(tree);
	const area = room ? { x: column ? 0 : GAP, y: 0, width: room.width - GAP - (column ? 0 : GAP), height: room.height - GAP } : undefined;
	const at = area ? dock.layout(tree, area, GAP, least()) : undefined;
	/** Where a group's body lies: under its bar. */
	const bodyOf = (id: string): dock.Rect | undefined => {
		const r = at?.groups.get(id);
		if (!r) return undefined;
		const bar = barHeight(at!.sides.get(id)?.top === true);
		return { x: r.x, y: r.y + bar, width: r.width, height: Math.max(0, r.height - bar) };
	};
	// Each group's tab in front, drawn in its body; sorted by what it is, so that the order of the layer never changes.
	const shown = groups.map((g) => ({ g, item: g.front && (paneOf(g.front) !== "view" || s.hasView) ? g.front : undefined })).sort((a, b) => (a.item ?? a.g.id).localeCompare(b.item ?? b.g.id));
	const byId = [...groups].sort((a, b) => a.id.localeCompare(b.id));
	return (
		<div ref={measure} data-slot="dock" data-dropping={dragging || undefined} className="relative min-h-0 min-w-0 flex-1">
			{at ? (
				<>
					{byId.map((g) => {
						const r = at.groups.get(g.id)!;
						return (
							<div key={g.id} className="absolute flex flex-col" style={{ left: r.x, top: r.y, width: r.width }}>
								<GroupBar g={g} sides={at.sides.get(g.id)!} column={column} />
							</div>
						);
					})}
					{shown.map(({ g, item }) => {
						const r = bodyOf(g.id)!;
						return (
							<div
								key={item ?? g.id}
								id={item === PANE.code ? "code-panel" : item === PANE.view ? "view-panel" : undefined}
								data-slot="group-body"
								data-group={g.id}
								data-focus={s.focus === g.id || undefined}
								// Clipped: in a window too small for every group's least, a group's content is cut at its edge and never drawn over its neighbour.
								className="absolute flex overflow-hidden"
								style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
								// A click into a group brings its tab to the front of the window. Not a focus: a conversation that comes
								// into view focuses its input by itself, which would take the window from the tab just moved.
								onPointerDownCapture={() => s.focus !== g.id && s.focusGroup(g.id)}
							>
								{item ? <Body item={item} /> : <NoTab />}
							</div>
						);
					})}
					{at.handles.map((h) => {
						const after = dock.findNode(tree, h.split);
						const panes = after?.kind === "split" ? dock.itemsOf(after.children[h.index + 1]).map(paneOf).filter(Boolean).join(" ") : "";
						return <Edge key={`${h.split}:${h.index}`} h={h} next={panes || undefined} />;
					})}
					{dragging ? byId.map((g) => <DropZones key={g.id} group={g.id} rect={bodyOf(g.id)!} sides={at.sides.get(g.id)!} area={area!} />) : null}
				</>
			) : null}
		</div>
	);
}

/** What the side bar's stock parts are told, whichever way the window is laid out. */
function SidebarSignals() {
	const s = useModel(store);
	const { isMobile, setOpenMobile, toggleSidebar } = useSidebar();
	// The menu's Toggle Sidebar goes to the stock toggle, which knows whether the side bar is a column or a sheet.
	useSignal("sidebar", toggleSidebar);
	// The sheet of a narrow window is put away once another tab comes to the front (from the sheet, the palette,
	// a menu), and when the window gets wide. A click on the conversation already in front puts it away too (ConversationRow).
	useEffect(() => setOpenMobile(false), [s.active?.id, isMobile, setOpenMobile]);
	return null;
}

function NoTab() {
	const s = store;
	const main = s.agents.find((a) => a.main) ?? s.agents[0];
	const [drop, setDrop] = useState(false);
	// A window with no tab has no row to drop a tab on: the whole of it takes a tab of another window.
	return (
		<Empty
			data-slot="no-tab"
			data-drop={drop || undefined}
			className="data-[drop]:bg-accent"
			onDragOver={(e) => {
				if (tabDragKind(e) !== "other") return;
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
				setDrop(true);
			}}
			onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDrop(false)}
			onDrop={(e) => {
				setDrop(false);
				if (tabDragKind(e) !== "other") return;
				e.preventDefault();
				void s.dropTab({ group: dock.groupsOf(s.dock)[0].id });
			}}
		>
			<EmptyHeader>
				<EmptyMedia variant="icon"><MessageSquareIcon /></EmptyMedia>
				<EmptyTitle>No tab is open</EmptyTitle>
				<EmptyDescription>All conversations are still in the side bar. Open one there, or start a new one.</EmptyDescription>
			</EmptyHeader>
			<EmptyContent className="flex-row justify-center">
				<Button onClick={() => void s.newConversation()}>New conversation<Kbd>{shortcut("⌘T")}</Kbd></Button>
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
	// A sign-in's choice has no dialog: its card is above the composer of its conversation.
	return isPick(req) ? null : <ApprovalDialog key={req.id} req={req} />;
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
				<ScrollArea className="-mx-4 max-h-[50vh] min-w-0 wrap-break-word flex min-h-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade">
					<dl className="flex flex-col gap-1.5 px-4 text-xs select-text">
						{keys.map(([k, about]) => (
							<div key={k} className="flex items-baseline gap-3">
								<dt className="w-24 flex-none"><Kbd>{shortcut(k)}</Kbd></dt>
								<dd className="text-muted-foreground">{about}</dd>
							</div>
						))}
						{COMMANDS.map((c) => (
							<div key={c.name} className="flex items-baseline gap-3">
								<dt className="w-24 flex-none font-mono">/{c.name}</dt>
								<dd className="text-muted-foreground">{c.about}{c.keys ? <> <Kbd>{shortcut(c.keys)}</Kbd></> : null}</dd>
							</div>
						))}
					</dl>
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
			return <HoverTooltip><TooltipTrigger render={<SidebarMenuButton onClick={() => s.cancelUpdateWait()} />}><HourglassIcon /><span className="min-w-0 flex-1 truncate">Restarts when the work is done</span><XIcon /></TooltipTrigger><TooltipContent>{`Pine ${u.version} is installed once no conversation is at work. Click to call it off: the update stays ready for a restart or a quit.`}</TooltipContent></HoverTooltip>;
		case "ready":
			return <HoverTooltip><TooltipTrigger render={<SidebarMenuButton variant="outline" onClick={() => void s.restartToUpdate()} />}><RotateCwIcon /><span className="min-w-0 flex-1 truncate">Restart to update</span></TooltipTrigger><TooltipContent>{`Pine ${u.version} is downloaded. Pine quits, puts the new app in place of this one (${u.mine}) and opens again, with the pine it started.`}</TooltipContent></HoverTooltip>;
		case "downloading":
			return <SidebarMenuButton disabled><DownloadIcon /><span className="min-w-0 flex-1 truncate">Downloading Pine {u.version}…</span></SidebarMenuButton>;
		case "link":
			return <HoverTooltip><TooltipTrigger render={<SidebarMenuButton variant="outline" onClick={() => void bridge.open(u.url)} />}><ArrowUpIcon /><span className="min-w-0 flex-1 truncate">Pine {u.version} is available</span><ExternalLinkIcon /></TooltipTrigger><TooltipContent>{`${u.reason ? `${u.reason} ` : ""}This is Pine ${u.mine}. Opens the release's page on GitHub in your browser. The new app is ${newApp().what} there: ${newApp().how}.`}</TooltipContent></HoverTooltip>;
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
						{u.reason ? <DialogDescription className="select-text">{u.reason}</DialogDescription> : null}
						<DialogDescription className="select-text">This is Pine {u.mine}. The new app is {newApp().what} on the release's page on GitHub: {newApp().how}. Your pine home, with your agents, conversations and settings, stays as it is.</DialogDescription>
					</DialogHeader>
					<p className="cursor-auto font-mono text-xs text-faint select-text">{u.url}</p>
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
					<DialogDescription className="select-text">{text} Your pine home, with your agents, conversations and settings, stays as it is.</DialogDescription>
				</DialogHeader>
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
					<DialogDescription className="select-text">In your browser's menu, choose Add to Home screen. Pine then opens like an app and connects to {s.service.host ? s.nameOf(s.service.host) : "your computer"} by itself: it keeps this browser's key, so there is nothing to pair again.</DialogDescription>
				</DialogHeader>
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
					<DialogDescription className="select-text">Your agents open pages that need a real browser with one that pine fetches for itself. Each version of pine uses a specific browser build, and the one for this version is not here yet: it was never fetched, or it is the build of an older pine. It is about 600 MB and is fetched once. Until then the browser tools do not work; web search and reading a page do.</DialogDescription>
				</DialogHeader>
				{s.initLines.length ? <Printed sm text={s.initLines.slice(-12).join("\n")} /> : null}
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

const PANEL_WIDTH_KEYS = { "sidebar-panel": "sidebar" } as const;

/** Remembers how wide a panel is, in pixels, for the next start. Only what the owner did is kept: a narrow window squeezes a panel without changing what it is set to. */
const keepWidth = (layout: Layout, panel: keyof typeof PANEL_WIDTH_KEYS, key: string) => {
	// The layout is in shares of the room the panels have together, and is told before the panels are
	// drawn at their new widths (after a key): the room is the same before and after.
	const group = document.getElementById(panel)?.parentElement;
	const share = layout[panel];
	if (!group || share === undefined) return;
	const room = [...group.children].filter((el) => el.hasAttribute("data-panel")).reduce((sum, el) => sum + el.getBoundingClientRect().width, 0);
	const px = Math.round((share * room) / 100);
	store.setPanelWidth(PANEL_WIDTH_KEYS[panel], px);
	if (typeof bridge.windowLayout !== "function") localStorage.setItem(key, String(px));
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
	const tabLabel = !ready || !tab ? undefined : tab.kind === "events" ? "Events" : tab.kind === "settings" ? "Settings" : tab.kind === "manual" ? "Manual" : tab.kind === "task" ? `${tab.agent} #${tab.task}` : tab.session === "main" ? tab.agent : `${tab.agent} · ${s.titleKnown(tab.agent, tab.session) ? s.titleOf(tab.agent, tab.session) : tab.session}`;
	const windowTitle = [tabLabel, s.remote, "Pine"].filter(Boolean).join(" — ");
	useEffect(() => {
		document.title = windowTitle;
	}, [windowTitle]);
	const side = usePanelRef();
	// Narrower than stock's breakpoint (Tailwind's `md`), the side bar lies over the page instead of beside it, as stock's
	// own sheet. (The panel beside a conversation does the same below `lg`: CodePanel.tsx.)
	const narrow = useIsMobile();
	const column = s.sidebar && !narrow;
	// Drawn again when the window crosses the width where the groups give way to one tab at a time and the panes to sheets (`store.sheets`).
	useMediaQuery(ROOM);
	// The window itself: what shows between and around the panels. On a Mac the system's material lies behind it.
	return (
		<div className={cn("flex h-full text-sm", s.platform === "darwin" ? "bg-sidebar" : "bg-muted")}>
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
								<ResizablePanel id="sidebar-panel" className="flex" panelRef={side} defaultSize={store.widthOf("sidebar") ?? (Number(localStorage.getItem(SIDE_KEY)) || SIDE_WIDTH)} minSize={190} maxSize={460} groupResizeBehavior="preserve-pixel-size">
									<Sidebar />
								</ResizablePanel>
								<ResizableHandle className="bg-transparent" disableDoubleClick onDoubleClick={() => (side.current?.resize(SIDE_WIDTH), store.setPanelWidth("sidebar", SIDE_WIDTH), typeof bridge.windowLayout !== "function" && localStorage.setItem(SIDE_KEY, String(SIDE_WIDTH)))} title="Drag to make the side bar wider or narrower" />
							</>
						) : null}
						<ResizablePanel id="main" className="flex">
							<SidebarSignals />
							{s.sheets ? (
								// A narrow window: one row of all the tabs, the one in front under it, and a pane as a sheet over it.
								<div className="flex min-w-0 flex-1 flex-col">
									<TitleBar />
									<div data-slot="room" className={cn("flex min-h-0 flex-1 pr-1.5 pb-1.5", !column && "pl-1.5")}>
										{tab ? <Body item={tab.item} /> : <NoTab />}
										{s.shown("code") ? <Body item={PANE.code} /> : null}
										{s.shown("view") ? <ViewAside /> : null}
									</div>
								</div>
							) : (
								<DockArea column={column} />
							)}
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
