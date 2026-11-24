// The app from end to end: the real Electron app on a pine home of its own, with the scripted
// model server of pine's test suite behind it (test/support/window.ts). It starts the daemon
// itself (`pine service`), which is half of what is tested here. This file is the start, a
// conversation and what is in one, the panel beside it, and the settings; app-around.test.ts is
// what lies around a conversation. Each has an app and a home of its own, and they run side by side.
//
//   npm test                         in desktop/
//   PINE_DESKTOP_SHOTS=<folder>      also saves a picture of each screen there
//   PINE_DESKTOP_THEME=<theme>       in that theme of pine's (github-light, dracula ...)
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { before, test } from "node:test";
import { mockMsg } from "../../baseline/tests/mock.mjs";
import { httpMcp } from "../../test/support/http-mcp.ts";
import { activeOption, announced, api, app, BROWSER_EDGE, BROWSER_TOGGLE, browsers, closed, CODE_EDGE, CODE_TOGGLE, confirm, far, folder, github, HERE, home, json, menu, mock, named, page, putAwayToasts, releases, root, sees, shot, started, stillInside, write } from "./support/window.ts";

test("starts a daemon of its own and shows the main agent", async () => {
	await sees("[data-slot=empty] h1");
	assert.equal(await page.textContent("[data-slot=empty] h1"), "main");
	// This home has no browser for the web tools in the build its pine drives (the folder for it
	// is empty): that is asked once, at the start, and "Not now" is remembered.
	await sees(`[data-slot=dialog-title] >> text=The browser for the web tools is not on this ${HERE}`);
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
	// An app from a checkout updates nothing itself: macOS's updater was never pointed at a feed, and there is no switch for it.
	assert.equal(await app.evaluate(({ autoUpdater }: any) => autoUpdater.getFeedURL()), "");
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
	// Settings > General has the same, and the switch for the question at the start.
	await menu("settings");
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=General");
	await sees("[data-setting=updates] [data-slot=badge][data-variant=default] >> text=the latest version");
	releases.tag = "v9.9.9";
	await page.locator("[data-setting=updates]").getByRole("button", { name: "Check now" }).click();
	await sees("[data-setting=updates] [data-slot=badge][data-variant=outline] >> text=9.9.9 is available");
	await page.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Not now" }).click();
	await page.locator("[data-setting=updates]").getByRole("button", { name: "Release page" }).click();
	assert.deepEqual(await opened(), [link, link, link]);
	const prefs = () => JSON.parse(fs.readFileSync(path.join(home, "desktop-data", "prefs.json"), "utf8"));
	assert.equal(await page.$("[data-slot=field]:has-text('Update automatically')"), null);
	await page.click("[data-slot=field]:has-text('Check for updates at start') [data-slot=switch]");
	for (let i = 0; i < 50 && prefs().updates !== false; i++) await new Promise((r) => setTimeout(r, 40));
	assert.equal(prefs().updates, false);
	// It is a switch to assistive technology too, and Space turns it back on.
	await sees("[data-slot=field]:has-text('Check for updates at start') [role=switch][aria-checked=false]");
	await page.keyboard.press("Space");
	await sees("[data-slot=field]:has-text('Check for updates at start') [role=switch][aria-checked=true]");
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
	const where = { open: true, tabs: [{ title: "<img src=x onerror=window.hacked=3>Okapi shop", url: "https://shop.example/" }, { title: "Second", url: "https://shop.example/two" }], current: 0, window: false, scale: 2 };
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

		// A click in the picture is a click at that place in the page, whatever size the picture is drawn at: the
		// picture has two pixels for a point of the page (scale), as sharp as a Retina display draws.
		const box = await page.$eval("[data-slot=browser] canvas", (c: HTMLCanvasElement) => ({ x: c.getBoundingClientRect().left, y: c.getBoundingClientRect().top, k: c.width / 2 / c.getBoundingClientRect().width }));
		await page.mouse.click(box.x + 100, box.y + 60);
		await waitFor("the click arrived", () => ops().some((o) => o.do === "click"));
		const click = ops().find((o) => o.do === "click");
		assert.ok(Math.abs(click.x - 100 * box.k) <= 1 && Math.abs(click.y - 60 * box.k) <= 1 && click.button === "left", JSON.stringify(click));
		// Letters typed in a row go as one text, a key by its name, and what is pasted as text too.
		await page.keyboard.type("okapi");
		await page.keyboard.press("Enter");
		await page.keyboard.press("ControlOrMeta+KeyA");
		await waitFor("what was typed arrived", () => ops().some((o) => o.do === "key" && o.key === "ControlOrMeta+KeyA"));
		assert.equal(ops().filter((o) => o.do === "text").map((o) => o.text).join(""), "okapi");
		assert.ok(ops().filter((o) => o.do === "text").length < 5, "letters are not sent one by one");
		assert.deepEqual(ops().filter((o) => o.do === "key").map((o) => o.key), ["Enter", "ControlOrMeta+KeyA"]);
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
		await sees("[data-slot=toast] >> text=The panel shows: agent, files, changes, turn, output, running, board, terminal.");
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

test("a conversation that is loading shows its shape, and the shape goes once what was said is there", async () => {
	// The answer to the history is held back by the test, in the app's main process, until it lets it go.
	await app.evaluate(({ ipcMain }: any) => {
		const g = globalThis as any;
		const call = ipcMain._invokeHandlers.get("pine:call");
		g.held = [];
		ipcMain.removeHandler("pine:call");
		ipcMain.handle("pine:call", (e: unknown, method: string, url: string, body?: unknown) => {
			if (!/^\/tasks\?.*session=/.test(url)) return call(e, method, url, body);
			return new Promise((done) => g.held.push(() => done(call(e, method, url, body))));
		});
		g.unhold = () => {
			ipcMain.removeHandler("pine:call");
			ipcMain.handle("pine:call", call);
			for (const go of g.held.splice(0)) go();
		};
	});
	// A conversation opened anew, here scout's from the side bar, asks for its history.
	const scout = page.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { has: page.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }) });
	try {
		await scout.locator("[data-slot=agent-label]").click();
		await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=scout");
		await sees("[data-slot=conversation-skeleton] [data-slot=skeleton]");
		assert.equal(await page.$("[data-slot=pulse][aria-label=Loading]"), null, "a loading conversation shows its shape, not the Pulse");
		assert.equal(await page.$("[data-slot=message-scroller-content]"), null);
		assert.equal(await page.$("[data-slot=empty]"), null, "no empty state shows before the data is there");
		await shot("02-loading");
	} finally {
		await app.evaluate(() => (globalThis as any).unhold());
	}
	await sees("[data-slot=message-scroller-content]");
	assert.equal(await page.$("[data-slot=conversation-skeleton]"), null);
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=main");
});

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

