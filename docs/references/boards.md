# Teams of agents: boards and swarms

A board is a shared list of the tasks of one job that several work on: an agent and its
sub-agents, or several agents. It is how agents on one project share what they found and avoid
doing the same thing twice: who does what, what came of each task, what one could not decide.

- A **task** is a piece of work. One run takes it, and while it has it nobody else can. Its result
  stays on the board. A task that needs a decision is *blocked* with a question, and is given out
  again once the question is answered.
- A **note** is something whoever works on the board should know: what they all go by, or the
  answer to one task's question.

Whoever gives out the work stays in charge. The agents on a board do not talk to each other: each
does its task and reports; the conversation that started them (or you) answers questions and
decides what comes next.

## What a board is, and what it is not

Plain `subagent` with a few clear tasks needs no board. A board is for what tasks written
beforehand cannot do:

- more work than runs at once, worked off a few at a time (a pool);
- a sub-agent that cannot decide something asks, and is answered while the others work on;
- work that waits for other work and is shown its result (stages, a check after the work);
- a check of each result, and of the finished whole, by a sub-agent that did none of it;
- work added while it runs, by the agent or by you;
- tasks posted by one agent and taken by another (a board with a name, an agent woken by a
  schedule or an event);
- you see who has what and can answer the one that is stuck.

You see a board in the Board tab of the Pine app ([desktop.md](desktop.md), "The Board tab"), with
`/board` in the terminal UI ([tui.md](tui.md)), or through the control API. Agents reach it only
through the tools below.

## Which boards there are

| Board | Who uses it | Made by, and when it goes |
|---|---|---|
| A conversation's own board (no name) | That conversation, its sub-agents, and an agent it hands a task to with `delegate` (for that run, not in a `thread`) | The first post, or a task of yours in the Board tab. Goes when the conversation is reset or removed |
| A named board, `"scope": "local"` | The same, nobody else | `board_post` with a new name and that scope. Goes with the conversation |
| A named board, `"scope": "agent"` | Every conversation of the agent that made it | `board_post` with a new name and that scope, in your own conversations. Goes when the agent is removed |
| A named board, `"scope": "global"` | Every agent | The main agent, the same way. Stays until removed; removing an agent takes its posts off it |

You remove a board in the Board tab; an agent with `board_remove` (see "The tools").

A name is lowercase letters, digits, `-` and `_`. A new named board needs a `scope`, so a board
meant for all agents is never quietly made for one conversation. Sub-agents and runs started from
outside make no named board. An agent that looks for a board that is not there is told to report
it missing, not to make a look-alike nobody else sees: whoever hands out a board's tasks makes the
board first. Where a name fits several boards and no `scope` is given, the nearest counts: the
conversation's, then the agent's, then the global one.

## The tools

The actions of the family `pine_board`; the list `boards` is one of `pine_list` ([agents.md](agents.md),
"How tools are declared"). Without `board`, each means the conversation's own board.

