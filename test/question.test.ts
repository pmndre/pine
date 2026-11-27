import assert from "node:assert/strict";
import { test } from "node:test";
import { harness, mockMsg, until, type Harness } from "./support/harness.ts";
import { picked } from "../src/tools.ts";

const owner = { trust: "owner" as const };
const call = (name: string, args: any) => ({ name, args });

/** Answers each question as `answer` says, and records what was asked. */
function answering(h: Harness, answer: (req: any) => { allow: boolean; values?: Record<string, string> }) {
	const asked: any[] = [];
	h.pine.bus.subscribe("approval/requested", (e: any) => {
		asked.push(e.payload);
		const a = answer(e.payload);
		h.pine.approvals.decide(e.payload.id, a.allow, "test", false, a.values);
	});
	return asked;
}

const ask = (h: Harness, args: any) => h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("question", args)] }]), ...owner });

test("question: a header, options with descriptions and a multiple answer reach the owner's request", async () => {
	const h = await harness({ agents: { main: {} } });
	const asked = answering(h, () => ({ allow: true, values: { answer: "Fast" } }));
	await ask(h, {
		question: "How should it run?",
		header: "A very long header",
		options: [{ label: "Fast", description: "Done in a minute" }, { label: "Careful" }],
		multiSelect: false,
	});
	assert.equal(asked.length, 1);
	assert.equal(asked[0].tool, "question");
	assert.equal(asked[0].header, "A very long");
	assert.deepEqual(asked[0].options, [{ label: "Fast", description: "Done in a minute" }, { label: "Careful" }]);
	assert.equal(asked[0].multiSelect, undefined);
	assert.match(h.toolResults().at(-1)!, /^Your owner answered: Fast$/);
	await h.close();
});

test("question: the old choices become options without descriptions", async () => {
	const h = await harness({ agents: { main: {} } });
	const asked = answering(h, () => ({ allow: true, values: { answer: "blue" } }));
	await ask(h, { question: "Which color?", choices: ["green", "blue"] });
	assert.deepEqual(asked[0].options, [{ label: "green" }, { label: "blue" }]);
	// What other UIs read of a question (Telegram's buttons, a source's choose) is still there.
	assert.deepEqual(asked[0].choices, ["green", "blue"]);
	assert.match(h.toolResults().at(-1)!, /Your owner answered: blue/);
	await h.close();
});

test("question: a multiple answer given by the options' numbers reaches the agent as their labels joined by commas", async () => {
	const h = await harness({ agents: { main: {} } });
	const asked = answering(h, () => ({ allow: true, values: { answer: "3, 1" } }));
	await ask(h, { question: "What do you want set up?", multiSelect: true, options: [{ label: "The mode" }, { label: "A folder" }, { label: "Telegram" }] });
	assert.equal(asked[0].multiSelect, true);
	assert.match(h.toolResults().at(-1)!, /^Your owner answered: Telegram, The mode$/);
	await h.close();
});

test("question: a single answer given by its number is that option's label; words are passed on as they are", async () => {
	const h = await harness({ agents: { main: {} } });
	let reply = "2";
	answering(h, () => ({ allow: true, values: { answer: reply } }));
	await ask(h, { question: "Which way?", options: [{ label: "Left" }, { label: "Right" }] });
	assert.match(h.toolResults().at(-1)!, /^Your owner answered: Right$/);
	reply = "only for the first file";
	await ask(h, { question: "Which way?", options: [{ label: "Left" }, { label: "Right" }] });
	assert.match(h.toolResults().at(-1)!, /^Your owner answered in their own words: only for the first file\n/);
	await h.close();
});

test("question: a sub-agent is told to assume and go on, whatever the shape", async () => {
	const h = await harness({ agents: { main: {} } });
	const asked = answering(h, () => ({ allow: true, values: { answer: "x" } }));
	h.mock.state.scripts.sub = [{ tools: [call("question", { question: "Which one?", options: [{ label: "A", description: "the first" }, { label: "B" }], multiSelect: true })] }];
	await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("subagent", { tasks: ["@@REF:sub@@"] })] }]), ...owner });
	const told = h.mock.state.requests.filter((q: any) => JSON.stringify(q.body.messages).includes("Which one?")).at(-1);
	assert.match(h.toolResults(told)[0], /You are a sub-agent: your owner is not asked on your behalf\. Go on with the most reasonable assumption/);
	assert.equal(asked.length, 0);
	await h.close();
});

