# Configuration files

Every key of `pine.json`, `agent.json`, `models.json` and `.env`, with its default. You rarely
edit these files: the main agent changes them by tool ([setup.md](setup.md)), the Pine app through
Settings.

Everything pine needs is in its home folder: `~/.pine`, or `$PINE_HOME`, or `--home <dir>`.

```
~/.pine/
  pine.json            global settings, routes, schedules, global MCP servers and event sources
  models.json          your own model servers, in pi's format
  .env                 secrets, referenced from the JSON files as ${NAME}
  auth.json            provider credentials, written by `pine login`
  AGENTS.md            traits and behaviour     ┐
  TOOLS.md             tooling defaults         │ for all agents (agents.md)
  USER.md              what agents know of you  ┘
  agents/<id>/
    agent.json         this agent's settings
    workspace/         its working folder (unless agent.json points elsewhere), with its own
                       AGENTS.md, SOUL.md, TOOLS.md, MEMORY.md
    AGENTS.md          optional: rules of yours the agent cannot change
    SYSTEM.md          optional: replaces pine's base prompt for this agent
    skills/            skills only this agent has
    conversations/     what was set up for one conversation alone
    extensions/        pi extensions only this agent loads
    sessions/          conversation history
  skills/              skills for all agents
  sources/             source types the main agent registered (pine's own copies)
  themes/              color themes of the Pine app (ui.theme)
  views/               views of the Pine app's panel (ui.view, views.md)
  removed/             folders of agents removed with keep_files
  sandbox/             each agent's private home and sandbox profiles
  data/                event log, tasks, media, control token, files of sources, undo states
                       (written by pine; closed to agents)
```

The files read as instructions: [agents.md](agents.md), "Every file that is read as instructions".

Paths in `pine.json` are relative to the home, in `agent.json` to the agent's folder; `~` works in
both. Durations are milliseconds or a string: `"90s"`, `"15m"`, `"2h"`, `"1d"`.

After editing by hand, run `pine check`. It validates names, references, paths, models, sources and
schedules, prints what each agent ends up with, lists what weakens the defences, and says what to
write instead of a key pine does not take.

## Secrets

Write `${NAME}` or `${NAME:-fallback}` in any string of `pine.json` or `agent.json`. The value comes
from `<home>/.env`, else the daemon's environment. A missing name without a fallback is an error.

Only pine reads `.env`. Its values stay out of the daemon's environment, so agent shells and MCP
servers do not inherit them, and values of 8 characters or more are removed from events, messages
and logs. Keep it at mode 600 (`pine init` does).

pine writes these entries itself, and removes each with the thing it belongs to:

| Entry | Written for |
|---|---|
| `PINE_SOURCE_<NAME>[_<AGENT>]_<OPTION>` | A source's secret typed into pine's dialog (no `<AGENT>` for a source of all agents; [sources.md](sources.md), "Secrets") |
| `PINE_MCP_<SERVER>[_<AGENT>]_<VARIABLE>` | A local MCP server's key typed into pine's dialog ([mcp.md](mcp.md)) |
| `PINE_MODEL_<NAME>_API_KEY` | The key of a model server of yours ("A server that wants a key") |
| `PINE_DECISION_<NAME>_KEY` | The key of a decision model at another server ("Decision models") |
| `TYPESAFE_API_KEY` | pine's sign-in at TypeSafe |

## pine.json

```json
{
  "main": "main",
  "defaults": { "model": "studio/deepseek-v4.1-flash", "thinking": "off" },
  "limits": { "maxConcurrentRuns": 2 },
  "security": { "approvalTimeout": "5m" },
  "http": { "host": "127.0.0.1", "port": 7463, "hooks": {} },
  "mcp": {},
  "sources": {},
  "routes": [],
  "schedules": []
}
```

