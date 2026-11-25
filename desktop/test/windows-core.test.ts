// Multi-window core lifecycle, persistence, and coordination end-to-end tests.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { mockMsg, startMock } from "../../baseline/tests/mock.mjs";
import { sandboxMissing } from "../../src/security.ts";
import { allWindowBounds, clickMenu, launchApp, waitForWindow, windowCount } from "./support/app.ts";

let mock: any;
let home: string;
let dataDir: string;
let browsers: string;
let app: ElectronApplication | undefined;

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

async function dismissBrowserAsk(p: Page, expectDialog = true): Promise<void> {
	await p.waitForSelector("[data-slot=empty] h1, [data-slot=no-tab]", { timeout: 25_000 });
	const btn = p.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Not now" });
	if (expectDialog) {
		await btn.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
	}
	if (await btn.isVisible().catch(() => false)) {
		await btn.click();
		await p.waitForSelector("[data-slot=dialog-content]", { state: "detached", timeout: 5000 }).catch(() => {});
	}
}

async function waitForPages(launched: ElectronApplication, count: number, timeout = 15_000): Promise<Page[]> {
	if (launched.windows().length < 1) await launched.firstWindow();
	const deadline = Date.now() + timeout;
	while (launched.windows().length < count) {
		if (Date.now() > deadline) throw new Error(`expected ${count} Playwright pages, got ${launched.windows().length}`);
		await launched.waitForEvent("window", { timeout: Math.min(2000, Math.max(200, deadline - Date.now())) }).catch(() => {});
	}
	return launched.windows();
}

async function startPineApp(expectBrowserDialog = false): Promise<{ app: ElectronApplication; page: Page }> {
	const launched = await launchApp({
		...process.env,
		PLAYWRIGHT_BROWSERS_PATH: browsers,
		PINE_HOME: home,
		PINE_DESKTOP_DATA: dataDir,
		PINE_SKIP_DOWNLOADS: "1",
		PINE_DESKTOP_DEV_URL: "",
		PINE_DESKTOP_RELEASES: "",
	});
	const first = await launched.firstWindow();
	await dismissBrowserAsk(first, expectBrowserDialog);
	return { app: launched, page: first };
}

before(async () => {
	if (process.platform === "linux" && sandboxMissing()) throw new Error(`No sandbox: ${sandboxMissing()}`);
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-mw-core-")));
	dataDir = path.join(home, "desktop-data");
	browsers = path.join(home, "browsers");
	fs.mkdirSync(browsers, { recursive: true });
	write(
		path.join(home, "models.json"),
		JSON.stringify({
			providers: {
				mock: {
					name: "Mock",
					baseUrl: mock.baseUrl,
					api: "openai-completions",
					apiKey: "sk-mock",
					models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
				},
			},
		}),
	);
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe", introduce: false, thinking: "off" }, security: { askAccess: false } }, null, 2));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ approve: ["bash"] }));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n");
	write(path.join(home, "agents", "scout", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "scout", "workspace", "AGENTS.md"), "Scout agent.\n");
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	if (home) fs.rmSync(home, { recursive: true, force: true });
});

