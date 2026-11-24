// What the search of Settings finds, and where each thing is. A page asks the daemon for what it shows only
// when it is open, so the search cannot look at the pages: it has an index of its own. Two parts:
// - PLACES: what the page itself draws (the app's own switches, a page's sections, an agent's fields). Each
//   names the element it points at by a selector, which `test/settings-index.test.ts` finds in the page's source.
// - liveEntries(): what pine has (its settings, agents, providers, servers, skills, sources, schedules, routes,
//   machines), built from the lists the pages ask for anyway.
// No React, no store: the palette and the tests use it too.
import type { AgentInfo, McpServer, ModelServer, Provider, Route, Schedule, Setting, Skill, SourceInfo } from "./api.ts";
import { providerName, providerWords } from "./providers.ts";
import { fuzzy } from "./text.ts";

/** Where a found thing is: a page of Settings, an agent's page, and the element in it. */
export interface Place {
	section: string;
	agent?: string;
	/** A selector of the element to scroll to and mark. Without one the page opens at its top. */
	find?: string;
	/** The words for the search of the Models page, which lists only a few providers without one. */
	filter?: string;
}

export interface Entry {
	id: string;
	title: string;
	/** The way to it, as the navigation and the headings say it: ["General", "Limits"]. */
	path: string[];
	about?: string;
	/** Words people may use for it that its title and its line do not. */
	words?: string;
	place: Place;
}

/** What decides whether a part of a page is there at all. */
export interface Shown {
	local: boolean;
	updates: boolean;
	selfUpdate: boolean;
	access: boolean;
}

export const LABELS: Record<string, string> = {
	general: "General",
	agents: "Agents",
	models: "Models",
	mcp: "MCP servers",
	skills: "Skills",
	events: "Events",
	environments: "Environments",
	access: "Browser access",
};

/** The groups of pine's settings on the General page, by the prefix of their key. */
export const GROUPS: Array<{ prefix: string; title: string; about: string }> = [
	{ prefix: "defaults.", title: "Defaults for agents", about: "What all agents use unless you set something else on an agent's own page." },
	{ prefix: "limits.", title: "Limits", about: "How much work runs at the same time, and how large a download may be." },
	{ prefix: "security.", title: "Security", about: "When pine asks you before an agent goes further." },
];

const at = (name: string) => `[data-find="${name}"]`;

type Static = { id: string; section: string; path?: string[]; title: string; about?: string; words?: string; find?: string; when?: (s: Shown) => boolean };

