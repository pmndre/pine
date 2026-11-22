// The owner's terminal beside a conversation: a shell of their own, on a pseudo-terminal, in the
// conversation's folder. It is the owner's hand, as a terminal app of theirs would be: no
// sandbox, the owner's login shell and environment. Nothing an agent says reaches it by itself;
// what is typed comes from the page's keyboard, and a code block of an answer only by the owner's
// click on its Run button (src/runnable.ts says what such a block may hold).
//
// One shell for each conversation, kept here while the app runs, so that the panel can be closed
// and opened again, or the page drawn again, without losing what the shell printed: the end of it
// is kept (`KEEP`) and handed back when the page opens the terminal again.
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { IPty } from "node-pty";
import { withoutFds } from "./fds.ts";
import { type Mark, MarkReader, withHooks } from "./shell-hooks.ts";

/** How much of what a shell printed is kept for a page that opens it again. */
const KEEP = 256 * 1024;
/** A terminal's name: the conversation's key (agent:session), as the page knows it. */
const ID = /^[A-Za-z0-9._~:-]{1,200}$/;
/** A command that runs this long without ending is said to be running, once, with what it printed so far. */
const STILL_RUNNING_MS = 10_000;
/** After a command ends, this long without another starting: the block is over (a block of several lines without bracketed paste is a command per line). */
const SETTLE_MS = 300;
/** A block typed into a shell that does not start a command within this long is not followed any more. */
const NEVER_STARTED_MS = 30_000;
/** How long a block waits for a shell that has not shown its first prompt yet. */
const FIRST_PROMPT_MS = 15_000;
/** How much of what a block printed is kept for the report. */
const RUN_KEEP = 64 * 1024;

/** Variables of the app's own process that a shell of the owner's has no business with. */
const NOT_THEIRS = /^(ELECTRON_|PINE_DESKTOP_|CHROME_|NODE_OPTIONS$|__CF|XPC_SERVICE_NAME$)/;

/** What a block run with a Run button did, as the conversation is told. */
export interface RunReport {
	command: string;
	state: "running" | "ended";
	code?: number;
	seconds: number;
	output: string;
}

export interface TerminalEvents {
	data: (id: string, data: string) => void;
	exit: (id: string, code: number) => void;
	/** A block run with a Run button is still running (once), or has ended. */
	run?: (id: string, report: RunReport) => void;
}

/** A block that was run with a Run button, followed from when it was typed until it has ended. */
interface Run {
	command: string;
	started?: number;
	out: string;
	code?: number;
	saidRunning: boolean;
	/** Until it starts; until it is said to be still running; from an end until it is over (`SETTLE_MS`). */
	timers: { never?: NodeJS.Timeout; still?: NodeJS.Timeout; settle?: NodeJS.Timeout };
}

interface Shell {
	pty: IPty;
	/** The end of what it printed. */
	kept: string;
	cwd: string;
	/** Whether it reports when a command ends (shell-hooks.ts). */
	marks: boolean;
	reader: MarkReader;
	/** It has shown a prompt: it reads what is typed as a command. */
	prompted: boolean;
	/** A command runs right now (started, not ended). */
	busy: boolean;
	/** Bracketed paste is on: a block of several lines arrives as one command. */
	bracketed: boolean;
	run?: Run;
	waiting: Array<() => void>;
}

type Pty = typeof import("node-pty");
let loaded: Pty | Error | undefined;

/**
 * node-pty, loaded when the first terminal opens: a system without its prebuilt binary gets a
 * sentence, not a crash of the app. Its helper (`spawn-helper`) has to be executable, which
 * npm leaves undone when install scripts are not allowed to run: done here where it was missed.
 */
