// The app's main process. It owns three things the page must not: the daemon's token, the
// operating system (windows, menus, dialogs, notifications), and the child that is the daemon
// when this app had to start one. The page gets a narrow bridge (preload.ts) and nothing else.
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, type MenuItemConstructorOptions, nativeImage, nativeTheme, Notification, protocol, safeStorage, screen, session, shell } from "electron";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { csc } from "../../src/csharp.ts";
import { buildVoice, buildVoiceWindows, Listening, NO_CSC, NOT_HERE, voiceTools } from "../../src/tui/voice.ts";
import { BROWSER_SWITCHES, type Bounds, BrowserHost } from "./browser-host.ts";
import { type AccessChange, type AccessControl, type AccessPrefs, createAccessControl, readAccessPrefs } from "./access/control.ts";
import type { Cipher } from "./access/host.ts";
import { createAnnouncer, isPairAddress } from "./access/nearby.ts";
import { startStandIn } from "./access/stand-in.ts";
import { type Command, install, look, remove, said } from "./command.ts";
import { callDaemon, followEvents, mediaFromDaemon, pageCsp, VIEW_CSP } from "./daemon.ts";
import type { NewWindowOptions, WindowLayout } from "./preload.ts";
import { droppedHosts, notePrefs, readPrefsFile, setAside, writePrefsFile } from "./prefs-file.ts";
import { connect, connectSsh, findPine, hostOf, type Launch, loginEnv, onPath, pineRoot, pineVersion, readHosts, runPine, type Service, ServiceError } from "./service.ts";
import { fromWsl, install as installIntoWsl, toWsl } from "./wsl.ts";
import { wslDistros } from "../../src/remote.ts";
import { shellKeeps, Terminals } from "./terminal.ts";
import { makeUpdater } from "./updater.ts";
import { ahead, DOWNLOADS, LATEST, lookForUpdate, type Update } from "./updates.ts";
import { cleanLook, type Look } from "../src/theme.ts";

// `pine` in a terminal, from an AppImage (command.ts): the link in the PATH leads to the AppImage
// itself, whose folder under /tmp is another one at every start, and its runtime says by which name
// it was started. Started as `pine`, this is not the app but the launcher it carries: the app's pine
// on the app's Node, with the terminal's arguments, its input and its output.
if (process.platform === "linux" && process.env.APPIMAGE && path.basename(process.env.ARGV0 ?? "") === "pine") {
	const done = spawnSync(path.join(process.resourcesPath, "bin", "pine"), process.argv.slice(1).filter((a) => a !== "--no-sandbox"), { stdio: "inherit" });
	process.exit(done.status ?? 1);
}

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
const isWindows = process.platform === "win32";
/**
 * Tests only: the app runs without a screen. Its window is made and drawn like any other and never
 * shown, so it takes no place on the owner's screen, no click, key or pointer of theirs reaches it,
 * and it never comes to the front; the app has no place in the Dock. The page goes on drawing as it
 * does in a window in front (`backgroundThrottling` below), and a test reads and drives it through
 * the debugger (test/support/app.ts, which also keeps the app from the owner's notifications,
 * clipboard and browser).
 */
const HEADLESS = Boolean(process.env.PINE_DESKTOP_HEADLESS);
if (HEADLESS && isMac) app.setActivationPolicy("accessory");
/**
 * Tests only: browser access runs on its stand-in (access/stand-in.ts), which needs no network;
 * the value is how long its phone waits before it uses a pairing's link, in milliseconds. The
 * keychain is Chromium's mock one then, so that a test never writes into the owner's keychain.
 */
const ACCESS_STAND_IN = process.env.PINE_DESKTOP_ACCESS_STAND_IN;
if (ACCESS_STAND_IN !== undefined) app.commandLine.appendSwitch("use-mock-keychain");
// The agent's browser is in this window (browser-host.ts): what goes around its proxy is switched off for the app.
for (const [name, value] of BROWSER_SWITCHES) app.commandLine.appendSwitch(name, value);

// A second set of windows and data for tests and for trying things out beside the real app.
if (process.env.PINE_DESKTOP_DATA) app.setPath("userData", path.resolve(process.env.PINE_DESKTOP_DATA));
app.setName("Pine");
// Its notifications, its taskbar button and its installer's shortcut are one app on Windows: the appId pack.mjs gives it.
if (isWindows) app.setAppUserModelId("dev.pine.desktop");

protocol.registerSchemesAsPrivileged([
	// corsEnabled: the view frame (view.html) is sandboxed into an origin of its own, and loads its module scripts across it.
	{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
	{ scheme: "pine-media", privileges: { standard: true, secure: true, stream: true, bypassCSP: false } },
]);

// ---- preferences of the app itself (not pine's settings: those are the daemon's) -----------------

interface WindowBounds {
	x?: number;
	y?: number;
	width: number;
	height: number;
}

type ChromeLayout = Pick<WindowLayout, "sidebar" | "aside" | "view" | "order" | "widths" | "folded">;

interface WindowSnapshot {
	host?: string;
	bounds: WindowBounds;
	layout: WindowLayout;
	look?: Look;
	focused?: boolean;
}

interface Prefs {
	/** Another pine home than ~/.pine. */
	home?: string;
	/** A daemon this app started goes on when the app quits. */
	keepRunning: boolean;
	/** Other machines whose pine the app can use, each a host for ssh (Settings > Environments). */
	hosts: string[];
	/** The one of them the app uses; none: the pine of this computer. */
	use?: string;
	notify: boolean;
	/** Whether GitHub is asked for a newer app when this one starts. */
	updates: boolean;
	/** Whether a newer app is downloaded and installed when the app restarts or quits; off: the owner gets the link to its page. */
	autoUpdate: boolean;
	/** `pine` for a terminal was looked after once (see firstCommand): a link the owner removed stays removed. */
	commandTried: boolean;
	/**
	 * The theme the page was last drawn in, as pine resolved it and cleanLook made it safe: the window
	 * opens in it, and its frame (light or dark) and background follow it. None: pmndre.
	 */
	look?: Look;
	bounds?: WindowBounds;
	/** Last-used window chrome (panels, widths and folded side bar state), restored when opening without a saved window list. */
	layout?: ChromeLayout;
	/** Open windows at the time the app quit, restored on the next launch. */
	windows?: WindowSnapshot[];
	/** Browser access: on or off, the service's address, open at login (access/control.ts). The host key and the devices are a file of their own beside this one. */
	access: AccessPrefs;
}

const prefsFile = () => path.join(app.getPath("userData"), "prefs.json");
let prefs: Prefs = { keepRunning: false, hosts: [], notify: true, updates: true, autoUpdate: true, commandTried: false, access: readAccessPrefs(undefined) };

/**
 * Whether prefs.json may be written: not before it was read (what is in memory then is the defaults,
 * which would replace the owner's machines), and not over a file that could not be read and could
 * not be set aside.
 */
let prefsWritable = false;

function cleanBounds(raw: unknown): WindowBounds | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const b = raw as Record<string, unknown>;
	const width = Number(b.width);
	const height = Number(b.height);
	if (!(width > 300 && height > 200)) return undefined;
	const x = typeof b.x === "number" && Number.isFinite(b.x) ? Math.round(b.x) : undefined;
	const y = typeof b.y === "number" && Number.isFinite(b.y) ? Math.round(b.y) : undefined;
	return { ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}), width: Math.round(width), height: Math.round(height) };
}

function baseDefaultLayout(): WindowLayout {
	return { tabs: [], active: 0, sidebar: true, code: false, aside: false, view: false, order: ["view", "aside", "code"], widths: {}, folded: [] };
}

function pickChromeLayout(layout: WindowLayout): ChromeLayout {
	return {
		sidebar: layout.sidebar,
		aside: layout.aside,
		view: layout.view,
		order: layout.order ? [...layout.order] : undefined,
		widths: { ...layout.widths },
		folded: [...layout.folded],
	};
}

function defaultLayout(): WindowLayout {
	const base = baseDefaultLayout();
	if (!prefs.layout) return base;
	return {
		...base,
		sidebar: prefs.layout.sidebar,
		aside: prefs.layout.aside,
		view: prefs.layout.view,
		order: prefs.layout.order?.length ? [...prefs.layout.order] : base.order,
		widths: { ...prefs.layout.widths },
		folded: [...prefs.layout.folded],
	};
}

function cleanWindowLayout(raw: unknown, fallback: WindowLayout = baseDefaultLayout()): WindowLayout {
	if (!raw || typeof raw !== "object") return fallback;
	const r = raw as Record<string, unknown>;
	const tabs = Array.isArray(r.tabs)
		? r.tabs
				.filter((t): t is { agent: string; session: string } => Boolean(t && typeof t === "object" && typeof (t as any).agent === "string" && (t as any).agent && typeof (t as any).session === "string" && (t as any).session))
				.slice(0, 100)
				.map((t) => ({ agent: t.agent.slice(0, 120), session: t.session.slice(0, 200) }))
		: fallback.tabs;
	const active = typeof r.active === "number" && Number.isInteger(r.active) && r.active >= 0 ? r.active : fallback.active;
	const hasWidths = Boolean(r.widths && typeof r.widths === "object");
	const w = hasWidths ? (r.widths as Record<string, unknown>) : {};
	const px = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 120 && v <= 4000 ? Math.round(v) : undefined);
	const order = Array.isArray(r.order) ? r.order.filter((x): x is "code" | "aside" | "view" => x === "code" || x === "aside" || x === "view") : fallback.order;
	const folded = Array.isArray(r.folded) ? r.folded.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 240).slice(0, 500) : fallback.folded;
	return {
		tabs,
		active,
		noTab: typeof r.noTab === "boolean" ? r.noTab : fallback.noTab,
		sidebar: typeof r.sidebar === "boolean" ? r.sidebar : fallback.sidebar,
		code: typeof r.code === "boolean" ? r.code : fallback.code,
		aside: typeof r.aside === "boolean" ? r.aside : fallback.aside,
		view: typeof r.view === "boolean" ? r.view : fallback.view,
		order: order?.length ? [...new Set(order)] : ["view", "aside", "code"],
		widths: hasWidths
			? {
					sidebar: px(w.sidebar),
					code: px(w.code),
					aside: px(w.aside),
					view: px(w.view),
				}
			: { ...fallback.widths },
		folded,
	};
}

function cleanChromeLayout(raw: unknown): ChromeLayout | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	return pickChromeLayout(cleanWindowLayout(raw, baseDefaultLayout()));
}

function cleanWindowSnapshot(raw: unknown, hosts: string[]): WindowSnapshot | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const r = raw as Record<string, unknown>;
	const bounds = cleanBounds(r.bounds);
	if (!bounds) return undefined;
	const host = typeof r.host === "string" && hosts.includes(r.host) ? r.host : undefined;
	const lookValue = cleanLook(r.look);
	return {
		...(host ? { host } : {}),
		bounds,
		layout: cleanWindowLayout(r.layout, baseDefaultLayout()),
		...(lookValue ? { look: lookValue } : {}),
		...(r.focused === true ? { focused: true } : {}),
	};
}

