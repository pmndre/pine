// The panel beside a conversation: the files with an editor, what changed in the folder (git, or
// what the last message changed), what the agent's tool calls printed, the owner's terminal, the
// agent itself (AgentView.tsx), and, while there is something in them, what its commands left
// running and the board it shares with its sub-agents (Board.tsx). Everything is read through the control API; a file is written through it too, by
// the daemon, inside a sandbox that reaches only this folder.
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, ExternalLinkIcon, FileIcon, FolderIcon, GitBranchIcon, PencilIcon, PlayIcon, RotateCwIcon, SaveIcon, SearchIcon, SquareTerminalIcon, Undo2Icon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { yaml } from "@codemirror/lang-yaml";
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { Fragment, useEffect, useRef, useState } from "react";
import { useMediaQuery } from "usehooks-ts";
import { CodeBlock, CodeBlockContent, CodeBlockLine } from "@/components/ui/code-block";
import { Printed } from "@/components/printed";
import { SideSheet } from "@/components/side-sheet";
import { api, type Change, media, type TranscriptEntry } from "./api.ts";
import { AgentView } from "./AgentView.tsx";
import { BoardTab } from "./Board.tsx";
import { bridge } from "./bridge.ts";
import { Steps } from "./Conversation.tsx";
import { type CodeView, mediaKind, ROOM, store, type Tab, useModel, useSignal } from "./model.ts";
import { clock, errText, oneLine, plural, short, size, tilde, took } from "./text.ts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { LISTBOX, onPick, rowClass, TREE_ITEM } from "./lists.tsx";
import { Listbox, ListboxItem } from "@ui-sdk/react/listbox";
import { Tree, TreeGroup, TreeItem, TreeItemLabel } from "@ui-sdk/react/tree";
import { EmptyView } from "@/components/empty-view";
import { useLoad } from "./use-load.ts";
import { TerminalView } from "./Terminal.tsx";
import { Pulse } from "@/components/pulse";
import { Skeleton } from "@/components/ui/skeleton";
import { HoverTooltip } from "@/components/hover-tooltip";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

/** What a file's place is shown in, by the name the system gives its file manager. */
const SHOW_IN: Record<string, string> = { darwin: "Show in the Finder", win32: "Show in Explorer", linux: "Show in Files" };

// ---- the editor ------------------------------------------------------------------------------------

// The editor says what a token is and what it looks like. The colors are tokens of index.css
// (`--code-*`), so light and dark differ there and nowhere else.
const colors = HighlightStyle.define([
	{ tag: [t.comment], color: "var(--code-comment)", fontStyle: "italic" },
	{ tag: [t.meta], color: "var(--code-meta)", fontStyle: "var(--code-meta-style)" },
	{ tag: [t.keyword], color: "var(--code-keyword)" },
	{ tag: [t.definitionKeyword], color: "var(--code-definition)" },
	{ tag: [t.controlKeyword], color: "var(--code-control)" },
	{ tag: [t.moduleKeyword, t.modifier, t.operatorKeyword, t.self], color: "var(--code-modifier)" },
	{ tag: [t.string, t.special(t.string)], color: "var(--code-string)" },
	{ tag: [t.regexp, t.escape], color: "var(--code-regexp)" },
	{ tag: [t.number, t.atom, t.url, t.bool], color: "var(--code-literal)" },
	{ tag: [t.null], color: "var(--code-null)" },
	{ tag: [t.variableName, t.propertyName], color: "var(--code-name)" },
	{ tag: [t.attributeName], color: "var(--code-attribute)", fontStyle: "var(--code-attribute-style)" },
	{ tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--code-call)" },
	{ tag: [t.function(t.definition(t.variableName)), t.definition(t.function(t.propertyName)), t.className, t.definition(t.className)], color: "var(--code-function)" },
	{ tag: [t.typeName], color: "var(--code-type)" },
	{ tag: [t.namespace], color: "var(--code-namespace)" },
	{ tag: [t.tagName], color: "var(--code-tag)" },
	{ tag: [t.heading], color: "var(--code-heading)", fontWeight: "var(--font-weight-semibold)" },
	{ tag: [t.emphasis], color: "var(--code-emphasis)", fontStyle: "italic" },
	{ tag: [t.strong], color: "var(--code-emphasis)", fontWeight: "var(--font-weight-semibold)" },
	{ tag: [t.link], color: "var(--code-link)", textDecoration: "underline" },
	{ tag: [t.inserted], color: "var(--code-inserted)" },
	{ tag: [t.deleted, t.invalid], color: "var(--code-deleted)" },
	{ tag: [t.punctuation, t.bracket], color: "var(--code-punctuation)" },
	{ tag: [t.operator], color: "var(--code-operator)" },
]);

