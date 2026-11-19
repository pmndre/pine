import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlToText, isPrivateAddress } from "./web.ts";
import { harness, mockMsg, sleep } from "../testing/harness.ts";

const owner = { trust: "owner" as const };

test("bundled web server: refuses private addresses, and using it taints the session", async () => {
	for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.10", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) assert.ok(isPrivateAddress(ip), ip);
	for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700::1111"]) assert.ok(!isPrivateAddress(ip), ip);
	// 192.0.x.x: two blocks are set aside and stay closed; the rest is public (iana.org, a large hosting network).
	for (const ip of ["192.0.0.1", "192.0.0.170", "192.0.2.44"]) assert.ok(isPrivateAddress(ip), ip);
	for (const ip of ["192.0.43.8", "192.0.78.13", "192.0.1.1"]) assert.ok(!isPrivateAddress(ip), ip);
	const page = htmlToText("<html><head><title>A &amp; B</title><script>evil()</script><style>p{}</style></head><body><h1>Head</h1><p>one<br>two</p><ul><li>item</li></ul><!-- hidden --></body></html>");
	assert.equal(page.title, "A & B");
	assert.equal(page.text, "Head\none\ntwo\n- item");

	const h = await harness({ pine: { mcp: { web: { pine: "web" } } }, agents: { main: { agent: { publish: ["out/#"] } } } });
	const urls = [`http://127.0.0.1:${h.mock.port}/v1/models`, `http://localhost:${h.mock.port}/v1/models`, "file:///etc/passwd", "http://user:pw@example.com/", `http://2130706433:${h.mock.port}/`, "http://[::1]/"];
	await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: urls.map((url) => ({ name: "mcp__web__fetch", args: { url } })) }]), ...owner });
	const results = h.toolResults();
	assert.equal(results.length, urls.length);
	for (const [i, r] of results.entries()) assert.ok(/private|only http and https|credentials|not fetched/.test(r), `${urls[i]} -> ${r}`);
	assert.equal(h.mock.state.requests.filter((q: any) => q.url === "/v1/models").length, 0, "nothing reached the local server");
	const session = h.pine.agents.status().sessions.find((s) => s.agent === "main")!;
	assert.ok(/mcp__web__fetch returned outside content/.test(session.tainted ?? ""), String(session.tainted));
	await sleep(10);
	await h.close();
});
