# Setup by asking an agent

An agent sets things up for you by calling a tool. This chapter says who may set up what and what
pine asks you first, and lists every tool pine gives an agent.

Agents never write pine's configuration: pine's home is closed to their shell and file tools in
every mode, bypass included. A tool checks its input, asks you where that matters, and writes only
the entries it needs. Removing the thing takes them out again. You can still edit the files
yourself ([configuration.md](configuration.md)) or use the `pine` command
([commands.md](commands.md)).

## Who can set up what

| What | For one conversation | For the agent | For all agents |
|---|---|---|---|
| An event source, a subscription, a schedule, an MCP server (remote or local), a skill | any agent (`add_source`, `subscribe`, `add_schedule`, `add_mcp_server`, `add_skill`) | any agent, when you say so | main agent only |
| Any of these for another agent | | main agent only (the same tools, with `agent`) | |
| A route | | any agent, for its own routes (`add_route`) | main agent only |

Only the main agent creates, changes, renames and removes agents, changes pine's settings, adds
source types (programs), and adds model servers and models. It is the agent `pine.json` names with
`"main"`, else the agent called `main`, else the first one. Ask it for what you want changed. Other
agents are refused the global scope and send you to the main agent.

These tools and the listing tools exist only in your own conversations. A run started by an
outside event (a webhook, say) has none of them, and neither has a sub-agent.

## Three scopes

| Scope | Who gets it | It lasts |
|---|---|---|
| **conversation** (`local`, the default) | That conversation and its sub-agents | Until the conversation is removed. A subscription also ends when its tab is closed or the conversation is reset |
| **agent** | Every conversation of the agent. A subscription wakes its main conversation | Until it is removed |
| **global** | Every agent | Until the main agent or you remove it |

