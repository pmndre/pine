// The app from end to end, the second half (the first is app.test.ts, which says how): what lies
// around a conversation. The side bar and its agents and groups, the palette, the event log,
// tabs, a narrow window, another machine's pine, and quitting. An app and a home of its own.
//
// What is asserted here is what the app does, by the hooks its page carries for that (data-slot,
// data-state, data-action, roles and aria states), by what the daemon and the main process kept,
// and by text the test itself supplied. Never the wording of a label, and never where a box lies
// or how large it is (TESTS.md): where a point on the screen is needed, it is where to drag to.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { before, test } from "node:test";
import { mockMsg } from "../../baseline/tests/mock.mjs";
import { patient } from "./support/app.ts";
import { daemonGone, ours } from "./support/daemon.ts";
import { activeOption, announced, api, app, closed, CODE_EDGE, CODE_TOGGLE, confirm, far, folder, home, json, menu, mock, named, page, sees, shot, SIDE_EDGE, started, stillInside, visit } from "./support/window.ts";

// The question about the browser for the web tools is app.test.ts's: here it is answered and gone.
before(() => started());

const TAB = "[data-slot=tab]";
/** The tab in front, and the button that closes a tab. */
const FRONT = "[data-slot=tab][data-active]";
const CLOSE = "[data-action=close]";
const closeFront = () => page.click(`${FRONT} ${CLOSE}`);
/** The tab in front is called by this (a text the test supplied: what it typed, a name it gave). */
const frontNamed = (text: string, timeout?: number) => sees(`${FRONT} [data-slot=tab-name] >> text=${text}`, timeout);
/** An agent's line in the side bar, and the group it is once it has several conversations. */
const agentLine = (id: string) => page.locator(`[data-slot=sidebar-menu-item]:has([data-slot=agent-label][data-agent="${id}"])`);
const agentGroup = (id: string) => page.locator(`[data-slot=collapsible]:has([data-slot=agent-label][data-agent="${id}"])`);
const agentIds = (): Promise<string[]> => page.$$eval("[data-slot=agent-label]", (els: Element[]) => els.map((e) => e.getAttribute("data-agent") ?? ""));
/** A conversation's line in the side bar. */
const lineOf = (session: string) => `[data-slot=sidebar-menu-item][data-session="${session}"]`;
/** What the main process holds for this window: the machine, the preferences, the layout the page reported. */
const appState = (): Promise<any> => page.evaluate(() => (window as any).pine.state());
/** After the page drew what it was last told: two frames, for an assertion that something did not happen. */
const drawn = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));

/** Asks again until the answer is the one waited for, and says the last one when it never comes. */
async function until<T>(read: () => Promise<T> | T, ok: (v: T) => unknown, what: string, ms = patient(10_000)): Promise<T> {
	const end = Date.now() + ms;
	for (;;) {
		const v = await read();
		if (ok(v)) return v;
		if (Date.now() > end) throw new Error(`${what}: ${JSON.stringify(v)}`);
		await new Promise((r) => setTimeout(r, 30));
	}
}

