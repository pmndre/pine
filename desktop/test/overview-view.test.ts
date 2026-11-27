// The overview (examples/home/views/overview.ts), pine's third view, without a window: which cards there are and in which
// order, what a card knows of its agent (busy, asking, whose names it carries), that a closer look never says less; the lines
// that join two cards while something happens between them, what the pointer over a card is wired to, what the camera keeps
// in view, and the whole board drawn on a canvas that only counts. The view is loaded as the frame loads it: "pine/view" is
// pine's src/view-kit.ts.
//
// What is asserted is the view's model: ids, order, flags, counts, and names and numbers the test put in. Where a card
// stands, how large it is, how a line is routed and how a sentence is worded are the design's, and no test here pins them.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import type { ViewAgent, ViewState, ViewWork } from "../../src/view-kit.ts";

registerHooks({
	resolve: (spec, ctx, next) => (spec === "pine/view" ? { url: pathToFileURL(path.resolve(import.meta.dirname, "../../src/view-kit.ts")).href, shortCircuit: true } : next(spec, ctx)),
});
const view = await import("../../examples/home/views/overview.ts");
const { Recent, layoutOf, contentOf, sentenceOf, causeOf, linksOf, wiringOf, hitAt, hitTask, tipOf, routesOf, focusOf, allOf, held, toBoard, draw, tilesOf, taskWords, rowsOf } = view;

const T0 = 1_800_000_000_000;
const conv = (id: number, more: object = {}) => ({ id, main: false, worktree: false, busy: false, outside: false, ...more });
const agent = (id: string, more: Partial<ViewAgent> = {}): ViewAgent => ({ id, main: false, color: "#22a06b", mode: "safe", mcp: [], skills: [], sources: [], schedules: [], conversations: [conv(1, { main: true })], ...more });
const work = (id: number, a: string, more: Partial<ViewWork> = {}): ViewWork => ({ id, agent: a, copy: false, depth: 0, from: { k: "you" }, doing: "thinking", waitingOn: [], started: T0, tools: 0, asking: false, held: false, outside: false, branch: false, worktree: false, ...more });

const AGENTS: ViewAgent[] = [
	agent("main", { main: true, mcp: ["web", "browser"], skills: ["pine"], sources: ["telegram"], schedules: ["morning"], conversations: [conv(1, { main: true }), conv(2, { branchOf: 1, worktree: true }), conv(3, { goal: "active" })] }),
	agent("books", { mcp: ["web"], skills: ["invoices", "taxes", "ledger"], sources: ["inbox"], schedules: ["daily-report", "month-end"], conversations: [conv(4, { main: true })] }),
	agent("scout", { mode: "auto", mcp: ["web", "browser", "maps", "media"], skills: ["research"], sources: ["feed"] }),
	agent("coder", { mode: "bypass", skills: ["review", "release", "tests", "docs", "refactor", "deploy", "lint"] }),
];
const state = (works: ViewWork[], at = T0, more: Partial<ViewState> = {}): ViewState => ({
	at,
	agents: AGENTS,
	work: works,
	inputs: [
		{ id: "you", kind: "you", name: "you", count: 3, agents: [], failing: false },
		{ id: "clock", kind: "clock", name: "clock", count: 2, agents: [], failing: false },
		{ id: "source:inbox", kind: "source", name: "inbox", type: "mail", count: 12, last: at - 4000, agents: ["books"], failing: false },
		{ id: "source:telegram", kind: "source", name: "telegram", type: "telegram", count: 40, agents: ["main"], failing: false },
		{ id: "source:feed", kind: "source", name: "feed", type: "feed", count: 2, agents: ["scout"], failing: true },
		{ id: "outside:hook", kind: "outside", name: "hook", count: 1, agents: [], failing: false },
	],
	schedules: [
		{ name: "daily-report", agent: "books", when: "0 9 * * *", next: at + 3 * 3600_000 },
		{ name: "month-end", agent: "books", when: "0 8 1 * *", next: at + 9 * 86_400_000 },
		{ name: "morning", agent: "main", when: "every 30m", next: at + 40_000 },
	],
	boards: [],
	dark: true,
	focused: true,
	...more,
});
// A piece of work of main's, from the owner, that hands a task to scout, which starts two copies; and books, woken by its inbox.
const STORY = (now: number) => [
	work(1, "main", { started: now - 60_000, doing: "waiting", waitingOn: [2], conversation: 1 }),
	work(2, "scout", { started: now - 50_000, parent: 1, depth: 1, from: { k: "agent", id: "main" }, doing: "tool", tool: "mcp__web__web_search", mcp: "web", mode: "safe", held: true }),
	work(3, "scout", { started: now - 30_000, parent: 2, depth: 2, copy: true, from: { k: "copy", id: "scout" }, doing: "tool", tool: "grep" }),
	work(4, "scout", { started: now - 28_000, parent: 2, depth: 2, copy: true, from: { k: "copy", id: "scout" } }),
	work(5, "books", { started: now - 20_000, from: { k: "source", name: "inbox" }, doing: "tool", tool: "read", skill: "invoices", outside: true, steps: { done: 2, total: 5 } }),
	work(6, "coder", { started: now - 100_000, finished: now - 70_000, doing: "failed", from: { k: "clock", name: "nightly" } }),
];

