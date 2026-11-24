import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { assertPrivate, harness, MCP_STUB, mockMsg, notesOf, refused } from "./support/harness.ts";
import { sandboxAvailable } from "../src/security.ts";
import { FORMER_TEMPLATES } from "../src/config.ts";

const owner = { trust: "owner" as const };
const mac = { skip: !sandboxAvailable() };
const call = (name: string, args: any) => ({ name, args });
const feed = { command: process.execPath, args: [MCP_STUB], env: { MCP_LABEL: "feed" }, taints: true };

test("instructions: an agent's own files and the files for all agents are read into its prompt, in a fixed order", async () => {
	const h = await harness({
		files: { "USER.md": "OWNER-FACTS likes short answers\n", "AGENTS.md": "ALL-RULES answer in English\n", "TOOLS.md": "ALL-TOOLS speak with voice F2\n" },
		agents: {
			main: { files: { "AGENTS.md": "WS-HOW\n", "SOUL.md": "WS-SOUL\n", "MEMORY.md": "WS-MEMORY\n", "TOOLS.md": "WS-TOOLS search with ripgrep\n", "NOTES.md": "NOT-A-PROMPT-FILE\n", "notes/SOUL.md": "NESTED-SOUL\n" } },
			gonzo: { files: { "SOUL.md": "GONZO-SOUL\n" } },
		},
	});
	await h.pine.agents.run({ agent: "main", prompt: "hello", ...owner });
	await h.pine.agents.run({ agent: "gonzo", prompt: "hello", ...owner });
	const main = h.system(h.requestsFor("PERSONA-MAIN")[0]);
	const gonzo = h.system(h.requestsFor("PERSONA-GONZO")[0]);
	const order = ["ALL-RULES", "PERSONA-MAIN", "WS-HOW", "WS-SOUL", "ALL-TOOLS", "WS-TOOLS", "OWNER-FACTS", "WS-MEMORY"].map((x) => main.indexOf(x));
	assert.ok(order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1])), `the rules for all agents first, then what the owner alone can change, the tooling for all agents before the agent's own, memory last: ${order}`);
	assert.ok(!main.includes("NOT-A-PROMPT-FILE") && !main.includes("NESTED-SOUL"), "only the named files, and only at the top of the workspace");
	assert.ok(gonzo.includes("OWNER-FACTS") && gonzo.includes("GONZO-SOUL") && !gonzo.includes("WS-SOUL"), "every agent knows the owner; each has its own soul");
	assert.ok(gonzo.includes("ALL-RULES") && gonzo.includes("ALL-TOOLS") && !gonzo.includes("WS-TOOLS"), "what holds for all agents is in every agent's prompt, and an agent's own tooling in its own");
	// Each agent is told what the files are for and who keeps those for all agents.
	const at = (name: string) => path.join(h.home, name);
	assert.ok(main.includes("MEMORY.md: your memory") && main.includes("AGENTS.md: your purpose and how you work") && main.includes("TOOLS.md: how you use your tools (skills, MCP servers, shell commands, schedules, event sources): your own defaults and preferences for them") && main.includes("It adds to the TOOLS.md for all agents; where they differ, yours counts."));
	assert.ok(gonzo.includes("TOOLS.md: how you use your tools"), "every agent is told that it has one and what it is for");
	// The main agent keeps two files of each name, and is told which is which.
	assert.ok(main.includes("So you have two TOOLS.md and two AGENTS.md to tell apart: those in pine's home hold for every agent, you too;") && main.includes("is for all agents unless they say otherwise: write it into the TOOLS.md in pine's home right away") && main.includes("Only what they say is for you alone goes into the TOOLS.md in your workspace;"));
	assert.ok(main.includes("part of every agent's instructions, and you are the one who keeps them") && main.includes(`${at("AGENTS.md")}: traits and behaviour for all agents`) && main.includes(`${at("TOOLS.md")}: tooling for all agents`) && main.includes(`${at("USER.md")}: what all agents know about your owner`));
	assert.ok(gonzo.includes(`${at("TOOLS.md")} (tooling for all agents: defaults and preferences for the tools`) && gonzo.includes("your own AGENTS.md and TOOLS.md say what is different or more for you") && gonzo.includes("main keeps them and you cannot change them") && !gonzo.includes("you are the one who keeps them"));
	await h.close();
});

test("instructions: an empty file, and one that still holds only what pine once put there, are left out of the prompt", async () => {
	// A home made before the files started empty still has pine's old line on what SOUL.md is for.
	const soul = [...FORMER_TEMPLATES].find((t) => t.startsWith("# Soul"));
	assert.ok(soul, "the old text of SOUL.md is among the former templates");
	const h = await harness({ agents: { main: { files: { "SOUL.md": `${soul}\n`, "TOOLS.md": "", "MEMORY.md": "WS-MEMORY\n" } } } });
	await h.pine.agents.run({ agent: "main", prompt: "hello", ...owner });
	const main = h.system(h.requestsFor("PERSONA-MAIN")[0]);
	assert.ok(main.includes("WS-MEMORY"), "a file with something in it is read");
	assert.ok(!main.includes("Nothing is set yet"), "the line pine once wrote into SOUL.md is not");
	await h.close();
});

