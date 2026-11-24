import assert from "node:assert/strict";
import { after, test } from "node:test";
import { verdictOf } from "../src/boards.ts";
import { checkPrompt, checkTask, continuePrompts, MAX_CHECKS, startPrompt } from "../src/swarm.ts";
import { PineTui } from "../src/tui/app.ts";
import { Client } from "../src/tui/client.ts";
import { harness, type Harness, rawTextOf, sleep, until } from "./support/harness.ts";
import { FakeTerminal, KEY } from "./support/terminal.ts";

const owner = { trust: "owner" as const };
const apps: PineTui[] = [];
after(async () => {
	for (const app of apps) await app.stop().catch(() => {});
});
const call = (name: string, args: any) => ({ name, args });
const swarmOf = (h: Harness, session = "main") => h.pine.agents.swarms.get("main", session);
const quiet = (h: Harness) => !h.pine.tasks.list({ limit: 300 }).some((t) => t.status === "pending" || t.status === "running");
/** The swarm is no longer at work, and nothing is running. */
const settled = (h: Harness, session = "main") => until(() => swarmOf(h, session)?.status !== "active" && quiet(h), 10_000, "the swarm to stop");
/** The lead's turns, oldest first. */
const turns = (h: Harness, session = "main") => h.pine.tasks.list({ agent: "main", session, limit: 300 }).filter((t) => t.parent === undefined).reverse();
/**
 * A swarm whose lead is scripted by round: the job names the script "lead", and what the model answers
 * depends on which round the swarm is in. The check pine posts quotes the job, so the sub-agent that does
 * it finds the same name: it is told apart by how its task begins, and answers what `checker` says.
 */
async function swarm(rounds: (round: number) => any[], o: { checker?: (n: number) => string; checkMs?: number; checkUntil?: () => boolean; pine?: Record<string, unknown>; agents?: Record<string, any>; models?: any[] } = {}) {
	const h = await harness({ ...(o.models ? { models: o.models } : {}), pine: { limits: { maxConcurrentRuns: 4 }, ...(o.pine ?? {}) }, agents: { main: { agent: { subagents: { maxParallel: 2 } } }, ...(o.agents ?? {}) } });
	let checks = 0;
	Object.defineProperty(h.mock.state.scripts, "lead", {
		get: () => {
			const messages = h.mock.state.requests.at(-1)?.body.messages ?? [];
			const last = rawTextOf([...messages].reverse().find((m: any) => m.role === "user")?.content ?? "");
			if (/Check the answer below before the one who asked for it relies on it/.test(last)) return [{ ...(o.checkMs ? { delayMs: o.checkMs } : {}), ...(o.checkUntil ? { until: o.checkUntil } : {}), text: (checks++, o.checker?.(checks) ?? "PASS") }];
			return rounds(swarmOf(h)?.round ?? 1);
		},
	});
	const events: any[] = [];
	h.pine.bus.subscribe("agent/main/swarm", (e) => void events.push(e.payload));
	return { h, events, job: "sort out the archive @@REF:lead@@", checks: () => checks, opts: o };
}

