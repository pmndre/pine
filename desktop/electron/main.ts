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
import { type AccessChange, type AccessControl, type AccessPrefs, type AccessState, createAccessControl, readAccessPrefs } from "./access/control.ts";
import type { Cipher } from "./access/host.ts";
import { createAnnouncer, isPairAddress } from "./access/nearby.ts";
import { startStandIn } from "./access/stand-in.ts";
import { type Command, install, look, remove, said } from "./command.ts";
import { callDaemon, followEvents, mediaFromDaemon, pageCsp, VIEW_CSP } from "./daemon.ts";
import { droppedHosts, notePrefs, readPrefsFile, setAside, writePrefsFile } from "./prefs-file.ts";
import { connect, connectSsh, findPine, hostOf, type Launch, loginEnv, onPath, pineRoot, pineVersion, readHosts, runPine, type Service, ServiceError } from "./service.ts";
import { fromWsl, install as installIntoWsl, toWsl } from "./wsl.ts";
import { wslDistros } from "../../src/remote.ts";
import { shellKeeps, Terminals } from "./terminal.ts";
import { makeUpdater } from "./updater.ts";
import { ahead, DOWNLOADS, LATEST, lookForUpdate, type Update } from "./updates.ts";
import { cleanLook, type Look } from "../src/theme.ts";
import { cascadeBounds, chromeOf, cleanBounds, cleanChromeLayout, cleanNewWindowOptions, cleanWindowLayout, cleanWindows, MAX_WINDOWS, type ChromeLayout, type NewWindowOptions, type WindowBounds, type WindowDraft, type WindowLayout, type WindowSnapshot, type WindowTabRef } from "./window-layout.ts";

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
	/** Fallback chrome layout (sidebar, aside, view, order, widths, folded) used when reopening from zero windows. */
	layout?: ChromeLayout;
	/** Open desktop windows persisted on quit and during normal operation, restored on next launch. */
	windows?: WindowSnapshot[];
	/** Browser access: on or off, the service's address, open at login (access/control.ts). The host key and the devices are a file of their own beside this one. */
	access: AccessPrefs;
}

const prefsFile = () => path.join(app.getPath("userData"), "prefs.json");
let prefs: Prefs = { keepRunning: false, hosts: [], notify: true, updates: true, autoUpdate: true, commandTried: false, access: readAccessPrefs(undefined) };

/** Preferences shape exposed to renderer pages (omits main-process window geometry and snapshots). */
const publicPrefs = () => ({ ...prefs, bounds: undefined, layout: undefined, windows: undefined });

/**
 * Whether prefs.json may be written: not before it was read (what is in memory then is the defaults,
 * which would replace the owner's machines), and not over a file that could not be read and could
 * not be set aside.
 */
let prefsWritable = false;

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
			windows: cleanWindows(raw.windows, hosts),
			access: readAccessPrefs(raw.access),
		};
		// Only a machine that is in the list: what else might be written there is not connected to.
		if (typeof raw.use === "string" && prefs.hosts.includes(raw.use)) prefs.use = raw.use;
		for (const host of droppedHosts(raw.hosts, prefs.hosts)) notePrefs(prefsFile(), `machine ${host} left the list: it is not a host for ssh, or past the limit of 20`);
	}
	nativeTheme.themeSource = prefs.look?.kind ?? "dark";
}

/**
 * What the window shows before the page draws: the page color of the theme it was last drawn in
 * (pmndre's before there was one). On a Mac the window is transparent, behind its vibrancy.
 */
function windowBackground(look?: Look): string {
	if (isMac) return "#00000000";
	return ((look ?? prefs.look)?.colors.bg ?? "#1b1e28").slice(0, 7);
}

/**
 * How tall the bar along the top of the page is in the page's pixels (h-11 at the page's 15px, index.css): off a
 * Mac the system draws its window controls over the page at its top right (titleBarOverlay), as tall as it. The
 * window counts in its own pixels, which are the page's times its zoom.
 */
const TITLE_BAR = 41.25;

/** The system's window controls off a Mac, in the theme's colors: on the bar's background (the page's `sunk`), drawn in its quieter text. */
function windowControls(zoom = 1, look?: Look): { color: string; symbolColor: string; height: number } {
	const colors = (look ?? prefs.look)?.colors;
	return { color: (colors?.sunk ?? "#171922").slice(0, 7), symbolColor: (colors?.["text-muted"] ?? colors?.text ?? "#a6accd").slice(0, 7), height: Math.round(TITLE_BAR * zoom) };
}

/**
 * Zooms the page by a step as the menu's own roles do (undefined: back to its own size), and off a Mac fits the window's
 * controls to the bar, which grows and shrinks with the page: taller than it, they would cover the panels' top edge.
 */
function zoomBy(w: ManagedWindow | undefined, step: number | undefined): void {
	if (!w || w.win.isDestroyed()) return;
	const level = step === undefined ? 0 : w.win.webContents.getZoomLevel() + step;
	w.win.webContents.setZoomLevel(level);
	// (Right after, the window still says the zoom it had. A level is a power of 1.2, as Chromium counts it.)
	refreshWindowBackground(w, 1.2 ** level);
}

/** Repaints a window's background (and off a Mac its controls) for its own environment's theme. */
function refreshWindowBackground(w: ManagedWindow, zoom?: number): void {
	if (w.win.isDestroyed()) return;
	w.win.setBackgroundColor(windowBackground(w.look));
	if (!isMac) w.win.setTitleBarOverlay(windowControls(zoom ?? w.win.webContents.getZoomFactor(), w.look));
}

function savePrefs(): void {
	if (!prefsWritable) return;
	try {
		writePrefsFile(prefsFile(), prefs);
	} catch {
		// a preference that is not kept is not worth an error
	}
}

// ---- the daemon --------------------------------------------------------------------------------

// One pine at a time: this computer's, or another machine's over SSH (Settings > Environments). The
// page knows only that there is one; which it is, it is told in the state (`host`, `label`).
type ServiceState = { status: "starting"; host?: string } | { status: "ready"; mode: string; started: boolean; home: string; version?: string; from: string; host?: string; label?: string; olderThan?: string } | { status: "error"; kind: ServiceError["kind"]; message: string; host?: string };

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

interface ManagedWindow {
	id: string;
	win: BrowserWindow;
	ready: boolean;
	focusedAt: number;
	terminalFocused: boolean;
	host?: string;
	service?: Service;
	state: ServiceState;
	round: number;
	bounds?: WindowBounds;
	layout?: WindowLayout;
	chromeLayout?: ChromeLayout;
	noTab?: boolean;
	initialTab?: WindowTabRef;
	initialDraft?: WindowDraft;
	pendingFolders: string[];
	pendingCommands: string[];
	pairingShown: boolean;
	look?: Look;
	badgeCount: number;
	tabKeys: Set<string>;
}

/** All open windows keyed by internal windowId ("w1", "w2", ...). */
const windows = new Map<string, ManagedWindow>();
/** All open windows keyed by `webContents.id` for O(1) IPC sender lookup. */
const byContents = new Map<number, ManagedWindow>();
let nextWindowId = 1;
let focusSeq = 1;

/** Returns the currently focused window, else the most recently focused open window, else the first open window. */
function focusedWindow(): ManagedWindow | undefined {
	let best: ManagedWindow | undefined;
	for (const w of windows.values()) {
		if (w.win.isDestroyed()) continue;
		if (w.win.isFocused()) return w;
		if (!best || w.focusedAt > best.focusedAt) best = w;
	}
	return best;
}

/** All open non-destroyed windows currently viewing `host` (`undefined` = this computer). */
function windowsForHost(host: string | undefined): ManagedWindow[] {
	const key = host ?? "";
	return [...windows.values()].filter((w) => !w.win.isDestroyed() && (w.host ?? "") === key);
}

/** The focused or most recently focused open window viewing `host`. */
function primaryWindowForHost(host: string | undefined): ManagedWindow | undefined {
	let best: ManagedWindow | undefined;
	for (const w of windowsForHost(host)) {
		if (w.win.isFocused()) return w;
		if (!best || w.focusedAt > best.focusedAt) best = w;
	}
	return best;
}

/** Remote hosts currently displayed across open windows (one entry per open remote window, so counts are preserved). */
function openHostsList(): string[] {
	return [...windows.values()].filter((w) => !w.win.isDestroyed() && w.host).map((w) => w.host!);
}

function sendTo(w: ManagedWindow | undefined, channel: string, ...args: unknown[]): void {
	if (w && !w.win.isDestroyed()) w.win.webContents.send(channel, ...args);
}

function broadcast(channel: string, ...args: unknown[]): void {
	for (const w of windows.values()) if (!w.win.isDestroyed()) w.win.webContents.send(channel, ...args);
}

