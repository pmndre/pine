// The app's way to a pine daemon: reuse the one that runs, or start one and stop it again.
//
// The app is a client of the control API and nothing else (rule 10 of pine's AGENTS.md), so it
// does not load pine's code into its own process. It asks the `pine service` command, which
// answers with one line of JSON: where the daemon listens and its token. When that command had to
// start the daemon it stays alive as the daemon, and this file keeps it as a child.
import { type ChildProcess, execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sealed } from "./fds.ts";
import { connectRemote, connectWsl, RemoteError, sshHost, wslDistro } from "../../src/remote.ts";

export interface Service {
	base: string;
	token: string;
	/** "attached", "embedded daemon", "embedded daemon + claude -p": the words the terminal UI uses. */
	mode: string;
	/** This app started the daemon, and stops it when it quits. */
	started: boolean;
	home: string;
	version?: string;
	/** The ssh host of another machine whose pine this is, reached through a port forward (src/remote.ts). None for this computer's. */
	host?: string;
	/** A short name for that machine. */
	label?: string;
	/** Stops a daemon this app started (and ends the connection to another machine). `kept`: one that was to go on past the app is stopped too, as an update needs. */
	stop(kept?: boolean): Promise<void>;
}

export class ServiceError extends Error {
	/** "no-home": there is no pine home yet. "no-node", "no-pine": something to install. "ssh": another machine is not reached. "failed": the daemon said why. */
	kind: "no-home" | "no-node" | "no-pine" | "ssh" | "failed";
	constructor(kind: ServiceError["kind"], message: string) {
		super(message);
		this.kind = kind;
	}
}

export interface Launch {
	/** The program and first arguments that run pine's command line. */
	argv: string[];
	env: NodeJS.ProcessEnv;
	/** Where it was found, in words for the settings page. */
	from: string;
}

/** A variable of an environment by its name, which Windows does not tell apart by case (Path, PATH). */
export const named = (env: NodeJS.ProcessEnv, name: string) => env[name] ?? Object.entries(env).find(([k]) => k.toUpperCase() === name)?.[1];

/**
 * How a program is started. A .cmd or .bat (npm's `pine` on Windows) runs only through cmd.exe,
 * which Node no longer does by itself: it is handed to the shell as one line, each word quoted.
 */
export function started(file: string, args: string[], platform: string = process.platform): { file: string; args: string[]; shell: boolean } {
	if (platform !== "win32" || !/\.(cmd|bat)$/i.test(file)) return { file, args, shell: false };
	const quoted = (word: string) => `"${word.replace(/"/g, '""')}"`;
	return { file: [file, ...args].map(quoted).join(" "), args: [], shell: true };
}

const run = (file: string, args: string[], opts: { timeout?: number; env?: NodeJS.ProcessEnv } = {}) =>
	new Promise<{ code: number; out: string }>((resolve) => {
		const how = started(file, args);
		execFile(how.file, how.args, { timeout: opts.timeout ?? 8000, env: opts.env, maxBuffer: 4 * 1024 * 1024, shell: how.shell, windowsHide: true }, (err, stdout) => resolve({ code: err ? 1 : 0, out: String(stdout) }));
	});

/** The shell the owner logs in with: $SHELL, else the account's (Linux), else zsh, a Mac's own. */
function loginShell(): string {
	if (process.env.SHELL && fs.existsSync(process.env.SHELL)) return process.env.SHELL;
	if (process.platform === "darwin") return "/bin/zsh";
	try {
		const own = os.userInfo().shell;
		if (own && fs.existsSync(own)) return own;
	} catch {
		// no entry for this user
	}
	return "/bin/sh";
}

let shellEnv: Promise<NodeJS.ProcessEnv> | undefined;

/**
 * The environment of the owner's login shell. An app started from the Finder has a PATH of four
 * system folders: no node from Homebrew or nvm, and none of the tools an agent's commands expect.
 * The daemon this app starts is to behave like one started in a terminal, so it gets the
 * environment a terminal would have.
 */