test("what an agent is doing is said in words that name whom or what it is about, a question comes before anything else, and why it works names who caused it", () => {
	const s = state(STORY(T0));
	const lower = (t: string) => t.toLowerCase();
	assert.ok(lower(sentenceOf(s.work[0], s)).includes("scout"), "whom it waits for");
	assert.ok(lower(sentenceOf(s.work[1], s)).includes("web"), "the server whose tool it uses");
	assert.ok(lower(sentenceOf(s.work[4], s)).includes("invoices"), "the skill it reads");
	assert.ok(lower(sentenceOf(work(9, "main", { doing: "tool", tool: "something_new" }), s)).replace(/[_ ]/g, "").includes("somethingnew"), "a tool the view has no words for is called by its name");
	assert.ok(sentenceOf(work(9, "scout", { doing: "waiting", waitingOn: [3, 4] }), s).includes("2"), "how many sub-agents it waits for");
	// A question comes first: whatever the work does besides, it says the same, and not what the tool alone would say.
	const asking = [work(9, "main", { doing: "tool", tool: "bash", asking: true }), work(9, "main", { doing: "writing", asking: true })].map((w) => sentenceOf(w, s));
	assert.equal(asking[0], asking[1]);
	assert.notEqual(asking[0], sentenceOf(work(9, "main", { doing: "tool", tool: "bash" }), s));
	// Each state has words of its own.
	const each = [work(9, "main", { doing: "tool", tool: "bash" }), work(9, "main", { doing: "writing" }), work(9, "main", { doing: "thinking" }), work(9, "main", { doing: "tool", tool: "grep" })].map((w) => sentenceOf(w, s));
	assert.ok(each.every((t) => t.length > 0) && new Set(each).size === each.length, each.join(" | "));
	// Why: the owner, the agent that delegated it, the source or the schedule that triggered it; a sub-agent needs no why.
	const causes = s.work.map((w) => causeOf(w));
	assert.deepEqual(causes.map((c) => c.length > 0), [true, true, false, false, true, true]);
	assert.ok(causes[1].includes("main") && causes[4].includes("inbox") && causes[5].includes("nightly"), causes.join(" | "));
});

/** Text widths as a canvas would measure them, near enough: the size of the font times the number of letters. */
const measure = (font: string, text: string) => text.length * Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 12) * 0.55;
/** The kinds of thing a card draws, and the tasks it draws as tiles or as rows, by their numbers. */
const kinds = (pieces: any[]) => new Set<string>(pieces.map((x) => x.k));
const tasksAs = (pieces: any[], k: "tile" | "row") => pieces.filter((x) => x.k === k).map((x) => x.task.id);
/** Whether any of the words holds all of these parts: a name or a number the test put in, however it is worded around them. */
const says = (texts: string[], ...parts: Array<string | number>) => texts.some((t) => parts.every((p) => t.toLowerCase().includes(String(p).toLowerCase())));
const words = (pieces: any[]) => pieces.filter((x) => x.k === "text").map((x) => x.text);
/** The sizes a card of an agent has on the panel, from far to near: its size on the board times the zoom. */
const ZOOMS = [0.2, 0.5, 1, 1.5, 2, 3];
const at = (b: any, z: number) => [b.w * z, b.h * z] as const;

test("three columns: triggers, agents, tools; which cards stand in each and in which order, and what a card knows of whom it is for", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, T0);
	assert.equal(l.cols.length, 3);
	const of = (col: number) => l.boxes.filter((b: any) => b.col === col).map((b: any) => b.id);
	assert.deepEqual(of(0), ["you", "source:feed", "source:inbox", "source:telegram", "sched:morning", "sched:daily-report", "sched:month-end", "outside:hook"], "you, then the event sources, then the schedules, the one that is due first on top");
	assert.deepEqual(of(1), ["agent:main", "agent:scout", "agent:books", "agent:coder"], "those that work on top, scout under main, which handed it its task; the idle one below them");
	// Only scout works: it stands on top. When its work ends it keeps its place while its answer goes back, then joins the idle ones in pine's order.
	const agentsOf = (works: ViewWork[], now: number) => layoutOf(state(works, now), now).boxes.filter((b: any) => b.col === 1).map((b: any) => b.agent.id);
	assert.deepEqual(agentsOf([work(1, "scout", { started: T0 - 5000 })], T0), ["scout", "main", "books", "coder"]);
	const done = [work(1, "scout", { started: T0 - 5000, doing: "done", finished: T0 })];
	assert.deepEqual(agentsOf(done, T0 + 2000), ["scout", "main", "books", "coder"]);
	assert.deepEqual(agentsOf(done, T0 + 6000), ["main", "books", "scout", "coder"]);
	assert.deepEqual(of(2).slice(0, 4), ["mcp:web", "mcp:browser", "mcp:maps", "mcp:media"], "what most agents have comes first");
	assert.deepEqual(layoutOf(state([]), T0).boxes.map((b: any) => b.id).sort(), l.boxes.map((b: any) => b.id).sort(), "a busy board and a quiet one: the same cards");
	// What a card says beside its name carries the names it is about; a source that fails is marked so.
	const box = (id: string) => l.byId.get(id)!;
	assert.ok(box("source:inbox").sub!.includes("books"));
	assert.deepEqual([box("source:feed").bad, Boolean(box("source:inbox").bad)], [true, false]);
	assert.ok(box("sched:morning").sub!.includes("main"));
	assert.ok(box("mcp:web").sub!.includes("scout"), "who uses it now");
	assert.ok(["main", "scout"].every((a) => box("mcp:browser").sub!.includes(a)), "or, when nobody does, who has it");
	assert.equal(box("agent:coder").right, "bypass", "an agent's mode, as pine names it");
	assert.ok(l.boxes.every((b: any) => b.title.length > 0));
});

