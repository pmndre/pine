import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { bin, helperArgv, helperBase, helperPath, isInside, realish } from "./security.ts";
import { git, type GitOptions } from "./workspace-view.ts";

// A worktree is a second checkout of a repository, on a branch of its own, sharing the history.
// pine makes one for a conversation (or a sub-agent's task) so that several of them can work on
// the same project without writing over each other's files. They lie in the repository itself,
// under .pine/worktrees, which ignores itself; their branches are pine/<name>.
//
// Every git call here runs behind `helperArgv`, as the code pane's do, and may write only what it
// is for. The repository is one agents work in, so its configuration is not taken at its word:
// besides the hooks and the file system monitor that `git()` turns off, the filters and merge
// drivers it names are replaced by harmless programs for pine's calls (`neutral`).

export interface Worktree {
	/** The main checkout: the folder that holds .git. */
	repo: string;
	/** The repository's git folder, which all its worktrees share. */
	common: string;
	/** The worktree's own part of it: its HEAD, its index (`<common>/worktrees/<id>`). */
	admin: string;
	/** Where the worktree is checked out. */
	path: string;
	/** Its branch, pine/<name>. */
	branch: string;
	/** What it was made from and is merged back into: a branch name, or a commit when the folder had none checked out. */
	base: string;
	/** The commit it started at. */
	from: string;
	/** The folder of the conversation, relative to the top of the checkout ("" for the top). */
	sub: string;
	made: number;
	/** For a conversation of the owner's, or for one task (a sub-agent, a delegated run). */
	kind: "conversation" | "task";
	/** The last commit of the branch that was squashed into the base. */
	squashed?: string;
}

/** Where the worktrees of a repository lie, from its top. */
export const WORKTREES = path.join(".pine", "worktrees");
const LONG = 300_000;
const MAX_INCLUDED = 200;
const MAX_INCLUDED_SIZE = 1_000_000;

/** A run of git that has to succeed: its output, or an error with what git said. */
async function must(cwd: string, args: string[], opts: GitOptions = {}): Promise<string> {
	const r = await git(cwd, args, opts);
	if (r.code !== 0) throw new Error(said(r.err) || `git ${args.find((a) => !a.startsWith("-") && !a.includes("=")) ?? ""} ended with ${r.code}`);
	return r.out;
}

/** git's own words, without its "fatal:" and "error:" and the advice it adds. */
const said = (err: string) =>
	err
		.split("\n")
		.map((l) => l.replace(/^(fatal|error|hint): /, "").trim())
		.filter((l) => l && !/^(could not read greeting|initialization for subprocess|cat died|Unexpected line 'git-filter-client')/.test(l))
		.slice(0, 6)
		.join("\n");

/**
 * What keeps a repository's configuration from running programs in pine's git calls: every
 * filter it names is replaced by one that does nothing (`true` fails the handshake, and a filter
 * that is not required is then left out), and every merge driver by `false`, which leaves such a
 * file to the agent as a conflict. Large files of Git LFS arrive as their pointers.
 */
async function neutral(cwd: string): Promise<string[]> {
	const r = await git(cwd, ["config", "--name-only", "--get-regexp", "^(filter|merge)\\."]);
	const filters = new Set<string>();
	const merges = new Set<string>();
	for (const line of r.out.split("\n")) {
		const f = /^filter\.(.+)\.[^.]+$/.exec(line.trim());
		if (f) filters.add(f[1]);
		const m = /^merge\.(.+)\.driver$/.exec(line.trim());
		if (m) merges.add(m[1]);
	}
	return [...[...filters].flatMap((f) => ["-c", `filter.${f}.process=cat`, "-c", `filter.${f}.clean=cat`, "-c", `filter.${f}.smudge=cat`, "-c", `filter.${f}.required=false`]), ...[...merges].flatMap((m) => ["-c", `merge.${m}.driver=false`])];
}

