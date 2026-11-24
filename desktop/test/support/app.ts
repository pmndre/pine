// The app a test starts: the build of this run, never desktop/dist of the checkout, which may be
// stale or half-written by another run.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ElectronApplication, Page } from "playwright-core";
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

/**
 * The app of this run, started with this environment, without a screen: its window is drawn and
 * never shown (PINE_DESKTOP_HEADLESS, electron/main.ts), so a run takes neither the owner's screen
 * nor their pointer and keys, and theirs never reach a test. A test that has to measure the real
 * window hands in `PINE_DESKTOP_HEADLESS: ""`; `PINE_DESKTOP_SHOW=1` shows the window of every test, to watch one.
 */
export async function launchApp(env: Record<string, string | undefined>): Promise<ElectronApplication> {
	const all = { ...env, PINE_DESKTOP_HEADLESS: process.env.PINE_DESKTOP_SHOW ? "" : (env.PINE_DESKTOP_HEADLESS ?? "1") };
	// Electron takes only set variables; a spread of process.env may hold unset ones.
	const set: Record<string, string> = {};
	for (const [name, value] of Object.entries(all)) if (value !== undefined) set[name] = value;
	const app = await electron.launch({ args: [await builtApp()], env: set });
	await quiet(app);
	return app;
}

/**
 * What the app would do in the owner's own session is noted instead, in `globalThis.quiet` of the
 * main process: a notification (with its sound), text on the clipboard, an address opened in the
 * browser, a file shown in the Finder, the app set to open at login, and a dialog of the system's,
 * which is answered as if it was cancelled. A test that is about one of them replaces it again.
 */
async function quiet(app: ElectronApplication): Promise<void> {
	await app.evaluate(({ app, clipboard, dialog, Notification, shell }: any) => {
		const noted = ((globalThis as any).quiet = { notified: [] as unknown[], opened: [] as string[], revealed: [] as string[], login: [] as unknown[], dialogs: [] as unknown[], clipboard: "" });
		Notification.prototype.show = function (this: any) {
			noted.notified.push({ title: this.title, body: this.body });
		};
		clipboard.writeText = (text: string) => void (noted.clipboard = String(text));
		clipboard.readText = () => noted.clipboard;
		shell.openExternal = async (url: string) => void noted.opened.push(url);
		shell.openPath = async (file: string) => (noted.opened.push(file), "");
		shell.showItemInFolder = (file: string) => void noted.revealed.push(file);
		shell.beep = () => {};
		app.setLoginItemSettings = (settings: unknown) => void noted.login.push(settings);
		const cancelled = (...args: any[]) => {
			const options = args.at(-1) ?? {};
			noted.dialogs.push(options);
			return Promise.resolve({ canceled: true, filePaths: [], filePath: "", response: options.cancelId ?? (options.buttons?.length ?? 1) - 1, checkboxChecked: false });
		};
		dialog.showOpenDialog = cancelled;
		dialog.showSaveDialog = cancelled;
		dialog.showMessageBox = cancelled;
	});
}

/**
 * Marks `target` as the focused BrowserWindow in headless tests without showing any OS window.
 * @param electronApp Running Electron application.
 * @param target Renderer page to focus.
 */
export async function focusWindow(electronApp: ElectronApplication, target: Page): Promise<void> {
	const handle = await electronApp.browserWindow(target);
	await electronApp.evaluate(({ BrowserWindow }: any, win: any) => {
		for (const other of BrowserWindow.getAllWindows()) {
			if (other !== win && !other.isDestroyed()) other.emit("blur");
		}
		if (!win.isDestroyed()) win.emit("focus");
	}, handle);
}

/**
 * Reads the screen bounds of `target`'s underlying BrowserWindow.
 * @param electronApp Running Electron application.
 * @param target Renderer page to inspect.
 */
export async function windowBounds(electronApp: ElectronApplication, target: Page): Promise<{ x: number; y: number; width: number; height: number }> {
	const handle = await electronApp.browserWindow(target);
	return handle.evaluate((win: any) => win.getBounds());
}

/**
 * Reads the native window title of `target`'s underlying BrowserWindow.
 * @param electronApp Running Electron application.
 * @param target Renderer page to inspect.
 */
export async function windowTitle(electronApp: ElectronApplication, target: Page): Promise<string> {
	const handle = await electronApp.browserWindow(target);
	return handle.evaluate((win: any) => win.getTitle());
}

/**
 * Clicks an item in the application menu by submenu and item label, returning its accelerator.
 * @param electronApp Running Electron application.
 * @param menuLabel Top-level menu label (for example `"File"`).
 * @param itemLabel Submenu item label (for example `"New Window"`).
 */
export async function clickMenuItem(electronApp: ElectronApplication, menuLabel: string, itemLabel: string): Promise<string | undefined> {
	return electronApp.evaluate(
		({ Menu }: any, [mLabel, iLabel]: [string, string]) => {
			const top = Menu.getApplicationMenu()?.items.find((m: any) => m.label === mLabel);
			const item = top?.submenu?.items.find((i: any) => i.label === iLabel);
			if (!item) throw new Error(`Menu item "${mLabel} > ${iLabel}" not found`);
			item.click(item, undefined, {});
			return item.accelerator;
		},
		[menuLabel, itemLabel] as [string, string],
	);
}

/**
 * Runs `trigger` and awaits the newly opened BrowserWindow page.
 * @param electronApp Running Electron application.
 * @param trigger Action that opens a new window.
 */
export async function openNewWindow(electronApp: ElectronApplication, trigger: () => Promise<unknown>): Promise<Page> {
	const wait = electronApp.waitForEvent("window");
	wait.catch(() => {});
	await trigger();
	const next = await wait;
	await next.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
	return next;
}

/**
 * Waits until `target`'s window closes.
 * @param target Renderer page expected to close.
 */
export async function waitClosed(target: Page): Promise<void> {
	if (target.isClosed()) return;
	await target.waitForEvent("close", { timeout: 15_000 });
}
