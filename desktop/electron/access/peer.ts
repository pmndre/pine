// A WebRTC peer connection for browser access, and its one data channel as a byte stream: the
// browser makes the offer and the channel labelled `ssh`, the computer answers (`answer`), and SSH runs
// over the stream as over a socket. No Electron here, so that it runs under plain Node in tests.
// The signals are the meeting service's `d` values ({sdp} or {ice}), passed through as they are.
import { createRequire } from "node:module";
import net from "node:net";
import { Duplex } from "node:stream";
import { lookup } from "node:dns/promises";
import type { DataChannel, IceServer as IceServerConfig, PeerConnection } from "node-datachannel";

/** A message for the other peer, in the shape a browser's RTCPeerConnection gives and takes. */
export type Signal = { sdp: { type: string; sdp: string } } | { ice: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } };

/** A server that helps a connection, as a browser's RTCIceServer names it. */
export interface IceServer {
	urls: string | string[];
}

/**
 * How a connection reached the other peer: inside the same network, directly over IPv4 or IPv6, or
 * through the owner's relay (TURN) server.
 */
export type PeerPath = "lan" | "ipv4" | "ipv6" | "relay";

/**
 * A relay (TURN) server of the owner's own: where it is, and the user name and password it takes.
 * It is reached over UDP: the library is built on libjuice, which has no TURN over TCP or TLS. Only
 * the computer's side has one.
 */
export interface RelayServer {
	hostname: string;
	port: number;
	username: string;
	password: string;
}

export interface Peer {
	/** Hands this peer a message the other one sent. */
	signal(d: Signal): void;
	/** The `ssh` channel as a byte stream, once it is open. Rejected when it never opens. */
	channel: Promise<Duplex>;
	/** The path the connection chose, once it is connected. */
	path(): PeerPath | undefined;
	/** How many bytes wait in the channel to be sent. */
	buffered(): number;
	/** Ends the connection; the other peer's stream ends with it. */
	close(): void;
	/** Settles when the connection is closed, from either side. */
	closed: Promise<void>;
}

export interface PeerOptions {
	/** The servers that help (STUN). Empty: only the addresses of this computer's own interfaces. */
	ice: IceServer[];
	/**
	 * The owner's relay server, besides `ice`: the computer reserves an address on it and offers it as
	 * one more candidate. ICE still prefers a direct path; the relay is used where none is found.
	 */
	relay?: RelayServer;
	/** Tests only: no candidate but the relay's, so that two peers on one computer can only meet through it. */
	onlyRelay?: boolean;
	/** Sends a message to the other peer (through the meeting service). */
	send(d: Signal): void;
	/** How long the channel may take to open, in milliseconds. */
	timeoutMs?: number;
}

/** The channel the browser opens and the computer takes. */
export const LABEL = "ssh";
/** Messages are cut to this: the size every browser's data channel carries without trouble. */
export const PIECE = 16 * 1024;
/** A writer waits while more than this waits in the channel, and goes on below `LOW`. */
const HIGH = 1024 * 1024;
const LOW = 256 * 1024;

type Module = typeof import("node-datachannel");
let loaded: Module | Error | undefined;

/**
 * node-datachannel, loaded on the first connection: a system without its prebuilt binary gets a
 * sentence, not a crash of the app. (Its loader requires the binary of this system's package.)
 */
function datachannel(): Module {
	if (loaded instanceof Error) throw loaded;
	if (loaded) return loaded;
	try {
		loaded = createRequire(import.meta.url)("node-datachannel") as Module;
		return loaded;
	} catch (e) {
		loaded = new Error(`Browser access cannot connect on this system: ${e instanceof Error ? e.message : e}`);
		throw loaded;
	}
}

/** The computer's side: waits for the browser's offer and its `ssh` channel. */
export function answer(options: PeerOptions): Peer {
	return start(options, undefined);
}

/** The browser's side, for tests and the smoke run: makes the offer and the channel (`label`, `ssh` by default). */
export function offer(options: PeerOptions & { label?: string }): Peer {
	return start(options, options.label ?? LABEL);
}

let count = 0;
let live = 0;

/**
 * The library's threads hold Node's event loop until it is told to let go: when the last
 * connection has closed, it is (outside its own callbacks, which may be the ones closing).
 */
function release(ndc: Module) {
	setImmediate(() => live === 0 && ndc.cleanup());
}

