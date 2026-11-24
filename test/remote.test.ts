// A pine on another machine (src/remote.ts): what names it, the command that runs there, and the
// one ssh connection that reaches it (on a stand-in for ssh). The Pine app uses it for a machine
// added in Settings > Environments.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connectRemote, loopbackEnd, RemoteError, remoteCommand, sshArgs, sshHost } from "../src/remote.ts";

const temp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-remote-")));

test("remote: an ssh host is a host, user@host or an alias, and never an option", () => {
	assert.equal(sshHost(""), undefined);
	assert.equal(sshHost("  "), undefined);
	assert.deepEqual(sshHost(" user@server "), { host: "user@server", label: "server" });
	assert.deepEqual(sshHost("server.example.com"), { host: "server.example.com", label: "server" });
	for (const bad of ["-oProxyCommand=x", "server; rm -rf ~", "a b", "$(x)", "-J", "@server"]) assert.throws(() => sshHost(bad), RemoteError, bad);
});

test("remote: the command finds pine in the login shell's PATH, whatever that shell is", { skip: process.platform === "win32" && "the remote command is run here with the POSIX shells an owner may log in with" }, () => {
	const run = sshArgs("user@server", [], remoteCommand());
	assert.equal(run.at(-2), "user@server");
	assert.ok(run.includes("BatchMode=yes"));
	// A home with a profile for each shell that puts pine's folder on the PATH, as an installation does.
	const home = temp();
	const bin = path.join(home, "pine-bin");
	fs.mkdirSync(bin);
	fs.writeFileSync(path.join(bin, "pine"), `#!/bin/sh\necho "pine $1 from the login PATH"\n`, { mode: 0o755 });
	const base = "/usr/bin:/bin";
	for (const f of [".profile", ".bash_profile", ".zprofile", ".zshenv"]) fs.writeFileSync(path.join(home, f), `PATH="${bin}:$PATH"; export PATH\n`);
	for (const f of [".cshrc", ".tcshrc", ".login"]) fs.writeFileSync(path.join(home, f), `setenv PATH "${bin}:$PATH"\n`);
	fs.mkdirSync(path.join(home, ".config", "fish"), { recursive: true });
	fs.writeFileSync(path.join(home, ".config", "fish", "config.fish"), `set -gx PATH ${bin} $PATH\n`);
	const fish = ["/opt/homebrew/bin/fish", "/usr/local/bin/fish", "/usr/bin/fish"].find((f) => fs.existsSync(f));
	const shells = ["/bin/sh", "/bin/bash", "/bin/zsh", "/bin/dash", "/bin/ksh", "/bin/csh", "/bin/tcsh", ...(fish ? [fish] : [])].filter((f) => fs.existsSync(f));
	assert.ok(shells.length >= 2);
	for (const shell of shells) {
		// As sshd runs it: the user's shell with -c and the command line, stdin closed.
		const out = execFileSync(shell, ["-c", run.at(-1)!], { env: { HOME: home, SHELL: shell, PATH: base, USER: os.userInfo().username }, input: "", encoding: "utf8", timeout: 15_000 });
		assert.match(out, /pine service from the login PATH/, shell);
	}
	// Without pine anywhere it says so, with the exit code ssh hands on. (A login shell of its own: the system's
	// profile may put a pine that is installed on this computer on the PATH.)
	fs.rmSync(bin, { recursive: true });
	const bare = path.join(home, "bare-shell");
	fs.writeFileSync(bare, `#!/bin/sh\necho ${base}\n`, { mode: 0o755 });
	const failed = (() => {
		try {
			execFileSync("/bin/sh", ["-c", run.at(-1)!], { env: { HOME: home, SHELL: bare, PATH: base }, input: "", encoding: "utf8", stdio: "pipe" });
		} catch (e: any) {
			return e;
		}
	})();
	assert.equal(failed?.status, 127);
	assert.match(String(failed.stderr), /pine is not installed there/);
	fs.rmSync(home, { recursive: true, force: true });
});

