// The owner's terminal beside a conversation (electron/terminal.ts) and what an answer's Run button
// may type into it (src/runnable.ts). Without a window: a real pseudo-terminal with /bin/sh, in a
// folder of the test's own.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { MarkReader } from "../electron/shell-hooks.ts";
import { type RunReport, shellEnv, startIn, Terminals } from "../electron/terminal.ts";
import { runnable } from "../src/runnable.ts";

function world(shell = "/bin/sh") {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-terminal-")));
	const out = new Map<string, string>();
	const ended = new Map<string, number>();
	const runs: Array<RunReport & { windowId: number; id: string }> = [];
	const key = (windowId: number, id: string) => `${windowId}:${id}`;
	const terms = new Terminals(
		{
			data: (windowId, id, data) => out.set(key(windowId, id), (out.get(key(windowId, id)) ?? "") + data),
			exit: (windowId, id, code) => ended.set(key(windowId, id), code),
			run: (windowId, id, r) => runs.push({ windowId, id, ...r }),
		},
		{ env: async () => ({ ...process.env, HOME: dir, PS1: "$ " }), hooks: path.join(dir, ".hooks"), shell: [shell], stillRunningMs: 400 },
	);
	const until = async (what: () => boolean, ms = 5000) => {
		const end = Date.now() + ms;
		while (!what()) {
			if (Date.now() > end) throw new Error(`waited in vain; the terminal says: ${JSON.stringify([...out])}`);
			await new Promise((r) => setTimeout(r, 20));
		}
	};
	return { dir, out, ended, runs, terms, until, done: () => (terms.closeAll(), fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })) };
}