function ptyModule(): Pty {
	if (loaded instanceof Error) throw loaded;
	if (loaded) return loaded;
	try {
		const require = createRequire(import.meta.url);
		loaded = require("node-pty") as Pty;
		const helper = path.join(path.dirname(require.resolve("node-pty/package.json")), "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper").replace("app.asar", "app.asar.unpacked");
		try {
			if (fs.existsSync(helper) && !(fs.statSync(helper).mode & 0o111)) fs.chmodSync(helper, 0o755);
		} catch {
			// a packed app has it executable already
		}
		return loaded;
	} catch (e) {
		loaded = new Error(`The terminal cannot start on this system: ${e instanceof Error ? e.message : e}`);
		throw loaded;
	}
}

/** Where a shell starts: the folder the page names if it is one, else the owner's home folder. */
export function startIn(cwd: unknown): string {
	if (typeof cwd === "string" && path.isAbsolute(cwd)) {
		try {
			if (fs.statSync(cwd).isDirectory()) return cwd;
		} catch {
			// gone since
		}
	}
	return os.homedir();
}

/** The environment of the owner's shell: their login environment, without the app's own variables. */
export function shellEnv(base: NodeJS.ProcessEnv): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(base)) if (v !== undefined && !NOT_THEIRS.test(k)) env[k] = v;
	env.TERM = "xterm-256color";
	env.COLORTERM = "truecolor";
	env.TERM_PROGRAM = "Pine";
	env.LANG ||= "en_US.UTF-8";
	return env;
}

/** A variable of an environment by its name, which Windows does not tell apart by case (Path, PATH). */
const named = (env: NodeJS.ProcessEnv, name: string) => env[name] ?? Object.entries(env).find(([k]) => k.toUpperCase() === name)?.[1];

/** A program on the PATH of `env`, by its file name (Windows: with its extension). */
function onPath(file: string, env: NodeJS.ProcessEnv): string | undefined {
	for (const dir of String(named(env, "PATH") ?? "").split(path.delimiter)) {
		if (dir && fs.existsSync(path.join(dir, file))) return path.join(dir, file);
	}
	return undefined;
}

/**
 * The owner's own shell and its arguments, as a terminal app of theirs would start it: $SHELL as a
 * login shell; where there is none, the account's shell (Linux), zsh (a Mac), and on Windows
 * PowerShell, the newer one where it is installed.
 */
export function ownShell(env: NodeJS.ProcessEnv, platform: string = process.platform): string[] {
	const exists = (f: string | undefined): f is string => Boolean(f && path.isAbsolute(f) && fs.existsSync(f));
	const shell = named(env, "SHELL");
	if (platform === "win32") return [exists(shell) ? shell : (onPath("pwsh.exe", env) ?? "powershell.exe")];
	let account: string | undefined;
	try {
		account = os.userInfo().shell ?? undefined;
	} catch {
		// no entry for this user
	}
	return [exists(shell) ? shell : platform === "darwin" ? "/bin/zsh" : exists(account) ? account : "/bin/bash", "-l"];
}

/**
 * Whether a key pressed while the terminal has the keyboard is the shell's and not a shortcut of the
 * app's menu. Off a Mac the app's shortcuts are Ctrl chords, and so are the shell's own keys (Ctrl-W
 * deletes a word, Ctrl-K the rest of the line, Ctrl-R searches): Ctrl and a letter, or one of the
 * few other keys a terminal sends as a control character, is the shell's, and so are Ctrl+Shift+C
 * and Ctrl+Shift+V, which copy and paste in a terminal there. Ctrl+Shift and a letter, Ctrl and a
 * digit, Ctrl+Tab, Ctrl+, and Ctrl+` stay the app's. On a Mac the app's key is ⌘: nothing changes.
 */
export function shellKeeps(input: { control?: boolean; shift?: boolean; alt?: boolean; meta?: boolean; code?: string }, platform: string = process.platform): boolean {
	if (platform === "darwin" || !input.control || input.alt || input.meta) return false;
	const code = String(input.code ?? "");
	if (input.shift) return code === "KeyC" || code === "KeyV";
	return /^Key[A-Z]$/.test(code) || ["BracketLeft", "BracketRight", "Backslash", "Space", "Slash"].includes(code);
}

