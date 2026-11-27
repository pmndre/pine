// The panel beside a conversation: the files with an editor, what changed in the folder (git, or
// what the last message changed), what the agent's tool calls printed, the owner's terminal, the
// agent itself (AgentView.tsx), and, while there is something in them, what its commands left
// running and the board it shares with its sub-agents (Board.tsx). Everything is read through the control API; a file is written through it too, by
// the daemon, inside a sandbox that reaches only this folder.
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, ExternalLinkIcon, FileIcon, FolderIcon, GitBranchIcon, PencilIcon, PlayIcon, RotateCwIcon, SaveIcon, SearchIcon, SquareTerminalIcon, TextSearchIcon, Undo2Icon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Fragment, useEffect, useRef, useState } from "react";
import { useMediaQuery } from "usehooks-ts";
import { CodeBlock, CodeBlockContent, CodeBlockLine } from "@/components/ui/code-block";
import { Printed } from "@/components/printed";
import { SideSheet } from "@/components/side-sheet";
import { api, type Change, media, type TranscriptEntry } from "./api.ts";
import { AgentView } from "./AgentView.tsx";
import { Editor } from "./Editor.tsx";
import { BoardTab } from "./Board.tsx";
import { bridge } from "./bridge.ts";
import { Steps } from "./Conversation.tsx";
import { type CodeView, mediaKind, ROOM, store, type Tab, useModel, useSignal } from "./model.ts";
import { clock, errText, oneLine, plural, short, size, tilde, took } from "./text.ts";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { CODE_LINES, LISTBOX, onPick, rowClass, TREE_ITEM } from "./lists.tsx";
import { Listbox, ListboxItem } from "@ui-sdk/react/listbox";
import { Tree, TreeGroup, TreeItem, TreeItemLabel } from "@ui-sdk/react/tree";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useLoad } from "./use-load.ts";
import { TerminalView } from "./Terminal.tsx";
import { BrowserView } from "./Browser.tsx";
import { Pulse } from "@/components/pulse";
import { FileIcon as FileKind } from "@/components/file-icon";
import { SHOW_IN, useFileActions } from "./FileActions.tsx";
import { Skeleton } from "@/components/ui/skeleton";
import { HoverTooltip } from "@/components/hover-tooltip";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { cn } from "@/lib/utils";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

/** What a file's place is shown in, by the name the system gives its file manager. */

// The panel's parts: a bar of controls with a line under it, and what scrolls below: a stock
// ScrollArea that fades where it is cut (scroll-fade sits on its viewport, the element that
// scrolls), a flex column so that its viewport shrinks to it, and a sideways bar where a diff can
// be wider than the panel. Inside, a flex column at least its height, for an Empty centred with `m-auto`.
export const SUB = "flex min-h-9 flex-none items-center gap-1.5 border-b border-line-soft px-2.5 py-1.5 text-sm text-muted-foreground";
const PICTURE = "block max-h-80 max-w-full rounded-lg border sm:max-w-md";
const STATUS: Record<string, string> = { M: "text-warn", A: "text-add", "?": "text-add", D: "text-del", R: "text-info" };

/**
 * The color git gives a path of the folder, for its icon in the tree and the search: a file by its
 * own status, a folder by what is in it (new where all of it is new, changed otherwise), as an
 * editor's tree marks them. Nothing for what git does not name, or outside a repository.
 */
function gitTones(data?: { root: string; top?: string; files: Change[] }): (path: string, dir?: boolean) => string | undefined {
	if (!data?.top || !data.files.length) return () => undefined;
	// git names a path from the top of the repository, which the folder may lie below.
	const below = data.root.startsWith(`${data.top}/`) ? `${data.root.slice(data.top.length + 1)}/` : "";
	const status = new Map(data.files.map((f) => [f.path, f.status]));
	// A folder git does not know yet is named once, with a "/" at its end, for everything in it.
	const newDirs = data.files.filter((f) => f.path.endsWith("/"));
	return (p, dir) => {
		const full = below + p;
		const own = status.get(full) ?? status.get(`${full}/`) ?? newDirs.find((f) => full.startsWith(f.path))?.status;
		if (own) return STATUS[own];
		if (!dir) return undefined;
		const inside = data.files.filter((f) => f.path.startsWith(`${full}/`));
		return inside.length ? (inside.every((f) => f.status === "?" || f.status === "A") ? STATUS.A : STATUS.M) : undefined;
	};
}

// What a line of a unified diff is: a change is drawn by the stock line variants, which put the
// sign in front themselves, so its own sign is taken off; a hunk header is highlighted; the
// lines about the file itself are muted. The stock variants mark a line by its sign and a tint
// (added is the neutral muted one), so pine's diff colors are laid over them.
const META = ["+++", "---", "diff ", "index ", "new file", "deleted file", "similarity", "rename "];

/** A unified diff, colored line by line. */
export function Diff({ text }: { text: string }) {
	const lines = text.split("\n");
	return (
		<CodeBlock className="m-2 w-auto select-text">
			<CodeBlockContent className={CODE_LINES}>
				{lines.map((l, i) => {
					if (l.startsWith("@@")) return <CodeBlockLine key={i} variant="highlighted">{l}</CodeBlockLine>;
					if (META.some((m) => l.startsWith(m))) return <CodeBlockLine key={i} className="text-muted-foreground">{l}</CodeBlockLine>;
					if (l.startsWith("+")) return <CodeBlockLine key={i} variant="added">{l.slice(1)}</CodeBlockLine>;
					if (l.startsWith("-")) return <CodeBlockLine key={i} variant="removed">{l.slice(1)}</CodeBlockLine>;
					return <CodeBlockLine key={i}>{l.startsWith(" ") ? l.slice(1) : l}</CodeBlockLine>;
				})}
			</CodeBlockContent>
		</CodeBlock>
	);
}

