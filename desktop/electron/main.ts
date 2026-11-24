// The app's main process. It owns three things the page must not: the daemon's token, the
// operating system (windows, menus, dialogs, notifications), and the child that is the daemon
// when this app had to start one. The page gets a narrow bridge (preload.ts) and nothing else.
import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions, nativeTheme, Notification, protocol, screen, session, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildVoice, Listening, NOT_HERE } from "../../src/tui/voice.ts";
import { type Command, install, look, remove, said } from "./command.ts";
import { callDaemon, followEvents, mediaFromDaemon, pageCsp } from "./daemon.ts";
import type { DraftAttachment, NewWindowOptions, WindowLayout } from "./preload.ts";
import { connect, connectSsh, findPine, type Launch, loginEnv, pineRoot, readHosts, runPine, type Service, ServiceError, sshHost } from "./service.ts";
import { Terminals } from "./terminal.ts";
import { LATEST, lookForUpdate, type Update } from "./updates.ts";
import { cleanLook, type Look } from "../src/theme.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "..");
const DEV_URL = process.env.PINE_DESKTOP_DEV_URL || undefined;
/** Scheme and host of an address. (Node's own `origin` says "null" for a scheme of the app's own.) */
const originOf = (url: string) => {
	try {
		const u = new URL(url);
		return `${u.protocol}//${u.host}`;
	} catch {
		return "";
	}
};
const ORIGIN = DEV_URL ? originOf(DEV_URL) : "app://pine";
const isMac = process.platform === "darwin";
/** Tests only: the window opens behind the owner's windows and the app never takes the focus or a place in the Dock. */
const BACKGROUND = Boolean(process.env.PINE_DESKTOP_BACKGROUND);
if (BACKGROUND && isMac) app.setActivationPolicy("accessory");

// A second set of windows and data for tests and for trying things out beside the real app.
if (process.env.PINE_DESKTOP_DATA) app.setPath("userData", path.resolve(process.env.PINE_DESKTOP_DATA));
app.setName("Pine");

protocol.registerSchemesAsPrivileged([
	{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
	{ scheme: "pine-media", privileges: { standard: true, secure: true, stream: true, bypassCSP: false } },
]);

// ---- preferences of the app itself (not pine's settings: those are the daemon's) -----------------

interface Bounds {
	x?: number;
	y?: number;
	width: number;
	height: number;
}

interface TabRef {
	agent: string;
	session: string;
}

interface DraftTransfer {
	text: string;
	attachments: DraftAttachment[];
}

interface WindowSnapshot extends WindowLayout {
	bounds?: Bounds;
}

interface Prefs {
	/** Another pine home than ~/.pine. */
	home?: string;
	/** A daemon this app started goes on when the app quits. */
	keepRunning: boolean;
	/** Other machines whose pine the app can use, each a host for ssh (Settings > Environments). */
	hosts: string[];
	/** The last-used machine (fallback when reopening from zero windows); none: this computer. */
	use?: string;
	notify: boolean;
	/** Whether GitHub is asked for a newer app when this one starts. */
	updates: boolean;
	/** `pine` for a terminal was looked after once (see firstCommand): a link the owner removed stays removed. */
	commandTried: boolean;
	/**
	 * The theme the page was last drawn in, as pine resolved it and cleanLook made it safe: the window
	 * opens in it, and its frame (light or dark) and background follow it. None: pmndre.
	 */
	look?: Look;
	/** While a coloured agent's conversation is in front, the window's accent is its colour. */
	agentAccent: boolean;
	bounds?: Bounds;
	/** Open windows preserved across quit/relaunch. Empty when all windows were closed individually before quit. */
	windows?: WindowSnapshot[];
}

const prefsFile = () => path.join(app.getPath("userData"), "prefs.json");
let prefs: Prefs = { keepRunning: false, hosts: [], notify: true, updates: true, commandTried: false, agentAccent: true };

function cleanBounds(raw: unknown): Bounds | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const b = raw as Record<string, unknown>;
	const width = Number(b.width);
	const height = Number(b.height);
	if (!(width > 300 && height > 200)) return undefined;
	const x = b.x !== undefined && Number.isFinite(Number(b.x)) ? Math.round(Number(b.x)) : undefined;
	const y = b.y !== undefined && Number.isFinite(Number(b.y)) ? Math.round(Number(b.y)) : undefined;
	return { x, y, width: Math.round(width), height: Math.round(height) };
}

function cleanTabs(raw: unknown): TabRef[] {
	if (!Array.isArray(raw)) return [];
	const out: TabRef[] = [];
	for (const t of raw) {
		if (t && typeof t === "object" && typeof (t as any).agent === "string" && typeof (t as any).session === "string") {
			out.push({ agent: (t as any).agent, session: (t as any).session });
		}
	}
	return out;
}

function cleanPositive(v: unknown): number | undefined {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

function cleanWindowSnapshot(raw: unknown, hosts: string[]): WindowSnapshot | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const w = raw as Record<string, unknown>;
	const host = typeof w.host === "string" && hosts.includes(w.host) ? w.host : undefined;
	return {
		host,
		tabs: cleanTabs(w.tabs),
		active: Math.max(0, Math.floor(Number(w.active) || 0)),
		code: w.code === true,
		noTab: w.noTab === true,
		sidebar: w.sidebar !== false,
		sidebarWidth: cleanPositive(w.sidebarWidth),
		codeWidth: cleanPositive(w.codeWidth),
		aside: w.aside === true,
		asideWidth: cleanPositive(w.asideWidth),
		folded: Array.isArray(w.folded) ? w.folded.filter((f): f is string => typeof f === "string") : [],
		bounds: cleanBounds(w.bounds),
	};
}

function loadPrefs(): void {
	try {
		const raw = JSON.parse(fs.readFileSync(prefsFile(), "utf8"));
		const hosts = readHosts(raw.hosts);
		prefs = {
			home: typeof raw.home === "string" && raw.home ? raw.home : undefined,
			keepRunning: raw.keepRunning === true,
			hosts,
			use: undefined,
			notify: raw.notify !== false,
			updates: raw.updates !== false,
			commandTried: raw.commandTried === true,
			look: cleanLook(raw.look),
			// Off when the owner turned it off, or unticked the primary when the window took role families from the agent.
			agentAccent: raw.agentAccent === false ? false : raw.agentAccent === true || !(Array.isArray(raw.agentFamilies) && !raw.agentFamilies.includes("primary")),
			bounds: cleanBounds(raw.bounds),
			windows: Array.isArray(raw.windows) ? raw.windows.map((w: unknown) => cleanWindowSnapshot(w, hosts)).filter((w: WindowSnapshot | undefined): w is WindowSnapshot => Boolean(w)) : undefined,
		};
		// Only a machine that is in the list: what else might be written there is not connected to.
		if (typeof raw.use === "string" && prefs.hosts.includes(raw.use)) prefs.use = raw.use;
	} catch {
		// first start
	}
	nativeTheme.themeSource = prefs.look?.kind ?? "dark";
}

function publicPrefs() {
	return { ...prefs, bounds: undefined, windows: undefined };
}

/**
 * What the window shows before the page draws: the page colour of the theme it was last drawn in
 * (pmndre's before there was one). On a Mac the window is transparent, behind its vibrancy.
 */
