import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import type { ReplyTarget } from "./types.ts";
import { expandHome, parseDuration, resolvePath, type LogLevel } from "./util.ts";

/** One MCP server, in the shape of an `mcpServers` entry of pi's mcp.json, plus `agents` for global servers. */
export interface McpServerConfig {
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	url?: string;
	headers?: Record<string, string>;
	exposure?: "direct" | "codemode" | "deferred" | "hidden";
	toolExposure?: Record<string, string>;
	description?: string;
	enabled?: boolean;
	timeout?: number;
	/** Global servers only: which agents get it. Default ["*"]. */
	agents?: string[];
	/** Use a server that ships with pine ("web", "browser", "commands", "computer") instead of command/url. */
	pine?: string;
	options?: Record<string, unknown>;
	/** Its results are outside content: a session that calls it counts as tainted. */
	taints?: boolean;
	/** When calls need the owner's approval. Default "never" ("tainted" for servers flagged sensitive by the docs). */
	approve?: "never" | "tainted" | "always";
	/**
	 * A local server (`command`) that runs inside the sandbox of the agent that uses it, so that it
	 * reaches what that agent's shell reaches and no more. Written by add_mcp_server: a program an
	 * agent proposed is never run with the daemon's own rights. One the owner adds runs as they do.
	 */
	sandboxed?: boolean;
	/** An agent's own servers only: the one conversation that gets it. Written by add_mcp_server for a server added for a conversation; it is removed with that conversation. */
	session?: string;
	[key: string]: unknown;
}

/**
 * A source of outside events: a watched folder, an MQTT broker, a webhook, an FTP drop, a web
 * address, or your own module. Like an MCP server it only is there; nothing happens until an agent
 * subscribes to it. The remaining keys are the options of its type.
 */
export interface SourceConfig {
	/** A built-in type (see SOURCE_TYPES) ... */
	type?: string;
	/** ... or the path of a module whose default export is `(source) => void`. */
	use?: string;
	/** Where relative paths in the entry are resolved from. */
	base: string;
	/** One line for agents and people: what this source reports. */
	description?: string;
	/** Global sources only: the agents that may subscribe. Default: all. */
	agents?: string[];
	/** An agent's own sources only: the one conversation it was set up for. Other conversations do not see it, and it is removed with that conversation. */
	session?: string;
	/** Who its events speak for. "untrusted" (default): outside content, the subscriber wakes with its reduced tool set. "owner": your own device or schedule. */
	trust: "owner" | "untrusted";
	/** "subscribed" (default): runs only while an agent is subscribed. "always": runs from start, for routes that use its events. */
	start: "subscribed" | "always";
	enabled: boolean;
	options: Record<string, any>;
}

export const SOURCE_TYPES = ["folder", "mqtt", "webhook", "ftp", "telegram", "http", "command", "feed", "calendar", "stream", "mail", "slack", "matrix", "discord", "smtp", "syslog", "system", "presence", "modbus", "serial", "onvif"];

/**
 * The types an agent is told about with all their options, in the description of its add_source
 * tool. The others are named there with what they are for: what each takes is in the manual
 * (a part per type, made from the type's own schema) and in the answer to a call that leaves a
 * needed option out. A description that carried every option of every type would be read with
 * every request.
 */
export const EVERYDAY_TYPES = ["folder", "mqtt", "webhook", "ftp", "telegram", "http", "command"];

/** Topics only the daemon itself publishes on: the publish_event tool and route definitions refuse them. */
export const RESERVED_TOPICS = ["approval/#", "agent/#", "pine/#", "state/#", "timer/#", "board/#"];

/**
 * A subscription: one conversation of an agent listens to one source, and each event of the source
 * arrives there as a message and wakes the agent into a turn. Several conversations of the same
 * agent can listen to the same source, each with its own note.
 */
export interface SubscriptionConfig {
	source: string;
	/** What the agent wants to do when it is woken, in its own or your words. Given to it with every event. */
	note?: string;
	/** Only events that match (same filter as routes; keys such as "event" and "payload.x"). */
	when?: Record<string, unknown>;
	/** Wait for quiet, then handle only the last event. */
	debounceMs?: number;
	/** Handle one event, then ignore the source for this long. Default 10 s, so a chatty device cannot keep a model busy. */
	throttleMs: number;
	/** Whether that is the default, as opposed to something the subscription said. A source somebody writes through is not held back by the default: every message counts. */
	throttleDefault?: boolean;
	/** The conversation that listens: the one the agent subscribed in. "main" unless said otherwise ("on-<source>" with `separate`). */
	session: string;
	/**
	 * true: wake it in a conversation of its own ("on-<source>", or `session`) instead, and for a
	 * source that is not yours with the reduced tool set. For sources that carry strangers' text.
	 */
	separate: boolean;
	/** Replaces the standard text the agent is woken with. Templates as in routes. */
	prompt?: string;
}

export interface RouteConfig {
	name: string;
	on: string[];
	when?: Record<string, unknown>;
	/** Wait for this long without a new matching event, then handle only the last one. */
	debounceMs?: number;
	/** Handle the first event, then ignore matching events for this long. */
	throttleMs?: number;
	/**
	 * Without a `prompt`: show the agent the whole event, also when it has a `text`. Otherwise an
	 * event with a text is that text and nothing else, which is right for somebody writing to the
	 * agent and wrong for a report about a message (who wrote it, where, is the rest of the event).
	 */
	whole?: boolean;
	/** Template for the debounce/throttle bucket. Default: the event topic. */
	key?: string;
	/** Write world state: key template -> value template. */
	set?: Record<string, unknown>;
	/** Publish another event. With `call`, `{{result}}` holds the model's answer. */
	publish?: { topic: string; payload?: unknown };
	/** One model call without tools or history. */
	call?: { model?: string; system?: string; prompt: string };
	/** Full agent turn. */
	agent?: string;
	prompt?: string;
	session?: string;
	whenBusy?: "queue" | "steer";
	priority?: number;
	/** Where the agent's final answer goes. Default: the event's own reply target. false: nowhere. */
	reply?: ReplyTarget | false;
	/** Override the event's trust. "owner" gives events on this route the agent's full tool set. */
	trust?: "owner" | "untrusted";
	/** Text put in front of the event for the agent, outside the "this is data" frame. Set by subscriptions, not in pine.json. */
	preface?: string;
	/**
	 * Set by subscriptions: the event is delivered into the subscriber's own conversation, with its
	 * usual tools, as outside content. The conversation is marked with this reason, as it would be
	 * after reading a web page.
	 */
	taint?: string;
	/** Short line for listings and the UI. Template. */
	label?: string;
}

/**
 * Something that happens at a time: every so often, at set times, or once. With a `task` it wakes
 * an agent to do that task; without one it only publishes an event for a route to pick up.
 *
 * Like sources, servers and skills, a schedule is for all agents (pine.json), for one agent
 * (agent.json) or for one conversation of an agent (agent.json, with `session`).
 */
