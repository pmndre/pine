// The app from end to end: the real Electron app on a pine home of its own, with the scripted
// model server of pine's test suite behind it. It starts the daemon itself (`pine service`),
// which is half of what is tested here.
//
//   npm test                         in desktop/
//   PINE_DESKTOP_SHOTS=<folder>      also saves a picture of each screen there
//   PINE_DESKTOP_THEME=<theme>       in that theme of pine's (github-light, dracula ...)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, afterEach, before, test } from "node:test";
import { mockMsg, startMock } from "../../baseline/tests/mock.mjs";
import { httpMcp } from "../../testing/http-mcp.ts";
import { launchApp } from "./support/app.ts";
import { daemonGone, ours } from "./support/daemon.ts";

const root = path.resolve(import.meta.dirname, "..");
const shots = process.env.PINE_DESKTOP_SHOTS;

let app: any;
let page: any;
let mock: any;
let home: string;
/** The pine home of "another machine", reached through a stand-in for ssh. */
let far: string;
let folder: string;
/** Where the browser of the web tools would lie (Playwright's own variable for it): a folder of the test's, empty at the start. */
let browsers: string;
/** A stand-in for GitHub, which the app asks for pine's last release: what it answers, and how often it was asked. */
let github: http.Server;
const releases = { status: 200, tag: "v9.9.9", asked: 0 };
/** What went wrong in the page itself, said with a failure. */
const pageErrors: string[] = [];

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

async function shot(name: string): Promise<void> {
	if (!shots) return;
	fs.mkdirSync(shots, { recursive: true });
	await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

/** Wait for something on screen; when it does not come, say what is there instead. */
async function sees(selector: string, timeout = 20_000): Promise<void> {
	try {
		await page.waitForSelector(selector, { timeout });
	} catch {
		await shot(`failed-${selector.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`);
		const there = await page.evaluate(() => ({ text: (document.querySelector("[data-slot=message-scroller-content], [data-slot=settings-page], [data-slot=empty]") as HTMLElement | null)?.innerText?.slice(-1500), toasts: [...document.querySelectorAll("[data-slot=toast]")].map((t) => t.textContent), dialog: (document.querySelector("[data-slot=dialog-content]") as HTMLElement | null)?.innerText?.slice(0, 600) }));
		throw new Error(`"${selector}" did not appear. On screen: ${JSON.stringify(there, null, 1)}${pageErrors.length ? `\nErrors in the page:\n${pageErrors.join("\n")}` : ""}`);
	}
}

/** What a menu item does: the menus are the system's, and keys typed into the page do not reach them. */
const menu = (command: string) => app.evaluate(({ BrowserWindow }: any, c: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", c), command);

const api = (method: string, url: string, body?: unknown) => page.evaluate(([m, u, b]: [string, string, unknown]) => (window as any).pine.call(m, u, b), [method, url, body]);

before(async () => {
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g, promptTokens: (body: any, raw: string) => contextAt(body) ?? Math.ceil(raw.length / 4) });
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-")));
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	// A port of its own (0: the system picks one), so that a pine the developer has running is left alone.
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false }, ...(process.env.PINE_DESKTOP_THEME ? { ui: { theme: process.env.PINE_DESKTOP_THEME } } : {}) }, null, 2));
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
		res.writeHead(releases.status, { "content-type": "application/json" }).end(JSON.stringify({ tag_name: releases.tag, html_url: "https://example.invalid/elsewhere", assets: ["arm64", "x64"].map((arch) => ({ name: `Pine-${version}-${arch}.dmg` })) }));
	});
	await new Promise<void>((r) => github.listen(0, "127.0.0.1", r));

	// Another machine, as the app reaches it: a stand-in for ssh that runs `pine service` on a home
	// of its own as the master of a control socket, and through that socket binds the port that
	// `-O forward -L` asks for, or says it cannot, as ssh does.
	far = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-far-")));
	write(path.join(far, "models.json"), fs.readFileSync(path.join(home, "models.json"), "utf8"));
	write(path.join(far, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false } }, null, 2));
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
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	github?.close();
	for (const dir of [home, far, folder]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

/** What lies over the page and takes its clicks and keys: a dialog, a menu. */
const OVER = "[role=dialog], [role=alertdialog], [role=menu]";

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
const WINDOW = 128000;

/** A message that says "the context at N%" is read by the mock as filling that much of the window. */
function contextAt(body: any): number | undefined {
	const last = [...(body.messages ?? [])].reverse().find((m: any) => m.role === "user");
	const text = typeof last?.content === "string" ? last.content : (last?.content ?? []).map((p: any) => p.text ?? "").join("");
	const n = /the context at (\d+)%/.exec(text)?.[1];
	return n ? Math.round((WINDOW * Number(n)) / 100) : undefined;
}

/** The edge between the side bar and the rest of the window, and the one before the panel beside a conversation. */
const SIDE_EDGE = "#sidebar-panel + [data-slot=resizable-handle]";
const CODE_EDGE = "[data-slot=resizable-handle]:has(+ #code-panel)";
/** The edge before the browser's aside, and the toggles of the panel and of the browser at the top right of the title bar. */
const BROWSER_EDGE = "[data-slot=resizable-handle]:has(+ #browser-panel)";
const CODE_TOGGLE = "header [data-toggle=code]";
const BROWSER_TOGGLE = "header [data-toggle=browser]";

test("starts a daemon of its own and shows the main agent", async () => {
	await sees("[data-slot=empty] h1");
	assert.equal(await page.textContent("[data-slot=empty] h1"), "main");
	// This home has no browser for the web tools in the build its pine drives (the folder for it
	// is empty): that is asked once, at the start, and "Not now" is remembered.
	await sees("[data-slot=dialog-title] >> text=The browser for the web tools is not on this Mac");
	await shot("00-browser");
	await page.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Not now" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	assert.match(await page.textContent("[data-slot=service-status]"), /started here/);
	const agents = await page.$$eval("[data-slot=agent-label] > :first-child", (els: Element[]) => els.map((e) => e.textContent?.trim()));
	assert.deepEqual(agents, ["main", "scout"]);
	// The daemon it started is the one of this home, on a port of its own.
	assert.ok(fs.existsSync(path.join(home, "data", "http-token")));
	// The line around the tab in front is drawn outside the tab, and the row of tabs scrolls: what
	// lies outside the row is cut off. So the row has to leave the line its pixel on every side.
	const room = await page.evaluate(() => {
		const row = document.querySelector("header [data-slot=scroll-area]")!.getBoundingClientRect();
		const tab = document.querySelector("[data-slot=tab][data-active]")!.getBoundingClientRect();
		return { top: tab.top - row.top, bottom: row.bottom - tab.bottom, left: tab.left - row.left };
	});
	assert.ok(room.top >= 1 && room.bottom >= 1 && room.left >= 1, `the row cuts off the line around the tab in front: ${JSON.stringify(room)}`);
	// At the foot of the side bar the dot of the status stands under the icons of the rows above
	// it, and what is written beside it under their names.
	const foot = await page.evaluate(() => {
		const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
		const middle = (r: DOMRect) => r.left + r.width / 2;
		return { icon: middle(box("[data-slot=sidebar-footer] [data-sidebar=menu-button] .lucide")), dot: middle(box("[data-slot=service-status] > :first-child")), name: box("[data-slot=sidebar-footer] [data-sidebar=menu-button] > span").left, status: box("[data-slot=service-status] > :nth-child(2)").left };
	});
	assert.equal(foot.dot, foot.icon, `the dot of the status is not under the icons above it: ${JSON.stringify(foot)}`);
	assert.equal(foot.status, foot.name, `the status is not written under the names above it: ${JSON.stringify(foot)}`);
	// It is a row as large as Events and Settings above it.
	const rows = await page.$$eval("[data-slot=sidebar-footer] [data-sidebar=menu-button]", (els: Element[]) => els.map((e) => [e.getBoundingClientRect().height, getComputedStyle(e).fontSize].join()));
	assert.equal(new Set(rows).size, 1, `the rows at the foot differ: ${rows}`);
	await shot("01-welcome");
});

test("a newer app is said at the start and when asked, with a link to its page on GitHub and nothing fetched", async () => {
	const mine = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
	const link = "https://github.com/pmndre/pine/releases/tag/v9.9.9";
	// The start asked once, and the side bar says what it found.
	await sees("[data-slot=sidebar-footer] >> text=Pine 9.9.9 is available");
	assert.equal(releases.asked, 1);
	await shot("01-update");
	// What would open in the owner's browser is noted instead.
	await app.evaluate(({ shell }: any) => {
		(globalThis as any).opened = [];
		shell.openExternal = async (url: string) => void (globalThis as any).opened.push(url);
	});
	const opened = () => app.evaluate(() => (globalThis as any).opened);
	await page.click("[data-slot=sidebar-footer] [data-sidebar=menu-button]:has-text('is available')");
	// "Check for Updates…" in the menu asks again and says where the new app is.
	const inMenu = await app.evaluate(({ Menu }: any) => {
		const found = Menu.getApplicationMenu().items.flatMap((m: any) => m.submenu?.items ?? []).filter((i: any) => i.label === "Check for Updates…");
		found[0]?.click();
		return found.length;
	});
	assert.equal(inMenu, 1);
	await sees("[data-slot=dialog-title] >> text=Pine 9.9.9 is available");
	assert.equal(releases.asked, 2);
	const body = await page.textContent("[data-slot=dialog-content]");
	assert.ok(body.includes(`This is Pine ${mine}.`) && body.includes(link), body);
	await shot("01-update-asked");
	await page.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Open the release page" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	// The link is GitHub's page of that release, not the address the answer named.
	assert.deepEqual(await opened(), [link, link]);
	// Nobody answers: that is said, and what was found before stays.
	releases.status = 503;
	await menu("updates");
	await sees("[data-slot=toast] >> text=Could not ask GitHub for the latest version");
	await sees("[data-slot=sidebar-footer] [data-sidebar=menu-button]:has-text('is available')");
	// This app is the last release: said once, and the side bar's line is gone.
	Object.assign(releases, { status: 200, tag: `v${mine}` });
	await menu("updates");
	await sees(`[data-slot=toast] >> text=Pine ${mine} is the latest version.`);
	await page.waitForSelector("[data-slot=sidebar-footer] [data-sidebar=menu-button]:has-text('is available')", { state: "detached" });
	// Settings > App has the same, and the switch for the question at the start.
	await menu("settings");
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=App");
	await sees("[data-setting=updates] [data-slot=badge][data-variant=default] >> text=the latest version");
	releases.tag = "v9.9.9";
	await page.locator("[data-setting=updates]").getByRole("button", { name: "Check now" }).click();
	await sees("[data-setting=updates] [data-slot=badge][data-variant=outline] >> text=9.9.9 is available");
	await page.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Not now" }).click();
	await page.locator("[data-setting=updates]").getByRole("button", { name: "Release page" }).click();
	assert.deepEqual(await opened(), [link, link, link]);
	const prefs = () => JSON.parse(fs.readFileSync(path.join(home, "desktop-data", "prefs.json"), "utf8"));
	await page.click("[data-slot=field]:has-text('Look for a newer version at the start') [data-slot=switch]");
	for (let i = 0; i < 50 && prefs().updates !== false; i++) await new Promise((r) => setTimeout(r, 40));
	assert.equal(prefs().updates, false);
	// It is a switch to assistive technology too, and Space turns it back on.
	await sees("[data-slot=field]:has-text('Look for a newer version at the start') [role=switch][aria-checked=false]");
	await page.keyboard.press("Space");
	await sees("[data-slot=field]:has-text('Look for a newer version at the start') [role=switch][aria-checked=true]");
	// (The settings open where they were left: back to their first page for the tests that follow.)
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=General");
	await menu("settings");
	await sees("[data-slot=sidebar-footer] >> text=Pine 9.9.9 is available");
});

test("the agent's browser is shown in an aside of its own as a picture, and what is done in it goes back through the daemon", async () => {
	// A stand-in for the door of the browser of main's own conversation: it says where it is in pine's data,
	// as the real one does, hands out one picture and notes what it is asked.
	const picture = Buffer.from(await app.evaluate(({ nativeImage }: any) => nativeImage.createFromBitmap(Buffer.alloc(400 * 300 * 4, 180), { width: 400, height: 300 }).toJPEG(70).toString("base64")), "base64");
	const word = "cd".repeat(32);
	const asked: Array<{ at: string; body: any }> = [];
	const where = { open: true, tabs: [{ title: "<img src=x onerror=window.hacked=3>Okapi shop", url: "https://shop.example/" }, { title: "Second", url: "https://shop.example/two" }], current: 0, window: false };
	const door = http.createServer(async (req, res) => {
		if (req.headers.authorization !== `Bearer ${word}`) return void res.writeHead(401).end();
		let text = "";
		for await (const chunk of req) text += chunk;
		if (req.url === "/frame") return void res.writeHead(200, { "content-type": "image/jpeg" }).end(picture);
		if (req.method === "POST") asked.push({ at: req.url!, body: JSON.parse(text || "{}") });
		res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(req.url === "/open" ? { ...where, error: "the browser was refused that address" } : where));
	});
	await new Promise<void>((r) => door.listen(0, "127.0.0.1", r));
	const file = path.join(home, "data", "browser-view", `${encodeURIComponent("main:main")}.json`);
	write(file, JSON.stringify({ port: (door.address() as any).port, token: word, pid: 1 }));
	const ops = () => asked.filter((a) => a.at === "/input").flatMap((a) => a.body.ops as any[]);
	// As long as `sees` waits (20 s): on a computer that runs other tests too, 5 s was not enough.
	const waitFor = async (what: string, test: () => boolean) => {
		for (let i = 0; i < 400 && !test(); i++) await new Promise((r) => setTimeout(r, 50));
		assert.ok(test(), `${what}. Asked: ${JSON.stringify(asked)}`);
	};
	await page.click("[data-slot=tab] >> nth=0");
	const had = Boolean(await page.$("[data-slot=code-panel]"));
	// A window wide enough for the conversation, the side panel and the browser side by side, at the widths they start with.
	await page.setViewportSize({ width: 1800, height: 900 });
	try {
		// The side panel and the browser are toggled from the top right of the title bar, and both show at once.
		if (!had) await page.click(CODE_TOGGLE);
		await sees("#code-panel [data-slot=code-panel]");
		assert.equal(await page.$("[data-slot=conversation-head] [data-slot=toggle]"), null, "the conversation's top line has no panel toggle");
		assert.ok(!(await page.locator("[data-slot=code-panel] [role=tab]").allTextContents()).some((t) => /Browser/.test(t)), "the side panel has no Browser tab");
		await page.click(BROWSER_TOGGLE);
		// The page is a picture, drawn when it is whole; its address is text in the line above it.
		await sees("#browser-panel [data-slot=browser-aside] [data-slot=browser] canvas[data-drawn]");
		await sees(`${CODE_TOGGLE}[aria-pressed=true]`);
		await sees(`${BROWSER_TOGGLE}[aria-pressed=true]`);
		const right = (sel: string) => page.$eval(sel, (el: Element) => el.getBoundingClientRect());
		assert.ok((await right("#browser-panel")).left >= (await right("#code-panel")).right, "the browser aside lies to the right of the side panel");
		// A row that scrolls sideways (the browser's tabs, the panel's, the conversations') is no taller than its room:
		// stock's ScrollArea would show a vertical bar with nothing to scroll.
		await sees("[data-slot=browser] [data-slot=scroll-area-viewport]:has([data-slot=tabs-list])");
		const rows = await page.$$eval("[data-slot=scroll-area][class*='scroll-fade-x'] > [data-slot=scroll-area-viewport]", (els: Element[]) => els.map((el) => ({ row: ((r) => r?.getAttribute("data-slot") ?? r?.tagName.toLowerCase())(el.closest("[data-slot=browser], [data-slot=code-panel], header")), over: el.scrollHeight - el.clientHeight })));
		assert.ok(rows.length >= 3, JSON.stringify(rows));
		assert.deepEqual(rows.filter((r) => r.over > 0), [], "a sideways row overflows vertically");
		assert.equal(await page.inputValue("[data-slot=browser] input[aria-label=Address]"), "https://shop.example/");
		assert.deepEqual(await page.$eval("[data-slot=browser] canvas", (c: HTMLCanvasElement) => [c.width, c.height]), [400, 300]);
		// The app said that it shows the browser itself, so the agent's browser opens no window.
		await waitFor("the door was told that the app shows the browser", () => asked.some((a) => a.at === "/input" && a.body.ops.some((o: any) => o.do === "size")));
		const size = ops().find((o) => o.do === "size");
		const room = await page.$eval("[data-slot=browser] [data-slot=scroll-area]:has(canvas)", (el: Element) => ({ w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }));
		assert.deepEqual([size.w, size.h], [room.w, room.h], "the page is laid out for the room the panel has");
		// A page's title is text wherever it stands: nothing of it becomes part of this window.
		assert.match(await page.textContent("[data-slot=browser] [data-slot=tabs-trigger][aria-selected=true]"), /<img src=x onerror=window\.hacked=3>Okapi shop/);
		assert.equal(await page.evaluate(() => (window as any).hacked), undefined);
		await shot("05-browser");

		// A click in the picture is a click at that place in the page, whatever size the picture is drawn at.
		const box = await page.$eval("[data-slot=browser] canvas", (c: HTMLCanvasElement) => ({ x: c.getBoundingClientRect().left, y: c.getBoundingClientRect().top, k: c.width / c.getBoundingClientRect().width }));
		await page.mouse.click(box.x + 100, box.y + 60);
		await waitFor("the click arrived", () => ops().some((o) => o.do === "click"));
		const click = ops().find((o) => o.do === "click");
		assert.ok(Math.abs(click.x - 100 * box.k) <= 1 && Math.abs(click.y - 60 * box.k) <= 1 && click.button === "left", JSON.stringify(click));
		// Letters typed in a row go as one text, a key by its name, and what is pasted as text too.
		await page.keyboard.type("okapi");
		await page.keyboard.press("Enter");
		await page.keyboard.press("Meta+KeyA");
		await waitFor("what was typed arrived", () => ops().some((o) => o.do === "key" && o.key === "Meta+KeyA"));
		assert.equal(ops().filter((o) => o.do === "text").map((o) => o.text).join(""), "okapi");
		assert.ok(ops().filter((o) => o.do === "text").length < 5, "letters are not sent one by one");
		assert.deepEqual(ops().filter((o) => o.do === "key").map((o) => o.key), ["Enter", "Meta+KeyA"]);
		// The wheel adds up, a tab is chosen by a click, back is a button.
		await page.mouse.wheel(0, 120);
		await page.mouse.wheel(0, 120);
		await page.click("[data-slot=browser] [data-slot=tabs-trigger] >> nth=1");
		// A tab of the owner's own, and one closed.
		await page.click("[data-slot=browser] button[aria-label='A new tab']");
		// The tabs are drawn again once the new one is asked for: a click before that can land on a button that is gone.
		await waitFor("a new tab arrived", () => ops().some((o) => o.do === "newtab"));
		// The button to close a tab that is not in front shows under the pointer only. So the pointer goes to the tab
		// first, as the owner's does: a click forced onto the unseen button is sent wherever it was a moment ago.
		await page.hover("[data-slot=browser] [data-slot=tabs-trigger] >> nth=1");
		await page.click("[data-slot=browser] [data-slot=tabs-list] button[aria-label^='Close'] >> nth=1");
		await waitFor("a closed tab arrived", () => ops().some((o) => o.do === "closetab" && o.index === 1));
		await page.click("[data-slot=browser] button[aria-label='Back']");
		await waitFor("wheel, tab and back arrived", () => ["wheel", "tab", "back"].every((d) => ops().some((o) => o.do === d)));
		// (How far a turn of the wheel goes is the system's to say; that it went down, and all of it, is what counts.)
		assert.ok(ops().filter((o) => o.do === "wheel").reduce((sum, o) => sum + o.dy, 0) >= 240, JSON.stringify(ops().filter((o) => o.do === "wheel")));
		assert.equal(ops().find((o) => o.do === "tab").index, 1);
		// An address typed above the picture is opened by the daemon's hand, and a no is said.
		await page.fill("[data-slot=browser] input[aria-label=Address]", "localhost:5173");
		await page.press("[data-slot=browser] input[aria-label=Address]", "Enter");
		await waitFor("the address arrived", () => asked.some((a) => a.at === "/open"));
		assert.deepEqual(asked.find((a) => a.at === "/open")!.body, { url: "localhost:5173" });
		await sees("[data-slot=toast] >> text=the browser was refused that address");
		// The picture came through the app's own road for pictures, and the page asked the web for nothing.
		assert.equal(await page.evaluate(() => performance.getEntriesByType("resource").filter((r) => /^https?:/.test(r.name)).length), 0);

		// No page is open: what the agent opened here before is listed, as text, and a click opens it again.
		Object.assign(where, { open: false, tabs: [] });
		const db = new DatabaseSync(path.join(home, "data", "pine.db"));
		db.exec("PRAGMA busy_timeout = 5000");
		db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run("visited:main:main", JSON.stringify(["https://shop.example/<img src=x onerror=window.hacked=4>", "http://127.0.0.1:4173/"]));
		db.close();
		await sees("[data-slot=browser] [data-offer=visited] button >> nth=1");
		assert.deepEqual(await page.$$eval("[data-slot=browser] [data-offer=visited] button", (els: Element[]) => els.map((e) => e.textContent)), ["shop.example/<img src=x onerror=window.hacked=4>", "127.0.0.1:4173"]);
		assert.equal(await page.evaluate(() => (window as any).hacked), undefined);
		await shot("05-browser-empty");
		await page.click("[data-slot=browser] [data-offer=visited] button >> nth=1");
		await waitFor("the address the agent had opened arrived", () => asked.some((a) => a.at === "/open" && a.body.url === "http://127.0.0.1:4173/"));

		// Without a browser the view says so and draws nothing.
		fs.rmSync(file);
		await sees("[data-slot=browser] [data-slot=empty] >> text=No page is open");

		// The aside is as wide as it is dragged, by the edge before it, and after a restart it is open and as wide as it was.
		const asideWidth = () => page.$eval("#browser-panel", (el: Element) => Math.round(el.getBoundingClientRect().width));
		const was = await asideWidth();
		const edge = await page.$eval(BROWSER_EDGE, (el: Element) => el.getBoundingClientRect());
		await page.mouse.move(edge.x + edge.width / 2, 300);
		await page.mouse.down();
		await page.mouse.move(edge.x + edge.width / 2 - 40, 300, { steps: 4 });
		await page.mouse.up();
		assert.equal(await asideWidth(), was + 40);
		await page.reload();
		await sees("#browser-panel [data-slot=browser-aside]");
		assert.equal(await asideWidth(), was + 40);
		// Its own close button, the menu's item and /browser all toggle it.
		await page.click("[data-slot=browser-aside] button[aria-label='Close the browser']");
		await page.waitForSelector("[data-slot=browser-aside]", { state: "detached" });
		await sees(`${BROWSER_TOGGLE}[aria-pressed=false]`);
		await menu("browser");
		await sees("[data-slot=browser-aside]");
		await menu("browser");
		await page.waitForSelector("[data-slot=browser-aside]", { state: "detached" });
		await page.fill("[data-slot=composer] textarea", "/browser");
		await page.press("[data-slot=composer] textarea", "Enter");
		await sees("[data-slot=browser-aside]");
		await page.click(BROWSER_TOGGLE);
		await page.waitForSelector("[data-slot=browser-aside]", { state: "detached" });
		// The side panel shows no browser of its own any more.
		await page.fill("[data-slot=composer] textarea", "/code browser");
		await page.press("[data-slot=composer] textarea", "Enter");
		await sees("[data-slot=toast] >> text=The panel shows: agent, files, changes, turn, output, running, terminal.");
		// The agent puts its browser in front of the owner: the aside opens. (In a conversation of its own, so that main's stays as the tests after this one expect it.)
		const tabs = await page.locator("[data-slot=tab]").count();
		await menu("new");
		await page.waitForFunction((n) => document.querySelectorAll("[data-slot=tab]").length > n, tabs);
		await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "browser_show", args: {} }], text: "Have a look." }, { text: "There it is." }], "Show me the page. "));
		await page.keyboard.press("Enter");
		await sees("[data-slot=browser-aside]");
		await sees("[data-slot=markdown] >> text=There it is.");
		await menu("close");
		await page.waitForFunction((n) => document.querySelectorAll("[data-slot=tab]").length === n, tabs);
		// On a tab that is not a conversation, both toggles are there and cannot be pressed.
		await menu("settings");
		await sees(`${CODE_TOGGLE}[disabled]`);
		await sees(`${BROWSER_TOGGLE}[disabled]`);
		await menu("settings");
		await sees(`${BROWSER_TOGGLE}:not([disabled])`);
	} finally {
		// (The panels as they were, for the tests that follow.)
		await menu("code-agent");
		if (!had) await menu("code");
		if (await page.$("[data-slot=browser-aside]")) await menu("browser");
		await page.setViewportSize({ width: 1280, height: 820 });
		fs.rmSync(file, { force: true });
		door.close();
	}
});

