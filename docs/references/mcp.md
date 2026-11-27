# MCP servers, web search and the browser

An MCP server gives agents the tools of another program or service. pine brings four: `web`
(search and page reading), `commands` (fixed commands as tools), `browser` (a real browser) and
`computer` (the apps on this computer).

## Adding a server

Ask an agent: "Connect this MCP server: https://mcp.example.com/mcp", or "install example.com's MCP
server". It calls `add_mcp_server` with the URL, or the command of a local server
(`npx -y @example/mcp@latest`), and you confirm in every mode. The server is for this conversation
unless you say "for you as an agent" ("add it for yourself as an agent" moves it later); only the
main agent adds one for all agents. When the turn ends, pine calls the agent again with the new
tools, without a restart. `/mcp`, `pine mcp list` and `mcp_servers` show where each server is and
whether its tools are there (if not, it did not start or needs a sign-in). The tools are in
[setup.md](setup.md).

A local server an agent adds is one program with arguments (`&&`, pipes and `$(...)` are refused).
It runs where the agent's commands run (`"sandboxed": true`): in the sandbox in `safe` and `manual`
mode (not at all without a sandbox), with your rights in `auto` and `bypass`, and without the
daemon's environment. A key it reads from its environment goes in `secrets` (`EXAMPLE_API_KEY`):
you type the value into the dialog, and pine keeps it in `.env`. To sign in, the agent uses the
server's `login` action or login command and gives you the link.

An agent's server gets `"approve": "tainted"` and doesn't mark the conversation. Add
`"taints": true` if it returns other people's text (mail, tickets, search).

From a shell: `pine mcp add <name> <url>`, `pine mcp add <name> -- <command...>`, `pine mcp remove`,
`pine mcp list` ([commands.md](commands.md)). A remote server needs https (http only on
`localhost`, `127.0.0.1`, `[::1]`). A running daemon applies it at once; after editing the file by
hand, run `pine check` and restart.

## Signing in (OAuth)

