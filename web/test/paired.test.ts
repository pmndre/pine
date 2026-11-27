// Paired computers in the web bridge, through the page's `window.pine`: a pairing link handed to
// the bridge, the computer's answer, the machine kept under its name, and what the owner is told
// when the way to it cannot be opened. The computer and the peer transport are stand-ins
// (support/fake-ssh.ts). The stand-in calls itself "Studio Mac" on a yes: a name its owner gave
// it, which the texts use once it is known; before that they say "your computer".
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ServiceState } from "../../desktop/src/bridge.ts";
import { frameBridge } from "../src/frame-bridge.ts";
import { webBridge, type Store, type WebBridgeDeps } from "../src/host.ts";
import { firstScreen, machineName, pairingEnded } from "../../desktop/src/machines.ts";
import { pairedFingerprint, type PairLink } from "../src/pairing.ts";
import { REMOTE_COMMAND } from "../src/remote-command.ts";
import { serve } from "../src/serve.ts";
import { DIGITS, fakeMachine, fakeStream, fp, startDaemon, type Daemon, type Machine } from "./support/fake-ssh.ts";
import { windows } from "./support/windows.ts";

let daemon: Daemon;
before(async () => (daemon = await startDaemon()));
after(async () => daemon.stop());

const ID = "q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x-_";
const CODE = "AAECAwQFBgcICQoLDA0ODw";
const PAIRED = `paired:${ID}`;
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

function memoryStore(seed: Record<string, unknown> = {}): Store & { kept: Map<string, unknown> } {
	const kept = new Map<string, unknown>(Object.entries(seed));
	return {
		kept,
		get: async (name) => structuredClone(kept.get(name)) as any,
		set: async (name, value) => void kept.set(name, structuredClone(value)),
	};
}

/** A computer with a pairing open at it, its host key the one the link names. */
function computer(): Machine {
	const m = fakeMachine(daemon);
	m.fingerprint = pairedFingerprint(ID);
	m.authorized = false;
	m.pairCode = CODE;
	return m;
}

function client(machine: Machine, options: { store?: ReturnType<typeof memoryStore>; pairLink?: PairLink; config?: WebBridgeDeps["config"]; serviceHost?: string; waitMs?: number; openApp?: () => void } = {}) {
	const w = windows();
	const store = options.store ?? memoryStore();
	const waits: number[] = [];
	const wait = (ms: number) => (waits.push(ms), new Promise<void>((r) => setTimeout(r, options.waitMs ?? 2)));
	const bridge = webBridge({
		connect: machine.connect,
		store,
		relay: (host, port) => fakeStream(`wss://relay.test/ssh?host=${host}&port=${port}`),
		peer: machine.peer,
		pairLink: options.pairLink,
		userAgent: ANDROID,
		config: options.config,
		serviceHost: options.serviceHost,
		clipboard: async () => {},
		version: "9.9.9",
		wait,
		serviceMs: 500,
		openApp: options.openApp,
	});
	serve(bridge, w.top, () => w.frame);
	const page = frameBridge(w.parentOfFrame, w.frame);
	const states: ServiceState[] = [];
	page.onService((s: ServiceState) => void states.push(s));
	return { page, states, store, waits, wake: () => bridge.wake(), stop: () => bridge.stop() };
}

async function becomes(c: { states: ServiceState[] }, match: (s: ServiceState) => boolean, ms = 3000): Promise<ServiceState> {
	const until = Date.now() + ms;
	for (;;) {
		const last = c.states.at(-1);
		if (last && match(last)) return last;
		if (Date.now() > until) throw new Error(`the page was never told that; last: ${JSON.stringify(last)}`);
		await new Promise((r) => setTimeout(r, 5));
	}
}

const message = (s: ServiceState) => (s as { message?: string }).message ?? "";

/** A page that paired with the computer and is in its conversations. */
async function paired(machine = computer(), store = memoryStore()) {
	const c = client(machine, { store, pairLink: { id: ID, code: CODE } });
	await c.page.state();
	c.page.ready();
	await becomes(c, (s) => s.status === "starting" && s.pairing?.code === DIGITS);
	machine.answer("allow");
	await becomes(c, (s) => s.status === "ready");
	return { ...c, machine };
}

