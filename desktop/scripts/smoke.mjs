// Starts a packed app on a pine home of its own and looks whether it comes up with the pine it
// carries inside, on the Node it carries, and whether `pine` for a terminal and (on a Mac) the
// built helpers are what pine finds. For checking what `npm run pack` made, on the system it was
// made for.
//   node scripts/smoke.mjs [release/mac-arm64/Pine.app | release/linux-unpacked | release/win-unpacked]
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { startMock } from "../../baseline/tests/mock.mjs";

const root = path.resolve(import.meta.dirname, "..");
const system = process.platform;
const mac = system === "darwin";
const windows = system === "win32";
/** Where pack.mjs puts the app for this system and processor, and how its folder is laid out. */
const LAYOUT = {
	darwin: { packed: path.join(process.arch === "arm64" ? "mac-arm64" : "mac", "Pine.app"), copy: "Pine.app", binary: "Pine.app/Contents/MacOS/Pine", resources: "Pine.app/Contents/Resources", node: "node/bin/node" },
	linux: { packed: process.arch === "arm64" ? "linux-arm64-unpacked" : "linux-unpacked", copy: "Pine", binary: "Pine/pine-desktop", resources: "Pine/resources", node: "node/bin/node" },
	win32: { packed: process.arch === "arm64" ? "win-arm64-unpacked" : "win-unpacked", copy: "Pine", binary: "Pine/Pine.exe", resources: "Pine/resources", node: "node/node.exe" },
}[system];
if (!LAYOUT) throw new Error(`The app is made for a Mac, Linux and Windows, not for ${system}.`);
const appDir = path.resolve(process.argv[2] ?? path.join(root, "release", LAYOUT.packed));
// Tried from a folder of its own: inside the checkout, a pine that lacks what it depends on would
// find it in the checkout's own node_modules and seem whole.
const away = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-smoke-app-")));
fs.cpSync(appDir, path.join(away, LAYOUT.copy), { recursive: true, verbatimSymlinks: true });
const binary = path.join(away, LAYOUT.binary);
/** Whether a process runs whose command line holds all of these words. */
function running(...words) {
	if (windows) {
		const said = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine } | Where-Object { $_ }"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true });
		return said.split(/\r?\n/).some((l) => words.every((w) => l.includes(w)));
	}
	return execFileSync("/bin/ps", ["-A", "-o", "command="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).split("\n").some((l) => words.every((w) => l.includes(w)));
}
const here = mac ? "this Mac" : "this computer";
const write = (file, content) => (fs.mkdirSync(path.dirname(file), { recursive: true }), fs.writeFileSync(file, content));
const freePort = () => new Promise((resolve) => {
	const s = net.createServer();
	s.listen(0, "127.0.0.1", () => {
		const p = s.address().port;
		s.close(() => resolve(p));
	});
});

const mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-smoke-")));
write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, defaults: { model: "mock/m", mode: "safe", introduce: false } }));
write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ description: "The main agent" }));
write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "You are the main agent.\n");

