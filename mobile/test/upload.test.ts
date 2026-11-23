// The signed iOS build for TestFlight: what the script makes of its arguments and environment, what
// it hands xcodebuild, and how it reads xcodebuild's answer. The signing and the upload themselves
// need the App Store Connect key and Apple's servers; they are tried on the maintainer's Mac.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BUNDLE_ID } from "../scripts/testflight.ts";
import { alreadyUploaded, archiveArgs, exportArgs, exportOptions, failed, inputsOf } from "../scripts/upload.ts";

// A team id of nobody's: the real one is a repository variable (IOS_TEAM_ID), in no file.
const TEAM = "A1B2C3D4E5";
const key = { ASC_KEY: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n", ASC_KEY_ID: "ABC123DEFG", ASC_ISSUER_ID: "57246542-96fe-1a63-e053-0824d011072a", IOS_TEAM_ID: TEAM };

test("without any part of the key it builds nothing and says so", () => {
	const got = inputsOf(["--version", "0.39.0"], {}, "feat: x");
	assert.equal(got.kind, "skip");
	assert.match(got.kind === "skip" ? got.message : "", /nothing was uploaded/i);
	// Empty secrets are what a workflow hands over when the environment has none.
	assert.equal(inputsOf(["--version", "0.39.0"], { ASC_KEY: "", ASC_KEY_ID: "", ASC_ISSUER_ID: "", IOS_TEAM_ID: "" }, "x").kind, "skip");
	assert.match(got.kind === "skip" ? got.message : "", /IOS_TEAM_ID/);
});

test("a key without a team, or a team without a key, fails and names what is missing", () => {
	const { IOS_TEAM_ID: _, ...keyAlone } = key;
	assert.throws(() => inputsOf(["--version", "0.39.0"], keyAlone, "x"), /IOS_TEAM_ID/);
	assert.throws(() => inputsOf(["--version", "0.39.0"], { IOS_TEAM_ID: TEAM }, "x"), /ASC_KEY.*ASC_KEY_ID.*ASC_ISSUER_ID/s);
});

test("the team and the bundle id come from the environment or the arguments, the bundle id by default the project's", () => {
	const got = inputsOf(["--version", "0.39.0"], key, "x");
	assert.equal(got.kind, "run");
	if (got.kind !== "run") return;
	assert.equal(got.team, TEAM);
	assert.equal(got.bundleId, "dev.pmndre.pine");
	assert.equal(BUNDLE_ID, "dev.pmndre.pine");

	const fromEnv = inputsOf(["--version", "0.39.0"], { ...key, IOS_BUNDLE_ID: "org.example.pine" }, "x");
	assert.equal(fromEnv.kind === "run" && fromEnv.bundleId, "org.example.pine");

	const fromArgs = inputsOf(["--version", "0.39.0", "--team", "Z0Z0Z0Z0Z0", "--bundle-id", "org.other.pine"], { ...key, IOS_BUNDLE_ID: "org.example.pine" }, "x");
	assert.equal(fromArgs.kind === "run" && fromArgs.team, "Z0Z0Z0Z0Z0");
	assert.equal(fromArgs.kind === "run" && fromArgs.bundleId, "org.other.pine");

	// An empty variable is what a workflow hands over when the repository has none.
	const empty = inputsOf(["--version", "0.39.0"], { ...key, IOS_BUNDLE_ID: "" }, "x");
	assert.equal(empty.kind === "run" && empty.bundleId, "dev.pmndre.pine");
});

test("with only part of the key it fails and names what is missing", () => {
	assert.throws(() => inputsOf(["--version", "0.39.0"], { ASC_KEY_ID: "ABC123DEFG" }, "x"), /ASC_KEY.*ASC_ISSUER_ID|ASC_ISSUER_ID.*ASC_KEY/s);
});

test("a release goes to the latest channel, a preview to next, and the build number follows the version", () => {
	const release = inputsOf(["--version", "0.39.0"], key, "feat: something");
	assert.equal(release.kind, "run");
	if (release.kind !== "run") return;
	assert.deepEqual({ channel: release.channel, short: release.short, build: release.build, notes: release.notes }, { channel: "latest", short: "0.39.0", build: 39000999, notes: "feat: something" });
	assert.equal("pem" in release.key && release.key.pem, key.ASC_KEY);
	assert.equal(release.key.keyId, "ABC123DEFG");

	const preview = inputsOf(["--version", "0.39.0-next.4", "--notes", "fix: other"], key, "unused");
	assert.equal(preview.kind, "run");
	if (preview.kind !== "run") return;
	assert.deepEqual({ channel: preview.channel, short: preview.short, build: preview.build, notes: preview.notes }, { channel: "next", short: "0.39.0", build: 39000004, notes: "fix: other" });
});

test("a channel given by hand must agree with the version", () => {
	assert.equal(inputsOf(["--version", "0.39.0", "--channel", "latest"], key, "x").kind, "run");
	assert.throws(() => inputsOf(["--version", "0.39.0", "--channel", "next"], key, "x"), /channel/);
	assert.throws(() => inputsOf(["--version", "0.39.0-next.1", "--channel", "latest"], key, "x"), /channel/);
});

test("a team id or a bundle id that is not one is refused before anything is built", () => {
	assert.throws(() => inputsOf(["--version", "0.39.0"], { ...key, IOS_TEAM_ID: "abc</string>" }, "x"), /IOS_TEAM_ID/);
	assert.throws(() => inputsOf(["--version", "0.39.0"], { ...key, IOS_BUNDLE_ID: "dev pmndre" }, "x"), /IOS_BUNDLE_ID/);
});

test("the key may be a file on the Mac, and the ids arguments", () => {
	const got = inputsOf(["--version", "0.39.0", "--key", "/keys/AuthKey_ABC123DEFG.p8", "--key-id", "ABC123DEFG", "--issuer-id", "issuer", "--team", TEAM], {}, "x");
	assert.equal(got.kind, "run");
	if (got.kind !== "run") return;
	assert.deepEqual(got.key, { path: "/keys/AuthKey_ABC123DEFG.p8", keyId: "ABC123DEFG", issuerId: "issuer" });
});

test("a version that is neither a release nor a preview is refused, and so is none", () => {
	assert.throws(() => inputsOf(["--version", "v0.39"], key, "x"), /version/);
	assert.throws(() => inputsOf([], key, "x"), /--version/);
});

test("the export options upload to App Store Connect for the team, and keep pine's build number", () => {
	const plist = exportOptions(TEAM);
	assert.match(plist, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
	assert.match(plist, /<key>method<\/key>\s*<string>app-store-connect<\/string>/);
	assert.match(plist, /<key>destination<\/key>\s*<string>upload<\/string>/);
	assert.match(plist, /<key>teamID<\/key>\s*<string>A1B2C3D4E5<\/string>/);
	assert.match(plist, /<key>signingStyle<\/key>\s*<string>automatic<\/string>/);
	// Otherwise App Store Connect may raise a build number it already has, and a rebuild of a tag
	// would become a new build instead of being recognised as the same one.
	assert.match(plist, /<key>manageAppVersionAndBuildNumber<\/key>\s*<false\/>/);
});

const auth = { path: "/tmp/x/AuthKey_ABC123DEFG.p8", keyId: "ABC123DEFG", issuerId: "issuer" };

test("the archive is signed automatically for the team, on the command line only, with the API key", () => {
	const args = archiveArgs({ archive: "/b/App.xcarchive", derivedData: "/b/DD", short: "0.39.0", build: 39000999, team: TEAM, bundleId: "org.example.pine", key: auth });
	assert.deepEqual(args.slice(args.indexOf("-authenticationKeyPath"), args.indexOf("-authenticationKeyPath") + 6), ["-authenticationKeyPath", auth.path, "-authenticationKeyID", "ABC123DEFG", "-authenticationKeyIssuerID", "issuer"]);
	for (const a of ["archive", "-allowProvisioningUpdates", "-onlyUsePackageVersionsFromResolvedFile", "DEVELOPMENT_TEAM=A1B2C3D4E5", "PRODUCT_BUNDLE_IDENTIFIER=org.example.pine", "CODE_SIGN_STYLE=Automatic", "MARKETING_VERSION=0.39.0", "CURRENT_PROJECT_VERSION=39000999"]) {
		assert.ok(args.includes(a), a);
	}
	assert.deepEqual(args.slice(args.indexOf("-archivePath"), args.indexOf("-archivePath") + 2), ["-archivePath", "/b/App.xcarchive"]);
	assert.ok(!args.some((a) => a.startsWith("CODE_SIGNING_ALLOWED")), "this build is signed");
});

test("the export uploads the archive with the same key", () => {
	const args = exportArgs({ archive: "/b/App.xcarchive", exportPath: "/b/export", options: "/b/ExportOptions.plist", key: auth });
	assert.equal(args[0], "-exportArchive");
	for (const pair of [["-archivePath", "/b/App.xcarchive"], ["-exportPath", "/b/export"], ["-exportOptionsPlist", "/b/ExportOptions.plist"], ["-authenticationKeyPath", auth.path], ["-authenticationKeyID", "ABC123DEFG"], ["-authenticationKeyIssuerID", "issuer"]]) {
		assert.equal(args[args.indexOf(pair[0]) + 1], pair[1], pair[0]);
	}
	assert.ok(args.includes("-allowProvisioningUpdates"));
});

test("a build App Store Connect already has is recognised in xcodebuild's output", () => {
	// The wordings App Store Connect answers a second upload of a version and build number with.
	assert.ok(alreadyUploaded("error: exportArchive Redundant Binary Upload. You've already uploaded a build with build number '39000999' for version number '0.39.0'. Make sure you increment the build string before you upload your app to App Store Connect."));
	assert.ok(alreadyUploaded("ERROR ITMS-90189: \"Redundant Binary Upload. You've already uploaded a build with build number '4' for version number '0.39.0'.\""));
	assert.ok(alreadyUploaded("error: exportArchive The bundle version must be higher than the previously uploaded version: ‘39000999’. (ID: 1b2c)"));
	assert.ok(alreadyUploaded("Upload failed. ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE: The provided entity includes an attribute with a value that has already been used"));
	assert.ok(!alreadyUploaded("error: exportArchive No signing certificate \"iOS Distribution\" found"));
	assert.ok(!alreadyUploaded("** EXPORT SUCCEEDED **"));
});

test("the project names no team and keeps the project's bundle id: only the signed build's command line sets them", () => {
	const project = fs.readFileSync(path.join(import.meta.dirname, "../ios/App/App.xcodeproj/project.pbxproj"), "utf8");
	assert.doesNotMatch(project, /DEVELOPMENT_TEAM/);
	const ids = [...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1]);
	assert.deepEqual([...new Set(ids)].sort(), ["dev.pmndre.pine", "dev.pmndre.pine.tests"]);
});

test("the export options are a property list xcodebuild reads", { skip: process.platform !== "darwin" && "plutil is macOS's" }, () => {
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pine-export-")), "ExportOptions.plist");
	fs.writeFileSync(file, exportOptions(TEAM));
	const read = (k: string) => execFileSync("plutil", ["-extract", k, "raw", file], { encoding: "utf8" }).trim();
	assert.equal(read("method"), "app-store-connect");
	assert.equal(read("destination"), "upload");
	assert.equal(read("manageAppVersionAndBuildNumber"), "false");
});

test("run as a command without the key, it passes and writes in the job's summary that nothing was uploaded", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pine-summary-"));
	const file = path.join(dir, "summary.md");
	const env = { PATH: process.env.PATH, GITHUB_STEP_SUMMARY: file, ASC_KEY: "", ASC_KEY_ID: "", ASC_ISSUER_ID: "", IOS_TEAM_ID: "" };
	const r = spawnSync(process.execPath, [path.join(import.meta.dirname, "../scripts/upload.ts"), "--version", "0.39.0"], { encoding: "utf8", env });
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /nothing was uploaded/);
	assert.match(fs.readFileSync(file, "utf8"), /nothing was uploaded/);
});

