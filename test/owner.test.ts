import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { browserPlaces } from "../src/browser-build.ts";
import { loadConfig } from "../src/config.ts";
import { Logins } from "../src/owner.ts";
import { sandboxAvailable } from "../src/security.ts";
import { putInto } from "../src/workspace-view.ts";
import { assertPrivate, type Harness, harness, until } from "./support/harness.ts";

// What the owner does to pine's setup through the control API (src/owner.ts): the same things
// the main agent does by tool, without the question, because the token is the owner.

const api = (h: Harness) => {
	const base = `http://127.0.0.1:${h.pine.http!.port}`;
	const call = async (method: string, url: string, body?: unknown) => {
		const res = await fetch(base + url, { method, headers: { authorization: `Bearer ${h.pine.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
		return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
	};
	return { base, get: (url: string) => call("GET", url), post: (url: string, body: unknown = {}) => call("POST", url, body) };
};
const json = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const tmp = (t: { after(fn: () => void): void }, name: string) => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), name)));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
};

test("the owner reads how pine is set up: overview, settings, an agent in full, the files for all agents", { skip: process.platform === "win32" && "describes an agent in safe mode, which needs a sandbox Windows does not have (docs/adr/0004-three-systems.md)" }, async () => {
	const h = await harness({
		pine: { http: { port: 0 } },
		agents: { main: { files: { "AGENTS.md": "I keep the house.\n", "MEMORY.md": "The boiler is new.\n" } }, books: { agent: { description: "Keeps the books", delegates: [], sandbox: { network: true } } } },
		files: { "USER.md": "Ms Okapi.\n" },
	});
	const a = api(h);

	const over = (await a.get("/overview")).body;
	assert.equal(over.home, h.home);
	assert.equal(over.main, "main");
	assert.equal(over.platform, process.platform);
	assert.equal(over.sandbox, sandboxAvailable());
	assert.match(over.version, /^\d+\.\d+\.\d+/);
	assert.ok(Array.isArray(over.warnings) && Array.isArray(over.modelNotes));
	assert.equal(over.log, path.join(h.home, "data", "pine.log"));
	assert.equal((await fetch(`${a.base}/overview`)).status, 401, "like everything else, behind the token");

	const settings = (await a.get("/settings")).body as any[];
	const thinking = settings.find((s) => s.key === "defaults.thinking");
	assert.deepEqual({ now: thinking.now, live: thinking.live, one: thinking.kind.one.includes("high") }, { now: "off", live: true, one: true });
	assert.ok(settings.every((s) => s.key && s.title && s.about && s.kind && typeof s.now === "string" && typeof s.live === "boolean"));

	const main = (await a.get("/agents/main/detail")).body;
	assert.equal(main.main, true);
	assert.equal(main.model, undefined, "it runs on the default, and that is said apart");
	assert.equal(main.defaultModel, "mock/m");
	assert.deepEqual(main.tools, main.allTools);
	assert.equal(main.files.instructions, "I keep the house.\n");
	assert.equal(main.files.memory, "The boiler is new.\n");
	assert.equal(main.files.rules, "PERSONA-MAIN\n");
	assert.equal(main.files.soul, undefined, "a file that is not there is left out");
	assert.deepEqual(main.holdings.conversations, []);
	const books = (await a.get("/agents/books/detail")).body;
	assert.deepEqual({ main: books.main, description: books.description, network: books.network, mode: books.mode }, { main: false, description: "Keeps the books", network: true, mode: "safe" });
	assert.equal((await a.get("/agents/nobody/detail")).status, 404);

	// A link in the workspace is not read out: the workspace is the agent's to write.
	fs.rmSync(path.join(h.workspace("main"), "MEMORY.md"));
	fs.symlinkSync(path.join(h.home, "pine.json"), path.join(h.workspace("main"), "MEMORY.md"));
	assert.equal((await a.get("/agents/main/detail")).body.files.memory, undefined);

	const shared = (await a.get("/shared")).body as any[];
	assert.deepEqual(shared.map((s) => s.name), ["AGENTS.md", "TOOLS.md", "USER.md"]);
	assert.equal(shared[2].text, "Ms Okapi.\n");
	assert.ok(shared.every((s) => s.about));
	await h.close();
});

test("the owner changes a setting and a file for all agents", async () => {
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: {} } });
	const a = api(h);
	const pineJson = path.join(h.home, "pine.json");

	// One that holds at once.
	assert.deepEqual((await a.post("/settings", { key: "defaults.thinking", value: "high" })).body, { key: "defaults.thinking", now: "high", live: true });
	assert.equal(json(pineJson).defaults.thinking, "high");
	assert.equal(h.pine.cfg.defaults.thinking, "high");
	assert.equal(((await a.get("/settings")).body as any[]).find((s) => s.key === "defaults.thinking").now, "high");
	// One that holds from the next start: what is in force and what is saved are both said.
	assert.deepEqual((await a.post("/settings", { key: "defaults.bashTimeoutSec", value: 77 })).body, { key: "defaults.bashTimeoutSec", now: "77", live: false });
	const timeout = ((await a.get("/settings")).body as any[]).find((s) => s.key === "defaults.bashTimeoutSec");
	assert.equal(timeout.saved, "77");
	assert.notEqual(timeout.now, "77");
	// "default" takes the entry out.
	await a.post("/settings", { key: "defaults.thinking", value: "default" });
	assert.equal(json(pineJson).defaults.thinking, undefined);
	// What is wrong is said, and nothing is written.
	const before = fs.readFileSync(pineJson, "utf8");
	const bad = await a.post("/settings", { key: "defaults.thinking", value: "a lot" });
	assert.equal(bad.status, 400);
	assert.match(bad.body.error, /defaults\.thinking is one of: off/);
	const unknown = await a.post("/settings", { key: "http.port", value: 1 });
	assert.equal(unknown.status, 400);
	assert.match(unknown.body.error, /there is no setting "http\.port"/);
	assert.equal((await a.post("/settings", { key: "defaults.model", value: "nobody/nothing" })).status, 400);
	assert.equal(fs.readFileSync(pineJson, "utf8"), before);

	// A file for all agents: one of three names, never a path.
	assert.deepEqual((await a.post("/shared", { name: "USER.md", text: "Call me Ms Okapi." })).body, { ok: true });
	assert.equal(fs.readFileSync(path.join(h.home, "USER.md"), "utf8"), "Call me Ms Okapi.\n");
	assertPrivate(path.join(h.home, "USER.md"), 0o600);
	for (const name of ["pine.json", "../USER.md", "agents/main/agent.json", ".env", ""]) {
		const no = await a.post("/shared", { name, text: "{}" });
		assert.equal(no.status, 400, name);
		assert.match(no.body.error, /not one of the files for all agents/);
	}
	assert.equal(fs.readFileSync(pineJson, "utf8"), before);
	// What lies there is replaced, not written through.
	const elsewhere = path.join(h.home, "elsewhere.txt");
	fs.writeFileSync(elsewhere, "as it was");
	fs.rmSync(path.join(h.home, "TOOLS.md"), { force: true });
	fs.symlinkSync(elsewhere, path.join(h.home, "TOOLS.md"));
	await a.post("/shared", { name: "TOOLS.md", text: "Search with ripgrep.\n" });
	assert.equal(fs.readFileSync(elsewhere, "utf8"), "as it was");
	assert.ok(fs.lstatSync(path.join(h.home, "TOOLS.md")).isFile());
	await h.close();
});

test("the owner adds, replaces and removes skills, schedules and routes", async (t) => {
	const mine = tmp(t, "pine-own-skills-");
	fs.mkdirSync(path.join(mine, "kept"));
	fs.writeFileSync(path.join(mine, "kept", "SKILL.md"), "---\nname: kept\ndescription: The owner's own.\n---\n\nStay.\n");
	const h = await harness({ pine: { http: { port: 0 }, skills: [mine] }, agents: { main: {}, books: {} } });
	const a = api(h);

	// Skills: for all agents, or one agent's own.
	const made = (await a.post("/skills", { name: "invoices", description: "File an invoice. Use when one arrives.", instructions: "1. Read it.\n2. File it." })).body;
	assert.deepEqual({ name: made.name, replaced: made.replaced, dir: made.dir }, { name: "invoices", replaced: false, dir: path.join(h.home, "skills", "invoices") });
	assert.equal((await a.post("/skills", { name: "ledger", description: "Keep the ledger.", instructions: "Add a row.", agent: "books" })).body.dir, path.join(h.home, "agents", "books", "skills", "ledger"));
	let skills = (await a.get("/skills")).body as any[];
	assert.deepEqual(skills.map((s) => `${s.name}:${s.scope}:${s.agent ?? ""}:${s.managed}`).sort(), ["invoices:global::true", "kept:global::false", "ledger:agent:books:true"]);
	assert.equal(skills.find((s) => s.name === "invoices").instructions, "1. Read it.\n2. File it.", "without the header that names it");
	assert.equal((await a.post("/skills", { name: "invoices", description: "File an invoice.", instructions: "Differently now." })).body.replaced, true);
	// One name, one skill; and what the owner keeps in a folder of their own is not replaced or removed from here.
	const twice = await a.post("/skills", { name: "invoices", description: "x", instructions: "y", agent: "books" });
	assert.equal(twice.status, 409);
	assert.match(twice.body.error, /exists already/);
	assert.equal((await a.post("/skills", { name: "kept", description: "x", instructions: "y" })).status, 409);
	assert.equal((await a.post("/skills/remove", { name: "kept" })).status, 409);
	assert.equal(fs.readFileSync(path.join(mine, "kept", "SKILL.md"), "utf8").includes("Stay."), true);
	const badName = await a.post("/skills", { name: "Not A Name", description: "x", instructions: "y" });
	assert.equal(badName.status, 400);
	assert.match(badName.body.error, /not a usable skill name/);
	assert.equal((await a.post("/skills/remove", { name: "ledger" })).status, 404, "it is the agent's, not one for all");
	assert.deepEqual((await a.post("/skills/remove", { name: "ledger", agent: "books" })).body, { removed: true });
	assert.deepEqual((await a.post("/skills/remove", { name: "invoices" })).body, { removed: true });
	skills = (await a.get("/skills")).body;
	assert.deepEqual(skills.map((s) => s.name), ["kept"]);
	assert.ok(!fs.existsSync(path.join(h.home, "agents", "books", "skills")), "removing leaves things as they were");

	// Schedules.
	const morning = (await a.post("/schedules", { name: "morning", task: "Say what is due today.", cron: "0 7 * * 1-5", agent: "books" })).body;
	assert.deepEqual({ name: morning.name, scope: morning.scope, task: morning.task }, { name: "morning", scope: "books", task: "Say what is due today." });
	assert.equal((await a.post("/schedules", { name: "tick", task: "Look at the queue.", every: "15m" })).body.scope, "global");
	assert.equal((await a.post("/schedules", { name: "once", task: "Call the dentist.", in: "2h", agent: "main", session: "side" })).body.session, "side");
	assert.deepEqual(((await a.get("/schedules")).body as any[]).map((s) => `${s.name}@${s.scope}`).sort(), ["morning@books", "once@main", "tick@global"]);
	assert.equal(json(path.join(h.home, "agents", "books", "agent.json")).schedules[0].cron, "0 7 * * 1-5");
	for (const [bad, why] of [
		[{ name: "x", task: "y" }, /exactly one of/],
		[{ name: "x", task: "y", cron: "0 7 * * *", every: "1h" }, /exactly one of/],
		[{ name: "x", task: "y", every: "10s" }, /at least "1m"/],
		[{ name: "x", task: "y", at: "2001-01-01 10:00" }, /in the past/],
		[{ name: "morning", task: "y", every: "1h" }, /exists already/],
		[{ name: "x", task: "", every: "1h" }, /needs a "task"/],
		[{ name: "x", task: "y", every: "1h", agent: "nobody" }, /there is no agent/],
	] as const) {
		const r = await a.post("/schedules", bad);
		assert.ok(r.status === 400 || r.status === 404, JSON.stringify(bad));
		assert.match(r.body.error, why);
	}
	// A schedule changed in place: the same agent, a new time and task; a change that does not pass leaves it as it was.
	const changed = (await a.post("/schedules", { replace: "morning", name: "morning", task: "Say what is due this week.", cron: "0 8 * * 1", agent: "books" })).body;
	assert.deepEqual({ name: changed.name, scope: changed.scope, task: changed.task }, { name: "morning", scope: "books", task: "Say what is due this week." });
	assert.equal(json(path.join(h.home, "agents", "books", "agent.json")).schedules.length, 1);
	assert.match((await a.post("/schedules", { replace: "morning", name: "morning", task: "x", cron: "not a time", agent: "books" })).body.error, /./);
	assert.equal(json(path.join(h.home, "agents", "books", "agent.json")).schedules[0].cron, "0 8 * * 1", "a failed change keeps the old one");
	assert.equal(((await a.get("/schedules")).body as any[]).filter((s) => s.name === "morning").length, 1);
	assert.equal((await a.post("/schedules", { replace: "nothing", name: "x", task: "y", every: "1h" })).status, 400);
	assert.equal((await a.post("/schedules/remove", { name: "morning" })).status, 404, "it is the agent's");
	assert.deepEqual((await a.post("/schedules/remove", { name: "morning", agent: "books" })).body, { removed: true });
	assert.deepEqual((await a.post("/schedules/remove", { name: "tick" })).body, { removed: true });
	assert.deepEqual((await a.post("/schedules/remove", { name: "once", agent: "main" })).body, { removed: true });
	assert.equal(json(path.join(h.home, "agents", "books", "agent.json")).schedules, undefined);

	// Routes: written, and at work at once.
	const route = (await a.post("/routes", { name: "door", on: "test/door", when: '{"payload.open": true}', set: '{"house/door": "open"}' })).body;
	assert.equal(route.name, "door");
	assert.ok(route.lines.some((l: string) => l.includes("set shared state")));
	assert.deepEqual(((await a.get("/routes")).body as any[]).map((r) => [r.name, r.on, r.set]), [["door", ["test/door"], { "house/door": "open" }]]);
	await a.post("/events", { topic: "test/door", payload: { open: true } });
	await until(() => h.pine.state.get("house/door") === "open", 2000, "the new route to act");
	const widened = (await a.post("/routes", { name: "mine", on: "test/mine", agent: "books", prompt: "Look.", trust: "owner" })).body;
	assert.match(widened.wider, /treated as coming from you/);
	assert.equal((await a.post("/routes", { name: "door", on: "x/y", agent: "main" })).status, 400, "a name is used once");
	assert.match((await a.post("/routes", { name: "idle", on: "x/y" })).body.error, /has to do something/);
	// A route changed in place: checked as if the old one were gone, so it may keep its name.
	const moved = (await a.post("/routes", { replace: "door", name: "door", on: "test/door2", set: '{"house/door": "open"}' })).body;
	assert.equal(moved.name, "door");
	assert.deepEqual(((await a.get("/routes")).body as any[]).map((r) => [r.name, r.on]), [["door", ["test/door2"]], ["mine", ["test/mine"]]], "in the same place");
	assert.equal((await a.post("/routes", { replace: "nothing", name: "x", on: "x/y", agent: "main" })).status, 404);
	assert.equal((await a.post("/routes", { replace: "door", name: "door", on: "" })).status, 400);
	assert.equal(json(path.join(h.home, "pine.json")).routes[0].on, "test/door2", "a failed change keeps the old one");
	await a.post("/routes", { replace: "door", name: "door", on: "test/door", when: '{"payload.open": true}', set: '{"house/door": "open"}' });
	// A route of an agent's own: on its own state, acting within it, and it stays the agent's when it changes.
	const own = (await a.post("/routes", { name: "flagged", of: "books", on: "state/agent/books/flag", set: '{"agent/books/seen": "yes"}' })).body;
	assert.ok(own.lines.some((l: string) => l.includes("of books")));
	assert.equal(((await a.get("/routes")).body as any[]).find((r) => r.name === "flagged").of, "books");
	assert.match((await a.post("/routes", { name: "wide", of: "books", on: "test/door", agent: "books" })).body.error, /not an event of yours/);
	assert.equal((await a.post("/routes", { name: "admin", of: "main", on: "x/y", agent: "main" })).status, 400);
	await a.post("/routes", { replace: "flagged", name: "flagged", on: "state/agent/books/flag", set: '{"agent/books/seen": "twice"}' });
	assert.equal(((await a.get("/routes")).body as any[]).find((r) => r.name === "flagged").of, "books");
	assert.match((await a.post("/routes", { replace: "flagged", name: "flagged", on: "test/door", agent: "books" })).body.error, /not an event of yours/);
	await a.post("/routes/remove", { name: "flagged" });
	assert.deepEqual((await a.post("/routes/remove", { name: "door" })).body, { removed: true });
	assert.equal((await a.post("/routes/remove", { name: "door" })).status, 404);
	await a.post("/state", { key: "house/door", value: null });
	await a.post("/events", { topic: "test/door", payload: { open: true } });
	await a.post("/routes/remove", { name: "mine" });
	assert.equal(json(path.join(h.home, "pine.json")).routes, undefined);
	assert.equal(h.pine.state.get("house/door"), undefined, "a removed route no longer acts");
	await h.close();
});

test("the owner sets an event source up and takes it out again; a secret it needs goes into .env and nowhere else", async (t) => {
	const scans = tmp(t, "pine-scans-");
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: {}, books: {} } });
	const a = api(h);

	const types = (await a.get("/sources/types")).body as any[];
	const folder = types.find((x) => x.name === "folder");
	assert.equal(folder.own, false);
	assert.equal(folder.options.properties.dir.type, "string");
	assert.ok(types.some((x) => x.name === "mqtt" && x.options.properties.password.secret === true));

	// What it would do, before anything is written.
	const plan = (await a.post("/sources/propose", { name: "scans", type: "folder", options: { dir: scans, mask: "*.pdf" }, agent: "books" })).body;
	assert.equal(plan.opens, true);
	assert.ok(plan.does.some((d: string) => d.includes(scans)) && plan.does.some((d: string) => d.includes("let books read")));
	assert.deepEqual(plan.needs, []);
	assert.equal(json(path.join(h.home, "agents", "books", "agent.json")).sources, undefined, "a proposal writes nothing");
	const wrong = await a.post("/sources/propose", { name: "scans", type: "folder", options: { dir: path.join(scans, "missing") }, agent: "books" });
	assert.equal(wrong.status, 400);
	assert.match(wrong.body.error, /not a folder that exists/);
	assert.match((await a.post("/sources/propose", { name: "x", type: "teapot", options: {} })).body.error, /unknown type "teapot"/);

	assert.deepEqual((await a.post("/sources", { name: "scans", type: "folder", description: "What the scanner saves", options: { dir: scans, mask: "*.pdf" }, agent: "books" })).body, { name: "scans", type: "folder" });
	const books = json(path.join(h.home, "agents", "books", "agent.json"));
	assert.deepEqual(books.sources.scans, { type: "folder", description: "What the scanner saves", dir: scans, mask: "*.pdf" });
	assert.deepEqual(books.sandbox.read, [scans], "reading the folder comes with watching it");
	assert.ok(((await a.get("/sources")).body as any[]).some((s) => s.name === "scans" && s.scope === "books"));
	assert.equal((await a.post("/sources", { name: "scans", type: "folder", options: { dir: scans }, agent: "books" })).status, 400, "a name is used once");
	assert.deepEqual((await a.post("/sources/remove", { name: "scans", agent: "books" })).body, { removed: true, unsubscribed: [] });
	assert.equal((await a.post("/sources/remove", { name: "scans", agent: "books" })).status, 404);
	const after = json(path.join(h.home, "agents", "books", "agent.json"));
	assert.equal(after.sources, undefined);
	assert.equal(after.sandbox, undefined, "removing leaves things as they were");

	// One for all agents that wants a password: it is asked for, typed by the owner, and kept in .env.
	const broker = { name: "house", type: "mqtt", description: "The house", options: { url: "mqtt://127.0.0.1:1883", topics: "house/#" }, ask: ["password"] };
	assert.deepEqual((await a.post("/sources/propose", broker)).body.needs.map((n: any) => n.name), ["password"]);
	const missing = await a.post("/sources", broker);
	assert.equal(missing.status, 400);
	assert.deepEqual(missing.body.needs.map((n: any) => n.name), ["password"]);
	const secret = "hunter2-very-secret-9431";
	assert.equal((await a.post("/sources", { ...broker, values: { password: secret } })).body.name, "house");
	const entry = json(path.join(h.home, "pine.json")).sources.house;
	assert.match(entry.password, /^\$\{PINE_SOURCE_HOUSE_PASSWORD\}$/);
	assert.ok(fs.readFileSync(path.join(h.home, ".env"), "utf8").includes(`PINE_SOURCE_HOUSE_PASSWORD=${secret}`));
	assert.ok(!h.logs.join("\n").includes(secret), "not in the log");
	assert.ok(!JSON.stringify(h.pine.bus.query({ limit: 500 })).includes(secret), "not in an event");
	assert.deepEqual((await a.post("/sources/remove", { name: "house" })).body.removed, true);
	assert.ok(!fs.readFileSync(path.join(h.home, ".env"), "utf8").includes("PINE_SOURCE_HOUSE_PASSWORD"), "its secret goes with it");
	await h.close();
});

test("the owner adds a model server by its address, with its key when it wants one, and removes it", async (t) => {
	// A server that speaks OpenAI's list of models, and wants a key when started with one.
	const serve = async (key?: string) => {
		const server = http.createServer((req, res) => {
			if (key && req.headers.authorization !== `Bearer ${key}`) return void res.writeHead(401).end("{}");
			if (req.url === "/v1/models") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "nemo", context_length: 32000 }] }));
			res.writeHead(404).end("{}");
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		t.after(() => server.close());
		return `http://127.0.0.1:${(server.address() as any).port}`;
	};
	const open = await serve();
	const locked = await serve("sk-studio-7781");
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: {} } });
	const a = api(h);

	assert.deepEqual((await a.post("/models/servers", { name: "studio", url: open })).body, { models: ["studio/nemo"] });
	const listed = ((await a.get("/models/servers")).body as any[]).find((s) => s.name === "studio");
	assert.deepEqual({ baseUrl: listed.baseUrl, key: listed.key, models: listed.models.map((m: any) => [m.id, m.contextWindow]) }, { baseUrl: `${open}/v1`, key: "none", models: [["nemo", 32000]] });
	assert.ok(((await a.get("/models")).body as string[]).includes("studio/nemo"), "the running pine has it at once");

	// One that wants a key says so, and nothing is added without the right one.
	const noKey = await a.post("/models/servers", { name: "vault", url: locked });
	assert.deepEqual({ status: noKey.status, locked: noKey.body.locked }, { status: 409, locked: true });
	const wrongKey = await a.post("/models/servers", { name: "vault", url: locked, key: "sk-wrong" });
	assert.deepEqual({ status: wrongKey.status, locked: wrongKey.body.locked }, { status: 409, locked: true });
	assert.ok(!((await a.get("/models/servers")).body as any[]).some((s) => s.name === "vault"));
	assert.deepEqual((await a.post("/models/servers", { name: "vault", url: locked, key: "sk-studio-7781" })).body, { models: ["vault/nemo"] });
	assert.match(fs.readFileSync(path.join(h.home, ".env"), "utf8"), /PINE_MODEL_VAULT_API_KEY=sk-studio-7781/);
	assert.ok(!fs.readFileSync(path.join(h.home, "models.json"), "utf8").includes("sk-studio-7781"), "the file names the key and does not hold it");
	assert.ok(!h.logs.join("\n").includes("sk-studio-7781"));
	assert.equal((await a.post("/models/servers", { name: "studio", url: open })).status, 400, "a name is used once");
	assert.match((await a.post("/models/servers", { name: "nowhere", url: "http://127.0.0.1:1" })).body.error, /no model server answers/);

	const providers = (await a.get("/models/providers")).body as any[];
	const studio = providers.find((p) => p.id === "studio");
	assert.deepEqual({ signedIn: studio.signedIn, models: studio.models, oauth: studio.oauth }, { signedIn: true, models: 1, oauth: false });
	assert.ok(providers.some((p) => p.id === "anthropic" && p.oauth === true), "a provider with a browser sign-in says so");

	// One that is in use stays.
	await a.post("/agents/main/model", { model: "studio/nemo" });
	const used = await a.post("/models/servers/remove", { name: "studio" });
	assert.equal(used.status, 409);
	assert.deepEqual(used.body.users, ["agent main"]);
	await a.post("/agents/main/model", { model: "mock/m" });
	assert.deepEqual((await a.post("/models/servers/remove", { name: "studio" })).body, { removed: true });
	assert.deepEqual((await a.post("/models/servers/remove", { name: "vault" })).body, { removed: true });
	assert.equal((await a.post("/models/servers/remove", { name: "vault" })).status, 404);
	assert.ok(!fs.readFileSync(path.join(h.home, ".env"), "utf8").includes("PINE_MODEL_VAULT_API_KEY"));
	await h.close();
});