const port = await freePort();
// PINE_CLI and PINE_NODE are taken out: the app is to find the pine and the Node it carries.
// (A packed app asks GitHub for a newer one at its start. Not this one: with nothing named, nobody is asked.)
const env = { ...process.env, PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_DESKTOP_RELEASES: "" };
delete env.PINE_CLI;
delete env.PINE_NODE;
const resources = path.join(away, LAYOUT.resources);
const ownNode = path.join(resources, LAYOUT.node);
/** What the app carries beside pine (not in one packed with --no-pine, or for another system). */
const whole = fs.existsSync(ownNode);
const child = spawn(binary, [`--remote-debugging-port=${port}`], { env, stdio: "ignore" });
let failed;
try {
	let browser;
	for (let i = 0; i < 100 && !browser; i++) {
		browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
		if (!browser) await new Promise((r) => setTimeout(r, 200));
	}
	if (!browser) throw new Error("the app did not come up");
	let page;
	for (let i = 0; i < 100 && !page; i++) {
		page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith("app://"));
		if (!page) await new Promise((r) => setTimeout(r, 200));
	}
	if (!page) throw new Error("the app has no window");
	// (The page is found by the names its parts carry, `data-slot`, as desktop/test/ finds it.)
	await page.waitForSelector("[data-slot=empty] h1", { timeout: 60_000 }).catch(async () => {
		throw new Error(`no conversation appeared. On screen: ${await page.evaluate(() => document.body.innerText.slice(0, 600))}`);
	});
	// On a Mac without the browser build this pine drives (a new one, a CI machine) the app asks at
	// its start whether to fetch it, and the question lies over the page. The daemon says whether
	// it will be asked: then it is waited for and answered with "Not now".
	const over = await page.evaluate(() => window.pine.call("GET", "/overview"));
	if (over?.data?.browser === false) {
		await page.waitForSelector(`[data-slot=dialog-title] >> text=The browser for the web tools is not on ${here}`, { timeout: 30_000 });
		await page.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Not now" }).click();
		await page.waitForSelector("[data-slot=dialog-content]", { state: "detached", timeout: 15_000 });
	}
	const status = await page.textContent("[data-slot=service-status]");
	await page.fill("[data-slot=composer] textarea", "hello from the packed app");
	await page.keyboard.press("Enter");
	await page.waitForSelector("[data-slot=markdown] >> text=ECHO[hello from the packed app]", { timeout: 30_000 });
	const from = (await page.evaluate(() => window.pine.state())).state.from;
	if (process.argv[3]) await page.screenshot({ path: process.argv[3] });
	const shown = await page.evaluate(() => document.visibilityState);
	console.log(`ok: ${status?.trim()}; pine found in: ${from}; a message was answered; the window is ${shown}`);
	if (shown !== "visible") throw new Error("the app's window never showed");
	// The terminal: node-pty is the one native module of the app's own, and outside the archive.
	const printed = await page.evaluate(
		(typed) =>
			new Promise((resolve, reject) => {
				let out = "";
				const stop = window.pine.onTermData((id, data) => {
					if (id !== "smoke:term") return;
					out += data;
					if (/smoke-\d+/.test(out)) (stop(), void window.pine.termClose("smoke:term"), resolve(/smoke-\d+/.exec(out)[0]));
				});
				setTimeout(() => (stop(), reject(new Error(`the terminal printed: ${JSON.stringify(out.slice(-400))}`))), 15_000);
				window.pine.termOpen("smoke:term", undefined, 80, 24).then(() => window.pine.termWrite("smoke:term", typed), reject);
			}),
		// PowerShell on Windows; the owner's POSIX shell elsewhere.
		windows ? 'Write-Output "smoke-$(40+2)"\r' : "echo smoke-$((40+2))\r",
	);
	if (printed !== "smoke-42") throw new Error(`the terminal printed ${printed}`);
	// A block run as its Run button runs it, in the owner's own shell with their startup files and pine's hooks: it says how it went.
	const report = await page.evaluate(
		(block) =>
			new Promise((resolve, reject) => {
				const stop = window.pine.onTermRun((id, r) => id === "smoke:run" && r.state === "ended" && (stop(), void window.pine.termClose("smoke:run"), resolve(r)));
				setTimeout(() => (stop(), reject(new Error("the run never said that it had ended"))), 20_000);
				window.pine.termOpen("smoke:run", undefined, 80, 24).then(() => window.pine.termRun("smoke:run", block)).then((r) => r.reports || reject(new Error("this shell does not report")), reject);
			}),
		windows ? 'Write-Output "ran-$(6*7)"; cmd /c exit 1' : "echo ran-$((6*7)); false",
	);
	if (report.code !== 1 || !/ran-42/.test(report.output)) throw new Error(`the run reported ${JSON.stringify(report)}`);
	console.log("ok: a terminal runs in the app's own node-pty, and a block run in the owner's shell says how it ended");
	// Browser access: node-datachannel is the app's other native module, outside the archive. Loaded
	// by the app's own program under its signature, as Node (the main process loads it the same
	// way), and two of its peers on this Mac open a channel and pass a message.
	const peered = execFileSync(binary, ["-e", `
		const ndc = require(${JSON.stringify(path.join(resources, "app.asar", "node_modules", "node-datachannel"))});
		const where = require.resolve(${JSON.stringify(path.join(resources, "app.asar", "node_modules", "node-datachannel"))});
		const a = new ndc.PeerConnection("a", { iceServers: [] });
		const b = new ndc.PeerConnection("b", { iceServers: [] });
		a.onLocalDescription((sdp, type) => b.setRemoteDescription(sdp, type));
		a.onLocalCandidate((c, mid) => b.addRemoteCandidate(c, mid));
		b.onLocalDescription((sdp, type) => a.setRemoteDescription(sdp, type));
		b.onLocalCandidate((c, mid) => a.addRemoteCandidate(c, mid));
		const end = (said) => { a.close(); b.close(); ndc.cleanup(); console.log(said); };
		const timer = setTimeout(() => end("no channel opened"), 15000);
		b.onDataChannel((dc) => dc.onMessage((m) => { clearTimeout(timer); dc.close(); end(String(m) + " " + where); }));
		const dc = a.createDataChannel("ssh");
		dc.onOpen(() => dc.sendMessage("peered"));
	`], { encoding: "utf8", env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 30_000 }).trim();
	if (!peered.startsWith("peered ")) throw new Error(`node-datachannel in the app said: ${peered.slice(0, 400)}`);
	// One binary, the one for the app's system and processor (on a Mac, an app for the other kind is tried here under Rosetta).
	const bindings = path.join(resources, "app.asar.unpacked", "node_modules", "@node-datachannel");
	const kinds = fs.existsSync(bindings) ? fs.readdirSync(bindings) : [];
	if (kinds.length !== 1 || !fs.existsSync(path.join(bindings, kinds[0], "node_datachannel.node"))) throw new Error(`node-datachannel's binaries outside the archive: ${kinds.join(", ") || "none"}`);
	if (mac) execFileSync("/usr/bin/codesign", ["--verify", "--strict", path.join(bindings, kinds[0], "node_datachannel.node")]);
	if (!peered.includes("app.asar")) throw new Error(`node-datachannel was loaded from outside the app: ${peered}`);
	console.log(`ok: node-datachannel loads in the app, outside the archive${mac ? " and signed" : ""}, and two peers pass a message`);
	// PINE_SMOKE_HOLD=<seconds>: stays open that long, for somebody to look at the window.
	if (Number(process.env.PINE_SMOKE_HOLD) > 0) await new Promise((r) => setTimeout(r, Number(process.env.PINE_SMOKE_HOLD) * 1000));
	if (from !== "the app") throw new Error(`the app used the pine of "${from}", not the one it carries`);
	if (whole) {
		// The daemon runs on the app's Node, whatever Node this computer has.
		if (!running(ownNode, "pine.js", "service")) throw new Error("the daemon does not run on the Node the app carries");
		// `pine` in a terminal, with nothing of this computer's on the PATH: through a link, as the app sets it up; on
		// Windows the launcher in the folder the installer puts into the PATH, run as a terminal there runs it.
		let said;
		if (windows) {
			const system32 = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
			said = execFileSync(`"${path.join(resources, "bin", "pine.cmd")}" version`, { encoding: "utf8", shell: true, env: { PATH: system32, SystemRoot: process.env.SystemRoot ?? "C:\\Windows", USERPROFILE: home, HOME: home, PINE_HOME: home } }).trim();
		} else {
			const link = path.join(home, "bin-link");
			fs.symlinkSync(path.join(resources, "bin", "pine"), link);
			said = execFileSync(link, ["version"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: home, PINE_HOME: home } }).trim();
		}
		if (!/\d+\.\d+\.\d+/.test(said)) throw new Error(`"pine version" through the launcher said: ${said.slice(0, 200)}`);
		// The helpers, a Mac's only: pine's own build functions hand back the ones the app carries and compile nothing.
		const found = !mac ? [] : execFileSync(ownNode, ["--input-type=module", "-e", `
			const [root, dir] = process.argv.slice(1);
			const at = (f) => import(root + "/" + f);
			console.log(await (await at("src/tui/voice.js")).buildVoice(dir));
			console.log(await (await at("mcp/computer.js")).buildHelper(dir));
			console.log(await (await at("src/sources/system.js")).buildHelper(dir));
		`, path.join(resources, "pine"), path.join(home, "built-here")], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: home } }).trim().split("\n");
		const stray = found.filter((f) => !f.startsWith(path.join(resources, "pine") + path.sep));
		if ((mac && found.length !== 3) || stray.length) throw new Error(`pine did not find the helpers the app carries: ${found.join(", ")}`);
		if (mac) for (const f of found) execFileSync("/usr/bin/codesign", ["--verify", "--strict", f]);
		console.log(`ok: the daemon runs on the app's Node; ${said} through ${windows ? "pine.cmd" : "a link"}${mac ? "; the three helpers are the app's" : ""}`);
		// Settings > General says what `pine` in a terminal is. (Only looked at: nothing is set up from here.)
		await page.locator("[data-slot=sidebar-footer]").getByRole("button", { name: "Settings" }).click();
		await page.click("[role=navigation] [data-sidebar=menu-button] >> text=General");
		const row = (await page.textContent("[data-slot=field]:has-text('pine command in a terminal')", { timeout: 15_000 })) ?? "";
		if (!/pine command in a terminal/.test(row) || !/(Not set up|is the pine of this app|another pine|Move Pine|Start Pine from the AppImage)/.test(row)) throw new Error(`Settings > General says about the command: ${row.slice(0, 300)}`);
		console.log(`ok: Settings > General: ${row.replace(/\s+/g, " ").trim()}`);
		if (process.argv[3]) await page.screenshot({ path: process.argv[3].replace(/(\.\w+)?$/, "-app$1") });
	}
	await browser.close();
} catch (e) {
	failed = e;
} finally {
	child.kill("SIGTERM");
	await new Promise((r) => child.once("close", r));
	await mock.close?.();
	// (Windows keeps the files of a program that just ended locked for a moment: tried again, and a folder it still holds is left.)
	for (const dir of [home, away]) {
		try {
			fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
		} catch (e) {
			console.log(`left ${dir} (${e.code})`);
		}
	}
}
if (failed) {
	console.error(`failed: ${failed.message}`);
	process.exit(1);
}
