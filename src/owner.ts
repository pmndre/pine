// What the owner does to pine's setup with their own hand, through the control API: the same
// things the main agent does by tool call when it is asked, and that the `pine` command does in
// the files. A UI that is only a client of the daemon offers them as a settings panel.
//
// There is no second road here. Each request is checked by the function that checks the tool's
// arguments and carried out by the function the tool calls after the owner said yes; what is
// missing is only the question, because the bearer token is the owner. Nothing in this file
// decides what is allowed.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { addRoute, replaceRoute, applyModelLimit, applySetting, checkModelLimit, checkRoute, checkSetting, dropRoute, type ModelPlan, planModelAdd, planModelChange, planModelRemove, type RouteInput, SETTINGS, settleModel } from "./admin.ts";
import { AGENT_TOOLS } from "./agent-admin.ts";
import type { AgentManager } from "./agents.ts";
import { browserReady } from "./browser-build.ts";
import { type AgentConfig, loadConfig, mainAgentId, ownText, PINE_ROOT, type PineConfig, purposeOf, SHARED_FILES, WORKSPACE_FILES } from "./config.ts";
import { login, logout, type Prompter } from "./login.ts";
import { findServer, piMcp, serverStates } from "./mcp-config.ts";
import { addDecision, checkDecision, removeDecision, signInTypesafe, signOutTypesafe, TYPESAFE, typesafeSignedIn, usersOf, whereIs } from "./decisions.ts";
import { addModelServer, checkServerName, listModelServers, lookAround, lookAt, modelKeys, modelRuntime, modelServerUsers, removeModelServer, serverUrl } from "./models.ts";
import type { Router } from "./router.ts";
import { audit, isInside, realish, sandboxAvailable } from "./security.ts";
import { inPi, install as installExtension, listExtensions, newer as newerExtension, propose as proposeExtension, uninstall as uninstallExtension } from "./extensions.ts";
import { allSkills, checkSkill, deleteSkill, skillDir, skillsBeside, writeSkill } from "./skills.ts";
import type { SourceHost } from "./sources.ts";
import { localTime, type Scheduler } from "./timers.ts";
import { errText, type Logger, parseDuration } from "./util.ts";
import { chapter, chapters, lookUp, pineManual } from "./manual.ts";
import { listThemes, themeInForce } from "./themes.ts";
import { listViews, viewCode, viewInForce } from "./views.ts";
import { changeFiles, type FileChange, MAX_EDIT, writeText } from "./workspace-view.ts";

/** A request that is refused, with the status it is answered with and what a client needs besides the sentence. */
export class Refusal extends Error {
	status: number;
	more?: Record<string, unknown>;
	constructor(status: number, message: string, more?: Record<string, unknown>) {
		super(message);
		this.status = status;
		this.more = more;
	}
}

/** The most text of an instruction file that is handed to a UI. */
const MAX_TEXT = 200_000;

const SHARED_ABOUT: Record<string, string> = {
	"AGENTS.md": "Traits and behaviour for all agents: how every agent is to be and to act.",
	"TOOLS.md": "Tooling for all agents: defaults and preferences for the tools, and other technical details of your setup.",
	"USER.md": "What every agent knows about you.",
};

/**
 * A file's text, if it is a file. A link is not followed: an agent's workspace is its own to
 * write, and a link there must not make the daemon read something else out to a UI.
 */
function textOf(file: string): string | undefined {
	let fd: number | undefined;
	try {
		fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
		if (!fs.fstatSync(fd).isFile()) return undefined;
		const buf = Buffer.alloc(Math.min(fs.fstatSync(fd).size, MAX_TEXT * 4));
		fs.readSync(fd, buf, 0, buf.length, 0);
		return buf.toString("utf8").slice(0, MAX_TEXT);
	} catch {
		return undefined;
	} finally {
		if (fd !== undefined) fs.closeSync(fd);
	}
}

/** A skill's instructions: its SKILL.md without the header that names it. */
const skillBody = (dir: string) => (textOf(path.join(dir, "SKILL.md")) ?? "").replace(/^---\n[\s\S]*?\n---\n*/, "").trimEnd();

// ---- signing in to a model provider ----------------------------------------------------------------

/** What a UI is shown of a sign-in that is under way. */
export interface LoginView {
	lines: string[];
	url?: string;
	code?: string;
	question?: { message: string; secret: boolean; options?: Array<{ id: string; label: string; description?: string }> };
	done: boolean;
	error?: string;
	models?: string[];
	/** The model the agents run on from now on, when the sign-in made pine choose one (`settleModel`). */
	chosen?: string;
}

interface LoginSession extends LoginView {
	provider: string;
	abort: AbortController;
	answer?: (value: string) => void;
	ended?: number;
}

/** What a sign-in is run with: pi's own flow, or a stand-in in a test. Returns the models the provider then has. */
export type LoginRunner = (provider: string, type: "api_key" | "oauth" | undefined, prompter: Prompter, signal: AbortSignal) => Promise<string[]>;

/**
 * A browser sign-in without a browser, for the Pine app's tests (`PINE_LOGIN_STAND_IN`, for tests
 * only, not a user option): it shows a page and a device code as a provider's flow does, waits
 * until the file the variable names exists, and then stores what the file holds as that
 * provider's token in auth.json, as a browser sign-in leaves it (`oauth`, so that the page tells
 * it from a key). A sign-in with a key is pi's own, as it is.
 */
