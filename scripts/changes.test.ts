import assert from "node:assert/strict";
import { test } from "node:test";
import { changesOf } from "./changes.mjs";

test("release: the package says what each version changed, from the commits between its tags", () => {
	// What `git log --first-parent --format=%D%x09%s` prints: a release is tagged at the commit it was made from.
	const log = [
		"HEAD -> main\tfix: the tab bar keeps its place",
		"\tfeat: sources of your own",
		"tag: v0.3.0, origin/main\tfeat: a conversation list",
		"feat/list, tag: v0.2.1\tfix: a link is shown with its target",
		"\tUpdate README",
		"tag: v0.2.0\tfeat!: sources take options",
		"tag: nightly\tthe first commit",
		"",
	].join("\n");
	assert.deepEqual(changesOf(log, "0.4.0"), [
		{ version: "0.4.0", changes: ["fix: the tab bar keeps its place", "feat: sources of your own"] },
		{ version: "0.3.0", changes: ["feat: a conversation list"] },
		{ version: "0.2.1", changes: ["fix: a link is shown with its target", "Update README"] },
		{ version: "0.2.0", changes: ["feat!: sources take options", "the first commit"] },
	]);
	// A build of the commit that is already released adds no empty version, and only the newest ones travel.
	assert.deepEqual(changesOf("tag: v0.3.0\tfeat: a conversation list\n", "0.3.1"), [{ version: "0.3.0", changes: ["feat: a conversation list"] }]);
	assert.deepEqual(changesOf(log, "0.4.0", 2).map((x: any) => x.version), ["0.4.0", "0.3.0"]);
	assert.deepEqual(changesOf("", "0.4.0"), []);
});
