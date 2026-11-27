// A wait for the end of the work before an update ("Restart when they are done") is one state that
// every view of the update shows alike: the side bar's foot, Settings > General and the dialog of
// "Check for Updates…" say that it waits and call it off, and none of them offers a second restart.
// Driven through the real app on a stand-in for GitHub (PINE_DESKTOP_RELEASES) and for macOS's
// updater (PINE_DESKTOP_UPDATER), as self-update.test.ts does.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { mockMsg, startMock } from "../../baseline/tests/mock.mjs";
import { browserPlaces } from "../../src/browser-build.ts";
import { launchApp } from "./support/app.ts";
import { freePort } from "./support/daemon.ts";

/** The app updates itself on a Mac alone (macOS's updater); on Linux and Windows it links to the release (test/updates.test.ts). */
const OFF_MAC = process.platform !== "darwin" && "the app updates itself on a Mac only";

let mock: any;
let github: http.Server;
let releases: string;
let home: string;

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

before(async () => {
	if (OFF_MAC) return;
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	github = http.createServer((_req, res) => {
		const assets = ["Pine-9.9.9-arm64.dmg", "Pine-9.9.9-x64.dmg", "Pine-arm64.json", "Pine-x64.json"].map((name) => ({ name, browser_download_url: `https://example.invalid/${name}` }));
		res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ tag_name: "v9.9.9", html_url: "https://example.invalid/elsewhere", assets }));
	});
	await new Promise<void>((r) => github.listen(0, "127.0.0.1", r));
	releases = `http://127.0.0.1:${(github.address() as any).port}/repos/pmndre/pine/releases/latest`;
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-update-wait-")));
});

after(async () => {
	if (OFF_MAC) return;
	github?.close();
	await mock?.close?.().catch(() => {});
	if (home) fs.rmSync(home, { recursive: true, force: true });
});

// The side bar's foot, by the update's phase (`data-update`): ready to install, or waiting for the work to end.
const RESTART = "[data-slot=sidebar-footer] [data-update=ready]";
const PENDING = "[data-slot=sidebar-footer] [data-update=waiting]";
const WARNING = "[data-slot=alert-dialog-content]";

test("while an update waits for the work to end, Settings > General and the update dialog show the wait and call it off, and offer no second restart", { skip: OFF_MAC }, async () => {
	const port = await freePort();
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port }, defaults: { model: "mock/m", mode: "safe", introduce: false } }));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n\nYou are the main agent.\n");
	const browsers = path.join(home, "browsers");
	for (const place of (await browserPlaces()) ?? []) write(path.join(browsers, path.basename(place), "INSTALLATION_COMPLETE"), "");
	write(path.join(home, "desktop-data", "prefs.json"), JSON.stringify({}));
	const updater = path.join(home, "updater");
	write(path.join(updater, "plan.json"), JSON.stringify({ outcome: "ready" }));
	const calls = () => {
		try {
			return fs.readFileSync(path.join(updater, "calls.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).call);
		} catch {
			return [];
		}
	};
	const app = await launchApp({ ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers, PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_DESKTOP_DEV_URL: "", PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_RELEASES: releases, PINE_DESKTOP_UPDATER: updater });
	try {
		const page = await app.firstWindow();
		await page.waitForSelector("[data-slot=composer] textarea", { timeout: 60_000 });
		await page.waitForSelector(RESTART, { timeout: 20_000 });
		// The main agent at work for longer than the test lasts.
		await page.fill("[data-slot=composer] textarea", mockMsg([{ delayMs: 30_000, text: "Never said." }], "Take your time. "));
		await page.keyboard.press("Enter");
		await page.waitForSelector("[data-slot=sidebar] [data-slot=pulse]", { timeout: 20_000 });
		await page.click(RESTART);
		await page.click(`${WARNING} [data-slot=command-item][data-value=done]`);
		await page.waitForSelector(PENDING);

		// The dialog of "Check for Updates…": the wait, and its call-off, and no Restart to update.
		const menu = (command: string) => app.evaluate(({ BrowserWindow }: any, c: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", c), command);
		await menu("updates");
		const dialog = page.locator("[data-dialog=update]");
		await page.waitForSelector("[data-dialog=update][data-update=waiting] [data-action=cancel-wait]");
		assert.equal(await dialog.locator("[data-action=restart]").count(), 0);
		await dialog.locator("[data-action=close]").click();
		await dialog.waitFor({ state: "detached" });
		await page.waitForSelector(PENDING);

		// Settings > General: the same.
		await menu("settings");
		await page.click("[role=navigation] [data-section=general]");
		const field = page.locator("[data-setting=updates]");
		await page.waitForSelector("[data-setting=updates][data-update=waiting] [data-action=cancel-wait]");
		assert.equal(await field.locator("[data-action=restart]").count(), 0);
		await field.locator("[data-action=cancel-wait]").click();
		await page.waitForSelector(PENDING, { state: "detached" });
		// Called off: every view is back at the update that is ready, the side bar's among them.
		await page.waitForSelector("[data-setting=updates][data-update=ready] [data-action=restart]");
		await page.waitForSelector(RESTART);
		assert.deepEqual(calls(), ["download"]);
	} finally {
		await app.close().catch(() => {});
	}
});
