import assert from "node:assert/strict";
import { test } from "node:test";
import { askedAs } from "../src/tools.ts";
import { harness, mockMsg, textOf, until, type Harness } from "./support/harness.ts";

const owner = { trust: "owner" as const };
const call = (name: string, args: any) => ({ name, args });

/** The control API, as a UI calls it. */
function api(h: Harness) {
	const base = `http://127.0.0.1:${h.pine.http!.port}`;
	return async (method: string, path: string, body?: unknown) => {
		const res = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${h.pine.token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
		return { status: res.status, body: (await res.json()) as any };
	};
}

/** What was published on a topic, from now on. */
function heard(h: Harness, topic: string) {
	const got: any[] = [];
	h.pine.bus.subscribe(topic, (e: any) => void got.push(e.payload));
	return got;
}

test("question: the tool returns at once and asks for no approval; the run ends, and the owner's next message starts a turn whose prompt is that message", async () => {
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: {} } });
	const approvals = heard(h, "approval/requested");
	const first = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("question", { question: "Which database?", options: [{ label: "sqlite" }, { label: "postgres" }] })] }, { text: "I asked which database." }]), ...owner });
	assert.equal(first.status, "done");
	assert.equal(h.toolResults().at(-1), askedAs(1));
	assert.equal(approvals.length, 0, "a question is no approval");
	assert.deepEqual(h.pine.approvals.pending(), []);
	await h.pine.agents.run({ agent: "main", prompt: "sqlite", ...owner });
	const last = h.mock.state.requests.at(-1).body.messages.at(-1);
	assert.equal(last.role, "user");
	assert.equal(textOf(last.content), "sqlite");
	await h.close();
});

test("question: the turn keeps what it asked, in call order, in its record and in the conversation's history; the tool event and question/asked carry the same", async () => {
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: {} } });
	const tools = heard(h, "agent/main/tool");
	const asked = heard(h, "question/asked");
	const run = await h.pine.agents.run({
		agent: "main",
		prompt: mockMsg([
			{
				tools: [
					call("question", { question: "Which database?", header: "A very long header", options: [{ label: "sqlite", description: "one file" }, { label: "postgres" }] }),
					call("question", { question: "Which colors?", choices: ["green", "red", "blue"], multiSelect: true }),
				],
			},
			{ text: "asked" },
		]),
		...owner,
	});
	const want = [
		{ question: "Which database?", header: "A very long", options: [{ label: "sqlite", description: "one file" }, { label: "postgres" }] },
		{ question: "Which colors?", options: [{ label: "green" }, { label: "red" }, { label: "blue" }], multiSelect: true },
	];
	// Each is kept with the time it was asked, within the turn.
	const kept = h.pine.tasks.get(run.id)!;
	assert.ok(kept.meta.asked!.every((q) => typeof q.when === "number" && q.when >= kept.started! && q.when <= kept.finished!));
	const untimed = (list: any[]) => list.map(({ when: _, ...q }) => q);
	assert.deepEqual(untimed(kept.meta.asked!), want);
	const history = (await api(h)("GET", "/tasks?agent=main&session=main")).body;
	assert.deepEqual(history.find((t: any) => t.id === run.id).meta.asked, kept.meta.asked);
	const starts = tools.filter((e) => e.phase === "start" && e.tool === "question");
	assert.deepEqual(untimed(starts.map((e) => e.asked)), [{ ...want[0], at: 0 }, { ...want[1], at: 1 }]);
	assert.deepEqual(
		asked.map((e) => [e.agent, e.session, e.task, e.at, e.question, e.outside]),
		[
			["main", "main", run.id, 0, "Which database?", false],
			["main", "main", run.id, 1, "Which colors?", false],
		],
	);
	assert.deepEqual(asked[1].options, want[1].options);
	// Each call is told its number in the turn, in call order: the number the owner's answer names it by.
	assert.deepEqual(h.toolResults(), [askedAs(1), askedAs(2)]);
	await h.close();
});

test("question: a question asked by a run that came from an event is said to come from outside", async () => {
	const h = await harness({ agents: { main: {} }, pine: { routes: [{ name: "tick", on: "tick/now", agent: "main", trust: "owner", prompt: "{{payload.text}}" }] } });
	const asked = heard(h, "question/asked");
	h.pine.bus.publish("tick/now", { text: mockMsg([{ tools: [call("question", { question: "Shall I go on?" })] }, { text: "asked" }]) }, { source: "test", trust: "owner" });
	await until(() => asked.length === 1, 5000, "the question");
	assert.equal(asked[0].outside, true);
	await h.close();
});

test("question: a sub-agent is still told to assume and go on, and asks nothing", async () => {
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: {} } });
	const asked = heard(h, "question/asked");
	h.mock.state.scripts.sub = [{ tools: [call("question", { question: "Which one?", options: [{ label: "A" }, { label: "B" }] })] }];
	await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("subagent", { tasks: ["@@REF:sub@@"] })] }]), ...owner });
	const told = h.mock.state.requests.filter((q: any) => JSON.stringify(q.body.messages).includes("Which one?")).at(-1);
	assert.match(h.toolResults(told)[0], /You are a sub-agent: your owner is not asked on your behalf\. Go on with the most reasonable assumption/);
	assert.equal(asked.length, 0);
	assert.ok(h.pine.tasks.list({ limit: 20 }).every((t) => !t.meta.asked), "nothing is recorded for a sub-agent");
	await h.close();
});