/** Where a pine of a test home answers, and its token, as it wrote them. */
const daemonOf = (dir: string) => ({ port: [...fs.readFileSync(path.join(dir, "data", "pine.log"), "utf8").matchAll(/http listening on 127\.0\.0\.1:(\d+)/g)].at(-1)![1], token: fs.readFileSync(path.join(dir, "data", "http-token"), "utf8").trim() });
/** A call to a home's daemon by another hand than the app's. */
const ask = (dir: string, method: string, url: string, body?: unknown) => {
	const d = daemonOf(dir);
	return fetch(`http://127.0.0.1:${d.port}${url}`, { method, headers: { authorization: `Bearer ${d.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
};

/**
 * The context menus are the system's, which the driver cannot click in: from here on what one would offer is
 * noted by the ids of its items (a checked one as "id ✓"), never by their wording, and the test says what is picked.
 */
const noteMenus = () =>
	app.evaluate(({ ipcMain }: any) => {
		const g = globalThis as any;
		g.menus = [];
		ipcMain.removeHandler("pine:context-menu");
		ipcMain.handle("pine:context-menu", (_e: unknown, items: Array<{ id: string; separator?: boolean; checked?: boolean }>) => {
			g.menus.push(items.filter((i) => !i.separator).map((i) => `${i.id}${i.checked ? " ✓" : ""}`));
			return g.pick;
		});
	});
/** A right click on `target`: the ids of what its menu offers, with `pick` chosen from it. */
const offered = async (target: any, pick?: string): Promise<string[]> => {
	const had = await app.evaluate((_e: unknown, p: string | null) => (((globalThis as any).pick = p ?? undefined), (globalThis as any).menus.length), pick ?? null);
	await target.click({ button: "right" });
	const menus = await until(() => app.evaluate(() => (globalThis as any).menus) as Promise<string[][]>, (m) => m.length > had, "no context menu was asked for");
	return menus.at(-1)!;
};

/** What the palette calls one of its lines now (a command as "c:<name>"): typed, it finds the line whatever it is called. */
const calledInPalette = async (id: string): Promise<string> => {
	await sees(`[data-slot=command-item][data-value="${id}"]`);
	return ((await page.locator(`[data-slot=command-item][data-value="${id}"] > :first-child`).textContent()) ?? "").trim();
};

test("the side bar is the agents: one made elsewhere appears, a group folds away, and what is new says for whom", async () => {
	// An agent that another hand makes (the main agent, a `pine agent add`): asked of the daemon directly, not through the app.
	const made = await ask(home, "POST", "/agents", { id: "test", description: "Made outside the app", instructions: "You are test." });
	assert.equal(made.status, 200);
	await visit();
	await sees("[data-slot=agent-label][data-agent=test]", 20_000);
	assert.match((await agentLine("test").textContent()) ?? "", /Made outside the app/, "its line says what the test described it as");
	// Beside a conversation, the panel's Agent view. (What it says an agent was given is app.test.ts's, after its settings.)
	await page.click(`${TAB} >> nth=0`);
	// The menu's item opens the side panel on its Agent view whatever state the panel is in (a toggle could close it).
	await menu("code-agent");
	await sees("[data-slot=code-panel] [role=tab][data-view=agent][aria-selected=true]");
	// The side bar is wider once its edge is dragged away from it. (Where the edge is, is where to take hold of it.)
	const sideWidth = () => page.$eval("#sidebar-panel [data-slot=sidebar]", (el: Element) => el.getBoundingClientRect().width);
	const widerThan = (was: number) => page.waitForFunction((was: number) => (document.querySelector("#sidebar-panel [data-slot=sidebar]")?.getBoundingClientRect().width ?? 0) > was, was, { timeout: patient(5000) });
	const first = await sideWidth();
	const edge = await page.$eval(SIDE_EDGE, (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(edge.x + edge.width / 2, 300);
	await page.mouse.down();
	await page.mouse.move(edge.x + edge.width / 2 + 80, 300, { steps: 4 });
	await page.mouse.up();
	await widerThan(first);
	const dragged = await sideWidth();
	// The edge is a separator the keyboard moves too: focused, an arrow key makes the side bar wider.
	await page.focus(`${SIDE_EDGE}[role='separator']`, { timeout: 5000 });
	assert.ok(await page.getAttribute(SIDE_EDGE, "aria-valuenow"), "the edge says how far it is");
	await page.keyboard.press("ArrowRight");
	await widerThan(dragged);
	// Hidden, the side bar is still hidden when the page is loaded again, and shown it is not back at the width it started with.
	await menu("sidebar");
	await page.waitForSelector("#sidebar-panel [data-slot=sidebar]", { state: "detached" });
	await page.reload();
	await sees(FRONT);
	assert.equal(await page.locator("#sidebar-panel [data-slot=sidebar]").count(), 0);
	await menu("sidebar");
	await sees("#sidebar-panel [data-slot=sidebar]");
	await widerThan(first);
	await page.reload();
	await sees("#sidebar-panel [data-slot=agent-label]");
	// An agent with one conversation is one line: nothing folds, no conversation is listed under it, and a click opens that conversation.
	const scoutLine = agentLine("scout");
	const group = agentGroup("scout");
	await scoutLine.locator("[data-slot=agent-conversation]").waitFor();
	assert.equal(await group.count(), 0);
	assert.equal(await scoutLine.locator("[data-slot=agent-count]").count(), 0);
	await scoutLine.locator("[data-slot=agent-label]").click();
	await sees(`${FRONT}[data-agent=scout][data-session=main]`);
	await scoutLine.locator("[data-slot=agent-conversation][data-active]").waitFor();
	await closeFront();
	// The plus on an agent's own line starts a conversation with that agent, and with a second conversation the line is a group that says how many it holds.
	await scoutLine.locator("[data-agent-action=new]").click();
	await sees(`${FRONT}[data-agent=scout]:not([data-session=main])`);
	// The empty conversation says with whom it is, and what the agent is for (its description, which the home of this test gave it).
	await sees("[data-slot=empty] [data-slot=empty-title] >> text=scout");
	await sees("[data-slot=empty] >> text=Looks things up on the web");
	await group.locator("[data-slot=agent-count]", { hasText: /\b2\b/ }).waitFor();
	assert.equal(await scoutLine.locator("[data-slot=agent-conversation]").count(), 0);
	assert.equal(await group.locator("[role=option]").count(), 2);
	// A group folds away on a click on its agent, and comes back.
	await group.locator("[data-slot=agent-label]").click();
	assert.equal(await group.locator("[role=option]").count(), 0);
	await group.locator("[data-slot=agent-label]").click();
	assert.equal(await group.locator("[role=option]").count(), 2);
	// A new conversation that is closed before anything was said in it is gone, and with one conversation left the agent is one line again.
	await closeFront();
	await scoutLine.locator("[data-slot=agent-conversation]").waitFor();
	assert.equal(await group.count(), 0);
	await scoutLine.locator("[data-agent-action=new]").click();
	await sees(`${FRONT}[data-agent=scout]:not([data-session=main])`);
	await shot("14-agents");
	// A conversation is called by the first thing said in it, in the side bar and on its tab.
	await page.fill("[data-slot=composer] textarea", "where is the okapi invoice");
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=ECHO[where is the okapi invoice]");
	await frontNamed("where is the okapi invoice", 15_000);
	assert.equal(await group.locator("[role=option] >> text=where is the okapi invoice").count(), 1);
	await closeFront();
	// Search finds a conversation by what was said in it, and opens it with the words marked.
	await menu("palette");
	await sees("[data-slot=command-input]");
	// By words that are only in an answer of the agent's, never in a name: a line of what was said in conversations ("m:"), with the answer in it.
	await page.keyboard.type("echo[where");
	await sees("[data-slot=command-item][data-value^='m:scout:']");
	assert.match((await page.locator("[data-slot=command-item][data-value^='m:scout:']").first().textContent()) ?? "", /where is the okapi invoice[\s\S]*ECHO\[where is the okapi invoice\]/);
	await shot("15-search");
	// By words that are also its name, it is listed once, and still opens at the words.
	await page.fill("[data-slot=command-input]", "okapi invoice");
	const listed = "[data-slot=command-item]:has-text('where is the okapi invoice')";
	await sees(listed);
	await page.waitForFunction(() => [...document.querySelectorAll("[data-slot=command-item]")].filter((e) => /where is the okapi invoice/.test(e.textContent ?? "")).length === 1);
	await page.click(listed);
	await frontNamed("where is the okapi invoice");
	// Find is open on the words, and counts what it marked.
	await sees("[data-find=conversation][data-count]:not([data-count='0'])");
	assert.equal(await page.inputValue("[data-find=conversation] [data-field=find]"), "okapi invoice");
	await page.keyboard.press("Escape");
	await closeFront();
	// Asked from where no agent is in front (the event log), a new conversation asks with whom: every agent, and a field to narrow them.
	await menu("events");
	await sees(`${FRONT}[data-kind=events]`);
	await menu("new");
	await sees("[data-slot=dialog-content] [data-slot=command-item][data-value=test]");
	assert.ok(await page.locator("[data-slot=dialog-content] [data-slot=command-input]").isVisible(), "a short list has its field in sight too");
	assert.deepEqual((await page.$$eval("[data-slot=dialog-content] [data-slot=command-item]", (els: Element[]) => els.map((e) => e.getAttribute("data-value")))).sort(), ["main", "scout", "test"]);
	await page.keyboard.press("Escape");
	await closeFront();
});

test("the window shows before the tabs are filled, with skeletons in the side bar until its conversations are known", async () => {
	// What the tabs hold (their history), the conversations of each agent and what was said are held back in the main process until released.
	await app.evaluate(({ ipcMain }: any) => {
		const g = globalThis as any;
		const real = ipcMain._invokeHandlers.get("pine:call");
		g.held = [];
		g.realCall = real;
		ipcMain.removeHandler("pine:call");
		ipcMain.handle("pine:call", (e: unknown, method: string, url: string, body?: unknown) => (/\/(history|sessions|tasks)\b/.test(url) ? new Promise((r) => g.held.push(() => r(real(e, method, url, body)))) : real(e, method, url, body)));
	});
	try {
		await page.reload();
		await sees(FRONT, 20_000);
		await sees("[data-slot=sidebar] [data-slot=skeleton]");
		assert.equal(await page.locator("[data-slot=empty]").count(), 0, "no empty state shows before the data is there");
	} finally {
		await app.evaluate(({ ipcMain }: any) => {
			const g = globalThis as any;
			ipcMain.removeHandler("pine:call");
			ipcMain.handle("pine:call", g.realCall);
			for (const go of g.held) go();
		});
	}
	await page.waitForSelector("[data-slot=sidebar] [data-slot=skeleton]", { state: "detached", timeout: patient(20_000) });
	await sees("[data-slot=agent-label][data-agent=main]");
});

test("a conversation is opened from the side bar with the keyboard alone, and a group folds from it", async () => {
	const group = agentGroup("scout");
	const fold = group.locator("[data-slot=collapsible-trigger]");
	await fold.focus();
	assert.equal(await fold.getAttribute("aria-expanded"), "true");
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => document.activeElement?.getAttribute("aria-expanded") === "false");
	assert.equal(await group.locator("[role=option]").count(), 0);
	await page.keyboard.press("Space");
	await page.waitForFunction(() => document.activeElement?.getAttribute("aria-expanded") === "true");
	assert.ok((await group.locator("[role=option]").count()) > 0);
	// The buttons on the agent's line are stops of their own, shown while the keyboard is on the line; its conversations come after the plus:
	// Tab goes in, the arrows move, Enter opens.
	for (const action of ["more", "new"]) {
		await page.keyboard.press("Tab");
		const at = await page.evaluate(() => ({ action: document.activeElement?.getAttribute("data-agent-action"), label: document.activeElement?.getAttribute("aria-label") ?? "" }));
		// Each has a name a screen reader says, and it names the agent.
		assert.ok(at.action === action && at.label.includes("scout"), JSON.stringify(at));
	}
	await page.keyboard.press("Tab");
	const at = () => page.evaluate(() => ({ role: document.activeElement?.getAttribute("role"), text: document.activeElement?.textContent ?? "" }));
	assert.equal((await at()).role, "option");
	for (let i = 0; i < 6 && !/where is the okapi invoice/.test((await at()).text); i++) await page.keyboard.press("ArrowDown");
	assert.match((await at()).text, /where is the okapi invoice/);
	await page.keyboard.press("Enter");
	await frontNamed("where is the okapi invoice");
	await closeFront();
});

test("a conversation is removed by its row's own button, which the keyboard reaches too, after a yes in a dialog that then closes", async () => {
	const group = agentGroup("scout");
	await group.locator("[data-agent-action=new]").click();
	await sees(`${FRONT}[data-agent=scout]:not([data-session=main])`);
	await page.fill("[data-slot=composer] textarea", "a conversation to remove");
	await page.keyboard.press("Enter");
	await frontNamed("a conversation to remove", 15_000);
	const session = await page.getAttribute(FRONT, "data-session");
	const option = group.locator("[role=option]", { hasText: "a conversation to remove" });
	await option.focus();
	await page.keyboard.press("Tab");
	// The next stop is the row's own button to remove it, with a name a screen reader says.
	const at = await page.evaluate(() => ({ action: document.activeElement?.getAttribute("data-action"), label: document.activeElement?.getAttribute("aria-label") ?? "" }));
	assert.ok(at.action === "remove" && at.label, JSON.stringify(at));
	await page.keyboard.press("Enter");
	// It asks first: an alert dialog with the action and a way back.
	const dialog = page.locator("[role=alertdialog]");
	await dialog.locator("[data-slot=alert-dialog-action]").waitFor();
	assert.equal(await dialog.locator("[data-slot=alert-dialog-cancel]").count(), 1);
	await dialog.locator("[data-slot=alert-dialog-action]").click();
	await dialog.waitFor({ state: "detached" });
	await option.waitFor({ state: "detached" });
	// The daemon no longer has it.
	await until(async () => ((await api("GET", "/agents/scout/sessions")).data as any[]).map((c) => c.session), (all) => !all.includes(session), "the conversation is still one of scout's");
});

test("the tabs are reached with the keyboard: the arrows go from one to the next, and Enter brings it to the front", async () => {
	await menu("events");
	await sees(`${FRONT}[data-kind=events]`);
	await page.focus(FRONT);
	assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "tab");
	await page.keyboard.press("ArrowLeft");
	await page.keyboard.press("Enter");
	// (A conversation brought to the front takes the keyboard into its input.)
	await sees(`${FRONT}:not([data-kind=events])`);
	await page.click(`${TAB}[data-kind=events] ${CLOSE}`);
});

test("the search after the tabs lists every tab of the row, the one in front checked, finds one by name and brings it to the front", async () => {
	await menu("events");
	await sees(`${FRONT}[data-kind=events]`);
	const bar = `[data-slot=group-bar]:has(${FRONT})`;
	const names: string[] = await page.$$eval(`${bar} [data-slot=tab] [data-slot=tab-name]`, (all: Element[]) => all.map((e) => e.textContent ?? ""));
	const front = (await page.textContent(`${FRONT} [data-slot=tab-name]`)) ?? "";
	await page.click(`${bar} [data-slot=tab-list]`);
	await page.locator("[data-slot=combobox-content] input").waitFor();
	assert.deepEqual(await page.$$eval("[data-slot=combobox-item] [data-slot=tab-name]", (all: Element[]) => all.map((e) => e.textContent)), names);
	assert.equal(await page.textContent("[data-slot=combobox-item][aria-selected=true] [data-slot=tab-name]"), front);
	// The keyboard is in the search: a name narrows the list, and Enter takes the first that matches.
	await page.keyboard.type(names[0]!);
	await page.keyboard.press("Enter");
	await page.locator("[data-slot=combobox-content]").waitFor({ state: "detached" });
	await frontNamed(names[0]!);
	await page.click(`${TAB}[data-kind=events] ${CLOSE}`);
});

test("a right click on an agent renames it in place, colors it, and offers to remove it, and never the main agent", async () => {
	const made = await ask(home, "POST", "/agents", { id: "spare", description: "Not needed for long", instructions: "You are spare." });
	assert.equal(made.status, 200);
	await visit();
	await sees("[data-slot=agent-label][data-agent=spare]", 20_000);
	await noteMenus();
	// The main agent can be renamed and colored like any other, and has nothing to remove it with.
	const ofMain = await offered(agentLine("main"));
	assert.ok(ofMain.includes("rename") && ofMain.includes("color") && !ofMain.includes("remove"), ofMain.join());
	// Rename turns its name in the side bar into a field: Escape keeps the name, Enter gives it the new one, and everything follows it.
	const ofSpare = await offered(agentLine("spare"), "rename");
	assert.ok(ofSpare.includes("rename") && ofSpare.includes("color") && ofSpare.includes("remove"), ofSpare.join());
	const field = page.locator("[data-slot=sidebar] [data-field=rename]");
	await field.press("Escape");
	await field.waitFor({ state: "detached" });
	await sees("[data-slot=agent-label][data-agent=spare]");
	await offered(agentLine("spare"), "rename");
	await field.fill("Spare Hands");
	await field.press("Enter");
	await sees("[data-slot=agent-label][data-agent=spare-hands]");
	const kept = path.join(home, "agents", "spare-hands", "agent.json");
	await until(() => fs.existsSync(kept) && !fs.existsSync(path.join(home, "agents", "spare")), Boolean, "the agent's folder did not follow its new name");
	// Color opens the color over its avatar, and a pick is kept at once.
	await offered(agentLine("spare-hands"), "color");
	const swatch = page.locator("[data-slot=agent-color][data-open] [data-color]:not([data-color=none])").first();
	const color = await swatch.getAttribute("data-color");
	await swatch.click();
	assert.equal(await until(() => json(kept)?.color, Boolean, "no color was kept for the agent"), color);
	await page.keyboard.press("Escape");
	await offered(agentLine("spare-hands"), "remove");
	// It asks first, and how: nothing is removed by the menu alone.
	// It is an alert dialog, which names the agent and does not go away with a stray click beside it.
	await sees("[role=alertdialog] >> text=spare-hands");
	await page.mouse.click(5, 5);
	await drawn();
	await sees("[role=alertdialog]");
	assert.ok(fs.existsSync(kept));
	await page.click("[role=alertdialog] [data-slot=command-item][data-value=erase]");
	await page.waitForSelector("[data-slot=agent-label][data-agent=spare-hands]", { state: "detached" });
	await until(() => fs.existsSync(path.join(home, "agents", "spare-hands")), (there) => !there, "the removed agent's folder is still there");
	// Asked for the main agent all the same (the palette, another road), the app says no and asks the daemon for nothing.
	await page.evaluate(() => (window as any).pine.call("POST", "/agents/main/erase", { agent: "main", keepFiles: false })).then((r: any) => assert.equal(r.ok, false));
	assert.ok(fs.existsSync(path.join(home, "agents", "main", "agent.json")));
});

test("conversations are kept in groups: one made from the agent's menu is filled by dragging and from the palette, sorted, renamed, and removed with what is in it", async () => {
	for (const session of ["okapi-api", "okapi-web", "llama"]) assert.ok((await api("POST", "/agents/scout/prompt", { prompt: `work on ${session}`, session })).ok);
	assert.ok((await api("POST", "/agents/scout/branch", { session: "okapi-api", to: "okapi-try" })).ok);
	const scout = agentGroup("scout");
	const row = (session: string) => scout.locator(lineOf(session));
	const group = (name: string) => scout.locator("[data-slot=conversation-group]", { has: page.locator("[data-slot=group-label]", { hasText: new RegExp(`^${name}$`) }) });
	const groupOf = async (session: string) => ((await api("GET", "/agents/scout/sessions")).data as any[]).find((c) => c.session === session)?.group;
	const order = async () => (await api("GET", "/agents/scout/groups")).data.order;
	await noteMenus();
	const line = agentLine("scout");
	// A drag as the side bar is told of it: the events of the row and of the place it is dropped on, one
	// after the other. Playwright's dragTo moves the mouse, and a list that redraws as the daemon tells it
	// something (it does, live) can take the row away mid-drag, which drops nothing: a test of Chromium's
	// pointer, not of the side bar.
	const drag = async (source: any, target: any) => {
		const data = await page.evaluateHandle(() => new DataTransfer());
		// The element itself, as a browser keeps it: dragend goes to it after the drop, wherever the list put the row.
		const held = await source.elementHandle();
		await held.dispatchEvent("dragstart", { dataTransfer: data });
		await target.dispatchEvent("dragenter", { dataTransfer: data });
		await target.dispatchEvent("dragover", { dataTransfer: data });
		await target.dispatchEvent("drop", { dataTransfer: data });
		await held.dispatchEvent("dragend", { dataTransfer: data });
		await held.dispose();
		await data.dispose();
	};

	// A group is made from the agent's menu, empty, with a name the owner types. The list is sorted by when a conversation was last used, as it was.
	const ofLine = await offered(line, "group");
	assert.ok(ofLine.includes("recent ✓") && ofLine.includes("name"), ofLine.join());
	await page.fill("[data-slot=dialog-content] [data-slot=command-input]", "Okapi");
	await page.keyboard.press("Enter");
	await group("Okapi").waitFor();
	// (A branch made through the control API is in the list the side bar asked for after that.)
	await row("okapi-try").waitFor();
	assert.equal(await group("Okapi").locator("[role=option]").count(), 0);

	// A conversation dragged onto the group goes into it, with its branch; a branch is not dragged by itself.
	assert.equal(await row("okapi-try").getAttribute("draggable"), "false");
	assert.equal(await row("okapi-api").getAttribute("draggable"), "true");
	await drag(row("okapi-api"), group("Okapi").locator("[data-slot=group-label]"));
	await group("Okapi").locator(lineOf("okapi-try")).waitFor();
	assert.deepEqual([await groupOf("okapi-api"), await groupOf("okapi-try")], ["Okapi", "Okapi"]);

	// With the keyboard: the palette's command moves the conversation in front into a group it picks.
	await row("okapi-web").locator("[role=option]").click();
	await sees(`${FRONT}[data-agent=scout][data-session=okapi-web]`);
	await menu("palette");
	await page.keyboard.type(await calledInPalette("c:group"));
	await page.keyboard.press("Enter");
	await sees("[data-slot=dialog-content] [role=option] >> text=Okapi");
	await page.keyboard.type("Okapi");
	await page.keyboard.press("Enter");
	await group("Okapi").locator(lineOf("okapi-web")).waitFor();
	assert.equal(await groupOf("okapi-web"), "Okapi");

	// Dragged onto the agent's line, a conversation leaves its group; a move made by another hand (here the control API) is followed.
	await drag(group("Okapi").locator(lineOf("okapi-web")), line);
	await page.waitForSelector(`[data-slot=conversation-group] ${lineOf("okapi-web")}`, { state: "detached" });
	assert.equal(await groupOf("okapi-web"), undefined);
	assert.ok((await api("POST", "/agents/scout/group", { session: "llama", group: "Okapi" })).ok);
	await group("Okapi").locator(lineOf("llama")).waitFor();

	// Sorted by name, from the agent's menu: the daemon keeps the order, and the group's conversations stand in it.
	await offered(line, "name");
	await until(order, (o) => o === "name", "the order the daemon keeps for scout's conversations");
	await page.waitForFunction(() => [...document.querySelectorAll("[data-slot=conversation-group] [data-slot=sidebar-menu-item][data-session]")].map((e) => e.getAttribute("data-session")).join() === "llama,okapi-api,okapi-try");
	// Renamed from the group's own menu, which also removes it.
	const ofGroup = await offered(group("Okapi").locator("[data-slot=group-label]"), "rename");
	assert.ok(ofGroup.includes("rename") && ofGroup.includes("remove"), ofGroup.join());
	await page.fill("[data-slot=dialog-content] [data-slot=command-input]", "Okapi 2026");
	await page.keyboard.press("Enter");
	await group("Okapi 2026").locator(lineOf("okapi-try")).waitFor();
	await shot("16-groups");

	// Removing the group asks first, by its name, and takes its conversations with it.
	await offered(group("Okapi 2026").locator("[data-slot=group-label]"), "remove");
	await sees("[role=alertdialog] >> text=Okapi 2026");
	assert.equal(await page.locator("[role=alertdialog] [data-slot=command-item][data-value=no]").count(), 1, "there is a way back");
	await page.click("[role=alertdialog] [data-slot=command-item][data-value=yes]");
	await group("Okapi 2026").waitFor({ state: "detached" });
	await until(async () => ((await api("GET", "/agents/scout/sessions")).data as any[]).map((c) => c.session), (all) => !all.includes("okapi-api") && !all.includes("okapi-try") && !all.includes("llama") && all.includes("okapi-web"), "what was in the group is gone, and what was taken out before stays");
	await row("okapi-api").waitFor({ state: "detached" });
	assert.deepEqual([await row("okapi-api").count(), await row("llama").count(), await row("okapi-web").count()], [0, 0, 1]);
	await offered(line, "recent");
	await until(order, (o) => o === "recent", "the order the daemon keeps for scout's conversations");
	// As it was before: the tab this test opened closed, its conversation gone.
	await page.click(`${TAB}[data-session=okapi-web] ${CLOSE}`);
	await page.waitForSelector(`${TAB}[data-session=okapi-web]`, { state: "detached" });
	assert.ok((await api("POST", "/agents/scout/remove", { session: "okapi-web" })).ok);
});

test("a conversation is opened from the palette with the keyboard alone", async () => {
	await menu("palette");
	await sees("[data-slot=dialog-content] [role=listbox]");
	await named(/./);
	assert.ok(await announced("[data-slot=dialog-content]"), "the palette has a name a screen reader says");
	await page.keyboard.press("Tab");
	await stillInside();
	await page.keyboard.press("Shift+Tab");
	await stillInside();
	assert.equal((await activeOption()).role, "combobox");
	await page.keyboard.type("where is the okapi");
	// A conversation that is not open is found by its name ("s:"), and the results keep their group headers.
	await sees("[data-slot=command-item][data-value^='s:scout:'] >> text=where is the okapi invoice");
	assert.ok((await page.locator("[data-slot=dialog-content] [cmdk-group-heading]").count()) > 0);
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowUp");
	await named(/where is the okapi invoice/);
	const at = await activeOption();
	assert.deepEqual([at.option, at.selected, at.list], ["option", "true", true], JSON.stringify(at));
	await page.keyboard.press("Enter");
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await frontNamed("where is the okapi invoice");
	await page.keyboard.press("Escape");
	await closeFront();
});

test("the palette finds things by name, and the event log follows", async () => {
	// The pointer rests where the list will open: the first line is still the one that enter takes.
	await page.mouse.move(640, 320);
	await menu("palette");
	await sees("[data-slot=command-input]");
	// The command that opens the event log, typed as the palette calls it.
	await page.keyboard.type(await calledInPalette("c:events"));
	await shot("10-palette");
	await page.keyboard.press("Enter");
	await sees(`${FRONT}[data-kind=events]`);
	// The log shows what happened so far, a line for each event.
	await sees("[data-log=events] [data-slot=collapsible-trigger]");
	await shot("11-events");
});

test("an event is published from the event log with a form: a topic, and a payload checked to be JSON before it is sent", async () => {
	await page.click("[data-slot=group-body] [data-action=publish]");
	await sees("[data-slot=publish-form]");
	// The topic field has the focus; a payload that is not JSON is said under its field, and nothing is sent.
	await page.keyboard.type("house/mode");
	await page.fill("#publish-payload", "{value: away}");
	await page.click("[data-slot=publish-form] [data-action=send]");
	await sees("[data-slot=publish-form] [data-slot=field-error]");
	assert.equal(await page.getAttribute("#publish-payload", "aria-invalid"), "true");
	assert.equal(((await (await ask(home, "GET", "/events?topic=house/mode")).json()) as unknown[]).length, 0, "nothing was sent");
	await shot("11b-publish-wrong");
	await page.fill("#publish-payload", '{"value": "away"}');
	await page.press("#publish-payload", "ControlOrMeta+Enter");
	await page.waitForSelector("[data-slot=publish-form]", { state: "detached" });
	await sees("[data-log=events] [data-slot=collapsible-trigger] >> text=house/mode");
	// The daemon got what /emit sends: the topic, the payload as JSON, from the owner.
	const events = (await (await ask(home, "GET", "/events?topic=house/mode")).json()) as Array<{ payload: unknown; trust: string }>;
	assert.deepEqual(events.map((e) => [e.payload, e.trust]), [[{ value: "away" }, "owner"]]);
});

test("the event log follows its end while new events come, holds still once scrolled up, and its button goes back to the latest", async () => {
	const publish = async (from: number, n: number) => {
		for (let i = from; i < from + n; i++) await ask(home, "POST", "/events", { topic: `test/follow-${i}`, payload: i });
	};
	const log = "[data-log=events]";
	const button = `[data-slot=message-scroller]:has(${log}) [data-slot=message-scroller-button]`;
	// At its end: nothing of the log is left below what is in view. (What following is, so asked of the scroller itself.)
	const atEnd = () => page.waitForFunction((s: string) => { const el = document.querySelector(s)!; return el.scrollHeight - el.scrollTop - el.clientHeight < 2; }, log, { timeout: patient(10_000) });
	const offers = (back: boolean) => page.waitForFunction(([s, want]: [string, string]) => document.querySelector(s)?.getAttribute("data-active") === want, [button, String(back)], { timeout: patient(10_000) });
	await publish(0, 60);
	await sees(`${log} [data-slot=collapsible-trigger] >> text=test/follow-59`);
	await atEnd();
	await offers(false);
	// Scrolled up by the reader: new events come and the view holds still, with the way back to the latest.
	await page.hover(log);
	await page.mouse.wheel(0, -400);
	await offers(true);
	const held = await page.$eval(log, (el: Element) => el.scrollTop);
	await publish(60, 10);
	await sees(`${log} [data-slot=collapsible-trigger] >> text=test/follow-69`);
	await drawn();
	assert.equal(await page.$eval(log, (el: Element) => el.scrollTop), held, "the view moved under the reader");
	await offers(true);
	await page.click(button);
	await atEnd();
	await offers(false);
});

test("a sub-agent's work opens in a tab of its own", async () => {
	await page.click(`${TAB} >> nth=0`);
	mock.state.scripts.child = [{ text: "hi from the child" }];
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "subagent", args: { tasks: ["@@REF:child@@ say hi"] } }] }, { text: "the sub-agent answered" }], "ask a helper "));
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=the sub-agent answered");
	await page.click("[data-item=work] > [data-slot=trace-collapsible-trigger] >> nth=-1");
	await sees("[data-part=child] [data-slot=trace-line]");
	await page.click("[data-part=child] [data-slot=trace-line] >> nth=0");
	await sees(`${FRONT}[data-kind=task]`);
	await sees("[data-slot=markdown] >> text=hi from the child");
	await shot("12-task");
	await closeFront();
});

test("the last message is taken back, and its text is in the input again", async () => {
	await page.click(`${TAB} >> nth=0`);
	const had = await page.$$eval("[data-item=user]", (els: Element[]) => els.length);
	await menu("undo");
	await page.waitForFunction((n: number) => document.querySelectorAll("[data-item=user]").length === n, had - 1, { timeout: patient(20_000) });
	assert.match(await page.inputValue("[data-slot=composer] textarea"), /^ask a helper /);
	await page.fill("[data-slot=composer] textarea", "");
});

test("a message further back is gone back to from its own actions: it and every later one are taken back, and its text is in the input", async () => {
	await page.click(`${TAB} >> nth=0`);
	const had = await page.$$eval("[data-item=user]", (els: Element[]) => els.length);
	for (const word of ["REWIND-ONE", "REWIND-TWO", "REWIND-THREE"]) {
		await page.fill("[data-slot=composer] textarea", mockMsg([{ text: `answer to ${word}` }], `${word} `));
		await page.keyboard.press("Enter");
		await sees(`[data-slot=markdown] >> text=answer to ${word}`);
	}
	const first = page.locator("[data-item=user]:has-text('REWIND-ONE')");
	// Its actions show while the pointer is on it.
	await first.hover();
	await first.locator("[data-action=rewind]").click();
	await page.waitForFunction((n: number) => document.querySelectorAll("[data-item=user]").length === n, had, { timeout: patient(20_000) });
	await sees("[data-slot=marker][data-kind=undo]");
	assert.match(await page.inputValue("[data-slot=composer] textarea"), /^REWIND-ONE /);
	assert.equal(await page.locator("[data-slot=markdown]:has-text('answer to REWIND')").count(), 0);
	// The text is back to be edited: the input has the focus.
	await page.waitForFunction(() => document.activeElement?.matches("[data-slot=composer] textarea"), undefined, { timeout: patient(5_000) });
	// A redo brings the message back into the conversation, and takes its text out of the input.
	await menu("redo");
	await sees("[data-slot=markdown] >> text=answer to REWIND-ONE");
	await page.waitForFunction(() => (document.querySelector("[data-slot=composer] textarea") as HTMLTextAreaElement | null)?.value === "", undefined, { timeout: patient(5_000) });
	// Back to where the test began: the three messages taken back again.
	await first.hover();
	await first.locator("[data-action=rewind]").click();
	await page.waitForFunction((n: number) => document.querySelectorAll("[data-item=user]").length === n, had, { timeout: patient(20_000) });
	await page.fill("[data-slot=composer] textarea", "");
});

test("a message is branched from: a new conversation with what was said up to it, under the original in the side bar", async () => {
	await page.click(`${TAB} >> nth=0`);
	await menu("new");
	await sees(`${FRONT}[data-agent=main]:not([data-session=main])`);
	const from = (await page.getAttribute(FRONT, "data-session"))!;
	for (const word of ["BRANCH-ONE", "BRANCH-TWO"]) {
		await page.fill("[data-slot=composer] textarea", mockMsg([{ text: `answer to ${word}` }], `${word} `));
		await page.keyboard.press("Enter");
		await sees(`[data-slot=markdown] >> text=answer to ${word}`);
	}
	// A right click on a message of the owner's offers it.
	await noteMenus();
	assert.ok((await offered(page.locator("[data-item=user]:has-text('BRANCH-ONE')"), "branch")).includes("branch"));
	// The branch comes to the front: another conversation of the same agent, which the daemon says was made from this one.
	await sees(`${FRONT}[data-agent=main]:not([data-session=main]):not([data-session="${from}"])`);
	const branch = (await page.getAttribute(FRONT, "data-session"))!;
	const kept = await until(async () => ((await api("GET", "/agents/main/sessions")).data as any[]).find((c) => c.session === branch), (c) => c?.branch, "the daemon does not know the branch");
	assert.equal(kept.branch.from, from);
	// It has what was said up to that message, and nothing after it.
	await sees("[data-slot=markdown] >> text=answer to BRANCH-ONE");
	assert.equal(await page.locator("[data-slot=message-scroller-content] >> text=BRANCH-TWO").count(), 0);
	// In the side bar it is right under the conversation it was made from.
	await sees(`#sidebar-panel ${lineOf(branch)}[data-branch-of="${from}"]`, 10_000);
	const rows: string[] = await page.$$eval("#sidebar-panel [data-slot=sidebar-menu-item][data-session]", (els: Element[]) => els.map((e) => e.getAttribute("data-session") ?? ""));
	assert.equal(rows[rows.indexOf(branch) - 1], from, JSON.stringify(rows));
	// Its top line is a path: the conversation it was made from, then itself; the one before opens with a click.
	const head = (session: string) => `[data-slot=conversation-head][data-session="${session}"]`;
	await sees(`${head(branch)} [data-slot=breadcrumb-link]`);
	await page.click(`${head(branch)} [data-slot=breadcrumb-link]`);
	await sees(`${FRONT}[data-session="${from}"]`);
	await sees(head(from));
	assert.equal(await page.locator(`${head(from)} [data-slot=breadcrumb-link]`).count(), 0, "the original has nothing before it");
	await page.click(`${TAB}[data-session="${branch}"]`);
	await sees(`${FRONT}[data-session="${branch}"]`);
	await shot("15-branch");
	// What is said in the branch stays there.
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "only in the branch" }], "BRANCH-THREE "));
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=only in the branch");
	await page.click(`${TAB}[data-session="${from}"]`);
	await sees(head(from));
	await sees("[data-slot=markdown] >> text=answer to BRANCH-TWO");
	assert.equal(await page.locator("[data-slot=message-scroller-content] >> text=only in the branch").count(), 0);
	await closeFront();
	await page.click(`${TAB}[data-session="${branch}"] ${CLOSE}`);
	await page.click(`${TAB} >> nth=0`);
	await sees("[data-slot=composer] textarea");
});

