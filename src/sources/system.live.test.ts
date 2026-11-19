import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { buildHelper } from "./system.ts";
import { until } from "../../testing/harness.ts";

test("live: the real helper is built and says how this Mac is", { skip: !process.env.PINE_LIVE || process.platform !== "darwin" }, async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pine-system-"));
	const file = await buildHelper(dir);
	assert.equal(await buildHelper(dir), file, "built once");
	const child = spawn(file, ["power", "network"], { stdio: ["pipe", "pipe", "inherit"] });
	let out = "";
	child.stdout.on("data", (d) => (out += d));
	await until(() => /"event":"ready"/.test(out) && /"event":"network"/.test(out), 10_000, "the helper to speak");
	const lines = out.trim().split("\n").map((l) => JSON.parse(l));
	assert.ok(["ac", "battery", "ups"].includes(lines.find((l) => l.event === "power").on));
	assert.equal(typeof lines.find((l) => l.event === "network").online, "boolean");
	// It ends when its input is closed, as it is when the source stops.
	const ended = new Promise<number | null>((r) => child.on("close", r));
	child.stdin.end();
	assert.equal(await ended, 0);
	fs.rmSync(dir, { recursive: true, force: true });
});
