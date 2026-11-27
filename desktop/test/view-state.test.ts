// What a view is told (view-state.ts), without a window: the shape of pine, and none of its text.
import assert from "node:assert/strict";
import { test } from "node:test";
import { happeningsOf, knownTarget, talkHappenings, viewStateOf } from "../src/view-state.ts";
import { World } from "../src/view-world.ts";

let id = 1;
const ev = (topic: string, payload: any, more: { source?: string; trust?: string } = {}) => ({ id: id++, ts: Date.now(), topic, source: more.source ?? `agent:${payload.agent}`, payload, trust: more.trust ?? "owner" });
const SECRET = "CANARY-7731";

function busyWorld() {
	const w = new World();
	w.setPlaces([
		{ id: "main", main: true, mode: "safe", description: `the owner's own words ${SECRET}` },
		{ id: "books", main: false, mode: "bypass", description: "" },
	]);
	const batch = [
		ev("source/inbox/mail", { text: `a mail about ${SECRET}` }, { source: "source:inbox", trust: "untrusted" }),
		ev("agent/main/started", { task: 1, agent: "main", session: `notes-${SECRET}`, root: 1, depth: 0, kind: "prompt", prompt: `Please look at ${SECRET}` }),
		ev("agent/main/tool", { task: 1, agent: "main", session: `notes-${SECRET}`, root: 1, depth: 0, phase: "start", tool: "delegate", subject: `books: ${SECRET}` }),
		ev("agent/books/started", { task: 2, agent: "books", session: "_t2", root: 1, parent: 1, depth: 1, kind: "delegate", prompt: `[task from agent main]\nCount ${SECRET}` }),
		ev("agent/books/tool", { task: 2, agent: "books", session: "_t2", root: 1, parent: 1, depth: 1, phase: "start", tool: "read", subject: `/Users/owner/${SECRET}/notes.md` }),
		ev("agent/books/tool", { task: 2, agent: "books", session: "_t2", root: 1, parent: 1, depth: 1, phase: "start", tool: "read", subject: `/Users/owner/.pine/skills/invoices/SKILL.md` }),
		ev("approval/requested", { id: "q1", agent: "books", task: 2, root: 1, tool: "bash", summary: `bash: cat ${SECRET}` }, { source: "approvals" }),
		ev("agent/books/delta", { task: 2, agent: "books", session: "_t2", root: 1, parent: 1, depth: 1, text: `the answer is ${SECRET}` }),
	];
	w.take(batch);
	w.setRooms([{ agent: "books", session: "_t2", busy: true, outside: `a page about ${SECRET}`, mode: "safe", trust: "owner" }]);
	return { w, batch };
}

test("a view is told who works on what, how and from where, and not one word of what anybody said", () => {
	const { w, batch } = busyWorld();
	const holdings = new Map([["books", { servers: ["web"], skills: ["invoices"], sources: ["inbox"], schedules: [] }]]);
	const state = viewStateOf(w, { colorOf: () => "#336699", holdings, dark: false });
	const happened = happeningsOf(batch, w, holdings);
	const all = JSON.stringify({ state, happened });
	assert.ok(!all.includes(SECRET), `nothing private reaches a view: ${all.slice(all.indexOf(SECRET) - 80, all.indexOf(SECRET) + 20)}`);
	assert.ok(!all.includes("/Users/owner"), "no path");
	assert.ok(!all.includes("notes-"), "no conversation's name");

	const books = state.work.find((x) => x.agent === "books")!;
	assert.deepEqual(books.from, { k: "agent", id: "main" });
	assert.equal(books.asking, true);
	assert.equal(books.held, true, "books works in bypass by itself and is held to main's safe mode");
	assert.equal(books.outside, true);
	assert.deepEqual(state.agents.find((a) => a.id === "books")!.mcp, ["web"]);
	assert.ok(happened.some((h) => h.k === "handed" && h.from === "main" && h.to === "books"));
	assert.ok(happened.some((h) => h.k === "skill" && h.skill === "invoices"), "a skill the agent has is named");
	assert.ok(happened.some((h) => h.k === "asked" && h.work === 2));
	assert.ok(happened.some((h) => h.k === "event" && h.input === "source:inbox"));
});

