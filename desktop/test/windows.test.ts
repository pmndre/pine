// Multi-window core end-to-end tests: real Electron app, real windows, scripted model server.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { mockMsg, startMock } from "../../baseline/tests/mock.mjs";
import { launchApp } from "./support/app.ts";

let app: any;
let page: any;
let mock: any;
let home: string;
let dataDir: string;
const pageErrors: string[] = [];

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

async function sees(p: any, selector: string, timeout = 20_000): Promise<void> {
	try {
		await p.waitForSelector(selector, { timeout });
	} catch {
		const there = await p.evaluate(() => ({
			text: (document.querySelector("[data-slot=message-scroller-content], [data-slot=settings-page], [data-slot=empty], [data-slot=no-tab]") as HTMLElement | null)?.innerText?.slice(-1000),
			toasts: [...document.querySelectorAll("[data-slot=toast]")].map((t) => t.textContent),
		}));
		throw new Error(`"${selector}" did not appear. On screen: ${JSON.stringify(there)}${pageErrors.length ? `\nErrors:\n${pageErrors.join("\n")}` : ""}`);
	}
}

function attachErrorListeners(p: any): void {
	p.on("pageerror", (e: Error) => pageErrors.push(String(e.stack ?? e.message).slice(0, 600)));
	p.on("console", (m: any) => m.type() === "error" && pageErrors.push(m.text().slice(0, 600)));
}

function appEnv(): Record<string, string | undefined> {
	return {
		...process.env,
		PINE_HOME: home,
		PINE_DESKTOP_DATA: dataDir,
		PINE_SKIP_DOWNLOADS: "1",
		PINE_DESKTOP_DEV_URL: "",
		PINE_DESKTOP_RELEASES: "",
	};
}

before(async () => {
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-win-")));
	dataDir = path.join(home, "desktop-data");
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
	write(
		path.join(home, "pine.json"),
		JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false } }, null, 2),
	);
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ delegates: ["scout"], approve: ["bash"] }));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "You are the main agent.\n");
	// A tiny 1x1 PNG so we can verify per-window pine-media:// loading.
	const png1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
	fs.writeFileSync(path.join(home, "agents", "main", "workspace", "pixel.png"), png1x1);
	write(path.join(home, "agents", "scout", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "scout", "workspace", "AGENTS.md"), "You are scout.\n");

	app = await launchApp(appEnv());
	page = await app.firstWindow();
	attachErrorListeners(page);
	await sees(page, "[data-slot=composer]");
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	if (home) fs.rmSync(home, { recursive: true, force: true });
	assert.deepEqual(pageErrors, [], "unexpected renderer errors");
});

