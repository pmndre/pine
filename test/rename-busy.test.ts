// Renaming a conversation while its agent works in it (AgentManager.renameSession): the run, what waits
// behind it, its history, its mark and its permissions all go to the new name, and the old name is free.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { harness, textOf, until } from "./support/harness.ts";

const owner = { trust: "owner" as const };
const users = (req: any) => req.body.messages.filter((m: any) => m.role === "user").map((m: any) => textOf(m.content));

test("a conversation renamed while its agent works: the run goes on under the new name, its answer and its history land there, and a message waiting behind it runs there", async () => {
	const h = await harness({ agents: { main: {} } });
	const dir = (name: string) => path.join(h.home, "agents", "main", "sessions", name);
	const history = (name: string) =>
		fs.existsSync(dir(name))
			? fs
					.readdirSync(dir(name))
					.filter((f) => f.endsWith(".jsonl"))
					.map((f) => fs.readFileSync(path.join(dir(name), f), "utf8"))
					.join("")
			: "";
	let renamed = false;
	// A step with a tool, then an answer that waits until the conversation has its new name.
	h.mock.state.scripts.long = [{ tools: [{ name: "bash", args: { command: "echo STARTED-HERE" } }] }, { until: () => renamed, text: "FIRST-DONE" }];
	const first = h.pine.agents.submit({ agent: "main", session: "work", prompt: "@@REF:long@@ the first job", ...owner });
	await until(() => h.mock.state.requests.length >= 2, 5000, "the run to be at its second step");
	// A message for the busy conversation waits behind the run.
	const second = h.pine.agents.submit({ agent: "main", session: "work", prompt: "THE-SECOND-MESSAGE", ...owner });
	assert.equal(h.pine.tasks.get(second.id)!.status, "pending");

	assert.deepEqual(await h.pine.agents.renameSession("main", "work", "renamed"), { session: "renamed" });
	renamed = true;

	const r1 = await h.pine.agents.wait(first.id);
	assert.equal(r1.status, "done", String(r1.error));
	assert.equal(r1.text, "FIRST-DONE");
	const r2 = await h.pine.agents.wait(second.id);
	assert.equal(r2.status, "done", String(r2.error));

	// Both tasks are the renamed conversation's, and the answer was told under its new name.
	assert.equal(h.pine.tasks.get(first.id)!.session, "renamed");
	assert.equal(h.pine.tasks.get(second.id)!.session, "renamed");
	const done = h.pine.bus.query({ topic: "agent/main/done" }).find((e: any) => e.payload.task === first.id) as any;
	assert.equal(done?.payload.session, "renamed", "the answer is told for the conversation's new name");

	// The message that waited ran in the same conversation: it saw the first job and its answer.
	const asked = h.mock.state.requests.at(-1);
	assert.ok(users(asked).some((u: string) => u.includes("the first job")), JSON.stringify(users(asked)));
	assert.ok(JSON.stringify(asked.body.messages).includes("FIRST-DONE"), "the second message sees the first answer");

	// pi went on writing the history into the renamed folder: what came after the rename is there, and nothing was made under the old name.
	assert.ok(history("renamed").includes("STARTED-HERE"), "the part before the rename moved with the folder");
	assert.ok(history("renamed").includes("FIRST-DONE"), "the part after the rename was written to the new folder");
	assert.ok(history("renamed").includes("THE-SECOND-MESSAGE"));
	assert.equal(fs.existsSync(dir("work")), false, "nothing is written under the old name");
	assert.deepEqual(
		h.pine.agents
			.conversations("main")
			.map((c) => c.session)
			.sort(),
		["renamed"],
	);
	await h.close();
});

test("a conversation renamed while its agent works keeps its mark and its permissions under the new name, and the old name starts clean", async () => {
	const h = await harness({ agents: { main: {} } });
	const m = h.pine.agents as any;
	let renamed = false;
	h.mock.state.scripts.held = [{ until: () => renamed, text: "HELD-DONE" }];
	const first = h.pine.agents.submit({ agent: "main", session: "work", prompt: "@@REF:held@@ hold on", ...owner });
	await until(() => h.mock.state.requests.length >= 1 && m.lives.get("main:work")?.current, 5000, "the run to be at the model");
	// What the owner allowed this conversation while it worked (request_access, an "always here").
	m.grants.set("main:work", { network: true, read: ["/somewhere"], write: [], local: [], apps: [] });
	m.allowed.set("main:work", new Map([["bash:curl", true]]));

	await h.pine.agents.renameSession("main", "work", "renamed");
	// Outside content read after the rename marks the conversation under the name it has now.
	m.lives.get("main:renamed").taint("a web page read after the rename");
	renamed = true;
	const r = await h.pine.agents.wait(first.id);
	assert.equal(r.status, "done", String(r.error));

	assert.equal(m.lives.get("main:work"), undefined, "the live session moved to the new name");
	assert.equal(h.pine.agents.kv.get("taint:main:renamed"), "a web page read after the rename");
	assert.equal(h.pine.agents.kv.get("taint:main:work") ?? undefined, undefined, "the mark is not left under the old name");
	assert.equal(m.grants.get("main:renamed")?.network, true, "what the owner granted went with it");
	assert.ok(m.allowed.get("main:renamed")?.get("bash:curl"), "an always-here answer went with it");
	assert.equal(m.grants.get("main:work"), undefined);
	assert.equal(m.allowed.get("main:work"), undefined);
	const marked = (session: string) => h.pine.agents.status().sessions.find((s: any) => s.agent === "main" && s.session === session)?.tainted;
	// Opened again, the renamed conversation is marked: the mark was kept under its new name.
	await h.pine.agents.run({ agent: "main", session: "renamed", prompt: "and again", ...owner });
	assert.equal(marked("renamed"), "a web page read after the rename", "the renamed conversation is still marked");

	// A new conversation under the old name is a new conversation: no history, no mark, no permissions.
	await h.pine.agents.run({ agent: "main", session: "work", prompt: "A-NEW-START", ...owner });
	assert.ok(!users(h.mock.state.requests.at(-1)).some((u: string) => u.includes("hold on")), "the new conversation was not told the old one's message");
	assert.ok(!JSON.stringify(h.mock.state.requests.at(-1).body.messages).includes("HELD-DONE"), "the new conversation has none of the old one's history");
	assert.equal(marked("work"), undefined, "the new conversation is not marked");
	assert.equal(m.grants.get("main:work"), undefined, "nor does it have the old one's permissions");
	assert.equal(m.allowed.get("main:work"), undefined);
	await h.close();
});
