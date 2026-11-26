# Schedules and routes

> To let an agent react to a folder, a device or a web request, ask it, or configure a
> [source](sources.md) and have the agent subscribe. To have it do something at a time, ask it
> too ("Schedules" below). Routes are for rules of your own: setting state, chaining events,
> single model calls, scripts.

## Topics

A topic is a slash-separated name. Patterns use `+` for exactly one level and `#` for the rest:

| Pattern | Matches |
|---|---|
| `cam/front/motion` | only that topic |
| `cam/+/motion` | `cam/front/motion`, `cam/back/motion` |
| `source/#` | everything below `source`, and `source` itself |
| `#` | everything |

Where events come from, and the topics a route can listen to:

| Topic | Published when | Trust |
|---|---|---|
| `source/<name>/<event>` (`source/<name>@<agent>/<event>` for an agent's own) | An event source reported ([sources.md](sources.md)) | untrusted; owner for a source with `"trust": "owner"` (`add_source` writes that for a Telegram account you paired) |
| `hook/<name>` (or the hook's `topic`) | `POST /hook/<name>` of `http.hooks` was called ("Webhooks") | untrusted |
| whatever you name | `pine emit`, `POST /events` | owner (untrusted if the request says so) |
| `timer/<name>` (`timer/<name>@<agent>` for an agent's own) | A schedule fired | owner |
| topics in the agent's `publish` list | An agent called `publish_event` | owner, or untrusted if the run was restricted |
| `board/<name>/task`, `/note`, `/done`, `/failed`, `/blocked` | Something happened on a board with a name ([boards.md](boards.md), "Events of a board") | owner for a post from your own conversation that read nothing from outside, untrusted otherwise |
| `state/<key>` | Shared state changed (payload `value`, `previous`) | untrusted |
| `agent/<id>/started`, `agent/<id>/done`, `agent/<id>/failed` | A task started or ended | untrusted |
| `agent/<id>/tool` | A tool call started or ended (live only, not stored) | untrusted |
| `agent/<id>/goal`, `agent/<id>/swarm` | A goal or a swarm changed ([agents.md](agents.md), "Goal mode"; [boards.md](boards.md), "A swarm") | untrusted |
| `approval/requested`, `approval/decided` | An approval was asked or answered | untrusted |
| `pine/started`, `pine/route-failed` | The daemon started; a route failed | untrusted |
| `out/source/<name>` | An answer going out: a source that can send sends what is published here, while it runs | as published |

Agents cannot publish on `agent/`, `approval/`, `board/`, `pine/`, `state/` or `timer/`, and
`add_route` refuses a route that would.

Watch them with `pine events -f`, or `pine events --topic "source/#" --limit 50`.

## Routes

A route is an entry in `routes` in `pine.json`. Write it yourself, or ask the main agent
(`routes`, `add_route`, `remove_route`: checked, no restart; [setup.md](setup.md), "Routes"). In
the Pine app, Settings > Events > Routes adds one with a form: When (the topic, a `when`, a
throttle or debounce) and Then (Wake an agent, Set shared state, Publish an event, Ask a model,
Make a decision).

Most setups need no route: an agent that reacts to a source is subscribed to it, and work at a
time is a schedule. A route does a small job without waking an agent, or decides first whether
one should be woken.

```json
{
  "name": "front-door",
  "on": "source/house/message",
  "when": { "payload.topic": "house/door/front", "payload.value.open": true, "state.house/mode": "away" },
  "throttleMs": "5m",
  "agent": "house",
  "prompt": "The front door was opened at {{time}} while the house is in away mode.",
  "session": "new",
  "reply": { "topic": "out/source/telegram" }
}
```

Here `house` is an `mqtt` source and `telegram` a `telegram` source in `pine.json`. For a source
an agent set up for itself the topic carries its name: `out/source/telegram@main`. A route on a
source by its name (`source/<name>/...`) keeps that source running, as a subscription does; a
wider pattern (`source/#`) starts nothing. A source sends what is published on
`out/source/<name>` only while it runs: for a source that nothing subscribes or routes to by
name, set `"start": "always"` on it.

**An agent's own routes.** Any agent can make routes with `add_route` on its own sources' events
(`source/<name>@<agent>/...`) or its own shared state (`state/agent/<agent>/...`), acting only
within itself: ask a decision model (the main agent adds those), run a script in its sandbox, answer through its own source
(`out/source/<name>@<agent>`), write its own state (`agent/<agent>/...`), or wake itself; never
with `trust`. You confirm each; `of` in the route ties it to the agent, so it goes with it when
the agent is removed or renamed. A chat that answers on its own:

```json
{ "name": "eightball", "on": "source/telegram@eightball/message", "of": "eightball",
  "ask": { "model": "decider", "data": "{{payload.text}}",
           "questions": { "reply": { "type": "choice", "question": "Which answer of a Magic 8 Ball fits the question?",
             "options": { "It is certain": "a clear yes", "Reply hazy, try again": "cannot tell", "My reply is no": "a clear no" } } } },
  "publish": { "topic": "out/source/telegram@eightball", "payload": { "text": "{{answers.reply.choice}}" } } }
```

An option comes back as the answer exactly as written. Subscribe the agent only to the messages
it should answer itself, or not at all.

| Key | Meaning |
|---|---|
| `name` | For logs and errors. Default `route<n>`. |
| `on` | A topic pattern or a list of them. |
| `when` | A filter; every entry must hold. See "Filters". |
| `debounceMs` | Wait until no matching event came for this long, then handle the last one. For bursts. |
| `throttleMs` | Handle one event, then ignore matching ones for this long. For repeating alarms. |
| `key` | Template for what counts as "the same" for debounce and throttle. Default `{{topic}}`. |
| `set` | Write shared state: `{ "house/mode": "{{payload.value}}" }`. `null`, or exactly one `{{path}}` that finds nothing, deletes the key. |
| `publish` | Publish another event: `{ "topic": "...", "payload": {...} }`. Without `payload`: the original payload; after `call`, `{ "text": <answer>, "of": <original> }`; after `ask`, `{ "answers": ..., "of": ... }`; after `run`, `{ "output": ..., "answers"?: ..., "of": ... }`. |
| `call` | One model call without tools: `{ "prompt": "...", "system": "...", "model": "provider/id" }`. Its answer is `{{result}}`. It gets the event's images if the model reads them. |
| `ask` | Typed questions to a decision model: `{ "questions": {...}, "data": "...", "model": "decider" }`. Answers are `{{answers.<name>}}`. See "Typed questions". |
| `run` | A command, no model: `{ "command": "python3 ui/answer.py", "agent": "main", "timeout": "30s" }`. Its output is `{{output}}`. See "Running a script". |
| `agent` | Give an agent a task. |
| `prompt` | The task text. Default: the payload's `text`, or the payload as JSON. |
| `label` | A short line for the task in `pine tasks` and the UIs. A template. |
| `session` | Conversation template. Default `main`; `new` for one-off work. |
| `whenBusy` | `steer` (default): an event for a conversation that is working goes into that work, which reads it at its next step; one whose answer goes elsewhere (a Telegram message) waits instead. `queue`: wait until the conversation is free ([agents.md](agents.md), "A message while the agent works"). |
| `priority` | Higher runs first when model slots are scarce. Default 10 for owner events, 0 otherwise. |
| `reply` | Where the agent's answer goes: `{ "topic": "...", "payload": {...} }`. Default: the event's own reply target. `false`: nowhere. |
| `trust` | Override the event's trust. `"owner"` gives events on this route the agent's full tools: only for sources nobody else can write to. `pine check` lists such routes. |

A route needs at least one of `set`, `publish`, `call`, `ask`, `run`, `agent`. They run in the
order `set`, `call`, `ask`, `run`, `publish`, `agent`; with `ask` or `run`, `set` comes after
them so it can store their result. `call` and `ask` do not go with `agent` (nor with each other):
publish the result and let a second route wake the agent.

### Running a script

`run` reacts at once, without a model and without waking an agent: a script the agent wrote
switches a light, writes a file, updates a page. Each event then costs the script, not a turn.

```json
{ "name": "desk", "on": "source/ui@main/message",
  "ask": { "model": "decider", "data": "{{payload.value.text}}",
           "questions": { "urgent": { "type": "yesno", "question": "Is it urgent?" } } },
  "run": { "command": "python3 ui/answer.py" } }
```

The script gets one line of JSON on stdin: `topic`, `payload`, `trust`, `ts`, `elapsedMs` (since
the event arrived), and `answers` after `ask` or `result` after `call`. What it prints is
`{{output}}` (parsed when it is JSON). The command is fixed text: nothing of the event goes into
the command line. It runs in the sandbox and workspace of `run.agent` (default: the main agent),
as that agent's sources run commands, and not at all where there is no sandbox. 30 seconds at
most unless `timeout` says otherwise; a failure fails the route (`pine/route-failed`, with the end
of its stderr).

A route and a subscription are separate: an agent subscribed to the same source is still woken
for every event. For "a script, and the agent only sometimes", do not subscribe it; add a second
route that wakes it with a `when` on the answers or the output.

### Trying a route

Write shared state instead of waiting for a real event. Every write is an event on
`state/<key>`, and an agent may write keys under `agent/<its id>/`. A route on
`state/agent/main/try` fires when the main agent sets `agent/main/try` with `state_set`;
`{{payload.value}}` is what it wrote. Let the route write its result into state too:

```json
{ "name": "try-decider", "on": "state/agent/main/try",
  "ask": { "model": "decider", "data": "{{payload.value}}",
           "questions": { "overdue": { "type": "yesno", "question": "Is the invoice past its due date?" } } },
  "set": { "agent/main/try-answer": "{{answers}}" } }
```

`state_set` `agent/main/try` to a sample text, then `state_get` `agent/main/try-answer` a few
seconds later: `{"overdue": {"yes": 0.999}}`. Nothing there means the route failed. Remove the
route afterwards.

### Templates

`{{path}}` is replaced in `prompt`, `label`, `session`, `key`, `set`, `publish`, `reply`, `call`
and the `data` of `ask` (never in its questions or in `run`'s command).

| Path | Value |
|---|---|
| `payload`, `payload.a.b` | The event's payload or a field of it |
| `topic`, `source`, `id`, `ts`, `time` | Event fields; `time` is local, `YYYY-MM-DD HH:MM:SS` |
| `state.<key>` | Shared state, for example `{{state.house/mode}}` |
| `result` | The answer of the route's `call` |
| `answers.<name>` | The answer to the route's question of that name |
| `output` | What the route's `run` printed |

A value that is exactly one `{{path}}` keeps its type; inside longer text, objects become JSON and
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

A full agent turn costs seconds of model time; most events do not need one.

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

The first route never calls a model, the second makes one call per burst of images, and only a
person or a vehicle while nobody is home reaches an agent.

### Typed questions

`call` answers with text, which a second route can only match with a pattern. `ask` puts named
questions about the event to a decision model ([configuration.md](configuration.md), "Decision
models": Pinecone on your computer, TypeSafe's Jev) and gets back values a filter or a script
reads as they are, in a fraction of a second.

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

At most 16 questions; a name is letters, digits, `-` and `_`, starting with a letter, and a filter
reads its answer as `payload.answers.<name>`. The questions are fixed text: a `{{...}}` in them is
refused. What the event carries goes into `data` (default: the whole payload), cut at
`limits.maxEventChars`.

`model` names a decision model; a chat model does not answer these (use `call`). All questions
of a route go in one request, and the answer is checked: every question answered, a number from 0
to 1, one of your option names or levels. Anything else fails the route (`pine/route-failed`)
and publishes nothing. A `choice` or `score` may also carry `confidence` (0 to 1), and a score
may fall between levels (`1.7`, with `level` the nearest). So no text of the event reaches the
answers, and they keep the event's trust: answers about an untrusted mail are untrusted. An
event can lean on the answer (a mail that claims to be urgent), which decides which of your
routes acts, never what they do. The `data` goes to wherever the decision model runs, which you
are told when you confirm the route.

Text from untrusted events is prefixed for the agent with a line that says where it came from and
that it is data, and cut at `limits.maxEventChars`. The protection is that such a run has fewer
tools ([security.md](security.md)).

## Schedules

A schedule is something that happens because of the time, again and again or once. It has the
same three scopes as sources, MCP servers and skills ([setup.md](setup.md), "Three scopes").

### Ask the agent

> Every weekday at seven, check my mail and tell me on Telegram what matters.

> Remind me at five to call the dentist.

> In twenty minutes, look whether the build is through.

The agent calls `add_schedule` with a name, the task in its own words, and one of:

| Option | When |
|---|---|
| `cron` | Set times, five fields in local time: "every weekday at six in the evening" is `"0 18 * * 1-5"` |
| `every` | An interval, at least a minute (`15m`, `2h`) |
| `at` | Once, at a local time (`2026-12-24 17:00`); not in the past |
| `in` | Once, after this long (`10s`, `20m`) |

When it is time, the agent is woken with the task, also when you are not there. It counts as
your wish: the agent has its usual tools and nothing is marked as outside content.

| Said | Who is woken |
|---|---|
| in a side conversation | That conversation; the schedule goes when the conversation is removed |
| in the agent's main conversation, or "as an agent" | The agent's main conversation |
| "all agents" (main agent only) | Every agent, each in its main conversation |

What you are asked: [setup.md](setup.md), "What you are asked". After outside content you are
asked in every case, with the task shown. `schedules` lists what is scheduled and when it is next
due; `remove_schedule` ends one; `pine schedules` lists everything.

A name is unique among all schedules; a task has at most 4000 characters. A one-off removes
itself once it has fired. A one-off, or a `cron` schedule with a task, that was due while pine
was not running is done once when pine starts again (a `cron` time only up to seven days back),
and the agent is told it comes late. An `every` schedule starts counting again.

### In the files

```json
"schedules": [
  { "name": "brief", "cron": "30 7 * * 1-5", "task": "Prepare the morning brief and send it to me on Telegram." },
  { "name": "dentist", "at": "2026-11-12T17:00", "task": "Remind me to call the dentist." },
  { "name": "printer-check", "every": "10m" }
]
```

In an `agent.json` this is that agent's schedule (its main conversation, or the one `session`
names). In `pine.json` a schedule with a task wakes every agent; one without a task only
publishes an event.

| Key | Meaning |
|---|---|
| `name` | Required. A lowercase letter, then lowercase letters, digits, `-` and `_`; 40 characters at most. |
| `cron` | Five fields, local time: minute, hour, day of month, month, day of week (0 or 7 is Sunday). Lists, ranges and steps work: `*/15 8-18 * * 1-5`. |
| `every` | A fixed interval instead. |
| `at` | Once, at this local time. Removed when it has fired; if pine was down then, it fires late at the next start. |
| `task` | What the agent is to do. Required in an `agent.json`. |
| `topic` | The topic of its event, instead of `timer/<name>` (`timer/<name>@<agent>` for an agent's own). |
| `session` | In an `agent.json`: the conversation that is woken. Default: the main one. |
| `payload` | Fields added to the event's payload (`name` and `scheduled` are always there; `late` when it comes late, `task` when it has one). |
| `catchUp` | For `cron`: fire once at startup for a time missed in the last seven days, marked late. Default: `true` with a task, `false` without. `at` always catches up; `every` never does. |

### Schedules and routes

Every schedule also publishes an event, trusted as yours, so a route can act on it. A schedule
without a task does only that:

```json
{ "on": "timer/printer-check", "call": { "prompt": "..." } }
```

For "wake the agent and let it do this", give the schedule a task; no route is needed.

## Webhooks

```json
"http": { "hooks": { "doorbell": { "secret": "${DOORBELL_SECRET}" } } }
```

`POST http://127.0.0.1:7463/hook/doorbell` then publishes `hook/doorbell` with the request body
as payload (parsed JSON, or `{ "text": ... }`). The caller proves itself with either

- `Authorization: Bearer <secret>`, or
- an HMAC-SHA256 of the body with the secret, hex, in `X-Hub-Signature-256: sha256=<hex>`
  (GitHub's way) or `X-Signature`.

A hook needs a secret; `"open": true` instead accepts anyone who can reach the port and is
reported by `pine check`. Unknown names get 404. Each hook takes at most 120 requests a minute
and bodies up to 1 MB. Webhook events are untrusted even with a right signature: it says who
sent it, not that its content is safe to obey. From outside your network, put a tunnel or
reverse proxy in front and forward only `/hook/`.

A hook here only publishes an event; a route decides what happens. For a webhook that wakes a
subscribed agent, use a source of type `webhook` ([source-types.md](source-types.md)), which
answers under `/hook/` too; a hook in `http.hooks` with the same name comes first.

## When nothing happens

1. `pine events --topic "<pattern>"`: did the event arrive, and on which topic?
2. `pine tasks`: was a task created? `pine task <id>` shows its prompt, result and error.
3. `pine events --topic "pine/#"`: `pine/route-failed` says why a route could not act.
4. The daemon log: `dropped ... after N hops` means a loop was cut.
5. A filter that never matches usually has a wrong path: compare with the real payload from
   step 1.

For sources that report nothing, see [sources.md](sources.md), "When nothing happens"; for
everything else, [operations.md](operations.md), "Problems".
