# MCP servers, web search and the browser

An MCP server gives agents the tools of another program or service. This chapter covers adding
one, deciding which agent gets it, signing in, and the four servers pine brings: `web` (search
and page reading), `commands` (fixed commands as tools), `browser` (a real browser) and
`computer` (the apps on this computer).

## Adding a server

**Ask an agent.** "Connect this MCP server: https://mcp.example.com/mcp" or "install example.com's
MCP server". The agent calls `add_mcp_server` with the URL, or for a local server the command
(`npx -y @example/mcp@latest`), and you confirm in every mode. By default it is for this
conversation only (removed with it); "for you as an agent" makes it the agent's; "all agents"
only the main agent can add or remove. It works without a restart: when the turn that added it
ends, pine calls the agent again with the new tools.

A server added in one conversation is missing in the others. `/mcp`, `pine mcp list` and the
agent's `mcp_servers` tool say where each server is, and `mcp_servers` says whether its tools are
there (missing: it did not start, or needs a sign-in). "Add it for yourself as an agent" moves it
to the agent scope (you confirm, and type any key again). `remove_mcp_server` takes one out; the
main agent signs in to a remote server with `sign_in_mcp_server`. See [setup.md](setup.md).

A **local server an agent adds** runs where that agent's commands run (`"sandboxed": true`): in
the sandbox in `safe` or `manual` mode (no local server at all where the machine has no sandbox),
with your rights in `auto` or `bypass` mode. It gets nothing of the daemon's environment. The
dialog shows the exact command: read it. It is one program with arguments; `&&`, pipes and
`$(...)` are refused. If it needs a sign-in, the agent uses the server's own action (`login`) once
it has the tools, or runs the documented login command and gives you the link. A key it reads
from its environment the agent names in `secrets` (e.g. `EXAMPLE_API_KEY`); you type the value
into the dialog, and pine keeps it in `.env`.

An agent's server is written with `"approve": "tainted"` and does not mark the conversation. Add
`"taints": true` if it returns other people's text (mail, tickets, search); remove `approve` for
no questions at all.

**From a shell.**

```bash
pine mcp add docs https://mcp.example.com/mcp
pine mcp add library --agent gonzo -- /usr/local/bin/library-mcp --stdio
pine mcp remove library --agent gonzo
pine mcp list            # who gets each server and whether it connects; --offline skips connecting
```

Options of `add`: `--agent <id>`, `--taints`, `--approve always|tainted`, `--timeout <seconds>`,
`--description "..."`, `--exposure direct|codemode|deferred|hidden`. A remote server needs https
(http only on `localhost`, `127.0.0.1`, `[::1]`). A running daemon applies it at once.

