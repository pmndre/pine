// The owner's terminal beside a conversation (electron/terminal.ts) and what an answer's Run button
// may type into it (src/runnable.ts). Without a window: a real pseudo-terminal with /bin/sh (bash
// and zsh where they are installed; PowerShell on Windows), in a folder of the test's own.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { MarkReader, withHooks } from "../electron/shell-hooks.ts";
import { ownShell, type RunReport, shellEnv, shellKeeps, startIn, Terminals } from "../electron/terminal.ts";
import { runnable } from "../src/runnable.ts";

/** The tests that type POSIX shell into the terminal: a POSIX shell there is not, on Windows. */
const posix = process.platform === "win32" ? "Windows has no /bin/sh: PowerShell is tested below" : false;

function world(shell = "/bin/sh", stillRunningMs = 400) {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-terminal-")));
	const out = new Map<string, string>();
	const ended = new Map<string, number>();
	const runs: Array<RunReport & { id: string }> = [];
	// What a terminal answers by itself: PowerShell asks where the cursor is (DSR, ESC [6n) and waits
	// for the answer, which xterm.js gives in the app. Here nothing draws, so the cursor is at the top.
	const terms: Terminals = new Terminals({ data: (id, data) => (out.set(id, (out.get(id) ?? "") + data), data.split("\x1b[6n").slice(1).forEach(() => terms.write(id, "\x1b[1;1R"))), exit: (id, code) => ended.set(id, code), run: (id, r) => runs.push({ id, ...r }) }, { env: async () => ({ ...process.env, HOME: dir, PS1: "$ " }), hooks: path.join(dir, ".hooks"), shell: [shell], stillRunningMs });
	const until = async (what: () => boolean, ms = 5000) => {
		// (GitHub's runners are slower than a desk: PINE_TEST_PATIENCE there.)
		const end = Date.now() + ms * Math.max(1, Number(process.env.PINE_TEST_PATIENCE) || 1);
		while (!what()) {
			if (Date.now() > end) throw new Error(`waited in vain; the terminal says: ${JSON.stringify([...out])}`);
			await new Promise((r) => setTimeout(r, 20));
		}
	};
	return { dir, out, ended, runs, terms, until, done: () => (terms.closeAll(), fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })) };
}

