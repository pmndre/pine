# Running pine

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

## Commands

Every command takes `--home <dir>` (default `$PINE_HOME` or `~/.pine`).

| Command | What it does |
|---|---|
| `pine`, `pine tui` | The terminal UI; starts a daemon inside if none runs |
| `pine .`, `pine <folder>` | The terminal UI with a tab for a conversation of the main agent in that folder (the one from last time, if any). A word that is a command stays a command. See [coding.md](coding.md) |
| `pine --ssh <host> [folder]` | The terminal UI on another machine's pine, over SSH; the folder is one there. See [tui.md](tui.md#the-pine-of-another-machine) |
| `pine <folder> --worktree [name]` | A new conversation in a worktree of that folder's git repository, on a branch `pine/<name>`. See [coding.md](coding.md#a-worktree-for-a-conversation) |
| `pine login <provider>`, `pine logout <provider>` | Sign in to a model provider, or out. `--api-key` or `--oauth` choose the kind. `pine login typesafe` is for decision models ([configuration.md](configuration.md), "Decision models") |
| `pine model add <name> <address>`, `pine model list`, `pine model remove <name>` | Model servers of your own. `--context <tokens>`, `--reasoning`, `--no-reasoning`. See "With a model server of your own" |
| `pine init [dir] [--yes]` | Set up a home, the browser and, on Linux, the sandbox. Safe to run again |
| `pine update [--check] [--next \| --release]` | Bring pine up to date. See "Updating" |
| `pine version`, `pine --version` | The version and how it is installed |
| `pine help`, `pine --help` | The list of commands |
| `pine browser-install` | Fetch the browser again |
| `pine check` | Validate the configuration; show each agent's workspace, model, tools, MCP servers, mode and reach; list model notes and security notes; say when the browser is missing; with a daemon running, list worktrees, also those no conversation holds |
| `pine start` | Run the daemon in the foreground. Ctrl-C or SIGTERM stops it cleanly |
| `pine service [--keep]` | Find this home's daemon or start one, for a UI that is a program of its own. See "A UI of its own" |
| `pine list [--json] [--home dir]` | The pine daemons running on this computer, of every home: process number, how it was started (`pine start`, the Pine app's `pine service`, a terminal UI with the daemon inside), home, control API address, uptime. Not one in WSL or on another machine |
| `pine killall [--home dir]` | Stop every daemon `pine list` shows (SIGTERM; killed after 12 seconds; at once on Windows) |
| `pine kill <pid>` | Stop one of them, by its number. A number that is not a pine daemon is refused |
| `pine dev-model [--port 7464] [--model haiku]` | A model server backed by `claude -p`, for development |
| `pine status` | Running tasks, live sessions (and whether tainted), model slots |
| `pine agents` | The agents as the daemon has them (JSON) |
| `pine agent list` | The agents, readable: purpose, model, reasoning, mode, reach, and what each has. Needs no daemon |
| `pine agent add <id> [--description "..."] [--instructions "..." \| --instructions-file <file>] [--model provider/model] [--tools read,bash,...]` | Create an agent, as `create_agent` does. `--description` becomes the first paragraph of its instructions |
| `pine agent update <id> [--color #rrggbb\|none] [--scroll top\|follow\|default] [--instructions ... \| --instructions-file <file>] [--soul ... \| --soul-file <file>] [--tooling ... \| --tooling-file <file>] [--model ...\|default] [--thinking ...] [--mode auto\|safe\|manual\|bypass\|plan\|default] [--tools read,bash,...] [--delegates id,id\|*] [--network \| --no-network] [--read /p,/p] [--write /p] [--forget /p]` | Change an agent's settings, as `update_agent` does; give only what changes. Without a daemon the files are changed, except the model, which needs the daemon |
| `pine agent rename <id> <new-id>` | Give an agent another id; everything that names it follows. Not while it works. See [setup.md](setup.md), "Renaming an agent" |
| `pine agent remove <id> [--keep-files] [--yes]` | Remove an agent with everything it has. Lists what goes and asks; `--yes` for a script; `--keep-files` moves its folder to `removed/`. See [setup.md](setup.md), "Changing and removing an agent" |
| `pine send <agent> <text...>` | Give an agent a task as yourself and print the answer. `--session <key>`, `--no-wait` |
| `pine emit <topic> [json]` | Publish an event as yourself |
| `pine events` | The event log. `--topic <pattern>`, `--limit <n>` (30), `-f` to follow |
| `pine tasks` | Recent tasks. `--agent <id>`, `--status pending\|running\|done\|failed\|cancelled`, `--limit <n>` (20) |
| `pine task <id>` | One task in full: prompt, result, error, trust, statistics |
| `pine cancel <id>` | Stop a task |
| `pine state [pattern]` | Shared state |
| `pine sources` | The event sources: running or idle, subscribers, last event, when a polling source last looked |
| `pine subscribe <agent> <source> [--session name \| --fresh] [--note text] [--throttle 5m] [--when json] [--separate]`, `pine unsubscribe <agent> <source> [--session name]` | Wake an agent on a source's events (`--session`: only that conversation; `--fresh`: a new conversation per event), or stop. See [sources.md](sources.md) |
| `pine subscribe --global <source> ...`, `pine unsubscribe --global <source>` | The same for every agent that can use the source |
| `pine approvals`, `pine approve <id> [--always]`, `pine deny <id>` | Answer approval requests; `--always` stops the question for the rest of that conversation |
| `pine reset <agent> [session]` | Start a conversation over; also clears its taint |
| `pine mode <agent> [auto\|safe\|manual\|bypass\|plan]` | Show or change an agent's mode. `auto`, `safe`, `manual` are saved; `bypass` and `plan` hold until pine restarts |
| `pine mcp list [--offline]` | MCP servers, whom they are for, whether they connect |
| `pine mcp add <name> <url>`, `pine mcp add <name> -- <command...>` | Add a remote or local server. `--agent <id>`, `--taints`, `--approve always\|tainted`, `--timeout <seconds>`, `--description <text>`, `--exposure <how>`: see [mcp.md](mcp.md) |
| `pine mcp remove <name> [--agent <id>]` | Remove a server |
| `pine mcp login <name>`, `pine mcp logout <name>` | Sign in to a remote server through the browser, or forget its tokens |
| `pine skills` | Every skill, whom it is for, where it lies |
| `pine schedules` | What is scheduled: for whom, when, the task |
| `pine manual <words>`, `pine manual --read <id>` | Search this manual as agents do, or read parts by id (commas). Without words: the list of parts |

From `pine status` to `pine mode` the commands talk to the running daemon (control API on
`127.0.0.1:7463`, token in `data/http-token`); `pine agent` uses a daemon when one runs and the
files when not. `pine mcp` and `pine model` change the files and tell a running daemon.
`pine check`, `pine skills`, `pine schedules` and `pine manual` read the files.

### A UI of its own

A program that is a UI (a desktop app, an editor plug-in) gets a daemon with `pine service`, as
the Pine app does, and then uses the control API:

```bash
pine service
```

```json
{"base":"http://127.0.0.1:7463","token":"...","mode":"embedded daemon","started":true,"home":"/Users/you/.pine","version":"0.22.2"}
```

That line is all it writes.

| What it finds | What it does |
|---|---|
| A daemon of this home runs | `"mode": "attached"`, `"started": false`, and ends. The daemon goes on |
| Nothing runs | Starts the daemon in itself (and the `claude -p` server when a `dev/` model needs it), logs to `data/pine.log`, says `"started": true`, and stays while the daemon runs |
| Another pine home answers on the port | `{"error": "..."}`, exit code 1 |
| No home, or a configuration that does not load | `{"error": "..."}` with what to do, exit code 1 |

A daemon it started stops on SIGTERM or SIGINT, and when the command's input closes: start it
with a pipe as input, and the daemon never outlives your program. `--keep` ignores the input; the
daemon then runs until it is signalled.

## Running at login

- macOS: [examples/launchd/com.pine.daemon.plist](../../examples/launchd/com.pine.daemon.plist), a
  LaunchAgent; follow the steps at its top. Logs go to `~/.pine/data/pine.log`.
- Linux: [examples/systemd/pine.service](../../examples/systemd/pine.service), a systemd user
  service; follow the steps at its top. Logs: `journalctl --user -u pine`.

Both run as you. To keep agents further from your files, run pine as a user of its own.

## The control API

For scripts and other programs, on `127.0.0.1:7463`. Every request needs
`Authorization: Bearer <token>` (in `data/http-token`); POST bodies are JSON. An error answers
`{ "error": "..." }`. `session` is a conversation's name; left out, it is `main`.

| Request | Purpose |
|---|---|
| `GET /health` | Liveness (no token) |
| `GET /status`, `/agents`, `/approvals` | As the CLI commands. An agent whose model cannot answer has `modelProblem`, saying why |
| `GET /models` | Models that have credentials, as `provider/id` |
| `GET /mcp` | Configured MCP servers |
| `POST /mcp` `{ name, server, agent? }` or `{ name, remove: true, agent? }` | Add or remove a server while the daemon runs |
| `POST /mcp/refresh` | Close idle sessions so they start again with the current servers |
| `POST /agents` `{ id, instructions, description?, color?, model?, tools? }`, `POST /agents/<id>/update` `{ color?, scroll?, instructions?, soul?, tooling?, model?, thinking?, mode?, tools?, delegates?, network?, read?, write?, forget? }`, `POST /agents/<id>/id` `{ agent, to }`, `POST /agents/<id>/erase` `{ agent, keepFiles? }` | Create an agent, change it, give it another id (409 while it works), remove it with everything it has. `id` and `erase` repeat the id in `agent`. What `pine agent add`, `update`, `rename` and `remove` call |
| `POST /models/refresh` | Read `models.json` and `.env` again |
| `GET /agents/<id>/sessions` | The agent's conversations: name, messages, last use, pin, tab, folder, when it will be removed, `branch` (`from`, `at`), `worktree`, `group` |
| `POST /agents/<id>/pin` `{ session, pinned? }` | Pin a conversation so it is kept; `pinned: false` unpins |
| `POST /agents/<id>/rename` `{ session, to }` | Rename a conversation; also while it works |
| `POST /agents/<id>/remove` `{ session }` | Remove a conversation for good. Not the main one, not while it works |
| `POST /agents/<id>/close` `{ session }` | A UI closed the conversation's tab: ends what it was subscribed to on its own |
| `GET /agents/<id>/groups` | The agent's groups (`name`, `conversations`) and `order` (`recent` or `name`). See [agents.md](agents.md#groups-of-conversations) |
| `POST /agents/<id>/group` `{ session, group }` | Put a conversation with its branches into a group (made if needed); `group: null` takes it out. 409 for a branch alone |
| `POST /agents/<id>/groups` `{ action, name?, to? }` | `add` a group, `rename` it `to`, `remove` it with its conversations but the main one (409 while one works), `order` the list (`to`: `recent` or `name`) |
| `POST /agents/<id>/branch` `{ session, at?, to?, worktree? }` | Branch after your message `at` (a task number; without it, all of it) into `to`. Answers `session`, `tasks`, `outside`, and `worktree` with `worktree: true`. Not while it works. See [agents.md](agents.md#branching-a-conversation) |
| `GET /agents/<id>/bookmarks?session=`, `POST /agents/<id>/bookmarks` `{ session, action: "add", text, source, start, end }` or `{ session, action: "remove", id }` | The Pine app's bookmarks in a conversation (at most 200, `text` at most 10,000 characters) |
| `GET /agents/<id>/worktree?session=` | The conversation's worktree or `null`: `branch`, `base`, `path`, `repo`, `ahead`, `behind`, `dirty`, `merged`, `mergeable`. See [coding.md](coding.md#a-worktree-for-a-conversation) |
| `POST /agents/<id>/worktree` `{ session, name? }` | Move the conversation into a new worktree of its folder's repository. Not while it works, not without a folder |
| `POST /agents/<id>/worktree/merge` `{ session, how?, message? }` | Merge the worktree into its base (`how`: `merge` or `squash`). A conflict answers 409 with `conflicts` and changes nothing |
| `POST /agents/<id>/worktree/update` `{ session }` | Bring the base's new commits into the worktree; or `conflicts`, changing nothing |
| `POST /agents/<id>/worktree/remove` `{ session, keepBranch? }` | Discard the worktree (and its branch unless `keepBranch`) |
| `GET /worktrees` | Every worktree of pine's, with `orphan` for one no conversation holds |
| `GET /agents/<id>/folder?session=`, `GET /agents/<id>/folders`, `POST /agents/<id>/folder` `{ session, folder }` | The folder a conversation works in; all of the agent's; open one (`null` closes it). Refused for pine's home and code, other agents' workspaces, and while it works |
| `GET /agents/<id>/goal?session=`, `POST /agents/<id>/goal` `{ session, objective }` or `{ session, action }` | Goal mode ([agents.md](agents.md), "Goal mode"). `GET`: `{ goal }` with `objective`, `status` (`active`, `paused`, `met`, `blocked`, `limit`), round, note, the judge's reason. `objective` sets a goal and starts; `action` is `pause`, `resume` or `clear`. Changes are events on `agent/<id>/goal` |
| `GET /agents/<id>/swarm?session=`, `POST /agents/<id>/swarm` `{ session, objective }` or `{ session, action }` | A swarm ([boards.md](boards.md), "A swarm"). `GET`: `{ swarm }` with `objective`, `status` (`active`, `waiting`, `done`, `paused`, `limit`), round, `checking`, note. `objective` starts one; `action` is `pause`, `resume` or `clear`. Changes are events on `agent/<id>/swarm` |
| `GET /agents/<id>/browser?session=` | The conversation's bundled browser, for a UI that shows it: `{ open, tabs: [{ title, url }], current, window, visited? }` (`visited`: the last 12 addresses the agent opened). Starts nothing. Only your own conversations |
| `GET /agents/<id>/browser/frame?session=` | That browser's page as a JPEG; 404 while there is none |
| `POST /agents/<id>/browser/input` `{ session, ops }` | What you did in that picture, in order: `click` (`x`, `y`, `button?`, `count?`), `move`, `drag` (`x2`, `y2`), `wheel` (`dx`, `dy`), `text`, `key` (`Enter`, `Shift+Tab`, `Meta+KeyA`), `back`, `forward`, `reload`, `tab`/`closetab` (`index`), `newtab`, `size` (`w`, `h`). Each `{ do: "...", ... }`; what does not fit is left out |
| `POST /agents/<id>/browser/open` `{ session, url }` | Open an address there, through the browser's guard. A local address is allowed for the conversation by this call; pine's control port never. Starts the conversation's browser if needed, without a turn |
| `POST /browser/embedded` `{ host? }` | A UI shows the browser itself: for 90 seconds `browser_show` opens no window. The Pine app on this computer also names its own browser (`host`), which then holds the browsers of your conversations |
| `GET /agents/<id>/programs?session=`, `POST /agents/<id>/programs/stop` `{ session, id }` | What the conversation's commands left running (with `background: true` and `output` for one in the background), and stopping one of them |
| `GET /agents/<id>/view/changes?session=`, `/view/diff?session=&path=`, `/view/tree?session=&path=`, `/view/file?session=&path=`, `/view/find?session=&q=`, `/view/grep?session=&q=` | Read-only views of a conversation's folder (or the agent's workspace): git changes, a diff, a folder, a file (256 KB; `&max=` up to 2 MB), file names, file contents |
| `POST /agents/<id>/view/files` `{ session?, op, … }` | Make, rename, copy, move or delete in that folder (`op`: `folder`, `file`, `rename`, `copy`, `move`, `delete`). See [coding.md](coding.md) |
| `GET /agents/<id>/view/turn?session=`, `/view/turndiff?session=&path=` | What your last message changed in the folder (what `/undo` takes back): `{ task, prompt, root, files, more, note? }`, at most 300 files; and one file's diff |
| `POST /agents/<id>/model` `{ model }` | Switch an agent's model and save it |
| `POST /agents/<id>/thinking` `{ level }` | Set an agent's reasoning level and save it |
| `POST /agents/<id>/mode` `{ mode, session?, anyway? }` | Switch an agent's mode. `anyway: true` with a `session` keeps bypass there after outside content |
| `GET /agents/<id>/todos?session=` | The agent's list of steps in that conversation |
| `GET /boards`, `GET /boards/<id>`, `GET /agents/<id>/boards?session=`, `POST /agents/<id>/boards/post`, `POST /boards/<id>/post`, `POST /boards/items/<n>`, `POST /boards/<id>/remove` | Boards. See [boards.md](boards.md), "From the control API" |
| `POST /agents/<id>/compact` `{ session? }` | Summarise a conversation's earlier part. Queued like a message; answers the task id |
| `GET /tasks?agent=&session=&status=&limit=`, `GET /tasks/<id>` | Tasks. Kind `notify` is a note of pine's to the agent (a command ended, a delegated task was answered), never your message; `meta.label` heads it, `meta.body` is what a client shows |
| `GET /tasks/<id>/transcript` | What a task did, step by step, with the start of each tool result; `?full=1` gives whole results (up to 200,000 characters) |
| `GET /events?topic=&after=&limit=` | The event log; `after=<id>` pages forward |
| `GET /events/stream?topic=` | Live events as server-sent events |
| `POST /events` `{ topic, payload, trust? }` | Publish an event as owner; `"trust": "untrusted"` lowers it |
| `GET /state?key=`, `POST /state` `{ key, value }` | Shared state; `null` deletes |
| `POST /agents/<id>/prompt` `{ prompt, session?, wait?, attachments?, whenBusy?, mentions?, quotes?, via?, cancelOnDisconnect? }` | Give a task; waits for the result unless `wait: false`. See "Giving a task" |
| `POST /tasks/<id>/now` | A message steered into running work and not read yet: stop the step under way so the work reads it now. Answers `{ sent }` |
| `POST /tasks/<id>/cancel` | Cancel a task |
| `POST /agents/<id>/terminal` `{ session, command, state, code?, seconds?, output? }` | The Pine app: a command you ran from an answer with ▶ is `running` or has `ended`. The conversation gets pine's note with the end of the output. Not for a conversation outside content started |
| `POST /agents/<id>/reset` `{ session? }` | Start a conversation over; its own subscriptions end |
| `POST /agents/<id>/undo` `{ session? }`, `POST /agents/<id>/redo` `{ session? }` | Take back your last message with the files it changed, or bring it back. See [coding.md](coding.md) |
| `GET /ui/tabs`, `POST /ui/tabs` `{ tabs, active, code?, notify? }` | The terminal UI's open tabs (at most 50), code pane and bell, kept for next time. A conversation open in a tab is not removed for being unused |
| `GET /media/tool/<id>` | A picture a tool returned (ids in `images` of `agent/<id>/tool` events and transcript steps) |
| `GET /tasks/<id>/images/<n>` | The n-th picture that came with a task |
| `GET /agents/<id>/image?path=&session=` | A picture, video or sound file in the agent's workspace or the conversation's folder; anything else is "not found" |
| `POST /images/fetch` `{ url }` | Fetch a picture (20 MB), video or sound (100 MB) from a public https address, for display |
| `GET /sources`, `GET /agents/<id>/sources[?session=]` | Event sources and their state; those the agent can subscribe to, with how (`agent`, `global`, and with `session` also `local`) |
| `POST /agents/<id>/subscribe` `{ source, session?, note?, when?, throttle?, debounce?, separate? }`, `POST /agents/<id>/unsubscribe` `{ source, session? }` | Change an agent's subscriptions; `session` makes it one conversation's |
| `POST /subscribe` `{ source, ... }`, `POST /unsubscribe` `{ source }` | The subscription of all agents |
| `POST /approvals/<id>` `{ allow, always?, values? }` | Answer an approval. See "Answering an approval" |
| `POST /hook/<name>` | Webhook: a hook in `http.hooks` ([events.md](events.md)) or a `webhook` source ([source-types.md](source-types.md)). No token; each has its own secret unless `"open": true`. Refused from a web page (`Origin` or `Sec-Fetch-Site`) |

**Giving a task** (`POST /agents/<id>/prompt`):

- `whenBusy: "steer"`: a message for a conversation that is working goes into that work instead of
  waiting (the answer carries `steered`).
- `mentions`: files of the conversation's folder the message points at with `@` (`"src/a.ts"`,
  `"src/a.ts#20-45"`); the agent is told to read them.
