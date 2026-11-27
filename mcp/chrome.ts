// pine's host for the owner's own browser (Chrome, Brave, Edge and their relatives). Not an MCP
// server: the program that pine's extension (extension/) starts through the browser, by the name
// pine registered for it (native messaging, src/chrome.ts). Only that extension can start it and
// talk to it, over this process's stdin and stdout.
//
// It is to the owner's browser what desktop/electron/browser-host.ts is to the Pine app. pine's
// browser server (mcp/browser.ts) starts Playwright's server against this host instead of a
// Chromium of its own, and what Playwright talks to is a browser made of the tabs of one
// conversation's tab group: the tabs its agent opened there and the tabs the owner dragged in.
// Never another tab. The door is a WebSocket on the loopback that answers only who says the word,
// and the word is in a file in pine's data, where no agent reads.
//
// The owner's browser is the owner's: there is no guard proxy in it, and its logins are theirs.
// An agent gets here only in the owner's own conversations, when the owner asked for it.
import crypto from "node:crypto";
import fs from "node:fs";
import http, { type IncomingMessage } from "node:http";
import path from "node:path";
import { type WebSocket, WebSocketServer } from "ws";

/** The name the browser knows this host by. */
export const HOST_NAME = "dev.pmndre.pine";
/**
 * The extensions that may start this host: pine's own, by the key in extension/manifest.json.
 * The id a store gives the extension is added here when there is one.
 */
export const EXTENSION_IDS = ["ahhpalopnbbkjlchjjbclmbilcgdjgai"];
/** What host and extension have to agree on (extension/background.js). */
export const PROTOCOL = 1;
/** The browser takes no more than 1 MB from a host in one message: a longer one goes in pieces. */
const PIECE = 600_000;

/** What a session of a tab may not ask for: other targets and the browser. */
const NOT_IN_A_TAB = /^(Browser\.|Target\.(createTarget|attachToTarget|attachToBrowserTarget|getTargets|exposeDevToolsProtocol|createBrowserContext|disposeBrowserContext|getBrowserContexts|setRemoteLocations|autoAttachRelated|closeTarget|activateTarget)$)/;

/** Where a tab is sent when it is made: the web, and an empty page. */
const goes = (url: string) => /^(https?:|about:blank)/i.test(url);

interface Tab {
	/** The browser's own id of the page target, which Playwright takes for its main frame's id. */
	id: string;
	/** The extension's number for the tab. */
	tabId: number;
	/** The session Playwright knows this tab by. */
	session: string;
	title: string;
	url: string;
}

interface Room {
	key: string;
	tabs: Tab[];
	/** The sessions of frames and workers inside a tab, by the session the browser gave them. */
	inner: Map<string, Tab>;
	ws?: WebSocket;
	auto: boolean;
}

/** What a tab group is called: pine, and whose conversation it is. */
export function groupTitle(room: string): string {
	const at = room.indexOf(":");
	const [agent, session] = at < 0 ? [room, "main"] : [room.slice(0, at), room.slice(at + 1)];
	const name = (session && session !== "main" ? session : agent).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").slice(0, 28);
	return name ? `pine · ${name}` : "pine";
}

export interface ChromeHostOptions {
	/** The version of the extension that lies with this pine: an extension loaded from pine's folder loads it when it differs. */
	extension?: string;
	/** The extension said hello: the door is open. */
	onReady?: () => void;
}

export class ChromeHost {
	private readonly token = crypto.randomBytes(32).toString("hex");
	private readonly rooms = new Map<string, Room>();
	private readonly byTab = new Map<number, { room: Room; tab: Tab }>();
	private readonly asked = new Map<number, { resolve(value: any): void; reject(e: Error): void; timer?: NodeJS.Timeout }>();
	private server?: WebSocketServer;
	private web?: http.Server;
	private port = 0;
	private n = 0;
	private ids = 0;
	/** What the extension said of its browser. */
	browser = { name: "", agent: "", version: "" };

	private readonly toExtension: (message: unknown) => void;
	private readonly o: ChromeHostOptions;

	constructor(toExtension: (message: unknown) => void, o: ChromeHostOptions = {}) {
		this.toExtension = toExtension;
		this.o = o;
	}

