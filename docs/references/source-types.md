# Source types

Each built-in source type: which one fits a service or device, its options and events, and for
most an entry to copy. Sources in general (subscriptions, common keys, `when`, secrets, trust)
are in [sources.md](sources.md).

Tell the agent what to watch ("tell me on Telegram when pmndre/pine has a new release"). It picks
the type, and you confirm. Or write the entry under `sources` in `pine.json` or an agent's
`agent.json`, with the type's options next to `type`.

## Which type for what

A type is **told** when it listens on a port or holds a connection:

- `folder`: a new or changed file (scans, downloads, exports)
- `webhook`: a request another service sends (GitHub, Home Assistant, a phone shortcut)
- `stream`: each message a service pushes over Server-Sent Events or a WebSocket (ntfy, Gotify)
- `mqtt`: messages on a broker's topics (Zigbee hubs, sensors, plugs, printers)
- `telegram`, `slack`, `matrix`, `discord`, `zulip`: chat messages (Slack also reactions, pins)
- `mail`: a new mail in a mailbox
- `ftp`: a file a camera, doorbell or scanner uploads
- `smtp`: a mail a NAS, printer, UPS or router sends
- `syslog`: a router's, firewall's or NAS's log lines
- `onvif`: what a network camera detects (motion, a person, a doorbell button)
- `serial`: lines from a serial port (an Arduino, a P1 smart meter, a GPS)
- `system`: what this computer does (sleep, lock, power, network, disks, apps)
- `command` with `follow`: each line a running command prints (logs, `docker events`)

A type **looks** when it asks again and again and reports what changed:

- `http`: a page, or one value in it (a price, a version, an API)
- `feed`: new entries of an RSS, Atom or JSON feed
- `calendar`: calendar entries new, moved or gone
- `command`: a command's output or exit code (disk space, a build)
- `modbus`: a value in a Modbus device (inverters, heat pumps, meters)
- `presence`: a device joining or leaving your network (a phone coming home)

### Looking again and again

The types that look (`http`, `command`, `feed`, `calendar`, `modbus`, `presence`):

- The first look is the starting point. Setting a source up reports nothing.
- A look that finds nothing new costs nothing: no event, no model woken.
- A failed look is not an event. pine backs off: the pause doubles with each failed look in a row,
  up to 15 minutes (or the interval, if longer), and is normal again after a look that works.
- Two looks of one source never overlap. Looks are spread a little.

The source list (`pine sources`, `/sources`, the `sources` tool) shows `last looked 14:02:11` or
`failing since 14:02:11 (4 looks): it answered 503`, and what was found if it is a number or one
word.

## Which type for which service

| Service or device | Type | How |
|---|---|---|
| GitHub releases, YouTube, podcasts, blogs, Reddit | `feed` | The feed's address, for GitHub `https://github.com/<owner>/<repo>/releases.atom`. |
| GitHub pushes, issues, pull requests | `webhook` | A repository webhook. Without a public address, a relay (smee.io) and `stream`. |
| A price, a version, a status page | `http` | `match`, `select` or `path`; `render` for a page its scripts fill in; `method: "POST"` for GraphQL. |
| Home Assistant | `stream`, `mqtt`, `webhook` | Its WebSocket API, its MQTT broker, or an automation calling pine's webhook. |
| Zigbee, Z-Wave | `mqtt` | zigbee2mqtt, zwave-js-ui. |
| ntfy, Gotify, Signal (signal-cli), Mastodon, Bluesky | `stream` | See "What a stream reaches". |
| Gmail, iCloud, Fastmail, your own server | `mail` | IMAP with an app password. |
| Outlook.com, Hotmail, Microsoft 365 | `mail` | `"signIn": "microsoft"`. |
| Google Calendar, iCloud, Outlook, Nextcloud | `calendar` | The iCal address. |
| Synology, QNAP, TrueNAS, Proxmox, UniFi, a UPS, a printer | `smtp` | Its e-mail notifications, pointed at pine. |
| A camera's motion and person detection | `onvif` | The camera's ONVIF user. |
| A 3D printer | `mqtt` | Bambu printers are their own broker. OctoPrint and Klipper through an MQTT plug-in. |
| A log file, Docker, Kubernetes, journald, Redis, NATS, Kafka | `command` with `follow` | `tail -F`, `docker events`, `kubectl get -w`, `journalctl -f`, a client that prints a line per message. |

### What there is no type for

| Wanted | Instead |
|---|---|
| Something at a given time, like a calendar's "ten minutes before" | A schedule ([events.md](events.md), "Schedules"), which the agent adds when `calendar` reports the entry. |
| Bluetooth sensors | A bridge to MQTT (Theengs Gateway, OpenMQTTGateway) and `mqtt`. |
| iMessage, WhatsApp | None. Signal works through signal-cli and `stream`. |
| KNX, HomeKit, Matter | The hub (Home Assistant), through `mqtt` or `stream`. |
| Something of your own | A source type of your own ([sources.md](sources.md), "A source type of your own"). The main agent can write one. |

## The types

### folder

Reports each new or changed file once it has stopped growing.

```json
"scans": { "type": "folder", "dir": "~/Scans", "mask": "*.pdf" }
```

| Option | Default | |
|---|---|---|
| `dir` | | The folder (`~` and paths relative to the configuration file work). Not inside pine's home, except the agent's workspace. The agent can read it. |
| `mask` | | File names, as in a shell: `*.pdf`, `*.{png,jpg}`, `report-??.csv`, several with commas. Case doesn't matter. |
| `pattern` | | Full paths matching this regular expression. |
| `ignore` | version control, dependencies, editor leftovers | Paths to skip, as a regular expression. The default skips `.git`, `.hg`, `.svn`, `node_modules`, `.build`, `DerivedData`, `__pycache__`, `.venv`, `.DS_Store`, and names ending in `~`, `.swp`, `.tmp`, `.part`, `.crdownload`. |
| `settle` | `"1.5s"` | How long a file must stay unchanged to count as complete. |
| `recursive` | `true` | Include subfolders. |

Event `added`: `{ path, file, size, images? }`. A jpg, png, webp or gif under 10 MB is shown to a
model that can see. An empty file is reported after a longer wait, with `size` 0. If the folder
can't be watched, the status shows the error code and pine retries, up to once a minute.

### mqtt

Reports the messages on the topics you name.

```json
"printer": {
  "type": "mqtt", "url": "mqtts://192.168.1.50:8883", "username": "bblp", "password": "${BAMBU_ACCESS_CODE}",
  "topics": ["device/+/report"], "insecureTls": true, "minInterval": "30s",
  "trust": "owner", "description": "status reports of the 3D printer"
}
```

