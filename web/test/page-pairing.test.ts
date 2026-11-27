// The page's store (desktop/src/model.ts) under a bridge that pairs from a link in the owner's hand
// (the mobile app's): a link, pasted or handed in by the app, starts nothing before the owner's yes
// in the page. The store runs in Node on a stand-in bridge that records what it is asked; the stock
// toast it says things with is replaced by a recorder, since it is drawn by React.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import type { ServiceState } from "../../desktop/src/bridge.ts";

const ID = "q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x-_";
const CODE = "Zx9Yw8Xv7Wu6Vt5Us4Tr3S";
const LINK = `https://pine-main.drcmda.workers.dev/#pair=${ID}.${CODE}`;
const PAIRED = `paired:${ID}`;

// What the page said in a toast, in order.
const flashes: string[] = [];
(globalThis as { __pineFlashes?: string[] }).__pineFlashes = flashes;
const TOAST = `data:text/javascript,${encodeURIComponent("export const toast = { add: (t) => globalThis.__pineFlashes.push(t.description) };")}`;
registerHooks({
	resolve(specifier, context, next) {
		if (specifier === "@/components/ui/toast") return { url: TOAST, shortCircuit: true };
		return next(specifier, context);
	},
});

// The stand-in bridge: what the store asks of it is recorded; the ones the tests look at are named.
const calls: Array<{ name: string; args: unknown[] }> = [];
const asked = (name: string) => calls.filter((c) => c.name === name);
let serviceListener: ((s: ServiceState) => void) | undefined;
let linkListener: ((link: string) => void) | undefined;
let hosts: string[] = [];
const named: Record<string, unknown> = {
	mediaBase: "pine-media://daemon",
	state: async () => ({ state: { status: "starting" }, connected: false, prefs: { keepRunning: false, notify: true, updates: true, hosts }, platform: "android", focused: true, updates: false, versions: { app: "test", electron: "none" }, local: false, canPair: true }),
	onService: (fn: (s: ServiceState) => void) => ((serviceListener = fn), () => {}),
	onPairLink: (fn: (link: string) => void) => ((linkListener = fn), () => {}),
	forgetHost: async (host: string) => {
		hosts = hosts.filter((h) => h !== host);
		return { keepRunning: false, notify: true, updates: true, hosts };
	},
};
const bridge = new Proxy(named, {
	get(target, name) {
		if (typeof name !== "string" || name === "then") return undefined;
		const own = target[name];
		if (typeof own !== "function") {
			if (own !== undefined) return own;
			// Every other listener: kept nowhere, and nothing is ever said on it.
			if (/^on[A-Z]/.test(name)) return () => () => {};
		}
		return (...args: unknown[]) => {
			calls.push({ name, args });
			return typeof own === "function" ? own(...args) : Promise.resolve(undefined);
		};
	},
});
const root = { style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {} }, dataset: {} as Record<string, string> };
const kept = new Map<string, string>();
const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, String(v)), removeItem: (k: string) => void kept.delete(k) };
Object.assign(globalThis, { window: { pine: bridge }, document: { documentElement: root } });
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

const { Store } = await import("../../desktop/src/model.ts");

async function started() {
	calls.length = 0;
	flashes.length = 0;
	const store = new Store();
	await store.boot();
	assert.equal(store.canPasteLink, true, "the store sees a bridge that pairs from the owner's hand");
	return store;
}

const settle = () => new Promise((r) => setTimeout(r, 10));
/** Waits for what is to come, as long as a busy computer needs; the assertion after it says what is missing. */
async function until(done: () => boolean, ms = 3000): Promise<void> {
	for (const end = Date.now() + ms; !done() && Date.now() < end; ) await settle();
}

test("a pasted pairing link is put to the owner and reaches the bridge's pair only on their yes", async () => {
	const store = await started();
	assert.equal(store.askToPair(`  ${LINK} `), undefined);
	await until(() => store.pairAsk !== undefined);
	assert.deepEqual(asked("pair"), [], "nothing was paired before the owner's yes");
	assert.equal(store.pairAsk?.id, ID);
	assert.equal(store.pairAsk?.code, CODE);
	await store.confirmPair();
	assert.deepEqual(asked("pair"), [{ name: "pair", args: [LINK] }]);
	assert.equal(store.pairAsk, undefined);
});

