# Commands

Every `pine` command, which of them need a running daemon, and how a program of its own gets one.
How to install and start pine: [operations.md](operations.md).

Every command takes `--home <dir>` (default `$PINE_HOME` or `~/.pine`).

| Command | What it does |
|---|---|
| `pine`, `pine tui` | The terminal UI; starts a daemon inside if none runs |
| `pine .`, `pine <folder>` | The terminal UI with a tab for a conversation of the main agent in that folder (the one from last time, if any). A word that is a command stays a command. See [coding.md](coding.md) |
| `pine --ssh <host> [folder]` | The terminal UI on another machine's pine, over SSH; the folder is one there. See [tui.md](tui.md#the-pine-of-another-machine) |
| `pine <folder> --worktree [name]` | A new conversation in a worktree of that folder's git repository, on a branch `pine/<name>`. See [coding.md](coding.md#a-worktree-for-a-conversation) |
| `pine init [dir] [--yes]` | Set up a home, the browser and, on Linux, the sandbox. Safe to run again |
| `pine login <provider>`, `pine logout <provider>` | Sign in to a model provider, or out. `--api-key` or `--oauth` choose the kind. `pine login typesafe` is for decision models ([configuration.md](configuration.md), "Decision models") |
| `pine model add <name> <address>`, `pine model list`, `pine model remove <name>` | Model servers of your own. `--context <tokens>`, `--reasoning`, `--no-reasoning`. See [operations.md](operations.md), "With a model server of your own" |
| `pine update [--check] [--next \| --release]` | Bring pine up to date; `--check` only looks, `--next` and `--release` choose what it follows. See [operations.md](operations.md), "Updating" |
| `pine version`, `pine --version` | The version and how it is installed |
| `pine help`, `pine --help` | The list of commands |
| `pine browser-install` | Fetch the browser again |
| `pine check` | Validate the configuration; show each agent's workspace, model, tools, MCP servers, mode and reach; list model notes and security notes; say when the browser is missing; with a daemon running, list worktrees, also those no conversation holds |
| `pine start` | Run the daemon in the foreground. Ctrl-C or SIGTERM stops it cleanly |
| `pine service [--keep]` | Find this home's daemon or start one, for a UI that is a program of its own. See "A UI of its own" |
| `pine list [--json] [--home dir]` | The pine daemons running on this computer, of every home: process number, how it was started (`pine start`, the Pine app's `pine service`, a terminal UI with the daemon inside), home, control API address, uptime. Not one in WSL or on another machine |
| `pine killall [--home dir]` | Stop every daemon `pine list` shows (SIGTERM; killed after 12 seconds; at once on Windows) |
| `pine kill <pid>` | Stop one of them, by its number. A number that is not a pine daemon is refused |
| `pine dev-model [--port 7464] [--model haiku]` | A model server backed by `claude -p`, for working on pine ([docs/dev/operations.md](../dev/operations.md)) |
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

## Which commands need a daemon

| Commands | Work on |
|---|---|
| From `pine status` to `pine mode` | The running daemon, through the control API on `127.0.0.1:7463` ([api.md](api.md)). Without one they say so |
| `pine agent` | The daemon when one runs, else the files |
| `pine mcp`, `pine model` | The files; a running daemon is told |
| `pine check`, `pine skills`, `pine schedules`, `pine manual` | The files |

## A UI of its own

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
