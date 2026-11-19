import assert from "node:assert/strict";
import { test } from "node:test";
import { buildArgv } from "./commands.ts";
import { harness, mockMsg } from "../testing/harness.ts";

const owner = { trust: "owner" as const };

test("bundled commands server: fixed commands as tools, parameters cannot inject", async () => {
	const cmd = { description: "x", run: ["/bin/echo", "said:", "{{what}}", "--mode={{mode}}"], params: { what: {}, mode: { enum: ["a", "b"], default: "a" } } };
	assert.deepEqual(buildArgv(cmd, { what: "hi; rm -rf /" }), ["/bin/echo", "said:", "hi; rm -rf /", "--mode=a"]);
	assert.throws(() => buildArgv(cmd, { what: "--version" }), /must not start with "-"/);
	assert.throws(() => buildArgv(cmd, { what: "x", mode: "c" }), /must be one of/);
	assert.throws(() => buildArgv(cmd, {}), /"what" is required/);
	assert.throws(() => buildArgv({ description: "", run: ["x", "{{n}}"], params: { n: { type: "number" } } }, { n: "1; ls" }), /must be a number/);
	assert.throws(() => buildArgv({ description: "", run: ["x", "{{id}}"], params: { id: { pattern: "[a-z0-9]+" } } }, { id: "abc/../.." }), /invalid format/);

	const h = await harness({
		pine: { mcp: { tools: { pine: "commands", options: { commands: { say: cmd, where: { description: "print the working directory", run: ["/bin/pwd"] }, sleepy: { description: "slow", run: ["/bin/sleep", "5"], timeoutSec: 0.2 } } } } } },
		agents: { main: {} },
	});
	const r = await h.pine.agents.run({
		agent: "main",
		prompt: mockMsg([{ tools: [{ name: "mcp__tools__say", args: { what: "$(id) `id` ; id" } }, { name: "mcp__tools__where", args: {} }, { name: "mcp__tools__say", args: { what: "-n" } }, { name: "mcp__tools__sleepy", args: {} }] }]),
		...owner,
	});
	const [say, where, dash, slow] = h.toolResults();
	assert.equal(say, "said: $(id) `id` ; id --mode=a");
	assert.equal(where, h.workspace("main"));
	assert.ok(/must not start with "-"/.test(dash), dash);
	assert.ok(/stopped after 0.2 s/.test(slow), slow);
	assert.equal(r.status, "done");
	await h.close();
});
