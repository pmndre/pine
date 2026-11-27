// An answer, drawn. What an agent writes can repeat what a web page told it to write, so the
// text is treated as content from outside. Streamdown parses it and draws it as it streams, and
// three things of pine's own replace its defaults, which are not safe here (a picture at any
// address loaded by itself, a button that downloads, links opened by the page):
//
//   - CLEAN, the rule set the text is cleaned with: no scripts, styles, forms, frames, svg, media
//     tags, no style, class or id attributes, and links only to http(s) and mailto. Pictures in
//     the text itself (`data:`) are kept, which GitHub's rules, Streamdown's default, drop;
//   - Link: it opens in the owner's browser, only for http(s), it has no href that the page could
//     follow, and its address stands next to it whenever its words are not the address itself;
//   - Picture: one at a web address is never fetched because an answer contains it. It is a line
//     to click, and then the daemon fetches it (the page's own policy allows no address on the
//     web). One at a path is shown from the agent's workspace, through the daemon; a `data:` png,
//     jpeg, gif or webp is shown as it is. Nothing else, and no download button.
//     A sound is a line of its own (components/sound.tsx). It plays by itself only where it is a
//     file the daemon serves and its answer arrived while the owner was looking (`arrived`), as
//     in the terminal UI: never one from earlier, and one at a web address only after its click.
//
// A code block for a shell (```bash and the like, runnable.ts) has a Run button beside its copy
// button: the owner's click types it into the conversation's terminal (Terminal.tsx), exactly as
// it is shown, and never one that holds a character that does not show as itself. Nothing runs
// without that click, and a block still being written has no button.
//
// When Streamdown is upgraded, read its defaults again (`defaultRehypePlugins`, the components
// it draws, its controls) and run the desktop suite: its markdown test fails without each of the three.
import { createCodePlugin } from "@streamdown/code";
import { ArrowRightIcon, ChevronRightIcon, FileCodeIcon, PlayIcon } from "lucide-react";
import { Children, createContext, createElement, isValidElement, memo, useContext, useEffect, useState, type ReactNode } from "react";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { type Options as Schema } from "rehype-sanitize";
import type { HighlightResult } from "@streamdown/code";
import { defaultComponents, Streamdown, useIsCodeFenceIncomplete, type Components, type ControlsConfig, type ExtraProps } from "streamdown";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from "@/components/ui/code-block";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pulse } from "@/components/pulse";
import { type Heard, Sound } from "@/components/sound";
import { cn } from "@/lib/utils";
import { api, bytesOf, media } from "./api.ts";
import { bridge } from "./bridge.ts";
import { mediaKind, store } from "./model.ts";
import { SHELLS } from "./runnable.ts";
import { baseName, errText, localAddress, short } from "./text.ts";
import { contextMenu } from "@/components/page-menu";

