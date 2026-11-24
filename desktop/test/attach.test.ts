// The other half of "start or reuse": a pine that already runs is used as it is, and left
// running when the app quits, and said to be older than the app's own pine when it is.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";
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
/**
 * A pine of a newer version than the one that runs: the launcher of this checkout under a package
 * of its own that says 99.0.0, as the pine a packed app carries says its version. It runs the
 * checkout's pine, so that a daemon it starts says the checkout's version.
 */
let newer: string;
/**
 * A pine of an older version: the checkout's own files, linked under a package that says 0.0.1 and
 * run with the links kept, so that pine's root, and the version its daemon says, is that folder.
 */
let older: string;
/** What a menu item does, sent as the menu sends it to the app's window. */
const menu = (a: any, command: string) => a.evaluate(({ BrowserWindow }: any, c: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", c), command);

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
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port }, defaults: { model: "mock/m", mode: "safe", introduce: false } }));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n\nYou are the main agent.\n");
	// The browser of the web tools counts as there, whatever this machine has: Playwright's own
	// variable names a folder that carries its marks. (What the app asks when it is missing is
	// app.test.ts's to test, and its question would stand in front of what is clicked here.)
	const browsers = path.join(home, "browsers");
	for (const place of (await browserPlaces()) ?? []) write(path.join(browsers, path.basename(place), "INSTALLATION_COMPLETE"), "");
	process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
	newer = path.join(home, "newer-pine");
	write(path.join(newer, "package.json"), JSON.stringify({ name: "@pmndre/pine", version: "99.0.0", type: "module" }));
	write(path.join(newer, "bin", "pine.js"), `import ${JSON.stringify(pathToFileURL(path.join(root, "..", "bin", "pine.js")).href)};\n`);
	older = path.join(home, "older-pine");
	write(path.join(older, "package.json"), JSON.stringify({ name: "@pmndre/pine", version: "0.0.1", type: "module" }));
	for (const part of ["src", "mcp", "docs", "examples", "node_modules"]) fs.symlinkSync(path.join(root, "..", part), path.join(older, part));
	write(path.join(older, "bin", "pine.js"), `import "../src/cli.ts";\n`);
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
	// A socket of the last look at the daemon may still be closing (on macOS it says so with an error of
	// its own, setTypeOfService EINVAL): it does so inside this hook, not after the file has ended.
	await new Promise((r) => setTimeout(r, 500));
});

test("attaches to a pine that runs, and leaves it running", async () => {
	app = await launchApp({ ...process.env, PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_DESKTOP_DEV_URL: "" });
	const page = await app.firstWindow();
	await page.waitForSelector("[data-slot=empty] h1", { timeout: 30_000 }).catch(async () => {
		throw new Error(`the conversation did not appear. On screen: ${await page.evaluate(() => document.body.innerText.slice(0, 800))}`);
	});
	assert.match(await page.textContent("[data-slot=service-status]"), /attached/);
	// The pine that runs is the app's own version: nothing is said about it.
	assert.equal(await page.$("[data-notice=older-pine]"), null);
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

test("a pine that runs is said to be older than the app's own when it is", async () => {
	// The daemon that runs now is an older pine's, started in a terminal; the app's own pine is the
	// checkout's. What tells them apart is the version the daemon itself says, not its CLI's.
	daemon.kill("SIGTERM");
	await daemonGone(port, home);
	daemon = spawn(process.execPath, ["--preserve-symlinks", "--preserve-symlinks-main", path.join(older, "bin", "pine.js"), "start", "--home", home], { stdio: "ignore" });
	await waitForDaemon(port, home);
	app = await launchApp({ ...process.env, PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_DESKTOP_DEV_URL: "" });
	const page = await app.firstWindow();
	// (The conversation of the test before is the one shown, so the window is not empty.)
	await page.waitForSelector("[data-slot=service-status] >> text=attached", { timeout: 30_000 });
	const version = JSON.parse(fs.readFileSync(path.join(root, "..", "package.json"), "utf8")).version;
	const line = await page.waitForSelector("[data-slot=sidebar-footer] [data-notice=older-pine]", { timeout: 10_000 });
	assert.match((await line.textContent()) ?? "", /older pine/i);
	// Settings > General says which versions, and what to do.
	await menu(app, "settings");
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=General");
	const said = (await (await page.waitForSelector("[data-slot=settings-page] [data-notice=older-pine]", { timeout: 10_000 })).textContent()) ?? "";
	assert.ok(said.includes(version) && said.includes("0.0.1"), `the notice names both versions: ${said}`);
	assert.match(said, /restart/i);
	await app.close();
	app = undefined;
	assert.ok(await healthy(), "the daemon the app only attached to was stopped with it");
});

test("with \"keep pine running\" a daemon the app started goes on after it", async () => {
	// A second home, with nothing running, and the app's own setting written as the settings page writes it.
	const kept = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-keep-")));
	const keptPort = await freePort();
	const up = () => ours(keptPort, kept);
	try {
		fs.cpSync(path.join(home, "models.json"), path.join(kept, "models.json"));
		write(path.join(kept, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: keptPort }, defaults: { model: "mock/m", mode: "safe", introduce: false } }));
		write(path.join(kept, "agents", "main", "agent.json"), JSON.stringify({}));
		write(path.join(kept, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n\nYou are the main agent.\n");
		write(path.join(kept, "desktop-data", "prefs.json"), JSON.stringify({ keepRunning: true }));
		// Started by a pine of a newer version than it says: a daemon the app started is never pointed out.
		const second = await launchApp({ ...process.env, PINE_HOME: kept, PINE_DESKTOP_DATA: path.join(kept, "desktop-data"), PINE_DESKTOP_DEV_URL: "", PINE_CLI: path.join(newer, "bin", "pine.js") });
		const page = await second.firstWindow();
		await page.waitForSelector("[data-slot=empty] h1", { timeout: 60_000 });
		assert.match((await page.textContent("[data-slot=service-status]")) ?? "", /started here/);
		assert.equal(await page.$("[data-notice=older-pine]"), null);
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