test("a view is told of conversations, branches and worktrees as numbers, of schedules and when they run, of a skill in use, a to-do list and a goal", () => {
	const w = new World();
	w.setPlaces([
		{ id: "main", main: true, mode: "safe", description: "" },
		{ id: "books", main: false, mode: "safe", description: "" },
	]);
	const holdings = new Map([["books", { servers: [], skills: ["invoices"], sources: ["inbox"], schedules: ["daily"] }]]);
	const convs = (more: any[] = []) => [{ session: "main", last: 5 }, { session: `tax-${SECRET}`, last: 9, branch: { from: "main", at: 3 }, worktree: { branch: `pine/tax-${SECRET}`, base: "main", path: `/Users/owner/${SECRET}`, repo: "/Users/owner/shop" } }, { session: "main~u", last: 1 }, ...more];
	assert.deepEqual(w.setConversations("books", convs()), [], "the first look is no news");
	w.setSources([{ name: "inbox", type: "mail", events: 3, subscribers: ["books", `main:notes-${SECRET}`], error: `could not sign in as ${SECRET}` }]);
	w.setSchedules([
		{ name: "daily", scope: "books", when: 'at the times "0 9 * * 1-5" (minute hour day month weekday)', next: Date.now() + 60_000 },
		{ name: "sweep", scope: "global", when: `whenever ${SECRET} says so`, next: Date.now() + 5000 },
	]);
	const session = `tax-${SECRET}`;
	const batch = [
		ev("agent/books/started", { task: 7, agent: "books", session, root: 7, depth: 0, kind: "prompt", prompt: `Do the taxes ${SECRET}` }),
		ev("agent/books/goal", { agent: "books", session, objective: `all of ${SECRET} is filed`, status: "active", round: 2, task: 7, event: "round" }, { source: "pine" }),
		ev("agent/books/todos", { task: 7, root: 7, agent: "books", session, depth: 0, items: [{ text: `find ${SECRET}`, status: "done" }, { text: "sum", status: "in_progress" }, { text: "file", status: "pending" }] }),
		ev("agent/books/tool", { task: 7, agent: "books", session, root: 7, depth: 0, phase: "start", tool: "read", subject: "/Users/owner/.pine/agents/books/skills/invoices/SKILL.md" }),
		ev("agent/books/steered", { task: 7, agent: "books", session, by: 8, kind: "prompt", prompt: `and ${SECRET} too`, depth: 0 }),
		ev("schedule/daily", { name: "daily", task: `sum up ${SECRET}` }, { source: "timer" }),
		ev("pine/board", { board: 3, scope: "local", agent: "books", session, name: "", change: "posted", item: 11, kind: "task", state: "open", text: SECRET }, { source: "pine" }),
		ev("pine/board", { board: 4, scope: "global", agent: "", session: "", name: "bugs", change: `rewritten ${SECRET}` }, { source: "pine" }),
	];
	// The boards as the daemon lists them: a view is told numbers, and a name only if it is what pine makes of one.
	w.setBoards([
		{ id: 3, scope: "local", agent: "books", session, name: "", counts: { open: 2, taken: 1, done: 4, failed: 0, blocked: 1, notes: 3 }, runs: [7, 99], tasks: [{ id: 11, state: "done", after: [], text: SECRET, by: "owner", notes: SECRET }, { id: 12, state: "taken", after: [], run: 7, holder: "books", text: SECRET, by: "books", created: 5000, updated: 9000, notes: 2, asked: "answered", outside: true }, { id: 13, state: "open", waits: true, after: [11, 12, SECRET], result: SECRET, by: `agent ${SECRET}`, asked: SECRET, outside: SECRET }, { id: 14, state: `open ${SECRET}`, after: [] }, { text: SECRET }] },
		{ id: 4, scope: "global", agent: "", session: "", name: "bugs", counts: { open: 1 }, runs: [] },
		{ id: 5, scope: "agent", agent: "books", session: "", name: `Notes about ${SECRET}`, counts: { open: `${SECRET}` }, runs: [SECRET] },
	]);
	w.take(batch);
	const state = viewStateOf(w, { colorOf: () => "#336699", holdings, dark: false });
	const happened = [...happeningsOf(batch, w, holdings), ...talkHappenings(w.setConversations("books", convs([{ session: `try-${SECRET}`, last: 12, branch: { from: session } }])))];
	const all = JSON.stringify({ state, happened });
	assert.ok(!all.includes(SECRET), `nothing private reaches a view: ${all.slice(all.indexOf(SECRET) - 80, all.indexOf(SECRET) + 20)}`);
	assert.ok(!all.includes("/Users/owner") && !all.includes("tax-") && !all.includes("pine/"), "no path, no conversation's name, no git branch's name");

	const books = state.agents.find((a) => a.id === "books")!;
	const [main, tax] = books.conversations;
	assert.deepEqual([books.conversations.length, main.main, tax.branchOf, tax.worktree, tax.goal], [2, true, main.id, true, "active"], "the conversation started from outside (~u) is none of the owner's");
	const work = state.work.find((x) => x.id === 7)!;
	assert.deepEqual([work.conversation, work.branch, work.worktree, work.skill, work.steps, work.round], [tax.id, true, true, "invoices", { done: 1, total: 3 }, 2]);
	assert.deepEqual(state.schedules.map((x) => [x.name, x.agent, x.when]), [["sweep", undefined, undefined], ["daily", "books", "0 9 * * 1-5"]], "the one that runs next first; a time that reads like free text is left out");
	assert.ok(state.schedules[1].last, "it fired while the panel was open");
	const inbox = state.inputs.find((i) => i.id === "source:inbox")!;
	assert.deepEqual([inbox.agents, inbox.failing], [["books", "main"], true]);
	assert.ok(happened.some((h) => h.k === "goal" && h.status === "active" && h.conversation === tax.id));
	assert.ok(happened.some((h) => h.k === "steps" && h.done === 1 && h.total === 3));
	assert.ok(happened.some((h) => h.k === "skill" && h.skill === "invoices"));
	assert.ok(happened.some((h) => h.k === "said" && h.work === 7));
	assert.ok(happened.some((h) => h.k === "scheduled" && h.name === "daily" && h.agent === "books"));
	// The boards: whose each is, by the conversation's number; counts; the work that has a task; each task by its
	// number, one of six words, what it comes after and who has it; never a text.
	assert.deepEqual(state.boards, [
		{
			id: 3, scope: "conversation", agent: "books", conversation: tax.id, open: 2, taken: 1, done: 4, failed: 0, blocked: 1, notes: 3, workers: [7],
			// (Of each also who posted it, as a name the view knows or "you"; when, and since when it stands so, on the page's
			// clock; how many notes are about it; whether it asked and was answered; whether it carries outside content.)
			tasks: [
				{ id: 11, state: "done", after: [], by: "you", notes: 0, outside: false },
				{ id: 12, state: "taken", after: [], worker: 7, agent: "books", by: "books", posted: 5000 - w.skew, since: 9000 - w.skew, notes: 2, asked: "answered", outside: true },
				{ id: 13, state: "waiting", after: [11, 12], notes: 0, outside: false },
			],
		},
		{ id: 4, scope: "all", name: "bugs", open: 1, taken: 0, done: 0, failed: 0, blocked: 0, notes: 0, workers: [], tasks: [] },
		{ id: 5, scope: "agent", agent: "books", open: 0, taken: 0, done: 0, failed: 0, blocked: 0, notes: 0, workers: [], tasks: [] },
	]);
	assert.equal(work.board, 3, "the work that has one of its tasks");
	// Its last tool calls: the tools' names and how each went, never what a call was about.
	assert.deepEqual(work.calls!.map((c) => [c.tool, c.ok, c.ms === undefined]), [["read", undefined, true]]);
	assert.ok(state.work.every((x) => (x.calls ?? []).every((c) => /^[A-Za-z0-9_-]+$/.test(c.tool) && Object.keys(c).every((k) => ["tool", "mcp", "at", "ms", "ok"].includes(k)))));
	assert.deepEqual(happened.filter((h) => h.k === "board"), [{ k: "board", board: 3, change: "posted", agent: "books", task: 11, state: "open" }], "a change that is none of the five words is not passed on");
	assert.ok(happened.some((h) => h.k === "branched" && h.agent === "books" && h.from === tax.id && h.worktree === false), "a branch made while the panel is open is news");
	// A conversation that reads outside content after the first look is news too.
	assert.deepEqual(w.setRooms([{ agent: "books", session, busy: true, mode: "safe", trust: "owner" }]), []);
	assert.deepEqual(w.setRooms([{ agent: "books", session, busy: true, outside: `a page about ${SECRET}`, mode: "safe", trust: "owner" }]), [{ agent: "books", session }]);
});

