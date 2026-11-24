// Multiple windows across environments: opening environments in new windows from Settings and the
// side bar, conversing simultaneously with this computer's pine and an SSH machine's pine, dynamic
// window titles and title bar environment pills, independent window themes, Forget confirmation
// when a machine is open in another window, local OS routing, and live preference broadcasts.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { mockMsg, startMock } from "../../baseline/tests/mock.mjs";
import { clickMenuItem, focusWindow, launchApp, openNewWindow, waitClosed, windowTitle } from "./support/app.ts";
import { daemonGone } from "./support/daemon.ts";

const root = path.resolve(import.meta.dirname, "..");

let app: ElectronApplication;
let page: Page;
let mock: any;
let home: string;
let home2: string;
let far: string;
let localFolder: string;
let localFolder2: string;

const write = (file: string, content: string | Buffer) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

const daemonOf = (dir: string) => ({
	port: [...fs.readFileSync(path.join(dir, "data", "pine.log"), "utf8").matchAll(/http listening on 127\.0\.0\.1:(\d+)/g)].at(-1)![1],
	token: fs.readFileSync(path.join(dir, "data", "http-token"), "utf8").trim(),
});

function initGitFolder(prefix: string, name: string): string {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
	write(path.join(dir, "README.md"), `# ${name}\n`);
	const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { stdio: "ignore" });
	git("init", "-q");
	git("add", ".");
	git("commit", "-q", "-m", "init");
	return dir;
}

