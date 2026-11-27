import assert from "node:assert/strict";
import { after, test } from "node:test";
import { CLOSE, relay, type Deps, type TcpSocket } from "../src/relay.ts";
import { connectTo, limiter, names, pairs, request, server, sshEcho, type Call } from "./support.ts";

const stops: (() => Promise<unknown>)[] = [];
after(async () => {
	for (const stop of stops) await stop();
});

async function setup(options: { onConnection?: Parameters<typeof server>[0]; limit?: number; timeoutMs?: number } = {}) {
	const received: Buffer[] = [];
	const srv = await server(options.onConnection ?? sshEcho(received));
	stops.push(srv.stop);
	const calls: { hostname: string; port: number }[] = [];
	const { clients, upgrade } = pairs();
	const limits = limiter(options.limit);
	const handle = relay({
		connect: connectTo(srv.port, calls),
		resolve: names({ "ssh.example.org": ["93.184.215.7"] }),
		upgrade,
		timeoutMs: options.timeoutMs ?? 2000,
	});
	const env = { LIMITER: limits };
	return { received, calls, clients, limits, fetch: (req: Request) => handle(req, env) };
}

test("an SSH banner exchange passes bytes both ways", async () => {
	const t = await setup();
	const response = await t.fetch(request("ssh.example.org", 2222));
	assert.equal(response.headers.get("x-upgraded"), "1");
	const [client] = t.clients;
	client.send("SSH-2.0-pine-web\r\n");
	await client.sees("SSH-2.0-OpenSSH_9.9\r\n");
	client.send("after the banner");
	await client.sees("after the banner");
	assert.equal(Buffer.concat(t.received).toString("latin1"), "SSH-2.0-pine-web\r\nafter the banner");
	assert.deepEqual(t.calls, [{ hostname: "93.184.215.7", port: 2222 }]);
	client.end.close(1000);
});

test("a connection over the per-IP cap is refused, and another IP still gets through", async () => {
	const t = await setup({ limit: 2 });
	const statuses = [];
	for (const ip of ["203.0.113.9", "203.0.113.9", "203.0.113.9", "203.0.113.10"]) {
		statuses.push((await t.fetch(request("ssh.example.org", 22, ip))).status);
	}
	assert.deepEqual(statuses, [200, 200, 429, 200]);
	assert.equal(t.clients.length, 3);
	for (const client of t.clients) client.end.close(1000);
});

test("a client that does not open with an SSH identification is closed before anything is connected", async () => {
	const t = await setup();
	await t.fetch(request("ssh.example.org"));
	const [client] = t.clients;
	client.send("GET / HTTP/1.1\r\n\r\n");
	const closed = await client.closes();
	assert.equal(closed.code, CLOSE.notSsh);
	assert.deepEqual(t.calls, []);
});

test("a client that sends text instead of bytes is closed", async () => {
	const t = await setup();
	await t.fetch(request("ssh.example.org"));
	const [client] = t.clients;
	client.sendText("SSH-2.0-pine-web\r\n");
	assert.equal((await client.closes()).code, CLOSE.notSsh);
	assert.deepEqual(t.calls, []);
});

