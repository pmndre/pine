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
import { activeOption, announced, api, app, browsers, closed, CODE_EDGE, CODE_TOGGLE, confirm, far, folder, github, HERE, home, json, menu, mock, named, page, putAwayToasts, releases, root, sees, shot, started, stillInside, write } from "./support/window.ts";

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
	await shot("01-welcome");
	// Its agents have a model: the setup conversation is not opened.
	assert.equal(await page.$("[data-slot=tab]:has-text('Setup Pine')"), null);
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

test("the agent's browser is a part of the side panel, shown as a picture, and what is done in it goes back through the daemon", async () => {
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
	// A window wide enough for the conversation and the side panel side by side.
	await page.setViewportSize({ width: 1800, height: 900 });
	try {
		// The side panel is toggled from the top right of the window; the browser is one of its parts, beside the terminal.
		if (!had) await page.click(CODE_TOGGLE);
		await sees("#code-panel [data-slot=code-panel]");
		assert.equal(await page.$("[data-slot=conversation-head] [data-slot=toggle]"), null, "the conversation's top line has no panel toggle");
		assert.equal(await page.$("header [data-toggle=browser]"), null, "the browser has no toggle of its own");
		await page.locator("[data-slot=code-panel]").getByRole("tab", { name: "Browser" }).click();
		// The page is a picture, drawn when it is whole; its address is text in the line above it.
		await sees("#code-panel [data-slot=code-panel] [data-slot=browser] canvas[data-drawn]");
		await sees(`${CODE_TOGGLE}[aria-pressed=true]`);
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
		// Reached by the keyboard from the address, the picture shows that keys go to it.
		await page.focus("[data-slot=browser] input[aria-label=Address]");
		await page.keyboard.press("Tab");
		assert.equal(await page.evaluate(() => document.activeElement?.tagName), "CANVAS");
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

		// The menu's item and /browser show the browser in the side panel, and put the panel away when it is in front.
		await menu("browser");
		await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
		await sees(`${CODE_TOGGLE}[aria-pressed=false]`);
		await menu("browser");
		await sees("[data-slot=code-panel] [role=tab][aria-selected=true] >> text=Browser");
		await menu("code-files");
		await page.fill("[data-slot=composer] textarea", "/browser");
		await page.press("[data-slot=composer] textarea", "Enter");
		await sees("[data-slot=code-panel] [role=tab][aria-selected=true] >> text=Browser");
		await page.fill("[data-slot=composer] textarea", "/code files");
		await page.press("[data-slot=composer] textarea", "Enter");
		await page.fill("[data-slot=composer] textarea", "/code browser");
		await page.press("[data-slot=composer] textarea", "Enter");
		await sees("[data-slot=code-panel] [role=tab][aria-selected=true] >> text=Browser");
		// The agent puts its browser in front of the owner: the side panel shows it. (In a conversation of its own, so that main's stays as the tests after this one expect it.)
		await menu("code-files");
		const tabs = await page.locator("[data-slot=tab]").count();
		await menu("new");
		await page.waitForFunction((n) => document.querySelectorAll("[data-slot=tab]").length > n, tabs);
		await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "browser_show", args: {} }], text: "Have a look." }, { text: "There it is." }], "Show me the page. "));
		await page.keyboard.press("Enter");
		await sees("[data-slot=code-panel] [role=tab][aria-selected=true] >> text=Browser");
		await sees("[data-slot=markdown] >> text=There it is.");
		await menu("close");
		await page.waitForFunction((n) => document.querySelectorAll("[data-slot=tab]").length === n, tabs);
		// On a tab that is not a conversation, the side panel stays with the conversation last in front, and its toggle can be pressed.
		await menu("settings");
		await sees(`${CODE_TOGGLE}:not([disabled])`);
		await sees("[data-slot=pane-tab][data-pane=code] [data-slot=tab-name] >> text=main");
		await menu("settings");
	} finally {
		// (The panels as they were, for the tests that follow.)
		await menu("code-agent");
		if (!had) await menu("code");
		await page.setViewportSize({ width: 1280, height: 820 });
		fs.rmSync(file, { force: true });
		door.close();
	}
});

