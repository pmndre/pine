import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { PineConfig } from "./config.ts";
import { setEnv, unsetEnv } from "./env-file.ts";
import { errText } from "./util.ts";

// models.json is pi's file, and pi fills a "$NAME" in it from the process environment. pine's
// secrets are in .env and are kept out of that environment on purpose (agent shells and MCP
// servers would inherit them). So a provider's API key that names an .env entry is filled in
// here and handed to pi as a key it holds in memory: it is in no file and in no environment.

/** pi's form for a value: "$NAME" or "${NAME}" is a variable, "$$" a dollar sign, "$!" an exclamation mark. */
const REF = /\$(?:([$!])|\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;

const namesIn = (value: string): string[] => [...new Set([...value.matchAll(REF)].map((m) => m[2] ?? m[3]).filter(Boolean))];

function read<T>(make: () => T, otherwise: T): T {
	try {
		return make();
	} catch {
		return otherwise;
	}
}

/**
 * The API keys that models.json takes from pine's .env file, by provider, and what is wrong:
 * a name that is nowhere, or a header that names an .env entry (pi reads headers itself, so
 * only `apiKey` can).
 */
export function modelKeys(home: string): { keys: Record<string, string>; problems: string[] } {
	const keys: Record<string, string> = {};
	const problems: string[] = [];
	// A missing or broken models.json is reported where pi loads it.
	const providers = read(() => JSON.parse(fs.readFileSync(path.join(home, "models.json"), "utf8")).providers, undefined) ?? {};
	const envFile = path.join(home, ".env");
	const fileEnv = read(() => parseEnv(fs.readFileSync(envFile, "utf8")) as Record<string, string>, {});
	const known = (name: string) => fileEnv[name] || process.env[name] || undefined;

	for (const [id, provider] of Object.entries<any>(providers)) {
		for (const [header, value] of Object.entries<unknown>(provider?.headers ?? {})) {
			const named = typeof value === "string" && !value.startsWith("!") ? namesIn(value).filter((name) => fileEnv[name] && !process.env[name]) : [];
			if (named.length) problems.push(`models.json: provider "${id}", header "${header}" names ${named.join(", ")} from .env. Only "apiKey" is filled in from .env`);
		}
		const raw = provider?.apiKey;
		// "!command" is a program pi runs, and a key without a name in it is the key itself.
		if (typeof raw !== "string" || raw.startsWith("!")) continue;
		const names = namesIn(raw);
		if (!names.length) continue;
		const missing = names.filter((name) => !known(name));
		if (missing.length) {
			problems.push(`models.json: provider "${id}" takes the key from ${missing.join(", ")}, which ${missing.length === 1 ? "is" : "are"} not in ${envFile}. The provider's models are not available until you add ${missing.length === 1 ? "a line" : "lines"} ${missing.map((name) => `${name}=...`).join(", ")} there`);
			continue;
		}
		// pi fills in what the environment alone answers.
		if (!names.some((name) => fileEnv[name])) continue;
		keys[id] = raw.replace(REF, (_all, escaped, braced, bare) => escaped ?? known(braced ?? bare)!);
	}
	return { keys, problems };
}

/**
 * Where the model servers of models.json are. The daemon gives requests to these their own
 * timeouts (pi has none for a stream that goes quiet), so one that is added later is put here
 * before the first request to it.
 */
export const modelOrigins = new Set<string>();

function noteOrigins(home: string): void {
	const providers = read(() => JSON.parse(fs.readFileSync(path.join(home, "models.json"), "utf8")).providers, undefined) ?? {};
	for (const p of Object.values<any>(providers)) {
		const origin = typeof p?.baseUrl === "string" ? read(() => new URL(p.baseUrl).origin, undefined) : undefined;
		if (origin) modelOrigins.add(origin);
	}
}

/** pi's model runtime on pine's home, with the keys from .env in place. */
export async function modelRuntime(home: string, warn: (problem: string) => void = () => {}): Promise<ModelRuntime> {
	noteOrigins(home);
	// Loaded here so that commands which only look at the keys (pine check) do not load pi.
	const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
	const runtime = await ModelRuntime.create({ authPath: path.join(home, "auth.json"), modelsPath: path.join(home, "models.json") });
	const { keys, problems } = modelKeys(home);
	for (const [provider, key] of Object.entries(keys)) await runtime.setRuntimeApiKey(provider, key);
	for (const problem of problems) warn(problem);
	return runtime;
}

// Model servers of the owner's own (llama.cpp, vLLM, LM Studio, anything that speaks OpenAI's
// chat API): added and removed by command or by the main agent's tool, never by editing
// models.json. What can be asked of the server is asked of it: which models it has, how much
// context each gets, whether it reads pictures.

export interface ServerModel {
	id: string;
	/** Tokens of context one request gets, where the server says. */
	contextWindow?: number;
	images: boolean;
	reasoning: boolean;
	/**
	 * For a model that thinks, on a server that says so (llama.cpp): the levels of effort its chat
	 * template tells apart, lowest first. Its own default is not among them.
	 */
	efforts?: string[];
	/** What the server calls it besides its id, where it says (a router's `meta.title`, `name`): plain words only, never written into a file. */
	title?: string;
	/** Whether it is loaded, where a router says (`meta.state`, `status`): one plain word. */
	state?: string;
}

/**
 * A server's own words about a model, kept only when they are plain: letters, digits, spaces and
 * a little punctuation, short. They are shown to an agent, and a server can say anything.
 */
const plainTitle = (v: unknown) => (typeof v === "string" && /^[\p{L}\p{N} .,()+:/_'&-]{1,80}$/u.test(v.trim()) ? v.trim() : undefined);
const plainState = (v: unknown) => (typeof v === "string" && /^[A-Za-z][A-Za-z_-]{0,15}$/.test(v) ? v.toLowerCase() : undefined);

/** What a server answered: its models, or that it wants a key first. */
export type Look = { locked: true } | { locked: false; models: ServerModel[] };

const MODEL_ID = /^[A-Za-z0-9._:@/+=,()[\]-]{1,160}$/;
const SERVER_NAME = /^[a-z][a-z0-9-]{0,30}$/;

/** The name under which a server's key is kept in .env. */
export const modelKeyName = (name: string) => `PINE_MODEL_${name.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}_API_KEY`;

/** The address as it goes into models.json: http or https, no sign-in in it, "/v1" where no path is given. */
export function serverUrl(text: string): string {
	const url = read(() => new URL(text.trim()), undefined);
	if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) throw new Error(`"${text}" is not the address of a model server. Give it as http://host:port, for example http://127.0.0.1:8080`);
	if (url.username || url.password) throw new Error("the address must not contain a user name or password; a server's key is asked for separately and kept in .env");
	if (url.search || url.hash) throw new Error("the address must not contain a query or a fragment");
	const pathname = url.pathname.replace(/\/+$/, "");
	return `${url.origin}${pathname || "/v1"}`;
}

export function checkServerName(name: string, taken: readonly string[]): void {
	if (!SERVER_NAME.test(name)) throw new Error(`"${name}" is not a usable name for a model server: lowercase letters, digits and -, starting with a letter (for example studio)`);
	if (taken.includes(name)) throw new Error(`a model provider called "${name}" exists already; pick another name`);
}

/** The levels of effort a request can name, lowest first. */
const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * What is sent for each of pi's thinking levels, for a model whose template knows `efforts`.
 * Without this a level the template does not know is answered with the template's default,
 * which is often its highest, and "off" sends nothing at all, so thinking stays on.
 *  - off: "none", which is how llama.cpp turns thinking off.
 *  - a level the template knows: itself.
 *  - a level it does not know: the next one up that it does (never less than was asked for).
 *  - a level above all it knows is left out: pi lowers xhigh and max to the highest there is,
 *    and "high" goes as it is, to the template's own default.
 */
export function effortMap(efforts: string[]): Record<string, string> {
	const map: Record<string, string> = { off: "none" };
	const known = EFFORTS.filter((level) => efforts.includes(level));
	for (const level of EFFORTS) {
		const next = known.find((k) => EFFORTS.indexOf(k) >= EFFORTS.indexOf(level));
		if (next) map[level] = next;
	}
	return map;
}

const positive = (n: unknown): number | undefined => (typeof n === "number" && Number.isInteger(n) && n > 0 ? n : undefined);

/**
 * Ask a server what it serves. Nothing follows a redirect: the address the owner agreed to is
 * the only one that gets a request, and the only one that sees the key.
 */
export async function lookAt(baseUrl: string, key?: string, timeoutMs = 10_000): Promise<Look> {
	modelOrigins.add(new URL(baseUrl).origin);
	const get = async (url: string) => {
		try {
			return await fetch(url, { headers: key ? { authorization: `Bearer ${key}` } : {}, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
		} catch (e) {
			throw new Error(`no model server answers at ${url} (${errText((e as any)?.cause ?? e)})`);
		}
	};
	const res = await get(`${baseUrl}/models`);
	if (res.status === 401 || res.status === 403) return { locked: true };
	const body: any = res.ok ? await res.json().catch(() => undefined) : undefined;
	const list: any[] | undefined = Array.isArray(body?.data) ? body.data : undefined;
	if (!list) throw new Error(`${baseUrl}/models did not answer with a list of models${res.ok ? "" : ` (HTTP ${res.status})`}. A server that speaks OpenAI's API has one there; check the address and the path`);

	// llama.cpp says in /props what one request really gets: the context of a slot, and whether it reads pictures.
	let props: any;
	if (baseUrl.endsWith("/v1") && list.length === 1) {
		const r = await get(`${baseUrl.slice(0, -3)}/props`).catch(() => undefined);
		props = r?.ok ? await r.json().catch(() => undefined) : undefined;
	}
	const models: ServerModel[] = [];
	for (const m of list.slice(0, 100)) {
		// A name is shown to agents and written into the file, so it is a name and nothing else.
		if (typeof m?.id !== "string" || !MODEL_ID.test(m.id)) continue;
		const caps = props?.chat_template_caps;
		const reasoning = caps?.supports_reasoning_effort === true;
		models.push({
			id: m.id,
			contextWindow: positive(props?.default_generation_settings?.n_ctx) ?? positive(m.max_model_len) ?? positive(m.context_length) ?? positive(m.context_window),
			images: props?.modalities?.vision === true || (Array.isArray(m.architecture?.input_modalities) && m.architecture.input_modalities.includes("image")),
			reasoning,
			// Only the names pine knows are kept: what a server says goes into a file.
			...(reasoning ? { efforts: EFFORTS.filter((level) => Array.isArray(caps.reasoning_effort_levels) && caps.reasoning_effort_levels.includes(level)) } : {}),
			...(plainTitle(m.meta?.title ?? m.name) && plainTitle(m.meta?.title ?? m.name) !== m.id ? { title: plainTitle(m.meta?.title ?? m.name) } : {}),
			...(plainState(m.meta?.state ?? m.status?.value ?? m.status) ? { state: plainState(m.meta?.state ?? m.status?.value ?? m.status) } : {}),
		});
	}
	if (!models.length) throw new Error(`${baseUrl} lists no model with a usable name${list.length ? ` (it has ${list.length}, named with spaces or other characters; llama-server takes a plain name with --alias)` : ""}`);
	return { locked: false, models };
}

/** A model server that answered on one of the usual ports of this computer. */
export interface LocalServer {
	/** The name it is added under, unless the owner gives another. */
	id: string;
	title: string;
	/** Its address as `POST /models/servers` takes it. */
	url: string;
	/** It wants a key: the owner is asked for one. */
	locked: boolean;
	models: string[];
	/** Pinecone's MCP server, which answered beside it. */
	mcp?: string;
}

/**
 * The usual ports of model servers on this computer, in the order they are offered. llama.cpp's
 * 8080 is Pinecone when Pinecone's MCP server answers on 8090 too.
 */
const LOCAL_SERVERS = [
	{ port: 8080, id: "llamacpp", title: "llama.cpp", pinecone: { port: 8090, id: "pinecone", title: "Pinecone" } },
	{ port: 11434, id: "ollama", title: "Ollama" },
	{ port: 1234, id: "lmstudio", title: "LM Studio" },
];

/**
 * Where each usual port is asked. A test moves them to stand-ins (`PINE_LOCAL_PORTS`, for tests
 * only, not a user option: "8080=51234,8090=51235"), and then a port it does not name is not asked.
 */
function localPort(port: number): number | undefined {
	const moved = process.env.PINE_LOCAL_PORTS;
	if (!moved) return port;
	const to = Number(moved.split(",").find((pair) => pair.split("=")[0] === String(port))?.split("=")[1]);
	return Number.isInteger(to) && to > 0 && to < 65536 ? to : undefined;
}

/** Whether an MCP server answers at this address: it takes the protocol's first request. */
async function answersMcp(url: string, timeoutMs: number): Promise<boolean> {
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "pine", version: "1" } } }),
			redirect: "error",
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!res.ok) return false;
		if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
			await res.body?.cancel();
			return true;
		}
		const body: any = await res.json().catch(() => undefined);
		return body?.jsonrpc === "2.0";
	} catch {
		return false;
	}
}

