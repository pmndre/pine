# Boards

A board is a shared place for the tasks of a job that several work on at once: an agent and
its sub-agents, or several agents. It is how agents that work on one project keep from doing
the same thing twice and share what they found: it keeps who does what, what came of each
task, and what one of them could not decide alone.

- A **task** is a piece of work. One run takes it, and while it has it nobody else can. When it
  is done, its result stays on the board. A task that cannot be done without a decision is
  *blocked* with a question, and is given out again when the question is answered.
- A **note** is something whoever works on the board should know: what they all go by, or,
  about one task, the answer to its question.

The one who gives out the work stays in charge of it. The agents on a board do not talk to
each other: each does its task and says what came of it, and the conversation that started
them reads the results, answers their questions and decides what is done next. Without a
board, ten sub-agents that look for inconsistent CSS each decide for themselves what the
"right" style is. With one, what they measure against is on the board before the first one
starts, and one that is unsure asks instead of guessing.

## What a board is, and what it is not

An agent that starts four sub-agents writes each its task anyway, and for that a list of the
same four tasks adds nothing: plain `subagent` is enough. A board is for what a task written
beforehand cannot do:

- There is more work than runs at once, and it is worked off a few at a time (a pool).
- A sub-agent that cannot decide something asks, and is answered while the others work on.
- One piece of work waits for another and is handed its result: a check after the work it
  checks.
- Each result gets a check by a second sub-agent, and what fails it is done again and checked
  again by itself.
- The finished whole gets one more check by a sub-agent that did none of the work.
- Work is added while it runs: by the agent, when a result calls for more, or by you.
- The one who posts a task and the one who takes it never started each other (a board with a
  name, and an agent woken by a schedule or an event).
- You see who has what, and can answer the one that is stuck.

A board is rows in pine's database. An agent reaches it only through the tools below, and
you see it in the Board tab of the Pine app ("The Board tab" in [desktop.md](desktop.md)), in
the terminal UI with `/board` ([tui.md](tui.md)), or through the control API.

It is not a chat. Agents do not talk to each other on it: they take what is to be done and
say what became of it. Who plans the work, answers questions and judges the result is the
conversation that started it (or you). That is on purpose: agents of equal standing that
coordinate among themselves avoid the hard tasks and wait on each other, and sub-agents that
are told to share what they find mostly repeat what they were told.

## Which boards there are

| Board | Who uses it | Made by |
|---|---|---|
| A conversation's own board, which has no name | That conversation, its sub-agents, and whoever it hands a task to with `delegate` (for that one run, not in a `thread`) | The first post, or a task of yours in the Board tab. It goes when the conversation is reset or removed |
| A board with a name, `"scope": "local"` | The same, and nobody else | `board_post` with a new name and that scope, not by a sub-agent. It goes when the conversation is reset or removed |
| A board with a name, `"scope": "agent"` | Every conversation of the one that made it | `board_post` with a new name and that scope. Only in your own conversations, and not by a sub-agent. It goes when its agent is removed |
| A board with a name, `"scope": "global"` | Everyone | The main agent, the same way. Nothing removes it by itself; removing an agent takes that agent's posts off it |

Any board goes when you remove it in the Board tab, or when an agent removes it with
`board_remove` once its work is finished. A board of the conversation's own goes without a
question; one that other conversations use (`"scope": "agent"` or `"global"`) only after your yes.