function loadPrefs(): void {
	const read = readPrefsFile(prefsFile());
	if (read.unreadable) {
		const aside = setAside(prefsFile());
		notePrefs(prefsFile(), `prefs.json could not be read (${read.unreadable}): ${aside ? "set aside as prefs.json.unreadable, and the app starts from its defaults" : "left as it is, and nothing is saved over it until the app starts again"}`);
		prefsWritable = aside;
	} else prefsWritable = true;
	const raw = read.raw;
	if (raw) {
		const hosts = readHosts(raw.hosts);
		const savedWindows = Array.isArray(raw.windows)
			? raw.windows.map((w: unknown) => cleanWindowSnapshot(w, hosts)).filter((w: WindowSnapshot | undefined): w is WindowSnapshot => Boolean(w)).slice(0, 30)
			: undefined;
		prefs = {
			home: typeof raw.home === "string" && raw.home ? raw.home : undefined,
			keepRunning: raw.keepRunning === true,
			hosts,
			use: undefined,
			notify: raw.notify !== false,
			updates: raw.updates !== false,
			autoUpdate: raw.autoUpdate !== false,
			commandTried: raw.commandTried === true,
			look: cleanLook(raw.look),
			bounds: cleanBounds(raw.bounds),
			layout: cleanChromeLayout(raw.layout),
			windows: savedWindows,
			access: readAccessPrefs(raw.access),
		};
		// Only a machine that is in the list: what else might be written there is not connected to.
		if (typeof raw.use === "string" && prefs.hosts.includes(raw.use)) prefs.use = raw.use;
		for (const host of droppedHosts(raw.hosts, prefs.hosts)) notePrefs(prefsFile(), `machine ${host} left the list: it is not a host for ssh, or past the limit of 20`);
	}
	nativeTheme.themeSource = prefs.look?.kind ?? "dark";
}

const publicPrefs = () => ({ ...prefs, bounds: undefined, windows: undefined, layout: undefined });

/**
 * What the window shows before the page draws: the page color of the theme it was last drawn in
 * (pmndre's before there was one). On a Mac the window is transparent, behind its vibrancy.
 */
function windowBackground(lookValue: Look | undefined = prefs.look): string {
	if (isMac) return "#00000000";
	return (lookValue?.colors.bg ?? "#1b1e28").slice(0, 7);
}

/**
 * How tall the bar along the top of the page is (h-11 at the page's 15px, index.css): off a Mac the
 * system draws its window controls over the page at its top right (titleBarOverlay), as tall as it.
 */
const TITLE_BAR = 41;

/** The system's window controls off a Mac, in the theme's colors: on the bar's background (the page's `sunk`), drawn in its quieter text. */
function windowControls(lookValue: Look | undefined = prefs.look): { color: string; symbolColor: string; height: number } {
	const colors = lookValue?.colors;
	return { color: (colors?.sunk ?? "#171922").slice(0, 7), symbolColor: (colors?.["text-muted"] ?? colors?.text ?? "#a6accd").slice(0, 7), height: TITLE_BAR };
}

/** Repaints a window's background (and off a Mac its controls) for its theme; a no-op once destroyed. */
function refreshBackground(entry: WindowEntry): void {
	if (entry.win.isDestroyed()) return;
	const lookValue = entry.look ?? prefs.look;
	entry.win.setBackgroundColor(windowBackground(lookValue));
	if (!isMac) entry.win.setTitleBarOverlay(windowControls(lookValue));
}

function savePrefs(): void {
	if (!prefsWritable) return;
	try {
		writePrefsFile(prefsFile(), prefs);
	} catch {
		// a preference that is not kept is not worth an error
	}
}

// ---- windows and daemons -----------------------------------------------------------------------

type ServiceState = { status: "starting"; host?: string } | { status: "ready"; mode: string; started: boolean; home: string; version?: string; from: string; host?: string; label?: string; olderThan?: string } | { status: "error"; kind: ServiceError["kind"]; message: string; host?: string };

type BootMode = "daemon" | "no-tab" | "tab" | "restore";

interface WindowEntry {
	id: string;
	win: BrowserWindow;
	readyToShow: boolean;
	wantFocus: boolean;
	closing: boolean;
	forgetting: boolean;
	loadingDaemonTabs: boolean;
	focused: boolean;
	/** Whether the owner's terminal in this window has the keyboard, as the page says (`pine:term-focus`). */
	terminalFocused: boolean;
	lastFocusedAt: number;
	pageReady: boolean;
	pendingCommands: string[];
	host: string | undefined;
	service?: Service;
	state: ServiceState;
	round: number;
	bootMode: BootMode;
	initialTab?: { agent: string; session: string };
	initialDraft?: { draft: string; attachments: Array<{ name: string; size: number; data: string; preview?: string }> };
	look?: Look;
	bounds: WindowBounds;
	layout: WindowLayout;
}

const windows = new Map<string, WindowEntry>();
let nextWindowId = 1;
let focusClock = 0;
let launch: Launch | undefined;
let quitting = false;
let listening: Listening | undefined;
let voiceOwner: WindowEntry | undefined;
let voiceRound = 0;

const validHost = (host: string | undefined) => (host && prefs.hosts.includes(host) ? host : undefined);

/** Active window for menus, cascades and fallback routing: OS-focused, else tracked-focused, else most recently active. */
function targetWindow(predicate?: (w: WindowEntry) => boolean): WindowEntry | undefined {
	const open = [...windows.values()].filter((w) => !w.closing && !w.win.isDestroyed() && (!predicate || predicate(w)));
	if (!open.length) return undefined;
	const osFocused = BrowserWindow.getFocusedWindow();
	if (osFocused) {
		const hit = open.find((w) => w.win === osFocused);
		if (hit) return hit;
	}
	const focused = open.find((w) => w.focused);
	if (focused) return focused;
	return open.reduce((best, w) => (w.lastFocusedAt >= best.lastFocusedAt ? w : best));
}

function sendTo(entry: WindowEntry | undefined, channel: string, ...args: unknown[]): void {
	if (entry && !entry.win.isDestroyed()) entry.win.webContents.send(channel, ...args);
}

function broadcast(channel: string, ...args: unknown[]): void {
	for (const entry of windows.values()) sendTo(entry, channel, ...args);
}

function sendCommand(entry: WindowEntry, command: string): void {
	if (entry.pageReady) sendTo(entry, "pine:menu", command);
	else entry.pendingCommands.push(command);
}

/** Routes a local-computer OS action (`folder:...`, `pairing-shown`, `add-device`) to the most recently active local window, opening one if needed. */
function withLocalWindow(command: string): WindowEntry {
	const existing = targetWindow((w) => w.host === undefined);
	if (existing) {
		showWindow(existing);
		sendCommand(existing, command);
		return existing;
	}
	const created = openWindow({ from: targetWindow(), host: null });
	showWindow(created);
	sendCommand(created, command);
	persistOpenWindows();
	return created;
}

function openHostsFor(caller: WindowEntry): string[] {
	const out: string[] = [];
	for (const w of windows.values()) {
		if (w !== caller && !w.closing && !w.win.isDestroyed() && typeof w.host === "string") out.push(w.host);
	}
	return out;
}

function notifyOpenHosts(): void {
	for (const w of windows.values()) {
		if (!w.win.isDestroyed()) sendTo(w, "pine:open-hosts", openHostsFor(w));
	}
}

function notifyPrefs(): void {
	const base = publicPrefs();
	for (const w of windows.values()) {
		if (!w.win.isDestroyed()) sendTo(w, "pine:prefs", { ...base, look: w.look ?? prefs.look });
	}
}

function snapshotOpenWindows(): WindowSnapshot[] {
	const primary = targetWindow();
	const out: WindowSnapshot[] = [];
	for (const w of windows.values()) {
		if (w.closing || w.win.isDestroyed()) continue;
		const bounds = w.win.isMinimized() || w.win.isFullScreen() ? w.bounds : w.win.getBounds();
		w.bounds = bounds;
		out.push({
			...(w.host ? { host: w.host } : {}),
			bounds,
			layout: w.layout,
			...(w.look ? { look: w.look } : {}),
			...(w === primary ? { focused: true } : {}),
		});
	}
	return out;
}

function persistOpenWindows(): void {
	if (quitting) return;
	prefs.windows = snapshotOpenWindows();
	const front = targetWindow();
	if (front) {
		prefs.use = validHost(front.host);
		prefs.bounds = front.bounds;
		prefs.layout = pickChromeLayout(front.layout);
	}
	savePrefs();
}

function windowHoldsConversation(w: WindowEntry, agent: string, session: string): boolean {
	if (w.initialTab && w.initialTab.agent === agent && w.initialTab.session === session) return true;
	return w.layout.tabs.some((t) => t.agent === agent && t.session === session);
}

function unionTabsFor(host: string | undefined, primary?: WindowEntry): Array<{ agent: string; session: string }> {
	const seen = new Set<string>();
	const out: Array<{ agent: string; session: string }> = [];
	const add = (t: { agent: string; session: string }) => {
		const key = `${t.agent}:${t.session}`;
		if (seen.has(key)) return;
		seen.add(key);
		out.push({ agent: t.agent, session: t.session });
	};
	const ordered = [...windows.values()].filter((w) => !w.closing && !w.win.isDestroyed() && w.host === host);
	if (primary && ordered.includes(primary)) {
		ordered.splice(ordered.indexOf(primary), 1);
		ordered.unshift(primary);
	}
	for (const w of ordered) {
		if (w.initialTab) add(w.initialTab);
		for (const t of w.layout.tabs) add(t);
	}
	return out;
}

function syncRemainingUnion(host: string | undefined): void {
	if (quitting) return;
	const onHost = [...windows.values()].filter((w) => !w.closing && !w.win.isDestroyed() && w.host === host);
	if (!onHost.length || onHost.some((w) => w.loadingDaemonTabs)) return;
	const remaining = targetWindow((w) => w.host === host);
	const s = remaining?.service ?? held.get(host ?? "");
	if (!remaining || !s) return;
	void callDaemon(s, "POST", "/ui/tabs", {
		tabs: unionTabsFor(host, remaining),
		active: remaining.layout.active,
		code: remaining.layout.code,
	});
}

function closeOrphanedSessions(s: Service | undefined, host: string | undefined, previousTabs: Array<{ agent: string; session: string }>, excludeWindow: WindowEntry): void {
	if (!s || quitting || !previousTabs.length) return;
	const remaining = [...windows.values()].filter((w) => w !== excludeWindow && !w.closing && !w.win.isDestroyed() && w.host === host);
	if (!remaining.length || remaining.some((w) => w.loadingDaemonTabs)) return;
	const seen = new Set<string>();
	for (const t of previousTabs) {
		if (!t.agent || !t.session || t.session === "main") continue;
		const key = `${t.agent}:${t.session}`;
		if (seen.has(key)) continue;
		seen.add(key);
		if (remaining.some((w) => windowHoldsConversation(w, t.agent, t.session))) continue;
		void callDaemon(s, "POST", `/agents/${encodeURIComponent(t.agent)}/close`, { session: t.session }).catch(() => {});
	}
}

/**
 * The version of the pine this app runs (the one it carries, in a packed app) when the daemon of
 * this computer it attached to says an older one, by the rule of the update check. A daemon the
 * app started, another machine's, or one on the same or a newer version: undefined.
 */
function olderThan(s: Service, host: string | undefined): string | undefined {
	if (host || s.started || !s.version || !launch) return undefined;
	const mine = pineVersion(launch);
	return mine && ahead(mine, s.version) ? mine : undefined;
}

/** The agents' browsers: for this computer's pine only, whose browser servers can reach it. */
const browsers = new BrowserHost({
	isFocused: (win) => {
		const osFocused = BrowserWindow.getFocusedWindow();
		if (osFocused) return osFocused === win;
		for (const entry of windows.values()) {
			if (entry.win === win) return entry.focused;
		}
		return false;
	},
	onPreempted: (w) => {
		const owner = [...windows.values()].find((x) => x.win === w);
		if (owner) sendTo(owner, "pine:browser-preempted");
	},
});