test("a message is answered, with the turn's work folded into a line", async () => {
	const steps = [{ tools: [{ name: "read", args: { path: "notes.md" } }], text: "Let me look at the notes first." }, { text: "The notes say **first line**.\n\n```ts\nconst a = 1;\n```\n\n<details><summary>Full file</summary>\n\nfirst line\n\n</details>\n\n[the docs](https://example.com/docs)" }];
	await page.fill("[data-slot=composer] textarea", mockMsg(steps, "What do the notes say? "));
	await page.keyboard.press("Enter");
	await sees('[data-slot=markdown] [data-streamdown="strong"]');
	assert.match(await page.textContent("[data-slot=markdown]"), /first line/);
	// The work of the turn (what it said on the way, and the tool call) is one line, which a click opens.
	await page.waitForFunction(() => /1 tool call · read/.test(document.querySelector("[data-item=work] > [data-slot=trace-collapsible-trigger]")?.textContent ?? ""));
	assert.equal(await page.$("[data-item=work] [data-tool]"), null);
	await page.click("[data-item=work] > [data-slot=trace-collapsible-trigger]");
	await sees("[data-item=work] [data-tool]");
	assert.equal(await page.textContent("[data-item=work] [data-tool]"), "read");
	// A link says where it leads, and is not an address the page itself would follow.
	assert.equal(await page.textContent("[data-slot=markdown] [data-href]"), "the docs");
	assert.equal(await page.getAttribute("[data-slot=markdown] [data-href]", "data-href"), "https://example.com/docs");
	assert.match(await page.textContent("[data-slot=markdown] [data-href] + [data-target]"), /example\.com\/docs/);
	assert.equal(await page.$$eval("[data-slot=markdown] a[href]", (els: Element[]) => els.length), 0);
	// A folded part is there and closed.
	assert.equal(await page.getAttribute("[data-slot=markdown] [data-details] [data-slot=collapsible-trigger]", "aria-expanded"), "false");
	// Code is colored on the page, with its language and a copy button, and nothing to download.
	await page.waitForFunction(() => document.querySelectorAll('[data-slot=markdown] [data-streamdown="code-block"] span[style]').length > 0);
	assert.match(await page.textContent('[data-slot=markdown] [data-streamdown="code-block-header"]'), /ts/);
	assert.ok(await page.$('[data-slot=markdown] [data-streamdown="code-block"] button[title="Copy Code"], [data-slot=markdown] [data-streamdown="code-block"] button[aria-label="Copy Code"]'));
	assert.equal(await page.$$eval('[data-slot=markdown] [data-streamdown="code-block"] button[title*="ownload"], [data-slot=markdown] [data-streamdown="code-block"] button[aria-label*="ownload"]', (els: Element[]) => els.length), 0);
	await shot("02-answer");
});

/** Where focus is: the field's role, and the option it marks active, as a screen reader hears them. */
const activeOption = () =>
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
const named = (pattern: RegExp, is = true) =>
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
const inDialog = () =>
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
const confirm = async (title: string) => {
	await sees(title);
	await inDialog();
	await page.keyboard.press("Enter");
};

/** Tab stays inside the dialog: past its last stop, the dialog's focus guard hands focus back to its first (in the next frame). */
const stillInside = () => page.waitForFunction(() => Boolean(document.activeElement?.closest("[role=dialog]")) && !document.activeElement?.hasAttribute("data-base-ui-focus-guard"), undefined, { timeout: 2000 });

/** The text a dialog is announced by: what its aria-labelledby points at. */
const announced = (selector: string) =>
	page.$eval(selector, (d: Element) => (d.getAttribute("aria-labelledby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim());

test("a model is chosen from its picker with the keyboard alone, and focus goes back to the chip", async () => {
	const chip = "[data-slot=composer] button[aria-label^='Model:']";
	const focused = () => page.evaluate((s: string) => document.activeElement === document.querySelector(s), chip);
	await page.focus(chip);
	await page.keyboard.press("Enter");
	await sees("[data-slot=dialog-content] [role=listbox] [role=option]");
	await named(/mock\/m/);
	// It is announced by its title.
	assert.match(await announced("[data-slot=dialog-content]"), /^Model for main/);
	// Its models are options in a list, the one in use marked active, and Tab stays inside.
	const at = await activeOption();
	assert.deepEqual([at.inDialog, at.role, at.option, at.selected, at.list], [true, "combobox", "option", "true", true], JSON.stringify(at));
	assert.match(at.text, /mock\/m/);
	await page.keyboard.press("Tab");
	await stillInside();
	// Escape closes it, and focus is back on the chip.
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	assert.equal(await focused(), true);
	// Arrows move, Enter chooses.
	await page.keyboard.press("Enter");
	await sees("[data-slot=dialog-content] [role=listbox] [role=option]");
	await named(/mock\/m/);
	const count = await page.$$eval("[data-slot=dialog-content] [role=option]", (els: Element[]) => els.length);
	await page.keyboard.press("ArrowDown");
	if (count > 1) await named(/^mock\/m/, false);
	await page.keyboard.press("ArrowUp");
	await named(/mock\/m/);
	await page.keyboard.press("Enter");
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	assert.equal(await focused(), true);
	assert.match((await page.getAttribute(chip, "aria-label")) ?? "", /mock\/m/);
});

test("the reasoning is chosen from the composer's menu with the keyboard, and the agent keeps it", async () => {
	const trigger = "[data-slot=composer] button[aria-label^='Reasoning:']";
	const before = (await page.getAttribute(trigger, "aria-label")) ?? "";
	const wanted = before.startsWith("Reasoning: high,") ? "low" : "high";
	await page.focus(trigger);
	await page.keyboard.press("Enter");
	await sees("[role=menu] [role=menuitemradio][aria-checked=true]");
	// The first letter goes to the level, Enter chooses it.
	await page.keyboard.press(wanted[0]);
	await page.waitForFunction((v: string) => document.activeElement?.getAttribute("role") === "menuitemradio" && document.activeElement.textContent?.startsWith(v), wanted);
	await page.keyboard.press("Enter");
	await page.waitForSelector("[role=menu]", { state: "detached" });
	await page.waitForFunction((v: string) => document.querySelector("[data-slot=composer] button[aria-label^='Reasoning:']")?.getAttribute("aria-label")?.startsWith(`Reasoning: ${v},`), wanted);
	await sees(`text=now reasons at "${wanted}"`);
	assert.equal(await page.evaluate((s: string) => document.activeElement === document.querySelector(s), trigger), true);
});

test("an empty composer is drawn at full strength, and its send button says there is nothing to send", async () => {
	await page.fill("[data-slot=composer] textarea", "");
	const send = page.locator("[data-slot=composer] [data-slot=input-group]").getByRole("button", { name: "Send", exact: true });
	assert.equal(await send.getAttribute("aria-disabled"), "true");
	assert.equal(await page.$eval("[data-slot=composer] [data-slot=input-group]", (el: Element) => getComputedStyle(el).opacity), "1");
	// A click on it sends nothing (forced: to the driver, as to a screen reader, it is disabled).
	const asked = mock.state.requests.length;
	await send.click({ force: true });
	await new Promise((r) => setTimeout(r, 200));
	assert.equal(mock.state.requests.length, asked);
	await page.fill("[data-slot=composer] textarea", "something");
	assert.notEqual(await send.getAttribute("aria-disabled"), "true");
	await page.fill("[data-slot=composer] textarea", "");
});

test("the context meter turns to a warning past two thirds, and to danger past 85%", async () => {
	const meter = "[data-slot=conversation-head] [data-slot=hover-card-trigger]";
	for (const [percent, tone] of [[70, "warn"], [86, "bad"]] as const) {
		await page.fill("[data-slot=composer] textarea", mockMsg([{ text: `full to ${percent}` }], `the context at ${percent}% `));
		await page.keyboard.press("Enter");
		await sees(`${meter}[data-tone=${tone}] >> text=${percent}%`);
	}
	// A conversation that has room again is drawn as before.
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "room again" }], "small "));
	await page.keyboard.press("Enter");
	await sees(`${meter}:not([data-tone])`);
});

test("what an answer points at on the web is not fetched by itself, and what it writes as HTML is cleaned", async () => {
	// A picture the page tried to load from an address the policy refuses would be said here.
	await page.evaluate(() => {
		(window as any).refused = [];
		document.addEventListener("securitypolicyviolation", (e) => (window as any).refused.push(e.blockedURI));
	});
	const dot = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
	const text = [
		"Look: ![a cat](https://example.com/cat.png)",
		'<img src="https://example.com/dog.png">',
		`A dot: ![dot](data:image/png;base64,${dot})`,
		"In the workspace: ![the plan](plan.png)",
		'<script>window.hacked = 1</script><a href="javascript:window.hacked=2">x</a> and [y](javascript:window.hacked=3)',
		'<div style="color: red" class="evil" id="evil" data-x="1" aria-label="evil" onclick="window.hacked=4">styled</div>',
		'<style>body { display: none }</style><form action="https://example.com"><input name="q"><button>go</button></form>',
		'<iframe src="https://example.com"></iframe><svg><circle r="5"></circle></svg><video src="https://example.com/v.mp4"></video><object data="x"></object>',
		"| a | b |\n|---|---|\n| 1 | 2 |",
		"Read [the docs](https://example.com/docs).",
	].join("\n\n");
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text }], "pictures "));
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] [data-remote]");
	const md = page.locator("[data-slot=markdown]", { hasText: "A dot" }).last();
	// A picture on the web is a line to click, with its address, and the page asks for nothing.
	assert.equal(await md.locator("[data-remote]").count(), 2);
	assert.match(await md.locator("[data-remote]").first().textContent(), /Load picture · https:\/\/example\.com\/cat\.png/);
	assert.equal(await md.locator('img[src^="http"]').count(), 0);
	// A small picture in the text itself is shown, and one in the workspace comes from the daemon.
	assert.equal(await md.locator('img[src^="data:image/png"]').count(), 1);
	assert.match((await md.locator('img[alt="the plan"]').getAttribute("src")) ?? "", /^pine-media:\/\/daemon\/.*plan\.png/);
	// Nothing to download a picture with.
	assert.equal(await md.locator('button[title*="ownload"], button[aria-label*="ownload"]').count(), 0);
	// What could act or restyle is gone, and the words stay. The one svg allowed is pine's own arrow beside a link.
	assert.equal(await page.evaluate(() => (window as any).hacked), undefined);
	assert.equal(await md.locator("script, style, form, input, button:not([data-remote]), iframe, svg:not([data-target] > svg), video, object, a[href]").count(), 0);
	assert.equal(await md.locator('[class~="evil"], #evil, [data-x], [aria-label="evil"], [onclick]').count(), 0);
	assert.equal(await md.getByText("styled", { exact: true }).evaluate((el: HTMLElement) => el.getAttribute("style")), null);
	assert.doesNotMatch(await md.textContent(), /display: none/);
	// A link on the web is no address the page could follow: it says where it leads, beside it.
	const link = md.locator("[data-href]");
	assert.equal(await link.getAttribute("data-href"), "https://example.com/docs");
	assert.match(await md.locator("[data-href] + [data-target]").textContent(), /example\.com\/docs/);
	// A table is kept in a box of its own that scrolls sideways.
	assert.equal(await md.locator("table").evaluate((t: HTMLElement) => getComputedStyle(t.parentElement!).overflowX), "auto");
	assert.deepEqual(await page.evaluate(() => (window as any).refused), []);
	await shot("02b-pictures");
});

const terminalText = () => page.$eval("[data-slot=terminal] .xterm-rows", (el: Element) => el.textContent ?? "").catch(() => "");
const terminalShows = (text: string) => page.waitForFunction((t) => (document.querySelector("[data-slot=terminal] .xterm-rows")?.textContent ?? "").includes(t), text, { timeout: 10_000 });

