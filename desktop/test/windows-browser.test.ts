// Embedded agent browsers across multiple local windows: independent WebContentsView overlays at
// each window's own bounds and zoom factor, focus handoff with canvas fallback when two windows
// view the same browser tab, and clean detachment when a window closes without ending the tab.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Page } from "playwright-core";
import { WebSocket } from "ws";
import { startGuardProxy } from "../../mcp/browser.ts";
import { clickMenuItem, focusWindow, openNewWindow, waitClosed } from "./support/app.ts";
import { app, BROWSER_TOGGLE, home, json, page, putAwayToasts, sees, started, write } from "./support/window.ts";

let site: http.Server;
let siteBase = "";
let proxy: Awaited<ReturnType<typeof startGuardProxy>>;

interface HostedRoom {
	perm: string;
	ws: WebSocket;
	door: http.Server;
	doorFile: string;
	send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<any>;
	close(): Promise<void>;
}

const openRooms: HostedRoom[] = [];

async function waitHostUrl(): Promise<string> {
	const file = path.join(home, "data", "browser-view", "host.json");
	for (let i = 0; i < 200; i++) {
		const data = json(file);
		if (typeof data?.url === "string" && data.url.startsWith("ws://127.0.0.1:")) return data.url;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error(`BrowserHost url was not written to ${file}`);
}

async function createHostedRoom(perm: string, pagePath: string, title: string): Promise<HostedRoom> {
	const hostUrl = await waitHostUrl();
	const ws = new WebSocket(`${hostUrl}/${encodeURIComponent(perm)}?proxy=${proxy.port}`);
	let nextId = 1;
	const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
	ws.on("message", (raw) => {
		const msg = JSON.parse(String(raw));
		if (typeof msg.id === "number" && pending.has(msg.id)) {
			const p = pending.get(msg.id)!;
			pending.delete(msg.id);
			if (msg.error) p.reject(new Error(msg.error.message ?? "CDP error"));
			else p.resolve(msg.result);
		}
	});
	await new Promise<void>((resolve, reject) => {
		ws.once("open", () => resolve());
		ws.once("error", reject);
	});
	const send = (method: string, params?: Record<string, unknown>, sessionId?: string) =>
		new Promise<any>((resolve, reject) => {
			const id = nextId++;
			pending.set(id, { resolve, reject });
			ws.send(JSON.stringify({ id, method, ...(params ? { params } : {}), ...(sessionId ? { sessionId } : {}) }));
		});
	await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
	const fullUrl = `${siteBase}${pagePath}`;
	await send("Target.createTarget", { url: fullUrl });

	// Wait until the WebContentsView page has loaded the target URL.
	for (let i = 0; i < 100; i++) {
		const { targetInfos } = await send("Target.getTargets");
		if (targetInfos?.[0]?.url === fullUrl && targetInfos[0].title === title) break;
		await new Promise((r) => setTimeout(r, 50));
	}

	const picture = Buffer.from(
		await app.evaluate(({ nativeImage }: any) => nativeImage.createFromBitmap(Buffer.alloc(360 * 260 * 4, 190), { width: 360, height: 260 }).toJPEG(75).toString("base64")),
		"base64",
	);
	const token = "ab".repeat(32);
	const state = { open: true, hosted: true, tabs: [{ title, url: fullUrl }], current: 0, window: false, scale: 1 };
	const door = http.createServer((req, res) => {
		if (req.headers.authorization !== `Bearer ${token}`) return void res.writeHead(401).end();
		if (req.url === "/frame") return void res.writeHead(200, { "content-type": "image/jpeg" }).end(picture);
		res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(state));
	});
	await new Promise<void>((r) => door.listen(0, "127.0.0.1", r));
	const doorFile = path.join(home, "data", "browser-view", `${encodeURIComponent(perm)}.json`);
	write(doorFile, JSON.stringify({ port: (door.address() as AddressInfo).port, token, pid: process.pid }));

	const room: HostedRoom = {
		perm,
		ws,
		door,
		doorFile,
		send,
		async close() {
			fs.rmSync(doorFile, { force: true });
			if (ws.readyState === WebSocket.OPEN) {
				await send("Browser.close").catch(() => {});
				await new Promise<void>((r) => {
					ws.once("close", () => r());
					ws.close();
				});
			}
			await new Promise<void>((r) => door.close(() => r()));
		},
	};
	openRooms.push(room);
	return room;
}