| Tool | What it does |
|---|---|
| `boards` | Lists the boards the conversation can use, whom each is for, and how many tasks are open, taken, done, failed and blocked. |
| `board_read` [`board`] [`id`] | A board's tasks, who has each and what became of it, and the last 30 notes. With `id`, one task in full with its result and notes. |
| `board_post` `text` `type` [`board`] [`on`] [`after`] [`scope`] | Posts a task (`"type": "task"`: work somebody takes) or a note (`"type": "note"`). `type` is required. `on`: the task a note is about. `after`: tasks that must be done first; whoever does this one is shown their results. `scope`: whom a new named board is for. The answer says when it made a board, and lists notes others left since the agent last looked. |
| `board_claim` [`id`] [`board`] | Takes a task: that number, or the oldest that is ready. Answers with the task in full. It is the agent's until `board_done` or until its turn ends. |
| `board_done` `id` [`result`] [`outcome`] | Settles a task the agent took. `outcome`: `done` (default) with the result, `failed` with why, `blocked` with the question that must be answered first, `open` to give it back. The conversation that gave out the work can also close a task of its own board that nobody holds, such as a question it can answer with the result itself. |
| `board_remove` [`board`] [`id`] | Removes a board with everything on it, or with `id` one task (with its notes) or note. Cannot be undone. A board of this conversation goes without a question; a board for the agent or for all agents (the main agent's) asks you first, in every mode. A sub-agent on a task that goes is stopped; a board a pool works on waits until its call came back. Not for sub-agents or runs from outside. |
| `board_answer` `id` `text` [`all`] | Answers the question a blocked task waits for: the answer becomes a note on the task, which is open again, and whoever takes it next sees both. `"all": true`: for the whole job; every other blocked task is opened with it, and unfinished ones are shown it. Not for sub-agents: whoever gave out the work answers. |

| State | Meaning |
|---|---|
| `open` | Nobody has it. *Ready* when every task in its `after` is done. |
| `taken` | One run has it. |
| `done` | It has a result. |
| `failed` | It has the reason. A task that waits for it is never ready until you reopen or remove the failed one. |
| `blocked` | It waits for an answer: `board_answer` by the agent that gave out the work, or yours in the Board tab. |

## Nothing stays taken

A task is held by a run of pine's (a task in `pine tasks`), not by an agent's word. When that run
ends, for any reason, what it did not settle is open again; so a task taken in a conversation is
taken for that turn. After a restart of pine every taken task is open. Two runs that ask for the
same task at once never both get it.

## A pool of sub-agents

`subagent` runs `subagents.maxParallel` sub-agents at a time (`limits.maxSubagents`, 4, Settings >
General, or the agent's `agent.json`). With `"pool": true`, or simply more tasks than that, it
takes up to `limits.maxPoolTasks` (100): the tasks go onto the conversation's board and that many
sub-agents at a time work through them. Tasks already on the board (yours from the Board tab, or
posted with `board_post`) are worked too, and `"pool": true` with no tasks goes on with what is
there. A job split into more than a hundred tasks takes a higher `limits.maxPoolTasks`, or a
second call for the rest. The arguments are in [agents.md](agents.md), "Sub-agents".

Give all tasks in one call (several calls in one answer join one pool).

```
subagent(tasks: ["Check src/components/a for ...", "Check src/components/b for ...", ...40 more], pool: true,
         note: "The design tokens (src/styles/tokens.css): --space-1 4px, --space-2 8px, --space-3 16px; --color-text #111827, ... Report a spacing or a color only when it is none of these.")
```

**Say once what all go by, in `note`.** Sub-agents that start together cannot tell each other
anything in time. So the values and rules themselves (not where to find them) go into `note`,
which every sub-agent of the call is shown whole when it starts. A call with a `note` is a pool. A
wrong note is wrong for all of them, so the agent writes there only what it read itself or you
told it. Ask in that order:

> Find out what this project's design tokens are. Then check every folder in `src/components`
> for spacing and colors that do not match them, with a pool of sub-agents, one task per folder.

**Tasks on another board** (a board for all agents on which the agent was given tasks) are worked
where they are: `subagent` with their numbers in `ids` (all from one board) gives each to a
sub-agent whose answer settles that very task. The pool then works those tasks and nothing else
there, and `tasks`, `note` and `check` of the call go onto that board too. Copying a task's text
into `tasks` would make a new task and leave the given one open.

```
subagent(ids: [2, 3])
```

What each sub-agent is shown: its task, the results of the tasks it waited for (`after`), the
notes about its task, its call's `note`, and the last 12 notes posted for all. Its final answer is
the task's result, whether or not it ever mentions the board.

- A sub-agent that fails leaves its task `failed`; what waits for it is never started. One that is
  stopped leaves its task open.
- A sub-agent the model server refused for now (rate limit, overload, dropped connection) did not
  fail: the task is given out again after a few seconds, twice at most, without a turn of the
  agent. An account limit (quota, balance) is not retried.
- A task you add in the Board tab while the pool runs is worked like the others; one you take back
  goes to a new sub-agent; one you remove stops its sub-agent. Your answer to a question there
  counts like the agent's.
- When the agent's turn ends while sub-agents work (it asked you something), they finish, and the
  agent gets their results at its next pool call. Stopping the conversation stops them and opens
  their tasks again.
- `pool` and `worktree` do not go together.

### The agent stays in the loop

The call does not wait for the last task. It comes back to the conversation:

- when a sub-agent **asks a question**: it called `board_done` with `blocked`, or its answer ends
  with a question, which pine settles as blocked too. (Small things a sub-agent decides itself and
  says what it assumed; something simply missing, such as a named file, it reports as its result.)
- when a sub-agent **fails**;
- when nothing is left to do.

It brings each new result once, under its task's own words, and every open question until it is
answered. The others work on meanwhile; no new ones start until the conversation calls again.

The agent answers with `board_answer`, from what it knows, can look up or was told by you. A value
or choice nobody gave it is yours: it asks you and passes on your answer. Where others have or will
have the same question it answers with `"all": true`; a sub-agent that asks the same a moment
later gets its task given out again with that answer, without a turn of the agent. Where its
answer is the result already, it closes the task with `board_done`. Then it calls `subagent` with
`"pool": true` and no tasks: that call takes over the sub-agents still at work and gives the
answered task to a new one.

When all tasks are done, the pool's answer reminds the agent that a result which left something
out or assumed a value given nowhere is not finished: it asks you and has those pieces done again.

### Stages

Pieces that build on others go in stages: first the base, then what uses it, then putting it
together.

```
subagent(stages: [["Write src/money.js as SPEC.md says ..."],
                  ["Write src/cart.js ...", "Write src/tax.js ...", "Write src/discount.js ..."],
                  ["Write src/invoice.js and src/index.js ..."]],
         note: "Amounts are whole cents, made and read only through src/money.js ...",
         verify: "Import src/index.js and run every example of SPEC.md. Report each that differs.")
```

- The tasks of a stage run side by side. A stage starts when every task of the one before is done
  (and, with `check`, checked).
- Its sub-agents are shown the results of the stage before, cut short when there are many
  (`board_read` with a number shows one in full).
- A task that fails keeps later stages from starting; the agent is told, and posts it again or
  goes on without it.
- A call has `tasks` or `stages`, not both.

By hand it is the same: a task posted with `after` waits for those tasks and is shown their results.

### A check after the work

What a sub-agent says it did is a claim. With `check`, each task is followed by a second
sub-agent that is shown the task and its result:

```
subagent(tasks: ["Summarise book/ch1.md in two sentences into summaries/ch1.md", ...],
         check: "Check the summary against its chapter, fact by fact, and count its sentences.")
```

> For each of the six chapters in `book/`: have one sub-agent write a summary, and a second
> one check that summary against the chapter. Tell me what the checks found.

A check changes nothing. It says what is wrong and ends with `PASS` or `FAIL` on a line of its own.

| The check ends with | What happens |
|---|---|
| `PASS` | The agent is told in one line. |
| `FAIL` | The task is done again by a new sub-agent, shown what the check found. The task itself is unchanged (one that was to look and report changes no file). Then it is checked again. No turn of the agent is needed; later stages wait. |
| `FAIL` again | The report goes to the agent, which decides. What fails twice is mostly a rule that can be read two ways. |
| Neither word | The check is a report the agent reads with the result. |

So "write it, check it, fix it, check again" is one call. A call with `check` is a pool.

A check judges the work, not its subject: for a task that was to find faults, PASS means the faults
were found rightly. It costs one more sub-agent per task: use it for pieces written under rules a
second look catches (a text of a set length, a file in a set format). For pieces that only read and
report, one check of the whole (below) is cheaper.

### A check of the whole

`verify` adds one task after everything else: a sub-agent that did none of the work checks the
finished whole as `verify` says (run it, count again, compare with the source) and ends with `PASS`
or `FAIL`.

```
subagent(tasks: [...one per region...],
         verify: "Recompute three regions of your choice from raw/ and compare them with clean/. Add up totals.json again.")
```

Every check is told that FAIL is for what can be pointed at (a wrong fact or number, a broken rule,
a missing part); taste and wording are remarks. The verdict comes back with the results; it is
always done last. Nothing is given out again by itself: the agent hands out fixes as new tasks
with a `verify` again. After three failed checks of the whole in a row, no further one is made, and
the agent gives you the result with what the last check found. `verify` with no tasks checks what
is there already.

A check of each piece finds what is wrong inside a piece; a check of the whole finds what is wrong
between pieces (two that do not fit, one missing, a total that does not add up). A job can have
both.

## A swarm

`/swarm` and a job, typed in a conversation, makes its agent the lead: it hands the job out to
sub-agents on the conversation's board, answers their questions and puts the result together (a
job of a few steps it does itself). pine then has the answer checked before the swarm is done.

```
/swarm Write a test file for each of the 16 modules in src/, and make sure they all pass.
```

A normal message leaves it to the agent whether it uses sub-agents, a pool or checks. In a swarm
the agent leads and coordinates the sub-agents instead of doing the work itself, and pine looks at
the board each time the lead ends a turn:

| pine finds | What it does |
|---|---|
| Tasks on the board that are not done | Calls the lead again with their numbers. A swarm does not end with work open. |
| A task waits for an answer and the lead asked you | Waits. Your answer is its next turn. |
| All done, and the lead has answered | Posts a check of that answer on the board (your job, what you said meanwhile, the answer in full) and starts a sub-agent that did none of the work for it. |
| The check passed | The swarm is done. |
| The check failed | Calls the lead with the check's number. The lead reads what was found, corrects it or hands work out again, and answers in full again; that answer is checked once more. If the second check fails too, the swarm ends, naming the task that says what was still found. |

No model decides whether the job is done: the board does. The check reads the answer you get,
against what you asked and what was left (files, numbers), so it also catches a name left out or a
number copied wrong while the pieces were put together. It fails only for what can be pointed at.
It runs on the agent's own model unless `defaults.checker` in `pine.json` names another (the main
agent sets it when you ask): the same model catches slips, another also catches what the first
misreads every time.

