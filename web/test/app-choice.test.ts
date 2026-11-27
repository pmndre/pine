// On an iPhone or iPad a pairing link waits for the owner's choice between the Pine app and this
// browser before its code is used; on every other device it pairs at once. Through the page's
// `window.pine`, with the stand-ins for the computer and the peer transport (support/fake-ssh.ts),
// and a stand-in for the choice the bridge's document draws.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ServiceState } from "../../desktop/src/bridge.ts";
import { readPairLink } from "../../desktop/src/machines.ts";
import { appAddress, chooseApp, onIosDevice, type ChoiceView } from "../src/app-choice.ts";
import { frameBridge } from "../src/frame-bridge.ts";
import { webBridge, type Store } from "../src/host.ts";
import { pairedFingerprint, type PairLink } from "../src/pairing.ts";
import { serve } from "../src/serve.ts";
import { DIGITS, fakeMachine, fakeStream, startDaemon, type Daemon, type Machine } from "./support/fake-ssh.ts";
import { windows } from "./support/windows.ts";

let daemon: Daemon;
before(async () => (daemon = await startDaemon()));
after(async () => daemon.stop());

const ID = "q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x-_";
const CODE = "AAECAwQFBgcICQoLDA0ODw";
const LINK: PairLink = { id: ID, code: CODE };
const SERVICE = "https://pine.example.workers.dev/";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

function memoryStore(): Store {
	const kept = new Map<string, unknown>();
	return { get: async (name) => structuredClone(kept.get(name)) as any, set: async (name, value) => void kept.set(name, structuredClone(value)) };
}

function computer(): Machine {
	const m = fakeMachine(daemon);
	m.fingerprint = pairedFingerprint(ID);
	m.authorized = false;
	m.pairCode = CODE;
	return m;
}

/** A stand-in for the choice: what it was told, and the owner's presses. */
function view() {
	let pressed: { app(): void; browser(): void } | undefined;
	const said: string[] = [];
	const v: ChoiceView = { show: (p) => void ((pressed = p), said.push("shown")), tried: () => void said.push("tried"), close: () => void said.push("closed") };
	return { v, said, app: () => pressed!.app(), browser: () => pressed!.browser() };
}

/** The bridge as bridge-main.ts builds it on an iPhone (`choose`) or elsewhere (none). */
function client(machine: Machine, userAgent: string, choose?: (link: PairLink) => Promise<void>) {
	const w = windows();
	const bridge = webBridge({
		connect: machine.connect,
		store: memoryStore(),
		relay: (host, port) => fakeStream(`wss://relay.test/ssh?host=${host}&port=${port}`),
		peer: machine.peer,
		pairLink: LINK,
		choose,
		userAgent,
		clipboard: async () => {},
		version: "9.9.9",
		wait: () => new Promise<void>((r) => setTimeout(r, 2)),
		serviceMs: 500,
	});
	serve(bridge, w.top, () => w.frame);
	const page = frameBridge(w.parentOfFrame, w.frame);
	const states: ServiceState[] = [];
	page.onService((s: ServiceState) => void states.push(s));
	return { page, states, stop: () => bridge.stop() };
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

const settle = () => new Promise((r) => setTimeout(r, 60));
/** Waits for what is to come, as long as a busy computer needs; the assertion after it says what is missing. */
async function until(done: () => boolean, ms = 3000): Promise<void> {
	for (const end = Date.now() + ms; !done() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 5));
}

