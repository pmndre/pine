// The owner's own browser as the agents' browser: pine's host (mcp/chrome.ts) on a stand-in for the
// extension, what pine registers with the browsers of an account (src/chrome.ts) in an account of the
// test's own, and what the daemon says and does about it. The `live:` test at the end puts the real
// extension into a real Chromium, in folders of its own.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { WebSocket } from "ws";
import { appBrowser } from "../mcp/browser.ts";
import { ChromeHost, EXTENSION_IDS, extensionVersion, framed, frames, groupTitle, HOST_NAME, PROTOCOL } from "../mcp/chrome.ts";
import { chromeFile, chromeState, connectChrome, disconnectChrome, refreshChrome } from "../src/chrome.ts";
import { checkSetting } from "../src/admin.ts";
import { harness, until } from "./support/harness.ts";

const tmp = (t: { after(fn: () => void): void }, name: string) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pine-${name}-`));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
};

/**
 * A stand-in for the extension: tabs by number, each in a group or in none, and what it was asked to do.
 * It answers as extension/background.js does, without a browser.
 */
function fakeExtension() {
	const asked: any[] = [];
	const groups = new Map<string, number[]>();
	const mine = new Map<number, string>();
	let next = 100;
	let host!: ChromeHost;
	const info = (tabId: number) => ({ targetId: `T${tabId}`, type: "page", title: `Tab ${tabId}`, url: `https://site${tabId}.example/` });
	const answer = (m: any): unknown => {
		if (m.do === "enter") return { tabs: (groups.get(m.room) ?? []).map((tabId) => ({ tabId, targetInfo: info(tabId) })) };
		if (m.do === "open") {
			const tabId = ++next;
			groups.set(m.room, [...(groups.get(m.room) ?? []), tabId]);
			mine.set(tabId, m.room);
			return { tabId, targetInfo: { ...info(tabId), url: "about:blank" } };
		}
		if (m.do === "cdp") return m.method === "Page.fail" ? { error: "the page said no" } : { result: { did: m.method, tabId: m.tabId, ...(m.sessionId ? { inner: m.sessionId } : {}) } };
		return {};
	};
	return {
		asked,
		groups,
		attach: (h: ChromeHost) => void (host = h),
		/** What the host hands the extension. */
		take: (m: any) => {
			if (typeof m.id !== "number") return void asked.push(m);
			asked.push(m);
			queueMicrotask(() => host.fromExtension({ id: m.id, ...(answer(m) as object) }));
		},
		say: (m: unknown) => host.fromExtension(m),
		info,
	};
}

/** Playwright's side: a socket to the host's door, with what came through it. */
async function playwright(url: string, headers?: Record<string, string>) {
	const ws = new WebSocket(url, { headers });
	const got: any[] = [];
	let closed: number | undefined;
	ws.on("message", (d) => got.push(JSON.parse(String(d))));
	ws.on("close", (code) => (closed = code));
	ws.on("error", () => {});
	await until(() => ws.readyState === 1 || closed !== undefined, 3000, "the socket to open or to be refused");
	let id = 0;
	const send = async (method: string, params: unknown = {}, sessionId?: string) => {
		const n = ++id;
		ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
		await until(() => got.some((m) => m.id === n), 3000, `an answer to ${method}`);
		return got.find((m) => m.id === n);
	};
	return { ws, got, send, closed: () => closed, events: (method: string) => got.filter((m) => m.method === method) };
}

async function hostWith(t: { after(fn: () => void): void }) {
	const ext = fakeExtension();
	let ready = false;
	const host = new ChromeHost(ext.take, { extension: "9.9.9", onReady: () => void (ready = true) });
	ext.attach(host);
	t.after(() => host.close());
	ext.say({ ev: "hello", protocol: PROTOCOL, version: "0.1.0", agent: "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.60 Safari/537.36", browser: "Brave" });
	assert.equal(ready, true);
	await host.start();
	return { ext, host };
}

