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
import { browserPlaces } from "../../src/browser-build.ts";
import { launchApp, patient } from "./support/app.ts";

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
const sees = (selector: string, timeout = 20_000) => page.waitForSelector(selector, { timeout: patient(timeout) });
const panel = "[data-slot=code-panel]";
/** The side panel's tab for a view, and the one in front. */
const viewTab = (view: string) => `${panel} [data-slot=tabs-trigger][data-view=${view}]`;
/** Asks until `ok` says yes to what was answered, and says what was answered last when it never does. */
async function until<T>(what: string, ask: () => Promise<T>, ok: (answer: T) => boolean): Promise<T> {
	const deadline = Date.now() + patient(20_000);
	let last = await ask();
	while (!ok(last)) {
		if (Date.now() > deadline) assert.fail(`${what}: ${JSON.stringify(last)}`);
		await new Promise((r) => setTimeout(r, 100));
		last = await ask();
	}
	return last;
}
/** The boards there are, as the daemon lists them. */
const boards = async (): Promise<any[]> => {
	const listed = (await call("GET", "/boards")).data;
	return Array.isArray(listed) ? listed : (listed?.boards ?? []);
};
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
	// The browser of the web tools counts as there, so that the app's question about it lies over nothing here (app.test.ts tests it).
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	for (const place of (await browserPlaces()) ?? []) write(path.join(home, "browsers", path.basename(place), "INSTALLATION_COMPLETE"), "");
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
	await sees("[data-slot=tab][data-active]", 30_000);
	// No board yet: the panel has no such tab.
	await menu("code-agent");
	await sees(`${viewTab("agent")}[aria-selected=true]`);
	assert.equal(await page.locator(viewTab("board")).count(), 0);

	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "subagent", args: { pool: true, note: "Measure against tokens.css", tasks: ["check folder a @@REF:a@@", "check folder b @@REF:b@@"] } }] }, { text: "Both folders are checked." }], "Check the folders. "));
	await page.press("[data-slot=composer] textarea", "Enter");
	await sees("text=Both folders are checked.", 30_000);

	// The tab came by itself, with the number of tasks that are not settled: the one that waits for an answer.
	await sees(`${viewTab("board")}[data-count="1"]`);
	await page.click(viewTab("board"));
	await sees(`${panel} [data-task="1"][data-state=done]`);
	await sees(`${panel} [data-task="2"][data-state=blocked]`);
	// The task that waits says what it asks, and has a field for the answer.
	const waiting = page.locator(`${panel} [data-task="2"]`);
	assert.ok((await waiting.innerText()).includes("teal or blue?"), "the sub-agent's question is on its task");
	assert.equal(await waiting.locator("[data-entry=answer]").count(), 1);
	assert.equal(await page.locator(`${panel} [data-task="1"] [data-entry=answer]`).count(), 0, "a task that is done asks for nothing");
	// What the agent told all of its sub-agents stands there once, and the board keeps which tasks it is for.
	assert.ok((await page.locator(`${panel} [data-note="3"]`).innerText()).includes("Measure against tokens.css"));
	assert.equal(await page.locator(`${panel} [data-note]`, { hasText: "Measure against tokens.css" }).count(), 1);
	assert.deepEqual((await call("GET", "/boards/1")).data.notes.find((n: any) => n.id === 3).data, { tasks: [1, 2] });
	// What an agent wrote is text: its markup is shown, not carried out.
	const note = page.locator(`${panel} [data-note="4"]`);
	assert.ok((await note.innerText()).includes("The reference is tokens.css <b>not bold</b>"), "the markup an agent wrote is shown as it was written");
	assert.equal(await note.locator("b").count(), 0, "and is no element of the page");
	await shot("board-blocked");
	// A task opens by the keyboard too: its text is a button that says whether it is open, and opened it shows its result.
	const title = page.locator(`${panel} [data-task="1"]`).getByRole("button", { name: /check folder a/ });
	assert.equal(await title.getAttribute("aria-expanded"), "false");
	assert.ok(!(await page.locator(`${panel} [data-task="1"]`).innerText()).includes("a is consistent"));
	await title.focus();
	await page.keyboard.press("Enter");
	await sees(`${panel} [data-task="1"] [aria-expanded=true]`);
	await page.locator(`${panel} [data-task="1"]`, { hasText: "a is consistent" }).waitFor();

	// The owner answers the task that waits for them: it is open again, with the answer as a note on it.
	await page.fill(`${panel} [data-task="2"] [data-entry=answer]`, "teal");
	await page.press(`${panel} [data-task="2"] [data-entry=answer]`, "Enter");
	await sees(`${panel} [data-task="2"][data-state=open]`);
	const view = (await call("GET", "/boards/1")).data;
	assert.deepEqual([view.notes.at(-1).text, view.notes.at(-1).data], ["teal", { question: "teal or blue?" }]);
	assert.equal(view.notes.at(-1).by, "owner");

	// A task of the owner's own: open, and marked as theirs. Then taken off the board again.
	await page.fill(`${panel} [data-entry=add]`, "look at the footer too");
	await page.press(`${panel} [data-entry=add]`, "Enter");
	const added = page.locator(`${panel} [data-task]`, { hasText: "look at the footer too" });
	await added.waitFor();
	assert.deepEqual([await added.getAttribute("data-state"), await added.getAttribute("data-by")], ["open", "owner"]);
	assert.equal(await page.locator(`${panel} [data-task="1"]`).getAttribute("data-by"), "main", "a task the agent gave out is the agent's");
	await shot("board-added");
	await added.locator("[data-action=task-menu]").click();
	await page.locator("[role=menu] [data-action=remove]").click();
	await added.waitFor({ state: "detached" });
	assert.deepEqual((await call("GET", "/boards/1")).data.tasks.map((t: any) => [t.id, t.state]), [[1, "done"], [2, "open"]]);

	// Clearing the board asks first, with a way back; going on takes the board away and closes the question.
	await page.locator(`${panel} [data-slot=board-bar] [data-action=clear]`).click();
	const question = page.locator("[data-slot=alert-dialog-content]");
	await question.waitFor();
	assert.equal(await question.locator("[data-slot=alert-dialog-cancel]").count(), 1);
	await question.locator("[data-slot=alert-dialog-action]").click();
	await question.waitFor({ state: "detached" });
	// No board is left: the tab has none to show, and still takes a first task.
	await page.locator(`${panel} [data-slot=board-bar]`).waitFor({ state: "detached" });
	assert.equal(await page.locator(`${panel} [data-entry=add]`).count(), 1);
	assert.deepEqual((await boards()).map((b: any) => b.id), []);
});