test("a sign-in to a model provider is driven over several requests: its questions wait for the UI, and an answer is kept nowhere", async () => {
	// The bookkeeping, with a flow of the test's own.
	const kept: string[] = [];
	let reloaded = 0;
	const logins = new Logins(
		async (provider, type, p, signal) => {
			p.say(`signing in to ${provider}`);
			p.open("https://example.com/sign-in");
			const which = await p.select!("Which account?", [{ id: "work", label: "Work" }, { id: "home", label: "Home" }]);
			const key = await p.secret("API key");
			if (signal.aborted) throw new Error("cancelled");
			return [`${provider}/${which}-${type ?? "usual"}-${key.length}`];
		},
		{ secret: (v) => kept.push(v), ended: async () => void reloaded++ },
	);
	const id = logins.start("acme");
	await until(() => logins.view(id)?.question, 1000, "the first question");
	assert.deepEqual(logins.view(id), { lines: ["signing in to acme"], url: "https://example.com/sign-in", code: undefined, question: { message: "Which account?", secret: false, options: [{ id: "work", label: "Work" }, { id: "home", label: "Home" }] }, done: false, error: undefined, models: undefined });
	assert.equal(logins.answer(id, "home"), true);
	await until(() => logins.view(id)?.question?.secret, 1000, "the question for the key");
	assert.equal(logins.answer(id, "sk-typed-here"), true);
	await until(() => logins.view(id)?.done, 1000, "the sign-in to end");
	assert.deepEqual({ models: logins.view(id)!.models, error: logins.view(id)!.error, question: logins.view(id)!.question }, { models: ["acme/home-usual-13"], error: undefined, question: undefined });
	assert.deepEqual(kept, ["sk-typed-here"], "a secret answer is one from then on; the other is not");
	assert.equal(reloaded, 1);
	assert.ok(!JSON.stringify(logins.view(id)).includes("sk-typed-here"));
	assert.equal(logins.answer(id, "again"), false);
	assert.equal(logins.view("nothing"), undefined);
	// Cancelled while it waits; a second one for the same provider takes the place of the first; and there are only so many.
	const waits = logins.start("acme");
	await until(() => logins.view(waits)?.question, 1000, "a question");
	const second = logins.start("acme");
	assert.deepEqual({ done: logins.view(waits)!.done, error: logins.view(waits)!.error }, { done: true, error: "another sign-in for this provider was started" });
	assert.equal(logins.cancel(second), true);
	assert.deepEqual({ done: logins.view(second)!.done, error: logins.view(second)!.error }, { done: true, error: "cancelled" });
	assert.equal(logins.cancel(second), false);
	for (const p of ["a", "b", "c", "d"]) logins.start(p);
	assert.throws(() => logins.start("e"), /sign-ins are under way already/);
	logins.stop();

	// Through the control API, with pi's own flow for a key: no network is needed to store one.
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: {} } });
	const a = api(h);
	assert.equal((await a.post("/models/login", { provider: "no-such-provider" })).status, 400);
	assert.equal((await a.post("/models/login", { provider: "opencode", type: "password" })).status, 400);
	assert.equal((await a.get("/models/login/nothing")).status, 404);
	const started = (await a.post("/models/login", { provider: "opencode", type: "api_key" })).body;
	assert.equal(typeof started.id, "string");
	let view: any;
	await until(async () => (view = (await a.get(`/models/login/${started.id}`)).body).question || view.done, 5000, "pi's question for the key");
	assert.equal(view.question?.secret, true, JSON.stringify(view));
	assert.equal((await a.post(`/models/login/${started.id}`, {})).status, 400);
	assert.deepEqual((await a.post(`/models/login/${started.id}`, { answer: "sk-opencode-test-55120" })).body, { ok: true });
	await until(async () => (view = (await a.get(`/models/login/${started.id}`)).body).done, 5000, "the sign-in to end");
	assert.equal(view.error, undefined, JSON.stringify(view));
	assert.ok(view.models.length > 0 && view.models.every((m: string) => m.startsWith("opencode/")));
	assert.ok(!JSON.stringify(view).includes("sk-opencode-test-55120"));
	assert.ok(!h.logs.join("\n").includes("sk-opencode-test-55120"));
	assertPrivate(path.join(h.home, "auth.json"), 0o600);
	assert.equal(((await a.get("/models/providers")).body as any[]).find((p) => p.id === "opencode").signedIn, true);
	assert.ok(((await a.get("/models")).body as string[]).some((m) => m.startsWith("opencode/")), "the running pine has its models at once");
	assert.equal((await a.post(`/models/login/${started.id}`, { answer: "x" })).status, 409, "it waits for nothing any more");
	assert.deepEqual((await a.post("/models/logout", { provider: "opencode" })).body, { ok: true });
	assert.equal(((await a.get("/models/providers")).body as any[]).find((p) => p.id === "opencode").signedIn, false);
	assert.equal((await a.post("/models/logout", { provider: "no-such-provider" })).status, 400);

	// Signing in to an MCP server is for a remote one that exists.
	assert.equal((await a.post("/mcp/login", { name: "nothing" })).status, 404);
	await a.post("/mcp", { name: "local_one", server: { command: "true" } });
	const local = await a.post("/mcp/login", { name: "local_one" });
	assert.equal(local.status, 400);
	assert.match(local.body.error, /local server/);
	await h.close();
});

