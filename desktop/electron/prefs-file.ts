// prefs.json, the app's own settings (the machines of Settings > Environments among them), read and
// written so that what is in it is never lost on the way: a write goes to a file beside it that is
// then renamed over it, so a quit halfway through leaves the old file whole; a file that is there
// and cannot be read is set aside and never written over; and every machine that leaves the list
// is noted, with why, in prefs.log beside it. No Electron here: the tests use it as it is.
import fs from "node:fs";
import path from "node:path";

/** What prefs.json held: its object, nothing on a first start, or `unreadable` when it is there and could not be used. */
export type PrefsRead = { raw?: Record<string, any>; unreadable?: string };

/** prefs.log is cut back to its last lines once it grows past this. */
const LOG_MAX = 64 * 1024;
const LOG_KEEP = 200;

export function readPrefsFile(file: string): PrefsRead {
	let text: string;
	try {
		text = fs.readFileSync(file, "utf8");
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
		return { unreadable: (e as Error).message };
	}
	try {
		const raw = JSON.parse(text);
		if (raw && typeof raw === "object" && !Array.isArray(raw)) return { raw };
		return { unreadable: "it is not a JSON object" };
	} catch (e) {
		return { unreadable: (e as Error).message };
	}
}

/**
 * A prefs.json that could not be read is moved to prefs.json.unreadable (an older one there is
 * replaced), so that what it still holds can be looked at and the app's next save does not write
 * over it. False when it could not be moved: then nothing may be saved over it.
 */
export function setAside(file: string): boolean {
	try {
		fs.renameSync(file, `${file}.unreadable`);
		return true;
	} catch {
		return false;
	}
}

/** Writes prefs.json whole or not at all. */
export function writePrefsFile(file: string, prefs: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	try {
		fs.writeFileSync(temp, `${JSON.stringify(prefs, null, 2)}\n`);
		fs.renameSync(temp, file);
	} catch (e) {
		fs.rmSync(temp, { force: true });
		throw e;
	}
}

/** A line in prefs.log beside prefs.json, with the time. Never throws: a note that is not kept is not worth an error. */
export function notePrefs(file: string, line: string): void {
	const log = path.join(path.dirname(file), "prefs.log");
	try {
		fs.mkdirSync(path.dirname(log), { recursive: true });
		fs.appendFileSync(log, `${new Date().toISOString()} ${line}\n`);
		if (fs.statSync(log).size > LOG_MAX) fs.writeFileSync(log, `${fs.readFileSync(log, "utf8").trimEnd().split("\n").slice(-LOG_KEEP).join("\n")}\n`);
	} catch {
		// not kept
	}
}

/** The machines prefs.json named that the list does not keep (written as no host for ssh, or past the limit). */
export function droppedHosts(raw: unknown, kept: string[]): string[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter((h) => !kept.includes(typeof h === "string" ? h.trim() : "")).map((h) => (typeof h === "string" ? h.slice(0, 120) : JSON.stringify(h)?.slice(0, 120) ?? String(h)));
}
