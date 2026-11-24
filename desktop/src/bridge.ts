// What the page has of the world outside itself: the bridge the preload script exposes.
import type { Bridge, DraftAttachment, NewWindowOptions, WindowLayout } from "../electron/preload.ts";
import type { PineEvent } from "./api.ts";
import type { Look } from "./theme.ts";

export type { DraftAttachment, NewWindowOptions, WindowLayout };

/** A daemon event delivered through the desktop bridge, with optional main-process routing hints. */
export type DesktopPineEvent = PineEvent & { askModal?: boolean };

declare global {
	interface Window {
		pine: Bridge;
	}
	/** Set by `npm run dev:preview` only (vite.config.ts): the page runs in an ordinary browser, with src/preview-bridge.ts. */
	const __PINE_PREVIEW__: boolean;
}

/** The pine the app uses, and how it is. `host` and `label` name another machine reached over SSH; without them it is this computer's. */
export type ServiceState = { status: "starting"; host?: string } | { status: "ready"; mode: string; started: boolean; home: string; version?: string; from: string; host?: string; label?: string } | { status: "error"; kind: "no-home" | "no-node" | "no-pine" | "ssh" | "failed"; message: string; host?: string };

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
	/** While a coloured agent's conversation is in front, the window's accent is its colour (on unless false). */
	agentAccent: boolean;
}

export interface AppState {
	state: ServiceState;
	connected: boolean;
	home?: string;
	prefs: Prefs;
	platform: string;
	focused: boolean;
	updates: boolean;
	versions: { app: string; electron: string };
	windowId: number;
	windowLayout?: WindowLayout;
	noTab?: boolean;
	initialTab?: { agent: string; session: string };
	initialDraft?: { text: string; attachments: DraftAttachment[] };
	openHosts: string[];
}

export type { Update } from "../electron/updates.ts";

export const bridge = window.pine;

/** Where the daemon's pictures, video and sound are fetched from: the window's own scheme, or in the preview its server's path. */
export const MEDIA_BASE = typeof bridge?.mediaBase === "string" ? bridge.mediaBase : import.meta.env.DEV && __PINE_PREVIEW__ ? "/__pine/media" : "pine-media://daemon";
