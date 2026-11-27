// One tab's conversation: what was said, the work of each turn folded into a line, and what
// waits for the owner. Each kind of line is a small component; the list only draws what changed.
// The parts are shadcn's chat components, composed the way its AI Elements pages show: the thread
// is Message Scroller, a turn is Message (and Bubble for the owner's), the work of a turn is Trace
// (Task, Tool, Reasoning, Subagent and Plan), a request is an Item (Confirmation), a note is a Marker.
import { ArrowUpRightIcon, BookmarkIcon, BrainIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, CircleCheckIcon, CircleDotIcon, CircleIcon, ClockIcon, FolderIcon, GitBranchIcon, InfoIcon, ListChecksIcon, type LucideIcon, PaperclipIcon, PlayIcon, QuoteIcon, ReplyIcon, SearchIcon, SettingsIcon, SquareIcon, StarIcon, TargetIcon, TriangleAlertIcon, Undo2Icon, UsersIcon, XIcon, ZapIcon } from "lucide-react";
import { Fragment, memo, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { Sound } from "@/components/sound";
import { contextMenu } from "@/components/page-menu";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Attachment, AttachmentContent, AttachmentGroup, AttachmentMedia, AttachmentTitle } from "@/components/ui/attachment";
import { AgentAvatar } from "@/components/agent-avatar";
import { AgentFacts } from "@/components/agent-facts";
import { ModelNotice } from "@/components/model-notice";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Item as Card, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { COMPOSER_QUESTION, ComposerCardSlot, QuestionCard, QuestionCardHost, QuestionTrace } from "@/components/question-card";
import { Kbd } from "@/components/ui/kbd";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message";
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport, useMessageScroller } from "@/components/ui/message-scroller";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Toggle } from "@/components/ui/toggle";
import { HoverTooltip } from "@/components/hover-tooltip";
import { QuoteChip } from "@/components/quote-chip";
import { SwirlMarker } from "@/components/swirl-marker";
import { BookmarkList } from "@/components/bookmark-list";
import { SelectionToolbar, SelectionToolbarButton, useTextSelection } from "@/components/selection-toolbar";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { cn } from "@/lib/utils";
import { type AgentDetail, api, media, type TranscriptEntry } from "./api.ts";
import { bridge } from "./bridge.ts";
import { Composer } from "./Composer.tsx";
import { WelcomeLetter } from "./WelcomeLetter.tsx";
import { Markdown, MEDIA } from "./markdown.tsx";
import { runs } from "./work-runs.ts";
import { type Bookmark, isPick, type Item, type Part, type QuoteSource, quoteId, type SentQuote, type Steer, store, type Tab, type Tone, useModel, useSignal } from "./model.ts";
import { SetupCard, SetupScript } from "./setup/engine.tsx";
import { childKind, clock, count, oneLine, plural, short, shortcut, speedText, tilde, took } from "./text.ts";
import { Pulse } from "@/components/pulse";
import { sameSource } from "../../src/quotes.ts";

/** A note's tone is information (a warning, a failure), so it colors the note's icon. */
const NOTE_TONE: Record<string, string | undefined> = { warn: "text-warn", bad: "text-destructive", good: "text-primary", accent: "text-primary" };

const TONE_ICON: Record<Tone, LucideIcon> = { muted: InfoIcon, warn: TriangleAlertIcon, bad: TriangleAlertIcon, good: CheckIcon, accent: Undo2Icon };

type RunStatus = "run" | "ok" | "fail" | "done" | "failed" | "cancelled";

/** What Trace calls the state of a line: running, failed, or nothing to say. */
/**
 * A step at work fades out and in, in steps, as the dots at work do, in place of the stock trace's
 * shimmer: a shimmer moves a gradient through the text, which the page paints again every frame for
 * as long as the step runs, a fifth of a core; a fade in steps is the system's to draw, and costs
 * nearly nothing (desktop/test/view-perf.test.ts measures both). Important, since the stock trace sets
 * the shimmer from its line, which outweighs a class of the title's.
 */
const STEPPED = "bg-none! [-webkit-text-fill-color:currentColor]! in-data-[status=running]:[animation:pulse_2s_steps(4,jump-none)_infinite]! motion-reduce:animate-none!";

const traceStatus = (status: RunStatus) => (status === "run" ? "running" : status === "fail" || status === "failed" ? "error" : undefined);

/** The icon of a line that runs: the breathing dot while it does (an agent at work), then how it ended. */
function StatusIcon({ status }: { status: RunStatus }) {
	if (status === "run") return <Pulse />;
	return status === "ok" || status === "done" ? <CheckIcon /> : <XIcon />;
}

/**
 * Thinking, as a line (Reasoning). It is open while the model thinks, showing the end of what it
 * thinks, and folds when it is done; once the owner opened or closed it, that choice stays. Its
 * text is shown as it is, never drawn as markdown: it is the model's own words.
 */
function Thought({ text, title, description, live = false }: { text: string; title: string; description?: string; live?: boolean }) {
	const [open, setOpen] = useState<boolean>();
	const line = (
		<TraceLine status={live ? "running" : undefined}>
			<TraceIcon>
				<BrainIcon />
			</TraceIcon>
			<TraceTitle className={STEPPED}>{title}</TraceTitle>
			{description ? <TraceDescription>{description}</TraceDescription> : null}
		</TraceLine>
	);
	if (!text) return <div data-part="thought">{line}</div>;
	return (
		<TraceCollapsible open={open ?? live} onOpenChange={setOpen} data-part="thought">
			<TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
			<TraceCollapsibleContent>
				<ThoughtText text={text} live={live} />
			</TraceCollapsibleContent>
		</TraceCollapsible>
	);
}

/**
 * The whole text of a thought, always: a box that only grows up to its height, so the thread above never
 * moves. While it streams, the box follows the end of the text, unless the owner scrolled up to read: a
 * Message Scroller of its own, nested in the thread's. It opens where the thought was when it was opened:
 * at the end while the model thinks, at the beginning once it is done.
 */
function ThoughtText({ text, live }: { text: string; live: boolean }) {
	const [from] = useState<"start" | "end">(live ? "end" : "start");
	return (
		<MessageScrollerProvider autoScroll={live} defaultScrollPosition={from}>
			<MessageScroller>
				<MessageScrollerViewport aria-label="Thinking" className="max-h-80">
					<MessageScrollerContent className="gap-0">
						<MessageScrollerItem className="whitespace-pre-wrap select-text">{text}</MessageScrollerItem>
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton size="icon-xs" />
			</MessageScroller>
		</MessageScrollerProvider>
	);
}

/** One tool call (Tool): a line with what it did, which opens on what it returned or why it failed. */
function Call({ tool, subject, status, ms, depth = 0, output, error, images }: { tool: string; subject?: string; status: "run" | "ok" | "fail"; ms?: number; depth?: number; output?: string; error?: string; images?: string[] }) {
	const more = Boolean(output || error || images?.length);
	// A call made inside another one is drawn under it, by how deep it is.
	const root = { "data-part": "tool", style: depth ? { paddingLeft: `calc(var(--spacing) * ${depth * 3.5})` } : undefined };
	const line = (
		<TraceLine status={traceStatus(status)} {...(more ? {} : root)}>
			<TraceIcon>
				<StatusIcon status={status} />
			</TraceIcon>
			{/* Font family only: a tool's name and its subject are code. */}
			<TraceTitle className={cn("font-mono", STEPPED)} title={subject}>
				<span data-tool>{tool}</span>
				{subject ? ` ${subject}` : null}
			</TraceTitle>
			{ms !== undefined ? <TraceDescription>{took(ms)}</TraceDescription> : null}
		</TraceLine>
	);
	// A line until there is something to open (Trace's rule).
	if (!more) return line;
	return (
		<TraceCollapsible {...root}>
			<TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
			<TraceCollapsibleContent className="flex flex-col gap-2">
				{output || error ? (
					<CodeBlock size="sm" variant={error ? "destructive" : "default"}>
						<CodeBlockContent wrap className="max-h-64 select-text">
							{error ?? output}
						</CodeBlockContent>
					</CodeBlock>
				) : null}
				{(images ?? []).map((id) => (
					<div className={MEDIA.box.image} key={id}>
						<Dialog>
							<DialogTrigger nativeButton={false} aria-label="Enlarge the picture" render={<img className={MEDIA.image} src={media.tool(id)} alt="" />} />
							<DialogContent showCloseButton={false} className="flex max-h-11/12 w-auto max-w-11/12 flex-col items-center sm:max-w-11/12">
								<DialogTitle className="sr-only">Enlarged picture</DialogTitle>
								<DialogClose nativeButton={false} aria-label="Close the picture" render={<img src={media.tool(id)} alt="" className="min-h-0 max-w-full rounded-md object-contain" />} />
							</DialogContent>
						</Dialog>
					</div>
				))}
			</TraceCollapsibleContent>
		</TraceCollapsible>
	);
}