| Option | Default | |
|---|---|---|
| `url` | | `mqtt://`, `mqtts://`, `ws://` or `wss://` address of the broker. |
| `topics` | | One topic filter or a list. |
| `publish` | none | Topics an agent may publish to (`["zigbee2mqtt/+/set"]`) with `{"topic": "lamp/set", "message": "on"}`, never to a filter (`+`, `#`). Without it, the source only listens. |
| `username`, `password`, `clientId` | | As the broker wants them. |
| `minInterval` | | Drop a message that comes sooner than this after the last one on its topic. |
| `insecureTls` | `false` | Accept a certificate that can't be verified. |

Event `message`: `{ topic, value }`, `value` the parsed JSON or the text. The example is a Bambu
printer in LAN mode: user `bblp`, the access code from its screen as password.

### webhook

A web address that other services call: `POST http://<pine's control address>/hook/<name>`
(`/hook/<name>@<agent>` for an agent's own source).

| Option | |
|---|---|
| `secret` | Sent as `Authorization: Bearer <secret>`, or as an HMAC SHA-256 signature of the body in `X-Hub-Signature-256` or `X-Signature` (as GitHub does). Left out by an agent, pine makes one in `.env`. |
| `open` | `true` instead of a secret: anyone who reaches the port may call it. Only for a port nobody else reaches. |

Event `received`: `{ body, headers }`. `body` is the parsed JSON, or `{ text }`. Only headers
naming the kind of request are kept (`content-type`, `user-agent`, `x-github-event` and the like).
It needs the control API (`http` in `pine.json`), on `127.0.0.1` by default: from the internet
only through a tunnel or reverse proxy. Without a subscriber the address answers "not found".

### ftp

A small FTP server for devices that "upload to FTP". It accepts uploads and nothing else.

| Option | Default | |
|---|---|---|
| `port`, `host` | `"0.0.0.0"` for `host` | Where to listen. |
| `user`, `password` | `"device"`, made by pine | Filled in when an agent sets it up; in a file you write, give both. The password has 8 characters or more and is kept in `.env`. |
| `allow` | everyone | Only these clients: an address (`"192.168.1.40"`) or a prefix ending in a dot (`"192.168.2."`). |
| `pasvPorts` | any | `[from, to]` for data connections, if a firewall must know them. |
| `maxFileMb`, `keepDays` | `50`, `7` | Largest file accepted, in MB. Files are kept this many days. |

Event `upload`: `{ file, path, size, from, images? }`. `file` is the device's name for it, `path`
where it lies (`data/sources/<name>/files/`). A picture is shown to the agent. A video is not: the
agent reads it from `path` ("Files a source received" in [sources.md](sources.md)).

Plain FTP sends the password unencrypted. Nothing can be listed, read or deleted, and files get
names pine chooses. 20 connections at most. Set the device to passive mode.

### telegram

A Telegram bot. You write to it from anywhere, the subscribed agent answers there, and agents
reach you through it.

The agent calls `add_source`, and you type the bot's token into the dialog, so it never passes
through a model. Then you pair the bot with your account:

1. Write anything to the bot in Telegram.
2. It answers with a six-digit code.
3. pine shows a question on your computer that names the account. Type the code there.

From then on the bot listens to that account only. A stranger can make the question appear but
can't see the code, and an account you deny is not asked about again. Other accounts get only the
code message before pairing, and no answer after. To pair another account, set the source up
again.

```json
"telegram": { "type": "telegram", "token": "${PINE_SOURCE_TELEGRAM_MAIN_TOKEN}", "trust": "owner", "description": "my Telegram" }
```

| Option | Default | |
|---|---|---|
| `token` | | From @BotFather (`/newbot`). Kept in `.env`. |
| `allow` | pairing | Telegram user ids that may talk to it, instead of pairing. Unasked messages and approvals go to the first. |
| `approvals` | `true` | Approval requests also go there, with Allow, Deny and (where it can be kept) Always buttons, or `/allow` and `/deny`. An agent's own bot carries only its requests, a bot for all agents everyone's. Never a request that needs a secret typed. |
| `apiBase` | Telegram's | A Bot API server of your own: https, or on this machine. |

A `question` arrives with a button per answer (and "No answer"), or with numbered answers when
several may be picked: reply with numbers ("1,3") or your own words. Answer a question without
choices, or one answer in your own words, in the terminal UI or the Pine app.

Event `message`: `{ text, name, username, chatId, messageId, images? }`. A photo up to 10 MB is
shown to the model. Only the private chat counts; groups reach no agent.

- The bot speaks for you: what you write has no outside-content mark. That is why pairing takes a
  code.
- The agent sends with `send` without asking you, with a picture, video or sound file up to 50 MB.
  Markdown is shown formatted, and a link shows its address. Approval and pairing messages are
  plain text.
- A subscription's default ten-second `throttle` applies only if you set it.

pine opens no port: it fetches messages from Telegram, which gives them to one reader only. If
another program reads them (another pine with this token, a script), this source gets nothing and
its status says so: stop the other, or `/revoke` the token at BotFather and set the source up again.

### http

A web address looked at again and again, for what can't call you: a price, a version, a status
page, a device's state page.

```json
"price": { "type": "http", "url": "https://shop.example/fridge-3000", "match": "Price: ([0-9.,]+)", "every": "30m", "description": "the price of the fridge" }
```

| Option | Default | |
|---|---|---|
| `url` | | `https://...` (`http://` for a device on your network). |
| `every` | `"5m"` | At least `"30s"` when an agent sets it up, `"2m"` with `render`. |
| `path` | | For JSON: watch this field (`"data.price"`, `"items.0.state"`). |
| `values` | | For JSON: up to twenty fields under names of yours: `{ "price": "data.price" }`. |
| `match` | | Watch the first group this regular expression finds, in the text a reader sees, then in the source. |
| `select` | | The text of the first element this CSS selector matches (`".product-detail .price"`). |
| `attr` | | With `select`: this attribute instead of the text (`"content"`). |
| `render` | `false` | Open the page in pine's browser at each look. |
| `method` | `"GET"` | Or `"POST"`, nothing else. |
| `body` | | With `POST`: what to send, up to 20000 characters, as JSON when it is JSON. Not for secrets. |
| `headers` | | Headers to send, not secrets: `authorization` and `cookie` are refused, use `token`. |
| `token` | | Sent as `Authorization: Bearer <token>`, only to that host. Kept in `.env`. |
| `tokenHeader` | | Send the token as this header instead: `"x-api-key"`, `"cookie"`. |
| `local` | `false` | A local address whose name doesn't show it (`nas.home`). Not needed for an IP, `localhost` or `.local`. |

Use one of `path`, `values`, `match`, `select`. Without one, the whole text a reader sees counts,
and a page that shows the time changes at every look.

| Event | | |
|---|---|---|
| `changed` | `{ url, value, previous, number?, previousNumber? }` | With `path`, `match` or `select`. |
| `changed` | `{ url, values, previous, changed }` | With `values`. `changed` names the fields that differ. |
| `changed` | `{ url, added, removed, more? }` | Otherwise: new and removed lines, up to 30 each. |
| `down` | `{ url, error, looks }` | After three failed looks in a row, once. |
| `up` | `{ url }` | It answers again. |

#### One element of a page

Without `render`, `select` takes tags, `#id`, `.class`, `[attr]`, `[attr=value]` (also `~=` `^=`
`$=` `*=`), combined (`span.price`), nested with a space or `>`, and alternatives with a comma.
Nothing with a colon, no `+` or `~`. Many shops state the price for machines too:
`"select": "meta[property=product:price:amount]", "attr": "content"`. What a script fills in later
is not in the page as sent: use `render`, or watch the address the script asks.

#### A page that a script fills in

With `"render": true`, each look starts pine's browser (fetched by `pine init` and
`pine browser-install`) without a window and with an empty profile. It waits until the page is
quiet (five seconds at most), takes what a reader sees, and closes. `select` then takes any CSS
(`li:nth-child(2) .price`), no match is `null`, and `match` looks only at the text a reader sees.
Two browsers run at a time for all sources; a look may take 45 seconds.

