// Pictures, video and sound, links and saved files in the web client, through the page's
// `window.pine` as the page uses it: the page's bridge in its frame, the door at the top, and the
// web bridge on the stand-in machine (support/fake-ssh.ts) whose daemon is a real HTTP server.
// The rules are the desktop's (`MEDIA` and `mediaFromDaemon` in desktop/electron/daemon.ts,
// `openOutside` in desktop/electron/main.ts).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ServiceState } from "../../desktop/src/bridge.ts";
import { frameBridge } from "../src/frame-bridge.ts";
import { webBridge, type Store } from "../src/host.ts";
import { mediaUrls } from "../src/page-media.ts";
import { serve } from "../src/serve.ts";
import { callDaemon } from "../src/tunnel.ts";
import { fakeMachine, fakeStream, startDaemon, type Daemon } from "./support/fake-ssh.ts";
import { windows } from "./support/windows.ts";

let daemon: Daemon;
before(async () => (daemon = await startDaemon()));
after(async () => daemon.stop());

function memoryStore(): Store {
	const kept = new Map<string, unknown>();
	return { get: async (name) => structuredClone(kept.get(name)) as any, set: async (name, value) => void kept.set(name, structuredClone(value)) };
}

/** A page whose machine is added, its key trusted, and its pine ready; what the top opened and saved is noted. */
async function ready() {
	const w = windows();
	const opened: string[] = [];
	const saved: [string, string][] = [];
	const machine = fakeMachine(daemon);
	const bridge = webBridge({
		connect: machine.connect,
		store: memoryStore(),
		relay: (host, port) => fakeStream(`wss://relay.test/ssh?host=${host}&port=${port}`),
		clipboard: async () => {},
		open: (url) => void opened.push(url),
		save: (name, text) => void saved.push([name, text]),
		version: "9.9.9",
	});
	serve(bridge, w.top, () => w.frame);
	const page = frameBridge(w.parentOfFrame, w.frame);
	const states: ServiceState[] = [];
	page.onService((s: ServiceState) => states.push(s));
	const becomes = async (match: (s: ServiceState) => boolean) => {
		const until = Date.now() + 3000;
		for (;;) {
			const last = states.at(-1);
			if (last && match(last)) return last;
			if (Date.now() > until) throw new Error(`never told that; last: ${JSON.stringify(last)}`);
			await new Promise((r) => setTimeout(r, 5));
		}
	};
	await page.state();
	await page.addHost("me@box.example");
	await page.use("me@box.example");
	const asked = await becomes((s) => s.status === "error");
	await page.trustHostKey!("me@box.example", (asked as { fingerprint: string }).fingerprint);
	await becomes((s) => s.status === "ready");
	return { page, opened, saved, stop: () => bridge.stop() };
}

