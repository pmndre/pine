// Whether there is a newer app (electron/updates.ts), asked of a stand-in for GitHub on a port
// of the test's own: no test here reaches the web.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { ahead, lookForUpdate, RELEASES } from "./updates.ts";

/** What the stand-in answers next: a status and a body. */
let answer: { status: number; body: string } = { status: 200, body: "{}" };
const asked: Array<{ url?: string; agent?: string; headers: http.IncomingHttpHeaders }> = [];
let server: http.Server;
let at: string;

const release = (tag: string, assets: string[] = [`Pine-${tag.replace(/^v/, "")}-arm64.dmg`, `Pine-${tag.replace(/^v/, "")}-x64.dmg`], more: Record<string, unknown> = {}) => {
	answer = { status: 200, body: JSON.stringify({ tag_name: tag, html_url: "https://example.invalid/elsewhere", assets: assets.map((name) => ({ name, browser_download_url: `https://example.invalid/${name}` })), ...more }) };
};

before(async () => {
	server = http.createServer((req, res) => {
		asked.push({ url: req.url, agent: req.headers["user-agent"], headers: req.headers });
		res.writeHead(answer.status, { "content-type": "application/json" }).end(answer.body);
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	at = `http://127.0.0.1:${(server.address() as AddressInfo).port}/repos/pmndre/pine/releases/latest`;
});

after(() => void server.close());

test("updates: a release is ahead of a lower version and of its own previews, and of nothing else", () => {
	assert.equal(ahead("1.10.0", "1.9.3"), true);
	assert.equal(ahead("1.9.3", "1.10.0"), false);
	assert.equal(ahead("0.39.1", "0.39.1"), false);
	assert.equal(ahead("0.40.0", "0.40.0-next.3"), true);
	assert.equal(ahead("0.39.1", "0.40.0-next.3"), false);
	assert.equal(ahead("1.0.0", "0.99.99"), true);
});

test("updates: a newer release is said with a link to its page on GitHub, whatever the answer calls its address", async () => {
	release("v0.40.0");
	assert.deepEqual(await lookForUpdate("0.39.1", "arm64", at), { status: "newer", mine: "0.39.1", version: "0.40.0", url: `${RELEASES}/tag/v0.40.0` });
	assert.match(RELEASES, /^https:\/\/github\.com\/pmndre\/pine\/releases$/);
	// A preview of that release gets it too; the release itself, and what is ahead of it, do not.
	assert.equal((await lookForUpdate("0.40.0-next.2", "x64", at)).status, "newer");
	assert.deepEqual(await lookForUpdate("0.40.0", "arm64", at), { status: "latest", mine: "0.40.0" });
	assert.equal((await lookForUpdate("0.41.0-next.1", "arm64", at)).status, "latest");
});

test("updates: the question says who asks and nothing about this computer", async () => {
	release("v0.40.0");
	asked.length = 0;
	await lookForUpdate("0.39.1", "arm64", at);
	assert.equal(asked.length, 1);
	assert.equal(asked[0].url, "/repos/pmndre/pine/releases/latest");
	assert.equal(asked[0].agent, "Pine");
	// Neither the version of this app nor anything else of its own goes along.
	assert.doesNotMatch(JSON.stringify(asked[0]), /0\.39\.1|authorization|cookie/i);
});

test("updates: a release counts once the app for this kind of Mac is attached", async () => {
	// pine is published some minutes before its disk images are, and a release whose app could not be built has none.
	release("v0.40.0", []);
	assert.equal((await lookForUpdate("0.39.1", "arm64", at)).status, "latest");
	release("v0.40.0", ["Pine-0.40.0-x64.dmg"]);
	assert.equal((await lookForUpdate("0.39.1", "arm64", at)).status, "latest");
	assert.equal((await lookForUpdate("0.39.1", "x64", at)).status, "newer");
	// An image of another release under this one's name is not this release's app.
	release("v0.40.0", ["Pine-0.39.0-arm64.dmg"]);
	assert.equal((await lookForUpdate("0.39.1", "arm64", at)).status, "latest");
});

test("updates: an answer that is no release says nothing, and none of its words are passed on", async () => {
	for (const tag of ['v1.0.0"><script>alert(1)</script>', "v1.0.0/../../../evil", "1.0.0", "v1.0", "v1.0.0-next.1", "latest", "v1.0.0\nSet-Cookie: x", "v999999.0.0"]) {
		release(tag);
		assert.deepEqual(await lookForUpdate("0.39.1", "arm64", at), { status: "unknown", mine: "0.39.1" }, tag);
	}
	answer = { status: 200, body: JSON.stringify({ tag_name: 7, assets: "none" }) };
	assert.equal((await lookForUpdate("0.39.1", "arm64", at)).status, "unknown");
	answer = { status: 200, body: JSON.stringify({ tag_name: "v1.0.0", assets: [null, 3, { name: 4 }] }) };
	assert.equal((await lookForUpdate("0.39.1", "arm64", at)).status, "latest");
	answer = { status: 200, body: "<html>not json" };
	assert.equal((await lookForUpdate("0.39.1", "arm64", at)).status, "unknown");
	// Asked too often, or no such repository.
	answer = { status: 403, body: JSON.stringify({ tag_name: "v1.0.0", message: "API rate limit exceeded" }) };
	assert.equal((await lookForUpdate("0.39.1", "arm64", at)).status, "unknown");
	answer = { status: 404, body: JSON.stringify({ message: "Not Found" }) };
	assert.equal((await lookForUpdate("0.39.1", "arm64", at)).status, "unknown");
});

test("updates: nobody answering is not an error", async () => {
	const gone = http.createServer();
	await new Promise<void>((r) => gone.listen(0, "127.0.0.1", r));
	const port = (gone.address() as AddressInfo).port;
	await new Promise((r) => gone.close(r));
	assert.deepEqual(await lookForUpdate("0.39.1", "arm64", `http://127.0.0.1:${port}/latest`), { status: "unknown", mine: "0.39.1" });
});