test("File > New Window cascades, opens on NoTab when env is already open, and Close Tab / Close Window close as specified", async () => {
	const started = await startPineApp(true);
	app = started.app;
	const win1 = started.page;

	// Window 1 has main tab open.
	await win1.waitForSelector("[data-slot=tab][data-active]");
	assert.equal(await windowCount(app), 1);

	// File > New Window opens Window 2 cascaded +24,+24 and starting on NoTab.
	const win2 = await waitForWindow(app, () => clickMenu(app!, ["File", "New Window"], 0));
	await win2.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });
	assert.equal(await windowCount(app), 2);
	assert.equal(await win2.locator("[data-slot=tab]").count(), 0);

	const bounds = await allWindowBounds(app);
	assert.equal(bounds.length, 2);
	assert.ok(bounds[1].x >= bounds[0].x && bounds[1].y >= bounds[0].y, `expected cascaded bounds: ${JSON.stringify(bounds)}`);
	assert.ok(bounds[1].x !== bounds[0].x || bounds[1].y !== bounds[0].y, `expected offset bounds: ${JSON.stringify(bounds)}`);

	// Pressing Close Tab on NoTab closes Window 2.
	await clickMenu(app, ["File", "Close Tab"], 1);
	await app.evaluate(
		({ BrowserWindow }: any) =>
			new Promise<void>((resolve, reject) => {
				const deadline = Date.now() + 5000;
				const check = () => (BrowserWindow.getAllWindows().length === 1 ? resolve() : Date.now() > deadline ? reject(new Error("window 2 did not close")) : setTimeout(check, 50));
				check();
			}),
	);
	assert.equal(await windowCount(app), 1);

	// Open another window via Command Palette "New window", then close it with File > Close Window.
	await clickMenu(app, ["View", "Command Palette…"], 0);
	await win1.waitForSelector("[data-slot=command-input]");
	await win1.fill("[data-slot=command-input]", "New window");
	const win3 = await waitForWindow(app, () => win1.locator("[data-slot=command-item]", { hasText: /New window/i }).first().click());
	await win3.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });
	assert.equal(await windowCount(app), 2);

	// Open a tab in win3, then File > Close Window closes win3 immediately even with an open tab.
	await win3.locator("[data-slot=no-tab]").getByRole("button", { name: /Open main/i }).click();
	await win3.waitForSelector("[data-slot=tab][data-active]");
	await clickMenu(app, ["File", "Close Window"], 1);
	await app.evaluate(
		({ BrowserWindow }: any) =>
			new Promise<void>((resolve, reject) => {
				const deadline = Date.now() + 5000;
				const check = () => (BrowserWindow.getAllWindows().length === 1 ? resolve() : Date.now() > deadline ? reject(new Error("window 3 did not close")) : setTimeout(check, 50));
				check();
			}),
	);
	assert.equal(await windowCount(app), 1);
});

