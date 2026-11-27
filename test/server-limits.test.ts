import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { checkModelLimit } from "../src/admin.ts";
import { loadConfig, MAX_MODEL_RUNS } from "../src/config.ts";
import { removeModelServer } from "../src/models.ts";
import { harness, mockMsg, until } from "./support/harness.ts";

const owner = { trust: "owner" as const };
const call = (name: string, args: any) => ({ name, args });

/** The most runs that were at the model at one time, from what pine says started and ended. */
function watch(h: Awaited<ReturnType<typeof harness>>) {
	let now = 0;
	let most = 0;
	h.pine.bus.subscribe("agent/+/started", () => void (most = Math.max(most, ++now)));
	h.pine.bus.subscribe("agent/+/done", () => void now--);
	h.pine.bus.subscribe("agent/+/failed", () => void now--);
	return () => most;
}

test("limits: a model with a number of runs of its own takes that many at a time, in a queue of its own; the others wait their turn", async () => {
	// Three messages at once, each at the model until all three are: with pine's own limit they run side by side.
	// (Held by what happened, not for a time: on a busy machine one could be done before the last has started.
	// Where they cannot all be at the model, the model answers after ten seconds and the count says so.)
	const free = await harness({ pine: { limits: { maxConcurrentRuns: 8 } }, agents: { main: {} } });
	const side = watch(free);
	free.mock.state.scripts.slow = [{ until: () => side() === 3, text: "done" }];
	await Promise.all(["a", "b", "c"].map((session) => free.pine.agents.run({ agent: "main", session, prompt: "go @@REF:slow@@", ...owner })));
	assert.equal(side(), 3);
	assert.equal(free.pine.agents.limiterOf("mock/m"), free.pine.agents.limiter, "without a number of its own a model is in the queue for all");
	await free.close();

	// The same with the model held to one: one after the other, and pine says how its queue stands.
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 8, models: { "mock/m": 1 } } }, agents: { main: {} } });
	// The first one stays at the model until the queue has been looked at.
	const most = watch(h);
	let looked = false;
	h.mock.state.scripts.slow = [{ until: () => looked, text: "done" }];
	const all = Promise.all(["a", "b", "c"].map((session) => h.pine.agents.run({ agent: "main", session, prompt: "go @@REF:slow@@", ...owner })));
	await until(() => h.pine.agents.status().models["mock/m"]?.waiting === 2, 5000, "two runs to wait in the model's queue");
	assert.deepEqual(h.pine.agents.status().models, { "mock/m": { active: 1, waiting: 2, max: 1 } });
	looked = true;
	assert.deepEqual((await all).map((r) => r.status), ["done", "done", "done"]);
	assert.equal(most(), 1);
	assert.notEqual(h.pine.agents.limiterOf("mock/m"), h.pine.agents.limiter);
	assert.equal(h.pine.agents.limiterOf("elsewhere/m"), h.pine.agents.limiter, "the model of that name on another server is not held to it");
	assert.equal(h.pine.agents.limiterOf("mock/other"), h.pine.agents.limiter, "and neither is another model of the same server: there is no number for a whole server");
	assert.equal(h.pine.agents.limiter.stats.active, 0, "and the queue for all was not used");

	// An agent that hands work to sub-agents gives its place up while it waits, so a model that takes one run at a
	// time still gets a job with sub-agents done: they run one after the other.
	h.mock.state.scripts.piece = [{ delayMs: 60, text: "piece done" }];
	const again = watch(h);
	const r = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { tasks: ["one @@REF:piece@@", "two @@REF:piece@@", "three @@REF:piece@@"] })] }, { text: "ALL-THREE-IN" }]), ...owner });
	assert.deepEqual([r.status, r.text], ["done", "ALL-THREE-IN"]);
	assert.ok(again() >= 2, "the conversation and a sub-agent are both under way, and only one of them is at the model");
	assert.deepEqual(h.pine.agents.status().models, { "mock/m": { active: 0, waiting: 0, max: 1 } });
	await h.close();
});

