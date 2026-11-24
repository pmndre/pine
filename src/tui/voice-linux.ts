// Dictating a message on Linux: the words are recognised on this computer by whisper.cpp's
// command line program, from what a sound recorder of the system hears. Linux has no speech
// recognition of its own, so pine uses what the owner installed, and nothing else: it finds the
// recorder, whisper-cli and a model file by their absolute paths, starts each by its path with
// fixed arguments (never through a shell), and downloads nothing. Where a piece is missing,
// `linuxVoice()` says in a sentence what to install, and nothing is started.
//
// The helper (voice-whisper.ts, started by the UI like voice.swift on a Mac) speaks the same lines
// of JSON as the Mac's: it records without a pause, cuts what it hears into pieces of a few
// seconds where the speaker pauses, has whisper-cli turn each piece into text, and says what it
// has so far after each. When its input is closed it does the last piece and says all of it.
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { posix as path } from "node:path";

/** What the search sees of this computer. A test hands in one of its own. */
export interface Look {
	env: NodeJS.ProcessEnv;
	home: string;
	/** Whether this is a file that may be run. */
	runs(file: string): boolean;
	/** The names in a folder; none when there is no such folder. */
	list(dir: string): string[];
}

export const thisComputer = (): Look => ({
	env: process.env,
	home: os.homedir(),
	runs: (file) => {
		try {
			fs.accessSync(file, fs.constants.X_OK);
			return fs.statSync(file).isFile();
		} catch {
			return false;
		}
	},
	list: (dir) => {
		try {
			return fs.readdirSync(dir);
		} catch {
			return [];
		}
	},
});

/** Where the owner puts a model for whisper.cpp (and, if they like, whisper-cli or a link to it). */
export const modelFolder = (look: Pick<Look, "env" | "home">) => {
	const data = look.env.XDG_DATA_HOME && path.isAbsolute(look.env.XDG_DATA_HOME) ? look.env.XDG_DATA_HOME : path.join(look.home, ".local", "share");
	return path.join(data, "pine", "voice");
};

/** The folders of PATH that are absolute, then the system's own, each once. */
function searched(look: Look): string[] {
	const fromPath = (look.env.PATH ?? "").split(":").filter((d) => path.isAbsolute(d));
	return [...new Set([...fromPath, "/usr/local/bin", "/usr/bin", "/bin"])];
}

/** The first of `names` in the first of `dirs` that has one, as an absolute path. */
export function findProgram(names: string[], dirs: string[], look: Look): string | undefined {
	for (const dir of dirs) for (const name of names) if (look.runs(path.join(dir, name))) return path.join(dir, name);
	return undefined;
}

/**
 * How each recorder writes what the microphone hears to its output: raw 16-bit samples, one
 * channel, 16 kHz, which is what whisper.cpp reads. In this order: PulseAudio's (which PipeWire
 * answers too) records from the input the owner chose in the sound settings; ALSA's from the default device.
 */
export const RECORDERS: Record<string, string[]> = {
	parecord: ["--raw", "--format=s16le", "--rate=16000", "--channels=1", "--latency-msec=100"],
	arecord: ["-q", "-t", "raw", "-f", "S16_LE", "-c", "1", "-r", "16000"],
};

/** whisper.cpp's program: whisper-cli, or `whisper-cpp` as some systems name it; `main` only where a build of whisper.cpp that is older than that name left it. */
export function findWhisper(look: Look): string | undefined {
	const builds = [path.join(look.home, "whisper.cpp", "build", "bin"), path.join(look.home, "whisper.cpp"), "/opt/whisper.cpp/build/bin", "/opt/whisper.cpp"];
	const named = findProgram(["whisper-cli", "whisper-cpp"], [modelFolder(look), path.join(look.home, ".local", "bin"), ...searched(look), ...builds], look);
	if (named) return named;
	// A newer build has a `main` too, which only says that it is deprecated: it is taken only where no whisper-cli lies beside it.
	for (const dir of builds) if (!look.runs(path.join(dir, "whisper-cli")) && look.runs(path.join(dir, "main"))) return path.join(dir, "main");
	return undefined;
}