test("on a narrow panel the same cards are laid out in three parts, with more cards in a row the more room there is, and every line still has a way", () => {
	const s = state(STORY(T0));
	const wide = layoutOf(s, T0);
	assert.ok(!wide.tall && !wide.parts);
	const perRow: number[] = [];
	for (const width of [336, 536, 900]) {
		const l = layoutOf(s, T0, width);
		assert.ok(l.tall && l.parts!.length === 3);
		assert.equal(l.cols.length, 3);
		assert.deepEqual([...l.boxes.map((b: any) => b.id)].sort(), [...wide.boxes.map((b: any) => b.id)].sort(), "the same cards");
		assert.equal(l.boxes.filter((b: any) => b.col === 0)[0].id, "you", "you come first among the triggers");
		perRow.push(l.parts![1].n);
		const links = [
			{ from: "source:inbox", to: "agent:books", color: "#22a06b", live: true },
			{ from: "you", to: "agent:main", color: "#3b82f6", live: true },
			{ from: "agent:main", to: "you", color: "ask", live: true },
			{ from: "agent:scout", to: "mcp:web", color: "#f59e0b", live: true },
			{ from: "agent:main", to: "agent:scout", color: "#3b82f6", live: true, side: true },
			{ from: "agent:scout", to: "agent:main", color: "#f59e0b", live: true, side: true, back: true },
		];
		assert.ok(routesOf(links, l).every((pts) => pts && pts.length >= 2), `every line has a way at ${width}`);
	}
	assert.ok(perRow[0] <= perRow[1] && perRow[1] <= perRow[2] && perRow[0] < perRow[2], `agents in a row: ${perRow.join(", ")}`);
});

test("the more room a card has the more it says, the most important first, and a closer look never takes back what was said", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, T0);
	const pieces = (id: string, z: number) => contentOf(l.byId.get(id)!, s, T0, ...at(l.byId.get(id)!, z), measure) as any[];
	const card = (id: string, z: number) => words(pieces(id, z));
	// From far an agent is its avatar; then its name; then what it is doing and why.
	assert.deepEqual([...kinds(pieces("agent:scout", 0.2))], ["avatar"]);
	assert.deepEqual(card("agent:scout", 0.5), ["scout"]);
	assert.ok(card("agent:scout", 1).includes(sentenceOf(s.work[1], s)), "what it is doing, as the view says it");
	assert.ok(says(card("agent:scout", 1), "main"), "and who delegated it");
	// Closer: that it is held to a stricter mode; closer still, what it is connected to.
	assert.ok(says(card("agent:scout", 1.5), "safe"), "limited to the mode of who handed it the work");
	assert.ok(says(card("agent:scout", 2), "feed") && says(card("agent:scout", 2), "research"), "its event source and its skill, by name");
	assert.ok(card("agent:main", 1).includes(sentenceOf(s.work[0], s)));
	assert.ok(says(card("agent:main", 1.5), "scout", "web"), "the agent it waits for, and what that one is using");
	assert.ok(kinds(pieces("agent:books", 1)).has("steps"), "its to-do list, as a bar of steps");
	// An idle agent says less than one at work, and from close by more than from far.
	assert.ok(card("agent:coder", 1).includes("coder"));
	assert.ok(card("agent:coder", 1.5).length > card("agent:coder", 1).length);
	// Each closer look says all the one before it did (but a count of what it had no room for, "+1 more"), and more.
	// What is cut is cut with an ellipsis, never into nothing.
	for (const b of l.boxes) {
		let before: string[] = [];
		for (const z of ZOOMS) {
			const now = words(contentOf(b, s, T0, ...at(b, z), measure));
			const whole = (t: string) => t.replace(/…$/, "");
			for (const t of before.filter((x) => !/^\+\d+ /.test(x))) assert.ok(now.some((x) => x.startsWith(whole(t)) || whole(t).startsWith(whole(x))), `${b.id} at ${z}: "${t}" was said further out, and is gone: ${now}`);
			assert.ok(now.every((t) => t.length > 0 && t !== "…"), `${b.id} at ${z}`);
			before = now;
		}
	}
	// A trigger or a tool says who it triggers or who uses it, and from close by all a view knows of it.
	assert.deepEqual(card("source:inbox", 0.5), ["inbox"]);
	assert.ok(says(card("source:inbox", 1), "books"));
	assert.ok(says(card("source:inbox", 2), "mail") && says(card("source:inbox", 2), 12), "its type and how many events it reported");
	assert.ok(card("sched:morning", 1).includes("morning") && says(card("sched:morning", 1), "main"));
	assert.ok(card("mcp:web", 2.5).includes("web") && says(card("mcp:web", 2.5), "main", "books", "scout"), "everybody who has it");
});

test("a question for you is marked at your card and at the agent's, and the agent's card says so", () => {
	const works = STORY(T0);
	const quiet = layoutOf(state(works), T0);
	assert.deepEqual([Boolean(quiet.byId.get("you")!.bad), Boolean(quiet.byId.get("agent:books")!.bad)], [false, false]);
	Object.assign(works[4], { asking: true });
	const s = state(works);
	const l = layoutOf(s, T0);
	assert.deepEqual([l.byId.get("you")!.bad, l.byId.get("agent:books")!.bad], [true, true]);
	assert.ok(l.byId.get("you")!.sub!.includes("1"), "how many questions wait");
	assert.notEqual(l.byId.get("you")!.sub, quiet.byId.get("you")!.sub);
	assert.ok(words(contentOf(l.byId.get("agent:books")!, s, T0, 232, 112, measure)).includes(sentenceOf(works[4], s)));
});

