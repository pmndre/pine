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
import { activeOption, announced, api, app, browsers, CODE_EDGE, CODE_TOGGLE, confirm, folder, home, menu, mock, named, page, putAwayToasts, releases, root, sees, shot, shots, stillInside, write } from "./support/window.ts";

// What these tests look for is what the page commits to (TESTS.md): a part by its `data-slot`, a state by
// its `data-state`, a button by its `data-action`, a field by its id, and words only where the test wrote them.
/** A page of Settings in the navigation, by its id, and that page opened. */
const NAV = (id: string) => `[role=navigation] [data-section=${id}]`;
const settingsPage = async (id: string) => {
	await page.click(NAV(id));
	await sees(`${NAV(id)}[aria-current=page]`);
};
/** A tab of the window: a conversation by its agent and session, anything else by its kind. */
const TAB = (agent: string, session = "main") => `[data-slot=tab][data-kind=chat][data-agent="${agent}"][data-session="${session}"]`;
const DIALOG = "[data-slot=dialog-content]";
/** The dialog that asks for the owner's approval; with `[data-inputs]` when something is to be typed into it. */
const APPROVAL = "[data-dialog=approval]";
/** A field of a form in a dialog, by its id: the form's own (React's, which ends in "_" or ":"), then "-<field>". */
const formField = (name: string) => `${DIALOG} :is([id$="_-${name}"], [id$=":-${name}"])`;
/** Chooses from a select of a form: its trigger by the end of its id, the option by its value. */
const choose = async (name: string, value: string) => {
	await page.click(formField(name));
	await page.click(`[data-slot=select-content] [data-slot=select-item][data-value="${value}"]`);
	await page.waitForSelector("[data-slot=select-content][data-open]", { state: "detached" });
};
/** A JSON file of the test's home, as it is now. */
const read = (...parts: string[]) => JSON.parse(fs.readFileSync(path.join(home, ...parts), "utf8"));
/** Waits until something outside the page is so (a file, what a stand-in was asked): as long as `sees` waits. */
const until = async (what: string, test: () => unknown) => {
	for (let i = 0; i < 400 && !(await test()); i++) await new Promise((r) => setTimeout(r, 50));
	assert.ok(await test(), what);
};

test("starts a daemon of its own and shows the main agent", async () => {
	// The main agent's own conversation is in front, with its welcome.
	await sees("[data-slot=empty] [data-slot=welcome-name]");
	assert.equal(await page.textContent("[data-slot=empty] [data-slot=welcome-name]"), "main");
	await sees(`${TAB("main")}[data-active]`);
	// This home has no browser for the web tools in the build its pine drives (the folder for it
	// is empty): that is asked once, at the start, and putting it off is remembered.
	await sees("[data-dialog=browser-ask]");
	await shot("00-browser");
	await page.click("[data-dialog=browser-ask] [data-action=later]");
	await page.waitForSelector(DIALOG, { state: "detached" });
	// The app started this pine itself, and says so.
	await sees("[data-slot=service-status][data-origin=started]");
	const agents = await page.$$eval("[data-slot=agent-label] [data-slot=agent-name]", (els: Element[]) => els.map((e) => e.textContent?.trim()));
	assert.deepEqual(agents, ["main", "scout"]);
	// The daemon it started is the one of this home, on a port of its own.
	assert.ok(fs.existsSync(path.join(home, "data", "http-token")));
	await shot("01-welcome");
	// Its agents have a model: the setup conversation is not opened.
	assert.equal(await page.$(TAB("main", "setup")), null);
});

test("a newer app is said at the start and when asked, with a link to its page on GitHub and nothing fetched", async () => {
	// An app from a checkout updates nothing itself: macOS's updater was never pointed at a feed, and there is no switch for it.
	assert.equal(await app.evaluate(({ autoUpdater }: any) => autoUpdater.getFeedURL()), "");
	const mine = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
	const link = "https://github.com/pmndre/pine/releases/tag/v9.9.9";
	// The start asked once, and the side bar says what it found.
	const found = "[data-slot=sidebar-footer] [data-update=link][data-version='9.9.9']";
	await sees(found);
	assert.equal(releases.asked, 1);
	await shot("01-update");
	// What would open in the owner's browser is noted instead.
	await app.evaluate(({ shell }: any) => {
		(globalThis as any).opened = [];
		shell.openExternal = async (url: string) => void (globalThis as any).opened.push(url);
	});
	const opened = () => app.evaluate(() => (globalThis as any).opened);
	await page.click(found);
	// The menu's "Check for Updates…" asks again and says where the new app is: this version, the new one, and the link.
	assert.ok(await app.evaluate(({ Menu }: any) => Boolean(Menu.getApplicationMenu()?.getMenuItemById("updates"))), "the menu has an item that checks for updates");
	await menu("updates");
	const asked = "[data-dialog=update][data-update=link][data-version='9.9.9']";
	await sees(asked);
	assert.equal(releases.asked, 2);
	const body = await page.textContent(asked);
	assert.ok(body.includes(mine) && body.includes(link), body);
	await shot("01-update-asked");
	await page.click(`${asked} [data-action=release-page]`);
	await page.waitForSelector(DIALOG, { state: "detached" });
	// The link is GitHub's page of that release, not the address the answer named.
	assert.deepEqual(await opened(), [link, link]);
	// Nobody answers: that is said as a warning, and what was found before stays.
	releases.status = 503;
	await putAwayToasts();
	await menu("updates");
	await sees("[data-slot=toast][data-type=warning]");
	assert.equal(releases.asked, 3);
	await sees(found);
	// This app is the last release: said once, with its version, and the side bar's line is gone.
	Object.assign(releases, { status: 200, tag: `v${mine}` });
	await putAwayToasts();
	await menu("updates");
	await sees(`[data-slot=toast][data-type=success] >> text=${mine}`);
	await page.waitForSelector("[data-slot=sidebar-footer] [data-update]", { state: "detached" });
	// Settings > General has the same, and the switch for the question at the start.
	await menu("settings");
	await settingsPage("general");
	await sees("[data-setting=updates][data-update=none]");
	releases.tag = "v9.9.9";
	await page.click("[data-setting=updates] [data-action=check]");
	await sees("[data-setting=updates][data-update=link][data-version='9.9.9']");
	await page.click("[data-dialog=update] [data-action=close]");
	await page.waitForSelector(DIALOG, { state: "detached" });
	await page.click("[data-setting=updates] [data-action=release-page]");
	await until("the release page was opened from Settings", async () => (await opened()).length === 3);
	assert.deepEqual(await opened(), [link, link, link]);
	const prefs = () => read("desktop-data", "prefs.json");
	// An app that does not update itself has no switch for it.
	assert.equal(await page.$("[data-find=auto-update]"), null);
	const atStart = "[data-find=updates-at-start] [role=switch]";
	await page.click(atStart);
	await until("the choice is kept by the app", () => prefs().updates === false);
	// It is a switch to assistive technology too, and Space turns it back on.
	await sees(`${atStart}[aria-checked=false]`);
	await page.keyboard.press("Space");
	await sees(`${atStart}[aria-checked=true]`);
	await until("the choice is kept by the app", () => prefs().updates === true);
	// (The settings open where they were left: on their first page for the tests that follow.)
	await menu("settings");
	await sees(found);
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
	const waitFor = (what: string, test: () => boolean) => until(`${what}. Asked: ${JSON.stringify(asked)}`, test);
	const ADDRESS = "[data-slot=browser] [data-field=address]";
	/** The side panel's view in front. */
	const shows = (view: string) => sees(`[data-slot=code-panel] [data-view=${view}][aria-selected=true]`);
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
		await page.click("[data-slot=code-panel] [data-view=browser]");
		// The page is a picture, drawn when it is whole; its address is text in the line above it.
		await sees("#code-panel [data-slot=code-panel] [data-slot=browser] canvas[data-drawn]");
		await sees(`${CODE_TOGGLE}[aria-pressed=true]`);
		assert.equal(await page.inputValue(ADDRESS), "https://shop.example/");
		// (The picture the stand-in hands out is 400 by 300: it is drawn as it came.)
		assert.deepEqual(await page.$eval("[data-slot=browser] canvas", (c: HTMLCanvasElement) => [c.width, c.height]), [400, 300]);
		// The app said that it shows the browser itself, so the agent's browser opens no window, and how much room
		// the page has there: some, and no more than the panel it is in.
		await waitFor("the door was told that the app shows the browser", () => asked.some((a) => a.at === "/input" && a.body.ops.some((o: any) => o.do === "size")));
		const size = ops().find((o) => o.do === "size");
		const panel = await page.$eval("[data-slot=code-panel]", (el: Element) => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }));
		assert.ok(size.w > 0 && size.h > 0 && size.w <= Math.ceil(panel.w) && size.h <= Math.ceil(panel.h), `the page is laid out for the room the panel has: ${JSON.stringify({ size, panel })}`);
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
		await page.focus(ADDRESS);
		await page.keyboard.press("Tab");
		assert.equal(await page.evaluate(() => Boolean(document.activeElement?.matches("[data-slot=browser] [data-drawn]"))), true, "Tab goes from the address to the picture");
		// The wheel adds up, a tab is chosen by a click, back is a button.
		await page.mouse.wheel(0, 120);
		await page.mouse.wheel(0, 120);
		await page.click("[data-slot=browser] [data-slot=tabs-trigger] >> nth=1");
		// A tab of the owner's own, and one closed.
		await page.click("[data-slot=browser] [data-action=newtab]");
		// The tabs are drawn again once the new one is asked for: a click before that can land on a button that is gone.
		await waitFor("a new tab arrived", () => ops().some((o) => o.do === "newtab"));
		// The button to close a tab that is not in front shows under the pointer only. So the pointer goes to the tab
		// first, as the owner's does: a click forced onto the unseen button is sent wherever it was a moment ago.
		await page.hover("[data-slot=browser] [data-slot=tabs-trigger] >> nth=1");
		await page.click("[data-slot=browser] [data-slot=tabs-list] [data-action=closetab] >> nth=1");
		await waitFor("a closed tab arrived", () => ops().some((o) => o.do === "closetab" && o.index === 1));
		await page.click("[data-slot=browser] [data-action=back]");
		await waitFor("wheel, tab and back arrived", () => ["wheel", "tab", "back"].every((d) => ops().some((o) => o.do === d)));
		// (How far a turn of the wheel goes is the system's to say; that it went down, and all of it, is what counts.)
		assert.ok(ops().filter((o) => o.do === "wheel").reduce((sum, o) => sum + o.dy, 0) >= 240, JSON.stringify(ops().filter((o) => o.do === "wheel")));
		assert.equal(ops().find((o) => o.do === "tab").index, 1);
		// An address typed above the picture is opened by the daemon's hand, and a no is said.
		await page.fill(ADDRESS, "localhost:5173");
		await page.press(ADDRESS, "Enter");
		await waitFor("the address arrived", () => asked.some((a) => a.at === "/open"));
		assert.deepEqual(asked.find((a) => a.at === "/open")!.body, { url: "localhost:5173" });
		// (The words are the stand-in's own: what the door answers is what is said.)
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

		// Without a browser the view says that no page is open and draws nothing.
		fs.rmSync(file);
		await sees("[data-slot=browser] [data-slot=empty][data-state=no-page]");
		assert.equal(await page.$("[data-slot=browser] canvas[data-drawn]"), null);

		// The menu's item and /browser show the browser in the side panel, and put the panel away when it is in front.
		await menu("browser");
		await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
		await sees(`${CODE_TOGGLE}[aria-pressed=false]`);
		await menu("browser");
		await shows("browser");
		await menu("code-files");
		await shows("files");
		await page.fill("[data-slot=composer] textarea", "/browser");
		await page.press("[data-slot=composer] textarea", "Enter");
		await shows("browser");
		await page.fill("[data-slot=composer] textarea", "/code files");
		await page.press("[data-slot=composer] textarea", "Enter");
		await shows("files");
		await page.fill("[data-slot=composer] textarea", "/code browser");
		await page.press("[data-slot=composer] textarea", "Enter");
		await shows("browser");
		// The agent puts its browser in front of the owner: the side panel shows it. (In a conversation of its own, so that main's stays as the tests after this one expect it.)
		await menu("code-files");
		await shows("files");
		const tabs = await page.locator("[data-slot=tab]").count();
		await menu("new");
		await page.waitForFunction((n) => document.querySelectorAll("[data-slot=tab]").length > n, tabs);
		await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "browser_show", args: {} }], text: "Have a look." }, { text: "There it is." }], "Show me the page. "));
		await page.keyboard.press("Enter");
		await shows("browser");
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
	// The work of the turn (what it said on the way, and the tool call) is one line, folded, which names the
	// tool that was called; a click opens it.
	const work = "[data-item=work][data-tools='1']";
	await sees(`${work} [data-slot=trace-collapsible-trigger]:has-text("read")`);
	assert.equal(await page.$(`${work} [data-tool]`), null);
	await page.click(`${work} [data-slot=trace-collapsible-trigger]`);
	await sees(`${work} [data-tool]`);
	assert.equal(await page.textContent(`${work} [data-tool]`), "read");
	// A link says where it leads, and is not an address the page itself would follow.
	assert.equal(await page.textContent("[data-slot=markdown] [data-href]"), "the docs");
	assert.equal(await page.getAttribute("[data-slot=markdown] [data-href]", "data-href"), "https://example.com/docs");
	assert.match(await page.textContent("[data-slot=markdown] [data-target]"), /example\.com\/docs/, "a link's address is written out beside it");
	assert.equal(await page.$$eval("[data-slot=markdown] a[href]", (els: Element[]) => els.length), 0);
	// It is a link from the keyboard too: it takes the focus, and Enter opens it in the browser.
	await page.focus("[data-slot=markdown] [data-href]");
	assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-href")), "https://example.com/docs");
	assert.equal(await page.getAttribute("[data-slot=markdown] [data-href]", "role"), "link");
	await page.keyboard.press("Enter");
	await until("Enter on the link opened it in the owner's browser", async () => (await app.evaluate(() => ((globalThis as any).opened ?? []) as string[])).includes("https://example.com/docs"));
	// A folded part is there and closed.
	assert.equal(await page.getAttribute("[data-slot=markdown] [data-details] [data-slot=collapsible-trigger]", "aria-expanded"), "false");
	// Code is pine's own Code Block, with its lines, its language and a copy button, and nothing to download:
	// nothing of Streamdown's own block, which has a download button, is drawn.
	await sees("[data-slot=markdown] [data-slot=code-block] [data-slot=code-block-line]:has-text('const a = 1;')");
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
	const scout = page.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { has: page.locator("[data-slot=agent-name]", { hasText: /^scout$/ }) });
	try {
		await scout.locator("[data-slot=agent-label]").click();
		await sees(`${TAB("scout")}[data-active]`);
		await sees("[data-slot=conversation-skeleton] [data-slot=skeleton]");
		assert.equal(await page.$("[data-slot=conversation] [data-slot=pulse]"), null, "a loading conversation shows its shape, not the Pulse");
		assert.equal(await page.$("[data-slot=message-scroller-content]"), null);
		assert.equal(await page.$("[data-slot=empty]"), null, "no empty state shows before the data is there");
		await shot("02-loading");
	} finally {
		await app.evaluate(() => (globalThis as any).unhold());
	}
	await sees("[data-slot=message-scroller-content]");
	assert.equal(await page.$("[data-slot=conversation-skeleton]"), null);
	await page.click(`${TAB("scout")}[data-active] [data-action=close]`);
	await sees(`${TAB("main")}[data-active]`);
});