before(async () => {
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
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

	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-win-env-home-")));
	write(path.join(home, "models.json"), modelsJson);
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe", introduce: false, thinking: "off" }, security: { askAccess: false }, ui: { theme: "github-light" } }, null, 2));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ delegates: ["scout"] }));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent on this computer.\n\nYou are the main agent.\n");
	write(path.join(home, "agents", "scout", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "scout", "workspace", "AGENTS.md"), "Looks things up on this computer.\n\nYou are scout.\n");

	home2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-win-env-home2-")));
	write(path.join(home2, "models.json"), modelsJson);
	write(path.join(home2, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe", introduce: false, thinking: "off" }, security: { askAccess: false } }, null, 2));
	write(path.join(home2, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home2, "agents", "main", "workspace", "AGENTS.md"), "The main agent of the second local home.\n\nYou are main.\n");
	write(path.join(home2, "agents", "archivist", "agent.json"), JSON.stringify({}));
	write(path.join(home2, "agents", "archivist", "workspace", "AGENTS.md"), "Keeps archives.\n\nYou are archivist.\n");

	far = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-win-env-far-")));
	write(path.join(far, "models.json"), modelsJson);
	write(path.join(far, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe", introduce: false, thinking: "off" }, security: { askAccess: false }, ui: { theme: "dracula" } }, null, 2));
	write(path.join(far, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(far, "agents", "main", "workspace", "AGENTS.md"), "The main agent of the remote machine.\n\nYou are main there.\n");
	write(path.join(far, "agents", "helper", "agent.json"), JSON.stringify({}));
	write(path.join(far, "agents", "helper", "workspace", "AGENTS.md"), "Helps on the remote machine.\n\nYou are helper.\n");

	localFolder = initGitFolder("pine-win-env-dir1-", "Alpha");
	localFolder2 = initGitFolder("pine-win-env-dir2-", "Beta");

	const ssh = path.join(home, "ssh-stand-in.mjs");
	write(
		ssh,
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
	fs.chmodSync(ssh, 0o755);

	const browsers = path.join(home, "browsers");
	fs.mkdirSync(browsers, { recursive: true });
	const data = path.join(home, "desktop-data");
	write(path.join(data, "prefs.json"), JSON.stringify({ updates: false, access: { service: "https://pine.example.invalid" } }));

	app = await launchApp({
		...process.env,
		PLAYWRIGHT_BROWSERS_PATH: browsers,
		PINE_HOME: home,
		PINE_DESKTOP_DATA: data,
		PINE_SKIP_DOWNLOADS: "1",
		PINE_DESKTOP_DEV_URL: "",
		PINE_DESKTOP_RELEASES: "",
		PINE_DESKTOP_SSH: ssh,
		PINE_DESKTOP_ACCESS_STAND_IN: "60000",
	});
	page = await app.firstWindow();
	await page.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
	await page.waitForSelector("[data-slot=dialog-content]", { timeout: 20_000 });
	await page.locator("[data-slot=dialog-footer] button").first().click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	for (const dir of [home, home2, far, localFolder, localFolder2]) {
		if (dir) fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("Settings > Environments and the side bar machine menu open environments directly in new windows while regular selection switches only the current window, and two windows converse simultaneously with local and SSH daemons", async () => {
	await focusWindow(app, page);
	await page.evaluate(() => (window as any).pine.addHost("you@elsewhere"));

	// Open Settings > Environments in Window 1 and verify Open in new window is offered on every row.
	await clickMenuItem(app, "Pine", "Settings…").catch(() => clickMenuItem(app, "File", "Settings…"));
	await page.waitForSelector("[data-slot=settings-page]", { timeout: 20_000 });
	await page.locator('[role="navigation"] [data-slot="sidebar-menu-button"]').nth(6).click();
	await page.waitForSelector('[data-environment="you@elsewhere"]', { timeout: 20_000 });

	assert.equal(await page.locator('[data-environment="local"] [data-slot="open-in-new-window"]').count(), 1);
	assert.equal(await page.locator('[data-environment="you@elsewhere"] [data-slot="open-in-new-window"]').count(), 1);

	// Open you@elsewhere in Window 2 via Settings > Environments: since no window views it yet, it restores that daemon's saved tabs (main).
	const win2 = await openNewWindow(app, () => page.locator('[data-environment="you@elsewhere"] [data-slot="open-in-new-window"]').click());
	await win2.waitForSelector("[data-slot=room]", { timeout: 60_000 });
	assert.equal(await win2.locator("[data-slot=tab]").count(), 1);
	assert.equal(await win2.locator("[data-slot=no-tab]").count(), 0);
	assert.equal(await page.evaluate(() => (window as any).pine.state().then((s: any) => s.state.host ?? null)), null);
	assert.equal(await win2.evaluate(() => (window as any).pine.state().then((s: any) => s.state.host ?? null)), "you@elsewhere");

	// Close Settings tab in Window 1 so Window 1 is on local main:main.
	await focusWindow(app, page);
	await clickMenuItem(app, "File", "Close Tab");
	await page.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 1);

	// Side bar machine menu: secondary action opens you@elsewhere in Window 3 on NoTab (since Window 2 already views it), leaving Window 1 on local.
	await page.click("[data-slot=service-status]");
	await page.waitForSelector('[data-slot="open-machine-window"][data-host="you@elsewhere"]');
	const win3 = await openNewWindow(app, () => page.click('[data-slot="open-machine-window"][data-host="you@elsewhere"]'));
	await win3.waitForSelector("[data-slot=no-tab]", { timeout: 60_000 });
	assert.equal(await page.evaluate(() => (window as any).pine.state().then((s: any) => s.state.host ?? null)), null);

	// Modifier-click (Meta/Control) on a machine radio item also opens in a new window without switching the caller.
	await page.click("[data-slot=service-status]");
	await page.waitForSelector('[data-slot=dropdown-menu-radio-item][data-host="you@elsewhere"]');
	const mod = process.platform === "darwin" ? "Meta" : "Control";
	const win4 = await openNewWindow(app, () => page.click('[data-slot=dropdown-menu-radio-item][data-host="you@elsewhere"]', { modifiers: [mod] }));
	await win4.waitForSelector("[data-slot=no-tab]", { timeout: 60_000 });
	assert.equal(await page.evaluate(() => (window as any).pine.state().then((s: any) => s.state.host ?? null)), null);

	// Regular selection in win3 switches only win3 to this computer, leaving win2 on you@elsewhere.
	await win3.click("[data-slot=service-status]");
	await win3.waitForSelector("[data-slot=dropdown-menu-radio-item]:not([data-host])");
	await win3.click("[data-slot=dropdown-menu-radio-item]:not([data-host])");
	await win3.waitForFunction(() => (window as any).pine.state().then((s: any) => !s.state.host && s.state.status === "ready"));
	assert.equal(await win2.evaluate(() => (window as any).pine.state().then((s: any) => s.state.host)), "you@elsewhere");

	for (const extra of [win3, win4]) {
		await focusWindow(app, extra);
		await clickMenuItem(app, "File", "Close Window");
		await waitClosed(extra);
	}

	// Converse simultaneously in Window 1 (local) and Window 2 (SSH) and load pine-media: assets from each daemon.
	const onePxPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
	write(path.join(home, "agents", "main", "workspace", "here.png"), onePxPng);
	write(path.join(far, "agents", "main", "workspace", "there.png"), onePxPng);

	await Promise.all([
		(async () => {
			await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "Local reply ![here](here.png)" }], "ping local "));
			await page.keyboard.press("Enter");
		})(),
		(async () => {
			await win2.fill("[data-slot=composer] textarea", mockMsg([{ text: "Remote reply ![there](there.png)" }], "ping remote "));
			await win2.keyboard.press("Enter");
		})(),
	]);

	await page.waitForFunction(() => {
		const img = document.querySelector('img[alt="here"]') as HTMLImageElement | null;
		return Boolean(img && img.complete && img.naturalWidth === 1);
	});
	await win2.waitForFunction(() => {
		const img = document.querySelector('img[alt="there"]') as HTMLImageElement | null;
		return Boolean(img && img.complete && img.naturalWidth === 1);
	});

	const localTasks = (await (await fetch(`http://127.0.0.1:${daemonOf(home).port}/tasks?agent=main&limit=20`, { headers: { authorization: `Bearer ${daemonOf(home).token}` } })).json()) as Array<{ prompt: string }>;
	const farTasks = (await (await fetch(`http://127.0.0.1:${daemonOf(far).port}/tasks?agent=main&limit=20`, { headers: { authorization: `Bearer ${daemonOf(far).token}` } })).json()) as Array<{ prompt: string }>;
	assert.equal(localTasks.some((t) => t.prompt.startsWith("ping local ")), true);
	assert.equal(localTasks.some((t) => t.prompt.startsWith("ping remote ")), false);
	assert.equal(farTasks.some((t) => t.prompt.startsWith("ping remote ")), true);
	assert.equal(farTasks.some((t) => t.prompt.startsWith("ping local ")), false);

	// Keep win2 open for the next tests? No, keep tests independent or clean up cleanly: let's close win2 and forget host at end of test.
	await focusWindow(app, win2);
	await clickMenuItem(app, "File", "Close Window");
	await waitClosed(win2);
	await page.evaluate(() => (window as any).pine.forgetHost("you@elsewhere"));
});

test("each window sets a dynamic OS title, renders a clickable title bar environment pill when remote or when the side bar is hidden, and applies its own theme with native OS appearance following focus", async () => {
	await focusWindow(app, page);
	await page.evaluate(() => (window as any).pine.addHost("you@elsewhere"));

	// Window 1 on local computer with side bar visible: title names active tab ("main — Pine"), no title bar environment pill.
	await page.waitForFunction(() => document.title === "main — Pine", undefined, { timeout: 5000 });
	assert.equal(await windowTitle(app, page), "main — Pine");
	assert.equal(await page.locator('header [data-slot="window-environment"]').count(), 0);

	// Hide side bar in Window 1: title bar environment pill appears naming this computer and opens the machine dropdown.
	await clickMenuItem(app, "View", "Toggle Sidebar");
	await page.waitForSelector("#sidebar-panel", { state: "detached" });
	const localPill = page.locator('header [data-slot="window-environment"]');
	await localPill.waitFor();
	const expectedHere = process.platform === "darwin" ? "This Mac" : "This computer";
	assert.equal((await localPill.textContent())?.trim(), expectedHere);
	assert.equal(await localPill.evaluate((el) => getComputedStyle(el).getPropertyValue("-webkit-app-region")), "no-drag");

	// Open you@elsewhere in Window 2 directly from Window 1's title bar environment pill!
	await localPill.click();
	await page.waitForSelector('[data-slot="open-machine-window"][data-host="you@elsewhere"]');
	const win2 = await openNewWindow(app, () => page.click('[data-slot="open-machine-window"][data-host="you@elsewhere"]'));
	await win2.waitForSelector("[data-slot=room]", { timeout: 60_000 });

	// Show side bar again in Window 1: local pill hides.
	await focusWindow(app, page);
	await clickMenuItem(app, "View", "Toggle Sidebar");
	await page.waitForSelector("#sidebar-panel");
	assert.equal(await page.locator('header [data-slot="window-environment"]').count(), 0);

	// Window 2 is on remote SSH machine with side bar visible: pill stays visible naming "elsewhere", and OS title includes remote name.
	const remotePill = win2.locator('header [data-slot="window-environment"]');
	await remotePill.waitFor();
	assert.equal((await remotePill.textContent())?.trim(), "elsewhere");
	await win2.waitForFunction(() => document.title === "main — elsewhere — Pine", undefined, { timeout: 5000 });
	assert.equal(await windowTitle(app, win2), "main — elsewhere — Pine");

	// Open helper tab in Window 2 -> OS title updates to "helper — elsewhere — Pine".
	await win2.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { has: win2.locator("[data-slot=agent-label] > :first-child", { hasText: /^helper$/ }) }).locator("[data-slot=agent-label]").click();
	await win2.waitForFunction(() => document.title === "helper — elsewhere — Pine", undefined, { timeout: 5000 });
	assert.equal(await windowTitle(app, win2), "helper — elsewhere — Pine");

	// Close both tabs in Window 2 -> NoTab on remote has title "elsewhere — Pine".
	await focusWindow(app, win2);
	await clickMenuItem(app, "File", "Close Tab");
	await clickMenuItem(app, "File", "Close Tab");
	await win2.waitForSelector("[data-slot=no-tab]");
	await win2.waitForFunction(() => document.title === "elsewhere — Pine", undefined, { timeout: 5000 });
	assert.equal(await windowTitle(app, win2), "elsewhere — Pine");

	// Independent color themes: Window 1 uses github-light (light), Window 2 uses dracula (dark), and nativeTheme follows focus.
	await page.waitForFunction(() => document.documentElement.dataset.theme === "github-light");
	await win2.waitForFunction(() => document.documentElement.dataset.theme === "dracula");
	assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), false);
	assert.equal(await win2.evaluate(() => document.documentElement.classList.contains("dark")), true);
	assert.equal(await page.evaluate(() => (window as any).pine.state().then((s: any) => s.prefs.look?.id)), "github-light");
	assert.equal(await win2.evaluate(() => (window as any).pine.state().then((s: any) => s.prefs.look?.id)), "dracula");

	await focusWindow(app, page);
	assert.equal(await app.evaluate(({ nativeTheme }: any) => nativeTheme.themeSource), "light");

	await focusWindow(app, win2);
	assert.equal(await app.evaluate(({ nativeTheme }: any) => nativeTheme.themeSource), "dark");

	await clickMenuItem(app, "File", "Close Window");
	await waitClosed(win2);
	await focusWindow(app, page);
	await page.evaluate(() => (window as any).pine.forgetHost("you@elsewhere"));
});

