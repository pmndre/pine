// Squirrel.Mac updater controller: wraps Electron's autoUpdater while guarding against an
// in-flight ShipIt installation from a previous run of this app.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { Updater } from "./updater.ts";
import { ahead, type UpdaterState } from "./updates.ts";

export const FAILED = "The update could not be downloaded or installed here.";
export const READ_ONLY = "This app cannot replace itself where it is (the disk image, or a folder it cannot write): move it to Applications.";

/** Minimal surface of Electron's autoUpdater used by Squirrel.Mac. */
export interface SquirrelAutoUpdater {
	on(event: "update-downloaded", listener: () => void): unknown;
	on(event: "update-not-available", listener: () => void): unknown;
	on(event: "error", listener: (error: Error) => void): unknown;
	setFeedURL(options: { url: string; serverType: "default"; headers: Record<string, string> }): void;
	checkForUpdates(): void;
	quitAndInstall(): void;
}

/** Injectable platform operations for createSquirrelUpdater (defaults to real macOS/Electron). */
export interface SquirrelOps {
	autoUpdater: SquirrelAutoUpdater;
	currentVersion: () => string;
	relaunch: () => void;
	quit: () => void;
	shipItRunning: () => boolean;
	diskVersion: () => string | undefined;
	pollMs?: number;
}

/** Reads a string value for `key` from an XML Info.plist. */
export function plistString(xml: string, key: string): string | undefined {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`<key>${escaped}</key>\\s*<string>([^<]+)</string>`).exec(xml)?.[1]?.trim() || undefined;
}

/** Reads the bundle version currently on disk from the app's Info.plist. */
export function readDiskVersion(infoPlistPath: string): string | undefined {
	try {
		return plistString(fs.readFileSync(infoPlistPath, "utf8"), "CFBundleShortVersionString");
	} catch {
		return undefined;
	}
}

/** Reads the bundle identifier from the app's Info.plist, falling back to Pine's default. */
export function readBundleId(infoPlistPath: string, fallback = "dev.pine.desktop"): string {
	try {
		return plistString(fs.readFileSync(infoPlistPath, "utf8"), "CFBundleIdentifier") ?? fallback;
	} catch {
		return fallback;
	}
}

/** Whether a Squirrel.Mac ShipIt process for `bundleId` is currently running on this Mac. */
export function isShipItRunning(bundleId: string): boolean {
	try {
		const out = execFileSync("/bin/ps", ["-A", "-o", "command="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
		const tag = `${bundleId}.ShipIt`;
		return out.split("\n").some((line) => line.includes("/ShipIt ") && line.includes(tag));
	} catch {
		return false;
	}
}

/**
 * Squirrel.Mac updater state machine.
 *
 * Guards against an in-flight ShipIt process from a previous run of this app: calling
 * `autoUpdater.checkForUpdates()` while ShipIt is copying `update.*` deletes that staging
 * directory out from under ShipIt (`ENOENT`). Instead, wait for ShipIt to exit; if the bundle on
 * disk is already ahead of `currentVersion()`, transition straight to `ready` and relaunch on
 * `install()` without re-downloading.
 */
export function createSquirrelUpdater(changed: (state: UpdaterState) => void, ops: SquirrelOps): Updater {
	let now: UpdaterState = { state: "idle" };
	let version = "";
	let startedHere = false;
	let installedOnDisk = false;
	let pendingFeed = "";
	let poll: ReturnType<typeof setInterval> | undefined;
	const pollMs = ops.pollMs ?? 1500;
	const set = (s: UpdaterState) => changed((now = s));
	const stopPolling = () => {
		if (!poll) return;
		clearInterval(poll);
		poll = undefined;
	};
	const alreadyOnDisk = (): string | undefined => {
		const onDisk = ops.diskVersion();
		return onDisk && ahead(onDisk, ops.currentVersion()) ? onDisk : undefined;
	};
	const startDownload = (feed: string) => {
		startedHere = true;
		try {
			// The feed is a file on the release ({ url, name, pub_date }), served as Squirrel.Mac's default server would answer.
			// Its requests say no more of this Mac than the update check's do.
			ops.autoUpdater.setFeedURL({ url: feed, serverType: "default", headers: { "User-Agent": "Pine" } });
			ops.autoUpdater.checkForUpdates();
		} catch {
			set({ state: "failed", version, reason: FAILED });
		}
	};
	ops.autoUpdater.on("update-downloaded", () => set({ state: "ready", version }));
	// The feed names a release, so "nothing newer" means Squirrel.Mac would not take it: a failure, not a download that never ends.
	ops.autoUpdater.on("update-not-available", () => set({ state: "failed", version, reason: FAILED }));
	// Squirrel.Mac's own words are not shown; only whether it is the place the app runs from that is the trouble.
	ops.autoUpdater.on("error", (e) => set({ state: "failed", version, reason: /read-only|translocat/i.test(String(e?.message)) ? READ_ONLY : FAILED }));
	return {
		state: () => now,
		download(feed, v) {
			if (now.state !== "idle" && now.state !== "failed" && version === v) return;
			version = v;
			pendingFeed = feed;
			const onDisk = alreadyOnDisk();
			if (onDisk) {
				stopPolling();
				installedOnDisk = true;
				version = onDisk;
				set({ state: "ready", version: onDisk });
				return;
			}
			set({ state: "downloading", version });
			if (!startedHere && ops.shipItRunning()) {
				if (!poll) {
					poll = setInterval(() => {
						if (ops.shipItRunning()) return;
						stopPolling();
						const replaced = alreadyOnDisk();
						if (replaced) {
							installedOnDisk = true;
							version = replaced;
							set({ state: "ready", version: replaced });
						} else {
							startDownload(pendingFeed);
						}
					}, pollMs);
					poll.unref?.();
				}
				return;
			}
			stopPolling();
			startDownload(feed);
		},
		install() {
			stopPolling();
			try {
				if (installedOnDisk) {
					ops.relaunch();
					ops.quit();
				} else {
					ops.autoUpdater.quitAndInstall();
				}
			} catch {
				set({ state: "failed", version, reason: FAILED });
			}
		},
		// Squirrel.Mac installs a downloaded update when the app quits by itself.
		quitting() {
			stopPolling();
		},
	};
}
