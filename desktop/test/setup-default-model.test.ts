// "Onboarding" once a model answers: the card of the default model (`defaults.model`), pine's choice first,
// a few others of the same provider, then "Another…". Any answer posts one fixed message of the owner's in
// `setup` (`GO_ON`), which the main agent answers there with its own questions. The home starts without a
// model, and gets the scripted model server as a model server of its own on the way, as an owner adds one.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { startMock } from "../../baseline/tests/mock.mjs";
import { launchApp, patient } from "./support/app.ts";

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-setup-default-")));
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
/** Picks an option by what it is (`data-option`: a model's id, or `another`), then sends it: a pick alone only selects. */
const pick = async (option: string) => {
	await page.click(`${card} [data-slot=questionnaire-choice][data-option="${option}"]`);
	await page.click(`${card} [data-action=send]`);
};
const options = (): Promise<string[]> => page.$$eval(`${card} [data-slot=questionnaire-choice]`, (els: Element[]) => els.map((e) => e.getAttribute("data-option") ?? ""));
/** The conversation of the tab in front, as "agent:session". */
const activeTab = () => page.$$eval("[data-slot=tab][aria-selected=true]", (els: Element[]) => `${els[0]?.getAttribute("data-agent")}:${els[0]?.getAttribute("data-session")}`);
/** The line of onboarding in the side bar: the main agent's conversation `setup`. */
const SETUP_ROW = "[data-slot=sidebar] [data-agent=main][data-session=setup]";
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

const settingsModel = () => JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).defaults?.model;

/** The tasks of `setup` once one is done: the main agent answered there. */
async function answered(): Promise<any[]> {
	for (let i = 0; i < 100; i++) {
		const history = (await api("GET", "/tasks?agent=main&session=setup&limit=40")) as any[];
		if (history.some((t) => t.status === "done")) return history;
		await new Promise((r) => setTimeout(r, 100));
	}
	assert.fail("the main agent did not answer in setup");
}

/** Onboarding as it was before anything was said in it: the conversation reset, the page loaded anew. */
async function fresh(): Promise<void> {
	await api("POST", "/agents/main/reset", { session: "setup" });
	await page.reload();
	await notNow();
	await sees(SETUP_ROW);
	await page.click(SETUP_ROW);
	await question("default");
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

let pines = "";

test("once a model answers, the card asks for the default model: pine's choice first, others of its provider, then Another…", async () => {
	await notNow(20_000);
	await question("model");
	// The owner adds a model server of their own (the scripted one, with three models), and pine runs on one of them.
	const model = (id: string) => ({ id, name: id, contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [model("m"), model("m2"), model("m3")] } } }));
	await api("POST", "/models/refresh", {});
	await visit();
	await sees('[data-slot=setup-model][data-model^="mock/"]');
	pines = String(await page.getAttribute("[data-slot=setup-model]", "data-model"));
	await question("default");
	const offered = await options();
	assert.equal(offered[0], pines, "pine's choice comes first");
	assert.deepEqual([...offered.slice(1, -1)].sort(), ["mock/m", "mock/m2", "mock/m3"].filter((m) => m !== pines).sort());
	assert.equal(offered.at(-1), "another");
	// pine's choice is the one marked as such, and no other.
	assert.deepEqual(await page.$$eval(`${card} [data-slot=questionnaire-choice][data-recommended]`, (els: Element[]) => els.map((e) => e.getAttribute("data-option"))), [pines]);
	await shot("setup-default-01-card");
});

test("Another… opens the search of every model; closed, the card stays and nothing is said", async () => {
	await pick("another");
	await sees("[data-slot=command-input]");
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=command-input]", { state: "detached" });
	await question("default");
	assert.deepEqual(await api("GET", "/tasks?agent=main&session=setup&limit=40"), []);
});

test("keeping pine's choice changes no setting, posts the owner's message in setup, and the main agent answers there", async () => {
	const before = settingsModel();
	await pick(pines);
	const task = (await answered()).find((t) => t.status === "done");
	// One message of the owner's, whatever it says: what it says is the writer's to change.
	assert.ok(String(task.prompt).trim(), "the owner's message is not empty");
	assert.equal(task.meta.trust, "owner");
	assert.equal(settingsModel(), before);
	assert.equal(await activeTab(), "main:setup");
	await page.waitForSelector(card, { state: "detached" });
	await shot("setup-default-02-sent");
	// Done for good: after a reload, no card, and the answer stays as a trace.
	await page.reload();
	await notNow();
	await sees(SETUP_ROW);
	await page.click(SETUP_ROW);
	// The message that was posted is in the conversation, by its own first words as the daemon has them.
	await page.locator("[data-slot=message-scroller-content] [data-item=user]", { hasText: String(task.prompt).trim().split("\n")[0].slice(0, 40) }).first().waitFor({ timeout: patient(20_000) });
	assert.equal(await page.locator(card).count(), 0, "no card once the setup went on");
	// The answer stays as a trace: it names the model that was kept.
	await sees(`[data-slot=message-scroller-content] [data-item=setup-answer] >> text=${pines}`);
});

test("another model of the list becomes the default, and the message is posted all the same", async () => {
	await fresh();
	const other = (await options()).find((o: string) => o !== pines && o !== "another")!;
	await pick(other);
	await answered();
	assert.equal(settingsModel(), other);
	await sees(`[data-slot=message-scroller-content] [data-item=setup-answer] >> text=${other}`);
});
