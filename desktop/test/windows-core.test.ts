// Multi-window core lifecycle, persistence, and coordination end-to-end tests.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { mockMsg, startMock } from "../../baseline/tests/mock.mjs";
import { browserPlaces } from "../../src/browser-build.ts";
import { sandboxMissing } from "../../src/security.ts";
import { launchApp, patient, sendMenuTo, waitForWindow, windowCount } from "./support/app.ts";

let mock: any;
let home: string;
let dataDir: string;
let browsers: string;
let app: ElectronApplication | undefined;

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

/**
 * A menu item's click, found by its key and not by its wording, for the window at `index` (in the order the windows
 * were made). The items that only send the page a command are sent as that command instead (`sendMenuTo`).
 */
async function menuKey(launched: ElectronApplication, accelerator: string, index: number): Promise<void> {
	await launched.evaluate(
		({ BrowserWindow, Menu }: any, [key, idx]: [string, number]) => {
			const target = [...BrowserWindow.getAllWindows()].sort((a: any, b: any) => a.id - b.id)[idx];
			if (!target || target.isDestroyed()) throw new Error(`no window ${idx}`);
			target.emit("focus");
			const find = (items: any[]): any => {
				for (const i of items) {
					if (i.accelerator === key && typeof i.click === "function") return i;
					const below = i.submenu ? find(i.submenu.items) : undefined;
					if (below) return below;
				}
			};
			const found = find(Menu.getApplicationMenu()?.items ?? []);
			if (!found) throw new Error(`no menu item with the key ${key}`);
			found.click(found, target, undefined);
		},
		[accelerator, index] as [string, number],
	);
}
const NEW_WINDOW = "CmdOrCtrl+N";
const CLOSE_TAB = "CmdOrCtrl+W";
const CLOSE_WINDOW = "CmdOrCtrl+Shift+W";

/** Waits until the app has that many windows. */
async function windowsAre(launched: ElectronApplication, expected: number): Promise<void> {
	await launched.evaluate(
		({ BrowserWindow }: any, [n, ms]: [number, number]) =>
			new Promise<void>((resolve, reject) => {
				const deadline = Date.now() + ms;
				const check = () => (BrowserWindow.getAllWindows().length === n ? resolve() : Date.now() > deadline ? reject(new Error(`expected ${n} windows, got ${BrowserWindow.getAllWindows().length}`)) : setTimeout(check, 50));
				check();
			}),
		[expected, patient(10_000)] as [number, number],
	);
}

/** Asks until `ok` says yes to what was answered, and says what was answered last when it never does. */
async function until<T>(what: string, ask: () => Promise<T>, ok: (answer: T) => boolean): Promise<T> {
	const deadline = Date.now() + patient(15_000);
	let last = await ask();
	while (!ok(last)) {
		if (Date.now() > deadline) assert.fail(`${what}: ${JSON.stringify(last)}`);
		await new Promise((r) => setTimeout(r, 100));
		last = await ask();
	}
	return last;
}

const call = (p: Page, method: string, url: string, body?: unknown) => p.evaluate(([m, u, b]: [string, string, unknown]) => (window as any).pine.call(m, u, b), [method, url, body] as [string, string, unknown]);
/** Who is subscribed to a source, as the daemon says. */
const subscribers = async (p: Page, source: string): Promise<string[]> => (await call(p, "GET", "/sources")).data.find((s: any) => s.name === source)?.subscribers ?? [];
/** The window's preferences on disk; nothing while the app is writing them. */
const prefsOnDisk = (): any => {
	try {
		return JSON.parse(fs.readFileSync(path.join(dataDir, "prefs.json"), "utf8"));
	} catch {
		return undefined;
	}
};
/** An agent's main conversation, opened from the side bar by the agent's name. */
const openAgent = async (p: Page, agent: string) => {
	await p.locator("[data-slot=sidebar] [data-slot=agent-label]").getByText(agent, { exact: true }).first().click();
	await p.locator("[data-slot=tab][data-active] [data-slot=tab-name]", { hasText: agent }).waitFor();
};
const FIRST = "[data-slot=no-tab], [data-slot=tab][data-active]";

