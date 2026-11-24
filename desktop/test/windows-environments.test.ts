// Multi-environment desktop e2e tests: concurrent local + SSH windows, dynamic titles,
// title bar environment pill, Settings > Environments multi-window actions & Forget confirmation,
// per-window pine-media:, theme & nativeTheme focus sync, global prefs broadcast, and local folder OS routing.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { mockMsg, startMock } from "../../baseline/tests/mock.mjs";
import { launchApp } from "./support/app.ts";

let app: any;
let page: any;
let mock: any;
let home: string;
let home2: string;
let far: string;
let folder: string;
let dataDir: string;
const pageErrors: string[] = [];

const root = path.resolve(import.meta.dirname, "..");

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

async function sees(p: any, selector: string, timeout = 20_000): Promise<void> {
	try {
		await p.waitForSelector(selector, { timeout });
	} catch {
		const there = await p.evaluate(() => ({
			title: document.title,
			text: (document.querySelector("[data-slot=message-scroller-content], [data-slot=settings-page], [data-slot=empty], [data-slot=no-tab]") as HTMLElement | null)?.innerText?.slice(-1000),
			toasts: [...document.querySelectorAll("[data-slot=toast]")].map((t) => t.textContent),
		}));
		throw new Error(`"${selector}" did not appear. On screen: ${JSON.stringify(there)}${pageErrors.length ? `\nErrors:\n${pageErrors.join("\n")}` : ""}`);
	}
}

function attachErrorListeners(p: any): void {
	p.on("pageerror", (e: Error) => pageErrors.push(String(e.stack ?? e.message).slice(0, 600)));
	p.on("console", (m: any) => m.type() === "error" && pageErrors.push(m.text().slice(0, 600)));
}

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");