test("Settings > Environments marks an SSH host open in another window and asks confirmation before closing its windows and forgetting it", async () => {
	await focusWindow(app, page);
	await page.evaluate(() => (window as any).pine.addHost("you@elsewhere"));

	await clickMenuItem(app, "Pine", "Settings…").catch(() => clickMenuItem(app, "File", "Settings…"));
	await page.waitForSelector("[data-slot=settings-page]", { timeout: 20_000 });
	await page.locator('[role="navigation"] [data-slot="sidebar-menu-button"]').nth(6).click();
	const row = page.locator('[data-environment="you@elsewhere"]');
	await row.waitFor();

	// Not open in any other window yet: no "in another window" badge.
	assert.equal(await row.locator('[data-slot="in-another-window"]').count(), 0);

	// Open you@elsewhere in Window 2, plus a second local window (localWin2) to verify live prefs broadcast on forget.
	const remoteWin = await openNewWindow(app, () => row.locator('[data-slot="open-in-new-window"]').click());
	await remoteWin.waitForSelector("[data-slot=room]", { timeout: 60_000 });
	const farPort = daemonOf(far).port;

	const localWin2 = await openNewWindow(app, () => page.locator('[data-environment="local"] [data-slot="open-in-new-window"]').click());
	await localWin2.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });

	// Window 1's Settings > Environments now shows the "in another window" badge on you@elsewhere.
	await row.locator('[data-slot="in-another-window"]').waitFor();

	// Clicking Forget opens a confirmation dialog; cancelling keeps the remote window and host intact.
	await focusWindow(app, page);
	await row.locator('[data-slot="forget-machine"]').click();
	const dialog = page.locator("[role=alertdialog]");
	await dialog.waitFor();
	assert.match((await dialog.locator('[data-slot="command-item"][data-value="forget"]').textContent()) ?? "", /Close its window and forget/);
	await dialog.locator('[data-slot="command-item"][data-value="no"]').click();
	await dialog.waitFor({ state: "detached" });
	assert.equal(remoteWin.isClosed(), false);
	assert.deepEqual((await page.evaluate(() => (window as any).pine.state())).prefs.hosts, ["you@elsewhere"]);

	// Clicking Forget again and confirming closes remoteWin, stops the SSH daemon, and updates all remaining windows.
	await row.locator('[data-slot="forget-machine"]').click();
	await dialog.waitFor();
	await dialog.locator('[data-slot="command-item"][data-value="forget"]').click();
	await waitClosed(remoteWin);
	await row.waitFor({ state: "detached" });

	assert.equal(await daemonGone(farPort, far), true);
	assert.deepEqual((await page.evaluate(() => (window as any).pine.state())).prefs.hosts, []);
	assert.deepEqual((await page.evaluate(() => (window as any).pine.state())).openHosts, []);
	await localWin2.waitForFunction(() => (window as any).pine.state().then((s: any) => s.prefs.hosts.length === 0));

	const localWin3 = await openNewWindow(app, () => clickMenuItem(app, "File", "New Window"));
	await localWin3.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });
	await localWin3.waitForFunction(() => (window as any).pine.state().then((s: any) => !s.state.host && s.state.status === "ready"), undefined, { timeout: 20_000 });
	assert.equal(await localWin3.evaluate(() => (window as any).pine.state().then((s: any) => s.state.host ?? null)), null);
	await focusWindow(app, localWin3);
	await clickMenuItem(app, "File", "Close Window");
	await waitClosed(localWin3);

	await focusWindow(app, localWin2);
	await clickMenuItem(app, "File", "Close Window");
	await waitClosed(localWin2);
	await focusWindow(app, page);
	await clickMenuItem(app, "File", "Close Tab");
	await page.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 1);
});

