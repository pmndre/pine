// What the source types that look at something again and again (http, feed, calendar, command)
// have in common: asking a web address, picking the part that counts out of what they got, and
// saying what changed in it.

import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type Agent, fetch } from "undici";
import { EXT, PINE_ROOT } from "./config.ts";
import { isLocalHost, publicOnlyAgent } from "./net.ts";
import type { SourceApi } from "./sources.ts";
import { errText, parseDuration } from "./util.ts";

const LINES = 30;
const LINE = 300;
const VALUE = 4000;

export const clip = (s: string, n = VALUE) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** A value as an event carries it: text and large structures cut to a sensible length. */
export function shown(value: unknown): unknown {
	if (typeof value === "string") return clip(value);
	const json = JSON.stringify(value) ?? "null";
	return json.length > VALUE ? clip(json) : value;
}

/**
 * A value as a status line may say it. A status line is read by agents without the mark that
 * outside content gets, so it only repeats what cannot carry a sentence: a number, an amount, one word.
 */
export function harmless(value: unknown): string {
	if (value === null || value === undefined) return "nothing";
	const s = typeof value === "string" ? value : JSON.stringify(value);
	return /^[\d.,:%€$£+\- ]{1,24}$/.test(s) || /^[\w.-]{1,32}$/.test(s) ? s : `a value of ${s.length} characters`;
}

/** A regular expression an agent or owner wrote, or an error that says what is wrong with it. */
export function pattern(source: string): RegExp {
	try {
		return new RegExp(source, "m");
	} catch (e) {
		throw new Error(`"match" is not a regular expression: ${e instanceof Error ? e.message : e}`);
	}
}

/** What a pattern finds in a text: its first group if it has one, else the whole match. Nothing found is null. */
export function found(re: RegExp, text: string): string | null {
	const m = re.exec(text);
	return m ? clip((m[1] ?? m[0]).trim()) : null;
}

/** The lines that are new and the lines that are gone between two texts, a handful of each. */
export function lineDiff(before: string, now: string): { added: string[]; removed: string[]; more?: number } {
	const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
	const a = lines(before);
	const b = lines(now);
	const had = new Set(a);
	const has = new Set(b);
	const added = b.filter((l) => !had.has(l));
	const removed = a.filter((l) => !has.has(l));
	const more = Math.max(0, added.length - LINES) + Math.max(0, removed.length - LINES);
	return { added: added.slice(0, LINES).map((l) => clip(l, LINE)), removed: removed.slice(0, LINES).map((l) => clip(l, LINE)), ...(more ? { more } : {}) };
}

const ENTITIES: Record<string, string> = {
	...{ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", euro: "€", pound: "£", copy: "©", ndash: "–", mdash: "—", hellip: "…" },
	...{ lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sbquo: "‚", bdquo: "„", laquo: "«", raquo: "»", reg: "®", trade: "™", deg: "°", middot: "·", bull: "•", times: "×", yen: "¥", cent: "¢", sect: "§", shy: "", ensp: " ", emsp: " ", thinsp: " " },
	...{ auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", aacute: "á", acirc: "â", ccedil: "ç", ntilde: "ñ", oacute: "ó", iacute: "í", uacute: "ú", aring: "å", oslash: "ø", aelig: "æ" },
};

/** What a reader of a web page sees, line by line: no scripts, no styles, no markup. */
export function pageText(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, "")
		.replace(/<(br|hr)\b[^>]*>|<\/(p|div|li|tr|h[1-6]|section|article|table|ul|ol|dd|dt|header|footer|main|nav|blockquote|pre|title)\s*>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, name: string) => {
			if (name[0] !== "#") return ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? all;
			const code = name[1].toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
		})
		.split("\n")
		.map((l) => l.replace(/\s+/g, " ").trim())
		.filter(Boolean)
		.join("\n");
}

/**
 * A cap for a source that is told things rather than looking: at most `perMinute` reports in any
 * minute. What comes on top is dropped and counted, so that a device or a service that talks all
 * day fills neither the event log nor a conversation. `dropped()` says how many were left out
 * since it was last asked, for the next report to carry.
 */
