# Teams of agents: boards and swarms

A board is a shared list of the tasks of one job, for an agent and its sub-agents or for several
agents. It is how agents on one project share what they found and avoid doing the same thing
twice: who does what, what came of each task, what one could not decide.

- A **task** is a piece of work. One run takes it, and while it has it nobody else can. Its result
  stays on the board. A task that needs a decision is *blocked* with a question, and is given out
  again once the question is answered.
- A **note** is something everyone on the board should know: a rule they all go by, or the answer
  to one task's question.

Whoever gives out the work stays in charge. The agents on a board don't talk to each other: each
does its task and reports, and the conversation that started them (or you) answers questions and
decides what comes next.

## When to use a board

Plain `subagent` with a few clear tasks needs no board. A board is for more work than runs at once
(a pool), sub-agents that ask and get answers while the others go on, work that waits for other
work (stages), checks by a sub-agent that did none of the work, work added while it runs, tasks one
agent posts and another takes, and seeing who has what.

You see a board in the Board tab of the Pine app ([desktop.md](desktop.md), "The Board tab"), with
`/board` in the terminal UI ([tui.md](tui.md)), or through the control API. Agents use the tools
below.

## Which boards there are

| Board | Who uses it | Made, and gone |
|---|---|---|
| A conversation's own board (no name) | The conversation, its sub-agents, and an agent it hands a task with `delegate` (not in a `thread`) | By the first post, or a task of yours in the Board tab. Goes when the conversation is reset or removed |
| A named board, `"scope": "local"` | The same | By `board_post` with a new name. Goes with the conversation |
| A named board, `"scope": "agent"` | Every conversation of the agent | The same, in your own conversations. Goes with the agent |
| A named board, `"scope": "global"` | Every agent | The same, by the main agent. Stays until removed |

A board name is lowercase letters, digits, `-` and `_`. A new named board needs a `scope`, so a
board for all agents is never made for one conversation by mistake. Sub-agents and runs started
from outside (by an event such as a webhook) make no named board. An agent that doesn't find a
board reports it missing instead of making its own copy, so whoever hands out a board's tasks makes
the board first. Without a `scope`, a name means the nearest board: the conversation's, the
agent's, then the global one. Removing an agent takes its posts off global boards. You remove a
board in the Board tab, an agent with `board_remove`.

## The tools

The actions of the family `pine_board`; `boards` is part of `pine_list` ([agents.md](agents.md),
"How tools are declared"). Without `board`, each works on the conversation's own board.

| Tool | What it does |
|---|---|
| `boards` | Lists the boards the conversation can use, whom each is for, and its counts of open, taken, done, failed and blocked tasks. |
| `board_read` [`board`] [`id`] | A board's tasks, who has each and what became of it, and the last 30 notes. With `id`, one task in full. |
| `board_post` `text` `type` [`board`] [`on`] [`after`] [`scope`] | Posts a task (`"type": "task"`) or a note (`"type": "note"`, `on` the task it is about). `after`: tasks that must be done first, whose results the taker is shown. The answer lists notes posted since the agent last looked. |
| `board_claim` [`id`] [`board`] | Takes that task, or the oldest ready one, until `board_done` or the end of the turn. Answers with the task in full. |
| `board_done` `id` [`result`] [`outcome`] | Settles a task the agent took: `done` (default), `failed` with why, `blocked` with a question, or `open` to give it back. The conversation that gave out the work may also close a task of its own board that nobody holds. |
| `board_remove` [`board`] [`id`] | Removes a board, or with `id` one task or note, for good. Not for sub-agents or runs from outside. |
| `board_answer` `id` `text` [`all`] | Answers a blocked task's question as a note and opens the task again. `"all": true`: for the whole job, opening every blocked task. Not for sub-agents. |

`board_remove` on this conversation's board asks nothing; on a board for the agent or all agents it
asks you in every mode. A sub-agent on a removed task is stopped, and a board a pool works on waits
until the pool's call has come back. With `"all": true`, unfinished tasks are shown the answer too.

| State | Meaning |
|---|---|
| `open` | Nobody has it. *Ready* when every task in its `after` is done. |
| `taken` | One run has it. |
| `done` | It has a result. |
| `failed` | It has the reason. Tasks that wait for it are never ready until you reopen or remove it. |
| `blocked` | It waits for an answer from whoever gave out the work, or from you in the Board tab. |

