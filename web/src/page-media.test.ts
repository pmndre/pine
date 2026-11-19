// The daemon's media in the page's iframe: a media address becomes an object URL of the bytes the
// web bridge fetched (host.test.ts has the fetching, under the desktop's rules).
import assert from "node:assert/strict";
import { test } from "node:test";
import { mediaUrls } from "./page-media.ts";

test("the page's object URLs: a media address becomes one for its bytes, made once; anything else is left as it is", async () => {
	const asked: string[] = [];
	const made: Blob[] = [];
	const urls = mediaUrls({
		base: "pine-media://daemon",
		media: async (path) => {
			asked.push(path);
			if (path === "/media/tool/gone") throw new Error("not found");
			return { type: "image/png", bytes: new Uint8Array([1, 2]) };
		},
		createObjectURL: (blob) => (made.push(blob), `blob:null/${made.length}`),
		revokeObjectURL: () => {},
	});
	assert.equal(urls.handles("https://example.com/x.png"), false);
	assert.equal(urls.handles("pine-media://daemon/media/tool/t1"), true);
	assert.equal(await urls.resolve("pine-media://daemon/media/tool/t1"), "blob:null/1");
	assert.equal(await urls.resolve("pine-media://daemon/media/tool/t1"), "blob:null/1");
	assert.deepEqual(asked, ["/media/tool/t1"]);
	assert.equal(made[0].type, "image/png");
	assert.equal(await urls.resolve("pine-media://daemon/media/tool/gone"), undefined);
});
