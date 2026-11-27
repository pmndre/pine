---
name: pine
description: Run, configure and extend pine, the event-driven multi-agent daemon built on the pi coding agent SDK. Use when setting up agents, subscribing them to event sources (Telegram, folders, MQTT, webhooks, web addresses, feeds, mail, chat services, cameras and other devices, the computer itself), scheduling work, adding MCP servers and skills, routing events, delegating between agents, sub-agents and swarms on a board, using the Pine app (computer, phone or browser), reviewing the defences against prompt injection, or changing pine's code.
---

# Introduction

pine (PI neural engine) is one process that hosts several pi agent sessions and an event log.
Sources and schedules turn the world and the clock into events. Subscriptions, schedules and routes
turn events into work. Agents answer, act, hand tasks to each other and publish events.

Three things to know first:

1. Configuration lives in a home folder, by default `~/.pine`: `pine.json`, `models.json`, `.env`
   (secrets) and one folder per agent under `agents/`.
2. An agent is `agents/<id>/agent.json` plus a workspace. It keeps `AGENTS.md`, `SOUL.md`,
   `TOOLS.md` and `MEMORY.md` there, and pine reads them into its prompt. The main agent keeps
   `AGENTS.md`, `TOOLS.md` and `USER.md` for all agents in pine's home
   ([references/agents.md](references/agents.md)).
3. Where content came from decides what it may do. Your messages get the agent's full tools.
   Everything else is data: it runs with fewer tools in a separate session, or marks the
   conversation it arrives in as having read outside content. Nothing is sent out without your
   approval ([references/security.md](references/security.md)).

## Which file to read

The manual has six parts. Each chapter is one file in `references/`.

### Start here

| Chapter | What it holds |
|---|---|
| [How pine works](references/overview.md) | Events, tasks, agents, conversations, trust |
| [Install and run](references/operations.md) | Requirements, install, first start, models, updating, at login, in a container, problems |

### Where you talk to pine

| Chapter | What it holds |
|---|---|
| [The Pine app](references/desktop.md) | The app on a computer: window, tabs, code panel, settings, Manual tab, browser access |
| [Views for the Pine app](references/views.md) | A script of yours that draws pine in the app's panel |
| [The terminal UI](references/tui.md) | Tabs, slash commands, keys, modes, approvals, pictures, dictation |
| [The phone app](references/mobile.md) | Android and iPhone, over SSH or paired with the Pine app |
| [The web client](references/web.md) | pine in any browser; what the relay and the meeting service see |

### Agents

| Chapter | What it holds |
|---|---|
| [Agents](references/agents.md) | Workspace and files, persona, conversations, delegation, sub-agents, goal mode, skills |
| [Teams of agents: boards and swarms](references/boards.md) | Agents and sub-agents sharing a job on a board; swarms |
| [Working on code](references/coding.md) | Folders and worktrees, the code pane, programs left running, `/undo` |
| [MCP servers, web search and the browser](references/mcp.md) | Adding MCP servers; web search, page reading and the bundled browser |
| [Operating apps on the computer](references/computer.md) | Reading windows, clicking, typing; who may |

### Reacting to the world

