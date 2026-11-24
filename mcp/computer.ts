// Bundled MCP server "computer": operate the apps on the owner's computer (macOS, Windows, Linux with X11).
//
// One tool set, two ways to work:
//
//   - A model that reads: app_snapshot gives a window as an outline taken from the accessibility
//     tree, in which every control that can be used has a reference; app_press, app_set_text and
//     app_menu act on references and menu names. Nothing has to be seen.
//   - A model that sees: app_screenshot gives a picture of a window or of the screen; app_click,
//     app_drag and app_scroll take positions in that picture, which are turned into points on the
//     screen here (a picture is smaller than a Retina window, and a second display has its own
//     place on the plane).
//   - For both: app_type and app_key use the keyboard, app_open starts or brings forward, apps lists.
//
// The work on the machine is done by a helper, computer.swift, that this server builds with
// `swiftc` on first use and keeps in pine's home. Why a compiled helper and not JXA through
// `osascript`: the accessibility API is a C API of out-parameters and CoreFoundation types that
// JXA's bridge reaches only in parts and unreliably; its other route, System Events, makes one
// Apple event per property (a window of a few hundred controls takes many seconds) and needs a
// third grant (Automation) on top. A small Swift program has neither problem, needs no dependency
// besides Apple's command line tools, which a Mac that has git already has, and one that has not
// is told what to install. The helper decides nothing: which app may be operated and what a
// result says is here.
//
// On Windows the helper is computer.cs, built with the C# compiler every Windows carries
// (src/csharp.ts), on UI Automation, SendInput and PrintWindow. On Linux it is
// computer-linux.py, run by the system's python3: AT-SPI for the outline, xdotool for the mouse
// and the keyboard, ImageMagick's `import` for pictures; X11 only, since under Wayland a program
// may neither see where another app's windows are nor send it keys. All three speak the same
// protocol. Windows and X11 cannot send keys to a process, only to the window in front: those
// helpers check before each piece of input that the app that was named is still in front, and
// under the position of a click, and stop when it is not ("moved").
//
// Who may use it is the daemon's business (src/agents.ts): only the owner's own conversations of
// an agent whose reach is the account get this server, and the owner is asked once per app in a
// conversation. What this server adds is that an action lands in the app that was named: a
// reference belongs to it, a position lies in one of its windows, and keys are sent to its process alone.
// It does not click or type in the app pine itself runs in, nor in the Pine app wherever it runs: that
// is where pine's questions are answered. The Pine app may use a pine it did not start (one started
// in a terminal, or kept running after the app quit), and then it is no app pine runs in: it is
// known by its bundle id instead (`PINE_APP`).
//
// Everything a screen shows is outside content; pine marks sessions that use it as tainted.
//
// options: { images?, imageSize?, block?: string[] }
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { type McpContent, type McpTool, options, serve } from "./lib.ts";
import { APP_LOOK, hasDesktop, WHOLE_SCREEN } from "../src/computer.ts";
import { buildCsharp, frameworkDir } from "../src/csharp.ts";
import { prebuilt } from "../src/prebuilt.ts";

export interface ComputerOptions {
	/** false: for a model that cannot see. app_screenshot and the tools that take positions in a picture are not offered. Default true. */
	images?: boolean;
	/** The longer side of a picture, in pixels. Default 1280. */
	imageSize?: number;
	/** Tools to leave out. */
	block?: string[];
	/** Set by pine, not by the owner: where the built helper is kept, in pine's home. */
	helperDir?: string;
	/** A program that speaks the helper's protocol, used instead of building one: a path, or a command with its arguments. For development and tests. */
	helper?: string | string[];
}

const X = { type: "number", description: "Pixels from the left edge of the last picture" };
const Y = { type: "number", description: "Pixels from the top edge of the last picture" };
const tool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) => ({
	name,
	description,
	inputSchema: { type: "object", properties, required },
	...(APP_LOOK.includes(name) ? { annotations: { readOnlyHint: true } } : {}),
});

/** How the system is called in a sentence, and an app and a shortcut a model there knows. */
const WORDS: Record<string, { machine: string; app: string; opener: string; mod: string }> = {
	darwin: { machine: "Mac", app: "TextEdit", opener: "Safari", mod: "cmd" },
	win32: { machine: "computer", app: "Notepad", opener: "Notepad", mod: "ctrl" },
	linux: { machine: "computer", app: "gedit", opener: "Firefox", mod: "ctrl" },
};
const wordsFor = (platform: string) => WORDS[platform] ?? WORDS.linux;

/** The tools, in the words of the system they run on. Written for a small local model: short, concrete, one thing each. */
export function toolsFor(platform: string = process.platform) {
	const w = wordsFor(platform);
	const APP = { type: "string", description: `The app's name, as apps lists it. Example: ${w.app}` };
	return [
		tool("apps", `List the apps that are running on your owner's ${w.machine}, with their windows. Start here: it shows what is open and what each app is called.`),
		tool("app_open", "Open an app, or bring it to the front when it is already running.", { app: { type: "string", description: `The app's name. Example: ${w.opener}` } }, ["app"]),
		tool(
			"app_snapshot",
			"Read a window of an app as text: an outline of everything in it, with what it says. Every control that can be used has a reference like [ref=e12], for app_press and app_set_text. Take a new one after something has changed.",
			{ app: APP, window: { type: "string", description: "Which window, when the app has several: the window's number or a part of the title. Default: the front one" } },
			["app"],
		),
		tool("app_press", "Press a control by the control's reference from app_snapshot: a button, a checkbox, a link, a tab, a row of a list.", { app: APP, ref: { type: "string", description: "The reference from app_snapshot. Example: e12" } }, ["app", "ref"]),
		tool(
			"app_set_text",
			"Put text into a text field by the field's reference from app_snapshot. It replaces what the field held. A search or address field acts only on the return key: press it with app_key afterwards.",
			{ app: APP, ref: { type: "string", description: "The reference from app_snapshot. Example: e12" }, text: { type: "string", description: "The text the field should hold" } },
			["app", "ref", "text"],
		),
		tool(
			"app_menu",
			'Pick an entry from an app\'s menu bar. Example: path "File > Save". Without path it lists the menus; with the name of a menu it lists what is in it.',
			{ app: APP, path: { type: "string", description: 'Menu names from the menu bar down, separated by " > ". Example: Format > Font > Bold' } },
			["app"],
		),
		tool(
			"app_screenshot",
			"Take a picture of an app's window, or of the whole screen when no app is given. For a model that can see pictures; to read text, app_snapshot is better. The answer says how large the picture is: app_click, app_drag and app_scroll take positions in it.",
			{ app: APP, window: { type: "string", description: "Which window, when the app has several: the window's number or a part of the title. Default: the front one" }, screen: { type: "number", description: "Without app: which screen, when there are several. Default 1, the main one" } },
		),
		tool(
			"app_click",
			'Click at a position in the last picture from app_screenshot. count 2 is a double click. button "right" opens the context menu.',
			{ app: APP, x: X, y: Y, button: { type: "string", enum: ["left", "right"], description: "Default left" }, count: { type: "number", description: "1, 2 or 3 clicks. Default 1" } },
			["app", "x", "y"],
		),
		tool(
			"app_drag",
			"Press the mouse button at one position in the last picture, move to another and let go: to move something, to select, to pull a slider.",
			{ app: APP, x: X, y: Y, to_x: { type: "number", description: "Where to let go: pixels from the left edge of the last picture" }, to_y: { type: "number", description: "Where to let go: pixels from the top edge of the last picture" } },
			["app", "x", "y", "to_x", "to_y"],
		),
		tool(
			"app_scroll",
			"Turn the scroll wheel over a position in the last picture.",
			{ app: APP, x: X, y: Y, direction: { type: "string", enum: ["up", "down", "left", "right"] }, amount: { type: "number", description: "How many lines. Default 5" } },
			["app", "x", "y", "direction"],
		),
		tool(
			"app_type",
			"Type text on the keyboard into an app, where the app's cursor is. Put the cursor into the field first (app_press or app_click). A line break in the text presses the return key. The app may correct what is typed, as it does for a person; app_set_text writes exactly.",
			{ app: APP, text: { type: "string", description: "The text to type" } },
			["app", "text"],
		),
		tool(
			"app_key",
			`Press a key or a shortcut in an app. Examples: "return", "tab", "escape", "down", "${w.mod}+s", "${w.mod}+shift+z". Several, separated by spaces, are pressed one after another.`,
			{ app: APP, keys: { type: "string", description: `Example: ${w.mod}+a` } },
			["app", "keys"],
		),
	];
}
export const TOOLS = toolsFor();
/** What needs eyes: left out for a model that cannot see. */
export const PICTURE_TOOLS = ["app_screenshot", "app_click", "app_drag", "app_scroll"];

