// What a program the app starts inherits from it besides what it is handed. On Linux, Chromium
// opens most of its descriptors without close-on-exec (its own launcher closes them in a child it
// starts), and a child of Node's spawn or of node-pty's fork there keeps every descriptor that is
// not close-on-exec: the daemon would hold the app's sockets, its pipes, its local storage and its
// shared memory, and hand them on to every command it runs, in its sandbox too (bubblewrap keeps
// what it inherits open). So would the owner's shell in the terminal, and whatever it leaves
// running (tmux, a server started with nohup, an ssh tunnel), and whatever a login profile starts
// (ssh-agent) when the app asks the login shell for its environment. A daemon that goes on after
// the app (`keepRunning`) would also hold the pipes of whoever started the app, which then never
// see it end. macOS spawns with POSIX_SPAWN_CLOEXEC_DEFAULT, and Windows hands on only what is
// marked to be inherited, so there is nothing to do there.
import fs from "node:fs";
import path from "node:path";

/**
 * Closes every descriptor above the three standard ones, then runs its arguments. It runs in the
 * child itself, after the start: a descriptor another thread of the app opens meanwhile is closed
 * too. SHLVL is what it was: bash counted itself, and its `exec` takes that back. POSIX mode is left
 * before the program starts: an exported SHELLOPTS would carry it to every bash below.
 */
const CLOSE_FDS = 'for fd in /proc/$$/fd/*; do fd=${fd##*/}; [ "$fd" -gt 2 ] && eval "exec $fd>&-"; done; set +o posix; exec -- "$@"';

/** bash: in its usual places, else on the PATH (NixOS has neither folder). */
function bash(): string | undefined {
	for (const file of ["/bin/bash", "/usr/bin/bash", ...String(process.env.PATH ?? "").split(":").filter(Boolean).map((dir) => path.join(dir, "bash"))]) {
		try {
			fs.accessSync(file, fs.constants.X_OK);
			return file;
		} catch {
			// not here
		}
	}
	return undefined;
}

/**
 * A program as the app starts it: on Linux behind bash, which closes the app's descriptors and then
 * becomes the program (same process, same arguments); as it is elsewhere, or where there is no bash.
 * For `spawn`, `execFile` and node-pty alike.
 */
export function withoutFds(argv: string[], platform: string = process.platform): string[] {
	if (platform !== "linux") return argv;
	const shell = bash();
	// In POSIX mode a non-interactive bash reads no startup file, not even one that BASH_ENV names.
	return shell ? [shell, "--posix", "-c", CLOSE_FDS, "pine", ...argv] : argv;
}