/** The owner's terminal of each conversation (terminal.ts): their own shell per window, which ends with its window or the app. */
// A block run with a Run button reports how it went to the page, which tells the conversation through the daemon.
const terminals = new Terminals(
	{
		data: (id, data, windowId) => {
			const w = windows.get(windowId);
			if (w && !w.host) sendTo(w, "pine:term-data", id, data);
		},
		exit: (id, code, windowId) => {
			const w = windows.get(windowId);
			if (w && !w.host) sendTo(w, "pine:term-exit", id, code);
		},
		run: (id, report, windowId) => {
			const w = windows.get(windowId);
			if (w && !w.host) sendTo(w, "pine:term-run", id, report);
		},
	},
	{ env: loginEnv, hooks: path.join(app.getPath("userData"), "shell-hooks"), shell: process.env.PINE_DESKTOP_SHELL ? [process.env.PINE_DESKTOP_SHELL] : undefined, stillRunningMs: Number(process.env.PINE_DESKTOP_STILL_RUNNING_MS) || undefined },
);


/**
 * The pines this app holds: this computer's ("") and each machine's it used, by host. Switching
 * changes which one a window shows and lets go of none, so that an agent at work in one goes on
 * while another is shown. They are let go of when the app quits.
 */
const held = new Map<string, Service>();
const connecting = new Map<string, Promise<Service>>();

interface ServiceStream {
	abort: AbortController;
	connected: boolean;
	taskSession: Map<number, { agent: string; session: string }>;
	openApprovals: Set<string>;
	approvalPayloads: Map<string, Record<string, unknown>>;
	approvalSessions: Map<string, { agent: string; session: string }>;
	approvalOwners: Map<string, Set<string>>;
	queue: Promise<void>;
}

const serviceStreams = new Map<Service, ServiceStream>();
let lastBadgeCount = 0;
const recentNotifications = new Map<string, number>();

function refreshAppBadge(): void {
	let total = 0;
	for (const [s, record] of serviceStreams) {
		if ([...windows.values()].some((w) => !w.closing && !w.win.isDestroyed() && w.service === s)) {
			total += record.openApprovals.size;
		}
	}
	if (total === lastBadgeCount) return;
	lastBadgeCount = total;
	if (isMac) app.dock?.setBadge(total > 0 ? String(total) : "");
	// Windows has no number on a taskbar button: a dot over its icon says that something waits.
	else if (isWindows) {
		for (const w of windows.values()) {
			if (!w.closing && !w.win.isDestroyed()) w.win.setOverlayIcon(total > 0 ? waiting(w.look) : null, total > 0 ? `${total} waiting for you` : "");
		}
	} else app.setBadgeCount(total);
}

function recipientsForConversation(s: Service, agent: string, sessionName: string): WindowEntry[] {
	const onService = [...windows.values()].filter((w) => !w.closing && !w.win.isDestroyed() && w.service === s);
	const holders = onService.filter((w) => windowHoldsConversation(w, agent, sessionName));
	if (holders.length) return holders;
	const primary = targetWindow((w) => w.service === s);
	return primary ? [primary] : [];
}

async function resolveApprovalSession(s: Service, record: ServiceStream, p: Record<string, unknown>): Promise<{ agent: string; session: string } | undefined> {
	const rootTask = typeof p.root === "number" ? p.root : typeof p.task === "number" ? p.task : undefined;
	if (rootTask === undefined) return undefined;
	const known = record.taskSession.get(rootTask);
	if (known) return known;
	const res = await callDaemon(s, "GET", `/tasks/${rootTask}`);
	if (res.ok && res.data && typeof res.data.agent === "string" && typeof res.data.session === "string") {
		const found = { agent: res.data.agent, session: res.data.session };
		record.taskSession.set(rootTask, found);
		return found;
	}
	return undefined;
}

function hasLiveApprovalOwner(s: Service, owners: Set<string> | undefined): boolean {
	if (!owners) return false;
	for (const id of owners) {
		const w = windows.get(id);
		if (w && !w.closing && !w.win.isDestroyed() && (w.service === s || (!w.service && w.host === s.host && w.state.status === "starting"))) return true;
	}
	return false;
}

function rehomeServiceApprovals(s: Service | undefined, leavingWindowId: string): void {
	if (!s || quitting) return;
	const record = serviceStreams.get(s);
	if (!record || !record.openApprovals.size) return;
	const stranded: string[] = [];
	for (const id of record.openApprovals) {
		const owners = record.approvalOwners.get(id);
		owners?.delete(leavingWindowId);
		if (!hasLiveApprovalOwner(s, owners)) stranded.push(id);
	}
	if (!stranded.length) return;
	const hasRemaining = [...windows.values()].some((w) => !w.closing && !w.win.isDestroyed() && w.service === s);
	if (!hasRemaining) return;
	record.queue = record.queue
		.then(async () => {
			if (record.abort.signal.aborted || quitting) return;
			if (stranded.some((id) => record.openApprovals.has(id) && !record.approvalPayloads.has(id))) {
				const res = await callDaemon(s, "GET", "/approvals");
				if (res.ok && Array.isArray(res.data)) {
					const openIds = new Set<string>();
					for (const item of res.data) {
						if (item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string") {
							const obj = item as Record<string, unknown>;
							const reqId = obj.id as string;
							openIds.add(reqId);
							record.approvalPayloads.set(reqId, obj);
						}
					}
					record.openApprovals = openIds;
					refreshAppBadge();
				}
			}
			if (record.abort.signal.aborted || quitting) return;
			const buckets = new Map<WindowEntry, unknown[]>();
			for (const id of stranded) {
				if (!record.openApprovals.has(id)) continue;
				if (hasLiveApprovalOwner(s, record.approvalOwners.get(id))) continue;
				const req = record.approvalPayloads.get(id);
				if (!req) continue;
				const sessionInfo = record.approvalSessions.get(id) ?? (await resolveApprovalSession(s, record, req));
				if (sessionInfo) record.approvalSessions.set(id, sessionInfo);
				const targets = sessionInfo ? recipientsForConversation(s, sessionInfo.agent, sessionInfo.session) : [targetWindow((w) => w.service === s)].filter((w): w is WindowEntry => Boolean(w));
				if (!targets.length) continue;
				record.approvalOwners.set(id, new Set(targets.map((w) => w.id)));
				const synthetic = { id: 0, ts: Date.now(), topic: "approval/requested", source: "pine", payload: req };
				for (const w of targets) {
					if (w.closing || w.win.isDestroyed() || w.service !== s) continue;
					let list = buckets.get(w);
					if (!list) buckets.set(w, (list = []));
					list.push(synthetic);
				}
			}
			for (const [w, list] of buckets) {
				if (list.length) sendTo(w, "pine:events", list);
			}
		})
		.catch(() => {});
}

async function dispatchServiceBatch(s: Service, record: ServiceStream, events: unknown[]): Promise<void> {
	if (record.abort.signal.aborted) return;
	for (const raw of events) {
		const e = raw as { topic?: unknown; payload?: unknown };
		if (typeof e?.topic !== "string" || !e.topic.startsWith("agent/") || !e.topic.endsWith("/started")) continue;
		const p = (e.payload ?? {}) as Record<string, unknown>;
		if ((p.depth ?? 0) === 0 && typeof p.task === "number" && typeof p.agent === "string" && typeof p.session === "string") {
			if (record.taskSession.size > 2000) {
				const oldest = record.taskSession.keys().next().value;
				if (oldest !== undefined) record.taskSession.delete(oldest);
			}
			record.taskSession.set(p.task, { agent: p.agent, session: p.session });
		}
	}

	const onService = () => [...windows.values()].filter((w) => !w.closing && !w.win.isDestroyed() && w.service === s);
	const buckets = new Map<WindowEntry, unknown[]>();
	const push = (targets: WindowEntry[], item: unknown) => {
		for (const w of targets) {
			if (w.closing || w.win.isDestroyed() || w.service !== s) continue;
			let list = buckets.get(w);
			if (!list) buckets.set(w, (list = []));
			list.push(item);
		}
	};

	for (const raw of events) {
		const e = raw as { topic?: unknown; payload?: unknown };
		const topic = typeof e?.topic === "string" ? e.topic : "";
		const p = (e?.payload ?? {}) as Record<string, unknown>;
		if (topic === "approval/requested") {
			const sessionInfo = await resolveApprovalSession(s, record, p);
			const targets = sessionInfo ? recipientsForConversation(s, sessionInfo.agent, sessionInfo.session) : [targetWindow((w) => w.service === s)].filter((w): w is WindowEntry => Boolean(w));
			if (typeof p.id === "string") {
				record.openApprovals.add(p.id);
				record.approvalPayloads.set(p.id, p);
				if (sessionInfo) record.approvalSessions.set(p.id, sessionInfo);
				record.approvalOwners.set(p.id, new Set(targets.map((w) => w.id)));
				refreshAppBadge();
			}
			push(targets, raw);
		} else if (topic === "approval/decided") {
			if (typeof p.id === "string") {
				record.openApprovals.delete(p.id);
				record.approvalPayloads.delete(p.id);
				record.approvalSessions.delete(p.id);
				record.approvalOwners.delete(p.id);
				refreshAppBadge();
			}
			push(onService(), raw);
		} else if (topic === "pine/conversation" && p.change === "open") {
			const agent = String(p.agent ?? "");
			const sessionName = String(p.session ?? "main") || "main";
			push(recipientsForConversation(s, agent, sessionName), raw);
		} else {
			push(onService(), raw);
		}
	}

	if (record.abort.signal.aborted) return;
	for (const [w, list] of buckets) {
		if (list.length) sendTo(w, "pine:events", list);
	}
}

function setWindowState(entry: WindowEntry, next: ServiceState): void {
	if (next.status === "error") entry.loadingDaemonTabs = false;
	entry.state = next;
	sendTo(entry, "pine:service", next);
}

function ensureServiceStream(s: Service): void {
	if (serviceStreams.has(s)) return;
	const abort = new AbortController();
	const record: ServiceStream = { abort, connected: false, taskSession: new Map(), openApprovals: new Set(), approvalPayloads: new Map(), approvalSessions: new Map(), approvalOwners: new Map(), queue: Promise.resolve() };
	serviceStreams.set(s, record);
	followEvents(s, abort.signal, {
		batch: (events) => {
			record.queue = record.queue.then(() => dispatchServiceBatch(s, record, events)).catch(() => {});
		},
		connection: (up) => {
			record.connected = up;
			for (const w of windows.values()) if (w.service === s) sendTo(w, "pine:connection", up);
		},
		lost: (times) => {
			if (times !== 5 || !(s.started || s.host) || quitting) return false;
			abort.abort();
			serviceStreams.delete(s);
			refreshAppBadge();
			if (held.get(s.host ?? "") === s) held.delete(s.host ?? "");
			void letGo(s);
			for (const w of windows.values()) {
				if (!w.closing && !w.win.isDestroyed() && w.host === s.host) void startWindowService(w);
			}
			return true;
		},
	});
}

function releaseUnusedStreams(): void {
	for (const [s, record] of serviceStreams) {
		const used = [...windows.values()].some((w) => !w.closing && !w.win.isDestroyed() && (w.service === s || (!w.service && w.host === s.host && w.state.status === "starting")));
		if (!used) {
			record.abort.abort();
			serviceStreams.delete(s);
		}
	}
	refreshAppBadge();
}

async function startWindowService(entry: WindowEntry): Promise<void> {
	const mine = ++entry.round;
	const host = entry.host;
	entry.service = undefined;
	releaseUnusedStreams();
	setWindowState(entry, { status: "starting", host });
	try {
		const s = await hold(host);
		if (mine !== entry.round || entry.win.isDestroyed()) return;
		entry.service = s;
		ensureServiceStream(s);
		setWindowState(entry, { status: "ready", mode: s.mode, started: s.started, home: s.home, version: s.version, from: host ? (host.startsWith("wsl:") ? `wsl ${host.slice(4)}` : `ssh ${host}`) : (launch?.from ?? ""), host: s.host, label: s.label, olderThan: olderThan(s, host) });
		const stream = serviceStreams.get(s);
		if (stream?.connected) sendTo(entry, "pine:connection", true);
	} catch (e) {
		if (mine !== entry.round || entry.win.isDestroyed()) return;
		setWindowState(entry, { status: "error", kind: e instanceof ServiceError ? e.kind : "failed", message: e instanceof Error ? e.message : String(e), host });
	}
}

