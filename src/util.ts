import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function expandHome(p: string): string {
	return p === "~" || p.startsWith("~/") || (process.platform === "win32" && p.startsWith("~\\")) ? path.join(os.homedir(), p.slice(1)) : p;
}

/** Where a command lies on the PATH, as a shell would find it; nothing where there is none. */
export function onPath(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
	// Windows finds "npm" as npm.cmd: a program is named without the ending its PATHEXT lists.
	const endings = process.platform === "win32" && !path.extname(name) ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
	for (const dir of (env.PATH ?? env.Path ?? "").split(path.delimiter)) {
		if (!dir) continue;
		for (const ending of endings) {
			const file = path.join(dir, name + ending.toLowerCase());
			try {
				fs.accessSync(file, fs.constants.X_OK);
				if (fs.statSync(file).isFile()) return file;
			} catch {
				// Not in this folder.
			}
		}
	}
	return undefined;
}

/** Resolve a config path: `~` expands, relative paths are relative to `base`. */
export function resolvePath(p: string, base: string): string {
	const e = expandHome(p);
	return path.isAbsolute(e) ? e : path.resolve(base, e);
}

/** MQTT-style topic match: `+` is one level, a trailing `#` is the rest (including nothing). */
export function topicMatches(pattern: string, topic: string): boolean {
	if (pattern === "#" || pattern === topic) return true;
	const p = pattern.split("/");
	const t = topic.split("/");
	for (let i = 0; i < p.length; i++) {
		if (p[i] === "#") return i === p.length - 1;
		if (i >= t.length) return false;
		if (p[i] !== "+" && p[i] !== t[i]) return false;
	}
	return p.length === t.length;
}

export const matchesAny = (patterns: readonly string[], topic: string) => patterns.some((p) => topicMatches(p, topic));

export function getPath(obj: unknown, dotted: string): unknown {
	let cur: any = obj;
	for (const key of dotted.split(".")) {
		if (cur == null) return undefined;
		cur = cur[key];
	}
	return cur;
}

const asText = (v: unknown) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v));

/** Replace `{{a.b}}` with values from `ctx`. Objects render as JSON, missing values as "". */
export function render(template: string, ctx: unknown): string {
	return template.replace(/\{\{\s*([\w.$/-]+)\s*\}\}/g, (_m, p) => asText(getPath(ctx, p)));
}

/** Render every string inside a JSON-like value. A string that is exactly one `{{path}}` keeps the value's type. */
export function renderDeep(value: unknown, ctx: unknown): unknown {
	if (typeof value === "string") {
		const whole = value.match(/^\{\{\s*([\w.$/-]+)\s*\}\}$/);
		return whole ? getPath(ctx, whole[1]) : render(value, ctx);
	}
	if (Array.isArray(value)) return value.map((v) => renderDeep(v, ctx));
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderDeep(v, ctx)]));
	return value;
}

/**
 * Declarative filter. Keys are dotted paths into `ctx`; a plain value means equality, an object
 * may use eq, ne, in, gt, gte, lt, lte, exists, contains, regex. All keys must match.
 */
export function matchWhen(when: Record<string, unknown> | undefined, ctx: unknown): boolean {
	if (!when) return true;
	for (const [key, cond] of Object.entries(when)) {
		const v = getPath(ctx, key) as any;
		if (cond === null || typeof cond !== "object" || Array.isArray(cond)) {
			if (JSON.stringify(v) !== JSON.stringify(cond)) return false;
			continue;
		}
		const c = cond as Record<string, any>;
		if ("eq" in c && JSON.stringify(v) !== JSON.stringify(c.eq)) return false;
		if ("ne" in c && JSON.stringify(v) === JSON.stringify(c.ne)) return false;
		if ("in" in c && !(Array.isArray(c.in) && c.in.some((x: unknown) => JSON.stringify(x) === JSON.stringify(v)))) return false;
		if ("gt" in c && !(v > c.gt)) return false;
		if ("gte" in c && !(v >= c.gte)) return false;
		if ("lt" in c && !(v < c.lt)) return false;
		if ("lte" in c && !(v <= c.lte)) return false;
		if ("exists" in c && (v !== undefined && v !== null) !== Boolean(c.exists)) return false;
		if ("contains" in c && !(typeof v === "string" || Array.isArray(v) ? v.includes(c.contains) : false)) return false;
		if ("regex" in c && !(typeof v === "string" && new RegExp(c.regex, c.flags ?? "").test(v))) return false;
	}
	return true;
}

/** "90s", "15m", "2h", "1d" or a number of milliseconds. */
export function parseDuration(v: string | number): number {
	if (typeof v === "number") return v;
	const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/);
	if (!m) throw new Error(`invalid duration: ${v}`);
	return Number(m[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] ?? "ms"]!;
}

/** A string that is safe as one path component: no dots, no separators, never empty. */
export const safeName = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80) || "_";