test("the overview says whether the browser build this pine drives is on the computer", async (t) => {
	// (Playwright's own variable for where its browsers lie: here a folder of the test's.)
	const dir = tmp(t, "pine-browsers-");
	const before = process.env.PLAYWRIGHT_BROWSERS_PATH;
	t.after(() => void (before === undefined ? delete process.env.PLAYWRIGHT_BROWSERS_PATH : (process.env.PLAYWRIGHT_BROWSERS_PATH = before)));
	process.env.PLAYWRIGHT_BROWSERS_PATH = dir;
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: {} } });
	const a = api(h);
	assert.equal((await a.get("/overview")).body.browser, false, "an empty folder has no browser");

	const places = (await browserPlaces()) ?? [];
	assert.ok(places.length > 0 && places.every((p) => p.startsWith(dir)), JSON.stringify(places));
	// A build of another Playwright beside it is not the one this pine drives.
	fs.mkdirSync(path.join(dir, "chromium-1"), { recursive: true });
	fs.writeFileSync(path.join(dir, "chromium-1", "INSTALLATION_COMPLETE"), "");
	assert.equal((await a.get("/overview")).body.browser, false);
	for (const place of places) {
		fs.mkdirSync(place, { recursive: true });
		fs.writeFileSync(path.join(place, "INSTALLATION_COMPLETE"), "");
	}
	assert.equal((await a.get("/overview")).body.browser, true);
	// A download that did not finish has left a folder without Playwright's mark.
	fs.rmSync(path.join(places[0], "INSTALLATION_COMPLETE"));
	assert.equal((await a.get("/overview")).body.browser, false);
	await h.close();
});

