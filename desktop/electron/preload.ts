// The bridge between the page and the main process: a short list of things the page may ask
// for, each by name. The page has no Node, no token and no other way out.
import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AccessChange, AccessState } from "./access/control.ts";

/** Persisted per-window tabs, active tab, panel visibility, widths and folded side bar state. */
export interface WindowLayout {
	/** Environment this snapshot belongs to (`""` for this computer, or the SSH `host` string). */
	host?: string;
	/** Open conversation tabs in this window, in tab-bar order. */
	tabs: Array<{ agent: string; session: string }>;
	/** Active index within `tabs`. */
	active: number;
	/** True when the window has zero tabs open (`NoTab`). */
	noTab?: boolean;
	/** Whether the side bar column is shown in a wide window. */
	sidebar: boolean;
	/** Whether the side panel (`CodePanel`) is open. */
	code: boolean;
	/** Whether the browser aside (`BrowserAside`) is open. */
	aside: boolean;
	/** Whether the view panel (`ViewAside`) is open. */
	view: boolean;
	/** Z-order of panels beside a conversation, most recently opened last. */
	order?: Array<"code" | "aside" | "view">;
	/** Pixel widths of resizable panels in this window. */
	widths: { sidebar?: number; code?: number; aside?: number; view?: number };
	/** Folded agent and group keys in this window's side bar. */
	folded: string[];
}

/** Options when opening an additional Pine window from the renderer. */
export interface NewWindowOptions {
	/** `null` opens this computer (`undefined` host); `undefined` inherits the caller's environment; a string opens that SSH host. */
	host?: string | null;
	/** Single conversation tab to open at start (`Move to New Window`, `Open in New Window`). */
	tab?: { agent: string; session: string };
	/** True when moving an existing tab from the caller window (`Move to New Window`). */
	moveFrom?: boolean;
	/** Unsent composer draft and attachments moved along with `tab`. */
	draft?: { draft: string; attachments: Array<{ name: string; size: number; data: string; preview?: string }> };
}

const windowArg = process.argv.find((a) => a.startsWith("--pine-window="));
const windowId = windowArg ? windowArg.slice("--pine-window=".length) : "";

const on = (channel: string) => (fn: (...args: any[]) => void) => {
	const listener = (_e: unknown, ...args: any[]) => fn(...args);
	ipcRenderer.on(channel, listener);
	return () => void ipcRenderer.removeListener(channel, listener);
};