// CodeMirror's own look, in pine's tokens. A theme of CodeMirror's comes after its base theme, so it
// wins without `!important`; the focused selection repeats the base theme's longer selector.
const look = EditorView.theme({
	"&": { height: "100%", minWidth: "0", flex: "1", backgroundColor: "var(--background)", color: "var(--code-text)" },
	"&.cm-focused": { outline: "none" },
	".cm-scroller": { fontFamily: "var(--mono)", fontSize: "var(--text-xs)", lineHeight: "var(--leading-relaxed)" },
	".cm-gutters": { borderRight: "1px solid var(--line-soft)", backgroundColor: "var(--background)", color: "var(--code-gutter)" },
	".cm-activeLine": { backgroundColor: "var(--code-active-line)" },
	".cm-activeLineGutter": { backgroundColor: "var(--code-active-line)", color: "var(--code-gutter-active)" },
	".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { background: "var(--select)" },
	".cm-cursor": { borderLeftColor: "var(--code-cursor)" },
	".cm-panels": { borderColor: "var(--border)", backgroundColor: "var(--raised)", color: "var(--foreground)" },
	".cm-textfield, .cm-button": { borderRadius: "calc(var(--radius) * 0.8)", borderColor: "var(--border)", backgroundColor: "var(--card)", backgroundImage: "none", fontFamily: "var(--font)", fontSize: "var(--text-xs)", color: "var(--foreground)" },
	".cm-searchMatch": { backgroundColor: "var(--code-match)", outline: "1px solid var(--code-match-line)" },
});

// The panel's parts: a bar of controls with a line under it, and what scrolls below: a stock
// ScrollArea that fades where it is cut (scroll-fade sits on its viewport, the element that
// scrolls), a flex column so that its viewport shrinks to it, and a sideways bar where a diff can
// be wider than the panel. Inside, a flex column at least its height, for an Empty centred with `m-auto`.
export const SUB = "flex min-h-9 flex-none items-center gap-1.5 border-b border-line-soft px-2.5 py-1.5 text-xs text-muted-foreground";
const PICTURE = "block max-h-80 max-w-full rounded-lg border sm:max-w-md";
const STATUS: Record<string, string> = { M: "text-warn", A: "text-add", "?": "text-add", D: "text-del", R: "text-info" };

function language(file: string): Extension {
	const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
	if (["ts", "mts", "cts"].includes(ext)) return javascript({ typescript: true });
	if (ext === "tsx") return javascript({ typescript: true, jsx: true });
	if (["js", "mjs", "cjs", "jsx"].includes(ext)) return javascript({ jsx: true });
	if (["json", "jsonc"].includes(ext)) return json();
	if (["md", "markdown", "mdx"].includes(ext)) return markdown();
	if (["css", "scss"].includes(ext)) return css();
	if (["html", "htm", "vue", "svelte", "xml", "svg"].includes(ext)) return html();
	if (ext === "py") return python();
	if (ext === "rs") return rust();
	if (["yml", "yaml"].includes(ext)) return yaml();
	return [];
}