test("the list of agents says why an agent's model cannot answer: no sign-in, or the claude command is not there", async (t) => {
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: {}, books: { agent: { description: "Keeps the books" } }, scout: { agent: { description: "Looks things up" } } } });
	const a = api(h);
	const problem = async (agent: string) => ((await a.get("/agents")).body as any[]).find((x) => x.id === agent).modelProblem as string | undefined;
	assert.equal(await problem("main"), undefined, "a model that answers has nothing said about it");
	assert.ok(!("modelProblem" in (await a.get("/agents")).body[0]));

	// The stand-in of the example home: Claude through the `claude` command, which a computer has or has not.
	const file = path.join(h.home, "models.json");
	const models = json(file);
	models.providers.dev = { name: "claude -p", baseUrl: "http://127.0.0.1:9/v1", api: "openai-completions", apiKey: "none", models: [{ id: "claude-haiku", name: "Claude Haiku", contextWindow: 180000, maxTokens: 8192, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] };
	fs.writeFileSync(file, JSON.stringify(models));
	await h.pine.agents.reloadModels();
	assert.equal((await a.post("/agents/scout/model", { model: "dev/claude-haiku" })).status, 200);
	const bin = tmp(t, "pine-path-");
	const before = process.env.PATH;
	t.after(() => void (process.env.PATH = before));
	process.env.PATH = bin;
	assert.match((await problem("scout")) ?? "", /dev\/claude-haiku is Claude through the "claude" command.*no such command/);
	assert.equal(await problem("main"), undefined);
	// (Windows finds a command by its ending: claude.cmd, as npm installs it there.)
	fs.writeFileSync(path.join(bin, process.platform === "win32" ? "claude.cmd" : "claude"), "#!/bin/sh\n", { mode: 0o755 });
	assert.equal(await problem("scout"), undefined, "with the command there, nothing is said");
	process.env.PATH = before;

	// A provider's model: it answers while there is a sign-in or a key, and not after.
	const started = (await a.post("/models/login", { provider: "opencode", type: "api_key" })).body;
	let view: any;
	await until(async () => (view = (await a.get(`/models/login/${started.id}`)).body).question || view.done, 5000, "pi's question for the key");
	await a.post(`/models/login/${started.id}`, { answer: "sk-opencode-test-61377" });
	await until(async () => (view = (await a.get(`/models/login/${started.id}`)).body).done, 5000, "the sign-in to end");
	const model = view.models[0] as string;
	assert.equal((await a.post("/agents/books/model", { model })).status, 200);
	assert.equal(await problem("books"), undefined);
	await a.post("/models/logout", { provider: "opencode" });
	assert.equal(await problem("books"), `${model} needs a sign-in to opencode or a key for it, and there is none.`);
	await h.close();
});

