// "Setup Pine" before any model answers: what the owner types in the composer is matched against the
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
const card = "[data-slot=composer-question] [data-slot=question-card]";
const question = (text: string) => sees(`${card} [data-slot=question-card-question] >> text=${text}`);
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
	await sees("[data-slot=dialog-title] >> text=/The browser for the web tools/");
	await page.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Not now" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await question("How should your agents run?");
});

after(async () => {
	await app?.close().catch(() => {});
	fs.rmSync(home, { recursive: true, force: true });
});

test("typing an option's label, in any case, picks it", async () => {
	await type("  a SUBSCRIPTION ");
	await question("Which subscription?");
	await sees("[data-slot=message-scroller-content] [data-item=setup-answer] >> text=A subscription");
	await type("claude");
	await sees("[data-slot=sign-in-card] [data-sign-in=code]");
	await sees("[data-slot=message-scroller-content] [data-item=setup-answer] >> text=Claude");
	assert.equal(await page.inputValue(composer), "", "the composer is emptied, as after any message");
	assert.equal(await prompts(), 0, "nothing went to the daemon");
	await page.locator("[data-slot=sign-in-card]").getByRole("button", { name: "Cancel" }).click();
	await question("How should your agents run?");
});

test("typing anything else shows pine's fixed line, keeps the card, and sends nothing to the daemon as a prompt", async () => {
	await type("What is a model?");
	await sees("[data-slot=message-scroller-content] [data-item=setup-typed] >> text=What is a model?");
	await sees("[data-slot=message-scroller-content] [data-slot=setup-no-model] >> text=/There is no model yet to answer that/");
	await question("How should your agents run?");
	assert.equal(await page.inputValue(composer), "");
	// Given time to reach the daemon if it were sent: it is not.
	await new Promise((r) => setTimeout(r, 300));
	assert.equal(await prompts(), 0, "no task was made for what was typed");
	const conversations = (await api("GET", "/agents/main/sessions")) as any;
	assert.doesNotMatch(JSON.stringify(conversations), /What is a model/);
});
