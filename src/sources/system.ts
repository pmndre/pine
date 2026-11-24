import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import { EXT } from "../config.ts";
import { buildCsharp } from "../csharp.ts";
import { prebuilt } from "../prebuilt.ts";
import { helperBase } from "../security.ts";
import type { SourceType } from "../source-types.ts";
import type { SourceApi } from "../sources.ts";
import { errText } from "../util.ts";
import { clip } from "../watching.ts";

/**
 * This computer: reports when it goes to sleep and wakes, when its screen is locked and unlocked,
 * when it changes between mains and battery, when its network comes and goes, when a disk is
 * plugged in or taken out, and when an app the owner named starts or quits.
 *
 * options: { watch?, apps?, battery? }
 *   watch    what to report: "sleep", "lock", "power", "network", "volumes" (all five by default)
 *   apps     apps whose start and end are reported, by name or bundle id: ["Xcode", "us.zoom.xos"]
 *   battery  report "battery-low" once when the charge falls to this many percent on battery (20)
 *
 * events: "sleeping", "woke", "display-off", "display-on", "locked", "unlocked"   {}
 *         "power"        { on: "ac" | "battery" | "ups", percent? }      when the supply changes
 *         "battery-low"  { percent }
 *         "network"      { online, via? }                                 when it changes
 *         "mounted", "unmounted"  { name, path? }
 *         "app-started", "app-quit"  { app, bundle? }
 *
 * The system tells a small helper, which only repeats what the system says, one JSON object per
 * line; what becomes an event is decided here. On a Mac it is system.swift, built with swiftc the
 * first time; on Windows system.cs, built with the C# compiler Windows carries (src/csharp.ts);
 * both are kept in the source's own folder, where no agent can write. On Linux it is
 * system-linux.ts, pine's own code run by the Node pine runs on, which asks D-Bus through gdbus.
 * Linux has no display-off, display-on or apps; where a service is missing (no system bus, no
 * UPower) the helper says "unavailable" with a fixed reason, and the status says it in words of pine's.
 */
const KINDS = ["sleep", "lock", "power", "network", "volumes"];
const SWIFT = path.join(import.meta.dirname, "system.swift");
const CSHARP = path.join(import.meta.dirname, "system.cs");
const LINUX = path.join(import.meta.dirname, `system-linux${EXT}`);
/** After the helper ended, the pause before it is started again; longer with each end in a row. */
const AGAIN = [500, 2000, 10_000, 60_000, 300_000];

/**
 * For tests: a program that writes the helper's lines, in place of the one built from
 * system.swift, so that the type can be tried on any system. Not an option of the source: a
 * source's options are what an agent may set, and which program the daemon runs is not among them.
 */
export const standIn: { program?: string[]; system?: NodeJS.Platform } = {};

const NOT_HERE = "the system source works on macOS, Linux and Windows, and not on this system";
const NO_COMPILER = "it needs Apple's command line developer tools, once, to build the system source's helper, and they are not installed on this Mac. Your owner installs them by typing this into a terminal: xcode-select --install. Then subscribe again";
const NO_APPS = '"apps" works on a Mac and on Windows: Linux has no clean way to hear apps start and quit. Leave "apps" out';

/** The system whose rules apply: this one, or the one a test's stand-in plays. */
const rules = () => standIn.system ?? process.platform;
const here = () => ["darwin", "linux", "win32"].includes(rules());

/**
 * Why the helper cannot hear something, by the fixed reason it gives. The helper's words are never
 * shown: only these, for a reason on this list, and only with a kind on KINDS.
 */
const MISSING: Record<string, string> = {
	"no-gdbus": "gdbus is not installed (the package libglib2.0-bin, or glib2)",
	"no-bus": "this computer has no D-Bus system bus (a container, or a system without it)",
	"no-logind": "systemd-logind is not running",
	"no-upower": "UPower is not running (the package upower)",
	"no-network-service": "neither NetworkManager nor systemd-networkd is running",
	"no-mounts": "the table of mounts cannot be read",
	"no-apps": "Linux has no clean way to hear apps start and quit",
};