test("a conversation moves into a worktree of its folder: the chip names the branch, and its work is merged from the panel", async () => {
	// The folder has a change that is not committed (the setup made it).
	const uncommitted = fs.readFileSync(path.join(folder, "src", "index.ts"), "utf8");
	await menu(`folder:${folder}`);
	// It asks which agent works there (the main agent is the one marked), then the conversation is called by the folder.
	await confirm("[data-slot=dialog-content] [data-slot=command-item][data-value=main]");
	await frontNamed("pine-desktop-folder");
	await menu("worktree");
	await confirm("[data-slot=dialog-content] [data-slot=command-item][data-value=make]");
	await sees("[data-slot=conversation-head] [data-worktree]");
	// The chip carries the branch, which is pine's own (pine/<name>).
	const branch = (await page.getAttribute("[data-slot=conversation-head] [data-worktree]", "data-worktree"))!;
	assert.match(branch, /^pine\/./);
	const tree = path.join(folder, ".pine", "worktrees", branch.slice(5));
	assert.ok(fs.existsSync(path.join(tree, "README.md")), "a checkout of its own");
	// The side bar says where it works, once something was said in it.
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "working apart" }], "APART "));
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=working apart");
	await sees(`#sidebar-panel [data-slot=sidebar-menu-item][data-worktree="${branch}"]`);

	// Its work, committed there as an agent would, is merged from the panel into what the folder has checked out.
	fs.writeFileSync(path.join(tree, "WORKTREE.md"), "made apart\n");
	execFileSync("git", ["-C", tree, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "add", "WORKTREE.md"], { stdio: "ignore" });
	execFileSync("git", ["-C", tree, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "apart"], { stdio: "ignore" });
	const panel = "[data-slot=code-panel]";
	await menu("code-changes");
	await page.click(`${panel} [role=tab][data-view=files]`);
	await page.click(`${panel} [role=tab][data-view=changes]`);
	// The changes say how far the worktree is ahead: the one commit.
	await sees(`${panel} [data-slot=changes-head][data-range=changes][data-ahead='1']`);
	// Which changes is a switch of two: what the last message changed, and back to all of them.
	const range = (which: string) => `${panel} [data-slot=toggle-group-item][data-range=${which}]`;
	await page.click(range("turn"));
	await sees(`${panel} [data-slot=changes-head][data-range=turn]`);
	assert.equal(await page.getAttribute(range("turn"), "aria-pressed"), "true");
	await page.click(range("changes"));
	await sees(`${panel} [data-slot=changes-head][data-range=changes][data-ahead='1']`);
	await shot("16-worktree");
	await page.click(`${panel} [data-action=worktree]`);
	// What it offers is asked in a dialog that a stray click does not answer (discarding is among it); merging is the first, which Enter takes.
	await confirm("[data-slot=command-item][data-value=merge]");
	await until(() => fs.existsSync(path.join(folder, "WORKTREE.md")), Boolean, "the worktree's commit did not reach the folder", patient(20_000));
	assert.equal(fs.readFileSync(path.join(folder, "WORKTREE.md"), "utf8"), "made apart\n");
	assert.equal(fs.readFileSync(path.join(folder, "src", "index.ts"), "utf8"), uncommitted, "what was not committed in the folder stayed");

	// Discarded once merged: the folder's chip is back.
	await until(async () => ((await api("GET", "/agents/main/sessions")).data as any[]).find((c) => c.worktree?.branch === branch), Boolean, "the daemon lost the worktree before it was discarded");
	await menu("worktree");
	await sees("[data-slot=command-item][data-value=discard]");
	await page.click("[data-slot=command-item][data-value=discard]");
	await sees("[data-slot=conversation-head] [data-folder]");
	assert.equal(await page.getAttribute("[data-slot=conversation-head] [data-folder]", "data-folder"), folder);
	await until(() => fs.existsSync(tree), (there) => !there, "the discarded worktree is still on the disk");

	// A worktree made for it by another hand (a terminal UI on the same daemon) shows here too, and so does its end:
	// the call goes past the window's own model, which is told only that the conversation changed.
	const session = ((await api("GET", "/agents/main/folders")).data as Array<{ session: string; folder: string }>).find((u) => u.folder === folder)!.session;
	const made = await api("POST", "/agents/main/worktree", { session, name: "elsewhere" });
	assert.ok(made.ok, JSON.stringify(made));
	await sees("[data-slot=conversation-head] [data-worktree='pine/elsewhere']");
	const ended = await api("POST", "/agents/main/worktree/remove", { session });
	assert.ok(ended.ok, JSON.stringify(ended));
	await sees("[data-slot=conversation-head] [data-folder]");
	await closeFront();
});