function browserStandIn(cfg: PineConfig, file: string): LoginRunner {
	return async (provider, type, prompter, signal) => {
		if (type === "api_key") return login(cfg, provider, type, prompter, signal);
		prompter.device?.("https://sign-in.example/device", "PINE-1234");
		while (!fs.existsSync(file)) {
			if (signal.aborted) throw new Error("cancelled");
			await new Promise((r) => setTimeout(r, 100));
		}
		const token = fs.readFileSync(file, "utf8").trim();
		fs.rmSync(file, { force: true });
		const authFile = path.join(cfg.home, "auth.json");
		const auth = fs.existsSync(authFile) ? JSON.parse(fs.readFileSync(authFile, "utf8")) : {};
		auth[provider] = { type: "oauth", access: token, refresh: token, expires: Date.now() + 365 * 86_400_000 };
		fs.writeFileSync(authFile, JSON.stringify(auth, null, 2), { mode: 0o600 });
		const rt = await modelRuntime(cfg.home);
		return [...(await rt.getAvailable(provider))].map((m: any) => `${provider}/${m.id}`);
	};
}

const MAX_LOGINS = 4;
const KEEP_ENDED_MS = 5 * 60_000;

/**
 * Sign-ins to model providers that a UI drives over several requests. pi's flow asks questions
 * and waits (for a key to be typed, for a browser to come back): here each question is parked
 * until the UI answers it, and what the flow says is kept for the UI to read. The browser is
 * the client's to open, where the owner sits, so an address is only recorded. An answer is
 * handed to the flow and kept nowhere.
 */
export class Logins {
	private sessions = new Map<string, LoginSession>();
	private run: LoginRunner;
	private secret: (value: string) => void;
	private ended: (provider: string) => Promise<string | undefined>;

	constructor(run: LoginRunner, opts: { secret?: (value: string) => void; ended?: (provider: string) => Promise<string | undefined> } = {}) {
		this.run = run;
		this.secret = opts.secret ?? (() => {});
		this.ended = opts.ended ?? (async () => undefined);
	}

	private tidy(): void {
		for (const [id, s] of this.sessions) if (s.ended && Date.now() - s.ended > KEEP_ENDED_MS) this.sessions.delete(id);
	}

	start(provider: string, type?: "api_key" | "oauth"): string {
		this.tidy();
		// One sign-in per provider: a second one takes the place of the first.
		for (const s of this.sessions.values()) if (s.provider === provider && !s.done) this.end(s, "another sign-in for this provider was started");
		if ([...this.sessions.values()].filter((s) => !s.done).length >= MAX_LOGINS) throw new Refusal(429, `${MAX_LOGINS} sign-ins are under way already. Finish or cancel one first`);
		const id = crypto.randomBytes(9).toString("base64url");
		const s: LoginSession = { provider, lines: [], done: false, abort: new AbortController() };
		this.sessions.set(id, s);
		const ask = (question: NonNullable<LoginView["question"]>) =>
			new Promise<string>((resolve, reject) => {
				if (s.done) return reject(new Error("cancelled"));
				s.question = question;
				s.answer = (value) => {
					s.question = undefined;
					s.answer = undefined;
					if (question.secret) this.secret(value);
					resolve(value);
				};
				s.abort.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
			});
		const prompter: Prompter = {
			text: (message) => ask({ message, secret: false }),
			secret: (message) => ask({ message, secret: true }),
			select: (message, options) => ask({ message, secret: false, options }),
			say: (line) => {
				if (s.lines.length < 200) s.lines.push(String(line).slice(0, 2000));
			},
			open: (url) => {
				s.url = url;
			},
			device: (uri, code) => {
				s.url = uri;
				s.code = code;
			},
		};
		void this.run(provider, type, prompter, s.abort.signal).then(
			async (models) => {
				if (s.done) return;
				s.models = models;
				s.chosen = await this.ended(provider).catch(() => undefined);
				this.end(s);
			},
			(e) => this.end(s, errText(e)),
		);
		return id;
	}

	private end(s: LoginSession, error?: string): void {
		if (s.done) return;
		s.done = true;
		s.ended = Date.now();
		s.error = error;
		s.question = undefined;
		s.answer = undefined;
		s.abort.abort();
	}

	view(id: string): LoginView | undefined {
		this.tidy();
		const s = this.sessions.get(id);
		return s && { lines: s.lines, url: s.url, code: s.code, question: s.question, done: s.done, error: s.error, models: s.models, ...(s.chosen ? { chosen: s.chosen } : {}) };
	}

	answer(id: string, value: string): boolean {
		const s = this.sessions.get(id);
		if (!s?.answer) return false;
		s.answer(value);
		return true;
	}

	cancel(id: string): boolean {
		const s = this.sessions.get(id);
		if (!s || s.done) return false;
		this.end(s, "cancelled");
		return true;
	}

	stop(): void {
		for (const s of this.sessions.values()) this.end(s, "pine is stopping");
	}
}

// ---- the requests ------------------------------------------------------------------------------------

export interface OwnerDeps {
	cfg: PineConfig;
	manager: AgentManager;
	sources?: SourceHost;
	schedules?: Scheduler;
	router?: Router;
	log: Logger;
	/** In place of pi's sign-in flow, for a test. */
	loginRunner?: LoginRunner;
}

export class OwnerApi {
	private cfg: PineConfig;
	private manager: AgentManager;
	private sources?: SourceHost;
	private schedules?: Scheduler;
	private router?: Router;
	private log: Logger;
	readonly logins: Logins;

