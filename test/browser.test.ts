import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import dgram from "node:dgram";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ALWAYS_BLOCKED, ASK_HINT, cleanOps, CORE_TOOLS, inlineFiles, relay, startGuardProxy, startViewDoor, toolAllowed, vet, webAddress } from "../mcp/browser.ts";
import { browserSession } from "../src/agents.ts";
import { keptAddress, VISITED } from "../src/browser-view.ts";
import { localTarget } from "../src/net.ts";
import { effectiveMcp, loadConfig, mcpTaints, toPiMcp } from "../src/config.ts";
import { assertPrivate, harness, mockMsg, notesOf, until } from "./support/harness.ts";

test("browser: tools that run code or read local files are never offered", () => {
	for (const name of ALWAYS_BLOCKED) for (const tools of ["core", "all", [name]] as const) assert.equal(toolAllowed(name, { tools: tools as any }), false, `${name} with ${tools}`);
	assert.ok(ALWAYS_BLOCKED.includes("browser_run_code_unsafe") && ALWAYS_BLOCKED.includes("browser_file_upload"));
	assert.ok(toolAllowed("browser_navigate", {}) && toolAllowed("browser_snapshot", {}) && CORE_TOOLS.includes("browser_click"));
	assert.equal(toolAllowed("browser_evaluate", {}), false, "not in the core set");
	assert.ok(toolAllowed("browser_take_screenshot", {}) && toolAllowed("browser_console_messages", {}), "an agent that builds a page can look at it and see why it fails");
	assert.equal(toolAllowed("browser_evaluate", { tools: "all" }), true);
	assert.equal(toolAllowed("browser_evaluate", { tools: "all", block: ["browser_evaluate"] }), false);
	assert.equal(toolAllowed("browser_click", { tools: ["browser_navigate"] }), false);
});

test("browser: destinations are vetted before the browser may connect", async () => {
	for (const host of ["127.0.0.1", "localhost", "printer.local", "10.0.0.5", "192.168.1.1", "169.254.169.254", "[::1]", "[fd00::1]", "nas.internal"]) await assert.rejects(() => vet(host, {}), /private address|local name/, host);
	assert.equal(await vet("93.184.216.34", {}), "93.184.216.34");
	assert.equal(await vet("127.0.0.1", { allowPrivate: true }), "127.0.0.1");
	await assert.rejects(() => vet("93.184.216.34", { denyHosts: ["93.184.216.34"] }), /deny list/);
	await assert.rejects(() => vet("93.184.216.34", { allowHosts: ["example.org"] }), /not on the allow list/);
	await assert.rejects(() => vet("tracker.ads.example", { denyHosts: ["ads.example"] }), /deny list/);
});

test("browser: the guard proxy lets vetted traffic through and refuses the rest, for http and for tunnels", async (t) => {
	const target = http.createServer((_req, res) => res.end("LOCAL-SERVICE-SECRET"));
	await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
	const port = (target.address() as net.AddressInfo).port;
	t.after(() => target.close());

	const viaProxy = (proxyPort: number) =>
		new Promise<{ status: number; body: string }>((resolve, reject) => {
			const req = http.request({ host: "127.0.0.1", port: proxyPort, method: "GET", path: `http://127.0.0.1:${port}/x`, headers: { host: `127.0.0.1:${port}` } }, (res) => {
				let body = "";
				res.on("data", (d) => (body += d)).on("end", () => resolve({ status: res.statusCode ?? 0, body }));
			});
			req.on("error", reject).end();
		});
	const tunnel = (proxyPort: number) =>
		new Promise<string>((resolve) => {
			const s = net.connect(proxyPort, "127.0.0.1", () => s.write(`CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`));
			let data = "";
			let sent = false;
			s.on("data", (d) => {
				data += d;
				if (!sent && data.includes("200 Connection Established")) {
					sent = true;
					s.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
				}
			});
			s.on("close", () => resolve(data));
		});

	const strict = await startGuardProxy({});
	t.after(() => strict.close());
	const refused = await viaProxy(strict.port);
	assert.equal(refused.status, 403);
	assert.ok(!refused.body.includes("LOCAL-SERVICE-SECRET") && /not reachable from the browser/.test(refused.body));
	const refusedTunnel = await tunnel(strict.port);
	assert.ok(/^HTTP\/1.1 403/.test(refusedTunnel) && !refusedTunnel.includes("LOCAL-SERVICE-SECRET"));
	assert.equal(strict.refused.length, 2);

	const open = await startGuardProxy({ allowPrivate: true });
	t.after(() => open.close());
	assert.deepEqual(await viaProxy(open.port), { status: 200, body: "LOCAL-SERVICE-SECRET" });
	assert.ok((await tunnel(open.port)).includes("LOCAL-SERVICE-SECRET"));
});

test("browser: a local address opens only where the owner allowed that host and port", async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pine-browser-local-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const localFile = path.join(dir, "allowed.json");
	const serve = async (text: string) => {
		const s = http.createServer((_req, res) => res.end(text));
		await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
		t.after(() => s.close());
		return (s.address() as net.AddressInfo).port;
	};
	const [dev, other] = [await serve("DEV-SERVER-PAGE"), await serve("OTHER-LOCAL-SECRET")];
	const get = (proxyPort: number, port: number) =>
		new Promise<{ status: number; body: string }>((resolve, reject) => {
			const req = http.request({ host: "127.0.0.1", port: proxyPort, path: `http://127.0.0.1:${port}/`, headers: { host: `127.0.0.1:${port}` } }, (res) => {
				let body = "";
				res.on("data", (d) => (body += d)).on("end", () => resolve({ status: res.statusCode ?? 0, body }));
			});
			req.on("error", reject).end();
		});
	const tunnel = (proxyPort: number, port: number) =>
		new Promise<string>((resolve) => {
			const s = net.connect(proxyPort, "127.0.0.1", () => s.write(`CONNECT 127.0.0.1:${port} HTTP/1.1\r\n\r\n`));
			let data = "";
			let sent = false;
			s.on("data", (d) => {
				data += d;
				if (!sent && data.includes("200 Connection Established")) {
					sent = true;
					s.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
				}
			});
			s.on("close", () => resolve(data));
		});

	const proxy = await startGuardProxy({ localFile });
	t.after(() => proxy.close());
	// No yes yet (the file is not there): refused, and the agent is told how the owner gets asked.
	const before = await get(proxy.port, dev);
	assert.equal(before.status, 403);
	assert.ok(before.body.includes(ASK_HINT) && !before.body.includes("DEV-SERVER-PAGE"), before.body);

	// The yes applies at once, to that host and port and to nothing else.
	fs.writeFileSync(localFile, JSON.stringify([`127.0.0.1:${dev}`]));
	assert.deepEqual(await get(proxy.port, dev), { status: 200, body: "DEV-SERVER-PAGE" });
	assert.ok((await tunnel(proxy.port, dev)).includes("DEV-SERVER-PAGE"));
	assert.equal((await get(proxy.port, other)).status, 403);
	assert.ok(!(await tunnel(proxy.port, other)).includes("OTHER-LOCAL-SECRET"));
	await assert.rejects(() => vet("127.0.0.1", { localFile }), /private address/, "no port, no exception");
	await assert.rejects(() => vet("localhost", { localFile }, dev), /local name/, "another name for the same machine was not allowed");
	await assert.rejects(() => vet("127.0.0.1", { localFile, denyHosts: ["127.0.0.1"] }, dev), /deny list/, "the owner's host lists come first");
	await assert.rejects(() => vet("127.0.0.1", { localFile, allowHosts: ["example.org"] }, dev), /allow list/);

	// Taken back (a reset removes the file), or a file that is not a list: closed again.
	fs.writeFileSync(localFile, JSON.stringify({ [`127.0.0.1:${dev}`]: true }));
	assert.equal((await get(proxy.port, dev)).status, 403);
	fs.rmSync(localFile);
	assert.equal((await get(proxy.port, dev)).status, 403);

	// Without the file option (a run started from outside) there is nobody to ask, and no hint.
	const strict = await startGuardProxy({});
	t.after(() => strict.close());
	assert.ok(!(await get(strict.port, dev)).body.includes(ASK_HINT));
});

test("browser: only a host that is local by its own name can be asked about", () => {
	const key = (url: string) => localTarget(url)?.key;
	assert.equal(key("http://localhost:5173/app?x=1"), "localhost:5173");
	assert.equal(key("localhost:5173"), "localhost:5173", "written the way people say it");
	assert.equal(key("http://LOCALHOST/"), "localhost:80");
	assert.equal(key("https://192.168.1.247/"), "192.168.1.247:443");
	assert.equal(key("http://127.1:8080/"), "127.0.0.1:8080", "the address the browser would connect to, not the spelling");
	assert.equal(key("http://[::1]:3000/"), "[::1]:3000");
	assert.equal(key("http://printer.local:631/"), "printer.local:631");
	for (const url of ["https://example.com/", "http://93.184.216.34:5173/", "http://nas.home/", "http://localhost.evil.example/", "file:///etc/passwd", "javascript:alert(1)", "", "not a url"]) assert.equal(localTarget(url), undefined, url);
	assert.equal(localTarget(undefined), undefined);
});

