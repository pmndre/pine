// The agent's browser in the app's own window. A conversation's browser is a set of tabs, each a
// WebContentsView: a page of the web in a renderer of its own, sandboxed, with no preload and no
// way to the app's page or to the main process. The panel beside the conversation shows the tab in
// front where the page says the panel is (show); the others are in no window and go on working.
//
// The agent drives these tabs as it drives any browser: pine's browser server (mcp/browser.ts)
// starts Playwright's server against this host instead of a Chromium of its own. What Playwright
// talks to is a browser made of the tabs' own debuggers (webContents.debugger), one per tab, behind
// a WebSocket on the loopback that answers only who says the word (`url` holds it). It reaches the
// tabs of the conversation the connection names and nothing else: never the app's own page, where
// the owner answers pine's questions. That is why this is not Chromium's remote debugging port,
// which would hand out every page of the app to whatever on this computer asked.
//
// Everything a tab loads goes through the guard proxy of the browser server that connected (its
// port comes with the connection), loopback included, and what goes around a proxy is switched off
// (BROWSER_SWITCHES, the WebRTC policy of each tab), as for the browser pine starts itself.
import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import { session as sessions, type BrowserWindow, type Session, WebContentsView } from "electron";
import { type WebSocket, WebSocketServer } from "ws";

/**
 * Chromium's switches for what goes around a proxy (mcp/browser.ts NO_WAY_AROUND), for the whole
 * app: its own page loads nothing from the web, and its main process talks through Node, not Chromium.
 * The loopback and localhost are left to resolve: the guard listens on one, a development page on the other.
 */
export const BROWSER_SWITCHES: Array<[string, string?]> = [
	["disable-quic"],
	["enforce-webrtc-ip-permission-check"],
	["host-resolver-rules", "MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE localhost"],
	["dns-prefetch-disable"],
	["no-pings"],
];

/** Where a tab may go by itself (a link, a redirect, a script): the web, and an empty page. */
const goes = (url: string) => /^(https?:|about:blank|about:srcdoc)/i.test(url);

/** What a session of a tab may not ask for: other targets and the browser. Chromium refuses most of it there already. */
const NOT_IN_A_TAB = /^(Browser\.|Target\.(createTarget|attachToTarget|attachToBrowserTarget|getTargets|exposeDevToolsProtocol|createBrowserContext|disposeBrowserContext|getBrowserContexts|setRemoteLocations|autoAttachRelated|closeTarget|activateTarget)$)/;

interface Tab {
	/** Chromium's own id of the page target, which Playwright takes for its main frame's id. */
	id: string;
	view: WebContentsView;
	/** The session Playwright knows this tab by. */
	session: string;
}

interface Room {
	key: string;
	tabs: Tab[];
	/** The sessions of frames and workers inside a tab, by the session Chromium gave them. */
	inner: Map<string, Tab>;
	ws?: WebSocket;
	auto: boolean;
	ses: Session;
}

export interface Bounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface BrowserHostOptions {
	/** Called when a window's currently attached WebContentsView is claimed by another window. */
	onPreempted?: (win: BrowserWindow) => void;
	/** Whether `win` is the window in front, by the app's own record of focus events (the system's focus is not settled under a virtual screen, nor for a window never shown). */
	inFront?: (win: BrowserWindow) => boolean;
}

export class BrowserHost {
	private readonly token = crypto.randomBytes(32).toString("hex");
	private readonly rooms = new Map<string, Room>();
	private server?: WebSocketServer;
	private port = 0;
	private readonly shownByWindow = new Map<BrowserWindow, { view: WebContentsView; key: string }>();
	/** The last place the panel had: a tab that is made while nothing is shown is laid out for it. */
	private room: Bounds = { x: 0, y: 0, width: 560, height: 800 };
	private n = 0;

	private readonly onPreempted?: (win: BrowserWindow) => void;
	private readonly inFront: (win: BrowserWindow) => boolean;

