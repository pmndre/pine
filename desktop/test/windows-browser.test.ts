// Multi-window embedded browser (BrowserHost) end-to-end tests:
// concurrent WebContentsView overlays across two local windows, preemption fallback to canvas when
// two windows view the same browser tab, and clean detachment on window close.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { mockMsg, startMock } from "../../baseline/tests/mock.mjs";
import { browserPlaces } from "../../src/browser-build.ts";
import { sandboxMissing } from "../../src/security.ts";
import { launchApp, patient, waitForWindow, windowCount } from "./support/app.ts";

let site: http.Server;
let siteUrl: string;
let mock: any;
let home: string;
let dataDir: string;
let socketsDir: string;
let browsers: string;
let app: ElectronApplication | undefined;

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

/**
 * A menu item's click, found by its key and not by its wording, for the window at `index` (in the order the windows
 * were made). The items that only send the page a command are sent as that command instead (`sendMenuTo`).
 */
async function menuKey(launched: ElectronApplication, accelerator: string, index: number): Promise<void> {
	await launched.evaluate(
		({ BrowserWindow, Menu }: any, [key, idx]: [string, number]) => {
			const target = [...BrowserWindow.getAllWindows()].sort((a: any, b: any) => a.id - b.id)[idx];
			if (!target || target.isDestroyed()) throw new Error(`no window ${idx}`);
			target.emit("focus");
			const find = (items: any[]): any => {
				for (const i of items) {
					if (i.accelerator === key && typeof i.click === "function") return i;
					const below = i.submenu ? find(i.submenu.items) : undefined;
					if (below) return below;
				}
			};
			const found = find(Menu.getApplicationMenu()?.items ?? []);
			if (!found) throw new Error(`no menu item with the key ${key}`);
			found.click(found, target, undefined);
		},
		[accelerator, index] as [string, number],
	);
}
const NEW_WINDOW = "CmdOrCtrl+N";
const CLOSE_WINDOW = "CmdOrCtrl+Shift+W";

/** An agent's main conversation, opened from the side bar by the agent's name. */
const openAgent = async (p: Page, agent: string) => {
	await p.locator("[data-slot=sidebar] [data-slot=agent-label]").getByText(agent, { exact: true }).first().click();
	await p.locator("[data-slot=tab][data-active] [data-slot=tab-name]", { hasText: agent }).waitFor();
};
/** What a window shows first: a conversation, or that it has no tab. */
const FIRST = "[data-slot=no-tab], [data-slot=tab][data-active]";

async function childUrlsByWindow(launched: ElectronApplication): Promise<string[][]> {
	return launched.evaluate(({ BrowserWindow }: any) =>
		[...BrowserWindow.getAllWindows()]
			.sort((a: any, b: any) => a.id - b.id)
			.map((w: any) => w.contentView.children.map((v: any) => (v.webContents && !v.webContents.isDestroyed() ? v.webContents.getURL() : ""))),
	);
}

async function waitForChildren(launched: ElectronApplication, check: (urls: string[][]) => boolean, label: string, timeout = patient(20_000)): Promise<string[][]> {
	const deadline = Date.now() + timeout;
	let last: string[][] = [];
	while (Date.now() < deadline) {
		last = await childUrlsByWindow(launched);
		if (check(last)) return last;
		await new Promise((r) => setTimeout(r, 100));
	}
	assert.fail(`${label}: timed out with ${JSON.stringify(last)}`);
}

async function openViaAgent(page: Page, words: string, url: string, done: string): Promise<void> {
	const turn = (async () => {
		await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "mcp__browser__browser_navigate", args: { url } }] }, { tools: [{ name: "mcp__browser__browser_show", args: {} }] }, { text: done }], `${words} `));
		await page.keyboard.press("Enter");
		await page.waitForSelector(`[data-slot=markdown] >> text=${done}`, { timeout: 60_000 });
	})();
	// Opening an address on this computer is asked about: the question names the address, and is allowed.
	const allow = page.locator("[role=dialog]", { hasText: url }).locator("[data-action=allow]");
	await allow.waitFor({ timeout: patient(30_000) });
	await allow.click();
	await turn;
}

async function focusWindowIndex(launched: ElectronApplication, index: number): Promise<void> {
	await launched.evaluate(({ BrowserWindow }: any, idx: number) => {
		const wins = [...BrowserWindow.getAllWindows()].sort((a: any, b: any) => a.id - b.id);
		const w = wins[idx];
		if (w && !w.isDestroyed()) w.emit("focus");
	}, index);
}