`render` refuses `path`, `values`, `method`, `body`, `headers`, `token`, `tokenHeader` and
`local: true`, since the browser would send them everywhere the page loads from. So a page behind
a login can't be watched. Watching the JSON address the page's script asks, with `path`, is
lighter.

The page's scripts run (the dialog says so). The page reaches the internet, not your network or
this computer, except its own address when that is local by its name (`localhost`, `.local`, a
private IP), and then that host and port only ([security.md](security.md)). A redirect to another
host is a failed look. Nothing is kept between looks: no cookies, logins or downloads.

The status says why a look failed: `pine's browser is not installed on this computer` (run
`pine browser-install`), `the page did not finish loading within 45 s`, `it sends on to <host>`,
`it answered 403`. `found nothing with the selector` is no failure: the selector is wrong, or the
page fills the element in later.

#### An amount as a number

A value that reads as a number or an amount also arrives as `number` (and `previousNumber`), for
`when`: `{ "payload.number": { "lt": 500 } }`.

| The value | `number` |
|---|---|
| `"12,5"`, `"-3,5 °C"`, `"3 GB"` | 12.5, -3.5, 3 |
| `"$1,299.00"`, `"1 299,00 kr"`, `"1'299.50"` | 1299, 1299, 1299.5 |
| `"1,299"`, `"1.299"` | 1299 and 1.299 |
| `"1.299 €"`, `"1,299 €"` | 1299 and 1.299: next to `€`, `zł`, `kr` or `Kč` a dot groups thousands |
| `"1.2.3"`, `"12:30"`, `"2026-05-01"`, `"sold out"` | none |

#### Several fields, and an address that is asked with POST

```json
"fridge": {
  "type": "http", "url": "https://shop.example/graphql", "method": "POST",
  "body": "{\"query\": \"{ product(id: 7) { price stock { count } } }\"}",
  "values": { "price": "data.product.price", "stock": "data.product.stock.count" },
  "every": "30m", "description": "price and stock of the fridge"
}
```

An event: `{ "values": { "price": 479, "stock": 3 }, "previous": { "price": 499, "stock": 3 },
"changed": ["price"] }`. A missing field is `null`; numbers stay numbers
(`{ "payload.values.stock": { "gt": 0 } }`). You see what a POST sends before you confirm.

#### Limits of a look

An answer is read up to 1 MB within 20 seconds, following up to five redirects on the same host. A
key in the address (`?apikey=`) is stored and shown like the rest. Refused at set-up: a user name
or password in the address, more than one of `path`, `values`, `match`, `select`, `attr` without
`select`, an unreadable selector, `body` without `POST`, and `values` empty, over twenty, or under
names that are not plain words.

### command

A command run again and again, for what only a command can tell: free disk space, a build, whether
a machine answers.

| Option | Default | |
|---|---|---|
| `run` | | The command line, up to 2000 characters, run by bash in the source's agent's workspace. |
| `every` | `"1m"` | At least `"5s"` when an agent sets it up. |
| `match` | | Watch the first group this regular expression finds in the output. |
| `timeout` | `"30s"` | At least `"1s"`. |

Event `changed`: `{ command, code, previousCode?, value, previous }` with `match`, else
`{ command, code, previousCode?, added, removed, more? }`. `previousCode` comes when the exit code
changed, so `test -f build/done` reports by how it ends.

It always runs as a shell command in `safe` mode, also for an agent in `auto`: in the agent's
sandbox and private home, without network unless `sandbox.network`, and with nothing of your home
beyond `sandbox.read`. A source for all agents runs as the main agent. You see the command line
before set-up. Without a sandbox on the machine, a `command` source does not run (`pine check`
says so).

#### Following a command that keeps running

With `follow`, the command starts once and each line it prints is an event: the type for any
protocol with a command line client.

```json
"backup": { "type": "command", "run": "tail -n 0 -F ~/Library/Logs/backup.log", "follow": true, "match": "ERROR (.*)", "description": "errors in the backup log" }
```

| Option | Default | |
|---|---|---|
| `follow` | `false` | `true`: keep it running and report each line. Not with `every` or `timeout`. Not on Linux. |
| `perMinute` | `30` | Lines a minute at most, 1 to 600. The rest are counted in `dropped`. |
| `match` | | Only lines it finds something in. Its first group is `value`. |

| Event | | |
|---|---|---|
| `line` | `{ command, line, value?, dropped? }` | One line, without terminal codes, cut at 2000 characters. `value` is the `match`, or the parsed line if it is JSON. |
| `ended` | `{ command, code?, error?, ran }` | It ended (`ran` in seconds, `error` the end of its error output). It starts again after a growing pause; one that ends at once is reported once. |

More to follow: `docker events --format '{{json .}}'`, `ssh nas journalctl -f -o json`,
`redis-cli --raw subscribe alerts`. The same sandbox holds: a log file needs `sandbox.read`, a
network client `sandbox.network`. When the source stops, the command ends with everything it
started. On Linux, use `every` with a `match` instead, or send the lines to `syslog` or `webhook`.

### feed

Reports each new entry of an RSS, Atom or JSON feed.

| Option | Default | |
|---|---|---|
| `url` | | The feed itself, not the page that links to it. |
| `every` | `"15m"` | At least `"1m"` when an agent sets it up. |
| `match` | | Only entries whose title or text this regular expression finds: `"security\|CVE"`. |
| `headers`, `token`, `tokenHeader`, `local` | | As for `http`. |

Event `entry`: `{ feed, title, link, id, published?, author?, summary, media?, more? }`. `feed` is
the feed's title, `summary` the text (1500 characters), `published` in UTC, `media` a podcast's
file. A look reports ten entries at most, oldest first; with more, the newest ten, the last with
`more`. An entry is known by its id, else link, else title and date, so one that returns is not
new. RSS 2.0, RSS 1.0, Atom and JSON Feed, up to 1 MB. A web page, or a redirect to another host,
is a failed look.