function broadcastOpenHosts(): void {
	broadcast("pine:open-hosts", openHostsList());
}

function broadcastPrefs(): void {
	broadcast("pine:prefs-changed", publicPrefs());
}

function snapshotOpenWindows(): WindowSnapshot[] {
	return [...windows.values()]
		.filter((w) => !w.win.isDestroyed())
		.map((w) => ({
			...(w.bounds ? { bounds: w.bounds } : {}),
			...(w.host ? { host: w.host } : {}),
			...(w.layout
				? { layout: w.layout }
				: w.chromeLayout
					? { layout: { ...(w.host ? { host: w.host } : {}), tabs: [], active: 0, ...(w.noTab ? { noTab: true } : {}), code: false, ...w.chromeLayout } }
					: {}),
		}));
}

function persistOpenWindows(): void {
	prefs.windows = snapshotOpenWindows();
	savePrefs();
}

/** The agents' browsers, tracked per local BrowserWindow: for this computer's pine only, whose browser servers can reach it. */
const browsers = new BrowserHost({
	// The window focused last, by the focus events this app saw: the same order focusedWindow() falls back to.
	inFront: (win) => {
		let best: ManagedWindow | undefined;
		for (const w of windows.values()) if (!w.win.isDestroyed() && (!best || w.focusedAt > best.focusedAt)) best = w;
		return best?.win === win;
	},
	onPreempted: (win) => {
		if (!win.isDestroyed()) win.webContents.send("pine:browser-preempted");
	},
});
let launch: Launch | undefined;
let quitting = false;
let listening: Listening | undefined;
let listeningWindow: ManagedWindow | undefined;

/** The owner's terminal of each conversation (terminal.ts): their own shell, which ends with the app. */
// A block run with a Run button reports how it went to the page, which tells the conversation through the daemon.
const terminals = new Terminals(
	{
		data: (id, data, windowId) => sendTo(windows.get(windowId), "pine:term-data", id, data),
		exit: (id, code, windowId) => sendTo(windows.get(windowId), "pine:term-exit", id, code),
		run: (id, report, windowId) => sendTo(windows.get(windowId), "pine:term-run", id, report),
	},
	{ env: loginEnv, hooks: path.join(app.getPath("userData"), "shell-hooks"), shell: process.env.PINE_DESKTOP_SHELL ? [process.env.PINE_DESKTOP_SHELL] : undefined, stillRunningMs: Number(process.env.PINE_DESKTOP_STILL_RUNNING_MS) || undefined },
);

function setWindowState(w: ManagedWindow, next: ServiceState): void {
	w.state = next;
	sendTo(w, "pine:service", next);
}

interface ServiceStream {
	service: Service;
	abort: AbortController;
	connected: boolean;
	/** Unique open approval/question IDs on this environment, for deduplicated Dock/taskbar badges. */
	approvals: Set<string>;
	/** Bounded map of task ID -> "agent:session" populated from `agent/<agent>/started` events. */
	taskToKey: Map<number, string>;
}

/** One shared SSE subscriber per active environment (`""` for local, `host` for remote). */
const streams = new Map<string, ServiceStream>();

async function startService(w: ManagedWindow): Promise<void> {
	const mine = ++w.round;
	const host = w.host;
	const envKey = host ?? "";
	w.service = undefined;
	setWindowState(w, { status: "starting", host });
	try {
		const s = await hold(host);
		// Another machine was picked while this one connected, or the window closed: it stays held.
		if (mine !== w.round || w.win.isDestroyed()) return;
		w.service = s;
		setWindowState(w, { status: "ready", mode: s.mode, started: s.started, home: s.home, version: s.version, from: host ? (host.startsWith("wsl:") ? `wsl ${host.slice(4)}` : `ssh ${host}`) : (launch?.from ?? ""), host: s.host, label: s.label, olderThan: olderThan(s, host) });
		const entry = ensureStream(envKey, s);
		sendTo(w, "pine:connection", entry.connected);
	} catch (e) {
		if (mine !== w.round || w.win.isDestroyed()) return;
		setWindowState(w, { status: "error", kind: e instanceof ServiceError ? e.kind : "failed", message: e instanceof Error ? e.message : String(e), host });
	}
}

/**
 * The pines this app holds: this computer's ("") and each machine's it used, by host. Switching
 * changes which one a window shows and lets go of none, so that an agent at work in one goes on
 * while another is shown. They are let go of when the app quits.
 */
const held = new Map<string, Service>();
/** In-flight connection attempts keyed by `host ?? ""` so concurrent callers share one connection. */
const connecting = new Map<string, Promise<Service>>();

/** The WSL distribution for a host string, if it names one. */
const wslOf = (host: string | undefined) => (host?.startsWith("wsl:") ? host.slice(4) : undefined);

/** A path of this computer as the daemon for `host` knows it: the same, or under /mnt in WSL (undefined where WSL cannot reach it). */
const forDaemon = (host: string | undefined, p: string) => {
	const d = wslOf(host);
	return d ? toWsl(p, d) : p;
};

/**
 * The pine of a machine (none: this computer's) as the app holds it: the one held from before when
 * it answers still, else one made anew and held. Windows use it, and browser access for this
 * computer's, also while a window shows another machine's pine.
 */
async function hold(host: string | undefined): Promise<Service> {
	const key = host ?? "";
	const inflight = connecting.get(key);
	if (inflight) return inflight;
	const work = (async () => {
		let s = held.get(key);
		// One held from before answers still: it is used again at once. One that does not is let go of and made anew.
		if (s && !(await answers(s))) {
			if (held.get(key) === s) held.delete(key);
			void letGo(s);
			s = undefined;
		}
		if (s) return s;
		const made = host ? await connectSsh(host, await loginEnv()) : await connect((launch = await findPine(APP_ROOT, app.isPackaged ? process.resourcesPath : undefined)), { home: prefs.home ?? process.env.PINE_HOME, keep: prefs.keepRunning });
		// Asked for twice (Try again while it connected, or browser access at the same time): the one that came first is kept.
		const first = held.get(key);
		if (first) void letGo(made);
		else held.set(key, made);
		return first ?? made;
	})();
	connecting.set(key, work);
	try {
		return await work;
	} finally {
		if (connecting.get(key) === work) connecting.delete(key);
	}
}

/** Whether a pine still answers: one on another machine may have lost its connection meanwhile. */
const answers = (s: Service) => fetch(`${s.base}/health`, { signal: AbortSignal.timeout(2500) }).then((r) => r.ok, () => false);

/** Lets go of a pine: the SSH connection to another machine ends (and a pine it started there); one this app started here stops, unless it is to go on. */
async function letGo(s: Service | undefined): Promise<void> {
	if (s?.host || (s?.started && !prefs.keepRunning)) await s.stop();
}

/** Changes which environment a single window views without affecting any other open window. */
async function useInWindow(w: ManagedWindow, host: string | undefined): Promise<void> {
	if (host !== undefined && !prefs.hosts.includes(host)) throw new Error("That machine is not in the list: add it in Settings > Environments.");
	if (host === w.host && w.service) return;
	const wasLocal = !w.host;
	w.host = host;
	w.layout = undefined;
	w.tabKeys.clear();
	w.badgeCount = 0;
	prefs.use = host;
	persistOpenWindows();
	broadcastOpenHosts();
	// Detach this window's embedded browser and close only this window's local terminals when switching away from local.
	if (wasLocal && host) {
		browsers.detach(w.win);
		terminals.closeWindow(w.id);
		w.terminalFocused = false;
	}
	pruneStreams();
	await startService(w);
}