The main agent changes many of these keys with `set_setting` ([setup.md](setup.md), "pine's
settings").

| Key | Default | Meaning |
|---|---|---|
| `main` | none | Id of the main agent, the only one that creates agents and sets things up for all agents. Without it: the agent called `main`, else the first one. |
| `logLevel` | `info` | `debug`, `info`, `warn`, `error`, `silent`. To stderr, or `data/pine.log` for a daemon inside the terminal UI or started by `pine service`. |
| `dataDir` | `data` | Where the database, media and control token live. |
| `defaults.model` | none | `provider/model-id` for every agent that names no model. No built-in fallback: in a new home the first model you connect becomes it, and until then an agent without one says so ([operations.md](operations.md), "Choosing a model"). |
| `defaults.judge` | not set | Model of goal mode's judge; not set: the agent's own ([agents.md](agents.md), "Goal mode"). |
| `defaults.checker` | not set | Model that checks a swarm's answer; not set: the agent's own. `/swarm` is refused while it names a missing model ([boards.md](boards.md), "A swarm"). |
| `defaults.introduce` | `true` | Each agent introduces itself in its answer to your first message ([agents.md](agents.md), "Meeting an agent"). |
| `defaults.thinking` | `medium` | Reasoning level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Ignored by a model that cannot reason. |
| `defaults.mode` | not set | Mode of agents that name none: `auto`, `safe`, `manual`, `bypass`, `plan`. Not set: `auto` for the main agent, `safe` (in the sandbox) for others ([security.md](security.md), "Modes: how much an agent does without asking"). |
| `defaults.bashTimeoutSec` | `900` | Longest a shell command may run (15 minutes); the model cannot raise it. Longer work goes in the background ([coding.md](coding.md), "Commands in the background"). |
| `defaults.taskTimeoutSec` | `7200` | Longest a task may run (two hours). |
| `defaults.idleMs` | `15m` | An idle live session is closed after this, and resumed from disk later. |
| `defaults.settings` | `{}` | pi settings for every agent, e.g. `{ "compaction": { "reserveTokens": 8000 } }`. |
| `limits.maxConcurrentRuns` | `8` | How many agents work at the same time (runs talking to a model); a run that only waits gives its place back. For your own server, match its parallel requests (`-np`) or use `limits.models`. |
| `limits.models` | none | Runs at a time per model, by its whole name: `{ "local/qwen3-coder": 2 }`, 1 to 64, in a queue of its own: a model on your own computer takes one or two requests at once, a hosted one many. Also set in Settings > Models or with `configure_model` (`runs`); removed with the model's server. |
| `limits.maxSubagents` | `4` | Sub-agents one conversation runs at a time, unless `subagents.maxParallel` says otherwise. |
| `limits.maxPoolTasks` | `100` | The most tasks one `subagent` call takes as a pool ([boards.md](boards.md), "A pool of sub-agents"). |
| `limits.warmSlots` | `true` | Idle llama.cpp slots read a conversation's beginning ahead of time ([agents.md](agents.md), "What the model server keeps"). |
| `limits.warmAfterMs` | `3000` | How long a model server must be idle before a slot is filled. |
| `limits.slotPages` | `6` | Conversations saved to files of a llama.cpp server (`--slot-save-path`) when they leave their slot. `0`: none. |
| `limits.maxDelegationDepth` | `3` | How deep a chain of delegations may go. |
| `limits.maxDownloadMb` | `200` | Largest file the `download` tool fetches. |
| `limits.maxEventHops` | `8` | Events further than this from an outside trigger are not routed. |
| `limits.maxQueuedPerAgent` | `50` | New tasks are refused when an agent has this many waiting. |
| `limits.maxEventChars` | `20000` | Longest untrusted event text in a prompt (at least 1000); your messages and delegated tasks may be ten times as long. |
| `limits.modelHeadersTimeoutMs` | `10m` | How long a model server may take to start answering. |
| `limits.modelStreamIdleMs` | `5m` | How long a started answer may go silent before the request is dropped. |
| `limits.eventRetentionDays` | `30` | Older events and copies of reset conversations are deleted. |
| `limits.conversationDays` | `7` | An unused conversation is removed after this, unless it is main, pinned, grouped, open in a tab, subscribed or scheduled. `0`: never. |
| `limits.goalRounds` | `20` | Goal mode: rounds (whole turns) before a goal waits for `/goal resume`, which gives as many again. |
| `limits.goalIdleRounds` | `3` | Goal mode: rounds in a row "not met" without a tool call before the goal pauses. `0`: never. |
| `limits.goalJudgeTimeout` | `90s` | Goal mode: how long the judge may take; longer pauses the goal. |
| `limits.swarmRounds` | `8` | Turns a swarm's lead gets before it waits for `/swarm resume` ([boards.md](boards.md), "A swarm"). |
| `security.approvalTimeout` | `5m` | An unanswered approval counts as "no" after this. |
| `security.taint` | `session` | How long a conversation counts as having read outside content: until reset (`session`), until the task ends (`run`), or never (`off`) ([security.md](security.md)). |
| `security.taintTools` | `[]` | Tool name globs whose results count as outside content, besides MCP servers marked `taints`. |
| `security.bypassWhenTainted` | `false` | Keep `bypass` mode after outside content; off, such a conversation works as in `auto`. |
| `security.askAccess` | `true` | pine asks you when a call in the sandbox needs a file, folder or the network outside it; `false`: only `request_access` asks ([security.md](security.md), "When a call needs something outside: pine asks you"). |
| `ui.theme` | `pmndre` | The Pine app's theme: a file in the home's `themes` folder, without `.json` ([desktop.md](desktop.md), "Themes"). |
| `ui.view` | a view in the folder | The Pine app's panel view: a file in the home's `views` folder, without `.ts`, or `off` ([views.md](views.md)). |
| `http` | on | Control API and webhooks; `false` turns both off, and the CLI's commands for a running daemon with them. |
| `http.host`, `http.port` | `127.0.0.1`, `7463` | Where the control API listens. `pine check` reports anything but loopback. |
| `http.token` | generated | The control API's bearer token, written to `data/http-token` when unset. |
| `http.hooks.<name>` | none | A webhook at `POST /hook/<name>`: `{ "secret": "...", "topic": "hook/<name>" }`, or `"open": true` for anyone who reaches the port ([events.md](events.md), "Webhooks"). For agents, use a `webhook` source. |
| `mcp` | `{}` | MCP servers for all agents ([mcp.md](mcp.md)). |
| `sources` | `{}` | Event sources every agent can subscribe to ([sources.md](sources.md)). |
| `sourceTypes` | `{}` | Your own source types by name and module, e.g. `{ "doorbell": "./sources/doorbell.ts" }`. `add_source_type` points at pine's copy in `sources/`. |
| `subscribe` | `[]` | Subscriptions for all agents; each agent that can use the source is woken in its main conversation. |
| `extensions` | `[]` | pi extensions loaded into every agent's sessions. |
| `skills` | `[]` | Further skill folders for every agent, outside pine's home; agents cannot replace or remove them. |
| `routes` | `[]` | See [events.md](events.md), "Routes". |
| `decisions` | `{}` | Decision models by name, for routes' typed questions ("Decision models"). |
| `schedules` | `[]` | Schedules; one with a `task` wakes every agent ([events.md](events.md), "Schedules"). |

## agent.json

Every key is optional; `{}` is a valid agent. Dotted keys are nested objects, as in `pine.json`.
The main agent changes them with `update_agent`, you with `pine agent update`
([setup.md](setup.md), "Changing and removing an agent").

### Identity and model

| Key | Default | Meaning |
|---|---|---|
| `description` | empty | What other agents read about it when its `AGENTS.md` does not open with its purpose. Nothing writes it. |
| `color` | none | Give an agent its own color in the Pine app (`#rrggbb`) for its avatar: in the app, with `pine agent update <id> --color #e0805a` (`none` removes it), or by asking the main agent. |
| `scroll` | `top` | When you send a message in the Pine app, `top` moves it to the top with the answer below; `follow` keeps it at the bottom and follows the answer, like a terminal. Also in Settings > Agents or `--scroll follow`. |
| `workspace` | `agents/<id>/workspace` | The agent's working folder; it must exist. |
| `context` | `[]` | Further instruction files read into its prompt. |
| `model`, `thinking` | from `defaults` | The agent's model and reasoning level. |
| `settings` | from `defaults.settings` | pi settings on top of `defaults.settings`; wins over `agents/<id>/settings.json`. |
| `taskTimeoutSec`, `idleMs` | from `defaults` | Per-agent overrides. |

### Tools and extensions

| Key | Default | Meaning |
|---|---|---|
| `tools` | `read`, `bash`, `edit`, `write` | pi's built-in tools it gets, from `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`. `pine init` and `create_agent` give all seven. |
| `mcp` | `{}` | MCP servers only this agent has; one named like a global server replaces it. With `"session": "<conversation>"`, that conversation's alone. |
| `globalMcp` | `true` | Which global servers it gets: `true` all, `false` none, or a list of names. |
| `sources` | `{}` | Event sources only this agent can subscribe to; with `"session"`, one conversation's ([sources.md](sources.md)). |
| `subscribe` | `[]` | Its subscriptions: names, objects with `note`, `when`, `throttle`, `debounce`, `separate`, `prompt`, or entries with `source` and `session` ([sources.md](sources.md), "In the configuration"). |
| `schedules` | `[]` | `{ "name", "cron" or "every" or "at", "task" }`, with `"session"` for one conversation ([events.md](events.md), "Schedules"). |
| `extensions`, `skills` | `[]` | Further pi extension files and skill folders; its own `skills/` needs no entry. |
| `bashTimeoutSec` | from `defaults` | Longest shell command. |
| `bashDeny` | `[]` | Regular expressions that refuse a matching shell command. A convenience, not a boundary. |

### Working with other agents

| Key | Default | Meaning |
|---|---|---|
| `delegates` | `["*"]` | Agents it may hand tasks to; `*` is all but the main one, which you name to include. `[]`: no `delegate` tool. The task runs in the stricter of the two modes. |
| `subagents` | on, `limits.maxSubagents` (4) at a time | `false`, or `{ "maxParallel": 4, "tools": [...], "mcp": true }`: `tools` narrows theirs, `mcp: false` takes MCP servers away. |
| `publish` | `[]` | Topic patterns `publish_event` may publish on; empty: no such tool. |
| `state.read` | `["#"]` | State keys the agent may read. |
| `state.write` | `["agent/<id>/#"]` | State keys the agent may write. |
| `state.inject` | `[]` | State keys shown to the agent in every turn. |

### Containment

| Key | Default | Meaning |
|---|---|---|
| `mode` | `auto` for the main agent, `safe` for others (or `defaults.mode`) | `auto` (your account, no sandbox), `safe` (sandbox), `manual` (sandbox, every action asks), `bypass` (no sandbox, never asks), `plan` (only looks). pine's home stays closed in every mode ([security.md](security.md), "Modes: how much an agent does without asking"). |
| `sandbox.network` | `false` | Shell commands in the sandbox may use the network, local network and this machine's ports included ([security.md](security.md), "On Linux"). |
| `sandbox.read`, `sandbox.write` | `[]` | Further folders the agent may read / write in the sandbox. |
| `sandbox.sharedTmp` | `true` | Allow `/tmp` and the user's temp folder. |
| `sandbox.env` | `{}` | Extra variables for its shell. No secrets: the agent can read them. |
| `trustWorkspace` | `false` | `true` lets pi load `.pi/extensions`, `.pi/settings.json` and skills from the workspace, which runs code in the daemon for whoever can write there, the agent included. |
| `approve` | `[]` | Tool calls that always ask you: `"tool"` or `"tool:argument-glob"`, e.g. `"bash:*git push*"`. |
| `approveWhenTainted` | `["publish_event", "send"]` | Calls that send something out, asked after outside content. A `send` only to you (Telegram) is not; add `"send:telegram"` to `approve` for that. |
| `untrusted` | read-only profile | What a run started by an untrusted event may use: `{ "tools": ["read","grep","find","ls"], "mcp": [], "delegates": [], "publish": [], "stateWrite": false, "subagents": false, "board": false }`. `false` refuses such runs ([security.md](security.md)). |

## models.json

pi's own file, which pine passes on. Only your own model servers need it; hosted providers are
built into pi and signed in with `pine login`. `pine model add` and `add_model_server` ask the
server and write the entry; `add_model`, `configure_model` and `remove_model` change it
([setup.md](setup.md), "Setting up a model"):

```json
{
  "providers": {
    "studio": {
      "name": "studio (127.0.0.1:8080)",
      "baseUrl": "http://127.0.0.1:8080/v1",
      "api": "openai-completions",
      "apiKey": "none",
      "models": [
        {
          "id": "deepseek-v4.1-flash",
          "contextWindow": 65536,
          "maxTokens": 8192,
          "input": ["text"],
          "reasoning": true,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
          "compat": { "supportsStore": false, "supportsDeveloperRole": false, "supportsReasoningEffort": true, "maxTokensField": "max_tokens" }
        }
      ]
    }
  }
}
```

- A model is named `provider/id`: `studio/deepseek-v4.1-flash`.
- `contextWindow` must match the server's (`-c` divided by its slots), or compaction comes at the
  wrong time.
- `"image"` in `input` only for a model that reads pictures; it then gets pictures from Telegram
  and watched folders.
- The `compat` flags keep pi from sending fields a plain llama-server may reject.
- pi's documentation: `node_modules/@earendil-works/pi-coding-agent/docs/models-configuration.md`.

### Thinking levels

pine's levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` (`thinking`, and
`/reasoning` in the terminal UI). A chat template answers an unknown level with its own default,
often its highest, and for `off` nothing is sent, so thinking stays on.

