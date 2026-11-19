// An agent's own colour, as the owner sets it on the agent's settings page: the real app on a home of
// its own. What is checked is what the window draws (the computed colour of the agent's avatar) and
// what the agent's file keeps, never a class.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { _electron as electron } from "playwright-core";
import { startMock } from "../../baseline/tests/mock.mjs";

const root = path.resolve(import.meta.dirname, "..");
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
/** What the avatar of an agent with that colour should be: the colour itself, in every theme. */
const drawnIn = (color: string) => rgb(color);
/** The colour a CSS colour value resolves to in the page. */
const resolved = (value: string): Promise<string> =>
	page.evaluate((v: string) => {
		const probe = document.body.appendChild(document.createElement("div"));
		probe.style.backgroundColor = v;
		const colour = getComputedStyle(probe).backgroundColor;
		probe.remove();
		return colour;
	}, value);
/** The background each avatar of the agent books is drawn with, wherever it is in the window (the swatches of the colour field aside). */
const avatars = (): Promise<string[]> =>
	page.$$eval("[data-slot=avatar][data-agent=books] [data-slot=avatar-fallback]", (els: Element[]) => els.filter((e) => !e.closest("[data-setting=agent-colour]")).map((e) => getComputedStyle(e).backgroundColor));
/** Waits until every avatar of books is drawn in that colour, and says what they are instead when it does not come. */
async function avatarsAre(want: string, why: string): Promise<void> {
	for (let i = 0; i < 100; i++) {
		const now = await avatars();
		if (now.length && now.every((c) => c === want)) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	assert.deepEqual(await avatars(), [want], why);
}

const menu = (name: string) => app.evaluate(({ BrowserWindow }: any, n: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", n), name);

async function booksPage(): Promise<void> {
	await menu("settings");
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=Agents");
	await page.locator("[data-slot=settings-page] [data-slot=item]", { hasText: "Keeps the books" }).click();
	await page.waitForSelector("[data-setting=agent-colour]");
}
async function save(): Promise<void> {
	await page.locator("[data-slot=settings-page]").getByRole("button", { name: "Save changes" }).click();
	await page.waitForFunction(() => [...document.querySelectorAll("[data-slot=toast]")].some((t) => t.textContent?.includes("Updated books")));
}

before(async () => {
	if (!fs.existsSync(path.join(root, "dist", "index.html")) || !fs.existsSync(path.join(root, "dist-electron", "main.js"))) throw new Error("the app is not built: node scripts/build.mjs in desktop/");
	mock = await startMock({});
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-agent-colour-")));
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false } }));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ description: "The main agent" }));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "You are the main agent.\n");
	write(agentFile(), JSON.stringify({ description: "Keeps the books" }));
	write(path.join(home, "agents", "books", "workspace", "AGENTS.md"), "You keep the books.\n");
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	write(path.join(home, "desktop-data", "prefs.json"), JSON.stringify({ updates: false }));
	app = await electron.launch({ args: [root], env: { ...process.env, PINE_DESKTOP_BACKGROUND: "1", PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"), PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "" } });
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

test("an agent without a colour has the avatar every agent had: muted", async () => {
	await avatarsAre(await resolved("var(--muted)"), "no colour, the stock avatar");
});

test("a preset colour picked on the agent's page is kept in its agent.json and draws its avatar, in a dark theme and a light one", async () => {
	await booksPage();
	await page.locator("[data-setting=agent-colour]").getByRole("button", { name: "Coral", exact: true }).click();
	await save();
	const coral = JSON.parse(fs.readFileSync(agentFile(), "utf8")).color;
	assert.match(coral, /^#[0-9a-f]{6}$/);
	await avatarsAre(drawnIn(coral), "the side bar's avatar, in pmndre");
	// The same in a light theme: an agent is known by its colour whatever the theme.
	await page.evaluate(() => (window as any).pine.call("POST", "/settings", { key: "ui.theme", value: "github-light" }));
	await page.waitForFunction(() => document.documentElement.dataset.theme === "github-light");
	await avatarsAre(drawnIn(coral), "the side bar's avatar, in GitHub Light");
	await page.evaluate(() => (window as any).pine.call("POST", "/settings", { key: "ui.theme", value: "default" }));
	await page.waitForFunction(() => document.documentElement.dataset.theme === "pmndre");

	// Its conversation: the tab and the empty conversation carry it too.
	await page.locator("[data-slot=settings-page]").getByRole("button", { name: "Open" }).click();
	await page.waitForSelector("[data-slot=empty] [data-slot=avatar][data-agent=books]");
	assert.ok((await avatars()).length >= 3, "the side bar, the tab and the empty conversation");
	await avatarsAre(drawnIn(coral), "every avatar of books");
});

test("Other takes any colour, and None takes it away again", async () => {
	await booksPage();
	const group = page.locator("[data-setting=agent-colour]");
	await group.getByRole("button", { name: "Other…", exact: true }).click();
	await page.fill("[data-setting=agent-colour] input[type=color]", "#3366cc");
	await save();
	assert.equal(JSON.parse(fs.readFileSync(agentFile(), "utf8")).color, "#3366cc");
	await avatarsAre(drawnIn("#3366cc"), "the colour typed under Other");

	await group.getByRole("button", { name: "None", exact: true }).click();
	await save();
	assert.equal("color" in JSON.parse(fs.readFileSync(agentFile(), "utf8")), false, "None leaves no colour in the file");
	await avatarsAre(await resolved("var(--muted)"), "back to the stock avatar");
});

test("Other… alone changes nothing: saving another change leaves the agent without a colour", async () => {
	// Settings is still open on books from the test before: back to the list and in again, for a page with no change.
	await page.locator("[data-slot=settings-page]").getByRole("button", { name: "Agents", exact: true }).click();
	await page.locator("[data-slot=settings-page] [data-slot=item]", { hasText: "Keeps the books" }).click();
	await page.waitForSelector("[data-setting=agent-colour]");
	assert.equal("color" in JSON.parse(fs.readFileSync(agentFile(), "utf8")), false, "books starts without a colour");
	await page.locator("[data-setting=agent-colour]").getByRole("button", { name: "Other…", exact: true }).click();
	await page.getByLabel("What it is for").fill("Keeps the books, and the receipts");
	await save();
	const kept = JSON.parse(fs.readFileSync(agentFile(), "utf8"));
	assert.equal(kept.description, "Keeps the books, and the receipts");
	assert.equal("color" in kept, false, "Other… without a colour picked gives no colour");
});