| For | Address |
|---|---|
| GitHub | `https://github.com/<owner>/<repo>/releases.atom`, `.../commits/<branch>.atom`, `.../tags.atom` |
| YouTube | `https://www.youtube.com/feeds/videos.xml?channel_id=<id>` (`?playlist_id=` for a playlist) |
| A blog | Usually `/feed`, `/rss.xml`, `/atom.xml`, `/index.xml` |
| arXiv | `https://export.arxiv.org/rss/<category>` |
| Reddit | `https://www.reddit.com/r/<name>/.rss`, `https://www.reddit.com/search.rss?q=<words>` |
| Hacker News | `https://hnrss.org/frontpage`, `https://hnrss.org/newest?q=<words>` |
| A status page | `/history.atom` or `/history.rss` (`https://www.githubstatus.com/history.atom`) |
| Mastodon | `https://<instance>/@<name>.rss` |

### calendar

Reports entries of an iCalendar (`.ics`) address that were added, changed or removed.

| Option | Default | |
|---|---|---|
| `url` | | `https://...` or `webcal://...` (read over https). |
| `every` | `"15m"` | At least `"1m"` when an agent sets it up. |
| `ahead` | `"60d"` | Only entries that begin within this time, at least `"1h"`. Later ones are never reported. |
| `headers`, `token`, `tokenHeader`, `local` | | As for `http`. |

| Event | | |
|---|---|---|
| `added` | `{ calendar, uid, summary, start, end?, allDay?, zone?, location?, description?, repeats? }` | A new entry. |
| `changed` | the same, with `was: { summary, start, end?, location? }` | Title, time or place changed (not the description alone). |
| `removed` | `{ calendar, uid, summary, start }` | An entry still ahead is gone or cancelled. |

`start` is `2026-12-24T17:00:00Z` (UTC), `2026-12-24T18:00:00` (with `zone` that zone's clock,
without it floating), or `2026-12-24` with `allDay` (`end` is then the last day). The source never
fires because an entry is about to begin, and a past entry leaves silently: a reminder is a
schedule the agent adds with `add_schedule` (`at`). A repeating entry is one entry, its rule in
`repeats`; a moved date of it is an entry of its own with the same `uid`. Twenty changes a look at
most (`more`). Over 8 MB is a failed look. A Google "secret address in iCal format" is a key in
itself, stored and shown like any address.

### stream

pine connects once, and the service pushes over Server-Sent Events (`https://`) or a WebSocket
(`wss://`).

```json
"door": {
  "type": "stream", "url": "ws://homeassistant.local:8123/api/websocket", "token": "${HA_TOKEN}",
  "hello": [
    { "type": "auth", "access_token": "{{token}}" },
    { "id": 1, "type": "subscribe_trigger", "trigger": { "platform": "state", "entity_id": "binary_sensor.front_door" } }
  ],
  "path": "event.variables.trigger.to_state.state", "changed": true,
  "description": "whether the front door is open"
}
```

| Option | Default | |
|---|---|---|
| `url` | | `https://` for Server-Sent Events, `wss://` for a WebSocket. `http://` and `ws://` only on your network. |
| `kind` | by the address | `"sse"` or `"websocket"`, for a WebSocket at an `https://` address. |
| `hello` | | WebSocket only: messages to send after connecting, such as a login (one or a list). `{{token}}` is replaced by the token. |
| `token`, `tokenHeader`, `headers`, `local` | | As for `http`, but where `hello` says `{{token}}`, the token goes only there. |
| `event` | | Server-Sent Events only: only events of this name. |
| `path` | | For JSON: take this field. A message without it is left out. |
| `match` | | Only messages it finds something in. A group's match is the value. |
| `changed` | `false` | Report a value only when it differs from the last. |
| `perMinute` | `30` | 1 to 600. The rest are dropped and counted. |

| Event | | |
|---|---|---|
| `message` | `{ value, event?, id?, previous?, dropped? }` | `value` is the JSON, the text, or what `path` and `match` picked, cut to 4000 characters. |
| `down` | `{ url, error }` | After three failed connection attempts, once. |
| `up` | `{ url }` | Connected again. |

Nothing sent before connecting or while disconnected is reported, except what an SSE service sends
again for `Last-Event-ID`. Reconnects start after a second and double up to five minutes. A
WebSocket is pinged every 45 seconds; an event stream silent for five minutes is reconnected. A
message over 256 KB is left out.

#### What a stream reaches

| Service | Entry | What arrives |
|---|---|---|
| ntfy | `{ "type": "stream", "url": "https://ntfy.sh/my-topic/sse", "event": "message", "path": "message" }` | Each notification's text. A protected topic needs a `token`. |
| Gotify | `{ "type": "stream", "url": "wss://gotify.example.com/stream", "token": "${GOTIFY_CLIENT_TOKEN}", "tokenHeader": "x-gotify-key" }` | `{ title, message, priority, appid }`. |
| Home Assistant | the example above | One entity's state (a long-lived access token from your profile). `subscribe_events` with `state_changed` gives every change: add `match` and a low `perMinute`. |
| signal-cli | `{ "type": "stream", "url": "http://127.0.0.1:8080/api/v1/events", "event": "receive", "path": "envelope" }` | Each Signal message, for `signal-cli daemon --http 127.0.0.1:8080`. |
| Mastodon | `{ "type": "stream", "url": "https://mastodon.social/api/v1/streaming/user", "event": "notification", "token": "${MASTODON_TOKEN}" }` | Mentions, boosts, follows. For one account's posts, `feed` is simpler. |
| Bluesky (Jetstream) | `{ "type": "stream", "url": "wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post&wantedDids=did:plc:...", "path": "commit.record.text" }` | One account's posts. |
| smee.io relay | `{ "type": "stream", "url": "https://smee.io/your-channel", "path": "body" }` | Webhooks for a machine without a public address. Anyone who knows the channel can write to it. |

A page an agent makes for you offers what you press on it as such a stream
([interfaces.md](interfaces.md)).

### mail

A mailbox over IMAP: each new mail as soon as the server says so (IDLE), with text and
attachments. It only reads: nothing is marked as read, moved or deleted.

```json
"inbox": {
  "type": "mail", "host": "imap.fastmail.com", "user": "me@example.com", "password": "${MAIL_APP_PASSWORD}",
  "from": ["@bank.example"], "subject": "statement|kontoauszug",
  "description": "statements from the bank"
}
```

