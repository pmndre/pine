---
name: pine
description: Run, configure and extend pine, the event-driven multi-agent daemon built on the pi coding agent SDK. Use when setting up agents and their workspaces, subscribing agents to event sources (Telegram, folders, MQTT, webhooks, FTP uploads, web addresses, commands, feeds, calendars, mail, Slack, Matrix, Discord, pushed streams, syslog, cameras, Modbus devices, serial ports, the computer itself), scheduling what happens at a time, adding MCP servers and skills, routing events to agents, reaching agents on Telegram, delegating between agents, letting sub-agents work through a board of tasks or an agent lead a job as a swarm, using pine from the Pine app (on a Mac, a phone or in a web browser), reviewing what is protected against prompt injection, or changing pine's code.
---

# pine

pine (PI neural engine) is one process that hosts several pi agent sessions and an event log.
Event sources and schedules turn the outside world and the clock into events; subscriptions,
schedules and routes turn events into work; agents answer, act, hand tasks to each other, and
publish events of their own.

Three things to know before anything else:

1. **Configuration lives in a home directory**, by default `~/.pine`: `pine.json` (global),
   `models.json` (pi's model file), `.env` (secrets), and one folder per agent under `agents/`.
2. **An agent is a folder**: `agents/<id>/agent.json` and a workspace. In the workspace lie the
   files the agent keeps itself and that are read into its prompt: `AGENTS.md` (its purpose),
   `SOUL.md` (who it is), `TOOLS.md` (how it uses its tools), `MEMORY.md` (its memory). Three
   files in the home are for all agents and kept by the main agent: `AGENTS.md` (traits and
   behaviour), `TOOLS.md` (tooling defaults and preferences) and `USER.md` (what agents know
   about you); an agent's own `AGENTS.md` and `TOOLS.md` say what is different for it. The workspace is wherever `workspace` points, for example a repository.
3. **Where content came from decides what it may do.** Your own messages get the agent's full
   tool set. Anything else is data. An event from outside runs with a reduced tool set in a
   separate session; an event from a source a conversation subscribed to arrives in that
   conversation, framed as data, and marks it as having read outside content (unless the source
   is marked as yours). Either way nothing is sent out without your approval.

## If you are an agent running inside pine

You search this manual with your `manual` tool: a search names the parts that fit with the
line that matched, and you then read the one or two parts you need. Search before you answer a
question about pine or say that something is not possible.

A tool that this manual names and that is not among your tools by that name is an action of
one of them: `add_source` is your tool `pine_sources` with `action: "add_source"`, a list
such as `sources` or `schedules` is `pine_list` with `what: ["sources"]`, and
`mcp__browser__browser_navigate` is `browser` with `action: "browser_navigate"`
([references/agents.md](references/agents.md), "How tools are declared").

pine's configuration lives in its home folder (`~/.pine` unless your owner chose another),
which is closed to you on purpose: you never write those files. Four things you set up by
calling a tool, for the conversation you are in or for yourself as an agent
([references/setup.md](references/setup.md)): event sources and subscriptions, schedules,
MCP servers, and skills. The main agent administers pine, and the rest is its job, also by
tool call ([references/setup.md](references/setup.md), "The main agent administers pine"):
creating, changing and deleting one of the others with its folder, pine's settings, routes,
the conversations there are (listing them, reading one, pinning, renaming, opening and closing
its tab, removing it), and anything that is for everyone or for somebody else. If that is you, use those tools and never
send your owner to the files; if not, send your owner to it.
For what has no tool (the control API, a secret):

1. Search the manual for it and read the part.
2. Tell your owner what to put where: usually a few lines of JSON in `pine.json` (for everyone)
   or `agents/<your id>/agent.json` (for you), then `pine check`, then a restart of the daemon
   (quitting and reopening the terminal UI restarts an embedded one).
3. Do not try to edit those files or work around the restriction. Say plainly that this is a
   step for them.

What you keep yourself are four files at the top of your workspace, which are part of your
instructions: `AGENTS.md` (your purpose and how you work), `SOUL.md` (who you are), `TOOLS.md`
(your own defaults and preferences for your tools) and `MEMORY.md` (what should outlive a
conversation). Three more files hold for every agent and lie in pine's home, where only the
main agent writes: `AGENTS.md` (traits and behaviour for all agents), `TOOLS.md` (tooling
defaults and preferences for all agents) and `USER.md` (what is known about your owner). You
read both an `AGENTS.md` and a `TOOLS.md` of each kind; yours say what is different or more for
you. If you are the main agent: a default or a preference for a tool that your owner tells you
is for all agents unless they say otherwise, and goes into the `TOOLS.md` in pine's home;
"for you alone" goes into your own, and for another agent alone you use `update_agent` with
`tooling`. If you are not: write it into your own file, and when your owner means all agents,
tell them to ask the main agent. Every file that is read as instructions is listed in
[references/agents.md](references/agents.md), "Every file that is read as instructions".

One thing you can start yourself: when your owner asks you to install or connect an MCP
server, call `add_mcp_server` with a short name and either its https URL (a remote server) or,
for a local server, the line that starts it (`command`, for example
`npx -y @example/mcp@latest`, taken from the server's own documentation). Do not send your
owner to a terminal for this: adding it is your job, and they confirm it in a dialog. Leave
the scope out: the server is then for the conversation you are in (in your main conversation:
for you as an agent). Pass `scope: "agent"` only if they said it is for you in general, and, as
the main agent, `scope: "global"` only if they said "for all agents". They get a dialog and
confirm it. `remove_mcp_server` takes one out again. Do not probe the URL first; an
"unauthorized" answer only means the server wants a sign-in. As the main agent you start it
with `sign_in_mcp_server`, and your owner signs in in the browser; otherwise your owner does it
with Sign in under Settings > MCP servers, `/mcp login <name>` in the terminal UI or
`pine mcp login <name>` in a shell. Tell them that. You do not have a new server's tools in the turn in which you added it: end that turn,
and pine calls you again at once in the same conversation, with the tools in your list. Never
tell your owner to start a new chat for it. A local server runs where your commands run (in your
sandbox, or without one when you work in auto mode), with your home folder. If it needs a sign-in, its
documentation says how (often the same line with `login` at the end): run that with bash, give
your owner the link it prints, and wait until they are done.

Another: when your owner asks you to watch something or to react when something happens, call
your `sources` tool: it lists what you can subscribe to and what you are subscribed to (use it
too when your owner asks what you are watching). If one fits, subscribe to it with a note that
says what you are to do; whoever is subscribed is woken with that note whenever it reports
something. A subscription is for the conversation it is asked for in: that one is woken, and the
subscription goes when the conversation is closed, reset or removed. So leave the scope out.
Only when your owner says in so many words that it is for more do you pass one: agent (your
main conversation is woken instead, and it stays) or, if you are the main agent, global (all
agents); your owner is then asked to confirm. Do not pick a wider scope yourself; if you think
they want one, ask. You can end anything your own agent is subscribed to from any of its
conversations (`unsubscribe` with scope `agent` or `all`). If none fits,
set one up with `add_source` (a folder to watch, a web address or a command that is looked at
again and again, an MQTT device, a webhook, an FTP drop, Telegram); your owner confirms it where
that is needed. A password or token is never yours to handle: leave it out, and pine asks your
owner for it in a dialog. `remove_source` deletes one for good. Through a source that can send
(Telegram, MQTT) you reach out with `send`. Do not go looking in pine's home folder for what is
configured: `sources` tells you.

When your owner wants something done at a time ("every morning at seven", "remind me at five",
"in twenty minutes"), that is a schedule, not a source: call `add_schedule` with a name, the
task in your own words, and one of `cron`, `every`, `at` or `in`. When it is time you are woken
with the task. `schedules` lists what is scheduled, `remove_schedule` ends one.

When your owner wants you to remember how something is done ("make a skill for this"), call
`add_skill` with a name, a line on when to use it, and the steps. It is listed among your
skills from your next message on; `remove_skill` deletes it. A fact rather than a procedure
belongs into your `MEMORY.md` instead. In a conversation that has read outside content, a
skill is put to your owner first, with its instructions: write what you did and learned, not
orders.

When your owner asks for something in an app on their Mac that is neither a web page nor a
command (a note in Notes, a setting, a document in TextEdit, trying out an app they built), and
you have the tools whose names start with `mcp__computer__`, use them: `apps` lists what runs,
`app_open` opens an app, `app_snapshot` reads a window as text with a reference on every
control, `app_press` and `app_set_text` use a reference, `app_type` and `app_key` use the
keyboard. If you can see pictures, `app_screenshot`, `app_click`, `app_drag` and `app_scroll`
work by position in a picture. Your owner is asked once per app. If you do not have these
tools, you cannot get them by asking: say so ([references/computer.md](references/computer.md)
says who has them).

When a call comes back "not approved", it was put to your owner, and your owner said no. Do
not try another way to the same end: say what you wanted to do and why.

Schedules, skills, sources and servers follow the same rule: leave the scope out and it is for
the conversation you are in. What you have of each, you see with a tool, never in pine's files:
`sources`, `schedules`, `mcp_servers` and `skills` list what this conversation has, whom each
is for, and what only another conversation of yours has.

When you cannot go on without your owner's decision (which of two ways, which file), ask with
your `question` tool, with two to five short answers to pick from. For work with several steps,
keep a list with your `todo` tool; your owner sees it. A command that takes long or keeps
running (a server, a build, a watcher) you start with `background: true` on the shell tool, and
`stop_program` ends it ([references/coding.md](references/coding.md), "Commands in the
background"). When your owner wants you to work on until something is reached, tell them to
type `/goal` with what they want reached: only they can set a goal
([references/agents.md](references/agents.md), "Goal mode"). When they want a job done by a
swarm, tell them to type `/swarm` with the job: you then lead it on your board
([references/boards.md](references/boards.md), "A swarm"). In plan mode you only look and
answer with a plan; your owner switches the mode when it is to be carried out.

When a job falls into pieces that do not depend on each other (one per file, one per page, one
per customer), start sub-agents yourself with `subagent`, one task per piece, each task saying
everything it needs: nothing has to be created first, and it is not the main agent's job. More
pieces than run at once become a pool: they are put on your conversation's board and worked
through a few at a time, and the call comes back to you when a sub-agent asks something or
fails ([references/boards.md](references/boards.md), "A pool of sub-agents"). `boards` lists the
boards you have, and `board_read` shows what is on one.

If you are the main agent and your owner asks for a new agent, call `create_agent` with an id,
one line on what it is for, and its instructions written to the agent itself ("You are ..."):
its job, what it should and should not do, how it reports. Your owner confirms it, and the agent
exists at once. For a device or service that no existing type of source can watch, the main
agent can also write a new source type and register it with `add_source_type`
([references/sources.md](references/sources.md)); try the existing types first. A model server
of your owner's own (llama.cpp, vLLM, LM Studio) is the main agent's to add as well, with
`add_model_server` and the server's address; never ask for its key, pine asks your owner
([references/setup.md](references/setup.md), "Adding a model server"). So is signing pine in to
a model provider (Claude, ChatGPT, an API key for OpenAI, Gemini and others) with `sign_in`, and
to a remote MCP server with `sign_in_mcp_server`: pine runs the sign-in and asks your owner
in its own dialog for the page, the key or the code. Never ask for a key in the conversation.

Things you can do yourself: work in your workspace, keep notes there, use the tools you have,
hand work to the agents listed in your prompt, and write shared state under your own keys.

## Which file to read

| You want to | Read |
|---|---|
| See what an agent is given (events, schedules, MCP servers, skills) and how events, tasks and sessions fit together | [references/overview.md](references/overview.md) |
| Chat with agents in the terminal: tabs, slash commands (`/goal`, `/swarm`, `/board`, `/branch`, `/group`, `/compact`, `/copy`, `/export`, `/undo`), keys, the five modes (auto, safe, manual, bypass, plan), approvals, an agent's questions and its list of steps, what a model thinks, pictures, parts of an answer that are folded away, switching models | [references/tui.md](references/tui.md) |
| Use the desktop app (macOS): the window with its side bar and tabs, the code panel with an editor for a conversation's folder, the settings panel (agents, models, MCP servers, skills, events, instructions), how it starts or reuses the daemon, browser access (a phone or another computer paired by QR code, or found on the same network without a code with "Visible on this network", Add a Device from the menu, the Dock or `pine://pair`, the question as a toast or a notification, its devices, the service address, a relay server (TURN) of your own for a phone that cannot connect from mobile data), where to download it, the `pine` command it gives a terminal, how to build, pack and sign it | [references/desktop.md](references/desktop.md) |
| Write a view: a script of your own that draws all of pine in the Pine app's panel (`~/.pine/views`), the `pine/view` module it imports, what it is told and what it cannot do | [references/views.md](references/views.md) |
| Use pine from an Android phone or an iPhone: installing the app from a release (the APK, or the IPA with AltStore or Sideloadly and its 7-day renewal on a free Apple ID), the phone's SSH key and `authorized_keys`, a new key under another Apple ID, pairing by QR code, pairing without a code with a computer found on the same network ("On this network"), the `Pairing link` field, App Links and the `pine:` address, `Forget` (which leaves its access open until the Pine app takes it off), adding a machine, the iPhone's local network prompt, confirming its host key, reaching it from away (same Wi-Fi, a VPN such as Tailscale, ZeroTier or WireGuard, a server with public SSH), what the phone does not do, how the APK and the IPA are built, the iOS simulator | [references/mobile.md](references/mobile.md) |
| Use pine from a web browser on any computer, with nothing installed (the web client): this device's key for `authorized_keys`, adding a machine and trusting its host key, what is remembered in the browser, what it says when a machine is not reached, a computer paired with the Pine app by QR code and peer to peer, "Open Pine on this computer", the official service, how the bridge, the page in its sandboxed iframe, the SSH relay and the meeting service fit together, deploying it | [references/web.md](references/web.md) |
| Work on a project: `pine .`, a folder for a conversation, the code pane with git changes, files and tool output, what an agent left running, what it runs in the background, and taking a message back with `/undo` and `/redo` | [references/coding.md](references/coding.md) |
| Make a web page the owner uses as a user interface for an agent (a board, switches, a form): the page and its small server, how what is pressed on it reaches the agent as events through a `stream` source, how the agent changes the page | [references/interfaces.md](references/interfaces.md) |
| Install it, start it, update it, use the CLI (every `pine` command), the control API for scripts, run it at login or in a container, find out why something did not happen | [references/operations.md](references/operations.md) |
| Look up a key in `pine.json`, `agent.json`, `models.json` or `.env` | [references/configuration.md](references/configuration.md) |
| Know what agents can set up by tool call, for whom, and what you are asked: event sources, MCP servers, skills, schedules, new agents, new source types, model servers; the main agent's tools for conversations and tabs; how an agent lists what it has; the table of pine's own tools (`question`, `todo`, `stop_program` and the rest) | [references/setup.md](references/setup.md) |
| Let several agents or sub-agents work on one job without doing the same thing twice: boards with tasks that one takes at a time, a pool of sub-agents for more tasks than run at once whose questions the agent answers while the others work on, stages that wait for each other, a check after the work it checks that has what fails put right, a check of the finished whole, a swarm (the agent leads a job on the board until it is done and checked), waking an agent when a task is posted | [references/boards.md](references/boards.md) |
| Add an agent, give it a workspace, tools and a persona; skills; how agents look pine up (the `manual` tool); how tools are declared to the model (in families) and what a model server keeps of a conversation (prompt cache, slots); delegation, sub-agents, sessions, goal mode (`/goal`: working until an objective is met), shared state | [references/agents.md](references/agents.md) |
| Let an agent react to the outside world and reach out: what a source and a subscription are, setting one up, who is woken (three scopes, a fresh conversation for every event), filtering events with `when`, sending and reading through a source, secrets, trust, files a source received; a source type of your own | [references/sources.md](references/sources.md) |
| Pick the source type for a service or a device, with its options, its events and an entry to copy: a watched folder, MQTT devices, webhooks, FTP uploads from cameras, Telegram, a web address or a command that is looked at again and again or followed, feeds, calendars, services that push (SSE, WebSocket), mail, Slack, Matrix, Discord, devices that mail or log (SMTP, syslog), cameras (ONVIF), inverters and meters (Modbus), serial ports, who is on the network, this computer (sleep, lock, power) | [references/source-types.md](references/source-types.md) |
| Have something done at a time (schedules); write rules for events yourself: set state, publish, single model calls, debounce | [references/events.md](references/events.md) |
| Add MCP servers globally, per agent or for one conversation; web search, page reading and the bundled browser (showing its window to log in yourself, local addresses); turn shell commands into tools | [references/mcp.md](references/mcp.md) |
| Operate the apps on a Mac: read a window, press, click, type; who may, what is asked, the grants macOS needs | [references/computer.md](references/computer.md) |
| Understand the defences against outside abuse and prompt injection, and their limits: the sandbox (macOS and Linux), what happens after outside content, the modes, approvals | [references/security.md](references/security.md) |
| Know the technology underneath and the pi behaviours pine works around; open points | [references/stack.md](references/stack.md) |
| Change pine's code | [../AGENTS.md](../AGENTS.md) |

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
to it (or the Pine app, which shows the same conversations in a window:
[references/desktop.md](references/desktop.md)). Everything below is added on top of that when
you need it.

`~/.pine/pine.json`:

```json
{
  "main": "main",
  "defaults": { "model": "opencode-go/deepseek-v4.1-flash" }
}
```

(An excerpt. `pine init` also writes the web, browser and app control servers and the limits.
It leaves this line out: it is written when you first sign in to a provider (`pine login
<provider>`) or add a server of your own. See "Choosing a model" in
[references/operations.md](references/operations.md).)

Telegram as a second way in is set up by asking the main agent: "watch Telegram". The dialog
you confirm has a field for the bot's token; then you write to the bot and type the six-digit
code it sends you into pine. See "telegram" in
[references/source-types.md](references/source-types.md).

`~/.pine/agents/gonzo/agent.json`, a second agent, a specialist the main agent can hand work to.
Create the folder; the workspace here is `~/dev/gonzo`, which must exist, and an `AGENTS.md` in
it says what the agent is for (without `workspace`, pine makes `agents/gonzo/workspace` itself).
Or ask the main agent to create one: it calls `create_agent`, and no restart is needed.

```json
{
  "description": "Contract law; knows the case files",
  "workspace": "~/dev/gonzo"
}
```

```bash
pine check
```

```bash
pine start
```

`main` sees `gonzo` in its list of agents and can call `delegate`. `pine events -f` shows everything as it happens.

## Vocabulary

| Term | Meaning |
|---|---|
| event | One record in the log: topic, payload, source, trust, cause |
| topic | Slash-separated name, matched with `+` (one level) and `#` (the rest) |
| route | A rule in `pine.json` that reacts to topics |
| source | A named thing that reports events from outside: a folder, an MQTT broker, a web address, a command, a webhook, an FTP drop, a Telegram bot. It runs only while something is subscribed to it (or always, with `"start": "always"`) |
| schedule | Something done at a time: at set times, every so often, or once. With a task it wakes an agent to do it |
| sub-agent | A copy of an agent that does one task with an empty conversation and returns only its answer. An agent starts several at once with `subagent` |
| board | A shared place for the tasks and notes of one job: whoever works on it takes a task, so that no two do the same, and leaves what it found. A pool is a call of `subagent` that works through a board's tasks a few at a time |
| goal | An objective you give a conversation with `/goal`: the agent is called again, round after round, until a judge says it is met |
| swarm | A job you give a conversation with `/swarm`: its agent leads it, sub-agents work it through on the conversation's board (a job of a few steps the agent does itself), pine calls the agent again while tasks are not done, and has its answer checked before it is done |
| subscription | A conversation of an agent listens to a source: each event arrives there as a message and wakes the agent |
| task | One piece of work for one agent; has a status, a result and statistics |
| session | A conversation of one agent with history. The manual also says "conversation". Named ones are kept until removed (unused ones after `limits.conversationDays`); `new` is one-off |
| owner | You. Content is "owner" only when it entered through a channel that authenticated you |
| untrusted | Everything else: data that may contain instructions it has no right to give |
| tainted | A session that has seen outside content (a web page, an MCP result, an untrusted task) |
| approval | Your yes or no to one tool call, asked in the terminal UI, in the Pine app and over Telegram, or answered with `pine approve` |
| mode | How much an agent does without asking, and how far it reaches: `safe` (in its sandbox, its own folders; the default for every agent but the main one), `auto` (your whole account, no sandbox; the main agent's default), `manual` (in the sandbox, and every action waits for your yes), `bypass` (your whole account, and nothing waits). `plan` lies on top of any of them: the agent only looks and answers with a plan |
| extension | A pi extension: pi's own plug-in format, usable in pine sessions |