test("a message is answered, with the turn's work folded into a line", async () => {
	const steps = [{ tools: [{ name: "read", args: { path: "notes.md" } }], text: "Let me look at the notes first." }, { text: "The notes say **first line**.\n\n```ts\nconst a = 1;\n```\n\n<details><summary>Full file</summary>\n\nfirst line\n\n</details>\n\n[the docs](https://example.com/docs)" }];
	await page.fill("[data-slot=composer] textarea", mockMsg(steps, "What do the notes say? "));
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] strong");
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
	// It is a link from the keyboard too: it takes the focus, and Enter opens it in the browser.
	await page.focus("[data-slot=markdown] [data-href]");
	assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-href")), "https://example.com/docs");
	assert.equal(await page.getAttribute("[data-slot=markdown] [data-href]", "role"), "link");
	await page.keyboard.press("Enter");
	await app.evaluate(async () => {
		for (let i = 0; i < 100 && !((globalThis as any).opened ?? []).includes("https://example.com/docs"); i++) await new Promise((r) => setTimeout(r, 20));
	});
	assert.ok((await app.evaluate(() => ((globalThis as any).opened ?? []) as string[])).includes("https://example.com/docs"));
	// A folded part is there and closed.
	assert.equal(await page.getAttribute("[data-slot=markdown] [data-details] [data-slot=collapsible-trigger]", "aria-expanded"), "false");
	// Code is colored on the page, with its language and a copy button, and nothing to download.
	// It is the stock Code Block, colored with pine's code colors, in one frame.
	await page.waitForFunction(() => document.querySelectorAll('[data-slot=markdown] [data-slot=code-block] [data-slot=code-block-line] span[style*="var(--code-"]').length > 0);
	assert.match(await page.textContent("[data-slot=markdown] [data-slot=code-block-title]"), /ts/);
	assert.ok(await page.$("[data-slot=markdown] [data-slot=code-block] [data-slot=code-block-copy-button]"));
	assert.equal(await page.$$eval("[data-slot=markdown] [data-slot=code-block] [data-streamdown]", (els: Element[]) => els.length), 0);
	assert.equal(await page.$$eval('[data-slot=markdown] [data-slot=code-block] button[title*="ownload"], [data-slot=markdown] [data-slot=code-block] button[aria-label*="ownload"]', (els: Element[]) => els.length), 0);
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
	// Its title shows above its models, and its field is there to be seen, however short the list.
	await sees("[data-slot=dialog-content] [cmdk-group-heading] >> text=Model for main");
	assert.ok(await page.locator("[data-slot=dialog-content] [data-slot=command-input]").isVisible(), "the field is seen");
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

test("an empty composer's send button says there is nothing to send, and a click on it sends nothing", async () => {
	await page.fill("[data-slot=composer] textarea", "");
	const send = page.locator("[data-slot=composer] [data-slot=input-group]").getByRole("button", { name: "Send", exact: true });
	assert.equal(await send.getAttribute("aria-disabled"), "true");
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
	await button.click({ timeout: 5000 });
	for (let i = 0; i < 50 && !(await app.evaluate(() => (globalThis as any).popped)); i++) await new Promise((r) => setTimeout(r, 50));
	const popped = await app.evaluate(() => (globalThis as any).popped);
	await app.evaluate(({ Menu }: any) => delete Menu.getApplicationMenu().popup);
	assert.ok(popped, "the button opened no menu");
	assert.deepEqual(popped.menus, ["File", "Edit", "View", "Conversation", "Window", "Help"]);
	assert.ok(Number.isFinite(popped.x) && Number.isFinite(popped.y), "the menu is opened at a place in the window");
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

/**
 * Waits until the conversation has glided to the message just sent. A scroll hides the bar over selected
 * text, so text selected while the view still glides gets no bar: the owner would select it after.
 */
const settled = () => sees("[data-slot=message-scroller-viewport]:not([data-glide])");

test("text selected in an answer is quoted: a badge above the input, a markdown quote for the agent, a badge in the sent message that goes back to it, and a badge again after a take-back", async () => {
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "QUOTE-SOURCE The cache held an old copy of the lockfile." }], "say something to quote "));
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=QUOTE-SOURCE");
	await settled();
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
	// The bar is a popover for the words it is about, and it leaves the focus where it was.
	await sees("[data-slot=popover-content] [data-slot=selection-toolbar]");
	const focused = await page.evaluate(() => document.activeElement?.tagName);
	assert.equal(await page.evaluate(() => document.activeElement?.tagName), focused);
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
	await settled();
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
		"A claim[^1].",
		"- an item\n\n  its second paragraph\n\n- another item",
		"- [x] a task done\n- [ ] a task to do",
		"# A heading\n\n> A quote with <kbd>K</kbd> and **bold**.",
		"[^1]: Its source.",
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
	assert.match((await md.locator('img[alt="the plan"]').getAttribute("src")) ?? "", /^pine-media:\/\/(daemon|window-[^/]+)\/.*plan\.png/);
	// Nothing to download a picture with.
	assert.equal(await md.locator('button[title*="ownload"], button[aria-label*="ownload"]').count(), 0);
	// What could act or restyle is gone, and the words stay. The one svg allowed is pine's own arrow beside a link.
	assert.equal(await page.evaluate(() => (window as any).hacked), undefined);
	// The one input and svg pine draws itself are a task's read-only box and its check mark (stock Checkbox).
	assert.equal(await md.locator("script, style, form, input:not(li[data-task] input), button:not([data-remote]), iframe, svg:not([data-target] > svg, li[data-task] svg), video, object, a[href]").count(), 0);
	assert.equal(await md.locator('[class~="evil"], #evil, [data-x], [aria-label="evil"], [onclick]').count(), 0);
	assert.equal(await md.getByText("styled", { exact: true }).evaluate((el: HTMLElement) => el.getAttribute("style")), null);
	assert.doesNotMatch(await md.textContent(), /display: none/);
	// A link on the web is no address the page could follow: it says where it leads, beside it.
	const link = md.locator("[data-href]");
	assert.equal(await link.getAttribute("data-href"), "https://example.com/docs");
	assert.match(await md.locator("[data-href] + [data-target]").textContent(), /example\.com\/docs/);
	// A table is shadcn's, in a ScrollArea of its own.
	assert.equal(await md.locator("[data-slot=scroll-area-viewport] table[data-slot=table]").count(), 1);
	// A footnote's number and its note are words alone: no address of a place in the page, no heading for
	// screen readers drawn for everyone.
	assert.doesNotMatch(await md.textContent(), /user-content|Footnotes/);
	assert.equal(await md.locator("section[data-footnotes] ol li").count(), 1);
	// An item's two paragraphs stay two.
	// A task keeps whether it is done, as a box that cannot be changed, where CLEAN takes every input away.
	assert.deepEqual(await md.locator("li[data-task] [data-slot=checkbox]").evaluateAll((boxes: HTMLElement[]) => boxes.map((b) => b.getAttribute("aria-checked"))), ["true", "false"]);
	// A heading is a heading; a key is shadcn's Kbd; bold is <strong>.
	assert.equal(await md.locator("h1", { hasText: "A heading" }).count(), 1);
	assert.equal(await md.locator("blockquote [data-slot=kbd]").count(), 1);
	assert.equal(await md.locator("blockquote strong").count(), 1);
	const item = md.locator("li", { hasText: "an item" }).first();
	assert.equal(await item.locator("p").count(), 2);
	assert.deepEqual(await page.evaluate(() => (window as any).refused), []);
	await shot("02b-pictures");
});

const terminalText = () => page.$eval("[data-slot=terminal] .xterm-rows", (el: Element) => el.textContent ?? "").catch(() => "");
const terminalShows = (text: string) => page.waitForFunction((t) => (document.querySelector("[data-slot=terminal] .xterm-rows")?.textContent ?? "").includes(t), text, { timeout: 10_000 });

