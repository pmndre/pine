// The window's colours. A theme is a VS Code colour theme in the themes folder of pine's home, chosen
// with `ui.theme` in pine.json; the daemon resolves it into pine's colour roles (src/theme-colors.ts
// in pine) and hands the app only those, as colours: `GET /themes`. Here they become the root
// element's variables, which index.css draws every colour from, and `.dark` says whether the theme
// is dark (shadcn's `dark:` variants and the shadows follow it).
//
// The app's main process keeps the theme it was last given (prefs.json, `look`), so that the window
// opens in it before pine answers; it is made safe by `cleanLook` there and here.
//
// An agent can have a colour of its own (`color` in its agent.json). Its avatar is drawn in it, and
// while its conversation is in front the window's accent is that colour (`agentAccent` in the app's
// preferences, on unless it is false), laid over the theme's.

/** A theme as the window draws it. */
export interface Look {
	id: string;
	name: string;
	kind: "dark" | "light";
	colors: Record<string, string>;
}

/** A theme as `GET /themes` lists it: its colours, or why the daemon cannot draw it. */
export type ThemeEntry = Look | { id: string; name: string; problem: string };

const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const COLOUR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/;

export const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/**
 * A theme as it was sent or stored, made safe to draw: every name a role's (letters, digits and -), every
 * value a colour as #rrggbb[aa] or a font style. What is not that at all is undefined (pine's default).
 * A value is never a string that CSS would read as more than a colour.
 */
export function cleanLook(raw: unknown): Look | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const r = raw as Record<string, unknown>;
	if (typeof r.id !== "string" || typeof r.name !== "string" || (r.kind !== "dark" && r.kind !== "light") || !r.colors || typeof r.colors !== "object") return undefined;
	const colors: Record<string, string> = {};
	for (const [k, v] of Object.entries(r.colors as Record<string, unknown>)) {
		if (!NAME.test(k) || typeof v !== "string") continue;
		if (k.endsWith("-style") ? v === "italic" || v === "normal" : COLOUR.test(v)) colors[k] = v;
	}
	if (!colors.bg || !colors.text) return undefined;
	return { id: r.id.slice(0, 64), name: r.name.slice(0, 60), kind: r.kind, colors };
}

// ---- colours of an agent's own ------------------------------------------------------------------------

/**
 * The colours an agent can be given in one click on its settings page (the owner can also type any
 * other). Hues apart from each other and from pmndre's mint (#5de4c7), so that two agents are told
 * apart at a glance.
 */
export const AGENT_COLOURS = [
	{ name: "Red", hex: "#d9534f" },
	{ name: "Coral", hex: "#e0805a" },
	{ name: "Amber", hex: "#d4a017" },
	{ name: "Olive", hex: "#8cb33a" },
	{ name: "Green", hex: "#4caf50" },
	{ name: "Blue", hex: "#4a7fd9" },
	{ name: "Indigo", hex: "#6a5acd" },
	{ name: "Violet", hex: "#a05ad0" },
	{ name: "Pink", hex: "#d65c9e" },
] as const;

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = (hex: string) => {
	const [r, g, b] = channels(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
	const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
};

/** What is written on a colour: white or a near-black, whichever reads better on it. */
export function onColour(hex: string): string {
	return contrast("#ffffff", hex) >= contrast("#141414", hex) ? "#ffffff" : "#141414";
}

/** The roles the agent in front sets over the theme's: the accent, its tint, what is written on it, and the cursor. */
function accentOf(color: string): Record<string, string> {
	const c = color.toLowerCase();
	return { brand: c, "brand-soft": `${c}1f`, "on-accent": onColour(c), "code-cursor": c };
}

// ---- the root element -----------------------------------------------------------------------------------

let look: Look | undefined;
let agent: string | undefined;
/** The variables the root element was given, to take away what the next drawing does not set. */
let set: string[] = [];

function draw(root: HTMLElement = document.documentElement): void {
	for (const name of set) root.style.removeProperty(name);
	set = [];
	const colors = { ...(look?.colors ?? {}), ...(agent ? accentOf(agent) : {}) };
	for (const [k, v] of Object.entries(colors)) {
		root.style.setProperty(`--${k}`, v);
		set.push(`--${k}`);
	}
	root.classList.toggle("dark", (look?.kind ?? "dark") === "dark");
	root.dataset.theme = look?.id ?? "pmndre";
	if (agent) root.dataset.agentColour = agent;
	else delete root.dataset.agentColour;
}

/** Draws the window in a theme, or in pine's default (index.css) with none. */
export function applyLook(next: Look | undefined): void {
	look = next;
	draw();
}

/** The colour of the agent in front, over the theme's accent; none gives the theme's back. */
export function applyAgentAccent(color: string | undefined): void {
	const next = isHex(color) ? color.toLowerCase() : undefined;
	if (next === agent) return;
	agent = next;
	draw();
}
