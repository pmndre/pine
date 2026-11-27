// The workshop (examples/home/views/workshop.ts), pine's second view, without a window: Santa under the roof and
// an elf in a bay of its own kind for each agent, what they do for the work their agents do, presents for tasks
// handed on, sweets for events, and the whole picture drawn in every state on a canvas that only counts. The view is
// loaded as the frame loads it: "pine/view" is pine's src/view-kit.ts, and it is told only what view-state.ts tells it.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { viewStateOf } from "../src/view-state.ts";
import { World } from "../src/view-world.ts";

registerHooks({
	resolve: (spec, ctx, next) => (spec === "pine/view" ? { url: pathToFileURL(path.resolve(import.meta.dirname, "../../src/view-kit.ts")).href, shortCircuit: true } : next(spec, ctx)),
});
const view = await import("../../examples/home/views/workshop.ts");
const { Workshop, nowOf, lookOf, skyAt, setClock, toolSay, sourceSign } = view;
type Workshop = InstanceType<typeof Workshop>;

// A noon, whenever the test runs: at night everybody sleeps.
setClock(() => new Date(2026, 5, 21, 13, 0));

const VIEW = { w: 520, h: 600 };
const names = Array.from({ length: 24 }, (_, i) => `a${String(i).padStart(2, "0")}`);

let id = 1;
const start = Date.now();
const ev = (ms: number, topic: string, payload: any, source = `agent:${payload.agent}`) => ({ id: id++, ts: start + ms, topic, source, payload, trust: "owner" });
const began = (ms: number, task: number, agent: string, more: any = {}) => ev(ms, `agent/${agent}/started`, { task, agent, session: more.session ?? `_t${task}`, root: more.root ?? task, parent: more.parent, depth: more.depth ?? 0, kind: more.kind ?? "prompt", prompt: more.prompt ?? "work" });
const did = (ms: number, task: number, agent: string, what: any) => ev(ms, `agent/${agent}/${what.topic}`, { task, agent, session: `_t${task}`, root: task, depth: 0, ...what });
const ended = (ms: number, task: number, agent: string, more: any = {}) => ev(ms, `agent/${agent}/${more.failed ? "failed" : "done"}`, { task, agent, session: `_t${task}`, root: more.root ?? task, parent: more.parent, depth: more.depth ?? 0, status: more.failed ? "failed" : "done" });

const HOLDINGS = new Map([
	["a00", { servers: ["web", "browser"], skills: ["pine"], sources: [], schedules: ["morning"] }],
	["a01", { servers: ["web"], skills: ["invoices"], sources: [], schedules: ["daily"] }],
]);
/** What the workshop is told of a world, as the panel tells it. */
const told = (world: World, modes?: boolean) => nowOf(viewStateOf(world, { colorOf: (a: string) => ["#3b82f6", "#22a06b", "#f59e0b", "#ec4899"][names.indexOf(a) % 4], holdings: HOLDINGS, dark: Boolean(modes) }));

function building(n = 24, modes = ["safe"]): { world: World; shop: Workshop } {
	const world = new World();
	world.setPlaces(names.slice(0, n).map((a, i) => ({ id: a, main: i === 0, mode: modes[i % modes.length], description: "" })));
	const shop = new Workshop();
	shop.layout(told(world), VIEW);
	shop.sync(told(world), start);
	return { world, shop };
}

/** Runs the workshop from `from` to `to` milliseconds after the start, a frame each 50. */
function run(world: World, shop: Workshop, from: number, to: number, each?: (ms: number) => void): void {
	for (let ms = from; ms <= to; ms += 50) {
		const s = told(world);
		shop.sync(s, start + ms);
		shop.step(s, start + ms, VIEW, { follow: true });
		each?.(ms);
	}
}

test("every agent has a room, one of them is Santa's under the roof, and no two of the first eight bays are the same kind of workshop", () => {
	const { shop } = building();
	const main = shop.rooms.get("a00")!;
	assert.ok(main.main);
	assert.deepEqual([...shop.rooms.keys()].sort(), [...names].sort(), "a room for each agent, and no other");
	assert.deepEqual([...shop.rooms.values()].filter((r) => r.main).map((r) => r.agent), ["a00"], "one of them is Santa's");
	assert.ok(main.screen, "a wide room under the roof has the rail with a stocking for each agent");
	const kinds = names.slice(1, 9).map((n) => shop.rooms.get(n)!.bay % 8);
	assert.equal(new Set(kinds).size, 8, `eight kinds of workshop: ${kinds.join(" ")}`);
	// A bay keeps its kind when an agent is added after it.
	const { shop: small } = building(4);
	for (const n of names.slice(1, 4)) assert.equal(small.rooms.get(n)!.bay, shop.rooms.get(n)!.bay, n);
});