	/** Where a browser server connects, with the word. */
	get url(): string | undefined {
		return this.port ? `ws://127.0.0.1:${this.port}/${this.token}` : undefined;
	}

	async start(): Promise<void> {
		if (this.server) return;
		// Beside the door for Playwright's server: one thing a browser server says itself (`bye`).
		const web = http.createServer((req, res) => void this.said(req).then((status) => res.writeHead(status).end()));
		this.web = web;
		const server = new WebSocketServer({ server: web, maxPayload: 64 * 1024 * 1024 });
		this.server = server;
		server.on("connection", (ws, req) => void this.connect(ws, req));
		await new Promise<void>((resolve, reject) => (web.once("listening", resolve), web.once("error", reject), web.listen(0, "127.0.0.1")));
		this.port = (web.address() as { port: number }).port;
	}

	/** Who says the word, and from no page: the conversation they name, or nothing. */
	private named(req: IncomingMessage): string[] | undefined {
		const [word, ...rest] = new URL(req.url ?? "/", "http://host").pathname.slice(1).split("/").map((p) => decodeURIComponent(p));
		const said = Buffer.from(word ?? "");
		const ok = said.length === this.token.length && crypto.timingSafeEqual(said, Buffer.from(this.token));
		// A page in some browser that found the port says where it comes from; the browser server does not.
		return ok && req.headers.origin === undefined && rest[0] && rest[0].length <= 300 ? rest : undefined;
	}

	/**
	 * `POST /<word>/<conversation>/bye`: the agent is done with its browser here (it closed it, or moved back to
	 * pine's own). The tabs pine opened for that conversation are closed; the owner's stay where they are.
	 */
	private async said(req: IncomingMessage): Promise<number> {
		const at = this.named(req);
		if (!at || req.method !== "POST" || at.length !== 2 || at[1] !== "bye") return 404;
		await this.ask({ do: "clear", room: at[0] }, 30_000).catch(() => {});
		return 204;
	}

	close(): void {
		for (const waiting of this.asked.values()) clearTimeout(waiting.timer), waiting.reject(new Error("the browser is gone"));
		this.asked.clear();
		for (const room of this.rooms.values()) room.ws?.close(1001, "the browser is gone");
		this.rooms.clear();
		this.byTab.clear();
		this.server?.close();
		this.web?.closeAllConnections();
		this.web?.close();
	}

	// ---- the extension -----------------------------------------------------------------------------

	/** Something for the extension to do. A command to a page waits as long as the page takes; the rest not for ever. */
	private ask(message: Record<string, unknown>, ms?: number): Promise<any> {
		return new Promise((resolve, reject) => {
			const id = ++this.ids;
			const timer = ms ? setTimeout(() => (this.asked.delete(id), reject(new Error("the browser did not answer"))), ms) : undefined;
			this.asked.set(id, { resolve, reject, timer });
			this.toExtension({ id, ...message });
		});
	}

	/** One message of the extension's. */
	fromExtension(m: any): void {
		if (!m || typeof m !== "object") return;
		if (typeof m.id === "number") {
			const waiting = this.asked.get(m.id);
			if (!waiting) return;
			this.asked.delete(m.id);
			clearTimeout(waiting.timer);
			return typeof m.error === "string" ? waiting.reject(new Error(m.error)) : waiting.resolve(m);
		}
		if (m.ev === "hello") {
			const agent = typeof m.agent === "string" ? m.agent.slice(0, 400) : "";
			this.browser = { name: typeof m.browser === "string" ? m.browser.replace(/[^\w .-]+/g, "").slice(0, 40) : "", agent, version: agent.match(/Chrome\/([\d.]+)/)?.[1] ?? "" };
			this.toExtension({ ev: "hello", protocol: PROTOCOL, ...(this.o.extension ? { extension: this.o.extension } : {}) });
			if (m.protocol === PROTOCOL) this.o.onReady?.();
			return;
		}
		if (!Number.isInteger(m.tabId)) return;
		if (m.ev === "gone") return this.forget(m.tabId);
		if (m.ev === "joined" && typeof m.room === "string") {
			const room = this.rooms.get(m.room);
			if (room?.ws) this.add(room, m.tabId, m.targetInfo);
			return;
		}
		if (m.ev !== "cdp" || typeof m.method !== "string") return;
		const at = this.byTab.get(m.tabId);
		if (!at) return;
		const { room, tab } = at;
		const inner = typeof m.sessionId === "string" && m.sessionId ? m.sessionId : undefined;
		if (m.method === "Target.attachedToTarget" && typeof m.params?.sessionId === "string") room.inner.set(m.params.sessionId, tab);
		if (m.method === "Target.detachedFromTarget" && typeof m.params?.sessionId === "string") room.inner.delete(m.params.sessionId);
		// Where the tab is now, for whoever asks which tabs there are.
		if (!inner && m.method === "Page.frameNavigated" && !m.params?.frame?.parentId && typeof m.params?.frame?.url === "string") tab.url = m.params.frame.url;
		this.send(room, { method: m.method, params: m.params, sessionId: inner ?? tab.session });
	}

