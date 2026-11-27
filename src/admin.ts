// What the main agent administers besides what every agent sets up for itself: the agents
// themselves and pine's settings. Nothing here is free text into a file. A change is a few named
// values, each checked on its own; it is written, the whole configuration is read back through
// the normal loader, and what does not pass is undone. The tools that call this are in
// src/tools.ts, and each of them asks the owner first.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AGENT_TOOLS } from "./agent-admin.ts";
import { askProblem, type AskQuestions } from "./ask.ts";
import { whereIs } from "./decisions.ts";
import { type AgentConfig, delegatesText, isColor, isScroll, loadConfig, mainAgentId, MAX_MODEL_RUNS, MODEL_KEY, modelLimit, type Mode, MODES, PINE_ROOT, SERVER_KEY, type PineConfig, RESERVED_TOPICS, type RouteConfig, unsandboxed } from "./config.ts";
import { renameEnv, secretName, unsetEnv } from "./env-file.ts";
import { DEFAULT_THEME, listThemes } from "./themes.ts";
import { listViews, viewInForce } from "./views.ts";
import { editJson } from "./mcp-config.ts";
import { isInside, realish } from "./security.ts";
import { placeOf } from "./snapshots.ts";
import type { Kv, TaskStore } from "./store.ts";
import type { Boards } from "./boards.ts";
import { errText, type Logger, matchesAny, onPath, parseDuration } from "./util.ts";
import { addServerModel, changeServerModel, checkContext, checkModelChange, checkServerModelRemoval, listModelServers, lookAt, type ModelChange, piDefaults, removeServerModel, serverKey, serverModel, suggestModel } from "./models.ts";
import type { AgentManager } from "./agents.ts";

export const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

// ---- an agent's own settings ---------------------------------------------------------------------

/** What can be changed about an agent. Everything is optional; what is left out stays. */
export interface AgentChange {
	/** Its color in the Pine app, `#rrggbb`; "none" or empty takes it away. */
	color?: string;
	/** Where its conversations go in the Pine app when the owner sends a message: top or follow (`SCROLLS`); "default" is top. */
	scroll?: string;
	/** The whole new text of its instruction file (AGENTS.md in its workspace), whose first paragraph says what it is for. */
	instructions?: string;
	/** The whole new text of its SOUL.md: who it is, its character and tone. */
	soul?: string;
	/** The whole new text of its TOOLS.md: its own defaults and preferences for its tools. Empty takes them back. */
	tooling?: string;
	/** "default" goes back to pine's default model. */
	model?: string;
	thinking?: string;
	/** A mode, or "default" for what pine gives an agent that names none (auto for the main agent, safe for the others). */
	mode?: string;
	tools?: string[];
	/** Agents it may hand work to; "*" is every agent but the main one. */
	delegates?: string[];
	network?: boolean;
	/** Folders outside its workspace it may read from now on. */
	read?: string[];
	/** Folders outside its workspace it may read and change from now on. */
	write?: string[];
	/** Folders to take out of both lists again. */
	forget?: string[];
}

const scrollText = (s: string) => (s === "top" ? "your message moves to the top" : "the conversation follows the answer");

/**
 * An agent's color as a change gives it: `#rrggbb` in any case, kept in lower case; "none" (in any case) or
 * empty is no color (undefined). Throws on anything else, before the owner is asked.
 */
export function checkColor(given: unknown): string | undefined {
	const text = typeof given === "string" ? given.trim() : given;
	if (text === "" || (typeof text === "string" && text.toLowerCase() === "none")) return undefined;
	if (!isColor(text)) throw new Error(`a color is written #rrggbb, for example #e0805a (got ${JSON.stringify(given)}); "none" takes it away`);
	return text.toLowerCase();
}

const folder = (given: string) => {
	const text = given.trim();
	const full = text === "~" ? os.homedir() : text.startsWith("~/") ? path.join(os.homedir(), text.slice(2)) : text;
	if (!path.isAbsolute(full)) throw new Error(`"${given}" is not a full path. A folder is given from the root, for example ${path.join(os.homedir(), "Documents")}`);
	return realish(full);
};

/**
 * Check a change to an agent and say what it does, line by line, with what makes it wider.
 * Nothing is written. Throws with what is wrong and how it would be right.
 */
export function checkAgentChange(cfg: PineConfig, agent: AgentConfig, change: AgentChange, models: string[]): { lines: string[]; warnings: string[]; json: (raw: any) => void; instructions?: string; soul?: string; tooling?: string } {
	const lines: string[] = [];
	const warnings: string[] = [];
	const steps: Array<(raw: any) => void> = [];
	const main = agent.id === mainAgentId(cfg);
	if (change.color !== undefined) {
		const color = checkColor(change.color);
		lines.push(`color: ${color ?? "none"}`);
		steps.push((raw) => (color ? (raw.color = color) : delete raw.color));
	}
	if (change.scroll !== undefined) {
		const none = change.scroll === "default" || change.scroll === "";
		if (!none && !isScroll(change.scroll)) throw new Error(`"scroll" is top (your message moves to the top and the answer is written below it) or follow (your message stays at the end and the answer is followed as it is written), or default (top)`);
		const next = none ? "top" : change.scroll;
		lines.push(`when you send a message: ${scrollText(agent.scroll)} -> ${scrollText(next)}`);
		steps.push((raw) => (none || next === "top" ? delete raw.scroll : (raw.scroll = next)));
	}
	if (change.model !== undefined) {
		const none = change.model === "default" || change.model === "";
		if (!none && !models.includes(change.model)) throw new Error(`there is no model "${change.model}". Models: ${models.slice(0, 40).join(", ")}`);
		lines.push(`model: ${agent.model ?? `${cfg.defaults.model ?? "none"} (the default)`} -> ${none ? `${cfg.defaults.model ?? "none"} (the default)` : change.model}`);
		steps.push((raw) => (none ? delete raw.model : (raw.model = change.model)));
	}
	if (change.thinking !== undefined) {
		if (!THINKING.includes(change.thinking)) throw new Error(`"thinking" is one of ${THINKING.join(", ")}`);
		lines.push(`reasoning: ${agent.thinking} -> ${change.thinking}`);
		steps.push((raw) => (raw.thinking = change.thinking));
	}
	if (change.mode !== undefined) {
		if (change.mode !== "default" && !MODES.includes(change.mode as Mode)) throw new Error(`"mode" is one of ${MODES.join(", ")}, or default`);
		const next = change.mode === "default" ? (cfg.defaults.mode ?? (main ? "auto" : "safe")) : (change.mode as Mode);
		lines.push(`mode: ${agent.mode} -> ${next}${change.mode === "default" ? " (the default)" : ""}`);
		if (next === "bypass") warnings.push("in bypass mode it never asks, and the agent's shell reaches your whole account and the network");
		else if (next === "auto" && !unsandboxed(agent.level)) warnings.push("in auto mode the agent's shell and file tools work without a sandbox: they reach your whole user account and the network in your own conversations");
		steps.push((raw) => {
			if (change.mode === "default") delete raw.mode;
			else raw.mode = change.mode;
			// What said this before the mode did. Left in place, it would decide again.
			if (raw.sandbox && typeof raw.sandbox === "object") delete raw.sandbox.scope;
		});
	}
	if (change.tools !== undefined) {
		const unknown = change.tools.filter((t) => !AGENT_TOOLS.includes(t));
		if (unknown.length) throw new Error(`unknown tool${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")}. An agent can have: ${AGENT_TOOLS.join(", ")}`);
		lines.push(`built-in tools: ${(agent.tools ?? AGENT_TOOLS).join(", ")} -> ${change.tools.join(", ") || "none"}`);
		steps.push((raw) => (raw.tools = change.tools));
	}
	if (change.delegates !== undefined) {
		const unknown = change.delegates.filter((d) => d !== "*" && (!cfg.agents[d] || d === agent.id));
		if (unknown.length) throw new Error(`"delegates" names ${unknown.join(", ")}, which ${unknown.length === 1 ? "is" : "are"} not another agent. Agents: ${Object.keys(cfg.agents).filter((id) => id !== agent.id).join(", ") || "none"}; "*" is every agent but the main one`);
		lines.push(`may hand work to: ${delegatesText(cfg, agent)} -> ${delegatesText(cfg, { ...agent, delegates: change.delegates })}`);
		steps.push((raw) => (raw.delegates = change.delegates));
	}
	if (change.network !== undefined) {
		lines.push(`network for shell commands: ${agent.sandbox.network ? "yes" : "no"} -> ${change.network ? "yes" : "no"}`);
		if (change.network && !agent.sandbox.network) warnings.push("with the network the agent's commands can send what it reads anywhere");
		steps.push((raw) => {
			raw.sandbox = typeof raw.sandbox === "object" && raw.sandbox ? raw.sandbox : {};
			if (change.network) raw.sandbox.network = true;
			else delete raw.sandbox.network;
		});
	}
	const closed = (p: string) => {
		const about = (root: string) => isInside(root, p) || isInside(p, root);
		const other = Object.values(cfg.agents).find((a) => a.id !== agent.id && isInside(realish(a.workspace), p));
		if (other) return `that is the workspace of the agent ${other.id}; agents exchange work with delegate, not through each other's files`;
		if (about(realish(cfg.home))) return "pine's own folder stays closed to every agent";
		if (about(realish(PINE_ROOT))) return "pine's own code is not given to an agent";
		return Object.values(cfg.agents).some((a) => a.id !== agent.id && about(realish(a.workspace))) ? "another agent's workspace lies in it" : undefined;
	};
	const adds = { read: (change.read ?? []).map(folder), write: (change.write ?? []).map(folder) };
	const drops = (change.forget ?? []).map(folder);
	for (const kind of ["read", "write"] as const) {
		for (const p of adds[kind]) {
			const no = closed(p);
			if (no) throw new Error(`${p} cannot be opened for ${agent.id}: ${no}`);
			if (!fs.existsSync(p)) throw new Error(`${p} does not exist. Give a folder that is there`);
			lines.push(`may ${kind === "write" ? "read and change" : "read"}: ${p}`);
		}
	}
	for (const p of drops) {
		if (![...agent.sandbox.read, ...agent.sandbox.write].some((x) => realish(x) === p)) throw new Error(`${agent.id} has no folder ${p} to forget. It has: ${[...new Set([...agent.sandbox.read, ...agent.sandbox.write])].join(", ") || "none"}`);
		lines.push(`no longer: ${p}`);
	}
	if (adds.read.length || adds.write.length || drops.length) {
		steps.push((raw) => {
			raw.sandbox = typeof raw.sandbox === "object" && raw.sandbox ? raw.sandbox : {};
			const next = (list: unknown, add: string[]) => [...new Set([...(Array.isArray(list) ? list.map(String) : []), ...add])].filter((x) => !drops.includes(realish(path.resolve(agent.dir, x))));
			const read = next(raw.sandbox.read, adds.read);
			const write = next(raw.sandbox.write, adds.write);
			if (read.length) raw.sandbox.read = read;
			else delete raw.sandbox.read;
			if (write.length) raw.sandbox.write = write;
			else delete raw.sandbox.write;
		});
	}
	const instructions = change.instructions?.trim();
	if (change.instructions !== undefined) {
		if (!instructions) throw new Error("instructions cannot be empty: they are who the agent is and how it works");
		lines.push(`instructions (the agent's AGENTS.md) replaced by:\n${instructions.length > 1200 ? `${instructions.slice(0, 1200)}...` : instructions}`);
	}
	const soul = change.soul?.trim();
	if (change.soul !== undefined) {
		if (!soul) throw new Error("soul cannot be empty: it is who the agent is, the agent's character and tone");
		lines.push(`character and tone (the agent's SOUL.md) replaced by:\n${soul.length > 1200 ? `${soul.slice(0, 1200)}...` : soul}`);
	}
	// Its own tooling can be empty: then only what holds for all agents holds for it.
	const tooling = change.tooling?.trim();
	if (tooling !== undefined) lines.push(tooling ? `the agent's own defaults and preferences for tools (the agent's TOOLS.md) replaced by:\n${tooling.length > 1200 ? `${tooling.slice(0, 1200)}...` : tooling}` : "the agent's own defaults and preferences for tools (the agent's TOOLS.md) taken back: the file is emptied");
	if (!lines.length) throw new Error("nothing to change: give at least one of description, color, scroll, instructions, soul, tooling, model, thinking, mode, tools, delegates, network, read, write, forget");
	return { lines, warnings, json: (raw) => steps.forEach((s) => s(raw)), instructions, soul, tooling };
}

