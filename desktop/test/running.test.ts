// A program a conversation left running, and the way from it into the conversation's browser: the
// real app on a home of its own, an agent that starts a small server in the background, and a
// stand-in for the door of the conversation's browser. Links of an answer go the same way, or to the
// owner's own browser. No real browser is started; what would open in the owner's own is noted.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { mockMsg, startMock } from "../../baseline/tests/mock.mjs";
import { browserPlaces } from "../../src/browser-build.ts";
import { launchApp, patient } from "./support/app.ts";
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
const sees = (selector: string, timeout = 20_000) => page.waitForSelector(selector, { timeout: patient(timeout) });
const waitFor = async (what: string, ok: () => boolean | Promise<boolean>) => {
	for (const end = Date.now() + patient(10_000); Date.now() < end && !(await ok()); ) await new Promise((r) => setTimeout(r, 50));
	assert.ok(await ok(), `${what}. Asked: ${JSON.stringify(asked)}`);
};
/** What the conversation's commands left running, as the daemon says. */
const programs = async () => ((await call("GET", "/agents/main/programs?session=main"))?.data ?? []) as Array<{ id: number }>;

before(async () => {
	// A port nobody listens on, for the server the agent starts.
	port = await freePort();
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-running-")));
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	// (Without a sandbox, so that the server may listen; a port of its own for the daemon.)
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "auto", introduce: false }, security: { askAccess: false } }));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n\nYou are the main agent.\n");
	// The server ends by itself after a while, should this test not get to stop it.
	write(path.join(home, "agents", "main", "workspace", "serve.mjs"), `import http from "node:http";\nhttp.createServer((q, s) => s.end("ok")).listen(${port}, "127.0.0.1");\nsetTimeout(() => process.exit(0), 120000);\n`);
	// The browser of the web tools counts as there, so that the app's question about it lies over nothing here (app.test.ts tests it).
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	for (const place of (await browserPlaces()) ?? []) write(path.join(home, "browsers", path.basename(place), "INSTALLATION_COMPLETE"), "");
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
		for (const p of await programs()) await call("POST", "/agents/main/programs/stop", { session: "main", id: p.id });
		for (let i = 0; i < 40 && (await programs()).length; i++) await new Promise((r) => setTimeout(r, 100));
	} catch {
		// (the app did not get that far: the server ends by itself)
	}
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	door?.close();
	if (home) fs.rmSync(home, { recursive: true, force: true });
});

test("a server the agent left running is one click away in the conversation's browser, from the empty browser and from Running", async () => {
	await sees("[data-slot=tab][data-active]", 30_000);
	await page.fill("[data-slot=composer] textarea", mockMsg([{ tools: [{ name: "bash", args: { command: "node serve.mjs", background: true } }] }, { text: "The server runs." }], "Start the server. "));
	await page.press("[data-slot=composer] textarea", "Enter");
	await sees("text=The server runs.", 30_000);
	// The conversation's browser, as its door: up, and without a page.
	write(path.join(home, "data", "browser-view", `${encodeURIComponent("main:main")}.json`), JSON.stringify({ port: (door.address() as net.AddressInfo).port, token: "ef".repeat(32), pid: 1 }));

	// The empty browser says what runs in this conversation, and a click opens it there.
	await menu("browser");
	const offered = page.locator("[data-slot=browser] [data-offer=running] button");
	await offered.waitFor({ timeout: patient(20_000) });
	assert.ok(((await offered.textContent()) ?? "").includes(String(port)), "the offer names the port the server listens on");
	// What listens there is the command the agent ran, said on the offer.
	await offered.hover();
	await sees("[data-slot=tooltip-content] >> text=node serve.mjs");
	await offered.click();
	await waitFor("the address of the running server was opened in the conversation's browser", () => asked.length === 1);
	assert.equal(asked[0], `http://localhost:${port}`);
	await sees(`[data-slot=browser] [data-slot=tabs-trigger][aria-selected=true] >> text=The server`);

	// The same address under Running goes to the same browser, which the side panel shows in place of Running.
	await menu("code-running");
	await page.locator("[data-slot=code-panel] [role=listitem] button", { hasText: String(port) }).click();
	await waitFor("the link under Running was opened in the conversation's browser", () => asked.length === 2);
	assert.equal(asked[1], `http://localhost:${port}`);
	await sees("[data-slot=code-panel] [data-slot=browser]");
	await sees("[data-slot=code-panel] [data-view=browser][aria-selected=true]");
	assert.deepEqual(await app.evaluate(() => (globalThis as any).opened), [], "nothing went to the owner's own browser");
});

