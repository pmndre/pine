// What a program the app starts inherits from it besides what it is handed. On Linux, Chromium
// opens most of its descriptors without close-on-exec (its own launcher closes them in a child it
// starts), and Node's spawn there hands every descriptor that is not close-on-exec to the child:
// the daemon would hold the app's sockets, its pipes, its local storage and its shared memory, and
// hand them on to every command it runs, in its sandbox too (bubblewrap keeps what it inherits
// open). A daemon that goes on after the app (`keepRunning`) would also hold the pipes of whoever
// started the app, which then never see it end. macOS spawns with POSIX_SPAWN_CLOEXEC_DEFAULT, and
// Windows hands on only what is marked to be inherited, so there is nothing to do there.
import fs from "node:fs";
import type { StdioOptions } from "node:child_process";

let devNull: number | undefined;

/**
 * The stdio of a spawn with every other descriptor this process has open replaced by /dev/null
 * in the child, on Linux; `stdio` as it is elsewhere. Pass it as `stdio` to `spawn`.
 */
export function sealed(stdio: Exclude<StdioOptions, string>): StdioOptions {
	if (process.platform !== "linux") return stdio;
	let open: number[];
	try {
		open = fs.readdirSync("/proc/self/fd").map(Number).filter((fd) => Number.isInteger(fd) && fd > 2);
		devNull ??= fs.openSync("/dev/null", "r+");
	} catch {
		return stdio;
	}
	const last = Math.max(stdio.length - 1, ...open);
	return Array.from({ length: last + 1 }, (_, fd) => (fd < stdio.length ? stdio[fd] : devNull!));
}
