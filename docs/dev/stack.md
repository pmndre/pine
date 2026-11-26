# Technology: how pine is built on pi

For contributors. What an owner needs (what pine uses of the system, what is not verified) is in
`docs/references/stack.md`; this file is not indexed by the `manual` tool.

## Libraries

| Piece | Role | Notes |
|---|---|---|
| Node 24+ | Runtime | Runs the TypeScript sources directly in a checkout (type stripping); the npm package holds them compiled (`npm run build`). No bundler. |
| `@earendil-works/pi-coding-agent` | The agent loop | Sessions, model calls, tool execution, compaction, retries, MCP client, skills, extensions, embedded through its SDK. |
| `@earendil-works/pi-mcp` | MCP naming | Its function that turns a server name into the prefix of its tool names (`mcpNamespace`). |
| `@earendil-works/pi-tui` | Terminal UI toolkit | Layout, editor with completion, Markdown rendering, for `src/tui/`. |
| `node:sqlite` | Storage | `data/pine.db`, WAL mode. |
| `undici` | HTTP behind `fetch` | Timeouts on the model servers' connection pools; address checks at connect time for the `web` server, `download` and the `http` source. |
| `@playwright/mcp` | Browser automation | A child of `mcp/browser.ts`, which filters its tools and proxies its traffic. |
| `mqtt`; `@slack/web-api`, `@slack/socket-mode` | Source types | Loaded only when such a source starts. pine keeps its own fetch, reconnects and rate-limit waits around Slack's SDK. |
| `marked` | Markdown to HTML | Telegram messages. |
| `highlight.js` | Code colors | The terminal UI. |
| `typebox` | Tool parameter schemas | The library pi uses. |

Development only: `typescript`, `@types/node`, `aedes` (an MQTT broker for the tests).

## How pi is embedded

pi supplies the turn loop, tool-call parsing and repair, compaction, retries, session files and
MCP; pine adds what a daemon of several agents needs around it. Every session is a pi
`AgentSessionRuntime` made in `AgentManager.createLive()`:

- its own `cwd` (the workspace, or the conversation's folder) and `agentDir` (`agents/<id>/`), so
  instructions, skills, settings and session files are per agent, in one process;
- pi's code-mode, tool-search and MCP extensions when the agent has MCP servers (the MCP extension
  with a `loadConfig` that returns nothing, so no file adds a server);
- `coreExtension()`, which registers the agent's MCP servers, replaces the shell and file tools
  with sandboxed ones where the mode has a sandbox, adds `download`, and gates every tool call;
- the tools from `src/tools.ts`.

The baseline measured about 8 MB for 50 sessions in one process.

## What the baseline found

59 checks charted how pi behaves when embedded (`baseline/RESULTS.md`; `npm run baseline` after
upgrading pi). The table "pi behaviours pine depends on" in `AGENTS.md` lists each behaviour and
where pine handles it. Findings that shaped the design beyond that table:

| Finding | Consequence in pine |
|---|---|
| Sessions with different working folders and agent folders work side by side in one process | One process, no worker per agent |
| No built-in sub-agents; the shipped example breaks when embedded | `delegate` and `subagent` are pine tools running child sessions in-process |
| Malformed tool calls come back to the model as readable errors | Nothing to do; it is why a weaker local model is workable |
| Tool calls in one assistant message run in parallel | Slots are lent out per waiting call, not per run |

## The request pi sends

`model, messages, stream, stream_options, store, max_completion_tokens, tools`, and
`reasoning_effort` for reasoning models. `store`, the max-tokens field and the thinking format each
have a `compat` switch in `models.json`. After an aborted run the next request contains two
consecutive user messages.

## Tests

| Suite | Against |
|---|---|
| `npm test` | The scripted model server (`baseline/tests/mock.mjs`); `live:` tests are skipped |
| `npm run test:live` | A real model through `claude -p`, Chromium and the network; on a Mac also the app control, voice and `system` helpers; with `PINE_LIVE_URL`, what a llama.cpp server keeps of a conversation |
| `npm run baseline` | 59 checks of pi itself, on the scripted server |

Tests start a whole daemon in-process on a temp home, with real pieces where it matters: a real
sandbox, a real MQTT broker, real MCP server processes, a fake Telegram API on localhost. See
"Tests" in `AGENTS.md` for the rules.

The Test workflow (`.github/workflows/test.yml`) runs the suite on Ubuntu 24.04 x64 and arm64 with
the sandbox set up as `pine init` does, on macOS and on Windows (no sandbox there: tests run in
`auto` mode and sandbox tests skip themselves).
