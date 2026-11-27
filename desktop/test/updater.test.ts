// Squirrel.Mac updater guard (electron/squirrel.ts): restarting Pine while ShipIt is still
// copying the previous update must not call autoUpdater.checkForUpdates() and wipe update.*.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createSquirrelUpdater, plistString, type SquirrelAutoUpdater } from "../electron/squirrel.ts";
import type { UpdaterState } from "../electron/updates.ts";

const FEED = "https://github.com/pmndre/pine/releases/download/v0.58.0/Pine-arm64.json";

function harness(init: { current?: string; disk?: string; shipIt?: boolean; pollMs?: number } = {}) {
	const emitter = new EventEmitter();
	const calls: string[] = [];
	let shipIt = init.shipIt ?? false;
	let disk = init.disk ?? init.current ?? "0.57.0";
	const current = init.current ?? "0.57.0";
	const states: UpdaterState[] = [];
	const autoUpdater: SquirrelAutoUpdater = {
		on(event: string, listener: (...args: any[]) => void) {
			return emitter.on(event, listener);
		},
		setFeedURL({ url }) {
			calls.push(`setFeedURL:${url}`);
		},
		checkForUpdates() {
			calls.push("checkForUpdates");
		},
		quitAndInstall() {
			calls.push("quitAndInstall");
		},
	};
	const updater = createSquirrelUpdater((s) => states.push(s), {
		autoUpdater,
		currentVersion: () => current,
		relaunch: () => calls.push("relaunch"),
		quit: () => calls.push("quit"),
		shipItRunning: () => shipIt,
		diskVersion: () => disk,
		pollMs: init.pollMs ?? 15,
	});
	return {
		updater,
		emitter,
		calls,
		states,
		setShipIt: (v: boolean) => (shipIt = v),
		setDisk: (v: string) => (disk = v),
	};
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Waits for what the updater's own poll brings about, however late that poll runs on a busy computer. */
const until = async (what: () => boolean) => {
	for (let i = 0; i < 500 && !what(); i++) await wait(10);
};

test("plistString reads CFBundleShortVersionString and CFBundleIdentifier from XML Info.plist", () => {
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
	<key>CFBundleIdentifier</key>
	<string>dev.pine.desktop</string>
	<key>CFBundleShortVersionString</key>
	<string>0.58.0</string>
</dict></plist>`;
	assert.equal(plistString(xml, "CFBundleIdentifier"), "dev.pine.desktop");
	assert.equal(plistString(xml, "CFBundleShortVersionString"), "0.58.0");
	assert.equal(plistString(xml, "MissingKey"), undefined);
});

test("squirrel: normal download calls checkForUpdates immediately and installs via quitAndInstall", () => {
	const h = harness({ current: "0.57.0", disk: "0.57.0", shipIt: false });
	h.updater.download(FEED, "0.58.0");
	assert.deepEqual(h.calls, [`setFeedURL:${FEED}`, "checkForUpdates"]);
	assert.deepEqual(h.updater.state(), { state: "downloading", version: "0.58.0" });
	h.emitter.emit("update-downloaded");
	assert.deepEqual(h.updater.state(), { state: "ready", version: "0.58.0" });
	h.updater.install();
	assert.deepEqual(h.calls, [`setFeedURL:${FEED}`, "checkForUpdates", "quitAndInstall"]);
});

test("squirrel: when ShipIt is already running, download waits without calling checkForUpdates, then marks ready and relaunches once ShipIt replaces the app on disk", async () => {
	const h = harness({ current: "0.57.0", disk: "0.57.0", shipIt: true, pollMs: 15 });
	h.updater.download(FEED, "0.58.0");
	assert.deepEqual(h.calls, []);
	assert.deepEqual(h.updater.state(), { state: "downloading", version: "0.58.0" });

	// A second download call while waiting does not trigger checkForUpdates either.
	h.updater.download(FEED, "0.58.0");
	await wait(40);
	assert.deepEqual(h.calls, []);

	// ShipIt finishes copying and swaps /Applications/Pine.app to 0.58.0.
	h.setDisk("0.58.0");
	h.setShipIt(false);
	await until(() => h.updater.state().state === "ready");

	assert.deepEqual(h.calls, []);
	assert.deepEqual(h.updater.state(), { state: "ready", version: "0.58.0" });

	// Clicking Restart to update relaunches the already-replaced bundle on disk instead of calling quitAndInstall.
	h.updater.install();
	assert.deepEqual(h.calls, ["relaunch", "quit"]);
});

test("squirrel: when ShipIt exits without replacing the app on disk, download proceeds safely with checkForUpdates", async () => {
	const h = harness({ current: "0.57.0", disk: "0.57.0", shipIt: true, pollMs: 15 });
	h.updater.download(FEED, "0.58.0");
	assert.deepEqual(h.calls, []);

	h.setShipIt(false);
	await until(() => h.calls.length >= 2);

	assert.deepEqual(h.calls, [`setFeedURL:${FEED}`, "checkForUpdates"]);
	h.emitter.emit("update-downloaded");
	assert.deepEqual(h.updater.state(), { state: "ready", version: "0.58.0" });
	h.updater.install();
	assert.deepEqual(h.calls, [`setFeedURL:${FEED}`, "checkForUpdates", "quitAndInstall"]);
});

test("squirrel: if the app on disk is already newer before download starts, marks ready without re-downloading", () => {
	const h = harness({ current: "0.57.0", disk: "0.58.0", shipIt: false });
	h.updater.download(FEED, "0.58.0");
	assert.deepEqual(h.calls, []);
	assert.deepEqual(h.updater.state(), { state: "ready", version: "0.58.0" });
	h.updater.install();
	assert.deepEqual(h.calls, ["relaunch", "quit"]);
});

test("squirrel: quitting while waiting on ShipIt stops polling and never calls checkForUpdates", async () => {
	const h = harness({ current: "0.57.0", disk: "0.57.0", shipIt: true, pollMs: 15 });
	h.updater.download(FEED, "0.58.0");
	h.updater.quitting();
	h.setShipIt(false);
	await wait(50);
	assert.deepEqual(h.calls, []);
});