test("a swarm shows at its lead's card in each of its states, keeps the lead on top between its turns, and its board is the swarm's while it runs", () => {
	const swarm = (status: string, more: object = {}) => ({ status, round: 2, until: 8, checking: false, ...more });
	const led = (sw: object | undefined, works: ViewWork[], more: Partial<ViewState> = {}) => {
		const agents = AGENTS.map((a) => (a.id === "coder" ? { ...a, conversations: [conv(9, { main: true, ...(sw ? { swarm: sw } : {}) })] } : a));
		const s = state(works, T0, { agents: agents as ViewAgent[], ...more });
		const l = layoutOf(s, T0);
		return { s, l, card: words(contentOf(l.byId.get("agent:coder")!, s, T0, 232, 112, measure)) };
	};
	const order = (l: ReturnType<typeof layoutOf>) => l.boxes.filter((b) => b.kind === "agent").map((b) => b.title);
	const idle = led(undefined, []);
	assert.ok(order(idle.l).indexOf("coder") > 0 && !idle.l.byId.get("agent:coder")!.busy, "without a swarm it is idle, below those at work");
	// Its lead's turn runs: what it does as ever, and that it leads a swarm, in the round it is in of how many.
	const leadWork = work(20, "coder", { started: T0 - 30_000, doing: "waiting", waitingOn: [21], conversation: 9, from: { k: "pine" }, swarm: "lead" });
	const sub = work(21, "coder", { started: T0 - 20_000, parent: 20, depth: 1, copy: true, from: { k: "copy", id: "coder" }, doing: "tool", tool: "read", conversation: 9, board: 3 });
	let v = led(swarm("active"), [leadWork, sub]);
	assert.ok(v.card.includes(sentenceOf(leadWork, v.s)) && says(v.card, 2, 8), v.card.join(" | "));
	assert.equal(order(v.l)[0], "coder");
	// Between two turns, while its answer is checked: the card says something else, still with the round, and the lead stays where it is.
	const check = work(22, "coder", { started: T0 - 5000, parent: 20, depth: 1, copy: true, from: { k: "copy", id: "coder" }, doing: "tool", tool: "bash", conversation: 9, board: 3, swarm: "check" });
	const checking = led(swarm("active", { checking: true }), [check]);
	assert.ok(says(checking.card, 2, 8), checking.card.join(" | "));
	assert.equal(order(checking.l)[0], "coder");
	// With no work of its own at all for a moment, it is not idle: it leads a swarm, and stays on top.
	v = led(swarm("active"), []);
	assert.ok(says(v.card, 2, 8), v.card.join(" | "));
	assert.notDeepEqual(v.card, idle.card);
	assert.notDeepEqual(v.card, checking.card, "leading and having the answer checked read apart");
	assert.deepEqual([order(v.l)[0], v.l.byId.get("agent:coder")!.busy], ["coder", true]);
	// Its lead asked you something: that is a question for you, at your card, at the agent's, and as a line between the two.
	const waiting = led(swarm("waiting"), []);
	assert.deepEqual([waiting.l.byId.get("you")!.bad, waiting.l.byId.get("agent:coder")!.bad], [true, true]);
	assert.ok(linksOf(waiting.s, waiting.l, T0).some((k) => k.from === "agent:coder" && k.to === "you"));
	// Stopped, or at its limit: said, each in its own words, and the agent is no longer lit.
	const paused = led(swarm("paused"), []);
	const limit = led(swarm("limit"), []);
	assert.equal(paused.l.byId.get("agent:coder")!.busy, false);
	const cards = [idle, v, waiting, paused, limit].map((x) => x.card.join(" | "));
	assert.equal(new Set(cards).size, cards.length, `idle, leading, waiting for you, paused and at its limit all read apart: ${cards.join(" || ")}`);
	assert.deepEqual(led(swarm("done"), []).card, idle.card, "a swarm that is done is over");
	// Its board, in the column of tools, is the swarm's while it runs; once the swarm is done it is that agent's board again.
	const board = { id: 3, scope: "conversation" as const, agent: "coder", conversation: 9, open: 2, taken: 1, done: 1, failed: 0, blocked: 0, notes: 0, workers: [21], tasks: [] };
	const card = (sw: object) => led(sw, [leadWork, sub], { boards: [board] }).l.byId.get("board:3")!;
	assert.equal(card(swarm("active")).title, "coder");
	assert.notEqual(card(swarm("active")).sub, card(swarm("done")).sub);
	assert.equal(led(swarm("active", { checking: true }), [check], { boards: [{ ...board, open: 0, taken: 0, done: 4 }] }).l.byId.get("board:3"), undefined, "a board with nothing left on it steps back, as ever");
	// What just happened, for a moment: a note at the agent, another for each thing that happened.
	const recent = new Recent();
	recent.hear({ k: "swarm", agent: "coder", conversation: 9, status: "active", checking: true }, T0);
	const first = recent.notes.get("coder")!.text;
	recent.hear({ k: "swarm", agent: "coder", conversation: 9, status: "done", checking: false }, T0);
	assert.ok(first && recent.notes.get("coder")!.text && first !== recent.notes.get("coder")!.text);
});

