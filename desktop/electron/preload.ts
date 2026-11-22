// The bridge between the page and the main process: a short list of things the page may ask
// for, each by name. The page has no Node, no token and no other way out.
import { contextBridge, ipcRenderer, webUtils } from "electron";

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
	restart: () => ipcRenderer.invoke("pine:restart"),
	/** `pine init`: its exit code, or "administrator" when it set up everything but what an administrator has to run (Linux), which it printed. */
	init: (): Promise<number | "administrator"> => ipcRenderer.invoke("pine:init"),
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
	/** The app's menus, opened at a place of the page: where the window shows no menu bar (off a Mac). */
	appMenu: (x: number, y: number) => ipcRenderer.invoke("pine:app-menu", x, y),
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
