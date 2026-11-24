import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { getCapabilities, setCapabilities } from "@earendil-works/pi-tui";
import { PineTui } from "../src/tui/app.ts";
import { Client } from "../src/tui/client.ts";
import { BANDS, bandEdges, bars, levelsOf } from "../src/tui/levels.ts";
import { halfBlocks, parseBmp, picturesIn, prepare, prepareSound, Sound, soundLevels, scaled } from "../src/tui/picture.ts";
import { c } from "../src/tui/theme.ts";
import { harness, mockMsg, sleep, until } from "./support/harness.ts";
import { png } from "./support/png.ts";
import { FakeTerminal, KEY } from "./support/terminal.ts";

/** Pictures need a converter: sips on macOS, ffmpeg elsewhere. */
const mac = { skip: process.platform !== "darwin" && !["/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"].some((f) => fs.existsSync(f)) };
const owner = { trust: "owner" as const };
const apps: PineTui[] = [];
after(async () => {
	for (const app of apps) await app.stop().catch(() => {});
});

test("pictures: which ones an answer points at", () => {
	const refs = picturesIn("Here ![the chart](out/chart.png) and ![](https://example.com/a%20b.jpg?x=1 \"title\"), twice ![again](out/chart.png).\n\n```md\n![in code](no.png)\n```\nAnd `![inline](no2.png)`, ![d](data:image/png;base64,AAAA), ![odd](javascript:alert(1)), ![f](file:///tmp/my%20pic.png)");
	assert.deepEqual(refs, [
		{ caption: "the chart", target: "out/chart.png", remote: false },
		{ caption: "", target: "https://example.com/a%20b.jpg?x=1", remote: true },
		{ caption: "f", target: "/tmp/my pic.png", remote: false },
	]);
	assert.equal(picturesIn(Array.from({ length: 20 }, (_, i) => `![p](p${i}.png)`).join(" ")).length, 6, "an answer cannot flood the screen");
});

test("pictures: a picture becomes half blocks that keep its colors and shape", mac, async () => {
	const p = await prepare(png(64, 40), "image/png", "two halves");
	assert.equal(`${p.widthPx}x${p.heightPx}`, "64x40");
	assert.ok(p.pixels && p.pixels.width === 64 && p.pixels.height === 40, "small pictures are not enlarged");
	const lines = halfBlocks(p.pixels!, 32, 14);
	assert.equal(lines.length, 10, "32 cells wide, two pixel rows per line");
	assert.ok(lines.every((l) => l.split("▀").length - 1 === 32));
	assert.ok(lines[0].startsWith(" \x1b[38;2;220;40;40m\x1b[48;2;220;40;40m▀") && lines[0].includes("\x1b[38;2;40;60;220m\x1b[48;2;40;60;220m▀\x1b[0m"), JSON.stringify(lines[0].slice(0, 80)));
	assert.equal(halfBlocks(p.pixels!, 100, 5).length, 5, "the height limit wins and the width follows");
	assert.ok(halfBlocks(p.pixels!, 8, 14, false)[0].includes("\x1b[38;5;"), "256 colors where true color is missing");
	// Something that is not a picture, and a broken file: no drawing, no crash.
	assert.equal((await prepare(Buffer.from("not a picture at all"), "image/png", "x")).pixels, undefined);
	assert.equal(parseBmp(Buffer.from("BM")), undefined);
});

// Where there is no sips (Linux), ffmpeg makes the copies. Runs wherever ffmpeg is installed.
const hasFfmpeg = { skip: !["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", ...(process.env.PATH ?? "").split(":")].some((d) => fs.existsSync(path.join(d, "ffmpeg"))) };
test("pictures: ffmpeg converts where sips is missing", hasFfmpeg, async (t) => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-pic-test-")));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	fs.writeFileSync(path.join(dir, "in"), png(64, 40));
	assert.ok(await scaled(dir, path.join(dir, "in"), 64, "bmp", "ffmpeg"));
	const same = parseBmp(fs.readFileSync(path.join(dir, "out.bmp")))!;
	assert.equal(`${same.width}x${same.height}`, "64x40");
	assert.deepEqual([...same.rgb.subarray(0, 3)], [220, 40, 40], "the colors and which way is up survive");
	assert.deepEqual([...same.rgb.subarray((39 * 64 + 63) * 3, (39 * 64 + 63) * 3 + 3)], [40, 60, 220]);
	assert.ok(await scaled(dir, path.join(dir, "in"), 32, "bmp", "ffmpeg"));
	const small = parseBmp(fs.readFileSync(path.join(dir, "out.bmp")))!;
	assert.equal(`${small.width}x${small.height}`, "32x20", "scaled by its longer side, the shape kept");
	assert.ok((await scaled(dir, path.join(dir, "in"), 32, "png", "ffmpeg")) && fs.readFileSync(path.join(dir, "out.png")).subarray(1, 4).toString() === "PNG");
	fs.writeFileSync(path.join(dir, "bad"), "not a picture at all");
	assert.equal(await scaled(dir, path.join(dir, "bad"), 32, "bmp", "ffmpeg"), false);
});

