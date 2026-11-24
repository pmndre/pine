import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { sandboxAvailable } from "../src/security.ts";
import { Conflict, finish, inspect, listed, make, merge, remove, status, update, worktreeName } from "../src/worktrees.ts";
import { harness, mockMsg, refused } from "./support/harness.ts";

// Everything pine does to a repository it does through git in its helper sandbox, so it needs one.
const boxed = { skip: !sandboxAvailable() };

/** A repository somewhere in the account, as the owner would open one for a conversation. */
export function repository(t: { after(fn: () => void): void }): { dir: string; git: (...args: string[]) => string } {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(), ".pine-test-worktree-")));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { stdio: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } }).toString();
	fs.mkdirSync(path.join(dir, "src"));
	fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\nthree\n");
	fs.writeFileSync(path.join(dir, "src", "app.ts"), "export const answer = 41;\n");
	fs.writeFileSync(path.join(dir, ".gitignore"), ".env\nnode_modules/\n");
	git("init", "-q", "-b", "main");
	git("add", ".");
	git("commit", "-q", "-m", "first");
	return { dir, git };
}

const commitIn = (dir: string, message: string) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "commit", "-qam", message], { stdio: "pipe" });

test("worktrees: names are what git takes for a branch and a folder", () => {
	assert.equal(worktreeName("Fix the login!"), "Fix-the-login");
	assert.equal(worktreeName("../../etc"), "etc");
	assert.equal(worktreeName("a..b.lock"), "a.b");
	assert.equal(worktreeName("   "), "work");
});

test("worktrees: one is made beside the repository's .git, on its own branch, hidden from git, with the ignored files it lists", boxed, async (t) => {
	const { dir, git } = repository(t);
	fs.writeFileSync(path.join(dir, ".env"), "SECRET=1\n");
	fs.mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
	fs.writeFileSync(path.join(dir, "node_modules", "x", "i.js"), "1");
	fs.writeFileSync(path.join(dir, ".worktreeinclude"), ".env\na.txt\nnode_modules/\n");
	fs.symlinkSync("/etc/hosts", path.join(dir, "hosts.env"));
	fs.appendFileSync(path.join(dir, ".gitignore"), "hosts.env\n");
	fs.writeFileSync(path.join(dir, ".worktreeinclude"), ".env\na.txt\nhosts.env\n");

	const w = await make({ folder: path.join(dir, "src"), name: "fix login", kind: "conversation" });
	assert.equal(w.path, path.join(dir, ".pine", "worktrees", "fix-login"));
	assert.equal(w.branch, "pine/fix-login");
	assert.equal(w.base, "main");
	assert.equal(w.sub, "src");
	assert.equal(w.common, path.join(dir, ".git"));
	assert.equal(fs.readFileSync(path.join(w.path, "src", "app.ts"), "utf8"), "export const answer = 41;\n");
	assert.deepEqual(w.copied, [".env"], "an ignored file it lists, not a tracked one, and not a link");
	assert.equal(fs.readFileSync(path.join(w.path, ".env"), "utf8"), "SECRET=1\n");
	assert.doesNotMatch(git("status", "--porcelain", "--untracked-files=all"), /\.pine/, "the main checkout does not see .pine");
	assert.match(git("worktree", "list", "--porcelain"), /locked pine/);
	assert.deepEqual((await listed(dir)).map((l) => l.branch), ["pine/fix-login"]);

	// A second one of the same name gets one of its own; one made from inside a worktree goes beside it.
	const w2 = await make({ folder: w.path, name: "fix login", kind: "task" });
	assert.equal(w2.branch, "pine/fix-login-2");
	assert.equal(w2.base, "pine/fix-login");
	assert.equal(w2.repo, dir);
	await assert.rejects(inspect(os.tmpdir()), /not in a git repository/);
});

