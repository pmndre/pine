<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg">
    <img src="docs/images/logo-light.svg" alt="pine" width="360">
  </picture>
</h1>

pine (PI neural engine) runs AI agents that react to events as well as to chat. It is a daemon
built on the pi coding agent, with a desktop app, a terminal UI, a phone app and a web client.

## Install

**[Download the Pine app](https://github.com/pmndre/pine/releases/latest)** for macOS, Windows
and Linux. It carries pine and the Node it runs on, and gives your terminal the `pine` command.
On a Mac with Homebrew:

```bash
brew tap pmndre/pine https://github.com/pmndre/pine
```

```bash
brew install --cask pmndre/pine/pmndre-pine
```

For a terminal or a server, with Node 24 or newer:

```bash
npm install -g @pmndre/pine
```

```bash
pine init
```

```bash
pine
```

`pine init` makes pine's home (`~/.pine`) and fetches the browser the web tools drive. On Linux it
also sets up the sandbox, after showing what it would install and asking once. `pine` opens the
terminal UI.

A new pine has no model. The app asks for one at its first start: a Claude, ChatGPT or GitHub
Copilot subscription, an API key, or a model server on your computer. In a terminal:

```bash
pine login anthropic
```

```bash
pine model add studio http://127.0.0.1:8080
```

`pine login openai-codex` uses a ChatGPT subscription, and `pine login` with an unknown name lists
every provider. `pine model add` takes llama.cpp, vLLM, LM Studio, Ollama or anything else with
OpenAI's chat API ([operations.md](docs/references/operations.md)).

## pine makes AI reactive

Most harnesses wait for you to type, and some run a task on a schedule. pine's agents also wake
when something happens: a file lands in a folder, a mail arrives, a price changes on a page, a
camera sees someone at the door, a build fails. Tell an agent what to watch:

> Watch ~/Documents/scans. For every new file, pull out a summary and any payment details.

The agent picks an event source, you confirm, and it reacts for as long as pine runs. Chat,
coding, memory, schedules and orchestration are all there too.

```
          you:  Pine app · terminal UI · phone · browser · Telegram
                               │
                               ▼
 wake it                 ┌───────────┐            it uses
 events ───────────────► │           │ ◄───────── MCP servers
   folders · mail · chat │           │ ◄───────── skills
   web pages · webhooks  │   agent   │ ◄───────── extensions
   MQTT · cameras · etc  │           │
 schedules ────────────► │           │
   repeating · once      └─────┬─────┘
                               │  delegate ──► other agents
                               │  subagent ──► copies of itself, in parallel
                               │  boards   ──► shared tasks and notes
                               ▼
                 answers · messages · actions
```

## What is in it

| | |
| --- | --- |
| Event sources | Folders, web pages and APIs, feeds, calendars, mail, Telegram, Slack, Matrix, Discord, Zulip, webhooks, streams, MQTT, Modbus, ONVIF cameras, FTP, SMTP, syslog, serial ports, commands, devices joining your network, and the computer itself (sleep, lock, power, disks). A type is one `.ts` file with a schema, and the main agent can write a new one ([source-types.md](docs/references/source-types.md)) |
| Setup by asking | The main agent creates agents and adds sources, schedules, MCP servers, skills, extensions and model servers by tool call. Each call checks its input and writes one entry, and whatever opens something new or reaches beyond the conversation asks you first. No configuration file has to be edited by hand. A setup is for one conversation, one agent, or all agents ([setup.md](docs/references/setup.md)) |
| Teams | An agent hands work to another agent, runs sub-agents in parallel, or shares a board of tasks so that no two do the same thing. `/swarm` has an agent lead a job on a board until the result is checked, and `/goal` keeps one working until a judge says the goal is met ([boards.md](docs/references/boards.md)) |
| Coding | A folder or a git worktree per conversation, diffs, an editor, a terminal, commands in the background, plan mode, and `/undo`, which takes back your last message with the files it changed ([coding.md](docs/references/coding.md)) |
| Web and apps | Web search, a browser of pine's own, or your Chrome, Brave or Edge with pine's extension. Agents can also operate desktop apps on macOS, Windows and Linux with X11 ([mcp.md](docs/references/mcp.md), [computer.md](docs/references/computer.md)) |
| A manual agents search | Agents look up how pine works with a `manual` tool (BM25 over the docs), so the docs stay out of their context. The Pine app shows the same manual in its Manual tab |
| Your own additions | MCP servers, skills, pi extensions, views (a script that draws all of pine in the app's panel), VS Code color themes, and an HTTP control API for scripts ([api.md](docs/references/api.md)) |

## Where you talk to it

| | |
| --- | --- |
| [The Pine app](docs/references/desktop.md) | Conversations in tabs and windows, with an editor, a terminal, the agent's browser and a view of every agent at work beside them. Settings for agents, models, MCP servers, skills, extensions and events. Dictation. On a Mac it updates itself |
| [The terminal UI](docs/references/tui.md) | `pine`: tabs, mouse, a code pane, dictation, and pictures and video inline in Kitty-protocol terminals such as Ghostty, with fallbacks for others. `pine .` opens a conversation in the current folder |
| [The phone app](docs/references/mobile.md) | Android and iPhone. It shows the pine of another machine, over SSH or paired with the Pine app by QR code, and runs no pine itself. Each release has the APK; the IPA is built by hand for now and sideloaded |
| [The web client](docs/references/web.md) | The same page in any browser, with nothing installed, at <https://pine-main.drcmda.workers.dev>. Over SSH to your pine, or paired with the Pine app by QR code |
| Telegram | A bot you pair with pine carries your messages, the agents' answers and their approval requests |
| Another machine | `pine --ssh <host>` in a terminal, or Settings > Environments in the app, uses the pine of a server |

`pine start` runs the daemon alone, so agents keep reacting with no window open; the Pine app can
keep it running after it quits. `pine check` validates the setup and prints security notes, and
`pine update` fetches a newer version. Every command is in
[commands.md](docs/references/commands.md).

## Safety

An agent that reads the web or your mail reads text that strangers wrote. pine decides what
content may do by where it came from: your own messages get the agent's full tools, everything
else is data, and once a conversation has read outside content, sending anything out asks you
first. No model judges a tool call.

Each agent has a mode:

| Mode | Sandbox | Asks you |
| --- | --- | --- |
| `auto` (the main agent's default) | None: your whole account | Before critical actions (`sudo`, a force push) |
| `safe` (the default for other agents) | The agent's own folders | Before a call reaches further |
| `manual` | As `safe` | Before every action that changes or sends something |
| `bypass` | None | Never |
| `plan` | As the mode before | Never: whatever does more than look is refused |

The sandbox is the system's own on macOS (`sandbox-exec`) and Linux (bubblewrap). Windows has
none: the Pine app runs pine in WSL for the Linux sandbox, and pine on Windows itself works in
`auto` and `bypass`. In a Docker container the container is the wall, unless you start it with
the rights a sandbox needs ([operations.md](docs/references/operations.md), "In a container").
[security.md](docs/references/security.md) has the layers and a section on what is not solved.

## Documentation

The manual's index is [docs/SKILL.md](docs/SKILL.md).

| Part | Chapters |
| --- | --- |
| Start here | [How pine works](docs/references/overview.md), [Install and run](docs/references/operations.md) |
| Where you talk to pine | [The Pine app](docs/references/desktop.md), [Views for the Pine app](docs/references/views.md), [The terminal UI](docs/references/tui.md), [The phone app](docs/references/mobile.md), [The web client](docs/references/web.md) |
| Agents | [Agents](docs/references/agents.md), [Extensions](docs/references/extensions.md), [Teams of agents: boards and swarms](docs/references/boards.md), [Working on code](docs/references/coding.md), [MCP servers, web search and the browser](docs/references/mcp.md), [Operating apps on the computer](docs/references/computer.md) |
| Reacting to the world | [Event sources and subscriptions](docs/references/sources.md), [Source types](docs/references/source-types.md), [Schedules and routes](docs/references/events.md), [Recipe: a page as an agent's control panel](docs/references/interfaces.md) |
| Setting pine up | [Setup by asking an agent](docs/references/setup.md), [Configuration files](docs/references/configuration.md), [Security and its limits](docs/references/security.md) |
| Reference | [Commands](docs/references/commands.md), [Control API](docs/references/api.md), [Technology](docs/references/stack.md) |
| Working on pine itself | [AGENTS.md](AGENTS.md), [docs/dev](docs/dev/README.md) |

## Code signing policy

The Pine app for Windows is signed. Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

- Committers and reviewers: [drcmda](https://github.com/drcmda), [abernier](https://github.com/abernier)
- Approvers: [drcmda](https://github.com/drcmda)

Only what the release workflow ([release.yml](.github/workflows/release.yml)) builds from this
repository's source is signed, and every release is approved by hand. How it is set up:
[desktop/signpath/](desktop/signpath/README.md).

### Privacy

pine will not transfer any information to other networked systems unless specifically requested
by the user or the person installing or operating it. The model servers, web addresses, sources
and MCP servers it talks to are the ones its owner sets up. One exception, in the Pine app: at its
start it asks GitHub (`api.github.com`) for pine's latest release, and on a Mac downloads a newer
app from there. That request carries nothing about your computer or your pine, and Settings >
General turns it off.

## License

[MIT](LICENSE)
