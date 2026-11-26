# MCP servers

pine decides which agent gets which MCP server. In your own conversations a server is one tool,
named after it, and each of its tools is an action of that tool: the server `notes` is the tool
`notes` with the action `lookup`. A `-` in the name becomes `_` (`home-link` is the tool
`home_link`), and a server named like one of pine's own tools gets `mcp_` in front (`manual` is
`mcp_manual`). The bundled `web` server is the exception: its tools stay tools of their own
(`mcp__web__search`, `mcp__web__fetch`). Each tool also has a full name,
`mcp__<server>__<tool>` (`mcp__home_link__status`): runs started from outside are given the
tools under those names, and `approve` patterns use them.

The tool's description carries the instructions the server sends when it connects (the first
2048 characters) and a line for each action, so a server written for Claude (a first call that
passes `"new"`, an id to pass on) is used the way its authors meant.

Telegram messages and MQTT commands are not MCP servers but event sources that can send, used
with the `send` tool ([sources.md](sources.md), "Sending through a source").

## Global and per agent

Global servers go in `pine.json`:

```json
"mcp": {
  "web":     { "pine": "web", "agents": ["scout"] },
  "calendar": { "command": "npx", "args": ["-y", "some-calendar-mcp"], "env": { "TOKEN": "${CALENDAR_TOKEN}" } },
  "docs":    { "url": "https://mcp.example.com/mcp", "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" }, "agents": ["main", "gonzo"] }
}
```

Servers of one agent go in its `agent.json`:

```json
{ "mcp": { "library": { "command": "library-mcp", "args": ["--stdio"] } } }
```

| Setting | Effect |
|---|---|
| `agents` on a global server | Which agents get it. Default: all (`["*"]`). |
| `globalMcp: true` in `agent.json` (default) | The agent gets every global server that includes it. |
| `globalMcp: false` | No global servers. |
| `globalMcp: ["web"]` | Exactly these global servers, whether or not their `agents` list names this agent. |
| A server in `agent.json` with a global server's name | Replaces the global one for this agent (an entry with `"enabled": false` does not: the global server stays). |
| `"enabled": false` | Switches a server off without deleting it. |

`pine check` prints the resulting list per agent. Servers you set up for your own interactive pi
(its `mcp.json`) do not reach pine's agents.

## Adding a server

Three ways, all ending in the same entry in `pine.json` (for everyone) or an `agent.json`.

**Ask an agent.** "Connect this MCP server: https://mcp.example.com/mcp", or "look at
example.com and install their MCP server". The agent calls `add_mcp_server` with the URL, or for
a local server the command that starts it (`npx -y @example/mcp@latest`). You get a dialog with
the name, the URL or the command, and who gets it, in every mode, bypass included (in plan mode
the agent only says what it would add). Who gets it:

- Said just like that: the conversation you are in. Only it has the tools, and the server is
  removed with it (in the main conversation that is the agent).
- "For you as an agent": all the agent's conversations.
- "All agents": only the main agent can add or remove those.

The change applies without a restart. The agent does not have the new tools in the turn in which
it added the server, so pine calls it again by itself when that turn ends, in the same
conversation; you need not send a message or start a new conversation.

A server added in one conversation is missing in the agent's others: `/mcp`, `pine mcp list`
and the agent's `mcp_servers` tool say so ("only the conversation X of main"); `mcp_servers`
also says whether each server's tools are there or missing (it did not start, or needs a
sign-in). To have it everywhere, tell the agent "add it for yourself as an agent": it adds it
again with `scope: "agent"`, you confirm (and type any key again), and that entry replaces the
conversation's.

`remove_mcp_server` takes a server out. The main agent signs in to a remote server that needs it
with `sign_in_mcp_server` (you finish in the browser). See [setup.md](setup.md).

**A local server an agent adds** is a program somebody else wrote. It runs where that agent's
commands run (`"sandboxed": true` in its entry) and reaches what its shell reaches:

- In `safe` or `manual` mode: the sandbox (its workspace, its private home folder, the network);
  pine's home is closed to it. Where the machine has no sandbox, such an agent cannot add a local
  server at all.
- In `auto` or `bypass` mode (the main agent, unless you say otherwise): no sandbox. The program
  runs with your rights, your home folder and the network.

