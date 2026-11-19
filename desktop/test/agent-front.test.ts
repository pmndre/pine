// The window takes the colour of the agent in front as its accent, over the theme's, unless the owner
// turned that off in Settings > App: the real app on a home of its own, started twice on the same
// data. What is checked is the colour a token resolves to in the window, never a class. The theme's
// own values are read from the window itself, so that nothing here depends on how a theme is drawn.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { _electron as electron } from "playwright-core";
import { startMock } from "../../baseline/tests/mock.mjs";
import { onColour } from "../src/theme.ts";

const root = path.resolve(import.meta.dirname, "..");
let app: any;
let page: any;
let mock: any;
let home: string;
const prefsFile = () => path.join(home, "desktop-data", "prefs.json");
const BOOKS = "#d9534f";

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

/** The colour a shadcn token resolves to in the window. */
const token = (name: string): Promise<string> =>
	page.evaluate((v: string) => {
		const probe = document.body.appendChild(document.createElement("div"));
		probe.style.backgroundColor = `var(--${v})`;
		const colour = getComputedStyle(probe).backgroundColor;
		probe.remove();
		return colour;
	}, name);
/** Waits until a token is that colour, and says what it is instead when it does not come. */
async function tokenIs(name: string, want: string, why: string): Promise<void> {
	for (let i = 0; i < 100; i++) {
		if ((await token(name)) === want) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	assert.equal(await token(name), want, why);
}

const menu = (name: string) => app.evaluate(({ BrowserWindow }: any, n: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", n), name);
const tab = (agent: string) => page.locator(`[data-slot=tab][title^="${agent} ·"]`).first();

async function start(): Promise<void> {
	app = await electron.launch({ args: [root], env: { ...process.env, PINE_DESKTOP_BACKGROUND: "1", PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"), PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "" } });
	page = await app.firstWindow();
	await page.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
	await page.waitForSelector("[data-slot=empty] h1", { timeout: 30_000 });
	const dialog = await page.waitForSelector("[data-slot=dialog-footer] button >> text=Not now", { timeout: 3000 }).catch(() => undefined);
	if (dialog) await dialog.click();
	await page.waitForFunction(() => document.documentElement.dataset.theme === "pmndre");
}

/** books' conversation in front, opened from its page in Settings the first time. */
async function booksInFront(): Promise<void> {
	if (await tab("books").count()) return void (await tab("books").click());
	// The same menu item opens the settings and puts them away.
	if (!(await page.$("[data-slot=settings-page]"))) await menu("settings");
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=Agents");
	await page.locator("[data-slot=settings-page] [data-slot=item]", { hasText: "Keeps the books" }).click();
	await page.locator("[data-slot=settings-page]").getByRole("button", { name: "Open" }).click();
	await page.waitForSelector("[data-slot=empty] [data-slot=avatar][data-agent=books]");
}
/** Turns "The agent in front colours the window" on or off in Settings > App, and waits until the switch says so. */
async function follow(on: boolean): Promise<void> {
	await menu("settings");
	await page.locator("[role=navigation]").getByRole("button", { name: "App", exact: true }).click();
	const box = page.locator("[data-setting=agent-accent] [role=switch]");
	await box.waitFor();
	if ((await box.getAttribute("aria-checked")) !== String(on)) await box.click();
	await page.waitForFunction((v: string) => document.querySelector("[data-setting=agent-accent] [role=switch]")?.getAttribute("aria-checked") === v, String(on));
	await menu("settings");
}

/** The theme's own values, with no agent's colour in front: read once main's conversation is in front. */
const theme: Record<string, string> = {};
const TOKENS = ["primary", "primary-foreground", "background", "foreground", "border", "muted-foreground"];

before(async () => {
	if (!fs.existsSync(path.join(root, "dist", "index.html")) || !fs.existsSync(path.join(root, "dist-electron", "main.js"))) throw new Error("the app is not built: node scripts/build.mjs in desktop/");
	mock = await startMock({});
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-agent-front-")));
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false } }));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ description: "The main agent" }));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "You are the main agent.\n");
	write(path.join(home, "agents", "books", "agent.json"), JSON.stringify({ description: "Keeps the books", color: BOOKS }));
	write(path.join(home, "agents", "books", "workspace", "AGENTS.md"), "You keep the books.\n");
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	// A damaged value of the app before themes: the default (on) is what the window does.
	write(prefsFile(), JSON.stringify({ updates: false, agentFamilies: "rainbow" }));
	await start();
	for (const t of TOKENS) theme[t] = await token(t);
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	if (home) fs.rmSync(home, { recursive: true, force: true });
});

test("a coloured agent in front gives the window its accent, with what reads on it, and leaves the rest the theme's", async () => {
	assert.equal(theme.primary, rgb("#5de4c7"), "pmndre's mint while main is in front");
	await booksInFront();
	await tokenIs("primary", rgb(BOOKS), "books' colour is the accent");
	await tokenIs("primary-foreground", rgb(onColour(BOOKS)), "and what is written on it reads");
	for (const t of ["background", "foreground", "border", "muted-foreground"]) assert.equal(await token(t), theme[t], `${t} stays the theme's`);
});

test("another tab, Settings, or an agent without a colour gives the theme's accent back at once", async () => {
	await booksInFront();
	await tokenIs("primary", rgb(BOOKS), "books in front");
	await tab("main").click();
	await tokenIs("primary", theme.primary, "main has no colour");
	await booksInFront();
	await tokenIs("primary", rgb(BOOKS), "books in front again");
	await menu("settings");
	await tokenIs("primary", theme.primary, "Settings in front");
	await menu("settings");
});

test("a theme chosen while the agent is in front keeps the agent's accent over the new theme", async () => {
	await booksInFront();
	await page.evaluate(() => (window as any).pine.call("POST", "/settings", { key: "ui.theme", value: "github-light" }));
	await page.waitForFunction(() => document.documentElement.dataset.theme === "github-light");
	await tokenIs("background", rgb("#ffffff"), "GitHub Light's page");
	await tokenIs("primary", rgb(BOOKS), "still books' accent");
	await page.evaluate(() => (window as any).pine.call("POST", "/settings", { key: "ui.theme", value: "default" }));
	await page.waitForFunction(() => document.documentElement.dataset.theme === "pmndre");
});

test("turned off in Settings > App the theme's accent stays; that is kept after a restart, and an old preference that left out the primary is off too", async () => {
	await follow(false);
	await booksInFront();
	await tokenIs("primary", theme.primary, "off: the theme's accent with books in front");
	assert.equal(JSON.parse(fs.readFileSync(prefsFile(), "utf8")).agentAccent, false);
	await app.close();
	await start();
	await booksInFront();
	await tokenIs("primary", theme.primary, "after a restart: still off");

	await follow(true);
	await booksInFront();
	await tokenIs("primary", rgb(BOOKS), "on again: books' accent");

	// The app before themes kept role families: one without the primary followed no accent.
	await app.close();
	const prefs = JSON.parse(fs.readFileSync(prefsFile(), "utf8"));
	delete prefs.agentAccent;
	write(prefsFile(), JSON.stringify({ ...prefs, agentFamilies: ["surfaces"] }));
	await start();
	await booksInFront();
	await tokenIs("primary", theme.primary, "families without the primary: off");
});