test("swarm: the lead hands the job out and answers, pine has that answer checked by a sub-agent that did none of the work, and a check that passes ends it without another turn of the lead's", async () => {
	const { h, events, job, checks } = await swarm(() => [{ tools: [call("subagent", { tasks: ["piece one @@REF:one@@", "piece two @@REF:two@@"], note: "THE-RULES" })] }, { text: "LEAD-ANSWER both pieces are done, SECRET-WORD" }]);
	h.mock.state.scripts.one = [{ text: "ONE-DONE" }];
	h.mock.state.scripts.two = [{ text: "TWO-DONE" }];
	const set = h.pine.agents.swarms.set("main", "main", job);
	assert.deepEqual([set.status, set.round, set.until, set.since], ["active", 1, 8, 0]);
	await settled(h);

	const s = swarmOf(h)!;
	assert.deepEqual([s.status, s.round, s.checks, s.checking], ["done", 1, 1, undefined]);
	assert.equal(s.note, "done after 1 round: 2 tasks, and the answer was checked");
	assert.deepEqual(events.map((e) => e.event), ["set", "checking", "done"]);
	assert.equal(events[1].note, "the answer is being checked by a sub-agent that did none of the work");
	assert.equal(checks(), 1);
	// One turn of the lead's: the job in the owner's words and pine's frame, which says what a swarm's lead does.
	const [first] = turns(h);
	assert.equal(turns(h).length, 1);
	assert.equal(first.prompt, startPrompt(job));
	assert.ok(first.prompt.startsWith(`${job}\n\n[pine: your owner started a swarm`));
	for (const word of ['"tasks"', '"stages"', '"note"', '"check"', 'No "verify"', "board_answer", "do it yourself, now, and answer", "Not when your owner's request says to use sub-agents", "do none of its pieces yourself", "ask your owner with question before you hand the job out", "this answer is what gets checked"]) assert.ok(first.prompt.includes(word), word);
	assert.equal(first.result, "LEAD-ANSWER both pieces are done, SECRET-WORD");
	// The check is a task of the board: it holds the job and the answer in full, and says how it ends.
	const check = h.pine.agents.boards.item(4)!;
	assert.deepEqual([check.state, check.data, check.by, verdictOf(check.result)], ["done", { check: "job", answer: true }, "main", "pass"]);
	assert.equal(check.text, checkTask(job, "LEAD-ANSWER both pieces are done, SECRET-WORD"));
	assert.match(check.text, /end your answer with one word on a line of its own: PASS when the answer is right and complete, FAIL when it is not/);
	// pine started the sub-agent that did it, under the lead's turn: a sub-agent of that conversation, which cannot ask.
	const checker = h.pine.tasks.list({ limit: 100 }).find((t) => t.meta.boardTask === 4)!;
	assert.deepEqual([checker.kind, checker.parent, checker.meta.trust, checker.status], ["subagent", first.id, "owner", "done"]);
	assert.equal(checker.prompt, checkPrompt(check));
	assert.match(checker.prompt, /\[pine: this is task #4 of a board, and it is a check\. You start in the folder the work was done in: .* the last line of your answer is one word and nothing else: PASS or FAIL\. FAIL only for something you found wrong and can point at\. Something you could not check is not that: [^\n]*\]$/);
	// A long answer goes to the check whole: cut in the middle, the check would call what was left out missing.
	const long = `START ${"a row of the list. ".repeat(500)}END`;
	assert.ok(checkTask(job, long).includes(long), `${long.length} characters`);
	await h.close();
});

test("swarm: tasks that are not done call the lead again, and a check the lead had made inside its call does not stand in for the check of its answer", async () => {
	const { h, events, job, checks } = await swarm((round) =>
		round === 1
			? // Posts the work and ends its turn without having it done.
				[{ tools: [call("board_post", { type: "task", text: "piece one @@REF:one@@" })] }, { text: "FIRST-ANSWER the plan is on the board" }]
			: [{ tools: [call("subagent", { pool: true, verify: "RECOUNT the piece @@REF:v@@" })] }, { text: "SECOND-ANSWER the piece is done" }],
	);
	h.mock.state.scripts.one = [{ text: "ONE-DONE" }];
	h.mock.state.scripts.v = [{ text: "PASS" }];
	h.pine.agents.swarms.set("main", "main", job);
	await settled(h);

	const s = swarmOf(h)!;
	assert.deepEqual([s.status, s.round, s.checks], ["done", 2, 1]);
	assert.deepEqual(events.map((e) => e.event), ["set", "continue", "checking", "done"]);
	assert.equal(events[1].note, "1 task is not done: round 2 of 8 starts");
	assert.equal(checks(), 1);
	const [first, second] = turns(h);
	assert.equal(turns(h).length, 2);
	// What calls the lead again is pine's own text with the job and numbers of tasks.
	assert.deepEqual([second.kind, second.meta.label], ["notify", "swarm: round 2 of 8"]);
	assert.match(second.prompt, /^\[pine: the swarm is not finished\. Not done on the board: #1\. Call subagent with "pool": true/);
	assert.ok(second.prompt.endsWith(`The job, in your owner's words:\n${job}`));
	assert.ok(!second.prompt.includes("FIRST-ANSWER"));
	assert.equal(first.result, "FIRST-ANSWER the plan is on the board");
	// The lead's own check of the pieces passed in round 2, and pine still had the answer of that round checked.
	const [piece, own, mine] = h.pine.agents.boards.items(1, { kind: "task" });
	assert.deepEqual([piece.data, own.data, verdictOf(own.result), mine.data], [undefined, { check: "job" }, "pass", { check: "job", answer: true }]);
	assert.equal(mine.text, checkTask(job, "SECOND-ANSWER the piece is done"));
	await h.close();
});

test("swarm: a check that fails calls the lead with the number of the check and no word of what it found; the new answer is checked once more, and a pass ends it", async () => {
	const { h, events, job, checks } = await swarm((round) => (round === 1 ? [{ text: "FIRST: the total is 12" }] : [{ tools: [call("board_read", { id: 1 })] }, { text: "SECOND: the total is 13" }]), { checker: (n) => (n === 1 ? "The total is wrong, SECRET-FINDING: it is 13.\n\nFAIL" : "Counted again: 13.\nPASS") });
	h.pine.agents.swarms.set("main", "main", job);
	await settled(h);
	const s = swarmOf(h)!;
	assert.deepEqual([s.status, s.round, s.checks, checks()], ["done", 2, 2, 2]);
	assert.equal(s.note, "done after 2 rounds: main did it without handing anything out, and the answer was checked");
	assert.deepEqual(events.map((e) => e.event), ["set", "checking", "continue", "checking", "done"]);
	assert.deepEqual([events[2].note, events[3].note], ["the check of the answer found something: main puts it right, round 2 of 8", "the new answer is being checked"]);
	const [, second] = turns(h);
	assert.equal(second.prompt, continuePrompts.failed(job, 1));
	assert.match(second.prompt, /^\[pine: your answer was checked by a sub-agent that did none of the work, and the check did not pass\. What it found is on the board: read it with board_read and id 1\. /);
	assert.match(second.prompt, /Then give your owner the whole answer again, as it now stands: it takes the place of the one before, and is checked once more\.\]/);
	// What the check found reaches the lead from the board, where it has the mark of the run that wrote it: never in pine's own words to the lead.
	assert.ok(!second.prompt.includes("SECRET-FINDING") && !second.prompt.includes("FIRST:"));
	assert.match(JSON.stringify(h.toolResults(h.mock.state.requests.filter((q: any) => JSON.stringify(q.body.messages).includes("did not pass")).at(-1))), /SECRET-FINDING/);
	// Each check is of the answer of the turn before it.
	const [one, two] = h.pine.agents.boards.items(1, { kind: "task" });
	assert.deepEqual([one.text, verdictOf(one.result)], [checkTask(job, "FIRST: the total is 12"), "fail"]);
	assert.deepEqual([two.text, verdictOf(two.result)], [checkTask(job, "SECOND: the total is 13"), "pass"]);
	await h.close();
});

test("swarm: a lead that does a small job itself has its answer checked all the same; after a second check that fails the swarm ends and says where to read why", async () => {
	const { h, events, job, checks } = await swarm((round) => [{ text: round === 1 ? "DID-IT-MYSELF: the total is 12" : `ANSWER-OF-ROUND-${round}: the total is 13` }], { checker: () => "The total is wrong.\n\nFAIL" });
	h.pine.agents.swarms.set("main", "main", job);
	await settled(h);
	const s = swarmOf(h)!;
	assert.deepEqual([s.status, s.round, s.checks], ["done", 2, MAX_CHECKS]);
	assert.equal(s.note, "ended after 2 rounds: main did it without handing anything out. The last check of the answer still found something: task #2 on the board says what");
	assert.equal(checks(), MAX_CHECKS);
	assert.deepEqual(events.map((e) => e.note.replace(/:.*/, "")), ["started", "the answer is being checked by a sub-agent that did none of the work", "the check of the answer found something", "the new answer is being checked", "ended after 2 rounds"]);
	assert.equal(turns(h).length, 2);
	const [one, two] = h.pine.agents.boards.items(1, { kind: "task" });
	assert.equal(one.text, checkTask(job, "DID-IT-MYSELF: the total is 12"));
	assert.equal(two.text, checkTask(job, "ANSWER-OF-ROUND-2: the total is 13"));
	await h.close();

	// One that passes after the lead did the job alone: done in its one round, and the note says how.
	const alone = await swarm(() => [{ text: "DID-IT-MYSELF" }]);
	alone.h.pine.agents.swarms.set("main", "main", alone.job);
	await settled(alone.h);
	assert.deepEqual([swarmOf(alone.h)!.status, swarmOf(alone.h)!.round, swarmOf(alone.h)!.note, turns(alone.h).length], ["done", 1, "done after 1 round: main did it without handing anything out, and the answer was checked", 1]);
	await alone.h.close();
});

test("swarm: paused while the answer is checked, the check ends by itself and resume takes its word; a check that was stopped is the lead's to have done, after whatever it adds", async () => {
	// The check takes a while; the owner pauses meanwhile. It passes with the swarm paused: resume finds that, and no turn starts.
	// The check answers only once the pause is in: on a slow machine any fixed time can run out before it.
	let pausedAlready = false;
	const { h, job, checks } = await swarm(() => [{ text: "THE-ANSWER" }], { checkUntil: () => pausedAlready });
	h.pine.agents.swarms.set("main", "main", job);
	await until(() => swarmOf(h)?.checking !== undefined, 5000, "the check to start");
	const paused = h.pine.agents.swarms.pause("main", "main");
	pausedAlready = true;
	assert.deepEqual([paused.status, paused.checking], ["paused", undefined]);
	await until(() => quiet(h), 5000, "the check to end");
	assert.deepEqual([swarmOf(h)!.status, verdictOf(h.pine.agents.boards.item(1)!.result)], ["paused", "pass"]);
	const resumed = h.pine.agents.swarms.resume("main", "main");
	assert.deepEqual([resumed.status, resumed.round, resumed.note, turns(h).length, checks()], ["done", 1, "done after 1 round: main did it without handing anything out, and the answer was checked", 1, 1]);
	await h.close();

	// The owner stops the check itself: the swarm pauses, the task is open again, and after resume the lead has it done.
	// What the lead adds beside it is done before it: the check of the answer is the last thing done.
	const stopped = await swarm((round) => (round === 1 ? [{ text: "THE-ANSWER" }] : [{ tools: [call("subagent", { pool: true, tasks: ["look once more @@REF:slow@@"] })] }, { text: "DONE-AFTER-BOTH" }]), { checkMs: 20_000 });
	stopped.h.mock.state.scripts.slow = [{ delayMs: 250, text: "LOOKED-AGAIN" }];
	stopped.h.pine.agents.swarms.set("main", "main", stopped.job);
	await until(() => stopped.h.pine.tasks.get(swarmOf(stopped.h)?.checking ?? -1)?.status === "running", 5000, "the check to run");
	const run = swarmOf(stopped.h)!.checking!;
	stopped.h.pine.agents.cancel(run);
	await stopped.h.pine.agents.wait(run);
	assert.deepEqual([swarmOf(stopped.h)!.status, swarmOf(stopped.h)!.note, swarmOf(stopped.h)!.checks], ["paused", "paused: the check of the answer was stopped. /swarm resume goes on", 0]);
	assert.equal(stopped.h.pine.agents.boards.item(1)!.state, "open");
	// (From here the check answers at once.)
	stopped.opts.checkMs = 0;
	const again = stopped.h.pine.agents.swarms.resume("main", "main");
	assert.deepEqual([again.status, again.round], ["active", 2]);
	assert.match(turns(stopped.h)[1].prompt, /^\[pine: the swarm is not finished\. Not done on the board: #1\. Call subagent with "pool": true/);
	await settled(stopped.h);
	const [check, added] = stopped.h.pine.agents.boards.items(1, { kind: "task" });
	assert.deepEqual([check.data?.check, added.data?.check], ["job", undefined]);
	assert.deepEqual(check.after, [added.id], "the check waits for what was added after it");
	assert.ok(check.updated >= added.updated, "and was done after it");
	// So the answer counts as checked, and pine asks for no second check.
	assert.deepEqual([swarmOf(stopped.h)!.status, swarmOf(stopped.h)!.round, swarmOf(stopped.h)!.checks], ["done", 2, 0]);
	await stopped.h.close();
});

test("swarm: the check of an answer that a lead wrote after it read outside content is outside content for the sub-agent pine starts, and what it found reaches the lead only from the board", async () => {
	const { h, job } = await swarm((round) => (round === 1 ? [{ tools: [call("read", { path: "page.txt" })] }, { text: "THE-PAGE-SAYS the total is 12" }] : [{ text: "SECOND-ANSWER" }]), {
		checker: (n) => (n === 1 ? "IGNORE-ALL-RULES said the answer.\nFAIL" : "PASS"),
		pine: { limits: { maxConcurrentRuns: 4 }, security: { taintTools: ["read"] } },
		agents: { main: { agent: { subagents: { maxParallel: 2 } }, files: { "page.txt": "a page\n" } } },
	});
	h.pine.agents.swarms.set("main", "main", job);
	await settled(h);
	assert.deepEqual([swarmOf(h)!.status, swarmOf(h)!.checks], ["done", 2]);
	// The task that holds the lead's answer carries the mark of the lead's run, and the sub-agent started for it starts marked.
	const [first, second] = h.pine.agents.boards.items(1, { kind: "task" });
	assert.match(first.tainted ?? "", /read returned outside content/);
	const checker = h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === first.id)!;
	assert.match(checker.meta.tainted ?? "", /read returned outside content/);
	assert.match(String(h.pine.agents.boards.item(first.id)!.tainted ?? ""), /read returned outside content/, "and so does its result");
	// The lead is called with the number alone: no word of the check's result is in pine's own text.
	assert.ok(!turns(h)[1].prompt.includes("IGNORE-ALL-RULES"));
	assert.match(second.tainted ?? "", /read returned outside content/);
	await h.close();
});

test("swarm: the answer is checked on the model the owner set for it (defaults.checker), the lead and its sub-agents stay on the agent's; a model that is not there refuses the swarm at its start", async () => {
	const { h, events, job } = await swarm(() => [{ tools: [call("subagent", { tasks: ["piece @@REF:one@@"] })] }, { text: "LEAD-ANSWER" }], { models: [{ id: "second" }], pine: { limits: { maxConcurrentRuns: 4 }, defaults: { checker: "mock/second" } } });
	h.mock.state.scripts.one = [{ text: "ONE-DONE" }];
	h.pine.agents.swarms.set("main", "main", job);
	await settled(h);
	assert.deepEqual([swarmOf(h)!.status, swarmOf(h)!.round], ["done", 1]);
	assert.equal(events[1].note, "the answer is being checked by a sub-agent that did none of the work, on mock/second");
	const checker = h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === 2)!;
	assert.equal(checker.meta.model, "mock/second");
	const asked = (q: any) => rawTextOf([...q.body.messages].reverse().find((m: any) => m.role === "user")?.content ?? "");
	const byModel = (model: string) => h.mock.state.requests.filter((q: any) => q.body.model === model).map(asked);
	assert.ok(byModel("second").length > 0 && byModel("second").every((x: string) => x.includes("Check the answer below")), "only the check goes to that model");
	assert.ok(!byModel("m").some((x: string) => x.includes("Check the answer below")), "and the check goes to no other");
	await h.close();

	const none = await harness({ pine: { limits: { maxConcurrentRuns: 4 }, defaults: { checker: "mock/missing" } }, agents: { main: {} } });
	assert.throws(() => none.pine.agents.swarms.set("main", "main", "the job"), /the answer of a swarm is checked on mock\/missing \(defaults\.checker\), and model "mock\/missing" is not defined in models\.json/);
	assert.equal(none.pine.tasks.list({ limit: 10 }).length, 0, "and nothing was started");
	await none.close();
});

test("swarm: what the owner answers to a question of the lead's is in the check of its answer, with the question; outside a swarm nothing is kept", async () => {
	const { h, job } = await swarm(() => [{ tools: [call("question", { question: "Which rate do I count a dollar at?" })] }, { text: "ANSWER at the rate you gave me" }]);
	h.pine.bus.subscribe("approval/requested", (e: any) => void (e.payload.tool === "question" && h.pine.approvals.decide(e.payload.id, true, "test", false, { answer: "0.90 EUR" })));
	h.pine.agents.swarms.set("main", "main", job);
	await settled(h);
	assert.deepEqual([swarmOf(h)!.status, swarmOf(h)!.told], ["done", [{ asked: "Which rate do I count a dollar at?", said: "0.90 EUR" }]]);
	const check = h.pine.agents.boards.items(1, { kind: "task" })[0];
	assert.equal(check.text, checkTask(job, "ANSWER at the rate you gave me", [{ asked: "Which rate do I count a dollar at?", said: "0.90 EUR" }]));
	assert.match(check.text, /\n- Asked: Which rate do I count a dollar at\?\n  The owner answered: 0\.90 EUR\n\nThe answer:\n/);
	// Without anything said, the check has no such part.
	assert.ok(!checkTask(job, "x").includes("What the owner said"));
	// A question in a conversation without a swarm is answered and kept nowhere.
	h.mock.state.scripts.plain = [{ tools: [call("question", { question: "Blue or green?" })] }, { text: "ok" }];
	await h.pine.agents.run({ agent: "main", session: "other", prompt: "pick @@REF:plain@@", ...owner });
	assert.equal(h.pine.agents.swarms.get("main", "other"), undefined);
	await h.close();
});

test("swarm: a check that the model server refuses for now is started again by pine after a pause; one that cannot be done pauses the swarm, and does not count as a check", async () => {
	// (pi asks again by itself a few times, with seconds in between: switched off here.)
	const { h, events, job, checks } = await swarm(() => [{ text: "THE-ANSWER" }], { agents: { main: { agent: { subagents: { maxParallel: 2 }, settings: { retry: { enabled: false } } } } } });
	h.pine.agents.retryPauseMs = 30;
	let refuse = 1;
	const limit = { status: 429, body: { type: "error", error: { type: "rate_limit_error", message: "Rate limit exceeded. Please try again later." } } };
	h.pine.bus.subscribe("agent/main/started", (e: any) => {
		if (e.payload.kind === "subagent" && refuse-- > 0) h.mock.state.failNext.push(limit);
	});
	h.pine.agents.swarms.set("main", "main", job);
	await settled(h);
	assert.deepEqual([swarmOf(h)!.status, swarmOf(h)!.round, swarmOf(h)!.checks, checks()], ["done", 1, 1, 1]);
	assert.deepEqual(events.map((e) => e.event), ["set", "checking", "checking", "done"]);
	assert.deepEqual([h.pine.agents.boards.item(1)!.data, turns(h).length], [{ check: "job", answer: true, retried: 1 }, 1]);
	await h.close();

	// Refused for good (a limit that does not pass): the swarm pauses and says why. After resume the lead answers again, and that is checked.
	const gone = await swarm(() => [{ text: "THE-ANSWER" }], { agents: { main: { agent: { subagents: { maxParallel: 2 }, settings: { retry: { enabled: false } } } } } });
	let once = 1;
	gone.h.pine.bus.subscribe("agent/main/started", (e: any) => {
		if (e.payload.kind === "subagent" && once-- > 0) gone.h.mock.state.failNext.push({ status: 429, body: { type: "error", error: { type: "GoUsageLimitError", message: "Monthly usage limit reached" } } });
	});
	gone.h.pine.agents.swarms.set("main", "main", gone.job);
	await settled(gone.h);
	assert.deepEqual([swarmOf(gone.h)!.status, swarmOf(gone.h)!.checks, gone.h.pine.agents.boards.item(1)!.state], ["paused", 0, "failed"]);
	assert.match(swarmOf(gone.h)!.note, /^paused: the check of the answer could not be done \(.*usage limit.*\)\. \/swarm resume goes on$/i);
	gone.h.pine.agents.swarms.resume("main", "main");
	await settled(gone.h);
	assert.deepEqual([swarmOf(gone.h)!.status, swarmOf(gone.h)!.round, swarmOf(gone.h)!.checks, gone.checks()], ["done", 2, 1, 1]);
	assert.match(turns(gone.h)[1].prompt, /^\[pine: the swarm goes on\. /);
	await gone.h.close();
});

test("swarm: a lead that asks its owner while work is left waits for the answer and goes on with it; a limit of rounds stops it with work left", async () => {
	const { h, events, job } = await swarm(() => [{ tools: [call("board_post", { type: "task", text: "piece @@REF:one@@" })] }, { text: "Which rate do I use?" }]);
	h.mock.state.scripts.one = [{ text: "ONE-DONE" }];
	h.mock.state.scripts.answer = [{ tools: [call("subagent", { pool: true })] }, { text: "DONE-WITH-THE-RATE" }];
	h.pine.agents.swarms.set("main", "main", job);
	await settled(h);
	assert.deepEqual([swarmOf(h)!.status, swarmOf(h)!.round], ["waiting", 1]);
	assert.match(swarmOf(h)!.note, /main asks you something: answer it, and the swarm goes on/);
	// The owner's answer is a turn of the swarm's: the board is looked at after it, and the answer it led to is checked.
	const r = await h.pine.agents.run({ agent: "main", session: "main", prompt: "0.9, as always @@REF:answer@@", ...owner });
	assert.equal(r.text, "DONE-WITH-THE-RATE");
	await settled(h);
	assert.deepEqual([swarmOf(h)!.status, swarmOf(h)!.round], ["done", 2]);
	assert.deepEqual(events.map((e) => e.event), ["set", "waiting", "resumed", "checking", "done"]);
	// The check is told what the owner said on the way: a value they gave is given, not one the answer made up.
	const checkText = h.pine.agents.boards.items(1, { kind: "task" }).at(-1)!.text;
	assert.equal(checkText, checkTask(job, "DONE-WITH-THE-RATE", [{ asked: "", said: "0.9, as always @@REF:answer@@" }]));
	assert.match(checkText, /What the owner said while the work was done\. It is given, like the request: an answer that goes by it is right to\.\n- The owner wrote: 0\.9, as always @@REF:answer@@\n\nThe answer:\nDONE-WITH-THE-RATE$/);
	await h.close();

	// A lead that never has its tasks done is called at most limits.swarmRounds times. /swarm resume gives it as many again.
	const stuck = await swarm((round) => [{ tools: [call("board_post", { type: "task", text: `piece ${round}` })] }, { text: "posted another one" }], { pine: { limits: { maxConcurrentRuns: 4, swarmRounds: 2 } } });
	stuck.h.pine.agents.swarms.set("main", "main", stuck.job);
	await settled(stuck.h);
	assert.deepEqual([swarmOf(stuck.h)!.status, swarmOf(stuck.h)!.round], ["limit", 2]);
	assert.match(swarmOf(stuck.h)!.note, /stopped after 2 rounds, which is the limit \(limits\.swarmRounds\), with work left\. \/swarm resume gives it 2 more/);
	const again = stuck.h.pine.agents.swarms.resume("main", "main");
	assert.deepEqual([again.status, again.round, again.until], ["active", 3, 4]);
	await settled(stuck.h);
	assert.deepEqual([swarmOf(stuck.h)!.status, swarmOf(stuck.h)!.round], ["limit", 4]);
	await stuck.h.close();
});

test("swarm: work the lead hands to another agent is a task on the board that this agent's answer settles, and a few sub-agents go over the board too", async () => {
	const { h, job } = await swarm(() => [{ tools: [call("delegate", { agent: "helper", task: "look up the rate @@REF:rate@@", wait: false }), call("subagent", { tasks: ["count the rows @@REF:rows@@"] })] }, { text: "LEAD-ANSWER" }], { agents: { helper: {} } });
	h.mock.state.scripts.rate = [{ text: "The rate is 0.9. Shall I look up last year's too?" }];
	h.mock.state.scripts.rows = [{ text: "12 rows" }];
	h.pine.agents.swarms.set("main", "main", job);
	await settled(h);
	assert.deepEqual([swarmOf(h)!.status, swarmOf(h)!.round, swarmOf(h)!.note], ["done", 1, "done after 1 round: 2 tasks, and the answer was checked"]);
	const tasks = h.pine.agents.boards.items(1, { kind: "task" });
	const handed = tasks.find((t) => t.data?.agent === "helper")!;
	// The other agent's answer is the task's result, also when it ends with a question: that goes back to who handed it the task.
	assert.deepEqual([handed.text, handed.state, handed.holder, handed.result], ["look up the rate @@REF:rate@@", "done", "helper", "The rate is 0.9. Shall I look up last year's too?"]);
	const run = h.pine.tasks.list({ agent: "helper", limit: 10 })[0];
	assert.deepEqual([run.kind, run.meta.boardTask, run.prompt], ["delegate", handed.id, "[task from agent main]\nlook up the rate @@REF:rate@@"]);
	// The lead waited for it although it said not to: a swarm is looked at when its lead ends a turn, and the work has to be in by then.
	assert.match(JSON.stringify(h.toolResults(h.mock.state.requests.filter((q: any) => JSON.stringify(q.body.messages).includes("started a swarm")).at(-1))), /\[helper\] The rate is 0\.9\./);
	// One sub-agent, no "pool": in a swarm it is a task on the board all the same.
	assert.deepEqual(tasks.filter((t) => t.data?.agent === undefined).map((t) => [t.state, t.data?.check]), [["done", undefined], ["done", "job"]]);
	// Outside a swarm, handing work on puts nothing on a board.
	h.mock.state.scripts.plain = [{ tools: [call("delegate", { agent: "helper", task: "again @@REF:rate@@" })] }, { text: "ok" }];
	await h.pine.agents.run({ agent: "main", session: "other", prompt: "do @@REF:plain@@", ...owner });
	assert.equal(h.pine.agents.boards.find("local", "main", "other", ""), undefined);
	await h.close();
});

test("swarm: only the owner starts one, through the control API; it is paused, resumed and cleared there, and goes with its conversation", async () => {
	const h = await harness({ pine: { http: { port: 0 }, limits: { maxConcurrentRuns: 4 } }, agents: { main: {}, solo: { agent: { subagents: { enabled: false } } } } });
	const { swarms } = h.pine.agents;
	h.mock.state.scripts.lead = [{ delayMs: 20_000, text: "never" }];
	// No tool reaches it: nothing an agent is declared starts or changes a swarm.
	await h.pine.agents.run({ agent: "main", session: "look", prompt: "hello", ...owner });
	assert.deepEqual(h.toolsOffered(h.mock.state.requests.at(-1)).filter((t: string) => /swarm/i.test(t)), []);
	// What is refused: a conversation of outside content, one that does not stay, an agent without sub-agents, no job, a conversation with a goal.
	assert.throws(() => swarms.set("main", "inbox~u", "x"), /holds what came from outside/);
	assert.throws(() => swarms.set("main", "new", "x"), /needs a conversation that stays/);
	assert.throws(() => swarms.set("solo", "main", "x"), /has no sub-agents/);
	assert.throws(() => swarms.set("main", "main", "  "), /needs a job/);
	assert.throws(() => swarms.set("main", "main", "x".repeat(4001)), /at most 4000 characters/);
	assert.equal(swarms.get("main", "inbox~u"), undefined);

	const base = `http://127.0.0.1:${h.pine.http!.port}`;
	const token = h.pine.token;
	const api = async (method: string, path: string, body?: unknown) => {
		const res = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
		return { status: res.status, body: (await res.json()) as any };
	};
	assert.deepEqual((await api("GET", "/agents/main/swarm?session=job")).body, {});
	const started = await api("POST", "/agents/main/swarm", { session: "job", objective: "the job @@REF:lead@@" });
	assert.deepEqual([started.status, started.body.swarm.status, started.body.swarm.round], [200, "active", 1]);
	assert.equal((await api("GET", "/agents/main/swarm?session=job")).body.swarm.objective, "the job @@REF:lead@@");
	// The lead is told the job in pine's frame; read back, the owner's message is the job as they wrote it.
	const first = (await api("GET", "/tasks?agent=main&session=job")).body.find((t: any) => t.kind === "prompt" && t.parent === undefined);
	assert.deepEqual([first.prompt, first.meta.body], [startPrompt("the job @@REF:lead@@"), "the job @@REF:lead@@"]);
	assert.equal((await api("POST", "/agents/main/swarm", { session: "job", action: "nonsense" })).status, 400);
	assert.equal((await api("POST", "/agents/main/swarm", { session: "job" })).status, 400);
	assert.equal((await api("POST", "/agents/nobody/swarm", { session: "job", objective: "x" })).status, 404);
	assert.equal((await fetch(`${base}/agents/main/swarm`, { method: "POST", body: "{}" })).status, 401);
	// Paused: the round that runs is the owner's to stop; no further one starts. Stopped: the swarm waits, like a goal.
	const paused = await api("POST", "/agents/main/swarm", { session: "job", action: "pause" });
	assert.deepEqual([paused.body.swarm.status, paused.body.swarm.note], ["paused", "paused by you. /swarm resume goes on"]);
	const running = h.pine.tasks.list({ agent: "main", session: "job", limit: 10 }).find((t) => t.status === "running")!;
	h.pine.agents.cancel(running.id);
	await h.pine.agents.wait(running.id);
	assert.equal(swarms.get("main", "job")!.status, "paused");
	assert.equal((await api("POST", "/agents/main/swarm", { session: "job", action: "clear" })).body.cleared, true);
	assert.equal(swarms.get("main", "job"), undefined);
	assert.equal((await api("POST", "/agents/main/swarm", { session: "job", action: "clear" })).body.cleared, false);

	// A swarm that is at work when pine stops waits for the owner's word after the restart; a conversation that is reset loses it.
	swarms.set("main", "keep", "the job @@REF:lead@@");
	await until(() => h.pine.tasks.list({ agent: "main", session: "keep", limit: 10 }).some((t) => t.status === "running"), 5000, "the lead to start");
	await h.restart();
	assert.deepEqual([h.pine.agents.swarms.get("main", "keep")!.status, h.pine.agents.swarms.get("main", "keep")!.note], ["paused", "paused: pine was stopped while it was working. /swarm resume goes on"]);
	await h.pine.agents.resetSession("main", "keep");
	assert.equal(h.pine.agents.swarms.get("main", "keep"), undefined);
	await h.close();
});

test("swarm: /swarm in the terminal UI starts one, shows what pine does about it, and pauses, resumes and clears it", async () => {
	const h = await harness({ pine: { main: "main", http: { port: 0 }, limits: { maxConcurrentRuns: 4 } }, agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	// Round 1 posts a task and ends; round 2 has it done and answers; then pine has that answer checked.
	// The lead's first round and the check each answer once the screen has shown them at work: a fixed time
	// can be over before the screen is drawn on a slow machine.
	const shown = { working: false, checking: false };
	Object.defineProperty(h.mock.state.scripts, "lead", {
		get: () => {
			const messages = h.mock.state.requests.at(-1)?.body.messages ?? [];
			if (/Check the answer below before the one who asked/.test(rawTextOf([...messages].reverse().find((m: any) => m.role === "user")?.content ?? ""))) return [{ until: () => shown.checking, text: "PASS" }];
			const round = swarmOf(h)?.round ?? 1;
			return round === 1 ? [{ tools: [call("board_post", { type: "task", text: "piece @@REF:one@@" })] }, { until: () => shown.working, text: "POSTED-IT" }] : [{ tools: [call("subagent", { pool: true })] }, { text: "ALL-SHELVES-SORTED" }];
		},
	});
	h.mock.state.scripts.one = [{ delayMs: 300, text: "ONE-DONE" }];
	const client = new Client(`http://127.0.0.1:${h.pine.http!.port}`, h.pine.token);
	const term = new FakeTerminal(130, 40);
	const app = new PineTui({ client, terminal: term, mode: "test" });
	apps.push(app);
	await app.start();
	const text = () => app.screen().join("\n");
	const sees = (what: string | RegExp, ms = 6000) => until(() => (typeof what === "string" ? text().includes(what) : what.test(text())), ms, `the screen to show ${what}\n--- screen ---\n${text()}`);
	const send = async (line: string) => {
		term.type(line);
		term.type([KEY.enter]);
		await sleep(15);
	};
	await send("/swarm");
	await sees("this conversation has no swarm");
	await send("/swarm tidy the archive @@REF:lead@@");
	await sees("swarm started: main leads it");
	await sees(/swarm · round 1 of 8 · (working|thinking)/);
	shown.working = true;
	await sees("swarm 1 task is not done: round 2 of 8 starts");
	await sees("ALL-SHELVES-SORTED");
	await sees("swarm the answer is being checked by a sub-agent that did none of the work");
	await sees(/swarm · round 2 of 8 · checking the answer/);
	shown.checking = true;
	await sees("swarm done after 2 rounds: 1 task, and the answer was checked");
	// The job was typed here, so it is shown once and as the owner's; what pine told the lead in a round is not shown as a message.
	assert.ok(!text().includes("[elsewhere]") && !text().includes("[notify]") && !text().includes("the swarm is not finished") && !text().includes("your owner started a swarm") && !text().includes("Check the answer below"), text());
	// Opened again, the conversation is read from pine's history: the owner's message is the job alone.
	const again = new PineTui({ client, terminal: new FakeTerminal(130, 60) });
	apps.push(again);
	await again.start();
	await until(() => again.screen().join("\n").includes("ALL-SHELVES-SORTED"), 5000, "the history to be shown");
	const restored = again.screen().join("\n");
	assert.ok(restored.includes("tidy the archive @@REF:lead@@") && !restored.includes("your owner started a swarm"), restored);
	await again.stop();
	await send("/swarm pause");
	await sees("the swarm is not at work");
	await send("/swarm clear");
	await sees("swarm cleared");
	assert.equal(swarmOf(h), undefined);
	await h.close();
});