test("every agent's elf looks different, and the same every time", () => {
	const looks = names.map((n) => JSON.stringify(lookOf(n)));
	assert.equal(new Set(looks).size, names.length);
	assert.deepEqual(lookOf("main"), lookOf("main"));
	// More than their names tell them apart: caps, hair, skin and tunics all vary among a few of them.
	for (const key of ["hat", "hair", "skin", "tunic"] as const) assert.ok(new Set(names.map((n) => lookOf(n)[key])).size > 2, key);
});

test("at rest Santa checks his list and an elf sits at its bench, and at night they sleep", () => {
	const { world, shop } = building(3);
	run(world, shop, 0, 500);
	assert.equal(shop.elfOf("a01")!.act, "sit");
	run(world, shop, 550, 9000);
	assert.equal(shop.elfOf("a00")!.act, "list", "Santa, with nothing to do, checks his list");
	setClock(() => new Date(2026, 5, 21, 2, 0));
	run(world, shop, 9050, 9200);
	assert.equal(shop.elfOf("a00")!.act, "sleep", "at night he sleeps in his chair");
	assert.equal(shop.elfOf("a01")!.act, "sleep");
	setClock(() => new Date(2026, 5, 21, 13, 0));
});

test("at work an elf paces, reads, turns the machine, works at the bench, wraps what it made, and jumps to ask", () => {
	const { world, shop } = building(3);
	run(world, shop, 0, 500);
	world.take([began(800, 1, "a01")]);
	run(world, shop, 800, 3000);
	assert.equal(shop.elfOf("a01")!.act, "think", "thinking: it paces its bay");
	world.take([did(3100, 1, "a01", { topic: "tool", phase: "start", tool: "read", subject: "/somewhere/notes.md" })]);
	run(world, shop, 3100, 3300);
	assert.equal(shop.elfOf("a01")!.act, "read", "reading a file: at the shelf");
	world.take([did(3400, 1, "a01", { topic: "tool", phase: "end", tool: "read" }), did(3400, 1, "a01", { topic: "tool", phase: "start", tool: "read", subject: "/home/skills/invoices/SKILL.md" })]);
	run(world, shop, 3400, 3600);
	assert.equal(shop.elfOf("a01")!.act, "skill", "a skill it has: the starred book");
	world.take([did(3700, 1, "a01", { topic: "tool", phase: "end", tool: "read" }), did(3700, 1, "a01", { topic: "tool", phase: "start", tool: "mcp__web__web_search", subject: "what the owner asked" })]);
	run(world, shop, 3700, 3900);
	assert.equal(shop.elfOf("a01")!.act, "rack", "a tool of an MCP server: at the sweet machine");
	world.take([did(4000, 1, "a01", { topic: "tool", phase: "end", tool: "mcp__web__web_search" }), did(4000, 1, "a01", { topic: "tool", phase: "start", tool: "bash", subject: "ls" })]);
	run(world, shop, 4000, 4200);
	assert.equal(shop.elfOf("a01")!.act, "type", "a command: at its bench, with its tool");
	world.take([did(4300, 1, "a01", { topic: "delta", text: "the answer" })]);
	run(world, shop, 4300, 4500);
	assert.equal(shop.elfOf("a01")!.act, "wrap", "writing its answer: it wraps the present");
	world.take([ev(4600, "approval/requested", { id: "q1", agent: "a01", task: 1, root: 1, tool: "send", summary: "send: hello" }, "approvals")]);
	run(world, shop, 4600, 5000);
	assert.equal(shop.elfOf("a01")!.act, "ask");
	assert.equal(shop.youMood?.kind, "asked", "and you, at your counter, are asked");
	assert.ok(shop.tags(told(world), start + 5000).some((t: any) => t.k === "say" && t.say.sign === "ask" && t.say.loud), "its bubble says so, loudly");
	world.take([ended(5100, 1, "a01")]);
	run(world, shop, 5100, 5300);
	assert.equal(shop.elfOf("a01")!.act, "cheer", "done: it is glad for a moment");
});

