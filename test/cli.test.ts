import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { assertPrivate, harness, until } from "./support/harness.ts";

const run = promisify(execFile);
// "pine init" also fetches the browser, which a test must not do.
process.env.PINE_SKIP_DOWNLOADS = "1";
const CLI = path.resolve(import.meta.dirname, "../src/cli.ts");
const freePort = () =>
	new Promise<number>((resolve) => {
		const s = net.createServer();
		s.listen(0, "127.0.0.1", () => {
			const { port } = s.address() as net.AddressInfo;
			s.close(() => resolve(port));
		});
	});

test("pine init creates a private home that passes pine check", async (t) => {
	const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pine-init-")), "home");
	t.after(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }));
	const init = await run(process.execPath, [CLI, "init", dir]);
	assert.match(init.stdout, /pine\.json/);
	assertPrivate(dir, 0o700);
	for (const f of ["pine.json", "models.json", ".env", "USER.md", "AGENTS.md", "TOOLS.md", "agents/main/workspace/AGENTS.md", "agents/main/workspace/SOUL.md", "agents/main/workspace/TOOLS.md", "agents/main/workspace/MEMORY.md"]) assertPrivate(path.join(dir, f), 0o600, f);
	assert.ok(!fs.existsSync(path.join(dir, "agents", "main", "AGENTS.md")), "an agent's instructions are in its workspace, where it can change them");
	const check = await run(process.execPath, [CLI, "check", "--home", dir]);
	// (Windows has no sandbox of pine's yet, and pine check says so: the one note there.)
	for (const part of ["agent main (main)", "mcp        web, browser", "model      none yet", process.platform === "win32" ? "no sandbox on this machine" : "No security notes."]) assert.ok(check.stdout.includes(part), `${part}\n${check.stdout}`);
	assert.equal(fs.readdirSync(path.join(dir, "agents")).join(), "main", "the example starts with one agent");
	const again = await run(process.execPath, [CLI, "init", dir]);
	assert.match(again.stdout, /nothing changed/);
	// A home from before that: its instructions stay where the owner has them, and no second copy is made.
	fs.renameSync(path.join(dir, "agents", "main", "workspace", "AGENTS.md"), path.join(dir, "agents", "main", "AGENTS.md"));
	fs.rmSync(path.join(dir, "agents", "main", "workspace", "SOUL.md"));
	const older = await run(process.execPath, [CLI, "init", dir]);
	assert.ok(older.stdout.includes(path.join("agents", "main", "workspace", "SOUL.md")) && /agents[\\/]main[\\/]AGENTS\.md stays where it is.*move the file to agents[\\/]main[\\/]workspace[\\/]AGENTS\.md/s.test(older.stdout), older.stdout);
	assert.ok(!fs.existsSync(path.join(dir, "agents", "main", "workspace", "AGENTS.md")));

	// A home whose main agent has another name (a new home's was called prime for a while): what is missing is put into its own main agent, and no second one is made.
	const old = path.join(path.dirname(dir), "old");
	fs.mkdirSync(path.join(old, "agents", "prime", "workspace"), { recursive: true });
	fs.writeFileSync(path.join(old, "pine.json"), JSON.stringify({ main: "prime", defaults: { model: "x/y" } }));
	await run(process.execPath, [CLI, "init", old]);
	assert.equal(fs.readdirSync(path.join(old, "agents")).join(), "prime");
	assert.ok(fs.existsSync(path.join(old, "agents", "prime", "workspace", "SOUL.md")));
	assert.equal(JSON.parse(fs.readFileSync(path.join(old, "pine.json"), "utf8")).main, "prime", "its pine.json is its own");
});

