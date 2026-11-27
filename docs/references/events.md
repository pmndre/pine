# Schedules and routes

Schedules make things happen at set times. Routes are your own rules on events: they set state,
publish events, make one model call or run a script. An agent that should react to a folder, a
device or a web request needs no route: it subscribes to a [source](sources.md).

## Schedules

A schedule makes something happen at a set time, repeatedly or once. It has the same three
scopes as sources, MCP servers and skills ([setup.md](setup.md), "Three scopes").

### Ask the agent

> Every weekday at seven, check my mail and tell me on Telegram what matters.

> Remind me at five to call the dentist.

> In twenty minutes, look whether the build is through.

The agent calls `add_schedule` with a name, the task in its own words, and one of:

| Option | When |
|---|---|
| `cron` | Set times, five fields in local time: "every weekday at six in the evening" is `"0 18 * * 1-5"` |
| `every` | An interval, at least a minute (`15m`, `2h`) |
| `at` | Once, at a local time (`2026-12-24 17:00`), not in the past |
| `in` | Once, after this long (`10s`, `20m`) |

When it is time, pine wakes the agent with the task, even when you are away. The task counts as
your wish: the agent has its usual tools, and nothing is marked as outside content.

| Said | Who is woken |
|---|---|
| in a side conversation | That conversation. The schedule goes when the conversation is removed |
| in the agent's main conversation, or "as an agent" | The agent's main conversation |
| "all agents" (main agent only) | Every agent, each in its main conversation |

pine asks you as [setup.md](setup.md), "What you are asked", says, and after outside content
always, showing the task. `schedules` lists schedules and when each is next due,
`remove_schedule` ends one, and `pine schedules` lists all.

A name is unique among all schedules, and a task has at most 4000 characters. A one-off removes
itself after it fires. If pine was not running when a one-off or a `cron` schedule with a task was
due, pine runs it once at the next start and tells the agent it is late (`cron` up to seven days
back). An `every` schedule starts counting again.

### In the files

```json
"schedules": [
  { "name": "brief", "cron": "30 7 * * 1-5", "task": "Prepare the morning brief and send it to me on Telegram." },
  { "name": "dentist", "at": "2026-11-12T17:00", "task": "Remind me to call the dentist." },
  { "name": "printer-check", "every": "10m" }
]
```

In an `agent.json` this is that agent's schedule, for its main conversation or the one `session`
names. In `pine.json` a schedule with a task wakes every agent, and one without a task only
publishes an event.

| Key | Meaning |
|---|---|
| `name` | Required. A lowercase letter, then lowercase letters, digits, `-` and `_`. 40 characters at most. |
| `cron`, `every`, `at` | As above. In `cron`, day of week 0 or 7 is Sunday, and lists, ranges and steps work: `*/15 8-18 * * 1-5`. |
| `task` | What the agent is to do. Required in an `agent.json`. |
| `topic` | The event's topic instead of `timer/<name>` (`timer/<name>@<agent>` for an agent's own). |
| `session` | In an `agent.json`: the conversation that is woken. Default: the main one. |
| `payload` | Fields added to the event's payload, which always has `name` and `scheduled`, and `late` and `task` when they apply. |
| `catchUp` | For `cron`: at startup, fire once for a time missed in the last seven days, marked late. Default: `true` with a task. `at` always catches up, `every` never. |

### Schedules and routes

Every schedule also publishes an event, trusted as yours, which a route can act on. A schedule
without a task does only that:

```json
{ "on": "timer/printer-check", "call": { "prompt": "..." } }
```

To have the agent do something, give the schedule a task instead.

## Topics

Every event has a topic, a name with levels separated by slashes. In a pattern, `+` matches
exactly one level (`cam/+/motion` matches `cam/front/motion`), and `#` matches the rest
(`source/#` matches `source` and everything below it, `#` alone matches everything).