test("a shell block of an answer runs in the conversation's terminal with its button, and only as it is shown", async () => {
	const text = ["Run this:", "```bash\necho pine-ran-$((6*7))\n```", "Not this one:", "```ts title=\"src/a.ts\"\nconst a = 1;\n```", "Nor this:", "```sh\necho shown\u202Ehidden-ran\n```"].join("\n\n");
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text }], "commands "));
	await page.keyboard.press("Enter");
	const md = page.locator("[data-slot=markdown]", { hasText: "Run this" }).last();
	await md.locator("[data-run]").first().waitFor();
	// Only a block for a shell has the button, beside its copy button.
	assert.equal(await md.locator("[data-run]").count(), 2);
	assert.equal(await md.locator("[data-slot=code-block]", { hasText: "const a = 1" }).locator("[data-run]").count(), 0);
	// A block whose opening line names its file has the file's name in its header, with an icon.
	assert.equal(await md.locator("[data-slot=code-block]", { hasText: "const a = 1" }).locator("[data-slot=code-block-title]").textContent(), "src/a.ts");
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
	// In the conversation it is pine's note, with its line and what it reports: no message of the owner's, no words of pine's to the agent.
	const pineNote = async () => {
		await sees("[data-pine] >> text=terminal: ended");
		assert.match(await page.textContent("[data-pine] >> nth=-1"), /Command: echo pine-ran-\$\(\(6\*7\)\)/);
		assert.equal(await page.locator("[data-item=user]", { hasText: "This message is from pine" }).count(), 0);
		assert.equal(await page.locator("[data-pine]", { hasText: "This message is from pine" }).count(), 0);
	};
	await pineNote();
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
	// Loaded again from the daemon's history, the note looks as it did.
	await page.reload();
	await pineNote();
});

test("while the model thinks, its thinking is open and shows its end; once done, it folds", async () => {
	const reasoning = Array.from({ length: 60 }, (_, i) => `thinking line ${i + 1}`).join("\n");
	await page.fill("[data-slot=composer] textarea", mockMsg([{ reasoning, reasoningHoldMs: 1500, text: "THOUGHT-DONE" }], "think "));
	await page.keyboard.press("Enter");
	const box = "[data-part=thought] [aria-label=Thinking]";
	await sees(`${box} >> text=thinking line 60`);
	await page.waitForFunction((s: string) => { const el = document.querySelector(s); return Boolean(el && el.scrollHeight > el.clientHeight + 100 && el.scrollHeight - el.scrollTop - el.clientHeight < 2); }, box, { timeout: 10_000 });
	await sees("[data-slot=markdown] >> text=THOUGHT-DONE");
	await page.waitForSelector(box, { state: "detached" });
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

test("an approval is asked in a dialog and answered from it; a question is a card above the composer", async () => {
	// The owner listed bash under "approve": it asks in every mode.
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "bash", args: { command: "echo hello" } }] }, { tools: [{ name: "question", args: { question: "Which database?", header: "Database", options: [{ label: "the old one", description: "Nothing to move" }, { label: "the new one", description: "Faster, after a migration" }] } }] }, { text: "done" }], "run it "));
	await page.keyboard.press("Enter");
	await sees("role=dialog[name=/^Approval needed/]");
	assert.match(await page.textContent("role=dialog[name=/^Approval needed/]"), /Approval needed[\s\S]*echo hello/);
	await shot("03-approval");
	// What is at work is a grey dot that pulses, announced as working: here the line of the turn's work and the line
	// under the conversation (its tab and its row say ! instead). No spinner turns anywhere, and every dot is in step.
	const working = await page.locator("[data-slot=pulse][role=status][aria-label=Working]").count();
	assert.ok(working >= 2, `${working} dots at work`);
	assert.equal(await page.locator("[data-slot=spinner]").count(), 0);
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
	await page.locator("role=dialog[name=/^Approval needed/]").getByRole("button", { name: /^Allow/ }).click();
	await sees('[data-item="approval"][data-state="allowed"]');
	// Then the agent asks something: a card inline above the composer, and no dialog opens by itself.
	const card = "[data-slot=composer-question] [data-slot=questionnaire]";
	await sees(card);
	assert.equal(await page.locator("[data-slot=dialog-content]").count(), 0, "no dialog opens for a question");
	assert.match(await page.textContent(card), /Which database\?[\s\S]*Database[\s\S]*the old one[\s\S]*recommended[\s\S]*Nothing to move[\s\S]*1[\s\S]*the new one[\s\S]*Faster, after a migration[\s\S]*2/);
	// The open question is not drawn in the conversation as well.
	assert.equal(await page.locator('[data-item="approval"][data-state="open"]').count(), 0);
	await shot("03-question");
	// The composer was empty: the card has the keyboard, and a digit answers.
	await page.waitForFunction(() => document.activeElement?.closest("[data-slot=composer-question] [data-slot=questionnaire]"), null, { timeout: 5000 });
	await page.keyboard.press("2");
	// Answered, the card folds into a line in the conversation that says what was answered.
	await sees('[data-item="approval"][data-state="allowed"] >> text=Answered');
	assert.match(await page.textContent('[data-item="approval"][data-state="allowed"] >> nth=-1'), /Which database\?[\s\S]*the new one/);
	assert.equal(await page.locator(card).count(), 0);
	await sees("[data-slot=markdown] >> text=done");
	assert.match(JSON.stringify(mock.state.requests.at(-1)?.body.messages.filter((m: any) => m.role === "tool")), /Your owner answered: the new one/);
});

test("a value only the owner has, left empty, is marked as missing in the approval and nothing is allowed", { skip: process.platform === "win32" && "a local MCP server needs a sandbox, and Windows has none of pine's" }, async () => {
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "add_mcp_server", args: { name: "keyed", command: "npx -y example-mcp", secrets: ["EXAMPLE_KEY"] } }] }, { text: "not added then" }], "add a server with a key "));
	await page.keyboard.press("Enter");
	const asked = "role=dialog[name=/^Approval needed, and something only you have/]";
	await sees(asked);
	const field = page.locator(asked).locator("[data-slot=field]", { has: page.locator("#ap-EXAMPLE_KEY") });
	assert.equal(await field.getAttribute("data-invalid"), null, "not marked before the owner tried to allow it");
	await page.locator(asked).getByRole("button", { name: "Save and allow" }).click();
	await sees(`${asked} >> [data-slot=field][data-invalid] #ap-EXAMPLE_KEY[aria-invalid=true]`);
	assert.equal(await page.evaluate(() => document.activeElement?.id), "ap-EXAMPLE_KEY");
	// A value typed there takes the mark away again.
	await page.locator("#ap-EXAMPLE_KEY").fill("a-key");
	assert.equal(await field.getAttribute("data-invalid"), null);
	await page.locator(asked).getByRole("button", { name: "Deny" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await sees("[data-slot=markdown] >> text=not added then");
});