test("pairing: through the peer transport, with the key the link names and the pairing user; the digits while the owner decides; nothing kept until the yes", async () => {
	const machine = computer();
	const c = client(machine, { pairLink: { id: ID, code: CODE } });
	const first = await c.page.state();
	assert.equal(first.state.status, "starting");
	assert.ok((first.state as { pairing?: object }).pairing, "the first screen is told a pairing is under way");
	c.page.ready();
	const asked = await becomes(c, (s) => s.status === "starting" && s.pairing?.code !== undefined);
	assert.deepEqual(asked, { status: "starting", pairing: { code: DIGITS, name: "Chrome on Android" } });
	assert.deepEqual(machine.connects, [{ url: `peer:${ID}`, user: `pair.${CODE}`, hostFingerprint: pairedFingerprint(ID) }]);
	assert.deepEqual(machine.pairings, ["Chrome on Android"]);
	// While the owner decides, nothing of the computer is kept.
	assert.equal(c.store.kept.get("hostKeys"), undefined);
	assert.deepEqual((await c.page.state()).prefs.hosts, []);
	c.stop();
});

test("Allow: the computer is kept under its computer's name with the key its link names, and connected to as a paired browser", async () => {
	const c = await paired();
	const s = (await c.page.state()) as Awaited<ReturnType<typeof c.page.state>>;
	assert.deepEqual(s.prefs.hosts, [PAIRED]);
	assert.equal(s.prefs.use, PAIRED);
	assert.deepEqual(s.prefs.names, { [PAIRED]: "Studio Mac" });
	assert.deepEqual(c.store.kept.get("hostKeys"), { [PAIRED]: pairedFingerprint(ID) });
	assert.deepEqual(c.machine.connects.at(-1), { url: `peer:${ID}`, user: "pine", hostFingerprint: pairedFingerprint(ID) });
	assert.deepEqual(c.machine.commands.at(-1), REMOTE_COMMAND);
	const ready = s.state as { mode: string; from: string };
	assert.deepEqual({ ...(s.state as object), version: undefined, mode: undefined, from: undefined }, { status: "ready", mode: undefined, started: true, home: "Studio Mac:~/.pine", version: undefined, from: undefined, host: PAIRED, label: "Studio Mac" });
	assert.ok(ready.mode.includes("Studio Mac") && ready.from.includes("Studio Mac") && !`${ready.mode} ${ready.from}`.includes(ID), "where it runs and how it is reached are said by the computer's name, never its id");
	// The pairing session was let go of: one connection open, the paired one.
	assert.equal(c.machine.open, 1);
	assert.equal((await c.page.call("GET", "/agents")).status, 200);
	c.stop();
});

test("a computer whose key is not the one the link names is refused before the browser's key is offered, and nothing is kept", async () => {
	const machine = computer();
	machine.fingerprint = fp("z");
	const c = client(machine, { pairLink: { id: ID, code: CODE } });
	await c.page.state();
	c.page.ready();
	const s = await becomes(c, (x) => x.status === "error");
	// It is said; that the key was never offered and nothing was trusted is proven below.
	assert.ok(message(s));
	assert.equal(machine.keysOffered, 0);
	assert.equal(c.store.kept.get("hostKeys"), undefined);
	assert.deepEqual((await c.page.state()).prefs.hosts, []);
	c.stop();
});

test("Refuse, or a pairing that expired or was used, is said and keeps nothing", async () => {
	for (const decision of ["refuse", "expired"] as const) {
		const machine = computer();
		const c = client(machine, { pairLink: { id: ID, code: CODE } });
		await c.page.state();
		c.page.ready();
		await becomes(c, (s) => s.status === "starting" && s.pairing?.code === DIGITS);
		machine.answer(decision);
		const s = await becomes(c, (x) => x.status === "error");
		assert.match(message(s), decision === "refuse" ? /refused/ : /expired/, decision);
		assert.doesNotMatch(message(s), /\bMac\b/, "before the yes the browser knows no name, and says your computer");
		assert.equal(c.store.kept.get("hostKeys"), undefined, decision);
		assert.deepEqual((await c.page.state()).prefs.hosts, [], decision);
		c.stop();
	}
	// A code the computer no longer has: its pairing was used, closed or ran out.
	const machine = computer();
	machine.pairCode = undefined;
	const c = client(machine, { pairLink: { id: ID, code: CODE } });
	await c.page.state();
	c.page.ready();
	assert.match(message(await becomes(c, (x) => x.status === "error")), /expired/);
	assert.deepEqual(machine.pairings, []);
	c.stop();
});

/**
 * The first sessions end as the SSH library's does when the channel closed under it: "silent",
 * before the computer sent a byte; "heard", after it did. Returns how many sessions were tried.
 */
