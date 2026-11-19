// What a theme file says, turned into pine's own colours. A theme is a VS Code colour theme (the
// format nearly every editor theme is published in): `type`, `colors` (the workbench) and
// `tokenColors` (TextMate scopes for code). pine reads the few workbench colours that mean the same
// as one of its roles, finds the code colours by scope as an editor would, and derives the rest
// from those, so that any such file gives every role. A theme may add a `pine` object with roles
// of pine's own by name: those win over everything read or derived (pmndre.json uses it to keep
// pine's own pmndre colours). Nothing here touches a file: src/themes.ts reads them.
//
// The result is a flat record of CSS custom property names without their dashes ("bg",
// "line-soft", "code-keyword", "term-3") whose values are colours as #rrggbb or #rrggbbaa, and two
// font styles. That is all a UI gets: no value is a string of the file's own.

export type ThemeKind = "dark" | "light";

/** The roles of pine's look (the app's index.css draws with each as `--<name>`). */
export const UI_ROLES = ["bg", "surface", "raised", "sunk", "composer", "side", "hover", "press", "line", "line-soft", "text", "text-muted", "faint", "brand", "brand-soft", "on-accent", "warn", "warn-soft", "bad", "bad-soft", "info", "plan", "add", "add-bg", "del", "del-bg", "select", "scrim"] as const;
/** The colours of code, in the code pane and in answers (`--code-<name>`). */
export const CODE_ROLES = ["text", "gutter", "gutter-active", "active-line", "cursor", "match", "match-line", "comment", "meta", "keyword", "definition", "control", "modifier", "string", "regexp", "literal", "null", "name", "attribute", "call", "function", "type", "namespace", "tag", "heading", "emphasis", "link", "inserted", "deleted", "punctuation", "operator"] as const;
/** The font style of two kinds of code: "italic" or "normal". */
export const CODE_STYLES = ["meta-style", "attribute-style"] as const;
/** The terminal beside a conversation: its 16 colours, then the rest (`--term-<name>`). */
export const TERM_ROLES = [...Array.from({ length: 16 }, (_, i) => String(i)), "bg", "fg", "cursor", "select"] as const;

/** Every name a resolved theme has, and a `pine` object may set. */
export const ROLE_NAMES: string[] = [...UI_ROLES, ...CODE_ROLES.map((n) => `code-${n}`), ...CODE_STYLES.map((n) => `code-${n}`), ...TERM_ROLES.map((n) => `term-${n}`)];

export interface ResolvedTheme {
	name: string;
	kind: ThemeKind;
	colors: Record<string, string>;
}

// ---- colours ----------------------------------------------------------------------------------------

type Rgba = [number, number, number, number];

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** A hex colour as numbers (0-255, alpha 0-1); anything else is undefined. VS Code themes write hex only. */
export function parseHex(value: unknown): Rgba | undefined {
	if (typeof value !== "string" || !HEX.test(value.trim())) return undefined;
	let h = value.trim().slice(1);
	if (h.length <= 4) h = [...h].map((c) => c + c).join("");
	const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
	return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}

const two = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
const hex = ([r, g, b, a]: Rgba) => `#${two(r)}${two(g)}${two(b)}${a >= 0.999 ? "" : two(a * 255)}`;

/** `a` laid over `b`: what a translucent colour looks like on an opaque one. */
function over(a: Rgba, b: Rgba): Rgba {
	const t = a[3];
	return [a[0] * t + b[0] * (1 - t), a[1] * t + b[1] * (1 - t), a[2] * t + b[2] * (1 - t), 1];
}
/** `t` of `a` and the rest `b`, as CSS's color-mix in srgb does for opaque colours. */
const mix = (a: Rgba, b: Rgba, t: number): Rgba => [a[0] * t + b[0] * (1 - t), a[1] * t + b[1] * (1 - t), a[2] * t + b[2] * (1 - t), a[3] * t + b[3] * (1 - t)];
const alpha = (a: Rgba, t: number): Rgba => [a[0], a[1], a[2], t];

const linear = (c: number) => {
	const s = c / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgba) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
/** WCAG's contrast ratio of two opaque colours. */
export const contrast = (a: Rgba, b: Rgba) => {
	const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
};
/** How colourful a colour is: OKLCH's chroma (grey 0, a vivid colour 0.1 to 0.3). */
export function chroma([r, g, b]: Rgba): number {
	const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	return Math.hypot(A, B);
}

// ---- code: TextMate scopes ----------------------------------------------------------------------------

interface TokenRule {
	scope?: string | string[];
	settings?: { foreground?: string; fontStyle?: string };
}