export interface ScheduleConfig {
	name: string;
	/** Five-field cron expression in local time. */
	cron?: string;
	/** Fixed interval such as "15m", in milliseconds. */
	every?: number;
	/** Once, at this moment (milliseconds since 1970). The schedule is removed when it has fired. */
	at?: number;
	/** What the agent is to do when it fires, written to the agent. */
	task?: string;
	/** The conversation that is woken. Leaving it out is the agent as such: its main conversation. */
	session?: string;
	topic: string;
	payload?: unknown;
	/** Fire once at startup when a cron time passed while the daemon was down. */
	catchUp: boolean;
}

export interface HookConfig {
	topic: string;
	/** Shared secret: accepted as `Authorization: Bearer <secret>` or as an HMAC-SHA256 of the body in `X-Hub-Signature-256` / `X-Signature`. */
	secret?: string;
}

/**
 * How much an agent does without asking, and whether its shell and file tools run in a sandbox.
 * One setting says both.
 * bypass: no sandbox, and nothing asks.
 * auto:   no sandbox: the owner's whole user account and the network, like the owner at the
 *         terminal. Critical actions are checked, and after outside content what sends
 *         something out.
 * safe:   in the sandbox: its own folders, and what the owner grants. Critical actions are checked.
 * manual: in the sandbox where the machine has one; every action that changes or sends something
 *         waits for approval.
 * pine's own home and code are closed to an agent in every mode. A run that outside content
 * started is held to "safe" whatever the agent's mode.
 */
export type Level = "manual" | "safe" | "auto" | "bypass";
/**
 * "plan": the agent looks, reads and asks, and changes nothing; its answer is what it would do.
 * It lies on top of a level (`AgentConfig.level`), which says how far the looking reaches.
 */
export type Mode = Level | "plan";
export const LEVELS: Level[] = ["auto", "safe", "manual", "bypass"];
export const MODES: Mode[] = [...LEVELS, "plan"];
/** Whether a level leaves the sandbox off: the owner's whole account and the network. */
export const unsandboxed = (level: Level) => level === "auto" || level === "bypass";
/** The levels from the one that asks most and reaches least to the one that asks nothing and reaches everything. */
const NARROW_TO_WIDE: Level[] = ["manual", "safe", "auto", "bypass"];
/** The stricter of an agent's level and a cap on it (a delegated run is held to its caller's level). No cap: the level. */
export const stricter = (level: Level, cap?: Level): Level => (cap && NARROW_TO_WIDE.indexOf(cap) < NARROW_TO_WIDE.indexOf(level) ? cap : level);

export interface SandboxConfig {
	/** Shell commands may open network connections. */
	network: boolean;
	/** Extra paths the agent may read / write, besides its workspace. */
	read: string[];
	write: string[];
	/** Allow the shared temp directories (/tmp and the user's temp dir). */
	sharedTmp: boolean;
	env: Record<string, string>;
}

/** What a run triggered by an untrusted event may use. */
export interface UntrustedProfile {
	tools: string[];
	mcp: string[];
	delegates: string[];
	publish: string[];
	stateWrite: boolean;
	subagents: boolean;
	/** Whether such a run has the board tools. What it posts is marked as coming from outside. */
	board: boolean;
}

export interface AgentConfig {
	id: string;
	/** pi agent dir of this agent: AGENTS.md, skills/, extensions/, settings.json, sessions/. */
	dir: string;
	description: string;
	/** Its own color in the Pine app (`#rrggbb`, lower case): the seed of its avatar's scheme. Display only. */
	color?: string;
	workspace: string;
	model?: string;
	thinking: string;
	/** Allowlist of pi built-in tools. Undefined keeps pi's default set. */
	tools?: string[];
	mcp: Record<string, McpServerConfig>;
	/** Which global MCP servers this agent gets: all that list it (true), none (false), or these names. */
	globalMcp: boolean | string[];
	/** Event sources only this agent can subscribe to. */
	sources: Record<string, SourceConfig>;
	/** What this agent's conversations are subscribed to: its own sources or global ones. */
	subscribe: SubscriptionConfig[];
	/** What this agent does at set times: for the agent as such, or (with `session`) for one conversation. */
	schedules: ScheduleConfig[];
	extensions: string[];
	skills: string[];
	/** Extra instruction files loaded into the system prompt, besides AGENTS.md in the agent dir and the workspace. */
	context: string[];
	/** Agents this one may hand tasks to. "*" means every other agent. */
	delegates: string[];
	subagents: { enabled: boolean; maxParallel: number; tools?: string[]; mcp: boolean };
	/** Topics the publish_event tool may publish to. */
	publish: string[];
	state: { read: string[]; write: string[]; inject: string[] };
	trustWorkspace: boolean;
	mode: Mode;
	/** The mode beneath "plan": what the agent had before, and what decides its sandbox while it plans. The same as `mode` otherwise. */
	level: Level;
	/** Whether somebody chose the mode (agent.json, or defaults.mode). One that nobody chose follows what the machine can do: see `levelOf` in security.ts. */
	modeSet: boolean;
	sandbox: SandboxConfig;
	/** Tool calls that always need the owner's approval: "tool" or "tool:argument-glob". */
	approve: string[];
	/** Tool calls that need approval once the session has seen outside content. */
	approveWhenTainted: string[];
	/** Profile for runs triggered by untrusted events; false refuses such runs. */
	untrusted: UntrustedProfile | false;
	bashTimeoutSec: number;
	bashDeny: string[];
	taskTimeoutSec: number;
	idleMs: number;
	settings: Record<string, unknown>;
}

