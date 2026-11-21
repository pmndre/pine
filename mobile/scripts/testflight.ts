// What happens to an iOS build on TestFlight once it is uploaded to App Store Connect: waits until
// App Store Connect has processed it, sets its "What to Test", and then for a release (`latest`)
// adds it to the external group with the public link and submits it to Beta App Review, for a
// preview (`next`) adds it to the internal group. A build already in its group, or already
// submitted, is a success: a rebuild of a release from its tag runs this again.
// scripts/upload.ts calls `distribute` itself once the build is uploaded; the command below is
// for running a distribution by hand, for a build that is on App Store Connect already:
//   node scripts/testflight.ts --key AuthKey_ABC123DEFG.p8 --key-id ABC123DEFG --issuer-id <uuid> \
//     --version 0.39.0 --build 39999 --channel latest --notes "feat: ..."
// The key may be given as content in ASC_KEY instead of --key (the Release workflow's secret), and
// the ids as ASC_KEY_ID and ASC_ISSUER_ID; the bundle id is --bundle-id, or IOS_BUNDLE_ID (the
// workflow's repository variable), or else BUNDLE_ID. Node's own modules only; the key is never printed.
// The API's shapes are Apple's OpenAPI spec of App Store Connect (developer.apple.com, "App Store
// Connect API"); test/testflight.test.ts runs this against a stand-in that answers in them.
import crypto from "node:crypto";
import fs from "node:fs";
import { parseArgs } from "node:util";

export type Key = { pem: string; keyId: string; issuerId: string };
export type Channel = "latest" | "next";

/** The app's bundle id, as in ios/App/App.xcodeproj: the default, which --bundle-id or IOS_BUNDLE_ID replaces. */
export const BUNDLE_ID = "dev.pmndre.pine";
/** The external TestFlight group with the public link: every release from `main`. */
export const EXTERNAL_GROUP = "Public";
/** The internal TestFlight group, the maintainers' own devices: every preview from `next`. */
export const INTERNAL_GROUP = "Maintainers";

const API = "https://api.appstoreconnect.apple.com";
const LOCALE = "en-US";
// Apple refuses a token that lives over 20 minutes; a fresh one is made for every request.
const LIFETIME_SEC = 10 * 60;
// TestFlight takes at most 4000 characters of "What to Test".
const NOTES_LIMIT = 4000;

const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** An App Store Connect API token: an ES256 JWT signed with the key's `.p8`. */
export function token(key: Key, now: number): string {
	const iat = Math.floor(now / 1000);
	const data = `${part({ alg: "ES256", kid: key.keyId, typ: "JWT" })}.${part({ iss: key.issuerId, iat, exp: iat + LIFETIME_SEC, aud: "appstoreconnect-v1" })}`;
	// JOSE wants the signature as r and s side by side, not DER.
	const signature = crypto.sign("sha256", Buffer.from(data), { key: key.pem, dsaEncoding: "ieee-p1363" });
	return `${data}.${signature.toString("base64url")}`;
}

export type Options = {
	key: Key;
	bundleId: string;
	/** CFBundleShortVersionString, X.Y.Z. */
	version: string;
	/** CFBundleVersion, the build number. */
	build: string;
	channel: Channel;
	/** TestFlight's "What to Test". */
	notes: string;
	/** Where the API answers: Apple's, or a stand-in in a test. */
	base?: string;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	/** How long to wait between two looks at a build that is not processed yet. */
	intervalMs?: number;
	/** How long to wait for the build in all before giving up. */
	timeoutMs?: number;
	log?: (line: string) => void;
};

type Resource = { type: string; id: string; attributes?: Record<string, unknown> };
type ApiErrorEntry = { status?: string; code?: string; title?: string; detail?: string };

// What to do about an error answer, where there is something to say.
function advice(status: number, errors: ApiErrorEntry[]): string {
	const codes = errors.map((e) => e.code ?? "").join(" ");
	if (status === 401) return "Check the key id, the issuer id and the key file: they must be one App Store Connect API key of the team, not revoked.";
	// Admin, not App Manager: the cloud-managed distribution signing of scripts/upload.ts needs
	// it, and one key serves both.
	if (status === 403) return "The API key needs the Admin role in App Store Connect (Users and Access > Integrations): make a key with it, then run this again.";
	if (codes.includes("CONTRACT")) return "Accept the current agreements in App Store Connect (Business) and the Program License Agreement at developer.apple.com, then run this again.";
	if (status === 429) return "App Store Connect limits how often it is called: run this again in an hour.";
	if (status >= 500) return "App Store Connect failed on its side: run this again later.";
	return "";
}

