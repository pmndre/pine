// A program a conversation left running, and the way from it into the conversation's browser: the
// real app on a home of its own, an agent that starts a small server in the background, and a
// stand-in for the door of the conversation's browser. No real browser is started, and nothing
// is opened in the owner's own.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { mockMsg, startMock } from "../../baseline/tests/mock.mjs";
import { launchApp } from "./support/app.ts";
import { freePort } from "./support/daemon.ts";

let app: any;
let page: any;
let mock: any;
let home: string;
let door: http.Server;
let port: number;
/** What the stand-in for the browser's door was asked to open. */
const asked: string[] = [];
/** Where the stand-in says the browser is: no page until an address was opened. */
const where = { open: false, tabs: [] as Array<{ title: string; url: string }>, current: 0, window: false };

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};
const menu = (command: string) => app.evaluate(({ BrowserWindow }: any, c: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", c), command);
const call = (method: string, url: string, body?: unknown) => page.evaluate(([m, u, b]: [string, string, unknown]) => (window as any).pine.call(m, u, b), [method, url, body]);
const sees = (selector: string, timeout = 20_000) => page.waitForSelector(selector, { timeout });
const waitFor = async (what: string, ok: () => boolean) => {
	for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 50));
	assert.ok(ok(), `${what}. Asked: ${JSON.stringify(asked)}`);
};

before(async () => {
	// A port nobody listens on, for the server the agent starts.
	port = await freePort();
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-running-")));
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	// (Without a sandbox, so that the server may listen; a port of its own for the daemon.)
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "auto" }, security: { askAccess: false } }));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n\nYou are the main agent.\n");
	// The server ends by itself after a while, should this test not get to stop it.
	write(path.join(home, "agents", "main", "workspace", "serve.mjs"), `import http from "node:http";\nhttp.createServer((q, s) => s.end("ok")).listen(${port}, "127.0.0.1");\nsetTimeout(() => process.exit(0), 120000);\n`);
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	write(path.join(home, "desktop-data", "prefs.json"), JSON.stringify({ updates: false }));

	door = http.createServer(async (req, res) => {
		if (req.headers.authorization !== `Bearer ${"ef".repeat(32)}`) return void res.writeHead(401).end();
		let text = "";
		for await (const chunk of req) text += chunk;
		if (req.url === "/frame") return void res.writeHead(404).end();
		if (req.url === "/open") {
			const url = String(JSON.parse(text || "{}").url);
			asked.push(url);
			Object.assign(where, { open: true, tabs: [{ title: "The server", url }] });
		}
		res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(where));
	});
	await new Promise<void>((r) => door.listen(0, "127.0.0.1", r));

	app = await launchApp({ ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"), PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "" });
	page = await app.firstWindow();
	await page.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
	// What would open in the owner's own browser is noted instead.
	await app.evaluate(({ shell }: any) => {
		(globalThis as any).opened = [];
		shell.openExternal = async (url: string) => void (globalThis as any).opened.push(url);
	});
});

after(async () => {
	// The program the agent left running is stopped with the test, whatever happened in it, and the
	// daemon is given the moment it takes to see it gone (it ends what does not listen after two seconds).
	try {
		const running = async () => ((await call("GET", "/agents/main/programs?session=main"))?.data ?? []) as Array<{ id: number }>;
		for (const p of await running()) await call("POST", "/agents/main/programs/stop", { session: "main", id: p.id });
		for (let i = 0; i < 40 && (await running()).length; i++) await new Promise((r) => setTimeout(r, 100));
	} catch {
		// (the app did not get that far: the server ends by itself)
	}
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	door?.close();
	if (home) fs.rmSync(home, { recursive: true, force: true });
});

test("a server the agent left running is one click away in the conversation's browser, from the empty browser and from Running", async () => {
	await sees("[data-slot=empty] h1", 30_000);
	const dialog = await page.waitForSelector("[data-slot=dialog-footer] button >> text=Not now", { timeout: 5000 }).catch(() => undefined);
	if (dialog) await dialog.click();
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "bash", args: { command: "node serve.mjs", background: true } }] }, { text: "The server runs." }], "Start the server. "));
	await page.press("[data-slot=composer] textarea", "Enter");
	await sees("text=The server runs.", 30_000);
	// The conversation's browser, as its door: up, and without a page.
	write(path.join(home, "data", "browser-view", `${encodeURIComponent("main:main")}.json`), JSON.stringify({ port: (door.address() as net.AddressInfo).port, token: "ef".repeat(32), pid: 1 }));

	// The empty browser says what runs in this conversation, and a click opens it there.
	await menu("browser");
	await sees("[data-slot=browser] [data-slot=empty] >> text=No page is open");
	const offered = page.locator("[data-slot=browser] [data-offer=running] button");
	await offered.waitFor({ timeout: 20_000 });
	assert.equal(await offered.textContent(), `localhost:${port}`);
	await offered.hover();
	await sees("[data-slot=tooltip-content] >> text=node serve.mjs");
	await offered.click();
	await waitFor("the address of the running server was opened in the conversation's browser", () => asked.length === 1);
	assert.equal(asked[0], `http://localhost:${port}`);
	await sees(`[data-slot=browser] [data-slot=tabs-trigger][aria-selected=true] >> text=The server`);

	// The same address under Running goes to the same browser, and opens the browser's aside where it was closed.
	await menu("browser");
	await page.waitForSelector("[data-slot=browser-aside]", { state: "detached" });
	await menu("code-running");
	await page.locator("[data-slot=code-panel]").getByRole("button", { name: `localhost:${port}` }).click();
	await waitFor("the link under Running was opened in the conversation's browser", () => asked.length === 2);
	assert.equal(asked[1], `http://localhost:${port}`);
	await sees("[data-slot=browser-aside] [data-slot=browser] input[aria-label=Address]");
	// This window has room for one of the two beside the conversation: the browser, opened last, is in front of the side panel.
	await page.waitForSelector("[data-slot=code-panel]", { state: "detached" });
	await sees("header [data-toggle=code][data-behind]");
	assert.deepEqual(await app.evaluate(() => (globalThis as any).opened), [], "nothing went to the owner's own browser");
});