function windowBackground(look?: Look): string {
	if (isMac) return "#00000000";
	return ((look ?? prefs.look)?.colors.bg ?? "#1b1e28").slice(0, 7);
}

function refreshBackground(mw: ManagedWindow): void {
	if (!mw.win.isDestroyed()) mw.win.setBackgroundColor(windowBackground(mw.look));
}

function savePrefs(): void {
	try {
		fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
		fs.writeFileSync(prefsFile(), `${JSON.stringify(prefs, null, 2)}\n`);
	} catch {
		// a preference that is not kept is not worth an error
	}
}

// ---- per-window registry & shared daemon pool --------------------------------------------------

type ServiceState =
	| { status: "starting"; host?: string }
	| { status: "ready"; mode: string; started: boolean; home: string; version?: string; from: string; host?: string; label?: string }
	| { status: "error"; kind: ServiceError["kind"]; message: string; host?: string };

interface ManagedWindow {
	id: number;
	win: BrowserWindow;
	mediaBase: string;
	ready: boolean;
	focusedAt: number;
	host?: string;
	service?: Service;
	state: ServiceState;
	round: number;
	look?: Look;
	bounds?: Bounds;
	layout?: WindowLayout;
	/** One-shot startup directives consumed by the page on boot. */
	noTab: boolean;
	initialTab?: TabRef;
	initialDraft?: DraftTransfer;
	pendingFolders: string[];
	/** Open approval IDs reported by this window, for cross-window badge deduplication. */
	approvalIds: Set<string>;
	badgeCount: number;
}

interface EnvStream {
	key: string;
	service: Service;
	controller: AbortController;
	connected: boolean;
	/** Maps top-level task IDs to their conversation for routing `approval/requested`. */
	rootToConv: Map<number, TabRef>;
}

const windowsById = new Map<number, ManagedWindow>();
const windowsByWc = new Map<Electron.WebContents, ManagedWindow>();
let nextWindowId = 1;
let focusClock = 1;

/**
 * The pines this app holds: this computer's ("") and each machine's it used, by host. Closing a
 * window lets go of none, so that an agent at work in one goes on while another is shown. They are
 * let go of when the app quits, when a host is forgotten, or when local home changes.
 */
const held = new Map<string, Service>();
/** Deduplicates concurrent connection attempts for the same environment key. */
const connecting = new Map<string, Promise<Service>>();
/** One shared SSE subscriber per active environment key. */
const streams = new Map<string, EnvStream>();
let launch: Launch | undefined;
let quitting = false;
let listening: Listening | undefined;
let voiceWindow: ManagedWindow | undefined;
/** Recent desktop notifications for cross-window deduplication (`key -> timestamp`). */
const recentNotices = new Map<string, number>();

const envKeyOf = (host?: string) => host ?? "";

function sendTo(mw: ManagedWindow | undefined, channel: string, ...args: unknown[]): void {
	if (mw && !mw.win.isDestroyed()) mw.win.webContents.send(channel, ...args);
}

function allWindows(): ManagedWindow[] {
	return [...windowsById.values()].filter((w) => !w.win.isDestroyed());
}

function windowsOnEnv(key: string): ManagedWindow[] {
	return allWindows().filter((w) => envKeyOf(w.host) === key);
}

function targetWindow(candidates?: ManagedWindow[]): ManagedWindow | undefined {
	const list = candidates ?? allWindows();
	if (!list.length) return undefined;
	const focused = list.find((w) => w.win.isFocused());
	if (focused) return focused;
	return [...list].sort((a, b) => b.focusedAt - a.focusedAt)[0];
}

function openHostsFor(mw: ManagedWindow): string[] {
	const set = new Set<string>();
	for (const w of allWindows()) {
		if (w !== mw && w.host !== undefined) set.add(w.host);
	}
	return [...set];
}

function broadcastOpenHosts(): void {
	for (const mw of allWindows()) sendTo(mw, "pine:open-hosts", openHostsFor(mw));
}

function broadcastPrefs(): void {
	const p = publicPrefs();
	for (const mw of allWindows()) sendTo(mw, "pine:prefs-updated", p);
}

function refreshBadge(): void {
	const unique = new Set<string>();
	let fallback = 0;
	for (const mw of allWindows()) {
		if (mw.approvalIds.size > 0) {
			const key = envKeyOf(mw.host);
			for (const id of mw.approvalIds) unique.add(`${key}:${id}`);
		} else if (mw.badgeCount > 0) {
			fallback += mw.badgeCount;
		}
	}
	const total = unique.size + fallback;
	if (isMac) app.dock?.setBadge(total > 0 ? String(total) : "");
	else app.setBadgeCount(Math.max(0, total));
}

function snapshotOf(mw: ManagedWindow): WindowSnapshot {
	const l = mw.layout;
	return {
		host: mw.host,
		tabs: l?.tabs ?? [],
		active: l?.active ?? 0,
		code: l?.code ?? false,
		noTab: l?.noTab ?? mw.noTab,
		sidebar: l?.sidebar ?? true,
		sidebarWidth: l?.sidebarWidth,
		codeWidth: l?.codeWidth,
		aside: l?.aside ?? false,
		asideWidth: l?.asideWidth,
		folded: l?.folded ?? [],
		bounds: mw.bounds,
	};
}

function syncOpenWindowsPrefs(): void {
	if (quitting) return;
	// Order ascending by focus time so the last-focused window is restored last (on top).
	const open = allWindows().sort((a, b) => a.focusedAt - b.focusedAt);
	prefs.windows = open.map(snapshotOf);
	const top = open.at(-1);
	if (top) {
		prefs.use = top.host;
		if (top.bounds) prefs.bounds = top.bounds;
	}
}

/** The owner's terminal of each conversation (terminal.ts): their own shell, which ends with the app. */
const terminals = new Terminals(
	{
		data: (windowId, id, data) => sendTo(windowsById.get(windowId), "pine:term-data", id, data),
		exit: (windowId, id, code) => sendTo(windowsById.get(windowId), "pine:term-exit", id, code),
		run: (windowId, id, report) => sendTo(windowsById.get(windowId), "pine:term-run", id, report),
	},
	{ env: loginEnv, hooks: path.join(app.getPath("userData"), "shell-hooks"), shell: process.env.PINE_DESKTOP_SHELL ? [process.env.PINE_DESKTOP_SHELL] : undefined, stillRunningMs: Number(process.env.PINE_DESKTOP_STILL_RUNNING_MS) || undefined },
);

/** Whether a pine still answers: one on another machine may have lost its connection meanwhile. */
const answers = (s: Service) => fetch(`${s.base}/health`, { signal: AbortSignal.timeout(2500) }).then((r) => r.ok, () => false);

/** Lets go of a pine: the SSH connection to another machine ends (and a pine it started there); one this app started here stops, unless it is to go on. */
async function letGo(s: Service | undefined): Promise<void> {
	if (s?.host || (s?.started && !prefs.keepRunning)) await s.stop();
}

