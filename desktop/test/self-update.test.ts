// The app updates itself: a newer release is downloaded in the background and installed when the
// owner presses "Restart to update" or quits. Driven through the real app on a stand-in for GitHub
// (PINE_DESKTOP_RELEASES) and a stand-in for macOS's updater (PINE_DESKTOP_UPDATER, a folder: the
// stand-in reads what to do from its plan.json and writes each call into calls.jsonl). Installing
// quits the app, so each test starts an app of its own, apart from app.test.ts's one window.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { mockMsg, startMock } from "../../baseline/tests/mock.mjs";
import { browserPlaces } from "../../src/browser-build.ts";
import { launchApp } from "./support/app.ts";
import { daemonGone, freePort, ours, waitForDaemon } from "./support/daemon.ts";

/** The app updates itself on a Mac alone (macOS's updater); on Linux and Windows it links to the release (test/updates.test.ts). */
const OFF_MAC = process.platform !== "darwin" && "the app updates itself on a Mac only";

const root = path.resolve(import.meta.dirname, "..");
const FEED = `https://github.com/pmndre/pine/releases/download/v9.9.9/Pine-${process.arch}.json`;
let mock: any;
let github: http.Server;
let releases: string;
const homes: string[] = [];

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

before(async () => {
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	// GitHub's last release is 9.9.9, with the disk image and the feed of both kinds of Mac; the addresses it names lead elsewhere.
	github = http.createServer((_req, res) => {
		const assets = ["Pine-9.9.9-arm64.dmg", "Pine-9.9.9-x64.dmg", "Pine-arm64.json", "Pine-x64.json"].map((name) => ({ name, browser_download_url: `https://example.invalid/${name}` }));
		res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ tag_name: "v9.9.9", html_url: "https://example.invalid/elsewhere", assets }));
	});
	await new Promise<void>((r) => github.listen(0, "127.0.0.1", r));
	releases = `http://127.0.0.1:${(github.address() as any).port}/repos/pmndre/pine/releases/latest`;
});

after(async () => {
	github?.close();
	await mock?.close?.().catch(() => {});
	for (const home of homes) fs.rmSync(home, { recursive: true, force: true });
});

