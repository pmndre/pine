// The access server (electron/access/server.ts) through the door its users come through: a real
// SSH client (ssh2's) over an in-memory stream, a stand-in for this computer's daemon on a port
// of the test's own, and the store with a memory vault. No network, no window.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import net from "node:net";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { after, before, test } from "node:test";
import ssh2 from "ssh2";
import type { Client, ClientChannel, ConnectConfig } from "ssh2";
import { remoteCommand } from "../../src/remote.ts";
import { type AccessServer, type AccessServerOptions, createAccessServer, pairedKeys, type SessionEvent } from "../electron/access/server.ts";
import { duplexPair } from "../electron/access/stand-in.ts";
import { AccessStore, memoryVault, newEd25519Key } from "../electron/access/store.ts";

/** The stand-in daemon: echoes what it is sent, after a word of its own. */
let daemon: net.Server;
let daemonPort: number;
let otherPort: number;
let other: net.Server;

before(async () => {
	daemon = net.createServer((socket) => {
		socket.write("daemon:");
		socket.pipe(socket);
	});
	other = net.createServer((socket) => socket.end("other"));
	await new Promise<void>((r) => daemon.listen(0, "127.0.0.1", r));
	await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
	daemonPort = (daemon.address() as AddressInfo).port;
	otherPort = (other.address() as AddressInfo).port;
});

after(() => {
	daemon.close();
	other.close();
});

const serviceLine = (port = daemonPort) => JSON.stringify({ base: `http://127.0.0.1:${port}`, token: "the-token", mode: "safe", started: true, home: "/nowhere", version: "0.0.0" });

/** A key pair as OpenSSH writes it (not ssh2's generator, which gets one Ed25519 key in 128 wrong). */
const ed25519 = () => {
	const made = newEd25519Key();
	return { private: made.private, public: `ssh-ed25519 ${made.public.toString("base64")}` };
};

const blobOf = (publicKey: string) => {
	const key = ssh2.utils.parseKey(publicKey);
	if (key instanceof Error) throw key;
	return key.getPublicSSH();
};

interface Setup {
	store: AccessStore;
	server: AccessServer;
	phone: { private: string; public: string };
	asked: () => number;
	events: SessionEvent[];
	/** A client connected over a new in-memory stream; resolves when it is ready, rejects when it is refused. */
	connect(config?: Partial<ConnectConfig>): Promise<Client>;
	/** A client whose stream is handed over, and the server's end of it, without connecting it. */
	streams(): { client: Duplex; server: Duplex };
}

const live: Setup[] = [];
after(() => {
	for (const s of live) s.server.close();
});

async function setup(options: Partial<AccessServerOptions> = {}): Promise<Setup> {
	const store = await AccessStore.open(memoryVault());
	const phone = ed25519();
	await store.add({ key: blobOf(phone.public), name: "phone" });
	let asked = 0;
	const events: SessionEvent[] = [];
	const server = createAccessServer({
		hostKey: store.hostKey(),
		admit: pairedKeys(store),
		daemon: async () => {
			asked++;
			return serviceLine();
		},
		report: (event) => events.push(event),
		...options,
	});
	const s: Setup = {
		store,
		server,
		phone,
		asked: () => asked,
		events,
		streams() {
			const [client, end] = duplexPair();
			server.accept(end);
			return { client, server: end };
		},
		connect(config = {}) {
			const { client: sock } = s.streams();
			const client = new ssh2.Client();
			return new Promise<Client>((resolve, reject) => {
				client.once("ready", () => resolve(client));
				client.once("error", reject);
				client.once("close", () => reject(new Error("closed before it was ready")));
				client.connect({ sock, username: "pine", privateKey: phone.private, readyTimeout: 5000, ...config } as ConnectConfig);
			});
		},
	};
	live.push(s);
	return s;
}

const exec = (client: Client, command: string, options: Record<string, unknown> = {}) =>
	new Promise<ClientChannel>((resolve, reject) => client.exec(command, options as any, (err, channel) => (err ? reject(err) : resolve(channel))));

/** The first line a channel writes. */
const firstLine = (channel: ClientChannel) =>
	new Promise<string>((resolve, reject) => {
		let text = "";
		channel.on("data", (data: Buffer) => {
			text += data.toString();
			const end = text.indexOf("\n");
			if (end >= 0) resolve(text.slice(0, end));
		});
		channel.once("close", () => reject(new Error(`closed after ${JSON.stringify(text)}`)));
	});

const tunnel = (client: Client, host: string, port: number) =>
	new Promise<ClientChannel>((resolve, reject) => client.forwardOut("127.0.0.1", 0, host, port, (err, channel) => (err ? reject(err) : resolve(channel))));