test("a link of an answer opens in the conversation's browser, one on this computer in the owner's own, and its menu offers both", async () => {
	const local = `http://localhost:${port}/local`;
	await page.fill("[data-slot=composer] textarea", mockMsg([{ text: `See [the docs](https://example.com/docs) and [the server](${local}).` }], "Links. "));
	await page.press("[data-slot=composer] textarea", "Enter");
	const md = page.locator("[data-slot=markdown]", { hasText: "See the docs" }).last();
	await md.locator("[data-href]").first().waitFor({ timeout: 20_000 });
	const opened = () => app.evaluate(() => [...(globalThis as any).opened]) as Promise<string[]>;
	const before = asked.length;

	// A page on the web: in the conversation's browser, where the agent sees it too.
	await md.locator('[data-href="https://example.com/docs"]').click();
	await waitFor("the web link was opened in the conversation's browser", () => asked.length === before + 1);
	assert.equal(asked.at(-1), "https://example.com/docs");
	assert.deepEqual(await opened(), []);

	// An address on this computer: in the owner's own browser, since the conversation's would let the agent reach it.
	await md.locator(`[data-href="${local}"]`).click();
	await waitFor("the local address went to the owner's own browser", async () => (await opened()).length > 0);
	assert.deepEqual(await opened(), [local]);
	assert.equal(asked.length, before + 1, "the local address did not go to the conversation's browser");

	// With ⌘ (Ctrl) or ⌥ (Alt) held, a web link goes to the owner's own browser too.
	await md.locator('[data-href="https://example.com/docs"]').click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
	await waitFor("the web link went to the owner's own browser with the key held", async () => (await opened()).length >= 2);
	assert.deepEqual(await opened(), [local, "https://example.com/docs"]);
	await md.locator('[data-href="https://example.com/docs"]').click({ modifiers: ["Alt"] });
	await waitFor("the web link went to the owner's own browser with the other key held", async () => (await opened()).length >= 3);
	assert.deepEqual(await opened(), [local, "https://example.com/docs", "https://example.com/docs"]);
	assert.equal(asked.length, before + 1, "neither went to the conversation's browser");

	// The right button offers both, and says what the conversation's browser means for a local address.
	await app.evaluate(({ ipcMain }: any) => {
		const g = globalThis as any;
		g.linkMenus = [];
		ipcMain.removeHandler("pine:context-menu");
		ipcMain.handle("pine:context-menu", (_e: unknown, items: Array<{ id: string; label: string; separator?: boolean }>) => (g.linkMenus.push(items.filter((i) => !i.separator).map((i) => ({ id: i.id, label: i.label }))), "pine"));
	});
	await md.locator(`[data-href="${local}"]`).click({ button: "right" });
	await waitFor("the local address was opened in the conversation's browser from the link's menu", () => asked.length === before + 2);
	assert.equal(asked.at(-1), local);
	const [offered]: Array<Array<{ id: string; label: string }>> = await app.evaluate(() => (globalThis as any).linkMenus);
	assert.deepEqual(offered.map((i) => i.id), ["pine", "outside", "copy"], "the conversation's browser, the owner's own, and the address to copy");
	// The item for the conversation's browser names the address it lets the agent reach (AGENTS.md, rule 8): whatever its words, that address is in it.
	assert.ok(offered[0].label.includes(`localhost:${port}`), `the item names the local address the agent would reach: ${offered[0].label}`);
	assert.ok(!offered[1].label.includes("localhost"), "the owner's own browser lets the agent reach nothing");
	assert.equal((await opened()).length, 3, "nothing more went to the owner's own browser");
});

test("a program is stopped from Running, through a confirm that closes on Stop", async () => {
	await menu("code-running");
	const panel = page.locator("[data-slot=code-panel]");
	assert.equal((await programs()).length, 1, "the server the agent started is still running");
	await panel.locator("[role=listitem] [data-action=stop]").click();
	// The question offers a way back and the stop; the stop closes it.
	const confirm = page.getByRole("alertdialog");
	await confirm.waitFor({ timeout: patient(5000) });
	assert.equal(await confirm.locator("[data-slot=alert-dialog-cancel]").count(), 1);
	await confirm.locator("[data-slot=alert-dialog-action]").click();
	await confirm.waitFor({ state: "detached", timeout: patient(5000) });
	// The program is gone for the daemon, and the list has no line for it any more.
	await waitFor("the program was stopped", async () => (await programs()).length === 0);
	await panel.locator("[role=listitem]").waitFor({ state: "detached", timeout: patient(20_000) });
});