/**
 * A sub-task (Subagent): who does it and what, as a line that opens its own tab. Its own calls
 * are not in this conversation's stream, so they are read in that tab and not drawn here.
 */
function Child({ part }: { part: Extract<Part, { p: "child" }> }) {
	return (
		<button type="button" data-part="child" className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50" style={part.depth > 1 ? { paddingLeft: `calc(var(--spacing) * ${(part.depth - 1) * 3.5})` } : undefined} onClick={() => void store.openTask(part.task)}>
			<TraceLine status={traceStatus(part.status)}>
				<TraceIcon>
					<StatusIcon status={part.status} />
				</TraceIcon>
				<TraceTitle className={STEPPED}>
					↳ {part.agent} · {childKind(part.kind)} #{part.task}
					{part.how ? ` ${part.how}` : part.label ? `: ${part.label}` : ""}
					<span className="sr-only"> (opens in a new tab)</span>
				</TraceTitle>
				<TraceIcon>
					<ArrowUpRightIcon />
				</TraceIcon>
			</TraceLine>
		</button>
	);
}

function PartLine({ part, live }: { part: Part; live: boolean }) {
	if (part.p === "thought") {
		const running = live && !part.done;
		const time = running ? `${Math.round((Date.now() - part.startedAt) / 1000)}s` : part.done ? took(part.ms) : "";
		return <Thought text={part.text} live={running} title={running ? "Thinking" : "Thought"} description={[time, part.speed].filter(Boolean).join(" · ")} />;
	}
	if (part.p === "words") return <p className="whitespace-pre-wrap select-text" data-part="words">{part.text}</p>;
	if (part.p === "child") return <Child part={part} />;
	return <Call tool={part.tool} subject={part.subject} status={part.status} ms={part.ms} depth={part.depth} error={part.status === "fail" ? part.preview : undefined} />;
}

/** "12 tool calls · bash ×6 · read ×4 · edit · +1 more · 2 thoughts · 1 failed" */
function workHead(parts: Part[], done: boolean): string {
	const tools = parts.filter((p) => p.p === "tool") as Array<Extract<Part, { p: "tool" }>>;
	const by = new Map<string, number>();
	for (const t of tools) by.set(t.tool, (by.get(t.tool) ?? 0) + 1);
	const top = [...by].sort((a, b) => b[1] - a[1]);
	const thoughts = parts.filter((p) => p.p === "thought").length;
	const subs = parts.filter((p) => p.p === "child").length;
	const failed = tools.filter((t) => t.status === "fail").length;
	return [
		tools.length ? `${plural(tools.length, "tool call")}${done ? "" : " so far"}` : "",
		...top.slice(0, 3).map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)),
		top.length > 3 ? `+${top.length - 3} more` : "",
		subs ? plural(subs, "sub-task") : "",
		thoughts ? plural(thoughts, "thought") : "",
		failed ? `${failed} failed` : "",
	]
		.filter(Boolean)
		.join(" · ");
}

/** The work of a turn (Task): a summary line that opens into its steps as they are taken. */
function Work({ item }: { item: Extract<Item, { t: "work" }> }) {
	const [open, setOpen] = useState(item.open);
	const parts = item.parts;
	// A turn with a single call or thought is that call or thought itself, with no line above it.
	if (parts.length === 1 && item.done)
		return (
			<Trace data-item="work">
				<PartLine part={parts[0]} live={false} />
			</Trace>
		);
	const shown = open ? parts : item.done ? [] : parts.slice(-6);
	const head = workHead(parts, item.done) || "working";
	const description = item.done ? (item.ms !== undefined ? took(item.ms) : "") : !open && parts.length > 6 ? "show all" : "";
	// While the turn runs its last lines show under the head; a click shows all of them, another folds it.
	return (
		<TraceCollapsible open={shown.length > 0} onOpenChange={() => ((item.open = !open), setOpen(!open))} data-item="work" data-open={open || undefined}>
			<TraceCollapsibleTrigger>
				<TraceLine status={item.done ? undefined : "running"}>
					<TraceIcon>{item.done ? <ListChecksIcon /> : <Pulse />}</TraceIcon>
					<TraceTitle className={STEPPED} title={head}>{head}</TraceTitle>
					{description ? <TraceDescription>{description}</TraceDescription> : null}
				</TraceLine>
			</TraceCollapsibleTrigger>
			<TraceCollapsibleContent className="flex flex-col gap-2">
				{/* One Trace per run of steps: what the agent said on the way ends a run (Trace's rule). */}
				{runs(parts, parts.length - shown.length).map((run) =>
					run.words ? (
						<PartLine key={run.key} part={run.words} live={!item.done} />
					) : (
						<Trace key={run.key}>
							{run.steps.map(({ part, at }) => (
								<PartLine key={at} part={part} live={!item.done} />
							))}
						</Trace>
					),
				)}
			</TraceCollapsibleContent>
		</TraceCollapsible>
	);
}

/** The owner's turn (or a task's prompt): a bubble on the owner's side, with the files it brought. */
/** A message of the owner's. With `menu`, a right click on it offers to branch from it. */
export function OwnerTurn({ text, from, files, menu, skeleton, footer, quotes, onQuote, quoteTask }: { text?: string; from?: string; files?: string[]; menu?: () => void; quotes?: SentQuote[]; onQuote?: (quote: SentQuote) => void; quoteTask?: number; /** While the conversation loads: a bubble's shape on the owner's side, from stock Skeleton. */ skeleton?: boolean; /** A line under the bubble (whether running work read it). */ footer?: ReactNode }) {
	if (skeleton)
		return (
			<Message align="end" data-item="user-skeleton">
				<MessageContent>
					<Skeleton className="h-9 w-56 rounded-2xl" />
				</MessageContent>
			</Message>
		);
	const body = text ?? "";
	return (
		<Message align="end" data-item="user" data-quote-task={quoteTask} data-quote-part={quoteTask === undefined ? undefined : "prompt"} onContextMenu={menu ? (e) => (e.preventDefault(), menu()) : undefined}>
			<MessageContent>
				{from ? <MessageHeader>{from}</MessageHeader> : null}
				<Bubble align="end" variant="muted">
					<BubbleContent className="whitespace-pre-wrap select-text">
						{quotes?.length && quotes.some((q) => q.reply?.trim()) ? (
							<div className={cn("flex flex-col gap-3", body.trim() && "mb-3")}>
								{quotes.map((q, i) => (
									<div key={i} data-slot="quote-with-reply" className="flex min-w-0 flex-col items-start gap-1">
										<QuoteChip text={q.text} className="bg-background whitespace-normal" onOpen={onQuote ? () => onQuote(q) : undefined} />
										{q.reply?.trim() ? (
											<div data-slot="quote-reply-text" className="flex min-w-0 gap-1.5 self-stretch border-l-2 border-border pl-2">
												<ReplyIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
												<span className="min-w-0 break-words">{q.reply.trim()}</span>
											</div>
										) : null}
									</div>
								))}
							</div>
						) : quotes?.length ? (
							<div className={cn("flex flex-wrap gap-1.5 whitespace-normal", body.trim() && "mb-2")}>
								{quotes.map((q, i) => (
									<QuoteChip key={i} text={q.text} className="bg-background" onOpen={onQuote ? () => onQuote(q) : undefined} />
								))}
							</div>
						) : null}
						{body}
					</BubbleContent>
				</Bubble>
				{files?.length ? (
					<AttachmentGroup>
						{files.map((f) => (
							<Attachment size="xs" key={f}>
								<AttachmentMedia>
									<PaperclipIcon />
								</AttachmentMedia>
								<AttachmentContent>
									<AttachmentTitle>{f}</AttachmentTitle>
								</AttachmentContent>
							</Attachment>
						))}
					</AttachmentGroup>
				) : null}
				{footer ? <MessageFooter>{footer}</MessageFooter> : null}
			</MessageContent>
		</Message>
	);
}

