// The app from end to end, the second half (the first is app.test.ts, which says how): what lies
// around a conversation. The side bar and its agents and groups, the palette, the event log,
// tabs, a narrow window, another machine's pine, and quitting. An app and a home of its own.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { before, test } from "node:test";
import { mockMsg } from "../../baseline/tests/mock.mjs";
import { daemonGone, ours } from "./support/daemon.ts";
import { activeOption, HERE, announced, api, app, closed, CODE_EDGE, CODE_TOGGLE, confirm, far, folder, home, json, menu, mock, named, page, sees, shot, SIDE_EDGE, started, stillInside, visit, write } from "./support/window.ts";

// The question about the browser for the web tools is app.test.ts's: here it is answered and gone.
before(() => started());

test("the side bar is the agents: one made elsewhere appears, a group folds away, and what is new says for whom", async () => {
	// An agent that another hand makes (the main agent, a `pine agent add`): asked of the daemon directly, not through the app.
	const port = /http listening on 127\.0\.0\.1:(\d+)/.exec(fs.readFileSync(path.join(home, "data", "pine.log"), "utf8"))![1];
	const token = fs.readFileSync(path.join(home, "data", "http-token"), "utf8").trim();
	const made = await fetch(`http://127.0.0.1:${port}/agents`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ id: "test", description: "Made outside the app", instructions: "You are test." }) });
	assert.equal(made.status, 200);
	await visit();
	await sees("[data-slot=agent-label] >> text=test", 20_000);
	assert.match((await page.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { has: page.locator("[data-slot=agent-label] > :first-child", { hasText: /^test$/ }) }).textContent()) ?? "", /Made outside the app/);
	// Beside a conversation, the panel's Agent view. (What it says an agent was given is app.test.ts's, after its settings.)
	await page.click("[data-slot=tab] >> nth=0");
	// The menu's item opens the side panel on its Agent view whatever state the panel is in (a toggle could close it).
	await menu("code-agent");
	await sees("[data-slot=code-panel] [role=tab][aria-selected=true] >> text=Agent");
	// The side bar is as wide as it is dragged.
	const before = await page.$eval("#sidebar-panel [data-slot=sidebar]", (el: Element) => el.getBoundingClientRect().width);
	const edge = await page.$eval(SIDE_EDGE, (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(edge.x + edge.width / 2, 300);
	await page.mouse.down();
	await page.mouse.move(edge.x + edge.width / 2 + 80, 300, { steps: 4 });
	await page.mouse.up();
	const dragged = await page.$eval("#sidebar-panel [data-slot=sidebar]", (el: Element) => el.getBoundingClientRect().width);
	assert.ok(dragged > before + 40, `dragged 80 pixels wider, the side bar is ${dragged} wide, from ${before}`);
	// The edge is a separator the keyboard moves too: focused, an arrow key makes the side bar wider.
	await page.focus(`${SIDE_EDGE}[role='separator']`, { timeout: 5000 });
	assert.ok(await page.getAttribute(SIDE_EDGE, "aria-valuenow"), "the edge says how far it is");
	await page.keyboard.press("ArrowRight");
	await page.waitForFunction((was) => document.querySelector("#sidebar-panel [data-slot=sidebar]")!.getBoundingClientRect().width > was, dragged, { timeout: 5000 });
	// Hidden, the side bar is still hidden when the page is loaded again, and shown it is as wide as it was.
	const wide = Math.round(await page.$eval("#sidebar-panel [data-slot=sidebar]", (el: Element) => el.getBoundingClientRect().width));
	await menu("sidebar");
	await page.waitForSelector("#sidebar-panel [data-slot=sidebar]", { state: "detached" });
	await page.reload();
	await sees("[data-slot=tab][data-active]");
	assert.equal(await page.locator("#sidebar-panel [data-slot=sidebar]").count(), 0);
	await menu("sidebar");
	await sees("#sidebar-panel [data-slot=sidebar]");
	assert.ok(Math.abs(Math.round(await page.$eval("#sidebar-panel [data-slot=sidebar]", (el: Element) => el.getBoundingClientRect().width)) - wide) <= 2);
	await page.reload();
	await sees("#sidebar-panel [data-slot=agent-label]");
	// An agent with one conversation is one line: nothing folds, no conversation is listed under it, and a click opens that conversation.
	const scoutLine = page.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { has: page.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }) });
	const group = page.locator("[data-slot=collapsible]:has([data-slot=agent-label])", { has: page.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }) });
	await scoutLine.locator("[data-slot=agent-conversation]").waitFor();
	assert.equal(await group.count(), 0);
	assert.equal(await scoutLine.locator("[data-slot=agent-count]").count(), 0);
	await scoutLine.locator("[data-slot=agent-label]").click();
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=scout");
	await scoutLine.locator("[data-slot=agent-conversation][data-active]").waitFor();
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
	// The plus on an agent's own line starts a conversation with that agent, and with a second conversation the line is a group that says how many it holds.
	await scoutLine.locator("button[aria-label='New conversation with scout']").click();
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=new conversation");
	assert.equal(await page.textContent("[data-slot=empty] h1"), "scout");
	assert.match(await page.textContent("[data-slot=empty]:has(h1)"), /Looks things up on the web/);
	await group.locator("[data-slot=agent-count] >> text=2 conversations").waitFor();
	assert.equal(await scoutLine.locator("[data-slot=agent-conversation]").count(), 0);
	assert.equal(await group.locator("[role=option]").count(), 2);
	// A group folds away on a click on its agent, and comes back.
	await group.locator("[data-slot=agent-label]").click();
	assert.equal(await group.locator("[role=option]").count(), 0);
	await group.locator("[data-slot=agent-label]").click();
	assert.equal(await group.locator("[role=option]").count(), 2);
	// A new conversation that is closed before anything was said in it is gone, and with one conversation left the agent is one line again.
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
	await scoutLine.locator("[data-slot=agent-conversation]").waitFor();
	assert.equal(await group.count(), 0);
	await scoutLine.locator("button[aria-label='New conversation with scout']").click();
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=new conversation");
	await shot("14-agents");
	// A conversation that was only started is called by how it began, in the side bar and on its tab.
	assert.match(await page.textContent("[data-slot=tab][data-active] [data-slot=tab-name]"), /new conversation/);
	await page.fill("[data-slot=composer] textarea", "where is the okapi invoice");
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=ECHO[where is the okapi invoice]");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=where is the okapi invoice", 15_000);
	assert.equal(await group.locator("[role=option] >> text=where is the okapi invoice").count(), 1);
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
	// Search finds a conversation by what was said in it, and opens it with the words marked.
	await menu("palette");
	await sees("[data-slot=command-input]");
	// By words that are only in an answer of the agent's, never in a name:
	await page.keyboard.type("echo[where");
	await sees("[cmdk-group-heading] >> text=In conversations");
	assert.match(await page.textContent("[data-slot=command-list]"), /scout · where is the okapi invoice[\s\S]*ECHO\[where is the okapi invoice\]/);
	await shot("15-search");
	// By words that are also its name, it is listed once, and still opens at the words.
	await page.fill("[data-slot=command-input]", "okapi invoice");
	await page.waitForFunction(() => document.querySelectorAll("[data-slot=command-item]").length > 0 && [...document.querySelectorAll("[data-slot=command-item] > :first-child")].filter((e) => /where is the okapi invoice/.test(e.textContent ?? "")).length === 1);
	await page.click("[data-slot=command-item]:has-text('scout · where is the okapi invoice')");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=where is the okapi invoice");
	await sees("[data-slot=input-group]:has(input[aria-label='Find in this conversation']) >> text=/\\d+ of \\d+/");
	assert.equal(await page.inputValue("input[aria-label='Find in this conversation']"), "okapi invoice");
	await page.keyboard.press("Escape");
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
	// Asked from where no agent is in front (the event log), a new conversation asks with whom.
	await menu("events");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=Events");
	await menu("new");
	await sees("[cmdk-group-heading] >> text=New conversation with");
	assert.ok(await page.locator("[data-slot=dialog-content] [data-slot=command-input]").isVisible(), "a short list has its field in sight too");
	assert.deepEqual(await page.$$eval("[data-slot=command-item] > :first-child", (els: Element[]) => els.map((e) => e.textContent)), ["main", "scout", "test"]);
	await page.keyboard.press("Escape");
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
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
		await sees("[data-slot=tab][data-active]", 20_000);
		await sees("[data-slot=sidebar] [data-slot=skeleton]");
		assert.equal(await page.$("[data-slot=empty]"), null, "no empty state shows before the data is there");
	} finally {
		await app.evaluate(({ ipcMain }: any) => {
			const g = globalThis as any;
			ipcMain.removeHandler("pine:call");
			ipcMain.handle("pine:call", g.realCall);
			for (const go of g.held) go();
		});
	}
	await page.waitForSelector("[data-slot=sidebar] [data-slot=skeleton]", { state: "detached", timeout: 20_000 });
	await sees("[data-slot=agent-label] >> text=main");
});

test("a conversation is opened from the side bar with the keyboard alone, and a group folds from it", async () => {
	const group = page.locator("[data-slot=collapsible]:has([data-slot=agent-label])", { has: page.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }) });
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
	for (const label of ["More for scout", "New conversation with scout"]) {
		await page.keyboard.press("Tab");
		assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), label);
	}
	await page.keyboard.press("Tab");
	const at = () => page.evaluate(() => ({ role: document.activeElement?.getAttribute("role"), text: document.activeElement?.textContent ?? "" }));
	assert.equal((await at()).role, "option");
	for (let i = 0; i < 6 && !/where is the okapi invoice/.test((await at()).text); i++) await page.keyboard.press("ArrowDown");
	assert.match((await at()).text, /where is the okapi invoice/);
	await page.keyboard.press("Enter");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=where is the okapi invoice");
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
});

