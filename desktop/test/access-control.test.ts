// Browser access as the app's main process holds it (electron/access/control.ts), without a
// window: its preferences, the file of the host key and the paired devices, the calls the page
// makes, and the stand-in for the access host that the app's tests use instead of the network.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { type AccessControl, type AccessPrefs, type AccessState, type Announcement, createAccessControl, type Host, readAccessPrefs, relayAddress } from "../electron/access/control.ts";
import { OFFICIAL_SERVICE } from "../src/machines.ts";
import type { AccessHostOptions, Cipher } from "../electron/access/host.ts";
import { type RelayServer, type RelayTry, tryRelay } from "../electron/access/peer.ts";
import { silentUdpPort, startTurn, TURN_PASSWORD, TURN_USER } from "./support/turn.ts";
import { startStandIn } from "../electron/access/stand-in.ts";
import type { Device } from "../electron/access/store.ts";

const folders: string[] = [];
const controls: AccessControl[] = [];
after(async () => {
	await Promise.all(controls.map((c) => c.stop()));
	for (const f of folders) rmSync(f, { recursive: true, force: true });
});

/** A cipher that marks what it sealed, so that a test can tell a sealed file from a plain one. */
const cipher: Cipher = {
	seal: (text) => Buffer.concat([Buffer.from("sealed:"), Buffer.from(text).map((b) => b ^ 0x5a)]),
	open: (bytes) => {
		if (!bytes.subarray(0, 7).equals(Buffer.from("sealed:"))) throw new Error("not sealed");
		return Buffer.from(bytes.subarray(7).map((b) => b ^ 0x5a)).toString("utf8");
	},
};

const SERVICE = "https://pine.example.workers.dev";
const daemonLine = JSON.stringify({ base: "http://127.0.0.1:9", token: "t", mode: "attached", started: false, home: "/h" });

/** `waitMs`: how long the stand-in phone waits before it uses a pairing link (its own default otherwise). */
/** `tryRelay`: a stand-in for the try of a relay; the real one otherwise, with a short wait for a relay that does not answer. */
function make(more: { prefs?: Partial<AccessPrefs>; cipher?: Cipher | undefined; folder?: string; official?: string; waitMs?: number; nonceMs?: number; tryRelay?: (relay: RelayServer) => Promise<RelayTry> } = {}) {
	const folder = more.folder ?? mkdtempSync(path.join(tmpdir(), "pine-access-control-"));
	folders.push(folder);
	let prefs: AccessPrefs = { enabled: false, openAtLogin: false, ...more.prefs };
	const hosts: Host[] = [];
	const calls = { starts: 0, daemon: 0, login: [] as boolean[], paired: [] as Device[], changes: [] as AccessState[], hostOptions: [] as AccessHostOptions[], announced: [] as Array<Announcement | undefined>, asked: [] as Array<{ id: string; name: string; code: string }> };
	const control = createAccessControl({
		folder,
		cipher: () => ("cipher" in more ? more.cipher : cipher),
		prefs: { read: () => prefs, write: (p) => void (prefs = p) },
		official: more.official ?? SERVICE,
		daemon: async () => (calls.daemon++, daemonLine),
		loginItem: (open) => void calls.login.push(open),
		paired: (device) => void calls.paired.push(device),
		changed: (state) => void calls.changes.push(state),
		computerName: () => "Studio Mac",
		start: async (options) => {
			calls.starts++;
			calls.hostOptions.push(options);
			const host = await startStandIn({ ...options, waitMs: more.waitMs });
			hosts.push(host);
			return host;
		},
		tryRelay: more.tryRelay ?? ((relay) => tryRelay(relay, 800)),
		announce: (what) => void calls.announced.push(what),
		nonceMs: more.nonceMs,
		asked: (request) => void calls.asked.push(request),
	});
	controls.push(control);
	return { control, folder, calls, hosts, prefs: () => prefs };
}

const until = async (what: string, ok: () => boolean | Promise<boolean>, ms = 5000) => {
	const end = Date.now() + ms;
	while (!(await ok())) {
		if (Date.now() > end) throw new Error(`timed out: ${what}`);
		await new Promise((r) => setTimeout(r, 20));
	}
};

