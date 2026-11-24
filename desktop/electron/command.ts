// `pine` for a terminal, from the app: a link in a folder of the shell's PATH to the launcher the
// app carries (Resources/bin/pine, which runs the app's pine on the app's Node). With it a computer
// that only ever got the app has the `pine` command too.
//
// What is set up here is a link and nothing else, and only ever this app's own: a `pine` that
// somebody installed by itself (npm, a checkout) is left where it is and said to be there.
//
// On a Mac and in a Linux package the link leads to the launcher inside the app. An AppImage runs
// from a folder under /tmp that is another one at every start, so there the link leads to the
// AppImage itself, which runs the launcher when it is started by the name `pine` (main.ts). On
// Windows there is no link: the installer puts the app's resources\bin, which holds pine.cmd, into
// the user's PATH (scripts/installer.nsh), and this only says whether it is there.
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Command {
	/** "here": the shell's `pine` is this app's. "other": it is another pine. "none": the shell has none. "unavailable": this app cannot offer one. */
	state: "none" | "here" | "other" | "unavailable";
	/** Where the shell's `pine` is, or for "none" where the link would go. */
	at?: string;
	/** For "none": putting it there takes the owner's password (the system asks). */
	password?: boolean;
	/** For "here": the installer put it there and takes it away, not the app (Windows). */
	managed?: boolean;
	/** For "unavailable", or after something that did not work: why, in a sentence for the owner. */
	why?: string;
}

/** A link that a Pine app made, whether or not that app is still there: to the launcher in a Mac's app or a Linux package's, or to a Pine AppImage. */
const OURS = /(\.app\/Contents\/Resources\/bin\/pine|\/resources\/bin\/pine|\/Pine[^/]*\.AppImage)$/;
/** Where the link goes when no folder of the PATH can be written: on every Mac's and nearly every Linux's PATH, and the system's to write. */
const SHARED = "/usr/local/bin";

const real = (p: string) => {
	try {
		return fs.realpathSync(p);
	} catch {
		return undefined;
	}
};
const linkOf = (p: string) => {
	try {
		return fs.lstatSync(p).isSymbolicLink() ? fs.readlinkSync(p) : undefined;
	} catch {
		return undefined;
	}
};
const writable = (dir: string) => {
	try {
		fs.accessSync(dir, fs.constants.W_OK | fs.constants.X_OK);
		return fs.statSync(dir).isDirectory();
	} catch {
		return false;
	}
};
/** A variable of an environment by its name, which Windows does not tell apart by case (Path, PATH). */
const named = (env: NodeJS.ProcessEnv, name: string) => env[name] ?? Object.entries(env).find(([k]) => k.toUpperCase() === name)?.[1];
const dirsOf = (env: NodeJS.ProcessEnv, platform: string) => [...new Set(String(named(env, "PATH") ?? "").split(platform === "win32" ? ";" : ":").filter((d) => (platform === "win32" ? path.win32.isAbsolute(d) : path.posix.isAbsolute(d))))];

/**
 * The user's own PATH as Windows keeps it, which the installer changed: an app the installer
 * started has the PATH from before in its environment.
 */
function userPath(env: NodeJS.ProcessEnv): string[] {
	try {
		const out = execFileSync("reg.exe", ["query", "HKCU\\Environment", "/v", "Path"], { encoding: "utf8", timeout: 5000, windowsHide: true });
		const value = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(out)?.[1] ?? "";
		return value.replace(/%([^%]+)%/g, (all, name: string) => named(env, name.toUpperCase()) ?? all).split(";").filter(Boolean);
	} catch {
		return [];
	}
}

/** The same folder, as Windows compares them: whatever the case, with or without a separator at the end. */
const sameDir = (a: string, b: string) => a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();

