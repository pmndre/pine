// Multiple windows of the desktop app: opening, cascading and closing windows, independent tabs
// and panel layouts, the daemon's union of open tabs and session subscriptions, shared event
// routing, and restoring open windows after a quit.
import assert from "node:assert/strict";
import path from "node:path";
import { before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { mockMsg } from "../../baseline/tests/mock.mjs";
import { clickMenuItem, focusWindow, launchApp, openNewWindow, waitClosed, windowBounds } from "./support/app.ts";
import { app, BROWSER_EDGE, BROWSER_TOGGLE, browsers, closed, CODE_EDGE, CODE_TOGGLE, far, github, home, page, sees, SIDE_EDGE, started, write } from "./support/window.ts";

before(() => started());

test("New Window opens a cascaded window on NoTab when the environment is already open, and Close Tab / Close Window close tabs and windows", async () => {
	await focusWindow(app, page);
	const b1 = await windowBounds(app, page);

	// File > New Window (CmdOrCtrl+N) opens a second window cascaded from the focused one on NoTab.
	let accel = "";
	const win2 = await openNewWindow(app, async () => {
		accel = (await clickMenuItem(app, "File", "New Window")) ?? "";
	});
	assert.equal(accel, "CmdOrCtrl+N");
	await win2.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });
	assert.equal(await win2.locator("[data-slot=tab]").count(), 0);
	assert.equal(await page.locator("[data-slot=tab]").count(), 1);

	const b2 = await windowBounds(app, win2);
	const workArea = await app.evaluate(({ screen }: any, bounds: any) => screen.getDisplayMatching(bounds).workArea, b1);
	const expectedX = Math.max(workArea.x, Math.min(b1.x + 24, workArea.x + workArea.width - b2.width));
	const expectedY = Math.max(workArea.y, Math.min(b1.y + 24, workArea.y + workArea.height - b2.height));
	assert.equal(b2.x, expectedX);
	assert.equal(b2.y, expectedY);

	// CmdOrCtrl+W on NoTab closes that window and leaves the first window open.
	await focusWindow(app, win2);
	const closeTabAccel = await clickMenuItem(app, "File", "Close Tab");
	assert.equal(closeTabAccel, "CmdOrCtrl+W");
	await waitClosed(win2);
	assert.equal(app.windows().length, 1);
	assert.equal(page.isClosed(), false);

	// Command Palette > New window opens a window; CmdOrCtrl+W closes its tab to NoTab, then closes the window.
	await focusWindow(app, page);
	await clickMenuItem(app, "View", "Command Palette…");
	await sees("[data-slot=command-input]");
	await page.fill("[data-slot=command-input]", "New window");
	await sees('[data-slot=command-item][data-value="c:new-window"]');
	const win3 = await openNewWindow(app, () => page.click('[data-slot=command-item][data-value="c:new-window"]'));
	await win3.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });
	await win3.locator("[data-slot=no-tab] button").nth(1).click();
	await win3.waitForSelector("[data-slot=tab][data-active]", { timeout: 20_000 });
	assert.equal(await win3.locator("[data-slot=tab]").count(), 1);

	await focusWindow(app, win3);
	await clickMenuItem(app, "File", "Close Tab");
	await win3.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });
	assert.equal(win3.isClosed(), false);

	await clickMenuItem(app, "File", "Close Tab");
	await waitClosed(win3);
	assert.equal(app.windows().length, 1);

	// File > Close Window (CmdOrCtrl+Shift+W) closes a window directly even while tabs are open; on macOS, Dock > New Window opens one.
	const win4 = await openNewWindow(app, async () => {
		if (process.platform === "darwin") {
			const hasDockItem = await app.evaluate(({ app }: any) => {
				const dockMenu = app.dock?.getMenu?.();
				const item = dockMenu?.items.find((i: any) => i.label === "New Window");
				if (!item) return false;
				item.click(item, undefined, {});
				return true;
			});
			assert.equal(hasDockItem, true);
		} else {
			await clickMenuItem(app, "File", "New Window");
		}
	});
	await win4.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });
	await win4.locator("[data-slot=no-tab] button").nth(1).click();
	await win4.waitForSelector("[data-slot=tab][data-active]", { timeout: 20_000 });

	await focusWindow(app, win4);
	const closeWinAccel = await clickMenuItem(app, "File", "Close Window");
	assert.equal(closeWinAccel, "CmdOrCtrl+Shift+W");
	await waitClosed(win4);
	assert.equal(app.windows().length, 1);
	assert.equal(await page.locator("[data-slot=tab]").count(), 1);
});

