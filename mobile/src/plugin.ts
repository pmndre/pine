// The native plugin's interface: what the mobile bridge (mobile-bridge.ts) asks of the native
// side, registered with Capacitor under the name `Pine`. It is the contract the Kotlin plugin
// implements (ticket 06): the counterpart of what Electron's main process does for the desktop page
// (desktop/electron/main.ts, service.ts, daemon.ts and src/remote.ts). The plugin holds the SSH
// session and the daemon's token, and makes every call; the page never sees either.
//
// Capacitor's rules shape it: a method takes one object and resolves with one object (or nothing),
// and what the plugin tells the page arrives through `addListener(name, fn)` with one object each.
import type { PluginListenerHandle } from "@capacitor/core";
import type { CallResult } from "../../desktop/electron/daemon.ts";
import type { PineEvent } from "../../desktop/src/api.ts";
import type { ServiceState } from "../../desktop/src/bridge.ts";
import type { Look } from "../../desktop/src/theme.ts";

/** The name the plugin is registered under, on both sides. */
export const PLUGIN_NAME = "Pine";

/** The phone's system, as Capacitor names it: the page and its bridge are the same on both. */
export type Platform = "android" | "ios";

/**
 * The app's own origin (Capacitor's local server), and where the page fetches the daemon's pictures,
 * video and sound, which the plugin answers from the daemon with the rules of `mediaFromDaemon`
 * (daemon.ts). On Android, a path of the app's own origin that the plugin intercepts. On iOS the app
 * cannot serve `https` (WKWebView handles that scheme itself, and Capacitor falls back to its own),
 * so the origin is `capacitor://localhost` and media come on a scheme of their own, which is the
 * desktop's default base too.
 */
export const ORIGINS = {
	android: { app: "https://localhost", media: "https://localhost/_pine_media" },
	ios: { app: "capacitor://localhost", media: "pine-media://daemon" },
} as const satisfies Record<Platform, { app: string; media: string }>;

/** The origin a page's policy lets media come from: the app's own on Android, the media scheme on iOS. */
export const MEDIA_SOURCE = { android: ORIGINS.android.app, ios: "pine-media:" } as const satisfies Record<Platform, string>;

/**
 * The page's own preferences, which the plugin stores as they are given and gives back. The bridge
 * has checked every value before (as main.ts does), so the plugin keeps the object whole: it reads
 * nothing in it.
 */
export interface PagePrefs {
	notify: boolean;
	updates: boolean;
	keepRunning: boolean;
	/** Whether an agent's open questions get their card above the composer (the bridge reads what an older app stored, without it, as on). */
	questionCards: boolean;
	/** The theme the page was last drawn in, as cleanLook made it safe; none: pmndre. */
	look?: Look;
}

/** What the plugin has stored: the page's preferences, the machines and the one in use. */
export interface StoredPrefs {
	/** None before the first save: the bridge then uses its defaults. */
	prefs?: Partial<PagePrefs>;
	/**
	 * Each a host for ssh, as `addHost` accepted it, or a computer paired by its link,
	 * `paired:<machine id>` (the page's form, desktop/src/machines.ts), as `pair` kept it; at most 20.
	 */
	hosts: string[];
	/** The host in use, one of `hosts`, or none. */
	use?: string;
	/**
	 * The name each paired computer gave when it said yes (`paired:<machine id>` to its name), which
	 * the page shows in place of the id. None, or none for a machine: the page says "your computer".
	 * The service a paired computer is reached through is the plugin's own and is not given here.
	 */
	names?: Record<string, string>;
}

/**
 * The Kotlin plugin. Every method rejects with an error whose message the page can show as it is
 * (it reads like the desktop's: what happened, and what to do next).
 */