/** Who a commit of pine's is by: the owner, as git knows them, or pine where git knows nobody. */
async function author(cwd: string): Promise<Record<string, string>> {
	const name = (await git(cwd, ["config", "user.name"])).out.trim();
	const email = (await git(cwd, ["config", "user.email"])).out.trim();
	if (name && email) return {};
	return { GIT_AUTHOR_NAME: name || "pine", GIT_AUTHOR_EMAIL: email || "pine@localhost", GIT_COMMITTER_NAME: name || "pine", GIT_COMMITTER_EMAIL: email || "pine@localhost" };
}

/** A fixed shell script behind the helper sandbox, with its paths as arguments of their own. */
function shell(script: string, args: string[], write: string[]): Promise<{ code: number; err: string }> {
	const jail = helperArgv(write);
	if (!jail) return Promise.resolve({ code: 127, err: "there is no sandbox on this system to run it in" });
	return new Promise((resolve) => {
		const child = spawn(jail[0], [...jail.slice(1), bin("sh"), "-c", script, "sh", ...args], { stdio: ["ignore", "ignore", "pipe"], env: { ...helperBase(), PATH: helperPath(), LC_ALL: "C" } });
		let err = "";
		child.stderr!.on("data", (d: Buffer) => (err.length < 2000 ? (err += d.toString("utf8")) : undefined));
		const timer = setTimeout(() => child.kill("SIGKILL"), LONG);
		child.on("error", (e) => (clearTimeout(timer), resolve({ code: 127, err: e.message })));
		child.on("close", (code) => (clearTimeout(timer), resolve({ code: code ?? 1, err })));
	});
}

export interface Place {
	/** The top of the checkout the folder lies in (a worktree's own top, if it is one). */
	top: string;
	/** The main checkout. */
	repo: string;
	common: string;
	head: string;
	/** The branch checked out there, if one is. */
	branch?: string;
	sub: string;
}