/**
 * Ask the usual ports of this computer what they serve: 127.0.0.1 and those fixed ports alone,
 * never an address somebody gave, and never `skip` (pine's own control port).
 */
export async function lookAround(skip: number | undefined, timeoutMs = 1500): Promise<LocalServer[]> {
	const found = await Promise.all(
		LOCAL_SERVERS.map(async (s): Promise<LocalServer | undefined> => {
			const port = localPort(s.port);
			if (!port || port === skip) return undefined;
			const url = `http://127.0.0.1:${port}/v1`;
			const look = await lookAt(url, undefined, timeoutMs).catch(() => undefined);
			if (!look) return undefined;
			const server = { url, locked: look.locked, models: look.locked ? [] : look.models.map((m) => m.id) };
			const mcpPort = s.pinecone ? localPort(s.pinecone.port) : undefined;
			const mcp = mcpPort && mcpPort !== skip ? `http://127.0.0.1:${mcpPort}/mcp` : undefined;
			if (s.pinecone && mcp && (await answersMcp(mcp, timeoutMs))) return { id: s.pinecone.id, title: s.pinecone.title, ...server, mcp };
			return { id: s.id, title: s.title, ...server };
		}),
	);
	return found.filter((s) => s !== undefined);
}

export interface NewServer {
	name: string;
	baseUrl: string;
	/** The server's key. It goes into .env; the file gets its name. */
	key?: string;
	models: ServerModel[];
	/** For models whose context the server does not say. */
	context?: number;
	/** Overrides what the server says about thinking. */
	reasoning?: boolean;
}

