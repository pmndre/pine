// Starts a packed app on a pine home of its own and looks whether it comes up with the pine it
// carries inside, on the Node it carries, and whether `pine` for a terminal and the built helpers
// are what pine finds. For checking what `npm run pack` made.
//   node scripts/smoke.mjs [release/mac-arm64/Pine.app]
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { startMock } from "../../baseline/tests/mock.mjs";

const root = path.resolve(import.meta.dirname, "..");
const appDir = path.resolve(process.argv[2] ?? path.join(root, "release", process.arch === "arm64" ? "mac-arm64" : "mac", "Pine.app"));
// Tried from a folder of its own: inside the checkout, a pine that lacks what it depends on would
// find it in the checkout's own node_modules and seem whole.
const away = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-smoke-app-")));
fs.cpSync(appDir, path.join(away, "Pine.app"), { recursive: true, verbatimSymlinks: true });
const binary = path.join(away, "Pine.app", "Contents", "MacOS", "Pine");
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
write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, defaults: { model: "mock/m", mode: "safe" } }));
write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ description: "The main agent" }));
write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "You are the main agent.\n");

const port = await freePort();
// PINE_CLI and PINE_NODE are taken out: the app is to find the pine and the Node it carries.
// (A packed app asks GitHub for a newer one at its start. Not this one: with nothing named, nobody is asked.)
const env = { ...process.env, PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_DESKTOP_RELEASES: "" };
delete env.PINE_CLI;
delete env.PINE_NODE;
const resources = path.join(away, "Pine.app", "Contents", "Resources");
const ownNode = path.join(resources, "node", "bin", "node");
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
	// (The page is found by the names its parts carry, `data-slot`, as desktop/e2e/ finds it.)
	await page.waitForSelector("[data-slot=empty] h1", { timeout: 60_000 }).catch(async () => {
		throw new Error(`no conversation appeared. On screen: ${await page.evaluate(() => document.body.innerText.slice(0, 600))}`);
	});
	// On a Mac without the browser build this pine drives (a new one, a CI machine) the app asks at
	// its start whether to fetch it, and the question lies over the page. The daemon says whether
	// it will be asked: then it is waited for and answered with "Not now".
	const over = await page.evaluate(() => window.pine.call("GET", "/overview"));
	if (over?.data?.browser === false) {
		await page.waitForSelector("[data-slot=dialog-title] >> text=The browser for the web tools is not on this Mac", { timeout: 30_000 });
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
		() =>
			new Promise((resolve, reject) => {
				let out = "";
				const stop = window.pine.onTermData((id, data) => {
					if (id !== "smoke:term") return;
					out += data;
					if (/smoke-\d+/.test(out)) (stop(), void window.pine.termClose("smoke:term"), resolve(/smoke-\d+/.exec(out)[0]));
				});
				setTimeout(() => (stop(), reject(new Error(`the terminal printed: ${JSON.stringify(out.slice(-400))}`))), 15_000);
				window.pine.termOpen("smoke:term", undefined, 80, 24).then(() => window.pine.termWrite("smoke:term", "echo smoke-$((40+2))\r"), reject);
			}),
	);
	if (printed !== "smoke-42") throw new Error(`the terminal printed ${printed}`);
	// A block run as its Run button runs it, in the owner's own shell with their startup files and pine's hooks: it says how it went.
	const report = await page.evaluate(
		() =>
			new Promise((resolve, reject) => {
				const stop = window.pine.onTermRun((id, r) => id === "smoke:run" && r.state === "ended" && (stop(), void window.pine.termClose("smoke:run"), resolve(r)));
				setTimeout(() => (stop(), reject(new Error("the run never said that it had ended"))), 20_000);
				window.pine.termOpen("smoke:run", undefined, 80, 24).then(() => window.pine.termRun("smoke:run", "echo ran-$((6*7)); false")).then((r) => r.reports || reject(new Error("this shell does not report")), reject);
			}),
	);
	if (report.code !== 1 || !/ran-42/.test(report.output)) throw new Error(`the run reported ${JSON.stringify(report)}`);
	console.log("ok: a terminal runs in the app's own node-pty, and a block run in the owner's shell says how it ended");
	// PINE_SMOKE_HOLD=<seconds>: stays open that long, for somebody to look at the window.
	if (Number(process.env.PINE_SMOKE_HOLD) > 0) await new Promise((r) => setTimeout(r, Number(process.env.PINE_SMOKE_HOLD) * 1000));
	if (from !== "the app") throw new Error(`the app used the pine of "${from}", not the one it carries`);
	if (whole) {
		// The daemon runs on the app's Node, whatever Node this Mac has.
		let daemon = "";
		try {
			daemon = execFileSync("/usr/bin/pgrep", ["-f", `${ownNode} .*pine.js service`], { encoding: "utf8" }).trim();
		} catch {
			// pgrep ends with 1 when nothing matches
		}
		if (!daemon) throw new Error("the daemon does not run on the Node the app carries");
		// `pine` in a terminal: through a link, as the app sets it up, with nothing of this Mac's on the PATH.
		const link = path.join(home, "bin-link");
		fs.symlinkSync(path.join(resources, "bin", "pine"), link);
		const said = execFileSync(link, ["version"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: home, PINE_HOME: home } }).trim();
		if (!/\d+\.\d+\.\d+/.test(said)) throw new Error(`"pine version" through a link said: ${said.slice(0, 200)}`);
		// The helpers: pine's own build functions hand back the ones the app carries and compile nothing.
		const found = execFileSync(ownNode, ["--input-type=module", "-e", `
			const [root, dir] = process.argv.slice(1);
			const at = (f) => import(root + "/" + f);
			console.log(await (await at("src/tui/voice.js")).buildVoice(dir));
			console.log(await (await at("mcp/computer.js")).buildHelper(dir));
			console.log(await (await at("src/sources/system.js")).buildHelper(dir));
		`, path.join(resources, "pine"), path.join(home, "built-here")], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: home } }).trim().split("\n");
		const stray = found.filter((f) => !f.startsWith(path.join(resources, "pine") + path.sep));
		if (found.length !== 3 || stray.length) throw new Error(`pine did not find the helpers the app carries: ${found.join(", ")}`);
		for (const f of found) execFileSync("/usr/bin/codesign", ["--verify", "--strict", f]);
		console.log(`ok: the daemon runs on the app's Node; ${said} through a link; the three helpers are the app's`);
		// Settings > App says what `pine` in a terminal is. (Only looked at: nothing is set up from here.)
		await page.locator("[data-slot=sidebar-footer]").getByRole("button", { name: "Settings" }).click();
		await page.click("[role=navigation] [data-sidebar=menu-button] >> text=App");
		const row = (await page.textContent("[data-slot=field]:has-text('pine in a terminal')", { timeout: 15_000 })) ?? "";
		if (!/pine in a terminal/.test(row) || !/(Not set up|is the pine of this app|another pine|Move Pine)/.test(row)) throw new Error(`Settings > App says about the command: ${row.slice(0, 300)}`);
		console.log(`ok: Settings > App: ${row.replace(/\s+/g, " ").trim()}`);
		if (process.argv[3]) await page.screenshot({ path: process.argv[3].replace(/(\.\w+)?$/, "-app$1") });
	}
	await browser.close();
} catch (e) {
	failed = e;
} finally {
	child.kill("SIGTERM");
	await new Promise((r) => child.once("close", r));
	await mock.close?.();
	fs.rmSync(home, { recursive: true, force: true });
	fs.rmSync(away, { recursive: true, force: true });
}
if (failed) {
	console.error(`failed: ${failed.message}`);
	process.exit(1);
}