test("terminal: a shell starts in the folder it is given, runs what is typed, and is handed back with what it printed", { skip: posix }, async () => {
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

test("terminal: a shell that ends says so; one that is closed does not, and its name starts a new one", { skip: posix }, async () => {
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

test("terminal: a name that is not a conversation's, a folder that is not one, and the app's own variables are refused", { skip: posix }, async () => {
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
			// The output's line, then the end of the command. (Its echo may be redrawn in pieces as it is typed: zsh on a slow machine.)
			await w.until(() => /(\x07|\n)by-hand\r?\n[\s\S]*133;D/.test(w.out.get("main:c") ?? ""));
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

test("terminal: a shell without the hooks runs the block and says it will not report", { skip: posix }, async () => {
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

test("marks: another integration's, with more after the code (WezTerm's aid), give the code", () => {
	assert.deepEqual(new MarkReader().read("\x1b]133;C;\x07\x1b]133;D;1;aid=4125891\x07\x1b]133;A;cl=m;aid=4125891\x07"), [{ kind: "C", code: undefined }, { kind: "D", code: 1 }, { kind: "A", code: undefined }]);
});

// The owner's prompt marks after pine's hooks, as WezTerm's integration does in every login shell where its package is
// installed (/etc/profile.d/wezterm.sh), whatever the terminal: with the code and more after it, or with no code at all.
for (const [kind, mark] of [["WezTerm's D;<code>;aid=<pid>", "%{\\e]133;D;%?;aid=4125891\\a%}"], ["a bare D", "%{\\e]133;D\\a%}"]] as const) {
	test(`terminal (zsh): a block's code is known when the owner's prompt marks too, after pine (${kind})`, { skip: !fs.existsSync("/bin/zsh") && "no zsh" }, async () => {
		const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-terminal-")));
		fs.writeFileSync(path.join(dir, ".zshrc"), `PS1=$'${mark}$ '\n`);
		const runs: RunReport[] = [];
		// The owner's own shell (no shell named), so that it reads its startup files: those of the folder ZDOTDIR names. (WezTerm's
		// own, where it is installed, would mark too: here only the prompt above does.)
		const terms = new Terminals({ data: () => {}, exit: () => {}, run: (_id, r) => runs.push(r) }, { env: async () => ({ ...process.env, SHELL: "/bin/zsh", HOME: dir, ZDOTDIR: dir, WEZTERM_SHELL_SKIP_ALL: "1" }), hooks: path.join(dir, ".hooks"), stillRunningMs: 5000 });
		try {
			await terms.open("main:marks", dir, 80, 24);
			for (const [command, code] of [["false", 1], ["true", 0]] as const) {
				const before = runs.length;
				await terms.run("main:marks", command);
				for (let i = 0; i < 250 && !runs.slice(before).some((r) => r.state === "ended"); i++) await new Promise((r) => setTimeout(r, 20));
				assert.equal(runs.slice(before).find((r) => r.state === "ended")?.code, code, `${command}: ${JSON.stringify(runs.slice(before))}`);
			}
		} finally {
			terms.closeAll();
			fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		}
	});
}

test("marks: where a prompt ends (PowerShell's B) is read and is no output", () => {
	const r = new MarkReader();
	const pieces = r.read("\x1b]133;D;0\x07\x1b]133;A\x07PS C:\\> \x1b]133;B\x07");
	assert.deepEqual(pieces.filter((p) => typeof p !== "string"), [{ kind: "D", code: 0 }, { kind: "A", code: undefined }, { kind: "B", code: undefined }]);
	assert.equal(pieces.filter((p) => typeof p === "string").join(""), "PS C:\\> ");
});

test("terminal: off a Mac the shell's Ctrl keys are the shell's while it has the keyboard, and the app's own chords stay the app's", () => {
	const ctrl = (code: string, more: { shift?: boolean; alt?: boolean; meta?: boolean } = {}) => ({ control: true, code, ...more });
	for (const platform of ["linux", "win32"]) {
		// Ctrl-W deletes a word, Ctrl-K the rest of the line, Ctrl-R searches, Ctrl-T, Ctrl-B, Ctrl-F and Ctrl-O are readline's: not the menu's.
		for (const code of ["KeyW", "KeyK", "KeyR", "KeyT", "KeyB", "KeyF", "KeyO", "KeyC", "KeyD", "BracketLeft", "Backslash"]) assert.equal(shellKeeps(ctrl(code), platform), true, `${platform} Ctrl+${code}`);
		// Copy and paste in a terminal there.
		assert.equal(shellKeeps(ctrl("KeyC", { shift: true }), platform), true);
		assert.equal(shellKeeps(ctrl("KeyV", { shift: true }), platform), true);
		// The app's chords: another tab, a tab by its number, the palette's Ctrl+Shift, the settings, the terminal's own key.
		for (const input of [ctrl("Tab"), ctrl("Digit1"), ctrl("KeyT", { shift: true }), ctrl("KeyB", { alt: true }), ctrl("Comma"), ctrl("Backquote"), { code: "KeyW" }, { meta: true, code: "KeyW" }]) assert.equal(shellKeeps(input, platform), false, `${platform} ${JSON.stringify(input)}`);
	}
	// On a Mac the app's key is ⌘: Ctrl is the shell's anyway, and nothing is taken from the menu.
	assert.equal(shellKeeps(ctrl("KeyW"), "darwin"), false);
});

test("terminal: the owner's own shell, for each system: $SHELL as a login shell, else the system's own, PowerShell on Windows", () => {
	assert.deepEqual(ownShell({ SHELL: "/bin/sh" }, "linux"), ["/bin/sh", "-l"]);
	assert.deepEqual(ownShell({ SHELL: "/bin/sh" }, "darwin"), ["/bin/sh", "-l"]);
	assert.deepEqual(ownShell({ SHELL: "/nowhere/fish" }, "darwin"), ["/bin/zsh", "-l"]);
	// Off a Mac with no $SHELL: the account's shell, which is a shell this computer has.
	const [linux, login] = ownShell({}, "linux");
	assert.equal(login, "-l");
	assert.ok(path.isAbsolute(linux));
	// Windows: PowerShell 7 where it is on the PATH (named in any case), else the PowerShell every Windows has.
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-shell-")));
	try {
		assert.deepEqual(ownShell({ Path: dir }, "win32"), ["powershell.exe"]);
		fs.writeFileSync(path.join(dir, "pwsh.exe"), "");
		assert.deepEqual(ownShell({ Path: dir }, "win32"), [path.join(dir, "pwsh.exe")]);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("terminal: the hooks go to bash however it is named (Git Bash's bash.exe) and to PowerShell as its command; cmd.exe runs without", () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-hooks-")));
	try {
		const bash = withHooks("C:\\Program Files\\Git\\bin\\bash.exe", [], {}, dir);
		assert.equal(bash.marks, true);
		assert.equal(bash.args[0], "--rcfile");
		for (const name of ["pwsh.exe", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "/usr/local/bin/pwsh"]) {
			const ps = withHooks(name, [], {}, dir, true);
			assert.equal(ps.marks, true, name);
			assert.deepEqual(ps.args.slice(0, 4), ["-NoLogo", "-NoProfile", "-NoExit", "-EncodedCommand"]);
			const script = Buffer.from(ps.args[4], "base64").toString("utf16le");
			assert.match(script, /function Global:prompt/);
			assert.match(script, /function Global:PSConsoleHostReadLine/);
			assert.match(script, /133;C/);
		}
		// The owner's profile is read where a test does not ask for none.
		assert.equal(withHooks("pwsh", [], {}, dir).args.includes("-NoProfile"), false);
		assert.equal(withHooks("C:\\Windows\\System32\\cmd.exe", [], {}, dir).marks, false);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

// PowerShell on Windows, and PowerShell 7 wherever it is installed (GitHub's Linux runners have it).
const pwsh = process.env.PATH?.split(path.delimiter).map((d) => path.join(d, "pwsh")).find((f) => fs.existsSync(f));
for (const shell of process.platform === "win32" ? ["powershell.exe"] : pwsh ? [pwsh] : []) {
	test(`terminal (${path.basename(shell)}): a block run with its button says when it has ended, how, and what it printed`, async () => {
		// PowerShell's first commands take a while on a busy machine (each cmdlet is compiled the first time
		// it runs): what is tested here is the report at the end, so the notice of a block that runs on comes late.
		const w = world(shell, 15_000);
		try {
			await w.terms.open("main:ps", w.dir, 80, 24);
			assert.deepEqual(await w.terms.run("main:ps", `Write-Output "one-$(40+2)"; ${process.platform === "win32" ? "cmd /c exit 3" : "sh -c 'exit 3'"}`), { reports: true });
			await w.until(() => w.runs.length > 0, 20_000);
			const [r] = w.runs;
			assert.equal(r.state, "ended");
			assert.equal(r.code, 3);
			assert.match(r.output, /one-42/);
			// A cmdlet that fails is a failure too, and one that succeeds says so.
			await w.terms.run("main:ps", "Get-Item ./nowhere-at-all");
			await w.until(() => w.runs.length === 2, 20_000);
			assert.equal(w.runs[1].code, 1);
			await w.terms.run("main:ps", "Write-Output fine");
			await w.until(() => w.runs.length === 3, 20_000);
			assert.equal(w.runs[2].code, 0);
			// What the owner types is theirs: it is not reported.
			w.terms.write("main:ps", "Write-Output by-hand\r");
			await w.until(() => /by-hand[\s\S]*by-hand/.test(w.out.get("main:ps") ?? ""), 20_000);
			await new Promise((res) => setTimeout(res, 500));
			assert.equal(w.runs.length, 3);
		} finally {
			w.done();
		}
	});
}