## Nothing stays taken

A task is held by a run of pine's (a task in `pine tasks`), not by an agent's word. When the run
ends, for any reason, what it did not settle is open again. After a restart every task is open.
Two runs never get the same task.

## A pool of sub-agents

`subagent` runs `subagents.maxParallel` sub-agents at a time (`limits.maxSubagents`, 4). With
`"pool": true` or more tasks than that, it takes up to `limits.maxPoolTasks` (100) tasks onto the
conversation's board and works through them that many at a time, with tasks already on the board.
`"pool": true` with no tasks goes on with what is there. For more than a hundred tasks, raise
`limits.maxPoolTasks` or call again. Give all tasks in one call; several calls in one answer join
one pool. The arguments are in [agents.md](agents.md), "Sub-agents".

```
subagent(tasks: ["Check src/components/a for ...", "Check src/components/b for ...", ...40 more], pool: true,
         note: "The design tokens (src/styles/tokens.css): --space-1 4px, --space-2 8px, --space-3 16px; --color-text #111827, ... Report a spacing or a color only when it is none of these.")
```

Sub-agents that start together cannot tell each other anything. To tell all of them the same thing
before they start, put the values themselves (not where to find them) into `note`, which each is
shown whole. A wrong note misleads all of them, so the agent writes there only what it read or you
told it. Ask for that first ("find out what the design tokens are"), then for the pool.

Tasks given to the agent on another board, such as a global one, are worked where they are:
`subagent` with their numbers in `ids` (one board). Each sub-agent's answer settles its task there,
and the call's `tasks`, `note` and `check` go onto that board too. Copying a task's text into
`tasks` would leave the given task open.

Each sub-agent knows only its own task, so a task names the files it looks at. It is shown its
task, the results of the tasks it waited for, the notes about it, the call's `note`, and the last
12 notes for all. Its final answer is the task's result.

- A sub-agent that fails leaves its task `failed`, and nothing that waits for it starts. One that
  is stopped leaves it open.
- One the model server refused for now (rate limit, overload, dropped connection) is given out
  again ("Limits"), without a turn of the agent. An account limit (quota, balance) is not retried.
- In the Board tab, a task you add is worked like the others. A task you take back (Take it back)
  goes to a new sub-agent, and one you remove stops its sub-agent. Your answer to a question there
  counts like the agent's.
- If the agent's turn ends while sub-agents work, they finish and report at the next pool call.
  Stopping the conversation stops them and opens their tasks again.
- `pool` and `worktree` don't go together.

### The agent stays in the loop

The call comes back before the last task when a sub-agent asks a question or fails. A sub-agent
asks with `board_done` `blocked`, or by ending its answer with a question. Small things it decides
itself and says what it assumed; a missing file it reports as its result. The call brings each new
result once and every open question until answered. Others work on, but none start until the
conversation calls again.

The agent answers with `board_answer` from what it knows or you told it, and asks you for a value
nobody gave. A question others will have too gets `"all": true`, and a sub-agent that asks it later
gets its task back with that answer. A question the result already answers the agent closes with
`board_done`. Then `subagent` with `"pool": true` and no tasks takes over the running sub-agents
and gives the answered task out. When all is done, the pool reminds the agent that a result that
left something out or assumed a value is not finished.

### Stages

Pieces that build on others go in stages: the base, what uses it, then putting it together.

```
subagent(stages: [["Write src/money.js as SPEC.md says ..."],
                  ["Write src/cart.js ...", "Write src/tax.js ...", "Write src/discount.js ..."],
                  ["Write src/invoice.js and src/index.js ..."]],
         note: "Amounts are whole cents, made and read only through src/money.js ...",
         verify: "Import src/index.js and run every example of SPEC.md. Report each that differs.")
```

A stage's tasks run side by side and start when the stage before is done (and checked, with
`check`). They are shown its results, cut short when there are many (`board_read` shows one in full). A failed task stops later
stages; the agent posts it again or goes on without it. A call has `tasks` or `stages`, not both.
By hand, a task posted with `after` waits until those tasks are finished in the same way.

### A check after the work

With `check` (what to check, as text), a second sub-agent checks the first one's work: it is shown
each task and its result, changes nothing, and ends with `PASS` or `FAIL` on a line of its own.

