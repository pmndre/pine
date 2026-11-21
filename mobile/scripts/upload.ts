// The iOS app of a release or of a preview, signed by the maintainer's Apple team, uploaded to App
// Store Connect and put on TestFlight. One command, for the maintainer's Mac and for the Release
// workflow's `testflight` job:
//   node scripts/upload.ts --version 0.39.0 --key ~/Downloads/AuthKey_ABC123DEFG.p8 \
//     --key-id ABC123DEFG --issuer-id <uuid> --team <team id>   (npm run testflight -- --version ...)
// The key's content may be in ASC_KEY instead of --key (the workflow's secret), the ids in
// ASC_KEY_ID and ASC_ISSUER_ID, the signing team in IOS_TEAM_ID. Those four are what signing
// takes: without any of them it builds nothing and says so, with only some it fails. The bundle id
// is --bundle-id or IOS_BUNDLE_ID, by default the project's (dev.pmndre.pine). Team and bundle id
// are the workflow's repository variables, so another maintainer's team takes over without a commit.
// A release X.Y.Z goes to the channel `latest` (the external group and Beta App Review), a preview
// X.Y.Z-next.N to `next` (the internal group); --channel, if given, must agree. "What to Test" is
// --notes, or else the subject of the commit checked out (the release's).
//
// Signing is xcodebuild's automatic signing with the API key: Apple's cloud-managed distribution
// certificate, a profile made on the spot, nothing stored. The team and the bundle id are given
// here, on the command line, and nowhere in the project, so the unsigned IPA (scripts/ipa.ts) and the simulator builds
// are unchanged. The archive is exported with destination `upload`, which uploads it; a build App
// Store Connect already has is reported as such and the distribution goes on (a rebuild of a tag).
// Then `distribute` of scripts/testflight.ts, called here, waits for the build and distributes it.
// The key is read once and checked to be a private key before anything is built; xcodebuild is
// given a file (the one of --key, or the content of ASC_KEY written to one of its own, removed
// whatever happens), and nothing prints it. Node's own modules only.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { BUNDLE_ID, type Channel, distribute, type Key, privateKey } from "./testflight.ts";
import { iosVersion } from "./version-code.ts";

/** The App Store Connect API key, as a file xcodebuild can be given. */
export type KeyFile = { path: string; keyId: string; issuerId: string };

export type Inputs =
	| { kind: "skip"; message: string }
	| {
			kind: "run";
			channel: Channel;
			/** CFBundleShortVersionString, X.Y.Z. */
			short: string;
			/** CFBundleVersion. */
			build: number;
			notes: string;
			/** The Apple Developer team that signs the build. */
			team: string;
			/** The app's bundle id on that team. */
			bundleId: string;
			/** A file of the Mac's, or the content (ASC_KEY) that is written to one for the run. */
			key: { path: string; keyId: string; issuerId: string } | { pem: string; keyId: string; issuerId: string };
	  };

const USAGE = `Usage: node scripts/upload.ts --version <X.Y.Z or X.Y.Z-next.N> [--channel latest|next] [--notes <What to Test>]
  [--key <AuthKey.p8>] [--key-id <id>] [--issuer-id <uuid>] [--team <team id>] [--bundle-id <id>]
The key's content may be in ASC_KEY instead of --key, the ids in ASC_KEY_ID and ASC_ISSUER_ID,
the team in IOS_TEAM_ID, the bundle id in IOS_BUNDLE_ID (default ${BUNDLE_ID}).`;

