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
import { activeOption, HERE, announced, api, app, BROWSER_TOGGLE, closed, CODE_EDGE, CODE_TOGGLE, confirm, far, folder, home, json, menu, mock, named, page, sees, shot, SIDE_EDGE, started, stillInside, visit, write } from "./support/window.ts";

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
	if (!(await page.$("[data-slot=code-panel]"))) await page.click(CODE_TOGGLE);
	await page.locator("[data-slot=code-panel]").getByRole("tab", { name: "Agent" }).click();
	// On an agent's line, its initial stands beside its name, not half-way down to its description.
	const line = await page.$eval("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", (el: Element) => ({ avatar: el.querySelector("[data-slot=avatar]")!.getBoundingClientRect(), name: el.querySelector("[data-slot=agent-label] > :first-child")!.getBoundingClientRect() }));
	assert.ok(Math.abs(line.avatar.y + line.avatar.height / 2 - (line.name.y + line.name.height / 2)) <= 2, JSON.stringify(line));
	// What the agent is for stands on that line too, after the name and on the line its letters stand on.
	const one = await page.$eval("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", (el: Element) => {
		const stands = (node: Element) => {
			const range = document.createRange();
			range.selectNodeContents(node);
			const box = range.getBoundingClientRect();
			const pen = document.createElement("canvas").getContext("2d")!;
			pen.font = getComputedStyle(node).font;
			return { left: box.left, right: box.right, baseline: box.top + pen.measureText("x").fontBoundingBoxAscent };
		};
		return { name: stands(el.querySelector("[data-slot=agent-label] > :first-child")!), what: stands(el.querySelector("[data-slot=agent-label] > :last-child > span")!), row: el.getBoundingClientRect().height };
	});
	assert.ok(one.what.left > one.name.right && Math.abs(one.what.baseline - one.name.baseline) <= 0.75, `an agent's name and what it is for are not on one line: ${JSON.stringify(one)}`);
	assert.equal(one.row, 30, "an agent's line is as high as a conversation's");
	// The side bar is as wide as it is dragged.
	const before = await page.$eval("#sidebar-panel [data-slot=sidebar]", (el: Element) => el.getBoundingClientRect().width);
	const edge = await page.$eval(SIDE_EDGE, (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(edge.x + edge.width / 2, 300);
	await page.mouse.down();
	await page.mouse.move(edge.x + edge.width / 2 + 80, 300, { steps: 4 });
	await page.mouse.up();
	assert.equal(await page.$eval("#sidebar-panel [data-slot=sidebar]", (el: Element) => el.getBoundingClientRect().width), before + 80);
	// The edge is a separator the keyboard moves too: focused, an arrow key makes the side bar wider.
	await page.focus(`${SIDE_EDGE}[role='separator']`);
	assert.ok(await page.getAttribute(SIDE_EDGE, "aria-valuenow"), "the edge says how far it is");
	await page.keyboard.press("ArrowRight");
	await page.waitForFunction((was) => document.querySelector("#sidebar-panel [data-slot=sidebar]")!.getBoundingClientRect().width > was, before + 80);
	// Hidden, the side bar is still hidden when the page is loaded again, and shown it is as wide as it was
	// (to the pixel: the edges place panels by fractions of the window, a few hundredths of a pixel apart).
	const wide = Math.round(await page.$eval("#sidebar-panel [data-slot=sidebar]", (el: Element) => el.getBoundingClientRect().width));
	await menu("sidebar");
	await page.waitForSelector("#sidebar-panel [data-slot=sidebar]", { state: "detached" });
	await page.reload();
	await sees("[data-slot=tab][data-active]");
	assert.equal(await page.locator("#sidebar-panel [data-slot=sidebar]").count(), 0);
	await menu("sidebar");
	await sees("#sidebar-panel [data-slot=sidebar]");
	assert.equal(Math.round(await page.$eval("#sidebar-panel [data-slot=sidebar]", (el: Element) => el.getBoundingClientRect().width)), wide);
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
	// A conversation's name begins where its agent's name begins, whatever leads its row.
	const under = await page.$$eval("[data-slot=collapsible]:has([data-slot=agent-label])", (groups: Element[]) => groups.map((g) => ({ agent: g.querySelector("[data-slot=agent-label] > :first-child")!.getBoundingClientRect().left, names: [...g.querySelectorAll("[role=option] > :last-child")].map((c) => c.getBoundingClientRect().left) })));
	assert.ok(under.some((g: any) => g.names.length));
	for (const g of under) for (const left of g.names) assert.equal(left, g.agent, `a conversation's name is not under its agent's: ${JSON.stringify(under)}`);
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
	await sees("[cmdk-group-heading] >> text=Said in conversations");
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
	await sees("[data-slot=dialog-title] >> text=New conversation with");
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
	// Its conversations are one stop after the agent's plus: Tab goes in, the arrows move, Enter opens.
	await page.keyboard.press("Tab");
	assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "New conversation with scout");
	await page.keyboard.press("Tab");
	const at = () => page.evaluate(() => ({ role: document.activeElement?.getAttribute("role"), text: document.activeElement?.textContent ?? "" }));
	assert.equal((await at()).role, "option");
	for (let i = 0; i < 6 && !/where is the okapi invoice/.test((await at()).text); i++) await page.keyboard.press("ArrowDown");
	assert.match((await at()).text, /where is the okapi invoice/);
	await page.keyboard.press("Enter");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=where is the okapi invoice");
	await page.click("[data-slot=tab][data-active] button[aria-label='Close this tab']");
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
	assert.deepEqual(await shown("main"), ["Open", "Move to Group…", "Start over…", "New conversation with main", "Open a folder with main…", "New Group…", "Rename…", "Color…", "Agent settings…"]);
	// Rename turns its name in the side bar into a field: Escape keeps the name, Enter gives it the new one, and everything follows it.
	assert.deepEqual(await shown("spare", "rename"), ["Open", "Move to Group…", "Start over…", "New conversation with spare", "Open a folder with spare…", "New Group…", "Rename…", "Color…", "Agent settings…", "Remove spare…"]);
	await page.getByLabel("New name for spare").press("Escape");
	await sees("[data-slot=agent-label] >> text=spare");
	await shown("spare", "rename");
	await page.getByLabel("New name for spare").fill("Spare Hands");
	await page.getByLabel("New name for spare").press("Enter");
	await sees("[data-slot=toast] >> text=spare is called spare-hands now.");
	await sees("[data-slot=agent-label] >> text=spare-hands");
	assert.ok(fs.existsSync(path.join(home, "agents", "spare-hands", "agent.json")) && !fs.existsSync(path.join(home, "agents", "spare")));
	// Color opens the color over its avatar, and a pick is kept at once.
	await shown("spare-hands", "color");
	await page.locator("[data-slot=agent-color][data-open]").getByRole("button", { name: "Blue", exact: true }).click();
	const kept = path.join(home, "agents", "spare-hands", "agent.json");
	for (let i = 0; i < 100 && !json(kept)?.color; i++) await new Promise((r) => setTimeout(r, 30));
	assert.match(json(kept)?.color, /^#[0-9a-f]{6}$/);
	await page.keyboard.press("Escape");
	assert.deepEqual(await shown("spare-hands", "remove"), ["Open", "Move to Group…", "Start over…", "New conversation with spare-hands", "Open a folder with spare-hands…", "New Group…", "Rename…", "Color…", "Agent settings…", "Remove spare-hands…"]);
	// It asks first, and how: nothing is removed by the menu alone.
	// It is an alert dialog: it does not go away with a stray click beside it.
	await sees("[role=alertdialog] [data-slot=alert-dialog-title] >> text=Remove the agent spare-hands?");
	await page.mouse.click(5, 5);
	await sees("[role=alertdialog]");
	assert.ok(fs.existsSync(path.join(home, "agents", "spare-hands", "agent.json")));
	await page.click("[data-slot=command-item]:has-text('Remove it with everything it has')");
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
	await row("okapi-api").dragTo(group("Okapi").locator("[data-slot=group-label]"));
	await group("Okapi").locator("[role=option]", { hasText: /okapi-try$/ }).waitFor();
	assert.deepEqual([await groupOf("okapi-api"), await groupOf("okapi-try")], ["Okapi", "Okapi"]);
	// In the group, a conversation's name stands one step further in than outside it.
	const left = (l: any) => l.locator(":scope > :last-child").evaluate((e: Element) => e.getBoundingClientRect().left);
	assert.ok((await left(group("Okapi").locator("[role=option]", { hasText: /okapi-api$/ }))) > (await left(row("llama"))));

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
	await group("Okapi").locator("[role=option]", { hasText: /okapi-web$/ }).dragTo(agentLine);
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
	await page.fill("[data-slot=dialog-content] input[placeholder='The new name']", "Okapi 2026");
	await page.keyboard.press("Enter");
	await group("Okapi 2026").locator("[role=option]", { hasText: /okapi-try$/ }).waitFor();
	await shot("16-groups");

	// Removing the group asks first, and takes its conversations with it.
	await choose(group("Okapi 2026").locator("[data-slot=group-label]"), "remove");
	await sees("[role=alertdialog] [data-slot=alert-dialog-title] >> text=Remove the group Okapi 2026 and the 3 conversations in it for good?");
	await page.click("[data-slot=command-item]:has-text('Remove them for good')");
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
	await sees("[data-slot=marker][data-tone=accent] >> text=Taken back");
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
	// In the side bar it is under the conversation it was made from, one step in.
	await page.waitForFunction(() => [...document.querySelectorAll("#sidebar-panel [role=option]")].some((r) => /a branch of/.test(r.getAttribute("title") ?? "")));
	const rows = await page.$$eval("#sidebar-panel [role=option]", (els: Element[]) => els.map((e) => ({ title: e.getAttribute("title") ?? "", indent: parseFloat(getComputedStyle(e).paddingLeft) })));
	const at = rows.findIndex((r) => /a branch of/.test(r.title));
	assert.ok(rows[at].indent > rows[at - 1].indent, JSON.stringify(rows));
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
	await confirm(":is([data-slot=dialog-title], [data-slot=alert-dialog-title]) >> text=Which agent works in");
	await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=pine-desktop-folder");
	await menu("worktree");
	await confirm(":is([data-slot=dialog-title], [data-slot=alert-dialog-title]) >> text=Work in a worktree?");
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
	await shot("16-worktree");
	await page.locator("[data-slot=code-panel]").getByRole("button", { name: "Merge…" }).click();
	await confirm(":is([data-slot=dialog-title], [data-slot=alert-dialog-title]) >> text=1 commit ahead of");
	await sees("[data-slot=toast] >> text=merged into");
	assert.equal(fs.readFileSync(path.join(folder, "WORKTREE.md"), "utf8"), "made apart\n");
	assert.equal(fs.readFileSync(path.join(folder, "src", "index.ts"), "utf8"), uncommitted, "what was not committed in the folder stayed");

	// Discarded once merged: the folder's chip is back.
	await menu("worktree");
	await confirm(":is([data-slot=dialog-title], [data-slot=alert-dialog-title]) >> text=ahead of");
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

test("many tabs keep their width and scroll instead of stepping on each other", async () => {
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
	assert.ok(Math.min(...m.tabs.map((t: any) => t.width)) >= 96, "every tab keeps room for its avatar, a few letters and its close button");
	const on = m.tabs.find((t: any) => t.on);
	assert.ok(on.left >= m.strip.left - 0.5 && on.right <= m.strip.right + 0.5, `the tab in front is in view: ${JSON.stringify({ on, strip: m.strip })}`);
	assert.ok(m.plus.left >= m.strip.right && m.plus.right <= m.width, "the plus stays in view after the tabs");
	// Going back to the first tab scrolls it into view.
	await page.click("[data-slot=tab] >> nth=0");
	await menu("prev-tab");
	await page.waitForFunction(() => {
		const strip = document.querySelector("header [data-slot=scroll-area-viewport]")!.getBoundingClientRect();
		const r = document.querySelector("[data-slot=tab][data-active]")!.getBoundingClientRect();
		return r.left >= strip.left - 0.5 && r.right <= strip.right + 0.5;
	});
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
	await sees("[data-slot=dialog-content][data-tone=warn]");
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await tabs.nth(had).locator("[data-slot=badge]", { hasText: "!" }).waitFor();
	// Close Others from the second: every other tab goes, main's too, but the one that waits for an answer stays, and says why.
	await choose(had + 1, "Close Others");
	await count(2);
	await sees("[data-slot=toast] >> text=1 tab stayed open: it waits for your answer.");
	assert.equal(await tabs.nth(1).getAttribute("data-active"), "true");
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
	if (!(await page.$("[data-slot=code-panel]"))) await page.click(CODE_TOGGLE);
	await page.locator("[data-slot=code-panel]").getByRole("tab", { name: "Agent" }).click();
	await sees("[data-slot=code-panel] [data-slot=scroll-area] >> text=What it remembers");
	const width = () => page.$eval("[data-slot=code-panel]", (el: Element) => el.getBoundingClientRect().width);
	const was = await width();
	const edge = await page.$eval(CODE_EDGE, (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(edge.x + edge.width / 2, 300);
	await page.mouse.down();
	await page.mouse.move(edge.x + edge.width / 2 + 600, 300, { steps: 6 });
	await page.mouse.up();
	assert.ok((await width()) < was, "the panel was not made narrower");
	const fits = () => page.$eval("[data-slot=code-panel] [data-slot=scroll-area]:has-text(\"What it remembers\") > [data-slot=scroll-area-viewport]", (el: Element) => {
		const wide = [...el.querySelectorAll("*")].filter((c) => c.getBoundingClientRect().right > el.getBoundingClientRect().right + 0.5).slice(0, 5).map((c) => `${c.tagName}.${c.className}`.slice(0, 120));
		return { scroll: el.scrollWidth, client: el.clientWidth, wide };
	});
	const seen = await fits();
	await shot("agent-view-narrow");
	assert.ok(seen.scroll <= seen.client, `the Agent view is wider than the panel: ${JSON.stringify(seen)}`);
	// Its scroll bar, like every scroll area's, is hidden at rest and shows under the pointer and while it scrolls.
	// The fade is turned off for the reading: a window in the background runs its transitions slowly.
	const area = "[data-slot=code-panel] [data-slot=scroll-area]:has-text(\"What it remembers\")";
	const bar = `${area} > [data-slot=scroll-area-scrollbar][data-orientation=vertical]`;
	const handle = await page.$(bar);
	assert.ok(handle, "the Agent view has no scroll bar");
	const settled = (state: string) => page.waitForFunction(([el, state]) => {
		el.style.transition = "none";
		const on = el.hasAttribute("data-hovering") || el.hasAttribute("data-scrolling");
		return (state === "rest" ? !on : on) && getComputedStyle(el).opacity === (state === "rest" ? "0" : "1");
	}, [handle, state] as const, { timeout: 3000 }).then(() => true, () => false);
	await page.mouse.move(5, 5);
	assert.ok(await settled("rest"), "a scroll bar shows at rest");
	const box = await page.$eval(area, (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	assert.ok(await settled("on"), "a scroll bar stays hidden under the pointer");
	await page.mouse.move(5, 5);
	assert.ok(await settled("rest"), "a scroll bar stays shown once the pointer has left");
	await page.$eval(`${area} > [data-slot=scroll-area-viewport]`, (el: Element) => el.scrollBy(0, 40));
	assert.ok(await settled("on"), "a scroll bar stays hidden while it scrolls");
	// Back to the width it had, for the tests after this one.
	const back = await page.$eval(CODE_EDGE, (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(back.x + back.width / 2, 300);
	await page.mouse.down();
	await page.mouse.move(back.x + back.width / 2 - (was - (await width())), 300, { steps: 6 });
	await page.mouse.up();
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
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 380);
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
		// The panel beside a conversation is a sheet over it, and closing the sheet closes the panel.
		await menu("code-agent");
		await sees("[data-slot=sheet-content] [data-slot=code-panel]");
		assert.equal(await page.locator("[data-slot=resizable-handle]:has(+ #code-panel)").count(), 0);
		await page.keyboard.press("Escape");
		await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
		// The browser's aside is a sheet the same way, and of the two only the one opened last lies over the conversation;
		// the other one's icon says it is open behind.
		await menu("code-agent");
		await sees("[data-slot=sheet-content] [data-slot=code-panel]");
		await menu("browser");
		await sees("[data-slot=sheet-content] [data-slot=browser-aside]");
		assert.equal(await page.locator("[data-slot=code-panel]").count(), 0);
		assert.equal(await page.locator("[data-slot=resizable-handle]:has(+ #browser-panel)").count(), 0);
		await sees(`${CODE_TOGGLE}[data-behind]`);
		// Asking for the one behind brings it to the front; closing that one leaves the other behind, until it is asked for.
		await menu("code");
		await sees("[data-slot=sheet-content] [data-slot=code-panel]");
		assert.equal(await page.locator("[data-slot=browser-aside]").count(), 0);
		await sees(`${BROWSER_TOGGLE}[data-behind]`);
		await menu("code");
		await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
		assert.equal(await page.locator("[data-slot=sheet-content]").count(), 0);
		await menu("browser");
		await sees("[data-slot=sheet-content] [data-slot=browser-aside]");
		await menu("browser");
		await page.waitForSelector("[data-slot=browser-aside]", { state: "detached" });
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

test("in a window too narrow for columns, putting away the sheet in front leaves the other one open behind, not over the conversation", async () => {
	const size = (width: number, height: number) => page.setViewportSize({ width, height });
	const gone = (sel: string) => page.waitForSelector(sel, { state: "detached" });
	try {
		await page.click("[data-slot=tab] >> nth=0");
		if (await page.$("[data-slot=code-panel]")) await menu("code");
		if (await page.$("[data-slot=browser-aside]")) await menu("browser");
		await size(900, 760);
		await menu("browser");
		await sees("[data-slot=sheet-content] [data-slot=browser-aside]");
		await menu("code-agent");
		await sees("[data-slot=sheet-content] [data-slot=code-panel]");
		// Escape puts the side panel away: the browser stays open, behind, and no sheet comes up in its place.
		await page.keyboard.press("Escape");
		await gone("[data-slot=code-panel]");
		await new Promise((r) => setTimeout(r, 300));
		assert.equal(await page.locator("[data-slot=sheet-content]").count(), 0, "no sheet comes up by itself");
		await sees(`${BROWSER_TOGGLE}[aria-pressed=true][data-behind]`);
		await sees(`${CODE_TOGGLE}[aria-pressed=false]`);
		// Its own toggle brings it back as a sheet; its close button puts it away, and the side panel, open behind, stays there.
		await menu("code");
		await menu("browser");
		await sees("[data-slot=sheet-content] [data-slot=browser-aside]");
		await page.click("[data-slot=browser-aside] button[aria-label='Close the browser']");
		await gone("[data-slot=browser-aside]");
		await new Promise((r) => setTimeout(r, 300));
		assert.equal(await page.locator("[data-slot=sheet-content]").count(), 0, "no sheet comes up by itself");
		await sees(`${CODE_TOGGLE}[aria-pressed=true][data-behind]`);
		// Wide again: the one left open shows as a column.
		await size(1280, 820);
		await sees("#code-panel [data-slot=code-panel]");
		await menu("code");
		await gone("[data-slot=code-panel]");
	} finally {
		await size(1800, 900);
		if (await page.$("[data-slot=browser-aside]")) await menu("browser");
		if (await page.$("[data-slot=code-panel]")) await menu("code");
		await size(1280, 820);
	}
});

test("what was typed in a file and not saved stays when the panel becomes a sheet and a column again, and Escape in the editor leaves the sheet open", async () => {
	const size = (width: number, height: number) => page.setViewportSize({ width, height });
	try {
		// The folder's conversation from before is in a worktree by now: a new one in the folder itself.
		await menu(`folder:${folder}`);
		await confirm(":is([data-slot=dialog-title], [data-slot=alert-dialog-title]) >> text=Which agent works in");
		await sees("[data-slot=tab][data-active] [data-slot=tab-name] >> text=pine-desktop-folder");
		await menu("code-files");
		await sees("[data-slot=code-panel]");
		if (!(await page.$("[data-slot=code-panel] .cm-content"))) {
			await page.fill("[data-slot=code-panel] input[aria-label='Find a file']", "README");
			await page.locator("[data-slot=code-panel] [role=listbox] [role=option]").first().click();
		}
		await sees("[data-slot=code-panel] .cm-content");
		await page.click("[data-slot=code-panel] .cm-content");
		await page.keyboard.press("ControlOrMeta+End");
		await page.keyboard.type("unsaved draft");
		const save = page.locator("[data-slot=code-panel]").getByRole("button", { name: "Save" });
		assert.ok(await save.isEnabled());
		// Narrower than the room for a column: the panel is drawn again inside a sheet, with the draft still in it.
		await size(900, 760);
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
		// Wide again: the panel is a column, and the draft is still there to save or to leave.
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

test("a window too narrow for the side panel and the browser side by side shows the one opened last, and both again when it is wide", async () => {
	const size = (width: number, height: number) => page.setViewportSize({ width, height });
	const gone = (sel: string) => page.waitForSelector(sel, { state: "detached" });
	try {
		await page.click("[data-slot=tab] >> nth=0");
		// Wide: the side panel and the browser beside the conversation, both columns.
		await size(1800, 900);
		await menu("code-agent");
		await sees("#code-panel [data-slot=code-panel]");
		if (!(await page.$("[data-slot=browser-aside]"))) await menu("browser");
		await sees("#browser-panel [data-slot=browser-aside]");
		// Narrower (room for a column beside the conversation, not for two): the browser, opened last, stays; the side panel is open behind.
		await size(1280, 820);
		await gone("[data-slot=code-panel]");
		await sees("#browser-panel [data-slot=browser-aside]");
		assert.equal(await page.locator("[data-slot=sheet-content]").count(), 0, "a column, not a sheet");
		await sees(`${CODE_TOGGLE}[aria-pressed=true][data-behind]`);
		await sees(`${BROWSER_TOGGLE}[aria-pressed=true]:not([data-behind])`);
		// Wide again: both, without a click.
		await size(1800, 900);
		await sees("#code-panel [data-slot=code-panel]");
		await sees("#browser-panel [data-slot=browser-aside]");
		await sees(`${CODE_TOGGLE}:not([data-behind])`);
		// Narrow: a click on the icon of the one behind brings it to the front and puts the other behind.
		await size(1280, 820);
		await gone("[data-slot=code-panel]");
		await page.click(CODE_TOGGLE);
		await sees("#code-panel [data-slot=code-panel]");
		await gone("[data-slot=browser-aside]");
		await sees(`${BROWSER_TOGGLE}[data-behind]`);
		// A click on the icon of the one in front closes it, and the other one shows.
		await page.click(CODE_TOGGLE);
		await gone("[data-slot=code-panel]");
		await sees("#browser-panel [data-slot=browser-aside]");
		await sees(`${CODE_TOGGLE}[aria-pressed=false]`);
		// The agent's browser_show brings the browser in front of the side panel.
		await page.click(CODE_TOGGLE);
		await sees("#code-panel [data-slot=code-panel]");
		await gone("[data-slot=browser-aside]");
		const tabs = await page.locator("[data-slot=tab]").count();
		await menu("new");
		await page.waitForFunction((n) => document.querySelectorAll("[data-slot=tab]").length > n, tabs);
		await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "browser_show", args: {} }], text: "Have a look." }, { text: "There it is." }], "Show me the page. "));
		await page.keyboard.press("Enter");
		await sees("#browser-panel [data-slot=browser-aside]");
		await sees("[data-slot=markdown] >> text=There it is.");
		assert.equal(await page.locator("[data-slot=code-panel]").count(), 0);
		await sees(`${CODE_TOGGLE}[data-behind]`);
		await menu("close");
		await page.waitForFunction((n) => document.querySelectorAll("[data-slot=tab]").length === n, tabs);
	} finally {
		// Both closed and the width the start of this file set, for the tests that follow. (Wide, where both show, a toggle closes.)
		await size(1800, 900);
		if (await page.$("[data-slot=browser-aside]")) await menu("browser");
		if (await page.$("[data-slot=code-panel]")) await menu("code");
		await size(1280, 820);
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
	await sees("[data-slot=settings-page] [data-slot=alert] >> text=is not a host for ssh");
	assert.deepEqual((await page.evaluate(() => (window as any).pine.state())).prefs.hosts, []);
	await page.fill(input, "you@elsewhere");
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
	await md.locator('[data-streamdown="code-block"]').first().waitFor();
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