const readAll = (channel: ClientChannel, enough: number) =>
	new Promise<string>((resolve) => {
		let text = "";
		channel.on("data", (data: Buffer) => {
			text += data.toString();
			if (text.length >= enough) resolve(text);
		});
		channel.once("close", () => resolve(text));
	});

const closed = (client: Client) => new Promise<void>((resolve) => client.once("close", () => resolve()));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("access server: a paired key runs the remote command and reads the daemon's service line; the channel stays open", async () => {
	const s = await setup();
	const client = await s.connect();
	const channel = await exec(client, remoteCommand());
	assert.equal(await firstLine(channel), serviceLine());
	let gone = false;
	channel.once("close", () => (gone = true));
	await sleep(100);
	assert.equal(gone, false, "the channel is held like `cat` holds it");
	client.end();
});

test("access server: the connection is Ed25519, ECDH on Curve25519 or P-256, and AES-GCM, on ssh2 without its native binding", async () => {
	const require = createRequire(import.meta.url);
	assert.throws(() => require.resolve("ssh2/lib/protocol/crypto/build/Release/sshcrypto.node"), "scripts/ssh2-pure.mjs removed ssh2's own binding");
	assert.throws(() => require("cpu-features"), "and the one it would order ciphers by");
	const s = await setup();
	const negotiated = new Promise<any>((resolve) => {
		const { client: sock } = s.streams();
		const client = new ssh2.Client();
		client.once("handshake", resolve);
		client.once("ready", () => client.end());
		client.on("error", () => {});
		client.connect({ sock, username: "pine", privateKey: s.phone.private });
	});
	const got = await negotiated;
	assert.equal(got.serverHostKey, "ssh-ed25519");
	assert.match(got.kex, /^curve25519-sha256/);
	assert.match(got.cs.cipher, /^aes(128|256)-gcm@openssh\.com$/);
	assert.match(got.sc.cipher, /^aes(128|256)-gcm@openssh\.com$/);

	// The web client's SSH library has no Curve25519: it gets P-256, and AES-256-GCM.
	const { client: sock } = s.streams();
	const browserLike = new ssh2.Client();
	const fallback = new Promise<any>((resolve) => browserLike.once("handshake", resolve));
	browserLike.once("ready", () => browserLike.end());
	browserLike.on("error", () => {});
	browserLike.connect({ sock, username: "pine", privateKey: s.phone.private, algorithms: { kex: ["ecdh-sha2-nistp384", "ecdh-sha2-nistp256"], cipher: ["aes256-gcm@openssh.com"], serverHostKey: ["ssh-ed25519"] } });
	const second = await fallback;
	assert.equal(second.kex, "ecdh-sha2-nistp256");
	assert.equal(second.cs.cipher, "aes256-gcm@openssh.com");

	// Nothing weaker is offered: a client that only speaks something else gets no connection.
	const { client: sock3 } = s.streams();
	const weak = new ssh2.Client();
	await assert.rejects(
		new Promise<void>((resolve, reject) => {
			weak.once("ready", () => resolve());
			weak.once("error", reject);
			weak.connect({ sock: sock3, username: "pine", privateKey: s.phone.private, algorithms: { cipher: ["aes128-ctr"] } });
		}),
	);
});

test("access server: a channel to the daemon's host and port reaches it; any other port or host is refused", async () => {
	const s = await setup();
	const client = await s.connect();
	await firstLine(await exec(client, remoteCommand()));
	const channel = await tunnel(client, "127.0.0.1", daemonPort);
	channel.write("hello");
	assert.equal(await readAll(channel, "daemon:hello".length), "daemon:hello");
	await assert.rejects(tunnel(client, "127.0.0.1", otherPort));
	await assert.rejects(tunnel(client, "localhost", daemonPort));
	await assert.rejects(tunnel(client, "127.0.0.2", daemonPort));
	client.end();
});

test("access server: no channel to the daemon before its service line is known", async () => {
	const s = await setup();
	const client = await s.connect();
	await assert.rejects(tunnel(client, "127.0.0.1", daemonPort));
	client.end();
});

test("access server: an unknown key is refused, and so is the paired key under another user name", async () => {
	const s = await setup();
	const stranger = ed25519();
	await assert.rejects(s.connect({ privateKey: stranger.private }));
	await assert.rejects(s.connect({ username: "root" }));
});

test("access server: a password is refused", async () => {
	const s = await setup();
	await assert.rejects(s.connect({ privateKey: undefined, password: "anything" }));
});