async function waitForPages(launched: ElectronApplication, count: number, timeout = 15_000): Promise<Page[]> {
	if (launched.windows().length < 1) await launched.firstWindow();
	const deadline = Date.now() + timeout;
	while (launched.windows().length < count) {
		if (Date.now() > deadline) throw new Error(`expected ${count} Playwright pages, got ${launched.windows().length}`);
		await launched.waitForEvent("window", { timeout: Math.min(2000, Math.max(200, deadline - Date.now())) }).catch(() => {});
	}
	return launched.windows();
}

async function startPineApp(): Promise<{ app: ElectronApplication; page: Page }> {
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
	await first.waitForSelector(FIRST, { timeout: patient(30_000) });
	return { app: launched, page: first };
}

before(async () => {
	if (process.platform === "linux" && sandboxMissing()) throw new Error(`No sandbox: ${sandboxMissing()}`);
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-mw-core-")));
	dataDir = path.join(home, "desktop-data");
	// The browser of the web tools counts as there, so that the app's question about it lies over nothing here (app.test.ts tests it).
	browsers = path.join(home, "browsers");
	fs.mkdirSync(browsers, { recursive: true });
	for (const place of (await browserPlaces()) ?? []) write(path.join(browsers, path.basename(place), "INSTALLATION_COMPLETE"), "");
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

test("a new window opens without a tab when its pine is already open, and Close Tab / Close Window close as specified", async () => {
	const started = await startPineApp();
	app = started.app;
	const win1 = started.page;

	// Window 1 has main tab open.
	await win1.waitForSelector("[data-slot=tab][data-active]");
	assert.equal(await windowCount(app), 1);

	// The menu's New Window opens a second window, which starts without a tab. (Where it is put is window-layout.test.ts's.)
	const win2 = await waitForWindow(app, () => menuKey(app!, NEW_WINDOW, 0));
	await win2.waitForSelector("[data-slot=no-tab]", { timeout: patient(20_000) });
	assert.equal(await windowCount(app), 2);
	assert.equal(await win2.locator("[data-slot=tab]").count(), 0);

	// Close Tab in a window without a tab closes the window.
	await menuKey(app, CLOSE_TAB, 1);
	await windowsAre(app, 1);

	// Another window from the palette's own command, then closed with Close Window.
	await sendMenuTo(app, 0, "palette");
	await win1.waitForSelector("[data-slot=command-input]");
	const win3 = await waitForWindow(app, () => win1.locator('[data-slot=command-item][data-value="c:new-window"]').click());
	await win3.waitForSelector("[data-slot=no-tab]", { timeout: patient(20_000) });
	assert.equal(await windowCount(app), 2);

	// With a tab open in it, Close Window still closes the window at once.
	await win3.locator("[data-slot=no-tab] [data-action=open-main]").click();
	await win3.waitForSelector("[data-slot=tab][data-active]");
	await menuKey(app, CLOSE_WINDOW, 1);
	await windowsAre(app, 1);
});

test("independent per-window tabs, panel layouts, per-window pine-media:, /ui/tabs union, and closeSession protection", async () => {
	assert.ok(app, "app is running from previous test");
	const win1 = app.windows()[0];
	await win1.waitForSelector("[data-slot=tab][data-active]");

	// Open a second window (starts on NoTab).
	const win2 = await waitForWindow(app, () => menuKey(app!, NEW_WINDOW, 0));
	await win2.waitForSelector("[data-slot=no-tab]", { timeout: patient(20_000) });

	// Each window has its own unique pine-media://window-<id> mediaBase.
	const mb1 = await win1.evaluate(() => (window as any).pine.mediaBase);
	const mb2 = await win2.evaluate(() => (window as any).pine.mediaBase);
	assert.match(mb1, /^pine-media:\/\/window-w\d+$/);
	assert.match(mb2, /^pine-media:\/\/window-w\d+$/);
	assert.notEqual(mb1, mb2);

	// Hide sidebar in win2 only; win1's sidebar stays visible.
	await sendMenuTo(app, 1, "sidebar");
	await win2.waitForSelector("#sidebar-panel [data-slot=sidebar]", { state: "detached" });
	assert.equal(await win1.locator("#sidebar-panel [data-slot=sidebar]").count(), 1);

	// The main conversation in win2, and a conversation of scout's ("shared-sub") in both windows.
	await win2.locator("[data-slot=no-tab] [data-action=open-main]").click();
	await win2.waitForSelector("[data-slot=tab][data-active]");
	// A source that conversation subscribes to, to see what closing its tab ends.
	const srcRes = await call(win1, "POST", "/sources", { name: "mw-test-src", type: "webhook", options: {} });
	assert.equal(srcRes.ok, true, JSON.stringify(srcRes));
	const sharedTab = (p: Page) => p.locator("[data-slot=tab] [data-slot=tab-name]", { hasText: "shared-sub" });
	await openAgent(win1, "scout");
	await win1.fill("[data-slot=composer] textarea", "/new shared-sub");
	await win1.keyboard.press("Enter");
	await win1.locator("[data-slot=tab][data-active] [data-slot=tab-name]", { hasText: "shared-sub" }).waitFor();
	await win1.fill("[data-slot=composer] textarea", "/subscribe local mw-test-src");
	await win1.keyboard.press("Enter");
	await until("the conversation subscribed to the source", () => subscribers(win1, "mw-test-src"), (subs) => subs.includes("scout/shared-sub"));

	// The same conversation in win2.
	await sendMenuTo(app, 1, "sidebar");
	await win2.waitForSelector("#sidebar-panel [data-slot=sidebar]");
	await openAgent(win2, "scout");
	await win2.fill("[data-slot=composer] textarea", "/new shared-sub");
	await win2.keyboard.press("Enter");
	await win2.locator("[data-slot=tab][data-active] [data-slot=tab-name]", { hasText: "shared-sub" }).waitFor();

	// The daemon's list of open tabs is what both windows have open, each conversation once.
	const keys = await until(
		"the daemon's tabs hold what both windows have open",
		async () => ((await call(win1, "GET", "/ui/tabs")).data?.tabs ?? []).map((t: any) => `${t.agent}:${t.session}`) as string[],
		(k) => k.includes("main:main") && k.includes("scout:shared-sub"),
	);
	assert.equal(keys.filter((k: string) => k === "scout:shared-sub").length, 1, `a conversation open in two windows is listed once: ${JSON.stringify(keys)}`);

	// Closed in win2, the conversation keeps its subscription: win1 still has it open.
	await menuKey(app, CLOSE_TAB, 1);
	await sharedTab(win2).waitFor({ state: "detached" });
	assert.ok((await subscribers(win1, "mw-test-src")).includes("scout/shared-sub"), "the subscription stays while win1 has the tab");
	await win1.locator("[data-slot=tab][data-active] [data-slot=tab-name]", { hasText: "shared-sub" }).waitFor();
	assert.ok((await subscribers(win1, "mw-test-src")).includes("scout/shared-sub"), "the subscription stays while win1 has the tab");

	// Closed in win1 too, no window has it: the subscription ends.
	await menuKey(app, CLOSE_TAB, 0);
	await sharedTab(win1).waitFor({ state: "detached" });
	await until("the subscription ended with the last window's tab", () => subscribers(win1, "mw-test-src"), (subs) => !subs.includes("scout/shared-sub"));

	// The side bar of win2 hidden again, for the test of what a quit keeps; kept once the app wrote it down.
	await sendMenuTo(app, 1, "sidebar");
	await win2.waitForSelector("#sidebar-panel [data-slot=sidebar]", { state: "detached" });
	await until("both windows are kept, one without its side bar", async () => (prefsOnDisk()?.windows ?? []).map((w: any) => w.layout?.sidebar), (bars: unknown[]) => bars.length === 2 && bars.includes(false) && bars.includes(true));
});

test("quitting preserves all open windows on relaunch, while closing all windows individually reopens a single window", async () => {
	assert.ok(app, "app is running with 2 windows from previous test");
	assert.equal(await windowCount(app), 2);

	// Quit the app while 2 windows are open.
	await app.close();
	app = undefined;

	// Both windows are kept.
	assert.equal(prefsOnDisk()?.windows?.length, 2, `expected 2 saved windows in prefs.json: ${JSON.stringify(prefsOnDisk()?.windows)}`);

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
	for (const p of pages) await p.waitForSelector("[data-slot=tab][data-active]", { timeout: patient(30_000) });

	// One restored window has sidebar shown, the other has sidebar hidden.
	const sidebars = await Promise.all(pages.map((p) => p.locator("#sidebar-panel [data-slot=sidebar]").count()));
	assert.deepEqual(sidebars.sort(), [0, 1], `expected one sidebar shown and one hidden, got ${JSON.stringify(sidebars)}`);

	// Close both windows individually before quitting.
	await menuKey(app, CLOSE_WINDOW, 1);
	await windowsAre(app, 1);
	if (process.platform === "darwin") {
		// On a Mac the app stays when its last window closes: wait for the window, then quit.
		await menuKey(app, CLOSE_WINDOW, 0);
		await windowsAre(app, 0);
		await app.close();
	} else {
		// Elsewhere closing the last window quits the app (window-all-closed): nothing is left to ask, so wait for it to end.
		const ended = app.waitForEvent("close", { timeout: 15_000 });
		await menuKey(app, CLOSE_WINDOW, 0);
		await ended;
	}
	app = undefined;

	// Closing every window one by one leaves none to restore: a relaunch opens a single window.

	assert.equal(prefsOnDisk()?.windows?.length ?? 0, 0, `expected 0 saved windows after closing all: ${JSON.stringify(prefsOnDisk()?.windows)}`);

	const single = await startPineApp();
	app = single.app;
	await single.page.waitForSelector("[data-slot=tab][data-active]", { timeout: patient(30_000) });
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
	const win2 = await waitForWindow(app, () => menuKey(app!, NEW_WINDOW, 0));
	await win2.waitForSelector("[data-slot=no-tab]", { timeout: patient(20_000) });
	await win2.locator("[data-slot=no-tab] [data-action=open-main]").click();
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
	await win1.waitForSelector("[data-slot=markdown] >> text=ECHO[hello both windows]", { timeout: patient(20_000) });
	await win2.waitForSelector("[data-slot=markdown] >> text=ECHO[hello both windows]", { timeout: patient(20_000) });

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
	// The question is put in win1, about the command the test scripted, and both windows know of it.
	const asking = win1.locator("[role=dialog]", { has: win1.locator("[data-action=allow]"), hasText: "echo badge-check" });
	await asking.waitFor({ timeout: patient(20_000) });
	await win2.waitForSelector("[data-item=approval][data-state=open]", { timeout: patient(20_000) });
	const badges = (): Promise<number[]> => app!.evaluate(() => [...((globalThis as any).__badgeSpy ?? [])]);
	await until("the badge counts the open question", badges, (b) => b.includes(1));

	// Allowed in win1; both windows finish the turn and the badge goes back to none.
	await asking.locator("[data-action=allow]").click();
	await win1.waitForSelector("[data-slot=markdown] >> text=badge check done", { timeout: patient(20_000) });
	await win2.waitForSelector("[data-slot=markdown] >> text=badge check done", { timeout: patient(20_000) });
	const seen = await until("the badge is taken away once the question is answered", badges, (b) => b.at(-1) === 0);
	// One question, seen by two windows, never counted as two.
	assert.equal(Math.max(0, ...seen), 1, `expected the badge to count the question once, got ${JSON.stringify(seen)}`);
});

