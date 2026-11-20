// The pine of a WSL distribution on this computer (src/remote.ts, `connectWsl`): what names a
// distribution, how wsl.exe's own words are read, and the connection through a stand-in for
// wsl.exe that runs the command with this system's sh, as WSL runs it with the distribution's.
// The real round trip needs Windows with WSL: desktop/test/wsl-live.test.ts, by hand.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connectWsl, RemoteError, WSL_SCRIPT, wslDistro, wslDistros, wslText } from "../src/remote.ts";

const posix = { skip: process.platform === "win32" ? "the stand-in for wsl.exe runs the command with /bin/sh" : false };
const temp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-wsl-")));

test("wsl: a distribution is named as wsl --list shows it, and never an option", () => {
	assert.equal(wslDistro(" "), undefined);
	assert.deepEqual(wslDistro("Ubuntu-24.04"), { distro: "Ubuntu-24.04", label: "Ubuntu-24.04" });
	for (const bad of ["-d", "--exec", "Ubuntu; rm -rf ~", "a b", "$(x)", "..\\x"]) assert.throws(() => wslDistro(bad), RemoteError, bad);
});

test("wsl: what wsl.exe says in UTF-16 is read, and what a program prints in UTF-8 too", () => {
	assert.equal(wslText(Buffer.from("﻿Ubuntu\r\nDebian\r\n", "utf16le")), "Ubuntu\r\nDebian\r\n");
	assert.equal(wslText(Buffer.from("plain text from sh\n", "utf8")), "plain text from sh\n");
	// The pine the app puts into the distribution comes before one on the PATH, and the rest is what ssh runs.
	assert.match(WSL_SCRIPT, /pine-app\/bin\/pine" \] && PATH=.*command -v pine/);
});

/** A stand-in for wsl.exe: `--list --quiet` in UTF-16 as Windows writes it; `--distribution D --exec /bin/sh -c S` runs S with sh. */
function standIn(dir: string, bin: string): string {
	const file = path.join(dir, "wsl.mjs");
	fs.writeFileSync(
		file,
		`#!${process.execPath}
import { spawn } from "node:child_process";
import fs from "node:fs";
const args = process.argv.slice(2);
fs.appendFileSync(process.env.LOG, JSON.stringify(args.slice(0, 4)) + "\\n");
if (args[0] === "--list") { process.stdout.write(Buffer.from("\\uFEFFUbuntu\\r\\nDebian\\r\\n", "utf16le")); process.exit(0); }
if (args[1] !== "Ubuntu") { process.stderr.write(Buffer.from("There is no distribution with the supplied name.\\r\\nError code: Wsl/Service/WSL_E_DISTRO_NOT_FOUND\\r\\n", "utf16le")); process.exit(1); }
const c = spawn(args[3], args.slice(4), { stdio: "inherit", env: { ...process.env, PATH: ${JSON.stringify(bin)} + ":" + ${JSON.stringify(path.dirname(process.execPath))} + ":/usr/bin:/bin", SHELL: process.env.LOGIN_SHELL || "/bin/sh" } });
c.on("close", (code) => process.exit(code ?? 1));
`,
		{ mode: 0o755 },
	);
	return file;
}

async function distribution() {
	const dir = temp();
	const home = path.join(dir, "home");
	const bin = path.join(home, ".local", "share", "pine-app", "bin");
	fs.mkdirSync(bin, { recursive: true });
	const log = path.join(dir, "log");
	fs.writeFileSync(log, "");
	// The daemon inside: a server that answers the control API's overview to its token alone.
	const server = http.createServer((req, res) => res.writeHead(req.headers.authorization === "Bearer wsl-token" ? 200 : 401).end("{}"));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as any).port;
	// The pine the app put there: its service line, then it holds the connection as `pine service` does.
	fs.writeFileSync(path.join(bin, "pine"), `#!/bin/sh\necho '${JSON.stringify({ base: `http://127.0.0.1:${port}`, token: "wsl-token", started: true, home: "/home/you/.pine", version: "9.9.9" })}'\n`, { mode: 0o755 });
	const wsl = standIn(dir, bin);
	const env = { ...process.env, HOME: home, LOG: log };
	const close = () => (server.close(), fs.rmSync(dir, { recursive: true, force: true }));
	return { wsl, env, log: () => fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)), close, port };
}

test("wsl: the distributions are listed, the default first", posix, async () => {
	const d = await distribution();
	try {
		assert.deepEqual(await wslDistros({ wsl: d.wsl, env: d.env }), ["Ubuntu", "Debian"]);
		assert.deepEqual(await wslDistros({ wsl: path.join(os.tmpdir(), "no-such-wsl") }), [], "no WSL, none");
	} finally {
		d.close();
	}
});

test("wsl: the pine in a distribution is reached on this computer's loopback, or through a relay where WSL does not hand the port over", posix, async () => {
	const d = await distribution();
	try {
		const s = await connectWsl("Ubuntu", { wsl: d.wsl, env: d.env });
		assert.equal(s.base, `http://127.0.0.1:${d.port}`);
		assert.equal(s.token, "wsl-token");
		assert.equal(s.started, true);
		assert.equal(s.host, "wsl:Ubuntu");
		assert.deepEqual(d.log()[0], ["--distribution", "Ubuntu", "--exec", "/bin/sh"]);
		await s.stop();

		// The relay: a port of this computer, and each connection carried through wsl.exe to the daemon's port there.
		const r = await connectWsl("Ubuntu", { wsl: d.wsl, env: d.env, direct: false });
		assert.notEqual(r.base, `http://127.0.0.1:${d.port}`);
		const res = await fetch(`${r.base}/overview`, { headers: { authorization: "Bearer wsl-token" } });
		assert.equal(res.status, 200);
		assert.ok(d.log().length >= 3, "a wsl.exe for the connection, and one for each request through the relay");
		await r.stop();
		await assert.rejects(fetch(`${r.base}/overview`, { signal: AbortSignal.timeout(2000) }), "the relay ends with the connection");
	} finally {
		d.close();
	}
});

test("wsl: a distribution that is not there, and one without pine, say what to do", posix, async () => {
	const d = await distribution();
	try {
		await assert.rejects(connectWsl("Debian2", { wsl: d.wsl, env: d.env }), /There is no WSL distribution called Debian2/);
		fs.rmSync(path.join(d.env.HOME!, ".local"), { recursive: true });
		// A login shell whose PATH has no pine either (this computer's own profile may have one).
		const bare = path.join(d.env.HOME!, "bare-shell");
		fs.writeFileSync(bare, "#!/bin/sh\necho /usr/bin:/bin\n", { mode: 0o755 });
		await assert.rejects(connectWsl("Ubuntu", { wsl: d.wsl, env: { ...d.env, LOGIN_SHELL: bare } }), /pine is not installed in Ubuntu yet/);
		await assert.rejects(connectWsl("Ubuntu", { wsl: path.join(os.tmpdir(), "no-such-wsl") }), /this Windows has no WSL/);
	} finally {
		d.close();
	}
});