test("the send button sends what was typed with a click, as Enter does", async () => {
	// A toast left by an earlier test lies over the button (its timer waits while the window is in the background): closed.
	await page.$$eval("[data-slot=toast-close]", (buttons: Element[]) => buttons.forEach((b) => (b as HTMLElement).click()));
	await page.waitForSelector("[data-slot=toast]", { state: "detached", timeout: 15_000 });
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "sent by the button" }], "click to send "));
	await page.locator("[data-slot=composer] [data-slot=input-group]").getByRole("button", { name: "Send", exact: true }).click();
	await sees("[data-slot=markdown] >> text=sent by the button");
	assert.equal(await page.inputValue("[data-slot=composer] textarea"), "");
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "sent by Enter" }], "enter to send "));
	await page.press("[data-slot=composer] textarea", "Enter");
	await sees("[data-slot=markdown] >> text=sent by Enter");
});

test("off a Mac, where the window shows no menu bar, the bar's menu button opens the app's menus below itself; a Mac has none", async () => {
	const button = page.locator("header [data-slot=app-menu]");
	if (process.platform === "darwin") {
		assert.equal(await button.count(), 0);
		return;
	}
	// The menu a system draws cannot be read from the page: where it was asked to open, and with what, is noted instead.
	await app.evaluate(({ Menu }: any) => {
		const m = Menu.getApplicationMenu();
		(globalThis as any).popped = undefined;
		m.popup = (o: any) => ((globalThis as any).popped = { x: o.x, y: o.y, menus: m.items.map((i: any) => i.label) });
	});
	const box = (await button.boundingBox())!;
	await button.click();
	for (let i = 0; i < 50 && !(await app.evaluate(() => (globalThis as any).popped)); i++) await new Promise((r) => setTimeout(r, 50));
	const popped = await app.evaluate(() => (globalThis as any).popped);
	await app.evaluate(({ Menu }: any) => delete Menu.getApplicationMenu().popup);
	assert.ok(popped, "the button opened no menu");
	assert.deepEqual(popped.menus, ["File", "Edit", "View", "Conversation", "Window", "Help"]);
	assert.ok(Math.abs(popped.x - box.x) <= 1 && Math.abs(popped.y - (box.y + box.height)) <= 1, JSON.stringify({ popped, box }));
});

