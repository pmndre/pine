// A server of the test's own on this computer: a real sshd on a loopback port with its own
// configuration, host key and authorized_keys in a temp folder, an echo server on another
// loopback port for direct-tcpip, and a WebSocket-to-TCP pipe that stands in for the relay.
// Nothing here touches ~/.ssh or the system's sshd.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, connect, type AddressInfo, type Server } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";

export type Machine = {
	/** The address of the WebSocket pipe to sshd, as the browser opens it. */
	wsUrl: string;
	/** sshd's own port on the loopback. */
	sshPort: number;
	user: string;
	/** The host key's fingerprint as `ssh-keygen -l` prints it ("SHA256:..."). */
	hostFingerprint: string;
	/** A port on the server's loopback that echoes what it receives. */
	echoPort: number;
	authorize(publicKeyLine: string): void;
	/** What sshd logged so far. */
	log(): string;
	stop(): Promise<void>;
};

const SSHD = "/usr/sbin/sshd";

export async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	await new Promise((resolve) => server.close(resolve));
	return port;
}

async function listen(server: Server): Promise<number> {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return (server.address() as AddressInfo).port;
}

async function waitForPort(port: number, sshd: ChildProcess, logFile: string): Promise<void> {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		if (sshd.exitCode !== null) throw new Error(`sshd exited: ${readFileSync(logFile, "utf8")}`);
		const open = await new Promise<boolean>((resolve) => {
			const socket = connect(port, "127.0.0.1");
			socket.once("connect", () => {
				socket.destroy();
				resolve(true);
			});
			socket.once("error", () => resolve(false));
		});
		if (open) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`sshd did not listen on ${port}: ${readFileSync(logFile, "utf8")}`);
}

/** `env`: variables sshd sets for every session (its `SetEnv`), over the ones it sets itself. */
export async function startMachine(options: { env?: Record<string, string> } = {}): Promise<Machine> {
	const dir = mkdtempSync(join(tmpdir(), "pine-web-sshd-"));
	const hostKey = join(dir, "host_ed25519");
	execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "", "-f", hostKey]);
	const hostFingerprint = execFileSync("ssh-keygen", ["-l", "-E", "sha256", "-f", `${hostKey}.pub`], { encoding: "utf8" }).split(" ")[1];
	const authorizedKeys = join(dir, "authorized_keys");
	writeFileSync(authorizedKeys, "", { mode: 0o600 });
	const logFile = join(dir, "sshd.log");
	writeFileSync(logFile, "");
	const sshPort = await freePort();
	const config = join(dir, "sshd_config");
	writeFileSync(config, [
		`Port ${sshPort}`,
		"ListenAddress 127.0.0.1",
		`HostKey ${hostKey}`,
		`AuthorizedKeysFile ${authorizedKeys}`,
		"PubkeyAuthentication yes",
		"PasswordAuthentication no",
		"KbdInteractiveAuthentication no",
		"UsePAM no",
		"StrictModes no",
		"AllowTcpForwarding local",
		"LogLevel VERBOSE",
		...(options.env && Object.keys(options.env).length ? [`SetEnv ${Object.entries(options.env).map(([k, v]) => `${k}=${v}`).join(" ")}`] : []),
		`PidFile ${join(dir, "sshd.pid")}`,
		"",
	].join("\n"));
	const sshd = spawn(SSHD, ["-D", "-e", "-f", config], { stdio: ["ignore", "ignore", "pipe"] });
	let logged = "";
	sshd.stderr!.on("data", (chunk) => {
		logged += chunk;
		writeFileSync(logFile, logged);
	});
	await waitForPort(sshPort, sshd, logFile);

	const echo = createServer((socket) => socket.pipe(socket));
	const echoPort = await listen(echo);

	const pipe = new WebSocketServer({ host: "127.0.0.1", port: 0 });
	await new Promise((resolve) => pipe.once("listening", resolve));
	pipe.on("connection", (ws) => {
		const tcp = connect(sshPort, "127.0.0.1");
		tcp.on("data", (data) => ws.send(data));
		tcp.on("close", () => ws.close());
		tcp.on("error", () => ws.close());
		ws.on("message", (data) => tcp.write(data as Buffer));
		ws.on("close", () => tcp.destroy());
	});
	const wsUrl = `ws://127.0.0.1:${(pipe.address() as AddressInfo).port}`;

	return {
		wsUrl,
		sshPort,
		user: userInfo().username,
		hostFingerprint,
		echoPort,
		authorize(line) {
			writeFileSync(authorizedKeys, `${line}\n`, { mode: 0o600 });
		},
		log: () => logged,
		async stop() {
			sshd.kill();
			for (const client of pipe.clients) client.terminate();
			await new Promise((resolve) => pipe.close(resolve));
			echo.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}
