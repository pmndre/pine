// The first start: no pine home yet, and "Set up pine" runs `pine init`. On Linux that sets up the
// sandbox, which needs an administrator: the app lets pine say what it would run and runs none of
// it, and the setup screen leaves it to the owner (electron/main.ts, Gate in src/App.tsx).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { launchApp } from "./support/app.ts";

const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-setup-")));
const log = path.join(dir, "calls");
let app: any;
after(async () => {
	await app?.close().catch(() => {});
	fs.rmSync(dir, { recursive: true, force: true });
});

// A stand-in for pine: no home until init; init sets up the sandbox with pine's own code and words,
// on a machine that lacks bubblewrap, where nobody answers its question (no terminal), and whose
// steps, run after a yes, only say so.
const standIn = path.join(dir, "pine.mjs");
fs.writeFileSync(standIn, `
import fs from "node:fs";
import { setUpSandbox } from ${JSON.stringify(path.resolve(import.meta.dirname, "..", "..", "src", "sandbox-setup.ts"))};
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
if (args[0] === "service") {
	console.log(JSON.stringify({ error: "There is no pine home here yet: run pine init first." }));
	process.exit(1);
}
if (args[0] === "init") {
	const programs = ["apt-get", "sudo", "apparmor_parser"];
	await setUpSandbox({
		out: (line) => console.log(line),
		yes: args.includes("--yes"),
		confirm: async () => undefined,
		machine: () => ({ works: false, apparmor: true, profile: false, root: false, container: false, aptEmpty: false, browserLacks: [], has: (p) => programs.includes(p) }),
		run: () => 0,
	});
}
process.exit(0);
`);

test("Set up pine runs nothing as administrator on Linux: what needs one is shown for a terminal, and the screen waits for Try again", async () => {
	app = await launchApp({ ...process.env, PINE_CLI: standIn, PINE_HOME: path.join(dir, "home"), PINE_DESKTOP_DATA: path.join(dir, "desktop-data"), PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "" });
	const page = await app.firstWindow();
	const calls = () => fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
	const services = () => calls().filter((c) => c[0] === "service").length;
	await page.getByRole("button", { name: "Set up pine" }).click({ timeout: 30_000 });
	await page.waitForFunction(() => !document.body.textContent?.includes("Setting up…"), undefined, { timeout: 30_000 });
	const init = calls().find((c) => c[0] === "init")!;
	if (process.platform === "linux") {
		assert.ok(!init.includes("--yes"), `pine init was told to run what needs an administrator: ${init.join(" ")}`);
		// What pine would run is on the screen, with what to do; pine is not asked again by itself.
		await page.locator("[data-slot=toast]", { hasText: "Part of it needs an administrator" }).waitFor({ timeout: 10_000 });
		assert.match(await page.textContent("body"), /sudo apt-get install -y bubblewrap/);
		const before = services();
		await new Promise((r) => setTimeout(r, 500));
		assert.equal(services(), before, "the app asked for its pine again while what needs an administrator was not done");
	} else {
		// Elsewhere --yes sets up nothing as administrator, and the app goes on to its pine at once.
		assert.ok(init.includes("--yes"));
		for (let i = 0; i < 50 && services() < 2; i++) await new Promise((r) => setTimeout(r, 100));
		assert.ok(services() >= 2, "the app did not ask for its pine again after pine init");
	}
});
