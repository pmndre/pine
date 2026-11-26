import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { fetch } from "undici";
import type { AskQuestions } from "./ask.ts";
import { type DecisionModel, loadConfig, type PineConfig } from "./config.ts";
import { setEnv, unsetEnv } from "./env-file.ts";
import { editJson } from "./mcp-config.ts";
import { listModelServers, serverKey } from "./models.ts";
import { isLocalHost, publicOnlyAgent } from "./net.ts";
import { systemOne } from "./systemone.ts";
import { errText } from "./util.ts";

// Decision models: models that answer typed questions about a text (a probability of yes, one of
// named options, a level) over TypeSafe's API, by the name a route's `ask.model` gives
// (docs/references/events.md, "Typed questions"). They are kept in pine.json under `decisions`, beside
// the chat models of models.json, and are no source: they report nothing. Three places:
//   { server: "studio", model: "decider" }   a model server pine has: its address and key, read at each request
//   { server: "typesafe" }                   TypeSafe's own service (Jev): the key pine was signed in with
//   { url, model, key?, local? }             another server that answers the same way
// What any of them answers is checked against the questions by the router (src/ask.ts).

/** TypeSafe's own service. Its address is fixed here, never in the configuration; only a test moves it. */
export const TYPESAFE = { url: "https://api.typesafe.ai", keyName: "TYPESAFE_API_KEY", console: "https://console.typesafe.ai", model: "jev-latest" };
/** The pauses before a request a server was too busy for (429, 529) is sent again. A test shortens them. */
export const decisionPace = { retries: [500, 1500] };

const NAME = /^[a-z][a-z0-9_-]{0,39}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/** Where a decision model is, in a few words, for lists and the owner's dialog. */
export function whereIs(d: DecisionModel): string {
	if (d.server === "typesafe") return `TypeSafe (api.typesafe.ai)${d.key ? "" : ", not signed in"}`;
	if (d.server) return `the model server ${d.server}`;
	return d.url ? new URL(d.url).host : "?";
}

/** Put typed questions to a decision model by its name. What comes back is unchecked; the router checks it. */
export async function askDecision(cfg: PineConfig, name: string, questions: AskQuestions, data: unknown, signal: AbortSignal): Promise<Record<string, unknown>> {
	const d = cfg.decisions[name];
	if (!d) throw new Error(`there is no decision model "${name}"`);
	let url: string;
	let key: string | undefined;
	let local: boolean;
	if (d.server === "typesafe") {
		if (!d.key) throw new Error(`pine is not signed in to TypeSafe. Your owner signs in under Settings > Models, Decision models, or with: pine login typesafe`);
		url = TYPESAFE.url;
		key = d.key;
		local = isLocalHost(new URL(url).hostname);
	} else if (d.server) {
		// The model server's address and key as they are now: the owner may have changed them since.
		const found = listModelServers(cfg.home).find((s) => s.name === d.server);
		if (!found) throw new Error(`there is no model server "${d.server}" any more, which the decision model "${name}" is on`);
		url = found.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
		key = serverKey(cfg.home, d.server);
		// A model server's address is one the owner confirmed for pine's models, which pi reaches as it is; so does this.
		local = true;
	} else {
		url = d.url!;
		key = d.key;
		local = d.local === true || isLocalHost(new URL(url).hostname);
	}
	const timeoutMs = d.timeoutMs ?? (d.server === "typesafe" ? 20_000 : 120_000);
	const guard = local ? undefined : publicOnlyAgent(timeoutMs);
	try {
		return await systemOne({ url, key, model: d.model, questions, data, signal, timeoutMs, guard, retries: decisionPace.retries, who: d.server === "typesafe" ? "TypeSafe" : `the decision model ${name} (${whereIs(d)})` });
	} finally {
		await guard?.close().catch(() => {});
	}
}