test("pictures: the daemon serves pictures to a UI and nothing else", async (t) => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-pic-test-")));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	fs.writeFileSync(path.join(dir, "outside.png"), png());
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: { files: { "pic.png": png().toString("latin1"), "notes.txt": "private notes" } } } });
	const ws = h.workspace("main");
	fs.writeFileSync(path.join(ws, "pic.png"), png());
	fs.writeFileSync(path.join(ws, "fake.png"), "this only has the name of a picture");
	fs.symlinkSync(path.join(dir, "outside.png"), path.join(ws, "link.png"));
	const client = new Client(`http://127.0.0.1:${h.pine.http!.port}`, h.pine.token);

	const ok = await client.workspaceImage("main", "pic.png");
	assert.ok(ok && ok.mime === "image/png" && ok.bytes.equals(png()));
	for (const bad of ["notes.txt", "fake.png", "link.png", path.join(dir, "outside.png"), "../../pine.json", "missing.png", ""]) assert.equal(await client.workspaceImage("main", bad), undefined, bad);
	assert.equal(await client.workspaceImage("nobody", "pic.png"), undefined);
	const anonymous = await fetch(`http://127.0.0.1:${h.pine.http!.port}/agents/main/image?path=pic.png`);
	assert.equal(anonymous.status, 401);

	// A picture a tool returned is kept and served by id; ids cannot wander off.
	fs.writeFileSync(path.join(ws, "shot.png"), png(32, 20));
	const events: any[] = [];
	h.pine.bus.subscribe("agent/main/tool", (e) => void events.push(e.payload));
	await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [{ name: "read", args: { path: "shot.png" } }] }]), ...owner });
	const end = events.find((e) => e.phase === "end");
	assert.equal(end.images?.length, 1, JSON.stringify(end));
	const kept = await client.toolImage(end.images[0]);
	assert.ok(kept && kept.bytes.equals(png(32, 20)));
	for (const bad of ["..%2F..%2Fhttp-token", "nothing-0-0", "a/b"]) assert.equal(await client.toolImage(bad), undefined, bad);
	const steps = h.pine.agents.transcript(h.pine.tasks.list({})[0].id)!.entries;
	assert.deepEqual(steps.find((s) => s.kind === "tool")?.images, end.images, "the same picture is listed in the task's transcript");

	// A picture that came with a message.
	const sent = h.pine.agents.submit({ agent: "main", prompt: "look", trust: "owner", attachments: [{ name: "photo.png", data: png(16, 16).toString("base64") }] });
	await h.pine.agents.wait(sent.id);
	if (h.pine.tasks.get(sent.id)!.meta.images?.length) assert.ok((await client.taskImage(sent.id, 0))!.bytes.equals(png(16, 16)));
	assert.equal(await client.taskImage(sent.id, 5), undefined);

	// Web pictures are fetched for the owner only from public https addresses.
	await assert.rejects(client.fetchImage(`http://127.0.0.1:${h.pine.http!.port}/health`), /only https/);
	await assert.rejects(client.fetchImage("https://127.0.0.1/x.png"), /private and local/);
	await assert.rejects(client.fetchImage("https://localhost/x.png"), /private and local/);
	await h.close();
});

async function open(spec: Parameters<typeof harness>[0]) {
	const h = await harness({ ...spec, pine: { main: "main", http: { port: 0 }, ...(spec.pine ?? {}) } });
	const term = new FakeTerminal(110, 44);
	const app = new PineTui({ client: new Client(`http://127.0.0.1:${h.pine.http!.port}`, h.pine.token), terminal: term });
	apps.push(app);
	await app.start();
	const text = () => app.screen().join("\n");
	const send = async (line: string) => {
		term.type(line);
		term.type([KEY.enter]);
		await sleep(15);
	};
	const sees = (what: string | RegExp, ms = 5000) => until(() => (typeof what === "string" ? text().includes(what) : what.test(text())), ms, `the screen to show ${what}\n--- screen ---\n${text()}`);
	return { h, term, app, text, send, sees, close: async () => (await app.stop(), await h.close()) };
}

test("pictures: an agent is told, in the tool's answer, that the picture a server made is already shown", async (t) => {
	const { httpMcp } = await import("./support/http-mcp.ts");
	const stub = await httpMcp({ picture: png(32, 20) });
	t.after(() => stub.close());
	const h = await harness({ agents: { main: { agent: { mcp: { media: { url: stub.url } } } } } });
	const events: any[] = [];
	h.pine.bus.subscribe("agent/main/tool", (e) => void events.push(e.payload));
	const told = /\[pine: your owner already sees the picture that came with this answer, above your reply\. Do not put it into your reply: no !\[\.\.\.\]\(\.\.\.\) and no link to it\. Fetch it with the download tool only if your owner asks for it as a file\.\]$/;

	// The answer of a server's tool that came with a picture says so, and the picture is the one shown.
	await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [{ name: "mcp__media__lookup", args: { q: "a shiba" } }] }]), ...owner });
	assert.match(h.toolResults().at(-1)!, /^looked up: a shiba/);
	assert.match(h.toolResults().at(-1)!, told);
	assert.equal(events.find((e) => e.phase === "end").images?.length, 1);

	// A picture the agent looked at itself is not one it was handed for its owner: nothing is added.
	fs.writeFileSync(path.join(h.workspace("main"), "shot.png"), png(32, 20));
	await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [{ name: "read", args: { path: "shot.png" } }] }]), ...owner });
	assert.doesNotMatch(h.toolResults().at(-1)!, /\[pine: /);

	// An answer that goes to a chat: nothing was drawn there, so nothing is claimed.
	await h.pine.agents.run({ agent: "main", session: "chat", prompt: mockMsg([{ tools: [{ name: "mcp__media__lookup", args: { q: "a cat" } }] }]), reply: { topic: "out/chat" }, ...owner });
	assert.match(h.toolResults().at(-1)!, /^looked up: a cat/);
	assert.doesNotMatch(h.toolResults().at(-1)!, /\[pine: /);
	await h.close();
});

