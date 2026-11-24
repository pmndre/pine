// What the page knows: the tabs, what each conversation shows, and how the daemon's live events
// become that. Nothing here is the truth about pine; the daemon is. This is what was asked of it
// and what it reported since, kept so that it can be drawn.
//
// The models are plain objects that are changed in place and then say that they changed
// (`touch`). A conversation gets a hundred events a second while a model writes; copying its
// list for each would be the slowest thing the app does.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { toast } from "@/components/ui/toast";
import { type AgentInfo, api, type Approval, type Conversation, type GoalInfo, type SwarmInfo, type GroupList, media, type WorktreeMade, type BoardBrief, type PineEvent, type Program, type Stats, type Task, type Todo, type TranscriptEntry } from "./api.ts";
import { bridge, type Prefs, type ServiceState, type Update } from "./bridge.ts";
import { baseName, childKind, errText, eventBody, isGoalRound, learnHome, MODES, oneLine, plural, short, shortcut, type Speed, speedOf, speedText, taskSummary, tilde, took, undoLines } from "./text.ts";
import { runnable } from "./runnable.ts";
import { type QuoteSource, type SentQuote, withQuotes } from "../../src/quotes.ts";
import { computerWord, deviceWord, homeScreenKeeps, httpService, isPaired, machineName, machinesView, pairingEnded, readPairLink, type MachinesViewName, type NearbyComputer, type PairLink } from "./machines.ts";
import { applyLook, cleanLook, type ThemeEntry } from "./theme.ts";

/** The reasoning levels, each with what it means for the answer. */
export const REASONING_ABOUT: Record<string, string> = { off: "answers at once", minimal: "a moment of thought", low: "thinks briefly", medium: "thinks it through", high: "thinks long", xhigh: "thinks very long", max: "as long as the model can" };

export class Model {
	v = 0;
	private listeners = new Set<() => void>();
	subscribe = (fn: () => void) => {
		this.listeners.add(fn);
		return () => void this.listeners.delete(fn);
	};
	version = () => this.v;
	touch(): void {
		this.v++;
		for (const fn of this.listeners) fn();
	}
}

/** Draw again whenever the model says it changed. */
export function useModel<T extends Model>(model: T): T {
	useSyncExternalStore(model.subscribe, model.version);
	return model;
}

let ids = 1;
const uid = () => ids++;

export type Tone = "muted" | "warn" | "bad" | "good" | "accent";

export type Part =
	| { p: "tool"; key: string; tool: string; subject?: string; status: "run" | "ok" | "fail"; ms?: number; preview?: string; depth: number }
	| { p: "thought"; text: string; done: boolean; ms?: number; speed?: string; startedAt: number }
	| { p: "words"; text: string }
	| { p: "child"; task: number; agent: string; kind: string; label: string; status: "run" | "done" | "failed" | "cancelled"; how?: string; depth: number };

interface Base {
	id: number;
	/** Counts up when the item changes, so that only what changed is drawn again. */
	v: number;
}

export type Item = Base &
	(
		| { t: "user"; text: string; from?: string; files?: string[]; quotes?: SentQuote[]; /** The owner's message as a task, to branch from. */ task?: number; /** It was given to work that was running (`into`), as task `task`: when that work read it. */ steer?: Steer }
		| { t: "answer"; task: number; agent: string; text: string; live: boolean; /** It arrived while the owner was looking at its conversation: its first sound plays by itself, once. */ arrived?: { heard: boolean } }
		| { t: "work"; parts: Part[]; done: boolean; open: boolean; startedAt: number; ms?: number }
		| { t: "note"; tone: Tone; text: string; lines?: Array<{ text: string; tone?: Tone }>; action?: { label: string; run: () => void } }
		| { t: "event"; label: string; body: string }
		/** A message was not answered because the agent has no model that answers (`ModelNotice`). */
		| { t: "model"; agent: string }
		| { t: "approval"; req: Approval; state: "open" | "allowed" | "denied" | "gone"; by?: string; always?: boolean }
		| { t: "steps"; task: number; items: Todo[] }
		| { t: "media"; name: string; url: string; kind: "image" | "video" | "audio" }
		| { t: "goal"; goal: GoalInfo; full?: boolean }
		| { t: "swarm"; swarm: SwarmInfo; full?: boolean }
		| { t: "divider"; text: string }
		| { t: "entry"; entry: TranscriptEntry }
	);

type Of<K extends Item["t"]> = Extract<Item, { t: K }>;

/** A message given to running work: its own task, the work's task, and when the work read it (ms). */
export interface Steer {
	task: number;
	into: number;
	read?: number;
}

export interface Attachment {
	name: string;
	size: number;
	/** base64 */
	data: string;
	/** For a picture: an address of the page's own to show it by. */
	preview?: string;
}

export type { QuoteSource, SentQuote };

/**
 * Whether an event's message is one this tab sent: events carry a message's first 2000 characters
 * (`truncate` in the daemon), so a long one, which quotes make common, is compared by its beginning.
 */
const ownMessage = (prompt: unknown, sent: string) => String(prompt ?? "").startsWith(sent.slice(0, 2000));

export interface Quote extends SentQuote {
	id: number;
	tab: string;
}

const said = (it: { text: string; quotes?: SentQuote[] }) => (it.quotes ? withQuotes(it.quotes, it.text) : it.text);

let quoteIds = 0;

/** A number for a quote in a composer, which its badge is keyed by. */
export const quoteId = () => ++quoteIds;

const ownerText = (p: { prompt?: unknown; quotes?: unknown; body?: unknown }): { text: string; quotes?: SentQuote[] } => (Array.isArray(p.quotes) && p.quotes.length ? { text: String(p.body ?? ""), quotes: p.quotes as SentQuote[] } : { text: String(p.prompt ?? "") });

export type CodeView = "agent" | "files" | "changes" | "turn" | "output" | "running" | "board" | "terminal";

/** What can be shown beside a conversation: the side panel, the browser's aside, and the view of all of pine
 *  (which needs no conversation). */
export type Beside = "code" | "aside" | "view";

/** Tailwind's `lg`: below it a conversation and the side panel beside it do not both fit, with the side bar as a column too.
 *  There the side panel (CodePanel.tsx) and the browser's aside (Browser.tsx) are sheets over the conversation, one at a time. */
export const ROOM = "(min-width: 64rem)";

/** The room beside the side bar, in pixels, below which the side panel and the aside are not both drawn as columns: the
 *  conversation, the panel and the aside at their least (320 each) with the edges between them, and a little more so
 *  that none of the three is squeezed to its minimum. There only the one opened last is drawn; the other comes back
 *  by itself when there is room again. */
export const BOTH = 1100;
/** The same for all three: the conversation and three panels side by side. */
export const THREE = 1500;

const MEDIA_KIND = (name: string): "image" | "video" | "audio" | undefined => (/\.(png|jpe?g|gif|webp)$/i.test(name) ? "image" : /\.(mp4|mov|webm|m4v)$/i.test(name) ? "video" : /\.(wav|mp3|m4a|ogg|flac|aiff?)$/i.test(name) ? "audio" : undefined);
export const mediaKind = MEDIA_KIND;

/** One tab: a conversation, the work of one task, or the event log. */
export class Tab extends Model {
	id = uid();
	kind: "chat" | "task" | "events" | "settings";
	agent: string;
	session: string;
	/** For a tab on one task. */
	task?: number;
	/** For a tab on one task: the task that started it, if one did. */
	parent?: number;
	baseDepth = 0;
	items: Item[] = [];
	loaded = false;

	roots = new Set<number>();
	running = new Set<number>();
	awaiting: string[] = [];
	answers = new Map<number, Of<"answer">>();
	streamed = new Set<number>();
	said?: { task: number; item: Of<"answer"> };
	work?: Of<"work">;
	tools = new Map<string, Extract<Part, { p: "tool" }>>();
	thoughts = new Map<number, Extract<Part, { p: "thought" }>>();
	lastThought?: { task: number; part: Extract<Part, { p: "thought" }> };
	children = new Map<number, { agent: string; kind: string; label: string; running: boolean }>();
	approvals = new Map<string, Of<"approval">>();
	steps?: Of<"steps">;

	unread = false;
	startedAt = 0;
	toolCalls = 0;
	tokens = { input: 0, output: 0, cached: 0 };
	thinking = false;
	context?: number;
	cacheShare?: number;
	speed?: Speed;
	lastAnswer?: string;
	goal?: GoalInfo;
	/** The swarm started in this conversation with /swarm, as the daemon last reported it. */
	swarm?: SwarmInfo;
	folder?: string;
	workspace?: string;
	/** The worktree it works in, if it has one: its branch and what it was made from. */
	worktree?: { branch: string; base: string };
	programs: Program[] = [];
	/** Whether `programs` has been read once, so an empty list is told apart from one not read yet. */
	programsRead = false;
	/** The boards this conversation can use, its own first, and a count that rises when one of them changed. */
	boards: BoardBrief[] = [];
	boardTick = 0;
	boardAsked = 0;
	stopped?: { at: number; waiting: number; spared: Set<number> };
	pauseNoted = false;

	// the composer
	draft = "";
	attachments: Attachment[] = [];
	quotes: Quote[] = [];
	inputs: string[] = [];
	files = new Set<string>();

	// the event log
	log: PineEvent[] = [];
	logFilter = "";
	/** Whether the log's first fetch is still out (Events draws skeleton lines), and why it failed when it did. */
	logLoading = false;
	logError?: string;

	// the panel beside it
	codeTick = 0;
	/** Code blocks the owner ran from an answer, waiting for the terminal to type them (Terminal.tsx). */
	runs: string[] = [];

	constructor(kind: Tab["kind"], agent: string, session: string) {
		super();
		this.kind = kind;
		this.agent = agent;
		this.session = session;
	}

	get key(): string {
		return this.kind === "chat" ? `${this.agent}:${this.session}` : this.kind === "task" ? `task:${this.task}` : this.kind;
	}

	get busy(): boolean {
		return this.running.size > 0;
	}

	add<T extends Item["t"]>(item: Omit<Of<T>, "id" | "v"> & { t: T }): Of<T> {
		const made = { ...item, id: uid(), v: 0 } as unknown as Of<T>;
		this.items.push(made);
		return made;
	}

	note(text: string, tone: Tone = "muted", more: Partial<Of<"note">> = {}): Of<"note"> {
		return this.add({ t: "note", tone, text, ...more });
	}

	remove(item: Item): void {
		const at = this.items.indexOf(item);
		if (at >= 0) this.items.splice(at, 1);
	}

	clear(): void {
		this.items = [];
		for (const live of [this.roots, this.running, this.answers, this.streamed, this.tools, this.thoughts, this.children, this.approvals]) live.clear();
		this.awaiting = [];
		this.work = this.said = this.lastThought = this.steps = undefined;
		this.thinking = false;
	}
}

const STOP_GRACE = 3000;
/** What the gate says of a pine that answered with no agent at all, until one is made there. */
const NO_AGENTS = "This pine has no agents.";
/** Kept once the home-screen suggestion was made, so that it is never made again. */
const HOME_SCREEN_KEY = "pine.homeScreen";
const sessionName = () => `s${Date.now().toString(36)}`;
/** What a conversation is told when it moves into a worktree. */
const worktreeNote = (made: WorktreeMade) =>
	`This conversation now works in the worktree ${made.branch} at ${tilde(made.path)}${made.base ? `, made from ${made.base}` : ""}: a separate checkout, so other conversations' files are not touched. What is not committed in the folder stayed there.${made.copied.length ? ` Copied from .worktreeinclude: ${made.copied.join(", ")}.` : ""} Merge it back from the folder's chip.`;

/** Where the app's update of a newer release stands (`Store.updatePhase`), with what a view of it says. */
export type UpdatePhase = { phase: "waiting" | "ready" | "downloading" | "link"; version: string; mine: string; url: string; reason?: string };

/** `loading`: the dialog is open while what it lists is still asked for, and draws skeleton lines. */
export type Picker = { title: string; loading?: boolean; items: Array<{ value: string; label: string; about?: string; tone?: Tone }>; current?: string; done: (value: string | undefined) => void; placeholder?: string; free?: boolean };

/** The app as a whole. */
export class Store extends Model {
	service: ServiceState = { status: "starting" };
	/** Why the agents of the pine that answered could not be loaded, until they are asked again: the gate says it and offers to try again. */
	loadError?: string;
	connected = false;
	prefs: Prefs = { keepRunning: false, hosts: [], notify: true, updates: true };
	/** The themes in the themes folder of pine's home, and the one in force (`ui.theme`, pmndre when none is chosen). */
	themes: ThemeEntry[] = [];
	/** Whether `refreshThemes` has answered once, read or not: Settings draws skeletons until then. */
	themesRead = false;
	theme = "pmndre";
	platform = "darwin";
	/** Whether there is a "this computer" whose pine the app can use: not under a bridge that only reaches other machines (`AppState.local`). */
	local = true;
	/** Whether machines can be added as user@host: not where the bridge reaches only computers paired by their code (`AppState.canAddHost`). */
	canAddHost = true;
	/** Whether a computer can be paired with by its link: only where the bridge says so, the web client on a deployment with the meeting service (`AppState.canPair`). */
	canPair = false;
	/** Whether the page offers "Open Pine on this computer" (`AppState.canOpenApp`): the web client in a browser on a computer. */
	canOpenApp = false;
	/** The host of the service machines are reached through, named beside them (`AppState.serviceHost`): the web client's deployment only. */
	serviceHost?: string;
	/** The view of the machines the owner chose with the link to SSH or the back control (`machinesView`): for this visit only, never kept. */
	machinesChosen?: MachinesViewName;
	/** The last pairing with a computer ended without one: the first screen says so above the bridge's reason. */
	pairFailed = false;
	/** The suggestion to add the web client to the home screen, shown once after a first pairing where that keeps the browser's key. */
	homeScreen = false;
	/**
	 * A pairing link pasted by the owner or handed in by the app (`onPairLink`), waiting for the owner's
	 * yes in the page: nothing of it reaches the computer before that yes (`confirmPair`).
	 */
	pairAsk?: PairLink & { link: string };
	/**
	 * The pairing the Add a device dialog shows (Browser access, `DevicePairing.tsx`): opened from
	 * Settings, the menu or the Dock, or by the main process for `pine://pair`. None: the dialog is closed.
	 */
	devicePairing?: { link: string; expires: string; asked?: boolean };
	/** Whether the bridge pairs from a link in the owner's hand (`pair`: the mobile app's), not from its address by itself (the web client's). */
	pairsFromHand = false;
	/** The owner ended the open pairing: how it ends is then no failure to say. */
	private pairCancelled = false;
	focused = true;
	versions = { app: "", electron: "" };
	/** Whether this app asks for a newer one at all: an app from a checkout is no release and does not. */
	updates = false;
	/** What GitHub said about a newer app, once it said something. */
	update?: Update;
	/** The dialog that says there is a newer app, after the owner asked. */
	updateAsk = false;
	updateLooking = false;
	/** Whether this app updates itself (`AppState.selfUpdate`): it then offers "Restart to update" once an update is ready. */
	selfUpdate = false;
	/** "Restart when they are done" was chosen: the update is installed once no conversation is at work. */
	updateWhenDone = false;
	/** The pine home the app was told to use, when it is not the usual one. */
	home?: string;

	agents: AgentInfo[] = [];
	tabs: Tab[] = [];
	active?: Tab;
	conversations = new Map<string, Conversation[]>();
	/** Each agent's groups of conversations and how its list is sorted, as the daemon keeps them. */
	groups = new Map<string, GroupList>();
	/** The group a new conversation was started in, until the daemon lists it (after its first message). */
	placed = new Map<string, string>();
	taints = new Map<string, string>();
	sessionModes = new Map<string, string>();
	bypassWhenTainted = false;
	pins = new Set<string>();

	/** The page the settings tab shows, and the agent whose page is open there. */
	section = "general";
	settingsAgent?: string;
	/** What the search of Settings (or the palette) picked on that page: the element to show, and the words for the page's own search. Taken once the page shows it. */
	settingsFind?: { find?: string; filter?: string };
	/** Whether the dialog that makes a new agent is open: over whatever is in front, from the side bar's + and from Settings > Agents. */
	newAgent = false;
	/** Conversations in which an agent is at work right now, whether a tab shows them or not: "agent:session". */
	busy = new Map<string, Set<number>>();
	/** What was said lately, in every conversation: for finding one by its words, and for naming one that has no name of its own. */
	said: Task[] = [];
	titles = new Map<string, string>();
	/** Whether what was said has been loaded once, so that the titles drawn from it are known. */
	titled = false;
	private saidAt = 0;
	private saidLater?: number;
	/** A conversation that is to open with something looked for in it. */
	pendingFind?: { key: string; query: string };
	/** Agents whose list of conversations is folded away in the side bar. */
	folded = new Set<string>(JSON.parse(localStorage.getItem("pine.folded") ?? "[]"));
	/** Whether the side bar shows as a column in a wide window. Kept like its width, so that it is after a restart as it was left. */
	sidebar = localStorage.getItem("pine.sidebar") !== "hidden";
	/** Whether the side panel is open. Kept by the daemon with the tabs, for the next start. */
	code = false;
	codeView: CodeView = "files";
	/** Whether the browser's aside is open: a matter of this window alone, kept like the side bar. */
	aside = localStorage.getItem("pine.aside") === "shown";
	/** Whether the view's panel is open: kept like the aside. */
	view_ = localStorage.getItem("pine.view") === "shown";
	/** Whether this page can run a view at all (`AppState.views`): the desktop app's can, the others' cannot. */
	viewsHere = false;
	/** The view pine has in force (`ui.view`), the ones in its folder, and the one pine.json names; no view in force: no panel, no button. */
	view: string | null = null;
	views: Array<{ id: string; problem?: string }> = [];
	viewChosen: string | null = null;
	/** Who else reads the daemon's live events, batch by batch (the view's world). */
	readonly taps = new Set<(batch: PineEvent[]) => void>();
	/** The panels beside a conversation, the one opened last at the end: where there is room for fewer than are open,
	 *  the ones opened last are drawn. */
	order: Beside[] = ["view", "aside", "code"];
	/** In a window with sheets, the sheet in front was put away while the other was open: that one stays open behind,
	 *  and comes forward by its own toggle, or as a column once the window is wide. */
	tucked = false;
	/** Whether the side panel and the aside lie over the conversation as sheets, one at a time: a window narrower than `ROOM`. */
	get sheets(): boolean {
		return !window.matchMedia(ROOM).matches;
	}
	/** The width of the room beside the side bar, as the window last measured it (`App.tsx`). */
	room = Infinity;
	/** How many of the panels beside a conversation are drawn at a time: one as sheets or with less room than `BOTH`,
	 *  two with less than `THREE`. */
	get fits(): number {
		return this.sheets || this.room < BOTH ? 1 : this.room < THREE ? 2 : 3;
	}
	/** Called as the room beside the side bar changes size; the page is drawn again only when that changes what shows. */
	measure(room: number): void {
		const was = this.fits;
		this.room = room;
		// Once the window has room for columns, the one left behind has shown as one: a sheet is no longer held back.
		if (!this.sheets) this.tucked = false;
		if (this.fits !== was) this.touch();
	}
	palette = false;
	picker?: Picker;
	/** The form that publishes an event as the owner, while it is open. */
	publishing = false;
	/** The approval or question whose dialog is open. */
	asking?: string;
	/** The tabs of last time are open (there may be none): until then the window shows that pine is starting. */
	opened = false;
	/** What was typed into a conversation's input and not sent when its tab closed, given back when it opens again. */
	private drafts = new Map<string, { draft: string; attachments: Attachment[]; quotes: Quote[] }>();
	asked = new Set<string>();
	initLines: string[] = [];
	initRunning = false;
	/** Whether the browser build this pine drives is on this computer; nothing while it is not known. */
	browser?: boolean;
	/** Whether `checkBrowser` has answered once, read or not (at once for another machine's pine, which has nothing to check here). */
	browserChecked = false;
	/** The question at the start, when it is not: fetch it now, or later. */
	browserAsk = false;
	browserFetching = false;
	/** Something a menu asked for that only a part of the page can do (save the file in the editor, focus the input). */
	signal = new Model();
	/** The name of what was asked for last. Read with `useSignal`, which several parts can do for the same asking. */
	lastSignal = "";
	/** The language dictation listens for, when it is not the system's. */
	voiceLanguage?: string;

