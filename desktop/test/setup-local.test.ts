// "Setup Pine", a model on this computer (src/setup/local.tsx): the daemon asks the usual local
// ports what they serve (`GET /models/local`), and the owner picks what answered, unlocks it with
// its key, or types an address. The usual ports are moved to stand-ins on port 0 for the daemon of
// this test (`PINE_LOCAL_PORTS`, for tests only): a llama.cpp server with Pinecone's MCP server
// beside it, and an LM Studio that wants a key.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { launchApp, patient } from "./support/app.ts";

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-setup-local-")));
const KEY = "sk-studio-not-a-real-key-4471";
let app: any;
let page: any;
const servers: http.Server[] = [];

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};
const listen = async (handler: http.RequestListener) => {
	const server = http.createServer(handler);
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	servers.push(server);
	return { server, port: (server.address() as any).port as number };
};
const models = (id: string, key?: string): http.RequestListener => (req, res) => {
	if (key && req.headers.authorization !== `Bearer ${key}`) return void res.writeHead(401).end("{}");
	if (req.url === "/v1/models") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id, context_length: 32000 }] }));
	res.writeHead(404).end("{}");
};
const sees = (selector: string, timeout = patient(20_000)) => page.waitForSelector(selector, { timeout });
const api = (method: string, url: string, body?: unknown) => page.evaluate(([m, u, b]: [string, string, unknown]) => (window as any).pine.call(m, u, b).then((r: any) => r.data), [method, url, body]);
const shot = async (name: string) => {
	if (!process.env.PINE_DESKTOP_SHOTS) return;
	fs.mkdirSync(process.env.PINE_DESKTOP_SHOTS, { recursive: true });
	await page.screenshot({ path: path.join(process.env.PINE_DESKTOP_SHOTS, `${name}.png`) });
};
const card = "[data-slot=composer-question] [data-slot=questionnaire]";
/** The card that is open, by what it asks (`data-question`), never by its words. */
const question = (id: string) => sees(`${card}[data-question=${id}]`);
const pick = (option: string) => page.click(`${card} [data-slot=questionnaire-choice][data-option="${option}"]`);
const options = () => page.$$eval(`${card} [data-slot=questionnaire-choice]`, (els: Element[]) => els.map((e) => e.getAttribute("data-option")));
/** What an option of the open card is called on screen, whatever it says: looked for again where the answer folds. */
const label = async (option: string): Promise<string> => (await page.locator(`${card} [data-option="${option}"] [data-slot=question-card-label]`).textContent()) ?? "";
const model = (selector: string) => sees(`[data-slot=setup-model]${selector}`);
const composer = "[data-slot=composer] textarea";
const local = "[data-card=setup-local]";
/** A value typed into the card's own field and sent with the card's button. */
const fill = async (field: string, text: string) => {
	await sees(`${local} [data-setup=${field}]`);
	await page.fill(`${local} [data-setup=${field}]`, text);
	await page.click(`${local} [data-slot=questionnaire-submit]`);
};

/** Back to no model: the default unset, the server removed, the page told. */
const forget = async (server: string) => {
	await api("POST", "/settings", { key: "defaults.model", value: null });
	await api("POST", "/models/servers/remove", { name: server });
	await app.evaluate(({ BrowserWindow }: any) => {
		const p = BrowserWindow.getAllWindows()[0].webContents;
		p.send("pine:focus", true);
		p.send("pine:focus", false);
	});
	await question("model");
};

/** What the composer says under a card with options, for the card without any. */
let whereOptions = "";
let llama: Awaited<ReturnType<typeof listen>>;
let studio: Awaited<ReturnType<typeof listen>>;

before(async () => {
	llama = await listen(models("qwen3"));
	const mcp = await listen((req, res) => {
		if (req.method === "POST" && req.url === "/mcp") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "pinecone" } } }));
		res.writeHead(404).end();
	});
	studio = await listen(models("gemma", KEY));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { mode: "safe", introduce: false, thinking: "off" }, security: { askAccess: false } }, null, 2));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent: it administers pine.\n\nYou are the main agent.\n");
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	app = await launchApp({
		...process.env,
		PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"),
		PINE_HOME: home,
		PINE_DESKTOP_DATA: path.join(home, "desktop-data"),
		PINE_SKIP_DOWNLOADS: "1",
		PINE_DESKTOP_DEV_URL: "",
		PINE_DESKTOP_RELEASES: "",
		PINE_LOCAL_PORTS: `8080=${llama.port},8090=${mcp.port},1234=${studio.port}`,
	});
	page = await app.firstWindow();
	await page.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
	await sees("[data-dialog=browser-ask]");
	await page.click("[data-dialog=browser-ask] [data-action=later]");
	await page.waitForSelector("[data-dialog=browser-ask]", { state: "detached" });
});

