// The overview (examples/home/views/overview.ts), pine's third view, without a window: the three columns of cards, which
// keep their place and their size at every zoom, and what each card says by the room it has on the panel; the lines that
// join two cards while something happens between them, what the pointer over a card shows, where the camera goes, and the
// whole board drawn on a canvas that only counts. The view is loaded as the frame loads it: "pine/view" is pine's src/view-kit.ts.
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
const { Recent, layoutOf, fittedWidth, contentOf, sentenceOf, causeOf, sessionOf, linksOf, wiringOf, hitAt, hitTask, tipOf, routesOf, focusOf, allOf, held, toBoard, wholeOf, PIN, SIZE, ROW, draw, boardTitle, boardLine, boardWords, tilesOf, taskWords, rowsOf } = view;

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

test("what an agent is doing is said the way a person would say it, and why it does it in a few words", () => {
	const s = state(STORY(T0));
	assert.equal(sentenceOf(s.work[0], s), "Waiting for scout");
	assert.equal(sentenceOf(s.work[1], s), "Using web: search");
	assert.equal(sentenceOf(s.work[2], s), "Searching files");
	assert.equal(sentenceOf(s.work[4], s), "Reading skill: invoices");
	assert.equal(sentenceOf(work(9, "main", { doing: "tool", tool: "bash" }), s), "Running a command");
	assert.equal(sentenceOf(work(9, "main", { doing: "writing" }), s), "Writing an answer", "not: writes its answer");
	assert.equal(sentenceOf(work(9, "main", { doing: "tool", tool: "bash", asking: true }), s), "Needs your answer", "a question comes before anything else");
	assert.equal(sentenceOf(work(9, "main", { doing: "tool", tool: "something_new" }), s), "Using something new", "a tool the view has no words for is called by its name");
	assert.equal(sentenceOf(work(9, "scout", { doing: "waiting", waitingOn: [3, 4] }), s), "Waiting for 2 sub-agents", "a sub-agent, never a copy");
	assert.deepEqual(s.work.map((w) => causeOf(w)), ["for you", "delegated by main", "", "", "triggered by inbox", "triggered by nightly"]);
});


/** Text widths as a canvas would measure them, near enough: the size of the font times the number of letters. */
const measure = (font: string, text: string) => text.length * Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 12) * 0.55;
/** What a card says, in order: its words, and for the rest what kind of thing is drawn. */
const said = (pieces: any[]) => pieces.map((x) => (x.k === "text" ? x.text : x.k === "chip" ? `[${x.text}]` : x.k === "pill" ? `(${x.text})` : x.k === "tile" || x.k === "row" ? `<${x.k} ${x.task.id}>` : `<${x.k}>`));
const words = (pieces: any[]) => pieces.filter((x) => x.k === "text").map((x) => x.text);
/** The sizes a card of an agent has on the panel, from far to near: its size on the board times the zoom. */
const ZOOMS = [0.2, 0.5, 1, 1.5, 2, 3];
const at = (b: any, z: number) => [b.w * z, b.h * z] as const;