const modelsFile = (home: string) => path.join(home, "models.json");

function editModels(home: string, change: (providers: Record<string, any>) => void): void {
	const file = modelsFile(home);
	const json = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
	json.providers ??= {};
	change(json.providers);
	fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, { mode: 0o600 });
}

/** The most tokens of context pine writes for a model: more is a typo, not a model. */
const MAX_CONTEXT = 10_000_000;

export function checkContext(context: number | undefined): void {
	if (context !== undefined && (!positive(context) || context < 512 || context > MAX_CONTEXT)) throw new Error(`the context is a whole number of tokens from 512 to ${MAX_CONTEXT}, for example 65536: what the server was started with`);
}

/** A model's entry in models.json, as pine writes it for a model server of the owner's own. */
function modelEntry(m: ServerModel, context: number, reasoningOverride?: boolean) {
	const reasoning = reasoningOverride ?? m.reasoning;
	// Where the server said which levels the model knows, the level chosen in pine is the one it gets.
	const mapped = reasoning && m.efforts !== undefined;
	return {
		id: m.id,
		contextWindow: context,
		maxTokens: Math.min(8192, Math.floor(context / 2)),
		input: m.images ? ["text", "image"] : ["text"],
		...(reasoning ? { reasoning: true } : {}),
		...(mapped ? { thinkingLevelMap: effortMap(m.efforts!) } : {}),
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		// What a plain server may reject is not sent.
		compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: reasoning, ...(mapped ? { thinkingFormat: "openai" } : {}), maxTokensField: "max_tokens" },
	};
}

