---
name: pine
description: Run, configure and extend pine, the event-driven multi-agent daemon built on the pi coding agent SDK. Use when setting up agents and their workspaces, subscribing agents to event sources (Telegram, folders, MQTT, webhooks, FTP uploads, web addresses, commands, feeds, calendars, mail, Slack, Matrix, Discord, pushed streams, syslog, cameras, Modbus devices, serial ports, the computer itself), scheduling what happens at a time, adding MCP servers and skills, routing events to agents, reaching agents on Telegram, delegating between agents, letting sub-agents work through a board of tasks or an agent lead a job as a swarm, using pine from the Pine app (on a computer, a phone or in a web browser), reviewing what is protected against prompt injection, or changing pine's code.
---

# pine

pine (PI neural engine) is one process that hosts several pi agent sessions and an event log.
Event sources and schedules turn the outside world and the clock into events; subscriptions,
schedules and routes turn events into work; agents answer, act, hand tasks to each other, and
publish events of their own.

Three things to know first:

1. **Configuration lives in a home folder**, by default `~/.pine`: `pine.json` (global),
   `models.json` (models), `.env` (secrets), and one folder per agent under `agents/`.
2. **An agent is a folder**: `agents/<id>/agent.json` and a workspace (wherever `workspace`
   points, for example a repository). The workspace holds the files the agent keeps itself and
   that are read into its prompt: `AGENTS.md` (its purpose), `SOUL.md` (who it is), `TOOLS.md`
   (how it uses its tools), `MEMORY.md` (what it remembers). pine's home holds `AGENTS.md`,
   `TOOLS.md` and `USER.md` for all agents, kept by the main agent
   ([references/agents.md](references/agents.md), "Every file that is read as instructions").
3. **Where content came from decides what it may do.** Your own messages get the agent's full
   tools. Everything else is data: an outside event runs with fewer tools in a separate session,
   or arrives in a subscribed conversation framed as data and marks it as having read outside
   content. Nothing is sent out without your approval
   ([references/security.md](references/security.md)).

## Which file to read

| You want to | Read |
|---|---|
| See how events, tasks, sessions and what an agent is given fit together | [references/overview.md](references/overview.md) |
| Chat in the terminal UI: tabs, slash commands, keys, modes, approvals | [references/tui.md](references/tui.md) |
| Use the Pine app on a computer: window, code panel, settings, browser access for a phone or browser | [references/desktop.md](references/desktop.md) |
| Write a view: your own script that draws pine in the Pine app's panel | [references/views.md](references/views.md) |
| Use pine from an Android phone or an iPhone | [references/mobile.md](references/mobile.md) |
| Use pine from a web browser with nothing installed; what the relay and the meeting service see, a deployment of your own | [references/web.md](references/web.md) |
| Work on a project: a folder for a conversation, the code pane, programs left running, `/undo` | [references/coding.md](references/coding.md) |
| Make a web page that works as a user interface for an agent | [references/interfaces.md](references/interfaces.md) |
| Install, start, update, the CLI, the control API, problems | [references/operations.md](references/operations.md) |
| Look up a key in `pine.json`, `agent.json`, `models.json` or `.env` | [references/configuration.md](references/configuration.md) |
| Know what agents set up by tool call, for whom, and what you are asked | [references/setup.md](references/setup.md) |
| Let sub-agents or several agents share one job on a board; a swarm | [references/boards.md](references/boards.md) |
| Agents: workspace, persona, skills, sessions, delegation, sub-agents, goal mode | [references/agents.md](references/agents.md) |
| Let an agent react to the outside world and reach out: sources and subscriptions | [references/sources.md](references/sources.md) |
| Pick a source type for a service or device, with its options | [references/source-types.md](references/source-types.md) |
| Schedules, routes, topics, typed questions, webhooks | [references/events.md](references/events.md) |
| MCP servers; web search, page reading and the bundled browser | [references/mcp.md](references/mcp.md) |
| Operate the apps on the computer: read a window, click, type | [references/computer.md](references/computer.md) |
| The defences against prompt injection and their limits: sandbox, modes, approvals | [references/security.md](references/security.md) |
| What pine runs on, which system programs it uses, what is not verified yet | [references/stack.md](references/stack.md) |
| Change pine's code | [../AGENTS.md](../AGENTS.md) |

## If you are an agent running inside pine

**Look things up.** Your `manual` tool searches this manual: search, then read the one or two
parts that fit. Search before you answer a question about pine or say something is not possible.