test("question: /status counts the open questions: those of a conversation's latest turn, until the owner writes again", async () => {
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: {} } });
	const status = async () => (await api(h)("GET", "/status")).body;
	assert.equal((await status()).questions, 0);
	await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("question", { question: "One?" }), call("question", { question: "Two?" })] }, { text: "asked" }]), ...owner });
	assert.equal((await status()).questions, 2);
	assert.equal((await status()).approvals, 0, "questions are not approvals");
	await h.pine.agents.run({ agent: "main", prompt: "both yes", ...owner });
	assert.equal((await status()).questions, 0);
	await h.close();
});

test("question: a message the owner steered into the work before the agent asked leaves the question open; one steered in after it closes it", async () => {
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: {} } });
	const asked = heard(h, "question/asked");
	const open = () => h.pine.agents.openQuestions("main", "main").flatMap((q) => q.asked.map((a) => a.question));
	// Before: the owner writes while the work is at the model, and the agent asks only after it.
	let steered = false;
	h.mock.state.scripts.before = [{ tools: [call("question", { question: "Which database?", options: [{ label: "sqlite" }, { label: "postgres" }] })], until: () => steered }, { text: "asked" }];
	const first = h.pine.agents.submit({ agent: "main", prompt: "@@REF:before@@", kind: "prompt", ...owner });
	await until(() => h.mock.state.requests.length >= 1, 5000, "the work to be at the model");
	assert.equal(h.pine.agents.submit({ agent: "main", prompt: "use the fastest one", kind: "prompt", whenBusy: "steer", ...owner }).meta.steered, first.id);
	steered = true;
	await h.pine.agents.wait(first.id);
	assert.deepEqual(open(), ["Which database?"], "a message that came before the question does not answer it");
	assert.equal((await api(h)("GET", "/status")).body.questions, 1);
	await h.pine.agents.run({ agent: "main", prompt: "sqlite", ...owner });
	assert.deepEqual(open(), []);
	// After: the agent asks, and the owner writes while the turn still works.
	let after = false;
	h.mock.state.scripts.after = [{ tools: [call("question", { question: "Which color?" })] }, { text: "asked", until: () => after }];
	const second = h.pine.agents.submit({ agent: "main", prompt: "@@REF:after@@", kind: "prompt", ...owner });
	await until(() => asked.some((e) => e.task === second.id), 5000, "the question");
	assert.deepEqual(open(), ["Which color?"]);
	assert.equal(h.pine.agents.submit({ agent: "main", prompt: "green", kind: "prompt", whenBusy: "steer", ...owner }).meta.steered, second.id);
	after = true;
	await h.pine.agents.wait(second.id);
	assert.deepEqual(open(), [], "a message that came after the question answers it");
	await h.close();
});

test("question: a run handed its task by another agent asks nobody: it is told to say what it needs in its answer, and nothing is recorded or published", async () => {
	const h = await harness({ agents: { main: { agent: { delegates: ["gonzo"] } }, gonzo: {} } });
	const asked = heard(h, "question/asked");
	h.mock.state.scripts.gonzo = [{ tools: [call("question", { question: "Which one?", options: [{ label: "A" }, { label: "B" }] })] }, { text: "I need to know which one." }];
	await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("delegate", { agent: "gonzo", task: "@@REF:gonzo@@" })] }, { text: "done" }]), ...owner });
	const told = h.mock.state.requests.filter((q: any) => JSON.stringify(q.body.messages).includes("Which one?")).at(-1);
	assert.match(h.toolResults(told)[0], /^Your owner is not asked from this run: nobody waits for an answer on your behalf\. .*your answer goes back to whoever handed you the task\.$/);
	assert.equal(asked.length, 0);
	assert.ok(h.pine.tasks.list({ limit: 20 }).every((t) => !t.meta.asked), "nothing is recorded for a delegated run");
	assert.deepEqual(h.pine.agents.openQuestions(), []);
	await h.close();
});

test("question: a one-off run (no conversation the owner writes in) asks nobody, and its question is neither recorded nor published", async () => {
	const h = await harness({ agents: { main: {} } });
	const asked = heard(h, "question/asked");
	const run = await h.pine.agents.run({ agent: "main", session: "new", kind: "event", prompt: mockMsg([{ tools: [call("question", { question: "Shall I go on?" })] }, { text: "went on" }]), ...owner });
	assert.match(h.pine.tasks.get(run.id)!.session, /^_/);
	assert.match(h.toolResults().at(-1) ?? "", /^Your owner is not asked from this run/);
	assert.equal(asked.length, 0);
	assert.equal(h.pine.tasks.get(run.id)!.meta.asked, undefined);
	await h.close();
});

test("question: a call that never runs (refused at the gate) records nothing, and its tool event carries no question", async () => {
	const h = await harness({ agents: { main: { agent: { approve: ["question"] } } } });
	const asked = heard(h, "question/asked");
	const tools = heard(h, "agent/main/tool");
	h.pine.bus.subscribe("approval/requested", (e: any) => void h.pine.approvals.decide(e.payload.id, false, "test"));
	const run = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("question", { question: "Which database?" })] }, { text: "not asked" }]), ...owner });
	assert.equal(asked.length, 0);
	assert.equal(h.pine.tasks.get(run.id)!.meta.asked, undefined);
	assert.deepEqual(
		tools.filter((e) => e.tool === "question").map((e) => [e.phase, "asked" in e]),
		[
			["start", false],
			["end", false],
		],
	);
	await h.close();
});