/** Whether TypeSafe takes this key: GET /v1/models. Throws when TypeSafe cannot say. */
export async function typesafeKeyWorks(key: string): Promise<boolean> {
	const local = isLocalHost(new URL(TYPESAFE.url).hostname);
	const guard = local ? undefined : publicOnlyAgent(10_000);
	try {
		const res = await fetch(`${TYPESAFE.url}/v1/models`, { headers: { authorization: `Bearer ${key}` }, redirect: "error", signal: AbortSignal.timeout(10_000), ...(guard ? { dispatcher: guard } : {}) });
		await res.body?.cancel().catch(() => {});
		if (res.status === 401 || res.status === 403) return false;
		if (!res.ok) throw new Error(`TypeSafe answered ${res.status} when asked whether the key is right. Try again in a moment`);
		return true;
	} catch (e) {
		if (e instanceof Error && e.message.startsWith("TypeSafe answered")) throw e;
		throw new Error(`TypeSafe could not be reached to check the key: ${errText(e)}`);
	} finally {
		await guard?.close().catch(() => {});
	}
}

/** Sign pine in to TypeSafe: the key is checked with TypeSafe, then kept in .env, and every decision model at TypeSafe uses it. */
export async function signInTypesafe(cfg: PineConfig, key: string): Promise<void> {
	const value = key.trim();
	if (!value) throw new Error("the key is empty");
	if (!(await typesafeKeyWorks(value))) throw new Error("TypeSafe did not accept that key. Nothing was kept");
	setEnv(cfg.home, { [TYPESAFE.keyName]: value });
	if (value.length >= 8 && !cfg.secrets.includes(value)) cfg.secrets.push(value);
	for (const d of Object.values(cfg.decisions)) if (d.server === "typesafe") d.key = value;
}

/** Sign pine out of TypeSafe. Its decision models stay, and fail until pine is signed in again. */
export function signOutTypesafe(cfg: PineConfig): void {
	unsetEnv(cfg.home, [TYPESAFE.keyName]);
	for (const d of Object.values(cfg.decisions)) if (d.server === "typesafe") delete d.key;
}

/** Whether pine has a TypeSafe key: in .env, where signing in puts it. */
export function typesafeSignedIn(cfg: PineConfig): boolean {
	const file = path.join(cfg.home, ".env");
	return fs.existsSync(file) && Boolean((parseEnv(fs.readFileSync(file, "utf8")) as Record<string, string>)[TYPESAFE.keyName]);
}

/** A decision model as the owner or the main agent proposes it, checked. Returns the entry for pine.json and the lines the owner is shown. */
export function checkDecision(cfg: PineConfig, input: { name: string; server?: string; url?: string; model?: string; local?: boolean }): { entry: Record<string, unknown>; lines: string[]; needsKey: boolean } {
	const name = String(input.name ?? "").trim();
	if (!NAME.test(name)) throw new Error(`"${name}" is not a usable name: lowercase letters, digits, - and _, starting with a letter (a route names it in ask.model)`);
	if (cfg.decisions[name]) throw new Error(`there is a decision model "${name}" already. Remove it first to change it`);
	if (!input.server === !input.url) throw new Error('give "server" (a model server pine has, such as studio, or "typesafe" for TypeSafe) or "url" (another server that speaks TypeSafe\'s API), one of them');
	if (input.model !== undefined && !MODEL.test(String(input.model))) throw new Error(`"${input.model}" is not a model name, such as decider or jev-latest`);
	if (input.server === "typesafe") {
		const model = input.model || TYPESAFE.model;
		return { entry: { server: "typesafe", ...(input.model ? { model } : {}) }, lines: [`the decision model "${name}": TypeSafe's ${model}`, "what a route asks it about (the event's data) goes to TypeSafe at api.typesafe.ai, with pine's TypeSafe key"], needsKey: !typesafeSignedIn(cfg) };
	}
	if (!input.model) throw new Error('"model" is needed: the server\'s name for the decision model, e.g. "decider"');
	if (input.server) {
		const found = listModelServers(cfg.home).find((s) => s.name === input.server);
		if (!found) throw new Error(`there is no model server "${input.server}". ${listModelServers(cfg.home).map((s) => s.name).join(", ") || "There is none"}, or "typesafe" for TypeSafe`);
		return { entry: { server: input.server, model: input.model }, lines: [`the decision model "${name}": the model ${input.model} of the model server ${input.server}`, `what a route asks it about (the event's data) goes to ${new URL(found.baseUrl).host}, with that server's key`], needsKey: false };
	}
	let url: URL;
	try {
		url = new URL(String(input.url));
	} catch {
		throw new Error(`"${input.url}" is not an address, such as http://studio.tail1234.ts.net:8080`);
	}
	if (!["http:", "https:"].includes(url.protocol)) throw new Error("the address must start with http:// or https://");
	if (url.username || url.password || url.search || url.hash) throw new Error("the address is the server's alone: no user name, password or query (a key is asked of your owner)");
	const local = input.local === true || isLocalHost(url.hostname);
	if (url.protocol === "http:" && !local) throw new Error('a server that is not on your owner\'s network is reached over https://. On their network under a name that does not say so (a Tailscale name): "local": true');
	const base = `${url.origin}${url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "")}`;
	return {
		entry: { url: base, model: input.model, ...(input.local === true ? { local: true } : {}) },
		lines: [`the decision model "${name}": the model ${input.model} at ${url.host}`, `what a route asks it about (the event's data) goes to ${url.host}${local ? ", on your network" : ""}`],
		needsKey: false,
	};
}