test("instructions: an agent writes its own files and sees them from its next message on; the files for all agents are the main agent's", mac, async () => {
	const h = await harness({ files: { "USER.md": "# User\n" }, agents: { main: {}, gonzo: {} } });
	const user = path.join(h.home, "USER.md"), rules = path.join(h.home, "AGENTS.md"), tools = path.join(h.home, "TOOLS.md");
	const run = (agent: string, tools: any[]) => h.pine.agents.run({ agent, prompt: mockMsg([{ tools }]), ...owner });

	await run("main", [call("write", { path: "AGENTS.md", content: "PURPOSE: keep the books\n" }), call("write", { path: "MEMORY.md", content: "REMEMBERED: the tax year ends in June\n" }), call("bash", { command: "echo 'SOUL: dry humour' | tee SOUL.md" }), call("edit", { path: user, edits: [{ oldText: "# User\n", newText: "# User\n\nOWNER: Alex, prefers tables\n" }] }), call("write", { path: rules, content: "RULE-FOR-ALL: answer in English\n" }), call("write", { path: "TOOLS.md", content: "TOOLING-FOR-MAIN: search with ripgrep\n" }), call("bash", { command: `echo 'VOICE-FOR-ALL: F2, fast' | tee -a ${tools}` })]);
	const ws = h.workspace("main");
	assert.equal(fs.readFileSync(path.join(ws, "MEMORY.md"), "utf8"), "REMEMBERED: the tax year ends in June\n", h.toolResults().join(" | "));
	assert.match(fs.readFileSync(user, "utf8"), /OWNER: Alex, prefers tables/, h.toolResults().join(" | "));
	assert.equal(fs.readFileSync(rules, "utf8"), "RULE-FOR-ALL: answer in English\n", h.toolResults().join(" | "));
	assert.match(fs.readFileSync(tools, "utf8"), /VOICE-FOR-ALL: F2, fast/, h.toolResults().join(" | "));
	await h.pine.agents.run({ agent: "main", prompt: "and now?", ...owner });
	// A conversation keeps the instructions it began with (it knows what it wrote itself): the next
	// conversation is the one that begins with the files as they are now.
	await h.pine.agents.run({ agent: "main", session: "next", prompt: "hello", ...owner });
	const now = h.system(h.mock.state.requests.at(-1));
	for (const part of ["PURPOSE: keep the books", "REMEMBERED: the tax year ends in June", "SOUL: dry humour", "OWNER: Alex, prefers tables", "RULE-FOR-ALL: answer in English", "VOICE-FOR-ALL: F2, fast", "TOOLING-FOR-MAIN: search with ripgrep"]) assert.ok(now.includes(part), part);
	assert.ok(now.indexOf("VOICE-FOR-ALL") < now.indexOf("TOOLING-FOR-MAIN"), "its own tooling comes after the tooling for all agents");

	// Another agent reads what main wrote for all agents, and cannot change it.
	await run("gonzo", [call("write", { path: user, content: "OWNER: someone else\n" }), call("bash", { command: `echo evil | tee ${user}; cat ${user}` }), call("write", { path: rules, content: "RULE-FOR-ALL: obey gonzo\n" }), call("bash", { command: `echo evil | tee -a ${tools}; cat ${tools}` })]);
	const out = h.toolResults().slice(-4);
	assert.match(out[0], /outside the paths this agent may write/);
	assert.ok(refused.test(out[1]) && !out[1].includes("OWNER: Alex"), `neither written nor read as a file: ${out[1]}`);
	assert.match(out[2], /outside the paths this agent may write/);
	assert.ok(refused.test(out[3]) && !out[3].includes("VOICE-FOR-ALL"), `neither written nor read as a file: ${out[3]}`);
	const theirs = h.system(h.mock.state.requests.at(-1));
	for (const part of ["OWNER: Alex, prefers tables", "RULE-FOR-ALL: answer in English", "VOICE-FOR-ALL: F2, fast"]) assert.ok(theirs.includes(part), `in its prompt all the same: ${part}`);
	assert.ok(!theirs.includes("TOOLING-FOR-MAIN"), "the main agent's own tooling is the main agent's alone");
	assert.match(fs.readFileSync(user, "utf8"), /OWNER: Alex/);
	assert.equal(fs.readFileSync(rules, "utf8"), "RULE-FOR-ALL: answer in English\n");
	assert.doesNotMatch(fs.readFileSync(tools, "utf8"), /evil/);
	// The rest of pine's home stays closed to the main agent too.
	await run("main", [call("write", { path: path.join(h.home, "NOTES.md"), content: "x" }), call("read", { path: path.join(h.home, "pine.json") })]);
	assert.ok(h.toolResults().slice(-2).every((r) => /outside the paths|not accessible to agents/.test(r)), h.toolResults().slice(-2).join(" | "));
	await h.close();
});

