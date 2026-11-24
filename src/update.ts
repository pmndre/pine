import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PINE_ROOT } from "./config.ts";

// "pine update": bring pine itself up to date, in the way that fits how it was installed, and
// fetch whatever the new version needs (its dependencies, the browser build it drives).

/**
 * How this copy of pine got here.
 * checkout: a git clone, which runs the sources directly. It is updated with git.
 * global:   installed with "npm install -g". It is updated with npm.
 * local:    a dependency inside some project's node_modules. That project decides its version.
 * app:      the pine the Pine app carries, inside the app. A new app brings a new pine.
 */
export type InstallKind = "checkout" | "global" | "local" | "app";

/** Where a new Pine app is fetched from. */
export const APP_RELEASES = "https://github.com/pmndre/pine/releases/latest";

const real = (p: string) => {
	try {
		return fs.realpathSync(p);
	} catch {
		return path.resolve(p);
	}
};

export function installKind(root: string, globalRoot?: string): InstallKind {
	if (fs.existsSync(path.join(root, ".git")) && fs.existsSync(path.join(root, "src", "cli.ts"))) return "checkout";
	// The Pine app carries pine in its resources: Pine.app/Contents/Resources/pine on a Mac,
	// resources/pine beside the app's own app.asar on Linux and Windows.
	if (/\.app[\\/]Contents[\\/]Resources[\\/]pine$/.test(real(root))) return "app";
	if (path.basename(root) === "pine" && /^resources$/i.test(path.basename(path.dirname(root))) && fs.existsSync(path.join(path.dirname(root), "app.asar"))) return "app";
	if (globalRoot && (real(root) + path.sep).startsWith(real(globalRoot) + path.sep)) return "global";
	return "local";
}

/**
 * Whether version a is higher than version b ("1.10.0" is higher than "1.9.3"). A version of the
 * `next` channel ("1.10.0-next.4") comes before the release it leads up to, and after the ones
 * of that channel with a lower number.
 */
export function newer(a: string, b: string): boolean {
	const parse = (v: string) => v.split("-")[0].split(".").map((n) => Number(n) || 0);
	// A release counts as later than any of its previews.
	const preview = (v: string) => (v.includes("-") ? Number(/(\d+)$/.exec(v)?.[1] ?? 0) : Number.POSITIVE_INFINITY);
	const [x, y] = [parse(a), parse(b)];
	for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
	return preview(a) > preview(b);
}

/** What a pine follows: the releases, or the previews that lead up to them ("0.40.0-next.3", npm's tag "next"). */
export type Channel = "next" | "release";

/** Where a home notes the channel of its pine: in pine's data, which no agent writes. */
const channelFile = (home: string) => path.join(home, "data", "update-channel");

/** The channel that was chosen for the pine of this home, if one was. */
export function notedChannel(home: string | undefined): Channel | undefined {
	if (!home) return undefined;
	try {
		const said = fs.readFileSync(channelFile(home), "utf8").trim();
		return said === "next" || said === "release" ? said : undefined;
	} catch {
		return undefined;
	}
}

/** Notes the channel for a home that exists. False: there is no home to note it in. */
export function noteChannel(home: string | undefined, channel: Channel): boolean {
	if (!home || !fs.existsSync(path.join(home, "pine.json"))) return false;
	try {
		fs.mkdirSync(path.dirname(channelFile(home)), { recursive: true });
		fs.writeFileSync(channelFile(home), `${channel}\n`);
		return true;
	} catch {
		return false;
	}
}

/**
 * The channel a pine follows. Once chosen it stays: what was noted wins, also when the version
 * on disk is a release. (A pine on previews is moved to a release that has passed them, and that
 * must not end its previews.) Nothing noted: a pine that is a preview follows previews.
 */
export function channelOf(version: string, noted?: Channel): Channel {
	return noted ?? (/-next\./.test(version) ? "next" : "release");
}

/** The version a channel calls for: the last release, or on previews the newer of that and the newest preview. */
export function newestOf(channel: Channel, release: string | undefined, preview: string | undefined): string | undefined {
	if (channel === "next" && preview && (!release || newer(preview, release))) return preview;
	return release;
}