test("browser: opening a local address asks the owner, and the yes holds for that conversation only", { timeout: 60_000 }, async (t) => {
	const target = http.createServer((_req, res) => res.end("DEV"));
	await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
	t.after(() => target.close());
	const port = (target.address() as net.AddressInfo).port;
	// No browser is started: the program it would run does not exist. What is tested is who gets asked.
	const h = await harness({ pine: { http: { port: 0 }, mcp: { browser: { pine: "browser", options: { executablePath: "/nonexistent/browser" } } } }, agents: { main: { agent: { untrusted: { mcp: ["browser"] } } } } });
	let answer = false;
	const asked: any[] = [];
	h.pine.bus.subscribe("approval/requested", (e) => {
		asked.push(e.payload);
		h.pine.approvals.decide((e.payload as any).id, answer, "test");
	});
	const open = (url: string, o: Record<string, unknown> = {}) => h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [{ name: "mcp__browser__browser_navigate", args: { url } }] }]), trust: "owner", ...o } as any);
	const file = (session = "main") => path.join(h.pine.cfg.dataDir, "browser-local", `${encodeURIComponent(`main:${session}`)}.json`);
	const url = `http://127.0.0.1:${port}/`;

	// A no: the call does not happen and nothing is opened.
	await open(url);
	assert.equal(asked.length, 1);
	assert.ok(asked[0].summary.includes(url) && asked[0].summary.includes(`127.0.0.1:${port}`) && asked[0].why.includes("for this conversation"), JSON.stringify(asked[0]));
	assert.equal(asked[0].remember, undefined);
	assert.match(h.toolResults().at(-1)!, /not approved \(test\)\. The browser cannot open/);
	assert.ok(!fs.existsSync(file()));

	// A yes: written where the guard reads it, and not asked again.
	answer = true;
	await open(url);
	assert.equal(asked.length, 2);
	assert.ok(!asked[1].why.includes("Careful"));
	assert.deepEqual(JSON.parse(fs.readFileSync(file(), "utf8")), [`127.0.0.1:${port}`]);
	assert.ok(!/not approved/.test(h.toolResults().at(-1)!));
	await open(`${url}other/page`);
	assert.equal(asked.length, 2, "the same host and port");

	// Another port, another conversation: asked again. A public address: never.
	await open(`http://127.0.0.1:${port + 1}/`);
	assert.equal(asked.length, 3);
	assert.ok(asked[2].why.includes("Careful: this conversation has read outside content"), "by now the browser has been used here");
	await open(url, { session: "second" });
	assert.equal(asked.length, 4);
	assert.deepEqual(JSON.parse(fs.readFileSync(file("second"), "utf8")), [`127.0.0.1:${port}`]);
	await open("https://example.com/", { session: "third" });
	assert.equal(asked.length, 4);

	// pine's own control port is not put to the owner at all.
	const control = h.pine.cfg.http!.port;
	assert.ok(control > 0);
	await open(`http://localhost:${control}/api/status`);
	assert.match(h.toolResults().at(-1)!, /pine's own control port/);
	assert.equal(asked.length, 4);

	// A run that outside content started cannot ask, and its browser has no list to read.
	await open(url, { trust: "untrusted", session: "outside" });
	assert.equal(asked.length, 4);
	assert.ok(!/not found|not approved/.test(h.toolResults().at(-1)!), "it has the browser, and the guard is what refuses");
	assert.ok(!fs.existsSync(file("outside")) && !fs.existsSync(file("outside~u")));

	// A reset takes the yes back; so does a restart.
	await h.pine.agents.resetSession("main", "main");
	assert.ok(!fs.existsSync(file()));
	assert.ok(fs.existsSync(file("second")));
	await h.restart();
	assert.ok(!fs.existsSync(file("second")));
	await h.close();
});

test("browser: page snapshots written to the scratch folder are put into the result; other files are not", (t) => {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pine-browser-test-"));
	t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
	fs.writeFileSync(path.join(scratch, "page.yml"), '- heading "Hello" [ref=e2]\n- button "Go" [ref=e3]\n');
	fs.writeFileSync(path.join(scratch, "big.yml"), "x".repeat(5000));
	const out = inlineFiles(`### Snapshot\n- [Snapshot](${path.join(scratch, "page.yml")})\n- [Secrets](/etc/hosts)\n- [Snapshot](${path.join(scratch, "big.yml")}#L1)`, scratch, 1000);
	assert.ok(out.includes('Snapshot:\n- heading "Hello" [ref=e2]\n- button "Go" [ref=e3]'));
	assert.ok(out.includes("[Secrets](/etc/hosts)"), "a link outside the scratch folder stays a link");
	assert.ok(out.includes("[cut: 4000 more characters"));
});

test("browser: a screenshot's bytes are not put into the result as text", (t) => {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pine-browser-test-"));
	t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
	const shot = path.join(scratch, "page.png");
	fs.writeFileSync(shot, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from("IHDR-and-more".repeat(50))]));
	const out = inlineFiles(`### Result\n- [Screenshot of viewport](${shot})`, scratch);
	assert.equal(out, `### Result\n- Screenshot of viewport: saved as ${fs.realpathSync(shot)}`);
});

// A stand-in for Playwright's server: it says whether it has a window, keeps cookies only when
// they are handed over in a file, and fails where the test tells it to.
const FAKE_BROWSER = `
import fs from "node:fs";
import readline from "node:readline";
const [mode, log, ...flags] = process.argv.slice(2);
const note = (line) => fs.appendFileSync(log, line + "\\n");
note("start " + mode);
let tabs = ["about:blank"], at = 0, cookies = "none", shots = 0;
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
const page = () => "### Page\\n- Page URL: " + tabs[at] + "\\n- window: " + mode + "\\n- cookies: " + cookies;
// What the owner does in the window meanwhile: lines "goto <address>" and "newtab <address>" in a file beside the log.
const owner = () => {
	if (!fs.existsSync(log + ".owner")) return;
	for (const line of fs.readFileSync(log + ".owner", "utf8").split("\\n").filter(Boolean)) {
		const [what, where] = line.split(" ");
		if (what === "goto") tabs[at] = where;
		else tabs.push(where);
	}
	fs.rmSync(log + ".owner");
};
readline.createInterface({ input: process.stdin }).on("line", (line) => {
	const m = JSON.parse(line);
	// Like the real server: a message with a field that a request does not have is dropped without an answer.
	if (Object.keys(m).some((k) => !["jsonrpc", "id", "method", "params"].includes(k))) return;
	if (m.method === "initialize") return send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "0" } } });
	if (m.method === "tools/list") return send({ jsonrpc: "2.0", id: m.id, result: { tools: ["browser_navigate", "browser_take_screenshot", "browser_storage_state", "browser_cookie_list", "browser_run_code_unsafe", "browser_mouse_wheel", "browser_mouse_click_xy"].map((name) => ({ name, inputSchema: { type: "object" } })) } });
	if (m.method !== "tools/call") return;
	const a = m.params.arguments ?? {};
	const reply = (text, isError) => send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) } });
	owner();
	fs.appendFileSync(log + ".raw", m.params.name + (a.action ? " " + a.action : "") + "\\n");
	// What pine's own server does for the owner's window: a picture into a file it names, the owner's hand as code.
	if (m.params.name === "browser_run_code_unsafe") {
		const dir = log.slice(0, Math.max(log.lastIndexOf("/"), log.lastIndexOf("\\\\")));
		if (!fs.existsSync(dir + "/first-code.txt")) fs.writeFileSync(dir + "/first-code.txt", a.code);
		fs.writeFileSync(dir + "/last-code.txt", a.code);
		const ops = JSON.parse(a.code.match(/const ops = (.*);\\n/)[1]);
		note("hand " + JSON.stringify(ops));
		if (ops.some((o) => o.do === "key" && o.key === "Enter")) tabs[at] = "https://moved.example/";
		// Like the real server, which waits for the page to settle after the code: here only for a reload, and longer.
		if (ops.some((o) => o.do === "reload")) return setTimeout(() => (note("reloaded"), reply("### Result\\ntrue")), 400);
		return reply("### Result\\ntrue");
	}
	if (m.params.name === "browser_take_screenshot" && a.filename) {
		note(m.params.name + " " + a.scale);
		const file = log.slice(0, Math.max(log.lastIndexOf("/"), log.lastIndexOf("\\\\"))) + "/" + a.filename;
		const url = tabs[at];
		fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("picture of " + url)]));
		return setTimeout(() => (url.includes("slow.") && note("picture taken"), reply("### Result\\n- [Screenshot of viewport](" + file + ")")), url.includes("slow.") ? 300 : 0);
	}
	if (m.params.name === "browser_mouse_down" || m.params.name === "browser_mouse_up") return note(m.params.name + " " + a.button), reply("ok");
	if (m.params.name === "browser_press_key") return note(m.params.name + " " + a.key), reply("ok");
	if (m.params.name === "browser_mouse_wheel") return note(m.params.name + " " + a.deltaX + "," + a.deltaY), reply("ok");
	if (m.params.name === "browser_mouse_move_xy") return note(m.params.name + " " + a.x + "," + a.y), reply("ok");
	if (m.params.name !== "browser_tabs" || a.action !== "list") note(m.params.name + (a.url ? " " + a.url : "") + (a.action ? " " + a.action + (a.index ?? "") : ""));
	switch (m.params.name) {
		case "browser_navigate":
			if (mode === "headed" && flags.includes("no-screen")) return reply("### Error\\nError: browserType.launch: Missing X server or $DISPLAY", true);
			tabs[at] = a.url;
			return reply(page());
		case "browser_tabs":
			if (a.action === "select") at = a.index;
			if (a.action === "new") at = tabs.push(a.url ?? "about:blank") - 1;
			if (a.action === "close") (tabs.splice(a.index ?? at, 1), (at = Math.min(at, tabs.length - 1)));
			return reply("### Result\\n" + tabs.map((u, i) => "- " + i + ":" + (i === at ? " (current)" : "") + " [Page " + i + "](" + u + ")").join("\\n"));
		case "browser_snapshot":
			return reply(page() + "\\n### Snapshot\\n- heading of " + tabs[at] + (tabs[at].includes("sep.") ? " with \u2028 inside" : ""));
		case "login":
			cookies = "session=abc";
			return reply(page());
		case "browser_storage_state":
			fs.writeFileSync(a.filename, cookies);
			return reply("saved");
		case "browser_set_storage_state":
			cookies = fs.readFileSync(a.filename, "utf8");
			return reply("restored");
		case "browser_take_screenshot":
			return ++shots === 1 ? reply("### Error\\nTimeoutError: browserBackend.callTool: Timeout 5000ms exceeded.\\n  - waiting for fonts to load...", true) : reply("### Result\\n- shot " + shots);
		case "browser_close":
			return reply("closed");
	}
	reply("ok");
});
`;