/** A path in the folder, a crumb per folder and the file last. */
function PathCrumbs({ path, children }: { path: string; children?: React.ReactNode }) {
	const parts = path.split("/");
	const last = parts.length - 1;
	return (
		<Breadcrumb className="min-w-0 flex-1" title={path}>
			<BreadcrumbList className="flex-nowrap">
				{parts.map((part, i) => (
					<Fragment key={i}>
						{i ? <BreadcrumbSeparator /> : null}
						<BreadcrumbItem className={i === last ? "min-w-0" : undefined}>
							{i === last ? <BreadcrumbPage className="truncate"><span className="font-mono">{part}</span>{children}</BreadcrumbPage> : <span className="font-mono">{part}</span>}
						</BreadcrumbItem>
					</Fragment>
				))}
			</BreadcrumbList>
		</Breadcrumb>
	);
}

function ChangeRowSkeleton() {
	return (
		<div data-slot="change-row-skeleton" className={rowClass()} aria-hidden>
			<Skeleton className="size-4 flex-none" />
			<Skeleton className="h-4 w-24" />
			<Skeleton className="h-4 min-w-0 flex-1" />
			<Skeleton className="h-4 w-8" />
		</div>
	);
}

/** A few line bars where a diff, a file or a list is read. */
function LinesSkeleton({ rows = 6 }: { rows?: number }) {
	return (
		<div data-slot="lines-skeleton" className="flex flex-col gap-2 p-3" aria-hidden>
			{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-4" style={{ width: `${[85, 60, 75, 40, 90, 55][i % 6]}%` }} />)}
		</div>
	);
}

/** One row of the file tree: a folder (open or not) or a file with its size, indented by its depth. */
export function DirRow(props: { name: string; dir: boolean; size: number; depth: number; open?: boolean; active?: boolean; /** Cut, and waiting to be pasted: drawn faded. */ cut?: boolean; /** git's color for it (`gitTones`). */ tone?: string; /** One of the agent's own files (AGENTS.md and the others): its name drawn grey. */ own?: boolean; skeleton?: false } | { name?: undefined; dir?: undefined; size?: undefined; depth: number; open?: undefined; active?: undefined; /** While a folder is read: a row of its shape. */ skeleton: true }) {
	const indent = { paddingLeft: `calc(var(--spacing) * ${2.5 + props.depth * 3.5})` };
	if (props.skeleton || props.name === undefined)
		return (
			<div data-slot="dir-row-skeleton" className={rowClass()} style={indent} aria-hidden>
				<span className="w-3.5 flex-none" />
				<Skeleton className="size-4 flex-none" />
				<Skeleton className="h-4 w-28" />
			</div>
		);
	const { name, dir, size: bytes, open, active, cut, tone, own } = props;
	return (
		<TreeItemLabel className={cn(rowClass(active), cut && "opacity-50")} style={indent}>
			{dir ? (open ? <ChevronDownIcon className="size-3.5 shrink-0 text-faint" /> : <ChevronRightIcon className="size-3.5 shrink-0 text-faint" />) : <span className="w-3.5 flex-none" />}
			<FileKind name={name} dir={dir} open={open} tone={tone} />
			<span className={cn("min-w-0 flex-1 truncate", own && "text-muted-foreground")}>{name}</span>
			{!dir ? <span className="text-faint">{size(bytes)}</span> : null}
		</TreeItemLabel>
	);
}

// ---- its views -------------------------------------------------------------------------------------

/** One changed file in a list: its status, name, folder and lines added and removed. */
export function ChangeRow(props: { c: Change; skeleton?: false } | { c?: undefined; /** While the list loads: a row of its shape. */ skeleton: true }) {
	if (props.skeleton || !props.c) return <ChangeRowSkeleton />;
	const c = props.c;
	const at = c.path.lastIndexOf("/");
	return (
		<ListboxItem value={c.path} label={c.path.slice(at + 1)} className={rowClass()} title={c.path}>
			<span className={cn("w-4 flex-none text-center font-mono font-semibold", STATUS[c.status])}>{c.status === "?" ? "U" : c.status}</span>
			<span className="truncate">{c.path.slice(at + 1)}</span>
			<span className="min-w-0 flex-1 truncate text-faint">{at > 0 ? c.path.slice(0, at) : ""}</span>
			{c.added ? <span className="font-mono text-add">+{c.added}</span> : null}
			{c.removed ? <span className="font-mono text-del">−{c.removed}</span> : null}
		</ListboxItem>
	);
}

/** What differs from the last commit, or from before the owner's last message. */
function Changes({ tab, turn, openFile }: { tab: Tab; turn: boolean; openFile: (file: string) => void }) {
	const list = useLoad(async () => (turn ? { ...(await api.turn(tab.agent, tab.session)), repo: true, branch: undefined as string | undefined, worktree: undefined } : { ...(await api.changes(tab.agent, tab.session)), note: undefined as string | undefined, prompt: undefined as string | undefined }), [tab.key, tab.codeTick, turn]);
	const [file, setFile] = useState<string>();
	const diff = useLoad(async () => (file ? (turn ? api.turnDiff(tab.agent, tab.session, file) : api.diff(tab.agent, tab.session, file)) : undefined), [tab.key, file, tab.codeTick, turn]);
	useEffect(() => setFile(undefined), [tab.key, turn]);
	const data = list.data;
	// A change is named from the top of its repository; a file is opened by its path in the folder.
	const inFolder = (p: string) => {
		const top = (data as { top?: string } | undefined)?.top;
		const root = data?.root;
		const prefix = top && root && root !== top && root.startsWith(`${top}/`) ? `${root.slice(top.length + 1)}/` : "";
		return prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p;
	};
	if (list.error) return <Empty><EmptyHeader><EmptyMedia variant="icon">{turn ? <Undo2Icon /> : <GitBranchIcon />}</EmptyMedia><EmptyTitle>{turn ? "Could not load the last message" : "No changes to show"}</EmptyTitle><EmptyDescription>{list.error}</EmptyDescription></EmptyHeader></Empty>;
	if (!data) return <div className="flex flex-col">{Array.from({ length: 5 }, (_, i) => <ChangeRow key={i} skeleton />)}</div>;
	if (!turn && !data.repo) return <Empty><EmptyHeader><EmptyMedia variant="icon"><GitBranchIcon /></EmptyMedia><EmptyTitle>Not a git repository</EmptyTitle><EmptyDescription>This conversation's folder has no git history, so there are no changes to show. The Files view lists the files.</EmptyDescription></EmptyHeader></Empty>;
	if (file)
		return (
			<>
				<div className={SUB}>
					<HoverTooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={() => setFile(undefined)} aria-label="Back to the list"><ChevronLeftIcon /></Button>} /><TooltipContent>Back to the list</TooltipContent></HoverTooltip>
					<PathCrumbs path={file} />
					<Button variant="ghost" size="xs" onClick={() => openFile(inFolder(file))}><PencilIcon data-icon="inline-start" />Edit</Button>
				</div>
				<ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade"><div className="flex min-h-full flex-col">{diff.data ? <><Diff text={diff.data.diff || "No difference."} />{diff.data.truncated ? <p className="px-3 py-2.5 text-sm text-muted-foreground select-text">… the rest of this diff is too long to show.</p> : null}</> : diff.error ? <Empty><EmptyHeader><EmptyMedia variant="icon"><GitBranchIcon /></EmptyMedia><EmptyTitle>Could not show this diff</EmptyTitle><EmptyDescription>{diff.error}</EmptyDescription></EmptyHeader></Empty> : <LinesSkeleton />}</div><ScrollBar orientation="horizontal" /></ScrollArea>
			</>
		);
	return (
		<>
			<div className={SUB}>
				{turn ? <><Undo2Icon className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{data.prompt ? `Since “${short(oneLine(data.prompt), 60)}”` : "Since your last message"}</span>{data.files.length ? <Button variant="outline" size="xs" onClick={() => void store.undo(tab, false)}>Undo</Button> : null}</> : <><GitBranchIcon className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{data.branch || "no branch"}{data.worktree ? ` · ${data.worktree.ahead} ahead of ${data.worktree.base}${data.worktree.behind ? `, ${data.worktree.behind} behind` : ""}` : ""} · {data.files.length ? plural(data.files.length, "changed file") : "clean"}</span>{data.worktree ? <Button variant="outline" size="xs" onClick={() => void store.worktreeMenu(tab)}>{data.worktree.ahead && !data.worktree.dirty ? "Merge…" : "Worktree…"}</Button> : null}</>}
				<HoverTooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={list.reload} aria-label="Refresh"><RotateCwIcon /></Button>} /><TooltipContent>Refresh</TooltipContent></HoverTooltip>
			</div>
			<ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade"><div className="flex min-h-full flex-col">
				{data.note ? <p className="px-3 py-2.5 text-sm text-muted-foreground select-text">{data.note}</p> : null}
				{data.files.length ? <Listbox aria-label={turn ? "Files the last message changed" : "Changed files"} className="outline-none" {...LISTBOX} onValueChange={onPick(setFile)}>{data.files.map((c) => <ChangeRow key={c.path} c={c} />)}</Listbox> : <Empty><EmptyHeader><EmptyMedia variant="icon"><CheckIcon /></EmptyMedia><EmptyTitle>{turn ? "The last message changed no files" : "Nothing changed since the last commit"}</EmptyTitle></EmptyHeader></Empty>}
				{data.more ? <p className="px-3 py-2.5 text-sm text-muted-foreground select-text">… and more.</p> : null}
			</div></ScrollArea>
		</>
	);
}