/** Write a server into models.json, and its key into .env. Returns its models as "provider/id". */
export function addModelServer(home: string, server: NewServer): string[] {
	const unsized = server.models.filter((m) => !m.contextWindow && !server.context).map((m) => m.id);
	if (unsized.length) throw new Error(`the server does not say how much context ${unsized.length === 1 ? `the model ${unsized[0]} gets` : "the models get"}. Give it: the number of tokens one request may use (what the server was started with)`);
	if (server.context !== undefined && !positive(server.context)) throw new Error("the context is a whole number of tokens, for example 65536");
	const entry = {
		name: `${server.name} (${new URL(server.baseUrl).host})`,
		baseUrl: server.baseUrl,
		api: "openai-completions",
		apiKey: server.key ? `$${modelKeyName(server.name)}` : "none",
		models: server.models.map((m) => modelEntry(m, server.context ?? m.contextWindow!, server.reasoning)),
	};
	// Checked before anything is written: the key of a server that is there must not be touched.
	const there = read(() => JSON.parse(fs.readFileSync(modelsFile(home), "utf8")).providers, undefined) ?? {};
	if (there[server.name]) throw new Error(`a model provider called "${server.name}" exists already; pick another name`);
	if (server.key) setEnv(home, { [modelKeyName(server.name)]: server.key });
	try {
		editModels(home, (providers) => {
			providers[server.name] = entry;
		});
	} catch (e) {
		if (server.key) unsetEnv(home, [modelKeyName(server.name)]);
		throw e;
	}
	return entry.models.map((m) => `${server.name}/${m.id}`);
}