function start(options: PeerOptions, label: string | undefined): Peer {
	const ndc = datachannel();
	const pc: PeerConnection = new ndc.PeerConnection(`pine-${++count}`, { iceServers: iceServersOf(options.ice, options.relay), ...(options.onlyRelay ? { iceTransportPolicy: "relay" as const } : {}) });
	live++;
	let done = false;
	let stream: ChannelStream | undefined;
	// Every channel is closed with the connection: one left open keeps Node's event loop alive.
	const channels: DataChannel[] = [];
	let resolveClosed!: () => void;
	const closed = new Promise<void>((r) => (resolveClosed = r));
	let resolveChannel!: (s: Duplex) => void;
	let rejectChannel!: (e: Error) => void;
	const channel = new Promise<Duplex>((res, rej) => ((resolveChannel = res), (rejectChannel = rej)));
	// Nobody may be waiting for the channel when it fails: that is no unhandled rejection.
	channel.catch(() => {});

	const close = (why?: string) => {
		if (done) return;
		done = true;
		clearTimeout(timer);
		rejectChannel(new Error(why ?? "the connection closed before the channel opened"));
		stream?.gone();
		try {
			for (const dc of channels) dc.close();
			pc.close();
		} catch {
			// already closed
		}
		live--;
		release(ndc);
		resolveClosed();
	};
	const timer = setTimeout(() => close("no ssh channel opened in time"), options.timeoutMs ?? 30_000);

	const take = (dc: DataChannel) => {
		channels.push(dc);
		if (dc.getLabel() !== LABEL || stream) {
			dc.close();
			return;
		}
		const open = () => {
			if (done) return;
			clearTimeout(timer);
			stream = new ChannelStream(dc, () => close());
			resolveChannel(stream);
		};
		if (dc.isOpen()) open();
		else dc.onOpen(open);
	};

	pc.onLocalDescription((sdp, type) => !done && options.send({ sdp: { type, sdp } }));
	pc.onLocalCandidate((candidate, mid) => !done && options.send({ ice: { candidate, sdpMid: mid, sdpMLineIndex: 0 } }));
	pc.onStateChange((state) => {
		if (state === "closed" || state === "failed") close(`the connection ${state}`);
	});
	if (label === undefined) pc.onDataChannel(take);
	else {
		const dc = pc.createDataChannel(label);
		// A channel of another name (a test's) is opened and nothing else: the other side refuses it.
		if (label === LABEL) take(dc);
		else channels.push(dc);
	}

	return {
		signal(d) {
			if (done || !d || typeof d !== "object") return;
			try {
				if ("sdp" in d && d.sdp && typeof d.sdp.sdp === "string" && (d.sdp.type === "offer" || d.sdp.type === "answer")) pc.setRemoteDescription(d.sdp.sdp, d.sdp.type);
				// An empty candidate is a browser's "no more candidates": there is nothing to add.
				else if ("ice" in d && d.ice && typeof d.ice.candidate === "string" && d.ice.candidate) pc.addRemoteCandidate(d.ice.candidate, d.ice.sdpMid ?? "0");
			} catch {
				// A message that does not fit this connection changes nothing: the connection times out.
			}
		},
		channel,
		path() {
			if (done) return undefined;
			const pair = pc.getSelectedCandidatePair();
			return pair ? pathOfPair(pair) : undefined;
		},
		buffered: () => stream?.buffered() ?? 0,
		close: () => close(),
		closed,
	};
}

/**
 * The servers a connection is handed: the STUN servers of the service's list, and a TURN entry from
 * the owner's own setting alone (`relay`), never from the service's list.
 */
export function iceServersOf(ice: IceServer[], relay?: RelayServer): Array<string | IceServerConfig> {
	const servers: Array<string | IceServerConfig> = ice.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls])).filter((u) => /^stuns?:/.test(u));
	if (relay) servers.push(iceServerOf(relay));
	return servers;
}

/**
 * The relay as node-datachannel takes it: an object, so that no user name or password is written
 * into a URL. Both are always strings, empty or not: the library throws for a relay without both.
 */
export function iceServerOf(relay: RelayServer): IceServerConfig {
	return { hostname: relay.hostname, port: relay.port, relayType: "TurnUdp", username: relay.username, password: relay.password };
}

/**
 * What a try of a relay found. `usable`: it gave this computer an address. `refused`: it answered
 * and gave none, which a TURN server does when the user name or password is wrong (the library does
 * not say which error the server sent, so another refusal reads the same). `silent`: nothing came
 * back in time. `unknown`: its name was not found. `unavailable`: the library cannot run here.
 */
export type RelayTry = "usable" | "refused" | "silent" | "unknown" | "unavailable";

/**
 * Tries to reserve an address on a relay: a connection of its own that gathers relay candidates
 * only, closed as soon as one comes, or gathering ends without one, or `ms` is over. Never throws,
 * and says nothing of the password.
 */
