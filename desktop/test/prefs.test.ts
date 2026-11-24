// prefs.json, which holds the machines of Settings > Environments: written whole or not at all, a
// file the app cannot read set aside rather than written over, and why a machine left the list
// noted in prefs.log (electron/prefs-file.ts, used by electron/main.ts).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { droppedHosts, notePrefs, readPrefsFile, setAside, writePrefsFile } from "../electron/prefs-file.ts";
import { launchApp } from "./support/app.ts";

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), "pine-prefs-"));

/** What a write that was cut off halfway leaves: the machines are in it, and it is no JSON. */
const HALF = '{\n  "keepRunning": false,\n  "hosts": [\n    "you@elsewhere",\n    "build-box"\n  ],\n  "notify": tr';

test("prefs.json: a first start finds nothing, a whole file is read, a half-written one is unreadable", () => {
	const dir = folder();
	const file = path.join(dir, "prefs.json");
	assert.deepEqual(readPrefsFile(file), {});
	fs.writeFileSync(file, JSON.stringify({ hosts: ["build-box"] }));
	assert.deepEqual(readPrefsFile(file), { raw: { hosts: ["build-box"] } });
	fs.writeFileSync(file, HALF);
	assert.match(readPrefsFile(file).unreadable ?? "", /JSON/);
	fs.writeFileSync(file, "[1, 2]");
	assert.equal(readPrefsFile(file).unreadable, "it is not a JSON object");
	fs.writeFileSync(file, "");
	assert.ok(readPrefsFile(file).unreadable);
});

test("prefs.json: written by a rename, so the file is the old one or the new one and never a part, and nothing is left beside it", () => {
	const dir = folder();
	const file = path.join(dir, "deeper", "prefs.json");
	writePrefsFile(file, { hosts: ["build-box"] });
	writePrefsFile(file, { hosts: ["build-box", "you@elsewhere"] });
	assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { hosts: ["build-box", "you@elsewhere"] });
	assert.deepEqual(fs.readdirSync(path.dirname(file)), ["prefs.json"]);
	// A write that fails leaves the file as it was, and no temporary file.
	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	assert.throws(() => writePrefsFile(file, cyclic));
	assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { hosts: ["build-box", "you@elsewhere"] });
	assert.deepEqual(fs.readdirSync(path.dirname(file)), ["prefs.json"]);
});

test("prefs.json: an unreadable one is set aside whole, and its notes are kept short", () => {
	const dir = folder();
	const file = path.join(dir, "prefs.json");
	fs.writeFileSync(file, HALF);
	assert.equal(setAside(file), true);
	assert.equal(fs.existsSync(file), false);
	assert.equal(fs.readFileSync(`${file}.unreadable`, "utf8"), HALF);
	assert.equal(setAside(file), false, "nothing there to set aside");
	notePrefs(file, "first");
	notePrefs(file, "second");
	const lines = fs.readFileSync(path.join(dir, "prefs.log"), "utf8").trimEnd().split("\n");
	assert.equal(lines.length, 2);
	assert.match(lines[1], /^\d{4}-\d\d-\d\dT[\d:.]+Z second$/);
	for (let i = 0; i < 2000; i++) notePrefs(file, `line ${i} ${"x".repeat(60)}`);
	const log = fs.readFileSync(path.join(dir, "prefs.log"), "utf8");
	assert.ok(log.length <= 64 * 1024 + 200, `${log.length} bytes`);
	assert.match(log.trimEnd().split("\n").at(-1)!, / line 1999 /);
});

test("prefs.json: the machines it named that the list does not keep are named", () => {
	assert.deepEqual(droppedHosts(["build-box", "not a host", " you@elsewhere ", 7], ["build-box", "you@elsewhere"]), ["not a host", "7"]);
	assert.deepEqual(droppedHosts(undefined, []), []);
});

test("the app: a prefs.json it cannot read is set aside and noted, never written over, and what it saves on quitting is whole", async () => {
	const home = folder();
	const data = path.join(home, "desktop-data");
	fs.mkdirSync(data, { recursive: true });
	fs.writeFileSync(path.join(data, "prefs.json"), HALF);
	const app = await launchApp({ ...process.env, PINE_HOME: home, PINE_DESKTOP_DATA: data, PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "" });
	try {
		const page = await app.firstWindow();
		await page.waitForFunction(() => Boolean((window as any).pine?.state));
		assert.deepEqual((await page.evaluate(() => (window as any).pine.state())).prefs.hosts, []);
		assert.equal(fs.readFileSync(path.join(data, "prefs.json.unreadable"), "utf8"), HALF);
		assert.match(fs.readFileSync(path.join(data, "prefs.log"), "utf8"), /prefs\.json could not be read \(.+\): set aside as prefs\.json\.unreadable/);
	} finally {
		await app.close();
	}
	JSON.parse(fs.readFileSync(path.join(data, "prefs.json"), "utf8"));
	assert.equal(fs.readFileSync(path.join(data, "prefs.json.unreadable"), "utf8"), HALF);
	assert.deepEqual(fs.readdirSync(data).filter((f) => f.endsWith(".tmp")), []);
});