test("access control: off by default, an app that starts makes no host key, starts no host and contacts no service", async () => {
	const { control, folder, calls } = make();
	await control.start();
	const state = await control.state();
	assert.equal(state.enabled, false);
	assert.equal(state.status, "off");
	assert.deepEqual(state.devices, []);
	assert.equal(calls.starts, 0, "no access host was started");
	assert.deepEqual(readdirSync(folder), [], "no file was written");
});

test("access control: preferences are read off by default, with the official address, and an address that is not http(s) is not kept", () => {
	assert.deepEqual(readAccessPrefs(undefined), { enabled: false, service: undefined, openAtLogin: false });
	assert.deepEqual(readAccessPrefs({ enabled: true, service: "https://mine.example/some/path", openAtLogin: true }), { enabled: true, service: "https://mine.example", openAtLogin: true });
	for (const service of ["file:///etc/passwd", "javascript:alert(1)", "https://user:pw@mine.example", "not an address", 42]) assert.equal(readAccessPrefs({ service }).service, undefined, String(service));
	assert.equal(readAccessPrefs({ enabled: "yes" }).enabled, false);
	assert.equal(OFFICIAL_SERVICE, "https://pine-main.drcmda.workers.dev", "the project's own service");
	assert.equal(readAccessPrefs({ service: OFFICIAL_SERVICE }).service, OFFICIAL_SERVICE, "an address the settings accept");
});

test("access control: turned on, the host key is kept encrypted in a file of the app's data folder, and the host waits", async () => {
	const { control, folder, calls, prefs } = make();
	const state = await control.set({ enabled: true });
	assert.equal(state.enabled, true);
	assert.equal(prefs().enabled, true);
	assert.equal(calls.starts, 1);
	await until("the host waits", async () => (await control.state()).status === "waiting");
	assert.deepEqual(readdirSync(folder), ["access.bin"]);
	const bytes = readFileSync(path.join(folder, "access.bin"));
	assert.ok(bytes.subarray(0, 7).equals(Buffer.from("sealed:")), "the file is the cipher's");
	assert.ok(!bytes.includes("OPENSSH PRIVATE KEY"), "the host key is not in the clear");
	assert.ok(!(await control.state()).problem);
});

test("access control: where the keychain cannot be used, browser access cannot be turned on and says why", async () => {
	const { control, folder, calls } = make({ cipher: undefined });
	const state = await control.state();
	assert.equal(state.problem?.kind, "keychain");
	await assert.rejects(control.set({ enabled: true }), /keychain/);
	assert.equal(calls.starts, 0);
	assert.equal((await control.state()).enabled, false);
	assert.deepEqual(readdirSync(folder), []);
});