test("what is asked is answered from the conversation too: an approval by its buttons, questions by a click, the arrows and Enter, ticks and Send; Later and No answer", async () => {
	const pick = (question: string, extra: any = {}) => ({ tools: [{ name: "question", args: { question, options: [{ label: "green" }, { label: "blue" }, { label: "red" }], ...extra } }] });
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "bash", args: { command: "echo again" } }] }, pick("Which color?"), pick("Which border?"), pick("Which colors?", { multiSelect: true }), pick("Which shade?"), pick("Which font?"), { text: "answered from the line" }], "ask in line "));
	await page.keyboard.press("Enter");
	// The dialog is put off ("Later"); the request stays in the conversation, with what it is and why.
	await sees("role=dialog[name=/^Approval needed/]");
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	const asked = '[data-item="approval"][data-state="open"] [data-slot="item"]';
	await sees(`${asked} >> text=Approval needed`);
	assert.match(await page.textContent(asked), /echo again/);
	await shot("03-confirmation");
	await page.click(`${asked} button:has-text("Allow once")`);
	await sees('[data-item="approval"][data-state="allowed"] >> text=/Allowed · bash · .*echo again/');
	const card = "[data-slot=composer-question] [data-slot=questionnaire]";
	// The conversation holds what was asked before this test too: the questions are counted from here.
	const before = await page.locator('[data-item="approval"]:not([data-state="open"])').count();
	const answered = (n: number) => page.waitForFunction((n: number) => document.querySelectorAll('[data-item="approval"]:not([data-state="open"])').length === n, before + n, { timeout: 10_000 });
	const last = async () => (await page.$$eval('[data-item="approval"]:not([data-state="open"])', (els: Element[]) => els.at(-1)?.textContent)) ?? "";
	const shows = (question: string) => page.waitForFunction(([c, q]: string[]) => document.querySelector(c)?.textContent?.includes(q), [card, question], { timeout: 10_000 });
	// A click answers.
	await shows("Which color?");
	await page.locator(card).getByRole("radio", { name: /blue/ }).click();
	await answered(1);
	assert.match(await last(), /Answered[\s\S]*Which color\?[\s\S]*blue/);
	// The arrows and Enter answer.
	await shows("Which border?");
	await page.locator(card).getByRole("radio", { name: /green/ }).focus();
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Enter");
	await answered(2);
	assert.match(await last(), /Which border\?[\s\S]*red/);
	// Several are ticked, by a click and by a digit, and sent together.
	await shows("Which colors?");
	assert.equal(await page.locator(`${card} [data-slot=questionnaire-item]`).getAttribute("data-multiple"), "");
	assert.ok(await page.locator(card).getByRole("button", { name: "Send" }).isDisabled(), "nothing ticked, nothing to send");
	assert.equal(await page.locator(card).getByText("recommended").count(), 0, "no option is the recommended one when several may be picked");
	await page.locator(card).getByRole("checkbox", { name: /green/ }).click();
	await page.keyboard.press("3");
	await page.locator(card).getByRole("button", { name: "Send" }).click();
	await answered(3);
	assert.match(await last(), /Which colors\?[\s\S]*green, red/);
	// Later puts the card away; the line under the conversation brings it back.
	await shows("Which shade?");
	await page.locator(card).getByRole("button", { name: "Later" }).click();
	await page.waitForSelector(card, { state: "detached" });
	const waits = page.locator("[data-slot=marker]", { hasText: "A question waits for your answer." });
	await waits.waitFor();
	await waits.getByRole("button", { name: "Open" }).click();
	await page.locator(card).getByRole("radio", { name: /green/ }).click();
	await answered(4);
	// No answer.
	await shows("Which font?");
	await page.locator(card).getByRole("button", { name: "No answer" }).click();
	await answered(5);
	assert.match(await last(), /No answer[\s\S]*Which font\?/);
	await sees("[data-slot=markdown] >> text=answered from the line");
	const told = JSON.stringify(mock.state.requests.at(-1)?.body.messages.filter((m: any) => m.role === "tool"));
	for (const said of ["Your owner answered: blue", "Your owner answered: red", "Your owner answered: green, red", "Your owner answered: green", "Your owner did not answer"]) assert.ok(told.includes(said), said);
	// The composer is as before once nothing is asked (whether or not the turn has ended yet).
	assert.match((await page.getAttribute("[data-slot=composer] textarea", "placeholder")) ?? "", /^(Message |Say something to main while it works)/);
	// The call the approval was for ended after its card closed the group it stood in: it is drawn as ended, and
	// nothing in the window pulses once the agent is idle.
	await page.waitForFunction(() => !document.querySelector("[data-slot=pulse]"), null, { timeout: 5000 }).catch(async () => {
		throw new Error(`still pulsing: ${await page.locator("[data-slot=pulse]").evaluateAll((els) => els.map((el) => el.parentElement?.textContent?.slice(0, 80)).join(" | "))}`);
	});
});