	constructor(options?: BrowserHostOptions) {
		this.onPreempted = options?.onPreempted;
		this.inFront = options?.inFront ?? ((win) => win.isFocused());
	}

	/** Where a browser server connects, with the word: for the daemon alone, which hands it to its browser servers. */
	get url(): string | undefined {
		return this.port ? `ws://127.0.0.1:${this.port}/${this.token}` : undefined;
	}

	async start(): Promise<void> {
		if (this.server) return;
		const server = new WebSocketServer({ host: "127.0.0.1", port: 0, maxPayload: 64 * 1024 * 1024 });
		this.server = server;
		server.on("connection", (ws, req) => this.connect(ws, req));
		await new Promise<void>((resolve, reject) => (server.once("listening", resolve), server.once("error", reject)));
		this.port = (server.address() as { port: number }).port;
	}

	/** Whether a conversation's browser is here, with a page: the panel shows it instead of pictures. */
	has(key: string): boolean {
		return (this.rooms.get(key)?.tabs.length ?? 0) > 0;
	}

	private detachView(win: BrowserWindow, view: WebContentsView): void {
		if (!win.isDestroyed()) {
			try {
				win.contentView.removeChildView(view);
			} catch {}
		}
	}

	/** Detaches any WebContentsView currently attached to `win` (e.g. on window close or switching away from local). */
	detach(win: BrowserWindow | undefined): void {
		if (!win) return;
		const current = this.shownByWindow.get(win);
		if (!current) return;
		this.detachView(win, current.view);
		this.shownByWindow.delete(win);
	}

	/**
	 * The page in `win` says where the panel is and which tab is in front (the browser server's order, which
	 * is the order the tabs were made in). Nothing: the panel is closed, covered or shows something else.
	 */
	show(win: BrowserWindow | undefined, key: string | undefined, index: number, bounds: Bounds | undefined): boolean {
		const tab = key !== undefined && bounds ? this.rooms.get(key)?.tabs[index] : undefined;
		const current = win ? this.shownByWindow.get(win) : undefined;
		if (current && (current.view !== tab?.view || !win || win.isDestroyed())) {
			this.detachView(win!, current.view);
			this.shownByWindow.delete(win!);
		}
		if (!tab || !win || win.isDestroyed() || !bounds) return false;
		// A WebContentsView can only belong to one BrowserWindow at a time.
		for (const [ownerWin, entry] of [...this.shownByWindow]) {
			if (ownerWin === win || entry.view !== tab.view) continue;
			if (ownerWin.isDestroyed()) {
				this.shownByWindow.delete(ownerWin);
				continue;
			}
			// If the current owner is in front and the requester is not, keep it there so the requester falls back to canvas.
			if (this.inFront(ownerWin) && !this.inFront(win)) return false;
			this.detachView(ownerWin, tab.view);
			this.shownByWindow.delete(ownerWin);
			this.onPreempted?.(ownerWin);
		}
		this.room = bounds;
		if (!this.shownByWindow.has(win)) win.contentView.addChildView(tab.view);
		this.shownByWindow.set(win, { view: tab.view, key: key! });
		tab.view.setBounds(bounds);
		return true;
	}

	/** The tab in front in `win` as a still picture (a data: address of a JPEG), for while the app's own menus lie over its place. */
	async picture(win: BrowserWindow | undefined): Promise<string | undefined> {
		const wc = win ? this.shownByWindow.get(win)?.view.webContents : undefined;
		if (!wc || wc.isDestroyed()) return undefined;
		const image = await wc.capturePage().catch(() => undefined);
		return image && !image.isEmpty() ? `data:image/jpeg;base64,${image.toJPEG(85).toString("base64")}` : undefined;
	}

	/** Puts the keys into the tab in front in `win`, after a click on the panel's own frame around it. */
	focus(win: BrowserWindow | undefined): void {
		const wc = win ? this.shownByWindow.get(win)?.view.webContents : undefined;
		if (wc && !wc.isDestroyed()) wc.focus();
	}

	close(): void {
		for (const room of this.rooms.values()) this.drop(room);
		this.shownByWindow.clear();
		this.server?.close();
	}