/**
 * Under a message that was given to running work: whether that work has read it. Until it has, it
 * can be sent now, which stops the step the work is on (a long command, say) so that it reads it.
 */
function SteerLine({ tab, steer }: { tab: Tab; steer: Steer }) {
	if (steer.read) return <span>read {new Date(steer.read).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>;
	// Work that ended without reading it: it is answered on its own, next.
	if (!tab.running.has(steer.into)) return null;
	return (
		<span className="flex items-center gap-1">
			not read yet ·
			<HoverTooltip>
				<TooltipTrigger render={<Button variant="link" size="xs" onClick={() => void store.sendNow(tab, steer)} />}>send now</TooltipTrigger>
				<TooltipContent>Interrupts the agent, hands it this message, and lets it continue</TooltipContent>
			</HoverTooltip>
		</span>
	);
}

/** One step of a piece of work, as its record has it: what it was given, a thought, a tool call, or what it wrote. Also drawn under the view. */
export function Entry({ entry, agent }: { entry: TranscriptEntry; agent: string }) {
	if (entry.kind === "user") return <OwnerTurn text={entry.text ?? ""} from="task" />;
	if (entry.kind === "text")
		return (
			<Message>
				<MessageContent>
					<Markdown text={entry.text ?? ""} where={{ agent }} />
				</MessageContent>
			</Message>
		);
	if (entry.kind === "thinking")
		return (
			<Trace>
				<Thought text={entry.text ?? ""} title="Thought" />
			</Trace>
		);
	const ok = entry.ok === undefined ? "run" : entry.ok ? "ok" : "fail";
	const result = entry.result ? short(entry.result, 4000) : undefined;
	return (
		<Trace>
			<Call tool={entry.tool ?? ""} subject={entry.subject ? oneLine(entry.subject) : ""} status={ok} ms={entry.ms} output={ok === "fail" ? undefined : result} error={ok === "fail" ? result : undefined} images={entry.images} />
		</Trace>
	);
}

/**
 * A request of the agent's, in the conversation (Confirmation): while it is open, an Item with
 * what it wants and why and its buttons; once answered, a line again. What needs typing (a secret)
 * opens the dialog. A question (or a sign-in's choice, `isPick`) is not drawn here while it is open: its card is above the composer
 * (`ComposerQuestion`), and it folds into a line here once answered.
 */
function ApprovalCard({ item }: { item: Extract<Item, { t: "approval" }> }) {
	const { req, state } = item;
	const question = isPick(req);
	const typed = Boolean(req.inputs?.length);
	if (question && (state === "allowed" || state === "denied")) return <QuestionTrace data-item="approval" data-state={state} question={req.summary} answer={item.answer} answered={state === "allowed"} by={item.by} />;
	if (state !== "open") {
		const head = state === "gone" ? "No longer open" : state === "allowed" ? "Allowed" : "Denied";
		const about = state === "gone" ? "pine restarted, or the question timed out" : [item.by ? `(${item.by})` : "", item.always && req.remember ? `${req.remember} will not ask again in this conversation` : ""].filter(Boolean).join(" · ");
		const what = [head, question ? "" : req.tool, oneLine(req.summary)].filter(Boolean).join(" · ");
		return (
			<Trace data-item="approval" data-state={state}>
				<TraceLine>
					<TraceIcon>{state === "allowed" ? <CheckIcon /> : <XIcon />}</TraceIcon>
					<TraceTitle className="select-text" title={req.summary}>
						{what}
					</TraceTitle>
					{about ? <TraceDescription className="select-text">{about}</TraceDescription> : null}
				</TraceLine>
			</Trace>
		);
	}
	if (question) return null;
	return (
		<div data-item="approval" data-state={state}>
			<Card variant="outline" size="sm">
				<ItemMedia variant="icon"><TriangleAlertIcon /></ItemMedia>
				<ItemContent>
					<ItemTitle>
						Approval needed
						<span className="font-mono">{req.tool}</span>
					</ItemTitle>
					{/* Not clamped: what is allowed here must be read whole. */}
					<ItemDescription className="line-clamp-none whitespace-pre-wrap wrap-anywhere text-foreground select-text">{req.summary}</ItemDescription>
					{req.why ? <ItemDescription className="line-clamp-none select-text">{req.why}</ItemDescription> : null}
				</ItemContent>
				<ItemActions>
					{typed ? (
						<>
							<Button size="sm" variant="outline" onClick={() => void store.decide(req.id, false)}>Deny</Button>
							<Button size="sm" onClick={() => store.ask(req.id)}>Decide…</Button>
						</>
					) : (
						<>
							<Button size="sm" variant="outline" onClick={() => void store.decide(req.id, false)}>Deny</Button>
							{req.remember ? <Button size="sm" variant="outline" onClick={() => void store.decide(req.id, true, true)}>Always here</Button> : null}
							<Button size="sm" onClick={() => void store.decide(req.id, true)}>{req.holds ? "Allow" : "Allow once"}</Button>
						</>
					)}
				</ItemActions>
			</Card>
		</div>
	);
}

/**
 * The question that is open in a conversation, as a card inline above its composer: never a dialog
 * that opens by itself. One the owner put off ("Later") is not shown; the line under the
 * conversation brings it back. It takes the keyboard as it comes only when the composer is empty,
 * so that it never takes what the owner is typing.
 */
function ComposerQuestion({ tab }: { tab: Tab }) {
	const item = store.openQuestion(tab);
	if (!item) return null;
	const { req } = item;
	const options = req.options ?? (req.choices ?? []).map((label) => ({ label }));
	const field = document.activeElement;
	const free = !field || field === document.body || (field instanceof HTMLTextAreaElement && Boolean(field.closest("[data-slot=composer]")) && !field.value.trim());
	// An agent's question takes what is typed below as the owner's own words; a sign-in's choice does
	// not: words of the owner's would mean nothing to its flow, and go as an ordinary message.
	const words = req.tool === "question";
	return (
		<ScrollArea data-slot="composer-question" className={COMPOSER_QUESTION}>
			<QuestionCard
				key={req.id}
				question={req.summary}
				header={req.header}
				from={`${req.agent} asks`}
				options={options}
				multiple={req.multiSelect}
				recommended={words}
				type={words ? (text) => (void store.answerInWords(tab, item, text), true) : undefined}
				placeholder={words ? `Answer ${req.agent}'s question in your own words…` : undefined}
				autoFocus={free && options.length > 0}
				onAnswer={(picked) => void store.answer(req, picked)}
				onNoAnswer={() => void store.decide(req.id, false)}
				onLater={() => store.putOff(req.id)}
			/>
		</ScrollArea>
	);
}

/** The agent's list of steps (its todo tool, Plan): how far it is, and each step. */
export function Steps({ items, live }: { items: Array<{ text: string; status: string }>; live: boolean }) {
	const done = items.filter((t) => t.status === "done").length;
	// A step in work that nobody works on (the turn was stopped, pine was restarted) is drawn still, not running.
	const doing = (t: { status: string }) => t.status === "in_progress" && live;
	return (
		<Trace data-item="steps">
			<TraceCollapsible defaultOpen>
				<TraceCollapsibleTrigger>
					<TraceLine status={items.some(doing) ? "running" : undefined}>
						<TraceIcon>
							<ListChecksIcon />
						</TraceIcon>
						<TraceTitle>Steps</TraceTitle>
						<TraceDescription>{done} of {items.length} done</TraceDescription>
					</TraceLine>
				</TraceCollapsibleTrigger>
				<TraceCollapsibleContent>
					<Trace>
						{items.map((t, i) => (
							<TraceLine key={i} status={doing(t) ? "running" : t.status === "done" ? undefined : "pending"}>
								<TraceIcon>{t.status === "done" ? <CircleCheckIcon /> : t.status === "in_progress" ? <CircleDotIcon /> : <CircleIcon />}</TraceIcon>
								<TraceTitle className="select-text" title={t.text}>{t.text}</TraceTitle>
							</TraceLine>
						))}
					</Trace>
				</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
}

/** The menu of a message of the owner's: what can be done from it. */
async function branchMenu(tab: Tab, task: number): Promise<void> {
	const picked = await contextMenu([{ id: "branch", label: "Branch from here" }, ...(tab.folder ? [{ id: "worktree", label: "Branch from here into a worktree" }] : [])]);
	if (picked === "branch" || picked === "worktree") await store.branch(tab.agent, tab.session, task, picked === "worktree");
}

/** One item of a conversation, drawn as what it is. */
export const Row = memo(function Row({ item, tab }: { item: Item; v: number; tab: Tab }) {
	switch (item.t) {
		case "user": {
			const task = tab.kind === "chat" ? item.task : undefined;
			const steer = tab.kind === "chat" ? item.steer : undefined;
			return <OwnerTurn text={item.text} from={item.from} files={item.files} quotes={item.quotes} quoteTask={task ?? steer?.task} onQuote={tab.kind === "chat" ? (q) => store.showQuote(tab.key, q.source) : undefined} menu={task === undefined ? undefined : () => void branchMenu(tab, task)} footer={steer ? <SteerLine tab={tab} steer={steer} /> : undefined} />;
		}
		case "answer":
			return (
				<Message data-item="answer" data-quote-task={item.task} data-quote-part="answer">
					<MessageContent>
						<Markdown text={item.text} live={item.live} where={{ agent: item.agent, session: tab.kind === "chat" ? tab.session : undefined, id: `${tab.id}:${item.id}`, arrived: item.arrived }} />
					</MessageContent>
				</Message>
			);
		case "work":
			return <Work item={item} />;
		case "note": {
			const ToneIcon = TONE_ICON[item.tone];
			return (
				// The tone is said as data too: the tests find a note by it.
				<Marker data-tone={item.tone} className="select-text">
					<MarkerIcon className={NOTE_TONE[item.tone]}>
						<ToneIcon />
					</MarkerIcon>
					<MarkerContent>
						{item.text}
						{item.action ? <Button variant="link" size="xs" onClick={item.action.run}>{item.action.label}</Button> : null}
						{item.lines?.filter((l) => l.text).map((l, i) => (
							<span key={i} className={cn("block", l.tone && NOTE_TONE[l.tone])}>{l.text}</span>
						))}
					</MarkerContent>
				</Marker>
			);
		}
		case "model": {
			// Drawn from what is known now: once a model answers, the notice is gone.
			const info = store.agent(item.agent);
			return info?.modelProblem ? <ModelNotice agent={item.agent} model={info.model} problem={info.modelProblem} retry onSetup={() => void store.openSetup()} /> : null;
		}
		case "event":
			return (
				<Alert className="select-text" data-pine={item.pine ? "" : undefined}>
					{item.pine ? <InfoIcon /> : <ZapIcon />}
					<AlertTitle>{item.label}</AlertTitle>
					{item.body.trim() ? <AlertDescription className="wrap-anywhere">{short(oneLine(tilde(item.body)), 400)}</AlertDescription> : null}
				</Alert>
			);
		case "approval":
			return <ApprovalCard item={item} />;
		case "steps":
			return <Steps items={item.items} live={item === tab.steps && tab.busy} />;
		case "media":
			return (
				<div className={MEDIA.box[item.kind]}>
					{item.kind === "image" ? (
						<Dialog>
							<DialogTrigger nativeButton={false} render={<img className={MEDIA.image} src={item.url} alt={item.name} draggable={false} />} />
							<DialogContent showCloseButton={false} className="flex max-h-11/12 w-auto max-w-11/12 flex-col items-center sm:max-w-11/12">
								<DialogTitle className="sr-only">Enlarged picture</DialogTitle>
								<DialogClose nativeButton={false} aria-label="Close the picture" render={<img src={item.url} alt="" className="min-h-0 max-w-full rounded-md object-contain" />} />
							</DialogContent>
						</Dialog>
					) : item.kind === "video" ? <video className={MEDIA.video} src={item.url} controls preload="metadata" /> : <Sound src={item.url} name={item.name} />}
					{item.kind === "audio" ? null : <div className={MEDIA.cap}>{item.name}</div>}
				</div>
			);
		case "swarm": {
			const w = item.swarm;
			return (
				<Marker className="select-text" data-item="swarm" data-state={w.status === "active" && w.checking ? "checking" : w.status}>
					<MarkerIcon>{w.status === "done" ? <CheckIcon /> : w.status === "active" ? <UsersIcon /> : <ClockIcon />}</MarkerIcon>
					<MarkerContent>
						swarm · {w.note}
						{item.full ? <span className="block">the job: {short(oneLine(w.objective), 320)}</span> : null}
					</MarkerContent>
				</Marker>
			);
		}
		case "goal": {
			const g = item.goal;
			const wait = g.status !== "met" && g.status !== "active";
			return (
				<Marker className="select-text">
					<MarkerIcon>{g.status === "met" ? <CheckIcon /> : wait ? <ClockIcon /> : <TargetIcon />}</MarkerIcon>
					<MarkerContent>
						goal · {g.note}
						{g.reason ? <span className="block">{short(oneLine(g.reason), 240)}</span> : null}
						{item.full ? <span className="block">the goal: {short(oneLine(g.objective), 320)}</span> : null}
					</MarkerContent>
				</Marker>
			);
		}
		case "divider":
			return (
				<Marker variant="separator">
					<MarkerContent>{item.text}</MarkerContent>
				</Marker>
			);
		case "entry":
			return <Entry entry={item.entry} agent={tab.agent} />;
	}
});

/**
 * The point the conversation goes back to (Checkpoint), drawn before the owner's last message:
 * the daemon takes back that message, one at a time, so this is the one place it can return to.
 */
function Checkpoint({ tab }: { tab: Tab }) {
	return (
		<SwirlMarker>
			<MarkerContent className="inline-flex items-center gap-2">
				before your last message
				<HoverTooltip>
					<TooltipTrigger render={<Button size="xs" variant="outline" onClick={() => void store.undo(tab, false)} />}>Undo</TooltipTrigger>
					<TooltipContent>
						Undo your last message. Files the agent changed are restored, the agent's answer is removed, and your message returns to the message box so you can edit it and send it again.
						<Kbd>{shortcut("⇧⌘Z")}</Kbd>
					</TooltipContent>
				</HoverTooltip>
			</MarkerContent>
		</SwirlMarker>
	);
}

/** pine's welcome letter, bound to the app: what it links to, and words put into this conversation's input. */
function Letter({ tab }: { tab: Tab }) {
	useModel(store);
	const ready = store.service.status === "ready" ? store.service : undefined;
	const home = ready?.home;
	return (
		<WelcomeLetter
			main={tab.agent}
			home={home ? tilde(home) : "~/.pine"}
			here={Boolean(home) && !store.remote}
			settings={(section) => store.openSettings(section)}
			reveal={() => home && void bridge.reveal(home)}
			say={(text) => {
				tab.draft = text;
				tab.touch();
				store.ask_("focus-input");
			}}
		/>
	);
}

/** Where a conversation with an agent begins: who it is, what it runs on and reaches, and what it has. It introduces itself when you first write to it. */
export function Welcome({ tab, skeleton }: { tab?: Tab; /** While the agent is not known yet: its avatar, name, line and badges as stock Skeleton blocks. */ skeleton?: boolean }) {
	if (skeleton || !tab)
		return (
			<Empty data-slot="welcome-skeleton">
				<EmptyHeader>
					<EmptyMedia>
						<AgentAvatar skeleton size="lg" />
					</EmptyMedia>
					<Skeleton className="h-6 w-24" />
					<Skeleton className="h-4 w-48" />
				</EmptyHeader>
				<EmptyContent>
					<WelcomeBadgesSkeleton />
				</EmptyContent>
			</Empty>
		);
	return <WelcomeCard tab={tab} />;
}

/** The count badges' places, at a badge's height (h-5), held while the agent's detail loads, so that nothing moves when it lands. */
function WelcomeBadgesSkeleton({ count = 3 }: { count?: number }) {
	return (
		<>
			{Array.from({ length: count }, (_, i) => <Skeleton key={i} className="h-5 w-20 rounded-4xl" />)}
		</>
	);
}

function WelcomeCard({ tab }: { tab: Tab }) {
	useModel(store);
	const info = store.agent(tab.agent);
	const [has, setHas] = useState<AgentDetail>();
	// Whether the detail was asked for and answered (or refused), so the badges' places are held until then.
	const [asked, setAsked] = useState<string>();
	useEffect(() => {
		let live = true;
		// (An older pine does not say; the line is then left out.)
		api.agentDetail(tab.agent).then((d) => live && (setHas(d), setAsked(tab.agent)), () => live && setAsked(tab.agent));
		return () => {
			live = false;
		};
	}, [tab.agent]);
	// The main agent without a model that answers: said once in a toast that stays, with the way to "Setup Pine".
	const problem = info?.main ? info.modelProblem : undefined;
	useEffect(() => {
		if (!problem) return;
		// Short, for the stock toast's row: its action says the rest.
		store.noModelNotice({ title: "Connect a model first", description: "Your agents can't answer you yet." });
	}, [problem]);
	const h = has?.holdings;
	const counts: Array<[string, number]> = h ? [["skill", h.skills.length], ["event source", h.sources.length], ["schedule", h.schedules.length], ["MCP server", h.servers.length], ["conversation", h.conversations.length]] : [];
	return (
		<Empty data-quote-source="welcome">
			<EmptyHeader>
				<EmptyMedia>
					<AgentAvatar agent={{ id: tab.agent, color: info?.color, main: info?.main }} size="lg" />
				</EmptyMedia>
				<EmptyTitle>
					<h1>{tab.agent}</h1>
				</EmptyTitle>
				{/* A long path is broken where the line ends, not pushed out of it. */}
				<EmptyDescription className="wrap-anywhere">{info?.description || "One of your agents."}</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<div className="flex flex-wrap justify-center gap-1.5">
					{info ? <AgentFacts agent={info} mainId={store.agents.find((a) => a.main)?.id} pick={{ model: () => void store.pickModel(tab), reasoning: () => void store.pickReasoning(tab), mode: () => void store.pickMode(tab) }} /> : null}
					{asked === tab.agent ? counts.filter(([, n]) => n > 0).map(([what, n]) => <Badge variant="outline" key={what}><b>{n}</b>{n === 1 ? what : `${what}s`}</Badge>) : <WelcomeBadgesSkeleton count={2} />}
				</div>
				{/* The main agent's says it in a toast (above); another agent's on its card. */}
				{info?.modelProblem && !info.main ? <ModelNotice agent={tab.agent} model={info.model} problem={info.modelProblem} onSetup={() => void store.openSetup()} /> : null}
				{/* The way on to what the card only names: the agent's own page, where its model, mode, tools and instructions are changed. */}
				<Button variant="outline" size="sm" data-slot="agent-settings" onClick={() => store.openSettings("agents", tab.agent)}><SettingsIcon data-icon="inline-start" />Agent settings</Button>
			</EmptyContent>
		</Empty>
	);
}

const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
const newHighlight = (...ranges: Range[]): unknown => new (window as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight(...ranges);

/**
 * Find in the conversation. The matches are marked with the browser's own highlights, which
 * change nothing in the page: no element is added to what an answer drew.
 */
function FindBar({ root, close, initial }: { root: () => HTMLElement | null; close: () => void; initial?: string }) {
	const [query, setQuery] = useState(initial ?? "");
	const [at, setAt] = useState(0);
	const ranges = useRef<Range[]>([]);
	const [count, setCount] = useState(0);
	const marks = highlights;
	useEffect(() => {
		const el = root();
		ranges.current = [];
		const q = query.toLowerCase();
		if (el && q) {
			const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode(); node && ranges.current.length < 2000; node = walker.nextNode()) {
				const text = (node.textContent ?? "").toLowerCase();
				for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) {
					const r = new Range();
					r.setStart(node, i);
					r.setEnd(node, i + q.length);
					ranges.current.push(r);
				}
			}
		}
		setCount(ranges.current.length);
		// The newest match first: what is looked for is usually near the end.
		setAt(Math.max(0, ranges.current.length - 1));
		marks?.set("pine-find", newHighlight(...ranges.current));
		return () => void (marks?.delete("pine-find"), marks?.delete("pine-find-at"));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [query]);
	useEffect(() => {
		const r = ranges.current[at];
		if (!r) return void marks?.delete("pine-find-at");
		marks?.set("pine-find-at", newHighlight(r));
		(r.startContainer.parentElement as HTMLElement | null)?.closest("details:not([open])")?.setAttribute("open", "");
		r.startContainer.parentElement?.scrollIntoView({ block: "center" });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [at, count]);
	const step = (by: number) => count && setAt((at + by + count) % count);
	return (
		// Placed over the top right corner of the conversation, under its head.
		<InputGroup className="absolute top-11.5 right-5.5 z-5 w-auto bg-card shadow-md">
			<InputGroupAddon>
				<SearchIcon />
			</InputGroupAddon>
			<InputGroupInput
				autoFocus
				className="w-55"
				aria-label="Find in this conversation"
				placeholder="Find in this conversation"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape") close();
					if (e.key === "Enter") step(e.shiftKey ? 1 : -1);
				}}
			/>
			<InputGroupAddon align="inline-end">
				{query ? <InputGroupText>{count ? `${at + 1} of ${count}` : "nothing"}</InputGroupText> : null}
				<HoverTooltip>
					<TooltipTrigger render={<InputGroupButton size="icon-xs" onClick={() => step(-1)} aria-label="Earlier" />}><ChevronUpIcon /></TooltipTrigger>
					<TooltipContent>Earlier<Kbd>{shortcut("↩")}</Kbd></TooltipContent>
				</HoverTooltip>
				<HoverTooltip>
					<TooltipTrigger render={<InputGroupButton size="icon-xs" onClick={() => step(1)} aria-label="Later" />}><ChevronDownIcon /></TooltipTrigger>
					<TooltipContent>Later<Kbd>{shortcut("⇧↩")}</Kbd></TooltipContent>
				</HoverTooltip>
				<HoverTooltip>
					<TooltipTrigger render={<InputGroupButton size="icon-xs" onClick={close} aria-label="Close" />}><XIcon /></TooltipTrigger>
					<TooltipContent>Close<Kbd>esc</Kbd></TooltipContent>
				</HoverTooltip>
			</InputGroupAddon>
		</InputGroup>
	);
}

/** The line above the input: what is going on right now, and the way to stop it. */
function StatusLine({ tab }: { tab: Tab }) {
	const [, tick] = useState(0);
	useEffect(() => {
		if (!tab.busy) return;
		const t = window.setInterval(() => tick((n) => n + 1), 1000);
		return () => window.clearInterval(t);
	}, [tab.busy]);
	// What this conversation was asked. A question of another conversation this tab holds (that one has no
	// tab of its own) is said as waiting there, and never answered from here.
	const waiting = [...tab.approvals.values()].filter((a) => !isPick(a.req) || store.ownAsk(tab, a.req));
	const held = [...tab.approvals.values()].find((a) => isPick(a.req) && !store.ownAsk(tab, a.req));
	const elsewhere = store.tabs.find((t) => t !== tab && t.approvals.size > 0);
	const goal = tab.goal?.status === "active" ? tab.goal : undefined;
	const swarm = tab.swarm?.status === "active" ? tab.swarm : undefined;
	// Nothing to say, no line: the input sits at the bottom, so the line grows the block upward and the input never moves.
	const line = (icon: ReactNode, text: string, action?: ReactNode, warn?: boolean) => (
		<Marker className="min-h-7.5 py-1.5">
			{/* A grid centers the dot of Pulse, which would otherwise sit on the text's baseline in the icon's box. */}
			{icon ? <MarkerIcon className={cn("grid place-items-center", warn && "text-warn")}>{icon}</MarkerIcon> : null}
			<MarkerContent className="min-w-0 flex-1">{text}</MarkerContent>
			{action}
		</Marker>
	);
	// A question put off ("Later"), with no other card above the composer: this line brings it back, while the agent waits too.
	const putOff = waiting.find((a) => isPick(a.req) && store.later.has(a.req.id));
	if (putOff && !store.openQuestion(tab)) return line(<TriangleAlertIcon />, "A question is waiting for your answer.", <Button variant="outline" size="xs" onClick={() => store.ask(putOff.req.id)}>Open</Button>, true);
	if (!tab.busy) {
		if (waiting.length) return line(<TriangleAlertIcon />, isPick(waiting[0].req) ? "A question is waiting for your answer." : "A request is waiting for your approval.", <Button variant="outline" size="xs" onClick={() => store.ask(waiting[0].req.id)}>Open</Button>, true);
		if (swarm) return line(<UsersIcon />, `swarm · round ${swarm.round} of ${swarm.until} · ${swarm.checking ? "checking the answer" : "looking at the board"}`, <Button variant="outline" size="xs" onClick={() => void store.setSwarm(tab, "pause")}>Pause</Button>);
		if (goal) return line(<TargetIcon />, `goal · round ${goal.round} of ${goal.until} · checking whether it is met`, <Button variant="outline" size="xs" onClick={() => void store.setGoal(tab, "pause")}>Pause</Button>);
		if (held) return line(<TriangleAlertIcon />, `${held.req.agent} has a question for you in another conversation.`, <Button variant="outline" size="xs" onClick={() => void store.goToAsk(held.req)}>Go there</Button>, true);
		if (elsewhere) return line(<TriangleAlertIcon />, `${elsewhere.agent} · ${elsewhere.session} is waiting for you.`, <Button variant="outline" size="xs" onClick={() => store.activate(elsewhere)}>Go there</Button>, true);
		if (tab.programs.length) return line(<PlayIcon />, `${plural(tab.programs.length, "program")} still running`, <Button variant="ghost" size="xs" onClick={() => void store.command("code-running")}>Show</Button>);
		return null;
	}
	const secs = Math.max(0, Math.round((Date.now() - tab.startedAt) / 1000));
	const steps = tab.steps?.items ?? [];
	const at = steps.findIndex((s) => s.status === "in_progress");
	const helpers = [...tab.children.values()].filter((c) => c.running).length;
	const total = tab.tokens.input + tab.tokens.cached;
	const parts = [
		goal ? `goal · round ${goal.round} of ${goal.until}` : "",
		swarm ? `swarm · round ${swarm.round} of ${swarm.until}` : "",
		waiting.length ? "waiting for you" : tab.thinking ? "thinking" : "working",
		clock(secs),
		at >= 0 ? `step ${at + 1} of ${steps.length}` : "",
		tab.toolCalls ? plural(tab.toolCalls, "tool call") : "",
		helpers ? `${plural(helpers, "sub-task")} running` : "",
		tab.tokens.output ? `${count(total)}↑${tab.tokens.cached ? ` (${Math.round((100 * tab.tokens.cached) / Math.max(1, total))}% cached)` : ""} ${count(tab.tokens.output)}↓` : "",
		speedText(tab.speed),
	].filter(Boolean);
	return line(<Pulse />, parts.join(" · "), waiting.length ? <Button variant="outline" size="xs" onClick={() => store.ask(waiting[0].req.id)}>Open</Button> : null, waiting.length > 0);
}

/** How full the conversation's context window is (Context): the share in the head, the rest on hover. */
function ContextUsage({ tab, percent }: { tab: Tab; percent: number }) {
	const total = tab.tokens.input + tab.tokens.cached;
	const speed = speedText(tab.speed);
	// Nearly full is a warning, about to be compacted is danger.
	const tone = percent >= 85 ? "bad" : percent >= 65 ? "warn" : undefined;
	const color = tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warn" : "text-muted-foreground";
	return (
		<HoverCard>
			<HoverCardTrigger delay={10} closeDelay={100} data-tone={tone} render={<Button variant="ghost" size="xs" className={cn("tabular-nums", color)} />}>
				{total ? `${count(total)} · ` : ""}
				{Math.round(percent)}%
			</HoverCardTrigger>
			<HoverCardContent align="end" className="flex flex-col gap-3">
				<Progress value={Math.min(100, percent)}>
					<ProgressLabel>Context</ProgressLabel>
					<ProgressValue>{() => `${total ? `${count(total)} tokens · ` : ""}${Math.round(percent)}% full`}</ProgressValue>
				</Progress>
				{tab.cacheShare !== undefined || speed ? (
					<p className="text-muted-foreground">
						{tab.cacheShare !== undefined ? `${tab.cacheShare}% of the last request came from the model server's cache.` : ""} {speed}
					</p>
				) : null}
			</HoverCardContent>
		</HoverCard>
	);
}

/**
 * What lies above a conversation or a task, oldest first: the conversations a branch was made from, one after another; for
 * a task, the conversation it was done for and the task that started it. Each opens with a click.
 */
function above(tab: Tab): Array<{ key: string; label: string; known: boolean; title: string; open: () => void }> {
	const list = store.conversations.get(tab.agent) ?? [];
	const conv = (session: string) => ({ key: `c:${session}`, label: store.titleOf(tab.agent, session), known: store.titleKnown(tab.agent, session), title: `Open the conversation ${session}`, open: () => void store.openTab(tab.agent, session) });
	if (tab.kind === "task") {
		const out = list.some((c) => c.session === tab.session) ? [conv(tab.session)] : [];
		if (tab.parent !== undefined) {
			const parent = tab.parent;
			out.push({ key: `t:${parent}`, label: `task #${parent}`, known: true, title: `Open task #${parent}, which started this one`, open: () => void store.openTask(parent) });
		}
		return out;
	}
	if (tab.kind !== "chat") return [];
	// Renames can make a circle of names: each conversation is named once.
	const out: ReturnType<typeof above> = [];
	const seen = new Set([tab.session]);
	for (let from = list.find((c) => c.session === tab.session)?.branch?.from; from && !seen.has(from); from = list.find((c) => c.session === from)?.branch?.from) {
		seen.add(from);
		out.unshift(conv(from));
	}
	return out;
}

/**
 * What a conversation is, in one line at its top, as a path: where it came from, which it is, and where it works (its
 * worktree or folder); and how full its context is. Whose it is, its tab says.
 */
function ConvHead({ tab }: { tab: Tab }) {
	useModel(store);
	const chat = tab.kind === "chat";
	const where = chat && tab.worktree ? (
		<HoverTooltip>
			<TooltipTrigger render={<Button variant="ghost" size="xs" className="min-w-0 shrink" data-worktree={tab.worktree.branch} onClick={() => void store.worktreeMenu(tab)} />}><GitBranchIcon data-icon="inline-start" /><span className="truncate">{tab.worktree.branch}</span></TooltipTrigger>
			<TooltipContent>Works in the worktree {tab.worktree.branch} of {tab.worktree.base}{tab.folder ? `, at ${tab.folder}` : ""}: merge it, update it or discard it</TooltipContent>
		</HoverTooltip>
	) : chat && tab.folder ? (
		<HoverTooltip>
			<TooltipTrigger render={<Button variant="ghost" size="xs" className="min-w-0 shrink" data-folder={tab.folder} onClick={() => void store.pickFolder(tab)} />}><FolderIcon data-icon="inline-start" /><span className="truncate">{tilde(tab.folder)}</span></TooltipTrigger>
			<TooltipContent>Works in {tab.folder}</TooltipContent>
		</HoverTooltip>
	) : null;
	return (
		<div data-slot="conversation-head" className="flex h-10 min-w-0 shrink-0 items-center gap-2 pr-2 pl-4 text-xs">
			<Breadcrumb className="min-w-0 shrink">
				<BreadcrumbList className="flex-nowrap">
					{above(tab).map((c) => (
						<Fragment key={c.key}>
							<BreadcrumbItem className="min-w-0">
								<BreadcrumbLink render={<button type="button" />} className="truncate" title={c.title} onClick={c.open}>{c.known ? c.label : <Skeleton data-slot="title-skeleton" className="inline-block h-3 w-24 align-middle" />}</BreadcrumbLink>
							</BreadcrumbItem>
							<BreadcrumbSeparator />
						</Fragment>
					))}
					<BreadcrumbItem className="min-w-0">
						{chat && !store.titleKnown(tab.agent, tab.session) ? (
							// Not known yet: a bar in its place, at the line's height, as in the sidebar and the tabs.
							<Skeleton data-slot="title-skeleton" className="h-3 w-28" />
						) : (
							<BreadcrumbPage className="truncate" title={chat ? `conversation ${tab.session}` : undefined}>{chat ? store.titleOf(tab.agent, tab.session) : `task #${tab.task}`}</BreadcrumbPage>
						)}
					</BreadcrumbItem>
					{where ? (
						<>
							<BreadcrumbSeparator />
							<BreadcrumbItem className="min-w-0">{where}</BreadcrumbItem>
						</>
					) : null}
				</BreadcrumbList>
			</Breadcrumb>
			{chat && store.pins.has(tab.key) ? <StarIcon className="size-3 text-faint" /> : null}
			<span className="min-w-0 flex-1" />
			{chat ? <BookmarkList bookmarks={tab.bookmarks} onOpen={(b) => store.showBookmark(tab.key, b)} onRemove={(b) => void store.removeBookmark(tab, b.id)} /> : null}
			{tab.context !== undefined ? <ContextUsage tab={tab} percent={tab.context} /> : null}
		</div>
	);
}

/**
 * A conversation that has not loaded yet: its shape, the owner's bubble on the right, a trace line
 * and the lines of an answer, from stock Skeleton blocks in the column the conversation is drawn in.
 */
export function ConversationSkeleton() {
	return (
		<div data-slot="conversation-skeleton" aria-busy className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3.5 overflow-hidden px-7 pt-7 pb-2">
			<OwnerTurn skeleton />
			<div className="flex items-center gap-2">
				<Skeleton className="size-3 rounded-full" />
				<Skeleton className="h-3 w-40" />
			</div>
			<div className="flex flex-col gap-2">
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-11/12" />
				<Skeleton className="h-4 w-2/3" />
			</div>
		</div>
	);
}

/** The owner's last message, the one the daemon can take back: typed here, elsewhere, or found in the history. */
function lastOwnerMessage(items: Item[]): number {
	for (let i = items.length - 1; i >= 0; i--) {
		const it = items[i];
		if (it.t === "user" && (!it.from || it.from === "elsewhere")) return i;
	}
	return -1;
}

function selectionSource(root: HTMLElement | null): QuoteSource | undefined {
	const sel = window.getSelection();
	if (!root || !sel?.rangeCount) return undefined;
	const node = sel.getRangeAt(0).startContainer;
	const el = node instanceof Element ? node : node.parentElement;
	if (!el || !root.contains(el)) return undefined;
	const msg = el.closest<HTMLElement>("[data-quote-task]");
	if (msg) {
		const task = Number(msg.dataset.quoteTask);
		const part = msg.dataset.quotePart;
		return Number.isSafeInteger(task) && (part === "prompt" || part === "answer") ? { task, part } : undefined;
	}
	const place = el.closest<HTMLElement>("[data-quote-source]")?.dataset.quoteSource;
	return place === "letter" || place === "welcome" ? place : undefined;
}

function quoteTarget(root: HTMLElement | null | undefined, source: QuoteSource): HTMLElement | null | undefined {
	return root?.querySelector<HTMLElement>(typeof source === "string" ? `[data-quote-source="${source}"]` : `[data-quote-task="${source.task}"][data-quote-part="${source.part}"]`);
}

/**
 * The row gone to, lit for a moment once the scroll has brought it in: a fade of the primary color, played by
 * the browser on the element (the tests find it among its animations), with nothing added to the page.
 */
function flash(el: HTMLElement) {
	el.animate(
		[
			{ borderRadius: "0.75rem", backgroundColor: "color-mix(in oklab, var(--primary) 12%, transparent)", boxShadow: "inset 0 0 0 2px color-mix(in oklab, var(--primary) 45%, transparent)" },
			{ borderRadius: "0.75rem", backgroundColor: "transparent", boxShadow: "inset 0 0 0 2px transparent" },
		],
		{ duration: 1500, delay: 250, easing: "ease-out", fill: "backwards" },
	);
}

function QuoteJump({ tab, root }: { tab: Tab; root: RefObject<HTMLElement | null> }) {
	const { scrollToMessage, scrollToStart } = useMessageScroller();
	const go = () => {
		const want = store.pendingQuote;
		if (!want || want.key !== tab.key || store.active !== tab) return;
		store.pendingQuote = undefined;
		const el = quoteTarget(root.current, want.source);
		if (!el) return store.flash("The quoted message is no longer in this conversation.", "muted");
		const row = typeof want.source === "string" ? undefined : el.closest<HTMLElement>("[data-message-id]");
		if (row?.dataset.messageId) scrollToMessage(row.dataset.messageId, { align: "center", behavior: "smooth" });
		else scrollToStart({ behavior: "smooth" });
		flash(row ?? el);
	};
	useSignal("show-quote", go);
	useEffect(() => {
		if (store.pendingQuote?.key === tab.key) requestAnimationFrame(go);
	}, []);
	return null;
}

const squash = (text: string) => text.replace(/\s+/g, "");

function selectionMark(el: HTMLElement): { text: string; start: number; end: number } | undefined {
	const sel = window.getSelection();
	if (!sel?.rangeCount) return undefined;
	const range = sel.getRangeAt(0);
	if (!el.contains(range.startContainer)) return undefined;
	const whole = el.contains(range.endContainer);
	const inside = range.cloneRange();
	if (!whole) inside.setEnd(el, el.childNodes.length);
	const before = document.createRange();
	before.selectNodeContents(el);
	before.setEnd(inside.startContainer, inside.startOffset);
	const start = before.toString().length;
	const end = start + inside.toString().length;
	const text = (whole ? sel.toString() : inside.toString()).trim();
	return end > start && text ? { text, start, end } : undefined;
}

function bookmarkRange(el: HTMLElement, b: Bookmark): Range | undefined {
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	const range = new Range();
	let at = 0;
	let started = false;
	for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
		const next = at + node.data.length;
		if (!started && b.start < next) {
			range.setStart(node, b.start - at);
			started = true;
		}
		if (started && b.end <= next) {
			range.setEnd(node, b.end - at);
			return squash(range.toString()) === squash(b.text) ? range : undefined;
		}
		at = next;
	}
	return undefined;
}