function endsEarly(machine: Machine, firsts: Array<"silent" | "heard">) {
	const { connect, peer } = machine;
	let current: "silent" | "heard" | undefined;
	let tries = 0;
	machine.peer = (id) => async () => {
		const transport = await peer(id)();
		return { ...transport, onData: (next) => void (current === "heard" && next(new TextEncoder().encode("SSH-2.0-"))) };
	};
	machine.connect = async (options) => {
		tries++;
		current = firsts.shift();
		if (!current) return connect(options);
		const transport = await options.open();
		transport.onData(() => {});
		throw new Error("Failed to read the protocol version");
	};
	return () => tries;
}

test("pairing: a channel that ended before the computer said a byte is tried once more, since the code was not used", async () => {
	const machine = computer();
	const tries = endsEarly(machine, ["silent"]);
	const c = client(machine, { pairLink: { id: ID, code: CODE } });
	await c.page.state();
	c.page.ready();
	await becomes(c, (s) => s.status === "starting" && s.pairing?.code === DIGITS);
	assert.equal(tries(), 2);
	machine.answer("allow");
	await becomes(c, (s) => s.status === "ready");
	c.stop();
});

test("pairing: only once more; and never after the computer said anything", async () => {
	for (const [firsts, attempts] of [
		[["silent", "silent"], 2],
		[["heard"], 1],
	] as const) {
		const machine = computer();
		const tries = endsEarly(machine, [...firsts]);
		const c = client(machine, { pairLink: { id: ID, code: CODE } });
		await c.page.state();
		c.page.ready();
		const s = await becomes(c, (x) => x.status === "error");
		assert.ok(message(s), "said, whatever the words");
		assert.equal((s as { host?: string }).host, undefined, "and no machine came of it");
		assert.equal(tries(), attempts, firsts.join());
		c.stop();
	}
});

test("a key already kept for the computer is never replaced by the link's; a computer that shows another one is refused for good", async () => {
	const store = memoryStore({ hostKeys: { [PAIRED]: fp("q") } });
	const machine = computer();
	const c = client(machine, { store, pairLink: { id: ID, code: CODE } });
	await c.page.state();
	c.page.ready();
	await becomes(c, (s) => s.status === "starting" && s.pairing?.code === DIGITS);
	machine.answer("allow");
	const s = await becomes(c, (x) => x.status === "error");
	assert.deepEqual(store.kept.get("hostKeys"), { [PAIRED]: fp("q") });
	assert.equal((s as { changed?: boolean }).changed, true);
	assert.ok(message(s).includes("Studio Mac"), "said of the computer by its name");
	// Nor can the page trust it by hand: a paired computer's key comes from its link alone.
	await assert.rejects(c.page.trustHostKey!(PAIRED, pairedFingerprint(ID)));
	assert.deepEqual(store.kept.get("hostKeys"), { [PAIRED]: fp("q") });
	c.stop();
});

test("a user@host machine added after pairing keeps today's confirmation of its host key", async () => {
	const c = await paired();
	await c.page.addHost("me@box.example");
	await c.page.use("me@box.example");
	const s = await becomes(c, (x) => x.status === "error" && x.host === "me@box.example");
	assert.equal((s as { changed?: boolean }).changed, false);
	assert.deepEqual(c.store.kept.get("hostKeys"), { [PAIRED]: pairedFingerprint(ID) });
	c.stop();
});

test("a machine's name: renamed by the owner, checked; forgetting the machine drops its name and its key", async () => {
	const c = await paired();
	const renamed = await c.page.renameHost!(PAIRED, "  Office\u0007 Mac  ");
	assert.deepEqual(renamed.names, { [PAIRED]: "Office Mac" });
	await assert.rejects(c.page.renameHost!(PAIRED, " \n "), "a name of nothing");
	await assert.rejects(c.page.renameHost!("paired:somewhere-else", "x"), "a machine that is not on the list");
	assert.deepEqual((await c.page.state()).prefs.names, { [PAIRED]: "Office Mac" });
	assert.equal((await c.page.renameHost!(PAIRED, "y".repeat(100))).names?.[PAIRED], "y".repeat(60));
	const forgotten = await c.page.forgetHost(PAIRED);
	assert.deepEqual(forgotten.hosts, []);
	assert.deepEqual(forgotten.names ?? {}, {});
	assert.deepEqual(c.store.kept.get("hostKeys"), {});
	assert.equal(c.machine.open, 0);
	c.stop();
});

test("a paired computer is added by its link only: addHost takes user@host, never paired:", async () => {
	const c = client(computer());
	await c.page.state();
	await assert.rejects(c.page.addHost(PAIRED), /user@host/);
	c.stop();
});