async function childViewsOf(target: Page): Promise<Array<{ url: string; bounds: { x: number; y: number; width: number; height: number } }>> {
	const handle = await app.browserWindow(target);
	return handle.evaluate((win: any) =>
		win.contentView.children.map((v: any) => ({
			url: v.webContents.isDestroyed() ? "" : v.webContents.getURL(),
			bounds: v.getBounds(),
		})),
	);
}

async function expectedScaledPlace(target: Page): Promise<{ x: number; y: number; width: number; height: number }> {
	const handle = await app.browserWindow(target);
	const zoom = await handle.evaluate((win: any) => win.webContents.getZoomFactor());
	const raw = await target.$eval("[data-slot=browser-page]", (el: Element) => {
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
	});
	return {
		x: Math.round(raw.x * zoom),
		y: Math.round(raw.y * zoom),
		width: Math.round(raw.width * zoom),
		height: Math.round(raw.height * zoom),
	};
}

before(async () => {
	await started();
	site = http.createServer((req, res) => {
		const slug = (req.url ?? "/").slice(1) || "root";
		res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
			`<!doctype html><title>Page ${slug}</title><body style="margin:0;background:#eef"><h1 id="heading">Hello ${slug}</h1><input id="note" value="initial-${slug}"></body>`,
		);
	});
	await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
	siteBase = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
	proxy = await startGuardProxy({ allowPrivate: true });
});

after(async () => {
	for (const r of openRooms.splice(0)) await r.close().catch(() => {});
	await proxy?.close().catch(() => {});
	site?.close();
});