const size = (n: unknown, least: number, most: number) => Math.max(least, Math.min(most, Math.floor(Number(n)) || least));

export interface TerminalOptions {
	/** The environment shells start with (the owner's login environment). */
	env: () => Promise<NodeJS.ProcessEnv>;
	/** Where the files of the shell hooks are written (the app's own data). */
	hooks: string;
	/** The shell to run; the owner's own (`ownShell`) when not given. A shell named here (tests) reads none of the owner's startup files. */
	shell?: string[];
	/** After how long a block that runs on is said to be running (tests make it short). */
	stillRunningMs?: number;
}

export class Terminals {
	private shells = new Map<string, Shell>();
	private events: TerminalEvents;
	private opts: TerminalOptions;
	constructor(events: TerminalEvents, opts: TerminalOptions) {
		this.events = events;
		this.opts = opts;
	}

	/**
	 * The terminal of a conversation: the one that runs, or a new one in `cwd`. What it printed so far
	 * comes back, for the page to draw before what follows.
	 */
	async open(id: string, cwd: unknown, cols: unknown, rows: unknown): Promise<{ kept: string; cwd: string; fresh: boolean }> {
		if (!ID.test(id)) throw new Error("not a terminal's name");
		const have = this.shells.get(id);
		if (have) {
			this.resize(id, cols, rows);
			return { kept: have.kept, cwd: have.cwd, fresh: false };
		}
		const pty = ptyModule();
		const env = shellEnv(await this.opts.env());
		const [file, ...args] = this.opts.shell ?? ownShell(env);
		const launch = withHooks(file, args, env, this.opts.hooks, Boolean(this.opts.shell));
		const dir = startIn(cwd);
		// Another call may have opened it while the environment was being asked for.
		const raced = this.shells.get(id);
		if (raced) return { kept: raced.kept, cwd: raced.cwd, fresh: false };
		// Without the app's open files (fds.ts): node-pty's fork on Linux keeps them, and so would whatever the owner starts in it.
		const [program, ...argv] = withoutFds([launch.file, ...launch.args]);
		const proc = pty.spawn(program, argv, { name: "xterm-256color", cols: size(cols, 2, 1000), rows: size(rows, 1, 500), cwd: dir, env: launch.env });
		const shell: Shell = { pty: proc, kept: "", cwd: dir, marks: launch.marks, reader: new MarkReader(), prompted: false, busy: false, bracketed: false, waiting: [] };
		this.shells.set(id, shell);
		proc.onData((data) => {
			shell.kept = (shell.kept + data).slice(-KEEP);
			this.events.data(id, data);
			if (shell.marks) this.follow(id, shell, data);
		});
		// Said only of a shell that ended by itself: one that was closed has a successor, or nobody, to tell.
		proc.onExit(({ exitCode }) => {
			if (this.shells.get(id) !== shell) return;
			this.shells.delete(id);
			if (shell.run?.started) this.ended(id, shell, exitCode);
			this.forget(shell);
			this.events.exit(id, exitCode);
		});
		return { kept: "", cwd: dir, fresh: true };
	}

	/**
	 * A code block of an answer, run with its button: typed into the shell as a paste and then
	 * Enter, and followed until it has ended. `reports` says whether the conversation will hear how
	 * it went (a shell without the hooks says nothing). A shell busy with another command gets
	 * nothing: what was typed would go to that command.
	 */
	async run(id: string, code: unknown): Promise<{ reports: boolean }> {
		const shell = this.shells.get(id);
		if (!shell) throw new Error("This conversation's terminal is not open.");
		if (typeof code !== "string" || !code.trim()) throw new Error("There is nothing to run.");
		if (shell.marks && !shell.prompted) await new Promise<void>((resolve) => (shell.waiting.push(resolve), setTimeout(resolve, FIRST_PROMPT_MS)));
		if (this.shells.get(id) !== shell) throw new Error("The terminal ended before the block could run.");
		if (shell.marks && (shell.busy || shell.run)) throw new Error("The terminal is busy with another command. Wait for it, or stop it with Ctrl-C, and run the block again.");
		const text = code.replace(/\r\n/g, "\n").replace(/\n+$/, "");
		if (shell.marks) {
			const run: Run = { command: text, out: "", saidRunning: false, timers: {} };
			shell.run = run;
			run.timers.never = setTimeout(() => !run.started && shell.run === run && this.forget(shell), NEVER_STARTED_MS);
		}
		shell.pty.write(shell.bracketed ? `\x1b[200~${text}\x1b[201~\r` : `${text.replace(/\n/g, "\r")}\r`);
		return { reports: shell.marks };
	}

