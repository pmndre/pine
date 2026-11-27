// The mobile bridge on a fake of the native plugin: what the page asks for reaches the plugin as
// the contract says (src/plugin.ts), and what the plugin answers or tells reaches the page.
import assert from "node:assert/strict";
import test from "node:test";
import { mobileBridge } from "../src/mobile-bridge.ts";
import type { PinePlugin, StoredPrefs } from "../src/plugin.ts";

type Call = [method: string, options?: unknown];

/** A plugin that records each call and answers with what the test gave it. */
function fakePlugin(answers: Partial<Record<keyof PinePlugin, (options?: any) => unknown>> = {}, stored: StoredPrefs = { hosts: [] }) {
	const calls: Call[] = [];
	const listeners = new Map<string, Set<(data: any) => void>>();
	const plugin = new Proxy({} as PinePlugin, {
		get: (_t, name: string) => {
			if (name === "then") return undefined;
			if (name === "addListener")
				return async (event: string, fn: (data: any) => void) => {
					calls.push(["addListener", event]);
					const set = listeners.get(event) ?? new Set();
					listeners.set(event, set.add(fn));
					return { remove: async () => void set.delete(fn) };
				};
			return async (options?: unknown) => {
				calls.push(options === undefined ? [name] : [name, options]);
				if (answers[name as keyof PinePlugin]) return answers[name as keyof PinePlugin]!(options);
				if (name === "loadPrefs") return structuredClone(stored);
				if (name === "state") return { state: { status: "starting" }, connected: false, version: "0.0.0" };
				return undefined;
			};
		},
	});
	const emit = (event: string, data: unknown) => listeners.get(event)?.forEach((fn) => fn(data));
	return { plugin, calls, emit, listeners };
}

const ready = { status: "ready", mode: "attached", started: false, home: "box:~/.pine", version: "0.40.0", from: "ssh", host: "me@box", label: "box" } as const;

test("state: the plugin's connection and stored machines, with no local machine and the phone's platform", async () => {
	const { plugin } = fakePlugin({ state: () => ({ state: ready, connected: true, version: "1.2.3" }) }, { hosts: ["me@box"], use: "me@box", prefs: { notify: true } });
	const s = await mobileBridge(plugin, "android").state();
	assert.equal(s.local, false);
	assert.equal(s.platform, "android");
	assert.deepEqual(s.state, ready);
	assert.equal(s.connected, true);
	assert.equal(s.home, "box:~/.pine");
	assert.equal(s.updates, false);
	assert.deepEqual(s.versions, { app: "1.2.3", electron: "none" });
	assert.deepEqual(s.prefs, { keepRunning: false, hosts: ["me@box"], use: "me@box", notify: true, updates: false, questionCards: true });
});

test("mediaBase: the address on the app's origin that the plugin answers", () => {
	assert.equal(mobileBridge(fakePlugin().plugin, "android").mediaBase, "https://localhost/_pine_media");
});

test("state on iOS: the same, with the platform Capacitor says", async () => {
	const { plugin } = fakePlugin({ state: () => ({ state: ready, connected: true, version: "1.2.3" }) }, { hosts: ["me@box"], use: "me@box" });
	const s = await mobileBridge(plugin, "ios").state();
	assert.equal(s.platform, "ios");
	assert.equal(s.local, false);
	assert.deepEqual(s.state, ready);
	assert.deepEqual(s.prefs.hosts, ["me@box"]);
});

test("mediaBase on iOS: the scheme of its own the plugin answers, the desktop's default", () => {
	assert.equal(mobileBridge(fakePlugin().plugin, "ios").mediaBase, "pine-media://daemon");
});

test("call: forwarded as one object, and the plugin's answer handed back as it is", async () => {
	const answer = { ok: true, status: 200, data: { mime: "image/png", base64: "iVBO" } };
	const { plugin, calls } = fakePlugin({ call: () => answer });
	assert.deepEqual(await mobileBridge(plugin, "android").call("POST", "/agents/main/message", { text: "hi" }), answer);
	assert.deepEqual(calls, [["call", { method: "POST", url: "/agents/main/message", body: { text: "hi" } }]]);
});

test("ready and retry: forwarded", async () => {
	const { plugin, calls } = fakePlugin();
	const b = mobileBridge(plugin, "android");
	b.ready();
	await b.retry();
	assert.deepEqual(
		calls.filter(([m]) => m !== "state"),
		[["ready"], ["retry"]],
	);
});