test("a shell block of an answer runs in the conversation's terminal with its button, and only as it is shown", async () => {
	const text = ["Run this:", "```bash\necho pine-ran-$((6*7))\n```", "Not this one:", "```ts\nconst a = 1;\n```", "Nor this:", "```sh\necho shown\u202Ehidden-ran\n```"].join("\n\n");
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text }], "commands "));
	await page.keyboard.press("Enter");
	const md = page.locator("[data-slot=markdown]", { hasText: "Run this" }).last();
	await md.locator("[data-run]").first().waitFor();
	// Only a block for a shell has the button, beside its copy button.
	assert.equal(await md.locator("[data-run]").count(), 2);
	assert.equal(await md.locator('[data-streamdown="code-block"]', { hasText: "const a = 1" }).locator("[data-run]").count(), 0);
	// The click opens the terminal beside the conversation, in its agent's workspace, and runs the block there.
	await md.locator("[data-run]").first().click();
	await sees("[data-slot=code-panel] [data-slot=terminal]");
	await terminalShows("pine-ran-42");
	assert.match(await page.textContent("[data-slot=terminal-cwd]"), /agents\/main\/workspace/);
	// When it has ended, the conversation is told how, in pine's words with the output quoted, and the agent goes on.
	const reported = () => mock.state.requests.find((r: any) => /\[pine: your owner ran a command from your answer in their terminal, and it has ended/.test(JSON.stringify(r.body.messages.at(-1))));
	for (let i = 0; i < 100 && !reported(); i++) await new Promise((r) => setTimeout(r, 100));
	const told = JSON.stringify(reported()?.body.messages.at(-1) ?? "");
	assert.match(told, /Command: echo pine-ran-\$\(\(6\*7\)\)/);
	assert.match(told, /finished without an error/);
	assert.match(told, /\| pine-ran-42/);
	// The terminal is the owner's: what is typed into it runs too.
	await page.click("[data-slot=terminal]");
	await page.keyboard.type("echo typed-$((1+1))");
	await page.keyboard.press("Enter");
	await terminalShows("typed-2");
	// A block that holds a character that does not show as itself is not typed.
	await md.locator("[data-run]").nth(1).click();
	await sees("[data-slot=toast] >> text=does not show as itself (U+202E)");
	await new Promise((r) => setTimeout(r, 200));
	assert.doesNotMatch(await terminalText(), /hidden-ran/);
	// Another view of the panel and back: the same shell, with what it printed.
	await menu("code-agent");
	await page.waitForSelector("[data-slot=terminal]", { state: "detached" });
	await menu("code-terminal");
	await terminalShows("typed-2");
	await shot("02c-terminal");
	await menu("code");
	await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
});

test("a folded part that was opened stays open while the answer goes on", async () => {
	const text = "<details><summary>More</summary>\n\nhidden part\n\n</details>\n\n" + "and the answer goes on. ".repeat(40);
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text, chunkDelayMs: 40 }], "fold "));
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown][data-live] [data-details] [data-slot=collapsible-trigger]");
	await page.click("[data-slot=markdown][data-live] [data-details] [data-slot=collapsible-trigger]");
	await page.waitForSelector('[data-slot=markdown] [data-details] [aria-expanded="true"]');
	await page.waitForFunction(() => !document.querySelector("[data-slot=markdown][data-live]"), undefined, { timeout: 20_000 });
	assert.equal(await page.locator("[data-slot=markdown]", { hasText: "hidden part" }).last().locator("[data-details] [data-slot=collapsible-trigger]").getAttribute("aria-expanded"), "true");
});

test("a picture opens over the page, and Escape closes it back onto the picture", async () => {
	const picture = await app.evaluate(({ nativeImage }: any) => nativeImage.createFromBitmap(Buffer.alloc(40 * 30 * 4, 180), { width: 40, height: 30 }).toPNG().toString("base64"));
	fs.writeFileSync(path.join(home, "agents", "main", "workspace", "okapi.png"), Buffer.from(picture, "base64"));
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "read", args: { path: "okapi.png" } }] }, { text: "an okapi" }], "picture "));
	await page.keyboard.press("Enter");
	const img = "[data-slot=message-scroller-content] img[data-slot=dialog-trigger]";
	await sees(img);
	await page.click(img);
	await sees("[data-slot=dialog-content][role=dialog] img");
	await page.keyboard.press("Escape");
	await page.waitForFunction(() => !document.querySelector("[data-slot=dialog-content]"));
	assert.equal(await page.evaluate((s: string) => document.activeElement === document.querySelector(s), img), true);
	// A press beside the picture closes it too.
	await page.click(img);
	await sees("[data-slot=dialog-content][role=dialog] img");
	await page.mouse.click(5, 5);
	await page.waitForFunction(() => !document.querySelector("[data-slot=dialog-content]"));
	// From the keyboard: Enter on the focused picture opens it, and Escape gives focus back to it.
	await page.focus(img);
	await page.keyboard.press("Enter");
	await sees("[data-slot=dialog-content][role=dialog] img");
	await page.keyboard.press("Escape");
	await page.waitForFunction(() => !document.querySelector("[data-slot=dialog-content]"));
	assert.equal(await page.evaluate((s: string) => document.activeElement === document.querySelector(s), img), true);
});

/** A wav file with one tone in it: one channel, 16 bits, 16000 samples a second. */
function tone(hz: number, seconds: number): Buffer {
	const rate = 16_000;
	const data = Buffer.alloc(Math.round(seconds * rate) * 2);
	for (let i = 0; i < data.length / 2; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 12_000), i * 2);
	const head = Buffer.alloc(44);
	head.write("RIFF", 0, "latin1");
	head.writeUInt32LE(36 + data.length, 4);
	head.write("WAVEfmt ", 8, "latin1");
	head.writeUInt32LE(16, 16);
	head.writeUInt16LE(1, 20);
	head.writeUInt16LE(1, 22);
	head.writeUInt32LE(rate, 24);
	head.writeUInt32LE(rate * 2, 28);
	head.writeUInt16LE(2, 32);
	head.writeUInt16LE(16, 34);
	head.write("data", 36, "latin1");
	head.writeUInt32LE(data.length, 40);
	return Buffer.concat([head, data]);
}

test("a sound in an answer that arrives plays by itself and shows its bars; a click pauses it, it goes on behind another tab, and one from earlier waits", async () => {
	// It plays for real: not out of the loudspeaker of whoever runs the tests.
	await app.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true));
	fs.writeFileSync(path.join(home, "agents", "main", "workspace", "hello.wav"), tone(440, 20));
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "Listen: ![hello world](hello.wav)\n\nAnd once more: ![the same again](hello.wav)" }], "sound "));
	await page.keyboard.press("Enter");
	const SOUND = "[data-slot=markdown] [data-slot=sound]";
	await sees(`${SOUND}[data-sound=playing]`);
	// The first sound of the answer, and that one alone.
	const lines = page.locator(SOUND);
	assert.equal(await lines.count(), 2);
	assert.equal(await lines.nth(0).getAttribute("data-sound"), "playing");
	assert.equal(await lines.nth(1).getAttribute("data-sound"), "idle");
	assert.match(await lines.nth(0).textContent(), /hello world/);
	// Its bars: one for each range of pitch, and for a tone at 440 Hz the ninth from the left stands highest.
	const bars = (n: number) => lines.nth(n).locator("[data-slot=sound-bars] > span").evaluateAll((all: HTMLElement[]) => all.map((b) => Number.parseFloat(b.style.height)));
	await page.waitForFunction((s: string) => [...document.querySelectorAll(`${s}[data-sound=playing] [data-slot=sound-bars] > span`)].some((b) => Number.parseFloat((b as HTMLElement).style.height) > 90), SOUND, { timeout: 20_000 });
	const playing = await bars(0);
	assert.equal(playing.length, 24);
	assert.equal(playing.indexOf(Math.max(...playing)), 8);
	assert.ok(playing[0] < 30 && playing[23] < 30, `the bars far from the tone lie low: ${playing}`);
	// Nothing plays there: its bars lie flat.
	assert.deepEqual(await bars(1), Array(24).fill(12.5));
	// The player's own clock runs, and says how long the sound is.
	const time = (n: number) => lines.nth(n).locator("[data-slot=sound-time]").textContent();
	await page.waitForFunction((s: string) => /^0:0[1-9] \/ 0:20$/.test(document.querySelector(`${s} [data-slot=sound-time]`)?.textContent ?? ""), SOUND, { timeout: 20_000 });
	// A click pauses: the clock and the bars stand still.
	await lines.nth(0).getByRole("button", { name: "Pause hello world" }).click();
	await sees(`${SOUND}[data-sound=paused]`);
	const stood = await time(0);
	await new Promise((r) => setTimeout(r, 300));
	assert.equal(await time(0), stood);
	assert.ok(Math.max(...(await bars(0))) > 90);
	// And goes on from there with another click.
	await lines.nth(0).getByRole("button", { name: "Play hello world" }).click();
	await sees(`${SOUND}[data-sound=playing]`);
	// One sound at a time: starting the other one stops this one, which is back at its start.
	await lines.nth(1).getByRole("button", { name: "Play the same again" }).click();
	await page.waitForFunction((s: string) => [...document.querySelectorAll(s)].map((l) => l.getAttribute("data-sound")).join() === "idle,playing", SOUND);
	assert.equal(await time(0), "0:20");
	assert.deepEqual(await bars(0), Array(24).fill(12.5));
	await shot("02c-sound");
	// It goes on while another tab is in front, and its line finds it again: still playing, further on.
	const front = await page.evaluate(() => [...document.querySelectorAll("[data-slot=tab]")].findIndex((t) => t.hasAttribute("data-active")));
	await menu("events");
	await page.waitForFunction((s: string) => !document.querySelector(s), SOUND);
	await menu("close");
	await page.click(`[data-slot=tab] >> nth=${front}`);
	await page.waitForFunction((s: string) => [...document.querySelectorAll(s)].map((l) => l.getAttribute("data-sound")).join() === "idle,playing", SOUND);
	await page.waitForFunction((s: string) => /^0:0[1-9] /.test(document.querySelectorAll(`${s} [data-slot=sound-time]`)[1]?.textContent ?? ""), SOUND, { timeout: 20_000 });
	assert.ok(Math.max(...(await bars(1))) > 90);
	await lines.nth(1).getByRole("button", { name: "Pause the same again" }).click();
	// The conversation opened again: the sounds are there, and none of them starts.
	await page.reload();
	await sees(SOUND);
	await page.waitForFunction((s: string) => [...document.querySelectorAll(`${s} [data-slot=sound-time]`)].filter((t) => t.textContent === "0:20").length === 2, SOUND);
	await new Promise((r) => setTimeout(r, 300));
	assert.equal(await page.locator(`${SOUND}:not([data-sound=idle])`).count(), 0);
});

test("an approval is asked in a dialog and answered from it, and so is a question", async () => {
	// The owner listed bash under "approve": it asks in every mode.
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "bash", args: { command: "echo hello" } }] }, { tools: [{ name: "question", args: { question: "Which database?", choices: ["the old one", "the new one"] } }] }, { text: "done" }], "run it "));
	await page.keyboard.press("Enter");
	await sees("[data-slot=dialog-content][data-tone=warn]");
	assert.match(await page.textContent("[data-slot=dialog-content][data-tone=warn]"), /Approval needed[\s\S]*echo hello/);
	await shot("03-approval");
	// What is at work is a grey dot that pulses, announced as working: here the line of the turn's work and the line
	// under the conversation (its tab and its row say ! instead). No spinner turns anywhere, and every dot is in step.
	const working = await page.locator("[data-slot=pulse][role=status][aria-label=Working]").count();
	assert.ok(working >= 2, `${working} dots at work`);
	assert.equal(await page.locator("[data-slot=spinner]").count(), 0);
	const beats = await page.$$eval("[data-slot=pulse]", (els: Element[]) => els.map((e) => (e as HTMLElement).getAnimations()[0]?.currentTime));
	assert.ok(beats.every((t) => t === beats[0]), `every dot at the same point of the beat: ${beats.join(", ")}`);
	await page.locator("[data-slot=dialog-content][data-tone=warn]").getByRole("button", { name: /^Allow/ }).click();
	await sees('[data-item="approval"][data-state="allowed"]');
	// Then the agent asks something: the answers it offers, the recommended one first.
	await sees("[data-slot=dialog-content][data-tone=accent]");
	assert.match(await page.textContent("[data-slot=dialog-content][data-tone=accent]"), /Which database\?[\s\S]*the old one[\s\S]*the new one/);
	await shot("03-question");
	await page.keyboard.press("2");
	await sees('[data-item="approval"][data-state="allowed"] >> text=Answered');
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await sees("[data-slot=markdown] >> text=done");
});

test("what is asked is answered from the conversation too: an approval by its buttons, a question by one of its answers", async () => {
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "bash", args: { command: "echo again" } }] }, { tools: [{ name: "question", args: { question: "Which color?", choices: ["green", "blue"] } }] }, { text: "answered from the line" }], "ask in line "));
	await page.keyboard.press("Enter");
	// The dialog is put off ("Later"); the request stays in the conversation, with what it is and why.
	await sees("[data-slot=dialog-content][data-tone=warn]");
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	const asked = '[data-item="approval"][data-state="open"] [data-slot="item"]';
	await sees(`${asked} >> text=Approval needed`);
	assert.match(await page.textContent(asked), /echo again/);
	await shot("03-confirmation");
	await page.click(`${asked} button:has-text("Allow once")`);
	await sees('[data-item="approval"][data-state="allowed"] >> text=Allowed');
	// The question offers its answers as suggestions; one click answers.
	await sees("[data-slot=dialog-content][data-tone=accent]");
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await sees(`${asked} >> text=Which color?`);
	await page.click(`${asked} button:has-text("blue")`);
	await sees('[data-item="approval"][data-state="allowed"] >> text=Answered');
	await sees("[data-slot=markdown] >> text=answered from the line");
});

