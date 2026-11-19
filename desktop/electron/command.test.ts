// `pine` for a terminal (electron/command.ts): what the app finds in the shell's PATH, where it
// puts its link, and what it leaves alone. On folders of the test's own: nothing here touches
// the PATH of the Mac it runs on, and nothing asks for a password.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { asOwner, install, look, place, remove, said } from "./command.ts";

function world() {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-command-")));
	const resources = path.join(root, "Applications", "Pine.app", "Contents", "Resources");
	fs.mkdirSync(path.join(resources, "bin"), { recursive: true });
	fs.writeFileSync(path.join(resources, "bin", "pine"), "#!/bin/sh\necho pine\n", { mode: 0o755 });
	const home = path.join(root, "home");
	const dir = (...parts: string[]) => {
		const d = path.join(root, ...parts);
		fs.mkdirSync(d, { recursive: true });
		return d;
	};
	return { root, resources, home, dir, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("command: the link goes into a folder of the PATH that is the owner's, and comes out again", async () => {
	const w = world();
	try {
		const own = w.dir("home", ".local", "bin");
		const other = w.dir("tools");
		const env = { PATH: [other, own, "/usr/bin"].join(path.delimiter) };
		// The owner's own folder, though another one of the PATH could be written too.
		assert.deepEqual(place(env, w.home), { dir: own, password: false });
		assert.deepEqual(look(w.resources, env, w.home), { state: "none", at: path.join(own, "pine"), password: false });

		const made = await install(w.resources, env, w.home);
		assert.deepEqual(made, { state: "here", at: path.join(own, "pine") });
		assert.equal(fs.readlinkSync(path.join(own, "pine")), path.join(w.resources, "bin", "pine"));
		assert.match(said(made), /is the pine of this app/);
		// A second time changes nothing.
		assert.deepEqual(await install(w.resources, env, w.home), made);

		assert.equal((await remove(w.resources, env, w.home)).state, "none");
		assert.equal(fs.existsSync(path.join(own, "pine")), false);
	} finally {
		w.done();
	}
});

test("command: a pine that was installed by itself is left alone", async () => {
	const w = world();
	try {
		const own = w.dir("home", ".local", "bin");
		const npm = w.dir("npm", "bin");
		fs.writeFileSync(path.join(npm, "pine"), "#!/bin/sh\necho another pine\n", { mode: 0o755 });
		const env = { PATH: [own, npm].join(path.delimiter) };
		const now = look(w.resources, env, w.home);
		assert.deepEqual(now, { state: "other", at: path.join(npm, "pine") });
		assert.match(said(now), /another pine .*leaves it alone/);
		// Neither setting up nor removing does anything to it, or beside it.
		assert.deepEqual(await install(w.resources, env, w.home), now);
		assert.deepEqual(await remove(w.resources, env, w.home), now);
		assert.deepEqual(fs.readdirSync(own), []);
		assert.equal(fs.readFileSync(path.join(npm, "pine"), "utf8"), "#!/bin/sh\necho another pine\n");

		// Something else under that name where the link would go is not replaced either.
		const env2 = { PATH: own };
		fs.writeFileSync(path.join(own, "pine"), "notes, not a program\n", { mode: 0o644 });
		const kept = await install(w.resources, env2, w.home);
		assert.equal(kept.state, "none");
		assert.match(kept.why ?? "", /does not replace it/);
		assert.equal(fs.readFileSync(path.join(own, "pine"), "utf8"), "notes, not a program\n");
		fs.rmSync(path.join(own, "pine"));
		fs.symlinkSync("/somewhere/else/pine", path.join(own, "pine"));
		assert.match((await install(w.resources, env2, w.home)).why ?? "", /a link to \/somewhere\/else\/pine/);
		assert.equal(fs.readlinkSync(path.join(own, "pine")), "/somewhere/else/pine");
	} finally {
		w.done();
	}
});

test("command: the link of an app that has moved away is replaced by this app's", async () => {
	const w = world();
	try {
		const own = w.dir("home", "bin");
		const env = { PATH: own };
		fs.symlinkSync("/Users/somebody/Downloads/Pine.app/Contents/Resources/bin/pine", path.join(own, "pine"));
		// It leads nowhere: the shell has no pine.
		assert.equal(look(w.resources, env, w.home).state, "none");
		assert.equal((await install(w.resources, env, w.home)).state, "here");
		assert.equal(fs.readlinkSync(path.join(own, "pine")), path.join(w.resources, "bin", "pine"));
	} finally {
		w.done();
	}
});

test("command: without a folder to write, the shared one and a password; from a place that changes, nothing", () => {
	const w = world();
	try {
		const closed = w.dir("closed");
		fs.chmodSync(closed, 0o555);
		const env = { PATH: [closed, "/usr/bin", "/bin"].join(path.delimiter) };
		assert.deepEqual(look(w.resources, env, w.home), { state: "none", at: "/usr/local/bin/pine", password: true });
		assert.match(said(look(w.resources, env, w.home)), /into \/usr\/local\/bin.*asks for your password/);

		// What the system is asked to run with the password: the path is an argument, never a part of the script.
		const odd = `/Applications/It's "Pine"; rm -rf ~.app/Contents/Resources/bin/pine`;
		const argv = asOwner("why", `"/bin/ln -sfn " & quoted form of (item 1 of argv) & " /usr/local/bin/pine"`, [odd]);
		assert.equal(argv.at(-1), odd);
		assert.equal(argv.slice(0, -1).some((a) => a.includes("rm -rf")), false);
		assert.equal(argv.at(-2), "--");

		// An app without a pine inside offers nothing and says nothing.
		assert.deepEqual(look(undefined, env, w.home), { state: "unavailable", why: undefined });
		assert.deepEqual(look(path.join(w.root, "empty"), env, w.home), { state: "unavailable", why: undefined });
		// Run from a disk image or translocated, it says to move the app first.
		for (const place of [["private", "var", "folders", "AppTranslocation", "1234", "d"]]) {
			const res = path.join(w.dir(...place), "Pine.app", "Contents", "Resources");
			fs.mkdirSync(path.join(res, "bin"), { recursive: true });
			fs.writeFileSync(path.join(res, "bin", "pine"), "#!/bin/sh\n", { mode: 0o755 });
			assert.match(look(res, env, w.home).why ?? "", /Move Pine into your Applications folder/);
			assert.equal(look(res, env, w.home).state, "unavailable");
		}
		fs.chmodSync(closed, 0o755);
	} finally {
		w.done();
	}
});