async function fakeBrowser(t: { after(fn: () => void): void }, o: Record<string, unknown>, ...flags: string[]) {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pine-browser-test-"));
	const script = path.join(scratch, "fake.mjs");
	const log = path.join(scratch, "log.txt");
	fs.writeFileSync(script, FAKE_BROWSER);
	const got = new Map<unknown, any>();
	let ended = false;
	const refused: string[] = [];
	const server = relay(o as any, {
		launch: (headed, host) => spawn(process.execPath, [script, host ? "hosted" : headed ? "headed" : "hidden", log, ...flags], { stdio: ["pipe", "pipe", "inherit"] }),
		send: (msg: any) => void got.set(msg.id, msg),
		scratch,
		refused,
		ended: () => void (ended = true),
		// The Pine app's own browser, while a test says it is there (`app`).
		host: o.app ? async () => (fs.existsSync(path.join(scratch, "app")) ? fs.readFileSync(path.join(scratch, "app"), "utf8") : undefined) : undefined,
	});
	t.after(() => (server.child().kill(), fs.rmSync(scratch, { recursive: true, force: true })));
	let id = 0;
	const rpc = async (method: string, params?: unknown) => {
		const n = ++id;
		server.line(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }));
		await until(() => got.has(n), 5000, `an answer to ${method} ${JSON.stringify(params)}`);
		return got.get(n);
	};
	const call = async (name: string, args: unknown = {}) => {
		const r = (await rpc("tools/call", { name, arguments: args })).result;
		return { text: r.content.map((p: any) => p.text).join("\n") as string, failed: r.isError === true };
	};
	await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } });
	const app = (url?: string) => (url ? fs.writeFileSync(path.join(scratch, "app"), url) : fs.rmSync(path.join(scratch, "app"), { force: true }));
	return { rpc, call, app, scratch, refused, view: server.view, log: () => fs.readFileSync(log, "utf8").trim().split("\n"), raw: () => fs.readFileSync(`${log}.raw`, "utf8").trim().split("\n"), ended: () => ended, owner: (...lines: string[]) => fs.writeFileSync(`${log}.owner`, lines.join("\n")) };
}

test("browser: with a window the owner uses it too: the agent is moved to the page they opened and does not leave a page it has not seen", async (t) => {
	const b = await fakeBrowser(t, { window: true, tools: "all" });
	await b.call("browser_navigate", { url: "https://en.wikipedia.org/" });
	await b.call("browser_show");

	// The owner goes to a shop in the tab that is open. The agent, told to search, tries to go to a search engine.
	b.owner("goto https://shop.example/");
	const stopped = await b.call("browser_navigate", { url: "https://search.example/?q=shampoo" });
	assert.ok(stopped.text.startsWith("Not done: the browser is not where you left it.") && stopped.text.includes("Page 0 (https://shop.example/)") && stopped.text.includes("- heading of https://shop.example/"), stopped.text);
	assert.ok(!b.log().includes("browser_navigate https://search.example/?q=shampoo"), "the owner's page was not left");
	// It has seen the page now: the same call again is its decision, and is carried out.
	assert.match((await b.call("browser_navigate", { url: "https://shop.example/s?k=shampoo" })).text, /Page URL: https:\/\/shop\.example\/s\?k=shampoo/);

	// The owner opens another tab. A look goes through, on that tab, and says so; so does what follows.
	b.owner("newtab https://mail.example/inbox");
	const looked = await b.call("browser_snapshot");
	assert.ok(looked.text.startsWith("The browser has changed since you last looked") && looked.text.includes("Page 1 (https://mail.example/inbox)") && looked.text.includes("- heading of https://mail.example/inbox"), looked.text);
	assert.ok(b.log().includes("browser_tabs select1"), "the agent was moved to the owner's tab");
	assert.ok(!(await b.call("browser_snapshot")).text.startsWith("The browser has changed"), "nothing changed since: no note");

	// A page that moves within itself is the same page; the agent's own new tab is its own doing.
	b.owner("goto https://mail.example/inbox#message-4");
	assert.match((await b.call("browser_click", { ref: "e1" })).text, /^ok$/);
	await b.call("browser_tabs", { action: "new", url: "https://search.example/" });
	assert.match((await b.call("browser_navigate", { url: "https://search.example/?q=x" })).text, /Page URL: https:\/\/search\.example\/\?q=x/);

	// Without a window nobody else is in the browser, and nothing is compared.
	await b.call("browser_hide");
	b.owner("goto https://elsewhere.example/");
	assert.match((await b.call("browser_navigate", { url: "https://search.example/?q=y" })).text, /Page URL: https:\/\/search\.example\/\?q=y/);
});

test("browser: in the owner's conversation the agent puts the browser on the screen and takes it off, on the same page with the same login", async (t) => {
	const b = await fakeBrowser(t, { window: true, tools: [...CORE_TOOLS, "login"] });
	const names = (await b.rpc("tools/list")).result.tools.map((x: any) => x.name);
	assert.deepEqual(names, ["browser_navigate", "browser_take_screenshot", "browser_show", "browser_hide"], "the window tools are offered; what reads cookies or runs code is not");

	// Nothing open yet: showing it still opens a window, on an empty page.
	assert.match((await b.call("browser_hide")).text, /has no window/);
	const empty = await b.call("browser_show");
	assert.ok(!empty.failed && empty.text.includes("now a window on your owner's screen") && empty.text.includes("- window: headed"), empty.text);
	assert.match((await b.call("browser_show")).text, /already a window/);
	assert.ok(!(await b.call("browser_hide")).failed);

	// A page and a login, without a window. Shown: the same page, the login still there. Hidden again: the same.
	await b.call("browser_navigate", { url: "https://shop.example/account" });
	assert.match((await b.call("login")).text, /window: hidden\n- cookies: session=abc/);
	const shown = await b.call("browser_show");
	assert.ok(shown.text.includes("- Page URL: https://shop.example/account\n- window: headed\n- cookies: session=abc"), shown.text);
	const hidden = await b.call("browser_hide");
	assert.ok(hidden.text.startsWith("The window is closed.") && hidden.text.includes("- Page URL: https://shop.example/account\n- window: hidden\n- cookies: session=abc"), hidden.text);
	assert.deepEqual(fs.readdirSync(b.scratch).filter((f) => f.startsWith("state-")), [], "the file that carried the login is gone");
	assert.equal(b.ended(), false, "a browser that was replaced does not end the server");
	assert.deepEqual(b.log().filter((l) => l.startsWith("start")), ["start hidden", "start headed", "start hidden", "start headed", "start hidden"]);

	// The tools pine uses for this itself stay closed to the agent.
	for (const name of ["browser_storage_state", "browser_set_storage_state", "browser_cookie_list", "browser_run_code_unsafe"]) assert.match((await b.call(name, { filename: "/etc/hosts" })).text, /is not available/);
});