	constructor(deps: OwnerDeps) {
		this.cfg = deps.cfg;
		this.manager = deps.manager;
		this.sources = deps.sources;
		this.schedules = deps.schedules;
		this.router = deps.router;
		this.log = deps.log;
		const standIn = process.env.PINE_LOGIN_STAND_IN;
		this.logins = new Logins(deps.loginRunner ?? (standIn ? browserStandIn(this.cfg, standIn) : (provider, type, prompter, signal) => login(this.cfg, provider, type, prompter, signal)), {
			// A key that was typed is a secret from then on, wherever it might turn up.
			secret: (value) => this.sources?.keepOut([value]),
			ended: (provider) => this.modelsChanged(provider),
		});
	}

	stop(): void {
		this.logins.stop();
	}

	/** After a sign-in or a model server: models read again, and a default that answers. */
	private async modelsChanged(provider: string): Promise<string | undefined> {
		await this.manager.reloadModels();
		return settleModel(this.cfg, this.manager, this.log, provider);
	}

	private agent(id: unknown): AgentConfig {
		const agent = typeof id === "string" ? this.cfg.agents[id] : undefined;
		if (!agent) throw new Refusal(404, `there is no agent "${String(id)}". Agents: ${Object.keys(this.cfg.agents).join(", ")}`);
		return agent;
	}

	/** The agent a request names, or none when it names none (which means: for all agents). */
	private maybeAgent(id: unknown): AgentConfig | undefined {
		return id === undefined || id === null || id === "" ? undefined : this.agent(id);
	}

	private need<T>(what: T | undefined, name: string): T {
		if (!what) throw new Refusal(404, `this pine runs without ${name}`);
		return what;
	}

