// Quotes the owner sends with a message (src/quotes.ts): checked where they come in, read by the agent as
// markdown quotes in front of the message, kept beside it for the UIs, given back by undo and carried
// along by a branch.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fitQuotes, quoteBlock, readQuotes, type SentQuote, withQuotes } from "../src/quotes.ts";
import { harness, type Harness, mockMsg, until } from "./support/harness.ts";

/** What the model was given as the owner's last message. */
const lastSaid = (h: Harness) => {
	const m = h.mock.state.requests.at(-1).body.messages.filter((x: any) => x.role === "user").at(-1);
	return typeof m.content === "string" ? m.content : m.content.map((c: any) => c.text ?? "").join("");
};

test("quotes: what comes in is checked piece by piece", () => {
	const ok = readQuotes([
		{ text: "an answer's words", source: { task: 3, part: "answer" }, extra: "dropped" },
		{ text: "the letter's", source: "letter" },
	]);
	assert.deepEqual(ok, [
		{ text: "an answer's words", source: { task: 3, part: "answer" } },
		{ text: "the letter's", source: "letter" },
	]);
	assert.equal(typeof readQuotes("nope"), "string");
	assert.equal(typeof readQuotes([{ text: "", source: "letter" }]), "string");
	assert.equal(typeof readQuotes([{ text: "x", source: "elsewhere" }]), "string");
	assert.equal(typeof readQuotes([{ text: "x", source: { task: 0, part: "answer" } }]), "string");
	assert.equal(typeof readQuotes([{ text: "x", source: { task: 2, part: "tool" } }]), "string");
	assert.equal(typeof readQuotes([{ text: "x".repeat(10_001), source: "letter" }]), "string");
	assert.equal(typeof readQuotes(Array.from({ length: 21 }, () => ({ text: "x", source: "letter" }))), "string");
});

test("quotes: they go first as markdown quotes, and give way to the room they are given, cut where they no longer fit", () => {
	assert.equal(quoteBlock("one\n\n  two  "), "> one\n>\n>   two");
	assert.equal(withQuotes([{ text: "a" }, { text: "b\nc" }], "  why?  "), "> a\n\n> b\n> c\n\nwhy?");
	const q = (text: string): SentQuote => ({ text, source: "letter" });
	assert.deepEqual(fitQuotes([q("short"), q("also short")], 1000), [q("short"), q("also short")]);
	const fitted = fitQuotes([q("x".repeat(50)), q("y".repeat(500)), q("never")], 200);
	assert.equal(fitted.length, 2);
	assert.equal(fitted[0].text, "x".repeat(50));
	assert.ok(fitted[1].text.endsWith("…") && fitted[1].text.startsWith("yyy"), fitted[1].text);
	assert.ok(withQuotes(fitted, "").length <= 200, `${withQuotes(fitted, "").length}`);
	assert.deepEqual(fitQuotes([q("too long for nothing")], 0), []);
});

test("quotes: the control API takes them from the owner, the agent reads them before the message, the task keeps them, and undo gives them back", async () => {
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: {} } });
	const headers = { authorization: `Bearer ${h.pine.token}`, "content-type": "application/json" };
	const post = (route: string, body: unknown) => fetch(`http://127.0.0.1:${h.pine.http!.port}${route}`, { method: "POST", headers, body: JSON.stringify(body) });
	/** A message given over the control API, once its task is done. */
	const send = async (body: Record<string, unknown>) => {
		const { task } = (await (await post("/agents/main/prompt", { ...body, wait: false })).json()) as { task: number };
		await until(() => ["done", "failed"].includes(h.pine.tasks.get(task)?.status ?? ""), 5000, "the task to end");
		return h.pine.tasks.get(task)!;
	};
	const first = await h.pine.agents.run({ agent: "main", session: "s", trust: "owner", prompt: `start ${mockMsg([{ text: "The cache held an old copy of the lockfile." }])}` });
	const quotes = [{ text: "an old copy of the lockfile", source: { task: first.id, part: "answer" } }];

	// Bad quotes are refused with what is wrong; a message is quotes, text, or both.
	const bad = await post("/agents/main/prompt", { prompt: "why?", session: "s", quotes: [{ text: "x", source: "nowhere" }] });
	assert.equal(bad.status, 400);
	assert.match(await bad.text(), /source/);
	assert.equal((await post("/agents/main/prompt", { prompt: "", session: "s" })).status, 400);

	const task = await send({ prompt: `why is that? ${mockMsg([{ text: "Because of the cache." }])}`, session: "s", quotes });
	assert.ok(lastSaid(h).includes("> an old copy of the lockfile\n\nwhy is that? "), lastSaid(h));
	assert.ok(task.prompt.startsWith("> an old copy of the lockfile\n\nwhy is that? "), task.prompt);
	assert.deepEqual(task.meta.quotes, quotes);
	assert.ok(task.meta.body!.startsWith("why is that? "), String(task.meta.body));

	// Quotes alone are a message too.
	const alone = await send({ prompt: "", session: "s", quotes: [{ text: `Because of the cache. ${mockMsg([{ text: "ok" }])}`, source: { task: task.id, part: "answer" } }] });
	assert.equal(alone.meta.body, "");

	// Taken back: the quotes and the text after them come back apart, as the input had them.
	const back = (await (await post("/agents/main/undo", { session: "s" })).json()) as { quotes?: SentQuote[]; body?: string };
	assert.equal(back.body, "");
	assert.equal(back.quotes?.length, 1);
	const back2 = (await (await post("/agents/main/undo", { session: "s" })).json()) as { quotes?: SentQuote[]; body?: string };
	assert.deepEqual(back2.quotes, quotes);
	assert.ok(back2.body!.startsWith("why is that? "), String(back2.body));
	await h.close();
});

