// overview: all of pine on one board, in words. A view for the panel of the Pine app
// (docs/references/views.md); it draws what "pine/view" tells it and nothing else.
//
// Nothing here has to be learned first. There are three columns, and everything in them says in words what it is:
//
//   Triggers            what starts an agent's work: you, each event source ("inbox, triggers books"), each
//                       schedule ("lights, triggers home, in 20 s"), each webhook
//   Agents              all agents, those that work on top and the idle ones below them. A card for each: under
//                       its name what it is doing right now, as a person would say it ("Running a command",
//                       "Waiting for scout", "Needs your answer", "Idle"), the conversation it works in
//                       ("main conversation", "branch of main"), why ("for you", "delegated by main",
//                       "triggered by inbox"), how long, and how far ("4/7"). An agent that leads a swarm says so
//                       ("swarm · round 2 of 8", "Checking the answer", "Swarm needs your answer")
//                       and stays on top while the swarm is at work, also between two of its turns
//   Tools               what agents use. On top the boards, where a job that several work on is kept: a card
//                       for each, with how far it is ("7/24"), a bar of how its tasks stand, and one small
//                       tile per task in the order they were posted: an outline for one that is open (a faint
//                       one while it waits for another), filled in the agent's color while a sub-agent works
//                       on it, filled in the text's color when it is done, in the color of a question when
//                       its worker asked something, in the color of what failed when it failed. Under the
//                       boards the MCP servers and the skills
//
// It looks like the app it is shown in: the app's font, its cards with their thin borders and round corners, an
// agent's avatar as the side bar draws it, its mode as a small badge, and the app's own colors for a question and
// for what failed. It has no ground of its own: the panel's shows through, in any theme. What happens stands out
// and what rests steps back: an agent at work has a card tinted in its color with a soft glow, its avatar filled
// with a ring that turns around it, and what it does in the largest words on the board; an idle agent's card is
// flat, its avatar an outline. A question for you is in the color of a question wherever it is.
//
// The lines are what it has from a circuit board: traces that turn at 45 degrees. A trace joins two cards only
// while something happens between them, in the color of the agent it happens to: from a trigger to the agent it
// started, from an agent to the tool it is using, at the left of the agents from one to the agent it delegated a
// task to, and in the color of a question from an agent to you while it waits for your answer. When a delegated
// task ends, its answer goes back at the right of the agents for a few seconds (in the color of what failed, if
// it did); and what you asked for comes back to you the same way. A trace starts with a dot, ends with an
// arrowhead, and one dot runs along it the way things go.
//
// The board is larger than the panel may be, and a camera looks at it. While the eye at the top right is pressed
// it follows what happens: it keeps each card that something happens at in view, and moves there softly. Drag
// the board, scroll, or pinch (or scroll with ctrl or cmd held) to look yourself; the eye, or a double click on
// the empty board, follows again. The button beside it shows the whole board.
//
// Zooming never moves a card or changes its size: the board stays as it is, and the words in a card stay as large
// as they are. So the closer a card is looked at, the more room it has, and it fills that room the way a page
// fills a wider window, the most important first. From far an agent is its avatar, then its name and one word for
// how it stands; then what it is doing; then where (a chip with its conversation), why and for how long; then its
// steps, its board and its last tool calls; then a line for each sub-agent and what each is doing; then how long
// it has run and what it finished lately; and with room for a second column, its conversations and what it is
// connected to. A board's card is a row of tiles at first and a row for each task from close by; a trigger or a
// tool says who it triggers or who uses it, and from close by all a view knows of it. A click on a board or on one
// of its tasks shows it under the view, where the panel says what the task is in its own words: this view is
// never told.
//
// The rest is there when it is pointed at: the pointer over anything draws thin traces to all it is wired to (an
// agent's sources, schedules, MCP servers and skills; for a source, who listens to it), the rest fades, and the
// line on top says what it is. A click on an agent shows it under the view, a double click opens it.
//
// There is no timeline: what happened, in order, is what the panel lists under each view.

import { defineView, ease, frame, mix, rgb, tasksOf, tiling, unsettled, type TaskTile, type Box as Rect, type Cam, type ViewAgent, type ViewCall, type ViewBoard, type ViewConversation, type ViewTask, type ViewHappening, type ViewHost, type ViewInput, type ViewSchedule, type ViewState, type ViewWork } from "pine/view";

// ---- what is said ---------------------------------------------------------------------------------------------------------

const ENDED = ["done", "failed", "cancelled"];
const ended = (w: ViewWork) => ENDED.includes(w.doing);

/** What pine's everyday tools do, as somebody would say it. A tool that is not here is called by its name. */
const DOING: Record<string, string> = {
	bash: "Running a command",
	read: "Reading a file",
	edit: "Editing a file",
	write: "Writing a file",
	grep: "Searching files",
	find: "Finding files",
	ls: "Listing a folder",
	manual: "Reading the manual",
	download: "Downloading a file",
	todo: "Planning next steps",
	question: "Asking a question",
	delegate: "Delegating a task",
	subagent: "Starting sub-agents",
	send: "Sending a message",
	publish_event: "Publishing an event",
	read_source: "Reading from a source",
	request_access: "Requesting access",
	boards: "Listing boards",
	board_read: "Reading the board",
	board_post: "Posting on the board",
	board_claim: "Taking a task",
	board_done: "Settling a task",
	board_answer: "Answering a sub-agent",
};

/** A tool's name without its server's: "mcp__web__web_search" of "web" is "search". */
const toolWord = (tool: string | undefined, mcp?: string) => {
	const t = tool ?? "";
	if (!mcp) return t.replace(/_/g, " ") || "a tool";
	return t.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "").replace(new RegExp(`^${mcp}_`), "").replace(/_/g, " ") || "a tool";
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a piece of work is doing right now, as a person would put it. */
export function sentenceOf(w: ViewWork, s: ViewState): string {
	if (w.asking) return "Needs your answer";
	if (w.doing === "done") return "Done";
	if (w.doing === "failed") return "Failed";
	if (w.doing === "cancelled") return "Stopped";
	if (w.doing === "tool") {
		if (w.skill) return `Reading skill: ${w.skill}`;
		if (w.mcp) return `Using ${w.mcp}: ${toolWord(w.tool, w.mcp)}`;
		return DOING[w.tool ?? ""] ?? `Using ${toolWord(w.tool)}`;
	}
	if (w.doing === "writing") return "Writing an answer";
	if (w.doing === "waiting") {
		const on = w.waitingOn.map((id) => s.work.find((x) => x.id === id)).filter((x): x is ViewWork => Boolean(x && !ended(x)));
		const subs = on.filter((x) => x.copy).length;
		const who = [...new Set(on.filter((x) => !x.copy).map((x) => x.agent)), ...(subs ? [plural(subs, "sub-agent")] : [])];
		return who.length ? `Waiting for ${who.join(" and ")}` : "Waiting";
	}
	return "Thinking";
}

/** Why a piece of work runs, in a few words: who it is for, or what triggered it. */
export function causeOf(w: ViewWork): string {
	const f = w.from;
	return f.k === "you" ? "for you" : f.k === "clock" ? `triggered by ${f.name ?? "a schedule"}` : f.k === "source" || f.k === "outside" ? `triggered by ${f.name}` : f.k === "agent" ? `delegated by ${f.id}` : "";
}

const span = (ms: number) => (ms < 1500 ? "now" : ms < 90_000 ? `${Math.round(ms / 1000)} s` : ms < 5_400_000 ? `${Math.round(ms / 60_000)} min` : ms < 129_600_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.round(ms / 86_400_000)} d`);
const listOf = (names: string[], max = 3) => (names.length <= max ? names.join(", ") : `${names.slice(0, max - 1).join(", ")} +${names.length - max + 1}`);

/** A conversation's swarm, as a view is told it. */
type Swarm = NonNullable<ViewConversation["swarm"]>;
/** The swarm of the conversation a piece of work runs in or for. (An app older than this view tells of none.) */
const swarmOf = (a: ViewAgent | undefined, conversation: number | undefined): Swarm | undefined => (conversation === undefined ? undefined : a?.conversations.find((c) => c.id === conversation)?.swarm);
/** The swarm of an agent's that matters most right now: one that waits for you, then one at work, then one that stopped. A finished one is over. */
export function leadingOf(a: ViewAgent): Swarm | undefined {
	const all = a.conversations.map((c) => c.swarm).filter((x): x is Swarm => Boolean(x));
	return all.find((x) => x.status === "waiting") ?? all.find((x) => x.status === "active") ?? all.find((x) => x.status === "paused" || x.status === "limit");
}
/** Whether an agent's swarm goes on by itself or waits for you: then the agent is not idle, also between two of its turns. */
const swarming = (a: ViewAgent) => a.conversations.some((c) => c.swarm?.status === "active" || c.swarm?.status === "waiting");
const swarmWaits = (a: ViewAgent) => a.conversations.some((c) => c.swarm?.status === "waiting");
/** A swarm in a few words, as its lead's card says it while no turn of the lead's runs. (Short: the largest words of a card have room for about two dozen letters.) */
export function swarmWords(w: Swarm): string {
	return w.status === "waiting" ? "Swarm needs your answer" : w.status === "paused" ? "Swarm paused" : w.status === "limit" ? "Swarm at its limit" : w.status === "done" ? "Swarm done" : w.checking ? "Checking the answer" : "Leading a swarm";
}
const roundOf = (w: Swarm) => `round ${w.round} of ${w.until}`;

/** The boards of a state. (An app older than this view tells it none.) */
const boardsOf = (s: ViewState): ViewBoard[] => s.boards ?? [];
/** A board by what it is called: its name, or whose it is. A view is never told what stands on it. */
export const boardTitle = (b: ViewBoard) => b.name ?? (b.agent ? `${b.agent}'s board` : "Board");
/** How a board stands, in a few words. */
export function boardLine(b: ViewBoard): string {
	const tasks = b.open + b.taken + b.done + b.failed + b.blocked;
	if (b.blocked) return b.blocked === 1 ? "Waits for an answer" : `${b.blocked} wait for an answer`;
	return tasks ? `${b.done} of ${tasks} done` : b.notes ? plural(b.notes, "note") : "Empty";
}
/** What happens on a board right now, in a few words: what its card says under its name. */
export function boardWords(b: ViewBoard): string {
	const tasks = b.open + b.taken + b.done + b.failed + b.blocked;
	if (!tasks) return b.notes ? plural(b.notes, "note") : "Empty";
	if (b.blocked) return b.blocked === 1 ? "Waits for an answer" : `${b.blocked} wait for an answer`;
	const parts = [b.taken ? `${b.taken} in progress` : "", b.open ? `${b.open} to do` : "", b.failed ? `${b.failed} failed` : ""].filter(Boolean);
	return parts.length ? parts.slice(0, 2).join(" · ") : "Done";
}

/** A task's tile in a board's card, from the card's left edge and the top of its tiles. */
export type Tile = TaskTile;
/**
 * A board's tasks as tiles in its card (`tiling` of pine/view): as large as lets every piece of work stand in one
 * row with what comes after it under it, smaller where there are more, and never higher than sixty pixels.
 */
export function tilesOf(b: ViewBoard, width: number): { size: number; tiles: Tile[]; height: number; more: number } {
	return tiling(b, width, 60, [[8, 2], [7, 2], [6, 2], [5, 2], [4, 1]], 3);
}
// ---- what just happened, for a moment -------------------------------------------------------------------------------------

/** What the state does not say: that something came in just now, that an agent just sent something out. It fades. */
export class Recent {
	/** When something last happened at a box, by the box's id. */
	hot = new Map<string, number>();
	/** A few words at an agent's box, for a moment. */
	notes = new Map<string, { text: string; at: number }>();
	/**
	 * How far along its line each running dot is, as a part of the line (0 to 1), and when it was last moved. A dot
	 * moves by the time since the last frame, so that a line that grows or shrinks (a zoom, the camera on its way,
	 * a lane that moves) stretches under it, and the dot does not jump.
	 */
	dots = new Map<string, { p: number; at: number }>();

	hear(h: ViewHappening, at: number): void {
		const note = (agent: string | undefined, text: string) => agent && this.notes.set(agent, { text, at });
		switch (h.k) {
			case "event":
				this.hot.set(h.input, at);
				break;
			case "scheduled":
				this.hot.set(`sched:${h.name ?? ""}`, at);
				break;
			case "said":
				this.hot.set("you", at);
				break;
			case "tool":
				if (h.mcp) this.hot.set(`mcp:${h.mcp}`, at);
				break;
			case "skill":
				this.hot.set(`skill:${h.skill}`, at);
				break;
			case "sent":
				note(h.agent, "Sent a message");
				break;
			case "branched":
				note(h.agent, h.worktree ? "New branch in a worktree" : "New branch");
				break;
			case "goal":
				note(h.agent, h.status === "met" ? "Goal reached" : `Goal ${h.status}`);
				break;
			case "swarm":
				note(h.agent, h.status === "active" ? (h.checking ? "Checking the answer" : "Swarm at work") : h.status === "done" ? "Swarm done" : h.status === "waiting" ? "Swarm waits for you" : h.status === "limit" ? "Swarm at its limit" : "Swarm paused");
				break;
			case "outside":
				note(h.agent, "Read outside content");
				break;
			case "decided":
				note(h.agent, h.allowed ? "You approved" : "You declined");
				break;
			case "ended":
				note(h.agent, h.failed ? "Task failed" : "Task finished");
				break;
			case "answered":
				note(h.from, `Answered ${h.to}`);
				note(h.to, `Answer from ${h.from}`);
				break;
			case "board":
				this.hot.set(`board:${h.board}`, at);
				break;
			default:
				break;
		}
	}
}


// ---- where everything is ---------------------------------------------------------------------------------------------------

/** A card of the board: something that wakes agents, an agent, or something agents use. */
export interface Box {
	/** "you", an input's id ("source:inbox", "outside:hook"), "sched:<name>", "agent:<id>", "board:<number>", "mcp:<name>", "skill:<name>". */
	id: string;
	col: 0 | 1 | 2;
	kind: "you" | "source" | "outside" | "sched" | "agent" | "board" | "mcp" | "skill";
	/** Its place on the board. Its size goes by its kind alone, never by what it says. */
	x: number;
	y: number;
	w: number;
	h: number;
	title: string;
	/** Words at the right of its name, and a second line under it: what it is, whom it triggers. */
	sub?: string;
	right?: string;
	agent?: ViewAgent;
	board?: ViewBoard;
	bad?: boolean;
	busy?: boolean;
	/** On a tall panel: the row of its part it stands in, and its place in that row. */
	row?: number;
	slot?: number;
}
/** On a tall panel, how a part's cards stand: `n` in a row, each `w` wide from `x`, the rows; from `top` (its name) to `bottom`. */
export interface Part {
	n: number;
	x: number;
	w: number;
	top: number;
	bottom: number;
	rows: Array<{ y: number; h: number }>;
}
/** A row of a board's card when it has room for one: a task, or under the tasks a word about the whole board. */
export interface TaskRow {
	task?: ViewTask;
	/** How deep it stands under the task it comes after. */
	indent: number;
	text: string;
	/** What else there is to say of it, at the right: its notes, an answer it had. */
	flags: string;
}
export interface Layout {
	/** The size of the board: everything on it lies between 0 and these. It does not depend on the panel's size, or on the zoom. */
	w: number;
	h: number;
	/** Each column's place: side by side on a wide panel (`y` 0), one under the other on a tall one (`tall`). */
	cols: Array<{ x: number; y: number; w: number; title: string }>;
	tall: boolean;
	/** On a tall panel, how each part's cards stand. */
	parts?: Part[];
	heads: Array<{ col: number; y: number; text: string; x?: number }>;
	boxes: Box[];
	byId: Map<string, Box>;
}
/** A line between two boxes: something that happens now (`live`), or wiring that is shown for what the pointer is over. */
export interface Link {
	from: string;
	to: string;
	color: string;
	live: boolean;
	/** A task delegated from an agent to an agent: it runs beside the agents, at their left. */
	side?: boolean;
	/** The answer to a delegated task, on its way back: it runs beside the agents at their right. */
	back?: boolean;
}

