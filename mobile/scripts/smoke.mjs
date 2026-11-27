// The Android app from end to end, by hand (not in CI, not in npm test): builds a debug APK, starts
// an emulator without a window, installs and opens the app, and points it at a machine: an SSH
// server of this run's own on this computer's loopback (MINA sshd, mobile/core's
// SmokeMachine.kt), which the emulator reaches at 10.0.2.2, running the real `pine service` on a
// pine home of its own whose model is the scripted mock server. Nothing of this computer's own
// sshd or settings is touched. Run it before a release that changes the mobile app.
//
//   npm run smoke [-- --shot <file.png>] [-- --avd <name>] [-- --keep] [-- --transport-only] [-- --pairing-only]
// (--pairing-only, while working on pairing: the transport check and the pairing run alone, which is not the smoke run)
//
// First, the app's WebRTC library under the core (LibWebRtc.kt), which no suite on the JVM reaches:
// an instrumented test (androidTest/.../LibWebRtcTest.kt) pairs with the Pine app's real access host
// (mobile/test/support/access-host.ts) on this computer and moves several megabytes each way through
// the data channel, bursts of more than 1 MiB from the computer included. The emulator reaches it at
// 10.0.2.2, through a TLS front of the run's own (a pairing link names https only) whose authority
// the debug build trusts, as the app does (debug-overrides). `--transport-only` runs that alone.
// Before it, a named check reads the built APK's permissions (aapt2): INTERNET and
// ACCESS_NETWORK_STATE, and nothing else an owner grants.
//
// The app is driven as a person would, through adb (uiautomator for what is on screen, input for
// taps and keys): it reads the phone's key from the page and shares it (the system's chooser comes
// up), adds the machine, trusts its host key and shows the agents.
//
// It is the test of the WebView's hardening in PinePlugin.kt, which no other suite reaches: through
// the debug build's WebView inspector, each of these is a named check that fails the run.
//   - the policy: Capacitor's bridge runs under the page's policy, an inline script does not;
//   - permission denial (onPermissionRequest, onGeolocationPermissionsShowPrompt): no camera,
//     microphone or location;
//   - no window (onCreateWindow, setSupportMultipleWindows(false)): window.open, with and without
//     a user's gesture, makes no new page and leaves the page where it is;
//   - no file access (allowFileAccess): a file: address cannot be fetched or navigated to;
//   - the navigation rules (shouldOverrideUrlLoading): file: and intent: lead nowhere, an address of
//     the web opens outside the app;
//   - media are answered by the plugin.
// Then the app's life: the back button closes the open sheet, then leaves the app; the app comes back
// from the background (after back, and after HOME) still connected to the machine. Last, the system
// bars: the theme's color under them, in pine's dark theme and in a light one (bars-dark.png and
// bars-light.png beside the screenshot).
// Then pairing, on fresh data: the Pine app's real access host again, whose daemon is now the run's
// pine (`pine service` on its home), behind the TLS front. The debug build trusts the run's authority
// (app/build.gradle's smokeAuthority, under debug-overrides: a release build has none of it). A
// pasted link pairs (asked first, the computer's four digits, Allow, the agents), is reached again
// after the background with its connection cut; the manifest's App Link opens the app for Pine's own
// service and not for another host; a link the app is opened with, while it runs and at its start, is
// asked about first and pairs; one that is not a pairing link, or names a service on http, is said
// so and starts nothing. Each is a named check that fails the run.
// An emulator it started is stopped at the end, and so are its servers.
//
// Needs ANDROID_HOME (default ~/Library/Android/sdk) with an emulator and a system image, and a
// JDK (JAVA_HOME, default Android Studio's).
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import tls from "node:tls";
import { parseArgs } from "node:util";
import { startMock } from "../../baseline/tests/mock.mjs";

const { values: opts } = parseArgs({ options: { shot: { type: "string" }, avd: { type: "string" }, keep: { type: "boolean" }, "transport-only": { type: "boolean" }, "pairing-only": { type: "boolean" } } });
const mobile = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(mobile, "..");
const sdk = process.env.ANDROID_HOME ?? path.join(os.homedir(), "Library/Android/sdk");
const javaHome = process.env.JAVA_HOME ?? "/Applications/Android Studio.app/Contents/jbr/Contents/Home";
const env = { ...process.env, ANDROID_HOME: sdk, JAVA_HOME: javaHome };
const ADB = path.join(sdk, "platform-tools", "adb");
const APP = "dev.pmndre.pine";
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-mobile-smoke-")));
const shot = path.resolve(opts.shot ?? path.join(work, "agents.png"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`- ${text}`);
const write = (file, content) => (fs.mkdirSync(path.dirname(file), { recursive: true }), fs.writeFileSync(file, content));

/** Thrown to end a run of the transport check alone, with its cleanup. */
class TransportOnly extends Error {}

const cleanups = [];
async function cleanup() {
	for (const fn of cleanups.reverse()) await Promise.resolve().then(fn).catch(() => {});
	if (!opts.keep) fs.rmSync(work, { recursive: true, force: true });
}
process.on("SIGINT", () => void cleanup().then(() => process.exit(130)));

const run = (cmd, args, cwd = mobile) => execFileSync(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 }).toString();
const adb = (...args) => execFileSync(ADB, args, { env, maxBuffer: 64 * 1024 * 1024 }).toString();