/**
 * Write a checked change and take it over. The agent's file is read back through the loader
 * with everything else: if the configuration does not load, the file is as it was and nothing
 * has changed.
 */
export function applyAgentChange(cfg: PineConfig, agent: AgentConfig, checked: { json: (raw: any) => void; instructions?: string; soul?: string; tooling?: string }): void {
	const file = path.join(agent.dir, "agent.json");
	const before = fs.readFileSync(file, "utf8");
	try {
		editJson(file, checked.json);
		const fresh = loadConfig(cfg.home).agents[agent.id];
		if (!fresh) throw new Error("the agent was not found after the change");
		// The same object stays: sessions, sources and schedules hold on to it.
		Object.assign(agent, fresh);
	} catch (e) {
		fs.writeFileSync(file, before);
		throw new Error(`not changed: ${errText(e)}`);
	}
	// The workspace is the agent's to write. A file of that name is taken away and a new one
	// made, never written through: what lies there could be a link to somewhere else.
	for (const [name, text] of [["AGENTS.md", checked.instructions], ["SOUL.md", checked.soul], ["TOOLS.md", checked.tooling]] as const) {
		if (text === undefined) continue;
		const target = path.join(agent.workspace, name);
		fs.rmSync(target, { force: true });
		fs.writeFileSync(target, text ? `${text}\n` : "", { mode: 0o600, flag: "wx" });
	}
}

/** The parts of the configuration that name an agent and stand in the way of removing it, or are corrected when it goes. */
export function namedBy(cfg: PineConfig, id: string): { routes: string[]; delegators: string[]; sources: string[]; servers: string[] } {
	return {
		routes: cfg.routes.filter((r) => r.agent === id || r.of === id || r.run?.agent === id).map((r) => r.name),
		delegators: Object.values(cfg.agents).filter((a) => a.id !== id && a.delegates.includes(id)).map((a) => a.id),
		sources: Object.entries(cfg.sources).filter(([, s]) => s.agents?.includes(id)).map(([name]) => name),
		servers: Object.entries(cfg.mcp).filter(([, s]) => s.agents?.includes(id)).map(([name]) => name),
	};
}

/** Take an agent's name out of the lists that name it: other agents' delegates, and the sources and servers of all agents that are only for some. */
export function unname(cfg: PineConfig, id: string): void {
	const named = namedBy(cfg, id);
	for (const other of named.delegators) {
		const a = cfg.agents[other];
		a.delegates = a.delegates.filter((d) => d !== id);
		editJson(path.join(a.dir, "agent.json"), (raw) => {
			if (Array.isArray(raw.delegates)) raw.delegates = raw.delegates.filter((d: unknown) => d !== id);
		});
	}
	if (named.sources.length || named.servers.length) {
		editJson(path.join(cfg.home, "pine.json"), (raw) => {
			for (const name of named.sources) if (Array.isArray(raw.sources?.[name]?.agents)) raw.sources[name].agents = raw.sources[name].agents.filter((a: unknown) => a !== id);
			for (const name of named.servers) if (Array.isArray(raw.mcp?.[name]?.agents)) raw.mcp[name].agents = raw.mcp[name].agents.filter((a: unknown) => a !== id);
		});
		for (const name of named.sources) cfg.sources[name].agents = cfg.sources[name].agents!.filter((a) => a !== id);
		for (const name of named.servers) cfg.mcp[name].agents = cfg.mcp[name].agents!.filter((a) => a !== id);
	}
}

/**
 * Take what is left of an agent out of pine's files and store, so that nothing of it remains:
 * the routes that wake it, its name in the lists of others, the secrets pine kept for its
 * sources and servers, what is stored under its name (marks, lists, turns, tasks, pins, open
 * tabs), the recorded states of its folders, its private home and its folder. This is the part
 * that needs no running daemon: `AgentManager.removeAgent` stops what runs and then calls it,
 * and `pine agent remove` calls it alone when no daemon runs.
 *
 * The folder is moved aside first and the configuration that is left is read back. If that
 * does not load, the folder stays in `removed/` and `problem` says why. With `keepFiles` it
 * stays there on purpose. A workspace outside pine's home is the owner's folder and is left.
 */
