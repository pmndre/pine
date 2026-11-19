import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import dgram from "node:dgram";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { rendered, rendering } from "../src/watching.ts";
import { harness, until } from "../testing/harness.ts";

const live = { skip: process.env.PINE_LIVE !== "1", timeout: 120_000 };

const events = (h: any, name: string): any[] => h.pine.bus.query({ topic: `source/${name}/#` }).sort((a: any, b: any) => a.id - b.id);

const info = (h: any, name: string) => h.pine.sources.list().find((s: any) => s.name === name)!;

const looked = (h: any, ...names: string[]) => until(() => names.every((n) => /^last looked \d\d:\d\d:\d\d/.test(info(h, n).status ?? "")), 8000, `the first look of ${names.join(", ")}`);

/** Whether a program runs whose command line names this folder: a browser has its profile's folder there. */
const running = (folder: string): string[] => {
	try {
		return execFileSync("pgrep", ["-f", folder], { encoding: "utf8" }).split("\n").filter(Boolean);
	} catch {
		return [];
	}
};

// Starts the real browser. Only with PINE_LIVE=1.
test("live: a page that a script fills in is watched with the browser, which reaches that page and nothing else nearby", live, async (t) => {
	delete rendering.program;
	// Another service on this computer, and a port that would hear a connection made past the proxy.
	const reached: string[] = [];
	const other = http.createServer((req, res) => (reached.push(req.url ?? ""), res.writeHead(200, { "access-control-allow-origin": "*" }).end("OTHER-LOCAL-SECRET")));
	await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
	const otherPort = (other.address() as net.AddressInfo).port;
	const udp = dgram.createSocket("udp4");
	const datagrams: number[] = [];
	udp.on("message", (m) => datagrams.push(m.length));
	await new Promise<void>((r) => udp.bind(0, "127.0.0.1", r));
	const udpPort = udp.address().port;

	const state = { price: "499,00 €" };
	const tried: string[] = [];
	const site = http.createServer((req, res) => {
		const port = (site.address() as net.AddressInfo).port;
		if (req.url === "/price.json") return void setTimeout(() => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(state)), 200);
		if (req.url?.startsWith("/tried?")) return void (tried.push(decodeURIComponent(req.url.slice(7))), res.end("ok"));
		// Another name for this computer: to the source it is somewhere else.
		if (req.url === "/away") return void res.writeHead(302, { location: `http://localhost:${port}/` }).end();
		if (req.url === "/slow.js") return;
		if (req.url === "/stuck") return void res.writeHead(200, { "content-type": "text/html" }).end("<p>never done</p><script src='/slow.js'></script>");
		res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><html><head><title>Shop</title></head><body><h1>Fridge 3000</h1>
<ul><li class="offer">Old model</li><li class="offer">Price: <span id="price">loading</span></li></ul>
<script>
const say = (s) => fetch("/tried?" + encodeURIComponent(s));
fetch("/price.json").then((r) => r.json()).then((j) => { document.getElementById("price").textContent = j.price; });
fetch("http://127.0.0.1:${otherPort}/fetch").then((r) => r.text()).then((t) => say("fetch got " + t), () => say("fetch refused"));
fetch("http://localhost:${otherPort}/name").then((r) => r.text()).then((t) => say("name got " + t), () => say("name refused"));
try { const ws = new WebSocket("ws://127.0.0.1:${otherPort}/ws"); ws.onopen = () => say("ws open"); ws.onerror = () => say("ws refused"); } catch { say("ws refused"); }
try { const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${udpPort}" }] }); pc.createDataChannel("x"); pc.createOffer().then((o) => pc.setLocalDescription(o)); say("rtc started"); } catch { say("rtc absent"); }
try { new WebTransport("https://127.0.0.1:${udpPort}/"); say("wt started"); } catch { say("wt absent"); }
new Worker(URL.createObjectURL(new Blob(['try { new WebTransport("https://127.0.0.1:${udpPort}/w") } catch {}; fetch("http://127.0.0.1:${otherPort}/worker").catch(() => {})'])));
</script></body></html>`);
	});
	await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
	const base = `http://127.0.0.1:${(site.address() as net.AddressInfo).port}`;
	t.after(() => (site.closeAllConnections(), site.close(), other.closeAllConnections(), other.close(), udp.close()));

	const each = { type: "http", every: "400ms", start: "always" };
	const h = await harness({
		pine: {
			sources: {
				// What only a browser reads: the script's value, found with a selector pine's own reading of a page does not take.
				shown: { ...each, url: `${base}/`, render: true, select: "li.offer:nth-child(2) > span" },
				whole: { ...each, url: `${base}/`, render: true },
				plain: { ...each, url: `${base}/`, select: "#price" },
				away: { ...each, url: `${base}/away`, render: true },
			},
		},
		agents: { main: {} },
	});
	await looked(h, "shown", "whole", "plain");
	assert.match(info(h, "shown").status, /now: 499,00 €$/);
	assert.match(info(h, "whole").status, /now: 3 lines$/);
	assert.match(info(h, "plain").status, /now: loading$/, "without the browser the script's value is not there");
	assert.equal(h.pine.bus.query({ topic: "source/#" }).length, 0);

	state.price = "479,00 €";
	await until(() => events(h, "shown").length === 1 && events(h, "whole").length === 1, 30_000, "the change");
	assert.deepEqual(events(h, "shown")[0].payload, { url: `${base}/`, value: "479,00 €", previous: "499,00 €", number: 479, previousNumber: 499 });
	assert.deepEqual([events(h, "whole")[0].payload.added, events(h, "whole")[0].payload.removed], [["Price: 479,00 €"], ["Price: 499,00 €"]]);
	assert.equal(events(h, "plain").length, 0);

	// The page's scripts ran, and what they tried nearby never arrived: not by fetch, not by another name, not through a
	// socket, not from a worker, and not past the proxy over UDP.
	assert.ok(tried.includes("fetch refused") && tried.includes("name refused") && tried.includes("ws refused"), tried.join(", "));
	assert.ok(!tried.some((x) => / got |ws open/.test(x)), tried.join(", "));
	assert.deepEqual(reached, [], "the other service on this computer was never asked");
	assert.deepEqual(datagrams, [], "nothing went around the proxy");

	// Sent on to another host, and a local address that is another one than the page's: failed looks that say so.
	await until(() => /failing since .*: it sends on to localhost:\d+, which is not the address that was confirmed/.test(info(h, "away").status ?? ""), 30_000, "the redirect to be refused");
	assert.deepEqual(reached, []);

	// When pine stops, no browser stays behind.
	const data = h.pine.cfg.dataDir;
	await h.close();
	assert.deepEqual(running(data), []);
});

test("live: a browser whose helper is killed outright is found and ended, and one that is not installed says how to get it", live, async (t) => {
	delete rendering.program;
	// A page that never finishes loading: its script is asked for and never comes.
	let waiting = 0;
	const site = http.createServer((req, res) => {
		if (req.url === "/slow.js") return void waiting++;
		res.writeHead(200, { "content-type": "text/html" }).end("<p>never done</p><script src='/slow.js'></script>");
	});
	await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
	t.after(() => (site.closeAllConnections(), site.close()));
	const key = `127.0.0.1:${(site.address() as net.AddressInfo).port}`;
	const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-render-live-")));
	t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
	fs.writeFileSync(path.join(folder, "local.json"), JSON.stringify([key]));
	const job = { url: `http://${key}/`, localFile: path.join(folder, "local.json") };

	// The helper is killed in a way it cannot answer to (as when it hangs): its browser would run on.
	const look = rendered(job, folder, new AbortController().signal).then(
		() => "answered",
		(e) => String(e.message),
	);
	await until(() => waiting === 1 && running(path.join(folder, "browser")).length > 1, 20_000, "the browser to be on the page");
	const helper = execFileSync("pgrep", ["-f", "mcp/render"], { encoding: "utf8" }).split("\n").filter(Boolean).map(Number);
	for (const pid of helper) process.kill(pid, "SIGKILL");
	assert.equal(await look, "its browser ended without an answer");
	await until(() => running(path.join(folder, "browser")).length === 0, 3000, "the browser to be gone");
	assert.ok(!fs.existsSync(path.join(folder, "browser")));

	// A stop in the middle of a look: the browser goes with it, and the look is over only then.
	const stop = new AbortController();
	const second = rendered(job, folder, stop.signal).catch((e) => String(e.message));
	await until(() => waiting === 2 && running(path.join(folder, "browser")).length > 1, 20_000, "the browser to be on the page again");
	stop.abort();
	assert.equal(await second, "stopped");
	assert.deepEqual(running(path.join(folder, "browser")), []);

	// The page never finishes loading: the look ends at its time limit, by the helper's own clock, and the browser with it.
	rendering.timeoutMs = 2000;
	try {
		await assert.rejects(() => rendered(job, folder, new AbortController().signal), /^Error: the page did not finish loading within 2 s$/);
	} finally {
		delete rendering.timeoutMs;
	}
	assert.deepEqual(running(path.join(folder, "browser")), []);

	// No browser on this computer (here: none where it is looked for).
	const before = process.env.PLAYWRIGHT_BROWSERS_PATH;
	process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(folder, "no-browsers");
	try {
		await assert.rejects(() => rendered(job, folder, new AbortController().signal), /pine's browser is not installed on this computer\. Your owner installs it by typing this into a terminal: pine browser-install/);
	} finally {
		if (before === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
		else process.env.PLAYWRIGHT_BROWSERS_PATH = before;
	}
});
