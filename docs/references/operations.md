# Install and run

## Requirements

- macOS, Linux or Windows, with Node 24 or newer.
- A model that supports tool calls: a hosted provider (sign in with `pine login`), or a model
  server of your own with an OpenAI-compatible chat API (`pine model add`).
- For `safe` and `manual` mode, a sandbox: `sandbox-exec` on macOS, bubblewrap on Linux (`pine init`
  installs it). Without one pine still runs: agents whose mode you did not choose work in `auto`,
  an agent you set to `safe` has no shell, and `pine check` says so. Windows has no sandbox of
  pine's (see "On Windows"). Modes: [security.md](security.md), "Modes: how much an agent does
  without asking".
- Optional, for the terminal UI: `ffmpeg` for videos (on Linux also for pictures other than png
  and for sound, or `mpv`, `pw-play`, `paplay`, `aplay`); on Linux `xclip`, or `wl-copy` and
  `wl-paste` on Wayland, for copy and paste.

## Install

```bash
npm install -g @pmndre/pine
```

That puts `pine` on your PATH. Or install the Pine app for macOS, Linux or Windows: it carries
pine and its Node, needs no npm, and can give your shell the `pine` command ([desktop.md](desktop.md),
"Getting it").

To work on pine itself, use a checkout: see [docs/dev/operations.md](../dev/operations.md).

### On Windows

Two ways; the Pine app ([desktop.md](desktop.md)) does either:

- **pine in WSL**, the way to `safe` mode: a Linux on the same computer, with the Linux sandbox.
  Install WSL once (`wsl --install` in a terminal as administrator, then restart). In the Pine
  app, Settings > Environments lists the distributions; add one, and the app brings its pine
  there and makes a home. For the sandbox run once, in a terminal:
  `wsl --distribution Ubuntu --exec ~/.local/share/pine-app/bin/pine init` (it asks for your
  password there). Windows folders are under `/mnt/c`.