test("off a Mac the window's controls stay as tall as the bar when the page is zoomed in and out", { skip: process.platform === "darwin" && "a Mac's buttons lie beside the bar, at a height of their own" }, async () => {
	const zoom = (label: string) => app.evaluate(({ Menu }: any, l: string) => Menu.getApplicationMenu().items.find((m: any) => m.label === "View").submenu.items.find((i: any) => i.label === l).click(), label);
	// What the window is told about its controls is noted: under the viewport these tests set, the page's own account of
	// them (navigator.windowControlsOverlay) no longer follows the window.
	await app.evaluate(({ BrowserWindow }: any) => {
		const w = BrowserWindow.getAllWindows()[0];
		const own = w.setTitleBarOverlay.bind(w);
		(globalThis as any).overlay = undefined;
		w.setTitleBarOverlay = (o: any) => (((globalThis as any).overlay = o), own(o));
	});
	const bar = await page.$eval("header:has([data-toggle=code])", (h: Element) => h.getBoundingClientRect().height);
	try {
		for (const step of ["Zoom In", "Zoom In", "Zoom Out", "Zoom Out", "Zoom Out", "Actual Size"]) {
			await app.evaluate(() => ((globalThis as any).overlay = undefined));
			await zoom(step);
			for (let i = 0; i < 20 && !(await app.evaluate(() => (globalThis as any).overlay)); i++) await new Promise((r) => setTimeout(r, 50));
			const told = await app.evaluate(({ BrowserWindow }: any) => ({ height: (globalThis as any).overlay?.height, zoom: BrowserWindow.getAllWindows()[0].webContents.getZoomFactor() }));
			// The window counts in its own pixels: the page's times its zoom.
			assert.ok(told.height !== undefined && Math.abs(told.height - bar * told.zoom) <= 1, `after ${step}: the controls are ${told.height}px tall, the bar ${bar}px at a zoom of ${told.zoom}`);
		}
	} finally {
		await zoom("Actual Size");
		await app.evaluate(({ BrowserWindow }: any) => delete BrowserWindow.getAllWindows()[0].setTitleBarOverlay);
	}
});

test("no key in the menus does two things, and the window closes as on a Mac: by its own button, ⌘W/Ctrl+W being Close Tab", async () => {
	const items: Array<{ label: string; key: string }> = await app.evaluate(({ Menu }: any) => {
		const out: Array<{ label: string; key: string }> = [];
		const walk = (list: any[]) => {
			for (const i of list) {
				const key = i.accelerator ?? i.getDefaultRoleAccelerator?.();
				if (key) out.push({ label: i.label || i.role, key: String(key) });
				if (i.submenu) walk(i.submenu.items);
			}
		};
		walk(Menu.getApplicationMenu().items);
		return out;
	});
	// A key as the system reads it: CmdOrCtrl is ⌘ on a Mac and Ctrl elsewhere, and the order of the modifiers says nothing.
	const mac = process.platform === "darwin";
	const word: Record<string, string> = { commandorcontrol: mac ? "cmd" : "ctrl", cmdorctrl: mac ? "cmd" : "ctrl", command: "cmd", cmd: "cmd", control: "ctrl", ctrl: "ctrl", option: "alt", alt: "alt", shift: "shift", super: "cmd", meta: "cmd" };
	const as = (key: string) => key.split("+").map((p) => word[p.toLowerCase()] ?? p.toLowerCase()).sort().join("+");
	const owners = new Map<string, string[]>();
	for (const i of items) owners.set(as(i.key), [...(owners.get(as(i.key)) ?? []), i.label]);
	// Electron's Redo and pine's Take Back Last Message share ⇧⌘Z on a Mac too: that is left as it is there.
	const twice = [...owners].filter(([key, who]) => who.length > 1 && !(key === as("Shift+CmdOrCtrl+Z") && who.length === 2 && who.includes("Redo") && who.includes("Take Back Last Message")));
	assert.deepEqual(twice, [], `keys that do two things: ${JSON.stringify(twice)}`);
	assert.deepEqual(owners.get(as("CmdOrCtrl+W")), ["Close Tab"]);
	assert.ok(!items.some((i) => i.label === "Close"), "a menu item closes the window");
});