test("a conversation is removed by its row's own button, which the keyboard reaches too, after a yes in a dialog that then closes", async () => {
	const group = page.locator("[data-slot=collapsible]:has([data-slot=agent-label])", { has: page.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }) });
	await group.locator("button[aria-label='New conversation with scout']").click();
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=new conversation");
	await page.fill("[data-slot=composer] textarea", "a conversation to remove");
	await page.keyboard.press("Enter");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=a conversation to remove", 15_000);
	const option = group.locator("[role=option]", { hasText: "a conversation to remove" });
	await option.focus();
	await page.keyboard.press("Tab");
	assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Remove this conversation permanently");
	await page.keyboard.press("Enter");
	const dialog = page.locator("[role=alertdialog]");
	await dialog.getByRole("button", { name: "Remove" }).click();
	await dialog.waitFor({ state: "detached" });
	await option.waitFor({ state: "detached" });
});

test("the tabs are reached with the keyboard: the arrows go from one to the next, and Enter brings it to the front", async () => {
	await menu("events");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=Events");
	await page.focus("[data-slot=tab][data-active]");
	assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "tab");
	await page.keyboard.press("ArrowLeft");
	await page.keyboard.press("Enter");
	// (A conversation brought to the front takes the keyboard into its input.)
	await page.waitForFunction(() => { const on = document.querySelector("[data-slot=tab][data-active] [data-slot=tab-name]"); return on && on.textContent !== "Events"; });
	await page.click("[data-slot=tab]:has([data-slot=tab-name]:text-is('Events')) button[aria-label='Close this tab']");
});

test("the search after the tabs lists every tab of the row, the one in front checked, finds one by name and brings it to the front", async () => {
	await menu("events");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=Events");
	const bar = "[data-slot=group-bar]:has([data-slot=tab][data-active])";
	const names = await page.$$eval(`${bar} [data-slot=tab] [data-slot=tab-name]`, (all) => all.map((e) => e.textContent));
	await page.click(`${bar} [data-slot=tab-list]`);
	await page.locator("[data-slot=combobox-content] input").waitFor();
	assert.deepEqual(await page.$$eval("[data-slot=combobox-item] [data-slot=tab-name]", (all) => all.map((e) => e.textContent)), names);
	assert.equal(await page.textContent("[data-slot=combobox-item][aria-selected=true] [data-slot=tab-name]"), "Events");
	// The keyboard is in the search: a name narrows the list, and Enter takes the first that matches.
	await page.keyboard.type(names[0]!);
	await page.keyboard.press("Enter");
	await page.locator("[data-slot=combobox-content]").waitFor({ state: "detached" });
	await sees(`[data-slot=tab][data-active] [data-slot=tab-name] >> text=${names[0]}`);
	await page.click("[data-slot=tab]:has([data-slot=tab-name]:text-is('Events')) button[aria-label='Close this tab']");
});

test("a right click on an agent renames it in place, colors it, and offers to remove it, and never the main agent", async () => {
	const port = /http listening on 127\.0\.0\.1:(\d+)/.exec(fs.readFileSync(path.join(home, "data", "pine.log"), "utf8"))![1];
	const token = fs.readFileSync(path.join(home, "data", "http-token"), "utf8").trim();
	const made = await fetch(`http://127.0.0.1:${port}/agents`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ id: "spare", description: "Not needed for long", instructions: "You are spare." }) });
	assert.equal(made.status, 200);
	await visit();
	await sees("[data-slot=agent-label] >> text=spare", 20_000);
	// The menu is the system's, which the driver cannot click in: what it would show is noted, and the test says what is picked.
	await app.evaluate(({ ipcMain }: any) => {
		const g = globalThis as any;
		g.menus = [];
		ipcMain.removeHandler("pine:context-menu");
		ipcMain.handle("pine:context-menu", (_e: unknown, items: Array<{ id: string; label: string; separator?: boolean }>) => {
			g.menus.push(items.filter((i) => !i.separator).map((i) => i.label));
			return g.pick;
		});
	});
	const shown = async (agent: string, pick?: string): Promise<string[]> => {
		const before = await app.evaluate((_e: unknown, p: string | undefined) => (((globalThis as any).pick = p), (globalThis as any).menus.length), pick);
		await page.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { has: page.locator("[data-slot=agent-label] > :first-child", { hasText: new RegExp(`^${agent}$`) }) }).click({ button: "right" });
		for (let i = 0; i < 100; i++) {
			const menus = await app.evaluate(() => (globalThis as any).menus);
			if (menus.length > before) return menus.at(-1);
			await new Promise((r) => setTimeout(r, 30));
		}
		throw new Error(`no menu for ${agent}`);
	};
	// Both agents have one conversation here, so each line is that conversation too: what its row would offer comes first, and one conversation is not sorted.
	// The main agent has nothing to remove it with.
	assert.deepEqual(await shown("main"), ["Open", "Open in New Window", "Move to Group…", "Start over…", "New conversation with main", "Open a folder with main…", "New Group…", "Rename…", "Color…", "Agent settings…"]);
	// Rename turns its name in the side bar into a field: Escape keeps the name, Enter gives it the new one, and everything follows it.
	assert.deepEqual(await shown("spare", "rename"), ["Open", "Open in New Window", "Move to Group…", "Start over…", "New conversation with spare", "Open a folder with spare…", "New Group…", "Rename…", "Color…", "Agent settings…", "Remove spare…"]);
	await page.getByLabel("New name for spare").press("Escape");
	await sees("[data-slot=agent-label] >> text=spare");
	await shown("spare", "rename");
	await page.getByLabel("New name for spare").fill("Spare Hands");
	await page.getByLabel("New name for spare").press("Enter");
	await sees("[data-slot=toast] >> text=spare is now called spare-hands.");
	await sees("[data-slot=agent-label] >> text=spare-hands");
	assert.ok(fs.existsSync(path.join(home, "agents", "spare-hands", "agent.json")) && !fs.existsSync(path.join(home, "agents", "spare")));
	// Color opens the color over its avatar, and a pick is kept at once.
	await shown("spare-hands", "color");
	await page.locator("[data-slot=agent-color][data-open]").getByRole("button", { name: "Blue", exact: true }).click();
	const kept = path.join(home, "agents", "spare-hands", "agent.json");
	for (let i = 0; i < 100 && !json(kept)?.color; i++) await new Promise((r) => setTimeout(r, 30));
	assert.match(json(kept)?.color, /^#[0-9a-f]{6}$/);
	await page.keyboard.press("Escape");
	assert.deepEqual(await shown("spare-hands", "remove"), ["Open", "Open in New Window", "Move to Group…", "Start over…", "New conversation with spare-hands", "Open a folder with spare-hands…", "New Group…", "Rename…", "Color…", "Agent settings…", "Remove spare-hands…"]);
	// It asks first, and how: nothing is removed by the menu alone.
	// It is an alert dialog: it does not go away with a stray click beside it.
	await sees("[role=alertdialog] [cmdk-group-heading] >> text=Remove the agent spare-hands?");
	await page.mouse.click(5, 5);
	await sees("[role=alertdialog]");
	assert.ok(fs.existsSync(path.join(home, "agents", "spare-hands", "agent.json")));
	await page.click("[data-slot=command-item]:has-text('Remove the agent and everything it owns')");
	await sees("[data-slot=toast] >> text=Removed the agent spare-hands.");
	await page.waitForFunction(() => ![...document.querySelectorAll("[data-slot=agent-label] > :first-child")].some((e) => e.textContent?.trim() === "spare-hands"));
	assert.equal(fs.existsSync(path.join(home, "agents", "spare-hands")), false);
	// Asked for the main agent all the same (the palette, another road), the app says no and asks the daemon for nothing.
	await page.evaluate(() => (window as any).pine.call("POST", "/agents/main/erase", { agent: "main", keepFiles: false })).then((r: any) => assert.equal(r.ok, false));
	assert.ok(fs.existsSync(path.join(home, "agents", "main", "agent.json")));
});

