// Dictation with the real helper, in the real app: the helper pine has on this system recognises
// a spoken sentence, and the app puts it into the input. The sentence comes from a recording,
// not the microphone: what is not covered here is the system's question whether pine may listen.
//
//   PINE_LIVE=1 node --test test/voice-live.test.ts
//
// On a Mac with Apple's command line developer tools (the sentence is spoken by `say`); on Windows
// with an English speech recogniser (spoken by System.Speech); on Linux with whisper.cpp and a
// model installed as `pine` says (spoken by espeak-ng).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startMock } from "../../baseline/tests/mock.mjs";
import { buildVoiceWindows, voiceTools } from "../../src/tui/voice.ts";
import { launchApp } from "./support/app.ts";

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

/** The real helper told to read a recording of a sentence, and what it has to hear in it; or why that cannot be done here. */
async function recorded(dir: string): Promise<{ command: string[]; heard: RegExp } | string> {
	if (process.platform === "darwin") {
		const audio = path.join(dir, "said.aiff");
		execFileSync("/usr/bin/say", ["-o", audio, "Please list the bills in my scans folder."]);
		const [helper] = await voiceTools().program();
		return { command: [helper, "--file", audio], heard: /list the bills in my scans folder/i };
	}
	if (process.platform === "win32") {
		const audio = path.join(dir, "said.wav");
		const say = "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono); $s.SetOutputToWaveFile($env:PINE_SAID, $f); $s.Speak('Please list the bills in my scans folder.'); $s.Dispose()";
		execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", say], { env: { ...process.env, PINE_SAID: audio }, windowsHide: true, stdio: "pipe" });
		return { command: [buildVoiceWindows(path.join(dir, "voice")), "--file", audio, "--locale", "en-US"], heard: /list|bills|folder/i };
	}
	const tools = voiceTools();
	if (tools.unavailable) return tools.unavailable;
	if (!fs.existsSync("/usr/bin/espeak-ng")) return "the sentence is spoken with espeak-ng: sudo apt install espeak-ng";
	const audio = path.join(dir, "said.wav");
	execFileSync("/usr/bin/espeak-ng", ["-w", audio, "Open the file and read it to me."]);
	return { command: [...(await tools.program()), "--file", audio], heard: /open the file and read it/i };
}

test("live: the real voice helper's words arrive in the app's input", { skip: !process.env.PINE_LIVE && "PINE_LIVE=1" }, async (t) => {
	const mock = await startMock({});
	const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-voice-")));
	let app: any;
	try {
		write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
		write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, defaults: { model: "mock/m", mode: "safe", introduce: false } }));
		write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
		write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n\nYou are the main agent.\n");
		// The helper as pine builds it, told to listen to the recording instead of the room.
		const said = await recorded(home);
		if (typeof said === "string") return t.skip(said);

		app = await launchApp({ ...process.env, PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_VOICE: JSON.stringify(said.command) });
		const page = await app.firstWindow();
		await page.waitForSelector("[data-slot=empty] h1", { timeout: 60_000 });
		await app.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", "voice"));
		await page.waitForFunction((heard) => new RegExp(heard, "i").test((document.querySelector("[data-slot=composer] textarea") as HTMLTextAreaElement).value), said.heard.source, { timeout: 60_000 }).catch(async () => {
			throw new Error(`nothing was heard. The input holds ${JSON.stringify(await page.inputValue("[data-slot=composer] textarea"))}; on screen: ${await page.evaluate(() => [...document.querySelectorAll("[data-slot=alert], [data-slot=toast]")].map((e) => e.textContent).join(" | "))}`);
		});
		// Heard is not sent.
		assert.equal(await page.$$eval(".it-user", (els: Element[]) => els.length), 0);
	} finally {
		await app?.close().catch(() => {});
		await mock.close?.().catch(() => {});
		fs.rmSync(home, { recursive: true, force: true });
	}
});
