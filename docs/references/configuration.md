# Configuration files

Every key of `pine.json`, `agent.json`, `models.json` and `.env`, with its default. You rarely
edit these files: the main agent changes them through tool calls ([setup.md](setup.md)), and the
Pine app through Settings.

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

The files read as instructions are listed in [agents.md](agents.md), "Every file that is read as
instructions".

Paths in `pine.json` are relative to the home; paths in `agent.json` to the agent's folder. `~`
works in both. Durations are milliseconds or a string: `"90s"`, `"15m"`, `"2h"`, `"1d"`.

After editing a file by hand, run `pine check`. It validates names, references, paths, models,
sources and schedules, prints what each agent ends up with, and lists what weakens the defences.
A key pine does not take is reported with what to write instead.

## Secrets

Write `${NAME}` or `${NAME:-fallback}` in any string of `pine.json` or `agent.json`. The value
comes from `<home>/.env`, else the daemon's environment; a missing name without a fallback is a
configuration error.

`.env` is read by pine only. Its values are not put into the daemon's environment, so agent
shells and MCP servers do not inherit them, and values of 8 characters or more are removed from
events, messages and logs. Keep it at mode 600 (`pine init` does).

pine writes `.env` itself, and the configuration names the entry; removing the thing removes it:

| Entry | Written for |
|---|---|
| `PINE_SOURCE_<NAME>[_<AGENT>]_<OPTION>` | A secret of an event source, typed into pine's dialog (no `<AGENT>` for a source of all agents). See [sources.md](sources.md), "Secrets" |
| `PINE_MCP_<SERVER>[_<AGENT>]_<VARIABLE>` | A key of a local MCP server, typed into pine's dialog ([mcp.md](mcp.md)) |
| `PINE_MODEL_<NAME>_API_KEY` | The key of a model server of yours (`pine model add`, `add_model_server`); see "A server that wants a key" |
| `PINE_DECISION_<NAME>_KEY` | The key of a decision model at another server; see "Decision models" |
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

Many of these keys are pine's settings, which the main agent changes with `set_setting` and the
Pine app in Settings ([setup.md](setup.md), "pine's settings").

