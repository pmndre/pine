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
 * conversation as the thread around it, or in a post (a reply in a thread), with the post it
 * replies to. It can be read for more of a DM conversation or a post thread the owner took part in.
 *
 * options: { clientId, clientSecret?, account, callback?, triggers?, every?, perMinute?, thread? }
 *   clientId   the OAuth 2.0 client id of an X app the owner made at developer.x.com
 *   account    the owner's handle: a sign-in to any other account is refused
 *   callback   the callback address registered in that app; nothing has to answer there
 *   triggers   the words that make a DM or a post a summon ("/pine")
 *
 * event "summon": { via: "dm" | "mention", text, id, conversation, replyTo?, at?, link, thread: [{ from, text, at? }], dropped? }
 *   via "mention": a post; id is the post's, conversation the first post of its thread, replyTo the post it answers
 *
 * read: { conversation } a DM conversation the owner wrote in, { post } the thread up from a post,
 * when the owner wrote one of its posts; anything else is refused here.
 *
 * Who may summon is decided here and nowhere else: a message or a post is reported only when its
 * sender or author id, which X sets, is the id of the account that signed in, and it carries a trigger. What anybody
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
/** How many of the latest DM events one look asks for at a time. */
const LOOK = 10;
/** How many pages of LOOK a look goes back for the DM events since the last one; what lies further is said, not looked at. */
const PAGES = 5;
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
	summons: true,
	summary: "your owner's own X (Twitter) account: reports a summon when your owner writes a trigger word (\"/pine\", \"@handle\") in an X DM or post, with the thread around it. Reads only; posts nothing",
	options: Type.Object(
		{
			clientId: Type.String({ description: "the OAuth 2.0 Client ID of the X app your owner made at developer.x.com (Keys and tokens). Ask your owner for it; it is not a secret" }),
			clientSecret: Type.Optional(Type.String({ description: "the Client Secret of that app, only when it is a confidential client (a \"Web App\"). Leave it out for a \"Native App\"", secret: true })),
			account: Type.String({ description: "your owner's X handle, without @, e.g. abernier. A sign-in to any other account is refused" }),
			callback: Type.Optional(Type.String({ description: 'the Callback URI set in the X app. Default "http://localhost/pine": nothing has to answer there, your owner copies the address from the browser' })),
			triggers: Type.Optional(Type.Array(Type.String(), { description: 'the words that make a DM or a post of your owner\'s a summon, e.g. ["/pine", "@pineabernier"]. Default ["/pine"]' })),
			every: Type.Optional(Type.String({ description: 'how often to look at the DMs and posts. Default "2m", at least "1m" (X allows 15 looks in 15 minutes)' })),
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
				`look at @${account}'s direct messages and posts every ${every} and report the ones @${account} wrote that contain ${triggers.map((w) => `"${w}"`).join(" or ")}, with the conversation or the post they reply to. What others write is never reported on its own`,
				"let your agents read more of a DM conversation or a post thread @" + account + " took part in, and none other",
				"X charges the X app's account for every DM it reads (about $0.01 each) and for every post of @" + account + "'s it reads (about $0.001 each)",
			],
		};
	},
	reads: 'more of where a summon came from: {"conversation": "..."} the last messages of a DM conversation (the "conversation" of a summon from a DM), {"post": "..."} the thread up from a post (the "id" of a summon from a post); "limit" up to 50. Only where your owner took part',
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
	// The last time a look could not go back as far as the look before: said until the source stops.
	let gap: string | undefined;
	const say = () => {
		const k = kept();
		source.status(k ? `signed in to X as @${k.username}; reports your DMs and posts that contain ${triggers.join(" or ")}${gap ? `. ${gap}` : ""}` : "waiting for you to sign in at X: answer pine's question");
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
		const answer = await source.approvals.request(summary, "pine reads your X direct messages and your own posts to find your summons; it gets no right to post or to send. pine does not see your password", [{ name: "address", label: "the address X sent your browser to (it contains code= and state=)", secret: true }]).finally(() => (asking = undefined));
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
	const token = (signal: AbortSignal, signing = true): Promise<{ token: string; id: string; username: string }> => {
		// One at a time: a refresh token works once, so a read and a look must not both spend it.
		const turn = queue.then(() => renew(signal, signing));
		queue = turn.catch(() => {});
		return turn;
	};
	let queue: Promise<unknown> = Promise.resolve();
	const renew = async (signal: AbortSignal, signing: boolean): Promise<{ token: string; id: string; username: string }> => {
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
		if (!signing) throw said("nobody is signed in to X: your owner answers pine's question at the next look", true);
		return signIn(signal);
	};

	const fields = "dm_event.fields=id,text,event_type,created_at,sender_id,dm_conversation_id&event_types=MessageCreate&expansions=sender_id&user.fields=username";
	const newer = (a: string, b: string) => BigInt(a) > BigInt(b);

	/** DM events as X lists them, oldest first, with the handles of their senders, and X's token for the page before. Throws in pine's words. */
	const dms = async (me: { token: string }, path: string, signal: AbortSignal) => {
		const r = await ask(path, { token: me.token }, signal);
		if (r.status === 429) throw said("X says pine looks too often (HTTP 429): waiting longer between looks");
		if (r.status >= 500) throw said(`X is not answering properly (HTTP ${r.status}): waiting longer between looks`);
		if (r.status === 401) return undefined;
		if (r.status === 403) throw said("X refused to show the DMs (HTTP 403): the X app needs the Direct Messages permission and a project with access to the API");
		if (r.status !== 200) throw said(`X did not show the DMs (HTTP ${r.status})`);
		const list: any[] = (Array.isArray(r.body.data) ? r.body.data : []).filter((d: any) => ID.test(String(d?.id ?? "")) && d.event_type === "MessageCreate" && typeof d.text === "string");
		list.sort((a, b) => (newer(a.id, b.id) ? 1 : -1));
		named(r.body);
		const next = typeof r.body.meta?.next_token === "string" && /^[\w-]{1,200}$/.test(r.body.meta.next_token) ? (r.body.meta.next_token as string) : undefined;
		return { list, next };
	};
	const names = new Map<string, string>();
	/** Keep the handles X named in an answer. */
	const named = (body: any) => {
		for (const u of Array.isArray(body?.includes?.users) ? body.includes.users : []) if (ID.test(String(u?.id)) && HANDLE.test(String(u?.username))) names.set(String(u.id), `@${u.username}`);
	};

	/** The author of a post or a DM as a handle when X named it, an id otherwise. */
	const fromOf = (id: unknown) => names.get(String(id)) ?? `X user ${String(id).replace(/\D/g, "")}`;
	const at = (m: any) => (typeof m.created_at === "string" ? { at: m.created_at } : {});
	const line = (m: any, length = 1000) => ({ from: fromOf(m.sender_id ?? m.author_id), text: clip(String(m.text ?? ""), length), ...at(m) });
	/** A trigger, and room under the cap that DMs and posts share. */
	const summons = (text: string) => !!parseSummon(text, triggers, []) && cap.ok();

	/** The DMs since the last look. false: the token was taken back. */
	const lookAtDms = async (me: { token: string; id: string }, signal: AbortSignal) => {
		// X charges for every DM event it hands over: a look asks for the last few, and goes back a page
		// at a time, a few pages at most, until it reaches what the last look saw.
		const last = source.kv.get<string>("last");
		let all: any[] = [];
		let next: string | undefined;
		let pages = 0;
		let reached = false;
		do {
			const page = await dms(me, `/2/dm_events?${fields}&max_results=${LOOK}${next ? `&pagination_token=${next}` : ""}`, signal);
			if (!page) return false;
			all = [...page.list, ...all];
			next = page.next;
			pages++;
			// The first look is the starting point: one page of it is enough.
			reached = last === undefined || page.list.some((d) => !newer(d.id, last));
		} while (!reached && next && pages < PAGES);
		all.sort((a, b) => (newer(a.id, b.id) ? 1 : -1));
		if (!reached && next) {
			// Counts and a time only: nothing X wrote goes into a status line.
			gap = `at ${new Date().toISOString().slice(11, 16)} UTC more than ${all.length} DM events came since the last look: the older ones were not looked at for summons`;
			source.log.warn(gap);
			say();
		}
		// "0" for no DMs at all: a starting point too, so that the first DM after it is news.
		const newest = (all.at(-1)?.id as string | undefined) ?? "0";
		if (newest === last) return true;
		source.kv.set("last", newest);
		// The first look is the starting point: what was written before pine looked is not news.
		if (last === undefined) return true;
		for (const d of all) {
			if (!newer(d.id, last)) continue;
			// The one check that says who may summon: the sender, as X says it, is the account that signed in.
			if (String(d.sender_id) !== me.id) continue;
			if (!summons(d.text)) continue;
			const conversation = String(d.dm_conversation_id ?? "");
			// The thread: that conversation's messages before the summon, asked of X only now that there is one.
			let around = all;
			if (thread && /^[\w-]{1,80}$/.test(conversation)) around = (await dms(me, `/2/dm_conversations/${conversation}/dm_events?${fields}&max_results=${Math.min(100, thread + 10)}`, signal).catch(() => undefined))?.list ?? all;
			const before = around.filter((m) => m.dm_conversation_id === d.dm_conversation_id && newer(d.id, m.id)).slice(-thread);
			const dropped = cap.dropped();
			source.emit("summon", {
				via: "dm",
				text: clip(d.text),
				id: d.id,
				conversation,
				...at(d),
				link: `https://x.com/messages/${encodeURIComponent(conversation)}`,
				thread: before.map((m) => line(m)),
				...(dropped ? { dropped } : {}),
			});
		}
		return true;
	};

	const postFields = "tweet.fields=id,text,author_id,created_at,conversation_id,referenced_tweets&expansions=author_id,referenced_tweets.id,referenced_tweets.id.author_id&user.fields=username";
	/** Posts as X lists them, with the posts they refer to. Throws in pine's words; undefined: the token was taken back. */
	const posts = async (me: { token: string }, path: string, signal: AbortSignal) => {
		const r = await ask(path, { token: me.token }, signal);
		if (r.status === 429) throw said("X says pine looks too often (HTTP 429): waiting longer between looks");
		if (r.status >= 500) throw said(`X is not answering properly (HTTP ${r.status}): waiting longer between looks`);
		if (r.status === 401) return undefined;
		if (r.status !== 200) throw said(`X did not show the posts (HTTP ${r.status})`);
		named(r.body);
		const shown = (p: any) => !!p && ID.test(String(p.id ?? "")) && typeof p.text === "string";
		const referred = new Map<string, any>();
		for (const p of Array.isArray(r.body.includes?.tweets) ? r.body.includes.tweets : []) if (shown(p)) referred.set(String(p.id), p);
		const data: any[] = (Array.isArray(r.body.data) ? r.body.data : r.body.data ? [r.body.data] : []).filter(shown);
		return { data, referred };
	};
	const refersTo = (p: any, kind: string): string | undefined => {
		const ref = (Array.isArray(p?.referenced_tweets) ? p.referenced_tweets : []).find((t: any) => t?.type === kind);
		return ref && ID.test(String(ref.id)) ? String(ref.id) : undefined;
	};

	/**
	 * The owner's own posts since the last look. X's mentions timeline lists what others wrote about
	 * the owner, and a summon is a post the owner wrote: so it is the owner's own timeline that is
	 * looked at, replies included and retweets left out. since_id keeps a look to what is new.
	 */
	const lookAtPosts = async (me: { token: string; id: string }, signal: AbortSignal) => {
		const since = source.kv.get<string>("posts");
		// The first look only finds the starting point: X lists no fewer than 5.
		const r = await posts(me, `/2/users/${me.id}/tweets?${postFields}&exclude=retweets&max_results=${since === undefined ? 5 : LOOK}${since && since !== "0" ? `&since_id=${since}` : ""}`, signal);
		if (!r) return false;
		const list = r.data.sort((a, b) => (newer(a.id, b.id) ? 1 : -1));
		const newest = list.at(-1)?.id as string | undefined;
		// "0" for no posts at all: a starting point too, so that the first post after it is news.
		if (newest && (!since || newer(newest, since))) source.kv.set("posts", newest);
		else if (since === undefined) source.kv.set("posts", "0");
		// The first look is the starting point: what was posted before pine looked is not news.
		if (since === undefined) return true;
		for (const p of list) {
			if (since !== "0" && !newer(p.id, since)) continue;
			// The one check that says who may summon: the author, as X says it, is the account that signed in.
			if (String(p.author_id) !== me.id) continue;
			// A retweet is somebody else's words.
			if (refersTo(p, "retweeted")) continue;
			if (!summons(p.text)) continue;
			const parent = refersTo(p, "replied_to");
			const above = parent ? r.referred.get(parent) : undefined;
			const dropped = cap.dropped();
			source.emit("summon", {
				via: "mention",
				text: clip(p.text),
				id: p.id,
				conversation: ID.test(String(p.conversation_id)) ? String(p.conversation_id) : p.id,
				...(parent ? { replyTo: parent } : {}),
				...at(p),
				link: `https://x.com/${encodeURIComponent(account)}/status/${p.id}`,
				thread: thread && above ? [line(above)] : [],
				...(dropped ? { dropped } : {}),
			});
		}
		return true;
	};

	// DMs and posts in one look: one pace, one backoff, and the cap above shared.
	source.poll(o.every ?? "2m", async (signal) => {
		let me = await token(signal);
		if (!(await lookAtDms(me, signal)) || !(await lookAtPosts(me, signal))) {
			// Taken back before its time: renewed once, right away.
			now = undefined;
			me = await token(signal);
			if (!(await lookAtDms(me, signal)) || !(await lookAtPosts(me, signal))) throw said("X refused the sign-in it had just renewed (HTTP 401)");
		}
	});

	// ---- reading: more of a DM conversation or a post thread, only where the owner took part ----------
	const ended = new AbortController();
	source.onStop(() => ended.abort());
	const READ_MAX = 50;
	const UP_MAX = 20;
	source.onRead(async (q) => {
		if (!kept()) throw new Error("nobody is signed in to X yet: your owner answers pine's question first");
		const signal = AbortSignal.any([ended.signal, AbortSignal.timeout(pace.timeout * 2)]);
		const limit = Math.max(1, Math.min(q.limit !== undefined && Number.isInteger(Number(q.limit)) ? Number(q.limit) : 20, READ_MAX));
		if (q.conversation !== undefined && q.conversation !== "") {
			const conversation = String(q.conversation).trim();
			if (!/^[\w-]{1,80}$/.test(conversation)) throw new Error('"conversation" is the "conversation" of a summon from a DM, e.g. "1001-2002"');
			const me = await token(signal, false);
			const list = (await dms(me, `/2/dm_conversations/${conversation}/dm_events?${fields}&max_results=${Math.min(100, Math.max(limit, 5))}`, signal))?.list;
			if (!list) throw new Error("X did not take the sign-in: try again in a minute");
			// Reading goes as far as the owner went: a conversation the owner wrote in, and no other.
			if (!list.some((m) => String(m.sender_id) === me.id)) throw new Error('your owner did not write in that conversation, so it is not read. Use the "conversation" of a summon');
			const shown = list.slice(-limit);
			return `The last ${shown.length} messages of the DM conversation ${conversation}, oldest first.\n\n${shown.map((m) => {
				const one = line(m, 1500);
				return `[${one.at ?? ""}] ${one.from}: ${one.text}`;
			}).join("\n")}`;
		}
		if (q.post !== undefined && q.post !== "") {
			const post = String(q.post).trim();
			if (!ID.test(post)) throw new Error('"post" is the id of a post, as the "id" of a summon from a post had it: digits only');
			const me = await token(signal, false);
			// Up the replies, from that post towards the first: X hands over a post and the one it replies to in one answer.
			const chain: any[] = [];
			const most = Math.min(limit, UP_MAX);
			let next: string | undefined = post;
			while (next && chain.length < most) {
				const r = await posts(me, `/2/tweets/${next}?${postFields}`, signal);
				if (!r) throw new Error("X did not take the sign-in: try again in a minute");
				const p = r.data[0];
				if (!p) break;
				chain.push(p);
				const up = refersTo(p, "replied_to");
				const parent = up ? r.referred.get(up) : undefined;
				if (parent && chain.length < most) chain.push(parent);
				next = parent ? refersTo(parent, "replied_to") : undefined;
			}
			if (!chain.length) throw new Error(`X shows no post ${post}: it was deleted, or it is not visible to your owner`);
			// Reading goes as far as the owner went: a thread with a post of the owner's in it, and no other.
			if (!chain.some((p) => String(p.author_id) === me.id)) throw new Error('your owner took no part in that thread, so it is not read. Use the "id" of a summon from a post');
			chain.reverse();
			return `The thread up to the post ${post}, oldest first${next ? "; there is more above these" : ""}.\n\n${chain.map((p) => {
				const one = line(p, 1500);
				return `[${one.at ?? ""}] ${one.from} (post ${p.id}): ${one.text}`;
			}).join("\n")}`;
		}
		throw new Error('say what to read: {"conversation": "..."} with the "conversation" of a summon from a DM, or {"post": "..."} with the "id" of a summon from a post; "limit" up to 50');
	});
}
