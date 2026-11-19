// What an answer's Run button may type into the owner's terminal (src/runnable.ts): a block runs
// only when every character of it shows as itself.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runnable } from "./runnable.ts";

test("runnable: a block is run as it is shown, and one that holds what does not show is refused", () => {
	assert.deepEqual(runnable("npm test\n"), { ok: true, text: "npm test" });
	assert.deepEqual(runnable("cd x\r\nls\n\n"), { ok: true, text: "cd x\nls" });
	assert.deepEqual(runnable("for f in *; do\n\techo $f\ndone"), { ok: true, text: "for f in *; do\n\techo $f\ndone" });
	assert.deepEqual(runnable("echo héllo 🌲"), { ok: true, text: "echo héllo 🌲" });
	assert.equal(runnable("  \n").ok, false);
	// An escape sequence, a lone carriage return (which would run what is before it), a backspace, a
	// direction override, a joiner of no width, a line separator and a tag character.
	for (const hidden of ["\x1b[2K", "\r", "\b", "\u202E", "\u200B", "\u2028", "\u{E0041}", "\x00", "\u0085"]) {
		const r = runnable(`echo safe${hidden}rm -rf ~`);
		assert.equal(r.ok, false, JSON.stringify(hidden));
		assert.match((r as { why: string }).why, /does not show as itself \(U\+[0-9A-F]{4,6}\)/);
	}
});
