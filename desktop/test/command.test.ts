// `pine` for a terminal (electron/command.ts): what the app finds in the shell's PATH, where it
// puts its link, and what it leaves alone. On folders of the test's own: nothing here touches
// the PATH of the computer it runs on, and nothing asks for a password.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { asOwner, install, look, place, remove, said } from "../electron/command.ts";

/** Links are made on a Mac and on Linux. On Windows the installer puts the app's folder into the PATH: tested on its own below. */
const links = process.platform === "win32" ? "Windows has no link: the installer's folder in the PATH is tested below" : false;

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

test("command: the link goes into a folder of the PATH that is the owner's, and comes out again", { skip: links }, async () => {
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
		assert.match(said(made), /is this app's pine/);
		// A second time changes nothing.
		assert.deepEqual(await install(w.resources, env, w.home), made);

		assert.equal((await remove(w.resources, env, w.home)).state, "none");
		assert.equal(fs.existsSync(path.join(own, "pine")), false);
	} finally {
		w.done();
	}
});

test("command: a pine that was installed by itself is left alone", { skip: links }, async () => {
	const w = world();
	try {
		const own = w.dir("home", ".local", "bin");
		const npm = w.dir("npm", "bin");
		fs.writeFileSync(path.join(npm, "pine"), "#!/bin/sh\necho another pine\n", { mode: 0o755 });
		const env = { PATH: [own, npm].join(path.delimiter) };
		const now = look(w.resources, env, w.home);
		assert.deepEqual(now, { state: "other", at: path.join(npm, "pine") });
		assert.match(said(now), /a different pine .*leaves it alone/);
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
		assert.match(kept.why ?? "", /will not replace it/);
		assert.equal(fs.readFileSync(path.join(own, "pine"), "utf8"), "notes, not a program\n");
		fs.rmSync(path.join(own, "pine"));
		fs.symlinkSync("/somewhere/else/pine", path.join(own, "pine"));
		assert.match((await install(w.resources, env2, w.home)).why ?? "", /a link to \/somewhere\/else\/pine/);
		assert.equal(fs.readlinkSync(path.join(own, "pine")), "/somewhere/else/pine");
	} finally {
		w.done();
	}
});