test("limits: the owner sets a model's number of runs through the control API, it holds from the next run on, and it goes when set to nothing", async () => {
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: {} } });
	const base = `http://127.0.0.1:${h.pine.http!.port}`;
	const api = async (method: string, at: string, body?: unknown) => {
		const res = await fetch(`${base}${at}`, { method, headers: { authorization: `Bearer ${h.pine.token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
		return { status: res.status, body: (await res.json()) as any };
	};
	const file = () => JSON.parse(fs.readFileSync(path.join(h.home, "pine.json"), "utf8"));
	const listed = async () => (await api("GET", "/models/servers")).body.find((x: any) => x.name === "mock");
	const of = async () => (await listed()).models.find((m: any) => m.id === "m").limit;
	assert.deepEqual([await of(), (await listed()).limit, (await listed()).runs], [undefined, undefined, 8]);
	// Set: written into pine.json, said with the model, and in force.
	assert.deepEqual((await api("POST", "/models/servers/limit", { name: "mock", model: "m", limit: 2 })).body, { name: "mock", model: "m", limit: 2, runs: 8 });
	assert.deepEqual([file().limits.models, await of(), h.pine.agents.limiterOf("mock/m").max], [{ "mock/m": 2 }, 2, 2]);
	assert.deepEqual(loadConfig(h.home).limits.models, { "mock/m": 2 });
	// Changed, and it holds without a restart.
	await api("POST", "/models/servers/limit", { name: "mock", model: "m", limit: 1 });
	assert.equal(h.pine.agents.limiterOf("mock/m").max, 1);
	// What is no number that can be one, a server there is none of, a model the server has not, and a server without a model are refused, and nothing is written.
	for (const limit of [0, -1, 1.5, MAX_MODEL_RUNS + 1, "many"]) assert.equal((await api("POST", "/models/servers/limit", { name: "mock", model: "m", limit })).status, 400, String(limit));
	const none = await api("POST", "/models/servers/limit", { name: "nowhere", model: "m", limit: 2 });
	assert.deepEqual([none.status, /there is no model server or provider "nowhere"/.test(none.body.error)], [400, true]);
	assert.equal((await api("POST", "/models/servers/limit", { name: "../pine", model: "m", limit: 2 })).status, 400);
	assert.equal((await api("POST", "/models/servers/limit", { name: "mock", model: "nothing", limit: 2 })).status, 400);
	const whole = await api("POST", "/models/servers/limit", { name: "mock", limit: 2 });
	assert.deepEqual([whole.status, /"mock" has no model ""/.test(whole.body.error)], [400, true]);
	assert.deepEqual(file().limits, { models: { "mock/m": 1 } });
	assert.equal((await fetch(`${base}/models/servers/limit`, { method: "POST", body: "{}" })).status, 401);
	// Nothing: the limit is off, the key is gone from the file, and the model is back in the queue for all.
	assert.deepEqual((await api("POST", "/models/servers/limit", { name: "mock", model: "m", limit: null })).body, { name: "mock", model: "m", runs: 8 });
	assert.deepEqual([file().limits?.models, h.pine.agents.limiterOf("mock/m") === h.pine.agents.limiter], [undefined, true]);
	await h.close();

	// The check by itself, as a tool of the main agent's would use it: only a model the server has.
	assert.deepEqual(checkModelLimit(["local/qwen3", "local/gemma:4b"], " local ", "gemma:4b", "1"), { name: "local", model: "gemma:4b", limit: 1 });
	assert.deepEqual(checkModelLimit(["local/qwen3"], "local", "qwen3", null), { name: "local", model: "qwen3" });
	assert.deepEqual(checkModelLimit(["local/qwen3"], "local", "qwen3", ""), { name: "local", model: "qwen3" });
	assert.throws(() => checkModelLimit(["local/qwen3"], "local", "other", 1), /"local" has no model "other"\. Its models: qwen3/);
	assert.throws(() => checkModelLimit(["local/qwen3"], "local", "qwen3", 0), /a whole number from 1 to 64, or nothing for pine's own limit/);
});

test("limits: a pine.json that gives a model something that is no number of runs is refused with what it has to be", async () => {
	const h = await harness({ agents: { main: {} } });
	const file = path.join(h.home, "pine.json");
	const json = JSON.parse(fs.readFileSync(file, "utf8"));
	const withModels = (models: unknown) => fs.writeFileSync(file, JSON.stringify({ ...json, limits: { ...(json.limits ?? {}), models } }));
	withModels({ "local/qwen3-coder": 2, "lm-studio/gemma:4b": 1 });
	assert.deepEqual(loadConfig(h.home).limits.models, { "local/qwen3-coder": 2, "lm-studio/gemma:4b": 1 });
	for (const wrong of [{ "local/m": 0 }, { "local/m": 2.5 }, { local: 3 }, { "bad name!/m": 3 }, ["local/m"], "2"]) {
		withModels(wrong);
		assert.throws(() => loadConfig(h.home), /limits\.models gives a model \(as provider\/model-id\) the number of runs it takes at a time, a whole number from 1 to 64/, JSON.stringify(wrong));
	}
	await h.close();
});

test("limits: the models of one endpoint each have their own number or pine's, and a removed server takes its models' numbers along", async () => {
	const h = await harness({ models: [{ id: "small" }], pine: { http: { port: 0 }, limits: { maxConcurrentRuns: 8, models: { "mock/small": 1 } } }, agents: { main: {} } });
	const { agents } = h.pine;
	// The model with a number of its own has a queue of its own; the server's other models are in pine's queue for all.
	assert.deepEqual([agents.limiterOf("mock/small").max, agents.limiterOf("mock/m") === agents.limiter, agents.limiterOf("mock/small") === agents.limiter], [1, true, false]);
	assert.equal(agents.limiterOf("elsewhere/small"), agents.limiter);
	// Sub-agents on that model run one after the other, while the conversation's own model is held to nothing but pine's limit.
	// (Counted at the model server, not timed: each takes 80 ms there, so side by side they would be there together.)
	h.mock.state.scripts.piece = [{ delayMs: 80, text: "piece done" }];
	h.mock.state.maxInflight = 0;
	const r = await agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { tasks: ["one @@REF:piece@@", "two @@REF:piece@@", "three @@REF:piece@@"], model: "small" })] }, { text: "IN" }]), ...owner });
	assert.equal(r.text, "IN");
	const arrived = h.mock.state.requests.filter((q: any) => q.body.model === "small").map((q: any) => q.t as number);
	assert.equal(arrived.length, 3);
	assert.equal(h.mock.state.maxInflight, 1, "one after the other: never two requests at the model at once");
	assert.ok(h.pine.tasks.list({ limit: 20 }).filter((t) => t.kind === "subagent").every((t) => t.meta.model === "mock/small"));
	assert.deepEqual(agents.status().models, { "mock/small": { active: 0, waiting: 0, max: 1 } });
	// Through the control API: set for a model, said with the model, taken off again; a model the server has not is refused.
	const base = `http://127.0.0.1:${h.pine.http!.port}`;
	const api = async (method: string, at: string, body?: unknown) => {
		const res = await fetch(`${base}${at}`, { method, headers: { authorization: `Bearer ${h.pine.token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
		return { status: res.status, body: (await res.json()) as any };
	};
	const file = () => JSON.parse(fs.readFileSync(path.join(h.home, "pine.json"), "utf8")).limits;
	const listed = async () => (await api("GET", "/models/servers")).body.find((x: any) => x.name === "mock");
	assert.deepEqual([(await listed()).limit, (await listed()).models.map((m: any) => [m.id, m.limit])], [undefined, [["m", undefined], ["small", 1]]]);
	assert.deepEqual((await api("POST", "/models/servers/limit", { name: "mock", model: "m", limit: 2 })).body, { name: "mock", model: "m", limit: 2, runs: 8 });
	assert.deepEqual([file().models, agents.limiterOf("mock/m").max], [{ "mock/small": 1, "mock/m": 2 }, 2]);
	assert.equal((await api("POST", "/models/servers/limit", { name: "mock", model: "nothing", limit: 2 })).status, 400);
	await api("POST", "/models/servers/limit", { name: "mock", model: "m", limit: null });
	assert.deepEqual([file().models, agents.limiterOf("mock/m") === agents.limiter], [{ "mock/small": 1 }, true]);
	// The server removed: its models' numbers go with it, from the file and from what is in force.
	// (Through the function the control API and the main agent's tool both use: the API refuses a server an agent still runs on.)
	assert.equal((await api("POST", "/models/servers/remove", { name: "mock" })).status, 409);
	h.pine.cfg.defaults.model = "elsewhere/m";
	assert.equal(removeModelServer(h.pine.cfg, "mock"), true);
	assert.deepEqual([file()?.models, agents.limiterOf("mock/small") === agents.limiter], [undefined, true]);
	await h.close();
});