The lead is told to look first, to ask you for a value the job needs that is given nowhere, to
hand a larger job out in one `subagent` call (with a `note` holding every decision pieces must
agree on) and do none of the pieces itself, and to answer in full. While a swarm runs, every
`subagent` call of the conversation goes over the board (not with `worktree`), and so does a
`delegate` without `thread`: the lead waits for it.

| Command | What it does |
|---|---|
| `/swarm <what is to be done>` | Starts a swarm in this conversation, replacing one that was there. At most 4000 characters: put details into a file. Refused for an agent without sub-agents (`subagents.enabled`), in a conversation with an active goal (`/goal clear` first), and when `defaults.checker` names a model that is not there. |
| `/swarm` | Shows the swarm and where it stands. |
| `/swarm pause` | No further rounds. A running round or check ends by itself; `esc` stops a round at once. |
| `/swarm resume` | Goes on after a pause, the round limit, or your answer. If the check passed meanwhile, the swarm is done at once. |
| `/swarm clear` | Takes the swarm off. Its board stays. |

| What happened | What the swarm does |
|---|---|
| `limits.swarmRounds` turns of the lead (8) with work left | Stops. `/swarm resume` gives as many again. |
| You stopped the agent (esc, `/stop`), or a round failed | Paused. |
| The check was stopped or could not run (refused for good) | Paused; that check does not count. One refused for now is retried after a pause. |
| pine was stopped or restarted | Paused. |
| The conversation was reset or removed | Gone with it. |