test("a model is chosen from its picker with the keyboard alone, and focus goes back to the chip", async () => {
	const chip = "[data-slot=composer] [data-control=model]";
	const focused = () => page.evaluate((s: string) => document.activeElement === document.querySelector(s), chip);
	await page.focus(chip);
	await page.keyboard.press("Enter");
	await sees("[data-slot=dialog-content] [role=listbox] [role=option]");
	await named(/mock\/m/);
	// Its field is there to be seen, however short the list.
	assert.ok(await page.locator("[data-slot=dialog-content] [data-slot=command-input]").isVisible(), "the field is seen");
	// It is announced by a title, which says whose model it is.
	assert.match(await announced("[data-slot=dialog-content]"), /main/);
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
	assert.equal(await page.getAttribute(chip, "data-value"), "mock/m");
});

test("the reasoning is chosen from the composer's menu with the keyboard, and the agent keeps it", async () => {
	const trigger = "[data-slot=composer] [data-control=reasoning]";
	const before = await page.getAttribute(trigger, "data-value");
	const wanted = before === "high" ? "low" : "high";
	await page.focus(trigger);
	await page.keyboard.press("Enter");
	await sees("[role=menu] [role=menuitemradio][aria-checked=true]");
	// The first letter goes to the level, Enter chooses it.
	await page.keyboard.press(wanted[0]);
	await page.waitForFunction((v: string) => document.activeElement?.getAttribute("role") === "menuitemradio" && document.activeElement.textContent?.startsWith(v), wanted);
	await page.keyboard.press("Enter");
	await page.waitForSelector("[role=menu]", { state: "detached" });
	await sees(`${trigger}[data-value=${wanted}]`);
	assert.equal(await page.evaluate((s: string) => document.activeElement === document.querySelector(s), trigger), true);
	// The agent keeps it: pine wrote it into the agent's own settings.
	await until("the agent's reasoning is kept by pine", () => read("agents", "main", "agent.json").thinking === wanted);
});

test("an empty composer's send button says there is nothing to send, and a click on it sends nothing", async () => {
	await page.fill("[data-slot=composer] textarea", "");
	const send = page.locator("[data-slot=composer] [data-action=send]");
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
	await putAwayToasts();
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "sent by the button" }], "click to send "));
	await page.click("[data-slot=composer] [data-action=send]");
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
	assert.ok(popped.menus.length > 1, `the app's menus are in it: ${JSON.stringify(popped.menus)}`);
	assert.ok(Number.isFinite(popped.x) && Number.isFinite(popped.y), "the menu is opened at a place in the window");
});

test("off a Mac the window's controls follow the page when it is zoomed in and out", { skip: process.platform === "darwin" && "a Mac's buttons lie beside the bar, at a height of their own" }, async () => {
	// A zoom step is a menu item, found by its key: what it is called is the menu's to say.
	const KEYS = { in: "CmdOrCtrl+Plus", out: "CmdOrCtrl+-", reset: "CmdOrCtrl+0" };
	const zoom = (key: string) =>
		app.evaluate(({ Menu }: any, k: string) => {
			const all = (list: any[]): any[] => list.flatMap((i) => [i, ...(i.submenu ? all(i.submenu.items) : [])]);
			const found = all(Menu.getApplicationMenu().items).find((i) => i.accelerator === k);
			if (!found) throw new Error(`no menu item has the key ${k}`);
			found.click();
		}, key);
	// What the window is told about its controls is noted: under the viewport these tests set, the page's own account of
	// them (navigator.windowControlsOverlay) no longer follows the window.
	await app.evaluate(({ BrowserWindow }: any) => {
		const w = BrowserWindow.getAllWindows()[0];
		const own = w.setTitleBarOverlay.bind(w);
		(globalThis as any).overlay = undefined;
		w.setTitleBarOverlay = (o: any) => (((globalThis as any).overlay = o), own(o));
	});
	try {
		// At each step the window is told anew how tall its controls are, and that follows the zoom: a page
		// zoomed further in never has lower controls. (How tall that is in pixels is the design's to say.)
		const told: Array<{ step: string; height: number; zoom: number }> = [];
		for (const step of ["in", "in", "out", "out", "out", "reset"] as const) {
			await app.evaluate(() => ((globalThis as any).overlay = undefined));
			await zoom(KEYS[step]);
			await until(`after zooming ${step} the window was told about its controls`, () => app.evaluate(() => Boolean((globalThis as any).overlay)));
			told.push({ step, ...(await app.evaluate(({ BrowserWindow }: any) => ({ height: (globalThis as any).overlay.height as number, zoom: BrowserWindow.getAllWindows()[0].webContents.getZoomFactor() as number }))) });
		}
		for (const a of told) for (const b of told) if (a.zoom < b.zoom) assert.ok(a.height < b.height, `the controls do not follow the zoom: ${JSON.stringify(told)}`);
		assert.ok(new Set(told.map((t) => t.zoom)).size > 1, `the page was not zoomed: ${JSON.stringify(told)}`);
	} finally {
		await zoom(KEYS.reset);
		await app.evaluate(({ BrowserWindow }: any) => delete BrowserWindow.getAllWindows()[0].setTitleBarOverlay);
	}
});

