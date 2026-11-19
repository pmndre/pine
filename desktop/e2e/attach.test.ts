// The other half of "start or reuse": a pine that already runs is used as it is, and left
// running when the app quits.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { startMock } from "../../baseline/tests/mock.mjs";
import { browserPlaces } from "../../src/browser-build.ts";
import { launchApp } from "./support/app.ts";
import { daemonGone, freePort, ours, stopKept, waitForDaemon } from "./support/daemon.ts";

const root = path.resolve(import.meta.dirname, "..");
let app: any;
let mock: any;
let home: string;
let daemon: ChildProcess;
let port: number;

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

/** The daemon of this test's home answers on its port (another run's daemon there does not count). */
const healthy = () => ours(port, home);

before(async () => {
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	port = await freePort();
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-attach-")));
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port }, defaults: { model: "mock/m", mode: "safe" } }));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n\nYou are the main agent.\n");
	// The browser of the web tools counts as there, whatever this machine has: Playwright's own
	// variable names a folder that carries its marks. (What the app asks when it is missing is
	// app.test.ts's to test, and its question would stand in front of what is clicked here.)
	const browsers = path.join(home, "browsers");
	for (const place of (await browserPlaces()) ?? []) write(path.join(browsers, path.basename(place), "INSTALLATION_COMPLETE"), "");
	process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
	// A pine as somebody would have started it in a terminal.
	daemon = spawn(process.execPath, [path.join(root, "..", "bin", "pine.js"), "start", "--home", home], { stdio: "ignore" });
	await waitForDaemon(port, home);
});

after(async () => {
	await app?.close().catch(() => {});
	daemon?.kill("SIGTERM");
	// Gone before its home is: without the token it could no longer be told apart.
	if (home && port) await daemonGone(port, home);
	await mock?.close?.().catch(() => {});
	if (home) fs.rmSync(home, { recursive: true, force: true });
});

test("attaches to a pine that runs, and leaves it running", async () => {
	app = await launchApp({ ...process.env, PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_DESKTOP_DEV_URL: "" });
	const page = await app.firstWindow();
	await page.waitForSelector("[data-slot=empty] h1", { timeout: 30_000 }).catch(async () => {
		throw new Error(`the conversation did not appear. On screen: ${await page.evaluate(() => document.body.innerText.slice(0, 800))}`);
	});
	assert.match(await page.textContent("[data-slot=service-status]"), /attached/);
	// It talks to that very daemon: a message is answered (the scripted model echoes).
	await page.fill("[data-slot=composer] textarea", "hello there");
	await page.keyboard.press("Enter");
	await page.waitForSelector("[data-slot=markdown] >> text=ECHO[hello there]", { timeout: 30_000 });
	await app.close();
	app = undefined;
	// Asked a few times: a daemon that is busy for a moment is not a daemon that is gone.
	let there = false;
	for (let i = 0; i < 10 && !there; i++) {
		await new Promise((r) => setTimeout(r, 300));
		there = await healthy();
	}
	assert.ok(there, "the daemon the app only attached to was stopped with it");
});

test("with \"keep pine running\" a daemon the app started goes on after it", async () => {
	// A second home, with nothing running, and the app's own setting written as the settings page writes it.
	const kept = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-keep-")));
	const keptPort = await freePort();
	const up = () => ours(keptPort, kept);
	try {
		fs.cpSync(path.join(home, "models.json"), path.join(kept, "models.json"));
		write(path.join(kept, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: keptPort }, defaults: { model: "mock/m", mode: "safe" } }));
		write(path.join(kept, "agents", "main", "agent.json"), JSON.stringify({}));
		write(path.join(kept, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n\nYou are the main agent.\n");
		write(path.join(kept, "desktop-data", "prefs.json"), JSON.stringify({ keepRunning: true }));
		const second = await launchApp({ ...process.env, PINE_HOME: kept, PINE_DESKTOP_DATA: path.join(kept, "desktop-data"), PINE_DESKTOP_DEV_URL: "" });
		const page = await second.firstWindow();
		await page.waitForSelector("[data-slot=empty] h1", { timeout: 60_000 });
		assert.match((await page.textContent("[data-slot=service-status]")) ?? "", /started here/);
		await second.close();
		await new Promise((r) => setTimeout(r, 800));
		assert.ok(await up(), "the daemon stopped with the app although it was to be kept");
		// The next start finds it and attaches.
		const third = await launchApp({ ...process.env, PINE_HOME: kept, PINE_DESKTOP_DATA: path.join(kept, "desktop-data"), PINE_DESKTOP_DEV_URL: "" });
		const again = await third.firstWindow();
		await again.waitForSelector("[data-slot=empty] h1", { timeout: 60_000 });
		assert.match((await again.textContent("[data-slot=service-status]")) ?? "", /attached/);
		await third.close();
	} finally {
		// It is this test's to stop: found by the home it was started for, while its token is there.
		try {
			await stopKept(keptPort, kept, 9000);
		} finally {
			fs.rmSync(kept, { recursive: true, force: true });
		}
	}
});