test("local OS actions (open-file, second-instance folder, pine://pair, Add a Device) route to an existing local window or open a new local window when only remote or zero windows are open", async () => {
	await focusWindow(app, page);
	await page.evaluate(() => (window as any).pine.addHost("you@elsewhere"));

	// Switch the single open window (page) to the remote SSH machine so zero local windows are open.
	await page.evaluate(() => (window as any).pine.use("you@elsewhere"));
	await page.waitForFunction(() => (window as any).pine.state().then((s: any) => s.state.host === "you@elsewhere" && s.state.status === "ready"), undefined, { timeout: 60_000 });
	await page.waitForSelector("[data-slot=room]", { timeout: 60_000 });
	assert.equal(app.windows().length, 1);

	// 1. OS open-file with a local folder while only the SSH window is open spawns a new local window and opens the folder there.
	const localWin1 = await openNewWindow(app, () =>
		app.evaluate(({ app: eApp }: any, dir: string) => eApp.emit("open-file", { preventDefault() {} }, dir), localFolder),
	);
	await localWin1.waitForSelector("[role=dialog]", { timeout: 20_000 });
	assert.equal(await localWin1.evaluate(() => (window as any).pine.state().then((s: any) => s.state.host ?? null)), null);
	assert.equal(await page.evaluate(() => (window as any).pine.state().then((s: any) => s.state.host)), "you@elsewhere");
	await localWin1.locator('[role=dialog] [data-slot="command-item"][data-value="main"]').click();
	await localWin1.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 2, undefined, { timeout: 20_000 });

	// 2. While both remote (focused) and localWin1 exist, second-instance with another local folder routes to existing localWin1 without opening a third window!
	await focusWindow(app, page);
	await app.evaluate(({ app: eApp }: any, dir: string) => eApp.emit("second-instance", {}, ["Pine", dir]), localFolder2);
	await localWin1.waitForSelector("[role=dialog]", { timeout: 20_000 });
	assert.equal(app.windows().length, 2);
	await localWin1.locator('[role=dialog] [data-slot="command-item"][data-value="main"]').click();
	await localWin1.waitForFunction(() => document.querySelectorAll("[data-slot=tab]").length === 3, undefined, { timeout: 20_000 });

	// Close localWin1 so again ONLY the remote SSH window is open; enable Browser access.
	await focusWindow(app, localWin1);
	await clickMenuItem(app, "File", "Close Window");
	await waitClosed(localWin1);
	assert.equal(app.windows().length, 1);

	await page.evaluate(() => (window as any).pine.setAccess({ enabled: true }));
	await page.waitForFunction(() => (window as any).pine.access().then((a: any) => a.status === "waiting"), undefined, { timeout: 15_000 });

	// 3. pine://pair while only the remote SSH window is open spawns a new local window showing the pairing QR dialog!
	const localWin2 = await openNewWindow(app, () =>
		app.evaluate(({ app: eApp }: any) => eApp.emit("open-url", { preventDefault() {} }, "pine://pair")),
	);
	await localWin2.waitForSelector("[data-slot=pairing-dialog] [data-slot=qr-code]", { timeout: 20_000 });
	assert.equal(await localWin2.evaluate(() => (window as any).pine.state().then((s: any) => s.state.host ?? null)), null);
	assert.equal(await page.locator("[data-slot=pairing-dialog]").count(), 0);

	await localWin2.keyboard.press("Escape");
	await localWin2.waitForSelector("[data-slot=pairing-dialog]", { state: "detached" });
	await localWin2.waitForFunction(() => (window as any).pine.access().then((a: any) => !a.pairing));
	await focusWindow(app, localWin2);
	await clickMenuItem(app, "File", "Close Window");
	await waitClosed(localWin2);

	// 4. Dock / menu "Add a Device…" while only the remote SSH window (or zero windows on macOS) is open opens a new local window with the pairing dialog!
	const localWin3 = await openNewWindow(app, async () => {
		if (process.platform === "darwin") {
			await app.evaluate(({ app: eApp }: any) => {
				const item = eApp.dock?.getMenu?.()?.items.find((i: any) => i.label === "Add a Device…");
				if (!item) throw new Error("Dock Add a Device… not found");
				item.click(item, undefined, {});
			});
		} else {
			await clickMenuItem(app, "File", "Add a Device…");
		}
	});
	await localWin3.waitForSelector("[data-slot=pairing-dialog] [data-slot=qr-code]", { timeout: 20_000 });
	assert.equal(await localWin3.evaluate(() => (window as any).pine.state().then((s: any) => s.state.host ?? null)), null);

	await localWin3.keyboard.press("Escape");
	await localWin3.waitForSelector("[data-slot=pairing-dialog]", { state: "detached" });
	await page.evaluate(() => (window as any).pine.setAccess({ enabled: false }));

	// Restore page back to local computer and close localWin3 for the next test.
	await focusWindow(app, localWin3);
	await clickMenuItem(app, "File", "Close Window");
	await waitClosed(localWin3);
	await focusWindow(app, page);
	await page.evaluate(() => (window as any).pine.use(undefined));
	await page.waitForFunction(() => (window as any).pine.state().then((s: any) => !s.state.host && s.state.status === "ready"), undefined, { timeout: 20_000 });
	await page.waitForSelector("[data-slot=room]", { timeout: 20_000 });
	await page.evaluate(() => (window as any).pine.forgetHost("you@elsewhere"));
});

