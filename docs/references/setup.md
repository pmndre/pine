# Setup by asking an agent

This chapter says what an agent can set up for you by calling a tool, for whom, and what you are
asked first. It also lists every tool pine gives an agent.

Agents never write pine's configuration: in every mode, bypass included, pine's home folder is
closed to their shell and file tools. What an agent may set up, it sets up through a tool that
checks what it is given, asks you where that matters, and writes exactly the entries needed.
Removing the thing takes those entries out again.

Four things reach an agent from outside its conversation, all set up the same way:

- **Events**: what happens elsewhere wakes the agent ([sources.md](sources.md)).
- **Schedules**: the time wakes the agent, with a task ([events.md](events.md), "Schedules").
- **MCP servers**: tools the agent can call ([mcp.md](mcp.md)).
- **Skills**: how something is done, written down once ([agents.md](agents.md), "Skills").

You can still edit the files yourself ([configuration.md](configuration.md)) or use the `pine`
command ([commands.md](commands.md)).

## Who can set up what

| What | For one conversation | For the agent | For all agents |
|---|---|---|---|
| An event source | any agent (`add_source`) | any agent, when you say so | **only the main agent** |
| A subscription to a source | any agent (`subscribe`) | any agent, when you say so | **only the main agent** |
| A schedule | any agent (`add_schedule`) | any agent, when you say so | **only the main agent** |
| An MCP server, remote or local | any agent (`add_mcp_server`) | any agent, when you say so | **only the main agent** |
| A skill | any agent (`add_skill`) | any agent, when you say so | **only the main agent** |
| Any of the five rows above, for another agent | | **only the main agent** (the same tools, with `agent`) | |
| A route (a rule of your own) | | any agent, on its own sources' events and acting within itself (`add_route`) | **only the main agent** |
| A new agent; changing, renaming or removing one | | | **only the main agent** (`create_agent`, `update_agent`, `rename_agent`, `remove_agent`) |
| pine's settings | | | **only the main agent** (`set_setting`) |
| A new type of event source (a program) | | | **only the main agent** (`add_source_type`) |
| A model server of your own, or one of its models | | | **only the main agent** (`add_model_server`, `add_model`, `configure_model`, `remove_model`) |

The main agent is the one `pine.json` names with `"main"`; without that entry, the agent called
`main`, or else the first one. It is pine's administrator: ask it for what you want changed ("The
main agent administers pine" below). Other agents have none of its tools, apart from routes of
their own, are refused the global scope, and send you to the main agent.

These tools, and the listing tools, exist only in your own conversations. A run that an outside
event started has none of them, and neither has a sub-agent.

## Three scopes

| Scope | Who gets it | It lasts |
|---|---|---|
| **conversation** (`local`, the default) | That conversation and the sub-agents it starts. Other conversations of the agent do not see it. | Until the conversation is removed. A subscription also ends when its tab is closed or it is reset. |
| **agent** | Every conversation of the agent. A subscription wakes its main conversation. | Until it is removed. |
| **global** | Every agent. | Until the main agent or you remove it. |