/** The WSL distribution whose pine a window uses now, if it uses one. */
const wslOf = (host: string | undefined) => (host?.startsWith("wsl:") ? host.slice(4) : undefined);

/** A path of this computer as a window's daemon knows it: the same, or under /mnt in WSL (undefined where WSL cannot reach it). */
const forDaemon = (p: string, host: string | undefined) => {
	const d = wslOf(host);
	return d ? toWsl(p, d) : p;
};

/**
 * The pine of a machine (none: this computer's) as the app holds it: the one held from before when
 * it answers still, else one made anew and held. The window uses it, and browser access for this
 * computer's, also while the window shows another machine's pine.
 */
async function hold(host: string | undefined): Promise<Service> {
	const key = host ?? "";
	let s = held.get(key);
	// One held from before answers still: it is used again at once. One that does not is let go of and made anew.
	if (s && !(await answers(s))) {
		const dead = serviceStreams.get(s);
		if (dead) {
			dead.abort.abort();
			serviceStreams.delete(s);
		}
		if (held.get(key) === s) held.delete(key);
		void letGo(s);
		s = undefined;
	}
	if (s) return s;
	let pending = connecting.get(key);
	if (!pending) {
		pending = (async () => {
			const made = host ? await connectSsh(host, await loginEnv()) : await connect((launch = await findPine(APP_ROOT, app.isPackaged ? process.resourcesPath : undefined)), { home: prefs.home ?? process.env.PINE_HOME, keep: prefs.keepRunning });
			const first = held.get(key);
			if (first) {
				void letGo(made);
				return first;
			}
			held.set(key, made);
			return made;
		})().finally(() => {
			if (connecting.get(key) === pending) connecting.delete(key);
		});
		connecting.set(key, pending);
	}
	return pending;
}

/** Whether a pine still answers: one on another machine may have lost its connection meanwhile. */
const answers = (s: Service) => fetch(`${s.base}/health`, { signal: AbortSignal.timeout(2500) }).then((r) => r.ok, () => false);

/** Lets go of a pine: the SSH connection to another machine ends (and a pine it started there); one this app started here stops, unless it is to go on. */
async function letGo(s: Service | undefined): Promise<void> {
	if (!s) return;
	const stream = serviceStreams.get(s);
	if (stream) {
		stream.abort.abort();
		serviceStreams.delete(s);
	}
	if (s.host || (s.started && !prefs.keepRunning)) await s.stop();
}

/** A window switches to another pine: this computer's (no host) or a machine's of the list. */
async function use(entry: WindowEntry, host: string | undefined): Promise<void> {
	if (host !== undefined && !prefs.hosts.includes(host)) throw new Error("That machine is not in the list: add it in Settings > Environments.");
	if (host === entry.host && entry.service) return;
	if (host !== undefined) browsers.detachWindow(entry.win);
	const previousHost = entry.host;
	const previousService = entry.service ?? held.get(previousHost ?? "");
	const previousTabs = [...(entry.initialTab ? [entry.initialTab] : []), ...entry.layout.tabs];
	entry.host = host;
	entry.service = undefined;
	entry.initialTab = undefined;
	entry.loadingDaemonTabs = true;
	entry.layout = { ...entry.layout, tabs: [], active: 0, noTab: false };
	prefs.use = validHost(host);
	savePrefs();
	syncRemainingUnion(previousHost);
	closeOrphanedSessions(previousService, previousHost, previousTabs, entry);
	rehomeServiceApprovals(previousService, entry.id);
	notifyOpenHosts();
	if (host !== undefined) terminals.closeWindow(entry.id);
	await startWindowService(entry);
}

/** A picture, video or sound of the daemon's, for the page's `pine-media:` addresses. */
async function media(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const id = url.hostname.startsWith("window-") ? url.hostname.slice("window-".length) : undefined;
	const target = id ? windows.get(id)?.service : targetWindow()?.service;
	return mediaFromDaemon(target, request.method, url.pathname, url.search);
}

// ---- browser access ----------------------------------------------------------------------------

/** The keychain's encryption (Electron's safe storage), where it can be used. */
function keychain(): Cipher | undefined {
	// Tests only: Linux without a keyring (a test runner's virtual screen) has the plain store Chromium
	// falls back to, where a Mac's tests have the mock keychain. For the owner it stays refused: a key
	// "encrypted" with a password everybody knows is not kept safe.
	if (ACCESS_STAND_IN !== undefined && process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") safeStorage.setUsePlainTextEncryption(true);
	if (!safeStorage.isEncryptionAvailable()) return undefined;
	return { seal: (text) => safeStorage.encryptString(text), open: (bytes) => safeStorage.decryptString(bytes) };
}

/** A device was added: said under the app's notification preference, even while the window is in front (a yes given by mistake is to be noticed). */
function notifyPaired(name: string): void {
	if (!prefs.notify || !Notification.isSupported()) return;
	const n = new Notification({ title: "Browser access", body: `${name} can now access Pine.`.slice(0, 160), silent: false });
	n.on("click", () => showWindow(targetWindow() ?? openWindow()));
	n.show();
}

/**
 * A device asks to connect (with a pairing's code, or from the network without one): while no window
 * is in front, the system says so with the device's name and the four digits.
 */
function notifyAsked(request: { name: string; code: string }): void {
	if (!Notification.isSupported() || [...windows.values()].some((w) => !w.win.isDestroyed() && w.win.isVisible() && w.win.isFocused())) return;
	const n = new Notification({ title: `${request.name} wants to connect`.slice(0, 80), body: `Allow it in Pine if the device shows ${request.code}.`, silent: false });
	n.on("click", () => showWindow(targetWindow() ?? openWindow()));
	n.show();
}

/** This computer on the local network (access/nearby.ts); a test's stand-in host announces nothing. */
const announcer = createAnnouncer();

/**
 * Browser access (access/control.ts), made when the app is ready. Its daemon is this computer's,
 * held as the window holds it: it ends when the app quits, or goes on with "keep pine running".
 */
let access: AccessControl | undefined;

function startAccess(): void {
	access = createAccessControl({
		folder: app.getPath("userData"),
		cipher: keychain,
		prefs: {
			read: () => prefs.access,
			write: (next) => {
				prefs.access = next;
				savePrefs();
			},
		},
		daemon: async () => {
			const s = await hold(undefined);
			return JSON.stringify({ base: s.base, token: s.token, mode: s.mode, started: s.started, home: s.home, version: s.version });
		},
		loginItem: (open) => app.setLoginItemSettings({ openAtLogin: open }),
		paired: (device) => notifyPaired(device.name),
		changed: (s) => broadcast("pine:access", s),
		asked: notifyAsked,
		announce: ACCESS_STAND_IN !== undefined ? undefined : (what) => announcer.announce(what),
		start: ACCESS_STAND_IN !== undefined ? (options) => startStandIn({ ...options, waitMs: Number(ACCESS_STAND_IN) || undefined }) : undefined,
	});
	accessStarted = access.start();
}

/** The access host's start, which an address handed to the app before it was up waits for. */
let accessStarted: Promise<void> | undefined;

/**
 * `pine://pair`, from the web client's "Open Pine on this computer" (ADR 0005).
 */
async function pairFromAddress(url: string): Promise<boolean> {
	if (!isPairAddress(url)) return false;
	await accessStarted;
	if (!access) return false;
	const now = await access.state();
	if (!now.enabled || now.status === "off") return false;
	if (now.pairing || now.request) return false;
	const opened = await access.openPairing().catch(() => undefined);
	if (!opened) return false;
	openOutside(opened.link);
	if (appReady) withLocalWindow("pairing-shown");
	else pairingShown = true;
	return true;
}
let pairingShown = false;
/** Addresses the system handed the app before browser access existed (`open-url` on a cold start). */
const pendingAddresses: string[] = [];

/** Where the app is the system's handler of `pine:`: a packed app, or a checkout that asks for it. Never in a test. */
function registerScheme(): void {
	if (HEADLESS || ACCESS_STAND_IN !== undefined || process.env.PINE_DESKTOP_DATA) return;
	if (app.isPackaged) app.setAsDefaultProtocolClient("pine");
	else if (process.env.PINE_DESKTOP_PROTOCOL) app.setAsDefaultProtocolClient("pine", process.execPath, [APP_ROOT]);
}

/** What the page may ask to change, value by value. */
function accessChange(raw: unknown): AccessChange {
	const said = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const relay = said.relay && typeof said.relay === "object" ? (said.relay as Record<string, unknown>) : undefined;
	const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 400) : undefined);
	return {
		...(typeof said.enabled === "boolean" ? { enabled: said.enabled } : {}),
		...(typeof said.openAtLogin === "boolean" ? { openAtLogin: said.openAtLogin } : {}),
		...(typeof said.service === "string" ? { service: said.service.slice(0, 400) } : {}),
		...(relay && typeof relay.address === "string" ? { relay: { address: relay.address.slice(0, 400), username: text(relay.username), password: text(relay.password) } } : {}),
	};
}

const accessOn = () => {
	if (!access) throw new Error("Browser access is not ready yet.");
	return access;
};

// ---- the page ----------------------------------------------------------------------------------

// The page may hold one kind of frame: the app's own view.html, which runs a view (View.tsx).
const CSP = pageCsp({ frame: ["app://pine/view.html"] });

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".map": "application/json" };

function page(request: Request): Response {
	const dist = path.join(APP_ROOT, "dist");
	const url = new URL(request.url);
	const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
	const file = path.normalize(path.join(dist, rel));
	if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response("not found", { status: 404 });
	const view = rel === "/view.html";
	return new Response(fs.readFileSync(file), { headers: { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "content-security-policy": view ? VIEW_CSP : CSP, "x-content-type-options": "nosniff", ...(/\.(js|css)$/.test(file) ? { "access-control-allow-origin": "*" } : {}) } });
}

