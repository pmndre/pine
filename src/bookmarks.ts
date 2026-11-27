import { MAX_QUOTE_CHARS, type QuoteSource, readSource } from "./quotes.ts";

export interface Bookmark {
	id: string;
	text: string;
	source: QuoteSource;
	start: number;
	end: number;
	created: number;
}

export type NewBookmark = Pick<Bookmark, "text" | "source" | "start" | "end">;

export const MAX_BOOKMARKS = 200;

export function readBookmark(value: unknown): NewBookmark | string {
	if (!value || typeof value !== "object") return "a bookmark is { text, source, start, end }";
	const { text, source, start, end } = value as { text?: unknown; source?: unknown; start?: unknown; end?: unknown };
	if (typeof text !== "string" || !text.trim()) return "a bookmark's text is a string that is not empty";
	if (text.length > MAX_QUOTE_CHARS) return `a bookmark's text has at most ${MAX_QUOTE_CHARS} characters`;
	const from = readSource(source);
	// A turn's questions change form as they are folded and answered: a place in them would not be found again.
	if (!from || (typeof from === "object" && from.part === "questions")) return 'a bookmark\'s source is "letter", "welcome" or { task, part: "prompt" | "answer" }';
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || (start as number) < 0 || (end as number) <= (start as number)) return "a bookmark's start and end are whole numbers, 0 <= start < end";
	return { text, source: from, start: start as number, end: end as number };
}

export function bookmarkList(value: unknown): Bookmark[] {
	if (!Array.isArray(value)) return [];
	const out: Bookmark[] = [];
	for (const b of value) {
		const read = readBookmark(b);
		if (typeof read === "string" || typeof b.id !== "string" || !b.id) continue;
		out.push({ id: b.id, ...read, created: Number.isFinite(b.created) ? b.created : 0 });
	}
	return out.slice(-MAX_BOOKMARKS);
}

export function remapBookmarks(list: Bookmark[], ids: Map<number, number>): Bookmark[] {
	return list.flatMap((b) => (typeof b.source === "string" ? [b] : ids.has(b.source.task) ? [{ ...b, source: { ...b.source, task: ids.get(b.source.task) as number } }] : []));
}
