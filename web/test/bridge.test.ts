// The web bridge through the page's `window.pine`, as the page uses it: the page's bridge in its
// frame, the door at the top, and the web bridge on a stand-in for the SSH core and the machine
// (support/fake-ssh.ts), whose daemon is a real HTTP server on a loopback port.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { PageBridge, ServiceState } from "../../desktop/src/bridge.ts";
import { frameBridge } from "../src/frame-bridge.ts";
import { webBridge, type Store } from "../src/host.ts";
import { REMOTE_COMMAND } from "../src/remote-command.ts";
import { serve } from "../src/serve.ts";
import { fakeMachine, fakeStream, fp, startDaemon, type Daemon, type Machine } from "./support/fake-ssh.ts";
import { windows } from "./support/windows.ts";

let daemon: Daemon;
before(async () => (daemon = await startDaemon()));
after(async () => daemon.stop());

function memoryStore(): Store {
	const kept = new Map<string, unknown>();
	return {
		get: async (name) => structuredClone(kept.get(name)) as any,
		set: async (name, value) => void kept.set(name, structuredClone(value)),
	};
}

/** The page's bridge on a web bridge for `machine`, keeping what it stores in `store`. */
function client(machine: Machine, store = memoryStore(), waitMs = 2) {
	const w = windows();
	const copied: string[] = [];
	// The waits between attempts to connect again, as asked for; each is a few milliseconds here.
	const waits: number[] = [];
	const wait = (ms: number) => (waits.push(ms), new Promise<void>((r) => setTimeout(r, waitMs)));
	const bridge = webBridge({ connect: machine.connect, store, relay: (host, port) => fakeStream(`wss://relay.test/ssh?host=${host}&port=${port}`), clipboard: async (text) => void copied.push(text), version: "9.9.9", wait, serviceMs: 500 });
	serve(bridge, w.top, () => w.frame);
	const page = frameBridge(w.parentOfFrame, w.frame);
	const states: ServiceState[] = [];
	const told: unknown[] = [];
	page.onService((s: ServiceState) => (states.push(s), told.push(s)));
	page.onEvents((e: unknown) => told.push(e));
	page.onConnection((c: unknown) => told.push(c));
	return { page, states, told, store, copied, waits, wake: () => bridge.wake(), stop: () => bridge.stop() };
}

/** Waits for the state the page was last told to match. */
async function becomes(c: { states: ServiceState[] }, match: (s: ServiceState) => boolean, ms = 3000): Promise<ServiceState> {
	const until = Date.now() + ms;
	for (;;) {
		const last = c.states.at(-1);
		if (last && match(last)) return last;
		if (Date.now() > until) throw new Error(`the page was never told that; last: ${JSON.stringify(last)}`);
		await new Promise((r) => setTimeout(r, 5));
	}
}

/** A page whose machine is added, its key trusted, and its pine ready. */
async function ready(machine = fakeMachine(daemon)) {
	const c = client(machine);
	await c.page.state();
	await c.page.addHost("me@box.example");
	await c.page.use("me@box.example");
	const asked = await becomes(c, (s) => s.status === "error");
	await c.page.trustHostKey!("me@box.example", (asked as { fingerprint: string }).fingerprint);
	await becomes(c, (s) => s.status === "ready");
	return { ...c, machine };
}

test("state: no machine of its own, the browser's platform, and a first start that asks for a machine", async () => {
	const c = client(fakeMachine(daemon));
	const s = await c.page.state();
	assert.equal(s.local, false);
	assert.equal(s.platform, "web");
	assert.equal(s.updates, false);
	assert.deepEqual(s.versions, { app: "9.9.9", electron: "none" });
	assert.deepEqual(s.prefs.hosts, []);
	assert.equal(s.state.status, "error");
	assert.match((s.state as { message: string }).message, /Add the machine/);
	c.stop();
});