async function acquireService(host: string | undefined): Promise<Service> {
	const key = envKeyOf(host);
	const existing = held.get(key);
	if (existing) {
		if (await answers(existing)) return existing;
		if (held.get(key) === existing) held.delete(key);
		void letGo(existing);
	}
	const inflight = connecting.get(key);
	if (inflight) return inflight;
	const p = (async () => {
		const made = host ? await connectSsh(host, await loginEnv()) : await connect((launch = await findPine(APP_ROOT, app.isPackaged ? process.resourcesPath : undefined)), { home: prefs.home ?? process.env.PINE_HOME, keep: prefs.keepRunning });
		const first = held.get(key);
		if (first) {
			void letGo(made);
			return first;
		}
		held.set(key, made);
		return made;
	})();
	connecting.set(key, p);
	try {
		return await p;
	} finally {
		if (connecting.get(key) === p) connecting.delete(key);
	}
}

function setWindowState(mw: ManagedWindow, next: ServiceState): void {
	mw.state = next;
	sendTo(mw, "pine:service", next);
}

function pruneStreams(): void {
	for (const [key, es] of [...streams]) {
		const active = windowsOnEnv(key).some((w) => w.service === es.service);
		if (!active) {
			es.controller.abort();
			streams.delete(key);
		}
	}
}

/** Ensures one shared SSE subscriber for `s`, fanning events and connection status out to all bound windows. */
function ensureStream(s: Service): EnvStream {
	const key = envKeyOf(s.host);
	const current = streams.get(key);
	if (current && current.service === s) return current;
	current?.controller.abort();
	const controller = new AbortController();
	const es: EnvStream = { key, service: s, controller, connected: false, rootToConv: new Map() };
	streams.set(key, es);
	followEvents(s, controller.signal, {
		batch: (events) => {
			// Learn root task -> conversation mappings for approval routing.
			for (const raw of events) {
				const ev = raw as { topic?: string; payload?: any };
				if (typeof ev?.topic === "string" && /^agent\/[^/]+\/started$/.test(ev.topic)) {
					const p = ev.payload ?? {};
					if ((p.depth ?? 0) === 0 && typeof p.task === "number" && typeof p.agent === "string" && typeof p.session === "string") {
						es.rootToConv.set(p.task, { agent: p.agent, session: p.session });
						if (es.rootToConv.size > 500) {
							const oldest = es.rootToConv.keys().next().value;
							if (oldest !== undefined) es.rootToConv.delete(oldest);
						}
					}
				}
			}
			const bound = windowsOnEnv(key).filter((w) => w.service === s && w.ready);
			if (!bound.length) return;
			const primaryAll = targetWindow(bound);
			for (const w of bound) {
				const forWin: unknown[] = [];
				for (const raw of events) {
					const ev = raw as { topic?: string; payload?: any };
					if (ev?.topic === "approval/requested") {
						const p = ev.payload ?? {};
						const conv = es.rootToConv.get(p.root ?? p.task);
						let holders = conv ? bound.filter((bw) => (bw.layout?.tabs ?? []).some((t) => t.agent === conv.agent && t.session === conv.session)) : [];
						if (!holders.length && typeof p.agent === "string") {
							holders = bound.filter((bw) => (bw.layout?.tabs ?? []).some((t) => t.agent === p.agent));
						}
						if (holders.length > 0) {
							if (!holders.includes(w)) continue;
							const primaryHolder = targetWindow(holders);
							forWin.push({ ...ev, payload: { ...p, _askModal: w === primaryHolder } });
						} else {
							if (w !== primaryAll) continue;
							forWin.push({ ...ev, payload: { ...p, _askModal: true } });
						}
					} else if (ev?.topic === "pine/conversation" && ev.payload?.change === "open") {
						const agent = String(ev.payload.agent ?? "");
						const session = String(ev.payload.session ?? "") || "main";
						const holders = bound.filter((bw) => (bw.layout?.tabs ?? []).some((t) => t.agent === agent && t.session === session));
						if (holders.length > 0) {
							if (!holders.includes(w)) continue;
							forWin.push(ev);
						} else {
							if (w !== primaryAll) continue;
							forWin.push(ev);
						}
					} else {
						forWin.push(ev);
					}
				}
				if (forWin.length) sendTo(w, "pine:events", forWin);
			}
		},
		connection: (up) => {
			es.connected = up;
			for (const w of windowsOnEnv(key)) {
				if (w.service === s) sendTo(w, "pine:connection", up);
			}
		},
		// A daemon this app started and that is gone will not come back by waiting: start it again.
		// Nor does an SSH connection that broke: it is made again once for all windows on it.
		lost: (times) => {
			if (times !== 5 || !(s.started || s.host) || quitting) return false;
			if (streams.get(key) === es) {
				streams.delete(key);
				es.controller.abort();
			}
			if (held.get(key) === s) held.delete(key);
			void letGo(s);
			for (const w of windowsOnEnv(key)) void startWindowService(w);
			return true;
		},
	});
	return es;
}

async function startWindowService(mw: ManagedWindow): Promise<void> {
	const mine = ++mw.round;
	const host = mw.host;
	mw.service = undefined;
	pruneStreams();
	setWindowState(mw, { status: "starting", host });
	sendTo(mw, "pine:connection", false);
	try {
		const s = await acquireService(host);
		if (mine !== mw.round || mw.win.isDestroyed()) return;
		mw.service = s;
		setWindowState(mw, { status: "ready", mode: s.mode, started: s.started, home: s.home, version: s.version, from: host ? `ssh ${host}` : (launch?.from ?? ""), host: s.host, label: s.label });
		const es = ensureStream(s);
		sendTo(mw, "pine:connection", es.connected);
	} catch (e) {
		if (mine !== mw.round || mw.win.isDestroyed()) return;
		setWindowState(mw, { status: "error", kind: e instanceof ServiceError ? e.kind : "failed", message: e instanceof Error ? e.message : String(e), host });
	}
}

/** Switch one window's environment without disturbing any other open window. */
async function useInWindow(mw: ManagedWindow, host: string | undefined): Promise<void> {
	if (host !== undefined && !prefs.hosts.includes(host)) throw new Error("That machine is not in the list: add it in Settings > Environments.");
	if (host === mw.host && mw.service) return;
	const wasLocal = mw.host === undefined;
	mw.host = host;
	mw.layout = undefined;
	mw.noTab = false;
	mw.approvalIds.clear();
	mw.badgeCount = 0;
	prefs.use = host;
	syncOpenWindowsPrefs();
	savePrefs();
	broadcastOpenHosts();
	refreshBadge();
	// Close only this window's local terminals when switching away from the local environment.
	if (wasLocal && host !== undefined) terminals.closeWindow(mw.id);
	await startWindowService(mw);
}

/** Computes the deduplicated union of chat tabs across all windows viewing `key`, initiator's tabs first. */
function unionTabsForEnv(key: string, initiator: ManagedWindow | undefined, mine?: TabRef[]): TabRef[] {
	const seen = new Set<string>();
	const out: TabRef[] = [];
	const add = (tabs: TabRef[]) => {
		for (const t of tabs) {
			const k = `${t.agent}:${t.session}`;
			if (seen.has(k)) continue;
			seen.add(k);
			out.push({ agent: t.agent, session: t.session });
		}
	};
	if (mine) add(mine);
	else if (initiator?.layout?.tabs) add(initiator.layout.tabs);
	for (const w of windowsOnEnv(key)) {
		if (w === initiator) continue;
		if (w.layout?.tabs) add(w.layout.tabs);
		else if (w.initialTab) add([w.initialTab]);
	}
	return out;
}