test("a folder is opened for a conversation: changes, and a file edited and saved", async () => {
	// As the system does it when a folder is dropped on the app's icon.
	await app.evaluate(({ BrowserWindow }: any, dir: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", `folder:${dir}`), folder);
	// With several agents the app asks whose folder it is; the one in front is offered first.
	await confirm("[data-slot=dialog-title] >> text=Which agent works in");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=pine-desktop-folder");
	await page.click(CODE_TOGGLE);
	// The panel begins with the agent: who it is and what it runs on.
	await sees("[data-slot=code-panel] [data-slot=item-title] >> text=main");
	assert.match(await page.textContent("[data-slot=code-panel]"), /it administers pine[\s\S]*mock\/m[\s\S]*hands work to scout/);
	// The panel is as wide as it is dragged, by the edge before it, and the keyboard moves that edge too.
	const was = await page.$eval("[data-slot=code-panel]", (el: Element) => el.getBoundingClientRect().width);
	const edge = await page.$eval(CODE_EDGE, (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(edge.x + edge.width / 2, 300);
	await page.mouse.down();
	await page.mouse.move(edge.x + edge.width / 2 - 60, 300, { steps: 4 });
	await page.mouse.up();
	assert.equal(await page.$eval("[data-slot=code-panel]", (el: Element) => el.getBoundingClientRect().width), was + 60);
	await page.focus(`${CODE_EDGE}[role='separator']`);
	await page.keyboard.press("ArrowLeft");
	await page.waitForFunction((w) => document.querySelector("[data-slot=code-panel]")!.getBoundingClientRect().width > w, was + 60);
	// Loaded again, it is as wide as it was left (to the pixel).
	const wide = Math.round(await page.$eval("[data-slot=code-panel]", (el: Element) => el.getBoundingClientRect().width));
	await page.reload();
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=pine-desktop-folder");
	if (!(await page.$("[data-slot=code-panel]"))) await page.click(CODE_TOGGLE);
	await sees("[data-slot=code-panel]");
	assert.equal(Math.round(await page.$eval("[data-slot=code-panel]", (el: Element) => el.getBoundingClientRect().width)), wide);
	// However narrow the panel is, the names of its views stay whole on one line.
	// (On one line: no taller than the control's own height, 32 pixels.)
	assert.ok((await page.$eval("[data-slot=code-panel] [data-slot=tabs-trigger] >> text=Last turn", (b: Element) => b.getBoundingClientRect().height)) <= 32);
	await page.locator("[data-slot=code-panel]").getByRole("tab", { name: "Changes" }).click();
	// Its views are a tab list: the arrow keys move the choice, as in any segmented control.
	await page.keyboard.press("ArrowLeft");
	await sees("[data-slot=code-panel] [role=tab][aria-selected=true] >> text=Files");
	await page.keyboard.press("ArrowRight");
	await sees("[data-slot=code-panel] [role=tab][aria-selected=true] >> text=Changes");
	await sees("[data-slot=code-panel] [role=option]");
	assert.match(await page.textContent("[data-slot=code-panel] [role=option]"), /index\.ts/);
	await page.click("[data-slot=code-panel] [role=option]");
	await sees("[data-slot=code-block-line][data-variant=added]");
	assert.match(await page.textContent("[data-slot=code-block-line][data-variant=added]"), /answer = 42/);
	await shot("04-changes");
	// The editor: change the file and save it through the daemon.
	await page.locator("[data-slot=code-panel]").getByRole("button", { name: "Edit" }).click();
	await sees("[data-slot=code-panel] .cm-content");
	await page.click("[data-slot=code-panel] .cm-content");
	await page.keyboard.press("Meta+A");
	await page.keyboard.type("export const answer = 43;\n");
	await page.keyboard.press("Meta+S");
	for (let i = 0; i < 50 && !fs.readFileSync(path.join(folder, "src", "index.ts"), "utf8").includes("43"); i++) await new Promise((r) => setTimeout(r, 100));
	assert.equal(fs.readFileSync(path.join(folder, "src", "index.ts"), "utf8"), "export const answer = 43;\n");
	await shot("05-editor");
	// Leaving what was typed and not saved is asked in the app: staying keeps it, leaving drops it.
	await page.keyboard.type("// draft");
	await page.click("[data-slot=code-panel] button[aria-label='Back to the files']");
	await sees("[role=alertdialog] >> text=without saving");
	await page.locator("[role=alertdialog]").getByRole("button", { name: "Cancel" }).click();
	await page.waitForFunction(() => !document.querySelector("[role=alertdialog]"));
	assert.ok(await page.$("[data-slot=code-panel] .cm-content"));
	await page.click("[data-slot=code-panel] button[aria-label='Back to the files']");
	await page.locator("[role=alertdialog]").getByRole("button", { name: "Leave" }).click();
	await page.waitForFunction(() => !document.querySelector("[data-slot=code-panel] .cm-editor"));
	assert.equal(fs.readFileSync(path.join(folder, "src", "index.ts"), "utf8"), "export const answer = 43;\n");
});

const focused = () =>
	page.evaluate(() => {
		const el = document.activeElement as HTMLElement;
		return { role: el.getAttribute("role"), expanded: el.getAttribute("aria-expanded"), text: (el.querySelector("[data-slot=tree-label]") ?? el).textContent ?? "" };
	});

test("a file is opened from the panel's tree, its changes and its search with the keyboard alone", async () => {
	if (!(await page.$("[data-slot=code-panel]"))) await page.click(CODE_TOGGLE);
	// The test before left a file open in the editor.
	if (await page.$("[data-slot=code-panel] .cm-editor")) await page.click("[data-slot=code-panel] button[aria-label='Back to the files']");
	await page.locator("[data-slot=code-panel]").getByRole("tab", { name: "Files" }).click();
	await sees("[data-slot=code-panel] [role=tree] [role=treeitem]");
	// From the find field, Tab reaches the tree after the refresh button: one stop.
	await page.focus("[data-slot=code-panel] input[aria-label='Find a file']");
	await page.keyboard.press("Tab");
	await page.keyboard.press("Tab");
	assert.equal((await focused()).role, "treeitem");
	// Typing finds the folder, the right arrow opens it and goes in, Enter opens the file.
	await page.keyboard.type("src");
	assert.deepEqual([(await focused()).text.trim(), (await focused()).expanded], ["src", "false"]);
	await page.keyboard.press("ArrowRight");
	await page.waitForFunction(() => document.activeElement?.getAttribute("aria-expanded") === "true");
	await sees("[data-slot=code-panel] [role=treeitem] >> text=index.ts");
	await page.keyboard.press("ArrowRight");
	assert.match((await focused()).text, /index\.ts/);
	await page.keyboard.press("ArrowLeft");
	assert.deepEqual([(await focused()).text.trim(), (await focused()).expanded], ["src", "true"]);
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Enter");
	await sees("[data-slot=code-panel] .cm-content");
	assert.match(await page.textContent("[data-slot=code-panel] .cm-content"), /answer = 43/);
	await page.click("[data-slot=code-panel] button[aria-label='Back to the files']");
	// The file search's results are a list: Tab reaches it, Enter opens one.
	await page.fill("[data-slot=code-panel] input[aria-label='Find a file']", "index");
	await sees("[data-slot=code-panel] [role=listbox] [role=option] >> text=src/index.ts");
	await page.focus("[data-slot=code-panel] input[aria-label='Find a file']");
	await page.keyboard.press("Tab");
	await page.keyboard.press("Tab");
	assert.equal((await focused()).role, "option");
	await page.keyboard.press("Enter");
	await sees("[data-slot=code-panel] .cm-content");
	await page.click("[data-slot=code-panel] button[aria-label='Back to the files']");
	await page.fill("[data-slot=code-panel] input[aria-label='Find a file']", "");
	// So are the changes: Tab from the refresh button, Enter opens the diff.
	await page.locator("[data-slot=code-panel]").getByRole("tab", { name: "Changes" }).click();
	await sees("[data-slot=code-panel] [role=listbox] [role=option]");
	await page.focus("[data-slot=code-panel] button[aria-label='Read again']");
	await page.keyboard.press("Tab");
	assert.equal((await focused()).role, "option");
	await page.keyboard.press("Enter");
	await sees("[data-slot=code-panel] [data-slot=code-block]");
	await page.click("[data-slot=code-panel] button[aria-label='Back to the list']");
	await page.locator("[data-slot=code-panel]").getByRole("tab", { name: "Files" }).click();
});

/** The composer's field, and the suggestion it marks active, as a screen reader hears them. */
const composerState = () =>
	page.evaluate(() => {
		const field = document.querySelector("[data-slot=composer] textarea") as HTMLTextAreaElement;
		const id = field.getAttribute("aria-activedescendant");
		const option = id ? document.getElementById(id) : null;
		return { focused: document.activeElement === field, value: field.value, controls: Boolean(field.getAttribute("aria-controls")), option: option?.getAttribute("role"), text: option?.textContent ?? "" };
	});
const suggestion = "[role=listbox] [role=option][data-slot=combobox-item]";

test("a command is picked from the composer's suggestions with the arrows and Enter, and the input keeps focus", async () => {
	const area = "[data-slot=composer] textarea";
	await page.fill(area, "");
	await page.focus(area);
	await page.keyboard.type("/");
	await sees(suggestion);
	const names = await page.$$eval(`${suggestion} [data-part=label]`, (els: Element[]) => els.map((e) => e.textContent ?? ""));
	assert.ok(names.length > 2, JSON.stringify(names));
	// Arrows move the highlight, announced on the field, and focus stays in it.
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowUp");
	let at = await composerState();
	assert.deepEqual([at.focused, at.controls, at.option], [true, true, "option"], JSON.stringify(at));
	assert.equal(at.text.split(" ")[0], names[1].split(" ")[0]);
	await page.keyboard.press("Enter");
	await page.waitForSelector(suggestion, { state: "detached" });
	at = await composerState();
	assert.equal(at.value, `${names[1].split(" ")[0]} `);
	assert.equal(at.focused, true);
	// Escape dismisses the list and keeps the text.
	await page.fill(area, "");
	await page.keyboard.type("/");
	await sees(suggestion);
	await page.keyboard.press("Escape");
	await page.waitForSelector(suggestion, { state: "detached" });
	assert.equal((await composerState()).value, "/");
	// A command typed out whole is run by Enter, not picked again.
	await page.fill(area, "");
	await page.keyboard.type("/copy");
	await sees(suggestion);
	await page.keyboard.press("Enter");
	await page.waitForSelector(suggestion, { state: "detached" });
	assert.equal((await composerState()).value, "");
});

test("a file of the conversation's folder is mentioned with @, picked from the suggestions", async () => {
	const area = "[data-slot=composer] textarea";
	await page.fill(area, "");
	await page.focus(area);
	await page.keyboard.type("look at @indx");
	await sees(`${suggestion} >> text=src/index.ts`);
	// Escape closes the list and keeps the text; typing on brings it back, and a click picks.
	await page.keyboard.press("Escape");
	await page.waitForSelector(suggestion, { state: "detached" });
	assert.equal((await composerState()).value, "look at @indx");
	await page.keyboard.type(".");
	await sees(`${suggestion} >> text=src/index.ts`);
	await page.locator("[role=listbox]").getByRole("option", { name: "src/index.ts" }).click();
	await page.waitForSelector(suggestion, { state: "detached" });
	let at = await composerState();
	assert.deepEqual([at.value, at.focused], ["look at @src/index.ts ", true], JSON.stringify(at));
	// Tab picks the highlighted one too.
	await page.keyboard.type("and @indx");
	await sees(`${suggestion} >> text=src/index.ts`);
	await page.keyboard.press("Tab");
	await page.waitForSelector(suggestion, { state: "detached" });
	at = await composerState();
	assert.deepEqual([at.value, at.focused], ["look at @src/index.ts and @src/index.ts ", true], JSON.stringify(at));
	await page.fill(area, "");
});

test("settings: a setting is changed, an agent made, a schedule added, a provider signed in to, a skill and a source added", async () => {
	await menu("settings");
	await sees("[data-slot=settings-page] h1 >> text=General");
	// The settings are a tab like any other, beside the conversations.
	assert.equal(await page.textContent("[data-slot=tab][data-active] [data-slot=tab-name]"), "Settings");
	assert.ok((await page.$$eval("[data-slot=tab]", (els: Element[]) => els.length)) >= 3);
	await sees("[data-slot=field-label] [data-slot=tooltip-trigger] >> text=limits.maxDownloadMb");
	// A setting is called by a few words; its key stands beside them. What only tunes pine is not on the page.
	assert.match(await page.locator("[data-slot=field]", { has: page.locator("[data-slot=tooltip-trigger]", { hasText: /^limits\.maxDownloadMb$/ }) }).locator("[data-slot=field-label]").textContent(), /^Largest download/);
	assert.doesNotMatch(await page.textContent("[data-slot=settings-page]"), /warmSlots|slotPages|catalogue|maxDelegationDepth/);
	await shot("06-settings-general");
	// A setting of pine's: checked by the daemon, written into pine.json, in force at once.
	const limit = page.locator("[data-slot=field]", { has: page.locator("[data-slot=tooltip-trigger]", { hasText: /^limits\.maxDownloadMb$/ }) }).locator("input");
	await limit.fill("123");
	await limit.press("Enter");
	await page.waitForFunction(() => [...document.querySelectorAll("[data-slot=toast]")].some((t) => /limits\.maxDownloadMb is now 123/.test(t.textContent ?? "")));
	assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).limits.maxDownloadMb, 123);
	// One that cannot be is refused, and the file stays as it is.
	await limit.fill("0");
	await limit.press("Enter");
	await page.waitForFunction(() => [...document.querySelectorAll("[data-slot=toast][data-type=error]")].some((t) => /whole number from 1/.test(t.textContent ?? "")));
	assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).limits.maxDownloadMb, 123);
	// A setting chosen from a list is chosen with the keyboard alone: Escape closes the list and gives
	// focus back to it, Enter opens it, the arrows move, Enter chooses.
	const reasoning = page.locator("[data-slot=field]", { has: page.locator("[data-slot=tooltip-trigger]", { hasText: /^defaults\.thinking$/ }) }).locator("[role=combobox]");
	const list = "[data-slot=select-content][data-open]";
	await reasoning.focus();
	await page.keyboard.press("Enter");
	await sees(`${list} [role=option][data-highlighted]`);
	await page.keyboard.press("Escape");
	await page.waitForSelector(list, { state: "detached" });
	assert.equal(await reasoning.evaluate((el: Element) => el === document.activeElement), true);
	await page.keyboard.press("Enter");
	await sees(`${list} [role=option][data-highlighted]`);
	const before = await page.textContent(`${list} [role=option][data-highlighted]`);
	await page.keyboard.press(before?.trim() === "off" ? "ArrowDown" : "Home");
	const chosen = (await page.textContent(`${list} [role=option][data-highlighted]`))?.trim();
	assert.notEqual(chosen, before?.trim());
	await page.keyboard.press("Enter");
	await page.waitForFunction((v) => [...document.querySelectorAll("[data-slot=toast]")].some((t) => t.textContent?.includes(`defaults.thinking is now ${v}`)), chosen);
	assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).defaults.thinking, chosen);
	assert.equal(await reasoning.evaluate((el: Element) => el === document.activeElement), true);
	// Agents: make one.
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=Agents");
	await page.locator("[data-slot=settings-page]").getByRole("button", { name: "New agent" }).click();
	await page.fill("[data-slot=dialog-content] [data-slot=field]:nth-of-type(1) input", "books");
	await page.fill("[data-slot=dialog-content] textarea", "You are books. You keep the books.\n\nYou answer in one line.");
	await page.locator("[data-slot=dialog-content]").getByRole("button", { name: "Create agent" }).click();
	await sees("[data-slot=settings-page] h1 >> text=books");
	assert.ok(fs.existsSync(path.join(home, "agents", "books", "agent.json")));
	// What it is for is the first paragraph of its instructions, and nothing else keeps it.
	assert.equal("description" in JSON.parse(fs.readFileSync(path.join(home, "agents", "books", "agent.json"), "utf8")), false);
	await sees("[data-slot=sidebar-menu-item] >> text=You are books. You keep the books.");
	// It is in the side bar at once, with the others.
	assert.deepEqual(await page.$$eval("[data-slot=agent-label] > :first-child", (els: Element[]) => els.map((e) => e.textContent?.trim())), ["main", "scout", "books"]);
	await shot("07-settings-agent");
	// Events: a schedule.
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=Events");
	await page.locator("[data-slot=settings-page]").getByRole("tab", { name: "Schedules" }).click();
	await page.locator("[data-slot=settings-page]").getByRole("button", { name: "New schedule" }).click();
	const scheduleForm = page.locator("[data-slot=dialog-content]");
	await scheduleForm.getByLabel("Times").fill("0 7 * * *");
	await scheduleForm.getByLabel("With the task").fill("Say good morning.");
	await scheduleForm.getByLabel("Name", { exact: true }).fill("morning");
	await scheduleForm.getByRole("button", { name: "Add schedule" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await sees("[data-slot=settings-page] [data-slot=item-title] >> text=morning");
	await sees("[data-slot=settings-page] [data-slot=item-description] >> text=wake every agent, each in its main conversation");
	assert.match(fs.readFileSync(path.join(home, "pine.json"), "utf8"), /"morning"/);
	await shot("08-settings-schedules");
	// Events: a route, as When and Then. Only the fields of the action chosen are shown, and only they are sent.
	await page.locator("[data-slot=settings-page]").getByRole("tab", { name: "Routes" }).click();
	await sees("[data-slot=settings-page] [data-slot=empty] >> text=No routes");
	await page.locator("[data-slot=settings-page]").getByRole("button", { name: "New route" }).click();
	const routeForm = page.locator("[data-slot=dialog-content]");
	await routeForm.getByLabel("An event arrives on").fill("source/house/message");
	await routeForm.getByLabel("Only if").fill('{"payload.topic": "house/mode"}');
	await routeForm.getByRole("textbox", { name: "Telling it" }).fill("left behind under another action");
	await routeForm.getByRole("button", { name: "Set shared state" }).click();
	assert.equal(await routeForm.getByLabel("Agent", { exact: true }).count(), 0);
	await routeForm.getByLabel("Shared state").fill('{"house/mode": "{{payload.value}}"}');
	await routeForm.getByLabel("Name", { exact: true }).fill("mode");
	await routeForm.getByRole("button", { name: "Add route" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await sees("[data-slot=settings-page] [data-slot=item-description] >> text=set house/mode to");
	const route = JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).routes.find((r: { name: string }) => r.name === "mode");
	assert.deepEqual(route, { name: "mode", on: "source/house/message", when: { "payload.topic": "house/mode" }, set: { "house/mode": "{{payload.value}}" } });
	await shot("08b-settings-routes");
	// Models: sign in to a provider with a key. It is typed into a field of its own and not shown.
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=Models");
	await page.locator("[data-slot=settings-page] h2").getByRole("button", { name: /Show all/ }).click();
	const row = page.locator("[data-slot=settings-page] [data-slot=item]", { has: page.locator("[data-slot=badge]", { hasText: /^opencode$/ }) }).first();
	await row.getByRole("button", { name: "API key" }).click();
	await sees("[data-slot=dialog-content] input[type=password]");
	await page.fill("[data-slot=dialog-content] input[type=password]", "sk-test-not-a-real-key-0123456789");
	await page.locator("[data-slot=dialog-content]").getByRole("button", { name: "Continue" }).click();
	await sees("[data-slot=dialog-content] [data-slot=alert][data-tone=good]");
	assert.doesNotMatch(await page.textContent("[data-slot=dialog-content]"), /sk-test-not-a-real-key/);
	await shot("09-settings-sign-in");
	assert.match(fs.readFileSync(path.join(home, "auth.json"), "utf8"), /opencode/);
	// A sign-in changes no agent's model, so the dialog offers the new ones for all agents.
	await page.locator("[data-slot=dialog-content]").getByRole("button", { name: "Choose the model your agents run on" }).click();
	await sees("[data-slot=dialog-title] >> text=Model for every agent that has none of its own");
	const offered = await page.$$eval("[data-slot=command-item] > :first-child", (els: Element[]) => els.map((e) => e.textContent ?? ""));
	assert.ok(offered.length > 0 && offered.every((m) => m.startsWith("opencode/")), JSON.stringify(offered.slice(0, 5)));
	await page.click("[data-slot=command-item] >> nth=0");
	await sees(`[data-slot=toast] >> text=Your agents now run on ${offered[0]}`);
	assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).defaults.model, offered[0]);
	await sees(`[data-setting=fallback-model] [data-slot=item-title] >> text=${offered[0]}`);
	// Signed out again, that model cannot answer: the page says so for each agent it leaves without
	// one, and so does the welcome of such an agent's conversation, with the way to this page.
	const signedIn = page.locator("[data-slot=settings-page] [data-slot=item]", { has: page.locator("[data-slot=badge]", { hasText: /^opencode$/ }) }).first();
	await signedIn.getByRole("button", { name: "Sign out" }).click();
	await sees("[role=alertdialog] [data-slot=alert-dialog-title] >> text=/^Sign out of /");
	await page.locator("[role=alertdialog]").getByRole("button", { name: "Sign out" }).click();
	await sees("[data-slot=item-group] [data-slot=alert] >> text=/main cannot answer: .* needs a sign-in to opencode/");
	await page.click("[data-slot=tab]:has-text('pine-desktop-folder')");
	await sees("[data-slot=empty] [data-slot=alert] >> text=/needs a sign-in to opencode/");
	await shot("09-no-model");
	await page.locator("[data-slot=empty] [data-slot=alert]").getByRole("button", { name: "Models" }).click();
	await sees("[data-slot=settings-page] h1 >> text=Models");
	// "Change" offers every model that can be used now.
	await page.locator("[data-setting=fallback-model]").getByRole("button", { name: "Change" }).click();
	await sees("[data-slot=dialog-title] >> text=Model for every agent that has none of its own");
	await page.getByRole("option", { name: "mock/m" }).click();
	await sees("[data-slot=toast] >> text=Your agents now run on mock/m");
	await page.waitForSelector("[data-slot=item-group] [data-slot=alert]", { state: "detached" });
	assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).defaults.model, "mock/m");
	// MCP servers: a remote one is added, pine says whether it connects, and "Sign in" runs pi's own
	// sign-in for it (which for a server that wants none says so; a browser opens only where one is needed).
	const remote = await httpMcp({});
	try {
		await page.click("[role=navigation] [data-sidebar=menu-button] >> text=MCP servers");
		await page.fill("input[placeholder='home_link']", "notes");
		await page.fill("input[placeholder='https://mcp.example.com/mcp']", remote.url);
		await page.locator("[data-slot=settings-page]").getByRole("button", { name: "Add server" }).click();
		const server = page.locator("[data-slot=settings-page] [data-slot=item]", { has: page.locator("[data-slot=item-title]", { hasText: /^notes/ }) });
		await server.waitFor({ timeout: 15_000 });
		await page.waitForFunction(() => /connected, 1 tool/.test(document.querySelector("[data-slot=settings-page] [data-slot=item-group]")?.textContent ?? ""), undefined, { timeout: 30_000 });
		await server.getByRole("button", { name: "Sign in" }).click();
		await sees("[data-slot=code-block-content] >> text=/signed in to MCP server .notes./i", 40_000);
		await shot("09-settings-mcp-sign-in");
		assert.match(fs.readFileSync(path.join(home, "pine.json"), "utf8"), /"notes"/);
		// And taken out again: the file is as it was.
		await server.getByRole("button", { name: "Remove" }).click();
		await sees("[role=alertdialog] >> text=Remove the MCP server notes?");
		// Asked in an alert dialog, announced by its question; Escape closes it onto the button, and nothing is removed.
		assert.equal(await announced("[role=alertdialog]"), "Remove the MCP server notes?");
		await page.locator("[role=alertdialog]").evaluate((el: Element) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
		await shot("09-settings-confirm");
		await page.keyboard.press("Escape");
		await page.waitForSelector("[role=alertdialog]", { state: "detached" });
		assert.equal(await server.locator("[data-slot=alert-dialog-trigger] >> text=Remove").evaluate((b: Element) => b === document.activeElement), true);
		assert.match(fs.readFileSync(path.join(home, "pine.json"), "utf8"), /"notes"/);
		await server.getByRole("button", { name: "Remove" }).click();
		await sees("[role=alertdialog] >> text=Remove the MCP server notes?");
		await page.locator("[role=alertdialog]").getByRole("button", { name: "Remove" }).click();
		await server.waitFor({ state: "detached", timeout: 15_000 });
		assert.doesNotMatch(fs.readFileSync(path.join(home, "pine.json"), "utf8"), /"notes"/);
	} finally {
		await remote.close();
	}
	// Skills: one is written down for all agents.
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=Skills");
	await page.locator("[data-slot=settings-page]").getByRole("button", { name: "New skill" }).click();
	await page.fill("input[placeholder='invoices']", "invoices");
	await page.fill("[data-slot=settings-page] textarea", "File an invoice. Use when a bill arrives.");
	await page.click("[data-slot=settings-page] .cm-content");
	await page.keyboard.type("1. Read the bill.");
	await page.locator("[data-slot=settings-page]").getByRole("button", { name: "Save skill" }).click();
	await sees("[data-slot=settings-page] [data-slot=item-title] >> text=invoices");
	assert.match(fs.readFileSync(path.join(home, "skills", "invoices", "SKILL.md"), "utf8"), /Read the bill/);
	// Events: a folder to watch, set up from the type's own options.
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=Events");
	await page.locator("[data-slot=settings-page]").getByRole("button", { name: "New source" }).click();
	await page.fill("[data-slot=dialog-content] input[placeholder='scans']", "scans");
	await page.locator("[data-slot=dialog-content]").getByRole("combobox", { name: "Type", exact: true }).click();
	await page.getByRole("option", { name: /^folder:/ }).click();
	// Chosen with a click, the list closes and stays closed.
	await page.waitForSelector("[data-slot=select-content][data-open]", { state: "detached" });
	const watched = path.join(folder, "scans");
	fs.mkdirSync(watched, { recursive: true });
	await page.locator("[data-slot=dialog-content] [data-slot=field]", { has: page.locator("[data-slot=field-label]", { hasText: /^dir/ }) }).locator("input").fill(watched);
	await shot("09-settings-new-source");
	await page.locator("[data-slot=dialog-content]").getByRole("button", { name: "Continue" }).click();
	await sees("[data-slot=dialog-content] >> text=will:");
	await page.locator("[data-slot=dialog-content]").getByRole("button", { name: "Add source" }).click();
	await sees("[data-slot=settings-page] [data-slot=item-title] >> text=scans");
	assert.match(fs.readFileSync(path.join(home, "pine.json"), "utf8"), /"scans"/);
	await shot("09-settings-sources");
	for (const [nav, title] of [["Models", "Models"], ["MCP servers", "MCP servers"], ["Skills", "Skills"], ["Instructions", "Instructions"], ["App", "App"]]) {
		await page.click(`[role=navigation] [data-sidebar=menu-button] >> text=${nav}`);
		await sees(`[data-slot=settings-page] h1 >> text=${title}`);
		await page.waitForTimeout(400);
		await shot(`09-settings-${nav.toLowerCase().replace(/\s+/g, "-")}`);
	}
	// App: the browser of the web tools is still not there, and can be fetched from here. (The
	// test fetches nothing: PINE_SKIP_DOWNLOADS. What the command printed is shown.)
	await sees("[data-setting=browser] [data-slot=badge][data-variant=outline] >> text=not on this Mac");
	await page.locator("[data-setting=browser]").getByRole("button", { name: "Fetch it" }).click();
	await sees("[data-setting=browser] [data-slot=code-block-content] >> text=Not fetched: PINE_SKIP_DOWNLOADS is set.");
	// Fetched some other way (a terminal): the page says so when it is opened again.
	const { browserPlaces } = await import("../../src/browser-build.ts");
	const places = (await browserPlaces()) ?? [];
	for (const place of places) write(path.join(browsers, path.basename(place), "INSTALLATION_COMPLETE"), "");
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=Models");
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=App");
	await sees("[data-setting=browser] [data-slot=badge][data-variant=default] >> text=on this Mac");
	await menu("settings");
});

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
/** The color a CSS color value resolves to in the page, read from an element of the test's own. */
const resolved = (value: string) =>
	page.evaluate((v: string) => {
		const probe = document.body.appendChild(document.createElement("div"));
		probe.style.backgroundColor = v;
		const color = getComputedStyle(probe).backgroundColor;
		probe.remove();
		return color;
	}, value);