test("retry: only connects again, even when a host key waits for the owner's yes", async () => {
	const fingerprint = `SHA256:${"a".repeat(43)}`;
	const waiting = { status: "error", kind: "ssh", message: `... ${fingerprint} ...`, host: "me@box", fingerprint, changed: false };
	const { plugin, calls } = fakePlugin({ state: () => ({ state: waiting, connected: false, version: "1" }) });
	await mobileBridge(plugin, "android").retry();
	assert.deepEqual(calls, [["retry"]]);
});

test("trustHostKey: exactly the host and fingerprint the page drew reach the plugin, nothing read from its state", async () => {
	const shown = `SHA256:${"b".repeat(43)}`;
	const other = { status: "error", kind: "ssh", message: "...", host: "me@box", fingerprint: `SHA256:${"c".repeat(43)}`, changed: false };
	const { plugin, calls } = fakePlugin({ state: () => ({ state: other, connected: false, version: "1" }) });
	await mobileBridge(plugin, "android").trustHostKey!("me@box", shown);
	assert.deepEqual(calls, [["trustHostKey", { host: "me@box", fingerprint: shown }]]);
});

test("forgetHost: the machine's stored host key goes with it", async () => {
	const { plugin, calls } = fakePlugin({ forgetHost: () => ({ hosts: [] }) });
	await mobileBridge(plugin, "android").forgetHost("me@box");
	assert.deepEqual(calls, [
		["forgetHost", { host: "me@box" }],
		["forgetHostKey", { host: "me@box" }],
	]);
});

test("deviceKey: the phone's public key, copied or handed to the share sheet by the plugin", async () => {
	const key = "ssh-ed25519 AAAAC3Nza pine-android";
	const { plugin, calls } = fakePlugin({ publicKey: () => ({ key }) });
	const k = await mobileBridge(plugin, "android").deviceKey!();
	assert.equal(k.key, key);
	await k.copy();
	await k.share();
	assert.deepEqual(calls, [["publicKey"], ["copy", { text: key }], ["share", { title: "This phone's SSH key", text: key }]]);
});

test("back: closes what the page has open with Escape, else leaves the app; the page never hears it", async () => {
	const pressed: string[] = [];
	let open = true;
	const doc = {
		querySelector: (q: string) => (open && q.includes('[role="dialog"]') ? {} : null),
		activeElement: { dispatchEvent: (e: { key: string }) => pressed.push(e.key) },
		body: null,
	};
	(globalThis as any).document = doc;
	(globalThis as any).KeyboardEvent ??= class {
		key: string;
		constructor(_type: string, init: { key: string }) {
			this.key = init.key;
		}
	};
	try {
		const { plugin, calls, emit } = fakePlugin();
		const b = mobileBridge(plugin, "android");
		const heard: unknown[] = [];
		b.onMenu((m: unknown) => heard.push(m));
		await new Promise((r) => setImmediate(r));
		emit("menu", { command: "back" });
		assert.deepEqual(pressed, ["Escape"]);
		open = false;
		emit("menu", { command: "back" });
		await new Promise((r) => setImmediate(r));
		assert.deepEqual(calls.filter(([m]) => m === "leave"), [["leave"]]);
		emit("menu", { command: "settings" });
		assert.deepEqual(heard, ["settings"]);
	} finally {
		delete (globalThis as any).document;
	}
});

test("machines: use, add and forget go to the plugin, and the prefs come back with its list", async () => {
	const { plugin, calls } = fakePlugin({ addHost: ({ host }) => ({ hosts: ["me@box", host] }), forgetHost: () => ({ hosts: ["pi"] }) }, { hosts: ["me@box"], prefs: { notify: true } });
	const b = mobileBridge(plugin, "android");
	await b.state();
	const added = await b.addHost("pi");
	assert.deepEqual(added.hosts, ["me@box", "pi"]);
	assert.equal(added.notify, true);
	await b.use("pi");
	const forgotten = await b.forgetHost("me@box");
	assert.deepEqual(forgotten, { keepRunning: false, hosts: ["pi"], use: "pi", notify: true, updates: false, questionCards: true });
	assert.deepEqual(
		calls.filter(([m]) => m !== "state" && m !== "loadPrefs" && m !== "systemBars"),
		[
			["addHost", { host: "pi" }],
			["use", { host: "pi" }],
			["forgetHost", { host: "me@box" }],
			["forgetHostKey", { host: "me@box" }],
		],
	);
});