**Tool names.** A tool this manual names that you do not have by that name is an action of one of
yours: `add_source` is `pine_sources` with `action: "add_source"`, the list `sources` is
`pine_list` with `what: ["sources"]`, `mcp__browser__browser_navigate` is `browser` with
`action: "browser_navigate"` ([references/agents.md](references/agents.md), "How tools are
declared").

**Setup is a tool call, never a file.** pine's home folder is closed to you; you never write
its files, and you never look there for what is configured: a listing tool tells you
(`sources`, `schedules`, `mcp_servers`, `skills`, `models`). Leave `scope` out and what you set
up is for the conversation you are in; pass a wider one only when your owner says so in words
([references/setup.md](references/setup.md)). For what has no tool (the control API, a secret):
find it in the manual, tell your owner the lines to write into `pine.json` or
`agents/<your id>/agent.json`, then `pine check` and a restart. Say plainly that this step is
theirs.

**A no is a no.** A call that comes back "not approved" was put to your owner, who said no. Do
not try another way; say what you wanted and why. Never ask for a password, token or key in the
conversation: leave it out, and pine asks your owner in its own dialog.

**Your files.** `AGENTS.md`, `SOUL.md`, `TOOLS.md` and `MEMORY.md` at the top of your workspace
are yours to keep. A preference that is for all agents goes into pine's home, which only the
main agent writes ([references/agents.md](references/agents.md), "Where a default or a
preference goes").

What you can do:

| Tool | When your owner wants | Read |
|---|---|---|
| `sources`, `subscribe`, `add_source` | Something watched, or a reaction when it happens: list what exists, subscribe with a note, or set a source up | [setup.md](references/setup.md), [sources.md](references/sources.md) |
| `add_schedule` | Something at a time ("every morning at seven", "in twenty minutes"): `cron`, `every`, `at` or `in` | [events.md](references/events.md), "Schedules" |
| `add_mcp_server` | An MCP server installed or connected: its https `url`, or the `command` that starts it; do it yourself, they confirm. Its tools come in your next turn, which pine starts at once. "Unauthorized" means it wants a sign-in: `sign_in_mcp_server` (main agent), else Sign in under Settings > MCP servers | [mcp.md](references/mcp.md) |
| `add_skill` | A procedure remembered. A fact goes into `MEMORY.md` instead | [agents.md](references/agents.md), "Skills" |
| `question` | A decision before you can go on: two to six options | [setup.md](references/setup.md), "The tools" |
| `todo` | Work of several steps tracked: the whole list each time | [setup.md](references/setup.md), "The tools" |
| `subagent` | A job split into independent pieces: one complete task each; many become a pool on your board | [agents.md](references/agents.md), "Sub-agents"; [boards.md](references/boards.md) |
| `stop_program` | A server, build or watcher that keeps running: start it with `background: true` on the shell tool, end it with this | [coding.md](references/coding.md), "Commands in the background" |
| `/goal`, `/swarm` | Work until something is reached, or a job led on a board: only your owner can start one, so tell them to type it | [agents.md](references/agents.md), "Goal mode"; [boards.md](references/boards.md), "A swarm" |
| `mcp__computer__` | Something in an app on their computer, if you have these tools; asking does not get them | [computer.md](references/computer.md) |
| `add_route` | A rule that acts on events without waking you | [events.md](references/events.md), "Routes" |
| `create_agent` | A new agent (main agent only): an id and instructions written to the agent | [setup.md](references/setup.md), "Creating an agent" |
| `update_agent`, `rename_agent`, `remove_agent` | Another agent changed, renamed, or removed for good together with its folder (main agent only) | [setup.md](references/setup.md), "Changing and removing an agent" |
| `sign_in`, `sign_in_mcp_server` | pine signed in to a model provider or a remote MCP server (main agent only) | [setup.md](references/setup.md), "The tools" |
| `add_model_server` | A model server of their own (main agent only) | [setup.md](references/setup.md), "Adding a model server" |
| `set_setting` | A setting for all agents (main agent only) | [setup.md](references/setup.md), "pine's settings" |
| `conversations` | Their tabs and conversations listed, read, pinned, opened or removed (main agent only) | [setup.md](references/setup.md), "Conversations and tabs" |
| `add_source_type` | A device no source type can watch (main agent only), after trying the existing types | [sources.md](references/sources.md) |

If something is the main agent's job and you are not the main agent, send your owner to it.

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

One agent, `main` (the main agent), with web search and a browser, and the terminal UI to talk
to it (or the Pine app: [references/desktop.md](references/desktop.md)). `pine init` writes
`~/.pine/pine.json` with the control API and the web, browser and app control servers; the
default model is written when you first sign in to a provider (`pine login <provider>`) or add a
server of your own ([references/operations.md](references/operations.md), "Choosing a model").

Telegram as a second way in: ask the main agent to "watch Telegram". The dialog asks for the
bot's token; then you write to the bot and type the six-digit code it sends you into pine
([references/source-types.md](references/source-types.md), "telegram").

A second agent, a specialist the main agent can hand work to: ask the main agent to create one
(`create_agent`, no restart). By hand: `~/.pine/agents/gonzo/agent.json` with

```json
{ "workspace": "~/dev/gonzo" }
```

and an `AGENTS.md` in that workspace whose first paragraph says what the agent is for (without
`workspace`, pine makes `agents/gonzo/workspace`). Then:

```bash
pine check
```

```bash
pine start
```

`main` sees `gonzo` in its list of agents and can `delegate` to it. `pine events -f` shows
everything as it happens.

## Vocabulary

| Term | Meaning |
|---|---|
| event | One record in the log: topic, payload, source, trust, cause |
| topic | Slash-separated name, matched with `+` (one level) and `#` (the rest) |
| route | A rule in `pine.json` that reacts to topics |
| source | A named thing that reports events from outside (a folder, an MQTT broker, a web address, a Telegram bot). It runs while something is subscribed to it, or always with `"start": "always"` |
| subscription | A conversation of an agent listens to a source: each event wakes it there |
| schedule | Something done at a time: at set times, every so often, or once |
| task | One piece of work for one agent, with a status and a result |
| session | A conversation of one agent with its history; also "conversation". `new` is one-off |
| sub-agent | A copy of an agent that does one task in an empty conversation and returns its answer |
| board | The shared tasks and notes of one job; a pool is a `subagent` call that works through them |
| goal | An objective set with `/goal`: the agent is called again until a judge says it is met |
| swarm | A job set with `/swarm`: the agent leads sub-agents on its board until it is done and checked |
| owner | You. Content is "owner" only when it came through a channel that authenticated you |
| untrusted | Everything else: data that may contain instructions it has no right to give |
| tainted | A session that has read outside content (a web page, an MCP result, an untrusted task) |
| approval | Your yes or no to one tool call |
| mode | How much an agent does without asking and how far it reaches: `safe`, `auto`, `manual`, `bypass`, with `plan` on top ([references/security.md](references/security.md), "Modes: how much an agent does without asking") |
| extension | A pi extension: pi's plug-in format, usable in pine sessions |