test("chrome host: messages travel as the browser frames them, a long one in pieces the extension joins again", () => {
	const got: unknown[] = [];
	const read = frames((m) => got.push(m));
	const small = { id: 1, do: "cdp", method: "Page.navigate", params: { url: "https://example.com/" } };
	const long = { id: 2, do: "cdp", method: "Runtime.evaluate", params: { expression: `"${"é\u2028x".repeat(40_000)}"` } };
	const out = Buffer.concat([...framed(small), ...framed(long, 50_000)]);
	// In whatever pieces the pipe delivers them.
	for (let i = 0; i < out.length; i += 7001) read(out.subarray(i, i + 7001));
	assert.deepEqual(got[0], small);
	const pieces = got.slice(1) as Array<{ part: { id: string; i: number; n: number; data: string } }>;
	assert.ok(pieces.length > 3 && pieces.every((p) => p.part.n === pieces.length && p.part.id === pieces[0].part.id));
	assert.ok(framed(long, 50_000).every((frame) => frame.length <= 50_000 * 1.4 + 200), "no piece is longer than the browser takes");
	// As extension/background.js joins them.
	const bytes = Buffer.from(pieces.sort((a, b) => a.part.i - b.part.i).map((p) => p.part.data).join(""), "base64");
	assert.deepEqual(JSON.parse(bytes.toString("utf8")), long);
});