test("use: the phone has no pine of its own, so a call without a machine is refused and reaches nothing", async () => {
	const { plugin, calls } = fakePlugin();
	await assert.rejects(mobileBridge(plugin, "android").use(undefined), /no pine of its own/);
	assert.deepEqual(calls, []);
});

test("a refusal of the plugin reaches the page with its words", async () => {
	const { plugin } = fakePlugin({
		addHost: () => {
			throw new Error("Not a host for ssh: -oProxyCommand=x.");
		},
	});
	await assert.rejects(mobileBridge(plugin, "android").addHost("-oProxyCommand=x"), /Not a host for ssh/);
});

test("open: http(s) addresses go to the phone's browser, nothing else reaches the plugin", async () => {
	const { plugin, calls } = fakePlugin();
	const b = mobileBridge(plugin, "android");
	await b.open("https://example.com/a");
	await b.open("HTTP://example.com/b");
	await b.open("file:///etc/passwd");
	await b.open("javascript:alert(1)");
	await b.open("intent://x#Intent;end");
	assert.deepEqual(calls, [
		["openExternal", { url: "https://example.com/a" }],
		["openExternal", { url: "HTTP://example.com/b" }],
	]);
});

test("listeners: what the plugin tells reaches each page listener in the desktop's shape, until it unsubscribes", async () => {
	const { plugin, emit } = fakePlugin();
	const b = mobileBridge(plugin, "android");
	const got: unknown[] = [];
	const offs = [
		b.onService((s: unknown) => got.push(["service", s])),
		b.onEvents((e: unknown) => got.push(["events", e])),
		b.onConnection((c: unknown) => got.push(["connection", c])),
		b.onFocus((f: unknown) => got.push(["focus", f])),
		b.onMenu((m: unknown) => got.push(["menu", m])),
	];
	const second: unknown[] = [];
	const offSecond = b.onEvents((e: unknown) => second.push(e));
	await new Promise((r) => setImmediate(r));
	const batch = [{ id: 1, topic: "agent/main/answer", data: {} }];
	emit("service", { state: ready });
	emit("events", { events: batch });
	emit("connection", { connected: false });
	emit("focus", { focused: true });
	emit("menu", { command: "close" });
	assert.deepEqual(got, [
		["service", ready],
		["events", batch],
		["connection", false],
		["focus", true],
		["menu", "close"],
	]);
	assert.deepEqual(second, [batch]);
	for (const off of offs) off();
	emit("service", { state: ready });
	emit("events", { events: batch });
	emit("connection", { connected: true });
	emit("focus", { focused: false });
	emit("menu", { command: "back" });
	assert.equal(got.length, 5);
	assert.deepEqual(second, [batch, batch], "another listener of the same kind still hears");
	offSecond();
});

test("listeners: the plugin is listened to once per kind, however many page listeners there are", async () => {
	const { plugin, calls } = fakePlugin();
	const b = mobileBridge(plugin, "android");
	b.onEvents(() => {})();
	b.onEvents(() => {});
	b.onEvents(() => {});
	await new Promise((r) => setImmediate(r));
	assert.equal(calls.filter(([m, e]) => m === "addListener" && e === "events").length, 1);
});

test("ready: a plugin that cannot start tells the page as a failed connection", async () => {
	const { plugin } = fakePlugin({
		ready: () => {
			throw new Error("The keystore is locked.");
		},
	});
	const b = mobileBridge(plugin, "android");
	const states: unknown[] = [];
	b.onService((s: unknown) => states.push(s));
	b.ready();
	await new Promise((r) => setImmediate(r));
	assert.deepEqual(states, [{ status: "error", kind: "failed", message: "The keystore is locked." }]);
});