	private add(room: Room, tabId: number, targetInfo: any): Tab | undefined {
		if (typeof targetInfo?.targetId !== "string" || this.byTab.has(tabId)) return undefined;
		const tab: Tab = { id: targetInfo.targetId, tabId, session: `pine-${++this.n}`, title: String(targetInfo.title ?? ""), url: String(targetInfo.url ?? "") };
		room.tabs.push(tab);
		this.byTab.set(tabId, { room, tab });
		if (room.auto) this.announce(room, tab);
		return tab;
	}

	/** A tab is no longer this conversation's: closed, dragged out of the group, or the owner said so on the browser's bar. */
	private forget(tabId: number): void {
		const at = this.byTab.get(tabId);
		if (!at) return;
		const { room, tab } = at;
		this.byTab.delete(tabId);
		const i = room.tabs.indexOf(tab);
		if (i >= 0) room.tabs.splice(i, 1);
		for (const [s, t] of room.inner) if (t === tab) room.inner.delete(s);
		this.send(room, { method: "Target.detachedFromTarget", params: { sessionId: tab.session, targetId: tab.id } });
		this.send(room, { method: "Target.targetDestroyed", params: { targetId: tab.id } });
	}

	// ---- one conversation's browser ----------------------------------------------------------------

	private async connect(ws: WebSocket, req: IncomingMessage): Promise<void> {
		const at = this.named(req);
		if (!at || at.length !== 1) return void ws.close(1008, "not for you");
		const key = at[0];
		const old = this.rooms.get(key);
		if (old) {
			old.ws?.close(1000, "another took its place");
			this.release(old);
		}
		const room: Room = { key, tabs: [], inner: new Map(), ws, auto: false };
		this.rooms.set(key, room);
		const early: Buffer[] = [];
		const keep = (data: Buffer) => void early.push(data);
		ws.on("message", keep);
		ws.on("close", () => {
			// The browser server let go (pine stopped, the conversation rests): the tabs stay where they are, and nobody is attached.
			if (this.rooms.get(key) !== room) return;
			this.release(room);
			this.rooms.delete(key);
			void this.ask({ do: "leave", room: key }, 30_000).catch(() => {});
		});
		try {
			// The tabs that are in this conversation's group already.
			const entered = await this.ask({ do: "enter", room: key, title: groupTitle(key) }, 30_000);
			for (const t of Array.isArray(entered.tabs) ? entered.tabs : []) if (Number.isInteger(t?.tabId)) this.add(room, t.tabId, t.targetInfo);
		} catch {
			return void ws.close(1011, "the browser did not answer");
		}
		ws.off("message", keep);
		ws.on("message", (data: Buffer) => void this.message(room, ws, data));
		for (const data of early) void this.message(room, ws, data);
	}

	/** Forgets a room's tabs here, without a word to Playwright (it is gone, or is told otherwise). */
	private release(room: Room): void {
		for (const tab of room.tabs) this.byTab.delete(tab.tabId);
		room.tabs = [];
		room.inner.clear();
	}

	private send(room: Room, message: unknown): void {
		if (room.ws?.readyState === 1) room.ws.send(JSON.stringify(message));
	}

