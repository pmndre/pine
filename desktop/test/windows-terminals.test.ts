// Multi-window tab transfer, sidebar Open in New Window, drag guard, and per-window local terminal isolation e2e tests.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { startMock } from "../../baseline/tests/mock.mjs";
import { launchApp } from "./support/app.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let app: any;
let page: any;
let mock: any;
let home: string;
let far: string;
let dataDir: string;
let sampleFile: string;
const pageErrors: string[] = [];

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

async function sees(p: any, selector: string, timeout = 20_000): Promise<void> {
	try {
		await p.waitForSelector(selector, { timeout });
	} catch {
		const there = await p.evaluate(() => ({
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

const terminalText = (p: any) => p.$eval("[data-slot=terminal] .xterm-rows", (el: Element) => el.textContent ?? "").catch(() => "");
const terminalShows = (p: any, text: string) =>
	p.waitForFunction((t: string) => (document.querySelector("[data-slot=terminal] .xterm-rows")?.textContent ?? "").includes(t), text, { timeout: 15_000 });

async function openTerminal(p: any): Promise<void> {
	await p.evaluate(() => {
		// Open the side panel to Terminal view using the window's menu channel or UI toggle.
		const toggle = document.querySelector("[data-toggle=code]") as HTMLElement | null;
		if (toggle && toggle.getAttribute("aria-pressed") !== "true") toggle.click();
	});
	await sees(p, "[data-slot=code-panel]");
	await p.locator("[data-slot=code-panel] button", { hasText: "Terminal" }).click();
	await sees(p, "[data-slot=code-panel] [data-slot=terminal]");
}

async function typeInTerminal(p: any, cmd: string): Promise<void> {
	await p.click("[data-slot=terminal]");
	await p.keyboard.type(cmd);
	await p.keyboard.press("Enter");
}

before(async () => {
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-win-term-")));
	far = path.join(home, "far");
	dataDir = path.join(home, "desktop-data");
	sampleFile = path.join(home, "notes-attach.txt");
	write(sampleFile, "hello from attachment\n");

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
	const pineJson = JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false } }, null, 2);

	write(path.join(home, "models.json"), modelsJson);
	write(path.join(home, "pine.json"), pineJson);
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "You are main.\n");
	write(path.join(home, "agents", "scout", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "scout", "workspace", "AGENTS.md"), "You are scout.\n");

	write(path.join(far, "models.json"), modelsJson);
	write(path.join(far, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "helper", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false } }, null, 2));
	write(path.join(far, "agents", "helper", "agent.json"), JSON.stringify({}));
	write(path.join(far, "agents", "helper", "workspace", "AGENTS.md"), "You are helper on far.\n");

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
		PINE_DESKTOP_SHELL: "/bin/bash",
		PINE_DESKTOP_SSH: ssh,
	});
	page = await app.firstWindow();
	attachErrorListeners(page);
	await sees(page, "[data-slot=composer]");
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	if (home) fs.rmSync(home, { recursive: true, force: true });
	assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.join("\n")}`);
});

test("Move to New Window transfers unsent draft, attachments, live local terminal PTY, and skips closeSession", async () => {
	// Open a non-main conversation main:movable in window 1
	await page.fill("[data-slot=composer] textarea", "/new movable");
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => [...document.querySelectorAll("[data-slot=tab-name]")].some((el) => el.textContent?.includes("movable")));

	// Subscribe main:movable to a webhook source so we can verify closeSession is NOT called on move
	const mkSrc = await page.evaluate(() => (window as any).pine.call("POST", "/sources", { name: "movehook", type: "webhook", description: "move test", options: {} }));
	assert.equal(mkSrc.ok, true, `POST /sources failed: ${JSON.stringify(mkSrc)}`);
	const subRes = await page.evaluate(() => (window as any).pine.call("POST", "/agents/main/subscribe", { source: "movehook", session: "movable" }));
	assert.equal(subRes.ok, true, `POST /subscribe failed: ${JSON.stringify(subRes)}`);

	// Type unsent draft text and attach a file
	await page.fill("[data-slot=composer] textarea", "unsent draft surviving move");
	await page.setInputFiles("input[type=file]", sampleFile);
	await page.waitForFunction(() => (document.querySelector("[data-slot=composer]")?.textContent ?? "").includes("notes-attach.txt"));

	// Open the local terminal for main:movable and set a shell variable + print a marker
	await openTerminal(page);
	await typeInTerminal(page, "MOVED_VAR=pty-alive-99; echo before-$MOVED_VAR");
	await terminalShows(page, "before-pty-alive-99");

	// Right-click the movable tab and choose "Move to New Window"
	const nextWin = app.waitForEvent("window");
	await page.locator("[data-slot=tab]", { hasText: "movable" }).click({ button: "right" });
	await sees(page, "[data-slot=context-menu-content]");
	await page.locator("[data-slot=context-menu-content]", { hasText: "Move to New Window" }).getByText("Move to New Window").click();

	const page2 = await nextWin;
	attachErrorListeners(page2);
	await sees(page2, "[data-slot=composer]");

	// Source window closed the movable tab; destination window has movable as its sole tab
	await page.waitForFunction(() => ![...document.querySelectorAll("[data-slot=tab-name]")].some((el) => el.textContent?.includes("movable")));
	const destTabs = await page2.$$eval("[data-slot=tab-name]", (els: Element[]) => els.map((e) => e.textContent ?? ""));
	assert.equal(destTabs.length, 1, `expected sole tab in destination window, got: ${JSON.stringify(destTabs)}`);
	assert.ok(destTabs[0].includes("movable"), `destination tab should be movable, got: ${destTabs[0]}`);

	// Subscription survived (closeSession was NOT called)
	const sourcesAfterMove = await page.evaluate(() => (window as any).pine.call("GET", "/agents/main/sources?session=movable"));
	const hook = (sourcesAfterMove.data as any[]).find((s) => s.name === "movehook");
	assert.ok(hook?.local, `subscription must survive Move to New Window, got: ${JSON.stringify(hook)}`);

	// Unsent draft text and attachment were preserved in the new window
	const draftVal = await page2.inputValue("[data-slot=composer] textarea");
	assert.equal(draftVal, "unsent draft surviving move");
	const composerText = await page2.textContent("[data-slot=composer]");
	assert.ok(composerText?.includes("notes-attach.txt"), `attachment should transfer to new window, composer: ${composerText}`);

	// Live local terminal PTY was transferred with its scrollback and shell state intact
	await openTerminal(page2);
	await terminalShows(page2, "before-pty-alive-99");
	await typeInTerminal(page2, "echo after-$MOVED_VAR");
	await terminalShows(page2, "after-pty-alive-99");

	// Cross-window HTML5 tab drag-and-drop is a safe no-op: simulate dropping window 1's tab payload onto window 2's tab
	const win1Id = (await page.evaluate(() => (window as any).pine.state())).windowId;
	await page2.evaluate((fromWinId: number) => {
		const tab = document.querySelector("[data-slot=tab]")!;
		const dt = new DataTransfer();
		dt.setData("application/x-pine-tab", JSON.stringify({ windowId: fromWinId, index: 0 }));
		dt.setData(`application/x-pine-tab-${fromWinId}`, "0");
		tab.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
		tab.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
	}, win1Id);
	const destTabsAfterDrop = await page2.$$eval("[data-slot=tab-name]", (els: Element[]) => els.map((e) => e.textContent ?? ""));
	assert.deepEqual(destTabsAfterDrop, destTabs, "cross-window tab drop must be a safe no-op");

	// Close window 2
	const closed2 = page2.waitForEvent("close");
	await page2.evaluate(() => (window as any).pine.closeWindow());
	await closed2;
});

test("Sidebar conversation context menu Open in New Window opens that conversation as the sole tab", async () => {
	// Intercept native context menu to verify "Open in New Window" is offered and pick it
	await app.evaluate(({ ipcMain }: any) => {
		const g = globalThis as any;
		g.__seenConvMenu = [];
		ipcMain.removeHandler("pine:context-menu");
		ipcMain.handle("pine:context-menu", (_e: unknown, items: Array<{ id: string; label: string }>) => {
			g.__seenConvMenu = items.map((i) => ({ id: i.id, label: i.label }));
			return "open-window";
		});
	});

	const nextWin = app.waitForEvent("window");
	// Right-click scout's main conversation row in the sidebar
	const scoutRow = page.locator("[aria-label='Conversations with scout'] [data-slot=sidebar-menu-item]").first();
	await scoutRow.click({ button: "right" });

	const page2 = await nextWin;
	attachErrorListeners(page2);
	await sees(page2, "[data-slot=composer]");

	const seenMenu = await app.evaluate(() => (globalThis as any).__seenConvMenu);
	assert.ok(seenMenu.some((i: any) => i.id === "open-window" && i.label === "Open in New Window"), `context menu should offer Open in New Window, got: ${JSON.stringify(seenMenu)}`);

	const tabs2 = await page2.$$eval("[data-slot=tab-name]", (els: Element[]) => els.map((e) => e.textContent ?? ""));
	assert.equal(tabs2.length, 1, `Open in New Window should open sole tab, got: ${JSON.stringify(tabs2)}`);
	assert.ok(tabs2[0].includes("scout"), `sole tab should be scout, got: ${tabs2[0]}`);

	const closed2 = page2.waitForEvent("close");
	await page2.evaluate(() => (window as any).pine.closeWindow());
	await closed2;
});

test("Local terminals are isolated per window on close and on switching away from local environment", async () => {
	// Open terminal in window 1 on main:main
	await openTerminal(page);
	await typeInTerminal(page, "LOCAL_ID=win-one; echo start-$LOCAL_ID");
	await terminalShows(page, "start-win-one");

	// Open a second local window on main:main and open its own terminal
	const nextWin = app.waitForEvent("window");
	await page.evaluate(() => (window as any).pine.newWindow({ tab: { agent: "main", session: "main" } }));
	const page2 = await nextWin;
	attachErrorListeners(page2);
	await sees(page2, "[data-slot=composer]");
	await openTerminal(page2);
	await typeInTerminal(page2, "LOCAL_ID=win-two; echo start-$LOCAL_ID");
	await terminalShows(page2, "start-win-two");

	// Verify outputs did not leak across windows
	assert.ok(!(await terminalText(page)).includes("start-win-two"), "window 1 terminal must not receive window 2 output");
	assert.ok(!(await terminalText(page2)).includes("start-win-one"), "window 2 terminal must not receive window 1 output");

	// Switch window 2 to SSH remote ("far-box") -> closes window 2's local terminal, leaves window 1's alive
	await page2.evaluate(() => (window as any).pine.addHost("far-box"));
	await page2.evaluate(() => (window as any).pine.use("far-box"));
	await page2.waitForFunction(() => [...document.querySelectorAll("[data-slot=agent-label]")].some((el) => el.textContent?.includes("helper")), null, { timeout: 20_000 });

	// Window 1's terminal is still alive with its shell state intact
	await typeInTerminal(page, "echo after-switch-$LOCAL_ID");
	await terminalShows(page, "after-switch-win-one");

	// Switch window 2 back to local, open a fresh terminal (proving old one was closed on switch), then close window 2
	await page2.evaluate(() => (window as any).pine.use(undefined));
	await sees(page2, "[data-slot=composer]");
	await openTerminal(page2);
	await typeInTerminal(page2, "echo check-fresh-${LOCAL_ID:-clean}");
	await terminalShows(page2, "check-fresh-clean");

	const closed2 = page2.waitForEvent("close");
	await page2.evaluate(() => (window as any).pine.closeWindow());
	await closed2;

	// Window 1's terminal is still alive after window 2 closed
	await typeInTerminal(page, "echo after-close-$LOCAL_ID");
	await terminalShows(page, "after-close-win-one");
});
