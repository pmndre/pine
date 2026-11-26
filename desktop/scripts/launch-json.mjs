// The ports of this checkout's previews, and the `.claude/launch.json` that names them.
//
// Several checkouts of pine (git worktrees) run on one Mac at once, each with its previews. Fixed
// ports had them attach to each other's page and daemon, so each checkout gets ports of its own,
// from its path: the same every time for one checkout, most likely different for another. They
// lie between 5200 and 5902, away from Vite's 5173 and Storybook's 6006. Two checkouts rarely get
// the same ones; when they do, the second preview refuses to start (its port is strict) and says
// so, and $PORT picks another: it always wins.
//
// `.claude/launch.json` is not kept in git: it is written here, on `npm install` in desktop/ and
// by the preview when it is missing, with the ports of this checkout.
//   node scripts/launch-json.mjs
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const checkout = path.resolve(import.meta.dirname, "..", "..");

/** This checkout's ports: the throwaway preview, the preview on ~/.pine beside it, and `npm run dev`'s page. */
export function ports() {
	let where = checkout;
	try {
		where = fs.realpathSync(checkout);
	} catch {
		// as it is
	}
	const hash = createHash("sha256").update(where).digest().readUInt32BE(0);
	// A hash into 176 blocks of four ports: two checkouts rarely share a block, and never part of one.
	const base = 5200 + 4 * (hash % 176);
	return { preview: base, home: base + 1, dev: base + 2 };
}

/**
 * The entries of the preview pane. They run with the Node that runs this script (`npm install` in
 * desktop/), not the first `node` the pane's shell finds: that one may be older than the preview needs.
 * Storybook keeps its own port: one checkout at a time, or `pnpm run storybook -p <port>` by hand.
 */
function entries() {
	const p = ports();
	const desktop = (...args) => [path.join("desktop", ...args)];
	return [
		{ name: "desktop-preview", runtimeExecutable: process.execPath, runtimeArgs: desktop("scripts", "preview.ts"), port: p.preview },
		{ name: "desktop-preview-home", runtimeExecutable: process.execPath, runtimeArgs: [...desktop("scripts", "preview.ts"), "--home", "~/.pine"], port: p.home },
		{ name: "storybook", runtimeExecutable: process.execPath, runtimeArgs: [...desktop("node_modules", "storybook", "dist", "bin", "dispatcher.js"), "dev", "-p", "6006", "-c", "desktop/.storybook", "--no-open"], port: 6006 },
	];
}

/**
 * Write `.claude/launch.json` with this checkout's ports. Entries of other names that somebody
 * added are kept, and so are the file's other keys. With `onlyIfMissing`, a file that is there is
 * left alone; so is one that cannot be read, which may hold somebody's work (then nothing is
 * returned).
 */
export function writeLaunchJson({ onlyIfMissing = false } = {}) {
	const file = path.join(checkout, ".claude", "launch.json");
	if (onlyIfMissing && fs.existsSync(file)) return file;
	let old = {};
	if (fs.existsSync(file)) {
		try {
			old = JSON.parse(fs.readFileSync(file, "utf8"));
		} catch (e) {
			console.warn(`${file} was left as it is: it is not JSON that can be read (${e instanceof Error ? e.message : e}). Fix or delete it, then run \`node desktop/scripts/launch-json.mjs\`.`);
			return undefined;
		}
	}
	if (typeof old !== "object" || old === null || Array.isArray(old)) old = {};
	const ours = new Set(entries().map((e) => e.name));
	const kept = Array.isArray(old.configurations) ? old.configurations.filter((c) => !ours.has(c?.name)) : [];
	const text = `${JSON.stringify({ ...old, version: "0.0.1", configurations: [...entries(), ...kept] }, null, 2)}\n`;
	fs.mkdirSync(path.dirname(file), { recursive: true });
	if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) fs.writeFileSync(file, text);
	return file;
}

if (import.meta.filename === process.argv[1]) {
	// From `npm install`: a file that cannot be written is said, and the install goes on.
	try {
		const p = ports();
		const file = writeLaunchJson();
		if (file) console.log(`${path.relative(process.cwd(), file)}: previews at ${p.preview} and ${p.home}`);
	} catch (e) {
		console.warn(`.claude/launch.json was not written: ${e instanceof Error ? e.message : e}`);
	}
}