	private info(tab: Tab) {
		return { targetId: tab.id, type: "page", title: tab.title, url: tab.url || "about:blank", attached: true, canAccessOpener: false, browserContextId: "pine" };
	}

	private announce(room: Room, tab: Tab): void {
		this.send(room, { method: "Target.attachedToTarget", params: { sessionId: tab.session, targetInfo: this.info(tab), waitingForDebugger: false } });
	}

	private async message(room: Room, ws: WebSocket, data: Buffer): Promise<void> {
		if (room.ws !== ws) return;
		let m: { id?: number; method?: string; params?: any; sessionId?: string };
		try {
			m = JSON.parse(String(data));
		} catch {
			return;
		}
		if (typeof m.id !== "number" || typeof m.method !== "string") return;
		const at = m.sessionId ? { sessionId: m.sessionId } : {};
		const reply = (result: unknown) => this.send(room, { id: m.id, result, ...at });
		const fail = (message: string) => this.send(room, { id: m.id, error: { code: -32000, message }, ...at });
		try {
			if (m.sessionId) {
				const own = room.tabs.find((t) => t.session === m.sessionId);
				const inner = own ? undefined : room.inner.get(m.sessionId);
				const tab = own ?? inner;
				if (!tab) return fail("No session with given id");
				if (NOT_IN_A_TAB.test(m.method)) return fail(`${m.method} is not available here`);
				return reply((await this.ask({ do: "cdp", tabId: tab.tabId, ...(inner ? { sessionId: m.sessionId } : {}), method: m.method, params: m.params ?? {} })).result ?? {});
			}
			switch (m.method) {
				case "Browser.getVersion":
					return reply({ protocolVersion: "1.3", product: `Chrome/${this.browser.version}`, revision: "", userAgent: this.browser.agent, jsVersion: "" });
				case "Target.setAutoAttach":
					room.auto = true;
					reply({});
					for (const tab of room.tabs) this.announce(room, tab);
					return;
				case "Target.setDiscoverTargets":
				case "Browser.setDownloadBehavior":
				case "Target.activateTarget":
				case "Browser.setWindowBounds":
					return reply({});
				case "Target.getBrowserContexts":
					return reply({ browserContextIds: [] });
				case "Target.getTargets":
					return reply({ targetInfos: room.tabs.map((t) => this.info(t)) });
				case "Target.getTargetInfo": {
					const tab = room.tabs.find((t) => t.id === m.params?.targetId);
					return reply({ targetInfo: tab ? this.info(tab) : { targetId: "browser", type: "browser", title: "", url: "", attached: true, canAccessOpener: false } });
				}
				case "Browser.getWindowForTarget":
					return reply({ windowId: 1, bounds: { left: 0, top: 0, width: 1280, height: 800, windowState: "normal" } });
				case "Target.createTarget": {
					const url = typeof m.params?.url === "string" && goes(m.params.url) ? m.params.url : "about:blank";
					const made = await this.ask({ do: "open", room: room.key, title: groupTitle(room.key), url }, 30_000);
					if (room.ws !== ws) return;
					const tab = this.add(room, made.tabId, made.targetInfo);
					return tab ? reply({ targetId: tab.id }) : fail("the browser opened no tab");
				}
				case "Target.closeTarget": {
					const tab = room.tabs.find((t) => t.id === m.params?.targetId);
					if (tab) {
						this.forget(tab.tabId);
						await this.ask({ do: "close", tabId: tab.tabId }, 30_000).catch(() => {});
					}
					return reply({ success: Boolean(tab) });
				}
				case "Browser.close":
					// The agent closed its browser: the tabs it opened go, the owner's stay in the group, and nobody is attached.
					reply({});
					for (const tab of [...room.tabs]) this.forget(tab.tabId);
					room.ws = undefined;
					this.rooms.delete(room.key);
					await this.ask({ do: "clear", room: room.key }, 30_000).catch(() => {});
					await this.ask({ do: "leave", room: room.key }, 30_000).catch(() => {});
					return;
			}
			fail(`${m.method} is not available here`);
		} catch (e) {
			fail(e instanceof Error ? e.message : String(e));
		}
	}
}

