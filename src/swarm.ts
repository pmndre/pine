import type { AgentManager } from "./agents.ts";
import { asksAtEnd, type BoardItem, verdictOf } from "./boards.ts";
import type { Task } from "./types.ts";
import { errText, type Logger } from "./util.ts";

/**
 * A swarm: the owner gives a conversation a job with /swarm, and its agent leads it: a job too
 * large for one it hands out to sub-agents on the conversation's board, answers what they ask,
 * and puts the result together; a small one it does itself. What makes it more than a prompt
 * is done here, by the daemon, each time the lead ends a turn:
 *
 * - Tasks on the board that are not done: the lead is called again. A swarm does not end with
 *   work lying open because the lead forgot it.
 * - Everything done and the lead has answered: pine puts a check of that answer on the board and
 *   has it done itself, by a sub-agent that did none of the work. What is checked is the answer
 *   the owner reads, against the request and against what was left: a check inside the lead's own
 *   call looked at the pieces before the answer was written, and a slip made while putting them
 *   together would pass it. The lead has no turn for this: when the check passes, the swarm is
 *   done. When it fails, the lead is called to put it right, and its new answer is checked once more.
 *
 * No model is asked whether the job is done: the board says so.
 *
 * Who may do what, as for a goal (src/goals.ts):
 * - Only the owner starts, pauses, resumes or clears a swarm, through the control API. No tool
 *   reaches it: an agent cannot make itself a swarm or give itself more rounds.
 * - It belongs to the owner's side of a conversation. A run started from outside ("~u") has none.
 * - What calls the lead again is the owner's objective and fixed text of pine's with numbers of
 *   tasks: never a word of the lead's answer, of a sub-agent's result or of what a check found
 *   (the lead reads that from the board, where it carries the mark of the run that wrote it). The
 *   check pine posts holds the lead's answer, as a task on the board with the mark of the lead's
 *   run, which is how any task the lead writes itself reaches a sub-agent.
 */

export type SwarmStatus = "active" | "waiting" | "done" | "paused" | "limit";

export interface Swarm {
	agent: string;
	/** The conversation, by its session key. */
	session: string;
	/** The job, in the owner's words. */
	objective: string;
	status: SwarmStatus;
	/** The lead's turn it is in, or ended in. The first is the owner's own message with the job. */
	round: number;
	/** The round after which it stops by itself. */
	until: number;
	set: number;
	/** The lead's turn that pine started and that waits or runs. */
	task?: number;
	/** The sub-agent that checks the lead's answer right now. */
	checking?: number;
	/** The newest post of the conversation's board when the swarm began: what came after is the swarm's. */
	since: number;
	/** Checks of the lead's answer that pine had made. */
	checks: number;
	/** What the owner said while the swarm worked: answers to the lead's questions, and messages of their own. For the check: a value they gave is given, not made up. */
	told?: Array<{ asked: string; said: string }>;
	/** What happened last, in pine's words. */
	note: string;
}

/** How often pine has the lead's answer checked: once, and once more after a check that failed. */
export const MAX_CHECKS = 2;