export interface PineConfig {
	home: string;
	dataDir: string;
	logLevel: LogLevel;
	main?: string;
	/** `mode`: for every agent that names none. Not set: auto for the main agent, safe for the others. */
	defaults: { model?: string; /** The model that judges whether a goal is met, as "provider/id". Not set: the agent's own. */ judge?: string; /** The model that checks a swarm's answer, as "provider/id". Not set: the agent's own. */ checker?: string; /** Agents introduce themselves in their answer to the first message their owner writes to them. */ introduce: boolean; thinking: string; mode?: Mode; bashTimeoutSec: number; taskTimeoutSec: number; idleMs: number; settings: Record<string, unknown> };
	limits: {
		maxConcurrentRuns: number;
		/**
		 * Runs at a time on one model, by its whole name ("local/qwen3-coder"), where that is to be fewer or more than
		 * `maxConcurrentRuns`: a model on the owner's own computer serves one or two at once, a hosted one many, and
		 * one endpoint can serve models that are set up differently. Such a model has a queue of its own.
		 */
		models: Record<string, number>;
		/** Sub-agents one conversation runs at a time: the default of `subagents.maxParallel` for an agent that names none. */
		maxSubagents: number;
		/** The most tasks one call of `subagent` puts onto a board and starts (a pool). */
		maxPoolTasks: number;
		maxDelegationDepth: number;
		/** Largest file the download tool fetches. */
		maxDownloadMb: number;
		maxEventHops: number;
		modelHeadersTimeoutMs: number;
		modelStreamIdleMs: number;
		eventRetentionDays: number;
		/** A conversation that is not pinned, not open in a tab, not subscribed to anything and without a schedule of its own is removed after this many days without a message. 0: never. */
		conversationDays: number;
		maxQueuedPerAgent: number;
		maxEventChars: number;
		/**
		 * Goal mode (src/goals.ts): how many rounds a goal gets before it stops and the owner has to
		 * say that it goes on. A round is a whole task with as many tool calls as it takes, bounded
		 * by taskTimeoutSec, so twenty of them are hours on a local model; and a small model that has
		 * not got there in twenty turns is more often stuck than nearly done.
		 */
		goalRounds: number;
		/** Goal mode: after this many rounds in a row that ended "not met" without a tool call, the goal is paused. 0: never. */
		goalIdleRounds: number;
		/** How long the judge of a goal may take before its silence counts as no verdict. */
		goalJudgeMs: number;
		/** A swarm (src/swarm.ts): how many turns its lead gets before it stops with work left and the owner has to say that it goes on. */
		swarmRounds: number;
		/**
		 * Whether pine has the idle slots of a llama.cpp server read what every conversation of an
		 * agent begins with (the tools and instructions), after the owner has used the model: the
		 * next conversation, or a sub-agent, then starts where the server has read already. It
		 * costs the server one reading of that beginning per slot, in the background.
		 */
		warmSlots: boolean;
		/** How long the model has to be left alone before an idle slot is filled. */
		warmAfterMs: number;
		/**
		 * How many conversations that had to leave their slot are kept in files of a llama.cpp
		 * server that has a folder for them (--slot-save-path), to be read back when they come
		 * again (src/slots.ts). 0: none.
		 */
		slotPages: number;
	};
	security: {
		approvalTimeoutMs: number;
		/** How long a session stays tainted after it saw outside content. */
		taint: "session" | "run" | "off";
		/** Tool name globs whose results are outside content, besides MCP servers marked `taints`. */
		taintTools: string[];
		/** Keep bypass mode in force after a session has seen outside content. Off: such a session asks again. */
		bypassWhenTainted: boolean;
		/**
		 * Whether pine asks the owner itself when a call of an agent in the workspace scope needs a
		 * file or folder outside its sandbox, or the network (src/access.ts). Off: only the agent
		 * asks, with request_access.
		 */
		askAccess: boolean;
	};
	/** How pine's UIs look: `theme` names a file in <home>/themes (src/themes.ts). Not set: pmndre. `view` names a
	 *  view in <home>/views for the Pine app's panel (src/views.ts), or "off"; not set: the first view there is. */
	ui: { theme?: string; view?: string };
	/** Values that must never leave the daemon in events or messages. */
	secrets: string[];
	mcp: Record<string, McpServerConfig>;
	/** Event sources every agent can subscribe to (or the agents an entry lists). */
	sources: Record<string, SourceConfig>;
	/** Source types of your own, besides the built-in ones: type name -> the module that implements it. */
	sourceTypes: Record<string, string>;
	/** Subscriptions for everyone: each agent that can use the source is woken in its main conversation. */
	subscribe: SubscriptionConfig[];
	extensions: string[];
	skills: string[];
	routes: RouteConfig[];
	schedules: ScheduleConfig[];
	http?: { host: string; port: number; token?: string; hooks: Record<string, HookConfig> };
	agents: Record<string, AgentConfig>;
}