test("conversations are kept in groups: one made from the agent's menu is filled by dragging and from the palette, sorted, renamed, and removed with what is in it", async () => {
	for (const session of ["okapi-api", "okapi-web", "llama"]) assert.ok((await api("POST", "/agents/scout/prompt", { prompt: `work on ${session}`, session })).ok);
	assert.ok((await api("POST", "/agents/scout/branch", { session: "okapi-api", to: "okapi-try" })).ok);
	const scout = page.locator("[data-slot=collapsible]:has([data-slot=agent-label])", { has: page.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }) });
	const row = (name: string) => scout.locator("[role=option]", { hasText: new RegExp(`${name}$`) });
	const group = (name: string) => scout.locator("[data-slot=conversation-group]", { has: page.locator("[data-slot=group-label]", { hasText: new RegExp(`^${name}$`) }) });
	const groupOf = async (session: string) => ((await api("GET", "/agents/scout/sessions")).data as any[]).find((c) => c.session === session)?.group;
	// The menu is the system's: what it shows is noted, and the test says what is picked.
	await app.evaluate(({ ipcMain }: any) => {
		const g = globalThis as any;
		g.menus = [];
		ipcMain.removeHandler("pine:context-menu");
		ipcMain.handle("pine:context-menu", (_e: unknown, items: Array<{ id: string; label: string; separator?: boolean; checked?: boolean }>) => {
			g.menus.push(items.filter((i) => !i.separator).map((i) => `${i.label}${i.checked ? " ✓" : ""}`));
			return g.pick;
		});
	});
	const choose = async (target: any, pick: string): Promise<string[]> => {
		const before = await app.evaluate((_e: unknown, p: string) => (((globalThis as any).pick = p), (globalThis as any).menus.length), pick);
		await target.click({ button: "right" });
		for (let i = 0; i < 100; i++) {
			const menus = await app.evaluate(() => (globalThis as any).menus);
			if (menus.length > before) return menus.at(-1);
			await new Promise((r) => setTimeout(r, 30));
		}
		throw new Error(`no menu for ${pick}`);
	};
	const agentLine = page.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { has: page.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }) });
	// A drag as the side bar is told of it: the events of the row and of the place it is dropped on, one
	// after the other. Playwright's dragTo moves the mouse, and a list that redraws as the daemon tells it
	// something (it does, live) can take the row away mid-drag, which drops nothing: a test of Chromium's
	// pointer, not of the side bar.
	const drag = async (source: any, target: any) => {
		const data = await page.evaluateHandle(() => new DataTransfer());
		// The element itself, as a browser keeps it: dragend goes to it after the drop, wherever the list put the row.
		const held = await source.locator("xpath=ancestor-or-self::li[1]").elementHandle();
		await held.dispatchEvent("dragstart", { dataTransfer: data });
		await target.dispatchEvent("dragenter", { dataTransfer: data });
		await target.dispatchEvent("dragover", { dataTransfer: data });
		await target.dispatchEvent("drop", { dataTransfer: data });
		await held.dispatchEvent("dragend", { dataTransfer: data });
		await held.dispose();
		await data.dispose();
	};

	// A group is made from the agent's menu, empty, with a name the owner types.
	assert.ok((await choose(agentLine, "group")).includes("Sort by Last Used ✓"), "the list is sorted by when a conversation was last used, as it was");
	await page.fill("[data-slot=dialog-content] input[placeholder='Group name']", "Okapi");
	await page.keyboard.press("Enter");
	await group("Okapi").waitFor();
	// (A branch made through the control API is in the list the side bar asked for after that.)
	await sees("[role=option] >> text=okapi-try");
	assert.equal(await group("Okapi").locator("[role=option]").count(), 0);

	// A conversation dragged onto the group goes into it, with its branch; a branch is not dragged by itself.
	assert.equal(await row("okapi-try").locator("xpath=ancestor::li[1]").getAttribute("draggable"), "false");
	await drag(row("okapi-api"), group("Okapi").locator("[data-slot=group-label]"));
	await group("Okapi").locator("[role=option]", { hasText: /okapi-try$/ }).waitFor();
	assert.deepEqual([await groupOf("okapi-api"), await groupOf("okapi-try")], ["Okapi", "Okapi"]);

	// With the keyboard: the palette's command moves the conversation in front into a group it picks.
	await row("okapi-web").click();
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=okapi-web");
	await menu("palette");
	await page.keyboard.type("Move conversation to group");
	await page.keyboard.press("Enter");
	await sees("[data-slot=dialog-content] [role=option] >> text=Okapi");
	await page.keyboard.type("Okapi");
	await page.keyboard.press("Enter");
	await group("Okapi").locator("[role=option]", { hasText: /okapi-web$/ }).waitFor();
	assert.equal(await groupOf("okapi-web"), "Okapi");

	// Dragged onto the agent's line, a conversation leaves its group; a move made by another hand (here the control API) is followed.
	await drag(group("Okapi").locator("[role=option]", { hasText: /okapi-web$/ }), agentLine);
	await page.waitForFunction(() => ![...document.querySelectorAll("[data-slot=conversation-group] [role=option]")].some((e) => /okapi-web$/.test(e.textContent ?? "")));
	assert.equal(await groupOf("okapi-web"), undefined);
	assert.ok((await api("POST", "/agents/scout/group", { session: "llama", group: "Okapi" })).ok);
	await group("Okapi").locator("[role=option]", { hasText: /llama$/ }).waitFor();

	// Sorted by name, from the agent's menu; renamed from the group's.
	await choose(agentLine, "name");
	for (let i = 0; i < 100 && (await api("GET", "/agents/scout/groups")).data.order !== "name"; i++) await new Promise((r) => setTimeout(r, 30));
	assert.equal((await api("GET", "/agents/scout/groups")).data.order, "name");
	await page.waitForFunction(() => {
		const names = [...document.querySelectorAll("[data-slot=conversation-group] [role=option] > :last-child")].map((e) => e.textContent ?? "");
		return names.join(",") === "llama,okapi-api,okapi-try";
	});
	assert.deepEqual(await choose(group("Okapi").locator("[data-slot=group-label]"), "rename"), ["New Conversation in Okapi", "Rename…", "Remove Group…"]);
	await page.fill("[data-slot=dialog-content] input[placeholder='New name']", "Okapi 2026");
	await page.keyboard.press("Enter");
	await group("Okapi 2026").locator("[role=option]", { hasText: /okapi-try$/ }).waitFor();
	await shot("16-groups");

	// Removing the group asks first, and takes its conversations with it.
	await choose(group("Okapi 2026").locator("[data-slot=group-label]"), "remove");
	await sees("[role=alertdialog] [cmdk-group-heading] >> text=Remove the group Okapi 2026 and the 3 conversations in it permanently?");
	await page.click("[data-slot=command-item]:has-text('Remove permanently')");
	await sees("[data-slot=toast] >> text=Removed the group Okapi 2026 with 3 conversations.");
	await group("Okapi 2026").waitFor({ state: "detached" });
	assert.deepEqual([await row("okapi-api").count(), await row("llama").count(), await row("okapi-web").count()], [0, 0, 1], "what was in it is gone, and what was taken out before stays");
	await choose(agentLine, "recent");
	for (let i = 0; i < 100 && (await api("GET", "/agents/scout/groups")).data.order !== "recent"; i++) await new Promise((r) => setTimeout(r, 30));
	// As it was before: the tab this test opened closed, its conversation gone.
	await page.click("[data-slot=tab]:has([data-slot=tab-name]:has-text('okapi-web')) button[aria-label='Close this tab']");
	await page.waitForSelector("[data-slot=tab]:has([data-slot=tab-name]:has-text('okapi-web'))", { state: "detached" });
	assert.ok((await api("POST", "/agents/scout/remove", { session: "okapi-web" })).ok);
});

test("a conversation is opened from the palette with the keyboard alone", async () => {
	await menu("palette");
	await sees("[data-slot=dialog-content] [role=listbox]");
	await named(/./);
	assert.equal(await announced("[data-slot=dialog-content]"), "Search everything");
	await page.keyboard.press("Tab");
	await stillInside();
	await page.keyboard.press("Shift+Tab");
	await stillInside();
	assert.equal((await activeOption()).role, "combobox");
	await page.keyboard.type("where is the okapi");
	// Its results keep their group headers.
	await sees("[cmdk-group-heading] >> text=Conversations");
	await sees("[role=option] >> text=scout · where is the okapi invoice");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowUp");
	await named(/scout · where is the okapi invoice/);
	const at = await activeOption();
	assert.deepEqual([at.option, at.selected, at.list], ["option", "true", true], JSON.stringify(at));
	await page.keyboard.press("Enter");
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=where is the okapi invoice");
	await page.keyboard.press("Escape");
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
});

test("the palette finds things by name, and the event log follows", async () => {
	// The pointer rests where the list will open: the first line is still the one that enter takes.
	await page.mouse.move(640, 320);
	await menu("palette");
	await sees("[data-slot=command-input]");
	await page.keyboard.type("event log");
	await shot("10-palette");
	await page.keyboard.press("Enter");
	await sees("[aria-label=Events] [data-slot=collapsible-trigger]");
	assert.ok((await page.$$eval("[aria-label=Events] [data-slot=collapsible-trigger]", (els: Element[]) => els.length)) > 3);
	await shot("11-events");
});

test("an event is published from the event log with a form: a topic, and a payload checked to be JSON before it is sent", async () => {
	await page.getByRole("button", { name: "Publish…" }).click();
	await sees("[data-slot=publish-form]");
	// The topic field has the focus; a payload that is not JSON is said under its field, and nothing is sent.
	await page.keyboard.type("house/mode");
	await page.getByLabel("Payload").fill("{value: away}");
	await page.getByRole("button", { name: /^Publish/ }).click();
	await sees("[data-slot=publish-form] [data-slot=field-error] >> text=This is not JSON");
	assert.equal(await page.getAttribute("#publish-payload", "aria-invalid"), "true");
	await shot("11b-publish-wrong");
	await page.getByLabel("Payload").fill('{"value": "away"}');
	await page.getByLabel("Payload").press("ControlOrMeta+Enter");
	await page.waitForSelector("[data-slot=publish-form]", { state: "detached" });
	await sees("[data-slot=toast] >> text=on house/mode");
	await sees("[aria-label=Events] [data-slot=collapsible-trigger] >> text=house/mode");
	// The daemon got what /emit sends: the topic, the payload as JSON, from the owner.
	const port = /http listening on 127\.0\.0\.1:(\d+)/.exec(fs.readFileSync(path.join(home, "data", "pine.log"), "utf8"))![1];
	const token = fs.readFileSync(path.join(home, "data", "http-token"), "utf8").trim();
	const events = (await (await fetch(`http://127.0.0.1:${port}/events?topic=house/mode`, { headers: { authorization: `Bearer ${token}` } })).json()) as Array<{ payload: unknown; trust: string }>;
	assert.deepEqual(events.map((e) => [e.payload, e.trust]), [[{ value: "away" }, "owner"]]);
});