export function eraseAgent(cfg: PineConfig, store: { kv: Kv; tasks: TaskStore; boards?: Boards }, id: string, keepFiles = false): { routes: string[]; kept?: string; workspaceLeft?: string; problem?: string } {
	const agent = cfg.agents[id];
	if (!agent) throw new Error(`there is no agent "${id}"`);
	if (id === mainAgentId(cfg)) throw new Error("the main agent administers pine and cannot be removed");
	// The keys pine put into .env for its sources and servers. One the owner wrote there under a name of their own stays.
	let raw = "";
	try {
		raw = fs.readFileSync(path.join(agent.dir, "agent.json"), "utf8");
	} catch {
		// no file, no keys
	}
	unsetEnv(cfg.home, [...new Set([...raw.matchAll(/\$\{(PINE_(?:SOURCE|MCP)_[A-Z0-9_]+)\}/g)].map((m) => m[1]))]);
	// The routes that wake it, and those of its own (`of`) or that run a command as it.
	const routes = cfg.routes.filter((r) => r.agent === id || r.of === id || r.run?.agent === id).map((r) => r.name);
	for (const name of routes) dropRoute(cfg, name);
	unname(cfg, id);
	// A worktree of one of its conversations stays in the owner's repository, which is not pine's to
	// empty; `pine worktrees` (GET /worktrees) lists it as no conversation's.
	for (const prefix of ["taint", "keep", "folder", "group", "worktree", "todos", "turns", "undone", "prefix", "note", "branch", "visited", "bookmarks"]) store.kv.forget(`${prefix}:${id}:`);
	// Its groups of conversations, and how its list was sorted.
	store.kv.set(`groups:${id}`, null);
	// Which slot of a model server held one of its conversations (src/slots.ts).
	const slots = store.kv.get<Record<string, Array<{ who?: string } | null | undefined>>>("slots");
	if (slots) store.kv.set("slots", Object.fromEntries(Object.entries(slots).map(([server, held]) => [server, held.map((o) => (o && String(o.who).startsWith(`${id}:`) ? null : o))])));
	const pages = store.kv.get<Record<string, Array<{ who?: string } | null | undefined>>>("slot-pages");
	if (pages) store.kv.set("slot-pages", Object.fromEntries(Object.entries(pages).map(([server, kept]) => [server, kept.map((o) => (o && String(o.who).startsWith(`${id}:`) ? null : o))])));
	for (const key of store.kv.keys("timer:")) if (key.endsWith(`@${id}`)) store.kv.set(key, null);
	for (const key of store.kv.keys("source:")) if (key.slice("source:".length).split(":")[0].endsWith(`@${id}`)) store.kv.forget(key);
	const pinned = store.kv.get<string[]>("conversations:pinned");
	if (Array.isArray(pinned) && pinned.some((x) => x.startsWith(`${id}:`))) store.kv.set("conversations:pinned", pinned.filter((x) => !x.startsWith(`${id}:`)));
	const ui = store.kv.get<{ tabs?: Array<{ agent: string }> }>("ui:tabs");
	if (ui && Array.isArray(ui.tabs) && ui.tabs.some((t) => t.agent === id)) store.kv.set("ui:tabs", { ...ui, tabs: ui.tabs.filter((t) => t.agent !== id) });
	store.tasks.forgetAgent(id);
	// Its boards, and what it posted on a board for all agents.
	store.boards?.dropAgent(id);
	// What was recorded of its folders for undo.
	const workspace = realish(agent.workspace);
	const dir = realish(agent.dir);
	const snapshots = path.join(cfg.dataDir, "snapshots");
	for (const name of fs.existsSync(snapshots) ? fs.readdirSync(snapshots) : []) {
		let root = "";
		try {
			root = fs.readFileSync(path.join(snapshots, name, "pine-folder"), "utf8").trim();
		} catch {
			continue;
		}
		if (isInside(workspace, root) || isInside(dir, root)) fs.rmSync(path.join(snapshots, name), { recursive: true, force: true });
	}
	for (const base of [path.join(cfg.dataDir, "programs"), path.join(cfg.dataDir, "browser-local"), path.join(cfg.dataDir, "browser-view")]) {
		for (const name of fs.existsSync(base) ? fs.readdirSync(base) : []) if (decodeURIComponent(name).startsWith(`${id}:`)) fs.rmSync(path.join(base, name), { recursive: true, force: true });
	}
	// What its event sources kept on disk ("name@agent").
	const kept = path.join(cfg.dataDir, "sources");
	for (const name of fs.existsSync(kept) ? fs.readdirSync(kept) : []) if (name.endsWith(`@${id}`)) fs.rmSync(path.join(kept, name), { recursive: true, force: true });
	const outside = !isInside(dir, workspace);
	const aside = path.join(cfg.home, "removed", `${id}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
	fs.mkdirSync(path.dirname(aside), { recursive: true, mode: 0o700 });
	fs.renameSync(agent.dir, aside);
	delete cfg.agents[id];
	fs.rmSync(path.join(cfg.home, "sandbox", id), { recursive: true, force: true });
	let problem: string | undefined;
	try {
		loadConfig(cfg.home);
	} catch (e) {
		problem = errText(e);
	}
	const keep = keepFiles || problem !== undefined;
	if (!keep) {
		fs.rmSync(aside, { recursive: true, force: true });
		// The folder that held it for a moment, if nothing else is kept there.
		if (!fs.readdirSync(path.dirname(aside)).length) fs.rmdirSync(path.dirname(aside));
	}
	return { routes, kept: keep ? aside : undefined, workspaceLeft: outside ? agent.workspace : undefined, problem };
}

/** Whether an id can be given to an agent, a new one or one that is renamed. Throws with what would be right. */
export function checkAgentId(cfg: PineConfig, id: string): void {
	if (!/^[a-z][a-z0-9_-]{1,30}$/.test(id)) throw new Error(`"${id}" is not a usable agent id: lowercase letters, digits, - and _, starting with a letter, at least two characters`);
	if (cfg.agents[id]) throw new Error(`an agent called ${id} exists already`);
	if (fs.existsSync(path.join(cfg.home, "agents", id))) throw new Error(`the folder agents/${id} exists already`);
	if (fs.existsSync(path.join(cfg.home, "sandbox", id))) throw new Error(`the folder sandbox/${id} exists already`);
}

/** The prefixes of what pine stores per conversation as "<prefix>:<agent>:<conversation>". */
const BY_CONVERSATION = ["taint", "keep", "folder", "group", "worktree", "todos", "turns", "undone", "prefix", "note", "branch", "visited", "goal", "swarm", "bookmarks"];

/**
 * Give an agent another id, and with it everything that carries its name, so that nothing is
 * left under the old one: its folder and private home, the routes that wake it and topics of its
 * own sources and schedules in them, its name in the lists of others, `main` in pine.json, the
 * names of the secrets pine kept for it in .env, what is stored under its name (marks, lists,
 * turns, goals, tasks, pins, open tabs, what its sources kept), the folders under `data/` named
 * after it and the recorded states of its folders. It is `eraseAgent` the other way round: what
 * one takes away, the other moves. The agent must not be at work: `AgentManager.renameAgent`
 * stops what runs under the old name first and starts it again under the new one.
 *
 * Its conversations keep their history: pi finds a session by the folder it was started in, so
 * where that was inside the agent's folder, the session file's header moves with it. What was
 * said in them is left as it was, old paths included.
 */
export function renameAgent(cfg: PineConfig, store: { kv: Kv; tasks: TaskStore; boards?: Boards }, from: string, wanted: string): { id: string; routes: string[]; addresses: string[]; problem?: string } {
	const agent = cfg.agents[from];
	if (!agent) throw new Error(`there is no agent "${from}"`);
	const to = wanted.trim();
	if (to === from) throw new Error(`the agent is called ${from} already`);
	checkAgentId(cfg, to);
	const main = mainAgentId(cfg);
	const before = agent.dir;
	const after = path.join(cfg.home, "agents", to);
	// A path inside its folder moves with it, written as it was given or as the system resolves it (/var and /private/var on a Mac).
	const bases = [...new Set([before, realish(before)])];
	const moved = (s: string) => {
		for (const b of bases) if (s === b || s.startsWith(`${b}${path.sep}`)) return path.join(path.dirname(b), to) + s.slice(b.length);
		return s;
	};
	const deep = (v: unknown): any => (typeof v === "string" ? moved(v) : Array.isArray(v) ? v.map(deep) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);
	// The topics of its own sources and schedules: "source/papers@helper/..." and "timer/weekly@helper".
	const topic = (t: string) => t.split("/").map((seg) => (seg.endsWith(`@${from}`) ? `${seg.slice(0, -from.length)}${to}` : seg)).join("/");

	// Its own file: the secrets it refers to by the names pine gave them, and paths inside its folder.
	const secrets: Array<[string, string]> = [];
	const renamed = (value: unknown, a: string, b: string) => {
		if (value !== `\${${a}}`) return value;
		secrets.push([a, b]);
		return `\${${b}}`;
	};
	editJson(path.join(before, "agent.json"), (raw) => {
		for (const [name, entry] of Object.entries<any>(raw.sources ?? {})) if (entry && typeof entry === "object") for (const [k, v] of Object.entries(entry)) entry[k] = renamed(v, secretName("SOURCE", name, from, k), secretName("SOURCE", name, to, k));
		for (const [name, entry] of Object.entries<any>(raw.mcp ?? {})) if (entry?.env && typeof entry.env === "object") for (const [k, v] of Object.entries(entry.env)) entry.env[k] = renamed(v, secretName("MCP", name, from, k), secretName("MCP", name, to, k));
		for (const k of Object.keys(raw)) raw[k] = deep(raw[k]);
	});
	renameEnv(cfg.home, secrets);

	// pine.json: the routes that wake it or listen to its own sources and schedules, the lists of all agents' sources and servers, and which agent is the main one.
	const routes = cfg.routes.filter((r) => r.agent === from || r.of === from || r.run?.agent === from || r.on.some((t) => topic(t) !== t || t.startsWith(`state/agent/${from}/`))).map((r) => r.name);
	// A route of its own writes its state and publishes under its name: those follow too.
	const stateKey = (k: string) => (k.startsWith(`agent/${from}/`) ? `agent/${to}/${k.slice(`agent/${from}/`.length)}` : k);
	const onTopic = (t: string) => (t.startsWith(`state/agent/${from}/`) ? `state/${stateKey(t.slice("state/".length))}` : topic(t));
	const keepMain = main === from ? to : main;
	editJson(path.join(cfg.home, "pine.json"), (raw) => {
		for (const r of Array.isArray(raw.routes) ? raw.routes : []) {
			if (!r || typeof r !== "object") continue;
			if (r.agent === from) r.agent = to;
			if (r.of === from) r.of = to;
			if (r.run && typeof r.run === "object" && r.run.agent === from) r.run.agent = to;
			if (r.publish && typeof r.publish.topic === "string") r.publish.topic = stateKey(topic(r.publish.topic));
			if (r.set && typeof r.set === "object") r.set = Object.fromEntries(Object.entries(r.set).map(([k, v]) => [stateKey(k), v]));
			if (typeof r.on === "string") r.on = onTopic(r.on);
			else if (Array.isArray(r.on)) r.on = r.on.map((x: unknown) => (typeof x === "string" ? onTopic(x) : x));
		}
		for (const key of ["sources", "mcp"]) for (const entry of Object.values<any>(raw[key] ?? {})) if (Array.isArray(entry?.agents)) entry.agents = entry.agents.map((a: unknown) => (a === from ? to : a));
		// Which agent is the main one does not change with a name: where it followed from the names alone, it is written down now.
		if (main === from || (raw.main === undefined && main !== "main")) raw.main = keepMain;
	});
	for (const r of cfg.routes) {
		if (r.agent === from) r.agent = to;
		if (r.of === from) r.of = to;
		if (r.run?.agent === from) r.run.agent = to;
		if (r.publish) r.publish.topic = stateKey(topic(r.publish.topic));
		if (r.set) r.set = Object.fromEntries(Object.entries(r.set).map(([k, v]) => [stateKey(k), v]));
		r.on = r.on.map(onTopic);
	}
	for (const entry of [...Object.values(cfg.sources), ...Object.values(cfg.mcp)]) if (entry.agents?.includes(from)) entry.agents = entry.agents.map((a) => (a === from ? to : a));
	if (cfg.main !== undefined || main !== "main") cfg.main = keepMain;
	// Whom the others may hand work to.
	for (const other of namedBy(cfg, from).delegators) {
		const a = cfg.agents[other];
		a.delegates = a.delegates.map((d) => (d === from ? to : d));
		editJson(path.join(a.dir, "agent.json"), (raw) => {
			if (Array.isArray(raw.delegates)) raw.delegates = raw.delegates.map((d: unknown) => (d === from ? to : d));
		});
	}

	// What is stored under its name.
	const kv = store.kv;
	const rekey = (a: string, b: string, value: unknown = kv.get(a)) => {
		kv.set(a, null);
		if (value !== undefined && value !== null) kv.set(b, value);
	};
	for (const prefix of BY_CONVERSATION) {
		for (const key of kv.keys(`${prefix}:${from}:`)) {
			const value = deep(kv.get(key));
			if ((prefix === "goal" || prefix === "swarm") && value && typeof value === "object") value.agent = to;
			rekey(key, `${prefix}:${to}:${key.slice(prefix.length + from.length + 2)}`, value);
		}
	}
	rekey(`groups:${from}`, `groups:${to}`);
	for (const key of kv.keys("timer:")) if (key.endsWith(`@${from}`)) rekey(key, `${key.slice(0, -from.length)}${to}`);
	for (const key of kv.keys("source:")) {
		const [name, ...rest] = key.slice("source:".length).split(":");
		if (name.endsWith(`@${from}`)) rekey(key, ["source", `${name.slice(0, -from.length)}${to}`, ...rest].join(":"));
	}
	// Which slot of a model server held one of its conversations: given up, as when the conversation ends (src/slots.ts).
	for (const book of ["slots", "slot-pages"]) {
		const held = kv.get<Record<string, Array<{ who?: string; what?: string } | null | undefined>>>(book);
		if (held) kv.set(book, Object.fromEntries(Object.entries(held).map(([server, list]) => [server, list.map((o) => (o && (String(o.who).startsWith(`${from}:`) || String(o.what).startsWith(`${from}:`)) ? null : o))])));
	}
	const pinned = kv.get<string[]>("conversations:pinned");
	if (Array.isArray(pinned) && pinned.some((x) => x.startsWith(`${from}:`))) kv.set("conversations:pinned", pinned.map((x) => (x.startsWith(`${from}:`) ? `${to}${x.slice(from.length)}` : x)));
	const ui = kv.get<{ tabs?: Array<{ agent: string }> }>("ui:tabs");
	if (ui && Array.isArray(ui.tabs) && ui.tabs.some((t) => t.agent === from)) kv.set("ui:tabs", { ...ui, tabs: ui.tabs.map((t) => (t.agent === from ? { ...t, agent: to } : t)) });
	store.tasks.renameAgent(from, to);
	store.boards?.renameAgent(from, to);

	// The folders under data/ named after it, and the recorded states of its folders, which are found by the folder's path.
	for (const base of [path.join(cfg.dataDir, "programs"), path.join(cfg.dataDir, "browser-local"), path.join(cfg.dataDir, "browser-view")]) {
		for (const name of fs.existsSync(base) ? fs.readdirSync(base) : []) {
			const plain = decodeURIComponent(name);
			if (plain.startsWith(`${from}:`)) fs.renameSync(path.join(base, name), path.join(base, encodeURIComponent(`${to}${plain.slice(from.length)}`)));
		}
	}
	const kept = path.join(cfg.dataDir, "sources");
	for (const name of fs.existsSync(kept) ? fs.readdirSync(kept) : []) if (name.endsWith(`@${from}`)) fs.renameSync(path.join(kept, name), path.join(kept, `${name.slice(0, -from.length)}${to}`));
	const snapshots = path.join(cfg.dataDir, "snapshots");
	for (const name of fs.existsSync(snapshots) ? fs.readdirSync(snapshots) : []) {
		let root = "";
		try {
			root = fs.readFileSync(path.join(snapshots, name, "pine-folder"), "utf8").trim();
		} catch {
			continue;
		}
		const now = moved(root);
		if (now === root) continue;
		const place = placeOf(snapshots, now);
		fs.rmSync(place, { recursive: true, force: true });
		fs.renameSync(path.join(snapshots, name), place);
		fs.writeFileSync(path.join(place, "pine-folder"), now);
	}

	// pi's session files say where they were started, and pi resumes only a session started in the folder it is in.
	const sessions = path.join(before, "sessions");
	const files = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith(".jsonl") ? [path.join(dir, e.name)] : [])) : []);
	for (const file of files(sessions)) {
		const text = fs.readFileSync(file, "utf8");
		const end = text.indexOf("\n");
		const first = end < 0 ? text : text.slice(0, end);
		let header: any;
		try {
			header = JSON.parse(first);
		} catch {
			continue;
		}
		if (header?.type !== "session" || typeof header.cwd !== "string" || moved(header.cwd) === header.cwd) continue;
		header.cwd = moved(header.cwd);
		fs.writeFileSync(file, JSON.stringify(header) + (end < 0 ? "" : text.slice(end)), { mode: fs.statSync(file).mode & 0o777 });
	}

	// Its folder and its private home.
	fs.renameSync(before, after);
	if (fs.existsSync(path.join(cfg.home, "sandbox", from))) fs.renameSync(path.join(cfg.home, "sandbox", from), path.join(cfg.home, "sandbox", to));
	const addresses = Object.entries(agent.sources).filter(([, s]) => s.type === "webhook").map(([name]) => `/hook/${name}@${to}`);
	delete cfg.agents[from];
	let problem: string | undefined;
	try {
		const fresh = loadConfig(cfg.home);
		cfg.agents[to] = fresh.agents[to];
	} catch (e) {
		problem = errText(e);
		// pine goes on with the agent as it was, under its new name and in its new folder, until the configuration is corrected.
		cfg.agents[to] = { ...agent, id: to, dir: after, workspace: moved(agent.workspace) };
	}
	return { id: to, routes, addresses, problem };
}

// ---- routes --------------------------------------------------------------------------------------

/** A route as the main agent proposes it: a few named values, the same ones `pine.json` takes. */
export interface RouteInput {
	name: string;
	/** Topic patterns it listens to, separated by commas. */
	on: string;
	/** Only events that match, as JSON: {"payload.open": true}. */
	when?: string;
	throttle?: string;
	debounce?: string;
	/** Wake an agent with a prompt. */
	agent?: string;
	prompt?: string;
	session?: string;
	/** Write shared state, as JSON: {"house/mode": "{{payload.value}}"}. */
	set?: string;
	publish_topic?: string;
	publish_payload?: string;
	/** One model call without tools. */
	call_prompt?: string;
	call_system?: string;
	call_model?: string;
	/** Typed questions about each event, as JSON: {"urgent": {"type": "yesno", "question": "..."}}. */
	ask_questions?: string;
	ask_model?: string;
	/** A source of all agents whose type answers typed questions, instead of a model. */
	/** What the questions are about, as a template. Default: the event's payload. */
	ask_data?: string;
	/** A command run in an agent's sandbox, with no model, given the event as JSON on stdin. */
	run_command?: string;
	/** The agent in whose sandbox and workspace it runs. Default: the main agent. */
	run_agent?: string;
	trust?: string;
}

const object = (text: string | undefined, what: string): Record<string, unknown> | undefined => {
	if (text === undefined || text.trim() === "") return undefined;
	let v: unknown;
	try {
		v = JSON.parse(text);
	} catch {
		throw new Error(`"${what}" must be JSON, for example {"payload.open": true}`);
	}
	if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`"${what}" must be a JSON object, for example {"payload.open": true}`);
	return v as Record<string, unknown>;
};

/** Check a proposed route and say what it does, line by line. Nothing is written. */
export function checkRoute(cfg: PineConfig, input: RouteInput, models: string[], own?: string): { entry: Record<string, unknown>; lines: string[]; wider?: string } {
	const name = String(input.name ?? "").trim();
	if (!/^[a-z][a-z0-9_-]{0,39}$/.test(name)) throw new Error(`"${name}" is not a usable route name: lowercase letters, digits, - and _, starting with a letter`);
	if (cfg.routes.some((r) => r.name === name)) throw new Error(`a route called "${name}" exists already. remove_route takes it out; then add it again with what you want changed`);
	const on = String(input.on ?? "").split(",").map((x) => x.trim()).filter(Boolean);
	if (!on.length) throw new Error('"on" is the topic the route listens to, for example source/house/message. The sources tool shows a source\'s topic');
	const entry: Record<string, unknown> = { name, on: on.length === 1 ? on[0] : on };
	const lines = [`on ${on.join(", ")}`];
	// An agent other than the main one makes routes of its own: on its own sources' events and its own
	// state, acting within itself. Everything else of a route is pine-wide, and the main agent's to make.
	const mine = own ? Object.keys(cfg.agents[own]?.sources ?? {}) : [];
	const ownSource = (t: string, prefix: string) => t.startsWith(prefix) && mine.some((n) => t.slice(prefix.length).split("/")[0] === `${n}@${own}`);
	if (own) {
		const wrong = on.find((t) => !ownSource(t, "source/") && !t.startsWith(`state/agent/${own}/`));
		if (wrong) throw new Error(`"${wrong}" is not an event of yours. A route of yours listens to your own sources (source/<name>@${own}/..., the sources tool lists them: ${mine.map((n) => `${n}@${own}`).join(", ") || "you have none yet, add_source makes one"}) or your own shared state (state/agent/${own}/...). Other routes are the main agent's to make`);
		if (input.trust !== undefined && input.trust !== "") throw new Error('a route of yours takes no "trust": its events keep the trust they came with');
		if (input.agent && input.agent !== own) throw new Error(`a route of yours wakes only you (${own})`);
		if (input.run_agent && input.run_agent !== own) throw new Error(`a route of yours runs its command only in your own sandbox (${own})`);
		const keys = Object.keys(object(input.set, "set") ?? {});
		const outside = keys.find((k) => !k.startsWith(`agent/${own}/`));
		if (outside) throw new Error(`"${outside}" is not your shared state: a route of yours writes keys under agent/${own}/`);
		const topic = input.publish_topic?.trim();
		if (topic && !ownSource(topic, "out/source/")) throw new Error(`a route of yours publishes only through your own sources (out/source/<name>@${own}, a source that can send). To keep what it found, write your shared state with "set" (keys under agent/${own}/)`);
		entry.of = own;
		lines.push(`a route of ${own}'s`);
	}
	const when = object(input.when, "when");
	if (when) {
		entry.when = when;
		lines.push(`only when ${JSON.stringify(when)}`);
	}
	for (const [key, given] of [["throttleMs", input.throttle], ["debounceMs", input.debounce]] as const) {
		if (given === undefined || given === "") continue;
		try {
			if (!(parseDuration(given) > 0)) throw new Error("not a time");
		} catch {
			throw new Error(`"${key === "throttleMs" ? "throttle" : "debounce"}" is a time such as 10s or 5m`);
		}
		entry[key] = given;
		lines.push(key === "throttleMs" ? `after one event, ignore the next for ${given}` : `wait until ${given} have passed without a new event, then handle the last one`);
	}
	const set = object(input.set, "set");
	if (set) {
		entry.set = set;
		lines.push(`set shared state: ${JSON.stringify(set)}`);
	}
	if (input.call_prompt) {
		if (input.call_model && !models.includes(input.call_model)) throw new Error(`there is no model "${input.call_model}". Models: ${models.slice(0, 40).join(", ")}`);
		entry.call = { ...(input.call_model ? { model: input.call_model } : {}), ...(input.call_system ? { system: input.call_system } : {}), prompt: input.call_prompt };
		lines.push(`one model call without tools${input.call_model ? ` (${input.call_model})` : ""}: ${input.call_prompt}`);
	} else if (input.call_system || input.call_model) throw new Error('a model call needs "call_prompt": what the model is asked');
	if (input.ask_questions) {
		if (entry.call) throw new Error("a route makes a model call or asks typed questions, not both");
		const ask: Record<string, unknown> = { questions: object(input.ask_questions, "ask_questions") };
		if (input.ask_model) ask.model = input.ask_model;
		if (input.ask_data !== undefined && input.ask_data !== "") {
			try {
				ask.data = JSON.parse(input.ask_data);
			} catch {
				ask.data = input.ask_data;
			}
		}
		const wrong = askProblem(ask);
		if (wrong) throw new Error(wrong);
		const decider = input.ask_model ? cfg.decisions[input.ask_model] : undefined;
		if (!decider) throw new Error(input.ask_model ? `there is no decision model "${input.ask_model}". ${Object.keys(cfg.decisions).join(", ") || "There is none: the main agent adds one with add_decision_model"}` : `typed questions need "ask_model": the decision model that answers, by its name. ${Object.keys(cfg.decisions).join(", ") || "There is none: the main agent adds one with add_decision_model"}`);
		if (!input.publish_topic && !input.set && !input.run_command) throw new Error('typed questions need "run_command" (a script acts on the answers, with no model), "publish_topic" (the answers go out as an event, and a second route filters on payload.answers.<name>) or "set" (the answers go into shared state: {"agent/main/answer": "{{answers}}"})');
		entry.ask = ask;
		const questions = ask.questions as AskQuestions;
		const shown = ask.data === undefined ? "the event's whole payload" : `${JSON.stringify(ask.data)}`;
		lines.push(`ask the decision model ${input.ask_model} about ${shown}: ${Object.entries(questions).map(([n, q]) => `${n} (${q.type}): ${q.question}`).join("; ")}`);
		lines.push(`what it is asked about goes to ${whereIs(decider)}`);
	} else if (input.ask_model || input.ask_data) throw new Error('typed questions need "ask_questions"');
	if (input.run_command) {
		const command = input.run_command.trim();
		if (/\{\{/.test(command)) throw new Error("run_command is fixed text: the command is given the event (and the answers, the model's result) as JSON on stdin, so leave {{...}} out of it");
		const runAgent = input.run_agent || own || mainAgentId(cfg);
		if (!cfg.agents[runAgent]) throw new Error(`there is no agent "${runAgent}". Agents: ${Object.keys(cfg.agents).join(", ")}`);
		entry.run = { command, ...(input.run_agent || own ? { agent: runAgent } : {}) };
		lines.push(`run in ${runAgent}'s sandbox and workspace, with no model: ${command}`);
		lines.push(`it is given the event${entry.ask ? ", the answers" : ""}${entry.call ? ", the model's answer" : ""} as JSON on stdin; what it prints is {{output}}`);
	} else if (input.run_agent) throw new Error('"run_agent" belongs to "run_command": what is run');
	if (input.publish_topic) {
		const topic = input.publish_topic.trim();
		if (matchesAny(RESERVED_TOPICS, topic)) throw new Error(`"${topic}" is a topic only pine itself publishes on. Pick one of your own, for example cam/classified`);
		let payload: unknown;
		if (input.publish_payload !== undefined && input.publish_payload !== "") {
			try {
				payload = JSON.parse(input.publish_payload);
			} catch {
				payload = input.publish_payload;
			}
		}
		entry.publish = { topic, ...(payload !== undefined ? { payload } : {}) };
		lines.push(`publish the event ${topic}${payload !== undefined ? ` with ${JSON.stringify(payload)}` : ""}${topic.startsWith("out/") ? " (this sends through a source)" : ""}`);
	} else if (input.publish_payload) throw new Error('publishing needs "publish_topic"');
	if (input.agent) {
		if (!cfg.agents[input.agent]) throw new Error(`there is no agent "${input.agent}". Agents: ${Object.keys(cfg.agents).join(", ")}`);
		if (entry.call) throw new Error("a route makes a model call or wakes an agent, not both. Let the call publish the result, and a second route wake the agent on that topic");
		entry.agent = input.agent;
		if (input.prompt) entry.prompt = input.prompt;
		if (input.session) entry.session = input.session;
		lines.push(`wake the agent ${input.agent}${input.session ? ` (conversation: ${input.session})` : ""}${input.prompt ? ` with: ${input.prompt}` : " with the event"}`);
	} else if (input.prompt || input.session) throw new Error('"prompt" and "session" belong to "agent": name the agent the route wakes');
	if (entry.ask && entry.agent) throw new Error("a route asks typed questions or wakes an agent, not both. Let it publish the answers, and a second route wake the agent when payload.answers.<name> is what you want");
	if (!entry.set && !entry.call && !entry.publish && !entry.agent && !entry.run) throw new Error("a route has to do something: give at least one of agent (wake an agent), run_command (run a script, no model), set (write shared state), publish_topic (publish another event), call_prompt (one model call)");
	let wider: string | undefined;
	if (input.trust !== undefined && input.trust !== "") {
		if (input.trust !== "owner" && input.trust !== "untrusted") throw new Error('"trust" is owner or untrusted. Leave it out: an event keeps the trust it came with');
		entry.trust = input.trust;
		if (input.trust === "owner") {
			lines.push("treat every event on it as your own words");
			wider = `events on ${on.join(", ")} are then treated as coming from you: whoever can make such an event gets the agent's full tool set`;
		}
	}
	return { entry, lines, wider };
}

/** Write a checked route into pine.json and take it over. If the configuration does not load with it, the file is as it was. */
export function addRoute(cfg: PineConfig, entry: Record<string, unknown>): RouteConfig {
	const file = path.join(cfg.home, "pine.json");
	const before = fs.readFileSync(file, "utf8");
	try {
		editJson(file, (raw) => {
			raw.routes = Array.isArray(raw.routes) ? raw.routes : [];
			raw.routes.push(entry);
		});
		const made = loadConfig(cfg.home).routes.find((r) => r.name === entry.name);
		if (!made) throw new Error("the route was not found after writing it");
		cfg.routes.push(made);
		return made;
	} catch (e) {
		fs.writeFileSync(file, before);
		throw new Error(`not added: ${errText(e)}`);
	}
}

/**
 * Put a changed route in the place of one by its name, in one write: the old one stays where it was
 * if the new one does not load. The routes that stay keep their names, as with dropRoute.
 */
export function replaceRoute(cfg: PineConfig, name: string, entry: Record<string, unknown>): RouteConfig {
	const file = path.join(cfg.home, "pine.json");
	const before = fs.readFileSync(file, "utf8");
	try {
		editJson(file, (raw) => {
			const named = (Array.isArray(raw.routes) ? raw.routes : []).map((r: any, i: number) => (r && typeof r === "object" && r.name === undefined ? { name: `route${i}`, ...r } : r));
			const at = named.findIndex((r: any) => r?.name === name);
			if (at < 0) throw new Error(`there is no route "${name}"`);
			named[at] = entry;
			raw.routes = named;
		});
		const made = loadConfig(cfg.home).routes.find((r) => r.name === entry.name);
		if (!made) throw new Error("the route was not found after writing it");
		cfg.routes.splice(cfg.routes.findIndex((r) => r.name === name), 1, made);
		return made;
	} catch (e) {
		fs.writeFileSync(file, before);
		throw new Error(`not changed: ${errText(e)}`);
	}
}

/** Take a route out of pine.json by its name. The routes that stay keep their names, also those that had none of their own. */
export function dropRoute(cfg: PineConfig, name: string): boolean {
	if (!cfg.routes.some((r) => r.name === name)) return false;
	editJson(path.join(cfg.home, "pine.json"), (raw) => {
		if (!Array.isArray(raw.routes)) return;
		const named = raw.routes.map((r: any, i: number) => (r && typeof r === "object" && r.name === undefined ? { name: `route${i}`, ...r } : r));
		raw.routes = named.filter((r: any) => r?.name !== name);
		if (!raw.routes.length) delete raw.routes;
	});
	cfg.routes.splice(0, cfg.routes.length, ...cfg.routes.filter((r) => r.name !== name));
	return true;
}

/** The routes as a list for the agent. */
export function routesText(cfg: PineConfig): string {
	const does = (r: RouteConfig) =>
		[r.set ? `sets ${JSON.stringify(r.set)}` : "", r.call ? `asks a model: ${r.call.prompt}` : "", r.ask ? `asks the decision model ${r.ask.model}: ${Object.entries(r.ask.questions).map(([n, q]) => `${n} (${q.type})`).join(", ")}` : "", r.run ? `runs "${r.run.command}" in ${r.run.agent ?? mainAgentId(cfg)}'s sandbox` : "", r.publish ? `publishes ${r.publish.topic}` : "", r.agent ? `wakes ${r.agent}${r.session ? ` (conversation: ${r.session})` : ""}${r.prompt ? ` with: ${r.prompt}` : ""}` : ""].filter(Boolean).join("; ");
	return cfg.routes.map((r) => `- ${r.name}: on ${r.on.join(", ")}${r.when ? ` when ${JSON.stringify(r.when)}` : ""}${r.throttleMs ? ` · at most one per ${ms(r.throttleMs)}` : ""}${r.debounceMs ? ` · after ${ms(r.debounceMs)} of quiet` : ""}${r.trust === "owner" ? " · its events count as the owner's words" : ""}\n    ${does(r)}`).join("\n");
}

/** What an agent has, as its files say it: what goes with it when it is removed. */
export function holdingsOf(cfg: PineConfig, id: string): { conversations: string[]; sources: string[]; servers: string[]; schedules: string[]; skills: string[]; routes: string[]; files: number; outside: boolean } {
	const agent = cfg.agents[id];
	if (!agent) throw new Error(`there is no agent "${id}"`);
	const names = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => !n.startsWith(".")) : []);
	return {
		conversations: names(path.join(agent.dir, "sessions")).filter((n) => !/\.reset-\d+$/.test(n) && !n.endsWith("~u") && !n.startsWith("_t")).sort((a, b) => Number(b === "main") - Number(a === "main") || a.localeCompare(b)),
		sources: Object.keys(agent.sources),
		servers: Object.keys(agent.mcp),
		schedules: agent.schedules.map((s) => s.name),
		skills: names(path.join(agent.dir, "skills")),
		routes: cfg.routes.filter((r) => r.agent === id || r.of === id || r.run?.agent === id).map((r) => r.name),
		files: countFiles(agent.workspace),
		outside: !isInside(realish(agent.dir), realish(agent.workspace)),
	};
}

