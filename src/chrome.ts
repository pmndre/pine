// The owner's own browser (Chrome, Brave, Edge and their relatives) as the agents' browser: what
// pine does on this computer so that its extension (extension/) can find it.
//
// A browser starts a program for an extension only by a name that is registered with it ("native
// messaging"): a small file in the browser's own folder that names the program and the extensions
// that may start it. `connectChrome` writes that file for every such browser there is, naming a
// launcher in pine's home that starts pine's host (mcp/chrome.ts) with the Node pine runs on. It
// also puts a copy of the extension into pine's home, for a browser that loads it from a folder.
//
// Only the owner does this (Settings in the Pine app, `pine chrome install`): no agent has a tool
// for it. Everything it writes is fixed text and paths of pine's own, in pine's home, where no
// agent writes, and in the browsers' folders. Nothing is written until the owner asked once; from
// then on a start of pine brings it up to date (a new version of pine, a browser that came later).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EXTENSION_IDS, HOST_NAME } from "../mcp/chrome.ts";
import { EXT } from "./config.ts";

/** The extension's page in a store, once it is in one. Until then it is loaded from pine's folder. */
export const STORE: string | undefined = undefined;

interface Kind {
	name: string;
	/** Under ~/Library/Application Support. */
	mac?: string;
	/** Under ~/.config. */
	linux?: string;
	/** Under HKCU\Software in the registry, and under %LOCALAPPDATA%. */
	win?: string;
}

const KINDS: Kind[] = [
	{ name: "Chrome", mac: "Google/Chrome", linux: "google-chrome", win: "Google\\Chrome" },
	{ name: "Chrome Beta", mac: "Google/Chrome Beta", linux: "google-chrome-beta", win: "Google\\Chrome Beta" },
	{ name: "Chrome Canary", mac: "Google/Chrome Canary", linux: "google-chrome-unstable", win: "Google\\Chrome SxS" },
	{ name: "Chromium", mac: "Chromium", linux: "chromium", win: "Chromium" },
	{ name: "Brave", mac: "BraveSoftware/Brave-Browser", linux: "BraveSoftware/Brave-Browser", win: "BraveSoftware\\Brave-Browser" },
	{ name: "Edge", mac: "Microsoft Edge", linux: "microsoft-edge", win: "Microsoft\\Edge" },
	{ name: "Vivaldi", mac: "Vivaldi", linux: "vivaldi", win: "Vivaldi" },
	{ name: "Arc", mac: "Arc/User Data" },
];

export interface ChromeWhere {
	/** pine's home: the launcher and the copy of the extension go into its `chrome` folder. */
	home: string;
	dataDir: string;
	/** The owner's account, where the browsers keep their folders. Another one only in a test. */
	account?: string;
	platform?: NodeJS.Platform;
}

export interface ChromeState {
	/** The owner connected pine to the browsers of this computer. */
	set: boolean;
	/** The browsers there are here, and whether each knows pine's host. */
	browsers: Array<{ name: string; registered: boolean }>;
	/** The extension is running in a browser and its host answers. */
	connected?: { browser: string; version: string };
	/** The extension as a folder, for a browser that loads it from one. */
	folder: string;
	/** The extension's page in a store, when it is in one. */
	store?: string;
}

/** Where the host says how it is reached (mcp/chrome.ts), for the browsers of the owner's conversations. */
export const chromeFile = (dataDir: string): string => path.join(dataDir, "chrome", "host.json");

const dirOf = (home: string) => path.join(home, "chrome");
const launcherOf = (home: string, platform: NodeJS.Platform) => path.join(dirOf(home), platform === "win32" ? "host.bat" : "host");
const folderOf = (home: string) => path.join(dirOf(home), "extension");
/** The extension as it lies with pine's code. */
const SOURCE = path.join(import.meta.dirname, "..", "extension");

// (PINE_CHROME_ACCOUNT is for pine's own tests, which must not write into the owner's browsers.)
const accountOf = (w: ChromeWhere) => w.account ?? process.env.PINE_CHROME_ACCOUNT ?? os.homedir();
const platformOf = (w: ChromeWhere) => w.platform ?? process.platform;

/** The browsers of this account, with the folder each looks for hosts in (macOS, Linux) or its registry key (Windows). */
function found(w: ChromeWhere): Array<{ name: string; dir?: string; key?: string }> {
	const [account, platform] = [accountOf(w), platformOf(w)];
	const list: Array<{ name: string; dir?: string; key?: string }> = [];
	for (const kind of KINDS) {
		if (platform === "win32") {
			if (kind.win && fs.existsSync(path.join(account, "AppData", "Local", kind.win, "User Data"))) list.push({ name: kind.name, key: `HKCU\\Software\\${kind.win}\\NativeMessagingHosts\\${HOST_NAME}` });
			continue;
		}
		const sub = platform === "darwin" ? kind.mac : kind.linux;
		if (!sub) continue;
		const base = platform === "darwin" ? path.join(account, "Library", "Application Support", sub) : path.join(account, ".config", sub);
		if (fs.existsSync(base)) list.push({ name: kind.name, dir: path.join(base, "NativeMessagingHosts") });
	}
	return list;
}

