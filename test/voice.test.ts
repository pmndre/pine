import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "../src/tui/client.ts";
import { PineTui } from "../src/tui/app.ts";
import { buildVoice, buildVoiceWindows, Listening, NO_COMPILER, NO_CSC, NOT_HERE, VOICE_CS, VOICE_LINUX, VOICE_SOURCE, voiceTools } from "../src/tui/voice.ts";
import { Chunker, findWhisper, type Look, linuxVoice, modelFolder, pickModel, spoken, wavHeader, whisperArgs, whisperLanguage } from "../src/tui/voice-linux.ts";
import { harness, sleep, until } from "./support/harness.ts";
import { FakeTerminal, KEY } from "./support/terminal.ts";

const CTRL_R = "\x12";
const tmp = (t: { after(fn: () => void): void }) => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-voice-")));
	t.after(() => {
		try {
			fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
		} catch {
			// Windows still holds a program that just ended: the temp folder is left, which is no part of a test.
		}
	});
	return dir;
};

// A stand-in for the helper, for any system: it "hears" the lines of a script, one every few
// milliseconds, and ends with the last word when its input is closed, as the helper does.
const HELPER = `const [script, log] = process.argv.slice(1);
const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const steps = JSON.parse(require("fs").readFileSync(script, "utf8"));
if (log) require("fs").appendFileSync(log, process.argv.slice(3).join(" ") + "\\n");
let heard = "", i = 0;
const timer = setInterval(() => { const s = steps[i++]; if (!s) return clearInterval(timer); if (s.text !== undefined) heard = s.text; say(s); if (s.type === "error" || s.type === "final") process.exit(s.type === "error" ? 1 : 0); if (s.die) process.exit(3); }, 25);
process.stdin.on("data", () => {});
process.stdin.on("end", () => { clearInterval(timer); setTimeout(() => { say({ type: "final", text: heard }); process.exit(0); }, 40); });`;
function standIn(dir: string, steps: any[], log?: string) {
	const script = path.join(dir, `steps-${Math.random().toString(36).slice(2)}.json`);
	fs.writeFileSync(script, JSON.stringify(steps));
	return [process.execPath, "-e", HELPER, script, ...(log ? [log] : [])];
}
const heard = (command: string[], language?: string) => {
	const log: string[] = [];
	let result: { text?: string; error?: string } | undefined;
	const l = new Listening(command, language, { ready: () => log.push("ready"), model: (s) => log.push(`model ${s}`), partial: (t) => log.push(`partial ${t}`), done: (text, error) => (result = { text, error }) });
	return { l, log, done: async () => (await until(() => result, 5000, "listening to end"), result!) };
};

// A Linux as the search sees it: these files can be run or listed, and nothing else is there.
const linuxWith = (files: string[], env: NodeJS.ProcessEnv = {}): Look => ({
	env: { PATH: "/usr/bin:bin:/home/o/bin", LANG: "en_US.UTF-8", ...env },
	home: "/home/o",
	runs: (f) => files.includes(f),
	list: (d) => files.filter((f) => path.posix.dirname(f) === d).map((f) => path.posix.basename(f)),
});
const LINUX_ALL = ["/usr/bin/parecord", "/home/o/.local/bin/whisper-cli", "/home/o/.local/share/pine/voice/ggml-base.en.bin"];