| Key | Default | Meaning |
|---|---|---|
| `main` | none | Id of the main agent, the only one that creates agents and sets things up for all agents ([setup.md](setup.md)). Without it: the agent called `main`, else the first one. |
| `logLevel` | `info` | `debug`, `info`, `warn`, `error`, `silent`. Logs go to stderr; a daemon inside the terminal UI or started by `pine service` logs to `data/pine.log`. |
| `dataDir` | `data` | Where the database, media and control token live. |
| `defaults.model` | none | `provider/model-id`: the model of every agent whose `agent.json` names no model. There is no built-in fallback. A new home has none: the first model you connect becomes it, and until then an agent with no model named says so instead of answering ([operations.md](operations.md), "Choosing a model"). |
| `defaults.judge` | not set | The model of goal mode's judge. Not set: the agent's own. A second, small model keeps the judge from pushing the conversation out of a model server's cache. See [agents.md](agents.md), "Goal mode". |
| `defaults.checker` | not set | The model that checks a swarm's answer. Not set: the agent's own. `/swarm` is refused while it names a model that is not there. See [boards.md](boards.md), "A swarm". |
| `defaults.introduce` | `true` | Each agent introduces itself in its answer to your first message. `false`: none does ([agents.md](agents.md), "Meeting an agent"). |
| `defaults.thinking` | `medium` | Reasoning level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Ignored by a model that cannot reason. |
| `defaults.mode` | not set | The mode of every agent that names none: `auto`, `safe`, `manual`, `bypass` or `plan`. Not set: `auto` for the main agent, `safe` for the others. `safe` keeps every agent in its sandbox. See [security.md](security.md), "Modes: how much an agent does without asking". |
| `defaults.bashTimeoutSec` | `900` | Longest a shell command may run (15 minutes); the model cannot raise it. What runs longer is started in the background ([coding.md](coding.md), "Commands in the background"). |
| `defaults.taskTimeoutSec` | `7200` | Longest a task may run (two hours). |
| `defaults.idleMs` | `15m` | A live session without work is closed after this, and resumed from disk later. |
| `defaults.settings` | `{}` | pi settings for every agent, e.g. `{ "compaction": { "reserveTokens": 8000 } }`, on top of pi's own settings files. |
| `limits.maxConcurrentRuns` | `8` | How many agents work at the same time: runs that talk to a model at once; the others wait their turn. A run that only waits (for sub-agents, a delegated task, your approval) gives its place back. For a model server of your own, use the number of requests it serves side by side (`-np` on llama.cpp), or set `limits.models`. Settings > General > Limits: Agents at work at once. |
| `limits.models` | none | Runs at a time for one model, by its whole name: `{ "local/qwen3-coder": 2 }`, 1 to 64. Such a model has a queue of its own, apart from `limits.maxConcurrentRuns`: a model on your own computer takes one or two requests at once where a hosted one takes many. Set it in Settings > Models, with `configure_model` (`runs`), or here. It goes when the model's server is removed. |
| `limits.maxSubagents` | `4` | Sub-agents one conversation runs at a time, unless an `agent.json` sets `subagents.maxParallel`. More tasks wait. Settings > General > Limits: Sub-agents at a time. |
| `limits.maxPoolTasks` | `100` | The most tasks one `subagent` call takes as a pool, worked through a few at a time ([boards.md](boards.md), "A pool of sub-agents"). Settings > General > Limits: Largest batch of sub-agent tasks. |
| `limits.warmSlots` | `true` | Idle llama.cpp slots read a conversation's beginning ahead of time. See [agents.md](agents.md), "What the model server keeps". |
| `limits.warmAfterMs` | `3000` | How long a model server has to be idle before a slot is filled. |
| `limits.slotPages` | `6` | Conversations kept in files of a llama.cpp server (started with `--slot-save-path`) when they leave their slot. `0`: none. |
| `limits.maxDelegationDepth` | `3` | How deep a chain of delegations may go. |
| `limits.maxDownloadMb` | `200` | Largest file the `download` tool fetches. |
| `limits.maxEventHops` | `8` | Events further than this from an outside trigger are not routed. |
| `limits.maxQueuedPerAgent` | `50` | New tasks are refused when an agent has this many waiting. |
| `limits.maxEventChars` | `20000` | Longest text of an untrusted event in a prompt (at least 1000). Your own messages and delegated tasks may be ten times as long. |
| `limits.modelHeadersTimeoutMs` | `10m` | How long a model server may take to start answering. |
| `limits.modelStreamIdleMs` | `5m` | How long a started answer may go silent before the request is dropped. |
| `limits.eventRetentionDays` | `30` | Older events, and copies of reset conversations, are deleted. |
| `limits.conversationDays` | `7` | A conversation unused this long is removed, unless it is an agent's main one, pinned, in a group, open in a tab, subscribed to a source or has a schedule. `0`: never. |
| `limits.goalRounds` | `20` | Goal mode: rounds before a goal stops and waits for `/goal resume`, which gives as many again. A round is a whole turn of the agent. See [agents.md](agents.md), "Goal mode". |
| `limits.goalIdleRounds` | `3` | Goal mode: a goal is paused after this many rounds in a row judged "not met" without a tool call. `0`: never. |
| `limits.goalJudgeTimeout` | `90s` | Goal mode: how long the judge may take; longer counts as no verdict, and the goal is paused. |
| `limits.swarmRounds` | `8` | A swarm: turns its lead gets before it stops and waits for `/swarm resume` ([boards.md](boards.md), "A swarm"). |
| `security.approvalTimeout` | `5m` | An unanswered approval counts as "no" after this. |
| `security.taint` | `session` | How long a conversation counts as having read outside content: until reset (`session`), until the task ends (`run`), or never (`off`). See [security.md](security.md). |
| `security.taintTools` | `[]` | Tool name globs whose results count as outside content, besides MCP servers marked `taints`. |
| `security.bypassWhenTainted` | `false` | Keep `bypass` mode after outside content. Off: such a conversation works as in `auto`. |
| `security.askAccess` | `true` | pine asks you itself when a call in the sandbox needs a file, folder or the network outside it. `false`: only the agent's `request_access` asks. See [security.md](security.md), "When a call needs something outside: pine asks you". |
| `ui.theme` | `pmndre` | The Pine app's theme: a file in the home's `themes` folder, without `.json`. See [desktop.md](desktop.md), "Themes". |
| `ui.view` | a view in the folder | The view of the Pine app's panel: a file in the home's `views` folder, without `.ts`, or `off`. See [views.md](views.md). |
| `http` | on | Control API and webhooks. `false` turns it off, and with it the CLI's commands for a running daemon. |
| `http.host`, `http.port` | `127.0.0.1`, `7463` | Where the control API listens. `pine check` reports anything but loopback. |
| `http.token` | generated | The control API's bearer token. Unset: pine writes one to `data/http-token`. |
| `http.hooks.<name>` | none | A webhook at `POST /hook/<name>`: `{ "secret": "...", "topic": "hook/<name>" }`, or `"open": true` to accept anyone who reaches the port. See [events.md](events.md), "Webhooks". For a webhook an agent subscribes to, use a `webhook` source. |
| `mcp` | `{}` | MCP servers for all agents ([mcp.md](mcp.md)). |
| `sources` | `{}` | Event sources every agent can subscribe to ([sources.md](sources.md)). |
| `sourceTypes` | `{}` | Source types of your own: a name and its module, e.g. `{ "doorbell": "./sources/doorbell.ts" }`. The main agent adds entries with `add_source_type`, pointing at pine's copy in `sources/`. |
| `subscribe` | `[]` | Subscriptions for all agents: each agent that can use the source is woken in its main conversation. |
| `extensions` | `[]` | pi extensions loaded into every agent's sessions. |
| `skills` | `[]` | Further skill folders for every agent, outside pine's home. Agents cannot replace or remove these. `skills/` in the home needs no entry. |
| `routes` | `[]` | See [events.md](events.md), "Routes". |
| `decisions` | `{}` | Decision models by name, for routes' typed questions. See "Decision models". |
| `schedules` | `[]` | What happens at a time; one with a `task` wakes every agent with it. See [events.md](events.md), "Schedules". |