	/** A GET request. Undefined: not one of these. */
	async get(parts: string[], q: URLSearchParams): Promise<unknown | undefined> {
		const cfg = this.cfg;
		const at = parts.join("/");
		if (at === "overview") {
			const pkg = JSON.parse(fs.readFileSync(path.join(PINE_ROOT, "package.json"), "utf8"));
			return { version: String(pkg.version), home: cfg.home, main: mainAgentId(cfg), platform: process.platform, sandbox: sandboxAvailable(), browser: await browserReady(), warnings: audit(cfg), modelNotes: modelKeys(cfg.home).problems, log: path.join(cfg.dataDir, "pine.log") };
		}
		if (at === "settings") {
			// What is saved and holds only from the next start is said beside what is in force.
			let saved: PineConfig | undefined;
			try {
				saved = loadConfig(cfg.home);
			} catch {
				// A file that does not load says nothing about what is saved.
			}
			return Object.entries(SETTINGS).map(([key, s]) => {
				const now = s.now(cfg);
				const next = saved ? s.now(saved) : now;
				return { key, title: s.title, about: s.about, kind: s.kind, now, live: s.live, ...(next !== now ? { saved: next } : {}) };
			});
		}
		if (parts[0] === "agents" && parts[2] === "detail" && parts.length === 3) {
			const a = this.agent(parts[1]);
			// What pine once put into a file nobody wrote in is shown as what it is: an empty file.
			const file = (name: string) => { const t = textOf(path.join(a.workspace, name)); return t === undefined ? t : ownText(t); };
			const files = { instructions: file("AGENTS.md"), soul: file("SOUL.md"), tooling: file("TOOLS.md"), memory: file("MEMORY.md"), rules: textOf(path.join(a.dir, "AGENTS.md")) };
			return {
				id: a.id, main: a.id === mainAgentId(cfg), description: purposeOf(a), ...(a.color ? { color: a.color } : {}), scroll: a.scroll, workspace: a.workspace, dir: a.dir,
				...(a.model ? { model: a.model } : {}), defaultModel: cfg.defaults.model, thinking: a.thinking, mode: a.mode,
				tools: a.tools ?? AGENT_TOOLS, allTools: AGENT_TOOLS, delegates: a.delegates, network: a.sandbox.network === true, read: a.sandbox.read, write: a.sandbox.write,
				holdings: { ...this.manager.holdings(a.id), routes: cfg.routes.filter((r) => r.agent === a.id).map((r) => r.name) },
				files: Object.fromEntries(Object.entries(files).filter(([, text]) => text !== undefined)),
			};
		}
		// pine's manual for the owner to read (the app's Manual tab): its chapters, one chapter whole, a search. The same
		// docs/ the agents search with their `manual` tool, read from pine's own code; a chapter is named by its id, never a path.
		if (at === "manual") return chapters(pineManual(path.join(PINE_ROOT, "docs")));
		if (at === "manual/chapter") {
			const found = chapter(pineManual(path.join(PINE_ROOT, "docs")), q.get("id") ?? "");
			if (!found) throw new Refusal(404, `there is no chapter "${q.get("id") ?? ""}" in the manual`);
			return found;
		}
		if (at === "manual/search") return lookUp(pineManual(path.join(PINE_ROOT, "docs")), (q.get("q") ?? "").slice(0, 200));
		// The themes of the owner's UIs, each as the colors it gives (src/theme-colors.ts), and the one in force.
		if (at === "themes") {
			const themes = listThemes(cfg.home);
			return { theme: themeInForce(cfg.home, cfg.ui.theme, themes).id, chosen: cfg.ui.theme ?? null, themes };
		}
		// The views of the app's panel and the one in force (none: the app shows no panel), and a view's code,
		// its types taken away. The daemon runs none of it: the app runs it in a sandboxed frame.
		if (at === "views") {
			const views = listViews(cfg.home).map((v) => ("problem" in v ? { id: v.id, problem: v.problem } : { id: v.id }));
			return { view: viewInForce(cfg.ui.view, listViews(cfg.home)) ?? null, chosen: cfg.ui.view ?? null, views };
		}
		if (parts[0] === "views" && parts.length === 2) return viewCode(cfg.home, parts[1]);
		if (at === "shared") return SHARED_FILES.map((name) => ({ name, about: SHARED_ABOUT[name] ?? "", text: ownText(textOf(path.join(cfg.home, name)) ?? "") }));
		if (at === "skills") return allSkills(cfg).map((s) => ({ ...s, instructions: skillBody(s.dir) }));
		// Extensions installed into pine's home, and what pi itself has for the owner to bring over (never loaded from there).
		if (at === "extensions") return (await listExtensions(cfg)).map(({ load: _load, ...x }) => x);
		if (at === "extensions/pi") {
			const have = new Set((await listExtensions(cfg)).filter((x) => x.scope === "global").map((x) => x.name));
			return inPi().map((x) => ({ ...x, installed: have.has(x.name) }));
		}
		if (at === "schedules") return this.need(this.schedules, "a scheduler").list();
		if (at === "routes") return cfg.routes.map((r) => ({ name: r.name, on: r.on, when: r.when, throttleMs: r.throttleMs, debounceMs: r.debounceMs, agent: r.agent, prompt: r.prompt, session: r.session, set: r.set, publish: r.publish, call: r.call, ask: r.ask, run: r.run, trust: r.trust, of: r.of }));
		if (at === "sources/types") return this.need(this.sources, "event sources").typeList().map((t) => ({ name: t.name, summary: t.summary, options: t.options, own: t.name in cfg.sourceTypes }));
		// (Each model with its own number of runs at a time, where it has one; and what holds for the others.)
		if (at === "decisions")
			return {
				typesafe: { signedIn: typesafeSignedIn(cfg), console: TYPESAFE.console },
				models: Object.entries(cfg.decisions).map(([name, d]) => ({ name, model: d.model, server: d.server, host: d.url ? new URL(d.url).host : undefined, where: whereIs(d), routes: usersOf(cfg, name) })),
			};
		if (at === "models/servers") return listModelServers(cfg.home).map((x) => ({ ...x, models: x.models.map((m) => ({ ...m, ...(cfg.limits.models[`${x.name}/${m.id}`] !== undefined ? { limit: cfg.limits.models[`${x.name}/${m.id}`] } : {}) })), runs: cfg.limits.maxConcurrentRuns }));
		// The model servers on the usual ports of this computer (llama.cpp, Ollama, LM Studio, Pinecone), for the owner to pick one.
		if (at === "models/local") return { found: await lookAround(cfg.http?.port) };
		if (at === "models/providers") {
			// What pi says of each provider. `signedIn` is "pi has a credential or a key for it", which
			// for a model server of the owner's own without a key is true as well; `oauth` is "its
			// definition has a browser sign-in", whether or not that is how it is signed in now. `via` is
			// how it is signed in now: in the browser ("oauth") or with a key ("api_key"), so that a key for
			// a provider that also has a subscription (Anthropic, OpenAI) is not taken for the subscription.
			const rt = this.manager.models;
			const via = (id: string) => (rt.hasConfiguredAuth(id) ? (rt.isUsingOAuth(id) ? "oauth" : "api_key") : undefined);
			return rt.getProviders().map((p: any) => ({ id: p.id, name: p.name, signedIn: rt.hasConfiguredAuth(p.id), via: via(p.id), models: safe(() => p.getModels().length, 0), oauth: Boolean(p.auth?.oauth) })).sort((a: any, b: any) => Number(b.signedIn) - Number(a.signedIn) || a.id.localeCompare(b.id));
		}
		if (at === "mcp/states") return serverStates(cfg);
		if (parts[0] === "models" && parts[1] === "login" && parts.length === 3) {
			const view = this.logins.view(parts[2]);
			if (!view) throw new Refusal(404, "there is no such sign-in (it ended a while ago, or pine was restarted). Start it again");
			return view;
		}
		return undefined;
	}

	/** A POST request. Undefined: not one of these. `long` is called by a request that takes as long as a person does. */
	async post(parts: string[], body: any, long: () => void = () => {}): Promise<unknown | undefined> {
		const at = parts.join("/");
		const mine = ["settings", "shared", "skills", "skills/remove", "extensions", "extensions/propose", "extensions/remove", "extensions/update", "schedules", "schedules/remove", "routes", "routes/remove", "decisions", "decisions/remove", "decisions/typesafe", "decisions/typesafe/remove", "sources", "sources/propose", "sources/remove", "models/servers", "models/servers/remove", "models/servers/limit", "models/model", "models/model/set", "models/model/remove", "models/login", "models/logout", "mcp/login"].includes(at) || (parts[0] === "models" && parts[1] === "login" && parts.length === 3) || (parts[0] === "agents" && parts[2] === "view" && (parts[3] === "write" || parts[3] === "files") && parts.length === 4);
		if (!mine) return undefined;
		try {
			return await this.change(at, parts, body ?? {}, long);
		} catch (e) {
			// What a checker says is wrong is the caller's to correct.
			throw e instanceof Refusal ? e : new Refusal(400, errText(e));
		}
	}