/** The launcher this app carries (for an AppImage, the AppImage), or why it has none to offer. */
export function launcher(resources: string | undefined, env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): { file?: string; why?: string } {
	const file = resources ? path.join(resources, "bin", platform === "win32" ? "pine.cmd" : "pine") : undefined;
	// An app without a pine inside (a checkout, a build with --no-pine) has no command to offer, and says nothing about one.
	if (!file || !fs.existsSync(file)) return {};
	if (platform === "darwin") {
		// Opened from a disk image or straight from Downloads, macOS runs the app from a place that changes with every start.
		if (file.startsWith("/Volumes/") || file.includes("/AppTranslocation/")) return { why: "Move Pine into your Applications folder and open it from there. Where it is now, macOS runs it from a place that changes, and a command could not find it again." };
	}
	if (platform === "linux") {
		const image = env.APPIMAGE;
		if (image && path.isAbsolute(image) && fs.existsSync(image) && !image.startsWith("/tmp/.mount_")) return { file: image };
		if (file.startsWith("/tmp/.mount_")) return { why: "This AppImage did not say where it lies, and the folder it runs from changes with every start. Start Pine from the AppImage file itself." };
	}
	return { file };
}

/** Where a new link would go: a folder of the PATH that is the owner's to write, their own first; otherwise the shared one, with a password. */
export function place(env: NodeJS.ProcessEnv, home = os.homedir(), platform: string = process.platform): { dir: string; password: boolean } {
	const dirs = dirsOf(env, platform);
	const own = [path.join(home, ".local", "bin"), path.join(home, "bin"), SHARED, ...(platform === "darwin" ? ["/opt/homebrew/bin"] : [])];
	const dir = own.find((d) => dirs.includes(d) && writable(d));
	return dir ? { dir, password: false } : { dir: SHARED, password: true };
}

/** What `pine` is in the owner's shell, as seen from this app. */
export function look(resources: string | undefined, env: NodeJS.ProcessEnv, home = os.homedir(), platform: string = process.platform): Command {
	const { file, why } = launcher(resources, env, platform);
	if (!file) return { state: "unavailable", why };
	if (platform === "win32") {
		// Whichever comes first on the PATH answers to `pine`: the installer's folder of this app, or another pine.
		const ours = path.dirname(file);
		for (const dir of [...new Set([...dirsOf(env, platform), ...(process.platform === "win32" ? userPath(env) : [])])]) {
			if (sameDir(dir, ours)) return { state: "here", at: file, managed: true };
			const other = ["pine.cmd", "pine.exe", "pine.bat"].map((name) => path.join(dir, name)).find((f) => fs.existsSync(f));
			if (other) return { state: "other", at: other };
		}
		return { state: "unavailable", why: `Not set up. The installer puts pine into your PATH (${ours}): install Pine again with its installer, then open a new terminal.` };
	}
	for (const dir of dirsOf(env, platform)) {
		const at = path.join(dir, "pine");
		const to = real(at);
		// Nothing there, or a link of an app that has moved away: not a pine.
		if (!to) continue;
		if (to === real(file)) return { state: "here", at };
		try {
			fs.accessSync(at, fs.constants.X_OK);
			return { state: "other", at };
		} catch {
			// not a program
		}
	}
	const { dir, password } = place(env, home, platform);
	return { state: "none", at: path.join(dir, "pine"), password };
}

/** What is so, in words for the owner: for the settings page and the menu alike. */
export function said(c: Command, platform: string = process.platform): string {
	const first = c.why ? `${c.why} ` : "";
	if (c.state === "here") return `${first}pine in a terminal is the pine of this app (${c.at}).${c.managed ? " The installer put it there, and uninstalling Pine takes it away." : ""}`;
	if (c.state === "other") return `${first}pine in a terminal is another pine (${c.at}), installed by itself. This app leaves it alone and uses the pine it came with.`;
	if (c.state === "none") return `${first}Not set up. Pine can put a pine command into ${path.dirname(c.at ?? SHARED)}, so that a terminal has the pine of this app.${c.password ? (platform === "darwin" ? " macOS asks for your password." : " The system asks for your password.") : ""}`;
	return c.why ?? "";
}

const run = (file: string, args: string[]) =>
	new Promise<{ code: number; err: string }>((resolve) => {
		execFile(file, args, { timeout: 120_000 }, (err, _out, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, err: String(stderr) }));
	});

/**
 * A shell command with the owner's password, which the system asks for in a window of its own.
 * The paths go in as arguments and are quoted by AppleScript: none of them is ever part of the script.
 */