test("whether user@host machines can be added comes from the service's configuration; a failed read leaves them", async () => {
	const off = client(computer(), { config: async () => ({ ice: [], relay: false }) });
	const s = await off.page.state();
	assert.equal(s.canAddHost, false);
	await assert.rejects(off.page.addHost("me@box.example"));
	assert.deepEqual((await off.page.state()).prefs.hosts, []);
	off.stop();
	for (const config of [async () => ({ ice: [], relay: true }), async () => Promise.reject(new Error("offline")), async () => "nonsense", undefined]) {
		const c = client(computer(), { config: config as WebBridgeDeps["config"] });
		assert.equal((await c.page.state()).canAddHost, true);
		await c.page.addHost("me@box.example");
		c.stop();
	}
});

test("whether pairing is offered comes from the service's configuration too: a deployment that answers /meet/config has the meeting service", async () => {
	const cases: [string, WebBridgeDeps["config"], { canPair: boolean; canAddHost: boolean }][] = [
		["meeting and relay", async () => ({ ice: [], relay: true }), { canPair: true, canAddHost: true }],
		["meeting only", async () => ({ ice: [], relay: false }), { canPair: true, canAddHost: false }],
		// The default configuration answers /meet/config with 404, which bridge-main.ts reads as null.
		["relay only", async () => null, { canPair: false, canAddHost: true }],
		["an answer that is no configuration", async () => "nonsense", { canPair: false, canAddHost: true }],
		["no configuration", undefined, { canPair: false, canAddHost: true }],
	];
	for (const [name, config, said] of cases) {
		const c = client(computer(), { config });
		const s = await c.page.state();
		assert.deepEqual({ canPair: s.canPair, canAddHost: s.canAddHost }, said, name);
		c.stop();
	}
});

test("a deployment without the meeting service (404) is told once and for the visit: the configuration is not read again", async () => {
	let reads = 0;
	const c = client(computer(), { config: async () => (reads++, null) });
	assert.equal((await c.page.state()).canPair, false);
	assert.equal((await c.page.state()).canPair, false);
	assert.equal(reads, 1);
	c.stop();
});

test("a failed read of the configuration (offline, a 429, a 5xx) is not taken for no meeting service: it is read again, and pairing is offered once it answers", async () => {
	// Fails once, then answers: the first answer is not held up, and the bridge reads it again by itself.
	let reads = 0;
	const flaky = client(computer(), { config: async () => (++reads <= 1 ? Promise.reject(new Error("429")) : { ice: [], relay: true }) });
	assert.equal((await flaky.page.state()).canPair, false);
	const until = Date.now() + 2000;
	while (reads < 2 && Date.now() < until) await new Promise((r) => setTimeout(r, 5));
	const s = await flaky.page.state();
	assert.deepEqual({ canPair: s.canPair, canAddHost: s.canAddHost }, { canPair: true, canAddHost: true });
	flaky.stop();
	// Fails for longer than the bridge tries by itself: read again at the next state read, which can say yes.
	let down = true;
	let tries = 0;
	const later = client(computer(), { config: async () => (tries++, down ? Promise.reject(new Error("offline")) : { ice: [], relay: false }) });
	const first = await later.page.state();
	assert.deepEqual({ canPair: first.canPair, canAddHost: first.canAddHost }, { canPair: false, canAddHost: true });
	while (tries < 3 && Date.now() < until + 2000) await new Promise((r) => setTimeout(r, 5));
	assert.equal(tries, 3, "the bridge's own tries");
	assert.equal((await later.page.state()).canPair, false);
	assert.equal(tries, 4, "read again at a state read");
	down = false;
	const next = await later.page.state();
	assert.deepEqual({ canPair: next.canPair, canAddHost: next.canAddHost }, { canPair: true, canAddHost: false });
	// Known now: the first screen says to pair, and nothing is read again.
	assert.doesNotMatch(message(next.state), /user@host/);
	await later.page.state();
	assert.equal(tries, 5);
	later.stop();
});

test("the page is told the deployment's host, which it names as the relay's and the meeting service's; none is invented", async () => {
	const named = client(computer(), { serviceHost: "pine-main.drcmda.workers.dev" });
	assert.equal((await named.page.state()).serviceHost, "pine-main.drcmda.workers.dev");
	named.stop();
	const none = client(computer());
	assert.equal("serviceHost" in (await none.page.state()), false);
	none.stop();
});