test("voice: each system has its own way, and where a piece is missing it is said in a sentence and nothing is built or started", async (t) => {
	const dir = tmp(t);
	for (const platform of ["freebsd", "openbsd", "android"]) {
		const tools = voiceTools(platform, dir);
		assert.equal(tools.unavailable, NOT_HERE);
		await assert.rejects(() => tools.program(), (e: Error) => e.message === NOT_HERE);
	}
	// Windows without the C# compiler it carries: what to switch on.
	const windows = voiceTools("win32", dir, { compiler: null });
	assert.equal(windows.unavailable, NO_CSC);
	await assert.rejects(() => windows.program(), /C# compiler of \.NET Framework 4/);
	assert.equal(voiceTools("win32", dir, { compiler: path.join(dir, "csc.exe") }).unavailable, undefined, "with the compiler there is voice input; nothing is built before it is wanted");
	// Linux with nothing installed: what to install, by package name and folder, and that nothing is downloaded.
	const bare = voiceTools("linux", dir, { look: linuxWith([]) });
	assert.match(bare.unavailable!, /^Voice input on Linux recognises speech on this computer with whisper\.cpp/);
	assert.match(bare.unavailable!, /sudo apt install pulseaudio-utils \(or alsa-utils\)/);
	assert.match(bare.unavailable!, /git clone https:\/\/github\.com\/ggml-org\/whisper\.cpp/);
	assert.match(bare.unavailable!, /a speech model in ~\/\.local\/share\/pine\/voice: ggml-base\.en\.bin for English or ggml-base\.bin for every language, from https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp/);
	assert.match(bare.unavailable!, /pine downloads none of it by itself\.$/);
	await assert.rejects(() => bare.program(), /Voice input on Linux/);
	// Only the piece that is missing is named.
	const noModel = voiceTools("linux", dir, { look: linuxWith(LINUX_ALL.slice(0, 2)) }).unavailable!;
	assert.ok(noModel.includes("a speech model") && !noModel.includes("apt install pulseaudio") && !noModel.includes("git clone"), noModel);
	// Everything there: the helper is started on Node with the absolute paths that were found.
	const linux = voiceTools("linux", dir, { look: linuxWith(LINUX_ALL), node: "/usr/bin/node" });
	assert.equal(linux.unavailable, undefined);
	assert.deepEqual(await linux.program(), ["/usr/bin/node", VOICE_LINUX, "--recorder", "/usr/bin/parecord", "--whisper", "/home/o/.local/bin/whisper-cli", "--model", "/home/o/.local/share/pine/voice/ggml-base.en.bin"]);
	assert.deepEqual(fs.readdirSync(dir), [], "nothing was written");
	assert.equal(voiceTools("darwin", dir).unavailable, undefined);
	for (const source of [VOICE_SOURCE, VOICE_CS, VOICE_LINUX]) assert.ok(fs.existsSync(source), `${path.basename(source)} ships with pine`);
});

test("voice: on Linux, whisper.cpp, the recorder and the model are found by absolute path in the usual places, and the model fits the language", () => {
	// On PATH, never by a relative entry of it; the recorder PulseAudio's before ALSA's.
	assert.equal(findWhisper(linuxWith(["/home/o/bin/whisper-cli"])), "/home/o/bin/whisper-cli");
	assert.equal(findWhisper(linuxWith(["bin/whisper-cli"])), undefined);
	assert.equal(findWhisper(linuxWith(["/usr/bin/whisper-cpp"])), "/usr/bin/whisper-cpp");
	assert.equal(linuxVoice(linuxWith(["/usr/bin/arecord", "/usr/bin/parecord"])).recorder, "/usr/bin/parecord");
	assert.equal(linuxVoice(linuxWith(["/usr/bin/arecord"])).recorder, "/usr/bin/arecord");
	assert.equal(linuxVoice(linuxWith(["/usr/bin/pw-record", "/usr/bin/sox"])).recorder, undefined, "only recorders whose raw output pine knows");
	// A build of whisper.cpp in the home folder; its `main` only where it is older than whisper-cli (newer ones only say it is deprecated).
	assert.equal(findWhisper(linuxWith(["/home/o/whisper.cpp/build/bin/whisper-cli", "/home/o/whisper.cpp/build/bin/main"])), "/home/o/whisper.cpp/build/bin/whisper-cli");
	assert.equal(findWhisper(linuxWith(["/home/o/whisper.cpp/main"])), "/home/o/whisper.cpp/main");
	assert.equal(findWhisper(linuxWith(["/usr/bin/main"])), undefined, "a program called main elsewhere is not whisper.cpp's");
	// The folder for models follows XDG_DATA_HOME, and whisper-cli may lie there too.
	const xdg = linuxWith(["/data/pine/voice/whisper-cli"], { XDG_DATA_HOME: "/data" });
	assert.equal(modelFolder(xdg), "/data/pine/voice");
	assert.equal(findWhisper(xdg), "/data/pine/voice/whisper-cli");
	assert.equal(modelFolder(linuxWith([], { XDG_DATA_HOME: "relative" })), "/home/o/.local/share/pine/voice");
	// The language: from the one asked for, or the system's.
	assert.equal(whisperLanguage("de-DE"), "de");
	assert.equal(whisperLanguage(undefined, { LANG: "fr_FR.UTF-8" }), "fr");
	assert.equal(whisperLanguage(undefined, { LC_ALL: "C.UTF-8", LANG: "de_DE.UTF-8" }), "auto");
	assert.equal(whisperLanguage(undefined, {}), "auto");
	// English first for English, all languages first for the others; base before the slow sizes; never a model for something else.
	const models = ["ggml-large-v3.bin", "ggml-base.bin", "ggml-base.en.bin", "ggml-tiny.en.bin", "ggml-silero-v5.1.2.bin", "notes.txt"];
	assert.equal(pickModel(models, "en"), "ggml-base.en.bin");
	assert.equal(pickModel(models, "de"), "ggml-base.bin");
	assert.equal(pickModel(["ggml-tiny.en.bin"], "de"), "ggml-tiny.en.bin", "whisper.cpp hears English with it, which is better than nothing");
	assert.equal(pickModel(["notes.txt", "ggml-silero-v5.1.2.bin"], "en"), undefined);
	assert.equal(linuxVoice(linuxWith([...LINUX_ALL, "/home/o/.local/share/pine/voice/ggml-small.bin"], { LANG: "de_DE.UTF-8" })).model, "/home/o/.local/share/pine/voice/ggml-small.bin");
	// whisper-cli is told the text alone: no times, no report of its own.
	assert.deepEqual(whisperArgs("/m.bin", "/p.wav", "de", 2), ["-m", "/m.bin", "-f", "/p.wav", "-l", "de", "-nt", "-np", "-t", "2"]);
});

test("voice: on Linux, what is recorded is cut where the speaker pauses, silence is not handed on, and whisper's notes are not words", () => {
	// 50 ms of a tone at a level, or of silence, as 16-bit samples at 16 kHz.
	const tone = (secs: number, amp: number) => {
		const b = Buffer.alloc(Math.round(secs * 16000) * 2);
		for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(amp * Math.sin(i / 3)), i * 2);
		return b;
	};
	const pieces: number[] = [];
	const c = new Chunker((pcm) => pieces.push(pcm.length / 32000));
	// Said for two seconds, a pause: one piece. Silence: nothing. Then talk without a pause: cut at six seconds at most.
	c.push(Buffer.concat([tone(2, 4000), tone(0.5, 20)]));
	assert.deepEqual(pieces, [2.35]);
	c.push(tone(3, 20));
	assert.deepEqual(pieces, [2.35], "silence is not recognised: whisper.cpp would make up words for it");
	pieces.length = 0;
	// In odd sizes, as a recorder hands it over.
	const talk = Buffer.concat([tone(3, 4000), tone(0.1, 30), tone(4, 4000)]);
	for (let i = 0; i < talk.length; i += 1234) c.push(talk.subarray(i, i + 1234));
	assert.equal(pieces.length, 1);
	assert.ok(pieces[0] <= 6 && pieces[0] >= 5, `cut within the last second before six seconds: ${pieces[0]}`);
	c.end();
	assert.equal(pieces.length, 2, "the rest is the last piece");
	// All of the talk is in the two (with at most the silence before it that was not yet dropped): nothing is lost at a cut.
	assert.ok(pieces[0] + pieces[1] >= 7.1 && pieces[0] + pieces[1] < 8.6, String(pieces));
	// A WAV file's header that whisper.cpp reads: 16-bit, one channel, 16 kHz.
	const h = wavHeader(32000);
	assert.equal(h.toString("ascii", 0, 4), "RIFF");
	assert.equal(h.toString("ascii", 8, 16), "WAVEfmt ");
	assert.deepEqual([h.readUInt16LE(20), h.readUInt16LE(22), h.readUInt32LE(24), h.readUInt16LE(34), h.readUInt32LE(40)], [1, 1, 16000, 16, 32000]);
	assert.equal(spoken("\n [BLANK_AUDIO]\n And so, my fellow Americans,\n (music)\n ask not [laughs] what\n *coughs*\n"), "And so, my fellow Americans, ask not what");
});
test("voice: the helper is built once, with its reasons for listening inside it, and a Mac without the tools is told what to install", async (t) => {
	const dir = tmp(t);
	const source = path.join(dir, "voice.swift");
	fs.writeFileSync(source, "// one");
	const calls: string[][] = [];
	const tools = path.join(dir, "CommandLineTools");
	const run = (compiles: boolean, installed = true) => async (file: string, args: string[]) => {
		calls.push([path.basename(file), ...args]);
		if (file.endsWith("xcode-select")) return installed ? (fs.mkdirSync(tools, { recursive: true }), { code: 0, stdout: `${tools}\n`, stderr: "" }) : { code: 2, stdout: "", stderr: "no developer tools" };
		const info = args[args.indexOf("__info_plist") + 2];
		// What the system shows the owner when it asks is in the program at the moment it is linked.
		assert.match(fs.readFileSync(info, "utf8"), /NSMicrophoneUsageDescription[\s\S]*NSSpeechRecognitionUsageDescription[\s\S]*recognised on this Mac/);
		if (compiles) fs.writeFileSync(args[args.indexOf("-o") + 1], "binary");
		return compiles ? { code: 0, stdout: "", stderr: "" } : { code: 1, stdout: "", stderr: "voice.swift:3:1: error: cannot find 'Speech' in scope\nnote: x" };
	};
	const out = path.join(dir, "built");
	await assert.rejects(() => buildVoice(out, source, run(true, false)), (e: Error) => e.message === NO_COMPILER);
	await assert.rejects(() => buildVoice(out, source, run(false)), /could not build the voice input helper \(voice\.swift:3:1: error: cannot find 'Speech' in scope\)/);
	assert.deepEqual(fs.existsSync(out) ? fs.readdirSync(out) : [], [], "a build that failed leaves nothing");
	const first = await buildVoice(out, source, run(true));
	assert.match(path.basename(first), /^pine-voice-[0-9a-f]{12}$/);
	const link = calls.at(-1)!;
	assert.deepEqual(link.slice(0, 5), ["swiftc", "-swift-version", "5", "-O", "-o"]);
	assert.deepEqual(link.slice(7, 14), ["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker"]);
	const n = calls.length;
	assert.equal(await buildVoice(out, source, run(true)), first);
	assert.equal(calls.length, n, "found again, not built again");
	// Another source (an update of pine) is another program, and the old one goes.
	fs.writeFileSync(source, "// two");
	const second = await buildVoice(out, source, run(true));
	assert.notEqual(second, first);
	assert.deepEqual(fs.readdirSync(out), [path.basename(second)]);
});