export const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}… [${s.length - n} more chars]` : s);

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";
const LEVELS: LogLevel[] = ["debug", "info", "warn", "error", "silent"];

export interface Logger {
	debug(msg: string, extra?: unknown): void;
	info(msg: string, extra?: unknown): void;
	warn(msg: string, extra?: unknown): void;
	error(msg: string, extra?: unknown): void;
	child(scope: string): Logger;
}

export function createLogger(level: LogLevel = "info", scope = "pine", sink: (line: string) => void = (l) => process.stderr.write(`${l}\n`)): Logger {
	const min = LEVELS.indexOf(level);
	const emit = (lvl: LogLevel) => (msg: string, extra?: unknown) => {
		if (LEVELS.indexOf(lvl) < min) return;
		const tail = extra === undefined ? "" : ` ${extra instanceof Error ? (extra.stack ?? extra.message) : typeof extra === "string" ? extra : JSON.stringify(extra)}`;
		sink(`${new Date().toISOString()} ${lvl.toUpperCase().padEnd(5)} [${scope}] ${msg}${tail}`);
	};
	return { debug: emit("debug"), info: emit("info"), warn: emit("warn"), error: emit("error"), child: (s) => createLogger(level, `${scope}:${s}`, sink) };
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Hand a file or a web address to the system: the program the owner set for it opens it. Only ever on the owner's click. */
export function openInSystem(target: string): void {
	// On Windows explorer.exe, which takes the target as one argument: no shell reads it (cmd's start would).
	spawn(process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open", [target], { stdio: "ignore", detached: true, windowsHide: true })
		.on("error", () => {})
		.unref();
}

/** "vite --port 5173" from "node /Users/x/project/node_modules/.bin/vite --port 5173": what a person would call it. */
export function programName(command: string, max = 60): string {
	// Windows writes the program by its path in quotes ("C:\\Program Files\\nodejs\\node.exe" x.js): that is one word.
	const quoted = /^"([^"]+)"(.*)$/.exec(command.trim());
	const words = quoted ? [quoted[1], ...quoted[2].trim().split(/\s+/).filter(Boolean)] : command.trim().split(/\s+/);
	const base = (w: string) => (w.split(/[\\/]/).pop() || w).replace(/\.exe$/i, "");
	// An interpreter in front of a script says less than the script.
	if (words.length > 1 && /^(node|bun|deno|python[\d.]*|ruby|sh|bash|zsh)$/.test(base(words[0])) && !words[1].startsWith("-")) words.shift();
	words[0] = base(words[0]);
	const text = words.join(" ");
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** "12 s", "5 min", "2 h 10 min": how long something has been running. */
export function since(seconds: number): string {
	if (seconds < 60) return `${seconds} s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * How fast a model went, in tokens a second. `read` is how fast it took in the part of the
 * prompt it had not seen before (what a local server calls prompt processing), `write` how fast
 * it produced its answer, thinking included.
 */
export interface Speed {
	read?: number;
	write?: number;
}

/** What one model call took: tokens and milliseconds for each half, as far as they can be told apart. */
export interface CallTiming {
	readTokens: number;
	readMs: number;
	writeTokens: number;
	writeMs: number;
}

/**
 * Split a model call at its first token. Up to there the server read the prompt (`input` new
 * tokens: what it took from its cache costs next to nothing and is not counted); from there
 * to the end it wrote `output` tokens. A half that is too small to say anything is left out:
 * a handful of new tokens after a cache hit measures the round trip, not the model, and an
 * answer that arrived in one piece has no duration.
 */
export function callTiming(input: number, output: number, startedAt: number, firstTokenAt: number, endedAt: number): CallTiming {
	const first = firstTokenAt || endedAt;
	const readMs = startedAt ? Math.max(0, first - startedAt) : 0;
	const writeMs = Math.max(0, endedAt - first);
	const reads = input >= 200 && readMs >= 50;
	const writes = output >= 8 && writeMs >= 200;
	return { readTokens: reads ? input : 0, readMs: reads ? readMs : 0, writeTokens: writes ? output : 0, writeMs: writes ? writeMs : 0 };
}

export function speedOf(t: CallTiming | undefined): Speed {
	if (!t) return {};
	return { ...(t.readMs ? { read: (t.readTokens * 1000) / t.readMs } : {}), ...(t.writeMs ? { write: (t.writeTokens * 1000) / t.writeMs } : {}) };
}

const rate = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n >= 20 ? String(Math.round(n)) : n.toFixed(1));

/** "↑ 1.4k t/s ↓ 42 t/s": up is what the model read, down is what it wrote, as with the token counts. Empty when neither is known. */
export function speedText(s: Speed | undefined): string {
	if (!s) return "";
	return [s.read ? `↑ ${rate(s.read)} t/s` : "", s.write ? `↓ ${rate(s.write)} t/s` : ""].filter(Boolean).join(" ");
}

/** A part of an answer that its writer folded away: `<details><summary>what it is</summary> ... </details>`. */
export interface Fold {
	/** Where it lies in the text: from its opening tag to the end of its closing tag, or to the end of the text. */
	from: number;
	to: number;
	/** What stands for it while it is folded, as written. None when it has no `<summary>`. */
	summary?: string;
	/** `<details open>`: it starts open. */
	open: boolean;
	/** What it folds away, as written. Another block inside it is part of this text. */
	body: string;
	/** The text ends before its summary does: all that can be said of it yet is that it is there. */
	pending: boolean;
}

