import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Lexer, type Token } from "marked";
import { Type } from "typebox";
import type { SourceType } from "../source-types.ts";
import type { SourceApi } from "../sources.ts";
import { errText, sleep, truncate, unfolded } from "../util.ts";

/**
 * A Telegram bot: the owner writes to it from wherever they are, and the agent answers there.
 *
 * options: { token, allow?, approvals?, apiBase? }
 *   token      the bot's token from @BotFather
 *   allow      Telegram user ids that may talk to it. Without it the bot is paired: it sends a
 *              code to the account that writes to it, and the owner types that code into pine
 *   approvals  also send approval requests to that chat, with buttons (default true)
 *   apiBase    a Bot API server of your own instead of api.telegram.org
 *
 * event "message": { text, name, username, chatId, messageId, images? }
 * It can send: { text, chatId? } goes to the owner's chat.
 *
 * Messages are fetched by long polling: one request that Telegram answers the moment something
 * arrives. Nothing listens on a port, so it works behind any router. Only accounts on `allow`, or
 * the one that was paired, are heard. What anyone else writes reaches no agent; once an account
 * is paired they get no answer at all, and nothing is ever sent to them.
 */
export const type: SourceType = {
	summary: "a Telegram bot: your owner writes to it from anywhere and you answer there; you can also message them through it. Needs the bot's token from @BotFather",
	talks: true,
	sends: 'a Telegram message to your owner: {"text": "..."} in Markdown, which Telegram shows formatted, and with "file" a picture, a video or a sound file from your workspace to go with it',
	files: true,
	// send() refuses every chat but the owner's (`heard`), whatever the message names.
	toOwner: true,
	options: Type.Object(
		{
			token: Type.String({ description: "the bot's token, which @BotFather gives when a bot is made with /newbot (123456789:AA...)", secret: true }),
			allow: Type.Optional(Type.Array(Type.Number(), { description: "Telegram user ids that may talk to the bot. Leave out unless your owner gave you their id: the bot is then paired, which means it sends a code to the account that writes to it and your owner types that code into pine" })),
			approvals: Type.Optional(Type.Boolean({ description: "also send approval requests to the owner there, with buttons to answer them. Default true" })),
			apiBase: Type.Optional(Type.String({ description: "address of a Bot API server of your own, instead of https://api.telegram.org" })),
		},
		{ additionalProperties: false },
	),
	plan(o) {
		// Without a token yet (the owner is about to be asked for it) there is nothing to check.
		if (o.token !== undefined && !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(String(o.token))) throw new Error("that is not a bot token. @BotFather gives one that looks like 123456789:AAH... when a bot is created with /newbot");
		if (o.apiBase !== undefined) {
			let url: URL;
			try {
				url = new URL(o.apiBase);
			} catch {
				throw new Error(`"${o.apiBase}" is not an address`);
			}
			if (url.protocol !== "https:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("a Bot API server of your own must be reached over https, or run on this machine");
		}
		const ids: number[] = o.allow ?? [];
		return {
			options: o,
			opens: true,
			owner: true,
			does: [
				"connect to Telegram as your bot and wait for messages",
				ids.length ? `listen only to the Telegram user${ids.length === 1 ? "" : "s"} ${ids.join(", ")}` : "listen to nobody until you have paired your own account: the bot sends a code to the account that writes to it, and you type that code into pine",
				"take what that account writes as coming from you, with everything your agents may do for you",
				"send answers back to that chat, and nowhere else",
				...(o.approvals === false ? [] : ["send approval requests there too, with buttons"]),
			],
			tell: ids.length ? "Your owner can write to the bot now." : "Tell your owner to open the bot in Telegram and write anything to it. The bot answers with a six-digit code, and pine asks for that code here. Once they have typed it, that account is the only one the bot listens to.",
		};
	},
};

// ---- Markdown, as Telegram shows it ----------------------------------------------------------------
// Agents write Markdown. Telegram knows a small part of HTML (bold, italic, strike, code, pre,
// blockquote, links), so what an agent sends is turned into that part and nothing else: every bit
// of text is escaped, an agent's own tags included, and a link shows its address beside its text
// (an answer may repeat a page, and a link whose text says one thing and goes to another would be
// how it hides where it goes). Headings become bold lines, lists bullets, tables monospace.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(tokens: Token[] | undefined): string {
	return (tokens ?? [])
		.map((t: any) => {
			switch (t.type) {
				case "strong":
					return `<b>${inline(t.tokens)}</b>`;
				case "em":
					return `<i>${inline(t.tokens)}</i>`;
				case "del":
					return `<s>${inline(t.tokens)}</s>`;
				case "codespan":
					return `<code>${esc(t.text)}</code>`;
				case "br":
					return "\n";
				case "link":
				case "image": {
					const text = t.type === "image" ? esc(t.text) : inline(t.tokens);
					const href = String(t.href ?? "");
					const plain = text.replace(/<[^>]+>/g, "");
					// A bare address shows as itself, and Telegram makes it clickable.
					return !text || plain === esc(href) || plain === esc(href.replace(/^(https?:\/\/|mailto:)/, "")) ? esc(href) : `${text} (${esc(href)})`;
				}
				case "text":
					return t.tokens ? inline(t.tokens) : esc(t.text);
				case "checkbox":
					return t.checked ? "☑ " : "☐ ";
				case "escape":
					return esc(t.text);
				default:
					return esc(t.raw ?? "");
			}
		})
		.join("");
}

