# Agents

An agent is a folder under `agents/` in pine's home. The folder name is its id: lowercase
letters, digits, `-` and `_`, starting with a letter or digit (`create_agent` wants a letter
first and 2 to 31 characters).

```
agents/gonzo/
  agent.json     settings (see configuration.md); {} is enough
  workspace/     where it works, and the files it keeps itself:
    AGENTS.md      its purpose and how it works
    SOUL.md        who it is: character and tone
    TOOLS.md       how it uses its tools, on top of the TOOLS.md for all agents
    MEMORY.md      what should outlive a conversation
  skills/        its own skills, one folder each
  conversations/ what was set up for one conversation alone; made when needed
  extensions/    optional: its own pi extensions
  AGENTS.md      optional: rules of yours that the agent cannot change
```

## Creating an agent

Ask the main agent ("create an agent that keeps my books"): it calls `create_agent`, you confirm,
and the folder above is made with the instructions in `workspace/AGENTS.md` and the other three
files empty. The agent exists at once and its conversation opens in a tab. To change, rename or
remove an agent, ask the main agent too ([setup.md](setup.md), "Changing and removing an agent",
"Renaming an agent").

By hand: make the folder with an `agent.json` (`{}` is enough) and a `workspace/AGENTS.md`, run
`pine check`, and restart.

## Meeting an agent

A new agent introduces itself once, before answering your first message. The first time you
write to an agent (the main agent too), a note in front of your message tells it to begin its
answer by introducing itself in two or three sentences: its name, what it is for, what it
can do for you. This happens once per agent, after a turn that ended well; events, tasks from
other agents and sub-agents do not count. An agent that has answered you before does not do it.
No agent starts a conversation by itself.

| Key | Meaning |
|---|---|
| `defaults.introduce` | `false` in `pine.json` (or `set_setting`): no agent introduces itself |

The main agent's main conversation begins with pine's welcome: what the main agent is for, what
pine is for (chatting, code, acting on events), a prompt to try, and where pine's home is. pine
wrote it; the model does not read it ([desktop.md](desktop.md), "The first start").

## The files an agent keeps itself

An agent's instructions are files at the top of its workspace, and the agent writes them itself.
They are read into its prompt in every conversation; a change counts from its next message.

| File | Holds |
|---|---|
| `workspace/AGENTS.md` | Its purpose and how it works. You shape it by telling the agent ("your purpose is ...", "from now on answer in tables") |
| `workspace/SOUL.md` | Who it is: character, tone, how it sounds |
| `workspace/TOOLS.md` | How it uses its tools: its own defaults and preferences, on top of the `TOOLS.md` for all agents |
| `workspace/MEMORY.md` | What matters beyond a conversation: decisions, facts, preferences, open ends. Written by the agent |
| `agents/<id>/AGENTS.md` | Optional. Your rules, which the agent reads and cannot change |

To change another agent's files, tell the main agent how that agent should work, be or sound: it
replaces them with `update_agent` (`instructions`, `soul`, `tooling`). The four start empty; an
empty or missing file is left out. Anything else in the workspace is the agent's own notes. The
agent is told to write what matters into `MEMORY.md` at once, and pine reminds it to tidy the file
when it passes about 6 000 characters, since all of it is read with every message.

