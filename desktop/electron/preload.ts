// The bridge between the page and the main process: a short list of things the page may ask
// for, each by name. The page has no Node, no token and no other way out.
import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AccessChange, AccessState } from "./access/control.ts";

const on = (channel: string) => (fn: (...args: any[]) => void) => {
	const listener = (_e: unknown, ...args: any[]) => fn(...args);
	ipcRenderer.on(channel, listener);
	return () => void ipcRenderer.removeListener(channel, listener);
};

const bridge = {
	state: () => ipcRenderer.invoke("pine:state"),
	ready: () => ipcRenderer.send("pine:ready"),
	call: (method: "GET" | "POST", url: string, body?: unknown) => ipcRenderer.invoke("pine:call", method, url, body),
	retry: () => ipcRenderer.invoke("pine:retry"),
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
	forgetHost: (host: string) => ipcRenderer.invoke("pine:hosts-forget", host),
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
	// By the path the daemon knows it under (under /mnt where it runs in WSL).
	pathOf: (file: File) => String(ipcRenderer.sendSync("pine:daemon-path", webUtils.getPathForFile(file)) ?? ""),
	wslDistros: () => ipcRenderer.invoke("pine:wsl-distros"),
	wslInstall: (distro: string) => ipcRenderer.invoke("pine:wsl-install", distro),
	/** The owner's terminal of a conversation: started in `cwd` when it does not run yet; what it printed so far comes back. */
	termOpen: (id: string, cwd: string | undefined, cols: number, rows: number) => ipcRenderer.invoke("pine:term-open", id, cwd, cols, rows) as Promise<{ kept: string; cwd: string; fresh: boolean }>,
	termWrite: (id: string, data: string) => ipcRenderer.invoke("pine:term-write", id, data),
	/** A code block of an answer, run with its button: typed into the terminal and followed until it ends. `reports`: whether the shell says how it went. */
	termRun: (id: string, code: string) => ipcRenderer.invoke("pine:term-run", id, code) as Promise<{ reports: boolean }>,
	termResize: (id: string, cols: number, rows: number) => ipcRenderer.invoke("pine:term-resize", id, cols, rows),
	termClose: (id: string) => ipcRenderer.invoke("pine:term-close", id),
	/** Whether a terminal has the keyboard: off a Mac, Ctrl and a letter are then the shell's and not the menu's. */
	termFocus: (focused: boolean) => ipcRenderer.send("pine:term-focus", focused === true),
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
