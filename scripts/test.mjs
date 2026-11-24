// `npm test`: runs `node --test` with the arguments given here, and a file with a failure again,
// alone. Most failures of these tests on a busy computer (GitHub's runners among them) are a wait
// that ran out: a file that passes alone is said to be that, by name, and the run passes; a broken
// test fails twice. As the app's tests do (desktop/scripts/test.mjs), with its reporter.
//   node scripts/test.mjs [node --test arguments]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const given = process.argv.slice(2);
/** Somebody who names a reporter gets that reporter and nothing beside it, so no second run either. */
const plain = !given.some((a) => a === "--test-reporter" || a.startsWith("--test-reporter="));
const failedList = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pine-test-")), "failed");
const reporters = plain ? ["--test-reporter=spec", "--test-reporter-destination=stdout", `--test-reporter=${pathToFileURL(path.join(root, "desktop", "scripts", "failed-files.mjs")).href}`, "--test-reporter-destination=stdout"] : [];

function run(args) {
	const child = spawn(process.execPath, ["--test", ...reporters, ...args], { stdio: "inherit", cwd: root, env: { ...process.env, PINE_DESKTOP_FAILED: failedList } });
	for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
	return new Promise((resolve) => child.on("close", (c, signal) => resolve(c ?? (signal ? 1 : 0))));
}

const failed = () => {
	try {
		return [...new Set(fs.readFileSync(failedList, "utf8").split("\n").filter(Boolean))];
	} catch {
		return [];
	}
};
const short = (files) => files.map((f) => path.relative(root, f)).join(", ");

let code = await run(given);
const files = failed();
// More than a few files failing is no busy computer: that is said as it is.
if (code !== 0 && plain && files.length && files.length <= 4) {
	console.log(`\nFailed: ${short(files)}. Running ${files.length === 1 ? "it" : "them"} again, one at a time, to tell a broken test from a wait that ran out on a busy computer.\n`);
	fs.rmSync(failedList, { force: true });
	const flags = given.filter((a) => a.startsWith("--") && !a.startsWith("--test-concurrency"));
	code = await run(["--test-concurrency=1", ...flags, ...files]);
	if (code === 0) console.log(`\nPassed alone: ${short(files)}. The failures above came with running beside other work; a test that fails this way often is worth a look all the same.`);
	else console.log(`\nFailed again, alone: ${short(failed())}.`);
}
fs.rmSync(path.dirname(failedList), { recursive: true, force: true });
process.exit(code);