/** How many files lie in a folder, without following links. Stops counting at a limit. */
export function countFiles(dir: string, limit = 5000): number {
	let n = 0;
	const walk = (d: string) => {
		let entries: fs.Dirent[] = [];
		try {
			entries = fs.readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (n >= limit) return;
			if (e.isDirectory()) walk(path.join(d, e.name));
			else n++;
		}
	};
	walk(dir);
	return n;
}

// ---- pine's settings -----------------------------------------------------------------------------

interface Setting {
	/** A few words that name it, for a list an owner reads. */
	title: string;
	/** What it does, in a sentence or two that need no other page to be understood. One that takes one of a few words says each on a line of its own. */
	about: string;
	/** What a value has to be. */
	kind: "model" | "theme" | "view" | "boolean" | "duration" | { one: string[] } | { from: number; to: number };
	/** What is in force now, in the words the setting is written in. */
	now(cfg: PineConfig): string;
	/** Whether a new value holds at once. Otherwise it is saved and holds from the next start of pine. */
	live: boolean;
	/** What a value gives up, if it gives something up: said to the owner with the question. */
	wider?(value: unknown): string | undefined;
}

const ms = (n: number) => (n % 60_000 === 0 ? `${n / 60_000}m` : n % 1000 === 0 ? `${n / 1000}s` : `${n}ms`);