test("global preference changes broadcast live to all open windows, and changing local home reconnects every open local window without disturbing remote windows", async () => {
	await focusWindow(app, page);
	await page.evaluate(() => (window as any).pine.addHost("you@elsewhere"));

	// Open a second local window (localWin2) and a remote SSH window (remoteWin).
	const localWin2 = await openNewWindow(app, () => clickMenuItem(app, "File", "New Window"));
	await localWin2.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });

	const remoteWin = await openNewWindow(app, () => page.evaluate(() => (window as any).pine.newWindow({ host: "you@elsewhere" })));
	await remoteWin.waitForSelector("[data-slot=room]", { timeout: 60_000 });

	// Watch onAccess in localWin2 and remoteWin, then toggle Browser access and global prefs in Window 1.
	for (const w of [localWin2, remoteWin]) {
		await w.evaluate(() => {
			(window as any).__accessSeen = [];
			(window as any).pine.onAccess((s: unknown) => (window as any).__accessSeen.push(s));
		});
	}
	await page.evaluate(() => (window as any).pine.setAccess({ enabled: true }));
	for (const w of [localWin2, remoteWin]) {
		await w.waitForFunction(() => (window as any).__accessSeen.some((s: any) => s.enabled === true));
	}
	await page.evaluate(() => (window as any).pine.setAccess({ enabled: false }));

	await page.evaluate(() => (window as any).pine.prefs({ notify: false }));
	await localWin2.waitForFunction(() => (window as any).pine.state().then((s: any) => s.prefs.notify === false));
	await remoteWin.waitForFunction(() => (window as any).pine.state().then((s: any) => s.prefs.notify === false));

	// Change local home to home2: old local daemon stops, BOTH page and localWin2 reconnect to home2 (showing archivist, not scout), while remoteWin stays on you@elsewhere!
	const home1Port = daemonOf(home).port;
	await page.evaluate((nextHome: string) => (window as any).pine.prefs({ home: nextHome }), home2);

	for (const lw of [page, localWin2]) {
		await lw.waitForFunction(
			() => [...document.querySelectorAll("[data-slot=agent-label] > :first-child")].map((e) => e.textContent?.trim()).join() === "main,archivist",
			undefined,
			{ timeout: 30_000 },
		);
	}
	assert.equal(await daemonGone(home1Port, home), true);
	assert.equal(await remoteWin.evaluate(() => (window as any).pine.state().then((s: any) => s.state.host)), "you@elsewhere");

	// Switch back to original home via prefs({ home: "" }) and clean up extra windows.
	await page.evaluate(() => (window as any).pine.prefs({ home: "", notify: true }));
	for (const lw of [page, localWin2]) {
		await lw.waitForFunction(
			() => [...document.querySelectorAll("[data-slot=agent-label] > :first-child")].map((e) => e.textContent?.trim()).includes("scout"),
			undefined,
			{ timeout: 30_000 },
		);
	}

	for (const w of [remoteWin, localWin2]) {
		await focusWindow(app, w);
		await clickMenuItem(app, "File", "Close Window");
		await waitClosed(w);
	}
	await focusWindow(app, page);
	await page.evaluate(() => (window as any).pine.forgetHost("you@elsewhere"));
});
