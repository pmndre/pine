import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { sandboxAvailable } from "./security.ts";
import { MAX_FILE, Snapshots } from "./snapshots.ts";

// Everything here writes files through git in a sandbox, so it needs one.
const mac = { skip: !sandboxAvailable() };

/** A folder somewhere in the account, as the owner would open one for a conversation. */
function project(t: { after(fn: () => void): void }, repo = false): string {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(), ".pine-test-undo-")));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	fs.mkdirSync(path.join(dir, "src"));
	fs.writeFileSync(path.join(dir, "notes.txt"), "NOTES-1\n");
	fs.writeFileSync(path.join(dir, "src", "app.ts"), "export const answer = 41;\n");
	if (repo) {
		const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { stdio: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
		git("init", "-q", "-b", "main");
		git("add", ".");
		git("commit", "-q", "-m", "first");
	}
	return dir;
}

const read = (dir: string, file: string) => (fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), "utf8") : undefined);

test("snapshots: a restore sets only the files it is asked for, never through a link, and its git cannot write beside the folder", mac, async (t) => {
	const dir = project(t);
	const outside = project(t);
	fs.writeFileSync(path.join(outside, "app.ts"), "OUTSIDE\n");
	const store = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-snap-")));
	t.after(() => fs.rmSync(store, { recursive: true, force: true }));
	const snaps = new Snapshots(store);
	const before = await snaps.take(dir);
	fs.writeFileSync(path.join(dir, "src", "app.ts"), "export const answer = 42;\n");
	fs.writeFileSync(path.join(dir, "new.txt"), "new\n");
	const after = await snaps.take(dir);
	assert.deepEqual(await snaps.changed(dir, before, after), [{ path: "new.txt", status: "A", added: 1, removed: 0 }, { path: "src/app.ts", status: "M", added: 1, removed: 1 }]);
	assert.ok((await snaps.diff(dir, before, after, "src/app.ts"))!.diff.includes("+export const answer = 42;"));
	assert.equal((await snaps.diff(dir, before, after, "../../etc/hosts"))?.diff ?? "", "");

	// The folder is swapped for a link out of it after the last state was taken.
	fs.rmSync(path.join(dir, "src"), { recursive: true });
	fs.symlinkSync(outside, path.join(dir, "src"));
	const done = await snaps.restore(dir, before, { within: [before, after] });
	assert.deepEqual(done.files.map((f) => `${f.status} ${f.path}`).sort(), ["A src/app.ts", "D new.txt"], "seen from the folder as it was found: one file comes back, one goes");
	assert.equal(read(outside, "app.ts"), "OUTSIDE\n");
	assert.equal(read(dir, "src/app.ts"), "export const answer = 41;\n");
	assert.ok(fs.lstatSync(path.join(dir, "src")).isDirectory());
	assert.equal(read(dir, "new.txt"), undefined);

	// What the owner changed since, in a file the two states do not differ in, stays.
	fs.writeFileSync(path.join(dir, "notes.txt"), "OWNER-EDIT\n");
	await snaps.restore(dir, after, { only: done.paths });
	assert.equal(read(dir, "src/app.ts"), "export const answer = 42;\n");
	assert.equal(read(dir, "notes.txt"), "OWNER-EDIT\n");

	// A file that grew too large is in no state from then on: no restore puts an old version over it or deletes it.
	const small = await snaps.take(dir);
	fs.writeFileSync(path.join(dir, "new.txt"), "y".repeat(MAX_FILE + 1));
	fs.writeFileSync(path.join(dir, "src", "app.ts"), "export const answer = 43;\n");
	const large = await snaps.take(dir);
	assert.deepEqual(large.skipped, ["new.txt"]);
	const back = await snaps.restore(dir, small, { within: [small, large] });
	assert.deepEqual(back.left, ["new.txt"]);
	assert.equal(fs.statSync(path.join(dir, "new.txt")).size, MAX_FILE + 1);
	assert.equal(read(dir, "src/app.ts"), "export const answer = 42;\n");
	await snaps.restore(dir, large, { only: [...back.paths, "new.txt"], avoid: [small] });
	assert.equal(fs.statSync(path.join(dir, "new.txt")).size, MAX_FILE + 1);
	assert.equal(read(dir, "src/app.ts"), "export const answer = 43;\n");

	// Whatever git were talked into, the sandbox it runs in lets it write the folders named and nothing else.
	const { git } = await import("./workspace-view.ts");
	assert.notEqual((await git(dir, ["init", "-q", path.join(outside, "made-by-git")], { write: [dir] })).code, 0);
	assert.ok(!fs.existsSync(path.join(outside, "made-by-git")));
	assert.notEqual((await git(dir, ["init", "-q", path.join(dir, "made-by-git")])).code, 0, "without a folder named it can only look");
	assert.equal((await git(dir, ["init", "-q", path.join(dir, "made-by-git")], { write: [dir] })).code, 0);
});