test("the event log follows its end while new events come, holds still once scrolled up, and its button goes back to the latest", async () => {
	const port = /http listening on 127\.0\.0\.1:(\d+)/.exec(fs.readFileSync(path.join(home, "data", "pine.log"), "utf8"))![1];
	const token = fs.readFileSync(path.join(home, "data", "http-token"), "utf8").trim();
	const publish = async (from: number, n: number) => {
		for (let i = from; i < from + n; i++) await fetch(`http://127.0.0.1:${port}/events`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ topic: `test/follow-${i}`, payload: i }) });
	};
	const log = "[aria-label=Events]";
	const button = `[data-slot=message-scroller]:has(${log}) [data-slot=message-scroller-button]`;
	const fromEnd = () => page.$eval(log, (el: Element) => el.scrollHeight - el.scrollTop - el.clientHeight);
	await publish(0, 60);
	await sees(`${log} [data-slot=collapsible-trigger] >> text=test/follow-59`);
	await page.waitForFunction((s: string) => { const el = document.querySelector(s)!; return el.scrollHeight - el.scrollTop - el.clientHeight < 2; }, log);
	// Each line is an item of the scroller: it measures them all.
	assert.equal(await page.$$eval(`${log} [data-slot=message-scroller-content] > [data-slot=collapsible]`, (els: Element[]) => els.length), 0);
	// Scrolled up by the reader: new events come and the view holds still, with the way back to the latest.
	await page.hover(log);
	await page.mouse.wheel(0, -400);
	await page.waitForFunction((s: string) => document.querySelector(s)?.getAttribute("data-active") === "true", button);
	const held = await page.$eval(log, (el: Element) => el.scrollTop);
	await publish(60, 10);
	await sees(`${log} [data-slot=collapsible-trigger] >> text=test/follow-69`);
	await new Promise((r) => setTimeout(r, 200));
	assert.equal(await page.$eval(log, (el: Element) => el.scrollTop), held);
	assert.ok((await fromEnd()) > 100);
	await page.click(button);
	await page.waitForFunction((s: string) => { const el = document.querySelector(s)!; return el.scrollHeight - el.scrollTop - el.clientHeight < 2; }, log);
	await page.waitForFunction((s: string) => document.querySelector(s)?.getAttribute("data-active") === "false", button);
});

test("a sub-agent's work opens in a tab of its own", async () => {
	await page.click("[data-slot=tab] >> nth=0");
	mock.state.scripts.child = [{ text: "hi from the child" }];
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "subagent", args: { tasks: ["@@REF:child@@ say hi"] } }] }, { text: "the sub-agent answered" }], "ask a helper "));
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=the sub-agent answered");
	await page.click("[data-item=work] > [data-slot=trace-collapsible-trigger] >> nth=-1");
	await sees("[data-part=child] [data-slot=trace-line]");
	await page.click("[data-part=child] [data-slot=trace-line] >> nth=0");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=#");
	await sees("[data-slot=markdown] >> text=hi from the child");
	assert.match(await page.textContent("[data-slot=message-scroller-content]"), /sub-agent of main/);
	await shot("12-task");
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
});

test("the last message is taken back, and its text is in the input again", async () => {
	await page.click("[data-slot=tab] >> nth=0");
	const before = await page.$$eval("[data-item=user]", (els: Element[]) => els.length);
	await menu("undo");
	await sees("[data-slot=marker][data-tone=accent] >> text=Undone");
	assert.equal(await page.$$eval("[data-item=user]", (els: Element[]) => els.length), before - 1);
	assert.match(await page.inputValue("[data-slot=composer] textarea"), /^ask a helper /);
	await page.fill("[data-slot=composer] textarea", "");
});

test("a message is branched from: a new conversation with what was said up to it, under the original in the side bar", async () => {
	await page.click("[data-slot=tab] >> nth=0");
	await menu("new");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=new conversation");
	for (const word of ["BRANCH-ONE", "BRANCH-TWO"]) {
		await page.fill("[data-slot=composer] textarea", mockMsg([{ text: `answer to ${word}` }], `${word} `));
		await page.keyboard.press("Enter");
		await sees(`[data-slot=markdown] >> text=answer to ${word}`);
	}
	// A conversation is called by the first thing said in it, once the app has asked the daemon what was said: read
	// before that, its name is still "new conversation", and is another one by the time it is compared below.
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=BRANCH-ONE");
	const from = await page.textContent("[data-slot=tab][data-active] [data-slot=tab-name]");
	// A right click on a message of the owner's offers it. The menu is the system's: what it shows is noted, and the test picks.
	await app.evaluate(({ ipcMain }: any) => {
		const g = globalThis as any;
		g.branchMenus = [];
		ipcMain.removeHandler("pine:context-menu");
		ipcMain.handle("pine:context-menu", (_e: unknown, items: Array<{ id: string; label: string }>) => (g.branchMenus.push(items.map((i) => i.label)), "branch"));
	});
	await page.click("[data-item=user]:has-text('BRANCH-ONE')", { button: "right" });
	for (let i = 0; i < 100 && !(await app.evaluate(() => (globalThis as any).branchMenus.length)); i++) await new Promise((r) => setTimeout(r, 30));
	assert.deepEqual(await app.evaluate(() => (globalThis as any).branchMenus[0]), ["Branch from here"]);
	await sees("[data-slot=toast] >> text=from that message");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=· branch");
	assert.ok((await page.textContent("[data-slot=tab][data-active] [data-slot=tab-name]")).startsWith(`${from!.trim()} · branch`));
	await sees("[data-slot=markdown] >> text=answer to BRANCH-ONE");
	assert.doesNotMatch(await page.textContent("[data-slot=message-scroller-content]"), /BRANCH-TWO/);
	// In the side bar it is under the conversation it was made from.
	await page.waitForFunction(() => [...document.querySelectorAll("#sidebar-panel [role=option]")].some((r) => /a branch of/.test(r.getAttribute("title") ?? "")), null, { timeout: 10_000 });
	const rows = await page.$$eval("#sidebar-panel [role=option]", (els: Element[]) => els.map((e) => ({ title: e.getAttribute("title") ?? "" })));
	const at = rows.findIndex((r) => /a branch of/.test(r.title));
	assert.match(rows[at].title, new RegExp(`a branch of ${rows[at - 1].title.split(" · ")[1]}`), JSON.stringify(rows));
	// Its top line is a path: the conversation it was made from, then itself; the one before opens with a click.
	const original = from!.trim().split(" · ").slice(1).join(" · ");
	await sees(`[data-slot=conversation-head] [data-slot=breadcrumb-link] >> text=${original}`);
	assert.match(await page.textContent("[data-slot=conversation-head] [data-slot=breadcrumb-page]"), /branch/);
	await page.click("[data-slot=conversation-head] [data-slot=breadcrumb-link]");
	await page.waitForFunction((name) => document.querySelector("[data-slot=tab][data-active] [data-slot=tab-name]")?.textContent?.trim() === name, from!.trim());
	assert.equal(await page.$("[data-slot=conversation-head] [data-slot=breadcrumb-link]"), null, "the original has nothing before it");
	await page.click("[data-slot=tab]:has-text('· branch')");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=· branch");
	await shot("15-branch");
	// What is said in the branch stays there.
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "only in the branch" }], "BRANCH-THREE "));
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=only in the branch");
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
	await page.click("[data-slot=tab] >> nth=0");
	await sees("[data-slot=composer] textarea");
});

test("a conversation moves into a worktree of its folder: the chip names the branch, and its work is merged from the panel", async () => {
	// The folder has a change that is not committed (the setup made it).
	const uncommitted = fs.readFileSync(path.join(folder, "src", "index.ts"), "utf8");
	await app.evaluate(({ BrowserWindow }: any, dir: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", `folder:${dir}`), folder);
	await confirm("[cmdk-group-heading] >> text=Which agent works in");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=pine-desktop-folder");
	await menu("worktree");
	await confirm("[cmdk-group-heading] >> text=Work in a worktree?");
	await sees("[data-slot=conversation-head] [data-worktree] >> text=pine/");
	const branch = (await page.textContent("[data-slot=conversation-head] [data-worktree]"))!.trim();
	const tree = path.join(folder, ".pine", "worktrees", branch.slice(5));
	assert.ok(fs.existsSync(path.join(tree, "README.md")), "a checkout of its own");
	await sees("[data-slot=message-scroller-content] >> text=now works in the worktree");
	// The side bar says where it works, once something was said in it.
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "working apart" }], "APART "));
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=working apart");
	await page.waitForFunction((b: string) => [...document.querySelectorAll("#sidebar-panel [role=option]")].some((r) => (r.getAttribute("title") ?? "").includes(`in the worktree ${b}`)), branch);

	// Its work, committed there as an agent would, is merged from the panel into what the folder has checked out.
	fs.writeFileSync(path.join(tree, "WORKTREE.md"), "made apart\n");
	execFileSync("git", ["-C", tree, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "add", "WORKTREE.md"], { stdio: "ignore" });
	execFileSync("git", ["-C", tree, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "apart"], { stdio: "ignore" });
	await menu("code-changes");
	await page.locator("[data-slot=code-panel]").getByRole("tab", { name: "Files" }).click();
	await page.locator("[data-slot=code-panel]").getByRole("tab", { name: "Changes" }).click();
	await sees("[data-slot=code-panel] >> text=1 ahead of");
	// Which changes is a switch of two: what the last message changed, and back to all of them.
	const which = page.locator("[data-slot=code-panel] [aria-label='Which changes']");
	await which.getByRole("button", { name: "Last turn" }).click();
	await sees("[data-slot=code-panel] >> text=Since");
	assert.equal(await which.getByRole("button", { name: "Last turn" }).getAttribute("aria-pressed"), "true");
	await which.getByRole("button", { name: "All changes" }).click();
	await sees("[data-slot=code-panel] >> text=1 ahead of");
	await shot("16-worktree");
	await page.locator("[data-slot=code-panel]").getByRole("button", { name: "Merge…" }).click();
	await confirm("[cmdk-group-heading] >> text=1 commit ahead of");
	await sees("[data-slot=toast] >> text=merged into");
	assert.equal(fs.readFileSync(path.join(folder, "WORKTREE.md"), "utf8"), "made apart\n");
	assert.equal(fs.readFileSync(path.join(folder, "src", "index.ts"), "utf8"), uncommitted, "what was not committed in the folder stayed");

	// Discarded once merged: the folder's chip is back.
	await menu("worktree");
	await confirm("[cmdk-group-heading] >> text=ahead of");
	await sees("[data-slot=conversation-head] [data-folder] >> text=pine-desktop-folder");
	assert.ok(!fs.existsSync(tree));

	// A worktree made for it by another hand (a terminal UI on the same daemon) shows here too, and so does its end:
	// the call goes past the window's own model, which is told only that the conversation changed.
	const session = ((await api("GET", "/agents/main/folders")).data as Array<{ session: string; folder: string }>).find((u) => u.folder === folder)!.session;
	const made = await api("POST", "/agents/main/worktree", { session, name: "elsewhere" });
	assert.ok(made.ok, JSON.stringify(made));
	await sees("[data-slot=conversation-head] [data-worktree] >> text=pine/elsewhere");
	const ended = await api("POST", "/agents/main/worktree/remove", { session });
	assert.ok(ended.ok, JSON.stringify(ended));
	await sees("[data-slot=conversation-head] [data-folder] >> text=pine-desktop-folder");
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
});

