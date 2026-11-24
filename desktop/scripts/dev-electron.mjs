// The Electron that a run from this checkout starts (npm run desktop, npm run dev). On a Mac the
// menu bar and the Dock take the app's name from the bundle it runs in, not from app.setName(): the
// stock Electron.app says "Electron". So a run starts a copy of it named Pine, with Pine's icon,
// signed again for this Mac (a changed Info.plist breaks the signature it came with). The copy is
// made once for each version of Electron and icon, in node_modules/.cache, and only ever started:
// the packed app (scripts/pack.mjs) is built apart from it. Elsewhere Electron is started as it is.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");

/** The program to start for a run from this checkout: Pine.app's executable on a Mac, Electron's elsewhere. */
export function devElectron() {
	const electron = require("electron");
	if (process.platform !== "darwin") return electron;
	try {
		return pineApp(electron);
	} catch (e) {
		// A copy that cannot be made is no reason not to run: the menu then says Electron, as before.
		console.warn(`pine: starting Electron as it is (${e instanceof Error ? e.message : e})`);
		return electron;
	}
}

function pineApp(electron) {
	// …/Electron.app/Contents/MacOS/Electron → …/Electron.app
	const stock = path.resolve(electron, "..", "..", "..");
	const icon = path.join(root, "assets", "icon.icns");
	const version = require("electron/package.json").version;
	// "id": copies made before the bundle id was set are made again.
	const stamp = `${version} ${fs.existsSync(icon) ? fs.statSync(icon).mtimeMs : 0} id`;
	const dir = path.join(root, "node_modules", ".cache", "pine-dev");
	const app = path.join(dir, "Pine.app");
	const exe = path.join(app, "Contents", "MacOS", path.basename(electron));
	const stampFile = path.join(dir, "stamp");
	if (fs.existsSync(exe) && fs.existsSync(stampFile) && fs.readFileSync(stampFile, "utf8") === stamp) return exe;

	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	execFileSync("/usr/bin/ditto", [stock, app]);
	const plist = path.join(app, "Contents", "Info.plist");
	for (const key of ["CFBundleName", "CFBundleDisplayName"]) execFileSync("/usr/bin/plutil", ["-replace", key, "-string", "Pine", plist]);
	// The packed app's id with a suffix: app control knows the Pine app by it and acts nowhere in it (mcp/computer.ts).
	execFileSync("/usr/bin/plutil", ["-replace", "CFBundleIdentifier", "-string", "dev.pine.desktop.dev", plist]);
	if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(app, "Contents", "Resources", "electron.icns"));
	execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "ignore" });
	fs.writeFileSync(stampFile, stamp);
	return exe;
}