When a remote server says "unauthorized", log in to it once: `pine mcp login <name>`, `/mcp login
<name>`, or Sign in under Settings > MCP servers. pine keeps the tokens in `data/pi/mcp-auth.json`
(closed to agents) and refreshes them; `pine mcp logout <name>` deletes them. A pre-registered
client takes an `oauth` block (`clientId`, `clientSecret`, `callbackPort`, `clientName`,
`clientRegistration`; pi's `docs/mcp.md`). A fixed token needs no sign-in: `"headers": {
"Authorization": "Bearer ${TOKEN}" }`.

## Global and per agent

```json
"mcp": {
  "web":     { "pine": "web", "agents": ["scout"] },
  "docs":    { "url": "https://mcp.example.com/mcp", "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" }, "agents": ["main", "gonzo"] }
}
```

`mcp` in `pine.json` is for everyone, in an `agent.json` for that agent.

| Setting | Effect |
|---|---|
| `agents` on a global server | Which agents get it. Default: all (`["*"]`). |
| `globalMcp` in `agent.json` | `true` (default): every global server that includes the agent. `false`: none. `["web"]`: exactly these, whatever their `agents` say. |
| A server in `agent.json` with a global server's name | Replaces the global one (unless `"enabled": false`). |
| `"enabled": false` | Switches a server off. |

`pine check` prints each agent's list. Your own pi's `mcp.json` doesn't reach pine's agents.

## Server entries

| Key | Meaning |
|---|---|
| `command`, `args`, `env`, `cwd` | A local server (stdio); each conversation runs its own copy. |
| `url`, `headers` | A remote server (streamable HTTP). `headers` also go with a `download` of a link its tools returned, never for a `taints` server. |
| `exposure` | `direct` (default), `codemode` (one scripting tool), `deferred` (searchable; for many tools), `hidden`. |
| `toolExposure` | Per tool, e.g. `{ "delete_*": "hidden" }`. |
| `description` | One sentence on what it offers. |
| `timeout` | Seconds per call. Default 60. |
| `pine` | A bundled server: `"web"`, `"browser"`, `"commands"`, `"computer"`, with `options`. |
| `sandboxed` | Runs where the using agent's commands run. Set on servers agents add; without it a server runs as your process (give it narrow credentials). |
| `session` | The one conversation that has it (written by `add_mcp_server`). |
| `taints` | Its results are outside content. Default `false`; `true` for bundled `web`, `browser`, `computer`. |
| `approve` | `"always"`: every call asks (not in bypass mode). `"tainted"`: after outside content, its acting tools ask. Default `"never"`. |

A tool declared read-only (`readOnlyHint`) never asks unless `"approve": "always"`, and only such
tools run in plan mode ([security.md](security.md), "4. Taint and approvals").

## How the agent sees a server

In your conversations a server is one tool named after it (`-` becomes `_`; a name pine uses gets
`mcp_`, as `mcp_manual`), with its tools as actions. The `web` tools stay separate
(`mcp__web__search`, `mcp__web__fetch`). The full name `mcp__<server>__<tool>` is what runs
started from outside use and `approve` patterns match. The tool's description carries the usage
notes the server sends when it connects, up to 2048 characters.

Telegram and MQTT are sources that send, not MCP servers ([sources.md](sources.md), "Sending
through a source").

## Files and pictures from a remote server

- A picture in a tool's answer is already shown.
- A file path in an answer is on the server's computer (`cp` says "No such file or directory").
  The agent fetches it with `download` and the link from the answer.
- A link on the server's own address (scheme, host, port of its `url`) needs no question. pine adds
  the server's `headers` to a link one of its tools returned in this conversation, exactly as
  returned; another address gets no key (on a 401, call the tool again). Links stop counting after
  `/reset` or a restart.
- To show or play it, the answer uses `![short caption](path)` with the `!`; a plain link plays
  nothing.

## Bundled: web

```json
"web": { "pine": "web", "options": { "braveApiKey": "${BRAVE_API_KEY:-}" }, "agents": ["scout"] }
```

| Tool | What it does |
|---|---|
| `mcp__web__search(query, count?)` | Brave Search with `braveApiKey`, else Keenable with `keenable` or `keenableApiKey`, else DuckDuckGo (may rate-limit). |
| `mcp__web__fetch(url, max_chars?, start?)` | A page's text; `start` continues a long one. |

| Option | Default | Meaning |
|---|---|---|
| `braveApiKey` | none | Brave Search API key. |
| `keenable` | `false` | Search with Keenable (`"keenable": true`), no key needed: 1000 searches an hour per address. |
| `keenableApiKey` | none | Keenable API key, for higher limits; searches with Keenable without `keenable`. |
| `allowHosts`, `denyHosts` | all, none | Only these hosts, or never these (subdomains included). Without `braveApiKey` or Keenable allow `duckduckgo.com`. |
| `allowPrivate` | `false` | Local and private addresses without asking. Leave it off. |
| `maxBytes`, `maxUrlLength`, `timeoutMs` | 2 MB, 2000, 20000 | Limits per response, URL length (longer is refused), time per request. |
| `userAgent` | a desktop Safari | What it says it is. |

Only http and https; every redirect is checked; loopback, private and link-local addresses are
refused. Give `web` and `browser` to an agent with nothing private, and let the others delegate
([security.md](security.md)).

## Bundled: commands

Fixed commands as typed tools, so an agent needs no shell:

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
| `params.<name>` | `type` (`string`, `number`, `boolean`), `description`, `enum`, `pattern` (whole value), `default`, `required` (default true). A value starting with `-` is refused unless it is a number or has `pattern` or `enum`. |
| `timeoutSec` | Default 30. |
| `cwd`, `env` | Working folder (default: the conversation's), extra environment. |
| `sandbox` | `true`: run in the agent's sandbox. Default `false`. |
| `maxOutput` | Characters returned. Default 30000. |

Mark the server `"approve": "tainted"` if a command changes something.

## Bundled: browser

A real browser for JavaScript, clicks, forms and logins: Playwright's MCP server behind a guard.
`pine init` downloads it; `pine browser-install` fetches it again. Its sixteen core tools:
`mcp__browser__browser_navigate`, `..._snapshot`, `..._click`, `..._type`, `..._fill_form`,
`..._press_key`, `..._select_option`, `..._hover`, `..._wait_for`, `..._find`, `..._tabs`,
`..._navigate_back`, `..._handle_dialog`, `..._close`, `..._take_screenshot`,
`..._console_messages`. A snapshot is a text outline (cut at 24,000 characters; `browser_find`
searches longer pages) whose references the click and type tools take.

| Option | Default | Meaning |
|---|---|---|
| `headed` | `false` | A window from the start, in every conversation. |
| `profile` | none | A folder that keeps cookies and logins. Treat it like a password. |
| `images` | `true` | `false`: screenshots without the picture. |
| `tools` | `"core"` | The sixteen tools; `"all"`: everything not blocked; or a list. |
| `block` | `[]` | Further tools to withhold. |
| `allowHosts`, `denyHosts` | none | Where it may go, subdomains included. |
| `allowPrivate` | `false` | Every local address without asking. Leave it off. |
| `browser` | `chromium` | `chrome` or `msedge`: an installed browser. |
| `executablePath`, `viewport`, `caps`, `extraArgs` | | Passed to Playwright MCP. `"caps": "storage"` with `"tools": "all"` adds the cookie tools. |

The guard sends every request through a proxy that refuses loopback, private and link-local
addresses (except one you allowed), switches off WebRTC and QUIC outside it, blocks `file:`, and
runs parallel calls in turn. It always withholds `browser_run_code_unsafe`, `browser_file_upload`,
`browser_drop`, `browser_install`, `browser_storage_state` and `browser_set_storage_state`.

### Seeing the browser, and logging in yourself

The browser has no window. To watch it, or when a page needs you (a login, a captcha, a payment),
ask the agent to show it:

| Tool | What it does |
|---|---|
| `mcp__browser__browser_show` | A window on the screen of the computer pine runs on, same page and logins. You and the agent both act in it |
| `mcp__browser__browser_hide` | Closes the window; the browser goes on |

- In the Pine app the browser is beside the conversation ([desktop.md](desktop.md), "The
  browser"); `profile`, `headed`, `browser`, `executablePath` and `viewport` don't apply there.
- If you opened another page or tab, the agent is moved there and its acting call is skipped, so
  your page is never replaced behind your back.
- Opening or closing the window reloads the page (typed form text is lost, cookies stay).
- Your logins are the agent's too, until a restart or reset (for good with `profile`).
- No window for a run started from outside, or without a screen. `"block": ["browser_show",
  "browser_hide"]` removes the tools.

### Your own browser (Chrome, Brave, Edge)

pine's own browser has no logins of yours, and some sites refuse it. An agent can work in your
own browser instead: Chrome, Brave, Edge, Chromium, Vivaldi or Arc, with pine's extension in it.

| What | How |
|---|---|
| Connect, once | Settings > General > **Your own browser** > Connect in the Pine app, or `pine chrome install`. Then add the extension to the browser: open `chrome://extensions`, turn on Developer mode, and drag the folder pine names onto that page (or "Load unpacked"). Restart the browser if it ran before |
| `pine chrome` | Says whether pine is connected to the browsers on this computer and whether the extension answers. `pine chrome install` connects, `pine chrome remove` takes it back |
| `mcp__browser__browser_to_chrome` | The agent moves its browser into yours, for this conversation. Say "use my browser" or "do this in Chrome" |
| `mcp__browser__browser_to_pine` | Back to pine's own browser. The tabs the agent opened in yours are closed, yours stay |
| `defaults.browser` | `chrome`: every conversation of yours uses your browser whenever it runs with the extension. `pine` (the default): pine's own |

