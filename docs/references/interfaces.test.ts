// The recipe in docs/references/interfaces.md, as it is written there: an agent that follows the
// manual gets a page whose clicks wake it. The server is the manual's own text, started here;
// pine listens to it with a `stream` source like any other.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { harness, mockMsg, until } from "../../testing/harness.ts";

const doc = fs.readFileSync(path.join(import.meta.dirname, "interfaces.md"), "utf8");
const block = (lang: string) => doc.match(new RegExp(`\`\`\`${lang}\\n([\\s\\S]*?)\\n\`\`\``))![1];
const freePort = () =>
	new Promise<number>((resolve) => {
		const s = net.createServer();
		s.listen(0, "127.0.0.1", () => {
			const p = (s.address() as net.AddressInfo).port;
			s.close(() => resolve(p));
		});
	});

test("a page as a user interface: the manual's server passes on what its page reports, and the click wakes the conversation that listens", async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pine-interface-"));
	const port = await freePort();
	assert.ok(block("js").includes("const PORT = 4173;") && doc.includes("http://127.0.0.1:4173/events"), "the steps and the server name the same port");
	fs.writeFileSync(path.join(dir, "server.mjs"), block("js").replace("const PORT = 4173;", `const PORT = ${port};`));
	fs.writeFileSync(path.join(dir, "index.html"), block("html"));
	const state = doc.match(/`state\.json` for it is `(\{.*?\})`/)![1];
	fs.writeFileSync(path.join(dir, "state.json"), state);
	const server = spawn(process.execPath, [path.join(dir, "server.mjs")], { stdio: ["ignore", "pipe", "pipe"] });
	t.after(() => (server.kill(), fs.rmSync(dir, { recursive: true, force: true })));
	const at = `http://127.0.0.1:${port}`;
	await until(() => fetch(`${at}/state`).then((r) => r.ok, () => false), 5000, "the manual's server answers");
	// What it serves: the page, and the state the page draws (which is what the agent writes).
	assert.equal(await (await fetch(`${at}/`)).text(), block("html"));
	assert.deepEqual(await (await fetch(`${at}/state`)).json(), JSON.parse(state));
	assert.equal(JSON.parse(state).cells.length, 9);
	// The page puts text on itself as text.
	assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(block("html")));

	const h = await harness({ agents: { main: {} } });
	t.after(() => h.close());
	const asked: any[] = [];
	h.pine.bus.subscribe("approval/requested", (e) => (asked.push(e.payload), void h.pine.approvals.decide((e.payload as any).id, true, "test")));
	// Step 4 of the manual, as it says it.
	const r = await h.pine.agents.run({ agent: "main", session: "game", trust: "owner", prompt: mockMsg([{ tools: [{ name: "add_source", args: { name: "board", type: "stream", description: "what my owner presses on the board", options: { url: `${at}/events` }, note: "Your owner plays O. Make your move as X.", throttle: "0s" } }] }, { text: "GAME-ON" }]) } as any);
	assert.equal(r.status, "done");
	assert.equal(asked.length, 1, "the owner is asked once");
	assert.match(asked[0].summary, /stay connected to http:\/\/127\.0\.0\.1:\d+\/events \(an address on your own network or this computer\)/);
	await until(() => /connected/.test(h.pine.sources.list().find((s: any) => s.name === "board")?.status ?? ""), 5000, "pine listens to the page's server");

	// The owner presses the middle cell: the page reports it to its server (step 6).
	const before = h.mock.state.requests.length;
	assert.equal((await fetch(`${at}/event`, { method: "POST", body: JSON.stringify({ cell: 4 }) })).status, 204);
	await until(() => h.mock.state.requests.length > before, 8000, "the click woke the agent");
	const woken = h.mock.state.requests.at(-1).body.messages;
	const said = JSON.stringify(woken.at(-1).content);
	// In the conversation the page was made in, as an event and not as the owner's words, with what was pressed.
	assert.ok(JSON.stringify(woken).includes("GAME-ON"), "the same conversation");
	assert.ok(said.includes("Your note for this subscription: Your owner plays O. Make your move as X.") && said.includes("this did not come from your owner") && /\\"cell\\": 4/.test(said), said.slice(-500));
	assert.match(h.pine.agents.status().sessions.find((s: any) => s.session === "game")?.tainted ?? "", /an event from the source "board"/);

	// The next click comes at once, as in a game: with the manual's `throttle: "0s"` it wakes the agent too.
	const second = h.mock.state.requests.length;
	await fetch(`${at}/event`, { method: "POST", body: JSON.stringify({ cell: 0 }) });
	await until(() => h.mock.state.requests.slice(second).some((req: any) => /\\"cell\\": 0/.test(JSON.stringify(req.body.messages.at(-1).content))), 8000, "a second click right after the first woke the agent as well");
	assert.ok(doc.includes('`throttle: "0s"`'), "the manual says how");
});

test("a subscription says how long it ignores a source after an event, and a click in that time wakes nobody", async (t) => {
	// What happened before the manual said `throttle: "0s"`: every second move of a game was lost, and the agent could not tell why.
	const h = await harness({ pine: { http: { port: 0 }, sources: { board: { type: "webhook", open: true, description: "what my owner presses" } } }, agents: { main: {} } });
	t.after(() => h.close());
	const subscribe = async (session: string, more: Record<string, unknown> = {}) => {
		await h.pine.agents.run({ agent: "main", session, trust: "owner", prompt: mockMsg([{ tools: [{ name: "subscribe", args: { source: "board", note: "Make your move.", ...more } }] }, { text: "ok" }]) } as any);
		return h.toolResults()[0] as string;
	};
	// Two conversations listen to the same source: one as an agent subscribes when it is told nothing more, one with "0s".
	const said = await subscribe("slow");
	assert.match(said, /After an event has woken you, further events of this source are ignored for 10 seconds \(the throttle[^)]*\)\. They are not kept for later\. Where every event counts \(each click on a page, each move in a game\), subscribe again with throttle "0s"\./);
	const fast = await subscribe("fast", { throttle: "0s" });
	assert.ok(fast.startsWith("Subscribed to board (local)") && !fast.includes("are ignored for"), fast);
	const woken = (session: string) => h.pine.tasks.list({ agent: "main", session, limit: 50 }).filter((x: any) => x.event).length;
	// Two clicks, one right after the other.
	for (const cell of [1, 2]) h.pine.bus.publish("source/board/received", { body: { cell } }, { source: "source:board" });
	await until(() => woken("fast") === 2, 5000, 'with "0s" both clicks woke the conversation');
	await until(() => woken("slow") === 1, 5000, "the first click woke the other conversation");
	await new Promise((r) => setTimeout(r, 300));
	assert.equal(woken("slow"), 1, "the second click, a moment later, woke nobody there, and is not made up for");
	// Both clicks are in the event log all the same: that is where a click that was not answered is found.
	assert.equal(h.pine.bus.query({ topic: "source/board/#", limit: 10 }).length, 2);
});