A name is lowercase letters, digits, `-` and `_`. A new board with a name is made only with a
`scope`: an agent that leaves it out is told to say whom the board is for, so that a board meant
for all agents is never quietly made for one conversation. A sub-agent, and a run started from
outside, make no board with a name: they post on their conversation's own board. Another agent
that looks for a board that is not there is told who makes it, and to report that it is missing
rather than make a look-alike under that name that nobody else would see. (So whoever hands out
a board's tasks makes the board and posts them first.)
Where a name fits several
boards and no `scope` is given, the nearest is meant: the conversation's, then the agent's, then
the global one. With a `scope`, exactly the board of that place. Nobody reads a board
that is another's alone; what several share is a global board, or a conversation's own board
during a `delegate`.

## The tools

They are the actions of the family `pine_board`; the list `boards` is one of `pine_list`
("How tools are declared" in [agents.md](agents.md)).

| Tool | What it does |
|---|---|
| `boards` | Lists the boards the conversation can use, whom each is for, and how many tasks on each are open, taken, done, failed and blocked. |
| `board_read` [`board`] [`id`] | A board's tasks with who has each and what became of it, and the notes on it (the last 30). With `id`, one task in full with its result and the notes about it. |
| `board_post` `text` `type` [`board`] [`on`] [`after`] [`scope`] | Posts a task (`"type": "task"`: work somebody takes) or a note (`"type": "note"`: something whoever works on the board should know). A post without a type is refused: a task posted as a note would be one nobody can take. `on`: the task a note is about. `after`: tasks that have to be done before this one can be taken; whoever does it is shown what came of them. `scope`: whom a board with a name is for, needed when the name is new. The answer says so when it made a board and who sees it, and lists the notes others left since the agent last looked. |
| `board_claim` [`id`] [`board`] | Takes a task: the one with that number, or the oldest that is ready. The answer is the task in full. It is the agent's until `board_done`, or until the turn ends. |
| `board_done` `id` [`result`] [`outcome`] | Says what became of a task the agent took. `outcome`: `done` (the default) with its result, `failed` with why, `blocked` with the question that has to be answered before it can go on, `open` to give it back. The conversation that gave out the work also closes with it a task of its own board that nobody has: a question whose answer is the result already. |
| `board_remove` [`board`] [`id`] | Removes a board with everything on it, or with `id` one task or note (a task with the notes about it; tasks that waited for it no longer do). Without `board`, the conversation's own board. A board of this conversation goes without a question; one for all the agent's conversations, or for all agents (only the main agent's to remove), is put to you first, in every mode. A sub-agent of a pool that works on a task that goes is stopped, and a board a pool is at work on cannot be removed until its call has come back. Not for a sub-agent, nor for a run started from outside. What is removed cannot be brought back. |
| `board_answer` `id` `text` [`all`] | Answers the question a blocked task waits for: the answer becomes a note about the task, and the task is open again. Whoever takes it next is shown the question and the answer, as settled. With `"all": true` the answer is for the whole job: every other task that waits for an answer is opened again with it, and the tasks that are not finished are shown it, so that one answer does where several sub-agents have the same question. Not for a sub-agent: a question is answered by whoever gave out the work. |

Without `board` every one of them means the conversation's own board.

A task has one of these states:

| State | Meaning |
|---|---|
| `open` | Nobody has it. It is *ready* when every task named in its `after` is done; until then it waits for them. |
| `taken` | One run has it. |
| `done` | It has a result. |
| `failed` | It has the reason. A task that waits for a failed one stays open and is never ready, until you reopen the failed one or remove it. |
| `blocked` | It waits for an answer to the question in it. The agent that gave out the work answers with `board_answer`, or you in the Board tab: the answer becomes a note on the task, and the task is open again. |

## Nothing stays taken

A task is taken by a run of pine's (a task in `pine tasks`), not by an agent's word. When that
run ends, for whatever reason, the daemon looks at what it still holds: a task it did not
settle is open again. A task taken in a conversation is therefore taken for that turn. After a
restart of pine every task that was taken is open.

Two runs that ask for the same task at the same moment never both get it.

## A pool of sub-agents

`subagent` runs `subagents.maxParallel` sub-agents at a time: pine's setting `limits.maxSubagents`
(Settings > General > Limits, 4 unless you changed it), or what the agent's `agent.json` says. With
`"pool": true`, or simply with more tasks than run at once, it takes up to `limits.maxPoolTasks`
(100 unless you changed it): they go onto the
conversation's board, and that many sub-agents at a time work through them. Tasks that were on the board already (yours from the
Board tab, or posted with `board_post`) are worked too, and a call with `"pool": true` and no
tasks goes on with what is there.

A job that is split into more than a hundred tasks takes a higher `limits.maxPoolTasks`, or a
second call for the tasks beyond the hundred.

Tasks on another board, such as a board for all agents on which an agent was given tasks, are
worked where they are: `subagent` with their numbers in `ids` (all of one board) gives each to a
sub-agent, and that sub-agent's answer settles that very task on that board. On such a board the
pool works those tasks and nothing else there, since the others may be somebody else's, and
`tasks`, `note` and `check` of the same call go onto that board too. A call with no tasks goes on
where the last one worked. Copying such a task's text into `tasks` would make a new task on the
conversation's board, and the one that was given out would stay open: the tool's description
tells the agent to use `ids` instead.

```
subagent(ids: [2, 3])
```

```
subagent(tasks: ["Check src/components/a for ...", "Check src/components/b for ...", ...40 more], pool: true,
         note: "The design tokens (src/styles/tokens.css): --space-1 4px, --space-2 8px, --space-3 16px; --color-text #111827, ... Report a spacing or a color only when it is none of these.")
```

All the tasks go into one call. (An agent that splits them over several calls in one answer
still gets one pool: the later calls add their tasks to the first.)

Sub-agents that start together cannot tell each other anything in time: each decides how it
works in its first moments. So what all of them need is said once, before any starts, in
`note`, and in full: the values and the rules themselves, not where to find them, so that no
sub-agent has to look them up again. It goes onto the board as a note for the tasks of that
call (a second round on the same board, such as a check after the work, has a note of its
own), and a call that has a `note` is a pool whether it says `pool` or not. Every sub-agent
goes by it, so a note that is wrong is wrong for all of them: the agent is told to say there
only what it read itself or you told it. If you know what they should measure against, say so
in your message.

### What a pool call takes

| Argument | What it does |
|---|---|
| `tasks` | The pieces, all side by side: one task for each sub-agent. |
| `stages` | Instead of `tasks`, for pieces that build on others: a list of lists. The tasks of a stage run side by side; a stage starts when the one before is done (and checked), and its sub-agents are shown what came of it. See "Stages". |
| `note` | What all of them go by, said once and in full. See below. |
| `check` | A second sub-agent checks each task's result and says PASS or FAIL. What fails is done again with what the check found. One more sub-agent for each task: for pieces written under rules, not for pieces that only read and report. See "A check after the work". |
| `verify` | One last check of the finished whole, by a sub-agent that did none of it. See "A check of the whole". |
| `pool` | `true` with no tasks: go on with what is on the board (after a question was answered, or for tasks that were posted with `board_post`). |
| `ids` | Tasks that are on a board already, by number. |

### The agent stays in the loop

The call does not wait for the last task. It comes back to the conversation

- when a sub-agent **asks a question**: a wrong choice would make its result wrong and looking
  does not settle it (a value its task needs is given nowhere, the task can mean two things
  that give different results). It called `board_done` with `blocked` and its question, and
  stopped. An answer whose last line is a question counts the same: pine settles that task as
  blocked, not done, so that a question is never left in a result where it looks open and
  nothing waits for it. Small things it decides itself and says what it assumed, and what is
  simply not there (a file the task names) it reports as its result;
- when a sub-agent **fails**;
- or when nothing is left to do.

It comes back with what is settled since the conversation last looked, each result once and
under what its task was in the task's own words (a result often does not say which piece it is
about), and
with every question that is open, each time until it is answered. The other sub-agents work on
meanwhile; no new ones are started until the conversation calls again.
The agent answers the question with `board_answer`, from what it knows for sure, can look up or
was told by you. A value or a choice that nobody gave it is yours: it asks you first and passes
on what you say (only `board_answer` puts the task back to work). Where other tasks have or
will have the same question it answers with `"all": true`: those that asked are opened again
with it, and a sub-agent that was still at work and asks the same a moment later has its task
given out again by pine itself, once, without a turn of the agent. A sub-agent of another task
is shown such a question as what another task asked, with its own task named again after it,
so that it goes by the answer and does not take that other task for its own. When all tasks are
done, the pool's answer reminds the agent that a result which left something out or assumed a
value given nowhere is not finished: the value is yours, so it asks you and has those pieces
done again. Where its answer is the
result already, the agent closes the task itself with `board_done`. Then it calls `subagent` with
`"pool": true` and no tasks: that call takes over the sub-agents that are still at work, gives
the answered task to a new one, which is shown the question and the answer, and goes on.