"Connect this server", "watch that folder", "remind me at five", "make a skill for this" mean the
conversation it is said in. An agent passes a wider scope only when you say so ("for you as an
agent", "always", "for all agents"). In an agent's main conversation the first two are the same.

When a conversation is removed, what was set up for it alone (sources, subscriptions, schedules,
MCP servers, skills) goes with it; when it is renamed, all of that follows. What is for the agent
or for all agents is not touched.

## What you are asked

| An agent wants to | You are asked |
|---|---|
| Add an MCP server | Always, in every mode: the server, its URL or command, who gets it, and for a command what it will reach. |
| Add a source that opens something new (a folder outside its workspace, a broker, a port), needs a secret, is to be trusted as yours, or is for all agents | Yes, with what it will do. A folder inside its own workspace is not asked about. |
| Subscribe the conversation it is in | No. |
| Subscribe the agent from another conversation, or all agents | Yes. Deny it if you meant this conversation only. |
| End a subscription of its own agent | No. |
| Add a schedule or a skill for this conversation, or for itself from its main conversation | No. |
| Add a schedule or a skill for the agent from another conversation, or for all agents | Yes, with the times and the task, or the skill's instructions. |
| Remove a server, source, schedule or skill that is this conversation's own | No. |
| Remove one of the agent's (from another conversation) or of all agents | Yes. |
| Create an agent | Always: its id, purpose, model, tools and instructions. |
| Register or remove a source type | Always. The dialog says it is a program, its size, its imports and where the file is. |
| Add a model server | Always: the address before any request goes there, and in a second dialog its key if it wants one. |
| Remove a model server; add, change or remove a model | Always. |
| A route, a setting, a change to an agent | Always ("The main agent administers pine"). |

In manual mode, and after the conversation has read outside content, the questions marked "No"
are asked too (ending a subscription: in manual mode only). In plan mode nothing is set up: the
agent only says what it would do. The listing tools (`sources`, `schedules`, `mcp_servers`,
`skills`, `models`) never ask. How modes and approvals work in general: [security.md](security.md),
"What asks you".

**After outside content.** A conversation that has read a web page, somebody else's message or
other outside content:

- is refused without a question: `update_agent`, `rename_agent`, `remove_agent`, `set_setting`,
  `set_conversation`, `remove_conversation`, `rename_group`, `remove_group`, `sign_in`,
  `sign_out`, `sign_in_mcp_server`, `add_source_type`, `add_model_server`, `add_model`,
  `configure_model`, and a route with `trust: "owner"`. A web page that says "remove the agent"
  never reaches your dialog. Start a new conversation, or `/reset`, for these;
- puts to you, with a note that it read outside content and from where: `add_route`,
  `remove_route`, `add_decision_model`, `remove_decision_model`;
- puts to you every `add_skill` with its instructions, and every `add_schedule` with its task.

## The main agent administers pine

Nobody has to edit pine's configuration, you included. Each tool of the main agent takes a few
named values and checks them; what it writes is read back through pine's own loader, and a change
that does not load is undone.

Besides the tools every agent has, it has those for agents and settings (below), source types,
model servers, models and sign-ins ("The tools"), routes ("Routes") and conversations
("Conversations and tabs"):

| Tool | Does |
|---|---|
| `agents` [`id`] | Lists the agents: purpose, model, reasoning, mode, reach, and what each has. With `id`, one agent in full with its instructions. |
| `update_agent` `id` [`color`] [`scroll`] [`instructions`] [`soul`] [`tooling`] [`model`] [`thinking`] [`mode`] [`tools`] [`delegates`] [`network`] [`read`] [`write`] [`forget`] | Changes only what is given. You see it line by line and confirm. See "Changing and removing an agent". |
| `rename_agent` `id` `to` | Gives an agent another id. See "Renaming an agent". |
| `remove_agent` `id` [`keep_files`] | Deletes an agent for good, with its folder and everything it has; `keep_files` keeps the folder. See "Changing and removing an agent". |
| `settings` | Lists what `set_setting` can change, with the value in force. |
| `set_setting` `key` `value` | Changes one setting in `pine.json`; `"default"` takes the entry out. See "pine's settings". |
| `agent`, `conversation` (parameters) | The listing, adding, removing and subscribing tools for sources, MCP servers, skills and schedules take `agent`: done for that agent as if in its main conversation. `conversation` reaches one of its conversations. |

**For another agent.** "Add a schedule for books: every Monday at eight, sum up the week" is
`add_schedule` with `agent: "books"`, carried out by that agent's own tool under its rules.
Taking something away from another agent (`remove_*`, `unsubscribe`) asks you every time.

What it cannot do from a conversation that has read outside content is under "What you are asked".

## Creating an agent

Ask the main agent: "create an agent that keeps my books". It calls `create_agent` with:

- an id: lowercase letters, digits, `-` and `_`;
- instructions written to the agent, whose first paragraph says what it is for (other agents read
  it when choosing whom to hand work to);
- optionally a model, its built-in tools (all by default) and a `color` (`#rrggbb`).

What cannot work is said before you are asked. After your yes the agent exists at once with
`agent.json` and its workspace files ([agents.md](agents.md), "Creating an agent"), its
conversation opens in a tab, and it starts with no MCP servers or sources of its own.

Sub-agents are not new agents: any agent starts them itself with `subagent` ([agents.md](agents.md),
"Sub-agents").

## Changing and removing an agent

`update_agent` changes what is given and leaves the rest:

| Value | What it is |
|---|---|
| `color` | Its color in the Pine app, `#rrggbb`; `"none"` takes it away. Anything else is refused before you are asked |
| `scroll` | Where its conversations go in the Pine app when you send a message: `top` (your message moves to the top, the answer below; the default) or `follow` (your message stays at the bottom and the answer is followed, as in a terminal) |
| `instructions` | The whole new `AGENTS.md`, whose first paragraph says what the agent is for. It replaces the file, so the main agent reads it first (`agents` with `id`) |
| `soul` | The whole new `SOUL.md`: its character and tone. Used when you speak of its personality |
| `tooling` | The whole new `TOOLS.md` of its own: tool defaults for it alone; empty clears it |
| `model`, `thinking` | Its model (`"default"` for pine's default) and how much it reasons |
| `mode` | `auto`, `safe`, `manual`, `bypass`, `plan`, or `default` ([security.md](security.md), "Modes: how much an agent does without asking") |
| `tools` | Its built-in tools, the whole list: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls` |
| `delegates` | The agents it may hand work to, the whole list; `*` is every agent but the main one |
| `network` | Whether its shell may use the network in the sandbox |
| `read`, `write`, `forget` | Folders outside its workspace it may read, or read and change, from now on; and folders to take away |

The dialog notes where a change gives more (the whole account, the network, bypass). A change
holds from the agent's next message. pine's home, pine's code and another agent's workspace are
refused as folders. From a shell: `pine agent update <id>` with a flag per value
([commands.md](commands.md)).

`remove_agent` first shows what goes: conversations, sources, MCP servers, schedules, skills, the
routes that wake it, and the number of files in its workspace. After your yes:

- its work stops, and each of those is removed as it would be one by one (a source's secrets
  leave `.env`);
- other agents' `delegates`, and the agent lists of all-agent servers and sources, are corrected;
- what pine stored under its name is deleted, with its folder `agents/<id>` (workspace,
  conversations, skills) and its private home `sandbox/<id>`. With `keep_files` the folder is
  moved to `removed/<id>-<time>` instead.

A workspace you put outside pine's home stays. The event log keeps its past. The main agent cannot
remove itself. From a shell: `pine agent remove <id>`.

## Renaming an agent

Click its name in Settings > Agents in the Pine app, choose Rename in the side bar's menu, ask the
main agent ("call the books agent ledger": `rename_agent`, which you confirm), or run
`pine agent rename <id> <new-id>`. An id is lowercase letters, digits, `-` and `_`, starting with
a letter.

Everything that carries the id follows: `agents/<id>` and `sandbox/<id>` with its workspace,
skills and conversations; routes that wake it and topics of its own sources and schedules
(`source/papers@<new-id>/...`); other agents' `delegates`; the agent lists of all-agent servers
and sources; `main` in `pine.json`; its secrets' names in `.env`; and what pine stored under its
name. Its conversations and sources restart under the new name. A webhook source of its own moves
to `/hook/<name>@<new-id>` (you are told). Its instructions are not changed: fix its old name in
`AGENTS.md` yourself. The event log keeps the old name.

Refused while the agent works, while another agent works for it, and while a program it started
still runs. The main agent cannot rename itself: do it in the app or from a shell.

## pine's settings

`settings` lists what `set_setting` can change:

| Setting | What it is |
|---|---|
| `defaults.model` | The model every agent runs on, unless it has its own |
| `defaults.thinking` | How much a model reasons, for agents that set nothing |
| `defaults.mode` | The mode of agents that set none. A rule or preference for all agents is not a setting: it goes into `AGENTS.md` or `TOOLS.md` in pine's home ([agents.md](agents.md), "What holds for all agents") |
| `defaults.introduce` | Agents introduce themselves in their first answer to you, once each |
| `defaults.judge` | The model that judges whether a goal is met ([agents.md](agents.md), "Goal mode"). Not set: the agent's own |
| `defaults.checker` | The model of the sub-agent that checks a swarm's answer ([boards.md](boards.md), "A swarm"). Not set: the agent's own |
| `defaults.bashTimeoutSec` | Longest shell command, in seconds. From the next start |
| `defaults.taskTimeoutSec` | Longest task (one message or event), in seconds. From the next start |
| `limits.maxConcurrentRuns` | How many agents and sub-agents work at once, all conversations together; 8 by default. From the next start |
| `limits.maxSubagents` | Sub-agents one conversation runs at once, for agents that set nothing; 4 by default |
| `limits.maxPoolTasks` | Largest batch of sub-agent tasks: the most tasks one job split into a pool takes; 100 by default |
| `limits.maxDownloadMb` | Largest download, in megabytes |
| `security.askAccess` | Whether pine asks you when an agent in the sandbox needs a path outside it, or the network |
| `security.approvalTimeout` | How long a question waits before it counts as a no. From the next start |
| `security.taint` | How long pine asks before an agent sends something out after its conversation read outside content: `session`, `run` or `off` |
| `security.bypassWhenTainted` | Whether bypass mode stays in force after outside content |
| `ui.theme` | The Pine app's colors: a theme in `themes/` of pine's home by name (`dracula`, `github-light`) |
| `ui.view` | What the Pine app's panel draws: a view in `views/` of pine's home by name (`office`); `off`: no panel. Not set: the first by name |

Each value is checked, you see old and new, and where the new one gives something up the question
says so. `"default"` takes the entry out of `pine.json`. Settings hold at once unless marked. No
agent can set the control API or secrets. The other keys of `pine.json` (the rest of `limits`) are
not settings: change them by hand and restart ([configuration.md](configuration.md)).

## Adding a model server

Tell the main agent: "add my llama server at http://100.64.0.7:8080 as studio". It calls
`add_model_server`, and then:

1. You confirm the address, every time, in every mode: an agent on one of its models sends its
   whole conversation there. No request goes there before your yes.
2. pine asks the server for its models, their context, whether they read pictures and which
   thinking levels they know (llama.cpp says all of it; other servers say less).
3. If the server wants a key, a second dialog asks for it. It goes into `.env` as
   `PINE_MODEL_<NAME>_API_KEY`; no agent sees it. A key the server refuses is not kept.
4. The entry is written to `models.json`. Choose a model with `/model studio/<model>`, or have the
   main agent give it to an agent.

Where the server does not say its context, the agent asks you for the number. The name cannot be
one a provider has (`anthropic`, `openai`, ...). From a shell: `pine model add <name> <address>`.
What is written: [configuration.md](configuration.md), "models.json".

### A model server on this computer

The Pine app's **Setup Pine** offers **A model on this computer** ([desktop.md](desktop.md)): pine
looks for model servers running on this computer and offers what it finds, so that you type no
address. It asks only these ports on `127.0.0.1`, never another address:

| Port | Offered as |
|---|---|
| 8080 | **llama.cpp**, or **Pinecone** when Pinecone's MCP server answers on 8090 too |
| 11434 | **Ollama** |
| 1234 | **LM Studio** |

Nothing is added by looking. Picking one adds it as above (a key, if wanted, typed into a secret
field of the card). **Pinecone** also adds its MCP server, named `pinecone`, for all agents.
Nothing is installed.

## Setting up a model

pine takes what it knows about a model from the server when the server is added. A model loaded
later, or a server restarted with another context, needs telling the main agent. Its `models`
list shows what each server serves that pine lacks.

| You say | The main agent calls |
|---|---|
| "studio serves gemma now too, add it" | `add_model` `studio/gemma`. pine asks the server for it. A model the server does not list is set up on the server first (loaded, or named with `--alias` for llama-server). |
| "I restarted the server with 64k context" | `configure_model` `studio/qwen3-coder` `context: 65536`. The context of one request: for llama-server, `-c` divided by `-np`. Too large makes long conversations fail; too small compacts early. A smaller context also caps the longest answer at half of it, unless `max_output` is given. |
| "let it write longer answers" | `configure_model` with `max_output`: the most tokens of one answer, below the context. |
| "it can see pictures" / "it cannot" | `configure_model` with `pictures`. |
| "turn thinking off for it" / "it reasons" | `configure_model` with `reasoning` ([configuration.md](configuration.md), "Thinking levels"). |
| "only one at a time on the laptop's model" | `configure_model` with `runs: 1`: how many conversations and sub-agents use the model at once (`limits.models`), for any model, a provider's too. For your own server, its parallel slots (`-np`). `runs: 0` goes back to `limits.maxConcurrentRuns`. |
| "take the old model out" | `remove_model` `studio/old`: only from pine. Not while something uses it, nor the server's last model. |

You see each change with what was there before, and confirm. Of a provider's models (Claude,
ChatGPT, OpenAI, ...) only `runs` can be set. Which model an agent runs on is `update_agent` with
`model`, or `set_setting` with `defaults.model` for all. Other programs do the same through the
control API ([api.md](api.md)).

## Routes

A route is a rule in `pine.json` that acts on events: write shared state, ask a model once,
publish another event, run a script, or wake an agent ([events.md](events.md), "Routes"). Most
wishes need none: a subscription is a route pine makes for you.

| Tool | Does |
|---|---|
| `routes` | Lists the routes: what each listens to, its condition and what it does. |
| `add_route` `name` `on` [`when`] [`agent` `prompt` `session`] [`set`] [`publish_topic` `publish_payload`] [`call_prompt` `call_system` `call_model`] [`ask_questions` `ask_data` `ask_model`] [`run_command` `run_agent`] [`throttle`] [`debounce`] [`trust`] | Adds a route. Each value is checked (a free name, existing agents and models, JSON where JSON is wanted, a time, something to do, no topic only pine publishes on, typed questions without `{{...}}`). You see it line by line and confirm; it works at once. |
| `remove_route` `name` | Takes one out; you confirm. To change a route, remove it and add it again. |
| `add_decision_model` `name` (`server` [`model`] or `url` `model` [`local`] [`key`]) | Adds a decision model that routes ask by name: one a model server of pine's serves (`server`, such as Pinecone), TypeSafe's Jev (`server: "typesafe"`, after `sign_in` `typesafe`), or another server with TypeSafe's API (`url`; with `key`, pine's dialog asks for it). You confirm ([configuration.md](configuration.md), "Decision models"). |
| `remove_decision_model` `name` | Takes one out, not while a route asks it. You confirm. |

The main agent has these for every route. Any other agent has `routes`, `add_route` and
`remove_route` in your own conversations, for routes of its own: on its own sources' events or its
own shared state, acting only within itself, never with `trust` ([events.md](events.md),
"Routes"). It can ask the decision models there are; only the main agent adds and removes them.

`trust: "owner"` makes every event on the route count as your words, giving whoever can cause one
the agent's full tools; the question says so. `reply`, `whenBusy`, `priority`, `key` and `label`
are not offered by the tool: write them into `pine.json`.

## Conversations and tabs

"Which conversations are there?", "what did the books agent say about the invoice?", "pin that
one", "open it in a tab", "close the tab", "put the okapi conversations into a group Okapi": the
main agent does these, for its own conversations and every other agent's, with the same pin,
rename and removal as your own hand in the list of conversations ([tui.md](tui.md)). To open a tab
for your owner on a conversation, or to close one, the tool is `set_conversation` with `tab`.

| Tool | Does |
|---|---|
| `conversations` [`agent`] | Lists the conversations of every agent, or one, with their groups: pinned, group, open in a tab, working, messages, last used, when removed by itself, whether it read outside content. |
| `read_conversation` `name` [`agent`] [`last`] [`before`] | The messages and answers, numbered, newest last. `last`: how many (10, at most 30); `before`: read further back. Of the tools an answer used it shows which and on what, never what they returned. |
| `set_conversation` `name` [`agent`] [`pinned`] [`tab`] [`rename`] [`group`] | Changes only what is given: the pin, a tab opened or closed, a new name (history, pin, tab, group and what was set up for it follow the renamed conversation), a group (made if missing, with its branches; `""` takes it out). A new name with `tab: true` opens a new, empty conversation. |
| `remove_conversation` `name` [`agent`] | Removes a conversation for good, with the sources, subscriptions, schedules, MCP servers and skills set up for that conversation alone. You confirm every time. |
| `rename_group` `name` `to` [`agent`] | Renames a group of conversations. Asks only in manual mode. |
| `remove_group` `name` [`agent`] | Removes a group and its conversations for good; an agent's main conversation in it stays. You confirm every time ([agents.md](agents.md), "Groups of conversations"). |

- A tab the agent opens appears behind yours, marked as new. Closing one is what closing it
  yourself does: its own subscriptions end (you are asked first), the conversation stays.
- Reading shows no tool results, so it is no way around another agent's sandbox. Reading a
  conversation that read outside content (or one outside content started, ending in `~u`) marks
  the reader too.
- The conversation the agent is in, and any agent's `main`, cannot be removed or renamed by tool.
- No tool sets a conversation's folder or goal, or puts work into a conversation.

## What an agent has

An agent cannot read pine's configuration. What it has been given, it asks a tool: each lists what
the conversation has, whom each thing is for (this conversation, the agent, all agents), and what
only another conversation of the agent has.

| What you ask about | The tool that lists it |
|---|---|
| MCP servers, and whether their tools are there | `mcp_servers` |
| Skills | `skills` |
| Models, and which one the agent runs on | `models` |
| Event sources, and who is subscribed | `sources` |
| Schedules | `schedules` |

## The tools

Every tool pine gives an agent, by what it is for. The main agent's tools for agents, settings,
routes and conversations are in their sections above.

| Tool | Does |
|---|---|
| **Events** | |
| `sources` | Lists the event sources this conversation can use and who is subscribed. |
| `add_source` `name` `type` `description` [`options`] [`scope`] [`note`] [`throttle`] [`own`] [`ask`] | Sets up a source; with a `note` it subscribes at once. `options`: the type's options ([source-types.md](source-types.md)). `own: true`: your own device or folder, whose events are trusted. `ask`: secret options you type into the dialog. |
| `subscribe` `source` [`scope`] [`note`] [`when`] [`throttle`] [`fresh`] | Starts being woken by a source. `fresh`: each event in a new, empty conversation ([sources.md](sources.md), "A fresh conversation for every event"). |
| `unsubscribe` `source` [`scope`] | Ends it. Scope `all`: everything of the agent on that source. |
| `send` `source` [`text`] [`file`] [`data`] | Sends through a source that can send (Telegram, MQTT, ...). `file`: a picture, video or sound file of the workspace, with a Telegram message. A message to you on Telegram is never held for approval. |
| `read_source` `source` [`data`] | Reads through a source that can be asked: earlier messages of a Slack channel or thread (`data`: `{"channel": "C0123", "thread": "..."}`). Not asked about; what it returns is outside content. |
| `remove_source` `name` | Stops a source, unsubscribes everyone and deletes it, with any folder access that came with it. |
| `add_source_type` `name` `file`, `remove_source_type` `name` | Main agent only. Registers a module it wrote as a new source type, or takes one out ([sources.md](sources.md)). |
| **Schedules** | |
| `schedules` | Lists what is scheduled for the agent and when each is next due. |
| `add_schedule` `name` `task` + one of `cron`, `every`, `at`, `in` [`scope`] | Does the task at set times, every so often, or once ([events.md](events.md), "Schedules"). |
| `remove_schedule` `name` | Ends a schedule. |
| **MCP servers** | |
| `mcp_servers` | Lists the servers this conversation has, whom each is for, and whether its tools are there or missing (did not start, or needs a sign-in). |
| `add_mcp_server` `name` `url` or `command` [`secrets`] [`description`] [`scope`] | Proposes a server: remote by its https `url`, or local by the line that starts it (one program and its arguments), which runs where the agent's commands run (its sandbox, or none in auto and bypass mode). `secrets`, local servers only: key names you type into the dialog. A server one conversation has becomes the agent's when added again with `scope: "agent"` ([mcp.md](mcp.md)). |
| `remove_mcp_server` `name` | Takes a server out. One that belongs to another conversation is removed there. |
| **Skills** | |
| `skills` | Lists the skills this conversation has and whom each is for. |
| `add_skill` `name` `description` `instructions` [`files`] [`scope`] | Writes a skill; the same name in the same place replaces it. `files`: a workspace folder whose files go along ([agents.md](agents.md), "Skills"). |
| `remove_skill` `name` | Deletes a skill in pine's skill folders. A skill named under `skills` in a configuration file is yours to remove. |
| **Agents** | |
| `create_agent` `id` `instructions` [`model`] [`tools`] [`color`] | Main agent only. See "Creating an agent". |
| **Model servers and models** | |
| `add_model_server` `name` `url` [`context`] | Main agent only. See "Adding a model server". |
| `remove_model_server` `name` | Main agent only. Takes a server out with its key. Refused while an agent, the default, `defaults.judge`, `defaults.checker` or a route's `call` uses one of its models. |
| `add_model` `model` [`context`] | Main agent only. Adds a model a server serves that pine does not have yet, as `server/model`. See "Setting up a model". |
| `configure_model` `model` [`context`] [`max_output`] [`pictures`] [`reasoning`] [`runs`] | Main agent only. Changes only what is given. See "Setting up a model". |
| `remove_model` `model` | Main agent only. Takes one model of a server out of pine. Refused while it is used, and for a server's last model. |
| `models` | Lists the models (`provider/model`), what each can do, and the agent's own. For the main agent it also asks each of your model servers what it serves, and names what pine lacks or the server does not serve. |
| **Signing in** | |
| `sign_in` `provider` [`way`] | Main agent only. Signs (logs) pine in to a model provider, such as a Claude or ChatGPT subscription (`way`: `browser`) or an API key (`key`). You confirm; then pine's own dialog asks you for the page, key or code, which never reaches the agent. The credential is kept in `auth.json`. `typesafe` signs in to TypeSafe for its decision model Jev. Same as Settings > Models and `pine login`. |
| `sign_out` `provider` | Main agent only. Removes a sign-in; you are told which agents use its models. |
| `sign_in_mcp_server` `name` [`agent`] | Main agent only. Signs in to a remote MCP server: you confirm, and its page opens in the browser of the computer pine runs on. pine keeps the token. Same as Sign in under Settings > MCP servers and `pine mcp login <name>`. |
| **Asking, and keeping track** | |
| `question` `question` [`header`] [`options`] [`multiSelect`] | Asks the owner one question the agent cannot go on without: two to six `options` (`{ label, description? }`, recommended first), a `header` of at most 12 characters, `multiSelect` for several. An answer in the owner's own words, or none, is said plainly. Works in plan mode; not in a run the owner did not start. |
| `todo` `items` | The agent's list of steps, sent whole each time; each step `pending`, `in_progress` (one at a time) or `done`, at most 30. The owner sees it; after six tool calls without a change the agent is reminded. Not in a run the owner did not start. |
| **Other tools** | |
| `stop_program` [`id`] | Stops a program the conversation's commands left running or started with `background: true`; without `id` it lists them. Never asks. Only for an agent with `bash` ([coding.md](coding.md)). |
| `request_access` [`path`] [`write`] [`network`] `reason` | Asks you for a path outside the workspace (`write: true` to change it) or the network, for the conversation until reset or restart. pine also asks by itself when a call needs it ([security.md](security.md), "When a call needs something outside: pine asks you"). |
| `delegate` `agent` `task` [`wait`] [`thread`] [`worktree`] | Hands a task to another agent ([agents.md](agents.md), "Handing work to another agent"). |
| `subagent` `tasks` [`stages`] [`model`] [`thinking`] [`worktree`] [`pool`] [`ids`] [`note`] [`check`] [`verify`] | Runs copies of the agent side by side, one task each ([agents.md](agents.md), "Sub-agents"; [boards.md](boards.md) for `pool`). |
| `download` `url` `path` | Fetches a file from a web address into the workspace ([mcp.md](mcp.md), "Files and pictures from a remote server"). |
| `boards`, `board_read`, `board_post`, `board_claim`, `board_done`, `board_answer`, `board_remove` | The tasks and notes of a job several work on ([boards.md](boards.md)). |
| `publish_event` `topic` [`text`] [`data`] | Publishes on a topic of the agent's `publish` list; without the list the tool is not there ([events.md](events.md)). |
| `state_get` `key`, `state_set` `key` `value` | Shared state, within `state.read` and `state.write` ([agents.md](agents.md), "Shared state"). |
| `manual` [`search`] [`read`] | Searches and reads this manual ([agents.md](agents.md), "The manual tool"). |

The built-in tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) are chosen with
`tools` in `agent.json`; `background` on the shell tool is in [coding.md](coding.md).

Everything takes effect without a restart. New MCP tools and skills are there from the agent's
next message on; after `add_mcp_server`, pine calls the agent again at once in the same
conversation with the new tools.

## What is written

The tools make only these entries. A thing set up for one conversation carries that
conversation's name as `session`, which is how pine knows whose it is and when to remove it.

```jsonc
// agents/main/agent.json after: a server and a schedule for the agent, a source and a subscription for the conversation "taxes"
{
  "mcp": { "notes": { "url": "https://mcp.example.com/mcp", "approve": "tainted" } },
  "sources": { "scans": { "type": "folder", "description": "what the scanner saves", "session": "taxes", "dir": "/Users/me/Scans" } },
  "sandbox": { "read": ["/Users/me/Scans"] },
  "subscribe": [{ "source": "scans", "note": "Say which document arrived.", "session": "taxes" }],
  "schedules": [{ "name": "brief", "cron": "30 7 * * 1-5", "task": "Prepare the morning brief." }]
}
```

Remove the conversation "taxes" and the source, the subscription and the read access go; the
server and the schedule stay. Rename the conversation and the entries follow its new name.

A skill needs no entry: where its folder lies says whom it is for.

```
~/.pine/
  skills/<name>/                                       all agents
  agents/<id>/skills/<name>/                           that agent
  agents/<id>/conversations/<session>/skills/<name>/   that one conversation
```

Each holds a `SKILL.md` and the files that went along. Agents read these folders and cannot write
them. `pine skills` lists every skill.

## What stays yours

No tool changes these: the control API and its token, secrets in `.env`, a route's `reply`, local
MCP servers that are to run outside an agent's sandbox, a server's options once it is added, and
source types you write yourself. Change them in the files or with the `pine` command; most need a
restart ([configuration.md](configuration.md)).