interface TreeState {
	open: Set<string>;
	dirs: Map<string, Array<{ name: string; dir: boolean; size: number }>>;
	/** Why a folder could not be read, by folder, so a failed read is not taken for an empty folder. */
	failed: Map<string, string>;
	file?: string;
	/** The rows selected in the tree and the search results, for the menu and the keys (`useFileActions`). */
	selected: string[];
	/** Whether the search looks inside files too, besides their names. */
	contents: boolean;
	/** What was typed in a file and not saved, and what it was typed over, by file. Kept here and not in the editor's
	 *  state because the panel's body is mounted again when the window crosses the width where it becomes a sheet. */
	edits: Map<string, { draft?: string; base?: string }>;
}
const trees = new Map<string, TreeState>();
const treeOf = (key: string): TreeState => trees.get(key) ?? (trees.set(key, { open: new Set(), dirs: new Map(), failed: new Map(), selected: [], contents: false, edits: new Map() }), trees.get(key)!);

/** What a row of the tree or the search results does on a press, besides being selected: shared by both. */
interface Rows {
	pick: (file: string) => void;
	isCut: (path: string) => boolean;
	/** A touch screen, where a double tap is not a habit: a tap opens a file. */
	coarse: boolean;
	/** git's color for a path (`gitTones`). */
	tone: (path: string, dir?: boolean) => string | undefined;
	/** One of the agent's own files, which pine reads as instructions: drawn grey. */
	own: (path: string) => boolean;
}
const held = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }) => e.shiftKey || e.metaKey || e.ctrlKey || e.altKey;