test("a message typed while a question is open answers it in the owner's own words; one that asks back is answered, and the agent asks again", async () => {
	const ask = { tools: [{ name: "question", args: { question: "Which store?", options: [{ label: "files" }, { label: "sqlite" }] } }] };
	await page.fill("[data-slot=composer] textarea", mockMsg([ask, ask, { text: "store chosen" }], "pick a store "));
	await page.keyboard.press("Enter");
	const card = "[data-slot=composer-question] [data-slot=questionnaire]";
	await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Which store?"), card, { timeout: 10_000 });
	// While it is open, the composer says that what is typed answers it.
	const field = "[data-slot=composer] textarea";
	assert.match((await page.getAttribute(field, "placeholder")) ?? "", /answer[\s\S]*question/i);
	const before = await page.locator('[data-item="approval"]:not([data-state="open"])').count();
	await page.click(field);
	await page.keyboard.type("what is the difference?");
	await page.keyboard.press("Enter");
	// The message is the owner's, and the card folds as answered with it.
	await sees('[data-item="user"] >> text=what is the difference?');
	await page.waitForFunction((n: number) => document.querySelectorAll('[data-item="approval"]:not([data-state="open"])').length === n, before + 1, { timeout: 10_000 });
	assert.match((await page.$$eval('[data-item="approval"]:not([data-state="open"])', (els: Element[]) => els.at(-1)?.textContent)) ?? "", /Answered[\s\S]*Which store\?[\s\S]*what is the difference\?/);
	// The agent read it as the owner's own words, and asks again: the second question is answered by a pick.
	await page.waitForFunction((c: string) => document.querySelector(c), card, { timeout: 10_000 });
	await page.locator(card).getByRole("radio", { name: /sqlite/ }).click();
	await sees("[data-slot=markdown] >> text=store chosen");
	const told = JSON.stringify(mock.state.requests.at(-1)?.body.messages.filter((m: any) => m.role === "tool"));
	assert.ok(told.includes("Your owner answered in their own words: what is the difference?"), told.slice(-600));
	assert.ok(told.includes("If this does not answer your question, respond to what they said. You may ask again."));
	assert.ok(told.includes("Your owner answered: sqlite"));
	// Nothing was sent as a message besides the answer: the conversation had one turn.
	assert.equal(mock.state.requests.filter((q: any) => JSON.stringify(q.body.messages).includes("what is the difference?") && q.body.messages.at(-1)?.role === "user" && JSON.stringify(q.body.messages.at(-1)).includes("what is the difference?")).length, 0);
});

test("a question of another conversation is never answered from this one: no card here, the line says it waits elsewhere, and Go there opens it", async () => {
	const card = "[data-slot=composer-question] [data-slot=questionnaire]";
	const field = "[data-slot=composer] textarea";
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=main");
	// Asked in a conversation of main's that has no tab: this window shows it in a tab of main's (`holderFor`).
	const ask = { tools: [{ name: "question", args: { question: "Which room?", options: [{ label: "kitchen" }, { label: "hall" }] } }] };
	const started = await api("POST", "/agents/main/prompt", { prompt: mockMsg([ask, { text: "room chosen" }], "ask from elsewhere "), session: "elsewhere-q", wait: false });
	assert.ok(started.ok, JSON.stringify(started));
	const waits = page.locator("[data-slot=marker]", { hasText: /another conversation waits for you/ });
	await waits.waitFor({ timeout: 20_000 });
	assert.equal(await page.$(card), null, "no card for another conversation's question");
	assert.doesNotMatch((await page.getAttribute(field, "placeholder")) ?? "", /answer/i);
	// What is typed here is a message of this conversation, and the question stays open.
	await page.fill(field, "just a message here");
	await page.keyboard.press("Enter");
	await sees('[data-item="user"] >> text=just a message here');
	await sees("[data-slot=markdown] >> text=just a message here");
	const open = (await api("GET", "/approvals")).data as any[];
	assert.ok(open.some((a) => a.summary.includes("Which room?")), "the question is still open");
	// Go there opens its conversation, where the card is, and it is answered there.
	await waits.waitFor();
	await waits.getByRole("button", { name: "Go there" }).click();
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=elsewhere-q");
	await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Which room?"), card, { timeout: 10_000 });
	await page.locator(card).getByRole("radio", { name: /hall/ }).click();
	await sees("[data-slot=markdown] >> text=room chosen");
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=main");
});