test("the owner's editor writes a file of a conversation's folder, and a link planted there does not lead the write out of it", { skip: !sandboxAvailable() && "no sandbox on this system" }, async (t) => {
	const outside = tmp(t, "pine-outside-");
	const project = tmp(t, "pine-project-");
	fs.mkdirSync(path.join(project, "src"));
	fs.writeFileSync(path.join(project, "src", "app.ts"), "export const answer = 41;\n");
	fs.writeFileSync(path.join(project, "run.sh"), "#!/bin/sh\necho old\n", { mode: 0o755 });
	fs.writeFileSync(path.join(outside, "secret.txt"), "as it was\n");
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: { files: { "notes.md": "old\n" } }, other: { files: { "theirs.md": "theirs\n" } } } });
	const a = api(h);
	const ws = h.workspace("main");

	// In the agent's workspace, and in a folder opened for a conversation.
	assert.deepEqual((await a.post("/agents/main/view/write", { path: "notes.md", text: "new\nlines\n" })).body, { size: 10 });
	assert.equal(fs.readFileSync(path.join(ws, "notes.md"), "utf8"), "new\nlines\n");
	assert.equal((await a.post("/agents/main/folder", { session: "proj", folder: project })).status, 200);
	assert.equal((await a.post("/agents/main/view/write", { session: "proj", path: "src/app.ts", text: "export const answer = 42;\n" })).status, 200);
	assert.equal(fs.readFileSync(path.join(project, "src", "app.ts"), "utf8"), "export const answer = 42;\n");
	// A file is written in place and keeps what it was; a new one is made; a new folder is not.
	await a.post("/agents/main/view/write", { session: "proj", path: "run.sh", text: "#!/bin/sh\necho new\n" });
	assert.equal(fs.statSync(path.join(project, "run.sh")).mode & 0o777, 0o755);
	await a.post("/agents/main/view/write", { session: "proj", path: "src/fresh.ts", text: "" });
	assert.equal(fs.readFileSync(path.join(project, "src", "fresh.ts"), "utf8"), "");
	const noFolder = await a.post("/agents/main/view/write", { session: "proj", path: "lib/deep/x.ts", text: "x" });
	assert.equal(noFolder.status, 409);
	assert.match(noFolder.body.error, /there is no folder lib\/deep/);
	assert.equal((await a.post("/agents/main/view/write", { session: "proj", path: "src", text: "x" })).status, 409, "a folder is not a file");

	// What leads out is refused, and what lies outside is as it was.
	fs.symlinkSync(path.join(outside, "secret.txt"), path.join(project, "leak.txt"));
	fs.symlinkSync(outside, path.join(project, "out"));
	fs.symlinkSync(path.join(h.home, "pine.json"), path.join(project, "settings.json"));
	const pineJson = fs.readFileSync(path.join(h.home, "pine.json"), "utf8");
	for (const p of ["leak.txt", "out/secret.txt", "out/new.txt", "../escape.txt", `../${path.basename(outside)}/secret.txt`, path.join(outside, "secret.txt"), "settings.json", "a\0b"]) {
		const r = await a.post("/agents/main/view/write", { session: "proj", path: p, text: "written by the daemon\n" });
		assert.ok(r.status === 409 || r.status === 403 || r.status === 400, `${p}: ${r.status} ${JSON.stringify(r.body)}`);
	}
	assert.equal(fs.readFileSync(path.join(outside, "secret.txt"), "utf8"), "as it was\n");
	assert.deepEqual(fs.readdirSync(outside), ["secret.txt"]);
	assert.equal(fs.readFileSync(path.join(h.home, "pine.json"), "utf8"), pineJson);
	assert.ok(!fs.existsSync(path.join(path.dirname(project), "escape.txt")));
	// A second name of a file that lies elsewhere: the folder gets a file of its own, and the other is as it was.
	fs.linkSync(path.join(outside, "secret.txt"), path.join(project, "twin.txt"));
	assert.equal((await a.post("/agents/main/view/write", { session: "proj", path: "twin.txt", text: "only here\n" })).status, 200);
	assert.equal(fs.readFileSync(path.join(project, "twin.txt"), "utf8"), "only here\n");
	assert.equal(fs.readFileSync(path.join(outside, "secret.txt"), "utf8"), "as it was\n");
	// What holds when a path changes between the look and the write is the sandbox the bytes are put into place in.
	for (const target of [path.join(outside, "secret.txt"), path.join(outside, "new.txt"), path.join(project, "out", "new.txt"), path.join(project, "leak.txt")]) {
		const done = await putInto(project, target, Buffer.from("written by the daemon\n"));
		if (target.endsWith("leak.txt")) continue; // the link itself is replaced by a file, which is inside
		assert.notEqual(done.code, 0, target);
	}
	assert.equal(fs.readFileSync(path.join(outside, "secret.txt"), "utf8"), "as it was\n");
	assert.deepEqual(fs.readdirSync(outside), ["secret.txt"]);
	assert.ok(fs.lstatSync(path.join(project, "leak.txt")).isFile());
	assert.deepEqual(fs.readdirSync(project).filter((n) => n.includes(".pine-")), [], "nothing is left beside the files");
	// A link that stays inside the folder is the folder's own business.
	fs.symlinkSync(path.join(project, "src", "app.ts"), path.join(project, "alias.ts"));
	assert.equal((await a.post("/agents/main/view/write", { session: "proj", path: "alias.ts", text: "export const answer = 43;\n" })).status, 200);
	assert.equal(fs.readFileSync(path.join(project, "src", "app.ts"), "utf8"), "export const answer = 43;\n");

	// Another agent's files are not reached through this one, and the rest is as for any request.
	assert.equal((await a.post("/agents/main/view/write", { path: `../../other/workspace/theirs.md`, text: "x" })).status, 409);
	assert.equal(fs.readFileSync(path.join(h.workspace("other"), "theirs.md"), "utf8"), "theirs\n");
	assert.equal((await a.post("/agents/nobody/view/write", { path: "x", text: "x" })).status, 404);
	assert.equal((await a.post("/agents/main/view/write", { path: "x" })).status, 400);
	assert.equal((await a.post("/agents/main/view/write", { path: "big.txt", text: "x".repeat(2 * 1024 * 1024 + 1) })).status, 413);
	assert.equal((await fetch(`${a.base}/agents/main/view/write`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);

	// An editor reads the whole of a file that the pane only shows the start of.
	const long = `${"0123456789abcdef".repeat(4096 * 5)}`;
	await a.post("/agents/main/view/write", { path: "long.txt", text: long });
	const some = (await a.get("/agents/main/view/file?path=long.txt")).body;
	assert.deepEqual({ length: some.text.length, truncated: some.truncated }, { length: 256 * 1024, truncated: true });
	const all = (await a.get(`/agents/main/view/file?path=long.txt&max=${2 * 1024 * 1024}`)).body;
	assert.deepEqual({ length: all.text.length, truncated: all.truncated }, { length: long.length, truncated: false });
	assert.equal((await a.get("/agents/main/view/file?path=long.txt&max=999999999")).body.text.length, long.length, "never more than an editor's limit");
	await h.close();
});

