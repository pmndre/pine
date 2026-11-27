# How pine works

pine on one page. Each section links to the chapter with the details.

## The picture

pine is a daemon that runs agents. You talk to them in the terminal UI ([tui.md](tui.md)), the Pine
app ([desktop.md](desktop.md), [mobile.md](mobile.md), [web.md](web.md)) or on Telegram. Two things
wake an agent, and two help it work:

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

| Given | Tools | More |
|---|---|---|
| Events: a file arrives, a device reports, a page changes | `add_source`, `subscribe`, `send` | [sources.md](sources.md) |
| Schedules: a task at a set time | `add_schedule` | [events.md](events.md) |
| MCP servers: tools from outside | `add_mcp_server` | [mcp.md](mcp.md) |
| Skills: how something is done, written down | `add_skill` | [agents.md](agents.md) |

Each is set up for the conversation where you asked, for the agent, or (main agent only) for all
agents ([setup.md](setup.md)). Only the main agent creates agents and administers pine. Agents look
up how pine works with their `manual` tool.

## Events

Every event goes into one log, `data/pine.db`, kept for `limits.eventRetentionDays`. An event has a
`topic` (`agent/gonzo/done`), a `payload`, the `source` that published it, and a `trust` (`owner`
or `untrusted`) set by how it entered ([events.md](events.md), "Topics").

## From event to work

- A subscription: the subscribed conversation gets each event of a source as a message. A source
  nobody subscribes to does not run ([sources.md](sources.md)).
- A schedule wakes its agent with its task.
- A route, a rule in `pine.json`, sets state, publishes an event, makes one model call without tools, runs a
  script or wakes an agent ([events.md](events.md), "Routes").

A task is a prompt for one agent in one conversation. A conversation's tasks run one after
another; a message you send while it works goes into that work. Conversations run side by side up
to `limits.maxConcurrentRuns`, and per model up to `limits.models`; a run waiting for a sub-agent or another agent gives up its place.
Conversations survive restarts. Queued tasks then run, and a task that was running is marked
failed, since its tool calls may have had effects.

The answer goes back where the task came from. An answer of exactly `NO_REPLY` sends nothing
([agents.md](agents.md)).

## Agents working together

| Way | What it does |
|---|---|
| `delegate` | Hands work to another agent, held to the stricter of the two modes ([agents.md](agents.md)) |
| `subagent` | Runs copies of the agent in parallel, each with an empty context ([agents.md](agents.md)) |
| Boards, `/swarm` | Shared work and notes; a swarm is a job an agent leads until it is done and checked ([boards.md](boards.md)) |
| `/goal` | An agent keeps working until a judge says the goal is met ([agents.md](agents.md)) |
| `state_get`, `state_set` | Small shared facts ([agents.md](agents.md)) |
| `publish_event`, `send` | An event on an allowed topic; a message through a source that sends ([sources.md](sources.md)) |

A delegation chain cannot revisit an agent or go deeper than `limits.maxDelegationDepth`. An event
more than `limits.maxEventHops` steps from an outside trigger is not routed.

## Trust

How content entered decides what it can do ([security.md](security.md)).

| Content | Runs with |
|---|---|
| Your message (any UI, your paired Telegram account, `pine send`), a schedule | `owner`: the agent's full tools |
| An event a route hands to an agent | `untrusted`: the agent's `untrusted` profile (read-only by default), in a separate session (`~u`) |
| An event of a subscribed source, a web page, a result of an MCP server marked `taints` | The conversation's tools, but it is marked as having read outside content and sending anything out asks you. A source marked as yours does not mark it; `"separate": true` on a subscription runs events as in the row above |
