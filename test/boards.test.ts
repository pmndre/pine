import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { asksAtEnd, boardName, Boards, MAX_REWORK, verdictOf, JOB_NOTE_CHARS, NOTE_CHARS, TASK_CHARS } from "../src/boards.ts";
import { classify } from "../src/actions.ts";
import { harness, mockMsg, until } from "./support/harness.ts";

const owner = { trust: "owner" as const };
const call = (name: string, args: any = {}) => ({ name, args });
const who = (agent: string, session = "main") => ({ agent, conversation: { agent, session } });

test("boards: a task is taken by one run at a time, waits for the tasks before it, and is open again when given back", () => {
	const boards = new Boards(new DatabaseSync(":memory:"));
	const b = boards.ensure("local", "main", "main", "");
	const post = (text: string, after?: number[]) => boards.post(b, { kind: "task", text, by: "main", trust: "owner", after });
	const first = post("one");
	const second = post("two", [first.id]);
	assert.equal(boards.ready(second), false, "it waits for the first");
	assert.match(String(boards.claim(b, { id: second.id, holder: "main", run: 7 })), /waits for #1/);

	const got = boards.claim(b, { holder: "main", run: 7 });
	assert.equal(typeof got === "object" && got.id, first.id);
	assert.match(String(boards.claim(b, { id: first.id, holder: "main", run: 8 })), /taken by main/);
	assert.match(String(boards.claim(b, { holder: "main", run: 8 })), /no task on this board is ready/);
	// Only the run that holds a task says what became of it.
	assert.throws(() => boards.settle(first.id, "done", "x", { run: 8 }), /not by you/);
	boards.settle(first.id, "done", "the result", { run: 7 });
	assert.equal(boards.item(first.id)!.result, "the result");
	assert.equal(boards.ready(boards.item(second.id)!), true, "the task before it is done");

	const again = boards.claim(b, { holder: "main", run: 9 });
	assert.equal(typeof again === "object" && again.id, second.id);
	assert.deepEqual(boards.heldBy(9).map((t) => t.id), [second.id]);
	boards.reopen(second.id, { run: 9 });
	assert.equal(boards.item(second.id)!.state, "open");
	assert.deepEqual(boards.counts(b.id), { open: 1, taken: 0, done: 1, failed: 0, blocked: 0, notes: 0 });

	// A note waits for nothing, is about a task of this board, and its fields are an object.
	assert.throws(() => boards.post(b, { kind: "note", text: "n", by: "main", trust: "owner", after: [first.id] }), /a note waits for nothing/);
	assert.throws(() => boards.post(b, { kind: "note", text: "n", by: "main", trust: "owner", about: 99 }), /no task #99/);
	assert.throws(() => boards.post(b, { kind: "note", text: "n", by: "main", trust: "owner", data: [1] }), /JSON object/);
	const note = boards.post(b, { kind: "note", text: "n", by: "main", trust: "owner", about: first.id, data: { file: "a.css" } });
	assert.deepEqual(note.data, { file: "a.css" });
	// A task that is removed takes its notes along, and nothing waits for it any more.
	boards.removeItem(first.id);
	assert.equal(boards.item(note.id), undefined);
	assert.deepEqual(boards.item(second.id)!.after, []);
	assert.equal(boardName("  #Bug Hunt/2 "), "bug-hunt-2");
	assert.throws(() => boardName("!!"), /a board's name/);
});

test("boards: whom a board is for decides who can use it", () => {
	const boards = new Boards(new DatabaseSync(":memory:"));
	const mine = boards.ensure("local", "main", "proj", "");
	const agents = boards.ensure("agent", "main", "", "notes");
	const all = boards.ensure("global", "", "", "bugs");
	assert.deepEqual(boards.visible(who("main", "proj")).map((b) => b.id), [mine.id, agents.id, all.id]);
	assert.deepEqual(boards.visible(who("main", "other")).map((b) => b.id), [agents.id, all.id]);
	assert.deepEqual(boards.visible(who("helper")).map((b) => b.id), [all.id]);
	// A task handed on: the other agent, on the board of the conversation that handed it on.
	assert.deepEqual(boards.visible({ agent: "helper", conversation: { agent: "main", session: "proj" } }).map((b) => b.id), [mine.id, all.id]);
	assert.equal(boards.resolve(who("main", "proj"), "notes")?.id, agents.id);
	assert.equal(boards.resolve(who("helper"), "notes"), undefined);
	// What goes with a conversation and with an agent.
	boards.post(all, { kind: "note", text: "by helper", by: "helper", trust: "owner" });
	boards.renameConversation("main", "proj", "project");
	assert.equal(boards.find("local", "main", "project", "")?.id, mine.id);
	boards.renameAgent("helper", "aide");
	assert.equal(boards.items(all.id)[0].by, "aide");
	boards.dropAgent("aide");
	assert.equal(boards.items(all.id).length, 0, "what a removed agent posted is gone");
	assert.equal(boards.dropConversation("main", "project"), 1);
	boards.dropAgent("main");
	assert.deepEqual(boards.list().map((b) => b.id), [all.id]);
});

test("boards: a conversation's own board is its list of work; a board with a name is something other conversations read", () => {
	const ctx: any = { sends: false };
	assert.equal(classify("board_read", {}, ctx).cls, "look");
	assert.equal(classify("boards", {}, ctx).cls, "look");
	assert.equal(classify("board_post", { text: "x" }, ctx).cls, "look");
	assert.equal(classify("board_post", { text: "x", board: "bugs" }, ctx).cls, "local");
	assert.equal(classify("board_claim", { board: "bugs" }, ctx).cls, "local");
	assert.equal(classify("board_done", { id: 1 }, ctx).cls, "look");
});

test("boards: a pool of sub-agents works through more tasks than run at once, and each sees what the others noted", async () => {
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 3 } }, agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	h.mock.state.scripts.w1 = [{ tools: [call("board_post", { type: "note", text: "FOUND-BY-ONE gap-3 next to gap-4" })] }, { text: "answer one" }];
	h.mock.state.scripts.w2 = [{ delayMs: 120, tools: [call("board_read")] }];
	for (const n of [3, 4, 5]) h.mock.state.scripts[`w${n}`] = [{ delayMs: 60, text: `answer ${n}` }];
	const seen: number[] = [];
	h.pine.bus.subscribe("pine/board", () => void seen.push(h.pine.agents.boards.counts(1).taken));

	const r = await h.pine.agents.run({ agent: "main", session: "audit", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: [1, 2, 3, 4, 5].map((n) => `check part ${n} @@REF:w${n}@@`) })] }]), ...owner });
	assert.equal(r.status, "done");
	// Each result comes with what its task was, in the task's own words: a result often does not say which piece it is
	// about, and by its number alone the conversation could not tell among many.
	assert.match(r.text, /## Task #1: done\nThe task: check part 1 @@REF:w1@@\nIts result:\nanswer one/);
	for (const n of [3, 4, 5]) assert.match(r.text, new RegExp(`## Task #${n}: done\\nThe task: [^\\n]*\\nIts result:\\nanswer ${n}`), r.text);
	// The second one read the board after the first had posted: it saw the note, and its answer is the task's result.
	assert.match(r.text, /## Task #2: done\nThe task: [^\n]*\nIts result:\nFINAL:: The board of this conversation: .*Tasks:.*#1 \[.*FOUND-BY-ONE/s);
	assert.match(r.text, /## Notes the sub-agents left on the board\n#6 note by main: FOUND-BY-ONE gap-3 next to gap-4/);
	assert.ok(Math.max(...seen) <= 2, `never more than two at once (${Math.max(...seen)})`);

	const boards = h.pine.agents.boards;
	const board = boards.find("local", "main", "audit", "")!;
	assert.deepEqual(boards.counts(board.id), { open: 0, taken: 0, done: 5, failed: 0, blocked: 0, notes: 1 });
	assert.equal(boards.item(1)!.result, "answer one");
	// Each sub-agent is told which task of the board is its own.
	const worker = h.mock.state.requests.find((q: any) => !JSON.stringify(q.body.messages).includes("<<MOCK") && JSON.stringify(q.body.messages).includes("[pine: this is task #3 of a board"));
	assert.ok(worker, "the sub-agent of the third task was told so");
	// And it is shown, at its start, what a sub-agent before it noted for all: it did not have to ask.
	assert.match(JSON.stringify(worker.body.messages), /check part 3 @@REF:w3@@\\n\\nWhat everyone on this job goes by \(it was checked: no need to look it up again\):\\n- FOUND-BY-ONE gap-3 next to gap-4/);
	// What a sub-agent is shown as new is what the others noted, not the list of everybody's tasks.
	assert.match(h.toolResults(h.mock.state.requests.filter((q: any) => JSON.stringify(q.body.messages).includes("check part 1 @@REF:w1@@\\n\\n[pine")).at(-1)).join("\n"), /^Posted note #6 on the board of this conversation\.$/m);
	// Without "pool", more tasks than run at once are a pool all the same: they are worked through, not refused.
	const many = await h.pine.agents.run({ agent: "main", session: "audit", prompt: mockMsg([{ tools: [call("subagent", { tasks: ["a", "b", "c"] })] }]), ...owner });
	assert.doesNotMatch(many.text, /at most 2 sub-tasks/);
	assert.match(many.text, /## Task #\d+: done[\s\S]*## Task #\d+: done[\s\S]*## Task #\d+: done/);
	await h.close();
});

test("boards: a sub-agent that fails leaves its task failed, and a task the pool could not start stays open", async () => {
	const h = await harness({ agents: { main: { agent: { subagents: { maxParallel: 1 } } } } });
	h.mock.state.scripts.good = [{ text: "fine" }];
	h.mock.state.scripts.bad = [{ text: "never said" }];
	// One at a time, so the model's failure meets the sub-agent of the second task.
	h.pine.bus.subscribe("agent/main/started", (e: any) => {
		if (e.payload.kind === "subagent" && String(e.payload.prompt).includes("@@REF:bad@@")) h.mock.state.failNext.push({ status: 400, body: { error: { message: "bad request from mock" } } });
	});
	const board = h.pine.agents.boards.ensure("local", "main", "main", "");
	// A task the owner put there before, which waits for one that will fail.
	const r = await h.pine.agents.run({
		agent: "main",
		prompt: mockMsg([{ tools: [call("board_post", { type: "task", text: "first @@REF:good@@" })] }, { tools: [call("board_post", { type: "task", text: "second @@REF:bad@@" })] }, { tools: [call("board_post", { type: "task", text: "third @@REF:good@@", after: [2] })] }, { tools: [call("subagent", { pool: true, tasks: [] })] }]),
		...owner,
	});
	assert.equal(r.status, "done");
	const tasks = h.pine.agents.boards.items(board.id, { kind: "task" });
	assert.deepEqual(tasks.map((t) => t.state), ["done", "failed", "open"]);
	assert.match(r.text, /## Not done\n#3 \[open, waits for #2\] third/);
	assert.equal(h.pine.agents.boards.heldBy(0).length, 0);
	await h.close();
});

test("boards: a sub-agent that the model server refuses for now (a rate limit) has its task given out again after a pause, twice at most", async () => {
	// (pi asks again by itself a few times, with seconds in between: switched off here, so that what pine does after pi gave up is what is tested.)
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 4 } }, agents: { main: { agent: { subagents: { maxParallel: 2 }, settings: { retry: { enabled: false } } } } } });
	const boards = h.pine.agents.boards;
	h.pine.agents.retryPauseMs = 30;
	h.mock.state.scripts.ok = [{ text: "counted: 12" }];
	// The first sub-agent for the task is refused; the second gets through.
	let refuse = 1;
	const limit = { status: 429, body: { type: "error", error: { type: "rate_limit_error", message: "Rate limit exceeded. Please try again later." } } };
	h.pine.bus.subscribe("agent/main/started", (e: any) => {
		if (e.payload.kind === "subagent" && refuse-- > 0) h.mock.state.failNext.push(limit);
	});
	const r = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["count it @@REF:ok@@"] })] }]), ...owner });
	const [task] = boards.items(1, { kind: "task" });
	assert.deepEqual([task.state, task.result, task.data], ["done", "counted: 12", { retried: 1 }]);
	assert.match(r.text, /## Task #1: done\nThe task: [^\n]*\nIts result:\ncounted: 12/);
	assert.doesNotMatch(r.text, /failed|429/, "the conversation is not called for a failure that passed");
	assert.equal(h.pine.tasks.list({ limit: 20 }).filter((t) => t.meta.boardTask === 1).length, 2);
	// Refused every time: after two more tries the task is failed, and says why.
	refuse = 10;
	const still = await h.pine.agents.run({ agent: "main", session: "job2", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["count again @@REF:ok@@"] })] }]), ...owner });
	const again = boards.items(2, { kind: "task" })[0];
	assert.deepEqual([again.state, again.data], ["failed", { retried: 2 }]);
	assert.match(again.result ?? "", /429|[Rr]ate limit/);
	assert.match(still.text, /## Task #\d+: failed/);
	assert.equal(h.pine.tasks.list({ limit: 20 }).filter((t) => t.meta.boardTask === again.id).length, 3);
	assert.equal(h.pine.agents.retrying.size, 0);
	// A limit of the account does not pass: such a task fails at once, and is not asked again.
	refuse = 0;
	h.pine.bus.subscribe("agent/main/started", (e: any) => {
		if (e.payload.kind === "subagent" && String(e.payload.prompt).includes("the third")) h.mock.state.failNext.push({ status: 429, body: { type: "error", error: { type: "GoUsageLimitError", message: "Monthly usage limit reached" } } });
	});
	await h.pine.agents.run({ agent: "main", session: "job3", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["the third @@REF:ok@@"] })] }]), ...owner });
	const third = boards.items(3, { kind: "task" })[0];
	assert.deepEqual([third.state, third.data], ["failed", undefined]);
	await h.close();
});