test("dictating puts what is heard into the input and sends nothing", async () => {
	const sent = await page.$$eval("[data-item=user]", (els: Element[]) => els.length);
	await page.fill("[data-slot=composer] textarea", "Typed first:");
	await menu("voice");
	await sees("[data-slot=alert] >> text=listening");
	await page.waitForFunction(() => (document.querySelector("[data-slot=composer] textarea") as HTMLTextAreaElement).value === "Typed first: about the scans", undefined, { timeout: 8000 }).catch(async () => {
		throw new Error(`what was heard is not in the input, which holds: ${JSON.stringify(await page.inputValue("[data-slot=composer] textarea"))}; ${await page.evaluate(() => [...document.querySelectorAll("[data-slot=alert], [data-slot=toast]")].map((e) => e.textContent).join(" | "))}`);
	});
	// Enter says "that was all": the rest arrives, and the message is still only text in the input.
	await page.focus("[data-slot=composer] textarea");
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => (document.querySelector("[data-slot=composer] textarea") as HTMLTextAreaElement).value === "Typed first: about the scans please");
	await page.waitForSelector("[data-slot=alert] >> text=listening", { state: "detached" });
	assert.equal(await page.$$eval("[data-item=user]", (els: Element[]) => els.length), sent);
	await page.fill("[data-slot=composer] textarea", "");
});

test("find marks what is looked for", async () => {
	// Looked for: how the last answer of the conversation in front begins, whichever conversation that is.
	const said = ((await page.locator("[data-slot=markdown]").last().textContent()) ?? "").trim().slice(0, 12);
	assert.ok(said.length > 3, `no answer to look in: ${JSON.stringify(said)}`);
	await menu("find");
	await sees("input[aria-label='Find in this conversation']");
	await page.keyboard.type(said);
	await sees("[data-slot=input-group]:has(input[aria-label='Find in this conversation']) >> text=/\\d+ of \\d+/");
	assert.ok(await page.evaluate(() => ((CSS as any).highlights.get("pine-find")?.size ?? 0) > 0));
	await shot("13-find");
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=input-group]:has(input[aria-label='Find in this conversation'])", { state: "detached" });
});

test("many tabs scroll instead of stepping on each other", async () => {
	await page.click("[data-slot=tab] >> nth=0");
	const had = await page.locator("[data-slot=tab]").count();
	for (let i = 0; i < 20; i++) {
		await menu("new");
		await page.waitForFunction((n) => document.querySelectorAll("[data-slot=tab]").length === n, had + i + 1);
	}
	const measure = () =>
		page.evaluate(() => {
			const strip = document.querySelector("header [data-slot=scroll-area-viewport]")!.getBoundingClientRect();
			const tabs = [...document.querySelectorAll("[data-slot=tab]")].map((el) => {
				const r = el.getBoundingClientRect();
				// What a tab draws reaches as far as its widest child: a child that does not fit spills over the next tab.
				const right = Math.max(r.right, ...[...el.children].map((c) => c.getBoundingClientRect().right));
				return { left: r.left, right, width: r.width, on: el.hasAttribute("data-active") };
			});
			const plus = document.querySelector("header button[aria-label^='New conversation']")!.getBoundingClientRect();
			return { strip: { left: strip.left, right: strip.right }, tabs, plus: { left: plus.left, right: plus.right }, width: window.innerWidth };
		});
	const m = await measure();
	const gaps = m.tabs.slice(1).map((t: any, i: number) => t.left - m.tabs[i].right);
	assert.ok(Math.min(...gaps) >= 0, `tabs overlap: the smallest gap between two tabs is ${Math.min(...gaps)}px`);
	const on = m.tabs.find((t: any) => t.on);
	// (Within a pixel: a strip whose width is not whole scrolls to a fraction of one.)
	assert.ok(on.left >= m.strip.left - 1 && on.right <= m.strip.right + 1, `the tab in front is in view: ${JSON.stringify({ on, strip: m.strip })}`);
	assert.ok(m.plus.left >= m.strip.right && m.plus.right <= m.width, "the plus stays in view after the tabs");
	// Going back to the first tab scrolls it into view.
	await page.click("[data-slot=tab] >> nth=0");
	await menu("prev-tab");
	await page.waitForFunction(() => {
		const strip = document.querySelector("header [data-slot=scroll-area-viewport]")!.getBoundingClientRect();
		const r = document.querySelector("[data-slot=tab][data-active]")!.getBoundingClientRect();
		return r.left >= strip.left - 1 && r.right <= strip.right + 1;
	}, null, { timeout: 5000 });
	await shot("many-tabs");
	while ((await page.locator("[data-slot=tab]").count()) > had) await page.click("[data-slot=tab] >> nth=-1 >> button[aria-label='Close this tab']");
});

test("a right click on a tab closes the others, those to its right or all of them, main's too, and pins; what is asked stays answerable", async () => {
	// The tabs of before, put back at the end for the tests after this one (the daemon keeps them).
	const before = (await api("GET", "/ui/tabs")).data;
	const tabs = page.locator("[data-slot=tab]");
	const count = (n: number) => page.waitForFunction((n: number) => document.querySelectorAll("[data-slot=tab]").length === n, n);
	const opened = async (at: number) => {
		await tabs.nth(at).click({ button: "right" });
		await sees("[data-slot=context-menu-content]");
		return page.locator("[data-slot=context-menu-content]");
	};
	const choose = async (at: number, item: string) => {
		await (await opened(at)).getByRole("menuitem", { name: item, exact: true }).click();
		await page.waitForSelector("[data-slot=context-menu-content]", { state: "detached" });
	};
	const main = await page.evaluate(() => [...document.querySelectorAll("[data-slot=tab] [data-slot=tab-name]")].findIndex((e) => e.textContent === "main"));
	assert.ok(main >= 0, "the main agent's tab is open");
	// main's own tab offers Pin, and it cannot be chosen: an agent's main conversation always stays.
	const menuOfMain = await opened(main);
	assert.equal(await menuOfMain.getByRole("menuitem", { name: "Pin", exact: true }).getAttribute("aria-disabled"), "true");
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=context-menu-content]", { state: "detached" });
	await tabs.nth(main).click();
	const had = await tabs.count();
	for (let i = 1; i <= 3; i++) {
		await menu("new");
		await count(had + i);
	}
	// Close to the Right of the second new one: the third goes.
	await choose(had + 1, "Close to the Right");
	await count(had + 2);
	// Pin and Unpin are one entry that says which; a conversation is kept once something was said in it.
	await tabs.nth(had + 1).click();
	await page.fill("[data-slot=composer] textarea", "keep this one");
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=ECHO[keep this one]");
	await choose(had + 1, "Pin");
	await tabs.nth(had + 1).locator("svg.lucide-star").waitFor();
	await choose(had + 1, "Unpin");
	await tabs.nth(had + 1).locator("svg.lucide-star").waitFor({ state: "detached" });
	// The first new one waits for an approval, put off for later.
	await tabs.nth(had).click();
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "bash", args: { command: "echo tabs" } }] }, { text: "done with tabs" }], "ask and close "));
	await page.keyboard.press("Enter");
	await sees("role=dialog[name=/^Approval needed/]");
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await tabs.nth(had).locator("[data-slot=badge]", { hasText: "!" }).waitFor();
	// Close Others from the second: every other tab goes, main's too, but the one that waits for an answer stays, and says why.
	await choose(had + 1, "Close Others");
	await count(2);
	await sees("[data-slot=toast] >> text=1 tab stayed open because it is waiting for your answer.");
	assert.notEqual(await tabs.nth(1).getAttribute("data-active"), null);
	assert.equal(await page.locator("[data-slot=tab] [data-slot=tab-name]", { hasText: /^main$/ }).count(), 0);
	// Close, the menu's first item, closes that tab alone.
	await (await opened(1)).getByRole("menuitem").first().click();
	await count(1);
	// A tab that waits is closed by its own button: what was asked goes to the tab in front, and is answered there.
	await menu("new");
	await count(2);
	await tabs.nth(0).hover();
	await tabs.nth(0).locator("button[aria-label='Close this tab']").click();
	await count(1);
	await tabs.nth(0).locator("[data-slot=badge]", { hasText: "!" }).waitFor();
	const asked = '[data-item="approval"][data-state="open"] [data-slot="item"]';
	assert.match(await page.textContent(asked), /echo tabs/);
	await page.click(`${asked} button:has-text("Allow once")`);
	await sees('[data-item="approval"][data-state="allowed"] >> text=Allowed');
	// Close All closes the last tab too: the window says that none is open, and opens one again from there.
	await choose(0, "Close All");
	await count(0);
	await sees("[data-slot=no-tab]");
	await shot("no-tab");
	await page.locator("[data-slot=no-tab]").getByRole("button", { name: "Open main" }).click();
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=main");
	await api("POST", "/ui/tabs", before);
	await page.reload();
	await sees("[data-slot=tab][data-active]");
	// The reload drew the side panel before the tests after this one change what it shows: it is put away, and they open it afresh.
	if (await page.$("[data-slot=code-panel]")) {
		await menu("code");
		await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
	}
});