test("what only the desktop app has refuses or does nothing, as the preview's stand-in, and never reaches the plugin", async () => {
	const { plugin, calls } = fakePlugin();
	const b = mobileBridge(plugin, "android");
	assert.equal(await b.update(true), undefined);
	await assert.rejects(b.restart(), /machine/);
	assert.equal(await b.init(), 1);
	assert.equal(await b.browserInstall(), 1);
	assert.deepEqual(await b.command("install"), { state: "unavailable", text: "" });
	await assert.rejects(b.voiceStart("en"), /Mac/);
	assert.equal(await b.voiceStop(), undefined);
	await assert.rejects(b.termOpen("t", undefined, 80, 24), /desktop app/);
	assert.equal(await b.termWrite("t", "ls"), undefined);
	assert.deepEqual(await b.termRun("t", "ls"), { reports: false });
	assert.equal(await b.termResize("t", 80, 24), undefined);
	assert.equal(await b.termClose("t"), undefined);
	assert.equal(await b.pickFolder("Choose"), undefined);
	assert.equal(b.pathOf({} as File), "");
	assert.equal(await b.reveal("/x"), undefined);
	assert.equal(await b.notify("t", "b"), undefined);
	assert.equal(await b.badge(3), undefined);
	// Optional on the page's bridge (a browser has its own menus); the mobile bridge has it, and it shows nothing.
	assert.equal(typeof b.contextMenu, "function");
	assert.equal(await b.contextMenu!([{ id: "a", label: "A" }]), undefined);
	for (const off of [b.onInitLine, b.onVoice, b.onTermData, b.onTermExit, b.onTermRun].map((on) => on(() => {}))) off();
	assert.deepEqual(calls, []);
});

test("prefs: each value checked as the desktop's main process checks it, then stored whole", async () => {
	const { plugin, calls } = fakePlugin({}, { hosts: ["me@box"], use: "me@box" });
	const b = mobileBridge(plugin, "android");
	await b.state();
	const after = await b.prefs({ notify: true, updates: true, look: { id: "night", name: "Night", kind: "dark", colors: { bg: "#000000", text: "#ffffff", accent: "red; background: url(x)" } } });
	assert.equal(after.notify, true);
	assert.equal(after.updates, true);
	assert.deepEqual(after.look, { id: "night", name: "Night", kind: "dark", colors: { bg: "#000000", text: "#ffffff" } }, "the theme is made safe by cleanLook");
	assert.deepEqual(after.hosts, ["me@box"]);
	assert.equal(after.use, "me@box");
	const saved = calls.find(([m]) => m === "savePrefs")?.[1] as { prefs: Record<string, unknown> };
	assert.deepEqual(Object.keys(saved.prefs).sort(), ["keepRunning", "look", "notify", "questionCards", "updates"], "machines are the plugin's own, not saved with the page's prefs");
	assert.equal(after.questionCards, true, "the questions' card is on unless turned off");
	const off = await b.prefs({ questionCards: false });
	assert.equal(off.questionCards, false);
	assert.equal((calls.filter(([m]) => m === "savePrefs").at(-1)?.[1] as { prefs: Record<string, unknown> }).prefs.questionCards, false);
	const on = await b.prefs({ questionCards: true });
	assert.equal(on.questionCards, true);

	const refused = await b.prefs({ notify: "yes", updates: 1, keepRunning: null, questionCards: "no", home: "/etc", hosts: ["evil"], use: "evil", extra: 1 });
	assert.deepEqual(refused, on, "nothing that is not a value the desktop accepts changes, and no machine is set this way");

	const reset = await b.prefs({ look: undefined });
	assert.equal(reset.look, undefined, "no theme is pine's default: none stored");
});

test("systemBars: the bars take the color and kind of the theme the page draws, pmndre's with none, and a plugin that cannot paint them changes nothing", async () => {
	const light = { id: "paper", name: "Paper", kind: "light", colors: { bg: "#FAFAFAcc", text: "#111111" } } as const;
	const { plugin, calls } = fakePlugin({ systemBars: () => Promise.reject(new Error("no window")) }, { hosts: [], prefs: { look: light } });
	const b = mobileBridge(plugin, "android");
	const bars = () => calls.filter(([m]) => m === "systemBars").map(([, o]) => o);
	await b.state();
	assert.deepEqual(bars(), [{ color: "#fafafa", dark: false }], "the stored theme at the start, as #rrggbb");
	await b.prefs({ look: { id: "night", name: "Night", kind: "dark", colors: { bg: "#000000", text: "#ffffff" } } });
	await b.prefs({ look: "not a theme" });
	await b.prefs({ notify: true });
	assert.deepEqual(bars().slice(1), [
		{ color: "#000000", dark: true },
		{ color: "#1b1e28", dark: true },
	], "a new theme, then pmndre's for one that is not a theme; a change without a theme leaves the bars");
});

// ---- pairing with a computer by its link (the plugin's `pair`, `cancelPairing` and `link`) ----