function makeHome(dir: string, mockBaseUrl: string, opts: { theme?: string; agentLabel: string; mediaFile: string }) {
	write(
		path.join(dir, "models.json"),
		JSON.stringify({
			providers: {
				mock: {
					name: "Mock",
					baseUrl: mockBaseUrl,
					api: "openai-completions",
					apiKey: "sk-mock",
					models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
				},
			},
		}),
	);
	write(
		path.join(dir, "pine.json"),
		JSON.stringify(
			{
				http: { host: "127.0.0.1", port: 0 },
				main: "main",
				defaults: { model: "mock/m", mode: "safe" },
				security: { askAccess: false },
				...(opts.theme ? { ui: { theme: opts.theme } } : {}),
			},
			null,
			2,
		),
	);
	write(path.join(dir, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(dir, "agents", "main", "workspace", "AGENTS.md"), `${opts.agentLabel}\n`);
	fs.writeFileSync(path.join(dir, "agents", "main", "workspace", opts.mediaFile), PNG_1X1);
}

before(async () => {
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-win-env-local-")));
	home2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-win-env-local2-")));
	far = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-win-env-far-")));
	folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-dir-")));
	dataDir = path.join(home, "desktop-data");

	makeHome(home, mock.baseUrl, { theme: "pmndre", agentLabel: "Local main agent.", mediaFile: "local-only.png" });
	makeHome(home2, mock.baseUrl, { theme: "pmndre", agentLabel: "Second local home main agent.", mediaFile: "local2-only.png" });
	makeHome(far, mock.baseUrl, { theme: "github-light", agentLabel: "Remote main agent on elsewhere.", mediaFile: "remote-only.png" });

	// Fake SSH script spinning up a second local `pine service --home <far>` with real port forwarding.
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

	app = await launchApp({
		...process.env,
		PINE_HOME: home,
		PINE_DESKTOP_DATA: dataDir,
		PINE_SKIP_DOWNLOADS: "1",
		PINE_DESKTOP_DEV_URL: "",
		PINE_DESKTOP_RELEASES: "",
		PINE_DESKTOP_SSH: ssh,
	});
	page = await app.firstWindow();
	attachErrorListeners(page);
	await sees(page, "[data-slot=composer]");
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	for (const dir of [home, home2, far, folder]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
	assert.deepEqual(pageErrors, [], "unexpected renderer errors");
});

test("dynamic window titles, concurrent local + SSH messaging, and per-window pine-media: isolation", async () => {
	// Local window title reflects active tab
	await page.waitForFunction(() => document.title === "main — Pine", null, { timeout: 10_000 });

	// Open Settings > Environments and add SSH host `you@elsewhere`
	await app.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", "settings:environments"));
	await sees(page, "[data-environment=local]");
	await page.waitForFunction(() => document.title === "Settings — Pine", null, { timeout: 10_000 });

	await page.fill("input[placeholder='you@server']", "you@elsewhere");
	await page.getByRole("button", { name: "Add" }).click();
	await sees(page, "[data-environment='you@elsewhere']");

	// Every row (including current local row) has an `Open in new window` button
	assert.equal(await page.locator("[data-environment=local]").getByRole("button", { name: "Open in new window" }).count(), 1);
	assert.equal(await page.locator("[data-environment='you@elsewhere']").getByRole("button", { name: "Open in new window" }).count(), 1);

	// Open `you@elsewhere` in a new window
	const nextWinPromise = app.waitForEvent("window");
	await page.locator("[data-environment='you@elsewhere']").getByRole("button", { name: "Open in new window" }).click();
	const remotePage = await nextWinPromise;
	attachErrorListeners(remotePage);
	await sees(remotePage, "[data-slot=composer]");

	// Remote window title reflects active tab and machine label
	await remotePage.waitForFunction(() => document.title === "main — elsewhere — Pine", null, { timeout: 10_000 });

	// Switch local window back to main chat tab
	await page.locator("[data-slot=tab]", { hasText: "main" }).first().click();
	await sees(page, "[data-slot=composer]");
	await page.waitForFunction(() => document.title === "main — Pine", null, { timeout: 10_000 });

	// Send concurrent messages in local and remote windows
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: "local-reply-ok" }], "hello local "));
	await page.keyboard.press("Enter");
	await remotePage.fill("[data-slot=composer] textarea", mockMsg([{ text: "remote-reply-ok" }], "hello remote "));
	await remotePage.keyboard.press("Enter");

	await sees(page, "[data-slot=markdown]:has-text('local-reply-ok')");
	await sees(remotePage, "[data-slot=markdown]:has-text('remote-reply-ok')");

	// Per-window pine-media: loads each daemon's own files and not the other's
	const probeImg = (p: any, ownFile: string, otherFile: string) =>
		p.evaluate(
			([own, other]: [string, string]) => {
				const base = (window as any).pine.mediaBase;
				const load = (file: string) =>
					new Promise<boolean>((resolve) => {
						const img = new Image();
						img.onload = () => resolve(img.naturalWidth > 0);
						img.onerror = () => resolve(false);
						img.src = `${base}/agents/main/image?path=${encodeURIComponent(file)}`;
					});
				return Promise.all([load(own), load(other)]).then(([ownOk, otherOk]) => ({ base, ownOk, otherOk }));
			},
			[ownFile, otherFile],
		);
	const localMedia = await probeImg(page, "local-only.png", "remote-only.png");
	const remoteMedia = await probeImg(remotePage, "remote-only.png", "local-only.png");
	assert.notEqual(localMedia.base, remoteMedia.base);
	assert.equal(localMedia.ownOk, true, "local window should load local-only.png");
	assert.equal(localMedia.otherOk, false, "local window should not load remote-only.png");
	assert.equal(remoteMedia.ownOk, true, "remote window should load remote-only.png");
	assert.equal(remoteMedia.otherOk, false, "remote window should not load local-only.png");

	// Closing last tab on remote shows NoTab and updates title to `<host> — Pine`
	await remotePage.locator("[data-slot=tab] button[aria-label='Close this tab']").first().click();
	await sees(remotePage, "[data-slot=no-tab]");
	await remotePage.waitForFunction(() => document.title === "elsewhere — Pine", null, { timeout: 10_000 });

	// Close remote window for clean slate
	await remotePage.evaluate(() => (window as any).pine.closeWindow());
	await page.waitForTimeout(300);
});