/** The language whisper.cpp is told, from a language like "de-DE" or the system's ("de_DE.UTF-8"); "auto" lets it find out. */
export function whisperLanguage(locale: string | undefined, env: NodeJS.ProcessEnv = {}): string {
	const said = locale ?? env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG ?? "";
	const m = /^([a-zA-Z]{2,3})(?:[-_.@]|$)/.exec(said);
	return m && !/^(c|posix)$/i.test(m[1]) ? m[1].toLowerCase() : "auto";
}

const SIZES = ["base", "small", "tiny", "medium", "turbo", "large"];
/**
 * The model to use of those in the folder (`ggml-<size>[.en].bin`, as whisper.cpp names them): for
 * English an English one first, for another language one that knows all; of those, the size that
 * recognises well and still keeps up while one speaks.
 */
export function pickModel(names: string[], language: string): string | undefined {
	const models = names.filter((n) => /^ggml-.+\.bin$/.test(n) && !/silero|vad/i.test(n));
	const english = language === "en" || language === "auto";
	const rank = (n: string) => {
		const only = /\.en\.bin$|\.en[.-]/.test(n) ? 1 : 0;
		const size = SIZES.findIndex((s) => n.startsWith(`ggml-${s}`));
		return (english ? 1 - only : only) * 100 + (size < 0 ? SIZES.length : size);
	};
	return models.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0];
}

export interface LinuxVoice {
	recorder?: string;
	whisper?: string;
	model?: string;
	/** Why there is no voice input, in a sentence for the owner; undefined when every piece is there. */
	missing?: string;
}

const tilde = (p: string, home: string) => (p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p);

/** What this Linux has of the three pieces, and the sentence that says what to install where one is missing. */
export function linuxVoice(look: Look = thisComputer()): LinuxVoice {
	const recorder = findProgram(Object.keys(RECORDERS), searched(look), look);
	const whisper = findWhisper(look);
	const folder = modelFolder(look);
	const found = pickModel(look.list(folder), whisperLanguage(undefined, look.env));
	const model = found && path.join(folder, found);
	const lack: string[] = [];
	if (!recorder) lack.push("a program that records sound: sudo apt install pulseaudio-utils (or alsa-utils)");
	if (!whisper) lack.push("whisper.cpp's whisper-cli, which Ubuntu does not package: sudo apt install git cmake build-essential, then git clone https://github.com/ggml-org/whisper.cpp, in its folder cmake -B build and cmake --build build --config Release, and link build/bin/whisper-cli into ~/.local/bin");
	if (!model) lack.push(`a speech model in ${tilde(folder, look.home)}: ggml-base.en.bin for English or ggml-base.bin for every language, from https://huggingface.co/ggerganov/whisper.cpp`);
	if (!lack.length) return { recorder, whisper, model };
	return { recorder, whisper, model, missing: `Voice input on Linux recognises speech on this computer with whisper.cpp, and it needs ${lack.join("; and ")}. Then try again. pine downloads none of it by itself.` };
}

/** What whisper-cli is started with for one piece of sound: the text alone on its output, without times or its own report. */
export const whisperArgs = (model: string, wav: string, language: string, threads = Math.max(1, Math.min(4, os.availableParallelism?.() ?? 4))) => ["-m", model, "-f", wav, "-l", language, "-nt", "-np", "-t", String(threads)];

/** whisper-cli's output as the words that were said: its notes for what is no speech ("[BLANK_AUDIO]", "(music)") are left out. */
export function spoken(out: string): string {
	return out
		.split(/\r?\n/)
		.map((l) => l.replace(/\[[^\]]*\]/g, " ").trim())
		.filter((l) => l && !/^\([^)]*\)$/.test(l) && !/^\*[^*]*\*$/.test(l))
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
}

const RATE = 16000;

/** A WAV file's header for `bytes` of 16-bit samples, one channel, 16 kHz. */
export function wavHeader(bytes: number): Buffer {
	const h = Buffer.alloc(44);
	h.write("RIFF", 0, "ascii");
	h.writeUInt32LE(36 + bytes, 4);
	h.write("WAVEfmt ", 8, "ascii");
	h.writeUInt32LE(16, 16);
	h.writeUInt16LE(1, 20);
	h.writeUInt16LE(1, 22);
	h.writeUInt32LE(RATE, 24);
	h.writeUInt32LE(RATE * 2, 28);
	h.writeUInt16LE(2, 32);
	h.writeUInt16LE(16, 34);
	h.write("data", 36, "ascii");
	h.writeUInt32LE(bytes, 40);
	return h;
}