- pine takes each task for the sub-agent it starts for it, and that sub-agent's final answer is
  the task's result. A sub-agent that never mentions the board leaves it right all the same.
- With its task a sub-agent is shown, when it starts: what came of the tasks its task waited
  for (`after`), the notes about its task, and the notes on the board that are for it: the
  `note` of the call its task came with, and what was posted for all with `board_post` (the
  last 12).
- A sub-agent that fails leaves its task `failed`, and what waits for that task is never
  started. One that is stopped leaves its task open.
- A sub-agent that fails because the model server refused it for now (a rate limit, an
  overload, a connection that dropped) did not fail at its task: the task is given out again
  after a few seconds, twice at most, and the agent is not called for it. A limit of your
  account (a quota, a balance) is not asked again.
- A task you add in the Board tab while the pool runs is worked like the others. A task you
  take back there is given to a new sub-agent; one you remove stops the sub-agent that has it.
  A question you answer there is as good as the agent's answer.
- When the agent's turn ends while sub-agents are still at work (it asked you something and
  waits), they finish their tasks, and the agent is told of the results at its next pool call.
  When you stop the conversation, its sub-agents stop with it and their tasks are open again.
- One call starts at most `limits.maxPoolTasks` sub-agents (100 unless you changed it). `pool` and `worktree` do not go together.