test("a line joins two boxes only while something happens between them", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, T0);
	const lines = linksOf(s, l).map((k: any) => `${k.from} > ${k.to}${k.side ? " (beside)" : ""}`);
	assert.deepEqual(lines.sort(), ["agent:books > skill:invoices", "agent:main > agent:scout (beside)", "agent:scout > mcp:web", "source:inbox > agent:books", "you > agent:main"], "what woke whom, who handed a task to whom, who uses what. Nothing for the agent that rests");
	assert.ok(linksOf(s, l).every((k: any) => k.live));
	// Each is in the color of the agent it happens to; a task handed on in the color of who gave it.
	const colors = Object.fromEntries(AGENTS.map((a) => [a.id, a.color]));
	assert.equal(linksOf(s, l).find((k: any) => k.to === "agent:books")!.color, colors.books);
	// A question goes from the agent to you, in the color of a question, and stands for the line that once woke it.
	const works = STORY(T0);
	Object.assign(works[0], { asking: true, doing: "tool", tool: "send" });
	const asked = linksOf(state(works), l).filter((k: any) => k.from === "you" || k.to === "you").map((k: any) => [k.from, k.to, k.color]);
	assert.deepEqual(asked, [["agent:main", "you", "ask"]], "a name for a color: the drawing makes it the theme's color for a question");
	// When a delegated task ends, its answer goes back: for a few seconds a line from the one that did it to the one that
	// asked, at the right of the agents where the task went out at their left. In the color of what failed if it did. Then it is gone.
	const over = STORY(T0);
	Object.assign(over[1], { doing: "done", finished: T0 - 1000, tool: undefined, mcp: undefined });
	over.splice(2, 2);
	const back = (now: number, doing = "done") => {
		Object.assign(over[1], { doing });
		return linksOf(state(over), l, now).filter((k: any) => k.back);
	};
	assert.deepEqual(back(T0).map((k: any) => [k.from, k.to, k.color, k.side]), [["agent:scout", "agent:main", colors.scout, true]]);
	assert.equal(back(T0, "failed")[0].color, "failed");
	assert.deepEqual(back(T0 + 5000), [], "a few seconds later it is gone");
	assert.ok(routesOf(back(T0), l)[0], "and it has a way to go");
	// What you asked for comes back to you the same way.
	const yours = [work(1, "main", { doing: "done", started: T0 - 9000, finished: T0 - 500 })];
	assert.deepEqual(linksOf(state(yours), l, T0).map((k: any) => [k.from, k.to]), [["agent:main", "you"]]);
	assert.deepEqual(linksOf(state(yours), l, T0 + 9000), []);
	// Nothing happens: no line at all.
	assert.deepEqual(linksOf(state([]), layoutOf(state([]), T0)), []);
});

test("the pointer over a card shows all it is wired to, a tip names what the card is about, and a point on a card finds that card", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, T0);
	const ends = (id: string) => wiringOf(id, s, l).map((k: any) => (k.from === id ? k.to : k.from)).sort();
	assert.deepEqual(ends("agent:books"), ["mcp:web", "sched:daily-report", "sched:month-end", "skill:invoices", "skill:ledger", "skill:taxes", "source:inbox"]);
	assert.deepEqual(ends("mcp:web"), ["agent:books", "agent:main", "agent:scout"], "over a thing: everybody who has it");
	assert.deepEqual(ends("source:inbox"), ["agent:books"]);
	assert.deepEqual(ends("you"), [], "you talk to every agent: that is no wiring");
	assert.deepEqual(wiringOf(undefined, s, l), []);
	assert.ok(wiringOf("agent:books", s, l).every((k: any) => !k.live));
	// A tip is a few lines, the first with the card's name; among them the names and values the state has for it.
	const tip = (id: string) => tipOf(l.byId.get(id), s, T0) as string[];
	for (const [id, name] of [["agent:main", "main"], ["source:feed", "feed"], ["sched:morning", "morning"], ["mcp:web", "web"], ["skill:invoices", "invoices"]]) assert.ok(tip(id).length > 1 && tip(id)[0].includes(name), `${id}: ${tip(id).join(" | ")}`);
	assert.ok(says(tip("agent:main"), "safe") && says(tip("agent:main"), "morning"), "its mode, and the schedule that wakes it next");
	assert.ok(says(tip("source:feed"), "scout"));
	assert.ok(says(tip("sched:morning"), "main") && says(tip("sched:morning"), "every 30m"), "whom it triggers and when, as pine says it");
	assert.ok(says(tip("mcp:web"), "main", "books", "scout"));
	assert.ok(says(tip("skill:invoices"), "books"));
	assert.deepEqual(tipOf(undefined, s, T0), []);
	const b = l.byId.get("agent:scout")!;
	assert.equal(hitAt(l, { x: b.x + b.w / 2, y: b.y + b.h / 2 })?.id, "agent:scout");
	assert.equal(hitAt(l, { x: -1e6, y: -1e6 }), undefined, "off the board is nothing");
});

test("a line gets a way only between two cards there are, and two lines from one card do not start at the same point", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, T0);
	const live = linksOf(s, l);
	assert.ok(live.length > 0 && routesOf(live, l).every((pts: any) => pts && pts.length >= 2), "every line that is there has a way");
	assert.deepEqual(routesOf([{ from: "agent:main", to: "nowhere", color: "#000000", live: true }], l), [undefined]);
	const two = [...STORY(T0), work(8, "coder", { started: T0 - 1000, doing: "thinking" })];
	const l2 = layoutOf(state(two), T0);
	const live2 = linksOf(state(two), l2);
	const fromYou = routesOf(live2, l2).filter((_: any, i: number) => live2[i].from === "you").map((pts: any) => pts[0].join(","));
	assert.equal(fromYou.length, 2);
	assert.notEqual(fromYou[0], fromYou[1]);
});