test("worktrees: merged as a fast-forward, a merge commit or a squash; a conflict changes nothing", boxed, async (t) => {
	const { dir, git } = repository(t);
	const w = await make({ folder: dir, name: "one", kind: "conversation" });
	assert.equal((await status(w)).ahead, 0);
	await assert.rejects(merge(w, "merge"), /nothing to merge/);

	fs.writeFileSync(path.join(w.path, "a.txt"), "one\nTWO\nthree\n");
	assert.equal((await status(w)).dirty, 1);
	await assert.rejects(merge(w, "merge"), /not committed/);
	commitIn(w.path, "two");
	const s = await status(w);
	assert.deepEqual([s.ahead, s.behind, s.merged, s.dirty], [1, 0, false, 0]);

	const ff = await merge(w, "merge");
	assert.equal(ff.how, "ff");
	assert.equal(ff.updated, dir);
	assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one\nTWO\nthree\n", "the main checkout's files moved with main");
	assert.equal((await status(w)).merged, true);

	// main moves on meanwhile: a merge commit, then a squash.
	fs.writeFileSync(path.join(dir, "src", "app.ts"), "export const answer = 42;\n");
	commitIn(dir, "main moves");
	fs.writeFileSync(path.join(w.path, "a.txt"), "ONE\nTWO\nthree\n");
	commitIn(w.path, "one");
	const m = await merge(w, "merge");
	assert.equal(m.how, "merge");
	assert.equal(git("log", "-1", "--format=%P").trim().split(" ").length, 2);
	assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "ONE\nTWO\nthree\n");

	fs.writeFileSync(path.join(w.path, "a.txt"), "ONE\nTWO\nTHREE\n");
	commitIn(w.path, "three");
	const sq = await merge(w, "squash");
	assert.equal(sq.how, "squash");
	assert.equal(git("log", "-1", "--format=%P").trim().split(" ").length, 1);
	assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "ONE\nTWO\nTHREE\n");
	w.squashed = (await status(w)).head;
	assert.equal((await status(w)).merged, true);

	// Both change the same line: refused, and neither main nor its files nor the worktree changed.
	fs.writeFileSync(path.join(dir, "a.txt"), "ONE\nTWO\nmain\n");
	commitIn(dir, "main three");
	fs.writeFileSync(path.join(w.path, "a.txt"), "ONE\nTWO\nwork\n");
	commitIn(w.path, "work three");
	const before = git("rev-parse", "main");
	const err = await merge(w, "merge").catch((e) => e);
	assert.ok(err instanceof Conflict, String(err));
	assert.deepEqual(err.files, ["a.txt"]);
	assert.equal(git("rev-parse", "main"), before);
	assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "ONE\nTWO\nmain\n");

	// Updating the worktree from main: a conflict is left to nobody, the worktree stays as it was.
	const u = await update(w);
	assert.deepEqual(u, { conflicts: ["a.txt"] });
	assert.equal(fs.readFileSync(path.join(w.path, "a.txt"), "utf8"), "ONE\nTWO\nwork\n");
	assert.equal(execFileSync("git", ["-C", w.path, "status", "--porcelain"]).toString(), "");
});

test("worktrees: a merge stops where it would overwrite a change in the main checkout", boxed, async (t) => {
	const { dir, git } = repository(t);
	const w = await make({ folder: dir, name: "x", kind: "conversation" });
	fs.writeFileSync(path.join(w.path, "a.txt"), "changed\n");
	commitIn(w.path, "x");
	fs.writeFileSync(path.join(dir, "a.txt"), "mine, not committed\n");
	const before = git("rev-parse", "main");
	await assert.rejects(merge(w, "merge"), /checked out in .*\n[\s\S]*Nothing was changed/);
	assert.equal(git("rev-parse", "main"), before);
	assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "mine, not committed\n");

	// Not checked out anywhere: only its ref moves.
	git("checkout", "-q", "-b", "elsewhere");
	fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\nthree\n");
	const r = await merge(w, "merge");
	assert.equal(r.updated, undefined);
	assert.equal(git("rev-parse", "main"), git("rev-parse", "pine/x"));
});

