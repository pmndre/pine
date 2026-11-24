// The preload's bridge in an ordinary browser, for `npm run dev:preview` (scripts/preview.ts) and
// nothing else: the preview's server makes every call for the page, as the app's main process
// does, and this calls its routes under /__pine/. What only the app can do (menus, notifications,
// dictation, updates, the dock) does nothing here. In the app and in Storybook there is a
// `window.pine` already, and in a build `__PINE_PREVIEW__` is false and none of this is kept.
// The preview's pine is the one its server started: other machines are the app's only.
import type { Bridge } from "../electron/preload.ts";
import type { AccessCalls, BrowserCalls, UpdateCalls } from "./bridge.ts";
import { cleanLook } from "./theme.ts";

if (import.meta.env.DEV && __PINE_PREVIEW__ && !window.pine) window.pine = standIn();

function standIn(): Omit<Bridge, AccessCalls | UpdateCalls | BrowserCalls> {
	type Listener = (...args: any[]) => void;
	const listeners = { service: new Set<Listener>(), events: new Set<Listener>(), connection: new Set<Listener>() };
	const on = (set: Set<Listener>) => (fn: Listener) => (set.add(fn), () => void set.delete(fn));
	const never = () => () => undefined;
	const tell = (set: Set<Listener>, ...args: unknown[]) => set.forEach((fn) => fn(...args));
	let prefs: Record<string, unknown> = { keepRunning: false, hosts: [], notify: false, updates: false };

	const service = async () => {
		const res = await fetch("/__pine/state");
		if (!res.ok) throw new Error(`the preview's server says ${res.status}`);
		return (await res.json()) as { state: { status: string; home?: string }; platform: string };
	};

	// The daemon's events, as server-sent events: each message is a batch, as in the app.
	let events: EventSource | undefined;
	const follow = () => {
		if (events) return;
		events = new EventSource("/__pine/events");
		events.onmessage = (m) => tell(listeners.events, JSON.parse(m.data));
		events.addEventListener("connection", (m) => tell(listeners.connection, (m as MessageEvent).data === "true"));
		events.onerror = () => tell(listeners.connection, false);
	};

	return {
		// No WSL in a browser's preview.
		wslDistros: async () => [],
		wslInstall: async () => {
			throw new Error("The preview brings pine into no WSL distribution.");
		},
		state: async () => {
			const s = await service();
			return { state: s.state, home: s.state.home, prefs: { ...prefs }, platform: s.platform, focused: document.hasFocus(), updates: false, versions: { app: "preview", electron: "none" } };
		},
		ready: () => {
			follow();
			void service().then((s) => tell(listeners.service, s.state));
		},
		call: async (method: "GET" | "POST", url: string, body?: unknown) => {
			const res = await fetch("/__pine/call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, url, body }) });
			return res.ok ? res.json() : { ok: false, status: res.status, data: { error: `the preview's server refused the call (${res.status})` } };
		},
		retry: async () => tell(listeners.service, (await service()).state),
		update: async () => undefined,
		restart: async () => {
			throw new Error("The preview's pine stops and starts with the preview: stop it and start it again.");
		},
		init: async () => 1,
		browserInstall: async () => 1,
		// Kept in memory while the page is open; a theme made safe as the app's main process makes it.
		prefs: async (change: Record<string, unknown>) => (prefs = { ...prefs, ...change, ...("look" in change ? { look: cleanLook(change.look) } : {}) }),
		use: async (host?: string) => {
			if (host) throw new Error("Other machines are in the Pine app only.");
		},
		addHost: async () => {
			throw new Error("Other machines are in the Pine app only.");
		},
		forgetHost: async () => ({ ...prefs }),
		// No system dialog in a browser: a folder is named by its path.
		pickFolder: async (title?: string) => window.prompt(`${title ?? "Choose a folder"}: the folder's path`)?.trim() || undefined,
		saveText: async (name: string, text: string) => {
			const a = document.createElement("a");
			a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
			a.download = name;
			a.click();
			URL.revokeObjectURL(a.href);
			return name;
		},
		open: async (url: string) => {
			if (/^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener,noreferrer");
		},
		reveal: async () => {},
		notify: async () => {},
		badge: async () => {},
		contextMenu: async () => undefined,
		command: async () => ({ state: "unavailable", text: "" }),
		voiceStart: async () => {
			throw new Error("Dictation is in the Pine app only.");
		},
		voiceStop: async () => {},
		pathOf: () => "",
		// A shell for a page in a browser would be a shell for whatever reaches the preview's server: the app only.
		termOpen: async () => {
			throw new Error("The terminal is in the Pine app only.");
		},
		termWrite: async () => {},
		termRun: async () => ({ reports: false }),
		termResize: async () => {},
		termClose: async () => {},
		termFocus: () => undefined,
		onTermData: never,
		onTermExit: never,
		onTermRun: never,
		onService: on(listeners.service),
		onEvents: on(listeners.events),
		onConnection: on(listeners.connection),
		onMenu: never,
		onFocus: never,
		onInitLine: never,
		onVoice: never,
	};
}