// Stand-ins for the programs of a Linux: a recorder that "hears" two sentences with a pause after
// each and then silence until it is asked to end, and a whisper-cli that names the piece it was
// given. Each writes what it was started with into a log. Scripts with a #! line: not on Windows.
function linuxStandIns(dir: string, opts: { recorderFails?: boolean; whisperFails?: boolean } = {}) {
	const log = path.join(dir, "calls.log");
	const recorder = path.join(dir, "parecord");
	const whisper = path.join(dir, "whisper-cli");
	const model = path.join(dir, "ggml-base.en.bin");
	fs.writeFileSync(model, "a model");
	const script = (body: string) => `#!${process.execPath}\nconst fs = require("fs");\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");\n${body}`;
	fs.writeFileSync(
		recorder,
		script(
			opts.recorderFails
				? `process.stderr.write("Connection failure: Connection refused\\n"); process.exit(1);`
				: `const tone = (s, a) => { const b = Buffer.alloc(s * 32000); for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(a * Math.sin(i / 3)), i * 2); return b; };
process.on("SIGINT", () => process.exit(0));
process.stdout.write(Buffer.concat([tone(2, 5000), tone(0.5, 10), tone(2, 5000), tone(0.5, 10)]));
setInterval(() => process.stdout.write(tone(0.1, 10)), 100);`,
		),
	);
	fs.writeFileSync(
		whisper,
		script(
			opts.whisperFails
				? `process.stderr.write("whisper_init_from_file_with_params_no_state: failed to load model\\nerror: failed to initialize whisper context\\n"); process.exit(3);`
				: `const wav = fs.readFileSync(process.argv[process.argv.indexOf("-f") + 1]);
const ok = wav.toString("ascii", 0, 4) === "RIFF" && wav.readUInt32LE(24) === 16000 && wav.readUInt16LE(22) === 1 && wav.readUInt32LE(40) === wav.length - 44;
const n = (fs.existsSync(${JSON.stringify(log)}) ? fs.readFileSync(${JSON.stringify(log)}, "utf8").split("\\n").filter((l) => l.includes("-nt")).length : 0) - 1;
process.stdout.write("\\n [BLANK_AUDIO]\\n " + (ok ? "sentence " + n : "a broken file") + "\\n");`,
		),
	);
	fs.chmodSync(recorder, 0o755);
	fs.chmodSync(whisper, 0o755);
	const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]) : []);
	return { command: [process.execPath, VOICE_LINUX, "--recorder", recorder, "--whisper", whisper, "--model", model], recorder, whisper, model, calls };
}

