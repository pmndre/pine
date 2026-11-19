import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { sandboxAvailable, sandboxKind } from "../security.ts";
import { harness, mockMsg, sleep, until, refused } from "../../testing/harness.ts";

const owner = { trust: "owner" as const };

const call = (name: string, args: any) => ({ name, args });

// A followed command needs a sandbox that confines it while it runs.
const MARK = `pine-follow-test-${process.pid}`;

// The file's name is what tells this test's command from any other: bash hands over to tail, and tail's arguments are all that is left.
const running = () => spawnSync("/bin/ps", ["-axww", "-o", "command="]).stdout.toString().split("\n").filter((l) => l.includes(MARK)).length;

const here = { skip: !sandboxAvailable() || sandboxKind() === "linux" };

test("command, followed: every line it prints is an event as it comes, in the agent's sandbox", here, async () => {
	const h = await harness({
		pine: { sources: { log: { type: "command", run: `tail -n 0 -F ${MARK}.log`, follow: true, start: "always" }, errors: { type: "command", run: `tail -n 0 -F ${MARK}.log`, follow: true, match: "ERROR (\\w+)", start: "always" }, away: { type: "command", run: "cat ../agent.json", follow: true, start: "always" } } },
		agents: { main: { files: { [`${MARK}.log`]: "old line\n" } } },
	});
	const events = (name: string): any[] => h.pine.bus.query({ topic: `source/${name}/#` }).sort((a: any, b: any) => a.id - b.id);
	const info = (name: string) => h.pine.sources.list().find((s) => s.name === name)!;
	const log = path.join(h.workspace("main"), `${MARK}.log`);
	await until(() => /^running since \d\d:\d\d:\d\d, 0 lines reported$/.test(info("log").status ?? ""), 4000, "the command to run");
	await sleep(300);
	assert.equal(events("log").length, 0, "what was there before is not reported");

	fs.appendFileSync(log, 'started\n{"state": "FINISH", "layer": 12}\n\x1b[31mERROR disk\x1b[0m full\n');
	await until(() => events("log").length === 3 && events("errors").length === 1, 6000, "the lines");
	assert.deepEqual(events("log").map((e: any) => [e.topic, e.payload.line, e.payload.value, e.trust]), [
		["source/log/line", "started", undefined, "untrusted"],
		["source/log/line", '{"state": "FINISH", "layer": 12}', { state: "FINISH", layer: 12 }, "untrusted"],
		// Colors of a terminal are not text.
		["source/log/line", "ERROR disk full", undefined, "untrusted"],
	]);
	assert.deepEqual(events("errors").map((e: any) => [e.payload.line, e.payload.value]), [["ERROR disk full", "disk"]]);
	assert.match(info("log").status!, /^running since \d\d:\d\d:\d\d/);
	// The sandbox of the agent's shell: pine's own files are not read, and the command ends saying so.
	await until(() => events("away").some((e: any) => e.topic.endsWith("/ended")), 6000, "the refused command to end");
	assert.equal(events("away").filter((e: any) => e.topic.endsWith("/line")).length, 0);
	assert.match(events("away")[0].payload.error, /Operation not permitted/);
	// Stopped with the source: nothing is left running.
	assert.ok(running() > 0);
	await h.close();
	await until(() => running() === 0, 3000, "the followed command to be gone");
});

test("command, followed: one that ends is started again, and one that ends at once is not reported over and over", here, async () => {
	const h = await harness({
		pine: { sources: { once: { type: "command", run: "echo one; echo two; exit 3", follow: true, start: "always" }, loud: { type: "command", run: "i=0; while [ $i -lt 200 ]; do echo line $i; i=$((i+1)); done; sleep 30", follow: true, perMinute: 5, start: "always" } } },
		agents: { main: {} },
	});
	const events = (name: string): any[] => h.pine.bus.query({ topic: `source/${name}/#` }).sort((a: any, b: any) => a.id - b.id);
	// Started again after it ended: its lines come a second time.
	await until(() => events("once").filter((e: any) => e.payload.line === "one").length >= 2, 6000, "the second run");
	const ended = events("once").filter((e: any) => e.topic.endsWith("/ended"));
	assert.deepEqual(ended.map((e: any) => [e.payload.code, e.payload.ran]), [[3, 0]], "said once, although it has ended more than once");
	assert.match(h.pine.sources.list().find((s) => s.name === "once")!.status!, /^(running since|ended at \d\d:\d\d:\d\d with exit 3, starting it again)/);
	// A command that talks all the time: the cap holds, and the rest is counted.
	await until(() => events("loud").length >= 5, 4000, "the first lines");
	await sleep(200);
	assert.equal(events("loud").length, 5);
	await h.close();
});