- `quotes`: what you quoted, at most 20, each `{ text, source, reply? }` (10,000 characters each;
  `source` is `{ task, part }` with `part` `"prompt"` or `"answer"`, or `"letter"`, `"welcome"`).
  Each goes before `prompt` as a markdown quote, followed by `reply`; `prompt` may then be empty.
  Kept in the task's `meta.quotes` and `meta.body`.
- `attachments`: `{ name, data }` with base64 data, at most 10 files of 20 MB, saved to `inbox/`
  in the agent's workspace.
- `via: "app"`: you read the answer in the Pine app, where a `bash` code block gets a Run button.
- `cancelOnDisconnect: true`: the task is cancelled when the caller hangs up while waiting.

**Answering an approval** (`POST /approvals/<id>`): a request that lists `inputs` (a token, a
password) is allowed only with `values: { <name>: "..." }`. A question from the agent's `question`
tool (`tool: "question"`, with `options` `{ label, description? }`, `choices`, `multiSelect`,
`header`) is answered with `values: { "answer": "..." }`: a label, labels joined by ", ", or option
numbers from 1 (`2`, `1,3`). Anything else reaches the agent as your own words. `allow: false`
gives no answer.

### Setting pine up through the control API

What the main agent sets up by tool and `pine` does in the files, a program of yours does with
these. The same checks apply, without the question to you: whoever has the token is you.