test("text selected in an answer is quoted: a badge above the input, a markdown quote for the agent, a badge in the sent message that goes back to it, and a badge again after a take-back", async () => {
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "QUOTE-SOURCE The cache held an old copy of the lockfile." }], "say something to quote "));
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=QUOTE-SOURCE");
	const source = await page.$eval("[data-item=answer]:has-text('QUOTE-SOURCE')", (el: Element) => el.closest("[data-message-id]")!.getAttribute("data-message-id"));
	// Whether the message quoted from lights up, as a click on a badge makes it.
	const lit = () => page.waitForFunction((id: string) => (document.querySelector(`[data-message-id="${id}"]`)?.getAnimations().length ?? 0) > 0, source);
	const unlit = () => page.$eval(`[data-message-id="${source}"]`, (el: Element) => el.getAnimations().forEach((a) => a.cancel()));
	await page.evaluate(() => {
		const answer = [...document.querySelectorAll("[data-item=answer]")].find((e) => e.textContent!.includes("QUOTE-SOURCE"))!;
		const walk = document.createTreeWalker(answer, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walk.nextNode()) && !node.textContent!.includes("old copy"));
		const at = node!.textContent!.indexOf("old copy");
		const range = document.createRange();
		range.setStart(node!, at);
		range.setEnd(node!, at + "old copy of the lockfile".length);
		window.getSelection()!.removeAllRanges();
		window.getSelection()!.addRange(range);
	});
	await page.locator("[data-slot=selection-toolbar]").getByRole("button", { name: "Quote" }).click();
	await sees("[data-slot=composer] [data-slot=quote-chip] >> text=old copy of the lockfile");
	assert.equal(await page.$("[data-slot=selection-toolbar]"), null);
	// A click on the badge above the input goes back to the answer.
	await page.locator("[data-slot=composer] [data-slot=quote-chip]").getByRole("button", { name: /Go to where you quoted/ }).click();
	await lit();
	await unlit();
	// Sent, the quote goes first, as markdown: that is what the agent reads.
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "QUOTE-ANSWER" }], "why is that? "));
	await page.press("[data-slot=composer] textarea", "Enter");
	await sees("[data-slot=markdown] >> text=QUOTE-ANSWER");
	const said = JSON.stringify(mock.state.requests.at(-1)?.body.messages.filter((m: any) => m.role === "user").at(-1) ?? "");
	assert.match(said, /> old copy of the lockfile\\n\\nwhy is that\? /);
	assert.equal(await page.$("[data-slot=composer] [data-slot=quote-chip]"), null);
	// In the sent message it is a badge, not a line starting with ">", and a click goes back to the answer too.
	const sent = page.locator("[data-item=user]").last();
	assert.equal(await sent.locator("[data-slot=quote-chip]").count(), 1);
	assert.doesNotMatch(await sent.textContent(), /> old copy/);
	await sent.locator("[data-slot=quote-chip]").getByRole("button", { name: /Go to where you quoted/ }).click();
	await lit();
	await unlit();
	// Taken back, the quote is a badge above the input again and the rest is in the input, and the badge still finds its answer.
	await menu("undo");
	await sees("[data-slot=marker][data-tone=accent] >> text=Taken back");
	await sees("[data-slot=composer] [data-slot=quote-chip] >> text=old copy of the lockfile");
	assert.match(await page.inputValue("[data-slot=composer] textarea"), /^why is that\? /);
	await page.locator("[data-slot=composer] [data-slot=quote-chip]").getByRole("button", { name: /Go to where you quoted/ }).click();
	await page.waitForFunction(() => [...document.querySelectorAll("[data-item=answer]")].some((e) => e.textContent!.includes("QUOTE-SOURCE") && (e.closest("[data-message-id]")?.getAnimations().length ?? 0) > 0));
	await page.locator("[data-slot=composer] [data-slot=quote-chip]").getByRole("button", { name: "Remove quote" }).click();
	assert.equal(await page.$("[data-slot=composer] [data-slot=quote-chip]"), null);
	await page.fill("[data-slot=composer] textarea", "");
});

test("a long quote given to work that runs is known as the owner's own message: shown once, with its badge and whether the work read it", async () => {
	const long = `LONG-QUOTE ${"every word of this answer is quoted ".repeat(75).trim()}`;
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: long }], "say something long "));
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=LONG-QUOTE");
	// Work that runs until the test lets it go: what is sent meanwhile is given to it.
	let go = false;
	mock.state.scripts.held = [{ until: () => go, text: "LONG-QUOTE-HELD-DONE" }];
	await page.fill("[data-slot=composer] textarea", "@@REF:held@@ hold on ");
	await page.keyboard.press("Enter");
	await sees("[data-slot=composer] [aria-label=Stop]");
	const before = await page.$$eval("[data-item=user]", (els: Element[]) => els.length);
	await page.evaluate(() => {
		const answer = [...document.querySelectorAll("[data-item=answer] [data-slot=markdown]")].find((e) => e.textContent!.includes("LONG-QUOTE"))!;
		const range = document.createRange();
		range.selectNodeContents(answer);
		window.getSelection()!.removeAllRanges();
		window.getSelection()!.addRange(range);
	});
	await page.locator("[data-slot=selection-toolbar]").getByRole("button", { name: "Quote" }).click();
	await sees("[data-slot=composer] [data-slot=quote-chip] >> text=LONG-QUOTE");
	await page.fill("[data-slot=composer] textarea", "and that? ");
	await page.press("[data-slot=composer] textarea", "Enter");
	// Its line says whether the work has read it: the app knew the steered message for its own.
	await sees("[data-item=user]:has([data-slot=quote-chip]) >> text=/not read yet|read \\d/");
	go = true;
	await sees("[data-slot=markdown] >> text=LONG-QUOTE-HELD-DONE");
	assert.equal(await page.$$eval("[data-item=user]", (els: Element[]) => els.length), before + 1);
	assert.doesNotMatch(await page.textContent("[data-slot=message-scroller-content]"), /elsewhere/);
});