test("New Window opens cascaded on NoTab when another window views the same environment, and Close Tab / Close Window behave properly", async () => {
	const state1 = await page.evaluate(() => (window as any).pine.state());
	assert.equal(typeof state1.windowId, "number", "window 1 should have a numeric windowId");
	const mediaBase1 = await page.evaluate(() => (window as any).pine.mediaBase);
	assert.match(mediaBase1, /^pine-media:\/\/window-\d+$/);

	const win1 = await app.evaluate(({ BrowserWindow }: any) => {
		const w = BrowserWindow.getAllWindows()[0];
		return { id: w.id, bounds: w.getBounds() };
	});

	// Open a second window via bridge.newWindow()
	const nextWinPromise = app.waitForEvent("window");
	await page.evaluate(() => (window as any).pine.newWindow());
	const page2 = await nextWinPromise;
	attachErrorListeners(page2);
	await sees(page2, "[data-slot=no-tab]");

	const state2 = await page2.evaluate(() => (window as any).pine.state());
	assert.equal(typeof state2.windowId, "number");
	assert.notEqual(state2.windowId, state1.windowId);
	const mediaBase2 = await page2.evaluate(() => (window as any).pine.mediaBase);
	assert.match(mediaBase2, /^pine-media:\/\/window-\d+$/);
	assert.notEqual(mediaBase2, mediaBase1);

	// Check cascading (+24, +24 offset from window 1, or clamped within workArea)
	const win2 = await app.evaluate(({ BrowserWindow }: any, firstId: number) => {
		const w = BrowserWindow.getAllWindows().find((x: any) => x.id !== firstId);
		return { id: w.id, bounds: w.getBounds() };
	}, win1.id);
	assert.notDeepEqual({ x: win2.bounds.x, y: win2.bounds.y }, { x: win1.bounds.x, y: win1.bounds.y }, "second window should be cascaded from first");

	// CmdOrCtrl+W on NoTab closes window 2
	const closed1 = page2.waitForEvent("close");
	await app.evaluate(({ BrowserWindow }: any, id: number) => {
		BrowserWindow.fromId(id)?.webContents.send("pine:menu", "close");
	}, win2.id);
	await closed1;
	assert.equal(app.windows().length, 1, "CmdOrCtrl+W on NoTab should close the second window");

	// Open a second window again, open a tab in it, then CmdOrCtrl+W closes tab first, second CmdOrCtrl+W closes window
	const nextWinPromise2 = app.waitForEvent("window");
	await page.evaluate(() => (window as any).pine.newWindow());
	const page3 = await nextWinPromise2;
	attachErrorListeners(page3);
	await sees(page3, "[data-slot=no-tab]");
	const win3Id = await app.evaluate(({ BrowserWindow }: any, firstId: number) => BrowserWindow.getAllWindows().find((x: any) => x.id !== firstId)?.id, win1.id);
	await page3.click("button:has-text('Open main')");
	await sees(page3, "[data-slot=composer]");

	// First close command closes the tab -> back to NoTab, window stays open
	await app.evaluate(({ BrowserWindow }: any, id: number) => {
		BrowserWindow.fromId(id)?.webContents.send("pine:menu", "close");
	}, win3Id);
	await sees(page3, "[data-slot=no-tab]");
	assert.equal(app.windows().length, 2, "CmdOrCtrl+W with open tab should close tab, not window");

	// Open tab again and test Close Window closes directly even with open tab
	await page3.click("button:has-text('Open main')");
	await sees(page3, "[data-slot=composer]");
	const closed2 = page3.waitForEvent("close");
	await page3.evaluate(() => (window as any).pine.closeWindow());
	await closed2;
	assert.equal(app.windows().length, 1, "Close Window should close the window even with tabs open");
});

