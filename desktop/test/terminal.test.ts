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
	const runs: Array<RunReport & { id: string }> = [];
	const terms = new Terminals({ data: (id, data) => out.set(id, (out.get(id) ?? "") + data), exit: (id, code) => ended.set(id, code), run: (id, r) => runs.push({ id, ...r }) }, { env: async () => ({ ...process.env, HOME: dir, PS1: "$ " }), hooks: path.join(dir, ".hooks"), shell: [shell], stillRunningMs: 400 });
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
		const first = await w.terms.open("main:okapi", w.dir, 80, 24);
		assert.equal(first.fresh, true);
		assert.equal(first.cwd, w.dir);
		w.terms.write("main:okapi", "pwd; echo done-$((40+2))\r");
		await w.until(() => /done-42/.test(w.out.get("main:okapi") ?? ""));
		assert.match(w.out.get("main:okapi")!, new RegExp(w.dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		// Opened again (the panel drawn again), it is the same shell, with what it printed so far.
		const again = await w.terms.open("main:okapi", "/", 100, 30);
		assert.equal(again.fresh, false);
		assert.equal(again.cwd, w.dir);
		assert.match(again.kept, /done-42/);
		// Another conversation has a shell of its own.
		assert.equal((await w.terms.open("main:other", w.dir, 80, 24)).fresh, true);
		assert.equal(w.terms.has("main:okapi") && w.terms.has("main:other"), true);
	} finally {
		w.done();
	}
});

test("terminal: a shell that ends says so; one that is closed does not, and its name starts a new one", async () => {
	const w = world();
	try {
		await w.terms.open("a:1", w.dir, 80, 24);
		w.terms.write("a:1", "exit 3\r");
		await w.until(() => w.ended.has("a:1"));
		assert.equal(w.ended.get("a:1"), 3);
		assert.equal(w.terms.has("a:1"), false);
		await w.terms.open("a:2", w.dir, 80, 24);
		w.terms.close("a:2");
		await new Promise((r) => setTimeout(r, 200));
		assert.equal(w.ended.has("a:2"), false);
		assert.equal((await w.terms.open("a:2", w.dir, 80, 24)).fresh, true);
	} finally {
		w.done();
	}
});

