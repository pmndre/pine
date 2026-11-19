// An agent's own color, as the owner picks it on the agent's avatar (its settings page, the side bar's
// menu): the real app on a home of its own. What is checked is what the window draws (the computed color of the agent's avatar) and
// what the agent's file keeps, never a class. The color is the avatar's alone: the rest of the window keeps the theme's.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { startMock } from "../../baseline/tests/mock.mjs";
import { launchApp } from "./support/app.ts";

let app: any;
let page: any;
let mock: any;
let home: string;
const agentFile = () => path.join(home, "agents", "books", "agent.json");

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
/** What the avatar of an agent with that color should be: the color itself, in every theme. */
const drawnIn = (color: string) => rgb(color);
/** The color a CSS color value resolves to in the page. */
const resolved = (value: string): Promise<string> =>
	page.evaluate((v: string) => {
		const probe = document.body.appendChild(document.createElement("div"));
		probe.style.backgroundColor = v;
		const color = getComputedStyle(probe).backgroundColor;
		probe.remove();
		return color;
	}, value);
/** The background each avatar of the agent books is drawn with, wherever it is in the window (the swatches of the color popover aside). */
const avatars = (): Promise<string[]> =>
	page.$$eval("[data-slot=avatar][data-agent=books] [data-slot=avatar-fallback]", (els: Element[]) => els.filter((e) => !e.closest("[data-slot=agent-color]")).map((e) => getComputedStyle(e).backgroundColor));
/** Waits until every avatar of books is drawn in that color, and says what they are instead when it does not come. */
async function avatarsAre(want: string, why: string): Promise<void> {
	for (let i = 0; i < 100; i++) {
		const now = await avatars();
		if (now.length && now.every((c) => c === want)) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	assert.deepEqual(await avatars(), [want], why);
}

const menu = (name: string) => app.evaluate(({ BrowserWindow }: any, n: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", n), name);

const kept = (): string | undefined => JSON.parse(fs.readFileSync(agentFile(), "utf8")).color;
/** Waits until the agent's file keeps that color (none: undefined): a pick is saved at once, with no button to press. */
async function keeps(want: string | undefined, why: string): Promise<void> {
	for (let i = 0; i < 100 && kept() !== want; i++) await new Promise((r) => setTimeout(r, 30));
	assert.equal(kept(), want, why);
}

/** The color of books, opened on its avatar at the top of its settings page. */
async function colorOnPage(): Promise<any> {
	await menu("settings");
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=Agents");
	await page.locator("[data-slot=settings-page] [data-slot=item]", { hasText: "Keeps the books" }).click();
	await page.getByRole("button", { name: "Color of books" }).click();
	await page.waitForSelector("[data-slot=agent-color][data-open]");
	return page.locator("[data-slot=agent-color][data-open]");
}

before(async () => {
	mock = await startMock({});
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-agent-color-")));
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false } }));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n\nYou are the main agent.\n");
	write(agentFile(), JSON.stringify({}));
	write(path.join(home, "agents", "books", "workspace", "AGENTS.md"), "Keeps the books.\n\nYou keep the books.\n");
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	write(path.join(home, "desktop-data", "prefs.json"), JSON.stringify({ updates: false }));
	app = await launchApp({ ...process.env, PINE_DESKTOP_BACKGROUND: "1", PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"), PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "" });
	page = await app.firstWindow();
	await page.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
	await page.waitForSelector("[data-slot=empty] h1", { timeout: 30_000 });
	const dialog = await page.waitForSelector("[data-slot=dialog-footer] button >> text=Not now", { timeout: 3000 }).catch(() => undefined);
	if (dialog) await dialog.click();
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	if (home) fs.rmSync(home, { recursive: true, force: true });
});

test("an agent without a color has the avatar every agent had: muted", async () => {
	await avatarsAre(await resolved("var(--muted)"), "no color, the stock avatar");
});

test("a preset color picked on the agent's avatar is kept in its agent.json at once and draws its avatar, in a dark theme and a light one", async () => {
	const color = await colorOnPage();
	assert.equal(await page.getByText("What it is for").count(), 0, "the page has no field for what it is for, and none for its color");
	await color.getByRole("button", { name: "Coral", exact: true }).click();
	await keeps("#e0805a", "Coral, without Save changes");
	await page.keyboard.press("Escape");
	await avatarsAre(drawnIn("#e0805a"), "the side bar's avatar and the page's, in pmndre");
	// The same in a light theme: an agent is known by its color whatever the theme.
	await page.evaluate(() => (window as any).pine.call("POST", "/settings", { key: "ui.theme", value: "github-light" }));
	await page.waitForFunction(() => document.documentElement.dataset.theme === "github-light");
	await avatarsAre(drawnIn("#e0805a"), "the side bar's avatar, in GitHub Light");
	await page.evaluate(() => (window as any).pine.call("POST", "/settings", { key: "ui.theme", value: "default" }));
	await page.waitForFunction(() => document.documentElement.dataset.theme === "pmndre");

	// Its conversation: the tab and the empty conversation carry it too.
	await page.locator("[data-slot=settings-page]").getByRole("button", { name: "Open" }).click();
	await page.waitForSelector("[data-slot=empty] [data-slot=avatar][data-agent=books]");
	assert.ok((await avatars()).length >= 3, "the side bar, the tab and the empty conversation");
	await avatarsAre(drawnIn("#e0805a"), "every avatar of books");
	// The color is the avatar's and nothing else's: with books in front the window keeps the theme's accent.
	assert.equal(await resolved("var(--primary)"), rgb("#5de4c7"), "pmndre's mint, not books' coral");
});

test("Other takes any color, and None takes it away again", async () => {
	const color = await colorOnPage();
	await page.fill("[data-slot=agent-color][data-open] input[type=color]", "#3366cc");
	await keeps("#3366cc", "the color set under Other");
	await avatarsAre(drawnIn("#3366cc"), "the color set under Other");
	await color.getByRole("button", { name: "None", exact: true }).click();
	await keeps(undefined, "None leaves no color in the file");
	await page.keyboard.press("Escape");
	await avatarsAre(await resolved("var(--muted)"), "back to the stock avatar");
});

test("Color in the side bar's menu opens the same colors over the agent's avatar there", async () => {
	// The menu is the system's, which the driver cannot click in: the test says what is picked.
	await app.evaluate(({ ipcMain }: any) => {
		ipcMain.removeHandler("pine:context-menu");
		ipcMain.handle("pine:context-menu", () => "color");
	});
	await page.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { hasText: "books" }).click({ button: "right" });
	await page.locator("[data-slot=agent-color][data-open]").getByRole("button", { name: "Green", exact: true }).click();
	await keeps("#4caf50", "Green, picked from the side bar");
	await page.keyboard.press("Escape");
	await avatarsAre(drawnIn("#4caf50"), "every avatar of books");
});