after(async () => {
	await app?.close().catch(() => {});
	for (const s of servers) s.close();
	fs.rmSync(home, { recursive: true, force: true });
});

test("what answered on this computer is offered; a server that wants a key asks for it in a secret field", async () => {
	await question("model");
	await sees(`${composer}[data-above=typed]`);
	whereOptions = (await page.getAttribute(composer, "placeholder")) ?? "";
	await pick("local");
	await question("server");
	// What answered on the stand-ins' ports, by pine's names for them, then the way to any other address.
	assert.deepEqual(await options(), ["pinecone", "lmstudio", "other"]);
	await shot("setup-local-01-found");
	const studio = await label("lmstudio");
	await pick("lmstudio");
	await sees(`${local} input[type=password][data-setup=key]`);
	await fill("key", "sk-wrong");
	await sees(`${local} [data-slot=field-error]`);
	// A wrong key asks for the key again, with what the server said: not for the server's address.
	await sees(`${local} input[type=password][data-setup=key]`);
	assert.equal(await page.$(`${local} [data-setup=address]`), null, "no address card");
	await shot("setup-local-02-key");
	await fill("key", KEY);
	await model('[data-model="lmstudio/gemma"]');
	assert.doesNotMatch(await page.textContent("[data-slot=message-scroller-content]"), new RegExp(KEY));
	assert.deepEqual(await api("GET", "/tasks?agent=main&session=setup&limit=40"), []);
	await page.locator("[data-slot=message-scroller-content] [data-item=setup-answer]", { hasText: studio }).first().waitFor({ timeout: patient(20_000) });
});

test("Pinecone adds its model server and its MCP server for all agents", async () => {
	await forget("lmstudio");
	await pick("local");
	await question("server");
	await pick("pinecone");
	await model('[data-model="pinecone/qwen3"]');
	const mcp = ((await api("GET", "/mcp")) as any[]).find((s) => s.name === "pinecone");
	assert.ok(mcp, "Pinecone's MCP server is there");
	assert.equal(mcp.scope, "global", "for all agents");
	assert.match(mcp.target, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
	const servers = (await api("GET", "/models/servers")) as any[];
	assert.deepEqual(servers.map((s) => s.name), ["pinecone"]);
});

test("with nothing found, the owner types the address of a server, and it reaches a model", async () => {
	await forget("pinecone");
	// Nothing listens on the usual ports any more.
	await new Promise((r) => llama.server.close(r));
	await new Promise((r) => studio.server.close(r));
	const other = await listen(models("phi"));
	await pick("local");
	// No list to choose from: the card asks for the address, and its field takes the keyboard as it comes.
	await sees(`${local} [data-setup=address]`);
	await page.waitForFunction(() => document.activeElement?.getAttribute("data-setup") === "address", undefined, { timeout: patient(5_000) });
	assert.equal(await page.$(`${card} [data-slot=questionnaire-choice]`), null, "nothing was found, so nothing is offered");
	await shot("setup-local-03-nothing");
	// The address card has no options: the composer says something else than where typing names one.
	await sees(`${composer}[data-above=typed]`);
	const here = (await page.getAttribute(composer, "placeholder")) ?? "";
	assert.ok(here.trim() && whereOptions.trim(), "the composer says what typing does in both places");
	assert.notEqual(here, whereOptions);
	// An address where nothing answers is said under the field, which stays; one that answers reaches a model.
	await fill("address", "http://127.0.0.1:1");
	await sees(`${local} [data-slot=field-error]`);
	await sees(`${local} [data-setup=address]`);
	await fill("address", `http://127.0.0.1:${other.port}`);
	await model('[data-model$="/phi"]');
});
