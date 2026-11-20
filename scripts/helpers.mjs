// Builds pine's helpers (voice, app control, the `system` source) for both kinds of Mac and puts
// them into a pine folder, beside their sources, where pine looks for them (src/prebuilt.ts).
// For the Pine app, which carries pine whole: a Mac without Apple's developer tools then has them.
//   node scripts/helpers.mjs <pine folder>      the package `npm run build` makes, or a copy of it
// Needs the macOS 26 SDK or a newer one (Xcode 26, or the command line tools of that time): the voice
// helper uses the speech recognition macOS 26 brought, where a Mac has it.
//
// Each helper is built by pine's own function, as it would be on first use, so its name and what
// goes into it are decided in one place. The only difference: every compiler call is made once
// for each processor, and the two results are joined into one program.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildHelper as buildComputer } from "../mcp/computer.ts";
import { buildHelper as buildSystem } from "../src/sources/system.ts";
import { buildVoice } from "../src/tui/voice.ts";

/** The oldest macOS the helpers are to start on: the oldest one the app's Electron runs on. */
const OLDEST = "13.0";
const KINDS = ["arm64", "x86_64"];

const tree = process.argv[2] && path.resolve(process.argv[2]);
if (!tree || !fs.existsSync(path.join(tree, "package.json"))) {
	console.error("usage: node scripts/helpers.mjs <pine folder>");
	process.exit(2);
}
// Windows: the C# helpers, built with the compiler Windows carries, as each is built on first use.
if (process.platform === "win32") {
	const { buildCsharp } = await import("../src/csharp.ts");
	const { buildSystemWindows } = await import("../src/sources/system.ts");
	const { buildVoiceWindows } = await import("../src/tui/voice.ts");
	const { windowsHelper } = await import("../mcp/computer.ts");
	const into = (source) => {
		const dir = path.join(tree, path.dirname(source), "prebuilt");
		fs.mkdirSync(dir, { recursive: true });
		return { from: path.join(tree, source), dir };
	};
	try {
		const system = into("src/sources/system.cs");
		const voice = into("src/tui/voice.cs");
		const computer = into("mcp/computer.cs");
		const built = [
			buildSystemWindows(system.dir, system.from),
			buildVoiceWindows(voice.dir, { source: voice.from }),
			await windowsHelper((_source, prefix, what, refs) => buildCsharp(computer.from, prefix, what, refs, { dir: computer.dir })),
		];
		for (const file of built) console.log(path.relative(tree, file));
	} catch (e) {
		console.error(e.message);
		process.exitCode = 1;
	}
	process.exit();
}
if (process.platform !== "darwin") {
	console.error("The helpers are built on a Mac (Swift) or on Windows (C#). On Linux they are pine's own code and need no build.");
	process.exit(process.platform === "linux" ? 0 : 1);
}

const run = (file, args, ms) =>
	new Promise((resolve) => {
		execFile(file, args, { timeout: ms, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
	});

/** What a build function runs, with the compiler called for every processor. */
const forBoth = async (file, args, ms) => {
	const at = args.indexOf("-o");
	if (file !== "/usr/bin/swiftc" || at < 0) return run(file, args, ms);
	const out = args[at + 1];
	const parts = [];
	try {
		for (const kind of KINDS) {
			const part = `${out}.${kind}`;
			parts.push(part);
			const built = await run(file, [...args.slice(0, at), "-o", part, ...args.slice(at + 2), "-target", `${kind}-apple-macos${OLDEST}`], ms);
			if (built.code !== 0) return built;
		}
		return await run("/usr/bin/lipo", ["-create", "-output", out, ...parts], 60_000);
	} finally {
		for (const part of parts) fs.rmSync(part, { force: true });
	}
};

const work = fs.mkdtempSync(path.join(os.tmpdir(), "pine-helpers-"));
try {
	for (const [source, build] of [
		["src/tui/voice.swift", buildVoice],
		["mcp/computer.swift", buildComputer],
		["src/sources/system.swift", buildSystem],
	]) {
		const from = path.join(tree, source);
		const dir = path.join(path.dirname(from), "prebuilt");
		// One of an earlier run would be handed back as it is, whatever it was built for.
		fs.rmSync(dir, { recursive: true, force: true });
		const built = await build(path.join(work, path.basename(source)), from, forBoth);
		fs.mkdirSync(dir, { recursive: true });
		const to = path.join(dir, path.basename(built));
		fs.copyFileSync(built, to);
		fs.chmodSync(to, 0o755);
		const kinds = (await run("/usr/bin/lipo", ["-archs", to], 10_000)).stdout.trim();
		if (KINDS.some((k) => !kinds.split(" ").includes(k))) throw new Error(`${to} is for "${kinds}", not for both kinds of Mac`);
		console.log(`${path.relative(tree, to)} (${kinds})`);
	}
} catch (e) {
	console.error(e.message);
	process.exitCode = 1;
} finally {
	fs.rmSync(work, { recursive: true, force: true });
}