**By hand.** Edit the file ([Global and per agent](#global-and-per-agent)), run `pine check`,
restart.

## Signing in (OAuth)

A remote server that answers "unauthorized" needs one sign-in: `pine mcp login <name>`, `/mcp
login <name>` in the terminal UI, or Sign in under Settings > MCP servers. The browser opens; the
tokens are kept in `data/pi/mcp-auth.json` (closed to agents) and refreshed. `pine mcp logout
<name>` deletes them. For a server that needs a pre-registered client, add an `oauth` block
(`clientId`, `clientSecret`, `callbackPort`, `clientName`, `clientRegistration`; pi's
`docs/mcp.md`). A server with a fixed token needs no sign-in: `"headers": { "Authorization":
"Bearer ${TOKEN}" }`.

## Global and per agent

```json
"mcp": {
  "web":     { "pine": "web", "agents": ["scout"] },
  "calendar": { "command": "npx", "args": ["-y", "some-calendar-mcp"], "env": { "TOKEN": "${CALENDAR_TOKEN}" } },
  "docs":    { "url": "https://mcp.example.com/mcp", "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" }, "agents": ["main", "gonzo"] }
}
```

In `pine.json` for everyone; the same `mcp` key in an `agent.json` for that agent.

| Setting | Effect |
|---|---|
| `agents` on a global server | Which agents get it. Default: all (`["*"]`). |
| `globalMcp: true` in `agent.json` (default) | The agent gets every global server that includes it. |
| `globalMcp: false` | No global servers. |
| `globalMcp: ["web"]` | Exactly these global servers, whatever their `agents` list says. |
| A server in `agent.json` with a global server's name | Replaces the global one for this agent (unless it has `"enabled": false`: then the global one stays). |
| `"enabled": false` | Switches a server off without deleting it. |

`pine check` prints each agent's list. The servers in your own pi's `mcp.json` do not reach
pine's agents.

## Server entries

| Key | Meaning |
|---|---|
| `command`, `args`, `env`, `cwd` | A local server (stdio). Each conversation runs its own copy. |
| `url`, `headers` | A remote server (streamable HTTP). `headers` also go with a `download` of a link the server's own tools returned in the conversation, and nowhere else (never for a `taints` server). |
| `exposure` | `direct` (pine's default: every tool declared), `codemode` (one scripting tool), `deferred` (searchable), `hidden` (unreachable). `deferred` or `codemode` for servers with dozens of tools. |
| `toolExposure` | Per tool, e.g. `{ "delete_*": "hidden" }`. |
| `description` | One sentence on what it offers. |
| `timeout` | Seconds per call. Default 60. |
| `pine` | A bundled server: `"web"`, `"browser"`, `"commands"` or `"computer"`, with `options`. |
| `sandboxed` | A local server runs where the commands of the agent that uses it run (sandbox or your rights, by mode). Written for every server an agent adds. One you add yourself runs as your process without it: give it narrow credentials, or set it. |
| `session` | Written by `add_mcp_server`: the one conversation that has it. |
| `taints` | Its results are outside content and mark the conversation. Default `false`; `true` for bundled `web`, `browser`, `computer`. |
| `approve` | `"always"`: every call asks (except in bypass mode). `"tainted"`: after outside content, its tools that act ask; "always in this conversation" settles it. Default `"never"`. |

A tool the server declares read-only (`readOnlyHint`) is never asked about (unless `"approve":
"always"`) and is the only MCP tool that runs in plan mode. How approvals work:
[security.md](security.md), "4. Taint and approvals".

## How the agent sees a server

In your own conversations a server is one tool named after it (`-` becomes `_`; a name of one of
pine's own tools gets `mcp_` in front: `manual` is `mcp_manual`), and each of its tools is an
action of it. The bundled `web` server's tools stay tools of their own (`mcp__web__search`,
`mcp__web__fetch`). Every tool also has a full name, `mcp__<server>__<tool>`, which runs started
from outside use and `approve` patterns match. The tool's description carries the usage notes
(instructions) the server sends when it connects, up to 2048 characters, so the agent uses the
server as its authors meant.

Telegram and MQTT are not MCP servers but sources that send ([sources.md](sources.md), "Sending
through a source").

## Files and pictures from a remote server

- **A picture in a tool's answer is already shown**; the agent does not show or fetch it again.
- **A file path in an answer is a path on the server's computer**: `cp` and `read` answer "No
  such file or directory". The agent's prompt names the servers reached over the network.
- **The agent fetches the file with `download` and the link from the answer.** A link on the
  server's own address (scheme, host, port of its `url`) needs no question, and pine adds the
  server's `headers` for a link one of its tools returned in this conversation, exactly as
  returned. Another address gets no key (a 401 means: call the tool again for a fresh link).
  Links stop counting after `/reset` or a restart.
- **`download` says how to show the file**: `![short caption](path)`, with the `!`. A plain link
  shows and plays nothing.

## Bundled: web

Search and page reading without a browser.

```json
"web": { "pine": "web", "options": { "braveApiKey": "${BRAVE_API_KEY:-}" }, "agents": ["scout"] }
```

| Tool | What it does |
|---|---|
| `mcp__web__search(query, count?)` | Brave Search with `braveApiKey`, otherwise DuckDuckGo's HTML page (may rate-limit). |
| `mcp__web__fetch(url, max_chars?, start?)` | A page's text; `start` continues a long one. |

| Option | Default | Meaning |
|---|---|---|
| `braveApiKey` | none | Brave Search API key. |
| `allowHosts` | all | Only these hosts and their subdomains. Without `braveApiKey` add `duckduckgo.com`. |
| `denyHosts` | none | Never these. |
| `allowPrivate` | `false` | Every address on this computer and your network, without asking. Leave it off; the browser asks per address ("Local addresses"). |
| `maxBytes` | 2 MB | Per response. |
| `maxUrlLength` | 2000 | Longer URLs are refused. |
| `timeoutMs` | 20000 | Per request. |
| `userAgent` | a desktop Safari | What it says it is. |

Only http and https; every redirect is checked; loopback, private and link-local addresses are
refused. Give `web` and `browser` to an agent with nothing private and let the others delegate
([security.md](security.md)).

## Bundled: commands

Fixed commands as typed tools, so an agent needs no shell to "check the printer".

```json
"tools": { "pine": "commands", "agents": ["house"], "options": { "commands": {
  "printer_status": {
    "description": "Current state of the Bambu printer as JSON",
    "run": ["/opt/homebrew/bin/mosquitto_sub", "-h", "192.168.1.50", "-t", "device/{{serial}}/report", "-C", "1", "-W", "5"],
    "params": { "serial": { "description": "Printer serial", "pattern": "[0-9A-Z]{15}" } },
    "timeoutSec": 10
  }
} } }
```

| Key | Meaning |
|---|---|
| `description` | What the model reads. |
| `run` | Program and arguments; `{{name}}` inserts a parameter. Never through a shell. |
| `params.<name>` | `type` (`string`, `number`, `boolean`), `description`, `enum`, `pattern` (whole value), `default`, `required` (default true). A value starting with `-` is refused unless the parameter is a number or has `pattern` or `enum`. |
| `timeoutSec` | Default 30. |
| `cwd`, `env` | Working folder (default: the conversation's) and extra environment. |
| `sandbox` | `true`: run inside the agent's sandbox. Default `false`. |
| `maxOutput` | Characters returned. Default 30000. |

Mark the server `"approve": "tainted"` if a command changes something.

## Bundled: browser

A real browser for JavaScript, clicks, forms and logins: Playwright's MCP server behind a guard.

```json
"browser": { "pine": "browser", "options": { "headed": false } }
```

`pine init` downloads it; `pine browser-install` fetches it again. The tools are
`mcp__browser__browser_navigate`, `..._snapshot`, `..._click`, `..._type`, `..._fill_form`,
`..._press_key`, `..._select_option`, `..._hover`, `..._wait_for`, `..._find`, `..._tabs`,
`..._navigate_back`, `..._handle_dialog`, `..._close`, `..._take_screenshot`,
`..._console_messages`. A snapshot is a text outline whose references the click and type tools
take (cut at 24,000 characters; `browser_find` searches longer pages).

| Option | Default | Meaning |
|---|---|---|
| `headed` | `false` | A window from the start, in every conversation. |
| `profile` | none | A folder that keeps cookies and logins. Treat it like a password. |
| `images` | `true` | `false`: screenshots without the picture, for a model that cannot see. |
| `tools` | `"core"` | The sixteen tools above; `"all"`: everything not blocked; or a list. |
| `block` | `[]` | Further tools to withhold. |
| `allowHosts`, `denyHosts` | none | Where it may go, subdomains included. |
| `allowPrivate` | `false` | Every local address without asking. Leave it off ("Local addresses"). |
| `browser` | `chromium` | `chrome` or `msedge`: an installed browser. |
| `executablePath`, `viewport`, `caps`, `extraArgs` | | Passed to Playwright MCP. `"caps": "storage"` with `"tools": "all"` adds the cookie tools. |

The guard sends every request through a proxy that refuses loopback, private and link-local
addresses (except one you allowed), switches off WebRTC and QUIC outside it, blocks `file:`,
runs parallel calls one after another, and always withholds `browser_run_code_unsafe`,
`browser_file_upload`, `browser_drop`, `browser_install`, `browser_storage_state` and
`browser_set_storage_state`.

### Seeing the browser, and logging in yourself

The browser has no window. When you want to watch, or a page needs you (a login, a captcha, a
payment), ask the agent to show it:

| Tool | What it does |
|---|---|
| `mcp__browser__browser_show` | A window on the screen of the computer pine runs on, same page, same logins. You click and type; the agent goes on in it |
| `mcp__browser__browser_hide` | The window closes; the browser goes on without it |

- In the Pine app the browser is beside the conversation ([desktop.md](desktop.md), "The
  browser"); `profile`, `headed`, `browser`, `executablePath` and `viewport` do not apply there.
- With the window open you share one browser. If you opened another page or tab, the agent is
  moved there and an acting call is not carried out, so your page is never replaced behind your
  back.
- The page reloads when the window opens or closes: typed form text is lost, cookies stay.
- Your logins are the agent's too: until a restart or reset, or kept with `profile`.
- Not for a run started from outside; no window without a screen.
- `"block": ["browser_show", "browser_hide"]` removes them; `"headed": true` always has a window.

### Local addresses

When the agent opens a local address with `browser_navigate` (a dev server on
`http://localhost:5173`, a device at `http://192.168.1.20`), pine asks you. No other tool or
`request_access` is needed.

- A yes allows that host and port for the conversation and its sub-agents until reset or restart;
  `localhost:5173` and `127.0.0.1:5173` are two questions.
- A no blocks it; the agent tries no other spelling.
- Only what the agent opens is asked about. What a page itself loads from another local address
  is refused: a failed request, for a WebSocket `Establishing a tunnel via proxy server failed`,
  and pine names the address in the next browser result. The agent opens that address once with
  `browser_navigate` to be asked.
- Asked about: `localhost`, names ending in `.localhost`, `.local`, `.internal`, and private IP
  addresses. A name that is local only after lookup (`nas.home`) is refused; use `allowPrivate`.
- pine's control port is never opened. Bypass mode does not ask; a run from outside and a
  sub-agent cannot ask.

A dev server the agent starts needs network for its shell: in the sandbox, `request_access` with
`network: true` (or `sandbox.network`). It starts it with `background: true` and stops it with
`stop_program` ([coding.md](coding.md), "Commands in the background").

## Bundled: computer

Operating the apps on the computer pine runs on (macOS, Windows, Linux with X11): `"computer": {
"pine": "computer" }`. Only for an agent in `auto` or `bypass` mode, in your own conversations,
asked once per app. See [computer.md](computer.md).
