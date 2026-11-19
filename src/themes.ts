// The themes of pine's look: VS Code colour theme files in <home>/themes, one theme a file, named by
// the file (`one-dark-pro.json` is the theme "one-dark-pro"). `ui.theme` in pine.json says which
// one is in force; pmndre when it names none. A home gets pine's own set the first time pine starts
// without the folder (and from `pine init`, which copies examples/home); after that the folder is
// the owner's: a theme taken out stays out, one dropped in is offered.
//
// The folder lies in pine's home, which no agent writes. All the same a theme file is read as data
// and nothing else: parsed, resolved into colours (src/theme-colors.ts), and only those colours go
// to a UI.

import fs from "node:fs";
import path from "node:path";
import { PINE_ROOT } from "./config.ts";
import { parseJsonc, type ResolvedTheme, resolveTheme } from "./theme-colors.ts";

/** The theme in force when pine.json names none, and when the one it names cannot be drawn. */
export const DEFAULT_THEME = "pmndre";
/** A theme's name is its file's name: lowercase letters, digits, ".", "-" and "_". */
export const THEME_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** Larger than any theme file there is: a file this size is something else. */
const MAX_BYTES = 2_000_000;

const bundled = () => path.join(PINE_ROOT, "examples", "home", "themes");
export const themesDir = (home: string) => path.join(home, "themes");

/** A theme as a UI is handed it: its colours, or why it cannot be drawn. */
export type ThemeEntry = ({ id: string } & ResolvedTheme) | { id: string; name: string; problem: string };

/** The first start of a home without a themes folder: pine's own set goes into it. */
export function seedThemes(home: string): void {
	const dir = themesDir(home);
	if (fs.existsSync(dir)) return;
	fs.mkdirSync(dir, { recursive: true });
	for (const name of fs.readdirSync(bundled())) {
		const dst = path.join(dir, name);
		fs.copyFileSync(path.join(bundled(), name), dst);
		fs.chmodSync(dst, 0o600);
	}
}

function readTheme(file: string, id: string): ThemeEntry {
	try {
		const stat = fs.lstatSync(file);
		if (!stat.isFile()) return { id, name: id, problem: "not a file" };
		if (stat.size > MAX_BYTES) return { id, name: id, problem: "too large for a theme file" };
		return { id, ...resolveTheme(parseJsonc(fs.readFileSync(file, "utf8")), id) };
	} catch (e) {
		return { id, name: id, problem: e instanceof SyntaxError ? `not JSON: ${e.message}` : (e as Error).message };
	}
}

/**
 * Every theme in the home's folder, by name, with pmndre among them even when its file is gone
 * (pine's own copy then). A file pine cannot draw is listed with what is wrong with it, so that the
 * owner sees why a theme they put there is not offered.
 */
export function listThemes(home: string): ThemeEntry[] {
	const dir = themesDir(home);
	const found = new Map<string, ThemeEntry>();
	for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
		if (!name.endsWith(".json")) continue;
		const id = name.slice(0, -5);
		found.set(id, THEME_ID.test(id) ? readTheme(path.join(dir, name), id) : { id, name: id, problem: "a theme's file name is lowercase letters, digits, \".\", \"-\" and \"_\", ending in .json" });
	}
	const own = found.get(DEFAULT_THEME);
	if (!own || "problem" in own) found.set(DEFAULT_THEME, readTheme(path.join(bundled(), `${DEFAULT_THEME}.json`), DEFAULT_THEME));
	return [...found.values()];
}

/** The theme pine.json names, as it is drawn: that one when it can be, pmndre otherwise. */
export function themeInForce(home: string, chosen: string | undefined, list = listThemes(home)): { id: string; theme: ResolvedTheme } {
	const pickable = (id: string | undefined) => list.find((t): t is { id: string } & ResolvedTheme => t.id === id && !("problem" in t));
	const t = pickable(chosen) ?? pickable(DEFAULT_THEME)!;
	return { id: t.id, theme: t };
}
