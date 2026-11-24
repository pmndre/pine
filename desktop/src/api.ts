// The control API, typed. Every call goes through the main process, which holds the token.
import { bridge, MEDIA_BASE } from "./bridge.ts";
import type { ThemeEntry } from "./theme.ts";
import type { SentQuote } from "../../src/quotes.ts";

export class ApiError extends Error {
	status: number;
	data: any;
	constructor(status: number, data: any) {
		// An address the daemon does not have at all is one a newer pine has: the app attached to an older one.
		super(status === 404 && (data?.error === "not found" || typeof data?.error !== "string") ? "This pine does not know that yet: it is older than the app. Update pine and restart it." : typeof data?.error === "string" ? data.error : `HTTP ${status}`);
		this.status = status;
		this.data = data;
	}
}

async function call<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
	const r = await bridge.call(method, url, body);
	if (!r.ok) throw new ApiError(r.status, r.data);
	return r.data as T;
}

const get = <T>(url: string) => call<T>("GET", url);
/** A file's bytes, which the main process hands on as base64. */
export const bytesOf = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
const post = <T>(url: string, body: unknown = {}) => call<T>("POST", url, body);
const e = encodeURIComponent;
const qs = (o: Record<string, string | number | undefined>) => {
	const parts = Object.entries(o).filter(([, v]) => v !== undefined && v !== "");
	return parts.length ? `?${parts.map(([k, v]) => `${k}=${e(String(v))}`).join("&")}` : "";
};

// ---- what the daemon hands out -------------------------------------------------------------------

export type Trust = "owner" | "untrusted";

export interface PineEvent {
	id: number;
	ts: number;
	topic: string;
	source: string;
	payload: any;
	trust: Trust;
}

export interface Stats {
	input: number;
	output: number;
	cached?: number;
	turns: number;
	tools: string[];
	ms: number;
	context?: { percent?: number; window: number; tokens?: number };
	timing?: { readTokens: number; readMs: number; writeTokens: number; writeMs: number };
}

export interface Task {
	id: number;
	agent: string;
	session: string;
	kind: "event" | "prompt" | "delegate" | "subagent" | "notify";
	prompt: string;
	status: "pending" | "running" | "done" | "failed" | "cancelled";
	created: number;
	started?: number;
	finished?: number;
	result?: string;
	error?: string;
	parent?: number;
	depth: number;
	meta: { images?: unknown[]; label?: string; steered?: number; read?: number; compact?: boolean; chain?: string[]; stats?: Stats; trust?: string; quotes?: SentQuote[]; body?: string };
}

export interface TranscriptEntry {
	kind: "user" | "text" | "thinking" | "tool";
	text?: string;
	tool?: string;
	subject?: string;
	ok?: boolean;
	images?: string[];
	ms?: number;
	result?: string;
}

export interface AgentInfo {
	id: string;
	main: boolean;
	/** What it is for: the first paragraph of its AGENTS.md (or, in an older home, `description` in its agent.json). */
	description: string;
	/** Its own color (`#rrggbb`), where it has one: the source of its avatar's scheme. */
	color?: string;
	workspace: string;
	model: string;
	mode: Mode;
	thinking: string;
	delegates: string[];
	/** Why its model cannot answer, where the daemon can tell: no sign-in, or the stand-in's command is missing. */
	modelProblem?: string;
}

export type Mode = "manual" | "safe" | "auto" | "bypass" | "plan";

export interface Conversation {
	session: string;
	tasks: number;
	last: number;
	pinned: boolean;
	open: boolean;
	expires?: number;
	folder?: string;
	/** A branch: the conversation it was made from, and after which message of the owner's. */
	branch?: { from: string; at?: number };
	/** The worktree it works in: a checkout of its own of its folder's repository, on a branch pine/<name>. */
	worktree?: { branch: string; base: string; path: string; repo: string };
	/** The group of the agent's conversations it is in. A branch is in its original's. */
	group?: string;
}

