// The preload's bridge on a phone: what the desktop page asks of Electron's main process, asked of
// the native plugin instead (src/plugin.ts), which holds the SSH session and the daemon's token as
// the main process does. The phone has no pine of its own (`local: false`), so the page offers only
// other machines. What only the desktop app can do refuses or does nothing, as the preview's
// stand-in does (desktop/src/preview-bridge.ts).
import type { AppState, PageBridge, Prefs } from "../../desktop/src/bridge.ts";
import { isPaired, MACHINE_ID, type NearbyFound, readPairLink } from "../../desktop/src/machines.ts";
import { cleanLook, type Look } from "../../desktop/src/theme.ts";
import { ORIGINS, type PagePrefs, type PinePlugin, type Platform } from "./plugin.ts";

/** The nonce of a computer's announcement: 16 random bytes, base64url. */
const NONCE = /^[A-Za-z0-9_-]{22}$/;

const DEFAULTS: PagePrefs = { notify: false, updates: false, keepRunning: false, questionCards: true };

/** pmndre's page color (index.css), which the page draws with no theme: the system bars' until one is known. */
const PMNDRE_BG = "#1b1e28";

/** What is open over the page: a sheet, a dialog, a menu (Base UI's popups, mounted only while open; a listbox is not one: the side bar's list of agents is always there). */
const OPEN = '[role="dialog"], [role="alertdialog"], [role="menu"]';

/**
 * Android's back button (iOS has none): what is open over the page is closed as Escape closes it on the desktop,
 * and with nothing open the app is left, as Android's own apps do.
 */
function back(leave: () => void): void {
	const doc = typeof document === "undefined" ? undefined : document;
	if (!doc?.querySelector(OPEN)) return leave();
	(doc.activeElement ?? doc.body)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
}

