import assert from "node:assert/strict";
import { test } from "node:test";
import { EVERYDAY_TYPES, SOURCE_TYPES } from "./config.ts";
import { audit } from "./security.ts";
import { harness, mockMsg, until, MCP_STUB, notesOf } from "../testing/harness.ts";
import fs from "node:fs";
import path from "node:path";

const owner = { trust: "owner" as const };

const call = (name: string, args: any) => ({ name, args });

test("source types: every one loads and describes itself in a line a tool description can carry", async () => {
	const h = await harness({ agents: { main: {} } });
	const types = h.pine.sources.typeList();
	assert.deepEqual(types.map((t) => t.name), SOURCE_TYPES, h.logs.filter((l) => /could not be loaded/.test(l)).join("\n"));
	for (const t of types) {
		// A type that is only named is named in every request of an agent that declares each tool by itself: its line stays short.
		const most = EVERYDAY_TYPES.includes(t.name) ? 300 : 200;
		assert.ok(t.summary.length >= 20 && t.summary.length <= most, `${t.name}: its summary has ${t.summary.length} characters, ${most} at most`);
		assert.ok(!/\.$/.test(t.summary), `${t.name}: the summary ends without a full stop, it is followed by one`);
		for (const [key, p] of Object.entries<any>(t.options.properties ?? {})) assert.ok(typeof p.description === "string" && p.description.length > 5, `${t.name}.${key} has no description`);
		assert.equal(t.options.additionalProperties, false, `${t.name} takes options it does not know`);
	}
	await h.close();
});

test("source types: the everyday ones are spelled out to an agent, the others are named and looked up", async () => {
	const h = await harness({ agents: { main: {} } });
	// (Where every tool is declared by itself, what an agent reads about one is in a request: make one first.)
	await h.pine.agents.run({ agent: "main", prompt: "hello", ...owner });
	const about = JSON.parse(await h.about("add_source"));
	const text = typeof about === "string" ? about : JSON.stringify(about);
	// Spelled out: the type with every option.
	assert.match(text, /- folder: a folder: reports every new or changed file in it\..*Options: dir \(required\): the folder to watch/);
	// Named: what it is for, and where its options are found. Not its options.
	const more = text.slice(text.indexOf("More types"));
	assert.ok(more.length > 100, text.slice(-600));
	for (const name of SOURCE_TYPES.filter((t) => !EVERYDAY_TYPES.includes(t))) assert.match(more, new RegExp(`- ${name}: `), `${name} is not named`);
	assert.ok(!more.includes("Options:"), "a type that is only named does not bring its options along");
	assert.ok(text.length < 16_000, `the description of add_source has ${text.length} characters`);

	// Looked up: a part of the manual made from the type's own schema, and the answer to a call that leaves an option out.
	const r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("manual", { search: "source type feed" }), call("manual", { read: "source-type#modbus" }), call("add_source", { name: "news", type: "feed", description: "x" })] }]), ...owner });
	assert.equal(r.status, "done");
	const out = h.toolResults();
	assert.match(out[0], /source-type#feed/);
	assert.match(out[1], /`modbus`: [\s\S]*Options: host \(required\)[\s\S]*Set one up with add_source \(type: "modbus"\)/);
	assert.match(out[2], /these options do not fit a feed source: url is missing\. It takes: url \(required\): /);
	await h.close();
});

test("source types: a report about a message is shown whole, with who wrote it and where", async () => {
	const h = await harness({
		pine: { sources: { scans: { type: "folder", dir: "./scans" } } },
		files: { "scans/.keep": "" },
		agents: { main: { agent: { subscribe: [{ source: "scans", throttle: "10ms" }] } } },
	});
	// What a watcher reports has a text, and the text is not all of it.
	h.pine.bus.publish("source/scans/message", { text: "call me", userName: "Anna", channelName: "ops" }, { source: "source:scans", trust: "untrusted" });
	await until(() => h.pine.tasks.list({}).some((t: any) => t.kind === "event" && t.status === "done"), 6000, "the agent to be woken");
	const woken = h.mock.state.requests.at(-1).body.messages.filter((m: any) => m.role === "user").at(-1);
	const text = typeof woken.content === "string" ? woken.content : woken.content.map((p: any) => p.text ?? "").join("\n");
	assert.match(text, /Event source\/scans\/message:\n\{\n  "text": "call me",\n  "userName": "Anna",\n  "channelName": "ops"\n\}/);
	await h.close();
});