export class ConfigError extends Error {
	problems: string[];
	constructor(problems: string[]) {
		super(`Invalid pine configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
		this.problems = problems;
	}
}

/** The pine checkout: bundled MCP servers and source types live here. */
export const PINE_ROOT = path.resolve(import.meta.dirname, "..");
/**
 * How pine's own module files end: ".ts" in a checkout, where Node runs the sources as they are,
 * ".js" in the published package, which holds them compiled (Node does not run TypeScript from
 * inside node_modules). Used wherever pine names one of its own files at run time.
 */
export const EXT = import.meta.filename.endsWith(".ts") ? ".ts" : ".js";

export const defaultHome = () => path.resolve(expandHome(process.env.PINE_HOME ?? "~/.pine"));

const readJson = (file: string, problems: string[]): any => {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (e) {
		problems.push(`${file}: ${(e as Error).message}`);
		return {};
	}
};

/** Replace ${VAR} and ${VAR:-fallback} in every string of a JSON value. */
function interpolate(value: any, where: string, problems: string[], env: Record<string, string | undefined>): any {
	if (typeof value === "string") {
		return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_m, name, fallback) => {
			const v = env[name] ?? fallback;
			if (v === undefined) problems.push(`${where}: environment variable ${name} is not set`);
			return v ?? "";
		});
	}
	if (Array.isArray(value)) return value.map((v, i) => interpolate(v, `${where}[${i}]`, problems, env));
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v, `${where}.${k}`, problems, env)]));
	return value;
}

/**
 * pine had plugins once: modules listed under "plugins". What they did is done by event sources
 * now, which agents set up themselves. An empty list in an older file is ignored; one that still
 * names something is a problem to fix, with a pointer to what took its place.
 */
const noPlugins = (list: unknown, where: string, problems: string[]): void => {
	if (Array.isArray(list) && list.length) problems.push(`${where}: plugins are gone. Telegram, MQTT and watched folders are event sources now, which an agent sets up when you ask it to ("watch telegram", "watch ~/Scans"); see docs/references/sources.md. Take the "plugins" entry out`);
};

/** An agent's color as agent.json keeps it: `#rrggbb`, in any case. */
export const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

const strings = (v: unknown, fallback: string[]): string[] => (Array.isArray(v) ? v.map(String) : fallback);
const paths = (v: unknown, base: string): string[] => strings(v, []).map((p) => resolvePath(p, base));

function loadAgent(id: string, dir: string, raw: any, cfg: PineConfig, problems: string[]): AgentConfig {
	const where = `agents/${id}/agent.json`;
	noPlugins(raw.plugins, `${where}: plugins`, problems);
	const workspace = raw.workspace ? resolvePath(raw.workspace, dir) : path.join(dir, "workspace");
	if (!raw.workspace) fs.mkdirSync(workspace, { recursive: true });
	else if (!fs.existsSync(workspace)) problems.push(`${where}: workspace ${workspace} does not exist`);
	// The mode is the one setting that says whether an agent works in a sandbox and how far it
	// reaches. What said it before is gone, and a file that still has it says what to write instead.
	if (raw.sandbox === false || raw.sandbox?.enabled === false) problems.push(`${where}: "sandbox": false is gone. The mode says whether an agent works in a sandbox: set "mode" to "auto" to work without one, and take the "sandbox" entry out`);
	if (raw.sandbox?.scope !== undefined) problems.push(`${where}: sandbox.scope is gone. The mode says how far an agent reaches: set "mode" to "auto" (your whole account, no sandbox) or "safe" (the agent's own folders, in the sandbox), and take the "scope" entry out`);
	const chosen: Mode | undefined = raw.mode ?? cfg.defaults.mode;
	const sub = raw.subagents === false ? { enabled: false } : raw.subagents === true || raw.subagents === undefined ? {} : raw.subagents;
	const state = raw.state ?? {};
	if (raw.color !== undefined && !isColor(raw.color)) problems.push(`${where}: color must be written #rrggbb, for example #e0805a (got ${JSON.stringify(raw.color)})`);
	return {
		id,
		dir,
		description: raw.description ?? "",
		// Always a key, also without a color: a change that takes it away is taken over with Object.assign.
		color: isColor(raw.color) ? raw.color.toLowerCase() : undefined,
		workspace,
		model: raw.model,
		thinking: raw.thinking ?? cfg.defaults.thinking,
		tools: Array.isArray(raw.tools) ? raw.tools.map(String) : undefined,
		mcp: raw.mcp ?? {},
		globalMcp: raw.globalMcp ?? true,
		sources: loadSources(raw.sources, dir, `${where}: sources`, problems, Object.keys(cfg.sourceTypes)),
		subscribe: loadSubscriptions(raw.subscribe, `${where}: subscribe`, problems),
		schedules: loadSchedules(raw.schedules, problems, where, id),
		extensions: paths(raw.extensions, dir),
		skills: paths(raw.skills, dir),
		context: paths(raw.context, dir),
		delegates: strings(raw.delegates, ["*"]),
		subagents: { enabled: sub.enabled ?? true, maxParallel: sub.maxParallel ?? cfg.limits.maxSubagents, tools: sub.tools, mcp: sub.mcp ?? true },
		publish: strings(raw.publish, []),
		state: { read: strings(state.read, ["#"]), write: strings(state.write, [`agent/${id}/#`]), inject: strings(state.inject, []) },
		trustWorkspace: raw.trustWorkspace === true,
		// What nobody chose is settled once all agents are known: the main agent is "auto", the others "safe".
		mode: chosen ?? "safe",
		level: "safe",
		modeSet: chosen !== undefined,
		sandbox: {
			network: raw.sandbox?.network === true,
			read: paths(raw.sandbox?.read, dir),
			write: paths(raw.sandbox?.write, dir),
			sharedTmp: raw.sandbox?.sharedTmp !== false,
			env: raw.sandbox?.env ?? {},
		},
		approve: strings(raw.approve, []),
		approveWhenTainted: strings(raw.approveWhenTainted, ["publish_event", "send"]),
		untrusted:
			raw.untrusted === false
				? false
				: {
						tools: strings(raw.untrusted?.tools, ["read", "grep", "find", "ls"]),
						mcp: strings(raw.untrusted?.mcp, []),
						delegates: strings(raw.untrusted?.delegates, []),
						publish: strings(raw.untrusted?.publish, []),
						stateWrite: raw.untrusted?.stateWrite === true,
						subagents: raw.untrusted?.subagents === true,
						board: raw.untrusted?.board === true,
					},
		bashTimeoutSec: raw.bashTimeoutSec ?? cfg.defaults.bashTimeoutSec,
		bashDeny: strings(raw.bashDeny, []),
		taskTimeoutSec: raw.taskTimeoutSec ?? cfg.defaults.taskTimeoutSec,
		idleMs: raw.idleMs !== undefined ? parseDuration(raw.idleMs) : cfg.defaults.idleMs,
		settings: { ...cfg.defaults.settings, ...(raw.settings ?? {}) },
	};
}

function loadRoutes(raw: unknown, problems: string[]): RouteConfig[] {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) {
		problems.push("pine.json: routes must be an array");
		return [];
	}
	return raw.flatMap((r, i) => {
		const where = `pine.json: routes[${i}]`;
		if (!r || (typeof r.on !== "string" && !Array.isArray(r.on))) {
			problems.push(`${where}: needs "on" (topic pattern)`);
			return [];
		}
		if (!r.agent && !r.call && !r.publish && !r.set) problems.push(`${where}: needs one of agent, call, publish, set`);
		if (r.agent && r.call) problems.push(`${where}: use either agent or call, not both`);
		if (r.call && typeof r.call.prompt !== "string") problems.push(`${where}: call needs "prompt"`);
		if (r.publish && typeof r.publish.topic !== "string") problems.push(`${where}: publish needs "topic"`);
		return [
			{
				...r,
				name: r.name ?? `route${i}`,
				on: Array.isArray(r.on) ? r.on : [r.on],
				debounceMs: r.debounceMs !== undefined ? parseDuration(r.debounceMs) : undefined,
				throttleMs: r.throttleMs !== undefined ? parseDuration(r.throttleMs) : undefined,
			},
		];
	});
}

/** `file`: where the list stands. `agent`: the agent it belongs to, whose schedules need a task and are published under its name. */
function loadSchedules(raw: unknown, problems: string[], file = "pine.json", agent?: string): ScheduleConfig[] {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) {
		problems.push(`${file}: schedules must be an array`);
		return [];
	}
	return raw.flatMap((s, i) => {
		const where = `${file}: schedules[${i}]`;
		if (!s?.name) {
			problems.push(`${where}: needs "name"`);
			return [];
		}
		if (!/^[a-z][a-z0-9_-]{0,39}$/.test(s.name)) problems.push(`${where}: a schedule's name is lowercase letters, digits, - and _`);
		if ([s.cron, s.every, s.at].filter((x) => x !== undefined).length !== 1) problems.push(`${where}: needs exactly one of cron, every, at`);
		const task = typeof s.task === "string" && s.task.trim() ? s.task.trim() : undefined;
		if (agent && !task) problems.push(`${where}: needs "task": what the agent is to do when it fires`);
		let every: number | undefined;
		let at: number | undefined;
		try {
			every = s.every !== undefined ? parseDuration(s.every) : undefined;
			if (s.at !== undefined) {
				at = typeof s.at === "number" ? s.at : Date.parse(String(s.at));
				if (!Number.isFinite(at)) throw new Error(`"${s.at}" is not a time. Write it as 2026-12-24T17:00`);
			}
		} catch (e) {
			problems.push(`${where}: ${(e as Error).message}`);
		}
		const key = agent ? `${s.name}@${agent}` : s.name;
		// A task that was due while pine was not running is still worth doing; an event for a route is not repeated unless asked.
		return [{ name: s.name, cron: s.cron, every, at, task, session: typeof s.session === "string" && s.session ? s.session : undefined, topic: s.topic ?? `timer/${key}`, payload: s.payload, catchUp: s.catchUp === undefined ? Boolean(task) : s.catchUp === true }];
	});
}

/** Read `<home>/pine.json`, `<home>/.env` and every `<home>/agents/<id>/agent.json`. Throws ConfigError. */
/** The most runs at a time a model can be given. */
export const MAX_MODEL_RUNS = 64;
/** The name of a model server or provider, as it stands before the "/" of a model. */
export const SERVER_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/;
export const modelLimit = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_MODEL_RUNS;
/** A model's whole name: its server or provider, a "/", and its id as the server names it. */
export const MODEL_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}\/[A-Za-z0-9._:@/+=,()[\]-]{1,160}$/;
/** `limits.models` as it is used: only what is a model's name and a number that can be one. (What is wrong with the rest, `problems` says.) */
const modelLimits = (raw: unknown): Record<string, number> => Object.fromEntries(Object.entries(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}).filter(([name, n]) => MODEL_KEY.test(name) && modelLimit(n))) as Record<string, number>;