/**
 * The folder's files as a tree. A click selects a row (Shift adds the rows between, ⌘ or Ctrl one more), a
 * double click or Enter opens a file, a click or Enter opens and closes a folder: as in an editor's tree.
 */
function FileTree({ tab, tick, rows, select, isDir, redraw }: { tab: Tab; tick: number; rows: Rows; select: (paths: string[]) => void; isDir: (path: string) => boolean; redraw: () => void }) {
	const state = treeOf(tab.key);
	const entries = state.dirs.get("");
	const failed = state.failed.get("");
	const toggle = (full: string) => (state.open.has(full) ? state.open.delete(full) : state.open.add(full), redraw());
	return (
		<>
			{failed ? <Empty><EmptyHeader><EmptyMedia variant="icon"><FolderIcon /></EmptyMedia><EmptyTitle>Could not read this folder</EmptyTitle><EmptyDescription>{failed}</EmptyDescription></EmptyHeader></Empty> : null}
			{entries && !entries.length ? <Empty><EmptyHeader><EmptyMedia variant="icon"><FolderIcon /></EmptyMedia><EmptyTitle>This folder is empty</EmptyTitle></EmptyHeader></Empty> : null}
			<Tree
				aria-label="Files"
				className="outline-none"
				mode="multiple"
				value={state.selected}
				onValueChange={(v) => select(Array.isArray(v) ? v : [])}
				expanded={[...state.open]}
				onExpandedChange={(open) => ((state.open = new Set(open)), redraw())}
				expandOnPress={false}
				onAction={(full, { event }) => {
					// A click that adds to the selection does only that; Enter or a plain click opens a folder, Enter opens a file.
					const key = event instanceof KeyboardEvent;
					if (!key && event instanceof MouseEvent && held(event)) return;
					if (isDir(full)) return toggle(full);
					if (key || rows.coarse) rows.pick(full);
				}}
			>
				<Dir tab={tab} dir="" depth={0} tick={tick} onLoad={redraw} rows={rows} />
			</Tree>
		</>
	);
}