test("Independent tabs, panel layouts, daemon /ui/tabs union, closeSession protection, and per-window pine-media:", async () => {
	// Open a second window
	const nextWin = app.waitForEvent("window");
	await page.evaluate(() => (window as any).pine.newWindow());
	const page2 = await nextWin;
	attachErrorListeners(page2);
	await sees(page2, "[data-slot=no-tab]");

	// Open main:alpha in window 1 via composer slash command
	await page.fill("[data-slot=composer] textarea", "/new alpha");
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => [...document.querySelectorAll("[data-slot=tab-name]")].some((el) => el.textContent?.includes("alpha")));

	// Open main:beta in window 2 by opening main first, then /new beta, then closing main in window 2
	await page2.click("button:has-text('Open main')");
	await sees(page2, "[data-slot=composer]");
	await page2.fill("[data-slot=composer] textarea", "/new beta");
	await page2.keyboard.press("Enter");
	await page2.waitForFunction(() => [...document.querySelectorAll("[data-slot=tab-name]")].some((el) => el.textContent?.includes("beta")));

	// Verify window 1 does NOT have beta, and window 2 does NOT have alpha
	const tabs1 = await page.$$eval("[data-slot=tab-name]", (els: Element[]) => els.map((e) => e.textContent ?? ""));
	const tabs2 = await page2.$$eval("[data-slot=tab-name]", (els: Element[]) => els.map((e) => e.textContent ?? ""));
	assert.ok(tabs1.some((t) => t.includes("alpha")) && !tabs1.some((t) => t.includes("beta")), `window 1 tabs should be isolated: ${tabs1}`);
	assert.ok(tabs2.some((t) => t.includes("beta")) && !tabs2.some((t) => t.includes("alpha")), `window 2 tabs should be isolated: ${tabs2}`);

	// Verify daemon /ui/tabs holds the deduplicated union of both windows
	const daemonTabs = await page.evaluate(() => (window as any).pine.call("GET", "/ui/tabs"));
	assert.equal(daemonTabs.ok, true);
	const keys = new Set((daemonTabs.data.tabs as Array<{ agent: string; session: string }>).map((t) => `${t.agent}:${t.session}`));
	assert.ok(keys.has("main:main") && keys.has("main:alpha") && keys.has("main:beta"), `daemon /ui/tabs should be union, got: ${[...keys]}`);

	// Panel layout isolation: hide sidebar and open side panel in window 2 -> window 1 stays unchanged
	const win2Id = await app.evaluate(({ BrowserWindow }: any) => {
		const wins = BrowserWindow.getAllWindows();
		return wins.find((w: any) => w.webContents.id !== wins[wins.length - 1].webContents.id)?.id ?? wins[0].id;
	});
	// Use window 2's own UI buttons so we don't depend on window ordering
	await page2.click("button[aria-label='Hide the sidebar']");
	await page2.waitForSelector("button[aria-label='Show the sidebar']");
	await page2.click("[data-toggle=code]");
	await sees(page2, "[data-slot=code-panel]");
	assert.equal(await page.locator("button[aria-label='Hide the sidebar']").count(), 1, "window 1 sidebar should remain visible");
	assert.equal(await page.locator("[data-slot=code-panel]").count(), 0, "window 1 side panel should remain closed");

	// Per-window pine-media:// loading works in both windows (via Image, matching img-src CSP)
	for (const p of [page, page2]) {
		const res = await p.evaluate(
			() =>
				new Promise<{ ok: boolean; w: number; h: number }>((resolve) => {
					const img = new Image();
					img.onload = () => resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight });
					img.onerror = () => resolve({ ok: false, w: 0, h: 0 });
					img.src = `${(window as any).pine.mediaBase}/agents/main/image?path=pixel.png`;
				}),
		);
		assert.deepEqual(res, { ok: true, w: 1, h: 1 }, `media image should load cleanly: ${JSON.stringify(res)}`);
	}

	// closeSession protection: open main:alpha in window 2 as well, then close it in window 2
	// Create a webhook source and subscribe main:alpha to it so we can observe whether closeSession ran on the daemon
	const mkSrc = await page.evaluate(() => (window as any).pine.call("POST", "/sources", { name: "ping", type: "webhook", description: "test webhook", options: {} }));
	assert.equal(mkSrc.ok, true, `POST /sources failed: ${JSON.stringify(mkSrc)}`);
	const subRes = await page.evaluate(() => (window as any).pine.call("POST", "/agents/main/subscribe", { source: "ping", session: "alpha" }));
	assert.equal(subRes.ok, true, `POST /subscribe failed: ${JSON.stringify(subRes)}`);
	await page2.fill("[data-slot=composer] textarea", "/new alpha");
	await page2.keyboard.press("Enter");
	await page2.waitForFunction(() => [...document.querySelectorAll("[data-slot=tab-name]")].some((el) => el.textContent?.includes("alpha")));

	// Close alpha tab in window 2 -> main:alpha is still open in window 1, so subscription MUST remain
	await page2.locator("[data-slot=tab]", { hasText: "alpha" }).locator("button[aria-label='Close this tab']").click();
	await page2.waitForFunction(() => ![...document.querySelectorAll("[data-slot=tab-name]")].some((el) => el.textContent?.includes("alpha")));
	const sourcesAfterW2Close = await page.evaluate(() => (window as any).pine.call("GET", "/agents/main/sources?session=alpha"));
	const pingAfterW2 = (sourcesAfterW2Close.data as any[]).find((s) => s.name === "ping");
	assert.ok(pingAfterW2?.local, `subscription should survive when another window still holds main:alpha, got ${JSON.stringify(pingAfterW2)}`);

	// Now close alpha tab in window 1 (last window holding it) -> closeSession runs and ends subscription
	await page.locator("[data-slot=tab]", { hasText: "alpha" }).locator("button[aria-label='Close this tab']").click();
	await page.waitForFunction(() => ![...document.querySelectorAll("[data-slot=tab-name]")].some((el) => el.textContent?.includes("alpha")));
	await page.waitForFunction(async () => {
		const r = await (window as any).pine.call("GET", "/agents/main/sources?session=alpha");
		const ping = (r.data as any[]).find((s: any) => s.name === "ping");
		return !ping?.local;
	});

	// Suppress unused variable warning
	void win2Id;

	// Clean up window 2
	const closed = page2.waitForEvent("close");
	await page2.evaluate(() => (window as any).pine.closeWindow());
	await closed;
});