/** How long an answer is shown on its way back, once the work is over. */
const ANSWER_MS = 3500;

/** The board's measures: a narrow column at each side, the agents between them, and a gap for the lines. */
const SIDE = 128;
const MID = 232;
const GAP = 40;
/**
 * On a tall panel the columns are parts one under the other, their cards side by side in rows as wide as the panel.
 * The lines run in the room between them: at each side of the board (`EDGE`), between two cards side by side
 * (`GUTTER`), between two rows (`ROWGAP`) and between two parts (`BAND`, above a part's name).
 */
const EDGE = 14;
const GUTTER = 24;
const ROWGAP = 12;
const BAND = 28;
/** How narrow a card may be on a tall panel before fewer of them stand in a row. */
const NARROWEST = { side: 120, agent: 176 };
/** The room on top of a column for what it is called, and above a group in a column for its name. */
const TITLE = 30;
const HEAD = 16;
/** How high each kind of card is, and the room between two. A card says more when there is more of it on the panel, never by growing. */
export const SIZE = { agent: 112, side: 44, tool: 32, board: 100 };
const SPACE = 8;
/** How far from a box a line begins and ends: the room for the dot it starts with and the arrowhead it ends with. */
export const PIN = 3;
/** The color of a line that is a question for you, and of an answer that failed: names, which the drawing turns into the theme's own colors. */
export const ASK = "ask";
export const FAILED = "failed";
/** A task's row in a board's card. */
export const ROW = 17;

/** How a task stands, for its row: what its worker is doing and for how long, or what it waits for. */
function rowOf(t: ViewTask, s: ViewState, now: number): { text: string; flags: string } {
	const w = t.worker !== undefined ? s.work.find((x) => x.id === t.worker) : undefined;
	const time = t.since !== undefined ? span(Math.max(0, now - t.since)) : "";
	const ago = time ? (time === "now" ? "just now" : `${time} ago`) : "";
	const text =
		t.state === "taken" ? `${w ? sentenceOf(w, s) : "In progress"}${time && time !== "now" ? ` · ${time}` : ""}`
		: t.state === "blocked" ? `Waiting for an answer${time && time !== "now" ? ` · ${time}` : ""}`
		: t.state === "waiting" ? `After task ${t.after.join(" and ")}`
		: t.state === "open" ? `To do${t.by ? ` · from ${t.by}` : ""}`
		: `${t.state === "done" ? "Done" : "Failed"}${ago ? ` ${ago}` : ""}`;
	return { text, flags: [t.asked === "answered" ? "answered" : "", t.notes ? plural(t.notes, "note") : "", t.outside ? "outside content" : ""].filter(Boolean).join(" · ") };
}
/** A board's tasks as rows: in the order they were posted, each task that comes after another standing in under it. */
export function rowsOf(b: ViewBoard, s: ViewState, now: number): TaskRow[] {
	const tasks = tasksOf(b);
	const ids = new Set(tasks.map((t) => t.id));
	const placed = new Set<number>();
	const rows: TaskRow[] = [];
	const walk = (t: ViewTask, indent: number) => {
		if (placed.has(t.id)) return;
		placed.add(t.id);
		rows.push({ task: t, indent, ...rowOf(t, s, now) });
		for (const next of tasks) if (next.after.includes(t.id) && next.after.every((a) => placed.has(a) || !ids.has(a))) walk(next, Math.min(indent + 1, 3));
	};
	for (const t of tasks) if (!t.after.some((a) => ids.has(a))) walk(t, 0);
	for (const t of tasks) walk(t, 1);
	const shown = rows.slice(0, 80);
	if (rows.length > shown.length) shown.push({ indent: 0, text: `+${plural(rows.length - shown.length, "more task")}`, flags: "" });
	if (b.notes) shown.push({ indent: 0, text: `${plural(b.notes, "note")} on this board`, flags: "" });
	return shown;
}

/** Work that runs now, or whose answer is still on its way back: its agent keeps its place on top until then. */
const current = (w: ViewWork, now: number) => !ended(w) || (w.finished !== undefined && now >= w.finished && now - w.finished <= ANSWER_MS);
const atWork = (s: ViewState, a: ViewAgent, now: number) => s.work.some((w) => w.agent === a.id && current(w, now));
/** Who handed a task to whom, for as long as the task runs or its answer is on its way back: the lines beside the agents. */
const handedOf = (s: ViewState, now: number): Array<[from: string, to: string]> =>
	s.work.filter((w) => !w.copy && w.from.k === "agent" && w.from.id !== w.agent && current(w, now)).map((w) => [(w.from as { id: string }).id, w.agent]);
/**
 * The agents in the order they stand: those at work on top, and above all an agent that handed a task on stays
 * above the agents it handed it to, also when its own turn is over and it waits for nothing (a task handed on
 * without waiting): it is at work as long as what it started is. Each agent that handed work on is followed by
 * those it handed it to, in pine's own order; then the idle ones, in pine's own order.
 */
function standing(s: ViewState, now: number): ViewAgent[] {
	const handed = handedOf(s, now);
	const active = s.agents.filter((a) => atWork(s, a, now) || swarming(a) || handed.some(([from]) => from === a.id));
	const ids = new Set(active.map((a) => a.id));
	const out: ViewAgent[] = [];
	const put = (a: ViewAgent) => {
		if (out.includes(a)) return;
		out.push(a);
		for (const b of active) if (handed.some(([from, to]) => from === a.id && to === b.id)) put(b);
	};
	// Those nobody at work handed anything to come first, each with what it handed on under it.
	for (const a of active) if (!handed.some(([from, to]) => to === a.id && from !== a.id && ids.has(from))) put(a);
	// What is left hands work around in a ring (a to b, b to a): in pine's own order.
	for (const a of active) put(a);
	return [...out, ...s.agents.filter((a) => !ids.has(a.id))];
}
/** How many questions wait for you: from work that asks, from tasks of a board whose worker asked, and from a swarm whose lead asked. */
const questionsOf = (s: ViewState) => s.work.filter((w) => !ended(w) && w.asking).length + boardsOf(s).reduce((n, b) => n + b.blocked, 0) + s.agents.filter(swarmWaits).length;
/** Who listens to an event source: those it names, and those that name it. */
const listenersOf = (s: ViewState, i: ViewInput) => [...new Set([...i.agents, ...s.agents.filter((a) => a.sources.includes(i.name)).map((a) => a.id)])];
/** The MCP servers or skills of all agents, those that most agents have first. */
function ranked(s: ViewState, pick: (a: ViewAgent) => string[]): string[] {
	const n = new Map<string, number>();
	for (const a of s.agents) for (const name of pick(a)) n.set(name, (n.get(name) ?? 0) + 1);
	return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
}

/**
 * Everything on the board, each card in its place and at the size of its kind. What a card says is not decided
 * here but where it is drawn (`contentOf`), by how much room it has on the panel at the zoom it is looked at.
 * With a `width`, for a tall panel: the three columns are parts one under the other, and the cards of each stand
 * side by side in rows that fill that width, as many in a row as there is room for.
 */
export function layoutOf(s: ViewState, now: number, width?: number): Layout {
	type Card = { b: Omit<Box, "col" | "x" | "y" | "w" | "h">; h: number };
	// First what is in each column, in groups under their names; then where it goes, side by side or one under the other.
	const groups: Array<Array<{ head?: string; cards: Card[] }>> = [[{ cards: [] }], [{ cards: [] }], [{ cards: [] }]];
	const head = (col: number, text: string) => groups[col].push({ head: text, cards: [] });
	const put = (col: 0 | 1 | 2, b: Card["b"], h: number) => groups[col].at(-1)!.cards.push({ b, h });

	// On the left: you, the event sources, the schedules, and any other way in.
	const asks = questionsOf(s);
	put(0, { id: "you", kind: "you", title: "You", sub: asks ? plural(asks, "question") : "nothing waiting", bad: asks > 0 }, SIZE.side);
	const sources = s.inputs.filter((i) => i.kind === "source").sort((a, b) => a.name.localeCompare(b.name));
	if (sources.length) head(0, "Events");
	for (const i of sources) {
		const who = listenersOf(s, i);
		put(0, { id: i.id, kind: "source", title: i.name, right: i.failing ? "down" : undefined, sub: i.failing ? "not connected" : who.length ? `triggers ${listOf(who, 2)}` : "no listeners", bad: i.failing }, SIZE.side);
	}
	const scheds: ViewSchedule[] = [];
	for (const x of [...s.schedules].sort((a, b) => (a.next ?? Infinity) - (b.next ?? Infinity) || a.name.localeCompare(b.name))) if (!scheds.some((k) => k.name === x.name)) scheds.push(x);
	if (scheds.length) head(0, "Schedules");
	for (const x of scheds) put(0, { id: `sched:${x.name}`, kind: "sched", title: x.name, right: x.next !== undefined && x.next > now - 1000 ? `in ${span(x.next - now)}` : undefined, sub: x.agent ? `triggers ${x.agent}` : "triggers all agents" }, SIZE.side);
	const others = s.inputs.filter((i) => i.kind === "outside");
	if (others.length) head(0, "Webhooks");
	for (const i of others) put(0, { id: i.id, kind: "outside", title: i.name, sub: i.count ? plural(i.count, "event") : "webhook" }, SIZE.tool);

	// In the middle: the agents. Those that work stand on top, one that handed work on above those it handed it to,
	// and the idle ones below them (`standing`). One whose work has just ended keeps its place for as long as its
	// answer is on its way back, so that the page does not jump twice.
	for (const a of standing(s, now)) {
		const mine = s.work.filter((w) => w.agent === a.id && !ended(w));
		put(1, { id: `agent:${a.id}`, kind: "agent", title: a.id, right: a.mode, agent: a, busy: mine.length > 0 || swarming(a), bad: mine.some((w) => w.asking) || swarmWaits(a) }, SIZE.agent);
	}

	// On the right, first: the boards that have work on them, and those with a name, which are there to stay.
	const boards = boardsOf(s).filter((b) => unsettled(b) > 0 || b.name).slice(0, 6);
	if (boards.length) head(2, "Boards");
	for (const b of boards) {
		const all = b.open + b.taken + b.done + b.failed + b.blocked;
		// (A swarm's board says so: it is the conversation's own, of an agent that leads a swarm there.)
		const swarm = b.scope === "conversation" ? swarmOf(s.agents.find((a) => a.id === b.agent), b.conversation) : undefined;
		// (Short, for a card this narrow: a question comes first as ever, then what the swarm does there.)
		const led = !swarm || swarm.status === "done" || b.blocked ? undefined : `swarm · ${swarm.checking ? "checking" : b.taken ? `${b.taken} at work` : b.open ? `${b.open} to do` : swarm.status === "active" ? "done" : swarm.status === "limit" ? "at its limit" : swarm.status}`;
		put(2, { id: `board:${b.id}`, kind: "board", title: b.name ?? b.agent ?? "Board", right: all ? `${b.done}/${all}` : undefined, sub: led ?? boardWords(b), board: b, busy: b.taken > 0, bad: b.blocked > 0 }, SIZE.board);
	}
	// Under them: the MCP servers and the skills, those that most agents have first.
	const servers = ranked(s, (a) => a.mcp);
	const skills = ranked(s, (a) => a.skills);
	const usedBy = (kind: "mcp" | "skill", name: string) => [...new Set(s.work.filter((w) => !ended(w) && w.doing === "tool" && (kind === "mcp" ? w.mcp : w.skill) === name).map((w) => w.agent))];
	const has = (kind: "mcp" | "skill", name: string) => s.agents.filter((a) => (kind === "mcp" ? a.mcp : a.skills).includes(name)).map((a) => a.id);
	for (const [kind, names, title] of [["mcp", servers, "MCP servers"], ["skill", skills, "Skills"]] as const) {
		if (names.length) head(2, title);
		for (const name of names) {
			const using = usedBy(kind, name);
			const who = has(kind, name);
			put(2, { id: `${kind}:${name}`, kind, title: name, sub: using.length ? `in use by ${listOf(using, 2)}` : who.length === s.agents.length && who.length > 1 ? "all agents" : who.length > 2 ? plural(who.length, "agent") : who.join(", "), busy: using.length > 0 }, SIZE.tool);
		}
	}

	const titles = ["Triggers", "Agents", "Tools"];
	const boxes: Box[] = [];
	const heads: Layout["heads"] = [];
	const done = (cols: Layout["cols"], w: number, h: number, parts?: Part[]): Layout => ({ w, h, cols, tall: Boolean(parts), parts, heads, boxes, byId: new Map(boxes.map((b) => [b.id, b])) });

	if (width === undefined) {
		// Side by side: a column each, one card under the other.
		const cols = [
			{ x: 0, y: 0, w: SIDE, title: titles[0] },
			{ x: SIDE + GAP, y: 0, w: MID, title: titles[1] },
			{ x: SIDE + GAP + MID + GAP, y: 0, w: SIDE, title: titles[2] },
		];
		const y = [TITLE, TITLE, TITLE];
		for (const col of [0, 1, 2] as const)
			for (const g of groups[col]) {
				if (g.head) {
					if (y[col] > TITLE) y[col] += 8;
					heads.push({ col, y: y[col], x: cols[col].x, text: g.head });
					y[col] += HEAD;
				}
				for (const c of g.cards) {
					boxes.push({ ...c.b, col, x: cols[col].x, y: y[col], w: cols[col].w, h: c.h });
					y[col] += c.h + SPACE;
				}
			}
		return done(cols, cols[2].x + cols[2].w, Math.max(...y) - SPACE);
	}

	// One under the other: in each part as many cards in a row as fit, all of a row as wide. A group with a name starts
	// a row of its own, its name above it; only you, who belong to no group, share yours with the first.
	const W = Math.max(width, NARROWEST.agent + 2 * EDGE);
	const inner = W - 2 * EDGE;
	const cols: Layout["cols"] = [];
	const parts: Part[] = [];
	let top = 0;
	for (const col of [0, 1, 2] as const) {
		const least = col === 1 ? NARROWEST.agent : NARROWEST.side;
		const n = Math.max(1, Math.floor((inner + GUTTER) / (least + GUTTER)));
		const w = (inner - (n - 1) * GUTTER) / n;
		type Row = { cards: Card[]; heads: Array<{ slot: number; text: string }>; named: boolean };
		const rows: Row[] = [];
		let row: Row = { cards: [], heads: [], named: false };
		const next = () => {
			if (row.cards.length) rows.push(row);
			row = { cards: [], heads: [], named: false };
		};
		for (const g of groups[col]) {
			if (!g.cards.length) continue;
			if (g.head && (row.named || row.cards.length >= n)) next();
			if (g.head) row.heads.push({ slot: row.cards.length, text: g.head });
			for (const c of g.cards) {
				if (row.cards.length >= n) next();
				row.cards.push(c);
				row.named ||= Boolean(g.head);
			}
		}
		next();
		const part: Part = { n, x: EDGE, w, top, bottom: top + TITLE, rows: [] };
		let y = top + TITLE;
		rows.forEach((r, i) => {
			if (r.heads.length) {
				if (i > 0) y += 4;
				for (const h of r.heads) heads.push({ col, y, x: EDGE + h.slot * (w + GUTTER), text: h.text });
				y += HEAD;
			}
			const h = Math.max(...r.cards.map((c) => c.h));
			r.cards.forEach((c, slot) => boxes.push({ ...c.b, col, x: EDGE + slot * (w + GUTTER), y, w, h: c.h, row: i, slot }));
			part.rows.push({ y, h });
			part.bottom = y + h;
			y += h + ROWGAP;
		});
		cols.push({ x: EDGE, y: top, w: inner, title: titles[col] });
		parts.push(part);
		top = part.bottom + BAND;
	}
	return done(cols, W, parts[2].bottom, parts);
}