test("a click into the composer draws no ring and no brighter border: it looks as it did before", async () => {
	const look = () =>
		page.$eval("[data-slot=composer] [data-slot=input-group]", (el: Element) => {
			const s = getComputedStyle(el);
			// A ring is a box shadow; one drawn in a transparent color is not seen.
			const seen = s.boxShadow.split(/,(?![^(]*\))/).filter((part) => !/^\s*rgba\(0, 0, 0, 0\)/.test(part) && part.trim() !== "none");
			return { border: s.borderColor, ring: seen.join(",") };
		});
	// The fields fade their colors (transition-colors): each look waits for that to end.
	const settled = () => new Promise((r) => setTimeout(r, 300));
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await settled();
	const before = await look();
	await page.click("[data-slot=composer] textarea");
	await settled();
	assert.equal(await page.$eval("[data-slot=composer] textarea", (el: Element) => el.matches(":focus-visible")), true);
	assert.deepEqual(await look(), before);
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
	// On Linux a child keeps whatever its parent did not mark to be closed, and Chromium marks little: the shell holds
	// none of the app's files, sockets and pipes, only what is its own (bash keeps the terminal at 255 too). (electron/fds.ts)
	if (process.platform === "linux") {
		// (Not inside $(…), where bash itself holds the pipe it reads from.)
		await page.keyboard.type("printf fds-; ls /proc/$$/fd | tr '\\n' ,; echo end");
		await page.keyboard.press("Enter");
		await page.waitForFunction(() => /fds-[\d,]+end/.test(document.querySelector("[data-slot=terminal] .xterm-rows")?.textContent ?? ""), undefined, { timeout: 10_000 });
		const fds = /fds-([\d,]+)end/.exec(await terminalText())![1].split(",").filter(Boolean);
		assert.deepEqual(fds.filter((fd) => !["0", "1", "2", "255"].includes(fd)), [], `the terminal's shell holds the app's descriptors ${fds.join(", ")}`);
	}
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
	// Whatever goes on for as long as an agent works changes in steps, a few times a second: an animation
	// that runs smoothly forever makes the system draw the whole window at the screen's rate the whole time
	// (it cost a fifth of a core while agents worked; desktop/test/view-perf.test.ts measures it).
	const smooth = await page.evaluate(() =>
		document
			.getAnimations()
			.filter((a) => a.effect?.getComputedTiming().iterations === Infinity && a.playState === "running")
			.map((a) => (a.effect as KeyframeEffect).target as HTMLElement)
			// A Skeleton (stock shadcn, smooth animate-pulse) shows only while content loads for the first time,
			// never for as long as an agent works, so it is the one element let through.
			.filter((el) => el && !el.matches("[data-slot=skeleton]"))
			.filter((el) => !getComputedStyle(el).animationTimingFunction.startsWith("steps("))
			.map((el) => el.getAttribute("data-slot") ?? el.className.toString().slice(0, 40)),
	);
	assert.deepEqual(smooth, [], "no animation runs smoothly forever");
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
	// The call the approval was for ended after its card closed the group it stood in: it is drawn as ended, and
	// nothing in the window pulses once the agent is idle.
	await page.waitForFunction(() => !document.querySelector("[data-slot=pulse]"), null, { timeout: 5000 }).catch(async () => {
		throw new Error(`still pulsing: ${await page.locator("[data-slot=pulse]").evaluateAll((els) => els.map((el) => el.parentElement?.textContent?.slice(0, 80)).join(" | "))}`);
	});
});