/** Where `hasDesktop` says there is a screen to work on; with a stand-in for the helper, wherever that runs. */
export const available = (o: Pick<ComputerOptions, "helper">, platform: string = process.platform, env: NodeJS.ProcessEnv = process.env) => hasDesktop(platform, env) || Boolean(o.helper);

export function unavailable(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): string {
	const end = "Tell your owner that; do not look for another way to click or type in apps.";
	if (platform === "linux" && (env.WAYLAND_DISPLAY || env.XDG_SESSION_TYPE === "wayland")) {
		return `App control is not available here: this Linux desktop runs Wayland, and app control works with X11 only (on Ubuntu the session "Ubuntu on Xorg", chosen at the login screen). Under Wayland a program may not see other apps' windows or send them keys. ${end}`;
	}
	if (platform === "linux") return `App control is not available here: pine runs without a screen (no X11 display: DISPLAY is not set), so there are no apps to operate. It works when pine is started inside the owner's desktop session. ${end}`;
	return `App control is not available on this system (${platform}). It works on macOS, Windows and Linux with X11. ${end}`;
}

export function toolsOffered(o: ComputerOptions, platform: string = process.platform, env: NodeJS.ProcessEnv = process.env) {
	if (!available(o, platform, env)) return [];
	return toolsFor(platform).filter((t) => !(o.block ?? []).includes(t.name) && (o.images !== false || !PICTURE_TOOLS.includes(t.name)));
}

// ---- the outline ---------------------------------------------------------------------------------

export interface Node {
	role: string;
	subrole?: string;
	ref?: string;
	title?: string;
	desc?: string;
	help?: string;
	placeholder?: string;
	value?: string | number;
	/** How many characters of a long text were left out. */
	more?: number;
	disabled?: boolean;
	focused?: boolean;
	selected?: boolean;
	press?: boolean;
	edit?: boolean;
	children?: Node[];
}

const ROLES: Record<string, string> = {
	AXButton: "button", AXCheckBox: "checkbox", AXRadioButton: "radio button", AXPopUpButton: "pop-up button", AXMenuButton: "menu button", AXTextField: "text field",
	AXTextArea: "text area", AXStaticText: "text", AXImage: "image", AXLink: "link", AXGroup: "group", AXScrollArea: "scroll area", AXTable: "table", AXOutline: "list",
	AXRow: "row", AXCell: "cell", AXToolbar: "toolbar", AXTabGroup: "tabs", AXSlider: "slider", AXComboBox: "combo box", AXHeading: "heading", AXWebArea: "web page",
	AXList: "list", AXSheet: "dialog", AXSplitGroup: "group", AXDisclosureTriangle: "disclosure triangle", AXMenuItem: "menu entry", AXMenu: "menu", AXIncrementor: "stepper",
	AXProgressIndicator: "progress bar", AXBusyIndicator: "busy indicator", AXColorWell: "color well", AXDateField: "date field", AXPopover: "popover", AXWindow: "window",
};
const SUBROLES: Record<string, string> = {
	AXCloseButton: "close button", AXMinimizeButton: "minimize button", AXZoomButton: "zoom button", AXFullScreenButton: "full screen button", AXSearchField: "search field",
	AXSecureTextField: "password field", AXTabButton: "tab", AXDialog: "dialog", AXSystemDialog: "dialog", AXToggle: "switch", AXSwitch: "switch",
};