test("a view is told of a swarm as a state and numbers: who leads, which round, whether its answer is being checked, and never the job or pine's line about it", () => {
	const w = new World();
	w.setPlaces([{ id: "main", main: true, mode: "safe", description: "" }]);
	const session = `audit-${SECRET}`;
	w.setConversations("main", [{ session: "main", last: 1 }, { session, last: 9 }]);
	const swarm = (more: object) => ev("agent/main/swarm", { agent: "main", session, objective: `check every folder of ${SECRET}`, set: 1, since: 0, checks: 0, ...more }, { source: "pine" });
	const holdings = new Map();
	// Its lead works, and a sub-agent has a task of the board.
	const first = [
		ev("agent/main/started", { task: 1, agent: "main", session, root: 1, depth: 0, kind: "prompt", prompt: `check every folder of ${SECRET}` }),
		swarm({ status: "active", round: 1, until: 8, task: 1, note: `started: main leads it ${SECRET}`, event: "set" }),
		ev("agent/main/started", { task: 2, agent: "main", session: "_t2", root: 1, parent: 1, depth: 1, kind: "subagent", prompt: `Folder ${SECRET}` }),
	];
	w.take(first);
	let state = viewStateOf(w, { colorOf: () => "#336699", holdings, dark: false });
	const conv = () => state.agents[0].conversations.find((c) => !c.main)!;
	assert.deepEqual(conv().swarm, { status: "active", round: 1, until: 8, checking: false });
	assert.deepEqual([state.work.find((x) => x.id === 1)!.swarm, state.work.find((x) => x.id === 2)!.swarm], ["lead", undefined], "the lead is the conversation's own turn; a sub-agent that works a task is none");
	assert.deepEqual(happeningsOf(first, w, holdings).filter((h) => h.k === "swarm"), [{ k: "swarm", agent: "main", conversation: conv().id, status: "active", checking: false }]);
	// The lead's turn is over, and pine has its answer checked by a sub-agent it started itself.
	const second = [
		ev("agent/main/done", { task: 2, agent: "main", session: "_t2", root: 1, parent: 1, depth: 1, kind: "subagent", status: "done", text: `found ${SECRET}` }),
		ev("agent/main/done", { task: 1, agent: "main", session, root: 1, depth: 0, kind: "prompt", status: "done", text: `the answer ${SECRET}` }),
		ev("agent/main/started", { task: 3, agent: "main", session: "_t3", root: 1, parent: 1, depth: 1, kind: "subagent", prompt: `Check the answer below ${SECRET}` }),
		swarm({ status: "active", round: 1, until: 8, checking: 3, note: `the answer is being checked ${SECRET}`, event: "checking" }),
	];
	w.take(second);
	state = viewStateOf(w, { colorOf: () => "#336699", holdings, dark: false });
	assert.deepEqual(conv().swarm, { status: "active", round: 1, until: 8, checking: true });
	assert.deepEqual([state.work.find((x) => x.id === 3)!.swarm, state.work.find((x) => x.id === 1)!.swarm], ["check", undefined], "a turn that has ended leads nothing");
	const happened = [...happeningsOf(first, w, holdings), ...happeningsOf(second, w, holdings)];
	// Done, and then taken off: a state, and then nothing.
	w.take([swarm({ status: "done", round: 1, until: 8, note: `done after 1 round ${SECRET}`, event: "done" })]);
	state = viewStateOf(w, { colorOf: () => "#336699", holdings, dark: false });
	assert.deepEqual(conv().swarm, { status: "done", round: 1, until: 8, checking: false });
	const all = JSON.stringify({ state, happened });
	assert.ok(!all.includes(SECRET) && !all.includes("audit-") && !all.includes("leads it") && !all.includes("objective"), `no word of the job, of pine's line or of the conversation's name: ${all.slice(Math.max(0, all.indexOf(SECRET) - 80), all.indexOf(SECRET) + 20)}`);
	w.take([swarm({ status: "paused", round: 1, until: 8, note: "cleared", event: "cleared" })]);
	assert.equal(viewStateOf(w, { colorOf: () => "#336699", holdings, dark: false }).agents[0].conversations.find((c) => !c.main)!.swarm, undefined);
	// A state that is none of pine's five is no swarm.
	w.take([swarm({ status: `anything ${SECRET}`, round: 1, until: 8, event: "set" })]);
	assert.equal(viewStateOf(w, { colorOf: () => "#336699", holdings, dark: false }).agents[0].conversations.find((c) => !c.main)!.swarm, undefined);
});

