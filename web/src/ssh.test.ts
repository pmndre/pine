// The SSH core in a headless Chrome for Testing against a real sshd on this computer, through
// a WebSocket-to-TCP pipe that stands in for the relay.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { openPage, type Browser } from "../testing/browser.ts";
import { startMachine, type Machine } from "../testing/machine.ts";
import type * as Ssh from "./ssh.ts";

declare const ssh: typeof Ssh;
declare let key: CryptoKeyPair;

let machine: Machine;
let browser: Browser;

before(async () => {
	machine = await startMachine();
	browser = await openPage(fileURLToPath(new URL("../testing/page.ts", import.meta.url)));
});

/** Where the page connects to, as values it can be handed. */
const target = () => ({ wsUrl: machine.wsUrl, user: machine.user, hostFingerprint: machine.hostFingerprint });

after(async () => {
	await browser?.stop();
	await machine?.stop();
});

test("the key is generated non-extractable, its public half reads as an OpenSSH key, its private half cannot be exported", async () => {
	const result = await browser.page.evaluate(async () => {
		key = await ssh.generateKey();
		const exported = await crypto.subtle.exportKey("pkcs8", key.privateKey).then(() => "exported", (error: Error) => error.name);
		return { extractable: key.privateKey.extractable, exported, line: await ssh.publicKeyLine(key.publicKey, "pine web") };
	});
	assert.equal(result.extractable, false);
	assert.equal(result.exported, "InvalidAccessError");
	assert.match(result.line, /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]+=* pine web$/);
	// ssh-keygen reads it as an Ed25519 key: the format is OpenSSH's, not just shaped like it. (From standard input as `-`: on Linux /dev/stdin cannot be opened when it is a pipe.)
	const listed = execFileSync("ssh-keygen", ["-l", "-f", "-"], { input: result.line, encoding: "utf8" });
	assert.match(listed, /^256 SHA256:\S+ pine web \(ED25519\)/);
	machine.authorize(result.line);
});

test("with the host key's fingerprint and the authorized key, an exec channel runs a command and returns its output", async () => {
	const result = await browser.page.evaluate(async ({ wsUrl, user, hostFingerprint }) => {
		const connection = await ssh.connect({ url: wsUrl, user, key, hostFingerprint });
		const channel = await connection.exec("printf 'hello from %s' \"$(whoami)\"; exit 3");
		let output = "";
		channel.onData((bytes) => (output += new TextDecoder().decode(bytes)));
		const { exitStatus } = await channel.closed;
		await connection.close();
		return { output, exitStatus };
	}, target());
	assert.equal(result.output, `hello from ${machine.user}`);
	assert.equal(result.exitStatus, 3);
	assert.match(machine.log(), /Accepted publickey for \S+ from 127\.0\.0\.1 port \d+ ssh2: ED25519 SHA256:/);
});

test("a host key other than the confirmed one is refused before the browser's key is offered", async () => {
	const before = machine.log().match(/publickey/g)?.length ?? 0;
	const wrong = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
	const result = await browser.page.evaluate(async (options) => {
		try {
			await ssh.connect({ url: options.wsUrl, user: options.user, key, hostFingerprint: options.wrong });
			return { connected: true };
		} catch (error) {
			const refused = error as Ssh.SshRefused;
			return { connected: false, reason: refused.reason, seen: refused.hostFingerprint };
		}
	}, { ...target(), wrong });
	assert.deepEqual(result, { connected: false, reason: "host-key", seen: machine.hostFingerprint });
	// sshd heard of no public key from this connection.
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.equal(machine.log().match(/publickey/g)?.length ?? 0, before);
});

test("a direct-tcpip channel reaches a port on the server's loopback, both ways", async () => {
	const echoed = await browser.page.evaluate(async (options) => {
		const connection = await ssh.connect({ url: options.wsUrl, user: options.user, key, hostFingerprint: options.hostFingerprint });
		const channel = await connection.forward("127.0.0.1", options.echoPort);
		const message = "round trip through the tunnel";
		const received = new Promise<string>((resolve) => {
			let text = "";
			channel.onData((bytes) => {
				text += new TextDecoder().decode(bytes);
				if (text.length >= message.length) resolve(text);
			});
		});
		await channel.send(message);
		const text = await received;
		await connection.close();
		return text;
	}, { ...target(), echoPort: machine.echoPort });
	assert.equal(echoed, "round trip through the tunnel");
});

test("a key that is not in authorized_keys is refused", async () => {
	const result = await browser.page.evaluate(async (options) => {
		const stranger = await ssh.generateKey();
		try {
			await ssh.connect({ url: options.wsUrl, user: options.user, key: stranger, hostFingerprint: options.hostFingerprint });
			return "connected";
		} catch (error) {
			return (error as Ssh.SshRefused).reason;
		}
	}, target());
	assert.equal(result, "not-authorized");
});

test("a relay that never answers is given up on, as one that did not open a connection", async () => {
	// A server that takes the connection and says nothing: the WebSocket never opens, nor fails.
	const held = new Set<Socket>();
	const silent = createServer((socket) => void held.add(socket));
	await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
	const url = `ws://127.0.0.1:${(silent.address() as AddressInfo).port}/ssh`;
	try {
		const result = await browser.page.evaluate(async (options) => {
			const started = Date.now();
			try {
				await ssh.connect({ url: options.url, user: "me", key, hostFingerprint: "none", openMs: 300 });
				return { connected: true };
			} catch (error) {
				return { connected: false, name: (error as Error).name, code: (error as Ssh.RelayClosed).code, ms: Date.now() - started };
			}
		}, { url });
		assert.deepEqual({ ...result, ms: undefined }, { connected: false, name: "RelayClosed", code: 0, ms: undefined });
		assert.ok((result as { ms: number }).ms < 3000, `gave up after ${(result as { ms: number }).ms} ms`);
	} finally {
		for (const socket of held) socket.destroy();
		silent.close();
	}
});