test("worktrees: filters, merge drivers and hooks the repository names never run in pine's git calls", boxed, async (t) => {
	const { dir, git } = repository(t);
	const ran = path.join(dir, "..", `${path.basename(dir)}-ran`);
	t.after(() => fs.rmSync(ran, { force: true }));
	fs.writeFileSync(path.join(dir, ".gitattributes"), "*.txt filter=evil merge=evil\n");
	git("add", ".gitattributes");
	git("commit", "-q", "-m", "attributes");
	git("config", "filter.evil.process", `sh -c 'touch ${ran}; exit 1'`);
	git("config", "filter.evil.smudge", `sh -c 'touch ${ran}; cat'`);
	git("config", "filter.evil.clean", `sh -c 'touch ${ran}; cat'`);
	git("config", "filter.evil.required", "true");
	git("config", "merge.evil.driver", `sh -c 'touch ${ran}; exit 0'`);
	fs.mkdirSync(path.join(dir, ".git", "hooks"), { recursive: true });
	for (const hook of ["post-checkout", "post-merge", "pre-commit", "post-commit"]) fs.writeFileSync(path.join(dir, ".git", "hooks", hook), `#!/bin/sh\ntouch ${ran}\n`, { mode: 0o755 });

	const w = await make({ folder: dir, name: "x", kind: "task" });
	fs.writeFileSync(path.join(w.path, "a.txt"), "x\n");
	fs.writeFileSync(path.join(dir, "src", "app.ts"), "moved\n");
	execFileSync("git", ["-C", dir, "-c", "core.hooksPath=/dev/null", "-c", "filter.evil.process=", "-c", "filter.evil.required=false", "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qam", "main moves"], { stdio: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
	const done = await finish(w, "a task");
	assert.equal(done.commits, 1);
	assert.equal(done.branch, "pine/x");
	assert.ok(!fs.existsSync(w.path), "the folder is gone, the branch stays");
	assert.ok(!fs.existsSync(ran), "nothing the repository named was run");
});

test("worktrees: a task that changed nothing leaves nothing; removing one takes its branch unless it is kept", boxed, async (t) => {
	const { dir, git } = repository(t);
	const w = await make({ folder: dir, name: "idle", kind: "task" });
	assert.deepEqual(await finish(w, "nothing"), { branch: undefined, commits: 0, files: [] });
	assert.equal(git("branch", "--list", "pine/*").trim(), "");
	assert.deepEqual(await listed(dir), []);

	const k = await make({ folder: dir, name: "kept", kind: "conversation" });
	fs.writeFileSync(path.join(k.path, "new.txt"), "x");
	await remove(k, { keepBranch: true });
	assert.ok(!fs.existsSync(k.path));
	assert.match(git("branch", "--list", "pine/*"), /pine\/kept/);
	const g = await make({ folder: dir, name: "gone", kind: "conversation" });
	await remove(g);
	assert.doesNotMatch(git("branch", "--list", "pine/*"), /pine\/gone/);
});

const call = (name: string, args: any) => ({ name, args });
const bash = (command: string) => call("bash", { command });
/** git as an agent runs it in its shell: its home is its own, so the name and address are given. */
const agentGit = "git -c user.name=agent -c user.email=agent@example.com -c commit.gpgsign=false";

test("worktrees: a conversation in one commits on its branch and reaches nothing else of the repository; one in the main checkout cannot write it", boxed, async (t) => {
	const { dir, git } = repository(t);
	const h = await harness({ agents: { main: {} } });
	t.after(() => h.close());
	const run = (session: string, steps: any[]) => h.pine.agents.run({ agent: "main", prompt: mockMsg(steps), session, trust: "owner" });
	await h.pine.agents.setFolder("main", "fix", path.join(dir, "src"));
	await assert.rejects(h.pine.agents.makeWorktree("main", "nothing"), /has no folder/);
	const made = await h.pine.agents.makeWorktree("main", "fix");
	assert.equal(made.branch, "pine/fix");
	assert.equal(made.folder, path.join(dir, ".pine", "worktrees", "fix", "src"), "the folder it had, in the worktree");
	assert.equal(h.pine.agents.folderOf("main", "fix"), made.folder);
	assert.deepEqual(h.pine.agents.conversations("main").find((c) => c.session === "fix"), undefined, "nothing said yet");
	await assert.rejects(h.pine.agents.makeWorktree("main", "fix"), /works in the worktree pine\/fix already/);
	await assert.rejects(h.pine.agents.setFolder("main", "fix", dir), /works in the worktree pine\/fix/);

	// Its git works: a commit lands on its branch, and nowhere else.
	await run("fix", [{ tools: [bash(`pwd; echo 42 > app.ts && ${agentGit} commit -qam "answer" && git log --oneline -1`)] }]);
	assert.match(h.toolResults().at(-1)!, /answer/, h.toolResults().at(-1)!);
	assert.match(git("log", "-1", "--format=%s", "pine/fix"), /answer/);
	assert.match(git("log", "-1", "--format=%s", "main"), /first/);

	// What is not its own: the main checkout, the repository's configuration and hooks, another
	// branch, its own pointer to the git folder.
	// Writing a repository's configuration is a critical action and is put to the owner: here the
	// owner says yes, and what keeps it out is the sandbox.
	h.pine.bus.subscribe("approval/requested", (e) => void h.pine.approvals.decide((e.payload as any).id, true, "test"));
	const before = { main: git("rev-parse", "main"), config: fs.readFileSync(path.join(dir, ".git", "config"), "utf8"), pointer: fs.readFileSync(path.join(made.path, ".git"), "utf8") };
	await run("fix", [
		{
			tools: [
				bash(`echo x > ${dir}/a.txt`),
				bash(`echo "[core]" | tee -a ${dir}/.git/config`),
				bash(`mkdir -p ${dir}/.git/hooks; echo x > ${dir}/.git/hooks/post-checkout`),
				bash("git update-ref refs/heads/main HEAD"),
				bash(`echo "gitdir: /tmp" > ${made.path}/.git`),
				call("write", { path: path.join(made.path, ".git"), content: "gitdir: /tmp\n" }),
			],
		},
	]);
	const out = h.toolResults().slice(-6);
	for (const [i, o] of out.entries()) assert.match(o, i === 5 ? /tells git where this worktree's repository is/ : refused, `${i}: ${o}`);
	assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one\ntwo\nthree\n");
	assert.equal(fs.readFileSync(path.join(dir, ".git", "config"), "utf8"), before.config);
	assert.ok(!fs.existsSync(path.join(dir, ".git", "hooks", "post-checkout")));
	assert.equal(git("rev-parse", "main"), before.main);
	assert.equal(fs.readFileSync(path.join(made.path, ".git"), "utf8"), before.pointer);

	// A conversation in the main checkout writes there, and not into the worktree.
	await h.pine.agents.setFolder("main", "top", dir);
	await run("top", [{ tools: [bash(`echo top > top.txt; echo x > .pine/worktrees/fix/src/app.ts`), call("write", { path: ".pine/worktrees/fix/new.txt", content: "x" })] }]);
	assert.equal(fs.readFileSync(path.join(dir, "top.txt"), "utf8"), "top\n");
	assert.match(h.toolResults().at(-2)!, refused);
	assert.match(h.toolResults().at(-1)!, /worktree of another conversation/);
	assert.equal(fs.readFileSync(path.join(made.path, "src", "app.ts"), "utf8"), "42\n");
	assert.ok(!fs.existsSync(path.join(made.path, "new.txt")));
});

test("worktrees: the owner merges one into main, renaming keeps it, and a removed conversation leaves it only when it holds work", boxed, async (t) => {
	const { dir, git } = repository(t);
	const h = await harness({ agents: { main: {} } });
	t.after(() => h.close());
	const run = (session: string, steps: any[]) => h.pine.agents.run({ agent: "main", prompt: mockMsg(steps), session, trust: "owner" });
	await h.pine.agents.setFolder("main", "a", dir);
	const w = await h.pine.agents.makeWorktree("main", "a", { name: "first try" });
	assert.equal(w.branch, "pine/first-try");
	await run("a", [{ tools: [bash(`echo NEW > a.txt && ${agentGit} commit -qam work`)] }]);
	const s = await h.pine.agents.worktreeStatus("main", "a");
	assert.deepEqual([s?.ahead, s?.behind, s?.dirty, s?.merged], [1, 0, 0, false]);
	assert.deepEqual(h.pine.agents.conversations("main").find((c) => c.session === "a")?.worktree, { branch: "pine/first-try", base: "main", path: w.path, repo: dir });

	// Renamed, it keeps it; merged, main has the work; listed with the conversation.
	await h.pine.agents.renameSession("main", "a", "b");
	assert.equal(h.pine.agents.worktreeOf("main", "b")?.branch, "pine/first-try");
	const m = await h.pine.agents.mergeWorktree("main", "b");
	assert.equal(m.how, "ff");
	assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "NEW\n");
	assert.deepEqual((await h.pine.agents.listWorktrees()).map((l) => [l.session, l.branch, l.orphan]), [["b", "pine/first-try", undefined]]);

	// Removed with the conversation once everything of it is merged.
	assert.equal((await h.pine.agents.removeSession("main", "b")).worktree, undefined);
	assert.ok(!fs.existsSync(w.path));
	assert.equal(git("branch", "--list", "pine/*").trim(), "");

	// One with work in it stays where it is, and is listed as nobody's.
	await h.pine.agents.setFolder("main", "c", dir);
	const c = await h.pine.agents.makeWorktree("main", "c");
	await run("c", [{ tools: [bash("echo half > half.txt")] }]);
	assert.equal((await h.pine.agents.removeSession("main", "c")).worktree, c.path);
	assert.ok(fs.existsSync(path.join(c.path, "half.txt")));
	assert.deepEqual((await h.pine.agents.listWorktrees()).map((l) => [l.branch, l.orphan]), [["pine/c", true]]);

	// Discarded: gone with its branch, and the conversation works in the folder it came from again.
	await h.pine.agents.setFolder("main", "d", path.join(dir, "src"));
	await h.pine.agents.makeWorktree("main", "d");
	assert.deepEqual(await h.pine.agents.discardWorktree("main", "d"), { folder: path.join(dir, "src") });
	assert.equal(h.pine.agents.worktreeOf("main", "d"), undefined);
	assert.doesNotMatch(git("branch", "--list", "pine/*"), /pine\/d\b/);
});

test("worktrees: a conversation is branched into a worktree of its own", boxed, async (t) => {
	const { dir } = repository(t);
	const h = await harness({ agents: { main: {} } });
	t.after(() => h.close());
	await h.pine.agents.setFolder("main", "s", dir);
	await h.pine.agents.run({ agent: "main", prompt: `start ${mockMsg([{ text: "ok" }])}`, session: "s", trust: "owner" });
	const b = await h.pine.agents.branchSession("main", "s", undefined, undefined, { worktree: true });
	assert.equal(b.session, "s-branch");
	assert.equal(b.worktree?.branch, "pine/s-branch");
	assert.equal(h.pine.agents.folderOf("main", "s-branch"), b.worktree!.path);
	assert.equal(h.pine.agents.folderOf("main", "s"), dir, "the original stays where it was");
});

test("worktrees: sub-agents with worktree:true change the same file apart, and their work comes back as branches", boxed, async (t) => {
	const { dir, git } = repository(t);
	const h = await harness({ agents: { main: {} } });
	t.after(() => h.close());
	await h.pine.agents.setFolder("main", "w", dir);
	h.mock.state.scripts.one = [{ tools: [bash("pwd; echo ONE > a.txt")] }, { text: "one done" }];
	h.mock.state.scripts.two = [{ tools: [bash("echo TWO > a.txt; echo new > two.txt")] }, { text: "two done" }];
	h.mock.state.scripts.idle = [{ tools: [bash("cat a.txt")] }, { text: "looked" }];
	await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("subagent", { tasks: ["@@REF:one@@", "@@REF:two@@", "@@REF:idle@@"], worktree: true })] }]), session: "w", trust: "owner" });
	const said = h.toolResults().at(-1)!;
	assert.match(said, /Sub-task 1: done[\s\S]*branch pine\/w-sub \(1 commit; a\.txt\)[\s\S]*git merge pine\/w-sub/, said);
	assert.match(said, /Sub-task 2: done[\s\S]*branch pine\/w-sub-2 \(1 commit; a\.txt, two\.txt\)/, said);
	assert.match(said, /Sub-task 3: done[\s\S]*changed no file/, said);
	assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one\ntwo\nthree\n", "the conversation's folder is as it was");
	assert.equal(git("show", "pine/w-sub:a.txt"), "ONE\n");
	assert.equal(git("show", "pine/w-sub-2:a.txt"), "TWO\n");
	assert.deepEqual(fs.readdirSync(path.join(dir, ".pine", "worktrees")), [], "their folders are gone");
	assert.doesNotMatch(git("branch", "--list", "pine/*"), /pine\/w-sub-3/);

	// The conversation brings one in with its own git.
	await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [bash(`${agentGit} merge -q pine/w-sub && ${agentGit} branch -d pine/w-sub && cat a.txt`)] }]), session: "w", trust: "owner" });
	assert.match(h.toolResults().at(-1)!, /ONE/, h.toolResults().at(-1)!);
	assert.doesNotMatch(git("branch", "--list", "pine/*"), /pine\/w-sub\n/);

	// Without a folder there is nothing to make one of; and a run from outside is not offered it.
	await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("subagent", { tasks: ["x"], worktree: true })] }]), session: "nofolder", trust: "owner" });
	assert.match(h.toolResults().at(-1)!, /has no folder/);
	await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ text: "hi" }]), session: "out", trust: "untrusted" });
	const offered = h.mock.state.requests.at(-1).body.tools.find((x: any) => x.function?.name === "subagent");
	assert.ok(!JSON.stringify(offered ?? {}).includes("worktree"), "no worktree for a run from outside");
});

