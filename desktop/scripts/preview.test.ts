// The app's page in an ordinary browser (`npm run dev:preview`): the preview's server on a
// throwaway pine and on a home of one's choice (`--home`), talked to over HTTP as a browser
// would. No window.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { build } from "vite";
import { startMock } from "../../baseline/tests/mock.mjs";
import { freePort, ours, stopKept } from "../e2e/support/daemon.ts";

const root = path.resolve(import.meta.dirname, "..");

/** A preview that runs: its process, where the page is served and its origin, the daemon behind it and the home it runs on. */
interface Preview {
	child: ChildProcess;
	page: string;
	origin: string;
	daemon: string;
	home: string;
}

const previews: Preview[] = [];

/** `npm run dev:preview` with these arguments, on a port the system picks, once it has said where it answers. */
function startPreview(args: string[] = []): Promise<Preview> {
	const child = spawn(process.execPath, [path.join(root, "scripts", "preview.ts"), ...args], { cwd: root, env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
	let said = "";
	child.stderr!.on("data", (d: Buffer) => (said += d.toString("utf8")));
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`the preview did not come up. It said:\n${said}`)), 60_000);
		child.stdout!.on("data", (d: Buffer) => {
			said += d.toString("utf8");
			const p = /preview\s+(http:\/\/\S+)/.exec(said)?.[1];
			const pine = /pine\s+(http:\/\/\S+) on (?:a throwaway home in )?(\S+)/.exec(said);
			if (p && pine) {
				clearTimeout(timer);
				const preview = { child, page: p, origin: new URL(p).origin, daemon: pine[1], home: pine[2] };
				previews.push(preview);
				resolve(preview);
			}
		});
		child.on("close", (code) => (clearTimeout(timer), reject(new Error(`the preview ended (exit ${code}). It said:\n${said}`))));
	});
}

/** Stop a preview as Ctrl-C does, and wait for it to end. */
async function stopPreview(preview: Preview): Promise<void> {
	if (preview.child.exitCode !== null) return;
	const ended = new Promise((r) => preview.child.once("close", r));
	preview.child.kill("SIGTERM");
	await ended;
}

/** The preview on a throwaway pine that most tests here talk to. */
let child: ChildProcess;
let page: string;
let origin: string;
let daemon: string;
let home: string;

before(async () => {
	({ child, page, origin, daemon, home } = await startPreview());
});

after(() => {
	for (const p of previews) if (p.child.exitCode === null) p.child.kill("SIGKILL");
});

const call = (body: unknown, headers: Record<string, string> = { origin, "content-type": "application/json" }) => fetch(new URL("/__pine/call", page), { method: "POST", headers, body: JSON.stringify(body) });

test("a call from the page's own origin, as JSON, reaches the daemon and comes back with its answer", async () => {
	const res = await call({ method: "GET", url: "/agents" });
	assert.equal(res.status, 200);
	const answer = await res.json();
	assert.equal(answer.ok, true);
	assert.deepEqual(answer.data.map((a: { id: string }) => a.id).sort(), ["main", "scout"]);
});

test("a call from another origin, or that is not JSON, is refused and not forwarded", async () => {
	assert.equal((await call({ method: "GET", url: "/agents" }, { origin: "http://evil.example", "content-type": "application/json" })).status, 403);
	assert.equal((await call({ method: "GET", url: "/agents" }, { origin, "content-type": "text/plain" })).status, 403);
	assert.equal((await call({ method: "GET", url: "/agents" }, { "content-type": "application/json" })).status, 403);
	assert.equal((await fetch(new URL("/__pine/call", page), { headers: { origin } })).status, 403);
});

test("the event stream and media are refused to another origin", async () => {
	assert.equal((await fetch(new URL("/__pine/events", page), { headers: { origin: "http://evil.example" } })).status, 403);
	assert.equal((await fetch(new URL("/__pine/media/media/tool/x", page), { headers: { origin: "http://evil.example" } })).status, 403);
	const stream = await fetch(new URL("/__pine/events", page), { headers: { origin } });
	assert.equal(stream.status, 200);
	assert.match(stream.headers.get("content-type") ?? "", /^text\/event-stream/);
	await stream.body?.cancel();
});