test("the command line drives a running daemon", async (t) => {
	const port = await freePort();
	const h = await harness({ pine: { http: { port }, logLevel: "warn" }, agents: { main: {} }, start: false });
	const daemon = spawn(process.execPath, [CLI, "start", "--home", h.home], { stdio: ["ignore", "ignore", "pipe"] });
	let stderr = "";
	daemon.stderr.on("data", (d) => (stderr += d));
	t.after(() => daemon.kill("SIGKILL"));
	const pine = async (...args: string[]) => (await run(process.execPath, [CLI, ...args, "--home", h.home])).stdout.trim();
	await until(async () => (await fetch(`http://127.0.0.1:${port}/health`).catch(() => undefined))?.ok, 8000, `the daemon to listen (${stderr})`);

	assert.equal(await pine("send", "main", "hello", "from", "the", "shell"), "ECHO[hello from the shell]");
	assert.match(await pine("send", "main", "queued", "--no-wait", "--session", "side"), /task #2 queued/);
	assert.match(await pine("emit", "test/topic", '{"n":1}'), /event #\d+/);
	assert.match(await pine("events", "--topic", "test/#"), /test\/topic\s+owner\s+api\s+\{"n":1\}/);
	assert.deepEqual(JSON.parse(await pine("agents")).map((a: any) => a.id), ["main"]);
	assert.equal(JSON.parse(await pine("status")).limiter.max, 8);
	await until(async () => /#2 .* done .* main\/side/.test(await pine("tasks")), 5000, "task 2 in the task list");
	assert.equal(JSON.parse(await pine("task", "1")).result, "ECHO[hello from the shell]");
	assert.equal(await pine("approvals"), "nothing waits for approval");
	assert.deepEqual(JSON.parse(await pine("reset", "main")), { reset: true });
	await assert.rejects(() => pine("send", "nobody", "x"), /unknown agent "nobody"/);

	const stopped = new Promise((r) => daemon.once("exit", r));
	daemon.kill("SIGTERM");
	// (Windows has no SIGTERM to catch: there it is the end of the process, and Ctrl+C is the clean way.)
	if (process.platform !== "win32") assert.equal(await stopped, 0, "SIGTERM shuts the daemon down cleanly");
	else await stopped;
	await assert.rejects(() => pine("status"), /no daemon answers/);
	await h.close();
});

test("pine agent list, add, update and remove: in the files when no daemon runs, through the daemon when one does; a removed agent leaves nothing", { skip: process.platform === "win32" && "describes an agent in safe mode, which needs a sandbox Windows does not have (docs/adr/0004-three-systems.md)" }, async (t) => {
	const port = await freePort();
	const h = await harness({
		pine: { http: { port }, logLevel: "warn", routes: [{ name: "wake-old", on: "test/old", agent: "old", prompt: "x" }, { name: "keep", on: "test/keep", set: { seen: "yes" } }] },
		agents: { main: {}, old: { agent: { description: "Kept the old books" }, files: { "ledger/2025.csv": "row" } }, aide: { agent: { description: "Second pair of hands", delegates: ["old"] } } },
		start: false,
	});
	const pine = async (...args: string[]) => (await run(process.execPath, [CLI, ...args, "--home", h.home])).stdout.trim();
	const fails = (...args: string[]) => run(process.execPath, [CLI, ...args, "--home", h.home]).then((r) => `NO ERROR: ${r.stdout}`, (e) => String(e.stderr) + String(e.stdout));
	const file = (...parts: string[]) => path.join(h.home, ...parts);
	const json = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));

	// ---- no daemon: the files are changed, and checked the way pine checks them at a start
	let list = await pine("agent", "list");
	assert.match(list, /^main \(main\): /);
	assert.match(list, /old: Kept the old books\n    model mock\/m \(the default\) · reasoning off · mode safe · reach the agent's own folders \(sandbox\)\n    conversations: none · sources: none · MCP servers: none · schedules: none · skills: none · routes: wake-old · 1 file in /);
	assert.match(await pine("agent", "add", "books", "--description", "Keeps the books", "--tools", "read,grep"), /^Created the agent books \(tools: read, grep\)\. The agent's workspace is .*agents[\\/]books[\\/]workspace\. It is there when pine is started\.$/);
	assert.deepEqual(json(file("agents", "books", "agent.json")), { tools: ["read", "grep"] }, "what it is for is the first paragraph of its instructions, not a key of its own");
	assert.equal(fs.readFileSync(file("agents", "books", "workspace", "AGENTS.md"), "utf8"), "You are books. Keeps the books.\n");
	assert.match(await fails("agent", "add", "Bad Id", "--description", "x"), /is not a usable agent id/);
	assert.match(await fails("agent", "add", "books", "--description", "again"), /an agent called books exists already/);
	assert.match(await fails("agent", "add", "nodesc"), /usage: pine agent add <id> \[--description/);

	// Changing an agent in the files: only what is given changes, the rest stays.
	assert.match(await fails("agent", "update", "books", "--description", "Does the books now"), /the first paragraph of the agent's instructions/);
	assert.match(await pine("agent", "update", "books", "--tools", "read,bash,grep"), /^Updated the agent books \(it is there when pine is started\):\n  built-in tools: read, grep -> read, bash, grep$/);
	assert.deepEqual(json(file("agents", "books", "agent.json")), { tools: ["read", "bash", "grep"] });
	assert.match(await pine("agent", "list"), /books: You are books\. Keeps the books\.\n/);
	assert.match(await pine("agent", "update", "books", "--color", "#E0805A"), /^Updated the agent books \(it is there when pine is started\):\n  color: #e0805a$/);
	assert.equal(json(file("agents", "books", "agent.json")).color, "#e0805a");
	assert.match(await fails("agent", "update", "books", "--color", "coral"), /a color is written #rrggbb/);
	assert.match(await pine("agent", "update", "books", "--color", "none"), /color: none$/);
	assert.ok(!("color" in json(file("agents", "books", "agent.json"))));
	assert.match(await fails("agent", "update", "ghost", "--description", "x"), /there is no agent "ghost"/);
	assert.match(await fails("agent", "update", "books"), /nothing to change/);
	// A model change is the one thing the files cannot check: it waits for a running daemon.
	assert.match(await fails("agent", "update", "books", "--model", "mock/other"), /changing the model needs a running daemon/);

	// Removing asks first, and says what goes.
	fs.mkdirSync(file("sandbox", "old", "tmp"), { recursive: true });
	fs.mkdirSync(file("data", "sources", "papers@old"), { recursive: true });
	const { Kv, openDb } = await import("../src/store.ts");
	let db = openDb(file("data"));
	new Kv(db).set("taint:old:main", "something from outside");
	db.close();
	const refused = await fails("agent", "remove", "old");
	assert.match(refused, /old: Kept the old books\nWith it go: conversations: none; event sources: none; MCP servers: none; schedules: none; skills: none; routes that wake it: wake-old\nIts folder .*agents\/old is deleted, with 1 file in the agent's workspace and everything said to the agent\. This cannot be undone\./);
	assert.match(refused, /not removed: this asks before it deletes\. Run it in a terminal, or add --yes/);
	assert.ok(fs.existsSync(file("agents", "old")));
	assert.match(await fails("agent", "remove", "main", "--yes"), /main is the main agent: it administers pine and cannot be removed/);
	assert.match(await fails("agent", "remove", "ghost", "--yes"), /there is no agent "ghost"/);
	assert.match(await pine("agent", "remove", "old", "--yes"), /Removed the agent old\.$/);
	for (const gone of [file("agents", "old"), file("sandbox", "old"), file("data", "sources", "papers@old"), file("removed")]) assert.ok(!fs.existsSync(gone), gone);
	assert.deepEqual(json(file("pine.json")).routes, [{ name: "keep", on: "test/keep", set: { seen: "yes" } }], "the route that woke it is gone with it");
	assert.deepEqual(json(file("agents", "aide", "agent.json")).delegates, []);
	db = openDb(file("data"));
	assert.equal(new Kv(db).get("taint:old:main"), undefined);
	db.close();
	assert.ok(!/^old:/m.test(await pine("agent", "list")));
	assert.match(await pine("check"), /ok|agents/i, "what is left is a configuration pine starts with");

	// ---- a daemon runs: it does it, at once
	const daemon = spawn(process.execPath, [CLI, "start", "--home", h.home], { stdio: ["ignore", "ignore", "pipe"] });
	let stderr = "";
	daemon.stderr.on("data", (d) => (stderr += d));
	t.after(() => daemon.kill("SIGKILL"));
	await until(async () => (await fetch(`http://127.0.0.1:${port}/health`).catch(() => undefined))?.ok, 8000, `the daemon to listen (${stderr})`);
	assert.match(await pine("agent", "add", "scout", "--description", "Looks things up", "--instructions", "You are SCOUT."), /^Created the agent scout .* Talk to it with: pine send scout "\.\.\."$/);
	assert.equal(await pine("send", "scout", "are you there"), "ECHO[are you there]", "it exists without a restart");
	assert.deepEqual(JSON.parse(await pine("agents")).map((a: any) => a.id).sort(), ["aide", "books", "main", "scout"]);
	// The daemon changes a running agent at once; the change applies from the next message on.
	assert.match(await pine("agent", "update", "scout", "--thinking", "high", "--mode", "manual"), /^Updated the agent scout; the change applies from the next message on:\n  reasoning: off -> high\n  mode: safe -> manual$/);
	assert.match(await pine("agent", "list"), /scout: Looks things up\n    model .* · reasoning high · mode manual/);
	const out = await pine("agent", "remove", "scout", "--yes", "--keep-files");
	assert.match(out, /Its folder is kept: moved to .*removed/);
	assert.match(out, /Removed the agent scout\. The agent's folder is kept at .*removed\/scout-/);
	assert.equal(fs.readdirSync(file("removed")).length, 1);
	const walk = (d: string): string[] => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
	assert.deepEqual([...walk(file("agents", "scout")), ...walk(file("sandbox", "scout"))].map((f) => path.relative(h.home, f)), [], "neither its folder nor its private home is there again");
	assert.deepEqual([file("agents", "scout"), file("sandbox", "scout")].filter((d) => fs.existsSync(d)).map((d) => `${path.relative(h.home, d)}: ${fs.readdirSync(d).join(",")}`), []);
	assert.match(await fails("send", "scout", "x"), /unknown agent "scout"/);
	// Removing an agent is not what a mistyped or half-filled request does: the address is its own, and the name is said twice.
	const token = fs.readFileSync(file("data", "http-token"), "utf8").trim();
	const post = (url: string, body: unknown) => fetch(`http://127.0.0.1:${port}${url}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
	assert.equal((await post("/agents/books/erase", {})).status, 400);
	assert.equal((await post("/agents/books/erase", { agent: "aide" })).status, 400);
	assert.equal((await post("/agents/books/remove", { session: "side" })).status, 200, "removing a conversation is another request");
	assert.ok(fs.existsSync(file("agents", "books")) && JSON.parse(await pine("agents")).some((a: any) => a.id === "books"), "and leaves the agent");
	assert.match(await pine("agent", "remove", "books", "--yes"), /Removed the agent books\.$/);
	assert.deepEqual(JSON.parse(await pine("agents")).map((a: any) => a.id).sort(), ["aide", "main"]);
	daemon.kill("SIGTERM");
	await new Promise((r) => daemon.once("exit", r));
	await h.close();
});

test("pine login stores a provider key privately and makes its models available", async (t) => {
	const { login } = await import("../src/login.ts");
	const { loadConfig } = await import("../src/config.ts");
	const h = await harness({ agents: { main: {} }, start: false });
	const said: string[] = [];
	const asked: string[] = [];
	const models = await login(loadConfig(h.home), "opencode-go", "api_key", {
		text: async (m) => (asked.push(m), ""),
		secret: async (m) => (asked.push(m), "sk-test-not-a-real-key-123456"),
		say: (l) => void said.push(l),
		open: () => {},
	});
	const file = path.join(h.home, "auth.json");
	assertPrivate(file, 0o600);
	assert.ok(JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8"))["opencode-go"]).includes("sk-test-not-a-real-key-123456"));
	assert.ok(models.includes("opencode-go/deepseek-v4.1-flash"), models.slice(0, 5).join(","));
	assert.ok(said.join("\n").includes("Stored the key for opencode-go") && !said.join("\n").includes("sk-test"), "the key is never echoed");
	await assert.rejects(() => login(loadConfig(h.home), "no-such-provider"), /unknown provider/);
	await h.close();
});

test("the key prompt stays visible, says the input is hidden, and never echoes it", async () => {
	const { readSecret } = await import("../src/login.ts");
	const { PassThrough } = await import("node:stream");
	const input = new PassThrough();
	const output = new PassThrough();
	let shown = "";
	output.on("data", (d) => (shown += d));
	const pending = readSecret("Enter OpenCode API key", input, output);
	input.write("sk-abX");
	input.write("\x7f"); // backspace
	input.write("c-123\r");
	assert.equal(await pending, "sk-abc-123");
	assert.equal(shown, "Enter OpenCode API key (input is hidden; paste or type it, then press enter): \n");
	const cancelled = readSecret("Key", input, output);
	input.write("abc\x03");
	await assert.rejects(cancelled, /cancelled/);
});

test("pine update knows how pine was installed and which version is newer; pine version says both", async () => {
	const { appNews, channelOf, installKind, newer, newestOf, noteChannel, notedChannel, outcome, upToDate, whatChanged, whatCame } = await import("../src/update.ts");
	const root = path.resolve(import.meta.dirname, "..");
	// A git clone that runs its sources is a checkout, wherever npm keeps its global packages.
	assert.equal(installKind(root, "/usr/local/lib/node_modules"), "checkout");
	// Inside npm's global folder it is a global install; anywhere else a dependency of some project.
	const global = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-global-")));
	const pkg = path.join(global, "@pmndre", "pine");
	fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
	fs.writeFileSync(path.join(pkg, "src", "cli.js"), "");
	assert.equal(installKind(pkg, global), "global");
	assert.equal(installKind(pkg, path.join(global, "elsewhere")), "local");
	assert.equal(installKind(pkg, undefined), "local");
	// Inside the Pine app it is the app's: no npm is asked, and a new app is what updates it.
	const carried = path.join(global, "Pine.app", "Contents", "Resources", "pine");
	fs.mkdirSync(carried, { recursive: true });
	assert.equal(installKind(carried, global), "app");
	assert.equal(installKind(carried), "app");
	// On Linux and Windows the app's resources folder holds it beside the app's own archive.
	const resources = path.join(global, "Pine", "resources");
	fs.mkdirSync(path.join(resources, "pine"), { recursive: true });
	assert.equal(installKind(path.join(resources, "pine")), "local", "a folder called resources alone is not the app");
	fs.writeFileSync(path.join(resources, "app.asar"), "");
	assert.equal(installKind(path.join(resources, "pine"), global), "app");
	assert.match(appNews("0.14.0", "0.13.0"), /pine 0\.14\.0 is available \(this is 0\.13\.0\)\. This pine came with the Pine app.*downloads the new release itself and installs it when you press "Restart to update" or quit it.*\n\n  https:\/\/github\.com\/pmndre\/pine\/releases\/latest$/s);
	fs.rmSync(global, { recursive: true, force: true });

	assert.deepEqual([newer("0.1.1", "0.1.0"), newer("0.10.0", "0.9.9"), newer("1.0.0", "0.99.99"), newer("0.1.0", "0.1.0"), newer("0.1.0", "0.2.0")], [true, true, true, false, false]);
	// The channel sticks. A pine that is a preview follows previews; once that is noted for its home, it
	// still does after it was moved to a release that passed them, until the owner says otherwise.
	const channelHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-channel-")));
	assert.equal(noteChannel(channelHome, "next"), false, "a folder that is no pine home keeps nothing");
	assert.equal(notedChannel(channelHome), undefined);
	fs.writeFileSync(path.join(channelHome, "pine.json"), "{}");
	assert.deepEqual([channelOf("0.2.0", notedChannel(channelHome)), channelOf("0.2.0-next.3", notedChannel(channelHome))], ["release", "next"]);
	assert.equal(noteChannel(channelHome, "next"), true);
	assert.equal(fs.readFileSync(path.join(channelHome, "data", "update-channel"), "utf8"), "next\n");
	assert.equal(channelOf("0.2.0", notedChannel(channelHome)), "next", "a release on disk does not end the previews");
	assert.equal(noteChannel(channelHome, "release"), true);
	assert.equal(channelOf("0.3.0-next.1", notedChannel(channelHome)), "release", "the owner's choice wins over the version on disk");
	fs.writeFileSync(path.join(channelHome, "data", "update-channel"), "whatever an agent might wish\n");
	assert.equal(notedChannel(channelHome), undefined, "anything else in the file is no choice");
	assert.equal(notedChannel(undefined), undefined);
	fs.rmSync(channelHome, { recursive: true, force: true });
	// What a channel calls for: on previews the newest preview, or the release that has passed it.
	assert.equal(newestOf("release", "0.2.0", "0.3.0-next.2"), "0.2.0");
	assert.equal(newestOf("next", "0.2.0", "0.3.0-next.2"), "0.3.0-next.2");
	assert.equal(newestOf("next", "0.3.0", "0.3.0-next.2"), "0.3.0", "the release has passed its previews");
	assert.equal(newestOf("next", "0.3.0", undefined), "0.3.0", "no preview was ever published");
	assert.equal(newestOf("next", undefined, "0.3.0-next.2"), "0.3.0-next.2");
	assert.equal(upToDate("@pmndre/pine", "0.3.0-next.2", "next", "0.3.0-next.2"), "pine 0.3.0-next.2 is the newest preview.");
	assert.match(upToDate("@pmndre/pine", "0.3.0", "next", "0.3.0"), /is the latest version\. It follows previews, and none is ahead of it\./);
	assert.equal(upToDate("@pmndre/pine", "0.3.0", "release", "0.3.0"), "pine 0.3.0 is the latest version.");
	// Back on releases with a preview on disk: nothing is taken back by itself, and it says how to.
	assert.match(upToDate("@pmndre/pine", "0.3.0-next.2", "release", "0.2.0"), /is a preview, ahead of the last release \(0\.2\.0\).*npm install -g @pmndre\/pine@0\.2\.0$/s);
	// The next channel: its versions come before the release they lead up to, in the order of their numbers.
	assert.deepEqual([newer("0.2.0", "0.2.0-next.3"), newer("0.2.0-next.3", "0.2.0"), newer("0.2.0-next.10", "0.2.0-next.9"), newer("0.2.0-next.1", "0.1.9"), newer("0.2.0-next.1", "0.2.0-next.1"), newer("0.1.9", "0.2.0-next.1")], [true, false, true, true, false, false]);

	// What is on disk afterwards decides whether it worked. npm can name a new version and install the old one.
	assert.deepEqual(outcome("@pmndre/pine", "0.13.0", "0.13.0").ok, true);
	assert.match(outcome("@pmndre/pine", "0.13.0", "0.13.0").text, /pine is now 0\.13\.0\. A pine that is running keeps the old version until it is restarted/);
	const missed = outcome("@pmndre/pine", "0.13.0", "0.12.1");
	assert.equal(missed.ok, false);
	assert.match(missed.text, /Not updated: pine is still 0\.12\.1\. npm knows 0\.13\.0 but did not install it.*\n\n  npm install -g @pmndre\/pine@0\.13\.0$/s);
	assert.equal(outcome("@pmndre/pine", undefined, "0.13.0").ok, true, "a checkout has no version to compare with");

	// Afterwards it says what the versions in between changed, as the new package lists it: newest first,
	// only what is newer than the version that was there, and what to do about it last.
	const list = [
		{ version: "0.14.0", changes: ["feat: not installed yet"] },
		{ version: "0.13.0", changes: ["feat(tui): a conversation list", "fix: the tab bar keeps its place"] },
		{ version: "0.12.2", changes: ["Update README", "docs: \u001b[31mred\u0007 words"] },
		{ version: "0.12.1", changes: ["fix: what was there before"] },
	];
	const news = whatChanged(list, "0.12.1", "0.13.0");
	assert.equal(news, "What changed since 0.12.1:\n\n  0.13.0\n    - new: a conversation list\n    - fixed: the tab bar keeps its place\n  0.12.2\n    - Update README\n    - docs: [31mred  words");
	// The list stands by itself, between the new version and what to do about it.
	assert.equal(outcome("@pmndre/pine", "0.13.0", "0.13.0", news).text, `\npine is now 0.13.0.\n\n${news}\n\nA pine that is running keeps the old version until it is restarted: quit the terminal UI and open it again, or restart the daemon.`);
	// A package from before the list, or one that says nothing about these versions, adds nothing.
	assert.deepEqual([whatChanged(undefined, "0.12.1", "0.13.0"), whatChanged({ no: "list" }, "0.12.1", "0.13.0"), whatChanged(list, "0.13.0", "0.13.0")], ["", "", ""]);
	// A long list is cut, and says by how much.
	const many = whatChanged([{ version: "0.13.0", changes: Array.from({ length: 30 }, (_, i) => `fix: number ${i}`) }], "0.12.0", "0.13.0");
	assert.ok(many.split("\n").length === 29 && many.endsWith("\n    - fixed: number 24\n  ... and 5 more"), many);
	const two = whatChanged([{ version: "0.13.0", changes: Array.from({ length: 20 }, (_, i) => `fix: a ${i}`) }, { version: "0.12.5", changes: Array.from({ length: 20 }, (_, i) => `fix: b ${i}`) }, { version: "0.12.4", changes: ["fix: c"] }], "0.12.0", "0.13.0");
	assert.ok(two.includes("\n  0.12.5\n    - fixed: b 0\n") && two.endsWith("\n    - fixed: b 4\n  ... and 16 more") && !two.includes("0.12.4"), two);
	// A checkout has commits and no versions.
	assert.equal(whatCame(["feat: sources of your own", "", "fix: a link is shown with its target"]), "What changed:\n\n  - new: sources of your own\n  - fixed: a link is shown with its target");
	assert.equal(whatCame([""]), "");

	const version = await run(process.execPath, [CLI, "version"]);
	assert.match(version.stdout, /^pine \d+\.\d+\.\d+ \(checkout in /);
});

test("pine <folder>: a first word that is a folder opens the UI there; a path that is no folder says so", async (t) => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-folder-arg-")));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	fs.mkdirSync(path.join(dir, "project"));
	fs.mkdirSync(path.join(dir, "status"));
	const pine = (...args: string[]) => run(process.execPath, [CLI, ...args, "--home", path.join(dir, "no-home")], { cwd: dir }).then((r) => r.stdout + r.stderr, (e) => String(e.stdout) + String(e.stderr));
	// Without a terminal the UI cannot open, which is how a test sees that it was the UI that was asked for.
	for (const word of [".", "project", "./project", dir]) assert.match(await pine(word), /No pine home at/, word);
	assert.match(await pine("./nothing-here"), /\.\/nothing-here is not a folder/);
	assert.match(await pine("nothing-here"), /No pine home|unknown command|ENOENT|pine\.json/);
	assert.doesNotMatch(await pine("status"), /No pine home at .* yet\. Create one/, "a command keeps its meaning when a folder has its name");
});

test("pine --ssh: the terminal UI on another machine's pine; a host that is an ssh option, a command, or --home is refused first", async (t) => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-ssh-arg-")));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const pine = (...args: string[]) => run(process.execPath, [CLI, ...args], { cwd: dir, env: { ...process.env, PINE_HOME: path.join(dir, "no-home") } }).then((r) => r.stdout + r.stderr, (e) => String(e.stdout) + String(e.stderr));
	assert.match(await pine("--ssh"), /--ssh takes the machine/);
	assert.match(await pine("--ssh", "-oProxyCommand=touch pwned"), /is not a host for ssh/);
	assert.equal(fs.existsSync(path.join(dir, "pwned")), false);
	assert.match(await pine("--ssh", "me@far", "status"), /A command is run there: ssh me@far pine status/);
	assert.match(await pine("--ssh", "me@far", "--home", dir), /--home names a pine home on this computer/);
	assert.match(await pine("--ssh", "me@far", "--worktree"), /--worktree goes with a folder/);
	// A folder after it is the other machine's: not looked for here, and no pine home here is needed.
	// (Without a terminal the UI cannot open, which is how a test sees that it was the UI that was asked for.)
	for (const args of [["--ssh", "me@far"], ["--ssh", "me@far", "~/projects/not-on-this-computer"], ["tui", "--ssh", "me@far"]]) {
		const said = await pine(...args);
		assert.match(said, /needs an interactive terminal/, args.join(" "));
		assert.doesNotMatch(said, /No pine home|is not a folder/, args.join(" "));
	}
});

test("pine service finds this home's daemon or starts one, says where it answers on one line of JSON, and a daemon it started ends with whoever started it", async (t) => {
	const port = await freePort();
	const h = await harness({ pine: { http: { port }, logLevel: "warn" }, agents: { main: {} }, start: false });
	const children: Array<ReturnType<typeof spawn>> = [];
	t.after(() => children.forEach((c) => c.kill("SIGKILL")));
	// Starts the command and resolves with its first line, which is all it ever writes to stdout.
	const service = (home: string, ...flags: string[]) => {
		const child = spawn(process.execPath, [CLI, "service", "--home", home, ...flags], { stdio: ["pipe", "pipe", "pipe"] });
		children.push(child);
		let out = "";
		child.stdout!.on("data", (d) => (out += d));
		const exit = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
		const said = until(() => out.includes("\n"), 10_000, "pine service to answer").then(() => JSON.parse(out.split("\n")[0]));
		return { child, exit, said, all: () => out };
	};
	const up = async () => (await fetch(`http://127.0.0.1:${port}/health`).catch(() => undefined))?.ok === true;

	// No home: said as JSON too, with what to do.
	const none = service(path.join(h.home, "not-there"));
	assert.match((await none.said).error, /there is no pine home at .* yet\. Create one with: pine init/);
	assert.equal(await none.exit, 1);

	// Nothing runs: it starts the daemon and stays.
	const first = service(h.home);
	const told = await first.said;
	assert.deepEqual({ base: told.base, mode: told.mode, started: told.started, home: told.home }, { base: `http://127.0.0.1:${port}`, mode: "embedded daemon", started: true, home: h.home });
	assert.match(told.version, /^\d+\.\d+\.\d+/);
	assert.equal(told.token, fs.readFileSync(path.join(h.home, "data", "http-token"), "utf8").trim());
	assert.equal((await fetch(`${told.base}/status`, { headers: { authorization: `Bearer ${told.token}` } })).status, 200);
	assert.ok(fs.existsSync(path.join(h.home, "data", "pine.log")), "it logs to a file, not to its output");

	// One runs: a second call attaches, says the same, and is gone at once; the daemon goes on.
	const second = service(h.home);
	const again = await second.said;
	assert.deepEqual({ base: again.base, token: again.token, mode: again.mode, started: again.started }, { base: told.base, token: told.token, mode: "attached", started: false });
	assert.equal(await second.exit, 0);
	assert.ok(await up());

	// Another home on the same port is not this home's daemon, and is not driven.
	const other = await harness({ pine: { http: { port }, logLevel: "warn" }, agents: { main: {} }, start: false });
	const wrong = service(other.home);
	assert.match((await wrong.said).error, /it is not the pine of .*Another pine home uses the same port/);
	assert.equal(await wrong.exit, 1);
	await other.close();

	// Whoever started it is gone (its end of the pipe closes): the daemon stops cleanly.
	first.child.stdin!.end();
	assert.equal(await first.exit, 0);
	assert.ok(!(await up()));
	assert.equal(first.all().trim().split("\n").length, 1, "one line on stdout, and nothing else");

	// With --keep it outlives its input and ends when it is told to.
	const kept = service(h.home, "--keep");
	assert.equal((await kept.said).started, true);
	kept.child.stdin!.end();
	await new Promise((r) => setTimeout(r, 300));
	assert.ok(await up());
	kept.child.kill("SIGTERM");
	if (process.platform !== "win32") assert.equal(await kept.exit, 0);
	else await kept.exit;
	assert.ok(!(await up()));
	await h.close();
});