/**
 * The settings in pine.json that the main agent and the owner's settings page can change: what
 * an owner decides. Each has a few words that name it (`title`) and a sentence or two anybody
 * can read (`about`), addressed to nobody, since the agent and the owner both read them.
 *
 * Not here on purpose: the control API (address, port, token), secrets, the lists that have
 * tools of their own (sources, MCP servers, skills, schedules, source types, model servers,
 * agents), and what tunes pine to a model server or guards against a loop
 * (`limits.warmSlots`, `limits.slotPages`, `limits.maxDelegationDepth` and the other
 * limits that are not about how much works at once). Those have defaults that are right for nearly everybody, and are
 * changed in pine.json by hand (docs/references/configuration.md).
 */
export const SETTINGS: Record<string, Setting> = {
	"defaults.model": { title: "Model", about: "The model all agents run on, unless an agent is set to a different one.", kind: "model", now: (c) => String(c.defaults.model ?? "none"), live: true },
	"defaults.thinking": { title: "Reasoning", about: "How much a model thinks before it answers, for all agents that do not set their own. A higher level takes longer. A model that cannot reason ignores it.", kind: { one: THINKING }, now: (c) => c.defaults.thinking, live: true },
	"defaults.mode": {
		title: "Mode",
		about: "How freely agents work, for all agents that do not set their own.\nauto: no sandbox, the whole account and the network; only critical actions ask.\nsafe: in the sandbox, only the agent's own folders.\nmanual: like safe, and every action asks.\nbypass: like auto, and nothing asks.\nplan: it reads and plans and changes nothing.\nNot set: auto for the main agent, safe for the others.",
		kind: { one: [...MODES] },
		now: (c) => c.defaults.mode ?? `not set (${mainAgentId(c)}: auto, the other agents: safe)`,
		live: true,
		wider: (v) => (v === "bypass" ? "in bypass mode no agent asks, and the shell of all agents reaches your whole account and the network" : v === "auto" ? "all agents that name no mode then work without a sandbox: their shell and file tools reach your whole account and the network" : undefined),
	},
	"defaults.judge": { title: "Judge of goal mode", about: "In goal mode (/goal) a model says after each round whether the goal is met. This is that model. Not set: the agent's own model.", kind: "model", now: (c) => c.defaults.judge ?? "not set (the agent's own model)", live: true },
	"defaults.checker": { title: "Check of a swarm's answer", about: "In a swarm (/swarm) a sub-agent that did none of the work checks the answer before the swarm is done. This is the model it runs on. Another model than the agent's does not share its misreadings. Not set: the agent's own model.", kind: "model", now: (c) => c.defaults.checker ?? "not set (the agent's own model)", live: true },
	"defaults.introduce": { title: "Agents introduce themselves", about: "Agents introduce themselves in their first answer to the owner, once each.", kind: "boolean", now: (c) => String(c.defaults.introduce), live: true },
	"defaults.browser": {
		title: "Browser",
		about: "Which browser agents use in the owner's own conversations.\npine: pine's own browser, without the owner's logins.\nchrome: the owner's own browser (Chrome, Brave or Edge) whenever it runs with pine's extension: a tab group there, with the owner's logins. An agent can also move there and back in one conversation when asked to.",
		kind: { one: ["pine", "chrome"] },
		now: (c) => c.defaults.browser ?? "pine",
		live: true,
		wider: (v) => (v === "chrome" ? "agents then browse in your own browser, logged in as you wherever you are logged in, and without the guard that keeps pine's own browser off your local network" : undefined),
	},
	"defaults.bashTimeoutSec": { title: "Longest shell command", about: "Seconds a shell command may run before it is ended. 900 is 15 minutes. A command started in the background is not held to it.", kind: { from: 5, to: 86_400 }, now: (c) => String(c.defaults.bashTimeoutSec), live: false },
	"defaults.taskTimeoutSec": { title: "Longest task", about: "Seconds an agent may work on one message or event before it is stopped. 7200 is two hours.", kind: { from: 30, to: 604_800 }, now: (c) => String(c.defaults.taskTimeoutSec), live: false },
	"limits.maxConcurrentRuns": { title: "Agents at work at once", about: "How many agents and sub-agents work at the same time, all conversations together; the others wait their turn. An agent that only waits (for its sub-agents, another agent or an approval) does not count. With a local model, set it to how many requests the model server answers side by side: more only makes each slower.", kind: { from: 1, to: 64 }, now: (c) => String(c.limits.maxConcurrentRuns), live: false },
	"limits.maxSubagents": { title: "Sub-agents at a time", about: "How many sub-agents one conversation runs at the same time, for all agents that do not set their own. More tasks wait for a free place. They also count towards Agents at work at once.", kind: { from: 1, to: 32 }, now: (c) => String(c.limits.maxSubagents), live: true },
	"limits.maxPoolTasks": { title: "Largest batch of sub-agent tasks", about: "When an agent splits a big job into many tasks (one per file, say), sub-agents work through at most this many in one go, a few at a time.", kind: { from: 1, to: 1000 }, now: (c) => String(c.limits.maxPoolTasks), live: true },
	"limits.maxDownloadMb": { title: "Largest download", about: "The largest file an agent may download, in megabytes.", kind: { from: 1, to: 100_000 }, now: (c) => String(c.limits.maxDownloadMb), live: true },
	"security.askAccess": { title: "Ask when an agent needs more", about: "When an agent in the sandbox needs a file or folder outside it, or the network, pine asks the owner whether to allow it. Off: nothing is asked, and the agent gets more only by asking for it itself.", kind: "boolean", now: (c) => String(c.security.askAccess), live: true },
	"security.approvalTimeout": { title: "How long an approval waits", about: "How long a request for approval waits for an answer, for example 5m. After that it counts as a no. An agent's question is no approval: the owner answers it with a message.", kind: "duration", now: (c) => ms(c.security.approvalTimeoutMs), live: false },
	"security.taint": {
		title: "Outside content",
		about: "After a conversation has read something from outside (a web page, a mail, somebody else's message), pine asks before the agent sends anything out. This says how long that lasts.\nsession: until the conversation is reset.\nrun: only until that one task is done.\noff: never, which takes this protection away.",
		kind: { one: ["session", "run", "off"] },
		now: (c) => c.security.taint,
		live: true,
		wider: (v) => (v === "off" ? "with off, outside content is never marked, and nothing that depends on the mark protects you" : v === "run" ? "with run, the mark is gone with the next message although what was read is still in the conversation" : undefined),
	},
	"security.bypassWhenTainted": {
		title: "Bypass after outside content",
		about: "Off: an agent in bypass mode works as in auto mode once the conversation has read something from outside, so critical actions ask again. On: bypass stays, and nothing asks.",
		kind: "boolean",
		now: (c) => String(c.security.bypassWhenTainted),
		live: true,
		wider: (v) => (v === true ? "an agent in bypass mode then acts without any question on whatever a web page or a message told it" : undefined),
	},
	"ui.theme": {
		title: "Theme",
		about: "The colors of the Pine app: a VS Code color theme, by the theme's file name in the themes folder of pine's home (one-dark-pro for one-dark-pro.json). Any VS Code theme file put there can be chosen.",
		kind: "theme",
		now: (c) => c.ui.theme ?? DEFAULT_THEME,
		live: true,
	},
	"ui.view": {
		title: "View",
		about: "What the Pine app's panel draws: a view, by the view's file name in the views folder of pine's home (office for office.ts), also picked at the top of the panel. off: no panel, and no button for it. Not set: the view whose name comes first.",
		kind: "view",
		now: (c) => c.ui.view ?? `not set (${viewInForce(undefined, listViews(c.home)) ?? "no view"})`,
		live: true,
	},
};