For llama.cpp, `pine model add` and `add_model_server` read the template's levels
(`chat_template_caps` in `/props`) and write a map. For a template that knows `low` and `medium`:

```json
"reasoning": true,
"thinkingLevelMap": { "off": "none", "minimal": "low", "low": "low", "medium": "medium" },
"compat": { "thinkingFormat": "openai", "supportsReasoningEffort": true, ... }
```

- `"thinkingFormat": "openai"` sends the level as `reasoning_effort`, which llama.cpp hands to the
  template. `off` goes as `none`, which turns thinking off.
- An unknown level goes as the next known one up: with `low`, `medium` and `xhigh`, `high` goes as
  `xhigh`.
- Above all known levels there is no entry: pi lowers `xhigh` and `max` to the highest, and `high`
  goes as it is, to the template's default.

For a server that does not report levels (vLLM, LM Studio), `pine model add --reasoning` only marks
the model as thinking; write a `thinkingLevelMap` by hand if needed.

### A server that wants a key

`pine model add` and `add_model_server` ask for the key and keep it in `.env` as
`PINE_MODEL_<NAME>_API_KEY`. By hand, name it in `models.json` and put it into `.env`:

```json
"studio": {
  "baseUrl": "http://100.64.0.7:8080/v1",
  "api": "openai-completions",
  "apiKey": "$STUDIO_API_KEY",
  "models": [ ... ]
}
```