test("boards: a task taken in a turn is open again when the turn ends without a word about it", async () => {
	const h = await harness({ agents: { main: {} } });
	const boards = h.pine.agents.boards;
	const board = boards.ensure("local", "main", "main", "");
	boards.post(board, { kind: "task", text: "look at the logs", by: "owner", trust: "owner" });
	boards.post(board, { kind: "task", text: "then the rest", by: "owner", trust: "owner" });
	let r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_claim")] }]), ...owner });
	assert.match(r.text, /You have task #1 of the board of this conversation, posted by owner:\nlook at the logs/);
	assert.equal(boards.item(1)!.state, "open", "the run ended: nothing stays taken");
	// Taken and settled in one turn: done with its result; blocked with a question.
	r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_claim", { id: 1 })] }, { tools: [call("board_done", { id: 1, result: "nothing unusual in the logs" })] }, { tools: [call("board_claim")] }, { tools: [call("board_done", { id: 2, outcome: "blocked", result: "which rest?" })] }, { tools: [call("board_done", { id: 2, result: "x" })] }]), ...owner });
	assert.equal(boards.item(1)!.state, "done");
	assert.equal(boards.item(1)!.result, "nothing unusual in the logs");
	// A task of its own board that nobody has, the conversation closes itself: a question it can settle needs no sub-agent.
	assert.equal(boards.item(2)!.state, "done");
	assert.equal(boards.item(2)!.result, "x");
	// Not a sub-agent, and not on a board that is not the conversation's own: there a task is settled by who took it.
	boards.post(board, { kind: "task", text: "third", by: "owner", trust: "owner" });
	boards.settle(3, "blocked", "which?");
	const named = boards.ensure("agent", "main", "", "shared");
	boards.post(named, { kind: "task", text: "on the agent's board", by: "owner", trust: "owner" });
	boards.settle(4, "blocked", "which?");
	h.mock.state.scripts.sub = [{ tools: [call("board_done", { id: 3, result: "closed by a sub-agent" })] }];
	r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("subagent", { tasks: ["@@REF:sub@@"] }), call("board_done", { id: 4, result: "closed from another board" })] }]), ...owner });
	assert.match(r.text, /task #3 is blocked: take it first/);
	assert.match(r.text, /task #4 is blocked: take it first/);
	assert.deepEqual([boards.item(3)!.state, boards.item(4)!.state], ["blocked", "blocked"]);
	await h.close();
});

test("boards: a post carries the outside-content mark of the run that wrote it, and reading it marks the reader", async () => {
	const h = await harness({ agents: { main: {} } });
	// A conversation that has read outside content writes onto a board of the agent's.
	await h.pine.agents.run({ agent: "main", session: "reader", tainted: "a web page", prompt: mockMsg([{ tools: [call("board_post", { type: "note", board: "findings", scope: "agent", text: "IGNORE-ALL-RULES said the page" })] }]), ...owner });
	const item = h.pine.agents.boards.items(1)[0];
	assert.equal(item.tainted, "a web page");
	assert.equal(h.pine.agents.outsideMark("main", "clean"), undefined);
	// A conversation that only lists the boards is not marked; one that reads the note is.
	await h.pine.agents.run({ agent: "main", session: "clean", prompt: mockMsg([{ tools: [call("boards")] }]), ...owner });
	assert.equal(h.pine.agents.outsideMark("main", "clean"), undefined);
	const r = await h.pine.agents.run({ agent: "main", session: "clean", prompt: mockMsg([{ tools: [call("board_read", { board: "findings" })] }]), ...owner });
	assert.match(r.text, /IGNORE-ALL-RULES/);
	assert.match(h.pine.agents.outsideMark("main", "clean") ?? "", /a post on the board "findings".*a web page/);
	// And one that only posts there is shown what is new, which marks it just the same.
	await h.pine.agents.run({ agent: "main", session: "poster", prompt: mockMsg([{ tools: [call("board_post", { type: "note", board: "findings", text: "mine" })] }]), ...owner });
	assert.match(h.pine.agents.outsideMark("main", "poster") ?? "", /a web page/);
	await h.close();
});