function block(t: any, quoted = false): string {
	switch (t.type) {
		case "paragraph":
		case "text":
			return t.tokens ? inline(t.tokens) : esc(t.text);
		case "heading":
			return `<b>${inline(t.tokens)}</b>`;
		case "code": {
			const lang = String(t.lang ?? "").match(/^[\w+#-]+/)?.[0];
			const code = esc(String(t.text).replace(/\n+$/, ""));
			return lang ? `<pre><code class="language-${lang}">${code}</code></pre>` : `<pre>${code}</pre>`;
		}
		case "blockquote": {
			// Telegram has no quote inside a quote: an inner one is shown as its text.
			const inner = blocks(t.tokens, true);
			return quoted ? inner : `<blockquote>${inner}</blockquote>`;
		}
		case "list":
			return t.items
				.map((item: any, i: number) => {
					const mark = item.task ? "" : t.ordered ? `${Number(t.start || 1) + i}. ` : "• ";
					let body = "";
					for (const x of item.tokens) {
						if (x.type === "checkbox") body += inline([x]);
						else if (x.type === "list") body += `\n${block(x, quoted).replace(/^/gm, "    ")}`;
						else if (x.type !== "space") body += (body && !body.endsWith(" ") ? "\n" : "") + block(x, quoted);
					}
					return `${mark}${body.replace(/\n+$/, "")}`;
				})
				.join("\n");
		case "table":
			return `<pre>${esc(String(t.raw).trim())}</pre>`;
		case "hr":
			return "———";
		case "space":
		case "def":
			return "";
		default:
			return esc(String(t.raw ?? "").trim());
	}
}

const blocks = (tokens: Token[], quoted = false) =>
	tokens
		.map((t) => block(t, quoted))
		.filter(Boolean)
		.join("\n\n");

/** What Telegram counts against its limits: the text without the tags. */
const shownLength = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt);/g, "x").length;

/**
 * Markdown cut into messages Telegram takes, each as HTML and as the Markdown it came from (sent
 * as it is if Telegram refuses the HTML). The cuts fall between blocks; a block too long for one
 * message is sent as plain text in pieces.
 */
export function telegramChunks(markdown: string, limit = 4000): { html?: string; text: string }[] {
	const out: { html?: string; text: string }[] = [];
	let html = "";
	let text = "";
	const flush = () => {
		if (html.trim()) out.push({ html: html.trim(), text: text.trim() });
		html = text = "";
	};
	for (const t of Lexer.lex(markdown, { gfm: true })) {
		const piece = block(t);
		if (!piece) continue;
		if (piece.length > limit) {
			flush();
			const raw = String(t.raw).trim();
			for (let i = 0; i < raw.length; i += limit) out.push({ text: raw.slice(i, i + limit) });
			continue;
		}
		if (html && html.length + 2 + piece.length > limit) flush();
		html += (html ? "\n\n" : "") + piece;
		text += t.raw;
	}
	flush();
	return out.length ? out : [{ text: markdown.trim() || "(empty message)" }];
}

/** Telegram's answer to HTML it cannot read. */
const unreadable = (e: unknown) => /can't parse entities|unsupported start tag|unexpected end tag/i.test(errText(e));

const MAX_PHOTO = 10 * 1024 * 1024;
/** What a bot may upload in one file. */
const MAX_UPLOAD = 50 * 1024 * 1024;
/** How long a caption under a picture or a video may be. */
const MAX_CAPTION = 1024;