test("access server: keyboard-interactive is refused", async () => {
	const s = await setup();
	const client = s.connect({ privateKey: undefined, tryKeyboard: true, authHandler: ["keyboard-interactive"] } as any);
	await assert.rejects(client);
});

test("access server: a client that names a paired key but cannot sign with it is refused", async () => {
	const s = await setup();
	const stranger = ssh2.utils.parseKey(ed25519().private) as ssh2.ParsedKey;
	const named = ssh2.utils.parseKey(s.phone.public) as ssh2.ParsedKey;
	// An agent that offers the paired public key and signs with another key.
	class Liar extends ssh2.BaseAgent {
		getIdentities(cb: (err: Error | undefined, keys: ssh2.ParsedKey[]) => void) {
			cb(undefined, [named]);
		}
		sign(_key: unknown, data: Buffer, ...rest: any[]) {
			const cb = rest[rest.length - 1];
			cb(undefined, stranger.sign(data));
		}
	}
	await assert.rejects(s.connect({ privateKey: undefined, agent: new Liar() as any }));
});

test("access server: a key that is not Ed25519 is refused even where the caller would admit it", async () => {
	const s = await setup({ admit: () => ({ id: "anyone", pine: true }) });
	const ecdsa = ssh2.utils.generateKeyPairSync("ecdsa", { bits: 256 });
	await assert.rejects(s.connect({ privateKey: ecdsa.private }));
	// The same admission with an Ed25519 key gets in: the refusal above is the key's type.
	(await s.connect()).end();
});

/** What a paired session asks for that it must not get: each one is refused. */
const REFUSED: Array<[string, (client: Client) => Promise<unknown>]> = [
	["another command", (client) => exec(client, "ls")],
	["the remote command with a byte more", (client) => exec(client, `${remoteCommand()} `)],
	["`pine service` itself", (client) => exec(client, "pine service")],
	["a shell", (client) => new Promise((resolve, reject) => client.shell((err, ch) => (err ? reject(err) : resolve(ch))))],
	["a pty", (client) => exec(client, remoteCommand(), { pty: true })],
	["sftp", (client) => new Promise((resolve, reject) => client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp))))],
	["another subsystem", (client) => new Promise((resolve, reject) => client.subsys("netconf", (err, ch) => (err ? reject(err) : resolve(ch))))],
	["remote forwarding", (client) => new Promise((resolve, reject) => client.forwardIn("127.0.0.1", 0, (err, port) => (err ? reject(err) : resolve(port))))],
	["an environment variable", (client) => exec(client, remoteCommand(), { env: { LD_PRELOAD: "/tmp/x.so" } })],
	["agent forwarding", (client) => exec(client, remoteCommand(), { agentForward: true })],
	["X11 forwarding", (client) => exec(client, remoteCommand(), { x11: true })],
];

for (const [what, ask] of REFUSED) {
	test(`access server: ${what} is refused`, async () => {
		const s = await setup();
		// An agent to forward (never reached: the request is refused before it is used).
		const client = await s.connect({ agent: "/nonexistent/agent.sock" });
		// ssh2's client asks for an environment variable without a reply; this one wants the reply, which then comes before exec's.
		const protocol = (client as any)._protocol;
		const env = protocol.env.bind(protocol);
		protocol.env = (id: number, key: string, value: string) => env(id, key, value, true);
		await assert.rejects(ask(client));
		client.end();
	});
}

test("access server: a connection that has not authenticated in time is closed", async () => {
	const s = await setup({ authTimeoutMs: 50 });
	const { client } = s.streams();
	const ended = new Promise<void>((resolve) => {
		client.on("data", () => {});
		client.once("end", () => resolve());
		client.once("close", () => resolve());
	});
	client.write("SSH-2.0-silent\r\n");
	await ended;
});

test("access server: the daemon is asked for by every remote command, once for those asking at the same time; a session that ends stops nothing", async () => {
	let asked = 0;
	// The provider answers when the test lets it, so that two commands can be waiting at once.
	let release = () => {};
	const s = await setup({
		daemon: () => {
			asked++;
			return new Promise<string>((resolve) => (release = () => resolve(serviceLine())));
		},
	});
	const first = await s.connect();
	const one = exec(first, remoteCommand());
	await one;
	release();
	await firstLine(await one);
	first.end();
	await closed(first);
	assert.equal(asked, 1);
	const second = await s.connect();
	const third = await s.connect();
	// Each exec is answered once the server has asked for the daemon: both wait on the same call.
	const [a, b] = await Promise.all([exec(second, remoteCommand()), exec(third, remoteCommand())]);
	release();
	assert.deepEqual(await Promise.all([firstLine(a), firstLine(b)]), [serviceLine(), serviceLine()]);
	assert.equal(asked, 2);
	const channel = await tunnel(second, "127.0.0.1", daemonPort);
	channel.write("still");
	assert.equal(await readAll(channel, "daemon:still".length), "daemon:still", "the daemon is still there for the others");
	second.end();
	third.end();
});

