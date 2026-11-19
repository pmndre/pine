import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { test } from "node:test";
import { keptAddress, VISITED } from "./browser-view.ts";
import { harness, mockMsg } from "../testing/harness.ts";

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
	const closed = { open: false, tabs: [], current: 0, window: false };
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
	const page = { open: true, tabs: [{ title: "A\u2028title\nof two lines", url: "https://shop.example/" }, { title: 7, url: "x".repeat(5000) }], current: 9, window: "yes", error: "", more: { deep: true } };
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
	assert.deepEqual(state, { open: true, tabs: [{ title: "A title of two lines", url: "https://shop.example/" }, { title: "", url: "x".repeat(2000) }], current: 0, window: false });
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
	assert.deepEqual(await api("GET", "/agents/main/browser?session=talk"), { open: false, tabs: [], current: 0, window: false, visited: ["https://shop.example/", "http://127.0.0.1:4173/"] });
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
	assert.deepEqual(state, { open: false, tabs: [], current: 0, window: false });
	// A run started from outside has no door and no such tool.
	await h.pine.agents.run({ agent: "main", session: "door", prompt: mockMsg([{ tools: [{ name: "mcp__browser__browser_show", args: {} }] }, { text: "ok" }]), trust: "untrusted" });
	assert.ok(!fs.readdirSync(path.dirname(file)).some((f) => decodeURIComponent(f).includes("door")));
});