test("browser: no window for a run started from outside; a machine without a screen says so and carries on; a screenshot that timed out is taken again", async (t) => {
	// What pine passes for a run that the owner did not start.
	const outside = await fakeBrowser(t, { window: false });
	assert.deepEqual((await outside.rpc("tools/list")).result.tools.map((x: any) => x.name), ["browser_navigate", "browser_take_screenshot"]);
	assert.match((await outside.call("browser_show")).text, /browser_show is not available/);
	assert.deepEqual(outside.log(), ["start hidden"], "nothing was started for it");
	assert.ok(!toolAllowed("browser_show", {}) && !toolAllowed("browser_show", { tools: "all" }) && toolAllowed("browser_show", { window: true }) && !toolAllowed("browser_show", { window: true, block: ["browser_show"] }));
	assert.ok(!toolAllowed("browser_cookie_list", { tools: "all" }) && toolAllowed("browser_cookie_list", { tools: "all", caps: "storage" }), "cookie tools only where the owner asked for them");

	const b = await fakeBrowser(t, { window: true }, "no-screen");
	await b.call("browser_navigate", { url: "https://example.com/" });
	const refused = await b.call("browser_show");
	assert.ok(refused.failed && refused.text.includes("A window could not be opened on this computer") && refused.text.includes("Missing X server") && refused.text.includes("- Page URL: https://example.com/\n- window: hidden"), refused.text);
	assert.match((await b.call("browser_hide")).text, /has no window/);

	const shot = await b.call("browser_take_screenshot");
	assert.ok(!shot.failed && shot.text.includes("shot 2"), shot.text);
	assert.equal(b.log().filter((l) => l === "browser_take_screenshot").length, 2);
});

test("browser: the bundled server is configured like the others and marks sessions as tainted", async () => {
	const h = await harness({ pine: { mcp: { browser: { pine: "browser", options: { headed: true } } } }, agents: { main: {} }, start: false });
	const cfg = loadConfig(h.home);
	const server = effectiveMcp(cfg, cfg.agents.main).browser;
	assert.equal(mcpTaints(server), true);
	const pi = toPiMcp("browser", server) as any;
	assert.ok(pi.args[0].endsWith(path.join("mcp", "browser.ts")));
	assert.deepEqual(JSON.parse(pi.env.PINE_MCP_OPTIONS), { headed: true });
	// What pine adds for a conversation wins over the options: a run started from outside gets no window and no local addresses.
	const set = { ...server, options: { window: true, localFile: "/tmp/anything" } };
	assert.deepEqual(JSON.parse((toPiMcp("browser", set, browserSession(false, "/home/allowed.json")) as any).env.PINE_MCP_OPTIONS), { window: false, localFile: null, viewFile: null, hostFile: null, room: null });
	assert.deepEqual(JSON.parse((toPiMcp("browser", set, browserSession(true, "/home/allowed.json")) as any).env.PINE_MCP_OPTIONS), { window: true, localFile: "/home/allowed.json", viewFile: null, hostFile: null, room: null });
	// The door for the owner's own window: only in an owner's conversation, and a run from outside loses one that the options name.
	assert.equal(JSON.parse((toPiMcp("browser", set, browserSession(true, "/home/allowed.json", "/home/view.json")) as any).env.PINE_MCP_OPTIONS).viewFile, "/home/view.json");
	assert.equal(JSON.parse((toPiMcp("browser", { ...set, options: { ...(set as any).options, viewFile: "/tmp/mine.json", window: true } } as any, browserSession(false, "/home/allowed.json", "/home/view.json")) as any).env.PINE_MCP_OPTIONS).viewFile, null);
	// The Pine app's own browser: only for a conversation with a door, and never for a run from outside, whatever the options name.
	const hosted = (o: Record<string, unknown>) => ((x) => ({ hostFile: x.hostFile, room: x.room }))(JSON.parse((toPiMcp("browser", { ...set, options: { ...(set as any).options, hostFile: "/tmp/mine.json", room: "x:y" } } as any, o) as any).env.PINE_MCP_OPTIONS));
	assert.deepEqual(hosted(browserSession(true, "/home/allowed.json", "/home/view.json", "/home/host.json", "main:main")), { hostFile: "/home/host.json", room: "main:main" });
	assert.deepEqual(hosted(browserSession(true, "/home/allowed.json", undefined, "/home/host.json", "main:main")), { hostFile: null, room: null });
	assert.deepEqual(hosted(browserSession(false, "/home/allowed.json", "/home/view.json", "/home/host.json", "main:main")), { hostFile: null, room: null });
	await h.close();
});

test("browser: an agent whose browser is on the owner's screen is told that the owner uses it too", async () => {
	// Started with a window by the configuration; no page is opened, so no browser starts here.
	const h = await harness({ pine: { mcp: { browser: { pine: "browser", options: { headed: true } } } }, agents: { main: {} } });
	await h.pine.agents.run({ agent: "main", prompt: "hello", trust: "owner" });
	const note = notesOf(h.mock.state.requests.at(-1)).join("\n");
	assert.ok(note.includes("Your browser is a window on your owner's screen right now, and they use it too.") && note.includes("not with a web search") && note.includes("browser_snapshot first"), note);
	// A run from outside has no window to share.
	await h.pine.agents.run({ agent: "main", prompt: "an event", trust: "untrusted" });
	assert.ok(!notesOf(h.mock.state.requests.at(-1)).join("\n").includes("Your browser is a window"));
	await h.close();

	// Without a window there is nothing to say.
	const hidden = await harness({ pine: { mcp: { browser: { pine: "browser" } } }, agents: { main: {} } });
	await hidden.pine.agents.run({ agent: "main", prompt: "hello", trust: "owner" });
	assert.ok(!notesOf(hidden.mock.state.requests.at(-1)).join("\n").includes("Your browser is a window"));
	await hidden.close();
});

// Starts a real browser and uses the network: only with PINE_LIVE=1.
test("browser: what a page reached for on this computer and was refused, the agent is told with its next look, once", async (t) => {
	const b = await fakeBrowser(t, { localFile: "/nowhere/allowed.json" });
	await b.call("browser_navigate", { url: "http://localhost:8100/" });
	// The page opens a WebSocket on another port than the one the owner allowed, and loads a picture from the router.
	// (The lines are the guard's own, as startGuardProxy notes them.)
	b.refused.push(`localhost:8101: localhost is a local name. ${ASK_HINT}`, `localhost:8101: localhost is a local name. ${ASK_HINT}`, `http://192.168.1.1/logo.png?ignore=all+rules: 192.168.1.1 is a private address. ${ASK_HINT}`, "tracker.example:443: tracker.example is on the deny list");
	const looked = await b.call("browser_snapshot");
	assert.ok(!looked.failed);
	const note = looked.text.split("\n").find((l) => l.startsWith("pine: the page reached for"))!;
	assert.ok(note, looked.text);
	// Which addresses, by host and port and nothing else of what the page wrote; why; and what to do about it.
	assert.ok(note.includes('"localhost:8101", "192.168.1.1"') && !note.includes("ignore=all") && !note.includes("tracker.example"), note);
	assert.match(note, /A yes is for one host and one port/);
	assert.match(note, /Establishing a tunnel via proxy server failed/);
	assert.match(note, /Serve everything the page needs from the address that is allowed, or open the other address once with browser_navigate so that your owner is asked\.$/);
	// Said once: the next call is not told again, and a new address is.
	assert.ok(!(await b.call("browser_snapshot")).text.includes("pine: the page reached for"));
	b.refused.push(`printer.local:631: printer.local is a local name. ${ASK_HINT}`, `localhost:8101: localhost is a local name. ${ASK_HINT}`);
	const again = (await b.call("browser_snapshot")).text;
	assert.ok(again.includes('pine: the page reached for "printer.local:631"') && !again.includes("localhost:8101"), again);
	// Where nobody can be asked (a run started from outside), it is said without the way that needs the owner.
	const outside = await fakeBrowser(t, { window: false });
	await outside.call("browser_navigate", { url: "https://example.com/" });
	outside.refused.push("10.0.0.5:80: 10.0.0.5 is a private address");
	const plain = (await outside.call("browser_snapshot")).text;
	assert.ok(plain.includes('pine: the page reached for "10.0.0.5:80"') && !plain.includes("browser_navigate so that your owner"), plain);
});

// ---- the owner's own window (the Pine app shows the browser beside a conversation) ---------------

test("browser view: what the owner did is taken piece by piece, and an address is one of the web or nothing", () => {
	assert.deepEqual(cleanOps([{ do: "click", x: 10.4, y: 20, button: "right", count: 2 }, { do: "click", x: 1, y: 2, button: "all", count: 9 }, { do: "text", text: "héllo" }, { do: "key", key: "Meta+KeyA" }, { do: "wheel", dx: 0, dy: 99999 }, { do: "size", w: 5, h: 99999 }, { do: "tab", index: 2 }, { do: "back" }, { do: "newtab", url: "https://x.example/" }, { do: "closetab", index: 1 }]), [
		{ do: "click", x: 10, y: 20, button: "right", count: 2 },
		{ do: "click", x: 1, y: 2, button: "left", count: 1 },
		{ do: "text", text: "héllo" },
		{ do: "key", key: "Meta+KeyA" },
		{ do: "wheel", dx: 0, dy: 5000 },
		{ do: "size", w: 320, h: 2000 },
		{ do: "tab", index: 2 },
		{ do: "back" },
		{ do: "newtab" },
		{ do: "closetab", index: 1 },
	]);
	// What is not known, has no place, or is no name of a key is left out; nothing is passed on as it came.
	for (const bad of [{ do: "eval", code: "process.exit()" }, { do: "click", x: "1", y: 2 }, { do: "click", x: Number.NaN, y: 2 }, { do: "key", key: "Enter'); process.exit(); ('" }, { do: "key", key: "a b" }, { do: "text", text: 7 }, { do: "tab", index: -1 }, { do: "closetab" }, { do: "closetab", index: 1.5 }, { do: "wheel", dx: 0, dy: 0 }, null, "click", 7]) assert.deepEqual(cleanOps([bad]), [], JSON.stringify(bad));
	assert.deepEqual(cleanOps("click"), []);
	assert.equal(cleanOps(Array.from({ length: 500 }, () => ({ do: "back" }))).length, 60);
	assert.equal((cleanOps([{ do: "text", text: "x".repeat(9000) }])[0] as any).text.length, 4000);

	assert.equal(webAddress("example.com/a b"), undefined);
	assert.equal(webAddress("example.com/shop?q=1"), "https://example.com/shop?q=1");
	assert.equal(webAddress("localhost:3000"), "http://localhost:3000/");
	assert.equal(webAddress("127.0.0.1:5173/x"), "http://127.0.0.1:5173/x");
	assert.equal(webAddress(" http://example.com "), "http://example.com/");
	for (const no of ["file:///etc/passwd", "javascript://x/%0aalert(1)", "chrome://settings", "about:blank", "", "   ", 7, undefined, `https://${"a".repeat(3000)}.example`]) assert.equal(webAddress(no), undefined, String(no).slice(0, 40));
});

