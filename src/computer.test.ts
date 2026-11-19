import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { TOOLS } from "../mcp/computer.ts";
import { classify } from "./actions.ts";
import { appTarget, computerSession } from "./computer.ts";
import { effectiveMcp, loadConfig, mcpTaints, toPiMcp } from "./config.ts";
import { rootsFor } from "./security.ts";
import { harness, mockMsg } from "../testing/harness.ts";
import { FAKE_HELPER } from "../testing/computer.ts";

test("computer: looking at an app is a look, acting in an allowed one is not asked about again", async () => {
	const h = await harness({ agents: { main: {} }, start: false });
	const cfg = loadConfig(h.home);
	const roots = rootsFor(cfg, cfg.agents.main);
	const base = { roots, cwd: roots.workspace, shellReaches: true, sends: false, canSendOut: () => true, reachable: () => false };
	const cls = (app: { look: boolean }, mcp = { readOnly: false, watched: false }) => classify("mcp__computer__x", {}, { ...base, app, mcp } as any).cls;
	assert.equal(cls({ look: true }), "look");
	assert.equal(cls({ look: false }), "local", "local is never asked about, whatever the conversation has read");
	assert.equal(cls({ look: false }, { readOnly: false, watched: true }), "send", 'an owner who sets "approve" on the server gets every action looked at');
	assert.equal(cls({ look: true }, { readOnly: false, watched: true }), "look");
	await h.close();
});

test("computer: which app a call is about, and who gets the server at all", () => {
	assert.deepEqual(appTarget("app_click", { app: " TextEdit ", x: 1, y: 2 }), { key: "app:textedit", name: "TextEdit" });
	assert.equal(appTarget("app_type", { app: "TEXTEDIT" })?.key, "app:textedit", "one yes for one app, however it is spelled");
	assert.equal(appTarget("apps", {}), undefined, "listing what runs is not asked about");
	assert.deepEqual(appTarget("app_screenshot", {}), { key: "screen", name: "the whole screen" });
	assert.equal(appTarget("app_screenshot", { app: "Mail" })?.key, "app:mail");
	assert.equal(appTarget("app_click", { x: 1, y: 2 }), undefined, "no app named: the server refuses the call");
	assert.equal(appTarget("app_press", { app: 7 }), undefined);

	const on = { owner: true, level: "auto" as const, dataDir: "/home/pine/data", platform: "darwin" };
	assert.deepEqual(computerSession(on), { helperDir: "/home/pine/data/computer" });
	assert.equal(computerSession({ ...on, owner: false }), undefined, "never a run started from outside");
	assert.equal(computerSession({ ...on, level: "safe" }), undefined, "never an agent that works in its sandbox");
});

// ---- in the daemon -------------------------------------------------------------------------------

test("computer: the bundled server is configured like the others and marks sessions as tainted", async () => {
	const h = await harness({ pine: { mcp: { computer: { pine: "computer", options: { images: false, helperDir: "/tmp/anything" } } } }, agents: { main: {} }, start: false });
	const cfg = loadConfig(h.home);
	const server = effectiveMcp(cfg, cfg.agents.main).computer;
	assert.equal(mcpTaints(server), true, "what a screen shows was written by others");
	// Where the helper is kept is pine's to say, whatever the options say.
	const pi = toPiMcp("computer", server, computerSession({ owner: true, level: "auto", dataDir: cfg.dataDir, platform: "darwin" })) as any;
	assert.ok(pi.args[0].endsWith("mcp/computer.ts"));
	assert.deepEqual(JSON.parse(pi.env.PINE_MCP_OPTIONS), { images: false, helperDir: path.join(cfg.dataDir, "computer") });
	// The example home has it, and loads on any system.
	const example = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../examples/home/pine.json"), "utf8"));
	assert.equal(example.mcp.computer.pine, "computer");
	assert.ok(fs.existsSync(path.resolve(import.meta.dirname, "../mcp/computer.swift")));
	await h.close();
});