test("a server that does not speak SSH is closed, and none of its bytes reach the client", async () => {
	const t = await setup({ onConnection: (socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n") });
	await t.fetch(request("ssh.example.org", 80));
	const [client] = t.clients;
	client.send("SSH-2.0-pine-web\r\n");
	assert.equal((await client.closes()).code, CLOSE.serverNotSsh);
	assert.equal(client.received.length, 0);
});

test("a server that says nothing is closed after the time limit", async () => {
	const t = await setup({ onConnection: () => {}, timeoutMs: 100 });
	await t.fetch(request("ssh.example.org"));
	const [client] = t.clients;
	client.send("SSH-2.0-pine-web\r\n");
	const started = Date.now();
	assert.equal((await client.closes()).code, CLOSE.timeout);
	assert.ok(Date.now() - started < 1000);
});

test("a server that sends a line that is not SSH and then waits (SMTP, FTP on the port) is said not to speak SSH when time is up", async () => {
	const t = await setup({ onConnection: (socket) => socket.write("220 smtp ready\r\n"), timeoutMs: 100 });
	await t.fetch(request("ssh.example.org", 25));
	const [client] = t.clients;
	client.send("SSH-2.0-pine-web\r\n");
	assert.equal((await client.closes()).code, CLOSE.serverNotSsh);
	assert.equal(client.received.length, 0);
});

test("a client that says nothing is closed after the time limit, without a connection", async () => {
	const t = await setup({ timeoutMs: 100 });
	await t.fetch(request("ssh.example.org"));
	const [client] = t.clients;
	assert.equal((await client.closes()).code, CLOSE.timeout);
	assert.deepEqual(t.calls, []);
});

/** A promise and the function that resolves it. */
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => (resolve = r));
	return { promise, resolve };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test("what the client sends while the connection opens and its first bytes are written reaches the server in order", async () => {
	const opened = deferred();
	const release = deferred();
	const written: Uint8Array[] = [];
	const connect: Deps["connect"] = (): TcpSocket => ({
		readable: new ReadableStream(),
		writable: new WritableStream({
			async write(chunk) {
				written.push(chunk);
				// The first write is slow: the client goes on sending meanwhile.
				if (written.length === 1) await release.promise;
			},
		}),
		opened: opened.promise,
		closed: new Promise(() => {}),
		close: async () => {},
	});
	const { clients, upgrade } = pairs();
	const handle = relay({ connect, resolve: names({}), upgrade, timeoutMs: 2000 });
	await handle(request("93.184.215.7"), { LIMITER: limiter() });
	const [client] = clients;
	client.send("SSH-");
	client.send("2.0-pine-web\r\n");
	client.send("A");
	await tick();
	opened.resolve();
	await tick();
	client.send("B");
	client.send("C");
	await tick();
	release.resolve();
	// Until all of it is written, however long that takes on a busy computer; the order is what is asserted.
	const all = "SSH-2.0-pine-web\r\nABC";
	for (let waited = 0; Buffer.concat(written).length < all.length && waited < 3000; waited += 10) await tick();
	assert.equal(Buffer.concat(written).toString("latin1"), all);
	client.end.close(1000);
});

test("lines a server sends before its identification are dropped, and the identification and what follows reach the client", async () => {
	const t = await setup({
		onConnection: (socket) => {
			socket.write("Welcome to the box\r\nNo unauthorised use\r\n");
			socket.write("SSH-2.0-OpenSSH_9.9\r\nafter");
		},
	});
	await t.fetch(request("ssh.example.org"));
	const [client] = t.clients;
	client.send("SSH-2.0-pine-web\r\n");
	await client.sees("after");
	assert.equal(client.received.toString("latin1"), "SSH-2.0-OpenSSH_9.9\r\nafter");
	client.end.close(1000);
});

test("a server that sends too many lines, or too long a line, before its identification is closed, and none of its bytes reach the client", async () => {
	for (const preface of ["hello\r\n".repeat(30), "x".repeat(300) + "\r\n", "x".repeat(300)]) {
		const t = await setup({ onConnection: (socket) => socket.write(preface + "SSH-2.0-OpenSSH_9.9\r\n") });
		await t.fetch(request("ssh.example.org"));
		const [client] = t.clients;
		client.send("SSH-2.0-pine-web\r\n");
		assert.equal((await client.closes()).code, CLOSE.serverNotSsh, preface.slice(0, 10));
		assert.equal(client.received.length, 0);
	}
});

test("a name's addresses are tried in turn until one answers", async () => {
	const received: Buffer[] = [];
	const srv = await server(sshEcho(received));
	stops.push(srv.stop);
	const calls: Call[] = [];
	const reaches = connectTo(srv.port, calls);
	const connect: Deps["connect"] = (address, options) => {
		if (address.hostname !== "93.184.215.7") return reaches(address, options);
		calls.push(address);
		const refused = Promise.reject(new Error("connection refused"));
		refused.catch(() => {});
		return { readable: new ReadableStream(), writable: new WritableStream(), opened: refused, closed: Promise.resolve(), close: async () => {} };
	};
	const { clients, upgrade } = pairs();
	const handle = relay({ connect, resolve: names({ "two.example.org": ["93.184.215.7", "2606:2800:220:1::7"] }), upgrade, timeoutMs: 2000 });
	await handle(request("two.example.org"), { LIMITER: limiter() });
	const [client] = clients;
	client.send("SSH-2.0-pine-web\r\n");
	await client.sees("SSH-2.0-OpenSSH_9.9\r\n");
	assert.deepEqual(calls, [
		{ hostname: "93.184.215.7", port: 22 },
		{ hostname: "2606:2800:220:1:0:0:0:7", port: 22 },
	]);
	client.end.close(1000);
});

test("a name without addresses is refused, with words for the owner", async () => {
	const t = await setup();
	const response = await t.fetch(request("nowhere.example.org"));
	assert.equal(response.status, 502);
	assert.ok((await response.text()).length > 0);
});