test("browser view: a picture only while a page is open, the owner's hand in order and as values, and the agent told that the browser moved", async (t) => {
	const b = await fakeBrowser(t, { window: true });
	// Nothing is open: no picture, and nobody asked the browser, which would have opened one.
	assert.deepEqual(await b.view.state(), { open: false, tabs: [], current: 0, window: false, scale: 1 });
	assert.equal(await b.view.frame(), undefined);
	assert.deepEqual(await b.view.input([{ do: "click", x: 1, y: 1 }]), { open: false, tabs: [], current: 0, window: false, scale: 1 });
	assert.deepEqual(b.log(), ["start hidden"]);

	await b.call("browser_navigate", { url: "https://shop.example/" });
	assert.deepEqual(await b.view.state(), { open: true, tabs: [{ title: "Page 0", url: "https://shop.example/" }], current: 0, window: false, scale: 1 });
	// The picture is the one this server asked for, read from where it asked for it.
	const picture = await b.view.frame();
	assert.ok(picture && picture[0] === 0xff && picture[1] === 0xd8 && picture.toString("latin1").includes("picture of https://shop.example/"));
	// Two that are asked for at once are one question.
	const before = b.log().filter((l) => l === "browser_take_screenshot device").length;
	const [one, two] = await Promise.all([b.view.frame(), b.view.frame()]);
	assert.ok(one && one === two);
	assert.equal(b.log().filter((l) => l === "browser_take_screenshot device").length, before + 1);

	// Looking leaves the agent's page where it was: the pointer, the wheel and the size of the room go the short way.
	await b.view.input([{ do: "move", x: 5, y: 6 }, { do: "wheel", dx: 0, dy: 300 }, { do: "size", w: 600, h: 500 }]);
	assert.deepEqual(b.log().slice(-3), ["browser_mouse_move_xy 5,6", "browser_mouse_wheel 0,300", 'hand [{"do":"size","w":600,"h":500}]']);
	assert.ok(!(await b.call("browser_snapshot")).text.includes("has changed"), "nothing to tell the agent about");

	// A click, a key and plain letters go the short way, one key at a time, in the order they were done; the rest
	// goes together, as values in code that is this server's own.
	await b.view.input([{ do: "text", text: "Hi +" }, { do: "key", key: "Shift+Tab" }, { do: "click", x: 3, y: 4, count: 2 }, { do: "drag", x: 1, y: 1, x2: 9, y2: 9 }]);
	assert.deepEqual(b.log().slice(-6), ["browser_press_key H", "browser_press_key i", "browser_press_key  ", "browser_press_key +", "browser_press_key Shift+Tab", `hand ${JSON.stringify([{ do: "click", x: 3, y: 4, button: "left", count: 2 }, { do: "drag", x: 1, y: 1, x2: 9, y2: 9 }])}`]);
	const nasty = `"); process.exit(1); ("\u2028 \\`;
	await b.view.input([{ do: "click", x: 10, y: 20 }, { do: "text", text: nasty }, { do: "wheel", dx: 0, dy: 50 }, { do: "key", key: "Enter" }, { do: "eval", code: "x" }]);
	const lines = b.log();
	assert.deepEqual(lines.slice(-6), ["browser_mouse_move_xy 10,20", "browser_mouse_down left", "browser_mouse_up left", `hand ${JSON.stringify([{ do: "text", text: nasty }])}`, "browser_mouse_wheel 0,50", 'hand [{"do":"key","key":"Enter"}]']);
	// The fixed text, and nothing of the owner's outside the one value.
	const code = fs.readFileSync(path.join(b.scratch, "last-code.txt"), "utf8");
	assert.ok(code.startsWith("async (page) => {\n\tconst ops = [{") && code.includes("await page.keyboard.type(o.text)") && !/[\u2028\u2029]/.test(code) && !code.includes("__OPS__"), code.slice(0, 200));
	assert.equal(code.replace(/const ops = .*;\n/, "const ops = X;\n"), fs.readFileSync(path.join(b.scratch, "first-code.txt"), "utf8").replace(/const ops = .*;\n/, "const ops = X;\n"), "the code is the same whatever was done");

	// "Enter" took the page somewhere else (the stand-in moves on it). The agent's next call that would act is
	// not carried out on a page it has not seen; one that only looks is told.
	const acted = await b.call("browser_navigate", { url: "https://elsewhere.example/" });
	assert.ok(acted.text.startsWith("Not done: the browser is not where you left it") && acted.text.includes("https://moved.example/"), acted.text);
	assert.ok(!b.log().includes("browser_navigate https://elsewhere.example/"));
	// Now it has seen the page: its next call goes through, and nothing is compared until the owner's hand moves again.
	assert.ok((await b.call("browser_navigate", { url: "https://elsewhere.example/" })).text.includes("- Page URL: https://elsewhere.example/"));
	const tabsAsked = b.raw().filter((l) => l === "browser_tabs list").length;
	await b.call("browser_snapshot");
	assert.equal(b.raw().filter((l) => l === "browser_tabs list").length, tabsAsked, "a browser nobody else touched is not asked about its tabs");

	// An address the owner types is opened like any other, and what is none is said.
	assert.deepEqual(await b.view.open("shop.example/cart"), { open: true, tabs: [{ title: "Page 0", url: "https://shop.example/cart" }], current: 0, window: false, scale: 1 });
	assert.equal((await b.view.open("file:///etc/passwd")).error, "That is no web address.");
	assert.ok(!b.log().some((l) => l.includes("file:")));
	const told = await b.call("browser_snapshot");
	assert.ok(told.text.startsWith("The browser has changed since you last looked") && told.text.includes("https://shop.example/cart"), told.text);

	// Tabs are the owner's to open, choose and close, and the agent's next look says where the browser is then.
	assert.deepEqual((await b.view.input([{ do: "newtab" }])).tabs.map((x) => x.url), ["https://shop.example/cart", "about:blank"]);
	assert.equal((await b.view.state()).current, 1);
	assert.deepEqual(await b.view.input([{ do: "tab", index: 0 }, { do: "closetab", index: 1 }]), { open: true, tabs: [{ title: "Page 0", url: "https://shop.example/cart" }], current: 0, window: false, scale: 1 });
	assert.deepEqual(b.log().slice(-3), ["browser_tabs new", "browser_tabs select0", "browser_tabs close1"]);
	// The last tab is emptied, not closed: the browser stays up, and there is no page to show any more.
	assert.deepEqual(await b.view.input([{ do: "closetab", index: 0 }]), { open: false, tabs: [], current: 0, window: false, scale: 1 });
	assert.equal(b.log().at(-1), "browser_navigate about:blank");
	assert.ok(!b.log().includes("browser_tabs close0") && !b.log().includes("browser_close"));
	assert.equal(await b.view.frame(), undefined);
	// The owner opens a page again in the same browser.
	assert.equal((await b.view.open("https://shop.example/cart")).open, true);

	// A page's own words reach the owner's window as one line each.
	await b.call("browser_navigate", { url: "https://sep.example/" });
	const odd = await b.view.state();
	assert.equal(odd.tabs[0].url, "https://sep.example/");
	// And a browser that answers with a line separator inside its text is still heard whole.
	assert.ok((await b.call("browser_snapshot")).text.includes("heading of https://sep.example/ with \u2028 inside"));
});

test("browser view: a picture is taken while the owner's hand waits for the page, and a call that closes the browser waits for the picture", async (t) => {
	const b = await fakeBrowser(t, { window: true });
	await b.call("browser_navigate", { url: "https://shop.example/" });
	// The owner reloads; the page takes its time to settle. The picture does not wait for that.
	const reloading = b.view.input([{ do: "reload" }]);
	await until(() => b.log().includes('hand [{"do":"reload"}]'), 5000, "the reload");
	assert.ok(await b.view.frame());
	assert.ok(!b.log().includes("reloaded"), "the picture came before the page had settled");
	await reloading;

	// A picture of a slow page is being taken when the agent closes the browser: the close waits for it,
	// since a picture asked of a closed browser would open it again.
	await b.call("browser_navigate", { url: "https://slow.example/" });
	const picture = b.view.frame();
	await until(() => b.log().includes("browser_take_screenshot device"), 5000, "the picture");
	const closed = b.call("browser_close");
	await Promise.all([picture, closed]);
	const log = b.log();
	assert.ok(log.indexOf("picture taken") < log.indexOf("browser_close"), log.join("\n"));
	// And while it closes, or after, no picture is asked for.
	assert.equal(await b.view.frame(), undefined);
});

