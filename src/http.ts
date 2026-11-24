import crypto from "node:crypto";
import http from "node:http";
import { checkAgentId } from "./admin.ts";
import { checkNewAgent, instructionsWith } from "./agent-admin.ts";
import type { AgentManager } from "./agents.ts";
import { mainAgentId, type PineConfig, purposeOf } from "./config.ts";
import { type Approvals, timingSafeEqual } from "./security.ts";
import type { Bus, State, TaskStore } from "./store.ts";
import { addServer, listServers, removeServer } from "./mcp-config.ts";
import { changes, diffOf, listDir, MAX_EDIT, readText, findFiles } from "./workspace-view.ts";
import { type LoginRunner, OwnerApi, Refusal, settleModel } from "./owner.ts";
import type { Router } from "./router.ts";
import type { SourceHost } from "./sources.ts";
import { pineVersion } from "./service.ts";
import { readQuotes } from "./quotes.ts";
import type { Scheduler } from "./timers.ts";
import { errText, type Logger, topicMatches } from "./util.ts";

const MAX_BODY = 1024 * 1024;

class HttpError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/**
 * The one range of bytes a `Range` header asks for, within a file of `size` bytes: the first and
 * last byte, both included. `undefined` when there is no header or it is not one plain range of
 * bytes (several ranges, another unit, nonsense): the whole file is the answer then, as HTTP
 * allows. "unsatisfiable" when the range starts past the end.
 */
