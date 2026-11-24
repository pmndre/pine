// A pine on another machine, reached over SSH: the Pine app uses it for a machine added in
// Settings > Environments. Nothing of pine's daemon is in here, only Node's own modules, so that
// the app's main process can carry it (it is bundled) without loading pine.
//
// The control API takes requests for 127.0.0.1 only, so the other machine's daemon is reached
// through a forward from a port of this computer: to a client it is a daemon on a local port, and
// nothing on the other machine has to change or be opened to the network.
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export class RemoteError extends Error {
	/** "ssh": the other machine was not reached, or pine is not there. "failed": its pine said why it did not start. */
	kind: "ssh" | "failed";
	constructor(kind: RemoteError["kind"], message: string) {
		super(message);
		this.kind = kind;
	}
}

/** What may name the other machine: a host, `user@host` or an alias of ~/.ssh/config, never an option for ssh. */
export function sshHost(value: string | undefined): { host: string; label: string } | undefined {
	const host = value?.trim();
	if (!host) return undefined;
	if (!/^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/.test(host)) throw new RemoteError("ssh", `"${host.slice(0, 80)}" is not a host for ssh. Write it as host or user@host, as you would after "ssh".`);
	return { host, label: host.replace(/^.*@/, "").split(".")[0] || host };
}

/** No password prompt (there is no terminal to type it in), and a link that died is noticed in under a minute. */
const SSH_OPTIONS = ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3"];

/**
 * What runs on the other machine, in its owner's environment. ssh hands the command to the login
 * shell there, which may be sh, bash, zsh, fish, csh or tcsh: so what that shell parses is only
 * `exec /bin/sh -c '...'`, with nothing inside the quotes that one of them reads differently (no
 * quote, backslash, "!" or line break; `remoteCommand` checks). The rest is sh. Its PATH is the
 * one the login shell sets (`printenv PATH` means the same in all of them; the last line, in
 * case a startup file prints), and nvm's node when pine was installed with it (nvm sets its PATH
 * in .bashrc, which a shell without a terminal skips). `pine service` exits at once when it
 * attaches to a daemon that runs; `cat` then holds the session, so that the connection and its
 * forward stay, and its stdin stays the leash of a daemon it started.
 */
export const REMOTE_SCRIPT = [
	`p=$("\${SHELL:-/bin/sh}" -l -c "printenv PATH" </dev/null 2>/dev/null | tail -n 1)`,
	// (tcsh takes -l only alone; it reads its startup files with -c as well.)
	`[ -n "$p" ] || p=$("\${SHELL:-/bin/sh}" -c "printenv PATH" </dev/null 2>/dev/null | tail -n 1)`,
	`[ -n "$p" ] && PATH="$p" && export PATH`,
	`[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1`,
	`command -v pine >/dev/null || { echo "pine is not installed there: no pine command on its PATH." >&2; exit 127; }`,
	`pine service && exec cat >/dev/null`,
].join("; ");

