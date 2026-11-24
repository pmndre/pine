<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg">
    <img src="docs/images/logo-light.svg" alt="pine" width="360">
  </picture>
</h1>

[pine.pmnd.re](https://pine.pmnd.re)

```bash
npm install -g @pmndre/pine
```

### PINE makes AI reactive

Most harnesses just do input chat: "Do this do that". And maybe a scheduler: "Do it tomorrow". In PINE agents react to any stimuli. From watching folders, commands, websites, ftp endpoints, webhooks, to any other event source. You can hook them up and let them react to and operate your physical devices in the house, or digital assets.

PINE of course also handles regular chat, coding, tasks and orchestration. Agents carry memory and so on. All the basic stuff is in there, too.

### Some design choices

- **Event-driven architecture:** Agents subscribe to events and react. An event source is just a `*.ts` service with a schema. Tell the agent what you want and they subscribe: "Watch ~/documents/scans, for every new file: extract summaries and payment details, if present"
- **No configs:** Tell the main agent what you want. It configures PINE, creates agents, MCPs, event sources, skills and schedules through administrative tool calls, never touches user config, never messes it up or breaks it.
- **Self-discovery:** A built-in BM25 manual tool lets agents look up any API or internal detail on demand, without carrying docs in context.
- **A CLI that feels like a desktop app:** Tabs, buttons, scroll regions, inline images and video, and drag-and-drop with thumbnails. Works in Kitty-protocol terminals like Ghostty, with fallbacks for older ones.
- **Built in:** Computer use (macOS), web browsing, coding tools, diffs and git, undo, plan mode, goals (`/goal` keeps an agent working until it is done) and swarms (`/swarm` has an agent lead a job that its sub-agents work through on a board, with the result checked).
- **Orchestration:** Agents can delegate, create sub-agents in parallel, and share a board of tasks so that no two do the same thing. A pinned tab simply persists an agent and its task. Name it, give it instructions, chat with it or subscribe it to events.

> [!IMPORTANT]
> pine runs on macOS, Linux and Windows; `pine init` sets up what it needs. Its sandbox is the system's own on macOS and Linux. On Windows the Pine app runs pine in WSL, where it has the Linux sandbox; pine on Windows itself works in `auto` and `bypass` mode ([operations.md](docs/references/operations.md), "On Windows").

```
          you:  terminal UI · Pine app · Telegram
                               │
                               ▼
 wake it                 ┌───────────┐            it uses
 events ───────────────► │           │ ◄───────── MCP servers
   Telegram · MQTT · FTP │           │ ◄───────── skills
   webhooks · folders    │   agent   │
   web addresses         │           │
   commands · etc *      │           │
 schedules ────────────► │           │
   repeating · once      └─────┬─────┘
                               │  delegate ──► other agents
                               │  subagent ──► with distinct prompts, in parallel
                               ▼
                 answers · messages · actions

 Events, schedules, MCPs and skills can be set up by asking:
 for the current conversation, agent scope, or globally
 (main agent only) for all agents.

 * New event types that agents can subscribe to can be created easily.
```

## Quick start

Sets everything up: the browser the web tools drive, and your user folder (`~/.pine`). On Linux
also the sandbox that agents in `safe` mode work in; it shows what it would install and asks once.

```bash
pine init
```

Checks the setup: validates the configuration, lists each agent with its model, tools and MCP
servers, and prints security notes if something is open that should not be.

```bash
pine check
```

Opens the terminal UI. If no daemon is running, it starts one inside and stops it when you quit.

```bash
pine
```

Runs the daemon as a service, without the UI, so agents keep reacting to events with no terminal
open. `pine` then attaches to it. To have it start at login, see
[operations.md](docs/references/operations.md).

```bash
pine start
```

Connect your subscriptions, or local llm servers. Switch with `/model` in the UI:

```bash
pine login opencode-go
```

`pine login anthropic` and `pine login openai-codex` use a Claude or ChatGPT subscription. A
model server of your own (llama.cpp, vLLM, LM Studio) is added by its address, with
`pine model add studio http://127.0.0.1:8080`, or by asking the main agent. See
[operations.md](docs/references/operations.md) and [tui.md](docs/references/tui.md).

To work on a project, start it in that folder. The agent gets that folder for the
conversation, and `▤ code` (or `ctrl+g`) opens a pane with git changes and diffs, the files and
the output of its tool calls. `/undo` takes your last message back, with the files it changed
([coding.md](docs/references/coding.md)):

```bash
pine .
```

There is also a desktop app for macOS, with the same conversations in a window, an editor for
a conversation's folder and a settings panel for agents, models, MCP servers, skills and
events. It starts pine itself, or uses the one that runs ([desktop.md](docs/references/desktop.md)).
Each [release](https://github.com/pmndre/pine/releases/latest) has it as a disk image, for
Apple silicon and for Intel. It carries pine and the Node it runs on, so nothing else has to
be installed, and it gives your shell the `pine` command. From a checkout:

```bash
npm run desktop
```

On an Android phone or an iPhone, the Pine app shows the pine of another machine, over SSH (your
Mac, a server) or paired with the Pine app by QR code: the same page, with its own SSH key and no
pine on the phone. Each release
has it as an APK; the IPA to sideload with your own Apple ID is built by hand for now
([mobile.md](docs/references/mobile.md)).

From a web browser on any computer, with nothing installed, the web client shows the same page:
over SSH to your own pine, or paired with the Pine app by QR code
([web.md](docs/references/web.md)).

To get a newer version later, with whatever it needs:

```bash
pine update
```

## Docker

A container needs nothing special. It is the wall around pine, and the agents work inside it
without a sandbox of their own:

```bash
docker run -it -v pine:/root/.pine node:24 bash
```

`-v pine:/root/.pine` keeps pine's home (configuration, conversations) when the container is
replaced. Inside, it is the same as anywhere:

```bash
npm install -g @pmndre/pine
```

```bash
pine init
```

Every agent whose mode you did not choose then works in `auto` mode, and `pine check` says so.
The agents and pine's own secrets are in the same container; what keeps the two apart there is
described under "pine's own files without a sandbox" in
[docs/references/security.md](docs/references/security.md).

`safe` mode puts an agent into a sandbox of its own, as on a Mac. A container may only make
one when it is started with the rights for it, which take away most of what Docker itself
protects:

```bash
docker run -it --cap-add SYS_ADMIN --cap-add NET_ADMIN --security-opt seccomp=unconfined --security-opt apparmor=unconfined -v pine:/root/.pine node:24 bash
```

| Part | What it is for |
| --- | --- |
| `--cap-add SYS_ADMIN` | lets the sandbox create its namespaces |
| `--cap-add NET_ADMIN` | lets a sandbox without network have its own loopback interface |
| `--security-opt seccomp=unconfined` | Docker's system call filter forbids the sandbox's change of root |
| `--security-opt apparmor=unconfined` | Docker's AppArmor profile forbids its mounts |

`pine init` installs what the image lacks (bubblewrap, the browser's system libraries) and says
so if a right is missing. With pine as an ordinary user in the container instead of root, add
`--security-opt systempaths=unconfined`. `--privileged` works in place of all of them.

## Code signing policy

The Pine app for Windows is signed. Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

- Committers and reviewers: [drcmda](https://github.com/drcmda), [abernier](https://github.com/abernier)
- Approvers: [drcmda](https://github.com/drcmda)

Only what is built from this repository's source by its release workflow ([release.yml](.github/workflows/release.yml)) is signed, and every release is approved by hand. How it is set up: [desktop/signpath/](desktop/signpath/README.md).

### Privacy

pine will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it: the model servers, web addresses, sources and MCP servers it talks to are the ones its owner sets up. One exception, in the Pine app: when it starts, it asks GitHub (`api.github.com`) for the number of pine's latest release, to say when a newer app is out. That question carries nothing about your computer or your pine.

## Documentation

Start at [docs/SKILL.md](docs/SKILL.md); it indexes everything.

| To do this                                                                              | Read                                                         |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Understand how the pieces fit                                                           | [overview.md](docs/references/overview.md)                   |
| Use the terminal UI                                                                     | [tui.md](docs/references/tui.md)                             |
| Use the desktop app (macOS, Linux, Windows): conversations, an editor, and a settings panel in one window; browser access for a phone paired by QR code or found on the same network, with a relay server (TURN) of your own where mobile data cannot connect directly | [desktop.md](docs/references/desktop.md)                     |
| Write a view: a script of your own that draws all of pine in the Pine app's panel, what it is told and what it cannot do | [views.md](docs/references/views.md) |
| Use pine from an Android phone or an iPhone, over SSH or paired with the Pine app by QR code or on the same network | [mobile.md](docs/references/mobile.md)                       |
| Use your pine from a web browser on any computer, over SSH or paired with the Pine app by QR code, with nothing installed | [web.md](docs/references/web.md)                             |
| Work on a project: `pine .`, the code pane with git changes, files and tool output, `/undo` | [coding.md](docs/references/coding.md)                       |
| Let an agent make a web page you click in, as its user interface, and be woken by what you press | [interfaces.md](docs/references/interfaces.md)               |
| Install, run, use the CLI, run it as a service                                          | [operations.md](docs/references/operations.md)               |
| Write `pine.json` and `agent.json`                                                      | [configuration.md](docs/references/configuration.md)         |
| Let agents set things up by tool call instead of editing files                          | [setup.md](docs/references/setup.md)                         |
| Set up agents, delegation and sub-agents; how tools are declared and what stays cached   | [agents.md](docs/references/agents.md)                       |
| Let sub-agents and agents work through shared tasks on a board, run a pool of sub-agents, and lead a job as a swarm (`/swarm`) | [boards.md](docs/references/boards.md)                       |
| Route events, schedules, model calls                                                    | [events.md](docs/references/events.md)                       |
| Event sources: setting one up, subscribing, sending, secrets, trust                     | [sources.md](docs/references/sources.md)                     |
| Every source type: Telegram, folders, MQTT, web addresses, feeds, mail, Slack, cameras  | [source-types.md](docs/references/source-types.md)           |
| MCP servers, web search, command tools                                                  | [mcp.md](docs/references/mcp.md)                             |
| Let an agent operate the apps on your Mac                                               | [computer.md](docs/references/computer.md)                   |
| Know what is protected and what is not                                                  | [security.md](docs/references/security.md)                   |
| Work on pine itself                                                                     | [AGENTS.md](AGENTS.md), [stack.md](docs/references/stack.md) |