class ApiError extends Error {
	status: number;
	errors: ApiErrorEntry[];
	constructor(status: number, call: string, text: string) {
		let errors: ApiErrorEntry[] = [];
		try {
			errors = JSON.parse(text).errors ?? [];
		} catch {}
		const said = errors.map((e) => [e.code, e.detail ?? e.title].filter(Boolean).join(": ")).join("; ") || text.slice(0, 300);
		super([`App Store Connect answered ${status} to ${call}: ${said}.`, advice(status, errors)].filter(Boolean).join(" "));
		this.status = status;
		this.errors = errors;
	}
}

// Apple documents no error code for "the build is already there"; a check runs before each of
// these calls, and a conflict that says "already" (two runs at once) is taken as done too.
async function already(action: () => Promise<unknown>) {
	try {
		await action();
	} catch (e) {
		if (e instanceof ApiError && e.status === 409 && e.errors.some((x) => /already/i.test(`${x.detail} ${x.title}`))) return;
		throw e;
	}
}

/** The key's content, checked to be a private key before anything is signed with it. */
export function privateKey(pem: string): string {
	try {
		crypto.createPrivateKey(pem);
	} catch {
		// Not the key in the message: it is a secret even when it is malformed.
		throw new Error("The key is not a private key: give the AuthKey_<id>.p8 file App Store Connect gave for the API key, as it was downloaded.");
	}
	return pem;
}

export async function distribute(options: Options): Promise<void> {
	const base = options.base ?? API;
	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const log = options.log ?? ((line: string) => console.log(line));
	const intervalMs = options.intervalMs ?? 30_000;
	const timeoutMs = options.timeoutMs ?? 30 * 60_000;
	const named = `build ${options.build} of ${options.version}`;

	async function call(method: string, path: string, body?: object): Promise<{ data?: Resource | Resource[] } | undefined> {
		const response = await fetch(base + path, {
			method,
			headers: { authorization: `Bearer ${token(options.key, now())}`, ...(body ? { "content-type": "application/json" } : {}) },
			body: body ? JSON.stringify(body) : undefined,
		});
		const text = await response.text();
		if (!response.ok) throw new ApiError(response.status, `${method} ${path.split("?")[0]}`, text);
		return text ? JSON.parse(text) : undefined;
	}
	const list = async (path: string) => ((await call("GET", path))?.data ?? []) as Resource[];
	const query = (params: Record<string, string>) => new URLSearchParams(params).toString();

	const [app] = await list(`/v1/apps?${query({ "filter[bundleId]": options.bundleId })}`);
	if (!app) throw new Error(`App Store Connect has no app with the bundle id ${options.bundleId} that this key can see: create the app record in App Store Connect (Apps > New App) on the team of the key.`);

	// A build is listed only some minutes after its upload, then PROCESSING until it is VALID.
	const buildQuery = query({ "filter[app]": app.id, "filter[version]": options.build, "filter[preReleaseVersion.version]": options.version, "filter[preReleaseVersion.platform]": "IOS" });
	const start = now();
	let build: Resource | undefined;
	let said = "";
	for (;;) {
		[build] = await list(`/v1/builds?${buildQuery}`);
		const state = String(build?.attributes?.processingState ?? "not listed yet");
		if (state === "VALID") break;
		if (state === "FAILED" || state === "INVALID") {
			throw new Error(`App Store Connect could not process ${named} (${state}): read the e-mail Apple sent the account holder about it, fix the build and upload it again with a new build number.`);
		}
		if (state !== said) log(`Waiting for ${named}: ${state}.`);
		said = state;
		if (now() - start >= timeoutMs) {
			throw new Error(`${named[0].toUpperCase()}${named.slice(1)} is not processed in App Store Connect after ${Math.round(timeoutMs / 60_000)} minutes (${state}): check that the upload succeeded with this version and build number, then run this again.`);
		}
		await sleep(intervalMs);
	}
	const buildId = build.id;
	log(`${named[0].toUpperCase()}${named.slice(1)} is processed.`);

	const whatsNew = options.notes.slice(0, NOTES_LIMIT);
	const [localization] = (await list(`/v1/builds/${buildId}/betaBuildLocalizations`)).filter((l) => l.attributes?.locale === LOCALE);
	if (localization) {
		await call("PATCH", `/v1/betaBuildLocalizations/${localization.id}`, { data: { type: "betaBuildLocalizations", id: localization.id, attributes: { whatsNew } } });
	} else {
		await call("POST", "/v1/betaBuildLocalizations", { data: { type: "betaBuildLocalizations", attributes: { locale: LOCALE, whatsNew }, relationships: { build: { data: { type: "builds", id: buildId } } } } });
	}
	log(`What to Test is set.`);

	const name = options.channel === "latest" ? EXTERNAL_GROUP : INTERNAL_GROUP;
	const [group] = await list(`/v1/betaGroups?${query({ "filter[app]": app.id, "filter[name]": name })}`);
	if (!group) {
		const where = options.channel === "latest" ? "TestFlight > External Testing, with its public link on" : "TestFlight > Internal Testing";
		throw new Error(`The app ${options.bundleId} has no TestFlight group named "${name}": create it in App Store Connect (${where}) under exactly that name, then run this again.`);
	}
	if (group.attributes?.hasAccessToAllBuilds) {
		log(`Build ${options.build} is in the group ${name}, which gets every build by itself.`);
	} else if ((await list(`/v1/builds?${query({ "filter[id]": buildId, "filter[betaGroups]": group.id })}`)).length > 0) {
		log(`Build ${options.build} was already in the group ${name}.`);
	} else {
		await already(() => call("POST", `/v1/betaGroups/${group.id}/relationships/builds`, { data: [{ type: "builds", id: buildId }] }));
		log(`Build ${options.build} is in the group ${name}.`);
	}
	if (options.channel !== "latest") return;

	if ((await list(`/v1/betaAppReviewSubmissions?${query({ "filter[build]": buildId })}`)).length > 0) {
		log(`Build ${options.build} was already submitted to Beta App Review.`);
	} else {
		await already(() => call("POST", "/v1/betaAppReviewSubmissions", { data: { type: "betaAppReviewSubmissions", relationships: { build: { data: { type: "builds", id: buildId } } } } }));
		log(`Build ${options.build} is submitted to Beta App Review.`);
	}
	const link = group.attributes?.publicLink;
	if (link) log(`Public link: ${link}`);
}

