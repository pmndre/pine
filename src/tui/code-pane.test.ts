import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { PineTui } from "./app.ts";
import { Client } from "./client.ts";
import { diffLines } from "./code-pane.ts";
import { harness, mockMsg, sleep, until } from "../../testing/harness.ts";
import { FakeTerminal } from "../../testing/terminal.ts";
import { sandboxAvailable } from "../security.ts";

const mac = { skip: !sandboxAvailable() };

const call = (name: string, args: any) => ({ name, args });

const CTRL_G = "\x07";

/** A project folder somewhere in the account, outside every agent's reach until it is opened for a conversation. */
function project(t: { after(fn: () => void): void }, repo = true): string {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(), ".pine-test-project-")));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	fs.mkdirSync(path.join(dir, "src"));
	fs.writeFileSync(path.join(dir, "notes.txt"), "PROJECT-NOTES\n");
	fs.writeFileSync(path.join(dir, "src", "app.ts"), "export const answer = 41;\nexport const name = \"app\";\n");
	if (repo) {
		const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { stdio: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
		git("init", "-q", "-b", "main");
		git("add", ".");
		git("commit", "-q", "-m", "first");
	}
	return dir;
}

const apps: PineTui[] = [];

after(async () => {
	for (const app of apps) await app.stop().catch(() => {});
});

test("code pane: diff lines are colored and the lines that only name the file are left out", () => {
	const lines = diffLines("diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-old\n+new\n same\n\\ No newline at end of file\n");
	assert.deepEqual(lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "")), ["@@ -1,2 +1,2 @@", "-old", "+new", " same", "\\ No newline at end of file"]);
});

test("tui: the code pane shows changes, files and tool output; the folder is set from the bar and with pine <folder>", mac, async (t) => {
	const dir = project(t);
	const second = project(t, false);
	const h = await harness({ pine: { main: "main", http: { port: 0 } }, agents: { main: {} } });
	const term = new FakeTerminal(130, 36);
	const client = new Client(`http://127.0.0.1:${h.pine.http!.port}`, h.pine.token);
	let chosen: string | undefined = second;
	const app = new PineTui({ client, terminal: term, mode: "test", cwd: dir, chooseFolder: async () => chosen });
	apps.push(app);
	await app.start();
	const text = () => app.screen().join("\n");
	const sees = (what: string | RegExp, ms = 4000) => until(() => (typeof what === "string" ? text().includes(what) : what.test(text())), ms, `the screen to show ${what}\n--- screen ---\n${text()}`);
	const send = async (line: string) => {
		term.type(line);
		term.type(["\r"]);
		await sleep(15);
	};
	const click = async (needle: string, nth = 1) => {
		await sees(needle);
		const lines = app.screen();
		const rows = lines.map((l, i) => (l.includes(needle) ? i : -1)).filter((i) => i >= 0);
		const y = rows[Math.min(nth, rows.length) - 1];
		term.click(lines[y].lastIndexOf(needle) + 1, y);
		await sleep(15);
	};

	// pine <folder>: a conversation of the main agent, named after the folder, that works there.
	await app.openFolder(dir);
	const name = path.basename(dir).replace(/^\.+/, "").slice(0, 24).replace(/[-.]+$/, "");
	await sees(`2 main·${name.slice(0, 16)}`);
	await sees(`works in ~/${path.basename(dir)}`);
	assert.deepEqual(await client.folders("main"), [{ session: name, folder: dir }]);
	await app.openFolder(dir);
	assert.equal((text().split("\n")[0].match(/main·/g) ?? []).length, 1, "the same folder again opens the same conversation, not another");
	assert.match(app.screen().at(-1)!, new RegExp(`main · ${name} · ~/${path.basename(dir).replace(/\./g, "\\.")} · mock/m`), "the bar at the bottom names the folder");

	// The agent changes a file there; the pane lists it and shows the diff.
	await send(mockMsg([{ tools: [call("bash", { command: "printf 'export const answer = 42;\\n' > src/app.ts; echo BUILD-OUTPUT-LINE" })] }, { text: "changed" }]));
	await sees("changed");
	assert.ok(!text().includes("Changes"), "closed until it is asked for");
	await click("▤ code");
	await sees(/Changes\s+Files\s+Output/);
	await sees(/M src\/app\.ts\s+\+1 −2/);
	await sees(/main · 1 changed/);
	assert.ok(text().includes("│") && text().includes("ECHO") === false && text().includes("changed"), "the conversation stays beside it");
	await click("src/app.ts");
	await sees("+export const answer = 42;");
	assert.ok(text().includes("-export const answer = 41;") && text().includes("‹ back · src/app.ts"));

	// It follows what the agent does: the next change is there without asking.
	await send(mockMsg([{ tools: [call("bash", { command: "printf 'export const answer = 43;\\n' > src/app.ts" })] }, { text: "again" }]));
	await sees("+export const answer = 43;");
	await click("‹ back");
	await sees(/M src\/app\.ts/);

	// Files: a tree that opens on a click, and a file with its text.
	await click(" Files ");
	await sees("▸ src/");
	await sees(/notes\.txt 14 B/);
	await click("▸ src/");
	await sees(/app\.ts 2\d B/);
	await click("app.ts");
	await sees(/1 export const answer = 43;/);
	await click("‹ back");

	// Output: every tool call of the conversation, with all it printed.
	await click(" Output ");
	await sees(/✓ bash printf 'export const answer = 42/);
	await sees(/2 tool calls/);
	await click("answer = 42");
	await sees("BUILD-OUTPUT-LINE");

	// Closed with the same button, with ctrl+g and with /code; it is remembered for the next start.
	const paneOpen = () => /Changes\s+Files\s+Output/.test(text());
	await click("▤ code");
	await until(() => !paneOpen());
	term.type([CTRL_G]);
	await until(paneOpen);
	await until(async () => (await client.tabs()).code === true);
	await send("/code off");
	await until(() => !paneOpen());
	await sleep(30);
	assert.equal((await client.tabs()).code, false);
	await send("/code files");
	await sees("▾ src/");

	// The folder menu: no folder, where pine was started, folders in use, or one that is picked.
	await click(`~/${path.basename(dir)}`, 99);
	await sees(`Folder for main·${name}`);
	await sees(/No folder\s+main's own workspace/);
	await click("Pick a folder");
	await sees(`this conversation now works in ~/${path.basename(second)}`);
	await sees(/This folder is not in a git|notes\.txt 14 B/);
	assert.equal(h.pine.agents.folderOf("main", name), second);
	await send("/folder none");
	await sees("works in main's own workspace again");
	assert.match(app.screen().at(-1)!, new RegExp(`main · ${name} · no folder · mock/m`));
	await send(`/folder ${h.home}`);
	await sees("the folder was not changed: that is pine's own folder");
	chosen = undefined;
	// A folder dropped on the terminal is opened; a file dropped there is attached, as before.
	term.paste(dir);
	await sees(`this conversation now works in ~/${path.basename(dir)}`);
	term.paste(path.join(dir, "notes.txt"));
	await sees(/attached: notes\.txt/);
	await send("/detach");

	// In a narrow terminal the pane takes the whole width.
	await app.stop();
	const narrow = new PineTui({ client, terminal: new FakeTerminal(70, 24), mode: "test" });
	apps.push(narrow);
	await narrow.start();
	await until(() => /M src\/app\.ts/.test(narrow.screen().join("\n")), 4000, `the pane to be open again\n${narrow.screen().join("\n")}`);
	assert.ok(!narrow.screen().join("\n").includes("earlier in this session"), "only the pane, where both do not fit");
	await narrow.stop();
	await h.close();
});