test("tui: /worktree moves a conversation into one, the bar names its branch, and the owner merges it from there", boxed, async (t) => {
	const { PineTui } = await import("../src/tui/app.ts");
	const { Client } = await import("../src/tui/client.ts");
	const { FakeTerminal, KEY } = await import("./support/terminal.ts");
	const { sleep, until } = await import("./support/harness.ts");
	const { dir, git } = repository(t);
	const h = await harness({ pine: { main: "main", http: { port: 0 } }, agents: { main: {} } });
	const term = new FakeTerminal(130, 36);
	const client = new Client(`http://127.0.0.1:${h.pine.http!.port}`, h.pine.token);
	const app = new PineTui({ client, terminal: term, mode: "test", cwd: dir });
	t.after(async () => {
		await app.stop().catch(() => {});
		await h.close();
	});
	await app.start();
	const text = () => app.screen().join("\n");
	const sees = (what: string | RegExp, ms = 6000) => until(() => (typeof what === "string" ? text().includes(what) : what.test(text())), ms, `the screen to show ${what}\n--- screen ---\n${text()}`);
	const send = async (line: string) => {
		term.type(line);
		term.type(["\r"]);
		await sleep(15);
	};

	await app.openFolder(dir, "try");
	await sees("now works in the worktree pine/try");
	await sees(/⎇ pine\/try/);
	assert.equal((await client.worktree("main", "try")).worktree?.branch, "pine/try");
	await send(mockMsg([{ tools: [bash(`echo MERGED > a.txt && ${agentGit} commit -qam work`)] }, { text: "committed" }]));
	await until(() => !text().includes("working ·") && git("log", "-1", "--format=%s", "pine/try").trim() === "work", 8000, "the agent to have committed");
	await until(() => h.pine.agents.status().running.length === 0, 5000, "the run to end");

	await send("/worktree");
	await sees("Merge into main");
	await sees(/1 commit ahead of main/);
	term.type([KEY.enter]);
	await sees(/1 commit of pine\/try merged into main \(a fast-forward\)/);
	assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "MERGED\n");

	// Discarded once merged: no question, and the bar shows the folder again.
	await send("/worktree");
	await sees("Discard the worktree");
	term.type([KEY.enter]);
	await sees("the worktree is gone");
	await until(() => !/⎇/.test(app.screen().at(-1)!), 4000, "the bar to show the folder again");
	assert.doesNotMatch(git("branch", "--list", "pine/*"), /pine\/try/);
});

