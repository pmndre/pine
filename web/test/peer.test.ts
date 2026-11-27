// The peer transport (src/peer.ts) in a headless Chrome for Testing: the real web bridge pairs with
// and connects to the real access host of the Pine app (desktop/electron/access/host.ts) running
// under Node on this computer, through the Worker's meeting module on a loopback port and a WebRTC
// data channel, and calls a stand-in daemon. Both ends are on this computer: no STUN server is
// reached (the one the configuration names is a closed port of the loopback).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright-core";
import type { ServiceState } from "../../desktop/src/bridge.ts";
import { headless } from "./support/browser.ts";
import { startDaemon, type Daemon } from "./support/fake-ssh.ts";
import { serveMeeting, type MeetingServer } from "./support/meeting.ts";
import type { webBridge } from "../src/host.ts";

/** The parts of the desktop app's access modules the test drives. Loaded by address, so that the web client's type check does not compile the desktop's main process. */
type AccessHost = {
	machineId: string;
	status(): string;
	connected(): { id: string; path?: string }[];
	remove(id: string): Promise<boolean>;
	server: { cut(id: string): number };
	stop(): Promise<void>;
};
type HostModule = { startAccessHost(options: Record<string, unknown>): Promise<AccessHost> };
type PairingModule = { createPairing(options: Record<string, unknown>): { open(): { link: string }; admit: unknown } };
const desktop = (file: string) => new URL(`../../desktop/electron/access/${file}`, import.meta.url).href;
const { startAccessHost } = (await import(desktop("host.ts"))) as HostModule;
const { createPairing } = (await import(desktop("pairing.ts"))) as PairingModule;

declare const start: (link?: string) => { bridge: ReturnType<typeof webBridge>; states: ServiceState[] };
declare const made: { connections: number; ice: RTCIceServer[][]; labels: string[]; opened: number; largest: number };
declare const loopback: (size: number) => Promise<{ pieces: number; largest: number; buffered: number; got: number; ok: boolean }>;
declare const until: <T>(check: () => T | undefined | false, what: string, ms?: number) => Promise<T>;
declare const refusal: (id: string, openMs: number) => Promise<{ opened?: boolean; name?: string; reason?: string; ms?: number }>;
declare let paired: ReturnType<typeof start>;

/** The helping servers the service names: a STUN server on a closed port of the loopback, so that nothing leaves this computer. */
const ICE = [{ urls: "stun:127.0.0.1:9" }];

let daemon: Daemon;
let meeting: MeetingServer;
let browser: Awaited<ReturnType<typeof headless>>;
let page: Page;
const folders: string[] = [];
const hosts: AccessHost[] = [];

/** An access host that waits at the meeting; with pairing, an owner who allows every request, and what admission saw. */
async function computer() {
	const folder = mkdtempSync(join(tmpdir(), "pine-web-peer-"));
	folders.push(folder);
	const admitted: string[] = [];
	const connected: string[] = [];
	let pairing: ReturnType<PairingModule["createPairing"]> | undefined;
	const host = await startAccessHost({
		service: meeting.url,
		folder,
		daemon: async () => JSON.stringify({ base: `http://127.0.0.1:${daemon.port}`, token: daemon.token, mode: "safe", started: true, home: "/nowhere", version: "0.0.0" }),
		admit: (context: Record<string, unknown>) => {
			pairing = createPairing({ ...context, ask: async () => true, computerName: () => "Test Mac" });
			const admit = pairing.admit as (user: string, key: unknown) => unknown;
			return (user: string, key: unknown) => (admitted.push(user), admit(user, key));
		},
		report: (event: { kind: string; id: string }) => event.kind === "connected" && connected.push(event.id),
		retry: { firstMs: 50, maxMs: 400 },
	});
	hosts.push(host);
	const end = Date.now() + 10_000;
	while (host.status() !== "waiting") {
		if (Date.now() > end) throw new Error(`the access host never waited (${host.status()})`);
		await new Promise((r) => setTimeout(r, 20));
	}
	return { host, admitted, connected, link: () => pairing!.open().link };
}