test("the panel's Agent view scrolls up and down only, however narrow the panel and however long a line it shows", async () => {
	// A memory with a line no space breaks, and a description as long: the view wraps them, it is never pushed sideways.
	write(path.join(home, "agents", "main", "workspace", "MEMORY.md"), `# Memory\n\n${"x".repeat(240)}\n${"https://example.com/".repeat(12)}\n${"- a line to remember\n".repeat(60)}`);
	await page.click("[data-slot=tab] >> nth=0");
	// The menu's item opens the side panel on its Agent view whatever state the panel is in (a toggle could close it).
	await menu("code-agent");
	await sees("[data-slot=code-panel] [role=tab][aria-selected=true] >> text=Agent");
	await sees("[data-slot=code-panel] [data-slot=scroll-area] >> text=Memory");
	const width = () => page.$eval("[data-slot=code-panel]", (el: Element) => el.getBoundingClientRect().width);
	const was = await width();
	// A window short enough that the view has more to show than room, whatever the panel's width: it scrolls, and shows its bar.
	await page.setViewportSize({ width: 1280, height: 640 });
	const edge = await page.$eval(CODE_EDGE, (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(edge.x + edge.width / 2, 300);
	await page.mouse.down();
	await page.mouse.move(edge.x + edge.width / 2 + 600, 300, { steps: 6 });
	await page.mouse.up();
	// Narrower, or as narrow as a group gets already: never wider.
	const now = await width();
	assert.ok(now <= was, `the panel was made wider: ${was} → ${now}, at the edge ${JSON.stringify(edge)}`);
	const fits = () => page.$eval("[data-slot=code-panel] [data-slot=scroll-area]:has-text(\"Memory\") > [data-slot=scroll-area-viewport]", (el: Element) => {
		const wide = [...el.querySelectorAll("*")].filter((c) => c.getBoundingClientRect().right > el.getBoundingClientRect().right + 0.5).slice(0, 5).map((c) => `${c.tagName}.${c.className}`.slice(0, 120));
		return { scroll: el.scrollWidth, client: el.clientWidth, wide };
	});
	const seen = await fits();
	await shot("agent-view-narrow");
	assert.ok(seen.scroll <= seen.client, `the Agent view is wider than the panel: ${JSON.stringify(seen)}`);
	// Back to the width it had, for the tests after this one.
	const back = await page.$eval(CODE_EDGE, (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(back.x + back.width / 2, 300);
	await page.mouse.down();
	await page.mouse.move(back.x + back.width / 2 - (was - (await width())), 300, { steps: 6 });
	await page.mouse.up();
	await page.setViewportSize({ width: 1280, height: 820 });
});

test("a phone-wide window lays the side bar and the panel over the conversation, and a wide one puts them back beside it", async () => {
	// The page's size, as the start of this file sets it (the window's own size does not count while the driver sets one).
	const size = (width: number, height: number) => page.setViewportSize({ width, height });
	try {
		await page.click("[data-slot=tab] >> nth=0");
		await sees("#sidebar-panel [data-slot=sidebar]");
		const wide = Math.round(await page.$eval("#sidebar-panel [data-slot=sidebar]", (el: Element) => el.getBoundingClientRect().width));
		if (await page.$("[data-slot=code-panel]")) await menu("code");
		await size(380, 760);
		// No column: the side bar is stock's sheet, closed until it is asked for, and the page does not scroll sideways.
		await page.waitForSelector("#sidebar-panel", { state: "detached" });
		assert.equal(await page.locator("[data-slot=sidebar][data-mobile=true]").count(), 0);
		assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 380, "the page does not scroll sideways");
		await page.click("header [data-sidebar=trigger]");
		await sees("[data-slot=sidebar][data-mobile=true] [data-slot=agent-label]");
		// Picking a conversation in it puts it away again.
		await page.locator("[data-slot=sidebar][data-mobile=true] [role=option]").first().click();
		await page.waitForSelector("[data-slot=sidebar][data-mobile=true]", { state: "detached" });
		// The menu's Toggle Sidebar opens the sheet and leaves the owner's choice of a column as it was.
		await menu("sidebar");
		await sees("[data-slot=sidebar][data-mobile=true]");
		await page.keyboard.press("Escape");
		await page.waitForSelector("[data-slot=sidebar][data-mobile=true]", { state: "detached" });
		// The side panel is a sheet over the conversation, and closing the sheet closes the panel. No groups: one row of tabs.
		await menu("code-agent");
		await sees("[data-slot=sheet-content] [data-slot=code-panel]");
		assert.equal(await page.locator("[data-slot=dock]").count(), 0);
		// The sheet lies over the title bar's drag region: it takes its own clicks, or a click in it would move the window.
		assert.equal(await page.$eval("[data-slot=sheet-content]", (e: Element) => getComputedStyle(e).getPropertyValue("-webkit-app-region")), "no-drag");
		await page.keyboard.press("Escape");
		await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
		// The browser is the side panel's: the menu's item opens the sheet on it, and again puts it away.
		await menu("browser");
		await sees("[data-slot=sheet-content] [data-slot=code-panel] [role=tab][aria-selected=true] >> text=Browser");
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
		// Wide again: the side bar is a column as wide as it was.
		await size(1280, 820);
		await sees("#sidebar-panel [data-slot=sidebar]");
		// (The panels settle over a few frames after the window changed: waited for, then said as it is.)
		const sideWidth = () => page.$eval("#sidebar-panel [data-slot=sidebar]", (el: Element) => Math.round(el.getBoundingClientRect().width));
		for (let i = 0; i < 40 && (await sideWidth()) !== wide; i++) await new Promise((r) => setTimeout(r, 50));
		assert.equal(await sideWidth(), wide);
	} finally {
		// The tests after this one have the width the start of this file set, whatever failed here.
		await size(1280, 820);
	}
});

test("a window too narrow for groups shows one row of all their tabs, and the groups come back as they were when it is wide", async () => {
	const size = (width: number, height: number) => page.setViewportSize({ width, height });
	const gone = (sel: string) => page.waitForSelector(sel, { state: "detached" });
	const names = () => page.$$eval("[data-slot=tab] [data-slot=tab-name]", (els: Element[]) => els.map((e) => (e.textContent ?? "").trim()));
	try {
		await page.click("[data-slot=tab] >> nth=0");
		if (await page.$("[data-slot=code-panel]")) await menu("code");
		// Wide: main's tab and a new conversation, the new one split off to the right of it, and the side panel beside them.
		const tabs = await page.locator("[data-slot=tab]").count();
		await menu("new");
		await page.waitForFunction((n) => document.querySelectorAll("[data-slot=tab]").length > n, tabs);
		await page.locator("[data-slot=tab][data-active]").click({ button: "right" });
		await page.locator("[role=menuitem]", { hasText: "Split Right" }).click();
		await page.waitForFunction(() => document.querySelectorAll("[data-slot=group-bar]").length === 2);
		await menu("code-files");
		await page.waitForFunction(() => document.querySelectorAll("[data-slot=group-bar]").length === 3);
		const wide = await names();
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
		await page.waitForFunction(() => document.querySelectorAll("[data-slot=group-bar]").length === 3);
		await menu("close");
		await page.waitForFunction(() => document.querySelectorAll("[data-slot=group-bar]").length === 2);
		await menu("code");
		await gone("[data-slot=code-panel]");
		await page.waitForFunction(() => document.querySelectorAll("[data-slot=group-bar]").length === 1);
	} finally {
		await size(1280, 820);
		if (await page.$("[data-slot=code-panel]")) await menu("code");
	}
});

test("what was typed in a file and not saved stays when the panel becomes a sheet and a column again, and Escape in the editor leaves the sheet open", async () => {
	const size = (width: number, height: number) => page.setViewportSize({ width, height });
	try {
		// The folder's conversation from before is in a worktree by now: a new one in the folder itself.
		await menu(`folder:${folder}`);
		await confirm("[cmdk-group-heading] >> text=Which agent works in");
		await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=pine-desktop-folder");
		await menu("code-files");
		await sees("[data-slot=code-panel]");
		if (!(await page.$("[data-slot=code-panel] .cm-content"))) {
			await page.fill("[data-slot=code-panel] input[aria-label='Find a file']", "README");
			// A click selects a file; a double click opens it.
			await page.locator("[data-slot=code-panel] [role=listbox] [role=option]").first().dblclick({ timeout: 10_000 });
		}
		await sees("[data-slot=code-panel] .cm-content");
		await page.click("[data-slot=code-panel] .cm-content");
		await page.keyboard.press("ControlOrMeta+End");
		await page.keyboard.type("unsaved draft");
		const save = page.locator("[data-slot=code-panel]").getByRole("button", { name: "Save" });
		assert.ok(await save.isEnabled());
		// Narrower than the room for groups: the panel is drawn again inside a sheet when it is asked for, with the draft still in it.
		await size(900, 760);
		await page.waitForSelector("[data-slot=dock]", { state: "detached" });
		await menu("code-files");
		await sees("[data-slot=sheet-content] [data-slot=code-panel] .cm-content");
		assert.match(await page.textContent("[data-slot=code-panel] .cm-content"), /unsaved draft/);
		assert.ok(await save.isEnabled());
		// Escape that closes the editor's search is the editor's, and so is one in the editor itself: the sheet stays.
		await page.click("[data-slot=code-panel] .cm-content");
		await page.keyboard.press("ControlOrMeta+F");
		await sees("[data-slot=code-panel] .cm-search");
		await page.keyboard.press("Escape");
		await page.waitForSelector("[data-slot=code-panel] .cm-search", { state: "detached" });
		await page.keyboard.press("Escape");
		await new Promise((r) => setTimeout(r, 300));
		assert.equal(await page.locator("[data-slot=sheet-content] [data-slot=code-panel]").count(), 1);
		// Wide again: the panel is in its group, and the draft is still there to save or to leave.
		await size(1280, 820);
		await sees("#code-panel [data-slot=code-panel] .cm-content");
		assert.match(await page.textContent("[data-slot=code-panel] .cm-content"), /unsaved draft/);
		assert.ok(await save.isEnabled());
		await page.click("[data-slot=code-panel] button[aria-label='Back to the files']");
		await page.locator("[role=alertdialog]").getByRole("button", { name: "Leave" }).click();
		await page.waitForFunction(() => !document.querySelector("[data-slot=code-panel] .cm-editor"));
		await menu("code");
		await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
	} finally {
		await size(1280, 820);
	}
});

/** The groups of the window, left to right and top to bottom, each as the names of its tabs (a pane as "@code"). */
const groups = () =>
	page.$$eval("[data-slot=group-bar]", (bars: Element[]) =>
		bars
			.map((b) => ({ at: b.getBoundingClientRect(), tabs: [...b.querySelectorAll("[data-slot=tab], [data-slot=pane-tab]")].map((t) => (t.getAttribute("data-pane") ? `@${t.getAttribute("data-pane")}` : (t.querySelector("[data-slot=tab-name]")?.textContent ?? "").trim())) }))
			.sort((a, b) => a.at.top - b.at.top || a.at.left - b.at.left)
			.map((g) => g.tabs),
	);

/**
 * Drags a tab (by the start of its name, or a pane as "@code") onto a group (the one holding the tab named `onto`), at a
 * zone of its body; "window-left" and the like are right at that edge of the body, in the band along the window's edge.
 */
const dragTo = (tab: string, onto: string, zone: "center" | "left" | "right" | "top" | "bottom" | "window-left" | "window-right" | "window-bottom") =>
	page.evaluate(
		async ([tab, onto, zone]) => {
			const all = [...document.querySelectorAll("[data-slot=tab], [data-slot=pane-tab]")];
			const nameOf = (t: Element) => (t.querySelector("[data-slot=tab-name]")?.textContent ?? "").trim();
			const find = (name: string) => (name.startsWith("@") ? all.find((t) => t.getAttribute("data-pane") === name.slice(1)) : (all.find((t) => nameOf(t) === name) ?? all.find((t) => nameOf(t).startsWith(name))));
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
			const at = { center: [0.5, 0.5], left: [0.15, 0.5], right: [0.85, 0.5], top: [0.5, 0.15], bottom: [0.5, 0.85], "window-left": [0, 0.5], "window-right": [1, 0.5], "window-bottom": [0.5, 1] }[zone];
			// A pixel inside the body at its very edge.
			const point = { clientX: Math.min(r.right - 2, Math.max(r.left + 2, r.left + r.width * at[0])), clientY: Math.min(r.bottom - 2, Math.max(r.top + 2, r.top + r.height * at[1])) };
			zones.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer, ...point }));
			await new Promise((r) => setTimeout(r, 20));
			if (zones.getAttribute("data-zone") !== zone) throw new Error(`the zone under the pointer is ${zones.getAttribute("data-zone")}, not ${zone}`);
			zones.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, ...point }));
			// Taken, as a real drop on the window says: a drag that ends with "none" is one let go outside, and tears the tab off.
			dataTransfer.dropEffect = "move";
			from.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer, ...point }));
		},
		[tab, onto, zone] as const,
	);