test("tui: pictures from a tool, in an answer and attached to a message are drawn; a web picture waits for a click", mac, async () => {
	const t = await open({ agents: { main: {} } });
	await t.sees("type a message");
	const ws = t.h.workspace("main");
	fs.writeFileSync(path.join(ws, "chart.png"), png(64, 40));

	// The agent reads a picture (a tool result) and points at it in its answer. A picture on the web is only named.
	await t.send(mockMsg([{ tools: [{ name: "read", args: { path: "chart.png" } }] }]));
	await t.sees("from read · 64×40 · click to enlarge");
	await t.send(mockMsg([{ text: "Here it is: ![the chart](chart.png) and one from the web ![logo](https://example.com/logo.png) and ![gone](nope.png)" }]));
	await t.sees("the chart · 64×40 · click to enlarge");
	await t.sees("▸ load picture https://example.com/logo.png");
	await t.sees("(no picture at nope.png in the workspace)");
	const blocks = (s: string) => s.split("▀").length - 1;
	const thumbnails = blocks(t.text());
	assert.ok(thumbnails >= 44 * 14 && thumbnails % 44 === 0, `thumbnails are 44 cells wide and at most 14 lines high (${thumbnails})`);
	assert.ok(!t.text().includes("logo ·"), "nothing was fetched from the web");
	const requests = t.h.mock.state.requests;
	assert.ok(!JSON.stringify(requests.at(-1).body.messages.filter((m: any) => m.role !== "tool")).includes("▀"), "the model is not shown the drawing");

	// A click enlarges, another shrinks.
	const row = () => t.app.screen().findIndex((l) => l.includes("the chart · 64×40"));
	t.term.click(5, row() - 3);
	await t.sees("the chart · 64×40 · click to shrink");
	assert.ok(blocks(t.text()) > thumbnails, "the enlarged picture takes more room");
	t.term.click(5, row() - 3);
	await t.sees("the chart · 64×40 · click to enlarge");

	// A dropped picture shows under the message it goes out with, and again when the conversation is reopened.
	const photo = path.join(fs.realpathSync(os.tmpdir()), `pine-photo-${Date.now()}.png`);
	fs.writeFileSync(photo, png(40, 40, [10, 200, 90], [10, 200, 90]));
	t.term.paste(photo);
	await t.sees("attached:");
	await t.send("what is this");
	await t.sees(`${path.basename(photo)} · 40×40 · click to enlarge`);
	await t.sees("ECHO[what is this");
	fs.rmSync(photo);
	await t.app.stop();
	const again = new PineTui({ client: t.app.client, terminal: new FakeTerminal(110, 60) });
	apps.push(again);
	await again.start();
	await until(() => again.screen().join("\n").includes("the chart · 64×40"), 5000, "the answer's picture after reopening");
	await again.stop();
	await t.h.close();
});

test("tui: on a terminal with the Kitty graphics protocol the real picture is sent", mac, async () => {
	const before = getCapabilities();
	setCapabilities({ ...before, images: "kitty" });
	try {
		const t = await open({ agents: { main: {} } });
		await t.sees("type a message");
		fs.writeFileSync(path.join(t.h.workspace("main"), "chart.png"), png(64, 40));
		await t.send(mockMsg([{ text: "![the chart](chart.png)" }]));
		await t.sees("the chart · 64×40 · click to enlarge");
		t.app.screen();
		assert.ok(t.term.written.includes("\x1b_G"), "a Kitty graphics command was written");
		assert.ok(!t.text().includes("▀"));
		await t.close();
	} finally {
		setCapabilities(before);
	}
});

test("tui: a menu opened over a real picture is not covered by it; the picture is drawn as text until the menu closes", mac, async () => {
	const before = getCapabilities();
	setCapabilities({ ...before, images: "kitty" });
	try {
		const t = await open({ agents: { main: {} } });
		await t.sees("type a message");
		// pine's welcome stands above an empty main conversation: in a new one the menu lies over the picture.
		await t.send("/new pics");
		await t.sees("session pics");
		fs.writeFileSync(path.join(t.h.workspace("main"), "chart.png"), png(64, 40));
		await t.send(mockMsg([{ text: "![the chart](chart.png)" }]));
		await t.sees("the chart · 64×40 · click to enlarge");
		const raw = () => (t.app.screen(), t.app.tui.getScreenLines());
		const real = (lines: string[]) => lines.filter((l) => l.includes("\x1b_G")).length;
		assert.equal(real(raw()), 1, "the real picture is on screen");
		assert.ok(!t.text().includes("▀"));

		// The list of conversations opens in the middle of the screen, across the picture.
		await t.send("/sessions");
		await t.sees("│ Conversations of main");
		const under = raw();
		assert.equal(real(under), 0, "no real picture lies under the menu");
		const shown = t.app.screen();
		assert.ok(shown.some((l) => l.includes("▀") && /[╭│]/.test(l)), "the menu really is over the picture, which is still there as text");
		const title = shown.findIndex((l) => l.includes("Conversations of main"));
		const bottom = shown.findIndex((l) => l.includes("╰"));
		assert.ok(shown.slice(title, bottom).every((l) => (l.match(/│/g) ?? []).length === 2), "every line of the menu is whole");

		// Closing the menu brings the real picture back.
		t.term.type([KEY.esc]);
		await until(() => !t.text().includes("Conversations of main"), 3000, "the menu to close");
		assert.equal(real(raw()), 1, "the real picture is back");
		assert.ok(!t.text().includes("▀"));
		await t.close();
	} finally {
		setCapabilities(before);
	}
});

const ffmpeg = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"].find((f) => fs.existsSync(f));