test("dictating puts what is heard into the input and sends nothing", async () => {
	// A conversation in front, whichever tab the test before left there: the main agent's.
	await page.click(`${TAB}[data-agent=main][data-session=main]`);
	await sees("[data-slot=conversation-head][data-agent=main][data-session=main]");
	const sent = await page.$$eval("[data-item=user]", (els: Element[]) => els.length);
	await page.fill("[data-slot=composer] textarea", "Typed first:");
	await menu("voice");
	await sees("[data-notice=voice][data-state=listening]");
	await page.waitForFunction(() => (document.querySelector("[data-slot=composer] textarea") as HTMLTextAreaElement).value === "Typed first: about the scans", undefined, { timeout: patient(8000) }).catch(async () => {
		throw new Error(`what was heard is not in the input, which holds: ${JSON.stringify(await page.inputValue("[data-slot=composer] textarea"))}; ${await page.evaluate(() => [...document.querySelectorAll("[data-slot=alert], [data-slot=toast]")].map((e) => e.textContent).join(" | "))}`);
	});
	// Enter says "that was all": the rest arrives, and the message is still only text in the input.
	await page.focus("[data-slot=composer] textarea");
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => (document.querySelector("[data-slot=composer] textarea") as HTMLTextAreaElement).value === "Typed first: about the scans please");
	await page.waitForSelector("[data-notice=voice]", { state: "detached" });
	assert.equal(await page.$$eval("[data-item=user]", (els: Element[]) => els.length), sent);
	await page.fill("[data-slot=composer] textarea", "");
});

