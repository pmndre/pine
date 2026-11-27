// The app a test starts: the build of this run, never desktop/dist of the checkout, which may be
// stale or half-written by another run.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ElectronApplication, Page } from "playwright-core";
import { _electron as electron } from "playwright-core";
import { buildApp } from "../../scripts/build.mjs";

/** Trigger an action that opens a new BrowserWindow and return its Playwright Page. */
export async function waitForWindow(app: ElectronApplication, trigger: () => Promise<unknown>): Promise<Page> {
	const [win] = await Promise.all([app.waitForEvent("window"), trigger()]);
	await win.waitForLoadState("domcontentloaded");
	return win;
}

/** Trigger an application menu item by label path (e.g. ["File", "New Window"]). Windows are indexed in creation order (BrowserWindow.id). */
export async function clickMenu(app: ElectronApplication, labels: string[], focusedIndex?: number): Promise<void> {
	await app.evaluate(
		({ BrowserWindow, Menu }: any, [pathLabels, idx]: [string[], number | undefined]) => {
			const wins = [...BrowserWindow.getAllWindows()].sort((a: any, b: any) => a.id - b.id);
			const target = idx !== undefined ? wins[idx] : undefined;
			if (target && !target.isDestroyed()) target.emit("focus");
			const menu = Menu.getApplicationMenu();
			if (!menu) throw new Error("No application menu");
			let current = menu;
			let found: any;
			for (const label of pathLabels) {
				found = current.items.find((i: any) => i.label === label);
				if (!found) throw new Error(`Menu item "${label}" not found in [${current.items.map((i: any) => i.label).join(", ")}]`);
				if (found.submenu) current = found.submenu;
			}
			if (typeof found?.click !== "function") throw new Error(`Menu item "${pathLabels.join(" > ")}" has no click handler`);
			found.click(found, target ?? wins[0], undefined);
		},
		[labels, focusedIndex] as [string[], number | undefined],
	);
}

/** Bounds of every open BrowserWindow in creation order. */
export async function allWindowBounds(app: ElectronApplication): Promise<Array<{ x: number; y: number; width: number; height: number }>> {
	return app.evaluate(({ BrowserWindow }: any) => [...BrowserWindow.getAllWindows()].sort((a: any, b: any) => a.id - b.id).map((w: any) => w.getBounds()));
}

/** Number of open BrowserWindows in the Electron process. */
export async function windowCount(app: ElectronApplication): Promise<number> {
	return app.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows().length);
}

/** Send a `pine:menu` command to a specific BrowserWindow by creation-order index. */
export async function sendMenuTo(app: ElectronApplication, index: number, command: string): Promise<void> {
	await app.evaluate(
		({ BrowserWindow }: any, [i, c]: [number, string]) => {
			const wins = [...BrowserWindow.getAllWindows()].sort((a: any, b: any) => a.id - b.id);
			const w = wins[i];
			if (!w) throw new Error(`No window at index ${i}`);
			w.webContents.send("pine:menu", c);
		},
		[index, command] as [number, string],
	);
}

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
/**
 * How much longer than on a desk to wait, as the root suite's `PATIENCE` (test/support/harness.ts):
 * the Test workflow sets PINE_TEST_PATIENCE=4, since a runner of GitHub's with two processors and
 * several apps side by side is that much slower. Only how long is waited changes, never what for.
 */
export const PATIENCE = Math.max(1, Number(process.env.PINE_TEST_PATIENCE) || 1);
/** A wait of `ms` on a desk, as long as it has to be here. */
export const patient = (ms: number) => ms * PATIENCE;

export async function launchApp(env: Record<string, string | undefined>): Promise<ElectronApplication> {
	// The app's pine looks for the owner's browsers in their account ("Your own browser"): in a test, in an account
	// with none unless the test names one, so that no test finds, asks about or writes into the developer's browsers.
	const all = { ...env, PINE_CHROME_ACCOUNT: env.PINE_CHROME_ACCOUNT ?? path.join(os.tmpdir(), "pine-test-no-browsers"), PINE_DESKTOP_HEADLESS: process.env.PINE_DESKTOP_SHOW ? "" : (env.PINE_DESKTOP_HEADLESS ?? "1") };
	// Electron takes only set variables; a spread of process.env may hold unset ones.
	const set: Record<string, string> = {};
	for (const [name, value] of Object.entries(all)) if (value !== undefined) set[name] = value;
	const app = await electron.launch({ args: [await builtApp()], env: set, timeout: patient(30_000) });
	// What a test waits for without saying how long (Playwright's 30 seconds) waits as long as the rest, but never
	// as long as a test may take (two minutes, package.json): a wait that runs out then says what it waited for,
	// where one that outlasted the test would leave only "test timed out".
	app.context().setDefaultTimeout(Math.min(patient(30_000), 60_000));
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
		// A Linux runner under xvfb has no notification server, so Electron says notifications are not
		// supported there and the app would note nothing: what the app would show is what is tested.
		Notification.isSupported = () => true;
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
