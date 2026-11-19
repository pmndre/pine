import assert from "node:assert/strict";
import dgram from "node:dgram";
import http from "node:http";
import net from "node:net";
import { test } from "node:test";
import { harness, mockMsg, until } from "../testing/harness.ts";

test("live: an agent opens a page in the bundled browser", { skip: process.env.PINE_LIVE !== "1", timeout: 60_000 }, async (t) => {
	const dev = http.createServer((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("<title>Dev server</title><h1>DEV-SERVER-PAGE</h1>"));
	await new Promise<void>((r) => dev.listen(0, "127.0.0.1", r));
	t.after(() => dev.close());
	const devUrl = `http://127.0.0.1:${(dev.address() as net.AddressInfo).port}/`;
	const h = await harness({ pine: { mcp: { browser: { pine: "browser" } } }, agents: { main: {} } });
	// The owner allows the dev server and nothing else.
	const asked: any[] = [];
	h.pine.bus.subscribe("approval/requested", (e) => {
		asked.push(e.payload);
		h.pine.approvals.decide((e.payload as any).id, (e.payload as any).summary.includes(devUrl), "test");
	});
	const r = await h.pine.agents.run({
		agent: "main",
		prompt: mockMsg([{ tools: [{ name: "mcp__browser__browser_navigate", args: { url: "https://example.com" } }, { name: "mcp__browser__browser_navigate", args: { url: `http://127.0.0.1:${h.mock.port}/v1/models` } }, { name: "mcp__browser__browser_run_code_unsafe", args: { code: "1" } }, { name: "mcp__browser__browser_navigate", args: { url: devUrl } }] }]),
		trust: "owner",
	});
	assert.equal(r.status, "done");
	const [page, local, code, allowed] = h.toolResults();
	assert.ok(page.includes("Page Title: Example Domain") && page.includes('link "Learn more"'), page);
	assert.ok(/not approved/.test(local) && !local.includes("mock-model"), local);
	assert.match(code, /not found|not available/);
	assert.ok(allowed.includes("DEV-SERVER-PAGE"), allowed);
	assert.equal(asked.length, 2);
	// What it opened is kept for the owner, newest first; the address that was not approved is not among them.
	assert.deepEqual((await h.pine.agents.browserState("main", "main")).visited, [devUrl, "https://example.com/"]);
	assert.ok(/mcp__browser__browser_navigate returned outside content/.test(h.pine.agents.status().sessions[0].tainted ?? ""));
	await h.close();
});

// Starts a real browser. Only with PINE_LIVE=1.
test("live: a page in the bundled browser reaches nothing nearby, also not by the roads that lead around a proxy", { skip: process.env.PINE_LIVE !== "1", timeout: 60_000 }, async (t) => {
	// Another service on this computer, and a port that hears whatever is sent past the proxy (a proxy carries no UDP).
	const reached: string[] = [];
	const other = http.createServer((req, res) => (reached.push(req.url ?? ""), res.writeHead(200, { "access-control-allow-origin": "*" }).end("OTHER-LOCAL-SECRET")));
	await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
	const otherPort = (other.address() as net.AddressInfo).port;
	const udp = dgram.createSocket("udp4");
	const datagrams: number[] = [];
	udp.on("message", (m) => datagrams.push(m.length));
	await new Promise<void>((r) => udp.bind(0, "127.0.0.1", r));
	const udpPort = udp.address().port;
	const tried: string[] = [];
	const dev = http.createServer((req, res) => {
		if (req.url?.startsWith("/tried?")) return void (tried.push(decodeURIComponent(req.url.slice(7))), res.end("ok"));
		res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>Dev server</title><h1>DEV-SERVER-PAGE</h1><script>
const say = (s) => fetch("/tried?" + encodeURIComponent(s));
fetch("http://127.0.0.1:${otherPort}/fetch").then((r) => r.text()).then((x) => say("fetch got " + x), () => say("fetch refused"));
try { const ws = new WebSocket("ws://127.0.0.1:${otherPort}/ws"); ws.onopen = () => say("ws open"); ws.onerror = () => say("ws refused"); } catch { say("ws refused"); }
try { const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${udpPort}" }] }); pc.createDataChannel("x"); pc.createOffer().then((o) => pc.setLocalDescription(o)); say("rtc started"); } catch { say("rtc absent"); }
try { new WebTransport("https://127.0.0.1:${udpPort}/"); say("wt started"); } catch { say("wt absent"); }
new Worker(URL.createObjectURL(new Blob(['try { const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${udpPort}" }] }); pc.createDataChannel("x"); pc.createOffer().then((o) => pc.setLocalDescription(o)); } catch {}; try { new WebTransport("https://127.0.0.1:${udpPort}/w") } catch {}; fetch("http://127.0.0.1:${otherPort}/worker").catch(() => {})'])));
</script>`);
	});
	await new Promise<void>((r) => dev.listen(0, "127.0.0.1", r));
	t.after(() => (dev.closeAllConnections(), dev.close(), other.closeAllConnections(), other.close(), udp.close()));
	const devUrl = `http://127.0.0.1:${(dev.address() as net.AddressInfo).port}/`;
	const h = await harness({ pine: { mcp: { browser: { pine: "browser" } } }, agents: { main: {} } });
	// The owner allows the page itself, and that is all the browser gets of this computer.
	h.pine.bus.subscribe("approval/requested", (e) => void h.pine.approvals.decide((e.payload as any).id, (e.payload as any).summary.includes(devUrl), "test"));
	const r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [{ name: "mcp__browser__browser_navigate", args: { url: devUrl } }] }, { tools: [{ name: "mcp__browser__browser_wait_for", args: { time: 3 } }] }]), trust: "owner" });
	assert.equal(r.status, "done");
	assert.ok(h.toolResults(h.mock.state.requests[1])[0].includes("DEV-SERVER-PAGE"));
	await until(() => tried.some((x) => /^fetch /.test(x)) && tried.some((x) => /^ws /.test(x)), 8000, `the page's attempts: ${tried.join(", ")}`);
	assert.deepEqual(reached, [], "nothing arrived at the other service");
	assert.ok(tried.includes("fetch refused") && tried.includes("ws refused"), tried.join(", "));
	assert.deepEqual(datagrams, [], `nothing was sent past the proxy (the page said: ${tried.join(", ")})`);
	await h.close();
});
