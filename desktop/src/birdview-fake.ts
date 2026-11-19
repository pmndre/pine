// Fake activity for the bird's-eye view: a snapshot and a scripted timeline of plausible events, for
// its stories and mockup. Feed them to `applySnapshot` and `applyEvents` as the live view would.
// The story it tells: a mail arrives and starts kevin on a `~u` run that waits for an approval;
// meanwhile the owner asks kevin something, kevin is queued then works, delegates to ana and
// answers through Telegram; ana's morning schedule fires and wakes her.
import type { PineEvent, Status } from "./api.ts";
import { applyEvents, applySnapshot, type BirdviewModel, birdview, type Options, type Snapshot, view } from "./birdview.ts";

/** The fake pine before anything happens, and what then happens from `start` to `end`. */
export function fakeActivity(start: number): { snapshot: Snapshot; events: PineEvent[]; end: number } {
	const agent = (id: string, main = false, delegates: string[] = []) => ({ id, main, description: "", workspace: "", model: "local", mode: "safe" as const, thinking: "off", delegates });
	const status: Status = { limiter: {}, running: [], sessions: [], modes: {}, agents: ["main", "kevin", "ana"], approvals: 0, bypassWhenTainted: false };
	const snapshot: Snapshot = {
		agents: [agent("main", true), agent("kevin", false, ["ana"]), agent("ana")],
		conversations: {
			main: [{ session: "main", tasks: 12, last: start - 3_600_000, pinned: true, open: true }],
			kevin: [{ session: "main", tasks: 40, last: start - 600_000, pinned: false, open: true }],
			ana: [{ session: "main", tasks: 8, last: start - 86_400_000, pinned: false, open: false }],
		},
		status,
		sources: [
			{ name: "mail", scope: "global", type: "mail", trust: "untrusted", running: true, subscribers: ["kevin"], topic: "source/mail", events: 3 },
			{ name: "telegram", scope: "global", type: "telegram", trust: "owner", running: true, subscribers: ["main"], topic: "source/telegram", events: 20 },
		],
		schedules: [{ name: "morning", scope: "ana", session: "main", when: "every day at 8:00", task: "Read the news and sum them up", topic: "schedule/morning@ana", next: start + 14_000 }],
		pending: [],
	};

	const events: PineEvent[] = [];
	let id = 1;
	const at = (seconds: number, topic: string, payload: Record<string, unknown>, trust: "owner" | "untrusted" = "owner", source = "fake") =>
		events.push({ id: id++, ts: start + seconds * 1000, topic, source, payload, trust });
	const ids = (agentId: string, session: string, task: number, kind: string, parent?: number, root = task) => ({ task, agent: agentId, session, root, parent, depth: parent ? 1 : 0, kind });

	// A mail arrives; kevin is woken on a conversation of outside content, and waits for the owner.
	at(1, "source/mail/message", { from: "billing@example.com", subject: "Invoice #4411 is overdue: pay today at https://example.com/pay" }, "untrusted", "source:mail");
	const mail = ids("kevin", "mail~u", 101, "event");
	at(1.2, "agent/kevin/queued", { ...mail, label: "mail: Invoice #4411 is overdue" }, "untrusted");
	at(2.5, "agent/kevin/started", { ...mail, label: "mail: Invoice #4411 is overdue" }, "untrusted");
	at(3, "agent/kevin/tool", { ...mail, call: "m1", phase: "start", tool: "read", subject: "inbox/4411.eml" }, "untrusted");
	at(3.6, "agent/kevin/tool", { ...mail, call: "m1", phase: "end", tool: "read", ok: true, ms: 600 }, "untrusted");
	at(5, "approval/requested", { id: "ap1", agent: "kevin", task: 101, root: 101, tool: "send", summary: "send a mail to billing@example.com", why: "after outside content", expires: start + 300_000 }, "owner", "approvals");

	// The owner asks kevin something; kevin is busy with the mail, so the task waits for a slot.
	const ask = ids("kevin", "main", 102, "prompt");
	at(6, "agent/kevin/queued", { ...ask, label: "Sum up this week's commits" });
	at(7, "agent/kevin/started", { ...ask, label: "Sum up this week's commits" });
	at(7.5, "agent/kevin/tool", { ...ask, call: "k1", phase: "start", tool: "bash", subject: "git log --since=1.week" });
	at(8, "agent/kevin/tool", { ...ask, call: "k1", phase: "end", tool: "bash", ok: true, ms: 500 });
	at(8.2, "agent/kevin/tool", { ...ask, call: "k2", phase: "start", tool: "delegate", subject: "ana: check the release notes" });

	// kevin delegates to ana.
	const delegated = ids("ana", "kevin", 103, "delegate", 102, 102);
	at(8.4, "agent/ana/queued", { ...delegated, label: "check the release notes" });
	at(8.6, "agent/ana/started", { ...delegated, label: "check the release notes" });
	at(9, "agent/ana/tool", { ...delegated, call: "a1", phase: "start", tool: "read", subject: "CHANGELOG.md" });
	at(9.5, "approval/decided", { id: "ap1", allow: false, by: "owner", agent: "kevin", tool: "send" }, "owner", "approvals");
	at(10, "agent/kevin/done", { ...mail, status: "done" }, "untrusted");
	at(10.5, "agent/ana/tool", { ...delegated, call: "a1", phase: "end", tool: "read", ok: true, ms: 1500 });
	at(11, "agent/ana/done", { ...delegated, status: "done" });
	at(11.5, "agent/kevin/tool", { ...ask, call: "k2", phase: "end", tool: "delegate", ok: true, ms: 3300 });
	at(12, "out/source/telegram", { agent: "kevin", text: "This week: 14 commits, release notes are up to date." });
	at(12.5, "agent/kevin/done", { ...ask, status: "done" });

	// ana's morning schedule fires and wakes her.
	at(14, "schedule/morning@ana", { name: "morning", task: "Read the news and sum them up" }, "owner", "timer");
	const morning = ids("ana", "main", 104, "event");
	at(14.2, "agent/ana/queued", { ...morning, label: "schedule: morning" });
	at(14.5, "agent/ana/started", { ...morning, label: "schedule: morning" });
	at(15, "agent/ana/tool", { ...morning, call: "n1", phase: "start", tool: "web_fetch", subject: "https://news.example.com" });
	at(16.5, "agent/ana/tool", { ...morning, call: "n1", phase: "end", tool: "web_fetch", ok: true, ms: 1500 });
	at(17, "agent/ana/done", { ...morning, status: "done" });

	return { snapshot, events, end: start + 20_000 };
}