/** A pine home of its own on a port of its own, the app's preferences, and the stand-in updater's folder with its plan. */
async function setUp(prefs: Record<string, unknown>, outcome: "ready" | "failed" = "ready", install: "quits" | "failed" = "quits") {
	const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-update-")));
	homes.push(home);
	const port = await freePort();
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port }, defaults: { model: "mock/m", mode: "safe", introduce: false } }));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n\nYou are the main agent.\n");
	// The browser of the web tools counts as there, so that its question stands in front of nothing.
	const browsers = path.join(home, "browsers");
	for (const place of (await browserPlaces()) ?? []) write(path.join(browsers, path.basename(place), "INSTALLATION_COMPLETE"), "");
	write(path.join(home, "desktop-data", "prefs.json"), JSON.stringify(prefs));
	const updater = path.join(home, "updater");
	write(path.join(updater, "plan.json"), JSON.stringify({ outcome, install }));
	const calls = () => {
		try {
			return fs.readFileSync(path.join(updater, "calls.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
		} catch {
			return [];
		}
	};
	const launch = async () => {
		const app = await launchApp({ ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers, PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_DESKTOP_DEV_URL: "", PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_RELEASES: releases, PINE_DESKTOP_UPDATER: updater });
		const page = await app.firstWindow();
		await page.waitForSelector("[data-slot=empty] h1", { timeout: 60_000 });
		return { app, page };
	};
	const closed = (app: any) => new Promise<void>((r) => (app.process().exitCode !== null ? r() : app.process().once("exit", () => r())));
	return { home, port, updater, calls, launch, closed, prefs: () => JSON.parse(fs.readFileSync(path.join(home, "desktop-data", "prefs.json"), "utf8")) };
}

const RESTART = "[data-slot=sidebar-footer] [data-sidebar=menu-button]:has-text('Restart to update')";

test("a newer release is downloaded without a word, and Restart to update stops the pine the app started, kept or not, then installs", { skip: OFF_MAC }, async () => {
	const t = await setUp({ keepRunning: true });
	const { app, page } = await t.launch();
	assert.match((await page.textContent("[data-slot=service-status]")) ?? "", /started here/);
	await page.waitForSelector(RESTART, { timeout: 20_000 });
	// Downloaded from the feed of this kind of Mac on GitHub, made by the app and not taken from the answer; no dialog was opened for it.
	assert.deepEqual(t.calls(), [{ call: "download", feed: FEED }]);
	assert.equal(await page.$("[data-slot=dialog-content]"), null);
	const exit = t.closed(app);
	await page.click(RESTART);
	await exit;
	assert.deepEqual(t.calls().map((c: { call: string }) => c.call), ["download", "install"]);
	// "Keep pine running" keeps a pine past a quit, not past an update: the one this app started is gone.
	assert.ok(await daemonGone(t.port, t.home), "the pine the app started was left running on the old version");
});

test("a pine the app only attached to is left alone by an update, and quitting with one ready installs it", { skip: OFF_MAC }, async () => {
	const t = await setUp({});
	// With the browser of the web tools the app is told of too: the daemon is the one that looks for it.
	const daemon: ChildProcess = spawn(process.execPath, [path.join(root, "..", "bin", "pine.js"), "start", "--home", t.home], { stdio: "ignore", env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(t.home, "browsers") } });
	try {
		await waitForDaemon(t.port, t.home);
		const { app, page } = await t.launch();
		assert.match((await page.textContent("[data-slot=service-status]")) ?? "", /attached/);
		await page.waitForSelector(RESTART, { timeout: 20_000 });
		await app.close();
		assert.deepEqual(t.calls().map((c: { call: string }) => c.call), ["download", "install-on-quit"]);
		// Pressed this time: still only installs, and the pine somebody else started goes on.
		const second = await t.launch();
		await second.page.waitForSelector(RESTART, { timeout: 20_000 });
		const exit = t.closed(second.app);
		// (A dialog in front would take the click: said by its words, not as a click that times out.)
		assert.equal(await second.page.$eval("[data-slot=dialog-content]", (e: Element) => e.textContent).catch(() => null), null, "no dialog in front");
		await second.page.click(RESTART);
		await exit;
		assert.deepEqual(t.calls().map((c: { call: string }) => c.call), ["download", "install-on-quit", "download", "install"]);
		assert.ok(await ours(t.port, t.home), "the update stopped a pine the app did not start");
	} finally {
		daemon.kill("SIGTERM");
		await daemonGone(t.port, t.home);
	}
});

test("with Update automatically off the release page is offered and nothing is downloaded; a download that fails says so in one line, with the link", { skip: OFF_MAC }, async () => {
	const t = await setUp({ autoUpdate: false }, "failed");
	const { app, page } = await t.launch();
	await page.waitForSelector("[data-slot=sidebar-footer] >> text=Pine 9.9.9 is available", { timeout: 20_000 });
	assert.deepEqual(t.calls(), []);
	await app.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", "settings"));
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=General");
	const sw = "[data-slot=field]:has-text('Update automatically') [role=switch]";
	await page.waitForSelector(`${sw}[aria-checked=false]`);
	// Turned on, it downloads at once: this one fails, which is said in the app's own words, with the link beside it.
	await page.click(sw);
	await page.waitForSelector(`${sw}[aria-checked=true]`);
	assert.equal(t.prefs().autoUpdate, true);
	await page.waitForSelector("[data-setting=updates] >> text=The update could not be downloaded", { timeout: 20_000 });
	assert.deepEqual(t.calls(), [{ call: "download", feed: FEED }]);
	assert.ok(await page.locator("[data-setting=updates]").getByRole("button", { name: "Release page" }).isVisible());
	await page.waitForSelector("[data-slot=sidebar-footer] >> text=Pine 9.9.9 is available");
	assert.equal(await page.$(RESTART), null);
	// Nothing was ready, so a quit installs nothing.
	await app.close();
	assert.deepEqual(t.calls().map((c: { call: string }) => c.call), ["download"]);
});

const WORKING = "[data-slot=sidebar] [data-slot=pulse]";
const WARNING = "[data-slot=alert-dialog-content]";
const choose = (page: any, label: string) => page.click(`${WARNING} [data-slot=command-item]:has-text('${label}')`);
/** The main agent set to work for a while in a conversation of its own: the model takes `ms` before it answers. */
async function setToWork(page: any, ms: number, words: string) {
	await page.fill("[data-slot=composer] textarea", mockMsg([{ delayMs: ms, text: words }], "Take your time. "));
	await page.keyboard.press("Enter");
	await page.waitForSelector(WORKING, { timeout: 20_000 });
}

