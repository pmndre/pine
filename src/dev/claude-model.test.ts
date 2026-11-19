import assert from "node:assert/strict";
import { test } from "node:test";

test("the claude -p stand-in: conversation rendering and reply parsing", async () => {
	const { buildPrompt, parseReply } = await import("./claude-model.ts");
	const prompt = buildPrompt({
		messages: [
			{ role: "system", content: "SYS" },
			{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "data:..." } }] },
			{ role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "bash", arguments: '{"command":"ls"}' } }] },
			{ role: "tool", tool_call_id: "c1", content: "a.txt" },
		],
		tools: [{ type: "function", function: { name: "bash", description: "run", parameters: { type: "object" } } }],
	});
	for (const part of ["<harness_system_prompt>\nSYS", '"name": "bash"', "<user>\nhi[image_url omitted]", '<tool_call id="c1" name="bash">{"command":"ls"}</tool_call>', '<tool_result id="c1">\na.txt']) assert.ok(prompt.includes(part), part);
	assert.deepEqual(parseReply('{"text":"","tool_calls":[{"name":"bash","arguments":{"command":"ls"}}]}'), { text: "", tool_calls: [{ name: "bash", arguments: { command: "ls" } }] });
	assert.deepEqual(parseReply('```json\n{"text":"done","tool_calls":[]}\n```'), { text: "done", tool_calls: [] });
	assert.deepEqual(parseReply("plain words, no JSON"), { text: "plain words, no JSON", tool_calls: [] });
	assert.deepEqual(parseReply('{"unrelated": 1}'), { text: '{"unrelated": 1}', tool_calls: [] });
});
