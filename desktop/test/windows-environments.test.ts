// Multi-environment desktop UX end-to-end tests: simultaneous local + loopback SSH windows,
// concurrent chat, per-window pine-media:, reactive document.title, title bar environment pill,
// Settings > Environments Open in new window / in another window badge / Forget confirmation,
// machine menu CmdOrCtrl-click & Open in new window, local OS folder routing, per-window themes,
// and global preference broadcasts.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { startMock } from "../../baseline/tests/mock.mjs";
import { sandboxMissing } from "../../src/security.ts";
import { clickMenu, launchApp, sendMenuTo, waitForWindow, windowCount } from "./support/app.ts";
import { daemonGone } from "./support/daemon.ts";

const root = path.resolve(import.meta.dirname, "..");
const HERE = process.platform === "darwin" ? "Mac" : "computer";

let mock: any;
let home: string;
let far: string;
let localFolder: string;
let dataDir: string;
let browsers: string;
let sshPath: string;
let app: ElectronApplication | undefined;

const write = (file: string, content: string | Buffer) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

// Minimal valid 1x1 and 2x2 PNG buffers so we can verify per-window pine-media: image routing via <img>.
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PNG_2X2 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8AARAwMjDAGACwBA/9/44kEAAAAAElFTkSuQmCC", "base64");

const daemonOf = (dir: string) => ({
	port: [...fs.readFileSync(path.join(dir, "data", "pine.log"), "utf8").matchAll(/http listening on 127\.0\.0\.1:(\d+)/g)].at(-1)![1],
	token: fs.readFileSync(path.join(dir, "data", "http-token"), "utf8").trim(),
});

async function dismissBrowserAsk(p: Page, expectDialog = true): Promise<void> {
	await p.waitForSelector("[data-slot=empty] h1, [data-slot=no-tab]", { timeout: 25_000 });
	const btn = p.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Not now" });
	if (expectDialog) await btn.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
	if (await btn.isVisible().catch(() => false)) {
		await btn.click();
		await p.waitForSelector("[data-slot=dialog-content]", { state: "detached", timeout: 5000 }).catch(() => {});
	}
}

async function waitForWindowCount(launched: ElectronApplication, expected: number, timeout = 10_000): Promise<void> {
	await launched.evaluate(
		({ BrowserWindow }: any, [n, ms]: [number, number]) =>
			new Promise<void>((resolve, reject) => {
				const deadline = Date.now() + ms;
				const check = () => (BrowserWindow.getAllWindows().length === n ? resolve() : Date.now() > deadline ? reject(new Error(`expected ${n} windows, got ${BrowserWindow.getAllWindows().length}`)) : setTimeout(check, 50));
				check();
			}),
		[expected, timeout] as [number, number],
	);
}

