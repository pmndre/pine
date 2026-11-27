// Extensions: pi extensions and the pi packages that carry them, installed into pine's home.
//
// An extension is a program inside the daemon: it runs with the owner's rights, outside any sandbox,
// in every session of the agents it is for. So nothing here is reached without the owner: the
// control API is the owner's own hand, and the main agent's tools ask in every mode.
//
// Where one lies says whom it is for, as with skills: <home>/packages for all agents,
// agents/<id>/packages for one. Each of the two is a folder laid out as pi lays out its own
// (settings.json with `packages`, npm/, git/), so that pi's package manager installs into it, and
// local/ beside them holds what was copied in from a file or a folder. pi's own folder (~/.pi) is
// never loaded from: it is only looked at, so that the owner can bring over what they have there.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { AgentConfig, PineConfig } from "./config.ts";
import { errText } from "./util.ts";

export type ExtensionKind = "npm" | "git" | "local";

export interface ExtensionInfo {
	/** What it was installed from, as it is kept: `npm:name@1.2.3`, `git:host/owner/repo@<commit>`, `./local/name`. */
	source: string;
	kind: ExtensionKind | "file";
	name: string;
	version?: string;
	description?: string;
	scope: "global" | "agent";
	agent?: string;
	/** Where it lies. */
	path: string;
	/** False: the owner named it in a configuration file or put it into an agent's folder; pine lists it and leaves it alone. */
	managed: boolean;
	/** The extension files it brings, relative to `path`. */
	extensions: string[];
	/** The skills it brings, by folder name. */
	skills: string[];
	/** What it brings that pine has no use for (pi's prompt templates and terminal themes). */
	unused: string[];
	/** Said when it is not where it should be. */
	problem?: string;
	/** What a session loads of it: extension files, and skill folders or files. */
	load: { extensions: string[]; skills: string[] };
}

/** What is to be installed, checked and pinned: nothing was fetched yet but a line about it. */
export interface Proposal {
	source: string;
	kind: ExtensionKind;
	name: string;
	version?: string;
	description?: string;
	/** For a local one: the file or folder that is copied. */
	from?: string;
}

/** For tests: a program in place of npm (its command line), and a folder in place of the owner's ~/.pi. */
export const standIn: { npm?: string[]; pi?: string } = {};

const MAX_FILES = 5000;
const MAX_BYTES = 50 * 1024 * 1024;
/** npm without the scripts a package asks to have run at its installation. */
const NO_SCRIPTS = "--ignore-scripts";

export const storeDir = (cfg: PineConfig, agent?: AgentConfig) => path.join(agent ? agent.dir : cfg.home, "packages");
const settingsFile = (store: string) => path.join(store, "settings.json");

function readSettings(store: string): { packages: any[]; [k: string]: any } {
	try {
		const json = JSON.parse(fs.readFileSync(settingsFile(store), "utf8"));
		return { ...json, packages: Array.isArray(json.packages) ? json.packages : [] };
	} catch {
		return { packages: [] };
	}
}

function writeSettings(store: string, change: (json: { packages: any[]; [k: string]: any }) => void): void {
	fs.mkdirSync(store, { recursive: true, mode: 0o700 });
	const json = readSettings(store);
	change(json);
	const tmp = `${settingsFile(store)}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(json, null, 2)}\n`, { mode: 0o600 });
	fs.renameSync(tmp, settingsFile(store));
}

const sourceOf = (pkg: any): string => (typeof pkg === "string" ? pkg : String(pkg?.source ?? ""));

/** pi's package manager on one of pine's folders. `scripts`: npm may run what the package asks for at installation. */
function managerFor(store: string, scripts = false): DefaultPackageManager {
	const npm = standIn.npm ?? ["npm"];
	writeSettings(store, (json) => {
		json.npmCommand = scripts ? npm : [...npm, NO_SCRIPTS];
	});
	// The folder is its own "project" and is not trusted as one: nothing but its settings.json is read.
	const settingsManager = SettingsManager.create(store, store, { projectTrusted: false } as any);
	return new DefaultPackageManager({ cwd: store, agentDir: store, settingsManager, commandOutput: "capture" });
}

