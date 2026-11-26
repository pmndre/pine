// "Setup Pine" with an API key: which provider (the most common ones, and "Another…", the pick
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
const card = "[data-slot=composer-question] [data-slot=question-card]";
const question = (text: string) => sees(`${card} [data-slot=question-card-question] >> text=${text}`);
const pick = (label: string) => page.locator(`${card} [role=option]`, { hasText: label }).click();
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
	await sees("[data-slot=dialog-title] >> text=/The browser for the web tools/");
	await page.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Not now" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await question("How should your agents run?");
});

after(async () => {
	await app?.close().catch(() => {});
	fs.rmSync(home, { recursive: true, force: true });
});

test("an API key: the most common providers, and Another… finds the others by search", async () => {
	await pick("An API key");
	await question("Which provider?");
	const options = await page.$$eval(`${card} [role=option] [data-slot=item-title]`, (els: Element[]) => els.map((e) => e.textContent));
	assert.deepEqual(options, ["Anthropic", "OpenAI", "Google Gemini", "OpenRouter", "xAI", "Another…"]);
	await pick("Another…");
	await sees("[data-slot=dialog-content] [data-slot=command-input]");
	// Found by what people call it, not by pi's name for it.
	await page.fill("[data-slot=dialog-content] [data-slot=command-input]", "kimi");
	const found = await page.$$eval("[data-slot=dialog-content] [data-slot=command-item]", (els: Element[]) => els.map((e) => e.textContent ?? ""));
	assert.match(found[0] ?? "", /kimi|moonshot/i, `Moonshot's providers come first: ${found.join(" | ")}`);
	assert.ok(found.some((t) => t.startsWith("Moonshot AI")), `Moonshot AI is found by "kimi": ${found.join(" | ")}`);
	await page.locator("[data-slot=dialog-content] [data-slot=command-item]", { hasText: /^Moonshot AI/ }).first().click();
	await sees("[data-slot=setup-api-key][data-provider^=moonshotai] input[type=password]");
	await page.locator("[data-slot=setup-api-key]").getByRole("button", { name: "Cancel" }).click();
	await question("How should your agents run?");
});

test("a key typed in the card reaches a model, and the conversation says only that it was saved", async () => {
	await pick("An API key");
	await question("Which provider?");
	await pick("Anthropic");
	const field = "[data-slot=setup-api-key][data-provider=anthropic] input[type=password]";
	await sees(field);
	await page.fill(field, KEY);
	await page.locator("[data-slot=setup-api-key]").getByRole("button", { name: "Save" }).click();
	await sees("[data-slot=setup-model] >> text=/Your agents run on anthropic\\//");
	await sees("[data-slot=message-scroller-content] [data-item=setup-answer] >> text=Key saved for Anthropic");
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
