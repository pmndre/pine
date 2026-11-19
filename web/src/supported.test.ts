// A browser whose WebCrypto has no Ed25519 cannot hold the key: it is told so in one sentence that
// names the browsers that work, and nothing else starts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { unsupported } from "./supported.ts";

test("with Ed25519 in WebCrypto there is nothing to say", async () => {
	assert.equal(await unsupported(crypto.subtle), undefined);
});

test("without it, one sentence names the browsers that work", async () => {
	const subtle = {
		generateKey: async (algorithm: { name: string }) => {
			if (algorithm.name === "Ed25519") throw new DOMException("Unrecognized name.", "NotSupportedError");
			throw new Error("only Ed25519 is asked for");
		},
	} as unknown as SubtleCrypto;
	const said = await unsupported(subtle);
	assert.ok(said);
	assert.match(said, /Chrome 137 or later, Firefox 130 or later, or Safari 17 or later\.$/);
	assert.ok(!said.slice(0, -1).includes(". "), "one sentence");
});
