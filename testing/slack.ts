import crypto from "node:crypto";
import http from "node:http";
import type { Duplex } from "node:stream";
import { type WsConn, wsServer } from "./ws.ts";

// Slack as far as an app in Socket Mode meets it: the Web API (who am I, a socket address, names,
// the list of channels page by page, posting, reactions, the three steps of an upload), the host
// that files are fetched from, and the socket that envelopes arrive on. One server on 127.0.0.1.

export const APP = "xapp-1-A000-stand-in-app-token";
/** A bot token: the account it belongs to is the bot. */
export const BOT = "xoxb-000-stand-in-bot-token";
/** A user token: the account it belongs to is the owner. */
export const USER = "xoxp-000-stand-in-user-token";
export const APP_ID = "A0000000APP";
export const BOT_ID = "B000000PINE";
export const [OPS, RANDOM, DEV, DM, ANNAS] = ["C0000000OPS", "C000RANDOM", "C0000000DEV", "D00000000DM", "D000000ANNA"];
export const [ME, BOSS, ANNA, PINE] = ["U00000000ME", "U000000BOSS", "U000000ANNA", "U000000PINE"];

const json = (res: http.ServerResponse, body: unknown, status = 200, headers: Record<string, string> = {}) => void res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));

export interface SlackCall {
	method: string;
	auth: string;
	body: any;
}