before(async () => {
	daemon = await startDaemon();
	meeting = await serveMeeting(fileURLToPath(new URL("./support/peer-page.ts", import.meta.url)), { ice: ICE, relay: true });
	browser = await headless();
	page = browser.page;
	await page.goto(`${meeting.url}/`);
});

after(async () => {
	await page?.evaluate(() => typeof paired !== "undefined" && paired.bridge.stop()).catch(() => {});
	await browser?.stop();
	await Promise.all(hosts.map((h) => h.stop()));
	await meeting?.close();
	await daemon?.stop();
	for (const f of folders) rmSync(f, { recursive: true, force: true });
});

let first: Awaited<ReturnType<typeof computer>>;

test("pairing by link, then a paired connection over a data channel labelled ssh, made through the join route with the configuration's servers", async () => {
	first = await computer();
	const link = first.link();
	const result = await page.evaluate(async (link) => {
		Object.assign(globalThis, { paired: start(link) });
		await paired.bridge.ready();
		const ready = await until(() => paired.states.find((s) => s.status === "ready"), "connected after pairing");
		const answer = await paired.bridge.call("POST", "/agents/main/message", { text: "hello over the data channel" });
		const app = await paired.bridge.state();
		return { ready, answer, codes: paired.states.map((s) => (s as { pairing?: { code?: string } }).pairing?.code).filter(Boolean), hosts: app.prefs.hosts, names: app.prefs.names, made };
	}, link);
	assert.equal(result.ready.status === "ready" && result.ready.label, "Test Mac");
	assert.deepEqual(result.answer.data, { echoed: { text: "hello over the data channel" } });
	assert.match(String(result.codes[0]), /^\d{4}$/);
	assert.deepEqual(result.hosts, [`paired:${first.host.machineId}`]);
	assert.deepEqual(result.names, { [`paired:${first.host.machineId}`]: "Test Mac" });
	// One meeting for pairing, one for the paired session: both by the join route, under the link's id.
	assert.deepEqual(
		meeting.sockets().filter((s) => s.kind === "join"),
		[{ kind: "join", id: first.host.machineId }, { kind: "join", id: first.host.machineId }],
	);
	assert.equal(result.made.connections, 2);
	assert.deepEqual(result.made.labels, ["ssh", "ssh"]);
	assert.deepEqual(result.made.ice, [ICE, ICE]);
	assert.deepEqual(first.admitted.slice(0, 1).map((u) => u.split(".")[0]), ["pair"]);
	assert.equal(first.admitted.at(-1), "pine");
	assert.equal(first.host.connected().length, 1);
});

test("an answer of several megabytes, and a request as large, cross the data channel whole", async () => {
	const size = 3 * 1024 * 1024;
	const result = await page.evaluate(async (size) => {
		const text = "0123456789abcdef".repeat(size / 16);
		const answer = await paired.bridge.call("POST", "/agents/main/message", { text });
		return { ok: answer.ok, same: answer.data?.echoed?.text === text, length: answer.data?.echoed?.text?.length, largest: made.largest };
	}, size);
	assert.deepEqual({ ...result, largest: undefined }, { ok: true, same: true, length: size, largest: undefined });
	assert.equal(result.largest, 16 * 1024, "SSH's writes were cut into pieces of 16 KiB");
	assert.ok(daemon.seen.some((s) => s.body.length > size), "the daemon got the whole request");
});

test("one write of several megabytes goes out in pieces of 16 KiB, and waits while the channel holds a megabyte", async () => {
	const size = 8 * 1024 * 1024;
	const seen = await page.evaluate((size) => loopback(size), size);
	assert.deepEqual(seen, { pieces: size / (16 * 1024), largest: 16 * 1024, buffered: seen.buffered, got: size, ok: true });
	assert.ok(seen.buffered <= 1024 * 1024, `at most a megabyte waited before a piece was sent (${seen.buffered})`);
	assert.ok(seen.buffered > 512 * 1024, `the channel did fill up, so the wait was tried (${seen.buffered})`);
});