export function loadConfig(home = defaultHome()): PineConfig {
	const problems: string[] = [];
	home = path.resolve(expandHome(home));
	const file = path.join(home, "pine.json");
	if (!fs.existsSync(file)) throw new ConfigError([`${file} not found. Run "pine init ${home}" to create a home directory.`]);

	// Secrets from .env are used to fill in the configuration only. They are not exported to the
	// process environment, so agent shells and MCP servers do not inherit them.
	const envFile = path.join(home, ".env");
	const fileEnv = fs.existsSync(envFile) ? (parseEnv(fs.readFileSync(envFile, "utf8")) as Record<string, string>) : {};
	const env = { ...process.env, PINE_HOME: home, PINE_ROOT, ...fileEnv };

	const raw = interpolate(readJson(file, problems), "pine.json", problems, env);
	noPlugins(raw?.plugins, "pine.json: plugins", problems);
	const d = raw.defaults ?? {};
	if (d.scope !== undefined) problems.push('pine.json: defaults.scope is gone. The mode says how far an agent reaches: set defaults.mode to "safe" to keep all agents in the sandbox or to "auto" to give all agents your whole account, and take the "scope" entry out');
	// Source types of the owner's own: a name and the module behind it.
	const sourceTypes: Record<string, string> = {};
	for (const [name, file] of Object.entries(raw.sourceTypes && typeof raw.sourceTypes === "object" ? raw.sourceTypes : {})) {
		if (!/^[a-z][a-z0-9_-]{0,39}$/.test(name) || SOURCE_TYPES.includes(name)) problems.push(`pine.json: sourceTypes.${name}: a type name is lowercase letters, digits, - and _, and not one of the built-in types`);
		else if (typeof file !== "string" || !file) problems.push(`pine.json: sourceTypes.${name} must be the path of a module`);
		else sourceTypes[name] = resolvePath(file, home);
	}
	const l = raw.limits ?? {};
	const cfg: PineConfig = {
		home,
		dataDir: resolvePath(raw.dataDir ?? "data", home),
		logLevel: raw.logLevel ?? "info",
		main: raw.main,
		defaults: {
			model: d.model,
			judge: typeof d.judge === "string" && d.judge ? d.judge : undefined,
			checker: typeof d.checker === "string" && d.checker ? d.checker : undefined,
			introduce: d.introduce !== false,
			thinking: d.thinking ?? "medium",
			mode: d.mode,
			bashTimeoutSec: d.bashTimeoutSec ?? 900,
			taskTimeoutSec: d.taskTimeoutSec ?? 7200,
			idleMs: parseDuration(d.idleMs ?? "15m"),
			settings: d.settings ?? {},
		},
		limits: {
			maxConcurrentRuns: l.maxConcurrentRuns ?? 8,
			models: modelLimits(l.models),
			maxSubagents: l.maxSubagents ?? 4,
			maxPoolTasks: l.maxPoolTasks ?? 100,
			maxDelegationDepth: l.maxDelegationDepth ?? 3,
			maxDownloadMb: l.maxDownloadMb ?? 200,
			warmSlots: l.warmSlots ?? true,
			warmAfterMs: l.warmAfterMs ?? 3000,
			slotPages: l.slotPages ?? 6,
			maxEventHops: l.maxEventHops ?? 8,
			modelHeadersTimeoutMs: parseDuration(l.modelHeadersTimeoutMs ?? "10m"),
			modelStreamIdleMs: parseDuration(l.modelStreamIdleMs ?? "5m"),
			eventRetentionDays: l.eventRetentionDays ?? 30,
			conversationDays: l.conversationDays ?? 7,
			maxQueuedPerAgent: l.maxQueuedPerAgent ?? 50,
			maxEventChars: l.maxEventChars ?? 20_000,
			goalRounds: Math.max(1, Math.floor(Number(l.goalRounds ?? 20)) || 20),
			goalIdleRounds: Math.max(0, Math.floor(Number(l.goalIdleRounds ?? 3)) || 0),
			goalJudgeMs: parseDuration(l.goalJudgeTimeout ?? "90s"),
			swarmRounds: Math.max(1, Math.floor(Number(l.swarmRounds ?? 8)) || 8),
		},
		security: {
			approvalTimeoutMs: parseDuration(raw.security?.approvalTimeout ?? "5m"),
			taint: raw.security?.taint ?? "session",
			taintTools: strings(raw.security?.taintTools, []),
			bypassWhenTainted: raw.security?.bypassWhenTainted === true,
			askAccess: raw.security?.askAccess !== false,
		},
		ui: { theme: typeof raw.ui?.theme === "string" && raw.ui.theme ? raw.ui.theme : undefined, view: typeof raw.ui?.view === "string" && raw.ui.view ? raw.ui.view : undefined },
		secrets: Object.values(fileEnv).filter((v) => v.length >= 8),
		mcp: raw.mcp ?? {},
		sources: loadSources(raw.sources, home, "pine.json: sources", problems, Object.keys(sourceTypes)),
		sourceTypes,
		subscribe: loadSubscriptions(raw.subscribe, "pine.json: subscribe", problems),
		extensions: paths(raw.extensions, home),
		skills: paths(raw.skills, home),
		routes: loadRoutes(raw.routes, problems),
		schedules: loadSchedules(raw.schedules, problems),
		http: raw.http === false ? undefined : { host: raw.http?.host ?? "127.0.0.1", port: raw.http?.port ?? 7463, token: raw.http?.token, hooks: {} },
		agents: {},
	};
	// The reviewer is gone: no model judges an action any more. What configured it says so.
	for (const key of ["review", "reviewer", "reviewTimeout", "rules"]) {
		if (raw.security?.[key] !== undefined) problems.push(`pine.json: security.${key} is gone: pine has no reviewer any more. In auto and safe mode you are asked about critical actions, and after outside content about what is sent out. Take the entry out${key === "reviewer" ? ' (the model that judges goals is "defaults.judge" now)' : ""}`);
	}
	if (raw.ui?.theme !== undefined && !(typeof raw.ui.theme === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(raw.ui.theme))) problems.push('pine.json: ui.theme names a theme by the file name in the themes folder, without .json, for example "pmndre"');
	if (raw.ui?.view !== undefined && !(typeof raw.ui.view === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(raw.ui.view))) problems.push('pine.json: ui.view names a view by the file name in the views folder, without .ts, for example "house", or is "off"');
	if (d.judge !== undefined && !/^[^/\s]+\/\S+$/.test(String(d.judge))) problems.push("pine.json: defaults.judge names a model as provider/model-id");
	if (l.models !== undefined && (typeof l.models !== "object" || !l.models || Array.isArray(l.models) || Object.entries(l.models).some(([name, n]) => !MODEL_KEY.test(name) || !modelLimit(n)))) problems.push(`pine.json: limits.models gives a model (as provider/model-id) the number of runs it takes at a time, a whole number from 1 to ${MAX_MODEL_RUNS}: { "local/qwen3-coder": 2 }`);
	if (d.checker !== undefined && !/^[^/\s]+\/\S+$/.test(String(d.checker))) problems.push("pine.json: defaults.checker names a model as provider/model-id");
	if (cfg.http) {
		for (const [name, h] of Object.entries<any>(raw.http?.hooks ?? {})) {
			if (!/^[A-Za-z0-9_-]+$/.test(name)) problems.push(`pine.json: invalid hook name "${name}"`);
			if (!h?.secret && h?.open !== true) problems.push(`pine.json: http.hooks.${name} needs a "secret" (or "open": true to accept anyone who can reach the port)`);
			cfg.http.hooks[name] = { topic: h?.topic ?? `hook/${name}`, secret: h?.secret || undefined };
		}
		if (cfg.http.token) cfg.secrets.push(cfg.http.token);
	}

	const agentsDir = path.join(home, "agents");
	for (const entry of fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir, { withFileTypes: true }) : []) {
		const dir = path.join(agentsDir, entry.name);
		const agentFile = path.join(dir, "agent.json");
		if (!entry.isDirectory() || !fs.existsSync(agentFile)) continue;
		if (!/^[a-z0-9][a-z0-9_-]*$/.test(entry.name)) {
			problems.push(`agents/${entry.name}: agent ids are lowercase letters, digits, "-" and "_"`);
			continue;
		}
		const rawAgent = interpolate(readJson(agentFile, problems), `agents/${entry.name}/agent.json`, problems, env);
		cfg.agents[entry.name] = loadAgent(entry.name, dir, rawAgent, cfg, problems);
	}

	const ids = Object.keys(cfg.agents);
	if (ids.length === 0) problems.push(`no agents found in ${agentsDir} (each agent is a folder with an agent.json)`);
	if (cfg.main && !cfg.agents[cfg.main]) problems.push(`pine.json: main agent "${cfg.main}" does not exist`);
	for (const a of Object.values(cfg.agents)) {
		// The mode of an agent that names none, and the level beneath "plan".
		const plain: Level = cfg.defaults.mode && cfg.defaults.mode !== "plan" && MODES.includes(cfg.defaults.mode) ? cfg.defaults.mode : a.id === mainAgentId(cfg) ? "auto" : "safe";
		if (!a.modeSet) a.mode = plain;
		a.level = a.mode === "plan" || !MODES.includes(a.mode) ? plain : a.mode;
		if (!MODES.includes(a.mode)) problems.push(`agents/${a.id}/agent.json: mode must be one of ${MODES.join(", ")} (got "${a.mode}")`);
		for (const t of a.delegates) if (t !== "*" && !cfg.agents[t]) problems.push(`agents/${a.id}/agent.json: delegates names unknown agent "${t}"`);
		if (Array.isArray(a.globalMcp)) for (const n of a.globalMcp) if (!cfg.mcp[n]) problems.push(`agents/${a.id}/agent.json: globalMcp names unknown server "${n}"`);
		for (const n of Object.keys(a.mcp)) if (!/^[A-Za-z0-9_-]+$/.test(n)) problems.push(`agents/${a.id}/agent.json: invalid MCP server name "${n}"`);
		for (const p of [...a.extensions, ...a.skills, ...a.context]) if (!fs.existsSync(p)) problems.push(`agents/${a.id}/agent.json: ${p} does not exist`);
		for (const sub of a.subscribe) if (!sourceFor(cfg, a.id, sub.source)) problems.push(`agents/${a.id}/agent.json: subscribe names "${sub.source}", which is not a source this agent can use`);
	}
	for (const sub of cfg.subscribe) if (!cfg.sources[sub.source]) problems.push(`pine.json: subscribe names "${sub.source}", which is not a source in pine.json (a subscription for all agents needs a source all agents can use)`);
	for (const [name, src] of Object.entries(cfg.sources)) for (const a of src.agents ?? []) if (a !== "*" && !cfg.agents[a]) problems.push(`pine.json: sources.${name}.agents names unknown agent "${a}"`);
	for (const [name, s] of Object.entries(cfg.mcp)) {
		if (!/^[A-Za-z0-9_-]+$/.test(name)) problems.push(`pine.json: invalid MCP server name "${name}"`);
		for (const a of s.agents ?? []) if (a !== "*" && !cfg.agents[a]) problems.push(`pine.json: mcp.${name}.agents names unknown agent "${a}"`);
	}
	for (const p of [...cfg.extensions, ...cfg.skills]) if (!fs.existsSync(p)) problems.push(`pine.json: ${p} does not exist`);
	for (const r of cfg.routes) if (r.agent && !cfg.agents[r.agent]) problems.push(`pine.json: route "${r.name}" names unknown agent "${r.agent}"`);
	for (const [where, servers] of [["pine.json", cfg.mcp] as const, ...Object.values(cfg.agents).map((a) => [`agents/${a.id}/agent.json`, a.mcp] as const)]) {
		for (const [name, s] of Object.entries(servers)) {
			if (s.pine && !BUNDLED[s.pine]) problems.push(`${where}: mcp.${name}.pine "${s.pine}" is not a bundled server (have: ${Object.keys(BUNDLED).join(", ")})`);
			if (!s.pine && !s.command && !s.url) problems.push(`${where}: mcp.${name} needs "command", "url" or "pine"`);
		}
	}

	if (problems.length) throw new ConfigError(problems);
	return cfg;
}

