// TestFlight distribution after upload, against a stand-in for the App Store Connect API on a
// loopback port that answers in the shapes of Apple's OpenAPI spec. No test reaches Apple.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { distribute, EXTERNAL_GROUP, INTERNAL_GROUP, privateKey, token } from "../scripts/testflight.ts";

const pair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pem = pair.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const key = { pem, keyId: "ABC123DEFG", issuerId: "57246542-96fe-1a63-e053-0824d011072a" };

function decode(part: string) {
	return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

test("the token carries the key id, the issuer, App Store Connect's audience and a short expiry, signed ES256", () => {
	const jwt = token(key, 1_700_000_000_000);
	const [header, payload, signature] = jwt.split(".");
	assert.deepEqual(decode(header), { alg: "ES256", kid: "ABC123DEFG", typ: "JWT" });
	const claims = decode(payload);
	assert.equal(claims.iss, key.issuerId);
	assert.equal(claims.aud, "appstoreconnect-v1");
	assert.equal(claims.iat, 1_700_000_000);
	assert.ok(claims.exp > claims.iat && claims.exp - claims.iat <= 20 * 60, "Apple refuses a token that lives over 20 minutes");
	const ok = crypto.verify("sha256", Buffer.from(`${header}.${payload}`), { key: pair.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
	assert.ok(ok, "the signature verifies with the key's public half");
});

// The stand-in for App Store Connect: one app, its builds, groups, localizations and review
// submissions, in the JSON:API shapes of Apple's spec. A build answers each look with the next of
// its states (`states`), and is not listed at all for its first `hiddenFor` looks, as a build
// still on its way from the upload is not. `fail` makes one call answer an error.
type Build = { id: string; version: string; marketing: string; states: string[]; hiddenFor?: number };
type Group = { id: string; name: string; isInternalGroup: boolean; hasAccessToAllBuilds?: boolean };
type Fake = {
	builds: Build[];
	groups: Group[];
	inGroup: Map<string, Set<string>>;
	localizations: { id: string; build: string; locale: string; whatsNew: string | null }[];
	submissions: { id: string; build: string; betaReviewState: string }[];
	fail: Map<string, { status: number; errors: object[] }>;
	calls: string[];
};

const notFound = (detail: string) => ({ errors: [{ status: "404", code: "NOT_FOUND", title: "The specified resource does not exist", detail }] });

async function standIn(t: test.TestContext, setup: Partial<Fake> = {}) {
	const fake: Fake = {
		builds: [{ id: "build-1", version: "39001", marketing: "0.39.0", states: ["PROCESSING", "PROCESSING", "VALID"] }],
		groups: [
			{ id: "group-public", name: EXTERNAL_GROUP, isInternalGroup: false },
			{ id: "group-maintainers", name: INTERNAL_GROUP, isInternalGroup: true, hasAccessToAllBuilds: false },
			{ id: "group-other", name: "Friends", isInternalGroup: false },
		],
		inGroup: new Map(),
		localizations: [],
		submissions: [],
		fail: new Map(),
		calls: [],
		...setup,
	};
	const looks = new Map<string, number>();
	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", "http://stand-in");
		const call = `${req.method} ${url.pathname}`;
		fake.calls.push(call);
		let raw = "";
		for await (const chunk of req) raw += chunk;
		const body = raw ? JSON.parse(raw) : undefined;
		const send = (status: number, value?: object) => {
			res.writeHead(status, value ? { "content-type": "application/json" } : {});
			res.end(value ? JSON.stringify(value) : undefined);
		};
		const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
		const [h, p, sig] = auth.split(".");
		if (!sig || !crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key: pair.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))) {
			return send(401, { errors: [{ status: "401", code: "NOT_AUTHORIZED", title: "Authentication credentials are missing or invalid.", detail: "Provide a properly configured and signed bearer token." }] });
		}
		const failure = fake.fail.get(call);
		if (failure) return send(failure.status, { errors: failure.errors });
		const q = (name: string) => url.searchParams.get(name);
		const buildOf = (b: Build) => {
			const n = looks.get(b.id) ?? 0;
			looks.set(b.id, n + 1);
			const seen = n - (b.hiddenFor ?? 0);
			if (seen < 0) return undefined;
			const state = b.states[Math.min(seen, b.states.length - 1)];
			return { type: "builds", id: b.id, attributes: { version: b.version, processingState: state, expired: false } };
		};
		const groupOf = (g: Group) => ({
			type: "betaGroups",
			id: g.id,
			attributes: { name: g.name, isInternalGroup: g.isInternalGroup, hasAccessToAllBuilds: g.hasAccessToAllBuilds ?? false, publicLinkEnabled: !g.isInternalGroup, publicLink: g.isInternalGroup ? null : `https://testflight.apple.com/join/${g.id}` },
		});
		const path = url.pathname;
		let m: RegExpExecArray | null;
		if (call === "GET /v1/apps") {
			return send(200, { data: q("filter[bundleId]") === "dev.pmndre.pine" ? [{ type: "apps", id: "app-1", attributes: { bundleId: "dev.pmndre.pine", name: "Pine" } }] : [] });
		}
		if (call === "GET /v1/builds") {
			const group = q("filter[betaGroups]");
			if (group) {
				const id = q("filter[id]") ?? "";
				return send(200, { data: fake.inGroup.get(group)?.has(id) ? [{ type: "builds", id }] : [] });
			}
			assert.equal(q("filter[app]"), "app-1");
			assert.equal(q("filter[preReleaseVersion.platform]"), "IOS");
			const found = fake.builds.filter((b) => b.version === q("filter[version]") && b.marketing === q("filter[preReleaseVersion.version]"));
			return send(200, { data: found.map(buildOf).filter(Boolean) });
		}
		if ((m = /^\/v1\/builds\/([^/]+)\/betaBuildLocalizations$/.exec(path)) && req.method === "GET") {
			const id = m[1];
			return send(200, { data: fake.localizations.filter((l) => l.build === id).map((l) => ({ type: "betaBuildLocalizations", id: l.id, attributes: { locale: l.locale, whatsNew: l.whatsNew } })) });
		}
		if (call === "POST /v1/betaBuildLocalizations") {
			assert.equal(body.data.type, "betaBuildLocalizations");
			const l = { id: `loc-${fake.localizations.length + 1}`, build: body.data.relationships.build.data.id, locale: body.data.attributes.locale, whatsNew: body.data.attributes.whatsNew };
			fake.localizations.push(l);
			return send(201, { data: { type: "betaBuildLocalizations", id: l.id, attributes: { locale: l.locale, whatsNew: l.whatsNew } } });
		}
		if ((m = /^\/v1\/betaBuildLocalizations\/([^/]+)$/.exec(path)) && req.method === "PATCH") {
			const id = m[1];
			const l = fake.localizations.find((x) => x.id === id);
			if (!l) return send(404, notFound("no such localization"));
			assert.equal(body.data.type, "betaBuildLocalizations");
			assert.equal(body.data.id, id);
			l.whatsNew = body.data.attributes.whatsNew;
			return send(200, { data: { type: "betaBuildLocalizations", id: l.id, attributes: { locale: l.locale, whatsNew: l.whatsNew } } });
		}
		if (call === "GET /v1/betaGroups") {
			assert.equal(q("filter[app]"), "app-1");
			return send(200, { data: fake.groups.filter((g) => !q("filter[name]") || g.name === q("filter[name]")).map(groupOf) });
		}
		if ((m = /^\/v1\/betaGroups\/([^/]+)\/relationships\/builds$/.exec(path)) && req.method === "POST") {
			const id = m[1];
			if (!fake.groups.some((g) => g.id === id)) return send(404, notFound("no such group"));
			const ids = fake.inGroup.get(id) ?? new Set<string>();
			for (const b of body.data) {
				assert.equal(b.type, "builds");
				ids.add(b.id);
			}
			fake.inGroup.set(id, ids);
			return send(204);
		}
		if (call === "GET /v1/betaAppReviewSubmissions") {
			assert.ok(q("filter[build]"), "Apple requires filter[build]");
			const found = fake.submissions.filter((s) => s.build === q("filter[build]"));
			return send(200, { data: found.map((s) => ({ type: "betaAppReviewSubmissions", id: s.id, attributes: { betaReviewState: s.betaReviewState } })) });
		}
		if (call === "POST /v1/betaAppReviewSubmissions") {
			assert.equal(body.data.type, "betaAppReviewSubmissions");
			const s = { id: `sub-${fake.submissions.length + 1}`, build: body.data.relationships.build.data.id, betaReviewState: "WAITING_FOR_REVIEW" };
			fake.submissions.push(s);
			return send(201, { data: { type: "betaAppReviewSubmissions", id: s.id, attributes: { betaReviewState: s.betaReviewState } } });
		}
		send(404, notFound(`the stand-in has no ${call}`));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return { fake, base };
}

// A clock that moves only when the script waits, so a half-hour wait takes no time.
function clock() {
	let at = 1_700_000_000_000;
	return { now: () => at, sleep: async (ms: number) => void (at += ms) };
}

function options(base: string, more: Partial<Parameters<typeof distribute>[0]> = {}): Parameters<typeof distribute>[0] {
	return { key, bundleId: "dev.pmndre.pine", version: "0.39.0", build: "39001", channel: "next", notes: "feat: the app is on TestFlight", base, log: () => {}, ...clock(), ...more };
}

test("next: a build is waited for until processed, gets its What to Test, and goes to the internal group alone", async (t) => {
	const { fake, base } = await standIn(t);
	await distribute(options(base));
	assert.deepEqual(fake.localizations.map((l) => [l.build, l.locale, l.whatsNew]), [["build-1", "en-US", "feat: the app is on TestFlight"]]);
	assert.deepEqual([...(fake.inGroup.get("group-maintainers") ?? [])], ["build-1"]);
	assert.equal(fake.inGroup.get("group-public"), undefined);
	assert.equal(fake.inGroup.get("group-other"), undefined);
	assert.deepEqual(fake.submissions, []);
	assert.ok(fake.calls.filter((c) => c === "GET /v1/builds").length >= 3, "it looked until the build was VALID");
});

test("latest: the build goes to the public group and is submitted to Beta App Review", async (t) => {
	const { fake, base } = await standIn(t, { builds: [{ id: "build-9", version: "39999", marketing: "0.39.0", states: ["VALID"] }] });
	const lines: string[] = [];
	await distribute(options(base, { channel: "latest", build: "39999", log: (line) => lines.push(line) }));
	assert.deepEqual([...(fake.inGroup.get("group-public") ?? [])], ["build-9"]);
	assert.equal(fake.inGroup.get("group-maintainers"), undefined);
	assert.deepEqual(fake.submissions.map((s) => s.build), ["build-9"]);
	assert.equal(fake.localizations[0].whatsNew, "feat: the app is on TestFlight");
	assert.ok(lines.some((l) => l.includes("https://testflight.apple.com/join/group-public")), "it says the public link");
});

test("a build already in its group and already submitted is a success, and its What to Test is updated", async (t) => {
	const { fake, base } = await standIn(t, { builds: [{ id: "build-9", version: "39999", marketing: "0.39.0", states: ["VALID"] }] });
	const run = (notes: string) => distribute(options(base, { channel: "latest", build: "39999", notes }));
	await run("first");
	fake.calls.length = 0;
	await run("second");
	assert.deepEqual(fake.submissions.map((s) => s.build), ["build-9"], "submitted once");
	assert.deepEqual(fake.localizations.map((l) => l.whatsNew), ["second"], "one localization, updated");
	assert.ok(!fake.calls.includes("POST /v1/betaAppReviewSubmissions"));
	assert.ok(!fake.calls.includes("POST /v1/betaGroups/group-public/relationships/builds"));
});

test("an answer that the build is already there is a success too, as when two runs race", async (t) => {
	const already = (detail: string) => ({ status: 409, errors: [{ status: "409", code: "ENTITY_ERROR", title: "The request entity is not valid.", detail }] });
	const { fake, base } = await standIn(t, {
		builds: [{ id: "build-9", version: "39999", marketing: "0.39.0", states: ["VALID"] }],
		fail: new Map([
			["POST /v1/betaGroups/group-public/relationships/builds", already("The build is already in this beta group.")],
			["POST /v1/betaAppReviewSubmissions", already("A beta app review submission already exists for this build.")],
		]),
	});
	await distribute(options(base, { channel: "latest", build: "39999" }));
	assert.ok(fake.calls.includes("POST /v1/betaAppReviewSubmissions"));
});

test("a build that never shows up is given up on after the wait, saying what to check", async (t) => {
	const { fake, base } = await standIn(t, { builds: [] });
	await assert.rejects(distribute(options(base, { timeoutMs: 30 * 60_000, intervalMs: 30_000 })), /build 39001 of 0\.39\.0 .*30 minutes.*upload/i);
	const looks = fake.calls.filter((c) => c === "GET /v1/builds").length;
	assert.ok(looks > 50 && looks < 70, `it looked every 30 seconds for 30 minutes (${looks} looks)`);
});

test("a build that appears late is still waited for", async (t) => {
	const { fake, base } = await standIn(t, { builds: [{ id: "build-1", version: "39001", marketing: "0.39.0", states: ["PROCESSING", "VALID"], hiddenFor: 4 }] });
	await distribute(options(base));
	assert.deepEqual([...(fake.inGroup.get("group-maintainers") ?? [])], ["build-1"]);
});

test("a build that App Store Connect could not process fails at once", async (t) => {
	const { fake, base } = await standIn(t, { builds: [{ id: "build-1", version: "39001", marketing: "0.39.0", states: ["PROCESSING", "INVALID"] }] });
	await assert.rejects(distribute(options(base)), (e: Error) => e.message.includes("INVALID") && /upload it again/.test(e.message));
	assert.equal(fake.calls.filter((c) => c === "GET /v1/builds").length, 2);
});

test("a group that does not exist is named, with where to create it", async (t) => {
	const { base } = await standIn(t, { groups: [] });
	await assert.rejects(distribute(options(base)), (e: Error) => e.message.includes(`"${INTERNAL_GROUP}"`) && /TestFlight/.test(e.message));
});

test("an app that does not exist is named", async (t) => {
	const { base } = await standIn(t);
	await assert.rejects(distribute(options(base, { bundleId: "dev.pmndre.nope" })), /dev\.pmndre\.nope/);
});

test("an error answer is reported with Apple's code and what to do", async (t) => {
	const { base } = await standIn(t, {
		builds: [{ id: "build-9", version: "39999", marketing: "0.39.0", states: ["VALID"] }],
		fail: new Map([["POST /v1/betaAppReviewSubmissions", { status: 422, errors: [{ status: "422", code: "ENTITY_UNPROCESSABLE.BETA_CONTRACT_MISSING", title: "Beta contract is missing.", detail: "Beta contract is missing for the app." }] }]]),
	});
	await assert.rejects(distribute(options(base, { channel: "latest", build: "39999" })), (e: Error) => /422/.test(e.message) && /BETA_CONTRACT_MISSING/.test(e.message) && /agreement/i.test(e.message));
});

test("a key without the role is told it needs Admin, which signing in the cloud requires", async (t) => {
	const { base } = await standIn(t, { fail: new Map([["GET /v1/apps", { status: 403, errors: [{ status: "403", code: "FORBIDDEN_ERROR", title: "This request is forbidden for security reasons", detail: "The API key in use does not allow this request" }] }]]) });
	await assert.rejects(distribute(options(base)), (e: Error) => /403/.test(e.message) && /Admin role/.test(e.message) && !/App Manager/.test(e.message));
});

test("a key is checked to be a private key without the key in the message", () => {
	assert.equal(privateKey(pem), pem);
	const broken = pem.replace(pem.split("\n")[2], "nonsense");
	assert.throws(() => privateKey(broken), (e: Error) => /not a private key/.test(e.message) && !e.message.includes(pem.split("\n")[1]));
	assert.throws(() => privateKey(""), /not a private key/);
});

test("a key App Store Connect refuses is reported as such", async (t) => {
	const { base } = await standIn(t);
	const other = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
	await assert.rejects(distribute(options(base, { key: { ...key, pem: other } })), (e: Error) => /401/.test(e.message) && /key id/i.test(e.message) && !e.message.includes(other));
});

// The command as the Release workflow runs it. Run without waiting on it (the stand-in answers in
// this process), and never with the key in what it prints, on success or on failure.
const script = path.join(import.meta.dirname, "../scripts/testflight.ts");
function cli(args: string[], env: Record<string, string> = {}) {
	return new Promise<{ code: number | null; out: string }>((resolve) => {
		const child = execFile(process.execPath, [script, ...args], { env: { PATH: process.env.PATH ?? "", ...env } }, (error, stdout, stderr) => {
			resolve({ code: error ? (child.exitCode ?? 1) : 0, out: stdout + stderr });
		});
	});
}
const secretLines = pem.split("\n").filter((l) => l && !l.startsWith("-----"));
const leaks = (out: string) => secretLines.some((l) => out.includes(l));

test("run as a command with a key file, it distributes the build and says so", async (t) => {
	const { fake, base } = await standIn(t, { builds: [{ id: "build-9", version: "39999", marketing: "0.39.0", states: ["VALID"] }] });
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "testflight-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const file = path.join(dir, "AuthKey_ABC123DEFG.p8");
	fs.writeFileSync(file, pem);
	const { code, out } = await cli(["--api", base, "--key", file, "--key-id", key.keyId, "--issuer-id", key.issuerId, "--version", "0.39.0", "--build", "39999", "--channel", "latest", "--notes", "feat: x"]);
	assert.equal(code, 0, out);
	assert.deepEqual(fake.submissions.map((s) => s.build), ["build-9"]);
	assert.match(out, /Public link: https:\/\/testflight\.apple\.com\/join\/group-public/);
	assert.ok(!leaks(out));
});

test("run as a command with the key in ASC_KEY, a failure exits non-zero without the key in it", async (t) => {
	const { base } = await standIn(t, { groups: [], builds: [{ id: "build-1", version: "39001", marketing: "0.39.0", states: ["VALID"] }] });
	const { code, out } = await cli(["--api", base, "--version", "0.39.0", "--build", "39001", "--channel", "next", "--notes", "x"], { ASC_KEY: pem, ASC_KEY_ID: key.keyId, ASC_ISSUER_ID: key.issuerId });
	assert.equal(code, 1);
	assert.match(out, new RegExp(`no TestFlight group named "${INTERNAL_GROUP}"`));
	assert.ok(!leaks(out));
});

test("run as a command, what is missing or wrong is said before anything is called", async () => {
	const missing = await cli(["--version", "0.39.0"]);
	assert.equal(missing.code, 1);
	assert.match(missing.out, /--key or ASC_KEY.*--key-id.*--issuer-id/);
	const channel = await cli(["--version", "0.39.0", "--build", "1", "--channel", "main", "--notes", "x", "--key-id", "a", "--issuer-id", "b"], { ASC_KEY: pem });
	assert.match(channel.out, /--channel is latest .* or next/);
	const broken = pem.replace(secretLines[1], "nonsense");
	const bad = await cli(["--version", "0.39.0", "--build", "1", "--channel", "next", "--notes", "x", "--key-id", "a", "--issuer-id", "b"], { ASC_KEY: broken });
	assert.equal(bad.code, 1);
	assert.match(bad.out, /not a private key/);
	assert.ok(!secretLines.some((l) => l !== secretLines[1] && bad.out.includes(l)), "not even a broken key is printed");
});

test("an internal group that has every build already is not added to", async (t) => {
	const { fake, base } = await standIn(t, { groups: [{ id: "group-maintainers", name: INTERNAL_GROUP, isInternalGroup: true, hasAccessToAllBuilds: true }] });
	await distribute(options(base));
	assert.ok(!fake.calls.some((c) => c.startsWith("POST /v1/betaGroups/")));
});