test("two local windows viewing different conversations' agent browsers display independent native WebContentsView overlays at their respective bounds and zoom factors", async () => {
	const mainRoom = await createHostedRoom("main:main", "/alpha", "Page alpha");
	const scoutRoom = await createHostedRoom("scout:main", "/beta", "Page beta");

	// Window 1 views main:main at zoom factor 1.25.
	await focusWindow(app, page);
	const win1Handle = await app.browserWindow(page);
	await win1Handle.evaluate((win: any) => win.webContents.setZoomFactor(1.25));
	await page.click(BROWSER_TOGGLE);
	await sees("[data-slot=browser] [data-slot=browser-page]");

	// Window 2 opens on the same local computer, switches to scout:main at zoom factor 1.0, and opens its Browser aside.
	const win2 = await openNewWindow(app, () => clickMenuItem(app, "File", "New Window"));
	await win2.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });
	await focusWindow(app, win2);
	const win2Handle = await app.browserWindow(win2);
	await win2Handle.evaluate((win: any) => win.webContents.setZoomFactor(1.0));
	await win2.locator("[data-slot=sidebar-menu-item]:has([data-slot=agent-label])", { has: win2.locator("[data-slot=agent-label] > :first-child", { hasText: /^scout$/ }) }).locator("[data-slot=agent-label]").click();
	await win2.waitForSelector("[data-slot=tab][data-active]", { timeout: 20_000 });
	await win2.click(BROWSER_TOGGLE);
	await win2.waitForSelector("[data-slot=browser] [data-slot=browser-page]", { timeout: 20_000 });

	try {
		// Both windows simultaneously hold their own native WebContentsView child at each window's scaled bounds!
		let matched = false;
		for (let i = 0; i < 60; i++) {
			const [views1, views2, place1, place2] = await Promise.all([
				childViewsOf(page),
				childViewsOf(win2),
				expectedScaledPlace(page),
				expectedScaledPlace(win2),
			]);
			if (
				views1.length === 1 &&
				views1[0].url === `${siteBase}/alpha` &&
				JSON.stringify(views1[0].bounds) === JSON.stringify(place1) &&
				views2.length === 1 &&
				views2[0].url === `${siteBase}/beta` &&
				JSON.stringify(views2[0].bounds) === JSON.stringify(place2)
			) {
				matched = true;
				break;
			}
			await new Promise((r) => setTimeout(r, 50));
		}
		assert.equal(matched, true, `expected independent WebContentsView overlays on both windows: win1=${JSON.stringify(await childViewsOf(page))}, win2=${JSON.stringify(await childViewsOf(win2))}`);
		assert.equal(await page.$("[data-slot=browser] canvas"), null);
		assert.equal(await win2.$("[data-slot=browser] canvas"), null);

		// Resizing unfocused Window 1 while Window 2 stays focused updates Window 1's overlay bounds in Window 1 without stealing or removing Window 2's overlay!
		await page.setViewportSize({ width: 1360, height: 840 });
		let resizedMatched = false;
		for (let i = 0; i < 60; i++) {
			const [views1, views2, place1, place2] = await Promise.all([
				childViewsOf(page),
				childViewsOf(win2),
				expectedScaledPlace(page),
				expectedScaledPlace(win2),
			]);
			if (
				views1.length === 1 &&
				views1[0].url === `${siteBase}/alpha` &&
				JSON.stringify(views1[0].bounds) === JSON.stringify(place1) &&
				views2.length === 1 &&
				views2[0].url === `${siteBase}/beta` &&
				JSON.stringify(views2[0].bounds) === JSON.stringify(place2)
			) {
				resizedMatched = true;
				break;
			}
			await new Promise((r) => setTimeout(r, 50));
		}
		assert.equal(resizedMatched, true, `resizing unfocused Window 1 must keep each overlay on its own window: win1=${JSON.stringify(await childViewsOf(page))}, win2=${JSON.stringify(await childViewsOf(win2))}`);

		// Opening a dialog over unfocused Window 1 hides only Window 1's WebContentsView (replacing it with a still picture), leaving focused Window 2's overlay attached!
		await win1Handle.evaluate((win: any) => win.webContents.send("pine:menu", "palette"));
		await page.waitForSelector("[data-slot=browser-page] img", { timeout: 10_000 });
		assert.equal((await childViewsOf(page)).length, 0);
		assert.equal((await childViewsOf(win2)).length, 1);
		assert.equal((await childViewsOf(win2))[0].url, `${siteBase}/beta`);
		await page.keyboard.press("Escape");
		await page.waitForFunction(() => !document.querySelector("[data-slot=browser-page] img"), undefined, { timeout: 10_000 });
	} finally {
		await win1Handle.evaluate((win: any) => win.webContents.setZoomFactor(1.0)).catch(() => {});
		await page.setViewportSize({ width: 1280, height: 820 }).catch(() => {});
		if (!win2.isClosed()) {
			await focusWindow(app, win2);
			await clickMenuItem(app, "File", "Close Window");
			await waitClosed(win2);
		}
		await focusWindow(app, page);
		if (await page.$("[data-slot=browser-aside]")) {
			await page.click(BROWSER_TOGGLE);
			await page.waitForSelector("[data-slot=browser-aside]", { state: "detached" });
		}
		await mainRoom.close();
		await scoutRoom.close();
	}
});