| The check ends with | What happens |
|---|---|
| `PASS` | The agent is told in one line. |
| `FAIL` | A new sub-agent redoes the task, shown what the check found, and it is checked again. No turn of the agent; later stages wait. |
| `FAIL` again | The agent gets the report and decides. A rule that can be read two ways is the usual cause. |
| Neither word | A report the agent reads with the result. |

A check judges the work, not its subject. It costs one sub-agent per task, so use it for pieces
written under rules (a set length, a set format). For pieces that only read and report, one check
of the whole is cheaper.

### A check of the whole

`verify` adds one last task: a sub-agent that did none of the work checks the whole as `verify`
says (run it, count again, compare with the source) and ends with `PASS` or `FAIL`. It finds what
is wrong between pieces, where `check` finds what is wrong inside one.

Every check is told that FAIL is for what can be pointed at (a wrong fact or number, a broken rule,
a missing part); taste is a remark. Nothing is redone by itself: the agent hands out fixes with a
`verify` again. After three failed checks of the whole in a row there is no further one, and the
agent gives you the result with the last findings. `verify` with no tasks checks what is there.

## A swarm

`/swarm` and a job make the conversation's agent the lead. It coordinates sub-agents on the board
instead of doing the work itself (a job of a few steps it does itself), answers their questions and
puts the result together. pine checks the answer before the swarm is done.

```
/swarm Write a test file for each of the 16 modules in src/, and make sure they all pass.
```

Each time the lead ends a turn, pine looks at the board:

| pine finds | What it does |
|---|---|
| Tasks not done | Calls the lead again with their numbers. |
| The lead asked you with `question`, or a task waits for an answer and the lead asked you | Waits for your answer: your next message in the conversation. The check is told it beside the question. |
| All done, and the lead answered | Posts a check of the answer (your job, what you said meanwhile, the answer) and starts a sub-agent that did none of the work. |
| The check passed | The swarm is done. |
| The check failed | Calls the lead, which corrects and answers in full again. If the second check fails too, the swarm ends and names what was still found. |

The board decides when the job is done, not a model. The check compares your answer with what you
asked and with the files, so it catches a name left out or a number copied wrong. It runs on the
agent's model unless `defaults.checker` in `pine.json` names a different one (the main agent sets
it); another model also catches what the first misreads every time.

The lead is told to look first, ask you for values given nowhere, hand a larger job out in one
`subagent` call with a `note` of every shared decision, and answer in full. During a swarm every
`subagent` call (not with `worktree`) and every `delegate` without `thread` go over the board.

| Command | What it does |
|---|---|
| `/swarm <what is to be done>` | Starts a swarm, replacing the old one. At most 4000 characters. Refused without sub-agents (`subagents.enabled`), with an active goal, or when `defaults.checker` names a missing model. |
| `/swarm` | Shows where it stands. |
| `/swarm pause` | No further rounds; `esc` stops a running one. |
| `/swarm resume` | Goes on after a pause, the round limit, or your answer. Done at once if the check passed meanwhile. |
| `/swarm clear` | Takes the swarm off. Its board stays. |

| What happened | What the swarm does |
|---|---|
| `limits.swarmRounds` (8) turns of the lead with work left | Stops. `/swarm resume` gives as many again. |
| You stopped the agent, a round failed, or pine restarted | Paused. |
| The check was stopped or refused for good | Paused; that check does not count. One refused for now is retried. |
| The conversation was reset or removed | Gone. |

Only you start a swarm; there is no tool for it. If your owner asks you, as an agent, to "swarm"
something, tell them to type `/swarm` with the job. Other programs use `POST /agents/<id>/swarm`
([api.md](api.md)).

## When a pool pays, and what it costs

Boards cost about 1 000 tokens per request for the tools' declaration, used or not. A pool's
sub-agent gets about 150 tokens with its task. A question costs the agent a turn; `check` one
sub-agent per task; `verify` and a swarm's check one sub-agent each. A swarm costs more than one
agent doing the job, since every sub-agent reads its task and files anew.

- A question or a small change: a normal message.
- Up to four clear tasks: plain `subagent`.
- Many pieces: a pool, which the agent picks by itself.
- A result that must be right, or a job too large to look over: `/swarm`, with `defaults.checker`
  on another model where a wrong reading would cost you.

## Several agents on one board

