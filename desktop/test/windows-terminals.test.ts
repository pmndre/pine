// Splitting tabs and conversations into new windows (`Move to New Window`, side bar `Open in New Window`),
// intra-window tab drag-and-drop isolation, and per-window local shell terminal isolation and transfer.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, test } from "node:test";
import type { Page } from "playwright-core";
import { clickMenuItem, focusWindow, openNewWindow, waitClosed } from "./support/app.ts";
import { app, CODE_EDGE, home, page, sees, started } from "./support/window.ts";

before(() => started());

async function sendMenu(target: Page, command: string): Promise<void> {
	const handle = await app.browserWindow(target);
	await handle.evaluate((win: any, cmd: string) => win.webContents.send("pine:menu", cmd), command);
}

async function terminalReady(target: Page): Promise<void> {
	await target.waitForSelector("[data-slot=code-panel] [data-slot=terminal]", { timeout: 20_000 });
	await target.waitForFunction(
		() => {
			const cwd = document.querySelector("[data-slot=terminal-cwd]")?.textContent ?? "";
			return Boolean(cwd && !cwd.startsWith("Starting"));
		},
		undefined,
		{ timeout: 20_000 },
	);
}

async function terminalText(target: Page): Promise<string> {
	return target.$eval("[data-slot=terminal] .xterm-rows", (el: Element) => el.textContent ?? "").catch(() => "");
}

async function terminalShows(target: Page, pattern: RegExp): Promise<string> {
	await target.waitForFunction(
		(src: string) => new RegExp(src).test(document.querySelector("[data-slot=terminal] .xterm-rows")?.textContent ?? ""),
		pattern.source,
		{ timeout: 15_000 },
	);
	return terminalText(target);
}

async function typeInTerminal(target: Page, line: string): Promise<void> {
	await target.click("[data-slot=terminal]");
	await target.keyboard.type(line);
	await target.keyboard.press("Enter");
}

test("two local windows run and resize conversation shell terminals independently, and switching or closing one leaves the other's intact", async () => {
	await focusWindow(app, page);

	const win2 = await openNewWindow(app, () => clickMenuItem(app, "File", "New Window"));
	await win2.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });
	await win2.locator("[data-slot=no-tab]").getByRole("button", { name: "Open main" }).click();
	await win2.waitForSelector("[data-slot=tab][data-active]", { timeout: 20_000 });

	// Open the terminal on main:main in both local windows.
	await sendMenu(page, "code-terminal");
	await sendMenu(win2, "code-terminal");
	await Promise.all([terminalReady(page), terminalReady(win2)]);

	await typeInTerminal(page, "W1_VAR=alpha; echo w1-pid-$$-end");
	await typeInTerminal(win2, "W2_VAR=beta; echo w2-pid-$$-end");

	const out1 = await terminalShows(page, /w1-pid-\d+-end/);
	const out2 = await terminalShows(win2, /w2-pid-\d+-end/);
	const pid1 = /w1-pid-(\d+)-end/.exec(out1)?.[1];
	const pid2 = /w2-pid-(\d+)-end/.exec(out2)?.[1];
	assert.ok(pid1 && pid2 && pid1 !== pid2, `expected distinct shell PIDs across windows, got ${pid1} vs ${pid2}`);
	assert.doesNotMatch(out1, /w2-pid-\d+-end/);
	assert.doesNotMatch(out2, /w1-pid-\d+-end/);

	// Record terminal column counts in both windows, widen Window 2's side panel, and verify only Window 2's shell resizes.
	await typeInTerminal(page, "echo cols1a-$(stty size | cut -d' ' -f2)-end");
	await typeInTerminal(win2, "echo cols2a-$(stty size | cut -d' ' -f2)-end");
	const cols1Before = Number(/cols1a-(\d+)-end/.exec(await terminalShows(page, /cols1a-\d+-end/))?.[1]);
	const cols2Before = Number(/cols2a-(\d+)-end/.exec(await terminalShows(win2, /cols2a-\d+-end/))?.[1]);

	const edge = await win2.$eval(CODE_EDGE, (el: Element) => el.getBoundingClientRect());
	await win2.mouse.move(edge.x + edge.width / 2, 300);
	await win2.mouse.down();
	await win2.mouse.move(edge.x + edge.width / 2 - 150, 300, { steps: 5 });
	await win2.mouse.up();
	await new Promise((r) => setTimeout(r, 200));

	await typeInTerminal(page, "echo cols1b-$(stty size | cut -d' ' -f2)-end");
	await typeInTerminal(win2, "echo cols2b-$(stty size | cut -d' ' -f2)-end");
	const cols1After = Number(/cols1b-(\d+)-end/.exec(await terminalShows(page, /cols1b-\d+-end/))?.[1]);
	const cols2After = Number(/cols2b-(\d+)-end/.exec(await terminalShows(win2, /cols2b-\d+-end/))?.[1]);
	assert.ok(cols2After > cols2Before, `expected Window 2 columns to grow (${cols2Before} -> ${cols2After})`);
	assert.equal(cols1After, cols1Before, "resizing Window 2's terminal must not resize Window 1's terminal");

	// Switch Window 2 to an SSH machine: Window 2's local shell is closed, while Window 1's shell stays alive.
	await win2.evaluate(() => (window as any).pine.addHost("you@elsewhere"));
	await win2.evaluate(() => (window as any).pine.use("you@elsewhere"));
	await win2.waitForSelector("[data-slot=empty] >> text=The main agent of the other machine", { timeout: 60_000 });

	await typeInTerminal(page, "echo after-ssh-$W1_VAR-end");
	await terminalShows(page, /after-ssh-alpha-end/);

	// Switching Window 2 back to this computer starts a fresh shell for main:main (its old shell ended on environment switch).
	await win2.evaluate(() => (window as any).pine.use(undefined));
	await win2.waitForSelector("[data-slot=tab][data-active]", { timeout: 30_000 });
	await sendMenu(win2, "code-terminal");
	await terminalReady(win2);
	await typeInTerminal(win2, "echo back-${W2_VAR:-fresh}-end");
	const reopenedOut2 = await terminalShows(win2, /back-fresh-end/);
	assert.doesNotMatch(reopenedOut2, /w2-pid-\d+-end/);

	// Closing Window 2 leaves Window 1's shell running and responsive.
	await focusWindow(app, win2);
	await clickMenuItem(app, "File", "Close Window");
	await waitClosed(win2);

	await typeInTerminal(page, "echo after-close-$W1_VAR-end");
	await terminalShows(page, /after-close-alpha-end/);

	// Clean up for subsequent tests.
	await page.evaluate(() => (window as any).pine.forgetHost("you@elsewhere"));
	await sendMenu(page, "code");
	await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
	await page.evaluate(() => (window as any).pine.termClose("main:main"));
});