| Option | Default | |
|---|---|---|
| `host` | | The IMAP server's name alone: `imap.gmail.com`. Not with `signIn`. |
| `user` | | Usually the e-mail address. |
| `password` | | Usually an app password, kept in `.env`. An agent leaves it out and pine asks you. Not with `signIn`. |
| `signIn` | | `"microsoft"` for Outlook.com, Hotmail, Live and Microsoft 365 (below). |
| `clientId` | | With `signIn`: your Microsoft app's Application (client) ID. |
| `tenant` | `"common"` | With `signIn`: `"common"`, `"consumers"` (private accounts), `"organizations"`, or one organisation's domain or id. |
| `security`, `port` | `"tls"`, `993` | `"starttls"`, or `"none"` for a server on your network only. Both use port `143`. |
| `mailbox` | `"INBOX"` | The folder, as the server spells it (`"[Gmail]/All Mail"`). |
| `from` | everyone | Only mail claiming to be from an address or `@domain`. A filter, not a proof. |
| `subject` | | Only subjects this regular expression finds. Case doesn't matter. |
| `maxMb`, `keepDays` | `10`, `7` | Attachments are kept up to this size in MB (50 at most), for this many days. |
| `sendTo`, `smtpHost`, `smtpPort`, `sender` | none, , `465`, `user` | For sending: the addresses an agent may write to, the SMTP server, its port (`587` uses STARTTLS), the From address. |
| `insecureTls` | `false` | Accept a self-made certificate. |
| `local` | `false` | A local address whose name doesn't show it. |

Event `mail`: `{ from, fromName?, to, subject, date?, text, attachments, images?, cut? }`. `text`
is up to 6000 characters (an HTML mail as a reader sees it). `attachments` are
`{ file, path?, type, size }`, without `path` when over `maxMb`. `cut` means the mail was larger
than what is fetched. Up to four pictures are shown to a model that can see; files lie in the
source's folder ("Files a source received" in [sources.md](sources.md)). Mail that arrived while
pine was down is reported later (200 at most). A sender can be forged, so mail is always outside
content, and `pine check` names a mailbox with `trust: "owner"`.

With `smtpHost` and `sendTo`, an agent can send mail, only to `sendTo`. `send` takes
`{"to": "...", "subject": "...", "text": "..."}` (plain text, no files; `to` optional with one
address). After outside content, pine asks you first.

| Provider | `host` | `smtpHost` | Password |
|---|---|---|---|
| Gmail, Google Workspace | `imap.gmail.com` | `smtp.gmail.com` | An app password |
| iCloud | `imap.mail.me.com` | `smtp.mail.me.com`, `smtpPort` 587 | An app-specific password |
| Fastmail | `imap.fastmail.com` | `smtp.fastmail.com` | An app password with IMAP (and SMTP) |
| GMX, WEB.DE, mailbox.org, Posteo | `imap.gmx.net`, `imap.web.de`, `imap.mailbox.org`, `posteo.de` | `mail.gmx.net`, `smtp.web.de`, `smtp.mailbox.org`, `posteo.de` | The account's. Switch IMAP on at GMX and WEB.DE |
| Proton Mail | `127.0.0.1`, `port` 1143, `"starttls"`, `insecureTls` | `127.0.0.1`, `smtpPort` 1025 | The Bridge's |
| Outlook.com, Microsoft 365 | filled in | filled in (587) | None: `signIn` |

Refused at set-up: a `host` with scheme, port or path, `"none"` for a server that is not local,
and `sendTo` without `smtpHost` or the other way round. A refused login is shown as why the source
is not running. An unreachable server is retried, up to five minutes apart.

#### A Microsoft mailbox: signing in instead of a password

```json
"outlook": {
  "type": "mail", "user": "me@outlook.com", "signIn": "microsoft",
  "clientId": "11111111-2222-3333-4444-555555555555", "tenant": "consumers",
  "from": ["@school.example"], "description": "mail from the school"
}
```

On the first start pine shows a dialog (also in the status line): open
https://microsoft.com/devicelogin, enter the code within about fifteen minutes, and sign in. pine
then connects. It never sees your password. What Microsoft hands over is kept in pine's database
and renewed at each connection, until you sign the app out, change your password, or the source is
unused for about ninety days. Removing the source deletes it.

`clientId` is an app you register once, for free, at entra.microsoft.com: "App registrations",
"New registration" (with personal accounts for a private mailbox, no redirect address). Its
"Overview" shows the "Application (client) ID". Under "Authentication", set "Allow public client
flows" to Yes. Under "API permissions", "Office 365 Exchange Online", "Delegated", add
`IMAP.AccessAsUser.All`, and `SMTP.Send` to send.

`tenant` must fit the registration. In an organisation, IMAP or "Authenticated SMTP" switched off
for the mailbox stops it, and the status says which. Refused at set-up: `signIn` other than
`"microsoft"`, `signIn` without `clientId` or with a `password`, and `clientId` or `tenant`
without `signIn`. Gmail has no such sign-in: use an app password.

### slack

A Slack workspace through an app in Socket Mode, which connects out (no port). Messages in channels
and direct messages, all or by mention, keyword or sender; on request also reactions, edits, joins,
channel changes, pins, slash commands and other apps' posts. An agent can post, react and send
files where you list.

```json
"work": {
  "type": "slack", "appToken": "${SLACK_APP_TOKEN}", "token": "${SLACK_TOKEN}",
  "channels": ["ops"], "mentions": ["me"], "keywords": ["outage"], "bots": true,
  "from": ["U0456RAINER"], "sendTo": ["C0123OPS"],
  "description": "what is written in Slack that concerns me"
}
```

A user token (`xoxp-`) sees what you see: use it to be told what is written to you. A bot token
(`xoxb-`) sees the channels the bot was invited to and messages to the bot. `"me"` is the token's
account. What you write yourself is not reported, unless `from` lists `"me"`.

| Option | Default | |
|---|---|---|
| `appToken` | | The app-level token (`xapp-...`) with `connections:write`. Kept in `.env`. |
| `token` | | A bot (`xoxb-`) or user (`xoxp-`) token, kept in `.env` (pine asks you for it). Needed for names, channels by name, `"me"`, files and sending; without it events carry ids and it only listens. |
| `events` | `["message"]` | `"message"`, `"reaction"`, `"edit"`, `"member"`, `"channel"`, `"pin"`, `"command"`, `"other"`. |
| `channels` | every channel the app sees | Names (need `token`) or ids. |
| `mentions` | | User ids, `"me"`, `"here"`, `"channel"`, `"everyone"`, or a user group id (`S...`). |
| `keywords` | | Words. Case doesn't matter. |
| `from` | | User or app ids whose messages always count. `"me"` reports your own. |
| `dms` | `true` | Direct messages count without mention or keyword. |
| `bots` | `false` | Other apps' posts count, with `bot: true`. |
| `ignore` | | User or app ids never reported. |
| `sendTo` | none | Channel (`C...`) and person (`U...`) ids an agent may write to. Needs `token`. |
| `perMinute` | `60` | 1 to 600. The rest are counted in `dropped`. |
| `history` | `true` | With a `token`: `read_source`, thread `context`, and catching up after a disconnect. |
| `context` | `3` | Earlier thread messages that come with an answer in a thread, 0 to 10. |
| `maxMb`, `keepDays` | `10`, `7` | Files are fetched up to this size in MB (50 at most) and kept this many days. |
| `apiBase` | `https://slack.com/api` | A compatible server: https, or on this machine. |

