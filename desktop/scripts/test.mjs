// `npm test` in desktop/: builds the app once for this run, into a temp folder of its own, then
// runs `node --test` with the arguments given here and PINE_DESKTOP_APP naming that build
// (e2e/support/app.ts launches it). The folder is removed at the end. A test file run on its own
// builds for itself instead.
//   node scripts/test.mjs [node --test arguments]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "./build.mjs";
import { whenParentGone } from "./leash.mjs";

const into = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-app-")));
process.once("exit", () => fs.rmSync(into, { recursive: true, force: true }));
let child;
let leaving = false;

// Whoever started the run is gone, or it was interrupted: the tests and their apps go with it.
whenParentGone(() => {
	leaving = true;
	if (!child || child.exitCode !== null) process.exit(1);
	child.kill("SIGTERM");
	setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
});

try {
	const app = await buildApp(into);
	if (leaving) throw new Error("stopped before the tests started");
	child = spawn(process.execPath, ["--test", ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, PINE_DESKTOP_APP: app } });
	const code = await new Promise((resolve) => child.on("close", (c, signal) => resolve(c ?? (signal ? 1 : 0))));
	process.exit(leaving ? 1 : code);
} catch (e) {
	console.error(`The app could not be built for the tests: ${e instanceof Error ? e.message : e}`);
	process.exit(1);
}