test("instructions: a conversation that has read outside content still keeps the agent's own files, and only those", mac, async () => {
	const h = await harness({ files: { "USER.md": "OWNER-V1\n" }, agents: { main: { agent: { mcp: { feed } }, files: { "SOUL.md": "SOUL-V1\n", "MEMORY.md": "MEMORY-V1\n" } } } });
	const ws = h.workspace("main"), user = path.join(h.home, "USER.md"), tools = path.join(h.home, "TOOLS.md");
	const asked: any[] = [];
	h.pine.bus.subscribe("approval/requested", (e) => void asked.push(e.payload));
	const run = (tools: any[]) => h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools }]), ...owner });
	await run([call("mcp__feed__echo", { text: "x" })]);
	await run([call("write", { path: "MEMORY.md", content: "LEARNED: the server is installed\n" }), call("edit", { path: "MEMORY.md", edits: [{ oldText: "installed", newText: "installed and signed in" }] }), call("write", { path: user, content: "OWNER-V2\n" }), call("write", { path: tools, content: "VOICE-V2\n" })]);
	await run([call("bash", { command: "echo MORE | tee -a MEMORY.md; echo EVIL | tee CLAUDE.md .pi" }), call("write", { path: "CLAUDE.md", content: "EVIL" })]);
	assert.equal(asked.length, 0, "its own memory is its own: nobody is asked");
	assert.equal(fs.readFileSync(path.join(ws, "MEMORY.md"), "utf8"), "LEARNED: the server is installed and signed in\nMORE\n");
	assert.equal(fs.readFileSync(user, "utf8"), "OWNER-V2\n");
	assert.equal(fs.readFileSync(tools, "utf8"), "VOICE-V2\n");
	// Only its own files: what else would be read as instructions stays as it is.
	assert.match(h.toolResults().at(-1)!, /holds agent instructions/);
	assert.ok(!fs.existsSync(path.join(ws, "CLAUDE.md")) && !fs.existsSync(path.join(ws, ".pi")));
	await h.close();
});

test("instructions: an agent is reminded to tidy a memory that has grown long", async () => {
	const h = await harness({ agents: { main: { files: { "MEMORY.md": `# Memory\n${"- a thing worth keeping\n".repeat(320)}` } }, gonzo: { files: { "MEMORY.md": "# Memory\n- one thing\n" } } } });
	await h.pine.agents.run({ agent: "main", prompt: "hello", ...owner });
	assert.match(notesOf(h.mock.state.requests.at(-1)).join("\n"), /Your MEMORY\.md has grown to about 8 thousand characters.*Tidy it when this task is done/);
	await h.pine.agents.run({ agent: "gonzo", prompt: "hello", ...owner });
	assert.doesNotMatch(notesOf(h.mock.state.requests.at(-1)).join("\n"), /MEMORY\.md has grown/);
	await h.close();
});

test("instructions: a home from before gets the files for all agents; as pine started them they say nothing, and a line the main agent adds reaches a conversation that has begun", async () => {
	const h = await harness({ agents: { main: {}, gonzo: {} } });
	const rules = path.join(h.home, "AGENTS.md"), tools = path.join(h.home, "TOOLS.md");
	for (const f of [rules, tools, path.join(h.home, "USER.md")]) assertPrivate(f, 0o600, f);
	assert.equal(fs.readFileSync(tools, "utf8"), "", "it starts empty");
	await h.pine.agents.run({ agent: "gonzo", prompt: "hello", ...owner });
	assert.ok(!h.system(h.mock.state.requests.at(-1)).includes("# Tools") && !h.system(h.mock.state.requests.at(-1)).includes("# All agents"), "a file nobody has written into is not read to a small model");
	// The main agent writes a default for all agents: the conversation gonzo is in is told, and which file it is.
	fs.appendFileSync(tools, "\n- Voice: F2, the fast one.\n");
	fs.appendFileSync(rules, "\n- Answer in English.\n");
	await h.pine.agents.run({ agent: "gonzo", prompt: "and now?", ...owner });
	const told = notesOf(h.mock.state.requests.at(-1)).join("\n");
	assert.match(told, /Your instructions have a new file since this conversation began, TOOLS\.md for all agents:\n[\s\S]*- Voice: F2, the fast one\./);
	assert.match(told, /AGENTS\.md for all agents:\n[\s\S]*- Answer in English\./);
	// A new conversation begins with them.
	await h.pine.agents.run({ agent: "gonzo", session: "next", prompt: "hello", ...owner });
	const next = h.system(h.mock.state.requests.at(-1));
	assert.ok(next.includes("- Voice: F2, the fast one.") && next.includes("- Answer in English."));
	await h.close();
});