> Find out what this project's design tokens are. Then check every folder in `src/components`
> for spacing and colors that do not match them, with a pool of sub-agents, one task per folder.

Ask it that way round: first what they measure against, then the pool. An agent that is told
to let its sub-agents choose a reference tends to choose one for them without looking.

### Stages

Pieces that build on others are given as stages: first the base, then what uses it, then
putting it together.

```
subagent(stages: [["Write src/money.js as SPEC.md says ..."],
                  ["Write src/cart.js ...", "Write src/tax.js ...", "Write src/discount.js ..."],
                  ["Write src/invoice.js and src/index.js ..."]],
         note: "Amounts are whole cents, made and read only through src/money.js ...",
         verify: "Import src/index.js and run every example of SPEC.md. Report each that differs.")
```

- The tasks of one stage run side by side.
- A stage starts when every task of the one before is done, and with `check` when their checks
  are done too. A check that fails gives the work out again, and the next stage waits for that.
- A sub-agent of a later stage is shown what came of the stage before: each result, cut short
  when there are many (`board_read` with a task's number shows one in full).
- A task of a stage that fails keeps the stages after it from starting: the agent is told, and
  posts the task again or goes on without it.
- `tasks` and `stages` do not go together: a call has one or the other.

By hand it is the same thing: a task posted with `after` (`board_post` with `"type": "task"`)
waits until the tasks it names are done, and whoever does it is shown their results.

### A check after the work

What a sub-agent says it did is a claim. With `check`, every task of the call is followed by a
second task for another sub-agent, which starts as soon as the work is done and is shown the
task and what came of it:

```
subagent(tasks: ["Summarise book/ch1.md in two sentences into summaries/ch1.md", ...],
         check: "Check the summary against its chapter, fact by fact, and count its sentences.")
```

> For each of the six chapters in `book/`: have one sub-agent write a summary, and a second
> one check that summary against the chapter. Tell me what the checks found.

A check changes nothing and does not do the work again. It says what is wrong and ends with one
word on a line of its own, `PASS` or `FAIL`. When the check of a task fails, the task is given
out again with what the check found, and checked again when it is done:

| The check ends with | What happens |
|---|---|
| `PASS` | The agent is told in one line that the task's check passed. |
| `FAIL` | The task is done again, by a new sub-agent, which is shown what the check found and what was answered before. The task itself is unchanged: one that was to look and report is done again as that, and changes no file. When it is done the check runs again. No turn of the agent is needed for this, and tasks that wait for the work (a later stage) wait on. |
| `FAIL` again after the task was done a second time | The check's report goes to the agent, which decides what is done about it. A slip is settled by one more try with the check's findings; what fails twice is mostly a rule that can be read two ways. |
| Neither word | The check is a report: the agent reads it with the work's result. Nothing is given out again by itself. |

So "write it, have it checked, fix what is wrong, check again" is one call, and what comes back
is the result as it stands after the checks, with a note on which tasks had to be done again.
A call that has a `check` is a pool whether it says `pool` or not.

A check judges the work, not what the work was about: for a task that was to find faults, PASS
means the faults were found rightly, not that there were none. And it costs a second sub-agent
for every task. Use it for pieces that are written under rules which a second look catches (a
text of a set length, a file in a set form). For pieces that only read and report, one check of
the whole (below) costs one sub-agent and finds the same kind of slip in a sample.

### A check of the whole

`verify` adds one more task, after everything else of the call: a sub-agent that did none of
the work checks the finished whole against what is said in `verify` (run it, count it again,
compare it with the source), and ends with `PASS` or `FAIL`.

```
subagent(tasks: [...one per region...],
         verify: "Recompute three regions of your choice from raw/ and compare them with clean/. Add up totals.json again.")
```

A check, of a piece or of the whole, is told that FAIL is for what can be pointed at (a wrong
fact or number, a rule that is broken, a part that is missing), and that a matter of taste or
wording is a remark.

Its verdict comes back to the agent with the results. It is always the last thing done: tasks
that are added while it waits are done before it. Nothing is given out again by itself
after it: what it found wrong, the agent hands out as new tasks, with a `verify` again. After
three checks of the whole that failed one after the other no further one is made: a check
that never passes (a rule that is a matter of taste) is not asked again and again, and the
agent is told to give you the result as it stands with what the last check still found. A call
with `verify` and no tasks checks what is there already: the work on the board, or what the
agent did itself.

A check of each piece finds what is wrong inside a piece. A check of the whole finds what is
wrong between them: two pieces that do not fit, a piece that is missing, a total that does not
add up. A job can have both.

## A swarm

`/swarm` and what is to be done, typed in a conversation, makes its agent the lead of a swarm:
it hands the job out to sub-agents on the conversation's board, answers what they ask, and
puts the result together. A job of a few steps it does itself. Either way pine has its answer
checked before the swarm is done.

```
/swarm Write a test file for each of the 16 modules in src/, and make sure they all pass.
```

A normal message leaves it to the agent whether it uses sub-agents, a pool, checks. A swarm
does not: the agent leads and coordinates the sub-agents instead of doing the work itself
(all but a job of a few steps), the work goes over the board, pine looks at the board each time the lead ends a
turn, and the answer is checked before the swarm is done. That is what `/swarm` adds to asking
for sub-agents in your message:

| pine finds | What it does |
|---|---|
| Tasks on the board that are not done | It calls the lead again, with their numbers. A swarm does not end with work lying open. |
| A task that waits for an answer, and the lead ended its turn with a question to you | The swarm waits. Your answer is its next turn. |
| All done, and the lead has answered | It puts a check of that answer on the board (your job in your words, what you answered or wrote while the swarm worked, and the answer in full) and starts a sub-agent for it itself: one that did none of the work. The lead has no turn for this. |
| The check passed | The swarm is done, and the answer you have stands. |
| The check failed | It calls the lead with the number of the check. The lead reads on the board what was found, corrects a slip in its answer itself, hands work that is wrong out again, and gives you the whole answer again. That answer is checked once more: two checks in all. If the second fails too, the swarm ends, and its last line names the task on the board that says what was still found. |

What is checked is the answer you read, against what you asked and against what was left (the
files, the numbers). A check fails for what can be pointed at (a wrong number, a broken rule, a
part that is missing, an item a list has twice); taste, wording, layout and how the work was
done are remarks, and what the check cannot reach (another agent's files) it says it could not
check, without failing the answer for it. It is a check of the answer because a check before the answer was written would pass a name the lead left out
or a number it copied wrong while putting the pieces together. No model is asked whether the
job is done (as the judge of a goal is): the board says so.

The check runs on the agent's own model unless you set another for it: `defaults.checker` in
`pine.json`, which the main agent sets for you when you ask it. A second look by the same model catches slips,
which is most of what goes wrong; it does not catch what that model reads wrongly every time.
A check on another model does, at that model's speed and price.

The lead is told how a swarm works with your message: to look first; to do a job of a few
steps itself, unless your request says to use sub-agents; to hand out a larger one in one `subagent` call (`tasks` or `stages`, a `note`
with every decision two pieces have to agree on, and `check` only where every piece is written
under rules) and then to do none of its pieces itself; to ask you for a value the job needs
that is given nowhere before it hands the job out; and to answer in full, since that answer is
what gets checked. While a swarm is at work every `subagent` call of the conversation goes
over the board, however few tasks it has (not with `worktree`), and so does work the lead hands
to another agent with `delegate` without a `thread`: the lead waits for it, and it is a task on the board that the other agent's
answer settles.

| Command | What it does |
|---|---|
| `/swarm <what is to be done>` | Starts a swarm in this conversation. One that was there is replaced. At most 4000 characters: put details into a file and name the file. Refused for an agent without sub-agents (`subagents.enabled`), and when `defaults.checker` names a model that is not there: the checker is looked up before the work starts. |
| `/swarm` | Shows the swarm and where it stands. |
| `/swarm pause` | No further rounds. A round that is running ends by itself, and so does a check of the answer; `esc` stops a round at once. |
| `/swarm resume` | Goes on with a swarm that stopped: paused, at its limit, or waiting for your answer. Where the check of the answer passed meanwhile, the swarm is done at once. |
| `/swarm clear` | Takes the swarm off the conversation. Its board and what is on it stay. |

A swarm stops by itself, and says why:

| What happened | What the swarm does |
|---|---|
| It has had its rounds | It stops after `limits.swarmRounds` turns of the lead (8) with work left. `/swarm resume` gives it as many again. |
| You stopped the agent (esc, `/stop`), or a round failed | It is paused. |
| The check of the answer was stopped, or could not be done (the model server refused it for good) | It is paused, and that check does not count as one of the two. One the model server refuses for now, pine starts again after a pause. |
| pine was stopped or restarted | It is paused. Nothing goes on unseen after a restart. |
| The conversation was reset or removed | The swarm is gone with it. |

Only you start a swarm: there is no tool for it, so an agent cannot make itself one or give
itself more rounds. If your owner asks you, as an agent, to "swarm" something, tell them to
type `/swarm` with the job. A swarm is not started in a conversation that works on a goal
(`/goal clear` first). Other
programs use `POST /agents/<id>/swarm` of the control API ([operations.md](operations.md)).

A swarm costs more than one agent doing the job: every sub-agent reads its task and the files
anew, and the check of the answer is a run of its own. It is for jobs with many pieces, for
pieces that can be written side by side, and for results that have to be right. For a question
or a change in one file, write a normal message.

## When a pool pays, and what it costs

Boards are not always the better way, and a swarm is not. Eighteen jobs were run on pine three
ways, each twice, on a small fast model (Claude Haiku 5.5, four sub-agents at a time): without
boards (plain `subagent`), with boards as an agent uses them by itself after a normal message,
and as a swarm. Every job was scored against what is known to be right.

| Jobs | Without boards | With boards, by a normal message | As a swarm |
|---|---|---|---|
| One agent is enough (11 jobs: a question, a change in a few files, a report over a few dozen short files, a small library) | 98.8% right, 162 seconds for all of them | The same, as it should be: the agent uses no board for these, and having them costs nothing (98.8%, 158 seconds) | 99.4% right. The lead does these itself: its answer is on the screen after 192 seconds, and the check of it ends at 289, about 9 seconds a job later |
| The result has to be right, or something is missing that only you know (4 jobs: texts under rules, a test file for each of 16 modules, sums with an exchange rate nobody gave) | 94.3% right, every part right in 63% of the runs, 150 seconds, 3.5 cents | Everything right in every run, 140 seconds, 4.2 cents | Everything right in every run, 145 seconds, 3.7 cents |
| Many pieces (24, 60 and 100 folders checked against one reference) | 80.1% right, every part right in 67% of the runs, 340 seconds, 7.8 cents, in up to 28 calls | Everything right in every run, 203 seconds, 7.2 cents, in one call each | Everything right in every run, 289 seconds, 9.0 cents |
| All 18 | 94.7% right, every part right in 78% of the runs, 651 seconds, 13.9 cents | 99.3% right, 92% of the runs, 501 seconds, 13.8 cents | 99.6% right, 94% of the runs, 722 seconds, 17.0 cents |

(Without boards the large jobs vary most: over eight earlier runs of each job it was 97.8%
right in 790 seconds.)

What the check of a swarm's answer did over all 252 swarms: 276 checks, 27 of which failed
the first answer. Twenty-two found something real that the lead then put right (totals a cent
off, a clean folder listed as faulty, a count that contradicted its own list, wrong numbers
in a report); five were false alarms, which cost a turn and changed no result. Given answers
with one error put in, the check failed 36 of 36 and passed 15 of 16 right ones.

A check on the agent's own model does not catch what that model reads wrongly every time: an
answer that sorted three incidents under the wrong cause, and a fix that left a fault no test
shows, passed it four times of four. Another model as the checker (`defaults.checker`) failed
both four times of four, and in two rounds with it every part of every job was right in all 72
runs, for 76 cents a round where the others cost 14 to 17.

Blind judges were shown the answers of each job under letters, with what they cost and the
automatic score. A panel of a larger model rated the results 7.9, 8.6 and 8.6 of 10 (without
boards, with boards, swarm) and the efficiency 7.5, 8.1 and 7.9, and preferred them 7, 13 and
8 times; on the jobs with many pieces it rated the efficiency 4.7, 8.3 and 6.8 and never
preferred the one without boards. The swarm with the other checker it rated 8.8 and 4.6. A
panel of the small model itself rated the results 7.9, 8.6 and 9.0 and the efficiency 7.3,
7.6 and 6.2, and preferred the one with boards 33 times, the one without 30 times and the
swarm 24 times, with 21 ties.

On a model that takes longer for each step the seconds are larger and the gaps wider: what a
pool and a swarm save is turns of the agent, and what they add is sub-agents that work side
by side.

What boards cost when they are not used: about 1 000 tokens in every request, an eighth of
what pine's tools take, for the tools' declaration. A sub-agent of a pool is given about 150
tokens with its task. A question costs the agent a turn, a `check` one more sub-agent for
every task, `verify` one sub-agent, and the check of a swarm's answer one sub-agent (and a
turn of the lead only when it found something).

So:

- A question, a change in one place, a job one agent does in a minute: a normal message. A
  swarm gets the same result there and adds the check of it, some seconds each time.
- Up to four tasks, each clear: plain `subagent`.
- Many pieces: a pool, which the agent takes by itself. From a few dozen on it takes about
  half the time of calls of four, in a tenth of the calls, costs no more, and every piece is
  accounted for.
- A result that has to be right, a job in which something may be missing that only you know,
  or one too large to look over yourself: `/swarm`. The check of the answer is what catches
  the slip, and the lead asks you instead of reporting around a gap. Where a wrong reading
  would cost you, have the check run on another model than the agent's (`defaults.checker`).
- Every piece checked by a second sub-agent (`check`) only where the pieces are written under
  rules: it doubles the sub-agents.

## Several agents on one board

For one job, hand it on: a task an agent gives another with `delegate` (without `thread`) works
on the board of the conversation it came from, for that run. The specialist reads the notes
that are there and leaves its own.

For work that keeps coming, use a board with a name. The main agent makes one for all agents;
agents post tasks on it and take them. An agent takes a task when something tells it to: you,
a schedule ("every morning, take what is ready on the board bugs"), or an event.

### Events of a board

A board with a name that an agent or all agents have says what happens on it as events. Only
pine publishes on these topics: `publish_event` and a route's `publish` refuse them.

| Topic | When |
|---|---|
| `board/<name>/task` | A task can be taken: it was posted and waits for nothing, or it is open again. One that is open again comes with what was noted about it since, such as the answer to its question. A task that waited for others is not announced when they are done |
| `board/<name>/note` | A note was posted |
| `board/<name>/done`, `board/<name>/failed`, `board/<name>/blocked` | What became of a task |

The payload has `board`, `scope`, `owner` (the agent, for an agent's board), `id`, `by`,
`holder` (while somebody has the task), and `text`: a line that says what happened, then the task, the note or the result. A conversation's
own board and a board for one conversation publish none of this.

A route wakes an agent when somebody posts a task ([events.md](events.md)):

```json
{ "name": "bugs", "on": "board/bugs/task", "agent": "fixer",
  "prompt": "{{payload.text}}\n\nTake it with board_claim, fix it, and settle it with board_done." }
```

## What a board does not get around

- **The outside-content mark.** A post carries the mark of the run that wrote it: one that had
  read outside content, or that an event from outside started. Whoever is shown that post is
  marked too, exactly as if it had read the page itself ([security.md](security.md)). So is a
  conversation whose pool worked a task that such a run posted, and a sub-agent that a pool
  starts with such a task, such a note, or the result of such a task that its own waited for. Listing the boards (`boards`)
  marks nobody.
- **Trust.** An event of a board has the trust of what was written: owner for a post from one
  of your own conversations that had read nothing from outside, untrusted otherwise. A route on
  it runs the agent accordingly.
- **Runs started from outside.** A run that an outside event started has no board tools, unless
  its agent's `untrusted` profile says `"board": true` ([configuration.md](configuration.md)).
  Then it reads and posts, what it posts counts as coming from outside, and it makes no board
  beyond its own conversation.
- **What is asked.** The conversation's own board is its list of work, like `todo`: its tools
  are never asked about, and they work in plan mode. A call that names a board (`board`)
  changes something other conversations read: it is asked about in manual mode and refused in
  plan mode, like any change inside the agent's own folders. `board_remove` is asked about in
  manual mode and refused in plan mode on any board, and on a board others use it asks you in
  every mode.
- **Other agents' files.** A board holds text. It opens no folder, and a result that names a
  file names it for whoever can read it.

What is on a board is information from others, not instructions, and the tools say so. That
is a sentence to a model, not a wall: a task is text an agent will follow. This is why a task
from a run that had read outside content marks the run that takes it.

## Limits

| What | Limit |
|---|---|
| A task's text, a result | 4000 characters. A pool call with a longer task is refused and says what to do (what all tasks share goes into `note`, what is long into a file); a longer result is cut and says so in its last line. The check of the whole that pine posts in a swarm holds the lead's answer whole up to 12 000 characters, so that nothing it lists is taken for missing; of a longer one the first and the last 6 000, with a line that says what was left out between them |
| A note | 2000 characters. The `note` of a pool call: 8000, and each sub-agent is shown it whole, as it was written; a longer one is refused |
| Posts on one board | 500. Remove what is finished (`board_remove` with an `id`), or use a new board |
| Boards | 200. Remove the ones whose work is finished (`board_remove`, or the Board tab) |
| Sub-agents started by one `subagent` call with `pool` | `limits.maxPoolTasks` (100) |
| A task given out again because its check failed | once; then the check's report stands |
| A task given out again because the model server refused its sub-agent for now | twice, after 4 and 8 seconds; then it is failed |
| Turns of the lead in a swarm | `limits.swarmRounds` (8); `/swarm resume` gives as many again |
| Checks of the lead's answer in a swarm | 2 |
| Checks of the whole that fail one after the other on a board | 3; then no further one is made |

## From the control API

The owner's own hand, with the token ([operations.md](operations.md)). Every board is yours to
read, and what you post is yours.

| Endpoint | What it does |
|---|---|
| `GET /boards` | Every board with its counts, and in `tasks` where each task stands (`id`, `state`, `after`, `waits`, `run` and `holder` while somebody has it, who posted it in `by`, when in `created`, since when it stands so in `updated`, how many notes are about it in `notes`, `asked` when it asked something, and `outside` when it carries outside content), without a word of what it says: what a UI needs to draw a board |
| `GET /boards/<id>` | One board with its tasks and notes. A task says who has it (`holder`, `run`, `sub` for a sub-agent), what it waits for (`waits`), and whether what is in it came from a run that had read outside content (`outside`) |
| `GET /agents/<id>/boards?session=` | The boards that conversation can use, its own first |
| `POST /agents/<id>/boards/post` `{ session, text, kind?, after?, on? }` | A task (or with `kind: "note"` a note) of yours on that conversation's own board, which is made if there is none |
| `POST /boards/<id>/post` `{ text, kind?, after?, on? }` | The same on a board by its number |
| `POST /boards/items/<n>` `{ action, text? }` | `reopen`: take a task back so that it can be taken again; `answer` with `text`: answer a blocked task; `done` with `text`: settle it by hand; `remove`: take a task or a note off the board. A sub-agent that a pool started for that task is stopped |
| `POST /boards/<id>/remove` | Remove a board with everything on it. A sub-agent that a pool started for one of its tasks is stopped |
| `GET /agents/<id>/swarm?session=`, `POST /agents/<id>/swarm` `{ session, objective }` or `{ session, action }` | A swarm: where it stands, start one on a job, or `pause`, `resume`, `clear` it ([operations.md](operations.md)) |

A UI that is running is told on `pine/board` which board changed (`board`, `scope`, `agent`,
`session`, `name`, `change`) and which post (`item`, `kind`, and for a task its `state` now),
never what the post says, and asks for the rest; that event is not kept.