const bridge = {
	mediaBase: windowId ? `pine-media://window-${windowId}` : "pine-media://daemon",
	state: () => ipcRenderer.invoke("pine:state"),
	ready: () => ipcRenderer.send("pine:ready"),
	call: (method: "GET" | "POST", url: string, body?: unknown) => ipcRenderer.invoke("pine:call", method, url, body),
	retry: () => ipcRenderer.invoke("pine:retry"),
	/** Opens another Pine window, cascaded from the caller. */
	newWindow: (options?: NewWindowOptions) => ipcRenderer.invoke("pine:window-new", options) as Promise<void>,
	/** Closes this window. */
	closeWindow: () => ipcRenderer.invoke("pine:window-close") as Promise<void>,
	/** Saves this window's tabs, active tab, panels, widths and folded keys in the main process. */
	windowLayout: (snapshot: WindowLayout) => ipcRenderer.invoke("pine:window-layout", snapshot) as Promise<void>,
	/** Whether there is a newer app: what the start found, or with `again` what GitHub says now. Nothing where nobody is asked. */
	update: (again?: boolean) => ipcRenderer.invoke("pine:update", again),
	/** Quits and installs the update the app downloaded ("Restart to update"); the pine this app started is stopped first. */
	installUpdate: () => ipcRenderer.invoke("pine:install-update") as Promise<void>,
	/** What is said of a newer app, each time the app's own download of it moves on. */
	onUpdate: on("pine:update-state"),
	restart: () => ipcRenderer.invoke("pine:restart"),
	init: () => ipcRenderer.invoke("pine:init"),
	/** Fetch the browser build this pine drives (`pine browser-install`); what it prints comes as init lines. */
	browserInstall: () => ipcRenderer.invoke("pine:browser"),
	prefs: (change: Record<string, unknown>) => ipcRenderer.invoke("pine:prefs", change),
	/** Use the pine of a machine of the list (a host for ssh), or with none this computer's. */
	use: (host?: string) => ipcRenderer.invoke("pine:use", host),
	/** Add a machine to the list, or take one out; what comes back is the prefs as they are now. */
	addHost: (host: string) => ipcRenderer.invoke("pine:hosts-add", host),
	forgetHost: (host: string, options?: { closeWindows?: boolean }) => ipcRenderer.invoke("pine:hosts-forget", host, options),
	pickFolder: (title?: string) => ipcRenderer.invoke("pine:pick-folder", title),
	saveText: (name: string, text: string) => ipcRenderer.invoke("pine:save-text", name, text),
	open: (url: string) => ipcRenderer.invoke("pine:open", url),
	reveal: (file: string) => ipcRenderer.invoke("pine:reveal", file),
	notify: (title: string, body: string, tab?: string) => ipcRenderer.invoke("pine:notify", title, body, tab),
	badge: (count: number) => ipcRenderer.invoke("pine:badge", count),
	contextMenu: (items: unknown[]) => ipcRenderer.invoke("pine:context-menu", items),
	/** `pine` for a terminal: what the shell has; with "install" or "remove", after doing that. */
	command: (action?: "install" | "remove") => ipcRenderer.invoke("pine:command", action),
	voiceStart: (language?: string) => ipcRenderer.invoke("pine:voice-start", language),
	voiceStop: (cancel?: boolean) => ipcRenderer.invoke("pine:voice-stop", cancel),
	/** Where a file that was dropped on the window lies: a folder is opened by its path, not read. */
	pathOf: (file: File) => webUtils.getPathForFile(file),
	/** The owner's terminal of a conversation: started in `cwd` when it does not run yet; what it printed so far comes back. */
	termOpen: (id: string, cwd: string | undefined, cols: number, rows: number) => ipcRenderer.invoke("pine:term-open", id, cwd, cols, rows) as Promise<{ kept: string; cwd: string; fresh: boolean }>,
	termWrite: (id: string, data: string) => ipcRenderer.invoke("pine:term-write", id, data),
	/** A code block of an answer, run with its button: typed into the terminal and followed until it ends. `reports`: whether the shell says how it went. */
	termRun: (id: string, code: string) => ipcRenderer.invoke("pine:term-run", id, code) as Promise<{ reports: boolean }>,
	termResize: (id: string, cols: number, rows: number) => ipcRenderer.invoke("pine:term-resize", id, cols, rows),
	termClose: (id: string) => ipcRenderer.invoke("pine:term-close", id),
	onTermData: on("pine:term-data"),
	onTermExit: on("pine:term-exit"),
	/** A block run with a Run button is still running, or has ended (`RunReport` of terminal.ts). */
	onTermRun: on("pine:term-run"),
	/**
	 * The agent's browser of a conversation (`room` of the browser's state) laid over the panel at `bounds`, its tab
	 * `index` in front; without a room or bounds nothing is laid over the window. Says whether a page is shown.
	 */
	browserShow: (room: string | undefined, index: number, bounds?: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke("pine:browser-show", room, index, bounds) as Promise<boolean>,
	/** The keys go to the page in the panel. */
	browserFocus: () => ipcRenderer.invoke("pine:browser-focus") as Promise<void>,
	/** A still picture of the page laid over the panel (a data: address), for while something of the app's own covers that place. */
	browserPicture: () => ipcRenderer.invoke("pine:browser-picture") as Promise<string | undefined>,
	/** Fires when another focused window takes over the agent browser tab shown in this window. */
	onBrowserPreempted: on("pine:browser-preempted") as (fn: () => void) => () => void,
	/** Browser access (Settings > Browser access): its state, as access/control.ts gives it. */
	access: () => ipcRenderer.invoke("pine:access") as Promise<AccessState>,
	/** Turns it on or off, names the service's address (empty: the official one), sets open at login. What comes back is the state now. */
	setAccess: (change: AccessChange) => ipcRenderer.invoke("pine:access-set", change) as Promise<AccessState>,
	/** Opens a pairing: the link the QR code encodes, and when it stops working (an ISO date). */
	openPairing: () => ipcRenderer.invoke("pine:access-pair") as Promise<{ link: string; expires: string }>,
	/** Puts the open pairing's link on the clipboard. */
	copyPairingLink: () => ipcRenderer.invoke("pine:access-copy") as Promise<void>,
	/** Closes the open pairing (the dialog was closed). */
	cancelPairing: () => ipcRenderer.invoke("pine:access-cancel") as Promise<void>,
	/** The owner's answer to the state's `request` named by its `id`: true allows the device. */
	answerPairing: (yes: boolean, id: string) => ipcRenderer.invoke("pine:access-answer", yes, id) as Promise<void>,
	/** Forgets a paired device and cuts its connection. */
	removeDevice: (id: string) => ipcRenderer.invoke("pine:access-remove", id) as Promise<boolean>,
	/** The state of browser access, each time it changes. */
	onAccess: on("pine:access") as (fn: (state: AccessState) => void) => () => void,
	/** SSH hosts open in other windows than this one, pushed whenever windows open, close or switch machines. */
	onOpenHosts: on("pine:open-hosts") as (fn: (hosts: string[]) => void) => () => void,
	/** App-wide preferences, pushed whenever another window updates them. */
	onPrefs: on("pine:prefs") as (fn: (prefs: any) => void) => () => void,
	onService: on("pine:service"),
	onEvents: on("pine:events"),
	onConnection: on("pine:connection"),
	onMenu: on("pine:menu"),
	onFocus: on("pine:focus"),
	onInitLine: on("pine:init-line"),
	onVoice: on("pine:voice"),
};

contextBridge.exposeInMainWorld("pine", bridge);

export type Bridge = typeof bridge;