export const remoteCommand = () => {
	if (/['\\!\n]/.test(REMOTE_SCRIPT)) throw new Error("the remote script has a character that a login shell would read differently");
	return `exec /bin/sh -c '${REMOTE_SCRIPT}'`;
};

export const sshArgs = (host: string, more: string[], command?: string) => [...SSH_OPTIONS, ...more, host, ...(command ? [command] : [])];

/**
 * Where the other machine's daemon answers, as the far end of the forward. A daemon always
 * listens on loopback, so a service line that names anything else is not taken: the forward
 * would carry the token to another host.
 */
export function loopbackEnd(base: string): string {
	let url: URL;
	try {
		url = new URL(base);
	} catch {
		throw new RemoteError("failed", `The other machine's pine named no address it answers at: ${base.slice(0, 80)}`);
	}
	const port = Number(url.port);
	const host = url.hostname === "[::1]" ? "[::1]" : /^127(\.\d{1,3}){3}$/.test(url.hostname) ? url.hostname : undefined;
	if (url.protocol !== "http:" || url.username || url.password || !host || !Number.isInteger(port) || port < 1 || port > 65535) throw new RemoteError("failed", `The other machine's pine says it answers at ${base.slice(0, 80)}, which is not a port on that machine's own loopback. Only that is connected to.`);
	return `${host}:${port}`;
}

type Answer = { said: any } | { failed: "timeout" | "garbage" | "spawn" | "exit"; detail: string; err: string };

/** The one line of JSON `pine service` prints on the other machine, read from the ssh that runs it. */
function answer(child: ChildProcess, ms = 60_000): Promise<Answer> {
	return new Promise((resolve) => {
		let out = "";
		let err = "";
		let settled = false;
		const done = (a: Answer) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(a);
		};
		const timer = setTimeout(() => (child.kill("SIGTERM"), done({ failed: "timeout", detail: "", err })), ms);
		child.stderr?.on("data", (d: Buffer) => (err = (err + d.toString("utf8")).slice(-4000)));
		child.stdout!.on("data", (d: Buffer) => {
			if (settled) return;
			out += d.toString("utf8");
			const end = out.indexOf("\n");
			if (end < 0) return;
			try {
				done({ said: JSON.parse(out.slice(0, end)) });
			} catch {
				done({ failed: "garbage", detail: out.slice(0, 200), err });
			}
		});
		child.on("error", (e) => done({ failed: "spawn", detail: e.message, err }));
		child.on("close", (code) => done({ failed: "exit", detail: String(code), err }));
	});
}

/**
 * The forward as a connection of its own, where ssh has no control socket (Windows): ssh binds
 * the port and holds it, and ends at once when it cannot (ExitOnForwardFailure). It counts once
 * the daemon answers through it.
 */
async function forwardApart(program: string, host: string, env: NodeJS.ProcessEnv, port: number, far: string, token: string): Promise<{ child?: ChildProcess; err: string }> {
	const f = spawn(program, sshArgs(host, ["-N", "-o", "ExitOnForwardFailure=yes", "-L", `127.0.0.1:${port}:${far}`]), { env, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
	let err = "";
	let over = false;
	f.stderr!.on("data", (d: Buffer) => (err = (err + d.toString("utf8")).slice(-2000)));
	f.once("error", (x) => ((over = true), (err = x.message)));
	f.once("close", () => (over = true));
	for (let i = 0; i < 60 && !over; i++) {
		const ok = await fetch(`http://127.0.0.1:${port}/overview`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000) })
			.then((r) => r.ok)
			.catch(() => false);
		if (ok) return { child: f, err };
		await new Promise((r) => setTimeout(r, 250));
	}
	f.kill();
	return { err: err.trim() || "the forward did not answer" };
}

/** What went wrong with ssh, in words that say what to do. */
function sshTrouble(host: string, a: Exclude<Answer, { said: any }>): string {
	const said = a.err.replace(/^#.*\n?/gm, "").trim().slice(-500);
	const check = /https:\/\/login\.tailscale\.com\/\S+/.exec(a.err)?.[0];
	if (a.failed === "spawn") return `ssh could not be started (${a.detail}). Is ssh installed?`;
	if (a.failed === "timeout") return check ? `Tailscale SSH wants you to confirm it is you before ${host} lets you in. Open ${check}, sign in, then try again.` : `${host} did not answer over SSH within a minute.${said ? ` ssh said: ${said}` : ""}`;
	if (a.failed === "garbage") return `${host} answered with something that is not pine's service line: ${a.detail}`;
	if (a.detail === "127") return `pine is not installed on ${host}, or not on the PATH of the login shell there. ${said}`;
	// Whether a new machine is the right one is ssh's question, which a terminal can answer once.
	if (/host key verification failed|no \S+ host key is known|remote host identification has changed/i.test(said)) return `${host} is not among the machines ssh knows yet. Connect to it once from a terminal (ssh ${host}) and accept the machine's key, then try again. ssh said: ${said}`;
	if (a.detail === "255") return `Could not connect to ${host} over SSH. ${said || "ssh gave no reason."}${/permission denied|password|publickey/i.test(said) ? " A password cannot be typed here: it needs a key in ssh-agent (ssh-add) or Tailscale SSH." : ""}`;
	return said || `ssh to ${host} ended (exit ${a.detail}) without saying why.`;
}

/** A port of this computer that nothing listens on now. */
const freePort = () =>
	new Promise<number>((resolve, reject) => {
		const server = net.createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const port = (server.address() as net.AddressInfo).port;
			server.close(() => resolve(port));
		});
	});

