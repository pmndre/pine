// Whether there is a newer Pine app than this one. GitHub is asked for pine's last release;
// nothing is fetched and nothing is installed: the owner gets a link to the release's page and
// downloads the app there (a disk image, an AppImage or an installer). The question says nothing
// about this computer or this pine.

/** Where the releases are, for the owner's browser. */
export const RELEASES = "https://github.com/pmndre/pine/releases";
/** Where the last release is asked for. A preview is not a release there, and is never the answer. */
export const LATEST = "https://api.github.com/repos/pmndre/pine/releases/latest";

export type Update =
	/** A release ahead of this app, with the app for this system and processor attached. */
	| { status: "newer"; mine: string; version: string; url: string }
	| { status: "latest"; mine: string }
	/** Nobody answered, or not with a release. */
	| { status: "unknown"; mine: string };

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
	if (platform === "linux") return `Pine-${version}-${arch}.AppImage`;
	if (platform === "win32") return `Pine-${version}-${arch}-setup.exe`;
	return undefined;
}

/**
 * Ask for the last release and compare. Of the answer only the release's number is used, and
 * only when it is one: the link is made here, to GitHub, never taken from what was answered. A
 * release counts once its app for this system and processor (`appFile`) is attached, which is
 * some minutes after pine itself is published, and never when that app could not be built.
 */
export async function lookForUpdate(mine: string, arch: string = process.arch, from: string = LATEST, platform: string = process.platform): Promise<Update> {
	try {
		const res = await fetch(from, { headers: { accept: "application/vnd.github+json", "user-agent": "Pine" }, signal: AbortSignal.timeout(15_000) });
		if (!res.ok) return { status: "unknown", mine };
		const said = (await res.json()) as { tag_name?: unknown; assets?: unknown };
		const version = typeof said.tag_name === "string" ? /^v(\d{1,5}\.\d{1,5}\.\d{1,5})$/.exec(said.tag_name)?.[1] : undefined;
		if (!version) return { status: "unknown", mine };
		const file = appFile(version, arch, platform);
		const attached = Boolean(file) && Array.isArray(said.assets) && said.assets.some((a) => (a as { name?: unknown } | null)?.name === file);
		return attached && ahead(version, mine) ? { status: "newer", mine, version, url: `${RELEASES}/tag/v${version}` } : { status: "latest", mine };
	} catch {
		return { status: "unknown", mine };
	}
}
