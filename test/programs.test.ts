import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { elapsed, grouped, msysRows, windowsGroups } from "../src/programs.ts";
import { sandboxAvailable } from "../src/security.ts";
import { PineTui } from "../src/tui/app.ts";
import { Client } from "../src/tui/client.ts";
import { programName, since } from "../src/util.ts";
import { harness, mockMsg, notesOf, sleep, until } from "./support/harness.ts";
import { FakeTerminal } from "./support/terminal.ts";

const owner = { trust: "owner" as const };
const mac = { skip: !sandboxAvailable() };
/** Without a sandbox an agent of the owner's works with the owner's account (auto), as on Windows today: programs are found the same way. */
const windows = process.platform === "win32";
const everywhere = { skip: !sandboxAvailable() && !windows };
const call = (name: string, args: any) => ({ name, args });
/** A program that stays: the way an agent starts a development server and returns. */
const leave = (seconds: number) => `nohup sleep ${seconds} >/dev/null 2>&1 &`;

const apps: PineTui[] = [];
after(async () => {
	for (const app of apps) await app.stop().catch(() => {});
});

test("programs: how one is named and how long it has run", () => {
	assert.deepEqual(["00:07", "12:30", "01:02:03", "2-00:00:01"].map(elapsed), [7, 750, 3723, 172801]);
	assert.equal(programName("node /Users/x/project/node_modules/.bin/vite --port 5173 --host"), "vite --port 5173 --host");
	assert.equal(programName("/usr/bin/python3 -m http.server 8000"), "python3 -m http.server 8000");
	assert.equal(programName("sleep 60"), "sleep 60");
	assert.equal(programName('"C:\\Program Files\\Git\\usr\\bin\\sleep.exe" 301'), "sleep 301");
	assert.equal(programName('"C:\\Program Files\\nodejs\\node.exe" C:\\work\\node_modules\\.bin\\vite.js --port 5173'), "vite.js --port 5173");
	assert.equal(programName(`node ${"a".repeat(100)}`, 20).length, 20);
	assert.deepEqual([5, 61, 3600, 7800].map(since), ["5 s", "1 min", "1 h", "2 h 10 min"]);
});

test("programs: on Windows a program belongs to the shell it descends from, also once that shell has gone", () => {
	const row = (pid: number, parent: number, seconds: number) => ({ pid, parent, seconds, command: String(pid), group: 0 });
	// 10 is a noted shell that has gone; 20 its child; 21 a grandchild; 30 a shell still there with child 31;
	// 50 names 60 as its parent, but 60 is younger than 50: another process that got the old number. 70 is nobody's.
	const rows = grouped([row(20, 10, 100), row(21, 20, 90), row(30, 1, 50), row(31, 30, 40), row(60, 1, 5), row(50, 60, 30), row(70, 1, 1000)], new Set([10, 30, 60]));
	const groups = Object.fromEntries(rows.map((r) => [r.pid, r.group]));
	assert.deepEqual(groups, { 20: 10, 21: 10, 30: 30, 31: 30, 60: 60, 50: 0, 70: 0 });
});