test("question: words that pick no option are told as the owner's own words, with what to do if they ask something back", async () => {
	const h = await harness({ agents: { main: {} } });
	let reply = "what is the difference?";
	answering(h, () => ({ allow: true, values: { answer: reply } }));
	await ask(h, { question: "Which way?", options: [{ label: "Left" }, { label: "Right" }] });
	const told = h.toolResults().at(-1)!;
	assert.match(told, /^Your owner answered in their own words: what is the difference\?\n/);
	assert.match(told, /If this does not answer your question, respond to what they said\. You may ask again\./);
	// A question with nothing to pick is always answered in the owner's own words.
	reply = "the blue one";
	await ask(h, { question: "Which file?" });
	assert.match(h.toolResults().at(-1)!, /^Your owner answered in their own words: the blue one\n/);
	// An option's label, typed as it is or picked, is a plain answer.
	reply = "right";
	await ask(h, { question: "Which way?", options: [{ label: "Left" }, { label: "Right" }] });
	assert.match(h.toolResults().at(-1)!, /^Your owner answered: Right$/);
	await h.close();
});

test("question: an answer that is an option's label is that option, also when the labels are numbers", () => {
	// "2" is the label of the first option here, not the number of the second.
	assert.deepEqual(picked("2", [{ label: "2" }, { label: "4" }, { label: "8" }], false), { text: "2", words: false });
	// Where no label matches, a number still picks by its place, also an option whose label has a comma.
	assert.deepEqual(picked("1", [{ label: "Yes, with tests" }, { label: "No" }], true), { text: "Yes, with tests", words: false });
	assert.deepEqual(picked("2,1", [{ label: "Yes, with tests" }, { label: "No" }], true), { text: "No, Yes, with tests", words: false });
	// Labels joined by ", " as the page sends them, a comma inside a label included.
	assert.deepEqual(picked("Yes, with tests, No", [{ label: "Yes, with tests" }, { label: "No" }], true), { text: "Yes, with tests, No", words: false });
	assert.deepEqual(picked("Yes, with tests", [{ label: "Yes, with tests" }, { label: "No" }], true), { text: "Yes, with tests", words: false });
	assert.deepEqual(picked("no, yes, with tests", [{ label: "Yes, with tests" }, { label: "No" }], true), { text: "No, Yes, with tests", words: false });
});

test("question: an agent's question waits past the approval timeout, which still ends an ordinary approval, and ends with its run", async () => {
	const h = await harness({ pine: { security: { approvalTimeout: "150ms" } }, agents: { main: { agent: { approve: ["bash"] } } } });
	const asked: any[] = [];
	h.pine.bus.subscribe("approval/requested", (e: any) => void asked.push(e.payload));

	const running = ask(h, { question: "Which way?", options: [{ label: "Left" }, { label: "Right" }] });
	await until(() => asked.length === 1, 5000, "the question");
	assert.equal(asked[0].expires, undefined, "a question shows no deadline");
	await new Promise((r) => setTimeout(r, 400));
	assert.deepEqual(h.pine.approvals.pending().map((a) => a.id), [asked[0].id], "the question is still open after the timeout");
	assert.equal(h.pine.approvals.decide(asked[0].id, true, "test", false, { answer: "Right" }), true);
	await running;
	assert.match(h.toolResults().at(-1)!, /^Your owner answered: Right$/);

	// An approval of an action counts as no after the same timeout.
	const denied = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("bash", { command: "echo hi" })] }]), ...owner });
	assert.equal(typeof asked[1].expires, "number");
	assert.match(denied.text, /not approved \(timeout\)/);

	// A stopped run takes its question with it.
	const stopped = ask(h, { question: "Which one?" });
	await until(() => asked.length === 3, 5000, "the second question");
	assert.equal(h.pine.agents.cancel(asked[2].task), true);
	await stopped;
	await until(() => h.pine.approvals.pending().length === 0, 5000, "the question closed by the stop");
	await h.close();
});