/** What to say when there is nothing newer to install. */
export function upToDate(name: string, version: string, channel: Channel, newest: string): string {
	const isPreview = version.includes("-");
	if (channel === "next") return isPreview ? `pine ${version} is the newest preview.` : `pine ${version} is the latest version. It follows previews, and none is ahead of it.`;
	// On releases with a preview on disk: nothing is taken back by itself.
	if (isPreview && newer(version, newest)) return `pine ${version} is a preview, ahead of the last release (${newest}). It stays until the next release, which "pine update" installs. To go back to ${newest} now:\n\n  npm install -g ${name}@${newest}`;
	return `pine ${version} is the latest version.`;
}

export function installed(root = PINE_ROOT): { name: string; version: string; kind: InstallKind; root: string } {
	const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
	// Asked without npm first: a Mac that has pine from the app may have no npm at all.
	const kind = installKind(root);
	return { name: pkg.name, version: pkg.version, kind: kind === "local" ? installKind(root, capture("npm", ["root", "-g"])) : kind, root };
}

// npm is npm.cmd on Windows, which Node starts only through cmd.exe. The arguments are pine's own
// (its package name, a version npm gave), never text from anywhere else.
const viaShell = (cmd: string) => process.platform === "win32" && cmd === "npm";

/** The command and its arguments as spawnSync takes them: one line for cmd.exe where it has to read them. */
const line = (cmd: string, args: string[]): [string, string[]] => (viaShell(cmd) ? [[cmd, ...args].join(" "), []] : [cmd, args]);

function capture(cmd: string, args: string[], cwd?: string): string | undefined {
	const [c, a] = line(cmd, args);
	const r = spawnSync(c, a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: viaShell(cmd), windowsHide: true });
	return r.status === 0 ? r.stdout.trim() : undefined;
}

const show = (cmd: string, args: string[], cwd?: string) => {
	const [c, a] = line(cmd, args);
	return spawnSync(c, a, { cwd, stdio: "inherit", shell: viaShell(cmd) }).status ?? 1;
};

const RESTART = "A pine that is running keeps the old version until it is restarted: quit the terminal UI and open it again, or restart the daemon.";

/** Text from a commit's subject, safe to print: one line, without anything a terminal would act on. */
const plain = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();

/** A commit's subject as an owner reads it: "feat: x" is something new, "fix: x" something fixed. */
function worded(subject: string): string {
	const m = /^([a-z]+)(?:\([^)]*\))?!?:\s*(.+)$/.exec(plain(subject));
	if (!m) return plain(subject);
	return `${m[1] === "feat" ? "new" : m[1] === "fix" ? "fixed" : m[1]}: ${m[2]}`;
}

/** The most lines of changes that are printed; the rest is counted. */
const MOST = 25;

/** The list as it is printed: a heading by itself, then the lines, cut after MOST changes with a count of the rest. */
function listed(heading: string, groups: Array<{ title?: string; changes: string[] }>): string {
	const total = groups.reduce((n, g) => n + g.changes.length, 0);
	if (!total) return "";
	const lines: string[] = [];
	let left = MOST;
	for (const g of groups) {
		if (!g.changes.length || left <= 0) continue;
		if (g.title) lines.push(`  ${g.title}`);
		for (const c of g.changes.slice(0, left)) lines.push(`${g.title ? "    " : "  "}- ${c}`);
		left -= g.changes.length;
	}
	return `${heading}\n\n${lines.join("\n")}${total > MOST ? `\n  ... and ${total - MOST} more` : ""}`;
}

/**
 * What the versions after `from` changed, up to `to`: a list for every version, the newest
 * first, a line for every commit. `list` is the package's changes.json (scripts/changes.mjs).
 * Empty when it says nothing about these versions.
 */
export function whatChanged(list: unknown, from: string, to: string): string {
	if (!Array.isArray(list)) return "";
	const groups: Array<{ title: string; changes: string[] }> = [];
	for (const entry of list) {
		const version = typeof entry?.version === "string" ? plain(entry.version) : "";
		if (!version || !newer(version, from) || newer(version, to) || !Array.isArray(entry.changes)) continue;
		const changes = entry.changes.filter((c: unknown): c is string => typeof c === "string" && Boolean(plain(c))).map(worded);
		// A version can stand twice in a list that was built from an odd history: its changes are one list.
		const at = groups.find((g) => g.title === version);
		if (at) at.changes.push(...changes);
		else groups.push({ title: version, changes });
	}
	return listed(`What changed since ${from}:`, groups);
}