test("two windows keep independent tabs, active tab, panel visibility, panel widths, folded state, and window-scoped media", async () => {
	await focusWindow(app, page);
	// Window 1: open scout alongside main, keep main active, widen side bar + browser aside, and fold main's conversations.
	await page.evaluate(() => (window as any).pine.call("POST", "/agents/main/prompt", { prompt: "first conv", session: "alpha", wait: true }));
	await focusWindow(app, page);
	await page.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { has: page.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }) }).locator("[data-slot=agent-label]").click();
	await page.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 2);
	await page.locator("[data-slot=tab]").first().click();

	const w1SideBefore = Math.round(await page.$eval("#sidebar-panel", (el: Element) => el.getBoundingClientRect().width));
	const sideEdge = await page.$eval(SIDE_EDGE, (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(sideEdge.x + sideEdge.width / 2, 300);
	await page.mouse.down();
	await page.mouse.move(sideEdge.x + sideEdge.width / 2 + 50, 300, { steps: 4 });
	await page.mouse.up();
	const w1SideAfter = Math.round(await page.$eval("#sidebar-panel", (el: Element) => el.getBoundingClientRect().width));
	assert.ok(w1SideAfter >= w1SideBefore + 40);

	await page.click(BROWSER_TOGGLE);
	await sees("#browser-panel [data-slot=browser-aside]");
	const w1AsideBefore = Math.round(await page.$eval("#browser-panel", (el: Element) => el.getBoundingClientRect().width));
	const asideEdge = await page.$eval(BROWSER_EDGE, (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(asideEdge.x + asideEdge.width / 2, 300);
	await page.mouse.down();
	await page.mouse.move(asideEdge.x + asideEdge.width / 2 - 45, 300, { steps: 4 });
	await page.mouse.up();
	const w1AsideAfter = Math.round(await page.$eval("#browser-panel", (el: Element) => el.getBoundingClientRect().width));
	assert.equal(w1AsideAfter, w1AsideBefore + 45);

	// Fold main's conversations in Window 1.
	const w1FoldTrigger = page.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])").first().locator("[data-slot=collapsible-trigger]");
	await w1FoldTrigger.waitFor();
	if ((await w1FoldTrigger.getAttribute("aria-expanded")) === "true") await w1FoldTrigger.click();
	assert.equal(await w1FoldTrigger.getAttribute("aria-expanded"), "false");

	// Open Window 2 on the same environment: open only scout, hide its side bar, open & widen #code-panel, keep browser aside closed.
	const win2 = await openNewWindow(app, () => clickMenuItem(app, "File", "New Window"));
	await win2.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });
	// Window 2 starts with main unfolded and default side bar width, unaffected by Window 1!
	const w2SideInitial = Math.round(await win2.$eval("#sidebar-panel", (el: Element) => el.getBoundingClientRect().width));
	assert.ok(Math.abs(w2SideInitial - w1SideBefore) <= 4);
	const w2FoldTrigger = win2.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])").first().locator("[data-slot=collapsible-trigger]");
	await w2FoldTrigger.waitFor();
	assert.equal(await w2FoldTrigger.getAttribute("aria-expanded"), "true");

	await win2.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { has: win2.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }) }).locator("[data-slot=agent-label]").click();
	await win2.waitForSelector("[data-slot=tab][data-active]", { timeout: 20_000 });
	await win2.click(CODE_TOGGLE);
	await win2.waitForSelector("#code-panel [data-slot=code-panel]", { timeout: 20_000 });
	const w2CodeBefore = Math.round(await win2.$eval("#code-panel", (el: Element) => el.getBoundingClientRect().width));
	const codeEdge = await win2.$eval(CODE_EDGE, (el: Element) => el.getBoundingClientRect());
	await win2.mouse.move(codeEdge.x + codeEdge.width / 2, 300);
	await win2.mouse.down();
	await win2.mouse.move(codeEdge.x + codeEdge.width / 2 - 60, 300, { steps: 4 });
	await win2.mouse.up();
	const w2CodeAfter = Math.round(await win2.$eval("#code-panel", (el: Element) => el.getBoundingClientRect().width));
	assert.equal(w2CodeAfter, w2CodeBefore + 60);

	await focusWindow(app, win2);
	await clickMenuItem(app, "View", "Toggle Sidebar");
	await win2.waitForSelector("#sidebar-panel", { state: "detached", timeout: 10_000 });

	// Reload both windows and verify neither overwrote the other's tabs, active tab, panels, widths, or folded state!
	await page.reload();
	await win2.reload();
	await page.waitForSelector("#browser-panel [data-slot=browser-aside]", { timeout: 20_000 });
	await win2.waitForSelector("#code-panel [data-slot=code-panel]", { timeout: 20_000 });

	assert.equal(await page.locator("[data-slot=tab]").count(), 2);
	assert.equal(await page.locator("[data-slot=tab]").first().getAttribute("data-active"), "true");
	assert.equal(Math.round(await page.$eval("#sidebar-panel", (el: Element) => el.getBoundingClientRect().width)), w1SideAfter);
	assert.equal(Math.round(await page.$eval("#browser-panel", (el: Element) => el.getBoundingClientRect().width)), w1AsideAfter);
	assert.equal(await page.$("#code-panel"), null);
	assert.equal(await page.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])").first().locator("[data-slot=collapsible-trigger]").getAttribute("aria-expanded"), "false");

	assert.equal(await win2.locator("[data-slot=tab]").count(), 1);
	assert.equal(await win2.$("#sidebar-panel"), null);
	assert.equal(await win2.$("#browser-panel"), null);
	assert.equal(Math.round(await win2.$eval("#code-panel", (el: Element) => el.getBoundingClientRect().width)), w2CodeAfter);

	// Switch Window 2 to the remote SSH machine while Window 1 stays on this computer, and verify window-scoped pine-media: images load from each window's own daemon.
	const onePxPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
	write(path.join(home, "agents", "main", "workspace", "local-only.png"), "");
	await import("node:fs").then((fs) => {
		fs.writeFileSync(path.join(home, "agents", "main", "workspace", "local-only.png"), onePxPng);
		fs.writeFileSync(path.join(far, "agents", "main", "workspace", "remote-only.png"), onePxPng);
	});

	await win2.evaluate(() => (window as any).pine.addHost("you@elsewhere"));
	await win2.evaluate(() => (window as any).pine.use("you@elsewhere"));
	await win2.waitForSelector("[data-slot=empty] >> text=The main agent of the other machine", { timeout: 60_000 });

	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "Local pic: ![local](local-only.png)" }], "show local pic "));
	await page.keyboard.press("Enter");
	await win2.fill("[data-slot=composer] textarea", mockMsg([{ text: "Remote pic: ![remote](remote-only.png)" }], "show remote pic "));
	await win2.keyboard.press("Enter");

	await page.waitForFunction(() => {
		const img = document.querySelector('img[alt="local"]') as HTMLImageElement | null;
		return Boolean(img && img.complete && img.naturalWidth === 1 && img.src.startsWith("pine-media://window-"));
	});
	await win2.waitForFunction(() => {
		const img = document.querySelector('img[alt="remote"]') as HTMLImageElement | null;
		return Boolean(img && img.complete && img.naturalWidth === 1 && img.src.startsWith("pine-media://window-"));
	});

	// Clean up Window 2 and leave Window 1 tidy for the next tests.
	await focusWindow(app, win2);
	await clickMenuItem(app, "File", "Close Window");
	await waitClosed(win2);
	await page.evaluate(() => (window as any).pine.forgetHost("you@elsewhere"));
	await focusWindow(app, page);
	await page.click(BROWSER_TOGGLE);
	await page.waitForSelector("#browser-panel", { state: "detached" });
	await page.locator("[data-slot=tab]").nth(1).locator("button[aria-label='Close this tab']").click();
	await page.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 1);
});

