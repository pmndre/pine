# Working on code: how it works inside

For contributors. What an owner or an agent needs is in `docs/references/coding.md`; this file is
not indexed by the `manual` tool.

| Part | Where |
|---|---|
| A conversation's folder | `setFolder`, `folderProblem` in `src/agents.ts` (kv `folder:<agent>:<session>`), reached from the control API only |
| The code pane's reads | Width in the terminal UI: half the terminal, 44 to 96 columns (`src/tui/app.ts`). `src/workspace-view.ts`: `git` behind `helperArgv()`, no write access, no network, everything a repository's configuration could start turned off. Changes lists 300 files, a folder 500 entries, a file 256 KB (2 MB for an editor), a diff 200 000 characters |
| Editor writes and file tree changes | `writeText` / `putInto` and `changeFiles` / `inFolder` in `src/workspace-view.ts`, behind `helperArgv([folder])` |
| Worktrees | `src/worktrees.ts`: `.worktreeinclude` at most `MAX_INCLUDED` = 200 files of 1 MB; merges and updates replace every filter and merge driver (`neutral`); commits with `--no-gpg-sign`, `--no-verify` |
| What was left running | `src/programs.ts`: `Programs.note` per command, `stop` sends SIGTERM, then SIGKILL after 2 s |
| Background commands | `Programs.start` (`WATCH` shell, `MAX_BACKGROUND` = 8), output in `<sandbox home>/tmp/background/<token>.log`; the agent's texts in `src/background.ts` (`startedText`, `TIMEOUT_HINT`, `endedNotice`, `backgroundRefused`) |
| Undo | `src/undo.ts` (`KEEP_TURNS` = 40 messages undoable, `KEEP_UNDONE` = 20 redoable) and `src/snapshots.ts`: the records are git trees in a git directory of pine's own under `data/snapshots`, written by git in a sandbox that can write only that directory and the folder; a folder swapped for a link is made a folder again (`MAX_FILE` 2 MB, 50 000 files or 512 MB a state; unreferenced states pruned after 3 days by `git gc`) |

Undone messages stay in the conversation's pi session file on disk, unused and not shown to the
model, until the conversation is reset or removed (`rewind()` appends a `pine-undo` entry at the
point it went back to).

Tests: `test/worktrees.test.ts`, `test/programs.test.ts`, `test/background.test.ts`,
`test/undo.test.ts`.