/** A conversation in words: never its name, which a view is not told. */
function convText(c: ViewConversation, a: ViewAgent, i: number): string {
	return [convName(a, i, true), c.worktree ? "worktree" : "", c.goal ? `goal ${c.goal}` : "", c.swarm ? `swarm ${c.swarm.status === "limit" ? "at its limit" : c.swarm.status}` : "", c.outside ? "read outside content" : ""].filter(Boolean).join(" · ");
}
/** What a conversation is called here: "main conversation", "conversation 3", "branch of main". */
function convName(a: ViewAgent, i: number, capital = false): string {
	const c = a.conversations[i];
	const parent = c.branchOf !== undefined ? a.conversations.findIndex((x) => x.id === c.branchOf) : -1;
	const name = c.main ? "main conversation" : c.branchOf !== undefined ? `branch of ${parent >= 0 ? (a.conversations[parent].main ? "main" : `conversation ${parent + 1}`) : "a conversation"}` : `conversation ${i + 1}`;
	return capital ? name[0].toUpperCase() + name.slice(1) : name;
}
/**
 * Which of its agent's conversations a piece of work runs in, by what it is called here. None for work that runs
 * for another agent. `short` leaves out the word "conversation" where something else says it (the chip's bubble).
 */
export function sessionOf(w: ViewWork, a: ViewAgent | undefined, short = false): string | undefined {
	if (w.conversation === undefined || !a) return undefined;
	const i = a.conversations.findIndex((c) => c.id === w.conversation);
	const name = i >= 0 ? convName(a, i) : w.branch ? "a branch" : undefined;
	return short && name === "main conversation" ? "main" : name;
}

/**
 * What happens right now, as lines between boxes; and for a few seconds after a piece of work has ended, its
 * answer on the way back to whoever asked for it: to the agent that delegated it, or to you.
 */
export function linksOf(s: ViewState, l: Layout, now: number = s.at): Link[] {
	const out: Link[] = [];
	const colorOf = (id: string) => s.agents.find((a) => a.id === id)?.color ?? "#8899aa";
	const add = (link: Link) => {
		if (l.byId.has(link.from) && l.byId.has(link.to) && !out.some((x) => x.from === link.from && x.to === link.to)) out.push(link);
	};
	for (const w of s.work) {
		if (ended(w)) continue;
		const me = `agent:${w.agent}`;
		const color = colorOf(w.agent);
		// It waits for your answer: that counts for more than what once woke it.
		if (w.asking) add({ from: me, to: "you", color: ASK, live: true });
		if (!w.copy) {
			const f = w.from;
			if (f.k === "you" && !s.work.some((x) => x.agent === w.agent && !ended(x) && x.asking)) add({ from: "you", to: me, color, live: true });
			else if (f.k === "source") add({ from: `source:${f.name}`, to: me, color, live: true });
			else if (f.k === "outside") add({ from: `outside:${f.name}`, to: me, color, live: true });
			else if (f.k === "clock") add({ from: `sched:${f.name ?? ""}`, to: me, color, live: true });
			else if (f.k === "agent" && f.id !== w.agent) add({ from: `agent:${f.id}`, to: me, color: colorOf(f.id), live: true, side: true });
		}
		// It has a task of a board: a line to that board, for as long as it has it.
		if (w.board !== undefined) add({ from: me, to: `board:${w.board}`, color, live: true });
		if (w.doing === "tool" && w.skill) add({ from: me, to: `skill:${w.skill}`, color, live: true });
		else if (w.doing === "tool" && w.mcp) add({ from: me, to: `mcp:${w.mcp}`, color, live: true });
	}
	// A swarm whose lead asked you something waits for your answer like a question does.
	for (const a of s.agents) if (swarmWaits(a)) add({ from: `agent:${a.id}`, to: "you", color: ASK, live: true });
	for (const w of s.work) {
		if (!ended(w) || w.copy || w.finished === undefined || now - w.finished > ANSWER_MS || now < w.finished) continue;
		const me = `agent:${w.agent}`;
		const color = w.doing === "failed" ? FAILED : colorOf(w.agent);
		const f = w.from;
		if (f.k === "agent" && f.id !== w.agent) add({ from: me, to: `agent:${f.id}`, color, live: true, side: true, back: true });
		else if (f.k === "you" && w.doing !== "cancelled") add({ from: me, to: "you", color, live: true });
	}
	return out;
}

/** What a box is wired to, whether or not anything happens there: what is drawn while the pointer is over it. */
export function wiringOf(id: string | undefined, s: ViewState, l: Layout): Link[] {
	const b = id ? l.byId.get(id) : undefined;
	if (!b) return [];
	const out: Link[] = [];
	const of = (a: ViewAgent) => {
		const me = `agent:${a.id}`;
		const add = (other: string, incoming: boolean) => l.byId.has(other) && !out.some((k) => (incoming ? k.from === other && k.to === me : k.from === me && k.to === other)) && out.push(incoming ? { from: other, to: me, color: a.color, live: false } : { from: me, to: other, color: a.color, live: false });
		for (const i of s.inputs) if (i.kind === "source" && (i.agents.includes(a.id) || a.sources.includes(i.name))) add(i.id, true);
		for (const x of s.schedules) if (x.agent === a.id) add(`sched:${x.name}`, true);
		for (const name of a.schedules) add(`sched:${name}`, true);
		for (const name of a.mcp) add(`mcp:${name}`, false);
		for (const name of a.skills) add(`skill:${name}`, false);
		for (const x of boardsOf(s)) if (x.scope === "all" || x.agent === a.id) add(`board:${x.id}`, false);
	};
	if (b.agent) of(b.agent);
	else for (const a of s.agents) of(a);
	return b.agent ? out : out.filter((k) => k.from === id || k.to === id);
}

/** The box at a point of the board. */
export function hitAt(l: Layout, p: { x: number; y: number }): Box | undefined {
	return l.boxes.find((b) => p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h);
}

/** Where a task was drawn in the last frame, in the panel's pixels: a tile, or a row of a board's card. */
export interface Hit {
	x: number;
	y: number;
	w: number;
	h: number;
	board: number;
	task: ViewTask;
}
/** The task drawn at a point of the panel. (A tile's gap around it counts: the pointer need not be that exact.) */
export const hitTask = (hits: Hit[], p: { x: number; y: number } | undefined): Hit | undefined => (p ? hits.find((h) => p.x >= h.x - 1 && p.x < h.x + h.w + 1 && p.y >= h.y - 1 && p.y < h.y + h.h + 1) : undefined);
/** How a task stands, as somebody would say it. */
export function taskWords(t: ViewTask, b: ViewBoard): string {
	const next = tasksOf(b).filter((x) => x.after.includes(t.id)).map((x) => x.id);
	const state =
		t.state === "taken" ? `in progress${t.agent ? `, a sub-agent of ${t.agent} has it` : ""}` : t.state === "waiting" ? `waiting for task ${t.after.join(" and ")}` : t.state === "blocked" ? "waiting for an answer" : t.state === "open" ? "to do" : t.state;
	return `${state}${t.state !== "waiting" && t.after.length ? `, comes after task ${t.after.join(" and ")}` : ""}${next.length ? `, followed by task ${next.join(" and ")}` : ""}`;
}

/** What a box is, in a few pieces of a sentence: what the line on top says while the pointer is over it, or over `task` of it. */
export function tipOf(b: Box | undefined, s: ViewState, now: number, task?: ViewTask): string[] {
	if (!b) return [];
	const who = (list: ViewAgent[]) => list.map((a) => a.id);
	if (b.agent) {
		const a = b.agent;
		const br = a.conversations.filter((c) => c.branchOf !== undefined).length;
		const next = s.schedules.filter((x) => x.agent === a.id && x.next !== undefined && x.next > now).sort((p, q) => p.next! - q.next!)[0];
		// What it is wired to, the lines on the page show; here is what they do not.
		return [`${a.id}${a.main ? " (main agent)" : ""}`, `${a.mode} mode`, `${plural(a.conversations.length, "conversation")}${br ? `, ${plural(br, "branch", "branches")}` : ""}`, next ? `${next.name} in ${span(next.next! - now)}` : "", leadingOf(a) ? `${swarmWords(leadingOf(a)!).toLowerCase()}, ${roundOf(leadingOf(a)!)}` : "", "zoom in for more, double-click to open"].filter(Boolean);
	}
	if (b.kind === "you") return ["You", "your messages start an agent's work, and its questions wait here"];
	if (b.kind === "source" || b.kind === "outside") {
		const i = s.inputs.find((x) => x.id === b.id);
		const listen = s.agents.filter((a) => i?.agents.includes(a.id) || a.sources.includes(b.title));
		return [`${b.title}: ${b.kind === "source" ? `event source${i?.type ? ` (${i.type})` : ""}` : "webhook"}`, i?.failing ? "down" : "", listen.length ? `triggers ${who(listen).join(", ")}` : b.kind === "source" ? "no listeners" : "", i ? `${plural(i.count, "event")}${i.last !== undefined ? `, last ${span(now - i.last)} ago` : ""}` : ""].filter(Boolean);
	}
	if (b.kind === "sched") {
		const x = s.schedules.find((k) => `sched:${k.name}` === b.id);
		return [`${b.title}: schedule`, x?.agent ? `triggers ${x.agent}` : "triggers all agents", x?.when ?? "", x?.next !== undefined && x.next > now ? `next in ${span(x.next - now)}` : ""].filter(Boolean);
	}
	if (b.kind === "board") {
		const x = boardsOf(s).find((k) => `board:${k.id}` === b.id);
		if (!x) return [b.title];
		// Over one of its tiles: that task.
		const tile = task;
		if (tile) return [`Task ${tile.id} on ${boardTitle(x)}`, taskWords(tile, x), "click to read it"];
		const whose = x.scope === "all" ? "board for all agents" : x.scope === "agent" ? `board of ${x.agent ?? "an agent"}` : `board of a conversation${x.agent ? ` of ${x.agent}` : ""}`;
		const waits = tasksOf(x).filter((t) => t.state === "waiting").length;
		const states = [x.taken ? `${x.taken} in progress` : "", x.open ? `${x.open} to do${waits ? ` (${waits} after other tasks)` : ""}` : "", x.blocked ? `${plural(x.blocked, "task")} waiting for an answer` : "", x.failed ? `${x.failed} failed` : "", x.done ? `${x.done} done` : ""].filter(Boolean);
		return [`${b.title}: ${whose}`, states.join(", ") || "no tasks", x.notes ? plural(x.notes, "note") : "", "click to read it, zoom in for each task"].filter(Boolean);
	}
	const has = s.agents.filter((a) => (b.kind === "mcp" ? a.mcp : a.skills).includes(b.title));
	const using = [...new Set(s.work.filter((w) => !ended(w) && w.doing === "tool" && (b.kind === "mcp" ? w.mcp : w.skill) === b.title).map((w) => w.agent))];
	return [`${b.title}: ${b.kind === "mcp" ? "MCP server" : "skill"}`, `available to ${who(has).join(", ")}`, using.length ? `in use by ${using.join(", ")}` : ""].filter(Boolean);
}
// ---- the camera ------------------------------------------------------------------------------------------------------------

/** The room around the board that the camera may show, and the line on top of the panel, under which the board lies. */
const MARGIN = 12;
const BAR = 32;
const Z_MAX = 1.4;
/** How far out and how close the hand may take the camera: from the whole board as a map to a card that fills the panel. */
const Z_MIN = 0.2;
const Z_HAND = 3.5;
type Size = { w: number; h: number };

/** The board with the room around it: what the camera never leaves. */
export const wholeOf = (l: Layout): Rect => ({ x: -MARGIN, y: -MARGIN, w: l.w + 2 * MARGIN, h: l.h + 2 * MARGIN });
const roomOf = (view: Size): Size => ({ w: Math.max(1, view.w), h: Math.max(1, view.h - BAR) });

/** A point of the panel as a point of the board. */
export function toBoard(p: { x: number; y: number }, cam: Cam, view: Size): { x: number; y: number } {
	return { x: (p.x - view.w / 2) / cam.z + cam.x, y: (p.y - BAR - (view.h - BAR) / 2) / cam.z + cam.y };
}

/** A board shorter than the panel hangs from its top, like a page: it does not float in the middle. */
function hung(cam: Cam, l: Layout, view: Size): Cam {
	const room = roomOf(view);
	const whole = wholeOf(l);
	return room.h / cam.z >= whole.h ? { ...cam, y: whole.y + room.h / cam.z / 2 } : cam;
}

/**
 * Where the camera goes to show these boxes: the board as wide as the panel, and of its height the part they are
 * in; further out only when they do not fit. With none, the top of the board.
 */
export function focusOf(l: Layout, ids: Iterable<string>, view: Size): Cam {
	const boxes = [...ids].map((id) => l.byId.get(id)).filter((b): b is Box => b !== undefined);
	const top = boxes.length ? Math.min(...boxes.map((b) => b.y)) - TITLE : 0;
	let bottom = boxes.length ? Math.max(...boxes.map((b) => b.y + b.h)) : 1;
	// On a tall panel the board stays as wide as the panel: what does not fit under the top of it is scrolled to, not zoomed out to.
	if (l.tall) bottom = Math.min(bottom, top + roomOf(view).h / Math.min(Z_MAX, roomOf(view).w / (l.w + MARGIN + 16)) - 16);
	return hung(frame({ x: -MARGIN / 2, y: top, w: l.w + MARGIN, h: bottom - top }, roomOf(view), wholeOf(l), { zMax: Z_MAX, min: { w: l.w + MARGIN, h: 1 }, step: 0.01, zMin: 0.2 }), l, view);
}

/** Where the camera goes to show the whole board. */
export function allOf(l: Layout, view: Size): Cam {
	return hung(frame(wholeOf(l), roomOf(view), wholeOf(l), { zMax: Z_MAX, min: { w: l.w, h: 1 }, step: 0.01, zMin: 0.1 }), l, view);
}

/**
 * On a tall panel, how wide to lay the board out so that all of it is shown as large as it can be: wider, more cards
 * in a row and fewer rows; narrower, the other way. Between two widths where a part takes one more card in a row the
 * rows stay the same, so the best width is found among those: in each, the zoom that shows everything, and of the
 * widths that are shown that large the widest, so that the board fills the panel side to side.
 */
export function fittedWidth(s: ViewState, now: number, view: Size): number {
	const room = roomOf(view);
	const around = 2 * MARGIN + 8;
	const lo = Math.max(NARROWEST.agent + 2 * EDGE, Math.floor(room.w / Z_MAX - around));
	const hi = Math.max(lo + 1, room.w * 4);
	// Where a part takes one more card in a row.
	const steps = new Set<number>([lo]);
	for (const least of [NARROWEST.side, NARROWEST.agent]) for (let k = 1; k < 64; k++) {
		const w = k * (least + GUTTER) - GUTTER + 2 * EDGE;
		if (w > hi) break;
		if (w > lo) steps.add(w);
	}
	const starts = [...steps].sort((a, b) => a - b);
	let best = { w: lo, z: 0 };
	starts.forEach((w, i) => {
		const end = (starts[i + 1] ?? hi) - 0.5;
		const l = layoutOf(s, now, w);
		const z = Math.min(Z_MAX, room.w / (w + around), room.h / (l.h + around));
		// As wide as is still shown at that zoom, within this step.
		const wide = Math.max(w, Math.min(end, room.w / z - around));
		if (z > best.z + 0.004 || (Math.abs(z - best.z) <= 0.004 && wide > best.w)) best = { w: wide, z };
	});
	return Math.floor(best.w);
}