test("the browser's key: made on first use, the same one after, as a line of authorized_keys, copied by the top", async () => {
	const store = memoryStore();
	const first = client(fakeMachine(daemon), store);
	const k = await first.page.deviceKey!();
	assert.match(k.key, /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]+=* pine-web$/);
	await k.copy();
	assert.deepEqual(first.copied, [k.key]);
	const again = client(fakeMachine(daemon), store);
	assert.equal((await again.page.deviceKey!()).key, k.key);
	// What is stored is a key WebCrypto will not hand out.
	const pair = (await store.get("key")) as CryptoKeyPair;
	assert.equal(pair.privateKey.extractable, false);
});

test("machines: user@host or user@host:port, kept in the browser's storage, at most once", async () => {
	const store = memoryStore();
	const c = client(fakeMachine(daemon), store);
	await c.page.state();
	for (const bad of ["box", "me@", "@box", "me@box:0", "me@box:70000", "-oProxyCommand=x@box", "me@box;rm", "me@bo x"]) await assert.rejects(c.page.addHost(bad), /user@host/, bad);
	await c.page.addHost("me@box.example");
	await c.page.addHost("root@203.0.113.7:2222");
	const prefs = await c.page.addHost("me@box.example");
	assert.deepEqual(prefs.hosts, ["me@box.example", "root@203.0.113.7:2222"]);
	assert.deepEqual((await client(fakeMachine(daemon), store).page.state()).prefs.hosts, ["me@box.example", "root@203.0.113.7:2222"]);
});

test("first connection: the page is shown the host key's fingerprint to trust, and nothing else is sent", async () => {
	const machine = fakeMachine(daemon);
	const c = client(machine);
	await c.page.state();
	await c.page.addHost("root@203.0.113.7:2222");
	await c.page.use("root@203.0.113.7:2222");
	const asked = await becomes(c, (s) => s.status === "error");
	assert.deepEqual({ ...asked, message: undefined }, { status: "error", kind: "ssh", host: "root@203.0.113.7:2222", fingerprint: machine.fingerprint, changed: false, message: undefined });
	assert.match((asked as { message: string }).message, new RegExp(`${machine.fingerprint.replace(/[+/]/g, "\\$&")}`));
	assert.deepEqual(machine.connects.map((x) => ({ url: x.url, user: x.user })), [{ url: "wss://relay.test/ssh?host=203.0.113.7&port=2222", user: "root" }]);
	assert.deepEqual(machine.commands, []);
	c.stop();
});

test("trusting: only the fingerprint shown is taken; then pine service runs as src/remote.ts runs it, and the pine is ready", async () => {
	const machine = fakeMachine(daemon);
	const c = client(machine);
	await c.page.state();
	await c.page.addHost("me@box.example");
	await c.page.use("me@box.example");
	await becomes(c, (s) => s.status === "error");
	await assert.rejects(c.page.trustHostKey!("me@box.example", fp("x")), /not the key/);
	await assert.rejects(c.page.trustHostKey!("other@box.example", machine.fingerprint), /not the key/);
	await c.page.trustHostKey!("me@box.example", machine.fingerprint);
	const s = await becomes(c, (x) => x.status === "ready");
	assert.deepEqual(s, { status: "ready", mode: "on box", started: true, home: "box:~/.pine", version: "0.50.0", from: "ssh me@box.example", host: "me@box.example", label: "box" });
	assert.deepEqual(machine.commands, [REMOTE_COMMAND]);
	c.stop();
});