test("voice: on Linux, the helper records, has whisper-cli recognise each piece, and says what it has after each, in the Mac's lines", { skip: process.platform === "win32" && "the stand-ins are scripts with a #! line" }, async (t) => {
	const dir = tmp(t);
	const s = linuxStandIns(dir);
	const h = heard(s.command, "de-DE");
	await until(() => h.log.includes("partial sentence 0 sentence 1"), 8000, `two sentences\n${h.log.join("\n")}`);
	assert.deepEqual(h.log, ["ready", "partial sentence 0", "partial sentence 0 sentence 1"], "the silence after them was not handed to whisper");
	h.l.stop();
	assert.deepEqual(await h.done(), { text: "sentence 0 sentence 1", error: undefined });
	const [rec, ...pieces] = s.calls();
	assert.deepEqual(rec, ["--raw", "--format=s16le", "--rate=16000", "--channels=1", "--latency-msec=100"]);
	assert.equal(pieces.length, 2);
	for (const p of pieces) {
		assert.deepEqual([p[0], p[1], p[2], p[4], p[5], p[6], p[7], p[8]], ["-m", s.model, "-f", "-l", "de", "-nt", "-np", "-t"]);
		assert.ok(path.isAbsolute(p[p.indexOf("-f") + 1]));
		assert.ok(!fs.existsSync(p[p.indexOf("-f") + 1]), "a piece is removed once it was recognised");
	}

	// A recording instead of the microphone: the whole of it at once.
	const wav = path.join(dir, "said.wav");
	fs.writeFileSync(wav, Buffer.concat([wavHeader(3200), Buffer.alloc(3200)]));
	const f = heard([...s.command, "--file", wav]);
	assert.deepEqual(await f.done(), { text: "sentence 2", error: undefined });
	assert.equal(s.calls().at(-1)![s.calls().at(-1)!.indexOf("-f") + 1], wav);
	assert.equal(s.calls().at(-1)![s.calls().at(-1)!.indexOf("-l") + 1], whisperLanguage(undefined, process.env), "the system's language, without one asked for");
});