test("boards: what a pool's sub-agents all have to know is said once in a note, which each is shown when it starts", async () => {
	const h = await harness({ agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	for (const n of [1, 2]) h.mock.state.scripts[`w${n}`] = [{ text: `answer ${n}` }];
	h.mock.state.scripts.w3 = [{ tools: [call("board_post", { type: "note", on: 3, text: "half way" })] }, { text: "answer 3" }];
	// A note makes the call a pool, said or not: three tasks where two run at once.
	const r = await h.pine.agents.run({ agent: "main", session: "audit", prompt: mockMsg([{ tools: [call("subagent", { note: "THE-REFERENCE is src/styles/tokens.css", tasks: [1, 2, 3].map((n) => `check part ${n} @@REF:w${n}@@`) })] }]), ...owner });
	assert.equal(r.status, "done");
	const boards = h.pine.agents.boards;
	const board = boards.find("local", "main", "audit", "")!;
	assert.deepEqual(boards.items(board.id).map((x) => `${x.id}:${x.kind}`), ["1:task", "2:task", "3:task", "4:note", "5:note"]);
	assert.deepEqual(boards.item(4)!.data, { tasks: [1, 2, 3] }, "the note names the tasks it came with");
	assert.equal(boards.counts(board.id).done, 3);
	for (const n of [1, 2, 3]) {
		const worker = h.mock.state.requests.find((q: any) => !JSON.stringify(q.body.messages).includes("<<MOCK") && JSON.stringify(q.body.messages).includes(`check part ${n} @@REF:w${n}@@`));
		assert.match(JSON.stringify(worker.body.messages), /What everyone on this job goes by \(it was checked: no need to look it up again\):\\n- THE-REFERENCE is src\/styles\/tokens\.css\\n\\n\[pine: this is task #/, `sub-agent ${n} was shown the note`);
	}
	// What a sub-agent was started with is no news to it at its first board call.
	const third = h.mock.state.requests.filter((q: any) => !JSON.stringify(q.body.messages).includes("<<MOCK") && JSON.stringify(q.body.messages).includes("check part 3 @@REF:w3@@")).at(-1);
	assert.deepEqual(h.toolResults(third), ["Posted note #5 on the board of this conversation."]);
	// The same call once more adds no second note of the same words.
	await h.pine.agents.run({ agent: "main", session: "audit", prompt: mockMsg([{ tools: [call("subagent", { note: "THE-REFERENCE is  src/styles/tokens.css", tasks: [] })] }]), ...owner });
	assert.equal(boards.items(board.id, { kind: "note" }).filter((x) => !x.about).length, 1);

	// A second round on the same board has a note of its own: its sub-agents are shown theirs and not the first round's.
	h.mock.state.scripts.c1 = [{ text: "checked" }];
	await h.pine.agents.run({ agent: "main", session: "audit", prompt: mockMsg([{ tools: [call("subagent", { note: "ONLY-CHECK, change nothing", tasks: ["verify part 1 @@REF:c1@@"] })] }]), ...owner });
	const checker = h.pine.tasks.list({ limit: 50 }).find((t) => /verify part 1/.test(t.prompt) && t.kind === "subagent")!;
	assert.match(checker.prompt, /no need to look it up again\):\n- ONLY-CHECK, change nothing\n\n\[pine/);
	assert.doesNotMatch(checker.prompt, /THE-REFERENCE/);
	// A note posted for all with board_post is for every task, of any round.
	h.mock.state.scripts.c2 = [{ text: "checked" }];
	await h.pine.agents.run({ agent: "main", session: "audit", prompt: mockMsg([{ tools: [call("board_post", { type: "note", text: "FOR-EVERYONE: tabs, not spaces" })] }, { tools: [call("subagent", { pool: true, tasks: ["verify part 2 @@REF:c2@@"] })] }]), ...owner });
	const later = h.pine.tasks.list({ limit: 50 }).find((t) => /verify part 2/.test(t.prompt) && t.kind === "subagent")!;
	assert.match(later.prompt, /no need to look it up again\):\n- FOR-EVERYONE: tabs, not spaces\n\n\[pine/);
	await h.close();
});

test("boards: the note of a job is kept and shown to its sub-agents whole, with its line breaks; one too long to keep is refused before anything is posted", async () => {
	const h = await harness({ agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	h.mock.state.scripts.w = [{ text: "did it" }];
	// Longer than a note anybody else leaves, and with what matters at its end: where a sub-agent is told how to report.
	const note = `RULES-START\n${"One more rule about the work.\n".repeat(70)}Report in three lines. RULES-END`;
	assert.ok(note.length > NOTE_CHARS && note.length < JOB_NOTE_CHARS, String(note.length));
	const r = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["piece one @@REF:w@@", "piece two @@REF:w@@"], note })] }]), ...owner });
	assert.equal(r.status, "done");
	assert.equal(h.pine.agents.boards.items(1, { kind: "note" })[0].text, note);
	for (const t of h.pine.tasks.list({ limit: 20 }).filter((x) => x.kind === "subagent")) assert.ok(t.prompt.includes(`no need to look it up again):\n- ${note}\n\n[pine: this is task #`), `sub-agent #${t.id} was shown the whole note`);
	// A note that somebody leaves on the board while working stays short: it is cut, as before.
	h.pine.agents.boards.post(h.pine.agents.boards.get(1)!, { kind: "note", text: "x".repeat(NOTE_CHARS + 500), by: "main", trust: "owner" });
	assert.equal(h.pine.agents.boards.items(1, { kind: "note" }).at(-1)!.text.length, NOTE_CHARS + 1);
	// Too long even for a job's note: the call is refused, says what to do, and has posted nothing.
	const before = h.pine.agents.boards.items(1).length;
	await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["piece three @@REF:w@@"], note: "y".repeat(JOB_NOTE_CHARS + 1) })] }]), ...owner });
	assert.match(h.toolResults().at(-1)!, new RegExp(`"note" is ${JOB_NOTE_CHARS + 1} characters, at most ${JOB_NOTE_CHARS}\\. Write what is long into a file and name the file in the note`));
	assert.equal(h.pine.agents.boards.items(1).length, before);
	// The same for a task that is too long, which would reach its sub-agent without its end.
	await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["short @@REF:w@@", "z".repeat(TASK_CHARS + 1)] })] }]), ...owner });
	assert.match(h.toolResults().at(-1)!, new RegExp(`task 2 is ${TASK_CHARS + 1} characters, at most ${TASK_CHARS}\\. Say what all tasks share once in "note"`));
	assert.equal(h.pine.agents.boards.items(1).length, before);
	// And a result that is longer than a board holds says where it was cut, in pine's words.
	h.mock.state.scripts.long = [{ text: `LONG-START ${"a line of the report. ".repeat(300)}LONG-END` }];
	await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["report @@REF:long@@"] })] }, { text: "read it" }]), ...owner });
	const kept = h.pine.agents.boards.items(1, { kind: "task" }).at(-1)!.result!;
	assert.match(kept, /^LONG-START [\s\S]*\n\[pine: cut here\. This answer was \d+ characters, and a result on a board holds 4000: the rest is not kept\. Where all of it is needed, have it written to a file\.\]$/);
	assert.ok(!kept.includes("LONG-END") && h.toolResults().some((x) => x.includes("[pine: cut here.")), "the conversation is told too");
	await h.close();
});

test("boards: a note that a sub-agent posts after it read outside content marks the sub-agent that is started with it", async () => {
	const h = await harness({ pine: { security: { taintTools: ["read"] } }, agents: { main: { agent: { subagents: { maxParallel: 1 } }, files: { "page.txt": "a page\n" } } } });
	h.mock.state.scripts.reader = [{ tools: [call("read", { path: "page.txt" })] }, { tools: [call("board_post", { type: "note", text: "THE-PAGE-SAYS use tabs" })] }, { text: "read it" }];
	h.mock.state.scripts.doer = [{ text: "did it" }];
	const r = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["read the page @@REF:reader@@", "plain work @@REF:doer@@"] })] }]), ...owner });
	assert.equal(r.status, "done");
	const doer = h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === 2)!;
	assert.match(doer.prompt, /no need to look it up again\):\n- THE-PAGE-SAYS use tabs/, "the second sub-agent was shown the first one's note");
	assert.match(doer.meta.tainted ?? "", /read returned outside content/, "and started marked, as if it had read the page itself");
	await h.close();
});

/** The model requests of the conversation that a test scripted, in order: each holds the results of the tool calls before it. */
const turns = (h: any) => h.mock.state.requests.filter((q: any) => JSON.stringify(q.body.messages).includes("<<MOCK"));