test("when two local windows view the same agent browser tab, the focused window attaches the native WebContentsView while the unfocused window falls back to the frame canvas and hands over on focus", async () => {
	const sharedRoom = await createHostedRoom("main:main", "/shared", "Page shared");
	await focusWindow(app, page);
	await page.click(BROWSER_TOGGLE);
	await sees("[data-slot=browser] [data-slot=browser-page]");

	// Open Window 2 on main:main while keeping Window 1 focused.
	const win2 = await openNewWindow(app, () => clickMenuItem(app, "File", "New Window"));
	await win2.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });
	await win2.locator("[data-slot=no-tab] button").nth(1).click();
	await win2.waitForSelector("[data-slot=tab][data-active]", { timeout: 20_000 });
	await focusWindow(app, page);

	try {
		// Unfocused Window 2 opens the Browser aside on the same main:main tab and immediately falls back to canvas without a multi-second blank stall.
		await win2.click(BROWSER_TOGGLE);
		await win2.waitForSelector("[data-slot=browser] canvas[data-drawn]", { timeout: 2000 });
		assert.equal(await win2.$("[data-slot=browser] [data-slot=browser-page]"), null);
		assert.equal((await childViewsOf(win2)).length, 0);
		assert.equal((await childViewsOf(page)).length, 1);
		assert.equal((await childViewsOf(page))[0].url, `${siteBase}/shared`);

		// Across status polls, unfocused Window 2 stays stably on canvas without flickering back to browser-page.
		await new Promise((r) => setTimeout(r, 900));
		assert.equal(await win2.$("[data-slot=browser] [data-slot=browser-page]"), null);
		assert.ok(await win2.$("[data-slot=browser] canvas[data-drawn]"));

		// Focusing Window 2 hands the live WebContentsView overlay over to Window 2 while Window 1 transitions cleanly to canvas!
		await focusWindow(app, win2);
		await win2.waitForSelector("[data-slot=browser] [data-slot=browser-page]", { timeout: 2000 });
		await page.waitForSelector("[data-slot=browser] canvas[data-drawn]", { timeout: 2000 });
		assert.equal(await win2.$("[data-slot=browser] canvas"), null);
		assert.equal(await page.$("[data-slot=browser] [data-slot=browser-page]"), null);

		for (let i = 0; i < 40; i++) {
			const [v1, v2, p2] = await Promise.all([childViewsOf(page), childViewsOf(win2), expectedScaledPlace(win2)]);
			if (v1.length === 0 && v2.length === 1 && JSON.stringify(v2[0].bounds) === JSON.stringify(p2)) break;
			if (i === 39) assert.fail(`expected Window 2 to own WebContentsView at its bounds: v1=${JSON.stringify(v1)}, v2=${JSON.stringify(v2)}, p2=${JSON.stringify(p2)}`);
			await new Promise((r) => setTimeout(r, 50));
		}

		// Focusing Window 1 again hands the live WebContentsView back to Window 1 while Window 2 returns to canvas.
		await focusWindow(app, page);
		await page.waitForSelector("[data-slot=browser] [data-slot=browser-page]", { timeout: 2000 });
		await win2.waitForSelector("[data-slot=browser] canvas[data-drawn]", { timeout: 2000 });
		assert.equal((await childViewsOf(page)).length, 1);
		assert.equal((await childViewsOf(win2)).length, 0);
	} finally {
		if (!win2.isClosed()) {
			await focusWindow(app, win2);
			await clickMenuItem(app, "File", "Close Window");
			await waitClosed(win2);
		}
		await focusWindow(app, page);
		if (await page.$("[data-slot=browser-aside]")) {
			await page.click(BROWSER_TOGGLE);
			await page.waitForSelector("[data-slot=browser-aside]", { state: "detached" });
		}
		await sharedRoom.close();
	}
});