/**
 * A certificate authority of the run's own and a certificate it signed for 10.0.2.2, the address the
 * emulator reaches this computer's loopback at, in `dir`. Only the debug build is made to trust that
 * authority (app/build.gradle's smokeAuthority, under debug-overrides), the instrumented test with it:
 * nothing of this computer's or the emulator's own trust changes.
 */
function certificates(dir) {
	const at = (name) => path.join(dir, name);
	fs.mkdirSync(dir, { recursive: true });
	const openssl = (...args) => execFileSync("openssl", args, { cwd: dir, stdio: ["ignore", "ignore", "pipe"] });
	// Valid from a day ago: a fresh emulator's clock may run behind this computer's (OpenSSL 3.4 or later).
	const since = `${new Date(Date.now() - 86_400_000).toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z`;
	openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", at("ca.key"), "-out", at("ca.pem"), "-not_before", since, "-days", "30", "-sha256", "-subj", "/CN=Pine smoke run", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign");
	openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", at("leaf.key"), "-out", at("leaf.csr"), "-subj", "/CN=10.0.2.2");
	write(at("leaf.ext"), "subjectAltName=IP:10.0.2.2\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n");
	openssl("x509", "-req", "-in", at("leaf.csr"), "-CA", at("ca.pem"), "-CAkey", at("ca.key"), "-CAcreateserial", "-out", at("leaf.pem"), "-not_before", since, "-days", "30", "-sha256", "-extfile", at("leaf.ext"));
	return { ca: fs.readFileSync(at("ca.pem")), key: fs.readFileSync(at("leaf.key")), cert: fs.readFileSync(at("leaf.pem")) };
}

/**
 * A computer: the Pine app's real access host (its top comment is its protocol), and a TLS front
 * before its meeting service on this computer's loopback. For the transport check its daemon is its
 * own stand-in, which echoes every call; for pairing it is the run's pine (`serviceLine`, what
 * `pine service` said). `ask` sends one command and gives its answer; `asked` gives the next pairing
 * request the owner is asked about.
 */
async function accessHost(keys, serviceLine) {
	const args = [path.join(mobile, "test", "support", "access-host.ts"), "--computer-name", "Smoke Mac", ...(serviceLine ? ["--service-line", serviceLine] : [])];
	const child = spawn(process.execPath, args, { env, stdio: ["pipe", "pipe", "inherit"] });
	const answers = [];
	const requests = [];
	const waitingFor = [];
	let ready;
	const first = new Promise((resolve, reject) => {
		ready = resolve;
		child.on("exit", (code) => reject(new Error(`the access host ended (${code})`)));
	});
	readline.createInterface({ input: child.stdout }).on("line", (line) => {
		const said = JSON.parse(line);
		if (said.t === "ready" || said.t === "missing") return ready(said);
		if (said.t === "asked") return waitingFor.length ? waitingFor.shift()(said) : requests.push(said);
		if (["paired", "connected", "left"].includes(said.t)) return;
		answers.shift()?.(said);
	});
	const up = await first;
	if (up.t !== "ready") throw new Error(up.message);
	const port = Number(new URL(up.service).port);
	let stopping;
	// The front: TLS, then the bytes as they are, both ways (HTTP and the meeting's WebSocket alike).
	const front = await new Promise((resolve, reject) => {
		const server = tls.createServer({ key: keys.key, cert: keys.cert }, (socket) => {
			const back = net.connect(port, "127.0.0.1");
			socket.pipe(back).pipe(socket);
			socket.on("error", () => back.destroy());
			back.on("error", () => socket.destroy());
		});
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve(server));
	});
	return {
		service: up.service,
		https: `https://10.0.2.2:${front.address().port}`,
		machineId: up.machineId,
		ask: (command) =>
			new Promise((resolve) => {
				answers.push(resolve);
				child.stdin.write(`${command}\n`);
			}),
		asked: () => (requests.length ? Promise.resolve(requests.shift()) : new Promise((resolve) => waitingFor.push(resolve))),
		// Once: the run stops it when its check is done, and the cleanup again.
		stop: () =>
			(stopping ??= new Promise((resolve) => {
				front.close();
				if (child.exitCode !== null) return resolve();
				child.once("exit", resolve);
				child.stdin.end();
			})),
	};
}

