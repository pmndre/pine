import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { isResolved, parseJsonc, resolveTheme, ROLE_NAMES } from "./theme-colors.ts";

// The themes of the owner's UIs (src/themes.ts, src/theme-colors.ts): VS Code color theme files in
// <home>/themes, resolved into pine's colors, chosen with `ui.theme`.

const BUNDLED = path.resolve(import.meta.dirname, "../examples/home/themes");

test("every theme pine brings resolves into every role, as colors, and pmndre keeps pine's own colors", () => {
	const files = fs.readdirSync(BUNDLED).filter((f) => f.endsWith(".json"));
	assert.ok(files.length >= 10, "a set of popular themes, dark and light");
	const kinds = new Set<string>();
	for (const f of files) {
		const t = resolveTheme(parseJsonc(fs.readFileSync(path.join(BUNDLED, f), "utf8")), f);
		assert.ok(isResolved(t), `${f} gives every role as a color`);
		kinds.add(t.kind);
	}
	assert.deepEqual([...kinds].sort(), ["dark", "light"]);
	const pmndre = resolveTheme(parseJsonc(fs.readFileSync(path.join(BUNDLED, "pmndre.json"), "utf8")), "pmndre");
	assert.equal(pmndre.name, "pmndre");
	assert.equal(pmndre.kind, "dark");
	assert.deepEqual([pmndre.colors.bg, pmndre.colors.text, pmndre.colors.brand, pmndre.colors.line, pmndre.colors["code-string"]], ["#1b1e28", "#e4f0fb", "#5de4c7", "#2b2e3c", "#5de4c7"]);
});

test("a VS Code theme with little in it still gives every role: what it names is read, the rest derived from that", () => {
	const t = resolveTheme(
		parseJsonc(`// written by hand
{
	"name": "Tiny", "type": "light",
	"colors": { "editor.background": "#fafafa", "editor.foreground": "#222222", "button.background": "#0055cc", /* the accent */ },
	"tokenColors": [
		{ "settings": { "foreground": "#222222" } },
		{ "scope": "keyword", "settings": { "foreground": "#aa00aa" } },
		{ "scope": ["string", "string.quoted"], "settings": { "foreground": "#008800", "fontStyle": "italic" } },
		{ "scope": "string.regexp", "settings": { "foreground": "#cc5500" } },
		{ "scope": "meta.tag string", "settings": { "foreground": "#ff0000" } },
		{ "scope": "comment // not a comment", "settings": { "foreground": "#999999" } },
	],
}`),
		"tiny",
	);
	assert.ok(isResolved(t));
	assert.equal(t.kind, "light");
	assert.equal(t.colors.bg, "#fafafa");
	assert.equal(t.colors.brand, "#0055cc");
	assert.equal(t.colors["code-keyword"], "#aa00aa");
	assert.equal(t.colors["code-control"], "#aa00aa", "keyword.control falls under keyword");
	assert.equal(t.colors["code-string"], "#008800");
	assert.equal(t.colors["code-regexp"], "#cc5500", "the longer selector wins");
	assert.equal(t.colors["code-function"], "#222222", "no rule for it: the text");
	// A theme's `pine` object has the last word, on pine's roles only, and only with colors.
	const own = resolveTheme({ type: "dark", colors: { "editor.background": "#000000", "editor.foreground": "#ffffff" }, pine: { brand: "#123456", "code-meta-style": "italic", bg: "url(https://example.com/x.png)", nonsense: "#ffffff" } }, "own");
	assert.equal(own.colors.brand, "#123456");
	assert.equal(own.colors["code-meta-style"], "italic");
	assert.equal(own.colors.bg, "#000000");
	assert.equal(own.colors.nonsense, undefined);
	assert.deepEqual(Object.keys(own.colors).sort(), [...ROLE_NAMES].sort());
	// What cannot be drawn says what it needs.
	assert.throws(() => resolveTheme({ colors: {} }, "x"), /editor\.background/);
	assert.throws(() => resolveTheme({ include: "./base.json" }, "x"), /include/);
});