test("three columns: triggers, agents, tools; each card has the size of its kind, and says in words what it is", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, T0);
	assert.deepEqual(l.cols.map((c: any) => c.title), ["Triggers", "Agents", "Tools"]);
	assert.ok(l.cols[0].x === 0 && l.cols[0].x + l.cols[0].w < l.cols[1].x && l.cols[1].x + l.cols[1].w < l.cols[2].x && l.cols[2].x + l.cols[2].w === l.w, "side by side, from one edge of the board to the other");
	assert.ok(l.boxes.every((b: any) => b.y >= 0 && b.y + b.h <= l.h), "everything is on the board");
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
	assert.deepEqual(l.heads.map((h: any) => h.text), ["Events", "Schedules", "Webhooks", "MCP servers", "Skills"]);
	// A card's size goes by its kind alone: never by what it says, or by what its agent is doing.
	for (const b of l.boxes) assert.equal(b.h, { agent: SIZE.agent, source: SIZE.side, sched: SIZE.side, you: SIZE.side, outside: SIZE.tool, mcp: SIZE.tool, skill: SIZE.tool, board: SIZE.board }[b.kind as string], b.id);
	assert.deepEqual(layoutOf(state([]), T0).boxes.map((b: any) => [b.id, b.w, b.h]).sort(), l.boxes.map((b: any) => [b.id, b.w, b.h]).sort(), "a busy board and a quiet one: the same cards, the same sizes");
	const box = (id: string) => l.byId.get(id)!;
	assert.equal(box("source:inbox").sub, "triggers books");
	assert.deepEqual([box("source:feed").sub, box("source:feed").right, box("source:feed").bad], ["not connected", "down", true]);
	assert.deepEqual([box("sched:morning").sub, box("sched:morning").right], ["triggers main", "in 40 s"]);
	assert.deepEqual([box("you").sub, box("mcp:web").sub, box("mcp:browser").sub], ["nothing waiting", "in use by scout", "main, scout"]);
	assert.equal(box("agent:coder").right, "bypass");
	for (const a of l.boxes) for (const b of l.boxes) if (a !== b && a.col === b.col) assert.ok(a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} and ${b.id}`);
	assert.ok(l.boxes.every((b: any) => b.title.length > 0));
});

test("on a tall panel triggers, agents and tools stand one under the other, each with its cards side by side in rows", () => {
	const s = state(STORY(T0));
	const wide = layoutOf(s, T0);
	assert.ok(!wide.tall && !wide.parts);
	for (const width of [336, 536, 900]) {
		const l = layoutOf(s, T0, width);
		assert.ok(l.tall && l.parts!.length === 3 && l.w === width);
		assert.deepEqual(l.cols.map((c: any) => c.title), ["Triggers", "Agents", "Tools"]);
		assert.deepEqual([...l.boxes.map((b: any) => b.id)].sort(), [...wide.boxes.map((b: any) => b.id)].sort(), "the same cards");
		const of = (col: number) => l.boxes.filter((b: any) => b.col === col);
		assert.ok(l.parts!.every((p: any, i: number) => i === 0 || l.parts![i - 1].bottom < p.top), "the parts one under the other");
		for (const col of [0, 1, 2]) {
			const p = l.parts![col];
			assert.ok(of(col).every((b: any) => b.y >= p.top && b.y + b.h <= p.bottom), `${l.cols[col].title}: its cards within it`);
			assert.ok(of(col).every((b: any) => b.x >= 0 && b.x + b.w <= l.w), "within the width");
			assert.ok(of(col).filter((b: any) => b.row === 0).length <= p.n);
		}
		for (const a of l.boxes) for (const b of l.boxes) if (a !== b) assert.ok(a.y + a.h <= b.y || b.y + b.h <= a.y || a.x + a.w <= b.x || b.x + b.w <= a.x, `${a.id} and ${b.id} do not overlap`);
		// The more room, the more in a row: on a phone one agent in a row, on a wide panel several.
		if (width === 336) assert.equal(l.parts![1].n, 1);
		if (width === 900) assert.ok(l.parts![1].n >= 3 && l.parts![0].n >= 5);
		// You stand in the first row with the event sources, under whose name they are.
		assert.equal(of(0)[0].id, "you");
		assert.equal(of(0)[1].row, 0);
		assert.equal(l.heads.find((h: any) => h.text === "Events")?.x, of(0)[1].x);
		// A line runs beside the cards, never across one: from the side of one, along gutters and gaps, into the side of the other.
		const links = [
			{ from: "source:inbox", to: "agent:books", color: "#22a06b", live: true },
			{ from: "you", to: "agent:main", color: "#3b82f6", live: true },
			{ from: "agent:main", to: "you", color: "ask", live: true },
			{ from: "agent:scout", to: "mcp:web", color: "#f59e0b", live: true },
			{ from: "agent:main", to: "agent:scout", color: "#3b82f6", live: true, side: true },
			{ from: "agent:scout", to: "agent:main", color: "#f59e0b", live: true, side: true, back: true },
		];
		const ways = routesOf(links, l).map((pts) => pts!);
		ways.forEach((pts, i) => {
			const from = l.byId.get(links[i].from)!;
			const to = l.byId.get(links[i].to)!;
			assert.ok(Math.abs(pts[0][1] - (from.y + from.h / 2)) < from.h / 2 && Math.abs(pts.at(-1)![1] - (to.y + to.h / 2)) < to.h / 2, `${links[i].from}: from a side, into a side`);
			for (let k = 1; k < pts.length; k++) {
				const [x0, y0] = pts[k - 1];
				const [x1, y1] = pts[k];
				for (const b of l.boxes) {
					// A piece of the line, a little inside its ends: it does not pass through any card.
					const inside = (t: number) => {
						const x = x0 + (x1 - x0) * t;
						const y = y0 + (y1 - y0) * t;
						return x > b.x + 1 && x < b.x + b.w - 1 && y > b.y + 1 && y < b.y + b.h - 1;
					};
					assert.ok(![0.1, 0.3, 0.5, 0.7, 0.9].some(inside), `${links[i].from} to ${links[i].to} crosses ${b.id} at ${width}`);
				}
			}
		});
		const lanes = ways.map((pts) => pts.slice(1, -1).map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(" "));
		assert.equal(new Set(lanes).size, lanes.length, "a lane each");
	}
});

test("on a tall panel the board is laid out as wide as shows all of it largest, filling the panel side to side", () => {
	const s = state(STORY(T0));
	for (const view of [{ w: 360, h: 740 }, { w: 400, h: 860 }, { w: 560, h: 900 }, { w: 900, h: 1100 }]) {
		const W = fittedWidth(s, T0, view);
		const best = allOf(layoutOf(s, T0, W), view).z;
		// Against laying it out as wide as the panel, and against every other width: never smaller.
		for (let w = 200; w <= view.w * 4; w += 37) assert.ok(best >= allOf(layoutOf(s, T0, w), view).z - 0.011, `${view.w}x${view.h}: ${W} (${best}) against ${w}`);
		// It fills the panel's width, or everything fits as large as the camera goes.
		assert.ok((W + 32) * best >= view.w * 0.9 || best >= 1.39, `${view.w}x${view.h}: ${W} at ${best} fills the width`);
	}
});

test("a card keeps its size when zoomed, its words keep theirs, and the more room it has the more it says, the most important first", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, T0);
	const card = (id: string, z: number) => said(contentOf(l.byId.get(id)!, s, T0, ...at(l.byId.get(id)!, z), measure));
	// From far an agent is its avatar; then its name; then what it is doing, the largest words of the card, and why.
	assert.deepEqual(card("agent:scout", 0.2), ["<avatar>"]);
	assert.deepEqual(card("agent:scout", 0.5), ["<avatar>", "scout"]);
	assert.deepEqual(card("agent:scout", 1).slice(0, 6), ["<avatar>", "<badge>", "scout", "Using web: search", "50 s", "delegated by main"]);
	// Its sub-agents, each on a line of its own with what it is doing; then how long it has run and how far it may reach.
	const closer = card("agent:scout", 1.5);
	for (const line of ["Sub-agent · searching files", "Sub-agent · thinking", "started 50 s ago · limited to safe mode"]) assert.ok(closer.includes(line), `${line}: ${closer}`);
	// With room for a second column: its conversations, and what it is connected to.
	const near = card("agent:scout", 2);
	for (const line of ["Conversations", "Main conversation", "Connected to", "Events: feed", "Skills: research"]) assert.ok(near.includes(line), `${line}: ${near}`);
	// Which conversation the work is in, as a chip, and for whom: what the old cards did not say.
	assert.deepEqual(card("agent:main", 1).slice(0, 7), ["<avatar>", "<badge>", "main", "Waiting for scout", "60 s", "[main]", "for you"]);
	assert.ok(card("agent:main", 1.5).includes("scout · using web: search"), "the agent it waits for, and what that one is doing");
	assert.equal(sessionOf(s.work[0], AGENTS[0]), "main conversation");
	assert.ok(card("agent:books", 1).includes("<steps>") && card("agent:books", 1).includes("2/5"), "its to-do list, as a bar of steps");
	// An idle agent: when it was last at work, and closer by what it finished lately.
	assert.deepEqual(card("agent:coder", 1).slice(2), ["coder", "Idle", "last active 70 s ago"]);
	assert.ok(card("agent:coder", 1.5).includes("Lately"));
	// Each closer look says all the one before it did (but a count of what it had no room for, "+1 more"), and more.
	// What is cut is cut with an ellipsis, never into nothing.
	for (const b of l.boxes) {
		let before: string[] = [];
		for (const z of ZOOMS) {
			const now = words(contentOf(b, s, T0, ...at(b, z), measure));
			const whole = (t: string) => t.replace(/…$/, "");
			for (const t of before.filter((x) => !/^\+\d+ more/.test(x))) assert.ok(now.some((x) => x.startsWith(whole(t)) || whole(t).startsWith(whole(x))), `${b.id} at ${z}: "${t}" was said further out, and is gone: ${now}`);
			assert.ok(now.every((t) => t.length > 0 && t !== "…"), `${b.id} at ${z}`);
			before = now;
		}
	}
	// Nothing is drawn outside its card.
	for (const b of l.boxes) for (const z of ZOOMS) {
		const [W, H] = at(b, z);
		for (const x of contentOf(b, s, T0, W, H, measure) as any[]) assert.ok(x.x >= -1 && x.x <= W + 1 && x.y >= -1 && x.y <= H + 1, `${b.id} at ${z}: ${JSON.stringify(x)}`);
	}
	// A trigger or a tool says who it triggers or who uses it, and from close by all a view knows of it.
	const side = (id: string, z: number) => words(contentOf(l.byId.get(id)!, s, T0, ...at(l.byId.get(id)!, z), measure));
	assert.deepEqual(side("source:inbox", 0.5), ["inbox"]);
	assert.deepEqual(side("source:inbox", 1), ["inbox", "triggers books"]);
	assert.deepEqual(side("source:inbox", 2), ["inbox", "triggers books", "mail source", "12 events, last 4 s ago"]);
	assert.deepEqual(side("sched:morning", 1), ["in 40 s", "morning", "triggers main"]);
	assert.deepEqual(side("mcp:web", 2.5).slice(0, 3), ["web", "in use by scout", "MCP server of main, books, scout"]);
});

test("a question for you is said at your card and at the agent's", () => {
	const works = STORY(T0);
	Object.assign(works[4], { asking: true });
	const s = state(works);
	const l = layoutOf(s, T0);
	assert.deepEqual([l.byId.get("you")!.sub, l.byId.get("you")!.bad], ["1 question", true]);
	assert.equal(l.byId.get("agent:books")!.bad, true);
	assert.ok(words(contentOf(l.byId.get("agent:books")!, s, T0, 232, 112, measure)).includes("Needs your answer"));
});

test("a swarm is said in words at its lead's card, keeps the lead on top between its turns, and its board says that it is a swarm's", () => {
	const swarm = (status: string, more: object = {}) => ({ status, round: 2, until: 8, checking: false, ...more });
	const led = (sw: object | undefined, works: ViewWork[], more: Partial<ViewState> = {}) => {
		const agents = AGENTS.map((a) => (a.id === "coder" ? { ...a, conversations: [conv(9, { main: true, ...(sw ? { swarm: sw } : {}) })] } : a));
		const s = state(works, T0, { agents: agents as ViewAgent[], ...more });
		const l = layoutOf(s, T0);
		return { s, l, card: words(contentOf(l.byId.get("agent:coder")!, s, T0, 232, 112, measure)) };
	};
	const order = (l: ReturnType<typeof layoutOf>) => l.boxes.filter((b) => b.kind === "agent").map((b) => b.title);
	// Its lead's turn runs: what it does as ever, and why: it leads a swarm, in the round it is in.
	const leadWork = work(20, "coder", { started: T0 - 30_000, doing: "waiting", waitingOn: [21], conversation: 9, from: { k: "pine" }, swarm: "lead" });
	const sub = work(21, "coder", { started: T0 - 20_000, parent: 20, depth: 1, copy: true, from: { k: "copy", id: "coder" }, doing: "tool", tool: "read", conversation: 9, board: 3 });
	let v = led(swarm("active"), [leadWork, sub]);
	assert.ok(v.card.includes("Waiting for 1 sub-agent") && v.card.includes("swarm · round 2 of 8"), v.card.join(" | "));
	assert.equal(order(v.l)[0], "coder");
	// Between two turns, while its answer is checked: the card says so, the check is named among the sub-agents, and the lead stays where it is.
	const check = work(22, "coder", { started: T0 - 5000, parent: 20, depth: 1, copy: true, from: { k: "copy", id: "coder" }, doing: "tool", tool: "bash", conversation: 9, board: 3, swarm: "check" });
	v = led(swarm("active", { checking: true }), [check]);
	assert.ok(v.card.includes("Checking the answer") && v.card.includes("swarm · round 2 of 8"), v.card.join(" | "));
	const near = words(contentOf(v.l.byId.get("agent:coder")!, state([leadWork, check], T0, { agents: v.s.agents }), T0, 320, 260, measure));
	assert.ok(near.some((x) => x.startsWith("Check of the answer · running")), near.join(" | "));
	// With no work of its own at all for a moment, it is not idle: it leads a swarm, and stays on top.
	v = led(swarm("active"), []);
	assert.ok(v.card.includes("Leading a swarm") && v.card.includes("round 2 of 8") && !v.card.includes("Idle"), v.card.join(" | "));
	assert.deepEqual([order(v.l)[0], v.l.byId.get("agent:coder")!.busy], ["coder", true]);
	assert.deepEqual([order(led(undefined, []).l).indexOf("coder") > 0, led(undefined, []).card.includes("Idle")], [true, true], "without a swarm it is idle, below those at work");
	// Its lead asked you something: that is a question for you, at your card, at the agent's, and as a line between the two.
	v = led(swarm("waiting"), []);
	assert.ok(v.card.includes("Swarm needs your answer"), v.card.join(" | "));
	assert.deepEqual([v.l.byId.get("you")!.sub, v.l.byId.get("agent:coder")!.bad], ["1 question", true]);
	assert.ok(linksOf(v.s, v.l, T0).some((k) => k.from === "agent:coder" && k.to === "you"));
	// Stopped: said, and the agent is no longer on top or lit.
	v = led(swarm("paused"), []);
	assert.ok(v.card.includes("Swarm paused"), v.card.join(" | "));
	assert.equal(v.l.byId.get("agent:coder")!.busy, false);
	assert.ok(led(swarm("limit"), []).card.includes("Swarm at its limit"));
	assert.ok(led(swarm("done"), []).card.includes("Idle"), "a swarm that is done is over");
	// Its board, in the column of tools, says whose swarm it is; once the swarm is done it is that agent's board again.
	const board = { id: 3, scope: "conversation" as const, agent: "coder", conversation: 9, open: 2, taken: 1, done: 1, failed: 0, blocked: 0, notes: 0, workers: [21], tasks: [] };
	const card = (sw: object) => led(sw, [leadWork, sub], { boards: [board] }).l.byId.get("board:3")!;
	assert.deepEqual([card(swarm("active")).title, card(swarm("active")).sub], ["coder", "swarm · 1 at work"]);
	assert.equal(card(swarm("done")).sub, "1 in progress · 2 to do");
	assert.equal(led(swarm("active", { checking: true }), [check], { boards: [{ ...board, open: 0, taken: 0, done: 4 }] }).l.byId.get("board:3")?.sub ?? "gone", "gone", "a board with nothing left on it steps back, as ever");
	// What just happened, for a moment.
	const recent = new Recent();
	recent.hear({ k: "swarm", agent: "coder", conversation: 9, status: "active", checking: true }, T0);
	assert.equal(recent.notes.get("coder")!.text, "Checking the answer");
	recent.hear({ k: "swarm", agent: "coder", conversation: 9, status: "done", checking: false }, T0);
	assert.equal(recent.notes.get("coder")!.text, "Swarm done");
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
	const answer = routesOf(back(T0), l)[0]!;
	const [mainBox, scoutBox, webBox] = ["agent:main", "agent:scout", "mcp:web"].map((id) => l.byId.get(id)!);
	assert.deepEqual([answer[0][0], answer[answer.length - 1][0]], [scoutBox.x + scoutBox.w + PIN, mainBox.x + mainBox.w + PIN], "it leaves and arrives at the pins on the right side of the agents");
	assert.ok(answer.every(([x]: [number, number]) => x >= mainBox.x + mainBox.w && x < webBox.x), "and runs in the gap right of them all the way");
	// What you asked for comes back to you the same way.
	const yours = [work(1, "main", { doing: "done", started: T0 - 9000, finished: T0 - 500 })];
	assert.deepEqual(linksOf(state(yours), l, T0).map((k: any) => [k.from, k.to]), [["agent:main", "you"]]);
	assert.deepEqual(linksOf(state(yours), l, T0 + 9000), []);
	// Nothing happens: no line at all.
	assert.deepEqual(linksOf(state([]), layoutOf(state([]), T0)), []);
});

test("the pointer over a card shows all it is wired to, and the line on top says what it is", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, T0);
	const ends = (id: string) => wiringOf(id, s, l).map((k: any) => (k.from === id ? k.to : k.from)).sort();
	assert.deepEqual(ends("agent:books"), ["mcp:web", "sched:daily-report", "sched:month-end", "skill:invoices", "skill:ledger", "skill:taxes", "source:inbox"]);
	assert.deepEqual(ends("mcp:web"), ["agent:books", "agent:main", "agent:scout"], "over a thing: everybody who has it");
	assert.deepEqual(ends("source:inbox"), ["agent:books"]);
	assert.deepEqual(ends("you"), [], "you talk to every agent: that is no wiring");
	assert.deepEqual(wiringOf(undefined, s, l), []);
	assert.ok(wiringOf("agent:books", s, l).every((k: any) => !k.live));
	assert.deepEqual(tipOf(l.byId.get("agent:main"), s, T0), ["main (main agent)", "safe mode", "3 conversations, 1 branch", "morning in 40 s", "zoom in for more, double-click to open"]);
	assert.deepEqual(tipOf(l.byId.get("source:feed"), s, T0), ["feed: event source (feed)", "down", "triggers scout", "2 events"]);
	assert.deepEqual(tipOf(l.byId.get("sched:morning"), s, T0), ["morning: schedule", "triggers main", "every 30m", "next in 40 s"]);
	assert.deepEqual(tipOf(l.byId.get("mcp:web"), s, T0), ["web: MCP server", "available to main, books, scout", "in use by scout"]);
	assert.deepEqual(tipOf(l.byId.get("skill:invoices"), s, T0), ["invoices: skill", "available to books", "in use by books"]);
	assert.deepEqual(tipOf(undefined, s, T0), []);
	const b = l.byId.get("agent:scout")!;
	assert.equal(hitAt(l, { x: b.x + 20, y: b.y + 10 })?.id, "agent:scout");
	assert.equal(hitAt(l, { x: b.x - 6, y: b.y + 10 }), undefined, "between the columns is nothing");
	assert.equal(hitAt(l, { x: b.x + 20, y: 10 }), undefined, "nor where a column says what it is");
});

test("every line runs from pin to pin in a lane of its own, as a trace does: straight, with its turns cut at 45 degrees", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, T0);
	const live = linksOf(s, l);
	const ways = routesOf(live, l);
	const way = (from: string, to: string) => ways[live.findIndex((k: any) => k.from === from && k.to === to)]!;
	const [inbox, books, invoices, main, scout] = ["source:inbox", "agent:books", "skill:invoices", "agent:main", "agent:scout"].map((id) => l.byId.get(id)!);
	const woke = way("source:inbox", "agent:books");
	assert.deepEqual([woke[0][0], woke[woke.length - 1][0]], [inbox.x + inbox.w + PIN, books.x - PIN], "from the pin at the right of what triggered it to a pin at the agent's left");
	const uses = way("agent:books", "skill:invoices");
	assert.deepEqual([uses[0][0], uses[uses.length - 1][0]], [books.x + books.w + PIN, invoices.x - PIN]);
	// A line runs straight across, then straight down or up in its lane, then straight across: on a slant only where it turns,
	// and there at 45 degrees.
	for (const pts of ways) {
		for (const [i, p] of pts!.slice(1).entries()) {
			const [dx, dy] = [Math.abs(p[0] - pts![i][0]), Math.abs(p[1] - pts![i][1])];
			assert.ok(dx < 0.01 || dy < 0.01 || Math.abs(dx - dy) < 0.01, `straight or at 45 degrees: ${dx}, ${dy}`);
		}
		const slanted = pts!.slice(1).reduce((n: number, p: [number, number], i: number) => n + (Math.abs(p[0] - pts![i][0]) > 0.5 && Math.abs(p[1] - pts![i][1]) > 0.5 ? Math.hypot(p[0] - pts![i][0], p[1] - pts![i][1]) : 0), 0);
		assert.ok(slanted < 24, `only its two turns are on a slant: ${slanted}`);
	}
	// No two lines between the same two columns share a lane: where each runs up or down is its own.
	const laneOf = (pts: Array<[number, number]>) => {
		const tall = pts.slice(1).map((p, i) => ({ x: p[0], len: Math.abs(p[1] - pts[i][1]), flat: Math.abs(p[0] - pts[i][0]) < 0.5 })).filter((v) => v.flat).sort((a, b) => b.len - a.len)[0];
		return tall?.x;
	};
	const lanes = ways.map((pts: any) => laneOf(pts)).filter((x: any) => x !== undefined);
	assert.equal(new Set(lanes).size, lanes.length, `lanes: ${lanes.join(", ")}`);
	// A task delegated from agent to agent runs beside the agents, never across one.
	const handed = way("agent:main", "agent:scout");
	assert.ok(handed.every(([x]: [number, number]) => x <= main.x && x > inbox.x + inbox.w), "in the gap left of the agents all the way");
	assert.deepEqual([handed[0][0], handed[handed.length - 1][0]], [main.x - PIN, scout.x - PIN]);
	// Two lines at one side of a box leave it a little apart.
	const two = [...STORY(T0), work(8, "coder", { started: T0 - 1000, doing: "thinking" })];
	const l2 = layoutOf(state(two), T0);
	const live2 = linksOf(state(two), l2);
	const fromYou = routesOf(live2, l2).filter((_: any, i: number) => live2[i].from === "you").map((pts: any) => pts[0][1]);
	assert.equal(fromYou.length, 2);
	assert.notEqual(fromYou[0], fromYou[1]);
	assert.deepEqual(routesOf([{ from: "agent:main", to: "nowhere", color: "#000000", live: true }], l), [undefined]);
});

test("a camera looks at the board: it follows what happens, shows all of it, and stays where the owner put it", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, T0);
	const whole = wholeOf(l);
	const shows = (cam: any, view: { w: number; h: number }) => {
		const [a, b] = [toBoard({ x: 0, y: 32 }, cam, view), toBoard({ x: view.w, y: view.h }, cam, view)];
		return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
	};
	const has = (seen: any, b: any) => b.x >= seen.x - 0.01 && b.y >= seen.y - 0.01 && b.x + b.w <= seen.x + seen.w + 0.01 && b.y + b.h <= seen.y + seen.h + 0.01;
	// Nothing happens: the board as wide as the panel, from its top, like a page.
	const panel = { w: 560, h: 420 };
	const rest = focusOf(l, [], panel);
	assert.ok(rest.z > 0.85 && rest.z <= 1, `at the panel's own width the board is nearly full size: ${rest.z}`);
	assert.ok(Math.abs(shows(rest, panel).y - whole.y) < 0.01 && shows(rest, panel).x >= whole.x - 6 && shows(rest, panel).w <= whole.w + 12, "from the board's top, and no wider than the board with its edge (give or take the zoom's step)");
	assert.ok(has(shows(rest, panel), l.byId.get("you")) && has(shows(rest, panel), l.byId.get("mcp:web")), "all three columns");
	assert.ok(l.h > shows(rest, panel).h, "this board is taller than the panel");
	// Something happens low on the board: the camera goes there, as wide as before.
	const low = l.boxes.filter((b: any) => b.col === 2).at(-1)!;
	const there = focusOf(l, [low.id], panel);
	assert.ok(has(shows(there, panel), low) && !has(shows(rest, panel), low));
	assert.equal(there.z, rest.z);
	// Two things far apart that do not fit: it goes further out until both do.
	const both = focusOf(l, ["you", low.id], panel);
	assert.ok(both.z < rest.z && has(shows(both, panel), low) && has(shows(both, panel), l.byId.get("you")));
	assert.deepEqual(focusOf(l, ["nothing"], panel), rest, "a box that is gone is not followed");
	// The whole board, in a panel of any shape; and a board smaller than the panel hangs from its top.
	for (const view of [{ w: 320, h: 300 }, { w: 560, h: 420 }, { w: 1500, h: 400 }, { w: 900, h: 2400 }]) {
		const all = allOf(l, view);
		assert.ok(has(shows(all, view), { x: 0, y: 0, w: l.w, h: l.h }), `${view.w}x${view.h}: ${JSON.stringify(all)}`);
		assert.ok(all.z < 1.41, "never closer than is good for reading");
	}
	assert.ok(Math.abs(shows(allOf(l, { w: 900, h: 2400 }), { w: 900, h: 2400 }).y - whole.y) < 0.01);
	// A point of the panel is a point of the board, wherever the camera is.
	const cam = { x: 200, y: 300, z: 2 };
	assert.deepEqual(toBoard({ x: 280, y: 32 + (420 - 32) / 2 }, cam, panel), { x: 200, y: 300 }, "the middle of the panel under the line on top is where the camera is");
	assert.deepEqual(toBoard({ x: 300, y: 32 + (420 - 32) / 2 + 10 }, cam, panel), { x: 210, y: 305 });
	// Dragged or zoomed by hand it stays where some of the board is to be seen, neither a speck nor a blur.
	assert.deepEqual(held({ x: -5000, y: 9000, z: 40 }, l), { x: whole.x, y: whole.y + whole.h, z: 3.5 });
	assert.equal(held({ x: 100, y: 100, z: 0.01 }, l).z, 0.2);
	assert.deepEqual(held(cam, l), cam);
});