test("programs: on Windows a command's programs are its group among Git's processes, and what they started outside them", () => {
	// Git's ps: the shell 2803 (Windows 9060) led group 2803 and has gone; its sleep is still in it; 4000 is another group.
	const ps = ["      PID    PPID    PGID     WINPID   TTY         UID    STIME COMMAND", "     2810       1    2803      7100  ?         197121 02:43:01 /usr/bin/sleep", "I    4000       1    4000      7200  pty0      197121   Nov 19 /usr/bin/bash", "     2811       1    2803      7300  ?         197121 02:43:02 /c/Program Files/nodejs/node"].join("\n");
	const msys = msysRows(ps);
	assert.deepEqual(msys, [{ pid: 2810, pgid: 2803, win: 7100 }, { pid: 4000, pgid: 4000, win: 7200 }, { pid: 2811, pgid: 2803, win: 7300 }]);
	// CIM: the same processes by their Windows ids, and one that node started (7400), and one of nobody's (7500).
	const row = (pid: number, parent: number, seconds: number, command: string) => ({ pid, parent, seconds, command, group: 0 });
	const cim = [row(7100, 9060, 30, "sleep 301"), row(7200, 1, 9000, "bash"), row(7300, 9060, 30, "node -e server"), row(7400, 7300, 20, "node worker"), row(7500, 1, 5, "other")];
	// The group was noted by the shell's own number: the shell has gone, and what it left is found, with what that started.
	const left = windowsGroups(msys, cim, new Set([2803]));
	assert.deepEqual(left.map((r) => [r.pid, r.group]).sort(), [[7100, 2803], [7300, 2803], [7400, 2803]]);
	assert.equal(left.find((r) => r.pid === 7300)!.command, "node -e server", "named by CIM's command line");
	assert.deepEqual(windowsGroups(msys, cim, new Set([4100])), [], "a group nobody is in");
	// While the shell is there, the group is found, the shell by its noted number, the rest by Windows' ids.
	const live = windowsGroups([...msys, { pid: 2803, pgid: 2803, win: 9060 }], [...cim, row(9060, 1, 31, "bash -c server")], new Set([2803]));
	assert.deepEqual(live.map((r) => [r.pid, r.group]).sort(), [[2803, 2803], [7100, 2803], [7300, 2803], [7400, 2803]]);
	// A background command's shell is noted by its Windows id, which the daemon got when it started it.
	const job = windowsGroups([...msys, { pid: 2803, pgid: 2803, win: 9060 }], [...cim, row(9060, 1, 31, "bash -c WATCH")], new Set([9060]));
	assert.deepEqual(job.map((r) => [r.pid, r.group]).sort(), [[7100, 9060], [7300, 9060], [7400, 9060], [9060, 9060]]);
});

test("programs: what a command leaves running is listed for its conversation, the agent is told, and the owner or the agent stops it", everywhere, async (t) => {
	// The agent as pine ships it: with the owner's account, so that a server of its own can listen.
	const h = await harness({ pine: { defaults: { mode: undefined }, http: { port: 0 } }, agents: { main: {} } });
	const list = (session = "main") => h.pine.agents.programsOf("main", session);
	t.after(() => {
		for (const session of ["main", "other"]) for (const p of list(session)) h.pine.agents.stopProgram("main", session, p.id);
	});
	const run = (steps: any[], session?: string) => h.pine.agents.run({ agent: "main", prompt: mockMsg(steps), ...(session ? { session } : {}), ...owner });
	const server = `nohup ${process.execPath.replace(/\\/g, "/")} -e "require('http').createServer().listen(0, '127.0.0.1')" >/dev/null 2>&1 &`;

	// A command that ends leaves nothing; one that puts a program into the background leaves that.
	await run([{ tools: [call("bash", { command: "echo done" })] }]);
	assert.deepEqual(list(), []);
	await run([{ tools: [call("bash", { command: server })] }, { tools: [call("bash", { command: leave(301) })] }]);
	await until(() => list().length === 2 && list().some((p) => p.ports.length === 1), 5000, "both programs, one of them listening").catch((e) => {
		// What was noted and what was found, to see where it went wrong on a system of its own (Windows).
		const dir = path.join(h.home, "data", "programs");
		const noted = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => `${f}: ${fs.statSync(path.join(dir, f)).isFile() ? fs.readFileSync(path.join(dir, f), "utf8").trim() : "(folder)"}`) : [];
		const probe = h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("bash", { command: "echo pid=$$; cat /proc/$$/winpid; echo; tr '\\0' ' ' < /proc/$$/cmdline | head -c 800" })] }]), ...owner });
		return probe.then(() => {
			throw new Error(`${e.message}\nnoted: ${noted.join(" | ")}\nlisted: ${JSON.stringify(list())}\nresults: ${h.toolResults().join(" | ").slice(0, 600)}\nnote: ${h.pine.agents.programs.note("main:main")}`);
		});
	});
	const [web, sleeper] = [list().find((p) => p.ports.length)!, list().find((p) => !p.ports.length)!];
	assert.ok(web.command.includes("createServer") && web.ports[0] > 0 && (web.processes === 1 || windows), JSON.stringify(web));
	// (Windows' command line names the program by its path, in quotes: "...\sleep.exe" 301.)
	assert.ok(/sleep(\.exe")? 301/.test(sleeper.command), JSON.stringify(sleeper));
	assert.deepEqual(list("other"), [], "another conversation has none of it");

	// The agent knows without looking, and has a tool for it.
	await run([{ tools: [call("stop_program", {})] }, { tools: [call("stop_program", { id: sleeper.id }), call("stop_program", { id: 1 })] }]);
	const note = notesOf(h.mock.state.requests.at(-1)).join("\n");
	assert.ok(note.includes("Programs your commands left running") && note.includes("sleep 301") && note.includes(`port ${web.ports[0]}`) && note.includes(`(id ${sleeper.id})`), note);
	const out = h.toolResults().slice(-3);
	assert.ok(out[0].includes(`id ${web.id}`) && out[0].includes("sleep 301"), out[0]);
	assert.match(out[1], new RegExp(`Stopped the program ${sleeper.id}`));
	assert.match(out[2], /there is no running program with the id 1/);
	await until(() => list().length === 1, 5000, "the stopped one to be gone");

	// The owner's side: the control API lists and stops, and only what belongs to that conversation.
	const base = `http://127.0.0.1:${h.pine.http!.port}`;
	const headers = { authorization: `Bearer ${h.pine.token}`, "content-type": "application/json" };
	const got = (await (await fetch(`${base}/agents/main/programs?session=main`, { headers })).json()) as any[];
	assert.deepEqual(got.map((p) => p.id), [web.id]);
	assert.equal((await fetch(`${base}/agents/main/programs?session=main`)).status, 401);
	const stop = async (session: string, id: number) => ((await (await fetch(`${base}/agents/main/programs/stop`, { method: "POST", headers, body: JSON.stringify({ session, id }) })).json()) as any).stopped;
	assert.equal(await stop("other", web.id), false, "not through another conversation");
	assert.equal(await stop("main", process.pid), false, "and nothing that no command of the conversation started");
	assert.equal(await stop("main", web.id), true);
	await until(() => list().length === 0, 5000, "the server to be gone");

	// Resetting a conversation stops what it left running.
	await run([{ tools: [call("bash", { command: leave(302) })] }], "other");
	await until(() => list("other").length === 1);
	await h.pine.agents.resetSession("main", "other");
	await until(() => list("other").length === 0, 5000, "the program of the reset conversation to be gone");
	await h.close();
});