test("snapshots: nothing in the folder or in the owner's git settings makes git run a program or change a byte", mac, async (t) => {
	const dir = project(t);
	const elsewhere = project(t);
	const marker = path.join(elsewhere, "ran");
	// Settings of the owner's own: a filter program, a file system monitor, hooks.
	fs.writeFileSync(path.join(elsewhere, ".gitconfig"), `[filter "x"]\n\tclean = touch ${marker} #\n\tsmudge = touch ${marker} #\n\trequired = true\n[core]\n\tfsmonitor = touch ${marker} #\n\thooksPath = ${elsewhere}\n\tautocrlf = true\n\texcludesFile = ${elsewhere}/ignore\n`);
	fs.writeFileSync(path.join(elsewhere, "ignore"), "notes.txt\n");
	for (const hook of ["post-checkout", "post-index-change", "pre-auto-gc"]) fs.writeFileSync(path.join(elsewhere, hook), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
	// And the folder asks for all of it.
	fs.writeFileSync(path.join(dir, ".gitattributes"), "* filter=x text eol=crlf ident\n");
	fs.writeFileSync(path.join(dir, "crlf.txt"), "one\r\ntwo\n$Id$\n");
	const store = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-snap-")));
	t.after(() => fs.rmSync(store, { recursive: true, force: true }));
	const home = process.env.HOME;
	process.env.HOME = elsewhere;
	try {
		const snaps = new Snapshots(store);
		const before = await snaps.take(dir);
		fs.writeFileSync(path.join(dir, "crlf.txt"), "changed\n");
		fs.writeFileSync(path.join(dir, "notes.txt"), "NOTES-2\n");
		const after = await snaps.take(dir);
		assert.equal((await snaps.changed(dir, before, after)).length, 2);
		await snaps.restore(dir, before, { within: [before, after] });
		assert.equal(read(dir, "crlf.txt"), "one\r\ntwo\n$Id$\n", "byte for byte what it was");
		assert.equal(read(dir, "notes.txt"), "NOTES-1\n");
		// Tidying: a state that is still referred to survives it, and the place of a folder that is gone is removed.
		const places = fs.readdirSync(store);
		const old = new Date(Date.now() - 3 * 86_400_000);
		for (const file of [".", "pine-tidied", "index"]) fs.utimesSync(path.join(store, places[0], file), old, old);
		await snaps.prune(new Map([[dir, new Set([before.tree])]]));
		assert.equal((await snaps.changed(dir, before, before)).length, 0);
		fs.writeFileSync(path.join(dir, "notes.txt"), "NOTES-3\n");
		await snaps.restore(dir, before, { only: ["notes.txt"] });
		assert.equal(read(dir, "notes.txt"), "NOTES-1\n", "the state that was kept can still be gone back to");
		for (const file of [".", "pine-tidied", "index"]) fs.utimesSync(path.join(store, places[0], file), old, old);
		await snaps.prune(new Map());
		assert.deepEqual(fs.readdirSync(store), []);
		// A place that is being made this moment has nothing in it yet and is not taken for an abandoned one.
		fs.mkdirSync(path.join(store, "0".repeat(24)));
		await snaps.prune(new Map());
		assert.deepEqual(fs.readdirSync(store), ["0".repeat(24)]);
	} finally {
		process.env.HOME = home;
	}
	assert.ok(!fs.existsSync(marker), "no filter, monitor or hook was run");
});

test("snapshots: a folder inside a repository follows the ignore rules above it, unless the repository ignores the folder itself", mac, async (t) => {
	const store = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-snap-")));
	t.after(() => fs.rmSync(store, { recursive: true, force: true }));
	const snaps = new Snapshots(store);
	const changedIn = async (top: string, rules: string) => {
		const pkg = path.join(top, "packages", "app");
		fs.mkdirSync(path.join(pkg, "node_modules", "dep"), { recursive: true });
		fs.writeFileSync(path.join(top, ".gitignore"), rules);
		fs.writeFileSync(path.join(top, ".git", "info", "exclude"), "*.log\n");
		fs.writeFileSync(path.join(pkg, "index.ts"), "one\n");
		fs.writeFileSync(path.join(pkg, "node_modules", "dep", "index.js"), "dep-1\n");
		fs.writeFileSync(path.join(pkg, "debug.log"), "log-1\n");
		const before = await snaps.take(pkg);
		fs.writeFileSync(path.join(pkg, "index.ts"), "two\n");
		fs.writeFileSync(path.join(pkg, "node_modules", "dep", "index.js"), "dep-2\n");
		fs.writeFileSync(path.join(pkg, "debug.log"), "log-2\n");
		// Beside the folder, in the same repository: not the folder's business.
		fs.writeFileSync(path.join(top, "notes.txt"), "NOTES-2\n");
		const after = await snaps.take(pkg);
		const files = (await snaps.changed(pkg, before, after)).map((f) => f.path).sort();
		await snaps.restore(pkg, before, { within: [before, after] });
		assert.equal(read(pkg, "index.ts"), "one\n");
		assert.equal(read(top, "notes.txt"), "NOTES-2\n");
		return files;
	};
	// Paths are counted from the folder, and what the top of the repository says to leave out is left out.
	assert.deepEqual(await changedIn(project(t, true), "node_modules/\n"), ["index.ts"]);
	// A repository that ignores the folder altogether (a home folder kept in git) has no say in it.
	assert.deepEqual(await changedIn(project(t, true), "*\n"), ["debug.log", "index.ts", "node_modules/dep/index.js"]);
});