test("find marks what is looked for", async () => {
	// Looked for: a word of the test's own, said in the main agent's conversation and repeated in its answer.
	await page.click(`${TAB}[data-agent=main][data-session=main]`);
	await sees("[data-slot=conversation-head][data-agent=main][data-session=main]");
	await page.fill("[data-slot=composer] textarea", "where does the heron nest");
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=ECHO[where does the heron nest]");
	const said = "heron";
	await menu("find");
	await sees("[data-find=conversation] [data-field=find]");
	await page.keyboard.type(said);
	await sees("[data-find=conversation][data-count]:not([data-count='0'])");
	assert.ok(await page.evaluate(() => ((CSS as any).highlights.get("pine-find")?.size ?? 0) > 0));
	await shot("13-find");
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-find=conversation]", { state: "detached" });
});

test("with more tabs than the row has room for, the one that comes to the front is brought into view", async () => {
	await page.click(`${TAB} >> nth=0`);
	const had = await page.locator(TAB).count();
	for (let i = 0; i < 20; i++) {
		await menu("new");
		await page.waitForFunction((n: number) => document.querySelectorAll("[data-slot=tab]").length === n, had + i + 1);
	}
	// In view: the middle of the tab in front lies within what its row shows of its tabs. (Scrolling to it is what this is about.)
	const frontInView = () =>
		page.waitForFunction(
			() => {
				const tab = document.querySelector("[data-slot=tab][data-active]");
				const strip = tab?.closest("[data-slot=group-bar]")?.querySelector("[data-slot=scroll-area-viewport]")?.getBoundingClientRect();
				if (!tab || !strip) return false;
				const r = tab.getBoundingClientRect();
				return (r.left + r.right) / 2 > strip.left && (r.left + r.right) / 2 < strip.right;
			},
			undefined,
			{ timeout: patient(5000) },
		);
	const firstInFront = (is: boolean) => page.waitForFunction((is: boolean) => document.querySelector("[data-slot=tab]")?.hasAttribute("data-active") === is, is, { timeout: patient(5000) });
	// The newest, at the end of the row, is in view. From the first tab, the one before it is the last of the row again: brought into view too.
	await firstInFront(false);
	await frontInView();
	await page.click(`${TAB} >> nth=0`);
	await firstInFront(true);
	await frontInView();
	await menu("prev-tab");
	await firstInFront(false);
	await frontInView();
	await shot("many-tabs");
	while ((await page.locator(TAB).count()) > had) await page.click(`${TAB} >> nth=-1 >> ${CLOSE}`);
});

