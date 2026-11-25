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
import { ArrowRightIcon, ChevronRightIcon, PlayIcon } from "lucide-react";
import { Children, createContext, createElement, isValidElement, memo, useContext, useEffect, useState, type ReactNode } from "react";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { type Options as Schema } from "rehype-sanitize";
import { CodeBlock, CodeBlockCopyButton, defaultComponents, Streamdown, useIsCodeFenceIncomplete, type Components, type ControlsConfig, type ExtraProps } from "streamdown";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
		code: [["className", /^language-./]],
		th: ["align", "colSpan", "rowSpan", "scope"],
		td: ["align", "colSpan", "rowSpan"],
		ol: ["start", "reversed"],
		li: ["value"],
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

const REHYPE = [rehypeRaw, [rehypeSanitize, CLEAN]] as const;

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
	const url = typeof href === "string" ? href : "";
	const shown = textOf(node).trim();
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
						<DialogTitle className="sr-only">The picture, larger</DialogTitle>
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

/** Code: Streamdown's own, and for a block of shell commands in a conversation, the same block with a Run button.
 *  The button runs it in a terminal of this computer: where the app uses another machine's pine, there is none. */
function Code(props: React.ComponentProps<"code"> & ExtraProps) {
	const where = useContext(WhereContext);
	const language = /(?:^|\s)language-(\S+)/.exec(props.className ?? "")?.[1]?.toLowerCase() ?? "";
	if (!("data-block" in props) || !where?.session || !SHELLS.has(language) || store.remote) return createElement(DefaultCode, props);
	return <ShellBlock code={textOf(props.node).replace(/\n$/, "")} language={language} agent={where.agent} session={where.session} />;
}

function ShellBlock({ code, language, agent, session }: { code: string; language: string; agent: string; session: string }) {
	const incomplete = useIsCodeFenceIncomplete();
	return (
		<CodeBlock code={code} language={language} isIncomplete={incomplete} lineNumbers={false} data-shell="">
			<CodeBlockCopyButton />
			{incomplete ? null : (
				<Button variant="ghost" size="icon-xs" data-run="" aria-label="Run in the terminal" title="Run in this conversation's terminal" onClick={() => store.runInTerminal(agent, session, code)}>
					<PlayIcon />
				</Button>
			)}
		</CodeBlock>
	);
}

const COMPONENTS: Components = { a: Link, img: Picture, details: Details, summary: Summary, code: Code };
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
// A table breaks between words only: `wrap-anywhere` makes a cell's narrowest width one letter, and
// in a narrow window the table then squeezes a column to a letter a line instead of scrolling in
// its wrapper. Headers stay on one line, as stock shadcn's TableHead does.
const LOOK = "cursor-auto select-text wrap-anywhere [&_table]:wrap-break-word [&_th]:whitespace-nowrap";

/** Markdown, drawn into the page. While `live`, the text grows; what the reader opened stays open. */
export const Markdown = memo(function Markdown({ text, where, live }: { text: string; where?: Where; live?: boolean }): ReactNode {
	return (
		<WhereContext.Provider value={where}>
			<Streamdown data-slot="markdown" data-live={live || undefined} className={LOOK} caret="block" rehypePlugins={REHYPE as never} components={COMPONENTS} plugins={PLUGINS} controls={CONTROLS} linkSafety={{ enabled: false }} shikiTheme={CODE_THEMES} isAnimating={!!live} lineNumbers={false}>
				{text}
			</Streamdown>
		</WhereContext.Provider>
	);
});