/** A camera somebody moved by hand, kept where some of the board is still to be seen. */
export function held(cam: Cam, l: Layout): Cam {
	const whole = wholeOf(l);
	return { x: Math.max(whole.x, Math.min(whole.x + whole.w, cam.x)), y: Math.max(whole.y, Math.min(whole.y + whole.h, cam.y)), z: Math.max(Z_MIN, Math.min(Z_HAND, cam.z)) };
}


// ---- what a card says, by the room it has ----------------------------------------------------------------------------------

/** How wide a text is in a font: the canvas's measure where it is drawn, a stand-in in a test. */
export type Measure = (font: string, text: string) => number;
/** The colors a piece of a card can have: the theme's, and the color of the card's agent. */
export type Tone = "text" | "muted" | "faint" | "warn" | "bad" | "accent";
/**
 * Something drawn in a card, in the panel's pixels from the card's top left corner. Text is the same size at
 * each zoom; what changes with the zoom is how many pieces there is room for.
 */
export type Piece =
	| { k: "text"; x: number; y: number; text: string; font: string; tone: Tone; align?: "left" | "right" }
	/** The agent's avatar: filled while it works, an outline while it is idle. */
	| { k: "avatar"; x: number; y: number; r: number; busy: boolean; ask: boolean }
	| { k: "badge"; x: number; y: number; w: number; text: string; tone: Tone }
	/** The conversation a piece of work runs in. */
	| { k: "chip"; x: number; y: number; w: number; text: string }
	/** A to-do list as a bar of steps. */
	| { k: "steps"; x: number; y: number; w: number; done: number; total: number }
	/** How a board's tasks stand, as one bar. */
	| { k: "bar"; x: number; y: number; w: number; board: ViewBoard }
	| { k: "tile"; x: number; y: number; size: number; task: ViewTask; board: ViewBoard }
	/** A task's row: where the pointer finds it, and its ground while it is read under the view. */
	| { k: "row"; x: number; y: number; w: number; h: number; task: ViewTask; board: ViewBoard }
	| { k: "pill"; x: number; y: number; w: number; text: string; call: ViewCall }
	/** A dot: in a tone, or in `color` (another agent's). */
	| { k: "dot"; x: number; y: number; r: number; tone: Tone; color?: string; pulse?: boolean; hollow?: boolean }
	/** The small corner in front of what stands under something. */
	| { k: "elbow"; x: number; y: number };

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", system-ui, sans-serif';
/** The type of the board: few sizes, and weight for what matters most. */
const F = {
	name: `600 13px ${FONT}`,
	title: `500 12.5px ${FONT}`,
	focus: `600 14px ${FONT}`,
	idle: `500 13.5px ${FONT}`,
	text: `12px ${FONT}`,
	small: `11px ${FONT}`,
	tiny: `10.5px ${FONT}`,
	label: `500 10.5px ${FONT}`,
	num: `500 11px ${FONT}`,
	letter: `600 10px ${FONT}`,
	badge: `500 10.5px ${FONT}`,
};

/**
 * Text cut to a width, with an ellipsis where it was cut. `least` is the part of it that has to stay for it to be
 * worth showing: "triggered by…" says nothing, so a line that would lose more is not shown at all.
 */
function clip(m: Measure, font: string, text: string, max: number, least = 0): string {
	if (max <= 4) return "";
	if (m(font, text) <= max) return text;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (m(font, `${text.slice(0, mid)}…`) <= max) lo = mid;
		else hi = mid - 1;
	}
	return lo > 0 && lo >= text.length * least ? `${text.slice(0, lo).trimEnd()}…` : "";
}

/** A row of a piece of work's last tool calls as pills, the newest at the right: as many as there is room for. */
function pillsOf(m: Measure, calls: ViewCall[], x: number, y: number, room: number): Piece[] {
	const list: Array<{ c: ViewCall; text: string; w: number }> = [];
	let used = 0;
	for (const c of [...calls].reverse()) {
		const text = toolWord(c.tool, c.mcp);
		const w = m(F.tiny, text) + 12;
		if (used + w > room) break;
		list.unshift({ c, text, w });
		used += w + 4;
	}
	let px = x;
	return list.map(({ c, text, w }) => {
		const p: Piece = { k: "pill", x: px, y, w, text, call: c };
		px += w + 4;
		return p;
	});
}

/** What fills a card of `W` by `H` pixels on the panel. */
export function contentOf(b: Box, s: ViewState, now: number, W: number, H: number, m: Measure, recent?: Recent): Piece[] {
	if (b.agent) return agentContent(b.agent, s, now, W, H, m, recent);
	if (b.board) return boardContent(b, b.board, s, now, W, H, m);
	return sideContent(b, s, now, W, H, m);
}

/**
 * An agent's card. What matters most comes first, and each next thing only where there is room for it: the
 * avatar; its name and a word for how it stands; what it is doing, the largest words of the card; the
 * conversation, why and for how long; its steps, its board and its last tool calls; its sub-agents; how long it
 * has run and what it finished lately; and in a second column its conversations and what it is connected to.
 */
function agentContent(a: ViewAgent, s: ViewState, now: number, W: number, H: number, m: Measure, recent?: Recent): Piece[] {
	const out: Piece[] = [];
	const mine = s.work.filter((w) => w.agent === a.id && !ended(w)).sort((p, q) => p.started - q.started);
	const own = mine.filter((w) => !w.copy);
	const copies = mine.filter((w) => w.copy);
	const first = own.find((w) => w.asking) ?? own[0] ?? copies[0];
	// Its swarm: the one of the conversation its work runs in, or with no work running, the one it leads.
	const swarm = first ? swarmOf(a, first.conversation) : leadingOf(a);
	const leads = Boolean(swarm && swarm.status === "active");
	const ask = mine.some((w) => w.asking) || swarmWaits(a);
	const busy = mine.length > 0 || swarming(a);
	if (W < 60 || H < 22) {
		out.push({ k: "avatar", x: W / 2, y: H / 2, r: Math.max(3, Math.min(9, Math.min(W, H) / 2 - 3)), busy, ask });
		return out;
	}
	const pad = W < 150 ? 9 : 12;
	const single = H < 52;
	const r = H < 30 ? 7 : 9;
	const hy = single ? H / 2 : pad + 10;
	out.push({ k: "avatar", x: pad + r, y: hy, r, busy, ask });
	const nameX = pad + r * 2 + 8;
	let right = W - pad;
	if (single) {
		// One line: its name, and at the right one word for how it stands.
		const word = ask ? "asks you" : !busy ? "idle" : !mine.length ? "swarm" : mine.every((w) => w.doing === "waiting") ? "waiting" : "working";
		const ww = m(F.small, word);
		if (right - nameX - ww - 8 >= 30) {
			out.push({ k: "text", x: right, y: hy, text: word, font: F.small, tone: ask ? "warn" : busy ? "accent" : "faint", align: "right" });
			right -= ww + 8;
		}
	} else if (W >= 176) {
		const bw = m(F.badge, a.mode) + 14;
		out.push({ k: "badge", x: right - bw, y: hy, w: bw, text: a.mode, tone: a.mode === "bypass" ? "bad" : "muted" });
		right -= bw + 8;
	}
	out.push({ k: "text", x: nameX, y: hy, text: clip(m, F.name, a.id, right - nameX), font: F.name, tone: busy ? "text" : "muted" });
	if (single) return out;

	// A second column, where there is room for one, for what the agent has rather than what it does.
	const two = W >= 460 && H >= 170;
	const L = pad;
	const colW = two ? Math.round((W - pad * 3) * 0.6) : W - pad * 2;
	const bottom = H - pad + 3;
	let y = hy + 13;
	/** Whether the next thing has room. The first that has none ends the card: nothing less important takes its place. */
	let open = true;
	const fits = (h: number) => open && (y + h <= bottom || (open = false));

	// What it is doing: what the eye goes to first.
	if (fits(19)) {
		// (The sub-agent that checks a swarm's answer is said to do that, whatever tool it is in.)
		const text = first ? (first.swarm === "check" ? "Checking the answer" : sentenceOf(first, s)) : swarm ? swarmWords(swarm) : "Idle";
		const font = first || busy ? F.focus : F.idle;
		out.push({ k: "text", x: L, y: y + 10, text: clip(m, font, text, colW, 0.35), font, tone: ask ? "warn" : first || busy ? "text" : swarm ? "muted" : "faint" });
		y += 22;
	}
	// Where and why: the conversation it works in, who it is for, and for how long. For a moment, what just happened.
	const said = recent?.notes.get(a.id);
	const note = said && now - said.at < 4000 ? said.text : undefined;
	if (fits(18)) {
		const cy = y + 8;
		let x = L;
		let end = L + colW;
		if (first) {
			const time = span(Math.max(0, now - first.started));
			if (time !== "now") {
				out.push({ k: "text", x: end, y: cy, text: time, font: F.small, tone: "faint", align: "right" });
				end -= m(F.small, time) + 8;
			}
			// (The chip's speech bubble says that it is a conversation: the words need not.)
			const where = sessionOf(first, a, true);
			if (where) {
				const text = `${where}${first.worktree ? " · worktree" : ""}`;
				const cw = Math.min(m(F.tiny, text) + 20, end - x);
				const shown = clip(m, F.tiny, text, cw - 20, 0.5);
				if (shown) {
					out.push({ k: "chip", x, y: cy, w: cw, text: shown });
					x += cw + 7;
				}
			}
			// Why: who it is for, or the swarm it is a part of and the round that is in.
			// (Short: at the size a card usually has, a longer line would not fit beside the conversation and the time.)
			const words = note ?? (leads && swarm ? `swarm · ${roundOf(swarm)}` : causeOf(first));
			const said = words ? clip(m, F.small, words, end - x, 0.7) : "";
			if (said) out.push({ k: "text", x, y: cy, text: said, font: F.small, tone: note ? "accent" : "faint" });
		} else {
			const last = s.work.filter((w) => w.agent === a.id && !w.copy && ended(w) && w.finished !== undefined).sort((p, q) => q.finished! - p.finished!)[0];
			const words = note ?? (swarm ? roundOf(swarm) : last ? `last active ${span(Math.max(0, now - last.finished!))} ago` : plural(a.conversations.length, "conversation"));
			out.push({ k: "text", x, y: cy, text: clip(m, F.small, words, end - x, 0.5), font: F.small, tone: note ? "accent" : "faint" });
		}
		y += 20;
	}
	if (first) {
		// How far it is: its to-do list as a bar of steps, and the round of its goal.
		if (first.steps && first.steps.total > 0 && fits(12)) {
			const label = `${first.round ? `round ${first.round} · ` : ""}${first.steps.done}/${first.steps.total}`;
			const lw = m(F.tiny, label);
			out.push({ k: "steps", x: L, y: y + 5, w: colW - lw - 10, done: first.steps.done, total: first.steps.total });
			out.push({ k: "text", x: L + colW, y: y + 5, text: label, font: F.tiny, tone: "faint", align: "right" });
			y += 15;
		}
		// The board its sub-agents work through, as tiles.
		const board = boardsOf(s).find((x) => x.scope === "conversation" && x.agent === a.id && unsettled(x) > 0);
		if (board && fits(16)) {
			const all = board.open + board.taken + board.done + board.failed + board.blocked;
			const label = `${board.done}/${all}`;
			const lw = m(F.tiny, label);
			const t = tiling(board, colW - lw - 10, 13, [[6, 1], [5, 1], [4, 1]]);
			for (const k of t.tiles) out.push({ k: "tile", x: L + k.x, y: y + 1 + k.y, size: t.size, task: k.task, board });
			out.push({ k: "text", x: L + colW, y: y + 7, text: label, font: F.tiny, tone: board.blocked ? "warn" : "faint", align: "right" });
			y += 18;
		}
		// Its last tool calls.
		if (first.calls?.length && fits(18)) {
			out.push(...pillsOf(m, first.calls, L, y + 8, colW));
			y += 20;
		}
		// Its sub-agents as a tree: one that a sub-agent started itself stands in under that one.
		const shown = first.copy ? copies.slice(1) : copies;
		const ids = new Set(shown.map((c) => c.id));
		const tree: Array<{ w: ViewWork; level: number }> = [];
		const walk = (parent: number | undefined, level: number) => {
			for (const c of shown) {
				if ((c.parent !== undefined && ids.has(c.parent) ? c.parent : undefined) !== parent) continue;
				tree.push({ w: c, level });
				walk(c.id, Math.min(level + 1, 3));
			}
		};
		walk(undefined, 1);
		// Before them, the work of other agents it delegated and waits for: each in that agent's color.
		const others = first.waitingOn.map((id) => s.work.find((x) => x.id === id)).filter((x): x is ViewWork => Boolean(x && !ended(x) && !x.copy && x.agent !== a.id));
		const rows: Array<{ w: ViewWork; level: number; other?: boolean }> = [...others.map((w) => ({ w, level: 1, other: true })), ...tree];
		// One that has a task of a board is called by that task's number, which is the tile's in the board's card.
		const taskOf = (w: ViewWork) => (w.board === undefined ? undefined : tasksOf(boardsOf(s).find((x) => x.id === w.board) ?? ({} as ViewBoard)).find((t) => t.worker === w.id)?.id);
		const room = open ? Math.floor((bottom - y) / 18) : 0;
		if (rows.length && room <= 0) open = false;
		if (rows.length && room > 0) {
			// As many as there is room for; what is left is counted at the right of the last.
			const n = Math.min(room, rows.length);
			rows.slice(0, n).forEach((t, i) => {
				const dx = (t.level - 1) * 12;
				const ry = y + 9;
				const time = span(Math.max(0, now - t.w.started));
				const tail = i === n - 1 && n < rows.length ? `+${rows.length - n} more` : time === "now" ? "" : time;
				const color = t.other ? s.agents.find((x) => x.id === t.w.agent)?.color : undefined;
				out.push({ k: "elbow", x: L + 4 + dx, y: ry });
				out.push({ k: "dot", x: L + 16 + dx, y: ry, r: 2.5, tone: t.w.asking ? "warn" : "accent", color: t.w.asking ? undefined : color, pulse: true });
				const tw = tail ? m(F.small, tail) + 8 : 0;
				if (tail) out.push({ k: "text", x: L + colW, y: ry, text: tail, font: F.small, tone: "faint", align: "right" });
				const id = taskOf(t.w);
				const text = `${t.other ? t.w.agent : t.w.swarm === "check" ? "Check of the answer" : id !== undefined ? `Task ${id}` : "Sub-agent"} · ${sentenceOf(t.w, s).toLowerCase()}`;
				out.push({ k: "text", x: L + 24 + dx, y: ry, text: clip(m, F.text, text, colW - 24 - dx - tw), font: F.text, tone: t.w.asking ? "warn" : "muted" });
				y += 18;
			});
			if (n < rows.length) open = false;
		}
		// Its other work, each with the conversation it runs in.
		for (const w of own) {
			if (w === first || !fits(18)) continue;
			const where = sessionOf(w, a) ?? causeOf(w);
			out.push({ k: "dot", x: L + 4, y: y + 9, r: 2.5, tone: w.asking ? "warn" : "accent", pulse: true });
			out.push({ k: "text", x: L + 12, y: y + 9, text: clip(m, F.text, `${sentenceOf(w, s)}${where ? ` · ${where}` : ""}`, colW - 12), font: F.text, tone: w.asking ? "warn" : "text" });
			y += 18;
		}
		// How long it has run, how many tools it called, the mode it is held to.
		if (fits(22)) {
			const parts = [`started ${span(Math.max(0, now - first.started)) === "now" ? "just now" : `${span(now - first.started)} ago`}`, first.tools ? plural(first.tools, "tool call") : "", first.mode && first.mode !== a.mode ? `limited to ${first.mode} mode` : "", first.outside ? "read outside content" : ""].filter(Boolean);
			out.push({ k: "text", x: L, y: y + 13, text: clip(m, F.small, parts.join(" · "), colW), font: F.small, tone: "faint" });
			y += 22;
		}
	}
	// What it finished lately.
	const done = s.work.filter((w) => w.agent === a.id && !w.copy && ended(w) && w.finished !== undefined).sort((p, q) => q.finished! - p.finished!).slice(0, 3);
	const section = (x: number, w: number, label: string, rows: Array<{ text: string; tone: Tone; dot?: Tone; hollow?: boolean; pulse?: boolean }>, at: number, first = true): number => {
		if (!rows.length || !first || at + 34 > bottom) return at;
		out.push({ k: "text", x, y: at + 8, text: label, font: F.label, tone: "faint" });
		at += 18;
		for (const row of rows) {
			if (at + 16 > bottom) break;
			const dx = row.dot ? 11 : 0;
			if (row.dot) out.push({ k: "dot", x: x + 3, y: at + 8, r: 2.5, tone: row.dot, hollow: row.hollow, pulse: row.pulse });
			out.push({ k: "text", x: x + dx, y: at + 8, text: clip(m, F.small, row.text, w - dx), font: F.small, tone: row.tone });
			at += 16;
		}
		return at + 6;
	};
	/** A piece of work that ended, in words: what it was for, how it ended and when, and how long it took. */
	const lately = (w: ViewWork, long: boolean) => {
		const why = causeOf(w);
		const took = w.finished! - w.started;
		return {
			text: `${why ? why[0].toUpperCase() + why.slice(1) : "A task"} · ${w.doing === "failed" ? "failed" : w.doing === "cancelled" ? "stopped" : "done"} ${span(Math.max(0, now - w.finished!)) === "now" ? "just now" : `${span(now - w.finished!)} ago`}${long ? ` · took ${took < 1500 ? "a second" : span(took)}` : ""}`,
			tone: (w.doing === "failed" ? "bad" : "muted") as Tone,
		};
	};
	// What it has: its conversations, the one it works in now first in the eye, and what it is connected to.
	const busyIn = new Set(mine.map((w) => w.conversation).filter((c) => c !== undefined));
	const convs = a.conversations.map((c, i) => ({ text: convText(c, a, i), tone: (busyIn.has(c.id) || c.busy ? "text" : "muted") as Tone, dot: (busyIn.has(c.id) || c.busy ? "accent" : "faint") as Tone, hollow: !(busyIn.has(c.id) || c.busy), pulse: busyIn.has(c.id) || c.busy }));
	const wired = [a.sources.length ? `Events: ${a.sources.join(", ")}` : "", a.schedules.length ? `Schedules: ${a.schedules.join(", ")}` : "", a.mcp.length ? `MCP: ${a.mcp.join(", ")}` : "", a.skills.length ? `Skills: ${a.skills.join(", ")}` : ""].filter(Boolean).map((text) => ({ text, tone: "muted" as Tone }));
	if (two) {
		const x = pad * 2 + colW;
		const w = W - x - pad;
		let at = hy + 13;
		at = section(x, w, "Conversations", convs, at);
		at = section(x, w, "Connected to", wired, at);
		section(x, w, "Lately", done.map((d) => lately(d, false)), at);
	} else {
		y = section(L, colW, "Conversations", convs, y + 2, open);
		y = section(L, colW, "Lately", done.map((d) => lately(d, true)), y, open);
		section(L, colW, "Connected to", wired, y, open);
	}
	return out;
}