- A conversation gets a tab group named `pine · <agent or conversation>` there. The agent sees
  and uses the tabs of that group and no other tab.
- Drag a tab into the group to hand it to the agent; drag it out to take it back. The agent is
  told when a tab came, and looks before it acts.
- The agent works in the background: its tab does not come to the front, and you see a pointer
  labelled pine where it clicks.
- The browser shows "Pine started debugging this browser" while an agent is attached. Cancel
  there takes every tab back from the agents at once.
- Closing a conversation's browser or moving back closes the tabs the agent opened. A conversation
  that rests leaves its tabs open and nobody attached.

It is your browser, with your logins: the agent is signed in wherever you are, and the guard of
pine's own browser (no local network, no logins) does not apply there. Only your own
conversations get it, never a run started from outside or a sub-agent. No login is copied into
your browser or out of it. Without the extension, or with the browser closed, the agent works in
pine's own browser.

### Local addresses

When the agent opens a local address with `browser_navigate` (`http://localhost:5173`,
`http://192.168.1.20`), pine asks you; no `request_access` is needed. A yes allows that host and
port for the conversation and its sub-agents until a reset or restart (`localhost:5173` and
`127.0.0.1:5173` are two questions). After a no the agent tries no other spelling.

- Asked about: `localhost`, names ending in `.localhost`, `.local`, `.internal`, and private IP
  addresses. A name local only after a lookup (`nas.home`) is refused; use `allowPrivate`.
- A page's own request to another local address fails (a WebSocket says `Establishing a tunnel via
  proxy server failed`), and the next result names the address. The agent opens it once with
  `browser_navigate` to get the question.
- pine's control port is never opened. Bypass mode doesn't ask; a run started from outside and a
  sub-agent can't.

A dev server the agent starts in the sandbox needs `request_access` with `network: true` (or
`sandbox.network`), `background: true`, and `stop_program` to stop it ([coding.md](coding.md),
"Commands in the background").

## Bundled: computer

`"computer": { "pine": "computer" }` operates the apps on the computer pine runs on (macOS,
Windows, Linux with X11), for an agent in `auto` or `bypass` mode in your conversations, asked once
per app ([computer.md](computer.md)).