export function capped(perMinute: number): { ok(): boolean; dropped(): number } {
	let from = 0;
	let n = 0;
	let left = 0;
	return {
		ok() {
			const now = Date.now();
			if (now - from >= 60_000) {
				from = now;
				n = 0;
			}
			if (n < perMinute) return ++n > 0;
			left++;
			return false;
		},
		dropped() {
			const d = left;
			left = 0;
			return d;
		},
	};
}

// ---- a value that is a number ---------------------------------------------------------------------

/** Signs and codes of currencies whose amounts are written the continental way: 1.299,00. */
const CONTINENTAL = /€|\bEUR\b|zł|\bPLN\b|Kč|\bCZK\b|\bkr\b|\bDKK\b|\bSEK\b|\bNOK\b/i;

/**
 * The number a value stands for, if it reads as a number or an amount and nothing else:
 * 12.5, "87 %", "$1,299.00", "1.299,00 €", "-3,5 °C". A text with more to it than a sign, a unit
 * or a currency is not one, and neither is a version (1.2.3), a date or a time.
 *
 * Two separators: the last one is the decimal point. One kind several times: thousands. One
 * separator once is the hard case. Followed by one, two, or more than three digits it is a decimal
 * point. Followed by exactly three it could be either, and then the rest of the text decides: next
 * to a continental currency (€, zł, kr, Kč) a dot groups thousands and a comma is the decimal
 * point; anywhere else it is the other way round, as a program writes numbers.
 */