test("Move to New Window splits a chat tab into a new window on the same environment while keeping subscriptions, draft, attachments, and local shell terminal", async () => {
	await focusWindow(app, page);

	// Non-chat tabs (such as Settings) do not offer Move to New Window.
	await sendMenu(page, "settings");
	await sees("[data-slot=settings-page] h1");
	const settingsTabIndex = await page.evaluate(() => [...document.querySelectorAll("[data-slot=tab] [data-slot=tab-name]")].findIndex((el) => el.textContent === "Settings"));
	await page.locator("[data-slot=tab]").nth(settingsTabIndex).click({ button: "right" });
	await sees("[data-slot=context-menu-content]");
	assert.equal(await page.locator("[data-slot=context-menu-content]").getByRole("menuitem", { name: "Move to New Window", exact: true }).count(), 0);
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=context-menu-content]", { state: "detached" });
	await sendMenu(page, "settings");
	await page.waitForFunction(() => ![...document.querySelectorAll("[data-slot=tab] [data-slot=tab-name]")].some((el) => el.textContent === "Settings"));

	// Create a non-main conversation subscribed locally to a webhook source.
	const added = await page.evaluate(() => (window as any).pine.call("POST", "/sources", { name: "move-ping", type: "webhook", description: "Move test webhook", options: {} }));
	assert.equal(added.ok, true);
	await page.evaluate(() => (window as any).pine.call("POST", "/agents/main/prompt", { prompt: "split setup", session: "split", wait: true }));

	await page.fill("[data-slot=composer] textarea", "/sessions split");
	await page.press("[data-slot=composer] textarea", "Enter");
	await page.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 2);
	const sub = await page.evaluate(() => (window as any).pine.call("POST", "/agents/main/subscribe", { source: "move-ping", session: "split" }));
	assert.equal(sub.ok, true);

	// Start a local shell in main:split, set a shell variable, and print output before moving the tab.
	await sendMenu(page, "code-terminal");
	await terminalReady(page);
	await typeInTerminal(page, "SPLIT_VAR=carried_over; echo before-move-77-end");
	await terminalShows(page, /before-move-77-end/);

	// Type an unsent draft and attach a file in main:split's composer.
	const sampleFile = path.join(home, "draft-note.txt");
	fs.writeFileSync(sampleFile, "important attachment payload\n");
	await page.fill("[data-slot=composer] textarea", "Unsent draft carried to new window");
	await page.locator('input[type="file"]').setInputFiles(sampleFile);
	await sees("[data-slot=composer] [data-slot=attachment-title] >> text=draft-note.txt");

	// Right-click main:split's tab and choose Move to New Window.
	await page.locator("[data-slot=tab]").nth(1).click({ button: "right" });
	await sees("[data-slot=context-menu-content]");
	assert.equal(await page.locator("[data-slot=context-menu-content]").getByRole("menuitem", { name: "Move to New Window", exact: true }).count(), 1);
	const win2 = await openNewWindow(app, () =>
		page.locator("[data-slot=context-menu-content]").getByRole("menuitem", { name: "Move to New Window", exact: true }).click(),
	);

	// Source window closed main:split without ending its local subscription; new window opened on main:split.
	await page.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 1);
	assert.equal(await page.textContent("[data-slot=tab][data-active] [data-slot=tab-name]"), "main");

	await win2.waitForSelector("[data-slot=tab][data-active]", { timeout: 20_000 });
	assert.equal(await win2.locator("[data-slot=tab]").count(), 1);
	assert.match((await win2.locator("[data-slot=tab][data-active]").getAttribute("title")) ?? "", /^main · split\b/);
	assert.equal(await win2.evaluate(() => (window as any).pine.state().then((s: any) => s.state.host ?? null)), null);

	// Unsent draft and attachment arrived intact in the new window.
	await win2.waitForFunction(() => (document.querySelector("[data-slot=composer] textarea") as HTMLTextAreaElement | null)?.value === "Unsent draft carried to new window");
	await win2.waitForSelector("[data-slot=composer] [data-slot=attachment-title] >> text=draft-note.txt", { timeout: 10_000 });

	// Non-main session subscription and daemon /ui/tabs union remained intact across the move.
	await new Promise((r) => setTimeout(r, 150));
	const sourcesAfterMove = await win2.evaluate(() => (window as any).pine.call("GET", "/agents/main/sources?session=split"));
	const pingAfterMove = (sourcesAfterMove.data as Array<{ name: string; local?: unknown }>).find((s) => s.name === "move-ping");
	assert.ok(pingAfterMove?.local, "moving a tab to a new window must not end its local session subscription");

	const unionAfterMove = await page.evaluate(() => (window as any).pine.call("GET", "/ui/tabs"));
	const unionKeys = (unionAfterMove.data.tabs as Array<{ agent: string; session: string }>).map((t) => `${t.agent}:${t.session}`).sort();
	assert.deepEqual(unionKeys, ["main:main", "main:split"]);

	// Opening the terminal in the new window reconnects to the transferred live shell with its kept output and variables.
	await sendMenu(win2, "code-terminal");
	await terminalReady(win2);
	await terminalShows(win2, /before-move-77-end/);
	await typeInTerminal(win2, "echo after-move-$SPLIT_VAR-end");
	await terminalShows(win2, /after-move-carried_over-end/);

	// Sending the carried draft + attachment in the new window delivers both to the daemon.
	await win2.press("[data-slot=composer] textarea", "Enter");
	await win2.waitForSelector("[data-slot=markdown] >> text=ECHO[Unsent draft carried to new window", { timeout: 20_000 });
	assert.match((await win2.locator("[data-slot=markdown]").last().textContent()) ?? "", /files attached by your owner[\s\S]*draft-note\.txt/);
	const inboxDir = path.join(home, "agents", "main", "workspace", "inbox");
	const savedName = fs.readdirSync(inboxDir).find((f) => f.endsWith("draft-note.txt"));
	assert.ok(savedName, "expected attached file in agent workspace inbox");
	assert.equal(fs.readFileSync(path.join(inboxDir, savedName), "utf8"), "important attachment payload\n");

	// Move to New Window on a remote SSH environment opens the new window on that same SSH environment.
	await win2.evaluate(() => (window as any).pine.addHost("you@elsewhere"));
	await win2.evaluate(() => (window as any).pine.use("you@elsewhere"));
	await win2.waitForSelector("[data-slot=empty] >> text=The main agent of the other machine", { timeout: 60_000 });
	await win2.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { has: win2.locator("[data-slot=agent-label] > :first-child", { hasText: /^helper$/ }) }).locator("[data-slot=agent-label]").click();
	await win2.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 2);

	await win2.locator("[data-slot=tab]").nth(1).click({ button: "right" });
	await win2.waitForSelector("[data-slot=context-menu-content]", { timeout: 10_000 });
	const win3 = await openNewWindow(app, () =>
		win2.locator("[data-slot=context-menu-content]").getByRole("menuitem", { name: "Move to New Window", exact: true }).click(),
	);
	await win3.waitForSelector("[data-slot=tab][data-active]", { timeout: 60_000 });
	assert.equal(await win3.evaluate(() => (window as any).pine.state().then((s: any) => s.state.host)), "you@elsewhere");
	assert.match((await win3.locator("[data-slot=tab][data-active]").getAttribute("title")) ?? "", /^helper · main\b/);
	await win2.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 1);

	// Clean up.
	for (const w of [win3, win2]) {
		await focusWindow(app, w);
		await clickMenuItem(app, "File", "Close Window");
		await waitClosed(w);
	}
	await focusWindow(app, page);
	await page.evaluate(() => (window as any).pine.forgetHost("you@elsewhere"));
	await page.evaluate(() => (window as any).pine.call("POST", "/sources/remove", { name: "move-ping" }));
	if (await page.$("[data-slot=code-panel]")) {
		await sendMenu(page, "code");
		await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
	}
});