/** MCP servers an agent ends up with: its own, plus the global ones that include it. Own entries win. */
/** The main agent: the one pine.json names; without that entry the one called "main", else the first one. */
/**
 * The files in an agent's workspace that are part of its prompt, in the order they enter it. They
 * are the agent's own: it reads them as its instructions and keeps them up to date itself.
 * AGENTS.md is how it works, SOUL.md who it is, TOOLS.md how it uses its tools (what is
 * different or more for it than the TOOLS.md for all agents says), MEMORY.md what should
 * outlive a conversation.
 */
export const WORKSPACE_FILES = ["AGENTS.md", "SOUL.md", "TOOLS.md", "MEMORY.md"];

/**
 * What is the same for all agents: three files in pine's home, in every agent's prompt, kept by
 * the main agent. AGENTS.md is traits and behaviour (how every agent is to be and to act),
 * TOOLS.md is tooling (defaults and preferences for tools of any kind: skills, MCP servers,
 * shell commands, schedules, event sources; technical and functional details), USER.md what is
 * known about the owner. An agent's own files say what is different for it.
 */
export const SHARED_FILES = ["AGENTS.md", "TOOLS.md", "USER.md"];

/**
 * What pine put into the files an agent keeps (and the files for all agents) before they started empty:
 * a line on what the file is for, which the prompt and the Settings page say anyway. A home made then
 * still has it wherever nobody wrote anything. It is read as an empty file: left out of the prompt
 * (`instructionFiles` in src/agents.ts) and shown empty to the owner (src/owner.ts).
 */