test("ready: control API calls and the event stream go through a tunnel to the daemon's loopback port, with the token the page never sees", async () => {
	const c = await ready();
	assert.deepEqual(await c.page.call("GET", "/agents"), { ok: true, status: 200, data: [{ id: "main", main: true }] });
	assert.deepEqual(await c.page.call("POST", "/agents/main/message", { text: "hi" }), { ok: true, status: 200, data: { echoed: { text: "hi" } } });
	assert.deepEqual(await c.page.call("GET", "/agents/main/image"), { ok: true, status: 200, data: { mime: "image/png", base64: "iVBORw==" } });
	assert.equal((await c.page.call("GET", "/nowhere")).status, 404);
	const asked = daemon.seen.filter((x) => x.url === "/agents" || x.url === "/agents/main/message");
	assert.ok(asked.every((x) => x.auth === `Bearer ${daemon.token}` && x.host === `127.0.0.1:${daemon.port}`));
	assert.ok(c.machine.forwards.every((f) => f.host === "127.0.0.1" && f.port === daemon.port));
	// The event stream: up, and the daemon's event handed on in a batch.
	const until = Date.now() + 3000;
	while (!c.told.some((t) => Array.isArray(t) && t.some((e: any) => e.topic === "pine/hello"))) {
		if (Date.now() > until) throw new Error(`no events; told ${JSON.stringify(c.told)}`);
		await new Promise((r) => setTimeout(r, 10));
	}
	assert.ok(c.told.includes(true));
	assert.equal((await c.page.state()).connected, true);
	// Nothing the page was told or answered holds the daemon's token.
	const everything = JSON.stringify([c.told, await c.page.state(), await c.page.call("GET", "/agents")]);
	assert.ok(!everything.includes(daemon.token));
	c.stop();
});

test("a host key that changed is refused with both fingerprints, and cannot be trusted from the page", async () => {
	const c = await ready();
	const was = c.machine.fingerprint;
	c.machine.fingerprint = fp("z");
	await c.page.retry();
	const s = await becomes(c, (x) => x.status === "error");
	assert.equal((s as { changed: boolean }).changed, true);
	assert.equal((s as { fingerprint: string }).fingerprint, fp("z"));
	assert.ok((s as { message: string }).message.includes(was) && (s as { message: string }).message.includes(fp("z")));
	await assert.rejects(c.page.trustHostKey!("me@box.example", fp("z")), /not the key/);
	assert.equal(c.machine.commands.length, 1);
	c.stop();
});

test("forgetting a machine takes its host key along: added again, it is asked about as a new one", async () => {
	const c = await ready();
	const prefs = await c.page.forgetHost("me@box.example");
	assert.deepEqual(prefs.hosts, []);
	assert.equal(prefs.use, undefined);
	assert.equal(c.machine.open, 0);
	await c.page.addHost("me@box.example");
	await c.page.use("me@box.example");
	const s = await becomes(c, (x) => x.status === "error" && x.fingerprint !== undefined);
	assert.equal((s as { changed: boolean }).changed, false);
	c.stop();
});

test("trusted keys and the machine in use are remembered: a new page connects at once", async () => {
	const c = await ready();
	c.stop();
	const again = client(c.machine, c.store);
	const s = await again.page.state();
	assert.equal(s.prefs.use, "me@box.example");
	again.page.ready();
	await becomes(again, (x) => x.status === "ready");
	again.stop();
});

test("use: only a machine of the list, and never none", async () => {
	const c = client(fakeMachine(daemon));
	await c.page.state();
	await assert.rejects(c.page.use("me@elsewhere.example"), /not one of your machines/);
	await assert.rejects(c.page.use(), /no pine of its own/);
	c.stop();
});

