// pine's helper for the "system" event source on Linux: it says what this computer does (sleep and
// wake, the screen lock, power, the network, disks), one JSON object per line on standard output,
// in the same lines as the Mac's helper (system.swift). It decides nothing: which of these become
// events, and for whom, is system.ts's business. Its arguments name what to listen for; it ends
// when its input is closed.
//
// It is pine's own code, started by system.ts with the Node pine runs on and fixed arguments, and
// it compiles nothing. It hears the system on D-Bus's system bus through `gdbus monitor` and asks
// it with `gdbus call`, both by absolute path with fixed arguments: logind (sleep, the lock),
// UPower (power), NetworkManager or systemd-networkd (the network). Disks are the kernel's table
// of mounts, read again every two seconds: it is a small file, and nothing tells of a change.
// Where something is not there (no system bus in a container, no UPower on a server), it says
// "unavailable" with a fixed reason, and system.ts says that in its own words.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const GDBUS = "/usr/bin/gdbus";
const BUS = "/run/dbus/system_bus_socket";
const LOGIN = "org.freedesktop.login1";
const UPOWER = "org.freedesktop.UPower";
const NM = "org.freedesktop.NetworkManager";
const NETWORKD = "org.freedesktop.network1";

/** The value of a `gdbus call` that returns one: `(<false>,)`, `(<'routable'>,)`, `(<uint32 70>,)`, `(<85.0>,)`, `(true,)`. */
export function valueOf(text: string): boolean | number | string | undefined {
	const m = /^\(<?(.*?)>?,\)$/.exec(text.trim());
	if (!m) return undefined;
	const v = m[1].trim();
	if (v === "true" || v === "false") return v === "true";
	const s = /^'(.*)'$/.exec(v);
	if (s) return s[1];
	const n = /^(?:(?:u?int(?:16|32|64)|byte|double)\s+)?(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)$/.exec(v);
	if (n) return Number(n[1]);
	return undefined;
}