test("tui: a video plays by itself when it arrives, at the size it is shown; pause, play, enlarge and the player are separate clicks", { skip: !ffmpeg }, async () => {
	const { execFileSync } = await import("node:child_process");
	const opened: string[] = [];
	const h = await harness({ pine: { main: "main", http: { port: 0 } }, agents: { main: {} } });
	const term = new FakeTerminal(110, 60);
	const client = new Client(`http://127.0.0.1:${h.pine.http!.port}`, h.pine.token);
	const app = new PineTui({ client, terminal: term, openFile: (f) => void opened.push(f) });
	apps.push(app);
	await app.start();
	const text = () => app.screen().join("\n");
	const sees = (what: string | RegExp, ms = 6000) => until(() => (typeof what === "string" ? text().includes(what) : what.test(text())), ms, `the screen to show ${what}\n${text()}`);
	const ws = h.workspace("main");
	// A second and a half of a test pattern, 160 by 90.
	execFileSync(ffmpeg!, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=10", "-t", "1.5", "-pix_fmt", "yuv420p", path.join(ws, "clip.mp4")]);
	fs.writeFileSync(path.join(ws, "fake.mp4"), "this is only named like a video");

	// The daemon serves real video files from the workspace, and nothing that only has the name.
	assert.equal((await client.workspaceImage("main", "clip.mp4"))?.mime, "video/mp4");
	assert.equal(await client.workspaceImage("main", "fake.mp4"), undefined);

	const blocks = () => text().split("▀").length - 1;
	const caption = () => app.screen().find((l) => l.includes("test pattern ·")) ?? "";
	const row = () => app.screen().findIndex((l) => l.includes("test pattern ·"));
	const clickWord = (word: string) => term.click(caption().indexOf(word) + 1, row());

	// It arrives and plays by itself, in the room a thumbnail takes.
	term.type(mockMsg([{ text: "Here is the clip: ![test pattern](clip.mp4)" }]));
	term.type([KEY.enter]);
	await sees(/‖ pause · test pattern · 0:00 \/ 0:01 · no sound · click the picture to enlarge\s+▸ open in player/);
	await until(() => blocks() > 0, 3000, "a frame");
	const small = blocks();
	assert.ok(small <= 44 * 14 && small % 44 === 0, `frames are thumbnail-sized (${small})`);

	// Pause holds the frame; play goes on from there.
	clickWord("‖ pause");
	await sees(/▶ play · test pattern · 0:00 \/ 0:01/);
	const held = text();
	await sleep(350);
	assert.equal(text(), held, "nothing moves while it is paused");
	clickWord("▶ play");
	await sees("‖ pause");
	await sees(/▶ play · test pattern · 0:01 · click the picture to enlarge/, 8000);
	assert.equal(blocks(), small, "at the end the still is back, the same size");

	// A click on the picture enlarges it and does not start it. Play then plays it large.
	term.click(6, row() - 2);
	await sees("click the picture to shrink");
	await until(() => blocks() > small, 3000, "the larger still");
	assert.match(caption(), /▶ play/);
	const large = blocks();
	clickWord("▶ play");
	await sees("‖ pause");
	await until(() => /0:00 \/ 0:01/.test(caption()) && blocks() >= large, 3000, "large frames");
	// Shrinking while it plays keeps it playing.
	term.click(6, row() - 2);
	await sees("click the picture to enlarge");
	assert.match(caption(), /‖ pause|▶ play/);
	await sees(/▶ play · test pattern · 0:01 · click the picture to enlarge/, 8000);

	// "open in player" hands over a file with the video in it.
	clickWord("open in player");
	await until(() => opened.length === 1, 2000, "the player to be asked");
	assert.ok(fs.readFileSync(opened[0]).equals(fs.readFileSync(path.join(ws, "clip.mp4"))));
	const kept = opened[0];
	await app.stop();
	assert.ok(!fs.existsSync(kept), "the copy made for playing is removed when the UI closes");

	// Reopened later, the video is there but waits for a click.
	const again = new PineTui({ client, terminal: new FakeTerminal(110, 60) });
	apps.push(again);
	await again.start();
	await until(() => again.screen().join("\n").includes("▶ play · test pattern · 0:01"), 6000, "the video after reopening");
	await sleep(300);
	assert.ok(!again.screen().join("\n").includes("‖ pause"));
	await again.stop();
	await h.close();
});

/** A tone in a wav file: how high, and how loud against the loudest a file can hold. Further tones follow the first. */
type Tone = [hz: number, loud: number];

/**
 * A wav file, 8000 samples a second in one channel of 16 bits unless said otherwise. Without
 * tones it is silence; `sounding` is one tone, several at once, or a list of such parts that
 * follow one another and share the time.
 */
function wav(seconds: number, sounding: Tone | Tone[] | Tone[][] = [], how: { rate?: number; channels?: number; bits?: 16 | 24 | 32; tag?: number } = {}): Buffer {
	const { rate = 8000, channels = 1, bits = 16, tag = bits === 32 ? 3 : 1 } = how;
	const parts: Tone[][] = !sounding.length ? [[]] : typeof sounding[0] === "number" ? [[sounding as Tone]] : typeof (sounding[0] as Tone | Tone[])[0] === "number" ? [sounding as Tone[]] : (sounding as Tone[][]);
	const count = Math.round(seconds * rate);
	const width = bits / 8;
	const data = Buffer.alloc(count * width * channels);
	for (let i = 0; i < count; i++) {
		let v = 0;
		for (const [hz, loud] of parts[Math.min(parts.length - 1, Math.floor((i / count) * parts.length))]) v += loud * Math.sin((2 * Math.PI * hz * i) / rate);
		for (let ch = 0; ch < channels; ch++) {
			const at = (i * channels + ch) * width;
			if (bits === 32) data.writeFloatLE(v, at);
			else data.writeIntLE(Math.round(v * (2 ** (bits - 1) - 1)), at, width);
		}
	}
	const head = Buffer.alloc(44);
	head.write("RIFF", 0, "latin1");
	head.writeUInt32LE(36 + data.length, 4);
	head.write("WAVEfmt ", 8, "latin1");
	head.writeUInt32LE(16, 16);
	head.writeUInt16LE(tag, 20);
	head.writeUInt16LE(channels, 22);
	head.writeUInt32LE(rate, 24);
	head.writeUInt32LE(rate * width * channels, 28);
	head.writeUInt16LE(width * channels, 32);
	head.writeUInt16LE(bits, 34);
	head.write("data", 36, "latin1");
	head.writeUInt32LE(data.length, 40);
	return Buffer.concat([head, data]);
}

/** A file handed over in pieces of an odd size, as a decoder's output arrives. */
async function* pieces(b: Buffer, size = 1021): AsyncGenerator<Buffer> {
	for (let at = 0; at < b.length; at += size) yield b.subarray(at, at + size);
}
/** The band a frequency lies in, for a file with that many samples a second. */
const bandOf = (hz: number, rate: number) => bandEdges(rate).findIndex((edge) => edge > hz) - 1;
/** The bands of a row, and which of them is the loudest. */
const rowOf = (levels: { data: Uint8Array }, row: number) => [...levels.data.subarray(row * BANDS, (row + 1) * BANDS)];
const loudest = (levels: { data: Uint8Array }, row: number) => rowOf(levels, row).indexOf(Math.max(...rowOf(levels, row)));
const FLAT = "▁".repeat(BANDS);

test("sound: the levels of a tone lie in the band of its frequency, and silence is flat", async () => {
	// One tone: a row for every tenth of a second, and in each the tone's band stands out alone.
	const tone = (await levelsOf(pieces(wav(1, [1000, 0.5]))))!;
	assert.equal(`${tone.rows} rows of ${tone.bands}, ${tone.step} s each`, "10 rows of 24, 0.1 s each");
	const at = bandOf(1000, 8000);
	assert.ok(at > 10 && at < 20, `1000 Hz lies in the middle of the row (${at})`);
	for (let row = 0; row < tone.rows; row++) {
		assert.equal(loudest(tone, row), at, `row ${row}`);
		assert.equal(rowOf(tone, row)[at], 255);
		assert.ok(rowOf(tone, row).every((v, band) => Math.abs(band - at) <= 2 || v === 0), `nothing far from the tone (row ${row}: ${rowOf(tone, row)})`);
	}
	assert.equal(bars(tone, 0.3), `${"▁".repeat(at)}█${"▁".repeat(BANDS - at - 1)}`);
	assert.equal(bars(tone, -1), FLAT, "before the start the bars lie flat");
	assert.equal(bars(tone, 1.2), FLAT, "and after the end");

	// Silence is a row of nothing, however long.
	const silence = (await levelsOf(pieces(wav(0.5))))!;
	assert.equal(silence.rows, 5);
	assert.ok(silence.data.every((v) => v === 0));
	assert.equal(bars(silence, 0.2), FLAT);

	// The bars are measured against the sound's own loudest moment: a quiet recording moves as much
	// as a loud one, and a tone 20 decibels under another stands about half as high.
	const quiet = (await levelsOf(pieces(wav(0.3, [1000, 0.004]))))!;
	assert.equal(rowOf(quiet, 1)[at], 255);
	const two = (await levelsOf(pieces(wav(0.3, [[500, 0.5], [2000, 0.05]]))))!;
	assert.equal(rowOf(two, 1)[bandOf(500, 8000)], 255);
	const lower = rowOf(two, 1)[bandOf(2000, 8000)];
	assert.ok(lower > 100 && lower < 170, `the lower tone (${lower})`);

	// Tones that follow one another are found one after the other, and a bar that lost its tone falls, not drops.
	const then = (await levelsOf(pieces(wav(1, [[[500, 0.5]], [[2000, 0.5]]]))))!;
	assert.deepEqual([loudest(then, 2), loudest(then, 8)], [bandOf(500, 8000), bandOf(2000, 8000)]);
	const falling = [5, 6, 7].map((row) => rowOf(then, row)[bandOf(500, 8000)]);
	assert.ok(falling[0] < 255 && falling[0] > falling[1] && falling[1] > falling[2], `the bar of the tone that ended (${falling})`);

	// Other kinds of wav file say the same: two channels of 24 bits at 44100 samples a second, and floating point.
	for (const how of [{ rate: 44100, channels: 2, bits: 24 as const }, { rate: 22050, bits: 32 as const }]) {
		const other = (await levelsOf(pieces(wav(0.4, [3000, 0.3], how), 4099)))!;
		assert.equal(other.rows, 4);
		assert.equal(loudest(other, 2), bandOf(3000, how.rate), JSON.stringify(how));
	}
	// Bare samples, as a decoder writes them, are read without a header.
	const bare = (await levelsOf(pieces(wav(0.3, [1000, 0.5]).subarray(44)), { rate: 8000, channels: 1, bits: 16, float: false }))!;
	assert.equal(loudest(bare, 1), at);

	// What is not samples has no levels: text, a wav file whose sound is compressed, and nothing at all.
	assert.equal(await levelsOf(pieces(Buffer.from("this is only named like a sound"))), undefined);
	assert.equal(await levelsOf(pieces(wav(0.3, [1000, 0.5], { tag: 2 }))), undefined);
	assert.equal(await levelsOf(pieces(Buffer.alloc(0))), undefined);
	assert.equal(await levelsOf(pieces(wav(0))), undefined);
});

test("sound: a file that is not a wav file is decoded for its levels, and one that nothing can decode has none", async (t) => {
	const { execFileSync } = await import("node:child_process");
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-levels-test-")));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const source = path.join(dir, "tone.wav");
	fs.writeFileSync(source, wav(1, [1000, 0.5], { rate: 16000 }));
	const at = bandOf(1000, 16000);
	assert.equal(loudest((await soundLevels(source, []))!, 5), at, "a wav file needs no decoder");
	// ffmpeg, wherever it is installed. flac is a kind every ffmpeg writes.
	if (ffmpeg) {
		execFileSync(ffmpeg, ["-loglevel", "error", "-i", source, path.join(dir, "tone.flac")]);
		const levels = await soundLevels(path.join(dir, "tone.flac"), ["ffmpeg"]);
		assert.ok(levels && levels.rows === 10, `ffmpeg decodes it (${levels?.rows} rows)`);
		assert.equal(loudest(levels, 5), at);
		assert.equal(await soundLevels(path.join(dir, "tone.flac"), []), undefined, "without a decoder there are no levels");
	}
	// macOS's own converter, which is there without ffmpeg.
	if (process.platform === "darwin" && fs.existsSync("/usr/bin/afconvert")) {
		execFileSync("/usr/bin/afconvert", ["-f", "m4af", "-d", "aac", source, path.join(dir, "tone.m4a")]);
		const levels = await soundLevels(path.join(dir, "tone.m4a"), ["afconvert"]);
		assert.ok(levels && levels.rows >= 10 && levels.rows <= 11, `afconvert decodes it (${levels?.rows} rows)`);
		assert.equal(loudest(levels, 5), at);
		assert.ok(!fs.readdirSync(os.tmpdir()).some((f) => f.startsWith("pine-snd-")), "the decoded copy is removed");
	}
	fs.writeFileSync(path.join(dir, "fake.mp3"), "this is only named like a sound");
	assert.equal(await soundLevels(path.join(dir, "fake.mp3")), undefined);
	assert.equal(await soundLevels(path.join(dir, "missing.mp3")), undefined);
});

test("sound: the line shows the levels as bars that follow the clock while it plays; none without levels or without room", async (t) => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-bars-test-")));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	// A stand-in for the player, which "plays" for a while and can start in the middle.
	const script = path.join(dir, "player.mjs");
	fs.writeFileSync(script, "setTimeout(() => {}, 4000);\n");
	const player = { command: [process.execPath, script], from: (s: number) => [s.toFixed(1)] };
	const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
	// The first second is a low tone, the second a high one.
	fs.writeFileSync(path.join(dir, "two.wav"), wav(2, [[[500, 0.5]], [[2000, 0.5]]]));
	const [low, high] = [bandOf(500, 8000), bandOf(2000, 8000)];
	/** The bars a line shows, and which of them stands highest. */
	const shown = (text: string) => /^ (?:‖ pause|▶ play) {2}([▁▂▃▄▅▆▇█]{8,24}) {2}♪/.exec(plain(text))?.[1];
	const top = (text: string) => shown(text)?.indexOf("█");
	const prepared = await prepareSound(path.join(dir, "two.wav"), "two tones");
	await prepared.measured;
	assert.equal(prepared.levels?.rows, 20);
	let redraws = 0;
	const opened: string[] = [];
	const sound = new Sound(prepared, player, () => void redraws++, (f) => void opened.push(f));
	t.after(() => sound.stop());
	const line = (width = 100) => sound.render(width)[0];
	const click = (word: string) => sound.handleMouse({ button: "left", type: "click", x: plain(line()).indexOf(word) + 1, y: 0 });

	// Before it plays the bars lie flat, in grey.
	assert.equal(plain(line()), ` ▶ play  ${FLAT}  ♪ two tones · 0:02   ▸ open in player`);
	assert.ok(line().includes(c.gray(FLAT)));

	// Playing: the bars are the levels at the place the clock is at, in the accent color, and the line is drawn again ten times a second.
	sound.play();
	assert.equal(top(line()), low, plain(line()));
	assert.ok(line().includes(c.accent(bars(prepared.levels!, 0))));
	assert.match(plain(line()), /^ ‖ pause {2}\S{24} {2}♪ two tones · 0:00 \/ 0:02 {3}▸ open in player$/);
	const before = redraws;
	await sleep(450);
	assert.ok(redraws - before >= 2, `drawn again as the bars move, not twice a second (${redraws - before} times in 450 ms)`);

	// A narrower terminal has fewer bars, each for several bands; one with room for fewer than eight has the line without them.
	assert.equal(shown(line(80))?.length, 24, "80 columns are just enough for all of them");
	assert.equal(shown(line(79))?.length, 23);
	assert.deepEqual([shown(line(64))?.length, top(line(64))], [8, Math.floor(low / 3)], "eight bars, three bands each");
	assert.equal(plain(line(64)).length, 64);
	assert.match(plain(line(63)), /^ ‖ pause · ♪ two tones · 0:00 \/ 0:02 {3}▸ open in player$/);

	// A pause holds them where they are.
	click("‖ pause");
	assert.equal(sound.state, "paused");
	const held = line();
	assert.ok(top(held) === low && held.includes(c.accent(shown(held)!)), plain(held));
	await sleep(300);
	assert.equal(line(), held, "nothing moves during a pause");

	// Going on, the clock reaches the second tone, and the bars are that one's.
	click("▶ play");
	assert.equal(sound.state, "playing");
	await until(() => top(line()) === high, 3000, "the bars of the second tone");
	assert.match(plain(line()), /♪ two tones · 0:01 \/ 0:02/);

	// "open in player" is found behind the bars, and at the end the bars lie flat again.
	click("▸ open in player");
	assert.deepEqual(opened, [path.join(dir, "two.wav")]);
	assert.equal(sound.state, "playing", "a click on the bars or the name does nothing");
	sound.stop();
	assert.equal(plain(line()), ` ▶ play  ${FLAT}  ♪ two tones · 0:02   ▸ open in player`);

	// A file that nothing can decode plays (or not) as before, and its line has no bars.
	fs.writeFileSync(path.join(dir, "odd.mp3"), "this is only named like a sound");
	const odd = await prepareSound(path.join(dir, "odd.mp3"), "odd one");
	await odd.measured;
	assert.equal(odd.levels, undefined);
	const bare = new Sound(odd, player, () => {}, () => {});
	t.after(() => bare.stop());
	assert.equal(plain(bare.render(100)[0]), " ▶ play · ♪ odd one   ▸ open in player");
	bare.play();
	assert.equal(plain(bare.render(100)[0]), " ‖ pause · ♪ odd one · 0:00   ▸ open in player");
});