/** A picture, video or sound of the daemon's, for the page's `pine-media:` addresses. */
async function media(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const m = /^window-(\d+)$/.exec(url.hostname);
	const mw = m ? windowsById.get(Number(m[1])) : targetWindow();
	return mediaFromDaemon(mw?.service, request.method, url.pathname, url.search);
}

// ---- the page ----------------------------------------------------------------------------------

const CSP = pageCsp();

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".map": "application/json" };

function page(request: Request): Response {
	const dist = path.join(APP_ROOT, "dist");
	const url = new URL(request.url);
	const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
	const file = path.normalize(path.join(dist, rel));
	if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response("not found", { status: 404 });
	return new Response(fs.readFileSync(file), { headers: { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "content-security-policy": CSP, "x-content-type-options": "nosniff" } });
}

function senderWindow(e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): ManagedWindow | undefined {
	const mw = windowsByWc.get(e.sender);
	const frame = e.senderFrame;
	if (!mw || mw.win.isDestroyed() || !frame || frame !== mw.win.webContents.mainFrame || originOf(frame.url) !== ORIGIN) return undefined;
	return mw;
}

/** Only pages on the web open outside the app; a link in an answer never starts a program or opens a file. */
function openOutside(url: string): void {
	try {
		const u = new URL(url);
		if (u.protocol === "http:" || u.protocol === "https:") void shell.openExternal(u.href);
	} catch {
		// not an address
	}
}

function cascadedBounds(refWindow?: ManagedWindow): Bounds | undefined {
	const ref = refWindow && !refWindow.win.isDestroyed() ? refWindow.win.getBounds() : targetWindow()?.win.getBounds() ?? prefs.bounds;
	if (!ref) return undefined;
	const width = ref.width || 1280;
	const height = ref.height || 820;
	if (ref.x === undefined || ref.y === undefined) return { width, height };
	const display = screen.getDisplayMatching({ x: ref.x, y: ref.y, width, height });
	const wa = display.workArea;
	let x = ref.x + 24;
	let y = ref.y + 24;
	if (x + width > wa.x + wa.width) x = wa.x + 24;
	if (y + height > wa.y + wa.height) y = wa.y + 24;
	x = Math.max(wa.x, Math.min(x, Math.max(wa.x, wa.x + wa.width - width)));
	y = Math.max(wa.y, Math.min(y, Math.max(wa.y, wa.y + wa.height - height)));
	return { x: Math.round(x), y: Math.round(y), width, height };
}

interface CreateWindowOptions {
	host?: string;
	bounds?: Bounds;
	layout?: WindowLayout;
	noTab?: boolean;
	initialTab?: TabRef;
	initialDraft?: DraftTransfer;
}

function createWindow(opts: CreateWindowOptions = {}): ManagedWindow {
	const id = nextWindowId++;
	const mediaBase = `pine-media://window-${id}`;
	const b = opts.bounds ?? prefs.bounds;
	const win = new BrowserWindow({
		width: b?.width ?? 1280,
		height: b?.height ?? 820,
		x: b?.x,
		y: b?.y,
		// As narrow as a phone: below the page's breakpoint the side bar and the panel beside a conversation lie over it.
		minWidth: 360,
		minHeight: 480,
		show: false,
		title: "Pine",
		titleBarStyle: isMac ? "hiddenInset" : "default",
		trafficLightPosition: { x: 16, y: 16 },
		// Gives the page where the window buttons end (env(titlebar-area-x), 0 in full screen), so the bars make room for them by themselves.
		titleBarOverlay: isMac,
		vibrancy: isMac ? "sidebar" : undefined,
		visualEffectState: "followWindow",
		// So that the window does not flash another colour before the page draws.
		backgroundColor: windowBackground(),
		webPreferences: {
			preload: path.join(HERE, "preload.cjs"),
			additionalArguments: [`--pine-window-id=${id}`],
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			webSecurity: true,
			spellcheck: true,
			navigateOnDragDrop: false,
		},
	});
	const mw: ManagedWindow = {
		id,
		win,
		mediaBase,
		ready: false,
		focusedAt: ++focusClock,
		host: opts.host,
		service: undefined,
		state: { status: "starting", host: opts.host },
		round: 0,
		look: prefs.look,
		bounds: b,
		layout: opts.layout,
		noTab: opts.noTab === true,
		initialTab: opts.initialTab,
		initialDraft: opts.initialDraft,
		pendingFolders: [],
		approvalIds: new Set(),
		badgeCount: 0,
	};
	const wc = win.webContents;
	windowsById.set(id, mw);
	windowsByWc.set(wc, mw);

	win.once("ready-to-show", () => {
		if (win.isDestroyed()) return;
		if (BACKGROUND) win.showInactive();
		else win.show();
	});
	win.webContents.setWindowOpenHandler(({ url }) => (openOutside(url), { action: "deny" }));
	win.webContents.on("will-navigate", (e, url) => {
		// The page stays the page. (Reloading it during development is the one navigation there is.)
		if (originOf(url) !== ORIGIN) {
			e.preventDefault();
			openOutside(url);
		}
	});
	win.webContents.on("will-attach-webview", (e) => e.preventDefault());
	const keepBounds = () => {
		if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
		mw.bounds = win.getBounds();
		syncOpenWindowsPrefs();
	};
	win.on("resize", keepBounds);
	win.on("move", keepBounds);
	win.on("close", () => {
		if (!quitting) {
			if (!win.isDestroyed() && !win.isMinimized() && !win.isFullScreen()) mw.bounds = win.getBounds();
			if (windowsById.size === 1) {
				prefs.use = mw.host;
				if (mw.bounds) prefs.bounds = mw.bounds;
			}
		}
	});
	win.on("focus", () => {
		mw.focusedAt = ++focusClock;
		if (mw.look) nativeTheme.themeSource = mw.look.kind;
		sendTo(mw, "pine:focus", true);
	});
	win.on("blur", () => sendTo(mw, "pine:focus", false));
	win.on("closed", () => {
		const envKey = envKeyOf(mw.host);
		const hadService = mw.service;
		if (voiceWindow === mw) {
			listening?.cancel();
			listening = undefined;
			voiceWindow = undefined;
		}
		windowsById.delete(id);
		windowsByWc.delete(wc);
		terminals.closeWindow(id);
		if (!quitting) {
			syncOpenWindowsPrefs();
			savePrefs();
			// If other windows remain on the same daemon, refresh `/ui/tabs` to their union.
			const remaining = windowsOnEnv(envKey);
			if (remaining.length > 0 && hadService) {
				const primary = targetWindow(remaining);
				const union = unionTabsForEnv(envKey, primary);
				void callDaemon(hadService, "POST", "/ui/tabs", { tabs: union, active: primary?.layout?.active ?? 0, code: primary?.layout?.code ?? false }).catch(() => {});
			}
		}
		pruneStreams();
		broadcastOpenHosts();
		refreshBadge();
	});
	void win.loadURL(DEV_URL ?? "app://pine/");
	if (process.env.PINE_DESKTOP_DEVTOOLS) win.webContents.openDevTools({ mode: "detach" });
	void startWindowService(mw);
	syncOpenWindowsPrefs();
	broadcastOpenHosts();
	return mw;
}