test("voice: on Linux, a recorder or a whisper-cli that fails is said in a sentence", { skip: process.platform === "win32" && "the stand-ins are scripts with a #! line" }, async (t) => {
	const dir = tmp(t);
	const bad = linuxStandIns(dir, { recorderFails: true });
	const r = await heard(bad.command).done();
	assert.equal(r.text, undefined);
	assert.match(r.error!, /^the sound could not be recorded \(parecord: Connection failure: Connection refused\)\. Check that a microphone is connected/);
	const dir2 = tmp(t);
	const deaf = linuxStandIns(dir2, { whisperFails: true });
	const w = await heard(deaf.command).done();
	assert.match(w.error!, /^whisper\.cpp could not recognise what was said \(.*failed to initialize whisper context\)\. Check that .*ggml-base\.en\.bin is a whisper\.cpp model/);
	// Started without what it needs (an older UI, a hand): it says so and starts nothing.
	const none = await heard([process.execPath, VOICE_LINUX, "--recorder", "parecord", "--whisper", deaf.whisper, "--model", deaf.model]).done();
	assert.match(none.error!, /started without the programs it needs/);
});

test("voice: on Windows the helper is built once from voice.cs with System.Speech, by the compiler Windows carries", { skip: process.platform === "win32" && "the real compiler is used on Windows, in the test below" }, (t) => {
	const dir = tmp(t);
	const log = path.join(dir, "csc.log");
	const compiler = path.join(dir, "csc.exe");
	fs.writeFileSync(compiler, `#!${process.execPath}\nconst fs = require("fs");\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");\nconst out = process.argv.find((a) => a.startsWith("/out:"));\nfs.writeFileSync(out.slice(5), "exe");\n`);
	fs.chmodSync(compiler, 0o755);
	const built = path.join(dir, "built");
	const exe = buildVoiceWindows(built, { compiler });
	assert.match(path.basename(exe), /^pine-voice-[0-9a-f]{12}\.exe$/);
	const [args] = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
	assert.ok(args.some((a) => /^\/reference:.*System\.Speech\.dll$/.test(a)), args.join(" "));
	assert.equal(args.at(-1), VOICE_CS);
	assert.equal(buildVoiceWindows(built, { compiler }), exe);
	assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").length, 1, "found again, not built again");
	assert.deepEqual(fs.readdirSync(built), [path.basename(exe)]);
});

