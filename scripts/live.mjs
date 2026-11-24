// `npm run test:live`: the slow tests against the real model, browser and helpers, with PINE_LIVE=1.
// A script and not `PINE_LIVE=1 node ...` in package.json, because cmd.exe, which runs npm's
// scripts on Windows, has no such syntax.
//   node scripts/live.mjs [more node --test arguments or files]
import { spawn } from "node:child_process";

const FILES = ["test/live.test.ts", "test/browser.test.ts", "test/computer.test.ts", "test/voice.test.ts", "test/system.test.ts", "test/render.test.ts"];
const more = process.argv.slice(2);
const files = more.some((a) => !a.startsWith("-")) ? [] : FILES;

const child = spawn(process.execPath, ["--test", "--test-force-exit", ...more, ...files], { stdio: "inherit", env: { ...process.env, PINE_LIVE: "1" } });
child.on("close", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