## agent.json

Every key is optional; `{}` is a valid agent.

```json
{
  "workspace": "~/dev/gonzo",
  "model": "studio/deepseek-v4.1-flash",
  "tools": ["read", "bash", "edit", "write", "grep", "find", "ls"],
  "mcp": { "library": { "command": "library-mcp" } },
  "globalMcp": ["web"],
  "delegates": [],
  "subagents": { "maxParallel": 3 },
  "sandbox": { "network": false, "read": ["~/Documents/law-library"] }
}
```

The main agent changes these with `update_agent` ([setup.md](setup.md), "Changing and removing an
agent"), and so does `pine agent update`.

### Identity and model

| Key | Default | Meaning |
|---|---|---|
| `description` | empty | What other agents read about this one when its `AGENTS.md` does not begin with a paragraph saying what it is for ([agents.md](agents.md), "Handing work to another agent"). Nothing writes it. |
| `color` | none | Give an agent its own color in the Pine app, `#rrggbb`: its avatar is drawn in it, nothing else. Set it on the agent's avatar in the app, with `pine agent update <id> --color #e0805a` (`none` removes it), or ask the main agent. |
| `scroll` | `top` | Where a conversation goes in the Pine app when you send: `top` puts your message at the top of the window with the answer below; `follow` adds it at the bottom and follows the answer, as a terminal does. Set it in Settings > Agents, with `pine agent update <id> --scroll follow`, or ask the main agent. |
| `workspace` | `agents/<id>/workspace` | The agent's working folder. Must exist when you set it. |
| `context` | `[]` | Further instruction files read into its prompt. |
| `model`, `thinking` | from `defaults` | The agent's model and reasoning level. |
| `settings` | from `defaults.settings` | pi settings for this agent, key by key on top of `defaults.settings`. `agents/<id>/settings.json` is read too; this key wins. |
| `taskTimeoutSec`, `idleMs` | from `defaults` | Per-agent overrides. |

### Tools and extensions

| Key | Default | Meaning |
|---|---|---|
| `tools` | `read`, `bash`, `edit`, `write` | Which of pi's built-in tools the agent gets: any of `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`. `pine init` and `create_agent` give all seven. |
| `mcp` | `{}` | MCP servers only this agent has. One named like a global server replaces it for this agent. One with `"session": "<conversation>"` is that conversation's alone and goes with it. |
| `globalMcp` | `true` | Which global servers it gets: `true` all that include it, `false` none, or a list of names. |
| `sources` | `{}` | Event sources only this agent can subscribe to; with `"session"`, one conversation's. See [sources.md](sources.md). |
| `subscribe` | `[]` | What it is subscribed to: names, an object per source with `note`, `when`, `throttle`, `debounce`, `separate`, `prompt`, or entries with `source` and `session`. See [sources.md](sources.md), "In the configuration". |
| `schedules` | `[]` | Its schedules: `{ "name", "cron" or "every" or "at", "task" }`, with `"session"` for one conversation. See [events.md](events.md), "Schedules". |
| `extensions`, `skills` | `[]` | Further pi extension files and skill folders. Its own `skills/` needs no entry. |
| `bashTimeoutSec` | from `defaults` | Longest shell command. |
| `bashDeny` | `[]` | Regular expressions; a matching shell command is refused. A convenience, not a boundary. |

### Working with other agents

| Key | Default | Meaning |
|---|---|---|
| `delegates` | `["*"]` | Agents it may hand tasks to. `*` is every other agent but the main one; name the main agent to include it. `[]`: none, and no `delegate` tool. The task runs in the stricter of the two agents' modes. |
| `subagents` | on, `limits.maxSubagents` (4) at a time | `false`, or `{ "maxParallel": 4, "tools": [...], "mcp": true }`. `tools` narrows what sub-agents get; `mcp: false` takes the MCP servers away. |
| `publish` | `[]` | Topic patterns the `publish_event` tool may publish on. Empty: no such tool. |
| `state.read` | `["#"]` | State keys the agent may read. |
| `state.write` | `["agent/<id>/#"]` | State keys the agent may write. |
| `state.inject` | `[]` | State keys shown to the agent in every turn. |

### Containment

| Key | Default | Meaning |
|---|---|---|
| `mode` | `auto` for the main agent, `safe` for others (or `defaults.mode`) | How much the agent does without asking, and whether it works in a sandbox: `auto` (your account, no sandbox), `safe` (sandbox), `manual` (sandbox, every action asks), `bypass` (no sandbox, never asks), `plan` (only looks, answers with a plan). pine's home stays closed in every mode. See [security.md](security.md), "Modes: how much an agent does without asking". |
| `sandbox.network` | `false` | Shell commands in the sandbox may use the network, local network and this machine's ports included. See [security.md](security.md), "On Linux". |
| `sandbox.read`, `sandbox.write` | `[]` | Further folders the agent may read / write in the sandbox. |
| `sandbox.sharedTmp` | `true` | Allow `/tmp` and the user's temp folder. |
| `sandbox.env` | `{}` | Extra environment variables for the agent's shell. No secrets: the agent can read them. |
| `trustWorkspace` | `false` | `true` lets pi load `.pi/extensions`, `.pi/settings.json` and skills from the workspace: code run inside the daemon for whoever can write there, the agent included. |
| `approve` | `[]` | Tool calls that always ask you: `"tool"` or `"tool:argument-glob"`, e.g. `"bash:*git push*"`. |
| `approveWhenTainted` | `["publish_event", "send"]` | Tool calls that count as sending something out, asked after outside content. A `send` that reaches only you (Telegram) is not asked this way; put `"send:telegram"` in `approve` to see those first. |
| `untrusted` | read-only profile | What a run started by an untrusted event may use: `{ "tools": ["read","grep","find","ls"], "mcp": [], "delegates": [], "publish": [], "stateWrite": false, "subagents": false, "board": false }`. `false` refuses such runs. See [security.md](security.md). |

## models.json

pi's own file, which pine passes on. Only model servers of your own need it: hosted providers are
known to pi, and `pine login` supplies their credentials. You rarely write it: `pine model add`
and the main agent's `add_model_server` ask the server and write the entry, and `add_model`,
`configure_model`, `remove_model` change it ([setup.md](setup.md), "Setting up a model"). What
they write looks like this:

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

- A model is named `provider/id`, here `studio/deepseek-v4.1-flash`.
- `contextWindow` must match what the server was started with (`-c`, divided by its slots), or
  compaction comes at the wrong time.
- `"image"` in `input` only for a model that reads pictures; then agents receive the pictures
  Telegram and watched folders deliver.
- The `compat` flags keep pi from sending fields a plain llama-server may reject.
- pi's documentation of the file:
  `node_modules/@earendil-works/pi-coding-agent/docs/models-configuration.md`.

### Thinking levels

pine's levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` (`thinking`,
`/reasoning` in the terminal UI). A chat template answers a level it does not know with its own
default, often its highest, and sends nothing for `off`, so thinking stays on.

