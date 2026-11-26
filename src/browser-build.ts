// The browser the web tools drive: whether the build pine needs is on this computer.
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** Playwright's own command, of the copy pine ships with: the one @playwright/mcp brought along (pine does not depend on playwright-core itself). */
export const playwrightCli = () => path.join(path.dirname(createRequire(createRequire(import.meta.url).resolve("@playwright/mcp")).resolve("playwright-core")), "cli.js");

/**
 * The folders Playwright keeps what it needs in: the browser build of this Playwright and what
 * goes with it. Playwright itself is asked (its installer, told to fetch nothing). Nothing when
 * it cannot be asked.
 */
export function browserPlaces(): Promise<string[] | undefined> {
	return new Promise((resolve) => {
		let cli: string;
		try {
			cli = playwrightCli();
		} catch {
			return resolve(undefined);
		}
		execFile(process.execPath, [cli, "install", "--dry-run", "chromium"], { encoding: "utf8", timeout: 20_000 }, (error, stdout) => {
			const places = [...String(stdout ?? "").matchAll(/^\s*Install location:\s*(.+?)\s*$/gm)].map((m) => m[1]);
			resolve(error || !places.length ? undefined : places);
		});
	});
}

/**
 * Whether the browser build pine's Playwright drives is on this computer. Each Playwright wants
 * builds of its own, so a pine that became a newer one without fetching (a new Pine app in place
 * of an old one, a home that an older pine set up) has a browser on disk and not the one it
 * needs. A folder Playwright finished carries its mark.
 *
 * Nothing when Playwright cannot be asked: then nobody is told that anything is missing.
 */
export async function browserReady(): Promise<boolean | undefined> {
	const places = await browserPlaces();
	return places?.every((dir) => fs.existsSync(path.join(dir, "INSTALLATION_COMPLETE")));
}