test("browser view: while the Pine app runs, the browser is the app's own, and when it is gone the one pine starts again, with the page that was open", async (t) => {
	const b = await fakeBrowser(t, { window: true, app: true });
	await b.call("browser_navigate", { url: "https://shop.example/" });
	// The app comes: the browser moves into it, the logins go along, and the page is opened there again.
	b.app("ws://127.0.0.1:9/word");
	await until(() => b.log().includes("start hosted"), 5000, "the move into the app");
	await until(() => b.log().filter((l) => l === "browser_navigate https://shop.example/").length === 2, 5000, "the page opened again");
	const log = b.log();
	assert.ok(log.indexOf("browser_storage_state") < log.indexOf("start hosted") && log.indexOf("start hosted") < log.indexOf("browser_set_storage_state"), log.join("\n"));
	// The app shows it itself: in the page's points, and no room is laid out for a picture there.
	assert.deepEqual(await b.view.state(), { open: true, tabs: [{ title: "Page 0", url: "https://shop.example/" }], current: 0, window: false, scale: 1, hosted: true });
	await b.view.frame();
	assert.ok(b.log().includes("browser_take_screenshot css"));
	await b.view.input([{ do: "size", w: 600, h: 500 }]);
	assert.ok(!b.log().some((l) => l.startsWith("hand")), "nothing laid out for a picture");
	// The owner uses the page there at any time: the agent's next call that would act is not carried out on a page it has not seen.
	b.owner("goto https://shop.example/cart");
	const acted = await b.call("browser_navigate", { url: "https://elsewhere.example/" });
	assert.ok(acted.text.startsWith("Not done: the browser is not where you left it") && acted.text.includes("https://shop.example/cart"), acted.text);
	assert.match((await b.call("browser_show")).text, /^Your owner sees the browser in the Pine app/);
	assert.ok(!b.log().includes("start headed"), "no window of its own");
	// The app is gone: the browser pine starts itself again, on the page that was open.
	b.app();
	await until(() => b.log().filter((l) => l.startsWith("start")).at(-1) === "start hidden", 5000, "the move out of the app").catch((e) => assert.fail(`${e.message}\n${b.log().join("\n")}`));
	await until(() => b.log().at(-1) === "browser_navigate https://shop.example/cart", 5000, "the page opened again");
	assert.equal((await b.view.state()).hosted, undefined);
});

test("browser view: where the owner's own window shows the browser, showing it opens no other window", async (t) => {
	const b = await fakeBrowser(t, { window: true });
	await b.call("browser_navigate", { url: "https://shop.example/" });
	b.view.embed(true);
	const shown = await b.call("browser_show");
	assert.ok(!shown.failed && shown.text.startsWith("Your owner sees the browser in the Pine app, in the browser at the right of this conversation's window"), shown.text);
	assert.match((await b.call("browser_hide")).text, /no separate window\. Your owner sees it in the Pine app/);
	assert.deepEqual(b.log().filter((l) => l.startsWith("start")), ["start hidden"], "the browser was not started anew");
	// From then on the owner uses it too: what they open is noticed.
	await b.view.open("https://other.example/");
	assert.match((await b.call("browser_snapshot")).text, /^The browser has changed since you last looked/);
	// The app is gone: the agent's wish is a window again.
	b.view.embed(false);
	assert.match((await b.call("browser_show")).text, /now a window on your owner's screen/);
	assert.deepEqual(b.log().filter((l) => l.startsWith("start")), ["start hidden", "start headed"]);
	// The tools this server uses for the owner's hand stay closed to the agent.
	for (const name of ["browser_mouse_wheel", "browser_mouse_move_xy", "browser_mouse_click_xy", "browser_run_code_unsafe"]) assert.match((await b.call(name, { x: 1, y: 1, code: "1" })).text, /is not available/);
	assert.ok(!toolAllowed("browser_mouse_click_xy", { tools: "all" }) && toolAllowed("browser_mouse_click_xy", { tools: "all", caps: "vision" }), "tools that act at a place in the picture only where the owner asked for them");
});

test("browser view: the door answers the daemon and nobody else", async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pine-door-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const file = path.join(dir, "views", "main%3Amain.json");
	const asked: string[] = [];
	const state = { open: true, tabs: [{ title: "T", url: "https://a.example/" }], current: 0, window: false, scale: 1 };
	const door = await startViewDoor(
		{
			state: async () => state,
			frame: async () => (asked.push("frame"), asked.length > 1 ? undefined : Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3])),
			input: async (ops) => (asked.push(`input ${JSON.stringify(ops)}`), state),
			open: async (url) => (asked.push(`open ${url}`), state),
			embed: (on) => void asked.push(`embed ${on}`),
		},
		file,
	);
	t.after(() => door.close());
	// It says where it is in the file pine named, for the owner's account alone, and listens on the loopback only.
	const said = JSON.parse(fs.readFileSync(file, "utf8"));
	assert.deepEqual({ port: said.port, pid: said.pid, token: /^[0-9a-f]{64}$/.test(said.token) }, { port: door.port, pid: process.pid, token: true });
	if (process.platform !== "win32") assertPrivate(file, 0o600);
	const base = `http://127.0.0.1:${door.port}`;
	const word = { authorization: `Bearer ${said.token}` };
	// Without the word, with a wrong one, or from a page in some browser: nothing.
	for (const headers of [{}, { authorization: "Bearer " + "0".repeat(64) }, { authorization: said.token }, { ...word, origin: "https://evil.example" }] as Array<Record<string, string>>) {
		for (const [method, at] of [["GET", "/state"], ["GET", "/frame"], ["POST", "/input"], ["POST", "/open"], ["POST", "/embed"]]) assert.equal((await fetch(base + at, { method, headers, body: method === "POST" ? "{}" : undefined })).status, 401, `${method} ${at} ${JSON.stringify(headers)}`);
	}
	assert.deepEqual(asked, []);
	assert.deepEqual(await (await fetch(`${base}/state`, { headers: word })).json(), state);
	const picture = await fetch(`${base}/frame`, { headers: word });
	assert.deepEqual([picture.status, picture.headers.get("content-type"), Buffer.from(await picture.arrayBuffer()).length], [200, "image/jpeg", 6]);
	assert.equal((await fetch(`${base}/frame`, { headers: word })).status, 204, "no picture is no error");
	const post = (at: string, body: unknown) => fetch(base + at, { method: "POST", headers: { ...word, "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
	assert.equal((await post("/input", { ops: [{ do: "back" }] })).status, 200);
	assert.equal((await post("/open", { url: "example.com" })).status, 200);
	assert.equal((await post("/embed", { on: true })).status, 200);
	assert.equal((await post("/embed", { on: "yes" })).status, 200);
	assert.deepEqual(asked.slice(2), ['input [{"do":"back"}]', "open example.com", "embed true", "embed false"]);
	assert.equal((await post("/input", "{not json")).status, 400);
	assert.equal((await post("/input", `{"ops":"${"x".repeat(300_000)}"}`).catch(() => ({ status: 400 }))).status, 400);
	assert.equal((await fetch(`${base}/elsewhere`, { headers: word })).status, 404);
	// When the browser ends, so does what it said about its door.
	door.close();
	assert.equal(fs.existsSync(file), false);
});

test("browser view: the owner reaches a conversation's browser through the control API, and only theirs", async (t) => {
	const h = await harness({ pine: { http: { port: 0 }, mcp: { browser: { pine: "browser", options: { executablePath: "/nonexistent/browser" } } } }, agents: { main: {}, helper: {} } });
	t.after(() => h.close());
	const base = `http://127.0.0.1:${h.pine.http!.port}`;
	const token = fs.readFileSync(path.join(h.home, "data", "http-token"), "utf8").trim();
	const api = async (method: string, at: string, body?: unknown, auth = true) => {
		const res = await fetch(base + at, { method, headers: { ...(auth ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
		const type = res.headers.get("content-type") ?? "";
		return { status: res.status, type, body: type.startsWith("application/json") ? await res.json() : Buffer.from(await res.arrayBuffer()) } as { status: number; type: string; body: any };
	};
	const closed = { open: false, tabs: [], current: 0, window: false, scale: 1 };
	// A conversation without a browser: nothing to show, and nothing is started to show something.
	assert.deepEqual((await api("GET", "/agents/main/browser?session=main")).body, closed);
	assert.equal((await api("GET", "/agents/main/browser/frame?session=main")).status, 404);
	assert.deepEqual((await api("POST", "/agents/main/browser/input", { session: "main", ops: [{ do: "back" }] })).body, closed);
	// An address for a conversation there is none of: no browser, and no conversation is made by asking.
	assert.match((await api("POST", "/agents/main/browser/open", { session: "nowhere", url: "example.com" })).body.error, /has no browser/);
	assert.ok(!fs.existsSync(path.join(h.home, "agents", "main", "sessions", "nowhere")));
	// Behind the token like everything else; an agent that is none is said.
	for (const [method, at] of [["GET", "/agents/main/browser"], ["GET", "/agents/main/browser/frame"], ["POST", "/agents/main/browser/input"], ["POST", "/agents/main/browser/open"], ["POST", "/browser/embedded"]]) assert.equal((await api(method, at, method === "POST" ? {} : undefined, false)).status, 401, `${method} ${at}`);
	assert.equal((await api("GET", "/agents/nobody/browser")).status, 404);
	assert.equal((await api("POST", "/agents/main/browser/open", { session: "main" })).status, 400);

	// A stand-in for the browser's door, where the browser of main's conversation "talk" would have said it is.
	const got: string[] = [];
	const page = { open: true, tabs: [{ title: "A\u2028title\nof two lines", url: "https://shop.example/" }, { title: 7, url: "x".repeat(5000) }], current: 9, window: "yes", scale: 9, error: "", more: { deep: true } };
	const word = "ab".repeat(32);
	const door = http.createServer(async (req, res) => {
		if (req.headers.authorization !== `Bearer ${word}`) return void res.writeHead(401).end();
		let text = "";
		for await (const chunk of req) text += chunk;
		got.push(`${req.method} ${req.url} ${text}`);
		if (req.url === "/frame") return void res.writeHead(200, { "content-type": got.filter((g) => g.startsWith("GET /frame")).length > 1 ? "text/html" : "image/jpeg" }).end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]));
		res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(page));
	});
	await new Promise<void>((r) => door.listen(0, "127.0.0.1", r));
	t.after(() => door.close());
	const file = path.join(h.home, "data", "browser-view", `${encodeURIComponent("main:talk")}.json`);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify({ port: (door.address() as net.AddressInfo).port, token: word, pid: 1 }));

	// What the door says is handed on as what it has to be and nothing more: lines of text, a place that exists.
	const state = (await api("GET", "/agents/main/browser?session=talk")).body;
	assert.deepEqual(state, { open: true, tabs: [{ title: "A title of two lines", url: "https://shop.example/" }, { title: "", url: "x".repeat(2000) }], current: 0, window: false, scale: 1 });
	const picture = await api("GET", "/agents/main/browser/frame?session=talk");
	assert.deepEqual([picture.status, picture.type, picture.body.length], [200, "image/jpeg", 6]);
	assert.equal((await api("GET", "/agents/main/browser/frame?session=talk")).status, 404, "what is no picture is not passed on as one");
	await api("POST", "/agents/main/browser/input", { session: "talk", ops: [{ do: "click", x: 3, y: 4 }] });
	assert.equal(got.at(-1), 'POST /input {"ops":[{"do":"click","x":3,"y":4}]}');
	// Another conversation, and another agent, do not get this one's browser.
	assert.deepEqual((await api("GET", "/agents/main/browser?session=main")).body, closed);
	assert.deepEqual((await api("GET", "/agents/helper/browser?session=talk")).body, closed);

	// An address on this computer that the owner types is theirs to open: it is allowed for that conversation by it.
	await api("POST", "/agents/main/browser/open", { session: "talk", url: "localhost:5173/app" });
	assert.equal(got.at(-1), 'POST /open {"url":"localhost:5173/app"}');
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(h.home, "data", "browser-local", `${encodeURIComponent("main:talk")}.json`), "utf8")), ["localhost:5173"]);
	// pine's own control port stays closed, whoever asks.
	const before = got.length;
	const own = await api("POST", "/agents/main/browser/open", { session: "talk", url: `http://127.0.0.1:${h.pine.http!.port}/health` });
	assert.match(own.body.error, /pine's own control port\. It stays closed to the browser/);
	assert.ok(!got.slice(before).some((g) => g.startsWith("POST /open")));
	assert.ok(!JSON.parse(fs.readFileSync(path.join(h.home, "data", "browser-local", `${encodeURIComponent("main:talk")}.json`), "utf8")).includes(`127.0.0.1:${h.pine.http!.port}`));

	// A file that names another host than this computer is not followed there: the door is on the loopback or nowhere.
	fs.writeFileSync(file, JSON.stringify({ port: "80@example.com", host: "example.com", token: word }));
	assert.deepEqual((await api("GET", "/agents/main/browser?session=talk")).body, closed);
	// A removed agent leaves no door behind.
	fs.writeFileSync(path.join(h.home, "data", "browser-view", `${encodeURIComponent("helper:main")}.json`), "{}");
	assert.equal((await api("POST", "/agents/helper/erase", { agent: "helper", keepFiles: false })).status, 200);
	assert.deepEqual(fs.readdirSync(path.join(h.home, "data", "browser-view")), [`${encodeURIComponent("main:talk")}.json`]);
});