	private restoring = false;
	private started = false;
	private timers: number[] = [];

	// ---- start -----------------------------------------------------------------------------------

	async boot(): Promise<void> {
		if (this.started) return;
		this.started = true;
		bridge.onService((s: ServiceState) => void this.onService(s));
		bridge.onEvents((batch: PineEvent[]) => this.onEvents(batch));
		bridge.onConnection((up: boolean) => {
			const back = up && !this.connected;
			this.connected = up;
			if (back && this.agents.length) void this.dropAnswered();
			this.touch();
		});
		bridge.onMenu((command: string) => void this.command(command));
		// The app's own download of a newer release moves on (only the desktop app's bridge says so).
		bridge.onUpdate?.((said: Update | undefined) => {
			this.noteUpdate(said);
			this.touch();
		});
		// How a block run with a Run button went: the conversation it came from is told, and goes on.
		bridge.onTermRun((id: string, report: { command: string; state: "running" | "ended"; code?: number; seconds: number; output: string }) => {
			const at = id.indexOf(":");
			if (at > 0) void this.attempt(() => api.terminalRun(id.slice(0, at), id.slice(at + 1), report));
		});
		bridge.onFocus((f: boolean) => {
			this.focused = f;
			if (f && this.active) this.seen(this.active);
			if (f) void this.refreshAgents();
			// Said at once: the view draws seldom while the window is behind, and often again when it comes to the front.
			this.touch();
		});
		bridge.onInitLine((line: string) => {
			this.initLines.push(line);
			if (this.initLines.length > 200) this.initLines.shift();
			this.touch();
		});
		const first = await bridge.state();
		// Whether the event stream is up: a page loaded anew is not told it by an event.
		this.connected = first.connected === true;
		this.prefs = first.prefs;
		// The theme the window had last, until pine says which one is in force.
		applyLook(cleanLook(first.prefs.look));
		this.platform = first.platform;
		this.local = first.local !== false;
		this.canAddHost = first.canAddHost !== false;
		this.canPair = first.canPair === true;
		this.canOpenApp = first.canOpenApp === true;
		this.pairsFromHand = typeof bridge.pair === "function" && typeof bridge.stopPairing === "function";
		// A pairing link the app was opened with (the mobile app's): asked about here, never paired with by itself.
		if (this.canPair)
			bridge.onPairLink?.((link: string) => {
				const why = this.askToPair(link);
				if (why) this.flash(why, "bad", 8000);
			});
		this.serviceHost = typeof first.serviceHost === "string" && first.serviceHost ? first.serviceHost : undefined;
		this.viewsHere = first.views === true;
		this.focused = first.focused;
		this.versions = first.versions;
		this.updates = first.updates;
		this.selfUpdate = first.selfUpdate === true;
		void this.lookForUpdate();
		this.home = first.home;
		document.documentElement.dataset.platform = this.platform;
		bridge.ready();
		await this.onService(first.state);
	}

	/**
	 * An address of the conversation's own (the port of a program it left running): opened in the
	 * browser beside the conversation, which the daemon starts for it where it is not up. Where the
	 * conversation has no browser at all, the address goes to the owner's own browser.
	 */
	async showInBrowser(tab: Tab, url: string): Promise<void> {
		const before = { aside: this.aside, order: [...this.order], tucked: this.tucked };
		this.open("aside");
		this.touch();
		const state = await api.browserOpen(tab.agent, tab.session, url).catch(() => undefined);
		if (state?.open) {
			if (state.error) this.flash(state.error, "warn", 6000);
			tab.codeTick++;
			this.saveTabs();
			return this.touch();
		}
		// Put back as it was: closed if it was, and the side panel in front again if it was.
		if (!before.aside) this.close("aside");
		this.order = before.order;
		this.tucked = before.tucked;
		this.flash("This conversation has no browser, so the address was opened in your own.", "muted", 6000);
		this.touch();
		void bridge.open(url);
	}