/** A folder's rows in the tree, read when it opens; `onLoad` redraws the tree around once they are read. */
function Dir({ tab, dir, depth, tick, onLoad, rows }: { tab: Tab; dir: string; depth: number; tick: number; onLoad: () => void; rows: Rows }) {
	const state = treeOf(tab.key);
	const read = useLoad(() => api.tree(tab.agent, tab.session, dir), [tab.key, dir, tick]);
	useEffect(() => {
		if (read.loading) return;
		if (read.data) state.dirs.set(dir, read.data.entries), state.failed.delete(dir);
		else state.failed.set(dir, read.error ?? ""), state.dirs.delete(dir);
		onLoad();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [read.loading, read.data, read.error]);
	const failed = state.failed.get(dir);
	if (failed && dir) return <p className="py-2.5 pr-3 text-sm wrap-anywhere text-faint select-text" style={{ paddingLeft: `calc(var(--spacing) * ${2.5 + depth * 3.5})` }}>{failed}</p>;
	if (failed !== undefined) return null;
	const entries = state.dirs.get(dir);
	if (!entries) return <>{Array.from({ length: dir ? 2 : 6 }, (_, i) => <DirRow key={i} depth={depth} skeleton />)}</>;
	return (
		<>
			{entries.map((e) => {
				const full = dir ? `${dir}/${e.name}` : e.name;
				const open = state.open.has(full);
				return (
					<TreeItem key={full} value={full} label={e.name} branch={e.dir} className={TREE_ITEM} data-path={full} onDoubleClick={e.dir ? undefined : (ev: React.MouseEvent) => held(ev) || rows.pick(full)}>
						<DirRow name={e.name} dir={e.dir} size={e.size} depth={depth} open={open} active={state.file === full} cut={rows.isCut(full)} tone={rows.tone(full, e.dir)} own={!e.dir && rows.own(full)} />
						{e.dir ? <TreeGroup>{open ? <Dir tab={tab} dir={full} depth={depth + 1} tick={tick} onLoad={onLoad} rows={rows} /> : null}</TreeGroup> : null}
					</TreeItem>
				);
			})}
		</>
	);
}

/** One file, to read and to change. What the agent changes meanwhile is shown unless the owner has typed. */
function FileView({ tab, file, close }: { tab: Tab; file: string; close: () => void }) {
	const disk = useLoad(() => api.file(tab.agent, tab.session, file), [tab.key, file, tab.codeTick]);
	const edits = treeOf(tab.key).edits;
	const [, redraw] = useState(0);
	const edit = (patch: { draft?: string; base?: string }) => (edits.set(file, { ...edits.get(file), ...patch }), redraw((n) => n + 1));
	const { draft, base } = edits.get(file) ?? {};
	const setDraft = (draft?: string) => edit({ draft });
	const setBase = (base?: string) => edit({ base });
	const [saving, setSaving] = useState(false);
	const kind = mediaKind(file);
	const text = disk.data?.text;
	const dirty = draft !== undefined && draft !== base;
	// What is on disk becomes what the editor shows, as long as nothing was typed.
	useEffect(() => {
		if (text !== undefined && !dirty) edit({ base: text, draft: undefined });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [text]);
	// Leaving the file gives up what was typed in it.
	const leave = () => (edits.delete(file), close());
	const save = async () => {
		if (!dirty || saving) return;
		setSaving(true);
		try {
			await api.writeFile(tab.agent, tab.session, file, draft!);
			setBase(draft);
			tab.codeTick++;
			tab.touch();
			store.flash(`Saved ${file}.`, "good", 1800);
		} catch (e) {
			store.flash(`Not saved: ${errText(e)}`, "bad");
		}
		setSaving(false);
	};
	useSignal("save", () => void save());
	// Leaving with what was typed and not saved is asked first.
	const [leaving, setLeaving] = useState(false);
	const changedOnDisk = dirty && text !== undefined && text !== base;
	const root = tab.folder ?? tab.workspace;
	return (
		<>
			<div className={SUB}>
				<HoverTooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={() => (dirty ? setLeaving(true) : leave())} aria-label="Back to the files"><ChevronLeftIcon /></Button>} /><TooltipContent>Back to the files</TooltipContent></HoverTooltip>
				<AlertDialog open={leaving} onOpenChange={setLeaving}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Leave {file} without saving your changes?</AlertDialogTitle>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogPrimitive.Close render={<AlertDialogAction variant="destructive" />} onClick={leave}>Leave</AlertDialogPrimitive.Close>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
				<PathCrumbs path={file}>{dirty ? <span className="text-warn"> ●</span> : null}</PathCrumbs>
				{disk.data?.truncated ? <Badge variant="outline">too large to edit</Badge> : null}
				{root && !store.remote ? <HoverTooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={() => void bridge.reveal(`${root}/${file}`)} aria-label={SHOW_IN[store.platform] ?? SHOW_IN.darwin}><ExternalLinkIcon /></Button>} /><TooltipContent>{SHOW_IN[store.platform] ?? SHOW_IN.darwin}</TooltipContent></HoverTooltip> : null}
				{kind || disk.data?.binary ? null : <Button variant={dirty ? "default" : "ghost"} size="xs" disabled={!dirty || saving} onClick={() => void save()}><SaveIcon data-icon="inline-start" />Save</Button>}
			</div>
			{changedOnDisk ? (
				<Alert className="m-2 w-auto">
					<AlertDescription>This file changed on disk while you were typing.</AlertDescription>
					<AlertAction>
						<Button variant="outline" size="xs" onClick={() => edit({ base: text, draft: undefined })}>Load the new version</Button>
					</AlertAction>
				</Alert>
			) : null}
			{/* The editor scrolls itself (CodeMirror draws only the lines in view): around it nothing scrolls. */}
			{!kind && !disk.error && disk.data && !disk.data.binary ? (
				<div className="flex min-h-0 flex-1 flex-col">
					<Editor file={file} text={dirty ? draft! : (base ?? text ?? "")} readOnly={disk.data.truncated} onChange={setDraft} onSave={() => void save()} />
				</div>
			) : (
			<ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade"><div className="flex min-h-full flex-col">
				{kind ? (
					<div className="p-3.5">{kind === "image" ? <img className={PICTURE} src={media.workspace(tab.agent, file, tab.session)} alt={file} /> : kind === "video" ? <video className="block max-h-90 max-w-full rounded-lg bg-black sm:max-w-lg" src={media.workspace(tab.agent, file, tab.session)} controls /> : <audio className="block w-full max-w-md" src={media.workspace(tab.agent, file, tab.session)} controls />}</div>
				) : disk.error ? (
					<Empty><EmptyHeader><EmptyMedia variant="icon"><FileIcon /></EmptyMedia><EmptyTitle>Could not show this file</EmptyTitle><EmptyDescription>{disk.error}</EmptyDescription></EmptyHeader></Empty>
				) : !disk.data ? (
					<LinesSkeleton rows={12} />
				) : (
					<Empty><EmptyHeader><EmptyMedia variant="icon"><FileIcon /></EmptyMedia><EmptyTitle>A binary file</EmptyTitle><EmptyDescription>{size(disk.data.size)}. It is not shown as text.</EmptyDescription></EmptyHeader></Empty>
				)}
			</div></ScrollArea>
			)}
		</>
	);
}

