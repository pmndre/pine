import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "./tui/client.ts";
import { harness } from "../testing/harness.ts";
import { sandboxAvailable } from "./security.ts";

const mac = { skip: !sandboxAvailable() };

/** A project folder somewhere in the account, outside every agent's reach until it is opened for a conversation. */
function project(t: { after(fn: () => void): void }, repo = true): string {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(), ".pine-test-project-")));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	fs.mkdirSync(path.join(dir, "src"));
	fs.writeFileSync(path.join(dir, "notes.txt"), "PROJECT-NOTES\n");
	fs.writeFileSync(path.join(dir, "src", "app.ts"), "export const answer = 41;\nexport const name = \"app\";\n");
	if (repo) {
		const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { stdio: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
		git("init", "-q", "-b", "main");
		git("add", ".");
		git("commit", "-q", "-m", "first");
	}
	return dir;
}

test("code view: changes, diffs, files and file text of a conversation's folder, and nothing outside it", mac, async (t) => {
	const dir = project(t);
	const outside = project(t, false);
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: { files: { "own.txt": "in the workspace\n" } } } });
	const client = new Client(`http://127.0.0.1:${h.pine.http!.port}`, h.pine.token);
	await client.setFolder("main", "proj", dir);

	// A repository must not get to run anything because it was looked at.
	const marker = path.join(outside, "ran");
	fs.appendFileSync(path.join(dir, ".git", "config"), `[diff]\n\texternal = touch ${marker} #\n[core]\n\tfsmonitor = touch ${marker} #\n[diff "x"]\n\ttextconv = touch ${marker} #\n`);
	fs.writeFileSync(path.join(dir, ".gitattributes"), "*.ts diff=x\n");

	fs.writeFileSync(path.join(dir, "src", "app.ts"), "export const answer = 42;\nexport const name = \"app\";\nexport const more = true;\n");
	fs.writeFileSync(path.join(dir, "fresh.md"), "# new\n\ntext\n");
	fs.rmSync(path.join(dir, "notes.txt"));
	fs.symlinkSync(path.join(outside, "notes.txt"), path.join(dir, "leak.txt"));
	fs.writeFileSync(path.join(dir, "blob.bin"), Buffer.from([1, 2, 0, 3]));

	const ch = await client.changes("main", "proj");
	assert.equal(ch.root, dir);
	assert.ok(ch.repo && ch.branch === "main");
	const byPath = Object.fromEntries(ch.files.map((f) => [f.path, f]));
	assert.deepEqual(byPath["src/app.ts"], { path: "src/app.ts", status: "M", added: 2, removed: 1 });
	assert.deepEqual(byPath["notes.txt"], { path: "notes.txt", status: "D", added: 0, removed: 1 });
	assert.deepEqual(byPath["fresh.md"], { path: "fresh.md", status: "?", added: 3 });

	const diff = await client.diff("main", "proj", "src/app.ts");
	assert.ok(diff.diff.includes("-export const answer = 41;") && diff.diff.includes("+export const answer = 42;"), diff.diff);
	assert.ok((await client.diff("main", "proj", "fresh.md")).diff.includes("+# new"), "a file git does not know yet is all new");
	assert.ok(!fs.existsSync(marker), "nothing the repository's configuration names was run");
	await assert.rejects(client.diff("main", "proj", "../../etc/hosts"), /nothing there|404/);

	const names = (await client.tree("main", "proj", "")).entries.map((e) => `${e.name}${e.dir ? "/" : ""}`);
	assert.deepEqual(names, ["src/", ".gitattributes", "blob.bin", "fresh.md"], "folders first; git's own folder and a link that leads out are left out");
	assert.deepEqual((await client.tree("main", "proj", "src")).entries.map((e) => e.name), ["app.ts"]);
	assert.equal((await client.file("main", "proj", "fresh.md")).text, "# new\n\ntext\n");
	assert.deepEqual(await client.file("main", "proj", "blob.bin"), { size: 4, binary: true, truncated: false });
	for (const bad of ["leak.txt", "../notes.txt", path.join(outside, "notes.txt"), "src"]) await assert.rejects(client.file("main", "proj", bad), /nothing there|404/, bad);
	await assert.rejects(client.tree("main", "proj", ".."), /nothing there|404/);

	// A conversation without a folder shows the agent's own workspace, which is no repository here.
	assert.deepEqual((await client.tree("main", "main", "")).entries.map((e) => e.name), ["own.txt"]);
	assert.equal((await client.changes("main", "main")).repo, false);
	assert.equal((await fetch(`http://127.0.0.1:${h.pine.http!.port}/agents/main/view/tree?session=proj`)).status, 401);
	await h.close();
});
