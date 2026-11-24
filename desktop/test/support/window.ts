// The one window the app's tests work in (app.test.ts, app-around.test.ts): the real Electron app
// on a pine home of its own, with the scripted model server of pine's test suite behind it, and
// what those tests share to look at it and to drive it. Each file that imports this gets an app,
// a daemon and a home of its own: a test file is a process of its own.
//
//   PINE_DESKTOP_SHOTS=<folder>      also saves a picture of each screen there
//   PINE_DESKTOP_THEME=<theme>       in that theme of pine's (github-light, dracula ...)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before } from "node:test";
import { startMock } from "../../../baseline/tests/mock.mjs";
import { sandboxMissing } from "../../../src/security.ts";
import { launchApp } from "./app.ts";

export const root = path.resolve(import.meta.dirname, "..", "..");
export const shots = process.env.PINE_DESKTOP_SHOTS;

export let app: any;
export let page: any;
export let mock: any;
export let home: string;
/** The pine home of "another machine", reached through a stand-in for ssh. */
export let far: string;
export let folder: string;
/** Where the browser of the web tools would lie (Playwright's own variable for it): a folder of the test's, empty at the start. */
export let browsers: string;
/** A stand-in for GitHub, which the app asks for pine's last release: what it answers, and how often it was asked. */
export let github: http.Server;
export const releases = { status: 200, tag: "v9.9.9", asked: 0 };
/** What went wrong in the page itself, said with a failure. */
export const pageErrors: string[] = [];

export const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