test("a paired computer that does not answer, or no direct way from this network, is said and tried again with a growing wait", async () => {
	// Each of the three is said in words of its own; the two that are about the computer name it.
	const saidOf = new Map<string, string>();
	for (const [meeting, named] of [
		["absent", true],
		["no-path", true],
		["limits", false],
	] as const) {
		const c = await paired();
		c.machine.meeting = meeting;
		c.machine.drop();
		const s = await becomes(c, (x) => x.status === "error", 5000);
		assert.ok(message(s) && (!named || message(s).includes("Studio Mac")), `${meeting}: ${message(s)}`);
		saidOf.set(meeting, message(s));
		const waits = c.waits.length;
		const until = Date.now() + 3000;
		while (c.waits.length < waits + 2 && Date.now() < until) await new Promise((r) => setTimeout(r, 5));
		assert.ok(c.waits.length >= waits + 2, `${meeting}: tried again`);
		c.machine.meeting = "ok";
		await becomes(c, (x) => x.status === "ready", 5000);
		c.stop();
	}
	assert.equal(new Set(saidOf.values()).size, 3, `the three are told apart: ${[...saidOf.values()].join(" | ")}`);
});

test("a browser the paired computer no longer knows is told to add this device again, and is not tried again", async () => {
	const c = await paired();
	c.machine.authorized = false;
	c.machine.drop();
	const s = await becomes(c, (x) => x.status === "error", 5000);
	assert.ok(message(s).includes("Studio Mac"), "said of the computer by its name");
	const tries = c.machine.connects.length;
	await new Promise((r) => setTimeout(r, 100));
	assert.equal(c.machine.connects.length, tries);
	c.stop();
});

test("a paired computer is connected to again by a new page, under its name", async () => {
	const c = await paired();
	c.stop();
	const again = client(c.machine, { store: c.store });
	assert.deepEqual((await again.page.state()).prefs.names, { [PAIRED]: "Studio Mac" });
	again.page.ready();
	await becomes(again, (x) => x.status === "ready");
	assert.deepEqual(c.machine.connects.at(-1)?.user, "pine");
	again.stop();
});

test("the page reads a pairing from the states it is told: the four digits on the first screen, then paired; a refusal ends it as failed", async () => {
	for (const decision of ["allow", "refuse"] as const) {
		const machine = computer();
		const c = client(machine, { pairLink: { id: ID, code: CODE } });
		const first = await c.page.state();
		const waiting = firstScreen(first.state)?.title;
		assert.ok(waiting, "a first screen of its own while the computer has not answered");
		c.page.ready();
		const asked = await becomes(c, (s) => s.status === "starting" && s.pairing?.code === DIGITS);
		assert.equal(firstScreen(asked)?.code, DIGITS);
		assert.notEqual(firstScreen(asked)?.title, waiting, "and another once the computer asks");
		machine.answer(decision);
		await becomes(c, (s) => (decision === "allow" ? s.status === "ready" : s.status === "error"));
		const ends = c.states.map((s, i) => (i ? pairingEnded(c.states[i - 1], s) : undefined)).filter(Boolean);
		assert.deepEqual(ends, [decision === "allow" ? "paired" : "failed"], decision);
		// What the page lists after the yes: the computer under its name, never its id.
		const { prefs } = await c.page.state();
		if (decision === "allow") assert.deepEqual(prefs.hosts.map((h) => machineName(h, prefs.names)), ["Studio Mac"]);
		else assert.deepEqual(prefs.hosts, []);
		c.stop();
	}
});

test("where user@host machines cannot be added, the first screen is told to pair a computer, not to add user@host", async () => {
	const off = client(computer(), { config: async () => ({ ice: [], relay: false }) });
	const s = await off.page.state();
	assert.equal(s.state.status, "error");
	assert.doesNotMatch(message(s.state), /user@host|authorized_keys/);
	off.stop();
	const on = client(computer());
	assert.match(message((await on.page.state()).state), /user@host/);
	on.stop();
});

test("'Open Pine on this computer' is offered where the bridge can open pine://pair and pair; asking for it opens it, and nothing else", async () => {
	const opened: string[] = [];
	const meeting = async () => ({ ice: [], relay: true });
	const here = client(computer(), { config: meeting, openApp: () => void opened.push("pine://pair") });
	assert.equal((await here.page.state()).canOpenApp, true);
	await here.page.openApp!();
	assert.deepEqual(opened, ["pine://pair"]);
	here.stop();
	const phone = client(computer(), { config: meeting });
	assert.equal((await phone.page.state()).canOpenApp, undefined);
	await assert.rejects(phone.page.openApp!());
	assert.deepEqual(opened, ["pine://pair"], "and nothing was opened");
	phone.stop();
	const noMeeting = client(computer(), { openApp: () => void opened.push("x") });
	assert.equal((await noMeeting.page.state()).canOpenApp, undefined, "nothing to pair with: not offered");
	noMeeting.stop();
});