function entryFromEvent(e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): WindowEntry | undefined {
	const frame = e.senderFrame;
	if (!frame || originOf(frame.url) !== ORIGIN) return undefined;
	for (const entry of windows.values()) {
		if (!entry.win.isDestroyed() && e.sender === entry.win.webContents && frame === entry.win.webContents.mainFrame) return entry;
	}
	return undefined;
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

function cascadeBounds(from: Electron.Rectangle): Electron.Rectangle {
	const area = screen.getDisplayMatching(from).workArea;
	const width = Math.min(from.width, area.width);
	const height = Math.min(from.height, area.height);
	const maxX = Math.max(area.x, area.x + area.width - width);
	const maxY = Math.max(area.y, area.y + area.height - height);
	return {
		x: Math.max(area.x, Math.min(from.x + 24, maxX)),
		y: Math.max(area.y, Math.min(from.y + 24, maxY)),
		width,
		height,
	};
}

interface OpenWindowInit {
	from?: WindowEntry;
	host?: string | null;
	bounds?: WindowBounds;
	bootMode?: BootMode;
	tab?: { agent: string; session: string };
	draft?: { draft: string; attachments: Array<{ name: string; size: number; data: string; preview?: string }> };
	moveFrom?: boolean;
	layout?: WindowLayout;
	look?: Look;
	wantFocus?: boolean;
}

function openWindow(init: OpenWindowInit = {}): WindowEntry {
	const id = String(nextWindowId++);
	const fallbackUse = prefs.use && prefs.hosts.includes(prefs.use) ? prefs.use : undefined;
	const inheritedHost = init.from?.host && prefs.hosts.includes(init.from.host) ? init.from.host : undefined;
	const host = init.host === null ? undefined : init.host !== undefined ? init.host : init.from ? inheritedHost : fallbackUse;
	if (host !== undefined && !prefs.hosts.includes(host)) throw new Error("That machine is not in the list: add it in Settings > Environments.");
	const hasOpenWindow = [...windows.values()].some((w) => !w.closing && !w.win.isDestroyed());
	const environmentOpen = [...windows.values()].some((w) => !w.closing && !w.win.isDestroyed() && w.host === host);
	const bootMode: BootMode = init.bootMode ?? (init.tab ? "tab" : environmentOpen ? "no-tab" : "daemon");
	const sourceBounds = init.from && !init.from.win.isDestroyed() ? init.from.win.getBounds() : undefined;
	const b = init.bounds ?? (sourceBounds ? cascadeBounds(sourceBounds) : prefs.bounds);
	const lookValue = init.look ?? init.from?.look ?? prefs.look;
	const seedLayout = hasOpenWindow ? baseDefaultLayout() : defaultLayout();

	const win = new BrowserWindow({
		width: b?.width ?? 1280,
		height: b?.height ?? 820,
		x: b?.x,
		y: b?.y,
		minWidth: 360,
		minHeight: 480,
		show: false,
		title: "Pine",
		// Off a Mac the page reaches the top too, and the system draws its window controls over its top right
		// (in the theme's colors, refreshBackground). Its menus are then not shown, and their keys still work.
		titleBarStyle: isMac ? "hiddenInset" : "hidden",
		trafficLightPosition: { x: 16, y: 16 },
		// Gives the page where the window buttons are (env(titlebar-area-x) and -width, 0 in full screen), so the bars make room for them by themselves.
		titleBarOverlay: isMac ? true : windowControls(lookValue),
		vibrancy: isMac ? "sidebar" : undefined,
		visualEffectState: "followWindow",
		backgroundColor: windowBackground(lookValue),
		webPreferences: {
			preload: path.join(HERE, "preload.cjs"),
			additionalArguments: [`--pine-window=${id}`],
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			webSecurity: true,
			spellcheck: true,
			navigateOnDragDrop: false,
			...(HEADLESS ? { backgroundThrottling: false } : {}),
		},
	});

	const entry: WindowEntry = {
		id,
		win,
		readyToShow: false,
		wantFocus: init.wantFocus !== false,
		closing: false,
		forgetting: false,
		loadingDaemonTabs: bootMode === "daemon",
		focused: Boolean(win.isFocused()),
		terminalFocused: false,
		lastFocusedAt: ++focusClock,
		pageReady: false,
		pendingCommands: [],
		host,
		state: { status: "starting", host },
		round: 0,
		bootMode,
		initialTab: init.tab,
		initialDraft: init.draft,
		look: lookValue,
		bounds: win.getBounds(),
		layout: init.layout ? cleanWindowLayout(init.layout, baseDefaultLayout()) : { ...seedLayout, ...(bootMode === "no-tab" ? { noTab: true } : init.tab ? { tabs: [init.tab], active: 0 } : {}) },
	};
	windows.set(id, entry);

	win.once("ready-to-show", () => {
		entry.readyToShow = true;
		if (HEADLESS || win.isDestroyed() || entry.closing) return;
		if (entry.wantFocus) {
			win.show();
			win.focus();
		} else {
			win.showInactive();
		}
	});
	win.webContents.setWindowOpenHandler(({ url }) => (openOutside(url), { action: "deny" }));
	win.webContents.on("will-navigate", (e, url) => {
		if (originOf(url) !== ORIGIN) {
			e.preventDefault();
			openOutside(url);
		}
	});
	win.webContents.on("will-attach-webview", (e) => e.preventDefault());
	// Off a Mac the shell's own Ctrl keys reach the shell while the terminal has the keyboard, not the menu (shellKeeps).
	if (!isMac) win.webContents.on("before-input-event", (_e, input) => win.webContents.setIgnoreMenuShortcuts(entry.terminalFocused && shellKeeps(input)));
	win.webContents.on("did-start-loading", () => (entry.terminalFocused = false));
	const keepBounds = () => {
		if (entry.closing || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
		entry.bounds = win.getBounds();
		if (!quitting) {
			prefs.bounds = entry.bounds;
			persistOpenWindows();
		}
	};
	win.on("resize", keepBounds);
	win.on("move", keepBounds);
	win.on("focus", () => {
		entry.focused = true;
		entry.lastFocusedAt = ++focusClock;
		if (!quitting && !entry.closing) {
			prefs.use = validHost(entry.host);
			prefs.bounds = entry.bounds;
			persistOpenWindows();
		}
		nativeTheme.themeSource = entry.look?.kind ?? "dark";
		sendTo(entry, "pine:focus", true);
	});
	win.on("blur", () => {
		entry.focused = false;
		sendTo(entry, "pine:focus", false);
	});
	win.on("close", () => {
		if (!quitting && !entry.closing && !win.isDestroyed() && !win.isMinimized() && !win.isFullScreen()) {
			entry.bounds = win.getBounds();
		}
		if (!quitting && !entry.closing) {
			const others = [...windows.values()].filter((w) => w !== entry && !w.closing && !w.win.isDestroyed());
			if (!others.length) {
				prefs.bounds = entry.bounds;
				prefs.use = validHost(entry.host);
				prefs.layout = pickChromeLayout(entry.layout);
			}
		}
		entry.closing = true;
	});
	win.on("closed", () => {
		const wasForgetting = entry.forgetting;
		const closedHost = entry.host;
		const closedService = entry.service ?? (wasForgetting ? undefined : held.get(closedHost ?? ""));
		const previousTabs = [...(entry.initialTab ? [entry.initialTab] : []), ...entry.layout.tabs];
		windows.delete(id);
		terminals.closeWindow(id);
		if (voiceOwner === entry) {
			++voiceRound;
			listening?.cancel();
			listening = undefined;
			voiceOwner = undefined;
		}
		if (!quitting) persistOpenWindows();
		if (!wasForgetting) {
			syncRemainingUnion(closedHost);
			closeOrphanedSessions(closedService, closedHost, previousTabs, entry);
			rehomeServiceApprovals(closedService, id);
		}
		releaseUnusedStreams();
		notifyOpenHosts();
	});

	void win.loadURL(DEV_URL ?? "app://pine/");
	if (process.env.PINE_DESKTOP_DEVTOOLS) win.webContents.openDevTools({ mode: "detach" });
	notifyOpenHosts();
	void startWindowService(entry);
	return entry;
}

function showWindow(entry: WindowEntry): void {
	entry.lastFocusedAt = ++focusClock;
	entry.wantFocus = true;
	if (HEADLESS || entry.win.isDestroyed() || !entry.readyToShow) return;
	if (entry.win.isMinimized()) entry.win.restore();
	entry.win.show();
	entry.win.focus();
}

// ---- `pine` for a terminal -----------------------------------------------------------------------

/** What the packed app carries; a checkout has none of it. */
const RESOURCES = app.isPackaged ? process.resourcesPath : undefined;

const worded = (c: Command) => ({ ...c, text: said(c) });

async function firstCommand(): Promise<void> {
	if (prefs.commandTried || process.env.PINE_DESKTOP_DATA) return;
	const env = await loginEnv();
	const now = look(RESOURCES, env);
	if (now.state === "unavailable") return;
	prefs.commandTried = true;
	savePrefs();
	if (now.state === "none" && !now.password) await install(RESOURCES, env);
}

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

const RELEASE_API = process.env.PINE_DESKTOP_RELEASES !== undefined ? process.env.PINE_DESKTOP_RELEASES || undefined : app.isPackaged ? LATEST : undefined;
const RELEASE_DOWNLOADS = process.env.PINE_DESKTOP_DOWNLOADS || DOWNLOADS;

/** The last answer that said something, for a page that is opened again. */
let known: Update | undefined;
/** The question of this start, asked once. */
let atStart: Promise<Update> | undefined;

/** The app's own updater (updater.ts): none in an app from a checkout, unless a test names its stand-in. It tells the page how its download goes. */
const updater = makeUpdater((now) => {
	if (installing && now.state === "failed") {
		installing = false;
		for (const w of windows.values()) if (!w.host && !w.win.isDestroyed()) void startWindowService(w);
	}
	broadcast("pine:update-state", withUpdater(known));
});
let installing = false;

const withUpdater = (said: Update | undefined): Update | undefined => (said?.status === "newer" && updater && prefs.autoUpdate ? { ...said, updater: updater.state() } : said);

function downloadUpdate(): void {
	if (known?.status === "newer" && known.feed && updater && prefs.autoUpdate) updater.download(known.feed, known.version);
}

async function askForUpdate(): Promise<Update> {
	const said = await lookForUpdate(app.getVersion(), process.arch, RELEASE_API, RELEASE_DOWNLOADS);
	if (said.status !== "unknown") known = said;
	downloadUpdate();
	return withUpdater(said) as Update;
}

async function installUpdate(): Promise<void> {
	if (!updater || !prefs.autoUpdate || updater.state().state !== "ready") throw new Error("There is no update ready to install.");
	installing = true;
	const ours = [...held.entries()].filter(([, s]) => s.started && !s.host);
	for (const [key, s] of ours) {
		held.delete(key);
		const stream = serviceStreams.get(s);
		if (stream) {
			stream.abort.abort();
			serviceStreams.delete(s);
		}
	}
	await Promise.all(ours.map(([, s]) => s.stop(true)));
	updater.install();
}

async function update(again?: boolean): Promise<Update | undefined> {
	if (!RELEASE_API) return undefined;
	if (again) return askForUpdate();
	if (prefs.updates) await (atStart ??= askForUpdate().then((said) => (said.status === "unknown" && (atStart = undefined), said)));
	return withUpdater(known);
}

// ---- menus -------------------------------------------------------------------------------------

/** A menu item that asks the focused (or newly opened) window's page to do something. */
const item = (label: string, command: string, accelerator?: string, more: MenuItemConstructorOptions = {}): MenuItemConstructorOptions => ({
	label,
	accelerator,
	click: () => {
		const target = targetWindow() ?? openWindow();
		showWindow(target);
		sendCommand(target, command);
	},
	...more,
});

const localItem = (label: string, command: string, accelerator?: string): MenuItemConstructorOptions => ({
	label,
	accelerator,
	click: () => void withLocalWindow(command),
});

function buildMenu(): void {
	const newWindowItem = (accelerator?: string): MenuItemConstructorOptions => ({
		label: "New Window",
		accelerator,
		click: () => {
			const w = openWindow({ from: targetWindow() });
			showWindow(w);
		},
	});
	const template: MenuItemConstructorOptions[] = [
		...(isMac
			? [
					{
						label: "Pine",
						submenu: [{ role: "about" as const }, ...(RELEASE_API ? [item("Check for Updates…", "updates")] : []), { type: "separator" as const }, item("Settings…", "settings", "Cmd+,"), localItem("Add a Device…", "add-device", "Cmd+Shift+D"), ...(RESOURCES && fs.existsSync(path.join(RESOURCES, "bin", "pine")) ? [{ label: "pine in a Terminal…", click: () => void commandFromMenu() }] : []), { type: "separator" as const }, { role: "services" as const }, { type: "separator" as const }, { role: "hide" as const }, { role: "hideOthers" as const }, { role: "unhide" as const }, { type: "separator" as const }, { role: "quit" as const }],
					},
				]
			: []),
		{
			label: "File",
			submenu: [
				newWindowItem("CmdOrCtrl+N"),
				{ type: "separator" },
				item("New Conversation", "new", "CmdOrCtrl+T"),
				item("New Conversation with…", "agent", "CmdOrCtrl+Shift+T"),
				item("Open Folder…", "open-folder", "CmdOrCtrl+O"),
				item("New Conversation in a Worktree…", "new-worktree", "CmdOrCtrl+Alt+T"),
				{ type: "separator" },
				item("Attach Files…", "attach", "CmdOrCtrl+Shift+A"),
				item("Save File", "save", "CmdOrCtrl+S"),
				item("Export Conversation…", "export", "CmdOrCtrl+Shift+E"),
				{ type: "separator" },
				item("Close Tab", "close", "CmdOrCtrl+W"),
				{ label: "Close Window", accelerator: "CmdOrCtrl+Shift+W", click: () => targetWindow()?.win.close() },
				...(isMac ? [] : [{ type: "separator" as const }, item("Settings…", "settings", "Ctrl+,"), localItem("Add a Device…", "add-device", "Ctrl+Shift+D"), { role: "quit" as const }]),
			],
		},
		{ label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "pasteAndMatchStyle" }, { role: "selectAll" }, { type: "separator" }, item("Find in Conversation", "find", "CmdOrCtrl+F"), item("Copy Last Answer", "copy", "CmdOrCtrl+Shift+C"), ...(isMac || !voiceTools().unavailable ? [item("Dictate Message", "voice", "Ctrl+R")] : [])] },
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
				item("Toggle View", "view", "CmdOrCtrl+Shift+O"),
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
	// The Dock's menu: open a new window or add a device while windows are behind others or closed.
	if (isMac) app.dock?.setMenu(Menu.buildFromTemplate([newWindowItem(), localItem("Add a Device…", "add-device")]));
}

// ---- what the page may ask for -----------------------------------------------------------------

function handle<T extends unknown[]>(channel: string, fn: (caller: WindowEntry, ...args: T) => unknown): void {
	ipcMain.handle(channel, (e, ...args) => {
		const caller = entryFromEvent(e);
		if (!caller) throw new Error("not from the app's page");
		return fn(caller, ...(args as T));
	});
}

function wire(): void {
	handle("pine:state", (caller) => {
		const connected = Boolean(caller.service && serviceStreams.get(caller.service)?.connected);
		const bootMode = caller.bootMode;
		const initialTab = caller.initialTab;
		const initialDraft = caller.initialDraft;
		// After the initial boot (for instance on page.reload()), reload this window's own layout rather than one-shot boot flags.
		caller.bootMode = "restore";
		caller.initialTab = undefined;
		caller.initialDraft = undefined;
		return {
			state: caller.state,
			connected,
			home: prefs.home ?? process.env.PINE_HOME,
			prefs: { ...publicPrefs(), look: caller.look ?? prefs.look },
			platform: process.platform,
			focused: caller.focused,
			updates: Boolean(RELEASE_API),
			versions: { app: app.getVersion(), electron: process.versions.electron },
			views: true,
			selfUpdate: Boolean(updater),
			windowLayout: bootMode === "restore" ? caller.layout : undefined,
			chromeLayout: pickChromeLayout(caller.layout),
			noTab: bootMode === "no-tab" ? true : undefined,
			initialTab: bootMode === "tab" ? initialTab : undefined,
			initialDraft: bootMode === "tab" ? initialDraft : undefined,
			openHosts: openHostsFor(caller),
		};
	});
	handle("pine:window-new", async (caller, raw?: NewWindowOptions) => {
		const opts = raw && typeof raw === "object" ? raw : {};
		const host = opts.host === null ? null : typeof opts.host === "string" ? opts.host : undefined;
		const tab = opts.tab && typeof opts.tab.agent === "string" && opts.tab.agent && typeof opts.tab.session === "string" && opts.tab.session ? { agent: opts.tab.agent.slice(0, 120), session: opts.tab.session.slice(0, 200) } : undefined;
		const draft =
			opts.draft && typeof opts.draft.draft === "string" && Array.isArray(opts.draft.attachments)
				? {
						draft: opts.draft.draft,
						attachments: opts.draft.attachments
							.filter((a): a is { name: string; size: number; data: string; preview?: string } => Boolean(a && typeof a.name === "string" && typeof a.size === "number" && typeof a.data === "string"))
							.slice(0, 10)
							.map((a) => ({ name: a.name, size: a.size, data: a.data, ...(typeof a.preview === "string" ? { preview: a.preview } : {}) })),
					}
				: undefined;
		const next = openWindow({ from: caller, host, tab, draft, moveFrom: opts.moveFrom === true });
		if (opts.moveFrom === true && tab && !caller.host && !next.host) {
			terminals.transfer(caller.id, next.id, `${tab.agent}:${tab.session}`);
		}
		if (opts.moveFrom === true && tab && caller.service && (caller.host ?? "") === (next.host ?? "")) {
			const s = caller.service;
			const record = serviceStreams.get(s);
			if (record && record.openApprovals.size) {
				for (const approvalId of [...record.openApprovals]) {
					let sessionInfo = record.approvalSessions.get(approvalId);
					if (!sessionInfo) {
						const payload = record.approvalPayloads.get(approvalId);
						if (payload) {
							sessionInfo = await resolveApprovalSession(s, record, payload);
							if (sessionInfo) record.approvalSessions.set(approvalId, sessionInfo);
						}
					}
					if (sessionInfo && sessionInfo.agent === tab.agent && sessionInfo.session === tab.session) {
						let owners = record.approvalOwners.get(approvalId);
						if (!owners) record.approvalOwners.set(approvalId, (owners = new Set()));
						owners.delete(caller.id);
						owners.add(next.id);
					}
				}
			}
		}
		showWindow(next);
	});
	handle("pine:window-close", (caller) => {
		if (!caller.win.isDestroyed()) caller.win.close();
	});
	handle("pine:window-layout", (caller, snapshot: unknown) => {
		if (!snapshot || typeof snapshot !== "object" || caller.closing) return;
		if ("host" in snapshot && typeof (snapshot as { host?: unknown }).host === "string" && (snapshot as { host: string }).host !== (caller.host ?? "")) {
			return;
		}
		const cleaned = cleanWindowLayout(snapshot, caller.layout);
		if (!caller.service) {
			caller.layout = {
				...caller.layout,
				sidebar: cleaned.sidebar,
				aside: cleaned.aside,
				view: cleaned.view,
				order: cleaned.order,
				widths: cleaned.widths,
				folded: cleaned.folded,
			};
		} else {
			if (cleaned.noTab || cleaned.tabs.length > 0) caller.loadingDaemonTabs = false;
			caller.layout = cleaned;
		}
		persistOpenWindows();
	});
	handle("pine:call", async (caller, method: string, url: string, body?: unknown) => {
		const s = caller.service;
		if (method === "POST" && url === "/browser/embedded" && s && !s.host) {
			await browsers.start().catch(() => {});
			return callDaemon(s, method, url, { host: browsers.url });
		}
		if (method === "GET" && url === "/approvals" && s) {
			const res = await callDaemon(s, method, url, body);
			if (!res.ok || !Array.isArray(res.data)) return res;
			const record = serviceStreams.get(s);
			if (record) {
				const openIds = new Set<string>();
				for (const item of res.data) {
					if (item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string") {
						const obj = item as Record<string, unknown>;
						const id = obj.id as string;
						openIds.add(id);
						record.approvalPayloads.set(id, obj);
					}
				}
				record.openApprovals = openIds;
				for (const knownId of [...record.approvalPayloads.keys()]) {
					if (!openIds.has(knownId)) {
						record.approvalPayloads.delete(knownId);
						record.approvalSessions.delete(knownId);
						record.approvalOwners.delete(knownId);
					}
				}
				refreshAppBadge();
			}
			const visible: unknown[] = [];
			for (const req of res.data) {
				const reqObj = req && typeof req === "object" ? (req as Record<string, unknown>) : {};
				const reqId = typeof reqObj.id === "string" ? reqObj.id : undefined;
				const sessionInfo = record ? ((reqId ? record.approvalSessions.get(reqId) : undefined) ?? (await resolveApprovalSession(s, record, reqObj))) : undefined;
				if (record && reqId && sessionInfo) record.approvalSessions.set(reqId, sessionInfo);
				if (sessionInfo && windowHoldsConversation(caller, sessionInfo.agent, sessionInfo.session)) {
					if (record && reqId) {
						let set = record.approvalOwners.get(reqId);
						if (!set) record.approvalOwners.set(reqId, (set = new Set()));
						set.add(caller.id);
					}
					visible.push(req);
					continue;
				}
				const liveOwners =
					record && reqId
						? [...(record.approvalOwners.get(reqId) ?? [])].filter((id) => {
								const w = windows.get(id);
								return Boolean(w && !w.closing && !w.win.isDestroyed() && (w.service === s || (!w.service && w.host === s.host && w.state.status === "starting")));
							})
						: [];
				if (liveOwners.length) {
					if (liveOwners.includes(caller.id)) visible.push(req);
					continue;
				}
				const targets = sessionInfo ? recipientsForConversation(s, sessionInfo.agent, sessionInfo.session) : [targetWindow((w) => w.service === s)].filter((w): w is WindowEntry => Boolean(w));
				if (record && reqId && targets.length) record.approvalOwners.set(reqId, new Set(targets.map((w) => w.id)));
				if (targets.includes(caller)) visible.push(req);
			}
			return { ...res, data: visible };
		}
		if (method === "POST" && url === "/ui/tabs" && body && typeof body === "object") {
			if (!s || (s.host ?? "") !== (caller.host ?? "")) return callDaemon(s, method, url, body);
			const b = body as Record<string, unknown>;
			if (Array.isArray(b.tabs)) {
				caller.loadingDaemonTabs = false;
				caller.layout = cleanWindowLayout({ ...caller.layout, tabs: b.tabs, active: b.active, code: b.code, noTab: b.tabs.length === 0 }, caller.layout);
				persistOpenWindows();
				return callDaemon(s, method, url, { ...b, tabs: unionTabsFor(caller.host, caller) });
			}
		}
		const closeMatch = method === "POST" ? /^\/agents\/([^/]+)\/close$/.exec(url) : null;
		if (closeMatch && body && typeof body === "object") {
			const agent = decodeURIComponent(closeMatch[1]);
			const sessionName = String((body as Record<string, unknown>).session ?? "");
			const heldElsewhere = [...windows.values()].some((w) => w !== caller && !w.closing && !w.win.isDestroyed() && w.host === caller.host && windowHoldsConversation(w, agent, sessionName));
			if (heldElsewhere) return { ok: true, status: 200, data: { unsubscribed: [] } };
		}
		return callDaemon(s, method, url, body);
	});
	handle("pine:browser-show", (caller, key: unknown, index: unknown, bounds: unknown) => {
		const b = bounds as Partial<Bounds> | undefined;
		const fine = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
		const place = b && fine(b.x, 20_000) && fine(b.y, 20_000) && fine(b.width, 20_000) && fine(b.height, 20_000) && b.width >= 1 && b.height >= 1 ? { x: b.x, y: b.y, width: b.width, height: b.height } : undefined;
		const zoom = caller.win.webContents.getZoomFactor();
		const scaled = place && { x: Math.round(place.x * zoom), y: Math.round(place.y * zoom), width: Math.round(place.width * zoom), height: Math.round(place.height * zoom) };
		return browsers.show(caller.win, typeof key === "string" && !caller.service?.host ? key : undefined, fine(index, 99) ? index : 0, scaled);
	});
	handle("pine:browser-focus", (caller) => browsers.focus(caller.win));
	handle("pine:browser-picture", (caller) => browsers.picture(caller.win));
	handle("pine:retry", (caller) => startWindowService(caller));
	handle("pine:update", (_caller, again?: boolean) => update(again === true));
	handle("pine:install-update", () => installUpdate());
	handle("pine:restart", async (caller) => {
		const s = caller.service;
		if (!s?.started) throw new Error("this pine was started somewhere else (a terminal, a service). Restart it there.");
		const stream = serviceStreams.get(s);
		if (stream) {
			stream.abort.abort();
			serviceStreams.delete(s);
		}
		held.delete(s.host ?? "");
		await s.stop();
		for (const w of windows.values()) {
			if (!w.win.isDestroyed() && w.host === caller.host) void startWindowService(w);
		}
	});
	handle("pine:init", async (caller) => {
		launch ??= await findPine(APP_ROOT, app.isPackaged ? process.resourcesPath : undefined);
		const args = ["init", ...(prefs.home ? [prefs.home] : []), "--yes"];
		return runPine(launch, args, (line) => sendTo(caller, "pine:init-line", line), process.env.PINE_SKIP_DOWNLOADS ? { PINE_SKIP_DOWNLOADS: "1" } : {});
	});
	handle("pine:browser", async (caller) => {
		launch ??= await findPine(APP_ROOT, app.isPackaged ? process.resourcesPath : undefined);
		return runPine(launch, ["browser-install"], (line) => sendTo(caller, "pine:init-line", line), process.env.PINE_SKIP_DOWNLOADS ? { PINE_SKIP_DOWNLOADS: "1" } : {});
	});
	handle("pine:command", async (_caller, action?: string) => {
		const env = await loginEnv();
		return worded(action === "install" ? await install(RESOURCES, env) : action === "remove" ? await remove(RESOURCES, env) : look(RESOURCES, env));
	});
	handle("pine:use", (caller, host?: string) => use(caller, typeof host === "string" ? host : undefined));
	// A machine is added by its name alone; it is connected to when it is picked.
	handle("pine:hosts-add", (caller, value: string) => {
		const host = hostOf(String(value ?? ""));
		if (!host) throw new Error("Write the machine as you would after ssh: host or user@host.");
		if (host.startsWith("wsl:") && process.platform !== "win32") throw new Error("WSL is Windows': this computer has none.");
		if (!prefs.hosts.includes(host)) {
			if (prefs.hosts.length >= 20) throw new Error("There are 20 machines in the list already: forget one first.");
			prefs.hosts.push(host);
			savePrefs();
			notifyPrefs();
		}
		return { ...publicPrefs(), look: caller.look ?? prefs.look };
	});
	handle("pine:hosts-forget", (caller, host: string, options?: { closeWindows?: boolean }) => {
		if (host === caller.host) throw new Error("The app uses this machine now. Use another one first.");
		const others = [...windows.values()].filter((w) => w !== caller && !w.closing && !w.win.isDestroyed() && w.host === host);
		if (others.length && !options?.closeWindows) throw new Error("Another window uses this machine now. Close it first.");
		if (prefs.hosts.includes(host)) notePrefs(prefsFile(), `machine ${host} left the list: forgotten in Settings > Environments`);
		prefs.hosts = prefs.hosts.filter((h) => h !== host);
		if (prefs.use === host) prefs.use = undefined;
		for (const w of others) {
			w.closing = true;
			w.forgetting = true;
			++w.round;
			w.host = undefined;
			w.service = undefined;
			w.win.close();
		}
		savePrefs();
		const s = held.get(String(host));
		if (s) (held.delete(String(host)), void letGo(s));
		releaseUnusedStreams();
		notifyOpenHosts();
		notifyPrefs();
		return { ...publicPrefs(), look: caller.look ?? prefs.look };
	});
	handle("pine:prefs", async (caller, change: Partial<Prefs>) => {
		if (typeof change.notify === "boolean") prefs.notify = change.notify;
		if (typeof change.updates === "boolean") prefs.updates = change.updates;
		if (typeof change.autoUpdate === "boolean") {
			prefs.autoUpdate = change.autoUpdate;
			downloadUpdate();
			broadcast("pine:update-state", withUpdater(known));
		}
		if (typeof change.keepRunning === "boolean") prefs.keepRunning = change.keepRunning;
		let homeChanged = false;
		let oldLocal: Service | undefined;
		if ("home" in change) {
			const home = typeof change.home === "string" && change.home.trim() ? change.home.trim() : undefined;
			if (home !== prefs.home) {
				homeChanged = true;
				prefs.home = home;
				oldLocal = held.get("");
				if (oldLocal) held.delete("");
			}
		}
		if ("look" in change) {
			caller.look = cleanLook(change.look);
			prefs.look = caller.look;
			if (caller === targetWindow()) nativeTheme.themeSource = caller.look?.kind ?? "dark";
			refreshBackground(caller);
			if (isWindows && lastBadgeCount > 0 && !caller.win.isDestroyed()) caller.win.setOverlayIcon(waiting(caller.look), `${lastBadgeCount} waiting for you`);
		}
		savePrefs();
		notifyPrefs();
		if (homeChanged) {
			const localWindows = [...windows.values()].filter((w) => !w.closing && !w.win.isDestroyed() && w.host === undefined);
			for (const w of localWindows) {
				browsers.detachWindow(w.win);
				terminals.closeWindow(w.id);
				w.service = undefined;
				w.loadingDaemonTabs = true;
				w.layout = { ...w.layout, tabs: [], active: 0, noTab: false };
				setWindowState(w, { status: "starting", host: undefined });
			}
			if (oldLocal) await letGo(oldLocal);
			for (const w of localWindows) {
				if (!w.closing && !w.win.isDestroyed() && w.host === undefined) void startWindowService(w);
			}
		}
		return { ...publicPrefs(), look: caller.look ?? prefs.look };
	});
	handle("pine:access", () => accessOn().state());
	handle("pine:access-set", (_caller, change: unknown) => accessOn().set(accessChange(change)));
	handle("pine:access-pair", () => accessOn().openPairing());
	handle("pine:access-cancel", () => accessOn().cancelPairing());
	handle("pine:access-copy", async () => {
		const { pairing } = await accessOn().state();
		if (!pairing) throw new Error("No pairing is open now: press Add a device.");
		clipboard.writeText(pairing.link);
	});
	handle("pine:access-answer", (_caller, yes: unknown, id: unknown) => accessOn().answer(yes === true, typeof id === "string" ? id.slice(0, 64) : undefined));
	handle("pine:access-remove", (_caller, id: unknown) => {
		if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("That is not a device of the list.");
		return accessOn().remove(id);
	});
	handle("pine:pick-folder", async (caller, title?: string) => {
		const r = await dialog.showOpenDialog(caller.win, { title: typeof title === "string" ? title.slice(0, 80) : "Choose a folder", properties: ["openDirectory", "createDirectory"] });
		if (r.canceled) return undefined;
		const p = forDaemon(r.filePaths[0], caller.host);
		if (!p) throw new Error(`${r.filePaths[0]} cannot be reached from ${wslOf(caller.host)}: pick a folder on a drive of this computer, or one in the distribution.`);
		return p;
	});
	// A file dropped on the page, by the path the daemon knows it under.
	ipcMain.on("pine:daemon-path", (e, p: unknown) => {
		const caller = entryFromEvent(e);
		e.returnValue = caller && typeof p === "string" && p ? (forDaemon(p, caller.host) ?? "") : "";
	});
	// WSL on this Windows computer: its distributions, and the pine this app carries brought into one.
	handle("pine:wsl-distros", async () => (process.platform === "win32" ? await wslDistros() : []));
	handle("pine:wsl-install", async (_caller, distro: string) => {
		if (process.platform !== "win32" || !app.isPackaged) throw new Error("Only the Pine app for Windows brings pine into WSL.");
		const d = hostOf(`wsl:${String(distro)}`)?.slice(4);
		if (!d) throw new Error("There is no such distribution.");
		await installIntoWsl(d, app.getVersion(), process.resourcesPath);
		// A home there, as pine init makes it. Its sandbox needs the password of the distribution's
		// user (bubblewrap is installed with sudo): that part is the owner's, in a terminal.
		await new Promise<void>((resolve, reject) => {
			const c = spawn("wsl.exe", ["--distribution", d, "--exec", "/bin/sh", "-c", '"$HOME/.local/share/pine-app/bin/pine" init'], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
			let err = "";
			c.stderr!.on("data", (b: Buffer) => (err += b.toString("utf8")));
			c.on("error", reject);
			c.on("close", (code) => (code === 0 || /sandbox/i.test(err) ? resolve() : reject(new Error(err.trim().slice(-400) || `pine init ended with ${code}`))));
		});
		return { sandbox: `wsl --distribution ${d} --exec ~/.local/share/pine-app/bin/pine init` };
	});
	handle("pine:save-text", async (caller, name: string, text: string) => {
		const r = await dialog.showSaveDialog(caller.win, { defaultPath: path.join(app.getPath("documents"), path.basename(String(name))) });
		if (r.canceled || !r.filePath) return undefined;
		fs.writeFileSync(r.filePath, String(text));
		return r.filePath;
	});
	handle("pine:open", (_caller, url: string) => openOutside(String(url)));
	handle("pine:reveal", (caller, file: string) => {
		// Shown in the Finder, never opened: opening would start whatever the file is. A path of WSL's is Windows' first.
		const d = wslOf(caller.host);
		const here = typeof file === "string" && d && file.startsWith("/") ? fromWsl(file, d) : file;
		if (typeof here === "string" && path.isAbsolute(here) && fs.existsSync(here)) shell.showItemInFolder(here);
	});
	handle("pine:notify", (caller, title: string, body: string, tab?: string) => {
		if (!prefs.notify || !Notification.isSupported() || caller.focused) return;
		const colon = typeof tab === "string" ? tab.indexOf(":") : -1;
		if (colon > 0) {
			const agent = tab!.slice(0, colon);
			const sessionName = tab!.slice(colon + 1);
			if ([...windows.values()].some((w) => !w.win.isDestroyed() && w.host === caller.host && w.focused && windowHoldsConversation(w, agent, sessionName))) return;
		} else if ([...windows.values()].some((w) => !w.win.isDestroyed() && w.host === caller.host && w.focused)) {
			return;
		}
		const now = Date.now();
		for (const [k, at] of recentNotifications) if (now - at > 5000) recentNotifications.delete(k);
		const dedupeKey = `${caller.host ?? ""}\0${tab ?? ""}\0${String(title)}\0${String(body)}`;
		const prev = recentNotifications.get(dedupeKey);
		if (prev !== undefined && now - prev < 2000) return;
		recentNotifications.set(dedupeKey, now);
		const n = new Notification({ title: String(title).slice(0, 80), body: String(body).slice(0, 160), silent: false });
		n.on("click", () => {
			if (!caller.win.isDestroyed()) {
				showWindow(caller);
				if (tab) sendCommand(caller, `focus:${tab}`);
			}
		});
		n.show();
	});
	handle("pine:badge", () => {
		refreshAppBadge();
	});
	// Dictating a message. The words are recognised on this computer by the helper the terminal UI
	// uses too (src/tui/voice.ts): voice.swift on a Mac, voice.cs on Windows, whisper.cpp on Linux.
	// Nothing is sent anywhere, and what is heard is text for the input and nothing more. The page
	// puts it there; nothing here sends a message.
	handle("pine:voice-start", async (caller, language?: string) => {
		const prevListening = listening;
		const prevOwner = voiceOwner;
		listening = undefined;
		if (prevListening?.active) {
			prevListening.cancel();
		} else if (prevOwner && prevOwner !== caller) {
			sendTo(prevOwner, "pine:voice", { type: "done" });
		}
		const myRound = ++voiceRound;
		voiceOwner = caller;
		const lang = typeof language === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language) ? language : undefined;
		let command: string[];
		try {
			// A stand-in, for tests: a program, or a command line as a JSON array (the real helper told to read a recording).
			if (process.env.PINE_DESKTOP_VOICE) command = process.env.PINE_DESKTOP_VOICE.startsWith("[") ? (JSON.parse(process.env.PINE_DESKTOP_VOICE) as string[]).map(String) : [process.env.PINE_DESKTOP_VOICE];
			else {
				if (!isMac && !isWindows && process.platform !== "linux") throw new Error(NOT_HERE);
				if (isWindows) {
					// The pine of this app on Windows runs in WSL; the helper listens on Windows, from the source the app carries.
					const source = [...(app.isPackaged ? [path.join(process.resourcesPath, "pine")] : []), path.join(APP_ROOT, "..")].map((root) => path.join(root, "src", "tui", "voice.cs")).find((f) => fs.existsSync(f));
					if (!source) throw new Error("this app has no voice input on Windows: its helper's source was not found. Update the app.");
					if (!csc()) throw new Error(NO_CSC);
					command = [buildVoiceWindows(path.join(app.getPath("userData"), "voice"), { source })];
				} else if (isMac) {
					launch ??= await findPine(APP_ROOT, app.isPackaged ? process.resourcesPath : undefined);
					const source = path.join(pineRoot(launch) ?? "", "src", "tui", "voice.swift");
					if (!fs.existsSync(source)) throw new Error("this pine has no voice input: the source of the voice helper was not found. Update pine.");
					command = [await buildVoice(path.join(app.getPath("userData"), "voice"), source)];
				} else {
					launch ??= await findPine(APP_ROOT, app.isPackaged ? process.resourcesPath : undefined);
					const root = pineRoot(launch) ?? "";
					// The helper runs on Node: the one pine runs on, which the app's own Electron is not.
					const helper = [".js", ".ts"].map((ext) => path.join(root, "src", "tui", `voice-whisper${ext}`)).find((f) => fs.existsSync(f));
					if (!helper) throw new Error("this pine has no voice input on Linux: its helper was not found. Update pine.");
					const node = launch.argv.length > 1 ? launch.argv[0] : onPath("node", launch.env);
					if (!node) throw new Error("voice input on Linux runs on Node, and no node was found on this computer. Install Node 24 or newer from https://nodejs.org, then try again.");
					const tools = voiceTools("linux", undefined, { node, helper });
					if (tools.unavailable) throw new Error(tools.unavailable);
					command = await tools.program();
				}
			}
		} catch (e) {
			if (myRound === voiceRound && voiceOwner === caller) voiceOwner = undefined;
			throw e;
		}
		if (myRound !== voiceRound || caller.closing || caller.win.isDestroyed()) return;
		let finished = false;
		let mine: Listening | undefined;
		mine = new Listening(command, lang, {
			ready: () => {
				if (myRound !== voiceRound) return;
				sendTo(caller, "pine:voice", { type: "ready" });
			},
			partial: (text) => {
				if (myRound !== voiceRound) return;
				sendTo(caller, "pine:voice", { type: "partial", text });
			},
			model: (state) => {
				if (myRound !== voiceRound) return;
				sendTo(caller, "pine:voice", { type: "model", state });
			},
			done: (text, error) => {
				if (myRound !== voiceRound) return;
				finished = true;
				listening = undefined;
				if (voiceOwner === caller) voiceOwner = undefined;
				sendTo(caller, "pine:voice", { type: "done", text, error });
			},
		});
		if (!finished && myRound === voiceRound) listening = mine;
	});
	handle("pine:voice-stop", (caller, cancel?: boolean) => {
		if (caller !== voiceOwner) return;
		if (cancel) {
			const active = listening;
			listening = undefined;
			active?.cancel();
			++voiceRound;
			if (!active) sendTo(caller, "pine:voice", { type: "done" });
			voiceOwner = undefined;
		} else if (listening) {
			listening.stop();
		} else {
			++voiceRound;
			voiceOwner = undefined;
			sendTo(caller, "pine:voice", { type: "done" });
		}
	});
	handle("pine:term-open", (caller, id: string, cwd?: string, cols?: number, rows?: number) => {
		if (caller.host) throw new Error("The terminal is a shell on this computer.");
		return terminals.open(String(id), cwd, cols, rows, caller.id);
	});
	handle("pine:term-write", (caller, id: string, data: string) => terminals.write(String(id), data, caller.id));
	handle("pine:term-run", (caller, id: string, code: string) => terminals.run(String(id), code, caller.id));
	handle("pine:term-resize", (caller, id: string, cols: number, rows: number) => terminals.resize(String(id), cols, rows, caller.id));
	handle("pine:term-close", (caller, id: string) => terminals.close(String(id), caller.id));
	handle("pine:context-menu", (caller, items: Array<{ id: string; label: string; enabled?: boolean; separator?: boolean; danger?: boolean; checked?: boolean }>) => {
		return new Promise<string | undefined>((resolve) => {
			let picked: string | undefined;
			const menu = Menu.buildFromTemplate(items.slice(0, 30).map((i) => (i.separator ? { type: "separator" as const } : { label: String(i.label).slice(0, 80), enabled: i.enabled !== false, ...(typeof i.checked === "boolean" ? { type: "radio" as const, checked: i.checked } : {}), click: () => (picked = String(i.id)) })));
			menu.popup({ window: caller.win, callback: () => resolve(picked) });
		});
	});
}

/** A dot for the taskbar button on Windows, drawn here: 16 pixels, in the theme's color for what is wrong or waits. */
function waiting(lookValue: Look | undefined = prefs.look): Electron.NativeImage {
	const hex = (lookValue?.colors.bad ?? "#d0679d").slice(1, 7);
	const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
	const size = 16;
	const pixels = Buffer.alloc(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			// Covered by a circle of radius 7, with a soft edge one pixel wide; premultiplied, in the order Windows keeps (BGRA).
			const a = Math.max(0, Math.min(1, 7.5 - Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2)));
			pixels.set([Math.round(b * a), Math.round(g * a), Math.round(r * a), Math.round(255 * a)], (y * size + x) * 4);
		}
	}
	return nativeImage.createFromBitmap(pixels, { width: size, height: size });
}