/** What a run is asked to do, from its arguments, its environment and the commit's subject. */
export function inputsOf(argv: string[], env: Record<string, string | undefined>, subject: string): Inputs {
	const { values } = parseArgs({
		args: argv,
		options: {
			version: { type: "string" },
			channel: { type: "string" },
			notes: { type: "string" },
			key: { type: "string" },
			"key-id": { type: "string" },
			"issuer-id": { type: "string" },
			team: { type: "string" },
			"bundle-id": { type: "string" },
		},
	});
	const keyPath = values.key || undefined;
	const pem = env.ASC_KEY || undefined;
	const keyId = values["key-id"] || env.ASC_KEY_ID || undefined;
	const issuerId = values["issuer-id"] || env.ASC_ISSUER_ID || undefined;
	const team = values.team || env.IOS_TEAM_ID || undefined;
	const bundleId = values["bundle-id"] || env.IOS_BUNDLE_ID || BUNDLE_ID;
	// Signing takes all four: none is a repository not set up for TestFlight, some is a mistake.
	const parts = { "ASC_KEY (or --key)": keyPath ?? pem, "ASC_KEY_ID (or --key-id)": keyId, "ASC_ISSUER_ID (or --issuer-id)": issuerId, "IOS_TEAM_ID (or --team)": team };
	const missing = Object.entries(parts).filter(([, v]) => !v).map(([k]) => k);
	if (missing.length === Object.keys(parts).length) {
		return { kind: "skip", message: "The iOS app was not built for TestFlight and nothing was uploaded: there is no App Store Connect API key (ASC_KEY, ASC_KEY_ID, ASC_ISSUER_ID in the environment \"testflight\") and no signing team (the repository variable IOS_TEAM_ID)." };
	}
	if (missing.length > 0) throw new Error(`What signing for TestFlight takes is incomplete: ${missing.join(", ")} missing.\n${USAGE}`);

	// Apple's forms: ten capitals and digits; letters, digits, dots and hyphens.
	if (!/^[A-Z0-9]{10}$/.test(team!)) throw new Error(`IOS_TEAM_ID (or --team) is "${team}", not a team id: ten capitals and digits, as Membership details at developer.apple.com shows it.`);
	if (!/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(bundleId)) throw new Error(`IOS_BUNDLE_ID (or --bundle-id) is "${bundleId}", not a bundle id like ${BUNDLE_ID}.`);
	if (!values.version) throw new Error(`--version is missing.\n${USAGE}`);
	const { short, build } = iosVersion(values.version);
	const channel: Channel = values.version.includes("-next.") ? "next" : "latest";
	if (values.channel !== undefined && values.channel !== channel) {
		throw new Error(`--channel ${values.channel} does not fit version ${values.version}: a release goes to latest, a preview (X.Y.Z-next.N) to next.`);
	}
	const notes = (values.notes ?? subject).trim();
	if (!notes) throw new Error(`--notes is missing, and there is no commit subject to use.\n${USAGE}`);
	const ids = { keyId: keyId!, issuerId: issuerId! };
	return { kind: "run", channel, short, build, notes, team: team!, bundleId, key: keyPath ? { path: keyPath, ...ids } : { pem: pem!, ...ids } };
}

