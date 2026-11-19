// What the relay's tests stand in for: the Worker's WebSocket pair, Cloudflare's connect() (a
// Node socket to a server of the test's own on a loopback port) and the rate-limiting binding.
import net from "node:net";
import { Duplex } from "node:stream";
import type { Deps, RelaySocket, RelayWebSocket, TcpSocket } from "./src/relay.ts";

type Listener = (event: any) => void;

/** One end of a WebSocket pair: what one side sends, the other side's listeners receive. */
class End implements RelayWebSocket {
	other!: End;
	listeners: Record<string, Listener[]> = {};
	closed: { code?: number; reason?: string } | null = null;
	/** As in workerd, where the standard default holds: a binary message arrives as a Blob unless "arraybuffer" was asked for. */
	binaryType: "blob" | "arraybuffer" = "blob";
	accept() {}
	addEventListener(type: string, listener: Listener) {
		(this.listeners[type] ??= []).push(listener);
	}
	send(data: ArrayBuffer | ArrayBufferView | string) {
		if (this.closed || this.other.closed) return;
		const copy = typeof data === "string" ? data : new Uint8Array(ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data).buffer;
		queueMicrotask(() => this.other.emit("message", { data: typeof copy === "string" || this.other.binaryType === "arraybuffer" ? copy : new Blob([copy as ArrayBuffer]) }));
	}
	close(code?: number, reason?: string) {
		if (this.closed) return;
		this.closed = { code, reason };
		queueMicrotask(() => {
			if (!this.other.closed) this.other.closed = { code, reason };
			this.other.emit("close", { code, reason });
		});
	}
	emit(type: string, event: any) {
		for (const listener of this.listeners[type] ?? []) listener(event);
	}
}

/** The browser's end of a connection through the relay: what it received, and a way to wait for it. */
export class Client {
	end: End;
	received = Buffer.alloc(0);
	closedWith: Promise<{ code?: number; reason?: string }>;
	constructor(end: End) {
		this.end = end;
		// As the bridge does with its WebSocket (web/src/ssh.ts).
		end.binaryType = "arraybuffer";
		end.addEventListener("message", (event) => {
			this.received = Buffer.concat([this.received, Buffer.from(typeof event.data === "string" ? event.data : new Uint8Array(event.data))]);
		});
		this.closedWith = new Promise((resolve) => end.addEventListener("close", (event) => resolve(event)));
	}
	send(text: string | Uint8Array) {
		this.end.send(typeof text === "string" ? new TextEncoder().encode(text) : text);
	}
	sendText(text: string) {
		this.end.send(text);
	}
	async sees(text: string, ms = 2000) {
		const until = Date.now() + ms;
		while (!this.received.toString("latin1").includes(text)) {
			if (Date.now() > until) throw new Error(`never saw ${JSON.stringify(text)}; saw ${JSON.stringify(this.received.toString("latin1"))}`);
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
	}
	/** How the relay closed the connection; fails when it stays open. */
	closes(ms = 2000) {
		let timer: NodeJS.Timeout;
		const late = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error(`still open after ${ms} ms`)), ms);
		});
		return Promise.race([this.closedWith, late]).finally(() => clearTimeout(timer));
	}
}

/** A TCP server on a loopback port at port 0, which runs `onConnection` for each connection. */
export async function server(onConnection: (socket: net.Socket) => void) {
	const sockets = new Set<net.Socket>();
	const srv = net.createServer((socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.on("error", () => {});
		onConnection(socket);
	});
	await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
	const port = (srv.address() as net.AddressInfo).port;
	return {
		port,
		async stop() {
			for (const socket of sockets) socket.destroy();
			await new Promise((resolve) => srv.close(resolve));
		},
	};
}

/** An SSH server's opening as far as the relay cares: its identification line, then an echo. */
export function sshEcho(received: Buffer[]) {
	return (socket: net.Socket) => {
		socket.write("SSH-2.0-OpenSSH_9.9\r\n");
		socket.on("data", (chunk: Buffer) => {
			received.push(chunk);
			if (Buffer.concat(received).includes("\n")) socket.write(chunk);
		});
	};
}

/** What connect() was given: the address, and `secureTransport` when TLS was asked for. */
export type Call = { hostname: string; port: number; secureTransport?: "on" };

/** Cloudflare's connect(), to the test server whatever address it is given; notes what it was given. TLS is noted, not spoken. */
export function connectTo(port: number, calls: Call[] = []): Deps["connect"] {
	return (address, options) => {
		calls.push(options ? { ...address, ...options } : address);
		const socket = net.connect(port, "127.0.0.1");
		socket.on("error", () => {});
		const web = Duplex.toWeb(socket) as unknown as { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
		const opened = new Promise<void>((resolve, reject) => {
			socket.once("connect", () => resolve());
			socket.once("error", reject);
		});
		const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
		return {
			readable: web.readable,
			writable: web.writable,
			opened,
			closed,
			close: async () => {
				socket.destroy();
			},
		};
	};
}

/** The rate-limiting binding: `limit` successes per key, then refusals. */
export function limiter(limit = 100) {
	const counts = new Map<string, number>();
	return {
		keys: counts,
		async limit({ key }: { key: string }) {
			const count = (counts.get(key) ?? 0) + 1;
			counts.set(key, count);
			return { success: count <= limit };
		},
	};
}

/** Builds the pair the Worker would, and keeps the browser's end for the test. */
export function pairs() {
	const clients: Client[] = [];
	const upgrade = (): RelaySocket => {
		const browser = new End();
		const worker = new End();
		browser.other = worker;
		worker.other = browser;
		clients.push(new Client(browser));
		return { socket: worker, response: new Response(null, { status: 200, headers: { "x-upgraded": "1" } }) };
	};
	return { clients, upgrade };
}

/** A request for the relay as a browser's WebSocket would make it. */
export function request(host: string, port = 22, ip = "198.51.100.1", path = "/ssh") {
	return new Request(`https://relay.example${path}?host=${encodeURIComponent(host)}&port=${port}`, {
		headers: { Upgrade: "websocket", "CF-Connecting-IP": ip },
	});
}

/** The names a test lets resolve, everything else unknown. */
export function names(table: Record<string, string[]>): Deps["resolve"] {
	return async (name) => table[name] ?? [];
}