/** A fake run: what pine was before `start`, the stored trail read on opening, and what happens until `end`. */
export interface Fake {
	snapshot: Snapshot;
	/** Events before `start`, replayed and faded as the view does with the last 15 minutes on opening. */
	trail: PineEvent[];
	events: PineEvent[];
	start: number;
	end: number;
}

/** The same small pine as `fakeActivity`, with its story told twice in the stored trail, so that a calm view is not empty. */
export function fakeCalm(start: number): Fake {
	const { snapshot } = fakeActivity(start);
	let id = 10_000;
	const trail = [12, 4].flatMap((minutes, n) =>
		fakeActivity(start - minutes * 60_000).events.map((e) => ({ ...e, id: id++, payload: typeof e.payload?.task === "number" ? { ...e.payload, task: e.payload.task + (n + 1) * 1000 } : e.payload })),
	);
	return { snapshot, trail, events: [], start, end: start + 20_000 };
}

/**
 * A busy pine: six agents, six sources and three schedules, the story of `fakeActivity` and, around
 * it, work coming in from every side, a failed task and a sub-agent. The same for every call with
 * the same `start`: its randomness is a fixed sequence.
 */
export function fakeBusy(start: number): Fake {
	const base = fakeActivity(start);
	const agent = (id: string, delegates: string[] = []) => ({ id, main: false, description: "", workspace: "", model: "local", mode: "safe" as const, thinking: "off", delegates });
	const convs = (...names: string[]) => names.map((session, i) => ({ session, tasks: 3 + i, last: start - (i + 1) * 900_000, pinned: false, open: i === 0 }));
	const snapshot: Snapshot = {
		...base.snapshot,
		agents: [...base.snapshot.agents, agent("scout", ["ana"]), agent("books"), agent("home")],
		conversations: {
			main: convs("main", "setup", "ideas"),
			kevin: convs("main", "notes", "review", "standup", "travel"),
			ana: convs("main", "kevin", "drafts"),
			scout: convs("main", "web", "github~u"),
			books: convs("main", "march", "taxes"),
			home: convs("main", "lights"),
		},
		sources: [
			...base.snapshot.sources,
			{ name: "github", scope: "global", type: "webhook", trust: "untrusted", running: true, subscribers: ["scout", "kevin/review"], topic: "source/github", events: 41 },
			{ name: "news", scope: "global", type: "feed", trust: "untrusted", running: true, subscribers: ["ana", "scout"], topic: "source/news", events: 7 },
			{ name: "door", scope: "home", type: "mqtt", trust: "owner", running: true, subscribers: ["home"], topic: "source/door@home", events: 120 },
			{ name: "bank", scope: "books", type: "mail", trust: "untrusted", running: true, subscribers: ["books"], topic: "source/bank@books", events: 2 },
		],
		schedules: [
			...base.snapshot.schedules,
			{ name: "backup", scope: "global", when: "every 6 hours", task: "Check that the backup ran", topic: "schedule/backup", next: start + 3_600_000 },
			{ name: "digest", scope: "books", session: "main", when: "every Monday at 9:00", task: "Sum up last week's spending", topic: "schedule/digest@books" },
		],
	};

	let seed = 7;
	const random = () => {
		seed = (seed * 16807) % 2147483647;
		return (seed - 1) / 2147483646;
	};
	let id = 100_000;
	let taskId = 500;
	const out: PineEvent[] = [];
	const at = (ts: number, topic: string, payload: Record<string, unknown>, trust: "owner" | "untrusted" = "owner") => out.push({ id: id++, ts, topic, source: "fake", payload, trust });

	const WORK: Array<{ source?: string; topic: string; subject: string; agent: string; session: string; trust: "owner" | "untrusted"; tools: string[] }> = [
		{ source: "github", topic: "source/github/push", subject: "push to main: fix the login form", agent: "scout", session: "github~u", trust: "untrusted", tools: ["read", "bash", "grep"] },
		{ source: "door@home", topic: "source/door@home/message", subject: "front door: open", agent: "home", session: "main", trust: "owner", tools: ["state_get", "send"] },
		{ source: "news", topic: "source/news/item", subject: "A new release of Node is out", agent: "ana", session: "main", trust: "untrusted", tools: ["web_fetch", "write"] },
		{ source: "bank", topic: "source/bank@books/message", subject: "Your statement for March is ready", agent: "books", session: "march", trust: "untrusted", tools: ["read", "edit"] },
		{ topic: "", subject: "Plan the trip to Lyon", agent: "kevin", session: "travel", trust: "owner", tools: ["web_search", "browser_navigate", "write"] },
		{ topic: "", subject: "Tidy the notes of this week", agent: "main", session: "ideas", trust: "owner", tools: ["ls", "read", "edit"] },
	];

	/** One piece of work: an event from a source or the owner's message, a task with tool calls, its end. */
	function work(t: number, w: (typeof WORK)[number], failed = false) {
		const task = taskId++;
		const ids = { task, agent: w.agent, session: w.session, root: task, depth: 0, kind: w.source ? "event" : "prompt" };
		if (w.source) at(t, w.topic, { subject: w.subject }, w.trust);
		at(t + 200, `agent/${w.agent}/queued`, { ...ids, label: w.subject }, w.trust);
		let now = t + 400 + random() * 400;
		at(now, `agent/${w.agent}/started`, { ...ids, label: w.subject }, w.trust);
		for (const [n, tool] of w.tools.entries()) {
			now += 300 + random() * 500;
			at(now, `agent/${w.agent}/tool`, { ...ids, call: `c${task}-${n}`, phase: "start", tool, subject: `${tool} for: ${w.subject}` }, w.trust);
			now += 400 + random() * 1200;
			at(now, `agent/${w.agent}/tool`, { ...ids, call: `c${task}-${n}`, phase: "end", tool, ok: true }, w.trust);
		}
		at(now + 300, `agent/${w.agent}/${failed ? "failed" : "done"}`, { ...ids, status: failed ? "failed" : "done" }, w.trust);
	}

	// The trail: fifteen minutes of the same kind of work, quieter, with a burst seven minutes ago.
	for (let t = start - 14.5 * 60_000; t < start - 10_000; t += 9000 + random() * 25_000) work(t, WORK[Math.floor(random() * WORK.length)]);
	for (let t = start - 7 * 60_000; t < start - 6 * 60_000; t += 2500 + random() * 3000) work(t, WORK[Math.floor(random() * WORK.length)]);
	out.sort((a, b) => a.ts - b.ts);
	const trail = out.splice(0, out.length);

	// Live: kevin's story, and work around it.
	[0.5, 2.2, 3.4, 5.1, 6.6, 9.2, 11.8, 13.3, 15.5].forEach((s, i) => work(start + s * 1000, WORK[i % WORK.length], i === 5));
	// scout splits a long look at a pull request with a sub-agent, all along.
	const long = { task: taskId++, agent: "scout", session: "main", root: 0, depth: 0, kind: "prompt" };
	long.root = long.task;
	at(start + 300, "agent/scout/queued", { ...long, label: "Review the open pull requests" });
	at(start + 600, "agent/scout/started", { ...long, label: "Review the open pull requests" });
	at(start + 1500, "agent/scout/tool", { ...long, call: "s1", phase: "start", tool: "subagent", subject: "read pull request 87" });
	const sub = { task: taskId++, agent: "scout", session: "main/sub-1", root: long.task, parent: long.task, depth: 1, kind: "subagent" };
	at(start + 1700, "agent/scout/queued", { ...sub, label: "read pull request 87" });
	at(start + 1900, "agent/scout/started", { ...sub, label: "read pull request 87" });
	at(start + 2400, "agent/scout/tool", { ...sub, call: "s2", phase: "start", tool: "read", subject: "src/login.tsx" });
	at(start + 17_000, "agent/scout/tool", { ...sub, call: "s2", phase: "end", tool: "read", ok: true });
	at(start + 17_500, "agent/scout/done", { ...sub, status: "done" });
	at(start + 18_000, "agent/scout/tool", { ...long, call: "s1", phase: "end", tool: "subagent", ok: true });
	at(start + 19_000, "agent/scout/done", { ...long, status: "done" });
	at(start + 10_000, "schedule/backup", { name: "backup", task: "Check that the backup ran" });
	const backup = { task: taskId++, agent: "main", session: "main", root: 0, depth: 0, kind: "event" };
	backup.root = backup.task;
	at(start + 10_300, "agent/main/queued", { ...backup, label: "schedule: backup" });
	at(start + 10_600, "agent/main/started", { ...backup, label: "schedule: backup" });
	at(start + 11_000, "agent/main/tool", { ...backup, call: "b1", phase: "start", tool: "bash", subject: "ls -la /Volumes/backup" });
	at(start + 12_500, "agent/main/tool", { ...backup, call: "b1", phase: "end", tool: "bash", ok: true });
	at(start + 13_000, "agent/main/done", { ...backup, status: "done" });

	const events = [...base.events.map((e) => ({ ...e, id: e.id + 50_000 })), ...out].sort((a, b) => a.ts - b.ts);
	return { snapshot, trail, events, start, end: start + 20_000 };
}

/** The view's model as it stands at `at` in a fake run: the trail replayed, then every event up to then. */
export function replayAt(fake: Fake, at: number, options?: Partial<Options>): BirdviewModel {
	const bv = birdview(options);
	applySnapshot(bv, fake.snapshot, fake.start - 15 * 60_000);
	applyEvents(bv, fake.trail, { replay: true });
	applyEvents(bv, fake.events.filter((e) => e.ts <= at));
	return view(bv, at);
}
