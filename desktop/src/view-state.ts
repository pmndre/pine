// What a view of the owner's is told about pine (src/view-kit.ts): the page's picture of it (view-world.ts)
// with everything that could be private taken out. This is the one place that decides it, field by field,
// by building the view's state anew from an allow-list, never by copying the page's and deleting things.
//
// A view is told: the agents by name, color and mode, and the names of their MCP servers, skills,
// sources and schedules; each piece of work's agent, where it came from (you, the clock, a source or
// another agent, by name), what it does, the name of the tool it is in, whether it asks you, the mode
// it runs in and whether its conversation read outside content; the ways in by name and type and who
// listens to each; the schedules by name, when they run and whom they wake; each agent's conversations
// as numbers (which is a branch of which, which works in a worktree, which has a goal, which has a swarm and
// how that stands: a state, the round, whether its answer is being checked), the skill a piece
// of work reads if its agent has it, and how far its to-do list is; the boards by number, whom each is
// for, its name if it has one, how many of its tasks are in which state, and which work has one; of a task
// its number, its state, who posted it (an agent's name or "you"), when, how many notes are about it and whether
// it asked; of a piece of work its last tool calls by the tools' names, with how long each took and how it went.
// Never: a prompt, a task's text, what stands on a board, an answer, an error's text, a tool's arguments or subject (a path, a
// command), a question's text, a conversation's name, a folder, a model, a secret, or what an event said.
import type { ViewAgent, ViewBoard, ViewConversation, ViewHappening, ViewInput, ViewSchedule, ViewState, ViewTarget, ViewWork } from "../../src/view-kit.ts";
import { ENDED, type From, type Job, type TalkNews, type World } from "./view-world.ts";

/** What an agent has, as the daemon's detail of it says (`holdings`): only the names are taken. */
export interface Holdings {
	servers: string[];
	skills: string[];
	sources: string[];
	schedules: string[];
}

const NARROW_TO_WIDE = ["manual", "plan", "safe", "auto", "bypass"];
const stricter = (a: string, b: string) => NARROW_TO_WIDE.indexOf(a) >= 0 && NARROW_TO_WIDE.indexOf(a) < NARROW_TO_WIDE.indexOf(b);
const names = (list: unknown) => (Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, 200) : []);
/** A tool's name as it is, if it looks like one: letters, digits, "_" and "-". */
const toolName = (t: string | undefined) => (t && /^[A-Za-z0-9_-]{1,80}$/.test(t) ? t : undefined);
/** The MCP server of a tool an MCP server provides (`mcp__<server>__<tool>`). */
const mcpOf = (t: string | undefined) => /^mcp__([A-Za-z0-9_-]+?)__/.exec(t ?? "")?.[1];

function from(f: From): ViewWork["from"] {
	switch (f.k) {
		case "you":
			return { k: "you" };
		case "clock":
			return f.name ? { k: "clock", name: f.name } : { k: "clock" };
		case "source":
			return { k: "source", name: f.name };
		case "outside":
			return { k: "outside", name: f.name };
		case "agent":
			return { k: "agent", id: f.id };
		case "copy":
			return { k: "copy", id: f.id };
		case "pine":
			return { k: "pine" };
	}
}