export function numberOf(value: unknown): number | undefined {
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	if (typeof value !== "string" || value.length > 40) return undefined;
	const m = /^\s*([^\d\s+\-−.,]{0,4})\s*([+\-−]?)\s*(\d(?:[\d.,'’ \u00a0\u202f]*\d)?)\s*([^\d\s.,]{0,6})\s*$/.exec(value);
	if (!m) return undefined;
	const [, before, sign, digits, after] = m;
	// Spaces and apostrophes only ever group: 1 299,00 and 1'299.00.
	const grouped = /['’ \u00a0\u202f]/.test(digits);
	if (grouped && !/^\d{1,3}(?:['’ \u00a0\u202f]\d{3})+(?:[.,]\d+)?$/.test(digits)) return undefined;
	const body = digits.replace(/['’ \u00a0\u202f]/g, "");
	const dots = body.split(".").length - 1;
	const commas = body.split(",").length - 1;
	const groups = (sep: string) => new RegExp(`^\\d{1,3}(?:\\${sep}\\d{3})+$`);
	let plain: string;
	if (dots && commas) {
		const point = body.lastIndexOf(".") > body.lastIndexOf(",") ? "." : ",";
		const other = point === "." ? "," : ".";
		const [whole, frac, ...more] = body.split(point);
		if (more.length || frac.includes(other) || !groups(other).test(whole)) return undefined;
		plain = `${whole.split(other).join("")}.${frac}`;
	} else if (dots + commas > 1) {
		const sep = dots ? "." : ",";
		if (!groups(sep).test(body)) return undefined;
		plain = body.split(sep).join("");
	} else if (dots + commas === 1) {
		const sep = dots ? "." : ",";
		const [whole, frac] = body.split(sep);
		const either = frac.length === 3 && whole.length <= 3 && whole !== "0" && !grouped;
		const thousands = either && (CONTINENTAL.test(before + after) ? sep === "." : sep === ",");
		plain = thousands ? whole + frac : `${whole}.${frac}`;
	} else plain = body;
	const n = Number(plain);
	return Number.isFinite(n) ? (sign && sign !== "+" ? -n : n) : undefined;
}

/** `number` and `previousNumber` for an event, where the value now or the one before reads as a number. */
export function numbers(value: unknown, previous: unknown): { number?: number; previousNumber?: number } {
	const now = numberOf(value);
	const was = numberOf(previous);
	return { ...(now !== undefined ? { number: now } : {}), ...(was !== undefined ? { previousNumber: was } : {}) };
}

// ---- one element of a page ------------------------------------------------------------------------

interface El {
	tag: string;
	attrs: Record<string, string>;
	parent?: El;
	/** Where what is inside it begins and ends in the page's source. */
	from: number;
	to: number;
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title", "noscript", "template"]);
/** Tags that end an open one of the same family without a closing tag, as browsers read them. */
const ENDS: Record<string, string[]> = { li: ["li"], dt: ["dt", "dd"], dd: ["dt", "dd"], tr: ["tr", "td", "th"], td: ["td", "th"], th: ["td", "th"], option: ["option"], p: ["p"] };
const WALLS = new Set(["ul", "ol", "dl", "table", "select"]);
const BLOCKS = new Set(["div", "ul", "ol", "table", "section", "article", "header", "footer", "main", "nav", "aside", "form", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "hr", "dl", "figure"]);

/** The elements of a page in the order they begin, each with its place. Forgiving, as pages need it. */
function elements(html: string): El[] {
	const out: El[] = [];
	const open: El[] = [];
	const close = (upTo: number, at: number) => {
		for (let i = open.length - 1; i >= upTo; i--) open[i].to = at;
		open.length = upTo;
	};
	const tagRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<(\/?)([A-Za-z][A-Za-z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
	let m: RegExpExecArray | null;
	while ((m = tagRe.exec(html))) {
		if (!m[2]) continue;
		const tag = m[2].toLowerCase();
		if (m[1]) {
			const i = open.findLastIndex((e) => e.tag === tag);
			if (i >= 0) close(i, m.index);
			continue;
		}
		// An opening tag ends what cannot contain it: a list item the one before, a block an open paragraph.
		// Never through the list or table it stands in, so that one nested inside another stays whole.
		const enders = ENDS[tag] ?? (BLOCKS.has(tag) ? ["p"] : undefined);
		if (enders) {
			const wall = open.findLastIndex((e) => WALLS.has(e.tag));
			const i = open.findIndex((e, at) => at > wall && enders.includes(e.tag));
			if (i >= 0) close(i, m.index);
		}
		const attrs: Record<string, string> = {};
		const attrRe = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
		let a: RegExpExecArray | null;
		while ((a = attrRe.exec(m[3]))) attrs[a[1].toLowerCase()] ??= unescapeText(a[2] ?? a[3] ?? a[4] ?? "");
		const end = m.index + m[0].length;
		const el: El = { tag, attrs, parent: open.at(-1), from: end, to: end };
		out.push(el);
		if (VOID.has(tag) || /\/\s*$/.test(m[3])) continue;
		if (RAW.has(tag)) {
			const stop = html.toLowerCase().indexOf(`</${tag}`, end);
			el.to = stop < 0 ? html.length : stop;
			tagRe.lastIndex = el.to;
			continue;
		}
		open.push(el);
	}
	close(0, html.length);
	return out;
}

/** A text with its character references (&amp;, &#8364;, &#x41;) written out. */
export const unescaped = (s: string) => unescapeText(s);

const unescapeText = (s: string) =>
	s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, name: string) => {
		if (name[0] !== "#") return ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? all;
		const code = name[1].toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
		return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
	});

interface Simple {
	tag?: string;
	id?: string;
	classes: string[];
	attrs: Array<{ name: string; op?: string; value?: string }>;
}
/** One selector: its parts from left to right, each with how it hangs on the one before (" " inside it, ">" directly inside it). */
type Chain = Array<{ part: Simple; how: " " | ">" }>;

const SELECT_HELP = 'It takes a tag, #id, .class, [attribute] and [attribute=value], put together (div.price, span#total) and nested with a space (inside) or > (directly inside), for example ".product .price" or "table#stock > tbody td.count". Nothing with a colon (:first-child, :not) and no + or ~';

/** A CSS selector as this file can read it, or an error that says what it takes. */
export function selector(source: string): Chain[] {
	const text = String(source ?? "").trim();
	if (!text) throw new Error(`"select" is empty. ${SELECT_HELP}`);
	if (text.length > 300) throw new Error('"select" is too long: 300 characters at most');
	const bad = (what: string) => new Error(`"select" cannot be read here (${what}). ${SELECT_HELP}`);
	const chains: Chain[] = [];
	// Commas separate alternatives, except inside brackets.
	for (const alt of text.split(/,(?![^\[]*\])/)) {
		const chain: Chain = [];
		let rest = alt.trim();
		let how: " " | ">" = " ";
		if (!rest) throw bad("an empty part between commas");
		while (rest) {
			const part: Simple = { classes: [], attrs: [] };
			let any = false;
			let m: RegExpExecArray | null;
			if ((m = /^(\*|[A-Za-z][A-Za-z0-9-]*)/.exec(rest))) {
				if (m[1] !== "*") part.tag = m[1].toLowerCase();
				rest = rest.slice(m[0].length);
				any = true;
			}
			while (rest && !/^[\s>]/.test(rest)) {
				if ((m = /^#([\w-]+)/.exec(rest))) part.id = m[1];
				else if ((m = /^\.([\w-]+)/.exec(rest))) part.classes.push(m[1]);
				else if ((m = /^\[\s*([\w:-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*\]/.exec(rest))) part.attrs.push({ name: m[1].toLowerCase(), op: m[2], value: m[2] ? (m[3] ?? m[4] ?? m[5] ?? "") : undefined });
				else throw bad(rest[0] === ":" ? "a part with a colon" : rest[0] === "+" || rest[0] === "~" ? `the sign ${rest[0]}` : `at "${rest.slice(0, 20)}"`);
				rest = rest.slice(m[0].length);
				any = true;
			}
			if (!any) throw bad(`at "${rest.slice(0, 20)}"`);
			chain.push({ part, how });
			const gap = /^\s*(>?)\s*/.exec(rest)!;
			how = gap[1] ? ">" : " ";
			rest = rest.slice(gap[0].length);
			if (!rest && gap[1]) throw bad("it ends with >");
		}
		chains.push(chain);
	}
	return chains;
}

const fits = (el: El, s: Simple): boolean => {
	if (s.tag && el.tag !== s.tag) return false;
	if (s.id !== undefined && el.attrs.id !== s.id) return false;
	if (s.classes.length) {
		const have = (el.attrs.class ?? "").split(/\s+/);
		if (!s.classes.every((c) => have.includes(c))) return false;
	}
	return s.attrs.every(({ name, op, value }) => {
		const v = el.attrs[name];
		if (v === undefined) return false;
		if (!op) return true;
		const want = value ?? "";
		return op === "=" ? v === want : op === "~=" ? v.split(/\s+/).includes(want) : op === "^=" ? want !== "" && v.startsWith(want) : op === "$=" ? want !== "" && v.endsWith(want) : op === "*=" ? want !== "" && v.includes(want) : v === want || v.startsWith(`${want}-`);
	});
};

const hangs = (el: El, chain: Chain, at: number): boolean => {
	if (!fits(el, chain[at].part)) return false;
	if (at === 0) return true;
	if (chain[at].how === ">") return el.parent !== undefined && hangs(el.parent, chain, at - 1);
	for (let up = el.parent; up; up = up.parent) if (hangs(up, chain, at - 1)) return true;
	return false;
};

/**
 * What the first element of a page that a selector matches says to a reader: its text, or with
 * `attr` the value of that attribute (a price in a meta tag, a data- attribute). Nothing matched is null.
 */
export function selected(html: string, chains: Chain[], attr?: string): string | null {
	const el = elements(html).find((e) => chains.some((chain) => hangs(e, chain, chain.length - 1)));
	if (!el) return null;
	if (attr) return el.attrs[attr.toLowerCase()] === undefined ? null : clip(el.attrs[attr.toLowerCase()].trim());
	return clip(pageText(html.slice(el.from, el.to)).trim());
}

// ---- asking a web address -------------------------------------------------------------------------

/** How long one look at an address may take. */
export const LOOK_TIMEOUT = 20_000;
const MAX_BODY = 1024 * 1024;

/** Headers that carry a secret. Those go into `token`, which is kept out of the configuration. */
export const SECRET_HEADERS = ["authorization", "proxy-authorization", "cookie"];

/**
 * Whether an address says by itself that it is on this computer or the local network. Such an
 * address the owner confirmed as what it is. Any other one must stay on the public internet: a
 * name that one day points into the local network is not followed there.
 */
export const isLocalAddress = (url: URL) => isLocalHost(url.hostname);

/** Why a look failed, in words: what lies behind "fetch failed". */
export const whyFailed = (e: unknown, url: URL) => {
	const text = errText((e as any)?.cause ?? e);
	return /resolves to a private address/.test(text) ? `${url.hostname} leads to an address on your own network. If that is meant, set the source up again with "local": true` : text;
};

/** The connections an address is asked over: as they are for a local one, kept on the public internet for any other. */
export const guardFor = (url: URL, local: unknown): Agent | undefined => (local === true || isLocalAddress(url) ? undefined : publicOnlyAgent(LOOK_TIMEOUT));

/**
 * What every type that asks a web address checks when it is set up: that it is one, that nothing
 * secret is written into it or into a header, and how often it may be asked. Returns the address.
 */
export function askable(o: Record<string, any>, least: string, usual: string): { url: URL; every: string; local: boolean } {
	let url: URL;
	try {
		url = new URL(String(o.url));
	} catch {
		throw new Error(`"${o.url}" is not an address. It looks like https://example.com/page`);
	}
	if (!["http:", "https:"].includes(url.protocol)) throw new Error("the address must start with https:// or http://");
	if (url.username || url.password) throw new Error('an address with a user name or password in it is not taken: leave it out of the address and name "token" in "ask"');
	const every = o.every ?? usual;
	if (parseDuration(every) < parseDuration(least)) throw new Error(`"every" must be at least "${least}"`);
	const secret = Object.keys(o.headers ?? {}).filter((h) => SECRET_HEADERS.includes(h.toLowerCase()));
	if (secret.length) throw new Error(`the header ${secret.join(", ")} carries a secret: leave it out, name "token" in "ask" and give "tokenHeader": "${secret[0].toLowerCase()}"`);
	if (o.tokenHeader && !/^[A-Za-z0-9-]+$/.test(o.tokenHeader)) throw new Error('"tokenHeader" is the name of a header, e.g. "x-api-key"');
	return { url, every, local: o.local === true || isLocalAddress(url) };
}

/** What is sent along with a look. */
export interface Asking {
	headers?: Record<string, string>;
	token?: string;
	tokenHeader?: string;
	/** "GET", or "POST" with `body`. */
	method?: string;
	body?: string;
	/** What kind of answer is wanted, where `headers` does not say. */
	accept?: string;
}

/** What an address said about its last answer, to ask "anything new since?" the next time. */
export interface Since {
	etag?: string;
	modified?: string;
}

export interface Answer extends Since {
	type: string;
	body: string;
	/** It answered that nothing is new since the answer `since` came from (304). There is no body then. */
	unchanged?: boolean;
	/** The answer was longer than what is read of one. */
	truncated?: boolean;
}

/**
 * One look: the answer's text, at most `maxBody` of it (1 MB). A redirect is followed only on the
 * same host. With `since`, an address that has nothing new says so in one line instead of
 * sending everything again.
 */
export async function ask(start: URL, o: Asking, guard: Agent | undefined, signal: AbortSignal, since?: Since, maxBody = MAX_BODY): Promise<Answer> {
	const headers: Record<string, string> = { ...(o.headers ?? {}) };
	const has = (name: string) => Object.keys(headers).some((h) => h.toLowerCase() === name);
	if (o.accept && !has("accept")) headers.accept = o.accept;
	if (o.token) headers[o.tokenHeader ?? "authorization"] = o.tokenHeader ? o.token : `Bearer ${o.token}`;
	let method = String(o.method ?? "GET").toUpperCase() === "POST" ? "POST" : "GET";
	const body = method === "POST" ? String(o.body ?? "") : undefined;
	if (body && !has("content-type")) headers["content-type"] = /^\s*[{[]/.test(body) ? "application/json" : "text/plain; charset=utf-8";
	// Only a plain look can be answered with "nothing new".
	const conditional = method === "GET" && Boolean(since?.etag || since?.modified);
	if (conditional && since?.etag) headers["if-none-match"] = since.etag;
	if (conditional && since?.modified) headers["if-modified-since"] = since.modified;
	let at = start;
	for (let hop = 0; hop < 6; hop++) {
		const res = await fetch(at, { method, headers, ...(method === "POST" ? { body } : {}), redirect: "manual", signal: AbortSignal.any([signal, AbortSignal.timeout(LOOK_TIMEOUT)]), ...(guard ? { dispatcher: guard } : {}) });
		const to = res.status >= 300 && res.status < 400 && res.status !== 304 ? res.headers.get("location") : null;
		if (to) {
			await res.body?.cancel().catch(() => {});
			const next = new URL(to, at);
			// The owner confirmed one host. Another one is another decision, and must not get the token.
			const upgrade = at.protocol === "http:" && next.protocol === "https:";
			if (next.hostname !== start.hostname || (next.protocol !== at.protocol && !upgrade) || (next.port !== at.port && !upgrade)) throw new Error(`it sends on to ${next.host}, which is not the address that was confirmed. If that is the right one, set the source up with it`);
			// Sent on after a POST: asked again the same way only where the answer says so (307, 308), as a browser does.
			if (method === "POST" && res.status !== 307 && res.status !== 308) {
				method = "GET";
				delete headers["content-type"];
			}
			at = next;
			continue;
		}
		if (res.status === 304 && conditional) {
			await res.body?.cancel().catch(() => {});
			return { type: "", body: "", unchanged: true, ...since };
		}
		if (!res.ok) {
			await res.body?.cancel().catch(() => {});
			throw new Error(`it answered ${res.status}`);
		}
		const chunks: Buffer[] = [];
		let size = 0;
		const reader = res.body?.getReader();
		while (reader) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(Buffer.from(value.subarray(0, maxBody - size)));
			size += value.length;
			if (size >= maxBody) {
				await reader.cancel().catch(() => {});
				break;
			}
		}
		return { type: res.headers.get("content-type") ?? "", body: Buffer.concat(chunks).toString("utf8"), ...(size > maxBody ? { truncated: true } : {}), etag: res.headers.get("etag") ?? undefined, modified: res.headers.get("last-modified") ?? undefined };
	}
	throw new Error("it sends on and on (more than five redirects)");
}

/**
 * What the address said about the answer a source last worked through, for the next look to ask
 * with. `about` names what the source makes of an answer (the address, what it watches in it): a
 * source that was set up anew for something else starts from a full answer.
 */
export function sinceOf(source: SourceApi, about: unknown): Since | undefined {
	const kept = source.kv.get<Since & { about: string }>("since");
	return kept && kept.about === mark(about) && (kept.etag || kept.modified) ? { etag: kept.etag, modified: kept.modified } : undefined;
}

/** Remember what an answer said about itself, once the source has worked it through: a look that failed half way is made in full again. */
export function keepSince(source: SourceApi, about: unknown, answer: Since): void {
	const had = source.kv.get<Since & { about: string }>("since");
	if (!answer.etag && !answer.modified && !had) return;
	source.kv.set("since", { about: mark(about), etag: answer.etag, modified: answer.modified });
}

const mark = (about: unknown) => crypto.createHash("sha256").update(JSON.stringify(about)).digest("hex").slice(0, 16);

// ---- a page as a browser shows it -----------------------------------------------------------------

/** How long one look with the browser may take: starting it, loading the page, waiting for it to be quiet. */
export const RENDER_TIMEOUT = 45_000;
/** The most text a rendered page hands back, and the longest answer of the helper that is read. */
const RENDER_TEXT = 200_000;
const RENDER_ANSWER = 2 * 1024 * 1024;
/** How many browsers run at a time, for all sources together. A look that finds them busy waits its turn. */
const RENDER_AT_ONCE = 2;

/**
 * For tests: a program that speaks the one-line protocol of the helper (mcp/render.ts) in its
 * place, so that a rendered look can be tried without a browser, and a shorter time limit. Not an
 * option of a source: a source's options are what an agent may set, and which program the daemon
 * runs is not among them.
 */
export const rendering: { program?: string[]; timeoutMs?: number } = {};

/** What a rendered look is told: the address, what to take from the page, and where the one local address that is allowed is written. */
export interface RenderJob {
	url: string;
	select?: string;
	attr?: string;
	/** A file in pine's data with the local "host:port" the owner confirmed, as the browser's guard reads it. */
	localFile?: string;
}

export interface Rendered {
	/** What a reader of the page sees, line by line. Without `select`. */
	text?: string;
	/** With `select`: the text of the first element it matches, or the attribute. Nothing matched is null. */
	value?: string | null;
	/** The address the browser was on when it read the page. */
	final: string;
}

/** Whether the address a look ended on is the one that was confirmed: the same host, and the same port unless http became https. */
export function sameSite(start: URL, end: URL): boolean {
	const upgrade = start.protocol === "http:" && end.protocol === "https:";
	return end.hostname === start.hostname && (end.protocol === start.protocol || upgrade) && (end.port === start.port || upgrade);
}

/** A page's text as `pageText` gives it: line by line, spaces drawn together, no empty lines. */
const readerLines = (text: string) =>
	text
		.split("\n")
		.map((l) => l.replace(/\s+/g, " ").trim())
		.filter(Boolean)
		.join("\n");

let renderBusy = 0;
const renderQueue: Array<() => void> = [];

/** Waits until a browser may be started. Resolves with what gives the turn back. */
function renderTurn(signal: AbortSignal): Promise<() => void> {
	return new Promise((resolve, reject) => {
		const go = () => {
			signal.removeEventListener("abort", gone);
			renderBusy++;
			let given = false;
			resolve(() => {
				if (given) return;
				given = true;
				renderBusy--;
				renderQueue.shift()?.();
			});
		};
		const gone = () => {
			renderQueue.splice(renderQueue.indexOf(go), 1);
			reject(new Error("stopped"));
		};
		if (signal.aborted) return reject(new Error("stopped"));
		if (renderBusy < RENDER_AT_ONCE) return go();
		renderQueue.push(go);
		signal.addEventListener("abort", gone, { once: true });
	});
}

/**
 * Ends whatever still runs out of a look's folder. The helper ends its browser when it ends, but a
 * helper that had to be killed outright cannot, and the browser does not end by itself then. The
 * browser is found by the folder its profile lies in, which is this look's and nobody else's.
 */
function sweep(dir: string): Promise<void> {
	// Windows has no ps: CIM says the processes' command lines. The folder is pine's own (a temp folder it made).
	if (process.platform === "win32")
		return new Promise((resolve) => {
			const script = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${(dir + path.sep).replace(/'/g, "''")}') -and $_.ProcessId -ne ${process.pid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
			execFile(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 15_000, windowsHide: true }, () => resolve());
		});
	return new Promise((resolve) => {
		execFile("ps", ["axww", "-o", "pid=,args="], { maxBuffer: 16 * 1024 * 1024, timeout: 5000, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } }, (_err, out) => {
			for (const line of String(out ?? "").split("\n")) {
				const m = /^\s*(\d+)\s+(.*)$/.exec(line);
				if (!m || !m[2].includes(dir + path.sep) || Number(m[1]) === process.pid) continue;
				try {
					process.kill(Number(m[1]), "SIGKILL");
				} catch {
					// gone already
				}
			}
			resolve();
		});
	});
}

/**
 * One look at a page with the browser pine ships: the page is loaded without a window, its
 * scripts run, and what a reader sees then is handed back. The browser runs in a helper program
 * (mcp/render.ts) that is started for this look and gone after it, whatever happens: an answer,
 * no answer within the time limit, or the source stopping.
 *
 * `dir` is the source's own folder in pine's data. The helper works in a folder inside it, which
 * is emptied afterwards. It gets no part of the daemon's environment, one line with the job, and
 * is read one line of answer from, of bounded length. Throws with a sentence when the look failed.
 */
export async function rendered(job: RenderJob, dir: string, signal: AbortSignal): Promise<Rendered> {
	const done = await renderTurn(signal);
	const scratch = path.join(dir, "browser");
	try {
		fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
		fs.mkdirSync(scratch, { recursive: true, mode: 0o700 });
		const answer = await renderOnce(job, scratch, signal);
		const start = new URL(job.url);
		let final: URL;
		try {
			final = new URL(String(answer.final));
		} catch {
			throw new Error("the browser gave an answer that cannot be read");
		}
		if (!sameSite(start, final)) throw new Error(`it sends on to ${final.host}, which is not the address that was confirmed. If that is the right one, set the source up with it`);
		if (job.select !== undefined) return { value: typeof answer.value === "string" ? readerLines(answer.value.slice(0, RENDER_TEXT)) : null, final: final.href };
		if (typeof answer.text !== "string") throw new Error("the browser gave an answer that cannot be read");
		return { text: readerLines(answer.text.slice(0, RENDER_TEXT)), final: final.href };
	} finally {
		// What the browser left behind means it may still be there.
		let left: string[] = [];
		try {
			left = fs.readdirSync(scratch);
		} catch {
			// no folder, nothing left
		}
		if (left.length) await sweep(scratch);
		try {
			fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
		} catch {
			// the next look empties it again
		}
		done();
	}
}

/** Starts the helper, hands it the job, and reads its one line. Resolves or rejects only when the helper is gone. */
function renderOnce(job: RenderJob, scratch: string, signal: AbortSignal): Promise<Record<string, unknown>> {
	const limit = rendering.timeoutMs ?? RENDER_TIMEOUT;
	const program = rendering.program ?? [process.execPath, path.join(PINE_ROOT, "mcp", `render${EXT}`)];
	return new Promise((resolve, reject) => {
		if (signal.aborted) return reject(new Error("stopped"));
		// Of the daemon's environment only what a browser needs to be found and to start. No secret is in it.
		const env: Record<string, string> = { TMPDIR: scratch };
		// (Windows: where the browser lies is found from the profile's folders, and a program does not start without SystemRoot.)
		const keep = ["HOME", "PATH", "PLAYWRIGHT_BROWSERS_PATH", ...(process.platform === "win32" ? ["SystemRoot", "windir", "PATHEXT", "USERPROFILE", "LOCALAPPDATA", "APPDATA"] : [])];
		for (const k of keep) if (process.env[k]) env[k] = process.env[k]!;
		if (process.platform === "win32") env.TEMP = env.TMP = scratch;
		const child = spawn(program[0], program.slice(1), { cwd: scratch, env, stdio: ["pipe", "pipe", "ignore"], detached: true, windowsHide: true });
		let out = Buffer.alloc(0);
		let failure: Error | undefined;
		let hard: NodeJS.Timeout | undefined;
		// The whole group: a helper that started others must not leave them behind.
		const group = (sig: NodeJS.Signals) => {
			// Windows has no groups: the helper's tree, by its parents (taskkill /T).
			if (process.platform === "win32") {
				if (child.pid) execFile(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", ...(sig === "SIGKILL" ? ["/F"] : [])], { windowsHide: true }, () => {});
				return;
			}
			try {
				process.kill(-child.pid!, sig);
			} catch {
				// nobody left in it
			}
		};
		// Asked to end first, which lets the helper end its browser; a second later ended, whatever it is doing.
		const end = (why: Error) => {
			failure ??= why;
			if (hard || !child.pid) return;
			group("SIGTERM");
			hard = setTimeout(() => group("SIGKILL"), 1000);
		};
		// The helper gives up by itself at `limit`, with a sentence. This is for a helper that does not.
		const timer = setTimeout(() => end(new Error(`the page did not finish loading within ${Math.round(limit / 100) / 10} s`)), limit + Math.min(3000, limit));
		const stopped = () => end(new Error("stopped"));
		signal.addEventListener("abort", stopped, { once: true });
		const settle = () => {
			clearTimeout(timer);
			clearTimeout(hard);
			signal.removeEventListener("abort", stopped);
			// What was ended may have left others in its group that did not listen.
			if (hard) group("SIGKILL");
			if (failure) return reject(failure);
			let answer: any;
			try {
				answer = JSON.parse(out.toString("utf8").split("\n")[0]);
			} catch {
				// not an answer
			}
			if (!answer || typeof answer !== "object" || Array.isArray(answer)) return reject(new Error(out.length ? "the browser gave an answer that cannot be read" : "the browser ended without an answer"));
			// The helper's own sentence, never a page's: one line of it.
			if (answer.ok !== true) return reject(new Error(typeof answer.error === "string" && answer.error.trim() ? clip(answer.error.replace(/\s+/g, " ").trim(), 300) : "the browser gave an answer that cannot be read"));
			resolve(answer);
		};
		child.stdout.on("data", (d: Buffer) => {
			if (failure) return;
			out = Buffer.concat([out, d]);
			if (out.length > RENDER_ANSWER) end(new Error("the browser answered with more than a page's text can be"));
		});
		child.stdin.on("error", () => {});
		child.on("error", (e) => {
			failure ??= new Error(`pine's browser could not be started (${errText(e)})`);
			// A program that never started never closes.
			if (!child.pid) settle();
		});
		child.on("close", settle);
		child.stdin.end(`${JSON.stringify({ url: job.url, ...(job.select !== undefined ? { select: job.select } : {}), ...(job.attr !== undefined ? { attr: job.attr } : {}), timeout: limit, ...(job.localFile ? { localFile: job.localFile } : {}) })}\n`);
	});
}
