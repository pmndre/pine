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
import { connectRemote, RemoteError, sshHost } from "../../src/remote.ts";

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
	stop(): Promise<void>;
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

const run = (file: string, args: string[], opts: { timeout?: number; env?: NodeJS.ProcessEnv } = {}) =>
	new Promise<{ code: number; out: string }>((resolve) => {
		execFile(file, args, { timeout: opts.timeout ?? 8000, env: opts.env, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve({ code: err ? 1 : 0, out: String(stdout) }));
	});

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
		const shell = process.env.SHELL && fs.existsSync(process.env.SHELL) ? process.env.SHELL : "/bin/zsh";
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

function onPath(name: string, env: NodeJS.ProcessEnv): string | undefined {
	for (const dir of String(env.PATH ?? "").split(path.delimiter)) {
		if (!dir) continue;
		const file = path.join(dir, name);
		try {
			fs.accessSync(file, fs.constants.X_OK);
			return file;
		} catch {
			// not here
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
		const own = resources ? path.join(resources, "node", "bin", "node") : undefined;
		const theirs = [onPath("node", env), "/opt/homebrew/bin/node", "/usr/local/bin/node", path.join(os.homedir(), ".volta", "bin", "node")];
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

/** Run a pine command to its end and hand on what it prints, line by line. For `pine init` on a first start. */
export function runPine(launch: Launch, args: string[], onLine: (line: string) => void, extraEnv: NodeJS.ProcessEnv = {}): Promise<number> {
	return new Promise((resolve) => {
		const child = spawn(launch.argv[0], [...launch.argv.slice(1), ...args], { env: { ...launch.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
		let buf = "";
		const take = (d: Buffer) => {
			buf += d.toString("utf8").replace(/\r/g, "\n");
			for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
				const line = buf.slice(0, i);
				buf = buf.slice(i + 1);
				if (line.trim()) onLine(line);
			}
		};
		child.stdout.on("data", take);
		child.stderr.on("data", take);
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
		const child: ChildProcess = spawn(launch.argv[0], args, { env: launch.env, stdio: opts.keep ? ["ignore", "pipe", "ignore"] : ["pipe", "pipe", "pipe"], detached: Boolean(opts.keep) });
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
				return fail(new ServiceError("failed", `pine answered with something that is not its service line: ${out.slice(0, 200)}`));
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
				stop: async () => {
					if (gone || opts.keep) return;
					child.kill("SIGTERM");
					// It stops its agents and closes its database first; a daemon that hangs is ended.
					const hard = setTimeout(() => child.kill("SIGKILL"), 12_000);
					await ended;
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
			const host = typeof value === "string" ? sshHost(value)?.host : undefined;
			if (host && !out.includes(host)) out.push(host);
		} catch {
			// not a host for ssh: not kept
		}
	}
	return out.slice(0, 20);
}

export { sshHost };
