import { type ChildProcess, execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { Type } from "typebox";
import type { SourceType } from "../source-types.ts";
import type { SourceApi } from "../sources.ts";
import { capped, clip, found, pattern, shown } from "../watching.ts";

/**
 * A serial port: reports the lines a device prints on it. For a microcontroller that prints its
 * readings (Arduino, ESP32), a smart meter's P1 port, a GPS receiver, a weather station, a UPS.
 *
 * options: { port, baud?, match?, changed?, perMinute? }
 *   port       the device, /dev/cu.usbserial-1420 on a Mac, /dev/ttyUSB0 or /dev/ttyACM0 on Linux
 *   baud       its speed (9600 by default)
 *   match      only lines this regular expression finds; its first group is the value
 *   changed    true: only a line (or value) that differs from the one before
 *   perMinute  at most this many reports a minute (30 by default)
 *
 * event "line": { port, line, value?, previous?, dropped? }
 *
 * It listens and nothing else: nothing is ever written to the port.
 */
const BAUDS = [300, 600, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
const LONGEST = 4096;
const first = (...files: string[]) => files.find((f) => fs.existsSync(f));
/** How long to wait before looking for a device again, at the start and at most. A test shortens them. */
export const timing = { retryMs: 1000, retryMaxMs: 60_000 };

/**
 * Whether a name under /dev is a serial port by how it is called. A terminal somebody types into
 * is a device of the same kind, and reading from it would take their keystrokes: those are
 * called otherwise (ttys003, pts/4, tty1, console) and are never opened.
 */
const serialName = (file: string) => /^\/dev\/(cu|tty)\.[A-Za-z0-9_.-]+$/.test(file) || /^\/dev\/(tty[A-Z][A-Za-z]*[0-9]+|rfcomm[0-9]+)$/.test(file);

/** The device a `port` option means: resolved, under /dev, there, and a serial port. Throws a sentence otherwise. */
export function portOf(raw: unknown): string {
	const given = String(raw ?? "").trim();
	// Windows names its ports COM1, COM2...: reading one takes a program pine does not have there yet.
	if (process.platform === "win32") throw new Error("a serial port cannot be read on Windows yet. Use a computer with macOS or Linux for this device, or a pine in WSL with the port passed through (usbipd)");
	if (!path.isAbsolute(given)) throw new Error('"port" is the device\'s path: /dev/cu.usbserial-1420 on a Mac, /dev/ttyUSB0 or /dev/ttyACM0 on Linux');
	let file: string;
	try {
		// A name under /dev/serial/by-id leads to the device itself.
		file = fs.realpathSync(given);
	} catch {
		throw new Error(`${given} is not there. Is the device plugged in? On a Mac the ports are listed by "ls /dev/cu.*", on Linux by "ls /dev/ttyUSB* /dev/ttyACM*"`);
	}
	if (!file.startsWith("/dev/")) throw new Error(`${given} is not a device: a serial port lies under /dev`);
	if (!fs.statSync(file).isCharacterDevice()) throw new Error(`${given} is not a serial port`);
	if (!serialName(file)) throw new Error(`${given} is not a serial port by name. One is called /dev/cu.<something> on a Mac, /dev/ttyUSB0, /dev/ttyACM0 or /dev/ttyS0 on Linux. A terminal is never read`);
	// On a Mac the tty. name waits for a modem that is never there; the cu. name of the same port does not.
	const twin = file.replace(/^\/dev\/tty\./, "/dev/cu.");
	return twin !== file && fs.existsSync(twin) ? twin : file;
}

export const type: SourceType = {
	summary: "a serial port: reports the lines a device prints on it. For an Arduino or ESP32 that prints readings, a smart meter's P1 port, a GPS receiver. It only listens",
	options: Type.Object(
		{
			port: Type.String({ description: "the device: /dev/cu.usbserial-1420 on a Mac, /dev/ttyUSB0 or /dev/ttyACM0 on Linux" }),
			baud: Type.Optional(Type.Number({ description: "the speed the device sends at, e.g. 9600 or 115200. Default 9600" })),
			match: Type.Optional(Type.String({ description: 'report only lines this regular expression finds; the first group becomes "value", e.g. "temp=([0-9.]+)"' })),
			changed: Type.Optional(Type.Boolean({ description: "true to report a line (or the value) only when it differs from the one before. For a device that prints the same reading every second" })),
			perMinute: Type.Optional(Type.Number({ description: "at most this many reports a minute; the rest are dropped and counted. Default 30" })),
		},
		{ additionalProperties: false },
	),
	plan(o) {
		const port = portOf(o.port);
		const baud = o.baud ?? 9600;
		if (!BAUDS.includes(baud)) throw new Error(`"baud" is one of ${BAUDS.join(", ")}`);
		if (o.match) pattern(o.match);
		if (o.perMinute !== undefined && !(Number.isInteger(o.perMinute) && o.perMinute >= 1 && o.perMinute <= 600)) throw new Error('"perMinute" is a whole number from 1 to 600');
		return {
			options: { ...o, port },
			does: [`read the serial port ${port} at ${baud} baud and report ${o.match ? `the lines /${o.match}/ finds` : "the lines that arrive"}${o.changed ? ", when they differ from the one before" : ""}, at most ${o.perMinute ?? 30} a minute`, "it only listens: nothing is written to the port"],
			opens: true,
			tell: "It reports from the next line on. The sources tool shows whether the device is there.",
		};
	},
};

/** Lines out of bytes as they arrive: split at any line end, without control characters, none longer than a line can be. */
export function lines(onLine: (line: string) => void): (chunk: Buffer) => void {
	const decoder = new StringDecoder("utf8");
	let rest = "";
	return (chunk) => {
		rest += decoder.write(chunk);
		for (;;) {
			const at = rest.search(/[\r\n]/);
			if (at < 0 && rest.length < LONGEST) return;
			const raw = at < 0 ? rest.slice(0, LONGEST) : rest.slice(0, at);
			rest = at < 0 ? rest.slice(LONGEST) : rest.slice(at + 1);
			const line = raw.replace(/\t/g, " ").replace(/[\u0000-\u001f\u007f-\u009f�]/g, "").trim();
			if (line) onLine(line);
		}
	};
}

/**
 * Listen to a serial device until `stop` is called. The device is held open by a reader that
 * does nothing else (`cat`, started by its path with the device as its one argument), and its
 * speed is set while it is open, since a Mac forgets the setting when the last holder lets go.
 * `state` says how it stands: "listening", "waiting" (the device is not there), "unset" (the
 * speed could not be set).
 */
export function listen(file: string, baud: number, onLine: (line: string) => void, state: (now: "listening" | "waiting" | "unset") => void): () => void {
	const cat = first("/bin/cat", "/usr/bin/cat");
	const stty = first("/bin/stty", "/usr/bin/stty");
	if (!cat || !stty) throw new Error("this system has no cat or stty to read a serial port with");
	let stopped = false;
	let child: ChildProcess | undefined;
	let timer: NodeJS.Timeout | undefined;
	let wait = timing.retryMs;
	const again = (now: "waiting" | "unset") => {
		if (stopped) return;
		state(now);
		timer = setTimeout(start, wait);
		timer.unref?.();
		wait = Math.min(wait * 2, timing.retryMaxMs);
	};
	const start = () => {
		if (stopped) return;
		let there = false;
		try {
			there = fs.statSync(file).isCharacterDevice();
		} catch {
			// unplugged
		}
		if (!there) return again("waiting");
		const reader = spawn(cat, [file], { stdio: ["ignore", "pipe", "ignore"] });
		child = reader;
		let ready = false;
		let failed = false;
		const feed = lines(onLine);
		// What arrived before the speed was set was read at the wrong one.
		reader.stdout!.on("data", (d: Buffer) => ready && feed(d));
		reader.on("error", () => {});
		reader.on("close", () => {
			if (child === reader) child = undefined;
			again(failed ? "unset" : "waiting");
		});
		execFile(stty, [process.platform === "linux" ? "-F" : "-f", file, String(baud), "raw", "-echo", "cs8", "-parenb", "-cstopb", "clocal", "cread"], { timeout: 5000 }, (err) => {
			if (stopped || child !== reader) return;
			if (err) {
				failed = true;
				return void reader.kill("SIGKILL");
			}
			ready = true;
			wait = timing.retryMs;
			state("listening");
		});
	};
	start();
	return () => {
		stopped = true;
		clearTimeout(timer);
		child?.kill("SIGKILL");
	};
}

export default function serial(source: SourceApi): void {
	const o = source.options;
	let file: string;
	try {
		file = portOf(o.port);
	} catch (e) {
		// Unplugged right now: it is waited for under the name it was set up with, if that is a serial port's.
		const given = String(o.port ?? "");
		if (!serialName(given) || fs.existsSync(given)) throw e;
		file = given;
	}
	const baud = Number(o.baud ?? 9600);
	if (!BAUDS.includes(baud)) throw new Error(`"baud" is one of ${BAUDS.join(", ")}`);
	const re = o.match ? pattern(String(o.match)) : undefined;
	const cap = capped(Number(o.perMinute ?? 30));
	const name = path.basename(file);
	let count = 0;

	const onLine = (line: string) => {
		let value: unknown;
		if (re) {
			const hit = found(re, line);
			if (hit === null) return;
			value = /^-?\d+(\.\d+)?$/.test(hit) ? Number(hit) : hit;
		} else {
			try {
				value = JSON.parse(line);
			} catch {
				// a line of text
			}
		}
		let previous: unknown;
		if (o.changed === true) {
			const was = source.changed(value ?? line);
			if (!was) return;
			previous = was.previous;
		}
		if (!cap.ok()) return;
		const dropped = cap.dropped();
		count++;
		source.status(`listening on ${name} at ${baud} baud, ${count} line${count === 1 ? "" : "s"} reported`);
		source.emit("line", { port: file, line: clip(line, 1000), ...(value !== undefined ? { value: shown(value) } : {}), ...(previous !== undefined ? { previous: shown(previous) } : {}), ...(dropped ? { dropped } : {}) });
	};
	const stop = listen(file, baud, onLine, (now) => source.status(now === "listening" ? `listening on ${name} at ${baud} baud${count ? `, ${count} line${count === 1 ? "" : "s"} reported` : ""}` : now === "waiting" ? `waiting for ${name}: it is not there (unplugged?)` : `${name} does not take ${baud} baud; trying again`));
	source.onStop(stop);
}