test("TitleBar environment pill and sidebar Machines menu support switching and opening in new window", async () => {
	// Local window with sidebar expanded: no TitleBar environment pill
	assert.equal(await page.locator("[data-slot=window-environment]").count(), 0);

	// Collapsing sidebar on local window shows TitleBar environment pill
	await app.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", "sidebar"));
	await sees(page, "[data-slot=window-environment]");
	assert.match((await page.textContent("[data-slot=window-environment]")) ?? "", /This (Mac|computer)/);

	// Clicking TitleBar pill opens machine menu; per-machine open-in-new-window opens `you@elsewhere`
	await page.click("[data-slot=window-environment]");
	await sees(page, "[data-open-window='you@elsewhere']");
	const remoteWinPromise = app.waitForEvent("window");
	await page.click("[data-open-window='you@elsewhere']");
	const remotePage = await remoteWinPromise;
	attachErrorListeners(remotePage);
	await sees(remotePage, "[data-slot=composer]");

	// Remote window shows TitleBar environment pill even with sidebar expanded
	await sees(remotePage, "[data-slot=window-environment]");
	assert.match((await remotePage.textContent("[data-slot=window-environment]")) ?? "", /elsewhere/);

	// Restore sidebar on local window: pill disappears on local
	await app.evaluate(({ BrowserWindow }: any) => {
		const w = BrowserWindow.getAllWindows().find((x: any) => !x.getTitle().includes("elsewhere"));
		w?.webContents.send("pine:menu", "sidebar");
	});
	await page.locator("[data-slot=window-environment]").waitFor({ state: "detached", timeout: 5000 });

	// CmdOrCtrl-click on a machine in sidebar Machines menu opens a new window instead of switching current window
	await page.click("[data-slot=service-status]");
	await sees(page, "[data-slot=dropdown-menu-radio-item][data-host='you@elsewhere']");
	const secondRemotePromise = app.waitForEvent("window");
	await page.locator("[data-slot=dropdown-menu-radio-item][data-host='you@elsewhere']").click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
	const remotePage2 = await secondRemotePromise;
	attachErrorListeners(remotePage2);
	// Second window on an already-open environment starts on NoTab
	await sees(remotePage2, "[data-slot=no-tab]");
	// Original local window stayed on local!
	assert.match((await page.textContent("[data-slot=service-status]")) ?? "", /started here|attached/);

	// Clean up extra remote windows
	await remotePage2.evaluate(() => (window as any).pine.closeWindow());
	await remotePage.evaluate(() => (window as any).pine.closeWindow());
	await page.waitForTimeout(300);
});