/** What a line of `gdbus monitor` on logind says: the computer goes to sleep or wakes, or a session's lock changed. */
export function loginLine(line: string): { sleeping: boolean } | { session: string; locked: boolean } | undefined {
	const sleep = /^\/org\/freedesktop\/login1: org\.freedesktop\.login1\.Manager\.PrepareForSleep \((true|false),\)/.exec(line);
	if (sleep) return { sleeping: sleep[1] === "true" };
	const lock = /^(\/org\/freedesktop\/login1\/session\/\w+): org\.freedesktop\.DBus\.Properties\.PropertiesChanged \('org\.freedesktop\.login1\.Session', \{.*'LockedHint': <(true|false)>/.exec(line);
	if (lock) return { session: lock[1], locked: lock[2] === "true" };
	return undefined;
}

/** The power line from what UPower says: on battery or not, and the charge of the battery if there is one. */
export function powerOf(onBattery: unknown, present: unknown, percent: unknown, state: unknown): Record<string, unknown> {
	const out: Record<string, unknown> = { on: onBattery === true ? "battery" : "ac" };
	if (present === true && typeof percent === "number" && Number.isFinite(percent)) {
		out.percent = Math.round(percent);
		// UPower's states: 1 charging, 2 discharging, 3 empty, 4 fully charged, 5 pending charge, 6 pending discharge.
		if (typeof state === "number" && state > 0) out.charging = state === 1;
	}
	return out;
}

/** NetworkManager's connection type as the Mac's helper names the way. */
const VIA: Record<string, string> = { "802-11-wireless": "wifi", "802-3-ethernet": "ethernet", gsm: "cellular", cdma: "cellular" };

/**
 * The network line from what NetworkManager and systemd-networkd say, where they are there. Online
 * is what either calls connected beyond the local network (NetworkManager's state 60 or 70,
 * networkd's "routable"): on a machine where both run, one of them leaves the interfaces to the other.
 */
export function networkOf(nm: { state?: unknown; type?: unknown } | undefined, networkd: { operational?: unknown } | undefined, route: () => string): Record<string, unknown> {
	if (nm && typeof nm.state === "number" && nm.state >= 60) return { online: true, via: VIA[String(nm.type)] ?? "other" };
	if (networkd && networkd.operational === "routable") return { online: true, via: route() };
	return { online: false };
}

/** The way of the default route, from the kernel's tables: wifi, ethernet, or other. */
export function routeVia(read = (f: string) => fs.readFileSync(f, "utf8"), exists = fs.existsSync): string {
	try {
		const def = read("/proc/net/route")
			.split("\n")
			.slice(1)
			.map((l) => l.trim().split(/\s+/))
			.find((f) => f[1] === "00000000" && (Number.parseInt(f[3], 16) & 1) === 1);
		const dev = def?.[0];
		if (!dev || !/^[\w.@:-]+$/.test(dev)) return "other";
		const at = `/sys/class/net/${dev}`;
		if (exists(`${at}/wireless`) || exists(`${at}/phy80211`)) return "wifi";
		if (/^(wwan|rmnet)/.test(dev)) return "cellular";
		// A device behind it (not a bridge, a tunnel or a virtual pair) that speaks Ethernet.
		if (exists(`${at}/device`) && read(`${at}/type`).trim() === "1") return "ethernet";
	} catch {}
	return "other";
}

/** File systems that count as a disk wherever they are mounted: network shares. */
const SHARES = new Set(["cifs", "smb3", "nfs", "nfs4", "fuse.sshfs", "davfs", "fuse.rclone"]);

/**
 * The mounts that count as a volume, as the Mac counts them: disks, memory cards and images under
 * /media, /run/media and /mnt (where udisks and people put them), and network shares anywhere.
 */
export function volumesOf(table: string): Map<string, { name: string; path: string }> {
	const out = new Map<string, { name: string; path: string }>();
	for (const line of table.split("\n")) {
		const f = line.split(" ");
		if (f.length < 3) continue;
		// The kernel writes a space in a path as \040, a tab as \011, and so on.
		const at = f[1].replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(Number.parseInt(o, 8)));
		if (!(/^\/(media|run\/media|mnt)\//.test(at) || SHARES.has(f[2]))) continue;
		out.set(at, { name: path.basename(at) || at, path: at });
	}
	return out;
}

function main(wanted: Set<string>) {
	const on = (kind: string) => wanted.size === 0 || wanted.has(kind);
	const say = (event: string, fields: Record<string, unknown> = {}) => process.stdout.write(`${JSON.stringify({ ...fields, event })}\n`);
	const unavailable = (kind: string, why: string) => say("unavailable", { kind, why });
	const children = new Set<ChildProcess>();
	const quit = (code: number) => {
		for (const c of children) c.kill();
		process.exit(code);
	};
	// pine closes the input when the source stops, and when pine itself is gone the input is closed too.
	process.stdin.on("end", () => quit(0)).on("error", () => quit(0)).resume();
	process.on("SIGTERM", () => quit(0));
	process.stdout.on("error", () => quit(0));

	/** What `gdbus call` printed, or "" when the call failed. */
	const raw = (dest: string, object: string, method: string, args: string[]) =>
		new Promise<string>((resolve) => {
			execFile(GDBUS, ["call", "--system", "--dest", dest, "--object-path", object, "--method", method, ...args], { timeout: 5000, env: {} }, (err, stdout) => resolve(err ? "" : String(stdout)));
		});
	const call = async (dest: string, object: string, method: string, args: string[]) => valueOf(await raw(dest, object, method, args));
	const get = (dest: string, object: string, iface: string, prop: string) => call(dest, object, "org.freedesktop.DBus.Properties.Get", [iface, prop]);
	const owned = async (name: string) => (await call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus.NameHasOwner", [name])) === true;
	/** Every line of `gdbus monitor` for a name's signals. It waits for the name when nobody has it. Its end is the helper's: system.ts starts it again. */
	const monitor = (name: string, onLine: (line: string) => void) => {
		const child = spawn(GDBUS, ["monitor", "--system", "--dest", name], { stdio: ["ignore", "pipe", "ignore"], env: {} });
		children.add(child);
		let rest = "";
		child.stdout!.on("data", (d: Buffer) => {
			rest += d.toString("utf8");
			for (let at = rest.indexOf("\n"); at >= 0; at = rest.indexOf("\n")) {
				const line = rest.slice(0, at);
				rest = rest.slice(at + 1);
				onLine(line);
			}
			if (rest.length > 1024 * 1024) rest = "";
		});
		child.on("error", () => quit(1));
		child.on("close", () => quit(1));
	};
	/** Asks again after a change, never two at once, and once more if something changed meanwhile. */
	const coalesce = (ask: () => Promise<void>) => {
		let running = false;
		let again = false;
		const go = async (): Promise<void> => {
			if (running) return void (again = true);
			running = true;
			try {
				await ask();
			} catch {}
			running = false;
			if (again) {
				again = false;
				return go();
			}
		};
		return go;
	};

	const tasks: Promise<void>[] = [];
	const bus = fs.existsSync(GDBUS) ? (fs.existsSync(BUS) ? "" : "no-bus") : "no-gdbus";
	const dbusKinds = ["sleep", "lock", "power", "network"].filter(on);
	if (bus) for (const kind of dbusKinds) unavailable(kind, bus);

	if (!bus && (on("sleep") || on("lock"))) {
		tasks.push(
			(async () => {
				if (!(await owned(LOGIN))) {
					for (const kind of ["sleep", "lock"].filter(on)) unavailable(kind, "no-logind");
					return;
				}
				const uid = process.getuid?.();
				const mine = new Map<string, boolean>();
				// Lines in the order they came: the question whose session it is must not reorder a lock and an unlock.
				let queue = Promise.resolve();
				monitor(LOGIN, (line) => {
					const said = loginLine(line);
					if (!said) return;
					if ("sleeping" in said) {
						if (on("sleep")) say(said.sleeping ? "sleeping" : "woke");
						return;
					}
					if (!on("lock")) return;
					queue = queue.then(async () => {
						// The lock of this user's session only: another user's screen is theirs.
						if (!mine.has(said.session)) {
							// The User property is a pair: (uint32 501, objectpath '/org/freedesktop/login1/user/_501').
							const user = /uint32 (\d+)/.exec(await raw(LOGIN, said.session, "org.freedesktop.DBus.Properties.Get", ["org.freedesktop.login1.Session", "User"]));
							// A question that failed is asked again at the next change.
							if (user) mine.set(said.session, Number(user[1]) === uid);
						}
						if (mine.get(said.session)) say(said.locked ? "locked" : "unlocked");
					});
				});
			})(),
		);
	}

	if (!bus && on("power")) {
		tasks.push(
			(async () => {
				let last = "";
				const ask = coalesce(async () => {
					const dev = "/org/freedesktop/UPower/devices/DisplayDevice";
					const iface = "org.freedesktop.UPower.Device";
					const [onBattery, present, percent, state] = await Promise.all([get(UPOWER, "/org/freedesktop/UPower", UPOWER, "OnBattery"), get(UPOWER, dev, iface, "IsPresent"), get(UPOWER, dev, iface, "Percentage"), get(UPOWER, dev, iface, "State")]);
					if (onBattery === undefined) return;
					const line = powerOf(onBattery, present, percent, state);
					const key = JSON.stringify(line);
					if (key !== last) {
						last = key;
						say("power", line);
					}
				});
				// Asked straight away: UPower is started by the bus on the first question where it is installed and not running yet.
				await ask();
				if (!last) unavailable("power", "no-upower");
				// UPower that starts later is heard too: gdbus says when the name gets an owner.
				monitor(UPOWER, (line) => {
					if (/^\/org\/freedesktop\/UPower(\/devices\/DisplayDevice)?: /.test(line) || /is owned by/.test(line)) void ask();
				});
			})(),
		);
	}

	if (!bus && on("network")) {
		tasks.push(
			(async () => {
				let last = "";
				// Only what runs already: a question would start networkd on a computer whose network NetworkManager runs.
				const ask = coalesce(async () => {
					const [nm, networkd] = await Promise.all([owned(NM), owned(NETWORKD)]);
					const none = Promise.resolve(undefined);
					const [nmState, nmType, operational] = await Promise.all([nm ? get(NM, "/org/freedesktop/NetworkManager", NM, "State") : none, nm ? get(NM, "/org/freedesktop/NetworkManager", NM, "PrimaryConnectionType") : none, networkd ? get(NETWORKD, "/org/freedesktop/network1", "org.freedesktop.network1.Manager", "OperationalState") : none]);
					if (nmState === undefined && operational === undefined) return;
					const line = networkOf(nmState === undefined ? undefined : { state: nmState, type: nmType }, operational === undefined ? undefined : { operational }, () => routeVia());
					const key = JSON.stringify(line);
					if (key !== last) {
						last = key;
						say("network", line);
					}
				});
				await ask();
				if (!last) unavailable("network", "no-network-service");
				const changed = (line: string) => {
					if (/^\/org\/freedesktop\/(NetworkManager|network1): /.test(line) || /is owned by/.test(line)) void ask();
				};
				monitor(NM, changed);
				monitor(NETWORKD, changed);
			})(),
		);
	}

	if (on("volumes")) {
		const read = () => {
			try {
				return volumesOf(fs.readFileSync("/proc/self/mounts", "utf8"));
			} catch {
				return undefined;
			}
		};
		let before = read();
		if (!before) unavailable("volumes", "no-mounts");
		else
			setInterval(() => {
				const now = read();
				if (!now || !before) return;
				for (const [at, v] of now) if (!before.has(at)) say("mounted", v);
				for (const [at, v] of before) if (!now.has(at)) say("unmounted", v);
				before = now;
			}, 2000);
	}

	// Apps have no clean signal on Linux (a desktop's own, or the kernel's process events, which need root).
	if (wanted.has("apps")) unavailable("apps", "no-apps");

	void Promise.all(tasks).then(() => say("ready"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) main(new Set(process.argv.slice(2)));