test("a key the machine does not take, and a machine without pine, are said in words that say what to do", async () => {
	const machine = fakeMachine(daemon);
	const c = await ready(machine);
	machine.authorized = false;
	await c.page.retry();
	assert.match(((await becomes(c, (x) => x.status === "error")) as { message: string }).message, /did not accept this browser's key.*authorized_keys/);
	machine.authorized = true;
	machine.service = { out: "", err: "pine is not installed there: no pine command on its PATH.\n", exit: 127 };
	await c.page.retry();
	assert.match(((await becomes(c, (x) => x.status === "error" && /not installed/.test(x.message))) as { message: string }).message, /pine is not installed on me@box\.example/);
	c.stop();
});

test("a service line that names anything but the machine's own loopback is not connected to", async () => {
	const machine = fakeMachine(daemon);
	machine.service = { out: `${JSON.stringify({ base: "http://198.51.100.9:7777", token: "x", home: "~/.pine" })}\n` };
	const c = client(machine);
	await c.page.state();
	await c.page.addHost("me@box.example");
	await c.page.use("me@box.example");
	await c.page.trustHostKey!("me@box.example", ((await becomes(c, (s) => s.status === "error")) as { fingerprint: string }).fingerprint);
	const s = await becomes(c, (x) => x.status === "error" && x.kind === "failed");
	assert.match((s as { message: string }).message, /not a port of its own loopback/);
	assert.deepEqual(machine.forwards, []);
	c.stop();
});

test("prefs: the page's own, checked; the machines change by their own methods only", async () => {
	const c = client(fakeMachine(daemon));
	await c.page.state();
	const p = await c.page.prefs({ notify: true, agentAccent: false, hosts: ["evil@host"], use: "evil@host", look: { id: "x" } });
	assert.equal(p.notify, true);
	assert.equal(p.questionCards, true, "the questions' card is on unless turned off");
	assert.equal((await c.page.prefs({ questionCards: false })).questionCards, false);
	assert.equal((await c.page.prefs({ questionCards: "no" })).questionCards, false, "only a boolean changes it");
	assert.equal("agentAccent" in p, false, "the agent's color in front is no preference any more");
	assert.deepEqual(p.hosts, []);
	assert.equal(p.use, undefined);
	assert.equal(p.look, undefined);
	c.stop();
});

/** Waits until `ok()` holds. */
async function until(ok: () => boolean, what: string, ms = 3000) {
	const end = Date.now() + ms;
	while (!ok()) {
		if (Date.now() > end) throw new Error(`never: ${what}`);
		await new Promise((r) => setTimeout(r, 5));
	}
}

/** Whether the page was told the daemon's hello after the `from`th thing it was told. */
const helloAfter = (told: unknown[], from: number) => told.slice(from).some((t) => Array.isArray(t) && t.some((e: any) => e.topic === "pine/hello"));

test("a dropped connection is made again by itself: the page stays in its conversations, and the event stream resumes", async () => {
	const c = await ready();
	await until(() => helloAfter(c.told, 0), "the first hello");
	const states = c.states.length;
	const mark = c.told.length;
	c.machine.drop();
	await until(() => c.told.slice(mark).includes(false), "told the stream is down");
	await until(() => c.told.slice(mark).lastIndexOf(true) > c.told.slice(mark).indexOf(false), "told the stream is up again");
	await until(() => helloAfter(c.told, mark), "the events resume");
	// The page is not sent back to the start screen: nothing but "ready" was said meanwhile.
	assert.ok(c.states.slice(states).every((s) => s.status === "ready"), JSON.stringify(c.states.slice(states)));
	assert.equal(c.machine.commands.length, 2);
	assert.equal(c.machine.open, 1);
	assert.equal((await c.page.call("GET", "/agents")).status, 200);
	assert.equal((await c.page.state()).connected, true);
	c.stop();
});

test("connecting again backs off, says what is wrong while it cannot, and is back when the machine is", async () => {
	const c = await ready();
	const mark = c.states.length;
	c.machine.reachable = false;
	c.machine.drop();
	const down = await becomes(c, (s) => s.status === "error", 5000);
	assert.match((down as { message: string }).message, /could not be reached.*port 22/);
	await until(() => c.waits.length >= 6, "six waits");
	assert.deepEqual(c.waits.slice(0, 6), [1000, 2000, 4000, 8000, 16000, 30000]);
	c.machine.reachable = true;
	await becomes(c, (s) => s.status === "ready", 5000);
	assert.ok(c.states.slice(mark).every((s) => s.status !== "starting"), "the page was never sent to the start screen's spinner");
	c.stop();
});

test("waking (the network is back, the tab is shown again) tries at once instead of waiting out the backoff", async () => {
	const c = await ready();
	c.machine.reachable = false;
	c.machine.drop();
	await becomes(c, (s) => s.status === "error", 5000);
	const tries = c.machine.connects.length;
	c.wake();
	await until(() => c.machine.connects.length > tries, "another attempt");
	c.stop();
});

test("a stop for good while connecting again: a key no longer taken, or a host key that changed, is said and not tried again", async () => {
	const c = await ready();
	c.machine.authorized = false;
	c.machine.drop();
	const s = await becomes(c, (x) => x.status === "error", 5000);
	assert.match((s as { message: string }).message, /did not accept this browser's key.*ssh-ed25519 AAAA/);
	const tries = c.machine.connects.length;
	await new Promise((r) => setTimeout(r, 100));
	assert.equal(c.machine.connects.length, tries);
	c.stop();
});

test("the relay's refusals reach the page as what to do", async () => {
	const machine = fakeMachine(daemon);
	machine.reachable = "refused";
	const c = client(machine);
	await c.page.state();
	await c.page.addHost("me@box.example:2222");
	await c.page.use("me@box.example:2222");
	const s = await becomes(c, (x) => x.status === "error");
	assert.match((s as { message: string }).message, /relay.*public address/);
	machine.reachable = false;
	await c.page.retry();
	assert.match(((await becomes(c, (x) => x.status === "error" && /could not be reached/.test(x.message))) as { message: string }).message, /box\.example.*port 2222/);
	c.stop();
});

test("a machine of a tailnet that the relay cannot reach is told to turn Tailscale Funnel on for its port", async () => {
	const machine = fakeMachine(daemon);
	machine.reachable = "refused";
	const c = client(machine);
	await c.page.state();
	await c.page.addHost("me@pine.example-tailnet.ts.net:10000");
	await c.page.use("me@pine.example-tailnet.ts.net:10000");
	const refused = (await becomes(c, (x) => x.status === "error")) as { message: string };
	assert.match(refused.message, /Funnel.*443, 8443 or 10000.*tailscale funnel --bg --tls-terminated-tcp=10000 tcp:\/\/localhost:22/);
	for (const reachable of ["tls", false] as const) {
		machine.reachable = reachable;
		const mark = c.states.length;
		await c.page.retry();
		const said = () => c.states.slice(mark).find((x) => x.status === "error" && /did not answer through Tailscale Funnel/.test(x.message)) as { message: string } | undefined;
		await until(() => said() !== undefined, `the Funnel advice after "${reachable}"`);
		assert.match(said()!.message, /pine\.example-tailnet\.ts\.net.*port 10000.*tailscale funnel --bg --tls-terminated-tcp=10000 tcp:\/\/localhost:22/);
	}
	c.stop();
});

test("the page's own storage (the side panel's widths, what is folded) is kept through prefs: only its keys, as text, within bounds", async () => {
	const store = memoryStore();
	const c = client(fakeMachine(daemon), store);
	await c.page.state();
	const p = (await c.page.prefs({ storage: { "pine.sidebar.width": "300", "pine.folded": '["main"]', "pine.aside": "shown", other: "x", "pine.number": 7, "pine.long": "x".repeat(20_000) } })) as { storage?: Record<string, string> };
	assert.deepEqual(p.storage, { "pine.sidebar.width": "300", "pine.folded": '["main"]', "pine.aside": "shown" });
	// A change of another preference keeps it; a new page is given it with the state.
	await c.page.prefs({ notify: true });
	const again = (await client(fakeMachine(daemon), store).page.state()).prefs as { storage?: Record<string, string>; notify: boolean };
	assert.equal(again.notify, true);
	assert.deepEqual(again.storage, { "pine.sidebar.width": "300", "pine.folded": '["main"]', "pine.aside": "shown" });
	// Too many keys: none of the change is kept.
	const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`pine.k${i}`, "1"]));
	await assert.rejects(c.page.prefs({ storage: many }), /too much/);
	c.stop();
});