/** The export options: App Store Connect distribution, uploaded, signed automatically for `team`. */
export function exportOptions(team: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>destination</key>
	<string>upload</string>
	<key>teamID</key>
	<string>${team}</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
	<key>uploadSymbols</key>
	<true/>
</dict>
</plist>
`;
}

const authArgs = (key: KeyFile) => ["-allowProvisioningUpdates", "-authenticationKeyPath", key.path, "-authenticationKeyID", key.keyId, "-authenticationKeyIssuerID", key.issuerId];

/** xcodebuild's arguments for the signed archive. */
export function archiveArgs(o: { archive: string; derivedData: string; short: string; build: number; team: string; bundleId: string; key: KeyFile }): string[] {
	return [
		"-project", "ios/App/App.xcodeproj",
		"-scheme", "App",
		"-configuration", "Release",
		"-destination", "generic/platform=iOS",
		"-archivePath", o.archive,
		"-derivedDataPath", o.derivedData,
		// The packages at their committed versions, as for the unsigned IPA.
		"-onlyUsePackageVersionsFromResolvedFile",
		...authArgs(o.key),
		"archive",
		`DEVELOPMENT_TEAM=${o.team}`,
		`PRODUCT_BUNDLE_IDENTIFIER=${o.bundleId}`,
		"CODE_SIGN_STYLE=Automatic",
		`MARKETING_VERSION=${o.short}`,
		`CURRENT_PROJECT_VERSION=${o.build}`,
	];
}

/** xcodebuild's arguments for the export, which uploads the archive (destination `upload`). */
export function exportArgs(o: { archive: string; exportPath: string; options: string; key: KeyFile }): string[] {
	return ["-exportArchive", "-archivePath", o.archive, "-exportPath", o.exportPath, "-exportOptionsPlist", o.options, ...authArgs(o.key)];
}

// What App Store Connect answers an upload of a version and build number it already has with:
// "Redundant Binary Upload. You've already uploaded a build with build number '12' for version
// number '1.0'." (ITMS-90189, earlier ITMS-4238), and in later uploads "The bundle version must be
// higher than the previously uploaded version: '12'." with the code
// ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE. The second also comes for a number lower than one
// uploaded before; `distribute` then finds no such build and fails, which is right.
const ALREADY = [/Redundant Binary Upload/i, /already uploaded a build with build number/i, /bundle version must be higher than the previously uploaded version/i, /ENTITY_ERROR\.ATTRIBUTE\.INVALID\.DUPLICATE/];

/** Whether xcodebuild's output says App Store Connect already has this build. */
export function alreadyUploaded(output: string): boolean {
	return ALREADY.some((re) => re.test(output));
}

/** What a failed step says: which step, and what to do before running this again. */
export function failed(step: string, status: number | string | null): string {
	return [
		`${step} failed (exit ${status}).`,
		"Read its output above for the cause.",
		// What most often stops automatic signing with an API key.
		"For a signing error, check that the App Store Connect API key has the Admin role (Users and Access > Integrations) and that the current agreements are accepted at developer.apple.com and in App Store Connect (Business).",
		"Then run this again.",
	].join(" ");
}

const mobile = path.resolve(import.meta.dirname, "..");

function summary(line: string) {
	if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

async function main() {
	const subject = spawnSync("git", ["log", "-1", "--format=%s"], { cwd: mobile, encoding: "utf8" }).stdout?.trim() ?? "";
	const inputs = inputsOf(process.argv.slice(2), process.env, subject);
	if (inputs.kind === "skip") {
		console.log(inputs.message);
		summary(inputs.message);
		return;
	}
	const { channel, short, build, notes, team, bundleId } = inputs;

	// The key is read once, here, and checked before anything is built with it.
	let pem: string;
	if ("pem" in inputs.key) {
		pem = inputs.key.pem;
	} else {
		try {
			pem = fs.readFileSync(inputs.key.path, "utf8");
		} catch (e) {
			throw new Error(`The key file ${inputs.key.path} cannot be read (${(e as NodeJS.ErrnoException).code}): give the path of the AuthKey_<id>.p8 file App Store Connect gave for the API key.`);
		}
	}
	privateKey(pem);
	const ascKey: Key = { pem, keyId: inputs.key.keyId, issuerId: inputs.key.issuerId };

	// The key's content goes into a file only this user reads, in a folder of its own that is
	// removed at the end, also when the run is interrupted.
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pine-asc-"));
	const clean = () => fs.rmSync(temp, { recursive: true, force: true });
	process.on("exit", clean);
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => process.exit(1));
	let keyPath: string;
	if ("pem" in inputs.key) {
		keyPath = path.join(temp, `AuthKey_${inputs.key.keyId}.p8`);
		fs.writeFileSync(keyPath, pem.endsWith("\n") ? pem : `${pem}\n`, { mode: 0o600 });
	} else {
		keyPath = path.resolve(inputs.key.path);
	}
	const key: KeyFile = { path: keyPath, keyId: inputs.key.keyId, issuerId: inputs.key.issuerId };
	// No program started here gets the key's content: the file is what they are given.
	const env = { ...process.env };
	delete env.ASC_KEY;

	const run = (step: string, cmd: string, args: string[]) => {
		const r = spawnSync(cmd, args, { cwd: mobile, stdio: "inherit", env });
		if (r.error) throw new Error(`${step} could not start: ${r.error.message}. ${cmd} has to be on the PATH (Xcode for xcodebuild, Node for npm).`);
		if (r.status !== 0) throw new Error(failed(step, r.status ?? r.signal));
	};
	// The output is shown as it comes and kept, to read App Store Connect's answer in it.
	const runKept = (cmd: string, args: string[]) =>
		new Promise<{ status: number | null; output: string }>((resolve, reject) => {
			const child = spawn(cmd, args, { cwd: mobile, stdio: ["ignore", "pipe", "pipe"], env });
			let output = "";
			child.stdout.on("data", (b: Buffer) => {
				output += b;
				process.stdout.write(b);
			});
			child.stderr.on("data", (b: Buffer) => {
				output += b;
				process.stderr.write(b);
			});
			child.on("error", reject);
			child.on("close", (status) => resolve({ status, output }));
		});

	const work = path.join(mobile, "ios", "App", "build", "testflight");
	const archive = path.join(work, "App.xcarchive");
	console.log(`Pine ${short} (${build}) for TestFlight, channel ${channel}, bundle id ${bundleId}, signed by team ${team}`);
	run("npm run sync:ios", "npm", ["run", "sync:ios"]);
	fs.rmSync(work, { recursive: true, force: true });
	fs.mkdirSync(work, { recursive: true });
	run("xcodebuild archive", "xcodebuild", archiveArgs({ archive, derivedData: path.join(work, "DerivedData"), short, build, team, bundleId, key }));

	const options = path.join(work, "ExportOptions.plist");
	fs.writeFileSync(options, exportOptions(team));
	const exported = await runKept("xcodebuild", exportArgs({ archive, exportPath: path.join(work, "export"), options, key }));
	if (exported.status !== 0) {
		if (!alreadyUploaded(exported.output)) throw new Error(`The build was not uploaded. ${failed("xcodebuild -exportArchive (the upload)", exported.status)}`);
		console.log(`App Store Connect already has Pine ${short} (${build}): it was uploaded before, and is distributed as it is.`);
		summary(`Pine ${short} (${build}) was already on App Store Connect; it was not uploaded again.`);
	} else {
		summary(`Pine ${short} (${build}) was signed by team ${team} and uploaded to App Store Connect.`);
	}

	await distribute({ key: ascKey, bundleId, version: short, build: String(build), channel, notes });
	summary(`Pine ${short} (${build}) is on TestFlight, in the ${channel === "latest" ? "external group and submitted to Beta App Review" : "internal group"}.`);
}

if (import.meta.main) {
	main().catch((e: Error) => {
		console.error(e.message);
		process.exit(1);
	});
}