/** The repository a folder lies in, as a worktree is made from it; or an error that says why there is none to make. */
export async function inspect(folder: string): Promise<Place> {
	const f = realish(folder);
	const r = await git(f, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"]);
	if (r.code !== 0) throw new Error(`${folder} is not in a git repository. A worktree is a second checkout of a repository: run git init there and commit once, or open a folder that is a repository`);
	const [top, common] = r.out.trim().split("\n").map((l) => realish(l.trim()));
	if (!top || !common || path.basename(common) !== ".git") throw new Error("this repository keeps the git folder elsewhere (a bare repository, or one made with --separate-git-dir); pine makes worktrees only for a repository with a .git folder at the top");
	const head = await git(top, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
	if (head.code !== 0) throw new Error("the repository has no commit yet, and a worktree starts from one. Commit once, then try again");
	const branch = await git(top, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
	return { top, repo: path.dirname(common), common, head: head.out.trim(), branch: branch.code === 0 && branch.out.trim() ? branch.out.trim() : undefined, sub: path.relative(top, f) };
}

/** A name git takes for a branch and a folder: letters, digits, dot, dash and underscore. */
export function worktreeName(wanted: string): string {
	const s = wanted
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/\.{2,}/g, ".")
		.replace(/^[.-]+|[.-]+$/g, "")
		.replace(/\.lock$/i, "")
		.slice(0, 40)
		.replace(/[.-]+$/, "");
	return s || "work";
}

/** The folder in which a repository's worktrees lie, made if need be, with the file that keeps git from listing it. */
async function parent(repo: string): Promise<string> {
	const dir = path.join(repo, WORKTREES);
	// Made by a fixed script that may write only in the repository: should .pine be a link that
	// leads out of it, nothing is made there, and the look below refuses it.
	const r = await shell('set -e; mkdir -p "$1/.pine/worktrees"; [ -e "$1/.pine/.gitignore" ] || printf "*\\n" > "$1/.pine/.gitignore"', [repo], [repo]);
	const real = (p: string) => {
		try {
			return !fs.lstatSync(p).isSymbolicLink() && fs.statSync(p).isDirectory();
		} catch {
			return false;
		}
	};
	if (r.code !== 0 || !real(path.join(repo, ".pine")) || !real(dir) || realish(dir) !== dir) throw new Error(`${dir} could not be made as a folder of the repository${r.err.trim() ? `: ${r.err.trim().split("\n")[0]}` : ""}. Is .pine in the repository a link, or a file?`);
	return dir;
}

async function branchExists(cwd: string, branch: string): Promise<boolean> {
	return (await git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;
}

/**
 * Make a worktree of the repository a folder lies in, on a new branch pine/<name> from what is
 * checked out there (its last commit: what is not committed stays where it is). Locked, so that
 * git does not remove it while its folder is away, and so that it can be told apart as pine's.
 */
export async function make(o: { folder: string; name: string; kind: Worktree["kind"] }): Promise<Worktree & { copied: string[] }> {
	const at = await inspect(o.folder);
	const dir = await parent(at.repo);
	const wanted = worktreeName(o.name);
	let name = wanted;
	for (let n = 2; fs.existsSync(path.join(dir, name)) || (await branchExists(at.top, `pine/${name}`)); n++) name = `${wanted}-${n}`;
	const where = path.join(dir, name);
	const branch = `pine/${name}`;
	const knobs = await neutral(at.top);
	await must(at.top, [...knobs, "worktree", "add", "--quiet", "--lock", "--reason", "pine: a conversation works here", "-b", branch, where, at.head], { write: [at.common, dir], timeoutMs: LONG });
	const admin = realish((await must(where, ["rev-parse", "--path-format=absolute", "--git-dir"])).trim());
	const copied = await include(at.top, where);
	return { repo: at.repo, common: at.common, admin, path: realish(where), branch, base: at.branch ?? at.head, from: at.head, sub: at.sub, made: Date.now(), kind: o.kind, copied };
}

/**
 * The files a repository lists in `.worktreeinclude` (as Claude Code reads it: patterns of
 * .gitignore, and only files git ignores, never one it tracks), copied into a new worktree:
 * `.env` and the like, which a checkout does not bring. Regular files only, and few and small.
 * A link is copied as the link, so nothing it points at is read for the worktree.
 */
async function include(from: string, to: string): Promise<string[]> {
	const list = path.join(from, ".worktreeinclude");
	try {
		if (!fs.lstatSync(list).isFile()) return [];
	} catch {
		return [];
	}
	const wanted = (await git(from, ["ls-files", "-z", "--others", "--ignored", `--exclude-from=${list}`], { maxBytes: 500_000 })).out.split("\0").filter(Boolean);
	if (!wanted.length) return [];
	const ignored = new Set((await git(from, ["check-ignore", "-z", "--stdin"], { stdin: wanted.join("\0") })).out.split("\0").filter(Boolean));
	const files = wanted
		.filter((f) => ignored.has(f) && !f.split("/").includes(".git") && !f.startsWith(".pine/"))
		.filter((f) => {
			try {
				const s = fs.lstatSync(path.join(from, f));
				return s.isFile() && s.size <= MAX_INCLUDED_SIZE;
			} catch {
				return false;
			}
		})
		.slice(0, MAX_INCLUDED);
	if (!files.length) return [];
	const r = await shell('set -e; s=$1; d=$2; shift 2; for f; do mkdir -p "$d/$(dirname "$f")"; cp -P "$s/$f" "$d/$f"; done', [from, to, ...files], [to]);
	return r.code === 0 ? files : [];
}

export interface Status {
	/** The worktree's folder is gone. */
	gone?: boolean;
	/** Files changed and not committed. */
	dirty: number;
	/** Commits of its branch that the base lacks. */
	ahead: number;
	/** Commits of the base that its branch lacks. */
	behind: number;
	/** Whether everything of the branch is in the base. */
	merged: boolean;
	/** The base is a branch (and not a commit), so the worktree can be merged into it. */
	mergeable: boolean;
	head?: string;
}

/** The commit a worktree's base stands at now. */
async function baseCommit(w: Worktree): Promise<{ commit?: string; branch: boolean }> {
	const ref = await git(w.repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${w.base}^{commit}`]);
	if (ref.code === 0) return { commit: ref.out.trim(), branch: true };
	const c = await git(w.repo, ["rev-parse", "--verify", "--quiet", `${w.base}^{commit}`]);
	return { commit: c.code === 0 ? c.out.trim() : undefined, branch: false };
}

export async function status(w: Worktree): Promise<Status> {
	const head = await git(w.repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${w.branch}^{commit}`]);
	const tip = head.code === 0 ? head.out.trim() : undefined;
	const base = await baseCommit(w);
	let dirty = 0;
	const gone = !fs.existsSync(w.path);
	if (!gone) {
		const s = await git(w.path, [...(await neutral(w.path)), "status", "--porcelain=v1", "-z", "--untracked-files=all"]);
		dirty = s.out.split("\0").filter((e) => /^.. /.test(e)).length;
	}
	let ahead = 0;
	let behind = 0;
	if (tip && base.commit) {
		const c = await git(w.repo, ["rev-list", "--left-right", "--count", `${base.commit}...${tip}`]);
		const m = /^(\d+)\s+(\d+)/.exec(c.out.trim());
		if (m) [behind, ahead] = [Number(m[1]), Number(m[2])];
	}
	const merged = Boolean(tip) && (ahead === 0 || tip === w.squashed);
	return { gone: gone || undefined, dirty, ahead: tip === w.squashed ? 0 : ahead, behind, merged, mergeable: base.branch, head: tip };
}

/** Where a branch is checked out, if anywhere: the main checkout or one of the worktrees. */
async function checkedOut(repo: string, branch: string): Promise<string | undefined> {
	const list = await git(repo, ["worktree", "list", "--porcelain", "-z"]);
	let at: string | undefined;
	for (const field of list.out.split("\0")) {
		if (field.startsWith("worktree ")) at = field.slice(9);
		else if (field === `branch refs/heads/${branch}` && at && fs.existsSync(at)) return realish(at);
	}
	return undefined;
}

export interface Merged {
	/** "ff": the base moved forward to the branch; "merge": a merge commit; "squash": one commit with all of it. */
	how: "ff" | "merge" | "squash";
	commit: string;
	commits: number;
	/** Where the base is checked out, whose files were brought up to date; undefined when it is not checked out anywhere. */
	updated?: string;
}

/** What could not be merged without a person: the files both sides changed. Nothing was touched. */
export class Conflict extends Error {
	readonly files: string[];
	constructor(files: string[], message: string) {
		super(message);
		this.files = files;
	}
}

/**
 * Bring a worktree's branch into its base. The merge is worked out by git without a working tree
 * (`merge-tree --write-tree`), so a conflict changes nothing anywhere. Then the base moves to the
 * result: where it is checked out, as a fast-forward there, which git refuses when local changes
 * would be overwritten; elsewhere, its ref alone, and only if it still is where it was.
 */
export async function merge(w: Worktree, how: "merge" | "squash", message?: string): Promise<Merged> {
	const s = await status(w);
	if (!s.mergeable) throw new Error(`${w.branch} was made from a commit (${w.base.slice(0, 12)}), not from a branch, so there is nothing to merge it into here. Merge it with git yourself`);
	if (s.dirty) throw new Error(`${s.dirty} file${s.dirty === 1 ? "" : "s"} in the worktree ${s.dirty === 1 ? "is" : "are"} changed and not committed. Ask the agent to commit what it wants to keep, then merge`);
	if (!s.ahead || !s.head) throw new Error(`there is nothing to merge: ${w.base} has everything of ${w.branch} already`);
	const tip = s.head;
	const old = (await baseCommit(w)).commit!;
	const ff = how === "merge" && (await git(w.repo, ["merge-base", "--is-ancestor", old, tip])).code === 0;
	let commit = tip;
	if (!ff) {
		const knobs = await neutral(w.repo);
		const mt = await git(w.repo, [...knobs, "merge-tree", "--write-tree", "--name-only", "--no-messages", old, tip], { write: [path.join(w.common, "objects")], timeoutMs: LONG });
		const lines = mt.out.split("\n").map((l) => l.trim());
		if (mt.code === 1) {
			const files = [...new Set(lines.slice(1).filter(Boolean))];
			throw new Conflict(files, `${w.branch} and ${w.base} both changed ${files.length === 1 ? files[0] : `${files.length} files (${files.slice(0, 5).join(", ")}${files.length > 5 ? ", ..." : ""})`}. Nothing was changed. Update the worktree from ${w.base} and have the agent settle the conflict there, then merge`);
		}
		if (mt.code !== 0 || !/^[0-9a-f]{40,64}$/.test(lines[0] ?? "")) throw new Error(/merge-tree|write-tree|unknown option/i.test(mt.err) ? `merging needs git 2.38 or newer (${said(mt.err).split("\n")[0]})` : said(mt.err) || "git could not work out the merge");
		const text = message?.trim() || (how === "squash" ? `${w.branch}: ${s.ahead} commit${s.ahead === 1 ? "" : "s"} squashed` : `Merge branch '${w.branch}' into ${w.base}`);
		commit = (await must(w.repo, ["commit-tree", "--no-gpg-sign", "-p", old, ...(how === "merge" ? ["-p", tip] : []), "-m", text, lines[0]], { write: [path.join(w.common, "objects")], env: await author(w.repo) })).trim();
	}
	const at = await checkedOut(w.repo, w.base);
	if (at) {
		// The files of the checkout move with it. git refuses what would overwrite a change there, and says which.
		const knobs = await neutral(at);
		const r = await git(at, [...knobs, "merge", "--ff-only", "--no-edit", "--quiet", commit], { write: [at, w.common], timeoutMs: LONG });
		if (r.code !== 0) throw new Error(`${w.base} is checked out in ${at}, and git did not move it there:\n${said(r.err)}\nNothing was changed. Commit or put aside the changes there, then merge again`);
	} else await must(w.repo, ["update-ref", "-m", `pine: ${how} ${w.branch}`, `refs/heads/${w.base}`, commit, old], { write: [w.common] });
	return { how: ff ? "ff" : how, commit, commits: s.ahead, updated: at };
}

/**
 * Bring what the base got since into the worktree's branch, in the worktree: the way to settle a
 * conflict, which is then the agent's to resolve. When git cannot merge it, nothing stays changed.
 */
export async function update(w: Worktree): Promise<{ merged: number } | { conflicts: string[] }> {
	const s = await status(w);
	if (s.gone) throw new Error(`the worktree's folder ${w.path} is gone`);
	if (s.dirty) throw new Error(`${s.dirty} file${s.dirty === 1 ? "" : "s"} in the worktree ${s.dirty === 1 ? "is" : "are"} changed and not committed. Ask the agent to commit first`);
	if (!s.behind) return { merged: 0 };
	const base = (await baseCommit(w)).commit!;
	const knobs = await neutral(w.path);
	const r = await git(w.path, [...knobs, "merge", "--no-edit", "--no-gpg-sign", "--quiet", "-m", `Merge ${w.base} into ${w.branch}`, base], { write: [w.path, w.common], env: await author(w.path), timeoutMs: LONG });
	if (r.code === 0) return { merged: s.behind };
	const files = (await git(w.path, [...knobs, "diff", "--name-only", "--diff-filter=U"])).out.split("\n").filter(Boolean);
	await git(w.path, [...knobs, "merge", "--abort"], { write: [w.path, w.common] });
	if (!files.length) throw new Error(said(r.err) || "git could not merge");
	return { conflicts: files };
}

/** Take a worktree away: its folder, whatever is in it, and its branch unless that is to stay. */
export async function remove(w: Worktree, o: { keepBranch?: boolean } = {}): Promise<void> {
	if (fs.existsSync(w.path)) {
		const r = await git(w.repo, [...(await neutral(w.repo)), "worktree", "remove", "--force", "--force", w.path], { write: [w.common, path.dirname(w.path)], timeoutMs: LONG });
		if (r.code !== 0 && fs.existsSync(w.path)) throw new Error(`the worktree ${w.path} could not be removed: ${said(r.err)}`);
	}
	await git(w.repo, ["worktree", "prune"], { write: [w.common] });
	if (!o.keepBranch && (await branchExists(w.repo, w.branch))) await must(w.repo, ["branch", "-D", w.branch], { write: [w.common] });
}

/**
 * The end of a task that had a worktree of its own: what it left uncommitted is committed on its
 * branch, the folder goes, and the branch stays if it holds anything. What the task did is then
 * on that branch alone, for the conversation that started it to merge.
 */
export async function finish(w: Worktree, label: string): Promise<{ branch?: string; commits: number; files: string[] }> {
	if (fs.existsSync(w.path)) {
		const knobs = await neutral(w.path);
		const s = await git(w.path, [...knobs, "status", "--porcelain=v1", "-z", "--untracked-files=all"]);
		if (s.out.split("\0").some((e) => /^.. /.test(e))) {
			await must(w.path, [...knobs, "add", "-A"], { write: [w.path, w.common], timeoutMs: LONG });
			await must(w.path, [...knobs, "commit", "--quiet", "--no-verify", "--no-gpg-sign", "-m", `pine: what a sub-task did\n\n${label}`], { write: [w.path, w.common], env: await author(w.path), timeoutMs: LONG });
		}
	}
	const tip = (await git(w.repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${w.branch}^{commit}`])).out.trim();
	const commits = tip ? Number((await git(w.repo, ["rev-list", "--count", `${w.from}..${tip}`])).out.trim()) || 0 : 0;
	const files = commits ? (await git(w.repo, ["diff", "--name-only", w.from, tip])).out.split("\n").filter(Boolean) : [];
	await remove(w, { keepBranch: commits > 0 });
	return { branch: commits ? w.branch : undefined, commits, files };
}

/** pine's worktrees that git knows of in a repository: where they are and on which branch. */
export async function listed(repo: string): Promise<Array<{ path: string; branch?: string; locked: boolean }>> {
	const out: Array<{ path: string; branch?: string; locked: boolean }> = [];
	const list = await git(repo, ["worktree", "list", "--porcelain", "-z"]);
	let cur: { path: string; branch?: string; locked: boolean } | undefined;
	for (const field of [...list.out.split("\0"), ""]) {
		if (field.startsWith("worktree ")) cur = { path: field.slice(9), locked: false };
		else if (field.startsWith("branch refs/heads/") && cur) cur.branch = field.slice(18);
		else if (field.startsWith("locked") && cur) cur.locked = true;
		else if (field === "" && cur) {
			if (isInside(path.join(realish(repo), WORKTREES), realish(cur.path)) && cur.path !== realish(repo)) out.push(cur);
			cur = undefined;
		}
	}
	return out;
}

/**
 * What a run in a worktree may touch: all of the worktree, and of the repository's shared git
 * folder read all of it, write the objects, its own part, and the branches under pine/. Never the configuration or the hooks,
 * never another branch, never another worktree's part; and never the files that say where the
 * worktree's git folder is (`fixed`), which would let the next git command of the owner's there
 * read a configuration of the agent's.
 */
export function gitRights(w: Worktree): { read: string[]; write: string[]; fixed: string[] } {
	return {
		// The whole worktree is the run's, also where its folder is a part of it (git works from the top).
		read: [w.common, w.path],
		write: [w.path, path.join(w.common, "objects"), w.admin, path.join(w.common, "refs", "heads", "pine"), path.join(w.common, "logs", "refs", "heads", "pine")],
		fixed: [path.join(w.path, ".git"), ...["commondir", "gitdir", "config.worktree", "locked"].map((f) => path.join(w.admin, f))],
	};
}