	/**
	 * Remove an agent, after asking how: with everything it has, or with its folder kept. The
	 * settings page and the side bar's menu both come here. Says whether it is gone.
	 */
	async removeAgent(id: string): Promise<boolean> {
		const d = await this.attempt(() => api.agentDetail(id));
		if (!d) return false;
		if (d.main) return this.flash("The main agent administers pine and cannot be removed."), false;
		const how = await this.pick({
			title: `Remove the agent ${id}?`,
			items: [
				{ value: "erase", label: "Remove it with everything it has", about: `the agent's ${plural(d.holdings.conversations.length, "conversation")}, sources, schedules, servers, skills and folder. This cannot be undone`, tone: "bad" },
				{ value: "keep", label: "Remove it, but keep the agent's folder", about: "the folder is moved to removed/ in pine's home" },
				{ value: "no", label: "Cancel" },
			],
		});
		if (how !== "erase" && how !== "keep") return false;
		const gone = await this.attempt(() => api.eraseAgent(id, how === "keep"));
		if (!gone) return false;
		if (gone.problem) this.flash(`${id} is taken out, but what is left of the configuration does not load: ${gone.problem}`, "bad", 12_000);
		else this.flash(`Removed the agent ${id}.${gone.kept ? ` The agent's folder is kept at ${tilde(gone.kept)}.` : ""}`, "good");
		this.agents = await this.askAgents().catch(() => this.agents);
		this.tabs = this.tabs.filter((t) => t.agent !== id || t.kind === "events");
		if (this.active?.agent === id) this.active = this.tabs[0];
		if (!this.tabs.length && this.agents[0]) await this.openTab((this.agents.find((a) => a.main) ?? this.agents[0]).id, "main", false);
		this.conversations.delete(id);
		this.touch();
		return true;
	}

	/**
	 * Give an agent another id (its name on its settings page, or Rename in the side bar's menu).
	 * The daemon moves everything that carries its name; here its tabs, its folded group and what
	 * is known about its conversations follow it. Says whether it is renamed.
	 */
	async renameAgent(from: string, wanted: string): Promise<boolean> {
		const to = wanted.trim();
		if (!to || to === from) return false;
		const done = await this.attempt(() => api.renameAgent(from, to));
		if (!done) return false;
		const moved = (key: string) => (key === from ? to : key.startsWith(`${from}:`) ? `${to}${key.slice(from.length)}` : key);
		for (const t of this.tabs) if (t.kind === "chat" && t.agent === from) ((t.agent = to), t.touch());
		for (const map of [this.conversations, this.groups, this.placed, this.taints, this.sessionModes, this.busy, this.titles] as Array<Map<string, unknown>>) {
			for (const [key, value] of [...map]) {
				if (moved(key) === key) continue;
				map.delete(key);
				map.set(moved(key), value);
			}
		}
		for (const set of [this.pins, this.folded]) for (const key of [...set]) if (moved(key) !== key) set.delete(key), set.add(moved(key));
		localStorage.setItem("pine.folded", JSON.stringify([...this.folded]));
		if (this.settingsAgent === from) this.settingsAgent = to;
		this.saveTabs();
		this.agents = await this.askAgents().catch(() => this.agents);
		void this.refreshConversations(to);
		if (done.problem) this.flash(`${from} is called ${to} now, but the configuration does not load: ${done.problem}`, "bad", 12_000);
		else this.flash(`${from} is called ${to} now.${done.addresses.length ? ` The webhook address${done.addresses.length === 1 ? " is" : "es are"} now ${done.addresses.join(", ")}: give ${done.addresses.length === 1 ? "it" : "them"} to whoever calls.` : ""}`, done.addresses.length ? "warn" : "good", done.addresses.length ? 12_000 : 3500);
		this.touch();
		return true;
	}

	/** An agent's color, set at once: a preset, any other `#rrggbb`, or "none". */
	async colorAgent(id: string, color: string): Promise<void> {
		if (!(await this.attempt(() => api.updateAgent(id, { color })))) return;
		this.agents = await this.askAgents().catch(() => this.agents);
		this.touch();
	}

	/** The update the app downloaded, installed: the app quits and comes back on the new version, with the pine it started. */
	async installUpdate(): Promise<void> {
		this.updateAsk = false;
		this.updateWhenDone = false;
		this.touch();
		await this.attempt(() => bridge.installUpdate!());
	}

	/** How many conversations are at work, as the side bar shows them: sub-agents and delegated tasks are part of the work of their conversation. */
	get working(): number {
		let n = 0;
		for (const tasks of this.busy.values()) if (tasks.size) n++;
		return n;
	}

	/**
	 * "Restart to update": at once when nothing is at work. Otherwise the owner is told how much
	 * would be cut off, and chooses to restart now, once the work is done, or not at all.
	 */
	async restartToUpdate(): Promise<void> {
		const n = this.working;
		if (!n) return this.installUpdate();
		this.updateAsk = false;
		const how = await this.pick({
			title: `Agents are at work in ${plural(n, "conversation")}`,
			items: [
				{ value: "done", label: "Restart when they are done", about: "the update is installed once nothing is at work" },
				{ value: "now", label: "Restart now", about: "what they are doing is cut off", tone: "bad" },
				{ value: "no", label: "Cancel" },
			],
		});
		if (how === "now") return this.installUpdate();
		if (how !== "done") return;
		this.updateWhenDone = true;
		this.touch();
		this.installWhenDone();
	}

	/** The wait for the end of the work called off: the update stays ready for a restart or a quit. */
	cancelUpdateWait(): void {
		this.updateWhenDone = false;
		this.touch();
	}

	/** Installs the update the owner said to install once the work is done, when nothing is at work any more and it is still ready. */
	private installWhenDone(): void {
		if (this.updatePhase?.phase === "waiting" && !this.working) void this.installUpdate();
	}

	/**
	 * What the app was told of a newer release. An update that is no longer ready (a new release
	 * being downloaded, a failure) ends a wait for the end of the work: there is nothing to install.
	 */
	private noteUpdate(said: Update | undefined): void {
		if (said && said.status !== "unknown") this.update = said;
		if (this.update?.status !== "newer" || this.update.updater?.state !== "ready") this.updateWhenDone = false;
	}

	/**
	 * Where the app's update of a newer release stands, the one place every view of it reads:
	 * `waiting` ready and installed once no conversation is at work, `ready` for a restart or a quit,
	 * `downloading`, or `link` to the release's page (the app does not update itself, or the download
	 * failed: `reason`). None: no newer release.
	 */
	get updatePhase(): UpdatePhase | undefined {
		const u = this.update;
		if (u?.status !== "newer") return undefined;
		const shown = { version: u.version, mine: u.mine, url: u.url };
		const state = u.updater?.state;
		if (state === "ready") return { phase: this.updateWhenDone ? "waiting" : "ready", ...shown };
		if (state === "downloading") return { phase: "downloading", ...shown };
		return { phase: "link", ...shown, reason: u.updater?.state === "failed" ? u.updater.reason : undefined };
	}

	/**
	 * Whether there is a newer app. At the start it is only noted (the side bar and Settings > General
	 * show it); when the owner asked (the menu, the settings), the answer is said too.
	 */
	async lookForUpdate(asked = false): Promise<void> {
		if (!this.updates) return asked ? this.flash("This Pine runs from a checkout and is no release: update the checkout.") : undefined;
		if (this.updateLooking) return;
		this.updateLooking = asked;
		this.touch();
		const said: Update | undefined = await bridge.update(asked).catch(() => undefined);
		this.updateLooking = false;
		this.noteUpdate(said);
		this.touch();
		if (!asked) return;
		if (said?.status === "newer") this.updateAsk = true;
		else if (said?.status === "latest") this.flash(`Pine ${said.mine} is the latest version.`, "good");
		else this.flash("Could not ask GitHub for the latest version. You may be offline.", "warn", 6000);
		this.touch();
	}

	private async onService(s: ServiceState): Promise<void> {
		const was = this.service.status;
		// Another pine than before (another machine was picked): nothing of the last one is kept, not even what an agent of the same name was doing.
		const moved = s.host !== this.service.host || s.status !== was;
		if (s.host !== this.service.host) this.forgetPine();
		let ended = pairingEnded(this.service, s);
		// Ended by the owner's Cancel: neither a failure to say nor a pairing to welcome.
		if (ended && this.pairCancelled) {
			ended = undefined;
			this.pairCancelled = false;
			this.pairFailed = false;
		}
		if (ended) this.pairFailed = ended === "failed";
		else if (s.host || (s.status === "starting" && s.pairing)) this.pairFailed = false;
		this.service = s;
		if (ended === "paired") void this.paired();
		const again = s.status === "ready" && (was !== "ready" || !this.agents.length);
		// A reason the agents did not load is wiped only by a new attempt or another pine: never left in place of one, never wiped without one.
		if (again || moved) this.loadError = undefined;
		this.touch();
		if (again) await this.load();
	}

	/**
	 * A pairing link was paired with: the bridge kept the computer among the machines, under its name,
	 * which the page is told by reading the preferences again. The first time, where a web app on
	 * the home screen keeps this browser's key, the page suggests putting it there, once and for good.
	 */
	private async paired(): Promise<void> {
		const now = await bridge.state().catch(() => undefined);
		if (now) this.prefs = now.prefs;
		try {
			// Only the web client is a web app to put on the home screen: the mobile app is an app already.
			if (this.platform === "web" && homeScreenKeeps(navigator.userAgent, navigator.maxTouchPoints) && !localStorage.getItem(HOME_SCREEN_KEY)) {
				localStorage.setItem(HOME_SCREEN_KEY, "offered");
				this.homeScreen = true;
			}
		} catch {
			// No storage to remember it by: not offered, rather than offered at every pairing.
		}
		this.touch();
	}

	/** Whether the page can look for computers on this network and pair with one without a code (the mobile app's bridge). */
	get canFindNearby(): boolean {
		return this.canPair && typeof bridge.nearby === "function" && typeof bridge.pairNearby === "function";
	}

	/** A computer found on the network, tapped by the owner: the codeless request starts, and the first screen follows how it goes. */
	async pairNearby(computer: NearbyComputer): Promise<void> {
		if (!this.canFindNearby) return;
		await this.attempt(() => bridge.pairNearby!(computer.id, computer.service, computer.nonce));
	}

	/** Whether the owner can paste a pairing link: only under a bridge that can pair and takes one from the owner's hand (the mobile app's). */
	get canPasteLink(): boolean {
		return this.canPair && this.pairsFromHand;
	}

	/** What the page calls the device it runs on when it pairs ("phone", "browser"). */
	get device(): "phone" | "browser" {
		return deviceWord(this.platform);
	}

	/**
	 * A pairing link from the owner's paste or from the app: read, and put to the owner for a yes.
	 * Says why when it is not a pairing link (none: it waits for the yes); nothing starts here.
	 */
	askToPair(text: string): string | undefined {
		if (!this.canPasteLink) return undefined;
		const link = readPairLink(text);
		const http = link ? undefined : httpService(text);
		if (http) return `This pairing link reaches your computer through ${http} over http, and this ${this.device} pairs only through https: nothing was used. Pair with a link of an https meeting service, or connect over SSH instead.`;
		if (!link) return "That is not a pairing link. On your computer, choose Pine > Add a device, and copy the link it gives.";
		this.pairAsk = { ...link, link: text.trim() };
		this.touch();
		return undefined;
	}

	/** The owner's yes to the pairing link the page showed: the bridge pairs, and the first screen follows how it goes. */
	async confirmPair(): Promise<void> {
		const asked = this.pairAsk;
		this.pairAsk = undefined;
		this.touch();
		if (asked) await this.attempt(() => bridge.pair!(asked.link));
	}

	/** The owner's no to the pairing link the page showed: nothing of it was used. */
	dropPair(): void {
		this.pairAsk = undefined;
		this.touch();
	}

	/** Whether the open pairing can be ended from the page: under a bridge that pairs from the owner's hand. */
	get canCancelPair(): boolean {
		return (this.pairsFromHand || this.canFindNearby) && this.service.status === "starting" && !!this.service.pairing;
	}

	/** End the open pairing, nothing kept: the bridge goes back to how it was before. */
	async cancelPair(): Promise<void> {
		if (!this.canCancelPair) return;
		this.pairCancelled = true;
		await this.attempt(() => bridge.stopPairing!());
	}

	/**
	 * Take a machine off the list. A paired computer is asked about first: forgetting it here leaves
	 * its access open, which only Remove in the Pine app on that computer closes.
	 */
	async forgetMachine(host: string): Promise<void> {
		if (isPaired(host)) {
			const name = this.nameOf(host);
			const sure = await this.pick({
				title: `Forget ${name}?`,
				items: [
					{ value: "forget", label: `Forget it on this ${this.device}`, about: `this ${this.device} no longer lists it. Access stays open until you remove this ${this.device} in the Pine app on ${name}: Settings > Browser access, Remove`, tone: "bad" },
					{ value: "no", label: "Cancel" },
				],
			});
			if (sure !== "forget") return;
		}
		const prefs = await this.attempt(() => bridge.forgetHost(host));
		if (prefs) (this.prefs = prefs), this.touch();
	}

	/** The name the owner sees for a machine of the list (machines.ts): a paired computer's name, never its id. */
	nameOf(host: string): string {
		return machineName(host, this.prefs.names);
	}

	/** Whether machines can be renamed: under a bridge that keeps their names (the web client's). */
	get canRename(): boolean {
		return typeof bridge.renameHost === "function";
	}

	/** Give a machine of the list another name, typed by the owner; the bridge cleans and cuts it. */
	async renameMachine(host: string): Promise<void> {
		if (!this.canRename) return;
		const typed = await this.pick({ title: `Rename ${this.nameOf(host)}`, items: [], free: true, placeholder: "The name this browser shows for it" });
		if (!typed?.trim()) return;
		const prefs = await this.attempt(() => bridge.renameHost!(host, typed));
		if (prefs) (this.prefs = prefs), this.touch();
	}

	/** Ask the pine that answered for its agents again, after loading them failed. */
	async reload(): Promise<void> {
		if (this.service.status !== "ready") return;
		this.loadError = undefined;
		this.touch();
		await this.load();
	}

	/** What the page knew of the pine it used, let go of when it uses another. */
	private forgetPine(): void {
		this.agents = [];
		this.tabs = [];
		this.active = undefined;
		this.conversations = new Map();
		this.taints = new Map();
		this.sessionModes = new Map();
		this.pins = new Set();
		this.busy = new Map();
		// A wait for the end of the work was for that pine's work: the next one's would install in the middle of it.
		this.updateWhenDone = false;
		this.said = [];
		this.titles = new Map();
		this.titled = false;
		this.themesRead = false;
		this.browserChecked = false;
		this.saidAt = 0;
		this.asking = undefined;
		this.asked = new Set();
		this.pendingFind = undefined;
		this.settingsAgent = undefined;
		this.browser = undefined;
		this.browserAsk = false;
		for (const t of this.timers) clearInterval(t);
		this.timers = [];
	}

	/** The machine whose pine the app uses, by its short name; none when it is this computer's. */
	get remote(): string | undefined {
		const s = this.service;
		return s.status === "ready" ? s.label : s.host && this.nameOf(s.host);
	}

	/**
	 * The host key the connection stopped at and nobody has trusted yet (never one that changed), when
	 * the bridge keeps host keys of its own (the mobile app's): the fingerprint the page shows and offers to trust.
	 */
	get keyToTrust(): { host: string; fingerprint: string } | undefined {
		const s = this.service;
		if (s.status !== "error" || !s.host || !s.fingerprint || s.changed !== false || typeof bridge.trustHostKey !== "function") return undefined;
		return { host: s.host, fingerprint: s.fingerprint };
	}

	/** The owner's yes to the host key the page showed: exactly that fingerprint, which the bridge then connects with. */
	async trustHostKey(key: { host: string; fingerprint: string }): Promise<void> {
		await this.attempt(() => bridge.trustHostKey!(key.host, key.fingerprint));
	}

	/** Which view of the machines is shown, and with which controls (`machinesView`): for the first screen and Settings > Environments alike. */
	get machinesShown(): ReturnType<typeof machinesView> {
		return machinesView({ canPair: this.canPair, canAddHost: this.canAddHost, hosts: this.prefs.hosts, chosen: this.machinesChosen });
	}

	/** The owner's choice of a view of the machines, by the link to SSH or the back control. */
	showMachines(view: MachinesViewName): void {
		this.machinesChosen = view;
		this.touch();
	}

	/**
	 * Whether the owner can let go of the machine in use and come back to the list: only under a bridge
	 * with no local machine that offers it (the web client's), and only while a machine is in use, being reached or
	 * not reached: the web bridge keeps trying one in error, and Forget would drop its host key.
	 */
	get canDisconnect(): boolean {
		const s = this.service;
		return !this.local && typeof bridge.disconnect === "function" && !!s.host;
	}

	/** Let go of the machine in use, which stays on the list with its host key: the bridge says the new state, and the page shows the machines. */
	async disconnect(): Promise<void> {
		if (!this.canDisconnect) return;
		const prefs = await this.attempt(() => bridge.disconnect!());
		if (!prefs) return;
		this.prefs = prefs;
		this.touch();
	}

	/** Use the pine of a machine of the list, or with none this computer's: the window shows that pine's agents and its own tabs. */
	async useMachine(host?: string): Promise<void> {
		if (host === this.service.host && this.service.status === "ready") return;
		// No "this computer" to use: the bridge is never asked for it.
		if (!host && !this.local) return;
		await this.attempt(() => bridge.use(host));
	}

	/**
	 * A folder for a conversation: chosen in the Finder for this computer's pine; for another
	 * machine's, its path there is typed, since the Finder shows this computer's folders.
	 */
	async chooseFolder(title: string): Promise<string | undefined> {
		const on = this.remote;
		if (!on) return bridge.pickFolder(title);
		const typed = await this.pick({ title: `${title} (on ${on})`, items: [], free: true, placeholder: `The folder's full path on ${on}, such as ~/projects/site` });
		return typed?.trim() || undefined;
	}

	/** Everything that is asked once the daemon answers: the agents, the tabs of last time, what waits for an answer. */
	private async load(): Promise<void> {
		try {
			this.agents = await this.askAgents();
		} catch (e) {
			// Said in the gate, which would otherwise wait for agents that are not coming. Once the page is open
			// (the same pine started again) the gate is not shown, so it is said where the owner is too.
			this.loadError = errText(e);
			if (this.opened) this.flash(this.loadError, "bad");
			return this.touch();
		}
		for (const a of this.agents) learnHome(a.workspace);
		// The browser build is fetched onto this computer: another machine's pine is not asked about it here.
		if (!this.remote) void this.checkBrowser(true);
		else ((this.browserChecked = true), this.touch());
		for (const t of this.timers) clearInterval(t);
		// The app shows an agent's browser itself, in its aside: the daemon is told so while the app runs, and the browser opens no window.
		const embedded = () => void api.browserEmbedded().catch(() => {});
		embedded();
		this.timers = [window.setInterval(() => void this.pollPrograms(), 3000), window.setInterval(() => void this.refreshTaints(), 20_000), window.setInterval(() => void this.refreshAgents(), 8000), window.setInterval(embedded, 30_000)];
		const first = this.agents.find((a) => a.main) ?? this.agents[0];
		if (!first) {
			// The timers run on: refreshAgents loads the page once an agent is made there.
			this.loadError = NO_AGENTS;
			return this.touch();
		}
		const saved = await api.tabs().catch(() => ({ tabs: [] as Array<{ agent: string; session: string }>, active: 0, code: false }));
		// A daemon that was started again: what the tabs showed is asked for anew.
		this.tabs = [];
		this.active = undefined;
		this.opened = false;
		const again = saved.tabs.filter((t) => this.agents.some((a) => a.id === t.agent));
		// The window shows once the agents and the tabs are known: the tabs are filled behind it, the one in front first.
		// Each fill reads its own conversation and writes its own tab only, so the others are filled side by side.
		this.restoring = true;
		try {
			if (!again.length) await this.openTab(first.id, "main", false, false);
			for (const t of again) await this.openTab(t.agent, t.session, false, false);
			const chats = this.tabs.filter((t) => t.kind === "chat");
			this.activate(chats[again.length ? Math.min(saved.active, chats.length - 1) : 0] ?? this.tabs[0]);
		} finally {
			this.restoring = false;
			this.opened = true;
		}
		this.code = saved.code === true;
		this.saveTabs();
		const front = this.active as Tab | undefined;
		const rest = this.tabs.filter((t) => t !== front && t.kind === "chat");
		void (async () => {
			if (front?.kind === "chat") await this.fill(front);
			await Promise.all(rest.map((t) => this.fill(t)));
		})();
		void this.refreshTaints();
		void this.refreshConversations();
		void this.refreshSaid(true);
		void this.pending();
		void this.refreshThemes();
		void this.refreshViews();
		this.touch();
	}

	/**
	 * Asks pine for its themes and draws the window in the one in force. The main process is handed
	 * it too, so that the window opens in it next time (and its frame and background follow it).
	 */
	async refreshThemes(): Promise<void> {
		const got = await api.themes().catch(() => undefined);
		if (!got) return void ((this.themesRead = true), this.touch());
		this.themesRead = true;
		this.themes = got.themes;
		this.theme = got.theme;
		const look = cleanLook(got.themes.find((t) => t.id === got.theme));
		applyLook(look);
		if (look && JSON.stringify(look) !== JSON.stringify(this.prefs.look)) this.prefs = await bridge.prefs({ look }).catch(() => this.prefs);
		this.touch();
	}

	/** Whether there is a view to show here: the page can run one, and pine has one in force. */
	get hasView(): boolean {
		return this.viewsHere && Boolean(this.view);
	}

	/** Asks pine which views there are and which one is in force. */
	async refreshViews(): Promise<void> {
		if (!this.viewsHere) return;
		const got = await api.views().catch(() => undefined);
		if (!got) return;
		this.views = got.views;
		this.view = got.view;
		this.viewChosen = got.chosen;
		this.touch();
	}

	/** The owner picks a view, or "off": `ui.view` in pine.json. */
	async setView(id: string): Promise<void> {
		const done = await this.attempt(() => api.setSetting("ui.view", id));
		if (done) await this.refreshViews();
	}

	/** The owner picks a theme: `ui.theme` in pine.json, set through pine as any of its settings. */
	async setTheme(id: string): Promise<void> {
		const done = await this.attempt(() => api.setSetting("ui.theme", id));
		if (done) await this.refreshThemes();
	}

	/** The agents, the main one first: it is the one that administers the others. */
	async askAgents(): Promise<AgentInfo[]> {
		const list = await api.agents();
		return [...list].sort((a, b) => Number(b.main) - Number(a.main));
	}

	/**
	 * Ask which agents there are now. Another hand can make, change or remove one at any time: the
	 * main agent when it is asked to, a `pine agent` command, the terminal UI. The daemon does not
	 * announce it, so it is asked: now and then, when the window comes to the front, and whenever
	 * something happened that may have been it.
	 */
	async refreshAgents(): Promise<void> {
		if (this.service.status !== "ready") return;
		const list = await this.askAgents().catch(() => undefined);
		if (!list) return;
		const was = this.agents.map((a) => `${a.id}|${a.description}|${a.color ?? ""}|${a.model}|${a.mode}|${a.thinking}|${a.modelProblem ?? ""}`).join("\n");
		const now = list.map((a) => `${a.id}|${a.description}|${a.color ?? ""}|${a.model}|${a.mode}|${a.thinking}|${a.modelProblem ?? ""}`).join("\n");
		if (was === now) return;
		const fresh = list.filter((a) => !this.agents.some((x) => x.id === a.id)).map((a) => a.id);
		const gone = this.agents.filter((a) => !list.some((x) => x.id === a.id)).map((a) => a.id);
		this.agents = list;
		for (const a of list) learnHome(a.workspace);
		// The pine had no agents when the page was loaded and has one now: the page is loaded, not left on that screen.
		if (!this.opened && this.loadError === NO_AGENTS && list.length) {
			this.loadError = undefined;
			return this.load();
		}
		// An agent that is gone has no conversations to show.
		for (const id of gone) {
			this.conversations.delete(id);
			this.shut(this.tabs.filter((x) => x.agent === id && (x.kind === "chat" || x.kind === "task")));
		}
		this.touch();
		for (const id of fresh) void this.refreshConversations(id);
	}

	/**
	 * Ask for what was said lately (the last thousand tasks, which is what the daemon hands out
	 * at once). Not more often than every few seconds: it is asked after each answer.
	 */
	async refreshSaid(force = false): Promise<void> {
		if (this.service.status !== "ready") return;
		const wait = 4000 - (Date.now() - this.saidAt);
		if (!force && wait > 0) {
			// Asked for too soon: it is done once, when the time is up, so that the last answer is not missed.
			this.saidLater ??= window.setTimeout(() => ((this.saidLater = undefined), void this.refreshSaid(true)), wait);
			return;
		}
		this.saidAt = Date.now();
		const list = await api.tasks(undefined, 1000).catch(() => undefined);
		// Not read: the titles that are not known stay "new conversation" rather than a skeleton forever.
		if (!list) return void ((this.titled = true), this.touch());
		this.said = list.filter((t) => t.depth === 0 && !t.session.startsWith("_t") && !t.meta?.compact);
		// A conversation is called by the first thing the owner said in it.
		const titles = new Map<string, string>();
		for (let i = this.said.length - 1; i >= 0; i--) {
			const t = this.said[i];
			const key = `${t.agent}:${t.session.replace(/~u$/, "")}`;
			if (!titles.has(key) && t.kind === "prompt" && t.prompt.trim()) titles.set(key, short(oneLine(t.prompt), 48));
		}
		this.titles = titles;
		this.titled = true;
		this.touch();
	}

	/**
	 * What a conversation is called. One the owner or an agent named keeps its name; one that was
	 * only started (its name is a stamp like "s1x2y3z") is called by how it began.
	 */
	titleOf(agent: string, session: string): string {
		if (session === "main") return "main conversation";
		// A branch of a conversation that has no name of its own is called after that one's title.
		const branch = /^(s[0-9a-z]{6,10})-branch(?:-(\d+))?$/.exec(session);
		if (branch) return `${this.titleOf(agent, branch[1])} · branch${branch[2] ? ` ${branch[2]}` : ""}`;
		if (!/^s[0-9a-z]{6,10}$/.test(session)) return session;
		return this.titles.get(`${agent}:${session}`) ?? "new conversation";
	}

	/** Whether a conversation's title is known: one called by how it began is not, until what was said is loaded. */
	titleKnown(agent: string, session: string): boolean {
		if (this.titled || session === "main") return true;
		const branch = /^(s[0-9a-z]{6,10})-branch(?:-(\d+))?$/.exec(session);
		if (branch) return this.titleKnown(agent, branch[1]);
		return !/^s[0-9a-z]{6,10}$/.test(session);
	}

	/** Conversations in which something was said that holds these words, the latest first, each with the place. */
	searchSaid(query: string): Array<{ agent: string; session: string; snippet: string; who: string; ts: number }> {
		const q = query.trim().toLowerCase();
		if (q.length < 2) return [];
		const seen = new Set<string>();
		const out: Array<{ agent: string; session: string; snippet: string; who: string; ts: number }> = [];
		const around = (text: string, at: number) => `${at > 30 ? "…" : ""}${oneLine(text.slice(Math.max(0, at - 30), at + q.length + 60))}${text.length > at + q.length + 60 ? "…" : ""}`;
		for (const t of this.said) {
			const session = t.session.replace(/~u$/, "");
			const key = `${t.agent}:${session}`;
			if (seen.has(key) || !this.agent(t.agent)) continue;
			const asked = t.prompt.toLowerCase().indexOf(q);
			const answered = asked < 0 ? (t.result ?? "").toLowerCase().indexOf(q) : -1;
			if (asked < 0 && answered < 0) continue;
			seen.add(key);
			out.push({ agent: t.agent, session, who: asked >= 0 ? (t.kind === "prompt" ? "you" : t.kind) : t.agent, snippet: asked >= 0 ? around(t.prompt, asked) : around(t.result ?? "", answered), ts: t.created });
			if (out.length >= 30) break;
		}
		return out;
	}

	/** Open a conversation at what was looked for: the words are marked in it. */
	async openFound(agent: string, session: string, query: string): Promise<void> {
		this.pendingFind = { key: `${agent}:${session}`, query };
		await this.openTab(agent, session);
		this.ask_("find");
	}

	toggleFold(agent: string): void {
		if (this.folded.has(agent)) this.folded.delete(agent);
		else this.folded.add(agent);
		localStorage.setItem("pine.folded", JSON.stringify([...this.folded]));
		this.touch();
	}

	/** Whether an agent is at work in a conversation, open in a tab or not. */
	isBusy(agent: string, session?: string): boolean {
		if (session !== undefined) return (this.busy.get(`${agent}:${session}`)?.size ?? 0) > 0;
		for (const [key, tasks] of this.busy) if (tasks.size && key.startsWith(`${agent}:`)) return true;
		return false;
	}

	openSettings(section?: string, agent?: string): void {
		if (section) this.section = section;
		this.settingsAgent = agent;
		let tab = this.tabs.find((t) => t.kind === "settings");
		if (!tab) {
			tab = new Tab("settings", "settings", "");
			tab.loaded = true;
			this.tabs.push(tab);
		}
		this.activate(tab);
	}

	/** Questions that were asked before this window was there. */
	private async pending(): Promise<void> {
		const list = await api.approvals().catch(() => [] as Approval[]);
		for (const req of list) {
			const tab = await this.holderFor(req);
			if (!tab || tab.approvals.has(req.id)) continue;
			tab.approvals.set(req.id, tab.add({ t: "approval", req, state: "open" }));
			tab.touch();
		}
		this.askNext();
		this.badge();
	}

	// ---- small things ------------------------------------------------------------------------------

	/** A passing notice; the stock `Toaster` shows it. One that says something went wrong stays longer and is
	 * announced at once. An `ms` of Infinity keeps it until it is closed (Base UI's timeout 0). */
	flash(text: string, tone: Tone = "muted", ms = 4500): void {
		const type = { muted: undefined, accent: "info", good: "success", warn: "warning", bad: "error" }[tone];
		const timeout = tone === "bad" ? Math.max(ms, 7000) : ms;
		toast.add({ description: text, type, timeout: Number.isFinite(timeout) ? timeout : 0, priority: tone === "bad" ? "high" : "low" });
	}

	/** Add a device: a pairing is opened (closing the one that was open) and its dialog shows it. Only the desktop app's bridge opens one. */
	async addDevice(): Promise<void> {
		if (typeof bridge.openPairing !== "function") return this.flash("Devices are added in the Pine app on the computer: Pine > Add a device.");
		const opened = await this.attempt(() => bridge.openPairing!());
		if (!opened) return;
		this.devicePairing = { ...opened };
		this.touch();
	}

	/** The pairing the main process opened (`pine://pair`): shown as it is, never a second one, whose code would replace the one the browser was sent. */
	async showPairing(): Promise<void> {
		const now = await Promise.resolve(bridge.access?.()).catch(() => undefined);
		if (!now?.pairing) return;
		this.devicePairing = { ...now.pairing };
		this.touch();
	}

	/** The dialog was closed: its pairing is cancelled. */
	closePairing(): void {
		if (!this.devicePairing) return;
		this.devicePairing = undefined;
		this.touch();
		void this.attempt(() => bridge.cancelPairing!());
	}

	/** Run something the owner asked for; what goes wrong is said, not thrown away. */
	async attempt<T>(what: () => Promise<T>): Promise<T | undefined> {
		try {
			return await what();
		} catch (e) {
			this.flash(errText(e), "bad");
			return undefined;
		}
	}

	/**
	 * Ask whether the browser the web tools drive is there. A home that another pine set up, or a
	 * new app in place of an old one, has a browser on disk and not the build this pine needs:
	 * with `ask` that is put to the owner once for each version of pine, at the start.
	 */
	async checkBrowser(ask = false): Promise<void> {
		// The build is fetched onto this computer, for this computer's pine.
		if (this.remote) return void ((this.browser = undefined), (this.browserChecked = true), this.touch());
		const over = await api.overview().catch(() => undefined);
		this.browserChecked = true;
		if (!over) return this.touch();
		this.browser = over.browser;
		let later: string | null = null;
		try {
			later = localStorage.getItem("pine.browser.later");
		} catch {
			// No storage: it is asked again next time.
		}
		if (ask && over.browser === false && later !== over.version) this.browserAsk = true;
		if (over.browser !== false) this.browserAsk = this.browserFetching;
		this.touch();
	}

	/** Not now: it is not asked again until pine is another version. Settings > General still offers it. */
	async browserLater(): Promise<void> {
		this.browserAsk = false;
		this.touch();
		const over = await api.overview().catch(() => undefined);
		try {
			if (over) localStorage.setItem("pine.browser.later", over.version);
		} catch {
			// Then it is asked again next time.
		}
	}

	/** Fetch the browser build with the pine this app runs; what it prints is shown as it comes. */
	async fetchBrowser(): Promise<void> {
		if (this.browserFetching) return;
		this.browserFetching = true;
		this.initLines = [];
		this.touch();
		const code = await bridge.browserInstall().catch(() => 1);
		this.browserFetching = false;
		await this.checkBrowser();
		if (this.browser) this.flash(`The browser of the web tools is on this ${computerWord(this.platform)} now.`, "good");
		else this.flash(code === 0 ? "The browser is still not there. What was said is shown in Settings > General." : "The browser could not be fetched. What was said is shown in Settings > General; try again when you are online.", "bad", 8000);
		this.touch();
	}

	/** Where there is no model to choose from yet: the way to Settings › Models, in place of an empty list. */
	async connectModel(): Promise<void> {
		const go = await this.pick({ title: "Connect a model first", items: [{ value: "models", label: "Settings › Models", about: "Sign in to a subscription or add a model server of your own." }] });
		if (go) this.openSettings("models");
	}

	/**
	 * Choose the model of every agent that has none of its own (`defaults.model`), from `among` or
	 * from all that can be used now. Offered where a model was just made available, and where an
	 * agent's model cannot answer.
	 */
	async chooseDefaultModel(among?: string[]): Promise<void> {
		const title = "Model for all agents without a model of their own";
		// Settings that cannot be read only leave the picker without the current value.
		const loaded = await this.loadPick(title, async () => {
			const [models, settings] = await Promise.all([among?.length ? among : api.models(), api.settings().catch(() => [] as Awaited<ReturnType<typeof api.settings>>)]);
			return { models, settings };
		});
		if (!loaded) return;
		const { models } = loaded;
		if (!models.length) return this.connectModel();
		const now = loaded.settings.find((x) => x.key === "defaults.model")?.now;
		const model = await this.pick({ title, items: models.map((m) => ({ value: m, label: m })), current: now, placeholder: "Search models" });
		if (!model || model === now) return;
		if (!(await this.attempt(() => api.setSetting("defaults.model", model)))) return;
		await this.refreshAgents();
		this.flash(`Your agents now run on ${model}. Agents with a model of their own keep it.`, "good", 6000);
	}

	/** Open or close the form that publishes an event as the owner. What waits for an answer is asked once it is closed. */
	setPublishing(open: boolean): void {
		this.publishing = open;
		this.touch();
		if (!open) this.askNext();
	}

	/** An event published as the owner: true when the daemon took it. */
	async publish(topic: string, payload: unknown): Promise<boolean> {
		const done = await this.attempt(() => api.emit(topic, payload));
		if (done) this.flash(`Published event #${done.id} on ${topic}.`);
		return Boolean(done);
	}

	/**
	 * Open a picker at once, drawing skeleton lines, while `load` asks for what it will list. Undefined
	 * when the owner closed it meanwhile or the load failed (said in a flash); the caller then `pick`s
	 * with the data, which takes the same dialog's place.
	 */
	async loadPick<T>(title: string, load: () => Promise<T>): Promise<T | undefined> {
		let closed = false;
		const mine: Picker = { title, items: [], loading: true, done: () => ((closed = true), this.picker === mine && ((this.picker = undefined), this.touch())) };
		this.picker = mine;
		this.touch();
		const data = await this.attempt(load);
		if (closed) return undefined;
		// The skeleton stays until the caller's `pick` takes its place in the same turn, so the dialog goes
		// from loading to its items in one change; a caller that picks nothing has it closed right after.
		if (data === undefined) mine.done(undefined);
		else
			setTimeout(() => {
				if (this.picker === mine) mine.done(undefined);
			});
		return data;
	}

	pick(p: Omit<Picker, "done">): Promise<string | undefined> {
		return new Promise((resolve) => {
			const replaced = this.picker;
			const mine: Picker = {
				...p,
				done: (value) => {
					if (this.picker === mine) ((this.picker = undefined), this.touch());
					resolve(value);
				},
			};
			this.picker = mine;
			this.touch();
			// The picker it takes the place of is answered: nothing was chosen there.
			replaced?.done(undefined);
		});
	}

	agent(id: string): AgentInfo | undefined {
		return this.agents.find((a) => a.id === id);
	}

	isTainted(t: Tab): boolean {
		return this.taints.has(`${t.agent}:${t.session}`);
	}

	/** The mode a conversation really works in: bypass that outside content paused is not bypass. */
	modeOf(t: Tab): string {
		return this.agent(t.agent)?.mode ?? "auto";
	}

	bypassPaused(t: Tab): boolean {
		return this.modeOf(t) === "bypass" && this.isTainted(t) && !this.bypassWhenTainted && this.sessionModes.get(`${t.agent}:${t.session}`) !== "bypass";
	}

	private seen(tab: Tab): void {
		if (tab.unread) {
			tab.unread = false;
			this.touch();
			this.badge();
		}
	}

	/** How many tabs want the owner: shown on the app's icon. */
	private badge(): void {
		void bridge.badge(this.tabs.filter((t) => t.approvals.size > 0).length);
	}

	/**
	 * Call for the owner while they look at something else. The words are pine's own: nothing an
	 * agent or a web page wrote goes into a notification.
	 */
	private attention(title: string, body: string, tab: Tab): void {
		if (this.focused && this.active === tab) return;
		if (!this.focused) void bridge.notify(title, body, tab.key);
	}

	// ---- tabs --------------------------------------------------------------------------------------

	activate(tab: Tab | undefined): void {
		if (!tab) return;
		this.active = tab;
		tab.unread = false;
		this.saveTabs();
		this.touch();
		this.badge();
		if (tab.kind === "chat") void this.pollPrograms();
		if (tab.kind === "chat") void this.refreshBoards(tab);
		this.askNext();
	}

	/** The last save of the tabs, so that what needs the daemon to know a tab (a group for a new conversation) can wait for it. */
	private tabsSaved: Promise<unknown> = Promise.resolve();

	private saveTabs(): void {
		if (this.restoring) return;
		const chats = this.tabs.filter((t) => t.kind === "chat");
		this.tabsSaved = api.saveTabs(chats.map((t) => ({ agent: t.agent, session: t.session })), Math.max(0, chats.indexOf(this.active!)), this.code).catch(() => {});
	}

	/** Opens a tab on a conversation; `filled` false leaves what it holds to be asked for by the caller (the start). */
	async openTab(agent: string, session: string, front = true, filled = true): Promise<void> {
		const existing = this.tabs.find((t) => t.kind === "chat" && t.agent === agent && t.session === session);
		if (existing) return front ? this.activate(existing) : undefined;
		if (!this.agent(agent)) this.agents = await this.askAgents().catch(() => this.agents);
		if (!this.agent(agent)) return this.flash(`There is no agent called ${agent}.`, "bad");
		const tab = new Tab("chat", agent, session);
		const kept = this.drafts.get(tab.key);
		if (kept) ((tab.draft = kept.draft), (tab.attachments = kept.attachments), (tab.quotes = kept.quotes), this.drafts.delete(tab.key));
		this.tabs.push(tab);
		if (front) this.activate(tab);
		else {
			tab.unread = !this.restoring;
			this.saveTabs();
			this.touch();
		}
		if (!filled) return;
		await this.fill(tab);
		void this.refreshConversations(agent);
	}

	/** Ask for what a conversation holds and show it: the folder, the goal, the last messages, the open steps. */
	private async fill(tab: Tab): Promise<void> {
		const { agent, session } = tab;
		const [folder, goal, tree] = await Promise.all([api.folder(agent, session).catch(() => undefined), api.goal(agent, session).catch(() => undefined), api.worktree(agent, session).catch(() => undefined)]);
		tab.folder = folder?.folder;
		tab.worktree = tree?.worktree ? { branch: tree.worktree.branch, base: tree.worktree.base } : undefined;
		tab.workspace = folder?.workspace;
		learnHome(folder?.workspace);
		tab.goal = goal?.goal;
		tab.swarm = (await api.swarm(agent, session).catch(() => undefined))?.swarm;
		// The tab can be used before it is filled (the window shows first): what came live meanwhile (a message
		// the owner sent, the work it started, a question) goes after the history, and once only.
		const early = tab.items;
		tab.items = [];
		try {
			const history = (await api.history(agent, session)).filter((t) => t.depth === 0).reverse();
			for (const t of history) this.past(tab, t);
			const told = new Set(history.map((t) => t.id));
			const done = new Set(history.filter((t) => t.status !== "running" && t.status !== "pending").map((t) => t.id));
			// The owner's message is in the history once it is a task; the rest of a task that is over is too.
			for (const item of early) if (!("task" in item && item.task !== undefined && (done.has(item.task) || (item.t === "user" && told.has(item.task))))) tab.items.push(item);
			this.takeStats(tab, history.at(-1)?.meta?.stats);
			// What is still at work goes on live from here.
			for (const t of history) {
				if (t.status === "running" || t.status === "pending") {
					tab.roots.add(t.id);
					if (t.status === "running") tab.running.add(t.id);
				} else tab.roots.add(t.id);
			}
			if (tab.running.size) tab.startedAt = history.find((t) => t.status === "running")?.started ?? Date.now();
			const steps = await api.todos(agent, session).catch(() => [] as Todo[]);
			if (steps.some((t) => t.status !== "done")) this.showSteps(tab, -1, steps);
			if (tab.goal) tab.add({ t: "goal", goal: tab.goal, full: true });
			if (tab.swarm && tab.swarm.status !== "done") tab.add({ t: "swarm", swarm: tab.swarm, full: true });
		} catch (e) {
			tab.items.push(...early.filter((item) => !tab.items.includes(item)));
			tab.note(`Could not load the conversation: ${errText(e)}`, "bad");
		}
		tab.loaded = true;
		this.rehome(tab);
		tab.touch();
	}

	/**
	 * Questions shown in another tab before this one knew its tasks (the window shows before the tabs are
	 * filled): those of this tab's conversation come over to it.
	 */
	private rehome(tab: Tab): void {
		for (const other of this.tabs) {
			if (other === tab) continue;
			for (const [id, item] of other.approvals) {
				if (this.tabFor(item.req) !== tab || tab.approvals.has(id)) continue;
				other.approvals.delete(id);
				other.remove(item);
				tab.approvals.set(id, item);
				tab.items.push(item);
				other.touch();
			}
		}
		this.badge();
	}

	/**
	 * A task that failed. Where the agent has no model that answers, that is what is said, with the way
	 * to one.
	 */
	private failed(tab: Tab, error?: string): void {
		const info = this.agent(tab.agent);
		if (!info?.modelProblem) return void tab.note(`Failed${error ? `: ${error}` : ""}`, "bad");
		tab.add({ t: "model", agent: tab.agent });
	}

	private past(tab: Tab, t: Task): void {
		if (t.meta?.compact) return void tab.note(t.status === "done" ? (t.result ?? "The earlier part of the conversation was summarised.") : `Shortening the conversation: ${t.status}${t.error ? ` (${t.error})` : ""}`);
		if (t.kind === "event" && t.meta?.label) tab.add({ t: "event", label: t.meta.label, body: eventBody(t.prompt) });
		else if (isGoalRound(t.kind, t.meta?.label)) tab.note(`↻ ${t.meta.label}`);
		else tab.add({ t: "user", text: t.meta?.quotes ? (t.meta.body ?? "") : t.prompt, quotes: t.meta?.quotes, from: t.kind === "prompt" ? undefined : t.kind, task: t.kind === "prompt" && t.meta?.trust === "owner" && t.meta?.steered === undefined ? t.id : undefined, steer: t.meta?.steered === undefined ? undefined : { task: t.id, into: t.meta.steered, read: t.meta.read } });
		(t.meta?.images ?? []).forEach((_, i) => tab.add({ t: "media", kind: "image", name: `attached picture ${i + 1}`, url: media.task(t.id, i) }));
		// It was read by work that was already running; the answer is that work's.
		if (t.meta?.steered !== undefined) return;
		if (t.status === "done") {
			if (t.result) tab.lastAnswer = t.result;
			tab.add({ t: "answer", task: t.id, agent: t.agent, text: t.result || "(no answer)", live: false });
		} else if (t.status === "cancelled") tab.note("Stopped", "muted");
		else if (t.status === "failed") this.failed(tab, t.error);
	}

	/** A tab on one task, typically a sub-agent: what it was given, thought and wrote, and every tool call. */
	async openTask(id: number): Promise<void> {
		const existing = this.tabs.find((t) => t.kind === "task" && t.task === id);
		if (existing) return this.activate(existing);
		// The tab is in front at once, unfilled (its conversation draws a skeleton), and goes if the task cannot be read.
		// Its agent is filled from what the tab was opened from, so that its label is not " #42" meanwhile.
		const from = this.active;
		const tab = new Tab("task", from?.agent ?? "", "");
		tab.task = id;
		this.tabs.push(tab);
		this.activate(tab);
		const data = await this.attempt(() => api.transcript(id));
		if (!data) {
			if (!this.tabs.includes(tab)) return;
			// Back to the tab it was opened from, not a neighbour.
			this.tabs.splice(this.tabs.indexOf(tab), 1);
			if (from && this.tabs.includes(from)) this.activate(from);
			else this.closeTab(tab);
			return;
		}
		if (!this.tabs.includes(tab)) return;
		const { task, entries } = data;
		tab.agent = task.agent;
		tab.session = task.session;
		tab.parent = task.parent;
		// What it follows live starts once the transcript is in: an event during the fetch is in the transcript already.
		tab.baseDepth = task.depth;
		tab.roots.add(id);
		const who = task.kind === "subagent" ? `sub-agent of ${task.agent}` : task.kind === "delegate" ? `${task.agent}, on a task from ${task.meta.chain?.at(-1) ?? "another agent"}` : task.agent;
		const live = task.status === "running" || task.status === "pending";
		tab.note(`${who} · task #${id}${task.parent !== undefined ? ` · started by task #${task.parent}` : ""} · ${task.status}`, "muted", { lines: [{ text: "This tab shows the work and takes no messages." }] });
		if (entries.length) for (const entry of entries) tab.add({ t: "entry", entry });
		else {
			tab.add({ t: "user", text: task.prompt, from: "task" });
			if (task.result) tab.add({ t: "answer", task: id, agent: task.agent, text: task.result, live: false });
		}
		if (live) {
			tab.running.add(id);
			tab.startedAt = task.started ?? Date.now();
		} else tab.add({ t: "divider", text: taskSummary(task.status, task.meta.stats, task.error) });
		tab.loaded = true;
		tab.touch();
		this.touch();
	}

	async openEvents(): Promise<void> {
		let tab = this.tabs.find((t) => t.kind === "events");
		if (!tab) {
			tab = new Tab("events", "events", "");
			tab.loaded = true;
			this.tabs.push(tab);
			// The tab is in front at once; its lines come when the daemon answers.
			this.activate(tab);
			await this.fillEvents(tab);
			return;
		}
		this.activate(tab);
	}

	/** Ask the daemon for the log's last events: what came live meanwhile stays after them. */
	async fillEvents(tab: Tab): Promise<void> {
		tab.logLoading = true;
		tab.logError = undefined;
		tab.touch();
		try {
			const past = (await api.events(undefined, 300)).reverse().filter((e) => !/\/(delta|thinking|message)$/.test(e.topic));
			// The log comes newest first from the daemon; here the newest is at the bottom.
			if (past.length > 1 && past[0].id > past[past.length - 1].id) past.reverse();
			const seen = new Set(past.map((e) => e.id));
			tab.log = [...past, ...tab.log.filter((e) => !seen.has(e.id))];
		} catch (e) {
			tab.logError = errText(e);
		}
		tab.logLoading = false;
		tab.touch();
	}

	/**
	 * Close a tab. It only closes the view: the conversation goes on and stays in the side bar, and the
	 * daemon keeps the list of tabs. Any tab may close, an agent's main conversation's and the last one
	 * too; the window then shows that no tab is open. What was typed and not sent comes back when the
	 * conversation opens again. A question or approval it waits for moves to another tab, where its
	 * dialog and its "!" are; the last tab keeps one, since there would be nowhere to answer it.
	 */
	closeTab(tab: Tab): void {
		if (!this.tabs.includes(tab)) return;
		if (tab.approvals.size && this.tabs.length === 1) return this.flash(`${tab.kind === "chat" ? tab.agent : "This tab"} waits for your answer here: answer it first, then close the tab.`, "warn", 6000);
		this.shut([tab]);
	}

	/**
	 * Close several tabs at once, as the tab bar's menu and the palette ask: the others than `from`, those
	 * to its right, or all of them. A tab that waits for an answer
	 * stays open, and the owner is told why: what is asked keeps its place.
	 */
	closeTabs(which: "others" | "right" | "all", from: Tab | undefined = this.active): void {
		const at = from ? this.tabs.indexOf(from) : -1;
		if ((which === "others" || which === "right") && at < 0) return;
		const chosen = this.tabs.filter((t, i) => (which === "others" ? t !== from : which === "right" ? i > at : true));
		const shut = chosen.filter((t) => !t.approvals.size);
		const kept = chosen.length - shut.length;
		// The tab the menu was opened on comes to the front when the one in front closes, as in VS Code.
		this.shut(shut, which === "others" || which === "right" ? from : undefined);
		if (kept) this.flash(`${plural(kept, "tab")} stayed open: ${kept === 1 ? "it waits" : "they wait"} for your answer.`, "warn", 6000);
	}

	private shut(tabs: Tab[], front?: Tab): void {
		if (!tabs.length) return;
		const before = this.tabs;
		this.tabs = before.filter((t) => !tabs.includes(t));
		for (const tab of tabs) {
			if (tab.kind !== "chat") continue;
			if (tab.draft.trim() || tab.attachments.length || tab.quotes.length) this.drafts.set(tab.key, { draft: tab.draft, attachments: tab.attachments, quotes: tab.quotes });
			// The conversation's terminal ends with its last tab.
			if (!this.tabs.some((t) => t.kind === "chat" && t.key === tab.key)) void bridge.termClose(tab.key).catch(() => {});
			// What a conversation was subscribed to on its own ends when its tab closes (not for an agent's main one).
			if (tab.session !== "main") {
				void api
					.closeSession(tab.agent, tab.session)
					.then((r) => r.unsubscribed.length && this.flash(`Closed ${tab.agent} · ${tab.session}: ${plural(r.unsubscribed.length, "subscription")} to ${r.unsubscribed.join(", ")} ended with it.`, "muted", 6000))
					.catch(() => {});
			}
		}
		if (front && this.tabs.includes(front) && this.active !== front) this.activate(front);
		else if (this.active && tabs.includes(this.active)) {
			// The nearest tab to the left of the one that was in front, else the first.
			const was = before.indexOf(this.active);
			const next = before.slice(0, was).reverse().find((t) => this.tabs.includes(t)) ?? this.tabs[0];
			if (next) this.activate(next);
			else ((this.active = undefined), this.saveTabs(), this.touch(), this.badge());
		} else {
			this.saveTabs();
			this.touch();
		}
		// What a closed tab was asked stays open in the daemon: it goes to the tab it would have gone to had this one not been there.
		for (const tab of tabs) {
			for (const item of tab.approvals.values()) if (this.agent(item.req.agent)) void this.holderFor(item.req).then((to) => to && this.takeAsk(to, item.req, false));
			tab.approvals.clear();
		}
		for (const agent of new Set(tabs.map((t) => t.agent))) void this.refreshConversations(agent);
	}

	/**
	 * The tab an approval or a question is shown in: the one of its conversation, else another of its agent's, else the one
	 * in front. With no tab open at all, the agent's main conversation is opened for it, so that it can be answered.
	 */
	private async holderFor(req: Approval): Promise<Tab | undefined> {
		const tab = this.tabFor(req) ?? this.tabs.find((t) => t.kind === "chat" && t.agent === req.agent) ?? this.active;
		if (tab || !this.agent(req.agent)) return tab;
		await this.openTab(req.agent, "main");
		return this.tabs.find((t) => t.kind === "chat" && t.agent === req.agent && t.session === "main");
	}

	/** Show an open approval or question in a tab: its card, the tab's "!", and its dialog when the tab is in front. */
	private takeAsk(tab: Tab, req: Approval, fresh: boolean): void {
		if (tab.approvals.has(req.id)) return;
		if (fresh) this.endWork(tab);
		tab.approvals.set(req.id, tab.add({ t: "approval", req, state: "open" }));
		if (tab !== this.active) tab.unread = true;
		if (fresh) this.attention("Pine", req.tool === "question" ? `${tab.agent} has a question for you` : `${tab.agent} needs your approval`, tab);
		tab.touch();
		this.touch();
		this.badge();
		if (fresh ? tab === this.active && !this.asking && !this.picker && !this.publishing : false) this.ask(req.id);
		else if (tab === this.active) this.askNext();
	}

	moveTab(from: number, to: number): void {
		if (from === to || from < 0 || to < 0 || from >= this.tabs.length || to >= this.tabs.length) return;
		const [tab] = this.tabs.splice(from, 1);
		this.tabs.splice(to, 0, tab);
		this.saveTabs();
		this.touch();
	}

	cycle(by: number): void {
		if (this.tabs.length < 2 || !this.active) return;
		this.activate(this.tabs[(this.tabs.indexOf(this.active) + by + this.tabs.length) % this.tabs.length]);
	}

	/** The agent something new is meant for when nobody said: the one of the tab in front, if that tab is an agent's. */
	agentInFront(): string | undefined {
		const t = this.active;
		return t && (t.kind === "chat" || t.kind === "task") && this.agent(t.agent) ? t.agent : undefined;
	}

	/** Which agent: the one that was named, the only one there is, or the one the owner picks from the list. */
	async whichAgent(title: string, named?: string): Promise<string | undefined> {
		if (named) return named;
		if (this.agents.length <= 1) return this.agents[0]?.id;
		return this.pick({ title, items: this.agents.map((x) => ({ value: x.id, label: x.id, about: x.description || x.model })), current: this.agentInFront() });
	}

	/** A new conversation: with the agent that is named, else with the one in front, else the owner is asked with whom. */
	async newConversation(agent?: string): Promise<void> {
		const id = agent ?? this.agentInFront() ?? (await this.whichAgent("New conversation with"));
		if (id) await this.openTab(id, sessionName());
	}

	// ---- groups of conversations -----------------------------------------------------------------
	// The daemon keeps them (an agent's groups, which group each conversation is in, how the list is
	// sorted); the side bar draws them and changes them through the control API. A conversation moves
	// with its branches, and a branch is never moved by itself.

	/** A new conversation with an agent, put into a group from the start. */
	async newConversationIn(agent: string, group: string): Promise<void> {
		const session = sessionName();
		await this.openTab(agent, session);
		await this.tabsSaved;
		if (!(await this.attempt(() => api.setGroup(agent, session, group)))) return;
		this.placed.set(`${agent}:${session}`, group);
		await this.refreshConversations(agent);
	}

	/** Put a conversation into a group (made if there is none of that name), or with null take it out. */
	async moveToGroup(agent: string, session: string, group: string | null): Promise<void> {
		const done = await this.attempt(() => api.setGroup(agent, session, group));
		if (!done) return;
		if (group) this.placed.set(`${agent}:${session}`, done.group ?? group);
		else this.placed.delete(`${agent}:${session}`);
		await this.refreshConversations(agent);
	}

	/** Where a conversation goes: one of the agent's groups, a new one, or out of the one it is in. */
	async askMoveToGroup(agent: string, session: string, now?: string): Promise<void> {
		const names = (this.groups.get(agent)?.groups ?? []).map((g) => g.name).filter((n) => n !== now);
		const items = [...names.map((n) => ({ value: `in:${n}`, label: n })), { value: "new", label: "New group…" }, ...(now ? [{ value: "out", label: `Out of ${now}`, about: `Back under ${agent}` }] : [])];
		const picked = await this.pick({ title: `Move ${this.titleOf(agent, session)} to`, items, placeholder: "A group" });
		if (!picked) return;
		if (picked === "out") return this.moveToGroup(agent, session, null);
		const name = picked === "new" ? await this.pick({ title: "A new group", items: [], free: true, placeholder: "Group name" }) : picked.slice(3);
		if (name?.trim()) await this.moveToGroup(agent, session, name.trim());
	}

	/** Make an empty group under an agent, for conversations to be dragged into. */
	async newGroup(agent: string): Promise<void> {
		const name = await this.pick({ title: `A new group for ${agent}'s conversations`, items: [], free: true, placeholder: "Group name" });
		if (!name?.trim()) return;
		if (await this.attempt(() => api.addGroup(agent, name.trim()))) await this.refreshConversations(agent);
	}

	async renameGroup(agent: string, name: string): Promise<void> {
		const to = await this.pick({ title: `Another name for the group ${name}`, items: [], free: true, placeholder: "The new name" });
		if (!to?.trim() || to.trim() === name) return;
		const done = await this.attempt(() => api.renameGroup(agent, name, to.trim()));
		if (!done) return;
		const folded = `${agent}:group:${name}`;
		if (this.folded.delete(folded)) this.folded.add(`${agent}:group:${done.group}`), localStorage.setItem("pine.folded", JSON.stringify([...this.folded]));
		for (const [key, value] of this.placed) if (key.startsWith(`${agent}:`) && value === name) this.placed.set(key, done.group);
		await this.refreshConversations(agent);
	}

	/** Remove a group and every conversation in it, after the owner's yes; the main conversation stays. */
	async removeGroup(agent: string, name: string): Promise<void> {
		const inIt = (this.conversations.get(agent) ?? []).filter((c) => c.group === name && !c.session.endsWith("~u"));
		const goes = inIt.filter((c) => c.session !== "main").map((c) => this.titleOf(agent, c.session));
		const stays = inIt.some((c) => c.session === "main");
		const about = goes.length ? `${goes.join(", ")}: what was said in ${goes.length === 1 ? "it" : "them"}, and what was set up for ${goes.length === 1 ? "it" : "them"} alone, is deleted. This cannot be undone.${stays ? ` The main conversation stays, under ${agent}.` : ""}` : stays ? `There is no conversation in it to remove: the main conversation stays, under ${agent}.` : "There is no conversation in it.";
		const sure = await this.pick({ title: goes.length ? `Remove the group ${name} and the ${plural(goes.length, "conversation")} in it for good?` : `Remove the group ${name}?`, items: [{ value: "yes", label: goes.length ? "Remove them for good" : "Remove the group", about, tone: goes.length ? "bad" : undefined }, { value: "no", label: "Cancel" }] });
		if (sure !== "yes") return;
		const gone = await this.attempt(() => api.removeGroup(agent, name));
		if (!gone) return;
		for (const session of gone.removed) this.dropTabs(agent, session);
		this.folded.delete(`${agent}:group:${name}`);
		localStorage.setItem("pine.folded", JSON.stringify([...this.folded]));
		this.flash(`Removed the group ${name}${gone.removed.length ? ` with ${plural(gone.removed.length, "conversation")}` : ""}.`, "muted", 4000);
		await this.refreshConversations(agent);
	}

	/** How an agent's list is sorted: by when a conversation was last used, or by name. */
	async sortConversations(agent: string, order: "recent" | "name"): Promise<void> {
		if (await this.attempt(() => api.sortConversations(agent, order))) await this.refreshConversations(agent);
	}

	/** Fold or unfold a group in the side bar; kept like a folded agent, in this window's storage. */
	toggleGroupFold(agent: string, name: string): void {
		this.toggleFold(`${agent}:group:${name}`);
	}

	/** A conversation that works in a folder of the owner's: the one that already does, or a new one named after it. */
	async openFolder(dir: string, named?: string, worktree = false): Promise<void> {
		const agent = await this.whichAgent(`Which agent works in ${worktree ? "a worktree of " : ""}${baseName(dir)}?`, named);
		if (!agent) return;
		const used = await api.folders(agent).catch(() => [] as Array<{ session: string; folder: string }>);
		const have = used.find((u) => u.folder === dir);
		// In a worktree it is always a new conversation: one of its own, beside the others in that folder.
		if (have && !worktree) return this.openTab(agent, have.session);
		const taken = new Set(["main", ...used.map((u) => u.session), ...(await api.sessions(agent).catch(() => [] as Conversation[])).map((x) => x.session)]);
		const base = (baseName(dir).replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "folder").slice(0, 24);
		let name = base;
		for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
		const done = await this.attempt(() => api.setFolder(agent, name, dir));
		if (!done) return;
		const made = worktree ? await this.attempt(() => api.makeWorktree(agent, name)) : undefined;
		await this.openTab(agent, name);
		if (made && this.active?.kind === "chat") this.active.note(worktreeNote(made));
	}

	/** A new conversation in a worktree: of the folder of the conversation in front, or of one the owner picks. */
	async newInWorktree(): Promise<void> {
		const front = this.active?.kind === "chat" ? this.active : undefined;
		const dir = front?.folder && !front.worktree ? front.folder : await this.chooseFolder("A new conversation in a worktree of which repository?");
		if (dir) await this.openFolder(dir, front?.folder && !front.worktree ? front.agent : undefined, true);
	}

	/** What a conversation's tabs and the side bar show of its folder and worktree, as the daemon says now. */
	private async followWorktree(agent: string, session: string): Promise<void> {
		const [folder, tree] = await Promise.all([api.folder(agent, session).catch(() => undefined), api.worktree(agent, session).catch(() => undefined)]);
		const worktree = tree?.worktree ? { branch: tree.worktree.branch, base: tree.worktree.base } : undefined;
		for (const t of this.tabs) if (t.kind === "chat" && t.agent === agent && t.session === session) ((t.folder = folder?.folder), (t.worktree = worktree), t.codeTick++, t.touch());
		await this.refreshConversations(agent);
	}

	/** Move a conversation into a worktree of its folder's repository. */
	async makeWorktree(tab: Tab, name?: string): Promise<void> {
		if (tab.kind !== "chat") return;
		if (!tab.folder) return this.flash("This conversation has no folder to make a worktree of. Open one for it first.", "bad");
		const made = await this.attempt(() => api.makeWorktree(tab.agent, tab.session, name));
		if (!made) return;
		await this.followWorktree(tab.agent, tab.session);
		tab.note(worktreeNote(made));
	}

	/** What can be done with a conversation's worktree: merge it, bring its base in, discard it; or make one. */
	async worktreeMenu(tab: Tab): Promise<void> {
		if (tab.kind !== "chat") return;
		const w = (await this.loadPick(`Worktree of ${tab.agent} · ${tab.session}`, () => api.worktree(tab.agent, tab.session)))?.worktree;
		if (w === undefined) return;
		if (!w) {
			const make = await this.pick({ title: "Work in a worktree?", items: [{ value: "make", label: "Make a worktree of this folder", about: "A separate checkout of the repository, on a branch pine/<name>: other conversations' files are not touched, and you merge it back when it is done." }, { value: "no", label: "Cancel" }] });
			return make === "make" ? this.makeWorktree(tab) : undefined;
		}
		const stand = `${plural(w.ahead, "commit")} ahead of ${w.base}${w.behind ? `, ${w.behind} behind` : ""}${w.dirty ? `, ${plural(w.dirty, "file")} not committed` : ""}`;
		const items: Array<{ value: string; label: string; about?: string; tone?: "bad" }> = [];
		if (w.mergeable && w.ahead) items.push({ value: "merge", label: `Merge into ${w.base}`, about: stand }, { value: "squash", label: `Squash into ${w.base}`, about: "All of it as one commit" });
		if (w.behind) items.push({ value: "update", label: `Update from ${w.base}`, about: `Bring the ${plural(w.behind, "new commit")} of ${w.base} into the worktree` });
		if (w.dirty) items.push({ value: "commit", label: "Ask the agent to commit", about: "A merge takes what is committed" });
		items.push({ value: "discard", label: "Discard the worktree…", about: w.merged && !w.dirty ? "Everything in it is merged" : "The worktree's changes and branch are deleted", tone: w.merged && !w.dirty ? undefined : "bad" });
		items.push({ value: "keep", label: "Discard, keep the branch", about: `The folder goes, ${w.branch} stays for git` });
		const chosen = await this.pick({ title: `${w.branch} · ${stand}`, items });
		if (!chosen) return;
		if (chosen === "merge" || chosen === "squash") {
			const r = await this.attempt(() => api.mergeWorktree(tab.agent, tab.session, chosen));
			if (r) this.flash(`${plural(r.commits, "commit")} of ${w.branch} ${r.how === "squash" ? "squashed into" : "merged into"} ${w.base}${r.how === "ff" ? " (a fast-forward)" : ""}.`, "good");
		} else if (chosen === "update") {
			const r = await this.attempt(() => api.updateWorktree(tab.agent, tab.session));
			if (r) this.flash("conflicts" in r ? `${w.base} and the worktree both changed ${r.conflicts.join(", ")}; nothing was changed. Ask the agent to merge ${w.base} and settle it.` : `The worktree has the ${plural(r.merged, "new commit")} of ${w.base} now.`, "conflicts" in r ? "bad" : "good");
		} else if (chosen === "commit") {
			await this.submit(tab, "Commit what you changed in this worktree that is meant to stay, with a message that says what it does.", "queue");
		} else {
			if (chosen === "discard" && !(w.merged && !w.dirty)) {
				const sure = await this.pick({ title: `Delete ${w.branch} and what is in it?`, items: [{ value: "yes", label: "Delete it", about: `${plural(w.ahead, "commit")} not merged${w.dirty ? `, ${plural(w.dirty, "changed file")}` : ""}. This cannot be undone.`, tone: "bad" }, { value: "no", label: "Cancel" }] });
				if (sure !== "yes") return;
			}
			const r = await this.attempt(() => api.discardWorktree(tab.agent, tab.session, chosen === "keep"));
			if (r) tab.note(`The worktree is gone${chosen === "keep" ? `; the branch ${w.branch} stays` : ""}. This conversation works in ${r.folder ? tilde(r.folder) : "the agent's workspace"} again.`);
		}
		await this.followWorktree(tab.agent, tab.session);
	}

	async refreshConversations(agent?: string): Promise<void> {
		const ids = agent ? [agent] : this.agents.map((a) => a.id);
		await Promise.all(
			ids.map(async (id) => {
				const [list, groups] = await Promise.all([api.sessions(id).catch(() => undefined), api.groups(id).catch(() => undefined)]);
				// Not read: the agent shows its real group (its main line) rather than a skeleton forever, unless it was read before.
				if (!this.conversations.has(id) || list) this.conversations.set(id, list ?? []);
				if (!this.groups.has(id) || groups) this.groups.set(id, groups ?? { order: "recent", groups: [] });
				if (!list) return;
				for (const c of list) this.placed.delete(`${id}:${c.session}`);
				// A conversation with nothing said yet is not in the list: its pin, kept by the daemon, stays as it was.
				for (const c of list) {
					if (c.pinned) this.pins.add(`${id}:${c.session}`);
					else this.pins.delete(`${id}:${c.session}`);
				}
			}),
		);
		this.touch();
	}

	async refreshTaints(): Promise<void> {
		try {
			const s = await api.status();
			this.taints.clear();
			this.sessionModes.clear();
			this.bypassWhenTainted = s.bypassWhenTainted === true;
			// What is at work right now, as the daemon has it: events only tell what happened since this window opened.
			for (const [key, tasks] of this.busy) if (!s.running.some((r) => `${r.agent}:${r.session}` === key && tasks.has(r.task))) this.busy.delete(key);
			for (const r of s.running) {
				if (r.kind === "subagent" || r.kind === "delegate" && String(r.session).startsWith("_t")) continue;
				const key = `${r.agent}:${r.session}`;
				if (!this.busy.has(key)) this.busy.set(key, new Set());
				this.busy.get(key)!.add(r.task);
			}
			this.installWhenDone();
			for (const x of s.sessions) {
				const open = this.tabs.find((t) => t.kind === "chat" && t.agent === x.agent && t.session === x.session);
				if (open && x.context?.percent !== undefined) open.context = x.context.percent;
				if (x.tainted) this.taints.set(`${x.agent}:${x.session}`, x.tainted);
				this.sessionModes.set(`${x.agent}:${x.session}`, x.mode);
			}
			for (const [id, mode] of Object.entries(s.modes ?? {})) {
				const info = this.agent(id);
				if (info) info.mode = mode;
			}
			// Bypass that stopped applying must not go unnoticed.
			for (const t of this.tabs) {
				if (t.kind !== "chat" || t.pauseNoted || !this.bypassPaused(t)) continue;
				t.pauseNoted = true;
				t.note(`Bypass is paused in this conversation: it has read outside content (${this.taints.get(`${t.agent}:${t.session}`)}).`, "warn", { lines: [{ text: "The agent asks again before a critical action and before it sends something out. Choosing bypass again offers a clean conversation or bypass here anyway; a reset starts over." }] });
				t.touch();
			}
			this.touch();
		} catch {
			// the bar keeps what it showed
		}
	}

	/** Ask which boards a conversation can use and how they stand: when its tab comes to the front, and when pine says a board changed. */
	async refreshBoards(tab: Tab): Promise<void> {
		if (tab.kind !== "chat" || this.service.status !== "ready") return;
		// (Several changes in a row ask several times: only the answer to the last question counts.)
		const asked = ++tab.boardAsked;
		const list = await api.boards(tab.agent, tab.session).catch(() => undefined);
		if (!list || asked !== tab.boardAsked) return;
		tab.boards = list;
		tab.boardTick++;
		tab.touch();
	}

	private async pollPrograms(): Promise<void> {
		const t = this.active;
		if (!t || t.kind !== "chat" || this.service.status !== "ready") return;
		const list = await api.programs(t.agent, t.session).catch(() => undefined);
		// A failed poll still ends the first read: Running shows its empty state rather than skeleton lines forever.
		if (!list) return void (!t.programsRead && ((t.programsRead = true), t.touch()));
		const changed = !t.programsRead || list.length !== t.programs.length || list.some((p, i) => p.id !== t.programs[i]?.id);
		t.programs = list;
		t.programsRead = true;
		if (changed || list.length) t.touch();
	}

	// ---- what the owner does in a conversation -----------------------------------------------------

	async submit(tab: Tab, raw: string, whenBusy: "steer" | "queue" = "steer"): Promise<void> {
		const typed = raw.trim();
		if ((!typed && !tab.quotes.length) || tab.kind !== "chat") return;
		if (typed) tab.inputs.push(typed);
		const quotes = tab.quotes.splice(0);
		const sent = quotes.length ? quotes.map((q): SentQuote => ({ text: q.text, source: q.source })) : undefined;
		const text = withQuotes(quotes, typed);
		const files = tab.attachments.splice(0);
		tab.draft = "";
		const mine = tab.add({ t: "user", text: typed, files: files.map((f) => f.name), quotes: sent });
		for (const f of files) if (f.preview) tab.add({ t: "media", kind: "image", name: f.name, url: f.preview });
		tab.awaiting.push(text);
		tab.touch();
		try {
			const busy = tab.busy;
			const mentions = [...typed.matchAll(/(?:^|\s)@([^\s@]+)/g)].map((m) => m[1]).filter((m) => tab.files.has(m.split("#")[0]));
			const { task, steered } = await api.prompt(tab.agent, typed, tab.session, files.length ? files.map((f) => ({ name: f.name, data: f.data })) : undefined, whenBusy, mentions.length ? mentions : undefined, sent, !this.remote);
			tab.roots.add(task);
			if (steered === undefined) (mine.task = task), mine.v++;
			if (steered !== undefined) {
				mine.steer ??= { task, into: steered };
				mine.v++;
				tab.awaiting = tab.awaiting.filter((p) => p !== text);
				this.flash(`Given to the agent while it works. ${shortcut("⌥↩")} makes a message wait until the agent is done instead.`, "muted", 3000);
			} else if (busy) this.flash("Queued: it is answered when the agent is done with the current work.", "muted", 3000);
		} catch (e) {
			tab.awaiting = tab.awaiting.filter((p) => p !== text);
			tab.attachments.unshift(...files);
			tab.quotes.unshift(...quotes);
			tab.remove(mine);
			tab.draft = typed;
			tab.note(`Not sent: ${errText(e)}`, "bad");
			tab.touch();
		}
		void this.refreshConversations(tab.agent);
	}

	/**
	 * Stop what is running. A message typed while the agent worked starts the moment that work
	 * stops: a second stop, pressed because nothing seemed to happen, would stop that message too.
	 * So for a few seconds after a stop, the next one leaves alone a message that was waiting.
	 */
	async stop(tab: Tab): Promise<void> {
		if (!tab.busy) return;
		const recent = tab.stopped && Date.now() - tab.stopped.at < STOP_GRACE ? tab.stopped : undefined;
		const ids = [...tab.running].filter((id) => !recent?.spared.has(id));
		if (!ids.length) return this.flash("Stopped. This is your next message being answered; stop again in a moment to stop it too.");
		tab.stopped = { at: Date.now(), waiting: tab.awaiting.length, spared: recent?.spared ?? new Set() };
		for (const id of ids) await api.cancel(id).catch(() => {});
	}

	/** A message steered into work that has not read it yet: that work stops the step it is on and reads it now. */
	async sendNow(tab: Tab, steer: Steer): Promise<void> {
		const r = await this.attempt(() => api.sendNow(steer.task));
		if (r && !r.sent) this.flash("The agent has read it already.", "muted", 3000);
		tab.touch();
	}

	async undo(tab: Tab, redo: boolean): Promise<void> {
		if (tab.kind !== "chat") return;
		const r = await this.attempt(() => (redo ? api.redo(tab.agent, tab.session) : api.undo(tab.agent, tab.session)));
		if (!r) return;
		tab.clear();
		const history = (await api.history(tab.agent, tab.session).catch(() => [] as Task[])).filter((t) => t.depth === 0).reverse();
		for (const t of history) (this.past(tab, t), tab.roots.add(t.id));
		const said = undoLines(r, redo);
		tab.note(`${redo ? "↷" : "↶"} ${said.head}`, "accent", { lines: said.lines });
		if (!redo) {
			tab.draft = r.quotes?.length ? (r.body ?? "") : r.prompt;
			tab.quotes = (r.quotes ?? []).map((q) => ({ id: quoteId(), text: q.text, tab: tab.key, source: q.source }));
		}
		tab.codeTick++;
		tab.touch();
		void this.refreshTaints();
	}

	/** Go on in a new conversation from message `at` of this one, or from all of it; this one stays as it is. */
	async branch(agent: string, session: string, at?: number, worktree = false): Promise<void> {
		const r = await this.attempt(() => api.branch(agent, session, at, worktree));
		if (!r) return;
		await this.openTab(agent, r.session);
		if (r.worktree && this.active?.kind === "chat") this.active.note(worktreeNote(r.worktree));
		this.flash(`A branch of ${this.titleOf(agent, session)}${at !== undefined ? " from that message" : ""}: what you say here stays here.${r.outside ? " It holds outside content, as that conversation did." : ""}`, "muted", 5000);
		void this.refreshConversations(agent);
		void this.refreshTaints();
	}

	async reset(tab: Tab): Promise<void> {
		if (tab.kind !== "chat") return;
		const ok = await this.pick({ title: `Start the conversation ${tab.session} of ${tab.agent} over?`, items: [{ value: "yes", label: "Forget it and start fresh", about: "The messages are deleted, along with what the agent may do without asking here, the goal and what only this conversation listens to.", tone: "bad" }, { value: "no", label: "Cancel" }] });
		if (ok !== "yes") return;
		if (!(await this.attempt(() => api.reset(tab.agent, tab.session)))) return;
		this.freshen(tab);
	}

	private freshen(t: Tab): void {
		t.clear();
		t.context = t.cacheShare = t.goal = t.swarm = undefined;
		this.taints.delete(`${t.agent}:${t.session}`);
		t.note("Fresh conversation");
		t.touch();
		this.touch();
	}

	async setFolder(tab: Tab, folder: string | null): Promise<void> {
		if (tab.kind !== "chat") return;
		const r = await this.attempt(() => api.setFolder(tab.agent, tab.session, folder));
		if (!r) return;
		for (const t of this.tabs) if (t.kind === "chat" && t.agent === tab.agent && t.session === tab.session) ((t.folder = r.folder), t.codeTick++);
		tab.note(r.folder ? `This conversation now works in ${tilde(r.folder)}: ${tab.agent}'s tools start there and may read and change what is in it, from your next message on.` : `This conversation works in ${tab.agent}'s own workspace again; the folder is closed to it from your next message on.`);
		tab.touch();
		this.touch();
	}

	async pickFolder(tab: Tab): Promise<void> {
		if (tab.kind !== "chat") return;
		const used = await api.folders(tab.agent).catch(() => [] as Array<{ session: string; folder: string }>);
		const items = [{ value: "none", label: "No folder", about: `${tab.agent}'s own workspace` }, ...(tab.folder ? [{ value: tab.folder, label: tilde(tab.folder), about: "this conversation's folder" }] : [])];
		for (const u of used) if (!items.some((i) => i.value === u.folder) && items.length < 9) items.push({ value: u.folder, label: tilde(u.folder), about: `also open in ${u.session}` });
		items.push({ value: "pick", label: "Choose a folder…", about: this.remote ? `any folder on ${this.remote}` : "any folder of yours" });
		const chosen = await this.pick({ title: `Folder for ${tab.agent} · ${tab.session}`, items, current: tab.folder ?? "none" });
		if (!chosen || chosen === (tab.folder ?? "none")) return;
		if (chosen !== "pick") return this.setFolder(tab, chosen === "none" ? null : chosen);
		const picked = await this.chooseFolder(`Folder for ${tab.agent} · ${tab.session}`);
		if (picked) await this.setFolder(tab, picked);
	}

	async pickModel(tab: Tab): Promise<void> {
		const info = this.agent(tab.agent);
		if (!info) return;
		const models = await this.loadPick(`Model for ${tab.agent}`, () => api.models());
		if (!models) return;
		if (!models.length) return this.connectModel();
		const model = await this.pick({ title: `Model for ${tab.agent}`, items: models.map((m) => ({ value: m, label: m })), current: info.model, placeholder: "Search models" });
		if (!model || model === info.model) return;
		if (!(await this.attempt(() => api.setModel(tab.agent, model)))) return;
		info.model = model;
		tab.note(`${tab.agent} now uses ${model}. It is saved, and holds after a restart too.`);
		tab.touch();
		this.touch();
	}

	async pickReasoning(tab: Tab): Promise<void> {
		const info = this.agent(tab.agent);
		if (!info) return;
		const level = await this.pick({ title: `Reasoning for ${tab.agent}`, items: Object.entries(REASONING_ABOUT).map(([value, a]) => ({ value, label: value, about: a })), current: info.thinking });
		if (level) await this.setReasoning(tab, level);
	}

	async setReasoning(tab: Tab, level: string): Promise<void> {
		const info = this.agent(tab.agent);
		if (!info || level === info.thinking) return;
		if (!(await this.attempt(() => api.setThinking(tab.agent, level)))) return;
		info.thinking = level;
		tab.note(`${tab.agent} now reasons at "${level}". A model that cannot reason ignores it.`);
		tab.touch();
		this.touch();
	}

	async pickMode(tab: Tab): Promise<void> {
		const mode = await this.pick({ title: `Mode for ${tab.agent}`, items: MODES.map((m) => ({ value: m.value, label: m.label, about: m.about, tone: m.value === "bypass" ? "bad" : undefined })), current: this.modeOf(tab) });
		if (mode) await this.setMode(tab, mode);
	}

	async setMode(t: Tab, mode: string): Promise<void> {
		const info = this.agent(t.agent);
		if (!info) return;
		let anyway: string | undefined;
		await this.refreshTaints();
		if (mode === "bypass" && this.isTainted(t) && !this.bypassWhenTainted) {
			// Bypass normally stops applying once a conversation has read outside content. Make that a choice, not a surprise.
			const choice = await this.pick({
				title: "This conversation has read outside content",
				items: [
					{ value: "new", label: "Bypass in a new, clean conversation", about: "recommended" },
					{ value: "anyway", label: "Bypass here anyway", about: "what it read could steer an agent with your whole account", tone: "bad" },
					{ value: "cancel", label: "Cancel" },
				],
			});
			if (!choice || choice === "cancel") return;
			if (choice === "anyway") anyway = t.session;
			else {
				if (!(await this.attempt(() => api.setMode(t.agent, mode)))) return;
				info.mode = "bypass";
				await this.openTab(t.agent, sessionName());
				this.active?.note(`${t.agent} is in bypass mode in this new conversation. Nothing waits for approval, and the agent's shell and file tools reach your whole account and the network.`, "warn");
				return void this.active?.touch();
			}
		}
		if (!(await this.attempt(() => api.setMode(t.agent, mode, anyway)))) return;
		info.mode = mode as AgentInfo["mode"];
		t.pauseNoted = false;
		const more: Record<string, string> = {
			bypass: "Nothing waits for approval now, and the agent's shell and file tools reach your whole account and the network.",
			plan: "It looks, reads and asks, and changes nothing: ask for what you want, read the plan, then switch the mode back to have it carried out.",
			auto: "The agent's shell and file tools work without a sandbox: your whole account and the network. What is critical is still asked about.",
			safe: "The agent's shell and file tools work inside a sandbox: the agent's own folders, and what you allow.",
			manual: "Each command, edit and message waits for your go-ahead.",
		};
		t.note(`${t.agent} is now in ${mode} mode${mode === "bypass" || mode === "plan" ? " (until pine restarts)" : "; it is saved, and holds after a restart too"}.`, mode === "bypass" ? "warn" : "muted", { lines: [{ text: more[mode] ?? "" }] });
		t.touch();
		await this.refreshTaints();
	}

	async setGoal(tab: Tab, arg: string): Promise<void> {
		if (tab.kind !== "chat") return;
		const word = arg.trim().toLowerCase();
		if (!arg.trim()) {
			tab.goal = (await api.goal(tab.agent, tab.session).catch(() => undefined))?.goal;
			if (tab.goal) tab.add({ t: "goal", goal: tab.goal, full: true });
			else tab.note("This conversation has no goal. Set one, and the agent works until it is met.");
			return tab.touch();
		}
		if (word === "pause" || word === "resume" || word === "clear") {
			// What changes is drawn when the daemon reports it.
			const done = await this.attempt(() => api.setGoal(tab.agent, tab.session, { action: word }));
			if (word === "clear" && done && !done.cleared) this.flash("This conversation has no goal.");
			return;
		}
		// The first round is the objective itself, sent as a message of the owner's.
		const mine = tab.add({ t: "user", text: arg.trim() });
		tab.awaiting.push(arg.trim());
		tab.touch();
		try {
			await api.setGoal(tab.agent, tab.session, { objective: arg.trim() });
		} catch (e) {
			tab.awaiting = tab.awaiting.filter((x) => x !== arg.trim());
			tab.remove(mine);
			tab.note(`No goal set: ${errText(e)}`, "bad");
			tab.touch();
		}
	}

	/** /swarm: show it, start one on a job, or pause, resume or clear it. The daemon keeps it and decides everything about it. */
	async setSwarm(tab: Tab, arg: string): Promise<void> {
		if (tab.kind !== "chat") return;
		const word = arg.trim().toLowerCase();
		if (!arg.trim()) {
			tab.swarm = (await api.swarm(tab.agent, tab.session).catch(() => undefined))?.swarm;
			if (tab.swarm) tab.add({ t: "swarm", swarm: tab.swarm, full: true });
			else tab.note("This conversation has no swarm. Type /swarm and what is to be done: the agent hands the job out to sub-agents on the board, and the result is checked before it tells you it is done.");
			return tab.touch();
		}
		if (word === "pause" || word === "resume" || word === "clear") {
			const done = await this.attempt(() => api.setSwarm(tab.agent, tab.session, { action: word }));
			if (word === "clear" && done && !done.cleared) this.flash("This conversation has no swarm.");
			return;
		}
		// The first round is the job itself, sent as a message of the owner's.
		const mine = tab.add({ t: "user", text: arg.trim() });
		tab.awaiting.push(arg.trim());
		tab.touch();
		try {
			await api.setSwarm(tab.agent, tab.session, { objective: arg.trim() });
		} catch (e) {
			tab.awaiting = tab.awaiting.filter((x) => x !== arg.trim());
			tab.remove(mine);
			tab.note(`No swarm started: ${errText(e)}`, "bad");
			tab.touch();
		}
	}

	async askGoal(tab: Tab): Promise<void> {
		const g = tab.goal;
		const items = g ? [...(g.status === "active" ? [{ value: "pause", label: "Pause", about: "no further rounds until you resume" }] : g.status !== "met" ? [{ value: "resume", label: "Resume", about: "go on with the goal" }] : [{ value: "resume", label: "Resume", about: "it was called met too early" }]), { value: "clear", label: "Clear", about: "take the goal off this conversation" }] : [];
		const answer = await this.pick({ title: g ? `Goal: ${short(oneLine(g.objective), 70)}` : "A goal for this conversation", items, free: true, placeholder: g ? "Or type a new objective and press ↩" : "What should be reached? The agent works until a judge says it is met" });
		if (answer) await this.setGoal(tab, answer);
	}

	/** Pins or unpins a conversation, from its tab or its row in the side bar: a star on both, and first in its list. */
	async pin(tab: Tab | { agent: string; session: string }, pinned: boolean): Promise<void> {
		if (tab.session === "main") return this.flash("An agent's main conversation always stays.");
		if (!(await this.attempt(() => api.pinSession(tab.agent, tab.session, pinned)))) return;
		const key = `${tab.agent}:${tab.session}`;
		if (pinned) this.pins.add(key);
		else this.pins.delete(key);
		this.touch();
		void this.refreshConversations(tab.agent);
	}

	async rename(agent: string, session: string, to: string): Promise<void> {
		const done = await this.attempt(() => api.renameSession(agent, session, to));
		if (!done) return;
		for (const t of this.tabs) if (t.kind === "chat" && t.agent === agent && t.session === session) ((t.session = done.session), t.touch());
		this.saveTabs();
		void this.refreshConversations(agent);
		void this.refreshTaints();
	}

	async askRename(tab: Tab): Promise<void> {
		if (tab.kind !== "chat") return;
		if (tab.session === "main") return this.flash("An agent's main conversation cannot be renamed.");
		const to = await this.pick({ title: `Another name for ${tab.session}`, items: [], free: true, placeholder: "The new name" });
		if (to?.trim()) await this.rename(tab.agent, tab.session, to.trim());
	}

	async removeConversation(agent: string, session: string): Promise<void> {
		const gone = await this.attempt(() => api.removeSession(agent, session));
		if (!gone) return;
		this.dropTabs(agent, session);
		const with_ = [...(gone.sources.length ? [`${plural(gone.sources.length, "event source")} ${gone.sources.join(", ")}`] : gone.unsubscribed.length ? [`${plural(gone.unsubscribed.length, "subscription")} to ${gone.unsubscribed.join(", ")}`] : []), ...(gone.servers.length ? [`${plural(gone.servers.length, "MCP server")} ${gone.servers.join(", ")}`] : [])];
		this.flash(`Removed the conversation ${session} of ${agent}${with_.length ? `, with ${with_.join(" and ")}` : ""}.`, "muted", with_.length ? 7000 : 4000);
		void this.refreshConversations(agent);
	}

	/** A conversation is gone: a tab that showed it has nothing left to show. */
	private dropTabs(agent: string, session: string): void {
		const showing = this.tabs.filter((t) => t.kind === "chat" && t.agent === agent && t.session === session);
		if (!showing.length) return;
		this.tabs = this.tabs.filter((t) => !showing.includes(t));
		this.drafts.delete(`${agent}:${session}`);
		if (this.active && showing.includes(this.active)) {
			if (this.tabs[0]) this.activate(this.tabs[0]);
			else this.active = undefined;
		}
		this.saveTabs();
		this.touch();
	}

	async copyAnswer(tab: Tab): Promise<void> {
		if (!tab.lastAnswer) return this.flash("There is no answer to copy yet.");
		await navigator.clipboard.writeText(tab.lastAnswer);
		this.flash("Copied the last answer, as the agent wrote it.");
	}

	/** The conversation as Markdown: what was said, and with `full` what the agent thought and called. */
	async markdownOf(tab: Tab, full: boolean): Promise<string> {
		const tasks = (await api.history(tab.agent, tab.session, 500)).filter((t) => t.depth === 0).reverse();
		const out = [`# ${tab.agent} · ${tab.session}`, "", `Exported from pine on ${new Date().toLocaleString("sv-SE")}.`];
		for (const t of tasks) {
			if (t.meta?.compact) {
				out.push("", "---", "", `*${t.result || "The earlier part of the conversation was summarised here."}*`);
				continue;
			}
			out.push("", t.kind === "prompt" ? (t.meta?.steered !== undefined ? "## You, while the agent worked" : "## You") : `## ${t.kind === "event" ? `Event${t.meta?.label ? `: ${t.meta.label}` : ""}` : `pine (${t.kind})`}`, "", t.prompt.trim());
			if (t.meta?.steered !== undefined) continue;
			if (full) {
				const steps = (await api.transcript(t.id).catch(() => undefined))?.entries ?? [];
				for (const s of steps) {
					if (s.kind === "thinking" && s.text?.trim()) out.push("", "<details><summary>Thinking</summary>", "", s.text.trim(), "", "</details>");
					else if (s.kind === "tool") out.push("", `- ${s.ok === false ? "✗" : "✓"} \`${s.tool}\`${s.subject ? ` ${oneLine(s.subject)}` : ""}${s.ok === false && s.result ? `: ${short(oneLine(s.result), 300)}` : ""}`);
				}
			}
			out.push("", `## ${t.agent}`, "", t.status === "done" ? t.result?.trim() || "(no answer)" : `*${t.status}${t.error && t.error !== t.status ? `: ${t.error}` : ""}*`);
		}
		return `${out.join("\n")}\n`;
	}

	async exportConversation(tab: Tab, full: boolean): Promise<void> {
		if (tab.kind !== "chat") return;
		const text = await this.attempt(() => this.markdownOf(tab, full));
		if (!text) return;
		const saved = await bridge.saveText(`pine-${tab.agent}-${tab.session}-${new Date().toISOString().slice(0, 10)}.md`, text);
		if (saved) this.flash(`Saved to ${tilde(saved)}.`, "good");
	}

	// ---- approvals and questions -------------------------------------------------------------------

	async decide(id: string, allow: boolean, always = false, values?: Record<string, string>): Promise<void> {
		const r = await this.attempt(() => api.decide(id, allow, always, values));
		if (r && !r.decided) this.flash("That request was already answered.");
	}

	closeAsking(): void {
		this.asking = undefined;
		this.touch();
		// After what closed this one has run to its end.
		window.setTimeout(() => this.askNext(), 0);
	}

	/**
	 * Several requests can be open side by side. Only one dialog fits, so each of the others gets
	 * its dialog when the one before it is gone. One that was put off is not asked again by itself.
	 */
	askNext(): void {
		if (this.asking || this.picker || this.publishing || !this.active) return;
		const next = [...this.active.approvals.values()].find((a) => !this.asked.has(a.req.id));
		if (!next) return;
		this.asking = next.req.id;
		this.asked.add(next.req.id);
		this.touch();
	}

	ask(id: string): void {
		this.asking = id;
		this.asked.add(id);
		this.touch();
	}

	/** Forget the questions the daemon no longer has open: nobody can answer them any more. */
	private async dropAnswered(): Promise<void> {
		const pending = await api.approvals().catch(() => undefined);
		if (!pending) return;
		const open = new Set(pending.map((p) => p.id));
		for (const tab of this.tabs) {
			for (const [id, item] of tab.approvals) {
				if (open.has(id)) continue;
				item.state = "gone";
				item.v++;
				tab.approvals.delete(id);
				this.asked.delete(id);
				if (this.asking === id) this.asking = undefined;
				tab.touch();
			}
		}
		this.touch();
		this.badge();
	}

	// ---- commands: what a menu, a key or the palette asks for --------------------------------------

	/** Shows or hides the side bar as a column: the owner's choice, kept for the next start. */
	showSidebar(open: boolean): void {
		if (open === this.sidebar) return;
		this.sidebar = open;
		localStorage.setItem("pine.sidebar", open ? "shown" : "hidden");
		this.touch();
	}

	/** Whether the side panel, the aside or the view is open. */
	isOpen(which: Beside): boolean {
		return which === "code" ? this.code : which === "aside" ? this.aside : this.view_ && this.hasView;
	}

	/** The side panel and the browser belong to a conversation; the view is drawn beside any tab. */
	private drawable(which: Beside): boolean {
		return which === "view" || this.active?.kind === "chat";
	}

	/** Whether a panel is open, and drawn: where there is room for fewer than are open (`fits`), the ones opened last are. */
	shown(which: Beside): boolean {
		if (!this.isOpen(which) || !this.drawable(which) || (this.sheets && this.tucked)) return false;
		const open = this.order.filter((w) => this.isOpen(w) && this.drawable(w));
		return open.slice(-this.fits).includes(which);
	}

	/** Open but not drawn: there is no room for it, and others were opened after it. */
	behind(which: Beside): boolean {
		return this.isOpen(which) && this.drawable(which) && !this.shown(which);
	}

	/** Opens a panel, in front of the others. */
	open(which: Beside): void {
		this.order = [...this.order.filter((w) => w !== which), which];
		this.tucked = false;
		if (which === "code") {
			this.code = true;
			this.saveTabs();
		} else {
			if (which === "view") this.view_ = true;
			else this.aside = true;
			localStorage.setItem(`pine.${which}`, "shown");
		}
	}

	close(which: Beside): void {
		// A sheet put away does not bring up another in its place: that one stays open, behind. (Columns do show it.)
		if (this.sheets && this.shown(which) && this.order.some((w) => w !== which && this.isOpen(w) && this.drawable(w))) this.tucked = true;
		if (which === "code") {
			this.code = false;
			this.saveTabs();
		} else {
			if (which === "view") this.view_ = false;
			else this.aside = false;
			localStorage.setItem(`pine.${which}`, "hidden");
		}
	}

	/** What the icon of each does: a closed one opens, one that is behind comes to the front, the one in front closes. */
	toggle(which: Beside): void {
		if (this.shown(which)) this.close(which);
		else this.open(which);
		this.touch();
	}

	pendingQuote?: { key: string; source: QuoteSource };

	showQuote(key: string, source: QuoteSource): void {
		const tab = this.tabs.find((t) => t.kind === "chat" && t.key === key);
		this.pendingQuote = { key, source };
		if (tab && tab !== this.active) this.activate(tab);
		this.ask_("show-quote");
	}

	/** Ask the parts of the page for something only they can do. */
	ask_(name: string): void {
		this.lastSignal = name;
		this.signal.touch();
	}

	/**
	 * A code block of an answer, run by the owner's click: typed into the terminal of the conversation
	 * the answer is in, as it was shown (runnable.ts), and the terminal shown.
	 */
	runInTerminal(agent: string, session: string, code: string): void {
		// The terminal is a shell of this computer: a conversation of another machine's pine works there, not here.
		if (this.remote) return this.flash(`The terminal is a shell on this computer, and this conversation works on ${this.remote}.`, "warn", 8000);
		const ok = runnable(code);
		if (!ok.ok) return this.flash(ok.why, "warn", 8000);
		const tab = this.tabs.find((t) => t.kind === "chat" && t.agent === agent && t.session === session) ?? (this.active?.kind === "chat" ? this.active : undefined);
		if (!tab) return this.flash("This answer's conversation is not open in a tab: open it to run the code.", "warn");
		tab.runs.push(ok.text);
		tab.touch();
		if (this.active !== tab) this.activate(tab);
		this.codeView = "terminal";
		this.open("code");
		this.touch();
	}

	async command(name: string): Promise<void> {
		const tab = this.active;
		const chat = tab?.kind === "chat" ? tab : undefined;
		// A folder opened with the app from the Finder is this computer's.
		if (name.startsWith("folder:")) return this.remote ? this.flash(`That folder is on this computer, and the app uses the pine on ${this.remote}. Use this ${computerWord(this.platform)}'s pine to open it.`, "warn", 7000) : this.openFolder(name.slice(7));
		if (name.startsWith("focus:")) return this.activate(this.tabs.find((t) => t.key === name.slice(6)));
		if (name.startsWith("tab-")) return this.activate(this.tabs[Number(name.slice(4)) - 1]);
		if (name.startsWith("code-")) {
			this.codeView = name.slice(5) as CodeView;
			this.open("code");
			return this.touch();
		}
		if (name.startsWith("settings:")) return this.openSettings(name.slice(9));
		switch (name) {
			case "settings":
				// The same key opens the settings and puts them away again.
				return tab?.kind === "settings" ? this.closeTab(tab) : this.openSettings();
			case "palette":
				this.palette = !this.palette;
				if (this.palette) void this.refreshSaid();
				return this.touch();
			case "sidebar":
				// The stock side bar carries it out (`TitleBar` in App.tsx): in a narrow window it slides the list
				// over the page for a moment and leaves the owner's choice as it is, in a wide one it calls `showSidebar`.
				return this.ask_("sidebar");
			case "code":
				return this.toggle("code");
			case "browser":
				return this.toggle("aside");
			case "view":
				if (!this.hasView) return this.flash(this.viewsHere ? "There is no view: put one into the views folder of pine's home, or choose one in Settings." : "Views are shown in the Pine app on your computer.", "muted", 6000);
				return this.toggle("view");
			case "events":
				return this.openEvents();
			case "updates":
				return this.lookForUpdate(true);
			case "add-device":
				return this.addDevice();
			case "pairing-shown":
				return this.showPairing();
			case "new":
				return this.newConversation();
			case "agent": {
				this.agents = await this.askAgents().catch(() => this.agents);
				const id = await this.pick({ title: "New conversation with", items: this.agents.map((x) => ({ value: x.id, label: x.id, about: x.description || x.model })), current: chat?.agent });
				return id ? this.openTab(id, sessionName()) : undefined;
			}
			case "new-worktree":
				return this.newInWorktree();
			case "open-folder": {
				const dir = await this.chooseFolder("Open a folder for a conversation");
				return dir ? this.openFolder(dir) : undefined;
			}
			case "close":
				return tab ? this.closeTab(tab) : undefined;
			case "next-tab":
				return this.cycle(1);
			case "prev-tab":
				return this.cycle(-1);
			case "save":
			case "attach":
			case "find":
			case "help":
			case "voice":
			case "focus-input":
				return this.ask_(name);
		}
		if (!chat) return name === "stop" && tab?.kind === "task" ? this.stop(tab) : undefined;
		switch (name) {
			case "stop":
				return this.stop(chat);
			case "undo":
				return this.undo(chat, false);
			case "branch":
				return this.branch(chat.agent, chat.session);
			case "branch-worktree":
				return this.branch(chat.agent, chat.session, undefined, true);
			case "worktree":
				return this.worktreeMenu(chat);
			case "redo":
				return this.undo(chat, true);
			case "compact":
				return void (await this.attempt(() => api.compact(chat.agent, chat.session)));
			case "reset":
				return this.reset(chat);
			case "model":
				return this.pickModel(chat);
			case "reasoning":
				return this.pickReasoning(chat);
			case "mode":
				return this.pickMode(chat);
			case "goal":
				return this.askGoal(chat);
			case "folder":
				return this.pickFolder(chat);
			case "pin":
				return this.pin(chat, !this.pins.has(chat.key));
			case "rename":
				return this.askRename(chat);
			case "copy":
				return this.copyAnswer(chat);
			case "export":
				return this.exportConversation(chat, false);
			case "export-full":
				return this.exportConversation(chat, true);
			case "clear":
				chat.items = [];
				return chat.touch();
		}
	}

	// ---- the daemon's live events ------------------------------------------------------------------

	private tabFor(p: any): Tab | undefined {
		return p?.root !== undefined ? this.tabs.find((t) => t.kind === "chat" && t.roots.has(p.root)) : undefined;
	}

	private dirty = new Set<Model>();

	onEvents(batch: PineEvent[]): void {
		for (const tap of this.taps) {
			try {
				tap(batch);
			} catch (err) {
				console.error("tap", err);
			}
		}
		for (const e of batch) {
			try {
				this.onEvent(e);
			} catch (err) {
				console.error("event", e.topic, err);
			}
		}
		for (const m of this.dirty) m.touch();
		this.dirty.clear();
	}

	private onEvent(e: PineEvent): void {
		const p = (e.payload ?? {}) as any;
		const [ns, , kind] = e.topic.split("/");
		const log = this.tabs.find((t) => t.kind === "events");
		if (log && !/\/(delta|thinking|message)$/.test(e.topic)) {
			log.log.push(e);
			if (log.log.length > 1000) log.log.splice(0, log.log.length - 1000);
			this.dirty.add(log);
		}

		if (ns === "approval") {
			if (e.topic === "approval/requested") {
				const tab = this.tabFor(p) ?? this.tabs.find((t) => t.kind === "chat" && t.agent === p.agent) ?? this.active;
				// With no tab open, one is opened for it: what is asked is never left without a place to be answered.
				if (!tab) return void this.holderFor(p).then((to) => to && this.takeAsk(to, p, true));
				this.takeAsk(tab, p, true);
			} else if (e.topic === "approval/decided") {
				for (const tab of this.tabs) {
					const item = tab.approvals.get(p.id);
					if (!item) continue;
					item.state = p.allow ? "allowed" : "denied";
					item.by = p.by;
					item.always = p.always === true;
					item.v++;
					tab.approvals.delete(p.id);
					this.dirty.add(tab);
				}
				this.asked.delete(p.id);
				if (this.asking === p.id) this.closeAsking();
				this.dirty.add(this);
				this.badge();
			}
			return;
		}
		if (e.topic === "pine/conversation") return void this.followed(p);
		// A board changed: the tab in front asks again if it is one of its own. (It says which board, and nothing of what is on it.)
		if (e.topic === "pine/board") {
			const t = this.active;
			if (t?.kind === "chat" && (p.scope === "global" || (p.agent === t.agent && (p.scope === "agent" || p.session === t.session)))) void this.refreshBoards(t);
			return;
		}
		// A theme chosen in another UI, or by the main agent: the window follows.
		// The model agents run on: whether it can answer is in what is said about each agent (modelProblem).
		if (e.topic === "pine/settings") return void (p.key === "ui.theme" ? this.refreshThemes() : p.key === "ui.view" ? this.refreshViews() : p.key === "defaults.model" && this.refreshAgents());
		if (ns !== "agent") return;
		if (kind === "goal") return this.goalEvent(p);
		if (kind === "swarm") return this.swarmEvent(p);

		// Which conversations are at work, also those no tab shows: the side bar says so beside each agent.
		if ((p.depth ?? 0) === 0 && typeof p.agent === "string" && typeof p.session === "string" && typeof p.task === "number") {
			const key = `${p.agent}:${p.session}`;
			if (kind === "started") {
				if (!this.busy.has(key)) this.busy.set(key, new Set());
				this.busy.get(key)!.add(p.task);
				this.dirty.add(this);
			} else if (kind === "done" || kind === "failed") {
				this.busy.get(key)?.delete(p.task);
				this.dirty.add(this);
				this.installWhenDone();
				// What an agent just did may have been making, changing or removing an agent.
				void this.refreshAgents();
				void this.refreshSaid();
			}
		}

		// A tab on one task follows that task and whatever it starts itself.
		for (const t of this.tabs) {
			if (t.kind !== "task") continue;
			if (kind === "started" && p.parent !== undefined && t.roots.has(p.parent)) t.roots.add(p.task);
			if (t.roots.has(p.task)) this.live(t, kind, p, (p.depth ?? 0) - t.baseDepth);
		}

		if (kind === "read") {
			// The work read a message that was steered into it.
			for (const tab of this.tabs) {
				if (tab.kind !== "chat" || tab.agent !== p.agent || tab.session !== p.session) continue;
				const it = tab.items.findLast((x): x is Of<"user"> => x.t === "user" && x.steer?.task === p.by);
				if (it?.steer) ((it.steer.read = Number(p.at) || Date.now()), it.v++, this.dirty.add(tab));
			}
			return;
		}

		if (kind === "steered") {
			// A message that went into running work: ours is on screen already, somebody else's is shown.
			const tab = this.tabs.find((t) => t.kind === "chat" && t.agent === p.agent && t.session === p.session);
			if (!tab || tab.roots.has(p.by)) return;
			tab.roots.add(p.by);
			const i = tab.awaiting.findIndex((x) => ownMessage(p.prompt, x));
			const steer = { task: Number(p.by), into: Number(p.task) };
			if (i >= 0) {
				// Ours: the bubble on screen gets its line now, before the answer to the request comes.
				const text = tab.awaiting.splice(i, 1)[0];
				const mine = tab.items.findLast((it): it is Of<"user"> => it.t === "user" && said(it) === text && !it.steer && it.task === undefined);
				if (mine) ((mine.steer = steer), mine.v++);
			} else {
				this.endWork(tab);
				tab.add({ t: "user", ...ownerText(p), from: p.kind === "prompt" ? "elsewhere" : p.kind, steer: p.kind === "prompt" ? steer : undefined });
			}
			this.dirty.add(tab);
			return;
		}

		if (kind === "started" && p.depth === 0) {
			// A top-level task: ours (sent from a tab) or someone else's in a conversation a tab shows.
			const tab = this.tabFor(p) ?? this.tabs.find((t) => t.kind === "chat" && t.agent === p.agent && t.session === p.session);
			if (!tab) {
				// An event woke the agent in a conversation nobody is looking at: say so where that agent is on screen.
				const home = p.kind === "event" ? this.tabs.find((t) => t.kind === "chat" && t.agent === p.agent) : undefined;
				if (home) {
					home.note(`An event woke ${p.agent} in the conversation ${p.session}.`, "warn", { action: { label: "Open", run: () => void this.openTab(p.agent, String(p.session)) } });
					this.dirty.add(home);
				}
				void this.refreshConversations(p.agent);
				return;
			}
			const i = tab.awaiting.findIndex((x) => ownMessage(p.prompt, x));
			if (i >= 0) {
				tab.awaiting.splice(i, 1);
				// It waited behind work that was just stopped: the next stop is not meant for it.
				if (tab.stopped && tab.stopped.waiting > 0 && Date.now() - tab.stopped.at < STOP_GRACE) {
					tab.stopped.waiting--;
					tab.stopped.spared.add(p.task);
				}
			} else if (p.compact) tab.note("Shortening the conversation: the earlier part becomes a summary…");
			else if (p.requeued) {
				if (tab.stopped && Date.now() - tab.stopped.at < STOP_GRACE) tab.stopped.spared.add(p.task);
			} else if (!tab.roots.has(p.task)) {
				if (p.kind === "event" && p.label) tab.add({ t: "event", label: String(p.label), body: eventBody(String(p.prompt ?? "")) });
				// A round of a goal was announced by the goal's own line; its text is the same every round.
				else if (!isGoalRound(p.kind, p.label)) tab.add({ t: "user", ...ownerText(p), from: p.kind === "prompt" ? "elsewhere" : p.kind });
				// What came with it and was not typed here: a photo sent on Telegram, a picture a camera saved.
				for (let n = 0; n < Number(p.images ?? 0); n++) tab.add({ t: "media", kind: "image", name: `picture ${n + 1}`, url: media.task(p.task, n) });
			}
			tab.roots.add(p.task);
			tab.running.add(p.task);
			if (tab.running.size === 1) {
				tab.startedAt = Date.now();
				tab.toolCalls = 0;
				tab.tokens = { input: 0, output: 0, cached: 0 };
			}
			this.dirty.add(tab).add(this);
			return;
		}
		const tab = this.tabFor(p);
		if (tab) this.live(tab, kind, p, p.depth ?? 0);
	}

	/**
	 * A conversation was changed by another hand than this window's: the main agent opened or
	 * closed a tab, renamed a conversation, removed or pinned one, or it was given another folder
	 * or a worktree in a terminal UI. The tabs follow. A tab that is opened this way never takes
	 * the place of the one the owner is in.
	 */
	private async followed(p: any): Promise<void> {
		const agent = String(p.agent ?? "");
		const session = String(p.session ?? "");
		const showing = this.tabs.filter((t) => t.kind === "chat" && t.agent === agent && t.session === session);
		if (p.change === "open") {
			if (!showing.length) await this.openTab(agent, session || "main", false);
		} else if (p.change === "close") {
			for (const t of showing) this.closeTab(t);
		} else if (p.change === "rename" && typeof p.to === "string") {
			for (const t of showing) ((t.session = p.to), t.touch());
			if (showing.length) this.saveTabs();
		} else if (p.change === "remove") this.dropTabs(agent, session);
		// Its folder was changed, or a worktree made or discarded, elsewhere (a terminal UI): the chip and the side bar say where it works now.
		else if (p.change === "folder") return void (await this.followWorktree(agent, session), this.touch());
		void this.refreshConversations(agent);
		this.touch();
	}

	private swarmEvent(p: any): void {
		for (const tab of this.tabs) {
			if (tab.kind !== "chat" || tab.agent !== p.agent || tab.session !== p.session) continue;
			tab.swarm = p.event === "cleared" ? undefined : (p as SwarmInfo);
			tab.add({ t: "swarm", swarm: p as SwarmInfo });
			if (tab !== this.active) tab.unread = true;
			this.dirty.add(tab).add(this);
		}
	}

	private goalEvent(p: any): void {
		for (const tab of this.tabs) {
			if (tab.kind !== "chat" || tab.agent !== p.agent || tab.session !== p.session) continue;
			tab.goal = p.event === "cleared" ? undefined : (p as GoalInfo);
			tab.add({ t: "goal", goal: p as GoalInfo });
			if (tab !== this.active) tab.unread = true;
			this.dirty.add(tab).add(this);
		}
	}

	/** The work of the turn that is going on: one block for as long as nothing else comes in between. */
	private workOf(tab: Tab): Of<"work"> {
		if (tab.work && tab.items.at(-1) === tab.work) return tab.work;
		this.endWork(tab);
		tab.work = tab.add({ t: "work", parts: [], done: false, open: false, startedAt: Date.now() });
		return tab.work;
	}

	private endWork(tab: Tab): void {
		if (tab.work) {
			tab.work.done = true;
			tab.work.ms = Date.now() - tab.work.startedAt;
			tab.work.v++;
		}
		tab.work = tab.said = undefined;
	}

	/** Something an agent did on the way to its answer joins the turn's work. */
	private did(tab: Tab, part: Part): void {
		const work = this.workOf(tab);
		work.parts.push(part);
		this.holders.set(part, work);
		work.v++;
	}

	/**
	 * The group of work each line stands in. A line can change after its group was closed (an approval or the
	 * list of steps came between a call and its end), and it is that group that has to be drawn again, not the
	 * tab's current one: a call would go on pulsing after it ended.
	 */
	private holders = new WeakMap<Part, Of<"work">>();
	private redraw(part: Part | undefined): void {
		const work = part && this.holders.get(part);
		if (work) work.v++;
	}

	/** A task goes on working after it wrote something: those words were not its answer, and join the work. */
	private foldWords(tab: Tab, task: number): void {
		const said = tab.said;
		if (tab.kind !== "chat" || said?.task !== task) return;
		tab.said = undefined;
		// Only where nothing came after them.
		if (tab.items.at(-1) !== said.item) return;
		tab.items.pop();
		tab.answers.delete(task);
		this.did(tab, { p: "words", text: said.item.text });
	}

	private endAnswer(tab: Tab, task: number): void {
		const item = tab.answers.get(task);
		if (item) {
			item.live = false;
			item.v++;
		}
		tab.answers.delete(task);
	}

	private endThought(tab: Tab, task: number, ms?: number): void {
		const part = tab.thoughts.get(task);
		if (!part) return;
		part.done = true;
		part.ms = ms ?? Date.now() - part.startedAt;
		tab.lastThought = { task, part };
		tab.thoughts.delete(task);
		this.redraw(part);
	}

	private showSteps(tab: Tab, task: number, items: Todo[]): void {
		if (!items.length) return void (tab.steps = undefined);
		if (tab.steps?.task === task && tab.items.includes(tab.steps)) {
			tab.steps.items = items;
			tab.steps.v++;
		} else {
			this.endWork(tab);
			tab.steps = tab.add({ t: "steps", task, items });
		}
	}

	private takeStats(tab: Tab, stats: Stats | undefined): void {
		if (!stats) return;
		if (stats.context?.percent !== undefined) tab.context = stats.context.percent;
		const total = stats.input + (stats.cached ?? 0);
		// Shown once the server has reported cached input at least once; a permanent "0%" would say something that is not known.
		if (total > 0 && (stats.cached || tab.cacheShare !== undefined)) tab.cacheShare = Math.round((100 * (stats.cached ?? 0)) / total);
		const speed = speedOf(stats.timing);
		if (speed.read || speed.write) tab.speed = speed;
	}

	/** One live event of a task in a tab. `depth` is counted from what the tab shows: 0 is its own task. */
	private live(tab: Tab, kind: string, p: any, depth: number): void {
		this.dirty.add(tab);
		switch (kind) {
			case "started":
				if (depth <= 0) {
					tab.running.add(p.task);
					tab.startedAt = Date.now();
					break;
				}
				tab.children.set(p.task, { agent: p.agent, kind: p.kind, label: short(oneLine(String(p.label ?? p.prompt ?? "")), 60), running: true });
				this.did(tab, { p: "child", task: p.task, agent: p.agent, kind: p.kind, label: short(oneLine(String(p.label ?? p.prompt ?? "")), 120), status: "run", depth });
				break;
			case "thinking": {
				if (p.phase === "end") {
					tab.thinking = false;
					this.endThought(tab, p.task, p.ms);
					break;
				}
				tab.thinking = true;
				if (depth > 0 || !p.text) break; // a child's thoughts stay with the child, like its prose
				let thought = tab.thoughts.get(p.task);
				if (!thought) {
					this.foldWords(tab, p.task);
					thought = { p: "thought", text: "", done: false, startedAt: Date.now() };
					tab.thoughts.set(p.task, thought);
					this.did(tab, thought);
				}
				thought.text += p.text;
				this.redraw(thought);
				break;
			}
			case "todos":
				this.showSteps(tab, p.task, Array.isArray(p.items) ? p.items : []);
				break;
			case "delta": {
				tab.thinking = false;
				this.endThought(tab, p.task);
				if (depth > 0) break; // a child's prose stays with the child; its answer reaches the parent as a tool result
				let item = tab.answers.get(p.task);
				if (!item) {
					item = tab.add({ t: "answer", task: p.task, agent: p.agent ?? tab.agent, text: "", live: true });
					tab.answers.set(p.task, item);
					tab.said = { task: p.task, item };
				}
				item.text += p.text;
				item.v++;
				break;
			}
			case "message": {
				this.endThought(tab, p.task);
				const item = tab.answers.get(p.task);
				if (item) {
					if (depth === 0) tab.lastAnswer = item.text;
					tab.streamed.add(p.task);
					// A sound that arrives while you are looking is played; one from earlier waits for a click.
					if (tab === this.active) item.arrived = { heard: false };
				}
				this.endAnswer(tab, p.task);
				if (depth === 0) {
					tab.tokens = { input: p.input ?? 0, output: p.output ?? 0, cached: p.cached ?? 0 };
					if (p.context?.percent !== undefined) tab.context = p.context.percent;
					if (p.speed && (p.speed.read || p.speed.write)) tab.speed = p.speed;
				}
				const ended = tab.lastThought;
				if (ended && ended.task === p.task) {
					if (depth === 0) ended.part.speed = speedText(p.speed);
					tab.lastThought = undefined;
					this.redraw(ended.part);
				}
				this.dirty.add(this);
				break;
			}
			case "tool": {
				tab.thinking = false;
				this.endThought(tab, p.task);
				this.endAnswer(tab, p.task);
				tab.streamed.delete(p.task);
				const key = `${p.task}:${p.call}`;
				if (p.phase === "start") {
					// The agent wants its owner to see the browser: it is in the aside at the right of the window.
					if (/(^|_)browser_show$/.test(String(p.tool)) && tab === this.active && depth === 0) this.open("aside");
					tab.toolCalls++;
					if (depth === 0) this.foldWords(tab, p.task);
					const part: Extract<Part, { p: "tool" }> = { p: "tool", key, tool: p.tool, subject: p.subject ? short(oneLine(String(p.subject)), 200) : undefined, status: "run", depth };
					tab.tools.set(key, part);
					this.did(tab, part);
				} else {
					let part = tab.tools.get(key);
					// A call that began before this tab was opened has no line of its own yet.
					if (!part) {
						part = { p: "tool", key, tool: p.tool, subject: p.subject ? short(oneLine(String(p.subject)), 200) : undefined, status: "run", depth };
						this.did(tab, part);
					}
					part.status = p.ok ? "ok" : "fail";
					part.ms = p.ms;
					if (!p.ok) part.preview = short(oneLine(String(p.preview ?? "")), 240);
					tab.tools.delete(key);
					this.redraw(part);
					const images = (p.images ?? []) as string[];
					if (images.length) {
						// A picture a tool returned is for the owner: it stands where it happened, not folded away.
						this.endWork(tab);
						for (const id of images) tab.add({ t: "media", kind: "image", name: `from ${p.tool}`, url: media.tool(id) });
					}
					tab.codeTick++;
				}
				break;
			}
			case "done":
			case "failed": {
				const item = tab.answers.get(p.task);
				this.endAnswer(tab, p.task);
				this.endThought(tab, p.task);
				if (depth > 0) {
					const child = tab.children.get(p.task);
					if (child) child.running = false;
					const n = p.stats?.tools?.length ?? 0;
					const what = childKind(p.kind ?? child?.kind ?? "task");
					const how = p.status === "done" ? `answered (${took(p.stats?.ms ?? 0)}${n ? `, ${plural(n, "tool call")}` : ""})` : `${p.status}${p.error ? `: ${p.error}` : ""}`;
					// (In whichever group it stands: an approval may have closed the one it was started in.)
					let part: Extract<Part, { p: "child" }> | undefined;
					for (let i = tab.items.length - 1; i >= 0 && !part; i--) {
						const it = tab.items[i];
						if (it.t === "work") part = it.parts.find((x) => x.p === "child" && x.task === p.task) as Extract<Part, { p: "child" }> | undefined;
					}
					if (part) {
						part.status = p.status;
						part.how = how;
						this.redraw(part);
					} else this.did(tab, { p: "child", task: p.task, agent: p.agent, kind: what, label: child?.label ?? "", status: p.status, how, depth });
					// A sub-agent that worked after its conversation's turn (the check of a swarm's answer, which pine starts
					// itself, or a pool's sub-agent that outlived the turn): no end of a turn follows that would close the group.
					if (!tab.busy && ![...tab.children.values()].some((c) => c.running)) this.endWork(tab);
					break;
				}
				tab.running.delete(p.task);
				// A message steered into that work and not read is not waiting for it any more: its line goes.
				for (const it of tab.items) if (it.t === "user" && it.steer && it.steer.into === p.task && !it.steer.read) it.v++;
				tab.thinking = false;
				if (!tab.busy) this.endWork(tab);
				this.takeStats(tab, p.stats);
				if (tab === this.active) void this.pollPrograms();
				if (p.status !== "cancelled" && !tab.busy) this.attention("Pine", `${tab.agent} ${p.status === "done" ? "is done" : "stopped with an error"}`, tab);
				if (p.status === "done") {
					// Streaming normally showed the answer already; this covers a missed stream.
					if (p.text) tab.lastAnswer = p.text;
					if (!item && !tab.streamed.has(p.task) && p.text) tab.add({ t: "answer", task: p.task, agent: p.agent ?? tab.agent, text: p.text, live: false, ...(tab === this.active ? { arrived: { heard: false } } : {}) });
				} else if (p.status === "cancelled") tab.note("Stopped");
				else if (p.status === "failed") this.failed(tab, p.error);
				else tab.note(`${p.status}${p.error && p.error !== p.status ? `: ${p.error}` : ""}`, "bad");
				tab.streamed.delete(p.task);
				if (tab.kind === "task") tab.add({ t: "divider", text: taskSummary(p.status, p.stats) });
				else void this.refreshTaints();
				tab.codeTick++;
				this.dirty.add(this);
				void this.refreshConversations(tab.agent);
				break;
			}
		}
		if (tab !== this.active) {
			if (!tab.unread) this.dirty.add(this);
			tab.unread = true;
		}
	}
}

export const store = new Store();

/**
 * Do something when it is asked for by name (a menu item that only one part of the page can
 * carry out). Each part hears every asking once, whatever the others do with it; what was asked
 * before the part was there is not replayed.
 */
export function useSignal(name: string, run: () => void): void {
	const signal = useModel(store.signal);
	const seen = useRef(signal.v);
	const live = useRef(run);
	live.current = run;
	useEffect(() => {
		if (signal.v !== seen.current && store.lastSignal === name) live.current();
		seen.current = signal.v;
	}, [signal.v, name]);
}