function run(command: string[], cwd?: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(command[0], command.slice(1), { cwd, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().split("\n").slice(-3).join(" "))) : resolve(String(stdout))));
	});
}

const NPM_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const NPM_VERSION = /^[A-Za-z0-9._~^+-]{1,60}$/;
// A host, a path, and a branch, tag or commit after "@". Nothing that git could take for an option or a transport.
const GIT = /^(?:git:)?(?:https:\/\/)?([A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,})\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+?)(?:\.git)?(?:@([A-Za-z0-9][A-Za-z0-9._/-]{0,99}))?$/;
const COMMIT = /^[0-9a-f]{40}$/;

/** What kind of thing a source names. Throws with what is accepted when it is none. */
export function kindOf(source: string): ExtensionKind {
	const s = String(source ?? "").trim();
	if (!s || s.length > 400 || /[\s\u0000-\u001f]/.test(s)) throw new Error(HOW);
	if (s.startsWith("npm:")) return "npm";
	if (s.startsWith("git:") || s.startsWith("https://")) return "git";
	if (path.isAbsolute(s) || s.startsWith("./") || s.startsWith("../") || s.startsWith("~/")) return "local";
	throw new Error(HOW);
}
const HOW = 'an extension is installed from npm ("npm:name" or "npm:name@1.2.3"), from git ("git:github.com/owner/repo", with "@tag" or "@commit" to pin it), or from a file or folder';

function npmParts(source: string): { name: string; version?: string } {
	const spec = source.slice(4);
	const at = spec.lastIndexOf("@");
	const name = at > 0 ? spec.slice(0, at) : spec;
	const version = at > 0 ? spec.slice(at + 1) : undefined;
	if (!NPM_NAME.test(name) || (version !== undefined && !NPM_VERSION.test(version))) throw new Error(`"${source}" is not an npm package: write npm:name or npm:name@1.2.3`);
	return { name, version };
}

function gitParts(source: string): { base: string; host: string; repo: string; ref?: string } {
	const m = GIT.exec(source);
	if (!m) throw new Error(`"${source}" is not a git address pine installs from: write git:github.com/owner/repo, with @tag or @commit to pin it`);
	return { base: `git:${m[1]}/${m[2]}`, host: m[1], repo: `https://${m[1]}/${m[2]}`, ref: m[3] };
}

/**
 * Look a source up and pin it, without installing anything: an npm package to the version the
 * registry gives now, a git address to the commit its default branch is at. What comes back is
 * what the owner is asked about, and exactly that is installed.
 */