const USAGE = `Usage: node scripts/testflight.ts --key <AuthKey.p8> --key-id <id> --issuer-id <uuid>
  --version <X.Y.Z> --build <number> --channel <latest|next> --notes <What to Test> [--bundle-id <id>]
The key's content may be in ASC_KEY instead of --key, the ids in ASC_KEY_ID and ASC_ISSUER_ID,
the bundle id in IOS_BUNDLE_ID (default ${BUNDLE_ID}).`;

async function main() {
	const { values } = parseArgs({
		options: {
			key: { type: "string" },
			"key-id": { type: "string" },
			"issuer-id": { type: "string" },
			"bundle-id": { type: "string" },
			version: { type: "string" },
			build: { type: "string" },
			channel: { type: "string" },
			notes: { type: "string" },
			// Where the API answers, for a stand-in; Apple's by default.
			api: { type: "string" },
		},
	});
	const keyId = values["key-id"] ?? process.env.ASC_KEY_ID;
	const issuerId = values["issuer-id"] ?? process.env.ASC_ISSUER_ID;
	const bundleId = values["bundle-id"] || process.env.IOS_BUNDLE_ID || BUNDLE_ID;
	const { version, build, channel, notes } = values;
	const pem = values.key ? fs.readFileSync(values.key, "utf8") : process.env.ASC_KEY;
	const missing = Object.entries({ "--key or ASC_KEY": pem, "--key-id": keyId, "--issuer-id": issuerId, "--version": version, "--build": build, "--channel": channel, "--notes": notes }).filter(([, v]) => !v).map(([k]) => k);
	if (missing.length > 0) throw new Error(`Missing ${missing.join(", ")}.\n${USAGE}`);
	if (channel !== "latest" && channel !== "next") throw new Error(`--channel is latest (a release from main) or next (a preview), not "${channel}".`);
	if (!/^\d+\.\d+\.\d+$/.test(version!)) throw new Error(`--version is X.Y.Z (CFBundleShortVersionString), not "${version}".`);
	if (!/^\d+$/.test(build!)) throw new Error(`--build is a number (CFBundleVersion), not "${build}".`);
	privateKey(pem!);
	await distribute({ key: { pem: pem!, keyId: keyId!, issuerId: issuerId! }, bundleId, version: version!, build: build!, channel, notes: notes!, base: values.api });
}

if (import.meta.main) {
	main().catch((e: Error) => {
		console.error(e.message);
		process.exit(1);
	});
}