/** A request under a name of the requester's choice: fetch cannot set `Host`, a rebound name can. */
function asHost(route: string, host: string, options: { method: string; body?: string }): Promise<number> {
	const { hostname, port } = new URL(page);
	const headers: Record<string, string> = { host, origin: `http://${host}` };
	if (options.body !== undefined) headers["content-type"] = "application/json";
	return new Promise((resolve, reject) => {
		const req = http.request({ hostname, port, path: route, method: options.method, headers }, (res) => {
			res.resume();
			resolve(res.statusCode ?? 0);
		});
		req.on("error", reject);
		req.end(options.body);
	});
}

test("a name that is not the loopback (a rebound one) is refused, even with an origin to match", async () => {
	const host = `evil.example:${new URL(page).port}`;
	assert.equal(await asHost("/__pine/call", host, { method: "POST", body: JSON.stringify({ method: "GET", url: "/agents" }) }), 403);
	assert.equal(await asHost("/__pine/events", host, { method: "GET" }), 403);
});

test("a call whose body is not an object is refused, and the preview goes on", async () => {
	for (const body of [null, 1, "x", []]) assert.equal((await call(body)).status, 400);
	assert.equal((await call({ method: "GET", url: "/agents" })).status, 200);
});

test("the page is served with the app's content security policy", async () => {
	const res = await fetch(page);
	assert.equal(res.status, 200);
	const csp = res.headers.get("content-security-policy") ?? "";
	assert.match(csp, /default-src 'none'/);
	assert.match(csp, /img-src 'self' data: blob:;/);
	assert.doesNotMatch(csp, /pine-media:/);
	assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
	await res.body?.cancel();
});

test("a media path the app does not serve is refused", async () => {
	const res = await fetch(new URL("/__pine/media/agents", page));
	assert.equal(res.status, 404);
	await res.body?.cancel();
});

test("nothing of the browser stand-in is in the built page", async () => {
	const out = fs.mkdtempSync(path.join(os.tmpdir(), "pine-preview-build-"));
	try {
		await build({ root, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
		const files = fs.readdirSync(out, { recursive: true, encoding: "utf8" }).filter((f) => /\.(js|html)$/.test(f));
		assert.ok(files.length > 0);
		for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(out, f), "utf8"), /__pine/, f);
	} finally {
		fs.rmSync(out, { recursive: true, force: true });
	}
});

test("stopping the preview removes the throwaway home and ends the daemon", async () => {
	assert.ok(fs.existsSync(path.join(home, "pine.json")));
	const ended = new Promise((r) => child.once("close", r));
	child.kill("SIGTERM");
	await ended;
	assert.equal(fs.existsSync(home), false);
	await assert.rejects(fetch(`${daemon}/health`, { signal: AbortSignal.timeout(2000) }));
});

test("a preview whose starter is gone stops by itself, with its throwaway pine", async (t) => {
	// The starter is a shell (as npm would be) that leaves the preview behind when it is killed.
	const starter = spawn("/bin/sh", ["-c", `"${process.execPath}" "${path.join(root, "scripts", "preview.ts")}" & wait`], { cwd: root, env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "ignore"] });
	t.after(() => void (starter.exitCode === null && starter.kill("SIGKILL")));
	let said = "";
	const where = await new Promise<RegExpExecArray>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`the preview did not come up. It said:\n${said}`)), 60_000);
		starter.stdout!.on("data", (d: Buffer) => {
			said += d.toString("utf8");
			const pine = /pine\s+(http:\/\/\S+) on a throwaway home in (\S+)/.exec(said);
			if (pine) (clearTimeout(timer), resolve(pine));
		});
	});
	const [, base, throwaway] = where;
	assert.ok(fs.existsSync(throwaway));
	starter.kill("SIGKILL");
	// It looks every second; stopping its daemon takes a moment more.
	let gone = false;
	for (let i = 0; i < 100 && !gone; i++) {
		await new Promise((r) => setTimeout(r, 200));
		gone = !fs.existsSync(throwaway);
	}
	assert.ok(gone, "the preview went on after its starter was gone");
	await assert.rejects(fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) }));
});