| Chapter | What it holds |
|---|---|
| [Event sources and subscriptions](references/sources.md) | Watching, subscribing, sending and reading through a source, secrets, trust |
| [Source types](references/source-types.md) | Every type, its options and events, and which fits a service or device |
| [Schedules and routes](references/events.md) | Scheduled work; rules on events, topics, typed questions, webhooks |
| [Recipe: a page as an agent's control panel](references/interfaces.md) | A web page whose clicks wake an agent, which the agent changes |

### Setting pine up

| Chapter | What it holds |
|---|---|
| [Setup by asking an agent](references/setup.md) | What agents set up by tool call, for whom, what you are asked |
| [Configuration files](references/configuration.md) | Every key of `pine.json`, `agent.json`, `models.json` and `.env` |
| [Security and its limits](references/security.md) | Defences against prompt injection: sandbox, modes, approvals; what is not solved |

### Reference

| Chapter | What it holds |
|---|---|
| [Commands](references/commands.md) | Every `pine` command |
| [Control API](references/api.md) | The HTTP API for scripts and programs of your own |
| [Technology](references/stack.md) | What pine runs on and uses, what is not verified yet |

To change pine's own code, read [AGENTS.md](../AGENTS.md) and [docs/dev](dev/README.md).

## If you are an agent running inside pine

Search your `manual` tool before you answer a question about pine or say something is not
possible, then read the one or two parts that fit.

This manual names tools by their own names. A tool you don't have by that name is an action of a
family: `add_source` is `pine_sources` with `action: "add_source"`, the list `sources` is
`pine_list` with `what: ["sources"]` ([references/agents.md](references/agents.md), "How tools
are declared").

You set things up with tool calls, never with files: pine's home is closed to you, and the listing
tools (`sources`, `schedules`, `mcp_servers`, `skills`, `models`) say what is configured. Without
`scope`, a setup is for the conversation you are in. Pass a wider scope only when your owner says
so. For what has no tool (the control API, a secret), tell your owner the lines to write into
`pine.json` or `agents/<your id>/agent.json`, then `pine check` and a restart, and say that this
step is theirs.

"Not approved" means your owner said no. Don't try another way; say what you wanted and why.
Never ask for a password, token or key in the conversation: leave it out, and pine asks your owner
in its own dialog.

`AGENTS.md`, `SOUL.md`, `TOOLS.md` and `MEMORY.md` at the top of your workspace are yours. What
holds for all agents goes into pine's home, which only the main agent writes
([references/agents.md](references/agents.md), "Where a default or a preference goes").

| Tool | When your owner wants | Read |
|---|---|---|
| `sources`, `subscribe`, `add_source` | Something watched, or a reaction when it happens | [sources.md](references/sources.md) |
| `add_schedule` | Something at a set time: `cron`, `every`, `at` or `in` | [events.md](references/events.md) |
| `add_mcp_server` | An MCP server, by `url` or `command`; they confirm, and its tools arrive next turn. "Unauthorized" needs a sign-in: `sign_in_mcp_server` (main agent), or Settings > MCP servers | [mcp.md](references/mcp.md) |
| `add_skill` | A procedure remembered (a fact goes into `MEMORY.md`) | [agents.md](references/agents.md) |
| `question`, `todo` | A decision with two to six options; a list of steps, sent whole each time | [setup.md](references/setup.md) |
| `subagent` | A job split into independent tasks; many become a pool on your board | [boards.md](references/boards.md) |
| `stop_program` | Ends a server left running, started with `background: true` on the shell tool | [coding.md](references/coding.md) |
| `/goal`, `/swarm` | Work until something is reached, or a job led on a board. Only your owner types these | [agents.md](references/agents.md) |
| `mcp__computer__` | Something in an app on their computer, if you have these tools | [computer.md](references/computer.md) |
| `add_route` | A rule that acts on events without waking you | [events.md](references/events.md) |

Main agent only: `create_agent`; `update_agent`, `rename_agent`, `remove_agent` (removed for good,
with its folder); `sign_in` to a model provider; `add_model_server`; `set_setting`;
`conversations`; `add_source_type` for a device no type can watch
([references/setup.md](references/setup.md)). Any other agent sends your owner to the main agent.

## The shortest working setup

```bash
npm install -g @pmndre/pine
```

```bash
pine init
```

```bash
pine
```

You get the main agent, `main`, with web search and a browser, in the terminal UI (or the Pine app:
[references/desktop.md](references/desktop.md)). Then connect a model: `pine login <provider>` or
`pine model add` ([references/operations.md](references/operations.md), "Choosing a model").

For Telegram, ask the main agent to "watch Telegram", give the bot's token, write to the bot and
type the six-digit code it sends into pine ([references/source-types.md](references/source-types.md),
"telegram"). For a second agent, ask the main agent to create one
([references/agents.md](references/agents.md), "Creating an agent").

## Vocabulary

| Term | Meaning |
|---|---|
| event | A record in the log: topic, payload, source, trust, cause |
| topic | A slash-separated name, matched with `+` (one level) and `#` (the rest) |
| source | Reports events from outside; runs while something is subscribed, or always with `"start": "always"` |
| subscription | A conversation listening to a source |
| route | A rule in `pine.json` that reacts to topics |
| schedule | Something done at set times, every so often, or once |
| task | One piece of work for one agent |
| session | A conversation with its history; `new` is one-off |
| sub-agent | A copy of an agent that does one task in an empty conversation |
| board | The shared tasks and notes of one job |
| goal, swarm | `/goal`: called again until a judge says it is met. `/swarm`: the agent leads sub-agents on a board |
| owner | You, through a channel that authenticated you. Everything else is untrusted |
| tainted | A session that has read outside content |
| approval | Your yes or no to one tool call |
| mode | How much an agent does without asking: `safe`, `auto`, `manual`, `bypass`, with `plan` on top |
| extension | A pi plug-in, usable in pine sessions |
