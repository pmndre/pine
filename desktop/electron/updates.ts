// Whether there is a newer Pine app than this one. GitHub is asked for pine's last release. When
// there is one, the app on a Mac downloads it from that release's own assets and installs it with
// macOS's updater (electron/updater.ts), only when the owner restarts or quits the app; on Linux and
// Windows, with the setting off, from a checkout or where that fails, the owner gets a link to the
// release's page instead and downloads the app there (an AppImage or an installer). The question
// says nothing about this computer or this pine.

/** Where the releases are, for the owner's browser. */
export const RELEASES = "https://github.com/pmndre/pine/releases";
/** Where the last release is asked for. A preview is not a release there, and is never the answer. */
export const LATEST = "https://api.github.com/repos/pmndre/pine/releases/latest";

export type Update =
	/**
	 * A release ahead of this app, with the app for this system and processor attached, and on a Mac
	 * its update feed. `url`: its page; `feed`: what macOS's updater reads (a Mac only). `updater`: how
	 * the app's own update of it goes, where the app updates itself (the main process adds it).
	 */
	| { status: "newer"; mine: string; version: string; url: string; feed?: string; updater?: UpdaterState }
	| { status: "latest"; mine: string }
	/** Nobody answered, or not with a release. */
	| { status: "unknown"; mine: string };

/**
 * The app's own update of a newer release (electron/updater.ts): not begun, being downloaded, ready
 * to install with the version it brings, or failed. A failure's `reason` is a fixed line of the
 * app's, never what the system's updater said.
 */
export type UpdaterState = { state: "idle" } | { state: "downloading"; version: string } | { state: "ready"; version: string } | { state: "failed"; version: string; reason: string };

/** Where a release's files are downloaded from: pine's own GitHub releases, by tag (scripts/update-feed.ts makes the release's feed with it too). */
export const DOWNLOADS = `${RELEASES}/download`;
/** The name of a release's update feed for a kind of Mac, among its assets. */
export const feedName = (arch: string) => `Pine-${arch}.json`;
/**
 * Where a release's update feed for a kind of Mac is: made from the version and the arch, never taken from an answer.
 * `downloads` is pine's own releases but in a test, which names a stand-in (PINE_DESKTOP_DOWNLOADS in the main process).
 */
export const feedOf = (version: string, arch: string, downloads: string = DOWNLOADS) => `${downloads}/v${version}/${feedName(arch)}`;

/**
 * Whether a release is ahead of the version `mine`. A preview ("0.40.0-next.3") comes before
 * the release it leads up to. (The rule of `newer` in src/update.ts, for a release on one side.)
 */
export function ahead(release: string, mine: string): boolean {
	const [x, y] = [release, mine].map((v) => v.split("-")[0].split(".").map((n) => Number(n) || 0));
	for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
	return mine.includes("-");
}

/**
 * The file of a release that is the app for a system and a processor (`arch`, arm64 or x64), as
 * desktop/scripts/pack.mjs names it: a disk image for a Mac, an AppImage for Linux (its .deb comes
 * with it), an installer for Windows. None for another system.
 */
export function appFile(version: string, arch: string, platform: string): string | undefined {
	if (platform === "darwin") return `Pine-${version}-${arch}.dmg`;
	// (The packer names a Linux file by the system's word for the processor: x86_64 for the AppImage of an x64 app.)
	if (platform === "linux") return `Pine-${version}-${arch === "x64" ? "x86_64" : arch}.AppImage`;
	if (platform === "win32") return `Pine-${version}-${arch}-setup.exe`;
	return undefined;
}

/**
 * Ask for the last release and compare. Of the answer only the release's number is used, and
 * only when it is one: the link and the feed's address are made here, to GitHub, never taken from
 * what was answered. A release counts once its app for this system and processor (`appFile`) is
 * attached, and on a Mac its update feed too, which is some minutes after pine itself is published,
 * and never when that app could not be built. `downloads` is where the feed is made on (feedOf).
 */
export async function lookForUpdate(mine: string, arch: string = process.arch, from: string = LATEST, downloads: string = DOWNLOADS, platform: string = process.platform): Promise<Update> {
	try {
		const res = await fetch(from, { headers: { accept: "application/vnd.github+json", "user-agent": "Pine" }, signal: AbortSignal.timeout(15_000) });
		if (!res.ok) return { status: "unknown", mine };
		const said = (await res.json()) as { tag_name?: unknown; assets?: unknown };
		const version = typeof said.tag_name === "string" ? /^v(\d{1,5}\.\d{1,5}\.\d{1,5})$/.exec(said.tag_name)?.[1] : undefined;
		if (!version) return { status: "unknown", mine };
		const names = Array.isArray(said.assets) ? said.assets.map((a) => (a as { name?: unknown } | null)?.name) : [];
		const file = appFile(version, arch, platform);
		// A Mac updates itself from the feed, and a release without one is not its update yet.
		const mac = platform === "darwin";
		const attached = Boolean(file) && names.includes(file) && (!mac || names.includes(feedName(arch)));
		if (!attached || !ahead(version, mine)) return { status: "latest", mine };
		return { status: "newer", mine, version, url: `${RELEASES}/tag/v${version}`, ...(mac ? { feed: feedOf(version, arch, downloads) } : {}) };
	} catch {
		return { status: "unknown", mine };
	}
}