export async function shot(name: string): Promise<void> {
	if (!shots) return;
	fs.mkdirSync(shots, { recursive: true });
	await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

/** Wait for something on screen; when it does not come, say what is there instead. */
export async function sees(selector: string, timeout = 20_000): Promise<void> {
	try {
		await page.waitForSelector(selector, { timeout });
	} catch {
		await shot(`failed-${selector.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`);
		const there = await page.evaluate(() => ({ text: (document.querySelector("[data-slot=message-scroller-content], [data-slot=settings-page], [data-slot=empty]") as HTMLElement | null)?.innerText?.slice(-1500), toasts: [...document.querySelectorAll("[data-slot=toast]")].map((t) => t.textContent), dialog: (document.querySelector("[data-slot=dialog-content]") as HTMLElement | null)?.innerText?.slice(0, 600) }));
		throw new Error(`"${selector}" did not appear. On screen: ${JSON.stringify(there, null, 1)}${pageErrors.length ? `\nErrors in the page:\n${pageErrors.join("\n")}` : ""}`);
	}
}

/** What a menu item does: the menus are the system's, and keys typed into the page do not reach them. */
export const menu = (command: string) => app.evaluate(({ BrowserWindow }: any, c: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", c), command);

/**
 * The owner comes to the window and leaves it again. On coming, the page asks the daemon anew which
 * agents there are, so a test about one made elsewhere need not wait for the page's own look every
 * eight seconds; afterwards the window is behind, as it is for every other test.
 */
export const visit = () =>
	app.evaluate(({ BrowserWindow }: any) => {
		const page = BrowserWindow.getAllWindows()[0].webContents;
		page.send("pine:focus", true);
		page.send("pine:focus", false);
	});

/** What the app has said in the corner is put away, as a click on each one's cross does: a toast lies over what is under it and takes its clicks until it goes by itself. */
export async function putAwayToasts(): Promise<void> {
	for (let i = 0; i < 10 && (await page.$("[data-slot=toast]")); i++) {
		await page.$$eval("[data-slot=toast-close]", (buttons: HTMLElement[]) => buttons.forEach((b) => b.click()));
		await page.waitForSelector("[data-slot=toast]", { state: "detached", timeout: 1000 }).catch(() => {});
	}
}

/** A JSON file as it is now; undefined while the daemon is writing it, when a reader can find it empty. */
export function json(file: string): any {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}

export const api = (method: string, url: string, body?: unknown) => page.evaluate(([m, u, b]: [string, string, unknown]) => (window as any).pine.call(m, u, b), [method, url, body]);

/** Makes the home, the stand-ins and the app, and waits for its window. */
async function open(): Promise<void> {
	// The agents here work in `safe` mode, in the sandbox, as an owner's do. On Linux it is bubblewrap,
	// which `pine init` sets up: without it they get no shell and see no folder, and half of what is
	// tested here cannot happen. That is said once, here, and not as a dozen timeouts.
	if (process.platform === "linux" && sandboxMissing()) throw new Error(`No sandbox on this computer: ${sandboxMissing()}. The app's tests need one: run "node src/cli.ts init --yes" at the root first.`);
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g, promptTokens: (body: any, raw: string) => contextAt(body) ?? Math.ceil(raw.length / 4) });
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-")));
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	// A port of its own (0: the system picks one), so that a pine the developer has running is left alone.
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe", introduce: false, thinking: "off" }, security: { askAccess: false }, ...(process.env.PINE_DESKTOP_THEME ? { ui: { theme: process.env.PINE_DESKTOP_THEME } } : {}) }, null, 2));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ delegates: ["scout"], approve: ["bash"] }));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent: it administers pine.\n\nYou are the main agent.\n");
	write(path.join(home, "agents", "main", "workspace", "notes.md"), "# Notes\n\nfirst line\n");
	write(path.join(home, "agents", "scout", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "scout", "workspace", "AGENTS.md"), "Looks things up on the web.\n\nYou are scout.\n");
	browsers = path.join(home, "browsers");
	fs.mkdirSync(browsers, { recursive: true });
	// A folder of the owner's, with a git history, to open for a conversation.
	folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-folder-")));
	write(path.join(folder, "README.md"), "# Okapi\n\nA small project.\n");
	write(path.join(folder, "src", "index.ts"), "export const answer = 41;\n");
	const git = (...args: string[]) => execFileSync("git", ["-C", folder, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { stdio: "ignore" });
	git("init", "-q");
	git("add", ".");
	git("commit", "-q", "-m", "first");
	write(path.join(folder, "src", "index.ts"), "export const answer = 42;\n");

	// A stand-in for the voice helper: it "hears" two words, and a third when it is told that was all.
	const voice = path.join(home, "voice-stand-in.mjs");
	write(voice, `#!/usr/bin/env node
const say = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
say({ type: "ready" });
setTimeout(() => say({ type: "partial", text: "about the scans" }), 50);
process.stdin.on("end", () => say({ type: "final", text: "about the scans please" }));
process.stdin.resume();
`);
	fs.chmodSync(voice, 0o755);

	github = http.createServer((_req, res) => {
		releases.asked++;
		const version = releases.tag.slice(1);
		// The app for each system and processor is attached (`appFile` in electron/updates.ts), and the Mac's update feed, so a release counts wherever the test runs.
		res.writeHead(releases.status, { "content-type": "application/json" }).end(JSON.stringify({ tag_name: releases.tag, html_url: "https://example.invalid/elsewhere", assets: ["arm64", "x64"].flatMap((arch) => [...[".dmg", ".AppImage", "-setup.exe"].map((kind) => ({ name: `Pine-${version}-${arch}${kind}` })), { name: `Pine-${arch}.json` }]) }));
	});
	await new Promise<void>((r) => github.listen(0, "127.0.0.1", r));

	// Another machine, as the app reaches it: a stand-in for ssh that runs `pine service` on a home
	// of its own as the master of a control socket, and through that socket binds the port that
	// `-O forward -L` asks for, or says it cannot, as ssh does.
	far = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-far-")));
	write(path.join(far, "models.json"), fs.readFileSync(path.join(home, "models.json"), "utf8"));
	write(path.join(far, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe", introduce: false, thinking: "off" }, security: { askAccess: false } }, null, 2));
	write(path.join(far, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(far, "agents", "main", "workspace", "AGENTS.md"), "The main agent of the other machine.\n\nYou are the main agent there.\n");
	write(path.join(far, "agents", "helper", "agent.json"), JSON.stringify({}));
	write(path.join(far, "agents", "helper", "workspace", "AGENTS.md"), "Helps on the other machine.\n\nYou are helper.\n");
	const ssh = path.join(home, "ssh-stand-in.mjs");
	write(ssh, `#!${process.execPath}
import { spawn } from "node:child_process";
import net from "node:net";
const args = process.argv.slice(2);
const opt = (name) => args.map((a, i) => args[i - 1] === "-o" && a.startsWith(name + "=") ? a.slice(name.length + 1) : undefined).find(Boolean);
const control = opt("ControlPath");
if (args.includes("-O")) {
	const c = net.connect(control);
	let reply = "";
	c.on("data", (d) => (reply += d));
	c.on("end", () => { if (reply.startsWith("ok")) process.exit(0); console.error("mux_client_forward: forwarding request failed: " + reply.slice(5).trim()); process.exit(255); });
	c.on("error", (e) => { console.error("Control socket connect: " + e.message); process.exit(255); });
	c.end(args[args.indexOf("-L") + 1] + "\\n");
} else {
	if (!/exec \\/bin\\/sh -c '.*pine service && exec cat/.test(args.at(-1) ?? "")) { console.error("not the command the app runs"); process.exit(2); }
	if (opt("ControlMaster") === "yes") net.createServer((c) => c.once("data", (d) => {
		const [, port, toHost, toPort] = String(d).trim().split(":");
		const server = net.createServer((s) => { const to = net.connect(Number(toPort), toHost); s.pipe(to).pipe(s); s.on("error", () => to.destroy()); to.on("error", () => s.destroy()); });
		server.once("error", () => c.end("fail Port forwarding failed"));
		server.listen(Number(port), "127.0.0.1", () => c.end("ok"));
	})).listen(control);
	const child = spawn(${JSON.stringify(process.execPath)}, [${JSON.stringify(path.resolve(root, "..", "bin", "pine.js"))}, "service", "--home", ${JSON.stringify(far)}], { stdio: "inherit", env: { ...process.env, PINE_SKIP_DOWNLOADS: "1" } });
	let running = true;
	let ending = false;
	process.on("SIGTERM", () => { ending = true; if (running) child.kill("SIGTERM"); else process.exit(0); });
	// As "pine service && exec cat": after a service that attached, the session lasts until stdin ends.
	child.on("exit", (code) => { running = false; if (code || ending) process.exit(code ?? 0); });
	process.stdin.on("end", () => (running ? child.on("exit", () => process.exit(0)) : process.exit(0)));
	process.stdin.resume();
}
`);
	fs.chmodSync(ssh, 0o755);

	app = await launchApp({ ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers, PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_VOICE: voice, PINE_DESKTOP_SHELL: "/bin/bash", PINE_DESKTOP_RELEASES: `http://127.0.0.1:${(github.address() as any).port}/repos/pmndre/pine/releases/latest`, PINE_DESKTOP_SSH: ssh });
	page = await app.firstWindow();
	page.on("pageerror", (e: Error) => pageErrors.push(String(e.stack ?? e.message).slice(0, 600)));
	page.on("console", (m: any) => m.type() === "error" && pageErrors.push(m.text().slice(0, 600)));
	await page.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
}

/**
 * Settled when the window is there. The hooks of a file run side by side, so one of a test file's
 * own that needs the window waits for this (`started`), not for its turn.
 */
const opened = Promise.withResolvers<void>();
opened.promise.catch(() => {});
before(() =>
	open().then(opened.resolve, (e) => {
		opened.reject(e);
		throw e;
	}),
);

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	github?.close();
	for (const dir of [home, far, folder]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

/** What lies over the page and takes its clicks and keys: a dialog, a menu. */
export const OVER = "[role=dialog], [role=alertdialog], [role=menu]";

// Every test here works in the one window. A test that fails halfway leaves what it had open (the
// model picker, a menu) over the page, and each test after it then fails on that and not on what
// it is about. So after a failed test, what is open is closed as the owner would close it.
afterEach(async (t) => {
	if (t.passed || !page) return;
	for (let i = 0; i < 5; i++) {
		const open = await page.$$eval(OVER, (els: Element[]) => els.length).catch(() => 0);
		if (!open) return;
		await page.keyboard.press("Escape").catch(() => {});
		// One Escape closes the topmost; when nothing closes (a question that has to be answered), the next try ends it.
		await page.waitForFunction(([s, n]: [string, number]) => document.querySelectorAll(s).length < n, [OVER, open], { timeout: 2000 }).catch(() => {});
	}
});

/** The context window of the mock model (models.json above). */
export const WINDOW = 128000;

/** A message that says "the context at N%" is read by the mock as filling that much of the window. */
export function contextAt(body: any): number | undefined {
	const last = [...(body.messages ?? [])].reverse().find((m: any) => m.role === "user");
	const text = typeof last?.content === "string" ? last.content : (last?.content ?? []).map((p: any) => p.text ?? "").join("");
	const n = /the context at (\d+)%/.exec(text)?.[1];
	return n ? Math.round((WINDOW * Number(n)) / 100) : undefined;
}

/** The edge between the side bar and the rest of the window, and the one before the panel beside a conversation. */
/** How the app calls this computer: "This Mac" on a Mac, "This computer" elsewhere. */
export const HERE = process.platform === "darwin" ? "Mac" : "computer";
export const SIDE_EDGE = "#sidebar-panel + [data-slot=resizable-handle]";
export const CODE_EDGE = "[data-slot=resizable-handle]:has(+ #code-panel)";
/** The edge before the browser's aside, and the toggles of the panel and of the browser at the top right of the title bar. */
export const BROWSER_EDGE = "[data-slot=resizable-handle]:has(+ #browser-panel)";
export const CODE_TOGGLE = "header [data-toggle=code]";
export const BROWSER_TOGGLE = "header [data-toggle=browser]";

/** A test closed the app itself: there is none left for the end of the file to close. */
export const closed = () => void (app = undefined);

/**
 * For a file that is not about the start (app.test.ts is): the main agent is there, and the
 * question about the browser for the web tools, asked once at the start, is answered "Not now",
 * so that it lies over nothing.
 */
export async function started(): Promise<void> {
	await opened.promise;
	await sees("[data-slot=empty] h1");
	await sees(`[data-slot=dialog-title] >> text=The browser for the web tools is not on this ${HERE}`);
	await page.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Not now" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
}

/** Where focus is: the field's role, and the option it marks active, as a screen reader hears them. */
export const activeOption = () =>
	page.evaluate(() => {
		const field = document.activeElement as HTMLElement;
		const id = field.getAttribute("aria-activedescendant");
		const option = id ? document.getElementById(id) : null;
		return { inDialog: Boolean(field.closest("[role=dialog]")), role: field.getAttribute("role"), option: option?.getAttribute("role"), selected: option?.getAttribute("aria-selected"), text: option?.textContent ?? "", list: Boolean(option?.closest("[role=listbox]")) };
	});

/**
 * Waits until the keyboard is in a list's field and the line it names reads as `pattern` (or, with
 * `is` false, as something else). A dialog takes focus a moment after it is drawn, and a line is
 * named a moment after a key: an arrow pressed before the first goes to what is behind the dialog,
 * and a look before the second finds the line from before, or none.
 */
export const named = (pattern: RegExp, is = true) =>
	page.waitForFunction(
		([source, is]: [string, boolean]) => {
			const field = document.activeElement;
			const id = field?.getAttribute("aria-activedescendant");
			const option = id ? document.getElementById(id) : null;
			return field?.getAttribute("role") === "combobox" && option !== null && new RegExp(source).test(option.textContent ?? "") === is;
		},
		[pattern.source, is],
		{ timeout: 20_000 },
	);

/**
 * Waits until a dialog that was drawn has the keyboard, and its list, where it has one, a chosen line.
 * Both come a moment after the dialog: an Enter pressed before goes to the page behind it, or chooses nothing.
 */
export const inDialog = () =>
	page.waitForFunction(
		() => {
			const at = document.activeElement;
			const dialog = at?.closest("[role=dialog], [role=alertdialog]");
			if (!at || !dialog || at.hasAttribute("data-base-ui-focus-guard")) return false;
			return !dialog.querySelector("[role=option]") || Boolean(dialog.querySelector("[role=option][aria-selected=true]"));
		},
		undefined,
		{ timeout: 20_000 },
	);

/** Answers the dialog with that title with Enter, once it has the keyboard. */
export const confirm = async (title: string) => {
	await sees(title);
	await inDialog();
	await page.keyboard.press("Enter");
};

/** Tab stays inside the dialog: past its last stop, the dialog's focus guard hands focus back to its first (in the next frame). */
export const stillInside = () => page.waitForFunction(() => Boolean(document.activeElement?.closest("[role=dialog]")) && !document.activeElement?.hasAttribute("data-base-ui-focus-guard"), undefined, { timeout: 2000 });

/** The text a dialog is announced by: what its aria-labelledby points at. */
export const announced = (selector: string) =>
	page.$eval(selector, (d: Element) => (d.getAttribute("aria-labelledby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim());
