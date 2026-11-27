// Multi-window Move to New Window, Open in New Window, tab drag-and-drop guard, and per-window local terminal isolation tests.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { startMock } from "../../baseline/tests/mock.mjs";
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

/** An agent's main conversation, opened from the side bar by the agent's name. */
const openAgent = async (p: Page, agent: string) => {
	await p.locator("[data-slot=sidebar] [data-slot=agent-label]").getByText(agent, { exact: true }).first().click();
	await p.locator("[data-slot=tab][data-active] [data-slot=tab-name]", { hasText: agent }).waitFor();
};
/** What a window shows first: a conversation, or that it has no tab. */
const FIRST = "[data-slot=no-tab], [data-slot=tab][data-active]";

const call = (p: Page, method: string, url: string, body?: unknown) => p.evaluate(([m, u, b]: [string, string, unknown]) => (window as any).pine.call(m, u, b), [method, url, body] as [string, string, unknown]);
/** Who is subscribed to a source, as the daemon says. */
const subscribers = async (p: Page, source: string): Promise<string[]> => (await call(p, "GET", "/sources")).data.find((s: any) => s.name === source)?.subscribers ?? [];

async function startPineApp(): Promise<{ app: ElectronApplication; page: Page }> {
	const launched = await launchApp({
		...process.env,
		PLAYWRIGHT_BROWSERS_PATH: browsers,
		PINE_HOME: home,
		PINE_DESKTOP_DATA: dataDir,
		PINE_SKIP_DOWNLOADS: "1",
		PINE_DESKTOP_DEV_URL: "",
		PINE_DESKTOP_RELEASES: "",
		PINE_DESKTOP_SHELL: process.platform === "win32" ? undefined : "/bin/sh",
	});
	const first = await launched.firstWindow();
	await first.waitForSelector(FIRST, { timeout: patient(30_000) });
	return { app: launched, page: first };
}

async function openTerminal(p: Page, winIndex: number): Promise<void> {
	await sendMenuTo(app!, winIndex, "code-terminal");
	// The shell is up once the terminal says where it is.
	await p.waitForSelector("[data-slot=terminal-cwd][data-state=ready]", { timeout: patient(20_000) });
}

async function waitForTerminalText(p: Page, text: string, timeout = patient(15_000)): Promise<void> {
	await p.waitForFunction(
		(needle: string) => (document.querySelector("[data-slot=terminal]")?.textContent ?? "").includes(needle),
		text,
		{ timeout },
	);
}

