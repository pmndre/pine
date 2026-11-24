// Makes the app that is handed out, for the system it runs on: release/mac-*/Pine.app on a Mac,
// release/linux-*unpacked on Linux, release/win-*unpacked on Windows; with --dist the packages too.
//   node scripts/pack.mjs            the app, for this computer's kind of processor
//   node scripts/pack.mjs --dist     also what is handed out: a disk image (Pine-<version>-<arch>.dmg)
//                                    on a Mac with what its updater reads (the app zipped,
//                                    Pine-<version>-<arch>.zip, and its feed, Pine-<arch>.json), an
//                                    AppImage and a .deb on Linux, an installer
//                                    (Pine-<version>-<arch>-setup.exe) on Windows. --dmg is the same
//   node scripts/pack.mjs --dir      the app alone (the default), as a folder that --prepackaged takes
//   node scripts/pack.mjs --prepackaged <folder>   the packages of an app packed before with --dir (and
//                                    signed meanwhile, as a release on Windows does): nothing is built again
//   node scripts/pack.mjs --arch x64 for the other kind of processor (arm64, x64)
//   node scripts/pack.mjs --no-pine  without a pine inside: the app then uses the `pine` of the owner's shell
//   node scripts/pack.mjs --out <folder>   into another folder than release/ (for a build beside one that is in use)
//
// The app carries everything pine needs, so that it works where nothing was installed:
//   resources/pine   the package `npm run build` makes in the checkout (the sources compiled, as
//                    they go to npm) with what it depends on, and on a Mac its helpers built for
//                    both kinds of Mac (scripts/helpers.mjs of the checkout)
//   resources/node   the Node pine runs on, as nodejs.org hands it out for that system: the version
//                    this script runs on. pine never runs on the app's Electron: its children are
//                    started with the program it runs on, which has to be a Node
//   resources/bin    `pine` for a terminal: scripts/pine.sh as bin/pine, which the app links into the
//                    PATH; on Windows scripts/pine.cmd, whose folder the installer puts into the PATH
//
// Signing on a Mac. Without anything set, the app is signed for this Mac only ("ad hoc"). To hand it out:
//   CSC_NAME                               a Developer ID Application identity in the keychain, or
//   CSC_LINK, CSC_KEY_PASSWORD             the same as a .p12 file (a path or base64) and its password
//   APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER    an App Store Connect key: the app is notarised
// Either way it is signed with the hardened runtime, so that what is tried here is what is shipped.
// On Windows and Linux nothing is signed here (a release signs the Windows app between --dir and --prepackaged).
// PINE_VERSION gives the app and the pine inside it their version (a release sets it).
import { build as packApp } from "electron-builder";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { updateFeed } from "./update-feed.ts";

const root = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(root, "..");
const stage = path.join(root, ".stage", "pine");
const flags = new Set(process.argv.slice(2));
const valueOf = (flag) => {
	const at = process.argv.indexOf(flag);
	return at > 0 ? process.argv[at + 1] : undefined;
};
const out = path.resolve(root, valueOf("--out") ?? "release");
const arch = valueOf("--arch") ?? process.arch;
if (arch !== "arm64" && arch !== "x64") {
	console.error(`--arch is arm64 or x64, not "${arch}"`);
	process.exit(2);
}
const system = process.platform;
if (!["darwin", "linux", "win32"].includes(system)) {
	console.error(`The app is packed on a Mac, on Linux or on Windows, for that system; not on ${system}.`);
	process.exit(2);
}
const prepackaged = valueOf("--prepackaged") && path.resolve(valueOf("--prepackaged"));
if (flags.has("--prepackaged") && !(prepackaged && fs.existsSync(prepackaged))) {
	console.error("--prepackaged names the folder of an app packed with --dir: node scripts/pack.mjs --prepackaged release/win-unpacked");
	process.exit(2);
}
const dist = flags.has("--dist") || flags.has("--dmg") || Boolean(prepackaged);
const carries = !flags.has("--no-pine");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