/** The same for a checkout, which has commits and no versions: the subjects that the pull brought. */
export function whatCame(subjects: string[]): string {
	return listed("What changed:", [{ changes: subjects.map(plain).filter(Boolean).map(worded) }]);
}

/** What the installed package says its releases changed. */
function changesIn(root: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(path.join(root, "changes.json"), "utf8"));
	} catch {
		return undefined;
	}
}

/**
 * What to say after an update, and whether it worked: the version on disk has to be the one
 * that was asked for. npm can say that a version exists and still install an older one for a
 * few minutes after it was published (its two answers come from different places), and
 * "pine is now <the old version>" must not read like success.
 */
export function outcome(name: string, wanted: string | undefined, now: string, news = ""): { ok: boolean; text: string } {
	if (wanted && newer(wanted, now)) {
		return { ok: false, text: `\nNot updated: pine is still ${now}. npm knows ${wanted} but did not install it; that happens for a few minutes after a version is published. Run "pine update" again in a moment, or install it by version number:\n\n  npm install -g ${name}@${wanted}` };
	}
	// The list stands by itself, between the version and what to do about it, so that it is not read over.
	return { ok: true, text: news ? `\npine is now ${now}.\n\n${news}\n\n${RESTART}` : `\npine is now ${now}. ${RESTART}` };
}

