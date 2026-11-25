// Shared per-window layout, persistence snapshot, and cascading geometry helpers.
// Pure TypeScript with no Electron or DOM runtime dependency so main, preload, renderer, and tests can share it.
import type { SentQuote } from "../../src/quotes.ts";

/** An attachment carried in an unsent draft when moving a tab to a new window. */
export interface WindowAttachment {
	name: string;
	size: number;
	data: string;
	preview?: string;
}

/** A quote carried in an unsent draft when moving a tab to a new window. */
export interface WindowQuote extends SentQuote {
	id: number;
	tab: string;
}

/** Unsent composer state transferred with a tab to a new window. */
export interface WindowDraft {
	draft: string;
	attachments: WindowAttachment[];
	quotes?: WindowQuote[];
}

/** Reference to an open chat conversation tab. */
export interface WindowTabRef {
	agent: string;
	session: string;
}

/** Per-window panel widths in pixels. */
export interface WindowWidths {
	sidebar?: number;
	code?: number;
	aside?: number;
	view?: number;
}

/** Complete per-window tab and panel layout snapshot. */
export interface WindowLayout {
	host?: string;
	tabs: WindowTabRef[];
	active: number;
	noTab?: boolean;
	sidebar: boolean;
	code: boolean;
	aside: boolean;
	view: boolean;
	order?: string[];
	widths: WindowWidths;
	folded: string[];
}

/** Chrome-only layout preserved as the fallback when reopening after all windows are closed. */
export type ChromeLayout = Pick<WindowLayout, "sidebar" | "aside" | "view" | "order" | "widths" | "folded">;

/** Options for opening a new desktop window via `bridge.newWindow`. */
export interface NewWindowOptions {
	/** Target machine host; `null` explicitly opens this computer's local pine; `undefined` inherits caller's environment. */
	host?: string | null;
	/** Open directly with this single conversation tab. */
	tab?: WindowTabRef;
	/** True when moving an existing tab from the calling window (preserves local PTY and skips closeSession). */
	moveFrom?: boolean;
	/** Unsent draft state to seed into `tab` in the new window. */
	draft?: WindowDraft;
}

/** Window screen geometry persisted in prefs.json. */
export interface WindowBounds {
	x?: number;
	y?: number;
	width: number;
	height: number;
}

/** Persisted snapshot of one open desktop window in prefs.json. */
export interface WindowSnapshot {
	bounds?: WindowBounds;
	host?: string;
	layout?: WindowLayout;
}

/** Maximum number of open/persisted desktop windows. */
export const MAX_WINDOWS = 20;

const MAX_DRAFT_ATTACHMENTS = 50;
const MAX_DRAFT_QUOTES = 20;

const VALID_BESIDE = new Set(["code", "aside", "view"]);

/** Sanitizes a persisted or IPC-supplied pixel width. */
function cleanWidth(value: unknown): number | undefined {
	const n = Number(value);
	return Number.isFinite(n) && n >= 120 && n <= 2000 ? Math.round(n) : undefined;
}

/** Sanitizes panel widths. */
export function cleanWidths(raw: unknown): WindowWidths {
	if (!raw || typeof raw !== "object") return {};
	const w = raw as Record<string, unknown>;
	const out: WindowWidths = {};
	const sidebar = cleanWidth(w.sidebar);
	const code = cleanWidth(w.code);
	const aside = cleanWidth(w.aside);
	const view = cleanWidth(w.view);
	if (sidebar !== undefined) out.sidebar = sidebar;
	if (code !== undefined) out.code = code;
	if (aside !== undefined) out.aside = aside;
	if (view !== undefined) out.view = view;
	return out;
}