/** What goes after the owner's job in the first message. Fixed text. */
const START = [
	"[pine: your owner started a swarm for the request above. You lead it: sub-agents do the work on this conversation's board, you plan, hand out, answer what they ask and put the result together. When you have answered, pine has your answer checked against the request by a sub-agent that did none of the work.",
	"1. Look first, briefly: how large is the job, what are its pieces, and what do all of them have to go by? Read what settles that (a spec, a list of the files, one example).",
	"   A job you can do yourself in a few steps (a question, a change in a few files, a short report from a handful of files): do it yourself, now, and answer. Not when your owner's request says to use sub-agents: then you hand it out the way they said, however small it is. Everything larger you hand out, and do none of its pieces yourself.",
	"2. Hand out a larger job in ONE call of subagent:",
	'   - "tasks": one piece each, self-contained: what to do, which files are its own (by path), what it leaves alone, what done means. Split what is too much for one (many files, many items) or what can be written side by side, into pieces that are each real work: several small files can be one piece.',
	'   - "stages" instead of "tasks" when pieces build on others (first the base, then what uses it): a list of lists. Pieces that do not need each other go into the same stage, where they are done side by side.',
	'   - "note": what all of them go by, in full: values, names, formats, and every decision that two pieces have to agree on (an interface, how a value is held). Sub-agents cannot talk to each other: the note is what makes their pieces fit. What is the same for every piece is said here once, and each task is then a line or two that names its piece.',
	'   - "check": rarely. It puts a second sub-agent behind every single piece, so it doubles the work: only when each piece is something written under rules that a second look catches (a text of a set length, a file in a set form). What fails is done again and checked again by itself. Never for pieces that only read and report.',
	'   No "verify": the check of the whole is pine\'s, and comes after your answer.',
	"   A piece that is another agent's (delegate lists them: its files and what it knows are its own) goes to that agent with delegate, in the same answer as the subagent call. pine puts it on the board for you: do not post it yourself.",
	"   A value the job needs that is given nowhere (a rate, a date, which of two readings): ask your owner with question before you hand the job out. Do not tell the sub-agents to leave it out.",
	'3. When the call comes back before all is done (a sub-agent asked or failed, or it had started as many as one call starts): answer what was asked with board_answer (what only your owner can know, ask them with question), then call subagent with "pool": true and nothing else to go on.',
	"4. Read what came back. A piece that came back wrong, and work that turned up on the way, you hand out again.",
	"5. Then answer your owner, in full and in the form they asked for: the result first, then what is still open. Write it once and clean, with every part of what was asked in it: this answer is what gets checked. Do not end by asking whether to do more.",
	"pine calls you again while tasks on the board are not done, and when the check of your answer found something.]",
].join("\n");

/** The first message of a swarm: the job as the owner typed it, and pine's fixed frame. */
export const startPrompt = (objective: string) => `${objective}\n\n${START}`;

const numbers = (xs: BoardItem[]) => xs.slice(0, 12).map((t) => `#${t.id}`).join(", ") + (xs.length > 12 ? ` and ${xs.length - 12} more` : "");
const job = (objective: string) => `\n\nThe job, in your owner's words:\n${objective}`;

/** What calls the lead again. The owner's objective, fixed text of pine's, and numbers of tasks: nothing a model wrote. */
export const continuePrompts = {
	goOn: (objective: string) => `[pine: the swarm goes on. Do what is left of the job (hand out what is too much for one, in one call of subagent), and then answer your owner in full.]${job(objective)}`,
	unfinished: (objective: string, open: BoardItem[], blocked: BoardItem[]) =>
		`[pine: the swarm is not finished. ${open.length ? `Not done on the board: ${numbers(open)}. Call subagent with "pool": true to have them worked${blocked.length ? "" : ", or remove a task that is no longer needed (board_remove with its id)"}. ` : ""}${blocked.length ? `Waiting for an answer: ${numbers(blocked)}. Answer each with board_answer (board_read shows the question; what only your owner can know, ask them with question), then call subagent with "pool": true. ` : ""}When all are done, give your owner the answer in full.]${job(objective)}`,
	failed: (objective: string, id: number) =>
		`[pine: your answer was checked by a sub-agent that did none of the work, and the check did not pass. What it found is on the board: read it with board_read and id ${id}. A slip in your answer (a name left out or there twice, a number copied wrong, a part that is missing) you correct yourself; work that is wrong you hand out again with subagent. What it found that is a matter of taste, or that you can show to be right, you leave, and say so in a line. Then give your owner the whole answer again, as it now stands: it takes the place of the one before, and is checked once more.]${job(objective)}`,
};