```
STUDIO_API_KEY=...
```

- `$NAME` and `${NAME}` work, `$$` is a dollar sign; there is no `${NAME:-fallback}` (pi's syntax).
- pine hands the key to pi in memory at start, never in a file or the daemon's environment, so
  shells and MCP servers never see it. A change to `.env` holds from the next start.
- A missing name does not stop pine: that provider's models are missing from `/model`, and
  `pine check` lists it under "Model notes".
- Only `apiKey` is filled from `.env`. pi reads a `$NAME` in `headers` from the daemon's
  environment; `pine check` says so when a header names an `.env` entry.
- `"apiKey": "none"` (any text without `$`) is sent as it is.

## Decision models

A decision model answers typed questions about a text (how likely yes is, which named option fits,
which level) in a fraction of a second, with computed probabilities. Routes use them on every event
([events.md](events.md), "Typed questions"); no agent runs on one. They speak TypeSafe's API
(`POST /v1/systemone`) and are kept by name under `decisions` in `pine.json`:

```json
"decisions": {
  "decider": { "server": "studio", "model": "decider" },
  "jev": { "server": "typesafe" },
  "other": { "url": "http://box.tail1234.ts.net:8080", "model": "judge-7b", "key": "${PINE_DECISION_OTHER_KEY}", "local": true }
}
```

| Key | |
|---|---|
| `server` | A model server in `models.json` that also serves it (such as Pinecone on your Mac), whose address and key are read at each request. Or `"typesafe"`: Jev, with pine's TypeSafe key. |
| `model` | The server's name for it (for Pinecone, the resource's name). At TypeSafe `jev-latest` unless given. |
| `url` | Instead of `server`: another server with the same API, without `/v1`. `http://` only on your own network. |
| `key` | With `url`: its key from `.env` (`PINE_DECISION_<NAME>_KEY` when pine asked for it). |
| `local` | With `url`: the server is on your network under a name that does not say so (Tailscale). |
| `timeout` | One request, model loading included: `20s` at TypeSafe, `120s` elsewhere. |

For TypeSafe, sign in with a key from [console.typesafe.ai](https://console.typesafe.ai) under
Settings > Models, Decision models, with `pine login typesafe`, or by asking the main agent
(`sign_in` with `typesafe`; you type the key into pine's dialog). pine checks it and keeps it as
`TYPESAFE_API_KEY`; `pine logout typesafe` removes it. Then add `{ "server": "typesafe" }`.

Add a decision model in Settings > Models, Decision models, or by asking the main agent
(`add_decision_model`). Every agent's routes can then ask it. When you confirm it, and each route
that asks it, pine says where the text goes. Chat models are asked in words with a route's `call`;
only decision models answer typed questions.