/** Whether a program of the app in `dir` runs now: somebody's open window, which is not deleted under them. */
function runningFrom(dir) {
	if (system === "win32") {
		// The folder goes in through the environment, never as a part of the command.
		const said = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:PINE_PACK_OUT, 'OrdinalIgnoreCase') } | Select-Object -First 1 -ExpandProperty ProcessId"], { encoding: "utf8", env: { ...process.env, PINE_PACK_OUT: `${dir}\\` }, windowsHide: true });
		return said.trim() || undefined;
	}
	const lines = execFileSync("/bin/ps", ["-A", "-o", "pid=,command="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).split("\n");
	// On a Mac the app's own program, inside Pine.app; elsewhere any program that lies in that folder.
	const line = lines.find((l) => l.includes(`${dir}/`) && (system !== "darwin" || l.includes(".app/Contents/MacOS/")) && !l.includes(process.argv[1]));
	return line?.trim().split(/\s+/)[0];
}
if (!prepackaged && fs.existsSync(out)) {
	const pid = runningFrom(out);
	if (pid) {
		console.error(`An app from ${out} is running (process ${pid}). Quit it first, or pack into another folder: node scripts/pack.mjs --out release-next`);
		process.exit(1);
	}
}

if (!prepackaged) {
	run(process.execPath, [path.join(root, "scripts", "build.mjs")], root);
	if (system === "darwin" && !fs.existsSync(path.join(root, "assets", "icon.icns"))) run(path.join(root, "node_modules", ".bin", "electron"), [path.join(root, "scripts", "icon.mjs")], root);
}

/** What nodejs.org calls this system, and how it hands Node out for it. */
const NODE = {
	darwin: { os: "darwin", ext: "tar.gz", program: "bin/node" },
	linux: { os: "linux", ext: "tar.xz", program: "bin/node" },
	win32: { os: "win", ext: "zip", program: "node.exe" },
}[system];

/**
 * The Node the app carries, as nodejs.org hands it out for this system and processor: fetched
 * once, kept in .stage, and only used when it is the file their list of checksums names. What is
 * kept is the program and its licence, as they lie in the archive (bin/node; node.exe on Windows).
 */