export const FORMER_TEMPLATES = new Set([
	"# All agents\n\nTraits and behaviour for every agent: how your owner wants agents to be and to act, whoever\ndoes the work. Nothing yet. The main agent writes it here.",
	"# Tools\n\nTooling for every agent: defaults and preferences for the tools (skills, MCP servers, shell\ncommands, schedules, event sources), and other technical or functional details of this setup.\nNothing yet. The main agent writes it here.",
	"# User\n\nWhat every agent knows about its owner: their name, what they do, how they like to be\nanswered. Nothing yet. The main agent adds to it as it learns.",
	"# Soul\n\nWho you are: your character and your tone. Nothing is set yet. Write it down as it takes\nshape, in your own words.",
	"# Tools\n\nHow you use your tools: your own defaults and preferences for them, and technical or\nfunctional details of your work. What holds for all agents is in the TOOLS.md of pine's home;\nthis file says what is different or more for you. Nothing yet.",
	"# Memory\n\nWhat matters beyond a single conversation: decisions, facts, preferences, open ends. Nothing\nyet. Add to it as you learn, and tidy it when it grows long.",
]);

/** A file's text as pine reads it: empty where it still says only what pine once put there. */
export const ownText = (text: string): string => (FORMER_TEMPLATES.has(text.trim()) ? "" : text);
export const sharedFiles = (cfg: PineConfig): string[] => SHARED_FILES.map((f) => path.join(cfg.home, f));

/**
 * Where skills lie that were set up by tool call. The place says whom a skill is for: all agents,
 * one agent, or one conversation of an agent. All of it is inside pine's home, which agents read
 * but do not write.
 */
export const globalSkillsDir = (cfg: Pick<PineConfig, "home">) => path.join(cfg.home, "skills");
/** The most of an agent's purpose that is shown: one line, for other agents' rosters and the owner's lists. */
const PURPOSE_MAX = 240;
const purposes = new Map<string, { stamp: string; text: string }>();

/**
 * What an agent is for, as other agents read it when they choose whom to hand work to, and as the
 * owner's lists show it: the first paragraph of its own AGENTS.md that is not a heading, as many of
 * its sentences as fit one line. The agent keeps that file itself, so the line is cleaned (no control
 * characters, no line breaks, at most PURPOSE_MAX characters), and the file is read only as the plain
 * file it is: a link, or a file with a second name elsewhere, could stand for a file of pine's, and
 * gives nothing. Without such a paragraph it is `description` in agent.json, where homes before this kept it.
 */
export function purposeOf(agent: Pick<AgentConfig, "workspace" | "description">): string {
	const file = path.join(agent.workspace, "AGENTS.md");
	let fd: number | undefined;
	try {
		fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
		const st = fs.fstatSync(fd);
		if (!st.isFile() || st.nlink !== 1) return agent.description;
		const stamp = `${st.ino}:${st.mtimeMs}:${st.size}`;
		const known = purposes.get(file);
		if (known?.stamp === stamp) return known.text || agent.description;
		const buf = Buffer.alloc(Math.min(st.size, 16_384));
		const purpose = purposeFrom(buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).toString("utf8"));
		purposes.set(file, { stamp, text: purpose });
		return purpose || agent.description;
	} catch {
		return agent.description;
	} finally {
		if (fd !== undefined) fs.closeSync(fd);
	}
}

