// `npm run smoke` (after `npm run build`): the built web client and the relay as one deployment
// under `wrangler dev` (`npm install` in web/relay once), in a headless Chrome for Testing, against
// a real sshd on this computer that runs the real `pine service` on a home of its own with the
// scripted model server. Run by hand; no workflow runs it. It needs /usr/sbin/sshd and Chrome for
// Testing (`npx playwright-core install chromium`). Nothing here touches ~/.ssh, ~/.pine, the
// system's sshd or Cloudflare, and no window is shown.
//
// The owner's first visit, as named checks, each of which fails the run: the page cannot reach
// the bridge's storage, document or the daemon's token; a message to the bridge from another
// window is ignored; the browser's key is shown; a machine is added and used through the relay;
// its host key fingerprint is asked about before the key is offered, and trusted; a message is
// sent and the answer comes back; a picture in an answer shows; a link in an answer opens in a new
// tab with no hold on the client; after the relay restarts the bridge connects again by itself; a
// frame that navigates itself away makes the client start anew.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { startMock } from "../../baseline/tests/mock.mjs";
import { pageCsp } from "../../desktop/electron/daemon.ts";
import { headless } from "../testing/browser.ts";
import { freePort, startMachine } from "../testing/machine.ts";

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
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false } }));
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
	const relayPort = await freePort();
	const inspectorPort = await freePort();
	const wranglerState = path.join(dir, "wrangler");
	let wrangler: ChildProcess | null = null;
	let wranglerLog = "";
	const startRelay = async () => {
		const running = spawn(path.join(web, "relay", "node_modules", ".bin", "wrangler"), ["dev", "--ip", "127.0.0.1", "--port", String(relayPort), "--inspector-port", String(inspectorPort), "--var", "RELAY_ALLOW_LOOPBACK:1", "--persist-to", path.join(wranglerState, "state"), "--show-interactive-dev-session=false", "--log-level", "warn"], {
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
		await frame.locator("[data-slot=device-key]").waitFor({ timeout: 20_000 });
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

	const key = await frame.locator("[data-slot=device-key]").locator(".font-mono").innerText();
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

	await check("trusting the key connects, and the conversation is there", async () => {
		await frame.locator(`[data-environment="${host}"] [data-slot=trust-host-key]`).first().click();
		await frame.locator("textarea").first().waitFor({ timeout: 60_000 });
		assert.match(machine.log(), /Accepted publickey for \S+ from 127\.0\.0\.1 port \d+ ssh2: ED25519/);
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
		await status.and(frame.locator('[aria-label*="pine does not answer"]')).waitFor({ timeout: 10_000 });
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

	assert.deepEqual(errors.filter((e) => /Content Security Policy|Refused/.test(e)), [], "the page broke no policy");
	console.log(`\n${checks.length} checks passed`);
} finally {
	for (const clean of cleanups.reverse()) await Promise.resolve(clean()).catch(() => {});
}
process.exit(0);