	// ---- one conversation's browser --------------------------------------------------------------

	private async connect(ws: WebSocket, req: IncomingMessage): Promise<void> {
		const url = new URL(req.url ?? "/", "http://host");
		const [word, key] = url.pathname.slice(1).split("/").map((p) => decodeURIComponent(p));
		const proxy = Number(url.searchParams.get("proxy"));
		const said = Buffer.from(word ?? "");
		const ok = said.length === this.token.length && crypto.timingSafeEqual(said, Buffer.from(this.token));
		// A page in some browser that found the port says where it comes from; the browser server does not.
		if (!ok || req.headers.origin !== undefined || !key || key.length > 300 || !Number.isInteger(proxy) || proxy < 1 || proxy > 65535) return void ws.close(1008, "not for you");
		let room = this.rooms.get(key);
		if (room?.ws) room.ws.close(1000, "another took its place");
		if (!room) {
			const ses = sessions.fromPartition(`pine-browser-${crypto.createHash("sha256").update(key).digest("hex").slice(0, 24)}`, { cache: true });
			room = { key, tabs: [], inner: new Map(), auto: false, ses };
			this.rooms.set(key, room);
			harden(ses);
		}
		room.ws = ws;
		room.auto = false;
		const messages: Buffer[] = [];
		const early = (data: Buffer) => void messages.push(data);
		ws.on("message", early);
		// Nothing is loaded before the guard is in place.
		await room.ses.setProxy({ mode: "fixed_servers", proxyRules: `http://127.0.0.1:${proxy}`, proxyBypassRules: "<-loopback>" });
		const r = room;
		ws.off("message", early);
		ws.on("message", (data: Buffer) => void this.message(r, ws, data));
		ws.on("close", () => {
			// The browser server let go (the agent closed the browser, pine stopped): its tabs end with it.
			if (r.ws === ws) this.drop(r);
		});
		for (const data of messages) void this.message(r, ws, data);
	}

	/** A room's tabs end, and with them what the panel shows of it. */
	private drop(room: Room): void {
		for (const tab of [...room.tabs]) this.closeTab(room, tab);
		room.ws = undefined;
		this.rooms.delete(room.key);
	}

	private send(room: Room, message: unknown): void {
		if (room.ws?.readyState === 1) room.ws.send(JSON.stringify(message));
	}

	private info(tab: Tab) {
		const wc = tab.view.webContents;
		return { targetId: tab.id, type: "page", title: wc.isDestroyed() ? "" : wc.getTitle(), url: wc.isDestroyed() ? "" : wc.getURL() || "about:blank", attached: true, canAccessOpener: false, browserContextId: "pine" };
	}

	private announce(room: Room, tab: Tab): void {
		this.send(room, { method: "Target.attachedToTarget", params: { sessionId: tab.session, targetInfo: this.info(tab), waitingForDebugger: false } });
	}

	private async openTab(room: Room, url?: string): Promise<Tab> {
		const view = new WebContentsView({
			webPreferences: { session: room.ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, navigateOnDragDrop: false, spellcheck: false, backgroundThrottling: false, safeDialogs: true },
		});
		view.setBackgroundColor("#ffffff");
		view.setBounds(this.room);
		const wc = view.webContents;
		wc.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
		// A link that opens a window opens a tab of this browser, where the agent finds it.
		wc.setWindowOpenHandler(({ url: to }) => {
			if (goes(to)) void this.openTab(room, to).catch(() => {});
			return { action: "deny" };
		});
		const stay = (e: { url: string; preventDefault(): void }) => void (goes(e.url) || e.preventDefault());
		wc.on("will-navigate", stay);
		wc.on("will-redirect", stay);
		wc.on("devtools-opened", () => wc.closeDevTools());
		// A tab without a page has no renderer, and its debugger answers nothing until it has one.
		await wc.loadURL("about:blank");
		wc.debugger.attach("1.3");
		const id = (await wc.debugger.sendCommand("Target.getTargetInfo")).targetInfo.targetId as string;
		const tab: Tab = { id, view, session: `pine-${++this.n}` };
		room.tabs.push(tab);
		wc.debugger.on("message", (_e, method: string, params: any, sessionId?: string) => {
			if (method === "Target.attachedToTarget" && params?.sessionId) room.inner.set(params.sessionId, tab);
			if (method === "Target.detachedFromTarget" && params?.sessionId) room.inner.delete(params.sessionId);
			this.send(room, { method, params, sessionId: sessionId || tab.session });
		});
		// The page closed itself (window.close()), or its renderer is gone for good.
		wc.once("destroyed", () => this.forget(room, tab));
		if (room.auto) this.announce(room, tab);
		if (url && url !== "about:blank") void wc.loadURL(url).catch(() => {});
		return tab;
	}