test("a data channel that drops is made again by itself: a new meeting, a new channel, a new SSH session", async () => {
	const joins = meeting.sockets().filter((s) => s.kind === "join").length;
	const sessions = first.connected.length;
	const [device] = first.host.connected();
	assert.ok(device, "a device is connected");
	const before = await page.evaluate(() => ({ connections: made.connections, opened: made.opened }));
	first.host.server.cut(device.id);
	const after = await page.evaluate(async (before) => {
		await until(() => made.opened > before.opened, "a new transport opened");
		for (const end = Date.now() + 15_000; ; await new Promise((r) => setTimeout(r, 50))) {
			const answer = await paired.bridge.call("POST", "/agents/main/message", { text: "again" });
			if (answer.ok) return { connections: made.connections, answer: answer.data };
			if (Date.now() > end) throw new Error(`no answer again: ${JSON.stringify(answer.data)}`);
		}
	}, before);
	assert.ok(after.connections > before.connections, "a new peer connection was made");
	assert.deepEqual(after.answer, { echoed: { text: "again" } });
	assert.ok(meeting.sockets().filter((s) => s.kind === "join").length > joins, "a new meeting was joined");
	assert.ok(first.connected.length > sessions, "a new SSH session was authenticated at the computer");
});

test("a computer whose host key is not the link's id is refused before the browser's key is offered", async () => {
	const named = await computer();
	const other = await computer();
	// The service sends a browser that asks for the named computer to the other one.
	meeting.swap(named.host.machineId, other.host.machineId);
	const state = await page.evaluate(async (link) => {
		const lied = start(link);
		await lied.bridge.ready();
		const end = await until(() => lied.states.find((s) => s.status === "error"), "the pairing ends");
		lied.bridge.stop();
		return end;
	}, named.link());
	assert.match(state.status === "error" ? state.message : "", /pairing link/, "it is the link that is said not to fit, not the network");
	assert.deepEqual(other.admitted, [], "the other computer was never offered a key");
	assert.deepEqual(named.admitted, []);
});

test("the ways a paired computer cannot be reached are told apart: nobody waits, no connection in time, the service over its limits", async () => {
	const nobody = "n".repeat(43);
	const silent = "s".repeat(43);
	const busy = "b".repeat(43);
	meeting.hold(silent);
	meeting.refuse(busy, 4429);
	const seen = await page.evaluate(async ({ nobody, silent, busy }) => ({ nobody: await refusal(nobody, 3000), silent: await refusal(silent, 300), busy: await refusal(busy, 3000) }), { nobody, silent, busy });
	assert.deepEqual({ name: seen.nobody.name, reason: seen.nobody.reason }, { name: "PeerClosed", reason: "absent" });
	assert.deepEqual({ name: seen.silent.name, reason: seen.silent.reason }, { name: "PeerClosed", reason: "no-path" });
	assert.ok(seen.silent.ms! >= 300 && seen.silent.ms! < 3000, `given up after the time limit (${seen.silent.ms} ms)`);
	assert.deepEqual({ name: seen.busy.name, reason: seen.busy.reason }, { name: "PeerClosed", reason: "limits" });
	// Through the bridge, in the owner's words: a pairing link for a computer that is not there, whose name is not known yet.
	const said = await page.evaluate(async (link) => {
		const lone = start(link);
		await lone.bridge.ready();
		const end = await until(() => lone.states.find((s) => s.status === "error"), "the pairing ends");
		lone.bridge.stop();
		return end.status === "error" ? end.message : "";
	}, `${meeting.url}/#pair=${nobody}.AAECAwQFBgcICQoLDA0ODw`);
	assert.ok(said.length > 0 && !said.includes(nobody), `said in words, without the computer's id: ${said}`);
});

test("a browser whose key the paired computer no longer knows is told so, and stops trying", async () => {
	const [device] = first.host.connected();
	assert.ok(device, "the paired browser is connected");
	await first.host.remove(device.id);
	const said = await page.evaluate(async () => {
		const end = await until(() => paired.states.find((s) => s.status === "error" && /no longer known/.test(s.message)), "told the key is not known");
		const opened = made.opened;
		await new Promise((r) => setTimeout(r, 300));
		return { message: end.status === "error" ? end.message : "", again: made.opened - opened };
	});
	assert.equal(said.again, 0, "no way to the computer was opened again");
	assert.ok(said.message.includes("Test Mac"), `said of the computer by its name: ${said.message}`);
});
