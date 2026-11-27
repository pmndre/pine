// The view in the real app, on a home of its own with the scripted model server: pine puts its own view
// (office) into the home's views folder, the panel runs it in its frame, and it draws the agents, the
// work main hands books and that this work is held to main's stricter mode. A view of the test's own
// then tries everything a view must not do, and gets none of it. Without a view there is no button.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { mockMsg, startMock } from "../../baseline/tests/mock.mjs";
import { launchApp, patient } from "./support/app.ts";

// PINE_DESKTOP_SHOTS=<folder> also saves pictures there, and PINE_DESKTOP_THEME=<theme> runs it in that theme of pine's (github-light, nord ...).
const shots = process.env.PINE_DESKTOP_SHOTS;
const shoot = async (name: string) => shots && (await page.screenshot({ path: path.join(shots, `view-${name}.png`) }));

let app: any;
let page: any;
let mock: any;
let home: string;
/** A server on this computer that a view might try to tell what it saw: it counts every request. */
let snitch: http.Server;
let snitchPort = 0;
const reached: string[] = [];

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};
const menu = (name: string) => app.evaluate(({ BrowserWindow }: any, n: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", n), name);
const call = (method: string, url: string, body?: unknown) => page.evaluate(([m, u, b]: [string, string, unknown]) => (window as any).pine.call(m, u, b), [method, url, body]);
/** The view's frame, as the test reads it: the office writes what it draws in words, too. */
const frame = () => page.frameLocator("[data-slot=view-frame]");
const said = (agent: string) => frame().locator(`[data-slot=office-words] > li[data-agent=${agent}]`).textContent();
/** The first piece of work of an agent's of a kind, by its number, as the daemon has it. */
const taskOf = async (agent: string, kind: string): Promise<number> => {
	const tasks = ((await call("GET", `/tasks?agent=${agent}`)) as { data: Array<{ id: number; kind: string }> }).data;
	const ids = tasks.filter((t) => t.kind === kind).map((t) => t.id);
	assert.ok(ids.length, `${agent} has a piece of work of the kind ${kind}`);
	return Math.min(...ids);
};
const lineOf = (job: number) => `[data-slot=view-inspector] [data-slot=view-line][data-job="${job}"]`;

async function sees(selector: string, why: string, timeout = patient(15_000)): Promise<void> {
	try {
		await page.waitForSelector(selector, { timeout });
	} catch {
		const shown = await page.textContent("[data-slot=view]").catch(() => "(no view)");
		assert.fail(`${why}: ${selector} did not show. The panel shows: ${shown}`);
	}
}

before(async () => {
	snitch = http.createServer((req, res) => {
		reached.push(String(req.url));
		res.writeHead(200, { "access-control-allow-origin": "*", "content-type": "text/plain" });
		res.end("ok");
	});
	await new Promise<void>((r) => snitch.listen(0, "127.0.0.1", r));
	snitchPort = (snitch.address() as { port: number }).port;
	mock = await startMock({});
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-view-")));
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe", introduce: false }, security: { askAccess: false }, ui: { view: "office", ...(process.env.PINE_DESKTOP_THEME ? { theme: process.env.PINE_DESKTOP_THEME } : {}) } }));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ mode: "safe" }));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n\nYou are the main agent.\n");
	write(path.join(home, "agents", "books", "agent.json"), JSON.stringify({ mode: "bypass", color: "#e0805a" }));
	write(path.join(home, "agents", "books", "workspace", "AGENTS.md"), "Keeps the books.\n\nYou keep the books.\n");
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	write(path.join(home, "desktop-data", "prefs.json"), JSON.stringify({ updates: false }));
	app = await launchApp({ ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"), PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "" });
	page = await app.firstWindow();
	await page.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
	await page.waitForSelector("[data-slot=empty] h1", { timeout: 30_000 });
	// The question about the browser, where it comes: put away as the Escape key puts it away, whatever its buttons say.
	const dialog = await page.waitForSelector("[data-slot=dialog-content]", { timeout: 3000 }).catch(() => undefined);
	if (dialog) {
		await page.keyboard.press("Escape");
		await page.waitForSelector("[data-slot=dialog-content]", { state: "detached", timeout: 5000 });
	}
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	snitch?.close();
	if (home) fs.rmSync(home, { recursive: true, force: true });
});

// The home of these tests names the office in its pine.json: with none named, the panel shows the overview.
test("pine puts its own views into the home, and the panel runs the one that is chosen beside any tab, telling it every agent and its mode", async () => {
	assert.ok(fs.existsSync(path.join(home, "views", "office.ts")), "the office is in the views folder");
	assert.ok(fs.existsSync(path.join(home, "views", ".pine", "view.ts")), "and the module views import, for the owner's editor");
	assert.match(fs.readFileSync(path.join(home, "views", "tsconfig.json"), "utf8"), /"pine\/view": \["\.\/\.pine\/view\.ts"\]/);
	await sees("[data-toggle=view]", "the view's button in the title bar");
	await menu("view");
	await sees("[data-slot=view-aside] [data-slot=view][data-view=office] [data-slot=view-frame][data-ready]", "the office, running in its frame");
	await frame().locator("[data-slot=office-words] > li[data-agent=books]").waitFor({ state: "attached", timeout: 10_000 });
	// Each agent with the mode this home gave it: the names and the modes are the test's own.
	assert.match(await said("books"), /books[\s\S]*bypass/);
	assert.match(await said("main"), /main[\s\S]*safe/);
	assert.doesNotMatch(await said("main"), /bypass/);
	assert.equal(await page.getAttribute("[data-toggle=view]", "aria-pressed"), "true");
	assert.match(await page.textContent("[data-slot=view-select]"), /office/, "the view's name, at the top, is where another is picked");
});

test("work main hands books shows at books, held to main's safe mode; what happened is said under the view", async () => {
	mock.state.scripts.slow = [{ delayMs: 4000, text: "the books are balanced" }];
	await call("POST", "/agents/main/prompt", { prompt: mockMsg([{ tools: [{ name: "delegate", args: { agent: "books", task: "Check the books @@REF:slow@@" } }] }, { text: "done" }]), session: "main", wait: false });
	const busy = frame().locator("[data-slot=office-words] > li[data-agent=books] li[data-work]");
	await busy.waitFor({ state: "attached", timeout: 15_000 });
	assert.match(await busy.textContent(), /main/, "whom it works for");
	// books works in bypass by itself; handed work from main (safe), it is held to safe: the only way "safe" gets into its line.
	await frame().locator("[data-slot=office-words] > li[data-agent=books] li[data-work]", { hasText: "safe" }).waitFor({ state: "attached", timeout: 8000 });
	if (shots) await new Promise((r) => setTimeout(r, 1200));
	await shoot("office");
	await busy.waitFor({ state: "detached", timeout: 15_000 });
	// Under the view: lines about that piece of work, by its number, one of them with the task the test gave.
	const job = await taskOf("books", "delegate");
	await sees(lineOf(job), "a line about the work books was handed");
	const lines: string[] = await page.$$eval(lineOf(job), (els: Element[]) => els.map((el) => el.textContent ?? ""));
	assert.ok(lines.some((t) => t.includes("Check the books")), `the task it was given is named: ${lines.join(" | ")}`);
});

test("the line between the view and what happened is moved by the keyboard, where it was put is kept, and a double-click moves it again", async () => {
	const line = "[data-slot=view] [data-slot=resizable-handle]";
	// The line is a separator: where it stands is its value, and what the owner chose is kept in the page's storage.
	const stands = async () => Number(await page.getAttribute(line, "aria-valuenow"));
	const keptAt = () => page.evaluate(() => localStorage.getItem("pine.view.inspector"));
	const moved = (from: number) => page.waitForFunction(([sel, v]: [string, number]) => Number(document.querySelector(sel)?.getAttribute("aria-valuenow")) !== v, [line, from] as [string, number], { timeout: patient(3000) });
	const keptAnew = (was: string | null) => page.waitForFunction((v: string | null) => localStorage.getItem("pine.view.inspector") !== v, was, { timeout: patient(3000) });
	const before = await stands();
	const keptBefore = await keptAt();
	assert.ok(Number.isFinite(before), "the line says where it stands");
	await page.focus(line, { timeout: patient(3000) });
	for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowUp");
	await moved(before);
	await keptAnew(keptBefore);
	const after = await stands();
	const keptAfter = await keptAt();
	assert.ok(Number(keptAfter) > 0, "what was chosen is kept");
	await shoot("taller-inspector");
	// A double-click on the line puts it back where it starts: it stands elsewhere again, and that is kept too.
	await page.$eval(line, (el: Element) => el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
	await moved(after);
	await keptAnew(keptAfter);
});

test("a piece of work chosen under the view shows what it was given, what it did and what it answered", async () => {
	const job = await taskOf("books", "delegate");
	await page.locator(lineOf(job)).first().click();
	await sees(`[data-slot=view-inspector][data-showing=job][data-id="${job}"] [data-slot=job-record]`, "the record of that piece of work");
	await page.waitForFunction(() => /the books are balanced/.test(document.querySelector("[data-slot=job-record]")?.textContent ?? ""), null, { timeout: 10_000 });
	const record = await page.textContent("[data-slot=job-record]");
	assert.match(record, /Check the books/, "the task books was given, in full");
	await sees("[data-slot=job-record] [data-slot=job-stats]", "and what it cost");
	await page.locator("[data-slot=job-record]").scrollIntoViewIfNeeded();
	await shoot("job-record");
	await page.locator("[data-slot=view-inspector] [data-action=back]").click();
	await sees("[data-slot=view-inspector][data-showing=feed]", "what happened, again");
	assert.equal(await page.locator("[data-slot=view-inspector] [data-slot=job-record]").count(), 0);
});

test("a piece of work opens from under the view, and the browser opens in the side panel beside the view", async () => {
	const asked = await taskOf("main", "prompt");
	await page.locator(lineOf(asked)).first().click();
	await sees(`[data-slot=view-inspector][data-showing=job][data-id="${asked}"]`, "what the owner asked main, chosen");
	await page.locator("[data-slot=view-inspector] [data-action=open]").click();
	await page.waitForSelector("[data-slot=tab][data-active]", { timeout: 10_000 });
	assert.match(await page.textContent("[data-slot=tab][data-active]"), /main/);
	await page.setViewportSize({ width: 1700, height: 900 });
	await menu("browser");
	await sees("[data-slot=code-panel] [data-slot=browser]", "the browser, in the side panel");
	await sees("[data-slot=view-aside]", "the view, still open beside it");
	await shoot("beside-browser");
	// Each in a group of its own: a narrower window keeps both, narrower.
	await page.setViewportSize({ width: 1280, height: 820 });
	await sees("[data-slot=view-aside]", "the view, still there");
	await sees("[data-slot=code-panel] [data-slot=browser]", "the browser, still there");
	await menu("browser");
	await page.waitForSelector("[data-slot=code-panel]", { state: "detached", timeout: 5000 });
	await sees("[data-slot=view-aside]", "the view, open when the side panel is put away");
});

test("a view can reach neither the app, nor the daemon, nor the network, nor storage, and is told no text of pine's", async () => {
	// A view of the test's own that tries it all, and writes down how it went.
	write(
		path.join(home, "views", "spy.js"),
		`import { defineView } from "pine/view";
export default defineView((host) => {
	const out = {};
	const tryIt = (k, fn) => { try { out[k] = "reached: " + String(fn()); } catch { out[k] = "refused"; } };
	tryIt("bridge", () => typeof window.parent.pine);
	tryIt("top", () => window.top.location.href);
	tryIt("storage", () => localStorage.length);
	tryIt("cookie", () => document.cookie);
	fetch("http://127.0.0.1:${snitchPort}/fetch").then(() => (out.fetch = "reached"), () => (out.fetch = "refused"));
	const img = new Image();
	img.onload = () => (out.img = "reached");
	img.onerror = () => (out.img = "refused");
	img.src = "http://127.0.0.1:${snitchPort}/img";
	const pre = document.createElement("pre");
	pre.id = "spy";
	host.root.append(pre);
	const look = (s) => {
		const all = JSON.stringify(s);
		out.leak = /CANARY/.test(all) ? "leaked" : "clean";
		if (s.work.some((w) => w.agent === "books" && w.doing !== "done")) out.books = "seen";
		// All of it is over once books was seen at work and nothing runs any more: main's answer is in by then.
		if (out.books && s.work.every((w) => ["done", "failed", "cancelled"].includes(w.doing))) out.over = "seen";
		pre.textContent = JSON.stringify(out);
	};
	host.on("state", look);
	host.on("happening", (h) => look({ ...host.state(), h }));
	look(host.state());
	// It asks the panel to open an agent there is none of, and to show one there is.
	host.open({ agent: "nobody" });
	host.select({ agent: "books" });
});
`,
	);
	// Picked where the view's name stands: the list reads the folder again, and offers the new file.
	await page.click("[data-slot=view-select]");
	await page.getByRole("option", { name: "spy" }).click();
	await sees("[data-slot=view][data-view=spy] [data-slot=view-frame][data-ready]", "the spy, running in its frame");
	// Work whose text, and whose tool's path, carry a word the view must never see.
	mock.state.scripts.canary = [{ tools: [{ name: "read", args: { path: "/tmp/CANARY-7731/notes.md" } }] }, { delayMs: 1500, text: "CANARY-7731 counted" }];
	await call("POST", "/agents/main/prompt", { prompt: mockMsg([{ tools: [{ name: "delegate", args: { agent: "books", task: "Count CANARY-7731 @@REF:canary@@" } }] }, { text: "CANARY-7731 done" }]), session: "main", wait: false });
	const spy = frame().locator("#spy");
	await frame().locator("#spy", { hasText: '"books":"seen"' }).waitFor({ timeout: 15_000 });
	// Until the work is over and both of the view's tries at the network have come out one way or the other.
	for (const settled of ['"over":"seen"', '"fetch":"', '"img":"']) await frame().locator("#spy", { hasText: settled }).waitFor({ timeout: patient(15_000) });
	const out = JSON.parse((await spy.textContent()) ?? "{}");
	assert.equal(out.bridge, "refused", "the app's bridge is out of reach");
	assert.equal(out.top, "refused", "the app's window is out of reach");
	assert.equal(out.storage, "refused", "the page's storage is out of reach");
	assert.equal(out.cookie, "refused");
	assert.equal(out.fetch, "refused", "no address can be fetched");
	assert.equal(out.img, "refused", "nor loaded as a picture");
	assert.equal(out.leak, "clean", "no prompt, answer or path reaches the view");
	assert.deepEqual(reached, [], "nothing reached the server on this computer");
	// The panel showed books, as asked, and opened nothing for an agent there is none of.
	await sees("[data-slot=view-inspector][data-showing=agent][data-id=books]", "books, shown under the view as the view asked");
	assert.ok(!(await page.$$eval("[data-slot=tab]", (tabs: Element[]) => tabs.map((t) => t.textContent).join("\n"))).includes("nobody"));
});

test("a view names a board's task by its numbers and the panel says what the task is; the view itself is told none of it", async () => {
	write(
		path.join(home, "views", "pointer.js"),
		`import { defineView } from "pine/view";
export default defineView((host) => {
	const pre = document.createElement("pre");
	pre.id = "pointer";
	host.root.append(pre);
	let asked = false;
	const look = (s) => {
		const b = s.boards.find((x) => x.tasks.length);
		if (b && !asked) {
			asked = true;
			// A task there is, and then one there is not: the panel goes by what it knows.
			host.select({ board: b.id, task: b.tasks[0].id, text: "CANARY from the view" });
			host.open({ board: b.id });
		}
		pre.textContent = JSON.stringify({ leak: /CANARY/.test(JSON.stringify(s)) ? "leaked" : "clean", selected: s.selected ?? null, task: b ? Object.keys(b.tasks[0]).sort() : [] });
	};
	host.on("state", look);
	look(host.state());
});
`,
	);
	await page.click("[data-slot=view-select]");
	await page.getByRole("option", { name: "pointer" }).click();
	await sees("[data-slot=view][data-view=pointer] [data-slot=view-frame][data-ready]", "the pointing view, running in its frame");
	// A task and a note about it on the board of main's conversation, both with a word no view may see.
	const posted = ((await call("POST", "/agents/main/boards/post", { session: "main", text: "Look up CANARY-8842 in the ledger" })) as { data: { board: number; id: number } }).data;
	await call("POST", `/boards/${posted.board}/post`, { text: "CANARY-8842 is on page 3", kind: "note", on: posted.id });
	// The panel shows the task in its words, with the note about it.
	await sees("[data-slot=view-task-text]", "the task's text, drawn by the panel under the view");
	assert.equal(await page.textContent("[data-slot=view-task-text]"), "Look up CANARY-8842 in the ledger");
	await sees("[data-slot=view-inspector] >> text=CANARY-8842 is on page 3", "the note about it, which came a moment later");
	assert.equal(await page.locator(`[data-slot=view-inspector][data-showing=board][data-id="${posted.board}"][data-task="${posted.id}"]`).count(), 1, "the board and the task the view named, by their numbers");
	// The view was told which task is shown, by two numbers, and of the task only names and numbers.
	const pointer = frame().locator("#pointer");
	await frame().locator("#pointer", { hasText: '"selected":{"board"' }).waitFor({ timeout: 10_000 });
	const out = JSON.parse((await pointer.textContent()) ?? "{}");
	assert.equal(out.leak, "clean", "what stands on the board does not reach the view");
	assert.deepEqual(out.selected, { board: posted.board, task: posted.id });
	assert.deepEqual(out.task, ["after", "by", "id", "notes", "outside", "posted", "since", "state"]);
	// Nothing opened for a board: there is no tab of one.
	assert.equal(await page.locator("[data-slot=view-task-text]").count(), 1);
	await call("POST", `/boards/${posted.board}/remove`);
});

test("without a view there is no button and no panel; choosing one brings both back", async () => {
	await call("POST", "/settings", { key: "ui.view", value: "off" });
	await page.waitForSelector("[data-toggle=view]", { state: "detached", timeout: 10_000 });
	await page.waitForSelector("[data-slot=view-aside]", { state: "detached", timeout: 5000 });
	await call("POST", "/settings", { key: "ui.view", value: "office" });
	await sees("[data-toggle=view]", "the button, back");
});

test("the workshop, pine's other view, is in the home too and runs in the same frame when it is chosen", async () => {
	assert.ok(fs.existsSync(path.join(home, "views", "workshop.ts")), "the workshop is in the views folder");
	await call("POST", "/settings", { key: "ui.view", value: "workshop" });
	await sees("[data-toggle=view]", "the view's button");
	if (!(await page.$("[data-slot=view-aside]"))) await menu("view");
	await sees("[data-slot=view-aside] [data-slot=view][data-view=workshop] [data-slot=view-frame][data-ready]", "the workshop, running in its frame");
	const main = frame().locator("[data-slot=workshop-words] > li[data-agent=main]");
	await main.waitFor({ state: "attached", timeout: 10_000 });
	assert.match((await main.textContent()) ?? "", /main[\s\S]*safe/, "the agent and its mode, as this home has them");
	await shoot("workshop");
	await call("POST", "/settings", { key: "ui.view", value: "office" });
});

test("the overview, pine's third view, runs in the same frame and says in words what its page shows", async () => {
	assert.ok(fs.existsSync(path.join(home, "views", "overview.ts")), "the overview is in the views folder");
	await call("POST", "/settings", { key: "ui.view", value: "overview" });
	await sees("[data-toggle=view]", "the view's button");
	if (!(await page.$("[data-slot=view-aside]"))) await menu("view");
	await sees("[data-slot=view-aside] [data-slot=view][data-view=overview] [data-slot=view-frame][data-ready]", "the overview, running in its frame");
	const main = frame().locator("[data-slot=overview-words] > li[data-agent=main]");
	await main.waitFor({ state: "attached", timeout: 10_000 });
	assert.match((await main.textContent()) ?? "", /main[\s\S]*safe/, "the agent and its mode, as this home has them");
	assert.match((await frame().locator("[data-slot=overview-words] > li[data-agent=books]").textContent()) ?? "", /books[\s\S]*bypass/);
	await shoot("overview");
	await call("POST", "/settings", { key: "ui.view", value: "office" });
});