/** What npm's registry says the newest version is, asked without npm: the pine of the app has none. */
async function fromRegistry(name: string): Promise<string | undefined> {
	try {
		const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}/latest`, { signal: AbortSignal.timeout(15_000) });
		const version = res.ok ? ((await res.json()) as { version?: unknown }).version : undefined;
		return typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version) ? version : undefined;
	} catch {
		return undefined;
	}
}

/** What a pine of the app says about a newer version: the app is what is replaced, not pine inside it. */
export const appNews = (latest: string, mine: string) => `pine ${latest} is available (this is ${mine}). This pine came with the Pine app, and a new app brings the new pine. The Pine app downloads the new release itself and installs it when you press "Restart to update" or quit it. Where it cannot, the release's page has the app:\n\n  ${APP_RELEASES}`;

/**
 * Update pine, or with `check` only say whether there is something newer. Returns the exit code.
 * `browser` fetches the browser build of the version that is on disk afterwards. `channel` is
 * the owner's choice (`--next`, `--release`), kept for `home` from then on.
 */
export async function update(opts: { check: boolean; out: (line: string) => void; browser: boolean; home?: string; channel?: Channel }): Promise<number> {
	const { out } = opts;
	const me = installed();
	if (opts.channel && (me.kind === "checkout" || me.kind === "app")) out(me.kind === "checkout" ? "A checkout follows the branch it is on; --next and --release are for a pine that was installed with npm." : "The Pine app is built for releases only. A preview is installed with npm:\n\n  npm install -g " + me.name + "@next\n");
	let wanted: string | undefined;
	/** Where a checkout stood before it was moved forward. */
	let was: string | undefined;

	if (me.kind === "checkout") {
		const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"], me.root) ?? "?";
		if (!capture("git", ["rev-parse", "--abbrev-ref", "@{u}"], me.root)) {
			out(`This is a checkout in ${me.root}, and the branch ${branch} does not follow one on a server, so there is nothing to update from. Set that up with git, or pull by hand.`);
			return 1;
		}
		if (spawnSync("git", ["fetch", "--quiet"], { cwd: me.root, stdio: "inherit" }).status !== 0) {
			out("Could not reach the repository this checkout follows.");
			return 1;
		}
		const behind = Number(capture("git", ["rev-list", "--count", "HEAD..@{u}"], me.root) ?? 0);
		if (!behind) {
			out(`pine ${me.version} (checkout in ${me.root}, branch ${branch}) is up to date.`);
			return 0;
		}
		if (opts.check) {
			out(`${behind} new commit${behind === 1 ? "" : "s"} for this checkout (${me.root}, branch ${branch}). Run "pine update" to get ${behind === 1 ? "it" : "them"}.`);
			return 0;
		}
		out(`Getting ${behind} new commit${behind === 1 ? "" : "s"} ...`);
		was = capture("git", ["rev-parse", "HEAD"], me.root);
		// Only ever a fast-forward: your own commits and changes are never rewritten or thrown away.
		if (show("git", ["pull", "--ff-only"], me.root) !== 0) {
			out("git could not simply move this checkout forward (you have commits or changes of your own in the way). Nothing was changed; sort it out with git and run pine update again.");
			return 1;
		}
		out("Installing what the new version depends on ...");
		if (show("npm", ["install", "--no-audit", "--no-fund"], me.root) !== 0) return 1;
	} else if (me.kind === "app") {
		const latest = await fromRegistry(me.name);
		if (!latest) {
			out("Could not ask for the latest version of pine. You may be offline.");
			return 1;
		}
		if (!newer(latest, me.version)) {
			out(`pine ${me.version} is the latest version.`);
			return 0;
		}
		out(appNews(latest, me.version));
		return opts.check ? 0 : 1;
	} else {
		// The channel sticks: what was chosen for this home, or else what the version on disk says.
		const noted = notedChannel(opts.home);
		const channel = opts.channel ?? channelOf(me.version, noted);
		// Noted when the owner chose, and the first time a preview is found on disk. Releases are what a pine follows unasked.
		if (!opts.check && channel !== noted && (opts.channel || channel === "next")) {
			const kept = noteChannel(opts.home, channel);
			if (opts.channel) out(`pine follows ${channel === "next" ? "previews" : "releases"} from now on.${kept ? "" : " (There is no pine home yet to keep that in: say it again after pine init.)"}`);
		}
		const onNext = channel === "next";
		const latest = newestOf(channel, capture("npm", ["view", me.name, "version"]), onNext ? capture("npm", ["view", `${me.name}@next`, "version"]) : undefined);
		if (!latest) {
			out(`Could not ask npm for the latest version of ${me.name}. You may be offline.`);
			return 1;
		}
		if (!newer(latest, me.version)) {
			out(upToDate(me.name, me.version, channel, latest));
			return 0;
		}
		if (me.kind === "local") {
			out(`pine ${latest} is available (this is ${me.version}). This copy is a dependency of the project it is installed in (${me.root}); update it there:\n\n  npm install ${me.name}@${onNext ? latest : "latest"}`);
			return opts.check ? 0 : 1;
		}
		if (opts.check) {
			out(`pine ${latest} is available (this is ${me.version}). Run "pine update" to install it.`);
			return 0;
		}
		out(`Updating pine ${me.version} to ${latest} ...`);
		wanted = latest;
		// By its number, not as "latest": npm then installs this version or says that it cannot.
		if (show("npm", ["install", "-g", `${me.name}@${latest}`, "--no-audit", "--no-fund"]) !== 0) {
			out(`npm could not install ${latest}. Right after a version is published that can take a few minutes: run "pine update" again in a moment. To see why, run it yourself:\n\n  npm install -g ${me.name}@${latest}`);
			return 1;
		}
	}

	// The version on disk decides whether it worked, not what npm said it would do.
	const now = installed(me.root).version;
	// The package that is on disk now says what its releases changed; a checkout has its commits.
	const news = me.kind === "checkout" ? (was ? whatCame((capture("git", ["log", "--first-parent", "--format=%s", `${was}..HEAD`], me.root) ?? "").split("\n")) : "") : whatChanged(changesIn(me.root), me.version, now);
	const done = outcome(me.name, wanted, now, news);
	if (!done.ok) {
		out(done.text);
		return 1;
	}
	// The browser build has to match the new version, so the new version's own installer fetches it.
	if (opts.browser) {
		out("Making sure the browser the web tools drive matches ...");
		const status = show(process.execPath, [path.join(me.root, "bin", "pine.js"), "browser-install"]);
		if (status !== 0) out(`The browser could not be fetched (exit ${status}). Run "pine browser-install" when you are online.`);
	}
	out(done.text);
	return 0;
}