export const type: SourceType = {
	summary: "this computer (macOS, Linux, Windows): reports sleep and wake, the screen lock, mains or battery, the network coming and going, disks plugged in, and apps you name starting or quitting (not on Linux)",
	options: Type.Object(
		{
			watch: Type.Optional(Type.Array(Type.String(), { description: 'what to report, any of "sleep" (sleeping, woke, display-off, display-on), "lock" (locked, unlocked), "power" (power, battery-low), "network", "volumes" (mounted, unmounted). Default: all five' })),
			apps: Type.Optional(Type.Array(Type.String(), { description: 'apps whose start and end are reported (app-started, app-quit): on a Mac by name or bundle id, e.g. ["Xcode", "us.zoom.xos"]; on Windows by program name, e.g. ["Zoom", "Teams"]. Not on Linux. Without it no app is reported' })),
			battery: Type.Optional(Type.Number({ description: 'report "battery-low" once when the charge falls to this many percent while on battery. Default 20' })),
		},
		{ additionalProperties: false },
	),
	plan(o) {
		if (!here()) throw new Error(NOT_HERE);
		const watch: string[] = [...new Set<string>((o.watch ?? KINDS).map((k: unknown) => String(k).trim().toLowerCase()))];
		const unknown = watch.filter((k) => !KINDS.includes(k));
		if (unknown.length) throw new Error(`"watch" takes ${KINDS.join(", ")}, not ${unknown.join(", ")}. Apps go into "apps", by name`);
		const apps: string[] = (o.apps ?? []).map((a: unknown) => String(a).trim()).filter(Boolean);
		if (apps.length > 30 || apps.some((a) => a.length > 100)) throw new Error('"apps" is a list of at most 30 names');
		if (apps.length && rules() === "linux") throw new Error(NO_APPS);
		if (!watch.length && !apps.length) throw new Error(`there is nothing to report: name something in "watch" (${KINDS.join(", ")}) or in "apps"`);
		if (o.battery !== undefined && !(o.battery >= 1 && o.battery <= 99)) throw new Error('"battery" is a percentage from 1 to 99');
		const says: Record<string, string> = { sleep: "goes to sleep and wakes", lock: "is locked and unlocked", power: "changes between mains and battery, or runs low", network: "loses or gets the network", volumes: "gets a disk plugged in or taken out" };
		return {
			options: { ...(o.watch ? { watch } : {}), ...(apps.length ? { apps } : {}), ...(o.battery !== undefined ? { battery: o.battery } : {}) },
			does: [`report when this computer ${watch.map((k) => says[k]).join(", ") || "starts or quits one of the apps below"}`, ...(apps.length ? [`report when ${apps.join(", ")} ${apps.length === 1 ? "starts or quits" : "start or quit"}`] : []), rules() === "linux" ? "run a small helper of pine's, which listens to the system on D-Bus and nothing else" : "build a small helper program the first time, which listens to the system and nothing else"],
			opens: true,
			tell: "It reports from now on. How things are right now (on mains or battery, online or not) is the starting point and is not reported.",
		};
	},
};

type Run = (file: string, args: string[], ms: number) => Promise<{ code: number; stdout: string; stderr: string }>;