test("daemon /ui/tabs holds the union of tabs across windows on the same environment, and closing a shared tab keeps its local subscription until the last window closes it", async () => {
	await focusWindow(app, page);
	// Create a webhook source and a non-main conversation subscribed locally to it.
	const added = await page.evaluate(() => (window as any).pine.call("POST", "/sources", { name: "ping", type: "webhook", description: "Test webhook", options: {} }));
	assert.equal(added.ok, true);
	await page.evaluate(() => (window as any).pine.call("POST", "/agents/main/prompt", { prompt: "watch setup", session: "watch", wait: true }));

	// Open main:watch in Window 1 alongside main:main, and subscribe watch locally to ping.
	await page.fill("[data-slot=composer] textarea", "/sessions watch");
	await page.press("[data-slot=composer] textarea", "Enter");
	await page.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 2);
	const sub = await page.evaluate(() => (window as any).pine.call("POST", "/agents/main/subscribe", { source: "ping", session: "watch" }));
	assert.equal(sub.ok, true);

	// Open Window 2 on the same environment, and open scout:main and main:watch there.
	const win2 = await openNewWindow(app, () => clickMenuItem(app, "File", "New Window"));
	await win2.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });
	await win2.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { has: win2.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }) }).locator("[data-slot=agent-label]").click();
	await win2.waitForSelector("[data-slot=tab][data-active]", { timeout: 20_000 });
	await win2.fill("[data-slot=composer] textarea", "/agent main watch");
	await win2.press("[data-slot=composer] textarea", "Enter");
	await win2.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 2);

	// Wait a beat for saveTabs() IPC calls to settle, then check the daemon's /ui/tabs union.
	await new Promise((r) => setTimeout(r, 150));
	const union = await page.evaluate(() => (window as any).pine.call("GET", "/ui/tabs"));
	const keys = (union.data.tabs as Array<{ agent: string; session: string }>).map((t) => `${t.agent}:${t.session}`).sort();
	assert.deepEqual(keys, ["main:main", "main:watch", "scout:main"]);

	// Close main:watch in Window 1 while Window 2 still holds main:watch: subscription stays alive and main:watch stays in /ui/tabs!
	await page.locator("[data-slot=tab]").nth(1).locator("button[aria-label='Close this tab']").click();
	await page.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 1);
	await new Promise((r) => setTimeout(r, 150));

	const afterFirstClose = await page.evaluate(() => (window as any).pine.call("GET", "/agents/main/sources?session=watch"));
	const pingAfterFirst = (afterFirstClose.data as Array<{ name: string; local?: unknown }>).find((s) => s.name === "ping");
	assert.ok(pingAfterFirst?.local, "local subscription must stay active while Window 2 still holds main:watch");

	const unionAfterFirst = await page.evaluate(() => (window as any).pine.call("GET", "/ui/tabs"));
	const keysAfterFirst = (unionAfterFirst.data.tabs as Array<{ agent: string; session: string }>).map((t) => `${t.agent}:${t.session}`).sort();
	assert.deepEqual(keysAfterFirst, ["main:main", "main:watch", "scout:main"]);

	// Now close main:watch in Window 2 (the last window holding it): local subscription ends and main:watch leaves /ui/tabs.
	await win2.locator("[data-slot=tab]").nth(1).locator("button[aria-label='Close this tab']").click();
	await win2.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 1);
	await new Promise((r) => setTimeout(r, 150));

	const afterLastClose = await page.evaluate(() => (window as any).pine.call("GET", "/agents/main/sources?session=watch"));
	const pingAfterLast = (afterLastClose.data as Array<{ name: string; local?: unknown }>).find((s) => s.name === "ping");
	assert.equal(pingAfterLast?.local, undefined, "local subscription ends when the last window holding main:watch closes it");

	// Closing Window 2 drops scout:main from the daemon's /ui/tabs union while Window 1 remains open.
	await focusWindow(app, win2);
	await clickMenuItem(app, "File", "Close Window");
	await waitClosed(win2);
	await new Promise((r) => setTimeout(r, 150));

	const unionAfterWin2 = await page.evaluate(() => (window as any).pine.call("GET", "/ui/tabs"));
	const keysAfterWin2 = (unionAfterWin2.data.tabs as Array<{ agent: string; session: string }>).map((t) => `${t.agent}:${t.session}`);
	assert.deepEqual(keysAfterWin2, ["main:main"]);

	await page.evaluate(() => (window as any).pine.call("POST", "/sources/remove", { name: "ping" }));
});