test("side bar Open in New Window opens a conversation row or a single-conversation agent in a new window on the same environment", async () => {
	await focusWindow(app, page);
	await app.evaluate(({ ipcMain }: any) => {
		const g = globalThis as any;
		g.ctxMenus = [] as Array<Array<{ id: string; label: string }>>;
		g.realCtxMenu ??= ipcMain._invokeHandlers.get("pine:context-menu");
		ipcMain.removeHandler("pine:context-menu");
		ipcMain.handle("pine:context-menu", (_e: unknown, items: Array<{ id: string; label: string; separator?: boolean }>) => {
			g.ctxMenus.push(items.filter((i) => !i.separator).map((i) => ({ id: i.id, label: i.label })));
			return g.ctxPick;
		});
	});

	let winSplit: Page | undefined;
	let winScout: Page | undefined;
	let winHelper: Page | undefined;
	try {
		const rightClickPick = async (locator: any, pick: string | undefined) => {
			const beforeCount = await app.evaluate((_electron: unknown, p: string | undefined) => {
				const g = globalThis as any;
				g.ctxPick = p;
				return g.ctxMenus.length as number;
			}, pick);
			await locator.click({ button: "right" });
			for (let i = 0; i < 100; i++) {
				const menus = await app.evaluate(() => (globalThis as any).ctxMenus as Array<Array<{ id: string; label: string }>>);
				if (menus.length > beforeCount) return menus.at(-1)!;
				await new Promise((r) => setTimeout(r, 25));
			}
			throw new Error("context menu was not shown");
		};

		// 1. Conversation row under multi-conversation agent main (main + split).
		const splitRow = page.locator('#sidebar-panel [role=option][title^="main · split ·"]');
		await splitRow.waitFor({ timeout: 10_000 });
		const splitMenu = await rightClickPick(splitRow, undefined);
		assert.deepEqual(splitMenu.slice(0, 2), [
			{ id: "open", label: "Open" },
			{ id: "open-window", label: "Open in New Window" },
		]);

		winSplit = await openNewWindow(app, () => rightClickPick(splitRow, "open-window"));
		await winSplit.waitForSelector("[data-slot=tab][data-active]", { timeout: 20_000 });
		assert.match((await winSplit.locator("[data-slot=tab][data-active]").getAttribute("title")) ?? "", /^main · split\b/);
		assert.equal(await winSplit.evaluate(() => (window as any).pine.state().then((s: any) => s.state.host ?? null)), null);
		assert.equal(await page.locator("[data-slot=tab]").count(), 1);
		assert.match((await page.locator("[data-slot=tab][data-active]").getAttribute("title")) ?? "", /^main · main\b/);

		// 2. Single-conversation agent line (scout).
		const scoutLine = page.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", {
			has: page.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }),
		});
		const scoutMenu = await rightClickPick(scoutLine, undefined);
		assert.deepEqual(scoutMenu.slice(0, 2), [
			{ id: "open", label: "Open" },
			{ id: "open-window", label: "Open in New Window" },
		]);

		winScout = await openNewWindow(app, () => rightClickPick(scoutLine, "open-window"));
		await winScout.waitForSelector("[data-slot=tab][data-active]", { timeout: 20_000 });
		assert.match((await winScout.locator("[data-slot=tab][data-active]").getAttribute("title")) ?? "", /^scout · main\b/);
		assert.equal(await page.locator("[data-slot=tab]").count(), 1);

		// 3. On a remote SSH environment, Open in New Window opens the conversation on that SSH environment.
		await winScout.evaluate(() => (window as any).pine.addHost("you@elsewhere"));
		await winScout.evaluate(() => (window as any).pine.use("you@elsewhere"));
		await winScout.waitForSelector("[data-slot=empty] >> text=The main agent of the other machine", { timeout: 60_000 });
		const helperLine = winScout.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", {
			has: winScout.locator("[data-slot=agent-label] > :first-child", { hasText: /^helper$/ }),
		});
		winHelper = await openNewWindow(app, () => rightClickPick(helperLine, "open-window"));
		await winHelper.waitForSelector("[data-slot=tab][data-active]", { timeout: 60_000 });
		assert.equal(await winHelper.evaluate(() => (window as any).pine.state().then((s: any) => s.state.host)), "you@elsewhere");
		assert.match((await winHelper.locator("[data-slot=tab][data-active]").getAttribute("title")) ?? "", /^helper · main\b/);
	} finally {
		await app.evaluate(({ ipcMain }: any) => {
			const g = globalThis as any;
			if (g.realCtxMenu) {
				ipcMain.removeHandler("pine:context-menu");
				ipcMain.handle("pine:context-menu", g.realCtxMenu);
			}
		});
		for (const w of [winHelper, winScout, winSplit]) {
			if (w && !w.isClosed()) {
				await focusWindow(app, w);
				await clickMenuItem(app, "File", "Close Window");
				await waitClosed(w);
			}
		}
		await focusWindow(app, page);
		await page.evaluate(() => (window as any).pine.forgetHost("you@elsewhere")).catch(() => {});
	}
});