test("no key in the menus does two things, and the window closes as on a Mac: by its own button, ⌘W/Ctrl+W being Close Tab", async () => {
	// Every item with a key: what it is called (for the message of a failure only), and its role where it is one of the system's own.
	const items: Array<{ label: string; role?: string; key: string }> = await app.evaluate(({ Menu }: any) => {
		const out: Array<{ label: string; role?: string; key: string }> = [];
		const walk = (list: any[]) => {
			for (const i of list) {
				const key = i.accelerator ?? i.getDefaultRoleAccelerator?.();
				if (key) out.push({ label: i.label || i.role, role: i.role ? String(i.role).toLowerCase() : undefined, key: String(key) });
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
	const owners = new Map<string, typeof items>();
	for (const i of items) owners.set(as(i.key), [...(owners.get(as(i.key)) ?? []), i]);
	// The system's own Redo and pine's taking back of the last message share ⇧⌘Z on a Mac too: that is left as it is there.
	const twice = [...owners].filter(([key, who]) => who.length > 1 && !(key === as("Shift+CmdOrCtrl+Z") && who.length === 2 && who.filter((i) => i.role === "redo").length === 1)).map(([key, who]) => [key, who.map((i) => i.label)]);
	assert.deepEqual(twice, [], `keys that do two things: ${JSON.stringify(twice)}`);
	// ⌘W/Ctrl+W is one item of pine's own (it closes the tab in front), and no item is the system's "close the window".
	const closes = owners.get(as("CmdOrCtrl+W")) ?? [];
	assert.equal(closes.length, 1, JSON.stringify(closes));
	assert.equal(closes[0].role, undefined, "⌘W is the system's own item, which closes the window");
	assert.ok(!items.some((i) => i.role === "close"), "a menu item closes the window");
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
	// The bar is a popover for the words it is about, and it does not take the focus.
	await sees("[data-slot=popover-content] [data-slot=selection-toolbar]");
	assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest("[data-slot=selection-toolbar], [data-slot=popover-content]"))), false, "the bar took the focus");
	await page.click("[data-slot=selection-toolbar] [data-action=quote]");
	await sees("[data-slot=composer] [data-slot=quote-chip] >> text=old copy of the lockfile");
	assert.equal(await page.$("[data-slot=selection-toolbar]"), null);
	// A click on the badge above the input goes back to the answer.
	await page.click("[data-slot=composer] [data-slot=quote-chip] [data-action=open]");
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
	await sent.locator("[data-slot=quote-chip] [data-action=open]").click();
	await lit();
	await unlit();
	// Taken back, the quote is a badge above the input again and the rest is in the input, and the badge still finds its answer.
	await menu("undo");
	await sees("[data-slot=marker][data-kind=undo]");
	await sees("[data-slot=composer] [data-slot=quote-chip] >> text=old copy of the lockfile");
	assert.match(await page.inputValue("[data-slot=composer] textarea"), /^why is that\? /);
	await page.click("[data-slot=composer] [data-slot=quote-chip] [data-action=open]");
	await page.waitForFunction(() => [...document.querySelectorAll("[data-item=answer]")].some((e) => e.textContent!.includes("QUOTE-SOURCE") && (e.closest("[data-message-id]")?.getAnimations().length ?? 0) > 0));
	await page.click("[data-slot=composer] [data-slot=quote-chip] [data-action=remove]");
	await page.waitForSelector("[data-slot=composer] [data-slot=quote-chip]", { state: "detached" });
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
	await sees("[data-slot=composer] [data-action=stop]");
	await settled();
	const before = await page.$$eval("[data-item=user]", (els: Element[]) => els.length);
	await page.evaluate(() => {
		const answer = [...document.querySelectorAll("[data-item=answer] [data-slot=markdown]")].find((e) => e.textContent!.includes("LONG-QUOTE"))!;
		const range = document.createRange();
		range.selectNodeContents(answer);
		window.getSelection()!.removeAllRanges();
		window.getSelection()!.addRange(range);
	});
	await sees("[data-slot=selection-toolbar] [data-action=quote]");
	await page.click("[data-slot=selection-toolbar] [data-action=quote]");
	await sees("[data-slot=composer] [data-slot=quote-chip] >> text=LONG-QUOTE");
	await page.fill("[data-slot=composer] textarea", "and that? ");
	await page.press("[data-slot=composer] textarea", "Enter");
	// Its line says whether the work has read it: the app knew the steered message for its own.
	await sees("[data-item=user]:has([data-slot=quote-chip]) [data-slot=steer]");
	go = true;
	await sees("[data-slot=markdown] >> text=LONG-QUOTE-HELD-DONE");
	// Shown once, and as the owner's own: not a second time as a message that came from another place.
	assert.equal(await page.$$eval("[data-item=user]", (els: Element[]) => els.length), before + 1);
	assert.equal(await page.$("[data-item=user][data-from]"), null);
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
	assert.deepEqual(await md.locator("[data-remote]").evaluateAll((els: Element[]) => els.map((e) => e.getAttribute("data-remote"))), ["https://example.com/cat.png", "https://example.com/dog.png"]);
	assert.match(await md.locator("[data-remote]").first().textContent(), /https:\/\/example\.com\/cat\.png/, "the line says the address it would load");
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
	assert.match(await md.locator("[data-target]").textContent(), /example\.com\/docs/, "a link's address is written out beside it");
	// A table is shadcn's, and scrolls by itself.
	assert.equal(await md.locator("[data-slot=scroll-area-viewport] [data-slot=table]").count(), 1);
	assert.equal(await md.getByRole("cell").count(), 2);
	// A footnote's number and its note are words alone: no address of a place in the page (the ids a
	// renderer gives them start with "user-content"), and no heading that only screen readers were meant to get.
	assert.doesNotMatch(await md.innerHTML(), /user-content/);
	assert.equal(await md.locator("[data-footnotes]").getByRole("heading").count(), 0);
	assert.equal(await md.locator("[data-footnotes]").getByRole("listitem").count(), 1);
	// A task keeps whether it is done, as a box that cannot be changed, where CLEAN takes every input away.
	assert.deepEqual(await md.locator("li[data-task] [data-slot=checkbox]").evaluateAll((boxes: HTMLElement[]) => boxes.map((b) => b.getAttribute("aria-checked"))), ["true", "false"]);
	// A heading is a heading; a key in a quote is shadcn's Kbd, and its bold is bold.
	assert.equal(await md.getByRole("heading", { name: "A heading" }).count(), 1);
	assert.equal(await md.locator("blockquote [data-slot=kbd]").count(), 1);
	assert.equal(await md.locator("blockquote strong").count(), 1);
	// An item's two paragraphs stay two.
	const item = md.getByRole("listitem").filter({ hasText: "an item" }).first();
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
	// When it has ended, the conversation is told, in a message of pine's that holds the command and its output
	// (what the block printed, which the answer itself never held), and the agent goes on.
	const reported = () => mock.state.requests.find((r: any) => JSON.stringify(r.body.messages.at(-1)).includes("pine-ran-42"));
	await until("the agent was told how the command went", reported);
	const told = JSON.stringify(reported().body.messages.at(-1));
	assert.ok(told.includes("echo pine-ran-$((6*7))"), told);
	// In the conversation it is pine's note, with the command it reports: no message of the owner's.
	const pineNote = async () => {
		await sees("[data-pine]:has-text('echo pine-ran-$((6*7))')");
		assert.equal(await page.locator("[data-item=user]", { hasText: "pine-ran-42" }).count(), 0, "what pine told the agent is shown as the owner's message");
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
	// It is refused with the character named (U+202E), and a command typed after it finds the terminal without it.
	await putAwayToasts();
	await md.locator("[data-run]").nth(1).click();
	await sees("[data-slot=toast] >> text=U+202E");
	await page.click("[data-slot=terminal]");
	await page.keyboard.type("echo after-$((2+2))");
	await page.keyboard.press("Enter");
	await terminalShows("after-4");
	assert.doesNotMatch(await terminalText(), /hidden-ran/);
	// Another view of the panel and back: the same shell, with what it printed.
	await menu("code-agent");
	await page.waitForSelector("[data-slot=terminal]", { state: "detached" });
	await menu("code-terminal");
	await terminalShows("after-4");
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
	const box = "[data-part=thought] [data-part=thought-text]";
	await sees(`${box} >> text=thinking line 60`);
	// Sixty lines are more than the box shows at once: it scrolls, and stands at its end.
	await page.waitForFunction((s: string) => { const el = document.querySelector(s); return Boolean(el && el.scrollHeight > el.clientHeight && el.scrollHeight - el.scrollTop - el.clientHeight < 2); }, box, { timeout: 10_000 });
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
	// Its bars are the sound's levels, one for each range of pitch: a single tone lifts some of them far above
	// the others. (Which bar a pitch belongs to is levels.ts's, tested with it.) Where nothing plays they lie flat.
	const bars = (n: number) => lines.nth(n).locator("[data-slot=sound-bars] [data-level]").evaluateAll((all: HTMLElement[]) => all.map((b) => Number(b.dataset.level)));
	const flat = (levels: number[]) => levels.length > 1 && new Set(levels).size === 1;
	await page.waitForFunction((s: string) => new Set([...document.querySelectorAll(`${s}[data-sound=playing] [data-slot=sound-bars] [data-level]`)].map((b) => (b as HTMLElement).dataset.level)).size > 1, SOUND, { timeout: 20_000 });
	assert.ok(flat(await bars(1)), `the bars of a sound that does not play lie flat: ${await bars(1)}`);
	// The player's own clock runs, and knows how long the sound is (the tone is twenty seconds).
	const at = (n: number) => lines.nth(n).getAttribute("data-at").then(Number);
	await page.waitForFunction((s: string) => Number(document.querySelector(s)?.getAttribute("data-at")) >= 1, SOUND, { timeout: 20_000 });
	assert.equal(await lines.nth(0).getAttribute("data-length"), "20");
	// A click pauses: the clock stands still, and the bars stay where the sound stopped.
	await lines.nth(0).locator("[data-action=pause]").click();
	await sees(`${SOUND}[data-sound=paused]`);
	const stood = await lines.nth(0).locator("[data-slot=sound-time]").textContent();
	await new Promise((r) => setTimeout(r, 300));
	assert.equal(await lines.nth(0).locator("[data-slot=sound-time]").textContent(), stood);
	assert.ok(!flat(await bars(0)), "a paused sound keeps its bars");
	// And goes on from there with another click.
	await lines.nth(0).locator("[data-action=play]").click();
	await sees(`${SOUND}[data-sound=playing]`);
	// One sound at a time: starting the other one stops this one, which is back at its start.
	await lines.nth(1).locator("[data-action=play]").click();
	await page.waitForFunction((s: string) => [...document.querySelectorAll(s)].map((l) => l.getAttribute("data-sound")).join() === "idle,playing", SOUND);
	assert.equal(await at(0), 0);
	assert.ok(flat(await bars(0)), `the bars of a sound that was stopped lie flat: ${await bars(0)}`);
	await shot("02c-sound");
	// It goes on while another tab is in front, and its line finds it again: still playing, further on.
	const front = await page.evaluate(() => [...document.querySelectorAll("[data-slot=tab]")].findIndex((t) => t.hasAttribute("data-active")));
	await menu("events");
	await page.waitForFunction((s: string) => !document.querySelector(s), SOUND);
	await menu("close");
	await page.click(`[data-slot=tab] >> nth=${front}`);
	await page.waitForFunction((s: string) => [...document.querySelectorAll(s)].map((l) => l.getAttribute("data-sound")).join() === "idle,playing", SOUND);
	await page.waitForFunction((s: string) => Number(document.querySelectorAll(s)[1]?.getAttribute("data-at")) >= 1, SOUND, { timeout: 20_000 });
	await page.waitForFunction((s: string) => new Set([...document.querySelectorAll(s)[1].querySelectorAll("[data-slot=sound-bars] [data-level]")].map((b) => (b as HTMLElement).dataset.level)).size > 1, SOUND, { timeout: 20_000 });
	await lines.nth(1).locator("[data-action=pause]").click();
	// The conversation opened again: the sounds are there, their lengths known, and none of them starts.
	await page.reload();
	await sees(SOUND);
	await page.waitForFunction((s: string) => [...document.querySelectorAll(s)].filter((l) => l.getAttribute("data-length") === "20").length === 2, SOUND);
	await new Promise((r) => setTimeout(r, 300));
	assert.equal(await page.locator(`${SOUND}:not([data-sound=idle])`).count(), 0);
});

test("an approval is asked in a dialog and answered from it; a question is a card above the composer", async () => {
	// The owner listed bash under "approve": it asks in every mode.
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "bash", args: { command: "echo hello" } }] }, { tools: [{ name: "question", args: { question: "Which database?", header: "Database", options: [{ label: "the old one", description: "Nothing to move" }, { label: "the new one", description: "Faster, after a migration" }] } }] }, { text: "done" }], "run it "));
	await page.keyboard.press("Enter");
	// It is asked for the tool, with the command it would run.
	await sees(`${APPROVAL}[data-tool=bash]:not([data-inputs])`);
	assert.match(await page.textContent(APPROVAL), /echo hello/);
	await shot("03-approval");
	// What is at work is a dot that pulses, announced as a status: here the line of the turn's work and the line
	// under the conversation (its tab and its row say ! instead). No spinner turns anywhere.
	const working = await page.locator("[data-slot=conversation] [data-slot=pulse][role=status]").count();
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
	await page.click(`${APPROVAL} [data-action=allow]`);
	await sees('[data-item="approval"][data-state="allowed"]');
	// Then the agent asks something: a card inline above the composer, and no dialog opens by itself.
	const card = "[data-slot=composer-question] [data-slot=questionnaire]";
	await sees(card);
	assert.equal(await page.locator(DIALOG).count(), 0, "no dialog opens for a question");
	// The card holds all the agent wrote: the question, its header, each option with what it means.
	const shown = await page.textContent(card);
	for (const said of ["Which database?", "Database", "the old one", "Nothing to move", "the new one", "Faster, after a migration"]) assert.ok(shown.includes(said), `the card lacks "${said}": ${shown}`);
	await shot("03-question");
	// The composer was empty: the card has the keyboard; a digit picks, and Enter sends the pick as the owner's message.
	await page.waitForFunction(() => document.activeElement?.closest("[data-slot=composer-question] [data-slot=questionnaire]"), null, { timeout: 5000 });
	await page.keyboard.press("2");
	await page.keyboard.press("Enter");
	await page.waitForSelector(card, { state: "detached" });
	await sees('[data-item="user"] >> text=the new one');
	// The question returned at once, and the turn ended without the answer; the answer is the next turn's message.
	await sees("[data-slot=markdown] >> text=done");
	assert.ok(mock.state.requests.some((q: any) => q.body.messages.some((m: any) => m.role === "tool" && String(m.content).startsWith("Asked."))), "the question returned at once");
	for (let i = 0; i < 100 && !mock.state.requests.some((q: any) => q.body.messages.at(-1)?.role === "user" && JSON.stringify(q.body.messages.at(-1)).includes("the new one")); i++) await new Promise((r) => setTimeout(r, 100));
	assert.ok(mock.state.requests.some((q: any) => q.body.messages.at(-1)?.role === "user" && JSON.stringify(q.body.messages.at(-1)).includes("the new one")), "the answer starts a turn of its own");
	await page.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 10_000 });
});