/** Who has a model set that `of` says yes to: agents, the default, the judge of goals, the check of a swarm's answer, a route's model call. */
function modelUsers(cfg: PineConfig, of: (ref: string) => boolean): string[] {
	const is = (ref: string | undefined) => typeof ref === "string" && of(ref);
	return [
		...Object.values(cfg.agents).filter((a) => is(a.model)).map((a) => `agent ${a.id}`),
		...(is(cfg.defaults.model) ? [`the default model (${Object.values(cfg.agents).filter((a) => !a.model).map((a) => a.id).join(", ") || "no agent right now"})`] : []),
		...(is(cfg.defaults.judge) ? ["the judge of goals (defaults.judge)"] : []),
		...(is(cfg.defaults.checker) ? ["the check of a swarm's answer (defaults.checker)"] : []),
		...cfg.routes.filter((r) => is(r.call?.model)).map((r) => `the route ${r.name}`),
	];
}

/** Who has a model of this server set. */
export const modelServerUsers = (cfg: PineConfig, name: string): string[] => modelUsers(cfg, (ref) => ref.startsWith(`${name}/`));

/** Who has this one model ("server/id") set. */
export const modelRefUsers = (cfg: PineConfig, ref: string): string[] => modelUsers(cfg, (r) => r === ref);

/** The entry of a model server of the owner's own in models.json, or an error that says what there is. */
function serverEntry(home: string, name: string): any {
	const providers = read(() => JSON.parse(fs.readFileSync(modelsFile(home), "utf8")).providers, undefined) ?? {};
	const entry = providers[name];
	if (!entry || typeof entry.baseUrl !== "string") {
		const own = Object.entries<any>(providers).filter(([, p]) => typeof p?.baseUrl === "string").map(([n]) => n);
		throw new Error(`"${name}" is not a model server of your owner's own${own.length ? `. Those are: ${own.join(", ")}` : ": there is none yet (add_model_server adds one)"}. The models of a provider pine signs in to (anthropic, openai, ...) come with pine and cannot be added, changed or removed; only how many runs one takes at a time can be set`);
	}
	return entry;
}

/** Whether `name` is a model server of the owner's own, in models.json. */
export const isModelServer = (home: string, name: string): boolean => read(() => (serverEntry(home, name), true), false);

/**
 * The key to ask a server of the owner's own with, as pi would send it: from .env, or written in
 * models.json. A key that a command prints is not run here: pine asks nothing of that server.
 */