test("independent per-window tabs, panel layouts, per-window pine-media:, /ui/tabs union, and closeSession protection", async () => {
	assert.ok(app, "app is running from previous test");
	const win1 = app.windows()[0];
	await win1.waitForSelector("[data-slot=tab][data-active]");

	// Open a second window (starts on NoTab).
	const win2 = await waitForWindow(app, () => clickMenu(app!, ["File", "New Window"], 0));
	await win2.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });

	// Each window has its own unique pine-media://window-<id> mediaBase.
	const mb1 = await win1.evaluate(() => (window as any).pine.mediaBase);
	const mb2 = await win2.evaluate(() => (window as any).pine.mediaBase);
	assert.match(mb1, /^pine-media:\/\/window-w\d+$/);
	assert.match(mb2, /^pine-media:\/\/window-w\d+$/);
	assert.notEqual(mb1, mb2);

	// Hide sidebar in win2 only; win1's sidebar stays visible.
	await clickMenu(app, ["View", "Toggle Sidebar"], 1);
	await win2.waitForSelector("#sidebar-panel [data-slot=sidebar]", { state: "detached" });
	assert.equal(await win1.locator("#sidebar-panel [data-slot=sidebar]").count(), 1);

	// Open scout:main in win2 and a shared non-main conversation ("shared-sub") in both win1 and win2.
	await win2.locator("[data-slot=no-tab]").getByRole("button", { name: /Open main/i }).click();
	await win2.waitForSelector("[data-slot=tab][data-active]");
	// Start a non-main conversation in win1 via API/tab and open it in both windows.
	await win1.evaluate(() => (window as any).pine.call("POST", "/agents/scout/sessions/shared-sub/folder", { folder: null }).catch(() => {}));
	// Create a dummy source and subscribe scout:shared-sub to it so we can verify closeSession protection.
	const srcRes = await win1.evaluate(() => (window as any).pine.call("POST", "/sources", { name: "mw-test-src", type: "webhook", options: {} }));
	assert.equal(srcRes.ok, true, JSON.stringify(srcRes));
	// Open scout:shared-sub in win1 and win2 via slash /new or UI: openTab via palette/sidebar or command.
	// Use /new shared-sub in scout's tab:
	await win1.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { has: win1.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }) }).locator("[data-slot=agent-label]").click();
	await win1.waitForSelector("[data-slot=tab][data-active] [data-slot=tab-name] >> text=scout");
	await win1.fill("[data-slot=composer] textarea", "/new shared-sub");
	await win1.keyboard.press("Enter");
	await win1.waitForSelector("[data-slot=tab][data-active] [data-slot=tab-name] >> text=shared-sub");

	// Subscribe this conversation to mw-test-src.
	await win1.fill("[data-slot=composer] textarea", "/subscribe local mw-test-src");
	await win1.keyboard.press("Enter");
	await win1.waitForSelector("text=subscribed to mw-test-src", { timeout: 10_000 });

	// Open the same scout:shared-sub in win2 via /new shared-sub after opening scout.
	await clickMenu(app, ["View", "Toggle Sidebar"], 1);
	await win2.waitForSelector("#sidebar-panel [data-slot=sidebar]");
	await win2.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { has: win2.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }) }).locator("[data-slot=agent-label]").click();
	await win2.waitForSelector("[data-slot=tab][data-active] [data-slot=tab-name] >> text=scout");
	await win2.fill("[data-slot=composer] textarea", "/new shared-sub");
	await win2.keyboard.press("Enter");
	await win2.waitForSelector("[data-slot=tab][data-active] [data-slot=tab-name] >> text=shared-sub");

	// Verify daemon /ui/tabs contains the deduplicated union of tabs across both windows.
	await new Promise((r) => setTimeout(r, 250));
	const daemonTabs = await win1.evaluate(() => (window as any).pine.call("GET", "/ui/tabs"));
	assert.equal(daemonTabs.ok, true);
	const keys = daemonTabs.data.tabs.map((t: any) => `${t.agent}:${t.session}`);
	assert.ok(keys.includes("main:main"), `expected main:main in ${JSON.stringify(keys)}`);
	assert.ok(keys.includes("scout:shared-sub"), `expected scout:shared-sub in ${JSON.stringify(keys)}`);
	assert.equal(keys.filter((k: string) => k === "scout:shared-sub").length, 1, "union should be deduplicated");

	// Close scout:shared-sub in win2: subscription must STAY alive because win1 still has it open!
	await clickMenu(app, ["File", "Close Tab"], 1);
	await new Promise((r) => setTimeout(r, 300));
	const subsAfterFirstClose = await win1.evaluate(() => (window as any).pine.call("GET", "/sources"));
	const mwSrc1 = subsAfterFirstClose.data.find((s: any) => s.name === "mw-test-src");
	assert.ok(mwSrc1?.subscribers?.includes("scout/shared-sub"), `subscription should stay alive while win1 holds tab: ${JSON.stringify(mwSrc1)}`);

	// Now close scout:shared-sub in win1: subscription MUST end now that no window holds it!
	await clickMenu(app, ["File", "Close Tab"], 0);
	await new Promise((r) => setTimeout(r, 400));
	const subsAfterSecondClose = await win1.evaluate(() => (window as any).pine.call("GET", "/sources"));
	const mwSrc2 = subsAfterSecondClose.data.find((s: any) => s.name === "mw-test-src");
	assert.ok(!mwSrc2?.subscribers?.includes("scout/shared-sub"), `subscription should end when last window closes tab: ${JSON.stringify(mwSrc2)}`);

	// Hide sidebar in win2 again before testing persistence.
	await clickMenu(app, ["View", "Toggle Sidebar"], 1);
	await win2.waitForSelector("#sidebar-panel [data-slot=sidebar]", { state: "detached" });
});