/** An agent's groups of conversations, empty ones too, and how its list is sorted. */
export interface GroupList {
	order: "recent" | "name";
	groups: Array<{ name: string; conversations: number }>;
}

/** What removing a group took with it: its conversations (the main one stays) and what was set up for them. */
export interface GroupRemoved {
	group: string;
	removed: string[];
	kept: string[];
	unsubscribed: string[];
	sources: string[];
	servers: string[];
	worktrees: string[];
}

/** A conversation's worktree and where it stands against what it was made from. */
export interface WorktreeInfo {
	branch: string;
	base: string;
	path: string;
	repo: string;
	ahead: number;
	behind: number;
	dirty: number;
	merged: boolean;
	mergeable: boolean;
	gone?: boolean;
}

export interface WorktreeMade {
	folder?: string;
	branch: string;
	path: string;
	base?: string;
	copied: string[];
}

/** The swarm of a conversation, as the daemon keeps it (src/swarm.ts in pine). */
export interface SwarmInfo {
	agent: string;
	session: string;
	objective: string;
	status: "active" | "waiting" | "done" | "paused" | "limit";
	round: number;
	until: number;
	/** The sub-agent that checks the answer right now. */
	checking?: number;
	note: string;
	event?: string;
}

export interface GoalInfo {
	agent: string;
	session: string;
	objective: string;
	status: "active" | "paused" | "met" | "blocked" | "limit";
	round: number;
	until: number;
	note: string;
	reason?: string;
	event?: string;
}

export interface Approval {
	id: string;
	agent: string;
	task: number;
	root?: number;
	tool: string;
	summary: string;
	why: string;
	expires: number;
	remember?: string;
	holds?: string;
	inputs?: Array<{ name: string; label: string; secret?: boolean }>;
	choices?: string[];
}

export interface Todo {
	text: string;
	status: "pending" | "in_progress" | "done";
}

/** A board (docs/references/boards.md): whom it is for, and how many tasks on it are in which state. */
export interface BoardBrief {
	id: number;
	scope: "local" | "agent" | "global";
	agent: string;
	session: string;
	name: string;
	counts: { open: number; taken: number; done: number; failed: number; blocked: number; notes: number };
}

/** A task or a note of a board. Its text is an agent's (or the owner's) and is drawn as plain text. */
export interface BoardItem {
	id: number;
	kind: "task" | "note";
	text: string;
	data?: Record<string, unknown>;
	state: "open" | "taken" | "done" | "failed" | "blocked" | "";
	by: string;
	holder?: string;
	run?: number;
	/** A sub-agent has it. */
	sub: boolean;
	result?: string;
	after: number[];
	/** The tasks an open task still waits for. */
	waits: number[];
	about?: number;
	/** It was written by a run that had read outside content. */
	outside: boolean;
	created: number;
	updated: number;
}

export interface BoardView {
	board: BoardBrief;
	tasks: BoardItem[];
	notes: BoardItem[];
}

export interface Program {
	id: number;
	command: string;
	processes: number;
	ports: number[];
	seconds: number;
	background?: boolean;
	output?: string;
}

export interface Change {
	path: string;
	status: string;
	added?: number;
	removed?: number;
}

export interface UndoResult {
	task: number;
	prompt: string;
	quotes?: SentQuote[];
	body?: string;
	stopped: number;
	waiting?: boolean;
	restored?: { root: string; changed: number; removed: number; back: number; files: string[]; left: string[] };
	note?: string;
	redo: number;
	more: boolean;
}

export interface SourceInfo {
	name: string;
	scope: string;
	type: string;
	description?: string;
	trust: string;
	running: boolean;
	error?: string;
	status?: string;
	subscribers: string[];
	topic: string;
	last?: { ts: number; topic: string };
	events: number;
}