test("a folder is opened for a conversation: changes, and a file edited and saved", async () => {
	// As the system does it when a folder is dropped on the app's icon.
	await app.evaluate(({ BrowserWindow }: any, dir: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", `folder:${dir}`), folder);
	// With several agents the app asks whose folder it is; the one in front is offered first.
	await confirm("[data-slot=dialog-title] >> text=Which agent works in");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=pine-desktop-folder");
	await page.click(CODE_TOGGLE);
	// The panel opens on the files; its Agent view says who the agent is and what it runs on.
	await sees("[data-slot=code-panel] [role=tab][aria-selected=true] >> text=Files");
	await page.locator("[data-slot=code-panel]").getByRole("tab", { name: "Agent" }).click();
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
	assert.ok((await page.$eval("[data-slot=code-panel] [data-slot=tabs-trigger] >> text=Changes", (b: Element) => b.getBoundingClientRect().height)) <= 32);
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
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.type("export const answer = 43;\n");
	await page.keyboard.press("ControlOrMeta+S");
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
	await sees("[data-setting-key='limits.maxDownloadMb'] [data-slot=field-label] >> text=Largest download");
	// A setting is called by a few words; its key in pine.json is said when you point at them. What only tunes pine is not on the page.
	assert.match(await page.locator("[data-setting-key='limits.maxDownloadMb'] [data-slot=field-label]").textContent(), /^Largest download/);
	// The limits on how much works at once are together.
	assert.deepEqual(await page.$$eval("[data-setting-key^='limits.']", (els: Element[]) => els.map((e) => e.getAttribute("data-setting-key"))), ["limits.maxConcurrentRuns", "limits.maxSubagents", "limits.maxPoolTasks", "limits.maxDownloadMb"]);
	assert.doesNotMatch(await page.textContent("[data-slot=settings-page]"), /warmSlots|slotPages|catalogue|maxDelegationDepth/);
	await shot("06-settings-general");
	// A setting of pine's: checked by the daemon, written into pine.json, in force at once.
	const limit = page.locator("[data-setting-key='limits.maxDownloadMb'] input");
	await limit.fill("123");
	await limit.press("Enter");
	await page.waitForFunction(() => [...document.querySelectorAll("[data-slot=toast]")].some((t) => /Largest download: 123/.test(t.textContent ?? "")));
	assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).limits.maxDownloadMb, 123);
	// One that cannot be is refused, and the file stays as it is.
	await limit.fill("0");
	await limit.press("Enter");
	await page.waitForFunction(() => [...document.querySelectorAll("[data-slot=toast][data-type=error]")].some((t) => /whole number from 1/.test(t.textContent ?? "")));
	assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).limits.maxDownloadMb, 123);
	// A setting chosen from a list is chosen with the keyboard alone: Escape closes the list and gives
	// focus back to it, Enter opens it, the arrows move, Enter chooses.
	const reasoning = page.locator("[data-setting-key='defaults.thinking'] [role=combobox]");
	const list = "[data-slot=select-content][data-open]";
	await reasoning.focus();
	await page.keyboard.press("Enter");
	await sees(`${list} [role=option][data-highlighted]`);
	await page.keyboard.press("Escape");
	await page.waitForSelector(list, { state: "detached" });
	// Focus comes back once the list has finished closing (it fades out after it is closed).
	const backOnIt = () => page.waitForFunction(() => document.activeElement?.matches("[data-setting-key='defaults.thinking'] [role=combobox]"), null, { timeout: 3000 });
	await backOnIt();
	await page.keyboard.press("Enter");
	await sees(`${list} [role=option][data-highlighted]`);
	const before = await page.textContent(`${list} [role=option][data-highlighted]`);
	await page.keyboard.press(before?.trim() === "off" ? "ArrowDown" : "Home");
	const chosen = (await page.textContent(`${list} [role=option][data-highlighted]`))?.trim();
	assert.notEqual(chosen, before?.trim());
	await page.keyboard.press("Enter");
	await page.waitForFunction((v) => [...document.querySelectorAll("[data-slot=toast]")].some((t) => t.textContent?.includes(`Reasoning: ${v}`)), chosen);
	assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).defaults.thinking, chosen);
	await backOnIt();
	// Agents: make one.
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=Agents");
	await page.locator("[data-slot=settings-page]").getByRole("button", { name: "New agent" }).click();
	await page.fill("[data-slot=dialog-content] [data-slot=field]:nth-of-type(1) input", "books");
	await page.fill("[data-slot=dialog-content] textarea", "You are books. You keep the books.\n\nYou answer in one line.");
	await page.locator("[data-slot=dialog-content]").getByRole("button", { name: "Create agent" }).click();
	// Its conversation opens in a tab, where it is met; the card at its top leads on to its settings.
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=books");
	await page.click("[data-slot=agent-settings]");
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
	await page.locator("[data-slot=settings-page]").getByRole("button", { name: "New schedule" }).click();
	const scheduleForm = page.locator("[data-slot=dialog-content]");
	await scheduleForm.getByLabel("Times").fill("0 7 * * *");
	await scheduleForm.getByLabel("With the task").fill("Say good morning.");
	await scheduleForm.getByLabel("Name", { exact: true }).fill("morning");
	await scheduleForm.getByRole("button", { name: "Add schedule" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await sees("[data-slot=settings-page] [data-slot=item-title] >> text=morning");
	await sees("[data-slot=settings-page] [data-slot=item-description] >> text=wake all agents, each in their main conversation");
	assert.match(fs.readFileSync(path.join(home, "pine.json"), "utf8"), /"morning"/);
	await shot("08-settings-schedules");
	// Events: a route, as When and Then. Only the fields of the action chosen are shown, and only they are sent.
	await sees("[data-slot=settings-page] [data-slot=empty] >> text=No routes");
	await page.locator("[data-slot=settings-page]").getByRole("button", { name: "New route" }).click();
	const routeForm = page.locator("[data-slot=dialog-content]");
	await routeForm.getByLabel("An event arrives on").fill("source/house/message");
	await routeForm.getByLabel("Only if").fill('{"payload.topic": "house/mode"}');
	await routeForm.getByRole("textbox", { name: "Telling it" }).fill("left behind under another action");
	await routeForm.getByLabel("What happens").click();
	await page.getByRole("option", { name: "Set shared state" }).click();
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
	// The usual providers are listed; any other is found by searching.
	await page.fill("[data-slot=settings-page] input[aria-label='Search providers']", "opencode");
	const row = page.locator("[data-slot=settings-page] [data-provider=opencode]");
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
	await sees("[data-slot=dialog-title] >> text=Model for all agents without a model of their own");
	const offered = await page.$$eval("[data-slot=command-item] > :first-child", (els: Element[]) => els.map((e) => e.textContent ?? ""));
	assert.ok(offered.length > 0 && offered.every((m) => m.startsWith("opencode/")), JSON.stringify(offered.slice(0, 5)));
	await page.click("[data-slot=command-item] >> nth=0");
	await sees(`[data-slot=toast] >> text=Your agents now run on ${offered[0]}`);
	assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).defaults.model, offered[0]);
	await sees(`[data-setting=fallback-model] [data-slot=field-label] >> text=${offered[0]}`);
	// Signed out again, that model cannot answer: the page says so for each agent it leaves without
	// one, and so does the welcome of such an agent's conversation, with the way to this page.
	const signedIn = page.locator("[data-slot=settings-page] [data-provider=opencode]");
	await signedIn.getByRole("button", { name: "Sign out" }).click();
	await sees("[role=alertdialog] [data-slot=alert-dialog-title] >> text=/^Sign out of /");
	await page.locator("[role=alertdialog]").getByRole("button", { name: "Sign out" }).click();
	await sees("[data-slot=settings-page] [data-slot=model-notice] >> text=/main cannot answer: .* needs a sign-in to opencode/");
	await page.click("[data-slot=tab]:has-text('pine-desktop-folder')");
	await sees("[data-slot=empty] [data-slot=model-notice] >> text=/needs a sign-in to opencode/");
	await shot("09-no-model");
	await page.locator("[data-slot=empty] [data-slot=model-notice]").getByRole("button", { name: "Models" }).click();
	await sees("[data-slot=settings-page] h1 >> text=Models");
	// "Change" offers every model that can be used now.
	await page.locator("[data-setting=fallback-model]").getByRole("button", { name: "Change" }).click();
	await sees("[data-slot=dialog-title] >> text=Model for all agents without a model of their own");
	await page.getByRole("option", { name: "mock/m" }).click();
	await sees("[data-slot=toast] >> text=Your agents now run on mock/m");
	await page.waitForSelector("[data-slot=settings-page] [data-slot=model-notice]", { state: "detached" });
	assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).defaults.model, "mock/m");
	// MCP servers: a remote one is added, pine says whether it connects, and "Sign in" runs pi's own
	// sign-in for it (which for a server that wants none says so; a browser opens only where one is needed).
	const remote = await httpMcp({});
	try {
		await page.click("[role=navigation] [data-sidebar=menu-button] >> text=MCP servers");
		await page.locator("[data-slot=settings-page]").getByRole("button", { name: "Add server" }).click();
		await page.fill("[data-slot=dialog-content] input[placeholder='home_link']", "notes");
		await page.fill("[data-slot=dialog-content] input[placeholder='https://mcp.example.com/mcp']", remote.url);
		await putAwayToasts();
		await page.locator("[data-slot=dialog-content]").getByRole("button", { name: "Add server" }).click();
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
	for (const [nav, title] of [["Models", "Models"], ["MCP servers", "MCP servers"], ["Skills", "Skills"], ["Agents", "Agents"], ["General", "General"]]) {
		await page.click(`[role=navigation] [data-sidebar=menu-button] >> text=${nav}`);
		await sees(`[data-slot=settings-page] h1 >> text=${title}`);
		await page.waitForTimeout(400);
		await shot(`09-settings-${nav.toLowerCase().replace(/\s+/g, "-")}`);
	}
	// General, where what was the App page went: the browser of the web tools is still not there, and can be fetched from here. (The
	// test fetches nothing: PINE_SKIP_DOWNLOADS. What the command printed is shown.)
	await sees(`[data-setting=browser] [data-slot=badge][data-variant=outline] >> text=not on this ${HERE}`);
	await page.locator("[data-setting=browser]").getByRole("button", { name: "Fetch it" }).click();
	await sees("[data-setting=browser] [data-slot=code-block-content] >> text=Not fetched: PINE_SKIP_DOWNLOADS is set.");
	// Fetched some other way (a terminal): the page says so when it is opened again.
	const { browserPlaces } = await import("../../src/browser-build.ts");
	const places = (await browserPlaces()) ?? [];
	for (const place of places) write(path.join(browsers, path.basename(place), "INSTALLATION_COMPLETE"), "");
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=Models");
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=General");
	await sees(`[data-setting=browser] [data-slot=badge][data-variant=default] >> text=on this ${HERE}`);
	await menu("settings");
});

