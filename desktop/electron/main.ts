// The app's main process. It owns three things the page must not: the daemon's token, the
// operating system (windows, menus, dialogs, notifications), and the child that is the daemon
// when this app had to start one. The page gets a narrow bridge (preload.ts) and nothing else.
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, type MenuItemConstructorOptions, nativeImage, nativeTheme, Notification, protocol, safeStorage, session, shell } from "electron";
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
	bounds?: { x?: number; y?: number; width: number; height: number };
	/** Browser access: on or off, the service's address, open at login (access/control.ts). The host key and the devices are a file of their own beside this one. */
	access: AccessPrefs;
}

const prefsFile = () => path.join(app.getPath("userData"), "prefs.json");
let prefs: Prefs = { keepRunning: false, hosts: [], notify: true, updates: true, autoUpdate: true, commandTried: false, access: readAccessPrefs(undefined) };

function loadPrefs(): void {
	try {
		const raw = JSON.parse(fs.readFileSync(prefsFile(), "utf8"));
		prefs = {
			home: typeof raw.home === "string" && raw.home ? raw.home : undefined,
			keepRunning: raw.keepRunning === true,
			hosts: readHosts(raw.hosts),
			use: undefined,
			notify: raw.notify !== false,
			updates: raw.updates !== false,
			autoUpdate: raw.autoUpdate !== false,
			commandTried: raw.commandTried === true,
			look: cleanLook(raw.look),
			bounds: raw.bounds && Number(raw.bounds.width) > 300 && Number(raw.bounds.height) > 200 ? raw.bounds : undefined,
			access: readAccessPrefs(raw.access),
		};
		// Only a machine that is in the list: what else might be written there is not connected to.
		if (typeof raw.use === "string" && prefs.hosts.includes(raw.use)) prefs.use = raw.use;
	} catch {
		// first start
	}
	nativeTheme.themeSource = prefs.look?.kind ?? "dark";
}

/**
 * What the window shows before the page draws: the page color of the theme it was last drawn in
 * (pmndre's before there was one). On a Mac the window is transparent, behind its vibrancy.
 */
function windowBackground(): string {
	if (isMac) return "#00000000";
	return (prefs.look?.colors.bg ?? "#1b1e28").slice(0, 7);
}

/**
 * How tall the bar along the top of the page is (h-11 at the page's 15px, index.css): off a Mac the
 * system draws its window controls over the page at its top right (titleBarOverlay), as tall as it.
 */
const TITLE_BAR = 41;

/** The system's window controls off a Mac, in the theme's colors: on the bar's background (the page's `sunk`), drawn in its quieter text. */
function windowControls(): { color: string; symbolColor: string; height: number } {
	const colors = prefs.look?.colors;
	return { color: (colors?.sunk ?? "#171922").slice(0, 7), symbolColor: (colors?.["text-muted"] ?? colors?.text ?? "#a6accd").slice(0, 7), height: TITLE_BAR };
}

/** Repaints the window's background (and off a Mac its controls) for the current theme; a no-op before the window exists. */
function refreshBackground(): void {
	if (!win || win.isDestroyed()) return;
	win.setBackgroundColor(windowBackground());
	if (!isMac) win.setTitleBarOverlay(windowControls());
}