test("a task handed on is a present that flies, and a line between the bays; a copy is a small elf that goes when the copy ends", () => {
	const { world, shop } = building(3);
	world.take([began(0, 1, "a00")]);
	run(world, shop, 0, 1000);
	world.take([began(1100, 2, "a02", { parent: 1, root: 1, depth: 1, kind: "delegate", prompt: "[task from agent a00]\nCount" })]);
	run(world, shop, 1100, 1300);
	assert.equal(shop.traffic().letters, 1);
	assert.equal(shop.elfOf("a00")!.act, "hand", "Santa holds the present up");
	assert.deepEqual(shop.links(told(world)).map((l: any) => [l.from, l.to]), [["a00", "a02"]]);
	run(world, shop, 1300, 5000);
	assert.equal(shop.traffic().letters, 0, "the present has landed");
	assert.equal(shop.elfOf("a00")!.act, "wait");
	world.take([began(5100, 3, "a02", { parent: 2, root: 1, depth: 2, kind: "subagent", prompt: "look" })]);
	run(world, shop, 5100, 5300);
	assert.deepEqual(shop.elves().filter((r: any) => r.small).map((r: any) => [r.agent, r.work]), [["a02", 3]]);
	world.take([ended(5400, 3, "a02", { parent: 2, root: 1, depth: 2 })]);
	run(world, shop, 5400, 6500);
	assert.equal(shop.elves().filter((r: any) => r.small).length, 0);
	world.take([ended(6600, 2, "a02", { parent: 1, root: 1, depth: 1 })]);
	run(world, shop, 6600, 6700);
	assert.equal(shop.traffic().letters, 1, "the answer flies back");
});

test("an event rides up the chute as a sweet; what is sent out flies to the sleigh on the roof", () => {
	const { world, shop } = building(3);
	const camera = ev(0, "source/camera/motion", { text: "at the door" }, "source:camera");
	world.take([camera]);
	shop.layout(told(world), VIEW);
	world.take([{ ...began(100, 1, "a02", { kind: "event", prompt: "at the door" }), cause: camera.id }]);
	run(world, shop, 100, 200);
	assert.equal(shop.traffic().capsules, 1);
	run(world, shop, 200, 9000);
	assert.equal(shop.traffic().capsules, 0, "it arrived");
	shop.hear({ k: "sent", work: 1, agent: "a02", tool: "send" }, told(world), start + 9100);
	assert.equal(shop.traffic().letters, 1);
});

test("it is winter all year, the day still follows the clock, and a tool of a server is said by both their names", () => {
	for (const month of [0, 3, 6, 9]) assert.equal(skyAt(new Date(2026, month, 15, 12, 0)).season, "winter");
	const [noon, night] = [skyAt(new Date(2026, 5, 21, 13, 0)), skyAt(new Date(2026, 5, 21, 1, 0))];
	assert.ok(noon.day > night.day && night.stars > noon.stars, "day at noon; at night stars, and the northern lights with them");
	assert.ok(toolSay("bash").text.length > 0);
	assert.ok(["browser", "navigate"].every((part) => toolSay("mcp__browser__browser_navigate", "browser").text.includes(part)));
	assert.equal(sourceSign("mail", "source"), "mail");
	assert.equal(view.default.pineView, 1, "the file's default export is the view");
});

// A canvas that draws nothing and takes every call: enough to run all of the drawing and see that none of it throws.
function fakeCanvas(): any {
	const ctx: any = new Proxy(
		{ createPattern: () => ({}), measureText: () => ({ width: 0 }), getImageData: () => ({ data: new Uint8ClampedArray(4) }) },
		{ get: (t: any, k: string) => (k in t ? t[k] : (t[k] = () => undefined)), set: (t: any, k: string, v: unknown) => ((t[k] = v), true) },
	);
	return { width: 1, height: 1, getContext: () => ctx, style: {} };
}