export const PLACES: Static[] = [
	{ id: "theme", section: "general", path: ["This app"], title: "Theme", about: "The app's colors, from a VS Code color theme.", words: "dark light appearance color colour look", find: "[data-setting=theme]" },
	{ id: "updates", section: "general", path: ["This app"], title: "Updates", about: "Look for a newer version of the app now.", words: "version release new check restart upgrade", find: "[data-setting=updates]", when: (s) => s.updates },
	{ id: "updates-at-start", section: "general", path: ["This app"], title: "Check for updates at start", words: "github version", find: at("updates-at-start"), when: (s) => s.updates },
	{ id: "auto-update", section: "general", path: ["This app"], title: "Update automatically", words: "background install download", find: at("auto-update"), when: (s) => s.updates && s.selfUpdate },
	{ id: "notifications", section: "general", path: ["This app"], title: "Notifications", about: "When an agent is done, stops, or asks you something while the window is in the background.", words: "notify alert banner sound", find: at("notifications") },
	{ id: "pine", section: "general", path: ["pine"], title: "pine and its log", about: "The program behind the app that runs your agents.", words: "daemon service connected version log restart sandbox", find: at("pine") },
	{ id: "keep-running", section: "general", path: ["pine"], title: "Keep pine running after the app quits", words: "background quit close window daemon", find: at("keep-running"), when: (s) => s.local },
	{ id: "command", section: "general", path: ["pine"], title: "The pine command in a terminal", words: "cli shell path install command line", find: at("command"), when: (s) => s.local },
	{ id: "browser", section: "general", path: ["pine"], title: "Browser for the web tools", words: "chromium playwright download fetch web", find: "[data-setting=browser]", when: (s) => s.local },
	{ id: "home", section: "general", path: ["pine"], title: "Home folder", about: "Where pine keeps agents and settings on this computer.", words: "~/.pine data location directory", find: at("home"), when: (s) => s.local },

	{ id: "new-agent", section: "agents", title: "New agent", words: "create add make agent" },
	{ id: "shared-instructions", section: "agents", title: "Instructions for all agents", about: "Notes that all agents read with each message.", words: "AGENTS.md TOOLS.md USER.md shared everybody prompt rules", find: at("shared-instructions") },

	{ id: "default-model", section: "models", title: "Default model", about: "The model all agents use unless an agent has its own.", words: "fallback llm", find: "[data-setting=fallback-model]" },
	{ id: "providers", section: "models", title: "Subscriptions and API keys", about: "Sign in to a provider on the internet.", words: "sign in login account key token claude chatgpt openai anthropic gemini mistral openrouter copilot", find: at("providers") },
	{ id: "model-servers", section: "models", title: "Models on your own computer", about: "Connect a model you run yourself.", words: "local llama.cpp llama ollama lm studio server offline limit runs at the same time at once parallel concurrent slots", find: at("model-servers") },

	{ id: "add-mcp", section: "mcp", title: "Add an MCP server", words: "tools connect integration plugin" },
	{ id: "new-skill", section: "skills", title: "New skill", words: "add write recipe how-to" },

	{ id: "sources", section: "events", title: "Sources", about: "Something that can wake an agent: a folder, a web page, a chat, a device.", words: "subscribe watch trigger telegram mail folder webhook", find: at("sources") },
	{ id: "schedules", section: "events", title: "Schedules", about: "A task for an agent at set times, every so often, or once.", words: "cron timer reminder every morning later", find: at("schedules") },
	{ id: "routes", section: "events", title: "Routes", about: "When an event arrives, one thing happens.", words: "rule automation filter", find: at("routes") },
	{ id: "event-log", section: "events", title: "Event log", words: "history what happened" },

	{ id: "add-machine", section: "environments", title: "Add a machine", about: "Use the pine of another machine over SSH.", words: "ssh remote server host computer", find: at("add-machine") },
	{ id: "machine-needs", section: "environments", title: "What a machine needs", words: "ssh key authorized_keys setup", find: at("machine-needs") },

	{ id: "access-computer", section: "access", title: "Browser access on this computer", about: "Reach this computer's pine from a browser or a phone.", words: "remote phone mobile web pair qr", find: at("access-computer"), when: (s) => s.access },
	{ id: "access-devices", section: "access", title: "Paired devices", words: "phone browser pair qr code remove", find: at("access-devices"), when: (s) => s.access },
	{ id: "access-relay", section: "access", title: "Relay server (TURN)", words: "turn stun nat network mobile", find: "[data-setting=access-relay]", when: (s) => s.access },
];

/** The fields of an agent's page, found for each agent. */
export const AGENT_PLACES: Array<{ id: string; path: string; title: string; words?: string; main?: false }> = [
	{ id: "model", path: "Model", title: "Model", words: "llm" },
	{ id: "reasoning", path: "Model", title: "Reasoning", words: "thinking effort think" },
	{ id: "instructions", path: "Instructions", title: "Instructions", words: "AGENTS.md SOUL.md TOOLS.md MEMORY.md prompt files" },
	{ id: "mode", path: "Permissions", title: "Mode", words: "safe manual auto bypass sandbox ask" },
	{ id: "network", path: "Permissions", title: "Network for shell commands", words: "internet offline" },
	{ id: "tools", path: "Permissions", title: "Built-in tools", words: "bash edit write read grep" },
	{ id: "delegates", path: "Permissions", title: "Can delegate to", words: "hand tasks other agents" },
	{ id: "folders", path: "Folders outside the workspace", title: "Folders outside the workspace", words: "read write access directory" },
	{ id: "holdings", path: "What this agent has", title: "What this agent has", words: "workspace conversations sources servers schedules skills" },
	{ id: "remove", path: "Remove this agent", title: "Remove this agent", words: "delete", main: false },
];

/** What pine has, as the pages show it. Each list may be missing: a page that failed to load finds nothing. */
export interface Lists {
	settings?: Setting[];
	agents?: AgentInfo[];
	providers?: Provider[];
	modelServers?: ModelServer[];
	mcp?: McpServer[];
	skills?: Skill[];
	sources?: SourceInfo[];
	schedules?: Schedule[];
	routes?: Route[];
	/** The machines of Settings > Environments, with the names this app gives them. */
	machines?: Array<{ host: string; name: string }>;
}

const where = (scope: string, session?: string) => (scope === "global" ? "all agents" : session ? `${scope}, one conversation` : scope);