test("a camera looks at the board: it follows what happens, shows all of it, and stays where the owner put it", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, T0);
	// What of the board a camera shows on a panel, and whether a card is all in it.
	const shows = (cam: any, view: { w: number; h: number }) => {
		const [a, b] = [toBoard({ x: 0, y: 0 }, cam, view), toBoard({ x: view.w, y: view.h }, cam, view)];
		return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
	};
	const has = (seen: any, b: any) => b.x >= seen.x - 0.01 && b.y >= seen.y - 0.01 && b.x + b.w <= seen.x + seen.w + 0.01 && b.y + b.h <= seen.y + seen.h + 0.01;
	// Nothing happens: the top of the board, all three columns of it.
	const panel = { w: 560, h: 420 };
	const rest = focusOf(l, [], panel);
	assert.ok(has(shows(rest, panel), l.byId.get("you")) && has(shows(rest, panel), l.byId.get("mcp:web")), "all three columns");
	// Something happens low on the board, where the camera at rest does not look: it goes there, no further out than before.
	const low = l.boxes.filter((b: any) => b.col === 2).at(-1)!;
	assert.ok(!has(shows(rest, panel), low), "this board is taller than the panel");
	const there = focusOf(l, [low.id], panel);
	assert.ok(has(shows(there, panel), low));
	assert.equal(there.z, rest.z);
	// Two things far apart that do not fit: it goes further out until both do.
	const both = focusOf(l, ["you", low.id], panel);
	assert.ok(both.z < rest.z && has(shows(both, panel), low) && has(shows(both, panel), l.byId.get("you")));
	assert.deepEqual(focusOf(l, ["nothing"], panel), rest, "a box that is gone is not followed");
	// The whole board, in a panel of any shape.
	for (const view of [{ w: 320, h: 300 }, { w: 560, h: 420 }, { w: 1500, h: 400 }, { w: 900, h: 2400 }]) {
		const all = allOf(l, view);
		assert.ok(has(shows(all, view), { x: 0, y: 0, w: l.w, h: l.h }), `${view.w}x${view.h}: ${JSON.stringify(all)}`);
	}
	// Dragged or zoomed by hand it stays where the owner put it, unless that is nowhere: then it is brought back to the board.
	const cam = { x: 200, y: 300, z: 2 };
	assert.deepEqual(held(cam, l), cam);
	const lost = held({ x: -5000, y: 9000, z: 40 }, l);
	assert.ok(lost.z < 40 && lost.x > -5000 && lost.y < 9000, `brought back toward the board: ${JSON.stringify(lost)}`);
	assert.ok(held({ x: 100, y: 100, z: 0.01 }, l).z > 0.01, "nor is the board ever a speck");
});

test("what just happened shows for a moment: a card lights up, an agent's card says a few words, and then no more", () => {
	const recent = new Recent();
	for (const h of [{ k: "event", input: "source:inbox" }, { k: "scheduled", name: "morning", agent: "main" }, { k: "tool", work: 2, agent: "scout", tool: "mcp__web__web_search", mcp: "web" }, { k: "skill", work: 5, agent: "books", skill: "invoices" }, { k: "sent", work: 5, agent: "books", tool: "send" }, { k: "branched", agent: "main", conversation: 2, from: 1, worktree: true }] as any[]) recent.hear(h, T0);
	recent.hear({ k: "answered", work: 2, from: "scout", to: "coder" }, T0);
	const [gave, got] = [recent.notes.get("scout")!.text, recent.notes.get("coder")!.text];
	assert.ok(gave.includes("coder") && got.includes("scout") && gave !== got, `both ends say that an answer went back, each naming the other: ${gave} | ${got}`);
	assert.deepEqual([...recent.hot.keys()], ["source:inbox", "sched:morning", "mcp:web", "skill:invoices"]);
	const s = state(STORY(T0));
	const l = layoutOf(s, T0);
	const said = (id: string, now: number, r?: InstanceType<typeof Recent>) => words(contentOf(l.byId.get(id)!, s, now, 348, 168, measure, r));
	const note = recent.notes.get("books")!.text;
	assert.ok(said("agent:books", T0 + 500, recent).includes(note), "what books just did is on its card");
	assert.ok(!said("agent:books", T0 + 6000, recent).includes(note), "and is gone again");
	assert.ok(said("agent:main", T0 + 500, recent).includes(recent.notes.get("main")!.text));
});

// A canvas that draws nothing and takes every call (a gradient is one that takes its stops): enough to run all of the drawing and see that none of it throws.
function fakeCtx(): any {
	const gradient = () => ({ addColorStop: () => undefined });
	return new Proxy({ measureText: (t: string) => ({ width: t.length * 6 }), createLinearGradient: gradient, createRadialGradient: gradient } as any, { get: (t, k: string) => (k in t ? t[k] : (t[k] = () => undefined)), set: (t, k: string, v) => ((t[k] = v), true) });
}

test("the whole board draws in every state: narrow and wide, dark and light, from near and far, with the pointer over each kind of card", () => {
	const g = fakeCtx();
	const recent = new Recent();
	let frames = 0;
	for (let step = 0; step < 30; step++) {
		const now = T0 + step * 1500;
		const works = STORY(T0).map((w) => ({ ...w }));
		if (step > 8) Object.assign(works[4], { asking: true });
		if (step > 16) Object.assign(works[1], { doing: "done", finished: T0 + 30_000, tool: undefined, mcp: undefined }), Object.assign(works[2], { doing: "cancelled", finished: T0 + 30_000 }), Object.assign(works[3], { doing: "done", finished: T0 + 30_000 });
		if (step > 24) works.length = 0;
		const s = state(works, now, { dark: step % 2 === 0 });
		if (step === 5) for (const h of [{ k: "event", input: "source:inbox" }, { k: "said", work: 1, agent: "main" }, { k: "goal", agent: "main", status: "met" }, { k: "outside", agent: "books" }, { k: "decided", work: 5, agent: "books", allowed: false }, { k: "ended", work: 6, agent: "coder", failed: true }] as any[]) recent.hear(h, now);
		for (const size of [{ w: 320, h: 300 }, { w: 560, h: 700 }, { w: 1500, h: 400 }]) {
			const l = layoutOf(s, now);
			const cam = [focusOf(l, ["agent:scout"], size), allOf(l, size), { x: 300, y: 200, z: 3.5 }, { x: -10, y: 900, z: 0.2 }, { x: 250, y: 150, z: 2 }][step % 5];
			for (const hover of [undefined, "agent:scout", "you", "source:inbox", "sched:morning", "mcp:web", "skill:invoices", "outside:hook"]) {
				draw(g, s, l, now, { hover, selected: step % 3 ? "agent:books" : undefined, recent, cam, view: size });
				frames++;
			}
		}
	}
	assert.equal(frames, 30 * 3 * 8);
	assert.equal(view.default.pineView, 1, "the file's default export is the view");
});