test("a pine that says nothing is said to be not answering, and is tried again after a drop until it answers", async () => {
	const c = await ready();
	const answering = c.machine.service;
	c.machine.service = { out: "" };
	c.machine.drop();
	const s = await becomes(c, (x) => x.status === "error", 8000);
	assert.match((s as { message: string }).message, /pine on me@box\.example is not answering/);
	c.machine.service = answering;
	c.wake();
	await becomes(c, (x) => x.status === "ready", 8000);
	c.stop();
});

test("a first connection that fails for a reason that may pass (the relay, the network) is tried again with a backoff, and at once on waking", async () => {
	const c = await ready();
	c.stop();
	c.machine.reachable = "refused";
	// Waits that never end by themselves: only waking moves the attempts on.
	const again = client(c.machine, c.store, 60_000);
	await again.page.state();
	again.page.ready();
	const s = await becomes(again, (x) => x.status === "error");
	assert.match((s as { message: string }).message, /relay did not open a connection/);
	await until(() => again.waits.length === 1, "a wait before the next attempt");
	assert.equal(again.waits[0], 1000);
	const tries = c.machine.connects.length;
	c.machine.reachable = true;
	again.wake();
	await becomes(again, (x) => x.status === "ready");
	assert.equal(c.machine.connects.length, tries + 1);
	again.stop();
});