A conversation that has read outside content (a web page, somebody else's message) changes these
files in `safe` mode only after your yes, asked once for the conversation; a sub-agent goes by its
conversation's answer. In `auto` and `bypass` mode it writes them without asking
([security.md](security.md), "Its own memory and instructions after outside content").

### What holds for all agents

A rule, preference or default for every agent is not a setting: tell the main agent, and it writes
it into one of three global instruction files in pine's home. Every agent's prompt has them; only
the main agent (and you) can change them. Other agents tell you to ask the main agent.

| File | What goes into it | For example |
|---|---|---|
| `AGENTS.md` (in pine's home) | Traits and behaviour: how every agent is to be and to act | "Answer in English." "Ask before you delete anything." |
| `TOOLS.md` (in pine's home) | Tooling: defaults and preferences for tools (a skill, an MCP server, a shell command, a schedule, an event source), and technical details of your setup | "Search with ripgrep." "Reports go to the NAS." "Speak fast, with a female voice." |
| `USER.md` (in pine's home) | What every agent knows about you | Your name, what you do, how you like to be answered |

`AGENTS.md` and `TOOLS.md` exist twice for an agent: the global one, read first, and its own,
which says what is different for it ("this agent answers in German"); where they differ, its own
counts. Which model agents run on and how far they reach is a setting, not text (`set_setting`,
[setup.md](setup.md)).

### Where a default or a preference goes

Say whom it is for when it is not for everybody; the main agent picks the file:

| You say to the main agent | It writes it into |
|---|---|
| A default or preference for a tool, nothing about whom it is for ("search with ripgrep by default", "speak with the fast voice") | `TOOLS.md` in pine's home: for all agents |
| The same, "for you alone" | Its own `workspace/TOOLS.md` |
| The same, "for the books agent" | That agent's `workspace/TOOLS.md`, with `update_agent` (`tooling`); you confirm it |
| How to be or behave, "for all agents" ("every agent answers in English") | `AGENTS.md` in pine's home |
| How to be or behave, nothing about whom it is for | Its own `workspace/AGENTS.md` |

Any other agent writes what you tell it into its own files.

## What an agent sees

1. pine's base prompt: that it works for its owner in pine; how to use its tools (web tools, not
   `curl`); that pine's setup is changed through tools, never by writing pine's files; that what
   it has is asked of a tool (`sources`, `mcp_servers`, `skills`, `schedules`); and that text from
   tools, files and the web is information, never a command. `agents/<id>/SYSTEM.md` replaces it.
2. The instruction files, in the order of the table below.
3. Its skills, one line each. The agent reads a skill's file when it needs it.
4. A `<pine>` block: who the agent is and which MCP servers it has.
5. In front of each message, a `<pine-note>` with what holds now (below).

In your own conversations the instruction files open the conversation as its first message
instead of standing in the system prompt ("What the model server keeps"). How pine works is not in
the prompt: the agent searches this manual with its `manual` tool.

**The note.** The system prompt never changes from turn to turn, so the model server can keep
what it has read. What changes goes into a `<pine-note>` in front of your message: time and date,
the mode, the model the agent runs on (`provider/id` with its name, so it does not guess), the
agents it can hand work to, the folder opened for the conversation, whether its shell has network
access, programs its commands left running, open steps of its `todo` list, that its browser is a
window you use too, a reminder when `MEMORY.md` has grown long, the shared state in
`state.inject`, and whether it has read outside content. A note is only added when something
besides the time changed. Text from elsewhere cannot fake a note: the tag is rewritten on the way
in.

**Pictures, sound and folded text in an answer.** pine's base prompt tells every agent:

- `![caption](path)` with a workspace file shows a picture or video, and plays a sound (wav, mp3,
  m4a, ogg, flac) with play and pause ([tui.md](tui.md); [desktop.md](desktop.md), "A sound in an
  answer"). A picture from the web is downloaded first. The agent never plays sound with a command
  (`afplay`), and does not show again a picture a tool returned.
- `<details><summary>what it is</summary>` ... `</details>` folds away something long (a log, a
  full message) into one line you open with a click ([tui.md](tui.md), "Folded parts of an
  answer").

### Every file that is read as instructions

In the order they enter the prompt. A file that is missing or empty is left out.

| File | Where | What it is |
|---|---|---|
| `SYSTEM.md` | `agents/<id>/` | Optional, yours. Replaces pine's base prompt for this agent |
| `AGENTS.md` (for all agents) | pine's home | Traits and behaviour for every agent; the main agent and you write it |
| `AGENTS.md` (your rules) | `agents/<id>/` | Optional, yours. Rules the agent cannot change |
| `AGENTS.md` (the agent's own) | its workspace | Its purpose and how it works |
| `CLAUDE.md` | its workspace | Optional. Read like its `AGENTS.md`, for a workspace that is a repository with one |
| `SOUL.md` | its workspace | Who it is: character and tone |
| `TOOLS.md` (for all agents) | pine's home | Tooling defaults and preferences for every agent |
| `TOOLS.md` (the agent's own) | its workspace | Its own tooling, on top of the one for all agents |
| `USER.md` | pine's home | What every agent knows about you |
| `MEMORY.md` | its workspace | What should outlive a conversation |
| `AGENTS.md`, `CLAUDE.md` of an opened folder | the folder you opened for a conversation | The project's instructions, for that conversation ([coding.md](coding.md)) |
| Files named in `context` | anywhere `agent.json` points | Further instruction files of yours |
| `SKILL.md` | a skill's folder | Not read into the prompt: one line per skill is; the agent reads the file when it uses the skill |

No other file is read by itself: `IDENTITY.md`, `HEARTBEAT.md`, daily notes and the like are the
agent's own files. Instruction files and skills in your home folder or in folders above the
workspace are not picked up.

### How tools are declared

Every tool an agent has is declared to the model with each request. Declared one by one, the
tools take many tokens of the prompt, which a local model reads before the first word of a new
conversation. So in your own conversations pine declares them in **families**, about half as
large. There is no setting for it.

- Tools nearly every task uses are declared by themselves: `read`, `bash`, `edit`, `write`,
  `grep`, `find`, `ls`, `download`, `delegate`, `subagent`, `todo`, `question`, `manual`,
  `find_tools`, and the two web tools.
- Everything else is grouped. A family is one tool that takes an `action` and that action's
  arguments.

| Family | Its actions |
|---|---|
| `pine_list` | What there is: `sources`, `schedules`, `mcp_servers`, `skills`, `models`, `boards`, and for the main agent `agents`, `settings`, `routes`, `conversations`. `what` takes several at once (`["sources", "schedules"]`) |
| `pine_sources` | `subscribe`, `unsubscribe`, `add_source`, `send`, `read_source`, `remove_source`, `publish_event`, and for the main agent `add_source_type`, `remove_source_type` |
| `pine_schedules` | `add_schedule`, `remove_schedule` |
| `pine_mcp` | `add_mcp_server`, `remove_mcp_server`, `sign_in_mcp_server` (the main agent's), and the three tools for a server's resources |
| `pine_skills` | `add_skill`, `remove_skill` |
| `pine_agents` | The main agent's: `create_agent`, `update_agent`, `rename_agent`, `remove_agent` |
| `pine_settings` | The main agent's: `set_setting`, `add_route`, `remove_route`, `add_decision_model`, `remove_decision_model`, `add_model_server`, `remove_model_server`, `add_model`, `configure_model`, `remove_model`, `sign_in`, `sign_out` |
| `pine_board` | `board_read`, `board_post`, `board_claim`, `board_done`, `board_answer`, `board_remove` ([boards.md](boards.md)) |
| `pine_other` | `request_access`, `stop_program`, `state_get`, `state_set` |
| `pine_conversations` | The main agent's: `read_conversation`, `set_conversation`, `remove_conversation`, `rename_group`, `remove_group` |
| One for each MCP server, named after it (`browser`, `media`, `home_link`) | The server's tools under their own names (`browser_navigate`, `browser_click`) |

This manual names tools by their own names. With families:

- "call `add_source`" is `pine_sources` with `action: "add_source"` and the same arguments;
- "call `sources`" is `pine_list` with `what: ["sources"]`;
- `mcp__browser__browser_navigate` is `browser` with `action: "browser_navigate"`.

Nothing else differs: modes, approvals, `approve` and `deny` lists, plan mode and the terminal UI
all see the tool that is meant. A call with wrong arguments comes back with that action's whole
description. A run started from outside has only the few tools its profile lists, declared one
by one. `SYSTEM.md` and a `tools` list work for both kinds of run.

| Name | What it is |
|---|---|
| `find_tools` | Every agent has it in your conversations. `names`: actions or a whole family. Answers with everything about them: each argument, its limits, examples. For when the family's line is not enough. |

### What the model server keeps

A model server keeps what it has read (the prompt cache) and reads only what is new, as long as
the next request begins the same. On a local model that decides whether an answer starts at once
or after the whole conversation was read again. In your own conversations every request begins
the same: the tools, pine's text, the instruction files as they were when the conversation began.
So these cost nothing: a line written into `MEMORY.md`, a new agent, a new
schedule, an MCP server added to another conversation, a restart of pine. A line added to an
instruction file is told in the note; a rule that was changed or removed, or a `MEMORY.md` that
was rewritten and is longer than 8 000 characters, has that one conversation read again once.

What still costs a full reading: the first conversation after the model was loaded, a tool added
to this conversation, a compacted conversation, and a conversation that lost its place on the
server.

**llama.cpp slots.** A llama.cpp server keeps one conversation per slot (`-np`). pine sends each
request to a slot (`id_slot`): a conversation goes back to its own slot, also after a restart; a
new one takes a slot pine filled for it, else an empty or the cheapest one. When you switch tabs
between more conversations than the server has slots, one is pushed out and read again, unless
`limits.slotPages` keeps it in a file. Another program on the same server keeps its slots, but the
two still push each other out. Other servers are never sent a slot.

| Setting | Default | Meaning |
|---|---|---|
| `limits.warmSlots` | `true` | Filling idle slots: when a llama.cpp server is idle, pine has each empty slot read what a new conversation of the last agent begins with, so the next new conversation or sub-agent reads only its own message. Never while an agent works with that model, never when the model is not loaded. `false` turns it off (in `pine.json`; from the next start). |
| `limits.warmAfterMs` | `3000` | How long the server must be idle before a slot is filled, in milliseconds. |
| `limits.slotPages` | `6` | More conversations than slots: a conversation that loses its slot is saved to a file of the server and read back when it returns, about as fast as copying the file. Needs a server started with `--slot-save-path <folder>`. This many files per server (`pine-<id>-<n>.bin`), reused; 10 000 tokens are about a gigabyte on a large model. `0` turns it off. |

What helps:

- Give the server at least as many slots as pine lets that model work at once (its number in
  `limits.models`, Settings > Models, else `limits.maxConcurrentRuns`), and one more if sub-agents
  are used a lot.
- A server that is stopped and started (a scheduler that swaps models) has read nothing, unless
  the scheduler saves and restores its slots (`--slot-save-path`).

The terminal UI's bottom bar shows `cache N%` after an answer: the share of input the server took
from its cache. In a running conversation it should be above 90%.

### The manual tool

Every agent has a `manual` tool (not in a run started by an outside event). It holds this manual
cut into parts: one per heading, one per table row that describes a named thing (a key, a tool, a
command, an option).

| Call | Answers with |
|---|---|
| `manual` `search: "<a few words>"` | The best parts, each with its id and the sentence that matched. Up to 6 queries at once, one thing each. |
| `manual` `read: "<id of a part>"` | That part in full; up to 8 ids at once. A long part comes in pages (`@2`, `@3`). |
| `manual` with neither | The list of parts. |

A search is by words, not exact wording; words the manual does not use ("cron job", "reminder",
"permission", "watcher") find its own words through synonyms. The source types of this
installation are found too, with their options. When nothing matches it suggests other words.

`pine manual <words>` is the same search in a shell (without the installation's own source
types); `pine manual --read <id>` reads a part.

## Workspaces

Point `workspace` in `agent.json` at the folder the agent should work in, often a repository:

```json
{ "workspace": "~/dev/house" }
```

In `safe` and `manual` mode its shell and file tools read and write there and nowhere else in your
home; in `auto` and `bypass` they reach your whole account ([security.md](security.md), "Modes:
how much an agent does without asking"). Each agent also has a private home (`sandbox/<id>/`),
which is `~` in its sandboxed shell. Agents cannot open each other's workspaces; they work
together through `delegate`. Two agents given the same path share it and can overwrite each
other's files.

To have one conversation work in another folder, open the folder for it (`pine <folder>`, or the
folder in the terminal UI's bottom bar). Its `AGENTS.md` or `CLAUDE.md` then applies beside the
agent's own ([coding.md](coding.md)).

## Sessions

A session is one conversation with history.

| You pass | What happens |
|---|---|
| nothing | The agent's `main` session: one long conversation, compacted by pi when it fills up |
| a name, for example `tg-123456` or `case-okapi` | A separate named conversation |
| `new` | A fresh conversation for that one task; not continued |

Routes pick the session with `"session"`, the CLI with `--session`. Telegram messages arrive in the
conversation that subscribed to the Telegram source. Runs started by untrusted events use a twin
session with `~u` appended, so they never see or extend your conversation.

`pine reset <agent> [session]` (or `/reset`) starts a session over. The old history stays on disk
(`.reset-<time>`) for `limits.eventRetentionDays` but is no longer shown; its finished tasks, with
their sub-agents and one-off delegations, are gone from `pine tasks`. A waiting task runs in the
fresh session. Subscriptions of that conversation alone end.

A named conversation is removed with its history after `limits.conversationDays` (7) without a
message, unless it is an agent's `main`, pinned, in a group, open in a tab, subscribed to an event
source or has a schedule of its own. This holds for every named conversation (yours, a delegation
thread's, one a route names). Pin what you keep (`/pin`, [tui.md](tui.md)), or set
`limits.conversationDays` to `0`. What was set up for that conversation alone goes with it: event
sources, subscriptions, schedules, MCP servers, skills ([setup.md](setup.md)).

### A message while the agent works

A message or event for a conversation that is working is steered into the work: the agent reads
it at its next step, and one answer covers both. A Slack message and a Jira update about the same
issue seconds apart make one run. An event whose answer goes elsewhere (a Telegram message while
the agent works on something else) waits its turn, and so do events of a route with
`"whenBusy": "queue"`. In the terminal UI `alt+enter` makes your message wait its turn. A steered
message the work never read (it ended or was stopped) is answered next on its own.

Your steered message comes with a word from pine to answer it first, briefly. The work reads it
only at its next step, which a long command can delay for minutes. The Pine app shows under it
"not read yet" or "read 14:03", and offers "send now": the step under way is stopped and the work
goes on with your message. Reading is not answering: stop the work if the answer does not come.
Other programs use `POST /tasks/<id>/now` ([operations.md](operations.md)).

When the agent waits for your answer to its `question` ([setup.md](setup.md)), what you type
instead of picking an option answers it: the agent is told "Your owner answered in their own
words: …" and may respond and ask again. Typing an option's label or number counts as picking it.

## Groups of conversations

Groups keep a long list of conversations tidy: named groups under an agent, one level deep (a
coding agent may have one per customer, each with a conversation per project).

- A conversation and its branches are always in the same group and move together.
- A conversation in a group is kept however long it is not used, like a pinned one. The main
  conversation can be in a group too.
- Renaming a group keeps its conversations. **Removing a group removes every conversation in it
  for good**, with what was set up for each; the main conversation stays, in no group. Nothing is
  removed while one of them works. Take a conversation out first to keep it.
- The list is sorted by last use or by name, per agent; main and pinned conversations come first.

| Where | Groups |
|---|---|
| Pine app | Drag a conversation onto a group in the side bar, or Move to Group… in its right click; New Group…, Sort by Last Used and Sort by Name in the agent's menu; Rename… and Remove Group… in the group's ([desktop.md](desktop.md)) |
| Terminal UI | `/group <name>` (made if new), `/group -` takes it out; `/sessions` shows each one's group ([tui.md](tui.md)) |
| Main agent | `set_conversation` with `group`, `rename_group`, `remove_group`; `conversations` lists them ([setup.md](setup.md#conversations-and-tabs)) |
| Control API | `GET /agents/<id>/groups`, `POST /agents/<id>/group`, `POST /agents/<id>/groups` ([operations.md](operations.md)) |

## Branching a conversation

A branch is a new conversation that goes on from a point in another one: to try a second way
without losing the first, or to ask something on the side. It holds everything up to the end of
the message you branched from; from then on the two are separate, and the original is unchanged.

| Where | How |
|---|---|
| Pine app | "Branch from here" in the right-click menu of one of your messages; Branch in a conversation's menu in the side bar, or the command Branch conversation, for all of it. "Branch from here into a worktree" and "Branch into a Worktree" do the same in a worktree |
| Terminal UI | `/branch`: pick one of your messages, or all of it; `/branch <name>`: all of it, under that name; `--worktree` with either |
| Control API | `POST /agents/<id>/branch` `{ session, at?, to?, worktree? }` ([operations.md](operations.md)) |

A branch is named after its original (`notes-branch`, `notes-branch-2`) unless you name it. It
shares the original's folder, so both write the same files; branched into a worktree it works on
its own checkout and branch `pine/<name>`, which you merge back ([coding.md](coding.md), "A
worktree for a conversation").

A branch takes the history, the opened folder, and the outside-content mark as it was at that
point; not what you allowed the original, what was set up for it alone, its goal or its pin.
`/undo` in a branch restores files only for messages said in the branch. Only you branch; agents
have no tool for it.

## Goal mode

Normally an agent ends its turn and waits for you, also when the work is not finished ("shall I go
on?"). With a goal it keeps working by itself until the objective is met. Type in the conversation
(terminal UI or Pine app):

```
/goal all tests in ~/dev/shop pass and the README says how to run them
```

The objective goes out as your message. Each time the agent ends a turn (a **round**), a **judge**
(a short model call without tools) reads your objective and the agent's last answer and says
`CONTINUE` (the agent is called again), `MET` (done) or `BLOCKED` (it needs something only you can
give: answer it, then `/goal resume`). The conversation shows each verdict with its reason; the
status line shows the round.

| Command | What it does |
|---|---|
| `/goal <objective>` | Sets the conversation's goal and starts, replacing one that was there. At most 2000 characters: put details into a file and name it. |
| `/goal` | Shows the goal, the round, the last verdict and its reason. |
| `/goal pause` | No further rounds. A running round ends by itself; `esc` stops it at once. |
| `/goal resume` | Goes on after a pause, a block, the round limit, or a "met" you disagree with. |
| `/goal clear` | Takes the goal off. |

| What happened | What the goal does |
|---|---|
| The judge says "met" or "blocked" | Stops. |
| No verdict (no answer in time, or not one of the three words) | Paused. No verdict never counts as "go on". |
| `limits.goalRounds` rounds (20) | Stops. `/goal resume` gives as many again. |
| `limits.goalIdleRounds` rounds in a row (3) "not met" without a tool call | Paused: the agent is going in circles. |
| You wrote a message of your own (typed or through Telegram) | Paused, so the next round does not overrule you. |
| You stopped the agent (esc, `/stop`), a round failed, or pine restarted | Paused; the goal is kept. |
| The conversation was reset or removed | Gone with it. |

Only you set a goal: there is no tool for it, so an agent cannot give itself one or more rounds.
If your owner asks you, as an agent, to "keep going until it is done", tell them to type `/goal`
with what should be reached. Other programs use `POST /agents/<id>/goal` ([operations.md](operations.md)).

The judge runs on `defaults.judge` if set, else the agent's own model, within
`limits.goalJudgeTimeout`. It only decides whether the agent is called again; what the agent may
do is decided by its mode and approvals as always ([security.md](security.md), "A goal goes on in
your name"). The judge sees only the answer, not the files: say in the objective how to tell it is
reached ("the tests pass", "the file has all twelve entries"). Each round costs a full turn. On a
llama.cpp server with one slot the judge pushes the conversation out of it, unless
`defaults.judge` names another model.

## A swarm

`/swarm <what is to be done>` makes the conversation's agent the lead of a job: sub-agents work it
through on the conversation's board, pine calls the lead again while tasks are open, and a
sub-agent that did none of the work checks the answer. `/swarm pause`, `resume`, `clear`. Like a
goal, only you start one. See [boards.md](boards.md), "A swarm".

## Handing work to another agent

`delegate` hands a task to another agent. By default every agent may hand work to every other
agent except the main one: `delegates` in `agent.json` is `["*"]`, and `*` leaves out the agent
that `main` in `pine.json` names (for the main agent, `*` is everyone else). Name the main agent to
allow it; an empty list takes `delegate` away.

```json
{ "delegates": ["*", "main"] }
```

```
delegate(agent, task, wait?, thread?, worktree?)
```

- The other agent gets only the task text, with who sent it, and works in its own workspace with
  its own tools and instructions. Each delegation starts it fresh; `thread: "okapi"` continues a
  named conversation with it instead.
- The caller waits for the answer. Several `delegate` calls in one message run side by side.
  `wait: false` returns at once; the answer arrives later as a message.
- An agent already waiting further up the chain cannot be called again; chains stop at
  `limits.maxDelegationDepth`.
- `worktree: true` (your conversations with a folder): the other agent works in its own worktree
  of that folder, and its work comes back as a branch to merge. Not with `thread` or `wait: false`.
- Without `thread`, the task works on the board of the conversation it came from
  ([boards.md](boards.md)).

**Mode.** The other agent works in its own mode or the caller's, whichever is stricter (strictest
first: `manual`, `safe`, `auto`, `bypass`), so handing work on never reaches further than the
caller could. A `safe` agent handing to a `bypass` one gets it done in `safe`, in the other agent's
sandbox; a `bypass` caller that has read outside content hands on `auto`. A `thread` held to a
stricter mode is kept apart (`thread-okapi~safe`) and shares no history or MCP servers.

**Outside content.** Once the caller has read outside content, every delegation is put to you
([security.md](security.md), "What asks you"), and the other agent's run is marked too.

**What the caller sees of the other agent**: the first paragraph of its `AGENTS.md`, up to 240
characters (else `description` from `agent.json`). Write it for the delegating model: "You are
gonzo. Contract law; you know the case files in your workspace" works, "Gonzo" does not.

## Sub-agents

Every agent starts its own sub-agents with `subagent`: asked to "create two new sub-agents" or to
"use sub-agents", it just calls it. (`create_agent` makes a new agent that stays.)

A sub-agent is a copy of the agent (workspace, instructions, tools, permissions) with an empty
conversation. It cannot delegate or start sub-agents, and returns only its final answer. Up to
`subagents.maxParallel` run in parallel: `limits.maxSubagents` (4, Settings > General) unless the
agent's `agent.json` says otherwise. With more tasks the call becomes a pool ([boards.md](boards.md),
"A pool of sub-agents"). Use sub-agents for searches and checks that would fill the conversation:

> Find every clause about notice periods in `contracts/`. Use sub-agents, one per file.

| Argument | What it does |
|---|---|
| `tasks` | One task per sub-agent. It sees nothing of the conversation, so each task says what to do, which files (by path), and what to answer. |
| `model` | Runs these sub-agents on a different model than the agent's own, as `provider/model` (the id alone where unique): one that sees pictures, a small fast one for many checks, a bigger one for a hard part. `models` lists them. |
| `thinking` | How much they reason: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Default: the agent's own level. |
| `worktree` | `true`: each works in its own worktree of the conversation's folder (a git repository), so sub-agents that change the same files do not overwrite each other. Its committed changes come back on a branch (`pine/<conversation>-sub`, `-sub-2`, ...) to `git merge`. Not with a pool ([coding.md](coding.md), "A worktree for a conversation"). |
| `pool` | `true`: more tasks than run at once (up to `limits.maxPoolTasks`, 100), worked through on the conversation's board; comes back early when one asks or fails. |
| `note` | What all sub-agents of the call go by, said once and in full. Makes the call a pool. |
| `stages` | Instead of `tasks`, for pieces that build on others: a list of lists, each stage after the one before ([boards.md](boards.md), "Stages"). Makes the call a pool. |
| `check` | A second sub-agent checks each result; what fails is done again once ([boards.md](boards.md), "A check after the work"). Makes the call a pool. |
| `verify` | One last check of the whole by a sub-agent that did none of it ([boards.md](boards.md), "A check of the whole"). Makes the call a pool. |
| `ids` | Tasks already on a board (a board for all agents, say), by number: one sub-agent each, which settles that very task where it is. Makes the call a pool. |

A sub-agent on another model is still the same agent. Hand it a file by its path, also a picture or
a file an event source received ([sources.md](sources.md), "Files a source received"); a model that
sees pictures is shown it. Video and sound are shown to no model: the sub-agent turns a video into
pictures first.

> Have a sub-agent on local/nemo look at the camera clip and describe who is in the garden.

The conversation's own model is changed with `/model`, `update_agent` or `pine agent update`. A run
started from outside has sub-agents only where its `untrusted` profile allows them, on the agent's
own model.

**Permissions.** A sub-agent works under its conversation's permissions (granted access, "always"
answers, the opened folder) and never asks you anything: where you would be asked, it is refused
and says in its answer what it needed, and the conversation can ask you. So allow what sub-agents
need first (`request_access`). In manual mode a sub-agent only reads, unless you answered "always"
for a tool. It has the agent's MCP servers (unless `subagents.mcp` is `false`) and its tools, or
those in `subagents.tools`.

Sub-agents count against the model slots and queue when there are too few; the waiting parent
lends its own slot, so nothing deadlocks.

**Looking at a sub-agent's work.** Each is a task with its own number, like a delegated one. In the
terminal UI a click on the line where it starts or answers (or `/task <id>`) opens its steps;
`pine task <id>` and `GET /tasks/<id>/transcript` show them too. Its session file is in
`agents/<id>/sessions/_tasks/<task id>/`.

## Shared state

Small facts several agents and routes need: who is home, the mode of the house, the state of the
printer. (For shared work, use boards: [boards.md](boards.md).)

- Routes write it: `"set": { "house/mode": "{{payload.value}}" }`.
- Agents read it with `state_get` and write it with `state_set`, within `state.read` and
  `state.write`.
- `state.inject` shows keys to an agent in the note, always current:

```json
{ "state": { "inject": ["house/#"], "write": ["house/#"] } }
```

Values are shown as facts, not instructions, cut to 200 characters. Do not route untrusted text
into a key agents see.

## What an agent's answer does

- The final text of a task is its result; with a reply target, it is sent there.
- `NO_REPLY` (or `SILENT`) as the whole answer sends and shows nothing: for a message that needs
  no answer, such as a notice about something already said.
- A failed task (model error, timeout) sends "`<agent>` could not finish: ..." to the reply
  target. A cancelled task sends nothing.

## pi extensions

Any pi extension works in pine sessions. One that adds a line to every system prompt:

```ts
// ~/.pine/agents/gonzo/extensions/citations.ts
export default function (pi) {
	pi.on("before_agent_start", async (event) => ({ systemPrompt: `${event.systemPrompt}\n\nCite the paragraph for every legal claim.` }));
}
```

Files in `agents/<id>/extensions/` are found automatically; list others under `extensions`. pi's
guide is `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`. Terminal UI features
(dialogs, widgets) do nothing in the daemon. `.pi/extensions/` in a workspace is not loaded; see
`trustWorkspace` in [configuration.md](configuration.md).

## Skills

A skill is a written-down way of doing something: a folder with a `SKILL.md` that starts with a
name and a description.

```markdown
---
name: inverter
description: Read and interpret the inverter's daily export. Use for questions about solar yield.
---

1. The exports are in `data/inverter/YYYY-MM.csv` ...
```

The agent sees the description in its prompt and reads the file when a task calls for it. Files
the instructions refer to (a script, a template) lie beside `SKILL.md`. A fact, not a way of doing
something, belongs in `MEMORY.md` instead.

### Ask the agent

> Remember how to do this: make a skill for filing invoices.

The agent calls `add_skill` with a name, description, instructions and optionally a workspace
folder whose files go along. pine writes the skill into pine's home, which the agent cannot write;
it counts from the agent's next message. The same name again replaces it; `remove_skill` deletes
it.

A skill is for one conversation, the agent, or all agents ([setup.md](setup.md), "Three scopes"):

| Said | Who gets it | You are asked |
|---|---|---|
| "make a skill for this" in a side conversation | That conversation; it goes when the conversation is removed | No |
| the same in the agent's main conversation, or "for you as an agent" | Every conversation of that agent | Only from a side conversation |
| "for all agents" | Every agent. Only the main agent can do this | Yes |

From a conversation that has read outside content, and in manual mode, it is always put to you
first, with its instructions. A name is used once among the skills a conversation would see:
the same name in the same place replaces the skill, and one that exists elsewhere (another scope,
or set up by you) is refused.

### Put it there yourself

A folder with a `SKILL.md` in one of these places is a skill, with no entry anywhere:

| Folder | For |
|---|---|
| `~/.pine/skills/<name>/` | all agents |
| `~/.pine/agents/<id>/skills/<name>/` | that agent |

Agents can replace (`add_skill`) and remove (`remove_skill`) skills in these folders, whoever put
them there. A skill elsewhere is named under `skills` in `pine.json` (all agents) or `agent.json`
(that agent); agents use it but cannot change it.

A name is lowercase letters, digits and single hyphens, at most 64 characters; `pine` is taken.
The description may have 1024 characters, the instructions 40 000. Files that go along: at most
200 and 4 MB together, no links.

`pine skills` lists every skill, whom it is for and where it lies. An agent lists its own with
`skills` ([setup.md](setup.md), "What an agent has").

## Checking on agents

`pine status` shows what runs, `pine tasks --agent gonzo` an agent's tasks, `pine task <id>` one
task in full (prompt, result, error, trust, turns, tokens, tools called, duration), and
`pine events --topic "agent/#" -f` follows what agents do ([operations.md](operations.md),
"Commands").