test("the whole picture draws in every state: by day and by night, at rest and at work, every mode, every kind of bay", () => {
	(globalThis as any).document = { createElement: () => fakeCanvas() };
	try {
		const { world, shop } = building(12, ["safe", "manual", "auto", "bypass", "plan"]);
		const ctx = fakeCanvas().getContext();
		let frames = 0;
		const draw = (ms: number) => {
			const s = told(world);
			const whole = shop.whole();
			shop.draw(ctx, s, start + ms, { ox: -40, oy: -40, w: whole.w + 80, h: whole.h + 160, cx: whole.w / 2 }, { selected: { k: "agent", id: "a01" }, hover: { k: "port", id: "you" } });
			assert.ok(shop.tags(s, start + ms).length >= 12, "a plate for each bay");
			frames++;
		};
		const camera = ev(0, "source/camera/motion", { text: "at the door" }, "source:camera");
		world.take([camera]);
		shop.layout(told(world), VIEW);
		run(world, shop, 0, 400, draw);
		world.take([began(500, 1, "a00"), began(500, 2, "a01"), { ...began(500, 3, "a02", { kind: "event", prompt: "x" }), cause: camera.id }, began(500, 4, "a03"), began(520, 9, "a04", { session: "main" }), began(540, 10, "a04", { session: "side" })]);
		world.take([did(600, 2, "a01", { topic: "tool", phase: "start", tool: "mcp__web__web_search", subject: "q" }), did(600, 3, "a02", { topic: "tool", phase: "start", tool: "bash", subject: "ls" }), did(600, 4, "a03", { topic: "delta", text: "the answer" })]);
		world.take([began(700, 5, "a05", { parent: 1, root: 1, depth: 1, kind: "delegate", prompt: "[task from agent a00]\nCount" }), began(700, 6, "a05", { parent: 5, root: 1, depth: 2, kind: "subagent", prompt: "look" })]);
		world.take([ev(800, "approval/requested", { id: "q1", agent: "a02", task: 3, root: 3, tool: "send", summary: "send: hello" }, "approvals")]);
		const s0 = told(world);
		for (const h of [{ k: "skill", work: 2, agent: "a01", skill: "invoices" }, { k: "scheduled", name: "daily", agent: "a01" }, { k: "branched", agent: "a01", conversation: 2, from: 1, worktree: true }, { k: "tool", work: 2, agent: "a01", tool: "mcp__web__web_search", mcp: "web" }, { k: "sent", work: 2, agent: "a01", tool: "send" }, { k: "goal", agent: "a01", status: "met" }, { k: "outside", agent: "a01" }, { k: "event", input: "source:camera" }] as any[]) shop.hear(h, s0, start + 850);
		run(world, shop, 500, 3000, draw);
		world.take([ended(3100, 6, "a05", { parent: 5, root: 1, depth: 2 }), ended(3100, 5, "a05", { parent: 1, root: 1, depth: 1, failed: true }), ended(3100, 4, "a03"), ended(3150, 9, "a04")]);
		run(world, shop, 3100, 6000, draw);
		// The same by night, and at dusk, when the lamps come on and the sky is another.
		for (const hour of [1, 17.5, 7]) {
			setClock(() => new Date(2026, 11, 24, Math.floor(hour), (hour % 1) * 60));
			run(world, shop, 6050, 7000, draw);
		}
		assert.ok(frames > 150, `${frames} frames drawn`);
	} finally {
		setClock(() => new Date(2026, 5, 21, 13, 0));
		delete (globalThis as any).document;
	}
});