/** The report as it is, up to what a long task holds: cut in the middle, a check would call what was left out missing. */
const excerpt = (text: string, head = 6000, tail = 6000) => (text.length > head + tail ? `${text.slice(0, head)}\n[... ${text.length - head - tail} characters left out here: not missing from the report ...]\n${text.slice(-tail)}` : text);

/** The check of the lead's answer that pine posts when everything on the board is done. */
export const checkTask = (objective: string, answer: string, told: Array<{ asked: string; said: string }> = []) =>
	[
		"Check the answer below before the one who asked for it relies on it. You did none of the work, and you change nothing.",
		"First compare it with what was asked, part by part: is everything that was asked for there, in the form that was asked for, and nothing left out? Then do not take its word for it: look at what was left (open the files it names, run what can be run, count again, compare with the source), as far as it takes to be sure. A list you check both ways: every entry on it is true, and nothing that belongs on it is missing. What one command can check in full (a list against the files, a count, a sum), check in full; only where that is not possible, check the parts that matter most and a few picked at random. Tests that pass show only what they test: where the job was to find or fix faults, read the code yourself against what its comments and names say it does, for a fault that is still there.",
		"Say what is wrong or missing and where, one line each; then end your answer with one word on a line of its own: PASS when the answer is right and complete, FAIL when it is not. FAIL is for what can be pointed at: a wrong fact or number, a rule that is broken, a part that is missing, an item that a list has twice or that is in two lists of which it can only be in one. What is a matter of taste, of wording or of how the answer is laid out is a remark, not a FAIL: a result that is given once with explanations and once more in the form that was asked for is laid out that way, not there twice. So is how the work was done (who did which part, in how many steps) where the result does not depend on it. What you cannot check because you cannot reach it (another agent's files, a system outside) is no FAIL either: say what you could not check, and judge by what you can. You judge the answer, not what the job was about: a job that was to find faults and found them all is PASS.",
		"",
		"What was asked, in the owner's words:",
		objective,
		"",
		// What the owner said on the way belongs to what was asked: a value they gave is not one the answer made up.
		...(told.length ? ["What the owner said while the work was done. It is given, like the request: an answer that goes by it is right to.", ...told.map((x) => (x.asked ? `- Asked: ${x.asked}\n  The owner answered: ${x.said}` : `- The owner wrote: ${x.said}`)), ""] : []),
		"The answer:",
		excerpt(answer.trim()) || "(nothing)",
	].join("\n");

/** What the sub-agent that does the check is given: the task, and how its answer ends. */
export const checkPrompt = (item: BoardItem) => `${item.text}\n\n[pine: this is task #${item.id} of a board, and it is a check. You start in the folder the work was done in: the files the answer names are there, under the paths it gives, so look there and nowhere else. Your final answer is the check's result. First what you found, one line each. Then the last line of your answer is one word and nothing else: PASS or FAIL. FAIL only for something you found wrong and can point at. Something you could not check is not that: say what it was, and go by what you could check.]`;

/** What a UI calls the sub-agent that does it. */
const CHECK_LABEL = "checks the answer against what you asked";

type Manager = Pick<AgentManager, "cfg" | "kv" | "tasks" | "bus" | "boards" | "goals" | "submit" | "cancel" | "taintOf" | "startBoardTask" | "retrying" | "resolveModel">;

export class Swarms {
	private m: Manager;
	private log: Logger;
	private key: (session: string) => string;
	/** True while this class submits a message itself: that one is the swarm's, not the owner speaking. */
	private starting = false;

	constructor(manager: Manager, log: Logger, sessionKey: (session: string) => string) {
		this.m = manager;
		this.log = log;
		this.key = sessionKey;
	}

	private id(agent: string, session: string): string {
		return `swarm:${agent}:${session}`;
	}

	private conversation(agent: string, session: string): string {
		if (!this.m.cfg.agents[agent]) throw new Error(`unknown agent "${agent}"`);
		if (session.endsWith("~u")) throw new Error("this conversation holds what came from outside; a swarm is started in a conversation of your own");
		const key = this.key(session);
		if (key === "new") throw new Error("a swarm needs a conversation that stays: give it a name");
		return key;
	}

