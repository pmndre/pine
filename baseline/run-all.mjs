// Runs every baseline suite against the scripted mock model server. No network, no real model.
// Each suite's output goes to results/<suite>.log; the exit code of each is printed.
//   node baseline/run-all.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SUITES = ["t00-smoke", "t01-multi-cwd", "t02-queue", "t03-tools", "t04-context", "t04b-timeouts-trust", "t05-mcp", "t05b-mcp-lifecycle", "t06-subagents", "t07-misc"];

fs.mkdirSync(path.join(here, "results"), { recursive: true });
for (const t of SUITES) {
	// One file for both streams, in the order they were written, as `> log 2>&1` did.
	const log = fs.openSync(path.join(here, "results", `${t}.log`), "w");
	const r = spawnSync(process.execPath, ["--expose-gc", path.join("tests", `${t}.mjs`)], { cwd: here, stdio: ["ignore", log, log] });
	fs.closeSync(log);
	console.log(`${t} exit=${r.status ?? r.signal}`);
}
