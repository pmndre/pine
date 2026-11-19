// A stand-in for the SSH core (src/ssh.ts) and the machine at its other end: `connect` checks the
// host key fingerprint and the browser's key as sshd would, an exec channel prints what
// `pine service` prints, and a direct-tcpip channel reaches a stand-in daemon, a real HTTP server
// on a loopback port of this computer.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import net, { type AddressInfo } from "node:net";
import { RelayClosed, SshRefused, type Channel, type Connection, type ConnectOptions } from "../src/ssh.ts";

export type Daemon = { port: number; token: string; seen: { method: string; url: string; auth?: string; host?: string; body: string }[]; stop(): Promise<void> };

/** A daemon of the test's own: the token it takes, what it was asked, and a few answers. */
export async function startDaemon(token = "t0ken-of-the-daemon"): Promise<Daemon> {
	const seen: Daemon["seen"] = [];
	const streams = new Set<ServerResponse>();
	const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
		let body = "";
		req.on("data", (d) => (body += d));
		req.on("end", () => {
			seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, host: req.headers.host, body });
			if (req.headers.authorization !== `Bearer ${token}`) return void res.writeHead(401, { "content-type": "application/json" }).end('{"error":"unauthorized"}');
			if (req.url === "/agents") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify([{ id: "main", main: true }]));
			if (req.url === "/agents/main/message") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ echoed: JSON.parse(body) }));
			if (req.url === "/agents/main/image") return void res.writeHead(200, { "content-type": "image/png" }).end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
			// Media the page may ask for, and some it may not be shown (src/host.test.ts).
			if (req.url === "/media/tool/t1") return void res.writeHead(200, { "content-type": "image/png" }).end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
			if (req.url === "/agents/main/image?path=clip.mp4&session=s1") return void res.writeHead(200, { "content-type": "video/mp4" }).end(Buffer.from("not really a video"));
			if (req.url === "/media/tool/page") return void res.writeHead(200, { "content-type": "text/html" }).end("<script>alert(1)</script>");
			if (req.url === "/media/tool/drawing") return void res.writeHead(200, { "content-type": "image/svg+xml" }).end("<svg/>");
			if (req.url?.startsWith("/events/stream")) {
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.write(`data: ${JSON.stringify({ topic: "pine/hello", payload: { n: 1 } })}\n\n`);
				streams.add(res);
				res.on("close", () => streams.delete(res));
				return;
			}
			res.writeHead(404, { "content-type": "application/json" }).end('{"error":"not found"}');
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		port: (server.address() as AddressInfo).port,
		token,
		seen,
		async stop() {
			for (const res of streams) res.destroy();
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		},
	};
}

/** A channel on a Node socket. */
function socketChannel(socket: net.Socket): Channel {
	const closed = new Promise<{ exitStatus?: number }>((resolve) => socket.once("close", () => resolve({})));
	return {
		onData: (fn) => void socket.on("data", (d: Buffer) => fn(new Uint8Array(d))),
		onStderr: () => {},
		send: async (bytes) => void socket.write(typeof bytes === "string" ? bytes : Buffer.from(bytes)),
		close: async () => void socket.end(),
		closed,
	};
}

/** An exec channel that prints `out` and `err` and, with `exit`, ends with that status; without it, it stays open (cat). */
function execChannel(out: string, err: string, exit?: number): Channel & { ended: boolean } {
	let ended = false;
	let finish!: (v: { exitStatus?: number }) => void;
	const closed = new Promise<{ exitStatus?: number }>((resolve) => (finish = resolve));
	const channel = {
		get ended() {
			return ended;
		},
		onData: (fn: (b: Uint8Array) => void) => void setTimeout(() => out && fn(new TextEncoder().encode(out)), 1),
		onStderr: (fn: (b: Uint8Array) => void) => void setTimeout(() => err && fn(new TextEncoder().encode(err)), 1),
		send: async () => {},
		close: async () => {
			ended = true;
			finish({});
		},
		closed,
	};
	if (exit !== undefined) setTimeout(() => ((ended = true), finish({ exitStatus: exit })), 5);
	return channel;
}

export type Machine = {
	/** The host key's fingerprint the machine shows now. */
	fingerprint: string;
	/** Whether the browser's key is in authorized_keys. */
	authorized: boolean;
	/** What `pine service` prints there, its standard error and how it exits (none: it stays, as `cat` holds it). */
	service: { out: string; err?: string; exit?: number };
	/** Each connection: the relay address, the user and the fingerprint it was told to accept. */
	connects: { url: string; user: string; hostFingerprint: string }[];
	/** Each command run and each forward asked for. */
	commands: string[];
	forwards: { host: string; port: number }[];
	/** Connections open now. */
	open: number;
	/** Whether the relay reaches the machine; false: the relay closes with "unreachable" (4504), "refused": the relay refuses before the WebSocket opens, "tls": no TLS from a Funnel name (4525). */
	reachable: boolean | "refused" | "tls";
	/** Cuts every open connection, as a relay that restarts or a network that drops does. */
	drop(): void;
	connect(options: ConnectOptions): Promise<Connection>;
};

export const fp = (c: string) => `SHA256:${c.repeat(43)}`;

/** A machine whose pine runs the daemon given, at its port on the loopback. */
export function fakeMachine(daemon: Daemon): Machine {
	const cuts = new Set<() => void>();
	const m: Machine = {
		fingerprint: fp("h"),
		authorized: true,
		service: { out: `${JSON.stringify({ base: `http://127.0.0.1:${daemon.port}`, token: daemon.token, started: true, home: "~/.pine", version: "0.50.0", mode: "attached" })}\n` },
		connects: [],
		commands: [],
		forwards: [],
		open: 0,
		reachable: true,
		drop() {
			for (const cut of [...cuts]) cut();
		},
		async connect(options) {
			m.connects.push({ url: options.url, user: options.user, hostFingerprint: options.hostFingerprint });
			if (m.reachable === "refused") throw new RelayClosed(0, "");
			if (m.reachable === "tls") throw new RelayClosed(4525, "No TLS from the server: Tailscale Funnel may be off for this port.");
			if (!m.reachable) throw new RelayClosed(4504, "The server could not be reached.");
			if (options.hostFingerprint !== m.fingerprint) throw new SshRefused("host-key", "not the confirmed key", m.fingerprint);
			if (!m.authorized) throw new SshRefused("not-authorized", "key refused");
			m.open++;
			let gone = false;
			let ended!: () => void;
			const closed = new Promise<void>((resolve) => (ended = resolve));
			const sockets = new Set<net.Socket>();
			const execs = new Set<Channel>();
			const cut = () => {
				if (!gone) m.open--;
				gone = true;
				cuts.delete(cut);
				for (const s of sockets) s.destroy();
				for (const e of execs) void e.close();
				ended();
			};
			cuts.add(cut);
			return {
				async exec(command) {
					if (gone) throw new Error("the connection is closed");
					m.commands.push(command);
					const channel = execChannel(m.service.out, m.service.err ?? "", m.service.exit);
					execs.add(channel);
					return channel;
				},
				async forward(host, port) {
					if (gone) throw new Error("the connection is closed");
					m.forwards.push({ host, port });
					const socket = net.connect(daemon.port, "127.0.0.1");
					sockets.add(socket);
					await new Promise((resolve, reject) => socket.once("connect", resolve).once("error", reject));
					return socketChannel(socket);
				},
				async close() {
					cut();
				},
				closed,
			};
		},
	};
	return m;
}