	private async change(at: string, parts: string[], body: any, long: () => void): Promise<unknown> {
		const cfg = this.cfg;
		const manager = this.manager;
		const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

		if (at === "settings") {
			const key = String(body.key ?? "");
			const checked = checkSetting(cfg, key, body.value, SETTINGS[key]?.kind === "model" ? await manager.availableModels() : []);
			applySetting(cfg, checked);
			if (checked.setting.live) await manager.refreshSessions();
			manager.settingChanged(checked.key);
			this.log.info(`setting ${checked.key} set to ${checked.text} through the control API`);
			return { key: checked.key, now: checked.setting.live ? checked.setting.now(cfg) : checked.text, live: checked.setting.live };
		}

		if (at === "shared") {
			// One of a fixed list of names, never a path.
			if (!SHARED_FILES.includes(body.name)) throw new Refusal(400, `"${String(body.name)}" is not one of the files for all agents: ${SHARED_FILES.join(", ")}`);
			if (typeof body.text !== "string") throw new Refusal(400, "text: what the file is to hold");
			if (body.text.length > MAX_TEXT) throw new Refusal(400, `that is too long for a file every agent reads with every conversation (${body.text.length} characters, at most ${MAX_TEXT})`);
			// The main agent may write this file too. What lies there is taken away and a new file
			// made, never written through: it could be a link to somewhere else.
			const target = path.join(cfg.home, body.name);
			fs.rmSync(target, { force: true });
			fs.writeFileSync(target, body.text && !body.text.endsWith("\n") ? `${body.text}\n` : body.text, { mode: 0o600, flag: "wx" });
			return { ok: true };
		}

		if (at === "skills") {
			const agent = this.maybeAgent(body.agent);
			const scope = agent ? "agent" : "global";
			const holder = agent ?? this.agent(mainAgentId(cfg));
			const skill = checkSkill({ name: body.name, description: body.description, instructions: body.instructions }, holder.workspace);
			const dir = skillDir(cfg, holder, scope, "main", skill.name);
			const seen = skillsBeside(cfg, holder, scope, "main");
			const there = seen.find((x) => x.name === skill.name && realish(x.dir) !== realish(dir));
			if (there) throw new Refusal(409, `a skill named "${skill.name}" exists already (${there.managed ? (there.scope === "global" ? "for all agents" : there.scope === "agent" ? "an agent's own" : "one conversation's own") : `yours, in ${there.dir}`}); pick another name${there.managed ? ", or remove that one first" : ""}`);
			const replaced = fs.existsSync(dir);
			writeSkill(dir, skill);
			await manager.refreshSessions(agent ? [agent.id] : undefined);
			return { name: skill.name, dir, replaced };
		}
		if (at === "skills/remove") {
			const agent = this.maybeAgent(body.agent);
			const session = str(body.session);
			const found = allSkills(cfg).find((s) => s.name === body.name && (agent ? s.agent === agent.id && (session ? s.session === session : s.scope === "agent") : s.scope === "global"));
			if (!found) throw new Refusal(404, `there is no skill "${String(body.name)}" ${agent ? `of ${agent.id}${session ? ` in the conversation ${session}` : ""}` : "for all agents"}`);
			if (!found.managed) throw new Refusal(409, `"${found.name}" lies in a folder you named in the configuration (${found.dir}), and stays yours: take it out there`);
			deleteSkill(found.dir, agent ? agent.dir : cfg.home);
			await manager.refreshSessions(agent ? [agent.id] : undefined);
			return { removed: true };
		}

		// An extension is a program inside the daemon. Here it is the owner who installs it: the page shows
		// what `propose` found, and what is posted back is installed as it was shown.
		if (at === "extensions/propose") return proposeExtension(String(body.source ?? ""));
		if (at === "extensions") {
			const agent = this.maybeAgent(body.agent);
			long();
			const proposal = await proposeExtension(String(body.source ?? ""));
			const made = await installExtension(cfg, proposal, agent, body.scripts === true);
			await manager.refreshSessions(agent ? [agent.id] : undefined);
			this.log.info(`extension ${made.source} installed ${agent ? `for ${agent.id}` : "for all agents"} through the control API`);
			const { load: _load, ...shown } = made;
			return shown;
		}
		if (at === "extensions/remove") {
			const agent = this.maybeAgent(body.agent);
			const found = (await listExtensions(cfg)).find((x) => x.source === body.source && (agent ? x.agent === agent.id : x.scope === "global"));
			if (!found) throw new Refusal(404, `there is no extension "${String(body.source)}" ${agent ? `of ${agent.id}` : "for all agents"}`);
			if (!found.managed) throw new Refusal(409, `"${found.name}" lies where you put it yourself (${found.path}), and stays yours: take it out there`);
			long();
			await uninstallExtension(cfg, found.source, agent);
			await manager.refreshSessions(agent ? [agent.id] : undefined);
			this.log.info(`extension ${found.source} removed through the control API`);
			return { removed: true };
		}
		if (at === "extensions/update") {
			const agent = this.maybeAgent(body.agent);
			const found = (await listExtensions(cfg)).find((x) => x.source === body.source && x.managed && (agent ? x.agent === agent.id : x.scope === "global"));
			if (!found) throw new Refusal(404, `there is no extension "${String(body.source)}" ${agent ? `of ${agent.id}` : "for all agents"}`);
			long();
			const next = await newerExtension(found.source);
			// `check`: only say what it would become.
			if (body.check === true || !next) return { from: found.version ?? null, to: next?.version ?? null, source: next?.source ?? null, updated: false };
			const made = await installExtension(cfg, next, agent, body.scripts === true);
			await manager.refreshSessions(agent ? [agent.id] : undefined);
			this.log.info(`extension ${found.source} updated to ${made.source} through the control API`);
			return { from: found.version ?? null, to: made.version ?? null, source: made.source, updated: true };
		}

		if (at === "schedules") {
			const sched = this.need(this.schedules, "a scheduler");
			const agent = this.maybeAgent(body.agent);
			const given = [body.cron, body.every, body.at, body.in].filter((x) => x !== undefined && x !== null && x !== "");
			if (given.length !== 1) throw new Refusal(400, 'give exactly one of "cron" (set times), "every" (an interval), "at" (once, at a time) or "in" (once, after this long)');
			if (str(body.every) && parseDuration(body.every) < 60_000) throw new Refusal(400, '"every" must be at least "1m"');
			let when: number | undefined;
			if (str(body.in)) when = Date.now() + parseDuration(body.in);
			if (body.at !== undefined && body.at !== null && body.at !== "") {
				when = typeof body.at === "number" ? body.at : Date.parse(String(body.at).trim().replace(" ", "T"));
				if (!Number.isFinite(when)) throw new Refusal(400, `"${body.at}" is not a time. Write it as 2026-12-24 17:00`);
				if (when! < Date.now() - 60_000) throw new Refusal(400, `${body.at} is in the past: it is ${localTime(Date.now()).replace("T", " ")} now`);
			}
			if (str(body.session) && !agent) throw new Refusal(400, '"session" names a conversation of an agent: give "agent" too');
			const raw = { name: body.name, task: body.task, cron: str(body.cron), every: str(body.every), at: when, session: agent ? str(body.session) : undefined };
			// `replace` names the schedule of the same agent (or of all agents) this one takes the place of.
			if (str(body.replace)) return sched.replace(agent?.id, String(body.replace), raw);
			return sched.add(agent?.id, sched.check(raw));
		}
		if (at === "schedules/remove") {
			const agent = this.maybeAgent(body.agent);
			const removed = this.need(this.schedules, "a scheduler").remove(agent?.id, String(body.name ?? ""));
			if (!removed) throw new Refusal(404, `there is no schedule "${String(body.name)}" ${agent ? `of ${agent.id}` : "for all agents"}`);
			return { removed };
		}

		if (at === "routes") {
			const input = body as RouteInput;
			// `replace` names the route this one takes the place of: it is checked as if that one were gone.
			const old = str(body.replace) ? cfg.routes.find((r) => r.name === body.replace) : undefined;
			if (str(body.replace) && !old) throw new Refusal(404, `there is no route "${String(body.replace)}"`);
			// `of`: the route is the agent's own, as one it made itself: on its own sources and state, acting
			// within it, and gone with it. A route that changes keeps the agent it was of.
			const of = old ? old.of : str(body.of);
			if (of && !old) {
				const agent = this.maybeAgent(of)!;
				if (agent.id === mainAgentId(cfg)) throw new Refusal(400, "the main agent's routes are pine's: leave out \"of\"");
			}
			const view = old ? { ...cfg, routes: cfg.routes.filter((r) => r !== old) } : cfg;
			const checked = checkRoute(view, input, input.call_model || input.ask_model ? await manager.availableModels() : [], of);
			if (old) {
				const made = replaceRoute(cfg, old.name, checked.entry);
				this.router?.remove(old.name);
				this.router?.add(made);
			} else this.router?.add(addRoute(cfg, checked.entry));
			await manager.sources?.routesChanged();
			return { name: String(checked.entry.name), lines: checked.lines, ...(checked.wider ? { wider: checked.wider } : {}) };
		}
		if (at === "routes/remove") {
			const found = cfg.routes.find((r) => r.name === body.name);
			if (!found) throw new Refusal(404, `there is no route "${String(body.name)}". ${cfg.routes.length ? `Routes: ${cfg.routes.map((r) => r.name).join(", ")}` : "There are no routes"}`);
			dropRoute(cfg, found.name);
			this.router?.remove(found.name);
			await manager.sources?.routesChanged();
			return { removed: true };
		}

		if (at === "sources/propose" || at === "sources") {
			const host = this.need(this.sources, "event sources");
			const agent = this.maybeAgent(body.agent);
			// A source for all agents is set up as the main agent would: a path is meant from its workspace.
			const by = agent?.id ?? mainAgentId(cfg);
			const name = String(body.name ?? "");
			const type = String(body.type ?? "");
			const options = body.options && typeof body.options === "object" && !Array.isArray(body.options) ? body.options : {};
			if (at === "sources/propose") {
				const plan = host.propose(by, name, type, options, !agent, Array.isArray(body.ask) ? body.ask.map(String) : []);
				// What it would do, and what only the owner has. No option's value goes back: one of them may be a secret.
				return { does: plan.does, opens: plan.opens, needs: plan.needs, ...(plan.owner ? { owner: true } : {}), ...(plan.tell ? { tell: plan.tell } : {}) };
			}
			// What the owner typed for what was needed: a secret from here on, checked by the type like any option.
			const values: Record<string, string> = body.values && typeof body.values === "object" && !Array.isArray(body.values) ? Object.fromEntries(Object.entries(body.values).map(([k, v]) => [k, String(v)])) : {};
			host.keepOut(Object.values(values));
			const plan = host.propose(by, name, type, { ...options, ...values }, !agent, Array.isArray(body.ask) ? body.ask.map(String) : []);
			if (plan.needs.length) throw new Refusal(400, `this source needs you to enter ${plan.needs.map((n) => n.name).join(", ")}: send ${plan.needs.length === 1 ? "it" : "them"} in "values"`, { needs: plan.needs });
			const entry: Record<string, unknown> = { type, description: String(body.description ?? ""), ...plan.options };
			if (body.own === true || plan.owner) entry.trust = "owner";
			const made = host.add(agent?.id, name, entry, plan.read, plan.secrets);
			if (plan.read) await manager.refreshSessions([by]);
			return { name, type: made.type, ...(plan.tell ? { tell: plan.tell } : {}) };
		}
		if (at === "sources/remove") {
			const agent = this.maybeAgent(body.agent);
			const gone = await this.need(this.sources, "event sources").remove(agent?.id, String(body.name ?? ""));
			if (!gone.removed) throw new Refusal(404, `there is no event source "${String(body.name)}" ${agent ? `of ${agent.id}` : "for all agents"}`);
			if (agent) await manager.refreshSessions([agent.id]);
			return gone;
		}

		// Decision models: the owner's own hand, with the checks of add_decision_model, remove_decision_model and sign_in.
		if (at === "decisions") {
			const input = { name: String(body.name ?? ""), server: body.server ? String(body.server) : undefined, url: body.url ? String(body.url) : undefined, model: body.model ? String(body.model) : undefined, local: body.local === true };
			const checked = (() => {
				try {
					return checkDecision(cfg, input);
				} catch (e) {
					throw new Refusal(400, errText(e));
				}
			})();
			if (checked.needsKey) throw new Refusal(409, "pine is not signed in to TypeSafe: sign in first, with a key from console.typesafe.ai", { signIn: "typesafe" });
			const key = input.url && typeof body.key === "string" && body.key.trim() ? body.key.trim() : undefined;
			if (key) manager.sources?.keepOut([key]);
			const made = addDecision(cfg, input.name, checked.entry, key);
			return { name: input.name, model: made.model, where: whereIs(made), lines: checked.lines };
		}
		if (at === "decisions/remove") {
			const name = String(body.name ?? "");
			if (!cfg.decisions[name]) throw new Refusal(404, `there is no decision model "${name}"`);
			const users = usersOf(cfg, name);
			if (users.length) throw new Refusal(409, `the route${users.length === 1 ? "" : "s"} ${users.join(", ")} ask${users.length === 1 ? "s" : ""} "${name}". Remove ${users.length === 1 ? "it" : "them"} first, under Events`, { users });
			removeDecision(cfg, name);
			return { removed: true };
		}
		if (at === "decisions/typesafe") {
			const key = String(body.key ?? "").trim();
			if (!key) throw new Refusal(400, "the key is empty");
			manager.sources?.keepOut([key]);
			try {
				await signInTypesafe(cfg, key);
			} catch (e) {
				throw new Refusal(409, errText(e));
			}
			return { signedIn: true };
		}
		if (at === "decisions/typesafe/remove") {
			signOutTypesafe(cfg);
			return { signedIn: false };
		}
		if (at === "models/servers") {
			const baseUrl = serverUrl(String(body.url ?? ""));
			const name = String(body.name ?? "");
			checkServerName(name, manager.models.getProviders().map((p: any) => p.id));
			const given = str(body.key);
			if (given) this.sources?.keepOut([given]);
			// Asked without a key first: one that the server does not want is not kept.
			let look = await lookAt(baseUrl);
			let key: string | undefined;
			if (look.locked) {
				if (!given) throw new Refusal(409, `${new URL(baseUrl).host} wants a key. Send it as "key"`, { locked: true });
				look = await lookAt(baseUrl, given);
				if (look.locked) throw new Refusal(409, "the server did not accept that key. Nothing was added", { locked: true });
				key = given;
			}
			const context = body.context === undefined || body.context === null || body.context === "" ? undefined : Number(body.context);
			let models: string[];
			try {
				models = addModelServer(cfg.home, { name, baseUrl, key, models: look.models, context, reasoning: typeof body.reasoning === "boolean" ? body.reasoning : undefined });
			} catch (e) {
				// A server that does not say how much context its models get: `unsized`, for a UI to ask for it by that and not by the words.
				const unsized = !context && look.models.some((m) => !m.contextWindow);
				throw new Refusal(400, errText(e), unsized ? { unsized: true } : undefined);
			}
			const chosen = await this.modelsChanged(name);
			return { models, ...(chosen ? { chosen } : {}) };
		}
		if (at === "models/servers/limit") {
			// How many runs a model takes at a time: a number, or nothing for pine's own limit.
			// (By its server's name and "model", the id the server gives it.)
			const known = [...new Set([...listModelServers(cfg.home).flatMap((x) => x.models.map((m) => `${x.name}/${m.id}`)), ...(await manager.availableModels())])];
			let checked: ReturnType<typeof checkModelLimit>;
			try {
				checked = checkModelLimit(known, body.name, body.model, body.limit);
			} catch (e) {
				throw new Refusal(400, errText(e));
			}
			applyModelLimit(cfg, checked);
			return { name: checked.name, model: checked.model, ...(checked.limit !== undefined ? { limit: checked.limit } : {}), runs: cfg.limits.maxConcurrentRuns };
		}
		if (at === "models/model" || at === "models/model/set" || at === "models/model/remove") {
			// One model of a server of the owner's own: added, set up, removed. The same plans as the main agent's
			// add_model, configure_model and remove_model, without the question: the token is the owner.
			const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
			const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
			let plan: ModelPlan;
			try {
				plan =
					at === "models/model"
						? await planModelAdd(cfg, manager, body.model, num(body.context))
						: at === "models/model/set"
							? await planModelChange(cfg, manager, body.model, { context: num(body.context), maxTokens: num(body.maxTokens), images: bool(body.images), reasoning: bool(body.reasoning), runs: num(body.runs) })
							: planModelRemove(cfg, manager, body.model);
			} catch (e) {
				throw new Refusal(/in use by/.test(errText(e)) ? 409 : 400, errText(e));
			}
			await plan.apply();
			return { model: plan.ref, changed: plan.lines.slice(1) };
		}
		if (at === "models/servers/remove") {
			const name = String(body.name ?? "");
			if (!listModelServers(cfg.home).some((s) => s.name === name)) throw new Refusal(404, `there is no model server "${name}"`);
			const users = modelServerUsers(cfg, name);
			if (users.length) throw new Refusal(409, `"${name}" is in use by ${users.join(", ")}. Give ${users.length === 1 ? "it" : "them"} another model first`, { users });
			removeModelServer(cfg, name);
			await manager.reloadModels();
			return { removed: true };
		}

		if (at === "models/login") {
			const provider = String(body.provider ?? "");
			if (!manager.models.getProvider(provider)) throw new Refusal(400, `unknown provider "${provider}". GET /models/providers lists them`);
			if (body.type !== undefined && body.type !== "api_key" && body.type !== "oauth") throw new Refusal(400, '"type" is api_key or oauth; left out, the provider\'s usual way is taken');
			return { id: this.logins.start(provider, body.type) };
		}
		if (parts[0] === "models" && parts[1] === "login" && parts.length === 3) {
			if (body.cancel === true) return { cancelled: this.logins.cancel(parts[2]) };
			if (typeof body.answer !== "string") throw new Refusal(400, 'send { "answer": "..." } for the question that is open, or { "cancel": true }');
			if (!this.logins.view(parts[2])) throw new Refusal(404, "there is no such sign-in. Start it again");
			if (!this.logins.answer(parts[2], body.answer)) throw new Refusal(409, "this sign-in is not waiting for an answer right now");
			return { ok: true };
		}
		if (at === "models/logout") {
			await logout(cfg, String(body.provider ?? ""), () => {});
			await manager.reloadModels();
			return { ok: true };
		}

		if (at === "mcp/login") {
			const name = String(body.name ?? "");
			const agent = this.maybeAgent(body.agent);
			const server = findServer(cfg, name, agent?.id);
			if (!server) throw new Refusal(404, `there is no MCP server "${name}"${agent ? ` of ${agent.id}` : ""}`);
			if (!server.url) throw new Refusal(400, `"${name}" is a local server; only a remote one has a sign-in`);
			// It waits for a person in a browser.
			long();
			const done = await piMcp(cfg, { [name]: server }, ["login", name], { capture: true });
			// Sessions that started before the sign-in do not have the server's tools yet.
			if (done.code === 0) await manager.refreshSessions();
			return { code: done.code, out: done.out };
		}

		if (parts[0] === "agents" && parts[2] === "view" && (parts[3] === "write" || parts[3] === "files")) {
			this.agent(parts[1]);
			const root = manager.viewRoot(parts[1], str(body.session) ?? "main");
			if (!root) throw new Refusal(404, "no such agent");
			if (parts[3] === "write") {
				if (typeof body.path !== "string" || typeof body.text !== "string") throw new Refusal(400, "path and text required: the file, from the top of the folder, and what it is to hold");
				if (Buffer.byteLength(body.text, "utf8") > MAX_EDIT) throw new Refusal(413, `that is too much for one file here (at most ${MAX_EDIT} bytes)`);
			} else if (!["folder", "file", "rename", "copy", "move", "delete"].includes(String(body.op))) throw new Refusal(400, 'op: "folder", "file", "rename", "copy", "move" or "delete"');
			// A conversation works in a folder of the owner's or in its agent's workspace. Neither is
			// pine's home or pine's code, nor holds them: where one would be, nothing is changed.
			const base = realish(root);
			for (const own of [realish(cfg.home), realish(PINE_ROOT)]) if (base === own || isInside(base, own)) throw new Refusal(403, "pine's own files are not changed through a conversation's folder");
			if (isInside(realish(PINE_ROOT), base)) throw new Refusal(403, "pine's own code is not changed through a conversation's folder");
			try {
				if (parts[3] === "write") return await writeText(root, body.path as string, body.text as string);
				// In the agent's workspace its own files stay where they are; they are edited, not deleted, moved or renamed.
				const own = base === realish(cfg.agents[parts[1]].workspace) ? WORKSPACE_FILES : [];
				return await changeFiles(root, body as unknown as FileChange, own);
			} catch (e) {
				throw new Refusal(409, errText(e));
			}
		}
		throw new Refusal(404, "not found");
	}
}

const safe = <T>(fn: () => T, otherwise: T): T => {
	try {
		return fn();
	} catch {
		return otherwise;
	}
};

// In src/admin.ts, where the main agent's sign_in uses it too; said here for those who import it from here.
export { settleModel };