	/** The swarm of a conversation, if it has one. */
	get(agent: string, session: string): Swarm | undefined {
		if (session.endsWith("~u")) return undefined;
		return this.m.kv.get<Swarm>(this.id(agent, this.key(session))) ?? undefined;
	}

	private save(swarm: Swarm, event: string): Swarm {
		this.m.kv.set(this.id(swarm.agent, swarm.session), swarm);
		this.tell(swarm, event);
		return swarm;
	}

	/** For whoever shows the conversation: where the swarm stands and what just happened. */
	private tell(swarm: Swarm, event: string): void {
		this.log.info(`swarm of ${swarm.agent}/${swarm.session}: ${swarm.note}`);
		this.m.bus.publish(`agent/${swarm.agent}/swarm`, { ...swarm, event }, { source: "pine" });
	}

	private rounds(): number {
		return this.m.cfg.limits.swarmRounds;
	}

	/** The tasks of the conversation's board that came with this swarm. */
	private tasksOf(swarm: Swarm): BoardItem[] {
		const board = this.m.boards.find("local", swarm.agent, swarm.session, "");
		return board ? this.m.boards.items(board.id, { kind: "task", after: swarm.since }) : [];
	}

	/** Start a swarm on a job. Reached from the control API only. */
	set(agent: string, session: string, wanted: string): Swarm {
		const key = this.conversation(agent, session);
		const objective = String(wanted ?? "").trim();
		if (!objective) throw new Error("a swarm needs a job: say what is to be done");
		if (objective.length > 4000) throw new Error("the job of a swarm is at most 4000 characters: put the details into a file and name the file");
		if (!this.m.cfg.agents[agent].subagents.enabled) throw new Error(`${agent} has no sub-agents (subagents.enabled is off), and a swarm is made of them`);
		if (this.m.goals.get(agent, key)?.status === "active") throw new Error("this conversation works on a goal. /goal clear first, or start the swarm in another conversation");
		// The model the answer is checked on has to be there before the work starts, not when it is over.
		if (this.m.cfg.defaults.checker) {
			try {
				this.m.resolveModel(this.m.cfg.defaults.checker);
			} catch (e) {
				throw new Error(`the answer of a swarm is checked on ${this.m.cfg.defaults.checker} (defaults.checker), and ${errText(e)}. Set another model there, or none`);
			}
		}
		const board = this.m.boards.find("local", agent, key, "");
		const since = board ? this.m.boards.last(board.id) : 0;
		let task: Task;
		this.starting = true;
		try {
			task = this.m.submit({ agent, session: key, kind: "prompt", trust: "owner", priority: 10, prompt: startPrompt(objective) });
		} finally {
			this.starting = false;
		}
		this.end(agent, key);
		const until = this.rounds();
		return this.save({ agent, session: key, objective, status: "active", round: 1, until, set: Date.now(), task: task.id, since, checks: 0, note: `started: ${agent} leads it` }, "set");
	}

	/** No further rounds until the owner says so. A round that is running ends by itself, and so does a check of the answer. */
	pause(agent: string, session: string): Swarm {
		const swarm = this.get(agent, this.conversation(agent, session));
		if (!swarm) throw new Error("this conversation has no swarm");
		if (swarm.status !== "active" && swarm.status !== "waiting") throw new Error(`the swarm is not at work (${swarm.note})`);
		return this.halt(swarm, "paused", "paused by you. /swarm resume goes on");
	}