	private forget(shell: Shell): void {
		for (const t of Object.values(shell.run?.timers ?? {})) clearTimeout(t);
		shell.run = undefined;
		for (const wake of shell.waiting.splice(0)) wake();
	}

	/** What the shell printed, read for its marks: prompts, commands that start and end, and the output of a block that runs. */
	private follow(id: string, shell: Shell, data: string): void {
		if (data.includes("\x1b[?2004h")) shell.bracketed = true;
		if (data.includes("\x1b[?2004l")) shell.bracketed = false;
		for (const piece of shell.reader.read(data)) {
			if (typeof piece === "string") {
				if (shell.run?.started) shell.run.out = (shell.run.out + piece).slice(-RUN_KEEP);
				continue;
			}
			this.mark(id, shell, piece);
		}
	}

	private mark(id: string, shell: Shell, mark: Mark): void {
		const run = shell.run;
		if (mark.kind === "A") {
			shell.prompted = true;
			for (const wake of shell.waiting.splice(0)) wake();
			return;
		}
		// Where a prompt ends (PowerShell's hooks say it): nothing to do.
		if (mark.kind === "B") return;
		if (mark.kind === "C") {
			shell.busy = true;
			if (!run) return;
			// A further line of the same block (no bracketed paste): it goes on.
			clearTimeout(run.timers.settle);
			clearTimeout(run.timers.never);
			if (!run.started) {
				run.started = Date.now();
				run.timers.still = setTimeout(() => {
					if (shell.run !== run || run.saidRunning) return;
					run.saidRunning = true;
					this.events.run?.(id, { command: run.command, state: "running", seconds: (Date.now() - run.started!) / 1000, output: run.out });
				}, this.opts.stillRunningMs ?? STILL_RUNNING_MS);
			}
			return;
		}
		// D: a command has ended.
		shell.busy = false;
		if (!run?.started) return;
		run.code = mark.code;
		clearTimeout(run.timers.settle);
		run.timers.settle = setTimeout(() => shell.run === run && this.ended(id, shell, run.code), SETTLE_MS);
	}

	private ended(id: string, shell: Shell, code: number | undefined): void {
		const run = shell.run;
		if (!run?.started) return;
		this.forget(shell);
		this.events.run?.(id, { command: run.command, state: "ended", code, seconds: (Date.now() - run.started) / 1000, output: run.out });
	}

	/** What was typed, or pasted, into a terminal. */
	write(id: string, data: unknown): void {
		if (typeof data === "string" && data) this.shells.get(id)?.pty.write(data);
	}

	resize(id: string, cols: unknown, rows: unknown): void {
		const shell = this.shells.get(id);
		if (!shell) return;
		try {
			shell.pty.resize(size(cols, 2, 1000), size(rows, 1, 500));
		} catch {
			// it ended a moment ago
		}
	}

	has(id: string): boolean {
		return this.shells.has(id);
	}

	/** The shell ends, and with it what it started in the foreground. */
	close(id: string): void {
		const shell = this.shells.get(id);
		if (!shell) return;
		this.shells.delete(id);
		this.forget(shell);
		try {
			shell.pty.kill();
		} catch {
			// already gone
		}
	}

	closeAll(): void {
		for (const id of [...this.shells.keys()]) this.close(id);
	}
}