test("a right click on a tab closes the others, those to its right or all of them, main's too, and pins; what is asked stays answerable", async () => {
	// The tabs of before, put back at the end for the tests after this one (the daemon keeps them).
	const before = (await api("GET", "/ui/tabs")).data;
	const tabs = page.locator(TAB);
	const count = (n: number) => page.waitForFunction((n: number) => document.querySelectorAll("[data-slot=tab]").length === n, n);
	const opened = async (at: number) => {
		await tabs.nth(at).click({ button: "right" });
		await sees("[data-slot=context-menu-content]");
		return page.locator("[data-slot=context-menu-content]");
	};
	/** Picks from a tab's menu by what the item does (TabMenuAction), not by what it is called. */
	const choose = async (at: number, action: string) => {
		await (await opened(at)).locator(`[role=menuitem][data-action=${action}]`).click();
		await page.waitForSelector("[data-slot=context-menu-content]", { state: "detached" });
	};
	const main: number = await page.$$eval(TAB, (all: Element[]) => all.findIndex((t) => t.getAttribute("data-agent") === "main" && t.getAttribute("data-session") === "main"));
	assert.ok(main >= 0, "the main agent's tab is open");
	// main's own tab offers Pin, and it cannot be chosen: an agent's main conversation always stays.
	const menuOfMain = await opened(main);
	assert.equal(await menuOfMain.locator("[role=menuitem][data-action=pin]").getAttribute("aria-disabled"), "true");
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=context-menu-content]", { state: "detached" });
	await tabs.nth(main).click();
	const had = await tabs.count();
	for (let i = 1; i <= 3; i++) {
		await menu("new");
		await count(had + i);
	}
	// Close to the Right of the second new one: the third goes.
	await choose(had + 1, "right");
	await count(had + 2);
	// Pin and Unpin are one entry that says which; a conversation is kept once something was said in it.
	await tabs.nth(had + 1).click();
	await page.fill("[data-slot=composer] textarea", "keep this one");
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=ECHO[keep this one]");
	const keptTab = `${TAB}[data-session="${await tabs.nth(had + 1).getAttribute("data-session")}"]`;
	await choose(had + 1, "pin");
	await sees(`${keptTab}[data-pinned]`);
	await choose(had + 1, "unpin");
	await page.waitForSelector(`${keptTab}[data-pinned]`, { state: "detached" });
	// The first new one waits for an approval, put off for later.
	await tabs.nth(had).click();
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "bash", args: { command: "echo tabs" } }] }, { text: "done with tabs" }], "ask and close "));
	await page.keyboard.press("Enter");
	await sees("[data-slot=dialog-content] [data-action=allow]");
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await tabs.nth(had).locator("[data-waiting]").waitFor();
	// Close Others from the second: every other tab goes, main's too, but the one that waits for an answer stays.
	await choose(had + 1, "others");
	await count(2);
	assert.equal(await tabs.nth(0).locator("[data-waiting]").count(), 1, "the tab that stayed is the one that waits");
	assert.notEqual(await tabs.nth(1).getAttribute("data-active"), null);
	assert.equal(await page.locator(`${TAB}[data-agent=main][data-session=main]`).count(), 0);
	// Close closes that tab alone.
	await (await opened(1)).locator("[role=menuitem][data-action=close]").click();
	await count(1);
	// A tab that waits is closed by its own button: what was asked goes to the tab in front, and is answered there.
	await menu("new");
	await count(2);
	await tabs.nth(0).hover();
	await tabs.nth(0).locator(CLOSE).click();
	await count(1);
	await tabs.nth(0).locator("[data-waiting]").waitFor();
	const asked = '[data-item="approval"][data-state="open"] [data-slot="item"]';
	await sees(asked);
	assert.match((await page.textContent(asked)) ?? "", /echo tabs/, "the command the test asked for is the one put to the owner");
	await page.click(`${asked} [data-action=allow]`);
	await sees('[data-item="approval"][data-state="allowed"]');
	// Close All closes the last tab too: the window says that none is open, and opens one again from there.
	await choose(0, "all");
	await count(0);
	await sees("[data-slot=no-tab]");
	await shot("no-tab");
	await page.click("[data-slot=no-tab] [data-action=open-main]");
	await sees(`${FRONT}[data-agent=main][data-session=main]`);
	await api("POST", "/ui/tabs", before);
	await page.reload();
	await sees(FRONT);
	// The reload drew the side panel before the tests after this one change what it shows: it is put away, and they open it afresh.
	if (await page.$("[data-slot=code-panel]")) {
		await menu("code");
		await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
	}
});

test("a phone-wide window lays the side bar and the panel over the conversation, and a wide one puts them back beside it", async () => {
	// The page's size, as the start of this file sets it (the window's own size does not count while the driver sets one).
	const size = (width: number, height: number) => page.setViewportSize({ width, height });
	const sheet = "[data-slot=sidebar][data-mobile=true]";
	try {
		await page.click(`${TAB} >> nth=0`);
		await sees("#sidebar-panel [data-slot=sidebar]");
		const wide: number = await page.$eval("#sidebar-panel [data-slot=sidebar]", (el: Element) => Math.round(el.getBoundingClientRect().width));
		if (await page.$("[data-slot=code-panel]")) await menu("code");
		await size(380, 760);
		// No column: the side bar is stock's sheet, closed until it is asked for.
		await page.waitForSelector("#sidebar-panel", { state: "detached" });
		assert.equal(await page.locator(sheet).count(), 0);
		await page.locator("[data-sidebar=trigger]").first().click();
		await sees(`${sheet} [data-slot=agent-label]`);
		// Picking a conversation in it puts it away again.
		await page.locator(`${sheet} [role=option]`).first().click();
		await page.waitForSelector(sheet, { state: "detached" });
		// The menu's Toggle Sidebar opens the sheet and leaves the owner's choice of a column as it was.
		await menu("sidebar");
		await sees(sheet);
		await page.keyboard.press("Escape");
		await page.waitForSelector(sheet, { state: "detached" });
		// The side panel is a sheet over the conversation, and closing the sheet closes the panel. No groups: one row of tabs.
		await menu("code-agent");
		await sees("[data-slot=sheet-content] [data-slot=code-panel]");
		assert.equal(await page.locator("[data-slot=dock]").count(), 0);
		await page.keyboard.press("Escape");
		await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
		// The browser is the side panel's: the menu's item opens the sheet on it, and again puts it away.
		await menu("browser");
		await sees("[data-slot=sheet-content] [data-slot=code-panel] [role=tab][data-view=browser][aria-selected=true]");
		await menu("browser");
		await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
		assert.equal(await page.locator("[data-slot=sheet-content]").count(), 0);
		// Between a phone and a laptop: the side bar has room for its column, the panel beside the conversation does not.
		await size(900, 760);
		await sees("#sidebar-panel [data-slot=sidebar]");
		await menu("code-agent");
		await sees("[data-slot=sheet-content] [data-slot=code-panel]");
		await menu("code");
		await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
		// Wide again: the side bar is a column again, as wide as the owner left it.
		await size(1280, 820);
		await sees("#sidebar-panel [data-slot=sidebar]");
		await page.waitForFunction((was: number) => Math.round(document.querySelector("#sidebar-panel [data-slot=sidebar]")?.getBoundingClientRect().width ?? 0) === was, wide, { timeout: patient(5000) });
		assert.equal(await page.locator(sheet).count(), 0);
	} finally {
		// The tests after this one have the width the start of this file set, whatever failed here.
		await size(1280, 820);
	}
});

test("a window too narrow for groups shows one row of all their tabs, and the groups come back as they were when it is wide", async () => {
	const size = (width: number, height: number) => page.setViewportSize({ width, height });
	const gone = (sel: string) => page.waitForSelector(sel, { state: "detached" });
	const names = () => page.$$eval("[data-slot=tab] [data-slot=tab-name]", (els: Element[]) => els.map((e) => (e.textContent ?? "").trim()));
	const bars = (n: number) => page.waitForFunction((n: number) => document.querySelectorAll("[data-slot=group-bar]").length === n, n);
	try {
		await page.click(`${TAB} >> nth=0`);
		if (await page.$("[data-slot=code-panel]")) await menu("code");
		// Wide: main's tab and a new conversation, the new one split off to the right of it, and the side panel beside them.
		const tabs = await page.locator(TAB).count();
		await menu("new");
		await page.waitForFunction((n: number) => document.querySelectorAll("[data-slot=tab]").length > n, tabs);
		await page.locator(FRONT).click({ button: "right" });
		await page.locator("[role=menuitem][data-action=split-right]").click();
		await bars(2);
		await menu("code-files");
		await bars(3);
		const wide = await names();
		const arranged = await groups();
		// Narrow: one row of every tab, the panel's own tab is not in it, and the panel is a sheet that is asked for.
		await size(900, 760);
		await gone("[data-slot=dock]");
		assert.deepEqual(await names(), wide);
		assert.equal(await page.locator("[data-slot=pane-tab]").count(), 0);
		assert.equal(await page.locator("[data-slot=sheet-content]").count(), 0, "no sheet comes up by itself");
		await sees(`${CODE_TOGGLE}[aria-pressed=false]`);
		await page.click(CODE_TOGGLE);
		await sees("[data-slot=sheet-content] [data-slot=code-panel]");
		await page.keyboard.press("Escape");
		await gone("[data-slot=code-panel]");
		// Wide again: the groups and the side panel as they were.
		await size(1280, 820);
		await sees("#code-panel [data-slot=code-panel]");
		await bars(3);
		assert.deepEqual(await groups(), arranged);
		await menu("close");
		await bars(2);
		await menu("code");
		await gone("[data-slot=code-panel]");
		await bars(1);
	} finally {
		await size(1280, 820);
		if (await page.$("[data-slot=code-panel]")) await menu("code");
	}
});

test("what was typed in a file and not saved stays when the panel becomes a sheet and a column again, and Escape in the editor leaves the sheet open", async () => {
	const size = (width: number, height: number) => page.setViewportSize({ width, height });
	const panel = "[data-slot=code-panel]";
	// The editor is CodeMirror, found by the class names it publishes for that (.cm-content, .cm-search, .cm-editor).
	const draft = async () => (await page.textContent(`${panel} .cm-content`)) ?? "";
	try {
		// The folder's conversation from before is in a worktree by now: a new one in the folder itself.
		await menu(`folder:${folder}`);
		await confirm("[data-slot=dialog-content] [data-slot=command-item][data-value=main]");
		await frontNamed("pine-desktop-folder");
		await menu("code-files");
		await sees(panel);
		if (!(await page.$(`${panel} .cm-content`))) {
			await page.fill(`${panel} [data-field=find-file]`, "README");
			// A click selects a file; a double click opens it.
			await page.locator(`${panel} [role=listbox] [role=option]`).first().dblclick({ timeout: patient(10_000) });
		}
		await sees(`${panel} .cm-content`);
		await page.click(`${panel} .cm-content`);
		await page.keyboard.press("ControlOrMeta+End");
		await page.keyboard.type("unsaved draft");
		const save = page.locator(`${panel} [data-action=save]`);
		assert.ok(await save.isEnabled());
		// Narrower than the room for groups: the panel is drawn again inside a sheet when it is asked for, with the draft still in it.
		await size(900, 760);
		await page.waitForSelector("[data-slot=dock]", { state: "detached" });
		await menu("code-files");
		await sees(`[data-slot=sheet-content] ${panel} .cm-content`);
		assert.match(await draft(), /unsaved draft/);
		assert.ok(await save.isEnabled());
		// Escape that closes the editor's search is the editor's, and so is one in the editor itself: the sheet stays.
		await page.click(`${panel} .cm-content`);
		await page.keyboard.press("ControlOrMeta+F");
		await sees(`${panel} .cm-search`);
		await page.keyboard.press("Escape");
		await page.waitForSelector(`${panel} .cm-search`, { state: "detached" });
		await page.keyboard.press("Escape");
		await drawn();
		assert.equal(await page.locator(`[data-slot=sheet-content] ${panel}`).count(), 1);
		// Wide again: the panel is in its group, and the draft is still there to save or to leave.
		await size(1280, 820);
		await sees(`#code-panel ${panel} .cm-content`);
		assert.match(await draft(), /unsaved draft/);
		assert.ok(await save.isEnabled());
		// Leaving the file asks first, and what was typed never reached the disk.
		await page.click(`${panel} [data-action=back]`);
		await page.click("[role=alertdialog] [data-slot=alert-dialog-action]");
		await page.waitForFunction(() => !document.querySelector("[data-slot=code-panel] .cm-editor"));
		assert.doesNotMatch(fs.readFileSync(path.join(folder, "README.md"), "utf8"), /unsaved draft/);
		await menu("code");
		await page.waitForSelector(panel, { state: "detached" });
	} finally {
		await size(1280, 820);
	}
});

