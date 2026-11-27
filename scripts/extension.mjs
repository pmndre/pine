// Packs pine's browser extension (extension/) for a store: a zip of the folder as it is, without
// the manifest's `key` (a store gives the extension a key and an id of its own, and may refuse a
// package that brings one) and without what is not part of the extension (PRIVACY.md).
//   node scripts/extension.mjs            writes build-extension/pine-extension-<version>.zip
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const from = path.join(root, "extension");
const out = path.join(root, "build-extension");
const stage = path.join(out, "extension");
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(from, stage, { recursive: true, filter: (file) => !/(^|[\\/])(PRIVACY\.md|\.DS_Store)$/.test(file) });
const manifest = JSON.parse(fs.readFileSync(path.join(stage, "manifest.json"), "utf8"));
delete manifest.key;
fs.writeFileSync(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
const zip = path.join(out, `pine-extension-${manifest.version}.zip`);
// The files at the top of the archive, as a store wants them.
execFileSync("zip", ["-r", "-X", "-q", zip, "."], { cwd: stage, stdio: "inherit" });
console.log(`${zip} (${fs.statSync(zip).size} bytes): ${fs.readdirSync(stage).join(", ")}`);