test("access control: with no official address (a build that names none) it says one is needed, and an address the owner gives is used", async () => {
	const { control, calls, prefs } = make({ official: "" });
	const state = await control.state();
	assert.equal(state.service, "");
	assert.equal(state.problem?.kind, "address");
	await assert.rejects(control.set({ enabled: true }), /address/);
	assert.equal(calls.starts, 0);
	await assert.rejects(control.set({ service: "ftp://mine.example" }), /https:\/\//);
	const set = await control.set({ service: "https://mine.example/", enabled: true });
	assert.equal(set.service, "https://mine.example");
	assert.equal(prefs().service, "https://mine.example");
	assert.equal(set.problem, undefined);
	assert.equal(calls.starts, 1);
	// Back to the official one: none here, so the host stops and the address is asked for again.
	const back = await control.set({ service: "" });
	assert.equal(back.status, "off");
	assert.equal(back.problem?.kind, "address");
});

test("access control: open at login sets and clears the app's login item", async () => {
	const { control, calls, prefs } = make();
	assert.equal((await control.set({ openAtLogin: true })).openAtLogin, true);
	assert.equal(prefs().openAtLogin, true);
	assert.equal((await control.set({ openAtLogin: false })).openAtLogin, false);
	assert.deepEqual(calls.login, [true, false]);
	await control.set({ enabled: true });
	assert.deepEqual(calls.login, [true, false], "turning browser access on does not touch it by itself");
});

test("access control: a pairing is opened, the owner is asked with the device's name and digits, and a yes adds the device with one notification", async () => {
	const { control, calls } = make();
	await control.set({ enabled: true });
	const opened = await control.openPairing();
	assert.match(opened.link, new RegExp(`^${SERVICE}/#pair=[A-Za-z0-9_-]{43}\\.[A-Za-z0-9_-]{22}$`));
	const before = await control.state();
	assert.equal(before.pairing?.link, opened.link);
	assert.equal(before.pairing?.expires, opened.expires);
	assert.ok(Date.parse(opened.expires) > Date.now());
	await until("the owner is asked", async () => (await control.state()).request !== undefined);
	const { request } = await control.state();
	assert.equal(request?.name, "Stand-in phone");
	assert.match(request!.code, /^\d{4}$/);
	await until("the page was told", () => calls.changes.some((s) => s.request?.code === request!.code));
	await assert.rejects(control.answer(true, "another-question"), /no longer the one asking/, "an answer to another question allows nothing");
	await assert.rejects(control.answer(true), /no longer the one asking/, "nor one that names none");
	await control.answer(true, request!.id);
	await until("the device is connected", async () => (await control.state()).devices[0]?.connected !== undefined);
	const after = await control.state();
	assert.equal(after.request, undefined);
	assert.equal(after.pairing, undefined, "the code was used");
	assert.equal(after.devices.length, 1);
	assert.equal(after.devices[0].name, "Stand-in phone");
	assert.deepEqual(after.devices[0].connected, { path: "lan" });
	assert.equal(calls.paired.length, 1);
	assert.equal(calls.paired[0].name, "Stand-in phone");
	await until("the paired phone was given this computer's daemon", () => calls.daemon >= 1);
	await assert.rejects(control.answer(true), /No device is waiting/);
});

test("access control: a no, or a pairing cancelled, adds nothing and notifies nobody", async () => {
	// The phone uses a link after 50 ms, so that 250 ms is well past its try at the cancelled one.
	const { control, calls } = make({ waitMs: 50 });
	await control.set({ enabled: true });
	await control.openPairing();
	await until("the owner is asked", async () => (await control.state()).request !== undefined);
	await control.answer(false, (await control.state()).request!.id);
	await new Promise((r) => setTimeout(r, 200));
	assert.deepEqual((await control.state()).devices, []);
	await control.openPairing();
	await control.cancelPairing();
	assert.equal((await control.state()).pairing, undefined);
	await new Promise((r) => setTimeout(r, 250));
	const state = await control.state();
	assert.equal(state.request, undefined, "a cancelled pairing's link no longer works");
	assert.deepEqual(state.devices, []);
	assert.deepEqual(calls.paired, []);
});

async function paired() {
	const made = make({ tryRelay: stubTry().tryRelay });
	await made.control.set({ enabled: true });
	await made.control.openPairing();
	await until("the owner is asked", async () => (await made.control.state()).request !== undefined);
	await made.control.answer(true, (await made.control.state()).request!.id);
	await until("the device is connected", async () => (await made.control.state()).devices[0]?.connected !== undefined);
	return made;
}

test("access control: removing a device forgets it and cuts its live connection", async () => {
	const { control, hosts } = await paired();
	const [device] = (await control.state()).devices;
	assert.deepEqual(hosts[0].connected(), [{ id: device.id, path: "lan" }]);
	assert.equal(await control.remove(device.id), true);
	const state = await control.state();
	assert.deepEqual(state.devices, []);
	await until("its connection was cut", () => hosts[0].connected().length === 0 && hosts[0].peers() === 0);
	assert.equal(await control.remove(device.id), false);
});

test("access control: switched off, the devices are kept and shown, and are there again when switched on; no notification for a device seen again", async () => {
	const { control, folder, calls } = await paired();
	const off = await control.set({ enabled: false });
	assert.equal(off.status, "off");
	assert.equal(off.devices.length, 1);
	assert.equal(off.devices[0].connected, undefined, "its connection ended with the host");
	const on = await control.set({ enabled: true });
	assert.equal(on.devices.length, 1);
	assert.equal(calls.paired.length, 1);
	// Another control on the same folder (the app started again) reads the same file, and removes from it while off.
	await control.stop();
	const again = make({ folder, prefs: { enabled: false } });
	const [device] = (await again.control.state()).devices;
	assert.equal(device.name, "Stand-in phone");
	assert.equal(await again.control.remove(device.id), true);
	assert.deepEqual((await again.control.state()).devices, []);
});

test("access control: left on, the host starts with the app, and stops with it", async () => {
	const { control, calls } = make({ prefs: { enabled: true } });
	await control.start();
	assert.equal(calls.starts, 1);
	await until("the host waits", async () => (await control.state()).status === "waiting");
	await control.stop();
	assert.equal((await control.state()).status, "off");
});

// ---- the owner's relay (TURN) server ----------------------------------------------------------

/** What the sealed file holds, opened with the test's cipher. */
const sealed = (folder: string) => cipher.open(readFileSync(path.join(folder, "access.bin")));

/** A try of a relay that answers at once, and notes what it was handed: no try outlives its test. */
const stubTry = () => {
	const tried: RelayServer[] = [];
	return { tried, tryRelay: async (relay: RelayServer): Promise<RelayTry> => (tried.push(relay), "usable") };
};

test("access control: a relay's address is turn:, a host and a port, over UDP; nothing else is taken", () => {
	assert.deepEqual(relayAddress(" turn:relay.example.com:3478 "), { address: "turn:relay.example.com:3478", hostname: "relay.example.com", port: 3478 });
	assert.deepEqual(relayAddress("turn:relay.example.com:3478?transport=udp"), { address: "turn:relay.example.com:3478?transport=udp", hostname: "relay.example.com", port: 3478 });
	assert.deepEqual(relayAddress("turn:[2001:db8::1]:3478"), { address: "turn:[2001:db8::1]:3478", hostname: "2001:db8::1", port: 3478 });
	assert.equal(relayAddress("turn:203.0.113.5").address, "turn:203.0.113.5:3478");
	// The library pine connects with reaches a relay over UDP only: TCP and TLS are refused with what to write instead.
	for (const tcp of ["turns:relay.example.com", "turns:relay.example.com:443?transport=tcp", "turns:relay.example.com:5349?transport=udp", "turn:relay.example.com:443?transport=tcp"]) {
		assert.throws(() => relayAddress(tcp), /only use turn: over UDP.*turn:relay\.example\.com:3478/, tcp);
	}
	for (const bad of ["stun:relay.example.com:3478", "https://relay.example.com", "turn:user:pw@relay.example.com:3478", "turn:relay.example.com:99999", "turn:relay.example.com:3478?transport=sctp", "turn:", "turn:[nothing]:3478", "turn:relay.example.com:3478 extra"]) {
		assert.throws(() => relayAddress(bad), /turn:host:port/, bad);
	}
	assert.deepEqual(readAccessPrefs({ relay: { address: "turn:relay.example.com:3478", username: "me", password: "never read" } }).relay, { address: "turn:relay.example.com:3478", username: "me" });
	assert.equal(readAccessPrefs({ relay: { address: "file:///etc/passwd", username: "me" } }).relay, undefined);
});

test("access control: a relay is kept with its address and user name in the preferences and its password in the sealed file only; the page is told a password is set, never the password", async () => {
	const turn = await startTurn();
	try {
		const { control, folder, prefs, calls } = make({ prefs: { enabled: true } });
		await control.start();
		const state = await control.set({ relay: { address: `turn:127.0.0.1:${turn.port}`, username: TURN_USER, password: TURN_PASSWORD } });
		assert.deepEqual(prefs().relay, { address: `turn:127.0.0.1:${turn.port}`, username: TURN_USER });
		assert.ok(!JSON.stringify(prefs()).includes(TURN_PASSWORD), "the password is not in the preferences");
		assert.equal(JSON.parse(sealed(folder)).relayPassword, TURN_PASSWORD, "the password is in the sealed file");
		assert.ok(!readFileSync(path.join(folder, "access.bin")).includes(TURN_PASSWORD), "and not in the clear");
		assert.deepEqual(state.relay && { address: state.relay.address, username: state.relay.username, password: state.relay.password }, { address: `turn:127.0.0.1:${turn.port}`, username: TURN_USER, password: true });
		assert.equal(state.relay?.check?.result, "trying");
		// The host was started again with the relay, and its password from its own store, not from the options.
		assert.equal(calls.starts, 2);
		assert.deepEqual(calls.hostOptions[1].relay, { hostname: "127.0.0.1", port: turn.port, username: TURN_USER });
		assert.ok(!JSON.stringify(calls.hostOptions[1].relay).includes(TURN_PASSWORD));
		await until("the try is done", async () => (await control.state()).relay?.check?.result !== "trying");
		const tried = await control.state();
		assert.deepEqual(tried.relay?.check, { result: "usable", message: `This relay works. It gave this ${process.platform === "darwin" ? "Mac" : "computer"} an address.` });
		for (const told of [...calls.changes, tried, state]) assert.ok(!JSON.stringify(told).includes(TURN_PASSWORD), "no state the page reads has the password");
		// Saved again with an empty password: the kept one stays.
		await control.set({ relay: { address: `turn:127.0.0.1:${turn.port}`, username: TURN_USER, password: "" } });
		assert.equal(JSON.parse(sealed(folder)).relayPassword, TURN_PASSWORD);
		assert.equal((await control.state()).relay?.password, true);
		await until("the second try is done", async () => (await control.state()).relay?.check?.result !== "trying");
	} finally {
		await turn.close();
	}
});

test("access control: saving the relay's fields empty removes the relay and its password", async () => {
	const { control, folder, prefs } = make({ tryRelay: stubTry().tryRelay });
	await control.set({ relay: { address: "turn:127.0.0.1:9", username: "me", password: "secret-of-the-relay" } });
	assert.equal(JSON.parse(sealed(folder)).relayPassword, "secret-of-the-relay");
	const state = await control.set({ relay: { address: "", username: "", password: "" } });
	assert.equal(prefs().relay, undefined);
	assert.equal(state.relay, undefined);
	assert.equal(JSON.parse(sealed(folder)).relayPassword, undefined, "the password is gone from the file");
	assert.ok(JSON.parse(sealed(folder)).hostKey, "the host key is kept");
});

test("access control: the try says why a relay cannot be used, and the relay is kept all the same", async () => {
	const turn = await startTurn();
	const silent = await silentUdpPort();
	try {
		const { control, prefs } = make();
		const result = async (address: string, password: string) => {
			await control.set({ relay: { address, username: TURN_USER, password } });
			await until("the try is done", async () => (await control.state()).relay?.check?.result !== "trying");
			return (await control.state()).relay!.check!;
		};
		assert.deepEqual(await result(`turn:127.0.0.1:${turn.port}`, "not-the-password"), { result: "failed", message: "Could not use this relay because it refused the user name or password. The relay is saved. Check both and save again." });
		assert.equal(prefs().relay?.address, `turn:127.0.0.1:${turn.port}`, "kept");
		assert.match((await result(`turn:127.0.0.1:${silent.port}`, TURN_PASSWORD)).message, /^Could not use this relay because it did not answer\. The relay is saved/);
		assert.equal(prefs().relay?.address, `turn:127.0.0.1:${silent.port}`, "kept");
		assert.match((await result("turn:relay.example.invalid:3478", TURN_PASSWORD)).message, /no server was found under that name/);
	} finally {
		await silent.close();
		await turn.close();
	}
});

test("access control: a relay whose address or user name changed, saved without a password, is not given the password of the one before", async () => {
	const stub = stubTry();
	const { control, folder } = make({ tryRelay: stub.tryRelay });
	const password = async () => JSON.parse(sealed(folder)).relayPassword;
	await control.set({ relay: { address: "turn:relay-a.example:3478", username: "me", password: "password-of-a" } });
	// The same relay saved again without a password keeps its password.
	await control.set({ relay: { address: "turn:relay-a.example:3478", username: "me", password: "" } });
	assert.equal(await password(), "password-of-a");
	for (const relay of [{ address: "turn:relay-b.example:3478", username: "me" }, { address: "turn:relay-a.example:3479", username: "me" }, { address: "turn:relay-a.example:3478", username: "someone-else" }]) {
		await control.set({ relay: { address: "turn:relay-a.example:3478", username: "me", password: "password-of-a" } });
		const state = await control.set({ relay: { ...relay, password: "" } });
		assert.equal(await password(), undefined, `forgotten for ${JSON.stringify(relay)}`);
		assert.equal(state.relay?.password, false, "the page is told no password is kept");
		await until("the try is done", async () => (await control.state()).relay?.check?.result !== "trying");
		assert.equal(stub.tried.at(-1)?.password, "", "the try was not handed the password of the one before");
	}
});

test("access control: an address that is not a relay's is refused and nothing is written", async () => {
	const { control, folder, prefs, calls } = make({ prefs: { enabled: true } });
	await control.start();
	await assert.rejects(control.set({ relay: { address: "https://relay.example.com", username: "me", password: "pw" } }), /turn:host:port/);
	assert.equal(prefs().relay, undefined);
	assert.equal(JSON.parse(sealed(folder)).relayPassword, undefined);
	assert.equal(calls.starts, 1, "the host was not restarted");
});

test("access control: changing the relay starts the host again with it, and unpairs nobody; off and on again, the host has it still", async () => {
	const { control, calls } = await paired();
	const before = (await control.state()).devices;
	await control.set({ relay: { address: "turn:relay.example.invalid:3478", username: "me", password: "pw" } });
	assert.equal(calls.starts, 2);
	assert.equal(calls.hostOptions[1].relay?.port, 3478);
	assert.deepEqual((await control.state()).devices.map((d) => d.id), before.map((d) => d.id));
	await control.set({ enabled: false });
	await control.set({ enabled: true });
	assert.equal(calls.starts, 3);
	assert.equal(calls.hostOptions[2].relay?.hostname, "relay.example.invalid");
	assert.equal((await control.state()).devices.length, 1);
});

test("access control: where the keychain cannot be used, no relay is kept", async () => {
	const { control, prefs } = make({ cipher: undefined });
	await assert.rejects(control.set({ relay: { address: "turn:relay.example.com:3478", username: "me", password: "pw" } }), /keychain/);
	assert.equal(prefs().relay, undefined);
});

test("access control: visible on this network by default while browser access is on; the announcement carries the machine id and the service, and goes when visibility or access is turned off", async () => {
	const { control, calls, hosts, prefs } = make();
	await control.start();
	assert.equal(calls.announced.length, 0, "nothing is announced while browser access is off");
	await control.set({ enabled: true });
	await until("announced", () => calls.announced.at(-1) !== undefined);
	const id = hosts[0].store.machineId();
	const first = calls.announced.at(-1)!;
	assert.deepEqual({ id: first.id, service: first.service }, { id, service: SERVICE });
	assert.match(first.nonce, /^[A-Za-z0-9_-]{22}$/);
	assert.equal((await control.state()).visible, true);

	await control.set({ visible: false });
	await until("no longer announced", () => calls.announced.length === 2);
	assert.equal(calls.announced.at(-1), undefined);
	assert.equal(prefs().visible, false);
	assert.equal((await control.state()).visible, false);
	assert.equal(readAccessPrefs(prefs()).visible, false, "kept off");

	await control.set({ visible: true });
	await until("announced again", () => calls.announced.at(-1) !== undefined);
	assert.equal(prefs().visible, undefined, "on is the default, and is not written");
	await control.set({ enabled: false });
	await until("gone with browser access", () => calls.announced.at(-1) === undefined);
});

test("access control: the owner is told each question, so that the app can say it while it is in the background", async () => {
	const { control, calls } = make();
	await control.set({ enabled: true });
	await control.openPairing();
	await until("asked", () => calls.asked.length === 1);
	assert.match(calls.asked[0].code, /^\d{4}$/);
	await control.answer(false, calls.asked[0].id);
});

test("access control: the announcement's nonce changes every few minutes, each change announced anew", async () => {
	const { control, calls } = make({ nonceMs: 100 });
	await control.set({ enabled: true });
	await until("announced", () => calls.announced.at(-1) !== undefined);
	const first = calls.announced.at(-1)!.nonce;
	await until("announced with a new nonce", () => calls.announced.at(-1) !== undefined && calls.announced.at(-1)!.nonce !== first);
	await control.set({ enabled: false });
});