test("a value only the owner has, left empty, is marked as missing in the approval and nothing is allowed", { skip: process.platform === "win32" && "a local MCP server needs a sandbox, and Windows has none of pine's" }, async () => {
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "add_mcp_server", args: { name: "keyed", command: "npx -y example-mcp", secrets: ["EXAMPLE_KEY"] } }] }, { text: "not added then" }], "add a server with a key "));
	await page.keyboard.press("Enter");
	const asked = `${APPROVAL}[data-inputs]`;
	await sees(asked);
	const field = page.locator(asked).locator("[data-slot=field]", { has: page.locator("#ap-EXAMPLE_KEY") });
	assert.equal(await field.getAttribute("data-invalid"), null, "not marked before the owner tried to allow it");
	await page.click(`${asked} [data-action=allow]`);
	await sees(`${asked} [data-slot=field][data-invalid] #ap-EXAMPLE_KEY[aria-invalid=true]`);
	assert.equal(await page.evaluate(() => document.activeElement?.id), "ap-EXAMPLE_KEY");
	// A value typed there takes the mark away again.
	await page.locator("#ap-EXAMPLE_KEY").fill("a-key");
	assert.equal(await field.getAttribute("data-invalid"), null);
	await page.click(`${asked} [data-action=deny]`);
	await page.waitForSelector(DIALOG, { state: "detached" });
	await sees("[data-slot=markdown] >> text=not added then");
	// Nothing was allowed: pine's configuration has no such server.
	assert.equal(read("pine.json").mcp?.keyed, undefined);
	assert.equal(read("agents", "main", "agent.json").mcp?.keyed, undefined);
});

test("an approval put off is answered from the conversation by its buttons", async () => {
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "bash", args: { command: "echo again" } }] }, { text: "allowed from the line" }], "ask in line "));
	await page.keyboard.press("Enter");
	// The dialog is put off ("Later"); the request stays in the conversation, with what it is and why.
	await sees(APPROVAL);
	await page.keyboard.press("Escape");
	await page.waitForSelector(DIALOG, { state: "detached" });
	const asked = '[data-item="approval"][data-state="open"]';
	await sees(asked);
	assert.match(await page.textContent(asked), /echo again/);
	await shot("03-confirmation");
	await page.click(`${asked} [data-action=allow]`);
	// Allowed, it is a line that still says for which tool and which command.
	await sees('[data-item="approval"][data-state="allowed"]:has-text("echo again")');
	assert.match(await page.textContent('[data-item="approval"][data-state="allowed"]:has-text("echo again")'), /bash/);
	await sees("[data-slot=markdown] >> text=allowed from the line");
	// The call the approval was for ended after its card closed the group it stood in: it is drawn as ended, and
	// nothing in the window pulses once the agent is idle.
	await page.waitForFunction(() => !document.querySelector("[data-slot=pulse]"), null, { timeout: 5000 }).catch(async () => {
		throw new Error(`still pulsing: ${await page.locator("[data-slot=pulse]").evaluateAll((els) => els.map((el) => el.parentElement?.textContent?.slice(0, 80)).join(" | "))}`);
	});
});

/** The open questions' card above the composer of the conversation in front. */
const QUESTIONS = "[data-slot=composer-question] [data-slot=questionnaire]";
/** A `question` call of the agent's, with a few options. */
const asks = (question: string, labels = ["yes", "no"], extra: Record<string, unknown> = {}) => ({ name: "question", args: { question, options: labels.map((label) => ({ label })), ...extra } });
/** Whether the model was given a message of the owner's that says `text`: the start of a turn of its own. */
const heard = (text: string) => mock.state.requests.some((q: any) => {
	const last = q.body.messages.at(-1);
	return last?.role === "user" && JSON.stringify(last.content).includes(JSON.stringify(text).slice(1, -1));
});
/** The model was given that message, and the turn it started is over (a message sent meanwhile would be given to it instead). */
const hears = async (text: string) => {
	for (let i = 0; i < 100 && !heard(text); i++) await new Promise((r) => setTimeout(r, 100));
	assert.ok(heard(text), `the model was not given ${JSON.stringify(text)}`);
	await page.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 10_000 });
};
/** The text of the owner's last message in the conversation in front. */
const lastOwner = () => page.$$eval('[data-item="user"] [data-slot=bubble-content]', (els: Element[]) => els.at(-1)?.textContent ?? "");
/** The turn's questions in the thread, as they stand: open, folded or closed. */
const asked = (state: string) => `[data-item="questions"][data-state="${state}"]`;
/** The card's buttons, by their stock slot. */
const button = (slot: "previous" | "next" | "skip" | "submit") => page.locator(`${QUESTIONS} [data-slot=questionnaire-${slot}]`);
/** The card's progress stands at question `n`. */
const at = (n: number) => page.waitForFunction(([s, n]: string[]) => document.querySelector(s)?.getAttribute("aria-valuenow") === n, [`${QUESTIONS} [data-slot=questionnaire-progress]`, String(n)]);

test("the questions of a turn are one card: Next, Previous and Skip, and where it stands; Send posts one message of the owner's, a line per question answered, the skipped left out", async () => {
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [asks("Which side?"), asks("Which end?", ["top", "bottom"]), { name: "question", args: { question: "Anything else?" } }] }, { text: "asked three" }], "ask three "));
	await page.keyboard.press("Enter");
	// The question returns at once: the turn goes on and ends, and the card stays.
	await sees("[data-slot=markdown] >> text=asked three");
	await sees(QUESTIONS);
	const progress = page.locator(`${QUESTIONS} [data-slot=questionnaire-progress]`);
	assert.equal(await progress.getAttribute("aria-valuenow"), "1");
	assert.equal(await progress.getAttribute("aria-valuemax"), "3");
	// The thread says each in one line while the card shows them.
	assert.equal(await page.locator(`${asked("open")} [data-slot=trace-line]`).count(), 3);
	await shot("03-questions");
	await page.locator(QUESTIONS).getByRole("radio", { name: /yes/ }).click();
	await button("next").click();
	await at(2);
	// Previous goes back to the first, its pick kept.
	await button("previous").click();
	await at(1);
	assert.ok(await page.locator(QUESTIONS).getByRole("radio", { name: /yes/ }).isChecked());
	await button("next").click();
	await page.locator(QUESTIONS).getByRole("radio", { name: /bottom/ }).click();
	await button("next").click();
	// The last has no options: it says to answer by typing, and Skip sends what was picked.
	await at(3);
	assert.equal(await page.locator(`${QUESTIONS} [data-slot=questionnaire-item]:not([hidden]) [data-slot=questionnaire-choice]`).count(), 0);
	await button("skip").click();
	await page.waitForSelector(QUESTIONS, { state: "detached" });
	assert.equal(await lastOwner(), "Which side? yes\nWhich end? bottom");
	await hears("Which side? yes\nWhich end? bottom");
	// Answered, the questions are one line each, followed by the owner's message.
	await sees(asked("closed"));
	const order = await page.$$eval('[data-item="questions"], [data-item="user"]', (els: Element[]) => els.slice(-2).map((e) => e.getAttribute("data-item")));
	assert.deepEqual(order, ["questions", "user"]);
	// A question alone says nothing of where it stands, and has no Skip.
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [asks("Alone?", ["just this", "not this"])] }, { text: "asked one" }], "ask one "));
	await page.keyboard.press("Enter");
	await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Alone?"), QUESTIONS, { timeout: 10_000 });
	assert.equal(await page.locator(`${QUESTIONS} [data-slot=questionnaire-progress]`).count(), 0);
	assert.ok(await button("skip").isHidden());
	await page.locator(QUESTIONS).getByRole("radio", { name: /not this/ }).click();
	await button("submit").click();
	await page.waitForSelector(QUESTIONS, { state: "detached" });
	assert.equal(await lastOwner(), "not this");
	await hears("not this");
});

test("a question is answered by a pick, a digit or the arrows, sent with Send or Enter; ticks go as one message", async () => {
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [asks("Which color?", ["green", "blue", "red"])] }, { text: "color asked" }], "ask a color "));
	await page.keyboard.press("Enter");
	await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Which color?"), QUESTIONS, { timeout: 10_000 });
	// The first option is the one the agent would pick.
	assert.equal(await page.locator(`${QUESTIONS} [data-slot=questionnaire-choice]`).first().locator("[data-slot=badge]").count(), 1);
	// A click only picks, and the pick can change before it goes.
	const send = button("submit");
	assert.ok(await send.isDisabled(), "nothing picked, nothing to send");
	await page.locator(QUESTIONS).getByRole("radio", { name: /red/ }).click();
	await page.locator(QUESTIONS).getByRole("radio", { name: /blue/ }).click();
	// A digit picks too, the arrows move the pick, and Enter sends it.
	await page.keyboard.press("1");
	assert.ok(await page.locator(QUESTIONS).getByRole("radio", { name: /green/ }).isChecked());
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Enter");
	await page.waitForSelector(QUESTIONS, { state: "detached" });
	assert.equal(await lastOwner(), "red");
	await hears("red");
	// Several may be ticked, by a click and by a digit: one message, the labels joined.
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [asks("Which colors?", ["green", "blue", "red"], { multiSelect: true })] }, { text: "colors asked" }], "ask colors "));
	await page.keyboard.press("Enter");
	await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Which colors?"), QUESTIONS, { timeout: 10_000 });
	assert.equal(await page.locator(`${QUESTIONS} [data-slot=badge]`).count(), 0, "no option is the recommended one when several may be picked");
	await page.locator(QUESTIONS).getByRole("checkbox", { name: /green/ }).click();
	await page.keyboard.press("3");
	await button("submit").click();
	await page.waitForSelector(QUESTIONS, { state: "detached" });
	assert.equal(await lastOwner(), "green, red");
	await hears("green, red");
});

test("the questions' card goes on a typed message and on the agent's next turn, comes back when the conversation is opened again, and folds away by the card's own button and back by the line in its place", async () => {
	const field = "[data-slot=composer] textarea";
	await page.fill(field, mockMsg([{ tools: [asks("Which bin?", ["blue", "green"])] }, { text: "bin asked" }], "ask a bin "));
	await page.keyboard.press("Enter");
	await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Which bin?"), QUESTIONS, { timeout: 10_000 });
	await sees("[data-slot=markdown] >> text=bin asked");
	// The tab says that it waits for the owner.
	await sees("[data-slot=tab][data-active] [data-slot=badge][data-variant=destructive]");
	// The card's own button folds it away, and the thread then shows the question in full, read only; a line in
	// the card's place brings it back. Neither is on the composer, where it would lie over the card's actions.
	const toggle = page.locator("[data-question-toggle]");
	assert.equal(await toggle.getAttribute("aria-expanded"), "true");
	assert.equal(await page.locator(`${QUESTIONS} [data-question-toggle]`).count(), 1, "in the card");
	assert.equal(await page.locator("[data-slot=composer] [data-question-toggle]").count(), 0);
	assert.equal(await page.locator(asked("open")).count(), 1);
	await toggle.click();
	await page.waitForSelector(QUESTIONS, { state: "detached" });
	await sees(asked("folded"));
	assert.match(await page.textContent(asked("folded")), /Which bin\?[\s\S]*blue[\s\S]*green/);
	assert.equal(await page.locator(`${asked("folded")} input`).count(), 0, "read only");
	assert.equal(await toggle.getAttribute("aria-expanded"), "false");
	assert.equal(await page.locator("[data-slot=composer] [data-question-toggle]").count(), 0);
	await toggle.click();
	await sees(QUESTIONS);
	await sees(asked("open"));
	// The conversation opened again (the page drawn anew) shows the card again, from the turn's record.
	await page.reload();
	await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Which bin?"), QUESTIONS, { timeout: 20_000 });
	// What is typed while it is open is an ordinary message, and the card goes.
	await page.click(field);
	await page.keyboard.type("never mind the bins");
	await page.keyboard.press("Enter");
	await page.waitForSelector(QUESTIONS, { state: "detached" });
	await sees(asked("closed"));
	await hears("never mind the bins");
	await page.waitForFunction(() => !document.querySelector("[data-slot=tab][data-active] [data-slot=badge][data-variant=destructive]"), null, { timeout: 10_000 });
	// Asked again, and then the agent's next turn begins without the owner's word (a message from another UI): the card goes.
	await page.fill(field, mockMsg([{ tools: [asks("Which lid?", ["round", "square"])] }, { text: "lid asked" }], "ask a lid "));
	await page.keyboard.press("Enter");
	await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Which lid?"), QUESTIONS, { timeout: 10_000 });
	await sees("[data-slot=markdown] >> text=lid asked");
	const started = await api("POST", "/agents/main/prompt", { prompt: "a word from elsewhere", session: "main", wait: false });
	assert.ok(started.ok, JSON.stringify(started));
	await page.waitForSelector(QUESTIONS, { state: "detached", timeout: 10_000 });
	await hears("a word from elsewhere");
});

