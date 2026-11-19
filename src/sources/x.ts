import crypto from "node:crypto";
import { Type } from "typebox";
import { Agent, fetch } from "undici";
import { isLocalHost, publicOnlyAgent } from "../net.ts";
import type { SourceType } from "../source-types.ts";
import type { SourceApi } from "../sources.ts";
import { parseSummon } from "../summon.ts";
import { parseDuration } from "../util.ts";
import { capped, clip } from "../watching.ts";

/**
 * The owner's own X account: reports a summon when the owner writes one of the trigger words in
 * a direct message ("@pineabernier kevin summarise this"), with the last messages of that DM
 * conversation as the thread around it.
 *
 * options: { clientId, clientSecret?, account, callback?, triggers?, every?, perMinute?, thread? }
 *   clientId   the OAuth 2.0 client id of an X app the owner made at developer.x.com
 *   account    the owner's handle: a sign-in to any other account is refused
 *   callback   the callback address registered in that app; nothing has to answer there
 *   triggers   the words that make a DM a summon ("/pine")
 *
 * event "summon": { via: "dm", text, id, conversation, at?, link, thread: [{ from, text, at? }], dropped? }
 *
 * Who may summon is decided here and nowhere else: a message is reported only when its sender id,
 * which X sets, is the id of the account that signed in, and it carries a trigger. What anybody
 * else writes is never reported, whatever it says. It is a watcher: it sends nothing, and what it
 * reports (the thread above all) is outside content.
 *
 * Sign-in: OAuth 2.0 with PKCE. pine has no address X could send the browser back to, so the owner
 * opens the address pine shows, signs in at X, and pastes back the address X sent them to. The
 * tokens are kept in the source's own storage, renewed by themselves (each refresh token works
 * once), and forgotten when the source is removed.
 */

/**
 * Where X signs people in and answers. A test puts its stand-in here. They are not options of
 * the source: whoever names these addresses is handed the sign-in, so no agent and no configuration does.
 */
export const hosts = { auth: "https://x.com", api: "https://api.x.com" };
/** How long a question to X may take. */
export const pace = { timeout: 30_000 };

const SCOPE = "tweet.read users.read dm.read offline.access";
/** X's DM events allow 15 looks per 15 minutes for one account: one a minute leaves room. */
const LEAST = "1m";
/** How many of the latest DM events one look asks for. */
const LOOK = 10;
const HANDLE =/^[A-Za-z0-9_]{1,15}$/;
const ID = /^\d{1,25}$/;

/** Something that went wrong, in words of pine's own: what X says never goes into a status line. */
class Said extends Error {
	fatal = false;
}
const said = (message: string, fatal = false) => Object.assign(new Said(message), { fatal });

const triggersOf = (v: unknown): string[] => {
	const list = v === undefined ? ["/pine"] : typeof v === "string" ? v.split(/[\s,]+/) : Array.isArray(v) ? v.map(String) : [];
	return list.map((w) => w.trim()).filter(Boolean);
};