const kindText = (k: Setting["kind"]) => (k === "model" ? "a model, as provider/model" : k === "theme" ? "the name of a theme in the themes folder" : k === "view" ? "the name of a view in the views folder, or off" : k === "boolean" ? "true or false" : k === "duration" ? "a time such as 90s or 5m" : "one" in k ? k.one.join(", ") : `a number from ${k.from} to ${k.to}`);

/** The settings as a list for the agent: name, what is in force, what it is. */
export function settingsText(cfg: PineConfig): string {
	return Object.entries(SETTINGS)
		.map(([key, s]) => `${key} = ${s.now(cfg)}\n    ${s.title}. ${s.about.replaceAll("\n", "\n    ")} Value: ${kindText(s.kind)}.${s.live ? "" : " A change holds from the next start of pine."}`)
		.join("\n");
}

/** Check a value for a setting. "default" (or nothing) means: take the entry out, so that pine's default holds. */
export function checkSetting(cfg: PineConfig, key: string, given: unknown, models: string[]): { key: string; setting: Setting; value: unknown; text: string; wider?: string } {
	const setting = SETTINGS[key];
	if (!setting) throw new Error(`there is no setting "${key}" that you can change. The settings tool lists them: ${Object.keys(SETTINGS).join(", ")}. What an agent has (sources, MCP servers, skills, schedules) and the agents themselves are changed with their own tools.`);
	const raw = typeof given === "string" ? given.trim() : given;
	if (raw === undefined || raw === null || raw === "" || raw === "default") return { key, setting, value: undefined, text: "pine's default" };
	const k = setting.kind;
	let value: unknown;
	if (k === "model") {
		if (!models.includes(String(raw))) throw new Error(`there is no model "${raw}". Models: ${models.slice(0, 40).join(", ")}`);
		value = String(raw);
	} else if (k === "theme") {
		const themes = listThemes(cfg.home);
		const t = themes.find((x) => x.id === String(raw));
		if (!t) throw new Error(`there is no theme "${raw}". Themes: ${themes.filter((x) => !("problem" in x)).map((x) => x.id).join(", ")}`);
		if ("problem" in t) throw new Error(`the theme "${raw}" cannot be drawn: ${t.problem}`);
		value = t.id;
	} else if (k === "view") {
		const views = listViews(cfg.home);
		if (String(raw) === "off") value = "off";
		else {
			const v = views.find((x) => x.id === String(raw));
			if (!v) throw new Error(`there is no view "${raw}". Views: ${[...views.filter((x) => !("problem" in x)).map((x) => x.id), "off"].join(", ")}`);
			if ("problem" in v) throw new Error(`the view "${raw}" cannot be used: ${v.problem}`);
			value = v.id;
		}
	} else if (k === "boolean") {
		if (raw !== true && raw !== false && raw !== "true" && raw !== "false") throw new Error(`${key} is true or false`);
		value = raw === true || raw === "true";
	} else if (k === "duration") {
		let n = Number.NaN;
		try {
			n = parseDuration(String(raw));
		} catch {
			// said below
		}
		if (!(n >= 1000)) throw new Error(`${key} is a time of at least a second, for example 90s or 5m`);
		value = String(raw);
	} else if ("one" in k) {
		if (!k.one.includes(String(raw))) throw new Error(`${key} is one of: ${k.one.join(", ")}`);
		value = String(raw);
	} else {
		const n = Number(raw);
		if (!Number.isInteger(n) || n < k.from || n > k.to) throw new Error(`${key} is a whole number from ${k.from} to ${k.to}`);
		value = n;
	}
	return { key, setting, value, text: String(value), wider: setting.wider?.(value) };
}