test("chrome host: a conversation's browser is the tabs of its own group, the ones it opens and the ones the owner drags in, and no other tab", async (t) => {
	const { ext, host } = await hostWith(t);
	assert.deepEqual(ext.asked[0], { ev: "hello", protocol: PROTOCOL, extension: "9.9.9" });
	assert.match(host.url!, /^ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{64}$/);
	assert.deepEqual(host.browser, { name: "Brave", agent: host.browser.agent, version: "142.0.7444.60" });

	// Only who says the word, and no page of a browser, gets in.
	const wrong = await playwright(`${host.url!.slice(0, -4)}0000/main%3Amain`);
	await until(() => wrong.closed() !== undefined, 3000, "a wrong word to be refused");
	assert.equal(wrong.closed(), 1008);
	const page = await playwright(`${host.url}/main%3Amain`, { origin: "https://evil.example" });
	await until(() => page.closed() !== undefined, 3000, "a page to be refused");
	assert.equal(page.closed(), 1008);
	assert.ok(!ext.asked.some((m) => m.do), "nothing was asked of the browser for either");

	// The owner had two tabs in this conversation's group already; another conversation has one of its own.
	ext.groups.set("main:main", [7, 8]);
	ext.groups.set("scout:main", [9]);
	const pw = await playwright(`${host.url}/main%3Amain`);
	assert.deepEqual(ext.asked.find((m) => m.do === "enter"), { id: ext.asked.find((m) => m.do === "enter").id, do: "enter", room: "main:main", title: "pine · main" });
	assert.deepEqual((await pw.send("Browser.getVersion")).result.product, "Chrome/142.0.7444.60");
	await pw.send("Target.setAutoAttach", { autoAttach: true, flatten: true });
	const there = pw.events("Target.attachedToTarget").map((m) => m.params);
	assert.deepEqual(there.map((p) => p.targetInfo.targetId), ["T7", "T8"]);
	const [seven, eight] = there.map((p) => p.sessionId as string);

	// A command goes to the tab its session names, and to no other; what the page answers comes back, an error as an error.
	assert.deepEqual((await pw.send("Page.navigate", { url: "https://example.com/" }, eight)).result, { did: "Page.navigate", tabId: 8 });
	assert.deepEqual((await pw.send("Page.fail", {}, seven)).error, { code: -32000, message: "the page said no" });
	assert.match((await pw.send("Page.navigate", {}, "pine-999")).error.message, /No session with given id/);
	// A tab has no say over other tabs or the browser.
	for (const method of ["Target.createTarget", "Target.attachToTarget", "Browser.close", "Target.getTargets"]) assert.match((await pw.send(method, {}, seven)).error.message, /is not available here/, method);
	assert.match((await pw.send("Target.attachToBrowserTarget")).error.message, /is not available here/);
	assert.deepEqual((await pw.send("Target.getTargets")).result.targetInfos.map((i: any) => i.targetId), ["T7", "T8"], "only this conversation's tabs are listed");

	// A frame inside a tab is a session of that tab: its commands go to the tab with the frame's session.
	ext.say({ ev: "cdp", tabId: 8, method: "Target.attachedToTarget", params: { sessionId: "frame-1", targetInfo: { targetId: "F1", type: "iframe" } } });
	await until(() => pw.got.some((m) => m.method === "Target.attachedToTarget" && m.params.sessionId === "frame-1" && m.sessionId === eight), 3000, "the frame announced on its tab's session");
	assert.deepEqual((await pw.send("Runtime.enable", {}, "frame-1")).result, { did: "Runtime.enable", tabId: 8, inner: "frame-1" });
	ext.say({ ev: "cdp", tabId: 8, sessionId: "frame-1", method: "Runtime.consoleAPICalled", params: { type: "log" } });
	await until(() => pw.got.some((m) => m.method === "Runtime.consoleAPICalled" && m.sessionId === "frame-1"), 3000, "the frame's own event");

	// The agent opens a tab: it is made in this conversation's group.
	const made = await pw.send("Target.createTarget", { url: "about:blank" });
	const open = ext.asked.find((m) => m.do === "open");
	assert.deepEqual([open.room, open.title, open.url], ["main:main", "pine · main", "about:blank"]);
	assert.equal(made.result.targetId, "T101");
	assert.equal(pw.events("Target.attachedToTarget").at(-1).params.targetInfo.targetId, "T101");
	// An address that is no page of the web is not handed on.
	await pw.send("Target.createTarget", { url: "file:///etc/passwd" });
	assert.equal(ext.asked.filter((m) => m.do === "open").at(-1).url, "about:blank");

	// The owner drags a tab into the group: it is the agent's. A tab dragged into another conversation's group is not.
	ext.say({ ev: "joined", room: "main:main", tabId: 20, targetInfo: ext.info(20) });
	await until(() => pw.events("Target.attachedToTarget").some((m) => m.params.targetInfo.targetId === "T20"), 3000, "the dragged tab");
	ext.say({ ev: "joined", room: "scout:main", tabId: 21, targetInfo: ext.info(21) });
	ext.say({ ev: "cdp", tabId: 9, method: "Page.loadEventFired", params: {} });
	ext.say({ ev: "cdp", tabId: 21, method: "Page.loadEventFired", params: {} });
	// Dragged out again, or closed: gone for the agent.
	ext.say({ ev: "gone", tabId: 20 });
	await until(() => pw.events("Target.targetDestroyed").some((m) => m.params.targetId === "T20"), 3000, "the tab to be gone");
	assert.match((await pw.send("Page.navigate", {}, pw.events("Target.attachedToTarget").find((m) => m.params.targetInfo.targetId === "T20").params.sessionId)).error.message, /No session with given id/);
	assert.ok(!pw.got.some((m) => m.method === "Page.loadEventFired") && !pw.events("Target.attachedToTarget").some((m) => ["T9", "T21"].includes(m.params.targetInfo.targetId)), "nothing of another conversation's tabs");

	// The agent closes a tab of its group.
	assert.deepEqual((await pw.send("Target.closeTarget", { targetId: "T7" })).result, { success: true });
	assert.equal(ext.asked.find((m) => m.do === "close").tabId, 7);
	assert.deepEqual((await pw.send("Target.closeTarget", { targetId: "T9" })).result, { success: false }, "not a tab of another conversation");

	// The agent is done with its browser there (pine's browser server says so): the tabs pine opened are closed, by the extension, which knows them.
	const said = (at: string, headers?: Record<string, string>) => fetch(`${host.url!.replace("ws:", "http:")}${at}`, { method: "POST", headers }).then((r) => r.status);
	assert.equal(await said("/main%3Amain/bye"), 204);
	assert.deepEqual(ext.asked.filter((m) => m.do === "clear").map((m) => m.room), ["main:main"]);
	assert.equal(await said("/main%3Amain/bye", { origin: "https://evil.example" }), 404);
	assert.equal(await fetch(`http://127.0.0.1:${new URL(host.url!).port}/${"0".repeat(64)}/main%3Amain/bye`, { method: "POST" }).then((r) => r.status), 404);
	assert.equal(ext.asked.filter((m) => m.do === "clear").length, 1);

	// The conversation rests (its browser server ends): nobody stays attached, and no tab is closed for it.
	pw.ws.close();
	await until(() => ext.asked.some((m) => m.do === "leave"), 3000, "the browser told that nobody is attached");
	assert.deepEqual(ext.asked.filter((m) => m.do === "leave").map((m) => m.room), ["main:main"]);
	assert.equal(ext.asked.filter((m) => m.do === "clear").length, 1);
});