export interface PinePlugin {
	/**
	 * How the connection to the machine in use is (the desktop's `ServiceState`: only `starting`, `ready`,
	 * and `error` with kind `ssh` or `failed` here; `starting` with `pairing` while a pairing is open),
	 * whether the event stream is up, the app's version, and whether this build pairs with a computer
	 * by its link (`canPair`: true once the platform's native side does; left out, the page offers no
	 * pairing and is as it was before).
	 */
	state(): Promise<{ state: ServiceState; connected: boolean; version: string; canPair?: boolean; canPairNearby?: boolean }>;
	/** The page has started: send `service` with the state as it is now, and follow the daemon's events (once). */
	ready(): Promise<void>;
	/**
	 * One call of the control API in the owner's name, exactly as `callDaemon` (daemon.ts) makes it:
	 * `{ok, status, data}`, with `data` the JSON answer or `{mime, base64}` for bytes; 503 "pine is not
	 * running yet" before a daemon; 400 "not a call of the control API" for a method other than GET or
	 * POST or a url that does not start with one "/"; status 0 when the daemon does not answer.
	 */
	call(options: { method: "GET" | "POST"; url: string; body?: unknown }): Promise<CallResult>;
	/** Connect again to the machine in use (after an error). */
	retry(): Promise<void>;
	/** Use the pine of a machine of the list: rejects a host that is not in it; stores it as the one in use; connects. */
	use(options: { host: string }): Promise<void>;
	/** Add a machine (checked as `sshHost` of src/remote.ts checks it; at most 20). Resolves with the list as it is now. */
	addHost(options: { host: string }): Promise<{ hosts: string[] }>;
	/** Take a machine out of the list and let go of its connection; rejects the one in use. Resolves with the list as it is now. */
	forgetHost(options: { host: string }): Promise<{ hosts: string[] }>;
	/** What the plugin has stored. */
	loadPrefs(): Promise<StoredPrefs>;
	/** Store the page's preferences, whole, in place of the ones stored. */
	savePrefs(options: { prefs: PagePrefs }): Promise<void>;
	/** Open an address in the phone's browser. The bridge sends only http(s); the plugin checks it again. */
	openExternal(options: { url: string }): Promise<void>;
	/** Hand a text to the system's share sheet (a conversation exported, the phone's key). Resolves once the sheet is shown. */
	share(options: { title: string; text: string }): Promise<void>;
	/** Put a text on the phone's clipboard (the phone's key). */
	copy(options: { text: string }): Promise<void>;
	/**
	 * Paint the status and navigation bars in the page's background color, with light icons on a
	 * dark theme and dark ones on a light theme (Electron's `nativeTheme` and window background in
	 * main.ts). The plugin takes a #rrggbb color and a boolean, nothing else, and keeps them across
	 * a rotation or a change of the system's own theme.
	 */
	systemBars(options: { color: string; dark: boolean }): Promise<void>;
	/** Leave the app (the back button with nothing open in the page): it goes to the back, as Android's own apps do. */
	leave(): Promise<void>;
	// The phone's key and the machines' host keys.
	/** This phone's public key, in OpenSSH's format (`ssh-ed25519 AAAA... pine-android`), made on first use. */
	publicKey(): Promise<{ key: string }>;
	/**
	 * Trust the host key a connection stopped at. Until then the connection is an `error` of kind `ssh`
	 * whose message names the fingerprint (SHA256, as OpenSSH prints it), and which carries it
	 * (`fingerprint`, with `changed` false; a changed key is never trusted: the machine is forgotten
	 * and added again). The page's Trust this key button calls it, through the bridge's `trustHostKey`. Rejects a fingerprint that is not the one the host showed. The plugin then
	 * connects again.
	 */
	trustHostKey(options: { host: string; fingerprint: string }): Promise<void>;
	/** Forget the stored host key of a machine (after it changed for a reason the owner knows). The bridge never asks it for a paired computer, whose key is its machine id. */
	forgetHostKey(options: { host: string }): Promise<void>;