async function carriedNode() {
	const name = `node-${process.version}-${NODE.os}-${arch}`;
	const dir = path.join(root, ".stage", "node", name);
	if (fs.existsSync(path.join(dir, NODE.program))) return dir;
	const from = `https://nodejs.org/dist/${process.version}`;
	const get = async (file) => {
		const res = await fetch(`${from}/${file}`);
		if (!res.ok) throw new Error(`${from}/${file} answered ${res.status}`);
		return Buffer.from(await res.arrayBuffer());
	};
	const file = `${name}.${NODE.ext}`;
	console.log(`fetching ${name} for the app ...`);
	const wanted = new RegExp(`^([0-9a-f]{64})\\s+${file.replaceAll(".", "\\.")}$`, "m").exec((await get("SHASUMS256.txt")).toString("utf8"))?.[1];
	if (!wanted) throw new Error(`nodejs.org lists no ${file}: is ${process.version} a released version?`);
	const archive = await get(file);
	const got = createHash("sha256").update(archive).digest("hex");
	if (got !== wanted) throw new Error(`${file} is not the file nodejs.org lists (sha256 ${got}, listed ${wanted})`);
	const tmp = `${dir}.tmp`;
	fs.rmSync(tmp, { recursive: true, force: true });
	fs.mkdirSync(tmp, { recursive: true });
	fs.writeFileSync(path.join(tmp, file), archive);
	// The program and its licence, which has to travel with it. npm and the rest stay out: pine uses none of it.
	// (Windows 10 and later have bsdtar as tar.exe, which reads a zip too.)
	const members = [`${name}/${NODE.program}`, `${name}/LICENSE`];
	if (system === "win32") run(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", file, ...members], tmp);
	else run("tar", [NODE.ext === "tar.xz" ? "-xJf" : "-xzf", file, ...members], tmp);
	for (const member of members) {
		fs.mkdirSync(path.dirname(path.join(tmp, member.slice(name.length + 1))), { recursive: true });
		fs.renameSync(path.join(tmp, member), path.join(tmp, member.slice(name.length + 1)));
	}
	fs.rmSync(path.join(tmp, name), { recursive: true, force: true });
	fs.rmSync(path.join(tmp, file));
	fs.renameSync(tmp, dir);
	return dir;
}

/**
 * Windows: Node for Linux, as nodejs.org hands it out, for the pine the app brings into a WSL
 * distribution (electron/wsl.ts). The archive goes in as it is, checked against nodejs.org's sums.
 */
async function nodeForWsl() {
	const file = `node-${process.version}-linux-${arch}.tar.xz`;
	const kept = path.join(root, ".stage", "node", file);
	if (fs.existsSync(kept)) return kept;
	const from = `https://nodejs.org/dist/${process.version}`;
	const get = async (name) => {
		const res = await fetch(`${from}/${name}`);
		if (!res.ok) throw new Error(`${from}/${name} answered ${res.status}`);
		return Buffer.from(await res.arrayBuffer());
	};
	console.log(`fetching ${file} for WSL ...`);
	const wanted = new RegExp(`^([0-9a-f]{64})\\s+${file.replaceAll(".", "\\.")}$`, "m").exec((await get("SHASUMS256.txt")).toString("utf8"))?.[1];
	const archive = await get(file);
	if (!wanted || createHash("sha256").update(archive).digest("hex") !== wanted) throw new Error(`${file} is not the file nodejs.org lists`);
	fs.mkdirSync(path.dirname(kept), { recursive: true });
	fs.writeFileSync(kept, archive);
	return kept;
}

const pineVersion = process.env.PINE_VERSION ?? JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version;
let node;
let wslNode;
if (carries && !prepackaged) {
	run(process.execPath, [path.join(repo, "scripts", "build.mjs")], repo);
	fs.rmSync(stage, { recursive: true, force: true });
	fs.mkdirSync(path.dirname(stage), { recursive: true });
	fs.cpSync(path.join(repo, "build"), stage, { recursive: true });
	// What pine is built on, as an install of the package would fetch it.
	const install = ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"];
	// npm is a .cmd on Windows, which runs only through the shell there.
	if (system === "win32") execFileSync(`npm ${install.join(" ")}`, { cwd: stage, stdio: "inherit", shell: true });
	else run("npm", install, stage);
	// Its helpers, built: a Mac without Apple's developer tools could not build them itself. They are Mac programs only.
	// (On Windows the C# ones, which the release then signs with the rest of the app.)
	if (system === "darwin" || system === "win32") run(process.execPath, [path.join(repo, "scripts", "helpers.mjs"), stage], repo);
	node = await carriedNode();
	if (system === "win32") wslNode = await nodeForWsl();
}

// What the signed programs may do under the hardened runtime. Electron and Node make machine code
// as they run; the voice helper listens. Signed for this Mac only, the parts have no team in
// common, and the system would not let one load the other without the last entry.
const identity = process.env.CSC_NAME ?? (process.env.CSC_LINK ? undefined : "-");
const adhoc = identity === "-";
const entitlements = path.join(root, ".stage", "entitlements.plist");
if (system === "darwin") {
	fs.mkdirSync(path.dirname(entitlements), { recursive: true });
	fs.writeFileSync(
		entitlements,
		`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
${["com.apple.security.cs.allow-jit", "com.apple.security.cs.allow-unsigned-executable-memory", "com.apple.security.device.audio-input", ...(adhoc ? ["com.apple.security.cs.disable-library-validation"] : [])].map((key) => `<key>${key}</key><true/>`).join("\n")}
</dict></plist>
`,
	);
}

// Notarising, with an App Store Connect key, is done here and not by the packer. Apple checks the
// app, and then its answer (the "ticket") is attached to the app, which asks another server of
// Apple's. That server drops a connection now and then, and the packer gives up at the first one:
// a release then had no app although Apple had long said yes. Here that step is tried again.
const key = { file: process.env.APPLE_API_KEY, id: process.env.APPLE_API_KEY_ID, issuer: process.env.APPLE_API_ISSUER };
const notariseHere = !adhoc && system === "darwin" && Boolean(key.file && key.id && key.issuer);
const STAPLE_TRIES = 10;

async function notarise(app) {
	const zip = `${app}.zip`;
	run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
	let answer;
	try {
		console.log(`sending ${path.basename(app)} to Apple to be notarised, and waiting for the answer ...`);
		const said = execFileSync("/usr/bin/xcrun", ["notarytool", "submit", zip, "--key", key.file, "--key-id", key.id, "--issuer", key.issuer, "--wait", "--output-format", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 16 * 1024 * 1024 });
		answer = JSON.parse(said);
	} finally {
		fs.rmSync(zip, { force: true });
	}
	if (answer.status !== "Accepted") throw new Error(`Apple did not notarise the app: its answer is "${answer.status}". What it found: xcrun notarytool log ${answer.id} --key <file> --key-id <id> --issuer <issuer>`);
	console.log(`Apple notarised it (${answer.id})`);
	for (let i = 1; ; i++) {
		try {
			run("/usr/bin/xcrun", ["stapler", "staple", app]);
			return;
		} catch (e) {
			if (i >= STAPLE_TRIES) throw new Error(`Apple notarised the app, but its ticket could not be attached in ${STAPLE_TRIES} tries (xcrun stapler staple). Run this again later: the app need not be sent to Apple anew for that.`);
			const wait = Math.min(15 * i, 60);
			console.log(`the ticket could not be attached (try ${i} of ${STAPLE_TRIES}); again in ${wait} seconds`);
			await new Promise((r) => setTimeout(r, wait * 1000));
		}
	}
}

if (!prepackaged) {
	// What an earlier run left is taken away first: the packer does not always manage to itself.
	// (Tried a few times: the Finder and the system's index write into a folder that is being looked at.)
	fs.rmSync(out, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });

	// node-pty's helper has to be executable, which npm leaves undone where install scripts may not run.
	for (const dir of fs.existsSync(path.join(root, "node_modules", "node-pty", "prebuilds")) ? fs.readdirSync(path.join(root, "node_modules", "node-pty", "prebuilds")) : []) {
		const helper = path.join(root, "node_modules", "node-pty", "prebuilds", dir, "spawn-helper");
		if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
	}
}

