// What the page has of the world outside itself: the bridge the preload script exposes.
import type { Bridge } from "../electron/preload.ts";
import type { NearbyFound } from "./machines.ts";
import type { Look } from "./theme.ts";

declare global {
	interface Window {
		pine: PageBridge;
	}
	/** Set by `npm run dev:preview` only (vite.config.ts): the page runs in an ordinary browser, with src/preview-bridge.ts. */
	const __PINE_PREVIEW__: boolean;
}

/** The pine the app uses, and how it is. `host` and `label` name another machine reached over SSH; without them it is this computer's. */
export type ServiceState = {
			status: "starting";
			host?: string;
			/**
			 * A pairing with a computer under way, from a pairing link (the web client's): `code` is the four
			 * digits the computer shows beside `name`, this browser's name, while the owner decides there.
			 * Before the computer answered, neither. The other bridges leave it out.
			 */
			pairing?: { code?: string; name?: string; computer?: string };
	  } | {
			status: "ready";
			mode: string;
			started: boolean;
			home: string;
			version?: string;
			from: string;
			host?: string;
			label?: string;
			/**
			 * The version of the pine this app runs (the one it carries), when the daemon of this computer
			 * that it attached to (not started) says an older one. The desktop bridge alone sets it.
			 */
			olderThan?: string;
	  } | {
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
	/**
	 * The names the owner sees for machines, by machine: the name a paired computer gave, or what the
	 * owner renamed a machine to (`renameHost`). Kept by the web client's bridge; the others leave it out.
	 */
	names?: Record<string, string>;
	notify: boolean;
	updates: boolean;
	/** Whether the app downloads a newer release and installs it on a restart or a quit (the desktop app's own; the others leave it out). */
	autoUpdate?: boolean;
	/** The theme the window was last drawn in (theme.ts), so that it opens in it; none: pmndre. */
	look?: Look;
	/**
	 * The web client's own: the page's Web Storage, kept by the bridge, since the page's opaque origin
	 * keeps none across a reload. The other bridges leave it out.
	 */
	storage?: Record<string, string>;
}

export type { Update, UpdaterState } from "../electron/updates.ts";

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
	/**
	 * Whether machines can be added as user@host. The web client's bridge sets it from its
	 * deployment's configuration: false where the deployment carries no SSH to such machines (its
	 * relay is off), and only a computer paired by its link can be used. The others leave it out, which means they can.
	 */
	canAddHost?: boolean;
	/**
	 * Whether a computer can be paired with by its link: the deployment has the meeting service. The
	 * web client's bridge sets it from its deployment's configuration (`/meet/config` answers). The
	 * others leave it out, which means there is nothing to pair with, and the page offers no pairing.
	 */
	canPair?: boolean;
	/**
	 * Whether the page offers "Open Pine on this computer" (`openApp`): the web client's bridge in a
	 * browser on a computer, where it can pair. The others leave it out.
	 */
	canOpenApp?: boolean;
	/**
	 * The host of the service a machine is reached through (the web client's deployment, its
	 * document's address: "pine-main.drcmda.workers.dev"), which the page names so that the relay and the
	 * meeting service are never forgotten. The others leave it out: they reach machines without one.
	 */
	serviceHost?: string;
	/**
	 * Whether the page can run a view of the owner's (View.tsx): only where its frame (view.html) is built and
	 * served under its own policy, which the desktop app's main process does. The other bridges leave it out,
	 * and their page then shows no button for the view.
	 */
	views?: boolean;
	/**
	 * Whether this app updates itself (a packaged app on a Mac): it downloads a newer release and installs
	 * it on "Restart to update" or a quit. The other bridges, and an app from a checkout, leave it out.
	 */
	selfUpdate?: boolean;
}

export type { AccessChange, AccessDevice, AccessProblem, AccessState } from "../electron/access/control.ts";

/**
 * Browser access to this computer's pine (Settings > Browser access): only the desktop app's bridge
 * has these calls, and a page shows the section only where they are there.
 */
export type AccessCalls = "access" | "setAccess" | "openPairing" | "copyPairingLink" | "cancelPairing" | "answerPairing" | "removeDevice" | "onAccess";

/** The app's own update (`AppState.selfUpdate`): only the desktop app's bridge has these calls. */
export type UpdateCalls = "installUpdate" | "onUpdate";

/**
 * The agent's real browser laid over the panel (electron/browser-host.ts): only the desktop app's bridge has these
 * calls, and only for this computer's pine. Elsewhere the panel draws the pictures the daemon hands over.
 */
export type BrowserCalls = "browserShow" | "browserFocus" | "browserPicture";

/**
 * The bridge as the page sees it: the preload script's, or a stand-in of the same shape (the
 * preview's, the mobile app's, the web client's).
 */
export type PageBridge = Omit<Bridge, "state" | "termFocus" | "wslDistros" | "wslInstall" | AccessCalls | UpdateCalls | BrowserCalls> & Partial<Pick<Bridge, AccessCalls | UpdateCalls | BrowserCalls>> & {
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
	/**
	 * Gives a machine of the list the name the owner sees for it (`Prefs.names`). Set by a bridge that
	 * keeps names (the web client's); the others leave it out.
	 */
	renameHost?: (host: string, name: string) => Promise<Prefs>;
	/**
	 * Pair with the computer of a pairing link (machines.ts `readPairLink`), after the owner said yes
	 * to it in the page: the pairing then goes as the web client's does, through the service state
	 * (`pairing`, then the machine in use, or an error with no machine). Rejects a link that is not a
	 * pairing link of an `https` service, starting nothing. Set by a bridge that takes a link from the
	 * owner's hand (the mobile app's), where `canPair`; the web client's pairs with the link of its
	 * address by itself and leaves it out, and the page then shows no field to paste one.
	 */
	pair?: (link: string) => Promise<void>;
	/** End the pairing that is open, nothing kept (the bridge that has `pair`). */
	stopPairing?: () => Promise<void>;
	/** A pairing link the app was opened with (the mobile app's): starts nothing, the page asks the owner first. */
	onPairLink?: (fn: (link: string) => void) => () => void;
	/**
	 * Look for computers that announce themselves on this network (ADR 0005), for as long as the page
	 * listens: told every computer found, each time the list changes. Set by a bridge that can look (the
	 * mobile app's, where its native side can); the page listens only while it shows how to pair, so that
	 * a phone asks for the local network then and never at launch.
	 */
	nearby?: (fn: (found: NearbyFound) => void) => () => void;
	/** Pair with a computer found on the network, without a code: the pairing goes as `pair`'s does, through the service state. */
	pairNearby?: (id: string, service: string, nonce: string) => Promise<void>;
	/**
	 * Open the Pine app on this computer to add this browser (`pine://pair`). The web client's bridge,
	 * which offers it where it says `canOpenApp`.
	 */
	openApp?: () => Promise<void>;
};

export const bridge = window.pine;

/** Where the daemon's pictures, video and sound are fetched from: what the bridge says, else the app's scheme, or in the preview its server's path. */
// (Asked by its type: Storybook's stand-in answers every name with a function.)
export const MEDIA_BASE = typeof bridge.mediaBase === "string" ? bridge.mediaBase : import.meta.env.DEV && __PINE_PREVIEW__ ? "/__pine/media" : "pine-media://daemon";