Either way it gets nothing of the daemon's environment. The dialog shows the exact command and
which of the two it is: read it, it is what will run. The command is one program with its
arguments; shell operators (`&&`, a pipe, `$(...)`) are refused.

A local server that needs a sign-in: once it has the tools, the agent uses the server's own
action for it (`login`, `sign_in`), or else runs the command the documentation names and gives
you the link it prints. A key the server reads from its environment the agent names (`secrets`,
e.g. `EXAMPLE_API_KEY`), never the value: you type it into the dialog, pine keeps it in `.env`
and removes it with the server.

Your yes makes it a server of yours: using it does not mark the conversation as having read
outside content. It is written with `"approve": "tainted"`: after the conversation has read
something from outside, the server's tools that act ask each time until you answer "Always here";
its read-only tools never ask. If the server returns other people's text (mail, tickets, a web
search), add `"taints": true`; for no questions at all, remove `approve`.

**From a shell.**

```bash
pine mcp add docs https://mcp.example.com/mcp
```

```bash
pine mcp add library --agent gonzo -- /usr/local/bin/library-mcp --stdio
```

Options: `--agent <id>` (only that agent), `--taints`, `--approve always|tainted`,
`--timeout <seconds>`, `--description "..."`, `--exposure direct|codemode|deferred|hidden`. A
remote server needs an https URL (http only on this computer: `localhost`, `127.0.0.1`, `[::1]`).
With a daemon running the change applies at once, otherwise at the next start. `pine mcp remove
<name>` takes it out (`--agent <id>` for one in an `agent.json`). `pine mcp list` shows every
server, who gets it and whether it connects (`--offline`: without connecting):

```
notes          needs sign-in    all: main
               https://gateway.example/d/abc/mcp  [outside content]  [approval: tainted]
web            connected        all: main
               bundled: web  [outside content]
```

**By hand.** Edit the file as below, run `pine check`, restart.

## Signing in (OAuth)

A remote server that answers "unauthorized" and supports OAuth needs you to sign in once:
`pine mcp login notes`, `/mcp login notes` in the terminal UI, or Sign in under Settings > MCP
servers in the app. Your browser opens the server's sign-in page; pine stores the tokens in
`data/pi/mcp-auth.json` (closed to agents) and refreshes them itself. Open conversations get the
server's tools from their next message. `pine mcp logout <name>` deletes the tokens.