/**
 * The stretches of a markdown text that are code: fenced blocks and inline code. A tag written
 * there is text. `live`: the text is still being written, so code that is not closed yet runs to
 * the end of it.
 */
function codeIn(text: string, live: boolean): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	const inline = (from: number, to: number) => {
		for (let i = from; i < to; ) {
			if (text[i] === "\\") i += 2;
			else if (text[i] !== "`") i++;
			else {
				let n = 1;
				while (text[i + n] === "`") n++;
				// Closed by as many backticks as opened it, in the same paragraph.
				let close = -1;
				for (let j = i + n; j < to && close < 0; ) {
					if (text[j] !== "`") {
						j++;
						continue;
					}
					let m = 1;
					while (text[j + m] === "`") m++;
					if (m === n) close = j;
					j += m;
				}
				if (close < 0 && live && to === text.length) close = to;
				if (close >= 0) out.push([i, close + n]);
				i = close < 0 ? i + n : close + n;
			}
		}
	};
	let fence: { mark: string; from: number } | undefined;
	let paragraph = -1;
	let at = 0;
	for (const line of text.split("\n")) {
		const end = at + line.length;
		const mark = /^[ \t>]*(`{3,}|~{3,})(.*)$/.exec(line);
		if (fence) {
			if (mark && mark[1][0] === fence.mark[0] && mark[1].length >= fence.mark.length && !mark[2].trim()) {
				out.push([fence.from, end]);
				fence = undefined;
			}
		} else if (mark && !(mark[1][0] === "`" && mark[2].includes("`"))) {
			if (paragraph >= 0) inline(paragraph, at);
			paragraph = -1;
			fence = { mark: mark[1], from: at };
		} else if (!line.trim()) {
			if (paragraph >= 0) inline(paragraph, at);
			paragraph = -1;
		} else if (paragraph < 0) paragraph = at;
		at = end + 1;
	}
	if (fence) out.push([fence.from, text.length]);
	else if (paragraph >= 0) inline(paragraph, text.length);
	return out;
}

/**
 * The folded blocks of a markdown text, the outermost ones: what is inside one, another block
 * too, is its body. Tags are read whatever their capitals and attributes; one inside code is not
 * a tag. A block whose closing tag is missing runs to the end of the text.
 */
export function foldsIn(markdown: string, live = false): Fold[] {
	if (!/<details/i.test(markdown)) return [];
	const code = codeIn(markdown, live);
	const out: Fold[] = [];
	const fold = (tag: RegExpExecArray, end: number, to: number) => {
		const closed = end < to;
		const inner = markdown.slice(tag.index + tag[0].length, end).trimStart();
		const opens = /^<summary(?:\s[^<>]*)?>/i.exec(inner);
		const closes = opens ? /<\/summary\s*>/i.exec(inner) : null;
		const line = inner.indexOf("\n") < 0 ? inner.length : inner.indexOf("\n");
		// A summary that was never closed is its first line: the rest is what the block holds.
		const summary = opens ? inner.slice(opens[0].length, closes ? closes.index : line) : undefined;
		const waits = !opens && !closed && (/^<summary\s[^<>]*$/i.test(inner) || "<summary".startsWith(inner.toLowerCase()));
		const body = waits ? "" : !opens ? inner : inner.slice(closes ? closes.index + closes[0].length : line);
		out.push({ from: tag.index, to, summary, open: /\sopen(?:[\s=]|$)/i.test(tag[2]), body, pending: waits || (!!opens && !closes && !closed) });
	};
	let depth = 0;
	let first: RegExpExecArray | undefined;
	for (const tag of markdown.matchAll(/<(\/?)details((?:\s[^<>]*)?)>/gi)) {
		if (code.some(([a, z]) => tag.index >= a && tag.index < z)) continue;
		if (!tag[1]) {
			if (depth++ === 0) first = tag;
		} else if (depth > 0 && --depth === 0) fold(first!, tag.index, tag.index + tag[0].length);
	}
	if (depth > 0) fold(first!, markdown.length, markdown.length);
	return out;
}

/** A block's summary on one line; "Details" for a block that has none, as a browser calls it. */
export const summaryOf = (fold: Fold) => (fold.summary ?? "").replace(/\s+/g, " ").trim() || "Details";

/**
 * A text with folded blocks for a place that folds nothing (a chat message): each block becomes
 * its summary on a line of its own with what it held under it, so that no tags are left to read.
 */
export function unfolded(markdown: string): string {
	const folds = foldsIn(markdown);
	if (!folds.length) return markdown;
	const parts: string[] = [];
	let at = 0;
	for (const f of folds) {
		parts.push(markdown.slice(at, f.from).trim(), `▾ ${summaryOf(f)}\n${unfolded(f.body).trim()}`.trim());
		at = f.to;
	}
	parts.push(markdown.slice(at).trim());
	return parts.filter(Boolean).join("\n\n");
}
