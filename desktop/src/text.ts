// Small things said in many places: how a duration, a size, a speed and a path are written.
import type { Stats, UndoResult } from "./api.ts";

export const short = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
export const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The system the page runs on, as the bridge said when the page started (`data-platform` on the
 * root element: darwin, win32, linux, or a phone's or the web client's). A page that was told
 * nothing (Storybook before a story sets it) is drawn as a Mac's.
 */
export const platform = (): string => (typeof document === "undefined" ? undefined : document.documentElement.dataset.platform) || "darwin";

/** Whether the app's keys are the Mac's (⌘ is the key of its shortcuts): a Mac, and an iPad with a keyboard. Elsewhere it is Ctrl. */
export const macKeys = (p = platform()) => p === "darwin" || p === "ios";

/** What a newer app is on the release's page for this system, and what to do with it. */
export function newApp(p = platform()): { what: string; how: string } {
	if (p === "win32") return { what: "an installer", how: "download it, quit Pine and run it" };
	if (p === "linux") return { what: "an AppImage and a .deb package", how: "download the kind you installed, quit Pine and put it in place of this one" };
	return { what: "a disk image", how: "download it, quit Pine and put the new app in place of this one" };
}

const HELD: Record<string, string> = { "⌃": "Ctrl", "⌘": "Ctrl", "⌥": "Alt", "⇧": "Shift" };
const NAMED: Record<string, string> = { "↩": "Enter", "⇥": "Tab" };

/**
 * A shortcut as this system writes it. Shortcuts are written the Mac's way, "⇧⌘T" or "⌘1 … ⌘9"
 * (each word one shortcut), and a Mac shows them so; elsewhere they are "Ctrl+Shift+T", the
 * words of the keys joined with "+", Ctrl first, as the menus there say them.
 */
export function shortcut(keys: string, p = platform()): string {
	if (macKeys(p)) return keys;
	return keys
		.split(" ")
		.map((word) => {
			const m = /^([⌃⌥⇧⌘]+)(.+)$/.exec(word);
			if (!m) return NAMED[word] ?? word;
			const held = new Set([...m[1]].map((c) => HELD[c]));
			return [...["Ctrl", "Alt", "Shift"].filter((k) => held.has(k)), NAMED[m[2]] ?? m[2]].join("+");
		})
		.join(" ");
}

let home = "";
/** The owner's home folder, learned from a path the daemon names (an agent's workspace under ~/.pine, say). */
export function learnHome(p: string | undefined): void {
	const m = p && /^(\/Users\/[^/]+|\/home\/[^/]+)/.exec(p);
	if (m && !home) home = m[1];
}
export const tilde = (p: string) => (home && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p);
export const baseName = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

export const took = (ms: number | undefined) => (ms === undefined ? "" : ms < 1000 ? `${Math.round(ms)} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);
export const clock = (secs: number) => (secs < 60 ? `${secs}s` : secs < 3600 ? `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s` : `${Math.floor(secs / 3600)}h ${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}m`);
export const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
export const count = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function ago(ts: number, now = Date.now()): string {
	const s = Math.max(0, Math.round((now - ts) / 1000));
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)} min ago`;
	if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
	const d = Math.floor(s / 86_400);
	return d < 30 ? `${d} d ago` : new Date(ts).toLocaleDateString();
}

export function until(ts: number, now = Date.now()): string {
	const s = Math.round((ts - now) / 1000);
	if (s <= 0) return "soon";
	if (s < 3600) return `in ${Math.max(1, Math.floor(s / 60))} min`;
	if (s < 86_400) return `in ${Math.floor(s / 3600)} h`;
	return `in ${Math.floor(s / 86_400)} d`;
}

export interface Speed {
	read?: number;
	write?: number;
}

export function speedOf(t: Stats["timing"]): Speed {
	if (!t) return {};
	return { ...(t.readMs ? { read: (t.readTokens * 1000) / t.readMs } : {}), ...(t.writeMs ? { write: (t.writeTokens * 1000) / t.writeMs } : {}) };
}

const rate = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n >= 20 ? String(Math.round(n)) : n.toFixed(1));

/** "↑ 1.4k t/s ↓ 42 t/s": up is what the model read, down what it wrote. Empty when neither is known. */
export const speedText = (s: Speed | undefined) => (s ? [s.read ? `↑ ${rate(s.read)} t/s` : "", s.write ? `↓ ${rate(s.write)} t/s` : ""].filter(Boolean).join(" ") : "");

export const childKind = (kind: string) => (kind === "subagent" ? "sub-agent" : kind === "delegate" ? "delegated task" : kind);
export const isGoalRound = (kind: unknown, label: unknown) => kind === "notify" && typeof label === "string" && (label.startsWith("goal: ") || label.startsWith("swarm: "));