export interface RemoteService {
	/** The local end of the forward: http://127.0.0.1:<port>. */
	base: string;
	token: string;
	/** `pine service` there started the daemon, which this connection holds by its stdin: it stops when the connection ends. */
	started: boolean;
	/** The home of that pine, on that machine. */
	home: string;
	version?: string;
	/** The ssh host as given. */
	host: string;
	/** A short name for it: the host name without the user and the domain. */
	label: string;
	/** Ends the connection, and with it the forward (and a daemon it started). */
	stop(): Promise<void>;
	/** Called once when the connection ends by itself. */
	ended: Promise<void>;
}

/**
 * The daemon of another machine, over one ssh connection. It runs `pine service` there (which
 * attaches, or starts one that this ssh then holds by its stdin) and is the master of a control
 * socket. Through that socket a forward from a port of this computer to the daemon's is added
 * (`ssh -O forward`): ssh binds the port itself and says at once when it cannot, so no request is
 * sent to a port that somebody else took, and nobody signs in twice.
 * `ssh` names the program (a stand-in in tests); `env` is the environment it runs in.
 */
export async function connectRemote(value: string, opts: { env?: NodeJS.ProcessEnv; ssh?: string; apart?: boolean } = {}): Promise<RemoteService> {
	const named = sshHost(value);
	if (!named) throw new RemoteError("ssh", "Name the machine as you would after ssh: host or user@host.");
	const { host, label } = named;
	const program = opts.ssh || "ssh";
	const env = opts.env ?? process.env;
	// The control socket, in a folder only this user can open. Windows' OpenSSH has no control
	// sockets: there the forward is a second connection of its own (`forwardApart`).
	const apart = process.platform === "win32" || opts.apart === true;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pine-ssh-"));
	const control = apart ? [] : ["-o", `ControlPath=${path.join(dir, "c")}`];
	const child: ChildProcess = spawn(program, sshArgs(host, apart ? [] : ["-o", "ControlMaster=yes", "-o", "ControlPersist=no", ...control], remoteCommand()), { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
	let gone = false;
	let forward: ChildProcess | undefined;
	const ended = new Promise<void>((done) => child.once("close", () => ((gone = true), forward?.kill(), fs.rmSync(dir, { recursive: true, force: true }), done())));
	const stop = async () => {
		forward?.kill();
		if (gone) return;
		child.kill("SIGTERM");
		const hard = setTimeout(() => child.kill("SIGKILL"), 12_000);
		await ended;
		clearTimeout(hard);
	};
	try {
		const a = await answer(child);
		if ("failed" in a && /unknown command "service"/.test(a.err)) throw new RemoteError("ssh", `The pine on ${host} is too old to be reached this way: it has no "service" command. Update it there with "pine update", then try again.`);
		if ("failed" in a) throw new RemoteError("ssh", sshTrouble(host, a));
		const said = a.said;
		if (said.error) throw new RemoteError("failed", `The pine on ${label} did not start: ${said.error}`);
		const far = loopbackEnd(String(said.base));
		// A port that was free a moment ago may be taken by now: then ssh says so, and another is tried.
		let port = 0;
		let err = "";
		for (let tries = 0; tries < 5 && !port; tries++) {
			const p = await freePort();
			if (apart) {
				const f = await forwardApart(program, host, env, p, far, String(said.token));
				if (gone) break;
				if (f.child) (port = p), (forward = f.child);
				else err = f.err;
				continue;
			}
			const r = await new Promise<{ code: number | null; err: string }>((resolve) => {
				const f = spawn(program, sshArgs(host, [...control, "-O", "forward", "-L", `127.0.0.1:${p}:${far}`]), { env, stdio: ["ignore", "ignore", "pipe"] });
				let e = "";
				f.stderr!.on("data", (d: Buffer) => (e = (e + d.toString("utf8")).slice(-2000)));
				f.once("error", (x) => resolve({ code: -1, err: x.message }));
				f.once("close", (code) => resolve({ code, err: e }));
			});
			if (gone) break;
			if (r.code === 0) port = p;
			else err = r.err.trim();
		}
		if (!port) throw new RemoteError("ssh", gone ? `The SSH connection to ${host} ended before a port of this computer could be forwarded to the pine there.` : `No port of this computer could be forwarded to the pine on ${host}.${err ? ` ssh said: ${err.slice(-400)}` : ""}`);
		return {
			base: `http://127.0.0.1:${port}`,
			token: String(said.token),
			started: said.started === true,
			home: String(said.home ?? "~/.pine"),
			version: typeof said.version === "string" ? said.version : undefined,
			host,
			label,
			stop,
			ended,
		};
	} catch (e) {
		await stop();
		throw e;
	}
}

// ---------------------------------------------------------------------------------------------
// WSL: on Windows, the pine of a Linux distribution that runs on this same computer. It is
// reached as another machine is, with wsl.exe in place of ssh: `pine service` runs there, and its
// one line says where its daemon answers. WSL hands a port that a program in the distribution
// listens on (its loopback too) to Windows' own loopback; where that is switched off, a relay
// carries each connection through wsl.exe instead (`relayed`).

/** Where the Pine app puts the pine it brings into a distribution: found before one on the PATH. */
export const WSL_APP_BIN = "$HOME/.local/share/pine-app/bin";

/** `REMOTE_SCRIPT`, with the pine the app installed in the distribution first on the PATH. */
export const WSL_SCRIPT = REMOTE_SCRIPT.replace("command -v pine", `[ -x "${WSL_APP_BIN}/pine" ] && PATH="${WSL_APP_BIN}:$PATH"; command -v pine`);

/** What may name a distribution: its name as `wsl.exe -l` lists it, never an option. */
export function wslDistro(value: string | undefined): { distro: string; label: string } | undefined {
	const distro = value?.trim();
	if (!distro) return undefined;
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(distro)) throw new RemoteError("ssh", `"${distro.slice(0, 80)}" is not the name of a WSL distribution. The names are those "wsl --list" shows.`);
	return { distro, label: distro };
}

/** wsl.exe writes its own messages in UTF-16; what a program inside the distribution prints is passed through as it is. */
export function wslText(bytes: Buffer): string {
	const utf16 = bytes.length >= 2 && bytes.length % 2 === 0 && bytes.subarray(0, Math.min(bytes.length, 64)).some((b, i) => i % 2 === 1 && b === 0);
	return (utf16 ? bytes.toString("utf16le") : bytes.toString("utf8")).replace(/^﻿/, "").replace(/\0/g, "");
}

/** The distributions this computer has, the default one first. Empty without WSL. */
export async function wslDistros(opts: { wsl?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string[]> {
	const out = await new Promise<Buffer>((resolve) => {
		const c = spawn(opts.wsl || "wsl.exe", ["--list", "--quiet"], { env: opts.env ?? process.env, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
		const parts: Buffer[] = [];
		c.stdout!.on("data", (d: Buffer) => parts.push(d));
		c.on("error", () => resolve(Buffer.alloc(0)));
		c.on("close", (code) => resolve(code === 0 ? Buffer.concat(parts) : Buffer.alloc(0)));
	});
	return wslText(out)
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(l));
}

/** The arguments for wsl.exe that run `script` with sh in the distribution, with no shell of Windows in between. */
export const wslArgs = (distro: string, script: string) => ["--distribution", distro, "--exec", "/bin/sh", "-c", script];

/** What the relay runs in the distribution for one connection: the daemon's port, joined to wsl.exe's stdin and stdout. */
const RELAY = `const s = require("net").connect(Number(process.argv[1]), process.argv[2]); process.stdin.pipe(s); s.pipe(process.stdout); s.on("error", () => process.exit(1)); s.on("close", () => process.exit(0));`;

/** Whether a daemon answers at this address of Windows' loopback. */
const answers = (base: string, token: string) =>
	fetch(`${base}/overview`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) })
		.then((r) => r.ok)
		.catch(() => false);

/**
 * The pine of a WSL distribution on this computer. `wsl` names the program (a stand-in in
 * tests). The connection is wsl.exe running `pine service` there; it holds a daemon that it
 * started by its stdin, as an ssh connection does.
 */
export async function connectWsl(value: string, opts: { env?: NodeJS.ProcessEnv; wsl?: string; direct?: boolean } = {}): Promise<RemoteService> {
	const named = wslDistro(value);
	if (!named) throw new RemoteError("ssh", "Name the WSL distribution, as \"wsl --list\" shows it.");
	const { distro, label } = named;
	const program = opts.wsl || "wsl.exe";
	const env = opts.env ?? process.env;
	const child: ChildProcess = spawn(program, wslArgs(distro, WSL_SCRIPT), { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
	let gone = false;
	let relay: net.Server | undefined;
	const carried = new Set<net.Socket>();
	// Closing the relay takes no new connection; those a client keeps open end with it too.
	const unrelay = () => {
		relay?.close();
		for (const sock of carried) sock.destroy();
	};
	const ended = new Promise<void>((done) => child.once("close", () => ((gone = true), unrelay(), done())));
	const stop = async () => {
		unrelay();
		if (gone) return;
		// The daemon it started ends with its stdin.
		child.stdin?.end();
		const soft = setTimeout(() => child.kill("SIGTERM"), 5000);
		const hard = setTimeout(() => child.kill("SIGKILL"), 12_000);
		await ended;
		clearTimeout(soft);
		clearTimeout(hard);
	};
	try {
		const a = await answer(child);
		if ("failed" in a && /unknown command "service"/.test(a.err)) throw new RemoteError("ssh", `The pine in ${distro} is too old to be reached this way: it has no "service" command. Update it there with "pine update", then try again.`);
		if ("failed" in a) throw new RemoteError("ssh", wslTrouble(distro, a));
		const said = a.said;
		if (said.error) throw new RemoteError("failed", `The pine in ${label} did not start: ${said.error}`);
		const far = loopbackEnd(String(said.base));
		const token = String(said.token);
		let base = `http://${far}`;
		// WSL hands the port to Windows' loopback, unless that is switched off (.wslconfig): then a relay.
		if (opts.direct === false || !(await answers(base, token))) {
			const [host, port] = [far.slice(0, far.lastIndexOf(":")).replace(/^\[|\]$/g, ""), far.slice(far.lastIndexOf(":") + 1)];
			const script = `${WSL_SCRIPT.slice(0, WSL_SCRIPT.indexOf("command -v pine"))}exec node -e '${RELAY.replace(/'/g, "")}' ${port} ${host}`;
			relay = net.createServer((sock) => {
				carried.add(sock);
				sock.once("close", () => carried.delete(sock));
				const c = spawn(program, wslArgs(distro, script), { env, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
				sock.pipe(c.stdin!);
				c.stdout!.pipe(sock);
				const end = () => (sock.destroy(), c.kill());
				sock.on("error", end).on("close", end);
				c.on("error", end).on("close", end);
			});
			await new Promise<void>((resolve, reject) => relay!.once("error", reject).listen(0, "127.0.0.1", () => resolve()));
			base = `http://127.0.0.1:${(relay.address() as net.AddressInfo).port}`;
			if (!(await answers(base, token))) throw new RemoteError("ssh", `The pine in ${distro} started, but this computer reaches it neither on its own loopback nor through wsl.exe.`);
		}
		return { base, token, started: said.started === true, home: String(said.home ?? "~/.pine"), version: typeof said.version === "string" ? said.version : undefined, host: `wsl:${distro}`, label, stop, ended };
	} catch (e) {
		await stop();
		throw e;
	}
}

/** What went wrong with wsl.exe, in words that say what to do. */
function wslTrouble(distro: string, a: Exclude<Answer, { said: any }>): string {
	const said = wslText(Buffer.from(a.err)).trim().slice(-600);
	if (a.failed === "spawn") return "wsl.exe could not be started: this Windows has no WSL. Install it with \"wsl --install\" in a terminal as administrator, then restart Windows.";
	if (a.failed === "timeout") return `${distro} did not answer within a minute.${said ? ` wsl said: ${said}` : ""}`;
	if (/WSL_E_DISTRO_NOT_FOUND|no distribution with the supplied name/i.test(said)) return `There is no WSL distribution called ${distro}. "wsl --list" shows those there are; "wsl --install -d Ubuntu" adds one.`;
	if (a.detail === "127" || /pine is not installed there/.test(said)) return `pine is not installed in ${distro} yet.`;
	return said || `wsl.exe ended (exit ${a.detail}) without saying why.`;
}