/** What is handed out on this system, beside the app's own folder. */
const PACKAGES = { darwin: ["dmg"], linux: ["AppImage", "deb"], win32: ["nsis"] }[system];
// From a folder packed before, only the packages: the app itself is that folder.
const targets = prepackaged ? PACKAGES : dist ? [...PACKAGES, "dir"] : ["dir"];
const forArch = (list) => list.map((target) => ({ target, arch: [arch] }));
/**
 * Pine.exe says the release's version as the installer and pine's helpers do ("0.41.0"): the
 * packer writes its product version through resedit, which always makes it "0.41.0.0". A release's
 * code signing checks that every file it signs says the same version (desktop/signpath/).
 */
function sayVersion(exe) {
	const { NtExecutable, NtExecutableResource, Resource } = createRequire(import.meta.url)("resedit");
	const executable = NtExecutable.from(fs.readFileSync(exe));
	const res = NtExecutableResource.from(executable);
	const [info] = Resource.VersionInfo.fromEntries(res.entries);
	if (!info) throw new Error(`${exe} has no version information`);
	for (const lang of info.getAllLanguagesForStringValues()) info.setStringValues(lang, { ProductVersion: pineVersion });
	info.outputToResourceEntries(res.entries);
	res.outputResource(executable);
	fs.writeFileSync(exe, Buffer.from(executable.generate()));
}

// node-datachannel, the peer connection of browser access, loads the binary of a package of its
// own for each kind of Mac, and npm installs only this Mac's. (On Linux and Windows the app is
// packed on a computer of its own kind, which has the right one.) For an app of the other kind the
// other one is fetched here, at the version node-datachannel names, through npm, which checks it
// against the registry's checksum, and put beside this Mac's.
const datachannel = path.join(root, "node_modules", "@node-datachannel", `darwin-${arch}`);
if (system === "darwin" && !fs.existsSync(path.join(datachannel, "node_datachannel.node"))) {
	const version = JSON.parse(fs.readFileSync(path.join(root, "node_modules", "node-datachannel", "package.json"), "utf8")).optionalDependencies[`@node-datachannel/darwin-${arch}`];
	const into = path.join(root, ".stage", "datachannel");
	fs.rmSync(into, { recursive: true, force: true });
	fs.mkdirSync(into, { recursive: true });
	const file = execFileSync("npm", ["pack", `@node-datachannel/darwin-${arch}@${version}`, "--pack-destination", into, "--silent"], { cwd: into, encoding: "utf8" }).trim().split("\n").pop();
	fs.mkdirSync(datachannel, { recursive: true });
	run("/usr/bin/tar", ["-xzf", path.join(into, file), "--strip-components", "1", "-C", datachannel], into);
}
/** node-datachannel's binaries for other systems and processors than this app's, which the app leaves out. */
const ownBinding = { darwin: `darwin-${arch}`, linux: `linux-${arch}-gnu`, win32: `win32-${arch}-msvc` }[system];
const otherBindings = Object.keys(JSON.parse(fs.readFileSync(path.join(root, "node_modules", "node-datachannel", "package.json"), "utf8")).optionalDependencies ?? {})
	.map((name) => name.replace("@node-datachannel/", ""))
	.filter((name) => name !== ownBinding);