A person's id is under "Copy member ID" in their profile; a channel's is the end of its link. Pick
with `when`: `{ "payload.why": { "contains": "mention" } }`.

What counts, in this order:

1. Never your own app's posts, or ids in `ignore`.
2. Other apps' posts only with `bots`.
3. Messages from `from`, always.
4. Direct messages with `dms`.
5. Others only in `channels`, and with `mentions` or `keywords` (messages and edits) only when one
   matches.

#### The kinds of event

| `events` | Event | Fields |
|---|---|---|
| `"message"` | `message` | `{ text, user, userName?, channel, channelName?, kind, ts, thread?, reply?, bot?, mention?, keyword?, from?, files?, images?, why, context?, late?, dropped? }` |
| `"reaction"` | `reaction` | `{ reaction, added, user, userName?, channel, channelName?, ts, author?, authorName? }` |
| `"edit"` | `edited`, `deleted` | `{ text, previous?, user, ..., ts }`; `{ channel, channelName?, ts, previous? }` |
| `"member"` | `joined`, `left` | `{ user, userName?, channel?, channelName? }` (no `channel`: joined the workspace) |
| `"channel"` | `channel` | `{ what, channel, channelName? }`: created, renamed, archived, unarchived, deleted |
| `"pin"` | `pin` | `{ added, channel, channelName?, ts?, user, userName? }` |
| `"command"` | `command` | `{ command, text, user, userName?, channel, channelName? }`. Whoever typed it reads "Passed on." |
| `"other"` | `event` | `{ type, data }`, cut at 4000 characters |
| always | `gap` | `{ text, from, to, seconds, found, looked, complete, missing? }`: see "After a time without a connection" |

In a `message`, `text` is cut to 4000 characters, with `@Name` for mentions and links as
`words (address)`. `kind` is `"dm"`, `"group"` or `"channel"`. `ts` names the message, `thread`
its thread. `why` lists `"dm"`, `"mention"`, `"keyword"`, `"from"` or `"channel"`. `late` marks
one caught up after a disconnect. `files` (ten at most) have a `path` when fetched, and up to four
`images` are shown to the model.

#### Making the Slack app

At api.slack.com/apps, "Create New App", "From scratch". Switch on "Socket Mode". Under "Basic
Information" make an app-level token with `connections:write` (`appToken`). Under "Event
Subscriptions" add the events (bot events, or "on behalf of users" for a user token). Add scopes
under "OAuth & Permissions". "Install to Workspace" gives `token`. Reinstall after adding events or
scopes.

| To get | Event subscription | Scope |
|---|---|---|
| public, private channels, DMs, group DMs, other apps' posts, edits | `message.channels`, `message.groups`, `message.im`, `message.mpim` | `channels:history`, `groups:history`, `im:history`, `mpim:history` |
| only mentions of the bot | `app_mention` | `app_mentions:read` |
| reactions | `reaction_added`, `reaction_removed` | `reactions:read` |
| channel joins and leaves | `member_joined_channel`, `member_left_channel` | `channels:read`, `groups:read` |
| workspace joins | `team_join` | `users:read` |
| channel changes | `channel_created`, `channel_rename`, `channel_archive`, `channel_unarchive`, `channel_deleted`, `group_rename`, `group_archive`, `group_unarchive`, `group_deleted` | `channels:read`, `groups:read` |
| pins | `pin_added`, `pin_removed` | `pins:read` |
| slash commands | made under "Slash Commands" | `commands` |
| names of people, of channels | | `users:read`; `channels:read`, `groups:read` |
| files | | `files:read` |
| catching up in conversations not yet seen | | `im:read`; without `channels` also `channels:read`, `groups:read`, `mpim:read` |
| posting; DMs to `sendTo` people; reactions; files | | `chat:write` (`chat:write.public`); `im:write`; `reactions:write`; `files:write` |

A missing scope drops only what needs it (a name, a file, a send, part of a catch-up). Only a
channel given by name needs `channels:read` to start.

#### Reading what was written before

`read_source` with `{"channel": "C0123ABCD"}` reads a channel's last 20 messages (`"limit"` up to
50, `"before": "<ts>"` further back), with `{"channel": "U0123ABCD"}` a direct conversation
(through `im:write` if that person has not written since set-up), with `"thread": "<ts>"` a
thread. It reads only where the source listens, marks nothing read, and marks the conversation as
having read outside content. `"history": false` turns it off.

#### Sending to Slack

`send` takes `text`, `file`, and `data` `{"channel": "C0123OPS"}`, plus `"thread"` to answer in a
thread, or `"ts"` and `"react": "eyes"` for an emoji. With one `sendTo` entry, `channel` may be left
out. A person on `sendTo` includes their direct conversation. `@channel`, `@here` and `@everyone`
ping nobody. Slack's refusals come back in its own words with what to do (`not_in_channel`:
invite the app).

#### After a time without a connection

Once the connection is back, pine asks Slack for what was written meanwhile where the source
listens: messages come with `late: true`, oldest first. After a minute or more, a `gap` event comes
first, with a sentence in `text`. A shorter gap is made up quietly. `complete: false` means not
everything is known, and `missing` says why:

- scopes to read or list conversations (add them and reinstall)
- no `token`, or `history: false`
- more than `perMinute` or 200 messages in a conversation (read the rest with `read_source`)
- more than 200 conversations
- always reactions and edits, which Slack can't give afterwards

An agent passes that on instead of "nothing new".

#### Limits, and what is refused

One source is one app in one workspace. Interactivity (buttons, forms) is not reported. Slack
never speaks for you (no `trust: "owner"`). Refused at set-up: an `appToken` not `xapp-`, a `token`
not `xoxb-` or `xoxp-` (no rotating `xoxe`), names where ids belong, unknown `events`, `perMinute`
outside 1 to 600, `maxMb` over 50. Refused at start, shown in the status: `"me"` or a channel name
without `token`, an unknown channel name (`there is no channel named "opps" that the app can see`),
a token Slack refuses (`invalid_auth`).

### matrix

A Matrix account: messages in the rooms it joined, all or by mention or keyword. Long polling, no
port.

| Option | Default | |
|---|---|---|
| `homeserver` | | `https://...` (`http://` only on your network). |
| `token` | | An access token (Element: Settings, Help & About, Advanced). Kept in `.env`. |
| `rooms` | every joined room | Room ids (`!...`), not aliases. |
| `mentions` | | User ids (`@name:server`). |
| `keywords` | | Words. Case doesn't matter. |
| `ignore` | | User ids never reported. |
| `sendTo` | none | Room ids an agent may write to: `{"room": "!...", "text": "..."}`. |
| `local` | `false` | A local address whose name doesn't show it. |

