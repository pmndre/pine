# Working on code

A conversation can work in a **folder** or a **worktree** of yours. The **code pane** shows what
changes, and `/undo` takes a message back, files included.

```bash
cd ~/dev/shop
pine .
```

![The code pane beside a conversation, showing the diff of a file the agent changed](../images/code.png)

## A folder for a conversation

You can give a conversation a folder of yours (a repository, a project) besides the agent's own
workspace. From the next message on, the agent's shell and file tools start there, and it may read
and change the folder. The folder's `AGENTS.md` or `CLAUDE.md` apply next to the agent's own.

Nothing else changes: in the sandbox (`safe`, `manual`) the rest of your home and the network stay
closed, and in `auto` the agent reaches your account anyway. The folder belongs to that conversation, its sub-agents, and another agent doing one task
handed over from it (`delegate` without a thread). It stays through restarts and renames until you
close it or remove the conversation.

| How | |
|---|---|
| `pine .`, `pine <folder>` | The terminal UI with a tab for the main agent's conversation in that folder (new, or the one already there) |
| The folder in the bottom bar | A list of folders to switch to, and "Pick a folder …" (macOS) |
| `/folder <path>`, `/folder none` | The same by command (`off` and `-` mean `none`). `/folder` alone opens the list |
| A folder dropped on the terminal | Becomes the folder of the conversation in front (a dropped file is attached) |
| The Pine app | The folder in the conversation's header ([desktop.md](desktop.md)) |

![The folder menu over a conversation that works in a project folder](../images/folder.png)

Only you open a folder; no agent has a tool for it. pine refuses a folder that is, contains or lies
in pine's home (your home folder contains `~/.pine`), pine's own program, or another agent's
workspace. You can't change it while the conversation is working or in a worktree.