test("a first connection that fails is tried again by itself after its wait", async () => {
	const c = await ready();
	c.stop();
	c.machine.reachable = false;
	const again = client(c.machine, c.store);
	await again.page.state();
	again.page.ready();
	await becomes(again, (x) => x.status === "error");
	c.machine.reachable = true;
	await becomes(again, (x) => x.status === "ready");
	again.stop();
});

test("disconnecting goes back to the machines: the connection is let go of, the machine and its host key stay, and nothing connects again", async () => {
	const machine = fakeMachine(daemon);
	// A connection that waits while `hold` does, to disconnect while one is being made.
	let hold: Promise<void> | undefined;
	const real = machine.connect;
	machine.connect = async (o) => {
		await hold;
		return real(o);
	};
	const c = await ready(machine);
	const prefs = await c.page.disconnect!();
	assert.equal(prefs.use, undefined);
	assert.deepEqual(prefs.hosts, ["me@box.example"]);
	assert.equal(machine.open, 0);
	assert.equal(c.states.at(-1)?.status, "error");
	assert.match((c.states.at(-1) as { message: string }).message, /Add the machine/);
	assert.equal((await c.page.state()).connected, false);
	// A new page on the same storage connects to nothing, and the host key is still trusted.
	const again = client(machine, c.store);
	assert.equal((await again.page.state()).prefs.use, undefined);
	await again.page.use("me@box.example");
	await becomes(again, (x) => x.status === "ready");
	// A connection being made when the owner disconnects does not come back.
	let release!: () => void;
	hold = new Promise((r) => (release = r));
	await again.page.retry();
	await until(() => again.states.at(-1)?.status === "starting", "connecting");
	await again.page.disconnect!();
	const commands = machine.commands.length;
	release();
	await new Promise((r) => setTimeout(r, 50));
	assert.equal(machine.open, 0);
	assert.equal(machine.commands.length, commands);
	assert.match((again.states.at(-1) as { message: string }).message, /Add the machine/);
	again.stop();
	c.stop();
});

// The page's type is the contract: this compiles only while the frame's bridge is one.
const _contract: (w: ReturnType<typeof windows>) => PageBridge = (w) => frameBridge(w.parentOfFrame, w.frame);
void _contract;