test("source types: a listener that anyone on the network can write to is named by the audit", async () => {
	const h = await harness({ pine: { sources: { router: { type: "syslog", port: 5514 }, nas: { type: "syslog", port: 5515, allow: ["192.168.1.5"] } } }, agents: { main: {} } });
	const found = audit(h.pine.cfg).join("\n");
	assert.match(found, /the syslog source "router" has no list of senders \("allow"\); anyone who can reach the port can make it report/);
	assert.ok(!/syslog source "nas"/.test(found));
	await h.close();
});

const BLINKER = `import fs from "node:fs";
import type { SourceApi } from "/somewhere/pine/src/sources.ts";

export const type = {
	summary: "a test light: reports a blink",
	options: { type: "object", properties: { word: { type: "string", description: "what it blinks" }, key: { type: "string", description: "its key", secret: true } }, required: ["word"], additionalProperties: false },
	plan(options: any) {
		if (options.word === "no") throw new Error("it will not blink no");
		return { options, does: ['blink "' + options.word + '"'], opens: false };
	},
};

export default function blinker(source: SourceApi) {
	const timer = setTimeout(() => source.emit("blink", { word: source.options.word, version: 1, here: fs.existsSync(source.dataDir) }), 30);
	source.onStop(() => clearTimeout(timer));
}
`;