Only you start a swarm: there is no tool for it, so an agent cannot start one or give itself more
rounds. If your owner asks you, as an agent, to "swarm" something, tell them to type `/swarm` with
the job. Other programs use `POST /agents/<id>/swarm` ([operations.md](operations.md)).

## When a pool pays, and what it costs

What boards cost when unused: about 1 000 tokens per request for the tools' declaration. A pool's
sub-agent gets about 150 tokens with its task. A question costs the agent a turn; `check` one
sub-agent per task; `verify` one sub-agent; a swarm's check one sub-agent (and a turn of the lead
only when it found something). A swarm costs more than one agent doing the job: every sub-agent
reads its task and the files anew.

In pine's own tests on a small model, boards changed nothing on jobs one agent can do. On jobs
with many pieces a pool got every piece right where calls of four missed some, in about half the
time and a tenth of the calls, for no more money. A swarm's check caught most slips in answers;
a check on the same model missed what that model misread every time, and another model as checker
caught it.

So:

- A question, a change in one place, a job one agent does in a minute: a normal message.
- Up to four clear tasks: plain `subagent`.
- Many pieces: a pool, which the agent takes by itself.
- A result that must be right, a job where something only you know may be missing, or one too
  large to look over: `/swarm`. Where a wrong reading would cost you, set `defaults.checker` to
  another model.
- `check` on every piece only where pieces are written under rules: it doubles the sub-agents.

## Several agents on one board

For one job, hand it on: a task given with `delegate` (without `thread`) works on the board of the
conversation it came from, for that run; the other agent reads the notes there and leaves its own.