test("chrome host: a group is named for its conversation", () => {
	assert.equal(groupTitle("main:main"), "pine · main");
	assert.equal(groupTitle("scout:main"), "pine · scout");
	assert.equal(groupTitle("main:taxes-2026"), "pine · taxes-2026");
	assert.equal(groupTitle(`main:${"x".repeat(80)}`).length, "pine · ".length + 28);
});

test("chrome host: only pine's extension starts it; it says where its door is while the browser holds the pipe, and nothing after", { skip: process.platform === "win32" && "the host is started by a .bat file there, which this test does not make" }, async (t) => {
	const dir = tmp(t, "chrome-host");
	const file = path.join(dir, "data", "chrome", "host.json");
	const script = path.join(import.meta.dirname, "..", "mcp", "chrome.ts");
	const run = (...args: string[]) => spawn(process.execPath, [script, ...args], { stdio: ["pipe", "pipe", "pipe"] });
	const ended = (child: ReturnType<typeof run>) => new Promise<number | null>((r) => child.once("exit", r));

	// By hand, or for an extension that is not pine's: it does not start.
	assert.equal(await ended(run(file)), 1);
	assert.equal(await ended(run(file, `chrome-extension://${"a".repeat(32)}/`)), 1);
	assert.ok(!fs.existsSync(file));

	const child = run(file, `chrome-extension://${EXTENSION_IDS[0]}/`);
	t.after(() => child.kill());
	const got: any[] = [];
	child.stdout.on("data", frames((m) => got.push(m)));
	for (const frame of framed({ ev: "hello", protocol: PROTOCOL, version: "0.1.0", agent: "Mozilla/5.0 Chrome/142.0.0.0 Safari/537.36", browser: "Google Chrome" })) child.stdin.write(frame);
	await until(() => got.length > 0, 5000, "the host's hello");
	assert.deepEqual(got[0], { ev: "hello", protocol: PROTOCOL, extension: extensionVersion() });
	await until(() => fs.existsSync(file), 5000, "the host to say where its door is");
	const said = JSON.parse(fs.readFileSync(file, "utf8"));
	assert.deepEqual([said.browser, said.version, said.pid], ["Google Chrome", "142.0.0.0", child.pid]);
	assert.equal(fs.statSync(file).mode & 0o777, 0o600);
	// pine's browser server finds it the way it finds the Pine app's own browser.
	assert.equal(await appBrowser(file), said.url);
	assert.deepEqual(chromeState({ home: path.join(dir, "home"), dataDir: path.join(dir, "data"), account: dir }).connected, { browser: "Google Chrome", version: "142.0.0.0" });

	// The browser closes the pipe: the host ends, and nothing says a browser is there.
	child.stdin.end();
	assert.equal(await ended(child), 0);
	assert.ok(!fs.existsSync(file));
	assert.equal(chromeState({ home: path.join(dir, "home"), dataDir: path.join(dir, "data"), account: dir }).connected, undefined);
});