function Files({ tab, file, setFile }: { tab: Tab; file?: string; setFile: (file?: string) => void }) {
	const state = treeOf(tab.key);
	const [tick, setTick] = useState(0);
	const [, redrawn] = useState(0);
	const redraw = () => redrawn((n) => n + 1);
	const [query, setQuery] = useState("");
	const q = query.trim();
	// Names first, then (with the toggle) files whose text holds it; a file found both ways shows its line.
	const found = useLoad(async () => {
		if (!q) return undefined;
		const [names, texts] = await Promise.all([api.find(tab.agent, tab.session, q), state.contents ? api.grep(tab.agent, tab.session, q) : undefined]);
		const rows = names.files.map((path) => ({ path, line: 0, text: "" }));
		for (const t of texts?.files ?? []) {
			const named = rows.find((r) => r.path === t.path);
			if (named) Object.assign(named, t);
			else rows.push(t);
		}
		return rows;
	}, [tab.key, q, state.contents, tick]);
	useEffect(() => setTick((n) => n + 1), [tab.codeTick]);
	// What git says of the folder's files, for the color of their icons; nothing where it is no repository.
	const git = useLoad(() => api.changes(tab.agent, tab.session).catch(() => undefined), [tab.key, tick]);
	const coarse = useMediaQuery("(pointer: coarse)");
	const root = tab.folder ?? tab.workspace;
	const isDir = (full: string) => {
		const at = full.lastIndexOf("/");
		return Boolean(state.dirs.get(at > 0 ? full.slice(0, at) : "")?.find((e) => e.name === full.slice(at + 1))?.dir);
	};
	const select = (paths: string[]) => ((state.selected = paths), redraw());
	const actions = useFileActions({
		tab,
		root,
		isDir,
		open: setFile,
		selected: state.selected,
		select,
		changed: (moved, gone, reveal) => {
			const lost = (p: string) => gone.some((g) => p === g || p.startsWith(`${g}/`));
			const now = (p: string) => {
				for (const [from, to] of moved) if (p === from || p.startsWith(`${from}/`)) return to + p.slice(from.length);
				return p;
			};
			state.open = new Set([...state.open].filter((p) => !lost(p)).map(now));
			// The folders down to a new name are opened, so that it shows.
			for (let at = reveal ?? ""; at; at = at.includes("/") ? at.slice(0, at.lastIndexOf("/")) : "") state.open.add(at);
			state.selected = state.selected.filter((p) => !lost(p)).map(now);
			if (state.file) state.file = lost(state.file) ? undefined : now(state.file);
			for (const [p, typed] of [...state.edits]) {
				state.edits.delete(p);
				if (!lost(p)) state.edits.set(now(p), typed);
			}
			redraw();
		},
	});
	const rows: Rows = { pick: setFile, isCut: actions.isCut, coarse, tone: gitTones(git.data), own: actions.own };
	if (file) return <FileView tab={tab} file={file} close={() => setFile(undefined)} />;
	const inside = state.contents ? "Search inside files too: on" : "Search inside files too";
	return (
		<>
			<div className={SUB}>
				<InputGroup>
					<InputGroupAddon>
						<SearchIcon />
					</InputGroupAddon>
					<InputGroupInput aria-label={state.contents ? "Find a file by name or contents" : "Find a file"} placeholder={`Find a file${state.contents ? " or text" : ""}${root ? ` in ${tilde(root)}` : ""}`} value={query} onChange={(e) => setQuery(e.target.value)} />
					<InputGroupAddon align="inline-end">
						<HoverTooltip>
							<TooltipTrigger render={<InputGroupButton size="icon-xs" variant={state.contents ? "secondary" : "ghost"} aria-pressed={state.contents} aria-label="Search inside files too" onClick={() => ((state.contents = !state.contents), redraw())} />}>
								<TextSearchIcon />
							</TooltipTrigger>
							<TooltipContent>{inside}</TooltipContent>
						</HoverTooltip>
					</InputGroupAddon>
				</InputGroup>
				<HoverTooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={() => setTick((n) => n + 1)} aria-label="Refresh"><RotateCwIcon /></Button>} /><TooltipContent>Refresh</TooltipContent></HoverTooltip>
			</div>
			<ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade">
				{/* A right click beside the rows is about the folder itself: new files go to its top. */}
				<div className="flex min-h-full flex-col" onContextMenu={(e) => void actions.menu(e)} onKeyDown={actions.keys} onCopy={actions.onCopy} onCut={actions.onCut} onPaste={actions.onPaste}>
					{q ? (
						found.data?.length ? (
							<Listbox
								aria-label="Matching files"
								className="outline-none"
								multiple
								activation="automatic"
								value={state.selected}
								onValueChange={(v) => select(Array.isArray(v) ? v : [])}
								onKeyDown={(e) => {
									// Enter opens the row that has the keyboard, as in the tree.
									const at = (e.target as Element).closest("[data-path]")?.getAttribute("data-path");
									if (e.key === "Enter" && !held(e) && at) (e.preventDefault(), setFile(at));
								}}
							>
								{found.data.map((f) => (
									<ListboxItem key={f.path} value={f.path} label={f.path} data-path={f.path} className={cn(rowClass(), rows.isCut(f.path) && "opacity-50")} onDoubleClick={(e) => held(e) || setFile(f.path)} onClick={coarse ? () => setFile(f.path) : undefined}>
										<FileKind name={f.path.slice(f.path.lastIndexOf("/") + 1)} tone={rows.tone(f.path)} />
										<span className={cn(f.line ? "max-w-3/5 shrink-0 truncate" : "min-w-0 truncate", rows.own(f.path) && "text-muted-foreground")}>{f.path}</span>
										{f.line ? <span className="min-w-0 flex-1 truncate font-mono text-faint">{f.line}: {f.text}</span> : null}
									</ListboxItem>
								))}
							</Listbox>
						) : found.loading ? (
							<Pulse label="Loading" className="m-auto" />
						) : (
							<Empty><EmptyHeader><EmptyMedia variant="icon"><SearchIcon /></EmptyMedia><EmptyTitle>{state.contents ? "No file name or contents match" : "No matching files"}</EmptyTitle></EmptyHeader></Empty>
						)
					) : (
						<FileTree tab={tab} tick={tick} rows={rows} select={select} isDir={isDir} redraw={redraw} />
					)}
				</div>
			</ScrollArea>
			{actions.dialog}
		</>
	);
}