For work that keeps coming, use a named board. The main agent makes one for all agents; agents post
tasks on it and take them when something tells them to: you, a schedule ("every morning, take what
is ready on the board bugs"), or an event.

### Events of a board

A named board of an agent or of all agents publishes events. Only pine publishes on these topics:
`publish_event` and a route's `publish` refuse them. A conversation's own board and a `local`
board publish none.

| Topic | When |
|---|---|
| `board/<name>/task` | A task can be taken: newly posted and waiting for nothing, or open again (then with the notes about it since, such as the answer). Not when the tasks it waited for are done |
| `board/<name>/note` | A note was posted |
| `board/<name>/done`, `board/<name>/failed`, `board/<name>/blocked` | What became of a task |

The payload has `board`, `scope`, `owner` (the agent, for an agent's board), `id`, `by`, `holder`
(while somebody has the task), and `text`: a line saying what happened, then the task, note or
result.

A route that wakes an agent when somebody posts a task ([events.md](events.md)):

```json
{ "name": "bugs", "on": "board/bugs/task", "agent": "fixer",
  "prompt": "{{payload.text}}\n\nTake it with board_claim, fix it, and settle it with board_done." }
```

## What a board does not get around

- **The outside-content mark.** A post carries the mark of the run that wrote it (one that read
  outside content, or was started by an outside event). Whoever is shown it is marked too, as if
  it had read the page itself ([security.md](security.md)): a conversation whose pool worked such a
  task, and a sub-agent started with such a task, note or result. Listing boards marks nobody.
- **Trust.** A board event has the trust of what was written: owner for a post from your own
  conversation that read nothing from outside, untrusted otherwise.
- **Runs started from outside** have no board tools unless the agent's `untrusted` profile says
  `"board": true` ([configuration.md](configuration.md)). Then what they post counts as outside
  content, and they make no board beyond their conversation.
- **What is asked.** The conversation's own board is its list of work, like `todo`: never asked
  about, allowed in plan mode. A call that names a `board` changes what others read: asked in
  manual mode, refused in plan mode. `board_remove` is asked in manual mode and refused in plan
  mode on any board, and on a shared board asks you in every mode.
- **Files.** A board holds text and opens no folder.

What is on a board is information, not instructions, and the tools say so. That is a sentence to a
model, not a wall, which is why a task from a marked run marks whoever takes it.

## Limits

| What | Limit |
|---|---|
| A task's text, a result | 4000 characters. A pool call with a longer task is refused (put what all share into `note`, long text into a file); a longer result is cut and says so. A swarm's check of the answer holds the answer whole up to 12 000 characters, else its first and last 6 000 |
| A note | 2000 characters. A pool call's `note`: 8000, shown whole; longer is refused |
| Posts on one board | 500. Remove what is finished (`board_remove` with an `id`) or use a new board |
| Boards | 200. Remove finished ones (`board_remove`, or the Board tab) |
| Tasks started by one pool call | `limits.maxPoolTasks` (100) |
| A task given out again after its check failed | once |
| A task given out again after the model server refused its sub-agent for now | twice, after 4 and 8 seconds; then it fails |
| Turns of the lead in a swarm | `limits.swarmRounds` (8) |
| Checks of the lead's answer in a swarm | 2 |
| Failed checks of the whole in a row on a board | 3 |

## From the control API

The owner's own hand, with the token ([operations.md](operations.md)): every board is yours to read,
and what you post is yours.

| Endpoint | What it does |
|---|---|
| `GET /boards` | Every board with its counts, and in `tasks` where each stands (`id`, `state`, `after`, `waits`, `run` and `holder` while held, `by`, `created`, `updated`, `notes`, `asked`, `outside`), without their text: what a UI needs to draw a board |
| `GET /boards/<id>` | One board with its tasks and notes; a task says who has it (`holder`, `run`, `sub`), what it waits for (`waits`), and whether it carries outside content (`outside`) |
| `GET /agents/<id>/boards?session=` | The boards that conversation can use, its own first |
| `POST /agents/<id>/boards/post` `{ session, text, kind?, after?, on? }` | A task (or with `kind: "note"` a note) of yours on that conversation's own board, made if needed |
| `POST /boards/<id>/post` `{ text, kind?, after?, on? }` | The same on a board by its number |
| `POST /boards/items/<n>` `{ action, text? }` | `reopen` a task so it can be taken again; `answer` a blocked task with `text`; `done` with `text` settles it by hand; `remove` a task or note. A pool's sub-agent on that task is stopped |
| `POST /boards/<id>/remove` | Removes a board with everything on it, stopping a pool's sub-agents on it |
| `GET /agents/<id>/swarm?session=`, `POST /agents/<id>/swarm` `{ session, objective }` or `{ session, action }` | A swarm: where it stands, start one, or `pause`, `resume`, `clear` ([operations.md](operations.md)) |

A running UI is told on `pine/board` which board and post changed (`board`, `scope`, `agent`,
`session`, `name`, `change`, `item`, `kind`, a task's `state`), never what it says; that event is
not kept.