/** The alpha of a computed color: rgba(..., a), color(srgb ... / a), or 1. */
const alphaOf = (color: string) => Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(color)?.[1] ?? /\/\s*([\d.]+)\)/.exec(color)?.[1] ?? 1);
/** The theme the window is drawn in, by its name (theme.ts sets it on the root element). */
const themeIs = (id: string) => page.waitForFunction((t: string) => document.documentElement.dataset.theme === t, id, { timeout: 10_000 });
/** The tab in front: drawn in the page color of the theme. */
const tabColor = () => page.evaluate(() => getComputedStyle(document.querySelector("[data-slot=tab][data-active]")!).backgroundColor);

test("the window is drawn in pmndre, the theme pine names when pine.json names none, with pine's own colors", { skip: Boolean(process.env.PINE_DESKTOP_THEME) }, async () => {
	await themeIs("pmndre");
	assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), true);
	assert.equal(await tabColor(), rgb("#1b1e28"));
	assert.equal(await resolved("var(--primary)"), rgb("#5de4c7"), "the accent is pmndre's mint");
	assert.equal(await resolved("var(--foreground)"), rgb("#e4f0fb"));
	assert.equal(await resolved("var(--border)"), rgb("#2b2e3c"));
	// What has the keyboard is grey, never the accent; the side bar lets the Mac's window material show through.
	assert.equal(await resolved("var(--ring)"), rgb("#767c9d"));
	const side = await resolved("var(--sidebar)");
	assert.ok(alphaOf(side) > 0 && alphaOf(side) < 1, `the side bar is translucent, not ${side}`);
	// pine put its set of themes into the home that had none.
	assert.ok(fs.existsSync(path.join(home, "themes", "pmndre.json")) && fs.existsSync(path.join(home, "themes", "github-light.json")));
});

test("a theme picked in Settings draws the window and is pine's setting; a VS Code theme dropped into the folder is offered; another hand's choice is followed", async () => {
	const pick = async (name: string) => {
		await page.click("[data-setting=theme] [data-slot=select-trigger]");
		await page.click(`[role=option]:has-text("${name}")`);
	};
	// A theme of the owner's own, as VS Code writes them (comments, a trailing comma), and a file that is no theme.
	write(path.join(home, "themes", "mine.json"), `// my theme
{
	"name": "Mine",
	"type": "dark",
	"colors": { "editor.background": "#102030", "editor.foreground": "#e0e0e0", "button.background": "#ff8800", },
	"tokenColors": [{ "scope": "keyword", "settings": { "foreground": "#ff00aa" } }],
}`);
	write(path.join(home, "themes", "broken.json"), `{ "name": "Broken", "colors": {} }`);
	try {
		await menu("settings");
		await page.locator("[role=navigation]").getByRole("button", { name: "App", exact: true }).click();
		await sees("[data-setting=theme]");
		await sees("text=broken.json: it names no color for the page");

		await pick("GitHub Light Default");
		await themeIs("github-light");
		assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), false);
		assert.equal(await tabColor(), rgb("#ffffff"));
		assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).ui.theme, "github-light");
		// The app keeps it, to open in it next time.
		const prefs = () => JSON.parse(fs.readFileSync(path.join(home, "desktop-data", "prefs.json"), "utf8"));
		assert.equal(prefs().look?.id, "github-light");

		await pick("Mine");
		await themeIs("mine");
		assert.equal(await tabColor(), rgb("#102030"));
		assert.equal(await resolved("var(--primary)"), rgb("#ff8800"));
		assert.equal(await resolved("var(--code-keyword)"), rgb("#ff00aa"));

		// Another hand (the main agent's set_setting, another UI) changes it through pine: the window follows.
		await api("POST", "/settings", { key: "ui.theme", value: "dracula" });
		await themeIs("dracula");
		assert.equal(await tabColor(), rgb("#282a36"));
		// A theme pine cannot draw is not taken.
		const refused = await api("POST", "/settings", { key: "ui.theme", value: "broken" });
		assert.equal(refused.ok, false);
		await menu("settings");
	} finally {
		await api("POST", "/settings", { key: "ui.theme", value: process.env.PINE_DESKTOP_THEME ?? "default" });
		await themeIs(process.env.PINE_DESKTOP_THEME ?? "pmndre");
		fs.rmSync(path.join(home, "themes", "mine.json"), { force: true });
		fs.rmSync(path.join(home, "themes", "broken.json"), { force: true });
	}
});

test("the side bar is the agents: one made elsewhere appears, a group folds away, and what is new says for whom", async () => {
	// An agent that another hand makes (the main agent, a `pine agent add`): asked of the daemon directly, not through the app.
	const port = /http listening on 127\.0\.0\.1:(\d+)/.exec(fs.readFileSync(path.join(home, "data", "pine.log"), "utf8"))![1];
	const token = fs.readFileSync(path.join(home, "data", "http-token"), "utf8").trim();
	const made = await fetch(`http://127.0.0.1:${port}/agents`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ id: "test", description: "Made outside the app", instructions: "You are test." }) });
	assert.equal(made.status, 200);
	await sees("[data-slot=agent-label] >> text=test", 20_000);
	assert.match((await page.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { has: page.locator("[data-slot=agent-label] > :first-child", { hasText: /^test$/ }) }).textContent()) ?? "", /Made outside the app/);
	// Beside a conversation, the panel's Agent view says what the agent has been given: here what was set up for all agents above.
	await page.click("[data-slot=tab] >> nth=0");
	if (!(await page.$("[data-slot=code-panel]"))) await page.click(CODE_TOGGLE);
	await page.locator("[data-slot=code-panel]").getByRole("tab", { name: "Agent" }).click();
	await sees("[data-slot=code-panel] [data-slot=item-title] >> text=invoices");
	await sees("[data-slot=code-panel] [data-slot=item-title] >> text=morning");
	assert.match(await page.textContent("[data-slot=code-panel]"), /Nothing wakes it by itself\. 1 event source could/);
	await shot("14-agent-view");
	// On an agent's line, its initial stands beside its name, not half-way down to its description.
	const line = await page.$eval("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", (el: Element) => ({ avatar: el.querySelector("[data-slot=avatar]")!.getBoundingClientRect(), name: el.querySelector("[data-slot=agent-label] > :first-child")!.getBoundingClientRect() }));
	assert.ok(Math.abs(line.avatar.y + line.avatar.height / 2 - (line.name.y + line.name.height / 2)) <= 2, JSON.stringify(line));
	// A conversation's name begins where its agent's name begins, whatever leads its row.
	const under = await page.$$eval("[data-slot=collapsible]:has([data-slot=agent-label])", (groups: Element[]) => groups.map((g) => ({ agent: g.querySelector("[data-slot=agent-label] > :first-child")!.getBoundingClientRect().left, names: [...g.querySelectorAll("[role=option] > :last-child")].map((c) => c.getBoundingClientRect().left) })));
	assert.ok(under.some((g: any) => g.names.length));
	for (const g of under) for (const left of g.names) assert.equal(left, g.agent, `a conversation's name is not under its agent's: ${JSON.stringify(under)}`);
	// What the agent is for stands on that line too, after the name and on the line its letters stand on.
	const one = await page.$eval("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", (el: Element) => {
		const stands = (node: Element) => {
			const range = document.createRange();
			range.selectNodeContents(node);
			const box = range.getBoundingClientRect();
			const pen = document.createElement("canvas").getContext("2d")!;
			pen.font = getComputedStyle(node).font;
			return { left: box.left, right: box.right, baseline: box.top + pen.measureText("x").fontBoundingBoxAscent };
		};
		return { name: stands(el.querySelector("[data-slot=agent-label] > :first-child")!), what: stands(el.querySelector("[data-slot=agent-label] > :last-child > span")!), row: el.getBoundingClientRect().height };
	});
	assert.ok(one.what.left > one.name.right && Math.abs(one.what.baseline - one.name.baseline) <= 0.75, `an agent's name and what it is for are not on one line: ${JSON.stringify(one)}`);
	assert.equal(one.row, 30, "an agent's line is as high as a conversation's");
	// The side bar is as wide as it is dragged.
	const before = await page.$eval("#sidebar-panel [data-slot=sidebar]", (el: Element) => el.getBoundingClientRect().width);
	const edge = await page.$eval(SIDE_EDGE, (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(edge.x + edge.width / 2, 300);
	await page.mouse.down();
	await page.mouse.move(edge.x + edge.width / 2 + 80, 300, { steps: 4 });
	await page.mouse.up();
	assert.equal(await page.$eval("#sidebar-panel [data-slot=sidebar]", (el: Element) => el.getBoundingClientRect().width), before + 80);
	// The edge is a separator the keyboard moves too: focused, an arrow key makes the side bar wider.
	await page.focus(`${SIDE_EDGE}[role='separator']`);
	assert.ok(await page.getAttribute(SIDE_EDGE, "aria-valuenow"), "the edge says how far it is");
	await page.keyboard.press("ArrowRight");
	await page.waitForFunction((was) => document.querySelector("#sidebar-panel [data-slot=sidebar]")!.getBoundingClientRect().width > was, before + 80);
	// Hidden, the side bar is still hidden when the page is loaded again, and shown it is as wide as it was
	// (to the pixel: the edges place panels by fractions of the window, a few hundredths of a pixel apart).
	const wide = Math.round(await page.$eval("#sidebar-panel [data-slot=sidebar]", (el: Element) => el.getBoundingClientRect().width));
	await menu("sidebar");
	await page.waitForSelector("#sidebar-panel [data-slot=sidebar]", { state: "detached" });
	await page.reload();
	await sees("[data-slot=tab][data-active]");
	assert.equal(await page.locator("#sidebar-panel [data-slot=sidebar]").count(), 0);
	await menu("sidebar");
	await sees("#sidebar-panel [data-slot=sidebar]");
	assert.equal(Math.round(await page.$eval("#sidebar-panel [data-slot=sidebar]", (el: Element) => el.getBoundingClientRect().width)), wide);
	await page.reload();
	await sees("#sidebar-panel [data-slot=agent-label]");
	// A group folds away on a click on its agent, and comes back.
	const group = page.locator("[data-slot=collapsible]:has([data-slot=agent-label])", { has: page.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }) });
	assert.equal(await group.locator("[role=option]").count(), 1);
	await group.locator("[data-slot=agent-label]").click();
	assert.equal(await group.locator("[role=option]").count(), 0);
	await group.locator("[data-slot=agent-label]").click();
	assert.equal(await group.locator("[role=option]").count(), 1);
	// The plus on an agent's own line starts a conversation with that agent.
	await group.locator("button[aria-label='New conversation with scout']").click();
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=scout");
	assert.equal(await page.textContent("[data-slot=empty] h1"), "scout");
	assert.match(await page.textContent("[data-slot=empty]:has(h1)"), /Looks things up on the web/);
	await shot("14-agents");
	// A conversation that was only started is called by how it began, in the side bar and on its tab.
	assert.match(await page.textContent("[data-slot=tab][data-active] [data-slot=tab-name]"), /new conversation/);
	await page.fill("[data-slot=composer] textarea", "where is the okapi invoice");
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=ECHO[where is the okapi invoice]");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=where is the okapi invoice", 15_000);
	assert.equal(await group.locator("[role=option] >> text=where is the okapi invoice").count(), 1);
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
	// Search finds a conversation by what was said in it, and opens it with the words marked.
	await menu("palette");
	await sees("[data-slot=command-input]");
	// By words that are only in an answer of the agent's, never in a name:
	await page.keyboard.type("echo[where");
	await sees("[cmdk-group-heading] >> text=Said in conversations");
	assert.match(await page.textContent("[data-slot=command-list]"), /scout · where is the okapi invoice[\s\S]*ECHO\[where is the okapi invoice\]/);
	await shot("15-search");
	// By words that are also its name, it is listed once, and still opens at the words.
	await page.fill("[data-slot=command-input]", "okapi invoice");
	await page.waitForFunction(() => document.querySelectorAll("[data-slot=command-item]").length > 0 && [...document.querySelectorAll("[data-slot=command-item] > :first-child")].filter((e) => /where is the okapi invoice/.test(e.textContent ?? "")).length === 1);
	await page.click("[data-slot=command-item]:has-text('scout · where is the okapi invoice')");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=where is the okapi invoice");
	await sees("[data-slot=input-group]:has(input[aria-label='Find in this conversation']) >> text=/\\d+ of \\d+/");
	assert.equal(await page.inputValue("input[aria-label='Find in this conversation']"), "okapi invoice");
	await page.keyboard.press("Escape");
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
	// Asked from where no agent is in front (the event log), a new conversation asks with whom.
	await menu("events");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=Events");
	await menu("new");
	await sees("[data-slot=dialog-title] >> text=New conversation with");
	assert.deepEqual(await page.$$eval("[data-slot=command-item] > :first-child", (els: Element[]) => els.map((e) => e.textContent)), ["main", "scout", "books", "test"]);
	await page.keyboard.press("Escape");
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
});

