// A headless Chrome for Testing on a page of the test's own that carries the browser build of
// `entry`. Launched with a throwaway profile and no access to the login keychain; never a
// visible window.

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { bundle } from "../scripts/bundle.ts";

/** Chrome for Testing as Playwright installed it, the newest build there is. */
export function chromeForTesting(): string {
	if (process.env.PINE_CHROME) return process.env.PINE_CHROME;
	const own = chromium.executablePath();
	if (existsSync(own)) return own;
	const cache = join(homedir(), "Library", "Caches", "ms-playwright");
	const builds = existsSync(cache) ? readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9))) : [];
	for (const name of builds) {
		for (const arch of ["chrome-mac-arm64", "chrome-mac"]) {
			const path = join(cache, name, arch, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
			if (existsSync(path)) return path;
		}
	}
	throw new Error("No Chrome for Testing: run `npx playwright-core install chromium` in web/, or set PINE_CHROME to its executable.");
}

/** A headless Chrome for Testing on a profile of its own, removed when it stops. */
export async function headless(): Promise<{ context: BrowserContext; page: Page; stop(): Promise<void> }> {
	const userDataDir = mkdtempSync(join(tmpdir(), "pine-web-chrome-"));
	const context = await chromium.launchPersistentContext(userDataDir, {
		headless: true,
		executablePath: chromeForTesting(),
		args: ["--use-mock-keychain", "--password-store=basic"],
	});
	const page = context.pages()[0] ?? (await context.newPage());
	page.on("pageerror", (error) => console.error("page error:", error));
	return {
		context,
		page,
		async stop() {
			await context.close();
			rmSync(userDataDir, { recursive: true, force: true });
		},
	};
}

export type Browser = { page: Page; stop(): Promise<void> };

export async function openPage(entry: string): Promise<Browser> {
	const script = await bundle(entry);
	const server: Server = createServer((req, res) => {
		if (req.url === "/bundle.js") {
			res.writeHead(200, { "content-type": "text/javascript" });
			res.end(script);
			return;
		}
		res.writeHead(200, { "content-type": "text/html" });
		res.end('<!doctype html><meta charset="utf-8"><script src="/bundle.js"></script>');
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const browser = await headless();
	await browser.page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
	return {
		page: browser.page,
		async stop() {
			await browser.stop();
			server.close();
		},
	};
}