/** Every entry for this state: the places that are there, then what pine has. */
export function entries(shown: Shown, lists: Lists): Entry[] {
	const out: Entry[] = [];
	const add = (e: Entry) => out.push(e);
	for (const p of PLACES) if (!p.when || p.when(shown)) add({ id: `place:${p.id}`, title: p.title, path: [LABELS[p.section], ...(p.path ?? [])], about: p.about, words: p.words, place: { section: p.section, find: p.find } });
	for (const x of lists.settings ?? []) {
		const group = GROUPS.find((g) => x.key.startsWith(g.prefix));
		// A setting the General page does not list (no group) is not found either: it is not there.
		if (group) add({ id: `setting:${x.key}`, title: x.title ?? x.key, path: [LABELS.general, group.title], about: x.about.split("\n")[0], words: x.key, place: { section: "general", find: `[data-setting-key="${x.key}"]` } });
	}
	for (const a of lists.agents ?? []) {
		add({ id: `agent:${a.id}`, title: a.id, path: [LABELS.agents], about: a.description || undefined, words: `agent ${a.main ? "main administers" : ""}`, place: { section: "agents", agent: a.id } });
		for (const f of AGENT_PLACES) if (f.main !== false || !a.main) add({ id: `agent:${a.id}:${f.id}`, title: f.title, path: [LABELS.agents, a.id, ...(f.path === f.title ? [] : [f.path])], words: f.words, place: { section: "agents", agent: a.id, find: at(`agent-${f.id}`) } });
	}
	const mine = new Set((lists.modelServers ?? []).map((x) => x.name));
	for (const p of lists.providers ?? []) if (p.id !== "mock" && !mine.has(p.id)) add({ id: `provider:${p.id}`, title: providerName(p), path: [LABELS.models, "Subscriptions and API keys"], about: p.signedIn ? "signed in" : undefined, words: `${providerWords(p)} provider sign in api key`, place: { section: "models", find: `[data-provider="${p.id}"]`, filter: p.id } });
	for (const x of lists.modelServers ?? []) add({ id: `model-server:${x.name}`, title: x.name, path: [LABELS.models, "Models on your own computer"], about: x.baseUrl, words: x.models.map((m) => m.id).join(" "), place: { section: "models", find: at(`model-server:${x.name}`) } });
	for (const x of lists.mcp ?? []) add({ id: `mcp:${x.scope}:${x.name}`, title: x.name, path: [LABELS.mcp], about: where(x.scope, x.session), words: x.target, place: { section: "mcp", find: at(`mcp:${x.scope}:${x.name}`) } });
	for (const x of lists.skills ?? []) add({ id: `skill:${x.dir}`, title: x.name, path: [LABELS.skills], about: x.description, place: { section: "skills", find: at(`skill:${x.dir}`) } });
	for (const x of lists.sources ?? []) add({ id: `source:${x.scope}:${x.name}`, title: x.name, path: [LABELS.events, "Sources"], about: x.description ?? x.type, words: `${x.type} source`, place: { section: "events", find: at(`source:${x.scope}:${x.name}`) } });
	for (const x of lists.schedules ?? []) add({ id: `schedule:${x.scope}:${x.name}`, title: x.name, path: [LABELS.events, "Schedules"], about: x.when, words: `schedule ${x.task ?? ""}`, place: { section: "events", find: at(`schedule:${x.scope}:${x.name}`) } });
	for (const r of lists.routes ?? []) add({ id: `route:${r.name}`, title: r.name, path: [LABELS.events, "Routes"], words: `route ${r.on.join(" ")}`, place: { section: "events", find: at(`route:${r.name}`) } });
	for (const m of lists.machines ?? []) add({ id: `machine:${m.host}`, title: m.name, path: [LABELS.environments], about: m.name === m.host ? undefined : m.host, words: `${m.host} machine ssh`, place: { section: "environments", find: `[data-environment="${m.host}"]` } });
	return out;
}

/**
 * The entries that fit the words, best first: every word in the title, then every word somewhere in what is
 * said of it, then the title's letters in order. Words are matched as the start of a word or anywhere in it.
 */
export function search(all: Entry[], query: string): Entry[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	const words = q.split(/\s+/);
	const scored: Array<{ e: Entry; score: number }> = [];
	for (const e of all) {
		const title = e.title.toLowerCase();
		const named = `${title} ${e.path.join(" ")} ${e.words ?? ""}`.toLowerCase();
		const said = `${named} ${e.about ?? ""}`.toLowerCase();
		const score = words.every((w) => title.includes(w))
			? title.startsWith(words[0]) || title.includes(` ${words[0]}`) ? 4 : 3
			: words.every((w) => named.includes(w))
				? 2
				: words.every((w) => said.includes(w))
					? 1
					: q.length >= 3 && fuzzy(q, e.title) >= 0
						? 0.5
						: 0;
		if (score) scored.push({ e, score });
	}
	// Stable: within a score, the order of the pages.
	return scored.sort((a, b) => b.score - a.score).map((x) => x.e);
}
