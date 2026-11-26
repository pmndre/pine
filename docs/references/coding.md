# Working on code

How to work on a project in a conversation: open a **folder** for it, give it a **worktree** of
its own, watch what changes in the **code pane**, run long commands in the background, and take a
message back with `/undo`, files included.

```bash
cd ~/dev/shop
pine .
```

![The code pane beside a conversation, showing the diff of a file the agent changed](../images/code.png)

## A folder for a conversation

A conversation can be given a folder of yours (a repository, a project) on top of the agent's
own workspace. From its next message on:

- the agent's shell and file tools start in that folder (relative paths mean paths there),
- it may read and change what is in it, like its own workspace,
- the folder's `AGENTS.md` or `CLAUDE.md` apply next to the agent's own,
- the agent is told which folder it works in.

Nothing else changes: in the sandbox (`safe`, `manual`) the rest of your home and the network
stay closed unless you open them, and the mode decides what is asked. An agent in `auto` (the
main agent by default) reaches your account anyway; the folder makes its tools start there and
applies the folder's instruction files.

The folder belongs to that conversation alone. Its sub-agents have it, and so does another
agent for one task handed over from this conversation (`delegate` without a thread); other
conversations do not. It stays across restarts and renames until you close it or remove the
conversation.

| How | |
|---|---|
| `pine .`, `pine <folder>` | The terminal UI with one more tab: a conversation of the main agent named after the folder, or the one that already works there |
| The folder in the bottom bar | A list: no folder, this conversation's folder, where pine was started (unless that is your home folder), folders other conversations of this agent use, and "Pick a folder …" (the system's chooser, on macOS) |
| `/folder <path>`, `/folder none` | The same by command (`off` and `-` mean `none`); `/folder` alone opens the list |
| A folder dropped on the terminal | Becomes the folder of the conversation in front (a file dropped there is attached) |
| The Pine app | The folder in the conversation's header ([desktop.md](desktop.md)) |

![The folder menu over a conversation that works in a project folder](../images/folder.png)

Only you open a folder: there is no tool for it, so no agent and nothing an agent reads can. A
folder is refused when it is, contains or lies in pine's home (your home folder contains
`~/.pine`), pine's own program, or another agent's workspace. It cannot be changed while the
conversation is working, nor while it works in a worktree (merge or discard that first).