test("Settings > Environments shows in another window badge and confirms Forget for 1 or N windows", async () => {
	// Open Settings > Environments on local window
	await app.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", "settings:environments"));
	await sees(page, "[data-environment='you@elsewhere']");

	// Open 1 remote window on `you@elsewhere`
	const w1Promise = app.waitForEvent("window");
	await page.locator("[data-environment='you@elsewhere']").getByRole("button", { name: "Open in new window" }).click();
	const remote1 = await w1Promise;
	attachErrorListeners(remote1);
	await sees(remote1, "[data-slot=composer]");

	// Local window's Environments shows `in another window` badge on `you@elsewhere`
	await sees(page, "[data-environment='you@elsewhere'] >> text=in another window");

	// Clicking Forget prompts confirmation with singular `Close its window and forget` and `Cancel`
	await page.locator("[data-environment='you@elsewhere']").getByRole("button", { name: "Forget" }).click();
	await sees(page, "[role=alertdialog] >> text=Close its window and forget");
	await page.locator("[role=alertdialog]").getByRole("button", { name: "Cancel" }).click();
	await page.locator("[role=alertdialog]").waitFor({ state: "detached", timeout: 5000 });
	// Still open after Cancel
	assert.equal(app.windows().length, 2);

	// Open a 2nd remote window on `you@elsewhere`
	const w2Promise = app.waitForEvent("window");
	await page.locator("[data-environment='you@elsewhere']").getByRole("button", { name: "Open in new window" }).click();
	const remote2 = await w2Promise;
	attachErrorListeners(remote2);
	await sees(remote2, "[data-slot=no-tab]");

	// Clicking Forget now prompts `Close its 2 windows and forget`
	await page.locator("[data-environment='you@elsewhere']").getByRole("button", { name: "Forget" }).click();
	await sees(page, "[role=alertdialog] >> text=Close its 2 windows and forget");
	await page.locator("[role=alertdialog]").getByRole("button", { name: "Close its 2 windows and forget" }).click();

	// Both remote windows close and `you@elsewhere` disappears from Environments
	await page.locator("[data-environment='you@elsewhere']").waitFor({ state: "detached", timeout: 10_000 });
	await page.waitForFunction(() => true);
	// Wait for Electron to report only 1 window left
	for (let i = 0; i < 40 && app.windows().length > 1; i++) await page.waitForTimeout(100);
	assert.equal(app.windows().length, 1, "both remote windows should close after Forget");

	// Re-add `you@elsewhere` for subsequent tests
	await page.fill("input[placeholder='you@server']", "you@elsewhere");
	await page.getByRole("button", { name: "Add" }).click();
	await sees(page, "[data-environment='you@elsewhere']");
});

test("per-window theme + nativeTheme focus sync, global prefs broadcast, and local home change reconnecting all local windows", async () => {
	// Open remote window (configured with light theme `github-light`) beside local window (dark `pmndre`)
	const remotePromise = app.waitForEvent("window");
	await page.evaluate(() => (window as any).pine.newWindow({ host: "you@elsewhere" }));
	const remotePage = await remotePromise;
	attachErrorListeners(remotePage);
	await sees(remotePage, "[data-slot=composer]");

	// Each window renders its own environment's theme
	await page.waitForFunction(() => document.documentElement.dataset.theme === "pmndre" && document.documentElement.classList.contains("dark"), null, { timeout: 10_000 });
	await remotePage.waitForFunction(() => document.documentElement.dataset.theme === "github-light" && !document.documentElement.classList.contains("dark"), null, { timeout: 10_000 });

	// Focusing remote window syncs nativeTheme.themeSource to "light"; focusing local syncs to "dark"
	const themeAfterRemoteFocus = await app.evaluate(({ BrowserWindow, nativeTheme }: any) => {
		const rw = BrowserWindow.getAllWindows().find((w: any) => w.getTitle().includes("elsewhere"));
		rw?.emit("focus");
		return nativeTheme.themeSource;
	});
	assert.equal(themeAfterRemoteFocus, "light");

	const themeAfterLocalFocus = await app.evaluate(({ BrowserWindow, nativeTheme }: any) => {
		const lw = BrowserWindow.getAllWindows().find((w: any) => !w.getTitle().includes("elsewhere"));
		lw?.emit("focus");
		return nativeTheme.themeSource;
	});
	assert.equal(themeAfterLocalFocus, "dark");

	// Global prefs broadcast: toggling keepRunning in local window reaches remote window live via onPrefs
	const receivedPref = remotePage.evaluate(
		() =>
			new Promise<boolean>((resolve) => {
				const off = (window as any).pine.onPrefs((p: any) => {
					if (p.keepRunning === true) {
						off();
						resolve(true);
					}
				});
			}),
	);
	await page.evaluate(() => (window as any).pine.prefs({ keepRunning: true }));
	assert.equal(await receivedPref, true, "remote window should receive keepRunning update via onPrefs");
	await page.evaluate(() => (window as any).pine.prefs({ keepRunning: false }));

	// Close remote window, open a second local window, and change local `home` to `home2`
	await remotePage.evaluate(() => (window as any).pine.closeWindow());
	await page.waitForTimeout(300);

	const local2Promise = app.waitForEvent("window");
	await page.evaluate(() => (window as any).pine.newWindow({ host: null }));
	const local2 = await local2Promise;
	attachErrorListeners(local2);
	await sees(local2, "[data-slot=no-tab]");

	const waitForHome = async (p: any, expected: string) => {
		const deadline = Date.now() + 20_000;
		let last: any;
		while (Date.now() < deadline) {
			last = await p.evaluate(() => (window as any).pine.state());
			if (last?.state?.status === "ready" && last?.state?.home === expected) return;
			await p.waitForTimeout(150);
		}
		throw new Error(`Expected home ${expected}, got ${JSON.stringify(last?.state)}`);
	};

	// Changing local `home` from window 1 reconnects BOTH local windows cleanly to `home2`
	await page.evaluate((nextHome: string) => (window as any).pine.prefs({ home: nextHome }), home2);
	await waitForHome(page, home2);
	await waitForHome(local2, home2);

	// Restore original `home` and close second local window
	await page.evaluate((origHome: string) => (window as any).pine.prefs({ home: origHome }), home);
	await waitForHome(page, home);
	await waitForHome(local2, home);
	await local2.evaluate(() => (window as any).pine.closeWindow());
	await page.waitForTimeout(300);
});

