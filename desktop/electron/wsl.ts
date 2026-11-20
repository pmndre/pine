// On Windows, pine runs inside WSL: a Linux distribution on the same computer, where pine has its
// sandbox (bubblewrap). The app reaches that pine as it reaches another machine's
// (src/remote.ts, `connectWsl`), and this file does the rest of what that takes:
//
// - Paths. The owner picks folders of Windows (C:\Users\me\project); the daemon in the
//   distribution sees them under /mnt/c. A folder that lies in the distribution
//   (/home/me/project) is \\wsl.localhost\<distro>\home\me\project to Windows. The daemon never
//   learns of the other kind: these are translated here, on the way in and on the way out.
// - Bringing pine in. The Windows app carries the pine it runs (resources\pine) and Node for
//   Linux (resources\wsl\node-linux.tar.xz). `install` copies both into the distribution, under
//   ~/.local/share/pine-app, and puts `pine` into its bin folder, which src/remote.ts looks in
//   before the PATH. What needs an administrator there (bubblewrap) is `pine init`'s, which the
//   owner runs in a terminal of the app: it asks for their password.
import { spawn } from "node:child_process";
import path from "node:path";
import { wslArgs, wslText } from "../../src/remote.ts";

/** A path of Windows as the distribution sees it; undefined for one it cannot reach (another computer's share). */
export function toWsl(p: string, distro: string): string | undefined {
	const share = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(\\.*)?$/i.exec(p);
	if (share) return share[1].toLowerCase() === distro.toLowerCase() ? (share[2] ?? "\\").replace(/\\/g, "/") : undefined;
	const drive = /^([A-Za-z]):(?:[\\/](.*))?$/.exec(p);
	if (!drive) return undefined;
	const rest = (drive[2] ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
	return `/mnt/${drive[1].toLowerCase()}${rest ? `/${rest}` : ""}`;
}

/** A path of the distribution as Windows reaches it. */
export function fromWsl(p: string, distro: string): string {
	const drive = /^\/mnt\/([a-z])(?:\/(.*))?$/.exec(p);
	if (drive) return `${drive[1].toUpperCase()}:\\${(drive[2] ?? "").replace(/\//g, "\\")}`;
	return `\\\\wsl.localhost\\${distro}${p.replace(/\//g, "\\")}`;
}

/**
 * What runs in the distribution to bring pine in, with the paths as arguments of its own: the
 * version, Windows' folder of the pine package, and the Node archive. A version is put next to
 * the one there is and becomes `current` only when it is whole.
 */
export const INSTALL_SCRIPT = [
	"set -e",
	'd="$HOME/.local/share/pine-app"',
	'v="$1"',
	'pine="$(wslpath -u "$2")"',
	'node="$(wslpath -u "$3")"',
	'rm -rf "$d/$v.new"',
	'mkdir -p "$d/$v.new" "$d/bin"',
	'tar -xJf "$node" -C "$d/$v.new"',
	'mv "$d/$v.new"/node-v* "$d/$v.new/node"',
	'cp -R "$pine" "$d/$v.new/pine"',
	'prev="$(readlink "$d/current" 2>/dev/null || true)"',
	'rm -rf "$d/$v"',
	'mv "$d/$v.new" "$d/$v"',
	'ln -sfn "$v" "$d/current"',
	`printf '%s\\n' '#!/bin/sh' 'exec "$HOME/.local/share/pine-app/current/node/bin/node" "$HOME/.local/share/pine-app/current/pine/bin/pine.js" "$@"' > "$d/bin/pine"`,
	'chmod 755 "$d/bin/pine"',
	// Older versions go, but the one that was current until now: a daemon that runs it still loads its files.
	'for old in "$d"/*; do case "$old" in "$d/bin"|"$d/current"|"$d/$v"|"$d/$prev") ;; *) [ -d "$old" ] && rm -rf "$old" ;; esac; done',
].join("\n");

/** Bring the pine this app carries into a distribution. `resources` is the app's resources folder. */
export function install(distro: string, version: string, resources: string, wsl = "wsl.exe"): Promise<void> {
	return new Promise((resolve, reject) => {
		const c = spawn(wsl, [...wslArgs(distro, INSTALL_SCRIPT), "pine-install", version, path.join(resources, "pine"), path.join(resources, "wsl", "node-linux.tar.xz")], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
		const err: Buffer[] = [];
		c.stderr!.on("data", (d: Buffer) => err.push(d));
		c.on("error", (e) => reject(new Error(`wsl.exe could not be started: ${e.message}`)));
		c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`pine could not be put into ${distro}: ${wslText(Buffer.concat(err)).trim().slice(-400) || `exit ${code}`}`))));
	});
}

/** The command for the app's terminal that sets pine up in the distribution: its home, and its sandbox (which asks for the owner's password there). */
export const initCommand = (distro: string) => ["wsl.exe", "--distribution", distro, "--exec", "/bin/sh", "-c", '"$HOME/.local/share/pine-app/bin/pine" init'];