test("what just happened shows for a moment: a card lights up, an agent's card says a few words", () => {
	const recent = new Recent();
	for (const h of [{ k: "event", input: "source:inbox" }, { k: "scheduled", name: "morning", agent: "main" }, { k: "tool", work: 2, agent: "scout", tool: "mcp__web__web_search", mcp: "web" }, { k: "skill", work: 5, agent: "books", skill: "invoices" }, { k: "sent", work: 5, agent: "books", tool: "send" }, { k: "branched", agent: "main", conversation: 2, from: 1, worktree: true }] as any[]) recent.hear(h, T0);
	recent.hear({ k: "answered", work: 2, from: "scout", to: "coder" }, T0);
	assert.deepEqual([recent.notes.get("scout")!.text, recent.notes.get("coder")!.text], ["Answered coder", "Answer from scout"], "both ends say that an answer went back");
	assert.deepEqual([...recent.hot.keys()], ["source:inbox", "sched:morning", "mcp:web", "skill:invoices"]);
	const s = state(STORY(T0));
	const l = layoutOf(s, T0);
	const books = (now: number) => words(contentOf(l.byId.get("agent:books")!, s, now, 348, 168, measure, recent));
	assert.ok(books(T0 + 500).includes("Sent a message"));
	assert.ok(!books(T0 + 6000).includes("Sent a message"), "and is gone again");
	assert.ok(words(contentOf(l.byId.get("agent:main")!, s, T0 + 500, 348, 168, measure, recent)).includes("New branch in a worktree"));
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
	assert.deepEqual(l.boxes.filter((b: any) => b.kind === "board").map((b: any) => [b.id, b.title, b.right, b.sub, Boolean(b.busy), Boolean(b.bad)]), [
		["board:7", "scout", "2/6", "1 in progress · 3 to do", true, false],
		["board:8", "bugs", "2/3", "Waits for an answer", false, true],
	]);
	assert.equal(l.heads.find((h: any) => h.col === 2)?.text, "Boards", "above what the agents use");
	assert.equal(boardWords(board(1, { done: 4 })), "Done");
	assert.equal(boardWords(board(1, { failed: 1, done: 4 })), "1 failed");
	assert.equal(boardTitle(board(1, { agent: undefined })), "Board");
	assert.equal(boardLine(board(1, { notes: 2 })), "2 notes");
	assert.equal(l.byId.get("you")!.sub, "1 question", "a task that waits for an answer is a question for you");
	// From far its name; then how it stands, a bar and a tile for each task; from close by a row for each task, one that comes after another under it.
	const card = l.byId.get("board:7")!;
	const shown = (z: number) => said(contentOf(card, s, T0, ...at(card, z), measure));
	assert.deepEqual(shown(0.4), ["scout"]);
	assert.deepEqual(shown(1), ["2/6", "scout", "1 in progress ·…", "<bar>", "<tile 1>", "<tile 2>", "<tile 3>", "<tile 4>", "<tile 5>", "<tile 6>"]);
	assert.deepEqual(shown(2).filter((x: string) => x.startsWith("<row")), ["<row 1>", "<row 4>", "<row 2>", "<row 5>", "<row 3>", "<row 6>"]);
	assert.ok(shown(2).includes("Searching files") && shown(2).includes("After task 2") && shown(2).includes("2 notes on this board"));
	// The agent's own card shows its board as tiles, and calls the sub-agent that has a task by the task's number.
	const scout = said(contentOf(l.byId.get("agent:scout")!, s, T0, 348, 168, measure));
	assert.ok(scout.includes("<tile 2>") && scout.includes("Task 2 · searching files"), String(scout));
	// One line from the agent to its board, however many of its sub-agents have a task there.
	assert.deepEqual(linksOf(s, l, T0).filter((k: any) => k.to === "board:7").map((k: any) => [k.from, k.live]), [["agent:scout", true]]);
	assert.deepEqual(wiringOf("board:8", s, l).map((k: any) => k.from).sort(), ["agent:books", "agent:coder", "agent:main", "agent:scout"]);
	// What the pointer over it says, over the card and over one of its tasks.
	assert.deepEqual(tipOf(card, s, T0), ["scout: board of a conversation of scout", "1 in progress, 3 to do (2 after other tasks), 2 done", "2 notes", "click to read it, zoom in for each task"]);
	assert.deepEqual(tipOf(card, s, T0, b7.tasks[4]), ["Task 5 on scout's board", "waiting for task 2", "click to read it"]);
	assert.equal(taskWords(b7.tasks[1], b7), "in progress, a sub-agent of scout has it, followed by task 5");
	assert.equal(taskWords(b7.tasks[3], b7), "done, comes after task 1");
	// Where a task was drawn is where the pointer finds it: a tile from further out, a row from close by.
	for (const z of [1, 2]) {
		const cam = { x: card.x + card.w / 2, y: card.y + card.h / 2, z };
		const hits = draw(fakeCtx(), s, l, T0, { recent: new Recent(), cam, view: { w: 900, h: 700 } });
		const two = hits.find((h: any) => h.board === 7 && h.task.id === 2)!;
		assert.ok(two, `task 2 was drawn at ${z}`);
		assert.equal(hitTask(hits, { x: two.x + two.w / 2, y: two.y + two.h / 2 })?.task.id, 2);
		assert.equal(hitTask(hits, { x: 1, y: 1 }), undefined);
	}
	// Tiles: a column for each piece of work, what comes after it under it; more than fit are counted, not drawn over the edge.
	const tiles = tilesOf(b7, 108);
	assert.deepEqual(tiles.tiles.map((k: any) => [k.task.id, k.x, k.y]), [[1, 0, 0], [2, 10, 0], [3, 20, 0], [4, 0, 10], [5, 10, 10], [6, 20, 10]]);
	const many = (n: number) => board(11, { open: n, tasks: Array.from({ length: n }, (_, i) => t(i + 1, "open")) });
	assert.ok(tilesOf(many(400), 108).more > 0);
	assert.ok(tilesOf(many(200), 108).tiles.every((k: any) => k.x + tilesOf(many(200), 108).size <= 108));
	// Rows: in the order they were posted, each that comes after another under it; eighty at most, and a word for the rest.
	assert.deepEqual(rowsOf(b7, s, T0).map((r: any) => [r.task?.id, r.indent]), [[1, 0], [4, 1], [2, 0], [5, 1], [3, 0], [6, 1], [undefined, 0]]);
	const rows = rowsOf({ ...many(100), notes: 0 }, s, T0);
	assert.deepEqual([rows.length, rows.at(-1)!.text], [81, "+20 more tasks"]);
	assert.equal(ROW, 17);
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

test("a dot runs along its line at an even pace, whatever the zoom, the camera or the lanes do", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, T0);
	const recent = new Recent();
	const view = { w: 560, h: 600 };
	const key = "source:inbox>agent:books";
	// Sixty frames a second while the camera zooms in and glides: each frame the dot moves on by about as much as the
	// last, never a leap. (It was placed by the clock divided by the line's length on the panel, and with a clock of
	// trillions of milliseconds, a line one pixel longer put it anywhere.)
	const steps: number[] = [];
	let before: number | undefined;
	for (let i = 0; i < 120; i++) {
		const now = T0 + i * 16;
		draw(fakeCtx(), s, l, now, { recent, cam: { x: 200 + i * 2, y: 250 + i, z: 0.8 + i * 0.01 }, view });
		const p = recent.dots.get(key)!.p;
		if (before !== undefined) steps.push((p - before + 1) % 1);
		before = p;
	}
	assert.ok(Math.max(...steps) < 0.02 && Math.min(...steps) > 0, `even steps: ${Math.min(...steps)} to ${Math.max(...steps)}`);
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
