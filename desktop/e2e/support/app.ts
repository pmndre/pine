// The app a test starts: the build of this run, never desktop/dist of the checkout, which may be
// stale or half-written by another run.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ElectronApplication } from "playwright-core";
import { _electron as electron } from "playwright-core";
import { buildApp } from "../../scripts/build.mjs";

let built: Promise<string> | undefined;

/**
 * The folder Electron is started with: the one `npm test` built for this run (scripts/test.mjs
 * names it in PINE_DESKTOP_APP), or, for a file run on its own, one built now into a temp folder
 * that goes when this process ends.
 */
export function builtApp(): Promise<string> {
	built ??= (async () => {
		if (process.env.PINE_DESKTOP_APP) return process.env.PINE_DESKTOP_APP;
		const into = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-app-")));
		process.once("exit", () => fs.rmSync(into, { recursive: true, force: true }));
		return (await buildApp(into)) as string;
	})();
	return built;
}

/** The app of this run, started with this environment. */
export async function launchApp(env: Record<string, string | undefined>): Promise<ElectronApplication> {
	// Electron takes only set variables; a spread of process.env may hold unset ones.
	const set: Record<string, string> = {};
	for (const [name, value] of Object.entries(env)) if (value !== undefined) set[name] = value;
	return electron.launch({ args: [await builtApp()], env: set });
}
