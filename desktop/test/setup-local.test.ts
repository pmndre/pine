// "Onboarding", a model on this computer (src/setup/local.tsx): the daemon asks the usual local
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
const question = (text: string) => sees(`${card} [data-slot=questionnaire-title] >> text=${text}`);
/** Picks the option that says `label`, then sends it: a pick alone only selects. */
const pick = async (label: string) => {
	await page.locator(`${card} [data-slot=questionnaire-choice]`, { hasText: label }).click();
	await page.locator(card).getByRole("button", { name: "Send" }).click();
};
const options = () => page.$$eval(`${card} [data-slot=questionnaire-choice] [data-slot=question-card-label]`, (els: Element[]) => els.map((e) => e.textContent));
const local = "[data-card=setup-local]";
const fill = async (field: string, text: string, button: string) => {
	await sees(`${local} [data-setup=${field}]`);
	await page.fill(`${local} [data-setup=${field}]`, text);
	await page.locator(local).getByRole("button", { name: button }).click();
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
	await question("How should your agents run?");
};

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
	await sees("[data-slot=dialog-title] >> text=/The browser for the web tools/");
	await page.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Not now" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
});

after(async () => {
	await app?.close().catch(() => {});
	for (const s of servers) s.close();
	fs.rmSync(home, { recursive: true, force: true });
});

test("what answered on this computer is offered; a server that wants a key asks for it in a secret field", async () => {
	await question("How should your agents run?");
	await pick("A model on this computer");
	await question("Which server?");
	assert.deepEqual(await options(), ["Pinecone", "LM Studio", "Another address"]);
	await shot("setup-local-01-found");
	await pick("LM Studio");
	await sees(`${local} input[type=password][data-setup=key]`);
	await fill("key", "sk-wrong", "Unlock");
	await sees(`${local} [data-slot=field-error] >> text=/did not accept that key/`);
	// A wrong key asks for the key again, with what the server said: not for the server's address.
	await sees(`${local} input[type=password][data-setup=key]`);
	assert.equal(await page.$(`${local} [data-setup=address]`), null, "no address card");
	await shot("setup-local-02-key");
	await fill("key", KEY, "Unlock");
	await sees("[data-slot=setup-model] >> text=/Your agents now run on lmstudio\\/gemma/");
	assert.doesNotMatch(await page.textContent("[data-slot=message-scroller-content]"), new RegExp(KEY));
	assert.deepEqual(await api("GET", "/tasks?agent=main&session=setup&limit=40"), []);
	await sees("[data-slot=message-scroller-content] [data-item=setup-answer] >> text=LM Studio");
});

test("Pinecone adds its model server and its MCP server for all agents", async () => {
	await forget("lmstudio");
	await pick("A model on this computer");
	await question("Which server?");
	await pick("Pinecone");
	await sees("[data-slot=setup-model] >> text=/Your agents now run on pinecone\\/qwen3/");
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
	// In a short pane, where the card scrolls inside its slot: the field takes the keyboard without
	// scrolling it, so the card starts at its title, with no fade over the top.
	// The field's focus ring (stock, 3 pixels) lies inside the slot, which clips what it holds: whole on
	// both sides, and under the field where the field is in view.
	const ring = () =>
		page.$eval("[data-slot=composer-question] [data-slot=scroll-area-viewport]", (v: Element) => {
			const f = v.querySelector("[data-setup=address]")!.getBoundingClientRect();
			const r = v.getBoundingClientRect();
			return { top: v.scrollTop, scroll: v.scrollHeight, client: v.clientHeight, left: f.left - 3 - r.left, right: r.right - (f.right + 3), bottom: r.bottom - (f.bottom + 3) };
		});
	await page.setViewportSize({ width: 1280, height: 420 });
	try {
		await pick("A model on this computer");
		await sees(`${local} >> text=/found no model server/`);
		await page.waitForFunction(() => document.activeElement?.getAttribute("data-setup") === "address", undefined, { timeout: patient(5_000) });
		const slot = await ring();
		assert.ok(slot.scroll > slot.client, `the card does not scroll in a short pane: ${JSON.stringify(slot)}`);
		assert.equal(slot.top, 0, `the card's slot starts scrolled: ${JSON.stringify(slot)}`);
		assert.ok(slot.left >= 0 && slot.right >= 0, `the focus ring is cut at a side: ${JSON.stringify(slot)}`);
	} finally {
		await page.setViewportSize({ width: 1280, height: 820 });
	}
	await page.waitForFunction(() => {
		const v = document.querySelector("[data-slot=composer-question] [data-slot=scroll-area-viewport]");
		return v && v.scrollHeight <= v.clientHeight;
	}, undefined, { timeout: patient(5_000) });
	const whole = await ring();
	assert.ok(whole.left >= 0 && whole.right >= 0 && whole.bottom >= 0, `the focus ring is cut: ${JSON.stringify(whole)}`);
	await shot("setup-local-03-nothing");
	// The address card has no options: the composer says where to type, not to name an option.
	await page.waitForFunction(
		() => (document.querySelector("[data-slot=composer] textarea")?.getAttribute("placeholder") ?? "") === "Type the address in the field above",
		undefined,
		{ timeout: patient(5_000) },
	);
	assert.notEqual(await page.getAttribute("[data-slot=composer] textarea", "placeholder"), "Type an option's name to pick it…");
	await fill("address", "http://127.0.0.1:1", "Connect");
	await sees(`${local} [data-slot=field-error] >> text=/no model server answers/`);
	await fill("address", `http://127.0.0.1:${other.port}`, "Connect");
	await sees("[data-slot=setup-model] >> text=/Your agents now run on .*\\/phi/");
});