test("what a view asks the panel to show or open is checked against what the panel knows", () => {
	const { w } = busyWorld();
	assert.deepEqual(knownTarget(w, { agent: "books" }), { agent: "books" });
	assert.deepEqual(knownTarget(w, { work: 2 }), { work: 2 });
	assert.equal(knownTarget(w, { agent: "nobody" }), undefined);
	assert.equal(knownTarget(w, { work: "2" }), undefined);
	assert.equal(knownTarget(w, "main"), undefined);
	// A board by its number, and one of its tasks by its own: nothing the panel does not know, and nothing but numbers.
	w.setBoards([{ id: 3, scope: "local", agent: "books", session: "s", name: "", counts: {}, runs: [], tasks: [{ id: 11, state: "open", after: [] }] }]);
	assert.deepEqual(knownTarget(w, { board: 3 }), { board: 3 });
	assert.deepEqual(knownTarget(w, { board: 3, task: 11, text: "anything" }), { board: 3, task: 11 });
	assert.deepEqual(knownTarget(w, { board: 3, task: 99 }), { board: 3 }, "a task it does not have is left out");
	assert.equal(knownTarget(w, { board: 9 }), undefined);
});

test("a turn's questions are asking until the conversation is written to again, after the turn ended too, and say none of their words", () => {
	const w = new World();
	w.setPlaces([{ id: "main", main: true, mode: "safe", description: "" }]);
	const talk = { agent: "main", session: "main", root: 1, depth: 0 };
	const batch = [
		ev("agent/main/started", { ...talk, task: 1, kind: "prompt", prompt: "set it up" }),
		ev("agent/main/tool", { ...talk, task: 1, phase: "start", tool: "question", subject: "", asked: { at: 0, question: `Which ${SECRET}?`, options: [{ label: "a" }, { label: "b" }] } }),
		ev("question/asked", { agent: "main", session: "main", task: 1, at: 0, question: `Which ${SECRET}?`, outside: false }),
		ev("agent/main/done", { ...talk, task: 1, status: "done" }),
	];
	w.take(batch);
	const state = () => viewStateOf(w, { colorOf: () => "#336699", holdings: new Map(), dark: false });
	assert.equal(state().work.find((x) => x.id === 1)?.asking, true, "the turn ended, and its question waits");
	const happened = happeningsOf(batch, w, new Map());
	assert.ok(happened.some((h) => h.k === "asked" && h.work === 1));
	assert.ok(!JSON.stringify({ happened, state: state() }).includes(SECRET), "nothing of what was asked");
	// The owner's next message is a turn of its own: the question is answered.
	w.take([ev("agent/main/started", { agent: "main", session: "main", root: 2, depth: 0, task: 2, kind: "prompt", prompt: "a" })]);
	assert.equal(state().work.find((x) => x.id === 1)?.asking, false);
});