test("quitting preserves all open windows on relaunch, while closing all windows individually reopens a single window", async () => {
	assert.ok(app, "app is running with 2 windows from previous test");
	assert.equal(await windowCount(app), 2);
	await new Promise((r) => setTimeout(r, 250));

	// Quit the app while 2 windows are open.
	await app.close();
	app = undefined;

	// Verify prefs.json saved 2 open windows.
	const prefsOnDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "prefs.json"), "utf8"));
	assert.equal(prefsOnDisk.windows?.length, 2, `expected 2 saved windows in prefs.json: ${JSON.stringify(prefsOnDisk.windows)}`);

	// Relaunch: both windows should restore with their own sidebar state!
	const relaunched = await launchApp({
		...process.env,
		PLAYWRIGHT_BROWSERS_PATH: browsers,
		PINE_HOME: home,
		PINE_DESKTOP_DATA: dataDir,
		PINE_SKIP_DOWNLOADS: "1",
		PINE_DESKTOP_DEV_URL: "",
		PINE_DESKTOP_RELEASES: "",
	});
	app = relaunched;

	// Wait for both restored windows.
	const pages = await waitForPages(app, 2);
	assert.equal(await windowCount(app), 2);
	assert.equal(pages.length, 2);
	for (const p of pages) await p.waitForSelector("[data-slot=tab][data-active]", { timeout: 25_000 });

	// One restored window has sidebar shown, the other has sidebar hidden.
	const sidebars = await Promise.all(pages.map((p) => p.locator("#sidebar-panel [data-slot=sidebar]").count()));
	assert.deepEqual(sidebars.sort(), [0, 1], `expected one sidebar shown and one hidden, got ${JSON.stringify(sidebars)}`);

	// Close both windows individually before quitting.
	await clickMenu(app, ["File", "Close Window"], 1);
	await app.evaluate(
		({ BrowserWindow }: any) =>
			new Promise<void>((resolve, reject) => {
				const deadline = Date.now() + 5000;
				const check = () => (BrowserWindow.getAllWindows().length === 1 ? resolve() : Date.now() > deadline ? reject(new Error("window did not close")) : setTimeout(check, 50));
				check();
			}),
	);
	if (process.platform === "darwin") {
		// On a Mac the app stays when its last window closes: wait for the window, then quit.
		await clickMenu(app, ["File", "Close Window"], 0);
		await app.evaluate(
			({ BrowserWindow }: any) =>
				new Promise<void>((resolve, reject) => {
					const deadline = Date.now() + 5000;
					const check = () => (BrowserWindow.getAllWindows().length === 0 ? resolve() : Date.now() > deadline ? reject(new Error("last window did not close")) : setTimeout(check, 50));
					check();
				}),
		);
		await app.close();
	} else {
		// Elsewhere closing the last window quits the app (window-all-closed): nothing is left to ask, so wait for it to end.
		const ended = app.waitForEvent("close", { timeout: 15_000 });
		await clickMenu(app, ["File", "Close Window"], 0);
		await ended;
	}
	app = undefined;

	// Closing every window one by one leaves none to restore: a relaunch opens a single window.

	const prefsAfterCloseAll = JSON.parse(fs.readFileSync(path.join(dataDir, "prefs.json"), "utf8"));
	assert.equal(prefsAfterCloseAll.windows?.length ?? 0, 0, `expected 0 saved windows after closing all: ${JSON.stringify(prefsAfterCloseAll.windows)}`);

	const single = await startPineApp();
	app = single.app;
	await single.page.waitForSelector("[data-slot=tab][data-active]", { timeout: 25_000 });
	assert.equal(await windowCount(app), 1);
});