test("terminal: a shell starts in the folder it is given, runs what is typed, and is handed back with what it printed", async () => {
	const w = world();
	try {
		const first = await w.terms.open(1, "main:okapi", w.dir, 80, 24);
		assert.equal(first.fresh, true);
		assert.equal(first.cwd, w.dir);
		w.terms.write(1, "main:okapi", "pwd; echo done-$((40+2))\r");
		await w.until(() => /done-42/.test(w.out.get("1:main:okapi") ?? ""));
		assert.match(w.out.get("1:main:okapi")!, new RegExp(w.dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		// Opened again (the panel drawn again), it is the same shell, with what it printed so far.
		const again = await w.terms.open(1, "main:okapi", "/", 100, 30);
		assert.equal(again.fresh, false);
		assert.equal(again.cwd, w.dir);
		assert.match(again.kept, /done-42/);
		// Another conversation has a shell of its own.
		assert.equal((await w.terms.open(1, "main:other", w.dir, 80, 24)).fresh, true);
		assert.equal(w.terms.has(1, "main:okapi") && w.terms.has(1, "main:other"), true);
	} finally {
		w.done();
	}
});

test("terminal: a shell that ends says so; one that is closed does not, and its name starts a new one", async () => {
	const w = world();
	try {
		await w.terms.open(1, "a:1", w.dir, 80, 24);
		w.terms.write(1, "a:1", "exit 3\r");
		await w.until(() => w.ended.has("1:a:1"));
		assert.equal(w.ended.get("1:a:1"), 3);
		assert.equal(w.terms.has(1, "a:1"), false);
		await w.terms.open(1, "a:2", w.dir, 80, 24);
		w.terms.close(1, "a:2");
		await new Promise((r) => setTimeout(r, 200));
		assert.equal(w.ended.has("1:a:2"), false);
		assert.equal((await w.terms.open(1, "a:2", w.dir, 80, 24)).fresh, true);
	} finally {
		w.done();
	}
});

test("terminal: a name that is not a conversation's, a folder that is not one, and the app's own variables are refused", async () => {
	const w = world();
	try {
		await assert.rejects(w.terms.open(1, "../x y", w.dir, 80, 24), /not a terminal's name/);
		assert.equal(startIn(path.join(w.dir, "missing")), os.homedir());
		assert.equal(startIn("relative/path"), os.homedir());
		assert.equal(startIn(w.dir), w.dir);
		const env = shellEnv({ PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1", PINE_DESKTOP_DATA: "/x", NODE_OPTIONS: "--inspect", HOME: "/h" });
		assert.deepEqual([env.PATH, env.HOME, env.TERM], ["/usr/bin", "/h", "xterm-256color"]);
		assert.equal("ELECTRON_RUN_AS_NODE" in env || "PINE_DESKTOP_DATA" in env || "NODE_OPTIONS" in env, false);
	} finally {
		w.done();
	}
});

test("terminal: shells are scoped by (windowId, conversationId), isolated on closeWindow, and transferable without losing state", async () => {
	const w = world();
	try {
		const a = await w.terms.open(1, "main:shared", w.dir, 80, 24);
		const b = await w.terms.open(2, "main:shared", w.dir, 80, 24);
		assert.equal(a.fresh, true);
		assert.equal(b.fresh, true);

		w.terms.write(1, "main:shared", "MARKER=win1; echo $MARKER\r");
		w.terms.write(2, "main:shared", "MARKER=win2; echo $MARKER\r");
		await w.until(() => /win1/.test(w.out.get("1:main:shared") ?? "") && /win2/.test(w.out.get("2:main:shared") ?? ""));
		assert.doesNotMatch(w.out.get("1:main:shared")!, /win2/);
		assert.doesNotMatch(w.out.get("2:main:shared")!, /win1/);

		// Closing window 2's terminals leaves window 1's shell running and unaffected.
		w.terms.closeWindow(2);
		assert.equal(w.terms.has(2, "main:shared"), false);
		assert.equal(w.terms.has(1, "main:shared"), true);
		w.terms.write(1, "main:shared", "echo still-$MARKER\r");
		await w.until(() => /still-win1/.test(w.out.get("1:main:shared") ?? ""));

		// Transferring window 1's shell to window 3 preserves scrollback and live shell state, routing future events to window 3 only.
		assert.equal(w.terms.transfer(1, 3, "main:shared"), true);
		assert.equal(w.terms.has(1, "main:shared"), false);
		assert.equal(w.terms.has(3, "main:shared"), true);
		const moved = await w.terms.open(3, "main:shared", "/", 100, 30);
		assert.equal(moved.fresh, false);
		assert.match(moved.kept, /still-win1/);

		const win1Before = w.out.get("1:main:shared") ?? "";
		w.terms.write(3, "main:shared", "echo after-move-$MARKER; exit 7\r");
		await w.until(() => w.ended.has("3:main:shared"));
		assert.match(w.out.get("3:main:shared") ?? "", /after-move-win1/);
		assert.equal(w.ended.get("3:main:shared"), 7);
		assert.equal(w.ended.has("1:main:shared"), false);
		assert.equal(w.out.get("1:main:shared"), win1Before, "old window should receive no data after transfer");
	} finally {
		w.done();
	}
});

test("runnable: a block is run as it is shown, and one that holds what does not show is refused", () => {
	assert.deepEqual(runnable("npm test\n"), { ok: true, text: "npm test" });
	assert.deepEqual(runnable("cd x\r\nls\n\n"), { ok: true, text: "cd x\nls" });
	assert.deepEqual(runnable("for f in *; do\n\techo $f\ndone"), { ok: true, text: "for f in *; do\n\techo $f\ndone" });
	assert.deepEqual(runnable("echo héllo 🌲"), { ok: true, text: "echo héllo 🌲" });
	assert.equal(runnable("  \n").ok, false);
	// An escape sequence, a lone carriage return (which would run what is before it), a backspace, a
	// direction override, a joiner of no width, a line separator and a tag character.
	for (const hidden of ["\x1b[2K", "\r", "\b", "\u202E", "\u200B", "\u2028", "\u{E0041}", "\x00", "\u0085"]) {
		const r = runnable(`echo safe${hidden}rm -rf ~`);
		assert.equal(r.ok, false, JSON.stringify(hidden));
		assert.match((r as { why: string }).why, /does not show as itself \(U\+[0-9A-F]{4,6}\)/);
	}
});

for (const shell of ["/bin/bash", "/bin/zsh"].filter((s) => fs.existsSync(s))) {
	const name = path.basename(shell);
	test(`terminal (${name}): a block run with its button says when it has ended, how, and what it printed`, async () => {
		const w = world(shell);
		try {
			await w.terms.open(1, "main:c", w.dir, 80, 24);
			assert.deepEqual(await w.terms.run(1, "main:c", "echo one-$((40+2))\nls /nowhere-at-all\n"), { reports: true });
			await w.until(() => w.runs.length > 0);
			const [r] = w.runs;
			assert.equal(r.windowId, 1);
			assert.equal(r.state, "ended");
			assert.notEqual(r.code, 0, "the last command of the block failed");
			assert.match(r.output, /one-42/);
			assert.match(r.output, /nowhere-at-all/);
			assert.equal(r.command, "echo one-$((40+2))\nls /nowhere-at-all");
			// What the owner types is theirs: it is not reported.
			w.terms.write(1, "main:c", "echo by-hand\r");
			await w.until(() => /by-hand[\s\S]*by-hand[\s\S]*133;D/.test(w.out.get("1:main:c") ?? ""));
			await new Promise((res) => setTimeout(res, 500));
			assert.equal(w.runs.length, 1);
			// The history is the owner's, not in the folder of the hooks.
			if (name === "zsh") {
				await w.terms.run(1, "main:c", "echo history-in-$HISTFILE");
				await w.until(() => w.runs.length === 2);
				assert.match(w.runs[1].output, new RegExp(`history-in-${w.dir}/\\.zsh_history`));
				w.runs.pop();
			}
			// One that succeeds says so.
			await w.terms.run(1, "main:c", "true");
			await w.until(() => w.runs.length === 2);
			assert.equal(w.runs[1].code, 0);
		} finally {
			w.done();
		}
	});

	test(`terminal (${name}): a block that runs on is said to be running once, then ended when it is stopped; meanwhile the terminal takes no other block`, async () => {
		const w = world(shell);
		try {
			await w.terms.open(1, "main:s", w.dir, 80, 24);
			await w.terms.run(1, "main:s", "echo serving; sleep 30");
			await w.until(() => w.runs.length > 0);
			assert.equal(w.runs[0].state, "running");
			assert.match(w.runs[0].output, /serving/);
			await assert.rejects(w.terms.run(1, "main:s", "echo another"), /busy with another command/);
			await new Promise((res) => setTimeout(res, 600));
			assert.equal(w.runs.length, 1, "said once");
			w.terms.write(1, "main:s", "\x03");
			await w.until(() => w.runs.length === 2);
			assert.equal(w.runs[1].state, "ended");
			assert.equal(w.runs[1].code, 130);
		} finally {
			w.done();
		}
	});
}

test("terminal: a shell without the hooks runs the block and says it will not report", async () => {
	const w = world("/bin/sh");
	try {
		await w.terms.open(1, "main:p", w.dir, 80, 24);
		assert.deepEqual(await w.terms.run(1, "main:p", "echo plain-ran"), { reports: false });
		await w.until(() => /plain-ran[\s\S]*plain-ran/.test(w.out.get("1:main:p") ?? ""));
		assert.equal(w.runs.length, 0);
	} finally {
		w.done();
	}
});

test("marks: read out of output however it is cut", () => {
	const r = new MarkReader();
	const text = "a\x1b]133;C\x07out\x1b]133;D;2\x07\x1b]0;title\x07b";
	const pieces = [...text].flatMap((ch) => r.read(ch));
	const marks = pieces.filter((p) => typeof p !== "string");
	assert.deepEqual(marks, [{ kind: "C", code: undefined }, { kind: "D", code: 2 }]);
	assert.equal(pieces.filter((p) => typeof p === "string").join(""), "aout\x1b]0;title\x07b");
});