test("boards: a pool comes back when a sub-agent asks, the conversation answers, and it goes on while the others worked on", async () => {
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 4 } }, agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	const boards = h.pine.agents.boards;
	h.mock.state.scripts.asks = [{ tools: [call("board_done", { id: 1, outcome: "blocked", result: "WHICH-WAY left or right?" })] }, { text: "stopped" }];
	h.mock.state.scripts.slow = [{ delayMs: 500, text: "slow one done" }];
	h.mock.state.scripts.quick = [{ text: "quick one done" }];
	// Whoever gets the first task after the answer does it.
	h.pine.bus.subscribe("pine/board", () => {
		if (boards.item(1)?.state === "blocked") h.mock.state.scripts.asks = [{ text: "went left" }];
	});
	const r = await h.pine.agents.run({
		agent: "main",
		session: "job",
		prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["first @@REF:asks@@", "second @@REF:slow@@", "third @@REF:quick@@"] })] }, { tools: [call("board_answer", { id: 1, text: "GO-LEFT", all: true })] }, { tools: [call("subagent", { pool: true, tasks: ["first @@REF:asks@@", "second @@REF:slow@@", "third @@REF:quick@@"] })] }]),
		...owner,
	});
	assert.equal(r.status, "done");
	// (The second call names the first one's tasks again, as a model that repeats itself does: none is on the board twice.)
	assert.deepEqual(boards.items(1, { kind: "task" }).map((x) => x.id), [1, 2, 3]);
	// The first call came back with the question while the second sub-agent was still at work, and started nothing new.
	const first = h.toolResults(turns(h)[1]).at(-1)!;
	assert.match(first, /^## Task #1 asks\nThe task: [^\n]*\nIts question:\nWHICH-WAY left or right\?\nTo answer: board_answer with id 1 and your answer\./);
	assert.match(first, /## Still being worked\n#2 \[taken by main\] second/);
	assert.match(first, /## Not done\n#3 \[open\] third/);
	assert.match(first, /## What to do now\nAnswer task #1 with board_answer: only that puts a task back to work.* asking your owner does not by itself answer the task\. .*close it yourself with board_done \(id, result\)\.\nThen call subagent with "pool": true to go on/);
	assert.doesNotMatch(first, /slow one done|quick one done/);
	// The answer is for the task that asked, and with "all" for the one that has not started yet: it need not ask the same.
	assert.equal(h.toolResults(turns(h)[2]).at(-1)!, "Answered. Task #1 is open again, and whoever takes it is shown the question and your answer. The 2 other tasks that are not finished are shown it as well.");
	assert.deepEqual(boards.items(1, { kind: "note" }).map((x) => [x.id, x.about ?? null, x.data ?? null]), [[4, 1, { question: "WHICH-WAY left or right?" }], [5, null, { tasks: [2, 3], question: "WHICH-WAY left or right?", of: 1 }]]);
	const third = h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === 3)!;
	assert.match(third.prompt, /third @@REF:quick@@\n\nQuestions that other tasks of this job asked, and the answers\. Each is about that other task, which somebody else does: you do not do it\. Where your own task meets the same question, go by the answer and do not ask again\.\n- Asked by the sub-agent of another task \(#1\), about its own task: WHICH-WAY left or right\?\n  Answer: GO-LEFT\n\nYour task is the one at the top, and only that: third @@REF:quick@@\n\n\[pine/);
	assert.doesNotMatch(h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === 2)!.prompt, /GO-LEFT/, "the one that was at work already was started without it");
	// The second call took over the sub-agent that was still at work, gave the first task out again, and says each result once.
	const last = r.text.split(" || ").at(-1)!;
	assert.match(last, /## Task #1: done\nThe task: [^\n]*\nIts result:\nwent left\nNotes about it:\n- Asked: WHICH-WAY left or right\?\n  Answer: GO-LEFT/);
	assert.match(last, /## Task #2: done\nThe task: [^\n]*\nIts result:\nslow one done/);
	assert.match(last, /## Task #3: done\nThe task: [^\n]*\nIts result:\nquick one done/);
	assert.match(last, /All 3 tasks of the board are done\. If the job has pieces that were not given as tasks yet, it is not done: /);
	assert.doesNotMatch(last, /Task #1 asks|What to do now/);
	assert.equal(h.pine.tasks.list({ limit: 50 }).filter((t) => t.kind === "subagent").length, 4, "one sub-agent per task, and one more for the task that was asked about");
	// The one that did the first task in the end was shown the question and the answer.
	const again = h.pine.tasks.list({ limit: 50 }).filter((t) => t.meta.boardTask === 1).sort((x, y) => y.id - x.id)[0];
	assert.match(again.prompt, /first @@REF:asks@@\n\nQuestions that were asked about this task and are answered\. They are settled: go by the answers and do not ask them again\.\n- Asked: WHICH-WAY left or right\?\n  Answer: GO-LEFT\n\n\[pine: this is task #1/);
	assert.match(again.prompt, /What is answered above is given: use it\./);
	// A question is answered by whoever gave out the work, and only a question.
	h.mock.state.scripts.sub = [{ tools: [call("board_answer", { id: 1, text: "x" })] }];
	const other = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("board_answer", { id: 1, text: "x" }), call("subagent", { tasks: ["@@REF:sub@@"] })] }]), ...owner });
	assert.match(other.text, /task #1 is done, it waits for no answer/);
	assert.match(other.text, /You are a sub-agent: this is not yours to do/);
	await h.close();
});

test("boards: one answer does for every task that has the same question: those that asked are opened again, and one that asks a moment later is given out again without a turn of the conversation", async () => {
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 5 } }, agents: { main: { agent: { subagents: { maxParallel: 3 } } } } });
	const boards = h.pine.agents.boards;
	// Three sub-agents need the same value: two ask at once, the third is still at work when the answer is given and asks then.
	// (The pool comes back when the first of them has ended. Each ends when the other has asked too, and the third
	// asks when the answer is on the board: by what happened, not by the clock, which a busy machine does not keep.)
	const blocked = (id: number) => boards.item(id)?.state === "blocked";
	// A script is looked up at every request. Each sub-agent keeps the one it began with until its part is over (the
	// two that asked first: until their question has its answer; the third: until it has asked), and whoever is given
	// the task after that does it. Swapped the moment a task had asked, the step that waits for the other was never used.
	const hasAnswer = (id: number) => boards.items(1, { about: id }).length > 0;
	let thirdAsked = false;
	h.pine.bus.subscribe("pine/board", () => void (thirdAsked ||= blocked(3)));
	const script = (name: string, first: any[], over: () => boolean) => Object.defineProperty(h.mock.state.scripts, name, { configurable: true, get: () => (over() ? [{ text: `${name} done at RATE-100` }] : first) });
	script("a", [{ tools: [call("board_done", { id: 1, outcome: "blocked", result: "WHAT-RATE for a?" })] }, { until: () => blocked(2), text: "stopped" }], () => hasAnswer(1));
	script("b", [{ tools: [call("board_done", { id: 2, outcome: "blocked", result: "WHAT-RATE for b?" })] }, { until: () => blocked(1), text: "stopped" }], () => hasAnswer(2));
	script("c", [{ until: () => boards.items(1, { kind: "note" }).length > 0, tools: [call("board_done", { id: 3, outcome: "blocked", result: "WHAT-RATE for c?" })] }, { text: "stopped" }], () => thirdAsked);
	const r = await h.pine.agents.run({
		agent: "main",
		session: "job",
		// (The action is written with its family's name in front, as a model sometimes writes it: it is carried out all the same.)
		prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["one @@REF:a@@", "two @@REF:b@@", "three @@REF:c@@"] })] }, { tools: [call("pine_board", { action: "pine_board.board_answer", id: 1, text: "RATE-100", all: true })] }, { tools: [call("subagent", { pool: true })] }]),
		...owner,
	});
	assert.equal(r.status, "done");
	const [first, answered, last] = [h.toolResults(turns(h)[1]).at(-1)!, h.toolResults(turns(h)[2]).at(-1)!, r.text.split(" || ").at(-1)!];
	assert.match(first, /## Task #1 asks\nThe task: [^\n]*\nIts question:\nWHAT-RATE for a\?/);
	assert.match(first, /## Task #2 asks\nThe task: [^\n]*\nIts question:\nWHAT-RATE for b\?/);
	assert.match(first, /## Still being worked\n#3 \[taken by main\]/);
	assert.equal(answered, "Answered. Task #1 is open again, and whoever takes it is shown the question and your answer. Task #2, which asked too, is open again with the same answer. The 1 other task that is not finished is shown it as well.");
	// Each task that asked has the answer beside its own question, and the one still at work is named in the note for all.
	assert.deepEqual(boards.items(1, { kind: "note" }).map((x) => [x.about ?? null, x.text, x.data]), [
		[1, "RATE-100", { question: "WHAT-RATE for a?" }],
		[2, "RATE-100", { question: "WHAT-RATE for b?" }],
		[null, "RATE-100", { tasks: [3], question: "WHAT-RATE for a?", of: 1 }],
	]);
	// The second call finishes all three. The third asked after the answer was given: it was given out again by pine
	// itself, with the answer, and the conversation was never turned to for it.
	for (const name of ["a", "b", "c"]) assert.match(last, new RegExp(`${name} done at RATE-100`));
	assert.match(last, /All 3 tasks of the board are done\. If the job has pieces that were not given as tasks yet, it is not done: /);
	assert.doesNotMatch(last, /Task #3 asks/);
	assert.equal(turns(h).length, 4, "three calls and the final answer: no turn for the third question");
	const third = h.pine.tasks.list({ limit: 50 }).filter((t) => t.meta.boardTask === 3).sort((x, y) => y.id - x.id)[0];
	assert.match(third.prompt, /^three @@REF:c@@\n\nQuestions that other tasks of this job asked, and the answers\. Each is about that other task, which somebody else does: you do not do it\. Where your own task meets the same question, go by the answer and do not ask again\.\n- Asked by the sub-agent of another task \(#1\), about its own task: WHAT-RATE for a\?\n  Answer: RATE-100\n\nYour task is the one at the top, and only that: three @@REF:c@@\n\n\[pine/);
	assert.equal(h.pine.tasks.list({ limit: 50 }).filter((t) => t.kind === "subagent").length, 6, "each task was given out twice, and none a third time");
	await h.close();
});

test("boards: a conversation whose turn ended is told at its next pool call what its sub-agents finished meanwhile", async () => {
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 4 } }, agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	const boards = h.pine.agents.boards;
	h.mock.state.scripts.asks = [{ tools: [call("board_done", { id: 1, outcome: "blocked", result: "WHICH-WAY?" })] }, { text: "stopped" }];
	// The slow one answers once the test has seen it at work (by what happened, not by the clock).
	let seen = false;
	h.mock.state.scripts.slow = [{ until: () => seen, text: "slow one done" }];
	// The turn ends with the question open and a sub-agent at work, which finishes its task all the same.
	await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["first @@REF:asks@@", "second @@REF:slow@@"] })] }]), ...owner });
	assert.equal(boards.item(2)!.state, "taken");
	seen = true;
	await until(() => boards.item(2)!.state === "done", 5000, "the sub-agent that was still at work to finish");
	// A call without an answer comes back at once and does not ask the same question as news again.
	const idle = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { pool: true })] }]), ...owner });
	assert.match(idle.text, /## Task #2: done\nThe task: [^\n]*\nIts result:\nslow one done/);
	assert.match(idle.text, /## Task #1 asks\nThe task: [^\n]*\nIts question:\nWHICH-WAY\?/, "a question is said again until it is answered");
	assert.match(idle.text, /After you answered, call subagent with "pool": true to have the answered tasks done\. Until then another call starts nothing\.$/);
	h.mock.state.scripts.asks = [{ text: "did it" }];
	const r = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("board_answer", { id: 1, text: "THAT-WAY" })] }, { tools: [call("subagent", { pool: true, tasks: [] })] }]), ...owner });
	assert.match(r.text, /## Task #1: done\nThe task: [^\n]*\nIts result:\ndid it/);
	assert.doesNotMatch(r.text, /## Task #2/);
	await h.close();
});

test("boards: a task that waits for another is shown what came of it, and a conversation that is stopped takes its sub-agents with it", async () => {
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 4 } }, agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	const boards = h.pine.agents.boards;
	h.mock.state.scripts.writer = [{ text: "WROTE-THE-SUMMARY in out/a.md" }];
	h.mock.state.scripts.checker = [{ text: "checked it" }];
	const r = await h.pine.agents.run({
		agent: "main",
		session: "job",
		prompt: mockMsg([{ tools: [call("board_post", { type: "task", text: "write @@REF:writer@@" })] }, { tools: [call("board_post", { type: "task", text: "check @@REF:checker@@", after: [1] })] }, { tools: [call("subagent", { pool: true, tasks: [] })] }]),
		...owner,
	});
	assert.match(r.text, /## Task #2: done\nThe task: [^\n]*\nIts result:\nchecked it/);
	const checker = h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === 2)!;
	assert.match(checker.prompt, /^check @@REF:checker@@\n\nThis task waited for another one, which is done\. What came of it:\n- task #1 \(write @@REF:writer@@\): WROTE-THE-SUMMARY in out\/a\.md\n\n\[pine: this is task #2/);

	// Stopped between two pool calls: the sub-agent that was still at work is stopped, and its task is open again.
	h.mock.state.scripts.asks = [{ tools: [call("board_done", { id: 3, outcome: "blocked", result: "WHICH?" })] }, { text: "stopped" }];
	h.mock.state.scripts.long = [{ delayMs: 20_000, text: "never" }];
	const run = h.pine.agents.submit({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["third @@REF:asks@@", "fourth @@REF:long@@"] })] }, { delayMs: 20_000, text: "thinking" }]), ...owner });
	await until(() => boards.item(3)?.state === "blocked" && boards.item(4)?.state === "taken", 5000, "the pool to come back with the question");
	await until(() => h.toolResults(turns(h).at(-1)).some((x: string) => /## Task #3 asks/.test(x)), 5000, "the conversation to be at the model again");
	h.pine.agents.cancel(run.id);
	await h.pine.agents.wait(run.id);
	await until(() => boards.item(4)!.state === "open", 5000, "the sub-agent's task to be open again");
	assert.equal(h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === 4)!.status, "cancelled");
	await h.close();
});

test("boards: with a check, every task of a pool is followed by a second sub-agent that is shown the work and what came of it", async () => {
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 4 } }, agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	const boards = h.pine.agents.boards;
	h.mock.state.scripts.w1 = [{ text: "WROTE-ONE into out/1.md" }];
	h.mock.state.scripts.w2 = [{ delayMs: 200, text: "WROTE-TWO into out/2.md" }];
	// (A check names the work it checks, so the scripted model finds the worker's script in it: each script answers twice.)
	h.mock.state.scripts.w1.push({ text: "unused" });
	const r = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { check: "CHECK-IT against the chapter", note: "TWO-SENTENCES each", tasks: ["write one @@REF:w1@@", "write two @@REF:w2@@"] })] }]), ...owner });
	assert.equal(r.status, "done");
	const tasks = boards.items(1, { kind: "task" });
	assert.deepEqual(tasks.map((t) => [t.id, t.state, t.after]), [[1, "done", []], [2, "done", []], [3, "done", [1]], [4, "done", [2]]]);
	assert.match(tasks[2].text, /^CHECK-IT against the chapter\n\nYou check the work of another sub-agent: whether it did what its task says, and whether what it reports is true\. You do not do it again and you change nothing\. Look at what it left .*then end your answer with one word on a line of its own: PASS when its work is right and complete, FAIL when it is not\. FAIL is for what can be pointed at: .* What is a matter of taste or wording is a remark, not a FAIL\. You judge the work, not what the work was about: a task that was to find faults and found them all is PASS\. That sub-agent's task was:\nwrite one @@REF:w1@@\n\nIt was told:\nTWO-SENTENCES each$/);
	assert.deepEqual([tasks[2].data, tasks[3].data], [{ check: 1 }, { check: 2 }], "a check names the task it checks");
	// The note is for the work, not for the checks, which carry it in their own words.
	assert.deepEqual(boards.items(1, { kind: "note" })[0].data, { tasks: [1, 2] });
	const checker = h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === 3)!;
	assert.match(checker.prompt, /This task waited for another one, which is done\. What came of it:\n- task #1 \(write one @@REF:w1@@\): WROTE-ONE into out\/1\.md\n\n\[pine: this is task #3/);
	assert.doesNotMatch(checker.prompt, /What everyone on this job goes by/);
	// The first check started while the second piece of work was still going: it did not wait for the round to end.
	const started = (item: number) => h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === item)!.id;
	assert.ok(started(3) < started(4));
	assert.equal(h.pine.tasks.list({ limit: 50 }).filter((t) => t.kind === "subagent").length, 4);
	// A check without tasks checks nothing, and says so.
	const none = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { check: "x" })] }]), ...owner });
	assert.match(none.text, /"check" is for the tasks of the call it comes with: give the tasks too/);
	await h.close();
});