export async function propose(source: string, base?: string): Promise<Proposal> {
	const s = String(source ?? "").trim();
	const kind = kindOf(s);
	if (kind === "npm") {
		const { name, version } = npmParts(s);
		let seen: any;
		try {
			seen = JSON.parse(await run([...(standIn.npm ?? ["npm"]), "view", version ? `${name}@${version}` : name, "name", "version", "description", "--json"]));
		} catch (e) {
			throw new Error(`npm does not know "${version ? `${name}@${version}` : name}": ${errText(e)}`);
		}
		// A range that several versions match comes back as a list, the newest last.
		if (Array.isArray(seen)) seen = seen.at(-1);
		if (!seen || typeof seen.version !== "string" || !NPM_VERSION.test(seen.version)) throw new Error(`npm has no version of "${name}"${version ? ` that matches ${version}` : ""}`);
		return { source: `npm:${name}@${seen.version}`, kind, name, version: seen.version, description: typeof seen.description === "string" ? clean(seen.description) : undefined };
	}
	if (kind === "git") {
		const git = gitParts(s);
		let ref = git.ref;
		if (!ref) {
			let out: string;
			try {
				out = await run(["git", "ls-remote", "--", git.repo, "HEAD"]);
			} catch (e) {
				throw new Error(`git cannot reach ${git.repo}: ${errText(e)}`);
			}
			ref = out.trim().split(/\s+/)[0];
			if (!COMMIT.test(ref ?? "")) throw new Error(`${git.repo} did not say which commit it is at`);
		}
		return { source: `${git.base}@${ref}`, kind, name: git.base.split("/").at(-1)!, version: COMMIT.test(ref) ? ref.slice(0, 10) : ref };
	}
	const from = path.resolve(base ?? os.homedir(), s.startsWith("~/") ? path.join(os.homedir(), s.slice(2)) : s);
	const st = fs.existsSync(from) ? fs.statSync(from) : undefined;
	if (!st) throw new Error(`${from} does not exist`);
	if (st.isFile() && !/\.(ts|js|mjs)$/.test(from)) throw new Error(`${from} is not an extension: a .ts or .js file, or a folder`);
	const about = describe(from);
	const name = path.basename(from).replace(/\.(ts|js|mjs)$/, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "extension";
	return { source: `./local/${st.isFile() ? `${name}${path.extname(from)}` : name}`, kind, name: about.name ?? name, version: about.version, description: about.description, from };
}

/** One line, as plain text. */
const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim().slice(0, 400);

/** What a file or a folder says about itself: its package.json, or the comment a file begins with. */
function describe(at: string): { name?: string; version?: string; description?: string } {
	try {
		if (fs.statSync(at).isFile()) {
			const head = fs.readFileSync(at, "utf8").slice(0, 4000);
			const block = /^\s*\/\*\*?([\s\S]*?)\*\//.exec(head)?.[1].replace(/^\s*\* ?/gm, "");
			const lines = block ?? /^\s*((?:\/\/.*\n?)+)/.exec(head)?.[1].replace(/^\s*\/\/ ?/gm, "");
			const first = lines?.split(/\n\s*\n/)[0];
			return first?.trim() ? { description: clean(first) } : {};
		}
		const json = JSON.parse(fs.readFileSync(path.join(at, "package.json"), "utf8"));
		return { name: typeof json.name === "string" ? clean(json.name).slice(0, 100) : undefined, version: typeof json.version === "string" ? clean(json.version).slice(0, 60) : undefined, description: typeof json.description === "string" ? clean(json.description) : undefined };
	} catch {
		return {};
	}
}

/** Copy a file or a folder, files and folders only: a link in it is refused, never followed. */
function copyIn(from: string, to: string): void {
	let files = 0;
	let bytes = 0;
	const walk = (a: string, b: string) => {
		const st = fs.lstatSync(a);
		if (st.isSymbolicLink()) throw new Error(`${a} is a link; an extension is copied as files, and a link is not followed`);
		if (st.isDirectory()) {
			if (path.basename(a) === ".git") return;
			fs.mkdirSync(b, { recursive: true, mode: 0o700 });
			for (const name of fs.readdirSync(a)) walk(path.join(a, name), path.join(b, name));
		} else if (st.isFile()) {
			if (++files > MAX_FILES || (bytes += st.size) > MAX_BYTES) throw new Error(`that is too much for an extension (at most ${MAX_FILES} files and ${MAX_BYTES / 1024 / 1024} MB)`);
			fs.copyFileSync(a, b);
		}
	};
	try {
		walk(from, to);
	} catch (e) {
		fs.rmSync(to, { recursive: true, force: true });
		throw e;
	}
}

// One installation at a time: npm and git write into the same folders.
let queue: Promise<unknown> = Promise.resolve();
const oneAtATime = <T>(work: () => Promise<T>): Promise<T> => {
	const next = queue.then(work, work);
	queue = next.catch(() => {});
	return next;
};

const cache = new Map<string, Promise<ExtensionInfo[]>>();

/** What one of pine's folders holds, each with what it brings. Installs nothing. */
function inStore(store: string, scope: "global" | "agent", agent?: string): Promise<ExtensionInfo[]> {
	if (!fs.existsSync(settingsFile(store))) return Promise.resolve([]);
	const key = `${store}\n${fs.statSync(settingsFile(store)).mtimeMs}`;
	let found = cache.get(key);
	if (!found) {
		found = lookInto(store, scope, agent);
		for (const k of cache.keys()) if (k.startsWith(`${store}\n`)) cache.delete(k);
		cache.set(key, found);
		found.catch(() => cache.delete(key));
	}
	return found;
}

async function lookInto(store: string, scope: "global" | "agent", agent?: string): Promise<ExtensionInfo[]> {
	const sources = readSettings(store).packages.map(sourceOf).filter(Boolean);
	if (!sources.length) return [];
	const settingsManager = SettingsManager.create(store, store, { projectTrusted: false } as any);
	const manager = new DefaultPackageManager({ cwd: store, agentDir: store, settingsManager, commandOutput: "capture" });
	// A package that is not there is said to be missing, never fetched because somebody looked.
	const resolved = await manager.resolve(async () => "skip");
	const of = (list: Array<{ path: string; enabled: boolean; metadata: { source: string; origin: string } }>, source: string) => list.filter((r) => r.enabled && r.metadata.origin === "package" && r.metadata.source === source).map((r) => r.path);
	return sources.map((source) => {
		let kind: ExtensionKind = "local";
		try {
			kind = kindOf(source);
		} catch {}
		const at = kind === "local" ? path.resolve(store, source) : (manager.getInstalledPath(source, "user") ?? "");
		const there = at && fs.existsSync(at);
		const about = there ? describe(at) : {};
		const rel = (p: string) => (there && fs.statSync(at).isDirectory() ? path.relative(at, p) : path.basename(p));
		const exts = of(resolved.extensions as any, source);
		// A skill is its folder; pi names the SKILL.md in it.
		const skills = [...new Set(of(resolved.skills as any, source).map((p) => (path.basename(p) === "SKILL.md" ? path.dirname(p) : p)))];
		const prompts = of(resolved.prompts as any, source).length;
		const themes = of(resolved.themes as any, source).length;
		const fallback = kind === "npm" ? npmSafe(source) : kind === "git" ? (source.split("@")[0].split("/").at(-1) ?? source) : path.basename(source).replace(/\.(ts|js|mjs)$/, "");
		return {
			source,
			kind,
			name: about.name ?? fallback,
			version: about.version ?? (kind === "git" ? source.split("@").at(-1)?.slice(0, 10) : undefined),
			description: about.description,
			scope,
			...(agent ? { agent } : {}),
			path: at,
			managed: true,
			extensions: exts.map(rel),
			skills: skills.map((p) => path.basename(p).replace(/\.md$/, "")),
			load: { extensions: exts, skills },
			unused: [...(prompts ? [`${prompts} prompt template${prompts === 1 ? "" : "s"}`] : []), ...(themes ? [`${themes} terminal theme${themes === 1 ? "" : "s"}`] : [])],
			...(there ? {} : { problem: "it is not installed here any more; remove it and install it again" }),
		};
	});
}

const npmSafe = (source: string) => {
	try {
		return npmParts(source).name;
	} catch {
		return source;
	}
};

/** An extension the owner put somewhere by hand: a path in a configuration file, or a file in an agent's folder. */
function byHand(file: string, scope: "global" | "agent", agent?: string): ExtensionInfo {
	const there = fs.existsSync(file);
	const about = there ? describe(file) : {};
	return { source: file, kind: "file", name: about.name ?? path.basename(file).replace(/\.(ts|js|mjs)$/, ""), version: about.version, description: about.description, scope, ...(agent ? { agent } : {}), path: file, managed: false, extensions: [path.basename(file)], skills: [], unused: [], load: { extensions: [], skills: [] }, ...(there ? {} : { problem: "the file is not there" }) };
}

/** Every extension pine loads, for whom, and what each brings. */
export async function listExtensions(cfg: PineConfig): Promise<ExtensionInfo[]> {
	const out: ExtensionInfo[] = [...(await inStore(storeDir(cfg), "global")), ...cfg.extensions.map((f) => byHand(f, "global"))];
	for (const agent of Object.values(cfg.agents)) {
		out.push(...(await inStore(storeDir(cfg, agent), "agent", agent.id)));
		const own = path.join(agent.dir, "extensions");
		const loose = fs.existsSync(own) ? fs.readdirSync(own).filter((n) => !n.startsWith(".")).map((n) => path.join(own, n)) : [];
		for (const f of [...new Set([...loose, ...agent.extensions])]) out.push(byHand(f, "agent", agent.id));
	}
	return out;
}

/** The sources installed into pine's folders, read from their lists alone: for `pine check`. */
export function installedSources(cfg: PineConfig): Array<{ source: string; agent?: string }> {
	return [...readSettings(storeDir(cfg)).packages.map((p) => ({ source: sourceOf(p) })), ...Object.values(cfg.agents).flatMap((a) => readSettings(storeDir(cfg, a)).packages.map((p) => ({ source: sourceOf(p), agent: a.id })))];
}

/** What a session of this agent loads from pine's folders: extension files and skill folders. */
export async function loadedFor(cfg: PineConfig, agent: AgentConfig): Promise<{ extensions: string[]; skills: string[]; roots: string[] }> {
	const stores = [storeDir(cfg), storeDir(cfg, agent)];
	const extensions: string[] = [];
	const skills: string[] = [];
	for (const [i, store] of stores.entries()) {
		let found: ExtensionInfo[] = [];
		try {
			found = await inStore(store, i ? "agent" : "global", i ? agent.id : undefined);
		} catch {
			// A folder that cannot be read costs its extensions, never the session.
		}
		for (const x of found) {
			if (x.problem) continue;
			extensions.push(...x.load.extensions);
			skills.push(...x.load.skills);
		}
	}
	return { extensions: [...new Set(extensions)], skills: [...new Set(skills)], roots: stores };
}

/**
 * Install what was proposed, for all agents or for one. The owner said yes to exactly this
 * proposal: whoever calls this has that yes. `scripts` lets npm run what the package asks to
 * have run at its installation, which is a program before any of the extension's own code.
 */
export function install(cfg: PineConfig, proposal: Proposal, agent?: AgentConfig, scripts = false): Promise<ExtensionInfo> {
	return oneAtATime(async () => {
		const store = storeDir(cfg, agent);
		const scope = agent ? "agent" : "global";
		const same = (source: string) => identity(source) === identity(proposal.source);
		const before = readSettings(store).packages.map(sourceOf);
		if (before.includes(proposal.source)) throw new Error(`"${proposal.name}" is installed already ${agent ? `for ${agent.id}` : "for all agents"}`);
		if (proposal.kind === "local") {
			if (before.some(same)) throw new Error(`an extension named "${path.basename(proposal.source)}" is there already ${agent ? `for ${agent.id}` : "for all agents"}; remove it first`);
			const to = path.resolve(store, proposal.source);
			if (path.dirname(to) !== path.join(store, "local")) throw new Error("that is not a name an extension can have");
			fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
			copyIn(proposal.from!, to);
		} else {
			try {
				await managerFor(store, scripts).install(proposal.source);
			} catch (e) {
				throw new Error(`could not install ${proposal.source}: ${errText(e)}`);
			}
		}
		// Another version of the same package gives way to this one.
		writeSettings(store, (json) => {
			json.packages = [...json.packages.filter((p) => !same(sourceOf(p))), proposal.source];
		});
		const made = (await inStore(store, scope, agent?.id)).find((x) => x.source === proposal.source);
		if (!made) throw new Error(`${proposal.source} was installed and is not found`);
		return made;
	});
}

/** What makes two sources the same package: its name without the version, its address without the commit. */
function identity(source: string): string {
	try {
		const kind = kindOf(source);
		return kind === "npm" ? `npm:${npmParts(source).name}` : kind === "git" ? gitParts(source).base : source;
	} catch {
		return source;
	}
}

/** Take an installed extension away again: the package and its line. */
export function uninstall(cfg: PineConfig, source: string, agent?: AgentConfig): Promise<void> {
	return oneAtATime(async () => {
		const store = storeDir(cfg, agent);
		if (!readSettings(store).packages.map(sourceOf).includes(source)) throw new Error(`there is no extension "${source}" ${agent ? `of ${agent.id}` : "for all agents"}`);
		const kind = kindOf(source);
		if (kind === "local") {
			const at = path.resolve(store, source);
			if (path.dirname(at) === path.join(store, "local")) fs.rmSync(at, { recursive: true, force: true });
		} else {
			try {
				await managerFor(store).remove(source);
			} catch {
				// What could not be taken off the disk is still taken off the list: it loads no more.
			}
		}
		writeSettings(store, (json) => {
			json.packages = json.packages.filter((p) => sourceOf(p) !== source);
		});
	});
}

/** What an installed extension would be updated to: the newest version, or the commit its repository is at now. Undefined: it is that already. */
export async function newer(source: string): Promise<Proposal | undefined> {
	const kind = kindOf(source);
	if (kind === "local") throw new Error("this one was copied in from a file; to bring it up to date, remove it and add the file again");
	if (kind === "git" && !COMMIT.test(gitParts(source).ref ?? "")) throw new Error(`this one is pinned to "${gitParts(source).ref}"; to move it, install the tag or commit you want`);
	const latest = await propose(identity(source));
	return latest.source === source ? undefined : latest;
}

/** The extensions pi itself has (~/.pi), for the owner to bring over. Looked at, never loaded. */
export function inPi(): Array<{ source: string; name: string; version?: string; description?: string; kind: ExtensionKind }> {
	const dir = standIn.pi ?? path.join(os.homedir(), ".pi", "agent");
	const out: Array<{ source: string; name: string; version?: string; description?: string; kind: ExtensionKind }> = [];
	for (const source of readSettings(dir).packages.map(sourceOf)) {
		try {
			const kind = kindOf(source);
			if (kind === "npm") {
				const { name } = npmParts(source);
				const about = describe(path.join(dir, "npm", "node_modules", name));
				// The version pi has, so that pine gets the same one.
				out.push({ source: about.version && NPM_VERSION.test(about.version) ? `npm:${name}@${about.version}` : source, name, version: about.version, description: about.description, kind });
			} else if (kind === "git") {
				const git = gitParts(source);
				const about = describe(path.join(dir, "git", git.host, git.base.slice(4 + git.host.length + 1)));
				out.push({ source, name: about.name ?? git.base.split("/").at(-1)!, version: about.version ?? git.ref, description: about.description, kind });
			} else {
				const at = path.resolve(dir, source);
				if (fs.existsSync(at)) out.push({ source: at, name: describe(at).name ?? path.basename(at), ...describe(at), kind });
			}
		} catch {
			// One pine would not install is not offered.
		}
	}
	const loose = path.join(dir, "extensions");
	if (fs.existsSync(loose)) {
		for (const name of fs.readdirSync(loose)) {
			const at = path.join(loose, name);
			if (name.startsWith(".") || !(fs.statSync(at).isDirectory() || /\.(ts|js|mjs)$/.test(name))) continue;
			out.push({ source: at, name: name.replace(/\.(ts|js|mjs)$/, ""), ...describe(at), kind: "local" });
		}
	}
	return out;
}

/** The lines the owner reads before saying yes. */
export function proposalText(p: Proposal, whom: string, scripts: boolean): string {
	const from = p.kind === "npm" ? `npm, version ${p.version}` : p.kind === "git" ? `${gitParts(p.source).repo}, at ${p.version}` : `${p.from} (copied as it is now)`;
	return [
		`install the extension "${p.name}" ${whom}`,
		`From: ${from}`,
		...(p.description ? [`It says about itself: ${p.description}`] : []),
		"This is a program. Once installed it runs inside pine itself, with your rights and outside any sandbox, in every conversation of the agents it is for. It can add tools, change what an agent is told, and read what pine reads.",
		scripts ? "npm will also run the scripts this package asks to have run while it is installed." : "",
	].filter(Boolean).join("\n");
}