/** The tool calls of the last messages, each with what it printed. */
function Output({ tab }: { tab: Tab }) {
	const calls = useLoad(async () => {
		const tasks = (await api.history(tab.agent, tab.session, 8)).filter((x) => x.depth === 0 && !x.meta?.compact);
		const out: Array<{ task: number; n: number; entry: TranscriptEntry }> = [];
		for (const task of tasks) {
			const entries = (await api.transcript(task.id, true).catch(() => undefined))?.entries ?? [];
			entries.filter((e) => e.kind === "tool").forEach((entry, n) => out.push({ task: task.id, n, entry }));
		}
		return out;
	}, [tab.key, tab.codeTick]);
	const [open, setOpen] = useState<string>();
	if (!calls.data) return calls.error ? <Empty><EmptyHeader><EmptyMedia variant="icon"><SquareTerminalIcon /></EmptyMedia><EmptyTitle>Could not load the tool calls</EmptyTitle><EmptyDescription>{calls.error}</EmptyDescription></EmptyHeader></Empty> : <div className="flex flex-col">{Array.from({ length: 5 }, (_, i) => <ChangeRow key={i} skeleton />)}</div>;
	if (!calls.data.length) return <Empty><EmptyHeader><EmptyMedia variant="icon"><SquareTerminalIcon /></EmptyMedia><EmptyTitle>No tool calls yet</EmptyTitle><EmptyDescription>Output from the agent's commands and tools appears here.</EmptyDescription></EmptyHeader></Empty>;
	const shown = calls.data.find((c) => `${c.task}:${c.n}` === open);
	if (shown)
		return (
			<>
				<div className={SUB}>
					<HoverTooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={() => setOpen(undefined)} aria-label="Back to the list"><ChevronLeftIcon /></Button>} /><TooltipContent>Back to the list</TooltipContent></HoverTooltip>
					<span className="font-mono">{shown.entry.tool}</span>
					<span className="min-w-0 flex-1 truncate font-mono text-faint">{shown.entry.subject}</span>
				</div>
				<ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade"><div className="flex min-h-full flex-col">
					<Printed text={shown.entry.result || "(no output)"} failed={shown.entry.ok === false} className="m-2" contentClassName={CODE_LINES} />
					{(shown.entry.images ?? []).map((id) => <div className="p-3" key={id}><img className={PICTURE} src={media.tool(id)} alt="" /></div>)}
				</div></ScrollArea>
			</>
		);
	return (
		<ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade"><div className="flex min-h-full flex-col">
			<Listbox aria-label="Tool calls" className="outline-none" {...LISTBOX} onValueChange={onPick(setOpen)}>
			{calls.data.map((c) => (
				<ListboxItem key={`${c.task}:${c.n}`} value={`${c.task}:${c.n}`} label={`${c.entry.tool} ${c.entry.subject ?? ""}`} className={rowClass()}>
					{c.entry.ok === false ? <XIcon className="size-4 flex-none text-destructive" /> : c.entry.ok ? <CheckIcon className="size-4 flex-none text-primary" /> : <Pulse />}
					<span className="font-mono">{c.entry.tool}</span>
					<span className="min-w-0 flex-1 truncate font-mono text-faint">{c.entry.subject ? oneLine(c.entry.subject) : ""}</span>
					{c.entry.ms !== undefined ? <span className="text-faint">{took(c.entry.ms)}</span> : null}
				</ListboxItem>
			))}
				</Listbox>
			</div></ScrollArea>
	);
}

/** What the conversation's commands left running, and the way to stop each. */
function Running({ tab }: { tab: Tab }) {
	if (!tab.programsRead) return <LinesSkeleton rows={3} />;
	if (!tab.programs.length) return <Empty><EmptyHeader><EmptyMedia variant="icon"><PlayIcon /></EmptyMedia><EmptyTitle>Nothing is running</EmptyTitle><EmptyDescription>A dev server or watcher that the agent starts keeps running after the agent is done. You can see it here and stop it.</EmptyDescription></EmptyHeader></Empty>;
	return (
		<ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade"><div className="flex min-h-full flex-col">
			<ItemGroup className="p-2">
			{tab.programs.map((p, i) => (
				<Fragment key={p.id}>
				{i ? <ItemSeparator /> : null}
				<div role="listitem" className="flex flex-col gap-1">
					<Item size="sm">
						<ItemMedia>
							<span className="size-2 rounded-full bg-primary" />
						</ItemMedia>
						<ItemContent>
							<ItemTitle><code className="font-mono">{p.command}</code></ItemTitle>
							<ItemDescription>
								running for {clock(p.seconds)} · {plural(p.processes, "process", "processes")}
								{p.background ? " · in the background" : null}
							</ItemDescription>
						</ItemContent>
						<ItemActions>
							{p.ports.map((port) => (
								<HoverTooltip key={port}>
									<TooltipTrigger render={<Button variant="link" size="xs" onClick={() => void store.showInBrowser(tab, `http://localhost:${port}`)} />}>localhost:{port}</TooltipTrigger>
									<TooltipContent>Opens in the browser beside this conversation</TooltipContent>
								</HoverTooltip>
							))}
							{/* Stop, asked first. */}
							<AlertDialog>
								<AlertDialogTrigger render={<Button variant="ghost" size="xs" />}>Stop</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>Stop {short(p.command, 80)}?</AlertDialogTitle>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Cancel</AlertDialogCancel>
										<AlertDialogPrimitive.Close render={<AlertDialogAction variant="destructive" />} onClick={() => void store.attempt(() => api.stopProgram(tab.agent, tab.session, p.id)).then(() => store.flash("Stopping…"))}>Stop</AlertDialogPrimitive.Close>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						</ItemActions>
					</Item>
					{p.output ? <Printed text={p.output} capped contentClassName={CODE_LINES} /> : null}
				</div>
				</Fragment>
			))}
			</ItemGroup>
		</div></ScrollArea>
	);
}

