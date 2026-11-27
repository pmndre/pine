// The question at the start about the owner's own browser: the real app on a home of its own, with an account of
// the test's own in which a Chrome lies, and a store page that only this test names (PINE_CHROME_STORE: the
// extension is in no store yet, and without one the app asks nothing, which every other test of the app relies on).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { startMock } from "../../baseline/tests/mock.mjs";
import { browserPlaces } from "../../src/browser-build.ts";
import { launchApp, patient } from "./support/app.ts";

const STORE = "https://store.example/detail/pine";
let app: any;
let page: any;
let mock: any;
let home: string;
let account: string;

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};
const registered = () => path.join(account, ...(process.platform === "darwin" ? ["Library", "Application Support", "Google", "Chrome"] : [".config", "google-chrome"]), "NativeMessagingHosts", "dev.pmndre.pine.json");
const ownBrowser = async () => (await page.evaluate(() => (window as any).pine.call("GET", "/chrome"))).data;

before(async () => {
	mock = await startMock({});
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-own-browser-")));
	account = path.join(home, "account");
	fs.mkdirSync(path.dirname(path.dirname(registered())), { recursive: true });
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe", introduce: false }, security: { askAccess: false } }));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n\nYou are the main agent.\n");
	// The browser of the web tools counts as there: the app's question about that one comes first, and is tested elsewhere.
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	for (const place of (await browserPlaces()) ?? []) write(path.join(home, "browsers", path.basename(place), "INSTALLATION_COMPLETE"), "");
	write(path.join(home, "desktop-data", "prefs.json"), JSON.stringify({ updates: false }));
	app = await launchApp({ ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"), PINE_HOME: home, PINE_CHROME_ACCOUNT: account, PINE_CHROME_STORE: STORE, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "" });
	page = await app.firstWindow();
	await page.waitForSelector("[data-slot=tab][data-active]", { timeout: patient(30_000) });
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	if (home) fs.rmSync(home, { recursive: true, force: true });
});

test("once the extension has a store page, the app asks at the start; a yes makes pine known to the browsers here and opens that page, and it is not asked again", { skip: process.platform === "win32" && "the browsers are told through the registry there" }, async () => {
	await page.waitForSelector("[data-dialog=own-browser-ask]", { timeout: patient(15_000) });
	// Nothing was done before the owner said so.
	assert.ok(!fs.existsSync(registered()));
	assert.deepEqual(await app.evaluate(() => (globalThis as any).quiet.opened), []);

	await page.click("[data-dialog=own-browser-ask] [data-action=get]");
	await page.waitForSelector("[data-dialog=own-browser-ask]", { state: "detached", timeout: patient(10_000) });
	await page.waitForFunction(() => localStorage.getItem("pine.ownBrowser.asked") === "1");
	// pine is registered with the browser of the account, and the store's page was opened in the owner's browser.
	for (const end = Date.now() + patient(10_000); Date.now() < end && !fs.existsSync(registered()); ) await new Promise((r) => setTimeout(r, 100));
	assert.equal(JSON.parse(fs.readFileSync(registered(), "utf8")).path, path.join(home, "chrome", "host"));
	for (const end = Date.now() + patient(10_000); Date.now() < end && !(await app.evaluate(() => (globalThis as any).quiet.opened.length)); ) await new Promise((r) => setTimeout(r, 100));
	assert.deepEqual(await app.evaluate(() => (globalThis as any).quiet.opened), [STORE]);
	const state = await ownBrowser();
	assert.deepEqual([state.set, state.store, state.connected], [true, STORE, undefined]);

	// The window opened anew: it was answered, and is not asked again.
	await page.reload();
	await page.waitForSelector("[data-slot=tab][data-active]", { timeout: patient(30_000) });
	assert.equal((await ownBrowser()).store, STORE);
	assert.equal(await page.$("[data-dialog=own-browser-ask]"), null);
});