/** Starts or reuses the single shared SSE subscriber for an active `Service` and fans out events to its windows. */
function ensureStream(envKey: string, s: Service): ServiceStream {
	const existing = streams.get(envKey);
	if (existing && existing.service === s) return existing;
	existing?.abort.abort();
	const abort = new AbortController();
	const entry: ServiceStream = { service: s, abort, connected: false, approvals: new Set(), taskToKey: new Map() };
	streams.set(envKey, entry);
	followEvents(s, abort.signal, {
		batch: (events) => {
			let badgeChanged = false;
			const targets = windowsForHost(s.host).filter((w) => w.service === s);
			const perWindow = new Map<ManagedWindow, unknown[]>();
			for (const ev of events as Array<{ topic?: string; payload?: Record<string, unknown> }>) {
				const p = ev?.payload ?? {};
				const topic = ev?.topic;
				if (typeof topic === "string" && topic.startsWith("agent/") && topic.endsWith("/started")) {
					const agentFromTopic = topic.slice("agent/".length, -"/started".length);
					const agent = typeof p.agent === "string" && p.agent ? p.agent : agentFromTopic;
					if (agent && typeof p.task === "number" && typeof p.session === "string" && p.session) {
						entry.taskToKey.delete(p.task);
						entry.taskToKey.set(p.task, `${agent}:${p.session}`);
						if (entry.taskToKey.size > 500) {
							const oldest = entry.taskToKey.keys().next().value;
							if (oldest !== undefined) entry.taskToKey.delete(oldest);
						}
					}
				}
				if (topic === "approval/requested" && typeof p.id === "string") {
					if (!entry.approvals.has(p.id)) {
						entry.approvals.add(p.id);
						badgeChanged = true;
					}
				} else if (topic === "approval/decided" && typeof p.id === "string") {
					if (entry.approvals.delete(p.id)) badgeChanged = true;
				}
				let recipients: ManagedWindow[];
				if (topic === "approval/requested") {
					const key =
						(typeof p.root === "number" ? entry.taskToKey.get(p.root) : undefined) ??
						(typeof p.task === "number" ? entry.taskToKey.get(p.task) : undefined) ??
						(typeof p.agent === "string" && typeof p.session === "string" && p.session ? `${p.agent}:${p.session}` : "");
					let holders = key ? targets.filter((w) => w.tabKeys.has(key)) : [];
					if (!holders.length && typeof p.agent === "string" && p.agent) {
						const prefix = `${p.agent}:`;
						holders = targets.filter((w) => [...w.tabKeys].some((k) => k.startsWith(prefix)));
					}
					if (!holders.length && typeof p.of === "string" && p.of && p.of !== p.agent) {
						const prefix = `${p.of}:`;
						holders = targets.filter((w) => [...w.tabKeys].some((k) => k.startsWith(prefix)));
					}
					if (holders.length) recipients = holders;
					else {
						const primary = primaryWindowForHost(s.host);
						recipients = primary && primary.service === s ? [primary] : targets.slice(0, 1);
					}
				} else if (topic === "pine/conversation" && p.change === "open") {
					const key = typeof p.agent === "string" ? `${p.agent}:${typeof p.session === "string" && p.session ? p.session : "main"}` : "";
					const holders = key ? targets.filter((w) => w.tabKeys.has(key)) : [];
					if (holders.length) recipients = holders;
					else {
						const primary = primaryWindowForHost(s.host);
						recipients = primary && primary.service === s ? [primary] : targets.slice(0, 1);
					}
				} else {
					recipients = targets;
				}
				for (const w of recipients) {
					let list = perWindow.get(w);
					if (!list) perWindow.set(w, (list = []));
					list.push(ev);
				}
			}
			for (const [w, list] of perWindow) sendTo(w, "pine:events", list);
			if (badgeChanged) refreshBadges();
		},
		connection: (up) => {
			entry.connected = up;
			for (const w of windowsForHost(s.host)) if (w.service === s) sendTo(w, "pine:connection", up);
		},
		// A daemon this app started and that is gone will not come back by waiting: start it again.
		// Nor does an SSH connection that broke: it is made again.
		lost: (times) => {
			if (times !== 5 || !(s.started || s.host) || quitting) return false;
			if (held.get(envKey) === s) held.delete(envKey);
			if (streams.get(envKey) === entry) streams.delete(envKey);
			void letGo(s);
			for (const w of windowsForHost(s.host)) if (w.service === s) void startService(w);
			return true;
		},
	});
	return entry;
}

/** Aborts and removes any SSE stream that no open window is currently viewing. */
function pruneStreams(): void {
	for (const [envKey, entry] of [...streams]) {
		const active = [...windows.values()].some((w) => !w.win.isDestroyed() && (w.host ?? "") === envKey && w.service === entry.service);
		if (!active) {
			entry.abort.abort();
			streams.delete(envKey);
		}
	}
	refreshBadges();
}

/** Writes the deduplicated union of chat tabs open across all windows on `host` to that daemon's `/ui/tabs`. */
async function syncDaemonTabs(host: string | undefined, preferred: ManagedWindow): Promise<void> {
	const viewers = windowsForHost(host).filter((w) => w.service);
	const s = preferred.service ?? viewers[0]?.service ?? held.get(host ?? "");
	if (!s) return;
	const union: WindowTabRef[] = [];
	const seen = new Set<string>();
	for (const w of viewers) {
		for (const t of w.layout?.tabs ?? []) {
			const key = `${t.agent}:${t.session}`;
			if (seen.has(key)) continue;
			seen.add(key);
			union.push(t);
		}
	}
	const frontTab = preferred.layout?.tabs[preferred.layout.active];
	const active = frontTab ? Math.max(0, union.findIndex((t) => t.agent === frontTab.agent && t.session === frontTab.session)) : 0;
	await callDaemon(s, "POST", "/ui/tabs", { tabs: union, active, code: preferred.layout?.code === true }).catch(() => {});
}

/** Recomputes OS Dock/taskbar badges from distinct open approvals across all connected environments. */
function refreshBadges(): void {
	const envCounts = new Map<string, number>();
	for (const w of windows.values()) {
		if (w.win.isDestroyed()) continue;
		const envKey = w.host ?? "";
		const streamCount = streams.get(envKey)?.approvals.size ?? 0;
		const prev = envCounts.get(envKey) ?? 0;
		envCounts.set(envKey, Math.max(prev, streamCount, streamCount > 0 ? 0 : w.badgeCount));
	}
	let total = 0;
	for (const n of envCounts.values()) total += n;
	if (isMac) app.dock?.setBadge(total > 0 ? String(total) : "");
	else if (isWindows) {
		for (const w of windows.values()) {
			if (w.win.isDestroyed()) continue;
			const wn = envCounts.get(w.host ?? "") ?? 0;
			w.win.setOverlayIcon(wn > 0 ? waiting() : null, wn > 0 ? `${wn} waiting for you` : "");
		}
	} else app.setBadgeCount(total);
}

/** A picture, video or sound of the daemon's, routed per window via `pine-media://window-<windowId>/...`. */
async function media(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const m = /^window-(.+)$/.exec(url.host);
	const w = m ? windows.get(m[1]) : focusedWindow();
	return mediaFromDaemon(w?.service, request.method, url.pathname, url.search);
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
	n.on("click", () => show());
	n.show();
}

/**
 * A device asks to connect (with a pairing's code, or from the network without one): while the window
 * is not in front, the system says so with the device's name and the four digits. No Allow in it: the
 * owner answers in the app, which a click brings forward. Said whatever the notification preference,
 * as a question that waits for the owner is, but only while the window is not in front: there the toast asks.
 */
/** Which window should display an incoming Browser access pairing question: focused window, else primary local window. */
function pairingTarget(): ManagedWindow | undefined {
	return focusedWindow() ?? primaryWindowForHost(undefined);
}

/** Filters an AccessState for a specific window so PairingQuestion only appears in the single target window. */
function accessForWindow(s: AccessState, w: ManagedWindow): AccessState {
	if (!s.request) return s;
	return pairingTarget() === w ? s : { ...s, request: undefined };
}

function notifyAsked(request: { name: string; code: string }): void {
	const target = pairingTarget();
	const targetVisibleFocused = Boolean(target && !target.win.isDestroyed() && target.win.isVisible() && target.win.isFocused());
	if (!Notification.isSupported() || targetVisibleFocused) return;
	const n = new Notification({ title: `${request.name} wants to connect`.slice(0, 80), body: `Allow it in Pine if the device shows ${request.code}.`, silent: false });
	n.on("click", () => showWindow(pairingTarget()));
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
		changed: (s) => {
			for (const w of windows.values()) sendTo(w, "pine:access", accessForWindow(s, w));
		},
		asked: notifyAsked,
		announce: ACCESS_STAND_IN !== undefined ? undefined : (what) => announcer.announce(what),
		start: ACCESS_STAND_IN !== undefined ? (options) => startStandIn({ ...options, waitMs: Number(ACCESS_STAND_IN) || undefined }) : undefined,
	});
	accessStarted = access.start();
}

/** The access host's start, which an address handed to the app before it was up waits for. */
let accessStarted: Promise<void> | undefined;

/**
 * `pine://pair`, from the web client's "Open Pine on this computer" (ADR 0005): a pairing is opened,
 * as Add a device opens one, and its link goes to the owner's default browser, which is most likely
 * the one that asked; the page shows the Add a device dialog too, for a browser that is not the
 * default one. Nothing while browser access is off. Any site can send the owner here: the browser asks
 * first, the link goes to this computer's browser only, and nothing is kept without Allow.
 */
