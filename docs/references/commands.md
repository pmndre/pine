# Commands

Every `pine` command, and which ones need a running daemon. Installing and starting pine: see
[operations.md](operations.md). Every command takes `--home <dir>` (default `$PINE_HOME` or
`~/.pine`).

| Command | What it does |
|---|---|
| `pine`, `pine tui` | The terminal UI; starts a daemon inside it if none runs |
| `pine .`, `pine <folder>` | The terminal UI with a main-agent conversation in that folder, the one from last time if any. See [coding.md](coding.md). A word that is a command stays a command |
| `pine --ssh <host> [folder]` | The terminal UI on another machine's pine, over SSH. See [tui.md](tui.md#the-pine-of-another-machine) |
| `pine <folder> --worktree [name]` | A new conversation in a worktree of the folder's repository, on branch `pine/<name>`. See [coding.md](coding.md#a-worktree-for-a-conversation) |
| `pine init [dir] [--yes]` | Sets up a home, the browser and, on Linux, the sandbox. Safe to run again |
| `pine login <provider>`, `pine logout <provider>` | Signs in to a model provider (`--api-key` or `--oauth`), or out. `pine login typesafe` is for decision models. See [configuration.md](configuration.md), "Decision models" |
| `pine model add <name> <address>`, `pine model list`, `pine model remove <name>` | Your own model servers. `--context <tokens>`, `--reasoning`, `--no-reasoning`. See [operations.md](operations.md), "With a model server of your own" |
| `pine update [--check] [--next \| --release]` | Updates pine. `--check` only looks; `--next` and `--release` pick what it follows. See [operations.md](operations.md), "Updating" |
| `pine version`, `pine --version` | The version and how pine is installed |
| `pine help`, `pine --help` | The list of commands |
| `pine browser-install` | Fetches the browser again |
| `pine check` | Validates the configuration and shows each agent's workspace, model, tools, MCP servers, mode and reach, model and security notes, and a missing browser. With a daemon running, also worktrees, including those no conversation holds |
| `pine start` | Runs the daemon in the foreground until Ctrl-C or SIGTERM |
| `pine service [--keep]` | Finds or starts this home's daemon for a UI program ("A UI of its own") |
| `pine list [--json] [--home dir]` | Shows which pine daemons are running on this computer, of every home: process number, how it started (`pine start`, `pine service`, a terminal UI), home, control API address, uptime. Not those in WSL or on another machine |
| `pine killall [--home dir]` | Stops every daemon `pine list` shows (SIGTERM, killed after 12 seconds; at once on Windows) |
| `pine kill <pid>` | Stops one of them by its process number. Refuses a number that is not a pine daemon |
| `pine dev-model [--port 7464] [--model haiku]` | A model server backed by `claude -p`, for working on pine. See [docs/dev/operations.md](../dev/operations.md) |
| `pine status` | Running tasks, live sessions (and whether tainted by outside content), model slots |
| `pine agents` | The agents as the daemon has them (JSON) |
| `pine agent list` | The agents, readable: purpose, model, reasoning, mode, reach, what each has. Needs no daemon |
| `pine agent add <id> [--description "..."] [--instructions "..." \| --instructions-file <file>] [--model provider/model] [--tools read,bash,...]` | Creates an agent like `create_agent`. `--description` becomes the first paragraph of its instructions |
| `pine agent update <id> [--color #rrggbb\|none] [--scroll top\|follow\|default] [--instructions ... \| --instructions-file <file>] [--soul ... \| --soul-file <file>] [--tooling ... \| --tooling-file <file>] [--model ...\|default] [--thinking ...] [--mode auto\|safe\|manual\|bypass\|plan\|default] [--tools read,bash,...] [--delegates id,id\|*] [--network \| --no-network] [--read /p,/p] [--write /p] [--forget /p]` | Updates an agent's settings, like `update_agent`; give only what changes. Without a daemon it edits the files; the model needs the daemon |
| `pine agent rename <id> <new-id>` | Gives an agent another id; everything that names it follows. Not while it works. See [setup.md](setup.md), "Renaming an agent" |
| `pine agent remove <id> [--keep-files] [--yes]` | Removes an agent and everything it has, after listing it and asking (`--yes` skips that). `--keep-files` moves its folder to `removed/`. See [setup.md](setup.md), "Changing and removing an agent" |
| `pine send <agent> <text...>` | Gives an agent a task as you and prints the answer. `--session <key>`, `--no-wait` |
| `pine emit <topic> [json]` | Publishes an event as you |
| `pine events` | The event log. `--topic <pattern>`, `--limit <n>` (30), `-f` to follow |
| `pine tasks` | Recent tasks. `--agent <id>`, `--status pending\|running\|done\|failed\|cancelled`, `--limit <n>` (20) |
| `pine task <id>` | One task in full: prompt, result, error, trust, statistics |
| `pine cancel <id>` | Stops a task |
| `pine state [pattern]` | Shared state |
| `pine sources` | Event sources: running or idle, subscribers, last event, last look of a polling source |
| `pine subscribe <agent> <source> [--session name \| --fresh] [--note text] [--throttle 5m] [--when json] [--separate]`, `pine unsubscribe <agent> <source> [--session name]` | Wakes an agent on a source's events, or stops. `--session`: one conversation; `--fresh`: a new one per event. See [sources.md](sources.md) |
| `pine subscribe --global <source> ...`, `pine unsubscribe --global <source>` | The same for every agent that can use the source |
| `pine approvals`, `pine approve <id> [--always]`, `pine deny <id>` | Answers approval requests; `--always` stops the question for that conversation |
| `pine reset <agent> [session]` | Starts a conversation over and clears its taint |
| `pine mode <agent> [auto\|safe\|manual\|bypass\|plan]` | Shows or sets an agent's mode. `bypass` and `plan` last until pine restarts; the others are saved |
| `pine mcp list [--offline]` | MCP servers, whom each is for, whether it connects |
| `pine mcp add <name> <url>`, `pine mcp add <name> -- <command...>` | Adds a remote or local server. `--agent <id>`, `--taints`, `--approve always\|tainted`, `--timeout <seconds>`, `--description <text>`, `--exposure <how>`. See [mcp.md](mcp.md) |
| `pine mcp remove <name> [--agent <id>]` | Removes a server |
| `pine mcp login <name>`, `pine mcp logout <name>` | Signs in to a remote server in the browser, or forgets its tokens |
| `pine skills` | Every skill, whom it is for, where it lies |
| `pine schedules` | Everything scheduled: for whom, when, the task |
| `pine manual <words>`, `pine manual --read <id>` | Searches this manual as agents do, or reads parts by id (commas). Alone, lists the parts |

## Which commands need a daemon

| Commands | Work on |
|---|---|
| From `pine status` to `pine mode` | The running daemon, through the control API on `127.0.0.1:7463` ([api.md](api.md)) |
| `pine agent` | The daemon if one runs, else the files |
| `pine mcp`, `pine model` | The files; a running daemon is told |
| `pine check`, `pine skills`, `pine schedules`, `pine manual` | The files |

## A UI of its own

A UI program (a desktop app, an editor plug-in) gets a daemon from `pine service`, as the Pine app
does, and then uses the control API. It prints one line:

```json
{"base":"http://127.0.0.1:7463","token":"...","mode":"embedded daemon","started":true,"home":"/Users/you/.pine","version":"0.22.2"}
```

| Finds | What it does |
|---|---|
| This home's daemon running | Says `"mode": "attached"`, `"started": false`, and ends |
| Nothing running | Starts the daemon inside itself (and the `claude -p` server for a `dev/` model), logs to `data/pine.log`, and stays while it runs |
| Another home on the port, no home, or a broken configuration | `{"error": "..."}` with what to do, exit code 1 |

A daemon it started stops on SIGTERM, SIGINT, or when its input closes, so start it with a pipe as
input and it never outlives your program. `--keep` ignores the input.