test("a message steered into the work before the agent asks leaves the card open, also when the conversation is opened again; one steered in after it closes it", async () => {
	const field = "[data-slot=composer] textarea";
	// Before: the owner writes while the work is at the model, and the agent asks after that.
	let go = false;
	mock.state.scripts.road = [{ tools: [asks("Which road?", ["north", "south"])], until: () => go }, { text: "road asked" }];
	await page.fill(field, "@@REF:road@@ take me home ");
	await page.keyboard.press("Enter");
	await sees("[data-slot=composer] [aria-label=Stop]");
	await page.fill(field, "the quick way please");
	await page.keyboard.press("Enter");
	await sees("[data-item=user] >> text=/not read yet|read \\d/");
	go = true;
	await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Which road?"), QUESTIONS, { timeout: 10_000 });
	// The work answers the steered message after it asked (the scripted model echoes it).
	await sees("[data-slot=markdown] >> text=ECHO[the quick way please]");
	await page.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 10_000 });
	await sees(QUESTIONS);
	await page.reload();
	await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Which road?"), QUESTIONS, { timeout: 20_000 });
	await page.click(field);
	await page.keyboard.type("north it is");
	await page.keyboard.press("Enter");
	await page.waitForSelector(QUESTIONS, { state: "detached" });
	await hears("north it is");
	// After: the agent asks, and the owner writes while the turn still works.
	let end = false;
	mock.state.scripts.lane = [{ tools: [asks("Which lane?", ["left", "right"])] }, { text: "lane asked", until: () => end }];
	await page.fill(field, "@@REF:lane@@ and the lane ");
	await page.keyboard.press("Enter");
	await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Which lane?"), QUESTIONS, { timeout: 10_000 });
	await page.click(field);
	await page.keyboard.type("the left one");
	await page.keyboard.press("Enter");
	await page.waitForSelector(QUESTIONS, { state: "detached" });
	end = true;
	await sees("[data-slot=markdown] >> text=ECHO[the left one]");
	await page.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 10_000 });
	await page.reload();
	await sees("[data-slot=markdown] >> text=ECHO[the left one]");
	await sees(asked("closed"));
	assert.equal(await page.locator(QUESTIONS).count(), 0, "a message that came after the question answered it");
});

test("a question asked after a message was steered into the turn is open alone: the one asked before the message is answered, live and when the conversation is opened again", async () => {
	const field = "[data-slot=composer] textarea";
	let go = false;
	mock.state.scripts.paint = [{ tools: [asks("Which colour?", ["red", "blue"])] }, { tools: [asks("Which size?", ["small", "large"])], until: () => go }, { text: "paint asked" }];
	await page.fill(field, "@@REF:paint@@ paint the shed ");
	await page.keyboard.press("Enter");
	await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Which colour?"), QUESTIONS, { timeout: 10_000 });
	// The owner writes into the running turn, which then asks again.
	await page.click(field);
	await page.keyboard.type("any colour will do");
	await page.keyboard.press("Enter");
	await page.waitForSelector(QUESTIONS, { state: "detached" });
	await sees("[data-item=user] >> text=/not read yet|read \\d/");
	go = true;
	const alone = async () => {
		await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Which size?"), QUESTIONS, { timeout: 20_000 });
		assert.ok(!(await page.textContent(QUESTIONS))?.includes("Which colour?"), "the question asked before the message is not in the card");
		assert.equal(await page.locator(`${QUESTIONS} [data-slot=questionnaire-progress]`).count(), 0, "one question");
	};
	await alone();
	await page.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 10_000 });
	await alone();
	await page.reload();
	await alone();
	await page.click(field);
	await page.keyboard.type("large");
	await page.keyboard.press("Enter");
	await page.waitForSelector(QUESTIONS, { state: "detached" });
	await hears("large");
});

test("with the questions' card turned off in Settings > General, a question shows in full in the thread, with no card and no button; turned on again, its card is back", async () => {
	const field = "[data-slot=composer] textarea";
	const toggle = "[data-question-toggle]";
	const cards = "[data-slot=settings-page] [data-find=question-cards] [role=switch]";
	const prefs = () => JSON.parse(fs.readFileSync(path.join(home, "desktop-data", "prefs.json"), "utf8"));
	await page.fill(field, mockMsg([{ tools: [asks("Which mug?", ["red", "white"])] }, { text: "mug asked" }], "ask a mug "));
	await page.keyboard.press("Enter");
	await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Which mug?"), QUESTIONS, { timeout: 10_000 });
	await sees(toggle);
	await menu("settings");
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=General");
	await sees(`${cards}[aria-checked=true]`);
	await page.click(cards);
	await sees(`${cards}[aria-checked=false]`);
	for (let i = 0; i < 50 && prefs().questionCards !== false; i++) await new Promise((r) => setTimeout(r, 40));
	assert.equal(prefs().questionCards, false);
	await menu("settings");
	await sees(asked("folded"));
	assert.match(await page.textContent(asked("folded")), /Which mug\?[\s\S]*red[\s\S]*white/);
	assert.equal(await page.locator(QUESTIONS).count(), 0);
	assert.equal(await page.locator(toggle).count(), 0);
	// Still open: the tab waits for the owner, and a typed message answers it.
	await sees("[data-slot=tab][data-active] [data-slot=badge][data-variant=destructive]");
	// On again, the open question has its card back.
	await menu("settings");
	await page.click(cards);
	await sees(`${cards}[aria-checked=true]`);
	await menu("settings");
	await sees(QUESTIONS);
	await sees(toggle);
	await page.click(field);
	await page.keyboard.type("the white one");
	await page.keyboard.press("Enter");
	await page.waitForSelector(QUESTIONS, { state: "detached" });
	await hears("the white one");
});

test("the questions' card says quietly that the conversation has read outside content, and only then", async () => {
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [asks("Which tray?")] }, { text: "tray asked" }], "ask a tray "));
	await page.keyboard.press("Enter");
	await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Which tray?"), QUESTIONS, { timeout: 10_000 });
	await sees("[data-slot=markdown] >> text=tray asked");
	assert.equal(await page.locator(`${QUESTIONS} [data-slot=questions-outside]`).count(), 0, "not without the mark");
	// The daemon says the conversation has read outside content (it is told so as an answer of its own).
	await app.evaluate(({ ipcMain }: any) => {
		const g = globalThis as any;
		const call = ipcMain._invokeHandlers.get("pine:call");
		ipcMain.removeHandler("pine:call");
		ipcMain.handle("pine:call", async (e: unknown, method: string, url: string, body?: any) => {
			const out = await call(e, method, url, body);
			if (method === "GET" && url === "/status" && out?.data?.sessions) for (const s of out.data.sessions) if (s.agent === "main" && s.session === "main") s.tainted = "a web page";
			return out;
		});
		g.untaint = () => {
			ipcMain.removeHandler("pine:call");
			ipcMain.handle("pine:call", call);
		};
	});
	try {
		// The page asks again when a turn ends: one that asks again.
		await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [asks("Which shelf?")] }, { text: "shelf asked" }], "ask a shelf "));
		await page.keyboard.press("Enter");
		await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Which shelf?"), QUESTIONS, { timeout: 10_000 });
		await sees(`${QUESTIONS} [data-slot=questions-outside]`);
	} finally {
		await app.evaluate(() => (globalThis as any).untaint());
	}
	// Answered, the turn it starts ends with the daemon's word again: the mark is gone with it.
	await page.locator(QUESTIONS).getByRole("radio", { name: /yes/ }).click();
	await button("submit").click();
	await page.waitForSelector(QUESTIONS, { state: "detached" });
	await hears("yes");
});