For llama.cpp, `pine model add` and `add_model_server` read which levels the template knows
(`chat_template_caps` in `/props`) and write a map. For a template that knows `low` and `medium`:

```json
"reasoning": true,
"thinkingLevelMap": { "off": "none", "minimal": "low", "low": "low", "medium": "medium" },
"compat": { "thinkingFormat": "openai", "supportsReasoningEffort": true, ... }
```

- `"thinkingFormat": "openai"` sends the level as `reasoning_effort`, which llama.cpp hands to
  the template.
- `off` is sent as `none`, which turns thinking off.
- A level the template does not know is sent as the next one up that it knows: with `low`,
  `medium` and `xhigh`, `high` is sent as `xhigh`.
- A level above all it knows has no entry: pi lowers `xhigh` and `max` to the highest there is,
  and `high` goes as it is, to the template's default.

For a server that does not report levels (vLLM, LM Studio), `pine model add --reasoning` only
marks the model as thinking; write a `thinkingLevelMap` by hand if needed.

### A server that wants a key

`pine model add` and `add_model_server` ask you for the key and keep it in `.env` as
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

- `$NAME` and `${NAME}` both work; `$$` is a dollar sign. There is no `${NAME:-fallback}` here
  (this is pi's syntax).
- pine fills the key in at start and hands it to pi in memory: no file, not the daemon's
  environment, so shells and MCP servers never see it. A change to `.env` holds from the next
  start.
- A name that is missing does not stop pine: that provider's models are missing from `/model`,
  and `pine check` lists the name under "Model notes".
- Only `apiKey` is filled in from `.env`. A `$NAME` in `headers` is read by pi from the daemon's
  environment; `pine check` says so when a header names an `.env` entry.
- `"apiKey": "none"` (any text without `$`) is sent as it is.

## Decision models

A decision model answers typed questions about a text (how likely yes is, which named option
fits, which level) in a fraction of a second, with computed probabilities. Routes use them to act
on every event ([events.md](events.md), "Typed questions"); no agent runs on one. They speak
TypeSafe's API (`POST /v1/systemone`) and are kept by name under `decisions` in `pine.json`:

```json
"decisions": {
  "decider": { "server": "studio", "model": "decider" },
  "jev": { "server": "typesafe" },
  "other": { "url": "http://box.tail1234.ts.net:8080", "model": "judge-7b", "key": "${PINE_DECISION_OTHER_KEY}", "local": true }
}
```

| Key | |
|---|---|
| `server` | A model server in `models.json` that also serves the decision model (such as Pinecone on your Mac): its address and key are used, read at each request. Or `"typesafe"`: TypeSafe's service, Jev, with pine's TypeSafe key. |
| `model` | The server's name for the decision model (for Pinecone, the resource's name). At TypeSafe `jev-latest` unless given. |
| `url` | Instead of `server`: another server with the same API, without `/v1`. `http://` only on your own network. |
| `key` | With `url`: its key, from `.env` (kept as `PINE_DECISION_<NAME>_KEY` when pine asked for it). |
| `local` | With `url`: the server is on your network under a name that does not say so (a Tailscale name). |
| `timeout` | One request, loading the model included: `20s` at TypeSafe, `120s` elsewhere. |

- **TypeSafe:** sign in with a key from [console.typesafe.ai](https://console.typesafe.ai) under
  Settings > Models, Decision models, with `pine login typesafe`, or by asking the main agent
  (`sign_in` with `typesafe`; you type the key into pine's dialog). It is checked and kept as
  `TYPESAFE_API_KEY`; `pine logout typesafe` removes it. Then add `{ "server": "typesafe" }`.
- **Adding one:** Settings > Models, Decision models, or ask the main agent (`add_decision_model`). Every agent's routes can then ask it.
  You are told, when you confirm it and each route that asks it, where the text goes.

A chat model is asked in words with a route's `call`; only a decision model answers typed
questions.
