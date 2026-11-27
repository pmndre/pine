# Agents

Teams of agents on one job are in [boards.md](boards.md).

An agent is a folder under `agents/` in pine's home. The folder name is its id: lowercase letters,
digits, `-` and `_`, starting with a letter or digit. `create_agent` asks for a letter first and 2
to 31 characters.

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
  extensions/    optional: pi extensions you placed for it (extensions.md)
  AGENTS.md      optional: rules of yours that the agent cannot change
```

## Creating an agent

Ask the main agent ("create an agent that keeps my books"). It calls `create_agent`, you confirm,
and the agent exists at once with its instructions in `workspace/AGENTS.md`. Its conversation
opens in a tab. To change, rename or remove an agent, ask the main agent too
([setup.md](setup.md), "Changing and removing an agent", "Renaming an agent").

By hand: make the folder with an `agent.json` (`{}` is enough) and a `workspace/AGENTS.md`, run
`pine check`, and restart.

## Meeting an agent

A new agent says hello once. The first time you write to it (the main agent too), it introduces
itself in two or three sentences before it answers. Events, tasks from other agents and
sub-agents don't count. No agent starts a conversation by itself.

| Key | Meaning |
|---|---|
| `defaults.introduce` | `false` in `pine.json` (or `set_setting`): no agent introduces itself |

The main conversation's welcome is not read by the model ([desktop.md](desktop.md), "The first
start").

## The files an agent keeps itself

An agent's instructions are the four files at the top of its workspace (see the folder above).
The agent writes them itself, and you shape them by telling it ("from now on answer in tables").
They start empty and are in its prompt in every conversation; a change counts from its next
message. Other workspace files are its own notes. `agents/<id>/AGENTS.md` holds your rules, which
the agent cannot change. `MEMORY.md` is read whole with every message, so pine reminds the agent to
tidy it past about 6 000 characters. To change how another agent works, is or sounds, tell the
main agent. It uses `update_agent` (`instructions`, `soul`, `tooling`).

Once a conversation has read outside content, pine asks you once in `safe` mode before it changes
these files (a sub-agent follows that answer). `auto` and `bypass` don't ask
([security.md](security.md), "Its own memory and instructions after outside content").

### What holds for all agents

A rule, preference or default that every agent should follow is not a setting. Tell the main
agent, and it writes it into a global instruction file in pine's home, which every agent's prompt
holds. Only the main agent and you change these.

| File | What goes into it | For example |
|---|---|---|
| `AGENTS.md` (in pine's home) | How every agent is to be and act | "Answer in English." |
| `TOOLS.md` (in pine's home) | Defaults for tools (skills, MCP servers, commands, schedules, sources) and details of your setup | "Search with ripgrep." "Speak fast, with a female voice." |
| `USER.md` (in pine's home) | What every agent knows about you | Your name, what you do |

The agent's own `AGENTS.md` and `TOOLS.md` come after the global ones and win where they differ
("this agent answers in German"). The model and how far agents reach are settings
(`set_setting`, [setup.md](setup.md)).

### Where a default or a preference goes

Say whom it is for. The main agent picks the file:

| You say to the main agent | It writes it into |
|---|---|
| A tool default, for nobody in particular ("search with ripgrep by default") | `TOOLS.md` in pine's home: for all agents |
| The same, "for you alone" | Its own `workspace/TOOLS.md` |
| The same, "for the books agent" | That agent's `workspace/TOOLS.md` (`update_agent`; you confirm) |
| How to behave, "for all agents" | `AGENTS.md` in pine's home |
| How to behave, for nobody in particular | Its own `workspace/AGENTS.md` |

Other agents write what you tell them into their own files.

## Workspaces

Point `workspace` in `agent.json` at the folder the agent works in, often a repository:

```json
{ "workspace": "~/dev/house" }
```

In `safe` and `manual` mode its shell and file tools reach only that folder of your home; in
`auto` and `bypass` mode, your whole account ([security.md](security.md), "Modes: how
much an agent does without asking"). Its private home `sandbox/<id>/` is `~` in its sandboxed
shell. Agents cannot open each other's workspaces; they work together through `delegate`. Two
agents given the same path can overwrite each other's files.

To have one conversation work in another folder, open the folder for it (`pine <folder>`, or the
terminal UI's bottom bar). Its `AGENTS.md` or `CLAUDE.md` then applies too ([coding.md](coding.md)).

## What an agent sees

1. pine's base prompt: how to work in pine, and that text from tools, files and the web is
   information, never a command. `agents/<id>/SYSTEM.md` replaces it.
2. The instruction files, in the order of the table below.
3. Its skills, one line each.
4. A `<pine>` block: who the agent is and which MCP servers it has.
5. A `<pine-note>` in front of each message.

How pine works is not in the prompt. The agent searches this manual with its `manual` tool.

**The note.** The system prompt never changes between turns, so the model server can keep what it
read. What changes goes into the note: time, mode, model, the agents it can hand work to, the
opened folder, network access, programs left running, open `todo` steps, a browser you share, a
long `MEMORY.md`, the state in `state.inject`, and whether it has read outside content. pine adds a
note only when more than the time changed. Text from elsewhere cannot fake one.

**Pictures, sound and folded text in an answer.** `![caption](path)` with a workspace file shows a
picture or video, or plays a sound (wav, mp3, m4a, ogg, flac) ([desktop.md](desktop.md), "A sound
in an answer"). A picture from the web is downloaded first; sound is never played with a command.
`<details><summary>…</summary>` … `</details>` folds a long part into one line you click open
([tui.md](tui.md), "Folded parts of an answer").

### Every file that is read as instructions

In this order. A missing or empty file is left out.

| File | Where | What it is |
|---|---|---|
| `SYSTEM.md` | `agents/<id>/` | Optional, yours. Replaces pine's base prompt |
| `AGENTS.md` (for all agents) | pine's home | How every agent behaves |
| `AGENTS.md` (your rules) | `agents/<id>/` | Optional, yours. The agent cannot change it |
| `AGENTS.md` (the agent's own) | its workspace | Its purpose and how it works |
| `CLAUDE.md` | its workspace | Optional. Read like its `AGENTS.md` |
| `SOUL.md` | its workspace | Character and tone |
| `TOOLS.md` (for all agents) | pine's home | Tool defaults for every agent |
| `TOOLS.md` (the agent's own) | its workspace | Its own tool defaults |
| `USER.md` | pine's home | What every agent knows about you |
| `MEMORY.md` | its workspace | What should outlive a conversation |
| `AGENTS.md`, `CLAUDE.md` of an opened folder | that folder | The project's instructions ([coding.md](coding.md)) |
| Files named in `context` | where `agent.json` points | More instruction files of yours |
| `SKILL.md` | a skill's folder | Only one line per skill; the agent reads the file when it uses the skill |

No other file is read by itself (`IDENTITY.md`, `HEARTBEAT.md` and the like are the agent's own).
Instruction files and skills in your home folder or above the workspace are ignored. In your own
conversations the instruction files are the first message, as they were when it began; a line
added later is told in the note.

### How tools are declared

In your own conversations pine declares tools in **families**, which halves the tokens they take
in the prompt. There is no setting for it. Tools nearly every task uses stand alone: `read`,
`bash`, `edit`, `write`, `grep`, `find`, `ls`, `download`, `delegate`, `subagent`, `todo`,
`question`, `manual`, `find_tools`, and the two web tools. A family is one tool that takes an
`action` and that action's arguments.

| Family | Its actions |
|---|---|
| `pine_list` | `sources`, `schedules`, `mcp_servers`, `skills`, `models`, `boards`; for the main agent `agents`, `settings`, `routes`, `conversations`. `what` takes several (`["sources", "schedules"]`) |
| `pine_sources` | `subscribe`, `unsubscribe`, `add_source`, `send`, `read_source`, `remove_source`, `publish_event`; for the main agent `add_source_type`, `remove_source_type` |
| `pine_schedules` | `add_schedule`, `remove_schedule` |
| `pine_mcp` | `add_mcp_server`, `remove_mcp_server`, `sign_in_mcp_server` (the main agent's), and the three tools for a server's resources |
| `pine_skills` | `add_skill`, `remove_skill` |
| `pine_agents` | The main agent's: `create_agent`, `update_agent`, `rename_agent`, `remove_agent` |
| `pine_settings` | The main agent's: `set_setting`, `add_route`, `remove_route`, `add_decision_model`, `remove_decision_model`, `add_model_server`, `remove_model_server`, `add_model`, `configure_model`, `remove_model`, `sign_in`, `sign_out` |
| `pine_board` | `board_read`, `board_post`, `board_claim`, `board_done`, `board_answer`, `board_remove` ([boards.md](boards.md)) |
| `pine_other` | `request_access`, `stop_program`, `state_get`, `state_set` |
| `pine_conversations` | The main agent's: `read_conversation`, `set_conversation`, `remove_conversation`, `rename_group`, `remove_group` |
| One per MCP server, named after it (`browser`, `media`) | The server's tools under their own names (`browser_navigate`) |

This manual names tools by their own names. "Call `add_source`" means `pine_sources` with
`action: "add_source"`; "call `sources`" means `pine_list` with `what: ["sources"]`;
`mcp__browser__browser_navigate` means `browser` with `action: "browser_navigate"`.

Approvals, `approve` and `deny` lists and plan mode see the tool that is meant. A call with wrong
arguments gets the action's whole description back. A run started from outside (by an event such
as a webhook) declares the few tools its profile lists one by one.

| Name | What it is |
|---|---|
| `find_tools` | In your conversations. `names`: actions or a whole family. Answers with every argument, its limits and examples. |

### The manual tool

Every agent has a `manual` tool, except in a run started by an outside event. It searches this
manual, cut into one part per heading and one per table row of a named thing.

| Call | Answers with |
|---|---|
| `manual` `search: "<a few words>"` | The best parts, each with its id and the sentence that matched. Up to 6 queries at once. |
| `manual` `read: "<id of a part>"` | That part in full; up to 8 ids. A long part comes in pages (`@2`, `@3`). |
| `manual` with neither | The list of parts. |

Search goes by words. Words the manual doesn't use ("cron job", "permission",
"watcher") find its own through synonyms. It also finds this installation's source types. `pine
manual <words>` and `pine manual --read <id>` do the same in a shell, without those source types.

## Sessions

A session is one conversation with its history.

| You pass | What happens |
|---|---|
| nothing | The agent's `main` session, compacted by pi when it fills up |
| a name (`tg-123456`, `case-okapi`) | A separate named conversation |
| `new` | A fresh conversation for that one task |

Routes pick the session with `"session"`, the CLI with `--session`. Telegram messages arrive in the
conversation that subscribed to the Telegram source. A run started by an untrusted event uses a
twin session ending in `~u`, so it never sees or extends your conversation.

`pine reset <agent> [session]` (or `/reset`) starts a session over. The old history stays hidden
on disk (`.reset-<time>`) for `limits.eventRetentionDays`. Its finished tasks, sub-agents included,
leave `pine tasks`. A waiting task runs in the fresh session. Subscriptions of that conversation
alone end.

pine removes a named conversation (yours, a delegation thread, a route's) after
`limits.conversationDays` (7) without a message, unless it is a `main`, pinned, in a group, open in
a tab, subscribed to a source, or has its own schedule. Pin what you keep (`/pin`,
[tui.md](tui.md)), or set the limit to `0`. What was set up for that conversation alone is removed
with it ([setup.md](setup.md)).

### A message while the agent works

A message or event for a working conversation is steered into the work: the agent reads it at its
next step, and one answer covers both. These wait their turn instead: an event whose answer goes
elsewhere (a Telegram message during other work), a route with `"whenBusy": "queue"`, and a message
sent with `alt+enter` in the terminal UI. A steered message the work never read is answered next.

pine tells the agent to answer your steered message first, briefly. A long command can delay the
next step for minutes. The Pine app shows "not read yet" or "read 14:03" under it; "send now"
stops the step under way. Reading is not answering: stop the work if no answer comes. Other
programs use `POST /tasks/<id>/now` ([api.md](api.md)).

### When the agent asks you something

An agent asks with `question` ([setup.md](setup.md)), one question per call. The call returns at
once and nothing waits: the agent ends its turn, or goes on with what does not need the answer.
You answer with your next message in that conversation, like any message, and it may talk about
other things too. The Pine app can send an option you picked as that message. A question is open
while it belongs to the conversation's latest turn and you have written nothing since; `GET
/status` counts those (`questions`). A goal stops as blocked on a turn that asked; a swarm waits for
your answer.

## Groups of conversations

Groups are named folders of an agent's conversations, one level deep, that keep a long list tidy
(say one per customer).

A conversation's branches stay in its group. A conversation in a group is never removed for being
unused. **Removing a group removes every conversation in it for good**, with what was set up for
each, except the main conversation, and nothing while one of them works. Lists sort by last use or
by name, main and pinned first.

| Where | Groups |
|---|---|
| Pine app | Drag onto a group in the side bar, or Move to Group…; New Group… and sorting in the agent's menu; Rename… and Remove Group… in the group's ([desktop.md](desktop.md)) |
| Terminal UI | `/group <name>` (made if new), `/group -` takes it out ([tui.md](tui.md)) |
| Main agent | `set_conversation` with `group`, `rename_group`, `remove_group` ([setup.md](setup.md#conversations-and-tabs)) |
| Control API | `GET /agents/<id>/groups`, `POST /agents/<id>/group`, `POST /agents/<id>/groups` ([api.md](api.md)) |

## Branching a conversation

A branch is a new conversation that goes on from one of your messages, to try a second way without
losing the first. From there the two are separate.

| Where | How |
|---|---|
| Pine app | "Branch from here" on one of your messages, or Branch in a conversation's menu for all of it; the "into a worktree" items do the same in a worktree |
| Terminal UI | `/branch` (pick a message), `/branch <name>` (all of it), `--worktree` with either |
| Control API | `POST /agents/<id>/branch` `{ session, at?, to?, worktree? }` ([api.md](api.md)) |

A branch is named `notes-branch`, `notes-branch-2`, ... unless you name it. It shares the
original's folder, or works on branch `pine/<name>` in a worktree ([coding.md](coding.md), "A
worktree for a conversation"). It takes the history, folder and outside-content mark, not your
allowances, its own setup, goal or pin. `/undo` there restores files only for its own messages.
Agents cannot branch.

## Handing work to another agent

`delegate` hands a task to another agent. `delegates` in `agent.json` says to whom; it defaults to
`["*"]`, every agent except the one `main` in `pine.json` names (for the main agent, everyone
else). Name the main agent to allow it. An empty list removes `delegate`.

```
delegate(agent, task, wait?, thread?, worktree?)
```

- The other agent gets the task text and who sent it, and works with its own workspace, tools and
  instructions. Each call starts it fresh; `thread: "okapi"` continues a named conversation.
- The caller waits. Several calls in one message run side by side. `wait: false` returns at once,
  and the answer comes later as a message.
- An agent already waiting up the chain cannot be called. Chains stop at
  `limits.maxDelegationDepth` (3).
- `worktree: true` (your conversations with a folder): the work is done in its own worktree and
  comes back as a branch. Not with `thread` or `wait: false`.
- Without `thread`, the task works on the board of the conversation it came from
  ([boards.md](boards.md)).

The other agent works in its own mode or the caller's, whichever is stricter (`manual`, `safe`,
`auto`, `bypass`), so a `safe` caller gets `safe` work from a `bypass` agent. A `bypass` caller
that read outside content hands on `auto`. A `thread` held to a stricter mode is a conversation of
its own (`thread-okapi~safe`). Once the caller has read outside content, every delegation asks you
([security.md](security.md), "What asks you") and marks the other run.

The caller sees the first paragraph of the other agent's `AGENTS.md`, up to 240 characters (else
`description` in `agent.json`). Write it for a model: "You are gonzo. Contract law; you know the
case files in your workspace", not "Gonzo".

## Sub-agents

Every agent starts sub-agents with `subagent` when asked to "use sub-agents" or "create two new
sub-agents". (`create_agent` makes an agent that stays.) A sub-agent is a copy of the agent with an
empty conversation. It cannot delegate or start sub-agents, and returns only its final answer. Up
to `subagents.maxParallel` run in parallel (default `limits.maxSubagents`, 4); more tasks make a
pool ([boards.md](boards.md), "A pool of sub-agents"). Use them for searches and checks that would
fill the conversation:

> Find every clause about notice periods in `contracts/`. Use sub-agents, one per file.

| Argument | What it does |
|---|---|
| `tasks` | One task per sub-agent. It sees nothing of the conversation, so each task names the files and what to answer. |
| `model` | A different model than the agent's own (`provider/model`): one that sees pictures, a fast one, a bigger one. `models` lists them. |
| `thinking` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Default: the agent's level. |
| `worktree` | `true`: each works in its own worktree, so they don't overwrite each other's files. Changes come back on `pine/<conversation>-sub`, `-sub-2`, ... Not with a pool ([coding.md](coding.md)). |
| `pool` | `true`: up to `limits.maxPoolTasks` (100) tasks, worked through on the board. |
| `note` | What all sub-agents go by. Makes a pool. |
| `stages` | Lists of tasks, each stage after the one before ([boards.md](boards.md), "Stages"). Makes a pool. |
| `check` | A second sub-agent checks each result ([boards.md](boards.md), "A check after the work"). Makes a pool. |
| `verify` | One last check of the whole ([boards.md](boards.md), "A check of the whole"). Makes a pool. |
| `ids` | Tasks already on a board, by number; each sub-agent settles its task there. Makes a pool. |

Hand a sub-agent files by path, pictures and files a source received too ([sources.md](sources.md),
"Files a source received"). A model that sees pictures is shown them; video and sound are shown to
no model. A run started from outside has sub-agents only if its `untrusted` profile allows them,
on the agent's own model.

**Permissions.** A sub-agent works under its conversation's permissions and never asks you. Where
you would be asked, it is refused and says what it needed; allow that first (`request_access`) or
let the conversation do the step. In manual mode a sub-agent only reads, unless you answered
"always" for a tool. It has the agent's MCP servers (unless `subagents.mcp` is `false`) and tools
(or `subagents.tools`). Sub-agents count against the model slots; the waiting parent lends them
its own.

Each sub-agent is a task with its own number. Click its line in the terminal UI (or `/task <id>`),
or use `pine task <id>` or `GET /tasks/<id>/transcript`, to see its steps. Its session file is in
`agents/<id>/sessions/_tasks/<task id>/`.

## A swarm

`/swarm <what is to be done>` makes the agent a lead that coordinates sub-agents on the
conversation's board instead of doing the work itself; pine checks the answer at the end. Only you
start one ([boards.md](boards.md), "A swarm").

## Goal mode

Normally an agent ends its turn and waits, even with work left ("shall I go on?"). With a goal it
keeps working by itself until the objective is met:

```
/goal all tests in ~/dev/shop pass and the README says how to run them
```

The objective goes out as your message. After each turn (a **round**), a **judge**, a short model
call without tools, reads the objective and the last answer. It says `CONTINUE` (go on), `MET`
(done) or `BLOCKED` (it needs you: answer, then `/goal resume`). Each verdict shows with its
reason.

| Command | What it does |
|---|---|
| `/goal <objective>` | Sets the goal and starts, replacing the old one. At most 2000 characters; put details in a file. |
| `/goal` | Shows the goal, round and last verdict. |
| `/goal pause` | No further rounds; `esc` stops a running one. |
| `/goal resume` | Goes on after a pause, a block, the round limit, or a "met" you disagree with. |
| `/goal clear` | Takes the goal off. |

| What happened | What the goal does |
|---|---|
| "met" or "blocked" | Stops. |
| The agent asked you something (`question`) | Stops as blocked, without the judge. Answer it, then `/goal resume`. |
| No verdict (timeout, or another word) | Paused. No verdict never counts as "go on". |
| `limits.goalRounds` (20) rounds | Stops. `/goal resume` gives as many again. |
| `limits.goalIdleRounds` (3) rounds in a row "not met" without a tool call | Paused: it goes in circles. |
| You wrote a message, a round failed, you stopped it, or pine restarted | Paused. |
| The conversation was reset or removed | Gone. |

The judge runs on `defaults.judge`, else the agent's model, within `limits.goalJudgeTimeout`. It
sees only the answer, so say how to tell it is reached ("the tests pass"). Each round is a full
turn. On a one-slot llama.cpp server, give the judge another model (`defaults.judge`) or it pushes
the conversation out of the slot. Mode and approvals still apply ([security.md](security.md), "A goal goes on in your name").

Only you set a goal; there is no tool for it. If your owner asks you, as an agent, to "keep going
until it is done", tell them to type `/goal` with the objective. Other programs use
`POST /agents/<id>/goal` ([api.md](api.md)).

## Shared state

Small facts several agents and routes need, such as who is home. (Shared work goes on boards.)
Routes write it (`"set": { "house/mode": "{{payload.value}}" }`). Agents use `state_get` and
`state_set` within `state.read` and `state.write`. `state.inject` shows keys in the note:

```json
{ "state": { "inject": ["house/#"], "write": ["house/#"] } }
```

Values are shown as facts, cut to 200 characters. Don't route untrusted text into a key agents see.

## What an agent's answer does

The final text of a task is its result, sent to the reply target if there is one. `NO_REPLY` (or
`SILENT`) as the whole answer sends and shows nothing. A failed task sends "`<agent>` could not
finish: ..." to the reply target; a cancelled one sends nothing.

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

The agent sees the description and reads the file when a task calls for it. Files it refers to
lie beside `SKILL.md`. A fact goes into `MEMORY.md` instead.

### Ask the agent

> Remember how to do this: make a skill for filing invoices.

The agent calls `add_skill` with a name, description, instructions and optionally a folder of
files. pine writes it into pine's home, which the agent cannot write; it counts from the next
message. The same name replaces it; `remove_skill` deletes it.

| Said | Who gets it | You are asked |
|---|---|---|
| "make a skill for this" in a side conversation | That conversation, until it is removed | No |
| the same in the main conversation, or "for you as an agent" | Every conversation of the agent | Only from a side conversation |
| "for all agents" | Every agent (main agent only) | Yes |

In manual mode or after outside content, you are always asked, with the instructions shown. A name
is used once among the skills a conversation sees: the same place replaces, another scope or one
you set up refuses ([setup.md](setup.md), "Three scopes").

### Put it there yourself

A folder with a `SKILL.md` in `~/.pine/skills/<name>/` is for all agents, in
`~/.pine/agents/<id>/skills/<name>/` for that agent. Agents can replace and remove these. A skill
elsewhere is listed under `skills` in `pine.json` or `agent.json`; agents use it but cannot change
it.

Names: lowercase letters, digits and single hyphens, at most 64 characters; `pine` is taken.
Description up to 1024 characters, instructions 40 000, files at most 200 and 4 MB, no links.
`pine skills` lists every skill; an agent lists its own with `skills`.

## pi extensions

Any pi extension works in pine, and pi packages are installed in Settings > Extensions or by the
main agent: see [extensions.md](extensions.md). A file you place in `agents/<id>/extensions/`
loads by itself. `.pi/extensions/` in a workspace is not loaded (see `trustWorkspace` in
[configuration.md](configuration.md)).

## What the model server keeps

A model server keeps what it has read (the prompt cache) and reads only what is new, as long as a
request begins as the last one did. On a local model that decides whether an answer starts at once
or after the whole conversation is read again. In your own conversations every request begins the
same: tools, pine's text, and the instruction files as they were when the conversation began.

| Costs nothing | Has the conversation read again |
|---|---|
| A line added to `MEMORY.md` or another instruction file | A rule changed or removed, or `MEMORY.md` rewritten past 8 000 characters (once) |
| A new agent or schedule, an MCP server for another conversation | A tool added to this conversation |
| A restart of pine | The first conversation after the model loads; a compacted one; one that lost its place |

**llama.cpp slots.** A llama.cpp server keeps one conversation per slot (`-np`). pine sends each
request to a slot (`id_slot`): a conversation returns to its own slot, also after a restart; a new
one takes a slot pine filled for it, else an empty or the cheapest one. When you switch tabs across
more conversations than slots, one is pushed out and read again unless `limits.slotPages` keeps it.
Another program on the server keeps its slots, but the two push each other out.

| Setting | Default | Meaning |
|---|---|---|
| `limits.warmSlots` | `true` | While the server is idle, empty slots read what a new conversation of the last agent begins with, so the next one reads only its message. Not while that model works or isn't loaded. `false` turns it off (from the next start). |
| `limits.warmAfterMs` | `3000` | Idle milliseconds before a slot is filled. |
| `limits.slotPages` | `6` | Files per server that keep conversations which lost their slot (`pine-<id>-<n>.bin`). Needs `--slot-save-path <folder>`; 10 000 tokens are about a gigabyte on a large model. `0` turns it off. |

Give the server as many slots as pine lets the model work at once (`limits.models`, else
`limits.maxConcurrentRuns`), plus one for sub-agents. A restarted server has read nothing unless it
saved its slots. The terminal UI shows `cache N%` after an answer: above 90% is normal.

## Checking on agents

`pine status` shows what runs, `pine tasks --agent gonzo` an agent's tasks, `pine task <id>` one
in full, and `pine events --topic "agent/#" -f` follows what agents do ([commands.md](commands.md)).

## Problems

| What you see | What to do |
|---|---|
| A named conversation is gone | Unused for `limits.conversationDays`. Pin or group what you keep |
| `delegate` will not reach an agent | Not in `delegates`, the main agent (left out by `*`), or already waiting up the chain |
| `add_skill` is refused | The name exists in another scope or under `skills`. Pick another |
| Every new conversation starts slowly | See "What the model server keeps" |
