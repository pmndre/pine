// The Android versionCode of a release: major * 1 000 000 + minor * 1 000 + patch. Android installs an
// update only over a smaller versionCode, so a later release has to give a larger number, which this
// does while minor and patch stay below 1000. Google Play takes at most 2 100 000 000.
//   node scripts/version-code.ts 0.38.0   prints 38000
const LIMIT = 2_100_000_000;

export function versionCode(version: string): number {
	const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!parts) throw new Error(`"${version}" is not the version of a release (like 0.38.0).`);
	const [major, minor, patch] = parts.slice(1).map(Number);
	if (minor > 999 || patch > 999) throw new Error(`version ${version}: minor and patch must stay below 1000 for an Android versionCode.`);
	const code = major * 1_000_000 + minor * 1_000 + patch;
	if (code < 1 || code > LIMIT) throw new Error(`version ${version} gives no Android versionCode between 1 and ${LIMIT}.`);
	return code;
}

// The iOS version of a release or of a preview: what CFBundleShortVersionString and CFBundleVersion
// say. The short version is always X.Y.Z; the build number is versionCode(X.Y.Z) * 1000 + N, N being
// the N of a preview X.Y.Z-next.N and 999 for the release X.Y.Z. So a rebuild of the same version
// gives the same number, and a release sorts after every preview that led up to it, as App Store
// Connect wants of the builds of one version.
export function iosVersion(version: string): { short: string; build: number } {
	const parts = /^(\d+\.\d+\.\d+)(?:-next\.(\d+))?$/.exec(version);
	if (!parts) throw new Error(`"${version}" is not the version of a release (like 0.38.0) or of a preview (like 0.38.0-next.4).`);
	const [, short, preview] = parts;
	if (preview === undefined) return { short, build: versionCode(short) * 1000 + 999 };
	const n = Number(preview);
	if (n < 1 || n > 998) {
		throw new Error(`version ${version}: the N of a preview X.Y.Z-next.N must be 1 to 998 for an iOS build number (999 is the release's).`);
	}
	return { short, build: versionCode(short) * 1000 + n };
}

if (import.meta.main) {
	try {
		console.log(versionCode(process.argv[2] ?? ""));
	} catch (e) {
		console.error((e as Error).message);
		process.exit(1);
	}
}