	private forget(room: Room, tab: Tab): void {
		const at = room.tabs.indexOf(tab);
		if (at < 0) return;
		room.tabs.splice(at, 1);
		for (const [s, t] of room.inner) if (t === tab) room.inner.delete(s);
		for (const [win, entry] of [...this.shownByWindow]) {
			if (entry.view === tab.view) {
				this.detachView(win, tab.view);
				this.shownByWindow.delete(win);
			}
		}
		this.send(room, { method: "Target.detachedFromTarget", params: { sessionId: tab.session, targetId: tab.id } });
		this.send(room, { method: "Target.targetDestroyed", params: { targetId: tab.id } });
	}

	private closeTab(room: Room, tab: Tab): void {
		this.forget(room, tab);
		const wc = tab.view.webContents;
		if (!wc.isDestroyed()) {
			try {
				wc.debugger.detach();
			} catch {}
			wc.close();
		}
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
				if (!tab || tab.view.webContents.isDestroyed()) return fail("No session with given id");
				if (NOT_IN_A_TAB.test(m.method)) return fail(`${m.method} is not available here`);
				return reply(await tab.view.webContents.debugger.sendCommand(m.method, m.params ?? {}, inner ? m.sessionId : undefined));
			}
			switch (m.method) {
				case "Browser.getVersion":
					return reply({ protocolVersion: "1.3", product: `Chrome/${process.versions.chrome}`, revision: "", userAgent: chromeAgent(), jsVersion: process.versions.v8 });
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
					return reply({ windowId: 1, bounds: { left: 0, top: 0, width: this.room.width, height: this.room.height, windowState: "normal" } });
				case "Target.createTarget": {
					const url = typeof m.params?.url === "string" && goes(m.params.url) ? m.params.url : "about:blank";
					return reply({ targetId: (await this.openTab(room, url)).id });
				}
				case "Target.closeTarget": {
					const tab = room.tabs.find((t) => t.id === m.params?.targetId);
					if (tab) this.closeTab(room, tab);
					return reply({ success: Boolean(tab) });
				}
				case "Browser.close":
					reply({});
					return this.drop(room);
			}
			fail(`${m.method} is not available here`);
		} catch (e) {
			fail(e instanceof Error ? e.message : String(e));
		}
	}
}

/** The user agent of the Chrome this Electron is built on: what a page sees is a browser, not an app. */
function chromeAgent(): string {
	const os = process.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7" : process.platform === "win32" ? "Windows NT 10.0; Win64; x64" : "X11; Linux x86_64";
	return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split(".")[0]}.0.0.0 Safari/537.36`;
}

/** What a session of the agent's browser may do: ask for nothing, keep nothing it downloads by itself. */
function harden(ses: Session): void {
	ses.setUserAgent(chromeAgent());
	ses.setPermissionRequestHandler((_wc, _permission, answer) => answer(false));
	ses.setPermissionCheckHandler(() => false);
	ses.setDevicePermissionHandler(() => false);
	ses.setDisplayMediaRequestHandler((_req, answer) => answer({}));
	// A download a page starts would ask where to save it with a dialog of the system's: it is not kept.
	ses.on("will-download", (_e, item) => item.cancel());
}