test("a message steered into a turn before it asked leaves its question asking; one after it answers it, live and from the record alike", () => {
	const talk = { agent: "main", session: "main", root: 1, depth: 0 };
	const asking = (w: World) => viewStateOf(w, { colorOf: () => "#336699", holdings: new Map(), dark: false }).work.find((x) => x.id === 1)?.asking;
	const live = new World();
	live.setPlaces([{ id: "main", main: true, mode: "safe", description: "" }]);
	live.take([
		ev("agent/main/started", { ...talk, task: 1, kind: "prompt", prompt: "set it up" }),
		ev("agent/main/steered", { ...talk, task: 1, by: 2, kind: "prompt", prompt: "quickly" }),
		ev("agent/main/tool", { ...talk, task: 1, phase: "start", tool: "question", subject: "", asked: { at: 0, question: "Which?" } }),
		ev("agent/main/done", { ...talk, task: 1, status: "done" }),
	]);
	assert.equal(asking(live), true, "steered in before it asked");
	live.take([ev("agent/main/steered", { ...talk, task: 1, by: 3, kind: "prompt", prompt: "the first" })]);
	assert.equal(asking(live), false, "steered in after it asked");
	const task = (id: number, created: number, meta: object) => ({ id, agent: "main", session: "main", kind: "prompt", prompt: "", status: "done", created, depth: 0, meta });
	const seeded = (steeredAt: number) => {
		const w = new World();
		w.setPlaces([{ id: "main", main: true, mode: "safe", description: "" }]);
		w.seed([task(2, steeredAt, { steered: 1 }), task(1, 1000, { asked: [{ question: "Which?", when: 2000 }] })]);
		return w;
	};
	assert.equal(asking(seeded(1500)), true, "the record: steered in before it asked");
	assert.equal(asking(seeded(2500)), false, "the record: steered in after it asked");
});

test("what a question asked counts whether the daemon says it with the call's start or with its end", () => {
	const talk = { agent: "main", session: "main", root: 1, depth: 0 };
	for (const phase of ["start", "end"]) {
		const w = new World();
		w.setPlaces([{ id: "main", main: true, mode: "safe", description: "" }]);
		w.take([
			ev("agent/main/started", { ...talk, task: 1, kind: "prompt", prompt: "set it up" }),
			ev("agent/main/tool", { ...talk, task: 1, call: "c1", phase: "start", tool: "question", subject: "", ...(phase === "start" ? { asked: { at: 0, question: "Which?" } } : {}) }),
			ev("agent/main/tool", { ...talk, task: 1, call: "c1", phase: "end", tool: "question", ok: true, ...(phase === "end" ? { asked: { at: 0, question: "Which?" } } : {}) }),
			ev("agent/main/done", { ...talk, task: 1, status: "done" }),
		]);
		assert.equal(viewStateOf(w, { colorOf: () => "#336699", holdings: new Map(), dark: false }).work.find((x) => x.id === 1)?.asking, true, `asked on ${phase}`);
	}
});