const runProgram: Run = (file, args, ms) =>
	new Promise((resolve) => {
		execFile(file, args, { timeout: ms, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ code: err ? (typeof (err as any).code === "number" ? (err as any).code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
	});

/** The helper as a program: built from its source the first time, then found again by the source's hash. */
export async function buildHelper(dir: string, source = SWIFT, run: Run = runProgram): Promise<string> {
	const file = path.join(dir, `pine-system-${createHash("sha256").update(fs.readFileSync(source)).digest("hex").slice(0, 12)}`);
	// The Pine app carries it built (src/prebuilt.ts), in pine's own code: then nothing is compiled here.
	const carried = prebuilt(source, path.basename(file));
	if (carried) return carried;
	if (fs.existsSync(file)) return file;
	// /usr/bin/swiftc exists on every Mac, but without the tools it only opens a window that offers to install them.
	const tools = await run("/usr/bin/xcode-select", ["-p"], 10_000);
	if (tools.code !== 0 || !fs.existsSync(tools.stdout.trim())) throw new Error(NO_COMPILER);
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	const tmp = `${file}.${process.pid}.tmp`;
	const built = await run("/usr/bin/swiftc", ["-swift-version", "5", "-O", "-o", tmp, source], 300_000);
	if (built.code !== 0 || !fs.existsSync(tmp)) {
		fs.rmSync(tmp, { force: true });
		const why = built.stderr.split("\n").filter((l) => /error/i.test(l)).slice(0, 3).join(" | ") || built.stderr.trim().split("\n").slice(-2).join(" | ");
		throw new Error(`the helper could not be built (${why.slice(0, 400) || "the compiler gave no reason"}). Apple's command line developer tools may need an update: xcode-select --install, or Software Update`);
	}
	fs.renameSync(tmp, file);
	for (const old of fs.readdirSync(dir)) if (old.startsWith("pine-system-") && path.join(dir, old) !== file && !old.includes(".tmp")) fs.rmSync(path.join(dir, old), { force: true });
	return file;
}

/** The helper on Windows, built from system.cs into `dir` the first time (or the one the Pine app carries). */
export const buildSystemWindows = (dir: string, source = CSHARP) => buildCsharp(source, "pine-system", "the system source", ["System.Core.dll", "System.Windows.Forms.dll"], { dir });

/**
 * The helper of this system, as a program and its first arguments. Never an option of a source:
 * what the daemon runs is fixed here (a test puts its stand-in into `standIn`).
 */
async function helperProgram(dataDir: string): Promise<string[]> {
	if (standIn.program) return standIn.program;
	const dir = path.join(dataDir, "helper");
	if (process.platform === "linux") return [process.execPath, LINUX];
	if (process.platform === "win32") return [buildSystemWindows(dir)];
	return [await buildHelper(dir)];
}

/** A name the system gave (a disk, an app) as an event carries it: one line, no control characters, not long. */
const name = (v: unknown) => clip(String(v ?? "").replace(/[\x00-\x1f\x7f]+/g, " ").trim(), 120);

const clock = () => new Date().toTimeString().slice(0, 8);

export default async function system(source: SourceApi): Promise<void> {
	if (!here()) throw new Error(NOT_HERE);
	const o = source.options;
	const watch: string[] = (Array.isArray(o.watch) ? o.watch : KINDS).map(String).filter((k) => KINDS.includes(k));
	// On Windows an app is its program's name, which the owner may have written with ".exe".
	const appName = (a: string) => a.trim().toLowerCase().replace(/\.exe$/, "");
	const apps: string[] = (Array.isArray(o.apps) ? o.apps : []).map((a) => appName(String(a))).filter(Boolean);
	const low = Number(o.battery ?? 20);
	const kinds = [...watch, ...(apps.length ? ["apps"] : [])];
	if (!kinds.length) throw new Error('there is nothing to report: name something in "watch" or in "apps"');
	// A wrong set-up (no compiler) is found out here, and shows as the reason the source is not running.
	const program = await helperProgram(source.dataDir);

	const stop = new AbortController();
	let supply = "";
	/** What the helper cannot hear here, by kind, in pine's words (MISSING). */
	const missing = new Map<string, string>();
	const said = () => {
		const cannot = [...missing].map(([kind, why]) => `${kind}: ${why}`).join("; ");
		source.status(`listening since ${since}${supply ? `, on ${supply}` : ""}${cannot ? `; cannot hear ${cannot}` : ""}`);
	};
	/** A line of a kind means the helper hears it after all (a service that started later). */
	const heard = (kind: string) => {
		if (missing.delete(kind)) said();
	};
	let since = clock();

	const line = (text: string) => {
		let m: any;
		try {
			m = JSON.parse(text);
		} catch {
			return;
		}
		if (!m || typeof m !== "object" || typeof m.event !== "string") return;
		switch (m.event) {
			case "unavailable": {
				const kind = String(m.kind);
				if (kinds.includes(kind) && Object.hasOwn(MISSING, String(m.why)) && missing.get(kind) !== MISSING[m.why]) {
					missing.set(kind, MISSING[m.why]);
					said();
				}
				return;
			}
			case "sleeping":
			case "woke":
			case "display-off":
			case "display-on":
				heard("sleep");
				if (watch.includes("sleep")) source.emit(m.event);
				return;
			case "locked":
			case "unlocked":
				heard("lock");
				if (watch.includes("lock")) source.emit(m.event);
				return;
			case "power": {
				heard("power");
				if (!watch.includes("power")) return;
				const on = ["ac", "battery", "ups"].includes(m.on) ? String(m.on) : "ac";
				const percent = Number.isFinite(m.percent) ? Math.max(0, Math.min(100, Math.round(m.percent))) : undefined;
				supply = on === "ac" ? "mains" : on;
				said();
				// The supply is what counts as a change: the charge moves all day.
				if (source.changed(on, "power")) source.emit("power", { on, ...(percent !== undefined ? { percent } : {}) });
				// Low once per discharge: said again only after it was charged or well above the mark.
				if (percent === undefined) return;
				const warned = source.kv.get<boolean>("low") === true;
				if (on === "battery" && percent <= low && !warned) {
					source.kv.set("low", true);
					source.emit("battery-low", { percent });
				} else if (warned && (on !== "battery" || percent > low + 5)) source.kv.set("low", false);
				return;
			}
			case "network": {
				heard("network");
				if (!watch.includes("network")) return;
				const now = m.online === true ? { online: true, via: ["wifi", "ethernet", "cellular"].includes(m.via) ? String(m.via) : "other" } : { online: false };
				if (source.changed(now, "network")) source.emit("network", now);
				return;
			}
			case "mounted":
			case "unmounted":
				if (watch.includes("volumes") && m.name) source.emit(m.event, { name: name(m.name), ...(m.path ? { path: name(m.path) } : {}) });
				return;
			case "app-started":
			case "app-quit": {
				const app = name(m.app);
				const bundle = name(m.bundle);
				if (apps.includes(appName(app)) || (bundle && apps.includes(bundle.toLowerCase()))) source.emit(m.event, { app, ...(bundle ? { bundle } : {}) });
				return;
			}
		}
	};

	const once = () =>
		new Promise<void>((resolve) => {
			// Without the daemon's environment: the helper needs none of it (on Windows what a program needs to start at all).
			const child = spawn(program[0], [...program.slice(1), ...kinds], { stdio: ["pipe", "pipe", "ignore"], env: helperBase(), windowsHide: true });
			const end = () => {
				child.stdin.end();
				child.kill();
			};
			stop.signal.addEventListener("abort", end, { once: true });
			let rest = "";
			child.stdout.on("data", (d: Buffer) => {
				rest += d.toString("utf8");
				for (let at = rest.indexOf("\n"); at >= 0; at = rest.indexOf("\n")) {
					const text = rest.slice(0, at);
					rest = rest.slice(at + 1);
					try {
						line(text);
					} catch (e) {
						source.log.warn("could not take a line of the helper", errText(e));
					}
				}
				if (rest.length > 64 * 1024) rest = "";
			});
			child.stdin.on("error", () => {});
			child.on("error", (e) => source.log.warn("the helper could not be started", errText(e)));
			child.on("close", () => {
				stop.signal.removeEventListener("abort", end);
				resolve();
			});
		});

	source.onStop(() => stop.abort());
	said();
	void (async () => {
		let fails = 0;
		while (!stop.signal.aborted) {
			const from = Date.now();
			since = clock();
			said();
			await once();
			if (stop.signal.aborted) return;
			fails = Date.now() - from < 10_000 ? fails + 1 : 0;
			source.status(`the helper ended at ${clock()}, starting it again`);
			await new Promise<void>((r) => {
				const done = () => (clearTimeout(t), stop.signal.removeEventListener("abort", done), r());
				const t = setTimeout(done, AGAIN[Math.min(fails, AGAIN.length - 1)]);
				stop.signal.addEventListener("abort", done, { once: true });
			});
		}
	})();
}
