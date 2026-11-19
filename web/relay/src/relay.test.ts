import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { CLOSE, relay, type Deps, type TcpSocket } from "./relay.ts";
import { connectTo, limiter, names, pairs, request, server, sshEcho, type Call } from "../testing.ts";

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
	await tick();
	assert.equal(Buffer.concat(written).toString("latin1"), "SSH-2.0-pine-web\r\nABC");
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

test("a name without addresses is refused with what to check", async () => {
	const t = await setup();
	const response = await t.fetch(request("nowhere.example.org"));
	assert.equal(response.status, 502);
	assert.match(await response.text(), /spelling/);
});

// A Tailscale Funnel name (.ts.net) is reached through TLS, by its name; everything else as before.

const FUNNEL_TABLE = {
	"pine.example-tailnet.ts.net": ["93.184.215.20"],
	"ssh.example.org": ["93.184.215.7"],
	"notts.net": ["93.184.215.8"],
	"tailnet-only.example-tailnet.ts.net": ["100.101.102.103"],
	"home.example-tailnet.ts.net": ["192.168.1.20"],
	"edge.example-tailnet.ts.net": ["104.16.1.1"],
	"localhost.example-tailnet.ts.net": ["127.0.0.1"],
};

async function funnelSetup(connect?: Deps["connect"]) {
	const received: Buffer[] = [];
	const srv = await server(sshEcho(received));
	stops.push(srv.stop);
	const calls: Call[] = [];
	const { clients, upgrade } = pairs();
	const handle = relay({ connect: connect ?? connectTo(srv.port, calls), resolve: names(FUNNEL_TABLE), upgrade, timeoutMs: 2000 });
	return { received, calls, clients, fetch: (req: Request) => handle(req, { LIMITER: limiter() }) };
}

/** A connect() whose TLS handshake fails, as it opens or at the first read. */
function tlsFails(at: "open" | "read"): Deps["connect"] {
	return (): TcpSocket => {
		const opened = at === "open" ? Promise.reject(new Error("handshake failed")) : Promise.resolve();
		opened.catch(() => {});
		return {
			readable: new ReadableStream({ start: (c) => c.error(new Error("handshake failed")) }),
			writable: new WritableStream(),
			opened,
			closed: Promise.resolve(),
			close: async () => {},
		};
	};
}

test("a Funnel name is connected to by its name, with TLS, and SSH passes both ways inside it", async () => {
	const t = await funnelSetup();
	await t.fetch(request("pine.example-tailnet.ts.net", 10000));
	const [client] = t.clients;
	client.send("SSH-2.0-pine-web\r\n");
	await client.sees("SSH-2.0-OpenSSH_9.9\r\n");
	client.send("after the banner");
	await client.sees("after the banner");
	assert.deepEqual(t.calls, [{ hostname: "pine.example-tailnet.ts.net", port: 10000, secureTransport: "on" }]);
	client.end.close(1000);
});

test("a Funnel name written with capitals or a final dot is the same name for TLS", async () => {
	const t = await funnelSetup();
	await t.fetch(request("Pine.Example-Tailnet.TS.NET.", 443));
	const [client] = t.clients;
	client.send("SSH-2.0-pine-web\r\n");
	await client.sees("SSH-2.0-OpenSSH_9.9\r\n");
	assert.deepEqual(t.calls, [{ hostname: "pine.example-tailnet.ts.net", port: 443, secureTransport: "on" }]);
	client.end.close(1000);
});

test("any other host is connected to by its checked address, without TLS", async () => {
	for (const [host, address] of [["ssh.example.org", "93.184.215.7"], ["notts.net", "93.184.215.8"], ["93.184.215.9", "93.184.215.9"]]) {
		const t = await funnelSetup();
		await t.fetch(request(host, 10000));
		const [client] = t.clients;
		client.send("SSH-2.0-pine-web\r\n");
		await client.sees("SSH-2.0-OpenSSH_9.9\r\n");
		assert.deepEqual(t.calls, [{ hostname: address, port: 10000 }], host);
		client.end.close(1000);
	}
});

test("a Funnel name on a port Funnel does not serve is refused before anything is connected", async () => {
	for (const port of [22, 80, 2222, 8080]) {
		const t = await funnelSetup();
		const response = await t.fetch(request("pine.example-tailnet.ts.net", port));
		assert.equal(response.status, 400, String(port));
		assert.match(await response.text(), /443, 8443, 10000/);
		assert.equal(t.clients.length, 0);
		assert.deepEqual(t.calls, []);
	}
});