test("/swarm in the input starts a swarm: the conversation says what pine does about it, its work is on the Board tab, and one that is paused shows above the input", async () => {
	// A conversation of its own, so that the board of the test before is not in the way.
	const session = "the-swarm";
	await page.fill("[data-slot=composer] textarea", `/new ${session}`);
	await page.press("[data-slot=composer] textarea", "Enter");
	await page.locator("[data-slot=tab][data-active] [data-slot=tab-name]", { hasText: session }).waitFor({ timeout: patient(20_000) });
	await sees(`${panel} [data-entry=add]`);
	assert.equal(await page.locator(`${panel} [data-slot=board-bar]`).count(), 0, "a new conversation has no board");
	const swarm = async () => (await call("GET", `/agents/main/swarm?session=${session}`)).data?.swarm;
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
	// The check ran after the lead's turn: its line is closed with it, and no group of steps in the conversation is still at work.
	assert.deepEqual(await page.$$eval("[data-item=work] [data-slot=pulse]", (all: Element[]) => all.length), 0, "no group of steps is left pulsing after the swarm is done");
	// The job is shown once, as the owner's message: what pine told the lead and the checker, which both quote the job, is no message.
	const said = await page.locator("[data-slot=message-scroller], main").first().innerText();
	assert.equal(said.split("sort the archive").length - 1, 1, said);
	assert.equal((await swarm()).status, "done");
	// Its work is on the conversation's board: the piece and the check of the answer, both done.
	await page.click(viewTab("board"));
	await page.locator(`${panel} [data-task][data-state=done]`, { hasText: "sort the first shelf" }).waitFor({ timeout: patient(20_000) });
	const board = (await boards()).find((b: any) => b.session === session);
	assert.ok(board, "the swarm's work is on the board of its own conversation");
	const tasks = await until("the piece and the check are both done", async () => (await call("GET", `/boards/${board.id}`)).data.tasks.map((t: any) => t.state) as string[], (states) => states.length === 2 && states.every((x) => x === "done"));
	await until("the tab shows both", () => page.locator(`${panel} [data-task][data-state=done]`).count(), (n: number) => n === tasks.length);
	await shot("swarm-done");

	// A swarm that is paused: a notice above the input, with a way to go on and one to end it. Ending it takes it off.
	mock.state.scripts.slow = [{ delayMs: 15_000, text: "never" }];
	await page.fill("[data-slot=composer] textarea", "/swarm sort the cellar @@REF:slow@@");
	await page.press("[data-slot=composer] textarea", "Enter");
	await until("the second swarm is at work", swarm, (w: any) => w?.status === "active" && w.round >= 1);
	await page.fill("[data-slot=composer] textarea", "/swarm pause");
	await page.press("[data-slot=composer] textarea", "Enter");
	const banner = page.locator("[data-notice=swarm][data-state=paused]");
	await banner.waitFor({ timeout: patient(20_000) });
	assert.equal((await swarm()).status, "paused");
	assert.equal(await banner.locator("[data-action=resume]").count(), 1, "the paused notice has the way to go on");
	await shot("swarm-paused");
	await banner.locator("[data-action=clear]").click();
	await banner.waitFor({ state: "detached", timeout: patient(20_000) });
	assert.equal(await swarm(), undefined);
	await menu("stop");
});