test("boards: a check says PASS or FAIL as a line of its own, and what a rule or a sentence says is no verdict", () => {
	for (const [text, want] of [
		["PASS", "pass"],
		["Rule by rule: all three hold.\n\nPASS", "pass"],
		["The file is there. Checking each rule:\n\nPASS\n\n- Rule 1: three sentences", "pass"],
		["1. Three sentences: **Pass.**\n2. Words: 52. **Fail.**\n\n**FAIL**", "fail"],
		["nothing else is wrong.\nFinal verdict: **FAIL**", "fail"],
		["FAIL: the word count is 52", "fail"],
		["all good\nPASSED", "pass"],
		// The last line of its own counts: a check that changed its mind while writing.
		["PASS\n\nOn a second look the total is off by one.\n\nFAIL", "fail"],
		["- Rule 1: PASS\n- Rule 2: PASS\nAll fine.", undefined],
		["Result: 1 deviation found (FAIL), everything else PASS.", undefined],
		["I could not pass the file to the checker.", undefined],
		["", undefined],
	] as const) assert.equal(verdictOf(text), want, text);
	assert.equal(verdictOf(undefined), undefined);
});

test("boards: a check that fails gives the work out again with what it found, and checks it again; after two rounds its report stands", async () => {
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 4 } }, agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	const boards = h.pine.agents.boards;
	// The work is done twice at most, and its check each time. The scripts say what each run answers, in the order the runs come.
	let wrote = 0, checked = 0;
	Object.defineProperty(h.mock.state.scripts, "w", { get: () => [{ text: `WROTE-V${++wrote}` }] });
	Object.defineProperty(h.mock.state.scripts, "chk", { get: () => [{ text: ++checked === 1 ? "The summary has three sentences, not two.\n\nFAIL" : "Two sentences, every fact from the chapter.\n\nPASS" }] });
	const r = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { check: "COUNT-THE-SENTENCES @@REF:chk@@", tasks: ["write the summary @@REF:w@@"] })] }]), ...owner });
	assert.equal(r.status, "done");
	const [work, check] = boards.items(1, { kind: "task" });
	assert.deepEqual([work.state, work.result, work.data], ["done", "WROTE-V2", { reworked: 1 }]);
	assert.deepEqual([check.state, verdictOf(check.result), check.data], ["done", "pass", { check: work.id }]);
	assert.equal([wrote, checked].join(), "2,2", "the work twice, and its check twice");
	// Whoever does the work again is told what the check found and what was answered before.
	const runs = h.pine.tasks.list({ limit: 50 }).filter((t) => t.meta.boardTask === work.id).sort((a, b) => a.id - b.id);
	assert.equal(runs.length, 2);
	assert.match(runs[1].prompt, /Notes about this task:\n- A sub-agent did this task before you, and a check found its result wrong or incomplete\. Do the task again, as it is written, and get right what the check found\. The task has not changed: change files only where the task itself says to .*What the check found: The summary has three sentences, not two\. FAIL What the sub-agent before you answered: WROTE-V1/);
	// The conversation is told the result as it stands, that the work was done again, and of the check only that it passed.
	assert.match(r.text, /## Task #1: done \(done again once after its check failed\)\nThe task: [^\n]*\nIts result:\nWROTE-V2/);
	assert.match(r.text, /## Check of task #1 \(#2\): PASS\nTwo sentences, every fact from the chapter\./);
	assert.doesNotMatch(r.text, /three sentences, not two|WROTE-V1|Notes about it/);

	// A check that settles its task itself (board_done) instead of leaving it to its answer: what failed is given out again all the same.
	let made = 0;
	Object.defineProperty(h.mock.state.scripts, "w3", { get: () => [{ text: `MADE-${++made}` }] });
	let said = 0;
	// (Which task it has, the check reads in what pine wrote under its task.)
	const mine = () => Number(/this is task #(\d+) of a board/.exec(JSON.stringify(h.mock.state.requests.at(-1)!.body.messages))![1]);
	Object.defineProperty(h.mock.state.scripts, "self", { get: () => (said++ === 0 ? [{ tools: [call("board_done", { id: mine(), result: "One row is missing.\nFAIL" })] }, { text: "settled it" }] : said === 2 ? [{ text: "x" }, { text: "settled it" }] : [{ text: "PASS" }]) });
	const own = await h.pine.agents.run({ agent: "main", session: "job1b", prompt: mockMsg([{ tools: [call("subagent", { check: "LOOK-AT-IT @@REF:self@@", tasks: ["make it @@REF:w3@@"] })] }]), ...owner });
	assert.equal(made, 2, own.text);
	assert.match(own.text, /## Task #\d+: done \(done again once after its check failed\)\nThe task: [^\n]*\nIts result:\nMADE-2/);

	// A check that keeps failing: the work is given out again MAX_REWORK times, then the report is the conversation's to act on.
	let again = 0;
	Object.defineProperty(h.mock.state.scripts, "w2", { get: () => [{ text: `TRIED-${++again}` }] });
	h.mock.state.scripts.never = [{ text: "Still wrong.\nFAIL" }];
	const stuck = await h.pine.agents.run({ agent: "main", session: "job2", prompt: mockMsg([{ tools: [call("subagent", { check: "IS-IT-RIGHT @@REF:never@@", tasks: ["do it @@REF:w2@@"] })] }]), ...owner });
	assert.equal(again, MAX_REWORK + 1);
	assert.match(stuck.text, new RegExp(`## Task #\\d+: done \\(done again ${MAX_REWORK === 1 ? "once" : `${MAX_REWORK} times`} after its check failed\\)\\nThe task: [^\\n]*\\nIts result:\\nTRIED-${MAX_REWORK + 1}`));
	assert.match(stuck.text, new RegExp(`## Check of task #\\d+ \\(#\\d+\\): FAIL, still, after the work was done ${MAX_REWORK + 1} times: it is yours to decide what is done about it\\nStill wrong\\.`));
	await h.close();
});

test("boards: stages are worked one after the other, each shown what came of the one before, and a final check comes after everything", async () => {
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 4 } }, agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	const boards = h.pine.agents.boards;
	h.mock.state.scripts.a = [{ delayMs: 120, text: "BASE-A is in src/a.js" }];
	h.mock.state.scripts.b = [{ text: "BASE-B is in src/b.js" }];
	h.mock.state.scripts.c = [{ text: "JOINED both in src/index.js" }];
	h.mock.state.scripts.v = [{ text: "index.js imports a file that is not there.\n\nFAIL" }];
	const r = await h.pine.agents.run({
		agent: "main",
		session: "job",
		prompt: mockMsg([{ tools: [call("subagent", { stages: [["write a @@REF:a@@", "write b @@REF:b@@"], ["join them @@REF:c@@"]], note: "ES-MODULES only", verify: "IMPORT-IT and see @@REF:v@@" })] }]),
		...owner,
	});
	assert.equal(r.status, "done");
	const tasks = boards.items(1, { kind: "task" });
	assert.deepEqual(tasks.map((t) => [t.id, t.state, t.after, t.data?.check]), [[1, "done", [], undefined], [2, "done", [], undefined], [3, "done", [1, 2], undefined], [4, "done", [1, 2, 3], "job"]]);
	// The second stage started after both of the first were done, and was shown what came of them.
	const joiner = h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === 3)!;
	assert.match(joiner.prompt, /^join them @@REF:c@@\n\nThis task waited for others, which are done\. What came of them:\n- task #1 \(write a @@REF:a@@\): BASE-A is in src\/a\.js\n- task #2 \(write b @@REF:b@@\): BASE-B is in src\/b\.js\n\nWhat everyone on this job goes by/);
	// The final check is for a sub-agent that did none of it, goes by the note too, and its verdict is the conversation's to act on.
	assert.match(tasks[3].text, /^IMPORT-IT and see @@REF:v@@\n\nYou check the result of a whole job that other sub-agents did; you did none of it\. You change nothing\./);
	assert.deepEqual(boards.items(1, { kind: "note" })[0].data, { tasks: [1, 2, 3, 4] });
	assert.match(r.text, /## Final check \(#4\): FAIL\nindex\.js imports a file that is not there\./);
	assert.match(r.text, /The final check found something wrong\. Have it put right: hand out what it found as new tasks/);
	assert.equal(tasks[2].data?.reworked, undefined, "nothing is given out again by itself after a final check");

	// Stages with a check: the next stage waits for the checks of the one before, too. "tasks" and "stages" together are refused.
	h.mock.state.scripts.ok = [{ text: "PASS" }];
	await h.pine.agents.run({ agent: "main", session: "job2", prompt: mockMsg([{ tools: [call("subagent", { stages: [["first @@REF:a@@"], ["second @@REF:c@@"]], check: "LOOK @@REF:ok@@" })] }]), ...owner });
	const second = boards.items(2, { kind: "task" });
	assert.deepEqual(second.map((t) => [t.after, t.data?.check]), [[[], undefined], [[second[0].id], second[0].id], [[second[0].id, second[1].id], undefined], [[second[2].id], second[2].id]]);
	// A final check alone: of what is there already, with nothing to wait for.
	const alone = await h.pine.agents.run({ agent: "main", session: "job4", prompt: mockMsg([{ tools: [call("subagent", { verify: "RECOUNT what I did @@REF:ok@@" })] }]), ...owner });
	assert.match(alone.text, /## Final check \(#\d+\): PASS/);
	assert.deepEqual(boards.items(boards.find("local", "main", "job4", "")!.id, { kind: "task" }).map((t) => [t.after, t.data?.check, t.state]), [[[], "job", "done"]]);
	// A model that fills in every argument: "false" and "none" are no check, and "yes" does not say what to check.
	h.mock.state.scripts.p = [{ text: "plain answer" }];
	const filled = await h.pine.agents.run({ agent: "main", session: "job5", prompt: mockMsg([{ tools: [call("subagent", { tasks: ["a piece @@REF:p@@"], check: "false", verify: "none" })] }]), ...owner });
	assert.match(filled.text, /## Sub-task 1: done\nplain answer/, "a plain call, with no board");
	assert.equal(boards.find("local", "main", "job5", ""), undefined);
	const yes = await h.pine.agents.run({ agent: "main", session: "job5", prompt: mockMsg([{ tools: [call("subagent", { tasks: ["a piece @@REF:p@@"], check: "Yes: a second sub-agent." })] }]), ...owner });
	assert.match(yes.text, /"check" says what is to be checked and against what/);
	// A check of the whole that fails three times in a row is not asked a fourth time, and the conversation is told to stop there.
	h.mock.state.scripts.bad = [{ text: "The tone is off.\n\nFAIL" }];
	const round = () => h.pine.agents.run({ agent: "main", session: "job6", prompt: mockMsg([{ tools: [call("subagent", { tasks: ["fix it @@REF:p@@"], verify: "IS-IT-GOOD @@REF:bad@@" })] }]), ...owner });
	assert.match((await round()).text, /The final check found something wrong\. Have it put right/);
	assert.match((await round()).text, /The final check failed again\. If what it found is a real fault .* If it is the same point again, or a matter of taste, stop here/);
	await round();
	const fourth = await round();
	assert.match(fourth.text, /The whole was checked 3 times in a row and failed each time, so no further check was made\. Do not hand it out again/);
	assert.equal(boards.items(boards.find("local", "main", "job6", "")!.id, { kind: "task" }).filter((t) => t.data?.check === "job").length, 3);
	const both = await h.pine.agents.run({ agent: "main", session: "job3", prompt: mockMsg([{ tools: [call("subagent", { tasks: ["x"], stages: [["y"]] })] }]), ...owner });
	assert.match(both.text, /give "tasks" \(all side by side\) or "stages" \(one stage after the other\), not both/);
	await h.close();
});

test("boards: tasks split over several pool calls in one answer are one pool, not several", async () => {
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 6 } }, agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	const boards = h.pine.agents.boards;
	for (const n of [1, 2, 3, 4]) h.mock.state.scripts[`w${n}`] = [{ delayMs: 80, text: `answer ${n}` }];
	const taken: number[] = [];
	h.pine.bus.subscribe("pine/board", () => void taken.push(boards.counts(1).taken));
	const r = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { note: "THE-RULES", tasks: ["one @@REF:w1@@", "two @@REF:w2@@"] }), call("subagent", { note: "THE-RULES", tasks: ["three @@REF:w3@@", "four @@REF:w4@@"] })] }]), ...owner });
	assert.equal(r.status, "done");
	const [first, second] = r.text.replace(/^FINAL:: /, "").split(" || ");
	// One call works all four; the other says its tasks were added, and brings nothing twice.
	const [worked, added] = /added to the pool/.test(first) ? [second, first] : [first, second];
	assert.match(added, /^2 tasks added to the pool that is at work on this board\. The call that started the pool brings their results/);
	for (const n of [1, 2, 3, 4]) assert.match(worked, new RegExp(`## Task #\\d+: done\\nThe task: [^\\n]*\\nIts result:\\nanswer ${n}`));
	assert.match(worked, /All 4 tasks of the board are done\. If the job has pieces that were not given as tasks yet, it is not done: /);
	assert.ok(Math.max(...taken) <= 2, `never more at once than the agent's sub-agents may be (${Math.max(...taken)})`);
	assert.equal(boards.items(1, { kind: "note" }).length, 1, "the same note once");
	assert.deepEqual((boards.items(1, { kind: "note" })[0].data as any).tasks.length, 4, "and it is for all four tasks");
	assert.equal(h.pine.agents.pooling.size, 0);
	await h.close();
});