/** What an event that woke the agent reported, without the frame pine put around it for the model. */
export const eventBody = (prompt: string) =>
	prompt
		.replace(/^\[(?:You are subscribed to|Your owner wrote|Somebody wrote|It is time for your schedule)[\s\S]*?\]\n\n/, "")
		.replace(/^\[event on [^\n]*\]\n/, "")
		.replace(/^Event [^\n]*:\n/, "");

export function taskSummary(status: string, stats: Stats | undefined, error?: string): string {
	return [status, ...(stats ? [took(stats.ms), plural(stats.tools.length, "tool call"), `${count(stats.input + (stats.cached ?? 0))}↑ ${count(stats.output)}↓`, speedText(speedOf(stats.timing))] : []), ...(error ? [error] : [])].filter(Boolean).join(" · ");
}

const quoted = (text: string) => `“${short(oneLine(text), 80)}”`;
const files = (n: number) => plural(n, "file");

/**
 * What is said after a message was taken back or brought back: which message, which files, and
 * what could not be taken back. Said every time: an undo that is believed to have undone more
 * than it did is worse than none.
 */
export function undoLines(r: UndoResult, redo: boolean): { head: string; lines: Array<{ text: string; tone?: "good" | "warn" }> } {
	if (!redo && r.waiting) return { head: `Withdrawn before work on it began: ${quoted(r.prompt)}`, lines: [{ text: "What you wrote is back in the message box: edit it and send it again." }] };
	const lines: Array<{ text: string; tone?: "good" | "warn" }> = [];
	if (!redo && r.stopped) lines.push({ text: `What was still running was stopped first (${plural(r.stopped, "task")}).` });
	const f = r.restored;
	if (f) {
		const n = f.changed + f.removed + f.back;
		const where = tilde(f.root);
		if (!n) lines.push({ text: redo ? `No file had to be changed in ${where}.` : `No file had to be restored in ${where}: the message changed none that pine records.` });
		else {
			const parts = [f.changed ? `${f.changed} changed back` : "", f.removed ? `${f.removed} removed` : "", f.back ? `${f.back} brought back` : ""].filter(Boolean).join(", ");
			const names = `${f.files.join(", ")}${n > f.files.length ? `, and ${n - f.files.length} more` : ""}`;
			lines.push({ tone: "good", text: redo ? `${files(n)} in ${where} ${n === 1 ? "is" : "are"} again as the message left ${n === 1 ? "it" : "them"} (${parts}): ${names}` : `${files(n)} restored in ${where} (${parts}): ${names}` });
		}
		if (f.left.length) lines.push({ tone: "warn", text: `Left as ${f.left.length === 1 ? "it is" : "they are"}, too large to be recorded: ${f.left.slice(0, 8).join(", ")}` });
	}
	if (r.note) lines.push({ tone: "warn", text: r.note });
	if (redo) lines.push({ text: `Undo takes it back again${r.redo ? `; redo brings back ${r.redo === 1 ? "one more message" : `${r.redo} more messages`}` : ""}.` });
	else {
		lines.push({ text: "Not undone: changes made outside this folder, files git ignores, files over 2 MB, and anything that was sent out." });
		lines.push({ text: `What you wrote is back in the message box: edit it and send it again. Redo restores it until you send something new${r.more ? ". Undo again to take back the message before it too" : ""}.` });
	}
	return { head: `${redo ? "Brought back" : "Taken back"}: ${quoted(r.prompt)}`, lines };
}

/** Letters in order, with anything between them: "agts" finds "src/agents.ts". Lower is better; -1 does not fit. */
export function fuzzy(query: string, text: string): number {
	const q = query.toLowerCase();
	const t = text.toLowerCase();
	if (!q) return 0;
	const at = t.indexOf(q);
	if (at >= 0) return at === 0 ? 0 : 1 + at / 1000;
	let i = 0;
	for (const ch of t) if (ch === q[i] && ++i === q.length) return 5;
	return -1;
}

export const MODES: Array<{ value: string; label: string; about: string }> = [
	{ value: "auto", label: "Auto", about: "Works without asking and without a sandbox: your whole account and the network. Critical actions are still asked about." },
	{ value: "safe", label: "Safe", about: "Works without asking inside a sandbox: the agent's own folders, no network. Asks for what lies outside." },
	{ value: "plan", label: "Plan", about: "Looks, reads and asks, and changes nothing. The answer is a plan. Until pine restarts." },
	{ value: "manual", label: "Manual", about: "In a sandbox, and each command, edit and message waits for your go-ahead." },
	{ value: "bypass", label: "Bypass", about: "No sandbox and no questions. Nothing is checked. Until pine restarts." },
];

export const REASONING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