const quoted = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

/** The launcher: the Node pine runs on, pine's host, and where the host says how it is reached. */
function launcher(w: ChromeWhere): string {
	const [node, script, file] = [process.execPath, path.join(import.meta.dirname, "..", "mcp", `chrome${EXT}`), chromeFile(w.dataDir)];
	if (platformOf(w) === "win32") return `@echo off\r\n"${node}" "${script}" "${file}" %*\r\n`;
	return `#!/bin/sh\n# Started by a browser for pine's extension. Written by pine: pine chrome install\nexec ${quoted(node)} ${quoted(script)} ${quoted(file)} "$@"\n`;
}

const manifest = (w: ChromeWhere) =>
	`${JSON.stringify({ name: HOST_NAME, description: "pine: lets your pine agents work in this browser", path: launcherOf(w.home, platformOf(w)), type: "stdio", allowed_origins: EXTENSION_IDS.map((id) => `chrome-extension://${id}/`) }, null, "\t")}\n`;

/** Writes a file when it is not that already, so that a start of pine touches nothing that is in order. */
function put(file: string, content: string, mode: number): void {
	try {
		if (fs.readFileSync(file, "utf8") === content) return;
	} catch {}
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content, { mode });
	fs.chmodSync(file, mode);
}

const reg = (args: string[]) => execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe"), args, { stdio: "ignore", windowsHide: true });

function registered(w: ChromeWhere, browser: { dir?: string; key?: string }): boolean {
	if (browser.dir) {
		try {
			return JSON.parse(fs.readFileSync(path.join(browser.dir, `${HOST_NAME}.json`), "utf8")).path === launcherOf(w.home, platformOf(w));
		} catch {
			return false;
		}
	}
	try {
		reg(["query", browser.key!, "/ve"]);
		return true;
	} catch {
		return false;
	}
}

/** The owner connected pine to this computer's browsers at some time. */
const isSet = (w: ChromeWhere) => fs.existsSync(launcherOf(w.home, platformOf(w)));

/**
 * Connects pine to every browser of this account that takes extensions of Chrome's kind, and puts
 * the extension into pine's home. Returns the browsers that know pine's host now.
 */
export function connectChrome(w: ChromeWhere): string[] {
	const platform = platformOf(w);
	put(launcherOf(w.home, platform), launcher(w), 0o700);
	// The copy of the extension: as it lies with this pine, and nothing else.
	fs.rmSync(folderOf(w.home), { recursive: true, force: true });
	fs.cpSync(SOURCE, folderOf(w.home), { recursive: true });
	const names: string[] = [];
	const own = path.join(dirOf(w.home), `${HOST_NAME}.json`);
	if (platform === "win32") put(own, manifest(w), 0o600);
	for (const browser of found(w)) {
		try {
			if (browser.dir) put(path.join(browser.dir, `${HOST_NAME}.json`), manifest(w), 0o644);
			else reg(["add", browser.key!, "/ve", "/t", "REG_SZ", "/d", own, "/f"]);
			names.push(browser.name);
		} catch {
			// A browser whose folder cannot be written is left out, and the others are not held up by it.
		}
	}
	return names;
}

/** Takes back what connectChrome did: the browsers no longer know pine's host, and pine's home has none. */
export function disconnectChrome(w: ChromeWhere): void {
	for (const browser of found(w)) {
		try {
			if (browser.dir) {
				const file = path.join(browser.dir, `${HOST_NAME}.json`);
				// Only pine's own entry of this home: another home's stays.
				if (registered(w, browser)) fs.rmSync(file, { force: true });
			} else reg(["delete", browser.key!, "/f"]);
		} catch {}
	}
	fs.rmSync(dirOf(w.home), { recursive: true, force: true });
	fs.rmSync(chromeFile(w.dataDir), { force: true });
}

/** At a start of pine: what the owner connected once is brought up to date. Nothing where they never did. */
export function refreshChrome(w: ChromeWhere): void {
	if (isSet(w)) connectChrome(w);
}

/** A name of a browser as the host wrote it, taken for nothing but a short line. */
const word = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[^\w .-]+/g, "").slice(0, max) : "");

export function chromeState(w: ChromeWhere): ChromeState {
	let connected: ChromeState["connected"];
	try {
		const said = JSON.parse(fs.readFileSync(chromeFile(w.dataDir), "utf8"));
		if (Number(said.until) > Date.now()) connected = { browser: word(said.browser, 40) || "a browser", version: word(said.version, 40) };
	} catch {}
	const set = isSet(w);
	return { set, browsers: found(w).map((b) => ({ name: b.name, registered: set && registered(w, b) })), ...(connected ? { connected } : {}), folder: set ? folderOf(w.home) : SOURCE, ...(STORE ? { store: STORE } : {}) };
}