async function pairFromAddress(url: string): Promise<void> {
	if (!isPairAddress(url)) return;
	await accessStarted;
	if (!access) return;
	const now = await access.state();
	if (!now.enabled || now.status === "off") return;
	// A pairing open or a device asking stays as it is: opening one would cancel it, and any site may send this address.
	if (now.pairing || now.request) return;
	const opened = await access.openPairing().catch(() => undefined);
	if (!opened) return;
	openOutside(opened.link);
	const target = ensureLocalWindow();
	if (target.ready) sendTo(target, "pine:menu", "pairing-shown");
	else target.pairingShown = true;
}
/** Addresses the system handed the app before browser access existed (`open-url` on a cold start). */
const pendingAddresses: string[] = [];

/** Where the app is the system's handler of `pine:`: a packed app, or a checkout that asks for it. Never in a test. */
function registerScheme(): void {
	if (HEADLESS || ACCESS_STAND_IN !== undefined || process.env.PINE_DESKTOP_DATA) return;
	if (app.isPackaged) app.setAsDefaultProtocolClient("pine");
	// From a checkout the program is Electron's, which is given the app's folder to open.
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
		// The relay's password passes here once, to the sealed file, and is never sent back to the page.
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
	// The view frame's own document gets its own policy; its scripts are read across its opaque origin.
	return new Response(fs.readFileSync(file), { headers: { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "content-security-policy": view ? VIEW_CSP : CSP, "x-content-type-options": "nosniff", ...(/\.(js|css)$/.test(file) ? { "access-control-allow-origin": "*" } : {}) } });
}

/** Resolves and validates the calling ManagedWindow for any IPC event (main frame at app origin only). */
function windowFromEvent(e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): ManagedWindow | undefined {
	const w = byContents.get(e.sender.id);
	const frame = e.senderFrame;
	if (!w || w.win.isDestroyed() || !frame || e.sender !== w.win.webContents || frame !== w.win.webContents.mainFrame || originOf(frame.url) !== ORIGIN) return undefined;
	return w;
}

/**
 * What the system lets a page do. One thing, for the app's own page alone: write text to the clipboard,
 * which its Copy buttons and Copy Last Answer do through `navigator.clipboard` (Chromium asks for
 * `clipboard-sanitized-write`, and refuses the write without it). Writing reads nothing, and the page
 * runs no script but the app's own. A view's frame, a tab of the agent's browser and every other
 * permission (the camera, the microphone, the place, reading the clipboard) are refused.
 */
function permits(contents: Electron.WebContents | null, permission: string, details: { isMainFrame?: boolean; requestingUrl?: string }): boolean {
	return permission === "clipboard-sanitized-write" && Boolean(contents && byContents.has(contents.id) && details.isMainFrame) && originOf(details.requestingUrl ?? "") === ORIGIN;
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

interface CreateWindowOptions {
	host?: string;
	bounds?: WindowBounds;
	cascadeFrom?: ManagedWindow;
	layout?: WindowLayout;
	chromeLayout?: ChromeLayout;
	noTab?: boolean;
	initialTab?: WindowTabRef;
	initialDraft?: WindowDraft;
}

function createWindow(opts: CreateWindowOptions = {}): ManagedWindow {
	const id = `w${nextWindowId++}`;
	let b = opts.bounds;
	if (!b && opts.cascadeFrom && !opts.cascadeFrom.win.isDestroyed()) {
		const anchor = opts.cascadeFrom.win.getBounds();
		const display = screen.getDisplayMatching(anchor);
		b = cascadeBounds(anchor, display.workArea);
	}
	if (!b) b = prefs.bounds;
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
		// Off a Mac the page reaches the top too, and the system draws its window controls over its top right
		// (in the theme's colors, refreshBackground). Its menus are then not shown: their keys still work, and the
		// page's menu button opens them (pine:app-menu).
		titleBarStyle: isMac ? "hiddenInset" : "hidden",
		trafficLightPosition: { x: 16, y: 16 },
		// Gives the page where the window buttons are (env(titlebar-area-x) and -width, 0 in full screen), so the bars make room for them by themselves.
		titleBarOverlay: isMac ? true : windowControls(),
		vibrancy: isMac ? "sidebar" : undefined,
		visualEffectState: "followWindow",
		// So that the window does not flash another color before the page draws.
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
			// A window that is never shown would stop drawing once the system counted it as hidden.
			...(HEADLESS ? { backgroundThrottling: false } : {}),
		},
	});
	const initialTabs = opts.layout?.tabs ?? (opts.initialTab ? [opts.initialTab] : []);
	const w: ManagedWindow = {
		id,
		win,
		ready: false,
		focusedAt: ++focusSeq,
		terminalFocused: false,
		host: opts.host,
		state: { status: "starting", host: opts.host },
		round: 0,
		bounds: win.getBounds(),
		layout: opts.layout,
		chromeLayout: opts.chromeLayout ?? (opts.layout ? chromeOf(opts.layout) : prefs.layout),
		noTab: opts.noTab,
		initialTab: opts.initialTab,
		initialDraft: opts.initialDraft,
		pendingFolders: [],
		pendingCommands: [],
		pairingShown: false,
		look: prefs.look,
		badgeCount: 0,
		tabKeys: new Set(initialTabs.map((t) => `${t.agent}:${t.session}`)),
	};
	const wcId = win.webContents.id;
	windows.set(id, w);
	byContents.set(wcId, w);

	win.once("ready-to-show", () => void (HEADLESS || win.isDestroyed() || win.show()));
	win.webContents.setWindowOpenHandler(({ url }) => (openOutside(url), { action: "deny" }));
	win.webContents.on("will-navigate", (e, url) => {
		// The page stays the page. (Reloading it during development is the one navigation there is.)
		if (originOf(url) !== ORIGIN) {
			e.preventDefault();
			openOutside(url);
		}
	});
	win.webContents.on("will-attach-webview", (e) => e.preventDefault());
	// Off a Mac the shell's own Ctrl keys reach the shell while the terminal has the keyboard, not the menu (shellKeeps).
	if (!isMac) win.webContents.on("before-input-event", (_e, input) => !win.isDestroyed() && win.webContents.setIgnoreMenuShortcuts(w.terminalFocused && shellKeeps(input)));
	win.webContents.on("did-start-loading", () => {
		w.terminalFocused = false;
	});
	// Chromium keeps a page's zoom when it is loaded again: the controls fit the bar at that zoom.
	if (!isMac) win.webContents.on("did-finish-load", () => refreshWindowBackground(w));
	const keep = () => {
		if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
		w.bounds = win.getBounds();
		if (!quitting) prefs.windows = snapshotOpenWindows();
	};
	win.on("resize", keep);
	win.on("move", keep);
	win.on("close", () => {
		browsers.detach(win);
		if (!quitting) {
			if (!w.host || prefs.hosts.includes(w.host)) prefs.use = w.host;
			if (w.bounds) prefs.bounds = w.bounds;
			if (w.layout) prefs.layout = chromeOf(w.layout);
			else if (w.chromeLayout) prefs.layout = w.chromeLayout;
			windows.delete(w.id);
			byContents.delete(wcId);
			persistOpenWindows();
			pruneStreams();
			broadcastOpenHosts();
			refreshBadges();
		}
	});
	win.on("focus", () => {
		w.focusedAt = ++focusSeq;
		const themeKind = (w.look ?? prefs.look)?.kind ?? "dark";
		if (nativeTheme.themeSource !== themeKind) nativeTheme.themeSource = themeKind;
		sendTo(w, "pine:focus", true);
	});
	win.on("blur", () => sendTo(w, "pine:focus", false));
	win.on("closed", () => {
		browsers.detach(win);
		windows.delete(w.id);
		byContents.delete(wcId);
		terminals.closeWindow(w.id);
		if (listeningWindow === w) {
			listening?.cancel();
			listening = undefined;
			listeningWindow = undefined;
		}
		pruneStreams();
		broadcastOpenHosts();
		refreshBadges();
	});
	void win.loadURL(DEV_URL ?? "app://pine/");
	if (process.env.PINE_DESKTOP_DEVTOOLS) win.webContents.openDevTools({ mode: "detach" });
	void startService(w);
	if (!quitting) persistOpenWindows();
	broadcastOpenHosts();
	return w;
}

/** Opens a new window interactively (New Window menu/shortcut/palette, or with explicit host/tab/draft). */
function openNewWindow(options?: NewWindowOptions, caller?: ManagedWindow): ManagedWindow {
	if (windows.size >= MAX_WINDOWS) throw new Error(`There are ${MAX_WINDOWS} windows open already: close one first.`);
	const host = options?.host === null ? undefined : typeof options?.host === "string" ? options.host : (caller?.host ?? prefs.use);
	if (host !== undefined && !prefs.hosts.includes(host)) throw new Error("That machine is not in the list: add it in Settings > Environments.");
	const envAlreadyOpen = windowsForHost(host).length > 0;
	const hasTab = Boolean(options?.tab);
	const chrome = caller?.layout ? chromeOf(caller.layout) : caller?.chromeLayout ?? prefs.layout;
	const created = createWindow({
		host,
		cascadeFrom: caller ?? focusedWindow(),
		chromeLayout: chrome,
		noTab: !hasTab && envAlreadyOpen,
		initialTab: options?.tab,
		initialDraft: options?.draft,
	});
	if (options?.moveFrom && options.tab && caller && !host && !caller.host) {
		terminals.transfer(caller.id, created.id, `${options.tab.agent}:${options.tab.session}`);
	}
	return created;
}