const FRAME = (RATE / 20) * 2; // 50 ms of samples, in bytes

const level = (f: Buffer) => {
	let sum = 0;
	for (let i = 0; i + 1 < f.length; i += 2) {
		const s = f.readInt16LE(i);
		sum += s * s;
	}
	return Math.sqrt(sum / Math.max(1, f.length / 2));
};

/**
 * Cuts a stream of samples into pieces where the speaker pauses: a piece ends after `min` seconds
 * at the first pause of `pause` seconds, and at `max` seconds at its quietest moment of the last
 * second. A piece in which nobody spoke is dropped: whisper.cpp makes up words for silence.
 */
export class Chunker {
	private frames: Buffer[] = [];
	private levels: number[] = [];
	private carry = Buffer.alloc(0);
	private still = 0;
	private cut: (pcm: Buffer) => void;
	private o: { min: number; max: number; pause: number; quiet: number; speech: number };

	constructor(cut: (pcm: Buffer) => void, o: Partial<Chunker["o"]> = {}) {
		this.cut = cut;
		this.o = { min: 1.5, max: 6, pause: 0.35, quiet: 350, speech: 550, ...o };
	}

	push(data: Buffer): void {
		let buf = this.carry.length ? Buffer.concat([this.carry, data]) : data;
		while (buf.length >= FRAME) {
			this.frame(Buffer.from(buf.subarray(0, FRAME)));
			buf = buf.subarray(FRAME);
		}
		this.carry = Buffer.from(buf);
	}

	/** The end of the sound: what is left is the last piece. */
	end(): void {
		if (this.carry.length >= 2) this.frame(this.carry);
		this.carry = Buffer.alloc(0);
		this.give(this.frames.length);
	}

	private frame(f: Buffer): void {
		const l = level(f);
		this.frames.push(f);
		this.levels.push(l);
		this.still = l < this.o.quiet ? this.still + 1 : 0;
		const secs = this.frames.length / 20;
		if (secs >= this.o.min && this.still / 20 >= this.o.pause) this.give(this.frames.length);
		else if (secs >= this.o.max) {
			// At the quietest moment of the last second, so that a word is cut as rarely as can be.
			let at = this.frames.length - 1;
			for (let i = this.frames.length - 1; i >= Math.max(1, this.frames.length - 20); i--) if (this.levels[i] < this.levels[at]) at = i;
			this.give(at + 1);
		}
	}

	private give(n: number): void {
		const frames = this.frames.splice(0, n);
		const levels = this.levels.splice(0, n);
		this.still = 0;
		if (frames.length && levels.some((l) => l >= this.o.speech)) this.cut(Buffer.concat(frames));
	}
}

/** Text that came from another program, made fit for a line the owner reads. */
const said = (s: string) => s.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(-300);

function run(file: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
	return new Promise((resolve) => {
		let out = "";
		let err = "";
		let child: ChildProcess;
		try {
			child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] });
		} catch (e) {
			resolve({ code: -1, out: "", err: e instanceof Error ? e.message : String(e) });
			return;
		}
		running.add(child);
		child.stdout?.on("data", (d: Buffer) => (out += d.toString("utf8")));
		child.stderr?.on("data", (d: Buffer) => (err = (err + d.toString("utf8")).slice(-2000)));
		child.on("error", (e) => (running.delete(child), resolve({ code: -1, out, err: e.message })));
		child.on("close", (code) => (running.delete(child), resolve({ code: code ?? -1, out, err })));
	});
}
const running = new Set<ChildProcess>();

/**
 * The helper: listens until its input is closed, as voice.swift does, and writes the same lines.
 * `--recorder`, `--whisper` and `--model` are absolute paths the UI found (`linuxVoice`);
 * `--locale` the language; `--file <wav>` reads a recording instead of the microphone.
 */
