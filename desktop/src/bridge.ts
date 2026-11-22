// What the page has of the world outside itself: the bridge the preload script exposes.
import type { Bridge } from "../electron/preload.ts";
import type { Look } from "./theme.ts";

declare global {
	interface Window {
		pine: PageBridge;
	}
	/** Set by `npm run dev:preview` only (vite.config.ts): the page runs in an ordinary browser, with src/preview-bridge.ts. */
	const __PINE_PREVIEW__: boolean;
}

/** The pine the app uses, and how it is. `host` and `label` name another machine reached over SSH; without them it is this computer's. */
export type ServiceState = { status: "starting"; host?: string } | { status: "ready"; mode: string; started: boolean; home: string; version?: string; from: string; host?: string; label?: string } | {
			status: "error";
			kind: "no-home" | "no-node" | "no-pine" | "ssh" | "failed";
			message: string;
			host?: string;
			/** The host key's fingerprint (SHA256, as OpenSSH prints it), when the connection stopped at it. Only a bridge that keeps host keys of its own sets it (a client with an SSH of its own: the mobile app's, the web client's). */
			fingerprint?: string;
			/** Whether that key differs from the one the owner trusted before (never trusted then: the machine is forgotten and added again), or is not known yet (`trustHostKey`). */
			changed?: boolean;
	  };

export interface Prefs {
	home?: string;
	keepRunning: boolean;
	/** Other machines whose pine the app can use, each a host for ssh. */
	hosts: string[];
	/** The one the app uses; none: this computer's pine. */
	use?: string;
	notify: boolean;
	updates: boolean;
	/** The theme the window was last drawn in (theme.ts), so that it opens in it; none: pmndre. */
	look?: Look;
	/**
	 * The web client's own: the page's Web Storage, kept by the bridge, since the page's opaque origin
	 * keeps none across a reload. The other bridges leave it out.
	 */
	storage?: Record<string, string>;
}

export type { Update } from "../electron/updates.ts";

/** What the bridge's `state()` answers when the page starts. */
export interface AppState {
	state: ServiceState;
	/** Whether the event stream is up. */
	connected?: boolean;
	home?: string;
	prefs: Prefs;
	platform: string;
	focused: boolean;
	/** Whether this app asks for a newer one at all. */
	updates: boolean;
	versions: { app: string; electron: string };
	/**
	 * Whether there is a "this computer" whose pine the app can use. Set to false by a bridge that
	 * only reaches other machines (the mobile app's, the web client's): the page then offers no local machine and
	 * never asks `use()` for one. The desktop app and the preview leave it out, which means there is.
	 */
	local?: boolean;
}

/**
 * The bridge as the page sees it: the preload script's, or a stand-in of the same shape (the
 * preview's, the mobile app's, the web client's).
 */
export type PageBridge = Omit<Bridge, "state" | "termFocus" | "wslDistros" | "wslInstall" | "appMenu"> & {
	state: () => Promise<AppState>;
	/** WSL on Windows: its distributions, and the pine the app carries brought into one. The desktop app's only. */
	wslDistros?: Bridge["wslDistros"];
	wslInstall?: (distro: string) => Promise<{ sandbox: string }>;
	/**
	 * Whether the owner's terminal has the keyboard, for a bridge whose window has menus with keys (the
	 * desktop app's): off a Mac the shell's Ctrl keys then reach the shell. The others leave it out.
	 */
	termFocus?: Bridge["termFocus"];
	/**
	 * The app's menus, for a bridge whose window has them and shows no menu bar (the desktop app's off a
	 * Mac): the title bar's menu button opens them. The others leave it out, and the page draws no button.
	 */
	appMenu?: Bridge["appMenu"];
	/**
	 * Where the daemon's pictures, video and sound are fetched from, set by a bridge whose page
	 * fetches them from another address than the app's scheme (the mobile app's, on its own origin; the web client's, whose page asks its bridge for the bytes).
	 * The desktop app and the preview leave it out.
	 */
	mediaBase?: string;
	/**
	 * The SSH key of a bridge that signs in to other machines with a key of its own (the mobile app's,
	 * made on the phone; the web client's, made by the browser): its public key, to put into ~/.ssh/authorized_keys there, and the ways to
	 * hand it over. Settings > Environments shows it. The desktop app, which uses the owner's ssh,
	 * leaves it out.
	 */
	deviceKey?: () => Promise<{ key: string; copy: () => Promise<void>; share: () => Promise<void> }>;
	/**
	 * Trust the host key a connection stopped at, of a bridge that keeps host keys of its own (the
	 * mobile app's, the web client's): the owner's yes to exactly the fingerprint the page showed (the error state's
	 * `fingerprint`, with `changed` false), after which the bridge connects again. The desktop app,
	 * which uses the owner's ssh and its known_hosts, leaves it out.
	 */
	trustHostKey?: (host: string, fingerprint: string) => Promise<void>;
	/**
	 * Lets go of the machine in use and comes back to the list of machines; the machine and its
	 * trusted host key stay (unlike forgetHost). Set by a bridge with no local machine that offers it
	 * (the web client's); the others leave it out and the page shows no Disconnect.
	 */
	disconnect?: () => Promise<Prefs>;
};

export const bridge = window.pine;

/** Where the daemon's pictures, video and sound are fetched from: what the bridge says, else the app's scheme, or in the preview its server's path. */
// (Asked by its type: Storybook's stand-in answers every name with a function.)
export const MEDIA_BASE = typeof bridge.mediaBase === "string" ? bridge.mediaBase : import.meta.env.DEV && __PINE_PREVIEW__ ? "/__pine/media" : "pine-media://daemon";