| Request | Purpose |
|---|---|
| `GET /overview` | `{ version, home, main, platform, sandbox, browser, warnings, modelNotes, log }`: `browser` whether the browser build is there, `warnings` the security notes of `pine check`, `modelNotes` problems with model keys, `log` the log file |
| `GET /settings` | The settings that can change while pine runs, each `{ key, title, about, kind, now, live, saved? }`. `kind`: `"model"`, `"theme"`, `"view"`, `"boolean"`, `"duration"`, `{ one: [...] }` or `{ from, to }`; `live`: holds at once; `saved`: a value in the file that holds from the next start. As the main agent's `settings` |
| `POST /settings` `{ key, value }` | Change one, as `set_setting`; `"default"` removes the entry. Answers `{ key, now, live }` |
| `GET /themes` | The themes in the home's `themes` folder with their colors, the one in force (`theme`) and `chosen` |
| `GET /views`, `GET /views/<name>` | The views in the `views` folder (`views`, `view` in force, `chosen`), and one view's code with its types taken out ([views.md](views.md)) |
| `GET /agents/<id>/detail` | One agent in full: `{ id, main, description, color?, scroll, workspace, dir, model?, defaultModel, thinking, mode, tools, allTools, delegates, network, read, write, holdings, files }`. `files` holds the text of `instructions`, `soul`, `tooling`, `memory` and your `rules`, where they exist. Changes go through `POST /agents/<id>/update` |
| `GET /shared`, `POST /shared` `{ name, text }` | The files for all agents (`AGENTS.md`, `TOOLS.md`, `USER.md`) as `{ name, about, text }`, and replacing one. `name` is one of the three |
| `GET /skills` | Every skill with its `instructions` |
| `POST /skills` `{ name, description, instructions, agent? }`, `POST /skills/remove` `{ name, agent?, session? }` | Write a skill for all agents or one agent, as `add_skill`; remove one. A skill from a folder named in a configuration file is refused |
| `GET /schedules` | `{ name, scope, session?, when, task?, next?, topic }` each; `scope` is `global` or an agent |
| `POST /schedules` `{ name, task, cron? \| every? \| at? \| in?, agent?, session? }`, `POST /schedules/remove` `{ name, agent? }` | Add a schedule as `add_schedule`: exactly one of `cron`, `every` (at least `1m`), `at` (`"2026-12-24 17:00"`), `in` (`"20m"`). Remove one |
| `GET /routes` | The routes of `pine.json` |
| `POST /routes` `{ name, on, ... }`, `POST /routes/remove` `{ name }` | Add a route with the values `add_route` takes: `when`, `throttle`, `debounce`, `agent`, `prompt`, `session`, `set`, `publish_topic`, `publish_payload`, `call_prompt`, `call_system`, `call_model`, `ask_questions`, `ask_model`, `ask_data`, `run_command`, `run_agent`, `trust` (JSON values as text). It acts at once. Answers `{ name, lines, wider? }`. Remove one |
| `GET /decisions` | Decision models (`name`, `model`, `server`, `host`, `where`, the `routes` that ask it) and whether pine is signed in to TypeSafe |
| `POST /decisions` `{ name, server? \| url?, model?, key?, local? }`, `POST /decisions/remove` `{ name }` | Add a decision model as `add_decision_model`, or remove one (409 while a route asks it). See [configuration.md](configuration.md), "Decision models" |
| `POST /decisions/typesafe` `{ key }`, `POST /decisions/typesafe/remove` | Sign in to TypeSafe with a key, or out, as `pine login typesafe` |
| `GET /sources/types` | The source types: `{ name, summary, options, own }`; `options` is the schema (`secret: true` on a secret), `own` registered here |
| `POST /sources/propose` `{ name, type, options, agent?, ask? }` | What setting that source up would mean, writing nothing: `{ does, opens, needs, owner?, tell? }`. `needs` lists the secrets to send as `values` |
| `POST /sources` `{ name, type, description, options, agent?, own?, values?, ask? }`, `POST /sources/remove` `{ name, agent? }` | Set up an event source as `add_source`, for all agents or one. `values` go into `.env`. `own: true` treats its reports as your words. Nobody is subscribed yet. Remove one with its subscriptions and secrets |
| `GET /models/servers` | Model servers of your own, as `pine model list`, each model with its `limit` and each server with `runs` |
| `POST /models/servers` `{ name, url, key?, context?, reasoning? }`, `POST /models/servers/remove` `{ name }` | Add a model server, as `pine model add`. One that wants a key answers 409 with `locked: true` until the right `key` is sent. Removing answers 409 with `users` while one of its models is used |
| `POST /models/servers/limit` `{ name, model, limit }` | Runs at a time for one model (`limits.models`): 1 to 64, or `null` for pine's limit |
| `POST /models/model` `{ model, context? }` | Add one more model of a server of yours, as `server/id`. As `add_model` |
| `POST /models/model/set` `{ model, context?, maxTokens?, images?, reasoning?, runs? }` | Change how a model is set up; only what is given. `runs` for any model (`0`: pine's limit). Answers `{ model, changed }`; 400 when nothing changes. As `configure_model` |
| `POST /models/model/remove` `{ model }` | Take one model of a server of yours out. 409 while used; 400 for a server's last model. As `remove_model` |
| `GET /models/local` | Model servers on this computer's usual ports (llama.cpp 8080, Ollama 11434, LM Studio 1234; Pinecone on 8080 with its MCP server on 8090): `{ found }`, each `{ id, title, url, locked, models, mcp? }`. See [setup.md](setup.md), "A model server on this computer" |
| `GET /models/providers` | Providers: `{ id, name, signedIn, via, models, oauth }`. `via`: `oauth` or `api_key`; `oauth`: a browser sign-in exists |
| `POST /models/login` `{ provider, type? }` | Start a sign-in, as `pine login` (`type`: `api_key` or `oauth`). Answers `{ id }` |
| `GET /models/login/<id>`, `POST /models/login/<id>` `{ answer }` or `{ cancel: true }` | Where the sign-in stands: `{ lines, url?, code?, question?, done, error?, models? }`. Open `url` yourself, enter `code`, answer `question` (`{ message, secret, options? }`). The answer is kept nowhere |
| `POST /models/logout` `{ provider }` | Forget a provider's credential |
| `GET /mcp/states` | Whether each MCP server connects, as `pine mcp list` |
| `POST /mcp/login` `{ name, agent? }` | Sign in to a remote MCP server, as `pine mcp login`. Answers `{ code, out }` when it is over |
| `POST /agents/<id>/view/write` `{ session?, path, text }` | Write one text file in a conversation's folder (or the agent's workspace), as an editor saves: at most 2 MB, into a folder that exists, never outside. See [coding.md](coding.md), "From a script" |

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
| The first answer in a new conversation takes long; the tools take many tokens of the prompt | The model reads every tool's declaration first. pine declares them in families, about half the size; `limits.warmSlots` has an idle llama.cpp slot read that ahead of time. See [agents.md](agents.md), "How tools are declared". |
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
| The agent stops after every step and asks whether to go on | That is how a turn ends. Give the conversation a goal: `/goal <what should be reached>` ([agents.md](agents.md), "Goal mode"). |
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