test("tui: a sound an answer points at is played when it arrives, by the system's player; pause and play go on where it was", { skip: process.platform === "win32" && "the stand-in player is found and held with ps and SIGSTOP, which Windows does not have" }, async (t) => {
	const { execFileSync } = await import("node:child_process");
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-sound-test-")));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	// A stand-in for the player: it notes its process, where it was told to start, the file and its
	// size, and "plays" for a while.
	const log = path.join(dir, "played.txt");
	const script = path.join(dir, "player.mjs");
	fs.writeFileSync(script, `import fs from "node:fs";\nconst [log, ms, ...rest] = process.argv.slice(2);\nconst file = rest.pop();\nfs.appendFileSync(log, [process.pid, rest[0] ?? "-", file, fs.statSync(file).size].join(" ") + "\\n");\nsetTimeout(() => {}, Number(ms));\n`);
	const played = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((l) => l.split(" ")) : []);
	// Whether a stand-in player is still there, found by its script: the number it noted is its own
	// only where it shares the system's process numbers (on Linux it runs in a sandbox with its own).
	// A process that has ended and was not reaped yet ("Z") is gone too.
	const states = () => execFileSync("/bin/sh", ["-c", "ps -A -o state=,command="], { encoding: "utf8" }).split("\n").map((l) => /^\s*(\S+)\s+(.*)$/.exec(l)).filter((m) => m && m[2].startsWith(process.execPath) && m[2].includes(script)).map((m) => m![1][0]).filter((c) => c !== "Z");
	const playing = () => states().length > 0;
	const seeking = { command: [process.execPath, script, log, "900"], from: (s: number) => [s.toFixed(1)] };
	const opened: string[] = [];
	const h = await harness({ pine: { main: "main", http: { port: 0 } }, agents: { main: {} } });
	const term = new FakeTerminal(110, 40);
	const client = new Client(`http://127.0.0.1:${h.pine.http!.port}`, h.pine.token);
	const app = new PineTui({ client, terminal: term, openFile: (f) => void opened.push(f), soundPlayer: seeking });
	apps.push(app);
	await app.start();
	const text = () => app.screen().join("\n");
	const sees = (what: string | RegExp, ms = 6000) => until(() => (typeof what === "string" ? text().includes(what) : what.test(text())), ms, `the screen to show ${what}\n${text()}`);
	const ws = h.workspace("main");
	const sound = wav(2);
	fs.writeFileSync(path.join(ws, "hello.wav"), sound);
	fs.writeFileSync(path.join(ws, "fake.wav"), "this is only named like a sound");
	fs.writeFileSync(path.join(ws, "text.mp3"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("notes in another encoding", "utf16le")]));

	// The daemon serves real sound files from the workspace, and nothing that only has the name.
	const served = await client.workspaceImage("main", "hello.wav");
	assert.ok(served?.mime === "audio/wav" && served.bytes.equals(sound));
	assert.equal(await client.workspaceImage("main", "fake.wav"), undefined);
	assert.equal(await client.workspaceImage("main", "text.mp3"), undefined);

	const line = () => app.screen().find((l) => l.includes("♪ hello world")) ?? "";
	const clickWord = (word: string) => term.click(line().indexOf(word) + 1, app.screen().findIndex((l) => l.includes("♪ hello world")));

	// It arrives and is played from the start: the player gets the file's bytes, and the line says how far it is.
	// The file is silence, so the bars beside the control lie flat.
	term.type(mockMsg([{ text: "Here it is: ![hello world](hello.wav) and ![gone](nope.wav)" }]));
	term.type([KEY.enter]);
	await sees(new RegExp(`‖ pause  ${FLAT}  ♪ hello world · 0:00 / 0:02\\s+▸ open in player`));
	await until(() => played().length === 1, 3000, "the player to start");
	assert.deepEqual(played()[0].slice(1, 2), ["0.0"]);
	assert.equal(played()[0].at(-1), String(sound.length));
	assert.match(played()[0].at(-2)!, /\.wav$/);
	assert.ok(text().includes("(no sound file at nope.wav in the workspace)"), text());

	// Pause ends the player and keeps the place; play starts one from there, not from the beginning.
	await sleep(300);
	clickWord("‖ pause");
	await sees(`▶ play  ${FLAT}  ♪ hello world · 0:00 / 0:02`);
	await until(() => !playing(), 3000, "the player to be gone");
	await sleep(1100);
	assert.ok(line().includes(`▶ play  ${FLAT}  ♪ hello world · 0:00 / 0:02`), "the pause outlasts the player's own time, and nothing moves");
	clickWord("▶ play");
	await sees(`‖ pause  ${FLAT}  ♪ hello world`);
	await until(() => played().length === 2, 3000, "a player to go on");
	const from = Number(played()[1][1]);
	assert.ok(from >= 0.3 && from < 0.9, `it goes on where it was (${from})`);

	// When the player is done, the line is back at the start, and a click plays it from there.
	await sees(new RegExp(`▶ play  ${FLAT}  ♪ hello world · 0:02\\s+▸ open in player`));
	clickWord("▶ play");
	await until(() => played().length === 3, 3000, "the player to start again");
	assert.equal(played()[2][1], "0.0");
	clickWord("▸ open in player");
	await until(() => opened.length === 1, 3000, "the player to be handed the file");
	assert.ok(fs.readFileSync(opened[0]).equals(sound));

	// Closing the UI ends what is playing.
	await app.stop();
	await until(() => !playing(), 3000, "the player to be gone");

	// A player that cannot start in the middle is held at a pause and let go again. And a sound from
	// earlier in the conversation waits for a click: opening the conversation plays nothing.
	const term2 = new FakeTerminal(110, 40);
	const again = new PineTui({ client, terminal: term2, soundPlayer: { command: [process.execPath, script, log, "900"] } });
	apps.push(again);
	await again.start();
	const line2 = () => again.screen().find((l) => l.includes("♪ hello world")) ?? "";
	const click2 = (word: string) => term2.click(line2().indexOf(word) + 1, again.screen().findIndex((l) => l.includes("♪ hello world")));
	await until(() => line2().includes(`▶ play  ${FLAT}  ♪ hello world`), 6000, "the conversation to be drawn again");
	await sleep(200);
	assert.equal(played().length, 3, "nothing plays by itself that was there before");
	click2("▶ play");
	await until(() => played().length === 4, 3000, "the player to start");
	assert.equal(played()[3][1], "-", "it is given the file alone");
	click2("‖ pause");
	await until(() => states()[0] === "T", 3000, "the player to be held");
	click2("▶ play");
	await until(() => /^[SR]/.test(states()[0] ?? ""), 3000, "the player to go on");
	assert.equal(played().length, 4, "the same player");
	await again.stop();
	await h.close();
});