before(async () => {
	if (process.platform === "linux" && sandboxMissing()) throw new Error(`No sandbox: ${sandboxMissing()}`);
	site = http.createServer((req, res) =>
		res
			.writeHead(200, { "content-type": "text/html" })
			.end(`<title>Page ${req.url}</title><body style="margin:0;font:24px sans-serif;background:#eef"><h1 style="margin:24px">Room ${req.url}</h1></body>`),
	);
	await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
	siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-mw-browser-")));
	dataDir = path.join(home, "desktop-data");
	socketsDir = fs.mkdtempSync(path.join(process.platform === "win32" ? os.tmpdir() : "/tmp", "pw-"));
	// The browser of the web tools counts as there, so that the app's question about it lies over nothing here (app.test.ts
	// tests it). The browser these agents use is the app's own, in its window: no build of Playwright's is started.
	browsers = path.join(home, "browsers");
	fs.mkdirSync(browsers, { recursive: true });
	for (const place of (await browserPlaces()) ?? []) write(path.join(browsers, path.basename(place), "INSTALLATION_COMPLETE"), "");
	write(
		path.join(home, "models.json"),
		JSON.stringify({
			providers: {
				mock: {
					name: "Mock",
					baseUrl: mock.baseUrl,
					api: "openai-completions",
					apiKey: "sk-mock",
					models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
				},
			},
		}),
	);
	write(
		path.join(home, "pine.json"),
		JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe", introduce: false, thinking: "off" }, security: { askAccess: false }, mcp: { browser: { pine: "browser" } } }, null, 2),
	);
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n");
	write(path.join(home, "agents", "scout", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "scout", "workspace", "AGENTS.md"), "The scout agent.\n");
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	site?.close();
	if (home) fs.rmSync(home, { recursive: true, force: true });
	if (socketsDir) fs.rmSync(socketsDir, { recursive: true, force: true });
});

test("two local windows attach different browser rooms concurrently, preempt cleanly on contention, and detach on close", { timeout: 120_000 }, async () => {
	app = await launchApp({
		...process.env,
		PWTEST_SOCKETS_DIR: socketsDir,
		PLAYWRIGHT_BROWSERS_PATH: browsers,
		PINE_HOME: home,
		PINE_DESKTOP_DATA: dataDir,
		PINE_SKIP_DOWNLOADS: "1",
		PINE_DESKTOP_DEV_URL: "",
		PINE_DESKTOP_RELEASES: "",
	});
	const win1 = await app.firstWindow();
	// The first window waits for the daemon the app starts, which beside other apps on a runner takes a while.
	await win1.waitForSelector(FIRST, { timeout: patient(40_000) });
	await win1.waitForSelector("[data-slot=tab][data-active]", { timeout: patient(20_000) });

	// Open /main in Window 1 via the main agent's browser tools (opens the Browser aside automatically).
	await openViaAgent(win1, "open main page", `${siteUrl}/main`, "Main page open.");
	await win1.waitForSelector("[data-slot=browser] [data-slot=browser-page]", { timeout: patient(25_000) });
	await waitForChildren(app, (urls) => urls.length === 1 && urls[0].some((u) => u.endsWith("/main")), "win1 attached /main");

	// Open Window 2, select scout agent, and open /scout via scout's browser tools.
	const win2 = await waitForWindow(app, () => menuKey(app!, NEW_WINDOW, 0));
	await win2.waitForSelector("[data-slot=no-tab]", { timeout: patient(20_000) });
	await openAgent(win2, "scout");
	await openViaAgent(win2, "open scout page", `${siteUrl}/scout`, "Scout page open.");
	await win2.waitForSelector("[data-slot=browser] [data-slot=browser-page]", { timeout: patient(25_000) });

	// Both windows hold their own WebContentsView concurrently!
	await waitForChildren(
		app,
		(urls) => urls.length === 2 && urls[0].some((u) => u.endsWith("/main")) && urls[1].some((u) => u.endsWith("/scout")),
		"win1 and win2 concurrently attached to /main and /scout",
	);
	assert.equal(await win1.$("[data-slot=browser] [data-drawn]"), null, "win1 shows the page itself, not a picture of it");
	assert.equal(await win2.$("[data-slot=browser] [data-drawn]"), null, "win2 shows the page itself, not a picture of it");

	// Contention: switch Window 2 to `main` (same browser room/tab as Window 1).
	await openAgent(win2, "main");
	// Window 2 claims the native WebContentsView for /main; Window 1 is preempted and falls back to canvas.
	await waitForChildren(
		app,
		(urls) => urls.length === 2 && urls[0].length === 0 && urls[1].some((u) => u.endsWith("/main")),
		"win2 preempted /main from win1",
	);
	await win2.waitForSelector("[data-slot=browser] [data-slot=browser-page]", { timeout: patient(10_000) });
	await win1.waitForSelector("[data-slot=browser] [data-drawn]", { timeout: patient(15_000) });

	// Re-focusing Window 1 re-claims the native view and preempts Window 2 to canvas.
	await focusWindowIndex(app, 0);
	await waitForChildren(
		app,
		(urls) => urls.length === 2 && urls[0].some((u) => u.endsWith("/main")) && urls[1].length === 0,
		"win1 re-claimed /main after focus",
	);
	await win1.waitForSelector("[data-slot=browser] [data-slot=browser-page]", { timeout: patient(10_000) });
	await win2.waitForSelector("[data-slot=browser] [data-drawn]", { timeout: patient(15_000) });

	// Close Window 2 (after switching it back to scout so it owns a view), verify clean detachment and Window 1 remains intact.
	await openAgent(win2, "scout");
	await waitForChildren(
		app,
		(urls) => urls.length === 2 && urls[0].some((u) => u.endsWith("/main")) && urls[1].some((u) => u.endsWith("/scout")),
		"both windows own views again before closing win2",
	);
	await menuKey(app, CLOSE_WINDOW, 1);
	await waitForChildren(
		app,
		(urls) => urls.length === 1 && urls[0].some((u) => u.endsWith("/main")),
		"win1 keeps /main cleanly after win2 closes",
	);
	assert.equal(await windowCount(app), 1);
});