test("the owner's file tree makes, renames, copies, moves and deletes files of a conversation's folder, and never through a link out of it", { skip: !sandboxAvailable() && "no sandbox on this system" }, async (t) => {
	const outside = tmp(t, "pine-outside-");
	const project = tmp(t, "pine-project-");
	fs.mkdirSync(path.join(project, "src"));
	fs.writeFileSync(path.join(project, "src", "app.ts"), "export const answer = 41;\n");
	fs.writeFileSync(path.join(outside, "secret.txt"), "as it was\n");
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: {} } });
	const a = api(h);
	assert.equal((await a.post("/agents/main/folder", { session: "proj", folder: project })).status, 200);
	const files = (body: Record<string, unknown>) => a.post("/agents/main/view/files", { session: "proj", ...body });
	const has = (p: string) => fs.existsSync(path.join(project, p));

	// Made, with the folders a new name needs; never over what is there.
	assert.deepEqual((await files({ op: "folder", path: "lib/deep" })).body, { paths: ["lib/deep"] });
	assert.deepEqual((await files({ op: "file", path: "lib/deep/x.ts" })).body, { paths: ["lib/deep/x.ts"] });
	assert.equal(fs.readFileSync(path.join(project, "lib", "deep", "x.ts"), "utf8"), "");
	assert.match((await files({ op: "file", path: "src/app.ts" })).body.error, /already something named src\/app.ts/);
	assert.equal(fs.readFileSync(path.join(project, "src", "app.ts"), "utf8"), "export const answer = 41;\n");
	// Renamed, also into another folder; never onto another file, never into itself.
	assert.deepEqual((await files({ op: "rename", path: "lib/deep/x.ts", to: "lib/y.ts" })).body, { paths: ["lib/y.ts"] });
	assert.equal((await files({ op: "rename", path: "lib/y.ts", to: "src/app.ts" })).status, 409);
	assert.equal((await files({ op: "rename", path: "lib", to: "lib/deep/lib" })).status, 409);
	assert.ok(has("lib/y.ts") && has("src/app.ts"));
	// A copy gets a name that is free; a move keeps its name and refuses to cover another.
	assert.deepEqual((await files({ op: "copy", paths: ["src/app.ts"], into: "src" })).body, { paths: ["src/app copy.ts"] });
	assert.deepEqual((await files({ op: "copy", paths: ["src/app.ts"], into: "src" })).body, { paths: ["src/app copy 2.ts"] });
	assert.deepEqual((await files({ op: "move", paths: ["src/app copy.ts", "lib/y.ts"], into: "" })).body, { paths: ["app copy.ts", "y.ts"] });
	assert.equal((await files({ op: "move", paths: ["src/app copy 2.ts"], into: "lib/deep/x.ts" })).status, 409, "into a file");
	assert.equal((await files({ op: "move", paths: ["lib"], into: "lib/deep" })).status, 409, "into itself");
	// Deleted, several at once; the folder itself never.
	assert.deepEqual((await files({ op: "delete", paths: ["app copy.ts", "y.ts", "lib", "src/app copy 2.ts"] })).body, { paths: [] });
	assert.ok(!has("app copy.ts") && !has("y.ts") && !has("lib") && !has("src/app copy 2.ts"));
	for (const p of ["", ".", "src/..", "/"]) assert.equal((await files({ op: "delete", paths: [p] })).status, 409, `delete ${JSON.stringify(p)}`);
	assert.ok(has("src/app.ts"));

	// A link out of the folder is moved, copied and deleted as the link it is; nothing is reached through it.
	fs.symlinkSync(path.join(outside, "secret.txt"), path.join(project, "leak.txt"));
	fs.symlinkSync(outside, path.join(project, "out"));
	assert.equal((await files({ op: "copy", paths: ["leak.txt"], into: "src" })).status, 200);
	assert.ok(fs.lstatSync(path.join(project, "src", "leak.txt")).isSymbolicLink(), "a copied link stays a link");
	for (const body of [
		{ op: "delete", paths: ["out/secret.txt"] },
		{ op: "file", path: "out/new.txt" },
		{ op: "folder", path: "out/new" },
		{ op: "rename", path: "out/secret.txt", to: "stolen.txt" },
		{ op: "rename", path: "src/app.ts", to: "out/app.ts" },
		{ op: "copy", paths: ["out/secret.txt"], into: "src" },
		{ op: "copy", paths: ["src/app.ts"], into: "out" },
		{ op: "move", paths: ["src/app.ts"], into: "out" },
		{ op: "delete", paths: ["../escape"] },
		{ op: "file", path: `../${path.basename(outside)}/new.txt` },
		{ op: "file", path: path.join(outside, "new.txt") },
		{ op: "delete", paths: ["a\0b"] },
		{ op: "chmod", paths: ["src/app.ts"] },
	]) {
		const r = await files(body);
		assert.ok(r.status === 409 || r.status === 400, `${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
	}
	assert.deepEqual((await files({ op: "delete", paths: ["leak.txt", "out", "src/leak.txt"] })).body, { paths: [] });
	assert.equal(fs.readFileSync(path.join(outside, "secret.txt"), "utf8"), "as it was\n");
	assert.deepEqual(fs.readdirSync(outside), ["secret.txt"]);

	// Found by what is in them, ignoring case.
	fs.writeFileSync(path.join(project, "src", "notes.md"), "first\nThe ANSWER is here\n");
	assert.deepEqual((await a.get("/agents/main/view/grep?session=proj&q=answer")).body.files.map((f: { path: string; line: number }) => [f.path, f.line]).sort(), [["src/app.ts", 1], ["src/notes.md", 2]]);
	assert.deepEqual((await a.get("/agents/main/view/grep?session=proj&q=nowhere")).body.files, []);

	// In the agent's workspace its own files stay where they are: the rest of a deletion or a move goes on, they are said to be kept.
	const ws = h.workspace("main");
	for (const f of ["AGENTS.md", "MEMORY.md", "notes.md"]) fs.writeFileSync(path.join(ws, f), `${f}\n`);
	const mine = (body: Record<string, unknown>) => a.post("/agents/main/view/files", body);
	assert.deepEqual((await mine({ op: "folder", path: "sub" })).body, { paths: ["sub"] });
	assert.deepEqual((await mine({ op: "move", paths: ["MEMORY.md", "notes.md"], into: "sub" })).body, { paths: ["sub/notes.md"], kept: ["MEMORY.md"] });
	assert.deepEqual((await mine({ op: "delete", paths: ["AGENTS.md", "sub/notes.md"] })).body, { paths: [], kept: ["AGENTS.md"] });
	assert.match((await mine({ op: "rename", path: "AGENTS.md", to: "old.md" })).body.error, /one of the agent's own files/);
	assert.deepEqual((await mine({ op: "copy", paths: ["AGENTS.md"], into: "sub" })).body, { paths: ["sub/AGENTS.md"] }, "a copy is no harm");
	assert.deepEqual((await mine({ op: "delete", paths: ["sub"] })).body, { paths: [] }, "a copy deeper down is just a file");
	assert.deepEqual(["AGENTS.md", "MEMORY.md"].map((f) => fs.readFileSync(path.join(ws, f), "utf8")), ["AGENTS.md\n", "MEMORY.md\n"]);
	// A folder of the owner's own is not the agent's: its AGENTS.md is the project's, and goes when asked.
	fs.writeFileSync(path.join(project, "AGENTS.md"), "the project's\n");
	assert.deepEqual((await files({ op: "delete", paths: ["AGENTS.md"] })).body, { paths: [] });
	assert.ok(!has("AGENTS.md"));

	// pine's home is never changed through a conversation's folder, and the rest is as for any request.
	assert.equal((await a.post("/agents/main/folder", { session: "home", folder: h.home })).status === 200 ? (await a.post("/agents/main/view/files", { session: "home", op: "delete", paths: ["pine.json"] })).status : 403, 403);
	assert.ok(fs.existsSync(path.join(h.home, "pine.json")));
	assert.equal((await a.post("/agents/nobody/view/files", { op: "delete", paths: ["x"] })).status, 404);
	assert.equal((await fetch(`${a.base}/agents/main/view/files`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: "proj", op: "delete", paths: ["src"] }) })).status, 401);
	assert.ok(has("src/app.ts"));
	await h.close();
});

test("the owner gives an agent a color of its own: kept in its agent.json, read back by the control API, taken away with none", async () => {
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: {}, books: { agent: { description: "Keeps the books" } } } });
	const a = api(h);
	const file = path.join(h.home, "agents", "books", "agent.json");
	const listed = async (id: string) => ((await a.get("/agents")).body as any[]).find((x) => x.id === id);
	assert.ok(!("color" in (await listed("books"))), "an agent without a color has none in the list");
	assert.ok(!("color" in (await a.get("/agents/books/detail")).body), "nor in its detail");

	// Any case is taken, and kept in lower case.
	const set = await a.post("/agents/books/update", { color: "#E0805A" });
	assert.equal(set.status, 200);
	assert.deepEqual(set.body.lines, ["color: #e0805a"]);
	assert.equal(json(file).color, "#e0805a");
	assert.equal((await listed("books")).color, "#e0805a");
	assert.equal((await a.get("/agents/books/detail")).body.color, "#e0805a");

	// What is not #rrggbb is refused, and nothing is written.
	for (const bad of ["coral", "#e08", "e0805a", "#e0805g"]) {
		const r = await a.post("/agents/books/update", { color: bad });
		assert.equal(r.status, 400, bad);
		assert.match(r.body.error, /a color is written #rrggbb/, bad);
	}
	assert.equal(json(file).color, "#e0805a");

	// None takes it away: the key is gone, and the agent is as it was.
	for (const none of ["none", ""]) {
		await a.post("/agents/books/update", { color: "#336699" });
		const r = await a.post("/agents/books/update", { color: none });
		assert.deepEqual(r.body.lines, ["color: none"], JSON.stringify(none));
		assert.ok(!("color" in json(file)));
		assert.ok(!("color" in (await listed("books"))));
	}
	assert.match((await a.post("/agents/books/update", {})).body.error, /nothing to change: give at least one of .*color/);

	// A new agent can be made with one; a bad one makes nothing.
	assert.equal((await a.post("/agents", { id: "scout", description: "Scouts", instructions: "You are SCOUT.", color: "#3366CC" })).status, 200);
	assert.equal(json(path.join(h.home, "agents", "scout", "agent.json")).color, "#3366cc");
	assert.equal((await listed("scout")).color, "#3366cc");
	assert.match((await a.post("/agents", { id: "ghost", description: "Ghost", instructions: "You are GHOST.", color: "coral" })).body.error, /a color is written #rrggbb/);
	assert.ok(!fs.existsSync(path.join(h.home, "agents", "ghost")));
	await h.close();

	// A color written by hand that is not one is a problem of that agent's file.
	const bad = await harness({ agents: { main: {}, books: { agent: { description: "Keeps the books", color: "coral" } } }, start: false } as any);
	assert.throws(() => loadConfig(bad.home), /agents\/books\/agent\.json: color must be written #rrggbb, for example #e0805a \(got "coral"\)/);
	await bad.close();
});