try {
	// ---- the app ----------------------------------------------------------------------------------
	// The run's authority, which the debug build is made to trust (and the transport check is handed).
	const tlsKeys = certificates(path.join(work, "tls"));
	step("building the page and the debug APK, which trusts this run's authority");
	run("npm", ["run", "sync"]);
	run(path.join(mobile, "android", "gradlew"), ["assembleDebug", ":app:assembleDebugAndroidTest", `-PpineSmokeAuthority=${path.join(work, "tls", "ca.pem")}`, "--console=plain", "-q"], path.join(mobile, "android"));
	const apk = path.join(mobile, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
	const testApk = path.join(mobile, "android", "app", "build", "outputs", "apk", "androidTest", "debug", "app-debug-androidTest.apk");

	// ---- what the APK asks of a phone ----------------------------------------------------------
	// The permissions of what was built, after the manifests were merged (a library can bring one in):
	// the network and its state, and nothing else an owner grants. androidx.core declares a signature
	// permission of its own under the package's name for its receivers, which only this app holds:
	// that one exactly is allowed. The Release workflow's android job checks the release APK the same way.
	{
		const buildTools = fs.readdirSync(path.join(sdk, "build-tools")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
		const dump = execFileSync(path.join(sdk, "build-tools", buildTools, "aapt2"), ["dump", "permissions", apk], { env }).toString();
		const asked = dump.split("\n").filter((l) => l && !l.startsWith("package: ")).sort();
		const own = `${APP}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`;
		const wanted = [`permission: ${own}`, `uses-permission: name='${own}'`, "uses-permission: name='android.permission.ACCESS_NETWORK_STATE'", "uses-permission: name='android.permission.INTERNET'"].sort();
		const ok = JSON.stringify(asked) === JSON.stringify(wanted);
		console.log(`  ${ok ? "ok" : "NOT OK"}  permissions: the APK asks for INTERNET and ACCESS_NETWORK_STATE and nothing else${ok ? "" : ` (asked: ${asked.join(" | ")})`}`);
		if (!ok) throw new Error("the APK asks for other permissions than INTERNET and ACCESS_NETWORK_STATE: find what brought them in (app/build/intermediates/merged_manifests)");
	}

	// ---- the emulator -----------------------------------------------------------------------------
	const running = () => adb("devices").split("\n").some((l) => /^emulator-\d+\s+device/.test(l));
	if (!running()) {
		const avd = opts.avd ?? execFileSync(path.join(sdk, "emulator", "emulator"), ["-list-avds"], { env }).toString().trim().split("\n")[0];
		if (!avd) throw new Error("No emulator to start: make one in Android Studio's Device Manager (an image with Google APIs).");
		step(`starting the emulator ${avd}, without a window`);
		const emu = spawn(path.join(sdk, "emulator", "emulator"), ["-avd", avd, "-no-window", "-no-audio", "-no-boot-anim", "-no-snapshot-save"], { env, stdio: "ignore", detached: true });
		emu.unref();
		cleanups.push(() => adb("emu", "kill"));
	} else step("using the emulator that runs");
	// (The device comes and goes while it boots: a question it cannot answer yet is asked again.)
	const booted = () => {
		try {
			return execFileSync(ADB, ["shell", "getprop", "sys.boot_completed"], { env, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() === "1";
		} catch {
			return false;
		}
	};
	for (let i = 0; !booted(); i++) {
		if (i > 180) throw new Error("the emulator did not finish starting in three minutes");
		await sleep(1000);
	}

	// ---- what is on screen ------------------------------------------------------------------------
	/** The nodes on screen: text, description, class and the middle of their bounds. */
	// (A system starved of time answers no dump now and then: that is an empty screen, asked again.)
	const screen = () => {
		let xml;
		try {
			execFileSync(ADB, ["shell", "uiautomator", "dump", "/sdcard/pine-ui.xml"], { env, stdio: ["ignore", "pipe", "ignore"] });
			xml = adb("exec-out", "cat", "/sdcard/pine-ui.xml");
		} catch {
			return [];
		}
		const decode = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#10;/g, "\n").replace(/&amp;/g, "&");
		return [...xml.matchAll(/<node ([^>]*?)\/?>/g)].map(([, attrs]) => {
			const a = Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)]));
			const [x1, y1, x2, y2] = (a.bounds.match(/\d+/g) ?? []).map(Number);
			return { text: a.text ?? "", desc: a["content-desc"] ?? "", cls: a.class ?? "", x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2), visible: y2 > y1 && x2 > x1 };
		});
	};
	const label = (n) => `${n.text} ${n.desc}`.trim();
	/**
	 * An emulator that starts cold on a busy computer puts up "<app> isn't responding" for its own
	 * apps (System UI, the keyboard, Play services). Such a dialog of another app is answered with
	 * Wait and the run goes on; one of this app's fails the run.
	 */
	const dismissed = new Set();
	const answerAnr = (nodes) => {
		const dialog = nodes.find((n) => / isn't responding$/.test(n.text));
		if (!dialog) return false;
		const who = dialog.text.replace(/ isn't responding$/, "");
		if (who === "Pine") throw new Error(`the app is not responding (ANR): ${nodes.map(label).filter(Boolean).join(" | ")}`);
		const wait = nodes.find((n) => n.visible && n.text === "Wait");
		if (!wait) return false;
		if (!dismissed.has(who)) console.log(`  (the system says "${dialog.text}": Wait)`);
		dismissed.add(who);
		tap(wait);
		return true;
	};
	const waitFor = async (what, pick, seconds = 90) => {
		let last = [];
		for (const until = Date.now() + seconds * 1000; Date.now() < until; await sleep(1000)) {
			last = screen();
			if (answerAnr(last)) continue;
			const found = pick(last);
			if (found) return found;
		}
		throw new Error(`not seen: ${what}. On screen: ${last.map(label).filter(Boolean).join(" | ").slice(0, 2000)}`);
	};
	const node = (re) => (nodes) => nodes.find((n) => n.visible && re.test(label(n)));
	const tap = (n) => adb("shell", "input", "tap", String(n.x), String(n.y));
	/** The activity in front ("package/class"), and its package. */
	const frontActivity = () => adb("shell", "dumpsys", "activity", "activities").match(/topResumedActivity=\S+ \S+ (\S+)/)?.[1];
	const front = () => frontActivity()?.split("/")[0];
	/** The page past the Gate, on the machine's pine. */
	const connected = (ns) => !ns.some((n) => /Choose a machine|Could not reach|Connecting to/.test(label(n))) && ns.some((n) => /main/.test(label(n))) && ns;
	const sidebarButton = node(/^(Show the sidebar|Toggle Sidebar)$/);
	const agentsShown = (ns) => ns.some((n) => n.visible && /^main: /.test(label(n))) && ns.some((n) => n.visible && /^scout: /.test(label(n))) && ns;

	// sys.boot_completed comes well before a cold system is done starting its own apps: the launcher
	// in front and three answered dumps in a row without a dialog say it is.
	step("waiting for the system to settle");
	adb("shell", "input", "keyevent", "KEYCODE_HOME");
	for (let calm = 0, until = Date.now() + 240_000; calm < 3; await sleep(2000)) {
		if (Date.now() > until) throw new Error(`the emulator did not settle in four minutes. On screen: ${screen().map(label).filter(Boolean).join(" | ")}`);
		const ns = screen();
		calm = ns.length && !answerAnr(ns) && /launcher/i.test(frontActivity() ?? "") ? calm + 1 : 0;
	}

	// ---- the transport: libwebrtc under the core, against the real access host ---------------------
	step("the transport: libwebrtc on the emulator pairs with the real access host and moves megabytes both ways");
	adb("install", "-r", apk);
	adb("install", "-r", testApk);
	const computer = await accessHost(tlsKeys);
	cleanups.push(() => computer.stop());
	const opened = await computer.ask("open");
	await computer.ask("allow");
	const link = opened.link.replace(computer.service, computer.https);
	step(`computer at ${computer.https} (in front of ${computer.service})`);
	// am's arguments go through the emulator's shell: each is quoted there.
	const quoted = (text) => `'${text.replace(/'/g, "'\\''")}'`;
	// Not with execFileSync: the TLS front lives in this process, and has to answer while the test runs.
	// No authority is handed to the test: the debug build trusts the run's (debug-overrides), as the app does.
	const instrument = spawn(ADB, ["shell", `am instrument -w -r -e class dev.pmndre.pine.LibWebRtcTest -e link ${quoted(link)} ${APP}.test/androidx.test.runner.AndroidJUnitRunner`], { env, stdio: ["ignore", "pipe", "inherit"] });
	let report = "";
	instrument.stdout.on("data", (d) => (report += d));
	await new Promise((resolve) => instrument.on("close", resolve));
	const passed = /^OK \(1 test\)/m.test(report);
	console.log(`  ${passed ? "ok" : "NOT OK"}  libwebrtc: paired, then 2, 4 and 6 MiB up and echoed back in one burst each, whole and in order`);
	if (!passed) throw new Error(`the transport check failed:\n${report.split("\n").filter((l) => !/^INSTRUMENTATION_STATUS: (stream|id|class|current|numtests|test)=/.test(l)).join("\n").slice(0, 4000)}`);
	await computer.stop();
	if (opts["transport-only"]) throw new TransportOnly();

	// ---- the machine ------------------------------------------------------------------------------
	step("starting the machine: the mock model, a pine home, and an SSH server on this computer's loopback");
	const mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	cleanups.push(() => mock.close());
	const home = path.join(work, "far");
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe", introduce: false }, security: { askAccess: false } }, null, 2));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ description: "The main agent: it administers pine" }));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "You are the main agent.\n");
	write(path.join(home, "agents", "scout", "agent.json"), JSON.stringify({ description: "Looks things up on the web" }));
	write(path.join(home, "agents", "scout", "workspace", "AGENTS.md"), "You are scout.\n");
	const keys = path.join(work, "authorized_keys");
	const classpath = run(path.join(mobile, "core", "gradlew"), ["-q", "smokeClasspath", "--console=plain"], path.join(mobile, "core")).trim().split("\n").at(-1);
	const machine = spawn(path.join(javaHome, "bin", "java"), ["-cp", classpath, "pine.mobile.core.SmokeMachineKt", keys, home, process.execPath, path.join(repo, "bin", "pine.js")], { env, stdio: ["pipe", "pipe", "inherit"] });
	cleanups.push(() => machine.stdin.end());
	const said = {};
	const lines = readline.createInterface({ input: machine.stdout });
	await new Promise((resolve, reject) => {
		lines.on("line", (line) => {
			const [k, v] = line.split(" ");
			said[k] = v;
			if (said.port && said.fingerprint) resolve();
		});
		machine.on("exit", (code) => reject(new Error(`the SSH server ended (${code})`)));
	});
	const host = `me@10.0.2.2:${said.port}`;
	step(`machine ${host}, host key ${said.fingerprint}`);

	/**
	 * The app's page, through the debug build's WebView inspector, in the app's process as it runs now
	 * (a new one after `pm clear` or a stop): `evaluate` runs an expression there and gives its value.
	 */
	const inspector = async () => {
		const pidOf = () => {
			try {
				return execFileSync(ADB, ["shell", "pidof", APP], { env, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
			} catch {
				return "";
			}
		};
		const pid = await waitFor("the app's process", () => pidOf() || undefined, 30);
		const port = 9300 + Math.floor(Math.random() * 500);
		adb("forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
		cleanups.push(() => adb("forward", "--remove", `tcp:${port}`));
		let target;
		for (const until = Date.now() + 60_000; !target; await sleep(500)) {
			const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json(), () => []);
			target = targets.find((t) => t.type === "page" && t.url.startsWith("https://localhost/"));
			if (!target && Date.now() > until) throw new Error(`no page of the app to inspect: ${JSON.stringify(targets)}`);
		}
		const ws = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)));
		cleanups.push(() => ws.close());
		let id = 0;
		const evaluate = (expression, { gesture = false } = {}) =>
			new Promise((resolve, reject) => {
				const mine = ++id;
				const on = (e) => {
					const m = JSON.parse(e.data);
					if (m.id !== mine) return;
					ws.removeEventListener("message", on);
					if (m.result?.exceptionDetails) reject(new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text));
					else resolve(m.result?.result?.value);
				};
				ws.addEventListener("message", on);
				ws.send(JSON.stringify({ id: mine, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true, userGesture: gesture } }));
			});
		return { evaluate, port, close: () => ws.close() };
	};

	step("installing the app");
	adb("install", "-r", apk);
	if (!opts["pairing-only"]) {
		step("opening the app, on fresh data");
		adb("shell", "pm", "clear", APP);
		adb("logcat", "-c");
		adb("shell", "am", "start", "-W", "-n", `${APP}/.MainActivity`);

		step("the first start: pairing first, and SSH behind a link, which shows the phone's key");
		await waitFor("the pairing view", node(/^Pair this phone with your computer/));
		tap(await waitFor("the link to SSH", node(/^Or connect to a server over SSH$/)));
		await waitFor("the Gate's Choose a machine", node(/^Choose a machine$/));
		const key = await waitFor("the phone's key", node(/^ssh-ed25519 \S+ pine-android$/));
		write(keys, `${label(key)}\n`);

		step("Share hands the key to the system's chooser, and back returns to the app");
		tap(await waitFor("Share", node(/^Share$/)));
		await waitFor("the system's chooser in front", () => /chooser|resolver/i.test(frontActivity() ?? "") || undefined, 15);
		adb("shell", "input", "keyevent", "KEYCODE_BACK");
		await waitFor("the app in front again", () => front() === APP || undefined, 15);

		step(`adding ${host}`);
		const field = (ns) => ns.find((n) => n.visible && n.cls === "android.widget.EditText");
		tap(await waitFor("the Host field", field));
		// The keyboard takes a moment to come up: what is typed before it is lost. Typed again until the field holds it.
		for (let i = 0; ; i++) {
			await sleep(1000);
			adb("shell", "input", "keyevent", "KEYCODE_MOVE_END", ...Array(40).fill("KEYCODE_DEL"));
			adb("shell", "input", "text", host);
			await sleep(500);
			if (field(screen())?.text === host) break;
			if (i === 4) throw new Error(`the Host field does not take ${host}`);
		}
		tap(await waitFor("Add", node(/^Add$/)));
		tap(await waitFor("Use", node(/^Use$/)));

		step("the host key is put to the owner, with the machine's fingerprint");
		const asked = await waitFor("the host key's fingerprint", node(/does not know .* fingerprint is SHA256:/));
		if (!label(asked).includes(said.fingerprint)) throw new Error(`the page shows another fingerprint than the machine's: ${label(asked)}`);
		tap(await waitFor("Trust this key", node(/^Trust this key$/)));

		step("connected: the agents of that pine");
		await waitFor("the page past the Gate", connected, 120);
		const open = sidebarButton(screen());
		if (open) tap(open);
		await waitFor("the agents in the side bar", agentsShown);
		await sleep(500);
		fs.mkdirSync(path.dirname(shot), { recursive: true });
		fs.writeFileSync(shot, execFileSync(ADB, ["exec-out", "screencap", "-p"], { env, maxBuffer: 64 * 1024 * 1024 }));
		step(`screenshot: ${shot}`);
		if (open) {
			adb("shell", "input", "keyevent", "KEYCODE_BACK");
			await waitFor("the side bar closed", (ns) => !agentsShown(ns) && ns, 15);
		}

		// ---- the page's hardening, through the debug build's WebView inspector ------------------------
		step("checking the page's hardening through the WebView inspector");
		const { evaluate, port } = await inspector();
		const here = "location.origin + location.pathname";
		const pages = async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === "page").length;
		const pagesBefore = await pages();
		const checks = {
			// The policy.
			"Capacitor's bridge runs under the page's policy": [await evaluate("typeof window.Capacitor === 'object' && window.Capacitor.isNativePlatform()"), true],
			"the policy is the page's own (script-src 'self')": [await evaluate("/script-src 'self'(;|$)/.test(document.querySelector('meta[http-equiv=Content-Security-Policy]')?.content ?? '')"), true],
			"an inline script added to the page does not run": [await evaluate("new Promise((r) => { const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.head.append(s); setTimeout(() => r(window.__inline === 1), 300); })"), false],
			// Permission denial.
			"permission denial: the camera is not given": [await evaluate("navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'given', (e) => e.name)"), "NotAllowedError"],
			"permission denial: the microphone is not given": [await evaluate("navigator.mediaDevices.getUserMedia({ audio: true }).then(() => 'given', (e) => e.name)"), "NotAllowedError"],
			"permission denial: the location is not given": [await evaluate("new Promise((r) => navigator.geolocation.getCurrentPosition(() => r('given'), (e) => r('refused ' + e.code)))"), "refused 1"],
			// No file access.
			"no file access: a file: address cannot be fetched": [await evaluate("fetch('file:///system/etc/hosts').then(() => 'read', () => 'refused')"), "refused"],
			// Media.
			"media are answered by the plugin under the daemon's rules": [await evaluate("fetch('/_pine_media/not/a/media/path').then((r) => r.status)"), 404],
		};
		// No window: onCreateWindow and setSupportMultipleWindows(false), with and without a user's gesture.
		checks["no window: window.open without a gesture gives nothing"] = [await evaluate("[window.open('https://example.com/'), window.open('file:///sdcard/')].every((w) => w === null)"), true];
		await evaluate("window.open('file:///sdcard/'); 1", { gesture: true });
		await sleep(1500);
		checks["no window: window.open with a gesture makes no new page"] = [await pages(), pagesBefore];
		checks["no window: window.open with a gesture leaves the page where it is"] = [await evaluate(here), "https://localhost/"];
		// The navigation rules.
		await evaluate("location.href = 'intent://x#Intent;scheme=market;end'; 1");
		await sleep(1500);
		await evaluate("location.href = 'file:///sdcard/'; 1");
		await sleep(1500);
		checks["navigation: the page goes nowhere (file:, intent:)"] = [await evaluate(here), "https://localhost/"];
		checks["navigation: the app stays in front"] = [front(), APP];
		await evaluate("location.href = 'https://example.com/'; 1");
		await sleep(3000);
		checks["navigation: an address of the web opens outside the app, not in it"] = [front() !== APP && (await evaluate("location.origin")) === "https://localhost", true];
		adb("shell", "am", "start", "-n", `${APP}/.MainActivity`);
		let failed = 0;
		for (const [what, [got, want]] of Object.entries(checks)) {
			const ok = JSON.stringify(got) === JSON.stringify(want);
			if (!ok) failed++;
			console.log(`  ${ok ? "ok" : "NOT OK"}  ${what}${ok ? "" : ` (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`);
		}
		if (failed) throw new Error(`${failed} hardening check(s) failed`);

		// ---- the app's life: the back button, the background ------------------------------------------
		step("the back button closes the open sheet, then leaves the app");
		await waitFor("the app in front again", (ns) => front() === APP && connected(ns), 30);
		const sidebar = sidebarButton(screen());
		if (!sidebar) throw new Error("no side bar button to open a sheet with: run the smoke test on a phone's screen, not a tablet's");
		tap(sidebar);
		await waitFor("the side bar open", agentsShown);
		adb("shell", "input", "keyevent", "KEYCODE_BACK");
		await waitFor("the side bar closed by back", (ns) => !agentsShown(ns) && ns, 15);
		if (front() !== APP) throw new Error(`back with a sheet open left the app (in front: ${frontActivity()})`);
		adb("shell", "input", "keyevent", "KEYCODE_BACK");
		await waitFor("the app gone to the background by back", () => (front() !== APP && front() !== undefined) || undefined, 15);

		step("back from the background, still on the machine");
		adb("shell", "am", "start", "-n", `${APP}/.MainActivity`);
		await waitFor("the app in front and connected after back", (ns) => front() === APP && connected(ns), 60);
		adb("shell", "input", "keyevent", "KEYCODE_HOME");
		await waitFor("the app paused by HOME", () => front() !== APP || undefined, 15);
		await sleep(5000);
		adb("shell", "am", "start", "-n", `${APP}/.MainActivity`);
		await waitFor("the app in front and connected after HOME", (ns) => front() === APP && connected(ns), 60);
		tap(await waitFor("the side bar button", sidebarButton));
		await waitFor("the agents after resume", agentsShown);
		// ---- the system bars: the theme's color, light icons on a dark theme -----------------------------
		step("the status and navigation bars take the theme's color, in a dark theme and in a light one");
		/** The color at a point of the screen, as #rrggbb: screencap's raw RGBA follows a header of its own. */
		const screenColors = () => {
			const raw = execFileSync(ADB, ["exec-out", "screencap"], { env, maxBuffer: 64 * 1024 * 1024 });
			const w = raw.readUInt32LE(0);
			const h = raw.readUInt32LE(4);
			const head = raw.length - w * h * 4;
			const at = (x, y) => `#${[0, 1, 2].map((i) => raw[head + (y * w + x) * 4 + i].toString(16).padStart(2, "0")).join("")}`;
			// Near the left edge, clear of the clock and the icons: the bar's own color.
			return { status: at(4, 4), navigation: at(4, h - 4) };
		};
		const themeBg = async (id) => {
			const r = await evaluate("window.pine.call('GET', '/themes')");
			const bg = r?.data?.themes?.find((t) => t.id === id)?.colors?.bg;
			if (!bg) throw new Error(`the machine's pine has no theme ${id}: ${JSON.stringify(r?.data?.themes?.map((t) => t.id))}`);
			return bg.slice(0, 7).toLowerCase();
		};
		const barsIn = async (id, file) => {
			const want = await themeBg(id);
			let got;
			await waitFor(`the bars in ${want} (${id})`, () => ((got = screenColors()), got.status === want && got.navigation === want) || undefined, 30);
			await sleep(500);
			fs.writeFileSync(path.join(path.dirname(shot), file), execFileSync(ADB, ["exec-out", "screencap", "-p"], { env, maxBuffer: 64 * 1024 * 1024 }));
			step(`screenshot: ${path.join(path.dirname(shot), file)}`);
		};
		await barsIn((await evaluate("window.pine.call('GET', '/themes')")).data.theme, "bars-dark.png");
		const light = "github-light";
		const set = await evaluate(`window.pine.call('POST', '/settings', { key: 'ui.theme', value: '${light}' })`);
		if (!set?.ok) throw new Error(`the theme could not be set: ${JSON.stringify(set)}`);
		// The page draws a theme it is told at its start: started again, it asks pine.
		await evaluate("location.reload(); 1");
		await waitFor("the page connected again", (ns) => front() === APP && connected(ns), 60);
		await barsIn(light, "bars-light.png");
	}

	// ---- pairing with a computer, by a pasted link and by a link the app is opened with -------------
	step("pairing: the same pine as a computer that runs the Pine app (its real access host), behind the TLS front");
	// `pine service` on that home says where its daemon answers (and starts it): the access host hands that line to a paired phone.
	const service = spawn(process.execPath, [path.join(repo, "bin", "pine.js"), "service", "--home", home], { env: { ...env, PINE_SKIP_DOWNLOADS: "1" }, stdio: ["pipe", "pipe", "inherit"] });
	cleanups.push(() => service.stdin.end());
	const serviceLine = await new Promise((resolve, reject) => {
		readline.createInterface({ input: service.stdout }).once("line", resolve);
		service.on("exit", (code) => reject(new Error(`pine service ended (${code})`)));
	});
	const pairing = await accessHost(tlsKeys, serviceLine);
	cleanups.push(() => pairing.stop());
	const serviceHost = new URL(pairing.https).host;
	step(`computer ${pairing.machineId}, its meeting service at ${pairing.https} (in front of ${pairing.service})`);
	const model = adb("shell", "getprop", "ro.product.model").trim();
	let pairFailed = 0;
	const check = (what, got, want) => {
		const ok = JSON.stringify(got) === JSON.stringify(want);
		if (!ok) pairFailed++;
		console.log(`  ${ok ? "ok" : "NOT OK"}  ${what}${ok ? "" : ` (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`);
	};
	/** A new pairing link from the computer, as its QR code carries it, on the run's https service. */
	const pairLink = async () => (await pairing.ask("open")).link.replace(pairing.service, pairing.https);
	/** The app opened with an address, by name (as Android hands it an App Link it verified, or another app sends it one). */
	const openWith = (url) => adb("shell", `am start -W -a android.intent.action.VIEW -d ${quoted(url)} -n ${APP}/.MainActivity`);
	const SHAPED = `#pair=${"A".repeat(43)}.${"B".repeat(22)}`;
	let page;
	/** An expression of the page, asked again until it is something. */
	const until = async (what, expression, seconds = 60) => {
		let last;
		for (const end = Date.now() + seconds * 1000; Date.now() < end; await sleep(500)) {
			last = await page.evaluate(expression).catch((e) => `(${e.message})`);
			if (last && !(typeof last === "string" && last.startsWith("("))) return last;
		}
		throw new Error(`not seen in the page: ${what} (last: ${JSON.stringify(last)})`);
	};
	const text = (s) => `document.body.innerText.includes(${JSON.stringify(s)})`;
	const asking = "!!document.querySelector('[data-slot=pair-confirm]')";
	/** The page past the Gate on the paired computer's pine: the agents it has. */
	const reached = async (seconds = 120) =>
		until("the paired computer's agents", "(async () => !/Choose a machine|Could not reach|Connecting to|Starting pine/.test(document.body.innerText) && window.pine && (r => r.ok && JSON.stringify(r.data))(await window.pine.call('GET', '/agents')))()", seconds);
	/** The page's question before the code is used: what it names of the service, then the owner's answer. */
	const confirmation = async (how, named, yes = true) => {
		const said = await until("the confirmation", `${asking} && (document.querySelector('[data-slot=pair-service]')?.textContent ?? 'no service named')`);
		check(`${how}: the owner is asked first, ${named ? "the service named" : "no service named (Pine's own)"}`, named ? said.includes(serviceHost) : said, named ? true : "no service named");
		await page.evaluate(yes ? "document.querySelector('[data-slot=pair-confirm-yes]').click()" : "[...document.querySelectorAll('[data-slot=pair-confirm] button')].find((b) => b.textContent.trim() === 'Cancel').click()");
	};
	/** The four digits, the computer's Allow, and the paired computer's pine. */
	const pairs = async (how) => {
		const code = await until("the four digits", "document.querySelector('[data-slot=pairing-code]')?.textContent ?? ''");
		const asked = await pairing.asked();
		await pairing.ask("allow");
		check(`${how}: the digits shown are the computer's`, code, asked.code);
		check(`${how}: the computer is told the phone's name`, asked.name, `Pine on ${model}`);
		const agents = await reached();
		check(`${how}: after Allow the paired computer answers: its agents main and scout`, ["main", "scout"].every((a) => agents.includes(`"${a}"`)), true);
	};

	step("the app on fresh data: pairing first, with a field for a link");
	adb("shell", "pm", "clear", APP);
	adb("shell", "am", "start", "-W", "-n", `${APP}/.MainActivity`);
	page = await inspector();
	await until("the pairing view", `${text("Pair this phone with your computer")} && !!document.querySelector('[data-slot=pair-link-field] input')`);
	check("pairing first: the pairing view, its field for a link, SSH behind a link", await page.evaluate("!!document.querySelector('[data-slot=pair-how-to]') && !!document.querySelector('[data-slot=ssh-instead]') && !document.querySelector('input[placeholder=\"you@server\"]')"), true);
	check("state: this app says it pairs", await page.evaluate("Capacitor.Plugins.Pine.state().then((s) => s.canPair)"), true);

	step("a pasted link: confirmed in the page, then the four digits, then Allow at the computer");
	const pasted = await pairLink();
	await page.evaluate(`(() => { const i = document.querySelector('[data-slot=pair-link-field] input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(pasted)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
	await until("the field's Pair button", "(() => { const b = [...document.querySelectorAll('[data-slot=pair-link-field] button')].find((b) => b.textContent.trim() === 'Pair' && !b.disabled); b?.click(); return !!b; })()");
	await confirmation("pasted link", true);
	await pairs("pasted link");

	step("back from the background, the computer having cut the phone's connection meanwhile");
	adb("shell", "input", "keyevent", "KEYCODE_HOME");
	await waitFor("the app paused by HOME", () => front() !== APP || undefined, 15);
	step(`the computer cut ${(await pairing.ask("cut")).count} connection(s) of the phone`);
	await sleep(5000);
	adb("shell", "am", "start", "-n", `${APP}/.MainActivity`);
	await waitFor("the app in front again", () => front() === APP || undefined, 15);
	const again = await reached(90).catch(() => "");
	check("pasted link: reached again after the background, its connection cut meanwhile", again.includes('"scout"'), true);
	check("pasted link: the paired computer is the machine in use", (await page.evaluate("Capacitor.Plugins.Pine.loadPrefs().then((p) => p.use ?? '')")).startsWith("paired:"), true);

	step("App Links: the manifest's address of Pine's own service, and another host's");
	const official = `https://pine-main.drcmda.workers.dev/${SHAPED}`;
	check("App Links: the app declares Pine's own service, to be verified by its statement", /pine-main\.drcmda\.workers\.dev/.test(adb("shell", "pm", "get-app-links", APP)), true);
	const handlers = (url) => adb("shell", `cmd package query-activities --brief -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d ${quoted(url)}`);
	check("App Links: an address of another host is not this app's", handlers(`https://pine.example.com/${SHAPED}`).includes(`${APP}/`), false);
	// Verifying asks the service on the web, which this run never reaches: the state verification gives is set by hand, as Android allows for a test.
	adb("shell", "pm", "set-app-links", "--package", APP, "STATE_APPROVED", "pine-main.drcmda.workers.dev");
	check("App Links: Pine's own service's address, once verified, is this app's", handlers(official).includes(`${APP}/`), true);
	adb("shell", "input", "keyevent", "KEYCODE_HOME");
	await waitFor("the app paused by HOME", () => front() !== APP || undefined, 15);
	// As the camera's link would: a view intent for the address, naming no app.
	adb("shell", `am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d ${quoted(official)}`);
	await waitFor("the app in front, opened by the link", () => front() === APP || undefined, 15);
	await confirmation("App Link of Pine's own service, while the app runs", false, false);
	check("App Link: cancelled, nothing started, still on the paired computer", [await until("the confirmation gone", `!${asking}`), (await reached(30).catch(() => "")).includes('"scout"')], [true, true]);

	step("links that are not a pairing link this phone takes: said, and nothing starts");
	openWith("https://10.0.2.2/#pair=short.short");
	check("opened with: a malformed link is ignored and says so", [await until("the page says it is not a pairing link", text("That is not a pairing link"), 20).catch(() => false), await page.evaluate(`!${asking}`)], [true, true]);
	openWith(`${pairing.service.replace("127.0.0.1", "10.0.2.2")}/${SHAPED}`);
	check("opened with: a service on http is refused and said plainly", [await until("the page says http is refused", text("over http"), 20).catch(() => false), await page.evaluate(`!${asking}`)], [true, true]);

	step("a link the app is started with: the confirmation for that link, then pairing");
	page.close();
	adb("shell", "am", "force-stop", APP);
	openWith(await pairLink());
	page = await inspector();
	await confirmation("opened with, at the start", true);
	await pairs("opened with, at the start");
	if (pairFailed) throw new Error(`${pairFailed} pairing check(s) failed`);

	// A dialog of this app's that came and went between two looks is still in the system's log.
	const anr = adb("logcat", "-d", "-b", "main,system").split("\n").find((l) => l.includes(`ANR in ${APP}`));
	if (anr) throw new Error(`the app was not responding (ANR) during the run: ${anr.trim()}`);
	step(opts["pairing-only"] ? "done: the transport check and the pairing run alone (--pairing-only), not the whole smoke run" : "done: the app reached the pine of the machine and shows its agents, and paired with the computer");
} catch (e) {
	if (e instanceof TransportOnly) step("done: the transport check alone (--transport-only)");
	else {
		console.error(`smoke run failed: ${e instanceof Error ? e.message : e}`);
		process.exitCode = 1;
	}
} finally {
	await cleanup();
}
