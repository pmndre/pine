import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import zlib from "node:zlib";
import { buildHelper, computer } from "./computer.ts";
import { startClaudeModel } from "../src/dev/claude-model.ts";
import { harness, mockMsg } from "../testing/harness.ts";
import { FAKE_HELPER } from "../testing/computer.ts";

// ---- the real helper, on a Mac --------------------------------------------------------------------

const live = process.env.PINE_LIVE === "1" && process.platform === "darwin";

// Builds the real helper and drives the real server logic against the helper's own demo window.
// A process may read its own accessibility tree without the owner's grant, so this runs on a Mac
// where nothing was granted; mouse and keyboard events and pictures are not part of it.
test("live: the real helper reads and operates a window by outline", { skip: !live, timeout: 300_000 }, async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pine-computer-live-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const program = await buildHelper(path.join(dir, "bin"));
	const server = computer({}, { scratch: dir, launch: async () => spawn(program, ["--demo"], { stdio: ["pipe", "pipe", "pipe"] }) });
	t.after(() => server.close());
	const call = async (name: string, args: Record<string, unknown> = {}) => String(await server.call(name, args));

	assert.match(await call("apps"), /- Pine Demo.*: window 1 "Pine Demo"/);
	const before = await call("app_snapshot", { app: "Pine Demo" });
	assert.match(before, /^Pine Demo, window 1 "Pine Demo"\./);
	const ref = (line: RegExp) => before.match(line)?.[1] ?? assert.fail(`${line} in\n${before}`);
	const field = ref(/- text field \[ref=(e\d+)\].*empty, shows "A word"/);
	const shout = ref(/- button "Shout" \[ref=(e\d+)\]/);
	const loud = ref(/- checkbox "Loud" \[ref=(e\d+)\] \(not checked\)/);
	assert.match(before, /- text "Nothing yet"/);

	assert.equal(await call("app_set_text", { app: "Pine Demo", ref: field, text: "pine" }), 'The text field in Pine Demo now holds "pine".');
	assert.match(await call("app_press", { app: "pine demo", ref: loud }), /^Pressed the checkbox "Loud" in Pine Demo/);
	assert.match(await call("app_press", { app: "Pine Demo", ref: shout }), /^Pressed the button "Shout" in Pine Demo/);
	const after = await call("app_snapshot", { app: "Pine Demo" });
	assert.match(after, /- text "PINE!!!"/, "the result is read back");
	assert.ok(after.includes(`- text field [ref=${field}]`) && after.includes(`- checkbox "Loud" [ref=${loud}] (checked)`), "a control keeps its reference");

	assert.match(await call("app_menu", { app: "Pine Demo" }), /^The menus of Pine Demo:\n- Demo >/);
	assert.match(await call("app_menu", { app: "Pine Demo", path: "Demo" }), /- Reset {3}cmd\+r/);
	assert.equal(await call("app_menu", { app: "Pine Demo", path: "Demo > Reset" }), 'Picked "Demo > Reset" in Pine Demo.');
	assert.match(await call("app_snapshot", { app: "Pine Demo" }), /- text "Nothing yet"/);
});

// The whole way without a real model: the daemon, its gate, the server as pi starts it, the real
// helper and a real window. The scripted model can name the references because a fresh helper
// numbers what it meets in order: the window, then its text field, button and checkbox. (The
// list of all apps comes last: with the Accessibility grant it numbers their windows too.)
test("live: through the daemon, the real helper operates a real window and the result is read back", { skip: !live, timeout: 300_000 }, async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pine-computer-live-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const program = await buildHelper(path.join(dir, "bin"));
	const h = await harness({ pine: { defaults: { mode: undefined }, mcp: { computer: { pine: "computer", options: { helper: [program, "--demo"] } } } }, agents: { main: {} } });
	const asked: string[] = [];
	h.pine.bus.subscribe("approval/requested", (e) => {
		asked.push(String((e.payload as any).summary).split("\n")[0]);
		h.pine.approvals.decide((e.payload as any).id, true, "test");
	});
	const app = "Pine Demo";
	const call = (name: string, args: Record<string, unknown> = {}) => ({ name: `mcp__computer__${name}`, args });
	const r = await h.pine.agents.run({
		agent: "main",
		prompt: mockMsg([
			{ tools: [call("app_open", { app }), call("app_snapshot", { app })] },
			{ tools: [call("app_set_text", { app, ref: "e2", text: "pine" }), call("app_press", { app, ref: "e4" }), call("app_press", { app, ref: "e3" }), call("app_menu", { app, path: "Demo" }), call("app_snapshot", { app }), call("apps")] },
		]),
		trust: "owner",
	});
	assert.equal(r.status, "done", String(r.error));
	const out = h.toolResults();
	assert.match(out[0], /^Pine Demo was already running and is in front\. Its window: 1 "Pine Demo"\./);
	assert.match(out[1], /- text field \[ref=e2\].*\n- button "Shout" \[ref=e3\]\n- checkbox "Loud" \[ref=e4\] \(not checked\)\n- text "Nothing yet"/);
	assert.equal(out[2], 'The text field in Pine Demo now holds "pine".');
	assert.match(out[3], /^Pressed the checkbox "Loud" in Pine Demo/);
	assert.match(out[4], /^Pressed the button "Shout" in Pine Demo/);
	assert.match(out[5], /"Demo" in Pine Demo holds:\n- Reset {3}cmd\+r/);
	assert.match(out[6], /- text field \[ref=e2\].*: "pine"\n- button "Shout" \[ref=e3\]\n- checkbox "Loud" \[ref=e4\] \(checked\)\n- text "PINE!!!"/);
	assert.match(out[7], /- Pine Demo.*: window 1 "Pine Demo"/);
	assert.deepEqual(asked, ["operate the app Pine Demo"], "one question for the one app");
	assert.match(h.pine.agents.status().sessions[0].tainted ?? "", /returned outside content/);
	await h.close();
});