test("command, followed, by asking: the owner sees that it will keep running; what cannot work is said before anyone is asked", here, async () => {
	const h = await harness({ agents: { main: {} } });
	const asked: any[] = [];
	h.pine.bus.subscribe("approval/requested", (e) => {
		asked.push(e.payload);
		h.pine.approvals.decide((e.payload as any).id, true, "test");
	});
	const add = (name: string, options: any) => call("add_source", { name, type: "command", description: "x", options });
	await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [add("a", { run: "tail -F x.log", follow: true, every: "1m" }), add("b", { run: "df -h", perMinute: 5 }), add("c", { run: "tail -F x.log", follow: true, perMinute: 0 }), add("log", { run: "tail -n0 -F x.log", follow: true, match: "ERROR" })] }]), ...owner });
	const out = h.toolResults();
	assert.match(out[0], /runs all the time: leave "every" and "timeout" out/);
	assert.match(out[1], /"perMinute" is for a command that is followed/);
	assert.match(out[2], /"perMinute" is a number from 1 to 600/);
	assert.match(out[3], /Added the event source "log" \(command\)\. It runs from now on/);
	assert.equal(asked.length, 1);
	assert.match(asked[0].summary, /It will: start this command and keep it running, unattended, with the rights of main's shell \(its sandbox\): tail -n0 -F x\.log; report every line it prints in which \/ERROR\/ finds something, at most 30 a minute; start it again whenever it ends\./);
	await h.close();
});

const mac = { skip: !sandboxAvailable() };

test("command: runs like the agent's own shell, reports what changed in what it prints and how it ends", mac, async () => {
	const h = await harness({
		files: { ".env": "PINE_TEST_SECRET=do-not-leak-me\n" },
		agents: {
			main: {
				agent: {
					sources: {
						state: { type: "command", run: "cat state.txt", every: "40ms", start: "always" },
						flag: { type: "command", run: "test -f flag", every: "40ms", start: "always" },
						used: { type: "command", run: "cat state.txt; echo ' 81% used'", match: "([0-9]+)% used", every: "40ms", start: "always" },
						// Everything it prints is the value, so that the test can read it in the event.
						nosy: { type: "command", run: 'cat "$HOME/../../.env" 2>&1; echo "home=$HOME"; (echo x > "$HOME/../../pine.json") 2>&1; cat state.txt', match: "([\\s\\S]+)", every: "40ms", start: "always" },
						slow: { type: "command", run: "sleep 5", timeout: "150ms", every: "40ms", start: "always" },
					},
				},
				files: { "state.txt": "alpha\nbeta\n" },
			},
		},
	});
	const ws = h.workspace("main");
	const events = (name: string): any[] => h.pine.bus.query({ topic: `source/${name}@main/#` }).sort((a: any, b: any) => a.id - b.id);
	const info = (name: string) => h.pine.sources.list().find((s) => s.name === name)!;
	await until(() => ["state", "flag", "used", "nosy"].every((n) => /^last looked/.test(info(n).status ?? "")), 6000, "the first runs");
	await sleep(150);
	assert.equal(h.pine.bus.query({ topic: "source/#" }).length, 0, "the first run is the starting point");
	assert.match(info("state").status!, /exit 0, 2 lines$/);
	assert.match(info("flag").status!, /exit 1, 0 lines$/);
	assert.match(info("used").status!, /exit 0, now: 81$/);

	fs.writeFileSync(path.join(ws, "state.txt"), "alpha\ngamma\n");
	fs.writeFileSync(path.join(ws, "flag"), "");
	await until(() => events("state").length === 1 && events("flag").length === 1 && events("nosy").length === 1, 4000, "the changes");
	assert.deepEqual(events("state")[0].payload, { command: "cat state.txt", code: 0, added: ["gamma"], removed: ["beta"] });
	assert.deepEqual(events("flag")[0].payload, { command: "test -f flag", code: 0, previousCode: 1, added: [], removed: [] });
	assert.equal(events("state")[0].trust, "untrusted");
	await sleep(150);
	assert.equal(events("state").length + events("used").length, 1, "what the pattern finds did not change, so that one stays quiet");
	assert.ok(events("used").length === 0 && events("nosy")[0].payload.previous.includes("beta"));

	// The same walls as the agent's shell: pine's secrets and configuration are closed, the network too, and its home is not the owner's.
	const out = fs.readFileSync(path.join(h.home, "pine.json"), "utf8");
	assert.ok(out.includes("defaults"), "pine.json was not overwritten");
	const nosy = events("nosy")[0].payload.value as string;
	assert.ok(!nosy.includes("do-not-leak-me") && nosy.split(refused).length === 3 && nosy.includes(`home=${path.join(h.home, "sandbox", "main")}`) && nosy.endsWith("gamma"), nosy);
	// One that hangs is stopped, and the source says so instead of piling runs up.
	await until(() => /failing since .*it took longer than 0\.15 s/.test(info("slow").status ?? ""), 4000, "the timeout");
	await h.close();
});