	/** Go on with a swarm that stopped. */
	resume(agent: string, session: string): Swarm {
		const swarm = this.get(agent, this.conversation(agent, session));
		if (!swarm) throw new Error("this conversation has no swarm: /swarm <what is to be done> starts one");
		if (swarm.status === "active") throw new Error("the swarm is at work already");
		const tasks = this.tasksOf(swarm);
		const open = tasks.filter((t) => t.state === "open" || t.state === "taken");
		const blocked = tasks.filter((t) => t.state === "blocked");
		// A check of the answer that ended while the swarm was stopped has said what there is to say.
		const last = open.length || blocked.length ? undefined : this.lastCheck(tasks);
		if (last?.passed) return this.save({ ...swarm, status: "done", task: undefined, checking: undefined, note: `done after ${plural(swarm.round)}: ${this.how(swarm)}, and the answer was checked` }, "done");
		const round = swarm.round + 1;
		const until = round > swarm.until ? swarm.round + this.rounds() : swarm.until;
		const next = { ...swarm, status: "active" as const, round, until, checking: undefined };
		const prompt = open.length || blocked.length ? continuePrompts.unfinished(swarm.objective, open, blocked) : last && swarm.checks < MAX_CHECKS ? continuePrompts.failed(swarm.objective, last.item.id) : continuePrompts.goOn(swarm.objective);
		const task = this.next(next, prompt);
		return this.save({ ...next, task: task.id, note: `resumed: round ${round} of ${until}` }, "resumed");
	}

	/** Take the swarm off a conversation. Its board and what is on it stay. */
	clear(agent: string, session: string): boolean {
		const swarm = this.end(agent, this.conversation(agent, session));
		if (swarm) this.tell({ ...swarm, status: "paused", task: undefined, checking: undefined, note: "cleared" }, "cleared");
		return Boolean(swarm);
	}

	/** The conversation is reset or removed: its swarm goes with it. */
	drop(agent: string, session: string): void {
		if (!session.endsWith("~u")) this.end(agent, this.key(session));
	}

	/** The conversation has another name now. */
	rename(agent: string, from: string, to: string): void {
		const swarm = this.m.kv.get<Swarm>(this.id(agent, from));
		if (!swarm) return;
		this.m.kv.set(this.id(agent, from), null);
		this.m.kv.set(this.id(agent, to), { ...swarm, session: to });
	}

	/** After a start of the daemon: a swarm that was at work waits for the owner's word, like a goal. */
	restore(): void {
		for (const key of this.m.kv.keys("swarm:")) {
			const swarm = this.m.kv.get<Swarm>(key);
			if (swarm?.status === "active") this.halt(swarm, "paused", "paused: pine was restarted. /swarm resume goes on");
		}
	}

	private end(agent: string, key: string): Swarm | undefined {
		const swarm = this.m.kv.get<Swarm>(this.id(agent, key)) ?? undefined;
		if (!swarm) return undefined;
		this.m.kv.set(this.id(agent, key), null);
		this.unqueue(swarm);
		return swarm;
	}

	/** A round that has not started does not start. */
	private unqueue(swarm: Swarm): boolean {
		if (swarm.task === undefined || this.m.tasks.get(swarm.task)?.status !== "pending") return false;
		return this.m.cancel(swarm.task);
	}

	private halt(swarm: Swarm, status: SwarmStatus, note: string): Swarm {
		// Stored first: cancelling the waiting round reports its end back here, and must find the swarm stopped.
		const stopped: Swarm = { ...swarm, status, note };
		this.m.kv.set(this.id(swarm.agent, swarm.session), stopped);
		if (this.unqueue(swarm)) stopped.round = Math.max(0, stopped.round - 1);
		return this.save({ ...stopped, task: undefined, checking: undefined }, status);
	}

	/**
	 * The task that calls the lead again: trust "owner" and kind "notify", like a goal's round. Its text
	 * is pine's own with the owner's objective; nothing the agent wrote or read is in it.
	 */
	private next(swarm: Swarm, prompt: string): Task {
		return this.m.submit({ agent: swarm.agent, session: swarm.session, kind: "notify", trust: "owner", priority: 10, label: `swarm: round ${swarm.round} of ${swarm.until}`, prompt });
	}