/** The tags and attributes an answer keeps. Everything else is taken away, its words kept; what is in `strip` goes with its words. */
export const CLEAN: Schema = {
	tagNames: ["p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "del", "s", "ins", "mark", "sub", "sup", "small", "kbd", "samp", "var", "code", "pre", "blockquote", "q", "cite", "abbr", "dfn", "time", "ul", "ol", "li", "dl", "dt", "dd", "a", "img", "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td", "details", "summary", "div", "span", "section", "figure", "figcaption", "ruby", "rt", "rp", "wbr"],
	attributes: {
		a: ["href", "title"],
		img: ["src", "alt", "title"],
		// The language of a code block, which the highlighter reads; no other class survives.
		// And the rest of a block's opening line, read for its `title="…"` (a file's name), drawn as text.
		code: [["className", /^language-./], "metastring"],
		th: ["align", "colSpan", "rowSpan", "scope"],
		td: ["align", "colSpan", "rowSpan"],
		ol: ["start", "reversed"],
		// GFM's mark on its footnotes, which are drawn smaller; nothing else reads it.
		section: ["dataFootnotes"],
		// A task's state, which taskBoxes puts there: drawn as a box that cannot be changed.
		li: ["value", ["dataTask", "done", "todo"]],
		details: ["open"],
		abbr: ["title"],
		time: ["dateTime"],
		"*": ["lang", "dir"],
	},
	protocols: { href: ["http", "https", "mailto"], src: ["http", "https", "data"] },
	ancestors: { tbody: ["table"], td: ["table"], th: ["table"], thead: ["table"], tfoot: ["table"], tr: ["table"], caption: ["table"] },
	strip: ["script", "style", "template", "textarea", "select", "noscript", "title", "iframe", "frame", "object", "embed", "svg", "math", "video", "audio"],
	clobber: [],
	clobberPrefix: "",
};

interface HastNode {
	type: string;
	tagName?: string;
	properties?: Record<string, unknown>;
	children?: HastNode[];
}

/**
 * Footnotes as GFM writes them: a section with a heading meant for screen readers alone, which CLEAN
 * would leave as a heading for everyone, since it takes the class that hides it. The heading goes and a
 * separator stands in its place, above the notes. It runs before CLEAN, which takes away the marks it
 * goes by; it only removes, so an answer that imitates the section gains nothing.
 */
function quietFootnotes() {
	const walk = (node: HastNode) => {
		if (node.tagName === "section" && node.properties?.dataFootnotes !== undefined) {
			node.children = (node.children ?? []).map((child) => (child.tagName === "h2" && child.properties?.id === "footnote-label" ? { type: "element", tagName: "hr", properties: {}, children: [] } : child));
		}
		node.children?.forEach(walk);
	};
	return walk;
}

/**
 * A task list's item (`- [x] done`) as GFM writes it: a checkbox input in front of the item's words,
 * which CLEAN takes away with every input. Its state goes onto the item instead (`data-task`), which
 * the item draws as the stock Checkbox, read only. It only moves a done/to-do mark, so raw HTML that
 * imitates it gains a drawn box and nothing more.
 */
function taskBoxes() {
	const isBox = (node: HastNode) => node.tagName === "input" && node.properties?.type === "checkbox";
	const walk = (node: HastNode) => {
		if (node.tagName === "li") {
			const first = node.children?.find((child) => child.type === "element");
			const box = first && isBox(first) ? first : first?.tagName === "p" ? first.children?.find(isBox) : undefined;
			if (box) {
				node.properties = { ...node.properties, dataTask: box.properties?.checked ? "done" : "todo" };
				const drop = (parent: HastNode) => (parent.children = parent.children?.filter((child) => child !== box));
				drop(node);
				if (first && first !== box) drop(first);
			}
		}
		node.children?.forEach(walk);
	};
	return walk;
}

const REHYPE = [rehypeRaw, quietFootnotes, taskBoxes, [rehypeSanitize, CLEAN]] as const;

const isWeb = (url: string) => /^https?:\/\//i.test(url);
const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,/i;

export interface Where {
	agent: string;
	session?: string;
	/** A name for this answer that stays the same while the page lives: a sound of it that plays is found again by it. */
	id?: string;
	/** On an answer that arrived while the owner was looking at its conversation: its first sound plays by itself, once. */
	arrived?: Heard;
}

/** Whose workspace a path in the answer is in: a context, so that the components below stay the same for every answer. */
const WhereContext = createContext<Where | undefined>(undefined);
/** Where a link that is not a web address goes, for text that is pine's own (the manual: a link to another of its files). Unset in an answer. */
const FollowContext = createContext<Follow | undefined>(undefined);

/** Links of text that is pine's own: which of them it takes (`can`), and where one goes (`go`). */
export interface Follow {
	can: (href: string) => boolean;
	go: (href: string) => void;
}

type Node = ExtraProps["node"];
const textOf = (node: Node | { type: string; value?: string; children?: unknown[] }): string => {
	if (!node) return "";
	if (node.type === "text") return (node as { value?: string }).value ?? "";
	return ((node as { children?: Node[] }).children ?? []).map(textOf).join("");
};

/**
 * What makes a link without an href one all the same. A click opens it in the conversation's browser (a web
 * page) or the owner's own (an address on this computer, or with ⌘, Ctrl or ⌥ held); the right button offers
 * both. Enter, once it has the focus, opens it as a plain click does; it takes the focus in the order of the
 * page, with the stock focus ring. See `store.openLink`.
 */
function linkHandlers(url: string, where: Where | undefined) {
	const agent = where?.agent ?? "";
	const open = (outside: boolean) => (!where || outside ? void bridge.open(url) : store.openLink(agent, where.session, url));
	return {
		role: "link",
		tabIndex: 0,
		onClick: (e: React.MouseEvent) => {
			e.preventDefault();
			open(e.metaKey || e.ctrlKey || e.altKey);
		},
		onKeyDown: (e: React.KeyboardEvent) => {
			if (e.key !== "Enter") return;
			e.preventDefault();
			open(e.metaKey || e.ctrlKey || e.altKey);
		},
		onContextMenu: (e: React.MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			void linkMenu(url, where);
		},
	};
}
const FOCUS = "rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

async function linkMenu(url: string, where: Where | undefined): Promise<void> {
	const local = localAddress(url);
	const tab = where ? store.answerTab(where.agent, where.session) : undefined;
	const picked = await contextMenu([
		{ id: "pine", label: local ? `Open in Pine's Browser (lets the agent reach ${local})` : "Open in Pine's Browser", enabled: Boolean(tab) },
		{ id: "outside", label: "Open in Your Browser" },
		{ id: "sep", label: "", separator: true },
		{ id: "copy", label: "Copy Address" },
	]);
	if (picked === "pine" && where) store.openLink(where.agent, where.session, url, "inPine");
	else if (picked === "outside") void bridge.open(url);
	else if (picked === "copy") void navigator.clipboard.writeText(url).then(() => store.flash("Copied the address."), () => store.flash("Could not copy the address.", "warn"));
}

function Link({ href, children, node }: React.ComponentProps<"a"> & ExtraProps) {
	const where = useContext(WhereContext);
	const follow = useContext(FollowContext);
	const url = typeof href === "string" ? href : "";
	const shown = textOf(node).trim();
	// A place in the answer itself, as a footnote's number is: its words alone. The way back from a note
	// to where it was called is no words at all.
	if (url.startsWith("#user-content-fnref-")) return null;
	if (follow && url && !url.startsWith("#user-content-") && follow.can(url)) {
		const go = (e: React.SyntheticEvent) => (e.preventDefault(), follow.go(url));
		return <a data-follow={url} role="link" tabIndex={0} className={cn("cursor-pointer text-primary underline decoration-primary/40 underline-offset-2", FOCUS)} onClick={go} onKeyDown={(e) => e.key === "Enter" && go(e)}>{children}</a>;
	}
	if (url.startsWith("#")) return <>{children}</>;
	if (!isWeb(url)) return <span>{url && shown !== url ? <>{children} ({url})</> : children}</span>;
	const plain = shown === url || shown === url.replace(/^https?:\/\//, "").replace(/\/$/, "");
	const on = linkHandlers(url, where);
	return (
		<>
			<a data-href={url} title={url} className={cn("cursor-pointer text-primary underline decoration-primary/40 underline-offset-2", FOCUS)} {...on}>
				{children}
			</a>
			{/* Beside the link, not inside it: it is the address in plain letters, not more of the link's words.
			    It flows with the sentence: a line of its own would cut the link off from where it leads. */}
			{plain ? null : (
				<span data-target="" className={cn("ml-1 inline cursor-pointer font-mono text-xs text-faint wrap-anywhere", FOCUS)} title={url} {...on}>
					<ArrowRightIcon className="mr-1 inline size-3" aria-hidden />
					{short(url.replace(/^https?:\/\//, ""), 72)}
				</span>
			)}
		</>
	);
}

/** How a picture, a video or a sound is drawn, in an answer and in a conversation: never wider than its place. */
export const MEDIA = {
	box: { image: "block max-w-md", video: "block max-w-lg", audio: "block max-w-md" },
	image: "block max-h-80 max-w-full cursor-zoom-in rounded-md border",
	video: "block max-h-90 max-w-full rounded-md bg-black",
	cap: "mt-1 block text-xs text-faint",
};

function Player({ kind, src, alt, sound }: { kind: "image" | "video" | "audio"; src: string; alt: string; sound?: { id?: string; name: string; bytes: () => Promise<ArrayBuffer>; auto?: Heard } }) {
	// A sound says its name in its own line.
	if (kind === "audio") return <span className={cn("my-2.5", MEDIA.box.audio)}><Sound src={src} name={alt || sound?.name || "sound"} id={sound?.id} bytes={sound?.bytes} auto={sound?.auto} /></span>;
	return (
		<span className={cn("my-2.5", MEDIA.box[kind])}>
			{kind === "image" ? (
				// Larger over the page with a click or, focused, with Enter; a click on it, beside it, or Escape closes it.
				<Dialog>
					<DialogTrigger nativeButton={false} render={<img className={MEDIA.image} src={src} alt={alt} draggable={false} />} />
					<DialogContent showCloseButton={false} className="flex max-h-11/12 w-auto max-w-11/12 flex-col items-center sm:max-w-11/12">
						<DialogTitle className="sr-only">Enlarged picture</DialogTitle>
						<DialogClose nativeButton={false} aria-label="Close the picture" render={<img src={src} alt="" className="min-h-0 max-w-full rounded-md object-contain" />} />
					</DialogContent>
				</Dialog>
			) : <video className={MEDIA.video} src={src} controls preload="metadata" />}
			{alt ? <span className={MEDIA.cap}>{alt}</span> : null}
		</span>
	);
}

/** A line to click instead of a picture: the address is shown, and nothing is fetched before the click. */
function Remote({ url, alt }: { url: string; alt: string }) {
	const [state, setState] = useState<{ loading?: boolean; error?: string; got?: { kind: "image" | "video" | "audio"; src: string; sound: { name: string; bytes: () => Promise<ArrayBuffer>; auto: Heard } } }>({});
	useEffect(() => () => void (state.got && URL.revokeObjectURL(state.got.src)), [state.got]);
	if (state.got) return <Player kind={state.got.kind} src={state.got.src} alt={alt} sound={state.got.sound} />;
	const kind = mediaKind(url.split(/[?#]/)[0]) ?? "image";
	const load = async () => {
		if (state.loading) return;
		setState({ loading: true });
		try {
			const got = await api.fetchImage(url);
			const kind = got.mime.startsWith("video/") ? "video" : got.mime.startsWith("audio/") ? "audio" : "image";
			const blob = new Blob([bytesOf(got.base64)], { type: got.mime });
			// The click asked for it: a sound that was loaded plays, as it does in the terminal UI.
			setState({ got: { kind, src: URL.createObjectURL(blob), sound: { name: baseName(url.split(/[?#]/)[0]), bytes: () => blob.arrayBuffer(), auto: { heard: false } } } });
		} catch (err) {
			setState({ error: errText(err) });
		}
	};
	const label = state.loading ? `Loading ${short(url, 90)}` : state.error ? `Could not load ${short(url, 70)}: ${state.error}` : `Load ${kind === "image" ? "picture" : kind} · ${short(url, 90)}`;
	return (
		<Button variant="outline" size="xs" data-remote={url} title={state.error ? `${url}: ${state.error}` : url} className="max-w-full" disabled={state.loading} onClick={() => void load()}>
			{/* Loading, the stock way: an indicator as the button's icon, and the button disabled. */}
			{state.loading ? <Pulse label="Loading" data-icon="inline-start" /> : null}
			<span className="truncate">{label}</span>
		</Button>
	);
}

function Picture({ src, alt, node }: React.ComponentProps<"img"> & ExtraProps) {
	const where = useContext(WhereContext);
	const url = typeof src === "string" ? src : "";
	const words = alt ?? "";
	if (isWeb(url)) return <Remote url={url} alt={words} />;
	if (DATA_IMAGE.test(url)) return <Player kind="image" src={url} alt={words} />;
	if (where && url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) {
		const kind = mediaKind(url.split(/[?#]/)[0]);
		let file = url;
		try {
			file = decodeURIComponent(url);
		} catch {
			// as written
		}
		// Where in the answer it stands tells two sounds of one answer apart.
		const sound = kind === "audio" ? { id: where.id && `${where.id}:${node?.position?.start.offset ?? file}`, name: baseName(file), bytes: async () => (await api.workspaceSound(where.agent, file, where.session)).buffer, auto: where.arrived } : undefined;
		if (kind) return <Player kind={kind} src={media.workspace(where.agent, file, where.session)} alt={words} sound={sound} />;
	}
	return <>{words || url}</>;
}

/** A folded part written as raw HTML (`<details>`), drawn as shadcn's Collapsible. `open` in the text is
 *  where it starts; from then on it is the reader's, and it stays as they left it while the text grows,
 *  since the component is the same on every render (COMPONENTS is a constant) and keeps its own state. */
function Details({ open, children }: React.ComponentProps<"details"> & ExtraProps) {
	const parts = Children.toArray(children);
	const isSummary = (part: ReactNode) => isValidElement<ExtraProps>(part) && part.props.node?.tagName === "summary";
	return (
		<Collapsible defaultOpen={open !== undefined && open !== false} data-details="" className="my-3 rounded-lg border px-3">
			{parts.filter(isSummary)}
			<CollapsibleContent className="pb-2.5">{parts.filter((part) => !isSummary(part))}</CollapsibleContent>
		</Collapsible>
	);
}

function Summary({ children }: React.ComponentProps<"summary"> & ExtraProps) {
	return (
		<CollapsibleTrigger className={cn("group flex w-full cursor-pointer items-center gap-1 py-2 text-left font-medium text-muted-foreground select-none hover:text-foreground", FOCUS)}>
			<ChevronRightIcon className="size-4 shrink-0 transition-transform group-data-panel-open:rotate-90" aria-hidden />
			{children}
		</CollapsibleTrigger>
	);
}

const DefaultCode = defaultComponents.code as React.ComponentType<React.ComponentProps<"code"> & ExtraProps>;

/** Inline code is Streamdown's own; a block is the stock Code Block (AnswerCode). */
function Code(props: React.ComponentProps<"code"> & ExtraProps) {
	if (!("data-block" in props)) return createElement(DefaultCode, props);
	const language = /(?:^|\s)language-(\S+)/.exec(props.className ?? "")?.[1]?.toLowerCase() ?? "";
	const meta = (props as { metastring?: unknown }).metastring;
	const title = typeof meta === "string" ? /\btitle=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(meta) : null;
	return <AnswerCode code={textOf(props.node).replace(/\n$/, "")} language={language} file={(title?.[1] ?? title?.[2] ?? title?.[3])?.trim() || undefined} />;
}

/** The lines of a block, colored by Streamdown's highlighter in pine's code colors (CODE_THEME), or plain
 *  while the highlighter loads and for a language it does not know. */
function useCodeLines(code: string, language: string, incomplete: boolean): ReactNode[] {
	const [late, setLate] = useState<{ code: string; tokens: HighlightResult } | undefined>();
	const known = language !== "" && PLUGINS.code.supportsLanguage(language as never);
	const now = known ? PLUGINS.code.highlight({ code, language: language as never, themes: CODE_THEMES, isIncomplete: incomplete }, (tokens) => setLate({ code, tokens })) : null;
	const tokens = now ?? (late?.code === code ? late.tokens : undefined);
	if (!tokens) return code.split("\n");
	// With two themes, a token's look is in its htmlStyle: its color, and its font style as a variable,
	// which is read here since both themes are pine's.
	return tokens.tokens.map((line) =>
		line.map((token, i) => {
			const style = (token.htmlStyle ?? {}) as Record<string, string>;
			return (
				<span key={i} style={{ color: style.color, fontStyle: style["--shiki-dark-font-style"] }}>
					{token.content}
				</span>
			);
		}),
	);
}

/**
 * A block of code in an answer: the stock Code Block, its language in the header beside the copy button.
 * A block of shell commands in a conversation also has a Run button, which runs it in a terminal of this
 * computer: where the app uses another machine's pine, there is none, and while the block is still
 * being written it waits.
 */
function AnswerCode({ code, language, file }: { code: string; language: string; file?: string }) {
	const where = useContext(WhereContext);
	const incomplete = useIsCodeFenceIncomplete();
	const lines = useCodeLines(code, language, incomplete);
	const runnable = Boolean(where?.session) && SHELLS.has(language) && !store.remote;
	// The header names the file the block's opening line gives (```ts title="src/app.ts"), with a file's
	// icon as shadcn's example of Code Block shows one; otherwise the language, or "text", as shadcn's
	// Markdown example does.
	return (
		<CodeBlock data-language={language || undefined} data-shell={runnable || undefined}>
			<CodeBlockHeader>
				{file ? (
					<CodeBlockTitle title={file}>
						<FileCodeIcon />
						{file}
					</CodeBlockTitle>
				) : (
					<CodeBlockTitle>{language || "text"}</CodeBlockTitle>
				)}
				<CodeBlockActions>
					<CodeBlockCopyButton value={code} />
					{runnable && where?.session && !incomplete ? (
						<Button variant="ghost" size="icon-xs" data-run="" aria-label="Run in the terminal" title="Run in this conversation's terminal" onClick={() => store.runInTerminal(where.agent, where.session!, code)}>
							<PlayIcon />
						</Button>
					) : null}
				</CodeBlockActions>
			</CodeBlockHeader>
			<CodeBlockContent>
				{lines.map((line, i) => (
					<CodeBlockLine key={i}>{line}</CodeBlockLine>
				))}
			</CodeBlockContent>
		</CodeBlock>
	);
}

// A table is shadcn's Table, not Streamdown's own (a frame of its own that stops at 300 pixels and
// scrolls inside the conversation). It scrolls sideways in a ScrollArea, as shadcn scrolls sideways,
// rather than in Table's own container, whose scrollbar is the system's and covers the last row. A side
// with more of the table beyond it fades out (stock scroll-fade-x), which says there is more to see.
// Unlike stock, a cell's text goes onto more lines, between words only, so that a sentence in a cell
// is not one long line on a phone; an address or a piece of code is one long word, and breaks anywhere.
function AnswerTable({ node: _, className, ...props }: React.ComponentProps<"table"> & ExtraProps) {
	return (
		<ScrollArea className="*:data-[slot=scroll-area-viewport]:scroll-fade-x **:data-[slot=table-container]:overflow-visible">
			<Table className={cn("wrap-break-word [&_:is(a,code)]:wrap-anywhere", className)} {...props} />
			<ScrollBar orientation="horizontal" />
		</ScrollArea>
	);
}

function AnswerCell({ node: _, className, ...props }: React.ComponentProps<"td"> & ExtraProps) {
	return <TableCell className={cn("align-top whitespace-normal", className)} {...props} />;
}

// Lists as shadcn's typography draws them: the marker outside, so that a wrapped line starts under the
// text and not under the bullet (Streamdown puts it inside, and makes a paragraph in an item inline,
// which runs an item's two paragraphs into one line).
function List({ node: _, className, ...props }: React.ComponentProps<"ul"> & ExtraProps) {
	return <ul className={cn("ml-6 list-disc [&>li]:mt-2", className)} {...props} />;
}

function NumberedList({ node: _, className, ...props }: React.ComponentProps<"ol"> & ExtraProps) {
	return <ol className={cn("ml-6 list-decimal [&>li]:mt-2", className)} {...props} />;
}

function ListItem({ node: _, className, children, ...props }: React.ComponentProps<"li"> & ExtraProps & { "data-task"?: "done" | "todo" }) {
	const task = props["data-task"];
	// A task: the stock Checkbox where the marker was, read only, centred on the first line of its words.
	if (task) {
		return (
			<li className={cn("-ms-6 flex list-none items-start gap-2", className)} {...props}>
				<span className="flex h-lh items-center">
					<Checkbox checked={task === "done"} readOnly aria-label={task === "done" ? "Done" : "To do"} />
				</span>
				<div className="min-w-0 flex-1 [&>p:not(:first-child)]:mt-2">{children}</div>
			</li>
		);
	}
	return (
		<li className={cn("[&>p:not(:first-child)]:mt-2", className)} {...props}>
			{children}
		</li>
	);
}

// A quote as shadcn's typography draws one: a thin rule and italics, in the text's own color, so that
// it reads as well as the rest of the answer.
function Quote({ node: _, className, ...props }: React.ComponentProps<"blockquote"> & ExtraProps) {
	return <blockquote className={cn("flex flex-col gap-2 border-s-2 ps-6 italic", className)} {...props} />;
}

// Headings as shadcn's typography sets them, on the answer's own scale: the reading part is at the
// reading size, and each level stands a clear step above the next, not at Streamdown's fixed 30 pixels.
// A heading has more room above it than below (Streamdown's gap between blocks), so it reads with
// what it opens, apart from what it closes; h2 carries typography's rule under it.
const HEADING = {
	h1: "mt-10 text-2xl leading-tight font-semibold tracking-tight",
	h2: "mt-10 border-b pb-2 text-xl leading-tight font-semibold tracking-tight",
	h3: "mt-8 text-lg leading-snug font-semibold tracking-tight",
	h4: "mt-6 text-read font-semibold",
	h5: "mt-6 text-read font-semibold",
	h6: "mt-6 text-read font-semibold text-muted-foreground",
} as const;
function heading(Tag: keyof typeof HEADING) {
	return function Heading({ node: _, className, ...props }: React.ComponentProps<"h1"> & ExtraProps) {
		return <Tag className={cn("scroll-mt-4 text-balance", HEADING[Tag], className)} {...props} />;
	};
}

function KeyName({ node: _, ...props }: React.ComponentProps<"kbd"> & ExtraProps) {
	return <Kbd {...props} />;
}

/** Bold as <strong>, which says it matters, where Streamdown draws a span. */
function Strong({ node: _, ...props }: React.ComponentProps<"strong"> & ExtraProps) {
	return <strong className="font-semibold" {...props} />;
}

function Rule() {
	return <Separator />;
}

/** A section of the answer; the footnotes are secondary text, muted as a description is. */
function Section({ node: _, className, ...props }: React.ComponentProps<"section"> & ExtraProps & { "data-footnotes"?: unknown }) {
	return <section className={cn(props["data-footnotes"] !== undefined && "text-sm text-muted-foreground", className)} {...props} />;
}

/** A stock part drawn for an element of the answer, without the syntax tree Streamdown hands it. */
function bare<P extends object>(Part: React.ComponentType<P>) {
	return function Bare({ node: _, ...props }: P & ExtraProps) {
		return <Part {...(props as P)} />;
	};
}

const COMPONENTS: Components = {
	a: Link,
	img: Picture,
	details: Details,
	summary: Summary,
	code: Code,
	ul: List,
	ol: NumberedList,
	li: ListItem,
	blockquote: Quote,
	h1: heading("h1"),
	h2: heading("h2"),
	h3: heading("h3"),
	h4: heading("h4"),
	h5: heading("h5"),
	h6: heading("h6"),
	kbd: KeyName,
	strong: Strong,
	hr: Rule,
	section: Section,
	table: AnswerTable,
	thead: bare(TableHeader),
	tbody: bare(TableBody),
	tfoot: bare(TableFooter),
	tr: bare(TableRow),
	th: bare(TableHead),
	td: AnswerCell,
	caption: bare(TableCaption),
};
/**
 * The highlighter's theme for code in answers: every color is a `--code-*` variable of index.css, the
 * ones the code editor reads, so that code in an answer and in the code pane look the same and both
 * follow pine's theme (theme.ts). The variables change with the theme, so one highlighter theme serves
 * them all. Scopes are TextMate's, mapped to the editor's kinds.
 */
const v = (name: string) => `var(--code-${name})`;
const CODE_THEME = {
	name: "pine-code",
	type: "dark" as const,
	fg: v("text"),
	bg: "transparent",
	colors: { "editor.foreground": v("text"), "editor.background": "transparent" },
	settings: [
		{ settings: { foreground: v("text") } },
		{ scope: ["comment", "punctuation.definition.comment"], settings: { foreground: v("comment"), fontStyle: "italic" } },
		{ scope: ["meta.decorator", "meta.preprocessor"], settings: { foreground: v("meta") } },
		{ scope: ["keyword", "storage"], settings: { foreground: v("keyword") } },
		{ scope: ["storage.type"], settings: { foreground: v("definition") } },
		{ scope: ["keyword.control"], settings: { foreground: v("control") } },
		{ scope: ["storage.modifier", "keyword.operator.new", "keyword.operator.expression", "variable.language.this", "variable.language.self"], settings: { foreground: v("modifier") } },
		{ scope: ["string", "punctuation.definition.string"], settings: { foreground: v("string") } },
		{ scope: ["string.regexp", "constant.character.escape"], settings: { foreground: v("regexp") } },
		{ scope: ["constant.numeric", "constant.language.boolean", "constant.other", "markup.underline.link"], settings: { foreground: v("literal") } },
		{ scope: ["constant.language.null", "constant.language.undefined", "constant.language.nil"], settings: { foreground: v("null") } },
		{ scope: ["variable", "variable.other.property", "meta.object-literal.key", "support.type.property-name"], settings: { foreground: v("name") } },
		{ scope: ["entity.other.attribute-name"], settings: { foreground: v("attribute") } },
		{ scope: ["entity.name.function", "support.function", "meta.function-call entity.name.function"], settings: { foreground: v("call") } },
		{ scope: ["meta.definition.function entity.name.function", "meta.function entity.name.function", "entity.name.class", "entity.name.type.class"], settings: { foreground: v("function") } },
		{ scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: v("type") } },
		{ scope: ["entity.name.namespace", "entity.name.module"], settings: { foreground: v("namespace") } },
		{ scope: ["entity.name.tag"], settings: { foreground: v("tag") } },
		{ scope: ["markup.heading", "entity.name.section"], settings: { foreground: v("heading"), fontStyle: "bold" } },
		{ scope: ["markup.italic", "markup.bold"], settings: { foreground: v("emphasis") } },
		{ scope: ["markup.inserted"], settings: { foreground: v("inserted") } },
		{ scope: ["markup.deleted"], settings: { foreground: v("deleted") } },
		{ scope: ["punctuation"], settings: { foreground: v("punctuation") } },
		{ scope: ["keyword.operator"], settings: { foreground: v("operator") } },
	],
};
const CODE_THEMES: [typeof CODE_THEME, typeof CODE_THEME] = [CODE_THEME, CODE_THEME];
const PLUGINS = { code: createCodePlugin({ themes: CODE_THEMES }) };
const CONTROLS: ControlsConfig = { code: { copy: true, download: false }, table: false, mermaid: false, image: false };

// Streamdown draws every element with its own look, and a folded part written as raw HTML is
// Details above. `data-slot="markdown"` and `data-live` are what the tests look for.
const LOOK = "cursor-auto select-text wrap-anywhere";

/** Markdown, drawn into the page. While `live`, the text grows; what the reader opened stays open. `follow` takes the
 *  links that are not web addresses, for text of pine's own: an answer has none, and its such links stay words. */
export const Markdown = memo(function Markdown({ text, where, live, follow }: { text: string; where?: Where; live?: boolean; follow?: Follow }): ReactNode {
	return (
		<WhereContext.Provider value={where}>
			<FollowContext.Provider value={follow}>
			<Streamdown data-slot="markdown" data-live={live || undefined} className={LOOK} caret="block" rehypePlugins={REHYPE as never} components={COMPONENTS} plugins={PLUGINS} controls={CONTROLS} linkSafety={{ enabled: false }} shikiTheme={CODE_THEMES} isAnimating={!!live} lineNumbers={false}>
				{text}
			</Streamdown>
			</FollowContext.Provider>
		</WhereContext.Provider>
	);
});