// ---- --home: a pine home of the developer's choice -----------------------------------------------

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

/** A home of the test's own, as a developer's would be: one agent, on the scripted model server, on this port. */
function ownHome(modelServer: string, port: number): string {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-preview-own-")));
	write(path.join(dir, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: modelServer, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(dir, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port }, main: "keeper", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false } }));
	write(path.join(dir, "agents", "keeper", "agent.json"), JSON.stringify({}));
	write(path.join(dir, "agents", "keeper", "workspace", "AGENTS.md"), "The only agent of this home.\n\nYou are keeper.\n");
	return dir;
}

const stateOf = async (p: Preview) => (await (await fetch(new URL("/__pine/state", p.page), { headers: { origin: p.origin } })).json()).state;

const agentsOf = async (p: Preview) => {
	const res = await fetch(new URL("/__pine/call", p.page), { method: "POST", headers: { origin: p.origin, "content-type": "application/json" }, body: JSON.stringify({ method: "GET", url: "/agents" }) });
	return (await res.json()).data.map((a: { id: string }) => a.id);
};

/** The daemon of that home answers at that address (another run's daemon there does not count). */
const answers = (base: string, own: string) => ours(new URL(base).port, own);

test("--home starts a daemon on that home when none runs, and leaves it and the home after the preview", async (t) => {
	const mock = await startMock();
	t.after(() => mock.close?.());
	const own = ownHome(mock.baseUrl, 0);
	let preview: Preview | undefined;
	// One hook, in this order: the kept daemon is told apart by the home's token, so it is stopped before the home goes.
	t.after(async () => {
		try {
			if (preview) await stopKept(new URL(preview.daemon).port, own);
		} finally {
			fs.rmSync(own, { recursive: true, force: true });
		}
	});
	preview = await startPreview(["--home", own]);
	assert.equal(preview.home, own);
	assert.deepEqual(await agentsOf(preview), ["keeper"]);
	assert.equal((await stateOf(preview)).started, true);
	// A home of the developer's (~/.pine) has its daemon go on: the preview never stops it.
	await stopPreview(preview);
	assert.ok(fs.existsSync(path.join(own, "pine.json")));
	assert.ok(fs.existsSync(path.join(own, "agents", "keeper", "agent.json")));
	assert.equal(await answers(preview.daemon, own), true);
});

test("--home uses the daemon that runs on that home, and leaves it running", async (t) => {
	const mock = await startMock();
	t.after(() => mock.close?.());
	const own = ownHome(mock.baseUrl, await freePort());
	// The developer's own pine of that home, running before the preview and after it.
	const running = spawn(process.execPath, [path.join(root, "..", "bin", "pine.js"), "service", "--home", own], { stdio: ["pipe", "pipe", "ignore"] });
	// One hook, in this order: the daemon ends before its home goes.
	t.after(async () => {
		if (running.exitCode === null && running.signalCode === null) {
			const ended = new Promise((r) => running.once("close", r));
			running.kill("SIGKILL");
			await ended;
		}
		fs.rmSync(own, { recursive: true, force: true });
	});
	const base = await new Promise<string>((resolve, reject) => {
		let out = "";
		running.stdout!.on("data", (d: Buffer) => {
			out += d.toString("utf8");
			if (out.includes("\n")) resolve(JSON.parse(out.slice(0, out.indexOf("\n"))).base);
		});
		running.once("close", (code) => reject(new Error(`pine service ended (exit ${code}): ${out}`)));
	});
	const preview = await startPreview(["--home", own]);
	assert.equal(preview.daemon, base);
	assert.equal((await stateOf(preview)).started, false);
	assert.deepEqual(await agentsOf(preview), ["keeper"]);
	await stopPreview(preview);
	assert.equal(await answers(base, own), true);
	assert.ok(fs.existsSync(path.join(own, "pine.json")));
	const ended = new Promise((r) => running.once("close", r));
	running.stdin!.end();
	await ended;
});