export interface McpServer {
	name: string;
	scope: string;
	session?: string;
	agents: string[];
	target: string;
	remote: boolean;
	taints: boolean;
	approve: string;
	enabled: boolean;
}

export interface Setting {
	key: string;
	/** A few words that name it. (A pine older than the app has none: the key stands in.) */
	title?: string;
	about: string;
	kind: "model" | "theme" | "boolean" | "duration" | { one: string[] } | { from: number; to: number };
	now: string;
	live: boolean;
}

export interface AgentDetail {
	id: string;
	main: boolean;
	description: string;
	color?: string;
	workspace: string;
	dir: string;
	model?: string;
	defaultModel?: string;
	thinking: string;
	mode: Mode;
	tools: string[];
	allTools: string[];
	delegates: string[];
	network: boolean;
	read: string[];
	write: string[];
	holdings: { conversations: string[]; sources: string[]; servers: string[]; schedules: string[]; skills: string[]; routes: string[]; files: number; outside: boolean };
	files: { instructions?: string; soul?: string; tooling?: string; memory?: string; rules?: string };
}

export interface Skill {
	name: string;
	description: string;
	scope: "local" | "agent" | "global";
	dir: string;
	managed: boolean;
	agent?: string;
	session?: string;
	instructions?: string;
}

export interface Schedule {
	name: string;
	scope: string;
	session?: string;
	when: string;
	task?: string;
	next?: number;
	topic: string;
}

export interface Route {
	name: string;
	on: string[];
	when?: Record<string, unknown>;
	throttleMs?: number;
	debounceMs?: number;
	agent?: string;
	prompt?: string;
	session?: string;
	set?: Record<string, unknown>;
	publish?: { topic: string; payload?: unknown };
	call?: { prompt: string; system?: string; model?: string };
	trust?: string;
}

export interface SourceType {
	name: string;
	summary: string;
	options: { properties?: Record<string, any>; required?: string[] };
	own: boolean;
}

export interface ModelServer {
	name: string;
	baseUrl: string;
	key: string;
	/** `limit`: how many runs that model takes at a time, where it has a number of its own. */
	models: Array<{ id: string; contextWindow?: number; images: boolean; reasoning: boolean; limit?: number }>;
	/** What holds for a model that has no number of its own: pine's limit for all. */
	runs?: number;
}

export interface Provider {
	id: string;
	name?: string;
	signedIn: boolean;
	models: number;
	oauth: boolean;
}

export interface LoginState {
	lines: string[];
	url?: string;
	code?: string;
	question?: { message: string; secret: boolean; options?: Array<{ id: string; label: string; description?: string }> };
	done: boolean;
	error?: string;
	models?: string[];
	/** The model the agents run on from now on: pine chose it, since the one before could not answer. */
	chosen?: string;
}

export interface Overview {
	version: string;
	home: string;
	main: string;
	platform: string;
	sandbox: boolean;
	/** Whether the browser build this pine drives is on the computer. Not said when pine could not tell. */
	browser?: boolean;
	warnings: string[];
	modelNotes: string[];
	log: string;
}

export interface Status {
	limiter: Record<string, unknown>;
	running: Array<{ task: number; agent: string; session: string; kind: string }>;
	sessions: Array<{ agent: string; session: string; busy: boolean; tainted?: string; trust: string; mode: string; context?: { percent?: number } }>;
	modes: Record<string, Mode>;
	agents: string[];
	approvals: number;
	bypassWhenTainted: boolean;
}

// ---- the calls -----------------------------------------------------------------------------------

const a = (agent: string) => `/agents/${e(agent)}`;
const s = (session: string) => `?session=${e(session)}`;

