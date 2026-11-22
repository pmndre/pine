// What a program the app starts gets of the app's own process: on Linux nothing but its standard
// descriptors (`withoutFds` in electron/fds.ts). Node marks what it inherits to be closed, so a Node
// process cannot stand in for the app here: the owner's shell in the terminal is checked in
// app.test.ts, against Electron's own files.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { withoutFds } from "../electron/fds.ts";

const linux = process.platform === "linux" ? false : "only Linux hands a child the descriptors its parent did not mark";

/** A file open in this process, handed to a child as descriptors 3 and 12 without close-on-exec, as Electron's own files reach a child it starts. */
function heldBy(dir: string): { file: string; stdio: Array<"ignore" | "pipe" | number> } {
	const file = path.join(dir, "held-by-the-app");
	const fd = fs.openSync(file, "w");
	// (One above 9 is why it is bash: sh's exec closes no descriptor of two digits.)
	return { file, stdio: ["ignore", "pipe", "pipe", fd, ...Array<"ignore">(8).fill("ignore"), fd] };
}

test("a program the app starts holds none of the app's descriptors, and gets its arguments and SHLVL as they were", { skip: linux }, () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-fds-")));
	const { file, stdio } = heldBy(dir);
	try {
		const readlink = execFileSync("/bin/sh", ["-c", "command -v readlink"], { encoding: "utf8" }).trim();
		const held = (argv: string[]) => spawnSync(argv[0], argv.slice(1), { stdio, encoding: "utf8" }).stdout.trim();
		assert.equal(held([readlink, "/proc/self/fd/3", "/proc/self/fd/12"]), `${file}\n${file}`, "the stand-ins for the app's descriptors did not reach the child");
		assert.equal(held(withoutFds([readlink, "/proc/self/fd/3", "/proc/self/fd/12"])), "");
		// The program itself runs with its arguments as they were, bash reads no file of the owner's on the way, and a
		// shell started this way does not count the bash in front of it.
		fs.writeFileSync(path.join(dir, "bash-env"), "echo read-by-bash\n");
		const [echo, ...args] = withoutFds(["/bin/sh", "-c", 'echo "$1 $SHLVL"', "sh", "a b"]);
		assert.equal(spawnSync(echo, args, { encoding: "utf8", env: { ...process.env, SHLVL: "3", BASH_ENV: path.join(dir, "bash-env") } }).stdout, "a b 3\n");
		assert.deepEqual(withoutFds(["/bin/echo", "x"], "darwin"), ["/bin/echo", "x"]);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