test("tui: a folder opened and a worktree made for a conversation by another hand show in the bar of a tab that is open", boxed, async (t) => {
	const { PineTui } = await import("../src/tui/app.ts");
	const { Client } = await import("../src/tui/client.ts");
	const { FakeTerminal } = await import("./support/terminal.ts");
	const { until } = await import("./support/harness.ts");
	const { dir } = repository(t);
	const h = await harness({ pine: { main: "main", http: { port: 0 } }, agents: { main: {} } });
	const told: any[] = [];
	h.pine.bus.subscribe("pine/conversation", (e) => void told.push(e.payload));
	const app = new PineTui({ client: new Client(`http://127.0.0.1:${h.pine.http!.port}`, h.pine.token), terminal: new FakeTerminal(130, 36), mode: "test", cwd: dir });
	t.after(async () => {
		await app.stop().catch(() => {});
		await h.close();
	});
	await app.start();
	const bar = () => app.screen().at(-1)!;
	const shows = (what: string | RegExp, why: string) => until(() => (typeof what === "string" ? bar().includes(what) : what.test(bar())), 6000, `${why}\n--- bar ---\n${bar()}`);
	await shows("no folder", "the bar of a conversation without a folder");

	// Another UI on the same daemon (the Pine app, a second terminal): this one is told nothing but that the conversation changed.
	const other = new Client(`http://127.0.0.1:${h.pine.http!.port}`, h.pine.token);
	await other.setFolder("main", "main", dir);
	await shows(path.basename(dir), "the bar to name the folder that was opened elsewhere");
	await other.makeWorktree("main", "main", "elsewhere");
	await shows(/⎇ pine\/elsewhere/, "the bar to name the worktree that was made elsewhere");
	await other.discardWorktree("main", "main");
	await until(() => !/⎇/.test(bar()) && bar().includes(path.basename(dir)), 6000, `the bar to show the folder again\n--- bar ---\n${bar()}`);
	await other.setFolder("main", "main", null);
	await shows("no folder", "the bar to say that the folder was closed elsewhere");

	// What a UI is told names the conversation and nothing of where it works.
	const folders = told.filter((p) => p.change === "folder");
	assert.ok(folders.length >= 4, JSON.stringify(told));
	for (const p of folders) assert.deepEqual(p, { change: "folder", agent: "main", session: "main" });
});