Event `message`: `{ text, user, room, roomName?, kind, id, mention?, keyword?, dropped? }`, `kind`
`"dm"` or `"room"`. 60 a minute at most. Messages written while pine was down are reported later
(50 a room). The token is the key to the account: take it from a private-window session you close
without logging out, or use an account made for pine. Encrypted rooms can't be read; their
messages are only counted in the status. A refused token shows as `M_UNKNOWN_TOKEN`.

### discord

A Discord bot: messages in its servers and direct messages to it, all or by mention or keyword.

| Option | Default | |
|---|---|---|
| `token` | | The bot's token. Kept in `.env`. |
| `channels` | every readable channel | Channel ids. |
| `guilds` | every server | Server ids. |
| `mentions` | `false` | `true`: in servers, only messages mentioning the bot. |
| `keywords` | | In servers. With `mentions`, either is enough. |
| `dms` | `true` | Direct messages count. |
| `bots` | `false` | Other bots' and webhooks' messages count. |
| `sendTo` | none | Channel ids an agent may write to: `{"channel": "...", "text": "..."}`. |
| `apiBase` | `https://discord.com/api/v10` | A compatible server: https, or on this machine. |

Ids are long numbers ("Developer Mode", then "Copy ID"); names are refused. Event `message`:
`{ text, user, userName, channel, channelName?, guild?, guildName?, kind, id, mention?, keyword?,
files?, dropped? }`, `files` listing attachments without contents. 60 a minute at most.

Make the bot at discord.com/developers/applications: "New Application", "Bot", "Reset Token"
(`token`). Switch on Message Content Intent under "Privileged Gateway Intents", or Discord closes
the connection (the status says so). Invite it with "OAuth2", "URL Generator", `bot` with "View
Channels", "Read Message History" (and "Send Messages"). Long texts go out as several messages and
ping nobody.

### zulip

A Zulip organization: channel messages and direct messages to the bot, all or by mention or
keyword.

| Option | Default | |
|---|---|---|
| `site` | | The organization's address. |
| `email` | | The bot's email address (Settings, Bots, "Add a bot"). |
| `key` | | The bot's API key. Kept in `.env`. |
| `streams` | every channel public to the bot | Channel names. Direct messages count either way. |
| `mentions` | `false` | `true`: only messages mentioning the bot (not `@all`). Zulip marks a channel mention only for subscribers: add the bot to the channel. |
| `keywords` | | With `mentions`, either is enough. |
| `ignore` | | Sender emails never reported. |
| `sendTo` | none | Channels an agent may write to: `{"stream": "...", "topic": "pine", "text": "..."}`. |
| `local` | `false` | A local address whose name doesn't show it. |

Event `message`: `{ text, user, name, stream, topic, kind, id, mention?, keyword?, dropped? }`,
`kind` `"dm"` or `"stream"`. 60 a minute at most. A dropped connection resumes; if Zulip let the
queue expire, what was written meanwhile is not reported.

### smtp

A small mail server for devices that send notifications only by e-mail, such as a NAS, a printer or
a UPS. Each mail becomes an event.

| Option | Default | |
|---|---|---|
| `port` | | `2525` (below 1024 many systems want root). |
| `user` | `"device"` | Filled in when an agent sets it up. In a file you write, give it with a password. |
| `password` | made by pine | 8 characters or more. Made when an agent sets it up without one, in `.env` as `PINE_SOURCE_<NAME>_<AGENT>_PASSWORD`. Left out with `allow`, no login is asked. |
| `allow` | everyone who logs in | Client address prefixes: `["192.168.1.40", "192.168.2."]`. |
| `host` | `"0.0.0.0"` | Where to listen. |
| `to` | any | Recipients accepted, others refused. They need not exist. |
| `maxMb`, `keepDays` | `10`, `7` | Largest message in MB (50 at most). Attachments are kept this many days. |

Event `mail`: `{ from, fromName?, to, subject, text, attachments, images?, client }`, `client` the
address it really came from. In the device: this computer as SMTP server, the port, no
encryption, the user and password (or `allow` and no password, for a printer that can't log in;
one of the two is required). Linux servers relay root's mail here with `msmtp` (`tls off`) or a
Postfix `relayhost`. It relays nothing. Refused: over `maxMb`, a recipient not on `to`, a client
not on `allow`, three wrong passwords, over 20 connections, a minute of silence, over 30 messages a
minute ("try again later").

### syslog

Takes the log lines devices send to a "remote log server" and reports those that matter.

| Option | Default | |
|---|---|---|
| `port` | | `5514` (514 often needs root). |
| `host` | `"0.0.0.0"` | The address to listen on. |
| `protocol` | `"udp"` | `"tcp"` or `"both"`. |
| `allow` | anyone | Sender address prefixes. Syslog has no login: without `allow` the dialog warns. |
| `match` | | Only lines it finds something in. |
| `severity` | `"warning"` | Least severe level reported, `emerg` ... `debug`. `"debug"` reports every matching line. |
| `perMinute` | `20` | 1 to 600. The rest are counted and dropped. |

Event `line`: `{ host, app?, severity, facility, message, from, time?, dropped? }`, `from` the real
sender, `message` up to 2000 characters. RFC 3164 and RFC 5424 are read; other lines get severity
`notice`. TCP: 20 connections, 8 KB lines. Linux: rsyslog `*.warn @<address>:5514` (`@@` for TCP).
MikroTik: `/system logging action set remote remote=<address> remote-port=5514`. Set a `throttle`
("5m") on the subscription so a burst wakes the agent once.

### onvif

A network camera's own detections over ONVIF (Profile S and T): motion, a person, tampering, a line
crossed, a doorbell button.

| Option | Default | |
|---|---|---|
| `host` | | The camera's address, without `http://` or port. |
| `user`, `password` | | A camera account with the least rights that read events. Password in `.env`. |
| `port` | `80` | Reolink 8000, Tapo 2020, Hikvision, Dahua and Axis 80, others 8080 or 8899. |
| `path` | `"/onvif/device_service"` | Where the ONVIF service is. |
| `topics` | everything | Words a topic must contain (up to 20). Case doesn't matter. |
| `perMinute` | `20` | 1 to 120. |
| `local` | `false` | A local address whose name doesn't show it. |

Event `event`: `{ topic, source, data, time?, active?, dropped? }`. `topic` is the camera's name
(`RuleEngine/CellMotionDetector/Motion`), `source` which camera of a recorder, `data` the values
(`{ "IsMotion": true }`), `active` the one yes-or-no value if there is one (`{"payload.active":
true}` for starts only). Topics such as `Motion`, `People`/`Person`/`Vehicle`/`DogCat`, `Tamper`,
`LineDetector/Crossed`, `Visitor` and `DigitalInput` differ by make: start without `topics` and
watch `pine events --topic 'source/gate/#'`.

