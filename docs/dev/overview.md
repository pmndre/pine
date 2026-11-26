# Inside the daemon

For contributors and for programs that are a UI of their own. What an owner or agent needs is in
[references/overview.md](../references/overview.md); the code layout is in the repository's
`AGENTS.md`, "Layout".

```
      what wakes an agent                       the daemon                        model server
┌────────────────────────────────┐   ┌──────────────────────────────┐      ┌──────────────────┐
│ event sources                  │   │  event log (SQLite)          │      │ llama-server or  │
│  telegram  a bot, long polling │──►│  topic · payload · trust     │      │ any OpenAI-style │
│  mqtt      a broker            │   │        │                     │      │ endpoint         │
│  folder    new, changed files  │   │        ▼                     │      └────────▲─────────┘
│  webhook   calls from services │   │  subscriptions, schedules    │               │
│  ftp       uploads             │   │  with a task, and routes     │               │ model slots
│  http      an address, polled  │   │   when · debounce · throttle │               │ (priority queue)
│  command   run again and again │   │        │                     │               │
│ schedules  cron · every · at   │   │        │                     │               │
└────────────────────────────────┘   │        ├─ set state          │               │
            ▲                        │        ├─ publish event      │               │
            │   answers, and what    │        ├─ one model call ────┼───────────────┤
            │   agents send          │        │                     │               │
            └────────────────────────┤        └─ agent task         │               │
                                     │             │                │               │
                                     │   ┌─────────▼────────────┐   │               │
                                     │   │ task queue (SQLite)  │   │               │
                                     │   │ one lane per session │   │               │
                                     │   └─────────┬────────────┘   │               │
                                     │   ┌─────────▼────────────┐   │               │
                                     │   │ pi session           │───┼───────────────┘
                                     │   │  workspace, AGENTS.md│   │
                                     │   │  tools, MCP, skills  │   │
                                     │   │  policy gate         │   │
                                     │   └──┬───────────────┬───┘   │
                                     │      │ delegate      │ subagent
                                     │      ▼               ▼       │
                                     │  other agents    copies of itself
                                     └──────────────────────────────┘
```

- A session is a pi `AgentSession` (an `AgentSessionRuntime`): the model loop, tool calls,
  compaction and retries are pi's. Named sessions are JSONL under `agents/<id>/sessions/<key>/`;
  a run started from outside works in `<key>~u`.
- Every tool call passes the gate in `coreExtension()` (`src/agents.ts`).
- Model slots are `src/limiter.ts`: priority, one queue per model in `limits.models`.

## An event's fields

| Field | Meaning |
|---|---|
| `id`, `ts` | Position in the log and time |
| `topic` | `source/telegram/message`, `agent/gonzo/done`, ... |
| `source` | Who published it: `source:<name>` (`source:<name>@<agent>`), `http`, `api`, `timer`, `route:<name>`, `router`, `agent:<id>`, `approvals`, `pine` |
| `payload` | Any JSON |
| `trust` | `owner` or `untrusted` |
| `cause`, `hops` | The event that led to this one, and how many agent or route steps lie between it and an outside trigger |
| `reply` | Optional: the topic and fields an answer is published with |

## Topics for a UI

Live only (not stored), for a client of `GET /events/stream`, besides those in
[references/events.md](../references/events.md), "Topics":

| Topic | Published when |
|---|---|
| `agent/<id>/delta`, `agent/<id>/thinking`, `agent/<id>/message` | Streamed answer text; the model's thinking (`phase: "start"`, pieces of `text`, `phase: "end"` with `ms`); the end of a model message with token counts |
| `agent/<id>/todos` | The agent changed its list of steps (`items`: `text`, `status`) |
| `agent/<id>/steered` | A message was given to a task that was already working (`task`) |
| `agent/<id>/read` | That work read the steered message (`by`) at `at` |
| `agent/<id>/undone`, `agent/<id>/redone` | Undo or redo of the owner's last message (`session`, `message`, `tasks`, `files`) |
| `pine/board` | A board changed (`board`, `scope`, `agent`, `session`, `name`, `change`); the UI asks the control API for the rest |
| `pine/settings` | A setting changed (`key` only) |
| `pine/conversation` | A conversation was changed by another hand than this UI: by the main agent (`open`, `close`, `rename`, `remove`, `pin`), in another UI (`folder`), or either (`group`; without `session`, a group of the agent changed). It names the conversation only |