The sign-in is pi's: it follows the server's OAuth metadata and registers itself as a client.
For a server that needs a pre-registered client or a particular client name, add an `oauth`
block to the entry (`clientId`, `clientSecret`, `callbackPort`, `clientName`,
`clientRegistration`; pi's `docs/mcp.md` describes each). A server that takes a fixed token needs
no sign-in: `"headers": { "Authorization": "Bearer ${TOKEN}" }`, with the token in `.env`.

## Server entries

An entry has the shape of an `mcpServers` entry in pi's `mcp.json`:

| Key | Meaning |
|---|---|
| `command`, `args`, `env`, `cwd` | A local server started as a child process (stdio). |
| `url`, `headers` | A remote server (streamable HTTP). |
| `exposure` | How tools reach the model. pine's default is `direct`: every tool is declared. `codemode` offers one scripting tool instead, `deferred` makes tools searchable, `hidden` makes them unreachable. Use `deferred` or `codemode` for servers with dozens of tools. |
| `toolExposure` | Per-tool override, e.g. `{ "delete_*": "hidden" }`. |
| `description` | One sentence for the model about what the server offers. |
| `url` (remote servers) | Also where the `download` tool fetches from without asking: the same scheme, host and port. See "Files and pictures from a remote server". |
| `headers` (remote servers) | Sent with every call to the server, and by `download` with a link one of the server's own tools returned in the conversation. Never with any other address, and never for a server with `taints: true`. |
| `timeout` | Seconds one call may take before the agent is told it timed out. Default 60; e.g. `"timeout": 180` for slow tools. |

and the keys pine adds (besides `agents` and `enabled` above):

| Key | Meaning |
|---|---|
| `pine` | Use a server that ships with pine (`"web"`, `"browser"`, `"commands"` or `"computer"`), configured through `options`. |
| `sandboxed` | For a local server: `true` runs it where the commands of the agent that uses it run, with that agent's home folder and environment: in the sandbox in `safe` or `manual` mode, with your rights in `auto` or `bypass` mode. Written by `add_mcp_server` for every local server an agent adds. A server you add yourself (`pine mcp add <name> -- <command>`, or an entry you write) runs as a normal process of yours without it, and what it reaches agents reach through it: give it the narrowest credentials, or set `sandboxed`. |
| `session` | In an `agent.json` only, written by `add_mcp_server`: the one conversation the server was added for; it is removed with that conversation. |
| `taints` | `true` when the server returns content written by others (web pages, mail, tickets, chat): a conversation that calls it is marked. Default `false`; `true` for the bundled `web`, `browser` and `computer`. |
| `approve` | `"always"`: every call asks, each time (except in bypass mode, where nothing asks). `"tainted"`: after outside content, the server's tools that act ask (its read-only tools do not), and you can answer "always in this conversation". Default `"never"`. |

Each conversation starts its own copy of a local server and stops it when the conversation
closes.

A tool the server declares read-only (`readOnlyHint`) is not asked about (unless `"approve":
"always"`), and it is the only kind of MCP tool that runs in plan mode: search and page reading
of `web`, a snapshot or screenshot of the browser, looking at an app. Every other MCP tool is
refused in plan mode, opening a page and every `commands` tool among them.

## Files and pictures from a remote server

A server that makes files (pictures, sound, documents) keeps them where it runs, which for a
server reached over the network can be another computer:

- **A picture in a tool's answer is already shown** where the tool ran. pine tells the agent so,
  and it does not show or fetch it again unless you want the file. (Not when the answer goes to a
  chat such as Telegram, where nothing was drawn.)
- **A file path in an answer is a path on the server's computer.** On the agent's disk it does
  not exist: `cp` and `read` answer "No such file or directory". The agent's prompt names the
  servers reached over the network (every `url` not on `localhost` or `127.0.0.1`) and says so.
- **The agent gets the file with the `download` tool and the link from the answer.** A link on
  the server's own address (scheme, host and port of its `url`) is fetched without a question.
  With `headers` (its key), pine sends them with such a link itself: only for an address one of
  the server's own tools returned in this conversation, exactly as returned, and not for a server
  with `taints: true`. The agent never sees the key. Another address on the server is fetched
  without it; a server that wants it answers 401, and the agent calls the tool again for a fresh
  link. After `/reset` or a restart of pine, earlier links no longer count.
- **`download` says how to show the file.** For a picture, video or sound its answer ends with
  the line to write into the reply: `![short caption](path)`, with the `!`. A plain link
  `[..](..)` shows and plays nothing.

A server of your own is better off returning a name and a link than a path.

## Bundled: web

Search and page reading without a browser.

```json
"web": { "pine": "web", "options": { "braveApiKey": "${BRAVE_API_KEY:-}" }, "agents": ["scout"] }
```

| Tool | What it does |
|---|---|
| `mcp__web__search(query, count?)` | Web search: the Brave Search API when `braveApiKey` is set, otherwise DuckDuckGo's HTML page (fine for light use; it may rate-limit). |
| `mcp__web__fetch(url, max_chars?, start?)` | A page's text. `start` continues a long page. |

| Option | Default | Meaning |
|---|---|---|
| `braveApiKey` | none | Brave Search API key. |
| `allowHosts` | all | Only these hosts (and their subdomains) can be fetched. Without `braveApiKey` the search is such a fetch too: add `duckduckgo.com`. |
| `denyHosts` | none | These cannot. |
| `allowPrivate` | `false` | Allow every address on this computer and your network, without asking. Leave it off: to look at one local address the agent uses the browser, which asks you ("Local addresses"). |
| `maxBytes` | 2 MB | Cut-off for one response. |
| `maxUrlLength` | 2000 | Longer URLs are refused, which limits what can be smuggled out in one. |
| `timeoutMs` | 20000 | Per request. |
| `userAgent` | a desktop Safari | What it says it is when it fetches. |

It speaks only http and https, checks every redirect itself, and refuses loopback, private and
link-local addresses at the moment it connects: a page cannot send an agent to your router, your
NAS or pine's control port. Results are marked as outside content.

Once you have agents with private files, give `web` and `browser` to a research agent with
nothing private in its workspace and let the others delegate to it ([security.md](security.md)).

## Bundled: commands

Turns fixed commands into typed tools, so an agent that should "check the printer" needs no
shell for it.

```json
"tools": { "pine": "commands", "agents": ["house"], "options": { "commands": {
  "printer_status": {
    "description": "Current state of the Bambu printer as JSON",
    "run": ["/opt/homebrew/bin/mosquitto_sub", "-h", "192.168.1.50", "-t", "device/{{serial}}/report", "-C", "1", "-W", "5"],
    "params": { "serial": { "description": "Printer serial", "pattern": "[0-9A-Z]{15}" } },
    "timeoutSec": 10
  },
  "disk_usage": { "description": "Free space on the data volume", "run": ["/bin/df", "-h", "/Volumes/data"] }
} } }
```

| Key | Meaning |
|---|---|
| `description` | What the model reads. |
| `run` | Program and arguments. `{{name}}` inserts a parameter. |
| `params.<name>` | `type` (`string`, `number`, `boolean`), `description`, `enum`, `pattern` (must match the whole value), `default`, `required` (default true). |
| `timeoutSec` | Default 30. |
| `cwd`, `env` | Working folder (default: where the conversation's tools start: the workspace, or the folder opened for the conversation) and extra environment. |
| `sandbox` | `true` runs the command inside the agent's sandbox (no effect on a machine without one). Default `false`: these are your commands, and most need the network. |
| `maxOutput` | Characters of output returned. Default 30000. |

Arguments are passed as a list, never through a shell: a value of `x; rm -rf ~` is one harmless
argument. A value starting with `-` is refused unless the parameter is a number or has a
`pattern` or `enum`, so a value cannot become an option. Constrain parameters with `pattern` or
`enum` wherever you can, and mark the server `"approve": "tainted"` if any command changes
something.

## Bundled: browser

A real browser, for pages that need JavaScript, clicks, forms or a login: Microsoft's Playwright
MCP server with a guard around it.

```json
"browser": { "pine": "browser", "options": { "headed": false } }
```

`pine init` downloads the browser; `pine browser-install` fetches it again after an update.

The tools are `mcp__browser__browser_navigate`, `..._snapshot`, `..._click`, `..._type`,
`..._fill_form`, `..._press_key`, `..._select_option`, `..._hover`, `..._wait_for`, `..._find`,
`..._tabs`, `..._navigate_back`, `..._handle_dialog`, `..._close`, `..._take_screenshot`,
`..._console_messages`. A page is read as a snapshot: a text outline in which every element has
a reference the click and type tools take. A screenshot shows what the page looks like (to a
model that can see); the console messages show why a page the agent built does not work.

### Seeing the browser, and logging in yourself

The browser has no window: the agent works in it unseen. When you want to watch, or a page needs
you (a login, a captcha, a payment to confirm), ask the agent to show the browser. In your own
conversations it has two tools for that:

| Tool | What it does |
|---|---|
| `mcp__browser__browser_show` | The browser becomes a window on the screen of the computer pine runs on, on the agent's page, with the same logins. You click and type in it; the agent goes on working in the same window |
| `mcp__browser__browser_hide` | The window closes and the browser goes on without one, on the same page, with the same logins |

- In the Pine app the browser is beside the conversation, live, and yours to use
  ([desktop.md](desktop.md), "The browser"); `browser_show` opens it there. It is the app's own
  tabs then: `profile`, `headed`, `browser`, `executablePath` and `viewport` do not apply, and
  logins last as long as the app runs. The guard, `allowHosts`, `denyHosts` and the blocked tools
  are the same.
- While the window is open you and the agent share one browser. The agent is told that what you
  ask for on the web is to be done there, on your page, not with a web search.
- The agent does not act on a page it has not seen. If you opened a page or a tab meanwhile, the
  agent is moved to it, and a call that would act (open an address, click, type, close a tab) is
  not carried out: the agent gets your page and works there, or opens a new tab. A call that only
  looks goes through, on your page.
- The page is loaded again when the window appears or goes, so text typed into a form is lost.
  Cookies and site data are kept.
- What you log in to in the window, the agent is logged in to too. Without `profile` the logins
  last until pine restarts or the conversation is reset; with `profile` they are kept.
- A run started from outside does not have these tools. Without a screen (a server, Docker) no
  window can open; the agent is told so.
- `"block": ["browser_show", "browser_hide"]` takes the tools away. `"headed": true` starts the
  browser with a window every time.

| Option | Default | Meaning |
|---|---|---|
| `headed` | `false` | `true`: a window from the start, in every conversation. To see it now and then, ask the agent instead. |
| `profile` | none | A folder for a persistent profile: cookies and logins survive. Without it every session starts clean. |
| `images` | `true` | `false`: a screenshot comes back without its picture, for a model that cannot see. |
| `tools` | `"core"` | `"core"`: the sixteen tools above. `"all"`: everything Playwright offers that is not blocked. Or a list of names. |
| `block` | `[]` | Further tool names to withhold. |
| `allowHosts`, `denyHosts` | none | Limit where the browser may go. Subdomains are included. |
| `allowPrivate` | `false` | Allow every address on this computer and your network, without asking. Leave it off: one local address at a time is allowed by your yes ("Local addresses"). |
| `browser` | `chromium` | `chrome` or `msedge`: an installed browser instead of Playwright's Chromium. |
| `executablePath`, `viewport`, `caps`, `extraArgs` | | Passed on to Playwright MCP. With `"caps": "storage"` and `"tools": "all"` the agent also gets the tools that read and change cookies. |

What the guard does:

- **No local network unless you say yes.** Everything the browser requests goes through a proxy
  that refuses loopback, private and link-local addresses, judged on the address it actually
  connects to, whether by link, redirect, script or DNS trick. The one exception is an address you
  allowed ("Local addresses"). `file:` URLs are blocked.
- **No road around the proxy.** WebRTC and QUIC connections outside the proxy are switched off,
  and the browser looks no names up itself. A page that uses WebRTC still loads; a direct call
  between two computers does not come about.
- **No code on your machine.** `browser_run_code_unsafe`, `browser_file_upload`, `browser_drop`,
  `browser_install`, `browser_storage_state` and `browser_set_storage_state` are removed and
  refused, whatever `tools` says. Tools a page declares itself (WebMCP) are not collected.
- **One step at a time.** Calls issued in parallel run one after another.
- **Snapshots inline**, cut at 24,000 characters (`browser_find` locates things on longer pages).
  A screenshot comes as a picture, with the name of its file.

A browser is the widest door for outside content: conversations that use it are marked, and with
a `profile` it is signed in as you wherever you signed in. Treat a persistent profile like a
password, and do not give it to an agent that also handles untrusted events.

### Local addresses

An agent that builds a web page wants to look at it: a development server on
`http://localhost:5173`, a device at `http://192.168.1.20`. When the agent opens such an address
with `browser_navigate`, pine asks you first. The agent needs no other tool and no
`request_access`: it opens the address and waits.

- A yes allows that host and port for that conversation and its sub-agents, until the
  conversation is reset or the daemon restarts. `localhost:5173` and `127.0.0.1:5173` are two
  questions; so are two ports.
- A no blocks the call. The agent does not try another spelling, or a browser of its own.
- Only what the agent itself opens is asked about. What a page loads, links or redirects to on
  another local address is refused; the page sees a failed request, for a WebSocket the error
  `Establishing a tunnel via proxy server failed`, and pine adds a line to the agent's next
  browser result naming the address. If the page needs it (an API or a WebSocket on another
  port), the agent opens that address with `browser_navigate` once, which asks.
- Asked about are addresses local by their own name: `localhost`, names ending in `.localhost`,
  `.local` or `.internal`, and IP addresses in private ranges. A name that turns out local only
  when looked up (`nas.home`) is refused without a question; for that, set `allowPrivate`.
- pine's own control port is never opened, and never asked about.
- In bypass mode there is no question. A run started from outside cannot ask, nor can a
  sub-agent. After outside content the question says so.
- `allowHosts` and `denyHosts` still apply.

A server the agent starts from its shell (`npm run dev`) can listen only when the shell has
network access: in `auto` and `bypass` mode it has; in the sandbox (`safe`, `manual`) the agent
asks with `request_access` (`network: true`), or you set `sandbox.network`. The agent starts it
in the background (`background: true` on the shell tool) and stops it with `stop_program`
([coding.md](coding.md), "Commands in the background").

## Bundled: computer

Operating the apps on the computer pine runs on: reading a window as an outline, pressing its
controls, clicking in a picture of it, typing. On macOS, Windows, and Linux with X11.

```json
"computer": { "pine": "computer" }
```

Only an agent in `auto` or `bypass` mode has it, in your own conversations, and you are asked once
per app in a conversation. Everything else is in [computer.md](computer.md).