/** The scope pine asks a theme for, for each kind of code. */
const SCOPES: Partial<Record<(typeof CODE_ROLES)[number], string>> = {
	comment: "comment",
	keyword: "keyword",
	control: "keyword.control",
	modifier: "storage.modifier",
	definition: "storage.type",
	operator: "keyword.operator",
	string: "string",
	regexp: "string.regexp",
	literal: "constant.numeric",
	null: "constant.language",
	name: "variable",
	attribute: "entity.other.attribute-name",
	function: "entity.name.function",
	call: "entity.name.function",
	type: "entity.name.type",
	namespace: "entity.name.namespace",
	tag: "entity.name.tag",
	heading: "markup.heading",
	emphasis: "markup.italic",
	link: "markup.underline.link",
	inserted: "markup.inserted",
	deleted: "markup.deleted",
	punctuation: "punctuation",
	meta: "meta.decorator",
};

/**
 * The rule a theme has for a scope, as an editor picks it: a selector matches the scope itself and
 * every scope below it ("keyword" matches "keyword.control"), the longest match wins, and of two
 * equally long ones the later. Selectors of a scope inside another ("meta.tag string") are left out:
 * pine has no scope stack to match them against.
 */
function ruleFor(rules: TokenRule[], scope: string, field: "foreground" | "fontStyle"): string | undefined {
	// Each field on its own, as an editor merges them: a rule that sets only a font style leaves the colour of a wider one.
	let best: { depth: number; value: string } | undefined;
	for (const rule of rules) {
		const value = rule?.settings?.[field];
		if (typeof value !== "string" || !rule.scope) continue;
		const selectors = (Array.isArray(rule.scope) ? rule.scope : String(rule.scope).split(",")).map((s) => String(s).trim()).filter(Boolean);
		for (const sel of selectors) {
			if (sel.includes(" ")) continue;
			if (scope !== sel && !scope.startsWith(`${sel}.`)) continue;
			const depth = sel.split(".").length;
			if (!best || depth >= best.depth) best = { depth, value };
		}
	}
	return best?.value;
}

// ---- the theme -------------------------------------------------------------------------------------------

/** Takes a JSON text with comments and trailing commas (as VS Code writes its theme files) as JSON. */
export function parseJsonc(text: string): unknown {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '"') {
			let j = i + 1;
			while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
			out += text.slice(i, j + 1);
			i = j;
		} else if (c === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i++;
			out += "\n";
		} else if (c === "/" && text[i + 1] === "*") {
			const end = text.indexOf("*/", i + 2);
			i = end < 0 ? text.length : end + 1;
		} else out += c;
	}
	return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/**
 * A VS Code colour theme (already parsed) as pine's colours. Throws, with what to do, when the
 * object is not a theme pine can draw: it needs `colors` with `editor.background` (or a `pine`
 * object with `bg` and `text`).
 */