export function loginEnv(): Promise<NodeJS.ProcessEnv> {
	shellEnv ??= (async () => {
		if (process.platform === "win32") return { ...process.env };
		const shell = loginShell();
		// Between two marks, so that whatever a profile prints does not get in the way.
		const { out } = await run(shell, ["-ilc", "printf '\\n__PINE_ENV__\\n'; env; printf '__PINE_END__\\n'"], { timeout: 6000 });
		const body = /__PINE_ENV__\n([\s\S]*?)__PINE_END__/.exec(out)?.[1];
		if (!body) return { ...process.env };
		const env: NodeJS.ProcessEnv = {};
		let last = "";
		for (const line of body.split("\n")) {
			const at = line.indexOf("=");
			if (at > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(line.slice(0, at))) env[(last = line.slice(0, at))] = line.slice(at + 1);
			else if (last) env[last] += `\n${line}`; // a value of several lines
		}
		return { ...process.env, ...env };
	})();
	return shellEnv;
}

/**
 * A program on the PATH of `env`. On Windows a name without an extension is one of those PATHEXT
 * lists (`pine` is npm's pine.cmd there; the file without one beside it is for Git Bash, and
 * Windows does not run it).
 */
export function onPath(name: string, env: NodeJS.ProcessEnv, platform: string = process.platform): string | undefined {
	const exts = platform === "win32" && !path.extname(name) ? String(named(env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
	for (const dir of String(named(env, "PATH") ?? "").split(platform === "win32" ? ";" : ":")) {
		if (!dir) continue;
		for (const ext of exts) {
			const file = path.join(dir, name + ext.toLowerCase());
			try {
				fs.accessSync(file, fs.constants.X_OK);
				if (platform !== "win32" || fs.statSync(file).isFile()) return file;
			} catch {
				// not here
			}
		}
	}
	return undefined;
}

async function nodeVersion(file: string, env: NodeJS.ProcessEnv): Promise<number> {
	const { out } = await run(file, ["-p", "process.versions.node"], { env });
	return Number(out.trim().split(".")[0]) || 0;
}

/**
 * How to run pine's command line from here, in this order: what PINE_CLI names; the checkout this
 * app lies in (development); the copy that was packed into the app; the `pine` command of the
 * owner's shell. pine runs on Node, never on the app's own Electron: its children are started
 * with `process.execPath`, which has to be a plain Node. The pine the app carries runs on the
 * Node the app carries, so that it is the pair that was made and tried together; another pine
 * runs on the owner's Node, and on the app's only where there is no other.
 */
export async function findPine(appRoot: string, resources?: string): Promise<Launch> {
	const env = await loginEnv();
	const places = [
		...(process.env.PINE_CLI ? [{ file: process.env.PINE_CLI, from: "PINE_CLI" }] : []),
		{ file: path.join(appRoot, "..", "bin", "pine.js"), from: "this checkout" },
		...(resources ? [{ file: path.join(resources, "pine", "bin", "pine.js"), from: "the app" }] : []),
	];
	const script = places.find((p) => fs.existsSync(p.file) && (p.from !== "this checkout" || fs.existsSync(path.join(appRoot, "..", "src", "cli.ts"))));
	if (script) {
		// As nodejs.org hands it out for each system: bin/node, and node.exe at the top on Windows.
		const own = resources ? (process.platform === "win32" ? path.join(resources, "node", "node.exe") : path.join(resources, "node", "bin", "node")) : undefined;
		const theirs = [onPath("node", env), ...(process.platform === "win32" ? [] : ["/opt/homebrew/bin/node", "/usr/local/bin/node", path.join(os.homedir(), ".volta", "bin", "node")])];
		const candidates = [process.env.PINE_NODE, ...(script.from === "the app" ? [own, ...theirs] : [...theirs, own])].filter((x): x is string => Boolean(x && fs.existsSync(x)));
		for (const node of candidates) if ((await nodeVersion(node, env)) >= 24) return { argv: [node, script.file], env, from: script.from };
		throw new ServiceError("no-node", candidates.length ? `pine needs Node 24 or newer, and the node found on this computer (${candidates[0]}) is older. Install a current one from https://nodejs.org, then try again.` : "pine runs on Node, and no node was found on this computer. Install Node 24 or newer from https://nodejs.org, then try again.");
	}
	const pine = onPath("pine", env);
	if (pine) return { argv: [pine], env, from: pine };
	throw new ServiceError("no-pine", "pine is not installed on this computer. Install it by typing this into a terminal: npm install -g @pmndre/pine");
}

/**
 * The folder pine itself lies in, for what a UI uses of it beside the control API (the source of
 * the voice helper). Undefined when it cannot be told.
 */
export function pineRoot(launch: Launch): string | undefined {
	try {
		const script = fs.realpathSync(launch.argv[1] ?? launch.argv[0]);
		const root = path.resolve(path.dirname(script), "..");
		return fs.existsSync(path.join(root, "package.json")) ? root : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The version of the pine the app runs, as its package says: in a packed app the pine it carries,
 * whose version is the app's. Undefined when it cannot be told.
 */
export function pineVersion(launch: Launch): string | undefined {
	const root = pineRoot(launch);
	try {
		const version = root ? JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version : undefined;
		return typeof version === "string" ? version : undefined;
	} catch {
		return undefined;
	}
}

/** Run a pine command to its end and hand on what it prints, line by line. For `pine init` on a first start. */
export function runPine(launch: Launch, args: string[], onLine: (line: string) => void, extraEnv: NodeJS.ProcessEnv = {}): Promise<number> {
	return new Promise((resolve) => {
		const how = started(launch.argv[0], [...launch.argv.slice(1), ...args]);
		const child = spawn(how.file, how.args, { env: { ...launch.env, ...extraEnv }, stdio: sealed(["ignore", "pipe", "pipe"]), shell: how.shell, windowsHide: true });
		let buf = "";
		const take = (d: Buffer) => {
			buf += d.toString("utf8").replace(/\r/g, "\n");
			for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
				const line = buf.slice(0, i);
				buf = buf.slice(i + 1);
				if (line.trim()) onLine(line);
			}
		};
		child.stdout!.on("data", take);
		child.stderr!.on("data", take);
		child.on("error", (e) => (onLine(e.message), resolve(1)));
		child.on("close", (code) => (buf.trim() && onLine(buf), resolve(code ?? 1)));
	});
}

/**
 * Ask `pine service` for a daemon. It attaches to the one of this home if one runs; otherwise it
 * becomes one. `keep`: a daemon started here goes on when the app quits.
 */
export function connect(launch: Launch, opts: { home?: string; keep?: boolean } = {}): Promise<Service> {
	return new Promise((resolve, reject) => {
		const args = [...launch.argv.slice(1), "service", ...(opts.home ? ["--home", opts.home] : []), ...(opts.keep ? ["--keep"] : [])];
		// Its stdin is the leash: when this app dies without a word, the pipe closes and the daemon stops.
		// (One that is kept gets no pipe it could still be writing into when this app is gone, but for its one line.)
		const how = started(launch.argv[0], args);
		const child: ChildProcess = spawn(how.file, how.args, { env: launch.env, stdio: sealed(opts.keep ? ["ignore", "pipe", "ignore"] : ["pipe", "pipe", "pipe"]), detached: Boolean(opts.keep), shell: how.shell, windowsHide: true });
		let out = "";
		let err = "";
		let settled = false;
		const fail = (e: ServiceError) => {
			if (settled) return;
			settled = true;
			reject(e);
		};
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			fail(new ServiceError("failed", `pine did not come up within a minute.${err.trim() ? ` It said: ${err.trim().slice(-400)}` : ""}`));
		}, 60_000);
		child.stderr?.on("data", (d: Buffer) => (err = (err + d.toString("utf8")).slice(-4000)));
		child.stdout!.on("data", (d: Buffer) => {
			if (settled) return;
			out += d.toString("utf8");
			const end = out.indexOf("\n");
			if (end < 0) return;
			clearTimeout(timer);
			let said: any;
			try {
				said = JSON.parse(out.slice(0, end));
			} catch {
				return fail(new ServiceError("failed", `pine answered with something other than the expected service line: ${out.slice(0, 200)}`));
			}
			if (said.error) return fail(new ServiceError(/pine init|no pine home/i.test(said.error) ? "no-home" : "failed", String(said.error)));
			settled = true;
			let gone = !said.started;
			const ended = new Promise<void>((done) => child.once("close", () => ((gone = true), done())));
			if (opts.keep) {
				// It goes on by itself from here: nothing of it is held any more.
				child.stdout?.destroy();
				child.unref();
			}
			resolve({
				base: String(said.base),
				token: String(said.token),
				mode: String(said.mode ?? "attached"),
				started: said.started === true,
				home: String(said.home ?? opts.home ?? ""),
				version: typeof said.version === "string" ? said.version : undefined,
				stop: async (kept?: boolean) => {
					if (gone || (opts.keep && !kept)) return;
					// Its input is the leash: closed, the daemon stops its agents and closes its database, and
					// ends within ten seconds. That works on every system: on Windows a signal is no request
					// but the end of the process, and the database would be left open. One that does not end
					// is told with a signal, and one that hangs is ended.
					child.stdin?.end();
					const term = setTimeout(() => child.kill("SIGTERM"), 11_000);
					const hard = setTimeout(() => child.kill("SIGKILL"), 15_000);
					await ended;
					clearTimeout(term);
					clearTimeout(hard);
				},
			});
		});
		child.on("error", (e) => (clearTimeout(timer), fail(new ServiceError("failed", `pine could not be started: ${e.message}`))));
		child.on("close", (code) => {
			clearTimeout(timer);
			if (!settled) fail(new ServiceError(/pine init|no pine home/i.test(err) ? "no-home" : "failed", err.trim().slice(-600) || `pine ended at once (exit ${code}) without saying why. An older pine has no "service" command: update it with "pine update".`));
		});
	});
}

// ---- a pine on another machine ------------------------------------------------------------------

/**
 * The pine of another machine, over SSH (src/remote.ts). Its daemon answers on a port of this
 * computer that ssh forwards; a daemon `pine service` started there ends with the connection.
 * PINE_DESKTOP_SSH names a stand-in for ssh, for tests only.
 */
export async function connectSsh(host: string, env: NodeJS.ProcessEnv): Promise<Service> {
	try {
		// "wsl:<distribution>": the pine of a Linux distribution on this Windows computer (src/remote.ts).
		if (host.startsWith("wsl:")) {
			const w = await connectWsl(host.slice(4), { env, wsl: process.env.PINE_DESKTOP_WSL });
			return { base: w.base, token: w.token, mode: `in WSL (${w.label})`, started: w.started, home: `${w.label}:${w.home}`, version: w.version, host: w.host, label: w.label, stop: w.stop };
		}
		const r = await connectRemote(host, { env, ssh: process.env.PINE_DESKTOP_SSH });
		return { base: r.base, token: r.token, mode: `on ${r.label}`, started: r.started, home: `${r.label}:${r.home}`, version: r.version, host: r.host, label: r.label, stop: r.stop };
	} catch (e) {
		if (e instanceof RemoteError) throw new ServiceError(e.kind, e.message);
		throw e;
	}
}

/** The machines the owner added (Settings > Environments), as prefs.json keeps them: each a host for ssh, once. */
export function readHosts(raw: unknown): string[] {
	const out: string[] = [];
	if (!Array.isArray(raw)) return out;
	for (const value of raw) {
		try {
			const host = typeof value === "string" ? hostOf(value) : undefined;
			if (host && !out.includes(host)) out.push(host);
		} catch {
			// not a host for ssh: not kept
		}
	}
	return out.slice(0, 20);
}

/** A machine as the app keeps it: a host for ssh, or "wsl:<distribution>" for one of this Windows computer's. */
export function hostOf(value: string): string | undefined {
	const v = value.trim();
	if (v.toLowerCase().startsWith("wsl:")) {
		const d = wslDistro(v.slice(4))?.distro;
		return d ? `wsl:${d}` : undefined;
	}
	return sshHost(v)?.host;
}

export { sshHost };