before(async () => {
	if (process.platform === "linux" && sandboxMissing()) throw new Error(`No sandbox: ${sandboxMissing()}`);
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-mw-term-")));
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

test("Move to New Window preserves unsent draft, tab-scoped subscription, and live local shell terminal", async () => {
	const started = await startPineApp();
	app = started.app;
	const win1 = started.page;

	await win1.waitForSelector("[data-slot=tab][data-active]");

	// Create a webhook source and open scout:move-me subscribed to it.
	const srcRes = await call(win1, "POST", "/sources", { name: "mw-move-src", type: "webhook", options: {} });
	assert.equal(srcRes.ok, true, JSON.stringify(srcRes));

	await openAgent(win1, "scout");
	await win1.fill("[data-slot=composer] textarea", "/new move-me");
	await win1.keyboard.press("Enter");
	await win1.waitForSelector("[data-slot=tab][data-active] [data-slot=tab-name] >> text=move-me");

	await win1.fill("[data-slot=composer] textarea", "/subscribe local mw-move-src");
	await win1.keyboard.press("Enter");
	// Subscribed once the daemon says so.
	for (const end = Date.now() + patient(15_000); !(await subscribers(win1, "mw-move-src")).includes("scout/move-me"); ) {
		assert.ok(Date.now() < end, "the conversation did not subscribe to the source");
		await new Promise((r) => setTimeout(r, 100));
	}

	// Start a local shell in scout:move-me and set a shell variable so we can verify the exact live PTY moved.
	if (process.platform !== "win32") {
		await openTerminal(win1, 0);
		await win1.evaluate(() => (window as any).pine.termWrite("scout:move-me", "MW_MOVED=alive-after-move; echo MARKER_BEFORE_$MW_MOVED\r"));
		await waitForTerminalText(win1, "MARKER_BEFORE_alive-after-move");
	}

	// Type an unsent draft in the composer.
	await win1.fill("[data-slot=composer] textarea", "unsent draft carried over");

	// The tab's own menu moves it to a new window.
	const moveTab = win1.locator("[data-slot=tab]", { hasText: "move-me" }).first();
	await moveTab.click({ button: "right" });
	const move = win1.locator("[data-slot=context-menu-content] [data-action=move-to-window]");
	await move.waitFor();
	const win2 = await waitForWindow(app, () => move.click());

	// Source window closed the moved tab without ending its tab-scoped subscription.
	await win1.waitForFunction(() => ![...document.querySelectorAll("[data-slot=tab]")].some((el) => el.textContent?.includes("move-me")));
	assert.equal(await windowCount(app), 2);

	// New window opened directly on scout:move-me with the unsent draft restored in the composer.
	await win2.waitForSelector("[data-slot=tab][data-active] [data-slot=tab-name] >> text=move-me", { timeout: 20_000 });
	await win2.waitForFunction(() => (document.querySelector("[data-slot=composer] textarea") as HTMLTextAreaElement | null)?.value === "unsent draft carried over");

	// Subscription stayed alive across the move.
	assert.ok((await subscribers(win2, "mw-move-src")).includes("scout/move-me"), "the subscription went away with the move to a new window");

	// Live PTY transferred to win2: opening Terminal in win2 shows prior output and still holds $MW_MOVED!
	if (process.platform !== "win32") {
		await openTerminal(win2, 1);
		await waitForTerminalText(win2, "MARKER_BEFORE_alive-after-move");
		await win2.evaluate(() => (window as any).pine.termWrite("scout:move-me", "echo MARKER_AFTER_$MW_MOVED\r"));
		await waitForTerminalText(win2, "MARKER_AFTER_alive-after-move");
	}

	// Close win2 so subsequent tests start cleanly with win1.
	await menuKey(app, CLOSE_WINDOW, 1);
	await windowsAre(app, 1);
});

test("sidebar Open in New Window opens conversation in a new window and cross-window tab drag is a safe no-op", async () => {
	assert.ok(app, "app is running from previous test");
	const win1 = app.windows()[0];
	await win1.waitForSelector("[data-slot=tab][data-active]");

	// Open scout and create a pinned conversation "side-open" so it is listed as a conversation row in the sidebar.
	await openAgent(win1, "scout");
	await win1.fill("[data-slot=composer] textarea", "/new side-open");
	await win1.keyboard.press("Enter");
	await win1.waitForSelector("[data-slot=tab][data-active] [data-slot=tab-name] >> text=side-open");
	await win1.fill("[data-slot=composer] textarea", "/pin");
	await win1.keyboard.press("Enter");

	// The side bar's menu is the system's, which the driver cannot click in: the test notes what it offers and says what is picked.
	await app.evaluate(({ ipcMain }: any) => {
		const g = globalThis as any;
		g.sidebarMenus = [];
		ipcMain.removeHandler("pine:context-menu");
		ipcMain.handle("pine:context-menu", (_e: unknown, items: Array<{ id: string; label: string }>) => {
			g.sidebarMenus.push(items);
			return "open-in-new-window";
		});
	});

	// The conversation's menu in the side bar offers a new window for it, and picking that opens one.
	const sideRow = win1.locator("[data-slot=sidebar-menu-item]", { hasText: /side-open/ }).first();
	await sideRow.waitFor({ state: "visible", timeout: 10_000 });
	const win2 = await waitForWindow(app, () => sideRow.click({ button: "right" }));

	const menus: Array<Array<{ id: string }>> = await app.evaluate(() => (globalThis as any).sidebarMenus);
	assert.ok(menus.length >= 1, "expected sidebar context menu to be invoked");
	assert.ok(menus[0].some((i) => i.id === "open-in-new-window"), `the menu offers a new window for the conversation: ${JSON.stringify(menus[0])}`);

	// New window opened directly on scout:side-open.
	await win2.waitForSelector("[data-slot=tab][data-active] [data-slot=tab-name] >> text=side-open", { timeout: 20_000 });
	assert.equal(await windowCount(app), 2);

	// Verify cross-window HTML5 tab drag-and-drop is ignored: win1 has at least 2 tabs (main and scout).
	const tabsBefore = await win1.evaluate(() => [...document.querySelectorAll("[data-slot=tab] [data-slot=tab-name]")].map((e) => e.textContent));
	assert.ok(tabsBefore.length >= 2, `expected at least 2 tabs in win1, got ${JSON.stringify(tabsBefore)}`);

	// Dispatch a drop on tab 0 with another window's origin payload -> order must NOT change.
	await win1.evaluate(() => {
		const target = document.querySelectorAll("[data-slot=tab]")[0];
		const dt = new DataTransfer();
		dt.setData("application/x-pine-tab", JSON.stringify({ window: "w-other-window", index: 1 }));
		target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
	});
	const tabsAfterForeignDrop = await win1.evaluate(() => [...document.querySelectorAll("[data-slot=tab] [data-slot=tab-name]")].map((e) => e.textContent));
	assert.deepEqual(tabsAfterForeignDrop, tabsBefore, "foreign-window tab drop must be a no-op");

	// Close win2.
	await menuKey(app, CLOSE_WINDOW, 1);
	await windowsAre(app, 1);
});

test("per-window local terminal isolation: two windows have independent shells and closing one preserves the other", { skip: process.platform === "win32" && "POSIX shell test" }, async () => {
	assert.ok(app, "app is running from previous test");
	const win1 = app.windows()[0];
	await win1.locator("[data-slot=tab]", { hasText: "main" }).first().click();
	await win1.waitForSelector("[data-slot=tab][data-active] [data-slot=tab-name] >> text=main");

	// Open a second local window directly on main:main via File > New Window + Open main.
	const win2 = await waitForWindow(app, () => menuKey(app!, NEW_WINDOW, 0));
	await win2.waitForSelector("[data-slot=no-tab]", { timeout: patient(20_000) });
	await win2.locator("[data-slot=no-tab] [data-action=open-main]").click();
	await win2.waitForSelector("[data-slot=tab][data-active] [data-slot=tab-name] >> text=main");

	// Open Terminal in both windows for the same conversation (main:main).
	await openTerminal(win1, 0);
	await openTerminal(win2, 1);

	// Set distinct shell variables in each window's terminal.
	await win1.evaluate(() => (window as any).pine.termWrite("main:main", "MW_ISO=from-win-one; echo ISO_ONE_$MW_ISO\r"));
	await win2.evaluate(() => (window as any).pine.termWrite("main:main", "MW_ISO=from-win-two; echo ISO_TWO_$MW_ISO\r"));
	await waitForTerminalText(win1, "ISO_ONE_from-win-one");
	await waitForTerminalText(win2, "ISO_TWO_from-win-two");

	// Output from win2 never leaked into win1, and vice versa.
	const term1Text = await win1.evaluate(() => document.querySelector("[data-slot=terminal]")?.textContent ?? "");
	const term2Text = await win2.evaluate(() => document.querySelector("[data-slot=terminal]")?.textContent ?? "");
	assert.ok(!term1Text.includes("ISO_TWO_from-win-two"), `win2 output leaked into win1: ${term1Text}`);
	assert.ok(!term2Text.includes("ISO_ONE_from-win-one"), `win1 output leaked into win2: ${term2Text}`);

	// Close win2: win1's shell must stay alive with its $MW_ISO intact.
	await menuKey(app, CLOSE_WINDOW, 1);
	await windowsAre(app, 1);

	await win1.evaluate(() => (window as any).pine.termWrite("main:main", "echo STILL_ALIVE_$MW_ISO\r"));
	await waitForTerminalText(win1, "STILL_ALIVE_from-win-one");
});