test("a board is a card beside the tools: whose it is and how its tasks stand, as tiles and from close by as rows, and its question counts as one for you", () => {
	const board = (id: number, more: object = {}) => ({ id, scope: "conversation" as const, agent: "scout", conversation: 1, open: 0, taken: 0, done: 0, failed: 0, blocked: 0, notes: 0, workers: [] as number[], tasks: [] as any[], ...more });
	const t = (id: number, st: string, more: object = {}) => ({ id, state: st, after: [] as number[], ...more });
	const works = [
		work(1, "scout", { doing: "waiting", waitingOn: [2, 3], conversation: 1 }),
		work(2, "scout", { parent: 1, depth: 1, copy: true, from: { k: "copy", id: "scout" }, doing: "tool", tool: "grep", board: 7 }),
		work(3, "scout", { parent: 1, depth: 1, copy: true, from: { k: "copy", id: "scout" }, board: 7 }),
	];
	const b7 = board(7, { open: 3, taken: 1, done: 2, notes: 2, workers: [2], tasks: [t(1, "done"), t(2, "taken", { worker: 2, agent: "scout" }), t(3, "open"), t(4, "done", { after: [1] }), t(5, "waiting", { after: [2] }), t(6, "waiting", { after: [3] })] });
	const s = state(works, T0, { boards: [b7, board(8, { scope: "all", agent: undefined, conversation: undefined, name: "bugs", blocked: 1, done: 2 }), board(9, { agent: "books", done: 6 })] as any });
	const l = layoutOf(s, T0);
	// The one with work on it and the one with a name are there; one whose tasks are all settled is not.
	assert.deepEqual(l.boxes.filter((b: any) => b.kind === "board").map((b: any) => [b.id, b.title, Boolean(b.busy), Boolean(b.bad)]), [
		["board:7", "scout", true, false],
		["board:8", "bugs", false, true],
	]);
	// How far each is: done and all of its tasks, as numbers.
	assert.match(l.byId.get("board:7")!.right ?? "", /2\D+6/);
	assert.match(l.byId.get("board:8")!.right ?? "", /2\D+3/);
	assert.equal(l.byId.get("you")!.bad, true, "a task that waits for an answer is a question for you");
	// From far its name; then a bar and a tile for each task; from close by a row for each task, one that comes after another under it.
	const card = l.byId.get("board:7")!;
	const shown = (z: number) => contentOf(card, s, T0, ...at(card, z), measure) as any[];
	assert.deepEqual(words(shown(0.4)), ["scout"]);
	assert.ok(kinds(shown(1)).has("bar"));
	assert.deepEqual(tasksAs(shown(1), "tile"), [1, 2, 3, 4, 5, 6]);
	assert.deepEqual(tasksAs(shown(2), "row"), [1, 4, 2, 5, 3, 6]);
	assert.ok(words(shown(2)).some((x) => x.toLowerCase() === sentenceOf(works[1], s).toLowerCase()), "what the sub-agent that has a task is doing");
	// The agent's own card shows its board as tiles.
	assert.ok(tasksAs(contentOf(l.byId.get("agent:scout")!, s, T0, 348, 168, measure) as any[], "tile").includes(2));
	// One line from the agent to its board, however many of its sub-agents have a task there.
	assert.deepEqual(linksOf(s, l, T0).filter((k: any) => k.to === "board:7").map((k: any) => [k.from, k.live]), [["agent:scout", true]]);
	assert.deepEqual(wiringOf("board:8", s, l).map((k: any) => k.from).sort(), ["agent:books", "agent:coder", "agent:main", "agent:scout"]);
	// What the pointer over it says, over the card and over one of its tasks: whose board, which task, what it waits for.
	assert.ok(says(tipOf(card, s, T0), "scout"));
	assert.notDeepEqual(tipOf(card, s, T0, b7.tasks[4]), tipOf(card, s, T0));
	assert.ok(says(tipOf(card, s, T0, b7.tasks[4]), 5) && says(tipOf(card, s, T0, b7.tasks[4]), 2), "task 5, which comes after task 2");
	assert.ok(says([taskWords(b7.tasks[1], b7)], "scout", 5), "who has it, and which task follows it");
	assert.ok(says([taskWords(b7.tasks[3], b7)], 1), "which task it came after");
	// Where a task was drawn is where the pointer finds it: a tile from further out, a row from close by.
	for (const z of [1, 2]) {
		const cam = { x: card.x + card.w / 2, y: card.y + card.h / 2, z };
		const hits = draw(fakeCtx(), s, l, T0, { recent: new Recent(), cam, view: { w: 900, h: 700 } });
		const two = hits.find((h: any) => h.board === 7 && h.task.id === 2)!;
		assert.ok(two, `task 2 was drawn at ${z}`);
		assert.equal(hitTask(hits, { x: two.x + two.w / 2, y: two.y + two.h / 2 })?.task.id, 2);
		assert.equal(hitTask(hits, { x: -1e6, y: -1e6 }), undefined);
	}
	// Tiles: every task once, in the order they were posted; more than fit are counted, not drawn.
	assert.deepEqual(tilesOf(b7, 108).tiles.map((k: any) => k.task.id).sort(), [1, 2, 3, 4, 5, 6]);
	const many = (n: number) => board(11, { open: n, tasks: Array.from({ length: n }, (_, i) => t(i + 1, "open")) });
	const crowded = tilesOf(many(400), 108);
	assert.ok(crowded.more > 0 && crowded.tiles.length + crowded.more === 400, "what has no room is counted");
	// Rows: in the order they were posted, each that comes after another under it; a long board is cut, with a row that says so.
	assert.deepEqual(rowsOf(b7, s, T0).filter((r: any) => r.task).map((r: any) => [r.task.id, r.indent]), [[1, 0], [4, 1], [2, 0], [5, 1], [3, 0], [6, 1]]);
	const rows = rowsOf({ ...many(100), notes: 0 }, s, T0);
	const drawn = rows.filter((r: any) => r.task).length;
	assert.ok(drawn < 100 && rows.at(-1)!.task === undefined && rows.at(-1)!.text.includes(String(100 - drawn)), "the rest as a number");
	// It draws in light and dark, with a task chosen, without a throw; and something that happened on it lights it for a moment.
	for (const dark of [false, true]) draw(fakeCtx(), { ...s, dark }, l, T0, { recent: new Recent(), task: { board: 7, task: 2 }, cam: { x: l.w / 2, y: 200, z: 2 }, view: { w: 560, h: 600 } });
	const recent = new Recent();
	recent.hear({ k: "board", board: 7, change: "posted", agent: "scout" } as any, T0);
	assert.equal(recent.hot.get("board:7"), T0);
});