/** What a trigger or a tool says beyond its name and its second line, from close by. */
function detailsOf(b: Box, s: ViewState, now: number): Array<{ text: string; tone: Tone }> {
	const dim = (texts: Array<string | undefined | false>) => texts.filter((t): t is string => Boolean(t)).map((text) => ({ text, tone: "faint" as Tone }));
	if (b.kind === "you") return [...s.work.filter((w) => !ended(w) && w.asking).map((w) => `${w.agent}${w.copy ? "'s sub-agent" : ""} needs your answer`), ...boardsOf(s).flatMap((x) => tasksOf(x).filter((t) => t.state === "blocked").map((t) => `Task ${t.id} on ${boardTitle(x)} waits`))].map((text) => ({ text, tone: "warn" as Tone }));
	if (b.kind === "source" || b.kind === "outside") {
		const i = s.inputs.find((x) => x.id === b.id);
		if (!i) return [];
		const who = listenersOf(s, i);
		return dim([i.type ? `${i.type} source` : b.kind === "outside" ? "webhook" : "", `${plural(i.count, "event")}${i.last !== undefined ? `, last ${span(Math.max(0, now - i.last))} ago` : ""}`, who.length > 2 ? `triggers ${who.join(", ")}` : ""]);
	}
	if (b.kind === "sched") {
		const x = s.schedules.find((k) => `sched:${k.name}` === b.id);
		return dim([x?.when, x?.last !== undefined ? `last ran ${span(Math.max(0, now - x.last))} ago` : "has not run since the panel opened"]);
	}
	const kind = b.kind === "mcp" ? "mcp" : "skill";
	const has = s.agents.filter((a) => (kind === "mcp" ? a.mcp : a.skills).includes(b.title)).map((a) => a.id);
	return [{ text: `${b.kind === "mcp" ? "MCP server" : "skill"} of ${listOf(has, 4)}`, tone: "faint" }];
}

/** A trigger or a tool: its name, a word at the right, a second line, and from close by all a view knows of it. */
function sideContent(b: Box, s: ViewState, now: number, W: number, H: number, m: Measure): Piece[] {
	const out: Piece[] = [];
	if (W < 30 || H < 12) return out;
	const pad = W < 100 ? 7 : 10;
	const single = H < 36;
	const ty = single ? H / 2 : 15.5;
	const warn: Tone = b.kind === "source" ? "bad" : "warn";
	let right = W - pad;
	if (b.right) {
		// The name comes first: what stands at its right only where the name keeps most of itself.
		const rw = m(F.small, b.right);
		const kept = clip(m, F.title, b.title, right - pad - rw - 8);
		if (kept === b.title || kept.length >= 7) {
			out.push({ k: "text", x: right, y: ty, text: b.right, font: F.small, tone: b.bad ? warn : "faint", align: "right" });
			right -= rw + 8;
		}
	}
	out.push({ k: "text", x: pad, y: ty, text: clip(m, F.title, b.title, right - pad), font: F.title, tone: b.busy || b.bad ? "text" : "muted" });
	if (single) return out;
	const sub = b.sub ? clip(m, F.small, b.sub, W - 2 * pad, 0.6) : "";
	if (sub) out.push({ k: "text", x: pad, y: 31, text: sub, font: F.small, tone: b.bad ? warn : b.busy ? "accent" : "faint" });
	let y = 42;
	for (const d of detailsOf(b, s, now)) {
		if (y + 16 > H - pad + 3) break;
		out.push({ k: "text", x: pad, y: y + 8, text: clip(m, F.small, d.text, W - 2 * pad, 0.5), font: F.small, tone: d.tone });
		y += 16;
	}
	return out;
}

/** A board's card: its name and how far it is, what happens on it, a bar, and its tasks: as tiles, or where there is room, a row for each. */
function boardContent(b: Box, x: ViewBoard, s: ViewState, now: number, W: number, H: number, m: Measure): Piece[] {
	const out: Piece[] = sideContent({ ...b, board: undefined }, s, now, W, H, m).filter((p) => p.k === "text" && p.y < 40);
	const all = x.open + x.taken + x.done + x.failed + x.blocked;
	if (!all || H < 50 || W < 40) return out;
	const pad = W < 100 ? 7 : 10;
	const w = W - 2 * pad;
	out.push({ k: "bar", x: pad, y: 42, w, board: x });
	const top = 52;
	const room = H - top - pad + 2;
	if (W >= 190 && room >= 3 * ROW) {
		const rows = rowsOf(x, s, now);
		const n = Math.floor(room / ROW);
		const shown = rows.length > n ? [...rows.slice(0, n - 1), { indent: 0, text: `+${plural(rows.length - n + 1, "more task")}`, flags: "" }] : rows;
		shown.forEach((row, i) => {
			const ry = top + i * ROW + ROW / 2;
			const t = row.task;
			let tx = pad + row.indent * 12;
			if (t) out.push({ k: "row", x: 4, y: ry - ROW / 2, w: W - 8, h: ROW, task: t, board: x });
			if (row.indent) out.push({ k: "elbow", x: tx - 6, y: ry });
			if (t) {
				out.push({ k: "tile", x: tx, y: ry - 4, size: 8, task: t, board: x });
				tx += 14;
				out.push({ k: "text", x: tx, y: ry, text: `${t.id}`, font: F.num, tone: "muted" });
				tx += m(F.num, `${t.id}`) + 7;
			}
			const fw = row.flags ? Math.min(m(F.tiny, row.flags), w * 0.4) + 8 : 0;
			if (row.flags) out.push({ k: "text", x: pad + w, y: ry, text: clip(m, F.tiny, row.flags, w * 0.4), font: F.tiny, tone: "faint", align: "right" });
			const tone: Tone = !t ? "faint" : t.state === "taken" ? "text" : t.state === "blocked" ? "warn" : t.state === "failed" ? "bad" : t.state === "done" ? "muted" : "faint";
			out.push({ k: "text", x: tx, y: ry, text: clip(m, F.text, row.text, pad + w - tx - fw), font: F.text, tone });
		});
		return out;
	}
	if (room < 4) return out;
	const t = tiling(x, w, room, [[8, 2], [7, 2], [6, 2], [5, 2], [4, 1]], 3);
	for (const k of t.tiles) out.push({ k: "tile", x: pad + k.x, y: top + 2 + k.y, size: t.size, task: k.task, board: x });
	if (t.more && t.tiles.length) out.push({ k: "text", x: W - pad, y: H - 9, text: `+${t.more}`, font: F.tiny, tone: "faint", align: "right" });
	return out;
}

// ---- drawing ---------------------------------------------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;
/**
 * The colors of the Pine app, as far as a view can know them: it is told whether the app is dark, not its theme.
 * So the board has no ground of its own (the panel's shows through), and every surface and line is the text's
 * color, thinned: the way pine's own themes make theirs. Only what warns is a color of its own.
 */
