import { Type } from "typebox";
import { isLocalHost, publicOnlyAgent } from "../net.ts";
import type { SourceType } from "../source-types.ts";
import type { SourceApi } from "../sources.ts";
import { guardFor } from "./stream.ts";
import { systemOne } from "./systemone.ts";

/**
 * A decision model that speaks TypeSafe's API (POST <url>/v1/systemone): answers the typed questions
 * of routes that name this source (`"ask": { "source": "<name>" }`, docs/references/events.md,
 * "Typed questions"). It reports nothing and listens to nothing; it only answers.
 *
 * Without `url` it is TypeSafe's own service, Jev. With `url` it is any server that answers the
 * same way: Pinecone serving a decision model on the owner's Mac, another vendor, an open model
 * behind a server of its own. Which model answers is `model`, as that server names it.
 *
 * options: { url?, model?, key?, local?, timeout? }
 *   url      a server of the owner's own, without /v1: http://studio.tail1234.ts.net:8080. Left out: TypeSafe
 *   model    jev-latest at TypeSafe; at a server of the owner's own, its name for the model ("decider")
 *   key      the API key: TypeSafe's (console.typesafe.ai), or the server's access token. Always asked of
 *            the owner: a server of their own that answers without one (Pinecone does not) would be
 *            reached by anybody on their network, and one that wants one would fail every route
 *   local    the server is on the owner's own network under a name that does not say so (a Tailscale name)
 *   timeout  seconds a request may take: 20 at TypeSafe, 120 at a server that may first load the model
 *
 * The address is TypeSafe's, fixed here (only a test moves `service`), or the one the owner confirmed.
 * The key goes there and nowhere a redirect says, and an address that is not local stays on the public
 * internet (the address guard). What the server answers is turned into pine's answers ({ yes },
 * { choice }, { score }), and the router keeps only what fits the questions (src/ask.ts). Nothing the
 * server writes in an error goes into a status line or an error of pine's: only its status code.
 * docs: https://docs.typesafe.ai/api/system-one.md
 */
export const service = { url: "https://api.typesafe.ai" };
/** The pauses before a request the server was too busy for (429, 529) is sent again. A test shortens them. */
export const pace = { retries: [500, 1500] };

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/** A server address as it is kept: the origin and path, without a trailing /v1. */
const baseOf = (url: URL) => `${url.origin}${url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "")}`;

export const type: SourceType = {
	summary: "a decision model that answers routes' typed questions over TypeSafe's API: Jev at TypeSafe, or with url any server that speaks it (Pinecone on your Mac). Reports nothing",
	decides: (o) => (o.url ? `what a route asks about goes to the server at ${new URL(o.url).host}` : "what a route asks about goes to TypeSafe (api.typesafe.ai)"),
	options: Type.Object(
		{
			url: Type.Optional(Type.String({ description: "a server of your owner's own that speaks TypeSafe's API, without /v1, e.g. http://studio.tail1234.ts.net:8080. Leave out for TypeSafe itself" })),
			model: Type.Optional(Type.String({ description: 'the model that answers: at TypeSafe leave out for jev-latest; at a server of your owner\'s own, its name for the model, e.g. "decider"' })),
			key: Type.String({ description: "the API key: of your owner's TypeSafe account (console.typesafe.ai), or the access token of their own server (for Pinecone, one made in its app)", secret: true }),
			local: Type.Optional(Type.Boolean({ description: "true if the server at url is on your owner's own network under a name that does not say so, such as a Tailscale name. Not needed for an IP address, localhost or a .local name" })),
			timeout: Type.Optional(Type.Integer({ minimum: 5, maximum: 600, description: "how many seconds a request may take, loading the model included. Default 20 at TypeSafe, 120 at a server of your owner's own" })),
		},
		{ additionalProperties: false },
	),
	plan(o, setup) {
		if (setup.key !== setup.name) throw new Error("routes ask only a source of all agents. Set it up for all agents");
		if (o.model !== undefined && !MODEL.test(String(o.model))) throw new Error(`"${o.model}" is not a model name, such as jev-latest or decider`);
		if (o.url === undefined) {
			if (o.local !== undefined) throw new Error('"local" is for a server of your own at "url"; TypeSafe is on the web');
			return {
				options: o,
				does: [`answer the typed questions of routes that name it, with TypeSafe's ${o.model ?? "jev-latest"}`, "what such a route asks about (the event's data) goes to TypeSafe at api.typesafe.ai, with your key"],
				opens: true,
			};
		}
		let url: URL;
		try {
			url = new URL(o.url);
		} catch {
			throw new Error(`"${o.url}" is not an address. A server's looks like http://studio.tail1234.ts.net:8080`);
		}
		if (!["http:", "https:"].includes(url.protocol)) throw new Error("the address must start with http:// or https://");
		if (url.username || url.password) throw new Error('an address with a user name or password in it is not taken: a token goes into "key"');
		if (url.search || url.hash) throw new Error("the address is the server's, without a query");
		if (o.model === undefined) throw new Error(`"model" is needed with "url": the server's name for the model that answers, e.g. "decider"`);
		const local = o.local === true || isLocalHost(url.hostname);
		if (url.protocol === "http:" && !local) throw new Error('a server that is not on your own network must be reached over https://. If it is on your network under a name that does not say so (a Tailscale name), set "local": true');
		const host = url.hostname.replace(/^\[|\]$/g, "");
		const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
		if (setup.controlPort && port === setup.controlPort && ["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("that is pine's own control port, not a decision server");
		return {
			options: { ...o, url: baseOf(url) },
			does: [`answer the typed questions of routes that name it, with the model ${o.model} of the server at ${url.host}`, `what such a route asks about (the event's data) goes to ${url.host}, with the key${local ? ", on your own network" : ""}`],
			opens: true,
		};
	},
};

export default function typesafe(source: SourceApi): void {
	const o = source.options;
	const own = typeof o.url === "string" && o.url ? new URL(o.url) : undefined;
	const key = typeof o.key === "string" && o.key ? o.key : undefined;
	if (!key) throw new Error(`needs "key": ${own ? "the server's access token" : "the API key of a TypeSafe account"}`);
	source.secret(key);
	const model = typeof o.model === "string" && o.model ? o.model : own ? "" : "jev-latest";
	if (!model) throw new Error('needs "model": the server\'s name for the model that answers');
	const timeoutMs = (Number.isInteger(o.timeout) ? o.timeout : own ? 120 : 20) * 1000;
	const url = own ? baseOf(own) : service.url;
	let guard;
	if (own) guard = guardFor(source, own.hostname, o.local, timeoutMs);
	else if (!isLocalHost(new URL(service.url).hostname)) {
		const g = publicOnlyAgent(timeoutMs);
		source.onStop(() => g.close());
		guard = g;
	}
	const who = own ? `the decision server at ${own.host}` : "TypeSafe";
	source.status(`answers with ${model}`);

	source.onDecide(async ({ questions, data, signal }) => {
		try {
			const answers = await systemOne({ url, key, model, questions, data, signal, timeoutMs, guard, retries: pace.retries, who });
			source.status(`answers with ${model}`);
			return answers;
		} catch (e: any) {
			source.status(e?.status === 401 || e?.status === 403 ? `${own ? "the server" : "TypeSafe"} did not accept the key` : e?.status === 404 ? `${own ? "the server" : "TypeSafe"} does not know the model ${model}` : `answers with ${model}; the last request failed${e?.status ? ` (${e.status})` : ""}`);
			throw e;
		}
	});
}