/**
 * Write a checked setting into pine.json and take it over. The file is read back through the
 * loader; if the configuration does not load, the file is as it was.
 */
export function applySetting(cfg: PineConfig, checked: { key: string; setting: Setting; value: unknown }): void {
	const file = path.join(cfg.home, "pine.json");
	const before = fs.readFileSync(file, "utf8");
	const [section, name] = checked.key.split(".");
	let fresh: PineConfig;
	try {
		editJson(file, (raw) => {
			raw[section] = typeof raw[section] === "object" && raw[section] ? raw[section] : {};
			if (checked.value === undefined) delete raw[section][name];
			else raw[section][name] = checked.value;
		});
		fresh = loadConfig(cfg.home);
	} catch (e) {
		fs.writeFileSync(file, before);
		throw new Error(`not changed: ${errText(e)}`);
	}
	if (!checked.setting.live) return;
	Object.assign(cfg.defaults, fresh.defaults);
	Object.assign(cfg.limits, fresh.limits);
	Object.assign(cfg.ui, fresh.ui);
	// What a question to the owner waits is read once at the start: it keeps its value until then.
	Object.assign(cfg.security, { ...fresh.security, approvalTimeoutMs: cfg.security.approvalTimeoutMs });
	// What an agent takes from the defaults when it does not say.
	if (checked.key === "defaults.thinking") for (const a of Object.values(cfg.agents)) a.thinking = fresh.agents[a.id]?.thinking ?? a.thinking;
	if (checked.key === "limits.maxSubagents") for (const a of Object.values(cfg.agents)) a.subagents.maxParallel = fresh.agents[a.id]?.subagents.maxParallel ?? a.subagents.maxParallel;
	if (checked.key === "defaults.mode") for (const a of Object.values(cfg.agents)) Object.assign(a, { mode: fresh.agents[a.id]?.mode ?? a.mode, level: fresh.agents[a.id]?.level ?? a.level, modeSet: fresh.agents[a.id]?.modeSet ?? a.modeSet });
}

/**
 * A model's own number of runs at a time (`limits.models`), checked: the server is one there is, by the name its
 * models carry before the "/", the model is one that server has, and the number is one that can be. No number takes
 * the limit off again, and the model is back in the queue for all.
 */