interface Theme {
	text: string;
	muted: string;
	faint: string;
	/** A question for you, and what is down or failed. */
	warn: string;
	bad: string;
}
const DARK: Theme = { text: "#e4f0fb", muted: "#a6accd", faint: "#767c9d", warn: "#fffac2", bad: "#d0679d" };
const LIGHT: Theme = { text: "#1f2328", muted: "#59636e", faint: "#818b98", warn: "#9a6700", bad: "#cf222e" };
/** A color, thinned: what lies under it shows through. */
const veil = (hex: string, alpha: number) => `rgba(${rgb(hex).join(", ")}, ${alpha})`;
/** White or a near-black, whichever reads better on a color: as the app writes an agent's initial on its avatar. */
function onColor(hex: string): string {
	const lum = (c: string) => {
		const [r, g, b] = rgb(c).map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const l = lum(hex);
	return 1.05 / (l + 0.05) >= (l + 0.05) / (lum("#141414") + 0.05) ? "#ffffff" : "#141414";
}

const WIDTHS = new Map<string, number>();
/** The canvas's measure, kept: the same words are measured at each frame. */
function measurer(g: Ctx): Measure {
	return (font, text) => {
		const key = `${font}|${text}`;
		let w = WIDTHS.get(key);
		if (w === undefined) {
			if (WIDTHS.size > 6000) WIDTHS.clear();
			g.font = font;
			w = g.measureText(text).width;
			WIDTHS.set(key, w);
		}
		return w;
	};
}

function rounded(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
	const k = Math.max(0, Math.min(r, w / 2, h / 2));
	g.beginPath();
	g.moveTo(x + k, y);
	g.arcTo(x + w, y, x + w, y + h, k);
	g.arcTo(x + w, y + h, x, y + h, k);
	g.arcTo(x, y + h, x, y, k);
	g.arcTo(x, y, x + w, y, k);
	g.closePath();
}

/** A path of straight pieces with each corner cut off at 45 degrees, the way a trace turns on a board. */
function chamfer(pts: Array<[number, number]>, r: number): Array<[number, number]> {
	const out: Array<[number, number]> = [pts[0]];
	for (let i = 1; i < pts.length - 1; i++) {
		const [px, py] = pts[i];
		const [ax, ay] = pts[i - 1];
		const [bx, by] = pts[i + 1];
		const la = Math.hypot(ax - px, ay - py);
		const lb = Math.hypot(bx - px, by - py);
		const k = Math.min(r, la / 2, lb / 2);
		if (k < 0.5) out.push([px, py]);
		else out.push([px + ((ax - px) / la) * k, py + ((ay - py) / la) * k], [px + ((bx - px) / lb) * k, py + ((by - py) / lb) * k]);
	}
	out.push(pts[pts.length - 1]);
	return out;
}

/** Where `n` lines meet one side of a box: around its middle, a little apart. */
function pinsOf(b: Box, n: number): number[] {
	const pitch = n > 1 ? Math.min(7, (b.h - 14) / (n - 1)) : 0;
	return Array.from({ length: n }, (_, i) => b.y + b.h / 2 + (i - (n - 1) / 2) * pitch);
}

/**
 * The way of each line across the board, as a board's traces run. A line leaves a box at its side, runs
 * straight across, turns into a lane of its own between the columns, and turns once more into the box it goes
 * to; each turn is cut at 45 degrees. No two lines share a lane, and several at one side of a box meet it a
 * little apart. A task delegated from agent to agent runs in a lane close beside the agents at their left,
 * its answer at their right. On a tall panel the lines run another way (`tallRoutes`).
 */
export function routesOf(links: Link[], l: Layout): Array<Array<[number, number]> | undefined> {
	if (l.parts) return tallRoutes(links, l, l.parts);
	const mid = (b: Box) => b.y + b.h / 2;
	const info = links.map((k) => {
		const a = l.byId.get(k.from);
		const b = l.byId.get(k.to);
		return a && b ? { a, b, same: a.col === b.col, forward: a.col < b.col, back: Boolean(k.back) && a.col === b.col } : undefined;
	});
	// Where each line meets its two boxes: several on one side of a box are spread, in the order of where they come from.
	type End = { key: number; box: Box; other: number };
	const sides = new Map<string, End[]>();
	info.forEach((v, i) => {
		if (!v) return;
		const put = (key: number, box: Box, other: Box, side: string) => sides.set(`${box.id}|${side}`, [...(sides.get(`${box.id}|${side}`) ?? []), { key, box, other: mid(other) }]);
		put(i * 2, v.a, v.b, v.same ? (v.back ? "r" : "l") : v.forward ? "r" : "l");
		put(i * 2 + 1, v.b, v.a, v.same ? (v.back ? "r" : "l") : v.forward ? "l" : "r");
	});
	const yOf = new Map<number, number>();
	for (const list of sides.values()) {
		list.sort((p, q) => p.other - q.other || p.key - q.key);
		const ys = pinsOf(list[0].box, list.length);
		list.forEach((e, n) => yOf.set(e.key, ys[n]));
	}
	// A lane for each line. Those from agent to agent first, the shortest nearest the agents.
	const lane = new Map<number, number>();
	const reach = (i: number) => Math.abs(yOf.get(i * 2)! - yOf.get(i * 2 + 1)!);
	const beside = (back: boolean) => info.map((v, i) => (v?.same && v.back === back ? i : -1)).filter((i) => i >= 0).sort((p, q) => reach(p) - reach(q));
	const out = beside(false);
	const home = beside(true);
	out.forEach((i, n) => lane.set(i, l.cols[1].x - PIN - 6 - n * 6));
	home.forEach((i, n) => lane.set(i, l.cols[1].x + l.cols[1].w + PIN + 6 + n * 6));
	const keptLeft = out.length ? 6 + out.length * 6 : 0;
	const keptRight = home.length ? 6 + home.length * 6 : 0;
	for (const left of [true, false]) {
		const x0 = (left ? l.cols[0].x + l.cols[0].w : l.cols[1].x + l.cols[1].w) + PIN + (left ? 0 : keptRight);
		const x1 = (left ? l.cols[1].x : l.cols[2].x) - PIN - (left ? keptLeft : 0);
		const mine = info.map((v, i) => (v && !v.same && (Math.min(v.a.col, v.b.col) === 0) === left ? i : -1)).filter((i) => i >= 0);
		// The end of a line at the left of the gap, and at its right, whichever way the line goes.
		const yl = (i: number) => yOf.get(info[i]!.forward ? i * 2 : i * 2 + 1)!;
		const yr = (i: number) => yOf.get(info[i]!.forward ? i * 2 + 1 : i * 2)!;
		// Lines that go down, the lowest in the lane furthest left; then lines that go up, the highest furthest left: so they nest and do not cross.
		const down = mine.filter((i) => yr(i) >= yl(i)).sort((p, q) => yl(q) - yl(p));
		const up = mine.filter((i) => yr(i) < yl(i)).sort((p, q) => yl(p) - yl(q));
		const all = [...down, ...up];
		all.forEach((i, n) => lane.set(i, Math.round(x0 + 4 + ((x1 - x0 - 8) * (n + 1)) / (all.length + 1))));
	}
	return info.map((v, i) => {
		if (!v) return undefined;
		const ya = yOf.get(i * 2)!;
		const yb = yOf.get(i * 2 + 1)!;
		const right = (b: Box) => b.x + b.w + PIN;
		const xa = v.same ? (v.back ? right(v.a) : v.a.x - PIN) : v.forward ? right(v.a) : v.a.x - PIN;
		const xb = v.same ? (v.back ? right(v.b) : v.b.x - PIN) : v.forward ? v.b.x - PIN : right(v.b);
		if (!v.same && Math.abs(ya - yb) < 1) return [[xa, ya], [xb, yb]];
		const x = lane.get(i)!;
		return chamfer([[xa, ya], [x, ya], [x, yb], [xb, yb]], 5);
	});
}

/**
 * The lines on a tall panel, where the parts stand one under the other and their cards side by side. A line leaves a
 * card at a side into the gutter beside it, runs along the gutter to the gap under its row or its part, across that
 * gap in a lane of its own, and along the gutter beside the other card into its side. Of the two gutters of a card the
 * one is taken that makes the way across shortest; a task handed from agent to agent in the same place in a row goes
 * by the gutter at their left, its answer at their right. In a gutter, of the lines that meet a side of it, the
 * shortest runs nearest that side; in a gap, lanes are ordered so that lines going the same way do not cross.
 */
function tallRoutes(links: Link[], l: Layout, parts: Part[]): Array<Array<[number, number]> | undefined> {
	type Pt = [number, number];
	/** A gutter of a part: `g` 0 at the board's left edge, `n` at its right, the others between two cards. */
	const gutter = (col: number, g: number): [number, number] => {
		const P = parts[col];
		return [g === 0 ? -MARGIN : P.x + g * (P.w + GUTTER) - GUTTER, g === P.n ? l.w + MARGIN : P.x + g * (P.w + GUTTER)];
	};
	const middle = (col: number, g: number) => {
		const [a, b] = gutter(col, g);
		return (a + b) / 2;
	};
	/** The gap under a row of a part: between it and the next row, or under the part's last row the gap before the next part. */
	const gapUnder = (col: number, row: number): { key: string; y0: number; y1: number } => {
		const P = parts[col];
		const r = P.rows[row];
		const next = P.rows[row + 1];
		return next ? { key: `${col}:${row}`, y0: r.y + r.h, y1: next.y } : { key: `${col}:end`, y0: P.bottom, y1: col < 2 ? parts[col + 1].top : P.bottom + BAND };
	};
	type Way = { a: Box; b: Box; ga: number; gb: number; shared: boolean; gap?: { key: string; y0: number; y1: number } };
	const ways: Array<Way | undefined> = links.map((k) => {
		const a = l.byId.get(k.from);
		const b = l.byId.get(k.to);
		if (!a || !b || a.slot === undefined || b.slot === undefined || a.row === undefined || b.row === undefined) return undefined;
		if (a.col === b.col && a.slot === b.slot) {
			const g = k.back ? a.slot + 1 : a.slot;
			return { a, b, ga: g, gb: g, shared: true };
		}
		// Of each card's two gutters, the pair nearest each other.
		let best = { ga: a.slot, gb: b.slot, d: Infinity };
		for (const ga of [a.slot, a.slot + 1])
			for (const gb of [b.slot, b.slot + 1]) {
				const d = Math.abs(middle(a.col, ga) - middle(b.col, gb));
				if (d < best.d - 0.5) best = { ga, gb, d };
			}
		const shared = a.col === b.col && best.ga === best.gb;
		// Between two parts, the gap under the upper part; within a part, the gap under the upper card's row.
		const upper = a.col < b.col || (a.col === b.col && a.row! <= b.row!) ? a : b;
		const row = a.col === b.col ? upper.row! : parts[upper.col].rows.length - 1;
		return { a, b, ga: best.ga, gb: best.gb, shared, gap: shared ? undefined : gapUnder(upper.col, row) };
	});
	const mid = (b: Box) => b.y + b.h / 2;
	const gapMid = (w: Way, other: Box) => (w.gap ? (w.gap.y0 + w.gap.y1) / 2 : mid(other));

	// Where each line meets its cards: several at one side of a card a little apart, those that go up above those that go down.
	type End = { key: number; box: Box; far: number };
	const sides = new Map<string, End[]>();
	ways.forEach((w, i) => {
		if (!w) return;
		const put = (key: number, box: Box, g: number, far: number) => {
			const id = `${box.id}|${g === box.slot ? "l" : "r"}`;
			sides.set(id, [...(sides.get(id) ?? []), { key, box, far }]);
		};
		put(i * 2, w.a, w.ga, gapMid(w, w.b));
		put(i * 2 + 1, w.b, w.gb, gapMid(w, w.a));
	});
	const yOf = new Map<number, number>();
	for (const list of sides.values()) {
		list.sort((p, q) => p.far - q.far || p.key - q.key);
		const ys = pinsOf(list[0].box, list.length);
		list.forEach((e, n) => yOf.set(e.key, ys[n]));
	}

	// A lane in each gutter a line runs along: from each side of the gutter, the shortest way nearest that side.
	type Visit = { key: number; left: boolean; span: number };
	const gutters = new Map<string, Visit[]>();
	ways.forEach((w, i) => {
		if (!w) return;
		const visit = (end: 0 | 1) => {
			const box = end ? w.b : w.a;
			const g = end ? w.gb : w.ga;
			const y = yOf.get(i * 2 + end)!;
			const far = w.shared ? yOf.get(i * 2 + 1 - end)! : (w.gap!.y0 + w.gap!.y1) / 2;
			const id = `${box.col}|${g}`;
			gutters.set(id, [...(gutters.get(id) ?? []), { key: i * 2 + end, left: g !== box.slot, span: Math.abs(far - y) }]);
		};
		visit(0);
		if (!w.shared) visit(1);
	});
	const xOf = new Map<number, number>();
	for (const [id, list] of gutters) {
		const [col, g] = id.split("|").map(Number);
		const [x0, x1] = gutter(col, g);
		const room = x1 - x0;
		const pitch = Math.max(2, Math.min(4, (room - 2 * (PIN + 6)) / Math.max(1, list.length - 1)));
		for (const left of [true, false]) {
			const mine = list.filter((v) => v.left === left).sort((p, q) => p.span - q.span || p.key - q.key);
			mine.forEach((v, n) => xOf.set(v.key, Math.round(Math.max(x0 + 2, Math.min(x1 - 2, left ? x0 + PIN + 7 + n * pitch : x1 - PIN - 7 - n * pitch)))));
		}
	}

	// A lane in each gap a line crosses: those going right, the one that starts furthest right on top; then those going left.
	const yLane = new Map<number, number>();
	const gaps = new Map<string, number[]>();
	ways.forEach((w, i) => w?.gap && gaps.set(w.gap.key, [...(gaps.get(w.gap.key) ?? []), i]));
	for (const list of gaps.values()) {
		const gap = ways[list[0]]!.gap!;
		// Where a line comes into the gap from above, and where it leaves it below (or, between two cards of one row, where it leaves it).
		const ends = (i: number) => {
			const w = ways[i]!;
			const xa = xOf.get(i * 2)!;
			const xb = xOf.get(i * 2 + 1)!;
			return w.a.y <= w.b.y ? [xa, xb] : [xb, xa];
		};
		const right = list.filter((i) => ends(i)[1] >= ends(i)[0]).sort((p, q) => ends(q)[0] - ends(p)[0]);
		const left = list.filter((i) => ends(i)[1] < ends(i)[0]).sort((p, q) => ends(p)[0] - ends(q)[0]);
		const all = [...right, ...left];
		all.forEach((i, n) => yLane.set(i, Math.round(gap.y0 + 4 + ((gap.y1 - gap.y0 - 8) * (n + 1)) / (all.length + 1))));
	}

	return ways.map((w, i) => {
		if (!w) return undefined;
		const ya = yOf.get(i * 2)!;
		const yb = yOf.get(i * 2 + 1)!;
		const side = (box: Box, g: number) => (g === box.slot ? box.x - PIN : box.x + box.w + PIN);
		const xa = side(w.a, w.ga);
		const xb = side(w.b, w.gb);
		const ga = xOf.get(i * 2)!;
		if (w.shared) return chamfer([[xa, ya], [ga, ya], [ga, yb], [xb, yb]], 5);
		const gb = xOf.get(i * 2 + 1)!;
		if (Math.abs(ga - gb) < 1) return chamfer([[xa, ya], [ga, ya], [ga, yb], [xb, yb]], 5);
		const y = yLane.get(i)!;
		const pts: Pt[] = [[xa, ya], [ga, ya], [ga, y], [gb, y], [gb, yb], [xb, yb]];
		return chamfer(pts, 5);
	});
}

export interface Shown {
	/** The box the pointer is over, and the one that was clicked. */
	hover?: string;
	selected?: string;
	recent: Recent;
	/** The task that is shown under the view, if one is: its board's number and its own. */
	task?: { board: number; task: number };
	/** Where the camera is, and the size of the panel. */
	cam: Cam;
	view: Size;
}

/**
 * The whole board as the camera sees it, into a canvas whose units are the panel's own pixels. The canvas is left
 * clear where nothing is drawn. The cards are where the board says, at the zoom's size; what is in them, the
 * traces' width and the words are drawn at the panel's own size. Returns where each task was drawn.
 */
export function draw(g: Ctx, s: ViewState, l: Layout, now: number, o: Shown): Hit[] {
	const th = s.dark ? DARK : LIGHT;
	const deep = (c: string) => (c === ASK ? th.warn : c === FAILED ? th.bad : s.dark ? c : mix(c, "#15171d", 0.25));
	const m = measurer(g);
	const hits: Hit[] = [];
	const z = o.cam.z;
	// Where the board's corner is on the panel, and a point of the board on the panel.
	const ox = o.view.w / 2 - o.cam.x * z;
	const oy = BAR + (o.view.h - BAR) / 2 - o.cam.y * z;
	const X = (x: number) => ox + x * z;
	const Y = (y: number) => oy + y * z;
	g.globalAlpha = 1;
	g.clearRect(0, 0, o.view.w, o.view.h);
	g.save();
	// The line on top of the panel is not drawn under.
	g.beginPath();
	g.rect(0, BAR, o.view.w, o.view.h - BAR);
	g.clip();

	// The ground: a grid of faint dots, as far as the panel reaches.
	let grid = 16;
	while (grid * z < 12) grid *= 2;
	const step = grid * z;
	g.fillStyle = veil(th.text, s.dark ? 0.07 : 0.1);
	g.beginPath();
	for (let x = ((ox % step) + step) % step; x < o.view.w; x += step) for (let y = ((oy % step) + step) % step; y < o.view.h; y += step) g.rect(Math.round(x), Math.round(y), 1, 1);
	g.fill();

	g.textBaseline = "middle";
	g.lineCap = "round";
	g.lineJoin = "round";
	const seen = (b: { y: number; h: number }) => Y(b.y + b.h) > BAR - 8 && Y(b.y) < o.view.h + 8;

	const live = linksOf(s, l, now);
	const focus = o.hover ?? o.selected;
	const wires = wiringOf(focus, s, l).filter((k) => !live.some((x) => x.from === k.from && x.to === k.to));
	// What belongs with the box the pointer is over; everything else steps back.
	const near = new Set<string>();
	if (focus) {
		near.add(focus);
		for (const k of [...wires, ...live]) if (k.from === focus || k.to === focus) near.add(k.from), near.add(k.to);
	}
	const faded = (id: string) => focus !== undefined && !near.has(id);
	const lit = (k: Link) => !focus || k.from === focus || k.to === focus;

	// What each column is, just above its first card, and above each group in it what the group is: as the app's
	// side bar names its groups. From far the groups' names would stand on the cards, so they go.
	g.globalAlpha = focus ? 0.5 : 1;
	g.textAlign = "left";
	g.textBaseline = "bottom";
	g.font = `500 12px ${FONT}`;
	g.fillStyle = th.muted;
	for (const c of l.cols) g.fillText(c.title, X(c.x) + 2, Y(c.y + TITLE) - 5);
	if (z >= 0.6) {
		g.font = `11px ${FONT}`;
		g.fillStyle = th.faint;
		for (const head of l.heads) if (seen({ y: head.y, h: HEAD })) g.fillText(head.text, X(head.x ?? l.cols[head.col].x) + 2, Y(head.y + HEAD) - 4);
	}
	g.textBaseline = "middle";

	// The cards.
	for (const b of l.boxes) {
		if (!seen(b)) continue;
		const R = { x: Math.round(X(b.x)), y: Math.round(Y(b.y)), w: Math.round(b.w * z), h: Math.round(b.h * z) };
		const mine = live.filter((k) => k.from === b.id || k.to === b.id);
		const hot = now - (o.recent.hot.get(b.id) ?? -1e9) < 1400;
		// An agent whose answer is still on its way back is part of what happens, though its work is over.
		const active = Boolean(b.busy) || mine.length > 0 || hot;
		// What warns: a source that is down in the color of what failed, a question for you in the color of a question.
		const alarm = b.bad ? (b.kind === "source" ? th.bad : th.warn) : undefined;
		const accent = deep(b.agent?.color ?? mine[0]?.color ?? th.muted);
		const color = alarm ?? accent;
		const fade = faded(b.id) ? 0.3 : 1;
		const r = Math.max(4, Math.min(12, (b.kind === "agent" ? 10 : 8) * Math.sqrt(z)));
		g.globalAlpha = fade;
		// What happens has a glow of its color; what rests is flat.
		if ((active && (b.agent || b.kind === "you")) || (alarm && b.kind !== "source")) {
			g.save();
			g.shadowColor = veil(color, s.dark ? 0.5 : 0.32);
			g.shadowBlur = Math.max(6, Math.min(22, 16 * z));
			rounded(g, R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1, r);
			g.strokeStyle = veil(color, 0.6);
			g.lineWidth = 1;
			g.stroke();
			g.restore();
		}
		rounded(g, R.x, R.y, R.w, R.h, r);
		g.fillStyle = veil(th.text, active || alarm ? (s.dark ? 0.04 : 0.035) : s.dark ? 0.025 : 0.02);
		g.fill();
		if (active || alarm) {
			const grad = g.createLinearGradient(0, R.y, 0, R.y + R.h);
			grad.addColorStop(0, veil(color, hot ? 0.26 : s.dark ? 0.15 : 0.1));
			grad.addColorStop(1, veil(color, hot ? 0.12 : s.dark ? 0.04 : 0.03));
			g.fillStyle = grad;
			g.fill();
		}
		g.lineWidth = 1;
		g.strokeStyle = active || alarm ? veil(color, 0.55) : veil(th.text, s.dark ? 0.09 : 0.12);
		rounded(g, R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1, r);
		g.stroke();
		if (b.id === focus) {
			// What the pointer is over, or what is shown under the view: a ring around it.
			g.strokeStyle = veil(th.text, 0.5);
			g.lineWidth = 1.5;
			rounded(g, R.x - 2.5, R.y - 2.5, R.w + 5, R.h + 5, r + 2.5);
			g.stroke();
		}
		// What is in it, kept inside it.
		g.save();
		rounded(g, R.x, R.y, R.w, R.h, r);
		g.clip();
		paint(g, contentOf(b, s, now, R.w, R.h, m, o.recent), R, { th, s, deep, accent, agent: b.agent, now, fade, chosen: o.task }, hits);
		g.restore();
	}

	// The lines: thin where the pointer asks what a box is wired to, full where something happens.
	const onPanel = (pts: Array<[number, number]>): Array<[number, number]> => pts.map(([x, y]) => [X(x), Y(y)]);
	const stroke = (pts: Array<[number, number]>) => {
		g.beginPath();
		pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
		g.stroke();
	};
	routesOf(wires, l).forEach((pts, i) => {
		if (!pts) return;
		g.globalAlpha = 0.5;
		g.strokeStyle = deep(wires[i].color);
		g.lineWidth = 1;
		stroke(onPanel(pts));
	});
	const ways = routesOf(live, l).map((pts, i) => ({ k: live[i], board: pts, pts: pts && onPanel(pts) }));
	for (const { k, pts } of ways) {
		if (!pts) continue;
		g.globalAlpha = lit(k) ? 1 : 0.14;
		g.strokeStyle = g.fillStyle = deep(k.color);
		g.lineWidth = 1.5;
		stroke(pts);
		// Where it comes from, a dot; where it goes, an arrowhead that touches the box.
		const first = pts[0];
		const last = pts[pts.length - 1];
		const dir = last[0] >= pts[pts.length - 2][0] ? 1 : -1;
		const tip = last[0] + dir * PIN * z;
		g.beginPath();
		g.arc(first[0], first[1], 2.5, 0, Math.PI * 2);
		g.fill();
		g.beginPath();
		g.moveTo(tip, last[1]);
		g.lineTo(tip - dir * 6.5, last[1] - 3.6);
		g.lineTo(tip - dir * 6.5, last[1] + 3.6);
		g.closePath();
		g.fill();
	}

	// One dot runs along each line of what happens, the way it goes: lighter than its line, so that it shows on it.
	const lengthOf = (pts: Array<[number, number]>) => pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
	const moved = new Set<string>();
	for (const { k, board, pts } of ways) {
		if (!pts || !board) continue;
		const lens = lengthOf(pts);
		const total = lens.reduce((n, v) => n + v, 0);
		if (total < 24) continue;
		// Once along a line takes longer the longer it is on the board: not on the panel, where a zoom would change it.
		const period = 900 + lengthOf(board).reduce((n, v) => n + v, 0) * 6;
		const key = `${k.from}>${k.to}${k.back ? "<" : ""}`;
		const was = o.recent.dots.get(key);
		const p0 = was ? (was.p + Math.max(0, Math.min(1000, now - was.at)) / period) % 1 : 0;
		o.recent.dots.set(key, { p: p0, at: now });
		moved.add(key);
		// (A line the pointer dims keeps its dot going, unseen: it is where it would be when the line is lit again.)
		if (!lit(k)) continue;
		let at = p0 * total;
		let p = pts[0];
		for (let i = 0; i < lens.length; i++) {
			if (at <= lens[i] || i === lens.length - 1) {
				const u = lens[i] ? Math.min(1, at / lens[i]) : 0;
				p = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u];
				break;
			}
			at -= lens[i];
		}
		g.globalAlpha = 1;
		g.fillStyle = mix(deep(k.color), s.dark ? "#ffffff" : "#000000", 0.45);
		g.beginPath();
		g.arc(p[0], p[1], 3, 0, Math.PI * 2);
		g.fill();
	}
	// A line that is gone takes its dot with it: one that comes again starts at its beginning.
	for (const key of o.recent.dots.keys()) if (!moved.has(key)) o.recent.dots.delete(key);
	g.restore();
	g.globalAlpha = 1;
	return hits;
}