test("tui: the code pane lists what the agent left running and stops it on a click", mac, async (t) => {
	// With the owner's account, as pine ships the main agent. (In the workspace sandbox Linux ends
	// what a command leaves behind together with the command; see security.md, "On Linux".)
	const h = await harness({ pine: { main: "main", defaults: { mode: undefined }, http: { port: 0 } }, agents: { main: {} } });
	t.after(() => {
		for (const p of h.pine.agents.programsOf("main", "main")) h.pine.agents.stopProgram("main", "main", p.id);
	});
	const term = new FakeTerminal(130, 36);
	const client = new Client(`http://127.0.0.1:${h.pine.http!.port}`, h.pine.token);
	const app = new PineTui({ client, terminal: term, mode: "test" });
	apps.push(app);
	await app.start();
	const text = () => app.screen().join("\n");
	const sees = (what: string | RegExp, ms = 5000) => until(() => (typeof what === "string" ? text().includes(what) : what.test(text())), ms, `the screen to show ${what}\n--- screen ---\n${text()}`);
	const send = async (line: string) => {
		term.type(line);
		term.type(["\r"]);
		await sleep(15);
	};
	const click = async (needle: string) => {
		await sees(needle);
		const lines = app.screen();
		const y = lines.findIndex((l) => l.includes(needle));
		term.click(lines[y].lastIndexOf(needle) + 1, y);
		await sleep(15);
	};

	await send("/code running");
	await until(() => app.state().pane, 5000, "the pane to open");
	assert.deepEqual(await client.programs("main", "main"), []);
	await send(mockMsg([{ tools: [call("bash", { command: leave(303) })] }, { text: "started" }]));
	await until(async () => (await client.programs("main", "main")).length === 1, 8000, "the program that was left running");
	// It follows what the agent does, like the other views.
	await sees("● sleep 303");
	await sees(/running for \d+ s/);
	await click("■ stop");
	await until(async () => (await client.programs("main", "main")).length === 0, 6000, "the program to be stopped");
	await until(() => !text().includes("● sleep 303"), 5000, "its line to go");
	await h.close();
});