/**
 * A real model for the tests below: `claude -p` (see src/dev/claude-model.ts), or, with
 * PINE_LIVE_BASE_URL, an OpenAI-compatible server such as a local llama.cpp
 * (PINE_LIVE_KEY: its key; PINE_LIVE_MODEL: the model's name there; PINE_LIVE_SEES=1 if it takes pictures).
 */
async function liveModel(t: { after(fn: () => unknown): void }): Promise<{ mock: any; sees: boolean }> {
	const base = process.env.PINE_LIVE_BASE_URL;
	if (!base) {
		const model = await startClaudeModel({ model: process.env.PINE_LIVE_MODEL ?? "haiku", log: (l) => process.env.PINE_TEST_LOG && console.error(l) });
		t.after(() => model.close());
		return { mock: { baseUrl: model.baseUrl, port: model.port, state: { requests: [] } }, sees: true };
	}
	const target = new URL(base);
	// The harness writes a model file without a key: this hands requests on with one.
	const proxy = http.createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c) => chunks.push(c)).on("end", () => {
			let body = Buffer.concat(chunks);
			try {
				if (process.env.PINE_LIVE_MODEL && body.length) body = Buffer.from(JSON.stringify({ ...JSON.parse(body.toString()), model: process.env.PINE_LIVE_MODEL }));
			} catch {
				// not JSON: as it is
			}
			const up = http.request({ host: target.hostname, port: target.port || 80, method: req.method, path: req.url, headers: { ...req.headers, host: target.host, "content-length": String(body.length), ...(process.env.PINE_LIVE_KEY ? { authorization: `Bearer ${process.env.PINE_LIVE_KEY}` } : {}) } }, (r) => {
				res.writeHead(r.statusCode ?? 502, r.headers);
				r.pipe(res);
			});
			up.on("error", () => res.writeHead(502).end());
			up.end(body);
		});
	});
	await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
	t.after(() => (proxy.closeAllConnections(), proxy.close()));
	const port = (proxy.address() as net.AddressInfo).port;
	return { mock: { baseUrl: `http://127.0.0.1:${port}${target.pathname.replace(/\/$/, "")}`, port, state: { requests: [] } }, sees: process.env.PINE_LIVE_SEES === "1" };
}

/** A daemon with a real model whose main agent has app control and nothing else to act with. */
async function liveAgent(t: { after(fn: () => unknown): void }, mock: any, options: Record<string, unknown>) {
	const h = await harness({
		mock,
		model: { contextWindow: 120000, maxTokens: 4096, input: ["text", "image"] },
		pine: { defaults: { mode: undefined }, mcp: { computer: { pine: "computer", options } } },
		agents: { main: { agent: { tools: ["read"], taskTimeoutSec: 600 }, persona: "You operate apps on your owner's Mac for them, with the tools whose names start with mcp__computer__. Do what is asked, step by step, and report what you found.\n" } },
	});
	const asked: string[] = [];
	const used: string[] = [];
	h.pine.bus.subscribe("approval/requested", (e) => {
		asked.push(String((e.payload as any).summary).split("\n")[0]);
		h.pine.approvals.decide((e.payload as any).id, true, "test");
	});
	h.pine.bus.subscribe("agent/main/tool", (e) => void ((e.payload as any).phase === "start" && used.push(String((e.payload as any).tool).replace("mcp__computer__", ""))));
	return { h, asked, used };
}