export async function slackSite() {
	const calls: SlackCall[] = [];
	/** What was asked of the file host, and what was put where an upload goes. */
	const gets: Array<{ path: string; auth: string }> = [];
	const uploads: Array<{ path: string; auth: string; type: string; body: string }> = [];
	/** Methods that answer "slow down" this many times before they answer. */
	const limited = new Map<string, number>();
	/** What the file host answers, by name. Anything else is not there. */
	const files: Record<string, { status?: number; type?: string; body?: string | Buffer; location?: string }> = {};
	/** `socket`, `upload`: another address to hand out for the socket, or for where a file is uploaded to, than this server's own. */
	/** `lists`: which kinds of conversation the app may list (users.conversations), each a scope of its own. */
	const state: { privateScope: boolean; historyScope: boolean; lists: Record<string, boolean>; socket?: string; upload?: string } = { privateScope: true, historyScope: true, lists: { public_channel: true, private_channel: true, mpim: true, im: true } };
	/** The conversations the token's account is in, by kind: what users.conversations answers from. */
	const member: Record<string, string[]> = { public_channel: [OPS, DEV], private_channel: [], mpim: [], im: [DM, ANNAS] };
	const READS: Record<string, string> = { public_channel: "channels:read", private_channel: "groups:read", mpim: "mpim:read", im: "im:read" };
	/** What was written before, by channel, oldest first: what conversations.history and conversations.replies answer from. */
	const history: Record<string, Array<Record<string, any>>> = {};
	/** What chat.postMessage answered: where each message is, and its ts. */
	const posted: Array<{ channel: string; ts: string }> = [];
	const names: Record<string, string> = { [ME]: "Paul Owner", [BOSS]: "Rainer Boss", [ANNA]: "Anna", [PINE]: "pine" };
	const rooms: Record<string, string> = { [OPS]: "ops", [DEV]: "dev" };
	let tickets = 0;
	let posts = 0;
	const site = await wsServer({
		onConnect: (c) => c.send({ type: "hello", num_connections: 1 }),
		web: (req, res, body) => {
			const url = new URL(String(req.url), "http://x");
			const auth = String(req.headers.authorization ?? "");
			if (url.pathname.startsWith("/files/")) {
				gets.push({ path: url.pathname, auth });
				const f = files[url.pathname.slice("/files/".length)];
				if (!f || ![`Bearer ${BOT}`, `Bearer ${USER}`].includes(auth)) return void res.writeHead(404).end("no");
				return void res.writeHead(f.status ?? 200, { "content-type": f.type ?? "application/octet-stream", ...(f.location ? { location: f.location } : {}) }).end(f.body ?? "");
			}
			if (url.pathname === "/signin") {
				gets.push({ path: url.pathname, auth });
				return void res.writeHead(200, { "content-type": "text/html" }).end("<html>Sign in to Slack</html>");
			}
			if (url.pathname.startsWith("/upload/")) {
				uploads.push({ path: url.pathname, auth, type: String(req.headers["content-type"] ?? ""), body });
				return void res.writeHead(200).end(`OK - ${body.length}`);
			}
			const method = url.pathname.replace(/^\/api\//, "");
			const parsed = /json/.test(String(req.headers["content-type"])) ? JSON.parse(body || "{}") : Object.fromEntries(new URLSearchParams(body));
			calls.push({ method, auth, body: parsed });
			for (const key of [method, `${method} ${auth}`]) {
				const left = limited.get(key) ?? 0;
				if (left <= 0) continue;
				limited.set(key, left - 1);
				return json(res, { ok: false, error: "ratelimited" }, 429, { "retry-after": "1" });
			}
			if (method === "apps.connections.open") return auth === `Bearer ${APP}` ? json(res, { ok: true, url: `${state.socket ?? site.url}/link?ticket=secret-ticket-${++tickets}&app_id=${APP_ID}` }) : json(res, { ok: false, error: "invalid_auth" });
			if (![`Bearer ${BOT}`, `Bearer ${USER}`].includes(auth)) return json(res, { ok: false, error: "invalid_auth" });
			const bot = auth === `Bearer ${BOT}`;
			if (method === "auth.test") return json(res, bot ? { ok: true, user_id: PINE, user: "pine", bot_id: BOT_ID, app_id: APP_ID, team_id: "T000" } : { ok: true, user_id: ME, user: "paul", team_id: "T000" });
			if (method === "users.info") return names[parsed.user] ? json(res, { ok: true, user: { name: "x", real_name: names[parsed.user] } }) : json(res, { ok: false, error: "user_not_found" });
			if (method === "conversations.info") return rooms[parsed.channel] ? json(res, { ok: true, channel: { name: rooms[parsed.channel] } }) : json(res, { ok: false, error: "channel_not_found" });
			if (method === "conversations.list") {
				if (String(parsed.types).includes("private_channel") && !state.privateScope) return json(res, { ok: false, error: "missing_scope", needed: "groups:read", provided: "channels:read" });
				// Two pages: what is looked for is on the second.
				if (!parsed.cursor) return json(res, { ok: true, channels: [{ id: "C00GENERAL1", name: "general" }, { id: RANDOM, name: "random" }], response_metadata: { next_cursor: "page-two" } });
				return json(res, { ok: true, channels: [{ id: OPS, name: "ops" }, { id: DEV, name: "dev" }], response_metadata: { next_cursor: "" } });
			}
			if (method === "users.conversations") {
				const types = String(parsed.types ?? "public_channel").split(",");
				const lacking = types.find((t) => !state.lists[t]);
				if (lacking) return json(res, { ok: false, error: "missing_scope", needed: READS[lacking] ?? "", provided: "chat:write" });
				return json(res, { ok: true, channels: types.flatMap((t) => (member[t] ?? []).map((id) => ({ id, is_im: t === "im", is_mpim: t === "mpim", is_private: t !== "public_channel" }))), response_metadata: { next_cursor: "" } });
			}
			if (method === "conversations.history" || method === "conversations.replies") {
				if (!state.historyScope) return json(res, { ok: false, error: "missing_scope", needed: "channels:history,groups:history,mpim:history,im:history", provided: "channels:read" });
				const all = history[parsed.channel];
				if (!all) return json(res, { ok: false, error: "channel_not_found" });
				const limit = Number(parsed.limit ?? 100);
				const inside = (m: any) => (parsed.latest === undefined || Number(m.ts) < Number(parsed.latest)) && (parsed.oldest === undefined || Number(m.ts) > Number(parsed.oldest));
				if (method === "conversations.replies") {
					// A thread: its first message, then the answers, oldest first.
					const thread = all.filter((m) => m.ts === parsed.ts || m.thread_ts === parsed.ts).filter((m) => m.ts === parsed.ts || inside(m));
					return json(res, { ok: true, messages: thread.slice(0, limit), has_more: thread.length > limit });
				}
				// A channel: the newest first, as Slack answers.
				const top = all.filter((m) => !m.thread_ts || m.thread_ts === m.ts).filter(inside).reverse();
				return json(res, { ok: true, messages: top.slice(0, limit), has_more: top.length > limit });
			}
			if (method === "conversations.open") return parsed.users === ANNA ? json(res, { ok: true, channel: { id: ANNAS } }) : json(res, { ok: false, error: "user_not_found" });
			if (method === "chat.postMessage") {
				if (parsed.channel === DEV) return json(res, { ok: false, error: "not_in_channel" });
				posted.push({ channel: parsed.channel, ts: `1800000000.00000${++posts}` });
				return json(res, { ok: true, ...posted.at(-1) });
			}
			if (method === "reactions.add") return json(res, parsed.name === "twice" ? { ok: false, error: "already_reacted" } : { ok: true });
			if (method === "files.getUploadURLExternal") return json(res, { ok: true, upload_url: `${state.upload ?? site.base}/upload/F0000000001`, file_id: "F0000000001" });
			if (method === "files.completeUploadExternal") return json(res, { ok: true, files: [{ id: "F0000000001", title: "x" }] });
			json(res, { ok: false, error: "unknown_method" });
		},
	});
	let n = 0;
	const envelope = (type: string, payload: unknown, more: Record<string, unknown> = {}) => {
		const id = `env-${++n}-${Math.random().toString(36).slice(2)}`;
		for (const c of site.live()) c.send({ envelope_id: id, type, accepts_response_payload: type !== "events_api", payload, ...more });
		return id;
	};
	let events = 0;
	let stamps = 0;
	/** Tell every connected app that something happened, as the Events API does. */
	const happen = (event: Record<string, unknown>, eventId = `Ev${++events}`) => envelope("events_api", { event_id: eventId, api_app_id: APP_ID, type: "event_callback", event });
	return {
		site,
		/** The address the Web API is at: what a source gets as "apiBase". */
		api: `${site.base}/api`,
		calls,
		gets,
		uploads,
		posted,
		files,
		history,
		member,
		state,
		/** A ts for something written now. Each is later than the one before, also within a millisecond. */
		stamp: (ms = Date.now()) => `${Math.floor(ms / 1000)}.${String(ms % 1000).padStart(3, "0")}${String(++stamps % 1000).padStart(3, "0")}`,
		/** The calls of one method. */
		called: (method: string) => calls.filter((c) => c.method === method),
		/** Answer the next `times` calls of a method (made with this token, if one is given) with 429 and "Retry-After: 1". */
		limit: (method: string, times = 1, token?: string) => void limited.set(token ? `${method} Bearer ${token}` : method, times),
		happen,
		/** A message, as Slack tells an app about one. */
		say: (event: Record<string, unknown>, eventId?: string) => {
			const at = events + 1;
			return happen({ type: "message", ts: `17000000${at}.000100`, ...event }, eventId);
		},
		/** A slash command of the app. */
		command: (payload: Record<string, unknown>) => envelope("slash_commands", { token: "verification-token-of-old", api_app_id: APP_ID, trigger_id: "1.2.trigger", response_url: "https://hooks.slack.example/commands/1", ...payload }),
		/** Something that is neither: a button somebody pressed. */
		press: (payload: Record<string, unknown>) => envelope("interactive", { type: "block_actions", api_app_id: APP_ID, ...payload }),
		/** What the apps answered an envelope with: one entry for each connection that acknowledged it. */
		acks: (id: string) => site.conns.flatMap((c: WsConn) => c.received.filter((m: any) => m?.envelope_id === id).map((m: any) => m.payload)),
	};
}

/**
 * A socket that takes a connection and then never answers: no goodbye to a goodbye, no pong to a
 * ping, and a greeting only with `greets`. What a line that went quiet looks like from this end.
 */
export async function deafSocket(o: { greets?: boolean } = {}) {
	const open = new Set<Duplex>();
	let taken = 0;
	const server = http.createServer((_req, res) => void res.writeHead(404).end("no"));
	server.on("upgrade", (req, socket) => {
		taken++;
		const accept = crypto.createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
		socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
		const hello = Buffer.from(JSON.stringify({ type: "hello", num_connections: 1 }));
		if (o.greets) socket.write(Buffer.concat([Buffer.from([0x81, hello.length]), hello]));
		open.add(socket);
		socket.on("data", () => {});
		socket.on("error", () => {});
		// The other side hanging up is the one thing it notices.
		const gone = () => {
			open.delete(socket);
			socket.destroy();
		};
		socket.on("end", gone);
		socket.on("close", gone);
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return {
		url: `ws://127.0.0.1:${(server.address() as any).port}`,
		/** How many connections it took, and how many of them are still open. */
		taken: () => taken,
		open: () => open.size,
		close: () =>
			new Promise<void>((r) => {
				for (const s of open) s.destroy();
				server.closeAllConnections();
				server.close(() => r());
			}),
	};
}