export const api = {
	get,
	post,
	agents: () => get<AgentInfo[]>("/agents"),
	status: () => get<Status>("/status"),
	models: () => get<string[]>("/models"),
	sessions: (agent: string) => get<Conversation[]>(`${a(agent)}/sessions`),
	removeSession: (agent: string, session: string) => post<{ removed: boolean; unsubscribed: string[]; sources: string[]; servers: string[] }>(`${a(agent)}/remove`, { session }),
	renameSession: (agent: string, session: string, to: string) => post<{ session: string }>(`${a(agent)}/rename`, { session, to }),
	pinSession: (agent: string, session: string, pinned: boolean) => post<{ pinned: boolean }>(`${a(agent)}/pin`, { session, pinned }),
	// Groups of an agent's conversations. A pine older than groups has none: an empty list.
	groups: (agent: string) => get<GroupList>(`${a(agent)}/groups`).catch((): GroupList => ({ order: "recent", groups: [] })),
	setGroup: (agent: string, session: string, group: string | null) => post<{ session: string; group?: string; moved: string[] }>(`${a(agent)}/group`, { session, group }),
	addGroup: (agent: string, name: string) => post<{ group: string }>(`${a(agent)}/groups`, { action: "add", name }),
	renameGroup: (agent: string, name: string, to: string) => post<{ group: string }>(`${a(agent)}/groups`, { action: "rename", name, to }),
	removeGroup: (agent: string, name: string) => post<GroupRemoved>(`${a(agent)}/groups`, { action: "remove", name }),
	sortConversations: (agent: string, order: "recent" | "name") => post<{ order: string }>(`${a(agent)}/groups`, { action: "order", to: order }),
	closeSession: (agent: string, session: string) => post<{ unsubscribed: string[] }>(`${a(agent)}/close`, { session }),
	folder: (agent: string, session: string) => get<{ folder?: string; workspace: string }>(`${a(agent)}/folder${s(session)}`),
	folders: (agent: string) => get<Array<{ session: string; folder: string }>>(`${a(agent)}/folders`),
	setFolder: (agent: string, session: string, folder: string | null) => post<{ folder?: string }>(`${a(agent)}/folder`, { session, folder }),
	programs: (agent: string, session: string) => get<Program[]>(`${a(agent)}/programs${s(session)}`),
	/** The browser of a conversation, for the panel beside it: where it is, what the owner does in it, an address the owner opens. */
	browser: (agent: string, session: string) => get<BrowserState>(`${a(agent)}/browser${s(session)}`),
	browserInput: (agent: string, session: string, ops: unknown[]) => post<BrowserState>(`${a(agent)}/browser/input`, { session, ops }),
	browserOpen: (agent: string, session: string, url: string) => post<BrowserState>(`${a(agent)}/browser/open`, { session, url }),
	/** This app shows the browser itself: said again and again, so that the agent's browser opens no window of its own. */
	browserEmbedded: () => post<{ ok: boolean }>("/browser/embedded"),
	/** A command of an answer that the owner ran in the app's terminal is still running, or has ended: the conversation is told. */
	terminalRun: (agent: string, session: string, report: { command: string; state: "running" | "ended"; code?: number; seconds: number; output: string }) => post<{ task: number }>(`${a(agent)}/terminal`, { session, ...report }),
	stopProgram: (agent: string, session: string, id: number) => post<{ stopped: boolean }>(`${a(agent)}/programs/stop`, { session, id }),
	swarm: (agent: string, session: string) => get<{ swarm?: SwarmInfo }>(`${a(agent)}/swarm${s(session)}`),
	setSwarm: (agent: string, session: string, what: { objective: string } | { action: "pause" | "resume" | "clear" }) => post<{ swarm?: SwarmInfo; cleared?: boolean }>(`${a(agent)}/swarm`, { session, ...what }),
	goal: (agent: string, session: string) => get<{ goal?: GoalInfo }>(`${a(agent)}/goal${s(session)}`),
	setGoal: (agent: string, session: string, what: { objective: string } | { action: "pause" | "resume" | "clear" }) => post<{ goal?: GoalInfo; cleared?: boolean }>(`${a(agent)}/goal`, { session, ...what }),
	todos: (agent: string, session: string) => get<Todo[]>(`${a(agent)}/todos${s(session)}`),
	/** Boards: those a conversation can use (its own first), one with everything on it, and the owner's hand on it. */
	boards: (agent: string, session: string) => get<BoardBrief[]>(`${a(agent)}/boards${s(session)}`),
	board: (id: number) => get<BoardView>(`/boards/${id}`),
	/** Every board, with the runs that hold one of its tasks: for the view of all of pine. */
	allBoards: () => get<Array<BoardBrief & { runs: number[] }>>("/boards"),
	boardPost: (where: number | { agent: string; session: string }, text: string, kind: "task" | "note" = "task") =>
		typeof where === "number" ? post<{ board: number; id: number }>(`/boards/${where}/post`, { text, kind }) : post<{ board: number; id: number }>(`${a(where.agent)}/boards/post`, { session: where.session, text, kind }),
	boardAct: (item: number, action: "reopen" | "answer" | "done" | "remove", text?: string) => post<{ ok: boolean }>(`/boards/items/${item}`, { action, text }),
	boardRemove: (id: number) => post<{ removed: boolean }>(`/boards/${id}/remove`),
	history: (agent: string, session: string, limit = 40) => get<Task[]>(`/tasks${qs({ agent, session, limit })}`),
	tasks: (agent?: string, limit = 50) => get<Task[]>(`/tasks${qs({ agent, limit })}`),
	/** One task, as the daemon has it on record. */
	taskRecord: (task: number) => get<Task>(`/tasks/${task}`),
	// `via`: the answer is read in this app, where a shell code block has a Run button; the agent is told so. The button runs it
	// in a terminal of this computer, so an agent of another machine's pine is not told (`runs`: false): it has no terminal here.
	prompt: (agent: string, prompt: string, session: string, attachments?: Array<{ name: string; data: string }>, whenBusy: "steer" | "queue" = "steer", mentions?: string[], quotes?: SentQuote[], runs = true) => post<{ task: number; steered?: number }>(`${a(agent)}/prompt`, { prompt, session, wait: false, attachments, whenBusy, mentions, quotes, ...(runs ? { via: "app" } : {}) }),
	transcript: (task: number, full = false) => get<{ task: Task; entries: TranscriptEntry[] }>(`/tasks/${task}/transcript${full ? "?full=1" : ""}`),
	cancel: (task: number) => post<{ cancelled: boolean }>(`/tasks/${task}/cancel`),
	sendNow: (task: number) => post<{ sent: boolean }>(`/tasks/${task}/now`),
	reset: (agent: string, session: string) => post<{ reset: boolean }>(`${a(agent)}/reset`, { session }),
	compact: (agent: string, session: string) => post<{ task: number }>(`${a(agent)}/compact`, { session }),
	undo: (agent: string, session: string) => post<UndoResult>(`${a(agent)}/undo`, { session }),
	redo: (agent: string, session: string) => post<UndoResult>(`${a(agent)}/redo`, { session }),
	/** A new conversation that goes on from message `at` of this one (without it: from all of it). */
	branch: (agent: string, session: string, at?: number, worktree = false) => post<{ session: string; tasks: number; outside?: string; worktree?: WorktreeMade }>(`${a(agent)}/branch`, { session, ...(at !== undefined ? { at } : {}), ...(worktree ? { worktree } : {}) }),
	/** A conversation's worktree: where it stands; make one; merge it into its base; bring its base in; discard it. */
	worktree: (agent: string, session: string) => get<{ worktree: WorktreeInfo | null }>(`${a(agent)}/worktree${s(session)}`),
	makeWorktree: (agent: string, session: string, name?: string) => post<WorktreeMade>(`${a(agent)}/worktree`, { session, ...(name ? { name } : {}) }),
	mergeWorktree: (agent: string, session: string, how: "merge" | "squash" = "merge") => post<{ how: string; commit: string; commits: number; updated?: string }>(`${a(agent)}/worktree/merge`, { session, how }),
	updateWorktree: (agent: string, session: string) => post<{ merged: number } | { conflicts: string[] }>(`${a(agent)}/worktree/update`, { session }),
	discardWorktree: (agent: string, session: string, keepBranch = false) => post<{ folder?: string }>(`${a(agent)}/worktree/remove`, { session, keepBranch }),
	setThinking: (agent: string, level: string) => post<{ level: string }>(`${a(agent)}/thinking`, { level }),
	setMode: (agent: string, mode: string, anyway?: string) => post<{ mode: string }>(`${a(agent)}/mode`, { mode, session: anyway, anyway: anyway !== undefined }),
	setModel: (agent: string, model: string) => post<{ model: string }>(`${a(agent)}/model`, { model }),
	approvals: () => get<Approval[]>("/approvals"),
	decide: (id: string, allow: boolean, always = false, values?: Record<string, string>) => post<{ decided: boolean }>(`/approvals/${e(id)}`, { allow, always, values }),
	tabs: () => get<{ tabs: Array<{ agent: string; session: string }>; active: number; code?: boolean; notify?: boolean }>("/ui/tabs"),
	saveTabs: (tabs: Array<{ agent: string; session: string }>, active: number, code: boolean) => post<{ ok: boolean }>("/ui/tabs", { tabs, active, code }),
	events: (topic?: string, limit = 200) => get<PineEvent[]>(`/events${qs({ topic, limit })}`),
	emit: (topic: string, payload: unknown) => post<{ id: number }>("/events", { topic, payload }),
	state: (pattern = "#") => get<Array<{ key: string; value: unknown; ts?: number; source?: string }>>(`/state?key=${e(pattern)}`),
	setState: (key: string, value: unknown) => post<{ ok: boolean }>("/state", { key, value }),

	// the folder a conversation works in
	changes: (agent: string, session: string) => get<{ root: string; repo: boolean; branch?: string; worktree?: { branch: string; base: string; ahead: number; behind: number; dirty: number; merged: boolean }; files: Change[]; more: boolean }>(`${a(agent)}/view/changes${s(session)}`),
	diff: (agent: string, session: string, file: string) => get<{ diff: string; truncated: boolean }>(`${a(agent)}/view/diff${s(session)}&path=${e(file)}`),
	tree: (agent: string, session: string, dir: string) => get<{ entries: Array<{ name: string; dir: boolean; size: number }>; more: boolean }>(`${a(agent)}/view/tree${s(session)}&path=${e(dir)}`),
	file: (agent: string, session: string, file: string) => get<{ text?: string; size: number; binary: boolean; truncated: boolean }>(`${a(agent)}/view/file${s(session)}&path=${e(file)}&max=2000000`),
	writeFile: (agent: string, session: string, file: string, text: string) => post<{ size: number }>(`${a(agent)}/view/write`, { session, path: file, text }),
	find: (agent: string, session: string, q: string) => get<{ files: string[] }>(`${a(agent)}/view/find${s(session)}&q=${e(q)}`),
	turn: (agent: string, session: string) => get<{ task?: number; prompt?: string; root?: string; files: Change[]; more: boolean; note?: string }>(`${a(agent)}/view/turn${s(session)}`),
	turnDiff: (agent: string, session: string, file: string) => get<{ diff: string; truncated: boolean }>(`${a(agent)}/view/turndiff${s(session)}&path=${e(file)}`),
	fetchImage: (url: string) => post<{ mime: string; base64: string }>("/images/fetch", { url }),
	/** A sound file of an agent's workspace as bytes: what `media.workspace` plays, for the page to measure its levels. */
	workspaceSound: async (agent: string, file: string, session?: string) => bytesOf((await get<{ mime: string; base64: string }>(`${a(agent)}/image?path=${e(file)}${session ? `&session=${e(session)}` : ""}`)).base64),

	// sources and subscriptions
	sources: () => get<SourceInfo[]>("/sources"),
	/** The sources one agent can listen to, and how a conversation of it does: on its own, as the agent, with all agents. */
	agentSources: (agent: string, session: string) => get<Array<{ name: string; type: string; description?: string; local?: { note?: string }; agent?: { note?: string; session?: string }; global?: { note?: string }; elsewhere: string[] }>>(`${a(agent)}/sources${s(session)}`),
	sourceTypes: () => get<SourceType[]>("/sources/types"),
	proposeSource: (body: { name: string; type: string; options: Record<string, unknown>; agent?: string }) => post<{ does: string[]; opens: boolean; needs: Array<{ name: string; label: string }>; owner?: boolean; tell?: string }>("/sources/propose", body),
	addSource: (body: { name: string; type: string; description: string; options: Record<string, unknown>; agent?: string; own?: boolean; values?: Record<string, string> }) => post<{ name: string; type: string; tell?: string }>("/sources", body),
	removeSource: (name: string, agent?: string) => post<{ removed: boolean; unsubscribed: string[] }>("/sources/remove", { name, agent }),
	subscribe: (agent: string, source: string, details: Record<string, unknown> = {}) => post<any>(`${a(agent)}/subscribe`, { source, ...details }),
	unsubscribe: (agent: string, source: string, session?: string) => post<{ unsubscribed: boolean; sessions: string[] }>(`${a(agent)}/unsubscribe`, { source, session }),
	subscribeAll: (source: string, details: Record<string, unknown> = {}) => post<any>("/subscribe", { source, ...details }),
	unsubscribeAll: (source: string) => post<{ unsubscribed: boolean }>("/unsubscribe", { source }),
	schedules: () => get<Schedule[]>("/schedules"),
	addSchedule: (body: { name: string; task: string; cron?: string; every?: string; at?: string; agent?: string; session?: string }) => post<Schedule>("/schedules", body),
	removeSchedule: (name: string, agent?: string) => post<{ removed: boolean }>("/schedules/remove", { name, agent }),
	routes: () => get<Route[]>("/routes"),
	addRoute: (body: Record<string, string | undefined>) => post<{ name: string; lines: string[]; wider?: string }>("/routes", body),
	removeRoute: (name: string) => post<{ removed: boolean }>("/routes/remove", { name }),

	// what the settings pages change
	overview: () => get<Overview>("/overview"),
	settings: () => get<Setting[]>("/settings"),
	setSetting: (key: string, value: unknown) => post<{ key: string; now: string; live: boolean }>("/settings", { key, value }),
	// The themes of pine's home, as colors (theme.ts), and the one in force. A pine older than themes has none: an empty list.
	themes: () => get<{ theme: string; chosen: string | null; themes: ThemeEntry[] }>("/themes"),
	/** The views of the panel (src/views.ts): the one in force, none when there is none or `ui.view` is off. */
	views: () => get<{ view: string | null; chosen: string | null; views: Array<{ id: string; problem?: string }> }>("/views"),
	/** A view's code, its types taken away: run only in the view frame (View.tsx). */
	viewCode: (id: string) => get<{ id: string; code: string } | { id: string; problem: string }>(`/views/${encodeURIComponent(id)}`),
	agentDetail: (agent: string) => get<AgentDetail>(`${a(agent)}/detail`),
	// What it is for is the first paragraph of `instructions` (the daemon's `purposeOf`).
	createAgent: (body: { id: string; instructions: string; model?: string; tools?: string[] }) => post<{ id: string; workspace: string }>("/agents", body),
	updateAgent: (agent: string, change: Record<string, unknown>) => post<{ lines: string[]; warnings: string[] }>(`${a(agent)}/update`, change),
	// Another id for an agent: its own address, with the agent's name once more ("rename" is a conversation's).
	renameAgent: (agent: string, to: string) => post<{ id: string; routes: string[]; addresses: string[]; problem?: string }>(`${a(agent)}/id`, { agent, to }),
	eraseAgent: (agent: string, keepFiles: boolean) => post<{ kept?: string; problem?: string }>(`${a(agent)}/erase`, { agent, keepFiles }),
	shared: () => get<Array<{ name: string; about: string; text: string }>>("/shared"),
	setShared: (name: string, text: string) => post<{ ok: boolean }>("/shared", { name, text }),
	skills: () => get<Skill[]>("/skills"),
	addSkill: (body: { name: string; description: string; instructions: string; agent?: string }) => post<{ name: string; dir: string; replaced: boolean }>("/skills", body),
	removeSkill: (name: string, agent?: string, session?: string) => post<{ removed: boolean }>("/skills/remove", { name, agent, session }),
	mcp: () => get<McpServer[]>("/mcp"),
	mcpStates: () => get<Record<string, string>>("/mcp/states"),
	addMcp: (name: string, server: Record<string, unknown>, agent?: string) => post<{ ok: boolean }>("/mcp", { name, server, agent }),
	removeMcp: (name: string, agent?: string) => post<{ ok: boolean }>("/mcp", { name, agent, remove: true }),
	mcpLogin: (name: string, agent?: string) => post<{ code: number; out: string }>("/mcp/login", { name, agent }),
	modelServers: () => get<ModelServer[]>("/models/servers"),
	addModelServer: (body: { name: string; url: string; key?: string; context?: number }) => post<{ models: string[]; chosen?: string }>("/models/servers", body),
	/** How many runs a model takes at a time: a number, or `null` for pine's own limit. */
	limitModel: (name: string, model: string, limit: number | null) => post<{ name: string; model: string; limit?: number; runs: number }>("/models/servers/limit", { name, model, limit }),
	removeModelServer: (name: string) => post<{ removed: boolean }>("/models/servers/remove", { name }),
	providers: () => get<Provider[]>("/models/providers"),
	login: (provider: string, type?: "api_key" | "oauth") => post<{ id: string }>("/models/login", { provider, type }),
	loginState: (id: string) => get<LoginState>(`/models/login/${e(id)}`),
	loginAnswer: (id: string, body: { answer: string } | { cancel: true }) => post<{ ok: boolean }>(`/models/login/${e(id)}`, body),
	logout: (provider: string) => post<{ ok: boolean }>("/models/logout", { provider }),
};