before(async () => {
	if (process.platform === "linux" && sandboxMissing()) throw new Error(`No sandbox: ${sandboxMissing()}`);
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-mw-env-local-")));
	far = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-mw-env-far-")));
	localFolder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-mw-env-folder-")));
	write(path.join(localFolder, "README.md"), "# Local Folder\n");
	dataDir = path.join(home, "desktop-data");
	browsers = path.join(home, "browsers");
	fs.mkdirSync(browsers, { recursive: true });

	const modelsJson = JSON.stringify({
		providers: {
			mock: {
				name: "Mock",
				baseUrl: mock.baseUrl,
				api: "openai-completions",
				apiKey: "sk-mock",
				models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
			},
		},
	});

	// Local home uses dark theme (default pmndre), has main + scout, and a local workspace media file.
	write(path.join(home, "models.json"), modelsJson);
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe", introduce: false, thinking: "off" }, security: { askAccess: false }, ui: { theme: "pmndre" } }, null, 2));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent on this computer.\n");
	write(path.join(home, "agents", "main", "workspace", "local-marker.png"), PNG_1X1);
	write(path.join(home, "agents", "scout", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "scout", "workspace", "AGENTS.md"), "Scout on this computer.\n");

	// Remote home uses light theme (github-light), has main + helper, and a remote workspace media file.
	write(path.join(far, "models.json"), modelsJson);
	write(path.join(far, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe", introduce: false, thinking: "off" }, security: { askAccess: false }, ui: { theme: "github-light" } }, null, 2));
	write(path.join(far, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(far, "agents", "main", "workspace", "AGENTS.md"), "The main agent on elsewhere.\n");
	write(path.join(far, "agents", "main", "workspace", "far-marker.png"), PNG_2X2);
	write(path.join(far, "agents", "helper", "agent.json"), JSON.stringify({}));
	write(path.join(far, "agents", "helper", "workspace", "AGENTS.md"), "Helper on elsewhere.\n");

	// Stand-in for ssh that runs `pine service --home <far>` behind a local control socket forward.
	sshPath = path.join(home, "ssh-stand-in.mjs");
	write(
		sshPath,
		`#!${process.execPath}
import { spawn } from "node:child_process";
import net from "node:net";
const args = process.argv.slice(2);
const opt = (name) => args.map((a, i) => args[i - 1] === "-o" && a.startsWith(name + "=") ? a.slice(name.length + 1) : undefined).find(Boolean);
const control = opt("ControlPath");
if (args.includes("-O")) {
	const c = net.connect(control);
	let reply = "";
	c.on("data", (d) => (reply += d));
	c.on("end", () => { if (reply.startsWith("ok")) process.exit(0); console.error("mux_client_forward: forwarding request failed: " + reply.slice(5).trim()); process.exit(255); });
	c.on("error", (e) => { console.error("Control socket connect: " + e.message); process.exit(255); });
	c.end(args[args.indexOf("-L") + 1] + "\\n");
} else {
	if (!/exec \\/bin\\/sh -c '.*pine service && exec cat/.test(args.at(-1) ?? "")) { console.error("not the command the app runs"); process.exit(2); }
	if (opt("ControlMaster") === "yes") net.createServer((c) => c.once("data", (d) => {
		const [, port, toHost, toPort] = String(d).trim().split(":");
		const server = net.createServer((s) => { const to = net.connect(Number(toPort), toHost); s.pipe(to).pipe(s); s.on("error", () => to.destroy()); to.on("error", () => s.destroy()); });
		server.once("error", () => c.end("fail Port forwarding failed"));
		server.listen(Number(port), "127.0.0.1", () => c.end("ok"));
	})).listen(control);
	const child = spawn(${JSON.stringify(process.execPath)}, [${JSON.stringify(path.resolve(root, "..", "bin", "pine.js"))}, "service", "--home", ${JSON.stringify(far)}], { stdio: "inherit", env: { ...process.env, PINE_SKIP_DOWNLOADS: "1" } });
	let running = true;
	let ending = false;
	process.on("SIGTERM", () => { ending = true; if (running) child.kill("SIGTERM"); else process.exit(0); });
	child.on("exit", (code) => { running = false; if (code || ending) process.exit(code ?? 0); });
	process.stdin.on("end", () => (running ? child.on("exit", () => process.exit(0)) : process.exit(0)));
	process.stdin.resume();
}
`,
	);
	fs.chmodSync(sshPath, 0o755);

	app = await launchApp({
		...process.env,
		PLAYWRIGHT_BROWSERS_PATH: browsers,
		PINE_HOME: home,
		PINE_DESKTOP_DATA: dataDir,
		PINE_SKIP_DOWNLOADS: "1",
		PINE_DESKTOP_DEV_URL: "",
		PINE_DESKTOP_RELEASES: "",
		PINE_DESKTOP_SSH: sshPath,
	});
	const win1 = await app.firstWindow();
	await dismissBrowserAsk(win1, true);
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	for (const dir of [home, far, localFolder]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test("simultaneous local and SSH windows: Open in new window, concurrent chat, per-window media, titles, environment pill, themes, and Forget flow", async () => {
	assert.ok(app, "app is running");
	const win1 = app.windows()[0];
	await win1.waitForSelector("[data-slot=tab][data-active]");

	// Reactive document.title on local window: "<tab> — Pine".
	assert.equal(await win1.title(), "main — Pine");

	// On local window with sidebar open, title bar environment pill is hidden.
	assert.equal(await win1.locator("[data-slot=window-environment]").count(), 0);

	// Open Settings > Environments and add you@elsewhere.
	await sendMenuTo(app, 0, "settings:environments");
	await win1.waitForSelector("[data-slot=settings-page] h1 >> text=Environments");
	assert.equal(await win1.title(), "Settings — Pine");

	const hostInput = win1.locator("[data-slot=settings-page] input[placeholder='you@server']");
	await hostInput.fill("you@elsewhere");
	await win1.locator("[data-slot=settings-page]").getByRole("button", { name: "Add", exact: true }).click();
	await win1.waitForSelector("[data-environment='you@elsewhere']");

	// Every row (including local/current and remote) has an "Open in new window" button.
	await win1.locator("[data-environment='local']").getByRole("button", { name: "Open in new window" }).waitFor();
	const openRemoteBtn = win1.locator("[data-environment='you@elsewhere']").getByRole("button", { name: "Open in new window" });
	await openRemoteBtn.waitFor();

	// Click "Open in new window" on you@elsewhere -> Window 2 opens on remote while Window 1 stays local.
	const win2 = await waitForWindow(app, () => openRemoteBtn.click());
	await win2.waitForFunction(() => [...document.querySelectorAll("[data-slot=agent-label] > :first-child")].map((e) => e.textContent?.trim()).join() === "main,helper", undefined, { timeout: 60_000 });
	assert.equal(await windowCount(app), 2);

	// Window 1 still shows local agents (main, scout) and now shows "in another window" badge on you@elsewhere.
	const localAgents = await win1.$$eval("[data-slot=agent-label] > :first-child", (els: Element[]) => els.map((e) => e.textContent?.trim()).join());
	assert.equal(localAgents, "main,scout");
	await win1.locator("[data-environment='you@elsewhere'] [data-slot=in-another-window]", { hasText: "in another window" }).waitFor({ timeout: 5000 });

	// Window 2 reactive title includes remote host: "<tab> — <host> — Pine".
	await win2.waitForSelector("[data-slot=tab][data-active]");
	assert.equal(await win2.title(), "main — elsewhere — Pine");

	// Window 2 (remote) shows clickable title bar environment pill even with sidebar open.
	const pill2 = win2.locator("[data-slot=window-environment]");
	await pill2.waitFor({ state: "visible" });
	assert.match((await pill2.textContent()) ?? "", /elsewhere/);
	await pill2.click();
	await win2.locator("[data-slot=dropdown-menu-radio-item][data-host='you@elsewhere']").waitFor();
	await win2.keyboard.press("Escape");

	// Collapsing sidebar on local Window 1 reveals the environment pill showing "This Mac"/"This computer".
	await clickMenu(app, ["View", "Toggle Sidebar"], 0);
	await win1.waitForSelector("#sidebar-panel [data-slot=sidebar]", { state: "detached" });
	const pill1 = win1.locator("[data-slot=window-environment]");
	await pill1.waitFor({ state: "visible" });
	assert.match((await pill1.textContent()) ?? "", new RegExp(`This ${HERE}`));
	// Restore sidebar on Window 1.
	await clickMenu(app, ["View", "Toggle Sidebar"], 0);
	await win1.waitForSelector("#sidebar-panel [data-slot=sidebar]");
	assert.equal(await win1.locator("[data-slot=window-environment]").count(), 0);

	// Per-window themes: Window 1 is dark (pmndre), Window 2 is light (github-light); focusing syncs nativeTheme.themeSource.
	await win2.waitForFunction(() => document.documentElement.classList.contains("light") || !document.documentElement.classList.contains("dark"), undefined, { timeout: 10_000 });
	assert.equal(await win1.evaluate(() => document.documentElement.classList.contains("dark")), true);
	await app.evaluate(({ BrowserWindow }: any) => {
		const wins = [...BrowserWindow.getAllWindows()].sort((a: any, b: any) => a.id - b.id);
		wins[1].emit("focus");
	});
	const themeOnWin2Focus = await app.evaluate(({ nativeTheme }: any) => nativeTheme.themeSource);
	assert.equal(themeOnWin2Focus, "light");
	await app.evaluate(({ BrowserWindow }: any) => {
		const wins = [...BrowserWindow.getAllWindows()].sort((a: any, b: any) => a.id - b.id);
		wins[0].emit("focus");
	});
	const themeOnWin1Focus = await app.evaluate(({ nativeTheme }: any) => nativeTheme.themeSource);
	assert.equal(themeOnWin1Focus, "dark");

	// Concurrent chat: switch Window 1 back to main tab, send a message in both windows simultaneously.
	await win1.locator("[data-slot=tab]", { hasText: /^main$/ }).first().click();
	await win1.waitForSelector("[data-slot=composer] textarea");
	await Promise.all([
		(async () => {
			await win1.fill("[data-slot=composer] textarea", "hello local side");
			await win1.keyboard.press("Enter");
		})(),
		(async () => {
			await win2.fill("[data-slot=composer] textarea", "hello remote side");
			await win2.keyboard.press("Enter");
		})(),
	]);
	await win1.waitForSelector("[data-slot=markdown] >> text=ECHO[hello local side]", { timeout: 20_000 });
	await win2.waitForSelector("[data-slot=markdown] >> text=ECHO[hello remote side]", { timeout: 20_000 });

	// Per-window pine-media: each window loads images from its own environment daemon via <img>.
	const loadImg = (p: Page, file: string) =>
		p.evaluate(
			(f: string) =>
				new Promise<{ ok: boolean; width: number }>((resolve) => {
					const img = new Image();
					img.onload = () => resolve({ ok: true, width: img.naturalWidth });
					img.onerror = () => resolve({ ok: false, width: 0 });
					img.src = `${(window as any).pine.mediaBase}/agents/main/image?path=${encodeURIComponent(f)}`;
				}),
			file,
		);
	assert.deepEqual(await loadImg(win1, "local-marker.png"), { ok: true, width: 1 });
	assert.deepEqual(await loadImg(win1, "far-marker.png"), { ok: false, width: 0 });
	assert.deepEqual(await loadImg(win2, "far-marker.png"), { ok: true, width: 2 });
	assert.deepEqual(await loadImg(win2, "local-marker.png"), { ok: false, width: 0 });

	// Global prefs broadcast: toggling notify in Window 1 updates Window 2's prefs live.
	const beforeNotify = await win2.evaluate(() => (window as any).pine.state().then((s: any) => s.prefs.notify));
	await win1.evaluate((v: boolean) => (window as any).pine.prefs({ notify: v }), !beforeNotify);
	await win2.waitForFunction((expected: boolean) => (window as any).pine.state().then((s: any) => s.prefs.notify === expected), !beforeNotify, { timeout: 5000 });

	// Forget confirmation dialog on host open in another window: Cancel keeps it, Confirm closes Window 2 and stops remote daemon.
	const farPort = daemonOf(far).port;
	await sendMenuTo(app, 0, "settings:environments");
	await win1.waitForSelector("[data-environment='you@elsewhere']");
	await win1.locator("[data-environment='you@elsewhere']").getByRole("button", { name: "Forget" }).click();
	await win1.locator("[role=alertdialog]").getByRole("button", { name: "Close the window and forget" }).waitFor();
	await win1.locator("[role=alertdialog]").getByRole("button", { name: "Cancel" }).click();
	assert.equal(await windowCount(app), 2);
	assert.equal(await win1.locator("[data-environment='you@elsewhere']").count(), 1);

	await win1.locator("[data-environment='you@elsewhere']").getByRole("button", { name: "Forget" }).click();
	await win1.locator("[role=alertdialog]").getByRole("button", { name: "Close the window and forget" }).click();
	await waitForWindowCount(app, 1);
	await win1.locator("[data-environment='you@elsewhere']").waitFor({ state: "detached" });
	assert.equal(await daemonGone(farPort, far), true);
});

test("machine menu opens environment in new window and local OS open-file spawns a local window when only SSH window is open", async () => {
	assert.ok(app, "app is running");
	const win1 = app.windows()[0];

	// Re-add you@elsewhere and switch Window 1 to it so ONLY a remote window is open.
	await sendMenuTo(app, 0, "settings:environments");
	await win1.waitForSelector("[data-slot=settings-page] input[placeholder='you@server']");
	await win1.fill("[data-slot=settings-page] input[placeholder='you@server']", "you@elsewhere");
	await win1.locator("[data-slot=settings-page]").getByRole("button", { name: "Add", exact: true }).click();
	await win1.waitForSelector("[data-environment='you@elsewhere']");

	// Open the sidebar machine menu and use the per-row "Open in new window" button on you@elsewhere.
	await win1.click("[data-slot=service-status]");
	const openNewBtn = win1.locator("[data-slot=dropdown-menu-content] [data-slot=open-in-new-window][data-host='you@elsewhere']");
	await openNewBtn.waitFor({ state: "visible" });
	const win2 = await waitForWindow(app, () => openNewBtn.click());
	await win2.waitForFunction(() => [...document.querySelectorAll("[data-slot=agent-label] > :first-child")].map((e) => e.textContent?.trim()).join() === "main,helper", undefined, { timeout: 60_000 });
	assert.equal(await windowCount(app), 2);

	// Close Window 1 (local), leaving ONLY Window 2 (remote SSH) open.
	await clickMenu(app, ["File", "Close Window"], 0);
	await waitForWindowCount(app, 1);

	// Trigger OS open-file with localFolder while only the SSH window is open -> must spawn a new local window!
	const winLocal = await waitForWindow(app, () =>
		app!.evaluate(({ app: electronApp }: any, dir: string) => {
			electronApp.emit("open-file", { preventDefault() {} }, dir);
		}, localFolder),
	);
	await winLocal.waitForSelector("[data-slot=tab][data-active]", { timeout: 25_000 });
	assert.equal(await windowCount(app), 2);
	// New window is on local computer (main, scout) and opened the folder.
	await winLocal.waitForFunction(() => [...document.querySelectorAll("[data-slot=agent-label] > :first-child")].map((e) => e.textContent?.trim()).includes("scout"), undefined, { timeout: 20_000 });
	assert.match(await winLocal.title(), /Pine$/);
	assert.doesNotMatch(await winLocal.title(), /elsewhere/);
});
