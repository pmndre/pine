// An agent's own color, as the owner picks it on the agent's avatar (its settings page, the side bar's
// menu): the real app on a home of its own. What is checked is what the agent's file keeps and the color each of its
// avatars is handed (the `--agent` value the avatar sets on itself), never a class and never a computed color: how a
// theme draws it is the design's. The color is the avatar's alone: nothing else in the window is handed it.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { startMock } from "../../baseline/tests/mock.mjs";
import { browserPlaces } from "../../src/browser-build.ts";
import { launchApp, patient } from "./support/app.ts";

let app: any;
let page: any;
let mock: any;
let home: string;
const agentFile = () => path.join(home, "agents", "books", "agent.json");

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};
/** The color each avatar of the agent books is handed, wherever it is in the window (the swatches of the color popover aside): "" for one without a color. */
const avatars = (): Promise<string[]> =>
	page.$$eval("[data-slot=avatar][data-agent=books] [data-slot=avatar-fallback]", (els: HTMLElement[]) => els.filter((e) => !e.closest("[data-slot=agent-color]")).map((e) => e.style.getPropertyValue("--agent").trim().toLowerCase()));
/** Waits until every avatar of books has that color ("" for none), and says what they have instead when it does not come. */
async function avatarsAre(want: string, why: string): Promise<void> {
	for (const end = Date.now() + patient(5000); Date.now() < end; ) {
		const now = await avatars();
		if (now.length && now.every((c) => c === want)) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	assert.deepEqual(await avatars(), [want], why);
}

const menu = (name: string) => app.evaluate(({ BrowserWindow }: any, n: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", n), name);

/** The color in the agent's file; none while the daemon is writing the file, when a reader can find it empty. */
const kept = (): string | undefined => {
	try {
		return JSON.parse(fs.readFileSync(agentFile(), "utf8")).color;
	} catch {
		return undefined;
	}
};
/** Waits until the agent's file keeps that color (none: undefined): a pick is saved at once, with no button to press. */
async function keeps(want: string | undefined, why: string): Promise<void> {
	for (const end = Date.now() + patient(5000); Date.now() < end && kept() !== want; ) await new Promise((r) => setTimeout(r, 30));
	assert.equal(kept(), want, why);
}

/** The color of books, opened on its avatar at the top of its settings page. */
async function colorOnPage(): Promise<any> {
	await menu("settings:agents");
	await page.locator("[data-slot=settings-page] [data-slot=item]", { hasText: "Keeps the books" }).click();
	await page.locator("[data-slot=settings-page] [data-action=agent-color]").click();
	await page.waitForSelector("[data-slot=agent-color][data-open]");
	return page.locator("[data-slot=agent-color][data-open]");
}

before(async () => {
	mock = await startMock({});
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-agent-color-")));
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe", introduce: false }, security: { askAccess: false } }));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n\nYou are the main agent.\n");
	write(agentFile(), JSON.stringify({}));
	write(path.join(home, "agents", "books", "workspace", "AGENTS.md"), "Keeps the books.\n\nYou keep the books.\n");
	// The browser of the web tools counts as there, so that the app's question about it lies over nothing here (app.test.ts tests it).
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	for (const place of (await browserPlaces()) ?? []) write(path.join(home, "browsers", path.basename(place), "INSTALLATION_COMPLETE"), "");
	write(path.join(home, "desktop-data", "prefs.json"), JSON.stringify({ updates: false }));
	app = await launchApp({ ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"), PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "" });
	page = await app.firstWindow();
	await page.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
	await page.waitForSelector("[data-slot=tab][data-active]", { timeout: patient(30_000) });
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	if (home) fs.rmSync(home, { recursive: true, force: true });
});

test("an agent without a color has the stock avatar: no color of its own", async () => {
	// The side bar shows one agent: books, picked in its switcher, whose conversation comes to the front.
	await page.click("[data-slot=sidebar] [data-slot=agent-switcher]");
	await page.click("[data-slot=dropdown-menu-content] [data-slot=agent-option][data-agent=books]");
	await page.waitForSelector("[data-slot=sidebar] [data-slot=agent-switcher][data-agent=books]");
	await avatarsAre("", "no color, the stock avatar");
});

test("a preset color picked on the agent's avatar is kept in its agent.json at once and is every avatar's of that agent, whatever the theme", async () => {
	const color = await colorOnPage();
	await color.locator('[data-color="#e0805a"]').click();
	await keeps("#e0805a", "the preset, without a button to save it");
	await page.keyboard.press("Escape");
	await avatarsAre("#e0805a", "the side bar's avatar and the page's");
	// The same in a light theme: an agent is known by its color whatever the theme.
	await page.evaluate(() => (window as any).pine.call("POST", "/settings", { key: "ui.theme", value: "github-light" }));
	await page.waitForFunction(() => document.documentElement.dataset.theme === "github-light");
	await avatarsAre("#e0805a", "the side bar's avatar, in a light theme");
	await page.evaluate(() => (window as any).pine.call("POST", "/settings", { key: "ui.theme", value: "default" }));
	await page.waitForFunction(() => document.documentElement.dataset.theme === "pmndre");

	// Its conversation: the tab and the empty conversation carry it too.
	await page.locator("[data-slot=settings-page] [data-action=open-conversation]").click();
	await page.waitForSelector("[data-slot=empty] [data-slot=avatar][data-agent=books]");
	assert.ok((await avatars()).length >= 3, "the side bar, the tab and the empty conversation");
	await avatarsAre("#e0805a", "every avatar of books");
	// The color is the avatar's and nothing else's: with books in front, no other part of the window is handed it,
	// and no other agent's avatar has one.
	const elsewhere = await page.$$eval("[style*='--agent']", (els: Element[]) => els.filter((e) => !e.matches("[data-slot=avatar][data-agent=books] [data-slot=avatar-fallback]") && !e.closest("[data-slot=agent-color]")).length);
	assert.equal(elsewhere, 0, "only the avatars of books carry its color");
});

test("any other color can be set, and none takes it away again", async () => {
	const color = await colorOnPage();
	await page.fill("[data-slot=agent-color][data-open] input[type=color]", "#3366cc");
	await keeps("#3366cc", "the color set in the color field");
	await avatarsAre("#3366cc", "the color set in the color field");
	await color.locator("[data-color=none]").click();
	await keeps(undefined, "no color leaves none in the file");
	await page.keyboard.press("Escape");
	await avatarsAre("", "back to the stock avatar");
});

test("Color in the side bar's switcher opens the same colors over the agent's avatar there", async () => {
	await page.waitForSelector("[data-slot=sidebar] [data-slot=agent-switcher][data-agent=books]");
	await page.click("[data-slot=sidebar] [data-slot=agent-switcher]");
	await page.click("[data-slot=dropdown-menu-content] [data-agent-action=color]");
	await page.locator('[data-slot=agent-color][data-open] [data-color="#4caf50"]').click();
	await keeps("#4caf50", "the preset, picked from the side bar");
	await page.keyboard.press("Escape");
	await avatarsAre("#4caf50", "every avatar of books");
});