For one job, `delegate` (without `thread`): the other agent works on the board of the conversation
it came from. For work that keeps coming, the main agent makes a named board for all agents, and
agents take its tasks when you, a schedule ("every morning, take what is ready on the board bugs")
or an event tells them to.

### Events of a board

Named boards of an agent or of all agents publish events, for example to wake an agent when
somebody posts a task. Only pine publishes on these topics. A conversation's board and a `local`
board publish none.

| Topic | When |
|---|---|
| `board/<name>/task` | A task can be taken: new and waiting for nothing, or open again (with the notes since). Not when the tasks it waited for are done |
| `board/<name>/note` | A note was posted |
| `board/<name>/done`, `board/<name>/failed`, `board/<name>/blocked` | What became of a task |

The payload has `board`, `scope`, `owner`, `id`, `by`, `holder`, and `text` (what happened, then
the post). A route that wakes an agent ([events.md](events.md)):

```json
{ "name": "bugs", "on": "board/bugs/task", "agent": "fixer",
  "prompt": "{{payload.text}}\n\nTake it with board_claim, fix it, and settle it with board_done." }
```

## What a board does not get around

- A post carries the outside-content mark of the run that wrote it. Whoever is shown it (a
  conversation whose pool worked it, a sub-agent started with it) is marked too
  ([security.md](security.md)). Listing boards marks nobody.
- A board event has the trust of the post: owner for one from your own unmarked conversation,
  untrusted otherwise.
- Runs started from outside have no board tools unless the `untrusted` profile says
  `"board": true` ([configuration.md](configuration.md)). Their posts count as outside content, and
  they make no board beyond their conversation.
- The conversation's own board is its work list, like `todo`: never asked about, allowed in plan
  mode. A call that names a `board`, and `board_remove`, is asked about in manual mode and refused
  in plan mode.
- A board holds text and opens no folder. The tools say its text is information, not instructions.

## Limits

| What | Limit |
|---|---|
| A task's text, a result | 4000 characters. A longer task in a pool call is refused; a longer result is cut |
| A note | 2000 characters; a pool call's `note` 8000 |
| Posts on one board | 500 |
| Boards | 200 |
| Tasks started by one pool call | `limits.maxPoolTasks` (100) |
| Redo after a failed check | once |
| Retry after the model server refused a sub-agent for now | twice, after 4 and 8 seconds; then it fails |
| Turns of the lead in a swarm | `limits.swarmRounds` (8) |
| Checks of the lead's answer in a swarm | 2 |
| Failed checks of the whole in a row | 3 |

## From the control API

Your own hand, with the token ([api.md](api.md)): you read every board, and what you post is yours.

| Endpoint | What it does |
|---|---|
| `GET /boards` | Every board with its counts and each task's state (`id`, `state`, `after`, `waits`, `run`, `holder`, `by`, `created`, `updated`, `notes`, `asked`, `outside`), without text |
| `GET /boards/<id>` | One board with its tasks and notes, who holds each (`holder`, `run`, `sub`) and `outside` |
| `GET /agents/<id>/boards?session=` | The boards that conversation can use |
| `POST /agents/<id>/boards/post` `{ session, text, kind?, after?, on? }` | A task, or with `kind: "note"` a note, on the conversation's own board |
| `POST /boards/<id>/post` `{ text, kind?, after?, on? }` | The same on a board by number |
| `POST /boards/items/<n>` `{ action, text? }` | `reopen`, `answer` (with `text`), `done` (with `text`) or `remove`; stops a pool's sub-agent on it |
| `POST /boards/<id>/remove` | Removes a board, stopping its pool's sub-agents |
| `GET /agents/<id>/swarm?session=`, `POST /agents/<id>/swarm` `{ session, objective }` or `{ session, action }` | A swarm: where it stands, start, `pause`, `resume`, `clear` ([api.md](api.md)) |

A running UI is told on `pine/board` which board and post changed (`board`, `scope`, `agent`,
`session`, `name`, `change`, `item`, `kind`, `state`), never what it says. The event is not kept.

## Problems

| What you see | What to do |
|---|---|
| A task is never started | It waits for a failed task. Reopen or remove that one |
| A pool call is refused | A task is over 4000 characters or the `note` over 8000. Move shared text into `note`, long text into a file |
| An agent works on its own board instead of the shared one | The shared board did not exist yet. Make it before handing out its tasks |
| A board takes no more posts | It holds 500. Remove finished tasks or use a new board |