/** The page's bridge, on the plugin it is given (Capacitor's in the app, a fake in the tests), for the phone's system. */
export function mobileBridge(plugin: PinePlugin, platform: Platform): PageBridge {
	// The page's preferences and the machines, as the plugin last gave them.
	let prefs: Prefs = { ...DEFAULTS, hosts: [] };

	// The system bars take the color and the kind of the theme the page draws, as Electron's window
	// does (main.ts): no white bands around a dark page. A plugin that cannot paint them changes nothing else.
	const bars = (look: Look | undefined) =>
		void plugin.systemBars({ color: (look?.colors.bg ?? PMNDRE_BG).slice(0, 7).toLowerCase(), dark: (look?.kind ?? "dark") === "dark" }).catch(() => {});

	const load = async () => {
		const stored = await plugin.loadPrefs();
		prefs = { ...DEFAULTS, ...stored.prefs, hosts: stored.hosts, ...(stored.use ? { use: stored.use } : {}), ...(stored.names ? { names: { ...stored.names } } : {}) };
	};

	// The page's listeners of each kind. The plugin is listened to once per kind, on the first page
	// listener, and each of its messages is unwrapped into what Electron's channel carries.
	type Listener = (value: any) => void;
	const heard = new Map<string, Set<Listener>>();
	// What reaches the page's listeners of a kind: from the plugin, or from the bridge itself.
	const emit = (event: string, value: unknown) => heard.get(event)?.forEach((fn) => fn(value));
	// `own` takes a message for the bridge itself, which the page then never hears (the back button).
	const on =
		(event: "service" | "events" | "connection" | "focus" | "menu" | "link" | "nearby", unwrap: (data: any) => unknown, own: (value: unknown) => boolean = () => false) =>
		(fn: Listener) => {
			let set = heard.get(event);
			if (!set) {
				heard.set(event, (set = new Set()));
				void plugin.addListener(event as any, (data: unknown) => {
					const value = unwrap(data);
					if (!own(value)) emit(event, value);
				});
			}
			set.add(fn);
			return () => void set.delete(fn);
		};
	const never = () => () => undefined;
	// Whether this build's native side looks on the network (`state().canPairNearby`), known once the page asked the state.
	let canNearby = false;
	/** The page's listeners of what is found on the network: the native side looks while there is one. */
	const finders = new Set<(found: NearbyFound) => void>();
	const nearbyEvents = on("nearby", (d) => ({ computers: Array.isArray(d?.computers) ? d.computers.filter((c: any) => typeof c?.id === "string" && MACHINE_ID.test(c.id) && typeof c?.service === "string" && /^https:\/\/[^/]+$/.test(c.service) && typeof c?.nonce === "string" && NONCE.test(c.nonce)).map((c: any) => ({ id: c.id, service: c.service, nonce: c.nonce })) : [], ...(d?.denied === true ? { denied: true } : {}) }));

	return {
		mediaBase: ORIGINS[platform].media,
		onService: on("service", (d) => d.state),
		onEvents: on("events", (d) => d.events),
		onConnection: on("connection", (d) => d.connected),
		onFocus: on("focus", (d) => d.focused),
		onMenu: on(
			"menu",
			(d) => d.command,
			(command) => command === "back" && (back(() => void plugin.leave()), true),
		),
		// Only the desktop app starts pine, has a terminal or listens to the microphone.
		onInitLine: never,
		onVoice: never,
		onTermData: never,
		onTermExit: never,
		onTermRun: never,
		state: async (): Promise<AppState> => {
			const [s] = await Promise.all([plugin.state(), load()]);
			canNearby = s.canPairNearby === true;
			bars(prefs.look);
			return { state: s.state, connected: s.connected, home: s.state.status === "ready" ? s.state.home : undefined, prefs: { ...prefs }, platform, focused: true, updates: false, versions: { app: s.version, electron: "none" }, local: false, canPair: s.canPair === true };
		},
		// As Electron's `send`, nothing to wait for: a plugin that cannot start says so as a connection that failed.
		ready: () =>
			void plugin.ready().catch((e: unknown) => {
				emit("service", { status: "error", kind: "failed", message: e instanceof Error ? e.message : String(e) });
			}),
		// Checked as main.ts checks the owner's change; the machines are changed by their own methods only.
		prefs: async (change: Record<string, unknown>) => {
			const flag = (key: "notify" | "updates" | "keepRunning" | "questionCards") => (typeof change[key] === "boolean" ? change[key] : (prefs[key] ?? DEFAULTS[key]));
			const next: PagePrefs = {
				notify: flag("notify"),
				updates: flag("updates"),
				keepRunning: flag("keepRunning"),
				questionCards: flag("questionCards"),
			};
			// The theme the page draws now, made safe as main.ts makes it; none: pmndre, nothing stored.
			const look = "look" in change ? cleanLook(change.look) : prefs.look;
			if (look) next.look = look;
			await plugin.savePrefs({ prefs: next });
			prefs = { ...next, hosts: prefs.hosts, ...(prefs.use ? { use: prefs.use } : {}), ...(prefs.names ? { names: prefs.names } : {}) };
			if ("look" in change) bars(look);
			return { ...prefs };
		},
		call: (method: "GET" | "POST", url: string, body?: unknown) => plugin.call({ method, url, body }),
		retry: () => plugin.retry(),
		// The owner's yes to the fingerprint the page drew, and to that one only: the plugin refuses
		// any other, and a changed key is never offered (the page shows the button only when `changed` is false).
		trustHostKey: (host: string, fingerprint: string) => plugin.trustHostKey({ host, fingerprint }),
		use: async (host?: string) => {
			// The page never asks for it when `local` is false; a stray call is refused here, not sent.
			if (!host) throw new Error("This phone has no pine of its own: choose one of your machines.");
			await plugin.use({ host });
			prefs = { ...prefs, use: host };
		},
		addHost: async (host: string) => {
			prefs = { ...prefs, hosts: (await plugin.addHost({ host })).hosts };
			return { ...prefs };
		},
		// A machine forgotten takes its host key along: added again, it is asked about as a new one. A
		// paired computer has none to forget (its machine id is its key), and its name goes with it.
		// Forgetting is the phone's alone: only Remove in the Pine app closes a paired computer's access.
		forgetHost: async (host: string) => {
			prefs = { ...prefs, hosts: (await plugin.forgetHost({ host })).hosts };
			if (prefs.use === host) delete prefs.use;
			if (prefs.names?.[host] !== undefined) {
				const { [host]: _gone, ...names } = prefs.names;
				prefs = { ...prefs, names };
			}
			if (!isPaired(host)) await plugin.forgetHostKey({ host });
			return { ...prefs };
		},
		// Only a pairing link of an https service reaches the plugin, which reads it again with the core's parser.
		pair: async (link: string) => {
			if (!readPairLink(link)) throw new Error("That is not a pairing link: open Pine on your computer, go to Settings > Browser access, and add this device again.");
			await plugin.pair({ link });
		},
		stopPairing: () => plugin.cancelPairing(),
		// The native side looks on the network from the first listener to the last one gone: the page
		// listens only while it shows how to pair, so that iOS asks for the local network then.
		nearby: (fn: (found: NearbyFound) => void) => {
			if (!canNearby) return () => undefined;
			const stop = nearbyEvents(fn);
			finders.add(fn);
			if (finders.size === 1) void plugin.nearby({ on: true }).catch(() => {});
			return () => {
				stop();
				if (finders.delete(fn) && finders.size === 0) void plugin.nearby({ on: false }).catch(() => {});
			};
		},
		pairNearby: async (id: string, service: string, nonce: string) => {
			if (!canNearby || !MACHINE_ID.test(id) || !/^https:\/\/[^/]+$/.test(service) || !NONCE.test(nonce)) throw new Error("That is not a computer this phone can pair with. Look again, or pair with the code from Pine > Add a device.");
			await plugin.pairNearby({ id, service, nonce });
		},
		onPairLink: on("link", (d) => (typeof d?.link === "string" ? d.link : ""), (link) => !link),
		deviceKey: async () => {
			const { key } = await plugin.publicKey();
			return { key, copy: () => plugin.copy({ text: key }), share: () => plugin.share({ title: "This phone's SSH key", text: key }) };
		},
		// Only an address of the web, as main.ts's openOutside: the plugin checks it again.
		open: async (url: string) => {
			if (/^https?:\/\//i.test(url)) await plugin.openExternal({ url });
		},
		// No files to save into on a phone: the share sheet says where it goes.
		saveText: async (name: string, text: string) => {
			await plugin.share({ title: name, text });
			return name;
		},
		// No context menus on a phone yet: the page's right-click actions do nothing.
		contextMenu: async () => undefined,
		reveal: async () => {},
		notify: async () => {},
		badge: async () => {},
		// What only the desktop app has, refused or done nothing as desktop/src/preview-bridge.ts does.
		update: async () => undefined,
		restart: async () => {
			throw new Error("The phone does not start pine: restart it on its machine.");
		},
		init: async () => 1,
		browserInstall: async () => 1,
		command: async () => ({ state: "unavailable", text: "" }),
		voiceStart: async () => {
			throw new Error("Voice input needs a Mac: it uses the speech recognition macOS has on the device.");
		},
		voiceStop: async () => {},
		pickFolder: async () => undefined,
		pathOf: () => "",
		termOpen: async () => {
			throw new Error("The terminal is in the desktop app only.");
		},
		termWrite: async () => {},
		termRun: async () => ({ reports: false }),
		termResize: async () => {},
		termClose: async () => {},
	};
}