const ID = "q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x-_";
const NONCE = "Zm9vYmFyYmF6cXV4cXV1eA";
const CODE = "abcdefghijklmnopqrstuv";
const LINK = `https://pine-main.drcmda.workers.dev/#pair=${ID}.${CODE}`;
const PAIRED_HOST = `paired:${ID}`;

test("canPair: only where the plugin says it can, and the paired computers' names with the machines", async () => {
	const { plugin } = fakePlugin({ state: () => ({ state: { status: "starting" }, connected: false, version: "1", canPair: true }) }, { hosts: [PAIRED_HOST], names: { [PAIRED_HOST]: "Studio" } });
	const s = await mobileBridge(plugin, "android").state();
	assert.equal(s.canPair, true);
	assert.deepEqual(s.prefs.names, { [PAIRED_HOST]: "Studio" });
	const before = await mobileBridge(fakePlugin().plugin, "ios").state();
	assert.equal(before.canPair, false, "a plugin that does not say it can pair: no pairing offered");
	assert.equal(before.prefs.names, undefined);
});

test("pair: a pairing link the owner confirmed reaches the plugin as it is, in either form", async () => {
	const { plugin, calls } = fakePlugin();
	const b = mobileBridge(plugin, "android");
	const scheme = `pine://pair?service=${encodeURIComponent("https://pine.example.org")}&id=${ID}&code=${CODE}`;
	await b.pair!(LINK);
	await b.pair!(scheme);
	assert.deepEqual(calls, [["pair", { link: LINK }], ["pair", { link: scheme }]]);
});

test("pair: a link that is not a pairing link of an https service is refused and never reaches the plugin", async () => {
	const { plugin, calls } = fakePlugin();
	const b = mobileBridge(plugin, "android");
	const refused = [
		`http://pine-main.drcmda.workers.dev/#pair=${ID}.${CODE}`,
		`https://me:pw@pine-main.drcmda.workers.dev/#pair=${ID}.${CODE}`,
		`https://pine-main.drcmda.workers.dev/#pair=${ID}.${CODE}.more`,
		`https://pine-main.drcmda.workers.dev/#pair=${ID.slice(1)}.${CODE}`,
		`https://pine-main.drcmda.workers.dev/#pair=${ID}.${CODE}x`,
		`https://pine-main.drcmda.workers.dev/other#pair=${ID}.${CODE}`,
		`pine://pair?service=${encodeURIComponent("http://pine.example.org")}&id=${ID}&code=${CODE}`,
		`pine://pair?service=${encodeURIComponent("https://pine.example.org/path")}&id=${ID}&code=${CODE}`,
		`pine://pair?service=${encodeURIComponent("https://pine.example.org")}&id=${ID}`,
		`pine://other?service=${encodeURIComponent("https://pine.example.org")}&id=${ID}&code=${CODE}`,
		`javascript:alert(1)//#pair=${ID}.${CODE}`,
		"",
	];
	for (const link of refused) await assert.rejects(b.pair!(link), /not a pairing link/, link);
	assert.deepEqual(calls, []);
});

test("pairing: the digits, then allowed, refused or expired, reach the page as the plugin says them; cancel goes to the plugin", async () => {
	const { plugin, calls, emit } = fakePlugin();
	const b = mobileBridge(plugin, "android");
	const states: unknown[] = [];
	b.onService((s: unknown) => states.push(s));
	await new Promise((r) => setImmediate(r));
	const name = "Pine on Pixel 9";
	const said = [
		{ status: "starting", pairing: { name } },
		{ status: "starting", pairing: { code: "4821", name } },
		{ status: "starting", host: PAIRED_HOST },
		{ status: "starting", pairing: { code: "1234", name } },
		{ status: "error", kind: "ssh", message: "Your computer refused this phone: nothing was kept." },
		{ status: "starting", pairing: { name } },
		{ status: "error", kind: "ssh", message: "This pairing link has expired or was used already." },
	];
	for (const state of said) emit("service", { state });
	assert.deepEqual(states, said);
	await b.stopPairing!();
	assert.deepEqual(calls.filter(([m]) => m !== "addListener"), [["cancelPairing"]]);
});

