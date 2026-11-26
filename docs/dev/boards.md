# Boards: how it works inside, and what was measured

For contributors. What an owner or an agent needs is in `docs/references/boards.md`; this file is
not indexed by the `manual` tool.

## Where it lives

- `src/boards.ts`: the tables, `boardName()`, claims, `settle`, `answer`, `rework()` (a failed
  check gives its work out again, `MAX_REWORK` 1), `MAX_FAILED_FINALS` (3), `verdictOf()` (PASS or
  FAIL on a line of its own, the last such line counts), `asksAtEnd()` (an answer whose last line
  is a question is settled as blocked). Limits: `TASK_CHARS`, `RESULT_CHARS` 4000, `NOTE_CHARS`
  2000, `JOB_NOTE_CHARS` 8000, `LONG_TASK_CHARS` 16 000 (the swarm's check of the answer),
  `MAX_ITEMS` 500, `MAX_BOARDS` 200. `board_post` cuts a longer task or note; a pool call refuses it.
- `src/tools.ts`: the board tools, `workPool`, `shown()` (every place that hands board text to a
  model marks the run; rule 14 in `AGENTS.md`).
- `src/agents.ts`: `boardsAfter` (settles or reopens what a run held when it ends), `boardChanged`
  (the `pine/board` event for UIs, the `board/<name>/...` events for routes), `boardBrief`,
  `boardAct`, `boardRemove`, `startBoardTask`, retries of a sub-agent the server refused for now
  (`MAX_RETRIES` 2, `retryPauseMs` 4000 times the try).
- `src/swarm.ts`: the swarm. `MAX_CHECKS` 2; the check task quotes the lead's answer up to 12 000
  characters, else its first and last 6 000 (`excerpt`).
- `src/actions.ts`: `board_post`, `board_claim`, `board_done`, `board_answer` are `look` on the
  conversation's own board and `local` with `board`; `board_remove` is always `local`.

## The benchmark

`.scratch/swarm-bench` (local, not in git) runs 18 jobs three ways: without boards (plain
`subagent`), with boards after a normal message, and as a swarm. Each job twice, on Claude Haiku
5.5 with four sub-agents at a time, scored against known answers.

| Jobs | Without boards | With boards, normal message | As a swarm |
|---|---|---|---|
| One agent is enough (11) | 98.8%, 162 s | 98.8%, 158 s (no board used) | 99.4%; answer at 192 s, check done at 289 s |
| Must be right, or something only the owner knows (4) | 94.3%, all parts right in 63% of runs, 150 s, 3.5 ¢ | all right in every run, 140 s, 4.2 ¢ | all right in every run, 145 s, 3.7 ¢ |
| Many pieces (24, 60, 100 folders) | 80.1%, 67% of runs, 340 s, 7.8 ¢, up to 28 calls | all right, 203 s, 7.2 ¢, one call each | all right, 289 s, 9.0 ¢ |
| All 18 | 94.7%, 78% of runs, 651 s, 13.9 ¢ | 99.3%, 92%, 501 s, 13.8 ¢ | 99.6%, 94%, 722 s, 17.0 ¢ |

- The swarm's check over 252 swarms: 276 checks, 27 failed the first answer; 22 found something
  real, 5 were false alarms. On answers with one planted error it failed 36 of 36 and passed 15 of
  16 correct ones.
- A check on the same model passed two answers that model misread every time (4 of 4); with
  another model as `defaults.checker` both failed 4 of 4, and every part of every job was right in
  all 72 runs, at 76 ¢ a round instead of 14 to 17.
- Blind judges (a larger model) rated results 7.9, 8.6, 8.6 of 10 and efficiency 7.5, 8.1, 7.9
  (without, with boards, swarm).
- Boards cost about 1 000 tokens per request for their declaration (an eighth of pine's tools);
  a pool's sub-agent gets about 150 tokens with its task.
