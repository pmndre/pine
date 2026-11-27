// "Onboarding" before any model answers: what the owner types in the composer is matched against the
// open card's option labels, whatever the case, and picks the one it names. Anything else gets one
// fixed line of pine's, and nothing goes to the daemon as a prompt: there is no model to answer it.
// The sign-in runs on the daemon's stand-in for a browser sign-in (`PINE_LOGIN_STAND_IN`, for tests only).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { launchApp, patient } from "./support/app.ts";

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-setup-typed-")));
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
/** What an option of the open card is called on screen: the test types it back, whatever it says. */
const label = async (option: string): Promise<string> => (await page.locator(`${card} [data-option="${option}"] [data-slot=question-card-label]`).textContent()) ?? "";
const answered = (text: string) => page.locator("[data-slot=message-scroller-content] [data-item=setup-answer]", { hasText: text }).first().waitFor({ timeout: patient(20_000) });
const composer = "[data-slot=composer] textarea";
const type = async (text: string) => {
	await page.fill(composer, text);
	await page.press(composer, "Enter");
};
const prompts = async () => ((await api("GET", "/tasks?agent=main&session=setup&limit=40")) as any[]).length;

before(async () => {
	// A home as `pine init` leaves it, without a model.
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { mode: "safe", introduce: false, thinking: "off" }, security: { askAccess: false } }, null, 2));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent: it administers pine.\n\nYou are the main agent.\n");
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	app = await launchApp({ ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"), PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "", PINE_LOGIN_STAND_IN: path.join(home, "browser-signed-in") });
	page = await app.firstWindow();
	await page.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
	await sees("[data-dialog=browser-ask]");
	await page.click("[data-dialog=browser-ask] [data-action=later]");
	await page.waitForSelector("[data-dialog=browser-ask]", { state: "detached" });
	await question("model");
});

after(async () => {
	await app?.close().catch(() => {});
	fs.rmSync(home, { recursive: true, force: true });
});

test("typing an option's label, in any case, picks it", async () => {
	// The label as the card shows it, typed back in another case and with spaces around it.
	const subscription = await label("subscription");
	assert.ok(subscription.trim(), "the option has a label to type");
	await type(`  ${subscription.toUpperCase()} `);
	await question("subscription");
	await answered(subscription);
	const claude = await label("anthropic");
	await type(claude.toLowerCase());
	await sees("[data-card=sign-in-card] [data-sign-in=code]");
	await answered(claude);
	assert.equal(await page.inputValue(composer), "", "the composer is emptied, as after any message");
	assert.equal(await prompts(), 0, "nothing went to the daemon");
	await page.click("[data-card=sign-in-card] [data-action=cancel]");
	await question("model");
});

test("typing anything else shows pine's fixed line, keeps the card, and sends nothing to the daemon as a prompt", async () => {
	await type("What is a model?");
	await sees("[data-slot=message-scroller-content] [data-item=setup-typed] >> text=What is a model?");
	await sees("[data-slot=message-scroller-content] [data-slot=setup-no-model]");
	await question("model");
	assert.equal(await page.inputValue(composer), "");
	// Given time to reach the daemon if it were sent: it is not.
	await new Promise((r) => setTimeout(r, 300));
	assert.equal(await prompts(), 0, "no task was made for what was typed");
	const conversations = (await api("GET", "/agents/main/sessions")) as any;
	assert.doesNotMatch(JSON.stringify(conversations), /What is a model/);
});

test("while no model answers, the composer says that what is typed picks an option", async () => {
	await question("model");
	// What is typed goes to the card, not to an agent: the composer knows, and says something of its own about it.
	await sees(`${composer}[data-above=typed]`);
	assert.ok(((await page.getAttribute(composer, "placeholder")) ?? "").trim(), "the composer says what typing does here");
});

test("while the key's field is open, what is typed in the composer is neither shown nor kept, and pine says to paste it in the field", async () => {
	const typed = "sk-typed-in-the-wrong-place";
	await type(await label("api-key"));
	await question("provider");
	await type(await label("anthropic"));
	await sees("[data-card=setup-api-key][data-provider=anthropic] input[type=password]");
	await sees(`${composer}[data-above=secret]`, patient(5000));
	await type(typed);
	// pine says so: a warning, in which the key is not repeated.
	await sees("[data-slot=toast][data-type=warning]");
	assert.equal(await page.inputValue(composer), "");
	const shown = await page.evaluate(() => document.body.innerText + [...document.querySelectorAll("input, textarea")].map((e) => (e as HTMLInputElement).value).join("\n"));
	assert.ok(!shown.includes(typed), "not shown anywhere in the window");
	// Not kept for the arrows: the earlier inputs come back, and this one is not among them.
	await page.click(composer);
	for (let i = 0; i < 4; i++) {
		await page.press(composer, "ArrowUp");
		assert.notEqual(await page.inputValue(composer), typed);
	}
	await page.fill(composer, "");
	assert.equal(await prompts(), 0, "nothing went to the daemon");
	await page.click("[data-card=setup-api-key] [data-action=cancel]");
	await question("model");
});