// ---- the browser's own way of talking to a host: a length, then that many bytes of JSON ---------------

/** Messages out of a stream of the browser's frames. */
export function frames(onMessage: (message: unknown) => void): (chunk: Buffer) => void {
	let have: Buffer = Buffer.alloc(0);
	return (chunk) => {
		have = have.length ? Buffer.concat([have, chunk]) : chunk;
		while (have.length >= 4) {
			const length = have.readUInt32LE(0);
			if (have.length < 4 + length) return;
			const body = have.subarray(4, 4 + length);
			have = have.subarray(4 + length);
			try {
				onMessage(JSON.parse(body.toString("utf8")));
			} catch {}
		}
	};
}

/** One message as the browser's frames: one, or pieces of it where it is longer than the browser takes. */
export function framed(message: unknown, piece = PIECE): Buffer[] {
	const one = (value: unknown) => {
		const body = Buffer.from(JSON.stringify(value), "utf8");
		const head = Buffer.alloc(4);
		head.writeUInt32LE(body.length, 0);
		return Buffer.concat([head, body]);
	};
	const whole = Buffer.from(JSON.stringify(message), "utf8");
	if (whole.length <= piece) return [one(message)];
	const id = crypto.randomBytes(8).toString("hex");
	// Cut where base64 cuts cleanly, so that the pieces join as text.
	const size = piece - (piece % 3);
	const n = Math.ceil(whole.length / size);
	return Array.from({ length: n }, (_, i) => one({ part: { id, i, n, data: whole.subarray(i * size, (i + 1) * size).toString("base64") } }));
}

/** The version of the extension that lies with this pine. */
export function extensionVersion(): string | undefined {
	try {
		const version = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "extension", "manifest.json"), "utf8")).version;
		return typeof version === "string" ? version : undefined;
	} catch {
		return undefined;
	}
}

if (import.meta.main) {
	// Started by the browser: `chrome.ts <file to say where the door is> chrome-extension://<id>/`.
	const [file, ...rest] = process.argv.slice(2);
	const origin = rest.find((a) => a.startsWith("chrome-extension://"))?.match(/^chrome-extension:\/\/([a-p]{32})\/?$/)?.[1];
	if (!file || !origin || !EXTENSION_IDS.includes(origin)) {
		process.stderr.write("pine: this program is started by pine's browser extension, not by hand.\n");
		process.exit(1);
	}
	let beat: NodeJS.Timeout | undefined;
	const say = () => {
		try {
			// Two browsers with the extension are two hosts. The one that was there first keeps the place while it
			// says so; the other stands by and takes it when the first is gone.
			try {
				const there = JSON.parse(fs.readFileSync(file, "utf8"));
				if (there.pid !== process.pid && Number(there.until) > Date.now()) return;
			} catch {}
			fs.mkdirSync(path.dirname(file), { recursive: true });
			// Whole or not at all: a browser server may be reading at this moment.
			fs.writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify({ url: host.url, until: Date.now() + 15_000, pid: process.pid, browser: host.browser.name, version: host.browser.version }), { mode: 0o600 });
			fs.renameSync(`${file}.${process.pid}.tmp`, file);
		} catch {}
	};
	const host = new ChromeHost((message) => void framed(message).forEach((frame) => process.stdout.write(frame)), {
		extension: extensionVersion(),
		onReady: () => {
			void host.start().then(() => {
				say();
				beat ??= setInterval(say, 5000);
			});
		},
	});
	const stop = () => {
		clearInterval(beat);
		try {
			// Only what this process wrote: another browser's host may have taken the place.
			if (JSON.parse(fs.readFileSync(file, "utf8")).pid === process.pid) fs.rmSync(file, { force: true });
		} catch {}
		host.close();
		process.exit(0);
	};
	process.stdin.on("data", frames((message) => host.fromExtension(message)));
	// The browser closed the pipe: the extension is gone, or the browser is.
	process.stdin.on("end", stop);
	process.stdin.on("error", stop);
	process.on("SIGTERM", stop);
	process.on("SIGINT", stop);
}