/** What `paint` needs besides the pieces. */
interface Paint {
	th: Theme;
	s: ViewState;
	deep: (c: string) => string;
	/** The color of the card: its agent's, or of what happens at it. */
	accent: string;
	agent?: ViewAgent;
	now: number;
	fade: number;
	/** The task that is read under the view. */
	chosen?: { board: number; task: number };
}

/** The pieces of a card, at the card's corner `R` on the panel. Tasks drawn go into `hits`. */
function paint(g: Ctx, pieces: Piece[], R: { x: number; y: number }, c: Paint, hits: Hit[]): void {
	const { th, s, now, fade } = c;
	const tone = (t: Tone) => (t === "text" ? th.text : t === "muted" ? th.muted : t === "faint" ? th.faint : t === "warn" ? th.warn : t === "bad" ? th.bad : c.accent);
	/** The app's own sign of something going on: fading out and in, in steps. */
	const breath = [1, 0.75, 0.5, 0.75][Math.floor(now / 300) % 4];
	const pulse = 0.62 + 0.38 * Math.sin(now / 320);
	const colorOf = (b: ViewBoard, id?: string) => c.deep(s.agents.find((a) => a.id === (id ?? b.agent))?.color ?? th.muted);
	g.textBaseline = "middle";
	for (const p of pieces) {
		const x = R.x + p.x;
		const y = R.y + p.y;
		g.globalAlpha = fade;
		switch (p.k) {
			case "text":
				g.font = p.font;
				g.textAlign = p.align ?? "left";
				g.fillStyle = tone(p.tone);
				g.fillText(p.text, x, y + 0.5);
				break;
			case "avatar": {
				const color = c.agent?.color ?? th.muted;
				const letter = (c.agent?.id ?? "?").slice(0, 1).toUpperCase();
				g.textAlign = "center";
				g.font = p.r >= 7 ? F.letter : `600 ${Math.max(6, p.r * 1.1)}px ${FONT}`;
				if (p.busy) {
					// At work: its color, filled, and a ring that turns around it.
					g.fillStyle = color;
					g.beginPath();
					g.arc(x, y, p.r, 0, Math.PI * 2);
					g.fill();
					if (p.r >= 6) {
						g.fillStyle = onColor(color);
						g.fillText(letter, x, y + 0.5);
					}
					const turn = (now / 520) % (Math.PI * 2);
					g.strokeStyle = p.ask ? th.warn : c.deep(color);
					g.lineWidth = 1.5;
					g.globalAlpha = fade * (p.ask ? breath : 0.9);
					g.beginPath();
					if (p.ask) g.arc(x, y, p.r + 3.5, 0, Math.PI * 2);
					else g.arc(x, y, p.r + 3.5, turn, turn + Math.PI * 0.7);
					g.stroke();
				} else {
					// At rest: an outline in its color.
					g.strokeStyle = veil(color, 0.75);
					g.lineWidth = 1.5;
					g.beginPath();
					g.arc(x, y, p.r - 0.75, 0, Math.PI * 2);
					g.stroke();
					if (p.r >= 6) {
						g.fillStyle = c.deep(color);
						g.fillText(letter, x, y + 0.5);
					}
				}
				break;
			}
			case "badge":
				rounded(g, x + 0.5, y - 8.5, p.w, 17, 8.5);
				g.strokeStyle = veil(th.text, s.dark ? 0.12 : 0.16);
				g.lineWidth = 1;
				g.stroke();
				g.font = F.badge;
				g.textAlign = "center";
				g.fillStyle = tone(p.tone);
				g.fillText(p.text, x + p.w / 2 + 0.5, y + 0.5);
				break;
			case "chip":
				// The conversation: a small pill in the agent's color, with a speech bubble in front.
				rounded(g, x + 0.5, y - 8, p.w, 16, 8);
				g.fillStyle = veil(c.accent, s.dark ? 0.12 : 0.08);
				g.fill();
				g.strokeStyle = veil(c.accent, 0.45);
				g.lineWidth = 1;
				g.stroke();
				g.strokeStyle = c.accent;
				g.lineWidth = 1.2;
				rounded(g, x + 5.5, y - 3.5, 7, 5.5, 1.8);
				g.stroke();
				g.beginPath();
				g.moveTo(x + 7.5, y + 2);
				g.lineTo(x + 7, y + 4);
				g.lineTo(x + 9.5, y + 2);
				g.stroke();
				g.font = F.tiny;
				g.textAlign = "left";
				g.fillStyle = th.text;
				g.fillText(p.text, x + 15, y + 0.5);
				break;
			case "steps": {
				// A segment for each step while they fit, done ones in the agent's color, the one it is on breathing.
				if (p.w <= 0) break;
				if (p.total > 24 || p.w / p.total < 6) {
					// Too many to tell apart: one bar, as far as it is.
					rounded(g, x, y - 2, p.w, 4, 2);
					g.fillStyle = veil(th.text, s.dark ? 0.12 : 0.14);
					g.fill();
					rounded(g, x, y - 2, Math.max(2, (p.w * Math.min(p.done, p.total)) / p.total), 4, 2);
					g.fillStyle = c.accent;
					g.fill();
					break;
				}
				const seg = (p.w - 2 * (p.total - 1)) / p.total;
				for (let i = 0; i < p.total; i++) {
					g.globalAlpha = fade * (i === p.done ? pulse * 0.6 : 1);
					rounded(g, x + i * (seg + 2), y - 2, seg, 4, 2);
					g.fillStyle = i <= p.done ? c.accent : veil(th.text, s.dark ? 0.12 : 0.14);
					g.fill();
				}
				break;
			}
			case "bar": {
				// How a board's tasks stand: done, in progress, asking, failed, and the rest still to do.
				const b = p.board;
				const all = b.open + b.taken + b.done + b.failed + b.blocked;
				rounded(g, x, y - 2, p.w, 4, 2);
				g.fillStyle = veil(th.text, s.dark ? 0.1 : 0.12);
				g.fill();
				let at = x;
				for (const [n, color, alpha] of [[b.done, th.text, 0.6], [b.taken, colorOf(b), pulse], [b.blocked, th.warn, 1], [b.failed, th.bad, 1]] as Array<[number, string, number]>) {
					if (!n || !all) continue;
					const part = Math.max(2, (p.w * n) / all);
					g.globalAlpha = fade * alpha;
					g.fillStyle = color;
					rounded(g, at, y - 2, Math.min(part, x + p.w - at), 4, 2);
					g.fill();
					at += part;
				}
				break;
			}
			case "row":
				hits.push({ x, y, w: p.w, h: p.h, board: p.board.id, task: p.task });
				if (c.chosen?.board === p.board.id && c.chosen.task === p.task.id) {
					rounded(g, x, y, p.w, p.h, 4);
					g.fillStyle = veil(th.text, s.dark ? 0.08 : 0.07);
					g.fill();
				}
				break;
			case "tile": {
				// A task: an outline while nobody has it, filled once somebody has or had it.
				const t = p.task;
				const r = p.size > 4 ? 2 : 1;
				if (!pieces.some((q) => q.k === "row" && q.task === t)) hits.push({ x, y, w: p.size, h: p.size, board: p.board.id, task: t });
				if (t.state === "open" || t.state === "waiting") {
					g.strokeStyle = veil(th.text, t.state === "open" ? (s.dark ? 0.5 : 0.55) : s.dark ? 0.2 : 0.25);
					g.lineWidth = 1;
					rounded(g, x + 0.5, y + 0.5, p.size - 1, p.size - 1, r);
					g.stroke();
				} else {
					g.globalAlpha = fade * (t.state === "taken" ? pulse : t.state === "done" ? 0.6 : 1);
					g.fillStyle = t.state === "taken" ? colorOf(p.board, t.agent) : t.state === "blocked" ? th.warn : t.state === "failed" ? th.bad : th.text;
					rounded(g, x, y, p.size, p.size, r);
					g.fill();
					g.globalAlpha = fade;
				}
				if (c.chosen?.board === p.board.id && c.chosen.task === t.id) {
					// The task that is read under the view: a ring around its tile.
					g.strokeStyle = veil(th.text, 0.8);
					g.lineWidth = 1;
					rounded(g, x - 1.5, y - 1.5, p.size + 3, p.size + 3, r + 1.5);
					g.stroke();
				}
				break;
			}
			case "pill": {
				// A tool call: one that failed in the color of what failed, the one it is in now in the agent's own.
				const running = p.call.ms === undefined;
				const color = p.call.ok === false ? th.bad : running ? c.accent : th.faint;
				rounded(g, x + 0.5, y - 7.5, p.w, 15, 7.5);
				if (running) {
					g.fillStyle = veil(c.accent, 0.14);
					g.fill();
				}
				g.strokeStyle = veil(color, running || p.call.ok === false ? 0.8 : 0.35);
				g.lineWidth = 1;
				g.stroke();
				g.font = F.tiny;
				g.textAlign = "center";
				g.fillStyle = p.call.ok === false ? th.bad : running ? th.text : th.muted;
				g.fillText(p.text, x + p.w / 2 + 0.5, y + 0.5);
				break;
			}
			case "dot":
				g.globalAlpha = fade * (p.pulse ? breath : 1);
				g.beginPath();
				g.arc(x, y, p.r, 0, Math.PI * 2);
				if (p.hollow) {
					g.strokeStyle = p.color ? c.deep(p.color) : tone(p.tone);
					g.lineWidth = 1;
					g.stroke();
				} else {
					g.fillStyle = p.color ? c.deep(p.color) : tone(p.tone);
					g.fill();
				}
				break;
			case "elbow":
				g.fillStyle = veil(th.text, 0.3);
				g.fillRect(Math.round(x), y - 9, 1, 9);
				g.fillRect(Math.round(x), y, 6, 1);
				break;
		}
	}
	g.textAlign = "left";
	g.globalAlpha = fade;
}

// ---- the view: the board in the panel ---------------------------------------------------------------------------------------

const STYLE = `
.overview { position: absolute; inset: 0; overflow: hidden; font: 12.5px ${FONT}; -webkit-font-smoothing: antialiased; user-select: none; -webkit-user-select: none; }
.overview canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
.overview canvas.over { cursor: pointer; }
.overview canvas.drag { cursor: grabbing; }
.overview-bar { position: absolute; left: 0; right: 0; top: 0; height: ${BAR}px; box-sizing: border-box; padding: 0 6px 0 12px; display: flex; align-items: center; gap: 2px; }
.overview-sum { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--faint); }
.overview-sum b { color: var(--text); font-weight: 500; }
.overview-sum .ask { color: var(--warn); }
.overview-sum .bad { color: var(--bad); }
.overview-bar button { flex: none; width: 26px; height: 26px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--faint); cursor: pointer; }
.overview-bar button:hover { color: var(--text); background: var(--hover); }
.overview-bar button[aria-pressed="true"] { color: var(--text); background: var(--press); }
.overview-bar svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.overview-words { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
`;
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/></svg>';
const ALL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
/** How long a box stays in what the camera follows after the last thing happened at it: a short tool call does not make it sway. */
const LINGER_MS = 4000;
/** What the picture is, for a screen reader, in each of its two shapes. */
const LABEL = {
	wide: "All of pine on one page: triggers on the left, the agents and what each is doing in the middle, their boards and tools on the right",
	tall: "All of pine on one page: triggers on top, the agents and what each is doing under them, their boards and tools at the bottom",
};