Hikvision and Axis need an ONVIF user added in their ONVIF settings; on Tapo the camera account is
the user. pine asks the camera for news, so the camera needs no way to reach pine. Only changes are
reported, and no picture comes along (use `ftp` for that). Not supported: digest-only HTTP
authentication (choose "digest and WS-UsernameToken") and ONVIF over HTTPS.

### modbus

A Modbus TCP device read again and again: each value when it changes.

```json
"battery": {
  "type": "modbus", "host": "192.168.1.60", "unit": 100, "every": "1m",
  "read": [
    { "name": "soc", "address": 843 },
    { "name": "power", "address": 842, "type": "i16", "step": 200 },
    { "name": "voltage", "address": 840, "scale": 0.1, "step": 0.5 }
  ],
  "description": "the house battery (Victron GX: unit 100)"
}
```

| Option | Default | |
|---|---|---|
| `host` | | The device's address. |
| `read` | | 1 to 32 values (next table). |
| `port` | `502` | SolarEdge uses 1502. |
| `unit` | `1` | Unit (slave) id, 0 to 255. |
| `every` | `"30s"` | At least `"2s"`. |
| `local` | `false` | A local address whose name doesn't show it. |

| Key of a `read` entry | Default | |
|---|---|---|
| `name` | | A short word. The event carries it. |
| `address` | | Register number from 0. In a list counting from 40001 or 30001, subtract that; for "base 1", subtract 1. |
| `kind` | `"holding"` | `"input"`, `"coil"`, `"discrete"` (the last two are `true`/`false`). |
| `type` | `"u16"` | `"i16"`, `"u32"`, `"i32"`, `"f32"` (the last three take two registers). |
| `scale` | `1` | Multiplier: `0.1` for tenths. |
| `step` | | Report only after moving this far since the last report. |
| `words` | `"be"` | For 32 bits: `"le"` if the low half comes first. |

Event `changed`: `{ name, value, previous }`; filter with `{"payload.name": "soc", "payload.value":
{"lt": 20}}`. The register list comes from the maker ("<model> Modbus register map"; SunSpec for
most inverters). Only read functions (1 to 4) are sent, over one short connection per look. A
refused register, or no answer within five seconds, is a failed look.

### serial

The lines a device prints on a serial port (USB or cable), such as an Arduino. macOS and Linux
only, not Windows.

| Option | Default | |
|---|---|---|
| `port` | | `/dev/cu.*` on a Mac (`ls /dev/cu.*`), `/dev/ttyUSB0`, `/dev/ttyACM0` or `/dev/serial/by-id/...` on Linux. |
| `baud` | `9600` | 9600, 19200, 38400, 57600, 115200 and the other usual ones. |
| `match` | | Only lines it finds something in. Its first group is `value`. |
| `changed` | `false` | Only when the line or value differs from the last. |
| `perMinute` | `30` | 1 to 600. |

Event `line`: `{ port, line, value?, previous?, dropped? }`; without `match`, `value` is the JSON or
number a line is. A P1 smart meter: 115200 baud, `"match": "1-0:1\\.7\\.0\\(([0-9.]+)"` (kW now).
Nothing is written to the port, so a device that must be asked stays silent. 8N1. Terminals and
anything under `/dev` that is not a serial device are refused. An unplugged device is waited for.
On Linux pine's user needs the port (group `dialout`). Lines are cut at 1000 characters.

### presence

Reports devices joining and leaving your own network.

```json
"home": { "type": "presence", "hosts": { "phone": "192.168.1.23", "tv": "192.168.1.30" }, "services": ["_ipp._tcp"], "away": "10m", "description": "who is at home: my phone, the TV, and any printer" }
```

| Option | Default | |
|---|---|---|
| `hosts` | | Name and address (a private IP or `.local` name), up to 32. |
| `services` | | Bonjour (mDNS) service types, up to 16: `_ipp._tcp` (printers), `_airplay._tcp`, `_googlecast._tcp`, `_hap._tcp` (HomeKit). Each device is reported by its name. |
| `every` | `"30s"` | At least `"10s"`. |
| `away` | `"10m"` | Silence before a device counts as gone. Not shorter than `every`. |

| Event | | |
|---|---|---|
| `arrived` | `{ name, address?, service?, awayFor? }` | `awayFor` in seconds: `{"payload.awayFor": {"gt": 3600}}` for a real absence. |
| `left` | `{ name, address?, service?, lastSeen }` | Silent for `away`. |

A host is there when it answers a ping or a connection. Give a phone a fixed address (a DHCP
reservation), switch off "Private Wi-Fi Address" on an iPhone, and lengthen `away` if it flickers.
A guest network or client isolation hides everything. A Mac may ask once for local network
access. Without network the look fails and nobody "leaves". On Linux, `.local` names need Avahi
with `nss-mdns`.

### system

This computer: sleep, lock, power, network, disks, and named apps, on macOS, Linux and Windows.

| Option | Default | |
|---|---|---|
| `watch` | all five | `"sleep"`, `"lock"`, `"power"`, `"network"`, `"volumes"`. |
| `apps` | none | Up to 30. Mac: name or bundle id (`"us.zoom.xos"`). Windows: program name, with or without `.exe`. Not on Linux. |
| `battery` | `20` | Percent for `battery-low` (1 to 99). |

| Event | | `watch` |
|---|---|---|
| `sleeping`, `woke` | `{}` | `sleep` |
| `display-off`, `display-on` | `{}` | `sleep`; not on Linux |
| `locked`, `unlocked` | `{}` | `lock` |
| `power` | `{ on, percent? }` | `power`; `on` is `"ac"`, `"battery"` or `"ups"` |
| `battery-low` | `{ percent }` | `power`; once per discharge |
| `network` | `{ online, via? }` | `network`; `via` `"wifi"`, `"ethernet"`, `"cellular"`, `"other"` |
| `mounted`, `unmounted` | `{ name, path? }` | `volumes` |
| `app-started`, `app-quit` | `{ app, bundle? }` | `apps`; not on Linux |

The state at start is the starting point; the charge alone is no event. No privacy grant is
needed. A disk's name is outside text. On a Mac the helper is built the first time, which needs
`xcode-select --install` (the Pine app carries it built).

#### system on Linux

Needs `gdbus` (`libglib2.0-bin` or `glib2`): logind for sleep and the lock (as your desktop reports
it), UPower for power, NetworkManager or systemd-networkd for the network, and mounts under
`/media`, `/run/media`, `/mnt` plus network shares. The status names what is missing
(`cannot hear power: UPower is not running`).

#### system on Windows

`ups` counts as mains. An app starts with the first process of its name and quits with the last,
seen within two seconds. A disk is named by its label or letter. pine in WSL hears little (no
lock, no battery).