/** A role as a word a person would use. */
export function roleName(role = "", subrole = ""): string {
	return SUBROLES[subrole] ?? ROLES[role] ?? (role.replace(/^AX/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() || "thing");
}

/** Containers that say nothing by themselves: what is in them moves up a level. */
const FLAT = new Set(["AXGroup", "AXSplitGroup", "AXScrollArea", "AXLayoutArea", "AXCell", "AXUnknown", "AXGenericElement"]);
const TICKED = new Set(["AXCheckBox", "AXRadioButton"]);
const oneLine = (s: string, max: number) => {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length > max ? `${t.slice(0, max)}…` : t;
};
const quote = (s: string, max = 200) => `"${oneLine(s, max).replace(/"/g, "'")}"`;
/** What somebody would call a control: its role, and its name if it has one. */
const called = (n: { role?: string; subrole?: string; title?: string }) => `${roleName(n.role, n.subrole)}${n.title ? ` ${quote(n.title, 60)}` : ""}`;

/**
 * A window as an indented outline. Controls that can be used carry their reference; containers
 * without a name are left out and their content moves up, so that a small model reads a few
 * dozen lines and not the app's whole view hierarchy.
 */
export function outline(root: Node, limit = 24_000): string {
	const visit = (n: Node, parent: string): string[] => {
		const label = oneLine(n.title || n.desc || (n.role === "AXStaticText" ? String(n.value ?? "") : "") || (n.ref ? (n.help ?? "") : ""), 100_000);
		const parts = (n.children ?? []).map((c) => visit(c, label || parent)).filter((lines) => lines.length);
		const kids = parts.flat();
		if (n.role === "AXStaticText") {
			const text = String(n.value ?? n.title ?? n.desc ?? "");
			// A button's own caption, said again by the text inside it.
			if (!text.trim() || oneLine(text, 100_000) === parent) return kids;
			return text.includes("\n") || text.length > 200 ? ["- text:", ...block(text, n.more), ...kids] : [`- text ${quote(text)}`, ...kids];
		}
		const value = n.value !== undefined && !TICKED.has(n.role) ? n.value : undefined;
		if (!n.ref && !label && value === undefined) {
			// A container of one thing is that thing.
			if (FLAT.has(n.role) || parts.length <= 1) return kids;
		}
		const states = [
			...(TICKED.has(n.role) && n.value !== undefined ? [n.value === 1 ? "checked" : n.value === 2 ? "mixed" : "not checked"] : []),
			...(n.focused ? ["focused"] : []),
			...(n.selected ? ["selected"] : []),
			...(n.disabled && n.ref ? ["disabled"] : []),
			...(n.edit && value === undefined ? [n.placeholder ? `empty, shows ${quote(n.placeholder, 60)}` : "empty"] : []),
		];
		let head = `- ${roleName(n.role, n.subrole)}${label ? ` ${quote(label)}` : ""}${n.ref ? ` [ref=${n.ref}]` : ""}${states.length ? ` (${states.join(", ")})` : ""}`;
		const long = typeof value === "string" && (value.includes("\n") || value.length > 200);
		if (value !== undefined && !long && String(value) !== label) head += `: ${typeof value === "string" ? quote(value) : value}`;
		return [long ? `${head}, holds:` : head, ...(long ? block(String(value), n.more) : []), ...kids.map((l) => `  ${l}`)];
	};
	const block = (text: string, more?: number) => [...text.replace(/\n+$/, "").split("\n").map((l) => `    ${l}`), ...(more ? [`    [${more} more characters are not shown]`] : [])];
	const lines = (root.children ?? []).flatMap((c) => visit(c, oneLine(root.title ?? "", 100_000)));
	let out = "";
	for (let i = 0; i < lines.length; i++) {
		if (out.length + lines[i].length > limit) return `${out}[cut: ${lines.length - i} more lines. The window holds more than fits here; scroll it or open a smaller part, then take a new app_snapshot]`;
		out += `${lines[i]}\n`;
	}
	return out.trimEnd() || "(the window is empty)";
}

// ---- keys, windows, positions --------------------------------------------------------------------

const MODS: Record<string, string> = {
	cmd: "cmd", command: "cmd", meta: "cmd", super: "cmd", win: "cmd", "⌘": "cmd", ctrl: "ctrl", control: "ctrl", "⌃": "ctrl",
	alt: "alt", option: "alt", opt: "alt", "⌥": "alt", shift: "shift", "⇧": "shift", fn: "fn",
};
const KEYS = ["return", "tab", "space", "delete", "forwarddelete", "escape", "left", "right", "up", "down", "home", "end", "pageup", "pagedown", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12"];
const KEY_ALIASES: Record<string, string> = {
	enter: "return", esc: "escape", backspace: "delete", del: "forwarddelete", arrowleft: "left", arrowright: "right", arrowup: "up", arrowdown: "down", pgup: "pageup", pgdn: "pagedown", pgdown: "pagedown", spacebar: "space", "↵": "return", "⎋": "escape", "⇥": "tab", "⌫": "delete",
};

/** "cmd+shift+s return" as the keys to press, in order. Throws a sentence for the model when something is not a key. */
export function parseKeys(text: unknown): Array<{ key: string; mods: string[] }> {
	const parts = String(text ?? "").trim().split(/[\s,]+/).filter(Boolean);
	if (!parts.length) throw new Error('Say which key: for example "return", "tab" or "cmd+s".');
	return parts.map((part) => {
		// "cmd++" is cmd and the plus key.
		const pieces = part === "+" ? ["+"] : part.endsWith("++") ? [...part.slice(0, -2).split("+"), "+"] : part.split("+");
		const last = pieces.pop() ?? "";
		const mods = pieces.map((m) => {
			const mod = MODS[m.toLowerCase()];
			if (!mod) throw new Error(`"${m}" in "${part}" is not a modifier key. Use cmd, ctrl, alt, shift or fn.`);
			return mod;
		});
		const name = last.toLowerCase().replace(/[-_]/g, "");
		const key = KEY_ALIASES[name] ?? (KEYS.includes(name) ? name : [...last].length === 1 ? last.toLowerCase() : undefined);
		if (!key) throw new Error(`"${last}" is not a key. Use one character, or one of: ${KEYS.join(", ")}. To type text, use app_type.`);
		return { key, mods: [...new Set(mods)] };
	});
}

export interface Win {
	index: number;
	ref: string;
	title: string;
	minimized?: boolean;
	main?: boolean;
	x?: number;
	y?: number;
	w?: number;
	h?: number;
}

const windowLine = (w: Win) => `${w.index} ${quote(w.title || "(no title)", 80)}${w.minimized ? " (minimized)" : ""}`;

/** The window somebody means: by number, or by a part of its title. Nothing asked for: none, and the helper takes the front one. */
export function pickWindow(windows: Win[], want: unknown): Win | undefined {
	if (want === undefined || want === null || String(want).trim() === "") return undefined;
	const text = String(want).trim();
	const found = /^\d+$/.test(text) ? windows.find((w) => w.index === Number(text)) : (windows.find((w) => w.title.toLowerCase() === text.toLowerCase()) ?? windows.find((w) => w.title.toLowerCase().includes(text.toLowerCase())));
	if (!found) throw new Error(windows.length ? `There is no window "${text}". The windows are: ${windows.map(windowLine).join(", ")}.` : "The app has no window open.");
	return found;
}

/** What a picture shows: its size in pixels, and the part of the screen it is a picture of, in screen points. */
export interface Picture {
	width: number;
	height: number;
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * A position in a picture as a point on the screen. The picture may be smaller than what it
 * shows (a Retina window has twice the pixels, and pictures are scaled down for the model), and
 * what it shows may lie anywhere on the plane of the displays, so both are a matter of ratio and offset.
 */
export function toScreen(p: Picture, px: number, py: number): { x: number; y: number } {
	const round = (n: number) => Math.round(n * 10) / 10;
	return { x: round(p.x + ((px + 0.5) * p.w) / p.width), y: round(p.y + ((py + 0.5) * p.h) / p.height) };
}

// ---- the server's logic --------------------------------------------------------------------------

export interface ComputerIo {
	/** Starts the helper. Rejects with a sentence for the agent when there is none to start. */
	launch(): Promise<ChildProcess>;
	/** A folder for pictures on their way to the model. */
	scratch: string;
	/** How long a call waits for the helper to be built before it says "try again", in milliseconds. */
	patience?: number;
}

interface AppInfo {
	name: string;
	pid: number;
	bundle: string;
	host: boolean;
	front: boolean;
	launched?: boolean;
	windows?: Win[];
}

/**
 * The Pine app's bundle id: the packed app's (desktop/scripts/pack.mjs) and, with a suffix, the copy of
 * Electron a run from a checkout starts (desktop/scripts/dev-electron.mjs).
 */
export const PINE_APP = /^dev\.pine\.desktop(\.|$)/;
/**
 * The Pine app on Windows and Linux, where the helper says what program an app is by its path
 * (mcp/computer.cs, mcp/computer-linux.py): Pine.exe, and pine-desktop (desktop/scripts/pack.mjs).
 */
export const PINE_PROGRAM = /(^|[\\/])(pine\.exe|pine-desktop)$/i;

/** Where pine does not act: the app it runs in, and the Pine app wherever it runs. */
export const answersHere = (a: Pick<AppInfo, "host" | "bundle">) => a.host || PINE_APP.test(a.bundle ?? "") || PINE_PROGRAM.test(a.bundle ?? "");

class HelperError extends Error {
	code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

export const BUILDING = "pine is building the helper for app control. That happens once and takes about half a minute. Try again in a moment.";

/** What the agent is told when the system has not been told to let pine in. Plain words, and where to click. */
export function grantText(kind: "accessibility" | "screen", host: string | undefined, shown: boolean, system: System = "mac"): string {
	if (system === "windows") return "Windows did not let pine read that app's windows. Nothing was done. Tell your owner, and try again in a moment.";
	if (system === "linux") {
		return "This Linux desktop does not let pine read its apps: its accessibility service (AT-SPI) is not running or is switched off. Your owner switches it on once: in a terminal, gsettings set org.gnome.desktop.interface toolkit-accessibility true, then logs out and in again (or at least starts the app again). Nothing was done. Tell your owner this, and try again when they say it is done.";
	}
	const who = host ? `"${host}", the app pine runs in` : "the app pine runs in (the terminal app pine was started from)";
	if (kind === "accessibility") {
		return `macOS does not let pine operate apps yet. Your owner has to allow it, once: open System Settings > Privacy & Security > Accessibility and switch on ${who}.${shown ? " macOS has just put a window on their screen that leads there." : ""} Nothing was done. Tell your owner this, and try again when they say it is done.`;
	}
	return `macOS does not let pine take pictures of the screen yet. Your owner has to allow it, once: open System Settings > Privacy & Security > Screen & System Audio Recording (on older systems: Screen Recording) and switch on ${who}. macOS then wants that app quit and opened again, so pine has to be started again too.${shown ? " macOS has just put a window on their screen that leads there." : ""} Tell your owner this. Until then you can read windows with app_snapshot, which needs no picture.`;
}

type Result = string | McpContent[];

/** Which helper answers: it says so in `status`. One that does not (the macOS helper, the tests' stand-in) is the Mac's. */
export type System = "mac" | "windows" | "linux";

/**
 * Modifier keys as the system has them. On Windows and Linux "cmd" is taken for ctrl, which is
 * what a shortcut there uses, and the Windows key is never pressed: it talks to the system, not
 * to the app, so the keys would not stay in the app that was named.
 */
export function modsFor(system: System, mods: string[]): string[] {
	if (system === "mac") return mods;
	if (mods.includes("fn")) throw new Error(`There is no fn key to press on ${system === "windows" ? "Windows" : "Linux"}. Use ctrl, alt or shift, for example ctrl+s.`);
	return [...new Set(mods.map((m) => (m === "cmd" ? "ctrl" : m)))];
}

/**
 * The tools, on top of a helper that is started when the first one is used. Calls run one after
 * another: there is one mouse and one keyboard.
 */
export function computer(o: ComputerOptions, io: ComputerIo): { call(name: string, args: Record<string, any>): Promise<Result>; close(): void } {
	let child: ChildProcess | undefined;
	let starting: Promise<ChildProcess> | undefined;
	/** Requests a helper has not answered yet, with the helper they were sent to. */
	const waiting = new Map<number, { to: ChildProcess; answer(msg: any): void }>();
	let ids = 0;
	/** The app pine runs in and the system the helper works on, once asked for. */
	let facts: { host?: { name: string; pid: number }; system: System } | undefined;
	/** The last picture the model was given, and what it showed. */
	let picture: (Picture & { pid?: number; app?: string; ref?: string; dx: number; dy: number }) | undefined;
	/** macOS shows its own request once for each grant; after that it is the agent who says it. */
	const prompted = new Set<string>();
	let queue: Promise<unknown> = Promise.resolve();

	const wire = (c: ChildProcess) => {
		let last = "";
		c.stderr?.on("data", (d) => (last = `${last}${d}`.slice(-600)));
		readline.createInterface({ input: c.stdout! }).on("line", (line) => {
			try {
				const msg = JSON.parse(line);
				waiting.get(msg.id)?.answer(msg);
			} catch {
				// not an answer
			}
		});
		c.stdin?.on("error", () => {});
		c.on("exit", () => {
			if (child === c) child = undefined;
			const why = last.trim().split("\n").at(-1);
			// Only what was asked of this helper: a new one may be at work already.
			for (const w of [...waiting.values()]) if (w.to === c) w.answer({ ok: false, code: "ended", error: `pine's helper for app control stopped${why ? `: ${why.slice(0, 300)}` : ""}. Try once more.` });
		});
	};
	const start = (): Promise<ChildProcess> => {
		if (child) return Promise.resolve(child);
		starting ??= io.launch().then(
			(c) => {
				wire(c);
				child = c;
				starting = undefined;
				return c;
			},
			(e) => {
				starting = undefined;
				throw e;
			},
		);
		// A call must not wait longer than a tool call may take. The build goes on, and the next call finds it done.
		let timer: NodeJS.Timeout;
		const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(BUILDING)), io.patience ?? 20_000)));
		starting.catch(() => {});
		return Promise.race([starting, late]).finally(() => clearTimeout(timer));
	};
	const stop = () => {
		const c = child;
		child = undefined;
		c?.kill();
	};
	const ask = async (cmd: string, params: Record<string, unknown> = {}, ms = 20_000): Promise<any> => {
		const c = await start();
		return new Promise((resolve, reject) => {
			const id = ++ids;
			const timer = setTimeout(() => {
				waiting.delete(id);
				// Whatever it hangs on, a new helper does not.
				if (child === c) stop();
				reject(new Error("The app did not answer in time. It may be busy or showing a dialog. Look at it again (app_snapshot) before you go on."));
			}, ms);
			waiting.set(id, {
				to: c,
				answer(msg) {
					clearTimeout(timer);
					waiting.delete(id);
					if (msg.ok) resolve(msg);
					else reject(new HelperError(String(msg.code ?? "failed"), String(msg.error ?? "")));
				},
			});
			c.stdin!.write(`${JSON.stringify({ ...params, id, cmd })}\n`);
		});
	};

	const about = async () => {
		if (!facts) {
			const s = await ask("status");
			facts = { host: (s.host as { name: string; pid: number } | undefined) ?? undefined, system: s.system === "windows" || s.system === "linux" ? s.system : "mac" };
		}
		return facts;
	};
	const hostApp = async () => (await about()).host;
	const system = async () => (await about()).system;
	/** A failure of the helper as a sentence the agent can act on. */
	const explain = async (e: unknown): Promise<Error> => {
		if (!(e instanceof HelperError)) return e instanceof Error ? e : new Error(String(e));
		if (e.code === "accessibility" || e.code === "screen") {
			let shown = false;
			let name: string | undefined;
			let on: System = "mac";
			try {
				name = (await hostApp())?.name;
				on = await system();
				// Only macOS has a window of its own that leads the owner to the switch.
				if (on === "mac" && !prompted.has(e.code)) {
					prompted.add(e.code);
					await ask("status", { ask: e.code });
					shown = true;
				}
			} catch {
				// the sentence below still says what to do
			}
			// A helper that was started before the owner allowed it does not see the grant: the next call starts a new one.
			stop();
			return new Error(grantText(e.code, name, shown, on));
		}
		if (e.code === "ended") return new Error(e.message);
		if (e.code === "gone") return new Error("That reference does not exist any more: the window has changed. Take a new app_snapshot and use the references from it.");
		if (e.code === "not_running") return new Error("The app is not running any more. Open it again with app_open.");
		if (e.code === "minimized") return new Error(`That window is put away in the ${(await system().catch(() => "mac")) === "mac" ? "Dock" : "taskbar (minimized)"}, so there is nothing to take a picture of. Bring the app to the front with app_open first.`);
		if (e.code === "moved") return new Error("Another window came to the front, or lies where the click was to land, so pine stopped: nothing more was typed or clicked. Your owner may be using the computer. Look at the app again (app_snapshot or app_screenshot) before you go on.");
		if (e.code === "elevated") return new Error("That app runs as administrator, and Windows does not let a program without those rights click or type in it. Nothing was done. Tell your owner: they can do this step themselves, or start pine as administrator.");
		if (e.code === "undescribed") return new Error(`That app does not describe its windows to pine: it has no accessibility support, or it was started before the accessibility service.${o.images === false ? "" : " Look at it with app_screenshot and act by position (app_click)."} Starting the app again can help.`);
		return new Error(e.message ? `${e.message[0].toUpperCase()}${e.message.slice(1)}${/[.!?]$/.test(e.message) ? "" : "."}` : "That did not work.");
	};

	const appName = (args: Record<string, any>) => {
		const name = typeof args.app === "string" ? args.app.trim() : "";
		if (!name) throw new Error("Say which app: app is the app's name, as apps lists it.");
		return name;
	};
	/** The running app a call names. `acting`: the call clicks, types or presses, which pine does not do in the app it runs in itself. */
	const find = async (args: Record<string, any>, acting: boolean): Promise<AppInfo> => {
		const name = appName(args);
		const a = await ask("find", { app: name });
		if (!a.running) throw new Error(`${name} is not running. Open it with app_open, or look at what is running with apps.`);
		if (acting && answersHere(a)) throw new Error(`${a.name} is ${a.host ? "the app pine itself runs in" : "the Pine app"}. pine does not click, type or press there: that is where your owner answers pine's questions. You can look at it (app_snapshot${o.images === false ? "" : ", app_screenshot"}). To run a command, use your own shell.`);
		return a;
	};
	const toFront = async (a: AppInfo, window?: string) => {
		const r = await ask("activate", { pid: a.pid, ...(window ? { ref: window } : {}) });
		if (!r.front) throw new Error(`${a.name} could not be brought to the front, so nothing was done in it. Another app may be holding the screen (a dialog, a full screen app). Tell your owner.`);
	};
	/** That a point on the screen is in the app that was named, and what is there. */
	const landsIn = async (a: AppInfo, at: { x: number; y: number }) => {
		const there = await ask("at", at);
		if (there.pid === a.pid || there.wpid === a.pid) return there.pid === a.pid ? (there as { role?: string; subrole?: string; title?: string }) : {};
		const other = there.name ?? there.wname;
		throw new Error(
			other
				? `At that position is ${other}, not ${a.name}, so nothing was done. Take a new app_screenshot to see where things are now. To act in ${other}, name it as app.`
				: `Nothing of ${a.name} is at that position, so nothing was done. Take a new app_screenshot to see where things are now.`,
		);
	};
	/** A position in the last picture as a point on the screen, in the app that was named. */
	const place = async (a: AppInfo, x: unknown, y: unknown, what = "x and y") => {
		if (!picture) throw new Error(`${what} are positions in a picture, and you have not taken one yet. Take one with app_screenshot first. Without pictures, use app_snapshot and app_press.`);
		const px = Number(x);
		const py = Number(y);
		if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error(`${what} must be numbers: pixels in the last picture, from the top left corner.`);
		if (px < 0 || py < 0 || px >= picture.width || py >= picture.height) throw new Error(`That position is outside the last picture, which is ${picture.width} by ${picture.height} pixels: x goes from 0 to ${picture.width - 1}, y from 0 to ${picture.height - 1}.`);
		if (picture.pid !== undefined && picture.pid !== a.pid) throw new Error(`The last picture shows ${picture.app}, not ${a.name}. Take a picture of ${a.name} first (app_screenshot), then give positions in that.`);
		let shown: Picture = picture;
		if (picture.ref) {
			// The window may have been moved since the picture was taken.
			try {
				const f = await ask("frame", { ref: picture.ref });
				// What the picture shows starts where it started in the window: beside it, when a menu hung out of it.
				shown = { ...picture, x: f.x + picture.dx, y: f.y + picture.dy };
			} catch {
				throw new Error("The window in the last picture is gone. Take a new app_screenshot.");
			}
		}
		return toScreen(shown, px, py);
	};
	const windowsOf = async (a: AppInfo): Promise<Win[]> => (await ask("windows", { pid: a.pid })).windows ?? [];
	const others = (all: Win[], shown?: Win) => {
		const rest = all.filter((w) => w.index !== shown?.index);
		return rest.length ? ` Other windows: ${rest.map(windowLine).join(", ")}.` : "";
	};

	const tools: Record<string, (args: Record<string, any>) => Promise<Result>> = {
		async apps() {
			const r = await ask("apps");
			const list: AppInfo[] = r.apps ?? [];
			const lines = [...list.filter((a) => a.front), ...list.filter((a) => !a.front)].map((a) => {
				const wins = a.windows;
				const marks = [a.front ? "in front" : "", a.host ? "pine runs in it" : PINE_APP.test(a.bundle ?? "") ? "the Pine app" : ""].filter(Boolean).join(", ");
				return `- ${a.name}${marks ? ` (${marks})` : ""}${wins === undefined ? "" : wins.length ? `: ${wins.length === 1 ? "window" : "windows"} ${wins.map(windowLine).join(", ")}` : ": no window"}`;
			});
			const screens: Array<{ index: number; w: number; h: number; main?: boolean }> = r.displays ?? [];
			const note = r.accessibility === false ? `\n\nThe windows are not listed: ${grantText("accessibility", (await hostApp())?.name, false, await system())}` : "";
			return `Running apps:\n${lines.join("\n") || "(none)"}${screens.length > 1 ? `\n\nScreens: ${screens.map((s) => `${s.index} (${s.w} by ${s.h}${s.main ? ", main" : ""})`).join(", ")}` : ""}${note}`;
		},

		async app_open(args) {
			const name = appName(args).replace(/\.app$/i, "");
			if (/[/\\]/.test(name)) throw new Error("Give the app's name, for example Safari, not a path to it.");
			let a: AppInfo;
			try {
				a = await ask("open", { app: name }, 25_000);
			} catch (e) {
				if (e instanceof HelperError && e.code === "not_found") throw new Error(`No app called "${name}" was found on this ${(await system()) === "mac" ? "Mac" : "computer"}. apps lists what is running.`);
				throw e;
			}
			const was = a.launched ? "was opened" : "was already running";
			try {
				await ask("activate", { pid: a.pid });
			} catch (e) {
				throw new Error(`${a.name} ${was}, but it could not be brought to the front. ${(await explain(e)).message}`);
			}
			// Its windows are listed where macOS lets pine see them; where not, the next call says what is missing.
			const all = await windowsOf(a).catch(() => undefined);
			return `${a.name} ${was} and is in front${a.name.toLowerCase() === name.toLowerCase() ? "" : ` (you asked for "${name}"; in other calls either name works)`}.${all ? ` ${all.length ? `${all.length === 1 ? "Window" : "Windows"}: ${all.map(windowLine).join(", ")}` : "It has no window open"}.` : ""} Read a window with app_snapshot${o.images === false ? "" : ", or look at it with app_screenshot"}.`;
		},

		async app_snapshot(args) {
			const a = await find(args, false);
			const want = pickWindow(await windowsOf(a), args.window);
			const r = await ask("tree", { pid: a.pid, ...(want ? { window: want.index } : {}) });
			const all: Win[] = r.windows ?? [];
			if (!r.window || !r.root) return `${a.name} has no window open.${others(all)} The app's menu bar can still be used (app_menu), and app_open brings it to the front.`;
			const shown = r.window as Win;
			return `${a.name}, window ${windowLine(shown)}.${others(all, shown)}\nControls with [ref=...] can be used: app_press presses one, app_set_text writes into a text field.\n\n${outline(r.root)}${r.cut ? "\n[The window holds more controls than are listed here.]" : ""}`;
		},

		async app_press(args) {
			const a = await find(args, true);
			const ref = String(args.ref ?? "").trim().replace(/^\[?ref=|\]$/g, "");
			if (!ref) throw new Error("Say which control: ref is the control's reference from app_snapshot, for example e12.");
			const it = await ask("whose", { ref });
			if (it.pid !== a.pid) throw new Error(`The reference ${ref} is not a control of ${a.name}. Take an app_snapshot of ${a.name} and use a reference from it.`);
			const r = await ask("press", { ref });
			if (!r.done) {
				// Nothing to press by name: click in its middle, as a person would.
				await toFront(a);
				await landsIn(a, { x: r.x, y: r.y });
				await ask("click", { x: r.x, y: r.y, pid: a.pid });
				return `Clicked the ${called(it)} in ${a.name}. Take a new app_snapshot to see what changed.`;
			}
			return `${r.selected ? "Selected" : "Pressed"} the ${called(it)} in ${a.name}.${r.unsure ? " The app has not answered yet, which often means a dialog has opened." : ""} Take a new app_snapshot to see what changed.`;
		},

		async app_set_text(args) {
			const a = await find(args, true);
			const ref = String(args.ref ?? "").trim().replace(/^\[?ref=|\]$/g, "");
			if (!ref) throw new Error("Say which field: ref is the field's reference from app_snapshot, for example e12.");
			if (typeof args.text !== "string") throw new Error("Say what to write: text is what the field should hold.");
			const it = await ask("whose", { ref });
			if (it.pid !== a.pid) throw new Error(`The reference ${ref} is not a control of ${a.name}. Take an app_snapshot of ${a.name} and use a reference from it.`);
			const r = await ask("set", { ref, text: args.text });
			if (!r.done) {
				// A field that cannot be written into directly: click it, select what is there, type over it.
				await toFront(a);
				await landsIn(a, { x: r.x, y: r.y });
				await ask("click", { x: r.x, y: r.y, pid: a.pid });
				await ask("key", { key: "a", mods: modsFor(await system(), ["cmd"]), pid: a.pid });
				await ask("type", { text: args.text, pid: a.pid });
			}
			return `The ${called(it)} in ${a.name} now holds ${quote(args.text, 80)}.`;
		},

		async app_menu(args) {
			const names = String(args.path ?? "").split(">").map((s) => s.trim()).filter(Boolean);
			// Looking into a menu changes nothing; picking from one is an action like any other.
			const a = await find(args, false);
			const same = (title: string, name: string) => title.replace(/(…|\.\.\.)$/, "").trim().toLowerCase() === name.replace(/(…|\.\.\.)$/, "").trim().toLowerCase();
			const show = (items: any[]) => items.map((i) => `- ${i.title}${i.mark ? ` (${i.mark === "✓" ? "ticked" : i.mark})` : ""}${i.disabled ? " (not available now)" : ""}${i.submenu ? " >" : ""}${i.shortcut ? `   ${i.shortcut}` : ""}`).join("\n");
			// On a Mac the first entry of the menu bar is the Apple menu, which belongs to the system.
			const bar: any[] = (await ask("menu", { pid: a.pid })).items ?? [];
			let items = (await system()) === "mac" ? bar.slice(1) : bar;
			if (!names.length) return `The menus of ${a.name}:\n${show(items) || "(none)"}\nGive path to look into one or to pick an entry. Example: path "File > Save".`;
			// An app in the background greys out most of its menus: they say what can be done once it is in front.
			await toFront(a);
			let entry: any;
			for (let i = 0; i < names.length; i++) {
				entry = items.find((x) => same(x.title, names[i]));
				const where = i === 0 ? `the menu bar of ${a.name}` : `"${names.slice(0, i).join(" > ")}"`;
				if (!entry) throw new Error(`There is no "${names[i]}" in ${where}. There is:\n${show(items) || "(nothing)"}`);
				if (i < names.length - 1 || entry.submenu) {
					if (!entry.submenu) throw new Error(`"${names.slice(0, i + 1).join(" > ")}" is an entry, not a menu: there is nothing below it.`);
					items = (await ask("menu", { pid: a.pid, ref: entry.ref })).items ?? [];
				}
			}
			if (entry.submenu) return `"${names.join(" > ")}" in ${a.name} holds:\n${show(items) || "(nothing)"}`;
			if (entry.disabled) throw new Error(`"${names.join(" > ")}" is not available right now (it is greyed out). Something has to be selected or open first.`);
			await find(args, true);
			const r = await ask("press", { ref: entry.ref });
			return `Picked "${names.join(" > ")}" in ${a.name}.${r.unsure ? " The app has not answered yet, which often means a dialog has opened." : ""}`;
		},

		async app_screenshot(args) {
			const size = { edge: Math.max(320, Math.min(4000, Number(o.imageSize) || 1280)), area: 1_150_000, dir: io.scratch };
			let r: any;
			let what: string;
			let of: { pid?: number; app?: string; ref?: string; dx?: number; dy?: number } = {};
			if (typeof args.app === "string" && args.app.trim()) {
				const a = await find(args, false);
				const all = await windowsOf(a);
				const w = pickWindow(all, args.window) ?? all.find((x) => x.main && !x.minimized) ?? all.find((x) => !x.minimized) ?? all[0];
				if (!w) throw new Error(`${a.name} has no window open, so there is nothing to take a picture of. app_open brings it to the front.`);
				const shoot = () => ask("shot", { ...size, pid: a.pid, ref: w.ref });
				try {
					r = await shoot();
				} catch (e) {
					if (!(e instanceof HelperError) || e.code !== "behind") throw e;
					// Something hangs over the window (a sheet, a bubble), so the picture is of that part of the
					// screen, and the screen shows the app only when the app is in front.
					await toFront(a, w.ref);
					r = await shoot();
				}
				what = `${a.name}, window ${windowLine(w)}${r.more ? ", and what is open over it" : ""}`;
				of = { pid: a.pid, app: a.name, ref: w.ref, dx: r.x - (r.wx ?? r.x), dy: r.y - (r.wy ?? r.y) };
			} else {
				r = await ask("shot", { ...size, ...(args.screen !== undefined ? { display: Number(args.screen) } : {}) });
				what = `${WHOLE_SCREEN}${r.displays > 1 ? ` ${r.display} of ${r.displays}` : ""}`;
			}
			let bytes: Buffer;
			try {
				bytes = fs.readFileSync(r.file);
			} finally {
				fs.rmSync(r.file, { force: true });
			}
			picture = { width: r.width, height: r.height, x: r.x, y: r.y, w: r.w, h: r.h, dx: 0, dy: 0, ...of };
			const text = `Picture of ${what}: ${r.width} by ${r.height} pixels. For app_click, app_drag and app_scroll, x and y are pixels in this picture, counted from the top left corner (x from 0 to ${r.width - 1}, y from 0 to ${r.height - 1}).`;
			return [{ type: "text", text }, { type: "image", data: bytes.toString("base64"), mimeType: bytes[0] === 0x89 ? "image/png" : "image/jpeg" }];
		},

		async app_click(args) {
			const a = await find(args, true);
			const at = await place(a, args.x, args.y);
			await toFront(a, picture?.ref);
			const there = await landsIn(a, at);
			const count = Math.max(1, Math.min(3, Math.round(Number(args.count) || 1)));
			const right = args.button === "right";
			await ask("click", { ...at, count, button: right ? "right" : "left", pid: a.pid });
			return `${right ? "Right-clicked" : count === 2 ? "Double-clicked" : count === 3 ? "Triple-clicked" : "Clicked"}${there.role ? ` the ${called(there)}` : ""} at ${Math.round(Number(args.x))}, ${Math.round(Number(args.y))} in ${a.name}. Take a new app_screenshot to see what changed.`;
		},

		async app_drag(args) {
			const a = await find(args, true);
			const from = await place(a, args.x, args.y);
			const to = await place(a, args.to_x, args.to_y, "to_x and to_y");
			await toFront(a, picture?.ref);
			await landsIn(a, from);
			await ask("drag", { ...from, x2: to.x, y2: to.y, pid: a.pid });
			return `Dragged from ${Math.round(Number(args.x))}, ${Math.round(Number(args.y))} to ${Math.round(Number(args.to_x))}, ${Math.round(Number(args.to_y))} in ${a.name}. Take a new app_screenshot to see what changed.`;
		},

		async app_scroll(args) {
			const a = await find(args, true);
			const at = await place(a, args.x, args.y);
			const lines = Math.max(1, Math.min(100, Math.round(Number(args.amount) || 5)));
			const turn: Record<string, { dx: number; dy: number }> = { up: { dx: 0, dy: lines }, down: { dx: 0, dy: -lines }, left: { dx: lines, dy: 0 }, right: { dx: -lines, dy: 0 } };
			const d = turn[String(args.direction)];
			if (!d) throw new Error("direction is up, down, left or right.");
			await toFront(a, picture?.ref);
			await landsIn(a, at);
			await ask("scroll", { ...at, ...d, pid: a.pid });
			return `Scrolled ${args.direction} by ${lines} lines in ${a.name}. Take a new app_screenshot to see where you are.`;
		},

		async app_type(args) {
			const a = await find(args, true);
			if (typeof args.text !== "string" || !args.text) throw new Error("Say what to type: text is the text.");
			await toFront(a);
			// The keys are sent to this app and to no other, whatever comes to the front meanwhile.
			await ask("type", { text: args.text, pid: a.pid }, 25_000);
			return `Typed ${[...args.text].length} characters into ${a.name}.`;
		},

		async app_key(args) {
			const parsed = parseKeys(args.keys);
			const on = await system();
			const keys = parsed.map((k) => ({ ...k, mods: modsFor(on, k.mods) }));
			const a = await find(args, true);
			await toFront(a);
			for (const k of keys) await ask("key", { ...k, pid: a.pid });
			return `Pressed ${keys.map((k) => [...k.mods, k.key].join("+")).join(", then ")} in ${a.name}.`;
		},
	};

	return {
		call(name, args) {
			const run = async () => {
				const fn = tools[name];
				if (!fn || !toolsOffered(o, "darwin").some((t) => t.name === name)) throw new Error(`The tool ${name} is not available.`);
				try {
					return await fn(args ?? {});
				} catch (e) {
					throw await explain(e);
				}
			};
			const next = queue.then(run, run);
			queue = next.catch(() => {});
			return next;
		},
		close: stop,
	};
}