- **pine on Windows itself**, with npm or the Pine app. It needs
  [Git for Windows](https://git-scm.com/download/win), whose bash is the agents' shell. There is
  no sandbox: agents work in `auto` or `bypass` mode with your rights, and the code pane,
  worktrees and undo are not there. A serial port cannot be read.

## First start

```bash
pine init
```

- Copies the example home to `~/.pine` (or the folder you name): the main agent `main` with web
  search, the browser and app control ([computer.md](computer.md)), an empty `models.json` and
  `.env`. It overwrites nothing, so run it again after an update to get new example files.
- On Linux it sets up the sandbox: installs bubblewrap (apt, dnf, yum, pacman, zypper or apk),
  loads the AppArmor rule Ubuntu 24.04 and later need, and installs the browser's system
  libraries (apt only). It shows the commands and asks once; they run with `sudo`. `--yes` skips
  the question. Where it cannot (no `sudo`, a container without the rights) it says what would.
- Downloads the Chromium build the browser tools drive (about 600 MB, once). If that fails,
  everything else is set up; run `pine init` again.

```bash
pine
```

opens the terminal UI ([tui.md](tui.md)) and starts a daemon inside it. For a daemon that keeps
running without a terminal:

```bash
pine check
```

```bash
pine start
```

Then `pine` in another terminal attaches to it, or `pine send main "Say hello."` gives it a task.

### Choosing a model

A new home has no model: until you connect one, every agent says so. Sign in to a provider:

```bash
pine login opencode-go
```

```bash
pine login anthropic
```

```bash
pine login openai-codex
```

The first asks for an API key (typed without echo); the other two open a browser sign-in for a
Claude or ChatGPT subscription. Credentials go to `~/.pine/auth.json` (mode 600).
`pine login <unknown>` lists every provider. Gemini is `google`, with an API key from Google AI
Studio; there is no sign-in with a Gemini subscription (Gemini CLI, Antigravity).

The first model you connect becomes the default. Where the model in force cannot answer, pine
takes the provider's usual one: at once when the daemon runs (`pine login` says which), else at
the next start. To choose: `defaults.model` in `pine.json` (`"opencode-go/deepseek-v4.1-flash"`),
or `/model` in the UI.

### With a model server of your own

llama.cpp, vLLM, LM Studio, Ollama and anything else with OpenAI's chat API, on this machine or
another:

```bash
pine model add studio http://127.0.0.1:8080
```

pine asks the server for its models, their context and whether they read pictures, and writes
them into `models.json` ([configuration.md](configuration.md), "models.json"). A server that wants
a key: pine asks for it without echo and keeps it in `.env`. A running pine has the models at
once: `/model studio/<model>`.

| Option | |
|---|---|
| `--context <tokens>` | The context, where the server does not say it (llama.cpp does) |
| `--reasoning`, `--no-reasoning` | Overrides what the server says about a thinking model. On llama.cpp pine also maps each thinking level to one the model knows ([configuration.md](configuration.md), "Thinking levels") |

`pine model list` shows the servers; `pine model remove <name>` takes one out with its key, unless
an agent uses it. The main agent does the same when asked ([setup.md](setup.md), "Adding a model
server").

For llama.cpp, start the server with tool calls on:

```bash
llama-server -m /path/to/model.gguf --jinja -c 65536 -np 2 --port 8080
```

- `-np` (slots) should equal how many runs pine sends that model at once: its number in
  `limits.models` (Settings > Models), else `limits.maxConcurrentRuns` (8). With `-np 2`, set 2.
- The context is shared between slots: each run gets `c / np` tokens, which is what pine writes
  down.
- `--alias <name>` gives the model a plain name instead of the file's path.
- `--slot-save-path <folder>` lets pine keep conversations that leave their slot
  ([agents.md](agents.md), "What the model server keeps").

## In a container

```bash
docker run -it -v pine:/root/.pine node:24 bash
```

Inside, `npm install -g @pmndre/pine` and `pine init`. The volume keeps pine's home when the
container is replaced. Such a container cannot make a sandbox; the container is the wall instead:

| In a container | Without the rights for a sandbox | With them |
|---|---|---|
| An agent whose mode you did not choose | `auto`: no sandbox, the container's files and network | The main agent `auto`, the others `safe` |
| An agent you set to `safe` | No shell; its file tools work | Works in its sandbox |
| A run an event from outside started | No shell | Works in the sandbox |
| A `command` source | Not run | Runs in the sandbox |

For `safe` mode, start the container with the rights for a sandbox (they take away most of what
Docker itself protects):

```bash
docker run -it --cap-add SYS_ADMIN --cap-add NET_ADMIN --security-opt seccomp=unconfined --security-opt apparmor=unconfined -v pine:/root/.pine node:24 bash
```

`pine init` then installs bubblewrap and the browser's libraries, and names any flag that is
missing. What each flag is for: [security.md](security.md), "On Linux".

## Updating

```bash
pine update
```

brings pine up to date and fetches what the new version needs (the browser only when its version
changed). `pine update --check` only says whether there is something newer. How it updates
depends on how pine was installed, which `pine version` says:

| Installed | `pine update` |
|---|---|
| with `npm install -g` | Installs the newest version with npm |
| as a checkout | `git pull --ff-only`, then `npm install`. Changes nothing if commits or changes of yours are in the way |
| as a dependency in a project | Says what to run there; the project decides the version |
| with the Pine app | Says whether there is a newer version. The app updates itself, and its pine with it ([desktop.md](desktop.md), "A newer version") |

Afterwards it lists what changed, version by version. A running pine keeps the old version until
it is restarted: quit and reopen the terminal UI, or restart the daemon (as a LaunchAgent:
`launchctl kickstart -k gui/$(id -u)/com.pine.daemon`). Your home is not touched; run `pine init`
to get example files that are new.

### Trying a version before it is released

Previews of the next release are published to npm under the tag `next`, as versions like
`0.40.0-next.3` (the third preview of 0.40.0).

| | |
|---|---|
| `npm install -g @pmndre/pine@next` | Install the newest preview |
| `npm install -g @pmndre/pine` | Back to the last release |
| `pine update --next` | Follow previews from now on: installs the newest preview, or the release when that is newer |
| `pine update --release` | Follow releases again. An installed preview stays until the next release |

The choice is kept in `data/update-channel`; a pine installed from `@next` follows previews by
itself. `pine version` says "follows previews". A checkout follows its branch instead, and the
Pine app has releases only.

## Running at login

- macOS: [examples/launchd/com.pine.daemon.plist](../../examples/launchd/com.pine.daemon.plist), a
  LaunchAgent; follow the steps at its top. Logs go to `~/.pine/data/pine.log`.
- Linux: [examples/systemd/pine.service](../../examples/systemd/pine.service), a systemd user
  service; follow the steps at its top. Logs: `journalctl --user -u pine`.

Both run as you. To keep agents further from your files, run pine as a user of its own.

## Day to day

- **What is happening:** `pine events -f`; `--topic "agent/#"` for agents only. Tool calls show
  live on `agent/<id>/tool`.
- **Why did it answer that?** `pine task <id>`: the prompt as received, the tool calls, the
  result. The full transcript is the newest `.jsonl` in `~/.pine/agents/<id>/sessions/<session>/`.
- **Instructions:** tell the agent ("from now on ...") and it writes its `AGENTS.md`; for all
  agents, tell the main agent ([agents.md](agents.md), "What holds for all agents").
- **Configuration:** sources, MCP servers, schedules, subscriptions and agents need no file edit:
  ask an agent ([setup.md](setup.md)). After editing `pine.json` or an `agent.json` by hand, run
  `pine check` and restart; queued tasks survive.
- **Stuck:** `pine status`, then `pine cancel <id>`.
- **Back up** the home: `data/pine.db` holds events and tasks, `agents/*/sessions` the
  conversations. Workspaces are wherever you put them.

## Problems

General problems. For routes and schedules see [events.md](events.md), "When nothing happens";
for sources, [sources.md](sources.md), "When nothing happens".

| Symptom | Cause and fix |
|---|---|
| `pine.json not found` | Wrong home. Pass `--home` or set `PINE_HOME`. |
| `No model yet` on the first message | Connect a model: `pine login <provider>`, Settings > Models in the Pine app, or `pine model add`. The first becomes the default. |
| `model "x/y" is not defined in models.json` | `defaults.model` or an agent's `model` is not a known `provider/id`. `/model` lists what there is. |
| A task fails with 401 or "API key" | The credential is missing or expired: `pine login <provider>` again. |
| An agent's model "cannot answer" because the `claude` command is missing | Its model is `dev/…`, which runs through `claude -p`. Install Claude Code or choose another model. |
| A model of your own server is missing from `/model` | The server loaded it after it was added to pine: have the main agent add it (`add_model`, [setup.md](setup.md), "Setting up a model"). Or `models.json` names a key that is not in `.env`: `pine check` lists it under "Model notes". |
| `pine model add` says "no model server answers" | Nothing listens there, or it is not reachable (firewall, VPN). `curl <address>/v1/models` shows what the server says. |
| A task fails with a connection error | The model server is down or `baseUrl` is wrong: `curl <baseUrl>/models`. |
| A task fails after minutes with a timeout | The model stopped streaming (`limits.modelStreamIdleMs`) or was slow to start (`limits.modelHeadersTimeoutMs`); raise them for a slow model. |
| An answer starts late: the model reads the whole conversation again after you switched tab or conversation, or after a restart | The model server kept nothing of it. On llama.cpp give the server enough slots (`-np`) and `--slot-save-path` (`limits.slotPages`); a scheduler that stops the model must save the slots. See [agents.md](agents.md), "What the model server keeps". |
| The first answer in a new conversation takes long; the tools take many tokens of the prompt | The model reads every tool's declaration first. pine declares them grouped in families, which keeps that short, and `limits.warmSlots` has an idle llama.cpp slot read it ahead of time. See [agents.md](agents.md), "How tools are declared". |
| The first answer after a pause is slow | The session was closed after `idleMs` and is resumed; MCP servers start again. |
| The browser tools fail with "Executable doesn't exist", or the app says the browser is not there | Run `pine browser-install` (or `pine init`). `pine check` says so; the Pine app fetches it from Settings > General. |
| The browser cannot open `localhost`, or a page says "not reachable from the browser" | A local address needs your yes: the agent opens it with `browser_navigate` and you are asked ([mcp.md](mcp.md), "Local addresses"). A server the agent started also needs network access for its shell. |
| A page in the agent's browser cannot open a WebSocket or load from this computer: `Establishing a tunnel via proxy server failed` | A yes is for one host and port: `localhost:8100` does not open `localhost:8101`. Serve everything from one port, or have the agent open the other address once with `browser_navigate` ([mcp.md](mcp.md), [interfaces.md](interfaces.md)). |
| The agent says macOS does not let pine operate apps or take pictures of the screen | System Settings > Privacy & Security > Accessibility (and Screen & System Audio Recording): switch on the app pine runs in. See [computer.md](computer.md). |
| The agent has no tools to click or type in apps | App control needs `auto` or `bypass` mode, your own conversation, and macOS, Windows or Linux with X11. `pine check` says why under `apps`. See [computer.md](computer.md). |
| The agent keeps asking for approval | It is in `manual` mode (`pine mode <agent> auto`, or the mode in the UI's bottom bar), or the tool is on its `approve` list, or the conversation read outside content and wants to send something out: "Always here" covers that tool for the conversation; `pine reset` starts a clean one. See [security.md](security.md), "What asks you". |
| Why am I asked before `sudo` or a force push? | Those are critical actions, asked in every mode but `bypass`. See [security.md](security.md), "What asks you". |
| An approval `request_access` comes up although the agent never requested access | pine requested it for the agent: a file tool or a shell command needed a file or folder outside the agent's sandbox, or the network. The `for:` line names the call. A yes holds for the conversation, and so does a no. See [security.md](security.md), "When a call needs something outside: pine asks you". |
| The agent says a file is "not permitted" | It is outside what the agent reaches. Agents in `safe` mode have their workspace; `pine mode <agent> auto` gives your account. pine's home is closed in every mode. To open a folder for good: `sandbox.read`, `sandbox.write`. |
| "No such file" for a folder in your home that exists (`~/Documents/scans`) | In the sandbox `~` is the agent's own home (`sandbox/<id>/`). pine asks for the folder when the path is written out; otherwise give the agent the full path. |
| `kill: Operation not permitted` for a program the agent started | In the sandbox each command has its own and cannot signal another's programs. The agent's `stop_program`, or `■ stop` under Running in the code pane, works in every mode. |
| `git` complains about identity | In the sandbox the shell has its own empty home: `git config --global user.name ...` once through the agent, or per repository. |
| A command needs the network | `sandbox.network: true` for that agent, or an MCP `commands` tool for that one command. |
| A source reported and the agent was not woken, now and then | The subscription's throttle: after an event that woke the agent, its source is ignored for ten seconds (not for one that talks to the agent, such as Telegram). Subscribe with `throttle: "0s"` (`pine subscribe ... --throttle 0s`) where every event counts. |
| The Telegram bot does not react | `pine sources`: is it running and is a conversation subscribed? A new bot waits to be paired: write to it and type the code it sends into pine's question. Otherwise another program reads the same bot token. |
| An event arrives but no task starts | See [events.md](events.md), "When nothing happens" (routes), and [sources.md](sources.md), "When nothing happens" (subscriptions). |
| The agent stops after every step and asks whether to go on | That is how a turn ends. Give the conversation a goal: type `/goal <what should be reached>` in the terminal UI or the Pine app ([agents.md](agents.md), "Goal mode"). |
| A goal is paused with "gave no verdict" | The judge did not answer in time (`limits.goalJudgeTimeout`) or not with MET, CONTINUE or BLOCKED. `/goal resume`; if it recurs, give the judge a model that keeps to a format (`defaults.judge`). |
| The UI says "reconnecting…" | The daemon stopped. Start it again; the UI picks it up. |
| `no daemon answers on http://127.0.0.1:7463` | The daemon is not running, or `http.port` in this home differs. |

## Coming from OpenClaw

| OpenClaw | pine |
|---|---|
| Agents in `openclaw.json` with `workspace-*` folders | A folder per agent under `agents/`; `workspace` points at the repository |
| Telegram `bindings` | A `telegram` source the agent sets up when asked, and subscribes to |
| `SOUL.md`, `AGENTS.md`, `TOOLS.md`, `MEMORY.md` | The same names in the agent's workspace, read into its prompt and written by the agent |
| `USER.md`; a `TOOLS.md` or `AGENTS.md` copied into every workspace | One `USER.md`, `TOOLS.md` and `AGENTS.md` in pine's home for all agents, kept by the main agent |
| `IDENTITY.md`, `HEARTBEAT.md`, daily memory files | Not read. Fold what matters into `SOUL.md`, `AGENTS.md` or `MEMORY.md` |
| Cron jobs | A schedule: ask the agent ("every morning at seven ..."), or write it under `schedules` with a `task` |
| Heartbeat | Usually not needed: an event source wakes the agent when something happens, and polling (`http`, `command`) costs no model turn. Otherwise a schedule with `every` whose task ends in "reply NO_REPLY if nothing needs attention" |
| `/hooks/*` mappings | A `webhook` source the agent subscribes to, or `http.hooks` plus a route |
| Extensions that watch something and message Telegram themselves | An event source the agent subscribes to, and the `send` tool for what it tells you |
| Skills | Skills, same format |