// ---- life of the app ---------------------------------------------------------------------------

/**
 * A folder among the arguments the app was started with: on Windows and Linux a folder dropped on its
 * icon, or `Pine <folder>`, comes so. (Started from a checkout, the app's own folder is one of them.)
 */
const folderIn = (argv: string[]) => argv.slice(1).find((a) => !a.startsWith("-") && path.isAbsolute(a) && path.resolve(a) !== app.getAppPath());

/** A folder the app was opened with (dropped on its icon, or `open -a Pine <folder>`): a conversation that works there. */
let appReady = false;
const pendingFolders: string[] = [];

function isDirectory(dir: string): boolean {
	try {
		return fs.statSync(dir).isDirectory();
	} catch {
		return false;
	}
}

function openFolder(dir: string): void {
	if (!isDirectory(dir)) return;
	if (!appReady) {
		pendingFolders.push(dir);
		return;
	}
	withLocalWindow(`folder:${dir}`);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on("second-instance", (_e, argv) => {
		const address = argv.find((a) => a.toLowerCase().startsWith("pine:"));
		if (address) {
			if (!accessStarted || !appReady) {
				pendingAddresses.push(address);
				return;
			}
			void pairFromAddress(address).then((paired) => {
				if (!paired) showWindow(targetWindow() ?? openWindow());
			});
			return;
		}
		const dir = folderIn(argv);
		if (dir && isDirectory(dir)) {
			openFolder(dir);
			return;
		}
		if (!appReady) return;
		showWindow(targetWindow() ?? openWindow());
	});
	app.on("open-url", (e, url) => {
		e.preventDefault();
		if (!accessStarted || !appReady) pendingAddresses.push(url);
		else void pairFromAddress(url);
	});
	app.on("open-file", (e, file) => {
		e.preventDefault();
		openFolder(file);
	});
	app.on("web-contents-created", (_e, contents) => {
		contents.session.setPermissionRequestHandler((_wc, _permission, done) => done(false));
	});
	void app.whenReady().then(() => {
		loadPrefs();
		protocol.handle("app", page);
		protocol.handle("pine-media", media);
		session.defaultSession.setPermissionRequestHandler((_wc, _permission, done) => done(false));
		wire();
		ipcMain.on("pine:term-focus", (e, focused) => {
			const caller = entryFromEvent(e);
			if (caller) caller.terminalFocused = focused === true;
		});
		startAccess();
		registerScheme();
		ipcMain.on("pine:ready", (e) => {
			const caller = entryFromEvent(e);
			if (!caller) return;
			caller.pageReady = true;
			sendTo(caller, "pine:service", caller.state);
			if (caller.service && serviceStreams.get(caller.service)?.connected) sendTo(caller, "pine:connection", true);
			for (const cmd of caller.pendingCommands.splice(0)) sendTo(caller, "pine:menu", cmd);
		});
		if (isMac && !app.isPackaged) {
			try {
				app.dock?.setIcon(path.join(APP_ROOT, "assets", "icon.png"));
			} catch {
				// an icon is not worth failing over
			}
		}
		buildMenu();
		if (prefs.windows?.length) {
			let primaryEntry: WindowEntry | undefined;
			let firstEntry: WindowEntry | undefined;
			for (const snap of prefs.windows) {
				const w = openWindow({
					host: snap.host ?? null,
					bounds: snap.bounds,
					bootMode: "restore",
					layout: snap.layout,
					look: snap.look,
					wantFocus: Boolean(snap.focused),
				});
				firstEntry ??= w;
				if (snap.focused) primaryEntry = w;
			}
			primaryEntry ??= firstEntry;
			if (primaryEntry) showWindow(primaryEntry);
			persistOpenWindows();
		} else {
			openWindow({ bootMode: "daemon" });
			persistOpenWindows();
		}
		appReady = true;
		// Off a Mac a folder the app was started with comes as an argument of this first start, not as an event.
		const dir = isMac ? undefined : folderIn(process.argv);
		if (dir) openFolder(dir);
		for (const d of pendingFolders.splice(0)) withLocalWindow(`folder:${d}`);
		if (pairingShown) {
			pairingShown = false;
			withLocalWindow("pairing-shown");
		}
		for (const url of pendingAddresses.splice(0)) void pairFromAddress(url);
		const address = process.argv.find((a) => a.toLowerCase().startsWith("pine:"));
		if (address) void pairFromAddress(address);
		void firstCommand();
		app.on("activate", () => {
			const front = targetWindow();
			if (!front) {
				const w = openWindow({ bootMode: "daemon" });
				showWindow(w);
				persistOpenWindows();
			} else {
				showWindow(front);
			}
		});
	});
	app.on("window-all-closed", () => {
		if (!isMac) app.quit();
	});
	app.on("before-quit", (e) => {
		if (quitting) return;
		prefs.windows = snapshotOpenWindows();
		const front = targetWindow();
		if (front) {
			prefs.use = validHost(front.host);
			prefs.bounds = front.bounds;
			prefs.layout = pickChromeLayout(front.layout);
		}
		quitting = true;
		savePrefs();
		updater?.quitting();
		terminals.closeAll();
		browsers.close();
		void access?.stop();
		announcer.stop();
		const going = [...held.values()].filter((s) => s.host || (s.started && !prefs.keepRunning));
		for (const stream of serviceStreams.values()) stream.abort.abort();
		serviceStreams.clear();
		if (!going.length) return;
		e.preventDefault();
		void Promise.all(going.map((s) => s.stop())).finally(() => app.quit());
	});
}