test("boards: a new board with a name says whom it is for, and with a scope exactly that board is meant", async () => {
	const h = await harness({ agents: { main: {}, helper: {} } });
	// Without a scope nothing is made: a board for one conversation by default would look to its maker like one that others use.
	let r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_post", { board: "bugs", type: "task", text: "fix a" })] }]), ...owner });
	assert.match(r.text, /there is no board "bugs" yet\. To make it, post again with "scope", which says whom it is for: "local" \(this conversation and the sub-agents it starts, nobody else\), "agent" \(all your conversations\), "global" \(all agents\)\./);
	assert.deepEqual(h.pine.agents.boards.list(), []);
	// Another agent is not offered what it cannot make.
	r = await h.pine.agents.run({ agent: "helper", prompt: mockMsg([{ tools: [call("board_post", { type: "note", board: "bugs", text: "x" })] }]), ...owner });
	assert.match(r.text, /"agent" \(all your conversations\)\.$/m);
	assert.doesNotMatch(r.text, /global/);
	// Said to be for this conversation, it is made, and the answer says who sees it.
	r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_post", { board: "bugs", scope: "local", type: "task", text: "fix a" })] }]), ...owner });
	assert.match(r.text, /Posted task #1 on the board "bugs" \(of this conversation\)\. The board is new\. Only this conversation and the sub-agents it starts see it: no other agent does, and a post on it wakes nobody\./);
	// With a scope the board of that place is meant, not the nearer one of the same name; without one, the nearest.
	r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_post", { board: "bugs", scope: "global", type: "task", text: "fix b" }), call("board_post", { type: "note", board: "bugs", text: "a note" })] }]), ...owner });
	assert.match(r.text, /Posted task #2 on the board "bugs" \(for all agents\)\. The board is new\. Every agent can use it\./);
	assert.match(r.text, /Posted note #3 on the board "bugs" \(of this conversation\)\.(?! The board is new)/);
	assert.deepEqual(h.pine.agents.boards.list().map((b) => `${b.scope}:${b.name}`), ["local:bugs", "global:bugs"]);
	// A scope without a name names no board.
	r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_post", { type: "note", scope: "global", text: "x" })] }]), ...owner });
	assert.match(r.text, /a board for all agents needs a name: give "board" too/);
	await h.close();
});

test("boards: only the main agent makes a board for all agents, a sub-agent makes none beyond its conversation, and another agent's board is closed", async () => {
	const h = await harness({ agents: { main: {}, helper: {} } });
	h.mock.state.scripts.sub = [{ tools: [call("board_post", { type: "note", board: "wide", scope: "agent", text: "x" })] }];
	let r = await h.pine.agents.run({ agent: "helper", prompt: mockMsg([{ tools: [call("board_post", { type: "note", board: "bugs", scope: "global", text: "x" }), call("board_post", { type: "note", board: "own", scope: "agent", text: "helper's own" })] }]), ...owner });
	assert.match(r.text, /Only the main agent \(main\) can make a board for all agents/);
	r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_read", { board: "own" }), call("board_read", { id: 1 }), call("board_post", { board: "bugs", scope: "global", type: "task", text: "for everyone" }), call("subagent", { tasks: ["@@REF:sub@@"] })] }]), ...owner });
	assert.match(r.text, /There is no board "own" that you can use/);
	assert.match(r.text, /there is no #1 on a board of yours/);
	assert.match(r.text, /You are a sub-agent: this is not yours to do/);
	assert.deepEqual(h.pine.agents.boards.list().map((b) => `${b.scope}:${b.agent}:${b.name}`), ["agent:helper:own", "global::bugs"]);
	// The other agent reads and takes what is on the board for all.
	r = await h.pine.agents.run({ agent: "helper", prompt: mockMsg([{ tools: [call("board_claim", { board: "bugs" })] }, { tools: [call("board_done", { id: 2, result: "fixed" })] }]), ...owner });
	assert.equal(h.pine.agents.boards.item(2)!.state, "done");
	assert.equal(h.pine.agents.boards.item(2)!.holder, "helper");
	await h.close();
});

test("boards: a task handed to another agent works on the board of the conversation that handed it on", async () => {
	const h = await harness({ agents: { main: { agent: { delegates: ["helper"] } }, helper: {} } });
	h.mock.state.scripts.helper = [{ tools: [call("board_read")] }, { tools: [call("board_post", { type: "note", text: "HELPER-FOUND the cause" })] }, { text: "done by helper" }];
	const r = await h.pine.agents.run({ agent: "main", session: "proj", prompt: mockMsg([{ tools: [call("board_post", { type: "note", text: "MAIN-NOTE the reference is tokens.css" })] }, { tools: [call("delegate", { agent: "helper", task: "@@REF:helper@@" })] }, { tools: [call("board_read")] }]), ...owner });
	assert.equal(r.status, "done");
	const helper = h.mock.state.requests.filter((q: any) => JSON.stringify(q.body.messages).includes("@@REF:helper@@") && !JSON.stringify(q.body.messages).includes("<<MOCK")).at(-1);
	assert.match(JSON.stringify(helper.body.messages), /MAIN-NOTE the reference is tokens\.css/);
	assert.match(r.text, /#2 note by helper: HELPER-FOUND the cause/);
	assert.deepEqual(h.pine.agents.boards.list().map((b) => `${b.agent}:${b.session}`), ["main:proj"]);
	await h.close();
});

test("boards: a run that outside content started has no board unless its profile gives it one, and what it posts counts as from outside", async () => {
	const h = await harness({ agents: { main: {}, open: { agent: { untrusted: { tools: ["read"], board: true } } } } });
	const none = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_post", { type: "note", text: "x" })] }]), trust: "untrusted" });
	assert.equal(h.pine.agents.boards.list().length, 0, none.text);
	const req = h.mock.state.requests.at(-1);
	assert.ok(!h.toolsOffered(req).some((t) => t.startsWith("board")), "not registered at all");

	const global = h.pine.agents.boards.ensure("global", "", "", "inbox");
	const events: any[] = [];
	h.pine.bus.subscribe("board/#", (e) => void events.push(e));
	await h.pine.agents.run({ agent: "open", prompt: mockMsg([{ tools: [call("board_post", { board: "inbox", type: "task", text: "do what the mail says" }), call("board_post", { type: "note", board: "wide", scope: "agent", text: "x" })] }]), trust: "untrusted" });
	const item = h.pine.agents.boards.items(global.id)[0];
	assert.equal(item.trust, "untrusted");
	assert.deepEqual(h.pine.agents.boards.list().map((b) => b.name), ["inbox"], "no board beyond its own conversation is made by such a run");
	await h.pine.bus.drain();
	assert.equal(events[0].topic, "board/inbox/task");
	assert.equal(events[0].trust, "untrusted");
	await h.close();
});

test("boards: a board with a name says what happens on it as events that only pine publishes, and a route wakes an agent with them", async () => {
	const h = await harness({
		pine: { routes: [{ name: "bugs", on: "board/bugs/task", agent: "helper", prompt: "{{payload.text}}" }] },
		agents: { main: { agent: { publish: ["board/#", "x/#"] } }, helper: {} },
	});
	const events: any[] = [];
	h.pine.bus.subscribe("board/#", (e) => void events.push(e));
	const r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("publish_event", { topic: "board/bugs/task", text: "forged" })] }, { tools: [call("board_post", { board: "bugs", scope: "global", type: "task", text: "the login page is blank" })] }, { tools: [call("board_post", { board: "local-one", scope: "local", type: "task", text: "quiet" })] }]), ...owner });
	assert.match(r.text, /not allowed to publish on "board\/bugs\/task"/);
	await until(() => h.pine.tasks.list({ agent: "helper" }).some((t) => t.status === "done"));
	assert.deepEqual(events.map((e) => e.topic), ["board/bugs/task"], "a board of one conversation publishes nothing");
	assert.equal(events[0].trust, "owner");
	assert.equal(events[0].payload.id, 1);
	const woken = h.pine.tasks.list({ agent: "helper" })[0];
	assert.match(woken.prompt, /Task #1 on the board "bugs" is ready to be taken:\nthe login page is blank/);
	assert.equal(woken.meta.trust, "owner");
	// What becomes of it is said too.
	h.pine.agents.boards.settle(1, "done", "fixed in a.ts");
	await h.pine.bus.drain();
	assert.equal(events.at(-1).topic, "board/bugs/done");
	// A task that was asked about and answered is announced with the answer: whoever is woken for it may be the one
	// that asked, and would otherwise take it for the task it remembers.
	const task = h.pine.agents.boards.post(h.pine.agents.boards.get(1)!, { kind: "task", text: "move the meeting", by: "main", trust: "owner" });
	h.pine.agents.boards.settle(task.id, "blocked", "WHICH-DAY?");
	await h.pine.bus.drain();
	assert.equal(events.at(-1).topic, "board/bugs/blocked");
	const answered = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_answer", { id: task.id, text: "THURSDAY" })] }]), ...owner });
	assert.match(answered.text, /Answered\. Task #\d+ is open again/);
	await h.pine.bus.drain();
	const again = events.filter((e) => e.topic === "board/bugs/task").at(-1);
	assert.match(again.payload.text, /is ready to be taken again, with what was noted about it since:\nmove the meeting\n\nNotes about it:\n- main answered "WHICH-DAY\?": THURSDAY$/);
	assert.equal(again.trust, "owner");
	await h.close();
});

test("boards: a conversation's board goes when the conversation is forgotten, and an agent's with the agent", async () => {
	const h = await harness({ agents: { main: {}, helper: {} } });
	await h.pine.agents.run({ agent: "helper", session: "work", prompt: mockMsg([{ tools: [call("board_post", { type: "note", text: "a" }), call("board_post", { type: "note", board: "kept", scope: "agent", text: "b" })] }]), ...owner });
	await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_post", { type: "note", board: "all", scope: "global", text: "c" })] }]), ...owner });
	const names = () => h.pine.agents.boards.list().map((b) => `${b.scope}:${b.agent}:${b.session}:${b.name}`);
	assert.deepEqual(names(), ["local:helper:work:", "agent:helper::kept", "global:::all"]);
	await h.pine.agents.renameSession("helper", "work", "job");
	assert.deepEqual(names()[0], "local:helper:job:");
	await h.pine.agents.resetSession("helper", "job");
	assert.deepEqual(names(), ["agent:helper::kept", "global:::all"]);
	await h.pine.agents.removeAgent("helper");
	assert.deepEqual(names(), ["global:::all"]);
	await h.close();
});

test("boards: the owner reads every board through the control API, posts on one, answers a blocked task and takes one back", async () => {
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: { agent: { subagents: { maxParallel: 1 } } }, helper: {} } });
	const base = `http://127.0.0.1:${h.pine.http!.port}`;
	const req = async (method: string, url: string, body?: unknown) => {
		const res = await fetch(base + url, { method, headers: { authorization: `Bearer ${h.pine.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
		return { status: res.status, body: (await res.json()) as any };
	};
	assert.equal((await fetch(`${base}/boards`)).status, 401);
	assert.deepEqual((await req("GET", "/agents/main/boards?session=work")).body, []);
	// A task of the owner's makes the conversation's board.
	const posted = await req("POST", "/agents/main/boards/post", { session: "work", text: "look at the footer @@REF:slow@@" });
	assert.deepEqual(posted.body, { board: 1, id: 1 });
	assert.equal((await req("POST", "/boards/1/post", { text: "" })).status, 400);
	assert.equal((await req("POST", "/boards/9/post", { text: "x" })).status, 400);
	await req("POST", "/boards/1/post", { kind: "note", text: "the reference is tokens.css" });
	const list = await req("GET", "/agents/main/boards?session=work");
	assert.deepEqual(list.body.map((b: any) => [b.id, b.scope, b.session, b.counts.open, b.counts.notes]), [[1, "local", "work", 1, 1]]);
	assert.deepEqual((await req("GET", "/agents/helper/boards")).body, [], "another agent's conversation does not have it");
	// The list of boards says where each task stands, what it comes after and who has it, and nothing of its text:
	// what a UI needs to draw a board, and all a view of the owner's is ever told.
	const briefs = (await req("GET", "/boards")).body;
	assert.equal(briefs.length, 1);
	// (Of a task also who posted it, when, since when it stands so, how many notes are about it and whether it carries
	// outside content: names and numbers.)
	const { created, updated, ...told } = briefs[0].tasks[0];
	assert.deepEqual(told, { id: 1, state: "open", after: [], waits: false, by: "owner", notes: 0, outside: false });
	assert.ok(created > 0 && updated >= created);
	assert.equal(briefs[0].tasks.length, 1);
	assert.ok(!JSON.stringify(briefs).includes("look at the footer") && !JSON.stringify(briefs).includes("tokens.css"));

	// A sub-agent of the pool has the task; the owner takes it back, which stops that sub-agent.
	h.mock.state.scripts.slow = [{ delayMs: 5000, text: "too late" }];
	const changes: any[] = [];
	h.pine.bus.subscribe("pine/board", (e) => void changes.push(e.payload));
	const working = h.pine.agents.run({ agent: "main", session: "work", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: [] })] }]), ...owner });
	await until(() => h.pine.agents.boards.item(1)!.state === "taken");
	let view = (await req("GET", "/boards/1")).body;
	assert.equal(view.tasks[0].state, "taken");
	assert.equal(view.tasks[0].sub, true);
	assert.equal(view.notes[0].by, "owner");
	// Taken back, it is open again and the pool gives it to a new sub-agent; removed, that one is stopped too and the pool ends.
	const first = view.tasks[0].run;
	// (Once it is at the model, like the one after it below: a task is taken the moment its sub-agent is started, and on
	// a busy machine that is some time before the sub-agent's first request, from which on stopping reaches it.)
	const atModel = () => h.mock.state.requests.filter((q: any) => JSON.stringify(q.body.messages).includes("this is task #1 of a board")).length;
	await until(() => atModel() >= 1);
	assert.deepEqual((await req("POST", "/boards/items/1", { action: "reopen" })).body, { ok: true });
	await until(() => h.pine.tasks.get(first)!.status === "cancelled" && h.pine.agents.boards.item(1)!.state === "taken");
	assert.notEqual(h.pine.agents.boards.item(1)!.run, first);
	// (Once the new one is at the model: stopping a run reaches it from there on.)
	await until(() => atModel() >= 2);
	await req("POST", "/boards/items/1", { action: "remove" });
	const r = await working;
	assert.equal(r.status, "done");
	assert.match(r.text, /No task on the board was ready|## Task #1/);
	assert.ok(changes.some((c) => c.board === 1 && c.change === "taken" && c.agent === "main" && c.session === "work"), "a UI is told which board changed");
	// It is told which post changed and how a task stands now, never a word of what the post says.
	const took = changes.find((c) => c.board === 1 && c.change === "taken");
	assert.deepEqual([took.item, took.kind, took.state], [1, "task", "taken"]);
	assert.ok(changes.every((c) => !JSON.stringify(c).includes("look at the footer")));


	// A blocked task waits for the owner's answer, which is a note on it, and is open again.
	const blocked = (await req("POST", "/boards/1/post", { text: "pick a color" })).body.id;
	await h.pine.agents.run({ agent: "main", session: "work", prompt: mockMsg([{ tools: [call("board_claim", { id: blocked })] }, { tools: [call("board_done", { id: blocked, outcome: "blocked", result: "blue or green?" })] }]), ...owner });
	assert.equal((await req("POST", `/boards/items/${blocked}`, { action: "answer" })).status, 400);
	await req("POST", `/boards/items/${blocked}`, { action: "answer", text: "green" });
	view = (await req("GET", "/boards/1")).body;
	// The sub-agent that takes it next is given the answer with the task.
	h.mock.state.scripts.painter = [{ text: "painted" }];
	await req("POST", `/boards/${view.board.id}/post`, { kind: "note", text: "use the brush @@REF:painter@@", on: blocked });
	await h.pine.agents.run({ agent: "main", session: "work", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: [] })] }]), ...owner });
	const taker = h.mock.state.requests.find((q: any) => JSON.stringify(q.body.messages).includes("@@REF:painter@@") && !JSON.stringify(q.body.messages).includes("<<MOCK"));
	const painter = h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === blocked && t.kind === "subagent")!;
	assert.match(painter.prompt, /^pick a color\n\nNotes about this task:\n- your owner: use the brush @@REF:painter@@\n\nWhat everyone on this job goes by [^\n]*\n- your owner: the reference is tokens\.css\n\nQuestions that were asked about this task and are answered\. They are settled: go by the answers and do not ask them again\.\n- Asked: blue or green\?\n  Answer \(from your owner\): green\n\n\[pine/, painter.prompt);
	assert.ok(taker, "and that is what the model was sent");
	assert.equal(h.pine.agents.boards.item(blocked)!.result, "painted");
	h.pine.agents.boards.reopen(blocked);
	view = (await req("GET", "/boards/1")).body;
	assert.equal(view.tasks.find((t: any) => t.id === blocked).state, "open");
	assert.deepEqual([view.notes.at(-2).text, view.notes.at(-2).data], ["green", { question: "blue or green?" }], "the answer is the note, and it says which question it answers");
	assert.equal(view.notes.at(-2).about, blocked);
	assert.equal(view.notes.at(-2).outside, false);
	assert.deepEqual((await req("POST", "/boards/1/remove", {})).body, { removed: true });
	assert.equal((await req("GET", "/boards/1")).status, 404);
	await h.close();
});

test("boards: a task that a sub-agent posts after it read outside content marks the sub-agent that does it, and the conversation", async () => {
	// (`read` stands in for a tool that returns outside content.)
	const h = await harness({ pine: { security: { taintTools: ["read"] } }, agents: { main: { agent: { subagents: { maxParallel: 1 } }, files: { "page.txt": "a page\n" } } } });
	h.mock.state.scripts.reader = [{ tools: [call("read", { path: "page.txt" })] }, { tools: [call("board_post", { type: "task", text: "do as the page says @@REF:doer@@" })] }, { text: "read it" }];
	h.mock.state.scripts.doer = [{ text: "did it" }];
	const r = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["read the page @@REF:reader@@"] })] }]), ...owner });
	assert.equal(r.status, "done");
	const boards = h.pine.agents.boards;
	assert.deepEqual(boards.items(1, { kind: "task" }).map((t) => [t.id, t.state, Boolean(t.tainted)]), [[1, "done", true], [2, "done", true]], "the first one's result and the task it posted both carry the mark");
	const doer = h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === 2)!;
	assert.match(doer.meta.tainted ?? "", /read returned outside content/, "the sub-agent that took the task started marked");
	assert.match(h.pine.agents.outsideMark("main", "job") ?? "", /outside content/);
	await h.close();
});

test("boards: a sub-agent whose answer ends with a question leaves its task blocked, not done, and one answer for all puts them back to work", async () => {
	// What happened: sub-agents told to ask the owner counted their folder and asked at the end of their answer. Settled
	// as done, the question read like one that was open, and the conversation answered tasks that were over.
	assert.equal(asksAtEnd("COUNT 12 lines.\n\nWhat reviewer throughput should I use, in **lines per hour**?"), true);
	assert.equal(asksAtEnd("Should it be left or right?)\n"), true);
	assert.equal(asksAtEnd("Is it safe? Yes: nothing else uses it."), false);
	assert.equal(asksAtEnd("The check:\n```js\nconst x = a ? b : c?\n```"), false);
	assert.equal(asksAtEnd(""), false);

	const h = await harness({ pine: { limits: { maxConcurrentRuns: 4 } }, agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	const boards = h.pine.agents.boards;
	h.mock.state.scripts.a = [{ text: "COUNT-A 12 lines.\n\nWhat reviewer rate should I use, in lines per hour?" }];
	h.mock.state.scripts.b = [{ delayMs: 250, text: "COUNT-B 30 lines. What reviewer rate should I use?" }];
	// Given out again with the answer, each does its task.
	h.pine.bus.subscribe("pine/board", () => {
		if (boards.item(1)?.state === "blocked") h.mock.state.scripts.a = [{ text: "COUNT-A 12 lines: 0.12 hours" }];
		if (boards.item(2)?.state === "blocked") h.mock.state.scripts.b = [{ text: "COUNT-B 30 lines: 0.3 hours" }];
	});
	const r = await h.pine.agents.run({
		agent: "main",
		session: "count",
		prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["count a @@REF:a@@", "count b @@REF:b@@"] })] }, { tools: [call("board_answer", { id: 1, text: "100 lines per hour", all: true })] }, { tools: [call("subagent", { pool: true })] }]),
		...owner,
	});
	assert.equal(r.status, "done");
	const first = h.toolResults(turns(h)[1]).at(-1)!;
	assert.match(first, /## Task #1 asks\nThe task: [^\n]*\nIts question:\nCOUNT-A 12 lines\.\n\nWhat reviewer rate should I use, in lines per hour\?\nTo answer: board_answer with id 1/);
	assert.match(first, /## Still being worked\n#2 \[taken by main\] count b/);
	assert.doesNotMatch(first, /## Task #\d: done/);
	// The second asks the same a moment after the answer for all: blocked, not done, and given out again with the answer.
	assert.match(h.toolResults(turns(h)[2]).at(-1)!, /The 1 other task that is not finished is shown it as well\./);
	const last = r.text.split(" || ").at(-1)!;
	assert.match(last, /## Task #1: done\nThe task: [^\n]*\nIts result:\nCOUNT-A 12 lines: 0\.12 hours/);
	assert.match(last, /## Task #2: done\nThe task: [^\n]*\nIts result:\nCOUNT-B 30 lines: 0\.3 hours/);
	// And a sub-agent is told so before it answers.
	assert.match(h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === 1)!.prompt, /Do not end it with a question: an answer that ends by asking something is taken for a question, and the task waits for the answer\./);
	await h.close();
});

test("boards: sub-agents given tasks that are on a board for all agents settle those tasks there, and leave the others of that board alone", async () => {
	const h = await harness({ agents: { main: {}, helper: {} } });
	h.mock.state.scripts.s2 = [{ text: "SLEEP-ANSWER" }];
	h.mock.state.scripts.s3 = [{ delayMs: 60, text: "FOOD-ANSWER" }];
	await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("pine_board", { action: "board_post", board: "todo", scope: "global", kind: "task", text: "rss for one @@REF:none@@" })] }, { tools: [call("board_post", { board: "todo", type: "task", text: "sleep @@REF:s2@@" }), call("board_post", { board: "todo", type: "task", text: "food waste @@REF:s3@@" })] }]), ...owner });
	const boards = h.pine.agents.boards;
	const todo = boards.find("global", "", "", "todo")!;
	// A post that does not say what it is is refused, not made a note that nobody can take.
	// Declared by itself or as an action of pine_board, the schema refuses it; the family says in full what the tool takes.
	const vague = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_post", { board: "todo", text: "a task or a note?" }), call("pine_board", { action: "board_post", board: "todo", text: "a task or a note?" })] }]), ...owner });
	assert.equal(vague.text.match(/type: missing/g)?.length, 2, vague.text);
	assert.match(vague.text, /What board_post takes, in full:[\s\S]*"type": "task"/);
	assert.equal(boards.items(todo.id).length, 3);
	// (The first was posted with "kind", the name the argument had before: it is a task all the same.)
	assert.deepEqual(boards.items(todo.id, { kind: "task" }).map((t) => t.state), ["open", "open", "open"]);

	const r = await h.pine.agents.run({ agent: "helper", session: "work", prompt: mockMsg([{ tools: [call("subagent", { ids: [2, 3] })] }]), ...owner });
	assert.equal(r.status, "done");
	assert.match(r.text, /## Task #2: done\nThe task: [^\n]*\nIts result:\nSLEEP-ANSWER/);
	assert.match(r.text, /## Task #3: done\nThe task: [^\n]*\nIts result:\nFOOD-ANSWER/);
	assert.match(r.text, /All 2 tasks you gave out on the board "todo" \(for all agents\) are done/);
	// The very tasks that were given out are done, by the helper's sub-agents; the one nobody gave it is still open.
	assert.deepEqual(boards.items(todo.id, { kind: "task" }).map((t) => `${t.state}:${t.holder ?? ""}:${t.result ?? ""}`), ["open::", "done:helper:SLEEP-ANSWER", "done:helper:FOOD-ANSWER"]);
	// No copies: the helper's own board has no tasks.
	const own = boards.find("local", "helper", "work", "");
	assert.equal(own ? boards.items(own.id, { kind: "task" }).length : 0, 0);
	assert.equal(h.pine.agents.poolAt.has("helper:work"), false);

	// A task that is settled already, or on a board the run cannot use, is refused with what to do.
	const again = await h.pine.agents.run({ agent: "helper", session: "work", prompt: mockMsg([{ tools: [call("subagent", { ids: [2] })] }]), ...owner });
	assert.match(again.text, /"ids": task #2 is done already\. Leave it out/);
	await h.pine.agents.run({ agent: "main", session: "mine", prompt: mockMsg([{ tools: [call("board_post", { type: "task", text: "main's own" })] }]), ...owner });
	const closed = await h.pine.agents.run({ agent: "helper", session: "work", prompt: mockMsg([{ tools: [call("subagent", { ids: [4] })] }]), ...owner });
	assert.match(closed.text, /"ids": there is no task #4 on a board of yours/);
	await h.close();
});

test("boards: a board that is not there yet is never made again by whoever was told of it: a sub-agent is refused, another agent is told who makes it", async () => {
	// The owner's run that went wrong: main handed out work "on the global board todo" before it had made it.
	const h = await harness({ agents: { main: { agent: { delegates: ["helper"] } }, helper: {} } });
	h.mock.state.scripts.sub = [{ tools: [call("board_post", { type: "note", board: "todo", text: "SUB-RESULT" })] }, { tools: [call("board_post", { type: "note", text: "SUB-RESULT on my own board" })] }];
	h.mock.state.scripts.helper = [{ tools: [call("board_claim", { board: "todo" })] }, { tools: [call("board_post", { type: "note", board: "todo", text: "HELPER-RESULT" })] }, { tools: [call("subagent", { tasks: ["@@REF:sub@@"] })] }];
	const r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("delegate", { agent: "helper", task: "On global board todo, take a task @@REF:helper@@" })] }]), ...owner });
	const said = h.toolResults(h.mock.state.requests.filter((q: any) => JSON.stringify(q.body.messages).includes("@@REF:helper@@") && !JSON.stringify(q.body.messages).includes("<<MOCK")).at(-1)).join("\n");
	// Another agent that looks for it is told that the main agent makes a board for all agents, and not to make a look-alike.
	assert.match(said, /there is no board "todo" that you can use\. A board for all agents is made by the main agent \(main\): if you were told to use one by this name, it is not there yet\. Do not make another: say in your answer that it was not there\./);
	assert.match(said, /there is no board "todo" yet\. A board for all agents is made by the main agent \(main\).*To make one of your own, post again with "scope"/s);
	// A sub-agent is refused outright: it makes no board with a name. Its conversation's own board is still there for it.
	assert.match(said, /there is no board "todo"\. A sub-agent makes no board with a name: leave out "board" to post on the board of your conversation, or say in your answer that the board "todo" was not there\./);
	const boards = h.pine.agents.boards;
	assert.deepEqual(boards.list().map((b) => `${b.scope}:${b.name}`), ["local:"], "no board named todo anywhere");
	assert.equal(boards.items(boards.list()[0].id)[0].text, "SUB-RESULT on my own board");
	// The main agent is told how to make it.
	const own = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_read", { board: "todo" })] }]), ...owner });
	assert.match(own.text, /There is no board "todo" that you can use\. The boards list says which there are\. board_post with this name and "scope" makes it\./);
	assert.equal(r.status, "done");
	await h.close();
});