test("words typed for a question that was answered meanwhile elsewhere are not lost: they go as an ordinary message", async () => {
	const card = "[data-slot=composer-question] [data-slot=questionnaire]";
	const field = "[data-slot=composer] textarea";
	const ask = { tools: [{ name: "question", args: { question: "Which tea?", options: [{ label: "green" }, { label: "black" }] } }] };
	await page.fill(field, mockMsg([ask, { text: "tea chosen" }], "pick a tea "));
	await page.keyboard.press("Enter");
	await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Which tea?"), card, { timeout: 10_000 });
	// Answered on another device the moment before the owner's words reach the daemon.
	await app.evaluate(({ ipcMain }: any) => {
		const g = globalThis as any;
		const call = ipcMain._invokeHandlers.get("pine:call");
		ipcMain.removeHandler("pine:call");
		ipcMain.handle("pine:call", async (e: unknown, method: string, url: string, body?: any) => {
			if (method === "POST" && /^\/approvals\//.test(url) && body?.values?.answer) await call(e, method, url, { allow: true, always: false, values: { answer: "green" } });
			return call(e, method, url, body);
		});
		g.unrace = () => {
			ipcMain.removeHandler("pine:call");
			ipcMain.handle("pine:call", call);
		};
	});
	try {
		await page.click(field);
		await page.keyboard.type("oolong, please");
		await page.keyboard.press("Enter");
		await sees("[data-slot=markdown] >> text=tea chosen");
		// The words went as a message of their own, which the agent answered (the scripted model echoes it).
		let asked: any[] = [];
		for (let i = 0; i < 100 && !asked.some((t) => t.prompt === "oolong, please"); i++) {
			asked = (await api("GET", "/tasks?agent=main&session=main&limit=5")).data as any[];
			await new Promise((r) => setTimeout(r, 100));
		}
		assert.ok(asked.some((t) => t.prompt === "oolong, please"), `sent as a message: ${JSON.stringify(asked.map((t) => t.prompt))}`);
		await sees("[data-slot=markdown] >> text=oolong, please");
		const bubbles = await page.$$eval('[data-item="user"]', (els: Element[]) => els.filter((e) => e.textContent?.includes("oolong, please")).length);
		assert.equal(bubbles, 1, "shown once, as the owner's message");
	} finally {
		await app.evaluate(() => (globalThis as any).unrace());
	}
});

test("in a short pane a question card keeps the composer in view and typable: its options scroll inside it, and the thread above still has room", async () => {
	const long = "A line that says at length what this option means, so that three of them take more room than a short pane has to give.";
	const ask = { tools: [{ name: "question", args: { question: "Which plan?", options: [{ label: "small", description: long }, { label: "medium", description: long }, { label: "large", description: long }] } }] };
	await page.fill("[data-slot=composer] textarea", mockMsg([ask, { text: "plan chosen" }], "pick a plan "));
	await page.keyboard.press("Enter");
	const card = "[data-slot=composer-question] [data-slot=questionnaire]";
	await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Which plan?"), card, { timeout: 10_000 });
	/** The pane's parts as the page lays them out: the thread's viewport, the card, its options' viewport, the composer's field. */
	const measure = () => page.$eval(card, (el: Element) => {
		const pane = el.closest("[data-slot=conversation]")!;
		const rect = (e: Element | null | undefined) => (e ? e.getBoundingClientRect().toJSON() : null);
		const field = pane.querySelector("[data-slot=composer] textarea")!;
		const f = field.getBoundingClientRect();
		const options = el.closest("[data-slot=composer-question]")?.querySelector("[data-slot=scroll-area-viewport]");
		const thread = pane.querySelector("[data-slot=message-scroller-viewport]")!;
		return {
			pane: rect(pane), card: rect(el), field: rect(field), thread: thread.clientHeight,
			options: options ? { rect: rect(options), scroll: options.scrollHeight, client: options.clientHeight } : null,
			// What a click where one types reaches: the field, not a card laid over it.
			hit: document.elementFromPoint(f.x + 16, f.y + f.height / 2) === field,
		};
	});
	// A tall pane: the options are all there, nothing scrolls.
	const tall = await measure();
	assert.ok(tall.options && tall.options.scroll <= tall.options.client + 1, `the options scroll in a tall pane: ${JSON.stringify(tall)}`);
	// A short pane, of about 300 pixels.
	await page.setViewportSize({ width: 1280, height: 360 });
	await page.waitForFunction((c: string) => (document.querySelector(c)?.closest("[data-slot=conversation]")?.getBoundingClientRect().height ?? 999) < 340, card, { timeout: 5000 });
	try {
		const short = await measure();
		await shot("question-short-pane");
		const p = short.pane!, f = short.field!;
		assert.ok(f.top >= p.top && f.bottom <= p.bottom + 0.5 && f.height >= 16, `the composer is out of the pane: ${JSON.stringify(short)}`);
		assert.ok(short.hit, `something lies over the composer: ${JSON.stringify(short)}`);
		assert.ok(short.options && short.options.scroll > short.options.client, `the options do not scroll inside the card: ${JSON.stringify(short)}`);
		assert.ok(short.thread >= 40, `the thread has no room left: ${JSON.stringify(short)}`);
		// Keyboard focus on the last option brings it into view inside the card, which scrolls to it.
		const last = () => page.$eval(card, (el: Element) => {
			const viewport = el.closest("[data-slot=composer-question]")!.querySelector("[data-slot=scroll-area-viewport]")!;
			const v = viewport.getBoundingClientRect();
			const o = [...el.querySelectorAll("[data-slot=questionnaire-choice]")].at(-1)!.getBoundingClientRect();
			return { shown: o.bottom > v.top + 1 && o.top < v.bottom - 1, top: viewport.scrollTop, v: v.toJSON(), o: o.toJSON() };
		});
		assert.equal((await last()).shown, false, "the last option is out of view at first");
		await page.locator(card).getByRole("radio", { name: /large/ }).focus();
		const seen = await last();
		assert.ok(seen.shown && seen.top > 0, `the focused option is not in view: ${JSON.stringify(seen)}`);
		// The composer takes what is typed while the card is open.
		await page.click("[data-slot=composer] textarea");
		await page.keyboard.type("hm");
		assert.equal(await page.inputValue("[data-slot=composer] textarea"), "hm");
		await page.fill("[data-slot=composer] textarea", "");
	} finally {
		await page.setViewportSize({ width: 1280, height: 820 });
	}
	await page.locator(card).getByRole("radio", { name: /medium/ }).click();
	await sees("[data-slot=markdown] >> text=plan chosen");
});

test("a sign-in's choices are a question card answered by a pick; what it then asks to be typed opens the approval dialog", async () => {
	// Amazon Bedrock's sign-in in pi asks first how to sign in (a select), then for a token (a secret).
	// The window is behind another app: what is asked is told in a notification.
	// The main process asks the window too: under xvfb with no window manager, a window never shown says it is focused.
	const focus = (on: boolean) =>
		app.evaluate(({ BrowserWindow }: any, on: boolean) => {
			const win = BrowserWindow.getAllWindows()[0];
			if (on) delete win.isFocused;
			else win.isFocused = () => false;
			win.webContents.send("pine:focus", on);
		}, on);
	const notified = () => app.evaluate(() => (globalThis as any).quiet.notified.map((n: any) => n.body) as string[]);
	const had = (await notified()).length;
	// In a conversation of its own: the app says the same thing of one conversation once in two seconds (`recentNotifs`
	// in electron/main.ts), and the test before this one had main's main conversation ask a question a moment ago.
	const tabs = await page.locator("[data-slot=tab]").count();
	await menu("new");
	await page.waitForFunction((n) => document.querySelectorAll("[data-slot=tab]").length > n, tabs);
	await focus(false);
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "sign_in", args: { provider: "amazon-bedrock", way: "key" } }] }, { text: "sign-in ended" }], "sign in to bedrock "));
	await page.keyboard.press("Enter");
	// The sign-in itself is put to the owner first, in the approval dialog as before.
	const dialog = "role=dialog[name=/^Approval needed/]";
	await sees(dialog);
	await page.locator(dialog).getByRole("button", { name: /^Allow/ }).click();
	// The flow's choice is a question card above the composer, with the flow's options, and no dialog opens.
	const card = "[data-slot=composer-question] [data-slot=questionnaire]";
	await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Bedrock authentication method"), card, { timeout: 10_000 });
	assert.equal(await page.locator(dialog).count(), 0, "no dialog opens for a sign-in's choice");
	assert.match(await page.textContent(card), /Bearer token[\s\S]*AWS profile[\s\S]*Existing AWS credential chain/);
	// The flow's options are what it offers, not a recommendation of the agent's.
	assert.equal(await page.locator(card).getByText("recommended").count(), 0, "no option of a sign-in is marked recommended");
	// The choice is told as a question, the sign-in itself as an approval. The notification goes to the
	// main process after the card is drawn: it is waited for, not read once.
	let told: string[] = [];
	for (let i = 0; i < 50 && !told.includes("main has a question for you"); i++) {
		if (i) await new Promise((r) => setTimeout(r, 100));
		told = (await notified()).slice(had);
	}
	assert.ok(told.includes("main has a question for you"), `told: ${JSON.stringify(told)}`);
	await focus(true);
	assert.equal(await page.locator('[data-item="approval"][data-state="open"]').count(), 0, "the open choice is not drawn in the conversation as well");
	await shot("03-sign-in-choice");
	// A click answers it, and the card folds into a line that says what was picked.
	await page.locator(card).getByRole("radio", { name: /Bearer token/ }).click();
	await page.waitForSelector(card, { state: "detached" });
	await sees('[data-item="approval"][data-state="allowed"] >> text=/Bearer token/');
	// The token the flow asks next is typed: that request has only a field, and opens the approval dialog.
	const typed = "role=dialog[name=/^Approval needed, and something only you have/]";
	await sees(typed);
	assert.match(await page.textContent(typed), /bearer token/i);
	assert.equal(await page.locator(card).count(), 0);
	await page.locator(typed).getByRole("button", { name: "Deny" }).click();
	await page.locator(dialog).waitFor({ state: "detached" });
	await sees("[data-slot=markdown] >> text=sign-in ended");
	assert.match(JSON.stringify(mock.state.requests.at(-1)?.body.messages.filter((m: any) => m.role === "tool")), /not signed in/);
	await menu("close");
	await page.waitForFunction((n) => document.querySelectorAll("[data-slot=tab]").length === n, tabs);
});

