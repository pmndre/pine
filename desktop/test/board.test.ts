// The Board tab beside a conversation: the real app on a home of its own, an agent that splits a
// job among a pool of sub-agents, and the owner's hand on the board that results (an answer to a
// task that waits for them, a task of their own, one removed).
//   PINE_DESKTOP_SHOTS=<folder>      also saves a picture of the tab there
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

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};
const menu = (command: string) => app.evaluate(({ BrowserWindow }: any, c: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", c), command);
const call = (method: string, url: string, body?: unknown) => page.evaluate(([m, u, b]: [string, string, unknown]) => (window as any).pine.call(m, u, b), [method, url, body]);
const sees = (selector: string, timeout = 20_000) => page.waitForSelector(selector, { timeout });
const panel = "[data-slot=code-panel]";
const shots = process.env.PINE_DESKTOP_SHOTS;
const shot = async (name: string) => {
	if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) });
};

before(async () => {
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-board-")));
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "auto", introduce: false }, security: { askAccess: false } }));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ subagents: { maxParallel: 2 } }));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n\nYou are the main agent.\n");
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	write(path.join(home, "desktop-data", "prefs.json"), JSON.stringify({ updates: false }));
	// What the sub-agents do: one leaves a note with markup in it, one asks a question.
	mock.state.scripts.a = [{ tools: [{ name: "board_post", args: { type: "note", text: "The reference is tokens.css <b>not bold</b>" } }] }, { text: "a is consistent" }];
	mock.state.scripts.b = [{ tools: [{ name: "board_done", args: { id: 2, outcome: "blocked", result: "teal or blue?" } }] }, { text: "asked" }];

	app = await launchApp({ ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"), PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "" });
	page = await app.firstWindow();
	await page.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	if (home) fs.rmSync(home, { recursive: true, force: true });
});

test("the Board tab appears with a conversation's board and shows who has what; the owner answers, adds and removes there", async () => {
	await sees("[data-slot=empty] h1", 30_000);
	const dialog = await page.waitForSelector("[data-slot=dialog-footer] button >> text=Not now", { timeout: 5000 }).catch(() => undefined);
	if (dialog) await dialog.click();
	// No board yet: the panel has no such tab.
	await menu("code-agent");
	await sees(`${panel} [data-slot=tabs-trigger] >> text=Agent`);
	assert.equal(await page.locator(`${panel} [data-slot=tabs-trigger]`, { hasText: "Board" }).count(), 0);

	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "subagent", args: { pool: true, note: "Measure against tokens.css", tasks: ["check folder a @@REF:a@@", "check folder b @@REF:b@@"] } }] }, { text: "Both folders are checked." }], "Check the folders. "));
	await page.press("[data-slot=composer] textarea", "Enter");
	await sees("text=Both folders are checked.", 30_000);

	// The tab came by itself, with the number of tasks that are not settled.
	const tab = page.locator(`${panel} [data-slot=tabs-trigger]`, { hasText: "Board" });
	await tab.waitFor({ timeout: 20_000 });
	await page.locator(`${panel} [data-slot=tabs-trigger]`, { hasText: /Board\s*1$/ }).waitFor({ timeout: 20_000 });
	await tab.click();
	await sees(`${panel} [data-task="1"][data-state=done]`);
	await sees(`${panel} [data-task="2"][data-state=blocked]`);
	assert.match(await page.locator(`${panel} [data-task="2"]`).innerText(), /Waiting for an answer[\s\S]*teal or blue\?/);
	// What the agent told all of its sub-agents stands there once, with the tasks it is for.
	assert.match(await page.locator(`${panel} [data-note="3"]`).innerText(), /Measure against tokens\.css[\s\S]*for tasks 1–2/);
	// What an agent wrote is text: its markup is shown, not carried out.
	const note = page.locator(`${panel} [data-note="4"]`);
	assert.match(await note.innerText(), /The reference is tokens\.css <b>not bold<\/b>/);
	assert.equal(await note.locator("b").count(), 0);
	await shot("board-blocked");
	// A task opens by the keyboard too: its text is a button that says whether it is open, and opened it shows its result.
	const title = page.locator(`${panel} [data-task="1"]`).getByRole("button", { name: /check folder a/ });
	assert.equal(await title.getAttribute("aria-expanded"), "false");
	assert.doesNotMatch(await page.locator(`${panel} [data-task="1"]`).innerText(), /a is consistent/);
	await title.focus();
	await page.keyboard.press("Enter");
	await sees(`${panel} [data-task="1"] [aria-expanded=true]`);
	assert.match(await page.locator(`${panel} [data-task="1"]`).innerText(), /a is consistent/);

	// The owner answers the task that waits for them: it is open again, with the answer as a note on it.
	await page.fill(`${panel} input[aria-label="Answer task 2"]`, "teal");
	await page.press(`${panel} input[aria-label="Answer task 2"]`, "Enter");
	await sees(`${panel} [data-task="2"][data-state=open]`);
	const view = (await call("GET", "/boards/1")).data;
	assert.deepEqual([view.notes.at(-1).text, view.notes.at(-1).data], ["teal", { question: "teal or blue?" }]);
	assert.equal(view.notes.at(-1).by, "owner");

	// A task of the owner's own, and one taken off the board again.
	await page.fill(`${panel} input[aria-label="Add a task"]`, "look at the footer too");
	await page.press(`${panel} input[aria-label="Add a task"]`, "Enter");
	const added = page.locator(`${panel} [data-task]`, { hasText: "look at the footer too" });
	await added.waitFor();
	assert.match(await added.innerText(), /Open · yours/);
	await shot("board-added");
	await added.getByRole("button", { name: /Actions for task/ }).click();
	await page.getByRole("menuitem", { name: "Remove" }).click();
	await added.waitFor({ state: "detached" });
	assert.deepEqual((await call("GET", "/boards/1")).data.tasks.map((t: any) => [t.id, t.state]), [[1, "done"], [2, "open"]]);

	// Clear asks first; its Remove takes the board away and closes the question.
	await page.locator(`${panel} [data-slot=board-bar]`).getByRole("button", { name: "Clear" }).click();
	const question = page.locator("[data-slot=alert-dialog-content]", { hasText: "Remove this board?" });
	await question.getByRole("button", { name: "Remove" }).click();
	await question.waitFor({ state: "detached" });
	await sees(`${panel} >> text=No board yet`);
	const left = (await call("GET", "/boards")).data;
	assert.deepEqual((Array.isArray(left) ? left : left.boards).map((b: any) => b.id), []);
});