export function byteRange(header: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | undefined {
	const m = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
	if (!m || (m[1] === "" && m[2] === "")) return undefined;
	if (m[1] === "") {
		// The last n bytes.
		const n = Number(m[2]);
		if (n === 0 || size === 0) return "unsatisfiable";
		return { start: Math.max(0, size - n), end: size - 1 };
	}
	const start = Number(m[1]);
	if (m[2] !== "" && Number(m[2]) < start) return undefined;
	if (start >= size) return "unsatisfiable";
	const end = m[2] === "" ? size - 1 : Number(m[2]);
	return { start, end: Math.min(end, size - 1) };
}

/**
 * Control API and webhooks. Every request except /health and /hook/* needs the bearer token.
 * Requests that come from a web page (an Origin header, a foreign Host) are refused, so a site
 * open in a browser on this machine cannot drive the daemon.
 */
export class HttpServer {
	private cfg: PineConfig;
	private bus: Bus;
	private state: State;
	private tasks: TaskStore;
	private manager: AgentManager;
	private approvals: Approvals;
	private log: Logger;
	private token: string;
	private server?: http.Server;
	private hits = new Map<string, number[]>();
	port = 0;

	private sources?: SourceHost;
	/** What the owner changes about pine's setup with their own hand (src/owner.ts). */
	private owner: OwnerApi;

	constructor(deps: { cfg: PineConfig; bus: Bus; state: State; tasks: TaskStore; manager: AgentManager; approvals: Approvals; sources?: SourceHost; schedules?: Scheduler; router?: Router; log: Logger; token: string; loginRunner?: LoginRunner }) {
		this.sources = deps.sources;
		this.owner = new OwnerApi({ cfg: deps.cfg, manager: deps.manager, sources: deps.sources, schedules: deps.schedules, router: deps.router, log: deps.log, loginRunner: deps.loginRunner });
		this.cfg = deps.cfg;
		this.bus = deps.bus;
		this.state = deps.state;
		this.tasks = deps.tasks;
		this.manager = deps.manager;
		this.approvals = deps.approvals;
		this.log = deps.log;
		this.token = deps.token;
	}

	async start(): Promise<void> {
		const { host, port } = this.cfg.http!;
		this.server = http.createServer((req, res) => void this.handle(req, res));
		this.server.requestTimeout = 30_000;
		this.server.headersTimeout = 10_000;
		await new Promise<void>((resolve, reject) => {
			this.server!.once("error", reject);
			this.server!.listen(port, host, resolve);
		});
		this.port = (this.server.address() as any).port;
		// With port 0 the system picked one. Others ask the configuration where the control port is
		// (the browser gate never opens it).
		this.cfg.http!.port = this.port;
		this.log.info(`http listening on ${host}:${this.port}`);
	}

	async stop(): Promise<void> {
		this.owner.stop();
		this.server?.closeAllConnections?.();
		await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
	}

	private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const send = (status: number, body: unknown) => {
			if (res.headersSent) return;
			res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" });
			res.end(JSON.stringify(body));
		};
		const sendPicture = (p: { mime: string; bytes: Buffer } | undefined) => {
			if (!p) return send(404, { error: "no such picture" });
			const headers = { "content-type": p.mime, "accept-ranges": "bytes", "cache-control": "no-store", "x-content-type-options": "nosniff" };
			// A player that seeks in a sound or a video asks for a part of it. Over a slow road (the
			// phone's SSH channel) sending the whole file again for each seek is what makes it stall.
			const range = byteRange(req.headers.range, p.bytes.length);
			if (range === "unsatisfiable") {
				res.writeHead(416, { ...headers, "content-range": `bytes */${p.bytes.length}`, "content-length": 0 });
				res.end();
				return;
			}
			if (range) {
				res.writeHead(206, { ...headers, "content-range": `bytes ${range.start}-${range.end}/${p.bytes.length}`, "content-length": range.end - range.start + 1 });
				res.end(p.bytes.subarray(range.start, range.end + 1));
				return;
			}
			res.writeHead(200, { ...headers, "content-length": p.bytes.length });
			res.end(p.bytes);
		};
		try {
			const url = new URL(req.url ?? "/", "http://pine.local");
			const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
			const method = req.method ?? "GET";

			if (method === "GET" && url.pathname === "/health") return send(200, { ok: true });
			if (parts[0] === "hook" && parts.length === 2 && method === "POST") return send(202, await this.hook(parts[1], req));

			this.guardBrowser(req);
			const auth = req.headers.authorization ?? "";
			if (!auth.startsWith("Bearer ") || !timingSafeEqual(auth.slice(7), this.token)) throw new HttpError(401, "missing or wrong bearer token");

			if (method === "GET") {
				const q = url.searchParams;
				const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
				if (url.pathname === "/status") return send(200, { ...this.manager.status(), agents: Object.keys(this.cfg.agents), approvals: this.approvals.pending().length, bypassWhenTainted: this.cfg.security.bypassWhenTainted, version: pineVersion() });
				if (url.pathname === "/agents") {
					// (`modelProblem` only where there is one: why that agent's model cannot answer.)
					const problems = await this.manager.modelProblems();
					return send(200, Object.values(this.cfg.agents).map((a) => ({ id: a.id, main: a.id === mainAgentId(this.cfg), description: purposeOf(a), ...(a.color ? { color: a.color } : {}), workspace: a.workspace, model: a.model ?? this.cfg.defaults.model, thinking: a.thinking, mode: a.mode, delegates: a.delegates, ...(problems[a.id] ? { modelProblem: problems[a.id] } : {}) })));
				}
				if (url.pathname === "/tasks") return send(200, this.tasks.list({ agent: q.get("agent") ?? undefined, session: q.get("session") ?? undefined, status: (q.get("status") as any) ?? undefined, limit: num("limit") }));
				if (url.pathname === "/models") return send(200, await this.manager.availableModels());
				if (url.pathname === "/mcp") return send(200, listServers(this.cfg));
				if (url.pathname === "/sources") return send(200, this.sources?.list() ?? []);
				if (parts[0] === "agents" && parts[2] === "sources" && parts.length === 3) {
					if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
					// (For one conversation with `session`: what that conversation is subscribed to on its own is said too.)
					return send(200, this.sources?.available(parts[1], q.get("session") ?? "main") ?? []);
				}
				if (parts[0] === "agents" && parts[2] === "sessions" && parts.length === 3) {
					if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
					return send(200, this.manager.conversations(parts[1]));
				}
				// An agent's groups of conversations, empty ones too, and how its list is sorted.
				if (parts[0] === "agents" && parts[2] === "groups" && parts.length === 3) {
					if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
					return send(200, this.manager.groupList(parts[1]));
				}
				if (url.pathname === "/ui/tabs") return send(200, this.manager.uiTabs());
				if (parts[0] === "tasks" && parts[2] === "transcript" && parts.length === 3) {
					const t = this.manager.transcript(Number(parts[1]), q.get("full") === "1");
					return t ? send(200, t) : send(404, { error: "no such task" });
				}
				// Pictures for a UI to show. They are never sent to a model from here.
				if (parts[0] === "media" && parts[1] === "tool" && parts.length === 3) return sendPicture(this.manager.toolImage(parts[2]));
				if (parts[0] === "tasks" && parts[2] === "images" && parts.length === 4) return sendPicture(this.manager.taskImage(Number(parts[1]), Number(parts[3])));
				if (parts[0] === "agents" && parts[2] === "image" && parts.length === 3) return sendPicture(this.manager.workspaceImage(parts[1], q.get("path") ?? "", q.get("session") ?? undefined));
				// The folder a conversation works in, and what a UI shows of it: files, and what git says changed.
				if (parts[0] === "agents" && parts[2] === "folder" && parts.length === 3) {
					if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
					return send(200, { folder: this.manager.folderOf(parts[1], q.get("session") ?? "main"), workspace: this.cfg.agents[parts[1]].workspace });
				}
				// The browser of a conversation, for a UI that shows it itself: where it is, and the page as a picture.
				if (parts[0] === "agents" && parts[2] === "browser" && (parts.length === 3 || (parts[3] === "frame" && parts.length === 4))) {
					if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
					const session = q.get("session") ?? "main";
					if (parts.length === 3) return send(200, await this.manager.browserState(parts[1], session));
					const bytes = await this.manager.browserFrame(parts[1], session);
					return sendPicture(bytes ? { mime: "image/jpeg", bytes } : undefined);
				}
				// What a conversation's commands left running, for a UI to show and to stop.
				if (parts[0] === "agents" && parts[2] === "programs" && parts.length === 3) {
					if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
					return send(200, this.manager.programsOf(parts[1], q.get("session") ?? "main"));
				}
				if (parts[0] === "agents" && parts[2] === "todos" && parts.length === 3) {
					if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
					return send(200, this.manager.todosOf(parts[1], q.get("session") ?? "main"));
				}
				// Boards (src/boards.ts): all of them, one with everything on it, and those a conversation can use.
				if (url.pathname === "/boards") return send(200, this.manager.boardList());
				if (parts[0] === "boards" && parts.length === 2) {
					const found = this.manager.boardView(Number(parts[1]));
					return found ? send(200, found) : send(404, { error: "no such board" });
				}
				if (parts[0] === "agents" && parts[2] === "boards" && parts.length === 3) {
					if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
					return send(200, this.manager.boardsFor(parts[1], q.get("session") ?? "main"));
				}
				// The goal the owner set for a conversation, and where it stands.
				if (parts[0] === "agents" && parts[2] === "goal" && parts.length === 3) {
					if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
					return send(200, { goal: this.manager.goals.get(parts[1], q.get("session") ?? "main") });
				}
				// The swarm the owner started in a conversation, and where it stands.
				if (parts[0] === "agents" && parts[2] === "swarm" && parts.length === 3) {
					if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
					return send(200, { swarm: this.manager.swarms.get(parts[1], q.get("session") ?? "main") });
				}
				// A conversation's worktree and where it stands against its base; and every worktree of pine's.
				if (parts[0] === "agents" && parts[2] === "worktree" && parts.length === 3) {
					if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
					return send(200, { worktree: (await this.manager.worktreeStatus(parts[1], q.get("session") ?? "main")) ?? null });
				}
				if (url.pathname === "/worktrees") return send(200, await this.manager.listWorktrees());
				if (parts[0] === "agents" && parts[2] === "folders" && parts.length === 3) {
					if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
					return send(200, this.manager.folders(parts[1]));
				}
				// What the owner's last message in a conversation changed in its folder (src/undo.ts).
				if (parts[0] === "agents" && parts[2] === "view" && (parts[3] === "turn" || parts[3] === "turndiff") && parts.length === 4) {
					if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
					const session = q.get("session") ?? "main";
					const found = parts[3] === "turn" ? await this.manager.lastTurn(parts[1], session) : await this.manager.lastTurnDiff(parts[1], session, q.get("path") ?? "");
					if (!found) throw new HttpError(404, "nothing there");
					return send(200, found);
				}
				if (parts[0] === "agents" && parts[2] === "view" && parts.length === 4) {
					const root = this.manager.viewRoot(parts[1], q.get("session") ?? "main");
					if (!root) throw new HttpError(404, "no such agent");
					const rel = q.get("path") ?? "";
					const found = parts[3] === "find" ? { files: await findFiles(root, (q.get("q") ?? "").slice(0, 200)) } : parts[3] === "changes" ? { root, ...(await changes(root)), worktree: await this.worktreeLine(parts[1], q.get("session") ?? "main") } : parts[3] === "diff" ? await diffOf(root, rel) : parts[3] === "tree" ? listDir(root, rel) : parts[3] === "file" ? readText(root, rel, q.has("max") ? Math.max(1, Math.min(MAX_EDIT, Math.floor(num("max") || 0))) : undefined) : undefined;
					if (!found) throw new HttpError(404, "nothing there");
					return send(200, found);
				}
				if (parts[0] === "tasks" && parts.length === 2) {
					const t = this.tasks.get(Number(parts[1]));
					return t ? send(200, t) : send(404, { error: "no such task" });
				}
				if (url.pathname === "/events") return send(200, this.bus.query({ topic: q.get("topic") ?? undefined, after: num("after"), limit: num("limit") }));
				if (url.pathname === "/events/stream") return this.stream(req, res, q.get("topic") ?? "#");
				if (url.pathname === "/state") return send(200, this.state.list(q.get("key") ?? "#"));
				if (url.pathname === "/approvals") return send(200, this.approvals.pending());
				const found = await this.owner.get(parts, q);
				if (found !== undefined) return send(200, found);
				throw new HttpError(404, "not found");
			}

			if (method !== "POST") throw new HttpError(405, "method not allowed");
			// A message may carry attached files; everything else stays small.
			const isPrompt = parts[0] === "agents" && parts[2] === "prompt" && parts.length === 3;
			// (So does a file's text from an editor: what it may hold, and room for how JSON writes it.)
			const isFile = parts[0] === "agents" && parts[2] === "view" && parts[3] === "write" && parts.length === 4;
			const body = (await this.json(req, isPrompt ? 64 * MAX_BODY : isFile ? 8 * MAX_BODY : MAX_BODY)) as any;
			const changed = await this.owner.post(parts, body, () => res.setTimeout(0));
			if (changed !== undefined) return send(200, changed);
			if (url.pathname === "/images/fetch") {
				if (typeof body.url !== "string") throw new HttpError(400, "url required");
				try {
					return sendPicture(await this.manager.fetchImage(body.url));
				} catch (e) {
					throw new HttpError(502, errText(e));
				}
			}
			if (url.pathname === "/events") {
				if (typeof body.topic !== "string") throw new HttpError(400, "topic required");
				const e = this.bus.publish(body.topic, body.payload ?? null, { source: "api", trust: body.trust === "untrusted" ? "untrusted" : "owner" });
				return send(202, { id: e.id });
			}
			if (parts[0] === "agents" && parts[2] === "prompt" && parts.length === 3) {
				const quotes = body.quotes === undefined ? undefined : readQuotes(body.quotes);
				if (typeof quotes === "string") throw new HttpError(400, quotes);
				if (typeof body.prompt !== "string" || (!body.prompt && !quotes?.length)) throw new HttpError(400, "prompt required");
				// "steer": if the conversation is working, the message goes into that work instead of waiting behind it.
				const task = this.manager.submit({ agent: parts[1], prompt: body.prompt, session: body.session, trust: "owner", kind: "prompt", priority: 10, attachments: Array.isArray(body.attachments) ? body.attachments : undefined, whenBusy: body.whenBusy === "steer" ? "steer" : undefined, mentions: Array.isArray(body.mentions) ? body.mentions : undefined, quotes: quotes?.length ? quotes : undefined, via: body.via === "app" ? "app" : undefined });
				if (body.wait === false) return send(202, { task: task.id, steered: task.meta.steered });
				res.setTimeout(0);
				req.on("close", () => !res.writableEnded && body.cancelOnDisconnect && this.manager.cancel(task.id));
				return send(200, await this.manager.wait(task.id));
			}
			// The Pine app: a command of an answer that the owner ran in their terminal is still running, or has ended.
			if (parts[0] === "agents" && parts[2] === "terminal" && parts.length === 3) {
				const n = (v: unknown, most: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(most, v)) : undefined);
				if (typeof body.session !== "string" || !body.session || typeof body.command !== "string" || !body.command.trim() || (body.state !== "running" && body.state !== "ended")) throw new HttpError(400, "send session, command and state (running or ended), with code, seconds and output");
				const code = typeof body.code === "number" && Number.isInteger(body.code) && body.code >= 0 && body.code < 256 ? body.code : undefined;
				const task = this.manager.terminalReport(parts[1], body.session, { command: body.command.slice(0, 4000), state: body.state, code, seconds: n(body.seconds, 1e7) ?? 0, output: typeof body.output === "string" ? body.output.slice(-16_000) : "" });
				return send(202, { task: task.id });
			}
			if (url.pathname === "/models/refresh") {
				// The owner signed in, or added or removed a model server, with the pine command.
				await this.manager.reloadModels();
				const chosen = await settleModel(this.cfg, this.manager, this.log, typeof body.provider === "string" ? body.provider : undefined);
				return send(200, { ok: true, ...(chosen ? { chosen } : {}) });
			}
			if (url.pathname === "/mcp/refresh") {
				await this.manager.refreshSessions();
				return send(200, { ok: true });
			}
			if (url.pathname === "/mcp") {
				// The owner adds or removes a server while the daemon runs; sessions pick it up when next used.
				if (typeof body.name !== "string") throw new HttpError(400, "name required");
				const agent = typeof body.agent === "string" ? body.agent : undefined;
				if (body.remove === true) {
					if (!removeServer(this.cfg, body.name, agent)) throw new HttpError(404, "no such server");
				} else {
					if (!body.server || typeof body.server !== "object") throw new HttpError(400, "server required");
					if (JSON.stringify(body.server).includes("${")) throw new HttpError(400, "a server that refers to ${NAME} values is read from the file at startup: add it with the daemon stopped, or restart afterwards");
					addServer(this.cfg, body.name, body.server, agent);
				}
				await this.manager.refreshSessions(agent ? [agent] : undefined);
				return send(200, { ok: true });
			}
			// Agents are made and removed by the owner here (`pine agent add`, `pine agent remove`), as the main agent does it by tool.
			if (url.pathname === "/agents") {
				// What it is for is the first paragraph of its instructions; `description`, where a client still sends it, becomes that paragraph.
				const instructions = typeof body.id === "string" ? instructionsWith(body.id, body.description, body.instructions) : "";
				if (typeof body.id !== "string" || !instructions) throw new HttpError(400, "id and instructions required: who the agent is and how it works, the first paragraph saying what it is for");
				const spec = { id: body.id, instructions, model: typeof body.model === "string" ? body.model : undefined, tools: Array.isArray(body.tools) ? body.tools.map(String) : undefined, color: typeof body.color === "string" ? body.color : undefined };
				// What is wrong with the owner's values is theirs to correct, not a failure of the daemon.
				try {
					checkNewAgent(this.cfg, spec);
				} catch (e) {
					throw new HttpError(400, errText(e));
				}
				const made = await this.manager.addAgent(spec);
				return send(200, { id: made.id, workspace: made.workspace });
			}
			// (An address of its own, and the agent's name once more in the body: "/agents/<id>/remove" removes a conversation.)
			if (parts[0] === "agents" && parts[2] === "erase" && parts.length === 3) {
				if (body.agent !== parts[1]) throw new HttpError(400, `to remove the agent ${parts[1]} with everything it has, send { "agent": "${parts[1]}" }`);
				return send(200, await this.manager.removeAgent(parts[1], body.keepFiles === true));
			}
			// Another id for an agent, with everything that carries its name (`pine agent rename`), as the main agent does it by tool.
			// (An address of its own, and the agent's name once more in the body: "/agents/<id>/rename" renames a conversation.)
			if (parts[0] === "agents" && parts[2] === "id" && parts.length === 3) {
				if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
				if (body.agent !== parts[1] || typeof body.to !== "string") throw new HttpError(400, `to give the agent ${parts[1]} another id, send { "agent": "${parts[1]}", "to": "<new id>" }`);
				try {
					if (body.to.trim() !== parts[1]) checkAgentId(this.cfg, body.to.trim());
				} catch (e) {
					throw new HttpError(400, errText(e));
				}
				try {
					return send(200, await this.manager.renameAgent(parts[1], body.to));
				} catch (e) {
					// Busy is the owner's to wait for, not a failure of the daemon.
					if (/is working|left programs running|working on something/.test(errText(e))) throw new HttpError(409, errText(e));
					throw e;
				}
			}
			if (parts[0] === "agents" && parts[2] === "mode" && parts.length === 3) {
				this.manager.setMode(parts[1], body.mode, body.anyway === true && typeof body.session === "string" ? body.session : undefined);
				return send(200, { mode: body.mode });
			}
			if (parts[0] === "agents" && parts[2] === "compact" && parts.length === 3) return send(202, { task: this.manager.compact(parts[1], typeof body.session === "string" ? body.session : "main").id });
			if (parts[0] === "agents" && parts[2] === "thinking" && parts.length === 3) {
				this.manager.setThinking(parts[1], String(body.level));
				return send(200, { level: body.level });
			}
			if (parts[0] === "agents" && parts[2] === "model" && parts.length === 3) {
				if (typeof body.model !== "string") throw new HttpError(400, "model required");
				await this.manager.setModel(parts[1], body.model);
				return send(200, { model: body.model });
			}
			// Change an agent's settings (`pine agent update`), as the main agent does it by tool.
			if (parts[0] === "agents" && parts[2] === "update" && parts.length === 3) {
				if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
				const { agent: _a, ...change } = body;
				try {
					return send(200, await this.manager.updateAgent(parts[1], change));
				} catch (e) {
					throw new HttpError(400, errText(e));
				}
			}
			if (parts[0] === "agents" && (parts[2] === "subscribe" || parts[2] === "unsubscribe") && parts.length === 3) {
				if (!this.sources) throw new HttpError(404, "not found");
				if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
				if (typeof body.source !== "string" || !body.source) throw new HttpError(400, "source required");
				try {
					if (parts[2] === "unsubscribe") {
						const sessions = await this.sources.unsubscribe(parts[1], body.source, typeof body.session === "string" ? body.session : undefined);
						return send(200, { unsubscribed: sessions.length > 0, sessions });
					}
					const { source: _s, ...details } = body;
					return send(200, await this.sources.subscribe(parts[1], body.source, details));
				} catch (e) {
					throw new HttpError(400, errText(e));
				}
			}
			// For all agents.
			if ((url.pathname === "/subscribe" || url.pathname === "/unsubscribe") && this.sources) {
				if (typeof body.source !== "string" || !body.source) throw new HttpError(400, "source required");
				try {
					if (url.pathname === "/unsubscribe") return send(200, { unsubscribed: await this.sources.unsubscribeAll(body.source) });
					const { source: _s, ...details } = body;
					return send(200, await this.sources.subscribeAll(body.source, details));
				} catch (e) {
					throw new HttpError(400, errText(e));
				}
			}
			// A conversation was closed in a UI: what it was subscribed to on its own ends with it.
			if (parts[0] === "agents" && parts[2] === "close" && parts.length === 3) {
				if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
				return send(200, { unsubscribed: (await this.sources?.closeSession(parts[1], String(body.session ?? ""))) ?? [] });
			}
			// The tabs a UI has open, kept so that it opens with the same ones next time.
			if (url.pathname === "/ui/tabs") return send(200, (this.manager.saveUiTabs(body.tabs, body.active, body.code, body.notify), { ok: true }));
			if (parts[0] === "agents" && parts[2] === "folder" && parts.length === 3) {
				if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
				try {
					return send(200, await this.manager.setFolder(parts[1], String(body.session ?? "main"), typeof body.folder === "string" && body.folder ? body.folder : null));
				} catch (e) {
					throw new HttpError(409, errText(e));
				}
			}
			// Groups of conversations: a conversation put into one or out of it, and a group made, renamed,
			// removed (with the conversations in it) or the list sorted. The owner's hand, like a pin.
			if (parts[0] === "agents" && (parts[2] === "group" || parts[2] === "groups") && parts.length === 3) {
				if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
				const m = this.manager;
				const id = parts[1];
				const text = (v: unknown, what: string) => {
					if (typeof v !== "string" || !v.trim()) throw new HttpError(400, what);
					return v;
				};
				try {
					if (parts[2] === "group") return send(200, m.setGroup(id, text(body.session, "session: the conversation's name"), typeof body.group === "string" ? body.group : null));
					if (body.action === "add") return send(200, m.addGroup(id, text(body.name, "name: the group's name")));
					if (body.action === "rename") return send(200, m.renameGroup(id, text(body.name, "name: the group's name"), text(body.to, "to: the group's new name")));
					if (body.action === "remove") return send(200, await m.removeGroup(id, text(body.name, "name: the group's name")));
					if (body.action === "order") return send(200, m.setGroupOrder(id, body.to));
				} catch (e) {
					throw e instanceof HttpError ? e : new HttpError(409, errText(e));
				}
				throw new HttpError(400, 'action: "add", "rename", "remove" or "order"');
			}
			if (parts[0] === "agents" && ["remove", "rename", "pin"].includes(parts[2]) && parts.length === 3) {
				if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
				if (typeof body.session !== "string" || !body.session) throw new HttpError(400, "session: the conversation's name");
				try {
					if (parts[2] === "pin") return send(200, { pinned: this.manager.pinSession(parts[1], body.session, body.pinned !== false) });
					if (parts[2] === "rename") return send(200, await this.manager.renameSession(parts[1], body.session, String(body.to ?? "")));
					return send(200, await this.manager.removeSession(parts[1], body.session));
				} catch (e) {
					throw new HttpError(409, errText(e));
				}
			}
			// A swarm. Like a goal it is the owner's to start, pause, resume and clear: no tool reaches it.
			if (parts[0] === "agents" && parts[2] === "swarm" && parts.length === 3) {
				if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
				const session = String(body.session ?? "main");
				const swarms = this.manager.swarms;
				try {
					if (body.action === "pause") return send(200, { swarm: swarms.pause(parts[1], session) });
					if (body.action === "resume") return send(200, { swarm: swarms.resume(parts[1], session) });
					if (body.action === "clear") return send(200, { cleared: swarms.clear(parts[1], session) });
					if (body.action !== undefined) throw new Error("action is pause, resume or clear; to start a swarm send objective");
					if (typeof body.objective !== "string") throw new Error("objective required: what is to be done");
					return send(200, { swarm: swarms.set(parts[1], session, body.objective) });
				} catch (e) {
					throw new HttpError(400, errText(e));
				}
			}
			// Goal mode. This is the only way to a goal, and it is the owner's, like the folder of a conversation: no tool reaches it.
			if (parts[0] === "agents" && parts[2] === "goal" && parts.length === 3) {
				if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
				const session = String(body.session ?? "main");
				const goals = this.manager.goals;
				try {
					if (body.action === "pause") return send(200, { goal: goals.pause(parts[1], session) });
					if (body.action === "resume") return send(200, { goal: goals.resume(parts[1], session) });
					if (body.action === "clear") return send(200, { cleared: goals.clear(parts[1], session) });
					if (body.action !== undefined) throw new Error("action is pause, resume or clear; to set a goal send objective");
					if (typeof body.objective !== "string") throw new Error("objective required: what should be reached");
					return send(200, { goal: goals.set(parts[1], session, body.objective) });
				} catch (e) {
					throw new HttpError(400, errText(e));
				}
			}
			// What the owner does in a conversation's browser, in a UI that shows it: clicks and keys, or an address.
			// Only here: no agent has a tool for it, and the browser's own server checks every piece.
			if (parts[0] === "agents" && parts[2] === "browser" && (parts[3] === "input" || parts[3] === "open") && parts.length === 4) {
				if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
				const session = String(body.session ?? "main");
				if (parts[3] === "input") return send(200, await this.manager.browserInput(parts[1], session, body.ops));
				if (typeof body.url !== "string" || !body.url.trim()) throw new HttpError(400, "url required");
				return send(200, await this.manager.browserOpen(parts[1], session, body.url));
			}
			// A UI that shows the browser itself says so, again and again while it runs: browser_show then opens no window.
			// The Pine app on this computer also says where its own browser is (`host`), which the agents' browsers become.
			if (url.pathname === "/browser/embedded") return this.manager.browserEmbedded(body.host), send(200, { ok: true });
			if (parts[0] === "agents" && parts[2] === "programs" && parts[3] === "stop" && parts.length === 4) {
				if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
				return send(200, { stopped: this.manager.stopProgram(parts[1], String(body.session ?? "main"), Number(body.id)) });
			}
			// The owner takes back their last message in a conversation, or brings it back. Only here: no agent has a tool for it.
			if (parts[0] === "agents" && (parts[2] === "undo" || parts[2] === "redo") && parts.length === 3) {
				if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
				try {
					return send(200, await this.manager[parts[2]](parts[1], String(body.session ?? "main")));
				} catch (e) {
					throw new HttpError(409, errText(e));
				}
			}
			// A new conversation that goes on from a message of the owner's. Only here, like undo: no agent has a tool for it.
			if (parts[0] === "agents" && parts[2] === "branch" && parts.length === 3) {
				if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
				if (body.at !== undefined && !Number.isInteger(body.at)) throw new HttpError(400, "at: the number of the message to branch after");
				try {
					return send(200, await this.manager.branchSession(parts[1], String(body.session ?? "main"), body.at as number | undefined, typeof body.to === "string" ? body.to : undefined, { worktree: body.worktree === true }));
				} catch (e) {
					throw new HttpError(409, errText(e));
				}
			}
			// A conversation's worktree (src/worktrees.ts): made, merged, brought up to date and discarded by the owner alone.
			if (parts[0] === "agents" && parts[2] === "worktree" && (parts.length === 3 || (parts.length === 4 && ["merge", "update", "remove"].includes(parts[3])))) {
				if (!this.cfg.agents[parts[1]]) throw new HttpError(404, "no such agent");
				if (typeof body.session !== "string" || !body.session) throw new HttpError(400, "session: the conversation's name");
				if (parts[3] === "merge" && body.how !== undefined && body.how !== "merge" && body.how !== "squash") throw new HttpError(400, 'how: "merge" (the default) or "squash"');
				try {
					if (parts.length === 3) return send(200, await this.manager.makeWorktree(parts[1], body.session, { name: typeof body.name === "string" ? body.name : undefined }));
					if (parts[3] === "merge") return send(200, await this.manager.mergeWorktree(parts[1], body.session, body.how === "squash" ? "squash" : "merge", typeof body.message === "string" ? body.message : undefined));
					if (parts[3] === "update") return send(200, await this.manager.updateWorktree(parts[1], body.session));
					return send(200, await this.manager.discardWorktree(parts[1], body.session, { keepBranch: body.keepBranch === true }));
				} catch (e) {
					const files = (e as { files?: unknown }).files;
					if (Array.isArray(files)) return send(409, { error: errText(e), conflicts: files });
					throw new HttpError(409, errText(e));
				}
			}
			// The owner's hand on a board: a task or a note of their own, and what becomes of a task.
			if ((parts[0] === "boards" && parts.length === 3) || (parts[0] === "agents" && parts[2] === "boards" && parts[3] === "post" && parts.length === 4)) {
				try {
					if (parts[0] === "agents") return send(200, this.manager.boardPost({ agent: parts[1], session: typeof body.session === "string" ? body.session : "main" }, body));
					if (parts[1] === "items") return send(200, this.manager.boardAct(Number(parts[2]), body.action, body.text));
					if (parts[2] === "post") return send(200, this.manager.boardPost({ board: Number(parts[1]) }, body));
					if (parts[2] === "remove") return send(200, this.manager.boardRemove(Number(parts[1])));
				} catch (e) {
					throw new HttpError(400, errText(e));
				}
			}
			if (parts[0] === "agents" && parts[2] === "reset" && parts.length === 3) return send(200, { reset: await this.manager.resetSession(parts[1], body.session) });
			if (parts[0] === "tasks" && parts[2] === "cancel" && parts.length === 3) return send(200, { cancelled: this.manager.cancel(Number(parts[1])) });
			if (parts[0] === "tasks" && parts[2] === "now" && parts.length === 3) return send(200, { sent: this.manager.sendNow(Number(parts[1])) });
			if (parts[0] === "approvals" && parts.length === 2) {
				const values = body.values && typeof body.values === "object" && !Array.isArray(body.values) ? (body.values as Record<string, string>) : undefined;
				const missing = body.allow === true ? this.approvals.missing(parts[1], values) : [];
				if (missing.length) throw new HttpError(400, `this request needs you to enter ${missing.join(", ")}: answer it in the terminal UI, where it is typed without being shown`);
				return send(200, { decided: this.approvals.decide(parts[1], body.allow === true, "api", body.always === true, values) });
			}
			if (url.pathname === "/state") {
				if (typeof body.key !== "string") throw new HttpError(400, "key required");
				this.state.set(body.key, body.value ?? null, { source: "api" });
				return send(200, { ok: true });
			}
			throw new HttpError(404, "not found");
		} catch (e) {
			if (e instanceof Refusal) return send(e.status, { error: e.message, ...e.more });
			const status = e instanceof HttpError ? e.status : /unknown agent|too many queued|does not accept|invalid topic|invalid state key|busy|is not defined in models.json|mode must be one of|at most 10 files|larger than 20 MB|inbox folder|can attach files|usable server name|MCP server needs|not a valid URL|must use https|reasoning level must be/.test(errText(e)) ? 400 : 500;
			if (status === 500) this.log.error("http request failed", e);
			send(status, { error: status === 500 ? "internal error" : errText(e) });
		}
	}

	/** DNS rebinding and cross-site requests: only accept a loopback (or configured) Host, never an Origin. */
	/** What the code pane says of a conversation's worktree beside its changes: its branch, and how far it is from its base. */
	private async worktreeLine(agent: string, session: string): Promise<{ branch: string; base: string; ahead: number; behind: number; dirty: number; merged: boolean } | undefined> {
		const w = await this.manager.worktreeStatus(agent, session).catch(() => undefined);
		return w && !w.gone ? { branch: w.branch, base: w.base, ahead: w.ahead, behind: w.behind, dirty: w.dirty, merged: w.merged } : undefined;
	}

	private guardBrowser(req: http.IncomingMessage): void {
		if (req.headers.origin || req.headers["sec-fetch-site"]) throw new HttpError(403, "requests from web pages are not accepted");
		const host = (req.headers.host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
		const allowed = ["127.0.0.1", "localhost", "::1", this.cfg.http!.host];
		if (!allowed.includes(host)) throw new HttpError(403, "unexpected Host header");
	}

	private async raw(req: http.IncomingMessage, limit = MAX_BODY): Promise<Buffer> {
		const chunks: Buffer[] = [];
		let size = 0;
		for await (const c of req) {
			size += c.length;
			if (size > limit) throw new HttpError(413, "body too large");
			chunks.push(c);
		}
		return Buffer.concat(chunks);
	}

	private async json(req: http.IncomingMessage, limit = MAX_BODY): Promise<unknown> {
		if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "content-type must be application/json");
		const buf = await this.raw(req, limit);
		try {
			return buf.length ? JSON.parse(buf.toString("utf8")) : {};
		} catch {
			throw new HttpError(400, "invalid JSON");
		}
	}

	/** A webhook: outside content by definition, so the event is untrusted whatever it says. */
	private async hook(name: string, req: http.IncomingMessage): Promise<{ id: number }> {
		const hook = this.cfg.http!.hooks[name];
		// A running event source of type webhook (or one of your own) takes requests under its name.
		const sourceHook = hook ? undefined : this.sources?.hookFor(name);
		if (!hook && !sourceHook) throw new HttpError(404, "not found");
		const now = Date.now();
		const recent = (this.hits.get(name) ?? []).filter((t) => now - t < 60_000);
		if (recent.length >= 120) throw new HttpError(429, "too many requests");
		recent.push(now);
		this.hits.set(name, recent);

		const body = await this.raw(req);
		if (sourceHook) {
			try {
				await sourceHook({ headers: req.headers, body });
			} catch (e) {
				throw new HttpError(typeof (e as any)?.status === "number" ? (e as any).status : 500, typeof (e as any)?.status === "number" ? errText(e) : "internal error");
			}
			return { id: 0 };
		}
		if (!hook) throw new HttpError(404, "not found");
		if (hook.secret) {
			const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
			const sig = String(req.headers["x-hub-signature-256"] ?? req.headers["x-signature"] ?? "").replace(/^sha256=/, "");
			const expected = crypto.createHmac("sha256", hook.secret).update(body).digest("hex");
			if (!(bearer && timingSafeEqual(bearer, hook.secret)) && !(sig && timingSafeEqual(sig, expected))) throw new HttpError(401, "bad signature");
		}
		let payload: unknown;
		try {
			payload = JSON.parse(body.toString("utf8"));
		} catch {
			payload = { text: body.toString("utf8") };
		}
		const e = this.bus.publish(hook.topic, payload, { source: "http", trust: "untrusted" });
		return { id: e.id };
	}

	private stream(req: http.IncomingMessage, res: http.ServerResponse, pattern: string): void {
		res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
		res.write(": connected\n\n");
		const off = this.bus.subscribe("#", (e) => {
			if (topicMatches(pattern, e.topic)) res.write(`data: ${JSON.stringify(e)}\n\n`);
		}, "http-stream");
		const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
		req.on("close", () => {
			off();
			clearInterval(ping);
		});
	}
}