/** How a schedule was set, if it is one of the three forms pine words it in: a cron line, an interval, a time. Never free text. */
const WHEN = [
	// A cron line: five or six fields of numbers and signs, or names of three letters (MON-FRI).
	/^(?:(?:[0-9*/,\-?LW#]+|[A-Za-z]{3}(?:[-,][A-Za-z]{3})*)(?: |$)){5,6}$/,
	/^every \d+(?:\.\d+)? ?[a-z]{1,8}(?: \d+ ?[a-z]{1,8}){0,2}$/,
	/^once, at [0-9][0-9: -]{7,20}$/,
];
const whenText = (w: string | undefined) => {
	const t = /"([^"]{1,40})"/.exec(w ?? "")?.[1] ?? w;
	return t && WHEN.some((re) => re.test(t)) ? t : undefined;
};

/** An agent's conversations as a view knows them: numbers and shape. At most forty. */
function conversations(world: World, agent: string): ViewConversation[] {
	return world.talksOf(agent).slice(0, 40).map((t) => {
		const room = world.rooms.get(`${agent}:${t.session}`);
		const goal = world.goals.get(`${agent}:${t.session}`)?.status;
		// A swarm: one of five words and three numbers. Never the job, and never pine's line about it.
		const sw = world.swarms.get(`${agent}:${t.session}`);
		const swarm = sw ? { status: sw.status, round: sw.round, until: sw.until, checking: sw.status === "active" && sw.checking !== undefined } : undefined;
		return { id: t.n, main: t.main, ...(t.branchOf !== undefined ? { branchOf: world.talkId(agent, t.branchOf) } : {}), worktree: t.worktree, busy: Boolean(room?.busy), outside: Boolean(room?.outside), ...(goal ? { goal } : {}), ...(swarm ? { swarm } : {}) };
	});
}

/** What a task's state is called when pine says one changed. */
const TASK_STATES = ["open", "taken", "blocked", "done", "failed"];

/** A board's name as it is, if it is what pine makes of one: lowercase letters, digits, "-" and "_". */
const boardName = (n: string) => (/^[a-z0-9_-]{1,40}$/.test(n) ? n : undefined);

/** The boards as a view knows them: numbers. Those with work on them first. */
function boards(world: World): ViewBoard[] {
	return world.boards
		.map((b) => {
			const name = boardName(b.name);
			const agent = b.scope !== "global" && world.places.has(b.agent) ? b.agent : undefined;
			const talk = b.scope === "local" && agent && world.talks.has(`${agent}:${b.session}`) ? world.talkId(agent, b.session) : undefined;
			return {
				id: b.id,
				scope: b.scope === "global" ? ("all" as const) : b.scope === "agent" ? ("agent" as const) : ("conversation" as const),
				...(name ? { name } : {}),
				...(agent ? { agent } : {}),
				...(talk !== undefined ? { conversation: talk } : {}),
				open: b.counts.open, taken: b.counts.taken, done: b.counts.done, failed: b.counts.failed, blocked: b.counts.blocked, notes: b.counts.notes,
				workers: b.runs.filter((r) => world.jobs.has(r)),
				// Each task: a number, one of six words, the numbers it comes after, and the work that has it.
				tasks: b.tasks.map((t) => {
					const job = t.run !== undefined ? world.jobs.get(t.run) : undefined;
					// Who posted it is said only as a name the view knows already: an agent of pine's, or "you".
					const by = t.by === "owner" ? "you" : world.places.has(t.by) ? t.by : undefined;
					return {
						id: t.id, state: t.state, after: t.after,
						...(job ? { worker: job.id, ...(world.places.has(job.agent) ? { agent: job.agent } : {}) } : {}),
						...(by ? { by } : {}),
						...(t.created ? { posted: t.created - world.skew } : {}),
						...(t.updated ? { since: t.updated - world.skew } : {}),
						notes: t.notes,
						...(t.asked ? { asked: t.asked } : {}),
						outside: t.outside,
					};
				}),
			};
		})
		.sort((a, b) => b.taken + b.open + b.blocked - (a.taken + a.open + a.blocked) || a.id - b.id);
}

function work(world: World, j: Job, holdings: Map<string, Holdings>): ViewWork {
	const talk = world.talkOf(j);
	const goal = talk ? world.goals.get(`${talk.agent}:${talk.session}`) : undefined;
	const skill = j.skill && holdings.get(j.agent)?.skills.includes(j.skill) ? j.skill : undefined;
	const mode = world.modeOf(j);
	const own = world.places.get(j.agent)?.mode;
	const tool = j.doing === "tool" ? toolName(j.tool) : undefined;
	const page = (t: number) => t - world.skew;
	const board = world.boards.find((b) => b.runs.includes(j.id))?.id;
	// Its part in a swarm: the sub-agent that checks the answer is the one the swarm names; the lead is a turn of the conversation's own.
	const sw = talk ? world.swarms.get(`${talk.agent}:${talk.session}`) : undefined;
	const part = !sw || sw.status !== "active" || ENDED.includes(j.doing) ? undefined : sw.checking === j.id ? ("check" as const) : j.depth === 0 && j.kind !== "subagent" ? ("lead" as const) : undefined;
	return {
		id: j.id,
		agent: j.agent,
		copy: j.kind === "subagent",
		...(j.parent !== undefined ? { parent: j.parent } : {}),
		depth: j.depth,
		from: from(j.from),
		doing: j.doing,
		...(tool ? { tool } : {}),
		...(mcpOf(tool) ? { mcp: mcpOf(tool) } : {}),
		waitingOn: [...j.waitingOn],
		started: page(j.started),
		...(j.finished !== undefined ? { finished: page(j.finished) } : {}),
		tools: j.tools,
		// Its last calls by the tool's name, never what a call was about.
		calls: j.calls.flatMap((c) => {
			const name = toolName(c.tool);
			return name ? [{ tool: name, ...(mcpOf(name) ? { mcp: mcpOf(name) } : {}), at: page(c.at), ...(c.ms !== undefined ? { ms: c.ms, ok: c.ok !== false } : {}) }] : [];
		}),
		// Waiting for an approval, or its questions open (the work itself has ended: a question holds nothing up).
		asking: (Boolean(j.ask) && !ENDED.includes(j.doing)) || world.asksOpen(j),
		...(mode ? { mode } : {}),
		held: Boolean(mode && own && stricter(mode, own)),
		outside: Boolean(world.outside(j)),
		...(talk ? { conversation: talk.n } : {}),
		branch: Boolean(talk?.branchOf !== undefined),
		worktree: Boolean(talk?.worktree),
		...(skill ? { skill } : {}),
		...(j.steps ? { steps: { done: j.steps.done, total: j.steps.total } } : {}),
		...(goal && goal.status === "active" && j.depth === 0 && !ENDED.includes(j.doing) ? { round: goal.round } : {}),
		...(board !== undefined && !ENDED.includes(j.doing) ? { board } : {}),
		...(part ? { swarm: part } : {}),
	};
}

/** pine as a view sees it. */
export function viewStateOf(world: World, o: { colorOf: (agent: string) => string; holdings: Map<string, Holdings>; selected?: ViewTarget; dark: boolean; focused?: boolean }): ViewState {
	const agents: ViewAgent[] = world.agents().map((a) => {
		const h = o.holdings.get(a.id);
		return { id: a.id, main: a.main, color: o.colorOf(a.id), mode: a.mode, mcp: names(h?.servers), skills: names(h?.skills), sources: names(h?.sources), schedules: names(h?.schedules), conversations: conversations(world, a.id) };
	});
	const inputs: ViewInput[] = world.inputs().map((s) => ({ id: s.id, kind: s.kind, name: s.name, ...(s.type ? { type: s.type } : {}), count: s.count, ...(s.last !== undefined ? { last: s.last - world.skew } : {}), agents: [...(world.sourceInfo.get(s.id)?.agents ?? [])], failing: Boolean(world.sourceInfo.get(s.id)?.failing) }));
	const page = (t: number | undefined) => (t !== undefined ? t - world.skew : undefined);
	const schedules: ViewSchedule[] = world.schedules
		.slice(0, 200)
		.map((s) => ({ name: s.name, ...(world.places.has(s.scope) ? { agent: s.scope } : {}), ...(whenText(s.when) ? { when: whenText(s.when) } : {}), ...(s.next !== undefined ? { next: page(s.next) } : {}), ...(s.last !== undefined ? { last: page(s.last) } : {}) }))
		.sort((a, b) => (a.next ?? Infinity) - (b.next ?? Infinity) || a.name.localeCompare(b.name));
	const selected = o.selected && ("agent" in o.selected ? { agent: o.selected.agent } : "work" in o.selected ? { work: o.selected.work } : { board: o.selected.board, ...(o.selected.task !== undefined ? { task: o.selected.task } : {}) });
	return { at: Date.now(), agents, work: [...world.jobs.values()].map((j) => work(world, j, o.holdings)), inputs, schedules, boards: boards(world), ...(selected ? { selected } : {}), dark: o.dark, focused: o.focused !== false };
}

/** What a batch of the daemon's events means to a view, once the world has taken it: who started, ended, used what. */
export function happeningsOf(batch: Array<{ topic: string; payload: any; source?: string }>, world: World, holdings: Map<string, Holdings>): ViewHappening[] {
	const out: ViewHappening[] = [];
	for (const e of batch) {
		const p = e.payload ?? {};
		const [ns, who, kind] = e.topic.split("/");
		if (ns === "source" && who) out.push({ k: "event", input: `source:${who}` });
		else if (e.source === "timer") {
			const sc = typeof p.name === "string" ? world.schedules.find((x) => x.name === p.name) : undefined;
			out.push({ k: "event", input: "clock" }, { k: "scheduled", ...(sc ? { name: sc.name } : {}), ...(sc && world.places.has(sc.scope) ? { agent: sc.scope } : {}) });
		}
		else if (e.topic === "pine/board" && typeof p.board === "number" && ["posted", "taken", "released", "settled", "removed"].includes(p.change)) out.push({ k: "board", board: p.board, change: p.change, ...(typeof p.agent === "string" && world.places.has(p.agent) ? { agent: p.agent } : {}), ...(p.kind === "task" && typeof p.item === "number" ? { task: p.item, ...(TASK_STATES.includes(p.state) ? { state: p.state } : {}) } : {}) });
		else if (e.topic === "approval/requested" && typeof p.task === "number") out.push({ k: "asked", work: p.task, agent: String(p.agent ?? "") });
		else if (e.topic === "question/asked" && p.at === 0 && typeof p.task === "number") out.push({ k: "asked", work: p.task, agent: String(p.agent ?? "") });
		else if (e.topic === "approval/decided") out.push({ k: "decided", allowed: p.allow === true });
		if (ns === "agent" && kind === "swarm" && typeof p.session === "string" && world.places.has(who)) {
			const w = world.swarms.get(`${who}:${p.session}`);
			const t = world.talks.get(`${who}:${p.session}`);
			if (w) out.push({ k: "swarm", agent: who, ...(t ? { conversation: t.n } : {}), status: w.status, checking: w.status === "active" && w.checking !== undefined });
			continue;
		}
		if (ns === "agent" && kind === "goal" && typeof p.session === "string" && world.places.has(who)) {
			const g = world.goals.get(`${who}:${p.session}`);
			const t = world.talks.get(`${who}:${p.session}`);
			if (g) out.push({ k: "goal", agent: who, ...(t ? { conversation: t.n } : {}), status: g.status });
			continue;
		}
		if (ns !== "agent" || typeof p.task !== "number") continue;
		const j = world.jobs.get(p.task);
		if (!j) continue;
		if (kind === "todos") {
			if (j.steps) out.push({ k: "steps", work: j.id, agent: j.agent, done: j.steps.done, total: j.steps.total });
			continue;
		}
		if (kind === "steered") {
			out.push({ k: "said", work: j.id, agent: j.agent });
			continue;
		}
		const parent = j.parent !== undefined ? world.jobs.get(j.parent) : undefined;
		if (kind === "started") {
			out.push({ k: "started", work: j.id, agent: j.agent });
			if (j.kind === "subagent") out.push({ k: "copied", work: j.id, agent: j.agent });
			else if (parent && parent.agent !== j.agent) out.push({ k: "handed", work: j.id, from: parent.agent, to: j.agent });
		} else if (kind === "done" || kind === "failed") {
			out.push({ k: "ended", work: j.id, agent: j.agent, failed: j.doing === "failed" });
			if (parent && parent.agent !== j.agent && j.kind !== "subagent") out.push({ k: "answered", work: j.id, from: j.agent, to: parent.agent });
		} else if (kind === "tool" && p.phase === "start") {
			const tool = toolName(String(p.tool ?? ""));
			if (!tool) continue;
			// A skill is read from its SKILL.md: named only when it is one the agent has, so a path never leaks.
			const skill = tool === "read" ? /\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/.exec(String(p.subject ?? ""))?.[1] : undefined;
			if (skill && holdings.get(j.agent)?.skills.includes(skill)) out.push({ k: "skill", work: j.id, agent: j.agent, skill });
			else out.push({ k: "tool", work: j.id, agent: j.agent, tool, ...(mcpOf(tool) ? { mcp: mcpOf(tool) } : {}) });
			if (tool === "send" || tool === "publish_event") out.push({ k: "sent", work: j.id, agent: j.agent, tool });
		} else if (kind === "tool" && p.phase === "end") {
			const tool = toolName(String(p.tool ?? ""));
			if (tool) out.push({ k: "toolEnded", work: j.id, agent: j.agent, tool, ok: p.ok !== false });
		}
	}
	return out;
}

/** What changed about conversations between two looks at them (`World.setConversations`), as a view hears it. */
export const talkHappenings = (news: TalkNews[]): ViewHappening[] => news.map((n) => (n.k === "branched" ? { k: "branched", agent: n.agent, conversation: n.conversation, ...(n.from !== undefined ? { from: n.from } : {}), worktree: n.worktree } : { k: "worktree", agent: n.agent, conversation: n.conversation, made: n.made }));

/** Whether something a view asks the panel to show or open is one the panel knows: a target from the frame is checked, not trusted. */
export function knownTarget(world: World, t: unknown): ViewTarget | undefined {
	if (!t || typeof t !== "object") return undefined;
	const x = t as Record<string, unknown>;
	if (typeof x.agent === "string" && world.places.has(x.agent)) return { agent: x.agent };
	if (typeof x.work === "number" && world.jobs.has(x.work)) return { work: x.work };
	const board = typeof x.board === "number" ? world.boards.find((b) => b.id === x.board) : undefined;
	if (board) return { board: board.id, ...(typeof x.task === "number" && board.tasks.some((t) => t.id === x.task) ? { task: x.task } : {}) };
	return undefined;
}