test("/swarm in the input starts a swarm: the conversation says what pine does about it, its work is on the Board tab, and one that is paused shows above the input", async () => {
	// A conversation of its own, so that the board of the test before is not in the way.
	await page.fill("[data-slot=composer] textarea", "/new swarmed");
	await page.press("[data-slot=composer] textarea", "Enter");
	await page.locator("[data-slot=tab][data-active] [data-slot=tab-name]", { hasText: "new conversation" }).waitFor({ timeout: 20_000 });
	await sees(`${panel} >> text=No board yet`);
	// The lead hands out one piece and answers; pine has that answer checked by a sub-agent it starts itself.
	// (Both are told the job, which names the script: who is asking is read from what it was told last.)
	Object.defineProperty(mock.state.scripts, "lead", {
		configurable: true,
		get: () => {
			const said = JSON.stringify(mock.state.requests.at(-1)?.body.messages.filter((m: any) => m.role === "user").at(-1) ?? "");
			if (said.includes("Check the answer below")) return [{ delayMs: 600, text: "Compared it with the shelves, it matches.\n\nPASS" }];
			return [{ tools: [{ name: "subagent", args: { tasks: ["sort the first shelf @@REF:piece@@"] } }] }, { text: "SWARM-ANSWER every shelf is sorted" }];
		},
	});
	mock.state.scripts.piece = [{ text: "shelf one sorted" }];
	await page.fill("[data-slot=composer] textarea", "/swarm sort the archive @@REF:lead@@");
	await page.press("[data-slot=composer] textarea", "Enter");
	await sees("[data-item=swarm][data-state=active]", 30_000);
	await sees("text=SWARM-ANSWER every shelf is sorted", 30_000);
	await sees("[data-item=swarm][data-state=checking]", 30_000);
	await sees("[data-item=swarm][data-state=done]", 30_000);
	// The check ran after the lead's turn: its line is closed with it, and nothing in the conversation says "working" any more.
	assert.deepEqual(await page.$$eval("[data-item=work] [data-slot=pulse]", (all) => all.length), 0, "no group of steps is left pulsing after the swarm is done");
	assert.ok(!(await page.locator("[data-slot=message-scroller], main").first().innerText()).includes("so far"));
	// The job is shown once, as the owner's message, without what pine told the lead under it.
	const said = await page.locator("[data-slot=message-scroller], main").first().innerText();
	assert.equal(said.split("sort the archive").length - 1, 1, said);
	assert.ok(!said.includes("your owner started a swarm") && !said.includes("Check the answer below before"), "what pine told the lead is not shown as a message");
	// (Which conversation it is, the board says: the one that is not the main conversation's.)
	const listed = (await call("GET", "/boards")).data;
	const session = (Array.isArray(listed) ? listed : listed.boards).find((b: any) => b.session !== "main").session;
	assert.equal((await call("GET", `/agents/main/swarm?session=${session}`)).data.swarm.status, "done");
	// Its work is on the conversation's board: the piece and the check of the answer, both done.
	const tab = page.locator(`${panel} [data-slot=tabs-trigger]`, { hasText: "Board" });
	await tab.waitFor({ timeout: 20_000 });
	await tab.click();
	await page.locator(`${panel} [data-task][data-state=done]`, { hasText: "sort the first shelf" }).waitFor({ timeout: 20_000 });
	await page.locator(`${panel} [data-task][data-state=done]`, { hasText: "Check the answer below" }).waitFor({ timeout: 20_000 });
	await shot("swarm-done");

	// A swarm that is paused: a banner above the input, with Resume and Clear. Clear takes it off.
	mock.state.scripts.slow = [{ delayMs: 15_000, text: "never" }];
	await page.fill("[data-slot=composer] textarea", "/swarm sort the cellar @@REF:slow@@");
	await page.press("[data-slot=composer] textarea", "Enter");
	await sees("text=/round 1 of 8/", 30_000);
	await page.fill("[data-slot=composer] textarea", "/swarm pause");
	await page.press("[data-slot=composer] textarea", "Enter");
	const banner = page.locator("[data-slot=alert]", { hasText: "Swarm paused" });
	await banner.waitFor({ timeout: 20_000 });
	assert.match(await banner.innerText(), /resume/i, "the paused banner tells the owner how to go on");
	await shot("swarm-paused");
	await banner.getByRole("button", { name: "Clear" }).click();
	await banner.waitFor({ state: "detached", timeout: 20_000 });
	assert.equal((await call("GET", `/agents/main/swarm?session=${session}`)).data.swarm, undefined);
	await menu("stop");
});