test("an iPhone, an iPod and an iPad are told apart from other devices, an iPad by its touch screen behind a Mac's user agent", () => {
	assert.equal(onIosDevice(IPHONE, 5), true);
	assert.equal(onIosDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15", 5), true);
	assert.equal(onIosDevice("Mozilla/5.0 (iPod touch; CPU iPhone OS 16_0 like Mac OS X)", 5), true);
	assert.equal(onIosDevice(IPAD, 5), true);
	assert.equal(onIosDevice(IPAD, 0), false, "a Mac");
	assert.equal(onIosDevice(ANDROID, 5), false);
	assert.equal(onIosDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", 10), false);
	assert.equal(onIosDevice("", 0), false);
});

test("the app's address carries the service's origin, the machine id and the code, in the form the app reads", () => {
	const address = appAddress(`${SERVICE}some/path?x=1#pair=${ID}.${CODE}`, LINK);
	assert.equal(address, `pine://pair?service=https%3A%2F%2Fpine.example.workers.dev&id=${ID}&code=${CODE}`);
	// Read back as the contract between the web client and the app has it: these three and nothing else.
	const u = new URL(address);
	assert.equal(u.protocol, "pine:");
	assert.equal(u.host, "pair");
	assert.deepEqual([...u.searchParams.keys()], ["service", "id", "code"]);
	assert.equal(u.searchParams.get("service"), "https://pine.example.workers.dev");
	assert.match(u.searchParams.get("id")!, /^[A-Za-z0-9_-]{43}$/);
	assert.equal(u.searchParams.get("id"), ID);
	assert.match(u.searchParams.get("code")!, /^[A-Za-z0-9_-]{22}$/);
	assert.equal(u.searchParams.get("code"), CODE);
	// The page's own parser, which the apps' parsers replay (mobile/cases/pair-links.json), reads the
	// same three: the web client and the apps cannot drift on this string.
	assert.deepEqual(readPairLink(address), { service: "https://pine.example.workers.dev", id: ID, code: CODE });
	// A deployment of the owner's own, on a port of its own.
	const own = appAddress("https://pine.mine.example:8443/", LINK);
	assert.equal(new URL(own).searchParams.get("service"), "https://pine.mine.example:8443");
	assert.deepEqual(readPairLink(own), { service: "https://pine.mine.example:8443", id: ID, code: CODE });
});

test("on an iPhone the code is not used before the owner chose: no session to the computer, its pairing still open", async () => {
	const machine = computer();
	const c = client(machine, IPHONE, () => new Promise<void>(() => {}));
	await c.page.state();
	c.page.ready();
	await settle();
	assert.deepEqual(machine.connects, []);
	assert.equal(machine.pairCode, CODE, "the computer's pairing is untouched");
	c.stop();
});

test("Open in the Pine app navigates to the app's address and uses no code; the choice stays for an owner without the app", async () => {
	const machine = computer();
	const choice = view();
	const went: string[] = [];
	const c = client(machine, IPHONE, (link) => chooseApp(link, SERVICE, choice.v, (url) => void went.push(url)));
	await c.page.state();
	c.page.ready();
	await until(() => choice.said.length > 0);
	assert.deepEqual(choice.said, ["shown"]);
	choice.app();
	await until(() => went.length > 0 && choice.said.length > 1);
	assert.deepEqual(went, [appAddress(SERVICE, LINK)]);
	assert.deepEqual(choice.said, ["shown", "tried"]);
	assert.deepEqual(machine.connects, []);
	assert.equal(machine.pairCode, CODE);
	c.stop();
});

test("Continue in this browser pairs exactly as on another device", async () => {
	const machine = computer();
	const choice = view();
	const went: string[] = [];
	const c = client(machine, IPHONE, (link) => chooseApp(link, SERVICE, choice.v, (url) => void went.push(url)));
	await c.page.state();
	c.page.ready();
	await until(() => choice.said.length > 0);
	choice.browser();
	const asked = await becomes(c, (s) => s.status === "starting" && s.pairing?.code !== undefined);
	const asking = asked as { status: string; pairing: { code: string; name: string } };
	assert.deepEqual([asking.status, asking.pairing.code], ["starting", DIGITS]);
	assert.ok(asking.pairing.name.includes("Safari") && asking.pairing.name.includes("iPhone"), `this browser, named for the computer: ${asking.pairing.name}`);
	assert.deepEqual(choice.said, ["shown", "closed"]);
	assert.deepEqual(machine.connects, [{ url: `peer:${ID}`, user: `pair.${CODE}`, hostFingerprint: pairedFingerprint(ID) }]);
	machine.answer("allow");
	await becomes(c, (s) => s.status === "ready");
	assert.deepEqual(went, []);
	c.stop();
});

test("on another device a pairing link pairs at once, with no choice", async () => {
	const machine = computer();
	const c = client(machine, ANDROID);
	await c.page.state();
	c.page.ready();
	await becomes(c, (s) => s.status === "starting" && s.pairing?.code === DIGITS);
	assert.deepEqual(machine.connects, [{ url: `peer:${ID}`, user: `pair.${CODE}`, hostFingerprint: pairedFingerprint(ID) }]);
	c.stop();
});