test("remote: the forward ends at the other machine's loopback, and nowhere else", () => {
	assert.equal(loopbackEnd("http://127.0.0.1:7463"), "127.0.0.1:7463");
	assert.equal(loopbackEnd("http://127.0.0.2:8080"), "127.0.0.2:8080");
	assert.equal(loopbackEnd("http://[::1]:7463"), "[::1]:7463");
	for (const bad of ["http://10.0.0.5:7463", "http://localhost:7463", "http://evil.example:7463", "http://0.0.0.0:7463", "http://127.0.0.1", "https://127.0.0.1:7463", "http://127.0.0.1:7463@evil:1", "http://user:pw@127.0.0.1:7463", "nonsense"]) assert.throws(() => loopbackEnd(bad), RemoteError, bad);
});

/**
 * A stand-in for ssh. As the master it prints the service line it is given (SAY) and keeps a
 * control socket; asked to `-O forward`, it notes the port and says it is taken for the first
 * TAKEN ports. With FAIL it is ssh that could not connect, saying FAIL.
 */
function standIn(dir: string): string {
	const file = path.join(dir, "ssh.mjs");
	fs.writeFileSync(
		file,
		`#!${process.execPath}
import fs from "node:fs";
import net from "node:net";
const args = process.argv.slice(2);
const opt = (name) => args.map((a, i) => args[i - 1] === "-o" && a.startsWith(name + "=") ? a.slice(name.length + 1) : undefined).find(Boolean);
const log = (line) => fs.appendFileSync(process.env.LOG, line + "\\n");
if (args.includes("-N")) {
	// A forward of its own (where ssh has no control socket): it carries the port to where -L says.
	const [, lport, fhost, fport] = /^127\\.0\\.0\\.1:(\\d+):(.*):(\\d+)$/.exec(args[args.indexOf("-L") + 1]);
	log("apart " + lport);
	net.createServer((c) => { const o = net.connect(Number(fport), fhost); c.pipe(o); o.pipe(c); o.on("error", () => c.destroy()); c.on("error", () => o.destroy()); }).listen(Number(lport), "127.0.0.1");
	process.on("SIGTERM", () => (log("forward ended"), process.exit(0)));
} else if (args.includes("-O")) {
	const spec = args[args.indexOf("-L") + 1];
	log("forward " + spec);
	const c = net.connect(opt("ControlPath"));
	let reply = "";
	c.on("data", (d) => (reply += d));
	c.on("end", () => { if (reply === "ok") process.exit(0); console.error("mux_client_forward: forwarding request failed: Port forwarding failed"); process.exit(255); });
	c.end(spec);
} else {
	log("master " + (opt("ControlMaster") ?? ""));
	if (process.env.FAIL) { console.error(process.env.FAIL); process.exit(255); }
	let taken = Number(process.env.TAKEN ?? 0);
	net.createServer((c) => c.once("data", () => c.end(taken-- > 0 ? "taken" : "ok"))).listen(opt("ControlPath"), () => console.log(process.env.SAY));
	process.on("SIGTERM", () => (log("ended"), process.exit(0)));
	process.stdin.resume();
}
`,
		{ mode: 0o755 },
	);
	return file;
}

async function reach(env: Record<string, string>) {
	const dir = temp();
	const log = path.join(dir, "log");
	fs.writeFileSync(log, "");
	const said = { base: "http://127.0.0.1:7463", token: "far-token", started: false, home: "/home/you/.pine", version: "9.9.9" };
	try {
		const s = await connectRemote("you@far", { ssh: standIn(dir), env: { ...process.env, LOG: log, SAY: JSON.stringify(said), ...env } });
		return { s, lines: () => fs.readFileSync(log, "utf8").trim().split("\n") };
	} catch (e) {
		return { e: e as RemoteError, lines: () => fs.readFileSync(log, "utf8").trim().split("\n") };
	}
}