export default async function telegram(source: SourceApi): Promise<void> {
	const o = source.options;
	const token = String(o.token ?? "");
	if (!token) throw new Error("the bot token is missing");
	source.secret(token);
	const base = String(o.apiBase ?? "https://api.telegram.org").replace(/\/+$/, "");
	const stop = new AbortController();
	source.onStop(() => stop.abort());

	const api = async (method: string, body: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<any> => {
		const res = await fetch(`${base}/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([stop.signal, AbortSignal.timeout(timeoutMs)]) });
		const json: any = await res.json().catch(() => ({}));
		if (!json.ok) throw new Error(`Telegram refused ${method}: ${json.description ?? res.status}`);
		return json.result;
	};
	// A wrong token is found out here, and shows as the reason the source is not running.
	const me = await api("getMe");
	const mediaDir = path.join(source.dataDir, "media");
	fs.mkdirSync(mediaDir, { recursive: true });
	source.media(mediaDir);

	// ---- who is heard ------------------------------------------------------------------------------
	const fixed: number[] = (Array.isArray(o.allow) ? o.allow : []).map(Number).filter(Number.isFinite);
	const paired = () => source.kv.get<{ id: number; name: string }>("owner");
	const heard = (userId: number) => fixed.includes(userId) || paired()?.id === userId;
	/** The chat everything unasked goes to. A private chat has the id of its user. */
	const ownerChat = () => fixed[0] ?? paired()?.id;
	/** Who may talk to the bot, said where the sources are listed. */
	const say = () =>
		source.status(
			fixed.length
				? `@${me.username} listens only to the Telegram user${fixed.length === 1 ? "" : "s"} ${fixed.join(", ")}`
				: paired()
					? `@${me.username} listens only to ${paired()!.name || "the paired account"} (Telegram id ${paired()!.id}), which you confirmed`
					: `@${me.username} listens to nobody yet: write to it from your Telegram account, then type the code it sends you into pine`,
		);
	say();

	const send = async (chatId: number, text: string, extra: Record<string, unknown> = {}) => {
		if (!heard(chatId)) throw new Error("that chat is not your owner's");
		const body = text.trim() || "(empty message)";
		let last: any;
		for (let i = 0; i < body.length; i += 4000) last = await api("sendMessage", { chat_id: chatId, text: body.slice(i, i + 4000), ...(i + 4000 >= body.length ? extra : {}) });
		return last;
	};
	/** What an agent wrote, in Markdown, shown with Telegram's formatting. pine's own messages (approvals, pairing) stay plain: they show exactly what is asked. */
	const sendMarkdown = async (chatId: number, markdown: string) => {
		if (!heard(chatId)) throw new Error("that chat is not your owner's");
		for (const chunk of telegramChunks(markdown)) {
			if (chunk.html === undefined) {
				await api("sendMessage", { chat_id: chatId, text: chunk.text });
				continue;
			}
			try {
				await api("sendMessage", { chat_id: chatId, text: chunk.html, parse_mode: "HTML" });
			} catch (e) {
				if (!unreadable(e)) throw e;
				source.log.debug("Telegram could not read the formatting, sent as plain text", errText(e));
				await api("sendMessage", { chat_id: chatId, text: chunk.text });
			}
		}
	};

	// ---- out: answers, and what an agent sends on its own -------------------------------------------
	/** A picture, a video or a sound file to the owner's chat, with the message as its caption where it fits under one. */
	const sendFile = async (chatId: number, file: { name: string; mime: string; bytes: Buffer }, text: string) => {
		if (!heard(chatId)) throw new Error("that chat is not your owner's");
		if (file.bytes.length > MAX_UPLOAD) throw new Error(`${file.name} is ${Math.round(file.bytes.length / 1024 / 1024)} MB, and Telegram takes files up to 50 MB from a bot. Send a smaller one: a single picture, or the video scaled down with ffmpeg`);
		const [method, field] = file.mime.startsWith("image/") && file.bytes.length <= MAX_PHOTO ? ["sendPhoto", "photo"] : file.mime.startsWith("video/") ? ["sendVideo", "video"] : file.mime.startsWith("audio/") ? ["sendAudio", "audio"] : ["sendDocument", "document"];
		// A message too long for a caption goes first, by itself, so that nothing of it is cut.
		const caption = text.trim();
		const chunks = caption ? telegramChunks(caption) : [];
		const fits = chunks.length === 1 && chunks[0].html !== undefined && shownLength(chunks[0].html) <= MAX_CAPTION;
		if (caption && !fits) await sendMarkdown(chatId, caption);
		const upload = async (html: boolean) => {
			const form = new FormData();
			form.set("chat_id", String(chatId));
			if (fits) form.set("caption", html ? chunks[0].html! : caption);
			if (fits && html) form.set("parse_mode", "HTML");
			form.set(field, new Blob([new Uint8Array(file.bytes)], { type: file.mime }), file.name);
			const res = await fetch(`${base}/bot${token}/${method}`, { method: "POST", body: form, signal: AbortSignal.any([stop.signal, AbortSignal.timeout(180_000)]) });
			const json: any = await res.json().catch(() => ({}));
			if (!json.ok) throw new Error(`Telegram refused ${method}: ${json.description ?? res.status}`);
		};
		try {
			await upload(true);
		} catch (e) {
			if (!fits || !unreadable(e)) throw e;
			await upload(false);
		}
	};

	source.onSend(async (message) => {
		const chatId = Number(message.chatId ?? ownerChat());
		if (!Number.isFinite(chatId)) throw new Error("nobody is connected yet: your owner has to write to the bot once, and confirm it in pine");
		const file = message.file as { name: string; mime: string; bytes: Buffer } | undefined;
		// Telegram folds nothing: a block the terminal UI would fold is its summary and what it holds.
		const text = unfolded(String(message.text ?? ""));
		if (file && Buffer.isBuffer(file.bytes)) {
			await sendFile(chatId, file, text);
			return `sent to your owner on Telegram, with ${file.name}`;
		}
		await sendMarkdown(chatId, text);
		return "sent to your owner on Telegram";
	});

	// "typing…" while an agent works on something that will be answered here.
	const typing = new Map<number, NodeJS.Timeout>();
	source.on("agent/+/started", (e) => {
		const p = e.payload as any;
		const chatId = Number(p?.reply?.payload?.chatId);
		if (p?.reply?.topic !== `out/source/${source.key}` || !heard(chatId)) return;
		const tick = () => void api("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
		tick();
		const h = setInterval(tick, 4500);
		h.unref?.();
		typing.set(p.task, h);
	});
	source.on(["agent/+/done", "agent/+/failed"], (e) => {
		const id = (e.payload as any)?.task;
		clearInterval(typing.get(id));
		typing.delete(id);
	});
	source.onStop(() => typing.forEach((h) => clearInterval(h)));

	// ---- approval requests, to answer from the phone ---------------------------------------------------
	/**
	 * Questions with several answers that were sent here, oldest first, with the id of the message that
	 * asked and how many options it numbered. A reply to that message answers it, and so does a message
	 * of nothing but its numbers for the last one; anything else the owner writes is a message as usual.
	 */
	const typed: Array<{ id: string; message?: number; count: number }> = [];
	if (o.approvals !== false) {
		const asked = new Map<string, number>();
		source.on("approval/requested", async (e) => {
			const r = e.payload as any;
			// An agent's own bot carries that agent's questions; a bot for all agents carries every agent's.
			if (source.agent !== undefined && r.agent !== source.agent && r.of !== source.agent) return;
			const chat = ownerChat();
			if (chat === undefined) return;
			// A question of the agent's with answers to pick from. One answer: a button for each. Several:
			// the options numbered, and the owner's reply to it is the answer ("1,3", or words of their own).
			const options: Array<{ label: string; description?: string }> = r.tool !== "question" ? [] : Array.isArray(r.options) && r.options.length ? r.options : Array.isArray(r.choices) ? r.choices.map((label: string) => ({ label })) : [];
			if (options.length) {
				const shown = options.slice(0, 6);
				const head = `${r.agent} asks${r.header ? ` (${truncate(String(r.header), 12)})` : ""}:\n${truncate(String(r.summary), 1200)}`;
				const line = (x: { label: string; description?: string }) => `${truncate(String(x.label), 80)}${x.description ? `: ${truncate(String(x.description), 200)}` : ""}`;
				const noAnswer = [{ text: "No answer", callback_data: `ap:${r.id}:0` }];
				if (r.multiSelect === true) {
					const list = shown.map((x, i) => `${i + 1}. ${line(x)}`).join("\n");
					const waiting: (typeof typed)[number] = { id: r.id, count: shown.length };
					typed.push(waiting);
					const msg = await send(chat, `${head}\n\n${list}\n\nSeveral answers: reply to this message with their numbers, such as 1,3, or your own words.`, { reply_markup: { inline_keyboard: [noAnswer] } });
					if (msg?.message_id) asked.set(r.id, (waiting.message = msg.message_id));
					return;
				}
				const described = shown.some((x) => x.description) ? `\n\n${shown.map(line).join("\n")}` : "";
				const rows = shown.map((x, i) => [{ text: truncate(String(x.label), 60), callback_data: `ap:${r.id}:c${i}` }]);
				const msg = await send(chat, `${head}${described}`, { reply_markup: { inline_keyboard: [...rows, noAnswer] } });
				if (msg?.message_id) asked.set(r.id, msg.message_id);
				return;
			}
			// A question the owner answers by typing a secret belongs on their own machine, not in a chat.
			if (r.inputs?.length) return;
			const always = r.remember ? [{ text: `Always: ${truncate(String(r.remember), 30)}`, callback_data: `ap:${r.id}:2` }] : [];
			const msg = await send(chat, `Approval needed\nAgent: ${r.agent}${r.task ? ` (task #${r.task})` : ""}\nAction: ${truncate(String(r.summary), 1200)}\nWhy you are asked: ${r.why}`, { reply_markup: { inline_keyboard: [[{ text: "Allow", callback_data: `ap:${r.id}:1` }, ...always, { text: "Deny", callback_data: `ap:${r.id}:0` }]] } });
			if (msg?.message_id) asked.set(r.id, msg.message_id);
		});
		source.on("approval/decided", async (e) => {
			const d = e.payload as any;
			const messageId = asked.get(d.id);
			asked.delete(d.id);
			const done = typed.findIndex((q) => q.id === d.id);
			if (done >= 0) typed.splice(done, 1);
			if (messageId) await api("editMessageReplyMarkup", { chat_id: ownerChat(), message_id: messageId, reply_markup: { inline_keyboard: [[{ text: d.tool === "question" ? (d.allow ? `Answered (${d.by})` : `No answer (${d.by})`) : d.allow ? `Allowed (${d.by})` : `Denied (${d.by})`, callback_data: "noop" }]] } }).catch(() => {});
		});
	}

	// ---- in ----------------------------------------------------------------------------------------
	const photo = async (sizes: any[]): Promise<{ path: string; mimeType: string } | undefined> => {
		const best = sizes.filter((s) => (s.file_size ?? 0) <= MAX_PHOTO).at(-1);
		if (!best) return undefined;
		const file = await api("getFile", { file_id: best.file_id });
		const res = await fetch(`${base}/file/bot${token}/${file.file_path}`, { signal: AbortSignal.timeout(30_000) });
		if (!res.ok) return undefined;
		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.length > MAX_PHOTO) return undefined;
		const target = path.join(mediaDir, `${String(best.file_unique_id).replace(/[^A-Za-z0-9_-]/g, "")}.jpg`);
		fs.writeFileSync(target, buf, { mode: 0o600 });
		return { path: target, mimeType: "image/jpeg" };
	};

	/**
	 * An account nobody knows yet writes to a bot that has no owner. Whoever sits at pine has to
	 * show that this account is theirs: the bot sends the account a code, and pine asks for it.
	 * A press of a key cannot say yes to a stranger, and a stranger does not know what to type.
	 * One question at a time; an account the owner turned down is not asked about again.
	 */
	let pairing = false;
	const pair = async (m: any, userId: number, name: string): Promise<boolean> => {
		const denied = source.kv.get<number[]>("denied") ?? [];
		if (fixed.length || paired() || pairing || denied.includes(userId)) return false;
		pairing = true;
		try {
			const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
			const shown = `${code.slice(0, 3)} ${code.slice(3)}`;
			await api("sendMessage", { chat_id: userId, text: `To connect this Telegram account to pine, type this code into the question pine is showing on your computer:\n\n${shown}\n\nIf you did not expect this message, ignore it.` });
			const who = `${name || "somebody"} (${m.from?.username ? `@${m.from.username}, ` : ""}Telegram id ${userId})`;
			const answer = await source.approvals.request(
				`let the Telegram account of ${who} talk to your agents as you through the bot @${me.username}\nIt just wrote: "${truncate(String(m.text ?? m.caption ?? "(a picture)"), 200)}"\nThe bot sent that account a code. If the account is yours, the code is on your phone now.`,
				"what this account writes will count as your own words, with everything your agents may do for you. Only the code proves that the account is yours; deny it if you did not just write to the bot",
				[{ name: "code", label: "code: the six digits the bot just sent to that account in Telegram", secret: false }],
			);
			if (!answer.allow) {
				// Turned down by the owner (not merely unanswered): that account is not put to them again.
				if (answer.by !== "timeout" && answer.by !== "aborted") source.kv.set("denied", [...denied, userId].slice(-200));
				return false;
			}
			if (String(answer.values?.code ?? "").replace(/\D/g, "") !== code) {
				await api("sendMessage", { chat_id: userId, text: "That was not the code. Write again to get a new one." }).catch(() => {});
				return false;
			}
			if (!paired()) source.kv.set("owner", { id: userId, name: `${name}${m.from?.username ? ` (@${m.from.username})` : ""}` });
			say();
			return paired()?.id === userId;
		} finally {
			pairing = false;
		}
	};

	const onMessage = async (m: any) => {
		const userId = Number(m.from?.id);
		const chatId = Number(m.chat?.id);
		const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ");
		if (m.chat?.type !== "private") return;
		// Unknown senders get no answer at all: nothing to probe, nothing to flood the log with.
		if (!heard(userId) && !(await pair(m, userId, name))) return source.log.debug(`ignored a message from user ${userId}`);
		const text = String(m.text || m.caption || "").trim();
		const images = m.photo ? [await photo(m.photo).catch(() => undefined)].filter(Boolean) : [];
		if (!text && !images.length) return;

		const verdict = text.match(/^\/(allow|deny)(?:\s+(\w+))?/);
		if (verdict && o.approvals !== false) {
			const pending = source.approvals.pending();
			const id = verdict[2] ?? (pending.length === 1 ? pending[0].id : undefined);
			const ok = id ? source.approvals.decide(id, verdict[1] === "allow", `telegram:${userId}`) : false;
			return void send(chatId, ok ? "Noted." : "No such open request.").catch(() => {});
		}
		// The answer to a question with several answers that was sent here: a message, not a button.
		const replyTo = m.reply_to_message?.message_id;
		const last = typed.at(-1);
		const numbers = (q: (typeof typed)[number]) => /^\d+(\s*,\s*\d+)*$/.test(text) && text.split(",").every((n) => Number(n) >= 1 && Number(n) <= q.count);
		const waiting = (replyTo !== undefined ? typed.find((q) => q.message === replyTo) : undefined) ?? (last && numbers(last) ? last : undefined);
		if (waiting && text && source.approvals.answer(waiting.id, text, `telegram:${userId}`)) return;
		source.emit("message", { text: text || "(a picture)", name, username: m.from?.username, chatId, messageId: m.message_id, images: images.length ? images : undefined }, { reply: { chatId } });
	};

	const onCallback = async (c: any) => {
		const userId = Number(c.from?.id);
		const m = String(c.data ?? "").match(/^ap:(\w+):([012]|c\d)$/);
		if (!heard(userId) || !m) return void api("answerCallbackQuery", { callback_query_id: c.id }).catch(() => {});
		if (m[2].startsWith("c")) {
			const chosen = source.approvals.choose(m[1], Number(m[2].slice(1)), `telegram:${userId}`);
			return void api("answerCallbackQuery", { callback_query_id: c.id, text: chosen ? "Answered" : "Already answered or expired" }).catch(() => {});
		}
		const ok = source.approvals.decide(m[1], m[2] !== "0", `telegram:${userId}`, m[2] === "2");
		await api("answerCallbackQuery", { callback_query_id: c.id, text: ok ? (m[2] === "0" ? "Denied" : m[2] === "2" ? "Allowed for this conversation" : "Allowed") : "Already answered or expired" }).catch(() => {});
	};

	const poll = async () => {
		const pollSec = 25;
		let offset = source.kv.get<number>("offset") ?? 0;
		let backoff = 1000;
		while (!stop.signal.aborted) {
			try {
				const updates: any[] = await api("getUpdates", { offset, timeout: pollSec, allowed_updates: ["message", "callback_query"] }, (pollSec + 10) * 1000);
				backoff = 1000;
				for (const u of updates) {
					offset = u.update_id + 1;
					source.kv.set("offset", offset);
					// Not awaited: a pairing question stays open until the owner answers, and messages keep coming meanwhile.
					if (u.message) void onMessage(u.message).catch((e) => source.log.warn("a message could not be handled", errText(e)));
					else if (u.callback_query) void onCallback(u.callback_query).catch((e) => source.log.warn("a button press could not be handled", errText(e)));
				}
			} catch (e) {
				if (stop.signal.aborted) break;
				source.log.warn(`asking Telegram for messages failed, trying again in ${backoff} ms`, errText(e));
				await sleep(backoff);
				backoff = Math.min(backoff * 2, 60_000);
			}
		}
	};
	void poll();
}