function showWindow(target?: ManagedWindow): ManagedWindow {
	const w = target && !target.win.isDestroyed() ? target : focusedWindow();
	if (!w) return createWindow({ host: prefs.use, bounds: prefs.bounds, chromeLayout: prefs.layout });
	if (!HEADLESS) {
		if (w.win.isMinimized()) w.win.restore();
		w.win.show();
		w.win.focus();
	}
	return w;
}

function show(): ManagedWindow {
	return showWindow(focusedWindow());
}

/** Focuses the most recently active local window, or spawns a new local window when only remote or zero windows are open. */
function ensureLocalWindow(): ManagedWindow {
	const existing = primaryWindowForHost(undefined);
	if (existing) return showWindow(existing);
	const w = createWindow({ host: undefined, cascadeFrom: focusedWindow(), chromeLayout: prefs.layout });
	return showWindow(w);
}

// ---- `pine` for a terminal -----------------------------------------------------------------------

/** What the packed app carries; a checkout has none of it. */
const RESOURCES = app.isPackaged ? process.resourcesPath : undefined;

const worded = (c: Command) => ({ ...c, text: said(c) });

/**
 * Once, the first time an app that carries pine is started from where it will stay: the link is
 * made where that takes no password. Where it takes one, nothing is asked out of nowhere; the
 * menu and Settings > General offer it. Not in a second set of data for tests and trying things out.
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
/**
 * Where a release's update feed is downloaded from: pine's own releases. PINE_DESKTOP_DOWNLOADS is
 * for tests, which name a stand-in for them beside the stand-in for GitHub (a real update of a
 * signed app, from N to N+1, tried on this Mac without publishing anything).
 */
const RELEASE_DOWNLOADS = process.env.PINE_DESKTOP_DOWNLOADS || DOWNLOADS;

/** The last answer that said something, for a page that is opened again. */
let known: Update | undefined;
/** The question of this start, asked once. */
let atStart: Promise<Update> | undefined;

/** The app's own updater (updater.ts): none in an app from a checkout, unless a test names its stand-in. It tells the page how its download goes. */
const updater = makeUpdater((now) => {
	// The install failed after the app's pine was stopped for it: that pine is started again, and the page shows the failure with the release's link.
	if (installing && now.state === "failed") {
		installing = false;
		for (const w of windowsForHost(undefined)) void startService(w);
	}
	broadcast("pine:update-state", withUpdater(known));
});
/** Between "Restart to update" stopping the app's pines and the app quitting, or the updater saying it failed. */
let installing = false;

/**
 * What is said of a newer release, with how the app's own update of it goes where there is one.
 * With "Update automatically" off the page is not told of it, so that it offers the release page,
 * also for an update that was downloaded before.
 */
const withUpdater = (said: Update | undefined): Update | undefined => (said?.status === "newer" && updater && prefs.autoUpdate ? { ...said, updater: updater.state() } : said);

/** A newer release is downloaded when the owner lets the app update itself. */
function downloadUpdate(): void {
	if (known?.status === "newer" && known.feed && updater && prefs.autoUpdate) updater.download(known.feed, known.version);
}

async function askForUpdate(): Promise<Update> {
	const said = await lookForUpdate(app.getVersion(), process.arch, RELEASE_API, RELEASE_DOWNLOADS);
	if (said.status !== "unknown") known = said;
	downloadUpdate();
	return withUpdater(said) as Update;
}

/**
 * "Restart to update": every pine this app started on this computer in this run is stopped first,
 * one that was to be kept running too (it would go on with the old version), and none it only
 * attached to. The connections to other machines end with the quit, as at any quit. Then the
 * updater quits and installs.
 */
async function installUpdate(): Promise<void> {
	if (!updater || !prefs.autoUpdate || updater.state().state !== "ready") throw new Error("There is no update ready to install.");
	installing = true;
	for (const entry of streams.values()) entry.abort.abort();
	streams.clear();
	const ours = [...held.entries()].filter(([, s]) => s.started && !s.host);
	for (const [key] of ours) held.delete(key);
	await Promise.all(ours.map(([, s]) => s.stop(true)));
	updater.install();
}

/**
 * What the page is told: with `again` (the menu, the settings) what GitHub says now, without it
 * what the start found. A start that got no answer asks again when the window is next opened.
 */
async function update(again?: boolean): Promise<Update | undefined> {
	if (!RELEASE_API) return undefined;
	if (again) return askForUpdate();
	if (prefs.updates) await (atStart ??= askForUpdate().then((said) => (said.status === "unknown" && (atStart = undefined), said)));
	return withUpdater(known);
}

// ---- menus -------------------------------------------------------------------------------------

/** Resolves the ManagedWindow for a menu click (focused window, else most recently focused, or newly created). */
function menuTarget(bw?: Electron.BaseWindow): ManagedWindow {
	if (bw && "webContents" in bw) {
		const w = byContents.get((bw as BrowserWindow).webContents.id);
		if (w && !w.win.isDestroyed()) return w;
	}
	return show();
}

/** A menu item that asks the focused window's page to do something: the page knows which conversation is in front. */
const item = (label: string, command: string, accelerator?: string, more: MenuItemConstructorOptions = {}): MenuItemConstructorOptions => ({
	label,
	accelerator,
	click: (_m, bw) => {
		const w = menuTarget(bw);
		sendTo(w, "pine:menu", command);
	},
	...more,
});