// ---- the arrangement of the window: groups of tabs, as the layout (src/dock.ts) holds them -------------------------
// A tab is named here by what it shows: a conversation as "agent:session", any other tab by its kind ("settings"),
// a pane as "@code". Where a group lies is asked of the layout, which says it on the group (`data-index`: its place
// in the order the groups are drawn, left to right and top to bottom; `data-edges`: the edges of the window it
// reaches), never of the pixels it was drawn at.

/** The groups of the window in the layout's order, each as its tabs in their row's order. */
const groups = (): Promise<string[][]> =>
	page.$$eval("[data-slot=group-bar]", (bars: Element[]) =>
		bars
			.map((b) => ({
				at: Number(document.querySelector(`[data-slot=group-body][data-group="${b.getAttribute("data-group")}"]`)?.getAttribute("data-index") ?? -1),
				tabs: [...b.querySelectorAll("[data-slot=tab], [data-slot=pane-tab]")].map((t) => (t.getAttribute("data-pane") ? `@${t.getAttribute("data-pane")}` : t.getAttribute("data-session") ? `${t.getAttribute("data-agent")}:${t.getAttribute("data-session")}` : (t.getAttribute("data-kind") ?? ""))),
			}))
			.sort((a, b) => a.at - b.at)
			.map((g) => g.tabs),
	);

/** The edges of the window that the group holding a tab reaches, in a fixed order ("top left right bottom"), once it is `want`. */
const reaches = (tab: string, want: (edges: string[]) => boolean, what: string) =>
	until(
		() =>
			page.evaluate((key: string) => {
				const all = [...document.querySelectorAll("[data-slot=tab], [data-slot=pane-tab]")];
				const t = key.startsWith("@") ? all.find((t) => t.getAttribute("data-pane") === key.slice(1)) : all.find((t) => `${t.getAttribute("data-agent")}:${t.getAttribute("data-session")}` === key);
				const group = t?.closest("[data-slot=group-bar]")?.getAttribute("data-group");
				return (document.querySelector(`[data-slot=group-body][data-group="${group}"]`)?.getAttribute("data-edges") ?? "").split(" ").filter(Boolean);
			}, tab) as Promise<string[]>,
		want,
		what,
	);

/**
 * Drags a tab onto a group (the one holding the tab `onto`), at a zone of its body; "window-left" and the like are
 * right at that edge of the body, in the band along the window's edge. The point is where the tab is let go: what
 * the page takes it for is read back from the zone it marks (`data-zone`) before the drop.
 */
const dragTo = (tab: string, onto: string, zone: "center" | "left" | "right" | "top" | "bottom" | "window-left" | "window-right" | "window-bottom") =>
	page.evaluate(
		async ([tab, onto, zone]: readonly [string, string, string]) => {
			const all = [...document.querySelectorAll("[data-slot=tab], [data-slot=pane-tab]")];
			const find = (key: string) => (key.startsWith("@") ? all.find((t) => t.getAttribute("data-pane") === key.slice(1)) : all.find((t) => `${t.getAttribute("data-agent")}:${t.getAttribute("data-session")}` === key));
			const from = find(tab);
			const to = find(onto)?.closest("[data-slot=group-bar]")?.getAttribute("data-group");
			if (!from || !to) throw new Error(`no tab ${from ? onto : tab}`);
			const dataTransfer = new DataTransfer();
			from.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
			let zones: Element | undefined;
			for (let i = 0; i < 100 && !zones; i++) {
				await new Promise((r) => setTimeout(r, 20));
				zones = document.querySelector(`[data-slot=drop-zones][data-group="${to}"]`) ?? undefined;
			}
			if (!zones) throw new Error("no drop zones were drawn");
			const r = zones.getBoundingClientRect();
			const at = ({ center: [0.5, 0.5], left: [0.15, 0.5], right: [0.85, 0.5], top: [0.5, 0.15], bottom: [0.5, 0.85], "window-left": [0, 0.5], "window-right": [1, 0.5], "window-bottom": [0.5, 1] } as Record<string, number[]>)[zone];
			// A pixel inside the body at its very edge.
			const point = { clientX: Math.min(r.right - 2, Math.max(r.left + 2, r.left + r.width * at[0])), clientY: Math.min(r.bottom - 2, Math.max(r.top + 2, r.top + r.height * at[1])) };
			zones.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer, ...point }));
			for (let i = 0; i < 50 && zones.getAttribute("data-zone") !== zone; i++) await new Promise((r) => requestAnimationFrame(r));
			if (zones.getAttribute("data-zone") !== zone) throw new Error(`the zone under the pointer is ${zones.getAttribute("data-zone")}, not ${zone}`);
			zones.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, ...point }));
			// Taken, as a real drop on the window says: a drag that ends with "none" is one let go outside, and tears the tab off.
			dataTransfer.dropEffect = "move";
			from.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer, ...point }));
		},
		[tab, onto, zone] as const,
	);
/** The window is told of no drag any more. */
const dropped = () => page.waitForSelector("[data-slot=dock]:not([data-dropping])");
const bars = (n: number) => page.waitForFunction((n: number) => document.querySelectorAll("[data-slot=group-bar]").length === n, n);

test("tabs and the side panel are dragged into groups beside and under each other, and the side panel follows the conversation in front", async () => {
	const tabs = await page.locator(TAB).count();
	const MAIN = "main:main";
	try {
		await page.setViewportSize({ width: 1800, height: 900 });
		await page.click(`${TAB} >> nth=0`);
		if (await page.$("[data-slot=code-panel]")) await menu("code");
		await sees(`${FRONT}[data-agent=main][data-session=main]`);
		assert.equal((await groups()).length, 1);
		// A second conversation, dragged to the right edge of the group: a group of its own beside main's.
		await menu("new");
		await sees(`${FRONT}[data-agent=main]:not([data-session=main])`);
		const session = (await page.getAttribute(FRONT, "data-session"))!;
		const fresh = `main:${session}`;
		await dragTo(fresh, MAIN, "right");
		await bars(2);
		const [left, right] = await groups();
		assert.ok(left.includes(MAIN) && !left.includes(fresh) && right.join() === fresh, JSON.stringify(await groups()));
		await reaches(fresh, (e) => e.join(" ") === "top right bottom", "the new group does not lie along the right of the window");
		// While a tab is dragged the window says so, and that ends with the drag.
		await dropped();
		// The side panel opens and shows the conversation in front, and another when that comes to the front.
		await page.click(CODE_TOGGLE);
		await sees("#code-panel [data-slot=code-panel]");
		await sees(`[data-slot=pane-tab][data-pane=code][data-for="${fresh}"]`);
		await page.locator(`${TAB}[data-agent=main][data-session=main]`).click();
		await sees(`[data-slot=pane-tab][data-pane=code][data-for="${MAIN}"]`);
		// Settings in front: the side panel stays with main.
		await menu("settings");
		await sees(`${FRONT}[data-kind=settings]`);
		await drawn();
		await sees(`[data-slot=pane-tab][data-pane=code][data-for="${MAIN}"]`);
		await menu("settings");
		// The side panel dragged under the new conversation: three groups, the panel below it.
		await dragTo("@code", fresh, "bottom");
		await bars(3);
		assert.deepEqual((await groups()).slice(-2), [[fresh], ["@code"]]);
		await reaches(fresh, (e) => e.includes("top") && !e.includes("bottom"), "the conversation is not the upper of the two");
		await reaches("@code", (e) => e.includes("bottom") && !e.includes("top"), "the side panel does not lie under the conversation");
		// The arrangement is the window's: loaded again, it is as it was.
		const was = await groups();
		await page.reload();
		await bars(3);
		assert.deepEqual(await groups(), was);
		// Let go at the window's left edge (over main's group, which lies along it), the side panel is a column along the whole left of the window.
		await dragTo("@code", MAIN, "window-left");
		await reaches("@code", (e) => e.join(" ") === "top left bottom", "the side panel is not a column along the left of the window");
		assert.deepEqual((await groups())[0], ["@code"]);
		// And at the right edge, a column along the whole right again.
		await dragTo("@code", fresh, "window-right");
		await reaches("@code", (e) => e.join(" ") === "top right bottom", "the side panel is not a column along the right of the window");
		assert.deepEqual((await groups()).at(-1), ["@code"]);
		// Dragged into the middle of main's group, the new conversation is a tab there again, and its group is gone.
		await dragTo(fresh, MAIN, "center");
		await bars(2);
		const joined = (await groups())[0];
		assert.ok(joined[0] === MAIN && joined.at(-1) === fresh, JSON.stringify(joined));
		// A tab let go before another in a row stands before it. (Let go over the first half of that tab.)
		await page.evaluate(([fresh, main]: string[]) => {
			const find = (session: string) => document.querySelector(`[data-slot=tab][data-agent=main][data-session="${session}"]`)!;
			const dataTransfer = new DataTransfer();
			const from = find(fresh);
			const to = find(main);
			const r = to.getBoundingClientRect();
			from.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
			to.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer, clientX: r.left + 2, clientY: r.top + 5 }));
			to.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, clientX: r.left + 2, clientY: r.top + 5 }));
			dataTransfer.dropEffect = "move";
			from.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer }));
		}, [session, "main"]);
		await until(groups, (g) => g[0]?.indexOf(fresh) === g[0]?.indexOf(MAIN) - 1, "the new conversation's tab does not stand right before main's");
		// The edge between two groups moves with the keyboard too: an arrow towards the conversations gives the side panel more of the room.
		const width = () => page.$eval("#code-panel", (el: Element) => el.getBoundingClientRect().width);
		const narrow = await width();
		await page.focus(CODE_EDGE);
		assert.equal(await page.getAttribute(CODE_EDGE, "role"), "separator");
		await page.keyboard.press("ArrowLeft");
		await page.waitForFunction((w: number) => document.querySelector("#code-panel")!.getBoundingClientRect().width > w, narrow);
		await shot("dock-groups");
		// The agent's browser_show shows the browser in the side panel, wherever the panel is.
		await page.locator(`${TAB}[data-agent=main][data-session="${session}"]`).click();
		await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "browser_show", args: {} }], text: "Have a look." }, { text: "There it is." }], "Show me the page. "));
		await page.keyboard.press("Enter");
		await sees("#code-panel [data-slot=code-panel] [role=tab][data-view=browser][aria-selected=true]");
		await sees("[data-slot=markdown] >> text=There it is.");
		await menu("code-files");
		await menu("close");
		await page.waitForFunction((n: number) => document.querySelectorAll("[data-slot=tab]").length === n, tabs);
	} finally {
		// One group again, without the panel, and the width the start of this file set, for the tests that follow.
		if (await page.$("[data-slot=code-panel]")) await menu("code");
		await page.setViewportSize({ width: 1280, height: 820 });
	}
});

