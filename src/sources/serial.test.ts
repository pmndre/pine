import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { lines, listen, portOf, timing as portTiming } from "./serial.ts";
import { harness, until } from "../../testing/harness.ts";

const infoOf = (h: any, name: string) => h.pine.sources.list().find((s: any) => s.name === name)!;

test("serial: only a serial port is read; lines come out of bytes clean and whole", () => {
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pine-serial-")), "ttyUSB0");
	fs.writeFileSync(file, "x");
	assert.throws(() => portOf(file), /is not a device: a serial port lies under \/dev/);
	assert.throws(() => portOf("ttyUSB0"), /"port" is the device's path/);
	assert.throws(() => portOf("/dev/ttyUSB-pine-none"), /is not there\. Is the device plugged in\?/);
	// Devices of the same kind that are not serial ports: nothing to read lines from, or somebody's keyboard.
	assert.throws(() => portOf("/dev/null"), /is not a serial port by its name[\s\S]*A terminal is never read/);
	if (fs.existsSync("/dev/tty")) assert.throws(() => portOf("/dev/tty"), /is not a serial port/);
	assert.throws(() => portOf("/dev/../etc/hosts"), /is not a device|is not there/);
	fs.rmSync(path.dirname(file), { recursive: true, force: true });

	const got: string[] = [];
	const feed = lines((l) => got.push(l));
	feed(Buffer.from("temp=21"));
	assert.deepEqual(got, [], "a line is not a line until it ends");
	feed(Buffer.from(".5\r\nhum=40\n\n\rdone\r"));
	feed(Buffer.from("a\tb\u0007\u001b[31m c\n"));
	// A character of several bytes that arrives in two pieces.
	const euro = Buffer.from("1 €\n");
	feed(euro.subarray(0, 3));
	feed(euro.subarray(3));
	assert.deepEqual(got, ["temp=21.5", "hum=40", "done", "a b[31m c", "1 €"]);
	const long: string[] = [];
	lines((l) => long.push(l))(Buffer.from("x".repeat(5000)));
	assert.deepEqual(long.map((l) => l.length), [4096], "a device that never ends its line does not fill the memory");
});

const python = ["/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"].find((p) => fs.existsSync(p));

const hasPty = (() => {
	try {
		return Boolean(python) && execFileSync(python!, ["-c", "import pty, os\nm, s = pty.openpty()\nprint(os.ttyname(s))"], { timeout: 5000 }).toString().startsWith("/dev/");
	} catch {
		return false;
	}
})();

test("serial: what a device prints arrives line by line; a device that is gone is waited for", { skip: !hasPty && "needs python3 with pseudo-terminals" }, async (t) => {
	portTiming.retryMs = 40;
	// A pseudo-terminal: what the test writes into one end is what a device would send on the other.
	const dev = spawn(python!, ["-u", "-c", "import os, pty, sys\nm, s = pty.openpty()\nprint(os.ttyname(s), flush=True)\nwhile True:\n    d = os.read(0, 4096)\n    if not d:\n        break\n    os.write(m, d)\n"], { stdio: ["pipe", "pipe", "inherit"] });
	t.after(() => dev.kill("SIGKILL"));
	const name = await new Promise<string>((resolve) => dev.stdout!.once("data", (d: Buffer) => resolve(d.toString().trim())));
	assert.match(name, /^\/dev\//);
	const got: string[] = [];
	const states: string[] = [];
	const stop = listen(name, 115200, (l) => got.push(l), (s) => states.push(s));
	t.after(stop);
	await until(() => states.includes("listening"), 5000, "the port to be open at its speed");
	dev.stdin!.write('temp=21.5\r\n{"hum": 40}\n');
	await until(() => got.length === 2, 4000, "the lines");
	assert.deepEqual(got, ["temp=21.5", '{"hum": 40}']);
	stop();
	dev.stdin!.end();

	// One that is not there: nothing fails, it is looked for again and again.
	const gone: string[] = [];
	const stopGone = listen("/dev/cu.pine-test-none", 9600, () => {}, (s) => gone.push(s));
	await until(() => gone.length >= 3, 4000, "it to be looked for again");
	stopGone();
	assert.deepEqual([...new Set(gone)], ["waiting"]);
});

test("serial: a source whose device is unplugged says so and stays", async () => {
	portTiming.retryMs = 40;
	const h = await harness({ pine: { sources: { meter: { type: "serial", port: "/dev/cu.pine-test-none", baud: 115200, start: "always" }, odd: { type: "serial", port: "/dev/null", start: "always" } } }, agents: { main: {} } });
	await until(() => /waiting for cu\.pine-test-none: it is not there \(unplugged\?\)/.test(infoOf(h, "meter").status ?? ""), 4000, "the status");
	assert.equal(infoOf(h, "meter").running, true);
	assert.match(infoOf(h, "odd").error ?? "", /is not a serial port by its name/);
	assert.equal(h.pine.bus.query({ topic: "source/#" }).length, 0);
	await h.close();
});
