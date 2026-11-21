// The Android version of a release, what the release job hands the Gradle build, and the iOS
// version of a release or a preview, what it hands xcodebuild.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { iosVersion, versionCode } from "../scripts/version-code.ts";

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
	const script = path.join(import.meta.dirname, "../scripts/version-code.ts");
	assert.equal(execFileSync(process.execPath, [script, "0.38.2"], { encoding: "utf8" }).trim(), "38002");
});

test("a release's iOS build number is its versionCode * 1000 + 999", () => {
	assert.deepEqual(iosVersion("0.38.0"), { short: "0.38.0", build: 38000999 });
	assert.deepEqual(iosVersion("1.2.3"), { short: "1.2.3", build: 1002003999 });
});

test("a preview's iOS build number ends in its N, its short version is the release it leads to", () => {
	assert.deepEqual(iosVersion("0.38.0-next.1"), { short: "0.38.0", build: 38000001 });
	assert.deepEqual(iosVersion("0.38.0-next.42"), { short: "0.38.0", build: 38000042 });
	assert.deepEqual(iosVersion("0.38.0-next.998"), { short: "0.38.0", build: 38000998 });
});

test("a release sorts after all its previews, and before the next version's", () => {
	const order = ["0.37.5", "0.38.0-next.1", "0.38.0-next.2", "0.38.0-next.998", "0.38.0", "0.38.1-next.1", "0.38.1", "1.0.0-next.1"];
	const builds = order.map((v) => iosVersion(v).build);
	assert.deepEqual([...builds].sort((a, b) => a - b), builds);
	assert.equal(new Set(builds).size, builds.length);
});

test("an N out of 1..998 or what is no release or preview is refused, saying what is expected", () => {
	for (const bad of ["0.38.0-next.0", "0.38.0-next.999", "0.38.0-next.1000"]) {
		assert.throws(() => iosVersion(bad), /1 to 998/, bad);
	}
	for (const bad of ["", "1.2", "v1.2.3", "1.2.3-next", "1.2.3-next.", "1.2.3-beta.1", "1.2.3-next.1.2", "1.1000.0-next.1", "0.0.0"]) {
		assert.throws(() => iosVersion(bad), /version/, bad);
	}
});