function savePrefs(): void {
	try {
		fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
		fs.writeFileSync(prefsFile(), `${JSON.stringify(prefs, null, 2)}\n`);
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

let win: BrowserWindow | undefined;
/** The agents' browsers, in this window: for this computer's pine only, whose browser servers can reach it. */
const browsers = new BrowserHost(() => win);
let service: Service | undefined;
let launch: Launch | undefined;
let state: ServiceState = { status: "starting" };
let stream: AbortController | undefined;
/** Whether the event stream of the pine in use is up: told again to a page that was loaded anew, which knows nothing of it. */
let connected = false;
/** Counts up with each start, so that a start that was overtaken (another machine was picked meanwhile) lets go of what it found. */
let round = 0;
let quitting = false;
let listening: Listening | undefined;
/** Whether the owner's terminal has the keyboard, as the page says (`pine:term-focus`). */
let terminalFocused = false;

const send = (channel: string, ...args: unknown[]) => {
	if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
};

/** The owner's terminal of each conversation (terminal.ts): their own shell, which ends with the app. */
// A block run with a Run button reports how it went to the page, which tells the conversation through the daemon.
const terminals = new Terminals(
	{ data: (id, data) => send("pine:term-data", id, data), exit: (id, code) => send("pine:term-exit", id, code), run: (id, report) => send("pine:term-run", id, report) },
	{ env: loginEnv, hooks: path.join(app.getPath("userData"), "shell-hooks"), shell: process.env.PINE_DESKTOP_SHELL ? [process.env.PINE_DESKTOP_SHELL] : undefined, stillRunningMs: Number(process.env.PINE_DESKTOP_STILL_RUNNING_MS) || undefined },
);

function setState(next: ServiceState): void {
	state = next;
	send("pine:service", state);
}

async function startService(): Promise<void> {
	stream?.abort();
	const mine = ++round;
	const host = prefs.use;
	service = undefined;
	connected = false;
	setState({ status: "starting", host });
	try {
		const s = await hold(host);
		// Another machine was picked while this one connected: it stays held, and the other is shown.
		if (mine !== round) return;
		service = s;
		setState({ status: "ready", mode: s.mode, started: s.started, home: s.home, version: s.version, from: host ? (host.startsWith("wsl:") ? `wsl ${host.slice(4)}` : `ssh ${host}`) : (launch?.from ?? ""), host: s.host, label: s.label, olderThan: olderThan(s, host) });
		follow(s);
	} catch (e) {
		if (mine !== round) return;
		setState({ status: "error", kind: e instanceof ServiceError ? e.kind : "failed", message: e instanceof Error ? e.message : String(e), host });
	}
}

/**
 * The pines this app holds: this computer's ("") and each machine's it used, by host. Switching
 * changes which one the window shows and lets go of none, so that an agent at work in one goes on
 * while another is shown. They are let go of when the app quits.
 */
const held = new Map<string, Service>();

/** The WSL distribution whose pine the app uses now, if it uses one. */
const wslNow = () => (prefs.use?.startsWith("wsl:") ? prefs.use.slice(4) : undefined);

/** A path of this computer as the daemon in use knows it: the same, or under /mnt in WSL (undefined where WSL cannot reach it). */
const forDaemon = (p: string) => {
	const d = wslNow();
	return d ? toWsl(p, d) : p;
};

/**
 * The pine of a machine (none: this computer's) as the app holds it: the one held from before when
 * it answers still, else one made anew and held. The window uses it, and browser access for this
 * computer's, also while the window shows another machine's pine.
 */
async function hold(host: string | undefined): Promise<Service> {
	let s = held.get(host ?? "");
	// One held from before answers still: it is used again at once. One that does not is let go of and made anew.
	if (s && !(await answers(s))) {
		if (held.get(host ?? "") === s) held.delete(host ?? "");
		void letGo(s);
		s = undefined;
	}
	if (s) return s;
	const made = host ? await connectSsh(host, await loginEnv()) : await connect((launch = await findPine(APP_ROOT, app.isPackaged ? process.resourcesPath : undefined)), { home: prefs.home ?? process.env.PINE_HOME, keep: prefs.keepRunning });
	// Asked for twice (Try again while it connected, or browser access at the same time): the one that came first is kept.
	const first = held.get(host ?? "");
	if (first) void letGo(made);
	else held.set(host ?? "", made);
	return first ?? made;
}

/** Whether a pine still answers: one on another machine may have lost its connection meanwhile. */
const answers = (s: Service) => fetch(`${s.base}/health`, { signal: AbortSignal.timeout(2500) }).then((r) => r.ok, () => false);

/** Lets go of a pine: the SSH connection to another machine ends (and a pine it started there); one this app started here stops, unless it is to go on. */
async function letGo(s: Service | undefined): Promise<void> {
	if (s?.host || (s?.started && !prefs.keepRunning)) await s.stop();
}

/** The app shows another pine: this computer's (no host) or a machine's of the list. The tabs are that pine's own. */
async function use(host: string | undefined): Promise<void> {
	if (host !== undefined && !prefs.hosts.includes(host)) throw new Error("That machine is not in the list: add it in Settings > Environments.");
	if (host === prefs.use && service) return;
	prefs.use = host;
	savePrefs();
	// The terminals are in the folders of the other pine's conversations.
	terminals.closeAll();
	await startService();
}

/** The daemon's live events, handed to the page in small batches (`followEvents`). */
function follow(s: Service): void {
	stream = new AbortController();
	followEvents(s, stream.signal, {
		batch: (events) => send("pine:events", events),
		connection: (up) => {
			connected = up;
			send("pine:connection", up);
		},
		// A daemon this app started and that is gone will not come back by waiting: start it again.
		// Nor does an SSH connection that broke: it is made again.
		lost: (times) => {
			if (times !== 5 || !(s.started || s.host) || quitting) return false;
			if (held.get(s.host ?? "") === s) held.delete(s.host ?? "");
			void letGo(s);
			void startService();
			return true;
		},
	});
}

/** A picture, video or sound of the daemon's, for the page's `pine-media:` addresses. */
async function media(request: Request): Promise<Response> {
	const url = new URL(request.url);
	return mediaFromDaemon(service, request.method, url.pathname, url.search);
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
function notifyAsked(request: { name: string; code: string }): void {
	if (!Notification.isSupported() || (win && !win.isDestroyed() && win.isVisible() && win.isFocused())) return;
	const n = new Notification({ title: `${request.name} wants to connect`.slice(0, 80), body: `Allow it in Pine if the device shows ${request.code}.`, silent: false });
	n.on("click", () => show());
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
		changed: (s) => send("pine:access", s),
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
	if (pageReady) send("pine:menu", "pairing-shown");
	else pairingShown = true;
}
let pairingShown = false;
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

function fromPage(e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
	const frame = e.senderFrame;
	return Boolean(win && frame && e.sender === win.webContents && frame === win.webContents.mainFrame && originOf(frame.url) === ORIGIN);
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

function createWindow(): void {
	const b = prefs.bounds;
	win = new BrowserWindow({
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
		// (in the theme's colors, refreshBackground). Its menus are then not shown, and their keys still work.
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
	win.once("ready-to-show", () => void (HEADLESS || win?.show()));
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
	if (!isMac) win.webContents.on("before-input-event", (_e, input) => win?.webContents.setIgnoreMenuShortcuts(terminalFocused && shellKeeps(input)));
	win.webContents.on("did-start-loading", () => (terminalFocused = false));
	const keep = () => {
		if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
		prefs.bounds = win.getBounds();
	};
	win.on("resize", keep);
	win.on("move", keep);
	win.on("close", savePrefs);
	win.on("focus", () => send("pine:focus", true));
	win.on("blur", () => send("pine:focus", false));
	win.on("closed", () => (win = undefined));
	void win.loadURL(DEV_URL ?? "app://pine/");
	if (process.env.PINE_DESKTOP_DEVTOOLS) win.webContents.openDevTools({ mode: "detach" });
}

function show(): void {
	if (!win) createWindow();
	else {
		if (HEADLESS) return;
		if (win.isMinimized()) win.restore();
		win.show();
		win.focus();
	}
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
		void startService();
	}
	send("pine:update-state", withUpdater(known));
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
	stream?.abort();
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

/** A menu item that asks the page to do something: the page knows which conversation is in front. */
const item = (label: string, command: string, accelerator?: string, more: MenuItemConstructorOptions = {}): MenuItemConstructorOptions => ({ label, accelerator, click: () => (show(), send("pine:menu", command)), ...more });

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
	// The Dock's menu: a device can be added from there while the window is behind others.
	if (isMac) app.dock?.setMenu(Menu.buildFromTemplate([item("Add a Device…", "add-device")]));
}

// ---- what the page may ask for -----------------------------------------------------------------

function handle<T extends unknown[]>(channel: string, fn: (...args: T) => unknown): void {
	ipcMain.handle(channel, (e, ...args) => {
		if (!fromPage(e)) throw new Error("not from the app's page");
		return fn(...(args as T));
	});
}

function wire(): void {
	handle("pine:state", () => ({ state, connected: Boolean(service) && connected, home: prefs.home ?? process.env.PINE_HOME, prefs: { ...prefs, bounds: undefined }, platform: process.platform, focused: Boolean(win?.isFocused()), updates: Boolean(RELEASE_API), versions: { app: app.getVersion(), electron: process.versions.electron }, views: true, selfUpdate: Boolean(updater) }));
	handle("pine:call", async (method: string, url: string, body?: unknown) => {
		// The app says again and again that it shows the browser. To this computer's pine it also says where its own
		// browser is, with the word to reach it, which the page never holds.
		if (method === "POST" && url === "/browser/embedded" && service && !service.host) {
			await browsers.start().catch(() => {});
			return callDaemon(service, method, url, { host: browsers.url });
		}
		return callDaemon(service, method, url, body);
	});
	// Where the browser panel is, and which conversation's tab is in front there: its page is laid over the panel.
	handle("pine:browser-show", (key: unknown, index: unknown, bounds: unknown) => {
		const b = bounds as Partial<Bounds> | undefined;
		const fine = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
		const place = b && fine(b.x, 20_000) && fine(b.y, 20_000) && fine(b.width, 20_000) && fine(b.height, 20_000) && b.width >= 1 && b.height >= 1 ? { x: b.x, y: b.y, width: b.width, height: b.height } : undefined;
		// (The page's places are in its own points, which the window's zoom makes larger or smaller.)
		const zoom = win?.webContents.getZoomFactor() ?? 1;
		const scaled = place && { x: Math.round(place.x * zoom), y: Math.round(place.y * zoom), width: Math.round(place.width * zoom), height: Math.round(place.height * zoom) };
		return browsers.show(typeof key === "string" && !service?.host ? key : undefined, fine(index, 99) ? index : 0, scaled);
	});
	handle("pine:browser-focus", () => browsers.focus());
	handle("pine:browser-picture", () => browsers.picture());
	handle("pine:retry", () => startService());
	handle("pine:update", (again?: boolean) => update(again === true));
	handle("pine:install-update", () => installUpdate());
	handle("pine:restart", async () => {
		// Only a daemon of this app's own is its to restart; another one is somebody's terminal.
		if (!service?.started) throw new Error("this pine was started somewhere else (a terminal, a service). Restart it there.");
		stream?.abort();
		held.delete(service.host ?? "");
		await service.stop();
		await startService();
	});
	handle("pine:init", async () => {
		launch ??= await findPine(APP_ROOT, app.isPackaged ? process.resourcesPath : undefined);
		const args = ["init", ...(prefs.home ? [prefs.home] : []), "--yes"];
		return runPine(launch, args, (line) => send("pine:init-line", line), process.env.PINE_SKIP_DOWNLOADS ? { PINE_SKIP_DOWNLOADS: "1" } : {});
	});
	// The browser the web tools drive, fetched by the pine the app runs: each pine wants the build
	// of its own Playwright, and a home that was set up by another pine has an older one.
	handle("pine:browser", async () => {
		launch ??= await findPine(APP_ROOT, app.isPackaged ? process.resourcesPath : undefined);
		return runPine(launch, ["browser-install"], (line) => send("pine:init-line", line), process.env.PINE_SKIP_DOWNLOADS ? { PINE_SKIP_DOWNLOADS: "1" } : {});
	});
	handle("pine:command", async (action?: string) => {
		const env = await loginEnv();
		return worded(action === "install" ? await install(RESOURCES, env) : action === "remove" ? await remove(RESOURCES, env) : look(RESOURCES, env));
	});
	handle("pine:use", (host?: string) => use(typeof host === "string" ? host : undefined));
	// A machine is added by its name alone; it is connected to when it is picked.
	handle("pine:hosts-add", (value: string) => {
		const host = hostOf(String(value ?? ""));
		if (!host) throw new Error("Write the machine as you would after ssh: host or user@host.");
		if (host.startsWith("wsl:") && process.platform !== "win32") throw new Error("WSL is Windows': this computer has none.");
		if (!prefs.hosts.includes(host)) {
			if (prefs.hosts.length >= 20) throw new Error("There are 20 machines in the list already: forget one first.");
			prefs.hosts.push(host);
			savePrefs();
		}
		return { ...prefs, bounds: undefined };
	});
	handle("pine:hosts-forget", (host: string) => {
		if (host === prefs.use) throw new Error("The app uses this machine now. Use another one first.");
		prefs.hosts = prefs.hosts.filter((h) => h !== host);
		savePrefs();
		// Its connection ends, and a pine it started there with it.
		const s = held.get(String(host));
		if (s) (held.delete(String(host)), void letGo(s));
		return { ...prefs, bounds: undefined };
	});
	handle("pine:prefs", (change: Partial<Prefs>) => {
		if (typeof change.notify === "boolean") prefs.notify = change.notify;
		if (typeof change.updates === "boolean") prefs.updates = change.updates;
		if (typeof change.autoUpdate === "boolean") {
			prefs.autoUpdate = change.autoUpdate;
			// Turned on with a newer release known: it is downloaded now. Either way the page is told how the update stands.
			downloadUpdate();
			send("pine:update-state", withUpdater(known));
		}
		if (typeof change.keepRunning === "boolean") prefs.keepRunning = change.keepRunning;
		if ("home" in change) {
			const home = typeof change.home === "string" && change.home.trim() ? change.home.trim() : undefined;
			// Another home is another pine: the one held for this computer is not used again (the page restarts or reconnects).
			const old = held.get("");
			if (home !== prefs.home && old) {
				held.delete("");
				// One that is not on screen is let go of here; the one on screen, by the restart that follows.
				if (old !== service) void letGo(old);
			}
			prefs.home = home;
		}
		// The theme the page draws now: the window's frame (light or dark, the Mac's materials) and background follow it.
		if ("look" in change) {
			prefs.look = cleanLook(change.look);
			nativeTheme.themeSource = prefs.look?.kind ?? "dark";
			refreshBackground();
		}
		savePrefs();
		return { ...prefs, bounds: undefined };
	});
	// Browser access: its state, and the owner's changes to it.
	handle("pine:access", () => accessOn().state());
	handle("pine:access-set", (change: unknown) => accessOn().set(accessChange(change)));
	handle("pine:access-pair", () => accessOn().openPairing());
	handle("pine:access-cancel", () => accessOn().cancelPairing());
	// The link of the open pairing, put on the clipboard here: the page names no text (and is given no clipboard of its own).
	handle("pine:access-copy", async () => {
		const { pairing } = await accessOn().state();
		if (!pairing) throw new Error("No pairing is open now: press Add a device.");
		clipboard.writeText(pairing.link);
	});
	handle("pine:access-answer", (yes: unknown, id: unknown) => accessOn().answer(yes === true, typeof id === "string" ? id.slice(0, 64) : undefined));
	handle("pine:access-remove", (id: unknown) => {
		if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("That is not a device of the list.");
		return accessOn().remove(id);
	});
	handle("pine:pick-folder", async (title?: string) => {
		const r = await dialog.showOpenDialog(win!, { title: typeof title === "string" ? title.slice(0, 80) : "Choose a folder", properties: ["openDirectory", "createDirectory"] });
		if (r.canceled) return undefined;
		const p = forDaemon(r.filePaths[0]);
		if (!p) throw new Error(`${r.filePaths[0]} cannot be reached from ${wslNow()}: pick a folder on a drive of this computer, or one in the distribution.`);
		return p;
	});
	// A file dropped on the page, by the path the daemon knows it under.
	ipcMain.on("pine:daemon-path", (e, p: unknown) => {
		e.returnValue = typeof p === "string" && p ? (forDaemon(p) ?? "") : "";
	});
	// WSL on this Windows computer: its distributions, and the pine this app carries brought into one.
	handle("pine:wsl-distros", async () => (process.platform === "win32" ? await wslDistros() : []));
	handle("pine:wsl-install", async (distro: string) => {
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
	handle("pine:save-text", async (name: string, text: string) => {
		const r = await dialog.showSaveDialog(win!, { defaultPath: path.join(app.getPath("documents"), path.basename(String(name))) });
		if (r.canceled || !r.filePath) return undefined;
		fs.writeFileSync(r.filePath, String(text));
		return r.filePath;
	});
	handle("pine:open", (url: string) => openOutside(String(url)));
	handle("pine:reveal", (file: string) => {
		// Shown in the Finder, never opened: opening would start whatever the file is. A path of WSL's is Windows' first.
		const d = wslNow();
		const here = typeof file === "string" && d && file.startsWith("/") ? fromWsl(file, d) : file;
		if (typeof here === "string" && path.isAbsolute(here) && fs.existsSync(here)) shell.showItemInFolder(here);
	});
	handle("pine:notify", (title: string, body: string, tab?: string) => {
		if (!prefs.notify || !Notification.isSupported() || win?.isFocused()) return;
		const n = new Notification({ title: String(title).slice(0, 80), body: String(body).slice(0, 160), silent: false });
		n.on("click", () => (show(), tab && send("pine:menu", `focus:${tab}`)));
		n.show();
	});
	handle("pine:badge", (count: number) => {
		const n = Math.max(0, Number(count) || 0);
		if (isMac) app.dock?.setBadge(n > 0 ? String(n) : "");
		// Windows has no number on a taskbar button: a dot over its icon says that something waits.
		else if (isWindows) win?.setOverlayIcon(n > 0 ? waiting() : null, n > 0 ? `${n} waiting for you` : "");
		else app.setBadgeCount(n);
	});
	// Dictating a message. The words are recognised on this computer by the helper the terminal UI
	// uses too (src/tui/voice.ts): voice.swift on a Mac, voice.cs on Windows, whisper.cpp on Linux.
	// Nothing is sent anywhere, and what is heard is text for the input and nothing more. The page
	// puts it there; nothing here sends a message.
	handle("pine:voice-start", async (language?: string) => {
		listening?.cancel();
		listening = undefined;
		const lang = typeof language === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language) ? language : undefined;
		let command: string[];
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
		const mine: Listening = new Listening(command, lang, {
			ready: () => listening === mine && send("pine:voice", { type: "ready" }),
			partial: (text) => listening === mine && send("pine:voice", { type: "partial", text }),
			model: (state) => listening === mine && send("pine:voice", { type: "model", state }),
			done: (text, error) => {
				if (listening !== mine) return;
				listening = undefined;
				send("pine:voice", { type: "done", text, error });
			},
		});
		listening = mine;
	});
	handle("pine:voice-stop", (cancel?: boolean) => {
		if (cancel) (listening?.cancel(), (listening = undefined));
		else listening?.stop();
	});
	// The owner's terminal beside a conversation. What is written into it comes from the page's
	// keyboard, or from a code block of an answer that the owner ran with its button.
	handle("pine:term-open", (id: string, cwd?: string, cols?: number, rows?: number) => terminals.open(String(id), cwd, cols, rows));
	handle("pine:term-write", (id: string, data: string) => terminals.write(String(id), data));
	handle("pine:term-run", (id: string, code: string) => terminals.run(String(id), code));
	handle("pine:term-resize", (id: string, cols: number, rows: number) => terminals.resize(String(id), cols, rows));
	handle("pine:term-close", (id: string) => terminals.close(String(id)));
	// An item with `checked` is one of a set of choices (the side bar's "Sort by"), drawn with the system's mark.
	handle("pine:context-menu", (items: Array<{ id: string; label: string; enabled?: boolean; separator?: boolean; danger?: boolean; checked?: boolean }>) => {
		return new Promise<string | undefined>((resolve) => {
			let picked: string | undefined;
			const menu = Menu.buildFromTemplate(items.slice(0, 30).map((i) => (i.separator ? { type: "separator" as const } : { label: String(i.label).slice(0, 80), enabled: i.enabled !== false, ...(typeof i.checked === "boolean" ? { type: "radio" as const, checked: i.checked } : {}), click: () => (picked = String(i.id)) })));
			menu.popup({ window: win, callback: () => resolve(picked) });
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

/** A folder the app was opened with (dropped on its icon, or `open -a Pine <folder>`): a conversation that works there. */
const pendingFolders: string[] = [];
let pageReady = false;
function openFolder(dir: string): void {
	try {
		if (!fs.statSync(dir).isDirectory()) return;
	} catch {
		return;
	}
	if (pageReady) (show(), send("pine:menu", `folder:${dir}`));
	else pendingFolders.push(dir);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on("second-instance", (_e, argv) => {
		// On Windows and Linux an address the system opens the app with comes as an argument of a second start.
		show();
		const address = argv.find((a) => a.toLowerCase().startsWith("pine:"));
		if (address) return void pairFromAddress(address);
		const dir = folderIn(argv);
		if (dir) openFolder(dir);
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
		// Nothing the page shows gets the camera, the microphone, the place or anything else of the system's.
		contents.session.setPermissionRequestHandler((_wc, _permission, done) => done(false));
	});
	void app.whenReady().then(() => {
		loadPrefs();
		protocol.handle("app", page);
		protocol.handle("pine-media", media);
		session.defaultSession.setPermissionRequestHandler((_wc, _permission, done) => done(false));
		wire();
		ipcMain.on("pine:term-focus", (e, focused) => {
			if (fromPage(e)) terminalFocused = focused === true;
		});
		startAccess();
		registerScheme();
		for (const url of pendingAddresses.splice(0)) void pairFromAddress(url);
		// The first start on Windows and Linux: the address is an argument of this one.
		const address = process.argv.find((a) => a.toLowerCase().startsWith("pine:"));
		if (address) void pairFromAddress(address);
		ipcMain.on("pine:ready", (e) => {
			if (!fromPage(e)) return;
			pageReady = true;
			send("pine:service", state);
			for (const dir of pendingFolders.splice(0)) send("pine:menu", `folder:${dir}`);
			if (pairingShown) (pairingShown = false), send("pine:menu", "pairing-shown");
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
		createWindow();
		// Off a Mac a folder the app was started with comes as an argument of this first start, not as an event.
		const dir = isMac ? undefined : folderIn(process.argv);
		if (dir) openFolder(dir);
		void startService();
		void firstCommand();
		app.on("activate", show);
	});
	app.on("window-all-closed", () => {
		// On a Mac the app, and the daemon it started, stay when the window is closed.
		pageReady = false;
		if (!isMac) app.quit();
	});
	app.on("before-quit", (e) => {
		if (quitting) return;
		savePrefs();
		updater?.quitting();
		terminals.closeAll();
		browsers.close();
		// Browser access closes its sockets; its daemon is one of those held, and follows them.
		void access?.stop();
		announcer.stop();
		// The connections to other machines end with the app, and a pine one started there with it.
		const going = [...held.values()].filter((s) => s.host || (s.started && !prefs.keepRunning));
		if (!going.length) return;
		// A daemon this app started ends with it, as the terminal UI's does: its agents are stopped
		// and its database closed before the app is gone.
		e.preventDefault();
		quitting = true;
		stream?.abort();
		void Promise.all(going.map((s) => s.stop())).finally(() => app.quit());
	});
}
