export type QuoteSource = { task: number; part: "prompt" | "answer" } | "letter" | "welcome";

export interface SentQuote {
	text: string;
	source: QuoteSource;
	reply?: string;
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

export function withQuotes(quotes: ReadonlyArray<{ text: string; reply?: string }>, body: string): string {
	return [...quotes.flatMap((q) => [quoteBlock(q.text), q.reply?.trim() ?? ""]), body.trim()].filter(Boolean).join("\n\n");
}

export function sameSource(a: QuoteSource, b: QuoteSource): boolean {
	return typeof a === "string" || typeof b === "string" ? a === b : a.task === b.task && a.part === b.part;
}

export function shortQuotes(quotes: SentQuote[] | undefined, max = 2000): SentQuote[] | undefined {
	const cut = (s: string) => (s.length > max ? `${s.slice(0, max)}…` : s);
	return quotes?.map((q) => ({ ...q, text: cut(q.text), ...(q.reply === undefined ? {} : { reply: cut(q.reply) }) }));
}

export function readQuotes(value: unknown): SentQuote[] | string {
	if (!Array.isArray(value)) return "quotes is a list of { text, source }";
	if (value.length > MAX_QUOTES) return `at most ${MAX_QUOTES} quotes`;
	const out: SentQuote[] = [];
	for (const q of value) {
		if (!q || typeof q !== "object") return "each quote is { text, source }";
		const { text, source, reply } = q as { text?: unknown; source?: unknown; reply?: unknown };
		if (typeof text !== "string" || !text.trim()) return "a quote's text is a string that is not empty";
		if (text.length > MAX_QUOTE_CHARS) return `a quote's text has at most ${MAX_QUOTE_CHARS} characters`;
		if (reply !== undefined && typeof reply !== "string") return "a quote's reply is a string";
		if (typeof reply === "string" && reply.length > MAX_QUOTE_CHARS) return `a quote's reply has at most ${MAX_QUOTE_CHARS} characters`;
		const said = typeof reply === "string" && reply.trim() ? { reply: reply.trim() } : {};
		if (source === "letter" || source === "welcome") out.push({ text, source, ...said });
		else if (source && typeof source === "object" && Number.isSafeInteger((source as any).task) && (source as any).task > 0 && ((source as any).part === "prompt" || (source as any).part === "answer")) out.push({ text, source: { task: (source as any).task, part: (source as any).part }, ...said });
		else return 'a quote\'s source is "letter", "welcome" or { task, part: "prompt" | "answer" }';
	}
	return out;
}