test("local OS folder open spawns a new local window when only remote SSH windows are open, and targets local window when one exists", async () => {
	// Open a remote window, then close the local window so ONLY the remote SSH window is open
	const remotePromise = app.waitForEvent("window");
	await page.evaluate(() => (window as any).pine.newWindow({ host: "you@elsewhere" }));
	const remotePage = await remotePromise;
	attachErrorListeners(remotePage);
	await sees(remotePage, "[data-slot=composer]");

	await page.evaluate(() => (window as any).pine.closeWindow());
	for (let i = 0; i < 40 && app.windows().length > 1; i++) await remotePage.waitForTimeout(100);
	assert.equal(app.windows().length, 1);

	// Emit OS `open-file` for local `folder`: should spawn a NEW local window and open `folder` in it
	const spawnedLocalPromise = app.waitForEvent("window");
	await app.evaluate(({ app: electronApp }: any, dir: string) => {
		electronApp.emit("open-file", { preventDefault() {} }, dir);
	}, folder);
	const localPage = await spawnedLocalPromise;
	attachErrorListeners(localPage);
	page = localPage;

	const folderName = path.basename(folder);
	// New local window connects to local daemon and opens a conversation for `folder`
	await sees(localPage, `[data-slot=tab]:has-text('${folderName}')`, 25_000);
	const localState = await localPage.evaluate(() => (window as any).pine.state());
	assert.equal(localState.state.host, undefined, "spawned window should be on local computer");

	// With both local and remote windows open, another `open-file` targets the existing local window (no 3rd window)
	const folder2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-dir2-")));
	try {
		await app.evaluate(({ app: electronApp }: any, dir: string) => {
			electronApp.emit("open-file", { preventDefault() {} }, dir);
		}, folder2);
		const folder2Name = path.basename(folder2);
		await sees(localPage, `[data-slot=tab]:has-text('${folder2Name}')`, 15_000);
		assert.equal(app.windows().length, 2, "should reuse existing local window rather than spawning a 3rd window");
	} finally {
		fs.rmSync(folder2, { recursive: true, force: true });
	}

	await remotePage.evaluate(() => (window as any).pine.closeWindow());
	await localPage.waitForTimeout(300);
});