test("media: a listed path comes to the page as its bytes and kind, fetched with the token the page never sees", async () => {
	const c = await ready();
	assert.equal(c.page.mediaBase, "pine-media://daemon");
	const picture = await c.page.media("/media/tool/t1");
	assert.equal(picture.type, "image/png");
	assert.deepEqual([...picture.bytes], [0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
	const video = await c.page.media("/agents/main/image?path=clip.mp4&session=s1");
	assert.equal(video.type, "video/mp4");
	assert.equal(new TextDecoder().decode(video.bytes), "not really a video");
	const asked = daemon.seen.find((x) => x.url === "/media/tool/t1");
	assert.equal(asked?.auth, `Bearer ${daemon.token}`);
	c.stop();
});

test("media: a path outside the rules is refused before anything is asked of the daemon", async () => {
	const c = await ready();
	const before = daemon.seen.length;
	const bad = ["/agents", "/events/stream?topic=%23", "/media/tool/a/b", "/tasks/x/images/1", "/agents/main/message", "//evil.example/x", "https://evil.example/media/tool/t1", "/media/tool/t1\r\nX-Evil: 1", "/media/tool/t1#x"];
	for (const target of bad) await assert.rejects(c.page.media(target), target);
	// The stand-in daemon is shared with the other tests of this file, whose event streams may ask it meanwhile: only these paths must not have reached it.
	const asked = daemon.seen.slice(before).map((x) => x.url);
	assert.deepEqual(asked.filter((url) => bad.includes(url)), []);
	c.stop();
});

test("media: only what is drawn or played; a page, a drawing with scripts, a missing one are not shown", async () => {
	const c = await ready();
	await assert.rejects(c.page.media("/media/tool/page"), "a page");
	await assert.rejects(c.page.media("/media/tool/drawing"), "a drawing with scripts");
	await assert.rejects(c.page.media("/media/tool/gone"), "one that is not there");
	c.stop();
});

test("links: an address of the web opens in a new tab; anything else is refused and opens nothing", async () => {
	const c = await ready();
	await c.page.open("https://example.com/a?b=c");
	await c.page.open("http://example.org");
	for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,<b>x</b>", "pine-media://daemon/media/tool/t1", "not an address", "//example.com"]) await assert.rejects(c.page.open(bad), /http/, bad);
	assert.deepEqual(c.opened, ["https://example.com/a?b=c", "http://example.org/"]);
	c.stop();
});

test("saving: the text is handed to the browser to save under the name's last part, which is what the page is told", async () => {
	const c = await ready();
	assert.equal(await c.page.saveText("pine-main-s1-2026-11-19.md", "# hi\n"), "pine-main-s1-2026-11-19.md");
	assert.equal(await c.page.saveText("../../etc/x.md", "x"), "x.md");
	assert.deepEqual(c.saved, [["pine-main-s1-2026-11-19.md", "# hi\n"], ["x.md", "x"]]);
	c.stop();
});

test("the page's object URLs: a media address becomes one for its bytes, made once; anything else is left as it is", async () => {
	const asked: string[] = [];
	const made: Blob[] = [];
	const urls = mediaUrls({
		base: "pine-media://daemon",
		media: async (path) => {
			asked.push(path);
			if (path === "/media/tool/gone") throw new Error("not found");
			return { type: "image/png", bytes: new Uint8Array([1, 2]) };
		},
		createObjectURL: (blob) => (made.push(blob), `blob:null/${made.length}`),
		revokeObjectURL: () => {},
	});
	assert.equal(urls.handles("https://example.com/x.png"), false);
	assert.equal(urls.handles("pine-media://daemon/media/tool/t1"), true);
	assert.equal(await urls.resolve("pine-media://daemon/media/tool/t1"), "blob:null/1");
	assert.equal(await urls.resolve("pine-media://daemon/media/tool/t1"), "blob:null/1");
	assert.deepEqual(asked, ["/media/tool/t1"]);
	assert.equal(made[0].type, "image/png");
	assert.equal(await urls.resolve("pine-media://daemon/media/tool/gone"), undefined);
});

test("a control API call whose path would break its request line is answered 400, and nothing is sent", async () => {
	const forwarded: string[] = [];
	const connection = {
		forward: async (host: string, port: number) => {
			forwarded.push(`${host}:${port}`);
			throw new Error("no tunnel in this test");
		},
	};
	const stand = { connection, host: "127.0.0.1", port: 1, token: "secret" } as unknown as Parameters<typeof callDaemon>[0];
	for (const bad of ["/x HTTP/1.1\r\nX-Injected: 1\r\n\r\nGET /y", "/agents\nX: 1", "/agents x", "/agents\tx", "/agents\0", "/agents\x7f", "/agents#x"]) {
		const answer = await callDaemon(stand, "GET", bad);
		assert.deepEqual(answer, { ok: false, status: 400, data: { error: "not a call of the control API" } }, JSON.stringify(bad));
	}
	assert.deepEqual(forwarded, []);
	assert.equal((await callDaemon(stand, "GET", "/agents")).status, 0);
	assert.deepEqual(forwarded, ["127.0.0.1:1"]);
});

test("a control API call the daemon takes and never answers ends after the time limit, with what to do, and its channel is closed", async () => {
	let closed = false;
	const channel = {
		onData: () => {},
		onStderr: () => {},
		send: async () => {},
		close: async () => void (closed = true),
		closed: new Promise(() => {}),
	};
	const stand = { connection: { forward: async () => channel }, host: "127.0.0.1", port: 1, token: "secret" } as unknown as Parameters<typeof callDaemon>[0];
	const started = Date.now();
	const answer = await callDaemon(stand, "GET", "/agents", undefined, 50);
	assert.ok(Date.now() - started < 1000);
	assert.equal(answer.ok, false);
	assert.equal(answer.status, 0);
	assert.ok(typeof answer.data.error === "string" && answer.data.error.length > 0, "an error the page can show");
	assert.equal(closed, true);
});