	/** Call the lead again, unless it has had its rounds. */
	private again(swarm: Swarm, prompt: string, note: string): void {
		if (swarm.round >= swarm.until) return void this.halt(swarm, "limit", `stopped after ${plural(swarm.round)}, which is the limit (limits.swarmRounds), with work left. /swarm resume gives it ${this.rounds()} more`);
		const round = swarm.round + 1;
		const next = this.next({ ...swarm, round }, prompt);
		this.save({ ...swarm, round, task: next.id, checking: undefined, note }, "continue");
	}

	/**
	 * A message of the owner's own arrives in a conversation whose swarm waits for their answer (the lead
	 * asked them something): the swarm goes on with it, and the turn it starts is looked at like any round.
	 * While the swarm is at work, their message is one more turn of the lead's; the board is looked at after it too.
	 */
	incoming(agent: string, session: string, kind: string, wantsAnswer: boolean, text = ""): void {
		if (this.starting || session.endsWith("~u")) return;
		if (kind !== "prompt" && !(kind === "event" && wantsAnswer)) return;
		const swarm = this.m.kv.get<Swarm>(this.id(agent, session));
		if (swarm?.status === "waiting") this.save({ ...swarm, told: heardToo(swarm.told, "", text), status: "active", task: undefined, round: swarm.round + 1, until: Math.max(swarm.until, swarm.round + 1), note: "goes on with your answer" }, "resumed");
		else if (swarm?.status === "active" && text.trim()) this.m.kv.set(this.id(agent, session), { ...swarm, told: heardToo(swarm.told, "", text) });
	}

	/** The owner answered a question of the lead's (the `question` tool) while its swarm works: the check of the answer is told. */
	heard(agent: string, session: string, asked: string, said: string): void {
		if (session.endsWith("~u")) return;
		const swarm = this.m.kv.get<Swarm>(this.id(agent, session));
		if (swarm && (swarm.status === "active" || swarm.status === "waiting")) this.m.kv.set(this.id(agent, session), { ...swarm, told: heardToo(swarm.told, asked, said) });
	}

	private live(id: number | undefined): boolean {
		return id !== undefined && ["pending", "running"].includes(this.m.tasks.get(id)?.status ?? "");
	}

	/** A task ended: a turn of the lead of a swarm that is at work, or the check of its answer. The board says what comes next. Called by `AgentManager.finish`. */
	ended(task: Task, stopping = false): void {
		if (task.meta.trust !== "owner") return;
		// The check of a swarm's answer: a sub-agent pine started itself, under the lead's turn that gave the answer.
		if (task.parent !== undefined) {
			if (task.kind !== "subagent" || task.meta.boardTask === undefined) return;
			const lead = this.m.tasks.get(task.parent);
			const swarm = lead && this.m.kv.get<Swarm>(this.id(lead.agent, lead.session));
			if (!lead || !swarm || swarm.status !== "active" || swarm.checking !== task.id) return;
			try {
				this.checked(swarm, lead, task, stopping);
			} catch (e) {
				this.log.warn(`swarm of ${swarm.agent}/${swarm.session}: could not go on after the check`, errText(e));
				this.halt(swarm, "paused", `paused: what came of the check could not be acted on (${errText(e)}). /swarm resume tries again`);
			}
			return;
		}
		if (task.session.endsWith("~u") || task.session.startsWith("_t")) return;
		const swarm = this.m.kv.get<Swarm>(this.id(task.agent, task.session));
		if (!swarm || swarm.status !== "active") return;
		// A round pine started still waits or runs: that one is looked at when it ends, not what ended beside it.
		if (swarm.task !== undefined && swarm.task !== task.id && this.live(swarm.task)) return;
		// The answer is being checked, and a message of the owner's had a turn meanwhile: the check's end says what comes next.
		if (this.live(swarm.checking)) return;
		if (task.status === "cancelled" || (stopping && task.status === "failed")) return void this.halt(swarm, "paused", stopping ? "paused: pine was stopped while it was working. /swarm resume goes on" : "paused: you stopped the agent. /swarm resume goes on");
		if (task.status !== "done") return void this.halt(swarm, "paused", `paused: round ${swarm.round} failed (${String(task.error ?? task.status).slice(0, 200)}). /swarm resume tries again`);
		try {
			this.look(swarm, task);
		} catch (e) {
			this.log.warn(`swarm of ${swarm.agent}/${swarm.session}: could not go on`, errText(e));
			this.halt(swarm, "paused", `paused: the next step could not be started (${errText(e)}). /swarm resume tries again`);
		}
	}