For a project an agent always works in, set `workspace` in its `agent.json` ([agents.md](agents.md#workspaces)).

## A worktree for a conversation

Conversations or sub-agents in the same repository at the same time write over each other's files,
and an undo in one restores what another wrote. Give each a **worktree**: its own checkout on its
own branch, sharing the history. Its changes stay out of the folder until you merge them.

pine makes it at `.pine/worktrees/<name>` (git ignores `.pine`) on a new branch `pine/<name>`, from
the last commit the folder has checked out. Uncommitted changes stay in the folder. The conversation
works in the same subfolder of the worktree.

| | |
|---|---|
| `/worktree [name]` | Moves the conversation into a new worktree. In one already: merge, squash, update, ask the agent to commit, discard. The bottom bar shows `⎇ pine/<name>`, and the code pane how far it is ahead and behind |
| `/new --worktree [name]`, `/branch --worktree [name]`, `pine <folder> --worktree [name]` | A new conversation, or a branch of this one ([agents.md](agents.md#branching-a-conversation)), in a worktree |
| `.worktreeinclude` | A file at the top of the repository in `.gitignore` patterns (as Claude Code reads it). The ignored files it names (`.env`) are copied into a new worktree: no tracked files or links, at most 200 files of 1 MB |
| `worktree` of `subagent` and `delegate` | `true`: each sub-agent (or delegated agent) works in its own worktree. pine commits its changes on a branch (`pine/<conversation>-sub`, `-sub-2`, ...), removes its folder, and names the branch to `git merge` |

The Pine app has the same ([desktop.md](desktop.md)). Only you make, merge, update and discard
worktrees; no agent has a tool for them.

### Merging, updating, discarding

| | |
|---|---|
| Merge | The commits go into the branch the worktree came from (a fast-forward, else a merge commit). Uncommitted work stays; pine offers to ask the agent to commit it |
| Squash | The same, as one commit |
| Update | The base's new commits come into the worktree as a merge commit |
| Discard | The folder and branch go ("Discard, keep the branch" keeps it). pine asks first if work is unmerged |

On a conflict nothing changes, and pine names the files both sides changed. Where the base branch is
checked out (usually your folder), its files move with it, and git refuses to overwrite a change of
yours. A merge waits while a conversation in that folder works. When an update conflicts, ask the
agent to merge the base and settle it.

A worktree stays through a rename or a reset. When you remove the conversation, a merged worktree
goes with it. One that holds work stays, listed as nobody's by `pine check` (daemon running) and
`GET /worktrees`; remove it with `git worktree remove --force` and `git branch -D`. pine forgets a
worktree whose folder you removed.

### What a worktree does not do

- Merging and updating run git with hooks, filters and merge drivers off: Git LFS files arrive as
  pointers, a file with its own merge driver counts as a conflict, and commits are not signed.
- `node_modules` is not copied. The agent installs packages when it needs them.
- Tools that read the repository without git (test runners, file watchers) may see
  `.pine/worktrees`. Exclude `.pine` there.
- A repository without a commit, or whose git folder is not a `.git` folder at its top, gets none.
- Without a sandbox (`auto`, `bypass`), a worktree keeps conversations apart only by where their
  tools start ([security.md](security.md), "Worktrees").

## The code pane

`▤ code` at the right of the tab bar, `ctrl+g` or `/code` opens a pane beside the conversation with
its folder (or the agent's workspace). It takes half a terminal of 100 columns or more, else the
whole width. It reads again after each tool call; `↻` reads by hand, `×` or `/code off` closes it.

| View | Shows | A click |
|---|---|---|
| **Changes** (`/code changes`) | Files that differ from the last commit (`M`, `A`, `+`, `D`, `R`), with lines added and removed. **by your last message** (`/code turn`): what `/undo` would restore | a file's diff |
| **Files** (`/code files`) | The folder as a tree | a file's text, or a picture |
| **Output** (`/code output`) | Tool calls of the last 8 messages, newest first | everything it printed |
| **Running** (`/code running`) | What the conversation's commands left running, with ports | `■ stop` ends it |
| **Board** (`/code board`, `/board`) | The conversation's board and up to six named ones ([boards.md](boards.md)) | a task in full |

Apart from `■ stop` the pane only shows: it changes no file, runs nothing of the project and
sends nothing to a model. Limits:
a file 256 KB, a diff 200 000 characters, a tool's output 200 000 characters and 4000 lines, 300
changed files, 500 entries of a folder. Binary files are only named.

## Commands in the background

pine stops a shell command at the time limit (`bashTimeoutSec`). For a long build, a test run, an
install or a dev server, the agent sets `background` and goes on working. pine tells the
conversation when the command has ended.

| Name | What it does |
|---|---|
| `background` | `bash` argument. `true`: returns at once with the command's id and output file; no time limit |
| `timeout` | `bash` argument: seconds a waited-for command may take, at most `bashTimeoutSec`. When it runs out, pine tells the agent to use `background: true` |
| `stop_program` | Ends a background command by id. Without an id it lists what runs |

- It runs in the conversation's sandbox and folder. Its output goes to
  `sandbox/<agent>/tmp/background/` in pine's home, which the agent can read; pine keeps the files.
- When it ends, a message from pine (not from you) gives the id, the command, how it ended, how long
  it ran, and its last lines. Commands that end close together share a message. It counts as
  outside content if the conversation had read some when the command started.
- `■ stop` in the code pane ends it, and the agent is told. A command that ends but leaves a program
  running counts as ended; the program shows under Running.
- Resetting or removing the conversation ends its commands silently. After a restart of pine, pine
  watches them again and reports one that ended meanwhile.

At most 8 run at once per conversation. A sub-agent can start them. A run started by an outside
event can't, nor can a run with no conversation of yours (the session `new`, a task handed over
without a thread), nor on Linux a conversation that has read outside content
([security.md](security.md), "On Linux").

## What an agent left running

An agent that starts a server with `npm run dev &` leaves it running. pine finds what still runs
after a command has ended:

- **Running** in the code pane lists it. `■ stop` ends it after a question (killed after two
  seconds).
- The agent is told in its next message, with the ports, and ends it with `stop_program` ("stop the
  servers you started").
- The status line shows it while the agent is idle.
- Resetting or removing the conversation stops it. Quitting pine and `/undo` don't; after a restart
  it is listed again.

pine misses a program that detaches completely (a daemon with its own session). On Linux in the
sandbox nothing outlives its command: use `background`.

In the sandbox (`safe`, `manual`) a server can't listen on a port you or the browser reach (on
Linux it has a network of its own). The agent asks with `request_access` and `network: true` (yes
holds for the conversation), or `sandbox.network: true` in `agent.json` gives it always
([configuration.md](configuration.md)). `auto` and `bypass` need nothing.

## Taking a message back

`/undo` takes back your last message: pine stops its work (sub-agents and delegated tasks too),
puts the folder's files (or the workspace's) back as they were, the conversation forgets the
message and what came after, and its text is back in the input.

To go further back at once, rewind to an earlier message of yours: in the Pine app, the rewind
button under that message (shown when the pointer or the focus is on it). That message and every
later one are taken back together, newest first, as that many undos would: files, answers, and
what each brought (the outside-content mark, approvals, access) are as they were before it, and
its text is back in the input. `/redo` then brings them back one at a time, that message first.

| Command | What it does |
|---|---|
| `/undo` | Take back your last message, its work and its file changes. Again: the one before |
| `/redo` | Bring back what `/undo` took, one message at a time, until you send a new one |
| `/code turn` | Show what your last message changed: what `/undo` would restore |

### What is restored, and what is not

pine records the folder before a message's first tool call and when its work ends. An undo sets
back only the files that differ between the two, whoever changed them, so your later changes
elsewhere stay. The records are in `data/snapshots` in pine's home; your repository and its history
are never touched, and a folder that is not a repository works too.

Not restored:

- files the folder's ignore rules leave out (`node_modules`, build output; its `.gitignore` files
  and `info/exclude`, not your global one), and files over 2 MB (the undo names them);
- a git repository inside the folder (a clone, a submodule);
- anything, when more than 50 000 files or 512 MB changed at once (the conversation is still taken
  back);
- what commands did outside the folder (a package installed, a database row);
- commits, branches and anything else in `.git`;
- anything sent out (a message, a web request, an event);
- what the agent set up in pine (a source, a schedule, an MCP server, a skill).

An undo also takes back what the message brought: an "always" in an approval, access from
`request_access`, and the outside-content mark. A redo brings them back.

Only you undo, in a UI or through the control API, and only your own messages, not what an outside
event started. A message still waiting is withdrawn. Recording needs git and pine's sandbox (macOS,
or Linux with bubblewrap); without them only the conversation is taken back. The last 40 messages
can be undone.

## What it is safe against

The code pane's git runs in a sandbox without writes or network, with diff drivers, hooks and file
system monitors off. Paths stay inside the folder; a link that leads out is not followed. An undo
writes the folder through git in a sandbox that can write only the folder and pine's record, with no
git settings, hooks or filters, and never through a link. A run started by an outside event works
in the agent's own workspace, not in the folder ([security.md](security.md)).

An opened folder's `AGENTS.md` and `CLAUDE.md` are instructions to the agent, and `.git/hooks` and
`.git/config` run with your rights next time you use git there: open only folders you trust. After
outside content, the file tools can't change these files, and in `safe` and `manual` mode neither
can a shell command. In `auto` nothing checks a shell command for instruction files, but a command
that names a hook or `.git/config` asks you ([security.md](security.md), "4. Taint and approvals").
The conversation can still commit and branch.

## From a script

The routes are in [api.md](api.md). Details of three:

| Request | Purpose |
|---|---|
| `POST /agents/<id>/view/write` `{ session?, path, text }` | Saves a file of the conversation's folder, as an editor does: at most 2 MB, into a folder that exists, keeping the file's rights. A sandbox lets it write only that folder, so a link changes nothing outside. Refused for a path that leads out, and on a system without a sandbox |
| `POST /agents/<id>/view/files` `{ session?, op, path?, to?, paths?, into? }` | The Pine app's file tree: make (`folder`, `file`: `path`), rename (`path` to `to`), copy or move (`paths` into `into`, `""` for the top), delete (`paths`). A copy never overwrites; it gets a free name. A link is acted on as itself. An agent's `AGENTS.md`, `SOUL.md`, `TOOLS.md` and `MEMORY.md` can't be deleted, moved or renamed |
| `POST /agents/<id>/undo` `{ session, to? }`, `POST /agents/<id>/redo` `{ session }` | `to`: the number of one of your messages, to take it back with every later one (`taken` says how many; `stopped` and `restored` count over all of them). Answers with the message's text (`prompt`; with quotes also `quotes` of `{ text, source, reply? }` and `body`), `restored` (`root`, `changed`, `removed`, `back`, the first `files`, `left` for files too large), a `note` when no file was restored, `stopped`, `redo` (how many can come back) and `more` |