function BookmarkJump({ tab, root }: { tab: Tab; root: RefObject<HTMLElement | null> }) {
	const { scrollToMessage, scrollToStart } = useMessageScroller();
	const unmark = useRef<ReturnType<typeof setTimeout>>(undefined);
	const go = () => {
		const want = store.pendingBookmark;
		if (!want || want.key !== tab.key || store.active !== tab) return;
		store.pendingBookmark = undefined;
		const { bookmark } = want;
		const el = quoteTarget(root.current, bookmark.source);
		if (!el) return store.flash("The bookmarked message is no longer in this conversation.", "muted");
		const range = bookmarkRange(el, bookmark);
		const marks = highlights;
		if (range && marks) {
			const holder = range.startContainer.parentElement;
			holder?.closest("details:not([open])")?.setAttribute("open", "");
			holder?.scrollIntoView({ block: "center", behavior: "smooth" });
			clearTimeout(unmark.current);
			marks.set("pine-bookmark", newHighlight(range));
			unmark.current = setTimeout(() => marks.delete("pine-bookmark"), 2250);
			return;
		}
		const row = typeof bookmark.source === "string" ? undefined : el.closest<HTMLElement>("[data-message-id]");
		if (row?.dataset.messageId) scrollToMessage(row.dataset.messageId, { align: "center", behavior: "smooth" });
		else scrollToStart({ behavior: "smooth" });
		flash(row ?? el);
	};
	useSignal("show-bookmark", go);
	useEffect(() => {
		if (store.pendingBookmark?.key === tab.key) requestAnimationFrame(go);
		return () => {
			clearTimeout(unmark.current);
			highlights?.delete("pine-bookmark");
		};
	}, []);
	return null;
}