export default defineView((host: ViewHost) => {
	const root = host.root;
	const style = document.createElement("style");
	style.textContent = STYLE;
	const box = document.createElement("div");
	box.className = "overview";
	const canvas = document.createElement("canvas");
	const bar = document.createElement("div");
	bar.className = "overview-bar";
	const sum = document.createElement("div");
	sum.className = "overview-sum";
	const button = (label: string, icon: string) => {
		const b = document.createElement("button");
		b.type = "button";
		b.title = label;
		b.setAttribute("aria-label", label);
		b.innerHTML = icon;
		return b;
	};
	const followButton = button("Follow activity: the camera moves to where something is happening. Drag, scroll or pinch to look around yourself", EYE);
	const allButton = button("Show everything", ALL);
	const words = document.createElement("ul");
	words.className = "overview-words";
	words.dataset.slot = "overview-words";
	bar.append(sum, followButton, allButton);
	box.append(canvas, bar, words);
	root.append(style, box);

	const recent = new Recent();
	let pointer: { x: number; y: number } | undefined;
	let layout: Layout | undefined;
	/** Where each task was drawn in the last frame: what the pointer and a click find. */
	let hits: Hit[] = [];
	let touched = 0;
	let handled = 0;
	let timer = 0;
	let raf = 0;
	let slow = false;
	/** Where each box is drawn right now: it glides to where it belongs, it does not jump there. */
	const glide = new Map<string, number>();
	let before = 0;
	/** The camera; whether it follows what happens, or shows everything (after "Show everything", and after the panel's size changed). */
	let cam: Cam | undefined;
	let follow = true;
	let whole = false;
	/**
	 * On a tall panel, how wide the board is laid out: as wide as the panel to begin with, and when everything is to be
	 * shown, as wide as shows all of it largest (`fittedWidth`). Laid out anew only when the panel's size changes, when
	 * everything is asked for, or, while everything is shown, when cards come or go: never under the owner's hand.
	 */
	let arranged: number | undefined;
	let arrangedFor = "";
	let seenView: { w: number; h: number } | undefined;
	/** Until when boxes glide slowly: the board was laid out anew, and they move across it rather than a little way. */
	let morphing = 0;
	/** When something last happened at a box: what the camera keeps in view. */
	const linger = new Map<string, number>();
	let drag: { x: number; y: number; moved: boolean } | undefined;
	let dragged = false;

	const size = () => ({ w: Math.max(1, root.clientWidth), h: Math.max(1, root.clientHeight) });
	const at = (e: MouseEvent) => {
		const r = canvas.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	};
	const boxAt = (p: { x: number; y: number }) => (layout && cam && p.y >= BAR ? hitAt(layout, toBoard(p, cam, size())) : undefined);
	/** Something was touched: the next frame comes now, not when the slow pace of a board at rest says. */
	const wake = () => {
		touched = Date.now();
		if (slow) {
			window.clearTimeout(timer);
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(tick);
		}
	};
	/** A hand is on the board: it is drawn at every frame for a moment, so that it moves with the hand. */
	const hand = () => {
		handled = Date.now();
		wake();
	};
	const setFollow = (on: boolean) => {
		follow = on;
		whole = false;
		followButton.setAttribute("aria-pressed", String(on));
		hand();
	};
	setFollow(true);
	/** The owner moves the camera: it stops following, and stays where some of the board is to be seen. */
	const move = (next: Cam) => {
		if (!layout) return;
		setFollow(false);
		cam = held(next, layout);
	};

	canvas.addEventListener("pointerdown", (e) => {
		drag = { x: e.clientX, y: e.clientY, moved: false };
		canvas.setPointerCapture(e.pointerId);
	});
	canvas.addEventListener("pointermove", (e) => {
		pointer = at(e);
		if (drag && cam && (drag.moved || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3)) {
			move({ ...cam, x: cam.x - (e.clientX - drag.x) / cam.z, y: cam.y - (e.clientY - drag.y) / cam.z });
			drag = { x: e.clientX, y: e.clientY, moved: true };
			canvas.classList.add("drag");
		}
		hand();
	});
	const drop = () => {
		dragged = Boolean(drag?.moved);
		drag = undefined;
		canvas.classList.remove("drag");
	};
	canvas.addEventListener("pointerup", drop);
	canvas.addEventListener("pointercancel", drop);
	canvas.addEventListener("pointerleave", () => {
		pointer = undefined;
		hand();
	});
	canvas.addEventListener("click", (e) => {
		if (dragged) return;
		const b = boxAt(at(e));
		hand();
		if (b?.agent) {
			// A click shows an agent under the view; a second click shows the log again.
			const sel = host.state().selected;
			host.select(sel && "agent" in sel && sel.agent === b.agent.id ? undefined : { agent: b.agent.id });
		} else if (b?.board) {
			// A click on a task shows what it says under the view, in the panel's own words; on the card, the whole board.
			const t = hitTask(hits, at(e))?.task;
			const sel = host.state().selected;
			const same = sel && "board" in sel && sel.board === b.board.id && sel.task === t?.id;
			host.select(same ? undefined : t ? { board: b.board.id, task: t.id } : { board: b.board.id });
		} else if (!b) host.select();
	});
	canvas.addEventListener("dblclick", (e) => {
		const b = boxAt(at(e));
		if (b?.agent) host.open({ agent: b.agent.id });
		else if (!b) setFollow(true);
	});
	canvas.addEventListener(
		"wheel",
		(e) => {
			e.preventDefault();
			if (!cam) return;
			if (e.ctrlKey || e.metaKey) {
				// A pinch, or the wheel with a key held: closer or further, around where the pointer is.
				const { w, h } = size();
				const p = at(e);
				const px = p.x - w / 2;
				const py = p.y - BAR - (h - BAR) / 2;
				const z = Math.max(Z_MIN, Math.min(Z_HAND, cam.z * Math.exp(-e.deltaY * 0.01)));
				move({ x: cam.x + px / cam.z - px / z, y: cam.y + py / cam.z - py / z, z });
			} else move({ ...cam, x: cam.x + e.deltaX / cam.z, y: cam.y + e.deltaY / cam.z });
		},
		{ passive: false },
	);
	followButton.addEventListener("click", () => setFollow(!follow));
	/** Everything, as large as it fits: laid out anew for the panel, the camera on its way to the whole board. */
	const showAll = () => {
		setFollow(false);
		whole = true;
		arranged = undefined;
		hand();
	};
	allButton.addEventListener("click", showAll);

	const say = (s: ViewState) => {
		words.replaceChildren(
			...s.agents.map((a) => {
				const mine = s.work.filter((w) => w.agent === a.id && !ended(w));
				const li = document.createElement("li");
				li.dataset.agent = a.id;
				li.textContent = `${a.id}, ${a.mode} mode${a.main ? ", the main agent" : ""}: ${mine.length ? mine.map((w) => `${w.copy ? "sub-agent " : ""}${sentenceOf(w, s).toLowerCase()}${causeOf(w) ? `, ${causeOf(w)}` : ""}`).join("; ") : "idle"}. ${[a.sources.length ? `Triggered by ${a.sources.join(", ")}` : "", a.schedules.length ? `schedules: ${a.schedules.join(", ")}` : "", a.mcp.length ? `MCP servers: ${a.mcp.join(", ")}` : "", a.skills.length ? `skills: ${a.skills.join(", ")}` : "", `${plural(a.conversations.length, "conversation")}, ${plural(a.conversations.filter((c) => c.branchOf !== undefined).length, "branch", "branches")}`].filter(Boolean).join("; ")}`;
				return li;
			}),
			// The boards, as the page shows them: whose each is and how its tasks stand.
			...boardsOf(s).filter((b) => unsettled(b) > 0 || b.name).map((b) => {
				const li = document.createElement("li");
				li.dataset.board = String(b.id);
				li.textContent = `${boardTitle(b)}: ${boardLine(b).toLowerCase()}${b.taken ? `, ${b.taken} in progress` : ""}.`;
				return li;
			}),
		);
	};
	const stopState = host.on("state", (s) => {
		say(s);
		wake();
	});
	const stopHearing = host.on("happening", (h) => {
		recent.hear(h, Date.now());
		wake();
	});
	say(host.state());

	const tick = () => {
		let wait = 1000;
		try {
			const s = host.state();
			const now = Date.now();
			const view = size();
			const dpr = Math.min(3, window.devicePixelRatio || 1);
			if (canvas.width !== Math.round(view.w * dpr) || canvas.height !== Math.round(view.h * dpr)) {
				canvas.width = Math.round(view.w * dpr);
				canvas.height = Math.round(view.h * dpr);
			}
			const th = s.dark ? DARK : LIGHT;
			for (const [k, v] of Object.entries({ "--text": th.text, "--faint": th.faint, "--warn": th.warn, "--bad": th.bad, "--hover": veil(th.text, 0.07), "--press": veil(th.text, 0.12) })) box.style.setProperty(k, v);
			// The frame is see-through only while it is dark where the app is dark: then the panel's own ground is the board's.
			root.ownerDocument.documentElement.style.colorScheme = s.dark ? "dark" : "light";
			// When the panel's size changes, everything is shown, laid out for its new size, and the camera glides there.
			// (Not the panel's first size: a frame can be measured before it is laid out.)
			if (seenView && seenView.w > 40 && seenView.h > 40 && (seenView.w !== view.w || seenView.h !== view.h)) showAll();
			seenView = view;
			// A panel taller than wide gets the three parts one under the other, their cards in rows. When it turns, the
			// cards glide from where they stood in the other shape to where they stand in this one, and the camera with them.
			const tall = view.h > view.w;
			if (tall !== layout?.tall) {
				canvas.setAttribute("aria-label", tall ? LABEL.tall : LABEL.wide);
				if (layout) morphing = now + 900;
			}
			const count = s.agents.length + s.inputs.length + s.schedules.length + boardsOf(s).length + new Set(s.agents.flatMap((a) => [...a.mcp.map((m) => `m:${m}`), ...a.skills.map((k) => `k:${k}`)])).size;
			if (tall && (arranged === undefined || (whole && arrangedFor !== `${count}`))) {
				const next = whole ? fittedWidth(s, now, view) : view.w - 2 * MARGIN;
				if (arranged !== undefined && next !== arranged) morphing = now + 900;
				arranged = next;
				arrangedFor = `${count}`;
			}
			layout = layoutOf(s, now, tall ? arranged : undefined);
			const live = linksOf(s, layout, now);
			const dt = before ? Math.min(100, now - before) : 0;
			before = now;

			// The camera. While it follows, it keeps in view every box that something happens at, and a while longer.
			for (const b of layout.boxes) if (b.busy || (b.bad && b.kind !== "source")) linger.set(b.id, now);
			for (const k of live) linger.set(k.from, now), linger.set(k.to, now);
			for (const [id, t] of linger) if (now - t > LINGER_MS || !layout.byId.has(id)) linger.delete(id);
			const target = follow ? focusOf(layout, linger.keys(), view) : whole ? allOf(layout, view) : undefined;
			let panning = false;
			if (!cam) cam = target ?? focusOf(layout, [], view);
			else if (target) {
				// Slower than a camera that is sent somewhere: it is to keep up, not to chase.
				cam = ease(cam, target, follow ? dt * 0.55 : dt);
				panning = cam.x !== target.x || cam.y !== target.y || cam.z !== target.z;
			}

			// When an agent starts or stops, boxes change places: each moves most of its way in a fifth of a second.
			let gliding = false;
			const seen = new Set<string>();
			const eased = (key: string, to: number) => {
				seen.add(key);
				const was = glide.get(key);
				const y = was === undefined || !dt || Math.abs(to - was) < 0.6 ? to : was + (to - was) * (1 - Math.exp(-dt / (now < morphing ? 200 : 90)));
				if (y !== to) gliding = true;
				glide.set(key, y);
				return y;
			};
			for (const b of layout.boxes) (b.y = eased(b.id, b.y)), (b.x = eased(`${b.id}:x`, b.x)), (b.w = eased(`${b.id}:w`, b.w));
			for (const head of layout.heads) (head.y = eased(`head:${head.col}:${head.text}`, head.y)), head.x !== undefined && (head.x = eased(`head:${head.col}:${head.text}:x`, head.x));
			for (const c of layout.cols) (c.y = eased(`col:${c.title}`, c.y)), (c.x = eased(`col:${c.title}:x`, c.x));
			for (const key of glide.keys()) if (!seen.has(key)) glide.delete(key);

			const over = pointer && !drag?.moved ? boxAt(pointer) : undefined;
			canvas.classList.toggle("over", Boolean(over?.agent || over?.board));
			const picked = s.selected;
			const sel = picked ? ("board" in picked ? `board:${picked.board}` : `agent:${"agent" in picked ? picked.agent : (s.work.find((x) => x.id === picked.work)?.agent ?? "")}`) : undefined;
			const g = canvas.getContext("2d")!;
			g.setTransform(dpr, 0, 0, dpr, 0, 0);
			hits = draw(g, s, layout, now, { hover: over?.id, selected: sel && layout.byId.has(sel) ? sel : undefined, task: picked && "board" in picked && picked.task !== undefined ? { board: picked.board, task: picked.task } : undefined, recent, cam, view });

			const running = s.work.filter((x) => !ended(x));
			const asks = running.filter((x) => x.asking).length + boardsOf(s).reduce((n, b) => n + b.blocked, 0);
			const next = s.schedules.find((x) => x.next !== undefined && x.next > now - 1000);
			const bad = s.inputs.filter((i) => i.failing).map((i) => i.name);
			const part = (cls: string, text: string) => Object.assign(document.createElement(cls === "b" ? "b" : "span"), { className: cls === "b" ? "" : cls, textContent: text });
			// The line on top: how things stand; and while the pointer is over a box, what that box is.
			const pointed = over?.board ? hitTask(hits, pointer) : undefined;
			const about = tipOf(over, s, now, pointed && pointed.board === over?.board?.id ? pointed.task : undefined);
			sum.replaceChildren(
				...(about.length
					? [part("b", about[0]), ...about.slice(1).map((text) => `  ·  ${text}`)]
					: [
							part("b", running.length ? `${new Set(running.map((x) => x.agent)).size} of ${s.agents.length} agents working` : `All ${s.agents.length} agents idle`),
							asks ? part("ask", `  ·  ${plural(asks, "question")} for you`) : "",
							bad.length ? part("bad", `  ·  ${bad.join(", ")} ${bad.length === 1 ? "is" : "are"} down`) : "",
							next ? `  ·  next: ${next.name} in ${span(next.next! - now)}` : "",
						].filter(Boolean)),
			);
			// Every frame while the camera or a box moves or a hand is on it, often while dots run, once a second at rest, seldom while the window is behind.
			const moving = running.length > 0 || [...recent.hot.values()].some((t) => now - t < 1500) || live.length > 0;
			wait = !s.focused ? 2000 : panning || gliding || drag || now - handled < 250 ? 0 : moving || now - touched < 1200 ? 40 : 1000;
		} catch (e) {
			window.clearTimeout(timer);
			throw e;
		}
		slow = wait > 50;
		timer = window.setTimeout(() => (raf = requestAnimationFrame(tick)), wait);
	};
	raf = requestAnimationFrame(tick);
	const watch = new ResizeObserver(() => wake());
	watch.observe(root);

	return () => {
		window.clearTimeout(timer);
		cancelAnimationFrame(raf);
		watch.disconnect();
		stopState();
		stopHearing();
	};
});