export function serverKey(home: string, name: string): string | undefined {
	const raw = serverEntry(home, name).apiKey;
	if (typeof raw !== "string" || raw === "" || raw === "none") return undefined;
	if (raw.startsWith("!")) throw new Error(`the key of "${name}" comes from a command, which pine does not run to ask the server. Your owner adds the model to models.json by hand, or removes the server and adds it again`);
	if (!namesIn(raw).length) return raw;
	const key = modelKeys(home).keys[name];
	if (!key) throw new Error(`the key of "${name}" is not in pine's .env file: pine check says which line is missing`);
	return key;
}

/** Add one model that a server of the owner's own serves to its entry. Returns it as "server/id". */
export function addServerModel(home: string, name: string, model: ServerModel, context?: number): string {
	const entry = serverEntry(home, name);
	if ((entry.models ?? []).some((m: any) => m?.id === model.id)) throw new Error(`"${name}/${model.id}" is there already. To change how it is set up: configure_model`);
	checkContext(context);
	const size = context ?? model.contextWindow;
	if (!size) throw new Error(`the server does not say how much context ${model.id} gets. Give it: the number of tokens one request may use (what the server was started with)`);
	editModels(home, (providers) => {
		providers[name].models = [...(Array.isArray(providers[name].models) ? providers[name].models : []), modelEntry(model, size)];
	});
	return `${name}/${model.id}`;
}

/** What can be changed about a model of a server of the owner's own. */
export interface ModelChange {
	/** Tokens of context one request gets. */
	context?: number;
	/** The most tokens one answer may have. */
	maxTokens?: number;
	/** Whether the model is sent pictures. */
	images?: boolean;
	/** Whether the model thinks before it answers, and is sent a level of effort. */
	reasoning?: boolean;
}

/** How a model of a server of the owner's own is set up now, as configure_model names it. */
export function serverModel(home: string, name: string, id: string): { context?: number; maxTokens?: number; images: boolean; reasoning: boolean } {
	const m = (serverEntry(home, name).models ?? []).find((x: any) => x?.id === id);
	if (!m) throw new Error(`"${name}" has no model "${id}" in pine. Its models: ${(serverEntry(home, name).models ?? []).map((x: any) => x?.id).join(", ") || "none"}. One that the server serves and pine does not have yet: add_model`);
	return { context: positive(m.contextWindow), maxTokens: positive(m.maxTokens), images: Array.isArray(m.input) && m.input.includes("image"), reasoning: m.reasoning === true };
}

/**
 * A change to one model, checked against what it is now. Returns what changes, in words
 * (nothing when nothing would), and writes nothing.
 */
export function checkModelChange(home: string, name: string, id: string, change: ModelChange): string[] {
	const now = serverModel(home, name, id);
	checkContext(change.context);
	const context = change.context ?? now.context ?? 0;
	if (change.maxTokens !== undefined && (!positive(change.maxTokens) || change.maxTokens >= context)) throw new Error(`the longest answer is a whole number of tokens below the context (${context})`);
	const lines: string[] = [];
	if (change.context !== undefined && change.context !== now.context) lines.push(`context: ${now.context ?? "not set"} -> ${change.context} tokens`);
	const max = outputFor(now, change);
	if (max !== now.maxTokens) lines.push(`longest answer: ${now.maxTokens ?? "not set"} -> ${max} tokens`);
	if (change.images !== undefined && change.images !== now.images) lines.push(`pictures: ${now.images ? "sent" : "not sent"} -> ${change.images ? "sent" : "not sent"}`);
	if (change.reasoning !== undefined && change.reasoning !== now.reasoning) lines.push(`reasoning: ${now.reasoning ? "on" : "off"} -> ${change.reasoning ? "on" : "off"}`);
	return lines;
}

/** The longest answer after a change: as given, else what there was, made to fit a smaller context. */
function outputFor(now: { context?: number; maxTokens?: number }, change: ModelChange): number | undefined {
	if (change.maxTokens !== undefined) return change.maxTokens;
	if (change.context === undefined) return now.maxTokens;
	return Math.min(now.maxTokens ?? 8192, Math.floor(change.context / 2));
}