export const type: SourceType = {
	summary: "your owner's own X (Twitter) account: reports a summon when your owner writes a trigger word (\"/pine\", \"@handle\") in an X direct message, with the DM conversation around it. Reads only; posts nothing",
	options: Type.Object(
		{
			clientId: Type.String({ description: "the OAuth 2.0 Client ID of the X app your owner made at developer.x.com (Keys and tokens). Ask your owner for it; it is not a secret" }),
			clientSecret: Type.Optional(Type.String({ description: "the Client Secret of that app, only when it is a confidential client (a \"Web App\"). Leave it out for a \"Native App\"", secret: true })),
			account: Type.String({ description: "your owner's X handle, without @, e.g. abernier. A sign-in to any other account is refused" }),
			callback: Type.Optional(Type.String({ description: 'the Callback URI set in the X app. Default "http://localhost/pine": nothing has to answer there, your owner copies the address from the browser' })),
			triggers: Type.Optional(Type.Array(Type.String(), { description: 'the words that make a DM of your owner\'s a summon, e.g. ["/pine", "@pineabernier"]. Default ["/pine"]' })),
			every: Type.Optional(Type.String({ description: 'how often to look at the DMs. Default "2m", at least "1m" (X allows 15 looks in 15 minutes)' })),
			perMinute: Type.Optional(Type.Number({ description: "at most this many summons a minute. Default 5; what comes on top is dropped and counted" })),
			thread: Type.Optional(Type.Number({ description: "how many earlier messages of the DM conversation come with a summon. Default 10, at most 50" })),
		},
		{ additionalProperties: false },
	),
	plan(o) {
		const clientId = String(o.clientId ?? "").trim();
		if (!/^[A-Za-z0-9_-]{8,100}$/.test(clientId)) throw new Error('"clientId" is the OAuth 2.0 Client ID of your owner\'s X app (developer.x.com, the app\'s "Keys and tokens"). Ask your owner for it; it is not a secret');
		const account = String(o.account ?? "").trim().replace(/^@/, "");
		if (!HANDLE.test(account)) throw new Error('"account" is your owner\'s X handle without @, e.g. abernier: letters, digits and _ only, at most 15');
		const callback = String(o.callback ?? "http://localhost/pine");
		let cb: URL;
		try {
			cb = new URL(callback);
		} catch {
			throw new Error('"callback" is the Callback URI set in the X app, e.g. http://localhost/pine');
		}
		if (cb.protocol !== "http:" && cb.protocol !== "https:") throw new Error('"callback" starts with http:// or https://');
		const triggers = triggersOf(o.triggers);
		if (!triggers.length || triggers.some((w) => /\s/.test(w))) throw new Error('"triggers" is a list of words without spaces, e.g. ["/pine", "@pineabernier"]');
		const every = String(o.every ?? "2m");
		if (!(parseDuration(every) >= parseDuration(LEAST))) throw new Error(`"every" must be at least "${LEAST}": X allows 15 looks at the DMs in 15 minutes`);
		if (o.perMinute !== undefined && !(o.perMinute >= 1 && o.perMinute <= 60)) throw new Error('"perMinute" is a number from 1 to 60');
		if (o.thread !== undefined && !(Number.isInteger(o.thread) && o.thread >= 0 && o.thread <= 50)) throw new Error('"thread" is a whole number from 0 to 50');
		return {
			options: { ...o, clientId, account, triggers },
			opens: true,
			does: [
				`ask your owner to sign in to X as @${account}, once, with the X app ${clientId}: read access to posts, the profile and direct messages, nothing that writes`,
				`look at @${account}'s direct messages every ${every} and report the ones @${account} wrote that contain ${triggers.map((w) => `"${w}"`).join(" or ")}, with the conversation around them. What others write is never reported on its own`,
				"X charges the X app's account for every DM it reads (about $0.01 each)",
			],
		};
	},
};

interface Kept {
	refresh: string;
	client: string;
	id: string;
	username: string;
}