"Connect this server", "watch that folder", "remind me at five" are for the conversation they are
said in. An agent uses a wider scope only when you say so ("for you as an agent", "always", "for
all agents"). In the main conversation, conversation and agent scope are the same.

Removing a conversation removes its own sources, subscriptions, schedules, MCP servers and skills.
Renaming it takes them along.

## What you are asked

| An agent wants to | pine asks you |
|---|---|
| Add an MCP server | Always, in every mode, with its URL or command, who gets it, and what a command will reach |
| Add a source that opens something new (a folder outside its workspace, a broker, a port), needs a secret, is trusted as yours, or is for all agents | Yes, with what it will do. Not for a folder inside its workspace |
| Subscribe the agent from another conversation, or all agents | Yes. Deny it if you meant this conversation only |
| Add a schedule or a skill for the agent from another conversation, or for all agents | Yes, with the times and task, or the instructions |
| Remove something of the agent's (from another conversation) or of all agents | Yes |
| Subscribe its own conversation, end its agent's subscription, add or remove what belongs to this conversation (or to itself, from its main conversation) | No |
| Create an agent, change a setting, a route or an agent, register or remove a source type, add or remove a model server, add, change or remove a model | Always. For a new agent you see its id, purpose, model, tools and instructions |

A new source type's dialog says it is a program, with its size, imports and file. A model server's
address is confirmed before any request goes there, and its key comes in a second dialog.

In manual mode, and after outside content, the "No" cases ask too (ending a subscription: manual
mode only). In plan mode nothing is set up. The listing tools (`sources`, `schedules`,
`mcp_servers`, `skills`, `models`) never ask. See [security.md](security.md), "What asks you".

After a conversation has read outside content (a web page, somebody else's message):

- pine refuses, without asking: `update_agent`, `rename_agent`, `remove_agent`, `set_setting`,
  `set_conversation`, `remove_conversation`, `rename_group`, `remove_group`, `sign_in`,
  `sign_out`, `sign_in_mcp_server`, `add_source_type`, `add_model_server`, `add_model`,
  `configure_model`, and a route with `trust: "owner"`. Use a new conversation or `/reset`;
- pine asks about `add_route`, `remove_route`, `add_decision_model` and `remove_decision_model`,
  naming the outside content;
- pine shows every `add_skill` with its instructions and every `add_schedule` with its task.

## The main agent administers pine

Nobody has to edit pine's configuration. Each of the main agent's tools checks a few named values,
and pine undoes a change that its own loader cannot read back.

| Tool | Does |
|---|---|
| `agents` [`id`] | Lists the agents with purpose, model, mode, reach and what each has. With `id`, one in full |
| `update_agent` `id` [`color`] [`scroll`] [`instructions`] [`soul`] [`tooling`] [`model`] [`thinking`] [`mode`] [`tools`] [`delegates`] [`network`] [`read`] [`write`] [`forget`] | Changes only what is given, after you confirm. See "Changing and removing an agent" |
| `rename_agent` `id` `to` | Gives an agent another id ("Renaming an agent") |
| `remove_agent` `id` [`keep_files`] | Deletes an agent for good; `keep_files` keeps its folder |
| `settings` | Lists what `set_setting` can change, with current values |
| `set_setting` `key` `value` | Changes one setting in `pine.json`; `"default"` removes the entry |
| `agent`, `conversation` (parameters) | Make the tools for sources, MCP servers, skills and schedules act for another agent (as in its main conversation) or one of its conversations |

To set something up for another agent, the main agent passes `agent`: "add a schedule for books"
is `add_schedule` with `agent: "books"`, run by that agent's own tool under its rules. Taking
something away from another agent (`remove_*`, `unsubscribe`) asks you every time.

## Creating an agent

Ask the main agent: "create an agent that keeps my books". `create_agent` takes an id (lowercase
letters, digits, `-`, `_`), instructions whose first paragraph says what the agent is for (other
agents read it to choose whom to hand work to), and optionally a model, built-in tools (all by
default) and a `color`. pine says what cannot work before it asks you. After your yes the agent exists at once and its conversation opens in a
tab, with no MCP servers or sources ([agents.md](agents.md), "Creating an agent").

Sub-agents are not new agents: any agent starts them with `subagent` ([agents.md](agents.md),
"Sub-agents").

## Changing and removing an agent

With `update_agent` the main agent gives another agent a different model, mode or tools, or lets
it read a folder. It changes only the values given:

| Value | What it is |
|---|---|
| `color` | Its color in the Pine app, `#rrggbb`, or `"none"`; other values are refused |
| `scroll` | `top` (the default: your message moves to the top) or `follow` (it stays at the bottom and the answer is followed, as in a terminal) |
| `instructions` | The whole new `AGENTS.md`, replacing the old one (read it first with `agents`) |
| `soul` | The whole new `SOUL.md`: its character, tone and personality |
| `tooling` | The whole new `TOOLS.md` of its own; empty clears it |
| `model`, `thinking` | Its model (`"default"` for pine's) and reasoning level |
| `mode` | `auto`, `safe`, `manual`, `bypass`, `plan` or `default` ([security.md](security.md), "Modes: how much an agent does without asking") |
| `tools` | Its built-in tools, the whole list |
| `delegates` | Agents it may hand work to, the whole list; `*` is all but the main one |
| `network` | Whether its shell may use the network in the sandbox |
| `read`, `write`, `forget` | Folders outside its workspace to read, to read and change, or to take away |

The dialog marks a change that gives more (the whole account, the network, bypass). It holds from
the agent's next message. pine's home, pine's code and other agents' workspaces are refused. From
a shell: `pine agent update <id>` ([commands.md](commands.md)).

`remove_agent` shows what goes (conversations, sources, MCP servers, schedules, skills, the routes
that wake it, the number of files). After your yes, pine stops its work, removes each of those (a
source's secrets leave `.env`), fixes other agents' `delegates` and the agent lists of all-agent
servers and sources, and deletes `agents/<id>` and `sandbox/<id>` with everything stored under its
name. `keep_files` moves the folder to `removed/<id>-<time>` instead. A workspace outside pine's
home stays, and so does the event log. The main agent cannot remove itself. From a shell:
`pine agent remove <id>`.

## Renaming an agent

Rename an agent in Settings > Agents in the Pine app (click its name), with Rename in the side
bar's menu, by asking the main agent ("call the books agent ledger"), or with
`pine agent rename <id> <new-id>`. An id starts with a letter.

Everything that carries the id follows: its folders, routes, the topics of its sources and
schedules (`source/papers@<new-id>/...`), other agents' `delegates`, all-agent lists, `main` in
`pine.json` and its secrets' names in `.env`. A webhook source of its own moves to
`/hook/<name>@<new-id>`. Its conversations and sources restart under the new name. Its instructions keep the old name, so fix `AGENTS.md` yourself. The
event log keeps it too.

pine refuses while the agent or an agent working for it works, or while a program it started runs.
The main agent cannot rename itself: use the app or a shell.

## pine's settings

The keys `set_setting` takes (`settings` lists them with current values):

| Setting | What it is |
|---|---|
| `defaults.model` | The model of agents without their own |
| `defaults.thinking` | Reasoning level of agents that set none |
| `defaults.mode` | Mode of agents that set none. Rules for all agents go into `AGENTS.md` or `TOOLS.md` in pine's home instead ([agents.md](agents.md), "What holds for all agents") |
| `defaults.introduce` | Agents introduce themselves once, in their first answer to you |
| `defaults.judge` | Model of goal mode's judge; not set: the agent's own |
| `defaults.checker` | Model of the sub-agent that checks a swarm's answer; not set: the agent's own |
| `defaults.bashTimeoutSec` | Longest shell command, in seconds (from the next start) |
| `defaults.taskTimeoutSec` | Longest task, in seconds (from the next start) |
| `limits.maxConcurrentRuns` | Agents and sub-agents at work at once, all conversations together; 8 (from the next start) |
| `limits.maxSubagents` | Sub-agents one conversation runs at once; 4 |
| `limits.maxPoolTasks` | Largest batch of sub-agent tasks in one pool; 100 |
| `limits.maxDownloadMb` | Largest download, in megabytes |
| `security.askAccess` | Whether pine asks you when a sandboxed agent needs a path outside or the network |
| `security.approvalTimeout` | How long a question waits before it counts as no (from the next start) |
| `security.taint` | How long pine asks before sending out after outside content: `session`, `run`, `off` |
| `security.bypassWhenTainted` | Whether bypass mode stays after outside content |
| `ui.theme` | The Pine app's theme, by name (`dracula`) |
| `ui.view` | The view the Pine app draws beside a conversation, by name (`office`), or `off` |

You see old and new value; where the new one gives something up, the question says so. Other
settings hold at once. No agent can set the control API or secrets. Other keys of `pine.json`
are edited by hand, with a restart. Defaults: [configuration.md](configuration.md).

## Adding a model server

Tell the main agent: "add my llama server at http://100.64.0.7:8080 as studio". With
`add_model_server`:

1. You confirm the address, every time, in every mode: agents on it send it whole conversations.
2. pine asks the server for its models, their context, picture support and thinking levels
   (llama.cpp says all; other servers less). If it does not say its context, the agent asks you.
3. A key, if needed, comes in a second dialog and goes to `.env` as `PINE_MODEL_<NAME>_API_KEY`,
   where no agent sees it. A refused key is not kept.
4. pine writes `models.json`. Pick a model with `/model studio/<model>`.

The name cannot be a provider's (`anthropic`, `openai`, ...). From a shell:
`pine model add <name> <address>`. The format: [configuration.md](configuration.md), "models.json".

### A model server on this computer

**Setup Pine** in the Pine app offers **A model on this computer** ([desktop.md](desktop.md)). pine
looks for model servers running on this computer and offers what it finds, so you type no address.
It asks only these ports on `127.0.0.1`, never another address:

| Port | Offered as |
|---|---|
| 8080 | **llama.cpp**, or **Pinecone** when its MCP server answers on 8090 |
| 11434 | **Ollama** |
| 1234 | **LM Studio** |

Looking adds nothing; picking one adds it as above. **Pinecone** also adds its MCP server `pinecone` for all agents.
Nothing is installed.

## Setting up a model

pine takes what it knows about a model from the server when you add the server. If the server
loads another model or restarts with another context, tell the main agent. Its `models` list shows
what each server serves that pine lacks.

| You say | The main agent calls |
|---|---|
| "studio serves gemma now too" | `add_model` `studio/gemma`. The server must list it (load it, or `--alias` for llama-server) |
| "I restarted the server with 64k context" | `configure_model` `studio/qwen3-coder` `context: 65536`: one request's context, for llama-server `-c` divided by `-np`. Too large fails long conversations, too small compacts early |
| "let it write longer answers" | `configure_model` with `max_output` (without it, at most half the context) |
| "it can see pictures" | `configure_model` with `pictures` |
| "turn thinking off for it" | `configure_model` with `reasoning` ([configuration.md](configuration.md), "Thinking levels") |
| "only one at a time on the laptop's model" | `configure_model` with `runs: 1` (`limits.models`), for any model; `runs: 0` falls back to `limits.maxConcurrentRuns`. For your own server, use its slots (`-np`) |
| "take the old model out" | `remove_model` `studio/old`, not while in use or for the server's last model |

You confirm each change. A provider's models (Claude, ChatGPT, ...) take only `runs`. An agent's
model is `update_agent` with `model`, or `defaults.model` for all ([api.md](api.md) for programs).

## Routes

A route is a rule in `pine.json` that acts on events: it writes state, asks a model, publishes,
runs a script or wakes an agent ([events.md](events.md), "Routes"). Most wishes need only a
subscription.

| Tool | Does |
|---|---|
| `routes` | Lists the routes, their conditions and actions |
| `add_route` `name` `on` [`when`] [`agent` `prompt` `session`] [`set`] [`publish_topic` `publish_payload`] [`call_prompt` `call_system` `call_model`] [`ask_questions` `ask_data` `ask_model`] [`run_command` `run_agent`] [`throttle`] [`debounce`] [`trust`] | Adds a route after you confirm; it works at once |
| `remove_route` `name` | Removes one after you confirm. To change a route, remove and add it |
| `add_decision_model` `name` (`server` [`model`] or `url` `model` [`local`] [`key`]) | Adds a decision model routes ask by name: from a model server of pine's (Pinecone), TypeSafe's Jev (`server: "typesafe"`, after `sign_in`), or by `url` ([configuration.md](configuration.md), "Decision models") |
| `remove_decision_model` `name` | Removes one after you confirm, not while a route asks it |

`add_route` checks each value: a free name, existing agents and models, valid JSON and times,
something to do, no topic only pine publishes on, typed questions without `{{...}}`.

Other agents have `routes`, `add_route` and `remove_route` in your conversations for routes of
their own: on their own sources' events or shared state, acting only within themselves, never with
`trust`. They can ask existing decision models; only the main agent adds and removes them.

`trust: "owner"` makes every event on the route count as your words, giving whoever causes one the
agent's full tools; the question says so. `reply`, `whenBusy`, `priority`, `key` and `label` are
written into `pine.json` by hand.

## Conversations and tabs

"Which conversations are there?", "what did the books agent say about the invoice?", "pin that
one", "open it in a tab", "close the tab", "put the okapi conversations into a group Okapi": the
main agent does these for any agent, as your own hand in the list would ([tui.md](tui.md)). To open
or close a tab for your owner on a conversation, the tool is `set_conversation` with `tab`.

| Tool | Does |
|---|---|
| `conversations` [`agent`] | Lists conversations with group, pin, tab, activity, messages, last use, removal date and outside-content mark |
| `read_conversation` `name` [`agent`] [`last`] [`before`] | Messages and answers, newest last (`last`: 10, at most 30; `before`: further back). Tool calls show only name and subject |
| `set_conversation` `name` [`agent`] [`pinned`] [`tab`] [`rename`] [`group`] | Pins, opens or closes a tab, renames, or sets a group (made if missing; `""` removes it). A new name with `tab: true` opens a new conversation |
| `remove_conversation` `name` [`agent`] | Removes a conversation for good, with what was set up for it alone. You confirm every time |
| `rename_group` `name` `to` [`agent`] | Renames a group. Asks only in manual mode |
| `remove_group` `name` [`agent`] | Removes a group and its conversations for good (not an agent's main one). You confirm every time ([agents.md](agents.md), "Groups of conversations") |

- A renamed conversation keeps its history, pin, tab, group and setup; a group takes the
  conversation's branches along.
- A tab the agent opens appears behind yours. Closing one ends its own subscriptions (you are
  asked) and keeps the conversation.
- Reading shows no tool results, so it is no way around another agent's sandbox. Reading a
  conversation with outside content (or one ending in `~u`) marks the reader too.
- No tool removes or renames the agent's own conversation or any agent's `main`, sets a folder or
  goal, or puts work into a conversation.

## What an agent has

An agent cannot read pine's configuration. It asks a tool what it has been given: `mcp_servers`
(and whether their tools are there), `skills`, `models` (and which one it runs on), `sources` (and
who is subscribed) and `schedules`. Each says whom a thing is for (this conversation, the agent,
all agents) and what only another conversation of the agent has.

## The tools

Every tool pine gives an agent, by purpose. The main agent's tools for agents, settings, routes
and conversations are in the sections above.

| Tool | Does |
|---|---|
| **Events** | |
| `sources` | Lists the event sources this conversation can use and who is subscribed |
| `add_source` `name` `type` `description` [`options`] [`scope`] [`note`] [`throttle`] [`own`] [`ask`] | Sets up a source ([source-types.md](source-types.md)); with `note` it also subscribes. `own: true`: your own device or folder, whose events are trusted. `ask`: secrets you type into the dialog |
| `subscribe` `source` [`scope`] [`note`] [`when`] [`throttle`] [`fresh`] | Starts being woken by a source; `fresh` gives each event a new conversation ([sources.md](sources.md)) |
| `unsubscribe` `source` [`scope`] | Ends it; scope `all` ends all of the agent's on that source |
| `send` `source` [`text`] [`file`] [`data`] | Sends through a source that can (Telegram, MQTT); `file` attaches a workspace picture, video or sound. A message to you on Telegram is never held for approval |
| `read_source` `source` [`data`] | Reads earlier messages through a source that can be asked (a Slack channel or thread: `data` is `{"channel": "C0123", "thread": "..."}`). Not asked about; the result is outside content |
| `remove_source` `name` | Stops and deletes a source, with its subscriptions and folder access |
| `add_source_type` `name` `file`, `remove_source_type` `name` | Main agent only. Registers a module as a new source type, or removes one ([sources.md](sources.md)) |
| **Schedules** | |
| `schedules` | Lists the agent's schedules and when each is next due |
| `add_schedule` `name` `task` + one of `cron`, `every`, `at`, `in` [`scope`] | Runs the task at set times, repeatedly, or once ([events.md](events.md), "Schedules") |
| `remove_schedule` `name` | Ends a schedule |
| **MCP servers** | |
| `mcp_servers` | Lists this conversation's servers, whom each is for, and whether its tools are there or missing (it did not start, or needs a sign-in) |
| `add_mcp_server` `name` `url` or `command` [`secrets`] [`description`] [`scope`] | Proposes a remote (https `url`) or local (`command`) server. A local one runs where the agent's commands run (its sandbox, or none in auto and bypass mode); `secrets` are key names you type into the dialog. Added again with `scope: "agent"`, a conversation's server becomes the agent's ([mcp.md](mcp.md)) |
| `remove_mcp_server` `name` | Removes a server, also from the conversation it belongs to |
| **Skills** | |
| `skills` | Lists this conversation's skills and whom each is for |
| `add_skill` `name` `description` `instructions` [`files`] [`scope`] | Writes or replaces a skill; `files` is a workspace folder to copy along ([agents.md](agents.md), "Skills") |
| `remove_skill` `name` | Deletes a skill from pine's skill folders (not one you listed under `skills`) |
| **Agents** | |
| `create_agent` `id` `instructions` [`model`] [`tools`] [`color`] | Main agent only. See "Creating an agent" |
| **Model servers and models** | |
| `add_model_server` `name` `url` [`context`] | Main agent only. See "Adding a model server" |
| `remove_model_server` `name` | Main agent only. Removes a server and its key; refused while an agent, the default, `defaults.judge`, `defaults.checker` or a route's `call` uses its models |
| `add_model` `model` [`context`] | Main agent only. Adds a model a server serves, as `server/model` |
| `configure_model` `model` [`context`] [`max_output`] [`pictures`] [`reasoning`] [`runs`] | Main agent only. Changes only what is given ("Setting up a model") |
| `remove_model` `model` | Main agent only. Removes a model from pine; refused while used, or for a server's last model |
| `models` | Lists models (`provider/model`), what each can do, and the agent's own. For the main agent, also what your servers serve that pine lacks or no longer finds |
| **Signing in** | |
| `sign_in` `provider` [`way`] | Main agent only. Logs pine in to a provider, such as a Claude or ChatGPT subscription (`way`: `browser`) or an API key (`key`); `typesafe` for Jev. After you confirm, pine's own dialog takes the page, key or code, which never reaches the agent; it is kept in `auth.json`. Same as `pine login` |
| `sign_out` `provider` | Main agent only. Removes a sign-in and names the agents that use it |
| `sign_in_mcp_server` `name` [`agent`] | Main agent only. After you confirm, signs in to a remote MCP server in the browser of pine's computer; pine keeps the token. Same as `pine mcp login <name>` |
| **Asking, and keeping track** | |
| `question` `question` [`header`] [`options`] [`multiSelect`] | Asks the owner one question the agent cannot go on without: two to six `options` (`{ label, description? }`, best first), a `header` of up to 12 characters, `multiSelect` for several. Works in plan mode, not in a run the owner did not start |
| `todo` `items` | The agent's list of steps, sent whole: each `pending`, `in_progress` (one) or `done`, up to 30. The owner sees it; pine reminds the agent after six tool calls without a change. Not in a run the owner did not start |
| **Other tools** | |
| `stop_program` [`id`] | Stops a program the conversation's commands left running or started with `background: true`; without `id`, lists them. Never asks. Only with `bash` ([coding.md](coding.md)) |
| `request_access` [`path`] [`write`] [`network`] `reason` | Asks you for a path outside the workspace (`write: true` to change it) or the network, until reset or restart ([security.md](security.md), "When a call needs something outside: pine asks you") |
| `delegate` `agent` `task` [`wait`] [`thread`] [`worktree`] | Hands a task to another agent ([agents.md](agents.md), "Handing work to another agent") |
| `subagent` `tasks` [`stages`] [`model`] [`thinking`] [`worktree`] [`pool`] [`ids`] [`note`] [`check`] [`verify`] | Runs copies of the agent side by side ([agents.md](agents.md), "Sub-agents"; [boards.md](boards.md)) |
| `download` `url` `path` | Fetches a file from the web into the workspace ([mcp.md](mcp.md), "Files and pictures from a remote server") |
| `boards`, `board_read`, `board_post`, `board_claim`, `board_done`, `board_answer`, `board_remove` | Tasks and notes of a job several agents share ([boards.md](boards.md)) |
| `publish_event` `topic` [`text`] [`data`] | Publishes on a topic of the agent's `publish` list; without one there is no such tool ([events.md](events.md)) |
| `state_get` `key`, `state_set` `key` `value` | Shared state within `state.read` and `state.write` ([agents.md](agents.md), "Shared state") |
| `manual` [`search`] [`read`] | Searches and reads this manual ([agents.md](agents.md), "The manual tool") |

The built-in tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) are chosen with `tools`
in `agent.json`. Everything takes effect without a restart, from the agent's next message. After
`add_mcp_server`, pine calls the agent again at once with the new tools.

## What is written

The tools write only these entries. One set up for a conversation carries its name as `session`,
which tells pine whose it is.

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

Removing "taxes" removes its source, subscription and read access; the server and schedule stay.

A skill needs no entry: its folder, holding a `SKILL.md` and its files, says whom it is for. Agents
read these folders but cannot write them, and `pine skills` lists them.

```
~/.pine/
  skills/<name>/                                       all agents
  agents/<id>/skills/<name>/                           that agent
  agents/<id>/conversations/<session>/skills/<name>/   that one conversation
```

## What stays yours

No tool changes the control API and its token, secrets in `.env`, a route's `reply`, local MCP
servers that run outside an agent's sandbox, a server's options once added, or source types you
write yourself. Change them in the files or with `pine`; most need a restart
([configuration.md](configuration.md)).