/** Write a change that checkModelChange let through. */
export function changeServerModel(home: string, name: string, id: string, change: ModelChange): void {
	checkModelChange(home, name, id, change);
	const now = serverModel(home, name, id);
	editModels(home, (providers) => {
		const m = providers[name].models.find((x: any) => x?.id === id);
		if (change.context !== undefined) m.contextWindow = change.context;
		const max = outputFor(now, change);
		if (max !== undefined) m.maxTokens = max;
		if (change.images !== undefined) m.input = change.images ? ["text", "image"] : ["text"];
		if (change.reasoning !== undefined) {
			m.compat = typeof m.compat === "object" && m.compat ? m.compat : {};
			if (change.reasoning) {
				m.reasoning = true;
				m.compat.supportsReasoningEffort = true;
			} else {
				// Off is off: no level is sent, and no map of levels is left to send one.
				delete m.reasoning;
				delete m.thinkingLevelMap;
				delete m.compat.thinkingFormat;
				m.compat.supportsReasoningEffort = false;
			}
		}
	});
}

/** Whether one model can be taken out of a server's entry: it is there, nothing uses it, and it is not the server's last. */
export function checkServerModelRemoval(cfg: PineConfig, name: string, id: string): void {
	const entry = serverEntry(cfg.home, name);
	const models: any[] = Array.isArray(entry.models) ? entry.models : [];
	if (!models.some((m) => m?.id === id)) throw new Error(`"${name}" has no model "${id}" in pine. Its models: ${models.map((m) => m?.id).join(", ") || "none"}`);
	const ref = `${name}/${id}`;
	const users = modelRefUsers(cfg, ref);
	if (users.length) throw new Error(`"${ref}" is in use by ${users.join(", ")}. Give ${users.length === 1 ? "it" : "them"} another model first`);
	if (models.length === 1) throw new Error(`"${ref}" is the only model of "${name}". To take the whole server out: remove_model_server`);
}

/** Take one model out of a server's entry. The server and its other models stay; its number of runs goes with it. */
export function removeServerModel(cfg: PineConfig, name: string, id: string): void {
	checkServerModelRemoval(cfg, name, id);
	const ref = `${name}/${id}`;
	editModels(cfg.home, (providers) => {
		providers[name].models = providers[name].models.filter((m: any) => m?.id !== id);
	});
	dropLimits(cfg, [ref]);
}

/** Take the numbers of runs at a time of these models out of pine.json and the configuration in force. */
function dropLimits(cfg: PineConfig, refs: string[]): void {
	const mine = refs.filter((ref) => cfg.limits.models[ref] !== undefined);
	if (!mine.length) return;
	const file = path.join(cfg.home, "pine.json");
	const json = read(() => JSON.parse(fs.readFileSync(file, "utf8")), undefined);
	if (json?.limits?.models && typeof json.limits.models === "object") {
		for (const k of mine) delete json.limits.models[k];
		if (!Object.keys(json.limits.models).length) delete json.limits.models;
		fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
	}
	for (const ref of mine) delete cfg.limits.models[ref];
}

/** Take a server out of models.json again, with the key pine keeps for it. False when there is none of that name. */
export function removeModelServer(cfg: PineConfig, name: string): boolean {
	const providers = read(() => JSON.parse(fs.readFileSync(modelsFile(cfg.home), "utf8")).providers, undefined) ?? {};
	if (!providers[name]) return false;
	const users = modelServerUsers(cfg, name);
	if (users.length) throw new Error(`"${name}" is in use by ${users.join(", ")}. Give ${users.length === 1 ? "it" : "them"} another model first (/model in the terminal UI)`);
	const key = modelKeyName(name);
	// The key pine put into .env goes too. One the owner named themselves stays.
	const ours = [`$${key}`, `\${${key}}`].includes(providers[name].apiKey);
	editModels(cfg.home, (all) => {
		delete all[name];
	});
	if (ours) unsetEnv(cfg.home, [key]);
	// The numbers of runs at a time that the owner gave its models go with it: the next server of that name starts without.
	dropLimits(cfg, Object.keys(cfg.limits.models).filter((ref) => ref.startsWith(`${name}/`)));
	return true;
}