test("a folder is opened for a conversation: changes, and a file edited and saved", async () => {
	// As the system does it when a folder is dropped on the app's icon.
	await app.evaluate(({ BrowserWindow }: any, dir: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", `folder:${dir}`), folder);
	// With several agents the app asks whose folder it is; the one in front is offered first.
	await confirm("[cmdk-group-heading] >> text=Which agent works in");
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
	const dragged = await page.$eval("[data-slot=code-panel]", (el: Element) => el.getBoundingClientRect().width);
	assert.ok(dragged > was + 30, `dragged 60 pixels wider, the panel is ${dragged} wide, from ${was}`);
	await page.focus(`${CODE_EDGE}[role='separator']`, { timeout: 5000 });
	await page.keyboard.press("ArrowLeft");
	await page.waitForFunction((w) => document.querySelector("[data-slot=code-panel]")!.getBoundingClientRect().width > w, dragged, { timeout: 5000 });
	// Loaded again, it is as wide as it was left.
	const wide = Math.round(await page.$eval("[data-slot=code-panel]", (el: Element) => el.getBoundingClientRect().width));
	await page.reload();
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=pine-desktop-folder");
	if (!(await page.$("[data-slot=code-panel]"))) await page.click(CODE_TOGGLE);
	await sees("[data-slot=code-panel]");
	assert.ok(Math.abs(Math.round(await page.$eval("[data-slot=code-panel]", (el: Element) => el.getBoundingClientRect().width)) - wide) <= 2);
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
	// From the find field, Tab reaches the tree after the toggle for searching inside files and the refresh button: one stop.
	await page.focus("[data-slot=code-panel] input[aria-label='Find a file']");
	for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
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
	for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
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
	await sees("[data-slot=settings-page] [data-slot=item-description] >> text=wake all agents, each in its main conversation");
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
	// A route opens from its row with what it does filled in, and is saved in its place.
	await page.click("[data-slot=settings-page] [data-find='route:mode']");
	assert.equal(await routeForm.getByLabel("Shared state").inputValue(), '{"house/mode":"{{payload.value}}"}');
	await routeForm.getByLabel("Only if").fill('{"payload.topic": "house/level"}');
	await routeForm.getByRole("button", { name: "Save changes" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await sees("[data-slot=settings-page] [data-find='route:mode'] >> text=house/level");
	const routes = JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).routes;
	assert.deepEqual(routes.map((r: { name: string }) => r.name), ["mode"]);
	assert.deepEqual(routes[0].when, { "payload.topic": "house/level" });
	// An agent's own schedule is added on its page, and the Events page points there.
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=Agents");
	await page.click("[data-slot=settings-page] [data-slot=item] >> text=books");
	await page.locator("[data-find=agent-schedules]").getByRole("button", { name: "New schedule" }).click();
	assert.equal(await scheduleForm.getByLabel("Wake").isDisabled(), true, "it is the agent's");
	await scheduleForm.getByLabel("Times").fill("0 9 * * 1");
	await scheduleForm.getByLabel("With the task").fill("Sum up last week's spending.");
	await scheduleForm.getByLabel("Name", { exact: true }).fill("weekly");
	await scheduleForm.getByRole("button", { name: "Add schedule" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await sees("[data-find=agent-schedules] [data-slot=item-title] >> text=weekly");
	assert.equal(JSON.parse(fs.readFileSync(path.join(home, "agents", "books", "agent.json"), "utf8")).schedules[0].name, "weekly");
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=Events");
	await sees("[data-find=own-sources] [data-slot=item-description] >> text=1 schedule");
	assert.equal(await page.locator("[data-find=schedules] [data-slot=item-title]", { hasText: "weekly" }).count(), 0, "not among those for all agents");
	// A decision model at an address of its own (Models), which a route then names.
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=Models");
	await page.locator("[data-slot=settings-page]").getByRole("button", { name: "Add a decision model" }).click();
	const decisionForm = page.locator("[data-slot=dialog-content]");
	await decisionForm.getByLabel("Where it is").click();
	await page.getByRole("option", { name: "Another server, by its address" }).click();
	await decisionForm.getByLabel("Address").fill("http://127.0.0.1:9");
	await decisionForm.getByLabel("Model", { exact: true }).fill("judge-7b");
	await decisionForm.getByLabel("Name", { exact: true }).fill("judge");
	await decisionForm.getByRole("button", { name: "Add decision model" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await sees("[data-slot=settings-page] [data-find='decision:judge'] >> text=127.0.0.1:9");
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).decisions, { judge: { url: "http://127.0.0.1:9", model: "judge-7b" } });
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=Events");
	// A decision: one typed question, its options one on each line, answered by the default model; what goes into pine.json is pine's own question.
	await page.locator("[data-slot=settings-page]").getByRole("button", { name: "New route" }).click();
	await routeForm.getByLabel("An event arrives on").fill("source/inbox/mail");
	await routeForm.getByLabel("What happens").click();
	await page.getByRole("option", { name: "Make a decision" }).click();
	await routeForm.getByLabel("The question").fill("What is it?");
	await routeForm.getByLabel("Answered with").click();
	await page.getByRole("option", { name: "One of several" }).click();
	await routeForm.getByLabel("Options").fill("invoice: A bill to pay\nother: Anything else");
	await routeForm.getByLabel("Looking at").fill("{{payload.subject}}");
	await routeForm.getByLabel("Decided by").click();
	await page.getByRole("option", { name: /^judge/ }).click();
	await routeForm.getByLabel("Call the answer").fill("kind");
	await routeForm.getByLabel("Publish the answer as").fill("mail/judged");
	await routeForm.getByLabel("Name", { exact: true }).fill("mail-judge");
	await routeForm.getByRole("button", { name: "Add route" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await sees("[data-slot=settings-page] [data-slot=item-description] >> text=decide with judge");
	const decision = JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).routes.find((r: { name: string }) => r.name === "mail-judge");
	assert.deepEqual(decision, { name: "mail-judge", on: "source/inbox/mail", ask: { questions: { kind: { type: "choice", question: "What is it?", options: { invoice: "A bill to pay", other: "Anything else" } } }, model: "judge", data: "{{payload.subject}}" }, publish: { topic: "mail/judged" } });
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
	await sees("[cmdk-group-heading] >> text=Model for all agents without a model of their own");
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
	// The main agent's card says it in a toast that stays, not on the card.
	const noModel = page.locator("[data-slot=toast]:not([data-ending-style])", { hasText: "Connect a model first" });
	await noModel.waitFor({ timeout: 20_000 });
	assert.equal(await page.$("[data-slot=empty] [data-slot=model-notice]"), null);
	await shot("09-no-model");
	// The toast leads to the one way to connect a model, the setup conversation ("Setup Pine", which
	// came in front by itself too when the model was lost); back to Settings from there.
	await noModel.getByRole("button", { name: "Set up a model…" }).click();
	await sees("[data-slot=conversation-head] >> text=Setup Pine");
	await sees("[data-slot=composer-question] [data-slot=questionnaire-title] >> text=How should your agents run?");
	await menu("close");
	await page.waitForSelector("[data-slot=tab]:has-text('Setup Pine')", { state: "detached" });
	await menu("settings");
	await sees("[data-slot=settings-page] h1 >> text=Models");
	// "Change" offers every model that can be used now.
	await page.locator("[data-setting=fallback-model]").getByRole("button", { name: "Change" }).click();
	await sees("[cmdk-group-heading] >> text=Model for all agents without a model of their own");
	await page.getByRole("option", { name: "mock/m" }).click();
	await sees("[data-slot=toast] >> text=Your agents now run on mock/m");
	await page.waitForSelector("[data-slot=settings-page] [data-slot=model-notice]", { state: "detached" });
	// A model answers again: the toast is gone by itself.
	await noModel.waitFor({ state: "detached", timeout: 10_000 });
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
	await page.fill("[data-slot=dialog-content] textarea", "File an invoice. Use when a bill arrives.");
	await page.click("[data-slot=dialog-content] .cm-content");
	await page.keyboard.type("1. Read the bill.");
	await page.locator("[data-slot=dialog-content]").getByRole("button", { name: "Add skill" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
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
	const dir = page.locator("[data-slot=dialog-content] [data-slot=field]", { has: page.locator("[data-slot=field-label]", { hasText: /^dir/ }) }).locator("input");
	// An option the type needs is said to be needed, to a screen reader too, not by its star alone.
	assert.equal(await dir.getAttribute("aria-required"), "true");
	await dir.fill(watched);
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
/** The theme the window is drawn in, by its name (theme.ts sets it on the root element). */
const themeIs = (id: string) => page.waitForFunction((t: string) => document.documentElement.dataset.theme === t, id, { timeout: 10_000 });
/** The tab in front: drawn in the page color of the theme. */
test("the window is drawn in pmndre, the theme pine names when pine.json names none", { skip: Boolean(process.env.PINE_DESKTOP_THEME) }, async () => {
	await themeIs("pmndre");
	assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), true);
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
		assert.equal(await resolved("var(--background)"), rgb("#ffffff"));
		assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).ui.theme, "github-light");
		// The app keeps it, to open in it next time.
		const prefs = () => JSON.parse(fs.readFileSync(path.join(home, "desktop-data", "prefs.json"), "utf8"));
		assert.equal(prefs().look?.id, "github-light");

		await pick("Mine");
		await themeIs("mine");
		assert.equal(await resolved("var(--background)"), rgb("#102030"));
		assert.equal(await resolved("var(--primary)"), rgb("#ff8800"));
		assert.equal(await resolved("var(--code-keyword)"), rgb("#ff00aa"));

		// Another hand (the main agent's set_setting, another UI) changes it through pine: the window follows.
		await api("POST", "/settings", { key: "ui.theme", value: "dracula" });
		await themeIs("dracula");
		assert.equal(await resolved("var(--background)"), rgb("#282a36"));
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
	// The menu's item opens the side panel on its Agent view whatever state the panel is in (a toggle could close it).
	await menu("code-agent");
	await sees("[data-slot=code-panel] [role=tab][aria-selected=true] >> text=Agent");
	await sees("[data-slot=code-panel] [data-slot=item-title] >> text=invoices");
	await sees("[data-slot=code-panel] [data-slot=item-title] >> text=morning");
	assert.match(await page.textContent("[data-slot=code-panel]"), /Nothing wakes it by itself\. 1 event source could/);
	await shot("14-agent-view");
});