export async function tryRelay(relay: RelayServer, ms = 5000): Promise<RelayTry> {
	let ndc: Module;
	try {
		ndc = datachannel();
	} catch {
		return "unavailable";
	}
	if (!net.isIP(relay.hostname)) {
		try {
			await lookup(relay.hostname);
		} catch {
			return "unknown";
		}
	}
	let pc: PeerConnection;
	try {
		pc = new ndc.PeerConnection(`pine-relay-${++count}`, { iceServers: [iceServerOf(relay)], iceTransportPolicy: "relay" });
	} catch {
		return "refused";
	}
	live++;
	return new Promise<RelayTry>((resolve) => {
		let done = false;
		let dc: DataChannel | undefined;
		const end = (result: RelayTry) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			// Closed outside the library's own callback, which may be the one ending the try. The
			// channel first: one left to the library's cleanup after its connection closed is freed
			// memory there, and the app crashes.
			setImmediate(() => {
				try {
					dc?.close();
					pc.close();
				} catch {
					// already closed
				}
				live--;
				release(ndc);
			});
			resolve(result);
		};
		const timer = setTimeout(() => end("silent"), ms);
		pc.onLocalCandidate((candidate) => / typ relay\b/.test(candidate) && end("usable"));
		pc.onGatheringStateChange((state) => state === "complete" && end("refused"));
		try {
			// A channel is what starts gathering; it never opens.
			dc = pc.createDataChannel("relay-try");
		} catch {
			end("refused");
		}
	});
}

/** The path of the pair a connection chose: through the relay when either end is an address on it, else by the addresses. */
export function pathOfPair(pair: { local: { type: string; address: string }; remote: { type: string; address: string } }): PeerPath {
	if (pair.local.type === "relay" || pair.remote.type === "relay") return "relay";
	return pathOf(pair.remote.address, pair.local.address);
}

/** Same network when the other peer's address is one no network outside would hand out. */
export function pathOf(remote: string, local: string): PeerPath {
	const [r, l] = [plain(remote), plain(local)];
	if (nearby(r) && nearby(l)) return "lan";
	return net.isIPv6(r) ? "ipv6" : "ipv4";
}

/** An IPv4 address written as IPv6 (`::ffff:a.b.c.d`) is the IPv4 one. */
function plain(address: string): string {
	return address.toLowerCase().replace(/^::ffff:(?=\d+\.)/, "");
}

function nearby(a: string): boolean {
	if (net.isIPv4(a)) {
		const [x, y] = a.split(".").map(Number);
		return x === 10 || x === 127 || (x === 172 && y >= 16 && y < 32) || (x === 192 && y === 168) || (x === 169 && y === 254);
	}
	return a === "::1" || /^fe[89ab]/.test(a) || /^f[cd]/.test(a);
}

/** A data channel as a byte stream: writes cut into pieces, and held while the channel is full. */
class ChannelStream extends Duplex {
	#dc: DataChannel;
	#onGone: () => void;
	#waiting: (() => void) | undefined;
	#over = false;

	constructor(dc: DataChannel, onGone: () => void) {
		super({ allowHalfOpen: false });
		this.#dc = dc;
		this.#onGone = onGone;
		dc.setBufferedAmountLowThreshold(LOW);
		dc.onBufferedAmountLow(() => this.#resume());
		// A data channel cannot be paused: what arrives is held by the stream until it is read.
		// SSH's own windows keep that small.
		dc.onMessage((msg) => this.push(typeof msg === "string" ? Buffer.from(msg) : Buffer.from(msg as ArrayBuffer)));
		dc.onClosed(() => this.#onGone());
		dc.onError(() => this.#onGone());
	}

	buffered(): number {
		return this.#over ? 0 : this.#dc.bufferedAmount();
	}

	/** The channel or the connection is gone: the readable side ends, and nothing more is written. */
	gone() {
		if (this.#over) return;
		this.#over = true;
		this.#resume();
		// Ended, not destroyed: what arrived before is still read to the end.
		this.push(null);
	}

	#resume() {
		const go = this.#waiting;
		this.#waiting = undefined;
		go?.();
	}

	override _read() {}

	override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (e?: Error | null) => void) {
		let at = 0;
		const next = () => {
			if (this.#over) return callback(new Error("the channel is closed"));
			try {
				while (at < chunk.length) {
					if (this.#dc.bufferedAmount() > HIGH) {
						this.#waiting = next;
						return;
					}
					const piece = chunk.subarray(at, at + PIECE);
					at += piece.length;
					this.#dc.sendMessageBinary(piece);
				}
			} catch (e) {
				return callback(e instanceof Error ? e : new Error(String(e)));
			}
			callback();
		};
		next();
	}

	/** The writer is done: what waits in the channel is sent first, then the connection closes. */
	override _final(callback: () => void) {
		const finish = () => (this.#onGone(), callback());
		if (this.#over || this.#dc.bufferedAmount() === 0) return finish();
		this.#dc.setBufferedAmountLowThreshold(0);
		this.#waiting = finish;
	}

	override _destroy(error: Error | null, callback: (e: Error | null) => void) {
		if (!this.#over) {
			this.#over = true;
			this.#resume();
			this.#onGone();
		}
		callback(error);
	}
}