test("browser view: the addresses an agent opened are kept for its owner, and opening one starts the conversation's browser without a turn", { timeout: 60_000 }, async (t) => {
	// What is kept is an address of the web, written out, and never a name and password.
	assert.equal(keptAddress("https://user:secret@shop.example/cart?a=1#top"), "https://shop.example/cart?a=1#top");
	assert.equal(keptAddress(" http://127.0.0.1:4173 "), "http://127.0.0.1:4173/");
	for (const no of ["shop.example", "javascript:alert(1)", "file:///etc/passwd", "ftp://files.example/", "https://", "", 7, undefined, `https://long.example/${"x".repeat(2000)}`]) assert.equal(keptAddress(no), undefined, String(no).slice(0, 40));

	// (The browser named here does not exist: nothing can be started by this test, whatever goes wrong.)
	const h = await harness({ pine: { http: { port: 0 }, mcp: { browser: { pine: "browser", options: { executablePath: "/nonexistent/browser" } } } }, agents: { main: {}, helper: {} } });
	t.after(() => h.close());
	const api = async (method: string, at: string, body?: unknown) => {
		const token = fs.readFileSync(path.join(h.home, "data", "http-token"), "utf8").trim();
		const res = await fetch(`http://127.0.0.1:${h.pine.http!.port}${at}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
		return (await res.json()) as any;
	};
	const door = (session: string) => path.join(h.home, "data", "browser-view", `${encodeURIComponent(`main:${session}`)}.json`);

	// A page that did not come is not kept: here no page can.
	await h.pine.agents.run({ agent: "main", session: "talk", prompt: mockMsg([{ tools: [{ name: "mcp__browser__browser_navigate", args: { url: "https://example.com/" } }] }, { text: "ok" }]), trust: "owner" });
	assert.equal((await api("GET", "/agents/main/browser?session=talk")).visited, undefined);

	// What a page that came leaves (the agent's call has ended well): newest first, each once, and not without end.
	const visit = (url: unknown, perm = "main:talk") => (h.pine.agents as any).visit(perm, url);
	for (const url of ["https://shop.example/", "http://127.0.0.1:4173/", "javascript:alert(1)", "https://user:secret@shop.example/"]) visit(url);
	assert.deepEqual((await api("GET", "/agents/main/browser?session=talk")).visited, ["https://shop.example/", "http://127.0.0.1:4173/"]);
	for (let i = 0; i < VISITED + 5; i++) visit(`https://site${i}.example/`, "main:many");
	const many = (await api("GET", "/agents/main/browser?session=many")).visited;
	assert.deepEqual([many.length, many[0]], [VISITED, `https://site${VISITED + 4}.example/`]);
	// Another conversation and another agent have their own.
	assert.equal((await api("GET", "/agents/main/browser?session=main")).visited, undefined);
	assert.equal((await api("GET", "/agents/helper/browser?session=talk")).visited, undefined);

	// After a restart the conversation is not up and has no browser. What it opened is still said, and asking starts nothing.
	await h.restart();
	assert.deepEqual(await api("GET", "/agents/main/browser?session=talk"), { open: false, tabs: [], current: 0, window: false, scale: 1, visited: ["https://shop.example/", "http://127.0.0.1:4173/"] });
	assert.ok(!fs.existsSync(door("talk")));
	assert.equal(h.pine.agents.status().sessions.length, 0);

	// The owner opens one of them: the conversation's session comes up for it, with its browser, and no turn is taken.
	const tasks = h.pine.tasks.list({ agent: "main" }).length;
	const requests = h.mock.state.requests.length;
	const opened = await api("POST", "/agents/main/browser/open", { session: "talk", url: "http://127.0.0.1:4173/" });
	assert.ok(fs.existsSync(door("talk")), "its browser is up and said where its door is");
	assert.doesNotMatch(String(opened.error), /has no browser/);
	assert.deepEqual(opened.visited, ["https://shop.example/", "http://127.0.0.1:4173/"], "what the owner opens is not added: the list is what the agent opened");
	assert.deepEqual(h.pine.agents.status().sessions.map((s: any) => s.key ?? s.session), ["talk"]);
	assert.equal(h.pine.tasks.list({ agent: "main" }).length, tasks);
	assert.equal(h.mock.state.requests.length, requests, "no model was asked anything");
	// It is the owner's conversation that came up: the address on this computer is allowed for it, as when it is typed.
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(h.home, "data", "browser-local", `${encodeURIComponent("main:talk")}.json`), "utf8")), ["127.0.0.1:4173"]);
	// A conversation there is none of gets no browser this way, and is not made by it.
	assert.match((await api("POST", "/agents/main/browser/open", { session: "nowhere", url: "https://shop.example/" })).error, /has no browser/);
	assert.ok(!fs.existsSync(path.join(h.home, "agents", "main", "sessions", "nowhere")));

	// The list goes with the conversation's name, and ends with it.
	await h.pine.agents.renameSession("main", "talk", "shop");
	assert.equal((await api("GET", "/agents/main/browser?session=talk")).visited, undefined);
	assert.deepEqual((await api("GET", "/agents/main/browser?session=shop")).visited, ["https://shop.example/", "http://127.0.0.1:4173/"]);
	await h.pine.agents.resetSession("main", "shop");
	assert.equal((await api("GET", "/agents/main/browser?session=shop")).visited, undefined);
	await h.pine.agents.removeSession("main", "many");
	assert.equal((await api("GET", "/agents/main/browser?session=many")).visited, undefined);
});