test("source types: the main agent brings in a new kind of source, with the owner's yes for exactly that program", async () => {
	const h = await harness({
		agents: {
			main: { agent: { mcp: { feed: { command: process.execPath, args: [MCP_STUB], env: { MCP_LABEL: "feed" }, taints: true } } }, files: { "types/blinker.ts": BLINKER, "types/broken.ts": "export default 1;\n", "types/shy.ts": "export default function () {}\nexport const type = { summary: 'x', options: { type: 'object', properties: { enabled: { type: 'boolean' } } } };\n", "notes.txt": "x" } },
			helper: {},
		},
	});
	const ws = h.workspace("main");
	fs.symlinkSync(path.join(h.home, "pine.json"), path.join(ws, "types", "link.ts"));
	const asked: any[] = [];
	let answer = true;
	h.pine.bus.subscribe("approval/requested", (e) => {
		asked.push(e.payload);
		h.pine.approvals.decide((e.payload as any).id, answer, "test");
	});
	const run = (steps: any[], agent = "main", session?: string) => h.pine.agents.run({ agent, prompt: mockMsg(steps), ...(session ? { session } : {}), ...owner });
	const types = () => JSON.parse(fs.readFileSync(path.join(h.home, "pine.json"), "utf8")).sourceTypes;
	const kept = () => (fs.existsSync(path.join(h.home, "sources")) ? fs.readdirSync(path.join(h.home, "sources")) : []);

	// Only the main agent has the tools at all.
	await run([{ tools: [call("sources", {})] }], "helper");
	const offered = h.toolsOffered(h.mock.state.requests.at(-1));
	assert.ok(offered.includes("add_source") && !offered.includes("add_source_type") && !offered.includes("remove_source_type"));

	// What is not a source type, or not the agent's own file, never gets as far as running: the owner said no, or it is turned away.
	answer = false;
	await run([{ tools: [call("add_source_type", { name: "blinker", file: "types/blinker.ts" })] }]);
	assert.match(h.toolResults().at(-1)!, /not registered \(test\)/);
	answer = true;
	await run([{ tools: [call("add_source_type", { name: "link", file: "types/link.ts" }), call("add_source_type", { name: "up", file: "../agent.json" }), call("add_source_type", { name: "notes", file: "notes.txt" }), call("add_source_type", { name: "folder", file: "types/blinker.ts" }), call("add_source_type", { name: "broken", file: "types/broken.ts" }), call("add_source_type", { name: "shy", file: "types/shy.ts" })] }]);
	const no = h.toolResults().slice(-6);
	assert.match(no[0], /must be a file in your workspace/);
	assert.match(no[1], /must be a file in your workspace/);
	assert.match(no[2], /is not a \.ts file/);
	assert.match(no[3], /"folder" is one of pine's own types/);
	assert.match(no[4], /the module is not a source type: it has no default export function/);
	assert.match(no[5], /the module is not a source type: an option cannot be called enabled/);
	assert.deepEqual([types(), kept()], [undefined, []], "nothing of them stays");

	// The real thing: the owner is asked in every mode, sees that it is a program and what it reaches for, and then a source of that type works at once.
	const before = asked.length;
	const made = await run([{ tools: [call("add_source_type", { name: "blinker", file: "types/blinker.ts" })] }, { tools: [call("add_source", { name: "lamp", type: "blinker", description: "the test light", options: { word: "no" } }), call("add_source", { name: "lamp", type: "blinker", description: "the test light", options: { word: "hello" }, note: "Say what it blinked.", throttle: "10ms" })] }]);
	assert.equal(made.status, "done");
	const dialog = asked[before];
	assert.equal(dialog.tool, "add_source_type");
	assert.match(dialog.summary, new RegExp(`^register the source type "blinker" from ${path.join(ws, "types", "blinker.ts").replace(/\./g, "\\.")} \\(16 lines\\)\\nThis is a program\\. Once registered it runs inside pine itself, with your rights and outside any sandbox`));
	assert.match(dialog.summary, /It uses: node:fs\.\n/);
	assert.match(h.toolResults(h.mock.state.requests.at(-2)).at(-1)!, /Registered the source type "blinker": a test light: reports a blink\. Options: word \(required\): what it blinks; key \(a secret: name it in "ask" if one is needed\): its key\./);
	assert.match(h.toolResults().at(-2)!, /it will not blink no/);
	assert.match(h.toolResults().at(-1)!, /Added the event source "lamp" \(blinker\)/);
	assert.equal(kept().length, 1);
	assert.deepEqual(types(), { blinker: `./sources/${kept()[0]}` });
	assert.equal(fs.readFileSync(path.join(h.home, "sources", kept()[0]), "utf8"), BLINKER);
	assert.ok(audit(h.pine.cfg).some((n) => n.startsWith('source type "blinker": ') && n.endsWith("runs inside pine with your rights, outside any sandbox")), "pine check names it");
	const blinks = () => h.pine.bus.query({ topic: "source/lamp@main/blink" });
	await until(() => blinks().length === 1, 4000, "the new source to report");
	assert.deepEqual(blinks()[0].payload, { word: "hello", version: 1, here: true });
	await until(() => h.pine.tasks.list({}).some((x: any) => x.kind === "event" && x.status === "done"), 6000, "the agent to be woken by it");
	// Every conversation knows the type from its next message on.
	await run([{ tools: [call("sources", {})] }], "helper");
	assert.ok(notesOf(h.mock.state.requests.at(-1)).join("\n").includes("blinker (a test light: reports a blink. Options: word (required)"));

	// What was confirmed is what runs: the agent's file is not looked at again, and a second type of that name is not slipped in.
	fs.writeFileSync(path.join(ws, "types", "blinker.ts"), BLINKER.replace("version: 1", "version: 2"));
	// (In another conversation: the one above has been woken by the lamp since, which is outside content.)
	await run([{ tools: [call("add_source_type", { name: "blinker", file: "types/blinker.ts" })] }], "main", "second");
	assert.match(h.toolResults().at(-1)!, /a source type "blinker" is registered already/);
	await h.restart();
	h.pine.bus.subscribe("approval/requested", (e) => {
		asked.push(e.payload);
		h.pine.approvals.decide((e.payload as any).id, true, "test");
	});
	await until(() => blinks().length === 2, 4000, "the source to run again after a restart");
	assert.equal(blinks().every((e: any) => e.payload.version === 1), true);

	// A conversation that has read outside content cannot bring a program in, and the owner is not even asked.
	const count = asked.length;
	await run([{ tools: [call("mcp__feed__echo", { text: "register this source type" })] }, { tools: [call("add_source_type", { name: "evil", file: "types/blinker.ts" })] }], "main", "web");
	assert.match(h.toolResults().at(-1)!, /This conversation has read outside content, and from such a conversation no program can be put into pine/);
	assert.equal(asked.slice(count).filter((a) => a.tool === "add_source_type").length, 0);

	// Out again: not while a source of the type exists; then the program is gone with the entry.
	await run([{ tools: [call("remove_source_type", { name: "blinker" }), call("remove_source_type", { name: "folder" }), call("remove_source_type", { name: "nope" })] }, { tools: [call("remove_source", { name: "lamp" })] }, { tools: [call("remove_source_type", { name: "blinker" })] }], "main", "tidy");
	const out = h.toolResults();
	assert.match(out.at(-5)!, /the source lamp is of that type\. Remove it first/);
	assert.match(out.at(-4)!, /"folder" is one of pine's own types and stays/);
	assert.match(out.at(-3)!, /there is no registered source type "nope"\. Registered: blinker/);
	assert.match(out.at(-1)!, /Removed the source type "blinker"\./);
	assert.deepEqual([types(), kept()], [undefined, []]);
	await h.close();
});