test("a Funnel name that has a tailnet, private, loopback or Cloudflare address, or none, is refused", async () => {
	for (const host of ["tailnet-only.example-tailnet.ts.net", "home.example-tailnet.ts.net", "edge.example-tailnet.ts.net", "localhost.example-tailnet.ts.net", "unknown.example-tailnet.ts.net"]) {
		const t = await funnelSetup();
		const response = await t.fetch(request(host, 10000));
		assert.ok(response.status === 403 || response.status === 502, `${host}: ${response.status}`);
		assert.equal(t.clients.length, 0, host);
		assert.deepEqual(t.calls, [], host);
	}
});

test("a server that does not speak SSH inside the TLS is closed, and none of its bytes reach the client", async () => {
	const srv = await server((socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
	stops.push(srv.stop);
	const t = await funnelSetup(connectTo(srv.port));
	await t.fetch(request("pine.example-tailnet.ts.net", 443));
	const [client] = t.clients;
	client.send("SSH-2.0-pine-web\r\n");
	assert.equal((await client.closes()).code, CLOSE.serverNotSsh);
	assert.equal(client.received.length, 0);
});

test("a TLS handshake that fails closes with the TLS code for a Funnel name, as it opens or at the first read", async () => {
	for (const at of ["open", "read"] as const) {
		const t = await funnelSetup(tlsFails(at));
		await t.fetch(request("pine.example-tailnet.ts.net", 10000));
		const [client] = t.clients;
		client.send("SSH-2.0-pine-web\r\n");
		assert.equal((await client.closes()).code, CLOSE.tls, at);
	}
	// Any other host that cannot be reached is still "unreachable".
	const t = await funnelSetup(tlsFails("open"));
	await t.fetch(request("ssh.example.org", 22));
	const [client] = t.clients;
	client.send("SSH-2.0-pine-web\r\n");
	assert.equal((await client.closes()).code, CLOSE.unreachable);
});

// The one way the relay reaches this computer: `RELAY_ALLOW_LOOPBACK`, which only the web client's
// smoke sets, on the command line of `wrangler dev`. It opens the loopback and nothing else, only
// for a relay that is itself served on the loopback, and no configuration that is deployed sets it.

/** A request for the relay, as a browser opens it from the deployment at `origin`. */
const ask = (origin: string, host: string) => new Request(`${origin}/ssh?host=${encodeURIComponent(host)}&port=2222`, { headers: { Upgrade: "websocket", "CF-Connecting-IP": "127.0.0.1" } });

async function tried(origin: string, host: string, allow?: string) {
	const { clients, upgrade } = pairs();
	const handle = relay({
		connect: () => {
			throw new Error("not reached in this test");
		},
		resolve: names({ localhost: ["127.0.0.1"] }),
		upgrade,
		timeoutMs: 1000,
	});
	const response = await handle(ask(origin, host), { LIMITER: limiter(), RELAY_ALLOW_LOOPBACK: allow });
	for (const client of clients) client.end.close(1000);
	return response.status === 403 ? "refused" : clients.length === 1 ? "let through" : `status ${response.status}`;
}

test("with the switch, a relay served on the loopback reaches the loopback", async () => {
	for (const origin of ["http://127.0.0.1:8787", "http://localhost:8787", "http://[::1]:8787"]) {
		for (const host of ["127.0.0.1", "::1", "localhost"]) assert.equal(await tried(origin, host, "1"), "let through", `${origin} -> ${host}`);
	}
});

test("the switch opens nothing but the loopback", async () => {
	for (const host of ["10.0.0.5", "192.168.1.10", "169.254.169.254", "fd12::1", "0.0.0.0", "104.16.0.1"]) {
		assert.equal(await tried("http://127.0.0.1:8787", host, "1"), "refused", host);
	}
});

test("the switch does nothing for a relay served under any other name", async () => {
	for (const origin of ["https://pine.example", "https://pine-relay.someone.workers.dev", "http://198.51.100.7:8787"]) {
		assert.equal(await tried(origin, "127.0.0.1", "1"), "refused", origin);
	}
});

test("without the switch, or with another value, the loopback stays refused", async () => {
	for (const allow of [undefined, "", "0", "true", "yes"]) assert.equal(await tried("http://127.0.0.1:8787", "127.0.0.1", allow), "refused", String(allow));
});

test("the configuration that is deployed never sets the switch", () => {
	const config = readFileSync(path.join(import.meta.dirname, "..", "wrangler.jsonc"), "utf8");
	assert.doesNotMatch(config, /RELAY_ALLOW_LOOPBACK/);
	for (const file of [".dev.vars", ".env"]) {
		let text = "";
		try {
			text = readFileSync(path.join(import.meta.dirname, "..", file), "utf8");
		} catch {}
		assert.doesNotMatch(text, /RELAY_ALLOW_LOOPBACK/, file);
	}
});