test("an agent that handed tasks on stays at work while they run, and above the agents it handed them to", () => {
	const order = (works: ViewWork[], now = T0) => layoutOf(state(works, now), now).boxes.filter((b: any) => b.col === 1).map((b: any) => b.agent.id);
	// coder handed a task each to main and books without waiting for them: its own turn is over, and it is idle by
	// what it does itself. It stands on top all the same, above the two, while their tasks run.
	const handed = [
		work(1, "coder", { started: T0 - 60_000, finished: T0 - 50_000, doing: "done" }),
		work(2, "main", { started: T0 - 50_000, parent: 1, depth: 1, from: { k: "agent", id: "coder" } }),
		work(3, "books", { started: T0 - 50_000, parent: 1, depth: 1, from: { k: "agent", id: "coder" } }),
	];
	assert.deepEqual(order(handed), ["coder", "main", "books", "scout"]);
	// When the tasks are over and their answers are back, it is idle, and everybody is in pine's own order again.
	const over = handed.map((w) => ({ ...w, doing: "done" as const, finished: T0 - 20_000 }));
	assert.deepEqual(order(over), ["main", "books", "scout", "coder"]);
	// A chain: scout hands a task to books, which hands one to main. Who handed it on is above whom it went to, whatever pine's order.
	const chain = [
		work(1, "scout", { doing: "waiting", waitingOn: [2] }),
		work(2, "books", { doing: "waiting", waitingOn: [3], parent: 1, depth: 1, from: { k: "agent", id: "scout" } }),
		work(3, "main", { parent: 2, depth: 2, from: { k: "agent", id: "books" } }),
		work(4, "coder", { from: { k: "source", name: "inbox" } }),
	];
	assert.deepEqual(order(chain), ["scout", "books", "main", "coder"], "and an agent at work on its own comes after the chain, in pine's order");
	// Two that hand work to each other: both on top, in pine's order.
	const ring = [work(1, "scout", { from: { k: "agent", id: "books" } }), work(2, "books", { from: { k: "agent", id: "scout" } })];
	assert.deepEqual(order(ring), ["books", "scout", "main", "coder"]);
	// The line from coder to each of them is there as long as coder stands above them.
	const s = state(handed);
	assert.deepEqual(linksOf(s, layoutOf(s, T0), T0).filter((k: any) => k.side).map((k: any) => [k.from, k.to]), [["agent:coder", "agent:main"], ["agent:coder", "agent:books"]]);
});

test("a dot runs along its line without a leap while the camera moves, takes the same time at every zoom, and goes with its line", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, T0);
	const recent = new Recent();
	const view = { w: 560, h: 600 };
	const key = "source:inbox>agent:books";
	// Frame after frame while the camera zooms in and glides: the dot moves on, never half a line at once. (It was placed
	// by the clock divided by the line's length on the panel, and a line one pixel longer put it anywhere.)
	const steps: number[] = [];
	let before: number | undefined;
	for (let i = 0; i < 120; i++) {
		const now = T0 + i * 16;
		draw(fakeCtx(), s, l, now, { recent, cam: { x: 200 + i * 2, y: 250 + i, z: 0.8 + i * 0.01 }, view });
		const p = recent.dots.get(key)!.p;
		if (before !== undefined) steps.push((p - before + 1) % 1);
		before = p;
	}
	assert.ok(Math.max(...steps) < 0.5 && Math.min(...steps) > 0, `forward, and never a leap: ${Math.min(...steps)} to ${Math.max(...steps)}`);
	// Once along the line takes the same time at every zoom.
	const lap = (z: number) => {
		const r = new Recent();
		draw(fakeCtx(), s, l, T0, { recent: r, cam: { x: 284, y: 300, z }, view });
		draw(fakeCtx(), s, l, T0 + 500, { recent: r, cam: { x: 284, y: 300, z }, view });
		return r.dots.get(key)!.p;
	};
	assert.ok(Math.abs(lap(0.6) - lap(2)) < 1e-9);
	// A line that is gone takes its dot with it.
	draw(fakeCtx(), state([]), layoutOf(state([]), T0), T0 + 5000, { recent, cam: { x: 284, y: 300, z: 1 }, view });
	assert.equal(recent.dots.size, 0);
});
