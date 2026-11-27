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
const question = (text: string) => sees(`${card} [data-slot=questionnaire-title] >> text=${text}`);
/** Picks the option whose label is exactly `label` ("mock/m" is in "mock/m2" too), then sends it: a pick alone only selects. */
const pick = async (label: string) => {
	await page.locator(`${card} [data-slot=questionnaire-choice]`).filter({ has: page.locator("[data-slot=question-card-label]").getByText(label, { exact: true }) }).click();
	await page.locator(card).getByRole("button", { name: "Send" }).click();
};
const options = () => page.$$eval(`${card} [data-slot=questionnaire-choice] [data-slot=question-card-label]`, (els: Element[]) => els.map((e) => e.textContent));
const activeTab = () => page.$$eval("[data-slot=tab][aria-selected=true]", (els: Element[]) => els[0]?.textContent ?? "");
const visit = () =>
	app.evaluate(({ BrowserWindow }: any) => {
		const p = BrowserWindow.getAllWindows()[0].webContents;
		p.send("pine:focus", true);
		p.send("pine:focus", false);
	});

/** The question about the browser for the web tools, which comes again with a page loaded anew: put off, it lies over nothing. */
async function notNow(wait = 5000): Promise<void> {
	const asked = await page.waitForSelector("[data-slot=dialog-title] >> text=/The browser for the web tools/", { timeout: patient(wait) }).then(() => true, () => false);
	if (!asked) return;
	await page.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Not now" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
}

const settingsModel = () => JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).defaults?.model;
const DEFAULT = "Which default model should your agents run on?";
const GO_ON = /^My agents have a model now\. I am new to pine/;

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
	await sees("[data-slot=sidebar] >> text=Onboarding");
	await page.locator("[data-sidebar=menu-button]", { hasText: "Onboarding" }).click();
	await question(DEFAULT);
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
	await question("How should your agents run?");
	// The owner adds a model server of their own (the scripted one, with three models), and pine runs on one of them.
	const model = (id: string) => ({ id, name: id, contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [model("m"), model("m2"), model("m3")] } } }));
	await api("POST", "/models/refresh", {});
	await visit();
	await sees("[data-slot=setup-model] >> text=/mock\\//");
	pines = String(await page.textContent("[data-slot=setup-model] b")).trim();
	await question(DEFAULT);
	const offered = await options();
	assert.equal(offered[0], pines, "pine's choice comes first");
	assert.deepEqual([...offered.slice(1, -1)].sort(), ["mock/m", "mock/m2", "mock/m3"].filter((m) => m !== pines).sort());
	assert.equal(offered.at(-1), "Another…");
	assert.match(String(await page.textContent(card)), /pine's choice\. Keep it and go on\./);
	await shot("setup-default-01-card");
});

test("Another… opens the search of every model; closed, the card stays and nothing is said", async () => {
	await pick("Another…");
	await sees("[data-slot=command-input]");
	await page.keyboard.press("Escape");
	await question(DEFAULT);
	assert.deepEqual(await api("GET", "/tasks?agent=main&session=setup&limit=40"), []);
});

test("keeping pine's choice changes no setting, posts the owner's message in setup, and the main agent answers there", async () => {
	const before = settingsModel();
	await pick(pines);
	const task = (await answered()).find((t) => t.status === "done");
	assert.match(task.prompt, GO_ON);
	assert.equal(task.meta.trust, "owner");
	assert.equal(settingsModel(), before);
	assert.match(String(await activeTab()), /Onboarding/);
	await page.waitForSelector(card, { state: "detached" });
	await shot("setup-default-02-sent");
	// Done for good: after a reload, no card, and the answer stays as a trace.
	await page.reload();
	await notNow();
	await sees("[data-slot=sidebar] >> text=Onboarding");
	await page.locator("[data-sidebar=menu-button]", { hasText: "Onboarding" }).click();
	await sees("[data-slot=message-scroller-content] >> text=/My agents have a model now/");
	assert.equal(await page.$(card), null, "no card once the setup went on");
	await sees(`[data-slot=message-scroller-content] [data-item=setup-answer] >> text=${DEFAULT}`);
});

test("another model of the list becomes the default, and the message is posted all the same", async () => {
	await fresh();
	const other = (await options()).find((o: string) => o !== pines && o !== "Another…");
	await pick(other);
	await answered();
	assert.equal(settingsModel(), other);
	await sees(`[data-slot=message-scroller-content] [data-item=setup-answer] >> text=${other}`);
});