test("shared SSE stream fans out live events without duplicate notifications or double-counted badges", async () => {
	// Started here when the test before left no app, so that its failure does not become this one's too.
	if (!app || app.windows().length === 0) {
		await app?.close().catch(() => {});
		app = (await startPineApp()).app;
	}
	const win1 = app.windows()[0];
	await win1.waitForSelector("[data-slot=tab][data-active]");

	// Open a second window and open main:main in it too so both windows view the same conversation.
	const win2 = await waitForWindow(app, () => clickMenu(app!, ["File", "New Window"], 0));
	await win2.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });
	await win2.locator("[data-slot=no-tab]").getByRole("button", { name: /Open main/i }).click();
	await win2.waitForSelector("[data-slot=tab][data-active]");

	// Clear quiet notification log and spy on OS badge updates.
	await app.evaluate(({ app: electronApp, BrowserWindow }: any) => {
		(globalThis as any).quiet.notified = [];
		const badges: number[] = ((globalThis as any).__badgeSpy = []);
		if (process.platform === "darwin" && electronApp.dock) {
			const orig = electronApp.dock.setBadge.bind(electronApp.dock);
			electronApp.dock.setBadge = (text: string) => {
				badges.push(Number(text) || 0);
				return orig(text);
			};
		} else if (process.platform === "win32") {
			const orig = BrowserWindow.prototype.setOverlayIcon;
			BrowserWindow.prototype.setOverlayIcon = function (this: any, overlay: any, desc: string) {
				const m = /^(\d+)/.exec(String(desc ?? ""));
				badges.push(overlay && m ? Number(m[1]) : 0);
				return orig.call(this, overlay, desc);
			};
		} else {
			const orig = electronApp.setBadgeCount.bind(electronApp);
			electronApp.setBadgeCount = (count: number) => {
				badges.push(Number(count) || 0);
				return orig(count);
			};
		}
	});

	// Send a prompt in win1 on main:main: both win1 and win2 receive the live echoed answer through the shared SSE stream.
	await win1.locator("[data-slot=tab]", { hasText: "main" }).first().click();
	await win1.fill("[data-slot=composer] textarea", "hello both windows");
	await win1.locator("[data-slot=composer] textarea").press("Enter");
	await win1.waitForSelector("[data-slot=markdown] >> text=ECHO[hello both windows]", { timeout: 15_000 });
	await win2.waitForSelector("[data-slot=markdown] >> text=ECHO[hello both windows]", { timeout: 15_000 });

	// At most one desktop notification was emitted (never duplicated by two windows viewing the same env).
	const notified = await app.evaluate(() => (globalThis as any).quiet.notified);
	assert.ok(notified.length <= 1, `expected at most 1 notification, got ${JSON.stringify(notified)}`);

	// Trigger a real bash approval on main while both windows view main:main.
	// Approval must route cleanly and aggregated OS badge count must be 1 (never double-counted as 2).
	await app.evaluate(() => {
		(globalThis as any).__badgeSpy.length = 0;
	});
	await win1.fill(
		"[data-slot=composer] textarea",
		mockMsg([{ tools: [{ name: "bash", args: { command: "echo badge-check" } }] }, { text: "badge check done" }], "run bash "),
	);
	await win1.locator("[data-slot=composer] textarea").press("Enter");
	await win1.waitForSelector("[data-slot=dialog-content][data-tone=warn]", { timeout: 15_000 });
	assert.match((await win1.textContent("[data-slot=dialog-content][data-tone=warn]")) ?? "", /Approval needed[\s\S]*echo badge-check/);
	await new Promise((r) => setTimeout(r, 200));

	const badgesWhileOpen: number[] = await app.evaluate(() => [...((globalThis as any).__badgeSpy ?? [])]);
	assert.ok(badgesWhileOpen.includes(1), `expected badge count 1 while approval is open, got ${JSON.stringify(badgesWhileOpen)}`);
	assert.equal(Math.max(0, ...badgesWhileOpen), 1, `expected deduplicated badge count 1 (not 2), got ${JSON.stringify(badgesWhileOpen)}`);

	// Approve from win1; both windows finish the turn and badge resets to 0.
	await win1.locator("[data-slot=dialog-content][data-tone=warn]").getByRole("button", { name: /^Allow/ }).click();
	await win1.waitForSelector("[data-slot=markdown] >> text=badge check done", { timeout: 15_000 });
	await win2.waitForSelector("[data-slot=markdown] >> text=badge check done", { timeout: 15_000 });
	await new Promise((r) => setTimeout(r, 200));
	const badgesAfter: number[] = await app.evaluate(() => [...((globalThis as any).__badgeSpy ?? [])]);
	assert.equal(badgesAfter.at(-1), 0, `expected badge to reset to 0 after approval decided, got ${JSON.stringify(badgesAfter)}`);
});