function focusWindow(mw: ManagedWindow): void {
	if (mw.win.isDestroyed()) return;
	if (mw.win.isMinimized()) mw.win.restore();
	if (BACKGROUND) mw.win.showInactive();
	else {
		mw.win.show();
		mw.win.focus();
	}
}

function ensureWindow(): ManagedWindow {
	return targetWindow() ?? createWindow({ host: prefs.use, bounds: prefs.bounds });
}

function openNewWindow(from?: ManagedWindow, options?: NewWindowOptions): ManagedWindow {
	const host = options?.host === null ? undefined : options?.host !== undefined ? options.host : from?.host ?? prefs.use;
	if (host !== undefined && !prefs.hosts.includes(host)) {
		throw new Error("That machine is not in the list: add it in Settings > Environments.");
	}
	const key = envKeyOf(host);
	const hasOtherOnEnv = windowsOnEnv(key).length > 0;
	const noTab = !options?.tab && hasOtherOnEnv;
	const bounds = cascadedBounds(from);
	const created = createWindow({
		host,
		bounds,
		noTab,
		initialTab: options?.tab,
		initialDraft: options?.draft,
	});
	if (options?.moveFrom && from && options.tab && !from.host && !created.host) {
		terminals.transfer(from.id, created.id, `${options.tab.agent}:${options.tab.session}`);
	}
	return created;
}

// ---- `pine` for a terminal -----------------------------------------------------------------------

/** What the packed app carries; a checkout has none of it. */
const RESOURCES = app.isPackaged ? process.resourcesPath : undefined;

const worded = (c: Command) => ({ ...c, text: said(c) });

/**
 * Once, the first time an app that carries pine is started from where it will stay: the link is
 * made where that takes no password. Where it takes one, nothing is asked out of nowhere; the
 * menu and Settings > App offer it. Not in a second set of data for tests and trying things out.
 */
async function firstCommand(): Promise<void> {
	if (prefs.commandTried || process.env.PINE_DESKTOP_DATA) return;
	const env = await loginEnv();
	const now = look(RESOURCES, env);
	if (now.state === "unavailable") return;
	prefs.commandTried = true;
	savePrefs();
	if (now.state === "none" && !now.password) await install(RESOURCES, env);
}

/** The menu's way to the same thing: asks before it sets the command up, and says what is so. */
async function commandFromMenu(): Promise<void> {
	const env = await loginEnv();
	let now = look(RESOURCES, env);
	if (now.state === "none") {
		const answer = await dialog.showMessageBox({ type: "question", message: "Use pine in a terminal too?", detail: said(now).replace(/^Not set up\. /, ""), buttons: ["Set Up", "Not Now"], defaultId: 0, cancelId: 1 });
		if (answer.response !== 0) return;
		now = await install(RESOURCES, env);
	}
	await dialog.showMessageBox({ type: "info", message: "pine in a terminal", detail: said(now) });
}

// ---- a newer app ---------------------------------------------------------------------------------

/**
 * Whom this app asks for the last release. An app from a checkout is no release and has no
 * version to compare: it asks nobody. PINE_DESKTOP_RELEASES is for tests, which name a stand-in
 * for GitHub (and with nothing in it, nobody is asked). Whatever answers there, the link the
 * owner gets leads to GitHub.
 */
const RELEASE_API = process.env.PINE_DESKTOP_RELEASES !== undefined ? process.env.PINE_DESKTOP_RELEASES || undefined : app.isPackaged ? LATEST : undefined;

/** The last answer that said something, for a page that is opened again. */
let known: Update | undefined;
/** The question of this start, asked once. */
let atStart: Promise<Update> | undefined;

async function askForUpdate(): Promise<Update> {
	const said = await lookForUpdate(app.getVersion(), process.arch, RELEASE_API);
	if (said.status !== "unknown") known = said;
	return said;
}

/**
 * What the page is told: with `again` (the menu, the settings) what GitHub says now, without it
 * what the start found. A start that got no answer asks again when the window is next opened.
 */
async function update(again?: boolean): Promise<Update | undefined> {
	if (!RELEASE_API) return undefined;
	if (again) return askForUpdate();
	if (prefs.updates) await (atStart ??= askForUpdate().then((said) => (said.status === "unknown" && (atStart = undefined), said)));
	return known;
}

// ---- menus -------------------------------------------------------------------------------------

/** A menu item that asks the page to do something: the page knows which conversation is in front. */
const item = (label: string, command: string, accelerator?: string, more: MenuItemConstructorOptions = {}): MenuItemConstructorOptions => ({
	label,
	accelerator,
	click: () => {
		const mw = ensureWindow();
		focusWindow(mw);
		sendTo(mw, "pine:menu", command);
	},
	...more,
});