	// Pairing with a computer that runs the Pine app, by the link of its QR code (only where `state()` says `canPair`).
	/**
	 * Pair with the computer a pairing link names, after the owner confirmed it in the page: either
	 * form, `<https service origin>/#pair=<machine id>.<code>` or
	 * `pine://pair?service=<percent-encoded https origin>&id=<machine id>&code=<code>`. The plugin reads
	 * it again with the core's own parser and rejects, starting nothing, one that is not exactly of that
	 * shape (the service `https` only), and while another pairing is open. Resolves once the pairing has
	 * started; how it goes reaches the page as `service` states, in the web client's words:
	 * `{status: "starting", pairing: {name}}` (`name`: this phone's, "Pine on <model>"), then
	 * `{status: "starting", pairing: {code, name}}` once the computer shows the four digits; then either
	 * the computer said yes, and the plugin keeps `paired:<machine id>` among the machines with the
	 * computer's name (`names`) and the link's service, makes it the one in use and connects
	 * (`starting` with `host`, then `ready`); or it did not, and the state is `{status: "error", kind:
	 * "ssh", message}` with no `host` (refused, expired or used, not the computer the link names, no way
	 * to it), nothing kept. Nothing of the link is stored but on a yes, and the code never.
	 */
	pair(options: { link: string }): Promise<void>;
	/** End the pairing that is open, nothing kept: the state is then what it was before the pairing began. Resolves at once when none is open. */
	cancelPairing(): Promise<void>;

	// Pairing with a computer found on the local network (only where `state()` says `canPairNearby`).
	/**
	 * Start (`on: true`) or stop looking for computers that announce themselves on this network with
	 * Bonjour (`_pine._tcp`, NearbyFound in desktop/src/machines.ts): Android's NsdManager, iOS's
	 * NWBrowser. Called only while the page shows the pairing view, so that iOS asks for the local
	 * network only then, never at launch. What is found reaches the page as `nearby` events.
	 */
	nearby(options: { on: boolean }): Promise<void>;
	/**
	 * Pair with a computer found on the network, without a code: as `pair`, but the SSH user is
	 * `nearby.<nonce>` (desktop/electron/access/pairing.ts `NEARBY_USER`), the nonce the announcement
	 * carried, which only a device on that network hears. `id` is the machine id the announcement carried,
	 * `service` the https origin of its meeting service. The host key is checked against `id` as for a
	 * link: an announcement is not trusted, the four digits are what the owner compares. The computer
	 * then states its service with the digits; a pairing whose announcement named another one is
	 * refused, and the stated one is kept. The states are `pair`'s, with the computer's name once the
	 * computer gave it (`pairing.computer`). Rejects an id, a service or a nonce of another shape, and a second pairing.
	 */
	pairNearby(options: { id: string; service: string; nonce: string }): Promise<void>;

	/** The page's state of the connection changed (as `pine:service` on the desktop). */
	addListener(event: "service", fn: (data: { state: ServiceState }) => void): Promise<PluginListenerHandle>;
	/** A batch of the daemon's events, in order (as `pine:events`). */
	addListener(event: "events", fn: (data: { events: PineEvent[] }) => void): Promise<PluginListenerHandle>;
	/** The event stream came up or was lost (as `pine:connection`). */
	addListener(event: "connection", fn: (data: { connected: boolean }) => void): Promise<PluginListenerHandle>;
	/** The app came to the front (true, after the plugin checked the connection) or went to the back (false). */
	addListener(event: "focus", fn: (data: { focused: boolean }) => void): Promise<PluginListenerHandle>;
	/** A command for the page, as the desktop's menu sends it (`pine:menu`): the back button sends "back", which the bridge handles itself. */
	addListener(event: "menu", fn: (data: { command: string }) => void): Promise<PluginListenerHandle>;
	/**
	 * The app was opened with a pairing link (Android's App Link, iOS's `pine:` address), as the
	 * system handed it over, at the start or while the app runs. It starts nothing: the page asks the
	 * owner, and only their yes calls `pair`. Sent with Capacitor's `retainUntilConsumed`, so that a
	 * link the app was started with waits for the page's listener. Only where `canPair`.
	 */
	addListener(event: "link", fn: (data: { link: string }) => void): Promise<PluginListenerHandle>;
	/**
	 * The computers found on the network, all of them each time the list changes (none at first), while
	 * `nearby({on: true})`. `denied`: the system refused the local network to the app (iOS), so that
	 * nothing can be found until the owner allows it in Settings > Pine.
	 */
	addListener(event: "nearby", fn: (data: { computers: { id: string; service: string; nonce: string }[]; denied?: boolean }) => void): Promise<PluginListenerHandle>;
}