test("tab drag-and-drop reorders tabs within the same window and ignores drops originating from another window", async () => {
	await focusWindow(app, page);
	await page
		.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", {
			has: page.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }),
		})
		.locator("[data-slot=agent-label]")
		.click();
	await page.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 2);

	const tabKeys = (target: Page) =>
		target.$$eval("[data-slot=tab]", (els: Element[]) => els.map((el) => (el.getAttribute("title") ?? "").split(" · ").slice(0, 2).join(":")));

	assert.deepEqual(await tabKeys(page), ["main:main", "scout:main"]);

	// Intra-window drag reorders tabs within Window 1.
	await page.locator("[data-slot=tab]").nth(1).dragTo(page.locator("[data-slot=tab]").nth(0));
	assert.deepEqual(await tabKeys(page), ["scout:main", "main:main"]);

	// Open Window 2 with its own tab and capture the exact DataTransfer payload produced by dragging its tab 0.
	const win2 = await openNewWindow(app, () => page.evaluate(() => (window as any).pine.newWindow({ tab: { agent: "main", session: "main" } })));
	await win2.waitForSelector("[data-slot=tab][data-active]", { timeout: 20_000 });

	const foreignPayload = await win2.$eval("[data-slot=tab]", (el: Element) => {
		const dt = new DataTransfer();
		el.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
		return dt.types.map((type) => [type, dt.getData(type)] as [string, string]);
	});
	assert.ok(foreignPayload.length > 0, "expected tab dragstart in Window 2 to populate DataTransfer");

	// Dispatch dragover and drop on Window 1's second tab carrying Window 2's DataTransfer payload.
	const crossWindowDrop = await page.$eval(
		"[data-slot=tab]:nth-child(2)",
		(el: Element, entries: Array<[string, string]>) => {
			const dt = new DataTransfer();
			for (const [type, value] of entries) dt.setData(type, value);
			el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
			const markedDrop = el.hasAttribute("data-drop");
			el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
			return { markedDrop };
		},
		foreignPayload,
	);

	assert.equal(crossWindowDrop.markedDrop, false, "cross-window tab dragover must not mark the tab as a drop target");
	assert.deepEqual(await tabKeys(page), ["scout:main", "main:main"], "cross-window tab drop must leave Window 1's tab order untouched");

	// Clean up.
	await focusWindow(app, win2);
	await clickMenuItem(app, "File", "Close Window");
	await waitClosed(win2);
	await focusWindow(app, page);
	await page.locator("[data-slot=tab]").first().locator("button[aria-label='Close this tab']").click();
	await page.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 1);
});