test("a conversation is opened from the side bar with the keyboard alone, and a group folds from it", async () => {
	const group = page.locator("[data-slot=collapsible]:has([data-slot=agent-label])", { has: page.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }) });
	const fold = group.locator("[data-slot=collapsible-trigger]");
	await fold.focus();
	assert.equal(await fold.getAttribute("aria-expanded"), "true");
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => document.activeElement?.getAttribute("aria-expanded") === "false");
	assert.equal(await group.locator("[role=option]").count(), 0);
	await page.keyboard.press("Space");
	await page.waitForFunction(() => document.activeElement?.getAttribute("aria-expanded") === "true");
	assert.ok((await group.locator("[role=option]").count()) > 0);
	// Its conversations are one stop after the agent's plus: Tab goes in, the arrows move, Enter opens.
	await page.keyboard.press("Tab");
	assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "New conversation with scout");
	await page.keyboard.press("Tab");
	const at = () => page.evaluate(() => ({ role: document.activeElement?.getAttribute("role"), text: document.activeElement?.textContent ?? "" }));
	assert.equal((await at()).role, "option");
	for (let i = 0; i < 6 && !/where is the okapi invoice/.test((await at()).text); i++) await page.keyboard.press("ArrowDown");
	assert.match((await at()).text, /where is the okapi invoice/);
	await page.keyboard.press("Enter");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=where is the okapi invoice");
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
});

test("a right click on an agent renames it in place, colors it, and offers to remove it, and never the main agent", async () => {
	const port = /http listening on 127\.0\.0\.1:(\d+)/.exec(fs.readFileSync(path.join(home, "data", "pine.log"), "utf8"))![1];
	const token = fs.readFileSync(path.join(home, "data", "http-token"), "utf8").trim();
	const made = await fetch(`http://127.0.0.1:${port}/agents`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ id: "spare", description: "Not needed for long", instructions: "You are spare." }) });
	assert.equal(made.status, 200);
	await sees("[data-slot=agent-label] >> text=spare", 20_000);
	// The menu is the system's, which the driver cannot click in: what it would show is noted, and the test says what is picked.
	await app.evaluate(({ ipcMain }: any) => {
		const g = globalThis as any;
		g.menus = [];
		ipcMain.removeHandler("pine:context-menu");
		ipcMain.handle("pine:context-menu", (_e: unknown, items: Array<{ id: string; label: string; separator?: boolean }>) => {
			g.menus.push(items.filter((i) => !i.separator).map((i) => i.label));
			return g.pick;
		});
	});
	const shown = async (agent: string, pick?: string): Promise<string[]> => {
		const before = await app.evaluate((_e: unknown, p: string | undefined) => (((globalThis as any).pick = p), (globalThis as any).menus.length), pick);
		await page.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { has: page.locator("[data-slot=agent-label] > :first-child", { hasText: new RegExp(`^${agent}$`) }) }).click({ button: "right" });
		for (let i = 0; i < 100; i++) {
			const menus = await app.evaluate(() => (globalThis as any).menus);
			if (menus.length > before) return menus.at(-1);
			await new Promise((r) => setTimeout(r, 30));
		}
		throw new Error(`no menu for ${agent}`);
	};
	// Folding is a click on the line and no menu item; the main agent has nothing to remove it with.
	assert.deepEqual(await shown("main"), ["New conversation with main", "Open a folder with main…", "New Group…", "Sort by Last Used", "Sort by Name", "Rename…", "Color…", "Agent settings…"]);
	// Rename turns its name in the side bar into a field: Escape keeps the name, Enter gives it the new one, and everything follows it.
	assert.deepEqual(await shown("spare", "rename"), ["New conversation with spare", "Open a folder with spare…", "New Group…", "Sort by Last Used", "Sort by Name", "Rename…", "Color…", "Agent settings…", "Remove spare…"]);
	await page.getByLabel("New name for spare").press("Escape");
	await sees("[data-slot=agent-label] >> text=spare");
	await shown("spare", "rename");
	await page.getByLabel("New name for spare").fill("Spare Hands");
	await page.getByLabel("New name for spare").press("Enter");
	await sees("[data-slot=toast] >> text=spare is called spare-hands now.");
	await sees("[data-slot=agent-label] >> text=spare-hands");
	assert.ok(fs.existsSync(path.join(home, "agents", "spare-hands", "agent.json")) && !fs.existsSync(path.join(home, "agents", "spare")));
	// Color opens the color over its avatar, and a pick is kept at once.
	await shown("spare-hands", "color");
	await page.locator("[data-slot=agent-color][data-open]").getByRole("button", { name: "Blue", exact: true }).click();
	for (let i = 0; i < 100 && !JSON.parse(fs.readFileSync(path.join(home, "agents", "spare-hands", "agent.json"), "utf8")).color; i++) await new Promise((r) => setTimeout(r, 30));
	assert.match(JSON.parse(fs.readFileSync(path.join(home, "agents", "spare-hands", "agent.json"), "utf8")).color, /^#[0-9a-f]{6}$/);
	await page.keyboard.press("Escape");
	assert.deepEqual(await shown("spare-hands", "remove"), ["New conversation with spare-hands", "Open a folder with spare-hands…", "New Group…", "Sort by Last Used", "Sort by Name", "Rename…", "Color…", "Agent settings…", "Remove spare-hands…"]);
	// It asks first, and how: nothing is removed by the menu alone.
	// It is an alert dialog: it does not go away with a stray click beside it.
	await sees("[role=alertdialog] [data-slot=alert-dialog-title] >> text=Remove the agent spare-hands?");
	await page.mouse.click(5, 5);
	await sees("[role=alertdialog]");
	assert.ok(fs.existsSync(path.join(home, "agents", "spare-hands", "agent.json")));
	await page.click("[data-slot=command-item]:has-text('Remove it with everything it has')");
	await sees("[data-slot=toast] >> text=Removed the agent spare-hands.");
	await page.waitForFunction(() => ![...document.querySelectorAll("[data-slot=agent-label] > :first-child")].some((e) => e.textContent?.trim() === "spare-hands"));
	assert.equal(fs.existsSync(path.join(home, "agents", "spare-hands")), false);
	// Asked for the main agent all the same (the palette, another road), the app says no and asks the daemon for nothing.
	await page.evaluate(() => (window as any).pine.call("POST", "/agents/main/erase", { agent: "main", keepFiles: false })).then((r: any) => assert.equal(r.ok, false));
	assert.ok(fs.existsSync(path.join(home, "agents", "main", "agent.json")));
});

test("conversations are kept in groups: one made from the agent's menu is filled by dragging and from the palette, sorted, renamed, and removed with what is in it", async () => {
	for (const session of ["okapi-api", "okapi-web", "llama"]) assert.ok((await api("POST", "/agents/scout/prompt", { prompt: `work on ${session}`, session })).ok);
	assert.ok((await api("POST", "/agents/scout/branch", { session: "okapi-api", to: "okapi-try" })).ok);
	const scout = page.locator("[data-slot=collapsible]:has([data-slot=agent-label])", { has: page.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }) });
	const row = (name: string) => scout.locator("[role=option]", { hasText: new RegExp(`${name}$`) });
	const group = (name: string) => scout.locator("[data-slot=conversation-group]", { has: page.locator("[data-slot=group-label]", { hasText: new RegExp(`^${name}$`) }) });
	const groupOf = async (session: string) => ((await api("GET", "/agents/scout/sessions")).data as any[]).find((c) => c.session === session)?.group;
	// The menu is the system's: what it shows is noted, and the test says what is picked.
	await app.evaluate(({ ipcMain }: any) => {
		const g = globalThis as any;
		g.menus = [];
		ipcMain.removeHandler("pine:context-menu");
		ipcMain.handle("pine:context-menu", (_e: unknown, items: Array<{ id: string; label: string; separator?: boolean; checked?: boolean }>) => {
			g.menus.push(items.filter((i) => !i.separator).map((i) => `${i.label}${i.checked ? " ✓" : ""}`));
			return g.pick;
		});
	});
	const choose = async (target: any, pick: string): Promise<string[]> => {
		const before = await app.evaluate((_e: unknown, p: string) => (((globalThis as any).pick = p), (globalThis as any).menus.length), pick);
		await target.click({ button: "right" });
		for (let i = 0; i < 100; i++) {
			const menus = await app.evaluate(() => (globalThis as any).menus);
			if (menus.length > before) return menus.at(-1);
			await new Promise((r) => setTimeout(r, 30));
		}
		throw new Error(`no menu for ${pick}`);
	};
	const agentLine = page.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { has: page.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }) });

	// A group is made from the agent's menu, empty, with a name the owner types.
	assert.ok((await choose(agentLine, "group")).includes("Sort by Last Used ✓"), "the list is sorted by when a conversation was last used, as it was");
	await page.fill("[data-slot=dialog-content] input[placeholder='Its name']", "Okapi");
	await page.keyboard.press("Enter");
	await group("Okapi").waitFor();
	// (A branch made through the control API is in the list the side bar asked for after that.)
	await sees("[role=option] >> text=okapi-try");
	assert.equal(await group("Okapi").locator("[role=option]").count(), 0);

	// A conversation dragged onto the group goes into it, with its branch; a branch is not dragged by itself.
	assert.equal(await row("okapi-try").locator("xpath=ancestor::li[1]").getAttribute("draggable"), "false");
	await row("okapi-api").dragTo(group("Okapi").locator("[data-slot=group-label]"));
	await group("Okapi").locator("[role=option]", { hasText: /okapi-try$/ }).waitFor();
	assert.deepEqual([await groupOf("okapi-api"), await groupOf("okapi-try")], ["Okapi", "Okapi"]);
	// In the group, a conversation's name stands one step further in than outside it.
	const left = (l: any) => l.locator(":scope > :last-child").evaluate((e: Element) => e.getBoundingClientRect().left);
	assert.ok((await left(group("Okapi").locator("[role=option]", { hasText: /okapi-api$/ }))) > (await left(row("llama"))));

	// With the keyboard: the palette's command moves the conversation in front into a group it picks.
	await row("okapi-web").click();
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=okapi-web");
	await menu("palette");
	await page.keyboard.type("Move conversation to group");
	await page.keyboard.press("Enter");
	await sees("[data-slot=dialog-content] [role=option] >> text=Okapi");
	await page.keyboard.type("Okapi");
	await page.keyboard.press("Enter");
	await group("Okapi").locator("[role=option]", { hasText: /okapi-web$/ }).waitFor();
	assert.equal(await groupOf("okapi-web"), "Okapi");

	// Dragged onto the agent's line, a conversation leaves its group; a move made by another hand (here the control API) is followed.
	await group("Okapi").locator("[role=option]", { hasText: /okapi-web$/ }).dragTo(agentLine);
	await page.waitForFunction(() => ![...document.querySelectorAll("[data-slot=conversation-group] [role=option]")].some((e) => /okapi-web$/.test(e.textContent ?? "")));
	assert.equal(await groupOf("okapi-web"), undefined);
	assert.ok((await api("POST", "/agents/scout/group", { session: "llama", group: "Okapi" })).ok);
	await group("Okapi").locator("[role=option]", { hasText: /llama$/ }).waitFor();

	// Sorted by name, from the agent's menu; renamed from the group's.
	await choose(agentLine, "name");
	for (let i = 0; i < 100 && (await api("GET", "/agents/scout/groups")).data.order !== "name"; i++) await new Promise((r) => setTimeout(r, 30));
	assert.equal((await api("GET", "/agents/scout/groups")).data.order, "name");
	await page.waitForFunction(() => {
		const names = [...document.querySelectorAll("[data-slot=conversation-group] [role=option] > :last-child")].map((e) => e.textContent ?? "");
		return names.join(",") === "llama,okapi-api,okapi-try";
	});
	assert.deepEqual(await choose(group("Okapi").locator("[data-slot=group-label]"), "rename"), ["New Conversation in Okapi", "Rename…", "Remove Group…"]);
	await page.fill("[data-slot=dialog-content] input[placeholder='The new name']", "Okapi 2026");
	await page.keyboard.press("Enter");
	await group("Okapi 2026").locator("[role=option]", { hasText: /okapi-try$/ }).waitFor();
	await shot("16-groups");

	// Removing the group asks first, and takes its conversations with it.
	await choose(group("Okapi 2026").locator("[data-slot=group-label]"), "remove");
	await sees("[role=alertdialog] [data-slot=alert-dialog-title] >> text=Remove the group Okapi 2026 and its 3 conversations for good?");
	await page.click("[data-slot=command-item]:has-text('Remove them for good')");
	await sees("[data-slot=toast] >> text=Removed the group Okapi 2026 with 3 conversations.");
	await group("Okapi 2026").waitFor({ state: "detached" });
	assert.deepEqual([await row("okapi-api").count(), await row("llama").count(), await row("okapi-web").count()], [0, 0, 1], "what was in it is gone, and what was taken out before stays");
	await choose(agentLine, "recent");
	for (let i = 0; i < 100 && (await api("GET", "/agents/scout/groups")).data.order !== "recent"; i++) await new Promise((r) => setTimeout(r, 30));
	// As it was before: the tab this test opened closed, its conversation gone.
	await page.click("[data-slot=tab]:has([data-slot=tab-name]:has-text('okapi-web')) button[aria-label='Close this tab']");
	await page.waitForSelector("[data-slot=tab]:has([data-slot=tab-name]:has-text('okapi-web'))", { state: "detached" });
	assert.ok((await api("POST", "/agents/scout/remove", { session: "okapi-web" })).ok);
});

test("a conversation is opened from the palette with the keyboard alone", async () => {
	await menu("palette");
	await sees("[data-slot=dialog-content] [role=listbox]");
	await named(/./);
	assert.equal(await announced("[data-slot=dialog-content]"), "Search everything");
	await page.keyboard.press("Tab");
	await stillInside();
	await page.keyboard.press("Shift+Tab");
	await stillInside();
	assert.equal((await activeOption()).role, "combobox");
	await page.keyboard.type("where is the okapi");
	// Its results keep their group headers.
	await sees("[cmdk-group-heading] >> text=Conversations");
	await sees("[role=option] >> text=scout · where is the okapi invoice");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowUp");
	await named(/scout · where is the okapi invoice/);
	const at = await activeOption();
	assert.deepEqual([at.option, at.selected, at.list], ["option", "true", true], JSON.stringify(at));
	await page.keyboard.press("Enter");
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=where is the okapi invoice");
	await page.keyboard.press("Escape");
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
});

test("the palette finds things by name, and the event log follows", async () => {
	// The pointer rests where the list will open: the first line is still the one that enter takes.
	await page.mouse.move(640, 320);
	await menu("palette");
	await sees("[data-slot=command-input]");
	await page.keyboard.type("event log");
	await shot("10-palette");
	await page.keyboard.press("Enter");
	await sees("[aria-label=Events] [data-slot=collapsible-trigger]");
	assert.ok((await page.$$eval("[aria-label=Events] [data-slot=collapsible-trigger]", (els: Element[]) => els.length)) > 3);
	await shot("11-events");
});

test("an event is published from the event log with a form: a topic, and a payload checked to be JSON before it is sent", async () => {
	await page.getByRole("button", { name: "Publish…" }).click();
	await sees("[data-slot=publish-form]");
	// The topic field has the focus; a payload that is not JSON is said under its field, and nothing is sent.
	await page.keyboard.type("house/mode");
	await page.getByLabel("Payload").fill("{value: away}");
	await page.getByRole("button", { name: /^Publish/ }).click();
	await sees("[data-slot=publish-form] [data-slot=field-error] >> text=This is not JSON");
	assert.equal(await page.getAttribute("#publish-payload", "aria-invalid"), "true");
	await shot("11b-publish-wrong");
	await page.getByLabel("Payload").fill('{"value": "away"}');
	await page.getByLabel("Payload").press("Meta+Enter");
	await page.waitForSelector("[data-slot=publish-form]", { state: "detached" });
	await sees("[data-slot=toast] >> text=on house/mode");
	await sees("[aria-label=Events] [data-slot=collapsible-trigger] >> text=house/mode");
	// The daemon got what /emit sends: the topic, the payload as JSON, from the owner.
	const port = /http listening on 127\.0\.0\.1:(\d+)/.exec(fs.readFileSync(path.join(home, "data", "pine.log"), "utf8"))![1];
	const token = fs.readFileSync(path.join(home, "data", "http-token"), "utf8").trim();
	const events = (await (await fetch(`http://127.0.0.1:${port}/events?topic=house/mode`, { headers: { authorization: `Bearer ${token}` } })).json()) as Array<{ payload: unknown; trust: string }>;
	assert.deepEqual(events.map((e) => [e.payload, e.trust]), [[{ value: "away" }, "owner"]]);
});

test("a sub-agent's work opens in a tab of its own", async () => {
	await page.click("[data-slot=tab] >> nth=0");
	mock.state.scripts.child = [{ text: "hi from the child" }];
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "subagent", args: { tasks: ["@@REF:child@@ say hi"] } }] }, { text: "the sub-agent answered" }], "ask a helper "));
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=the sub-agent answered");
	await page.click("[data-item=work] > [data-slot=trace-collapsible-trigger] >> nth=-1");
	await sees("[data-part=child] [data-slot=trace-line]");
	await page.click("[data-part=child] [data-slot=trace-line] >> nth=0");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=#");
	await sees("[data-slot=markdown] >> text=hi from the child");
	assert.match(await page.textContent("[data-slot=message-scroller-content]"), /sub-agent of main/);
	await shot("12-task");
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
});

test("the last message is taken back, and its text is in the input again", async () => {
	await page.click("[data-slot=tab] >> nth=0");
	const before = await page.$$eval("[data-item=user]", (els: Element[]) => els.length);
	await menu("undo");
	await sees("[data-slot=marker][data-tone=accent] >> text=Taken back");
	assert.equal(await page.$$eval("[data-item=user]", (els: Element[]) => els.length), before - 1);
	assert.match(await page.inputValue("[data-slot=composer] textarea"), /^ask a helper /);
	await page.fill("[data-slot=composer] textarea", "");
});