/** Where the packer put the app's folder (afterPack says it); with --prepackaged, that folder. */
let appOutDir = prepackaged;

const made = await packApp({
	projectDir: root,
	publish: "never",
	...(prepackaged ? { prepackaged } : {}),
	config: {
		appId: "dev.pine.desktop",
		productName: "Pine",
		copyright: "pine contributors",
		directories: { output: path.relative(root, out), buildResources: "assets" },
		// The app has the version of the pine it carries: they are made and handed out together.
		// (A Linux package names where it comes from.)
		extraMetadata: { version: pineVersion, homepage: "https://github.com/pmndre/pine" },
		// Everything the app runs is in the two built folders: the page and the main process are bundles.
		// The exceptions are node-pty, the terminal's pseudo-terminal, and node-datachannel, browser
		// access's peer connection (dependencies of the app's, which the packer adds by itself):
		// native, so they lie outside the archive, where they are signed with the app. Of
		// node-datachannel's binaries only the one for this app's system and processor goes in (npm puts
		// both of Linux's beside each other, for glibc and for musl; Electron is glibc). ssh2, the access
		// server's SSH, is not bundled either (it is CommonJS that needs `__dirname`): it is added by
		// the packer like them, inside the archive, without its native bindings (scripts/ssh2-pure.mjs).
		files: ["dist/**", "dist-electron/**", "package.json", ...otherBindings.map((name) => `!node_modules/@node-datachannel/${name}/**`)],
		asarUnpack: ["node_modules/node-pty/**", "node_modules/node-datachannel/**", "node_modules/@node-datachannel/**"],
		// pine goes in whole, with what it depends on, before the app is signed. (Listed as a resource,
		// the packer would leave its node_modules out.) With it the Node it runs on and `pine` for a terminal.
		afterPack: (context) => {
			appOutDir = context.appOutDir;
			if (!carries) return;
			const resources = context.electronPlatformName === "darwin" ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources") : path.join(context.appOutDir, "resources");
			fs.cpSync(stage, path.join(resources, "pine"), { recursive: true, verbatimSymlinks: true });
			if (!node) return;
			fs.cpSync(node, path.join(resources, "node"), { recursive: true });
			fs.mkdirSync(path.join(resources, "bin"), { recursive: true });
			if (context.electronPlatformName === "win32") {
				fs.copyFileSync(path.join(root, "scripts", "pine.cmd"), path.join(resources, "bin", "pine.cmd"));
				// What the app brings into WSL beside the pine above (electron/wsl.ts).
				if (wslNode) {
					fs.mkdirSync(path.join(resources, "wsl"), { recursive: true });
					fs.copyFileSync(wslNode, path.join(resources, "wsl", "node-linux.tar.xz"));
				}
			}
			else {
				fs.copyFileSync(path.join(root, "scripts", "pine.sh"), path.join(resources, "bin", "pine"));
				fs.chmodSync(path.join(resources, "bin", "pine"), 0o755);
			}
		},
		// After the app is signed and before a disk image is made of it: the image then holds the app with its ticket.
		afterSign: async (context) => {
			if (context.electronPlatformName === "win32") return sayVersion(path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`));
			if (!notariseHere || context.electronPlatformName !== "darwin") return;
			await notarise(path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`));
		},
		asar: true,
		npmRebuild: false,
		mac: {
			category: "public.app-category.developer-tools",
			icon: "assets/icon.icns",
			target: forArch(targets),
			artifactName: "Pine-${version}-${arch}.${ext}",
			darkModeSupport: true,
			// Signed for this Mac only ("ad hoc") unless a Developer ID is set up: enough to run what was built here.
			identity,
			hardenedRuntime: true,
			entitlements,
			entitlementsInherit: entitlements,
			// Notarised when a signature Apple knows and an App Store Connect key are both there: by
			// `notarise` above. With another kind of sign-in (APPLE_ID, a keychain profile) by the packer.
			notarize: !adhoc && !notariseHere,
			extendInfo: {
				// Dictating a message: the helper that listens asks under its own name, and the app says why too.
				NSMicrophoneUsageDescription: "Pine listens while you dictate a message.",
				NSSpeechRecognitionUsageDescription: "Pine turns what you say into text for the message you are writing. The words are recognised on this Mac.",
				// Visible on this network (ADR 0005): macOS 15 and later ask before an app uses the local network, and say why.
				NSLocalNetworkUsageDescription: "Pine announces this Mac on your network, so that the Pine app on your phone finds it and can ask to connect.",
				NSBonjourServices: ["_pine._tcp"],
				CFBundleDocumentTypes: [{ CFBundleTypeName: "Folder", CFBundleTypeRole: "Viewer", LSHandlerRank: "Alternate", LSItemContentTypes: ["public.folder"] }],
			},
		},
		dmg: { title: `Pine ${pineVersion}` },
		// `pine://pair` (ADR 0005): a page of the web client opens the app on this computer to add a device.
		protocols: [{ name: "Pine", schemes: ["pine"] }],
		linux: {
			target: forArch(targets),
			icon: "assets/icon.png",
			category: "Development",
			// Not `pine`: a .deb puts the program into /usr/bin under this name, where the pine command may be.
			executableName: "pine-desktop",
			synopsis: "The desktop app for pine",
			maintainer: "pine contributors",
			artifactName: "Pine-${version}-${arch}.${ext}",
		},
		win: { target: forArch(targets), icon: "assets/icon.png" },
		// For the user alone (no administrator), into a folder they may choose. The include puts resources\bin into their PATH.
		nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, include: path.join(root, "scripts", "installer.nsh"), artifactName: "Pine-${version}-${arch}-setup.${ext}" },
	},
});