test("chrome: pine is registered with the browsers of an account when the owner asks, and with none before", async (t) => {
	for (const platform of ["darwin", "linux"] as const) {
		const account = tmp(t, "chrome-account");
		const base = platform === "darwin" ? path.join(account, "Library", "Application Support") : path.join(account, ".config");
		const [chrome, brave] = platform === "darwin" ? ["Google/Chrome", "BraveSoftware/Brave-Browser"] : ["google-chrome", "BraveSoftware/Brave-Browser"];
		for (const sub of [chrome, brave]) fs.mkdirSync(path.join(base, sub), { recursive: true });
		const w = { home: path.join(account, "pine home"), dataDir: path.join(account, "pine home", "data"), account, platform };
		const entry = (sub: string) => path.join(base, sub, "NativeMessagingHosts", `${HOST_NAME}.json`);

		// A start of pine writes nothing where the owner never connected it.
		refreshChrome(w);
		assert.deepEqual(chromeState(w), { set: false, browsers: [{ name: "Chrome", registered: false }, { name: "Brave", registered: false }], folder: chromeState(w).folder });
		assert.ok(!fs.existsSync(entry(chrome)) && !fs.existsSync(path.join(w.home, "chrome")));

		assert.deepEqual(connectChrome(w), ["Chrome", "Brave"]);
		const launcher = path.join(w.home, "chrome", "host");
		for (const sub of [chrome, brave]) {
			// The browser's own file: pine's launcher, and pine's extension alone may start it.
			assert.deepEqual(JSON.parse(fs.readFileSync(entry(sub), "utf8")), { name: HOST_NAME, description: "pine: lets your pine agents work in this browser", path: launcher, type: "stdio", allowed_origins: EXTENSION_IDS.map((id) => `chrome-extension://${id}/`) });
		}
		// The launcher: fixed text, the Node pine runs on, pine's own host, and where that says its door is. A path with a space or a quote stays one word.
		const text = fs.readFileSync(launcher, "utf8");
		assert.ok(text.startsWith("#!/bin/sh\n") && text.includes(`exec '${process.execPath}' '${path.join(import.meta.dirname, "..", "mcp", "chrome.ts")}' '${chromeFile(w.dataDir)}' "$@"`), text);
		assert.equal(fs.statSync(launcher).mode & 0o777, 0o700);
		// The extension as it lies with pine, for a browser that loads it from a folder.
		const state = chromeState(w);
		assert.equal(state.folder, path.join(w.home, "chrome", "extension"));
		assert.equal(JSON.parse(fs.readFileSync(path.join(state.folder, "manifest.json"), "utf8")).version, extensionVersion());
		assert.deepEqual([state.set, state.browsers.every((b) => b.registered), state.connected], [true, true, undefined]);

		// A browser that came later is known after the next start; what is in order is not written again.
		const before = fs.statSync(entry(chrome)).mtimeMs;
		fs.mkdirSync(path.join(base, platform === "darwin" ? "Microsoft Edge" : "microsoft-edge"));
		refreshChrome(w);
		assert.ok(chromeState(w).browsers.some((b) => b.name === "Edge" && b.registered));
		assert.equal(fs.statSync(entry(chrome)).mtimeMs, before);

		// Another home's entry in a browser is not this home's to take away.
		const other = { ...w, home: path.join(account, "other home"), dataDir: path.join(account, "other home", "data") };
		connectChrome(other);
		disconnectChrome(w);
		assert.equal(JSON.parse(fs.readFileSync(entry(chrome), "utf8")).path, path.join(other.home, "chrome", "host"));
		assert.ok(!fs.existsSync(path.join(w.home, "chrome")));
		disconnectChrome(other);
		assert.ok(!fs.existsSync(entry(chrome)) && !fs.existsSync(entry(brave)));
		assert.equal(chromeState(other).set, false);
	}
});