test("a message is branched from: a new conversation with what was said up to it, under the original in the side bar", async () => {
	await page.click("[data-slot=tab] >> nth=0");
	await menu("new");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=new conversation");
	for (const word of ["BRANCH-ONE", "BRANCH-TWO"]) {
		await page.fill("[data-slot=composer] textarea", mockMsg([{ text: `answer to ${word}` }], `${word} `));
		await page.keyboard.press("Enter");
		await sees(`[data-slot=markdown] >> text=answer to ${word}`);
	}
	// A conversation is called by the first thing said in it, once the app has asked the daemon what was said: read
	// before that, its name is still "new conversation", and is another one by the time it is compared below.
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=BRANCH-ONE");
	const from = await page.textContent("[data-slot=tab][data-active] [data-slot=tab-name]");
	// A right click on a message of the owner's offers it. The menu is the system's: what it shows is noted, and the test picks.
	await app.evaluate(({ ipcMain }: any) => {
		const g = globalThis as any;
		g.branchMenus = [];
		ipcMain.removeHandler("pine:context-menu");
		ipcMain.handle("pine:context-menu", (_e: unknown, items: Array<{ id: string; label: string }>) => (g.branchMenus.push(items.map((i) => i.label)), "branch"));
	});
	await page.click("[data-item=user]:has-text('BRANCH-ONE')", { button: "right" });
	for (let i = 0; i < 100 && !(await app.evaluate(() => (globalThis as any).branchMenus.length)); i++) await new Promise((r) => setTimeout(r, 30));
	assert.deepEqual(await app.evaluate(() => (globalThis as any).branchMenus[0]), ["Branch from here"]);
	await sees("[data-slot=toast] >> text=from that message");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=· branch");
	assert.ok((await page.textContent("[data-slot=tab][data-active] [data-slot=tab-name]")).startsWith(`${from!.trim()} · branch`));
	await sees("[data-slot=markdown] >> text=answer to BRANCH-ONE");
	assert.doesNotMatch(await page.textContent("[data-slot=message-scroller-content]"), /BRANCH-TWO/);
	// In the side bar it is under the conversation it was made from, one step in.
	await page.waitForFunction(() => [...document.querySelectorAll("#sidebar-panel [role=option]")].some((r) => /a branch of/.test(r.getAttribute("title") ?? "")));
	const rows = await page.$$eval("#sidebar-panel [role=option]", (els: Element[]) => els.map((e) => ({ title: e.getAttribute("title") ?? "", indent: parseFloat(getComputedStyle(e).paddingLeft) })));
	const at = rows.findIndex((r) => /a branch of/.test(r.title));
	assert.ok(rows[at].indent > rows[at - 1].indent, JSON.stringify(rows));
	assert.match(rows[at].title, new RegExp(`a branch of ${rows[at - 1].title.split(" · ")[1]}`), JSON.stringify(rows));
	// Its top line is a path: the conversation it was made from, then itself; the one before opens with a click.
	const original = from!.trim().split(" · ").slice(1).join(" · ");
	await sees(`[data-slot=conversation-head] [data-slot=breadcrumb-link] >> text=${original}`);
	assert.match(await page.textContent("[data-slot=conversation-head] [data-slot=breadcrumb-page]"), /branch/);
	await page.click("[data-slot=conversation-head] [data-slot=breadcrumb-link]");
	await page.waitForFunction((name) => document.querySelector("[data-slot=tab][data-active] [data-slot=tab-name]")?.textContent?.trim() === name, from!.trim());
	assert.equal(await page.$("[data-slot=conversation-head] [data-slot=breadcrumb-link]"), null, "the original has nothing before it");
	await page.click("[data-slot=tab]:has-text('· branch')");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=· branch");
	await shot("15-branch");
	// What is said in the branch stays there.
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "only in the branch" }], "BRANCH-THREE "));
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=only in the branch");
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
	await page.click("[data-slot=tab] >> nth=0");
	await sees("[data-slot=composer] textarea");
});

test("a conversation moves into a worktree of its folder: the chip names the branch, and its work is merged from the panel", async () => {
	await app.evaluate(({ BrowserWindow }: any, dir: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", `folder:${dir}`), folder);
	await confirm(":is([data-slot=dialog-title], [data-slot=alert-dialog-title]) >> text=Which agent works in");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=pine-desktop-folder");
	await menu("worktree");
	await confirm(":is([data-slot=dialog-title], [data-slot=alert-dialog-title]) >> text=Work in a worktree?");
	await sees("[data-slot=conversation-head] [data-worktree] >> text=pine/");
	const branch = (await page.textContent("[data-slot=conversation-head] [data-worktree]"))!.trim();
	const tree = path.join(folder, ".pine", "worktrees", branch.slice(5));
	assert.ok(fs.existsSync(path.join(tree, "README.md")), "a checkout of its own");
	await sees("[data-slot=message-scroller-content] >> text=now works in the worktree");
	// The side bar says where it works, once something was said in it.
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "working apart" }], "APART "));
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=working apart");
	await page.waitForFunction((b: string) => [...document.querySelectorAll("#sidebar-panel [role=option]")].some((r) => (r.getAttribute("title") ?? "").includes(`in the worktree ${b}`)), branch);

	// Its work, committed there as an agent would, is merged from the panel into what the folder has checked out.
	fs.writeFileSync(path.join(tree, "WORKTREE.md"), "made apart\n");
	execFileSync("git", ["-C", tree, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "add", "WORKTREE.md"], { stdio: "ignore" });
	execFileSync("git", ["-C", tree, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "apart"], { stdio: "ignore" });
	await menu("code-changes");
	await page.locator("[data-slot=code-panel]").getByRole("tab", { name: "Files" }).click();
	await page.locator("[data-slot=code-panel]").getByRole("tab", { name: "Changes" }).click();
	await sees("[data-slot=code-panel] >> text=1 ahead of");
	await shot("16-worktree");
	await page.locator("[data-slot=code-panel]").getByRole("button", { name: "Merge…" }).click();
	await confirm(":is([data-slot=dialog-title], [data-slot=alert-dialog-title]) >> text=1 commit ahead of");
	await sees("[data-slot=toast] >> text=merged into");
	assert.equal(fs.readFileSync(path.join(folder, "WORKTREE.md"), "utf8"), "made apart\n");
	assert.equal(fs.readFileSync(path.join(folder, "src", "index.ts"), "utf8"), "export const answer = 43;\n", "what was not committed in the folder stayed");

	// Discarded once merged: the folder's chip is back.
	await menu("worktree");
	await confirm(":is([data-slot=dialog-title], [data-slot=alert-dialog-title]) >> text=ahead of");
	await sees("[data-slot=conversation-head] [data-folder] >> text=pine-desktop-folder");
	assert.ok(!fs.existsSync(tree));

	// A worktree made for it by another hand (a terminal UI on the same daemon) shows here too, and so does its end:
	// the call goes past the window's own model, which is told only that the conversation changed.
	const session = ((await api("GET", "/agents/main/folders")).data as Array<{ session: string; folder: string }>).find((u) => u.folder === folder)!.session;
	const made = await api("POST", "/agents/main/worktree", { session, name: "elsewhere" });
	assert.ok(made.ok, JSON.stringify(made));
	await sees("[data-slot=conversation-head] [data-worktree] >> text=pine/elsewhere");
	const ended = await api("POST", "/agents/main/worktree/remove", { session });
	assert.ok(ended.ok, JSON.stringify(ended));
	await sees("[data-slot=conversation-head] [data-folder] >> text=pine-desktop-folder");
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
});

test("dictating puts what is heard into the input and sends nothing", async () => {
	const sent = await page.$$eval("[data-item=user]", (els: Element[]) => els.length);
	await page.fill("[data-slot=composer] textarea", "Typed first:");
	await menu("voice");
	await sees("[data-slot=alert] >> text=listening");
	await page.waitForFunction(() => (document.querySelector("[data-slot=composer] textarea") as HTMLTextAreaElement).value === "Typed first: about the scans", undefined, { timeout: 8000 }).catch(async () => {
		throw new Error(`what was heard is not in the input, which holds: ${JSON.stringify(await page.inputValue("[data-slot=composer] textarea"))}; ${await page.evaluate(() => [...document.querySelectorAll("[data-slot=alert], [data-slot=toast]")].map((e) => e.textContent).join(" | "))}`);
	});
	// Enter says "that was all": the rest arrives, and the message is still only text in the input.
	await page.focus("[data-slot=composer] textarea");
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => (document.querySelector("[data-slot=composer] textarea") as HTMLTextAreaElement).value === "Typed first: about the scans please");
	await page.waitForSelector("[data-slot=alert] >> text=listening", { state: "detached" });
	assert.equal(await page.$$eval("[data-item=user]", (els: Element[]) => els.length), sent);
	await page.fill("[data-slot=composer] textarea", "");
});

test("find marks what is looked for", async () => {
	await menu("find");
	await sees("input[aria-label='Find in this conversation']");
	await page.keyboard.type("first line");
	await sees("[data-slot=input-group]:has(input[aria-label='Find in this conversation']) >> text=/\\d+ of \\d+/");
	assert.ok(await page.evaluate(() => ((CSS as any).highlights.get("pine-find")?.size ?? 0) > 0));
	await shot("13-find");
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=input-group]:has(input[aria-label='Find in this conversation'])", { state: "detached" });
});

test("many tabs keep their width and scroll instead of stepping on each other", async () => {
	await page.click("[data-slot=tab] >> nth=0");
	const had = await page.locator("[data-slot=tab]").count();
	for (let i = 0; i < 20; i++) {
		await menu("new");
		await page.waitForFunction((n) => document.querySelectorAll("[data-slot=tab]").length === n, had + i + 1);
	}
	const measure = () =>
		page.evaluate(() => {
			const strip = document.querySelector("header [data-slot=scroll-area-viewport]")!.getBoundingClientRect();
			const tabs = [...document.querySelectorAll("[data-slot=tab]")].map((el) => {
				const r = el.getBoundingClientRect();
				// What a tab draws reaches as far as its widest child: a child that does not fit spills over the next tab.
				const right = Math.max(r.right, ...[...el.children].map((c) => c.getBoundingClientRect().right));
				return { left: r.left, right, width: r.width, on: el.hasAttribute("data-active") };
			});
			const plus = document.querySelector("header button[aria-label^='New conversation']")!.getBoundingClientRect();
			return { strip: { left: strip.left, right: strip.right }, tabs, plus: { left: plus.left, right: plus.right }, width: window.innerWidth };
		});
	const m = await measure();
	const gaps = m.tabs.slice(1).map((t: any, i: number) => t.left - m.tabs[i].right);
	assert.ok(Math.min(...gaps) >= 0, `tabs overlap: the smallest gap between two tabs is ${Math.min(...gaps)}px`);
	assert.ok(Math.min(...m.tabs.map((t: any) => t.width)) >= 96, "every tab keeps room for its avatar, a few letters and its close button");
	const on = m.tabs.find((t: any) => t.on);
	assert.ok(on.left >= m.strip.left - 0.5 && on.right <= m.strip.right + 0.5, `the tab in front is in view: ${JSON.stringify({ on, strip: m.strip })}`);
	assert.ok(m.plus.left >= m.strip.right && m.plus.right <= m.width, "the plus stays in view after the tabs");
	// Going back to the first tab scrolls it into view.
	await page.click("[data-slot=tab] >> nth=0");
	await menu("prev-tab");
	await page.waitForFunction(() => {
		const strip = document.querySelector("header [data-slot=scroll-area-viewport]")!.getBoundingClientRect();
		const r = document.querySelector("[data-slot=tab][data-active]")!.getBoundingClientRect();
		return r.left >= strip.left - 0.5 && r.right <= strip.right + 0.5;
	});
	await shot("many-tabs");
	while ((await page.locator("[data-slot=tab]").count()) > had) await page.click("[data-slot=tab] >> nth=-1 >> button[aria-label='Close this tab']");
});

test("a right click on a tab closes the others, those to its right or all of them, main's too, and pins; what is asked stays answerable", async () => {
	// The tabs of before, put back at the end for the tests after this one (the daemon keeps them).
	const before = (await api("GET", "/ui/tabs")).data;
	const tabs = page.locator("[data-slot=tab]");
	const count = (n: number) => page.waitForFunction((n: number) => document.querySelectorAll("[data-slot=tab]").length === n, n);
	const opened = async (at: number) => {
		await tabs.nth(at).click({ button: "right" });
		await sees("[data-slot=context-menu-content]");
		return page.locator("[data-slot=context-menu-content]");
	};
	const choose = async (at: number, item: string) => {
		await (await opened(at)).getByRole("menuitem", { name: item, exact: true }).click();
		await page.waitForSelector("[data-slot=context-menu-content]", { state: "detached" });
	};
	const main = await page.evaluate(() => [...document.querySelectorAll("[data-slot=tab] [data-slot=tab-name]")].findIndex((e) => e.textContent === "main"));
	assert.ok(main >= 0, "the main agent's tab is open");
	// main's own tab offers Pin, and it cannot be chosen: an agent's main conversation always stays.
	const menuOfMain = await opened(main);
	assert.equal(await menuOfMain.getByRole("menuitem", { name: "Pin", exact: true }).getAttribute("aria-disabled"), "true");
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=context-menu-content]", { state: "detached" });
	await tabs.nth(main).click();
	const had = await tabs.count();
	for (let i = 1; i <= 3; i++) {
		await menu("new");
		await count(had + i);
	}
	// Close to the Right of the second new one: the third goes.
	await choose(had + 1, "Close to the Right");
	await count(had + 2);
	// Pin and Unpin are one entry that says which; a conversation is kept once something was said in it.
	await tabs.nth(had + 1).click();
	await page.fill("[data-slot=composer] textarea", "keep this one");
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=ECHO[keep this one]");
	await choose(had + 1, "Pin");
	await tabs.nth(had + 1).locator("svg.lucide-star").waitFor();
	await choose(had + 1, "Unpin");
	await tabs.nth(had + 1).locator("svg.lucide-star").waitFor({ state: "detached" });
	// The first new one waits for an approval, put off for later.
	await tabs.nth(had).click();
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "bash", args: { command: "echo tabs" } }] }, { text: "done with tabs" }], "ask and close "));
	await page.keyboard.press("Enter");
	await sees("[data-slot=dialog-content][data-tone=warn]");
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await tabs.nth(had).locator("[data-slot=badge]", { hasText: "!" }).waitFor();
	// Close Others from the second: every other tab goes, main's too, but the one that waits for an answer stays, and says why.
	await choose(had + 1, "Close Others");
	await count(2);
	await sees("[data-slot=toast] >> text=1 tab stayed open: it waits for your answer.");
	assert.equal(await tabs.nth(1).getAttribute("data-active"), "true");
	assert.equal(await page.locator("[data-slot=tab] [data-slot=tab-name]", { hasText: /^main$/ }).count(), 0);
	// Close, the menu's first item, closes that tab alone.
	await (await opened(1)).getByRole("menuitem").first().click();
	await count(1);
	// A tab that waits is closed by its own button: what was asked goes to the tab in front, and is answered there.
	await menu("new");
	await count(2);
	await tabs.nth(0).hover();
	await tabs.nth(0).locator("button[aria-label='Close this tab']").click();
	await count(1);
	await tabs.nth(0).locator("[data-slot=badge]", { hasText: "!" }).waitFor();
	const asked = '[data-item="approval"][data-state="open"] [data-slot="item"]';
	assert.match(await page.textContent(asked), /echo tabs/);
	await page.click(`${asked} button:has-text("Allow once")`);
	await sees('[data-item="approval"][data-state="allowed"] >> text=Allowed');
	// Close All closes the last tab too: the window says that none is open, and opens one again from there.
	await choose(0, "Close All");
	await count(0);
	await sees("[data-slot=no-tab]");
	await shot("no-tab");
	await page.locator("[data-slot=no-tab]").getByRole("button", { name: "Open main" }).click();
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=main");
	await api("POST", "/ui/tabs", before);
	await page.reload();
	await sees("[data-slot=tab][data-active]");
	// The reload drew the side panel before the tests after this one change what it shows: it is put away, and they open it afresh.
	if (await page.$("[data-slot=code-panel]")) {
		await menu("code");
		await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
	}
});