test("voice: on Windows the real helper recognises a spoken recording on the device, and a language without a recogniser is said", { skip: process.platform !== "win32" && "Windows only" }, async (t) => {
	const dir = tmp(t);
	const { execFileSync } = await import("node:child_process");
	const exe = buildVoiceWindows(dir);
	const status = JSON.parse(execFileSync(exe, ["--check"], { encoding: "utf8", windowsHide: true }).trim().split("\n").pop()!);
	assert.equal(status.type, "status");
	// A language Windows has no desktop recogniser for: the sentence names the setting.
	const swahili = await heard([exe], "sw-KE").done();
	assert.match(swahili.error ?? "", /no speech recogniser (for sw-KE )?on this computer[\s\S]*Settings > Time & language/);
	const english = (status.installed as string[]).find((l) => /^en-/i.test(l));
	if (!english) return t.skip(`this Windows has no English speech recogniser (it has: ${status.installed.join(", ") || "none"})`);
	const wav = path.join(dir, "said.wav");
	const say = "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono); $s.SetOutputToWaveFile($env:PINE_SAID, $f); $s.Speak('Please list the bills in my scans folder.'); $s.Dispose()";
	try {
		execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", say], { env: { ...process.env, PINE_SAID: wav }, windowsHide: true, stdio: "pipe" });
	} catch (e) {
		return t.skip(`this Windows could not speak the sentence to recognise (${String((e as { stderr?: unknown }).stderr ?? e).trim().slice(0, 200)})`);
	}
	const got = await heard([exe, "--file", wav], english).done();
	const words = ["list", "bills", "scans", "folder"].filter((w) => new RegExp(w, "i").test(got.text ?? ""));
	assert.ok(words.length >= 2, `recognised: ${got.text ?? `error: ${got.error}`}`);
});

test("voice: what is heard arrives as it is heard, ends when the listening is ended, and is text and nothing else", async (t) => {
	const dir = tmp(t);
	const log = path.join(dir, "args.log");
	// Said so far, then all of it when the input is closed. The language goes to the helper.
	let h = heard(standIn(dir, [{ type: "ready" }, { type: "partial", text: "list the" }, { type: "partial", text: "list the bills" }], log), "de-DE");
	await until(() => h.log.includes("partial list the bills"), 3000, "the words");
	assert.deepEqual(h.log, ["ready", "partial list the", "partial list the bills"]);
	assert.ok(h.l.active);
	h.l.stop();
	assert.deepEqual(await h.done(), { text: "list the bills", error: undefined });
	assert.ok(!h.l.active);
	assert.equal(fs.readFileSync(log, "utf8").trim(), "--locale de-DE");
	// Words from a microphone are shown in a terminal: nothing in them moves the cursor or colors the screen.
	h = heard(standIn(dir, [{ type: "partial", text: "delete\x1b[2J all\nof  it\x07" }]));
	await until(() => h.log.length === 1, 3000, "the words");
	assert.equal(h.log[0], "partial delete [2J all of it");
	h.l.cancel();
	assert.deepEqual(await h.done(), { text: undefined, error: undefined }, "thrown away: nothing comes of it");
	// It cannot listen: the helper's sentence is what the owner reads.
	h = heard(standIn(dir, [{ type: "model", state: "downloading" }, { type: "error", code: "microphone", message: "pine may not use the microphone. Allow it in System Settings." }]));
	assert.deepEqual(await h.done(), { text: undefined, error: "pine may not use the microphone. Allow it in System Settings." });
	assert.deepEqual(h.log, ["model downloading"]);
	// A helper that ends without a last word: what it had heard is kept.
	h = heard(standIn(dir, [{ type: "partial", text: "half a sentence", die: true }]));
	assert.deepEqual(await h.done(), { text: "half a sentence", error: undefined });
	// And a program that is not there is an error, not a crash.
	h = heard([path.join(dir, "no-such-program")]);
	assert.match((await h.done()).error!, /voice input could not be started/);
});