function buildMenu(): void {
	const template: MenuItemConstructorOptions[] = [
		...(isMac
			? [
					{
						label: "Pine",
						submenu: [{ role: "about" as const }, ...(RELEASE_API ? [item("Check for Updates…", "updates")] : []), { type: "separator" as const }, item("Settings…", "settings", "Cmd+,"), item("Add a Device…", "add-device", "Cmd+Shift+D"), ...(RESOURCES && fs.existsSync(path.join(RESOURCES, "bin", "pine")) ? [{ label: "pine in a Terminal…", click: () => void commandFromMenu() }] : []), { type: "separator" as const }, { role: "services" as const }, { type: "separator" as const }, { role: "hide" as const }, { role: "hideOthers" as const }, { role: "unhide" as const }, { type: "separator" as const }, { role: "quit" as const }],
					},
				]
			: []),
		{
			label: "File",
			submenu: [
				{
					label: "New Window",
					accelerator: "CmdOrCtrl+N",
					click: (_m, bw) => {
						const from = bw && "webContents" in bw ? byContents.get((bw as BrowserWindow).webContents.id) : focusedWindow();
						if (windows.size < MAX_WINDOWS) openNewWindow(undefined, from);
					},
				},
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
				{
					label: "Close Tab",
					accelerator: "CmdOrCtrl+W",
					click: (_m, bw) => {
						const w = bw && "webContents" in bw ? byContents.get((bw as BrowserWindow).webContents.id) : focusedWindow();
						if (!w || w.win.isDestroyed()) return;
						if (!w.ready) w.win.close();
						else sendTo(w, "pine:menu", "close");
					},
				},
				{
					label: "Close Window",
					accelerator: "CmdOrCtrl+Shift+W",
					click: (_m, bw) => {
						const w = bw && "webContents" in bw ? byContents.get((bw as BrowserWindow).webContents.id) : focusedWindow();
						if (w && !w.win.isDestroyed()) w.win.close();
					},
				},
				...(isMac ? [] : [{ type: "separator" as const }, item("Settings…", "settings", "Ctrl+,"), item("Add a Device…", "add-device", "Ctrl+Shift+D"), { role: "quit" as const }]),
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
				// Off a Mac the window's controls are as tall as the bar, which zooms with the page: they follow it (zoomBy). The keys are the roles' own.
				...(isMac
					? [{ role: "resetZoom" as const }, { role: "zoomIn" as const }, { role: "zoomOut" as const }]
					: [
							{ label: "Actual Size", accelerator: "CmdOrCtrl+0", click: (_m, bw) => zoomBy(menuTarget(bw), undefined) },
							{ label: "Zoom In", accelerator: "CmdOrCtrl+Plus", click: (_m, bw) => zoomBy(menuTarget(bw), 0.5) },
							{ label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: (_m, bw) => zoomBy(menuTarget(bw), -0.5) },
						]),
				{ type: "separator" },
				{ role: "togglefullscreen" },
				// From a checkout only. The developer tools have the Mac's key everywhere (⌥⌘I, Ctrl+Alt+I): Electron's own elsewhere,
				// Ctrl+Shift+I, is the Agent view's above. Reload is ⌘R on a Mac, beside Dictate's ⌃R; elsewhere both would be
				// Ctrl+R, which stays Dictate's, and Reload is F5.
				...(app.isPackaged ? [] : [{ type: "separator" as const }, { role: "reload" as const, ...(isMac ? {} : { accelerator: "F5" }) }, { role: "toggleDevTools" as const, accelerator: "CmdOrCtrl+Alt+I" }]),
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
		// The Mac's Window menu has no Close, and ⌘W closes the tab. Electron's elsewhere has Close on Ctrl+W, Close Tab's key:
		// there it is the Mac's, and the window closes with its own button, as with the red one.
		isMac ? { role: "windowMenu" } : { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }] },
		{ role: "help", submenu: [item("Keys and Commands", "help"), ...(RELEASE_API && !isMac ? [item("Check for Updates…", "updates")] : []), { label: "pine on GitHub", click: () => openOutside("https://github.com/pmndre/pine") }] },
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
	// The Dock's menu: open a new window or add a device while Pine is in the background.
	if (isMac)
		app.dock?.setMenu(
			Menu.buildFromTemplate([
				{ label: "New Window", click: () => (windows.size < MAX_WINDOWS ? openNewWindow(undefined, focusedWindow()) : undefined) },
				{
					label: "Add a Device…",
					click: () => {
						const target = ensureLocalWindow();
						if (target.ready) sendTo(target, "pine:menu", "add-device");
						else target.pendingCommands.push("add-device");
					},
				},
			]),
		);
}

// ---- what the page may ask for -----------------------------------------------------------------

function handle<T extends unknown[]>(channel: string, fn: (w: ManagedWindow, ...args: T) => unknown): void {
	ipcMain.handle(channel, (e, ...args) => {
		const w = windowFromEvent(e);
		if (!w) throw new Error("not from the app's page");
		return fn(w, ...(args as T));
	});
}

/** Recent notification timestamps keyed by (host, tab, title, body) to suppress duplicates across windows. */
const recentNotifs = new Map<string, number>();

function wire(): void {
	handle("pine:state", (w) => {
		const envKey = w.host ?? "";
		const stream = streams.get(envKey);
		const initialTab = w.initialTab;
		const initialDraft = w.initialDraft;
		const noTab = w.noTab;
		// One-shot startup hints are consumed on the first state read; subsequent reloads restore w.layout.
		w.initialTab = undefined;
		w.initialDraft = undefined;
		w.noTab = undefined;
		return {
			state: w.state,
			connected: Boolean(w.service && stream?.service === w.service && stream.connected),
			home: prefs.home ?? process.env.PINE_HOME,
			prefs: publicPrefs(),
			platform: process.platform,
			focused: !w.win.isDestroyed() && w.win.isFocused(),
			updates: Boolean(RELEASE_API),
			versions: { app: app.getVersion(), electron: process.versions.electron },
			views: true,
			selfUpdate: Boolean(updater),
			windowId: w.id,
			windowLayout: w.layout,
			chromeLayout: w.chromeLayout,
			noTab,
			initialTab,
			initialDraft,
			openHosts: openHostsList(),
		};
	});
	handle("pine:call", async (w, method: string, url: string, body?: unknown) => {
		// The app says again and again that it shows the browser. To this computer's pine it also says where its own
		// browser is, with the word to reach it, which the page never holds.
		if (method === "POST" && url === "/browser/embedded" && w.service && !w.service.host) {
			await browsers.start().catch(() => {});
			return callDaemon(w.service, method, url, { host: browsers.url });
		}
		// Protect tab-scoped subscriptions when closing a non-main conversation tab that is still open in another window on the same environment.
		if (method === "POST") {
			const m = /^\/agents\/([^/]+)\/close$/.exec(url);
			const session = body && typeof body === "object" && typeof (body as { session?: unknown }).session === "string" ? (body as { session: string }).session : "";
			if (m && session) {
				const key = `${decodeURIComponent(m[1])}:${session}`;
				const heldElsewhere = windowsForHost(w.host).some((other) => other !== w && other.tabKeys.has(key));
				if (heldElsewhere) return { ok: true, status: 200, data: { unsubscribed: [] } };
			}
		}
		const res = await callDaemon(w.service, method, url, body);
		if (method === "GET" && url === "/approvals" && res.ok && Array.isArray(res.data)) {
			const entry = streams.get(w.host ?? "");
			if (entry) {
				entry.approvals.clear();
				for (const item of res.data) if (item && typeof item.id === "string") entry.approvals.add(item.id);
				refreshBadges();
			}
		}
		return res;
	});
	// Where the browser panel is, and which conversation's tab is in front there: its page is laid over the panel.
	handle("pine:browser-show", (w, key: unknown, index: unknown, bounds: unknown) => {
		const b = bounds as Partial<Bounds> | undefined;
		const fine = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
		const place = b && fine(b.x, 20_000) && fine(b.y, 20_000) && fine(b.width, 20_000) && fine(b.height, 20_000) && b.width >= 1 && b.height >= 1 ? { x: b.x, y: b.y, width: b.width, height: b.height } : undefined;
		// (The page's places are in its own points, which the window's zoom makes larger or smaller.)
		const zoom = w.win.webContents.getZoomFactor() ?? 1;
		const scaled = place && { x: Math.round(place.x * zoom), y: Math.round(place.y * zoom), width: Math.round(place.width * zoom), height: Math.round(place.height * zoom) };
		return browsers.show(w.win, typeof key === "string" && !w.service?.host ? key : undefined, fine(index, 99) ? index : 0, scaled);
	});
	handle("pine:browser-focus", (w) => browsers.focus(w.win));
	handle("pine:browser-picture", (w) => browsers.picture(w.win));
	handle("pine:retry", (w) => startService(w));
	handle("pine:update", (_w, again?: boolean) => update(again === true));
	handle("pine:install-update", () => installUpdate());
	handle("pine:restart", async (w) => {
		// Only a daemon of this app's own is its to restart; another one is somebody's terminal.
		const s = w.service;
		if (!s?.started) throw new Error("this pine was started somewhere else (a terminal, a service). Restart it there.");
		const envKey = s.host ?? "";
		const entry = streams.get(envKey);
		if (entry?.service === s) {
			entry.abort.abort();
			streams.delete(envKey);
		}
		held.delete(envKey);
		await s.stop();
		for (const viewer of windowsForHost(s.host)) void startService(viewer);
	});
	handle("pine:init", async (w) => {
		launch ??= await findPine(APP_ROOT, app.isPackaged ? process.resourcesPath : undefined);
		const linux = process.platform === "linux";
		const args = ["init", ...(prefs.home ? [prefs.home] : []), ...(linux ? [] : ["--yes"])];
		let leftToOwner = false;
		const code = await runPine(
			launch,
			args,
			(line) => {
				if (linux && line.includes("Nobody is here to say yes")) leftToOwner = true;
				sendTo(w, "pine:init-line", line);
			},
			process.env.PINE_SKIP_DOWNLOADS ? { PINE_SKIP_DOWNLOADS: "1" } : {},
		);
		return code === 0 && leftToOwner ? "administrator" : code;
	});
	handle("pine:browser", async (w) => {
		launch ??= await findPine(APP_ROOT, app.isPackaged ? process.resourcesPath : undefined);
		return runPine(launch, ["browser-install"], (line) => sendTo(w, "pine:init-line", line), process.env.PINE_SKIP_DOWNLOADS ? { PINE_SKIP_DOWNLOADS: "1" } : {});
	});
	handle("pine:command", async (_w, action?: string) => {
		const env = await loginEnv();
		return worded(action === "install" ? await install(RESOURCES, env) : action === "remove" ? await remove(RESOURCES, env) : look(RESOURCES, env));
	});
	handle("pine:use", (w, host?: string) => useInWindow(w, typeof host === "string" ? host : undefined));
	handle("pine:new-window", (w, raw?: unknown) => {
		openNewWindow(cleanNewWindowOptions(raw), w);
	});
	handle("pine:close-window", (w) => {
		if (!w.win.isDestroyed()) w.win.close();
	});
	handle("pine:window-layout", async (w, raw: unknown) => {
		const layout = cleanWindowLayout(raw);
		if (!layout) return;
		// Ignore stale in-flight snapshots from before an environment switch in this window.
		if ((layout.host ?? "") !== (w.host ?? "")) return;
		w.layout = layout;
		w.chromeLayout = chromeOf(layout);
		w.tabKeys = new Set(layout.tabs.map((t) => `${t.agent}:${t.session}`));
		if (!quitting) persistOpenWindows();
		await syncDaemonTabs(w.host, w);
	});
	// A machine is added by its name alone; it is connected to when it is picked.
	handle("pine:hosts-add", (_w, value: string) => {
		const host = hostOf(String(value ?? ""));
		if (!host) throw new Error("Write the machine as you would after ssh: host or user@host.");
		if (host.startsWith("wsl:") && process.platform !== "win32") throw new Error("WSL is Windows': this computer has none.");
		if (!prefs.hosts.includes(host)) {
			if (prefs.hosts.length >= 20) throw new Error("There are 20 machines in the list already: forget one first.");
			prefs.hosts.push(host);
			savePrefs();
			broadcastPrefs();
		}
		return publicPrefs();
	});
	handle("pine:hosts-forget", (w, host: string, options?: { closeWindows?: boolean }) => {
		const using = windowsForHost(host);
		if (using.includes(w)) throw new Error("The app uses this machine now. Use another one first.");
		if (using.length && !options?.closeWindows) throw new Error("Another window uses this machine now.");
		if (prefs.hosts.includes(host)) notePrefs(prefsFile(), `machine ${host} left the list: forgotten in Settings > Environments`);
		prefs.hosts = prefs.hosts.filter((h) => h !== host);
		if (prefs.use === host) prefs.use = undefined;
		for (const other of using) if (!other.win.isDestroyed()) other.win.close();
		savePrefs();
		// Its connection ends, and a pine it started there with it.
		const s = held.get(String(host));
		if (s) (held.delete(String(host)), void letGo(s));
		pruneStreams();
		broadcastPrefs();
		broadcastOpenHosts();
		return publicPrefs();
	});
	handle("pine:prefs", (w, change: Partial<Prefs>) => {
		let globalChanged = false;
		if (typeof change.notify === "boolean") {
			prefs.notify = change.notify;
			globalChanged = true;
		}
		if (typeof change.updates === "boolean") {
			prefs.updates = change.updates;
			globalChanged = true;
		}
		if (typeof change.autoUpdate === "boolean") {
			prefs.autoUpdate = change.autoUpdate;
			globalChanged = true;
			// Turned on with a newer release known: it is downloaded now. Either way the page is told how the update stands.
			downloadUpdate();
			broadcast("pine:update-state", withUpdater(known));
		}
		if (typeof change.keepRunning === "boolean") {
			prefs.keepRunning = change.keepRunning;
			globalChanged = true;
		}
		if ("home" in change) {
			const home = typeof change.home === "string" && change.home.trim() ? change.home.trim() : undefined;
			if (home !== prefs.home) {
				prefs.home = home;
				globalChanged = true;
				// Another home is another pine: let go of the old local service and reconnect every open local window.
				const old = held.get("");
				if (old) {
					held.delete("");
					const entry = streams.get("");
					if (entry?.service === old) {
						entry.abort.abort();
						streams.delete("");
					}
					void letGo(old);
				}
				for (const viewer of windowsForHost(undefined)) void startService(viewer);
			}
		}
		// The theme this window's environment draws now: each window keeps its own background/overlay,
		// while OS-level nativeTheme.themeSource follows the focused window.
		if ("look" in change) {
			const look = cleanLook(change.look);
			w.look = look;
			refreshWindowBackground(w);
			if (w.win.isFocused() || focusedWindow() === w) {
				prefs.look = look;
				nativeTheme.themeSource = look?.kind ?? "dark";
				globalChanged = true;
			}
		}
		if (globalChanged) {
			savePrefs();
			broadcastPrefs();
		}
		return publicPrefs();
	});
	// Browser access: its state, and the owner's changes to it.
	handle("pine:access", async (w) => accessForWindow(await accessOn().state(), w));
	handle("pine:access-set", async (w, change: unknown) => accessForWindow(await accessOn().set(accessChange(change)), w));
	handle("pine:access-pair", () => accessOn().openPairing());
	handle("pine:access-cancel", () => accessOn().cancelPairing());
	// The link of the open pairing, put on the clipboard here: the page is never told the link, so it cannot copy it itself.
	handle("pine:access-copy", async () => {
		const { pairing } = await accessOn().state();
		if (!pairing) throw new Error("No pairing is open now: press Add a device.");
		clipboard.writeText(pairing.link);
	});
	handle("pine:access-answer", (_w, yes: unknown, id: unknown) => accessOn().answer(yes === true, typeof id === "string" ? id.slice(0, 64) : undefined));
	handle("pine:access-remove", (_w, id: unknown) => {
		if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("That is not a device of the list.");
		return accessOn().remove(id);
	});
	handle("pine:pick-folder", async (w, title?: string) => {
		const r = await dialog.showOpenDialog(w.win, { title: typeof title === "string" ? title.slice(0, 80) : "Choose a folder", properties: ["openDirectory", "createDirectory"] });
		if (r.canceled) return undefined;
		const p = forDaemon(w.host, r.filePaths[0]);
		if (!p) throw new Error(`${r.filePaths[0]} cannot be reached from ${wslOf(w.host)}: pick a folder on a drive of this computer, or one in the distribution.`);
		return p;
	});
	// A file dropped on the page, by the path the daemon knows it under.
	ipcMain.on("pine:daemon-path", (e, p: unknown) => {
		const w = windowFromEvent(e);
		if (!w) {
			e.returnValue = "";
			return;
		}
		e.returnValue = typeof p === "string" && p ? (forDaemon(w.host, p) ?? "") : "";
	});
	// WSL on this Windows computer: its distributions, and the pine this app carries brought into one.
	handle("pine:wsl-distros", async () => (process.platform === "win32" ? await wslDistros() : []));
	handle("pine:wsl-install", async (_w, distro: string) => {
		if (process.platform !== "win32" || !app.isPackaged) throw new Error("Only the Pine app for Windows brings pine into WSL.");
		const d = hostOf(`wsl:${String(distro)}`)?.slice(4);
		if (!d) throw new Error("There is no such distribution.");
		await installIntoWsl(d, app.getVersion(), process.resourcesPath);
		await new Promise<void>((resolve, reject) => {
			const c = spawn("wsl.exe", ["--distribution", d, "--exec", "/bin/sh", "-c", '"$HOME/.local/share/pine-app/bin/pine" init'], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
			let err = "";
			c.stderr!.on("data", (b: Buffer) => (err += b.toString("utf8")));
			c.on("error", reject);
			c.on("close", (code) => (code === 0 || /sandbox/i.test(err) ? resolve() : reject(new Error(err.trim().slice(-400) || `pine init ended with ${code}`))));
		});
		return { sandbox: `wsl --distribution ${d} --exec ~/.local/share/pine-app/bin/pine init` };
	});
	handle("pine:save-text", async (w, name: string, text: string) => {
		const r = await dialog.showSaveDialog(w.win, { defaultPath: path.join(app.getPath("documents"), path.basename(String(name))) });
		if (r.canceled || !r.filePath) return undefined;
		fs.writeFileSync(r.filePath, String(text));
		return r.filePath;
	});
	handle("pine:open", (_w, url: string) => openOutside(String(url)));
	handle("pine:reveal", (w, file: string) => {
		// Shown in the Finder, never opened: opening would start whatever the file is. A path of WSL's is Windows' first.
		const d = wslOf(w.host);
		const here = typeof file === "string" && d && file.startsWith("/") ? fromWsl(file, d) : file;
		if (typeof here === "string" && path.isAbsolute(here) && fs.existsSync(here)) shell.showItemInFolder(here);
	});
	handle("pine:notify", (w, title: string, body: string, tab?: string) => {
		if (!prefs.notify || !Notification.isSupported()) return;
		// Suppress if the calling window is focused, or if any focused window on the same environment already shows this conversation.
		if (w.win.isFocused()) return;
		if (tab && windowsForHost(w.host).some((other) => other.win.isFocused() && other.tabKeys.has(tab))) return;
		const now = Date.now();
		const dedupeKey = `${w.host ?? ""}|${tab ?? ""}|${String(title).slice(0, 80)}|${String(body).slice(0, 160)}`;
		const last = recentNotifs.get(dedupeKey);
		if (last && now - last < 2000) return;
		recentNotifs.set(dedupeKey, now);
		if (recentNotifs.size > 100) for (const [k, ts] of recentNotifs) if (now - ts > 10_000) recentNotifs.delete(k);
		const n = new Notification({ title: String(title).slice(0, 80), body: String(body).slice(0, 160), silent: false });
		n.on("click", () => {
			showWindow(w);
			if (tab) sendTo(w, "pine:menu", `focus:${tab}`);
		});
		n.show();
	});
	handle("pine:badge", (w, count: number) => {
		w.badgeCount = Math.max(0, Number(count) || 0);
		refreshBadges();
	});
	// Dictating a message. The words are recognised on this computer by the helper the terminal UI
	// uses too (src/tui/voice.ts): voice.swift on a Mac, voice.cs on Windows, whisper.cpp on Linux.
	handle("pine:voice-start", async (w, language?: string) => {
		const prev = listeningWindow;
		listening?.cancel();
		listening = undefined;
		listeningWindow = w;
		if (prev && prev !== w && !prev.win.isDestroyed()) sendTo(prev, "pine:voice", { type: "done" });
		const lang = typeof language === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language) ? language : undefined;
		let command: string[];
		try {
			if (process.env.PINE_DESKTOP_VOICE) command = process.env.PINE_DESKTOP_VOICE.startsWith("[") ? (JSON.parse(process.env.PINE_DESKTOP_VOICE) as string[]).map(String) : [process.env.PINE_DESKTOP_VOICE];
			else {
				if (!isMac && !isWindows && process.platform !== "linux") throw new Error(NOT_HERE);
				if (isWindows) {
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
			if (listeningWindow === w) listeningWindow = undefined;
			throw e;
		}
		if (w.win.isDestroyed() || listeningWindow !== w) return;
		const mine: Listening = new Listening(command, lang, {
			ready: () => listening === mine && sendTo(w, "pine:voice", { type: "ready" }),
			partial: (text) => listening === mine && sendTo(w, "pine:voice", { type: "partial", text }),
			model: (state) => listening === mine && sendTo(w, "pine:voice", { type: "model", state }),
			done: (text, error) => {
				if (listening !== mine) return;
				listening = undefined;
				listeningWindow = undefined;
				sendTo(w, "pine:voice", { type: "done", text, error });
			},
		});
		listening = mine;
	});
	handle("pine:voice-stop", (w, cancel?: boolean) => {
		if (w !== listeningWindow) return;
		if (cancel) (listening?.cancel(), (listening = undefined), (listeningWindow = undefined));
		else listening?.stop();
	});
	// The owner's terminal beside a conversation. What is written into it comes from the page's
	// keyboard, or from a code block of an answer that the owner ran with its button.
	handle("pine:term-open", (w, id: string, cwd?: string, cols?: number, rows?: number) => terminals.open(String(id), cwd, cols, rows, w.id));
	handle("pine:term-write", (w, id: string, data: string) => terminals.write(String(id), data, w.id));
	handle("pine:term-run", (w, id: string, code: string) => terminals.run(String(id), code, w.id));
	handle("pine:term-resize", (w, id: string, cols: number, rows: number) => terminals.resize(String(id), cols, rows, w.id));
	handle("pine:term-close", (w, id: string) => terminals.close(String(id), w.id));
	// Off a Mac the window shows no menu bar (createWindow): the page's menu button opens the menus at its place, given in the page's pixels.
	handle("pine:app-menu", (w, x: number, y: number) => {
		if (w.win.isDestroyed() || isMac) return;
		const zoom = w.win.webContents.getZoomFactor();
		Menu.getApplicationMenu()?.popup({ window: w.win, x: Math.round((Number(x) || 0) * zoom), y: Math.round((Number(y) || 0) * zoom) });
	});
	// An item with `checked` is one of a set of choices (the side bar's "Sort by"), drawn with the system's mark.
	handle("pine:context-menu", (w, items: Array<{ id: string; label: string; enabled?: boolean; separator?: boolean; danger?: boolean; checked?: boolean }>) => {
		return new Promise<string | undefined>((resolve) => {
			let picked: string | undefined;
			const menu = Menu.buildFromTemplate(items.slice(0, 30).map((i) => (i.separator ? { type: "separator" as const } : { label: String(i.label).slice(0, 80), enabled: i.enabled !== false, ...(typeof i.checked === "boolean" ? { type: "radio" as const, checked: i.checked } : {}), click: () => (picked = String(i.id)) })));
			menu.popup({ window: w.win, callback: () => resolve(picked) });
		});
	});
}

/** A dot for the taskbar button on Windows, drawn here: 16 pixels, in the theme's color for what is wrong or waits. */
function waiting(): Electron.NativeImage {
	const hex = (prefs.look?.colors.bad ?? "#d0679d").slice(1, 7);
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

/** Folders handed to the app before initial windows are created (e.g. cold-start macOS open-file). */
const startupFolders: string[] = [];
let appStarted = false;
function openFolder(dir: string): void {
	try {
		if (!fs.statSync(dir).isDirectory()) return;
	} catch {
		return;
	}
	if (!appStarted) {
		startupFolders.push(dir);
		return;
	}
	const target = ensureLocalWindow();
	if (target.ready) sendTo(target, "pine:menu", `folder:${dir}`);
	else target.pendingFolders.push(dir);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on("second-instance", (_e, argv) => {
		// On Windows and Linux an address the system opens the app with comes as an argument of a second start.
		const address = argv.find((a) => a.toLowerCase().startsWith("pine:"));
		if (address) return void pairFromAddress(address);
		const dir = folderIn(argv);
		if (dir) return void openFolder(dir);
		show();
	});
	// On macOS an address comes as an event, also before the app is ready.
	app.on("open-url", (e, url) => {
		e.preventDefault();
		// A cold start: the address comes before the app is ready, and is kept until browser access exists.
		if (!accessStarted) pendingAddresses.push(url);
		else void pairFromAddress(url);
	});
	app.on("open-file", (e, file) => {
		e.preventDefault();
		openFolder(file);
	});
	app.on("web-contents-created", (_e, contents) => {
		// Nothing the page shows gets the camera, the microphone, the place or anything else of the system's (`permits`).
		contents.session.setPermissionRequestHandler((wc, permission, done, details) => done(permits(wc, permission, details)));
	});
	void app.whenReady().then(() => {
		loadPrefs();
		protocol.handle("app", page);
		protocol.handle("pine-media", media);
		session.defaultSession.setPermissionRequestHandler((wc, permission, done, details) => done(permits(wc, permission, details)));
		wire();
		ipcMain.on("pine:term-focus", (e, focused) => {
			const w = windowFromEvent(e);
			if (w) w.terminalFocused = focused === true;
		});
		startAccess();
		registerScheme();
		for (const url of pendingAddresses.splice(0)) void pairFromAddress(url);
		// The first start on Windows and Linux: the address is an argument of this one.
		const address = process.argv.find((a) => a.toLowerCase().startsWith("pine:"));
		if (address) void pairFromAddress(address);
		ipcMain.on("pine:ready", (e) => {
			const w = windowFromEvent(e);
			if (!w) return;
			w.ready = true;
			sendTo(w, "pine:service", w.state);
			const envKey = w.host ?? "";
			const entry = streams.get(envKey);
			if (w.service && entry?.service === w.service) sendTo(w, "pine:connection", entry.connected);
			for (const dir of w.pendingFolders.splice(0)) sendTo(w, "pine:menu", `folder:${dir}`);
			for (const cmd of w.pendingCommands.splice(0)) sendTo(w, "pine:menu", cmd);
			if (w.pairingShown) {
				w.pairingShown = false;
				sendTo(w, "pine:menu", "pairing-shown");
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
		// Restore every saved window from the previous quit; otherwise open one window seeded from /ui/tabs.
		const savedWindows = prefs.windows ?? [];
		if (savedWindows.length > 0) {
			for (const snap of savedWindows) {
				createWindow({
					host: snap.host,
					bounds: snap.bounds,
					layout: snap.layout,
				});
			}
		} else {
			createWindow({
				host: prefs.use,
				bounds: prefs.bounds,
				chromeLayout: prefs.layout,
			});
		}
		appStarted = true;
		for (const dir of startupFolders.splice(0)) openFolder(dir);
		// Off a Mac a folder the app was started with comes as an argument of this first start, not as an event.
		const dir = isMac ? undefined : folderIn(process.argv);
		if (dir) openFolder(dir);
		void firstCommand();
		app.on("activate", () => {
			if (windows.size === 0) createWindow({ host: prefs.use, bounds: prefs.bounds, chromeLayout: prefs.layout });
			else show();
		});
	});
	app.on("window-all-closed", () => {
		// On a Mac the app, and the daemon it started, stay when all windows are closed.
		if (!isMac) app.quit();
	});
	app.on("before-quit", (e) => {
		if (quitting) return;
		// Snapshot all currently open windows before setting quitting=true and before Electron closes them.
		persistOpenWindows();
		quitting = true;
		updater?.quitting();
		terminals.closeAll();
		browsers.close();
		// Browser access closes its sockets; its daemon is one of those held, and follows them.
		void access?.stop();
		announcer.stop();
		for (const entry of streams.values()) entry.abort.abort();
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
