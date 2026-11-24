// Makes the package that goes to npm, in build/. Node runs pine's TypeScript sources directly in
// a checkout, but refuses to do so inside node_modules, so the published package holds them
// compiled to JavaScript, at the same paths. Everything else is copied as it is.
//   node scripts/build.mjs     then     npm publish ./build
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { changesOf } from "./changes.mjs";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "build");
fs.rmSync(out, { recursive: true, force: true });
execFileSync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", path.join(root, "tsconfig.build.json")], { cwd: root, stdio: "inherit" });

for (const name of ["README.md", "LICENSE", "docs", "examples"]) fs.cpSync(path.join(root, name), path.join(out, name), { recursive: true });
// The README's screenshots are shown from the repository; they need not travel with every install.
fs.rmSync(path.join(out, "docs", "images"), { recursive: true, force: true });
// pine's helpers are built from their sources on the computer they run on (Swift on a Mac, C# on
// Windows) or run as they are (Python on Linux): their sources travel with the package.
for (const dir of ["mcp", "src", path.join("src", "tui"), path.join("src", "sources")]) {
	for (const name of fs.readdirSync(path.join(root, dir))) if (/\.(swift|cs|py)$/.test(name)) fs.copyFileSync(path.join(root, dir, name), path.join(out, dir, name));
}
// What the owner's views import ("pine/view"): pine copies the TypeScript itself into <home>/views for their editor (src/views.ts).
fs.copyFileSync(path.join(root, "src", "view-kit.ts"), path.join(out, "src", "view-kit.ts"));
fs.mkdirSync(path.join(out, "bin"), { recursive: true });
fs.copyFileSync(path.join(root, "bin", "pine.js"), path.join(out, "bin", "pine.js"));
fs.chmodSync(path.join(out, "bin", "pine.js"), 0o755);

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
// The checkout is marked private so that it is never published by accident with its sources uncompiled.
delete pkg.private;
delete pkg.devDependencies;
delete pkg.scripts;
pkg.bin = { pine: "bin/pine.js" };
// A release gives the package its version; a plain build keeps the one in package.json.
if (process.env.PINE_VERSION) pkg.version = process.env.PINE_VERSION;
pkg.publishConfig = { access: "public" };
fs.writeFileSync(path.join(out, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

// What this and the releases before it changed, which "pine update" says after it has installed
// one (src/update.ts). Without git, or without its tags, the list is short or empty and nothing is said.
let log = "";
try {
	log = execFileSync("git", ["log", "--first-parent", "--format=%D%x09%s", "-n", "500"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch {
	// not a repository
}
fs.writeFileSync(path.join(out, "changes.json"), `${JSON.stringify(changesOf(log, pkg.version), null, "\t")}\n`);

const left = fs.readdirSync(out, { recursive: true }).filter((f) => String(f).endsWith(".ts") && !String(f).endsWith(".d.ts") && !String(f).startsWith("examples") && !String(f).startsWith("docs") && String(f) !== path.join("src", "view-kit.ts"));
if (left.length) throw new Error(`uncompiled sources in the package: ${left.join(", ")}`);
console.log(`package ${pkg.name}@${pkg.version} is in ${out}`);
