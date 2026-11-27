# Install and run

Every command is in [commands.md](commands.md), the HTTP API in [api.md](api.md).

## Requirements

- macOS, Linux or Windows, with Node 24 or newer.
- A model with tool calls: a hosted provider (`pine login`) or your own server with an
  OpenAI-compatible chat API (`pine model add`).
- For `safe` and `manual` mode, a sandbox: `sandbox-exec` on macOS, bubblewrap on Linux (`pine init`
  installs it), none on Windows. Without one, agents whose mode you did not choose work in `auto`,
  an agent set to `safe` has no shell, and `pine check` says so ([security.md](security.md), "Modes:
  how much an agent does without asking").
- Optional for the terminal UI: `xclip` (or `wl-copy` and `wl-paste` on Wayland) for copy and paste
  on Linux, `ffmpeg` and a sound player for video and sound ([stack.md](stack.md)).

## Install

```bash
npm install -g @pmndre/pine
```

Or install the Pine app for macOS, Linux or Windows, which carries pine and its Node and can add
`pine` to your shell ([desktop.md](desktop.md), "Getting it"). To work on pine itself:
[docs/dev/operations.md](../dev/operations.md).

### On Windows

The Pine app ([desktop.md](desktop.md)) sets up either way:

- pine in WSL, for `safe` mode with the Linux sandbox. Install WSL once (`wsl --install` as
  administrator, then restart) and add a distribution under Settings > Environments. For the
  sandbox, run once: `wsl --distribution Ubuntu --exec ~/.local/share/pine-app/bin/pine init`.
  Windows folders are under `/mnt/c`.
- pine on Windows itself needs [Git for Windows](https://git-scm.com/download/win), whose bash is
  the agents' shell. There is no sandbox: agents work in `auto` or `bypass` mode with your rights,
  without the code pane, worktrees, undo or serial ports.

## First start

```bash
pine init
```

This copies the example home to `~/.pine` (or the folder you name): the main agent `main` with web
search, the browser and app control, an empty `models.json` and `.env`. It overwrites nothing, so
run it again after an update for new example files. On Linux it installs bubblewrap (apt, dnf, yum,
pacman, zypper or apk), the AppArmor rule Ubuntu 24.04 and later need, and the browser's libraries
(apt only), with `sudo` after one question (`--yes` skips it); where it cannot, it says what would.
It also downloads Chromium for the browser tools (about 600 MB, once); if that fails, run it again.

```bash
pine
```

This opens the terminal UI ([tui.md](tui.md)) with a daemon that stops when you quit. For a daemon
that keeps running, run `pine check`, then `pine start` (Ctrl-C stops it). `pine` in another
terminal attaches to it, `pine send main "Say hello."` gives it a task, `pine list` shows every
daemon on this computer and `pine killall` stops them.

## Choosing a model

A new home has no model. Sign in to a provider:

```bash
pine login opencode-go
```

```bash
pine login anthropic
```

```bash
pine login openai-codex
```

The first asks for an API key; the other two open a browser sign-in for a Claude or ChatGPT
subscription. Credentials go to `~/.pine/auth.json` (mode 600). `pine login <unknown>` lists every
provider. Gemini is `google` with an API key from Google AI Studio; there is no sign-in with a
Gemini subscription (Gemini CLI, Antigravity).

After you sign in to a subscription or add a server, agents use the first model you connect as the
default. If the model in force cannot
answer, pine takes the provider's usual one, at once when the daemon runs (`pine login` says which). To choose, set `defaults.model` in `pine.json` (`"opencode-go/deepseek-v4.1-flash"`) or use
`/model`.

### With a model server of your own

For llama.cpp, vLLM, LM Studio, Ollama or anything with OpenAI's chat API:

```bash
pine model add studio http://127.0.0.1:8080
```

pine asks the server for its models, their context and whether they read pictures, and writes them
into `models.json`. A key the server wants goes into `.env`. `--context <tokens>` sets the context
where the server does not report it (llama.cpp does). `--reasoning` and `--no-reasoning` override
what it says about thinking; on llama.cpp pine also maps thinking levels
([configuration.md](configuration.md), "Thinking levels"). `pine model list` shows the servers, and
`pine model remove <name>` removes one with its key unless an agent uses it. The main agent does
both when asked ([setup.md](setup.md), "Adding a model server").

For llama.cpp, start the server with tool calls on:

```bash
llama-server -m /path/to/model.gguf --jinja -c 65536 -np 2 --port 8080
```

- `-np` (slots) should equal the runs pine sends that model at once: its `limits.models` entry
  (Settings > Models), else `limits.maxConcurrentRuns` (8). Each slot gets `c / np` tokens.
- `--alias <name>` gives the model a plain name.
- `--slot-save-path <folder>` lets pine keep conversations that leave their slot
  ([agents.md](agents.md), "What the model server keeps").

## Running at login

macOS: the LaunchAgent [examples/launchd/com.pine.daemon.plist](../../examples/launchd/com.pine.daemon.plist),
logs in `~/.pine/data/pine.log`. Linux: the systemd user service
[examples/systemd/pine.service](../../examples/systemd/pine.service), logs with
`journalctl --user -u pine`. The steps are at the top of each file. Both run as you; a user of its
own keeps agents further from your files.

## In a container

```bash
docker run -it -v pine:/root/.pine node:24 bash
```

Inside, run `npm install -g @pmndre/pine` and `pine init`; the volume keeps pine's home. Without the
rights for a sandbox, the container is the wall:

| In a container | Without the rights for a sandbox | With them |
|---|---|---|
| An agent whose mode you did not choose | `auto`, with the container's files and network | Main agent `auto`, the others `safe` |
| An agent set to `safe` | File tools, no shell | Works in its sandbox |
| A run an outside event started | No shell | Sandboxed |
| A `command` source | Not run | Sandboxed |

The rights for a sandbox remove most of Docker's own protection:

```bash
docker run -it --cap-add SYS_ADMIN --cap-add NET_ADMIN --security-opt seccomp=unconfined --security-opt apparmor=unconfined -v pine:/root/.pine node:24 bash
```

`pine init` then names any missing flag ([security.md](security.md), "On Linux").

## Updating

`pine update` brings pine up to date, fetches what the new version needs (the browser only when its
version changed), and lists what changed.
`pine update --check` only looks. It depends on how pine was installed (`pine version` says):

| Installed | `pine update` |
|---|---|
| with `npm install -g` | Installs the newest version |
| as a checkout | `git pull --ff-only` and `npm install`, unless your commits or changes are in the way |
| as a project dependency | Says what to run there |
| with the Pine app | Says whether there is a newer version; the app updates itself ([desktop.md](desktop.md), "A newer version") |

A running pine keeps the old version until you restart it (as a LaunchAgent:
`launchctl kickstart -k gui/$(id -u)/com.pine.daemon`). Your home is not touched.

### Trying a version before it is released

Previews are on npm under the tag `next` (`0.40.0-next.3`).

| | |
|---|---|
| `npm install -g @pmndre/pine@next` | Install the newest preview |
| `npm install -g @pmndre/pine` | Back to the last release |
| `pine update --next` | Follow previews (or a newer release) |
| `pine update --release` | Follow releases again; a preview stays until the next release |

A pine installed from `@next` follows previews by itself (`pine version` says "follows previews"). A checkout follows its branch; the Pine
app has releases only.

## Day to day

- `pine events -f` (or `--topic "agent/#"`) shows what happens; tool calls are on `agent/<id>/tool`.
- `pine task <id>` shows a task's prompt, tool calls and result. The full transcript is the newest
  `.jsonl` in `~/.pine/agents/<id>/sessions/<session>/`.
- `pine status`, then `pine cancel <id>`, for a stuck task.
- Ask an agent to change sources, MCP servers, schedules, agents or instructions
  ([setup.md](setup.md)). After editing `pine.json` or `agent.json` by hand, run `pine check` and
  restart; queued tasks survive.
- Back up the home: `data/pine.db` (events, tasks) and `agents/*/sessions` (conversations).

## Coming from OpenClaw

| OpenClaw | pine |
|---|---|
| Agents in `openclaw.json` with `workspace-*` folders | A folder per agent under `agents/`, `workspace` pointing at the repository |
| Telegram `bindings` | A `telegram` source the agent sets up and subscribes to |
| `SOUL.md`, `AGENTS.md`, `TOOLS.md`, `MEMORY.md` | The same, in the agent's workspace; `USER.md` and shared `AGENTS.md`, `TOOLS.md` in pine's home |
| `IDENTITY.md`, `HEARTBEAT.md`, daily memory files | Not read; fold them into `SOUL.md`, `AGENTS.md` or `MEMORY.md` |
| Cron jobs, heartbeat | A schedule, or an event source that wakes the agent when something happens (polling with `http` or `command` costs no model turn) |
| `/hooks/*` mappings | A `webhook` source, or `http.hooks` plus a route |
| Extensions that message Telegram, skills | An event source plus the `send` tool; skills in the same format |

## Problems

| Symptom | Fix |
|---|---|
| `pine.json not found` | Wrong home: pass `--home` or set `PINE_HOME`. |
| `no daemon answers on http://127.0.0.1:7463` | The daemon is not running, or `http.port` differs. A UI saying "reconnecting…" reconnects once it runs. |
| `No model yet`, or `model "x/y" is not defined in models.json` | Connect a model (`pine login`, `pine model add`, Settings > Models), or fix `defaults.model` or the agent's `model`. |
| A task fails with 401, "API key" or a connection error | Run `pine login <provider>` again, or check the server with `curl <baseUrl>/models`. |
| An agent's model "cannot answer" because the `claude` command is missing | Its model is `dev/…`, which runs `claude -p`. Install Claude Code or pick another model. |
| A model of your own server is missing from `/model` | Have the main agent add it (`add_model`, [setup.md](setup.md), "Setting up a model"), or check "Model notes" in `pine check` for a missing key. |
| `pine model add` says "no model server answers" | Nothing listens there, or a firewall or VPN is in the way. |
| A task fails after minutes with a timeout | Raise `limits.modelStreamIdleMs` or `limits.modelHeadersTimeoutMs` for a slow model. |
| An answer starts late: the model reads the whole conversation again after you switch tab, or the first answer in a new conversation takes long | On llama.cpp, give the server enough slots (`-np`), `--slot-save-path` and `limits.warmSlots` ([agents.md](agents.md), "What the model server keeps"). After `idleMs` a session closes, and its MCP servers start again. |
| The browser tools fail with "Executable doesn't exist", or the app says the browser for the web tools is not on this computer | Run `pine browser-install` (`pine check` says so), or fetch it in the Pine app under Settings > General. |
| The browser cannot open `localhost`, or a page cannot open a WebSocket: `Establishing a tunnel via proxy server failed` | A local address needs your yes, for one host and port: serve from one port, or have the agent open the other with `browser_navigate` ([mcp.md](mcp.md), "Local addresses"). A server the agent started also needs network access for its shell. |
| The agent has no tools to click or type in apps, or says macOS does not let it | App control needs `auto` or `bypass` mode, your own conversation, and macOS, Windows or Linux with X11 (`pine check` says why under `apps`). On macOS, switch on the app pine runs in under Privacy & Security > Accessibility and Screen & System Audio Recording ([computer.md](computer.md)). |
| The agent keeps asking for approval, or asks before `sudo` or a force push | `manual` mode (`pine mode <agent> auto`), the `approve` list, or a send after outside content asks ("Always here" covers that tool for the conversation; `pine reset` starts a clean one). Critical actions ask in every mode except `bypass` ([security.md](security.md), "What asks you"). |
| An approval `request_access` comes up although the agent never requested access | pine asks you for the agent when a call needs to read or write a folder outside its sandbox, or the network; the `for:` line names the call. Your yes or no holds for the conversation ([security.md](security.md), "When a call needs something outside: pine asks you"). |
| The agent says a file is "not permitted", or "No such file" for a folder in your home | In `safe` mode an agent reaches its workspace, and `~` is its own home (`sandbox/<id>/`): give full paths, use `pine mode <agent> auto` for your account, or open folders with `sandbox.read` and `sandbox.write`. pine's home is closed in every mode. |
| `kill: Operation not permitted` for a program the agent started | Use the agent's `stop_program`, or `■ stop` in the code pane. |
| `git` complains about identity | The sandboxed shell has an empty home: set `git config` once through the agent. |
| A command needs the network | `sandbox.network: true`, or an MCP `commands` tool. |
| A source reported now and then without waking the agent | The subscription ignores a source for ten seconds after it woke the agent (not Telegram). Subscribe with `throttle: "0s"` (`pine subscribe ... --throttle 0s`). |
| The Telegram bot does not react | Check `pine sources`, pair a new bot with the code it sends, and make sure no other program reads the same token. |
| An event arrives but no task starts | See "When nothing happens" in [events.md](events.md) and [sources.md](sources.md). |
| The agent stops after every step and asks whether to go on | Give it a goal: `/goal <what should be reached>` ([agents.md](agents.md), "Goal mode"). |
| A goal is paused with "gave no verdict" | The judge missed `limits.goalJudgeTimeout` or its format: `/goal resume`, or set `defaults.judge`. |