/** Addresses of pictures, videos and sounds the daemon serves. The main process adds the token. */
/** Where a conversation's browser is. `open`: a page is open and there is a picture of it. */
export interface BrowserState {
	open: boolean;
	tabs: Array<{ title: string; url: string }>;
	current: number;
	window: boolean;
	/** How many pixels of the picture make one point of the page: 2, as sharp as a Retina display draws. (1 from a pine before it said.) */
	scale?: number;
	/** The browser is the Pine app's own, and these are its tabs there (electron/browser-host.ts): the app lays the page itself over the panel. */
	room?: string;
	/** Why the last thing asked for was not done. */
	error?: string;
	/** The addresses the agent opened in this conversation, newest first. */
	visited?: string[];
}

export const media = {
	/** The page of a conversation's browser as a picture; `n` only makes each address a new one. */
	browser: (agent: string, session: string, n: number) => `${MEDIA_BASE}${a(agent)}/browser/frame?session=${e(session)}&n=${n}`,
	tool: (id: string) => `${MEDIA_BASE}/media/tool/${e(id)}`,
	task: (task: number, n: number) => `${MEDIA_BASE}/tasks/${task}/images/${n}`,
	workspace: (agent: string, file: string, session?: string) => `${MEDIA_BASE}${a(agent)}/image?path=${e(file)}${session ? `&session=${e(session)}` : ""}`,
};