test("tabs and the side panel are dragged into groups beside and under each other, and the side panel follows the conversation in front", async () => {
	const tabs = await page.locator("[data-slot=tab]").count();
	try {
		await page.setViewportSize({ width: 1800, height: 900 });
		await page.click("[data-slot=tab] >> nth=0");
		if (await page.$("[data-slot=code-panel]")) await menu("code");
		await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=main");
		assert.equal((await groups()).length, 1);
		// A second conversation, dragged to the right edge of the group: a group of its own beside main's.
		await menu("new");
		await page.waitForFunction((n) => document.querySelectorAll("[data-slot=tab]").length > n, tabs);
		const fresh = (await page.textContent("[data-slot=tab][data-active] [data-slot=tab-name]"))!.trim();
		await dragTo(fresh, "main", "right");
		await page.waitForFunction(() => document.querySelectorAll("[data-slot=group-bar]").length === 2);
		const [left, right] = await groups();
		assert.ok(!left.includes(fresh) && right.join() === fresh, JSON.stringify(await groups()));
		// While a tab is dragged the window says so, and that ends with the drag.
		assert.equal(await page.$("[data-slot=dock][data-dropping]"), null);
		// The side panel opens at the right and shows the conversation in front, and another when that comes to the front.
		await page.click(CODE_TOGGLE);
		await sees("#code-panel [data-slot=code-panel]");
		await sees(`[data-slot=pane-tab][data-pane=code] >> text=${fresh}`);
		await page.locator("[data-slot=tab]", { hasText: /^main$/ }).first().click();
		await sees("[data-slot=pane-tab][data-pane=code] [data-slot=tab-name] >> text=/^Side panel · main$/");
		// Settings in front: the side panel stays with main.
		await menu("settings");
		await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=Settings");
		await sees("[data-slot=pane-tab][data-pane=code] [data-slot=tab-name] >> text=/^Side panel · main$/");
		await menu("settings");
		// The side panel dragged under the new conversation: three groups, the panel below.
		await dragTo("@code", fresh, "bottom");
		await page.waitForFunction(() => document.querySelectorAll("[data-slot=group-bar]").length === 3);
		const below = await page.$eval("#code-panel", (el: Element) => el.getBoundingClientRect().top);
		const above = await page.$eval("[data-slot=group-bar]:has([data-slot=tab]) ", (el: Element) => el.getBoundingClientRect().top);
		assert.ok(below > above + 100, "the side panel lies under the conversation");
		// The arrangement is the window's: loaded again, it is as it was.
		const was = await groups();
		await page.reload();
		await page.waitForFunction(() => document.querySelectorAll("[data-slot=group-bar]").length === 3);
		assert.deepEqual(await groups(), was);
		// Let go at the window's left edge (over main's group, which lies along it), the side panel is a column along the whole left of the window.
		await dragTo("@code", "main", "window-left");
		await page.waitForFunction(() => {
			const panel = document.querySelector("#code-panel")?.getBoundingClientRect();
			const dock = document.querySelector("[data-slot=dock]")!.getBoundingClientRect();
			return panel && panel.left - dock.left < 10 && dock.bottom - panel.bottom < 10 && panel.height > dock.height * 0.8;
		});
		assert.deepEqual((await groups())[0], ["@code"]);
		// And at the right edge, a column along the whole right again.
		await dragTo("@code", fresh, "window-right");
		await page.waitForFunction(() => {
			const panel = document.querySelector("#code-panel")?.getBoundingClientRect();
			const dock = document.querySelector("[data-slot=dock]")!.getBoundingClientRect();
			return panel && dock.right - panel.right < 10 && panel.height > dock.height * 0.8;
		});
		// Dragged into the middle of main's group, the new conversation is a tab there again, and its group is gone.
		await dragTo(fresh, "main", "center");
		await page.waitForFunction(() => document.querySelectorAll("[data-slot=group-bar]").length === 2);
		const joined = (await groups())[0];
		assert.ok(joined[0] === "main" && joined.at(-1) === fresh, JSON.stringify(joined));
		// A tab let go before another in a row stands before it.
		await page.evaluate((fresh) => {
			const find = (name: string) => [...document.querySelectorAll("[data-slot=tab]")].find((t) => (t.querySelector("[data-slot=tab-name]")?.textContent ?? "").trim().startsWith(name))!;
			const dataTransfer = new DataTransfer();
			const from = find(fresh);
			const to = find("main");
			const r = to.getBoundingClientRect();
			from.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
			to.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer, clientX: r.left + 2, clientY: r.top + 5 }));
			to.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, clientX: r.left + 2, clientY: r.top + 5 }));
			dataTransfer.dropEffect = "move";
			from.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer }));
		}, fresh);
		await page.waitForFunction((fresh) => (document.querySelector("[data-slot=tab] [data-slot=tab-name]")?.textContent ?? "").trim().startsWith(fresh), fresh);
		// The edge between two groups moves with the keyboard too.
		const width = () => page.$eval("#code-panel", (el: Element) => Math.round(el.getBoundingClientRect().width));
		const before = await width();
		await page.focus("[data-slot=dock-edge][data-next~=code]");
		await page.keyboard.press("ArrowLeft");
		await page.waitForFunction((w) => document.querySelector("#code-panel")!.getBoundingClientRect().width > w, before);
		await shot("dock-groups");
		// The agent's browser_show shows the browser in the side panel, wherever the panel is.
		await page.locator("[data-slot=tab]", { hasText: fresh }).first().click();
		await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "browser_show", args: {} }], text: "Have a look." }, { text: "There it is." }], "Show me the page. "));
		await page.keyboard.press("Enter");
		await sees("#code-panel [data-slot=code-panel] [role=tab][aria-selected=true] >> text=Browser");
		await sees("[data-slot=markdown] >> text=There it is.");
		await menu("code-files");
		await menu("close");
		await page.waitForFunction((n) => document.querySelectorAll("[data-slot=tab]").length === n, tabs);
	} finally {
		// One group again, without the panel, and the width the start of this file set, for the tests that follow.
		if (await page.$("[data-slot=code-panel]")) await menu("code");
		await page.setViewportSize({ width: 1280, height: 820 });
	}
});

/**
 * What is wrong with how the groups lie, in words, or "" when nothing is: a group's content wider or taller than its
 * group, two groups over each other, an edge between groups that something else covers.
 */
