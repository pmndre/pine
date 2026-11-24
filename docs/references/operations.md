# Running pine

## Requirements

- macOS, Linux or Windows. The agent sandbox is built on the system's own: `sandbox-exec` on macOS,
  [bubblewrap](https://github.com/containers/bubblewrap) on Linux, which `pine init` installs
  and sets up. Agents in `safe` and `manual` mode work in it; an agent in `auto` mode (the
  main agent, as pine comes) needs none. Without a sandbox pine starts and works: agents
  whose mode you did not choose work in `auto`, one you set to `safe` has no shell, and `pine check`
  says why. See [security.md](security.md), "On Linux". Windows has no sandbox of pine's: see
  "On Windows" below.
- Optional: `ffmpeg` for videos in the terminal UI (on Linux also for pictures other than
  png, for the bars of a sound that is not a wav file, and its `ffplay` for sound; `mpv`,
  `pw-play`, `paplay` or `aplay` do as well. macOS plays sound and draws its bars with what it
  has); on Linux `xclip`, or on Wayland `wl-copy` and `wl-paste`, for copying a selection and
  pasting a picture.
- Node 24 or newer. From a checkout Node runs the TypeScript sources directly; the npm package
  holds them compiled.
- A model that supports tool calls: a hosted provider pi knows (sign in with `pine login`), or
  your own model server with an OpenAI-compatible chat completions endpoint (add it with
  `pine model add`).

## Install

```bash
npm install -g @pmndre/pine
```

That puts the `pine` command on your PATH. The package holds pine compiled to JavaScript,
because Node does not run TypeScript from inside `node_modules`.

On a Mac there is a second way that needs neither Node nor npm: the Pine app
([desktop.md](desktop.md), "Getting it"). It carries pine and the Node it runs on, and gives
your shell the `pine` command.

To work on pine itself, use a checkout instead. `bin/pine` runs the sources as they are and
installs the dependencies the first time; `npm link` puts that copy on your PATH:

```bash
git clone https://github.com/pmndre/pine ~/dev/pine
```

```bash
~/dev/pine/bin/pine init
```

### On Windows

Two ways, and the Pine app ([desktop.md](desktop.md)) does either:

- **pine in WSL** (the way to `safe` mode). WSL runs a Linux on the same computer, and pine
  there has the Linux sandbox. Install WSL once, in a terminal as administrator, and restart:
  `wsl --install` (it brings Ubuntu). In the Pine app, Settings > Environments lists the
  distributions; add one, and the app brings the pine it carries into it and makes a home. The
  sandbox there needs bubblewrap, which takes your password in the distribution: run once, in a
  terminal, `wsl --distribution Ubuntu --exec ~/.local/share/pine-app/bin/pine init`. Folders of
  Windows reach that pine under `/mnt/c`; its agents run Linux's programs.
- **pine on Windows itself**, with `npm install -g @pmndre/pine` or the Pine app. It needs
  [Git for Windows](https://git-scm.com/download/win): its bash is the shell pine gives an
  agent. There is no sandbox (docs/adr/0004-three-systems.md says why an AppContainer cannot run
  that shell): agents work in `auto` and `bypass` mode with your rights, as on any system
  without one, and the code pane, worktrees and undo, whose git runs in the sandbox, are not
  there. A serial port cannot be read yet.

## First start

```bash
pine init
```

sets everything up in one step:

- From a fresh checkout, `bin/pine` first installs pine's dependencies (`npm install`), once.
- It copies the example home to `~/.pine`: one agent, `main`, the main agent, with web search, the browser and,
  on a Mac, app control ([computer.md](computer.md)), a `models.json`, an empty `.env`. Nothing
  is overwritten if you run it again, and a home whose main agent has another name (`prime`, in a
  home made while new homes called it that) keeps it.
- On Linux it makes the sandbox work. If bubblewrap is missing it installs the package (apt,
  dnf, yum, pacman, zypper or apk), and on Ubuntu 24.04 and later it writes and loads the
  AppArmor rule bubblewrap needs there. It shows the commands first and asks once; they run
  with `sudo`, which asks for your password itself. `pine init --yes` does not ask, for a
  script or a container build. Where pine cannot do it (no `sudo`, a container without the
  rights), it says what would; pine runs either way: until then agents whose mode you did
  not choose work in `auto` mode, without a sandbox, and one you set to `safe` has no shell.
  The same question covers the system libraries the browser needs, which a server or a
  container image lacks (installed with apt, through Playwright).
- It downloads the Chromium build the bundled browser tools drive (about 600 MB, into
  Playwright's cache). A second run finds it there and takes a moment. If the download fails,
  everything else is set up and `pine init` can simply be run again.

```bash
pine
```

opens the terminal UI ([tui.md](tui.md)) and, since no daemon is running yet, starts one inside
it. That is the quickest way to try things. For a daemon that keeps running without a terminal:

```bash
pine check
```

```bash
pine start
```

and from another terminal `pine` (attaches to it) or
`pine send main "Say hello and list your tools."`.

### Choosing a model

A new home has no model: until you connect one, every agent says so instead of answering. Sign
in to a provider once:

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
Claude or ChatGPT subscription. Credentials go to `~/.pine/auth.json` (mode 600). Where there is
no model yet, or the one in force cannot answer, pine takes the provider's usual one by itself: at once
when the daemon is running (`pine login` tells it and says which), else at its next start; so
does `pine model add`. To pick: set `defaults.model` in `pine.json`, for example
`"opencode-go/deepseek-v4.1-flash"`, or switch in the UI with `/model`. `pine login <unknown>`
lists every provider pi knows.

### With a model server of your own

llama.cpp, vLLM, LM Studio and anything else that speaks OpenAI's chat API is added by its
address, on this machine or another one:

```bash
pine model add studio http://127.0.0.1:8080
```

pine asks the server which models it has, how much context one request gets and whether it
reads pictures, and writes the entry into `models.json`. If the server wants a key (llama-server
started with `--api-key`), it asks you for it without showing it and keeps it in `.env`. A
running pine has the models at once; choose one with `/model studio/<model>`.

- `--context <tokens>` gives the context where the server does not say it (llama.cpp does).
- `--reasoning` or `--no-reasoning` overrides what the server says about a thinking model.
- For a thinking model on llama.cpp, pine also writes which thinking level is sent for each of
  its own (`thinkingLevelMap`), from the levels the server says the model's chat template tells
  apart. So "off" really turns thinking off, and a level the model does not know becomes the
  next one up that it does know, not silently its default. See [configuration.md](configuration.md), "Thinking
  levels".
- `pine model list` shows the servers with their models; `pine model remove <name>` takes one
  out again, with its key, unless an agent still uses it.
- The main agent can do the same when you ask it to ([setup.md](setup.md), "Adding a model
  server").

For llama.cpp, start the server with tool-call support:

```bash
llama-server -m /path/to/model.gguf --jinja -c 65536 -np 2 --port 8080
```

`-np` (parallel slots) should equal the number of runs pine sends that server at a time: `limits.maxConcurrentRuns`, which is 8 unless you set it, or the model's own number in `limits.models` (Settings > Models), which is the one to set when other agents use a hosted model. With `-np 2`, set it to 2. The context is shared between
slots, so each run gets `c / np` tokens; that is the number the server reports and pine writes
down. Add `--alias <name>` to give the model a plain name: without it the name is the path of
the model file.

## In a container

A container needs nothing special:

```bash
docker run -it -v pine:/root/.pine node:24 bash
```

Inside, `npm install -g @pmndre/pine` and `pine init` as anywhere. `-v pine:/root/.pine`
keeps pine's home when the container is replaced. A container started like this cannot make
a sandbox, and need not: the container is the wall around pine, every agent whose mode you
did not choose works in `auto` mode inside it, and `pine check` says so. An agent you set to
`safe` has no shell there, and runs that events from outside start have none.

| In a container | Without the rights for a sandbox | With them |
|---|---|---|
| An agent whose mode you did not choose | Works in `auto` mode: no sandbox, the container's whole file system and network | The main agent in `auto`, the others in `safe`, as on any machine |
| An agent you set to `safe` | No shell; its file tools work | Works in its sandbox |
| A run that an event from outside started | No shell | Works in the sandbox |
| A `command` source | Is not run | Runs in the sandbox |

To have `safe` mode in a container, start it with the rights for a sandbox. They take away
most of what Docker itself protects:

```bash
docker run -it --cap-add SYS_ADMIN --cap-add NET_ADMIN --security-opt seccomp=unconfined --security-opt apparmor=unconfined -v pine:/root/.pine node:24 bash
```

`pine init` then installs bubblewrap and the browser's libraries, which the image does not
have, and names the flags if one is missing. What each flag is for, and the one more an
ordinary user in the container needs, is in [security.md](security.md), "On Linux".

## Updating

```bash
pine update
```

brings pine itself up to date and fetches what the new version needs. What it does depends on
how pine got onto the machine, which `pine version` tells you:

| Installed | `pine update` |
|---|---|
| with `npm install -g` | Asks npm for the latest version. If there is one, installs it (`npm install -g @pmndre/pine@latest`). |
| as a checkout (`git clone`) | Fetches from the repository the checkout follows and moves it forward, then runs `npm install`. Only ever a fast-forward: if commits or changes of your own are in the way, nothing is changed and it says so. |
| as a dependency inside a project | Tells you the command to run in that project; that project decides its version. |
| with the Pine app | Says whether there is a newer version and where the new app is. The pine inside the app is not replaced by itself: a new app brings it ([desktop.md](desktop.md), "Getting it"). |

Afterwards it makes sure the browser the web tools drive matches the new version, which is a
download only when that version changed.

When it is done it says what changed, as a list: every version between the one you had and
the one you have now, the newest first, with a line for each change under it (after a
checkout was moved forward, a line for every commit that came). The list travels with the package, so nothing is fetched for it.

`pine update --check` changes nothing and says whether there is something newer.

### Trying a version before it is released

What is being worked on is published ahead of a release, as a preview: a version like
`0.40.0-next.3`, the third preview of what will be 0.40.0.

| | |
|---|---|
| `@pmndre/pine@next` | The newest preview: `npm install -g @pmndre/pine@next`. It can be older than the last release when nothing new is being tried |
| `@pmndre/pine` | The last release, as always: `npm install -g @pmndre/pine` goes back to it |

Which of the two a pine follows is a choice that is kept: `pine update` stays on it.

| | |
|---|---|
| `pine update --next` | Follow previews from now on. Installs the newest preview, or the last release when that has passed it |
| `pine update --release` | Follow releases again. A preview that is installed stays until the next release; nothing is taken back by itself |

A pine that was installed from `@next` follows previews without being told: the first
`pine update` sees that it is a preview and keeps that. It still follows previews after it was
moved to a release that passed them, so the previews of the release after that are offered
too. Everything that is in a preview goes into the release it leads up to.

The choice is kept in pine's home (`data/update-channel`), and `pine version` says "follows
previews" when it is so. A checkout follows the branch it is on instead. Previews are for npm
only; the Pine app is built for releases.

A pine that is running keeps the old version until it is restarted: quit the terminal UI and
open it again, or restart the daemon (if it runs at login as a LaunchAgent:
`launchctl kickstart -k gui/$(id -u)/com.pine.daemon`).
Your home folder (`~/.pine`) is not touched by an update. When a new version adds something to
the example home, `pine init` copies the files you do not have yet and overwrites nothing.

## Commands

What you type in a shell. Every command is the `pine` program with a word after it.

| Command | What it does |
|---|---|
| `pine`, `pine tui` | The terminal UI; starts a daemon inside if none is running |
| `pine .`, `pine <folder>` | The terminal UI with one more tab: a conversation of the main agent that works in that folder (the one from last time, if there is one). A first word that is a command stays a command. See [coding.md](coding.md) |
| `pine --ssh <host> [folder]` | The terminal UI on the pine of another machine, over SSH; a folder is one there. See [tui.md](tui.md#the-pine-of-another-machine) |
| `pine <folder> --worktree [name]` | The same with a new conversation in a worktree of that folder's git repository: a checkout of its own on a branch `pine/<name>`. See [coding.md](coding.md#a-worktree-for-a-conversation) |
| `pine login <provider>`, `pine logout <provider>` | Sign in to a model provider. `--api-key` or `--oauth` force the kind of sign-in |
| `pine model add <name> <address>`, `pine model list`, `pine model remove <name>` | Add a model server of your own by its address, list them, take one out. `--context <tokens>`, `--reasoning`, `--no-reasoning` for what the server does not say. See "With a model server of your own" |
| `pine init [dir] [--yes]` | Set pine up: a home directory from the example, the browser its web tools drive and, on Linux, the sandbox (asks before running anything as administrator; `--yes` skips the question). Safe to run again |
| `pine update [--check]` | Bring pine up to date. `--check` only says whether there is something newer. `--next` and `--release` choose between previews and releases, and the choice is kept. See "Updating" |
| `pine version`, `pine --version` | Which version this is and how it is installed |
| `pine help`, `pine --help` | Prints the list of commands |
| `pine browser-install` | Fetch the browser again. `pine init` and `pine update` do this already |
| `pine check` | Validate the configuration; show each agent's workspace, model, tools, MCP servers; list security notes; say when the browser of the web tools is not there in the build this pine drives; with the daemon running, list the worktrees of conversations and those no conversation holds any more |
| `pine start` | Run the daemon in the foreground. Ctrl-C or SIGTERM stops it cleanly |
| `pine service [--keep]` | For a UI that is a program of its own (a desktop app): finds the daemon of this home or starts one, and prints one line of JSON saying where it answers and with which token. See "A UI of its own" |
| `pine dev-model [--port 7464] [--model haiku]` | The `claude -p` model server |
| `pine status` | Running tasks, live sessions (and whether they are tainted), model slots |
| `pine agents` | Configured agents, as the daemon has them (JSON) |
| `pine agent list` | The agents, readable: what each is for, model, reasoning, mode, reach, and what it has (conversations, sources, MCP servers, schedules, skills, routes that wake it, files in its workspace). Read from the files; needs no daemon |
| `pine agent add <id> [--description "..."] [--instructions "..." \| --instructions-file <file>] [--model provider/model] [--tools read,bash,...]` | Create an agent, as `create_agent` does: its folder with `agent.json` and a workspace with its instructions. `--description` says what it is for and becomes the first paragraph of its instructions, which is where pine reads that from; without instructions it is all they say. A running daemon has it at once; without one it is there at the next start |
| `pine agent update <id> [--color #rrggbb\|none] [--instructions ... \| --instructions-file <file>] [--soul ... \| --soul-file <file>] [--tooling ... \| --tooling-file <file>] [--model ...\|default] [--thinking ...] [--mode auto\|safe\|manual\|bypass\|plan\|default] [--tools read,bash,...] [--delegates id,id\|*] [--network \| --no-network] [--read /p,/p] [--write /p] [--forget /p]` | Change an agent's settings, as `update_agent` does: give only what changes, the rest stays. It holds from the agent's next message on. A running daemon applies it at once; without one the files are changed and it is there at the next start, except a model change, which needs the daemon (it checks the model exists) |
| `pine agent rename <id> <new-id>` | Give an agent another id: its folder, conversations, routes, the other agents' lists, its secrets' names in `.env` and what pine stored under its name follow. Not while it works. Through a running daemon when there is one, in the files when not. See "Renaming an agent" in [setup.md](setup.md) |
| `pine agent remove <id> [--keep-files] [--yes]` | Remove an agent and everything it has, so that nothing of it is left: conversations, sources, schedules, servers, skills, the routes that wake it, what pine stored under its name, its folder and its private home. It lists what goes and asks before it deletes; `--yes` answers for a script. `--keep-files` moves the folder to `removed/` in pine's home instead of deleting it. Through a running daemon when there is one, in the files when not. See "Changing and removing an agent" in [setup.md](setup.md) |
| `pine send <agent> <text...>` | Give an agent a task as yourself and print the answer. `--session <key>`, `--no-wait` |
| `pine emit <topic> [json]` | Publish an event as yourself |
| `pine events` | The event log. `--topic <pattern>`, `--limit <n>` (30), `-f` to follow |
| `pine tasks` | Recent tasks. `--agent <id>`, `--status pending\|running\|done\|failed\|cancelled`, `--limit <n>` (20) |
| `pine task <id>` | One task in full |
| `pine cancel <id>` | Stop a task |
| `pine state [pattern]` | Shared state |
| `pine sources` | Lists the event sources: running or idle, who is subscribed, last event; for one that polls (`http`, `command`), when it last looked or since when that fails |
| `pine subscribe <agent> <source> [--session name \| --fresh] [--note text] [--throttle 5m] [--when json] [--separate]`, `pine unsubscribe <agent> <source> [--session name]` | Wake an agent on a source's events (with `--session`: only that conversation), or stop that |
| `pine subscribe --global <source> [--note text] ...`, `pine unsubscribe --global <source>` | The same for every agent that can use the source |
| `pine approvals`, `pine approve <id> [--always]`, `pine deny <id>` | Answer approval requests; `--always` stops the question for the rest of that conversation |
| `pine reset <agent> [session]` | Start a conversation over; also clears its taint |
| `pine mode <agent> [auto\|safe\|manual\|bypass\|plan]` | Show or change an agent's mode. `auto`, `safe` and `manual` are saved in its `agent.json` and hold after a restart; `bypass` and `plan` hold until pine restarts. `auto` and `bypass` work without a sandbox, `safe` and `manual` in one. `plan`: the agent only looks and answers with a plan. See "Modes" in [security.md](security.md) |
| `pine mcp list` | MCP servers, who gets them (all agents, one agent, or one conversation of an agent), whether they connect. `--offline` lists without connecting |
| `pine skills` | Lists every skill: whom it is for (all agents, an agent, one conversation) and where it lies |
| `pine schedules` | Lists what is scheduled: for whom, when, and the task |
| `pine manual <words>`, `pine manual --read <id>` | Search this manual the way the agents do, or read one part of it in full (several ids with commas). Without words: the list of its parts |
| `pine mcp add <name> <url>`, `pine mcp add <name> -- <command...>` | Add a remote or a local server. `--agent <id>` for one agent; `--taints`, `--approve always\|tainted`, `--timeout <seconds>`, `--description <text>`, `--exposure <how>` as in [mcp.md](mcp.md) |
| `pine mcp remove <name> [--agent <id>]` | Remove a server from `pine.json`, or from that agent's `agent.json` |
| `pine mcp login <name>`, `pine mcp logout <name>` | Sign in to a remote server through the browser, or forget its tokens |

All take `--home <dir>`; the default is `$PINE_HOME` or `~/.pine`. The commands from `status`
down to `mode` talk to the running daemon over its control API on `127.0.0.1:7463`, using the
token in `data/http-token`, except `pine agent`, which uses a running daemon when there is one
and the files when not. The `pine mcp` and `pine model` commands work on the files, and `add` and `remove`
also tell a running daemon, so the change applies at once. `pine schedules`, `pine skills`,
`pine check` and `pine manual` only read the files and need no daemon (`pine check` asks a running daemon which worktrees there are). `pine help` prints the
list.

### A UI of its own

The terminal UI starts a daemon inside itself when none runs. A UI that is another program (a
desktop app, an editor plug-in) gets the same with `pine service`, and is then a client of the
control API like every other:

```bash
pine service
```

```json
{"base":"http://127.0.0.1:7463","token":"...","mode":"embedded daemon","started":true,"home":"/Users/you/.pine","version":"0.22.2"}
```

That one line is all it ever writes to its output.

| What it finds | What it does |
|---|---|
| A daemon of this home is running | Says where it is (`"mode": "attached"`, `"started": false`) and ends at once. The daemon goes on |
| Nothing runs | Starts the daemon in itself (and the `claude -p` stand-in, when the configuration uses a `dev/` model and nothing serves it), logs to `data/pine.log`, says `"started": true`, and stays for as long as the daemon is to run |
| Something else answers on the port (another pine home) | `{"error": "..."}` and exit code 1. It does not drive a daemon that does not take this home's token |
| No home, or a configuration that does not load | `{"error": "..."}` with what to do, and exit code 1 |

A daemon it started stops cleanly when the command gets SIGTERM or SIGINT, and when its input
closes: start it with a pipe as its input and keep that open, and a daemon never outlives the
program that started it, however that program ends. `--keep` leaves the input out of it, for a
daemon that is to go on after the program is closed; it then runs until it is signalled.

pine's own desktop app starts and finds its daemon this way ([desktop.md](desktop.md)).

## Running at login

On macOS, [examples/launchd/com.pine.daemon.plist](../../examples/launchd/com.pine.daemon.plist)
is a LaunchAgent that starts pine at login and restarts it when it exits. Follow the three
steps at its top. Logs then go to `~/.pine/data/pine.log`.

On Linux, [examples/systemd/pine.service](../../examples/systemd/pine.service) is a systemd
user service that does the same. Follow the steps at its top. Logs go to the journal
(`journalctl --user -u pine`).

Both run as you, in your login session. To separate the agents from your files more
strongly, create a dedicated user, keep pine's home and the agents' workspaces there, and
install the service for that user.

## The control API

For scripts and other programs. Every request needs `Authorization: Bearer <token>`; POST bodies
are JSON with `Content-Type: application/json`.

| Request | Purpose |
|---|---|
| `GET /health` | Liveness (no token) |
| `GET /status`, `/agents`, `/approvals` | As the CLI commands. An agent in `/agents` whose model cannot answer has `modelProblem`, a sentence that says why: nobody is signed in to its provider, or it is `dev/…` (Claude through the `claude` command) and this computer has no such command |
| `GET /models` | Models that have credentials, as `provider/id` |
| `GET /mcp` | Configured MCP servers |
| `POST /mcp` `{ name, server, agent? }` or `{ name, remove: true, agent? }` | Add or remove a server while the daemon runs |
| `POST /mcp/refresh` | Close idle sessions so they start again with the current servers |
| `POST /agents` `{ id, instructions, description?, color?, model?, tools? }` (`description` becomes the first paragraph of the instructions), `POST /agents/<id>/update` `{ color?, instructions?, soul?, tooling?, model?, thinking?, mode?, tools?, delegates?, network?, read?, write?, forget? }`, `POST /agents/<id>/id` `{ agent, to }`, `POST /agents/<id>/erase` `{ agent, keepFiles? }` | Create an agent, change its settings, give it another id, or remove one with everything it has, while the daemon runs (`id` and `erase` repeat the id in `agent`: an agent is not renamed or removed by a mistyped address; `/agents/<id>/rename` renames a conversation). Renaming answers 409 while the agent works. What `pine agent add`, `pine agent update`, `pine agent rename` and `pine agent remove` call |
| `POST /models/refresh` | Read `models.json` and `.env` again, after a model server was added or removed in the files. `pine model add` and `pine model remove` call it |
| `GET /agents/<id>/sessions` | The agent's conversations: name, number of messages, last use, whether pinned or open in a tab, the folder opened for it, when one will be removed by itself, what a branch was made from (`branch`: `from`, `at`), the worktree it works in (`worktree`: `branch`, `base`, `path`, `repo`), and the group it is in (`group`) |
| `POST /agents/<id>/pin` `{ session, pinned? }` | Pin a conversation so that it is kept, or with `pinned: false` take the pin off |
| `GET /agents/<id>/groups` | The agent's groups of conversations, empty ones too (`groups`: `name`, `conversations`), and how its list is sorted (`order`: `recent` or `name`). See [agents.md](agents.md#groups-of-conversations) |
| `POST /agents/<id>/group` `{ session, group }` | Put a conversation, with its branches, into a group (made if there is none), or with `group: null` take it out. Answers `session`, `group` and the conversations `moved`. A branch alone answers 409 |
| `POST /agents/<id>/groups` `{ action, name?, to? }` | `add` makes the group `name`; `rename` gives it the name `to`; `remove` removes it with every conversation in it but the main one (answers `removed`, `kept`, and what went with them, as removing a conversation does; 409 while one of them works); `order` with `to` `recent` or `name` sorts the agent's list |
| `POST /agents/<id>/rename` `{ session, to }` | Give a conversation another name; its history, pin, subscriptions and what was set up for it follow |
| `POST /agents/<id>/branch` `{ session, at?, to?, worktree? }` | Branch `session` after your message `at` (its task number; without it, all of it) into `to`, or a name made from the original. Answers `session`, the `tasks` copied, and `outside` when the branch holds outside content. With `worktree: true` the branch works in a worktree of its own, and the answer has `worktree` (`branch`, `path`, `copied`). Not while it is working. See [agents.md](agents.md#branching-a-conversation) |
| `GET /agents/<id>/worktree?session=` | The conversation's worktree (`worktree`, or `null`): its `branch`, the `base` it was made from, its `path` and `repo`, and how it stands: `ahead`, `behind`, `dirty` (files not committed), `merged`, `mergeable` (the base is a branch). See [coding.md](coding.md#a-worktree-for-a-conversation) |
| `POST /agents/<id>/worktree` `{ session, name? }` | Move the conversation into a new worktree of its folder's repository. Answers `folder`, `branch`, `base`, `path` and the files `.worktreeinclude` had `copied`. Not while it is working, not without a folder, not twice |
| `POST /agents/<id>/worktree/merge` `{ session, how?, message? }` | Merge the worktree's commits into its base: `how` is `merge` (a fast-forward where it can be) or `squash`. Answers `how`, `commit`, `commits` and where the base's files were brought up to date (`updated`). A conflict answers 409 with `conflicts` (the files) and changes nothing. Not while the conversation, or one that works in the base's checkout, is working |
| `POST /agents/<id>/worktree/update` `{ session }` | Bring what the base got since into the worktree. Answers `merged` (commits), or `conflicts` and changes nothing |
| `POST /agents/<id>/worktree/remove` `{ session, keepBranch? }` | Discard the worktree, with its branch unless `keepBranch`; the conversation works in the folder it came from again (`folder`) |
| `GET /worktrees` | Every worktree of pine's: the conversation it belongs to (`agent`, `session`), its `path`, `branch` and `repo`; `orphan` for one that git still has and no conversation does |
| `POST /agents/<id>/remove` `{ session }` | Remove a conversation for good, with its history and what was set up for it alone. Not the main one, and not while it is working |
| `GET /ui/tabs`, `POST /ui/tabs` `{ tabs, active, code?, notify? }` | The tabs the terminal UI has open (`tabs` is a list of `{ agent, session }`, 50 at most), whether its code pane was open (`code`) and whether it calls for attention with a bell (`notify`, set with `/notify`), kept so that it opens the same way next time. `code` and `notify` stay as they were when left out. A conversation that is open in a tab is not removed for being unused |
| `GET /agents/<id>/folder?session=`, `GET /agents/<id>/folders`, `POST /agents/<id>/folder` `{ session, folder }` | The folder a conversation works in; every conversation of the agent that has one; open a folder for a conversation (`folder: null` closes it). Refused for pine's home, pine's program and other agents' workspaces, and while the conversation is working |
| `GET /agents/<id>/goal?session=`, `POST /agents/<id>/goal` `{ session, objective }` or `{ session, action }` | Goal mode. `GET` returns `{ goal }` with the objective, `status` (`active`, `paused`, `met`, `blocked`, `limit`), the round, pine's note on what happened last and the judge's reason; no goal: `{}`. `objective` sets the conversation's goal and starts on it; `action` is `pause`, `resume` or `clear`. Every change is also an event on `agent/<id>/goal`. See "Goal mode" in [agents.md](agents.md) |
| `GET /agents/<id>/swarm?session=`, `POST /agents/<id>/swarm` `{ session, objective }` or `{ session, action }` | A swarm ([boards.md](boards.md), "A swarm"). `GET` returns `{ swarm }` with the job in `objective`, `status` (`active`, `waiting` for your answer, `done`, `paused`, `limit`), the round, `checking` while a sub-agent checks the answer, and pine's note on what happened last. `POST` with `objective` starts one (the job goes out as your message, with pine's note on how a swarm is led); with `action` `pause`, `resume` or `clear` it holds it, goes on, or takes it off. A UI is told on `agent/<id>/swarm` each time it changes. |
| `GET /agents/<id>/browser?session=` | Where the bundled browser of a conversation is, for a UI that shows it itself: `{ open, tabs: [{ title, url }], current, window, visited? }`. `open` is false while the conversation has no browser running or no page open; nothing is started to answer. `visited` is the last addresses the agent opened in this conversation (newest first, at most 12, only pages that came), kept by pine also while no browser runs. Only an owner's own conversation has one |
| `GET /agents/<id>/browser/frame?session=` | The page of that browser as a picture (JPEG). 404 while there is none |
| `POST /agents/<id>/browser/input` `{ session, ops }` | What the owner did in that picture, in order: `{ do: "click", x, y, button?, count? }`, `"move"`, `"drag"` (`x`, `y`, `x2`, `y2`), `"wheel"` (`dx`, `dy`), `"text"` (`text`), `"key"` (`key`: `Enter`, `Shift+Tab`, `Meta+KeyA`), `"back"`, `"forward"`, `"reload"`, `"tab"` (`index`: choose a tab), `"newtab"`, `"closetab"` (`index`), `"size"` (`w`, `h`: the room the picture has). Places are points of the picture. The browser's server takes each piece for what it has to be and leaves out the rest. Answers with where the browser is then, and `error` when something was not done |
| `POST /agents/<id>/browser/open` `{ session, url }` | The owner opens an address in that browser. It goes through the browser's guard; one on this computer or the local network is allowed for the conversation by this call, pine's own control port never. Where the conversation's browser is not running (pine restarted, or the conversation was idle), its session is started for this, without a turn of the agent's; a conversation that does not exist is not made by it |
| `POST /browser/embedded` `{ host? }` | A UI says that it shows the browser itself. For the next 90 seconds an agent's `browser_show` opens no window on the screen; the Pine app says it every half minute. The Pine app on the same computer also says where its own browser is (`host`, an address on the loopback with a word), and the browsers of the owner's conversations become that one, a page in the app's window, until it stops saying so; `GET /agents/<id>/browser` then has `room`, which names that conversation's tabs there |
| `GET /agents/<id>/programs?session=`, `POST /agents/<id>/programs/stop` `{ session, id }` | What a conversation's commands left running (command, ports, how long), and stopping one of them. A command the agent started in the background is among them while it runs, with `background: true` and `output` (the file its output goes to). Only a program of that conversation can be stopped. |
| `GET /agents/<id>/view/changes?session=`, `/view/diff?session=&path=`, `/view/tree?session=&path=`, `/view/file?session=&path=`, `/view/find?session=&q=` | What the code pane shows of a conversation's folder (or of the agent's workspace): what git says changed, one file's diff, what is in a folder, a file's text (the first 256 KB; with `&max=<bytes>` up to 2 MB, for an editor), the files whose name fits a few letters. Read-only, and nothing outside that folder |
| `GET /agents/<id>/view/turn?session=`, `/view/turndiff?session=&path=` | What your last message in a conversation changed in its folder, which is what `/undo` would take back: `{ task, prompt, root, files, more, note? }` (at most 300 files; `note` says why there is nothing to show), and one file's diff over that message. While the message is still being worked on: what it has changed so far. See [coding.md](coding.md) |
| `POST /agents/<id>/model` `{ model }` | Switch an agent's model and save it in its `agent.json` |
| `GET /agents/<id>/todos?session=` | The list of steps the agent keeps in that conversation |
| `GET /boards`, `GET /boards/<id>`, `GET /agents/<id>/boards?session=`, `POST /agents/<id>/boards/post`, `POST /boards/<id>/post`, `POST /boards/items/<n>`, `POST /boards/<id>/remove` | Boards: the tasks and notes several runs share, what you post on one and what you do with a task. See "From the control API" in [boards.md](boards.md) |
| `POST /agents/<id>/compact` `{ session? }` | Shorten a conversation: its earlier part becomes a summary. Queued like a message; answers with the task's id |
| `POST /agents/<id>/thinking` `{ level }` | Set an agent's reasoning level and save it in its `agent.json` |
| `POST /agents/<id>/mode` `{ mode, session?, anyway? }` | Switch an agent's mode (`auto`, `safe`, `manual`, `bypass` or `plan`). `auto`, `safe` and `manual` are saved and hold after a restart; `bypass` and `plan` hold until the daemon restarts. `anyway: true` with a `session` keeps bypass in force in that conversation although it has read outside content |
| `GET /tasks?agent=&session=&status=&limit=`, `GET /tasks/<id>` | Tasks |
| `GET /tasks/<id>/transcript` | What a task did, step by step: the text it was given, what it wrote, its tool calls with the start of each result. With `?full=1`: with the whole result of each call, up to 200 000 characters |
| `GET /events?topic=&after=&limit=` | Event log; `after=<id>` pages forward |
| `GET /events/stream?topic=` | Live events as server-sent events |
| `GET /state?key=` | Shared state |
| `POST /events` `{ topic, payload }` | Publish an event (as owner; `"trust": "untrusted"` to lower it) |
| `POST /agents/<id>/prompt` `{ prompt, session?, wait?, attachments?, whenBusy?, mentions?, via? }` | Give a task. Waits for the result unless `wait` is false. With `"whenBusy": "steer"`, a message for a conversation that is working is given to that work instead of waiting behind it (the answer then carries `steered`, the id of that task). `mentions` lists files of the conversation's folder that the message points at with `@` (`"src/a.ts"`, `"src/a.ts#20-45"`); the agent is told to read them. `"via": "app"` says the owner reads the answer in the Pine app: the agent is told that a code block marked `bash` gets a Run button there. `attachments` is a list of `{ name, data }` with base64 data, at most 10 files of 20 MB each; the files are saved to `inbox/` in the agent's workspace. With `"cancelOnDisconnect": true` the task is cancelled when the caller closes the connection while it waits |
| `POST /agents/<id>/terminal` `{ session, command, state, code?, seconds?, output? }` | The Pine app: a command from an answer that the owner ran in their terminal with ▶ is still `running` (said once), or has `ended` with exit `code`. The conversation gets a message of pine's own with the command, how it went and the end of `output` quoted, and the agent goes on. Not for a conversation that outside content started |
| `POST /agents/<id>/reset` `{ session? }` | Reset a session. What it was subscribed to on its own ends too |
| `POST /agents/<id>/undo` `{ session? }`, `POST /agents/<id>/redo` `{ session? }` | Take back the owner's last message in a conversation, with the files it changed, or bring back what the last undo took. See [coding.md](coding.md) |
| `GET /media/tool/<id>` | A picture a tool returned. The ids are in the `images` field of `agent/<id>/tool` events and of transcript steps |
| `GET /tasks/<id>/images/<n>` | The n-th picture that came with a task (an attachment, a Telegram photo) |
| `GET /agents/<id>/image?path=&session=` | A picture, video or sound file in that agent's workspace or, with `session`, in the folder opened for that conversation. Anything that is not an image, video or sound file in there is "not found" |
| `POST /images/fetch` `{ url }` | Fetch a picture, video or sound from the web for display: https and public addresses only; pictures up to 20 MB, videos and sound up to 100 MB |
| `GET /sources`, `GET /agents/<id>/sources[?session=]` | Event sources and their state; the ones that agent can subscribe to, each with how it listens (`agent`: as the agent, `global`: with all agents, and with `session` also `local`: that conversation on its own) |
| `POST /agents/<id>/subscribe` `{ source, session?, note?, when?, throttle?, debounce?, separate? }`, `POST /agents/<id>/unsubscribe` `{ source, session? }` | Change an agent's subscriptions (written to its `agent.json`); `session` makes it one conversation's |
| `POST /subscribe` `{ source, note?, ... }`, `POST /unsubscribe` `{ source }` | The subscription of all agents (written to `pine.json`) |
| `POST /agents/<id>/close` `{ session }` | A conversation's tab was closed in a UI: ends what it was subscribed to on its own. The conversation itself is kept |
| `POST /tasks/<id>/cancel` | Cancel |
| `POST /tasks/<id>/now` | For a message of yours that was steered into running work (`<id>` is the message's task) and not read yet: stop the step that work is on, and let it go on with the message. Answers `{ sent }`, false when the message was read already or the work has ended |
| `POST /approvals/<id>` `{ allow, always?, values? }` | Answer an approval. A request that lists `inputs` (a token, a password) is only allowed together with `values: { <name>: "..." }`; the terminal UI has a field for them. A question an agent asks with its `question` tool is such a request (`tool: "question"`, with the answers it offers in `choices`): answer it with `values: { "answer": "..." }`, or with `allow: false` for no answer |
| `POST /state` `{ key, value }` | Write state; `null` deletes |
| `POST /hook/<name>` | Webhook: a hook from `http.hooks` ([events.md](events.md)) or a running `webhook` source ([source-types.md](source-types.md)). No token; each has its own secret, unless a hook is declared `"open": true` |

### Setting pine up through the control API

What the main agent sets up by tool call when you ask it, and the `pine` command in the files,
a program of yours does with these: a settings panel of a UI, a script. They are checked and
carried out by the same functions the tools use, without the question to you, since whoever
has the token is you. An error is answered with `{ "error": "..." }` and what to do.

| Request | Purpose |
|---|---|
| `GET /overview` | Where this pine stands: `{ version, home, main, platform, sandbox, browser, warnings, modelNotes, log }`. `browser` says whether the browser build this pine drives is on the computer (left out when pine could not tell), `warnings` are the security notes of `pine check`, `modelNotes` what is wrong with model keys, `log` the path of the log file |
| `GET /settings` | The settings of `pine.json` that can be changed while pine runs, each as `{ key, title, about, kind, now, live }`: what is in force (`now`), what a value has to be (`kind`: `"model"`, `"theme"`, `"view"`, `"boolean"`, `"duration"`, `{ one: [...] }` or `{ from, to }`), and whether a change holds at once (`live`). `saved` is there when the file holds another value that takes effect at the next start. The same list as the main agent's `settings` tool |
| `GET /themes` | The themes in the `themes` folder of pine's home, each with the colors it gives, the one in force (`theme`) and the one `ui.theme` names (`chosen`, or `null`) |
| `GET /views`, `GET /views/<name>` | The views in the `views` folder (`views`, each `{ id }` or `{ id, problem }`), the one in force (`view`, or `null` for no panel) and `chosen`; and one view's code with its types taken out, which the Pine app runs in a sandboxed frame and the daemon never runs ([views.md](views.md)) |
| `POST /settings` `{ key, value }` | Change one of them, as `set_setting` does. `"default"` as the value takes the entry out. Answers `{ key, now, live }` |
| `GET /agents/<id>/detail` | One agent in full: `{ id, main, description, workspace, dir, model?, defaultModel, thinking, mode, tools, allTools, delegates, network, read, write, holdings, files }`. `model` is missing when it runs on the default. `holdings` is what it has (conversations, sources, servers, schedules, skills, routes, files in its workspace). `files` holds the text of its `instructions` (AGENTS.md), `soul`, `tooling`, `memory` and your `rules` for it, each only when the file exists. Changes go through `POST /agents/<id>/update` |
| `GET /shared`, `POST /shared` `{ name, text }` | The three files for all agents in pine's home (`AGENTS.md`, `TOOLS.md`, `USER.md`) as `{ name, about, text }`, and replacing one of them. `name` is one of the three and never a path |
| `GET /skills` | Every skill, as `pine skills` lists them, each with its `instructions` (the body of its SKILL.md) |
| `POST /skills` `{ name, description, instructions, agent? }`, `POST /skills/remove` `{ name, agent?, session? }` | Write a skill for all agents, or with `agent` for that agent, as `add_skill` does (the same name again replaces it); remove one. A skill in a folder you named under `skills` in a configuration file stays yours and is refused |
| `GET /schedules` | What is scheduled: `{ name, scope, session?, when, task?, next?, topic }` each, `scope` being `global` or an agent |
| `POST /schedules` `{ name, task, cron? \| every? \| at? \| in?, agent?, session? }`, `POST /schedules/remove` `{ name, agent? }` | Add a schedule as `add_schedule` does: for all agents, for an agent, or with `session` for one of its conversations. Exactly one of `cron`, `every`, `at` (`"2026-12-24 17:00"`) and `in` (`"20m"`). Remove one |
| `GET /routes` | The routes of `pine.json` |
| `POST /routes` `{ name, on, when?, agent?, prompt?, session?, set?, publish_topic?, publish_payload?, call_prompt?, call_system?, call_model?, throttle?, debounce?, trust? }`, `POST /routes/remove` `{ name }` | Add a route with the values `add_route` takes (`when`, `set` and `publish_payload` as JSON text); it acts at once. Answers `{ name, lines, wider? }`: what it does in words, and what it gives up if it widens trust. Remove one |
| `GET /sources/types` | The source types there are: `{ name, summary, options, own }` each, `options` being the schema of what a source of that type takes (a secret option has `secret: true`), `own` whether it was registered in this installation |
| `POST /sources/propose` `{ name, type, options, agent?, ask? }` | What setting that source up would mean, without writing anything: `{ does, opens, needs, owner?, tell? }`. `needs` lists the secrets only you have (`{ name, label }`), to be sent as `values` |
| `POST /sources` `{ name, type, description, options, agent?, own?, values?, ask? }`, `POST /sources/remove` `{ name, agent? }` | Set an event source up as `add_source` does after your yes: for all agents, or with `agent` for that one. `values` are the secrets from `needs`; they go into pine's `.env` and the configuration names them. `own: true` treats what it reports as your own words. Nobody is subscribed yet (`POST /agents/<id>/subscribe`). Remove one, with its subscriptions and secrets |
| `GET /models/servers` | The model servers of your own, as `pine model list`, each model with `limit` where it has a number of runs of its own (`limits.models`), and each server with `runs`, what holds for its models without one |
| `POST /models/servers/limit` `{ name, model, limit }` | How many runs one model takes at a time (`limits.models`), by its server's or provider's name and the id the server gives it: a whole number from 1 to 64, or `null` for pine's own limit. In force from the next run on |
| `POST /models/servers` `{ name, url, key?, context?, reasoning? }`, `POST /models/servers/remove` `{ name }` | Add a model server by its address, as `pine model add` does: pine asks it for its models. A server that wants a key answers status 409 with `locked: true` until the right `key` is sent; the key goes into `.env`. Remove one: status 409 with `users` while an agent or a default uses one of its models |
| `GET /models/providers` | The model providers pi knows: `{ id, name, signedIn, models, oauth }` each. `signedIn`: there is a credential or a key for it; `oauth`: it can be signed in to through a browser |
| `POST /models/login` `{ provider, type? }` | Start a sign-in to a provider, as `pine login` does (`type`: `api_key` or `oauth`). Answers `{ id }`. The sign-in then waits for you, step by step |
| `GET /models/login/<id>`, `POST /models/login/<id>` `{ answer }` or `{ cancel: true }` | Where a sign-in stands: `{ lines, url?, code?, question?, done, error?, models? }`. `url` is a page to open in a browser (pine does not open it), `code` what to enter there, `question` what it waits for (`{ message, secret, options? }`): answer it with `answer` (a key, a pasted address, the `id` of an option). `done` with `models` when it worked, with `error` when not. An answer is handed on and kept nowhere |
| `POST /models/logout` `{ provider }` | Forget the stored credential of a provider |
| `GET /mcp/states` | Whether each MCP server connects, as `pine mcp list` shows it. Takes as long as connecting to them does |
| `POST /mcp/login` `{ name, agent? }` | Sign in to a remote MCP server through the browser, as `pine mcp login`. The request lasts until the sign-in is over and answers `{ code, out }` |
| `POST /agents/<id>/view/write` `{ session?, path, text }` | Write one text file in the folder a conversation works in (or the agent's workspace): what an editor in a UI saves. At most 2 MB, into a folder that exists, and nowhere outside that folder. See "From a script" in [coding.md](coding.md) |

## Day to day

- **See what is happening:** `pine events -f` in a terminal. Add `--topic "agent/#"` for agent
  activity only; tool calls appear live on `agent/<id>/tool`.
- **Why did it answer that?** `pine task <id>` shows the prompt as the agent received it, the
  tools it called and the result. The full transcript is the newest `.jsonl` under
  `~/.pine/agents/<id>/sessions/<session>/`.
- **Change instructions:** tell the agent ("from now on ..."); it writes that into `AGENTS.md` in
  its workspace. Or edit the file yourself. Either applies to the next message. What is to
  hold for all agents, tell the main agent: it keeps three files in pine's home that every
  agent reads, `AGENTS.md` (traits and behaviour), `TOOLS.md` (defaults and preferences for
  the tools) and `USER.md` (what agents know about you).
- **Change configuration:** edit `pine.json` or `agent.json`, run `pine check`, restart the
  daemon. Queued tasks survive the restart. MCP servers, event sources, subscriptions and new
  agents need neither an edit nor a restart: ask an agent ([setup.md](setup.md)), or use
  `pine mcp add` and `pine subscribe`.
- **An agent is stuck:** `pine status`, then `pine cancel <id>`.
- **An agent keeps asking for approval:** it is in manual mode (`pine mode <agent> auto`, or
  the mode in the bottom bar of the terminal UI), or the question names a tool on its `approve`
  list. Sending something out also asks after a conversation has read outside content (it is
  tainted): "Always here" in the dialog covers that tool for the conversation, and `/reset`
  or `pine reset` starts a clean one. A message to you through Telegram is not among what
  asks: an agent that watches something tells you without anybody at the keyboard.
- **Back up:** the home directory. `data/pine.db` holds events and tasks, `agents/*/sessions`
  the conversations. Workspaces are wherever you put them.

## Problems

| Symptom | Likely cause |
|---|---|
| `pine.json not found` | Wrong home. Pass `--home` or set `PINE_HOME`. |
| `model "x/y" is not defined in models.json` | `defaults.model` or an agent's `model` does not match `provider/id`. `/model` in the UI lists what is available. |
| A model of your own server is missing from `/model` | The server wants a key and `models.json` names one that is not in `.env`. `pine check` lists it under "Model notes"; add the line to `.env` and restart, or remove the server and add it again with `pine model add`. |
| `pine model add` says "no model server answers" | Nothing listens at that address, or it is not reachable from this machine (a firewall, a VPN that is off). `curl <address>/v1/models` shows what the server says. |
| An answer starts late: the model reads the whole conversation again after you were in another tab or conversation, or after a restart | The model server has kept nothing of the conversation. With a llama.cpp server pine keeps each conversation in a slot of its own; give the server enough slots (`-np`), and a folder for them (`--slot-save-path`), so that a conversation that has to leave its slot is read back from a file (`limits.slotPages`). A scheduler that stops and starts the model makes it forget everything unless it saves the slots. See [agents.md](agents.md), "What the model server keeps". |
| The first answer in a new conversation takes long, and the tools take too many tokens of the prompt | The model reads every tool's declaration first. pine declares them grouped and short (families), which is about half of what one by one would be; `limits.warmSlots` has an idle slot of a llama.cpp server read that beginning ahead of time. See [agents.md](agents.md), "How tools are declared". |
| A task fails with 401 or "API key" | The provider's credential is missing or expired. `pine login <provider>` again. |
| The browser tools fail with "Executable doesn't exist" | Run `pine init` again (or `pine browser-install`): the browser is missing or pine was updated to a newer one. `pine check` says so on its `browser` line, and the Pine app asks at its start and fetches it from Settings > General. |
| A source reported something and the agent was not woken, now and then: a click on a page it made, a second message shortly after the first | The subscription's throttle. After an event that woke the agent, the source is ignored for ten seconds unless the subscription says otherwise; what arrives meanwhile is in the event log and starts no turn. Have the agent subscribe again with `throttle: "0s"` (or `pine subscribe <agent> <source> --throttle 0s`) where every event counts ([sources.md](sources.md)). |
| A page in the agent's browser cannot open a WebSocket or load something from this computer: `Establishing a tunnel via proxy server failed`, or a request that fails | The page reached for a local address nobody allowed. A yes for a local address is for one host and one port: a page on `localhost:8100` does not reach `localhost:8101` by it. The browser carries a WebSocket on a port that is allowed. Have the agent serve everything from one port, or open the other address once with `browser_navigate`, which asks you ([mcp.md](mcp.md), [interfaces.md](interfaces.md)). |
| The first message fails with "No model yet" | A new home has no model. Sign in to a provider (`pine login <provider>`, or Settings > Models in the Pine app) or add a model server of your own (`pine model add`); the first one becomes the default, and you send the message again. |
| The browser cannot open `localhost` or a page says "not reachable from the browser" | Local addresses need your yes. The agent opens the address with `browser_navigate` and you are asked; see "Local addresses" in [mcp.md](mcp.md). A server the agent started itself also needs network access for its shell. |
| The agent says macOS does not let pine operate apps, or take pictures of the screen | macOS has to be told once: System Settings > Privacy & Security > Accessibility (and Screen & System Audio Recording for pictures), switch on the app pine runs in (the Pine app when it started pine, else the terminal pine was started from). See "What macOS has to be told, once" in [computer.md](computer.md). |
| The agent has no tools to click or type in apps | App control is for an agent that reaches your whole account, in your own conversations, on macOS, Windows, or Linux with X11 (not Wayland). `pine check` says which under `apps`. See [computer.md](computer.md). |
| The UI says "reconnecting…" | The daemon it was attached to stopped. Start it again; the UI picks it up. |
| `no daemon answers on http://127.0.0.1:7463` | The daemon is not running, or `http.port` differs from what the CLI reads in this home. |
| A task fails with a connection error | The model server is down or `baseUrl` is wrong. `curl <baseUrl>/models` should answer. |
| A task fails after minutes with a timeout | The model stopped streaming (`limits.modelStreamIdleMs`) or took too long to start (`limits.modelHeadersTimeoutMs`); raise them for a slow model. |
| The agent stops after every step and asks whether it should go on | That is how a turn ends. Give the conversation a goal: `/goal <what should be reached>` in the terminal UI, and it is called again until a judge says the goal is met ("Goal mode" in [agents.md](agents.md)). |
| A goal is paused with "gave no verdict" | The judge did not answer in time (`limits.goalJudgeTimeout`) or not with MET, CONTINUE or BLOCKED. `/goal resume` goes on; if it happens often, give the judge a model that follows a format (`defaults.judge`). |
| The agent says a file is "not permitted" | It is outside what the agent reaches. The main agent works in `auto` mode and has your whole account; other agents work in `safe` mode, in a sandbox, and have their workspace (`mode`: `pine mode <agent> auto` gives another agent the account). pine's own home is closed to every agent in every mode. After outside content the main agent keeps that reach, except for files that are read as instructions (the `AGENTS.md` of the folder it works in, for example). You are asked when a call needs something outside (by pine, or by the agent with `request_access`); if you said no, pine does not ask again in that conversation. To open a folder for good, use `sandbox.read` / `sandbox.write`. |
| An approval `request_access` appears that the agent did not ask for | pine asked on the agent's behalf: a file tool or a shell command needed a file or folder outside the agent's sandbox, or the network. The first lines say what, the line `for:` which call. Yes holds for that conversation; no is remembered there. See "When a call needs something outside" in [security.md](security.md). |
| An agent says "No such file" for a folder in your home that exists (`~/Documents/scans`) | In the shell of an agent in the sandbox (`safe` or `manual` mode) `~` is its own private home (`sandbox/<id>/` in pine's home), not yours. pine catches this where the path is written out in the command, asks you for the folder in your home, and tells the agent to use the full path. Tell the agent the full path (`/Users/you/Documents/scans`) if it built the name some other way. |
| The agent cannot stop a program it started (`kill: Operation not permitted`) | In the sandbox (`safe` or `manual` mode) every command has a sandbox of its own and cannot signal what an earlier one started. The agent's `stop_program` tool works in every mode, and so does `■ stop` under Running in the code pane. |
| `git` complains about identity | In the sandbox (`safe` or `manual` mode) the agent's shell has its own empty home. Run `git config --global user.name ...` once through the agent, or set it per repository. |
| A command needs the network | `sandbox.network: true` for that agent, or better a `commands` tool for that one command. |
| Telegram bot does not react | `pine sources`: is the `telegram` source running, and is a conversation subscribed? A new bot waits to be paired: write to it, and type the code it sends you into the question in the terminal UI (`pine sources` says whom it listens to). Otherwise another program polls the same bot token. |
| An event arrives but no task starts | See "When nothing happens" in [events.md](events.md) for routes and in [sources.md](sources.md) for subscriptions. |
| The first answer after a pause is slow | The session was closed after `idleMs` and is being resumed; MCP servers start again. |

## Coming from OpenClaw

| OpenClaw | pine |
|---|---|
| Agents in `openclaw.json` with `workspace-*` folders | One folder per agent under `agents/`; `workspace` points at the repository |
| Telegram `bindings` | A `telegram` source the agent sets up when you ask it to, and is subscribed to |
| `SOUL.md`, `AGENTS.md`, `TOOLS.md`, `MEMORY.md` | The same four names in the agent's workspace, read into its prompt and written by the agent |
| `USER.md` | One `USER.md` in pine's home for all agents, kept by the main agent |
| One `TOOLS.md` or `AGENTS.md` copied into every workspace | A `TOOLS.md` and an `AGENTS.md` in pine's home for all agents, kept by the main agent and read by every agent before its own |
| `IDENTITY.md`, `HEARTBEAT.md`, daily memory files | Not read by pine. Fold what matters into `SOUL.md`, `AGENTS.md` or `MEMORY.md`; other notes are ordinary files in the workspace |
| Cron jobs | A schedule: ask the agent ("every morning at seven ..."), or write it under `schedules` with a `task` |
| Heartbeat | Usually not needed: an event source wakes the agent when something happens, and looking again and again (`http`, `command`) costs no model turn. For a real one, a schedule with `every` whose task ends in "reply NO_REPLY if nothing needs attention" |
| `/hooks/*` mappings | A `webhook` source the agent subscribes to, or `http.hooks` plus a route |
| Managed extensions that watch something and message Telegram themselves | An event source the agent subscribes to (a folder, an FTP drop, MQTT), and the `send` tool for what it reports to you on Telegram. The agent then knows what happened |
| Skills | Skills, same format |