/** The app itself, in the folder the packer made: what the smoke test starts. */
const app = system === "darwin" ? path.join(appOutDir ?? path.join(out, arch === "arm64" ? "mac-arm64" : "mac"), "Pine.app") : appOutDir;
if (system === "darwin" && !prepackaged) {
	// Every part has to carry a signature the whole agrees with, or the system will not start it elsewhere.
	run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], root);
	const notarised = !adhoc && (process.env.APPLE_API_KEY || process.env.APPLE_ID || process.env.APPLE_KEYCHAIN_PROFILE);
	console.log(adhoc ? "signed for this Mac only: to hand the app out, sign it with a Developer ID (CSC_NAME or CSC_LINK) and have it notarised" : notarised ? "signed and notarised" : "signed with a Developer ID but not notarised: another Mac will not open it. Set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER");
}
if (app) console.log(`the app is ${app}`);
for (const file of made) console.log(`made ${file}`);

// What an app in the field updates from, beside the disk image. The zip is made of the app as it is
// now, after its ticket was attached (in afterSign), so that the ticket travels inside it; the zip
// notarise() sent to Apple was of the app before that, and is gone. Without a key (a pack of one's
// own) both are written all the same, to be looked at by hand.
if (dist && system === "darwin") {
	if (/^\d+\.\d+\.\d+$/.test(pineVersion)) {
		const { files, json } = updateFeed(pineVersion, arch, new Date());
		const zip = path.join(out, files.zip);
		fs.rmSync(zip, { force: true });
		run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
		fs.writeFileSync(path.join(out, files.feed), `${JSON.stringify(json, null, "\t")}\n`);
		console.log(`the update is ${zip}, its feed ${path.join(out, files.feed)}`);
	} else {
		console.log(`no update feed: ${pineVersion} is not the version of a release, and only releases are updated to`);
	}
}