const misplaced = () =>
	page.evaluate(() => {
		const bodies = [...document.querySelectorAll("[data-slot=group-body]")].map((b) => ({ id: b.id || b.getAttribute("data-group"), at: b.getBoundingClientRect(), inner: b.firstElementChild?.getBoundingClientRect() }));
		const wrong: string[] = [];
		for (const b of bodies) if (b.inner && (b.inner.right > b.at.right + 0.5 || b.inner.bottom > b.at.bottom + 0.5)) wrong.push(`${b.id} is drawn ${Math.round(b.inner.right - b.at.right)}px past its group`);
		for (const [i, a] of bodies.entries())
			for (const b of bodies.slice(i + 1)) if (a.at.left < b.at.right - 0.5 && b.at.left < a.at.right - 0.5 && a.at.top < b.at.bottom - 0.5 && b.at.top < a.at.bottom - 0.5) wrong.push(`${a.id} and ${b.id} overlap`);
		for (const e of document.querySelectorAll("[data-slot=dock-edge]")) {
			const r = e.getBoundingClientRect();
			if (document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) !== e) wrong.push("an edge is covered");
		}
		return wrong.join("; ");
	});

test("the side panel dragged onto the edge of the conversation's group, again and again, and a window too narrow for every group, leave every group whole and every edge in reach", async () => {
	try {
		await page.setViewportSize({ width: 1280, height: 820 });
		await page.click("[data-slot=tab] >> nth=0");
		if (!(await page.$("[data-slot=code-panel]"))) await page.click(CODE_TOGGLE);
		await sees("#code-panel [data-slot=code-panel]");
		const width = () => page.$eval("#code-panel", (el: Element) => el.getBoundingClientRect().width);
		const was = await width();
		// As the owner did: picked up by its tab and let go at the right of the conversation, which gives it half its room each time.
		for (let i = 0; i < 3; i++) {
			await dragTo("@code", "main", "right");
			await page.waitForFunction((w) => document.querySelector("#code-panel")!.getBoundingClientRect().width > w + 50, was);
			const wrong = await misplaced();
			assert.equal(wrong, "", `after drag ${i + 1}: ${wrong}`);
		}
		// The conversation is as narrow as it gets, and still whole; so it is after a start, from the arrangement kept.
		await shot("dock-least");
		await page.reload();
		await sees("#code-panel [data-slot=code-panel]");
		assert.equal(await misplaced(), "");
		// A third group, in a window too narrow for three at their least: each is smaller, and what it shows fits it.
		const tabs = await page.locator("[data-slot=tab]").count();
		await menu("new");
		await page.waitForFunction((n) => document.querySelectorAll("[data-slot=tab]").length > n, tabs);
		const fresh = (await page.textContent("[data-slot=tab][data-active] [data-slot=tab-name]"))!.trim();
		await dragTo(fresh, "main", "right");
		await page.waitForFunction(() => document.querySelectorAll("[data-slot=group-bar]").length === 3);
		await page.setViewportSize({ width: 1060, height: 820 });
		await page.waitForFunction(() => document.querySelector("[data-slot=dock]")!.getBoundingClientRect().right < 1061);
		assert.equal(await misplaced(), "", "three groups in a narrow window");
		// As the owner did next: one group closed, the window made wider again.
		await menu("close");
		await page.waitForFunction(() => document.querySelectorAll("[data-slot=group-bar]").length === 2);
		await page.setViewportSize({ width: 1280, height: 820 });
		await page.waitForFunction(() => document.querySelector("[data-slot=dock]")!.getBoundingClientRect().right > 1061);
		assert.equal(await misplaced(), "", "two groups again in a wider window");
	} finally {
		await page.setViewportSize({ width: 1280, height: 820 });
		if (await page.$("[data-slot=code-panel]")) await menu("code");
	}
});

/** Where a pine of a test home answers, and its token, as it wrote them. */
const daemonOf = (dir: string) => ({ port: [...fs.readFileSync(path.join(dir, "data", "pine.log"), "utf8").matchAll(/http listening on 127\.0\.0\.1:(\d+)/g)].at(-1)![1], token: fs.readFileSync(path.join(dir, "data", "http-token"), "utf8").trim() });

test("another machine's pine is used from the foot of the side bar, and this Mac's again, each with its own agents", async () => {
	await menu("settings:environments");
	await sees("[data-slot=settings-page] h1 >> text=Environments");
	await sees("[data-environment=local] >> text=in use");
	const input = "[data-slot=settings-page] input[placeholder='you@server']";
	const add = page.locator("[data-slot=settings-page]").getByRole("button", { name: "Add", exact: true });
	// What is not a host for ssh is refused at once, and nothing is kept.
	await page.fill(input, "-oProxyCommand=x");
	await add.click();
	// The refusal is the field's own: said under it, the field marked invalid, as long as the host refused is in it.
	await sees("[data-slot=settings-page] [data-slot=field][data-invalid] [data-slot=field-error] >> text=is not a host for ssh");
	assert.equal(await page.getAttribute(input, "aria-invalid"), "true");
	assert.deepEqual((await page.evaluate(() => (window as any).pine.state())).prefs.hosts, []);
	await page.fill(input, "you@elsewhere");
	assert.equal(await page.getAttribute(input, "aria-invalid"), null);
	await add.click();
	await sees("[data-environment='you@elsewhere'] >> text=you@elsewhere");
	assert.deepEqual((await page.evaluate(() => (window as any).pine.state())).prefs.hosts, ["you@elsewhere"]);
	await shot("16-environments");

	// The foot of the side bar lists both machines; the other one is picked, and the window shows its pine.
	await page.click("[data-slot=service-status]");
	await sees(`[data-slot=dropdown-menu-radio-item] >> text=This ${HERE}`);
	// The menu opens over the side bar, which moves the window: it is no part of that, or a click on it would move the
	// window instead (the system takes it, so a click of the driver's, which goes to the page, cannot show this).
	const region = await page.$$eval("[data-slot=dropdown-menu-content], [data-slot=dropdown-menu-radio-item]", (els: Element[]) => els.map((e) => getComputedStyle(e).getPropertyValue("-webkit-app-region")));
	assert.ok(region.length && region.every((r) => r === "no-drag"), `the menu takes its own clicks: ${region.join(", ")}`);
	await shot("17-machines");
	await page.click("[data-slot=dropdown-menu-radio-item][data-host='you@elsewhere']");
	const agents = () => page.$$eval("[data-slot=agent-label] > :first-child", (els: Element[]) => els.map((e) => e.textContent?.trim()).join());
	await page.waitForFunction(() => [...document.querySelectorAll("[data-slot=agent-label] > :first-child")].map((e) => e.textContent?.trim()).join() === "main,helper", undefined, { timeout: 60_000 });
	assert.match(await page.textContent("[data-slot=service-status]"), /· elsewhere/);
	await sees("[data-slot=empty] >> text=The main agent of the other machine");
	await page.fill("[data-slot=composer] textarea", "hello from this side");
	await page.keyboard.press("Enter");
	await sees("[data-slot=markdown] >> text=ECHO[hello from this side]");
	// It went to the other machine's pine, through the forward, and not to this one's.
	const said = async (dir: string) => {
		const d = daemonOf(dir);
		const tasks = (await (await fetch(`http://127.0.0.1:${d.port}/tasks?agent=main&limit=100`, { headers: { authorization: `Bearer ${d.token}` } })).json()) as Array<{ prompt: string; meta?: { via?: string } }>;
		return tasks.find((t) => t.prompt === "hello from this side");
	};
	assert.ok(await said(far));
	assert.equal(await said(home), undefined);
	// A command in an answer has no Run button there: the terminal is this computer's, and that agent was not told of one.
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "Run this:\n\n```bash\necho far\n```" }], "far commands "));
	await page.keyboard.press("Enter");
	const md = page.locator("[data-slot=markdown]", { hasText: "Run this" }).last();
	await md.locator("[data-slot=code-block]").first().waitFor();
	assert.equal(await md.locator("[data-run]").count(), 0);
	await shot("18-other-machine");

	// Back to this Mac: its own agents and conversation, as they were; the other pine goes on, held by the app.
	const farPort = daemonOf(far).port;
	await page.click("[data-slot=service-status]");
	await page.click(`[data-slot=dropdown-menu-radio-item] >> text=This ${HERE}`);
	await page.waitForFunction(() => [...document.querySelectorAll("[data-slot=agent-label] > :first-child")].map((e) => e.textContent?.trim()).includes("scout"), undefined, { timeout: 30_000 });
	assert.doesNotMatch(await agents(), /helper/);
	assert.match(await page.textContent("[data-slot=service-status]"), /started here/);
	assert.doesNotMatch((await page.textContent("[data-slot=message-scroller-content]").catch(() => "")) ?? "", /hello from this side/);
	assert.equal(await ours(farPort, far), true);
	assert.equal((await page.evaluate(() => (window as any).pine.state())).prefs.use, undefined);

	// Forgotten: the connection ends, and the pine the app started there with it.
	await menu("settings:environments");
	await page.locator("[data-environment='you@elsewhere']").getByRole("button", { name: "Forget" }).click();
	await page.locator("[data-environment='you@elsewhere']").waitFor({ state: "detached" });
	assert.deepEqual((await page.evaluate(() => (window as any).pine.state())).prefs.hosts, []);
	// Why it left the list is noted beside prefs.json.
	assert.match(fs.readFileSync(path.join(home, "desktop-data", "prefs.log"), "utf8"), /machine you@elsewhere left the list: forgotten in Settings > Environments/);
	assert.equal(await daemonGone(farPort, far), true);
	await menu("settings");
});

test("quitting stops the daemon it started", async () => {
	const log = path.join(home, "data", "pine.log");
	assert.ok(fs.existsSync(log));
	await app.close();
	closed();
	// The daemon wrote its last line and is gone: its control port no longer answers.
	const said = fs.readFileSync(log, "utf8");
	assert.match(said, /pine is up/);
	const port = /http listening on 127\.0\.0\.1:(\d+)/.exec(said)?.[1];
	assert.ok(port);
	assert.equal(await daemonGone(port!, home), true);
});