test("terminal: a name that is not a conversation's, a folder that is not one, and the app's own variables are refused", async () => {
	const w = world();
	try {
		await assert.rejects(w.terms.open("../x y", w.dir, 80, 24), /not a terminal's name/);
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
			await w.terms.open("main:c", w.dir, 80, 24);
			assert.deepEqual(await w.terms.run("main:c", "echo one-$((40+2))\nls /nowhere-at-all\n"), { reports: true });
			await w.until(() => w.runs.length > 0);
			const [r] = w.runs;
			assert.equal(r.state, "ended");
			assert.notEqual(r.code, 0, "the last command of the block failed");
			assert.match(r.output, /one-42/);
			assert.match(r.output, /nowhere-at-all/);
			assert.equal(r.command, "echo one-$((40+2))\nls /nowhere-at-all");
			// What the owner types is theirs: it is not reported.
			w.terms.write("main:c", "echo by-hand\r");
			await w.until(() => /by-hand[\s\S]*by-hand[\s\S]*133;D/.test(w.out.get("main:c") ?? ""));
			await new Promise((res) => setTimeout(res, 500));
			assert.equal(w.runs.length, 1);
			// The history is the owner's, not in the folder of the hooks.
			if (name === "zsh") {
				await w.terms.run("main:c", "echo history-in-$HISTFILE");
				await w.until(() => w.runs.length === 2);
				assert.match(w.runs[1].output, new RegExp(`history-in-${w.dir}/\\.zsh_history`));
				w.runs.pop();
			}
			// One that succeeds says so.
			await w.terms.run("main:c", "true");
			await w.until(() => w.runs.length === 2);
			assert.equal(w.runs[1].code, 0);
		} finally {
			w.done();
		}
	});

	test(`terminal (${name}): a block that runs on is said to be running once, then ended when it is stopped; meanwhile the terminal takes no other block`, async () => {
		const w = world(shell);
		try {
			await w.terms.open("main:s", w.dir, 80, 24);
			await w.terms.run("main:s", "echo serving; sleep 30");
			await w.until(() => w.runs.length > 0);
			assert.equal(w.runs[0].state, "running");
			assert.match(w.runs[0].output, /serving/);
			await assert.rejects(w.terms.run("main:s", "echo another"), /busy with another command/);
			await new Promise((res) => setTimeout(res, 600));
			assert.equal(w.runs.length, 1, "said once");
			w.terms.write("main:s", "\x03");
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
		await w.terms.open("main:p", w.dir, 80, 24);
		assert.deepEqual(await w.terms.run("main:p", "echo plain-ran"), { reports: false });
		await w.until(() => /plain-ran[\s\S]*plain-ran/.test(w.out.get("main:p") ?? ""));
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

test("terminal: shells are isolated per window and move cleanly across windows with transfer", async () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-terminal-win-")));
	const out = new Map<string, string>();
	const ended = new Map<string, number>();
	const runs: Array<RunReport & { id: string; windowId: string }> = [];
	const shellBin = fs.existsSync("/bin/zsh") ? "/bin/zsh" : fs.existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";
	const terms = new Terminals(
		{
			data: (id, data, windowId) => out.set(`${windowId}:${id}`, (out.get(`${windowId}:${id}`) ?? "") + data),
			exit: (id, code, windowId) => ended.set(`${windowId}:${id}`, code),
			run: (id, r, windowId) => runs.push({ id, windowId, ...r }),
		},
		{ env: async () => ({ ...process.env, HOME: dir, PS1: "$ " }), hooks: path.join(dir, ".hooks"), shell: [shellBin], stillRunningMs: 400 },
	);
	const until = async (what: () => boolean, ms = 5000) => {
		const end = Date.now() + ms;
		while (!what()) {
			if (Date.now() > end) throw new Error(`waited in vain; out=${JSON.stringify([...out])}`);
			await new Promise((r) => setTimeout(r, 20));
		}
	};
	try {
		// Two windows open the same conversation key independently and run separate shells.
		const firstW1 = await terms.open("main:shared", dir, 80, 24, "w1");
		const firstW2 = await terms.open("main:shared", dir, 100, 30, "w2");
		assert.equal(firstW1.fresh, true);
		assert.equal(firstW2.fresh, true);
		assert.equal(terms.has("main:shared", "w1"), true);
		assert.equal(terms.has("main:shared", "w2"), true);
		assert.equal(terms.has("main:shared"), false);

		terms.write("main:shared", "WIN_TAG=one; echo from-w1-$((10+1))\r", "w1");
		terms.write("main:shared", "WIN_TAG=two; echo from-w2-$((20+2))\r", "w2");
		await until(() => /from-w1-11/.test(out.get("w1:main:shared") ?? "") && /from-w2-22/.test(out.get("w2:main:shared") ?? ""));
		assert.doesNotMatch(out.get("w1:main:shared") ?? "", /from-w2-22/);
		assert.doesNotMatch(out.get("w2:main:shared") ?? "", /from-w1-11/);

		// Resizing w2 does not resize w1.
		terms.resize("main:shared", 132, 40, "w2");
		terms.write("main:shared", "stty size\r", "w1");
		terms.write("main:shared", "stty size\r", "w2");
		await until(() => /24 80/.test(out.get("w1:main:shared") ?? "") && /40 132/.test(out.get("w2:main:shared") ?? ""));

		// Closing w2's shells leaves w1's shell alive.
		terms.closeWindow("w2");
		assert.equal(terms.has("main:shared", "w2"), false);
		assert.equal(terms.has("main:shared", "w1"), true);

		// Transferring main:shared from w1 to w3 moves the live shell, its kept output, and future events to w3.
		assert.equal(terms.transfer("w1", "w3", "main:missing"), false);
		assert.equal(terms.transfer("w1", "w3", "main:shared"), true);
		assert.equal(terms.has("main:shared", "w1"), false);
		assert.equal(terms.has("main:shared", "w3"), true);

		// Closing w1 after transfer does not affect the transferred shell in w3.
		terms.closeWindow("w1");
		const reopenedInW3 = await terms.open("main:shared", "/", 90, 28, "w3");
		assert.equal(reopenedInW3.fresh, false);
		assert.equal(reopenedInW3.cwd, dir);
		assert.match(reopenedInW3.kept, /from-w1-11/);

		const w1Before = out.get("w1:main:shared") ?? "";
		terms.write("main:shared", "echo moved-$WIN_TAG\r", "w3");
		await until(() => /moved-one/.test(out.get("w3:main:shared") ?? ""));
		assert.equal(out.get("w1:main:shared") ?? "", w1Before);

		if (shellBin !== "/bin/sh") {
			await terms.run("main:shared", "echo run-in-w3-$WIN_TAG", "w3");
			await until(() => runs.length === 1);
			assert.equal(runs[0].windowId, "w3");
			assert.match(runs[0].output, /run-in-w3-one/);
		}

		// Natural exit routes to w3.
		terms.write("main:shared", "exit 7\r", "w3");
		await until(() => ended.has("w3:main:shared"));
		assert.equal(ended.get("w3:main:shared"), 7);
		assert.equal(ended.has("w1:main:shared"), false);
	} finally {
		terms.closeAll();
		fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});
