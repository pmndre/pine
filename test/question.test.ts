import assert from "node:assert/strict";
import { test } from "node:test";
import { harness, mockMsg, textOf, until, type Harness } from "./support/harness.ts";

const owner = { trust: "owner" as const };
const call = (name: string, args: any) => ({ name, args });
const ASKED = "Asked. Your owner answers in a message, maybe about other things too.";

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
	assert.equal(h.toolResults().at(-1), ASKED);
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
	assert.deepEqual(h.pine.tasks.get(run.id)!.meta.asked, want);
	const history = (await api(h)("GET", "/tasks?agent=main&session=main")).body;
	assert.deepEqual(history.find((t: any) => t.id === run.id).meta.asked, want);
	const starts = tools.filter((e) => e.phase === "start" && e.tool === "question");
	assert.deepEqual(starts.map((e) => e.asked), [{ ...want[0], at: 0 }, { ...want[1], at: 1 }]);
	assert.deepEqual(
		asked.map((e) => [e.agent, e.session, e.task, e.at, e.question, e.outside]),
		[
			["main", "main", run.id, 0, "Which database?", false],
			["main", "main", run.id, 1, "Which colors?", false],
		],
	);
	assert.deepEqual(asked[1].options, want[1].options);
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