function buildMenu(): void {
	const template: MenuItemConstructorOptions[] = [
		...(isMac
			? [
					{
						label: "Pine",
						submenu: [{ role: "about" as const }, ...(RELEASE_API ? [item("Check for Updates…", "updates")] : []), { type: "separator" as const }, item("Settings…", "settings", "Cmd+,"), ...(RESOURCES && fs.existsSync(path.join(RESOURCES, "bin", "pine")) ? [{ label: "pine in a Terminal…", click: () => void commandFromMenu() }] : []), { type: "separator" as const }, { role: "services" as const }, { type: "separator" as const }, { role: "hide" as const }, { role: "hideOthers" as const }, { role: "unhide" as const }, { type: "separator" as const }, { role: "quit" as const }],
					},
				]
			: []),
		{
			label: "File",
			submenu: [
				{ label: "New Window", accelerator: "CmdOrCtrl+N", click: () => void openNewWindow(targetWindow()) },
				item("New Conversation", "new", "CmdOrCtrl+T"),
				item("New Conversation with…", "agent", "CmdOrCtrl+Shift+T"),
				item("Open Folder…", "open-folder", "CmdOrCtrl+O"),
				item("New Conversation in a Worktree…", "new-worktree", "CmdOrCtrl+Alt+T"),
				{ type: "separator" },
				item("Attach Files…", "attach", "CmdOrCtrl+Shift+A"),
				item("Save File", "save", "CmdOrCtrl+S"),
				item("Export Conversation…", "export", "CmdOrCtrl+Shift+E"),
				{ type: "separator" },
				{
					label: "Close Tab",
					accelerator: "CmdOrCtrl+W",
					click: () => {
						const mw = targetWindow();
						if (mw) sendTo(mw, "pine:menu", "close");
					},
				},
				{
					label: "Close Window",
					accelerator: "CmdOrCtrl+Shift+W",
					click: () => {
						const mw = targetWindow();
						if (mw && !mw.win.isDestroyed()) mw.win.close();
					},
				},
				...(isMac ? [] : [{ type: "separator" as const }, item("Settings…", "settings", "Ctrl+,"), { role: "quit" as const }]),
			],
		},
		{ label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "pasteAndMatchStyle" }, { role: "selectAll" }, { type: "separator" }, item("Find in Conversation", "find", "CmdOrCtrl+F"), item("Copy Last Answer", "copy", "CmdOrCtrl+Shift+C"), ...(isMac ? [item("Dictate Message", "voice", "Ctrl+R")] : [])] },
		{
			label: "View",
			submenu: [
				item("Command Palette…", "palette", "CmdOrCtrl+K"),
				{ type: "separator" },
				item("Toggle Sidebar", "sidebar", "CmdOrCtrl+B"),
				item("Toggle Side Panel", "code", "CmdOrCtrl+Alt+B"),
				item("Agent", "code-agent", "CmdOrCtrl+Shift+I"),
				item("Files", "code-files", "CmdOrCtrl+Shift+F"),
				item("Changes", "code-changes", "CmdOrCtrl+Shift+G"),
				item("Terminal", "code-terminal", "Ctrl+`"),
				item("Toggle Browser", "browser", "CmdOrCtrl+Shift+B"),
				item("Events", "events", "CmdOrCtrl+Shift+L"),
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
				...(app.isPackaged ? [] : [{ type: "separator" as const }, { role: "reload" as const }, { role: "toggleDevTools" as const }]),
			],
		},
		{
			label: "Conversation",
			submenu: [
				item("Stop", "stop", "CmdOrCtrl+."),
				{ type: "separator" },
				item("Take Back Last Message", "undo", "CmdOrCtrl+Shift+Z"),
				item("Bring It Back", "redo", "CmdOrCtrl+Shift+Y"),
				item("Shorten (Compact)", "compact"),
				item("Start Over (Reset)…", "reset"),
				{ type: "separator" },
				item("Model…", "model", "CmdOrCtrl+Shift+M"),
				item("Reasoning…", "reasoning"),
				item("Mode…", "mode", "CmdOrCtrl+Shift+P"),
				item("Goal…", "goal"),
				item("Worktree…", "worktree"),
				{ type: "separator" },
				item("Pin", "pin"),
				item("Rename…", "rename"),
				{ type: "separator" },
				item("Next Tab", "next-tab", "Ctrl+Tab"),
				item("Previous Tab", "prev-tab", "Ctrl+Shift+Tab"),
				...Array.from({ length: 9 }, (_, i) => item(`Tab ${i + 1}`, `tab-${i + 1}`, `CmdOrCtrl+${i + 1}`, { visible: false, acceleratorWorksWhenHidden: true })),
			],
		},
		{ role: "windowMenu" },
		{ role: "help", submenu: [item("Keys and Commands", "help"), ...(RELEASE_API && !isMac ? [item("Check for Updates…", "updates")] : []), { label: "pine on GitHub", click: () => openOutside("https://github.com/pmndre/pine") }] },
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
	if (isMac && app.dock) {
		app.dock.setMenu(Menu.buildFromTemplate([{ label: "New Window", click: () => void openNewWindow(targetWindow()) }]));
	}
}

// ---- what the page may ask for -----------------------------------------------------------------

function handle<T extends unknown[]>(channel: string, fn: (mw: ManagedWindow, ...args: T) => unknown): void {
	ipcMain.handle(channel, (e, ...args) => {
		const mw = senderWindow(e);
		if (!mw) throw new Error("not from the app's page");
		return fn(mw, ...(args as T));
	});
}