test("browser view: while a UI of the owner's shows the browser, the agent's browser_show opens no window, and without one it does", { timeout: 60_000 }, async (t) => {
	// (The browser named here does not exist: nothing can be started by this test, whatever goes wrong.)
	const h = await harness({ pine: { http: { port: 0 }, mcp: { browser: { pine: "browser", options: { executablePath: "/nonexistent/browser" } } } }, agents: { main: {} } });
	t.after(() => h.close());
	const show = async (session: string) => {
		await h.pine.agents.run({ agent: "main", session, prompt: mockMsg([{ tools: [{ name: "mcp__browser__browser_show", args: {} }] }, { text: "ok" }]), trust: "owner" });
		return h.toolResults()[0] as string;
	};
	// Nobody said that they show the browser: the agent's wish is a window, which this machine's stand-in cannot open.
	assert.match(await show("alone"), /A window could not be opened on this computer|could not be shown/);
	// The Pine app says so, as it does again and again while it runs.
	const token = fs.readFileSync(path.join(h.home, "data", "http-token"), "utf8").trim();
	assert.equal((await fetch(`http://127.0.0.1:${h.pine.http!.port}/browser/embedded`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" })).status, 200);
	const said = await show("watched");
	assert.ok(said.startsWith("Your owner sees the browser in the Pine app") && said.includes("No page is open yet"), said);
	// Its browser said where its door is, in pine's data, and the owner is told there is no page yet.
	const file = path.join(h.home, "data", "browser-view", `${encodeURIComponent("main:watched")}.json`);
	assert.ok(fs.existsSync(file));
	const state = await (await fetch(`http://127.0.0.1:${h.pine.http!.port}/agents/main/browser?session=watched`, { headers: { authorization: `Bearer ${token}` } })).json();
	// Without a window it draws two pixels for a point, for a picture as sharp as a Retina display draws.
	assert.deepEqual(state, { open: false, tabs: [], current: 0, window: false, scale: 2 });
	// A run started from outside has no door and no such tool.
	await h.pine.agents.run({ agent: "main", session: "door", prompt: mockMsg([{ tools: [{ name: "mcp__browser__browser_show", args: {} }] }, { text: "ok" }]), trust: "untrusted" });
	assert.ok(!fs.readdirSync(path.dirname(file)).some((f) => decodeURIComponent(f).includes("door")));
});

test("live: an agent opens a page in the bundled browser", { skip: process.env.PINE_LIVE !== "1", timeout: 60_000 }, async (t) => {
	const dev = http.createServer((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("<title>Dev server</title><h1>DEV-SERVER-PAGE</h1>"));
	await new Promise<void>((r) => dev.listen(0, "127.0.0.1", r));
	t.after(() => dev.close());
	const devUrl = `http://127.0.0.1:${(dev.address() as net.AddressInfo).port}/`;
	const h = await harness({ pine: { mcp: { browser: { pine: "browser" } } }, agents: { main: {} } });
	// The owner allows the dev server and nothing else.
	const asked: any[] = [];
	h.pine.bus.subscribe("approval/requested", (e) => {
		asked.push(e.payload);
		h.pine.approvals.decide((e.payload as any).id, (e.payload as any).summary.includes(devUrl), "test");
	});
	const r = await h.pine.agents.run({
		agent: "main",
		prompt: mockMsg([{ tools: [{ name: "mcp__browser__browser_navigate", args: { url: "https://example.com" } }, { name: "mcp__browser__browser_navigate", args: { url: `http://127.0.0.1:${h.mock.port}/v1/models` } }, { name: "mcp__browser__browser_run_code_unsafe", args: { code: "1" } }, { name: "mcp__browser__browser_navigate", args: { url: devUrl } }] }]),
		trust: "owner",
	});
	assert.equal(r.status, "done");
	const [page, local, code, allowed] = h.toolResults();
	assert.ok(page.includes("Page Title: Example Domain") && page.includes('link "Learn more"'), page);
	assert.ok(/not approved/.test(local) && !local.includes("mock-model"), local);
	assert.match(code, /not found|not available/);
	assert.ok(allowed.includes("DEV-SERVER-PAGE"), allowed);
	assert.equal(asked.length, 2);
	// What it opened is kept for the owner, newest first; the address that was not approved is not among them.
	assert.deepEqual((await h.pine.agents.browserState("main", "main")).visited, [devUrl, "https://example.com/"]);
	assert.ok(/mcp__browser__browser_navigate returned outside content/.test(h.pine.agents.status().sessions[0].tainted ?? ""));
	await h.close();
});

// Starts a real browser. Only with PINE_LIVE=1.
test("live: a page in the bundled browser reaches nothing nearby, also not by the roads that lead around a proxy", { skip: process.env.PINE_LIVE !== "1", timeout: 60_000 }, async (t) => {
	// Another service on this computer, and a port that hears whatever is sent past the proxy (a proxy carries no UDP).
	const reached: string[] = [];
	const other = http.createServer((req, res) => (reached.push(req.url ?? ""), res.writeHead(200, { "access-control-allow-origin": "*" }).end("OTHER-LOCAL-SECRET")));
	await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
	const otherPort = (other.address() as net.AddressInfo).port;
	const udp = dgram.createSocket("udp4");
	const datagrams: number[] = [];
	udp.on("message", (m) => datagrams.push(m.length));
	await new Promise<void>((r) => udp.bind(0, "127.0.0.1", r));
	const udpPort = udp.address().port;
	const tried: string[] = [];
	const dev = http.createServer((req, res) => {
		if (req.url?.startsWith("/tried?")) return void (tried.push(decodeURIComponent(req.url.slice(7))), res.end("ok"));
		res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>Dev server</title><h1>DEV-SERVER-PAGE</h1><script>
const say = (s) => fetch("/tried?" + encodeURIComponent(s));
fetch("http://127.0.0.1:${otherPort}/fetch").then((r) => r.text()).then((x) => say("fetch got " + x), () => say("fetch refused"));
try { const ws = new WebSocket("ws://127.0.0.1:${otherPort}/ws"); ws.onopen = () => say("ws open"); ws.onerror = () => say("ws refused"); } catch { say("ws refused"); }
try { const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${udpPort}" }] }); pc.createDataChannel("x"); pc.createOffer().then((o) => pc.setLocalDescription(o)); say("rtc started"); } catch { say("rtc absent"); }
try { new WebTransport("https://127.0.0.1:${udpPort}/"); say("wt started"); } catch { say("wt absent"); }
new Worker(URL.createObjectURL(new Blob(['try { const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${udpPort}" }] }); pc.createDataChannel("x"); pc.createOffer().then((o) => pc.setLocalDescription(o)); } catch {}; try { new WebTransport("https://127.0.0.1:${udpPort}/w") } catch {}; fetch("http://127.0.0.1:${otherPort}/worker").catch(() => {})'])));
</script>`);
	});
	await new Promise<void>((r) => dev.listen(0, "127.0.0.1", r));
	t.after(() => (dev.closeAllConnections(), dev.close(), other.closeAllConnections(), other.close(), udp.close()));
	const devUrl = `http://127.0.0.1:${(dev.address() as net.AddressInfo).port}/`;
	const h = await harness({ pine: { mcp: { browser: { pine: "browser" } } }, agents: { main: {} } });
	// The owner allows the page itself, and that is all the browser gets of this computer.
	h.pine.bus.subscribe("approval/requested", (e) => void h.pine.approvals.decide((e.payload as any).id, (e.payload as any).summary.includes(devUrl), "test"));
	const r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [{ name: "mcp__browser__browser_navigate", args: { url: devUrl } }] }, { tools: [{ name: "mcp__browser__browser_wait_for", args: { time: 3 } }] }]), trust: "owner" });
	assert.equal(r.status, "done");
	assert.ok(h.toolResults(h.mock.state.requests[1])[0].includes("DEV-SERVER-PAGE"));
	await until(() => tried.some((x) => /^fetch /.test(x)) && tried.some((x) => /^ws /.test(x)), 8000, `the page's attempts: ${tried.join(", ")}`);
	assert.deepEqual(reached, [], "nothing arrived at the other service");
	assert.ok(tried.includes("fetch refused") && tried.includes("ws refused"), tried.join(", "));
	assert.deepEqual(datagrams, [], `nothing was sent past the proxy (the page said: ${tried.join(", ")})`);
	await h.close();
});