test("set_conversation tab opens, approvals, notifications, and Dock badges route without duplicates across windows on the same environment", async () => {
	await app.evaluate(({ app }: any) => {
		const g = globalThis as any;
		g.badges = [] as Array<string | number>;
		if (app.dock) app.dock.setBadge = (text: string) => void g.badges.push(text);
		app.setBadgeCount = (count: number) => (g.badges.push(count), true);
	});

	await focusWindow(app, page);
	const win2 = await openNewWindow(app, () => clickMenuItem(app, "File", "New Window"));
	await win2.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });
	// Make Window 1 the primary (most recently focused) window while Window 2 stays on NoTab.
	await focusWindow(app, page);

	// 1. set_conversation (pine/conversation change: "open") opens the tab in the primary window only, leaving NoTab untouched.
	await page.fill(
		"[data-slot=composer] textarea",
		mockMsg(
			[
				{ tools: [{ name: "pine_conversations", args: { action: "set_conversation", agent: "scout", name: "main", tab: true } }], text: "Opening scout." },
				{ text: "Opened scout." },
			],
			"open scout tab ",
		),
	);
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 2);
	await new Promise((r) => setTimeout(r, 150));
	assert.equal(await win2.locator("[data-slot=tab]").count(), 0, "NoTab window must not adopt set_conversation tab opens");

	// 2. Approval in a conversation held by win2 & win3 routes only to win2 & win3 (not page), deduplicates notifications, and counts badge as 1.
	await page.evaluate(() => (window as any).pine.call("POST", "/agents/main/prompt", { prompt: "side setup", session: "side", wait: true }));
	const win3 = await openNewWindow(app, () => clickMenuItem(app, "File", "New Window"));
	await win3.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });

	for (const w of [win2, win3]) {
		await w.locator("[data-slot=no-tab] button").nth(1).click();
		await w.waitForSelector("[data-slot=tab][data-active]", { timeout: 20_000 });
		await w.fill("[data-slot=composer] textarea", "/sessions side");
		await w.press("[data-slot=composer] textarea", "Enter");
		await w.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 2);
		// Close main:main in win2 and win3 so they hold only main:side.
		await w.locator("[data-slot=tab]").first().locator("button[aria-label='Close this tab']").click();
		await w.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 1);
	}

	// Blur all windows so background notifications fire, and reset recorded notifications/badges.
	await app.evaluate(({ BrowserWindow }: any) => {
		for (const bw of BrowserWindow.getAllWindows()) if (!bw.isDestroyed()) bw.emit("blur");
		(globalThis as any).quiet.notified.length = 0;
		(globalThis as any).badges.length = 0;
	});

	await win2.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "bash", args: { command: "echo shared-check" } }], text: "Checking." }, { text: "Checked." }], "run shared check "));
	await win2.keyboard.press("Enter");

	await win2.waitForSelector('[data-item="approval"][data-state="open"]', { timeout: 20_000 });
	await win3.waitForSelector('[data-item="approval"][data-state="open"]', { timeout: 20_000 });
	await new Promise((r) => setTimeout(r, 200));

	assert.equal(await page.locator('[data-item="approval"][data-state="open"]').count(), 0, "Window 1 does not hold main:side and must not receive its approval");
	const notifiedShared = await app.evaluate(() => (globalThis as any).quiet.notified.filter((n: any) => /approval/.test(n.body)));
	assert.equal(notifiedShared.length, 1, `expected 1 deduplicated approval notification across win2 & win3, got ${JSON.stringify(notifiedShared)}`);
	const lastBadge = await app.evaluate(() => (globalThis as any).badges.at(-1));
	assert.equal(String(lastBadge), "1", "Dock badge counts the single unique approval once across windows");

	// Decide in win2 (dismiss modal if open or click Allow in modal/card); win3 updates too and badge clears.
	if (await win2.locator("[role=dialog], [role=alertdialog]").count()) {
		await win2.locator("[role=dialog], [role=alertdialog]").getByRole("button", { name: /^Allow/ }).first().click();
	} else {
		await win2.click('[data-item="approval"][data-state="open"] button:has-text("Allow")');
	}
	await win2.waitForSelector('[data-item="approval"][data-state="allowed"]', { timeout: 20_000 });
	await win3.waitForSelector('[data-item="approval"][data-state="allowed"]', { timeout: 20_000 });
	await win2.waitForSelector("[data-slot=markdown] >> text=Checked.", { timeout: 20_000 });
	const clearedBadge = await app.evaluate(() => (globalThis as any).badges.at(-1));
	assert.ok(clearedBadge === "" || clearedBadge === 0, `expected cleared badge, got ${JSON.stringify(clearedBadge)}`);

	// Close win3, put win2 back on NoTab, and make Window 1 the most recently focused window (then blur all).
	await focusWindow(app, win3);
	await clickMenuItem(app, "File", "Close Window");
	await waitClosed(win3);

	await focusWindow(app, win2);
	await clickMenuItem(app, "File", "Close Tab");
	await win2.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });

	await focusWindow(app, page);
	await page.locator("[data-slot=tab]").first().click();
	await app.evaluate(({ BrowserWindow }: any) => {
		for (const bw of BrowserWindow.getAllWindows()) if (!bw.isDestroyed()) bw.emit("blur");
	});

	// 3. Orphan approval (conversation open in zero windows) routes only to primary Window 1, and a newly opened NoTab window does not adopt it on boot.
	await page.evaluate(
		(promptText: string) => (window as any).pine.call("POST", "/agents/main/prompt", { prompt: promptText, session: "orphan", wait: false }),
		mockMsg([{ tools: [{ name: "bash", args: { command: "echo orphan-check" } }], text: "Orphan asking." }, { text: "Orphan done." }], "orphan task "),
	);

	await page.waitForSelector('[data-item="approval"][data-state="open"]', { timeout: 20_000 });
	await new Promise((r) => setTimeout(r, 150));
	assert.equal(await win2.locator("[data-slot=tab]").count(), 0, "unfocused NoTab window must not adopt orphan approval");

	const win4 = await openNewWindow(app, () => clickMenuItem(app, "File", "New Window"));
	await win4.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });
	await new Promise((r) => setTimeout(r, 150));
	assert.equal(await win4.locator("[data-slot=tab]").count(), 0, "newly opened NoTab window must not adopt pending orphan approval from GET /approvals");

	if (await page.locator("[role=dialog], [role=alertdialog]").count()) {
		await page.locator("[role=dialog], [role=alertdialog]").getByRole("button", { name: /^Allow/ }).first().click();
	} else {
		await page.click('[data-item="approval"][data-state="open"] button:has-text("Allow")');
	}
	await page.waitForSelector('[data-item="approval"][data-state="allowed"]', { timeout: 20_000 });

	await focusWindow(app, win4);
	await clickMenuItem(app, "File", "Close Window");
	await waitClosed(win4);

	// 4. Moving a tab with an open approval transfers ownership to the new window, and switching host or closing the owning window re-dispatches stranded approvals.
	await focusWindow(app, page);
	if ((await page.locator("[data-slot=tab]").count()) > 1) {
		await page.locator("[data-slot=tab]").nth(1).locator("button[aria-label='Close this tab']").click();
		await page.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 1);
	}
	await page.fill("[data-slot=composer] textarea", "/sessions side");
	await page.press("[data-slot=composer] textarea", "Enter");
	await page.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 2);

	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "bash", args: { command: "echo move-rehome-check" } }], text: "Move asking." }, { text: "Move done." }], "run move check "));
	await page.keyboard.press("Enter");
	await page.waitForSelector('[data-item="approval"][data-state="open"]', { timeout: 20_000 });
	if (await page.locator("[role=dialog], [role=alertdialog]").count()) {
		await page.keyboard.press("Escape");
		await page.waitForSelector("[role=dialog], [role=alertdialog]", { state: "detached", timeout: 5_000 }).catch(() => {});
	}

	const winMoved = await openNewWindow(app, async () => {
		await page.locator("[data-slot=tab]").nth(1).click({ button: "right" });
		await page.locator('[role=menu][aria-label="Tab"] [role=menuitem]').nth(4).click();
	});
	await winMoved.waitForSelector('[data-item="approval"][data-state="open"]', { timeout: 20_000 });
	await page.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 1);
	assert.equal(await page.locator('[data-item="approval"][data-state="open"]').count(), 0, "moved tab approval leaves the source window");
	assert.equal(await win2.locator("[data-slot=tab]").count(), 0);

	// Switching winMoved to another environment strands the local approval and re-dispatches it to primary local Window 1 (page).
	await focusWindow(app, page);
	await page.evaluate(() => (window as any).pine.addHost("you@elsewhere"));
	await winMoved.evaluate(() => (window as any).pine.use("you@elsewhere"));
	await page.waitForSelector('[data-item="approval"][data-state="open"]', { timeout: 10_000 });
	assert.equal(await win2.locator("[data-slot=tab]").count(), 0, "unfocused NoTab window must not adopt re-dispatched approval");

	if (await page.locator("[role=dialog], [role=alertdialog]").count()) {
		await page.keyboard.press("Escape");
		await page.waitForSelector("[role=dialog], [role=alertdialog]", { state: "detached", timeout: 5_000 }).catch(() => {});
	}
	await page.fill("[data-slot=composer] textarea", "/approve");
	await page.press("[data-slot=composer] textarea", "Enter");
	await page.waitForFunction(() => document.querySelectorAll('[data-item="approval"][data-state="open"]').length === 0);

	// Closing the only window holding a conversation with an open approval re-dispatches it to the remaining window on that environment.
	await win2.locator("[data-slot=no-tab] button").nth(1).click();
	await win2.waitForSelector("[data-slot=tab][data-active]", { timeout: 20_000 });
	await win2.fill("[data-slot=composer] textarea", "/sessions side");
	await win2.press("[data-slot=composer] textarea", "Enter");
	await win2.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 2);
	await win2.locator("[data-slot=tab]").first().locator("button[aria-label='Close this tab']").click();
	await win2.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 1);

	await focusWindow(app, page);
	await app.evaluate(({ BrowserWindow }: any) => {
		for (const bw of BrowserWindow.getAllWindows()) if (!bw.isDestroyed()) bw.emit("blur");
	});

	await win2.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "bash", args: { command: "echo close-rehome-check" } }], text: "Close asking." }, { text: "Close done." }], "run close check "));
	await win2.keyboard.press("Enter");
	await win2.waitForSelector('[data-item="approval"][data-state="open"]', { timeout: 20_000 });
	assert.equal(await page.locator('[data-item="approval"][data-state="open"]').count(), 0);

	await focusWindow(app, win2);
	await clickMenuItem(app, "File", "Close Window");
	await waitClosed(win2);

	await page.waitForSelector('[data-item="approval"][data-state="open"]', { timeout: 10_000 });
	if (await page.locator("[role=dialog], [role=alertdialog]").count()) {
		await page.keyboard.press("Escape");
		await page.waitForSelector("[role=dialog], [role=alertdialog]", { state: "detached", timeout: 5_000 }).catch(() => {});
	}
	await page.fill("[data-slot=composer] textarea", "/approve");
	await page.press("[data-slot=composer] textarea", "Enter");
	await page.waitForFunction(() => document.querySelectorAll('[data-item="approval"][data-state="open"]').length === 0);

	await focusWindow(app, winMoved);
	await clickMenuItem(app, "File", "Close Window");
	await waitClosed(winMoved);
	await page.evaluate(() => (window as any).pine.forgetHost("you@elsewhere"));
	await focusWindow(app, page);
	if ((await page.locator("[data-slot=tab]").count()) > 1) {
		await page.locator("[data-slot=tab]").nth(1).locator("button[aria-label='Close this tab']").click();
		await page.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 1);
	}
});

