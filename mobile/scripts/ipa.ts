// The iOS app of a release as an unsigned IPA, the file a person sideloads with AltStore or
// Sideloadly, which sign it with their own Apple ID when they install it. Nothing here signs: pine
// has no Apple certificate, profile or account, and wants none.
//   node scripts/ipa.ts [version]      (npm run ipa -- 0.38.0)
// Builds the page for iOS and syncs it (npm run sync:ios), archives the app for devices with code
// signing off, its version the release's and its build number Android's versionCode
// (scripts/version-code.ts), and writes ios/App/output/Pine-<version>.ipa. Then checks what it
// wrote: nothing inside is signed at all (the app, and each embedded framework, whose vendor's
// signature is taken off), every binary is arm64, the WebRTC library and its OpenSSL are there, its
// versions are the ones asked for. Without a version it is 0.0.0, build 1. Needs Xcode with the iOS SDK. It is run by hand
// on a Mac: the Release workflow builds no IPA for now.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { versionCode } from "./version-code.ts";

const version = process.argv[2] ?? "0.0.0";
const code = version === "0.0.0" ? 1 : versionCode(version);
const mobile = path.resolve(import.meta.dirname, "..");
const build = path.join(mobile, "ios", "App", "build");
const archive = path.join(build, "App.xcarchive");
const output = path.join(mobile, "ios", "App", "output");
const ipa = path.join(output, `Pine-${version}.ipa`);

function run(cmd: string, args: string[], cwd = mobile) {
	const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
	if (r.status !== 0) throw new Error(`${cmd} ${args[0]} failed (exit ${r.status ?? r.signal}).`);
}
const read = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

/** The Mach-O files of an app bundle: its binary, and those of its frameworks and dylibs, found by their magic number. */
function machO(bundle: string): string[] {
	const magic = new Set([0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);
	return fs.readdirSync(bundle, { recursive: true, withFileTypes: true }).flatMap((entry) => {
		if (!entry.isFile()) return [];
		const file = path.join(entry.parentPath, entry.name);
		const head = Buffer.alloc(4);
		const fd = fs.openSync(file, "r");
		const n = fs.readSync(fd, head, 0, 4, 0);
		fs.closeSync(fd);
		return n === 4 && magic.has(head.readUInt32BE(0)) ? [file] : [];
	});
}

try {
	run("npm", ["run", "sync:ios"]);
	fs.rmSync(build, { recursive: true, force: true });
	run("xcodebuild", [
		"-project", "ios/App/App.xcodeproj",
		"-scheme", "App",
		"-configuration", "Release",
		"-destination", "generic/platform=iOS",
		"-archivePath", archive,
		"-derivedDataPath", path.join(build, "DerivedData"),
		// The versions of the packages are the ones committed (swift-collections is held at a version
		// that compiles on Xcode 27), never a newer one resolved on the day of the release.
		"-onlyUsePackageVersionsFromResolvedFile",
		"archive",
		"CODE_SIGNING_ALLOWED=NO",
		"CODE_SIGNING_REQUIRED=NO",
		"CODE_SIGN_IDENTITY=",
		`MARKETING_VERSION=${version}`,
		`CURRENT_PROJECT_VERSION=${code}`,
	]);

	// An IPA is a zip of Payload/<name>.app.
	const app = path.join(archive, "Products", "Applications", "App.app");
	const stage = path.join(build, "ipa");
	fs.mkdirSync(path.join(stage, "Payload"), { recursive: true });
	run("ditto", [app, path.join(stage, "Payload", "App.app")]);
	// A framework that comes built (OpenSSL, which the WebRTC library needs) arrives with its vendor's
	// signature, which Xcode copies as it is even with signing off. The sideloading tool signs every
	// framework anew with the owner's identity, so that signature is never what an iPhone checks: it is
	// taken off, and the IPA holds no signature at all, as it says.
	for (const file of machO(path.join(stage, "Payload", "App.app"))) {
		if (spawnSync("codesign", ["-dv", file], { encoding: "utf8" }).status === 0) run("codesign", ["--remove-signature", file]);
	}
	fs.mkdirSync(output, { recursive: true });
	fs.rmSync(ipa, { force: true });
	run("zip", ["-qry", ipa, "Payload"], stage);

	// What a sideloading tool gets: checked on the app as it lies in the IPA.
	const unpacked = path.join(build, "check");
	run("ditto", ["-x", "-k", ipa, unpacked]);
	const inside = path.join(unpacked, "Payload", "App.app");
	// The app and every piece of code in it: its binary, and each embedded framework's.
	const pieces = [inside, ...machO(inside).filter((f) => f !== path.join(inside, "App"))];
	for (const file of pieces) {
		const signature = spawnSync("codesign", ["-dv", file], { encoding: "utf8" });
		if (signature.status === 0 || !/not signed at all/.test(signature.stderr)) {
			throw new Error(`${path.relative(unpacked, file)} in the IPA is signed, and must not be:\n${signature.stderr}`);
		}
	}
	const archs = read("lipo", ["-archs", path.join(inside, "App")]);
	if (archs !== "arm64") throw new Error(`the app's binary is "${archs}", not arm64 alone.`);
	// What the app carries beside it runs on an iPhone too (Swift's own back-deployment libraries come as arm64 and arm64e).
	for (const file of machO(inside)) {
		const has = read("lipo", ["-archs", file]).split(" ");
		if (!has.includes("arm64")) throw new Error(`${path.relative(unpacked, file)} is "${has.join(" ")}", without arm64.`);
	}
	// The WebRTC library pairing rests on: linked into the app's binary, and the TLS library it needs beside it.
	if (!fs.existsSync(path.join(inside, "Frameworks", "OpenSSL.framework", "OpenSSL"))) throw new Error("the app carries no OpenSSL.framework, which the WebRTC library needs.");
	if (!fs.readFileSync(path.join(inside, "App")).includes("libdatachannel")) throw new Error("the app's binary does not carry libdatachannel.");
	const plist = path.join(inside, "Info.plist");
	const shown = read("plutil", ["-extract", "CFBundleShortVersionString", "raw", plist]);
	const number = read("plutil", ["-extract", "CFBundleVersion", "raw", plist]);
	if (shown !== version || number !== String(code)) {
		throw new Error(`the app says version ${shown} (${number}), not ${version} (${code}).`);
	}
	console.log(`wrote ${ipa}: ${fs.statSync(ipa).size} bytes, nothing signed (the app and ${pieces.length - 1} embedded binaries), arm64, libdatachannel and OpenSSL inside, version ${version} (${code})`);
} catch (e) {
	console.error((e as Error).message);
	process.exit(1);
}