test("a link the app was opened with reaches the page's listener and starts nothing", async () => {
	const { plugin, calls, emit } = fakePlugin();
	const b = mobileBridge(plugin, "android");
	const links: string[] = [];
	const off = b.onPairLink!((link) => links.push(link));
	await new Promise((r) => setImmediate(r));
	emit("link", { link: LINK });
	emit("link", { link: 42 });
	emit("link", {});
	assert.deepEqual(links, [LINK], "only a text is handed on");
	assert.deepEqual(calls, [["addListener", "link"]], "nothing is paired with until the owner says so");
	off();
	emit("link", { link: LINK });
	assert.equal(links.length, 1);
});

test("forgetHost of a paired computer: the entry goes, and no host key is asked about (its key is its machine id)", async () => {
	const { plugin, calls } = fakePlugin({ forgetHost: () => ({ hosts: [] }) }, { hosts: [PAIRED_HOST], names: { [PAIRED_HOST]: "Studio" } });
	const b = mobileBridge(plugin, "android");
	await b.state();
	await b.forgetHost(PAIRED_HOST);
	assert.deepEqual(calls.filter(([m]) => m.startsWith("forget")), [["forgetHost", { host: PAIRED_HOST }]]);
});

test("saveText: the text goes to the share sheet under its name", async () => {
	const { plugin, calls } = fakePlugin();
	assert.equal(await mobileBridge(plugin, "android").saveText("conversation.md", "# hi"), "conversation.md");
	assert.deepEqual(calls, [["share", { title: "conversation.md", text: "# hi" }]]);
});


test("nearby: the native side looks only while the page listens, and only where this build can; what it finds reaches the page checked", async () => {
	const { plugin, calls, emit } = fakePlugin({ state: () => ({ state: { status: "starting" }, connected: false, version: "0.0.0", canPair: true, canPairNearby: true }) });
	const b = mobileBridge(plugin, "ios");
	await b.state();
	assert.equal(calls.some(([m]) => m === "nearby"), false, "nothing looks before the page listens");
	const got: unknown[] = [];
	const stop = b.nearby!((found) => void got.push(found));
	const again = b.nearby!(() => {});
	await new Promise((r) => setImmediate(r));
	assert.deepEqual(calls.filter(([m]) => m === "nearby"), [["nearby", { on: true }]], "one look for two listeners");
	emit("nearby", { computers: [{ id: ID, service: "https://pine-main.drcmda.workers.dev", nonce: NONCE }, { id: "short", service: "https://x.example", nonce: NONCE }, { id: ID, service: "http://x.example", nonce: NONCE }, { id: ID, service: "https://x.example" }] });
	emit("nearby", { computers: [], denied: true });
	assert.deepEqual(got, [{ computers: [{ id: ID, service: "https://pine-main.drcmda.workers.dev", nonce: NONCE }] }, { computers: [], denied: true }]);
	stop();
	again();
	await new Promise((r) => setImmediate(r));
	assert.deepEqual(calls.filter(([m]) => m === "nearby").at(-1), ["nearby", { on: false }]);
});

test("nearby: a build whose native side cannot look is never asked to, and pairNearby is refused before the plugin", async () => {
	const { plugin, calls } = fakePlugin({ state: () => ({ state: { status: "starting" }, connected: false, version: "0.0.0", canPair: true }) });
	const b = mobileBridge(plugin, "android");
	await b.state();
	b.nearby!(() => {})();
	await assert.rejects(b.pairNearby!(ID, "https://pine-main.drcmda.workers.dev", NONCE), /Pine > Add a device/);
	assert.equal(calls.some(([m]) => m === "nearby" || m === "pairNearby"), false);
});

test("pairNearby: a machine id and an https origin reach the plugin; anything else is refused here", async () => {
	const { plugin, calls } = fakePlugin({ state: () => ({ state: { status: "starting" }, connected: false, version: "0.0.0", canPair: true, canPairNearby: true }) });
	const b = mobileBridge(plugin, "android");
	await b.state();
	await b.pairNearby!(ID, "https://pine-main.drcmda.workers.dev", NONCE);
	assert.deepEqual(calls.at(-1), ["pairNearby", { id: ID, service: "https://pine-main.drcmda.workers.dev", nonce: NONCE }]);
	for (const [id, service, nonce] of [["nope", "https://a.example", NONCE], [ID, "http://a.example", NONCE], [ID, "https://a.example/path", NONCE], [ID, "https://a.example", "short"]]) await assert.rejects(b.pairNearby!(id, service, nonce));
	assert.equal(calls.filter(([m]) => m === "pairNearby").length, 1);
});