// ---- the helper ----------------------------------------------------------------------------------

export const HELPER_SOURCE = path.join(import.meta.dirname, "computer.swift");

export const NO_COMPILER =
	"App control needs Apple's command line developer tools, once, to build the app control helper, and they are not installed on this Mac. Your owner installs them by typing this into a terminal: xcode-select --install (macOS then shows a window to confirm; it takes a few minutes). Tell your owner this, and try again when they say it is done.";

type Run = (file: string, args: string[], ms: number) => Promise<{ code: number; stdout: string; stderr: string }>;

const runProgram: Run = (file, args, ms) =>
	new Promise((resolve) => {
		execFile(file, args, { timeout: ms, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ code: err ? (typeof (err as any).code === "number" ? (err as any).code : 1) : 0, stdout: String(stdout), stderr: String(stderr) || (err ? err.message : "") }));
	});

/**
 * The helper as a program: built from its source the first time, then found again by the
 * source's hash, so an update of pine builds a new one. Rejects with a sentence for the agent.
 */
export async function buildHelper(dir: string, source: string = HELPER_SOURCE, run: Run = runProgram): Promise<string> {
	const file = path.join(dir, `pine-computer-${createHash("sha256").update(fs.readFileSync(source)).digest("hex").slice(0, 12)}`);
	// The Pine app carries it built (src/prebuilt.ts): then nothing is compiled here.
	const carried = prebuilt(source, path.basename(file));
	if (carried) return carried;
	if (fs.existsSync(file)) return file;
	// /usr/bin/swiftc exists on every Mac, but without the tools it only opens a window that offers to install them.
	const tools = await run("/usr/bin/xcode-select", ["-p"], 10_000);
	if (tools.code !== 0 || !fs.existsSync(tools.stdout.trim())) throw new Error(NO_COMPILER);
	fs.mkdirSync(dir, { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	const built = await run("/usr/bin/swiftc", ["-swift-version", "5", "-O", "-o", tmp, source], 300_000);
	if (built.code !== 0 || !fs.existsSync(tmp)) {
		fs.rmSync(tmp, { force: true });
		const why = built.stderr.split("\n").filter((l) => /error/i.test(l)).slice(0, 3).join(" | ") || built.stderr.trim().split("\n").slice(-2).join(" | ");
		throw new Error(`pine could not build the helper for app control (${why.slice(0, 500) || "the compiler gave no reason"}). Tell your owner: Apple's command line developer tools may be missing a part or need an update; "xcode-select --install" in a terminal installs them.`);
	}
	// Whole or not at all: another conversation may be starting the same program at this moment.
	fs.renameSync(tmp, file);
	for (const old of fs.readdirSync(dir)) if (old.startsWith("pine-computer-") && path.join(dir, old) !== file && !old.endsWith(".tmp")) fs.rmSync(path.join(dir, old), { force: true });
	return file;
}

// ---- the helpers of Windows and Linux -----------------------------------------------------------

export const WINDOWS_SOURCE = path.join(import.meta.dirname, "computer.cs");
export const LINUX_SOURCE = path.join(import.meta.dirname, "computer-linux.py");

/** The assemblies of .NET Framework the Windows helper uses. WPF's lie in a folder of their own beside the compiler, or only in the assembly cache. */
const WINDOWS_ASSEMBLIES = ["UIAutomationClient.dll", "UIAutomationTypes.dll", "WindowsBase.dll", "System.Drawing.dll", "System.Windows.Forms.dll", "System.Web.Extensions.dll"];

/** Each assembly as a path where one is found, else by its name, which the compiler looks up beside itself. */
export function windowsReferences(framework: string | undefined = frameworkDir(), windir: string = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows", exists: (f: string) => boolean = fs.existsSync, list: (d: string) => string[] = (d) => fs.readdirSync(d)): string[] {
	return WINDOWS_ASSEMBLIES.map((dll) => {
		const near = framework ? [path.join(framework, dll), path.join(framework, "WPF", dll)] : [];
		const found = near.find(exists);
		if (found) return found;
		// The global assembly cache: GAC_MSIL\<name>\v4.0_4.0.0.0__<token>\<name>.dll
		const gac = path.join(windir, "Microsoft.NET", "assembly", "GAC_MSIL", dll.replace(/\.dll$/, ""));
		try {
			for (const v of list(gac).filter((d) => d.startsWith("v4.0_")).sort().reverse()) if (exists(path.join(gac, v, dll))) return path.join(gac, v, dll);
		} catch {
			// not there: by name
		}
		return dll;
	});
}

/** The Windows helper as a program: carried built, built before, or built now with the compiler Windows has. */
export function windowsHelper(build: typeof buildCsharp = buildCsharp): Promise<string> {
	return new Promise((resolve, reject) => {
		// The compiler is waited for in this process: not before the server has answered pi's first request.
		setImmediate(() => {
			try {
				resolve(build(WINDOWS_SOURCE, "pine-computer", "app control", windowsReferences()));
			} catch (e) {
				reject(e);
			}
		});
	});
}

/** What the Linux helper runs on, by absolute path: never a program found on a PATH that an agent could have written into. */
export const LINUX_TOOLS = { python: "/usr/bin/python3", xdotool: "/usr/bin/xdotool", import: "/usr/bin/import" };
export const LINUX_PACKAGES = "python3-pyatspi python3-xlib xdotool imagemagick";

export function linuxMissing(what: string[]): string {
	return `App control on Linux needs a few programs that are not installed on this computer (${what.join(", ")}). Your owner installs them once by typing this into a terminal: sudo apt install ${LINUX_PACKAGES} (on Fedora: sudo dnf install python3-pyatspi python3-xlib xdotool ImageMagick). Tell your owner this, and try again when they say it is done.`;
}

/**
 * The Linux helper's command line, after a look that what it needs is there. python3 runs it
 * isolated (-I): no module from the working folder or from PYTHONPATH is loaded with it.
 */
export async function linuxHelper(run: Run = runProgram, exists: (f: string) => boolean = fs.existsSync): Promise<string[]> {
	const missing: string[] = [];
	if (!exists(LINUX_TOOLS.python)) missing.push("python3");
	else {
		const modules = await run(LINUX_TOOLS.python, ["-I", "-c", "import gi; gi.require_version('Atspi', '2.0'); from gi.repository import Atspi; import Xlib.display"], 20_000);
		if (modules.code !== 0) missing.push(/Xlib/.test(modules.stderr) ? "python3-xlib" : "python3-pyatspi");
	}
	if (!exists(LINUX_TOOLS.xdotool)) missing.push("xdotool");
	if (!exists(LINUX_TOOLS.import)) missing.push("imagemagick");
	if (missing.length) throw new Error(linuxMissing(missing));
	return [LINUX_TOOLS.python, "-I", LINUX_SOURCE];
}

if (import.meta.main) {
	const o = options<ComputerOptions>();
	if (!available(o)) {
		serve({ name: "pine-computer", version: "1.0.0", instructions: unavailable() }, [], () => unavailable());
	} else {
		const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pine-computer-"));
		const dir = o.helperDir ?? path.join(os.homedir(), "Library", "Caches", "pine-computer");
		let built: Promise<string[]> | undefined;
		const make = (): Promise<string[]> => (process.platform === "win32" ? windowsHelper().then((f) => [f]) : process.platform === "linux" ? linuxHelper() : buildHelper(dir).then((f) => [f]));
		const program = () => (built ??= make().catch((e) => ((built = undefined), Promise.reject(e))));
		const server = computer(o, {
			scratch,
			launch: async () => {
				const cmd = o.helper ? (Array.isArray(o.helper) ? o.helper : [o.helper]) : await program();
				const child = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
				return new Promise<ChildProcess>((resolve, reject) => {
					child.once("spawn", () => resolve(child));
					child.once("error", (e) => reject(new Error(`pine's helper for app control could not be started (${e.message}). Tell your owner.`)));
				});
			},
		});
		// Built while the conversation is still about something else, so that the first call does not wait for it.
		if (!o.helper) program().catch(() => {});
		// However this process ends, the helper ends with it and no picture is left behind.
		process.on("exit", () => {
			server.close();
			fs.rmSync(scratch, { recursive: true, force: true });
		});
		process.on("SIGTERM", () => process.exit(0));
		process.on("SIGINT", () => process.exit(0));
		serve(
			{ name: "pine-computer", version: "1.0.0" },
			toolsOffered(o).map((t): McpTool => ({ ...t, handler: (args) => server.call(t.name, args) })),
		);
	}
}