export function checkModelLimit(known: readonly string[], name: unknown, model: unknown, limit: unknown): { name: string; model: string; limit?: number } {
	const server = String(name ?? "").trim();
	if (!SERVER_KEY.test(server) || !known.some((m) => m === server || m.startsWith(`${server}/`))) throw new Error(`there is no model server or provider "${server}". The names are what stands before the "/" of a model: ${[...new Set(known.map((m) => m.split("/")[0]))].slice(0, 30).join(", ") || "none yet"}`);
	// By the id the server gives it, and only one the server has.
	const id = String(model ?? "").trim();
	if ((!MODEL_KEY.test(`${server}/${id}`) || !known.includes(`${server}/${id}`))) throw new Error(`"${server}" has no model "${id}". Its models: ${known.filter((m) => m.startsWith(`${server}/`)).map((m) => m.slice(server.length + 1)).slice(0, 30).join(", ") || "none"}`);
	const of = { name: server, model: id };
	if (limit === undefined || limit === null || limit === "") return of;
	const n = Number(limit);
	if (!modelLimit(n)) throw new Error(`the number of runs at a time is a whole number from 1 to ${MAX_MODEL_RUNS}, or nothing for pine's own limit (limits.maxConcurrentRuns)`);
	return { ...of, limit: n };
}

/** Write a model's checked limit into pine.json and take it over. If the configuration does not load, the file is as it was. */
export function applyModelLimit(cfg: PineConfig, checked: { name: string; model: string; limit?: number }): void {
	const file = path.join(cfg.home, "pine.json");
	const before = fs.readFileSync(file, "utf8");
	const key = `${checked.name}/${checked.model}`;
	let fresh: PineConfig;
	try {
		editJson(file, (raw) => {
			raw.limits = typeof raw.limits === "object" && raw.limits ? raw.limits : {};
			const all: Record<string, unknown> = typeof raw.limits.models === "object" && raw.limits.models && !Array.isArray(raw.limits.models) ? raw.limits.models : {};
			if (checked.limit === undefined) delete all[key];
			else all[key] = checked.limit;
			if (Object.keys(all).length) raw.limits.models = all;
			else delete raw.limits.models;
		});
		fresh = loadConfig(cfg.home);
	} catch (e) {
		fs.writeFileSync(file, before);
		throw new Error(`not changed: ${errText(e)}`);
	}
	cfg.limits.models = fresh.limits.models;
}

/**
 * When the model the agents run on by default cannot answer and one can now, the default becomes
 * one that answers: pi's choice for the provider just signed in to (or the model server just
 * added), else for any. So a sign-in is all it takes to bring the agents to life. A default that
 * answers is the owner's choice and stays. Returns the model chosen, if one was.
 */
export async function settleModel(cfg: PineConfig, manager: AgentManager, log: Logger, provider?: string): Promise<string | undefined> {
	try {
		const available = await manager.availableModels();
		const known = new Set(available);
		const claude = onPath("claude");
		if (!manager.modelProblem(cfg.defaults.model, known, claude)) return undefined;
		const usable = available.filter((m) => !manager.modelProblem(m, known, claude));
		const choices = await piDefaults();
		const chosen = suggestModel(usable, choices, provider) ?? suggestModel(usable, choices);
		if (!chosen) return undefined;
		applySetting(cfg, checkSetting(cfg, "defaults.model", chosen, available));
		await manager.refreshSessions();
		manager.settingChanged("defaults.model");
		log.info(`agents now run on ${chosen} by default: the model before could not answer`);
		return chosen;
	} catch (e) {
		log.warn(`could not choose a model that answers: ${errText(e)}`);
		return undefined;
	}
}

// ---- models of the owner's own servers: added, set up, removed one by one ------------------------
// One road for the main agent's tools and the control API: a plan is checked and says in words what
// it does, before anybody is asked; `apply` writes it. models.json is pi's file: after a change pi
// reads it again, and a model that pi then does not have puts the file back as it was.

/** "server/id" as its two parts. */
export function splitModelRef(ref: unknown): { name: string; id: string } {
	const text = String(ref ?? "").trim();
	const at = text.indexOf("/");
	if (at < 1 || at === text.length - 1) throw new Error(`give the model as server/model, as the models list names it (for example studio/qwen3-coder), not "${text}"`);
	return { name: text.slice(0, at), id: text.slice(at + 1) };
}

async function rewriteModels(cfg: PineConfig, manager: AgentManager, write: () => void, expect?: string): Promise<void> {
	const file = path.join(cfg.home, "models.json");
	const before = fs.readFileSync(file, "utf8");
	write();
	await manager.reloadModels();
	if (expect && !(await manager.availableModels()).includes(expect)) {
		fs.writeFileSync(file, before, { mode: 0o600 });
		await manager.reloadModels();
		throw new Error(`not changed: pine did not find ${expect} in models.json afterwards, so the file is as it was. pine check and pine's log say why`);
	}
}

/** The agents whose conversations run on this model: they start their next turn with the model as it is now. */
const runningOn = (cfg: PineConfig, ref: string) => Object.values(cfg.agents).filter((a) => (a.model ?? cfg.defaults.model) === ref).map((a) => a.id);

export interface ModelPlan {
	/** The model, as "server/id". */
	ref: string;
	/** What happens, in words, for the owner's question. */
	lines: string[];
	apply: () => Promise<void>;
}

/** A model that a server of the owner's own serves and pine does not have yet. The server is asked; nothing is written. */
export async function planModelAdd(cfg: PineConfig, manager: AgentManager, ref: unknown, context?: number): Promise<ModelPlan> {
	const { name, id } = splitModelRef(ref);
	checkContext(context);
	const key = serverKey(cfg.home, name);
	const server = listModelServers(cfg.home).find((s) => s.name === name)!;
	if (server.models.some((m) => m.id === id)) throw new Error(`"${name}/${id}" is there already. To change how it is set up: configure_model`);
	const look = await lookAt(server.baseUrl, key);
	if (look.locked) throw new Error(`the model server "${name}" did not accept the key pine has for it. Nothing was added. Your owner removes the server and adds it again with the right key`);
	const model = look.models.find((m) => m.id === id);
	if (!model) throw new Error(`"${name}" serves no model "${id}". It serves: ${look.models.map((m) => m.id).join(", ")}. A model the server does not list is set up on the server first (loaded, or given a name with --alias)`);
	const size = context ?? model.contextWindow;
	if (!size) throw new Error(`the server does not say how much context ${id} gets. Give it as "context": the number of tokens one request may use, as your owner says (what the server was started with); never a guess`);
	const full = `${name}/${id}`;
	return {
		ref: full,
		lines: [`add the model ${full} of the model server "${name}" at ${server.baseUrl}`, `${size} tokens of context, ${model.images ? "text and pictures" : "text only"}${model.reasoning ? ", reasons" : ""}`],
		apply: () => rewriteModels(cfg, manager, () => addServerModel(cfg.home, name, model, context), full),
	};
}

/** What can be set for one model: its entry (only for a server of the owner's own), and how many runs it takes at a time (for any model). */
export interface ModelSetup extends ModelChange {
	/** Runs at a time on this model (`limits.models`); 0 gives it back to pine's own limit. */
	runs?: number;
}

/** A change to how one model is set up, checked. Nothing is written. */
export async function planModelChange(cfg: PineConfig, manager: AgentManager, ref: unknown, setup: ModelSetup): Promise<ModelPlan> {
	const { name, id } = splitModelRef(ref);
	const full = `${name}/${id}`;
	const { runs, ...change } = setup;
	const entry = Object.values(change).some((v) => v !== undefined);
	const lines: string[] = [];
	if (entry) {
		// Throws for a provider pine signs in to: its models are pi's, as they come.
		serverModel(cfg.home, name, id);
		lines.push(...checkModelChange(cfg.home, name, id, change));
	}
	let limit: ReturnType<typeof checkModelLimit> | undefined;
	if (runs !== undefined) {
		const known = [...new Set([...listModelServers(cfg.home).flatMap((x) => x.models.map((m) => `${x.name}/${m.id}`)), ...(await manager.availableModels())])];
		limit = checkModelLimit(known, name, id, runs === 0 ? undefined : runs);
		const was = cfg.limits.models[full];
		const pine = `pine's own limit (${cfg.limits.maxConcurrentRuns}, shared with every model without a number)`;
		if (was !== limit.limit) lines.push(`runs at a time: ${was ?? pine} -> ${limit.limit ?? pine}`);
	}
	if (!entry && runs === undefined) throw new Error("nothing to change: give at least one of context, max_output, pictures, reasoning, runs");
	if (!lines.length) throw new Error(`nothing changes: ${full} is set up that way already`);
	return {
		ref: full,
		lines: [`change the model ${full}`, ...lines],
		apply: async () => {
			if (entry && lines.some((l) => !l.startsWith("runs at a time"))) await rewriteModels(cfg, manager, () => changeServerModel(cfg.home, name, id, change), full);
			if (limit) applyModelLimit(cfg, limit);
			await manager.refreshSessions(runningOn(cfg, full));
		},
	};
}

/** One model taken out of a server of the owner's own, checked. Nothing is written. */
export function planModelRemove(cfg: PineConfig, manager: AgentManager, ref: unknown): ModelPlan {
	const { name, id } = splitModelRef(ref);
	checkServerModelRemoval(cfg, name, id);
	const full = `${name}/${id}`;
	return {
		ref: full,
		lines: [`remove the model ${full} from pine`, `The server "${name}" and its other models stay${cfg.limits.models[full] !== undefined ? "; its number of runs at a time goes with it" : ""}. Nothing uses it.`],
		apply: () => rewriteModels(cfg, manager, () => removeServerModel(cfg, name, id)),
	};
}