/** The name in .env of a key for a decision model at an address of its own. */
export const decisionKeyName = (name: string) => `PINE_DECISION_${name.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}_KEY`;

/** Write a checked decision model into pine.json (its key, if any, into .env) and take it over. If the configuration does not load with it, the file is as it was. */
export function addDecision(cfg: PineConfig, name: string, entry: Record<string, unknown>, key?: string): DecisionModel {
	const file = path.join(cfg.home, "pine.json");
	if (key) {
		setEnv(cfg.home, { [decisionKeyName(name)]: key });
		entry = { ...entry, key: `\${${decisionKeyName(name)}}` };
		if (key.length >= 8 && !cfg.secrets.includes(key)) cfg.secrets.push(key);
	}
	editJson(file, (raw) => {
		raw.decisions = raw.decisions && typeof raw.decisions === "object" ? raw.decisions : {};
		raw.decisions[name] = entry;
	});
	const made = loadConfig(cfg.home).decisions[name];
	if (!made) {
		removeDecision(cfg, name);
		throw new Error("not added: it was not found after writing it");
	}
	cfg.decisions[name] = made;
	return made;
}

/** The routes that ask a decision model. */
export const usersOf = (cfg: PineConfig, name: string) => cfg.routes.filter((r) => r.ask?.model === name).map((r) => r.name);

/** Take a decision model out of pine.json (and its key out of .env), also one that was still a typesafe source. */
export function removeDecision(cfg: PineConfig, name: string): boolean {
	const users = usersOf(cfg, name);
	if (users.length) throw new Error(`the route${users.length === 1 ? "" : "s"} ${users.join(", ")} ask${users.length === 1 ? "s" : ""} "${name}". Remove ${users.length === 1 ? "it" : "them"} first`);
	let found = false;
	editJson(path.join(cfg.home, "pine.json"), (raw) => {
		if (raw.decisions?.[name]) {
			delete raw.decisions[name];
			found = true;
			if (!Object.keys(raw.decisions).length) delete raw.decisions;
		}
		if (raw.sources?.[name]?.type === "typesafe") {
			delete raw.sources[name];
			found = true;
		}
	});
	unsetEnv(cfg.home, [decisionKeyName(name)]);
	delete cfg.decisions[name];
	return found;
}

/** The decision models as lines, for the main agent's list. */
export function decisionsText(cfg: PineConfig): string {
	const all = Object.entries(cfg.decisions);
	if (!all.length) return "No decision models. A route with typed questions needs one. The main agent adds one with add_decision_model: a model a model server of pine's serves (such as Pinecone), or TypeSafe's Jev (sign_in typesafe first).";
	return all.map(([name, d]) => `- ${name}: ${d.model}, ${whereIs(d)}${usersOf(cfg, name).length ? ` · asked by the routes ${usersOf(cfg, name).join(", ")}` : ""}`).join("\n");
}
