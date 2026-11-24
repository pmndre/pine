// Publishes pine to npm with the next version. Run by the Release workflow on every push to main
// and to next, or by hand with "npm run release". "--dry-run" shows what would happen and
// publishes nothing.
//
// The version follows from the commits since the last release; the rules are in version.mjs.
// From the branch `next` (or with "--next") it is a preview of that release, "0.4.0-next.3":
// published under npm's tag "next", so that "npm install -g @pmndre/pine" still gets the last
// release and "@pmndre/pine@next" the newest preview, and marked as a pre-release on GitHub.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { bumpOf, nextVersion, previewOf } from "./version.mjs";

const root = path.resolve(import.meta.dirname, "..");
const dry = process.argv.includes("--dry-run");
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const attempt = (cmd, args) => {
	try {
		return run(cmd, args);
	} catch {
		return undefined;
	}
};
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
/** The messages of the commits since the last release. Without its tag, all of them. */
function messagesSince(tag) {
	const range = tag && attempt("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]) ? [`${tag}..HEAD`] : [];
	return attempt("git", ["log", "--format=%B%n--", ...range]) ?? "";
}

if (/\[skip release\]/i.test(attempt("git", ["log", "-1", "--format=%B"]) ?? "")) {
	console.log("The last commit says [skip release]; nothing is published.");
	process.exit(0);
}
const preview = process.argv.includes("--next") || (process.env.GITHUB_REF_NAME ?? attempt("git", ["rev-parse", "--abbrev-ref", "HEAD"])) === "next";
// What npm hands out as the latest: the last release, never a preview.
const published = attempt("npm", ["view", pkg.name, "version"]);
const release = nextVersion(published, pkg.version, published ? bumpOf(messagesSince(`v${published}`)) : "patch");
/** Every version npm has, previews included. (One version alone comes back as a text, not a list.) */
const all = () => [JSON.parse(attempt("npm", ["view", pkg.name, "versions", "--json"]) ?? "[]")].flat();
const version = preview ? previewOf(release.version, all()) : release.version;
console.log(`${pkg.name}: ${published ?? "not published yet"} -> ${version} (${preview ? `a preview of ${release.version}: ${release.why}` : release.why})`);

execFileSync(process.execPath, [path.join(root, "scripts", "build.mjs")], { cwd: root, stdio: "inherit", env: { ...process.env, PINE_VERSION: version } });

// With NPM_TOKEN the token is used. Without it, npm's trusted publishing applies when this runs
// in the GitHub workflow the package is set up for; on your own machine it is your npm login.
const env = { ...process.env };
if (process.env.NPM_TOKEN) env.NODE_AUTH_TOKEN = process.env.NPM_TOKEN;
execFileSync("npm", ["publish", "./build", "--access", "public", ...(preview ? ["--tag", "next"] : []), ...(dry ? ["--dry-run"] : [])], { cwd: root, stdio: "inherit", env });
if (dry) {
	console.log(`Dry run: ${pkg.name}@${version} was built and checked, not published.`);
	process.exit(0);
}

// The release is marked in the repository, which is also where the next run counts its commits from.
const tag = `v${version}`;
if (process.env.GITHUB_ACTIONS) {
	// A release's notes say what changed since the release before it, not since the last preview.
	const since = !preview && published && attempt("git", ["rev-parse", "--verify", "--quiet", `refs/tags/v${published}`]) ? ["--notes-start-tag", `v${published}`] : [];
	// SignPath Foundation, which signs the Windows app, asks that every download page links the code signing policy.
	const policy = preview ? [] : ["--notes", "The Pine app for Windows is signed: [code signing policy](https://github.com/pmndre/pine#code-signing-policy)."];
	execFileSync("gh", ["release", "create", tag, "--target", process.env.GITHUB_SHA, "--title", tag, "--generate-notes", ...policy, ...since, ...(preview ? ["--prerelease"] : [])], { cwd: root, stdio: "inherit" });
	// For the jobs that follow in the workflow: the app is built for a release, with its version.
	if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nchannel=${preview ? "next" : "latest"}\n`);
} else {
	run("git", ["tag", tag]);
	console.log(`Tagged ${tag}. Push it with: git push origin ${tag}`);
}
console.log(`Published ${pkg.name}@${version}`);