test("the side panel let go at the edge of the conversation's group, again and again, stays one group beside it, and the groups are the same after a reload and in a narrower window", async () => {
	const MAIN = "main:main";
	/** The arrangement the main process keeps for the window, as the page reported it. */
	const kept = async () => (await appState()).windowLayout?.dock;
	/** Kept as two groups side by side, the second the side panel alone: no group inside a group, none left empty. */
	const beside = (d: any) => d?.kind === "split" && d.dir === "row" && d.children.length === 2 && d.children.every((c: any) => c.kind === "group" && c.items.length > 0) && JSON.stringify(d.children[1].items) === '["code"]';
	try {
		await page.setViewportSize({ width: 1280, height: 820 });
		await page.click(`${TAB} >> nth=0`);
		if (!(await page.$("[data-slot=code-panel]"))) await page.click(CODE_TOGGLE);
		await sees("#code-panel [data-slot=code-panel]");
		const opened = await until(kept, beside, "the side panel did not open as a group beside the conversation's");
		// As the owner did: picked up by its tab and let go at the right of the conversation, which gives it a larger share of the room than it opened with.
		await dragTo("@code", MAIN, "right");
		await until(kept, (d) => beside(d) && d.sizes[1] > opened.sizes[1], "the side panel did not get a larger share of the room");
		for (let i = 2; i <= 3; i++) {
			await dragTo("@code", MAIN, "right");
			await dropped();
			await drawn();
			const now = await groups();
			assert.ok(now.length === 2 && now[0].includes(MAIN) && now[1].join() === "@code", `after drag ${i}: ${JSON.stringify(now)}`);
			assert.ok(beside(await kept()), `after drag ${i}, kept as ${JSON.stringify(await kept())}`);
		}
		// So it is after a start, from the arrangement kept.
		await shot("dock-least");
		const was = await groups();
		await page.reload();
		await sees("#code-panel [data-slot=code-panel]");
		assert.deepEqual(await groups(), was);
		// A third group, and a window with less room than three groups ask for but still room for groups: all three stay.
		await menu("new");
		await sees(`${FRONT}[data-agent=main]:not([data-session=main])`);
		const fresh = `main:${await page.getAttribute(FRONT, "data-session")}`;
		await dragTo(fresh, MAIN, "right");
		await bars(3);
		const three = await groups();
		await page.setViewportSize({ width: 1060, height: 820 });
		await drawn();
		await sees("[data-slot=dock]");
		assert.deepEqual(await groups(), three, "three groups in a narrower window");
		assert.equal(await page.locator("[data-slot=dock] [data-slot=group-body]").count(), 3, "each group shows what it holds");
		// As the owner did next: one group closed, the window made wider again.
		await menu("close");
		await bars(2);
		await page.setViewportSize({ width: 1280, height: 820 });
		await drawn();
		assert.deepEqual(await groups(), was, "two groups again in a wider window");
	} finally {
		await page.setViewportSize({ width: 1280, height: 820 });
		if (await page.$("[data-slot=code-panel]")) await menu("code");
	}
});

test("another machine's pine is used from the foot of the side bar, and this Mac's again, each with its own agents", async () => {
	const settings = "[data-slot=settings-page]";
	const hosts = async () => (await appState()).prefs.hosts;
	await menu("settings:environments");
	// This computer's pine is the one in use.
	await sees(`${settings} [data-environment=local] [data-state=in-use]`);
	const input = `${settings} [data-field=host]`;
	const add = `${settings} [data-action=add]`;
	// What is not a host for ssh is refused at once, and nothing is kept.
	await page.fill(input, "-oProxyCommand=x");
	await page.click(add);
	// The refusal is the field's own: said under it, the field marked invalid, as long as the host refused is in it.
	await sees(`${settings} [data-slot=field][data-invalid] [data-slot=field-error]`);
	assert.equal(await page.getAttribute(input, "aria-invalid"), "true");
	assert.deepEqual(await hosts(), []);
	await page.fill(input, "you@elsewhere");
	assert.equal(await page.getAttribute(input, "aria-invalid"), null);
	await page.click(add);
	await sees(`${settings} [data-environment='you@elsewhere']`);
	assert.deepEqual(await hosts(), ["you@elsewhere"]);
	await shot("16-environments");

	// The foot of the side bar lists both machines; the other one is picked, and the window shows its pine.
	const radio = "[data-slot=dropdown-menu-radio-item]";
	await page.click("[data-slot=service-status]");
	await sees(`${radio}[data-host='you@elsewhere']`);
	// This computer's line is the one without a host; it is the one checked.
	assert.equal(await page.getAttribute(`${radio}:not([data-host])`, "aria-checked"), "true");
	await shot("17-machines");
	await page.click(`${radio}[data-host='you@elsewhere']`);
	await until(agentIds, (ids) => [...ids].sort().join() === "helper,main", "the side bar does not show the other machine's agents", patient(60_000));
	await sees("[data-slot=service-status][data-origin=remote]");
	assert.equal((await appState()).state.host, "you@elsewhere");
	assert.match((await page.textContent("[data-slot=service-status]")) ?? "", /elsewhere/, "the foot of the side bar names the machine");
	// Its main agent's own description (which the other home of this test gave it).
	await sees("[data-slot=empty] >> text=The main agent of the other machine");
	await page.fill("[data-slot=composer] textarea", "hello from this side");
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=ECHO[hello from this side]");
	// It went to the other machine's pine, through the forward, and not to this one's.
	const said = async (dir: string) => ((await (await ask(dir, "GET", "/tasks?agent=main&limit=100")).json()) as Array<{ prompt: string }>).find((t) => t.prompt === "hello from this side");
	assert.ok(await said(far));
	assert.equal(await said(home), undefined);
	// A command in an answer has no Run button there: the terminal is this computer's, and that agent was not told of one.
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "Run this:\n\n```bash\necho far\n```" }], "far commands "));
	await page.keyboard.press("Enter");
	const md = page.locator("[data-slot=markdown]", { hasText: "echo far" }).last();
	await md.locator("[data-slot=code-block]").first().waitFor();
	assert.equal(await md.locator("[data-run]").count(), 0);
	await shot("18-other-machine");

	// Back to this computer: its own agents and conversation, as they were; the other pine goes on, held by the app.
	const farPort = daemonOf(far).port;
	await page.click("[data-slot=service-status]");
	await page.click(`${radio}:not([data-host])`);
	const here = await until(agentIds, (ids) => ids.includes("scout"), "the side bar does not show this computer's agents again", patient(30_000));
	assert.ok(!here.includes("helper"), here.join());
	// This computer's pine again, the one the app started.
	await sees("[data-slot=service-status][data-origin=started]");
	assert.equal(await page.locator("[data-slot=message-scroller-content] >> text=hello from this side").count(), 0, "what was said to the other machine's agent is not in this one's conversation");
	assert.equal(await ours(farPort, far), true);
	assert.equal((await appState()).prefs.use, undefined);

	// Forgotten: the connection ends, and the pine the app started there with it.
	await menu("settings:environments");
	await page.click(`${settings} [data-environment='you@elsewhere'] [data-action=forget]`);
	await page.waitForSelector(`${settings} [data-environment='you@elsewhere']`, { state: "detached" });
	assert.deepEqual(await hosts(), []);
	// That it left the list, and that it was forgotten (not lost), is noted beside prefs.json.
	assert.match(fs.readFileSync(path.join(home, "desktop-data", "prefs.log"), "utf8"), /you@elsewhere[^\n]*forgotten/);
	assert.equal(await daemonGone(farPort, far), true);
	await menu("settings");
});

test("quitting stops the daemon it started", async () => {
	const { port } = daemonOf(home);
	assert.equal(await ours(port, home), true, "the daemon of this home answers while the app runs");
	await app.close();
	closed();
	// The daemon is gone with the app: its control port no longer answers.
	assert.equal(await daemonGone(port, home), true);
});