export function resolveTheme(raw: unknown, fallbackName: string): ResolvedTheme {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not a theme: a theme is a VS Code colour theme, a JSON object with \"type\", \"colors\" and \"tokenColors\"");
	const t = raw as Record<string, any>;
	if (t.include !== undefined) throw new Error('"include" (a theme built on another file) is not supported: use a theme file that holds all of its colours');
	const colors: Record<string, unknown> = t.colors && typeof t.colors === "object" ? t.colors : {};
	const own: Record<string, unknown> = t.pine && typeof t.pine === "object" && !Array.isArray(t.pine) ? t.pine : {};
	const rules: TokenRule[] = Array.isArray(t.tokenColors) ? t.tokenColors : [];
	const kind: ThemeKind = /light/i.test(String(t.type ?? "")) ? "light" : "dark";
	const dark = kind === "dark";
	const global = rules.find((r) => r && !r.scope && r.settings)?.settings as { foreground?: string; background?: string } | undefined;

	const read = (...keys: string[]): Rgba | undefined => {
		for (const k of keys) {
			const v = parseHex(colors[k]);
			if (v) return v;
		}
		return undefined;
	};
	const ownColour = (name: string) => parseHex(own[name]);

	const bgRaw = ownColour("bg") ?? read("editor.background") ?? parseHex(global?.background);
	const textRaw = ownColour("text") ?? read("editor.foreground", "foreground") ?? parseHex(global?.foreground);
	if (!bgRaw || !textRaw) throw new Error('it names no colour for the page: a theme needs "editor.background" and "editor.foreground" in "colors"');
	const bg = over(bgRaw, dark ? [0, 0, 0, 1] : [255, 255, 255, 1]);
	const text = over(textRaw, bg);
	const solid = (c: Rgba | undefined) => (c ? over(c, bg) : undefined);
	const ansi = (name: string) => solid(read(`terminal.ansi${name}`));
	const tokenColour = (scope: string) => solid(parseHex(ruleFor(rules, scope, "foreground")));

	// The accent: the first of the workbench's accents that is a colour (not a grey) and stands out
	// from the page. Themes put theirs in different places; a grey button is common.
	const accents = ["button.background", "activityBarBadge.background", "progressBar.background", "textLink.foreground", "focusBorder", "editorCursor.foreground", "terminal.ansiBlue"].map((k) => solid(read(k)));
	const brand = accents.find((c) => c && chroma(c) >= 0.05 && contrast(c, bg) >= (dark ? 2.6 : 2)) ?? (dark ? mix(text, bg, 0.9) : mix(text, bg, 0.8));
	const fromButton = brand === accents[0];
	const buttonText = solid(read("button.foreground"));
	const onAccent = fromButton && buttonText && contrast(buttonText, brand) >= 3 ? buttonText : contrast([255, 255, 255, 1], brand) >= contrast(bg, brand) && contrast([255, 255, 255, 1], brand) >= 3 ? ([255, 255, 255, 1] as Rgba) : dark ? mix([0, 0, 0, 1], bg, 0.15) : ([20, 20, 20, 1] as Rgba);

	// What is quieter than the text: the theme's own description colour, or the text towards the page.
	// Many themes make it too dim to read as text pine shows (hints, the side bar's rows): it is moved
	// towards the text until it reads, 4.5:1 for muted text and 3:1 for the faintest.
	const readable = (c: Rgba, ratio: number): Rgba => {
		for (let t = 0; t <= 1; t += 0.05) {
			const m = mix(text, c, t);
			if (contrast(m, bg) >= ratio) return m;
		}
		return text;
	};
	const muted = readable(solid(read("descriptionForeground")) ?? mix(text, bg, 0.72), 4.5);
	const comment = tokenColour("comment");
	const faint = readable(comment && chroma(comment) < 0.06 ? comment : mix(text, bg, 0.5), 3);

	const warn = ansi("Yellow") ?? solid(read("editorWarning.foreground")) ?? ([196, 136, 20, 1] as Rgba);
	const bad = solid(read("editorError.foreground", "errorForeground")) ?? ansi("Red") ?? ([194, 65, 58, 1] as Rgba);
	const info = ansi("Blue") ?? solid(read("textLink.foreground")) ?? ([42, 111, 192, 1] as Rgba);
	const plan = ansi("Magenta") ?? ([124, 79, 208, 1] as Rgba);
	const add = solid(read("gitDecoration.addedResourceForeground")) ?? ansi("Green") ?? brand;
	const del = solid(read("gitDecoration.deletedResourceForeground")) ?? ansi("Red") ?? bad;

	// The surfaces: the page, cards a touch towards the text, and what lies below (the side bar) darker.
	const surface = dark ? mix(text, bg, 0.025) : mix([255, 255, 255, 1], bg, 0.6);
	const sideBar = solid(read("sideBar.background"));
	const sunk = sideBar && contrast(sideBar, bg) > 1.04 ? sideBar : dark ? mix([0, 0, 0, 1], bg, 0.15) : mix(text, bg, 0.05);

	const ui: Record<string, Rgba> = {
		bg,
		surface,
		raised: mix(text, bg, dark ? 0.05 : 0.04),
		sunk,
		composer: surface,
		side: alpha(sunk, dark ? 0.88 : 0.86),
		hover: alpha(muted, dark ? 0.07 : 0.055),
		press: alpha(muted, dark ? 0.12 : 0.09),
		line: mix(text, bg, dark ? 0.1 : 0.12),
		"line-soft": mix(text, bg, dark ? 0.07 : 0.08),
		text,
		"text-muted": muted,
		faint,
		brand,
		"brand-soft": alpha(brand, 0.12),
		"on-accent": onAccent,
		warn,
		"warn-soft": alpha(warn, 0.12),
		bad,
		"bad-soft": alpha(bad, dark ? 0.15 : 0.1),
		info,
		plan,
		add,
		"add-bg": alpha(add, dark ? 0.1 : 0.12),
		del,
		"del-bg": alpha(del, dark ? 0.14 : 0.11),
		select: read("editor.selectionBackground") ?? alpha(brand, 0.28),
		scrim: dark ? [10, 11, 17, 0.55] : [20, 24, 22, 0.28],
	};

	// Code: the token colours by scope, each kind falling back on a kin and finally on the text.
	const code: Record<string, Rgba> = {};
	for (const role of CODE_ROLES) {
		const scope = SCOPES[role];
		const c = scope ? tokenColour(scope) : undefined;
		if (c) code[role] = c;
	}
	const kin: Record<string, string[]> = {
		comment: [],
		meta: ["comment"],
		keyword: ["control", "definition", "modifier"],
		control: ["keyword"],
		modifier: ["keyword"],
		definition: ["keyword"],
		operator: ["keyword"],
		string: [],
		regexp: ["string"],
		literal: ["null", "string"],
		null: ["literal", "keyword"],
		name: [],
		attribute: ["name"],
		function: ["call"],
		call: ["function"],
		type: ["namespace", "function"],
		namespace: ["type"],
		tag: ["keyword"],
		heading: ["keyword"],
		emphasis: [],
		link: ["string"],
		inserted: ["string"],
		deleted: [],
		punctuation: [],
	};
	for (const [role, alts] of Object.entries(kin)) code[role] ??= alts.map((a) => code[a]).find(Boolean) ?? (role === "comment" ? faint : role === "inserted" ? add : role === "deleted" ? del : text);
	code.text = text;
	code.gutter = solid(read("editorLineNumber.foreground")) ?? faint;
	code["gutter-active"] = solid(read("editorLineNumber.activeForeground")) ?? muted;
	code["active-line"] = read("editor.lineHighlightBackground") ?? alpha(muted, 0.06);
	code.cursor = solid(read("editorCursor.foreground")) ?? brand;
	code.match = read("editor.findMatchHighlightBackground") ?? alpha(warn, dark ? 0.2 : 0.12);
	code["match-line"] = read("editor.findMatchBackground") ?? alpha(warn, 0.5);
	const italic = (scope: string) => (/italic/.test(ruleFor(rules, scope, "fontStyle") ?? "") ? "italic" : "normal");

	// The terminal: the theme's own sixteen, or the colours above where it has none.
	const names = ["Black", "Red", "Green", "Yellow", "Blue", "Magenta", "Cyan", "White"];
	const term: Record<string, Rgba> = {};
	const base: Rgba[] = [dark ? mix([0, 0, 0, 1], bg, 0.3) : mix(text, bg, 0.9), bad, add, warn, info, plan, mix(info, add, 0.5), dark ? muted : mix(text, bg, 0.3)];
	names.forEach((n, i) => {
		term[String(i)] = ansi(n) ?? base[i];
		term[String(i + 8)] = ansi(`Bright${n}`) ?? term[String(i)];
	});
	term.bg = solid(read("terminal.background")) ?? bg;
	term.fg = solid(read("terminal.foreground")) ?? text;
	term.cursor = solid(read("terminalCursor.foreground")) ?? code.cursor;
	term.select = read("terminal.selectionBackground") ?? ui.select;

	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(ui)) out[k] = hex(v);
	for (const [k, v] of Object.entries(code)) out[`code-${k}`] = hex(v);
	out["code-meta-style"] = italic("meta.decorator") === "italic" || italic("comment") === "italic" ? "italic" : "normal";
	out["code-attribute-style"] = italic("entity.other.attribute-name");
	for (const [k, v] of Object.entries(term)) out[`term-${k}`] = hex(v);

	// The theme's own word on pine's roles, by name, last.
	for (const [k, v] of Object.entries(own)) {
		if (!ROLE_NAMES.includes(k)) continue;
		if (k.endsWith("-style")) {
			if (v === "italic" || v === "normal") out[k] = v;
		} else {
			const c = parseHex(v);
			if (c) out[k] = hex(c);
		}
	}
	const name = typeof t.displayName === "string" && t.displayName.trim() ? t.displayName.trim() : typeof t.name === "string" && t.name.trim() ? t.name.trim() : fallbackName;
	return { name: name.slice(0, 60), kind, colors: out };
}

/** Whether a resolved theme is one a UI may draw as it is: every value a colour or a style, no name missing. */
export function isResolved(value: unknown): value is ResolvedTheme {
	if (!value || typeof value !== "object") return false;
	const t = value as ResolvedTheme;
	if (typeof t.name !== "string" || (t.kind !== "dark" && t.kind !== "light") || !t.colors || typeof t.colors !== "object") return false;
	return ROLE_NAMES.every((k) => (k.endsWith("-style") ? t.colors[k] === "italic" || t.colors[k] === "normal" : /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/.test(String(t.colors[k]))));
}