test("a link the app was opened with is asked about, and reaches pair only on the owner's yes", async () => {
	const store = await started();
	assert.ok(linkListener, "the store listens for links the app is opened with");
	linkListener(`pine://pair?service=${encodeURIComponent("https://pine-main.drcmda.workers.dev")}&id=${ID}&code=${CODE}`);
	await until(() => store.pairAsk !== undefined);
	assert.deepEqual(asked("pair"), [], "nothing was paired before the owner's yes");
	assert.equal(store.pairAsk?.service, "https://pine-main.drcmda.workers.dev");
	assert.deepEqual(flashes, []);
	await store.confirmPair();
	assert.equal(asked("pair").length, 1);
});

test("the owner's no drops the question and never calls pair", async () => {
	const store = await started();
	store.askToPair(LINK);
	store.dropPair();
	assert.equal(store.pairAsk, undefined);
	// A yes after the question is gone pairs with nothing.
	await store.confirmPair();
	await settle();
	assert.deepEqual(asked("pair"), []);
});

test("a link of an http meeting service is refused with the page's sentence and never reaches pair", async () => {
	const store = await started();
	const why = store.askToPair(`http://pine.example.test/#pair=${ID}.${CODE}`);
	assert.ok(why?.includes("pine.example.test"), "the service the link names");
	assert.match(why ?? "", /over http/);
	assert.equal(store.pairAsk, undefined);
	// Handed in by the app, the same sentence is said in a toast.
	linkListener!(`http://pine.example.test/#pair=${ID}.${CODE}`);
	await until(() => flashes.length > 0);
	assert.equal(flashes.length, 1);
	assert.match(flashes[0], /over http/);
	assert.equal(store.pairAsk, undefined);
	await store.confirmPair();
	assert.deepEqual(asked("pair"), []);
	// What is not a pairing link at all is refused too.
	assert.ok(store.askToPair("https://example.com/"), "refused with a reason");
	assert.equal(store.pairAsk, undefined);
});

test("Cancel during a pairing calls stopPairing, and how the pairing ends is no failure to say", async () => {
	const store = await started();
	serviceListener!({ status: "starting", pairing: { code: "4821", name: "Pine on Pixel 9" } });
	await until(() => store.canCancelPair === true);
	assert.equal(store.canCancelPair, true);
	await store.cancelPair();
	assert.equal(asked("stopPairing").length, 1);
	// The bridge then says the pairing ended without a machine, as it does for a refusal.
	serviceListener!({ status: "error", kind: "ssh", message: "The pairing was ended." });
	await settle();
	assert.equal(store.pairFailed, false, "a pairing the owner ended is not shown as failed");
	assert.deepEqual(flashes, []);
});

test("forgetting a paired computer asks first, and calls forgetHost only on the owner's Forget", async () => {
	hosts = [PAIRED, "me@box.example"];
	const store = await started();
	const first = store.forgetMachine(PAIRED);
	await until(() => store.picker !== undefined);
	assert.deepEqual(asked("forgetHost"), [], "nothing was forgotten before the owner's answer");
	// A paired computer is confirmed before it is forgotten: the dialog offers a destructive
	// forget and a way out. The wording is not asserted — only the choices the owner is given.
	assert.ok(store.picker, "a paired computer is confirmed before it is forgotten");
	assert.ok(store.picker!.items.some((i) => i.value === "forget" && i.tone === "bad"), "a destructive forget is offered");
	assert.ok(store.picker!.items.some((i) => i.value === "no"), "and a way to cancel");
	store.picker!.done("no");
	await first;
	assert.deepEqual(asked("forgetHost"), []);

	const second = store.forgetMachine(PAIRED);
	await until(() => store.picker !== undefined);
	store.picker!.done("forget");
	await second;
	assert.deepEqual(asked("forgetHost"), [{ name: "forgetHost", args: [PAIRED] }]);

	// A machine reached over SSH is forgotten without a question.
	await store.forgetMachine("me@box.example");
	assert.equal(store.picker, undefined);
	assert.deepEqual(asked("forgetHost").at(-1), { name: "forgetHost", args: ["me@box.example"] });
});