test("quitting restores all open windows with their environment, bounds, tabs and panels; closing all windows individually reopens one window on the last-used environment", async () => {
	const setBounds = async (electronApp: ElectronApplication, target: Page, bounds: { x: number; y: number; width: number; height: number }) => {
		const handle = await electronApp.browserWindow(target);
		await handle.evaluate((win: any, b: any) => win.setBounds(b), bounds);
		return handle.evaluate((win: any) => win.getBounds());
	};

	// Window 1 (this computer): bounds1, tabs [main, scout] with scout active, browser aside open and widened.
	await focusWindow(app, page);
	const b1 = await setBounds(app, page, { x: 120, y: 110, width: 1220, height: 800 });
	await page.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { has: page.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }) }).locator("[data-slot=agent-label]").click();
	await page.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 2);
	await page.click(BROWSER_TOGGLE);
	await sees("#browser-panel [data-slot=browser-aside]");
	const edge = await page.$eval(BROWSER_EDGE, (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(edge.x + edge.width / 2, 300);
	await page.mouse.down();
	await page.mouse.move(edge.x + edge.width / 2 - 35, 300, { steps: 4 });
	await page.mouse.up();
	const savedAsideWidth = Math.round(await page.$eval("#browser-panel", (el: Element) => el.getBoundingClientRect().width));

	// Window 2 (remote SSH host you@elsewhere): bounds2, tabs [main, helper] with helper active, sidebar hidden, code panel open.
	await page.evaluate(() => (window as any).pine.addHost("you@elsewhere"));
	const win2 = await openNewWindow(app, () => page.evaluate(() => (window as any).pine.newWindow({ host: "you@elsewhere" })));
	await win2.waitForSelector("[data-slot=room]", { timeout: 60_000 });
	const b2 = await setBounds(app, win2, { x: 240, y: 160, width: 1180, height: 780 });
	await win2.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { has: win2.locator("[data-slot=agent-label] > :first-child", { hasText: /^helper$/ }) }).locator("[data-slot=agent-label]").click();
	await win2.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 2);
	await win2.click(CODE_TOGGLE);
	await win2.waitForSelector("#code-panel [data-slot=code-panel]", { timeout: 20_000 });
	await focusWindow(app, win2);
	await clickMenuItem(app, "View", "Toggle Sidebar");
	await win2.waitForSelector("#sidebar-panel", { state: "detached", timeout: 10_000 });

	// Window 3 (this computer, empty NoTab): bounds3.
	await focusWindow(app, page);
	const win3 = await openNewWindow(app, () => clickMenuItem(app, "File", "New Window"));
	await win3.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });
	const b3 = await setBounds(app, win3, { x: 320, y: 200, width: 1120, height: 760 });
	await new Promise((r) => setTimeout(r, 150));

	// Quit the app while all three windows are open.
	await app.close();
	closed();

	const relaunchEnv = {
		...process.env,
		PLAYWRIGHT_BROWSERS_PATH: browsers,
		PINE_HOME: home,
		PINE_DESKTOP_DATA: path.join(home, "desktop-data"),
		PINE_SKIP_DOWNLOADS: "1",
		PINE_DESKTOP_DEV_URL: "",
		PINE_DESKTOP_VOICE: path.join(home, "voice-stand-in.mjs"),
		PINE_DESKTOP_SHELL: "/bin/bash",
		PINE_DESKTOP_RELEASES: `http://127.0.0.1:${(github.address() as any).port}/repos/pmndre/pine/releases/latest`,
		PINE_DESKTOP_SSH: path.join(home, "ssh-stand-in.mjs"),
	};

	const waitWindows = async (electronApp: ElectronApplication, count: number) => {
		const deadline = Date.now() + 20_000;
		while (electronApp.windows().length < count && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 50));
		}
		assert.equal(electronApp.windows().length, count);
		for (const w of electronApp.windows()) {
			await w.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
		}
		return electronApp.windows();
	};

	let app2: ElectronApplication | undefined;
	let app3: ElectronApplication | undefined;
	try {
		app2 = await launchApp(relaunchEnv);
		const restored = await waitWindows(app2, 3);

		// Wait for all 3 windows to finish loading their daemons.
		await Promise.all(restored.map((w) => w.waitForSelector("[data-slot=room]", { timeout: 60_000 })));

		const summaries = await Promise.all(
			restored.map(async (w) => ({
				page: w,
				bounds: await windowBounds(app2!, w),
				host: await w.evaluate(() => (window as any).pine.state().then((s: any) => s.state.host ?? null)),
				tabs: await w.locator("[data-slot=tab]").count(),
				activeSecond: (await w.locator("[data-slot=tab]").count()) > 1 ? await w.locator("[data-slot=tab]").nth(1).getAttribute("data-active") : null,
				noTab: await w.locator("[data-slot=no-tab]").count(),
				sidebar: await w.locator("#sidebar-panel").count(),
				code: await w.locator("#code-panel").count(),
				asideWidth: (await w.locator("#browser-panel").count()) ? Math.round(await w.$eval("#browser-panel", (el: Element) => el.getBoundingClientRect().width)) : 0,
			})),
		);

		const r1 = summaries.find((s) => s.host === null && s.tabs === 2);
		const r2 = summaries.find((s) => s.host === "you@elsewhere");
		const r3 = summaries.find((s) => s.host === null && s.noTab === 1);
		assert.ok(r1, `expected restored local 2-tab window in ${JSON.stringify(summaries.map((x) => ({ ...x, page: undefined })))}`);
		assert.ok(r2, `expected restored SSH window in ${JSON.stringify(summaries.map((x) => ({ ...x, page: undefined })))}`);
		assert.ok(r3, `expected restored local NoTab window in ${JSON.stringify(summaries.map((x) => ({ ...x, page: undefined })))}`);

		assert.deepEqual(r1.bounds, b1);
		assert.equal(r1.activeSecond, "true");
		assert.equal(r1.sidebar, 1);
		assert.equal(r1.asideWidth, savedAsideWidth);

		assert.deepEqual(r2.bounds, b2);
		assert.equal(r2.tabs, 2);
		assert.equal(r2.activeSecond, "true");
		assert.equal(r2.sidebar, 0);
		assert.equal(r2.code, 1);

		assert.deepEqual(r3.bounds, b3);
		assert.equal(r3.tabs, 0);

		// Close all three windows individually, ending with r2 (you@elsewhere) so it is the last-used environment and bounds.
		for (const target of [r1.page, r3.page, r2.page]) {
			await focusWindow(app2, target);
			await clickMenuItem(app2, "File", "Close Window");
			await waitClosed(target);
		}

		if (process.platform === "darwin") {
			assert.equal(app2.windows().length, 0);
			// Activating the app with zero windows open reopens one window on the last-used environment and bounds.
			const reopened = await openNewWindow(app2, () => app2!.evaluate(({ app: eApp }: any) => eApp.emit("activate")));
			await reopened.waitForSelector("[data-slot=room]", { timeout: 60_000 });
			await new Promise((r) => setTimeout(r, 200));
			assert.equal(app2.windows().length, 1);
			assert.equal(await reopened.evaluate(() => (window as any).pine.state().then((s: any) => s.state.host)), "you@elsewhere");
			assert.deepEqual(await windowBounds(app2, reopened), b2);
			assert.equal(await reopened.locator("[data-slot=tab]").count(), 2);
			assert.equal(await reopened.locator("#sidebar-panel").count(), 0, "reopened window preserves last-closed window chrome");

			await focusWindow(app2, reopened);
			await clickMenuItem(app2, "File", "Close Window");
			await waitClosed(reopened);
		}

		await app2.close();
		app2 = undefined;

		// Relaunch after all windows were closed individually: opens a single window on the last-used environment (you@elsewhere).
		app3 = await launchApp(relaunchEnv);
		const single = await waitWindows(app3, 1);
		await single[0].waitForSelector("[data-slot=room]", { timeout: 60_000 });
		await new Promise((r) => setTimeout(r, 200));
		assert.equal(app3.windows().length, 1);
		assert.equal(await single[0].evaluate(() => (window as any).pine.state().then((s: any) => s.state.host)), "you@elsewhere");
		assert.deepEqual(await windowBounds(app3, single[0]), b2);
		assert.equal(await single[0].locator("[data-slot=tab]").count(), 2);
		assert.equal(await single[0].locator("#sidebar-panel").count(), 0, "relaunched window restores prefs.layout chrome from prefs.json");
	} finally {
		await app2?.close().catch(() => {});
		await app3?.close().catch(() => {});
	}
});




