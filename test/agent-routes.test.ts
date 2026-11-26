import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { eraseAgent, renameAgent } from "../src/admin.ts";
import { deciderAt, decisionServer } from "./support/decision-server.ts";
import { harness, mockMsg, until } from "./support/harness.ts";

/** A stand-in chat of the agent's own that can answer, as Telegram can: what is sent through it is noted. */
const TALKER = `export const type = {
	summary: "a stand-in chat that can answer",
	sends: 'a message: {"text": "..."}',
	options: { type: "object", properties: {}, additionalProperties: false },
};
export default function (source) {
	source.onSend((m) => {
		(globalThis.said ??= []).push(m.text);
		return "sent";
	});
}
`;

const EIGHT_BALL = { reply: { type: "choice", question: "Which answer of a Magic 8 Ball fits the question?", options: { "It is certain": "a clear yes", "Reply hazy, try again": "cannot tell", "My reply is no": "a clear no" } } };

test("agent routes: an agent wires its own chat to a decision model and answers through it, with no turn of its own and nobody else's routes", async (t) => {
	const server = await decisionServer(t);
	const d = deciderAt(server.url);
	const h = await harness({
		pine: { main: "main", decisions: d.decisions, sourceTypes: { talker: "./sources/talker.ts" }, routes: [{ name: "mains", on: "test/x", set: { "seen/x": "yes" } }] },
		files: { ".env": d.env, "sources/talker.ts": TALKER },
		agents: { main: {}, eightball: { agent: { sources: { ball: { type: "talker" } } } } },
	});
	(globalThis as any).said = [];
	const asked: any[] = [];
	h.pine.bus.subscribe("approval/requested", (e) => {
		asked.push(e.payload);
		h.pine.approvals.decide((e.payload as any).id, true, "test");
	});
	const call = (name: string, args: Record<string, unknown>) => ({ name, args });
	const route = { name: "eightball", on: "source/ball@eightball/message", ask_model: "decider", ask_data: "{{payload.text}}", ask_questions: JSON.stringify(EIGHT_BALL), publish_topic: "out/source/ball@eightball", publish_payload: JSON.stringify({ text: "{{answers.reply.choice}}" }) };
	await h.pine.agents.run({
		agent: "eightball",
		prompt: mockMsg([
			{
				tools: [
					call("add_route", route),
					call("add_route", { ...route, name: "spy", on: "source/#" }),
					call("add_route", { ...route, name: "wake", publish_topic: undefined, publish_payload: undefined, agent: "main" }),
					call("add_route", { ...route, name: "trusted", trust: "owner" }),
					call("add_route", { ...route, name: "elsewhere", publish_topic: "out/source/telegram" }),
					call("add_route", { ...route, name: "state", publish_topic: undefined, publish_payload: undefined, set: JSON.stringify({ "house/mode": "{{answers.reply.choice}}" }) }),
					call("add_route", { name: "script", on: "source/ball@eightball/message", run_command: "true", run_agent: "main" }),
					call("remove_route", { name: "mains" }),
					call("add_route", { ...route, name: "own-topic", publish_topic: "agent/eightball/said" }),
				],
			},
		]),
		trust: "owner",
	});
	const [made, spy, wake, trusted, elsewhere, state, script, removed, ownTopic] = h.toolResults().slice(-9);
	assert.match(made, /^Your owner confirmed it\. The route "eightball" is added/);
	assert.match(spy, /"source\/#" is not an event of yours\. A route of yours listens to your own sources \(source\/<name>@eightball\/\.\.\., the sources tool lists them: ball@eightball\)/);
	assert.match(wake, /wakes only you \(eightball\)/);
	assert.match(trusted, /takes no "trust"/);
	assert.match(elsewhere, /publishes only through your own sources/);
	assert.match(state, /"house\/mode" is not your shared state/);
	assert.match(script, /runs its command only in your own sandbox/);
	assert.match(removed, /there is no route called "mains"/, "a route of the main agent's is not the agent's to remove");
	assert.match(ownTopic, /publishes only through your own sources \(out\/source\/<name>@eightball[^)]*\)\. To keep what it found, write your shared state/, "agent/ is pine's own, also under the agent's own id");
	assert.equal(asked.length, 1, "you are asked about the one that is the agent's to make");
	assert.match(asked[0].summary, /add the route "eightball"\non source\/ball@eightball\/message\na route of eightball's\nask the decision model decider/);
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(h.home, "pine.json"), "utf8")).routes.find((r: any) => r.name === "eightball").of, "eightball");

	// A question in the chat: the decision model picks one of the answers, and it goes back through the chat.
	const before = h.mock.state.requests.length;
	h.pine.bus.publish("source/ball@eightball/message", { text: "Will it rain tomorrow?" }, { source: "source:ball@eightball" });
	// A route that listens to a source keeps it running, as a subscription does.
	await until(() => (globalThis as any).said.length === 1);
	assert.deepEqual((globalThis as any).said, ["It is certain"], "an option may be a phrase, and it is the answer as it is");
	assert.equal(server.asked[0].state, "Will it rain tomorrow?");
	assert.equal(h.mock.state.requests.length, before, "no agent's turn for it");

	// The agent sees its own routes, and they go with it.
	await h.pine.agents.run({ agent: "eightball", prompt: mockMsg([{ tools: [call("routes", {})] }]), trust: "owner" });
	assert.match(h.toolResults().at(-1)!, /^1 route of yours\.\n- eightball: on source\/ball@eightball\/message/);
	// It uses the decision models pine has; adding and removing one is the main agent's.
	const offered = h.toolsOffered(h.mock.state.requests.at(-1));
	assert.ok(offered.includes("add_route") && !offered.includes("add_decision_model") && !offered.includes("remove_decision_model"), offered.join(", "));
	const store = { kv: h.pine.agents.kv, tasks: h.pine.tasks };
	renameAgent(h.pine.cfg, store, "eightball", "oracle");
	const renamed = JSON.parse(fs.readFileSync(path.join(h.home, "pine.json"), "utf8")).routes.find((r: any) => r.name === "eightball");
	assert.deepEqual([renamed.of, renamed.on, renamed.publish.topic], ["oracle", "source/ball@oracle/message", "out/source/ball@oracle"]);
	eraseAgent(h.pine.cfg, store, "oracle");
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(h.home, "pine.json"), "utf8")).routes.map((r: any) => r.name), ["mains"], "a removed agent's routes go with it");
	await h.close();
});
