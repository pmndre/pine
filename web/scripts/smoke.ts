// `npm run smoke` (after `npm run build`): the built web client and the relay as one deployment
// under `wrangler dev` (`npm install` in web/relay once), in a headless Chrome for Testing, against
// a real sshd on this computer that runs the real `pine service` on a home of its own with the
// scripted model server. Run by hand; no workflow runs it. It needs /usr/sbin/sshd and Chrome for
// Testing (`npx playwright-core install chromium`). Nothing here touches ~/.ssh, ~/.pine, the
// system's sshd or Cloudflare, and no window is shown.
//
// The owner's first visit, as named checks, each of which fails the run: the page cannot reach
// the bridge's storage, document or the daemon's token; a message to the bridge from another
// window is ignored; the first screen shows how to pair, and its link to SSH leads to the SSH view
// (which names the deployment's host as the relay's) and its back control returns; the browser's
// key is shown; a machine is added and used through the relay;
// its host key fingerprint is asked about before the key is offered, and trusted; a message is
// sent and the answer comes back; a picture in an answer shows; a link in an answer opens in a new
// tab with no hold on the client; after the relay restarts the bridge connects again by itself; a
// frame that navigates itself away makes the client start anew.
//
// Then a computer paired by link, on the same deployment (the meeting service beside the
// relay): the Pine app's access host under Node beside the same home's real `pine service`, and a
// second browser that opens the pairing link. Named checks again: the meeting routes answer;
// pairing completes when the owner allows the four digits the browser shows; the computer is listed
// under its name; a conversation answers over a data channel and nothing goes through /ssh; the
// page's policy and the iframe's sandbox are unchanged; after the access host restarts the browser
// connects again by itself. No STUN server outside this computer is asked.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { startMock } from "../../baseline/tests/mock.mjs";
import { pageCsp } from "../../desktop/electron/daemon.ts";
import { headless } from "../test/support/browser.ts";
import { freePort, startMachine } from "../test/support/machine.ts";

const web = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(web, "..");
const dist = path.join(web, "dist");
if (!existsSync(path.join(dist, "index.html")) || !existsSync(path.join(dist, "page", "index.html"))) throw new Error("the web client is not built: npm run build in web/");

const checks: string[] = [];
/** What a failed check prints besides its error: what the page showed, and what the relay and sshd said. */
let explain: () => Promise<string> = async () => "";
async function check(name: string, run: () => Promise<void>) {
	const started = Date.now();
	try {
		await run();
	} catch (e) {
		console.log(`FAIL ${name}\n${await explain().catch(() => "")}`);
		throw e;
	}
	checks.push(name);
	console.log(`ok   ${name} (${Date.now() - started} ms)`);
}

const cleanups: (() => Promise<unknown> | unknown)[] = [];

const write = (file: string, content: string, mode?: number) => {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, content);
	if (mode) chmodSync(file, mode);
};

/** Every file under a folder, as paths relative to it. */
const filesIn = (dir: string) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath, e.name)));
/** The content of the one meta Content-Security-Policy of a document, which has to have exactly one. */
const metaCsp = (html: string) => {
	const found = [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/gi)].map((m) => m[1]);
	assert.equal(found.length, 1, `one meta Content-Security-Policy, found ${found.length}`);
	return found[0];
};

