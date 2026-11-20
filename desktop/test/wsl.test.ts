// What the app does for a pine in WSL on Windows (electron/wsl.ts): paths in both directions, and
// what it runs in the distribution to bring pine in, run here with this system's sh and tar.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { hostOf, readHosts } from "../electron/service.ts";
import { fromWsl, INSTALL_SCRIPT, toWsl } from "../electron/wsl.ts";

test("wsl: a folder of Windows is under /mnt there, one of the distribution under \\\\wsl.localhost here", () => {
	assert.equal(toWsl("C:\\Users\\me\\project", "Ubuntu"), "/mnt/c/Users/me/project");
	assert.equal(toWsl("D:\\", "Ubuntu"), "/mnt/d");
	assert.equal(toWsl("c:/work/x/", "Ubuntu"), "/mnt/c/work/x");
	assert.equal(toWsl("\\\\wsl.localhost\\Ubuntu\\home\\me\\p", "Ubuntu"), "/home/me/p");
	assert.equal(toWsl("\\\\wsl$\\ubuntu\\home\\me", "Ubuntu"), "/home/me");
	assert.equal(toWsl("\\\\wsl.localhost\\Debian\\home\\me", "Ubuntu"), undefined, "another distribution's folder");
	assert.equal(toWsl("\\\\server\\share\\x", "Ubuntu"), undefined, "another computer's share");
	assert.equal(toWsl("relative\\path", "Ubuntu"), undefined);
	assert.equal(fromWsl("/mnt/c/Users/me/project", "Ubuntu"), "C:\\Users\\me\\project");
	assert.equal(fromWsl("/home/me/p", "Ubuntu"), "\\\\wsl.localhost\\Ubuntu\\home\\me\\p");
	for (const p of ["C:\\Users\\me\\a b", "\\\\wsl.localhost\\Ubuntu\\home\\me\\x"]) assert.equal(fromWsl(toWsl(p, "Ubuntu")!, "Ubuntu"), p);
});

test("wsl: pine is brought into the distribution whole, and pine there runs it", { skip: process.platform === "win32" ? "runs the script with this system's sh" : false }, () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-wsl-install-")));
	try {
		const home = path.join(dir, "home");
		fs.mkdirSync(home);
		// The app's resources: a pine package, and Node for Linux as nodejs.org packs it (a stand-in node).
		const pine = path.join(dir, "res", "pine");
		fs.mkdirSync(path.join(pine, "bin"), { recursive: true });
		fs.writeFileSync(path.join(pine, "bin", "pine.js"), "// pine\n");
		const nodeDir = path.join(dir, "n", "node-v24.0.0-linux-x64", "bin");
		fs.mkdirSync(nodeDir, { recursive: true });
		fs.writeFileSync(path.join(nodeDir, "node"), '#!/bin/sh\necho "node ran $1 with $2"\n', { mode: 0o755 });
		const archive = path.join(dir, "node-linux.tar.xz");
		execFileSync("tar", ["-cJf", archive, "-C", path.join(dir, "n"), "node-v24.0.0-linux-x64"]);
		// wslpath, as WSL has it: here a path is already one.
		const bin = path.join(dir, "bin");
		fs.mkdirSync(bin);
		fs.writeFileSync(path.join(bin, "wslpath"), '#!/bin/sh\necho "$2"\n', { mode: 0o755 });
		const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin` };
		for (const v of ["1.0.0", "1.1.0", "1.2.0"]) execFileSync("/bin/sh", ["-c", INSTALL_SCRIPT, "pine-install", v, pine, archive], { env });
		const app = path.join(home, ".local", "share", "pine-app");
		assert.equal(fs.readlinkSync(path.join(app, "current")), "1.2.0");
		assert.deepEqual(fs.readdirSync(app).sort(), ["1.1.0", "1.2.0", "bin", "current"], "older versions go, but the one a running daemon may still use");
		assert.equal(execFileSync(path.join(app, "bin", "pine"), ["service"], { env, encoding: "utf8" }).trim(), `node ran ${path.join(app, "current", "pine", "bin", "pine.js")} with service`);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("wsl: a distribution is kept among the machines as wsl:<name>, and nothing that is an option", () => {
	assert.equal(hostOf("wsl:Ubuntu-24.04"), "wsl:Ubuntu-24.04");
	assert.equal(hostOf("WSL:Debian"), "wsl:Debian");
	assert.equal(hostOf("you@server"), "you@server");
	assert.throws(() => hostOf("wsl:--exec"));
	assert.deepEqual(readHosts(["wsl:Ubuntu", "wsl:-d", "you@server", "wsl:Ubuntu"]), ["wsl:Ubuntu", "you@server"]);
});
