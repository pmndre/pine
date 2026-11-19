// The Android version of a release: what the release job hands the Gradle build.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { versionCode } from "./version-code.ts";

test("versionCode is major * 1 000 000 + minor * 1 000 + patch", () => {
	assert.equal(versionCode("0.38.0"), 38000);
	assert.equal(versionCode("0.38.12"), 38012);
	assert.equal(versionCode("1.2.3"), 1002003);
	assert.equal(versionCode("12.0.999"), 12000999);
});

test("a later release always has a larger versionCode", () => {
	const order = ["0.9.999", "0.10.0", "0.999.999", "1.0.0", "1.0.1", "2.0.0"];
	const codes = order.map(versionCode);
	assert.deepEqual([...codes].sort((a, b) => a - b), codes);
	assert.equal(new Set(codes).size, codes.length);
});

test("what is not the version of a release is refused", () => {
	for (const bad of ["", "1.2", "1.2.3-next.4", "v1.2.3", "1.1000.0", "1.0.1000", "2101.0.0", "0.0.0"]) {
		assert.throws(() => versionCode(bad), /version/, bad);
	}
});

test("run as a command it prints the code, for the release job", () => {
	const script = path.join(import.meta.dirname, "version-code.ts");
	assert.equal(execFileSync(process.execPath, [script, "0.38.2"], { encoding: "utf8" }).trim(), "38002");
});