test("command: the link of an app that has moved away is replaced by this app's", { skip: links }, async () => {
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

test("command: without a folder to write, the shared one and a password; from a place that changes, nothing", { skip: links }, () => {
	const w = world();
	try {
		const closed = w.dir("closed");
		fs.chmodSync(closed, 0o555);
		const env = { PATH: [closed, "/usr/bin", "/bin"].join(path.delimiter) };
		assert.deepEqual(look(w.resources, env, w.home), { state: "none", at: "/usr/local/bin/pine", password: true });
		assert.match(said(look(w.resources, env, w.home)), /to \/usr\/local\/bin.*will ask for your password/);

		// What the system is asked to run with the password: the path is an argument, never a part of the script.
		const odd = `/Applications/It's "Pine"; rm -rf ~.app/Contents/Resources/bin/pine`;
		const argv = asOwner("why", `"/bin/ln -sfn " & quoted form of (item 1 of argv) & " /usr/local/bin/pine"`, [odd]);
		assert.equal(argv.at(-1), odd);
		assert.equal(argv.slice(0, -1).some((a) => a.includes("rm -rf")), false);
		assert.equal(argv.at(-2), "--");

		// An app without a pine inside offers nothing and says nothing.
		assert.deepEqual(look(undefined, env, w.home), { state: "unavailable", why: undefined });
		assert.deepEqual(look(path.join(w.root, "empty"), env, w.home), { state: "unavailable", why: undefined });
		// Run from a disk image or translocated, it says to move the app first. (A Mac's places.)
		for (const place of process.platform === "darwin" ? [["private", "var", "folders", "AppTranslocation", "1234", "d"]] : []) {
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

test("command: an AppImage's link leads to the AppImage, never into the folder under /tmp it runs from", { skip: links }, async () => {
	const w = world();
	// What an AppImage's runtime mounts, at another place for every start.
	const mount = fs.mkdtempSync("/tmp/.mount_pine-test-");
	try {
		const own = w.dir("home", ".local", "bin");
		const image = path.join(w.root, "Apps", "Pine-0.40.0-x64.AppImage");
		fs.mkdirSync(path.dirname(image), { recursive: true });
		fs.writeFileSync(image, "#!/bin/sh\n", { mode: 0o755 });
		const resources = path.join(mount, "resources");
		fs.mkdirSync(path.join(resources, "bin"), { recursive: true });
		fs.writeFileSync(path.join(resources, "bin", "pine"), "#!/bin/sh\n", { mode: 0o755 });
		const env = { PATH: own, APPIMAGE: image };
		assert.deepEqual(look(resources, env, w.home, "linux"), { state: "none", at: path.join(own, "pine"), password: false });
		assert.deepEqual(await install(resources, env, w.home, "linux"), { state: "here", at: path.join(own, "pine") });
		assert.equal(fs.readlinkSync(path.join(own, "pine")), image);
		// The next start mounts it elsewhere: still the pine of this app.
		const next = path.join(mount, "next", "resources");
		fs.mkdirSync(path.join(next, "bin"), { recursive: true });
		fs.writeFileSync(path.join(next, "bin", "pine"), "#!/bin/sh\n", { mode: 0o755 });
		assert.deepEqual(look(next, env, w.home, "linux"), { state: "here", at: path.join(own, "pine") });
		// A link of a Pine AppImage that has gone is this app's to replace.
		fs.rmSync(path.join(own, "pine"));
		fs.symlinkSync(path.join(w.root, "Downloads", "Pine-0.39.0-x64.AppImage"), path.join(own, "pine"));
		assert.equal((await install(resources, env, w.home, "linux")).state, "here");
		assert.equal((await remove(resources, env, w.home, "linux")).state, "none");
		// An AppImage that did not say where it lies offers nothing: the folder it runs from changes.
		const lost = look(resources, { PATH: own }, w.home, "linux");
		assert.equal(lost.state, "unavailable");
		assert.match(lost.why ?? "", /Start Pine from the AppImage file itself/);
		// In a Linux package the link leads to the launcher in the app, as on a Mac; the password is the system's.
		const closed = w.dir("closed");
		fs.chmodSync(closed, 0o555);
		assert.match(said(look(w.resources, { PATH: closed }, w.home, "linux"), "linux"), /to \/usr\/local\/bin.*The system will ask for your password/);
		fs.chmodSync(closed, 0o755);
	} finally {
		fs.rmSync(mount, { recursive: true, force: true });
		w.done();
	}
});

test("command: on Windows the folder the installer put into the PATH is the app's pine; there is nothing to set up or remove", async () => {
	const w = world();
	try {
		const resources = w.dir("Programs", "Pine", "resources");
		const bin = w.dir("Programs", "Pine", "resources", "bin");
		fs.writeFileSync(path.join(bin, "pine.cmd"), "@echo off\r\n");
		const npm = w.dir("npm");
		// Not on the PATH: the installer puts it there.
		const none = look(resources, { Path: npm }, w.home, "win32");
		assert.equal(none.state, "unavailable");
		assert.match(said(none, "win32"), /installer adds pine to your PATH/);
		// On the PATH (by whatever name Windows gives the variable, with a separator at the end or not): the app's.
		const here = look(resources, { Path: `${npm};${bin}\\` }, w.home, "win32");
		assert.deepEqual(here, { state: "here", at: path.join(bin, "pine.cmd"), managed: true });
		assert.match(said(here, "win32"), /uninstalling Pine removes it/);
		assert.deepEqual(await install(resources, { Path: bin }, w.home, "win32"), here);
		assert.deepEqual(await remove(resources, { Path: bin }, w.home, "win32"), here);
		assert.equal(fs.existsSync(path.join(bin, "pine.cmd")), true);
		// npm's pine before it on the PATH answers to `pine`: another pine, left alone.
		fs.writeFileSync(path.join(npm, "pine.cmd"), "@echo off\r\n");
		assert.deepEqual(look(resources, { PATH: `${npm};${bin}` }, w.home, "win32"), { state: "other", at: path.join(npm, "pine.cmd") });
	} finally {
		w.done();
	}
});