test("quotes: a branch carries them with the numbers its copies got, and only the owner's messages have any", async () => {
	const h = await harness({ agents: { main: {} } });
	const first = await h.pine.agents.run({ agent: "main", session: "s", trust: "owner", prompt: `start ${mockMsg([{ text: "ANSWER-ONE" }])}` });
	const quoted = await h.pine.agents.run({ agent: "main", session: "s", trust: "owner", prompt: `and? ${mockMsg([{ text: "ANSWER-TWO" }])}`, quotes: [{ text: "ANSWER-ONE", source: { task: first.id, part: "answer" } }, { text: "hello", source: "letter" }] });
	const r = await h.pine.agents.branchSession("main", "s");
	const copies = h.pine.tasks.list({ agent: "main", session: r.session });
	const copyOfFirst = copies.find((t) => t.prompt.startsWith("start"))!;
	const copyOfQuoted = copies.find((t) => t.prompt.startsWith("> ANSWER-ONE"))!;
	assert.notEqual(copyOfFirst.id, first.id);
	assert.deepEqual(copyOfQuoted.meta.quotes, [
		{ text: "ANSWER-ONE", source: { task: copyOfFirst.id, part: "answer" } },
		{ text: "hello", source: "letter" },
	]);
	assert.deepEqual(h.pine.tasks.get(quoted.id)!.meta.quotes?.[0].source, { task: first.id, part: "answer" }, "the original keeps its own");

	// From outside, quotes are not taken: what an event says stays its own words.
	const outside = await h.pine.agents.run({ agent: "main", session: "s", trust: "untrusted", prompt: `outside ${mockMsg([{ text: "ok" }])}`, quotes: [{ text: "FORGED", source: "letter" }] });
	assert.equal(h.pine.tasks.get(outside.id)!.meta.quotes, undefined);
	assert.ok(!h.pine.tasks.get(outside.id)!.prompt.includes("FORGED"));
	await h.close();
});

test("quotes: on a small limit they are cut, and what the owner typed is never cut to make room for them", async () => {
	const h = await harness({ pine: { limits: { maxEventChars: 1000 } }, agents: { main: {} } });
	const big = Array.from({ length: 3 }, (_, i) => ({ text: `QUOTE-${i} ${"w".repeat(9000)}`, source: "letter" as const }));
	const t = await h.pine.agents.run({ agent: "main", session: "s", trust: "owner", prompt: `KEEP-THIS-TEXT ${mockMsg([{ text: "ok" }])}`, quotes: big });
	const task = h.pine.tasks.get(t.id)!;
	assert.ok(task.prompt.length <= 10_000 + 40, `${task.prompt.length}`);
	assert.ok(task.prompt.includes("KEEP-THIS-TEXT"), "the typed text is all there");
	assert.ok(lastSaid(h).includes("KEEP-THIS-TEXT"));
	assert.ok(task.meta.body!.startsWith("KEEP-THIS-TEXT"), String(task.meta.body));
	// The quotes kept are the ones the agent read, so a UI shows what was sent.
	assert.ok(task.meta.quotes!.length >= 1 && task.meta.quotes!.length < 3);
	assert.ok(task.meta.quotes!.at(-1)!.text.endsWith("…"));
	assert.ok(task.prompt.startsWith(withQuotes(task.meta.quotes!, "")));
	await h.close();
});