/** Sanitizes a list of chat tab references. */
export function cleanTabs(raw: unknown): WindowTabRef[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const out: WindowTabRef[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const agent = typeof (item as Record<string, unknown>).agent === "string" ? (item as Record<string, unknown>).agent as string : "";
		const session = typeof (item as Record<string, unknown>).session === "string" ? (item as Record<string, unknown>).session as string : "";
		if (!agent || !session) continue;
		const key = `${agent}:${session}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ agent, session });
		if (out.length >= 50) break;
	}
	return out;
}

/** Sanitizes a panel order array. */
function cleanOrder(raw: unknown): string[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const out = raw.filter((v): v is string => typeof v === "string" && VALID_BESIDE.has(v));
	return out.length ? [...new Set(out)] : undefined;
}

/** Sanitizes folded agent/group keys. */
function cleanFolded(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return [...new Set(raw.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 200))].slice(0, 200);
}

/** Sanitizes a `WindowLayout` from disk or IPC. */
export function cleanWindowLayout(raw: unknown): WindowLayout | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const r = raw as Record<string, unknown>;
	const tabs = cleanTabs(r.tabs);
	const activeNum = Number(r.active);
	const active = Number.isInteger(activeNum) && activeNum >= 0 ? Math.min(activeNum, Math.max(0, tabs.length - 1)) : 0;
	const host = typeof r.host === "string" && r.host ? r.host : undefined;
	const order = cleanOrder(r.order);
	return {
		...(host ? { host } : {}),
		tabs,
		active,
		...(r.noTab === true ? { noTab: true } : {}),
		sidebar: r.sidebar !== false,
		code: r.code === true,
		aside: r.aside === true,
		view: r.view === true,
		...(order ? { order } : {}),
		widths: cleanWidths(r.widths),
		folded: cleanFolded(r.folded),
	};
}

/** Sanitizes a `ChromeLayout` fallback from disk. */
export function cleanChromeLayout(raw: unknown): ChromeLayout | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const r = raw as Record<string, unknown>;
	const order = cleanOrder(r.order);
	return {
		sidebar: r.sidebar !== false,
		aside: r.aside === true,
		view: r.view === true,
		...(order ? { order } : {}),
		widths: cleanWidths(r.widths),
		folded: cleanFolded(r.folded),
	};
}

/** Extracts the chrome-only portion of a full `WindowLayout`. */
export function chromeOf(layout: WindowLayout): ChromeLayout {
	return {
		sidebar: layout.sidebar,
		aside: layout.aside,
		view: layout.view,
		...(layout.order ? { order: [...layout.order] } : {}),
		widths: { ...layout.widths },
		folded: [...layout.folded],
	};
}

/** Sanitizes persisted window bounds. */
export function cleanBounds(raw: unknown): WindowBounds | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const r = raw as Record<string, unknown>;
	const width = Number(r.width);
	const height = Number(r.height);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 300 || height <= 200) return undefined;
	const x = Number(r.x);
	const y = Number(r.y);
	return {
		...(Number.isFinite(x) ? { x: Math.round(x) } : {}),
		...(Number.isFinite(y) ? { y: Math.round(y) } : {}),
		width: Math.round(width),
		height: Math.round(height),
	};
}

/** Sanitizes an array of persisted `WindowSnapshot`s, falling back unknown hosts to local. */
export function cleanWindows(raw: unknown, hosts: string[]): WindowSnapshot[] {
	if (!Array.isArray(raw)) return [];
	const out: WindowSnapshot[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const r = item as Record<string, unknown>;
		const bounds = cleanBounds(r.bounds);
		const rawHost = typeof r.host === "string" && r.host ? r.host : undefined;
		const hostKnown = !rawHost || hosts.includes(rawHost);
		const host = hostKnown ? rawHost : undefined;
		let layout = cleanWindowLayout(r.layout);
		if (layout && !hostKnown) {
			// Host was removed since last save: keep chrome layout, drop stale remote tabs.
			layout = { ...layout, host: undefined, tabs: [], active: 0, noTab: false };
		}
		out.push({ ...(bounds ? { bounds } : {}), ...(host ? { host } : {}), ...(layout ? { layout } : {}) });
		if (out.length >= MAX_WINDOWS) break;
	}
	return out;
}

/** Sanitizes a single attachment carried in a transferred draft. */
function cleanAttachment(raw: unknown): WindowAttachment | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const a = raw as Record<string, unknown>;
	const size = Number(a.size);
	if (typeof a.name !== "string" || typeof a.data !== "string" || !Number.isFinite(size) || size < 0) return undefined;
	return {
		name: a.name,
		size: Math.round(size),
		data: a.data,
		...(typeof a.preview === "string" ? { preview: a.preview } : {}),
	};
}

/** Sanitizes a single quote carried in a transferred draft. */
function cleanQuote(raw: unknown): WindowQuote | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const q = raw as Record<string, unknown>;
	if (typeof q.id !== "number" || !Number.isFinite(q.id) || typeof q.tab !== "string" || typeof q.text !== "string") return undefined;
	const src = q.source;
	let source: WindowQuote["source"] | undefined;
	if (src === "letter" || src === "welcome") {
		source = src;
	} else if (src && typeof src === "object") {
		const s = src as Record<string, unknown>;
		if (Number.isSafeInteger(s.task) && (s.task as number) > 0 && (s.part === "prompt" || s.part === "answer")) {
			source = { task: s.task as number, part: s.part };
		}
	}
	if (!source) return undefined;
	return { id: q.id, tab: q.tab, text: q.text, source };
}

/** Sanitizes a transferred unsent draft from IPC. */
function cleanDraft(raw: unknown): WindowDraft | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const d = raw as Record<string, unknown>;
	if (typeof d.draft !== "string") return undefined;
	const attachments: WindowAttachment[] = [];
	if (Array.isArray(d.attachments)) {
		for (const item of d.attachments) {
			const clean = cleanAttachment(item);
			if (clean) attachments.push(clean);
			if (attachments.length >= MAX_DRAFT_ATTACHMENTS) break;
		}
	}
	let quotes: WindowQuote[] | undefined;
	if (Array.isArray(d.quotes)) {
		quotes = [];
		for (const item of d.quotes) {
			const clean = cleanQuote(item);
			if (clean) quotes.push(clean);
			if (quotes.length >= MAX_DRAFT_QUOTES) break;
		}
	}
	return {
		draft: d.draft,
		attachments,
		...(quotes !== undefined ? { quotes } : {}),
	};
}

/** Sanitizes `NewWindowOptions` supplied over IPC (`pine:new-window`). */
export function cleanNewWindowOptions(raw: unknown): NewWindowOptions | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const r = raw as Record<string, unknown>;
	const out: NewWindowOptions = {};
	if (r.host === null) out.host = null;
	else if (typeof r.host === "string" && r.host) out.host = r.host;
	if (r.tab && typeof r.tab === "object" && !Array.isArray(r.tab)) {
		const t = r.tab as Record<string, unknown>;
		const agent = typeof t.agent === "string" ? t.agent : "";
		const session = typeof t.session === "string" ? t.session : "";
		if (agent && session) out.tab = { agent, session };
	}
	if (typeof r.moveFrom === "boolean") out.moveFrom = r.moveFrom;
	const draft = cleanDraft(r.draft);
	if (draft) out.draft = draft;
	return Object.keys(out).length > 0 ? out : undefined;
}

/** A conversation tab being dragged, as its window tells the main process when the drag starts (`pine:tab-drag`). */
export interface TabDrag {
	tab: WindowTabRef;
	/** The tab's unsent draft, which goes with it wherever it is dropped. */
	draft?: WindowDraft;
}

/** Sanitizes a `TabDrag` supplied over IPC. */
export function cleanTabDrag(raw: unknown): TabDrag | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const r = raw as Record<string, unknown>;
	const [tab] = cleanTabs([r.tab]);
	if (!tab) return undefined;
	const draft = cleanDraft(r.draft);
	return { tab, ...(draft ? { draft } : {}) };
}

/** How a tab drag ended, as its window tells the main process (`pine:tab-drag-end`). */
export interface TabDragEnd {
	/** Nothing took the drop: the tab may have been let go outside every window. */
	outside: boolean;
	/** The tab was the window's only one: the window itself moves there instead of a new one opening. */
	alone: boolean;
	/** Where the drag ended on the screen, as the page saw it. Only a window that is never shown (the tests') goes by it. */
	x?: number;
	y?: number;
}

/** Sanitizes a `TabDragEnd` supplied over IPC. */
export function cleanTabDragEnd(raw: unknown): TabDragEnd {
	const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	const coord = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 100_000 ? Math.round(v) : undefined);
	const x = coord(r.x);
	const y = coord(r.y);
	return { outside: r.outside === true, alone: r.alone === true, ...(x !== undefined && y !== undefined ? { x, y } : {}) };
}

type Rect = { x: number; y: number; width: number; height: number };

/** Whether a point of the screen lies inside a rectangle. */
export function insideRect(point: { x: number; y: number }, r: Rect): boolean {
	return point.x >= r.x && point.x < r.x + r.width && point.y >= r.y && point.y < r.y + r.height;
}

/** Where the pointer lies in a window torn off by its tab: on the tab row, a little in from the left, as if the tab had been picked up there. */
export const TEAR_OFF_GRIP = { x: 140, y: 22 };

/** The bounds of a window torn off at `point`: the size of the window it came from, the pointer on its tab row, inside `workArea`. */
export function tearOffBounds(point: { x: number; y: number }, size: { width: number; height: number }, workArea: Rect): Rect {
	const width = Math.min(size.width, workArea.width);
	const height = Math.min(size.height, workArea.height);
	const x = Math.max(workArea.x, Math.min(point.x - TEAR_OFF_GRIP.x, workArea.x + workArea.width - width));
	const y = Math.max(workArea.y, Math.min(point.y - TEAR_OFF_GRIP.y, workArea.y + workArea.height - height));
	return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** Offset in pixels for cascading a new window from an existing window. */
export const CASCADE_STEP = 24;

/** Computes cascaded bounds offset by (+24, +24) from `anchor`, clamped to `workArea`. */
export function cascadeBounds(
	anchor: { x: number; y: number; width: number; height: number },
	workArea: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
	const width = Math.min(anchor.width, workArea.width);
	const height = Math.min(anchor.height, workArea.height);
	const maxX = workArea.x + Math.max(0, workArea.width - width);
	const maxY = workArea.y + Math.max(0, workArea.height - height);
	let x = anchor.x + CASCADE_STEP;
	let y = anchor.y + CASCADE_STEP;
	if (x > maxX) x = workArea.x + Math.min(CASCADE_STEP, Math.max(0, workArea.width - width));
	if (y > maxY) y = workArea.y + Math.min(CASCADE_STEP, Math.max(0, workArea.height - height));
	x = Math.max(workArea.x, Math.min(x, maxX));
	y = Math.max(workArea.y, Math.min(y, maxY));
	return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}