/** A text editor. `text` is what is on disk; what is typed is told with `onChange`, and ⌘S asks to save. */
export function Editor({ file, text, readOnly, onChange, onSave }: { file: string; text: string; readOnly?: boolean; onChange?: (text: string) => void; onSave?: () => void }) {
	const host = useRef<HTMLDivElement>(null);
	const view = useRef<EditorView>(undefined);
	const lock = useRef(new Compartment());
	const live = useRef({ onChange, onSave });
	live.current = { onChange, onSave };
	useEffect(() => {
		const v = new EditorView({
			parent: host.current!,
			state: EditorState.create({
				doc: text,
				extensions: [
					lineNumbers(),
					highlightActiveLineGutter(),
					highlightActiveLine(),
					history(),
					drawSelection(),
					indentOnInput(),
					bracketMatching(),
					highlightSelectionMatches(),
					search({ top: true }),
					look,
					syntaxHighlighting(colors),
					language(file),
					EditorView.lineWrapping,
					keymap.of([{ key: "Mod-s", run: () => (live.current.onSave?.(), true) }, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
					lock.current.of([EditorState.readOnly.of(Boolean(readOnly)), EditorView.editable.of(!readOnly)]),
					EditorView.updateListener.of((u) => u.docChanged && live.current.onChange?.(u.state.doc.toString())),
				],
			}),
		});
		view.current = v;
		return () => v.destroy();
		// A new file is a new editor; what it shows of the old one is replaced below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [file]);
	useEffect(() => {
		const v = view.current;
		if (v && v.state.doc.toString() !== text) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
	}, [text]);
	useEffect(() => {
		view.current?.dispatch({ effects: lock.current.reconfigure([EditorState.readOnly.of(Boolean(readOnly)), EditorView.editable.of(!readOnly)]) });
	}, [readOnly]);
	return <div className="flex min-h-0 flex-1 overflow-hidden" ref={host} />;
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
		<CodeBlock size="sm" className="m-2 w-auto select-text">
			<CodeBlockContent>
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
			<BreadcrumbList className="flex-nowrap font-mono">
				{parts.map((part, i) => (
					<Fragment key={i}>
						{i ? <BreadcrumbSeparator /> : null}
						<BreadcrumbItem className={i === last ? "min-w-0" : undefined}>
							{i === last ? <BreadcrumbPage className="truncate">{part}{children}</BreadcrumbPage> : part}
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
			<Skeleton className="h-3.5 w-3.5 flex-none" />
			<Skeleton className="h-3.5 w-24" />
			<Skeleton className="h-3.5 min-w-0 flex-1" />
			<Skeleton className="h-3.5 w-8" />
		</div>
	);
}

/** A few line bars where a diff, a file or a list is read. */
function LinesSkeleton({ rows = 6 }: { rows?: number }) {
	return (
		<div data-slot="lines-skeleton" className="flex flex-col gap-2 p-3" aria-hidden>
			{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-3.5" style={{ width: `${[85, 60, 75, 40, 90, 55][i % 6]}%` }} />)}
		</div>
	);
}

/** One row of the file tree: a folder (open or not) or a file with its size, indented by its depth. */
export function DirRow(props: { name: string; dir: boolean; size: number; depth: number; open?: boolean; active?: boolean; skeleton?: false } | { name?: undefined; dir?: undefined; size?: undefined; depth: number; open?: undefined; active?: undefined; /** While a folder is read: a row of its shape. */ skeleton: true }) {
	const indent = { paddingLeft: `calc(var(--spacing) * ${2.5 + props.depth * 3.5})` };
	if (props.skeleton || props.name === undefined)
		return (
			<div data-slot="dir-row-skeleton" className={rowClass()} style={indent} aria-hidden>
				<span className="w-3 flex-none" />
				<Skeleton className="size-3.5 flex-none" />
				<Skeleton className="h-3.5 w-28" />
			</div>
		);
	const { name, dir, size: bytes, open, active } = props;
	return (
		<TreeItemLabel className={rowClass(active)} style={indent}>
			{dir ? (open ? <ChevronDownIcon className="size-3 text-faint" /> : <ChevronRightIcon className="size-3 text-faint" />) : <span className="w-3 flex-none" />}
			{dir ? <FolderIcon className="size-3.5 text-faint" /> : <FileIcon className="size-3.5 text-faint" />}
			<span className="min-w-0 flex-1 truncate">{name}</span>
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
			<span className={`w-3.5 flex-none text-center font-mono font-semibold ${STATUS[c.status] ?? ""}`}>{c.status === "?" ? "U" : c.status}</span>
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
	if (list.error) return <EmptyView icon={turn ? Undo2Icon : GitBranchIcon} title={turn ? "The last message cannot be read" : "No changes to show"}>{list.error}</EmptyView>;
	if (!data) return <div className="flex flex-col">{Array.from({ length: 5 }, (_, i) => <ChangeRow key={i} skeleton />)}</div>;
	if (!turn && !data.repo) return <EmptyView icon={GitBranchIcon} title="Not a git repository">The folder this conversation works in has no git history, so there are no changes to show. The files are in the Files view.</EmptyView>;
	if (file)
		return (
			<>
				<div className={SUB}>
					<HoverTooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={() => setFile(undefined)} aria-label="Back to the list"><ChevronLeftIcon /></Button>} /><TooltipContent>Back to the list</TooltipContent></HoverTooltip>
					<PathCrumbs path={file} />
					<Button variant="ghost" size="xs" onClick={() => openFile(inFolder(file))}><PencilIcon data-icon="inline-start" />Edit</Button>
				</div>
				<ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade"><div className="flex min-h-full flex-col">{diff.data ? <><Diff text={diff.data.diff || "No difference."} />{diff.data.truncated ? <p className="px-3 py-2.5 text-xs text-muted-foreground select-text">… the rest of this diff is too long to show.</p> : null}</> : diff.error ? <EmptyView icon={GitBranchIcon} title="This diff cannot be shown">{diff.error}</EmptyView> : <LinesSkeleton />}</div><ScrollBar orientation="horizontal" /></ScrollArea>
			</>
		);
	return (
		<>
			<div className={SUB}>
				{turn ? <><Undo2Icon className="size-3.5" /><span className="min-w-0 flex-1 truncate">{data.prompt ? `Since “${short(oneLine(data.prompt), 60)}”` : "Since your last message"}</span>{data.files.length ? <Button variant="outline" size="xs" onClick={() => void store.undo(tab, false)}>Take back</Button> : null}</> : <><GitBranchIcon className="size-3.5" /><span className="min-w-0 flex-1 truncate">{data.branch || "no branch"}{data.worktree ? ` · ${data.worktree.ahead} ahead of ${data.worktree.base}${data.worktree.behind ? `, ${data.worktree.behind} behind` : ""}` : ""} · {data.files.length ? plural(data.files.length, "changed file") : "clean"}</span>{data.worktree ? <Button variant="outline" size="xs" onClick={() => void store.worktreeMenu(tab)}>{data.worktree.ahead && !data.worktree.dirty ? "Merge…" : "Worktree…"}</Button> : null}</>}
				<HoverTooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={list.reload} aria-label="Read again"><RotateCwIcon /></Button>} /><TooltipContent>Read again</TooltipContent></HoverTooltip>
			</div>
			<ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade"><div className="flex min-h-full flex-col">
				{data.note ? <p className="px-3 py-2.5 text-xs text-muted-foreground select-text">{data.note}</p> : null}
				{data.files.length ? <Listbox aria-label={turn ? "Files the last message changed" : "Changed files"} className="outline-none" {...LISTBOX} onValueChange={onPick(setFile)}>{data.files.map((c) => <ChangeRow key={c.path} c={c} />)}</Listbox> : <EmptyView icon={CheckIcon} title={turn ? "The last message changed no files" : "Nothing changed since the last commit"} />}
				{data.more ? <p className="px-3 py-2.5 text-xs text-muted-foreground select-text">… and more.</p> : null}
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
	/** What was typed in a file and not saved, and what it was typed over, by file. Kept here and not in the editor's
	 *  state because the panel's body is mounted again when the window crosses the width where it becomes a sheet. */
	edits: Map<string, { draft?: string; base?: string }>;
}
const trees = new Map<string, TreeState>();
const treeOf = (key: string): TreeState => trees.get(key) ?? (trees.set(key, { open: new Set(), dirs: new Map(), failed: new Map(), edits: new Map() }), trees.get(key)!);

/** The folder's files as a tree: a folder opens and closes, a file opens in the editor. */
function FileTree({ tab, pick, tick }: { tab: Tab; pick: (file: string) => void; tick: number }) {
	const state = treeOf(tab.key);
	const [, redraw] = useState(0);
	const isDir = (full: string) => {
		const at = full.lastIndexOf("/");
		return Boolean(state.dirs.get(at > 0 ? full.slice(0, at) : "")?.find((e) => e.name === full.slice(at + 1))?.dir);
	};
	const entries = state.dirs.get("");
	const failed = state.failed.get("");
	return (
		<>
			{failed ? <EmptyView icon={FolderIcon} title="This folder cannot be read">{failed}</EmptyView> : null}
			{entries && !entries.length ? <EmptyView icon={FolderIcon} title="This folder is empty" /> : null}
			<Tree aria-label="Files" className="outline-none" expanded={[...state.open]} onExpandedChange={(open) => ((state.open = new Set(open)), redraw((n) => n + 1))} expandOnPress onAction={(full) => !isDir(full) && pick(full)}>
				<Dir tab={tab} dir="" depth={0} tick={tick} onLoad={() => redraw((n) => n + 1)} />
			</Tree>
		</>
	);
}

/** A folder's rows in the tree, read when it opens; `onLoad` redraws the tree around once they are read. */
function Dir({ tab, dir, depth, tick, onLoad }: { tab: Tab; dir: string; depth: number; tick: number; onLoad: () => void }) {
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
	if (failed && dir) return <p className="py-2.5 pr-3 text-xs wrap-anywhere text-faint select-text" style={{ paddingLeft: `calc(var(--spacing) * ${2.5 + depth * 3.5})` }}>{failed}</p>;
	if (failed !== undefined) return null;
	const entries = state.dirs.get(dir);
	if (!entries) return <>{Array.from({ length: dir ? 2 : 6 }, (_, i) => <DirRow key={i} depth={depth} skeleton />)}</>;
	return (
		<>
			{entries.map((e) => {
				const full = dir ? `${dir}/${e.name}` : e.name;
				const open = state.open.has(full);
				return (
					<TreeItem key={full} value={full} label={e.name} branch={e.dir} className={TREE_ITEM}>
						<DirRow name={e.name} dir={e.dir} size={e.size} depth={depth} open={open} active={state.file === full} />
						{e.dir ? <TreeGroup>{open ? <Dir tab={tab} dir={full} depth={depth + 1} tick={tick} onLoad={onLoad} /> : null}</TreeGroup> : null}
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
							<AlertDialogTitle>Leave {file} without saving what you typed?</AlertDialogTitle>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction variant="destructive" onClick={() => (setLeaving(false), leave())}>Leave</AlertDialogAction>
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
						<Button variant="outline" size="xs" onClick={() => edit({ base: text, draft: undefined })}>Take the new one</Button>
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
					<EmptyView icon={FileIcon} title="This file cannot be shown">{disk.error}</EmptyView>
				) : !disk.data ? (
					<LinesSkeleton rows={12} />
				) : (
					<EmptyView icon={FileIcon} title="A binary file">{size(disk.data.size)}. It is not shown as text.</EmptyView>
				)}
			</div></ScrollArea>
			)}
		</>
	);
}

function Files({ tab, file, setFile }: { tab: Tab; file?: string; setFile: (file?: string) => void }) {
	const [tick, setTick] = useState(0);
	const [query, setQuery] = useState("");
	const found = useLoad(async () => (query.trim() ? (await api.find(tab.agent, tab.session, query.trim())).files : undefined), [tab.key, query]);
	useEffect(() => setTick((n) => n + 1), [tab.codeTick]);
	if (file) return <FileView tab={tab} file={file} close={() => setFile(undefined)} />;
	const root = tab.folder ?? tab.workspace;
	return (
		<>
			<div className={SUB}>
				<InputGroup>
					<InputGroupAddon>
						<SearchIcon />
					</InputGroupAddon>
					<InputGroupInput aria-label="Find a file" placeholder={root ? `Find a file in ${tilde(root)}` : "Find a file"} value={query} onChange={(e) => setQuery(e.target.value)} />
				</InputGroup>
				<HoverTooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={() => setTick((n) => n + 1)} aria-label="Read again"><RotateCwIcon /></Button>} /><TooltipContent>Read again</TooltipContent></HoverTooltip>
			</div>
			<ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade"><div className="flex min-h-full flex-col">
				{query.trim() ? (
					found.data?.length ? <Listbox aria-label="Files that fit" className="outline-none" {...LISTBOX} onValueChange={onPick(setFile)}>{found.data.map((f) => <ListboxItem key={f} value={f} label={f} className={rowClass()}><FileIcon className="size-3.5 text-faint" /><span className="truncate">{f}</span></ListboxItem>)}</Listbox> : found.loading ? <Pulse label="Loading" className="m-auto" /> : <EmptyView icon={SearchIcon} title="No file fits" />
				) : (
					<FileTree tab={tab} pick={setFile} tick={tick} />
				)}
			</div></ScrollArea>
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
	if (!calls.data) return calls.error ? <EmptyView icon={SquareTerminalIcon} title="The tool calls cannot be read">{calls.error}</EmptyView> : <div className="flex flex-col">{Array.from({ length: 5 }, (_, i) => <ChangeRow key={i} skeleton />)}</div>;
	if (!calls.data.length) return <EmptyView icon={SquareTerminalIcon} title="No tool calls yet">What the agent's commands and tools print appears here.</EmptyView>;
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
					<Printed text={shown.entry.result || "(it printed nothing)"} failed={shown.entry.ok === false} className="m-2" />
					{(shown.entry.images ?? []).map((id) => <div className="p-3" key={id}><img className={PICTURE} src={media.tool(id)} alt="" /></div>)}
				</div></ScrollArea>
			</>
		);
	return (
		<ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade"><div className="flex min-h-full flex-col">
			<Listbox aria-label="Tool calls" className="outline-none" {...LISTBOX} onValueChange={onPick(setOpen)}>
			{calls.data.map((c) => (
				<ListboxItem key={`${c.task}:${c.n}`} value={`${c.task}:${c.n}`} label={`${c.entry.tool} ${c.entry.subject ?? ""}`} className={rowClass()}>
					{c.entry.ok === false ? <XIcon className="size-3.5 flex-none text-destructive" /> : c.entry.ok ? <CheckIcon className="size-3.5 flex-none text-primary" /> : <Pulse />}
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
	if (!tab.programs.length) return <EmptyView icon={PlayIcon} title="Nothing is running">A dev server or a watcher the agent starts keeps running after the agent is done. It is listed here, and stopped from here.</EmptyView>;
	return (
		<ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade"><div className="flex min-h-full flex-col">
			{tab.programs.map((p) => (
				<div className="flex flex-col gap-1 border-b border-line-soft p-2" key={p.id}>
					<Item size="sm">
						<ItemMedia>
							<span className="size-2 rounded-full bg-primary" />
						</ItemMedia>
						<ItemContent>
							<ItemTitle className="font-mono">{p.command}</ItemTitle>
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
							<AlertDialog>
								<AlertDialogTrigger render={<Button variant="ghost" size="xs" />}>Stop</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>Stop {short(p.command, 80)}?</AlertDialogTitle>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Cancel</AlertDialogCancel>
										<AlertDialogCancel variant="destructive" onClick={() => void store.attempt(() => api.stopProgram(tab.agent, tab.session, p.id)).then(() => store.flash("Stopping…"))}>Stop</AlertDialogCancel>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						</ItemActions>
					</Item>
					{p.output ? <Printed text={p.output} sm /> : null}
				</div>
			))}
		</div></ScrollArea>
	);
}

export const CODE_KEY = "pine.code.width";

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
			id="code-panel"
			slot="code-panel"
			title="Side panel"
			sheet={sheet}
			widthKey={CODE_KEY}
			defaultWidth={520}
			onClose={() => void store.command("code")}
			bar={
				<>
					{/* What is always there first, in the order it is used: the folder (Files, Changes), what ran (Output, the
					    owner's Terminal), then the agent. After them the two that are there only while they hold something,
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
					<HoverTooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={() => void store.command("code")} aria-label="Close the panel"><XIcon /></Button>} /><TooltipContent>Close the panel</TooltipContent></HoverTooltip>
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
						<Tabs value={view} onValueChange={(v) => setView(v as CodeView)}>
							<TabsList activateOnFocus aria-label="Which changes">
								<TabsTrigger value="changes">All changes</TabsTrigger>
								<TabsTrigger value="turn">Last turn</TabsTrigger>
							</TabsList>
						</Tabs>
					</div>
					<Changes tab={tab} turn={view === "turn"} openFile={(f) => (setFile(f), setView("files"))} />
				</>
			) : view === "files" ? (
				<Files tab={tab} file={state.file} setFile={setFile} />
			) : view === "output" ? (
				<Output tab={tab} />
			) : view === "board" ? (
				<BoardTab tab={tab} />
			) : view === "terminal" ? (
				store.remote ? <EmptyView icon={SquareTerminalIcon} title="No terminal here">The terminal is a shell on this computer, and this conversation works on {store.remote}. Open a terminal there with ssh.</EmptyView> : <TerminalView tab={tab} />
			) : (
				<Running tab={tab} />
			)}
		</SideSheet>
	);
}