try {
	// What the build wrote, before anything runs: a static deployment sends no header of pine's, so
	// the policies are the metas in the documents, and the preview's stand-in has no place in it.
	await check("the built page carries the desktop page's policy, with pictures only from blob: and data:", async () => {
		assert.equal(metaCsp(readFileSync(path.join(dist, "page", "index.html"), "utf8")), pageCsp({ media: [] }));
	});

	await check("the bridge's document carries its own policy, which allows nothing by default", async () => {
		const policy = metaCsp(readFileSync(path.join(dist, "index.html"), "utf8")).split(";").map((d) => d.trim());
		assert.equal(policy[0], "default-src 'none'");
		for (const directive of ["object-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(policy.includes(directive), directive);
	});

	await check("nothing of the desktop preview's stand-in for the bridge is in the build", async () => {
		// Two things only desktop/src/preview-bridge.ts has: the preview server's routes and one of its refusals.
		const markers = [/\/__pine\//, /The preview's pine stops and starts with the preview/];
		const source = readFileSync(path.join(repo, "desktop", "src", "preview-bridge.ts"), "utf8");
		for (const marker of markers) assert.match(source, marker, "the marker is still in the stand-in's source: pick another");
		const files = filesIn(dist).filter((f) => /\.(js|mjs|html)$/.test(f));
		assert.ok(files.some((f) => f.startsWith(`page${path.sep}`) && f.endsWith(".js")), "the page's scripts were built");
		for (const f of files) {
			const text = readFileSync(path.join(dist, f), "utf8");
			for (const marker of markers) assert.doesNotMatch(text, marker, f);
		}
	});

	// A pine home of its own with the scripted model server, and `pine` on the PATH of the sessions sshd starts.
	const mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	cleanups.push(() => mock.close?.());
	const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "pine-web-smoke-")));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	const home = path.join(dir, "home");
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe", introduce: false }, security: { askAccess: false } }));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ description: "The main agent" }));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "You are the main agent.\n");
	mkdirSync(path.join(home, "browsers"), { recursive: true });
	const bin = path.join(dir, "bin");
	write(path.join(bin, "pine"), `#!/bin/sh\nexec "${process.execPath}" "${path.join(repo, "src", "cli.ts")}" "$@"\n`, 0o755);
	// The login shell the remote command asks for the PATH: one that gives this PATH and reads no startup file of the owner's.
	write(path.join(bin, "login-shell"), `#!/bin/sh\nPATH="${bin}:/usr/bin:/bin"; export PATH\nfor a; do shift; [ "$a" = -l ] || set -- "$@" "$a"; done\nexec /bin/sh "$@"\n`, 0o755);
	const machine = await startMachine({ env: { PINE_HOME: home, SHELL: path.join(bin, "login-shell") } });
	cleanups.push(() => machine.stop());

	// The deployment as Cloudflare would run it: the relay Worker and dist/ under `wrangler dev`, on
	// the loopback, with the one switch that lets the relay reach this computer's sshd
	// (RELAY_ALLOW_LOOPBACK, which no deployed configuration sets). The relay is stopped and
	// started again on the same port, as a deploy restarts a Worker.
	//
	// It is the one configuration of wrangler.jsonc, the one every channel deploys: the relay and the
	// meeting service side by side, so that a machine added as user@host and a computer paired by link are both tried on one deployment.
	// Two changes are made to it, in a copy in the smoke's folder: the servers that help a connection
	// (ICE) are a closed port of the loopback, so that no public STUN server is asked. An empty list
	// would not do: the service falls back to a public one. And the limit per client address is
	// raised (below), since every client here has the one loopback address.
	const relayPort = await freePort();
	const inspectorPort = await freePort();
	const wranglerState = path.join(dir, "wrangler");
	const relayDir = path.join(web, "relay");
	const config = JSON.parse(readFileSync(path.join(relayDir, "wrangler.jsonc"), "utf8").split("\n").filter((line) => !line.trim().startsWith("//")).join("\n"));
	assert.ok(config.durable_objects, "the configuration has the meeting service");
	config.main = path.join(relayDir, config.main);
	// Paths are read from the copy's folder: the ones that point out of web/relay are made whole.
	config.assets = { ...config.assets, directory: dist };
	config.vars = { ...config.vars, ICE: [{ urls: "stun:127.0.0.1:9" }] };
	// And the limit per client address: every browser, the access host and the relay's connections
	// here come from the one loopback address, which a minute of reconnecting takes past 20.
	for (const limit of config.ratelimits) limit.simple = { ...limit.simple, limit: 1000 };
	delete config.$schema;
	const configFile = path.join(wranglerState, "wrangler.json");
	write(configFile, JSON.stringify(config, null, 2));
	let wrangler: ChildProcess | null = null;
	let wranglerLog = "";
	const startRelay = async () => {
		const running = spawn(path.join(relayDir, "node_modules", ".bin", "wrangler"), ["dev", "--config", configFile, "--ip", "127.0.0.1", "--port", String(relayPort), "--inspector-port", String(inspectorPort), "--var", "RELAY_ALLOW_LOOPBACK:1", "--persist-to", path.join(wranglerState, "state"), "--show-interactive-dev-session=false", "--log-level", "warn"], {
			cwd: path.join(web, "relay"),
			// Wrangler's own files (its settings, its logs) go into the smoke's folder, never the owner's; no metrics are sent.
			env: { ...process.env, XDG_CONFIG_HOME: path.join(wranglerState, "config"), WRANGLER_LOG_PATH: path.join(wranglerState, "logs"), WRANGLER_SEND_METRICS: "false", CI: "1" },
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		});
		wrangler = running;
		running.stdout!.on("data", (chunk) => (wranglerLog += chunk));
		running.stderr!.on("data", (chunk) => (wranglerLog += chunk));
		const deadline = Date.now() + 60_000;
		for (;;) {
			if (running.exitCode !== null) throw new Error(`wrangler dev exited: ${wranglerLog}`);
			const up = await fetch(`http://127.0.0.1:${relayPort}/`).then((r) => r.ok, () => false);
			if (up) return;
			if (Date.now() > deadline) throw new Error(`wrangler dev did not answer on ${relayPort}: ${wranglerLog}`);
			await new Promise((r) => setTimeout(r, 200));
		}
	};
	const stopRelay = async () => {
		const running = wrangler;
		wrangler = null;
		if (!running || running.exitCode !== null) return;
		const exited = new Promise((resolve) => running.once("exit", resolve));
		// Its whole group: wrangler runs workerd as a child of its own.
		try {
			process.kill(-running.pid!, "SIGTERM");
		} catch {}
		await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
		try {
			process.kill(-running.pid!, "SIGKILL");
		} catch {}
	};
	await startRelay();
	cleanups.push(stopRelay);
	const origin = `http://127.0.0.1:${relayPort}`;

	const browser = await headless();
	cleanups.push(() => browser.stop());
	const { page } = browser;
	// Every connection the bridge opens to the relay.
	const relayed: string[] = [];
	page.on("websocket", (ws) => relayed.push(new URL(ws.url()).pathname + new URL(ws.url()).search));
	// What the page in its iframe is told by message, kept to look for the token in it.
	await browser.context.addInitScript(() => {
		if (window === window.top) return;
		const heard: string[] = ((window as any).__heard = []);
		window.addEventListener("message", (e) => heard.push(JSON.stringify(e.data) ?? ""));
	});
	const errors: string[] = [];
	page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
	// The page's frame may not submit a form (no allow-forms, rule 10): a button that relied on
	// one would do nothing, and the browser says so on the console. Kept for the whole run.
	const blocked: string[] = [];
	const watchForms = (m: { text(): string }) => /Blocked form submission/i.test(m.text()) && blocked.push(m.text());
	page.on("console", watchForms);
	await page.goto(`${origin}/`);
	const frame = page.frameLocator("iframe");
	explain = async () => {
		const shown = await (await inside()).evaluate(() => document.body.innerText).catch((e) => String(e));
		return `--- the page shows:\n${shown.slice(0, 3000)}\n--- the relay (wrangler dev) said:\n${wranglerLog.slice(-3000)}\n--- sshd said:\n${machine.log().slice(-3000)}`;
	};
	const inside = async () => {
		for (;;) {
			const f = page.frames().find((x) => x.parentFrame() === page.mainFrame() && x.url().includes("/page/"));
			if (f) return f;
			await new Promise((r) => setTimeout(r, 50));
		}
	};

	await check("the page runs in an iframe sandboxed with scripts only", async () => {
		assert.equal(await page.locator("iframe").getAttribute("sandbox"), "allow-scripts");
		await frame.locator("[data-slot=pair-how-to]").waitFor({ timeout: 20_000 });
	});

	// The deployment has the meeting service and the relay: the first screen shows how to pair, and SSH is behind a link.
	await check("the first screen shows how to pair first, without the user@host field or the browser's key", async () => {
		await frame.getByText("Pair this browser with your computer").waitFor({ timeout: 10_000 });
		assert.equal(await frame.getByPlaceholder("you@server").count(), 0);
		assert.equal(await frame.locator("[data-slot=device-key]").count(), 0);
		assert.equal(await frame.locator("[data-slot=back-to-pairing]").count(), 0);
		assert.equal(await frame.locator("[data-slot=meeting-line]").innerText(), `Found through 127.0.0.1:${relayPort}. The two devices then connect directly, or through a relay server that the computer's owner chose.`);
	});

	await check("the link to SSH shows the SSH view, and its back control returns to pairing", async () => {
		await frame.getByRole("button", { name: "Or connect to a server over SSH" }).click();
		await frame.locator("[data-slot=device-key]").waitFor({ timeout: 10_000 });
		await frame.getByPlaceholder("you@server").waitFor({ timeout: 10_000 });
		assert.equal(await frame.locator("[data-slot=pair-how-to]").count(), 0);
		await frame.getByRole("button", { name: "Back to pairing" }).click();
		await frame.locator("[data-slot=pair-how-to]").waitFor({ timeout: 10_000 });
		assert.equal(await frame.getByPlaceholder("you@server").count(), 0);
		await frame.getByRole("button", { name: "Or connect to a server over SSH" }).click();
		await frame.locator("[data-slot=device-key]").waitFor({ timeout: 10_000 });
	});

	await check("the SSH view names this deployment's host as the relay's, which carries SSH only and cannot read it", async () => {
		assert.equal(await frame.locator("[data-slot=relay-line]").innerText(), `Connections go through the relay at 127.0.0.1:${relayPort}. The relay carries only SSH and cannot read it.`);
	});

	await check("the page cannot reach the bridge's IndexedDB, its document or its cookies", async () => {
		const f = await inside();
		const reached = await f.evaluate(async () => {
			const tries: Record<string, string> = {};
			const attempt = async (name: string, act: () => unknown) => {
				try {
					await act();
					tries[name] = "reached";
				} catch (e) {
					tries[name] = (e as Error).name;
				}
			};
			await attempt("indexedDB", () => new Promise((resolve, reject) => {
				const r = indexedDB.open("pine-web");
				r.onsuccess = resolve;
				r.onerror = () => reject(r.error);
			}));
			await attempt("parent document", () => window.parent.document.title);
			await attempt("cookies", () => document.cookie);
			return { tries, origin: window.origin };
		});
		assert.equal(reached.origin, "null");
		for (const [name, result] of Object.entries(reached.tries)) assert.notEqual(result, "reached", name);
	});

	// The key is the card's one <code>: by what it is, not by a class of its look, which the page may change.
	const key = await frame.locator("[data-slot=device-key] code").innerText();
	await check("the browser's key is an Ed25519 key that sshd accepts once it is in authorized_keys", async () => {
		assert.match(key, /^ssh-ed25519 AAAA\S+ pine-web$/);
		machine.authorize(key);
	});

	const host = `${machine.user}@127.0.0.1:${machine.sshPort}`;
	await check("the first connect goes through the relay and asks for the host key's fingerprint, before the browser's key is offered", async () => {
		await frame.getByPlaceholder("you@server").fill(host);
		await frame.getByRole("button", { name: "Add" }).click();
		await frame.locator(`[data-environment="${host}"]`).getByRole("button", { name: "Use" }).click();
		const shown = frame.locator(`[data-environment="${host}"] [data-slot=host-key-fingerprint]`).first();
		await shown.waitFor({ timeout: 20_000 });
		assert.equal(await shown.innerText(), machine.hostFingerprint);
		assert.ok(relayed.some((u) => u === `/ssh?host=127.0.0.1&port=${machine.sshPort}`), relayed.join(", "));
		// Not yet trusted: sshd was reached, but no key was offered to it and no conversation opened.
		assert.match(machine.log(), /Connection from 127\.0\.0\.1/);
		assert.doesNotMatch(machine.log(), /Accepted publickey|Failed publickey|Postponed publickey/);
		assert.equal(await frame.locator("textarea").count(), 0);
	});

	await check("trusting the key connects, and the conversation is there, on the deployment that has the meeting service too", async () => {
		await frame.locator(`[data-environment="${host}"] [data-slot=trust-host-key]`).first().click();
		await frame.locator("textarea").first().waitFor({ timeout: 60_000 });
		assert.match(machine.log(), /Accepted publickey for \S+ from 127\.0\.0\.1 port \d+ ssh2: ED25519/);
	});

	// The mouse's checks come before the window opened by the next ones: once that window was open and
	// closed, headless Chrome hands a click over the sandboxed frame to the bridge's document instead.
	await check("the Send button sends with a click of the mouse, not only with Enter", async () => {
		const box = frame.locator("textarea").first();
		const text = 'Click it. <<MOCK {"steps":[{"text":"The button sent it."}]}>>';
		// The page may still be drawing the conversation it opened, which starts the box anew: what is
		// clicked is sent only once the box holds the text.
		await box.fill(text);
		for (let i = 0; i < 50 && (await box.inputValue()) !== text; i++) {
			await new Promise((r) => setTimeout(r, 100));
			if (i % 10 === 9) await box.fill(text);
		}
		await frame.locator("[data-slot=composer]").getByRole("button", { name: "Send", exact: true }).click();
		await frame.getByText("The button sent it.", { exact: true }).first().waitFor({ timeout: 60_000 });
	});

	await check("an event is published from its form with a click on Publish", async () => {
		const box = frame.locator("textarea").first();
		await box.fill("/emit");
		await box.press("Enter");
		await frame.locator("[data-slot=publish-form]").waitFor({ timeout: 10_000 });
		await frame.locator("#publish-topic").fill("smoke/clicked");
		await frame.getByRole("button", { name: /^Publish/ }).click();
		await frame.locator("[data-slot=publish-form]").waitFor({ state: "detached", timeout: 10_000 });
		await frame.locator("[data-slot=toast]", { hasText: "on smoke/clicked" }).first().waitFor({ timeout: 10_000 });
	});

	await check("the page cannot read the bridge's IndexedDB or the daemon's token", async () => {
		const token = readFileSync(path.join(home, "data", "http-token"), "utf8").trim();
		assert.ok(token.length >= 16, "the daemon wrote its token");
		// The bridge keeps what it holds in IndexedDB, under its own origin.
		assert.ok((await page.evaluate(() => indexedDB.databases())).some((d) => d.name === "pine-web"), "the bridge has its IndexedDB");
		const seen = await (await inside()).evaluate(async () => {
			const tries: Record<string, string> = {};
			for (const [name, act] of Object.entries({
				"its own indexedDB": () => new Promise((resolve, reject) => {
					const r = indexedDB.open("pine-web");
					r.onsuccess = resolve;
					r.onerror = () => reject(r.error);
				}),
				"the bridge's indexedDB": () => (window.parent as Window & typeof globalThis).indexedDB.databases(),
				"the bridge's localStorage": () => (window.parent as Window & typeof globalThis).localStorage.length,
				"the bridge's address": () => window.parent.location.href,
			})) {
				try {
					await act();
					tries[name] = "reached";
				} catch (e) {
					tries[name] = (e as Error).name;
				}
			}
			let storage = "";
			try {
				storage = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
			} catch {}
			return { tries, heard: ((window as any).__heard as string[]) ?? [], text: document.documentElement.outerHTML + storage };
		});
		for (const [name, result] of Object.entries(seen.tries)) assert.notEqual(result, "reached", name);
		assert.ok(seen.heard.length > 10, "the page was told things by message");
		assert.ok(!seen.heard.some((m) => m.includes(token)), "no message to the page carries the token");
		assert.ok(!seen.text.includes(token), "the page's document and storage do not hold the token");
	});

	await check("a message to the bridge from another window is ignored", async () => {
		// The same call twice, from another frame of the bridge's own document and from a window
		// it opened; an answer would go to the page, where it is listened for.
		const call = (id: number, method: string, args: unknown[]) => ({ pine: "call", id, method, args });
		await page.evaluate(() => {
			const other = document.createElement("iframe");
			other.id = "intruder";
			other.name = "intruder";
			document.body.append(other);
		});
		let sibling = page.frame({ name: "intruder" });
		for (let i = 0; !sibling && i < 40; i++) {
			await new Promise((r) => setTimeout(r, 50));
			sibling = page.frame({ name: "intruder" });
		}
		assert.ok(sibling, "a second frame in the bridge's document");
		await sibling.evaluate((m) => parent.postMessage(m, "*"), call(910001, "deviceKey", []));
		await sibling.evaluate((m) => parent.postMessage(m, "*"), call(910002, "open", ["https://example.org/from-another-frame"]));
		const [popup] = await Promise.all([browser.context.waitForEvent("page"), page.evaluate(() => void window.open("about:blank", "intruder-window"))]);
		await popup.evaluate((m) => window.opener.postMessage(m, "*"), call(910003, "deviceKey", []));
		await popup.evaluate((m) => window.opener.postMessage(m, "*"), call(910004, "open", ["https://example.org/from-another-window"]));
		// And once from the page itself, which is answered: the calls above were ones the bridge takes.
		const f = await inside();
		await f.evaluate((m) => parent.postMessage(m, "*"), call(910005, "deviceKey", []));
		await f.waitForFunction(() => ((window as any).__heard as string[]).some((m) => m.includes('"id":910005')), undefined, { timeout: 5000 });
		await new Promise((r) => setTimeout(r, 500));
		const heard = (await f.evaluate(() => (window as any).__heard as string[])).join("\n");
		for (const id of [910001, 910002, 910003, 910004]) assert.ok(!heard.includes(`"id":${id}`), `call ${id} was answered`);
		assert.deepEqual(browser.context.pages().map((p) => p.url()).filter((u) => u.includes("example.org")), [], "nothing was opened");
		await popup.close();
		await page.evaluate(() => document.getElementById("intruder")?.remove());
	});

	await check("a message is sent and the answer comes back", async () => {
		const box = frame.locator("textarea").first();
		await box.fill('Say it. <<MOCK {"steps":[{"text":"The answer came back over SSH."}]}>>');
		await box.press("Enter");
		// The answer alone in its paragraph: the message sent holds the same words inside its directive.
		await frame.getByText("The answer came back over SSH.", { exact: true }).first().waitFor({ timeout: 60_000 });
		assert.ok(mock.state.requests.length > 0, "the model was asked");
	});

	await check("a picture in an answer shows: its bytes come through the tunnel, and the page draws its own object URL of them", async () => {
		// A picture of 3 by 2 pixels in the agent's workspace, which the answer names.
		writeFileSync(path.join(home, "agents", "main", "workspace", "dot.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEElEQVR4nGP4z8AAQQxwFgBB0gX7h/C5SAAAAABJRU5ErkJggg==", "base64"));
		const box = frame.locator("textarea").first();
		await box.fill('Show it. <<MOCK {"steps":[{"text":"Here: ![A small dot](dot.png)"}]}>>');
		await box.press("Enter");
		const picture = frame.locator('img[alt="A small dot"]').first();
		await picture.waitFor({ timeout: 60_000 });
		const f = await inside();
		const drawn = await f.waitForFunction(() => {
			const img = document.querySelector<HTMLImageElement>('img[alt="A small dot"]');
			return img?.complete && img.naturalWidth > 0 ? { src: img.src, w: img.naturalWidth, h: img.naturalHeight } : false;
		}, undefined, { timeout: 30_000 });
		const shown = (await drawn.jsonValue()) as { src: string; w: number; h: number };
		assert.match(shown.src, /^blob:/);
		assert.deepEqual([shown.w, shown.h], [3, 2]);
	});

	await check("a link in an answer opens in a new tab that has no hold on the client, and the page stays", async () => {
		// A site of its own, as a link in an answer leads elsewhere.
		const elsewhere = createHttpServer((_, res) => res.end("<!doctype html><title>elsewhere</title>"));
		await new Promise<void>((resolve) => elsewhere.listen(0, "127.0.0.1", resolve));
		cleanups.push(() => elsewhere.close());
		const target = `http://127.0.0.1:${(elsewhere.address() as AddressInfo).port}/opened-from-an-answer`;
		const box = frame.locator("textarea").first();
		await box.fill(`Link it. <<MOCK {"steps":[{"text":"See [the page](${target})."}]}>>`);
		await box.press("Enter");
		const link = frame.getByText("the page", { exact: true }).first();
		await link.waitFor({ timeout: 60_000 });
		const [opened] = await Promise.all([browser.context.waitForEvent("page", { timeout: 10_000 }), link.click()]);
		await opened.waitForLoadState("domcontentloaded").catch(() => {});
		assert.equal(opened.url(), target);
		assert.equal(await opened.evaluate(() => window.opener), null);
		assert.equal(page.url(), `${origin}/`);
		await opened.close();
	});

	const status = frame.locator("[data-slot=service-status]");
	await check("after the relay restarts, the bridge connects again by itself and the conversation goes on", async () => {
		const before = relayed.length;
		// As a deploy does: the Worker goes, what it carried is cut, and it comes back on the same address.
		await stopRelay();
		await status.and(frame.locator('[aria-label*="pine is not responding"]')).waitFor({ timeout: 10_000 });
		await startRelay();
		await status.and(frame.locator('[aria-label*="pine 0"], [aria-label*="pine 1"]')).waitFor({ timeout: 30_000 });
		assert.ok(relayed.length > before, "a new connection went through the relay");
		const box = frame.locator("textarea").first();
		await box.fill('Again. <<MOCK {"steps":[{"text":"Still here after the relay restarted."}]}>>');
		await box.press("Enter");
		await frame.getByText("Still here after the relay restarted.", { exact: true }).first().waitFor({ timeout: 60_000 });
	});

	await check("the side panel's state is kept by the bridge across a reload", async () => {
		await (await inside()).evaluate(() => localStorage.setItem("pine.sidebar.width", "333"));
		// The page hands its storage over after a short pause.
		await new Promise((r) => setTimeout(r, 800));
		await page.reload();
		await frame.locator("textarea").first().waitFor({ timeout: 60_000 });
		assert.equal(await (await inside()).evaluate(() => localStorage.getItem("pine.sidebar.width")), "333");
	});

	await check("a frame that navigates itself makes the whole client start anew, and its new document is told nothing unasked", async () => {
		// The frame's policy (frame-src 'self') lets it go only to the client's own documents: it
		// loads the page there again, one that says on the console every message it hears. The
		// bridge cannot tell that document from the first before its load event, so what it asked
		// itself is answered; nothing else reaches it before the client starts anew.
		const heard: string[] = [];
		const listen = (m: { text(): string }) => m.text().startsWith("HEARD ") && heard.push(m.text());
		page.on("console", listen);
		await browser.context.addInitScript(() => {
			if (window !== window.top && location.search.includes("navigated")) window.addEventListener("message", (e) => console.log(`HEARD ${JSON.stringify(e.data)}`));
		});
		await page.evaluate(() => ((window as any).__before = true));
		await (await inside()).evaluate((u) => void (location.href = u), `${origin}/page/?navigated`);
		await page.waitForFunction(() => !(window as any).__before, undefined, { timeout: 10_000 });
		await frame.locator("textarea").first().waitFor({ timeout: 60_000 });
		assert.ok(page.frames().every((x) => !x.url().includes("navigated")), "the frame shows the page as the client loads it");
		await new Promise((r) => setTimeout(r, 500));
		page.off("console", listen);
		const told = heard.map((h) => JSON.parse(h.slice("HEARD ".length)) as { pine: string });
		assert.deepEqual(told.filter((m) => m.pine !== "reply"), [], "the document the frame went to was told nothing unasked");
		const token = readFileSync(path.join(home, "data", "http-token"), "utf8").trim();
		assert.ok(!heard.some((h) => h.includes(token)), "nor the daemon's token");
	});

	// ---- A computer paired by link, peer to peer ----------------------------------------------------
	// The Pine app's access host (desktop/electron/access/host.ts) under Node beside the same
	// home's real `pine service`, waiting at the meeting service of the deployment, with pairing as
	// the app wires it and an owner who answers by what the browser shows. A second browser, on a
	// profile of its own, opens the pairing link as a phone would after scanning the QR code.
	await check("the meeting routes answer: the configuration, with the relay on and the loopback's servers, and the two sockets", async () => {
		const said = await fetch(`${origin}/meet/config`).then((r) => r.json());
		assert.deepEqual(said, { ice: [{ urls: "stun:127.0.0.1:9" }], relay: true });
		// A browser that asks for a computer nobody waits for is told so by its close code.
		const code = await new Promise<number>((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${relayPort}/meet/join?id=${"n".repeat(43)}`);
			ws.addEventListener("close", (e) => resolve(e.code));
			ws.addEventListener("error", () => {});
			setTimeout(() => reject(new Error("the join socket was not closed")), 10_000);
		});
		assert.equal(code, 4404);
	});

	const { connect: connectService } = await import(new URL("../../desktop/electron/service.ts", import.meta.url).href);
	const service = await connectService({ argv: [process.execPath, path.join(repo, "src", "cli.ts")], env: { ...process.env, PINE_HOME: home }, from: "the smoke" }, { home });
	cleanups.push(() => service.stop());
	type AccessHost = { machineId: string; status(): string; store: { devices(): { id: string; name: string }[] }; stop(): Promise<void> };
	const { startAccessHost } = (await import(new URL("../../desktop/electron/access/host.ts", import.meta.url).href)) as { startAccessHost(options: Record<string, unknown>): Promise<AccessHost> };
	const { createPairing } = (await import(new URL("../../desktop/electron/access/pairing.ts", import.meta.url).href)) as { createPairing(options: Record<string, unknown>): { open(): { link: string }; admit: unknown } };
	const accessFolder = path.join(dir, "access");
	const COMPUTER = "Smoke computer";
	/** What the owner was asked, and what the browser showed when they answered. */
	const asked: { name: string; code: string; shown: string }[] = [];
	let shownCode: () => Promise<string> = async () => "";
	let pairing: ReturnType<typeof createPairing> | undefined;
	const startHost = async () => {
		const started = await startAccessHost({
			service: origin,
			folder: accessFolder,
			daemon: async () => JSON.stringify({ base: service.base, token: service.token, mode: service.mode, started: service.started, home: service.home, version: service.version }),
			// The owner allows only when the four digits on the computer are the ones the browser shows.
			admit: (context: Record<string, unknown>) => (pairing = createPairing({ ...context, computerName: () => COMPUTER, ask: async (request: { name: string; code: string }) => {
				const shown = await shownCode();
				asked.push({ ...request, shown });
				return shown === request.code;
			} })).admit,
			retry: { firstMs: 200, maxMs: 2000 },
		});
		const end = Date.now() + 20_000;
		while (started.status() !== "waiting") {
			if (Date.now() > end) throw new Error(`the access host never waited at the meeting service (${started.status()})`);
			await new Promise((r) => setTimeout(r, 50));
		}
		return started;
	};
	let computer = await startHost();
	cleanups.push(() => computer.stop());

	const phone = await headless();
	cleanups.push(() => phone.stop());
	const opened: string[] = [];
	phone.page.on("websocket", (ws) => opened.push(new URL(ws.url()).pathname + new URL(ws.url()).search));
	const phoneErrors: string[] = [];
	const phoneSaid: string[] = [];
	phone.page.on("console", (m) => (phoneSaid.push(`${m.type()}: ${m.text()}`), m.type() === "error" && phoneErrors.push(m.text())));
	phone.page.on("console", watchForms);
	const screen = phone.page.frameLocator("iframe");
	const paired = `paired:${computer.machineId}`;
	shownCode = async () => (await screen.locator("[data-slot=pairing-code]").innerText({ timeout: 20_000 })).trim();
	explain = async () => {
		const shown = await screen.locator("body").innerText({ timeout: 2000 }).catch((e) => String(e));
		return `--- the paired browser shows:\n${shown.slice(0, 3000)}\n--- it opened: ${opened.join(", ")}\n--- its console: ${phoneSaid.slice(-30).join("\n")}\n--- the owner was asked: ${JSON.stringify(asked)}\n--- the relay (wrangler dev) said:\n${wranglerLog.slice(-3000)}`;
	};

	await check("pairing by link completes when the owner allows the four digits the browser shows", async () => {
		const { link } = pairing!.open();
		assert.ok(link.startsWith(`${origin}/#pair=${computer.machineId}.`), link);
		await phone.page.goto(link);
		await screen.locator("textarea").first().waitFor({ timeout: 90_000 });
		assert.equal(asked.length, 1, "the owner was asked once");
		assert.match(asked[0].code, /^\d{4}$/);
		assert.equal(asked[0].shown, asked[0].code);
		assert.deepEqual(computer.store.devices().map((d) => d.name), [asked[0].name]);
		// The link's fragment is gone from the address at once: it carried the code.
		assert.equal(phone.page.url(), `${origin}/`);
	});

	await check("the paired computer is listed under the name it gave, never its id", async () => {
		const foot = screen.locator("[data-slot=service-status]");
		await foot.and(screen.locator(`[aria-label*="${COMPUTER}"]`)).waitFor({ timeout: 30_000 });
		await foot.click();
		const item = screen.locator(`[data-host="${paired}"]`);
		await item.waitFor({ timeout: 10_000 });
		assert.equal((await item.innerText()).trim(), COMPUTER);
		await phone.page.keyboard.press("Escape");
	});

	await check("a conversation answers over a data channel, and no /ssh socket was opened for it", async () => {
		const box = screen.locator("textarea").first();
		await box.fill('Say it. <<MOCK {"steps":[{"text":"The answer came back peer to peer."}]}>>');
		await box.press("Enter");
		await screen.getByText("The answer came back peer to peer.", { exact: true }).first().waitFor({ timeout: 60_000 });
		assert.ok(opened.includes(`/meet/join?id=${computer.machineId}`), opened.join(", "));
		assert.deepEqual(opened.filter((u) => u.startsWith("/ssh")), [], "nothing went through the relay");
		assert.ok(opened.every((u) => u.startsWith("/meet/join?")), opened.join(", "));
	});

	await check("the page's policy still equals the desktop page's, and the iframe's sandbox is still scripts only", async () => {
		assert.equal(await phone.page.locator("iframe").getAttribute("sandbox"), "allow-scripts");
		const served = await fetch(`${origin}/page/`).then((r) => r.text());
		assert.equal(metaCsp(served), pageCsp({ media: [] }));
		const origins = await (async () => {
			for (;;) {
				const f = phone.page.frames().find((x) => x.parentFrame() === phone.page.mainFrame() && x.url().includes("/page/"));
				if (f) return f.evaluate(() => window.origin);
				await new Promise((r) => setTimeout(r, 50));
			}
		})();
		assert.equal(origins, "null");
	});

	await check("after the access host restarts, the browser connects again by itself and the conversation goes on", async () => {
		const joins = opened.length;
		const foot = screen.locator("[data-slot=service-status]");
		// As the app does when it quits and opens again: the same key, from the same folder.
		await computer.stop();
		await foot.and(screen.locator(`[aria-label*="cannot reach ${COMPUTER}"], [aria-label*="connecting to ${COMPUTER}"], [aria-label*="pine is not responding"]`)).waitFor({ timeout: 30_000 });
		computer = await startHost();
		assert.equal(`paired:${computer.machineId}`, paired, "the same computer");
		await foot.and(screen.locator(`[aria-label*="· ${COMPUTER}"]`)).waitFor({ timeout: 90_000 });
		assert.ok(opened.length > joins, "a new meeting was joined");
		const box = screen.locator("textarea").first();
		await box.fill('Again. <<MOCK {"steps":[{"text":"Still here after the computer came back."}]}>>');
		await box.press("Enter");
		await screen.getByText("Still here after the computer came back.", { exact: true }).first().waitFor({ timeout: 60_000 });
		assert.deepEqual(opened.filter((u) => u.startsWith("/ssh")), []);
		assert.equal(asked.length, 1, "nobody was asked again");
		assert.deepEqual(phoneErrors.filter((e) => /Content Security Policy|Refused/.test(e)), [], "the paired browser's page broke no policy");
	});

	await check("on an iPhone a pairing link waits for the owner's choice: the app's button uses no code, and Continue in this browser pairs", async () => {
		const iphone = await headless();
		cleanups.push(() => iphone.stop());
		await iphone.page.addInitScript(() => {
			Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1" });
		});
		const its = iphone.page.frameLocator("iframe");
		shownCode = async () => (await its.locator("[data-slot=pairing-code]").innerText({ timeout: 20_000 })).trim();
		const before = asked.length;
		const { link } = pairing!.open();
		await iphone.page.goto(link);
		const app = iphone.page.locator('.choice button[data-choice="app"]');
		await app.waitFor({ timeout: 20_000 });
		// The link's fragment left the address before the choice was drawn.
		assert.equal(iphone.page.url(), `${origin}/`);
		await app.click();
		await iphone.page.locator(".choice .note").waitFor({ timeout: 5000 });
		await new Promise((r) => setTimeout(r, 500));
		assert.equal(asked.length, before, "the computer was asked nothing before the owner chose the browser");
		await iphone.page.locator('.choice button[data-choice="browser"]').click();
		await its.locator("textarea").first().waitFor({ timeout: 90_000 });
		assert.equal(asked.length, before + 1, "the owner was asked once");
		assert.equal(asked.at(-1)!.name, "Safari on iPhone");
		assert.equal(asked.at(-1)!.shown, asked.at(-1)!.code);
		assert.equal(await iphone.page.locator(".choice").count(), 0, "the choice is gone");
		assert.equal(await iphone.page.locator("iframe").getAttribute("sandbox"), "allow-scripts");
		await iphone.stop();
	});

	await check("a browser without Ed25519 in WebCrypto is told which browsers work, and nothing else starts", async () => {
		const other = await browser.context.newPage();
		await other.addInitScript(() => {
			const make = crypto.subtle.generateKey.bind(crypto.subtle);
			crypto.subtle.generateKey = ((algorithm: { name?: string }, ...rest: unknown[]) => (algorithm?.name === "Ed25519" ? Promise.reject(new DOMException("Unrecognized name.", "NotSupportedError")) : (make as any)(algorithm, ...rest))) as typeof crypto.subtle.generateKey;
		});
		const tries: string[] = [];
		other.on("websocket", (ws) => tries.push(ws.url()));
		await other.goto(`${origin}/`);
		await other.locator(".unsupported").waitFor({ timeout: 10_000 });
		assert.match(await other.locator(".unsupported").innerText(), /Chrome 137 or later, Firefox 130 or later, or Safari 17 or later/);
		assert.equal(await other.locator("iframe").count(), 0);
		assert.deepEqual(tries, []);
		await other.close();
	});

	await check("no form submission was blocked in the sandboxed frame during the whole run", async () => {
		assert.deepEqual(blocked, []);
	});

	assert.deepEqual(errors.filter((e) => /Content Security Policy|Refused/.test(e)), [], "the page broke no policy");
	console.log(`\n${checks.length} checks passed`);
} finally {
	for (const clean of cleanups.reverse()) await Promise.resolve(clean()).catch(() => {});
}
process.exit(0);