test("a step that fails is named and says what to do next", () => {
	const archive = failed("xcodebuild archive", 65);
	assert.match(archive, /^xcodebuild archive failed \(exit 65\)/);
	assert.match(archive, /output above/);
	assert.match(archive, /Admin role/);
	assert.match(archive, /agreements/);
	assert.match(archive, /developer\.apple\.com/);
	assert.match(archive, /App Store Connect/);
	assert.match(archive, /run this again/);
	assert.doesNotMatch(archive, /App Manager/);
	assert.match(failed("npm run sync:ios", 1), /^npm run sync:ios failed \(exit 1\)/);
});

test("run as a command with a key that is not one, it says so before it builds anything", () => {
	// An empty PATH: were npm or xcodebuild started, the run would fail on that instead.
	const env = { PATH: fs.mkdtempSync(path.join(os.tmpdir(), "pine-nopath-")), ASC_KEY: "-----BEGIN PRIVATE KEY-----\nnonsense\n-----END PRIVATE KEY-----\n", ASC_KEY_ID: "ABC123DEFG", ASC_ISSUER_ID: "issuer", IOS_TEAM_ID: TEAM };
	const r = spawnSync(process.execPath, [path.join(import.meta.dirname, "../scripts/upload.ts"), "--version", "0.39.0", "--notes", "x"], { encoding: "utf8", env });
	assert.equal(r.status, 1);
	assert.match(r.stderr, /not a private key/);
	assert.doesNotMatch(r.stdout + r.stderr, /nonsense/);
	assert.doesNotMatch(r.stdout, /signed by team/);
});

test("run as a command with a key file that is not there, it says so before it builds anything", () => {
	const env = { PATH: fs.mkdtempSync(path.join(os.tmpdir(), "pine-nopath-")) };
	const r = spawnSync(process.execPath, [path.join(import.meta.dirname, "../scripts/upload.ts"), "--version", "0.39.0", "--notes", "x", "--key", "/nowhere/AuthKey_X.p8", "--key-id", "X", "--issuer-id", "i", "--team", TEAM], { encoding: "utf8", env });
	assert.equal(r.status, 1);
	assert.match(r.stderr, /\/nowhere\/AuthKey_X\.p8/);
	assert.doesNotMatch(r.stdout, /signed by team/);
});