export interface ServerInfo {
	name: string;
	baseUrl: string;
	/** Where its key comes from, in words. */
	key: string;
	/** `limit`: how many runs that model takes at a time, where the owner gave it a number of its own (`limits.models`). */
	models: Array<{ id: string; contextWindow?: number; images: boolean; reasoning: boolean; limit?: number }>;
}

/** The model servers in models.json. */
export function listModelServers(home: string): ServerInfo[] {
	const providers = read(() => JSON.parse(fs.readFileSync(modelsFile(home), "utf8")).providers, undefined) ?? {};
	return Object.entries<any>(providers).filter(([, p]) => typeof p?.baseUrl === "string").map(([name, p]) => {
		const raw = typeof p.apiKey === "string" ? p.apiKey : "";
		const names = raw.startsWith("!") ? [] : namesIn(raw);
		return {
			name,
			baseUrl: p.baseUrl,
			key: raw.startsWith("!") ? "from a command" : names.length ? `${names.join(", ")} in .env` : !raw || raw === "none" ? "none" : "written in models.json",
			models: (Array.isArray(p.models) ? p.models : []).filter((m: any) => typeof m?.id === "string").map((m: any) => ({ id: m.id, contextWindow: positive(m.contextWindow), images: Array.isArray(m.input) && m.input.includes("image"), reasoning: m.reasoning === true })),
		};
	});
}

/** What one server of the owner's own serves that pine does not have, or why that is not known. */
export type Served = { name: string; missing: ServerModel[]; gone: string[] } | { name: string; error: string };

/**
 * Ask every server of the owner's own what it serves (`/models`), side by side and briefly: only
 * the addresses the owner confirmed, with the key pine sends them anyway, no redirect. `missing`:
 * served and not in pine; `gone`: in pine and no longer served.
 */
export async function servedBy(home: string, timeoutMs = 3000): Promise<Served[]> {
	return Promise.all(
		listModelServers(home).map(async (s): Promise<Served> => {
			try {
				const look = await lookAt(s.baseUrl, serverKey(home, s.name), timeoutMs);
				if (look.locked) return { name: s.name, error: "it did not accept the key pine has for it" };
				const have = new Set(s.models.map((m) => m.id));
				const served = new Set(look.models.map((m) => m.id));
				return { name: s.name, missing: look.models.filter((m) => !have.has(m.id)), gone: [...have].filter((id) => !served.has(id)) };
			} catch (e) {
				// A message of pine's own: the server's answer is not repeated.
				const why = errText(e);
				return { name: s.name, error: /timed? ?out|aborted/i.test(why) ? "it did not answer in time" : /no model server answers/.test(why) ? "it does not answer" : /key/.test(why) ? why : "its list of models could not be read" };
			}
		}),
	);
}

/**
 * pi's own choice of model for each provider (`defaultModelPerProvider`), which pi uses when it
 * starts without one. pi does not export it, so it is read from pi's file; after an upgrade that
 * moves it, nothing is found and the provider's first model is taken instead (`suggestModel`).
 */
let piChoices: Promise<Record<string, string>> | undefined;
export function piDefaults(): Promise<Record<string, string>> {
	piChoices ??= (async () => {
		try {
			const index = new URL(import.meta.resolve("@earendil-works/pi-coding-agent"));
			const table = (await import(new URL("./core/model-resolver.js", index).href)).defaultModelPerProvider;
			return table && typeof table === "object" ? (table as Record<string, string>) : {};
		} catch {
			return {};
		}
	})();
	return piChoices;
}

/**
 * The model to run on, among those that answer (`usable`, as "provider/id"): pi's choice for a
 * provider, the providers in pi's order; else the first. With `provider`, only its models (the one
 * just signed in to, or the model server just added).
 */
export function suggestModel(usable: string[], choices: Record<string, string>, provider?: string): string | undefined {
	const among = provider ? usable.filter((m) => m.startsWith(`${provider}/`)) : usable;
	for (const [p, id] of Object.entries(choices)) if (among.includes(`${p}/${id}`)) return `${p}/${id}`;
	return among[0];
}
