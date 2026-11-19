// The deployment as a whole: /ssh is the relay, everything else the web client's built files,
// with the headers that keep the bridge from being framed by another site and let the page,
// whose origin is opaque, load its own scripts and styles.
import assert from "node:assert/strict";
import { test } from "node:test";
import { site } from "./site.ts";

/** Static assets as Cloudflare's binding serves them: a few files of the build. */
const ASSETS = {
	fetch: async (input: Request | string) => {
		const path = new URL(typeof input === "string" ? input : input.url).pathname;
		const files: Record<string, [string, string]> = {
			"/": ["text/html", "<!doctype html><title>bridge</title>"],
			"/bridge.js": ["text/javascript", "1"],
			"/page/": ["text/html", "<!doctype html><title>page</title>"],
			"/page/assets/index.js": ["text/javascript", "2"],
			"/page/assets/index.css": ["text/css", "3"],
		};
		const file = files[path];
		return file ? new Response(file[1], { headers: { "content-type": file[0] } }) : new Response("not found", { status: 404 });
	},
};

const relayed: string[] = [];
const handle = site(async (request) => (relayed.push(new URL(request.url).pathname), new Response("relayed")));
const env = { ASSETS, LIMITER: { limit: async () => ({ success: true }) } };
const get = (path: string) => handle(new Request(`https://pine.example${path}`), env as any);

test("/ssh goes to the relay, and nothing else does", async () => {
	assert.equal(await (await get("/ssh?host=a&port=22")).text(), "relayed");
	assert.equal(await (await get("/page/")).text(), "<!doctype html><title>page</title>");
	assert.deepEqual(relayed, ["/ssh"]);
});

test("the bridge's document cannot be framed by anyone, and is not sniffed", async () => {
	const r = await get("/");
	assert.equal(r.status, 200);
	assert.match(r.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
	assert.equal(r.headers.get("x-content-type-options"), "nosniff");
	assert.equal(r.headers.get("access-control-allow-origin"), null);
});

test("the page's files are fetched by an opaque origin: allowed to any origin, framed only by the bridge", async () => {
	for (const path of ["/page/assets/index.js", "/page/assets/index.css"]) assert.equal((await get(path)).headers.get("access-control-allow-origin"), "*", path);
	const page = await get("/page/");
	assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors 'self'/);
	assert.equal(page.headers.get("access-control-allow-origin"), "*");
	// The bridge's own script is not handed to other origins.
	assert.equal((await get("/bridge.js")).headers.get("access-control-allow-origin"), null);
});

test("a file that is not there stays a 404", async () => {
	assert.equal((await get("/nothing")).status, 404);
});