test("Cross-window approval routing avoids duplicate modals and duplicate tabs", async () => {
	// Open a second window on scout:main (different conversation from window 1's main:main)
	const nextWin = app.waitForEvent("window");
	await page.evaluate(() => (window as any).pine.newWindow({ tab: { agent: "scout", session: "main" } }));
	const page2 = await nextWin;
	attachErrorListeners(page2);
	await sees(page2, "[data-slot=composer]");

	// Trigger a bash tool call on main:main (which requires approval)
	await page.fill(
		"[data-slot=composer] textarea",
		mockMsg([{ tools: [{ name: "bash", args: { command: "echo hi" } }] }, { text: "Denied as requested." }], "run echo hi "),
	);
	await page.keyboard.press("Enter");

	// Approval dialog should appear in window 1 (which holds main:main), NOT in window 2 (which holds scout:main)
	await sees(page, "[role=dialog] button:has-text('Deny')");
	// Give event loop a beat to ensure window 2 didn't pop a dialog
	await new Promise((r) => setTimeout(r, 300));
	assert.equal(await page2.locator("[role=dialog]").count(), 0, "window 2 should not receive approval modal for window 1's conversation");

	// Deny in window 1 -> finishes cleanly
	await page.click("[role=dialog] button:has-text('Deny')");
	await page.waitForFunction(() => document.body.innerText.includes("Denied as requested."));

	// Clean up window 2
	const closed = page2.waitForEvent("close");
	await page2.evaluate(() => (window as any).pine.closeWindow());
	await closed;
});

test("Quitting with multiple windows restores all of them on relaunch; closing all individually opens one window", async () => {
	// Open a second window on scout:main with sidebar hidden and code panel open
	const nextWin = app.waitForEvent("window");
	await page.evaluate(() => (window as any).pine.newWindow({ tab: { agent: "scout", session: "main" } }));
	const page2 = await nextWin;
	attachErrorListeners(page2);
	await sees(page2, "[data-slot=composer]");
	await page2.click("button[aria-label='Hide the sidebar']");
	await page2.waitForSelector("button[aria-label='Show the sidebar']");
	await page2.click("[data-toggle=code]");
	await sees(page2, "[data-slot=code-panel]");
	// Let layout IPC flush to prefs.json
	await new Promise((r) => setTimeout(r, 200));

	// Quit the app while both windows are open
	await app.close();

	// Relaunch with the same PINE_DESKTOP_DATA -> both windows should be restored!
	app = await launchApp(appEnv());
	const first = await app.firstWindow();
	attachErrorListeners(first);
	// Wait until 2 windows exist
	if (app.windows().length < 2) {
		const second = await app.waitForEvent("window");
		attachErrorListeners(second);
	}
	assert.equal(app.windows().length, 2, "relaunch should restore both windows that were open at quit");
	const [wA, wB] = app.windows();
	await Promise.all([sees(wA, "[data-slot=composer]"), sees(wB, "[data-slot=composer]")]);

	// One window should have scout + hidden sidebar + code panel; the other should have main + visible sidebar
	const summaries = await Promise.all(
		[wA, wB].map(async (w) => ({
			tabs: await w.$$eval("[data-slot=tab-name]", (els: Element[]) => els.map((e) => e.textContent ?? "")),
			sidebarHidden: (await w.locator("button[aria-label='Show the sidebar']").count()) > 0,
			codeOpen: (await w.locator("[data-slot=code-panel]").count()) > 0,
		})),
	);
	const scoutWin = summaries.find((s) => s.tabs.some((t) => t.includes("scout")));
	const mainWin = summaries.find((s) => s.tabs.some((t) => t.includes("main")));
	assert.ok(scoutWin, `expected restored scout window, got ${JSON.stringify(summaries)}`);
	assert.ok(mainWin, `expected restored main window, got ${JSON.stringify(summaries)}`);
	assert.equal(scoutWin.sidebarHidden, true, "restored scout window should keep sidebar hidden");
	assert.equal(scoutWin.codeOpen, true, "restored scout window should keep code panel open");
	assert.equal(mainWin.sidebarHidden, false, "restored main window should keep sidebar visible");

	// Now close both windows individually before quitting -> relaunch should open ONLY ONE window
	const closeA = wA.waitForEvent("close");
	await wA.evaluate(() => (window as any).pine.closeWindow());
	await closeA;
	const closeB = wB.waitForEvent("close");
	await wB.evaluate(() => (window as any).pine.closeWindow());
	await closeB;
	// On macOS app stays running with 0 windows; quit it now
	await app.close();

	app = await launchApp(appEnv());
	page = await app.firstWindow();
	attachErrorListeners(page);
	await sees(page, "[data-slot=composer]");
	await new Promise((r) => setTimeout(r, 400));
	assert.equal(app.windows().length, 1, "relaunch after closing all windows individually should open only one window");
});