/**
 * With "follow" (an agent's `scroll`), a message the owner sent brings the view to the end, also when they had
 * gone up: Message Scroller follows what arrives only while the view is at the end. At the end already, this
 * scroll has nowhere to go.
 */
function FollowSent({ sent }: { sent?: number }) {
	const { scrollToEnd } = useMessageScroller();
	useEffect(() => {
		if (sent !== undefined) scrollToEnd({ behavior: "smooth" });
	}, [sent]);
	return null;
}

/**
 * The column of the transcript, and the size of what is said in it, set once here: messages and the owner's
 * bubbles read at the reading size (text-read, with its relaxed line height), larger than the stock parts' text-sm, which the lines of
 * work, the notes and the requests keep. The stock Message and Bubble Content set their own size, so it is
 * said to them by their slot.
 */
const TRANSCRIPT = "mx-auto max-w-3xl px-7 pt-7 pb-6 [&_[data-slot=bubble-content]]:text-read [&_[data-slot=message]]:text-read";

export function Conversation({ tab }: { tab: Tab }) {
	useModel(tab);
	// It opens by a key, and by itself when the conversation was found by words that are in it.
	const take = () => (store.pendingFind?.key === tab.key ? store.pendingFind.query : undefined);
	const [finding, setFinding] = useState(() => take() !== undefined);
	const [looked, setLooked] = useState(() => {
		const q = take();
		if (q !== undefined) store.pendingFind = undefined;
		return q;
	});
	useSignal("find", () => {
		if (store.active !== tab) return;
		const q = take();
		if (q !== undefined) (store.pendingFind = undefined), setLooked(q);
		setFinding(true);
	});
	// The words are marked once what was said is on the page.
	const loaded = tab.loaded;
	const scroller = useRef<HTMLDivElement>(null);
	const [selected, unselect] = useTextSelection(scroller);
	const source = selected ? selectionSource(scroller.current) : undefined;
	const quote = (reply: boolean) => {
		if (!selected || !source) return;
		const text = selected.text.trim();
		if (!text) return;
		let it = tab.quotes.find((q) => q.text === text && sameSource(q.source, source));
		if (!it) tab.quotes.push((it = { id: quoteId(), text, tab: tab.key, source }));
		if (reply) tab.replying = it.id;
		tab.touch();
		window.getSelection()?.removeAllRanges();
		unselect();
		store.ask_(reply ? "focus-reply" : "focus-input");
	};
	const streaming = Boolean(source && typeof source !== "string" && source.part === "answer" && tab.items.some((it) => it.t === "answer" && it.task === source.task && it.live));
	const bookmark = () => {
		if (!selected || !source || streaming) return;
		const el = quoteTarget(scroller.current, source);
		const mark = el ? selectionMark(el) : undefined;
		if (!mark) return;
		void store.addBookmark(tab, { ...mark, source });
		window.getSelection()?.removeAllRanges();
		unselect();
	};
	// Where the conversation goes when the owner sends a message: the agent's `scroll`, "top" when it says
	// nothing (Settings > the agent > When you send a message). Read when the message comes, which renders this.
	const scroll = store.agent(tab.agent)?.scroll ?? "top";
	// What the conversation held when this view of it was opened: its history, or what was said while another tab
	// was in front. With "top", Message Scroller goes to a message of the owner's when it arrives (`scrollAnchor`),
	// and takes for arrived whichever such message it has not gone to yet. So one that was there from the start is
	// no anchor: it would be gone to, the oldest first, as soon as a line of the list is exchanged for another
	// (the mark before the last message for a message that comes), and the view would jump to the very top. For
	// the same reason the list starts again when the agent's `scroll` changes: what came under "follow" was never
	// gone to, and would all be gone to at once.
	const before = useRef<Set<number> | undefined>(undefined);
	const scrolled = useRef(scroll);
	if (loaded && (!before.current || scrolled.current !== scroll)) before.current = new Set(tab.items.map((item) => item.id));
	scrolled.current = scroll;
	// The owner's latest message, when it came after this view was opened. While the view goes to it (or, with
	// "follow", to the end below it) the viewport scrolls smoothly: Message Scroller scrolls at once, and the
	// viewport's own smooth scrolling turns that scroll into an animation without taking its place.
	const owner = lastOwnerMessage(tab.items);
	const sent = owner >= 0 && before.current && !before.current.has(tab.items[owner].id) ? tab.items[owner].id : undefined;
	const [seen, setSeen] = useState(sent);
	const [glide, setGlide] = useState(false);
	if (sent !== seen) {
		setSeen(sent);
		if (sent !== undefined) setGlide(true);
	}
	useEffect(() => {
		if (!glide) return;
		// The end of the scroll ends it (`onScrollEnd`); this is for a scroll that had nowhere to go.
		const t = setTimeout(() => setGlide(false), 1500);
		return () => clearTimeout(t);
	}, [glide, seen]);
	const chat = tab.kind === "chat";
	const setupTab = store.isSetup(tab);
	const above = store.cardAbove(tab);
	// What the card above the composer tells the composer (`HostedCard`): one for this view of the conversation.
	const [slot] = useState(() => new ComposerCardSlot());
	const checkpoint = chat && !tab.busy ? lastOwnerMessage(tab.items) : -1;
	return (
		<div data-slot="conversation" className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background text-sm">
			<ConvHead tab={tab} />
			{selected && chat && source ? (
				<SelectionToolbar rect={selected.rect}>
					<SelectionToolbarButton icon={QuoteIcon} label="Quote" onClick={() => quote(false)} />
					<SelectionToolbarButton icon={ReplyIcon} label="Reply" hint="Quote the selected text and reply to it" onClick={() => quote(true)} />
					<SelectionToolbarButton icon={BookmarkIcon} label="Bookmark" hint={streaming ? "Bookmark it once the answer is done" : undefined} disabled={streaming} onClick={bookmark} />
				</SelectionToolbar>
			) : null}
			{finding && loaded ? <FindBar key={looked ?? ""} initial={looked} root={() => scroller.current} close={() => (setFinding(false), setLooked(undefined))} /> : null}
			{!loaded ? (
				<ConversationSkeleton />
			) : (
				// Message Scroller follows what arrives while the reader is at the end, holds still when
				// they went up, and brings them back with its button. A tab opens at its end.
				<MessageScrollerProvider autoScroll defaultScrollPosition="end">
					<QuoteJump tab={tab} root={scroller} />
					<BookmarkJump tab={tab} root={scroller} />
					<FollowSent sent={scroll === "follow" ? sent : undefined} />
					{/* However short the pane, the thread keeps a few lines of room above a card (`COMPOSER_QUESTION`). */}
					<MessageScroller className="min-h-12 flex-1">
						<MessageScrollerViewport ref={scroller} data-glide={glide ? "" : undefined} onScrollEnd={() => setGlide(false)} className="motion-safe:data-glide:scroll-smooth">
							{/* The column of the conversation, under the head and above the input. */}
							<MessageScrollerContent className={TRANSCRIPT} aria-busy={tab.busy}>
								{/* The main agent's main conversation begins with pine's welcome, above everything said in it: under the agent while nothing was said yet. */}
								{chat && tab.session === "main" && store.agent(tab.agent)?.main ? (
									<>
										{!tab.items.length ? (
											<MessageScrollerItem>
												<Welcome tab={tab} />
											</MessageScrollerItem>
										) : null}
										<MessageScrollerItem data-quote-source="letter">
											<Letter tab={tab} />
										</MessageScrollerItem>
									</>
								) : null}
								{/* "Setup Pine" begins with pine's own steps, above everything said in it. */}
								{setupTab ? (
									<MessageScrollerItem>
										<SetupScript tab={tab} />
									</MessageScrollerItem>
								) : null}
								{!tab.items.length && chat ? (
									store.agent(tab.agent)?.main && tab.session === "main" ? null : (
										// "Setup Pine" has its agent above pine's steps, as main has it above its letter.
										<MessageScrollerItem className={setupTab ? "order-first" : "my-auto"}>
											<Welcome tab={tab} />
										</MessageScrollerItem>
									)
								) : (
									tab.items.map((item, i) => (
										<Fragment key={item.id}>
											{i === checkpoint ? (
												<MessageScrollerItem>
													<Checkpoint tab={tab} />
												</MessageScrollerItem>
											) : null}
											<MessageScrollerItem messageId={String(item.id)} scrollAnchor={scroll === "top" && item.t === "user" && !before.current?.has(item.id)}>
												<Row item={item} v={item.v} tab={tab} />
											</MessageScrollerItem>
										</Fragment>
									))
								)}
							</MessageScrollerContent>
						</MessageScrollerViewport>
						<MessageScrollerButton />
					</MessageScroller>
				</MessageScrollerProvider>
			)}
			<div className="flex min-h-0 flex-col px-4 pb-4">
				<div className="relative mx-auto flex min-h-0 w-full max-w-3xl flex-col gap-2">
					{/* An agent's question comes first; pine's own step in "Setup Pine" is there when none is open. */}
					<QuestionCardHost.Provider value={slot}>
						{above === "question" ? <ComposerQuestion tab={tab} /> : above === "setup" ? <SetupCard tab={tab} /> : null}
					</QuestionCardHost.Provider>
					<StatusLine tab={tab} />
					{chat ? (
						<Composer tab={tab} host={slot} />
					) : tab.busy ? (
						<div className="flex items-center gap-2"><span className="min-w-0 flex-1 text-muted-foreground">This tab shows the work of one task and is read-only.</span><Button variant="outline" size="xs" onClick={() => void store.stop(tab)}><SquareIcon data-icon="inline-start" />Stop this task</Button></div>
					) : null}
				</div>
			</div>
		</div>
	);
}