test("tui: on a terminal with the Kitty graphics protocol a video plays as real pictures, each frame replacing the last", { skip: !ffmpeg }, async () => {
	const { execFileSync } = await import("node:child_process");
	const { pngFromRgb } = await import("../src/tui/picture.ts");
	// The frame encoder writes a valid png: a decoder reads it back with the right size.
	const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "pine-png-"));
	fs.writeFileSync(path.join(dir, "f.png"), pngFromRgb(new Uint8Array(6 * 4 * 3).fill(200), 6, 4));
	assert.equal(execFileSync(path.join(path.dirname(ffmpeg!), "ffprobe"), ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", path.join(dir, "f.png")]).toString().trim(), "6,4");
	fs.rmSync(dir, { recursive: true, force: true });

	const before = getCapabilities();
	setCapabilities({ ...before, images: "kitty" });
	try {
		const t = await open({ agents: { main: {} } });
		await t.sees("type a message");
		// pine's welcome stands above an empty main conversation: in a new one the menu lies over the video.
		await t.send("/new pics");
		await t.sees("session pics");
		execFileSync(ffmpeg!, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=10", "-t", "1", "-pix_fmt", "yuv420p", path.join(t.h.workspace("main"), "clip.mp4")]);
		await t.send(mockMsg([{ text: "![test pattern](clip.mp4)" }]));
		await t.sees("‖ pause · test pattern");
		// A menu over a paused frame: the frame is drawn as text under it, and is a real picture again afterwards.
		const raw = () => (t.app.screen(), t.app.tui.getScreenLines());
		t.term.click(2, t.app.screen().findIndex((l) => l.includes("‖ pause · test pattern")));
		await t.sees(/▶ play · test pattern · 0:0\d \/ /);
		assert.ok(raw().some((l) => l.includes("\x1b_G")), "the paused frame is a real picture");
		await t.send("/sessions");
		await t.sees("│ Conversations of main");
		const under = raw();
		const shown = t.app.screen();
		assert.ok(shown.some((l) => l.includes("▀") && /[╭│]/.test(l)), "the menu is over the video");
		assert.ok(!under.some((l) => l.includes("\x1b_G")) && t.text().includes("▀"), "the frame is text while the menu is over it");
		t.term.type([KEY.esc]);
		await until(() => !t.text().includes("Conversations of main"), 3000, "the menu to close");
		assert.ok(raw().some((l) => l.includes("\x1b_G")) && !t.text().includes("▀"), "the real frame is back");
		t.term.click(2, t.app.screen().findIndex((l) => l.includes("▶ play · test pattern")));
		// Count the pictures sent while it plays, and under which image ids.
		const sent = new Map<string, number>();
		let seen = 0;
		const collect = () => {
			t.app.screen();
			const fresh = t.term.written.slice(seen);
			seen = t.term.written.length;
			for (const m of fresh.matchAll(/\x1b_Ga=T[^;]*?i=(\d+)/g)) sent.set(m[1], (sent.get(m[1]) ?? 0) + 1);
			assert.ok(!t.text().includes("▀"), "no half blocks on a terminal that shows real pictures");
		};
		await until(() => (collect(), t.text().includes("▶ play · test pattern · 0:01")), 8000, "the video to play to its end");
		const most = Math.max(...sent.values());
		assert.ok(most >= 5, `frames were sent as pictures under one image id (${[...sent.values()].join(", ")})`);
		await t.close();
	} finally {
		setCapabilities(before);
	}
});

test("pictures: the daemon answers a range of a sound or a video with that part alone", async () => {
	const h = await harness({ pine: { main: "main", http: { port: 0 } }, agents: { main: {} } });
	const sound = wav(1);
	fs.writeFileSync(path.join(h.workspace("main"), "hello.wav"), sound);
	const at = `http://127.0.0.1:${h.pine.http!.port}/agents/main/image?path=hello.wav`;
	const get = (range?: string) => fetch(at, { headers: { authorization: `Bearer ${h.pine.token}`, ...(range ? { range } : {}) } });

	// Without a range: the whole file, and word that a part can be asked for.
	const whole = await get();
	assert.equal(whole.status, 200);
	assert.equal(whole.headers.get("accept-ranges"), "bytes");
	assert.ok(Buffer.from(await whole.arrayBuffer()).equals(sound));

	// A part from the middle, from an offset to the end, the last bytes, and a part that runs past the end.
	const total = sound.length;
	const parts: [string, number, number][] = [["bytes=100-199", 100, 199], [`bytes=${total - 10}-`, total - 10, total - 1], ["bytes=-16", total - 16, total - 1], [`bytes=50-${total + 500}`, 50, total - 1]];
	for (const [range, from, to] of parts) {
		const part = await get(range);
		assert.equal(part.status, 206, range);
		assert.equal(part.headers.get("content-range"), `bytes ${from}-${to}/${total}`, range);
		assert.equal(part.headers.get("content-length"), String(to - from + 1), range);
		assert.equal(part.headers.get("content-type"), "audio/wav", range);
		assert.equal(part.headers.get("cache-control"), "no-store", range);
		assert.equal(part.headers.get("x-content-type-options"), "nosniff", range);
		assert.ok(Buffer.from(await part.arrayBuffer()).equals(sound.subarray(from, to + 1)), range);
	}

	// A range past the end cannot be had.
	const beyond = await get(`bytes=${total}-`);
	assert.equal(beyond.status, 416);
	assert.equal(beyond.headers.get("content-range"), `bytes */${total}`);
	await beyond.arrayBuffer();

	// What is not one plain range of bytes is answered with the whole file, as HTTP allows.
	for (const range of ["bytes=0-1,5-9", "items=0-9", "bytes=9-3", "bytes=x-"]) {
		const got = await get(range);
		assert.equal(got.status, 200, range);
		assert.ok(Buffer.from(await got.arrayBuffer()).equals(sound), range);
	}

	// Still only for the owner, and still only real media.
	assert.equal((await fetch(at, { headers: { range: "bytes=0-9" } })).status, 401);
	fs.writeFileSync(path.join(h.workspace("main"), "fake.wav"), "this is only named like a sound");
	assert.equal((await fetch(at.replace("hello.wav", "fake.wav"), { headers: { authorization: `Bearer ${h.pine.token}`, range: "bytes=0-9" } })).status, 404);
});
