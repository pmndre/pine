// "Setup Pine" once a model answers: the card "Next", where the owner ticks what to set up now. Its
// Send posts an ordinary message of the owner's in `setup`, fixed text made from the ticks, which the
// main agent answers there; "Nothing for now" opens `main`. The home starts without a model, and gets
// the scripted model server as a model server of its own on the way, as an owner adds one.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { startMock } from "../../baseline/tests/mock.mjs";
import { launchApp, patient } from "./support/app.ts";

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-setup-next-")));
let app: any;
let page: any;
let mock: any;

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};
const sees = (selector: string, timeout = patient(20_000)) => page.waitForSelector(selector, { timeout });
const api = (method: string, url: string, body?: unknown) => page.evaluate(([m, u, b]: [string, string, unknown]) => (window as any).pine.call(m, u, b).then((r: any) => r.data), [method, url, body]);
const shot = async (name: string) => {
	if (!process.env.PINE_DESKTOP_SHOTS) return;
	fs.mkdirSync(process.env.PINE_DESKTOP_SHOTS, { recursive: true });
	await page.screenshot({ path: path.join(process.env.PINE_DESKTOP_SHOTS, `${name}.png`) });
};
const card = "[data-slot=composer-question] [data-slot=questionnaire]";
/** The card that is open, by what it asks (`data-question`), never by its words. */
const question = (id: string) => sees(`${card}[data-question=${id}]`);
const pick = (option: string) => page.click(`${card} [data-slot=questionnaire-choice][data-option="${option}"]`);
const options = () => page.$$eval(`${card} [data-slot=questionnaire-choice]`, (els: Element[]) => els.map((e) => e.getAttribute("data-option")));
const answers = "[data-slot=message-scroller-content] [data-item=setup-answer]";
const model = (prefix: string) => sees(`[data-slot=setup-model][data-model^="${prefix}"]`);
/** The conversation of the tab in front, as "agent:session". */
const activeTab = () => page.$$eval("[data-slot=tab][aria-selected=true]", (els: Element[]) => `${els[0]?.getAttribute("data-agent")}:${els[0]?.getAttribute("data-session")}`);
const visit = () =>
	app.evaluate(({ BrowserWindow }: any) => {
		const p = BrowserWindow.getAllWindows()[0].webContents;
		p.send("pine:focus", true);
		p.send("pine:focus", false);
	});

/** The question about the browser for the web tools, which comes again with a page loaded anew: put off, it lies over nothing. */
async function notNow(wait = 5000): Promise<void> {
	const asked = await page.waitForSelector("[data-dialog=browser-ask]", { timeout: patient(wait) }).then(() => true, () => false);
	if (!asked) return;
	await page.click("[data-dialog=browser-ask] [data-action=later]");
	await page.waitForSelector("[data-dialog=browser-ask]", { state: "detached" });
}

/** The line of "Setup Pine" in the side bar: the main agent's conversation `setup`. */
const SETUP_ROW = "[data-slot=sidebar] [data-agent=main][data-session=setup]";

/** Back to "Setup Pine" after a reload: the model is kept again, and the card "Next" is open. */
async function toNext(): Promise<void> {
	await page.reload();
	await notNow();
	await sees(SETUP_ROW);
	await page.click(SETUP_ROW);
	await question("keep");
	await pick("go-on");
	await question("next");
}

before(async () => {
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { mode: "safe", introduce: false, thinking: "off" }, security: { askAccess: false } }, null, 2));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent: it administers pine.\n\nYou are the main agent.\n");
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	app = await launchApp({ ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"), PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "" });
	page = await app.firstWindow();
	await page.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.();
	fs.rmSync(home, { recursive: true, force: true });
});

test("once a model answers and is kept, the card Next offers what to set up, Pinecone on a Mac only", async () => {
	await notNow(20_000);
	await question("model");
	// The owner adds a model server of their own (the scripted one), and pine runs on it.
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	await api("POST", "/models/refresh", {});
	await visit();
	await model("mock/m");
	await question("keep");
	await pick("go-on");
	await question("next");
	assert.equal(await page.getAttribute(`${card} [data-slot=questionnaire-item]`, "data-multiple"), "", "several may be ticked");
	const offered = await options();
	const everywhere = ["mode", "folder", "telegram", "agent", "theme"];
	assert.deepEqual(offered, process.platform === "darwin" ? [...everywhere, "pinecone"] : everywhere);
	await shot("setup-next-01-card");
});

test("Nothing for now opens main", async () => {
	await page.click(`${card} [data-action=nothing]`);
	await sees("[data-slot=tab][aria-selected=true][data-agent=main][data-session=main]");
	assert.equal(await activeTab(), "main:main");
	// Nothing was said in `setup`.
	assert.deepEqual(await api("GET", "/tasks?agent=main&session=setup&limit=40"), []);
});

test("ticking and sending posts the owner's message in setup, the main agent answers there, and Next is done", async () => {
	await toNext();
	await pick("mode");
	await pick("agent");
	await page.click(`${card} [data-slot=questionnaire-submit]`);
	let history: any[] = [];
	for (let i = 0; i < 100; i++) {
		history = (await api("GET", "/tasks?agent=main&session=setup&limit=40")) as any[];
		if (history.some((t) => t.status === "done")) break;
		await new Promise((r) => setTimeout(r, 100));
	}
	const task = history.find((t) => t.status === "done");
	assert.ok(task, `the main agent answered in setup: ${JSON.stringify(history)}`);
	// The owner's message is made from the ticks: a line for each of the two things ticked, and none for the rest.
	const lines = String(task.prompt).split("\n").filter((l) => l.startsWith("- "));
	assert.equal(lines.length, 2, task.prompt);
	assert.notEqual(lines[0], lines[1]);
	assert.equal(task.meta.trust, "owner");
	// It is in the conversation as the owner's own message, and the conversation stays in front.
	await page.locator("[data-slot=message-scroller-content]", { hasText: lines[0].slice(2) }).first().waitFor({ timeout: patient(20_000) });
	assert.equal(await activeTab(), "main:setup");
	await page.waitForSelector(card, { state: "detached" });
	await shot("setup-next-02-sent");
	// Done for good: after a reload, the steps end with the model, kept, and no card at all: "Keep this
	// model?" is not asked again once the setup went on from it.
	await page.reload();
	await notNow();
	await sees(SETUP_ROW);
	await page.click(SETUP_ROW);
	await page.locator("[data-slot=message-scroller-content]", { hasText: lines[0].slice(2) }).first().waitFor({ timeout: patient(20_000) });
	await sees("[data-slot=setup-model]");
	assert.equal(await page.$(card), null, "no card once the setup went on");
	// The model was kept: that folds into a line of its own, after the one that says how the model came.
	await sees(`${answers} >> nth=1`);
});