test("voice: ctrl+r dictates into the message, after what was typed; enter ends the listening and sends nothing; esc throws it away; where a piece is missing it says so", async (t) => {
	const dir = tmp(t);
	const h = await harness({ pine: { main: "main", http: { port: 0 } }, agents: { main: {} } } as any);
	const open = async (voice: any) => {
		const term = new FakeTerminal(110, 30);
		const app = new PineTui({ client: new Client(`http://127.0.0.1:${h.pine.http!.port}`, h.pine.token), terminal: term, mode: "test", voice });
		await app.start();
		const text = () => app.screen().join("\n");
		const sees = (what: string | RegExp, ms = 4000) => until(() => (typeof what === "string" ? text().includes(what) : what.test(text())), ms, `the screen to show ${what}\n--- screen ---\n${text()}`);
		return { term, app, text, sees };
	};
	const said = [{ type: "ready" }, { type: "partial", text: "which bill" }, { type: "partial", text: "which bill is due first" }];
	let ui = await open({ program: async () => standIn(dir, said) });
	await ui.sees("type a message");
	const tasks = () => h.pine.tasks.list({}).length;

	ui.term.type("About the scans:");
	ui.term.type([CTRL_R]);
	await ui.sees("● listening · speak · enter when you are done · esc to throw it away");
	await ui.sees("About the scans: which bill is due first");
	// Enter ends the listening. The words stay in the input to be read; nothing has been sent.
	ui.term.type([KEY.enter]);
	await until(() => !/listening|finishing/.test(ui.text()), 4000, "the listening to end");
	await ui.sees("About the scans: which bill is due first");
	await sleep(150);
	assert.equal(tasks(), 0, "what was heard is not sent by itself");
	// It is text like typed text: more is typed, and enter sends it.
	ui.term.type("?");
	ui.term.type([KEY.enter]);
	await ui.sees("ECHO[About the scans: which bill is due first?]");
	assert.equal(tasks(), 1);

	// The microphone at the right end of the input does the same with a click: one starts the listening, one ends it.
	const mic = () => {
		const lines = ui.app.screen();
		const y = lines.findIndex((l) => l.includes("🎤"));
		assert.ok(y >= 0, `a microphone on the screen\n${ui.text()}`);
		return { y, x: lines[y].indexOf("🎤"), line: lines[y] };
	};
	assert.ok(!ui.app.screen()[0].includes("🎤"), "not in the tab bar");
	assert.match(mic().line, /^ {10,}🎤$/, "at the right end of the input's line, which is empty");
	assert.match(ui.app.screen()[mic().y - 1], /^─+$/, "the line above the input runs on over it");
	ui.term.click(mic().x, mic().y);
	await ui.sees("● listening · speak");
	await until(() => /^ which bill is due first +🎤$/.test(mic().line), 3000, "the words in the input, the microphone after them");
	// (One cell further: two clicks on one spot are a double click, which is no second click.)
	ui.term.click(mic().x + 1, mic().y);
	await until(() => !/● (listening|finishing)/.test(ui.text()), 4000, "the click to end the listening");
	await sleep(120);
	assert.equal(tasks(), 1, "and it sends nothing either");
	ui.term.type([KEY.enter]);
	await ui.sees("ECHO[which bill is due first]");

	// Thrown away with esc: what was typed before is there again, and nothing of what was heard.
	ui.term.type("keep this");
	ui.term.type([CTRL_R]);
	await ui.sees("keep this which bill is due first");
	ui.term.type([KEY.esc]);
	await until(() => !ui.text().includes("listening"), 3000, "the listening to end");
	await sleep(120);
	assert.ok(/^ keep this +🎤$/.test(ui.app.screen().find((l) => l.includes("keep this")) ?? "") && !ui.text().includes("keep this which"), ui.text());
	assert.equal(tasks(), 2);
	await ui.app.stop();

	// It cannot listen: the reason is shown, and the input is as it was.
	ui = await open({ program: async () => standIn(dir, [{ type: "error", code: "microphone", message: "pine may not use the microphone. Allow it in System Settings > Privacy & Security > Microphone." }]) });
	await ui.sees("type a message");
	ui.term.type("typed");
	ui.term.type([CTRL_R]);
	await ui.sees("pine may not use the microphone. Allow it in System Settings");
	assert.ok(ui.text().includes("typed"));
	await ui.app.stop();

	// A Linux without whisper.cpp: the key and the command say what to install, nothing is started, and pine goes on working.
	let started = 0;
	const linux = voiceTools("linux", dir, { look: linuxWith([]) });
	ui = await open({ ...linux, program: () => (started++, linux.program()) });
	await ui.sees("type a message");
	assert.ok(ui.text().includes("▤ code") && !ui.text().includes("🎤"), "no microphone is offered where there is none to use");
	ui.term.type([CTRL_R]);
	await ui.sees("Voice input on Linux");
	ui.term.type("/voice");
	ui.term.type([KEY.enter]);
	await ui.sees("Voice input on Linux");
	assert.equal(started, 0);
	ui.term.type("still here");
	ui.term.type([KEY.enter]);
	await ui.sees("ECHO[still here]");
	await ui.app.stop();
	await h.close();
});