function wire(): void {
	handle("pine:state", (mw) => {
		const es = streams.get(envKeyOf(mw.host));
		return {
			state: mw.state,
			connected: Boolean(mw.service) && Boolean(es?.connected),
			home: prefs.home ?? process.env.PINE_HOME,
			prefs: publicPrefs(),
			platform: process.platform,
			focused: Boolean(!mw.win.isDestroyed() && mw.win.isFocused()),
			updates: Boolean(RELEASE_API),
			versions: { app: app.getVersion(), electron: process.versions.electron },
			windowId: mw.id,
			windowLayout: mw.layout,
			noTab: mw.noTab,
			initialTab: mw.initialTab,
			initialDraft: mw.initialDraft,
			openHosts: openHostsFor(mw),
		};
	});
	handle("pine:new-window", (mw, options?: NewWindowOptions) => {
		openNewWindow(mw, options);
	});
	handle("pine:close-window", (mw) => {
		if (!mw.win.isDestroyed()) mw.win.close();
	});
	handle("pine:window-layout", (mw, snapshot: WindowLayout) => {
		if (!snapshot || typeof snapshot !== "object") return;
		mw.layout = {
			host: mw.host,
			tabs: cleanTabs(snapshot.tabs),
			active: Math.max(0, Math.floor(Number(snapshot.active) || 0)),
			code: snapshot.code === true,
			noTab: snapshot.noTab === true,
			sidebar: snapshot.sidebar !== false,
			sidebarWidth: cleanPositive(snapshot.sidebarWidth),
			codeWidth: cleanPositive(snapshot.codeWidth),
			aside: snapshot.aside === true,
			asideWidth: cleanPositive(snapshot.asideWidth),
			folded: Array.isArray(snapshot.folded) ? snapshot.folded.filter((f): f is string => typeof f === "string") : [],
		};
		mw.noTab = mw.layout.noTab;
		syncOpenWindowsPrefs();
		savePrefs();
	});
	handle("pine:call", async (mw, method: string, url: string, body?: unknown) => {
		// Coordinate `/ui/tabs` across all windows on the same environment: write their deduplicated union.
		if (method === "POST" && url === "/ui/tabs" && body && typeof body === "object") {
			const b = body as { tabs?: TabRef[]; active?: number; code?: boolean };
			const mine = cleanTabs(b.tabs);
			if (mw.layout) {
				mw.layout.tabs = mine;
				mw.layout.active = Math.max(0, Math.floor(Number(b.active) || 0));
				mw.layout.code = b.code === true;
				mw.layout.noTab = mine.length === 0;
			} else {
				mw.layout = { host: mw.host, tabs: mine, active: Math.max(0, Math.floor(Number(b.active) || 0)), code: b.code === true, noTab: mine.length === 0, sidebar: true, aside: false, folded: [] };
			}
			const union = unionTabsForEnv(envKeyOf(mw.host), mw, mine);
			return callDaemon(mw.service, method, url, { ...b, tabs: union });
		}
		// Closing a non-main conversation's tab ends its session subscriptions only if no other window on this environment holds it.
		if (method === "POST" && body && typeof body === "object") {
			const closeMatch = /^\/agents\/([^/]+)\/close$/.exec(url);
			const sess = typeof (body as any).session === "string" ? (body as any).session : undefined;
			if (closeMatch && sess) {
				const agent = decodeURIComponent(closeMatch[1]);
				const heldElsewhere = windowsOnEnv(envKeyOf(mw.host)).some((w) => w !== mw && ((w.layout?.tabs ?? []).some((t) => t.agent === agent && t.session === sess) || (w.initialTab?.agent === agent && w.initialTab?.session === sess)));
				if (heldElsewhere) return { ok: true, status: 200, data: { unsubscribed: [] } };
			}
		}
		return callDaemon(mw.service, method, url, body);
	});
	handle("pine:retry", (mw) => startWindowService(mw));
	handle("pine:update", (_mw, again?: boolean) => update(again === true));
	handle("pine:restart", async (mw) => {
		// Only a daemon of this app's own is its to restart; another one is somebody's terminal.
		const s = mw.service;
		if (!s?.started) throw new Error("this pine was started somewhere else (a terminal, a service). Restart it there.");
		const key = envKeyOf(s.host);
		streams.get(key)?.controller.abort();
		streams.delete(key);
		held.delete(key);
		await s.stop();
		await Promise.all(windowsOnEnv(key).map((w) => startWindowService(w)));
	});
	handle("pine:init", async (mw) => {
		launch ??= await findPine(APP_ROOT, app.isPackaged ? process.resourcesPath : undefined);
		const args = ["init", ...(prefs.home ? [prefs.home] : []), "--yes"];
		return runPine(launch, args, (line) => sendTo(mw, "pine:init-line", line), process.env.PINE_SKIP_DOWNLOADS ? { PINE_SKIP_DOWNLOADS: "1" } : {});
	});
	// The browser the web tools drive, fetched by the pine the app runs: each pine wants the build
	// of its own Playwright, and a home that was set up by another pine has an older one.
	handle("pine:browser", async (mw) => {
		launch ??= await findPine(APP_ROOT, app.isPackaged ? process.resourcesPath : undefined);
		return runPine(launch, ["browser-install"], (line) => sendTo(mw, "pine:init-line", line), process.env.PINE_SKIP_DOWNLOADS ? { PINE_SKIP_DOWNLOADS: "1" } : {});
	});
	handle("pine:command", async (_mw, action?: string) => {
		const env = await loginEnv();
		return worded(action === "install" ? await install(RESOURCES, env) : action === "remove" ? await remove(RESOURCES, env) : look(RESOURCES, env));
	});
	handle("pine:use", (mw, host?: string) => useInWindow(mw, typeof host === "string" ? host : undefined));
	// A machine is added by its name alone; it is connected to when it is picked.
	handle("pine:hosts-add", (_mw, value: string) => {
		const host = sshHost(String(value ?? ""))?.host;
		if (!host) throw new Error("Write the machine as you would after ssh: host or user@host.");
		if (!prefs.hosts.includes(host)) {
			if (prefs.hosts.length >= 20) throw new Error("There are 20 machines in the list already: forget one first.");
			prefs.hosts.push(host);
			savePrefs();
			broadcastPrefs();
		}
		return publicPrefs();
	});
	handle("pine:hosts-forget", (mw, host: string, options?: { closeWindows?: boolean }) => {
		if (host === mw.host) throw new Error("This window uses this machine now. Use another one first.");
		const others = windowsOnEnv(String(host)).filter((w) => w !== mw);
		if (others.length && !options?.closeWindows) throw new Error("Another window uses this machine now. Close it first.");
		for (const w of others) if (!w.win.isDestroyed()) w.win.close();
		prefs.hosts = prefs.hosts.filter((h) => h !== host);
		if (prefs.use === host) prefs.use = undefined;
		savePrefs();
		// Its connection ends, and a pine it started there with it.
		const s = held.get(String(host));
		if (s) {
			streams.get(String(host))?.controller.abort();
			streams.delete(String(host));
			held.delete(String(host));
			void letGo(s);
		}
		broadcastPrefs();
		broadcastOpenHosts();
		return publicPrefs();
	});
	handle("pine:prefs", (mw, change: Partial<Prefs>) => {
		let homeChanged = false;
		if (typeof change.notify === "boolean") prefs.notify = change.notify;
		if (typeof change.updates === "boolean") prefs.updates = change.updates;
		if (typeof change.keepRunning === "boolean") prefs.keepRunning = change.keepRunning;
		if ("home" in change) {
			const home = typeof change.home === "string" && change.home.trim() ? change.home.trim() : undefined;
			const old = held.get("");
			if (home !== prefs.home) {
				homeChanged = true;
				if (old) {
					streams.get("")?.controller.abort();
					streams.delete("");
					held.delete("");
					if (old !== mw.service) void letGo(old);
				}
			}
			prefs.home = home;
		}
		// The theme the page draws now: this window's background follows it, and OS appearance follows the focused window.
		if ("look" in change) {
			const look = cleanLook(change.look);
			mw.look = look;
			prefs.look = look;
			refreshBackground(mw);
			if (mw.win.isFocused() || allWindows().length <= 1) nativeTheme.themeSource = look?.kind ?? "dark";
		}
		if (typeof change.agentAccent === "boolean") prefs.agentAccent = change.agentAccent;
		savePrefs();
		broadcastPrefs();
		if (homeChanged) {
			for (const w of windowsOnEnv("")) {
				if (w !== mw) void startWindowService(w);
			}
		}
		return publicPrefs();
	});
	handle("pine:pick-folder", async (mw, title?: string) => {
		const r = await dialog.showOpenDialog(mw.win, { title: typeof title === "string" ? title.slice(0, 80) : "Choose a folder", properties: ["openDirectory", "createDirectory"] });
		return r.canceled ? undefined : r.filePaths[0];
	});
	handle("pine:save-text", async (mw, name: string, text: string) => {
		const r = await dialog.showSaveDialog(mw.win, { defaultPath: path.join(app.getPath("documents"), path.basename(String(name))) });
		if (r.canceled || !r.filePath) return undefined;
		fs.writeFileSync(r.filePath, String(text));
		return r.filePath;
	});
	handle("pine:open", (_mw, url: string) => openOutside(String(url)));
	handle("pine:reveal", (_mw, file: string) => {
		// Shown in the Finder, never opened: opening would start whatever the file is.
		if (typeof file === "string" && path.isAbsolute(file) && fs.existsSync(file)) shell.showItemInFolder(file);
	});
	handle("pine:notify", (mw, title: string, body: string, tab?: string) => {
		if (!prefs.notify || !Notification.isSupported()) return;
		const key = envKeyOf(mw.host);
		// Suppress if any window on the same environment is currently focused and showing this conversation.
		for (const w of windowsOnEnv(key)) {
			if (!w.win.isFocused()) continue;
			if (!tab) return;
			const activeTab = w.layout?.tabs[w.layout.active];
			if (activeTab && `${activeTab.agent}:${activeTab.session}` === tab) return;
			if (w === mw) return;
		}
		const now = Date.now();
		const dedupKey = `${key}|${tab ?? ""}|${String(title)}|${String(body)}`;
		const prev = recentNotices.get(dedupKey);
		if (prev && now - prev < 2000) return;
		recentNotices.set(dedupKey, now);
		if (recentNotices.size > 100) {
			for (const [k, ts] of recentNotices) if (now - ts >= 2000) recentNotices.delete(k);
		}
		const n = new Notification({ title: String(title).slice(0, 80), body: String(body).slice(0, 160), silent: false });
		n.on("click", () => {
			if (!mw.win.isDestroyed()) {
				focusWindow(mw);
				if (tab) sendTo(mw, "pine:menu", `focus:${tab}`);
			}
		});
		n.show();
	});
	handle("pine:badge", (mw, count: number, ids?: string[]) => {
		mw.approvalIds.clear();
		if (Array.isArray(ids)) {
			for (const id of ids) if (typeof id === "string") mw.approvalIds.add(id);
			mw.badgeCount = 0;
		} else {
			mw.badgeCount = Math.max(0, Number(count) || 0);
		}
		refreshBadge();
	});
	// Dictating a message. The words are recognised on this Mac by the helper the terminal UI
	// uses too (src/tui/voice.ts): nothing is sent anywhere, and what is heard is text for the
	// input and nothing more. The page puts it there; nothing here sends a message.
	handle("pine:voice-start", async (mw, language?: string) => {
		listening?.cancel();
		listening = undefined;
		voiceWindow = mw;
		const lang = typeof language === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language) ? language : undefined;
		let command: string[];
		if (process.env.PINE_DESKTOP_VOICE) command = [process.env.PINE_DESKTOP_VOICE]; // a stand-in, for tests
		else {
			if (!isMac) throw new Error(NOT_HERE);
			launch ??= await findPine(APP_ROOT, app.isPackaged ? process.resourcesPath : undefined);
			const source = path.join(pineRoot(launch) ?? "", "src", "tui", "voice.swift");
			if (!fs.existsSync(source)) throw new Error("this pine has no voice input: its helper's source was not found. Update pine.");
			command = [await buildVoice(path.join(app.getPath("userData"), "voice"), source)];
		}
		const mine: Listening = new Listening(command, lang, {
			ready: () => listening === mine && sendTo(voiceWindow, "pine:voice", { type: "ready" }),
			partial: (text) => listening === mine && sendTo(voiceWindow, "pine:voice", { type: "partial", text }),
			model: (state) => listening === mine && sendTo(voiceWindow, "pine:voice", { type: "model", state }),
			done: (text, error) => {
				if (listening !== mine) return;
				const target = voiceWindow;
				listening = undefined;
				voiceWindow = undefined;
				sendTo(target, "pine:voice", { type: "done", text, error });
			},
		});
		listening = mine;
	});
	handle("pine:voice-stop", (_mw, cancel?: boolean) => {
		if (cancel) {
			listening?.cancel();
			listening = undefined;
			voiceWindow = undefined;
		} else {
			listening?.stop();
		}
	});
	// The owner's terminal beside a conversation. What is written into it comes from the page's
	// keyboard, or from a code block of an answer that the owner ran with its button.
	handle("pine:term-open", (mw, id: string, cwd?: string, cols?: number, rows?: number) => terminals.open(mw.id, String(id), cwd, cols, rows));
	handle("pine:term-write", (mw, id: string, data: string) => terminals.write(mw.id, String(id), data));
	handle("pine:term-run", (mw, id: string, code: string) => terminals.run(mw.id, String(id), code));
	handle("pine:term-resize", (mw, id: string, cols: number, rows: number) => terminals.resize(mw.id, String(id), cols, rows));
	handle("pine:term-close", (mw, id: string) => terminals.close(mw.id, String(id)));
	// An item with `checked` is one of a set of choices (the side bar's "Sort by"), drawn with the system's mark.
	handle("pine:context-menu", (mw, items: Array<{ id: string; label: string; enabled?: boolean; separator?: boolean; danger?: boolean; checked?: boolean }>) => {
		return new Promise<string | undefined>((resolve) => {
			let picked: string | undefined;
			const menu = Menu.buildFromTemplate(items.slice(0, 30).map((i) => (i.separator ? { type: "separator" as const } : { label: String(i.label).slice(0, 80), enabled: i.enabled !== false, ...(typeof i.checked === "boolean" ? { type: "radio" as const, checked: i.checked } : {}), click: () => (picked = String(i.id)) })));
			menu.popup({ window: mw.win, callback: () => resolve(picked) });
		});
	});
}