test("the panel's Agent view scrolls up and down only, however narrow the panel and however long a line it shows", async () => {
	// A memory with a line no space breaks, and a description as long: the view wraps them, it is never pushed sideways.
	write(path.join(home, "agents", "main", "workspace", "MEMORY.md"), `# Memory\n\n${"x".repeat(240)}\n${"https://example.com/".repeat(12)}\n${"- a line to remember\n".repeat(60)}`);
	await page.click("[data-slot=tab] >> nth=0");
	if (!(await page.$("[data-slot=code-panel]"))) await page.click(CODE_TOGGLE);
	await page.locator("[data-slot=code-panel]").getByRole("tab", { name: "Agent" }).click();
	await sees("[data-slot=code-panel] [data-slot=scroll-area] >> text=What it remembers");
	const width = () => page.$eval("[data-slot=code-panel]", (el: Element) => el.getBoundingClientRect().width);
	const was = await width();
	const edge = await page.$eval(CODE_EDGE, (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(edge.x + edge.width / 2, 300);
	await page.mouse.down();
	await page.mouse.move(edge.x + edge.width / 2 + 600, 300, { steps: 6 });
	await page.mouse.up();
	assert.ok((await width()) < was, "the panel was not made narrower");
	const fits = () => page.$eval("[data-slot=code-panel] [data-slot=scroll-area]:has-text(\"What it remembers\") > [data-slot=scroll-area-viewport]", (el: Element) => {
		const wide = [...el.querySelectorAll("*")].filter((c) => c.getBoundingClientRect().right > el.getBoundingClientRect().right + 0.5).slice(0, 5).map((c) => `${c.tagName}.${c.className}`.slice(0, 120));
		return { scroll: el.scrollWidth, client: el.clientWidth, wide };
	});
	const seen = await fits();
	await shot("agent-view-narrow");
	assert.ok(seen.scroll <= seen.client, `the Agent view is wider than the panel: ${JSON.stringify(seen)}`);
	// Its scroll bar, like every scroll area's, is hidden at rest and shows under the pointer and while it scrolls.
	// The fade is turned off for the reading: a window in the background runs its transitions slowly.
	const area = "[data-slot=code-panel] [data-slot=scroll-area]:has-text(\"What it remembers\")";
	const bar = `${area} > [data-slot=scroll-area-scrollbar][data-orientation=vertical]`;
	const handle = await page.$(bar);
	assert.ok(handle, "the Agent view has no scroll bar");
	const settled = (state: string) => page.waitForFunction(([el, state]) => {
		el.style.transition = "none";
		const on = el.hasAttribute("data-hovering") || el.hasAttribute("data-scrolling");
		return (state === "rest" ? !on : on) && getComputedStyle(el).opacity === (state === "rest" ? "0" : "1");
	}, [handle, state] as const, { timeout: 3000 }).then(() => true, () => false);
	await page.mouse.move(5, 5);
	assert.ok(await settled("rest"), "a scroll bar shows at rest");
	const box = await page.$eval(area, (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	assert.ok(await settled("on"), "a scroll bar stays hidden under the pointer");
	await page.mouse.move(5, 5);
	assert.ok(await settled("rest"), "a scroll bar stays shown once the pointer has left");
	await page.$eval(`${area} > [data-slot=scroll-area-viewport]`, (el: Element) => el.scrollBy(0, 40));
	assert.ok(await settled("on"), "a scroll bar stays hidden while it scrolls");
	// Back to the width it had, for the tests after this one.
	const back = await page.$eval(CODE_EDGE, (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(back.x + back.width / 2, 300);
	await page.mouse.down();
	await page.mouse.move(back.x + back.width / 2 - (was - (await width())), 300, { steps: 6 });
	await page.mouse.up();
});

test("a phone-wide window lays the side bar and the panel over the conversation, and a wide one puts them back beside it", async () => {
	// The page's size, as the start of this file sets it (the window's own size does not count while the driver sets one).
	const size = (width: number, height: number) => page.setViewportSize({ width, height });
	try {
		await page.click("[data-slot=tab] >> nth=0");
		await sees("#sidebar-panel [data-slot=sidebar]");
		const wide = Math.round(await page.$eval("#sidebar-panel [data-slot=sidebar]", (el: Element) => el.getBoundingClientRect().width));
		if (await page.$("[data-slot=code-panel]")) await menu("code");
		await size(380, 760);
		// No column: the side bar is stock's sheet, closed until it is asked for, and the page does not scroll sideways.
		await page.waitForSelector("#sidebar-panel", { state: "detached" });
		assert.equal(await page.locator("[data-slot=sidebar][data-mobile=true]").count(), 0);
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 380);
		await page.click("header [data-sidebar=trigger]");
		await sees("[data-slot=sidebar][data-mobile=true] [data-slot=agent-label]");
		// Picking a conversation in it puts it away again.
		await page.locator("[data-slot=sidebar][data-mobile=true] [role=option]").first().click();
		await page.waitForSelector("[data-slot=sidebar][data-mobile=true]", { state: "detached" });
		// The menu's Toggle Sidebar opens the sheet and leaves the owner's choice of a column as it was.
		await menu("sidebar");
		await sees("[data-slot=sidebar][data-mobile=true]");
		await page.keyboard.press("Escape");
		await page.waitForSelector("[data-slot=sidebar][data-mobile=true]", { state: "detached" });
		// The panel beside a conversation is a sheet over it, and closing the sheet closes the panel.
		await menu("code-agent");
		await sees("[data-slot=sheet-content] [data-slot=code-panel]");
		assert.equal(await page.locator("[data-slot=resizable-handle]:has(+ #code-panel)").count(), 0);
		await page.keyboard.press("Escape");
		await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
		// The browser's aside is a sheet the same way, and of the two only the one opened last lies over the conversation;
		// the other one's icon says it is open behind.
		await menu("code-agent");
		await sees("[data-slot=sheet-content] [data-slot=code-panel]");
		await menu("browser");
		await sees("[data-slot=sheet-content] [data-slot=browser-aside]");
		assert.equal(await page.locator("[data-slot=code-panel]").count(), 0);
		assert.equal(await page.locator("[data-slot=resizable-handle]:has(+ #browser-panel)").count(), 0);
		await sees(`${CODE_TOGGLE}[data-behind]`);
		// Asking for the one behind brings it to the front; closing that one leaves the other behind, until it is asked for.
		await menu("code");
		await sees("[data-slot=sheet-content] [data-slot=code-panel]");
		assert.equal(await page.locator("[data-slot=browser-aside]").count(), 0);
		await sees(`${BROWSER_TOGGLE}[data-behind]`);
		await menu("code");
		await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
		assert.equal(await page.locator("[data-slot=sheet-content]").count(), 0);
		await menu("browser");
		await sees("[data-slot=sheet-content] [data-slot=browser-aside]");
		await menu("browser");
		await page.waitForSelector("[data-slot=browser-aside]", { state: "detached" });
		// Between a phone and a laptop: the side bar has room for its column, the panel beside the conversation does not.
		await size(900, 760);
		await sees("#sidebar-panel [data-slot=sidebar]");
		await menu("code-agent");
		await sees("[data-slot=sheet-content] [data-slot=code-panel]");
		await menu("code");
		await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
		// Wide again: the side bar is a column as wide as it was.
		await size(1280, 820);
		await sees("#sidebar-panel [data-slot=sidebar]");
		assert.equal(Math.round(await page.$eval("#sidebar-panel [data-slot=sidebar]", (el: Element) => el.getBoundingClientRect().width)), wide);
	} finally {
		// The tests after this one have the width the start of this file set, whatever failed here.
		await size(1280, 820);
	}
});

test("in a window too narrow for columns, putting away the sheet in front leaves the other one open behind, not over the conversation", async () => {
	const size = (width: number, height: number) => page.setViewportSize({ width, height });
	const gone = (sel: string) => page.waitForSelector(sel, { state: "detached" });
	try {
		await page.click("[data-slot=tab] >> nth=0");
		if (await page.$("[data-slot=code-panel]")) await menu("code");
		if (await page.$("[data-slot=browser-aside]")) await menu("browser");
		await size(900, 760);
		await menu("browser");
		await sees("[data-slot=sheet-content] [data-slot=browser-aside]");
		await menu("code-agent");
		await sees("[data-slot=sheet-content] [data-slot=code-panel]");
		// Escape puts the side panel away: the browser stays open, behind, and no sheet comes up in its place.
		await page.keyboard.press("Escape");
		await gone("[data-slot=code-panel]");
		await new Promise((r) => setTimeout(r, 300));
		assert.equal(await page.locator("[data-slot=sheet-content]").count(), 0, "no sheet comes up by itself");
		await sees(`${BROWSER_TOGGLE}[aria-pressed=true][data-behind]`);
		await sees(`${CODE_TOGGLE}[aria-pressed=false]`);
		// Its own toggle brings it back as a sheet; its close button puts it away, and the side panel, open behind, stays there.
		await menu("code");
		await menu("browser");
		await sees("[data-slot=sheet-content] [data-slot=browser-aside]");
		await page.click("[data-slot=browser-aside] button[aria-label='Close the browser']");
		await gone("[data-slot=browser-aside]");
		await new Promise((r) => setTimeout(r, 300));
		assert.equal(await page.locator("[data-slot=sheet-content]").count(), 0, "no sheet comes up by itself");
		await sees(`${CODE_TOGGLE}[aria-pressed=true][data-behind]`);
		// Wide again: the one left open shows as a column.
		await size(1280, 820);
		await sees("#code-panel [data-slot=code-panel]");
		await menu("code");
		await gone("[data-slot=code-panel]");
	} finally {
		await size(1800, 900);
		if (await page.$("[data-slot=browser-aside]")) await menu("browser");
		if (await page.$("[data-slot=code-panel]")) await menu("code");
		await size(1280, 820);
	}
});

test("what was typed in a file and not saved stays when the panel becomes a sheet and a column again, and Escape in the editor leaves the sheet open", async () => {
	const size = (width: number, height: number) => page.setViewportSize({ width, height });
	try {
		// The folder's conversation from before is in a worktree by now: a new one in the folder itself.
		await menu(`folder:${folder}`);
		await confirm(":is([data-slot=dialog-title], [data-slot=alert-dialog-title]) >> text=Which agent works in");
		await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=pine-desktop-folder");
		await menu("code-files");
		await sees("[data-slot=code-panel]");
		if (!(await page.$("[data-slot=code-panel] .cm-content"))) {
			await page.fill("[data-slot=code-panel] input[aria-label='Find a file']", "README");
			await page.locator("[data-slot=code-panel] [role=listbox] [role=option]").first().click();
		}
		await sees("[data-slot=code-panel] .cm-content");
		await page.click("[data-slot=code-panel] .cm-content");
		await page.keyboard.press("Meta+End");
		await page.keyboard.type("unsaved draft");
		const save = page.locator("[data-slot=code-panel]").getByRole("button", { name: "Save" });
		assert.ok(await save.isEnabled());
		// Narrower than the room for a column: the panel is drawn again inside a sheet, with the draft still in it.
		await size(900, 760);
		await sees("[data-slot=sheet-content] [data-slot=code-panel] .cm-content");
		assert.match(await page.textContent("[data-slot=code-panel] .cm-content"), /unsaved draft/);
		assert.ok(await save.isEnabled());
		// Escape that closes the editor's search is the editor's, and so is one in the editor itself: the sheet stays.
		await page.click("[data-slot=code-panel] .cm-content");
		await page.keyboard.press("Meta+F");
		await sees("[data-slot=code-panel] .cm-search");
		await page.keyboard.press("Escape");
		await page.waitForSelector("[data-slot=code-panel] .cm-search", { state: "detached" });
		await page.keyboard.press("Escape");
		await new Promise((r) => setTimeout(r, 300));
		assert.equal(await page.locator("[data-slot=sheet-content] [data-slot=code-panel]").count(), 1);
		// Wide again: the panel is a column, and the draft is still there to save or to leave.
		await size(1280, 820);
		await sees("#code-panel [data-slot=code-panel] .cm-content");
		assert.match(await page.textContent("[data-slot=code-panel] .cm-content"), /unsaved draft/);
		assert.ok(await save.isEnabled());
		await page.click("[data-slot=code-panel] button[aria-label='Back to the files']");
		await page.locator("[role=alertdialog]").getByRole("button", { name: "Leave" }).click();
		await page.waitForFunction(() => !document.querySelector("[data-slot=code-panel] .cm-editor"));
		await menu("code");
		await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
	} finally {
		await size(1280, 820);
	}
});

test("a window too narrow for the side panel and the browser side by side shows the one opened last, and both again when it is wide", async () => {
	const size = (width: number, height: number) => page.setViewportSize({ width, height });
	const gone = (sel: string) => page.waitForSelector(sel, { state: "detached" });
	try {
		await page.click("[data-slot=tab] >> nth=0");
		// Wide: the side panel and the browser beside the conversation, both columns.
		await size(1800, 900);
		await menu("code-agent");
		await sees("#code-panel [data-slot=code-panel]");
		if (!(await page.$("[data-slot=browser-aside]"))) await menu("browser");
		await sees("#browser-panel [data-slot=browser-aside]");
		// Narrower (room for a column beside the conversation, not for two): the browser, opened last, stays; the side panel is open behind.
		await size(1280, 820);
		await gone("[data-slot=code-panel]");
		await sees("#browser-panel [data-slot=browser-aside]");
		assert.equal(await page.locator("[data-slot=sheet-content]").count(), 0, "a column, not a sheet");
		await sees(`${CODE_TOGGLE}[aria-pressed=true][data-behind]`);
		await sees(`${BROWSER_TOGGLE}[aria-pressed=true]:not([data-behind])`);
		// Wide again: both, without a click.
		await size(1800, 900);
		await sees("#code-panel [data-slot=code-panel]");
		await sees("#browser-panel [data-slot=browser-aside]");
		await sees(`${CODE_TOGGLE}:not([data-behind])`);
		// Narrow: a click on the icon of the one behind brings it to the front and puts the other behind.
		await size(1280, 820);
		await gone("[data-slot=code-panel]");
		await page.click(CODE_TOGGLE);
		await sees("#code-panel [data-slot=code-panel]");
		await gone("[data-slot=browser-aside]");
		await sees(`${BROWSER_TOGGLE}[data-behind]`);
		// A click on the icon of the one in front closes it, and the other one shows.
		await page.click(CODE_TOGGLE);
		await gone("[data-slot=code-panel]");
		await sees("#browser-panel [data-slot=browser-aside]");
		await sees(`${CODE_TOGGLE}[aria-pressed=false]`);
		// The agent's browser_show brings the browser in front of the side panel.
		await page.click(CODE_TOGGLE);
		await sees("#code-panel [data-slot=code-panel]");
		await gone("[data-slot=browser-aside]");
		const tabs = await page.locator("[data-slot=tab]").count();
		await menu("new");
		await page.waitForFunction((n) => document.querySelectorAll("[data-slot=tab]").length > n, tabs);
		await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "browser_show", args: {} }], text: "Have a look." }, { text: "There it is." }], "Show me the page. "));
		await page.keyboard.press("Enter");
		await sees("#browser-panel [data-slot=browser-aside]");
		await sees("[data-slot=markdown] >> text=There it is.");
		assert.equal(await page.locator("[data-slot=code-panel]").count(), 0);
		await sees(`${CODE_TOGGLE}[data-behind]`);
		await menu("close");
		await page.waitForFunction((n) => document.querySelectorAll("[data-slot=tab]").length === n, tabs);
	} finally {
		// Both closed and the width the start of this file set, for the tests that follow. (Wide, where both show, a toggle closes.)
		await size(1800, 900);
		if (await page.$("[data-slot=browser-aside]")) await menu("browser");
		if (await page.$("[data-slot=code-panel]")) await menu("code");
		await size(1280, 820);
	}
});

/** Where a pine of a test home answers, and its token, as it wrote them. */
const daemonOf = (dir: string) => ({ port: [...fs.readFileSync(path.join(dir, "data", "pine.log"), "utf8").matchAll(/http listening on 127\.0\.0\.1:(\d+)/g)].at(-1)![1], token: fs.readFileSync(path.join(dir, "data", "http-token"), "utf8").trim() });

test("another machine's pine is used from the foot of the side bar, and this Mac's again, each with its own agents", async () => {
	await menu("settings:environments");
	await sees("[data-slot=settings-page] h1 >> text=Environments");
	await sees("[data-environment=local] >> text=in use");
	const input = "[data-slot=settings-page] input[placeholder='you@server']";
	const add = page.locator("[data-slot=settings-page]").getByRole("button", { name: "Add", exact: true });
	// What is not a host for ssh is refused at once, and nothing is kept.
	await page.fill(input, "-oProxyCommand=x");
	await add.click();
	await sees("[data-slot=settings-page] [data-slot=alert] >> text=is not a host for ssh");
	assert.deepEqual((await page.evaluate(() => (window as any).pine.state())).prefs.hosts, []);
	await page.fill(input, "you@elsewhere");
	await add.click();
	await sees("[data-environment='you@elsewhere'] >> text=you@elsewhere");
	assert.deepEqual((await page.evaluate(() => (window as any).pine.state())).prefs.hosts, ["you@elsewhere"]);
	await shot("16-environments");

	// The foot of the side bar lists both machines; the other one is picked, and the window shows its pine.
	await page.click("[data-slot=service-status]");
	await sees("[data-slot=dropdown-menu-radio-item] >> text=This Mac");
	// The menu opens over the side bar, which moves the window: it is no part of that, or a click on it would move the
	// window instead (the system takes it, so a click of the driver's, which goes to the page, cannot show this).
	const region = await page.$$eval("[data-slot=dropdown-menu-content], [data-slot=dropdown-menu-radio-item]", (els: Element[]) => els.map((e) => getComputedStyle(e).getPropertyValue("-webkit-app-region")));
	assert.ok(region.length && region.every((r) => r === "no-drag"), `the menu takes its own clicks: ${region.join(", ")}`);
	await shot("17-machines");
	await page.click("[data-slot=dropdown-menu-radio-item][data-host='you@elsewhere']");
	const agents = () => page.$$eval("[data-slot=agent-label] > :first-child", (els: Element[]) => els.map((e) => e.textContent?.trim()).join());
	await page.waitForFunction(() => [...document.querySelectorAll("[data-slot=agent-label] > :first-child")].map((e) => e.textContent?.trim()).join() === "main,helper", undefined, { timeout: 60_000 });
	assert.match(await page.textContent("[data-slot=service-status]"), /· elsewhere/);
	await sees("[data-slot=empty] >> text=The main agent of the other machine");
	await page.fill("[data-slot=composer] textarea", "hello from this side");
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=ECHO[hello from this side]");
	// It went to the other machine's pine, through the forward, and not to this one's.
	const said = async (dir: string) => {
		const d = daemonOf(dir);
		const tasks = (await (await fetch(`http://127.0.0.1:${d.port}/tasks?agent=main&limit=100`, { headers: { authorization: `Bearer ${d.token}` } })).json()) as Array<{ prompt: string; meta?: { via?: string } }>;
		return tasks.find((t) => t.prompt === "hello from this side");
	};
	assert.ok(await said(far));
	assert.equal(await said(home), undefined);
	// A command in an answer has no Run button there: the terminal is this computer's, and that agent was not told of one.
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "Run this:\n\n```bash\necho far\n```" }], "far commands "));
	await page.keyboard.press("Enter");
	const md = page.locator("[data-slot=markdown]", { hasText: "Run this" }).last();
	await md.locator('[data-streamdown="code-block"]').first().waitFor();
	assert.equal(await md.locator("[data-run]").count(), 0);
	await shot("18-other-machine");

	// Back to this Mac: its own agents and conversation, as they were; the other pine goes on, held by the app.
	const farPort = daemonOf(far).port;
	await page.click("[data-slot=service-status]");
	await page.click("[data-slot=dropdown-menu-radio-item] >> text=This Mac");
	await page.waitForFunction(() => [...document.querySelectorAll("[data-slot=agent-label] > :first-child")].map((e) => e.textContent?.trim()).includes("scout"), undefined, { timeout: 30_000 });
	assert.doesNotMatch(await agents(), /helper/);
	assert.match(await page.textContent("[data-slot=service-status]"), /started here/);
	assert.doesNotMatch((await page.textContent("[data-slot=message-scroller-content]").catch(() => "")) ?? "", /hello from this side/);
	assert.equal(await ours(farPort, far), true);
	assert.equal((await page.evaluate(() => (window as any).pine.state())).prefs.use, undefined);

	// Forgotten: the connection ends, and the pine the app started there with it.
	await menu("settings:environments");
	await page.locator("[data-environment='you@elsewhere']").getByRole("button", { name: "Forget" }).click();
	await page.locator("[data-environment='you@elsewhere']").waitFor({ state: "detached" });
	assert.deepEqual((await page.evaluate(() => (window as any).pine.state())).prefs.hosts, []);
	assert.equal(await daemonGone(farPort, far), true);
	await menu("settings");
});

test("quitting stops the daemon it started", async () => {
	const log = path.join(home, "data", "pine.log");
	assert.ok(fs.existsSync(log));
	await app.close();
	app = undefined;
	// The daemon wrote its last line and is gone: its control port no longer answers.
	const said = fs.readFileSync(log, "utf8");
	assert.match(said, /pine is up/);
	const port = /http listening on 127\.0\.0\.1:(\d+)/.exec(said)?.[1];
	assert.ok(port);
	assert.equal(await daemonGone(port!, home), true);
});
