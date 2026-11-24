// What the owner quotes from a conversation in the Pine app: each quote's text, and where it was taken
// from (the task whose message or answer it is, or the welcome letter or card). The agent reads the
// quotes as markdown quotes in front of the message; the daemon keeps them beside it (`TaskMeta.quotes`,
// `.body`) so that a UI shows them as they were sent and goes back to where each came from. The daemon
// never reads what a source names: it is a place on the page, not a way to another conversation's text.
// Pure, with no Node in it: the app's page uses it too.
export type QuoteSource = { task: number; part: "prompt" | "answer" } | "letter" | "welcome";

export interface SentQuote {
	text: string;
	source: QuoteSource;
}

export const MAX_QUOTES = 20;
export const MAX_QUOTE_CHARS = 10_000;

export function quoteBlock(text: string): string {
	return text
		.trim()
		.split(/\r?\n/)
		.map((line) => (line.trim() ? `> ${line.trimEnd()}` : ">"))
		.join("\n");
}

export function withQuotes(quotes: ReadonlyArray<{ text: string }>, body: string): string {
	return [...quotes.map((q) => quoteBlock(q.text)), body.trim()].filter(Boolean).join("\n\n");
}

/**
 * The quotes as they fit in `room` characters of quote blocks, in order: the first that does not fit
 * whole is cut (with "…"), and those after it are left out.
 */
export function fitQuotes(quotes: SentQuote[], room: number): SentQuote[] {
	const out: SentQuote[] = [];
	let left = room;
	for (const q of quotes) {
		const size = quoteBlock(q.text).length + 2;
		if (size <= left) {
			out.push(q);
			left -= size;
			continue;
		}
		let keep = Math.min(q.text.length, left);
		while (keep > 0 && quoteBlock(`${q.text.slice(0, keep).trimEnd()}…`).length + 2 > left) keep = Math.floor(keep * 0.9);
		if (keep > 0) out.push({ ...q, text: `${q.text.slice(0, keep).trimEnd()}…` });
		break;
	}
	return out;
}

export function sameSource(a: QuoteSource, b: QuoteSource): boolean {
	return typeof a === "string" || typeof b === "string" ? a === b : a.task === b.task && a.part === b.part;
}

export function shortQuotes(quotes: SentQuote[] | undefined, max = 2000): SentQuote[] | undefined {
	return quotes?.map((q) => (q.text.length > max ? { ...q, text: `${q.text.slice(0, max)}…` } : q));
}

export function readQuotes(value: unknown): SentQuote[] | string {
	if (!Array.isArray(value)) return "quotes is a list of { text, source }";
	if (value.length > MAX_QUOTES) return `at most ${MAX_QUOTES} quotes`;
	const out: SentQuote[] = [];
	for (const q of value) {
		if (!q || typeof q !== "object") return "each quote is { text, source }";
		const { text, source } = q as { text?: unknown; source?: unknown };
		if (typeof text !== "string" || !text.trim()) return "a quote's text is a string that is not empty";
		if (text.length > MAX_QUOTE_CHARS) return `a quote's text has at most ${MAX_QUOTE_CHARS} characters`;
		if (source === "letter" || source === "welcome") out.push({ text, source });
		else if (source && typeof source === "object" && Number.isSafeInteger((source as any).task) && (source as any).task > 0 && ((source as any).part === "prompt" || (source as any).part === "answer")) out.push({ text, source: { task: (source as any).task, part: (source as any).part } });
		else return 'a quote\'s source is "letter", "welcome" or { task, part: "prompt" | "answer" }';
	}
	return out;
}
