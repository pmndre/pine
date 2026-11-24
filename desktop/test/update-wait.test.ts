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

const RESTART = "[data-slot=sidebar-footer] [data-sidebar=menu-button]:has-text('Restart to update')";
const PENDING = "[data-slot=sidebar-footer] [data-sidebar=menu-button]:has-text('Restarts when the work is done')";
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
		await page.waitForSelector("[data-slot=empty] h1", { timeout: 60_000 });
		await page.waitForSelector(RESTART, { timeout: 20_000 });
		// The main agent at work for longer than the test lasts.
		await page.fill("[data-slot=composer] textarea", mockMsg([{ delayMs: 30_000, text: "Never said." }], "Take your time. "));
		await page.keyboard.press("Enter");
		await page.waitForSelector("[data-slot=sidebar] [data-slot=pulse]", { timeout: 20_000 });
		await page.click(RESTART);
		await page.click(`${WARNING} [data-slot=command-item]:has-text('Restart when they are done')`);
		await page.waitForSelector(PENDING);

		// The dialog of "Check for Updates…": the wait, and its call-off, and no Restart to update.
		const menu = (command: string) => app.evaluate(({ BrowserWindow }: any, c: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", c), command);
		await menu("updates");
		const dialog = page.locator("[data-slot=dialog-content]");
		await dialog.getByText("once no conversation is at work").waitFor();
		assert.equal(await dialog.getByRole("button", { name: "Restart to update" }).count(), 0);
		await dialog.getByRole("button", { name: "Close" }).click();
		await dialog.waitFor({ state: "detached" });
		await page.waitForSelector(PENDING);

		// Settings > General: the same.
		await menu("settings");
		await page.click("[role=navigation] [data-sidebar=menu-button] >> text=General");
		const field = page.locator("[data-setting=updates]");
		await field.getByText("once no conversation is at work").waitFor();
		assert.equal(await field.getByRole("button", { name: "Restart to update" }).count(), 0);
		await field.getByRole("button", { name: "Call off the wait" }).click();
		await page.waitForSelector(PENDING, { state: "detached" });
		await field.getByRole("button", { name: "Restart to update" }).waitFor();
		assert.deepEqual(calls(), ["download"]);
	} finally {
		await app.close().catch(() => {});
	}
});