export async function listen(args: string[]): Promise<void> {
	const arg = (name: string) => {
		const i = args.indexOf(name);
		return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
	};
	const say = (o: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(o)}\n`);
	const work = fs.mkdtempSync(path.join(os.tmpdir(), "pine-voice-"));
	let recorder: ChildProcess | undefined;
	const leave = (code: number) => {
		recorder?.kill();
		for (const c of running) c.kill();
		fs.rmSync(work, { recursive: true, force: true });
		process.exit(code);
	};
	const fail = (code: string, message: string) => (say({ type: "error", code, message }), leave(1));
	process.on("SIGTERM", () => leave(0));
	process.on("SIGINT", () => leave(0));

	const whisper = arg("--whisper");
	let model = arg("--model");
	// The UI picked the model for the system's language; another language may want another of the folder's.
	if (model && arg("--locale")) {
		const better = pickModel(thisComputer().list(path.dirname(model)), whisperLanguage(arg("--locale")));
		if (better) model = path.join(path.dirname(model), better);
	}
	const rec = arg("--recorder");
	const file = arg("--file");
	const language = whisperLanguage(arg("--locale"), process.env);
	if (!whisper || !path.isAbsolute(whisper) || !model || !path.isAbsolute(model) || (!file && (!rec || !path.isAbsolute(rec) || !RECORDERS[path.basename(rec)]))) return fail("start", "the voice helper was started without the programs it needs. Update pine.");

	let heard = "";
	let pieces = 0;
	const recognise = async (wav: string) => {
		if (!model) return;
		const r = await run(whisper, whisperArgs(model, wav, language));
		if (r.code !== 0) fail("recognition", `whisper.cpp could not recognise what was said (${said(r.err.split("\n").filter((l) => /error|fail|invalid|not/i.test(l)).slice(-2).join(" ") || r.err) || `it ended with ${r.code}`}). Check that ${model} is a whisper.cpp model, or download it again.`);
		const text = spoken(r.out);
		if (text) heard = `${heard} ${text}`.trim();
	};

	if (file) {
		say({ type: "ready" });
		await recognise(file);
		say({ type: "final", text: heard });
		return leave(0);
	}

	let queue = Promise.resolve();
	const chunker = new Chunker((pcm) => {
		const wav = path.join(work, `piece-${pieces++}.wav`);
		fs.writeFileSync(wav, Buffer.concat([wavHeader(pcm.length), pcm]));
		queue = queue.then(async () => {
			const before = heard;
			await recognise(wav);
			fs.rmSync(wav, { force: true });
			if (heard !== before) say({ type: "partial", text: heard });
		});
	});
	let stopping = false;
	let ready = false;
	let complaint = "";
	try {
		recorder = spawn(rec!, RECORDERS[path.basename(rec!)], { stdio: ["ignore", "pipe", "pipe"] });
	} catch (e) {
		return fail("microphone", `the sound could not be recorded (${said(e instanceof Error ? e.message : String(e))}).`);
	}
	recorder.stderr?.on("data", (d: Buffer) => (complaint = (complaint + d.toString("utf8")).slice(-600)));
	recorder.stdout?.on("data", (d: Buffer) => {
		if (!ready) {
			ready = true;
			say({ type: "ready" });
		}
		chunker.push(d);
	});
	const finish = async () => {
		chunker.end();
		await queue;
		say({ type: "final", text: heard });
		leave(0);
	};
	recorder.on("error", (e) => fail("microphone", `the sound could not be recorded (${path.basename(rec!)}: ${said(e.message)}).`));
	recorder.on("close", (code) => {
		if (stopping) return void finish();
		if (code !== 0 && !ready) return fail("microphone", `the sound could not be recorded (${path.basename(rec!)}: ${said((complaint.trim().split("\n").pop() ?? "").replace(`${path.basename(rec!)}: `, "")) || `it ended with ${code}`}). Check that a microphone is connected and chosen as the input in the sound settings, then try again.`);
		// The recorder ended by itself: what was heard up to then is all there is.
		stopping = true;
		void finish();
	});
	// The UI closes the input when the owner is done speaking.
	process.stdin.on("data", () => {});
	process.stdin.on("end", () => {
		if (stopping) return;
		stopping = true;
		recorder?.kill("SIGINT");
		// A recorder that does not end on being asked is ended.
		setTimeout(() => recorder?.kill("SIGKILL"), 2000).unref();
	});
}