test("voice: dictating never holds the input: a typed key ends it, and so does enter before it has begun to listen", async (t) => {
	const dir = tmp(t);
	const h = await harness({ pine: { main: "main", http: { port: 0 } }, agents: { main: {} } } as any);
	const open = async (voice: any) => {
		const term = new FakeTerminal(110, 30);
		const app = new PineTui({ client: new Client(`http://127.0.0.1:${h.pine.http!.port}`, h.pine.token), terminal: term, mode: "test", voice });
		await app.start();
		const text = () => app.screen().join("\n");
		const sees = (what: string | RegExp, ms = 4000) => until(() => (typeof what === "string" ? text().includes(what) : what.test(text())), ms, `the screen to show ${what}\n--- screen ---\n${text()}`);
		return { term, app, text, sees };
	};
	// It goes on hearing, word after word. What is typed meanwhile must not be overwritten by the next word.
	const talking = [{ type: "ready" }, { type: "partial", text: "one" }, ...Array.from({ length: 40 }, (_, i) => ({ type: "partial", text: `one two ${i}` }))];
	let ui = await open({ program: async () => standIn(dir, talking) });
	await ui.sees("type a message");
	ui.term.type([CTRL_R]);
	await ui.sees("● listening");
	await ui.sees(/one two \d+ +🎤/);
	ui.term.type("!");
	await until(() => !/● (listening|finishing)/.test(ui.text()), 3000, "the typed key to end the listening");
	const typed = ui.app.screen().find((l) => l.includes("one two") && l.includes("!")) ?? "";
	assert.match(typed, /one two \d+!/, "what was heard stays, and the key is typed after it");
	await sleep(250);
	assert.ok((ui.app.screen().find((l) => l.includes("one two") && l.includes("!")) ?? "") === typed, "and nothing that is heard later is put over it");
	ui.term.type([KEY.enter]);
	await ui.sees(/ECHO\[one two \d+!\]/);
	await ui.app.stop();

	// A helper that never gets to listen (the system is waiting for an answer about the microphone): enter gets out of it.
	ui = await open({ program: async () => [process.execPath, "-e", "setInterval(() => {}, 1000)"] });
	await ui.sees("type a message");
	ui.term.type([CTRL_R]);
	await ui.sees("● getting ready to listen");
	ui.term.type([KEY.enter]);
	await until(() => !ui.text().includes("getting ready to listen"), 3000, "enter to end what never began");
	ui.term.type("still here");
	ui.term.type([KEY.enter]);
	await ui.sees("ECHO[still here]");
	await ui.app.stop();
	await h.close();
});

test("live: voice: the real helper recognises a spoken sentence on this Mac", { skip: process.platform !== "darwin" || !process.env.PINE_LIVE }, async (t) => {
	const dir = tmp(t);
	const { execFileSync } = await import("node:child_process");
	const audio = path.join(dir, "said.aiff");
	execFileSync("/usr/bin/say", ["-o", audio, "Please list the bills in my scans folder."]);
	const program = await voiceTools().program();
	const h = heard([...program, "--file", audio], "en-US");
	const got = await h.done();
	assert.match(got.text ?? `error: ${got.error}`, /list the bills in my scans folder/i);
});

test("live: voice: whisper.cpp recognises a spoken sentence on this Linux", { skip: (process.platform !== "linux" || !process.env.PINE_LIVE) && "Linux, with PINE_LIVE=1" }, async (t) => {
	const tools = voiceTools();
	if (tools.unavailable) return t.skip(tools.unavailable);
	if (!fs.existsSync("/usr/bin/espeak-ng")) return t.skip("the sentence is spoken with espeak-ng: sudo apt install espeak-ng");
	const dir = tmp(t);
	const { execFileSync } = await import("node:child_process");
	const audio = path.join(dir, "said.wav");
	execFileSync("/usr/bin/espeak-ng", ["-w", audio, "Open the file and read it to me."]);
	const got = await heard([...(await tools.program()), "--file", audio], "en-US").done();
	assert.match(got.text ?? `error: ${got.error}`, /open the file and read it/i);
});