export default function x(source: SourceApi) {
	const o = source.options;
	const clientId = String(o.clientId ?? "").trim();
	const secret = o.clientSecret ? String(o.clientSecret) : undefined;
	source.secret(secret);
	const account = String(o.account ?? "").trim().replace(/^@/, "");
	const callback = String(o.callback ?? "http://localhost/pine");
	const triggers = triggersOf(o.triggers);
	const thread = Math.min(Math.max(0, Number(o.thread ?? 10)), 50);
	const cap = capped(Math.min(Math.max(1, Number(o.perMinute ?? 5)), 60));
	if (!clientId || !HANDLE.test(account)) throw new Error('needs "clientId" and "account" (the owner\'s X handle)');

	// Connections of the source's own, gone with it. X's address never leads to the owner's network;
	// only a test's stand-in, moved onto this computer, is reached without that guard.
	const dispatcher = isLocalHost(new URL(hosts.api).hostname) ? new Agent({ connectTimeout: pace.timeout }) : publicOnlyAgent(pace.timeout);
	source.onStop(() => dispatcher.destroy().catch(() => {}));

	/** A question to X's API. Tokens go to `hosts.api` and nowhere else; a redirect is never followed. */
	const ask = async (path: string, init: { method?: string; token?: string; form?: Record<string, string> }, signal: AbortSignal) => {
		const url = new URL(path, hosts.api);
		const headers: Record<string, string> = {};
		if (init.token) headers.authorization = `Bearer ${init.token}`;
		else if (secret) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(secret)}`).toString("base64")}`;
		if (init.form) headers["content-type"] = "application/x-www-form-urlencoded";
		let res: Awaited<ReturnType<typeof fetch>>;
		try {
			res = await fetch(url, {
				method: init.method ?? "GET",
				headers,
				body: init.form ? new URLSearchParams(init.form).toString() : undefined,
				redirect: "error",
				signal: AbortSignal.any([signal, AbortSignal.timeout(pace.timeout)]),
				dispatcher,
			});
		} catch {
			if (signal.aborted) throw said("stopped");
			throw said("X could not be reached");
		}
		const body: any = await res.json().catch(() => ({}));
		return { status: res.status, body: body ?? {} };
	};

	let now: { token: string; until: number } | undefined;
	// A "no" is not asked about twice while the source runs.
	let refused = false;
	let asking: string | undefined;
	const kept = () => {
		const k = source.kv.get<Kept | null>("signin");
		return k && k.client === clientId && k.username.toLowerCase() === account.toLowerCase() ? k : undefined;
	};
	const say = () => {
		const k = kept();
		source.status(k ? `signed in to X as @${k.username}; reports your DMs that contain ${triggers.join(" or ")}` : "waiting for you to sign in at X: answer pine's question");
	};
	say();
	source.onStop(() => {
		const open = source.approvals.pending().find((r) => r.summary === asking);
		if (open) source.approvals.decide(open.id, false, "pine");
	});

	/** Keep what X gave: the refresh token replaces the one it was renewed with, which works only once. */
	const keep = (t: any, who: { id: string; username: string }): string => {
		if (typeof t.refresh_token === "string" && t.refresh_token) source.kv.set("signin", { refresh: t.refresh_token, client: clientId, id: who.id, username: who.username } satisfies Kept);
		else source.log.warn('X gave no way to renew the sign-in: it will have to be made again in two hours. The X app lacks "offline.access"');
		now = { token: String(t.access_token), until: Date.now() + (Number(t.expires_in) > 0 ? Number(t.expires_in) : 7200) * 1000 };
		return now.token;
	};

	const signIn = async (signal: AbortSignal): Promise<{ token: string; id: string; username: string }> => {
		if (refused) throw said("nobody is signed in to X: you answered no. To be asked again: unsubscribe and subscribe again, or restart pine", true);
		const verifier = crypto.randomBytes(32).toString("base64url");
		const state = crypto.randomBytes(16).toString("base64url");
		const page = new URL("/i/oauth2/authorize", hosts.auth);
		for (const [k, v] of Object.entries({ response_type: "code", client_id: clientId, redirect_uri: callback, scope: SCOPE, state, code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" })) page.searchParams.set(k, v);
		const summary = `sign in to X as @${account}\nOpen ${page.href} in your browser and sign in as @${account}. X then sends you to ${callback}, which may show an error page: copy the whole address from the browser's address bar and paste it here.`;
		asking = summary;
		source.status(`waiting for you to sign in to X as @${account}: answer pine's question`);
		const answer = await source.approvals.request(summary, "pine reads your X direct messages to find your summons; it gets no right to post or to send. pine does not see your password", [{ name: "address", label: "the address X sent your browser to (it contains code= and state=)", secret: true }]).finally(() => (asking = undefined));
		if (!answer.allow) {
			if (answer.by === "timeout" || answer.by === "pine") throw said("nobody signed in to X in time: you are asked again at the next look");
			refused = true;
			throw said("nobody is signed in to X: you answered no. To be asked again: unsubscribe and subscribe again, or restart pine", true);
		}
		let back: URL;
		try {
			back = new URL(String(answer.values?.address ?? "").trim());
		} catch {
			throw said("what you pasted is not an address: you are asked again at the next look");
		}
		// The state proves that the code came from this sign-in, and not from one somebody else started.
		if (back.searchParams.get("state") !== state) throw said("the address you pasted did not come from this sign-in (its state is another): you are asked again at the next look");
		const code = back.searchParams.get("code");
		if (!code) throw said("the address you pasted has no code: X did not sign you in. You are asked again at the next look");
		const t = await ask("/2/oauth2/token", { method: "POST", form: { grant_type: "authorization_code", code, redirect_uri: callback, code_verifier: verifier, client_id: clientId } }, signal);
		if (typeof t.body.access_token !== "string" || !t.body.access_token) throw said(`X did not take the code (HTTP ${t.status}). Check "clientId", "clientSecret" and that "callback" is the app's Callback URI; you are asked again at the next look`);
		const me = await ask("/2/users/me", { token: t.body.access_token }, signal);
		const id = String(me.body?.data?.id ?? "");
		const username = String(me.body?.data?.username ?? "");
		if (!ID.test(id) || !HANDLE.test(username)) throw said(`X did not say who signed in (HTTP ${me.status}); you are asked again at the next look`);
		if (username.toLowerCase() !== account.toLowerCase()) throw said(`you signed in to X as another account than @${account}: sign in as @${account}. You are asked again at the next look`);
		const token = keep(t.body, { id, username });
		source.log.info(`signed in to X as @${username}`);
		say();
		return { token, id, username };
	};

	/** What to ask X with right now: kept while it is good, renewed when it is not, asked of the owner when there is nothing to renew. */
	const token = async (signal: AbortSignal): Promise<{ token: string; id: string; username: string }> => {
		const k = kept();
		if (k && now && now.until - Date.now() > 120_000) return { token: now.token, id: k.id, username: k.username };
		now = undefined;
		if (k) {
			const t = await ask("/2/oauth2/token", { method: "POST", form: { grant_type: "refresh_token", refresh_token: k.refresh, client_id: clientId } }, signal);
			if (typeof t.body.access_token === "string" && t.body.access_token) return { token: keep(t.body, k), id: k.id, username: k.username };
			// Only X saying no lets go of the sign-in. X being unwell does not.
			if (t.status !== 400 && t.status !== 401) throw said(`X did not renew the sign-in (HTTP ${t.status})`);
			source.kv.set("signin", null);
			source.log.info("X no longer takes the sign-in (signed out, the app's access revoked, or unused for too long): asking again");
			say();
		}
		return signIn(signal);
	};

	const fields = "dm_event.fields=id,text,event_type,created_at,sender_id,dm_conversation_id&event_types=MessageCreate&expansions=sender_id&user.fields=username";
	const newer = (a: string, b: string) => BigInt(a) > BigInt(b);

	/** DM events as X lists them, oldest first, with the handles of their senders. Throws in pine's words. */
	const dms = async (me: { token: string }, path: string, signal: AbortSignal) => {
		const r = await ask(path, { token: me.token }, signal);
		if (r.status === 429) throw said("X says pine looks too often (HTTP 429): waiting longer between looks");
		if (r.status >= 500) throw said(`X is not answering properly (HTTP ${r.status}): waiting longer between looks`);
		if (r.status === 401) return undefined;
		if (r.status === 403) throw said("X refused to show the DMs (HTTP 403): the X app needs the Direct Messages permission and a project with access to the API");
		if (r.status !== 200) throw said(`X did not show the DMs (HTTP ${r.status})`);
		const list: any[] = (Array.isArray(r.body.data) ? r.body.data : []).filter((d: any) => ID.test(String(d?.id ?? "")) && d.event_type === "MessageCreate" && typeof d.text === "string");
		list.sort((a, b) => (newer(a.id, b.id) ? 1 : -1));
		for (const u of Array.isArray(r.body.includes?.users) ? r.body.includes.users : []) if (ID.test(String(u?.id)) && HANDLE.test(String(u?.username))) names.set(String(u.id), `@${u.username}`);
		return list;
	};
	const names = new Map<string, string>();

	source.poll(o.every ?? "2m", async (signal) => {
		let me = await token(signal);
		// X charges for every DM event it hands over: a look asks for the last few, enough for one person between two looks.
		const look = `/2/dm_events?${fields}&max_results=${LOOK}`;
		let all = await dms(me, look, signal);
		if (!all) {
			// Taken back before its time: renewed once, right away.
			now = undefined;
			me = await token(signal);
			all = await dms(me, look, signal);
			if (!all) throw said("X refused the sign-in it had just renewed (HTTP 401)");
		}
		// "0" for no DMs at all: a starting point too, so that the first DM after it is news.
		const newest = (all.at(-1)?.id as string | undefined) ?? "0";
		const last = source.kv.get<string>("last");
		if (newest === last) return;
		source.kv.set("last", newest);
		// The first look is the starting point: what was written before pine looked is not news.
		if (last === undefined) return;
		for (const d of all) {
			if (!newer(d.id, last)) continue;
			// The one check that says who may summon: the sender, as X says it, is the account that signed in.
			if (String(d.sender_id) !== me.id) continue;
			if (!parseSummon(d.text, triggers, [])) continue;
			if (!cap.ok()) continue;
			const conversation = String(d.dm_conversation_id ?? "");
			// The thread: that conversation's messages before the summon, asked of X only now that there is one.
			let around = all;
			if (thread && /^[\w-]{1,80}$/.test(conversation)) around = (await dms(me, `/2/dm_conversations/${conversation}/dm_events?${fields}&max_results=${Math.min(100, thread + 10)}`, signal).catch(() => undefined)) ?? all;
			const before = around.filter((m) => m.dm_conversation_id === d.dm_conversation_id && newer(d.id, m.id)).slice(-thread);
			const dropped = cap.dropped();
			source.emit("summon", {
				via: "dm",
				text: clip(d.text),
				id: d.id,
				conversation,
				...(typeof d.created_at === "string" ? { at: d.created_at } : {}),
				link: `https://x.com/messages/${encodeURIComponent(conversation)}`,
				thread: before.map((m) => ({ from: names.get(String(m.sender_id)) ?? `X user ${String(m.sender_id).replace(/\D/g, "")}`, text: clip(m.text, 1000), ...(typeof m.created_at === "string" ? { at: m.created_at } : {}) })),
				...(dropped ? { dropped } : {}),
			});
		}
	});
}
