// Tabs dragged from one window onto another window's tab row. (Tearing a tab off into a window of its own has no test here:
// on Linux CI the page never reported the end of the drag, which no other system reproduced; where the window goes is window-layout.test.ts.)
// Playwright cannot drag between two windows of the system, so the tests send the page's own drag events
// (dragstart, dragover, drop, dragend), and the main process does the rest as it would for a real drag.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { startMock } from "../../baseline/tests/mock.mjs";
import { browserPlaces } from "../../src/browser-build.ts";
import { sandboxMissing } from "../../src/security.ts";
import { allWindowBounds, launchApp, patient, waitForWindow, windowCount } from "./support/app.ts";

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

/** An agent's conversation, opened by picking the agent in the side bar's switcher. */
const openAgent = async (p: Page, agent: string) => {
	await p.click("[data-slot=sidebar] [data-slot=agent-switcher]");
	await p.click(`[data-slot=dropdown-menu-content] [data-slot=agent-option][data-agent="${agent}"]`);
	await p.locator(`[data-slot=tab][data-active][data-agent="${agent}"]`).waitFor();
};
/** What a window shows first: a conversation, or that it has no tab. */
const FIRST = "[data-slot=no-tab], [data-slot=tab][data-active]";

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

/** The names on a window's tabs, left to right. */
const tabNames = (p: Page) => p.evaluate(() => [...document.querySelectorAll("[data-slot=tab] [data-slot=tab-name]")].map((e) => (e.textContent ?? "").trim()));

/** Opens a new conversation of scout's in a window, named `name`, and leaves `draft` unsent in it. */
async function scoutConversation(p: Page, name: string, draft: string): Promise<void> {
	await openAgent(p, "scout");
	await p.fill("[data-slot=composer] textarea", `/new ${name}`);
	await p.keyboard.press("Enter");
	await p.waitForSelector(`[data-slot=tab][data-active] [data-slot=tab-name] >> text=${name}`);
	await p.fill("[data-slot=composer] textarea", draft);
}

/** Picks up a window's tab whose name is `name` (or holds it, with `part`), as a drag that begins on it does. */
async function pickUp(p: Page, name: string, part = false): Promise<void> {
	await p.evaluate(
		([name, part]) => {
			const tab = [...document.querySelectorAll("[data-slot=tab]")].find((el) => {
				const text = (el.querySelector("[data-slot=tab-name]")?.textContent ?? "").trim();
				return part ? text.includes(name) : text === name;
			});
			if (!tab) throw new Error(`no tab ${name}`);
			const dataTransfer = new DataTransfer();
			tab.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
			(window as any).__dragged = { tab, dataTransfer };
		},
		[name, part] as const,
	);
}

/** Lets go of the tab picked up in a window where nothing takes it, at a place of the screen. */
async function letGo(p: Page, at: { x: number; y: number }): Promise<void> {
	await p.evaluate((at) => {
		const { tab, dataTransfer } = (window as any).__dragged;
		tab.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer, screenX: at.x, screenY: at.y }));
	}, at);
}

/**
 * Drops a tab of another window on this one: on the half of the tab named `on` (or on the empty window with none), once
 * this window knows a tab is being dragged, which it shows by marking where the tab would land. (That a dragover was
 * taken says nothing: the page takes every one, for files.)
 */
async function dropOn(p: Page, on: string | undefined, half: "before" | "after" = "before"): Promise<void> {
	await p.waitForFunction(
		([on, half]) => {
			const el = on === undefined ? document.querySelector("[data-slot=no-tab]") : [...document.querySelectorAll("[data-slot=tab]")].find((t) => (t.querySelector("[data-slot=tab-name]")?.textContent ?? "").includes(on));
			if (!el) return false;
			const r = el.getBoundingClientRect();
			const at = { clientX: half === "before" ? r.left + 2 : r.right - 2, clientY: r.top + r.height / 2 };
			const dataTransfer = new DataTransfer();
			dataTransfer.setData("application/x-pine-tab", JSON.stringify({ window: "another", index: 0 }));
			el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer, ...at }));
			const marked = el.hasAttribute("data-drop");
			if (!marked) return false;
			el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, ...at }));
			return true;
		},
		[on, half] as const,
		{ timeout: 10_000 },
	);
}

