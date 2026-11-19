import crypto from "node:crypto";
import http from "node:http";
import type { Duplex } from "node:stream";

// A WebSocket server for tests, as small as the protocol allows: the handshake, the client's
// (masked) text frames in, text frames out, ping, pong and close. One process, no dependency.

export interface WsConn {
	/** The path and query the client asked for. */
	url: string;
	headers: http.IncomingHttpHeaders;
	/** What the client sent, in order: parsed JSON where it is JSON, else the text. */
	received: any[];
	/** How many pings the client sent, and how many of this server's pings it answered. */
	pings: number;
	pongs: number;
	open: boolean;
	send(message: unknown): void;
	ping(): void;
	close(code?: number): void;
	/** Cut the connection without a closing frame, as a network that went away does. */
	drop(): void;
}

export interface WsServer {
	port: number;
	/** ws://127.0.0.1:<port> */
	url: string;
	/** http://127.0.0.1:<port> */
	base: string;
	conns: WsConn[];
	/** The connections that are open now. */
	live(): WsConn[];
	close(): Promise<void>;
}

function frame(opcode: number, payload: Buffer): Buffer {
	const head = payload.length < 126 ? Buffer.from([0x80 | opcode, payload.length]) : payload.length < 65536 ? Buffer.from([0x80 | opcode, 126, payload.length >> 8, payload.length & 0xff]) : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(payload.length)); return b; })()]);
	return Buffer.concat([head, payload]);
}

/**
 * Start one. `onConnect` is called for every WebSocket that was accepted, `onMessage` for every
 * message of a client; `web` answers the requests that are not a WebSocket, so that one server
 * can be a service's web API and its socket at once. `accept` may turn a handshake away.
 */
export async function wsServer(o: { onConnect?: (c: WsConn) => void; onMessage?: (c: WsConn, message: any) => void; web?: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void; accept?: (req: http.IncomingMessage) => boolean } = {}): Promise<WsServer> {
	const conns: WsConn[] = [];
	const sockets = new Set<Duplex>();
	const server = http.createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (d) => chunks.push(d));
		req.on("end", () => (o.web ? o.web(req, res, Buffer.concat(chunks).toString("utf8")) : void res.writeHead(404).end("no")));
	});
	server.on("upgrade", (req, socket) => {
		if (o.accept && !o.accept(req)) return void socket.end("HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n");
		const accept = crypto.createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
		socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
		sockets.add(socket);
		const write = (opcode: number, payload: Buffer) => {
			if (!socket.destroyed && socket.writable) socket.write(frame(opcode, payload));
		};
		const conn: WsConn = {
			url: req.url ?? "",
			headers: req.headers,
			received: [],
			pings: 0,
			pongs: 0,
			open: true,
			send: (message) => write(1, Buffer.from(typeof message === "string" ? message : JSON.stringify(message))),
			ping: () => write(9, Buffer.alloc(0)),
			close: (code = 1000) => {
				const b = Buffer.alloc(2);
				b.writeUInt16BE(code);
				write(8, b);
				conn.open = false;
				socket.end();
			},
			drop: () => {
				conn.open = false;
				socket.destroy();
			},
		};
		conns.push(conn);
		let buffer = Buffer.alloc(0);
		let parts: Buffer[] = [];
		socket.on("data", (d: Buffer) => {
			buffer = Buffer.concat([buffer, d]);
			for (;;) {
				if (buffer.length < 2) return;
				const fin = (buffer[0] & 0x80) !== 0;
				const opcode = buffer[0] & 0x0f;
				const masked = (buffer[1] & 0x80) !== 0;
				let len = buffer[1] & 0x7f;
				let at = 2;
				if (len === 126) {
					if (buffer.length < 4) return;
					len = buffer.readUInt16BE(2);
					at = 4;
				} else if (len === 127) {
					if (buffer.length < 10) return;
					len = Number(buffer.readBigUInt64BE(2));
					at = 10;
				}
				const need = at + (masked ? 4 : 0) + len;
				if (buffer.length < need) return;
				const mask = masked ? buffer.subarray(at, at + 4) : undefined;
				const payload = Buffer.from(buffer.subarray(at + (masked ? 4 : 0), need));
				if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
				buffer = buffer.subarray(need);
				if (opcode === 8) {
					conn.open = false;
					write(8, payload.subarray(0, 2));
					socket.end();
					return;
				}
				if (opcode === 9) {
					conn.pings++;
					write(10, payload);
					continue;
				}
				if (opcode === 10) {
					conn.pongs++;
					continue;
				}
				parts.push(payload);
				if (!fin) continue;
				const text = Buffer.concat(parts).toString("utf8");
				parts = [];
				let message: any = text;
				try {
					message = JSON.parse(text);
				} catch {
					// plain text
				}
				conn.received.push(message);
				o.onMessage?.(conn, message);
			}
		});
		const gone = () => {
			conn.open = false;
			sockets.delete(socket);
		};
		socket.on("close", gone);
		socket.on("error", gone);
		o.onConnect?.(conn);
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const port = (server.address() as any).port as number;
	return {
		port,
		url: `ws://127.0.0.1:${port}`,
		base: `http://127.0.0.1:${port}`,
		conns,
		live: () => conns.filter((c) => c.open),
		close: () =>
			new Promise<void>((r) => {
				for (const s of sockets) s.destroy();
				server.closeAllConnections();
				server.close(() => r());
			}),
	};
}