test("closing a local window or switching it to an SSH machine detaches its WebContentsView cleanly while keeping the browser tab and its live DOM state intact", async () => {
	const persistRoom = await createHostedRoom("main:main", "/persist", "Page persist");

	// Window 1 opens Browser aside on main:main, then Window 2 opens main:main, takes focus, and edits the live DOM inside the WebContentsView.
	await focusWindow(app, page);
	await page.click(BROWSER_TOGGLE);
	await sees("[data-slot=browser] [data-slot=browser-page]");

	const win2 = await openNewWindow(app, () => clickMenuItem(app, "File", "New Window"));
	await win2.waitForSelector("[data-slot=no-tab]", { timeout: 20_000 });
	await win2.locator("[data-slot=no-tab] button").nth(1).click();
	await win2.waitForSelector("[data-slot=tab][data-active]", { timeout: 20_000 });
	await focusWindow(app, win2);
	await win2.click(BROWSER_TOGGLE);
	await win2.waitForSelector("[data-slot=browser] [data-slot=browser-page]", { timeout: 10_000 });
	await page.waitForSelector("[data-slot=browser] canvas[data-drawn]", { timeout: 2000 });

	try {
		// Locate the live WebContentsView page via Playwright and mutate its input value.
		let embeddedPage: Page | undefined;
		for (let i = 0; i < 60; i++) {
			embeddedPage = app.context().pages().find((p: Page) => p.url() === `${siteBase}/persist`);
			if (embeddedPage) break;
			await new Promise((r) => setTimeout(r, 50));
		}
		assert.ok(embeddedPage, "expected Playwright to see the hosted WebContentsView page");
		await embeddedPage.fill("#note", "typed-in-win2");
		assert.equal(await embeddedPage.inputValue("#note"), "typed-in-win2");

		// Close Window 2 while its WebContentsView is actively attached!
		await clickMenuItem(app, "File", "Close Window");
		await waitClosed(win2);

		// The browser tab must still be alive in BrowserHost with its DOM state intact.
		const { targetInfos } = await persistRoom.send("Target.getTargets");
		assert.equal(targetInfos.length, 1);
		assert.equal(targetInfos[0].url, `${siteBase}/persist`);

		// Focusing Window 1 hands the surviving WebContentsView over to Window 1 with "typed-in-win2" still in #note!
		await focusWindow(app, page);
		await page.waitForSelector("[data-slot=browser] [data-slot=browser-page]", { timeout: 5000 });
		assert.equal((await childViewsOf(page)).length, 1);
		assert.equal(await embeddedPage.inputValue("#note"), "typed-in-win2");

		// Switching Window 1 to a remote SSH host detaches the local WebContentsView without closing the tab, and switching back re-attaches it.
		await page.evaluate(() => (window as any).pine.addHost("you@elsewhere"));
		await page.evaluate(() => (window as any).pine.use("you@elsewhere"));
		await page.waitForSelector("[data-slot=empty] >> text=The main agent of the other machine", { timeout: 60_000 });
		assert.equal((await childViewsOf(page)).length, 0);
		assert.equal((await persistRoom.send("Target.getTargets")).targetInfos.length, 1);

		await page.evaluate(() => (window as any).pine.use(undefined));
		await page.waitForSelector("[data-slot=browser] [data-slot=browser-page]", { timeout: 20_000 });
		await putAwayToasts();
		for (let i = 0; i < 40 && (await childViewsOf(page)).length !== 1; i++) await new Promise((r) => setTimeout(r, 50));
		assert.equal((await childViewsOf(page)).length, 1);
		assert.equal(await embeddedPage.inputValue("#note"), "typed-in-win2");
	} finally {
		if (!win2.isClosed()) {
			await focusWindow(app, win2);
			await clickMenuItem(app, "File", "Close Window");
			await waitClosed(win2);
		}
		const currentHost = await page.evaluate(() => (window as any).pine.state().then((s: any) => s.state.host));
		if (currentHost) {
			await page.evaluate(() => (window as any).pine.use(undefined));
			await page.waitForSelector("[data-slot=room]", { timeout: 60_000 });
		}
		await page.evaluate(() => (window as any).pine.forgetHost("you@elsewhere")).catch(() => {});
		await focusWindow(app, page);
		if (await page.$("[data-slot=browser-aside]")) {
			await page.click(BROWSER_TOGGLE);
			await page.waitForSelector("[data-slot=browser-aside]", { state: "detached" });
		}
		await persistRoom.close();
	}
});