before(async () => {
	if (process.platform === "linux" && sandboxMissing()) throw new Error(`No sandbox: ${sandboxMissing()}`);
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-mw-drag-")));
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
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n");
	write(path.join(home, "agents", "scout", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "scout", "workspace", "AGENTS.md"), "Scout agent.\n");
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	if (home) fs.rmSync(home, { recursive: true, force: true });
});

test("a tab dropped on another window moves there with its draft, lands on the half it was let go on, and a window left without a tab closes", async () => {
	const started = await startPineApp();
	app = started.app;
	const win1 = started.page;
	await win1.waitForSelector("[data-slot=tab][data-active]");
	await app.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 1280, height: 820 }));
	// win1: main, scout, scout's "carry" with a draft.
	await scoutConversation(win1, "carry", "carried by drag");
	const win2 = await waitForWindow(app, () => menuKey(app!, NEW_WINDOW, 0));
	await win2.waitForSelector("[data-slot=no-tab]", { timeout: patient(20_000) });

	// Nothing is being dragged: a drop gives nothing.
	assert.equal(await win2.evaluate(() => (window as any).pine.tabDrop()), undefined);

	// carry goes to the empty win2.
	await pickUp(win1, "carry", true);
	// The window it is dragged out of cannot take its own drag as another window's.
	assert.equal(await win1.evaluate(() => (window as any).pine.tabDrop()), undefined);
	await dropOn(win2, undefined);
	await win2.waitForSelector("[data-slot=tab][data-active] [data-slot=tab-name] >> text=carry", { timeout: 20_000 });
	await win2.waitForFunction(() => (document.querySelector("[data-slot=composer] textarea") as HTMLTextAreaElement | null)?.value === "carried by drag");
	await win1.waitForFunction(() => ![...document.querySelectorAll("[data-slot=tab]")].some((el) => el.textContent?.includes("carry")));
	// The source's drag ends after the drop: nothing more happens.
	const [b1] = await allWindowBounds(app);
	await letGo(win1, { x: b1.x + 20, y: b1.y + 20 });
	assert.equal(await windowCount(app), 2);
	assert.deepEqual(await tabNames(win1), ["main", "scout"]);

	// scout's main conversation, let go on the left half of carry: before it.
	await pickUp(win1, "scout");
	await dropOn(win2, "carry", "before");
	await win2.waitForFunction(() => [...document.querySelectorAll("[data-slot=tab] [data-slot=tab-name]")].length === 2);
	const names = await tabNames(win2);
	assert.equal(names[0], "scout");
	assert.ok(names[1].includes("carry"), JSON.stringify(names));
	await letGo(win1, { x: b1.x + 20, y: b1.y + 20 });

	// win1's last tab, let go on the right half of carry: after it, and win1 closes.
	assert.deepEqual(await tabNames(win1), ["main"]);
	await pickUp(win1, "main");
	await dropOn(win2, "carry", "after");
	await windowsAre(app, 1);
	await win2.waitForFunction(() => [...document.querySelectorAll("[data-slot=tab] [data-slot=tab-name]")].length === 3);
	const after = await tabNames(win2);
	assert.equal(after[0], "scout");
	assert.ok(after[1].includes("carry"), JSON.stringify(after));
	assert.equal(after[2], "main");
	await win2.waitForSelector("[data-slot=tab][data-active] [data-slot=tab-name] >> text=main");
});

test("a window on another machine's pine takes no tab of this computer's: that conversation is not there", async () => {
	assert.ok(app, "app is running from the test before");
	const local = app.windows().find((p) => !p.isClosed())!;
	const other = await waitForWindow(app, () => menuKey(app!, NEW_WINDOW, 0));
	await other.waitForSelector("[data-slot=no-tab]", { timeout: patient(20_000) });
	// A machine that is never reached: the window is on it from the moment it is picked, connected or not.
	const host = "pine-drag-test.invalid";
	await other.evaluate(async (host) => {
		await (window as any).pine.addHost(host);
		void (window as any).pine.use(host).catch(() => {});
	}, host);
	const before = await tabNames(local);
	await pickUp(local, "main");
	assert.equal(await other.evaluate(() => (window as any).pine.tabDrop()), undefined);
	const [b] = await allWindowBounds(app);
	await letGo(local, { x: b.x + 20, y: b.y + 20 });
	assert.deepEqual(await tabNames(local), before);
	await local.evaluate((host) => (window as any).pine.forgetHost(host, { closeWindows: true }), host);
});
