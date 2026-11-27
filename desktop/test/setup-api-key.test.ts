// "Onboarding" with an API key: which provider (the most common ones, and "Another…", the pick
// dialog with its search), then a card with a secret field of its own, whose key goes straight to
// pi's sign-in for that provider. The conversation says only that a key was saved: the key is in
// nothing the window shows and in nothing of the conversation's history, only in auth.json.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { launchApp, patient } from "./support/app.ts";

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-setup-key-")));
const KEY = "sk-ant-api03-SETUP-KEY-not-real-0123456789abcdef";
let app: any;
let page: any;

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};
const sees = (selector: string, timeout = patient(20_000)) => page.waitForSelector(selector, { timeout });
const api = (method: string, url: string, body?: unknown) => page.evaluate(([m, u, b]: [string, string, unknown]) => (window as any).pine.call(m, u, b).then((r: any) => r.data), [method, url, body]);
const card = "[data-slot=composer-question] [data-slot=questionnaire]";
/** The card that is open, by what it asks (`data-question`), never by its words. */
const question = (id: string) => sees(`${card}[data-question=${id}]`);
/** Picks an option, then sends it: a pick alone only selects. */
const pick = async (option: string) => {
	await page.click(`${card} [data-slot=questionnaire-choice][data-option="${option}"]`);
	await page.click(`${card} [data-action=send]`);
};
const offered = () => page.$$eval(`${card} [data-slot=questionnaire-choice]`, (els: Element[]) => els.map((e) => e.getAttribute("data-option")));
/** What an option of the open card is called on screen, whatever it says: looked for again where the answer folds. */
const label = async (option: string): Promise<string> => (await page.locator(`${card} [data-option="${option}"] [data-slot=question-card-label]`).textContent()) ?? "";
const answers = "[data-slot=message-scroller-content] [data-item=setup-answer]";
const model = (prefix: string) => sees(`[data-slot=setup-model][data-model^="${prefix}"]`);
/** The labels the test picked on the way, kept for the test after the reload. */
const said: Record<string, string> = {};
/** Every file under a folder whose bytes hold the text. */
const holding = (dir: string, text: string): string[] => {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name)).filter((f) => fs.readFileSync(f).includes(text));
};

before(async () => {
	// A home as `pine init` leaves it, without a model.
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { mode: "safe", introduce: false, thinking: "off" }, security: { askAccess: false } }, null, 2));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent: it administers pine.\n\nYou are the main agent.\n");
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	app = await launchApp({ ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"), PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "" });
	page = await app.firstWindow();
	await page.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
	await sees("[data-dialog=browser-ask]");
	await page.click("[data-dialog=browser-ask] [data-action=later]");
	await page.waitForSelector("[data-dialog=browser-ask]", { state: "detached" });
	await question("model");
	said.subscription = await label("subscription");
	said.key = await label("api-key");
});

after(async () => {
	await app?.close().catch(() => {});
	fs.rmSync(home, { recursive: true, force: true });
});

test("an API key: the most common providers, and Another… finds the others by search", async () => {
	await pick("api-key");
	await question("provider");
	// The common providers by pi's ids for them, then the way to all the others, last.
	const options = await offered();
	assert.equal(options.at(-1), "another");
	for (const id of ["anthropic", "openai"]) assert.ok(options.includes(id), `${id} is offered at once: ${options.join(", ")}`);
	await pick("another");
	await sees("[data-slot=dialog-content] [data-slot=command-input]");
	// Found by what people call it ("kimi"), not by pi's name for it: Moonshot's providers come first.
	await page.fill("[data-slot=dialog-content] [data-slot=command-input]", "kimi");
	await sees("[data-slot=dialog-content] [data-slot=command-item][data-value^=moonshotai]");
	const found = await page.$$eval("[data-slot=dialog-content] [data-slot=command-item]", (els: Element[]) => els.map((e) => e.getAttribute("data-value") ?? ""));
	assert.match(found[0] ?? "", /^(moonshotai|kimi)/, `Moonshot's providers come first: ${found.join(" | ")}`);
	await page.click("[data-slot=dialog-content] [data-slot=command-item][data-value^=moonshotai]");
	await sees("[data-card=setup-api-key][data-provider^=moonshotai] input[type=password]");
	await page.click("[data-card=setup-api-key] [data-action=cancel]");
	await question("model");
});

test("a key typed in the card reaches a model, and the conversation says only that it was saved", async () => {
	await pick("api-key");
	await question("provider");
	await pick("anthropic");
	const field = "[data-card=setup-api-key][data-provider=anthropic] input[type=password]";
	await sees(field);
	await page.fill(field, KEY);
	await page.click("[data-card=setup-api-key] [data-slot=questionnaire-submit]");
	await model("anthropic/");
	// Folded into lines above: the way (a key), the provider, and that the key was saved.
	await page.waitForFunction((sel: string) => document.querySelectorAll(sel).length === 3, answers, { timeout: patient(20_000) });
	const main = ((await api("GET", "/agents")) as any[]).find((a) => a.main);
	assert.match(main.model, /^anthropic\//);
	assert.equal(main.modelProblem, undefined);
	// Nowhere in the window, nor in any field of it.
	const shown = await page.evaluate(() => document.body.innerText + [...document.querySelectorAll("input, textarea")].map((e) => (e as HTMLInputElement).value).join("\n"));
	assert.ok(!shown.includes(KEY), "the key is not shown in the window");
	assert.ok(!shown.includes("SETUP-KEY"), "nor any part of it");
	// Nothing of the conversation's history: no task, no session file, nothing in pine's database or log.
	assert.deepEqual(await api("GET", "/tasks?agent=main&session=setup&limit=40"), []);
	assert.deepEqual(holding(path.join(home, "agents"), KEY), []);
	assert.deepEqual(holding(path.join(home, "data"), KEY), []);
	assert.deepEqual(holding(path.join(home, "desktop-data"), KEY), []);
	// Where it went: pi's credentials in pine's home.
	assert.ok(fs.readFileSync(path.join(home, "auth.json"), "utf8").includes(KEY), "the key is stored in auth.json");
});

test("after a reload, a key folds as the API key it is, not as a subscription of the same provider", async () => {
	await page.reload();
	await model("anthropic/");
	// The same three lines as before the reload, the way among them by the label the first card gave it.
	await page.locator(answers, { hasText: said.key }).first().waitFor({ timeout: patient(20_000) });
	const lines = await page.$$eval(answers, (els: Element[]) => els.map((e) => e.textContent ?? ""));
	assert.equal(lines.length, 3, `the way, the provider and the saved key: ${lines.join(" | ")}`);
	assert.ok(!lines.some((l) => l.includes(said.subscription)), `no subscription is said: ${lines.join(" | ")}`);
	const anthropic = ((await api("GET", "/models/providers")) as any[]).find((p) => p.id === "anthropic");
	assert.equal(anthropic.via, "api_key");
});