// ---- life of the app ---------------------------------------------------------------------------

/** A folder the app was opened with (dropped on its icon, or `open -a Pine <folder>`): a conversation that works there. */
const pendingGlobalFolders: string[] = [];
function openFolder(dir: string): void {
	try {
		if (!fs.statSync(dir).isDirectory()) return;
	} catch {
		return;
	}
	const localWin = targetWindow(windowsOnEnv(""));
	if (localWin) {
		focusWindow(localWin);
		if (localWin.ready) sendTo(localWin, "pine:menu", `folder:${dir}`);
		else localWin.pendingFolders.push(dir);
		return;
	}
	if (app.isReady()) {
		const created = createWindow({ host: undefined, bounds: cascadedBounds() });
		created.pendingFolders.push(dir);
		return;
	}
	pendingGlobalFolders.push(dir);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on("second-instance", (_e, argv) => {
		const dir = argv.slice(1).find((a) => !a.startsWith("-") && path.isAbsolute(a));
		if (dir) return openFolder(dir);
		focusWindow(ensureWindow());
	});
	app.on("open-file", (e, file) => {
		e.preventDefault();
		openFolder(file);
	});
	app.on("web-contents-created", (_e, contents) => {
		// Nothing the page shows gets the camera, the microphone, the place or anything else of the system's.
		contents.session.setPermissionRequestHandler((_wc, _permission, done) => done(false));
	});
	void app.whenReady().then(() => {
		loadPrefs();
		protocol.handle("app", page);
		protocol.handle("pine-media", media);
		session.defaultSession.setPermissionRequestHandler((_wc, _permission, done) => done(false));
		wire();
		ipcMain.on("pine:ready", (e) => {
			const mw = senderWindow(e);
			if (!mw) return;
			mw.ready = true;
			sendTo(mw, "pine:service", mw.state);
			const es = streams.get(envKeyOf(mw.host));
			if (mw.service && es) sendTo(mw, "pine:connection", es.connected);
			for (const dir of mw.pendingFolders.splice(0)) sendTo(mw, "pine:menu", `folder:${dir}`);
			if (!mw.host && pendingGlobalFolders.length) {
				for (const dir of pendingGlobalFolders.splice(0)) sendTo(mw, "pine:menu", `folder:${dir}`);
			}
		});
		// From a checkout the program is Electron's, and so would be its icon in the Dock.
		if (isMac && !app.isPackaged) {
			try {
				app.dock?.setIcon(path.join(APP_ROOT, "assets", "icon.png"));
			} catch {
				// an icon is not worth failing over
			}
		}
		buildMenu();
		if (prefs.windows && prefs.windows.length > 0) {
			for (const snap of prefs.windows) {
				createWindow({ host: snap.host, bounds: snap.bounds, layout: snap, noTab: snap.noTab });
			}
		} else {
			createWindow({ host: prefs.use, bounds: prefs.bounds });
		}
		void firstCommand();
		app.on("activate", () => {
			const existing = targetWindow();
			if (existing) focusWindow(existing);
			else createWindow({ host: prefs.use, bounds: prefs.bounds });
		});
	});
	app.on("window-all-closed", () => {
		// On a Mac the app, and the daemon it started, stay when the window is closed.
		if (!isMac) app.quit();
	});
	app.on("before-quit", (e) => {
		if (quitting) return;
		syncOpenWindowsPrefs();
		savePrefs();
		quitting = true;
		terminals.closeAll();
		for (const es of streams.values()) es.controller.abort();
		streams.clear();
		// The connections to other machines end with the app, and a pine one started there with it.
		const going = [...held.values()].filter((s) => s.host || (s.started && !prefs.keepRunning));
		if (!going.length) return;
		// A daemon this app started ends with it, as the terminal UI's does: its agents are stopped
		// and its database closed before the app is gone.
		e.preventDefault();
		void Promise.all(going.map((s) => s.stop())).finally(() => app.quit());
	});
}