test("Restart to update while an agent works warns how many are at work: Cancel does nothing, and a wait for the end can be called off", { skip: OFF_MAC }, async () => {
	const t = await setUp({});
	const { app, page } = await t.launch();
	await page.waitForSelector(RESTART, { timeout: 20_000 });
	await setToWork(page, 4000, "First done.");
	await page.click(RESTART);
	await page.waitForSelector(`${WARNING} >> text=1 conversation`);
	await choose(page, "Cancel");
	await page.waitForSelector(WARNING, { state: "detached" });
	assert.deepEqual(t.calls().map((c: { call: string }) => c.call), ["download"]);
	// Waiting for the end shows in the footer, and the footer calls it off.
	await page.click(RESTART);
	await choose(page, "Restart when they are done");
	const PENDING = "[data-slot=sidebar-footer] [data-sidebar=menu-button]:has-text('Restarts when the work is done')";
	await page.waitForSelector(PENDING);
	await page.click(PENDING);
	await page.waitForSelector(PENDING, { state: "detached" });
	await page.waitForSelector(RESTART);
	// The work ends, and nothing is installed: the wait was called off.
	await page.waitForSelector("[data-slot=markdown] >> text=First done.", { timeout: 20_000 });
	await page.waitForSelector(WORKING, { state: "detached" });
	await new Promise((r) => setTimeout(r, 300));
	assert.deepEqual(t.calls().map((c: { call: string }) => c.call), ["download"]);
	// Asked again on more work, it waits for the end this time, and installs then.
	await setToWork(page, 2500, "Second done.");
	await page.click(RESTART);
	await choose(page, "Restart when they are done");
	await page.waitForSelector(PENDING);
	assert.deepEqual(t.calls().map((c: { call: string }) => c.call), ["download"]);
	const exit = t.closed(app);
	await exit;
	assert.deepEqual(t.calls().map((c: { call: string }) => c.call), ["download", "install"]);
});

test("Restart now in the warning installs at once, with the agent still at work", { skip: OFF_MAC }, async () => {
	const t = await setUp({});
	const { app, page } = await t.launch();
	await page.waitForSelector(RESTART, { timeout: 20_000 });
	await setToWork(page, 15_000, "Never said.");
	await page.click(RESTART);
	const exit = t.closed(app);
	await choose(page, "Restart now");
	await exit;
	assert.deepEqual(t.calls().map((c: { call: string }) => c.call), ["download", "install"]);
});

test("an install that fails after Restart to update starts the app's pine again and offers the release page", { skip: OFF_MAC }, async () => {
	const t = await setUp({}, "ready", "failed");
	const { app, page } = await t.launch();
	await page.waitForSelector(RESTART, { timeout: 20_000 });
	await page.click(RESTART);
	// The pine was stopped for the install; the install failed, so the app goes on with its pine started again.
	await page.waitForSelector("[data-slot=sidebar-footer] >> text=Pine 9.9.9 is available", { timeout: 20_000 });
	assert.equal(await page.$(RESTART), null);
	await waitForDaemon(t.port, t.home, 30_000);
	await page.waitForSelector("[data-slot=service-status] >> text=started here", { timeout: 20_000 });
	assert.deepEqual(t.calls().map((c: { call: string }) => c.call), ["download", "install"]);
	await app.close();
});

test("with an update downloaded, turning Update automatically off offers the release page instead of Restart to update", { skip: OFF_MAC }, async () => {
	const t = await setUp({});
	const { app, page } = await t.launch();
	await page.waitForSelector(RESTART, { timeout: 20_000 });
	await app.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", "settings"));
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=General");
	const sw = "[data-slot=field]:has-text('Update automatically') [role=switch]";
	await page.click(`${sw}[aria-checked=true]`);
	await page.waitForSelector(`${sw}[aria-checked=false]`);
	await page.waitForSelector("[data-slot=sidebar-footer] >> text=Pine 9.9.9 is available", { timeout: 20_000 });
	assert.equal(await page.$(RESTART), null);
	assert.ok(await page.locator("[data-setting=updates]").getByRole("button", { name: "Release page" }).isVisible());
	await app.close();
});
