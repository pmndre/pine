import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Listening, voiceTools } from "./voice.ts";
import { until } from "../../testing/harness.ts";

const tmp = (t: { after(fn: () => void): void }) => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-voice-")));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
};

const heard = (command: string[], language?: string) => {
	const log: string[] = [];
	let result: { text?: string; error?: string } | undefined;
	const l = new Listening(command, language, { ready: () => log.push("ready"), model: (s) => log.push(`model ${s}`), partial: (t) => log.push(`partial ${t}`), done: (text, error) => (result = { text, error }) });
	return { l, log, done: async () => (await until(() => result, 5000, "listening to end"), result!) };
};

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
