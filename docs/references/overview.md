# How pine works

pine on one page: what wakes an agent, how an event becomes work, how agents work together, and
what content from outside may do. Each section links to the chapter with the details.

## The picture

pine is a daemon that runs agents. You talk to an agent in the terminal UI ([tui.md](tui.md)), the
Pine app ([desktop.md](desktop.md)) on a computer, phone ([mobile.md](mobile.md)) or in a browser
([web.md](web.md)), or on Telegram. Each agent is given four things, each by asking it: two that
wake it and two it uses while it works.

```
          you:  terminal UI · Pine app · Telegram
                               │
                               ▼
 wake it                 ┌───────────┐            it uses
 events ───────────────► │           │ ◄───────── MCP servers
   Telegram · MQTT · FTP │           │ ◄───────── skills
   webhooks · folders    │   agent   │
   web addresses         │           │
   commands · etc        │           │
 schedules ────────────► │           │
   repeating · once      └─────┬─────┘
                               │  delegate ──► other agents
                               │  subagent ──► copies of itself, in parallel
                               ▼
                 answers · messages · actions
```

| Given | What it is | Tools | More |
|---|---|---|---|
| Events | Something elsewhere wakes the agent: a file arrives, a device reports, a page changes, you write on Telegram | `add_source`, `subscribe`, `send` | [sources.md](sources.md) |
| Schedules | The time wakes the agent with a task: at set times, every so often, or once | `add_schedule` | [events.md](events.md), "Schedules" |
| MCP servers | Tools from outside | `add_mcp_server` | [mcp.md](mcp.md) |
| Skills | How something is done, written down once | `add_skill` | [agents.md](agents.md), "Skills" |

Each is set up for the conversation it was asked in, for the agent, or (by the main agent only)
for all agents; an agent lists what it has with `sources`, `schedules`, `mcp_servers`, `skills`
([setup.md](setup.md)). Only the main agent creates agents and administers pine.

An agent looks up how pine works with its `manual` tool, which searches these pages
([agents.md](agents.md), "The manual tool").

## Events

Everything that happens is an event in one log (`data/pine.db`, kept `limits.eventRetentionDays`).
An event has a `topic` (`source/telegram/message`, `agent/gonzo/done`), a `payload`, the
`source` that published it, and a `trust`: `owner` or `untrusted`, set by how the content entered.
Which topics there are, who publishes each, and how patterns match them:
[events.md](events.md), "Topics".

## From event to work

Three things turn an event into work:

- **A subscription.** A conversation subscribed to a source gets each of its events as a message
  and starts a turn. A source nobody subscribes to does not run. See [sources.md](sources.md).
- **A schedule with a task** wakes its agent with the task. See [events.md](events.md),
  "Schedules".
- **A route**, a rule in `pine.json`: on matching topics it sets state, publishes an event, makes
  one model call without tools, runs a script, or wakes an agent. Most events should stop before
  an agent. See [events.md](events.md), "Routes".

A task is a prompt for one agent in one conversation (session). Tasks of one conversation run one
after another, except a message you send while it works, which goes into that work
([agents.md](agents.md), "A message while the agent works"). Different conversations run side by
side, up to `limits.maxConcurrentRuns`, and a model can have a limit of its own (`limits.models`);
a run that waits for a sub-agent or another agent gives its place up. Conversations are kept on
disk and survive restarts ([agents.md](agents.md), "Sessions"). After a restart queued tasks run, and a task that was
running is marked failed, since its tool calls may already have had effects.

When a task ends, its answer goes to where the task came from (a Telegram chat, your UI). An
answer of exactly `NO_REPLY` sends nothing ([agents.md](agents.md), "What an agent's answer does").

## Agents working together

| Way | What it does | More |
|---|---|---|
| Delegating | `delegate` hands work to another agent, which does it in its own workspace, held to the stricter of the two modes | [agents.md](agents.md), "Handing work to another agent" |
| Sub-agents | `subagent` runs copies of the agent in parallel, each with an empty context, on its model or another | [agents.md](agents.md), "Sub-agents" |
| Boards | What several runs share: work to take and notes | [boards.md](boards.md) |
| A swarm | `/swarm`: you give an agent something to lead until it is done and checked | [boards.md](boards.md), "A swarm" |
| A goal | `/goal`: one agent keeps working until a judge says the goal is met | [agents.md](agents.md), "Goal mode" |
| Shared state | Small facts every agent and route can read (`state_get`, `state_set`) | [agents.md](agents.md), "Shared state" |
| Events and messages | `publish_event` on an allowed topic; `send` through a source that can send (Telegram, MQTT) | [sources.md](sources.md) |

Loops are cut: a delegation chain cannot revisit an agent or go deeper than
`limits.maxDelegationDepth`, and events more than `limits.maxEventHops` steps from an outside
trigger are not routed.

## Trust

How content entered decides what it can do; the rest is in [security.md](security.md).

| Content | Arrives as | Runs with |
|---|---|---|
| Your message (terminal UI, Pine app, your paired Telegram account, `pine send`), a schedule | `owner` | The agent's full tool set |
| An event a route hands to an agent (a webhook, an MQTT message, a new file) | `untrusted` | The agent's `untrusted` profile (read-only tools by default), in a separate session (`~u`) |
| An event of a source a conversation subscribes to | data in that conversation; marks it as having read outside content, unless the source is marked as yours | The conversation's tools; sending something out then asks you. With `"separate": true` on the subscription, as the row above |
| A web page, or the result of an MCP server marked `taints` | marks the conversation | The full tool set; sending something out then asks you |