test("access server: a daemon that changed is asked for again: the next session gets its new line and reaches it, and the old port is refused", async (t) => {
	const moved = net.createServer((socket) => {
		socket.write("moved:");
		socket.pipe(socket);
	});
	await new Promise<void>((r) => moved.listen(0, "127.0.0.1", r));
	t.after(() => void moved.close());
	const movedPort = (moved.address() as AddressInfo).port;
	let port = daemonPort;
	const s = await setup({ daemon: async () => serviceLine(port) });
	const first = await s.connect();
	assert.equal(await firstLine(await exec(first, remoteCommand())), serviceLine(daemonPort));
	first.end();
	await closed(first);

	port = movedPort;
	const second = await s.connect();
	assert.equal(await firstLine(await exec(second, remoteCommand())), serviceLine(movedPort));
	const channel = await tunnel(second, "127.0.0.1", movedPort);
	channel.write("here");
	assert.equal(await readAll(channel, "moved:here".length), "moved:here");
	await assert.rejects(tunnel(second, "127.0.0.1", daemonPort));
	second.end();
});

test("access server: a daemon that cannot be had is said on the channel and asked for again next time", async () => {
	let tries = 0;
	const s = await setup({
		daemon: async () => {
			tries++;
			if (tries === 1) throw new Error("pine could not start");
			return serviceLine();
		},
	});
	const client = await s.connect();
	const failed = await exec(client, remoteCommand());
	const exit = new Promise<number>((resolve) => failed.once("exit", (code: number) => resolve(code)));
	assert.deepEqual(JSON.parse(await firstLine(failed)), { error: "pine could not start" });
	assert.equal(await exit, 1);
	assert.equal(await firstLine(await exec(client, remoteCommand())), serviceLine());
	client.end();
});

test("access server: a service line that names no loopback address is not passed on", async () => {
	const s = await setup({ daemon: async () => JSON.stringify({ base: "http://192.168.1.5:7777", token: "t" }) });
	const client = await s.connect();
	const channel = await exec(client, remoteCommand());
	assert.ok("error" in JSON.parse(await firstLine(channel)));
	await assert.rejects(tunnel(client, "192.168.1.5", 7777));
	client.end();
});

test("access server: removing a key cuts its live sessions and refuses its next connection", async () => {
	const s = await setup();
	const client = await s.connect();
	await firstLine(await exec(client, remoteCommand()));
	const device = s.store.devices()[0];
	const gone = closed(client);
	assert.equal(await s.store.remove(device.id), true);
	assert.equal(s.server.cut(device.id), 1);
	await gone;
	await assert.rejects(s.connect());
});

test("access server: every session says who connected and when it left", async () => {
	const s = await setup();
	const device = s.store.devices()[0];
	const tag = { path: "lan" };
	const { client: sock } = (() => {
		const [client, end] = duplexPair();
		s.server.accept(end, tag);
		return { client };
	})();
	const client = new ssh2.Client();
	await new Promise<void>((resolve, reject) => {
		client.once("ready", () => resolve());
		client.once("error", reject);
		client.connect({ sock, username: "pine", privateKey: s.phone.private });
	});
	assert.deepEqual(s.server.connected(), [{ id: device.id, tag }]);
	assert.equal(s.events.length, 1);
	assert.equal(s.events[0].kind, "connected");
	assert.equal(s.events[0].id, device.id);
	assert.equal(s.events[0].tag, tag);
	assert.ok(s.events[0].at instanceof Date);
	client.end();
	await closed(client);
	// The server sees it leave a moment after the client saw its own end: waited for, not slept for.
	for (let i = 0; i < 500 && s.events.length < 2; i++) await sleep(10);
	assert.deepEqual(
		s.events.map((e) => [e.kind, e.id]),
		[
			["connected", device.id],
			["left", device.id],
		],
	);
	assert.deepEqual(s.server.connected(), []);
});

test("access server: no more than the limit of connections at a time", async () => {
	const s = await setup({ maxConnections: 2 });
	const a = await s.connect();
	const b = await s.connect();
	await assert.rejects(s.connect());
	a.end();
	await closed(a);
	// Until the server counts one connection less: its side of the close comes a moment after the client's.
	for (let i = 0; i < 500 && s.server.connected().length > 1; i++) await sleep(10);
	(await s.connect()).end();
	b.end();
});