/** A picture of flat colors, as a PNG. */
function png(width: number, height: number, rects: Array<{ x: number; y: number; w: number; h: number; rgb: [number, number, number] }>): Buffer {
	const row = width * 3 + 1;
	const raw = Buffer.alloc(row * height, 255);
	for (let y = 0; y < height; y++) {
		raw[y * row] = 0;
		for (const r of rects) if (y >= r.y && y < r.y + r.h) for (let x = r.x; x < r.x + r.w; x++) raw.set(r.rgb, y * row + 1 + x * 3);
	}
	const chunk = (type: string, data: Buffer) => {
		const body = Buffer.concat([Buffer.from(type), data]);
		const out = Buffer.alloc(body.length + 8);
		out.writeUInt32BE(data.length, 0);
		body.copy(out, 4);
		out.writeUInt32BE(zlib.crc32(body) >>> 0, body.length + 4);
		return out;
	};
	const head = Buffer.alloc(13);
	head.writeUInt32BE(width, 0);
	head.writeUInt32BE(height, 4);
	head.set([8, 2, 0, 0, 0], 8);
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("live: an agent reads a real window by outline, writes into it, presses its button and reads the result back", { skip: !live, timeout: 600_000 }, async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pine-computer-live-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const program = await buildHelper(path.join(dir, "bin"));
	const { mock } = await liveModel(t);
	// The helper's own demo window: real accessibility, and no grant needed for it.
	const { h, asked, used } = await liveAgent(t, mock, { helper: [program, "--demo"], images: false });
	const r = await h.pine.agents.run({ agent: "main", prompt: 'An app called "Pine Demo" is running on this Mac. Read its window. Put the word pine into its text field, tick the checkbox Loud, press the button Shout. Then read the window again and tell me exactly what text it shows below the button now.', trust: "owner" });
	assert.equal(r.status, "done", String(r.error));
	assert.match(r.text, /PINE!!!/, `${r.text}\n(used: ${used.join(", ")})`);
	assert.deepEqual(asked, ["operate the app Pine Demo"], "asked once, for the one app");
	for (const name of ["app_snapshot", "app_set_text", "app_press"]) assert.ok(used.includes(name), `${name} in ${used.join(", ")}`);
	assert.ok(used.filter((n) => n === "app_snapshot").length >= 2, "it read the result back");
	await h.close();
});

test("live: an agent that sees clicks what it was asked to click in a picture, and the click lands at the right point of the screen", { skip: !live, timeout: 600_000 }, async (t) => {
	const { mock, sees } = await liveModel(t);
	if (!sees) return t.skip("the model does not take pictures (PINE_LIVE_SEES=1 says that it does)");
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pine-computer-live-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	// The stand-in's TextEdit window is 640 by 400 points at 100, 50 on the screen; its picture is 1280 by 800 pixels.
	const blue = { x: 800, y: 500, w: 320, h: 120 };
	fs.writeFileSync(path.join(dir, "window.png"), png(1280, 800, [{ ...blue, rgb: [20, 60, 220] }, { x: 100, y: 100, w: 200, h: 100, rgb: [220, 30, 30] }]));
	fs.writeFileSync(path.join(dir, "helper.mjs"), FAKE_HELPER);
	fs.writeFileSync(path.join(dir, "log.txt"), "");
	const { h, asked, used } = await liveAgent(t, mock, { helper: [process.execPath, path.join(dir, "helper.mjs"), path.join(dir, "log.txt"), `picture=${path.join(dir, "window.png")}`], block: ["app_snapshot", "app_press", "app_set_text", "app_menu"] });
	const r = await h.pine.agents.run({ agent: "main", prompt: "Take a picture of the window of the app TextEdit. It shows a blue rectangle and a red rectangle on white. Click once in the middle of the blue rectangle, then tell me the position you clicked.", trust: "owner" });
	assert.equal(r.status, "done", String(r.error));
	const clicks = fs.readFileSync(path.join(dir, "log.txt"), "utf8").split("\n").filter((l) => l.startsWith("click ")).map((l) => l.split(" ")[1].split(",").map(Number));
	assert.ok(clicks.length >= 1, `no click (used: ${used.join(", ")}; said: ${r.text})`);
	// Half a point per pixel, from 100, 50.
	const [x, y] = clicks.at(-1)!;
	assert.ok(x > 100 + blue.x / 2 && x < 100 + (blue.x + blue.w) / 2 && y > 50 + blue.y / 2 && y < 50 + (blue.y + blue.h) / 2, `clicked the screen at ${x}, ${y}, outside the blue rectangle (${r.text})`);
	assert.deepEqual(asked, ["operate the app TextEdit"]);
	assert.ok(used.includes("app_screenshot") && used.includes("app_click"));
	await h.close();
});