| Topic | Published when | Trust |
|---|---|---|
| `source/<name>/<event>` (`source/<name>@<agent>/<event>` for an agent's own) | A source reported ([sources.md](sources.md)) | untrusted, or owner with `"trust": "owner"` (a Telegram account you paired) |
| `hook/<name>` (or the hook's `topic`) | A hook in `http.hooks` was called ("Webhooks") | untrusted |
| whatever you name | `pine emit`, `POST /events` | owner, or untrusted if the request says so |
| `timer/<name>` (`timer/<name>@<agent>` for an agent's own) | A schedule fired | owner |
| topics in the agent's `publish` list | An agent called `publish_event` | owner, or untrusted if the run was restricted |
| `board/<name>/task`, `/note`, `/done`, `/failed`, `/blocked` | A named board changed ([boards.md](boards.md), "Events of a board") | owner if posted by your own conversation before outside content, else untrusted |
| `state/<key>` | Shared state changed (payload `value`, `previous`) | untrusted |
| `agent/<id>/started`, `agent/<id>/done`, `agent/<id>/failed` | A task started or ended | untrusted |
| `agent/<id>/tool` | A tool call started or ended (live only, not stored). A `question` call's start carries `asked`: the question's fields and `at` | untrusted |
| `agent/<id>/goal`, `agent/<id>/swarm` | A goal or swarm changed ([agents.md](agents.md), "Goal mode"; [boards.md](boards.md), "A swarm") | untrusted |
| `approval/requested`, `approval/decided` | pine asked you something, or you answered | untrusted |
| `question/asked` | An agent asked you with `question` (`agent`, `session`, `task`, `at` its place in the turn, `question`, `header`, `options`, `multiSelect`, `outside`: the turn began with an event, not in a UI). Your answer is your next message | untrusted |
| `pine/started`, `pine/route-failed` | The daemon started, or a route failed | untrusted |
| `out/source/<name>` | An answer going out. A running source that can send sends it | as published |

Agents cannot publish on `agent/`, `approval/`, `board/`, `pine/`, `question/`, `state/` or `timer/`, and
`add_route` refuses a route that would. Watch events with `pine events -f`, or
`pine events --topic "source/#" --limit 50`.

## Routes

A route is an entry in `routes` in `pine.json`. It does a small job without waking an agent, or
decides first whether to wake one. Most setups don't need one: subscribe the agent to a source,
and use a schedule for set times. Examples are in "The cheapest handler that is enough".

Write a route yourself, or ask an agent (`routes`, `add_route`, `remove_route`). The tools check
the route, and it works without a restart ([setup.md](setup.md), "Routes"). Every agent can add
routes on its own sources and its own state ("An agent's own routes"). Any other route is the
main agent's to add. In the Pine app, Settings >
Events > Routes has a form: When (topic, `when`, throttle or debounce) and Then (Wake an agent,
Set shared state, Publish an event, Ask a model, Make a decision).

| Key | Meaning |
|---|---|
| `name` | For logs and errors. Default `route<n>`. |
| `on` | A topic pattern or a list of them. |
| `when` | A filter. Every entry must hold ("Filters"). |
| `debounceMs` | Handle the last of a burst, once matching events stop for this long. |
| `throttleMs` | Handle one event, then ignore matching ones for this long. |
| `key` | What counts as "the same" for debounce and throttle. Default `{{topic}}`. |
| `set` | Write shared state. `null`, or exactly one `{{path}}` that finds nothing, deletes the key. |
| `publish` | Publish another event: `{ "topic": "...", "payload": {...} }` (default payload below). |
| `call` | One model call without tools, with the event's images if the model reads them: `{ "prompt": "...", "system": "...", "model": "provider/id" }`. Answer in `{{result}}`. |
| `ask` | Typed questions to a decision model, answers in `{{answers.<name>}}` ("Typed questions"). |
| `run` | A command, no model: `{ "command": "python3 ui/answer.py", "agent": "main", "timeout": "30s" }`. Output in `{{output}}` ("Running a script"). |
| `agent` | Give an agent a task. |
| `prompt` | The task text. Default: the payload's `text`, or the payload as JSON. |
| `label` | A short line (template) for the task in `pine tasks` and the UIs. |
| `session` | Conversation template. Default `main`, `new` for one-off work. |
| `whenBusy` | `steer` (default): join the conversation's current work at its next step, or wait if the answer goes elsewhere (Telegram). `queue`: wait until it is free ([agents.md](agents.md), "A message while the agent works"). |
| `priority` | Higher runs first when model slots are scarce. Default 10 for owner events, 0 otherwise. |
| `reply` | Where the answer goes: `{ "topic": "...", "payload": {...} }`. Default: the event's reply target. `false`: nowhere. |
| `trust` | Override the event's trust. `"owner"` gives full tools: only for sources nobody else can write to. `pine check` lists these. |

Without `payload`, `publish` sends the original payload, or after `call`
`{ "text": <answer>, "of": <original> }`, after `ask` `{ "answers": ..., "of": ... }`, after `run`
`{ "output": ..., "answers"?: ..., "of": ... }`.

A route needs at least one of `set`, `publish`, `call`, `ask`, `run` and `agent`. They run in the
order `set`, `call`, `ask`, `run`, `publish`, `agent`, except that `set` comes after `ask` or `run`
to store their result. `call` and `ask` don't go with `agent` or with each other: publish the
result and let a second route wake the agent.

A route on `source/<name>/...` keeps that source running; `source/#` starts nothing. A source
sends what is published on `out/source/<name>` (`<name>@<agent>` for an agent's own) only while it
runs, so give one that nothing subscribes or routes to `"start": "always"`.

Text from an untrusted event reaches the agent cut at `limits.maxEventChars`, with a line in front
that says where it came from and that it is data. Such a run has fewer tools
([security.md](security.md)).

### Templates

`{{path}}` works in `prompt`, `label`, `session`, `key`, `set`, `publish`, `reply`, `call` and the
`data` of `ask`, never in the questions of `ask` or in `run`'s command.

| Path | Value |
|---|---|
| `payload`, `payload.a.b` | The event's payload or a field of it |
| `topic`, `source`, `id`, `ts`, `time` | Event fields. `time` is local, `YYYY-MM-DD HH:MM:SS` |
| `state.<key>` | Shared state, for example `{{state.house/mode}}` |
| `result`, `answers.<name>`, `output` | The route's `call` answer, the answer to its question of that name, and what its `run` printed |

A value that is exactly one `{{path}}` keeps its type. Inside longer text, objects become JSON and
missing values become empty.

### Filters

`when` maps a path to a value (equality) or to conditions:

```json
{
  "payload.value.temperature": { "gt": 30 },
  "payload.value.room": { "in": ["kitchen", "boiler"] },
  "payload.text": { "regex": "^alarm", "flags": "i" },
  "state.house/mode": { "ne": "home" },
  "payload.value.battery": { "exists": true }
}
```

Conditions: `eq`, `ne`, `in`, `gt`, `gte`, `lt`, `lte`, `exists`, `contains`, `regex` (with
optional `flags`).

### The cheapest handler that is enough

A full agent turn costs seconds of model time, and most events don't need one. Here `house` is an
`mqtt` source and `telegram` a `telegram` source in `pine.json`:

```json
[
  { "on": "source/house/message", "when": { "payload.topic": "house/mode" }, "set": { "house/mode": "{{payload.value}}" } },

  { "on": "source/cam/added",
    "debounceMs": "4s",
    "call": { "system": "You look at one camera image. Answer in one line: PERSON, VEHICLE, ANIMAL or NOTHING, then a short description.",
              "prompt": "Camera file {{payload.file}}" },
    "publish": { "topic": "cam/classified", "payload": { "file": "{{payload.file}}", "verdict": "{{result}}" } } },

  { "on": "cam/classified",
    "when": { "payload.verdict": { "regex": "^(PERSON|VEHICLE)" }, "state.house/mode": "away" },
    "agent": "house", "session": "new",
    "prompt": "Camera saw: {{payload.verdict}} ({{payload.file}}). The house is in away mode.",
    "reply": { "topic": "out/source/telegram" } }
]
```

The first route never calls a model. The second makes one call per burst of images. Only a person
or a vehicle seen while nobody is home reaches an agent.

### Running a script

`run` reacts at once with a script the agent wrote, without a model or an agent turn: it switches
a light, writes a file, or updates a page after a click.

```json
{ "name": "desk", "on": "source/ui@main/message", "run": { "command": "python3 ui/answer.py" } }
```

The script gets one line of JSON on stdin: `topic`, `payload`, `trust`, `ts`, `elapsedMs` (since
the event arrived), and `answers` after `ask` or `result` after `call`. What it prints is
`{{output}}` (parsed when it is JSON).

The command is fixed text: nothing of the event goes into it. It runs in the sandbox and
workspace of `run.agent` (default: the main agent), and not at all without a sandbox. It has 30
seconds unless `timeout` says otherwise. A failure fails the route (`pine/route-failed`, with the
end of its stderr).

A subscription to the same source still wakes the agent for every event. To wake it only
sometimes, don't subscribe it: add a second route with a `when` on the answers or the output.

### Typed questions

`ask` puts named questions about the event to a decision model ([configuration.md](configuration.md),
"Decision models"), such as Pinecone on your computer or TypeSafe's Jev. In a fraction of a second
it returns values, such as a probability, that a filter or script reads directly. (`call` returns
text, which a route can match only with a pattern.)

```json
[
  { "name": "mail-judge", "on": "source/inbox/mail",
    "ask": {
      "model": "decider",
      "data": "From {{payload.from}}: {{payload.subject}}\n{{payload.text}}",
      "questions": {
        "urgent": { "type": "yesno", "question": "Does this need an answer today?" },
        "kind": { "type": "choice", "question": "What is it?", "options": { "invoice": "A bill to pay", "personal": "From a person I know", "other": "Anything else" } },
        "tone": { "type": "score", "question": "How upset is the sender?", "levels": ["calm", "annoyed", "angry"] }
      } },
    "publish": { "topic": "mail/judged" } },

  { "name": "mail-urgent", "on": "mail/judged",
    "when": { "payload.answers.urgent.yes": { "gte": 0.8 }, "payload.answers.kind.choice": { "ne": "other" } },
    "agent": "main", "prompt": "Urgent mail: {{payload.of.subject}}" }
]
```

| Question `type` | Takes | Answered as |
|---|---|---|
| `yesno` | `question` | `{ "yes": 0.87 }`: the probability of yes, 0 to 1 |
| `choice` | `question`, `options`: two or more names, each with when it applies | `{ "choice": "invoice" }` |
| `score` | `question`, `levels`: two to ten, lowest first | `{ "level": "annoyed", "score": 1 }`: the level and its place (0 is the lowest) |

- At most 16 questions, named with letters, digits, `-` and `_`, starting with a letter. A filter
  reads an answer as `payload.answers.<name>`.
- Questions are fixed text (a `{{...}}` in them is refused). The event goes into `data` (default:
  the whole payload), cut at `limits.maxEventChars`.
- `model` must be a decision model, not a chat model.
- All questions go in one request. An answer that is missing, not a number from 0 to 1, or not
  one of your names or levels fails the route (`pine/route-failed`), and nothing is published.
- A `choice` or `score` may carry `confidence` (0 to 1). A score may fall between levels (`1.7`,
  `level` the nearest).

No text of the event reaches the answers, which keep the event's trust. An event can sway the
answer (a mail that claims to be urgent), which decides which of your routes acts, never what they
do. You are told where the decision model runs, and so where `data` goes, when you confirm.

### An agent's own routes

Any agent can `add_route` on its own sources' events (`source/<name>@<agent>/...`) or shared
state (`state/agent/<agent>/...`), acting only within itself: ask a decision model (the main agent
adds those), run a script in its sandbox, answer through its own source
(`out/source/<name>@<agent>`), write its own state (`agent/<agent>/...`) or wake itself. Never
with `trust`. You confirm each. `of` ties the route to the agent, so it goes along when the agent
is removed or renamed. A chat that answers on its own:

```json
{ "name": "eightball", "on": "source/telegram@eightball/message", "of": "eightball",
  "ask": { "model": "decider", "data": "{{payload.text}}",
           "questions": { "reply": { "type": "choice", "question": "Which answer of a Magic 8 Ball fits the question?",
             "options": { "It is certain": "a clear yes", "Reply hazy, try again": "cannot tell", "My reply is no": "a clear no" } } } },
  "publish": { "topic": "out/source/telegram@eightball", "payload": { "text": "{{answers.reply.choice}}" } } }
```

The answer is the option exactly as written. Subscribe the agent only to the messages it should
answer itself, if any.

### Trying a route

Instead of waiting for a real event, write shared state. Every write is an event on
`state/<key>`, and an agent may write keys under `agent/<its id>/`. This route fires when the main
agent sets `agent/main/try` with `state_set`, and stores its answer:

```json
{ "name": "try-decider", "on": "state/agent/main/try",
  "ask": { "model": "decider", "data": "{{payload.value}}",
           "questions": { "overdue": { "type": "yesno", "question": "Is the invoice past its due date?" } } },
  "set": { "agent/main/try-answer": "{{answers}}" } }
```

Set `agent/main/try` to a sample text, and a few seconds later read `agent/main/try-answer` with
`state_get`: `{"overdue": {"yes": 0.999}}`. Nothing there means the route failed. Remove the route
afterwards.

## Webhooks

A hook in `http.hooks` is an address that other services call. It only publishes an event, and a
route decides what happens. To wake a subscribed agent, use a source of type `webhook` instead
([source-types.md](source-types.md)). It also answers under `/hook/`, but a hook in `http.hooks`
with the same name comes first.

```json
"http": { "hooks": { "doorbell": { "secret": "${DOORBELL_SECRET}" } } }
```

`POST http://127.0.0.1:7463/hook/doorbell` then publishes `hook/doorbell` with the request body
as payload (parsed JSON, or `{ "text": ... }`). The caller proves itself with
`Authorization: Bearer <secret>`, or with an HMAC-SHA256 of the body with the secret, hex, in
`X-Hub-Signature-256: sha256=<hex>` (GitHub's way) or `X-Signature`.

A hook needs a secret, or `"open": true` to accept anyone who can reach the port (`pine check`
reports it). Unknown names get 404. Each hook takes at most 120 requests a minute and 1 MB bodies.
Events are untrusted even with a valid signature, which proves the sender, not that the content is
safe to obey. From outside your network, use a tunnel or reverse proxy that forwards only `/hook/`.

## When nothing happens

1. `pine events --topic "<pattern>"`: did the event arrive, and on which topic?
2. `pine tasks`: was a task created? `pine task <id>` shows its prompt, result and error.
3. `pine events --topic "pine/#"`: `pine/route-failed` says why a route could not act.
4. The daemon log: `dropped ... after N hops` means pine cut a loop.
5. A filter that never matches usually has a wrong path. Compare it with the real payload from
   step 1.

Sources that report nothing: [sources.md](sources.md), "When nothing happens". Everything else:
[operations.md](operations.md), "Problems".
