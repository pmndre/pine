// The mobile build of the desktop page, beside the desktop's own: the same styles, the policy the
// app's main process would send, and each build without the other's stand-in for Electron.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { build } from "vite";
import { pageCsp } from "../desktop/electron/daemon.ts";

const mobile = import.meta.dirname;
const desktop = path.resolve(mobile, "../desktop");
let out: string;

/** The built page's files, by path, and their text. */
function read(dir: string) {
	const files = fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => /\.(js|html|css)$/.test(f));
	return new Map(files.map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]));
}

/** The class names a style sheet has rules for (`.flex`, `.md\:px-4`...). */
function classes(css: string) {
	return new Set([...css.matchAll(/\.(-?[A-Za-z_\\](?:\\.|[\w-])*)/g)].map((m) => m[1]));
}

let mobileBuild: Map<string, string>;
let iosBuild: Map<string, string>;
let desktopBuild: Map<string, string>;

before(async () => {
	out = fs.mkdtempSync(path.join(os.tmpdir(), "pine-mobile-build-"));
	// What `npm run sync` ships to Android (no mode named) and what `npm run sync:ios` ships to iOS.
	await build({ configFile: path.join(mobile, "vite.config.ts"), root: mobile, logLevel: "silent", build: { outDir: path.join(out, "mobile"), emptyOutDir: true } });
	await build({ configFile: path.join(mobile, "vite.config.ts"), root: mobile, mode: "ios", logLevel: "silent", build: { outDir: path.join(out, "ios"), emptyOutDir: true } });
	await build({ configFile: path.join(desktop, "vite.config.ts"), root: desktop, logLevel: "silent", build: { outDir: path.join(out, "desktop"), emptyOutDir: true } });
	mobileBuild = read(path.join(out, "mobile"));
	iosBuild = read(path.join(out, "ios"));
	desktopBuild = read(path.join(out, "desktop"));
});

after(() => fs.rmSync(out, { recursive: true, force: true }));

test("the mobile page has every style the desktop page has", () => {
	const css = (files: Map<string, string>) => [...files].filter(([f]) => f.endsWith(".css")).map(([, t]) => t).join("\n");
	const theirs = classes(css(desktopBuild));
	const ours = classes(css(mobileBuild));
	assert.ok(theirs.size > 500, `the desktop's style sheet has its utilities (${theirs.size})`);
	const missing = [...theirs].filter((c) => !ours.has(c));
	assert.deepEqual(missing, []);
});

test("the mobile page carries the desktop's content security policy, with the origin its media come from", () => {
	const html = mobileBuild.get("index.html")!;
	const metas = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/g)];
	assert.equal(metas.length, 1);
	assert.equal(metas[0][1], pageCsp({ media: ["https://localhost"] }));
	// Before any script of the page, so that it holds for all of them.
	assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<script"));
});

/** The one policy a built page carries, before any of its scripts. */
function policy(files: Map<string, string>) {
	const html = files.get("index.html")!;
	const metas = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/g)];
	assert.equal(metas.length, 1);
	assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<script"));
	return metas[0][1];
}

test("the iOS page carries the same policy, with its media from the media scheme and nothing from the app's origin", () => {
	assert.equal(policy(iosBuild), "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: pine-media:; media-src 'self' blob: pine-media:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'");
	assert.doesNotMatch(policy(iosBuild), /https:\/\/localhost/);
});

test("the iOS page is not zoomed into a field it focuses and covers the screen, and Android's viewport is unchanged", () => {
	const viewport = (files: Map<string, string>) => files.get("index.html")?.match(/<meta name="viewport" content="([^"]*)"/)?.[1];
	assert.equal(viewport(iosBuild), "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover");
	assert.equal(viewport(mobileBuild), "width=device-width, initial-scale=1");
});

test("the Android page's policy lets nothing come from the iOS media scheme", () => {
	assert.doesNotMatch(policy(mobileBuild), /pine-media:/);
});

test("the iOS page has every style the Android page has, and its bridge", () => {
	const css = (files: Map<string, string>) => [...files].filter(([f]) => f.endsWith(".css")).map(([, t]) => t).join("\n");
	const missing = [...classes(css(mobileBuild))].filter((c) => !classes(css(iosBuild)).has(c));
	assert.deepEqual(missing, []);
	const all = [...iosBuild.values()].join("\n");
	assert.match(all, /pine-media:\/\/daemon/);
	for (const [f, text] of iosBuild) assert.doesNotMatch(text, /__pine/, f);
});

test("the iOS page keeps itself inside the safe area, and the Android and desktop pages have no such rule", () => {
	const css = (files: Map<string, string>) => [...files].filter(([f]) => f.endsWith(".css")).map(([, t]) => t).join("\n");
	assert.match(css(iosBuild), /#root\{[^}]*env\(safe-area-inset-top\)/);
	// In landscape the sensor housing lies at a side: each side sheet keeps clear of its own side.
	// The side bar on a phone is a sheet whose data-slot is "sidebar": the rules name it too.
	const sides = (side: string) => new RegExp(`:is\\(\\[data-slot=sheet-content\\],\\[data-slot=sidebar\\]\\[data-mobile\\]\\)\\[data-side=${side}\\]\\{padding-${side}:env\\(safe-area-inset-${side}\\)\\}`);
	assert.match(css(iosBuild), sides("left"));
	assert.match(css(iosBuild), sides("right"));
	assert.doesNotMatch(css(mobileBuild), /safe-area-inset/);
	assert.doesNotMatch(css(desktopBuild), /safe-area-inset/);
});

test("the mobile page installs its bridge and has nothing of the preview's stand-in", () => {
	const all = [...mobileBuild.values()].join("\n");
	assert.match(all, /_pine_media/, "the mobile bridge is in");
	for (const [f, text] of mobileBuild) assert.doesNotMatch(text, /__pine/, f);
});

test("the desktop page has nothing of the mobile bridge", () => {
	for (const [f, text] of desktopBuild) {
		assert.doesNotMatch(text, /_pine_media/, f);
		assert.doesNotMatch(text, /registerPlugin|Capacitor/, f);
	}
});