/** The purpose an instruction text states: its first paragraph that is not a heading, as one line of at most PURPOSE_MAX characters. */
export function purposeFrom(text: string): string {
	const paragraph = text
		.replace(/\r/g, "")
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.find((p) => p && !/^#/.test(p) && !/^<!--/.test(p));
	const line = (paragraph ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/^[>*-]\s+/, "").replace(/\s+/g, " ").trim();
	const sentences = line.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [];
	let purpose = "";
	for (const s of sentences) {
		if (purpose && purpose.length + s.length > PURPOSE_MAX) break;
		purpose += s;
	}
	purpose = purpose.trim();
	if (purpose.length > PURPOSE_MAX) purpose = `${purpose.slice(0, PURPOSE_MAX - 1).replace(/\s+\S*$/, "")}…`;
	return purpose;
}

export const agentSkillsDir = (agent: Pick<AgentConfig, "dir">) => path.join(agent.dir, "skills");
export const conversationsDir = (agent: Pick<AgentConfig, "dir">) => path.join(agent.dir, "conversations");

export function mainAgentId(cfg: PineConfig): string {
	return cfg.main ?? (cfg.agents.main ? "main" : Object.keys(cfg.agents)[0]);
}

/**
 * The MCP servers an agent has. `session`: the conversation asked for, which also gets the servers
 * that were added for it alone; without it, every server the agent has in any conversation.
 */
export function effectiveMcp(cfg: PineConfig, agent: AgentConfig, session?: string): Record<string, McpServerConfig> {
	const out: Record<string, McpServerConfig> = {};
	for (const [name, server] of Object.entries(cfg.mcp)) {
		const scope = server.agents ?? ["*"];
		const listed = scope.includes("*") || scope.includes(agent.id);
		const wanted = agent.globalMcp === true ? listed : Array.isArray(agent.globalMcp) ? agent.globalMcp.includes(name) : false;
		if (wanted && server.enabled !== false) out[name] = server;
	}
	for (const [name, server] of Object.entries(agent.mcp)) if (server.enabled !== false && (!server.session || session === undefined || server.session === session)) out[name] = server;
	return out;
}

const BUNDLED: Record<string, { file: string; taints: boolean }> = {
	web: { file: `mcp/web${EXT}`, taints: true },
	browser: { file: `mcp/browser${EXT}`, taints: true },
	commands: { file: `mcp/commands${EXT}`, taints: false },
	// What a screen shows was written by whoever wrote the mail, the page or the document on it.
	computer: { file: `mcp/computer${EXT}`, taints: true },
};

/** Turn a pine MCP entry into what pi's registerMcpServer() accepts. */
export function toPiMcp(name: string, server: McpServerConfig, extraOptions: Record<string, unknown> = {}): Record<string, unknown> {
	const { agents: _a, pine, options, taints: _t, approve: _ap, session: _s, sandboxed: _sb, ...rest } = server;
	if (!pine) return { exposure: "direct", ...rest };
	const bundled = BUNDLED[pine];
	if (!bundled) throw new Error(`mcp.${name}: unknown bundled server "${pine}" (have: ${Object.keys(BUNDLED).join(", ")})`);
	return {
		exposure: "direct",
		...rest,
		command: process.execPath,
		args: [path.join(PINE_ROOT, bundled.file)],
		env: { ...(rest.env ?? {}), PINE_MCP_OPTIONS: JSON.stringify({ ...(options ?? {}), ...extraOptions }) },
	};
}

const SOURCE_KEYS = ["type", "use", "description", "agents", "trust", "start", "enabled", "session"];

function loadSources(raw: unknown, base: string, where: string, problems: string[], own: string[] = []): Record<string, SourceConfig> {
	const types = [...SOURCE_TYPES, ...own];
	const out: Record<string, SourceConfig> = {};
	if (raw === undefined || raw === null) return out;
	if (typeof raw !== "object" || Array.isArray(raw)) {
		problems.push(`${where} must be an object of named sources`);
		return out;
	}
	for (const [name, v] of Object.entries<any>(raw)) {
		if (!/^[a-z][a-z0-9_-]{0,39}$/.test(name)) problems.push(`${where}.${name}: a source name is lowercase letters, digits, - and _`);
		if (!v || typeof v !== "object") {
			problems.push(`${where}.${name} must be an object`);
			continue;
		}
		if (!v.type === !v.use) problems.push(`${where}.${name} needs either "type" (${types.join(", ")}) or "use" (a module of your own)`);
		// Times are not a source any more: a schedule does what a timer source and a subscription did together.
		if (v.type === "timer") problems.push(`${where}.${name}: there is no "timer" source any more. Something that happens at a time is a schedule: ask the agent ("every morning at seven, ..."), or write { "name": "${name}", ${v.cron ? `"cron": "${v.cron}"` : `"every": "${v.every ?? "1h"}"`}, "task": "what to do" } under "schedules" and remove this source and its subscriptions`);
		else if (v.type && !types.includes(v.type)) problems.push(`${where}.${name}: unknown type "${v.type}" (have: ${types.join(", ")})`);
		if (v.trust !== undefined && v.trust !== "owner" && v.trust !== "untrusted") problems.push(`${where}.${name}: trust is "owner" or "untrusted"`);
		if (v.start !== undefined && v.start !== "subscribed" && v.start !== "always") problems.push(`${where}.${name}: start is "subscribed" or "always"`);
		out[name] = {
			type: v.type,
			use: v.use,
			base,
			description: typeof v.description === "string" ? v.description : undefined,
			agents: Array.isArray(v.agents) ? v.agents.map(String) : undefined,
			session: typeof v.session === "string" && v.session ? v.session : undefined,
			// What a source reports was produced by someone or something else, unless the owner says it is theirs.
			trust: v.trust ?? "untrusted",
			start: v.start ?? "subscribed",
			enabled: v.enabled !== false,
			options: Object.fromEntries(Object.entries(v).filter(([k]) => !SOURCE_KEYS.includes(k))),
		};
	}
	return out;
}

/**
 * The forms "subscribe" may have in a file, as a plain list of entries:
 * `["camera", "printer"]`, `{ "camera": { "note": ... } }`, or the form pine itself writes,
 * `[{ "source": "camera", "session": "main", "note": ... }]`, which is the only one that can
 * say that two conversations listen to the same source.
 */
export function rawSubscriptions(raw: unknown): Array<Record<string, any>> {
	if (Array.isArray(raw)) return raw.map((item) => (typeof item === "string" ? { source: item } : item && typeof item === "object" ? { ...item } : { source: String(item) }));
	if (raw && typeof raw === "object") return Object.entries<any>(raw as object).map(([name, v]) => ({ ...(v && typeof v === "object" ? v : {}), source: name }));
	return [];
}

function loadSubscriptions(raw: unknown, where: string, problems: string[]): SubscriptionConfig[] {
	const out: SubscriptionConfig[] = [];
	if (raw === undefined || raw === null) return out;
	if (typeof raw !== "object") {
		problems.push(`${where} must be a list of source names, a list of entries, or an object`);
		return out;
	}
	for (const entry of rawSubscriptions(raw)) {
		try {
			const sub = subscriptionFrom(entry);
			if (out.some((x) => x.source === sub.source && x.session === sub.session)) problems.push(`${where}: "${sub.source}" is listed twice for the conversation "${sub.session}"`);
			else out.push(sub);
		} catch (e) {
			problems.push(`${where}.${entry.source ?? "?"}: ${(e as Error).message}`);
		}
	}
	return out;
}

export function subscriptionFrom(v: Record<string, any>): SubscriptionConfig {
	if (typeof v.source !== "string" || !v.source) throw new Error(`an entry needs "source": the name of the source`);
	if (v.when !== undefined && (typeof v.when !== "object" || v.when === null || Array.isArray(v.when))) throw new Error(`"when" must be an object of conditions`);
	const separate = v.separate === true;
	return {
		source: v.source,
		session: typeof v.session === "string" && v.session ? v.session : separate ? `on-${v.source}` : "main",
		note: typeof v.note === "string" && v.note.trim() ? v.note.trim().slice(0, 2000) : undefined,
		when: v.when,
		debounceMs: v.debounce !== undefined ? parseDuration(v.debounce) : undefined,
		throttleMs: parseDuration(v.throttle ?? "10s"),
		throttleDefault: v.throttle === undefined ? true : undefined,
		separate,
		prompt: typeof v.prompt === "string" ? v.prompt : undefined,
	};
}

/** The source an agent means by a name: its own first, then a global one it is allowed to use. */
export function sourceFor(cfg: PineConfig, agentId: string, name: string): { source: SourceConfig; key: string; scope: string } | undefined {
	const agent = cfg.agents[agentId];
	if (agent?.sources[name]) return { source: agent.sources[name], key: `${name}@${agentId}`, scope: agentId };
	const global = cfg.sources[name];
	if (global && (!global.agents || global.agents.includes("*") || global.agents.includes(agentId))) return { source: global, key: name, scope: "global" };
	return undefined;
}

export const mcpTaints = (server: McpServerConfig) => server.taints ?? (server.pine ? (BUNDLED[server.pine]?.taints ?? false) : false);

/** Whom an agent may hand work to, in words: "*" said as what it means. */
export function delegatesText(cfg: PineConfig, a: AgentConfig): string {
	const main = mainAgentId(cfg);
	const named = a.delegates.filter((d) => d !== "*");
	if (!a.delegates.includes("*")) return named.join(", ") || "nobody";
	const all = a.id === main ? "all other agents" : `all agents except the main one (${main})`;
	return `${all} ("*")${named.length ? `, and ${named.join(", ")}` : ""}`;
}

/**
 * Agents `from` may delegate to. "*" is every other agent but the main one: the administrator
 * takes work from the owner, and from another agent only where that agent's list names it.
 */
export function delegateTargets(cfg: PineConfig, from: AgentConfig): AgentConfig[] {
	const all = from.delegates.includes("*");
	const main = mainAgentId(cfg);
	return Object.values(cfg.agents).filter((a) => a.id !== from.id && (from.delegates.includes(a.id) || (all && a.id !== main)));
}