export function CodePanel({ tab }: { tab: Tab }) {
	useModel(tab);
	useModel(store);
	const state = treeOf(tab.key);
	const [, redraw] = useState(0);
	const view = store.codeView;
	const setView = (v: CodeView) => ((store.codeView = v), store.touch());
	const setFile = (file?: string) => ((state.file = file), redraw((n) => n + 1));
	const steps = tab.steps?.items.some((s) => s.status !== "done") ? tab.steps.items : undefined;
	// The tasks of its boards that are not settled yet: what the tab's number says.
	const unsettled = tab.boards.reduce((n, b) => n + b.counts.open + b.counts.taken + b.counts.blocked, 0);
	// In a window narrower than that there is no room beside the conversation: the panel is a stock sheet over it,
	// from the right, and putting it away is closing the panel. The owner's choice (open or not) is the same either way.
	const sheet = !useMediaQuery(ROOM);
	return (
		<SideSheet
			slot="code-panel"
			title="Side panel"
			sheet={sheet}
			onClose={() => store.close("code")}
			bar={
				<>
					{/* What is always there first, in the order it is used: the folder (Files, Changes), what ran (Output, the
					    owner's Terminal, the agent's Browser), then the agent. After them the two that are there only while they hold something,
					    with their number, so that the others never move. In a narrow panel the row scrolls sideways, and fades
					    where it is cut. The padding is the room for the line under the tab in front, which stock draws below the list. */}
					<ScrollArea className="flex min-w-0 flex-initial flex-col *:data-[slot=scroll-area-viewport]:scroll-fade-x">
					<div className="pb-1.5">
					{/* Last turn is a range of Changes, chosen inside that view: one tab for both. */}
					<Tabs value={view === "turn" ? "changes" : view} onValueChange={(v) => setView(v as CodeView)}>
						<TabsList variant="line" activateOnFocus>
							<TabsTrigger value="files">Files</TabsTrigger>
							<TabsTrigger value="changes">Changes</TabsTrigger>
							<TabsTrigger value="output">Output</TabsTrigger>
							{/* A shell of this computer: a conversation of another machine's pine does not work here. */}
							{store.remote ? null : <TabsTrigger value="terminal">Terminal</TabsTrigger>}
							<TabsTrigger value="browser">Browser</TabsTrigger>
							<TabsTrigger value="agent">Agent</TabsTrigger>
							{/* Only while a command of the conversation's is still running, or the owner asked for the tab. */}
							{tab.programs.length || view === "running" ? (
								<TabsTrigger value="running">
									Running
									{tab.programs.length ? <Badge variant="secondary">{tab.programs.length}</Badge> : null}
								</TabsTrigger>
							) : null}
							{/* Only while the conversation has a board, or the owner asked for the tab: most conversations have none. */}
							{tab.boards.length || view === "board" ? (
								<TabsTrigger value="board">
									Board
									{unsettled ? <Badge variant="secondary">{unsettled}</Badge> : null}
								</TabsTrigger>
							) : null}
						</TabsList>
					</Tabs>
					</div>
					</ScrollArea>
					<span className="min-w-0 flex-1" />
					{/* In a group the panel's own tab closes it; a sheet has no tab. */}
					{sheet ? <HoverTooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={() => store.close("code")} aria-label="Close the panel"><XIcon /></Button>} /><TooltipContent>Close the panel</TooltipContent></HoverTooltip> : null}
				</>
			}
		>
			{steps ? <ScrollArea className="flex max-h-48 min-h-0 flex-none flex-col border-b border-line-soft *:data-[slot=scroll-area-viewport]:scroll-fade"><div className="px-3 py-2.5"><Steps items={steps} /></div></ScrollArea> : null}
			{view === "agent" ? (
				<AgentView tab={tab} />
			) : view === "changes" || view === "turn" ? (
				<>
					{/* Which changes: all that git knows of in the folder, or what the owner's last message changed. */}
					<div className={SUB}>
						<ToggleGroup aria-label="Which changes" variant="outline" size="sm" value={[view]} onValueChange={(v) => v[0] && setView(v[0] as CodeView)}>
							<ToggleGroupItem value="changes">All changes</ToggleGroupItem>
							<ToggleGroupItem value="turn">Last turn</ToggleGroupItem>
						</ToggleGroup>
					</div>
					<Changes tab={tab} turn={view === "turn"} openFile={(f) => (setFile(f), setView("files"))} />
				</>
			) : view === "files" ? (
				<Files tab={tab} file={state.file} setFile={setFile} />
			) : view === "output" ? (
				<Output tab={tab} />
			) : view === "board" ? (
				<BoardTab tab={tab} />
			) : view === "browser" ? (
				<BrowserView tab={tab} />
			) : view === "terminal" ? (
				store.remote ? <Empty><EmptyHeader><EmptyMedia variant="icon"><SquareTerminalIcon /></EmptyMedia><EmptyTitle>No terminal here</EmptyTitle><EmptyDescription>The terminal is a shell on this computer, but this conversation works on {store.remote}. Open a terminal there with ssh.</EmptyDescription></EmptyHeader></Empty> : <TerminalView tab={tab} />
			) : (
				<Running tab={tab} />
			)}
		</SideSheet>
	);
}