	/** How the work of a swarm was done, for the line that says it is over. */
	private how(swarm: Swarm): string {
		const pieces = this.tasksOf(swarm).filter((t) => t.data?.check === undefined && t.state === "done").length;
		return pieces ? `${pieces} task${pieces === 1 ? "" : "s"}` : `${swarm.agent} did it without handing anything out`;
	}

	/** The newest finished check of the lead's answer, and whether it passed with no work done since. */
	private lastCheck(tasks: BoardItem[]): { item: BoardItem; passed: boolean } | undefined {
		const item = tasks.filter((t) => t.data?.check === "job" && t.data?.answer === true && t.state === "done").at(-1);
		if (!item) return undefined;
		const lastWork = Math.max(0, ...tasks.filter((t) => t.data?.check === undefined && t.state === "done").map((t) => t.updated));
		// (A check that says neither PASS nor FAIL has not said the answer is right: it counts like one that failed.)
		return { item, passed: item.updated >= lastWork && verdictOf(item.result) === "pass" };
	}

	/** What the board says after a turn of the lead's: go on, have the answer checked, wait for the owner, or done. */
	private look(swarm: Swarm, task: Task): void {
		const { boards } = this.m;
		const tasks = this.tasksOf(swarm);
		const open = tasks.filter((t) => t.state === "open" || t.state === "taken");
		const blocked = tasks.filter((t) => t.state === "blocked");
		const answer = task.result ?? "";
		// The lead asks its owner something while work is left, or before it did anything: the swarm waits for the
		// answer, and goes on with it (`incoming`). A question at the end of an answer to a finished job is an offer,
		// and changes nothing.
		const idle = !tasks.length && !(task.meta.stats?.tools.length ?? 0);
		if (asksAtEnd(answer) && (open.length || blocked.length || idle)) return void this.save({ ...swarm, status: "waiting", task: undefined, note: `${swarm.agent} asks you something: answer it, and the swarm goes on` }, "waiting");
		if (open.length || blocked.length) return this.again(swarm, continuePrompts.unfinished(swarm.objective, open, blocked), `${open.length + blocked.length} task${open.length + blocked.length === 1 ? " is" : "s are"} not done: round ${swarm.round + 1} of ${swarm.until} starts`);
		// Everything on the board is settled, and the lead has answered. That answer is what the owner reads, so it
		// is what is checked: by a sub-agent that did none of the work, against the request and what was left. A
		// check the lead had made inside its call (verify) looked at the pieces before this answer was written, and
		// does not stand in for it. Has the last such check passed, with no work done since? (The lead had it done
		// itself, after a swarm that was stopped in the middle of its check.)
		const last = this.lastCheck(tasks);
		if (last?.passed) return void this.save({ ...swarm, status: "done", task: undefined, note: `done after ${plural(swarm.round)}: ${this.how(swarm)}, and the answer was checked` }, "done");
		if (swarm.checks >= MAX_CHECKS) return void this.save({ ...swarm, status: "done", task: undefined, note: `ended after ${plural(swarm.round)}: ${this.how(swarm)}. The last check of the answer still found something: task #${last?.item.id ?? "?"} on the board says what` }, "done");
		// The task holds the lead's answer, in full, and carries the mark of the run that wrote it. pine has it done
		// itself, under the lead's turn that just ended: the lead has no turn for it.
		const board = boards.find("local", swarm.agent, swarm.session, "") ?? boards.ensure("local", swarm.agent, swarm.session, "");
		const check = boards.post(board, { kind: "task", text: checkTask(swarm.objective, answer, swarm.told), data: { check: "job", answer: true }, by: swarm.agent, trust: "owner", tainted: this.m.taintOf(task), long: true });
		// (On the model the owner set for it, where they set one: a check on another model does not share the lead's misreadings.)
		const model = this.m.cfg.defaults.checker;
		const run = this.m.startBoardTask(task, check, checkPrompt(check), CHECK_LABEL, model);
		this.save({ ...swarm, task: undefined, checking: run.id, checks: swarm.checks + 1, note: `${last ? "the new answer is being checked" : "the answer is being checked by a sub-agent that did none of the work"}${model ? `, on ${model}` : ""}` }, "checking");
	}