/** A daemon whose main agent has app control on a stand-in helper. `log` is what reached the machine. */
async function withApps(t: { after(fn: () => void): void }, pine: Record<string, unknown> = {}, main: Record<string, unknown> = {}, ...flags: string[]) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pine-computer-test-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const script = path.join(dir, "helper.mjs");
	const log = path.join(dir, "log.txt");
	fs.writeFileSync(script, FAKE_HELPER);
	fs.writeFileSync(log, "");
	const reviews: string[] = [];
	const h = await harness({
		// The main agent as pine ships it: auto mode, the owner's account.
		pine: { defaults: { mode: undefined }, mcp: { computer: { pine: "computer", options: { helper: [process.execPath, script, log, ...flags] } } }, ...pine },
		agents: { main: { agent: { untrusted: { tools: ["read"], mcp: ["computer"] }, ...main } }, clerk: { agent: {} } },
		mockOptions: {
			withoutTools: ({ user }: { user: string }) => {
				if (!user.includes("ALLOW or BLOCK?")) return "SUMMARY-OK";
				reviews.push(user);
				return "ALLOW";
			},
		},
	});
	const asked: any[] = [];
	const answer: { allow: boolean; always?: boolean } = { allow: true };
	h.pine.bus.subscribe("approval/requested", (e) => {
		asked.push(e.payload);
		h.pine.approvals.decide((e.payload as any).id, answer.allow, "test", answer.always === true);
	});
	const use = (calls: Array<[string, Record<string, unknown>?]>, o: Record<string, unknown> = {}) => h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: calls.map(([name, args]) => ({ name: `mcp__computer__${name}`, args: args ?? {} })) }]), trust: "owner", ...o } as any);
	const did = () => fs.readFileSync(log, "utf8").trim().split("\n").filter((l) => l && !/^(start|activate|shot|status)/.test(l));
	return { h, asked, answer, use, did, reviews };
}

test("computer: only the owner's own conversations of an agent that reaches the account get app control", { timeout: 60_000 }, async (t) => {
	const { h, use, did } = await withApps(t);
	const offered = (req: any) => h.toolsOffered(req).filter((n: string) => n.startsWith("mcp__computer__"));
	await use([["apps"]]);
	assert.equal(offered(h.requestsFor("PERSONA-MAIN").at(-1)).length, TOOLS.length, "the owner's conversation with the main agent has it");
	assert.match(h.toolResults().at(-1)!, /^Running apps:\n- TextEdit/);

	// A run that outside content started: the server is not registered, although the agent's profile for such runs lists it.
	await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [{ name: "mcp__computer__app_type", args: { app: "TextEdit", text: "pwned" } }] }]), trust: "untrusted", session: "outside" } as any);
	const outside = h.requestsFor("PERSONA-MAIN").at(-1);
	assert.deepEqual(offered(outside), []);
	assert.ok(h.toolsOffered(outside).includes("read"), "it has what its profile gives it otherwise");
	assert.ok(!/Typed/.test(h.toolResults().at(-1) ?? ""), h.toolResults().at(-1) ?? "");

	// An agent that is kept to its workspace: the same server is in its configuration, and it gets none of it.
	await h.pine.agents.run({ agent: "clerk", prompt: mockMsg([{ tools: [{ name: "mcp__computer__app_type", args: { app: "TextEdit", text: "hello" } }] }]), trust: "owner" } as any);
	const clerk = h.requestsFor("PERSONA-CLERK").at(-1);
	assert.deepEqual(offered(clerk), []);
	const told = 'computer (one tool, "computer"';
	assert.ok(!h.system(clerk).includes(told) && h.system(h.requestsFor("PERSONA-MAIN")[0]).includes(told), "nor is it told about a server it does not have");
	assert.deepEqual(did(), [], "nothing was typed anywhere");
	await h.close();
});