/** What macOS has granted the app these tests run in, asked of the real helper. */
async function granted(program: string): Promise<{ accessibility: boolean; screen: boolean }> {
	const child = spawn(program, [], { stdio: ["pipe", "pipe", "ignore"] });
	try {
		const line = await new Promise<string>((resolve, reject) => {
			child.stdout.once("data", (d) => resolve(String(d)));
			child.once("error", reject);
			child.stdin.write('{"id":1,"cmd":"status"}\n');
		});
		return JSON.parse(line.split("\n")[0]);
	} finally {
		child.kill();
	}
}

// The two tests below operate the real TextEdit on the screen of whoever runs them. They need what
// app control needs: the terminal app they are started from must have the Accessibility grant, and
// for pictures the Screen Recording grant. Without it they skip and say so.
for (const way of ["outline", "picture"] as const) {
	test(`live: an agent opens TextEdit, writes into a new document and reads it back, by ${way}`, { skip: !live, timeout: 900_000 }, async (t) => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pine-computer-live-"));
		t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
		const program = await buildHelper(path.join(dir, "bin"));
		const has = await granted(program);
		if (!has.accessibility) return t.skip("the app this runs in has no Accessibility grant (System Settings > Privacy & Security > Accessibility)");
		if (way === "picture" && !has.screen) return t.skip("the app this runs in has no Screen Recording grant (System Settings > Privacy & Security > Screen & System Audio Recording)");
		const { mock, sees } = await liveModel(t);
		if (way === "picture" && !sees) return t.skip("the model does not take pictures (PINE_LIVE_SEES=1 says that it does)");

		// Typed, as by picture, macOS corrects what it can: a capital after a full stop is already there, and digits have no spelling.
		const token = `Pine was here ${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
		// By outline the model gets no pictures; by picture it gets nothing that works by reference.
		const { h, asked, used } = await liveAgent(t, mock, way === "outline" ? { helper: program, images: false } : { helper: program, block: ["app_snapshot", "app_press", "app_set_text"] });
		// Whatever the agent did, look for ourselves afterwards, and put the document away again.
		const own = computer({}, { scratch: dir, launch: async () => spawn(program, [], { stdio: ["pipe", "pipe", "pipe"] }) });
		t.after(async () => {
			try {
				if (String(await own.call("app_snapshot", { app: "TextEdit" })).includes(token)) {
					await own.call("app_key", { app: "TextEdit", keys: "cmd+w" });
					await new Promise((r) => setTimeout(r, 800));
					const sheet = String(await own.call("app_snapshot", { app: "TextEdit" }));
					const no = sheet.match(/- button "(?:Delete|Don.t Save)" \[ref=(e\d+)\]/)?.[1];
					if (no) await own.call("app_press", { app: "TextEdit", ref: no });
				}
			} catch {
				// the document stays open; nothing else depends on it
			}
			own.close();
		});

		const how =
			way === "outline"
				? "Work by outline: read the window with app_snapshot and write with app_set_text, using the reference of the document's text area."
				: "Work by picture: look with app_screenshot, click into the middle of the document's text with app_click, then type with app_type.";
		const r = await h.pine.agents.run({ agent: "main", prompt: `Open the app TextEdit. Make a new empty document in it: press cmd+n with app_key (if a window for choosing a file is in the way, this also gets you past it). ${how} The document must hold exactly this text: ${token}\nThen look at the document again and tell me, word for word, what it holds.`, trust: "owner" });
		assert.equal(r.status, "done", String(r.error));
		assert.ok(r.text.includes(token), `the agent read back: ${r.text}\n(used: ${used.join(", ")})`);
		assert.match(String(await own.call("app_snapshot", { app: "TextEdit" })), new RegExp(token), "the text is really in TextEdit's window");
		assert.deepEqual(asked, ["operate the app TextEdit"], "asked once, for the one app");
		for (const name of way === "outline" ? ["app_open", "app_snapshot", "app_set_text"] : ["app_open", "app_screenshot", "app_click", "app_type"]) assert.ok(used.includes(name), `${name} in ${used.join(", ")}`);
		await h.close();
	});
}