	/** The check of the lead's answer ended: done when it passed, and the lead's to put right when it did not. */
	private checked(swarm: Swarm, lead: Task, run: Task, stopping: boolean): void {
		const uncounted = { ...swarm, checks: Math.max(0, swarm.checks - 1) };
		if (run.status === "cancelled" || (stopping && run.status === "failed")) return void this.halt(uncounted, "paused", stopping ? "paused: pine was stopped while the answer was being checked. /swarm resume goes on" : "paused: the check of the answer was stopped. /swarm resume goes on");
		const item = this.m.boards.item(run.meta.boardTask!);
		if (run.status !== "done" || !item) {
			// The model server said "not now": the task is given out again after a pause (`boardsAfter`), and pine starts it again.
			const wait = item && this.m.retrying.get(item.id);
			if (!wait) return void this.halt(uncounted, "paused", `paused: the check of the answer could not be done (${String(run.error ?? run.status).slice(0, 200)}). /swarm resume goes on`);
			return void wait.then(() => {
				const now = this.m.kv.get<Swarm>(this.id(swarm.agent, swarm.session));
				if (!now || now.status !== "active" || now.checking !== run.id) return;
				try {
					const fresh = this.m.boards.item(item.id);
					if (!fresh) throw new Error("the check is no longer on the board");
					this.save({ ...now, checking: this.m.startBoardTask(lead, fresh, checkPrompt(fresh), CHECK_LABEL, this.m.cfg.defaults.checker).id }, "checking");
				} catch (e) {
					this.halt({ ...now, checks: Math.max(0, now.checks - 1) }, "paused", `paused: the check of the answer could not be started again (${errText(e)}). /swarm resume goes on`);
				}
			});
		}
		if (item.state === "done" && verdictOf(item.result) === "pass") return void this.save({ ...swarm, status: "done", task: undefined, checking: undefined, note: `done after ${plural(swarm.round)}: ${this.how(swarm)}, and the answer was checked` }, "done");
		// (A check that says neither PASS nor FAIL has not said the answer is right.)
		if (swarm.checks >= MAX_CHECKS) return void this.save({ ...swarm, status: "done", task: undefined, checking: undefined, note: `ended after ${plural(swarm.round)}: ${this.how(swarm)}. The last check of the answer still found something: task #${item.id} on the board says what` }, "done");
		this.again(swarm, continuePrompts.failed(swarm.objective, item.id), `the check of the answer found something: ${swarm.agent} puts it right, round ${swarm.round + 1} of ${swarm.until}`);
	}
}

/** One more thing the owner said, kept short and to the last few: it goes into a task on the board. */
const heardToo = (told: Swarm["told"], asked: string, said: string) => (said.trim() ? [...(told ?? []), { asked: asked.replace(/\s+/g, " ").trim().slice(0, 400), said: said.replace(/\s+/g, " ").trim().slice(0, 600) }].slice(-8) : told);

const plural = (rounds: number) => `${rounds} round${rounds === 1 ? "" : "s"}`;