test("a board its sub-agents work through shows as pips under the agent's bubble, a sub-agent says it has a task, and a word at the pinboard says what happened", () => {
	const { world, shop } = building(3);
	run(world, shop, 0, 200);
	const board = { id: 7, scope: "conversation" as const, agent: "a01", conversation: 1, open: 5, taken: 2, done: 3, failed: 0, blocked: 0, notes: 4, workers: [2], tasks: [] };
	const s = { ...told(world), boards: [board] };
	const job = (more: object) => ({ id: 1, agent: "a01", copy: false, depth: 0, from: { k: "you" as const }, doing: "waiting" as const, waitingOn: [], started: start, tools: 0, asking: false, held: false, outside: false, branch: false, worktree: false, conversation: 1, ...more });
	const said = view.sayOf(job({}), s, start);
	assert.deepEqual(said.steps, { done: 3, total: 10 });
	assert.ok(said.note, "and a note says that these are a board's");
	// Its own list of steps comes first, and so does who it works for.
	assert.deepEqual(view.sayOf(job({ steps: { done: 1, total: 2 } }), s, start).steps, { done: 1, total: 2 });
	assert.ok(view.sayOf(job({ from: { k: "agent", id: "a00" } }), s, start).note!.includes("a00"), "whom it works for, by name");
	const anyTask = view.sayOf(job({ id: 2, copy: true, doing: "thinking", board: 7 }), s, start).note;
	assert.ok(anyTask && !/\d/.test(anyTask), `a view that is told no tasks still says it has one, without a number: ${anyTask}`);
	// A board whose tasks are all settled says nothing, and neither does another conversation's.
	assert.equal(view.sayOf(job({}), { ...s, boards: [{ ...board, open: 0, taken: 0 }] }, start).steps, undefined);
	assert.equal(view.sayOf(job({ conversation: 2 }), s, start).steps, undefined);
	// A sub-agent that has one of its tasks says which.
	const t = (id: number, st: any, more: object = {}): any => ({ id, state: st, after: [] as number[], ...more });
	const tasks = [t(1, "done"), t(2, "taken", { worker: 2, agent: "a01" }), t(3, "open"), t(4, "blocked"), t(5, "failed"), t(6, "waiting", { after: [3] })];
	const full = { ...board, open: 2, taken: 1, done: 1, failed: 1, blocked: 1, tasks };
	const s2: any = { ...s, boards: [full, { ...board, id: 8, scope: "all" as const, agent: undefined, conversation: undefined, name: "bugs", tasks: [t(1, "open")] }] };
	assert.match(view.sayOf(job({ id: 2, copy: true, doing: "thinking", board: 7 }), s2, start).note!, /\b2\b/, "by the task's number");
	// The board stands in the agent's room while it has work on it, a moment longer when all is done, and then no more.
	assert.equal(shop.boardOf(s2, "a01", start)?.id, 7);
	assert.equal(shop.boardOf(s2, "a00", start), undefined, "a board for all agents hangs in the hall, not in a room");
	const settled: any = { ...s2, boards: [{ ...full, open: 0, taken: 0, blocked: 0, done: 5, tasks: tasks.map((x) => ({ ...x, state: "done" })) }] };
	assert.equal(shop.boardOf(settled, "a01", start + 5000)?.id, 7);
	assert.equal(shop.boardOf(settled, "a01", start + 10_000), undefined);
	// The pointer over it finds it, and the board for all agents is named in the hall.
	const now = start + 300;
	shop.boardOf(s2, "a01", now);
	const room = shop.rooms.get("a01")!;
	assert.deepEqual(shop.hit({ x: room.tasks.x + room.tasks.w / 2, y: room.tasks.y + room.tasks.h / 2 }), { k: "agent", id: "a01", part: "tasks" });
	assert.ok(shop.tags(s2, now).some((x: any) => x.k === "label" && x.text === "bugs"), "the board for all agents is named in the hall");
	// Forty tasks posted at once are one word at the board, not forty; a question and a failure are always said.
	for (let i = 0; i < 40; i++) shop.hear({ k: "board", board: 7, change: "posted", agent: "a01", task: i + 1, state: "open" }, s2, now + i);
	shop.hear({ k: "board", board: 7, change: "removed", agent: "a01" }, s2, now + 2000);
	shop.hear({ k: "board", board: 7, change: "settled", agent: "a01", task: 1, state: "done" }, s2, now + 2000);
	shop.hear({ k: "board", board: 7, change: "settled", agent: "a01", task: 4, state: "blocked" }, s2, now + 2010);
	shop.hear({ k: "board", board: 7, change: "settled", agent: "a01", task: 5, state: "failed" }, s2, now + 2020);
	shop.hear({ k: "board", board: 8, change: "taken", task: 1, state: "taken" }, s2, now + 2030);
	const words = shop.tags(s2, now + 2030).filter((x: any) => x.k === "float").map((x: any) => x.text);
	assert.equal(words.length, 5, `one word for the forty, none for the removal, one for each of the rest: ${words.join(" | ")}`);
	assert.equal(new Set(words).size, 5, "and each says something else");
	assert.equal(shop.hotAt.get("tasks:a01"), now + 2020);
	assert.equal(shop.hotAt.get("notice:8"), now + 2030);
});