test("computer: the owner is asked once per app in a conversation, and after the yes nothing is asked click by click", { timeout: 60_000 }, async (t) => {
	const { h, asked, answer, use, did, reviews } = await withApps(t);

	// Listing what runs is not asked about. The first call that names an app is, whether it looks or acts.
	await use([["apps"]]);
	assert.equal(asked.length, 0);
	answer.allow = false;
	await use([["app_type", { app: "TextEdit", text: "hello" }]]);
	assert.equal(asked.length, 1);
	assert.ok(asked[0].summary.startsWith('operate the app TextEdit\napp_type {"app":"TextEdit","text":"hello"}'), asked[0].summary);
	assert.ok(asked[0].why.includes("A yes holds for this app in this conversation") && asked[0].remember === "every app", JSON.stringify(asked[0]));
	assert.match(h.toolResults().at(-1)!, /not approved \(test\)\. You may not operate TextEdit in this conversation\. Do not retry/);
	assert.deepEqual(did(), [], "a no means nothing happens in the app");

	// A yes: this call runs, and so does everything after it in that app, without a question.
	answer.allow = true;
	await use([["app_snapshot", { app: "TextEdit" }]]);
	assert.equal(asked.length, 2);
	assert.match(h.toolResults().at(-1)!, /- text area \[ref=e2\]: "Hello"/);
	await use([["app_set_text", { app: "textedit", ref: "e2", text: "Dear Ada" }], ["app_press", { app: "TextEdit", ref: "e3" }], ["app_type", { app: "TextEdit", text: "!" }], ["app_key", { app: "TextEdit", keys: "cmd+s" }], ["app_menu", { app: "TextEdit", path: "File > New" }]]);
	await use([["app_screenshot", { app: "TextEdit" }], ["app_click", { app: "TextEdit", x: 640, y: 400 }]]);
	assert.equal(asked.length, 2, "not asked again");
	assert.deepEqual(did(), ['set e2 "Dear Ada"', "press e3", 'type "!" to=100 front=100', "key cmd+s to=100 front=100", "press m11", "click 420.3,250.3 left x1"]);
	const marks = h.pine.agents.status().sessions.map((s) => `${s.session}: ${s.tainted}`);
	assert.ok(marks.some((m) => /^main: mcp__computer__\w+ returned outside content/.test(m)), `what a window shows is outside content (${marks.join("; ")})`);
	assert.deepEqual(reviews, [], "by now the conversation has read outside content, and no model was asked about an action in the app");

	// Another app: asked. The whole screen: asked, once. The careful note is there now.
	await use([["app_press", { app: "Notes", ref: "e20" }]]);
	assert.equal(asked.length, 3);
	assert.ok(asked[2].summary.startsWith("operate the app Notes") && asked[2].why.includes("Careful: this conversation has read outside content"));
	await use([["app_screenshot"], ["app_screenshot", { screen: 2 }]]);
	assert.equal(asked.length, 4);
	assert.ok(asked[3].summary.startsWith("look at the whole screen") && asked[3].why.includes("shows every app that is open"));

	// Another conversation knows nothing of it. Nor does this one after a reset.
	await use([["app_press", { app: "TextEdit", ref: "e3" }]], { session: "second" });
	assert.equal(asked.length, 5);
	await h.pine.agents.resetSession("main", "main");
	await use([["app_press", { app: "TextEdit", ref: "e3" }]]);
	assert.equal(asked.length, 6);

	// "Always": no question for any app in that conversation any more.
	answer.always = true;
	await use([["app_press", { app: "TextEdit", ref: "e3" }]], { session: "third" });
	assert.equal(asked.length, 7);
	await use([["app_press", { app: "Notes", ref: "e20" }], ["app_screenshot"], ["app_type", { app: "Notes", text: "x" }]], { session: "third" });
	assert.equal(asked.length, 7);
	assert.deepEqual(did().slice(-2), ["press e20", 'type "x" to=200 front=200']);
	assert.deepEqual(reviews, []);
	await h.close();
});

test("computer: bypass asks nothing; an agent in its sandbox has no app control", { timeout: 60_000 }, async (t) => {
	const bypass = await withApps(t, {}, { mode: "bypass" });
	await bypass.use([["app_press", { app: "TextEdit", ref: "e3" }]]);
	assert.equal(bypass.asked.length, 0);
	assert.deepEqual(bypass.did(), ["press e3"]);
	await bypass.h.close();

	// Manual and safe mode work inside the sandbox, and app control lies outside any sandbox: such an agent has none of it.
	for (const mode of ["manual", "safe"]) {
		const boxed = await withApps(t, {}, { mode });
		await boxed.use([["app_press", { app: "TextEdit", ref: "e3" }]]);
		assert.deepEqual(boxed.h.toolsOffered(boxed.h.requestsFor("PERSONA-MAIN").at(-1)).filter((n: string) => n.startsWith("mcp__computer__")), [], mode);
		assert.deepEqual([boxed.asked.length, boxed.did()], [0, []], mode);
		// Switched to auto while it runs, its next message has the tools: the session is made anew.
		boxed.h.pine.agents.setMode("main", "auto");
		await boxed.use([["apps"]]);
		assert.equal(boxed.h.toolsOffered(boxed.h.requestsFor("PERSONA-MAIN").at(-1)).filter((n: string) => n.startsWith("mcp__computer__")).length, TOOLS.length, mode);
		await boxed.h.close();
	}
});
