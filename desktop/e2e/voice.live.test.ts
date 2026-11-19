// Dictation with the real helper, in the real app: the helper pine builds on this Mac recognises
// a spoken sentence, and the app puts it into the input. The sentence comes from a recording,
// not the microphone: what is not covered here is the system's question whether pine may listen.
//
//   PINE_LIVE=1 node --test e2e/voice.live.test.ts     (on a Mac, with Apple's command line developer tools)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startMock } from "../../baseline/tests/mock.mjs";
import { voiceTools } from "../../src/tui/voice.ts";
import { launchApp } from "./support/app.ts";

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

test("live: the real voice helper's words arrive in the app's input", { skip: process.platform !== "darwin" || !process.env.PINE_LIVE }, async () => {
	const mock = await startMock({});
	const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-voice-")));
	let app: any;
	try {
		write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
		write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, defaults: { model: "mock/m", mode: "safe" } }));
		write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
		write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n\nYou are the main agent.\n");
		const audio = path.join(home, "said.aiff");
		execFileSync("/usr/bin/say", ["-o", audio, "Please list the bills in my scans folder."]);
		// The helper as pine builds it, told to listen to the recording instead of the room.
		const [helper] = await voiceTools().program();
		const listen = path.join(home, "listen.sh");
		write(listen, `#!/bin/sh\nexec "${helper}" --file "${audio}" "$@"\n`);
		fs.chmodSync(listen, 0o755);

		app = await launchApp({ ...process.env, PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_VOICE: listen });
		const page = await app.firstWindow();
		await page.waitForSelector("[data-slot=empty] h1", { timeout: 60_000 });
		await app.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", "voice"));
		await page.waitForFunction(() => /list the bills in my scans folder/i.test((document.querySelector("[data-slot=composer] textarea") as HTMLTextAreaElement).value), undefined, { timeout: 60_000 }).catch(async () => {
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