export const asOwner = (words: string, script: string, args: string[]) => ["-e", "on run argv", "-e", `do shell script ${script} with prompt ${JSON.stringify(words)} with administrator privileges`, "-e", "end run", "--", ...args];

/**
 * The same on Linux: polkit asks for the password (pkexec), and the paths go in as the arguments of
 * a fixed script, never as a part of it.
 */
export const asRoot = (script: string, args: string[]) => ["/bin/sh", "-c", script, "sh", ...args];

/** What is done with the password: the link put into the shared folder, or one taken away. */
async function withPassword(action: "link" | "unlink", target: string, platform: string): Promise<string | undefined> {
	if (platform === "linux") {
		const script = action === "link" ? `/bin/mkdir -p ${SHARED} && /bin/ln -sfn "$1" ${SHARED}/pine` : '/bin/rm -f "$1"';
		if (!fs.existsSync("/usr/bin/pkexec")) return `This system cannot ask for your password here (it has no pkexec). In a terminal: sudo ${action === "link" ? `ln -sfn '${target}' ${SHARED}/pine` : `rm '${target}'`}`;
		const done = await run("/usr/bin/pkexec", asRoot(script, [target]));
		if (done.code === 0) return undefined;
		return done.code === 126 || done.code === 127 ? "Nothing was changed: the password was not given." : `The system did not do it (${done.err.trim().slice(0, 200) || "it gave no reason"}).`;
	}
	const done =
		action === "link"
			? await run("/usr/bin/osascript", asOwner("Pine wants to put the pine command into /usr/local/bin, so that it works in a terminal.", `"/bin/mkdir -p ${SHARED} && /bin/ln -sfn " & quoted form of (item 1 of argv) & " ${SHARED}/pine"`, [target]))
			: await run("/usr/bin/osascript", asOwner("Pine wants to remove the pine command it put into place.", `"/bin/rm -f " & quoted form of (item 1 of argv)`, [target]));
	if (done.code === 0) return undefined;
	return /-128|cancel/i.test(done.err) ? "Nothing was changed: the password was not given." : `macOS did not do it (${done.err.trim().slice(0, 200) || "it gave no reason"}).`;
}

/** Put the link into place. Hands back what the shell has afterwards, with `why` when it did not work. */
export async function install(resources: string | undefined, env: NodeJS.ProcessEnv, home = os.homedir(), platform: string = process.platform): Promise<Command> {
	const now = look(resources, env, home, platform);
	// On Windows the installer sets it up, not the app.
	if (now.state !== "none" || !now.at || platform === "win32") return now;
	const file = launcher(resources, env, platform).file!;
	// A link of an app that has moved away may stand where the new one goes; anything else there is not this app's to replace.
	const there = linkOf(now.at);
	if (there === undefined && fs.existsSync(now.at)) return { ...now, why: `${now.at} is something else, and Pine does not replace it.` };
	if (there !== undefined && !OURS.test(there)) return { ...now, why: `${now.at} is a link to ${there}, and Pine does not replace it.` };
	let why: string | undefined;
	if (now.password) why = await withPassword("link", file, platform);
	else {
		try {
			if (there !== undefined) fs.unlinkSync(now.at);
			fs.symlinkSync(file, now.at);
		} catch (e) {
			why = `The link could not be made (${e instanceof Error ? e.message : String(e)}).`;
		}
	}
	return { ...look(resources, env, home, platform), ...(why ? { why } : {}) };
}

/** Take the link away again. Only a link to this app's launcher is ever removed. */
export async function remove(resources: string | undefined, env: NodeJS.ProcessEnv, home = os.homedir(), platform: string = process.platform): Promise<Command> {
	const now = look(resources, env, home, platform);
	if (now.state !== "here" || !now.at || now.managed) return now;
	if (linkOf(now.at) === undefined) return { ...now, why: `${now.at} is not a link, and Pine did not make it.` };
	let why: string | undefined;
	if (writable(path.dirname(now.at))) {
		try {
			fs.unlinkSync(now.at);
		} catch (e) {
			why = `The link could not be removed (${e instanceof Error ? e.message : String(e)}).`;
		}
	} else why = await withPassword("unlink", now.at, platform);
	return { ...look(resources, env, home, platform), ...(why ? { why } : {}) };
}