test("chrome: a launcher path with a quote in it stays one word of the shell", { skip: process.platform === "win32" && "a shell script" }, (t) => {
	const account = tmp(t, "chrome-quote");
	const w = { home: path.join(account, "it's here"), dataDir: path.join(account, "it's here", "data"), account, platform: "linux" as const };
	connectChrome(w);
	assert.ok(fs.readFileSync(path.join(w.home, "chrome", "host"), "utf8").includes(`'${path.join(account, "it'\\''s here", "data", "chrome", "host.json")}'`));
});

test("chrome: the owner connects their browser through the control API, and chooses it for all conversations with a setting", async (t) => {
	const account = tmp(t, "chrome-api");
	fs.mkdirSync(path.join(account, process.platform === "darwin" ? "Library/Application Support/Google/Chrome" : ".config/google-chrome"), { recursive: true });
	process.env.PINE_CHROME_ACCOUNT = account;
	t.after(() => delete process.env.PINE_CHROME_ACCOUNT);
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: {} } });
	t.after(() => h.close());
	const token = fs.readFileSync(path.join(h.home, "data", "http-token"), "utf8").trim();
	const api = async (method: string, at: string, body?: unknown) => {
		const res = await fetch(`http://127.0.0.1:${h.pine.http!.port}${at}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
		return { status: res.status, data: (await res.json()) as any };
	};
	assert.equal((await api("GET", "/chrome")).data.set, false);
	assert.equal((await api("POST", "/chrome", {})).status, 400);
	if (process.platform !== "win32") {
		const on = (await api("POST", "/chrome", { connect: true })).data;
		assert.deepEqual([on.set, on.browsers, on.folder], [true, [{ name: "Chrome", registered: true }], path.join(h.home, "chrome", "extension")]);
		assert.equal((await api("POST", "/chrome", { connect: false })).data.set, false);
	}
	// The setting: pine's own browser unless the owner says theirs, and the owner is told what theirs means.
	const cfg = h.pine.cfg;
	assert.equal(cfg.defaults.browser, undefined);
	assert.match(String(checkSetting(cfg, "defaults.browser", "chrome", []).wider), /logged in as you/);
	assert.equal(checkSetting(cfg, "defaults.browser", "pine", []).wider, undefined);
	assert.throws(() => checkSetting(cfg, "defaults.browser", "firefox", []), /one of: pine, chrome/);
	// What its agent last did about it in a conversation holds over the setting, and goes with the conversation.
	const agents = h.pine.agents as any;
	assert.equal(agents.inChrome("main:talk"), false);
	agents.kv.set("chrome:main:talk", true);
	assert.equal(agents.inChrome("main:talk"), true);
	assert.equal(agents.inChrome("main:other"), false);
});

// The real extension in a real Chromium (the build Playwright has), with the real host started by that browser and
// pine's browser server on top: folders of its own for all of it, and a page of its own on the loopback. Only with PINE_LIVE=1.
test("live: an agent works in a tab group of the owner's own browser, in the tabs it opens and the ones dragged in", { skip: process.env.PINE_LIVE !== "1" || process.platform === "win32", timeout: 120_000 }, async (t) => {
	const require = createRequire(import.meta.url);
	const { chromium } = require("playwright-core") as typeof import("playwright-core");
	const bin = chromium.executablePath();
	if (!fs.existsSync(bin)) return t.skip("the browser is not on this computer: pine browser-install");
	const dir = tmp(t, "chrome-live");
	const account = path.join(dir, "account");
	const profile = process.platform === "darwin" ? path.join(account, "Library", "Application Support", "Chromium") : path.join(account, ".config", "chromium");
	fs.mkdirSync(profile, { recursive: true });
	const w = { home: path.join(dir, "home"), dataDir: path.join(dir, "home", "data"), account };
	assert.deepEqual(connectChrome(w), ["Chromium"]);

	const site = http.createServer((req, res) => {
		res.writeHead(200, { "content-type": "text/html" });
		res.end(req.url === "/owner" ? "<title>Owner's page</title><h1>The owner's own tab</h1><p>owner-text</p>" : `<title>Trial</title><h1>Trial page</h1><button onclick="this.textContent='clicked '+(window.n=(window.n||0)+1)">press me</button>`);
	});
	await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
	t.after(() => site.close());
	const base = `http://127.0.0.1:${(site.address() as { port: number }).port}`;

	const ext = chromeState(w).folder;
	const browser = spawn(bin, [`--user-data-dir=${profile}`, "--headless=new", `--load-extension=${ext}`, `--disable-extensions-except=${ext}`, "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
	t.after(() => browser.kill());
	let err = "";
	browser.stderr.on("data", (d) => (err += d));
	await until(() => /DevTools listening on ws:\S+/.test(err), 20_000, "the browser");
	// The protocol to the browser itself, for the extension's worker alone (to play the owner's hand on the tab strip): no page is touched from here.
	const cdp = new WebSocket(err.match(/DevTools listening on (ws:\S+)/)![1]);
	t.after(() => cdp.close());
	await new Promise((r) => cdp.once("open", r));
	const answers = new Map<number, (m: any) => void>();
	cdp.on("message", (d) => ((m) => answers.get(m.id)?.(m))(JSON.parse(String(d))));
	let n = 0;
	const send = (method: string, params: unknown = {}, sessionId?: string) => new Promise<any>((r) => (answers.set(++n, r), cdp.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }))));
	let worker: any;
	await until(async () => (worker = (await send("Target.getTargets")).result.targetInfos.find((x: any) => x.type === "service_worker" && x.url.includes(EXTENSION_IDS[0]))), 20_000, "the extension's worker");
	const { sessionId } = (await send("Target.attachToTarget", { targetId: worker.targetId, flatten: true })).result;
	const owner = async (expression: string) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId)).result.result.value;
	await until(() => chromeState(w).connected, 20_000, "the extension to reach pine's host");
	assert.equal(chromeState(w).connected!.browser, "Chromium");

	// pine's browser server, as the daemon starts it for an owner's conversation whose browser is the owner's own.
	const options = { window: true, viewFile: path.join(dir, "view.json"), localFile: path.join(dir, "local.json"), chromeFile: chromeFile(w.dataDir), room: "main:main", chrome: true };
	const server = spawn(process.execPath, [path.join(import.meta.dirname, "..", "mcp", "browser.ts")], { env: { ...process.env, PINE_MCP_OPTIONS: JSON.stringify(options) }, stdio: ["pipe", "pipe", "ignore"] });
	t.after(() => server.kill());
	const got = new Map<number, any>();
	let buf = "";
	server.stdout.on("data", (d) => {
		buf += d;
		for (let i; (i = buf.indexOf("\n")) >= 0; buf = buf.slice(i + 1)) {
			try {
				const m = JSON.parse(buf.slice(0, i));
				if (typeof m.id === "number") got.set(m.id, m);
			} catch {}
		}
	});
	let id = 0;
	const rpc = async (method: string, params: unknown) => {
		const k = ++id;
		server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: k, method, params })}\n`);
		await until(() => got.has(k), 60_000, `an answer to ${method}`);
		return got.get(k);
	};
	const call = async (name: string, args: unknown = {}) => {
		const r = (await rpc("tools/call", { name, arguments: args })).result;
		return { text: (r?.content ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n") as string, failed: r?.isError === true, picture: (r?.content ?? []).some((p: any) => p.type === "image") };
	};
	await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } });
	server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
	// It finds the owner's browser and moves there before the first call is carried out.
	let nav = await call("browser_to_chrome");
	assert.ok(!nav.failed, nav.text);
	nav = await call("browser_navigate", { url: base });
	assert.ok(!nav.failed && nav.text.includes("Trial page"), nav.text);

	// The page is a tab in a group named for the conversation, and that tab is not in front.
	const groups = await owner("chrome.tabGroups.query({})");
	assert.deepEqual(groups.map((g: any) => g.title), ["pine · main"]);
	const tabs = await owner(`chrome.tabs.query({groupId: ${groups[0].id}}).then(ts => ts.map(t => ({id: t.id, url: t.url})))`);
	const tab = tabs.find((x: any) => x.url.startsWith(base));
	assert.ok(tab, JSON.stringify(tabs));

	// A click works there although the tab is behind the owner's own, a picture comes, and the owner sees where the pointer went.
	const ref = nav.text.match(/button "press me" \[ref=(\w+)\]/)?.[1];
	const click = await call("browser_click", { element: "press me", ref, target: ref });
	assert.ok(!click.failed && click.text.includes("clicked 1"), click.text);
	assert.ok((await call("browser_take_screenshot")).picture);
	assert.equal(await owner(`chrome.scripting.executeScript({target:{tabId:${tab.id}}, world:"ISOLATED", func: () => Boolean(globalThis.pinePointer?.host.isConnected)}).then(r => r[0].result)`), true);

	// A tab of the owner's outside the group is none of the agent's. Dragged into the group, it is, and the agent is told and reads it.
	const theirs = await owner(`chrome.tabs.create({url: ${JSON.stringify(`${base}/owner`)}, active: false}).then(t => t.id)`);
	await until(async () => (await owner(`chrome.tabs.get(${theirs}).then(t => t.status)`)) === "complete", 10_000, "the owner's tab");
	assert.ok(!(await call("browser_tabs", { action: "list" })).text.includes("Owner's page"));
	await owner(`chrome.tabs.group({tabIds:[${theirs}], groupId:${groups[0].id}})`);
	await until(async () => (await owner("chrome.debugger.getTargets().then(ts => ts.filter(t => t.attached && t.tabId !== undefined).length)")) === 2, 10_000, "the dragged tab to be the agent's");
	let snap = await call("browser_snapshot");
	// (A tab that came in the very moment of a look is said with the next call.)
	if (!snap.text.startsWith("The browser has changed")) snap = await call("browser_snapshot");
	assert.ok(snap.text.startsWith("The browser has changed since you last looked") && snap.text.includes("owner-text"), snap.text);
	// Dragged out again: the owner's alone, and nobody is attached to it.
	await owner(`chrome.tabs.ungroup([${theirs}])`);
	await until(async () => !(await call("browser_tabs", { action: "list" })).text.includes("Owner's page"), 10_000, "the tab to leave the agent");
	assert.deepEqual(await owner("chrome.debugger.getTargets().then(ts => ts.filter(t => t.attached && t.tabId !== undefined).map(t => t.tabId))"), [tab.id]);

	// Back to pine's own browser: the tab pine opened is closed, the owner's stays, and nothing stays attached.
	await owner(`chrome.tabs.group({tabIds:[${theirs}], groupId:${groups[0].id}})`);
	await until(async () => (await owner("chrome.debugger.getTargets().then(ts => ts.filter(t => t.attached && t.tabId !== undefined).length)")) === 2, 10_000, "the dragged tab again");
	const back = await call("browser_to_pine");
	assert.ok(!back.failed && back.text.startsWith("The browser is pine's own again."), back.text);
	await until(async () => (await owner("chrome.debugger.getTargets().then(ts => ts.filter(t => t.attached && t.tabId !== undefined).length)")) === 0, 10_000, "nobody attached");
	const left = await owner("chrome.tabs.query({}).then(ts => ts.map(t => t.url))");
	assert.ok(!left.includes(`${base}/`) && left.includes(`${base}/owner`), JSON.stringify(left));
});