test("settings are searched: what fits is listed in place of the page, and a pick opens its page at it", async () => {
	await menu("settings");
	await sees("[data-slot=settings-page] h1");
	const field = page.locator("[data-slot=settings-search]");
	// ⌘F (the menu's Find) goes to the field while Settings are in front.
	await menu("find");
	await page.waitForFunction(() => document.activeElement?.getAttribute("data-slot") === "settings-search");
	await page.keyboard.type("largest download");
	await sees("[data-slot=settings-results] [data-result='setting:limits.maxDownloadMb']");
	await sees("[data-slot=settings-page] h1 >> text=“largest download”");
	// The pages with nothing that fits fade in the navigation; the one that has it does not.
	const faded = (label: string) => page.locator(`[role=navigation] [data-sidebar=menu-button]:has-text('${label}')`).evaluate((e: Element) => e.classList.contains("opacity-50"));
	assert.equal(await faded("Models"), true);
	assert.equal(await faded("General"), false);
	await shot("09-settings-search");
	// Enter goes to the first: its page, scrolled to it and marked for a moment, and the field is empty again.
	await field.press("Enter");
	await sees("[data-slot=settings-page] [data-setting-key='limits.maxDownloadMb'][data-found]");
	await sees("[data-slot=settings-page] h1 >> text=General");
	assert.equal(await field.inputValue(), "");
	// An agent's own field opens that agent's page.
	await field.fill("network for shell");
	const result = page.locator("[data-slot=settings-results] [data-result^='agent:'][data-result$=':network']").first();
	const agent = (await result.getAttribute("data-result"))!.split(":")[1];
	// The arrows go from the field into the list, and Enter picks.
	await field.press("ArrowDown");
	await page.waitForFunction(() => document.activeElement?.hasAttribute("data-result"));
	await result.click();
	await sees(`[data-slot=settings-page] h1 >> text=${agent}`);
	await sees("[data-slot=settings-page] [data-find=agent-network][data-found]");
	// A provider the Models page lists only when searched for: it opens searched for it.
	await field.fill("opencode");
	await page.click("[data-slot=settings-results] [data-result='provider:opencode']");
	await sees("[data-slot=settings-page] [data-provider=opencode][data-found]");
	assert.equal(await page.inputValue("[data-slot=settings-page] input[aria-label='Search providers']"), "opencode");
	// What pine has is found by its name: the source added above.
	await field.fill("scans");
	await sees("[data-slot=settings-results] [data-result$=':scans'] >> text=Events › Sources");
	// Nothing fits: said so. Escape empties the field, and the page that was open is back.
	await field.fill("zzqqxx");
	await sees("[data-slot=settings-page] >> text=Nothing in Settings fits");
	await field.press("Escape");
	assert.equal(await field.inputValue(), "");
	await sees("[data-slot=settings-page] h1 >> text=Models");
	// The palette finds settings too, and opens them the same way.
	await menu("palette");
	await sees("[data-slot=command-input]");
	await page.keyboard.type("notifications");
	await sees("[cmdk-group-heading] >> text=In Settings");
	await page.click("[data-slot=command-item]:has-text('General › This app')");
	await sees("[data-slot=settings-page] [data-find=notifications][data-found]");
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=General");
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
		await page.locator("[role=navigation]").getByRole("button", { name: "General", exact: true }).click();
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

test("beside a conversation, the panel's Agent view says what the agent has been given", async () => {
	// Here: what the settings above set up for all agents.
	await page.click("[data-slot=tab] >> nth=0");
	if (!(await page.$("[data-slot=code-panel]"))) await page.click(CODE_TOGGLE);
	await page.locator("[data-slot=code-panel]").getByRole("tab", { name: "Agent" }).click();
	await sees("[data-slot=code-panel] [data-slot=item-title] >> text=invoices");
	await sees("[data-slot=code-panel] [data-slot=item-title] >> text=morning");
	assert.match(await page.textContent("[data-slot=code-panel]"), /Nothing wakes it by itself\. 1 event source could/);
	await shot("14-agent-view");
});