test("in a short pane a question card keeps the composer in view and typable: its options scroll inside it, and the thread above still has room", async () => {
	const long = "A line that says at length what this option means, so that three of them take more room than a short pane has to give.";
	const ask = { tools: [{ name: "question", args: { question: "Which plan?", options: [{ label: "small", description: long }, { label: "medium", description: long }, { label: "large", description: long }] } }] };
	await page.fill("[data-slot=composer] textarea", mockMsg([ask, { text: "plan chosen" }], "pick a plan "));
	await page.keyboard.press("Enter");
	const card = "[data-slot=composer-question] [data-slot=questionnaire]";
	await page.waitForFunction((c: string) => document.querySelector(c)?.textContent?.includes("Which plan?"), card, { timeout: 10_000 });
	/** What the pane's layout means for the owner: whether the thread has room, whether the options scroll, whether a click reaches the composer. */
	const measure = () => page.$eval(card, (el: Element) => {
		const pane = el.closest("[data-slot=conversation]")!;
		const field = pane.querySelector("[data-slot=composer] textarea")!;
		const f = field.getBoundingClientRect();
		const options = el.closest("[data-slot=composer-question]")?.querySelector("[data-slot=scroll-area-viewport]");
		const thread = pane.querySelector("[data-slot=message-scroller-viewport]")!;
		return {
			thread: thread.clientHeight,
			options: options ? { scroll: options.scrollHeight, client: options.clientHeight } : null,
			// What a click where one types reaches: the field, not a card laid over it, and not nothing because it lies outside the window.
			hit: document.elementFromPoint(f.x + f.width / 2, f.y + f.height / 2) === field,
		};
	});
	// A tall pane: the options are all there, nothing scrolls.
	const tall = await measure();
	assert.ok(tall.options && tall.options.scroll <= tall.options.client + 1 && tall.hit, `the options scroll in a tall pane: ${JSON.stringify(tall)}`);
	// A short pane: a window less than half as high (how high exactly says nothing; that the card no longer fits does).
	await page.setViewportSize({ width: 1280, height: 360 });
	await page.waitForFunction((c: string) => { const o = document.querySelector(c)?.closest("[data-slot=composer-question]")?.querySelector("[data-slot=scroll-area-viewport]"); return Boolean(o && o.scrollHeight > o.clientHeight); }, card, { timeout: 5000 });
	try {
		const short = await measure();
		await shot("question-short-pane");
		// The composer is still where a click reaches it, the options scroll inside the card, and the thread is still there.
		assert.ok(short.hit, `something lies over the composer, or it is out of the pane: ${JSON.stringify(short)}`);
		assert.ok(short.options && short.options.scroll > short.options.client, `the options do not scroll inside the card: ${JSON.stringify(short)}`);
		assert.ok(short.thread > 0, `the thread has no room left: ${JSON.stringify(short)}`);
		// Keyboard focus on the last option brings it into view inside the card, which scrolls to it.
		const last = () => page.$eval(card, (el: Element) => {
			const viewport = el.closest("[data-slot=composer-question]")!.querySelector("[data-slot=scroll-area-viewport]")!;
			const v = viewport.getBoundingClientRect();
			const o = [...el.querySelectorAll("[data-slot=questionnaire-choice]")].at(-1)!.getBoundingClientRect();
			return { shown: o.bottom > v.top && o.top < v.bottom, top: viewport.scrollTop };
		});
		assert.equal((await last()).shown, false, "the last option is out of view at first");
		await page.locator(card).getByRole("radio", { name: /large/ }).focus();
		await page.waitForFunction((c: string) => (document.querySelector(c)?.closest("[data-slot=composer-question]")?.querySelector("[data-slot=scroll-area-viewport]")?.scrollTop ?? 0) > 0, card, { timeout: 5000 });
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
	await page.locator(card).getByRole("button", { name: "Send" }).click();
	await page.waitForSelector(card, { state: "detached" });
	await sees('[data-item="user"] >> text=medium');
});

test("a sign-in's choices are a question card answered by a pick and Send; what it then asks to be typed opens the approval dialog", async () => {
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
	await sees(`${APPROVAL}[data-tool=sign_in]`);
	await page.click(`${APPROVAL} [data-action=allow]`);
	// The flow's choice is a question card above the composer, with the flow's options (they are the
	// provider's flow's own, so the test reads them rather than knowing them), and no dialog opens.
	const card = "[data-slot=composer-question] [data-slot=questionnaire]";
	await sees(`${card} [data-slot=questionnaire-choice] >> nth=1`);
	assert.equal(await page.locator(APPROVAL).count(), 0, "no dialog opens for a sign-in's choice");
	const offered = (await page.locator(`${card} [data-slot=question-card-label]`).allTextContents()).map((t: string) => t.trim());
	assert.ok(offered.length > 1 && offered.every(Boolean), JSON.stringify(offered));
	// The flow's options are what it offers, not a recommendation of the agent's.
	assert.equal(await page.locator(`${card} [data-recommended]`).count(), 0, "no option of a sign-in is marked recommended");
	// A choice of a sign-in takes no words of the owner's: what is typed below stays a message.
	assert.equal(await page.getAttribute("[data-slot=composer] textarea", "data-above"), null);
	// Both were told while the window was behind, each in words of its own: the sign-in to approve, then the
	// choice to make. The notification goes to the main process after the card is drawn: it is waited for, not read once.
	await until("the approval and the choice were each told in a notification", async () => new Set((await notified()).slice(had)).size >= 2);
	assert.ok((await notified()).slice(had).every((body: string) => body.includes("main")), JSON.stringify(await notified()));
	await focus(true);
	assert.equal(await page.locator('[data-item="approval"][data-state="open"]').count(), 0, "the open choice is not drawn in the conversation as well");
	await shot("03-sign-in-choice");
	// A click picks, Send answers it, and the card folds into a line that says what was picked.
	await page.locator(card).getByRole("radio").first().click();
	await page.click(`${card} [data-action=send]`);
	await page.waitForSelector(card, { state: "detached" });
	await sees(`[data-item="approval"][data-state="allowed"]:has-text("${offered[0]}")`);
	// What the flow asks next is typed: that request has a field, and opens the approval dialog.
	const typed = `${APPROVAL}[data-inputs]`;
	await sees(`${typed} [data-slot=field] input`);
	assert.equal(await page.locator(card).count(), 0);
	await page.click(`${typed} [data-action=deny]`);
	await page.waitForSelector(APPROVAL, { state: "detached" });
	await sees("[data-slot=markdown] >> text=sign-in ended");
	// Nothing was stored: pine holds no sign-in for that provider.
	assert.ok(!fs.existsSync(path.join(home, "auth.json")) || !("amazon-bedrock" in read("auth.json")), "a sign-in that was denied was kept");
	await menu("close");
	await page.waitForFunction((n) => document.querySelectorAll("[data-slot=tab]").length === n, tabs);
});

test("a folder is opened for a conversation: changes, and a file edited and saved", async () => {
	// As the system does it when a folder is dropped on the app's icon.
	await app.evaluate(({ BrowserWindow }: any, dir: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", `folder:${dir}`), folder);
	// With several agents the app asks whose folder it is; the one in front is offered first.
	// (The picker lists the agents: the one in front is marked, and Enter takes it.)
	await confirm(`${DIALOG} [role=option]`);
	// A new conversation of main's is in front, and it works in that folder.
	const inFolder = "[data-slot=tab][data-kind=chat][data-agent=main][data-active]:not([data-session=main])";
	await sees(inFolder);
	await sees(`[data-folder="${folder}"]`);
	folderSession = await page.getAttribute(inFolder, "data-session");
	await page.click(CODE_TOGGLE);
	// The panel opens on the files; its Agent view says who the agent is and what it runs on.
	const view = (name: string) => `[data-slot=code-panel] [data-view=${name}]`;
	await sees(`${view("files")}[aria-selected=true]`);
	await page.click(view("agent"));
	await sees("[data-slot=code-panel] [data-slot=item-title] >> text=main");
	// (What it is for is the first paragraph of the AGENTS.md this home was made with; its model and whom it delegates to are its configuration.)
	const about = await page.textContent("[data-slot=code-panel]");
	for (const said of ["it administers pine", "mock/m", "scout"]) assert.ok(about.includes(said), `the Agent view lacks "${said}": ${about}`);
	// The panel is as wide as it is dragged, by the edge before it, and the keyboard moves that edge too.
	const width = () => page.$eval("[data-slot=code-panel]", (el: Element) => el.getBoundingClientRect().width);
	const was = await width();
	const edge = await page.$eval(CODE_EDGE, (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(edge.x + edge.width / 2, 300);
	await page.mouse.down();
	await page.mouse.move(edge.x + edge.width / 2 - 60, 300, { steps: 4 });
	await page.mouse.up();
	const dragged = await width();
	assert.ok(dragged > was, `dragged wider, the panel is ${dragged} wide, from ${was}`);
	await page.focus(`${CODE_EDGE}[role='separator']`, { timeout: 5000 });
	await page.keyboard.press("ArrowLeft");
	await page.waitForFunction((w) => document.querySelector("[data-slot=code-panel]")!.getBoundingClientRect().width > w, dragged, { timeout: 5000 });
	// Loaded again, it is as it was left: wider than it was before the drag.
	await page.reload();
	await sees(`${TAB("main", folderSession)}[data-active]`);
	if (!(await page.$("[data-slot=code-panel]"))) await page.click(CODE_TOGGLE);
	await sees("[data-slot=code-panel]");
	assert.ok((await width()) > dragged - 1, `after a reload the panel is ${await width()} wide; it was left wider than ${dragged}, from ${was}`);
	await page.click(view("changes"));
	// Its views are a tab list: the arrow keys move the choice, as in any segmented control.
	await sees(`${view("changes")}[aria-selected=true]`);
	await page.keyboard.press("ArrowLeft");
	await sees(`${view("files")}[aria-selected=true]`);
	await page.keyboard.press("ArrowRight");
	await sees(`${view("changes")}[aria-selected=true]`);
	await sees("[data-slot=code-panel] [role=option]");
	assert.match(await page.textContent("[data-slot=code-panel] [role=option]"), /index\.ts/);
	await page.click("[data-slot=code-panel] [role=option]");
	await sees("[data-slot=code-block-line][data-variant=added]");
	assert.match(await page.textContent("[data-slot=code-block-line][data-variant=added]"), /answer = 42/);
	await shot("04-changes");
	// The editor: change the file and save it through the daemon.
	await page.click("[data-slot=code-panel] [data-action=edit]");
	await sees("[data-slot=code-panel] .cm-content");
	await page.click("[data-slot=code-panel] .cm-content");
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.type("export const answer = 43;\n");
	await page.keyboard.press("ControlOrMeta+S");
	await until("the file was saved through the daemon", () => fs.readFileSync(path.join(folder, "src", "index.ts"), "utf8") === "export const answer = 43;\n");
	await shot("05-editor");
	// Leaving what was typed and not saved is asked in the app, by the file's name: staying keeps it, leaving drops it.
	await page.keyboard.type("// draft");
	await page.click(`[data-slot=code-panel] ${BACK}`);
	await sees("[role=alertdialog]:has-text('index.ts')");
	await page.click("[role=alertdialog] [data-slot=alert-dialog-cancel]");
	await page.waitForFunction(() => !document.querySelector("[role=alertdialog]"));
	assert.match(await page.textContent("[data-slot=code-panel] .cm-content"), /\/\/ draft/);
	await page.click(`[data-slot=code-panel] ${BACK}`);
	await page.click("[role=alertdialog] [data-slot=alert-dialog-action]");
	await page.waitForFunction(() => !document.querySelector("[data-slot=code-panel] .cm-editor"));
	assert.equal(fs.readFileSync(path.join(folder, "src", "index.ts"), "utf8"), "export const answer = 43;\n");
});

/** The conversation that was given the owner's folder, for the tests after that one. */
let folderSession = "";
/** The way back from what the side panel has open (a file in the editor, a diff) to its list. */
const BACK = "[data-action=back]";
/** The field that finds a file in the conversation's folder. */
const FIND_FILE = "[data-slot=code-panel] [data-field=find-file]";

const focused = () =>
	page.evaluate(() => {
		const el = document.activeElement as HTMLElement;
		return { role: el.getAttribute("role"), expanded: el.getAttribute("aria-expanded"), text: (el.querySelector("[data-slot=tree-label]") ?? el).textContent ?? "" };
	});

test("a file is opened from the panel's tree, its changes and its search with the keyboard alone", async () => {
	if (!(await page.$("[data-slot=code-panel]"))) await page.click(CODE_TOGGLE);
	const view = (name: string) => `[data-slot=code-panel] [data-view=${name}]`;
	/** Tab, until focus is on something of that role: how many buttons lie on the way is the panel's to say. */
	const tabTo = async (role: string) => {
		for (let i = 0; i < 6 && (await focused()).role !== role; i++) await page.keyboard.press("Tab");
		assert.equal((await focused()).role, role);
	};
	// The test before left a file open in the editor.
	if (await page.$("[data-slot=code-panel] .cm-editor")) await page.click(`[data-slot=code-panel] ${BACK}`);
	await page.click(view("files"));
	await sees("[data-slot=code-panel] [role=tree] [role=treeitem]");
	// From the find field, Tab reaches the tree, past whatever buttons lie between.
	await page.focus(FIND_FILE);
	await tabTo("treeitem");
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
	await page.click(`[data-slot=code-panel] ${BACK}`);
	// The file search's results are a list: Tab reaches it, Enter opens one.
	await page.fill(FIND_FILE, "index");
	await sees("[data-slot=code-panel] [role=listbox] [role=option] >> text=src/index.ts");
	await page.focus(FIND_FILE);
	await tabTo("option");
	await page.keyboard.press("Enter");
	await sees("[data-slot=code-panel] .cm-content");
	await page.click(`[data-slot=code-panel] ${BACK}`);
	await page.fill(FIND_FILE, "");
	// So are the changes: Tab from the refresh button, Enter opens the diff.
	await page.click(view("changes"));
	await sees("[data-slot=code-panel] [role=listbox] [role=option]");
	await page.focus("[data-slot=code-panel] [data-action=refresh]");
	await tabTo("option");
	await page.keyboard.press("Enter");
	await sees("[data-slot=code-panel] [data-slot=code-block]");
	await page.click(`[data-slot=code-panel] ${BACK}`);
	await page.click(view("files"));
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
	const pine = () => read("pine.json");
	/** The dialog's one button that finishes what it is for, and the dialog gone after it. */
	const submit = async () => {
		await page.click(`${DIALOG} [data-action=submit]`);
		await page.waitForSelector(DIALOG, { state: "detached" });
	};
	await menu("settings");
	await sees(`${NAV("general")}[aria-current=page]`);
	// The settings are a tab like any other, beside the conversations.
	await sees("[data-slot=tab][data-kind=settings][data-active]");
	assert.ok((await page.locator("[data-slot=tab][data-kind=chat]").count()) >= 2);
	// A setting is called by a few words, not by its key in pine.json. What only tunes pine is not on the page.
	const label = (await page.locator("[data-setting-key='limits.maxDownloadMb'] [data-slot=field-label]").textContent())?.trim() ?? "";
	assert.ok(label && !/maxDownloadMb/.test(label), `a setting's label is its key: "${label}"`);
	const keys: string[] = await page.$$eval("[data-setting-key]", (els: Element[]) => els.map((e) => e.getAttribute("data-setting-key")!));
	// The limits on how much works at once are there.
	for (const key of ["limits.maxConcurrentRuns", "limits.maxSubagents", "limits.maxPoolTasks", "limits.maxDownloadMb"]) assert.ok(keys.includes(key), `${key} is not on the page: ${keys}`);
	assert.deepEqual(keys.filter((k) => /warmSlots|slotPages|catalogue|maxDelegationDepth/.test(k)), []);
	await shot("06-settings-general");
	// A setting of pine's: checked by the daemon, written into pine.json, in force at once.
	const limit = page.locator("[data-setting-key='limits.maxDownloadMb'] input");
	await limit.fill("123");
	await limit.press("Enter");
	await until("the limit was written into pine.json", () => pine().limits?.maxDownloadMb === 123);
	// One that cannot be is refused, said as an error, and the file stays as it is.
	await putAwayToasts();
	await limit.fill("0");
	await limit.press("Enter");
	await sees("[data-slot=toast][data-type=error]");
	assert.equal(pine().limits.maxDownloadMb, 123);
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
	// (This home's pine.json says "off"; whichever level the arrow lands on is another one.)
	const before = pine().defaults.thinking;
	const highlighted = () => page.getAttribute(`${list} [role=option][data-highlighted]`, "data-value");
	assert.equal(await highlighted(), before);
	await page.keyboard.press("ArrowDown");
	await page.waitForFunction(([l, v]: string[]) => { const at = document.querySelector(`${l} [role=option][data-highlighted]`)?.getAttribute("data-value"); return Boolean(at) && at !== v; }, [list, before]);
	const chosen = await highlighted();
	await page.keyboard.press("Enter");
	await until("the reasoning chosen was written into pine.json", () => pine().defaults.thinking === chosen);
	await backOnIt();
	// Agents: make one.
	await settingsPage("agents");
	await page.click("[data-slot=settings-page] [data-action=new-agent]");
	await page.fill(formField("name"), "books");
	await page.fill(formField("instructions"), "You are books. You keep the books.\n\nYou answer in one line.");
	await page.click(`${DIALOG} [data-action=submit]`);
	// Its conversation opens in a tab, where it is met; the card at its top leads on to its settings.
	await sees(`${TAB("books")}[data-active]`);
	await page.click("[data-slot=agent-settings]");
	await sees("[data-slot=settings-page] [data-slot=settings-title]:has-text('books')");
	assert.ok(fs.existsSync(path.join(home, "agents", "books", "agent.json")));
	// What it is for is the first paragraph of its instructions, and nothing else keeps it.
	assert.equal("description" in read("agents", "books", "agent.json"), false);
	await sees("[data-slot=sidebar-menu-item] >> text=You are books. You keep the books.");
	// It is in the side bar at once, with the others.
	assert.deepEqual(await page.$$eval("[data-slot=agent-label] [data-slot=agent-name]", (els: Element[]) => els.map((e) => e.textContent?.trim())), ["main", "scout", "books"]);
	await shot("07-settings-agent");
	// Events: a schedule.
	await settingsPage("events");
	await page.click("[data-find=schedules] [data-action=new-schedule]");
	await page.fill(formField("when"), "0 7 * * *");
	await page.fill(formField("task"), "Say good morning.");
	await page.fill(formField("name"), "morning");
	await submit();
	await sees("[data-find=schedules] [data-slot=item-title] >> text=morning");
	// It is one for all agents, with the times and the task that were typed.
	const morning = pine().schedules.find((x: { name: string }) => x.name === "morning");
	assert.ok(JSON.stringify(morning).includes("0 7 * * *") && JSON.stringify(morning).includes("Say good morning.") && !morning.agent, JSON.stringify(morning));
	await shot("08-settings-schedules");
	// Events: a route, as When and Then. Only the fields of the action chosen are shown, and only they are sent.
	assert.equal(await page.locator("[data-find=routes] [data-find^='route:']").count(), 0);
	await page.click("[data-find=routes] [data-action=new-route]");
	await page.fill(formField("on"), "source/house/message");
	await page.fill(formField("when"), '{"payload.topic": "house/mode"}');
	await page.fill(formField("prompt"), "left behind under another action");
	await choose("does", "set");
	assert.equal(await page.locator(formField("agent")).count(), 0);
	assert.equal(await page.locator(formField("prompt")).count(), 0);
	await page.fill(formField("set"), '{"house/mode": "{{payload.value}}"}');
	await page.fill(formField("name"), "mode");
	await submit();
	await sees("[data-slot=settings-page] [data-find='route:mode']");
	const route = pine().routes.find((r: { name: string }) => r.name === "mode");
	assert.deepEqual(route, { name: "mode", on: "source/house/message", when: { "payload.topic": "house/mode" }, set: { "house/mode": "{{payload.value}}" } });
	// A route opens from its row with what it does filled in, and is saved in its place.
	await page.click("[data-slot=settings-page] [data-find='route:mode']");
	assert.equal(await page.inputValue(formField("set")), '{"house/mode":"{{payload.value}}"}');
	await page.fill(formField("when"), '{"payload.topic": "house/level"}');
	await submit();
	await sees("[data-slot=settings-page] [data-find='route:mode'] >> text=house/level");
	const routes = pine().routes;
	assert.deepEqual(routes.map((r: { name: string }) => r.name), ["mode"]);
	assert.deepEqual(routes[0].when, { "payload.topic": "house/level" });
	// An agent's own schedule is added on its page, and the Events page points there.
	await settingsPage("agents");
	await page.click("[data-slot=settings-page] [data-slot=item] >> text=books");
	await page.click("[data-find=agent-schedules] [data-action=new-schedule]");
	assert.equal(await page.locator(formField("for")).isDisabled(), true, "it is the agent's");
	await page.fill(formField("when"), "0 9 * * 1");
	await page.fill(formField("task"), "Sum up last week's spending.");
	await page.fill(formField("name"), "weekly");
	await submit();
	await sees("[data-find=agent-schedules] [data-slot=item-title] >> text=weekly");
	assert.equal(read("agents", "books", "agent.json").schedules[0].name, "weekly");
	await settingsPage("events");
	await sees("[data-find=own-sources] [data-slot=item]:has-text('books')");
	assert.equal(await page.locator("[data-find=schedules] [data-slot=item-title]", { hasText: "weekly" }).count(), 0, "not among those for all agents");
	// A decision model at an address of its own (Models), which a route then names.
	await settingsPage("models");
	await page.click("[data-slot=settings-page] [data-action=new-decision]");
	await choose("where", "url");
	await page.fill(formField("url"), "http://127.0.0.1:9");
	await page.fill(formField("model"), "judge-7b");
	await page.fill(formField("name"), "judge");
	await submit();
	await sees("[data-slot=settings-page] [data-find='decision:judge'] >> text=127.0.0.1:9");
	assert.deepEqual(pine().decisions, { judge: { url: "http://127.0.0.1:9", model: "judge-7b" } });
	await settingsPage("events");
	// A decision: one typed question, its options one on each line, answered by the model that was added; what goes into pine.json is pine's own question.
	await page.click("[data-find=routes] [data-action=new-route]");
	await page.fill(formField("on"), "source/inbox/mail");
	await choose("does", "decide");
	await page.fill(formField("decide-question"), "What is it?");
	await choose("decide-type", "choice");
	await page.fill(formField("decide-choices"), "invoice: A bill to pay\nother: Anything else");
	await page.fill(formField("decide-data"), "{{payload.subject}}");
	await choose("decide-by", "judge");
	await page.fill(formField("decide-name"), "kind");
	await page.fill(formField("decide-answer"), "mail/judged");
	await page.fill(formField("name"), "mail-judge");
	await submit();
	await sees("[data-slot=settings-page] [data-find='route:mail-judge']");
	const decision = pine().routes.find((r: { name: string }) => r.name === "mail-judge");
	assert.deepEqual(decision, { name: "mail-judge", on: "source/inbox/mail", ask: { questions: { kind: { type: "choice", question: "What is it?", options: { invoice: "A bill to pay", other: "Anything else" } } }, model: "judge", data: "{{payload.subject}}" }, publish: { topic: "mail/judged" } });
	await shot("08b-settings-routes");
	// Models: sign in to a provider with a key. It is typed into a field of its own and not shown.
	await settingsPage("models");
	// The usual providers are listed; any other is found by searching.
	const providers = "[data-slot=settings-page] [data-find=providers] input";
	await page.fill(providers, "opencode");
	const row = "[data-slot=settings-page] [data-provider=opencode]";
	await page.click(`${row} [data-action=api-key]`);
	await sees(`${DIALOG} input[type=password]`);
	await page.fill(`${DIALOG} input[type=password]`, "sk-test-not-a-real-key-0123456789");
	await page.click(`${DIALOG} [data-action=submit]`);
	await sees(`${DIALOG} [data-slot=alert][data-tone=good]`);
	assert.doesNotMatch(await page.textContent(DIALOG), /sk-test-not-a-real-key/, "the key that was typed is shown");
	await shot("09-settings-sign-in");
	assert.ok("opencode" in read("auth.json"));
	// A sign-in changes no agent's model, so the dialog offers the new ones for all agents.
	await page.click(`${DIALOG} [data-action=choose-model]`);
	await sees("[data-slot=command-item]");
	const offered = await page.$$eval("[data-slot=command-item] > :first-child", (els: Element[]) => els.map((e) => e.textContent ?? ""));
	assert.ok(offered.length > 0 && offered.every((m) => m.startsWith("opencode/")), JSON.stringify(offered.slice(0, 5)));
	await page.click("[data-slot=command-item] >> nth=0");
	await until("the model picked is the default of pine.json", () => pine().defaults.model === offered[0]);
	await sees(`[data-setting=fallback-model]:has-text("${offered[0]}")`);
	// Signed out again, that model cannot answer: the page says so for each agent it leaves without
	// one, and so does the welcome of such an agent's conversation, with the way to this page.
	await page.click(`${row} [data-action=sign-out]`);
	await page.click("[role=alertdialog] [data-slot=alert-dialog-action]");
	await sees("[data-slot=settings-page] [data-slot=model-notice][data-agent=main]");
	assert.ok(!("opencode" in read("auth.json")));
	await page.click(TAB("main", folderSession));
	// The main agent's card says it in a toast that stays and has a button, not on the card.
	const noModel = page.locator("[data-slot=toast]:not([data-ending-style]):has([data-slot=toast-action])");
	await noModel.waitFor({ timeout: 20_000 });
	assert.equal(await page.$("[data-slot=empty] [data-slot=model-notice]"), null);
	await shot("09-no-model");
	// The toast leads to the one way to connect a model, the setup conversation (which came in front by
	// itself too when the model was lost), where pine asks its first question; back to Settings from there.
	await noModel.locator("[data-slot=toast-action]").click();
	await sees(`${TAB("main", "setup")}[data-active]`);
	await sees("[data-slot=composer-question] [data-slot=questionnaire]");
	await menu("close");
	await page.waitForSelector(TAB("main", "setup"), { state: "detached" });
	await menu("settings");
	await sees(`${NAV("models")}[aria-current=page]`);
	// "Change" offers every model that can be used now.
	await page.click("[data-setting=fallback-model] [data-action=change]");
	await page.getByRole("option", { name: "mock/m" }).click();
	await until("the model picked is the default of pine.json", () => pine().defaults.model === "mock/m");
	await page.waitForSelector("[data-slot=settings-page] [data-slot=model-notice]", { state: "detached" });
	// A model answers again: the toast is gone by itself.
	await noModel.waitFor({ state: "detached", timeout: 10_000 });
	// MCP servers: a remote one is added, pine says whether it connects, and "Sign in" runs pi's own
	// sign-in for it (which for a server that wants none says so; a browser opens only where one is needed).
	const remote = await httpMcp({});
	try {
		await settingsPage("mcp");
		await page.click("[data-slot=settings-page] [data-action=new-server]");
		await page.fill(formField("name"), "notes");
		await page.fill(formField("target"), remote.url);
		await putAwayToasts();
		await page.click(`${DIALOG} [data-action=submit]`);
		const server = "[data-slot=settings-page] [data-find='mcp:global:notes']";
		await sees(server);
		// It connects: its state is a good one.
		await sees(`${server}[data-tone=good]`, 30_000);
		await page.click(`${server} [data-action=sign-in]`);
		// What pi's sign-in printed is shown, and it is about this server.
		await sees("[data-slot=settings-page] [data-slot=code-block-content]:has-text('notes')", 40_000);
		await shot("09-settings-mcp-sign-in");
		assert.ok("notes" in pine().mcp);
		// And taken out again: the file is as it was.
		await page.click(`${server} [data-action=remove]`);
		await sees("[role=alertdialog]");
		// Asked in an alert dialog, announced by a question that names the server; Escape closes it onto the button, and nothing is removed.
		assert.match(await announced("[role=alertdialog]"), /notes/);
		await page.locator("[role=alertdialog]").evaluate((el: Element) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
		await shot("09-settings-confirm");
		await page.keyboard.press("Escape");
		await page.waitForSelector("[role=alertdialog]", { state: "detached" });
		assert.equal(await page.locator(`${server} [data-action=remove]`).evaluate((b: Element) => b === document.activeElement), true);
		assert.ok("notes" in pine().mcp);
		await page.click(`${server} [data-action=remove]`);
		await page.click("[role=alertdialog] [data-slot=alert-dialog-action]");
		await page.waitForSelector(server, { state: "detached", timeout: 15_000 });
		assert.ok(!("notes" in (pine().mcp ?? {})));
	} finally {
		await remote.close();
	}
	// Skills: one is written down for all agents.
	await settingsPage("skills");
	await page.click("[data-slot=settings-page] [data-action=new-skill]");
	await page.fill(formField("name"), "invoices");
	await page.fill(formField("description"), "File an invoice. Use when a bill arrives.");
	await page.click(`${DIALOG} .cm-content`);
	await page.keyboard.type("1. Read the bill.");
	await submit();
	await sees("[data-slot=settings-page] [data-slot=item-title] >> text=invoices");
	assert.match(fs.readFileSync(path.join(home, "skills", "invoices", "SKILL.md"), "utf8"), /Read the bill/);
	// Events: a folder to watch, set up from the type's own options.
	await settingsPage("events");
	await page.click("[data-slot=settings-page] [data-action=new-source]");
	await page.fill(formField("name"), "scans");
	// Chosen with a click, the list closes and stays closed (`choose` waits for that).
	await choose("type", "folder");
	const watched = path.join(folder, "scans");
	fs.mkdirSync(watched, { recursive: true });
	// (`dir` is the option's name in the type's own schema.)
	const dir = page.locator(`${DIALOG} [data-slot=field]`, { has: page.locator("[data-slot=field-label]", { hasText: /^dir/ }) }).locator("input");
	// An option the type needs is said to be needed, to a screen reader too, not by its star alone.
	assert.equal(await dir.getAttribute("aria-required"), "true");
	await dir.fill(watched);
	await shot("09-settings-new-source");
	// pine says first what the source would do; then it is added.
	await page.click(`${DIALOG} [data-action=continue]`);
	await sees(`${DIALOG} [data-action=submit]`);
	await page.click(`${DIALOG} [data-action=submit]`);
	await sees("[data-slot=settings-page] [data-slot=item-title] >> text=scans");
	assert.ok(JSON.stringify(pine().sources).includes(watched), JSON.stringify(pine().sources));
	await shot("09-settings-sources");
	if (shots) {
		for (const id of ["models", "mcp", "skills", "agents", "general"]) {
			await settingsPage(id);
			await page.waitForTimeout(400);
			await shot(`09-settings-${id}`);
		}
	}
	// General: the browser of the web tools is still not there, and can be fetched from here. (The test fetches
	// nothing: PINE_SKIP_DOWNLOADS, which what the command printed names.)
	await settingsPage("general");
	await sees("[data-setting=browser][data-state=missing]");
	await page.click("[data-setting=browser] [data-action=download]");
	await sees("[data-setting=browser] [data-slot=code-block-content]:has-text('PINE_SKIP_DOWNLOADS')");
	// Fetched some other way (a terminal): the page says so when it is opened again.
	const { browserPlaces } = await import("../../src/browser-build.ts");
	const places = (await browserPlaces()) ?? [];
	for (const place of places) write(path.join(browsers, path.basename(place), "INSTALLATION_COMPLETE"), "");
	await settingsPage("models");
	await settingsPage("general");
	await sees("[data-setting=browser][data-state=here]");
	await menu("settings");
});

test("settings are searched: what fits is listed in place of the page, and a pick opens its page at it", async () => {
	await menu("settings");
	await sees("[data-slot=settings-page]");
	const field = page.locator("[data-slot=settings-search]");
	const results = "[data-slot=settings-results]";
	// ⌘F (the menu's Find) goes to the field while Settings are in front.
	await menu("find");
	await page.waitForFunction(() => document.activeElement?.getAttribute("data-slot") === "settings-search");
	// A setting of pine's is found by its key in pine.json too, whatever the page calls it.
	await page.keyboard.type("maxDownloadMb");
	await sees(`${results} [data-result='setting:limits.maxDownloadMb']`);
	// The page shown in its place is headed by what was typed, and no page is the one in front.
	await sees("[data-slot=settings-page] [data-slot=settings-title]:has-text('maxDownloadMb')");
	assert.equal(await page.locator("[role=navigation] [aria-current=page]").count(), 0);
	// The pages with nothing that fits are marked as such in the navigation; the one that has it is not.
	await sees(`${NAV("models")}[data-dimmed]`);
	await sees(`${NAV("general")}:not([data-dimmed])`);
	await shot("09-settings-search");
	// Enter goes to the first: its page, scrolled to it and marked for a moment, and the field is empty again.
	await field.press("Enter");
	await sees("[data-slot=settings-page] [data-setting-key='limits.maxDownloadMb'][data-found]");
	await sees(`${NAV("general")}[aria-current=page]`);
	assert.equal(await field.inputValue(), "");
	// An agent's own field opens that agent's page: the agent made above, found by its name.
	await field.fill("books");
	const result = page.locator(`${results} [data-result='agent:books:network']`);
	await result.waitFor();
	// The arrows go from the field into the list, and a pick opens it.
	await field.press("ArrowDown");
	await page.waitForFunction(() => document.activeElement?.hasAttribute("data-result"));
	await result.click();
	await sees("[data-slot=settings-page] [data-slot=settings-title]:has-text('books')");
	await sees("[data-slot=settings-page] [data-find=agent-network][data-found]");
	// A provider the Models page lists only when searched for: it opens searched for it.
	await field.fill("opencode");
	await page.click(`${results} [data-result='provider:opencode']`);
	await sees("[data-slot=settings-page] [data-provider=opencode][data-found]");
	assert.equal(await page.inputValue("[data-slot=settings-page] [data-find=providers] input"), "opencode");
	// What pine has is found by its name: the source added above, which is one for all agents.
	await field.fill("scans");
	await sees(`${results} [data-result='source:global:scans']`);
	// Nothing fits: no list, and the page says so in the place of one. Escape empties the field, and the page that was open is back.
	await field.fill("zzqqxx");
	await sees("[data-slot=settings-page] [data-slot=empty]");
	assert.equal(await page.locator(results).count(), 0);
	await field.press("Escape");
	assert.equal(await field.inputValue(), "");
	await sees(`${NAV("models")}[aria-current=page]`);
	// The palette finds settings too, and opens them the same way.
	await menu("palette");
	await sees("[data-slot=command-input]");
	await page.keyboard.type("maxDownloadMb");
	await page.click("[data-slot=command-item][data-value='f:setting:limits.maxDownloadMb' i]");
	await sees("[data-slot=settings-page] [data-setting-key='limits.maxDownloadMb'][data-found]");
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
test("the window is drawn in pmndre, the theme pine names when pine.json names none", { skip: Boolean(process.env.PINE_DESKTOP_THEME) }, async () => {
	await themeIs("pmndre");
	assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), true);
	// pine put its set of themes into the home that had none.
	assert.ok(fs.existsSync(path.join(home, "themes", "pmndre.json")) && fs.existsSync(path.join(home, "themes", "github-light.json")));
});

test("a theme picked in Settings draws the window and is pine's setting; a VS Code theme dropped into the folder is offered; another hand's choice is followed", async () => {
	/** A theme picked from the list, by its id (its file's name). */
	const pick = async (id: string) => {
		await page.click("[data-setting=theme] [data-slot=select-trigger]");
		await page.click(`[data-slot=select-content] [data-slot=select-item][data-value="${id}"]`);
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
		await settingsPage("general");
		await sees("[data-setting=theme]");
		// The file that is no theme is named, with why; it is not offered.
		await sees("[data-slot=settings-page] [data-slot=alert]:has-text('broken.json')");

		// A light theme of pine's own.
		await pick("github-light");
		await themeIs("github-light");
		assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), false);
		await until("the theme is pine's setting", () => read("pine.json").ui?.theme === "github-light");
		// The app keeps it, to open in it next time.
		await until("the app keeps the theme", () => read("desktop-data", "prefs.json").look?.id === "github-light");

		// The owner's own: the window is drawn in the colors its file names (the test wrote them), and it is a dark one.
		await pick("mine");
		await themeIs("mine");
		assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), true);
		assert.equal(await resolved("var(--background)"), rgb("#102030"));
		assert.equal(await resolved("var(--primary)"), rgb("#ff8800"));
		assert.equal(await resolved("var(--code-keyword)"), rgb("#ff00aa"));
		// The file that is no theme cannot be picked.
		await page.click("[data-setting=theme] [data-slot=select-trigger]");
		await sees("[data-slot=select-content] [data-slot=select-item][data-value=mine]");
		assert.equal(await page.locator("[data-slot=select-content] [data-slot=select-item][data-value=broken]").count(), 0);
		await page.keyboard.press("Escape");
		await page.waitForSelector("[data-slot=select-content][data-open]", { state: "detached" });

		// Another hand (the main agent's set_setting, another UI) changes it through pine: the window follows.
		await api("POST", "/settings", { key: "ui.theme", value: "dracula" });
		await themeIs("dracula");
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
	await sees("[data-slot=code-panel] [data-view=agent][aria-selected=true]");
	const part = (name: string) => `[data-slot=code-panel] [data-slot=agent-section][data-part=${name}]`;
	await sees("[data-slot=code-panel] [data-slot=item-title] >> text=invoices");
	await sees(`${part("schedules")} [data-slot=item-title] >> text=morning`);
	// main listens to no source yet (the one added above only could wake it): that part has a line and no row.
	await sees(`${part("sources")}[data-empty]`);
	assert.equal(await page.locator(`${part("sources")} [data-slot=item-title]`).count(), 0);
	// A row opens the thing itself, in the dialog Settings opens it in; what is not this agent's alone is tagged with whom it is for.
	const morning = page.locator(`${part("schedules")} [data-slot=item]`, { has: page.locator("[data-slot=item-title]", { hasText: "morning" }) });
	assert.equal(await morning.locator("[data-row-tag]").count(), 1, "a schedule for all agents is not said to be one");
	await morning.click();
	await sees(`${DIALOG} [data-slot=dialog-title] >> text=morning`);
	assert.equal(await page.inputValue(formField("task")), "Say good morning.");
	await page.keyboard.press("Escape");
	await page.waitForSelector(DIALOG, { state: "detached" });
	// The agent's files are the part its page in Settings has: its four files (AGENTS.md rule 1), one tab each.
	const files = page.locator(part("instructions"));
	assert.deepEqual((await files.locator("[role=tab]").allTextContents()).sort(), ["AGENTS.md", "MEMORY.md", "SOUL.md", "TOOLS.md"]);
	// Its instructions can be changed here; its memory is the agent's to write, and is only read.
	await sees(`${part("instructions")} .cm-content[contenteditable=true]`);
	await files.getByRole("tab", { name: "MEMORY.md" }).click();
	await sees(`${part("instructions")} .cm-content[contenteditable=false]`);
	// A part's way on leads to that part of the agent's page in Settings.
	await page.click(`${part("schedules")} [data-action=manage]`);
	await sees("[data-slot=settings-page] [data-find=agent-schedules][data-found]");
	await page.click("[data-slot=tab] >> nth=0");
	await shot("14-agent-view");
});