test("remote: one connection, the forward goes through its control socket, and a port somebody took is not used", { skip: process.platform === "win32" && "the stand-in for ssh is a script that Windows does not start by itself" }, async () => {
	// The first two ports were taken between choosing and binding: ssh said so, and a third was asked for.
	const r = await reach({ TAKEN: "2" });
	assert.ok(r.s, String(r.e));
	const forwards = r.lines().filter((l) => l.startsWith("forward "));
	assert.equal(forwards.length, 3);
	assert.equal(r.lines().filter((l) => l.startsWith("master ")).length, 1, "one sign-in");
	assert.equal(r.lines()[0], "master yes");
	// What is handed on is the port ssh bound, to the daemon's loopback port there.
	const [, port, far] = /^forward 127\.0\.0\.1:(\d+):(.*)$/.exec(forwards[2])!;
	assert.equal(r.s!.base, `http://127.0.0.1:${port}`);
	assert.equal(far, "127.0.0.1:7463");
	assert.equal(r.s!.token, "far-token");
	assert.equal(r.s!.label, "far");
	await r.s!.stop();
	assert.equal(r.lines().at(-1), "ended");

	// Every port taken: nothing is handed on, and the connection is closed.
	const none = await reach({ TAKEN: "99" });
	assert.ok(none.e instanceof RemoteError);
	assert.match(none.e!.message, /No port of this computer could be forwarded/);
	assert.equal(none.lines().at(-1), "ended");
});

test("remote: a service line that points away from the other machine's loopback is refused", { skip: process.platform === "win32" && "the stand-in for ssh is a script that Windows does not start by itself" }, async () => {
	const r = await reach({ SAY: JSON.stringify({ base: "http://10.1.2.3:7463", token: "far-token", started: false }) });
	assert.ok(r.e instanceof RemoteError);
	assert.match(r.e!.message, /not a port on that machine's own loopback/);
	assert.ok(!r.lines().some((l) => l.startsWith("forward ")), "no forward was asked for");
	assert.equal(r.lines().at(-1), "ended");
});

test("remote: a machine ssh does not know yet is accepted once from a terminal", { skip: process.platform === "win32" && "the stand-in for ssh is a script that Windows does not start by itself" }, async () => {
	const r = await reach({ FAIL: "No ED25519 host key is known for far and you have requested strict checking.\nHost key verification failed." });
	assert.ok(r.e instanceof RemoteError);
	assert.equal(r.e!.kind, "ssh");
	assert.match(r.e!.message, /Connect to it once from a terminal \(ssh you@far\)/);
});

test("remote: a pine there without the service command says to update it", { skip: process.platform === "win32" && "the stand-in for ssh is a script that Windows does not start by itself" }, async () => {
	const r = await reach({ FAIL: 'error: unknown command "service"' });
	assert.ok(r.e instanceof RemoteError);
	assert.match(r.e!.message, /pine update/);
});

test("remote: where ssh has no control socket (Windows), the forward is a connection of its own that ends with the first", { skip: process.platform === "win32" && "the stand-in for ssh is a script that Windows does not start by itself" }, async () => {
	const http = await import("node:http");
	const server = http.createServer((req, res) => res.writeHead(req.headers.authorization === "Bearer far-token" ? 200 : 401).end("{}"));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const far = `http://127.0.0.1:${(server.address() as any).port}`;
	const dir = temp();
	const log = path.join(dir, "log");
	fs.writeFileSync(log, "");
	try {
		const s = await connectRemote("you@far", { ssh: standIn(dir), apart: true, env: { ...process.env, LOG: log, SAY: JSON.stringify({ base: far, token: "far-token", started: false }) } });
		const lines = () => fs.readFileSync(log, "utf8").trim().split("\n");
		assert.equal(lines()[0], "master ", "no control socket asked for");
		assert.ok(lines().some((l) => l.startsWith("apart ")));
		assert.equal((await fetch(`${s.base}/overview`, { headers: { authorization: "Bearer far-token" } })).status, 200);
		await s.stop();
		await assert.rejects(fetch(`${s.base}/overview`, { signal: AbortSignal.timeout(2000) }), "the forward is gone with it");
	} finally {
		server.close();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