For a project an agent always works in, set `workspace` in its `agent.json` ([agents.md](agents.md#workspaces)).

## A worktree for a conversation

Conversations or sub-agents that work in the same repository at the same time write over each
other's files, and an undo in one restores what another wrote. Give each a **worktree**: a
checkout of the repository of its own, on a branch of its own, sharing its history. What one
changes is not in the folder or another worktree until you merge it.

pine makes it at `.pine/worktrees/<name>` at the top of the repository, on a new branch
`pine/<name>`, from the last commit of what the folder has checked out; what is not committed
stays in the folder. `.pine` holds a `.gitignore` of `*`, so git does not list it. The
conversation then works in the same subfolder of the worktree.

| | |
|---|---|
| `/worktree [name]` | Moves the conversation into a new worktree of its folder's repository. In one already: where it stands, and merge, squash, update, ask the agent to commit, discard. The bottom bar shows `⎇ pine/<name>`, a click opens the same list, and the code pane says how far it is ahead and behind |
| `/new --worktree [name]` | A new conversation in a worktree of the folder of the one in front |
| `/branch --worktree [name]` | Branches the conversation into a worktree ([agents.md](agents.md#branching-a-conversation)) |
| `pine <folder> --worktree [name]` | The terminal UI with a new conversation in a worktree of that folder |
| `.worktreeinclude` | A file at the top of the repository, in `.gitignore` patterns (the same file Claude Code reads): the files it names that git ignores (`.env`, local settings) are copied into a new worktree. Never a tracked file or a link; at most 200 files of 1 MB each |
| `worktree` of `subagent` and `delegate` | `true`: each sub-agent (or the agent the task goes to) works in a worktree of its own made from the conversation folder's last commit. When it is done its changes are committed on a branch (`pine/<conversation>-sub`, `-sub-2`, ...), its folder is removed, and the conversation is told the branch to `git merge`. One that changed nothing leaves nothing |

The Pine app has the same ([desktop.md](desktop.md)). A folder or worktree changed in one UI shows
in the other by itself.

Making, merging, updating and discarding are yours: no agent has a tool for them.

### Merging, updating, discarding

| | |
|---|---|
| Merge | The worktree's commits go into the branch it was made from: a fast-forward when that has not moved, else a merge commit. Only what is committed: with changes that are not, pine offers to ask the agent to commit |
| Squash | The same as one commit |
| Update | What the base got since comes into the worktree as a merge commit |
| Discard | The worktree's folder and branch go, and the conversation works in its folder again. "Discard, keep the branch" keeps the branch. With unmerged commits or uncommitted changes you are asked first |

A merge is worked out before any file is touched: on a conflict nothing changes and pine names
the files both sides changed. Where the base branch is checked out (usually your folder) its
files move with it, and git refuses when that would overwrite a change of yours. A merge waits
while a conversation in that folder is working. When an update conflicts, ask the agent to merge
the base itself and settle it, then merge.

A worktree stays with its conversation through a rename or a reset. When the conversation is
removed, a fully merged worktree goes with it; one that holds work stays, and `pine check` (with
the daemon running) and `GET /worktrees` list it as nobody's: remove it with
`git worktree remove --force` and `git branch -D`. pine forgets a worktree whose folder you
removed by hand.

### What a worktree does not do

- Merging and updating run git with hooks, filters and merge drivers off: Git LFS files arrive
  as pointers, a file with a merge driver of its own counts as a conflict, and pine's commits
  are not signed.
- Installed packages (`node_modules`) are not copied; the agent installs them when it needs them.
- Tools that read the whole repository without asking git (a test runner, a type checker, a file
  watcher) may see `.pine/worktrees`: exclude `.pine` in their settings.
- A repository whose git folder is not a `.git` folder at its top (a bare one, `--separate-git-dir`)
  gets none, nor does one without a commit.
- Without a sandbox (`auto`, `bypass`) a worktree keeps conversations apart only by where their
  tools start. In the sandbox it is enforced ([security.md](security.md), "Worktrees").

## The code pane

`▤ code` at the right of the tab bar, `ctrl+g` or `/code` opens and closes a pane beside the
conversation. It shows the conversation's folder, or the agent's workspace. In a terminal of 100
columns or more it takes half the width; in a narrower one it takes the conversation's place
until closed.

```
 pine  1 ★ main ×  2 main·shop ×   +                                                ▤ code
───────────────────────────────────────────────────────────────────────────────────────────
 make the total include shipping          │  Changes  Files  Output  Running  Board    ↻  ×
                                          │ main · 2 changed · ~/dev/shop
 ✓ edit src/cart.ts 12 ms                 │─────────────────────────────────────────────────
 ✓ bash npm test 2.1 s                    │ M src/cart.ts  +4 −1
                                          │ + src/shipping.ts  +12
 The total now includes shipping ...      │
```

| View | Shows | A click |
|---|---|---|
| **Changes** (`/code changes`) | What differs from the last commit: changed (`M`), added (`A`), new (`+`), deleted (`D`), renamed (`R`), with lines added and removed, and the branch. Its first line switches to **by your last message** (`/code turn`): what your last message changed, which is what `/undo` would restore | on a file: its diff, added lines green, removed red; `‹ back` returns |
| **Files** (`/code files`) | The folder as a tree | on a folder: opens or closes it; on a file: its text with colors, or a picture |
| **Output** (`/code output`) | Every tool call of the conversation's last 8 messages, newest first: the tool, its arguments, how long it took | on a call: everything it printed |
| **Running** (`/code running`) | What the conversation's commands left running, with command, ports and how long; a background command with its output file | `■ stop` ends it |
| **Board** (`/code board`, `/board`) | The conversation's board, then up to six named boards it can use: how their tasks stand, who has each, the notes ([boards.md](boards.md)) | on a task: it in full |

The pane follows the agent: after each tool call it reads again. `↻` reads again by hand, `×`
or `/code off` closes. The wheel scrolls the side the pointer is over. While the agent works,
its list of steps stands at the top of the pane.

Apart from `■ stop` the pane only shows: it changes no file, runs nothing of the project and
sends nothing to a model. Limits: a file up to 256 KB, a diff up to 200 000 characters, a tool's
output up to 200 000 characters and 4000 lines; binary files are only named. Changes lists the
first 300 files, Files up to 500 entries of a folder.

## Commands in the background

A shell command is waited for and stopped at the time limit (`bashTimeoutSec`). For a long
build, a test run, an install or a development server the agent sets `background` on its shell
tool: the command starts, the call returns at once, the agent goes on working, and pine tells
the conversation when the command has ended.

| Name | What it does |
|---|---|
| `background` | An argument of the `bash` tool. `true`: start the command and return at once with its id and the file its output goes to. The time limit does not apply. pine tells the conversation when it has ended |
| `timeout` | An argument of the `bash` tool: how many seconds a command that is waited for may take, never more than `bashTimeoutSec`. A command that reaches it is stopped, and the agent is told to start it again with `background: true` |
| `stop_program` | The agent's tool: ends a background command by its id; without an id it lists what runs, with each output file |

- It runs in the same sandbox and folder as every other command of that conversation. A server
  that must be reached needs network access there (see "What an agent left running").
- Its output goes to `sandbox/<agent>/tmp/background/` in pine's home, which the agent reads
  with its file tools, also while it runs. pine does not delete these files.
- When it ends, the conversation gets a message from pine, not from you: the id, the command,
  how it ended (exit code, signal, or that you stopped it), how long it ran, and its last lines,
  marked as output. Commands that end close together, or while the agent works, are told in one
  message. If the conversation had read outside content when the command started, this message
  counts as outside content too.
- A command that ends but leaves a program running is told as ended, and the program is listed
  under Running.
- `■ stop` in the code pane ends it, and the agent is told you stopped it.
- Resetting or removing the conversation ends its background commands without a message.
  Quitting pine does not: at the next start a running one is watched again, and one that ended
  meanwhile is told at once.

At most 8 commands of a conversation run in the background at once. A sub-agent can start them,
and its conversation is told. Not available to a run an outside event started, nor to a single
run with no conversation of yours to tell (the session `new`, a task handed over without a
thread). On Linux a conversation that has read outside content cannot either
([security.md](security.md), "On Linux").

## What an agent left running

An agent that starts a server with `npm run dev &` instead of `background` leaves it running.
pine finds what is still running after a command has ended, whatever the agent says.

- **Running** in the code pane lists it; `■ stop` ends it (after a question; killed two
  seconds later if it is still there).
- The agent is told in its next message what it left running and on which ports, and ends one
  with `stop_program`: ask it to "stop the servers you started".
- While the agent's turn is over and something runs, the status line says so, so a long install
  does not look like a hang.
- Resetting or removing the conversation stops what it left running. Quitting pine does not:
  they are listed again at the next start. `/undo` does not stop them either.

A program that detaches itself completely (a daemon with a session of its own) is not found. On
Linux in the sandbox nothing outlives its command: start a server in the background.

**A server that must be reached.** In the sandbox (`safe`, `manual`) a command has no network:
it cannot listen on a port you or the browser can reach (on Linux it has a network of its own).
The agent asks with `request_access` and `network: true` (a yes holds for the conversation), or
`sandbox.network: true` in its `agent.json` gives it always ([configuration.md](configuration.md)).
In `auto` and `bypass` nothing is needed.

## Taking a message back

`/undo` takes back your last message in a conversation, with everything it led to:

1. What still runs for it is stopped: the agent's work, its sub-agents, what it handed to other
   agents for that message.
2. The files of the conversation's folder (or the agent's workspace) go back to how they were
   before the message.
3. The conversation forgets the message and everything after it.
4. The message's text is back in the input, to change and send again.

`/undo` again takes back the one before. `/redo` brings back what the
last `/undo` took, files and conversation, one message at a time, until a new message is sent.

| Command | What it does |
|---|---|
| `/undo` | Take back your last message, its work and the files it changed |
| `/redo` | Bring back what the last `/undo` took. Works until a new message is sent |
| `/code turn` | Show what your last message changed in the folder: what `/undo` would restore |

The conversation says what happened:

```
 ↶ taken back: “make the total include shipping”
   2 files restored in ~/dev/shop (1 changed back, 1 removed): src/cart.ts, src/shipping.ts
   not undone: changes made outside this folder, files git ignores, files over 2 MB, and anything that was sent out
   what you wrote is back in the message box: edit it and send it again
   /redo restores it until you send something new
```

### What is restored, and what is not

pine records the folder before the first tool call of a message and when its work ends (a
message that is only answered records nothing; the first record of a large folder takes a
moment). An undo sets back only the files that differ between the two, so what you changed
elsewhere since stays. Whatever changed in the folder while the message was worked on counts as
its work, whoever changed it. These snapshots are kept in pine's home (`data/snapshots`); your
repository, its index and history are never touched, and a folder that is not a repository works
the same.

Not recorded, so never restored:

- files the folder's ignore rules leave out (its `.gitignore` files, those above it in the
  repository, `info/exclude`; not your global ignore file): `node_modules`, build output;
- files over 2 MB (the undo names them);
- a git repository inside the folder (a clone, a submodule);
- anything, when more than 50 000 files or 512 MB are new or changed at once: no file is
  restored and the undo says so; the conversation is taken back all the same.

Never taken back:

- what commands did outside the folder: a package installed for your account, a file elsewhere,
  a row in a database;
- commits, branches and anything else in `.git`;
- anything sent out: a message, a web request, an event;
- what the agent set up in pine (a source, a schedule, an MCP server, a skill): ask it to remove
  that, or remove it yourself.

What the conversation was allowed while the message was worked on goes with it: an "always" in
an approval, access from `request_access`, and the outside-content mark if this message brought
it in. A redo brings them back.

Only you undo, in a UI or through the control API; no agent has a tool for it. What an outside
event started is not your message and is not taken back. A message still waiting behind another
is withdrawn.

Recording needs git and pine's sandbox (macOS, or Linux with bubblewrap); without them an undo
takes back the conversation and says no file was restored. The last 40 messages of a
conversation can be undone.

## What it is safe against

- **Looking runs nothing.** The pane runs git in a sandbox that writes nothing and has no
  network, with diff drivers, text converters, hooks and file system monitors off.
- **Nothing outside the folder.** Paths are resolved with their links and must stay inside; a
  link that leads out is neither listed nor opened.
- **An undo writes the folder and nothing else.** git puts the files back in a sandbox that can
  write only the folder and pine's record, without network, reading neither the folder's git
  settings nor yours, so no hook, filter or line-ending rule applies. Nothing is written through
  a link.
- **The folder is for your conversation.** A run an outside event started works in the agent's
  own workspace, not in the folder ([security.md](security.md)).
- **Instruction files, hooks and git configuration.** `AGENTS.md` and `CLAUDE.md` of an opened
  folder are instructions to the agent: open folders whose authors you trust with your agent.
  `.git/hooks` and `.git/config` run with your rights the next time you use git there. Once a
  conversation has read outside content its file tools no longer change any of these, and in
  `safe` and `manual` mode the sandbox refuses a shell command that writes them too; in `auto`
  nothing checks a shell command for them. It can still commit and branch.

## From a script

The control API has all of it; the routes are listed in [api.md](api.md). Those whose details are here:

| Request | Purpose |
|---|---|
| `POST /agents/<id>/view/write` `{ session?, path, text }` | Write a file of the conversation's folder: what an editor in a UI saves. Path from the conversation's folder, at most 2 MB of text; a missing file is made, a missing folder is not. The new text replaces the old file with its rights, inside a sandbox that can write that folder only, so a link left there changes nothing outside. A path that leads out is refused, and so is every write on a system without a sandbox |
| `POST /agents/<id>/view/files` `{ session?, op, path?, to?, paths?, into? }` | What the Pine app's file tree does: make (`folder`, `file`: `path`), rename (`path` to `to`), copy or move (`paths` into the folder `into`, `""` its top), delete (`paths`). Nothing is put where something is: a copy gets a free name. A link is acted on as itself. In an agent's workspace its `AGENTS.md`, `SOUL.md`, `TOOLS.md` and `MEMORY.md` are not deleted, moved or renamed |
| `POST /agents/<id>/undo` `{ session }`, `POST /agents/<id>/redo` `{ session }` | Undo or redo. The answer has the message's text (`prompt`; with quotes also `quotes`, each `{ text, source, reply? }`, and `body`, the text without them), what was restored (`restored`: `root`, the counts `changed`, `removed`, `back`, the first `files`, and `left` for files too large to record), a `note` when no file was restored, `stopped`, how many messages a redo can bring back (`redo`), and whether there is another to take back (`more`) |
| `GET /agents/<id>/view/find?session=&q=`, `/view/grep?session=&q=` | Files of the conversation's folder whose name fits a few letters (what `@` offers), or whose text holds some words (case ignored), each with its first matching line |
| `GET /tasks/<id>/transcript?full=1` | A task's steps with the whole output of each tool call |
