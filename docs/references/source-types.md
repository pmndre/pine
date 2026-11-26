# Source types: what each one watches, what it takes, what it is for

The catalogue of source types: each type's options, events and fields, the services it reaches,
and an entry to copy. What a source and a subscription are, the keys every source has, `when`,
secrets, trust, and the rules every type follows (the first look is the starting point, texts and
rates are capped, an address is the one you confirmed, a source sends only where you listed) are
in [sources.md](sources.md), "What all types have in common".

Say what you want watched ("tell me on Telegram when pmndre/pine has a new release"): the agent
picks the type and you confirm what the source will do. Or write the entry under `sources` in
`pine.json` or an agent's `agent.json`, with the type's options next to `type`.

## Which type for what

A type **is told** (it listens on a port or holds a connection) or **looks** (it asks again and
again and reports what changed).

| Type | Told or looks | Reports | For |
|---|---|---|---|
| `folder` | told | a new or changed file | scans, downloads, exports, a project folder |
| `webhook` | told | a request another service sends to pine | GitHub, Home Assistant, a phone shortcut |
| `stream` | told | each message a service pushes (Server-Sent Events, WebSocket) | ntfy, Gotify, Home Assistant, Mastodon, Bluesky, tickers, webhook relays, signal-cli |
| `mqtt` | told | messages on a broker's topics | Zigbee and Z-Wave hubs, sensors, plugs, printers |
| `telegram` | told | what you write to your bot | talking to an agent from anywhere |
| `mail` | told | a new mail in a mailbox | invoices, services that only write mail |
| `slack` | told | messages, reactions, edits, joins, channels, pins, slash commands | being told when somebody needs you; answering there |
| `matrix` | told | messages in a Matrix account's rooms | Element rooms, bridges |
| `discord` | told | messages in the channels a bot sees | a server's channels, direct messages to the bot |
| `zulip` | told | messages in a Zulip organization | a team's channels, direct messages to the bot |
| `ftp` | told | a file a device uploads | cameras, doorbells, scanners |
| `smtp` | told | a mail a device sends | NAS boxes, printers, UPS units, routers, cron jobs |
| `syslog` | told | a device's log lines | routers, firewalls, switches, NAS boxes |
| `onvif` | told | what a network camera detects | motion, a person, tampering, a doorbell button |
| `serial` | told | lines from a serial port | an Arduino, a smart meter's P1 port, a GPS |
| `system` | told | what this computer does | sleep, lock, power, network, disks, apps |
| `command` with `follow` | told | each line a running command prints | logs, `docker events`, `kubectl -w`, broker clients |
| `http` | looks | a change of a page or of one value in it | a price, a version, a status page, an API |
| `feed` | looks | new entries of an RSS, Atom or JSON feed | releases, blogs, videos, podcasts, status pages |
| `calendar` | looks | calendar entries new, moved or gone | appointments, school and club calendars |
| `command` | looks | a change in a command's output or exit code | disk space, a build, whether a machine answers |
| `modbus` | looks | a changed value in a Modbus device | solar inverters, heat pumps, wall boxes, meters |
| `presence` | looks | a device joining or leaving your network | a phone coming home, a TV switched on |

What should happen at a time is a schedule ([events.md](events.md), "Schedules"), not a source:
"ten minutes before an appointment" is a schedule the agent sets when `calendar` reports it.

### Looking again and again

`http`, `command`, `feed`, `calendar`, `modbus` and `presence` go and look:

- **The first look is the starting point**: setting a source up reports nothing.
- **A look that finds nothing new costs nothing**: no event, no model woken.
- **A failed look is not an event.** The pause doubles with each failed look in a row, up to 15
  minutes (or the source's interval, if longer), and is normal again after a look that works.
- Two looks of one source never overlap, and looks are spread a little so that sources with one
  interval do not fire together.

The source list (`pine sources`, `/sources`, the `sources` tool) says `last looked 14:02:11` or
`failing since 14:02:11 (4 looks): it answered 503`, and what was found if it is a number or one
word.

## Which type for which service

| Service or device | Type | How |
|---|---|---|
| GitHub releases, commits, tags | `feed` | `https://github.com/<owner>/<repo>/releases.atom` (`commits/<branch>.atom`, `tags.atom`) |
| GitHub pushes, issues, pull requests | `webhook` | A repository webhook with the secret; without a public address, a relay (smee.io) and `stream`. |
| YouTube, podcasts, blogs, arXiv, Reddit, Hacker News | `feed` | The feed's address. |
| A price, a version, a status page without a feed | `http` | `match`, `select` or `path`. |
| A page filled in by its scripts | `http` | `render`. |
| An API asked with POST (GraphQL) | `http` | `method: "POST"`, `body`. |
| Home Assistant | `stream`, `mqtt`, `webhook` | Its WebSocket API with `hello`, its MQTT broker, or an automation calling pine's webhook. |
| Zigbee, Z-Wave | `mqtt` | zigbee2mqtt, zwave-js-ui. |
| ntfy, Gotify, Signal (signal-cli), Mastodon, Bluesky, Nostr | `stream` | See "What a stream reaches". A Mastodon account's posts alone: `feed` (`https://<server>/@<name>.rss`). |
| Slack, Discord, Matrix, Telegram, Zulip | their own type | An app, a bot, or an access token. |
| Gmail, iCloud, Fastmail, your own server | `mail` | IMAP with an app password. |
| Outlook.com, Hotmail, Microsoft 365 | `mail` | `"signIn": "microsoft"`. |
| Google Calendar, iCloud, Outlook, Nextcloud | `calendar` | The iCal address. |
| Synology, QNAP, TrueNAS, Proxmox, UniFi, a UPS, a printer | `smtp` | Its e-mail notification setting, pointed at pine. |
| A router, firewall, switch or NAS | `syslog` | Its remote log server setting. |
| A camera that uploads pictures | `ftp` | Its "upload to FTP" setting. |
| A camera's motion and person detection | `onvif` | The camera's ONVIF user. |
| Inverter, heat pump, wall box, energy meter | `modbus` | Modbus TCP and the register list. |
| A 3D printer | `mqtt` | Bambu printers are their own broker; OctoPrint and Klipper through an MQTT plug-in. |
| Arduino, ESP32, P1 cable, GPS | `serial` | The device under `/dev`. |
| "Is my phone home" | `presence` | The device's fixed address. |
| This computer | `system` | Nothing to set up. |
| A log file, Docker, Kubernetes, journald, PostgreSQL, Redis, NATS, Kafka | `command` with `follow` | `tail -F`, `docker events`, `kubectl get -w`, `journalctl -f`, the client printing a line per message. |
| Anything a command can print | `command` | Run again and again. |

## The types

### folder

Reports every new or changed file once it has stopped growing.

```json
"scans": { "type": "folder", "dir": "~/Scans", "mask": "*.pdf" }
```

| Option | Default | |
|---|---|---|
| `dir` | | The folder; `~` and paths relative to the configuration file work. Not inside pine's home (the agent's workspace aside). A folder outside the workspace becomes readable by the agent. |
| `mask` | | Only file names matching, as in a shell: `*.pdf`, `*.{png,jpg}`, `report-??.csv`; several separated by commas. Capitals do not matter. |
| `pattern` | | Only full paths matching this regular expression. |
| `ignore` | version control, dependencies, editor leftovers | Never paths matching this regular expression. The default skips `.git`, `.hg`, `.svn`, `node_modules`, `.build`, `DerivedData`, `__pycache__`, `.venv`, `.DS_Store`, and names ending in `~`, `.swp`, `.tmp`, `.part`, `.crdownload`. |
| `settle` | `"1.5s"` | How long a file must stay unchanged to count as complete. |
| `recursive` | `true` | Also folders inside it. |

Event `added`: `{ path, file, size, images? }`. A jpg, png, webp or gif under 10 MB is shown to a
model that can see images. An empty file is waited for longer, then reported with `size` 0. When
the folder cannot be watched, the status gives the system's error code and it retries, up to once
a minute.

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
| `publish` | none | Topics an agent may send to: `["zigbee2mqtt/+/set"]`. It sends `{"topic": "lamp/set", "message": "on"}`, never to a filter (`+`, `#`). Without it the source only listens. |
| `username`, `password`, `clientId` | | As the broker wants them. |
| `minInterval` | | Drop messages on a topic that follow its last one sooner than this. |
| `insecureTls` | `false` | Accept a certificate that cannot be verified. |

Event `message`: `{ topic, value }`, `value` the parsed JSON or the text. The example is a Bambu
printer in LAN mode: user `bblp`, the access code from its screen as password.

### webhook

A web address other services call: `POST http://<pine's control address>/hook/<name>`
(`/hook/<name>@<agent>` for an agent's own source).

```json
"github": { "type": "webhook", "secret": "${GITHUB_HOOK_SECRET}", "description": "pushes and issues of my repositories" }
```

| Option | |
|---|---|
| `secret` | The caller sends `Authorization: Bearer <secret>`, or an HMAC SHA-256 signature of the body in `X-Hub-Signature-256` or `X-Signature` (as GitHub does). An agent that leaves it out gets one made by pine, in `.env`. |
| `open` | `true` instead of a secret: anyone who can reach the port. Only for a port nobody else reaches. |

Event `received`: `{ body, headers }`. `body` is the parsed JSON, or `{ text }`; of the headers
only those naming the kind of request are kept (`content-type`, `user-agent`, `x-github-event`
and the like). It needs the control API (`http` in `pine.json`), on `127.0.0.1` by default: from
the internet only through a tunnel or reverse proxy. Without a subscriber the address answers
"not found".

### ftp

A small FTP server that accepts uploads and nothing else, for devices that "upload to FTP".

```json
"door": { "type": "ftp", "port": 2121, "user": "cam", "password": "${CAMERA_FTP_PASSWORD}", "allow": ["192.168.1.40"], "description": "pictures from the front door camera when it sees motion" }
```

| Option | Default | |
|---|---|---|
| `port` | | The port to listen on. |
| `user` | `"device"` | Filled in when an agent sets the source up; in a file you write, give it. |
| `password` | made by pine | 8 characters or more. Made when an agent sets it up without one, kept in `.env`. |
| `host` | `"0.0.0.0"` | The address to listen on. |
| `allow` | everyone | Only these clients: an address (`"192.168.1.40"`) or a prefix ending in a dot (`"192.168.2."`). |
| `pasvPorts` | any | `[from, to]` for data connections, if a firewall must know them. |
| `maxFileMb` | `50` | Largest file accepted. |
| `keepDays` | `7` | Received files are deleted after this many days. |

Event `upload`: `{ file, path, size, from, images? }`. `file` is the device's name for it, `path`
where it lies (`data/sources/<name>/files/`). A picture is shown to the agent; a video is not, the
agent reads it from `path` ("Files a source received" in [sources.md](sources.md)). Plain FTP: the
password crosses your network unencrypted. Nothing can be listed, read or deleted; files are
written under names pine chooses into the source's own folder. 20 connections at most. Set the
device to passive mode.

### telegram

A Telegram bot: you write to it from anywhere, the subscribed agent answers there, and agents
reach you through it.

The agent calls `add_source`; you type the bot's token into the dialog, where it does not pass
through a model. Then you pair the bot with your account:

1. Write anything to the bot in Telegram.
2. It answers with a six-digit code.
3. pine shows a question on your computer naming the account; type the code there.

From then on the bot listens to that account only. A stranger can make the question appear but
cannot see the code; an account you deny is not asked about again. Before pairing, an unknown
account gets only the code message; after it, no answer at all. To pair another account, remove
the source and set it up again.

```json
"telegram": { "type": "telegram", "token": "${PINE_SOURCE_TELEGRAM_MAIN_TOKEN}", "trust": "owner", "description": "my Telegram" }
```

| Option | Default | |
|---|---|---|
| `token` | | From @BotFather (`/newbot`). Kept in `.env`. |
| `allow` | pairing | Telegram user ids that may talk to it; then nothing is paired. Unasked messages and approvals go to the first. |
| `approvals` | `true` | Approval requests also go there, with Allow, Deny and (where it can be kept) Always buttons; `/allow` and `/deny` work too. An agent's own bot carries that agent's requests only; a bot for all agents, everyone's. A request that needs a secret typed is never sent there. |
| `apiBase` | Telegram's | A Bot API server of your own: https, or on this machine. |

A `question` with answers to pick arrives in the chat: a button per answer (and "No answer") when
one is to be picked, numbered answers when several may be. Answer several by replying to that
message ("1,3" or your own words), or with a message of only its numbers. A question without
answers to pick, or an own-words answer to a one-answer question, you give in the terminal UI or
the Pine app. Anything else you write to the bot reaches the agent as usual.

Event `message`: `{ text, name, username, chatId, messageId, images? }`. A photo (up to 10 MB) is
shown to the model. Only the private chat counts; groups reach no agent.

- **It speaks for you**: what you write counts as your own words, with no outside-content mark.
  That is why pairing takes a code.
- **It sends**: the agent writes with `send`, with a picture, video or sound file up to 50 MB,
  without asking you. Markdown is shown formatted; a link shows its address; approval and
  pairing messages are plain text.
- **No throttle**: the default ten-second `throttle` of a subscription does not apply unless set.

Long polling: nothing listens on a port. Telegram gives a bot's messages to one reader only: when
another program reads them (another pine with this token, a script), this source gets nothing and
its status says so. Stop the other, or `/revoke` the token at BotFather and set the source up
again.

### http

A web address looked at again and again, for what cannot call you: a price, a version, a status
page, a device's state page.

```json
"price": { "type": "http", "url": "https://shop.example/fridge-3000", "match": "Price: ([0-9.,]+)", "every": "30m", "description": "the price of the fridge" }
```

| Option | Default | |
|---|---|---|
| `url` | | `https://...` (`http://` for a device on your network). |
| `every` | `"5m"` | At least `"30s"` when an agent sets it up, `"2m"` with `render`. |
| `path` | | For JSON: watch this field, `"data.price"`, `"items.0.state"`. |
| `values` | | For JSON: up to twenty fields under names of yours: `{ "price": "data.price" }`. |
| `match` | | Watch what this regular expression finds (its first group), in the text a reader sees, then in the source. |
| `select` | | The text of the first element this CSS selector matches. See "One element of a page". |
| `attr` | | With `select`: this attribute instead of the text (`"content"`). |
| `render` | `false` | Open the page in pine's browser at every look. See "A page that a script fills in". |
| `method` | `"GET"` | Or `"POST"`. Nothing else. |
| `body` | | With `POST`: what to send, up to 20000 characters; as JSON when it is JSON. Not for secrets. |
| `headers` | | Headers to send. `authorization` and `cookie` are refused: use `token`. |
| `token` | | Sent as `Authorization: Bearer <token>`, only to that host. Kept in `.env`. |
| `tokenHeader` | | Send the token as this header instead: `"x-api-key"`, `"cookie"`. |
| `local` | `false` | On your network under a name that does not say so (`nas.home`). Not needed for an IP address, `localhost` or `.local`. |

Take one of `path`, `values`, `match`, `select`. Without any, the whole text a reader sees counts;
a page showing the time then changes at every look.

| Event | | |
|---|---|---|
| `changed` | `{ url, value, previous, number?, previousNumber? }` | With `path`, `match` or `select`. |
| `changed` | `{ url, values, previous, changed }` | With `values`; `changed` names the fields that differ. |
| `changed` | `{ url, added, removed, more? }` | Without: lines new and gone, up to 30 each. |
| `down` | `{ url, error, looks }` | After three failed looks in a row, once. |
| `up` | `{ url }` | It answers again. |

#### One element of a page

`select` finds a value by its place in the page:

```json
"fridge": { "type": "http", "url": "https://shop.example/fridge-3000", "select": ".product-detail .price", "every": "30m" }
```

Without `render` a selector takes tags, `#id`, `.class`, `[attr]`, `[attr=value]` (also `~=`
`^=` `$=` `*=`), combined (`span.price`), nested with a space or `>`, alternatives with a comma.
Nothing with a colon, no `+` or `~`. Many shops state the price for machines too:
`"select": "meta[property=product:price:amount]", "attr": "content"`. What a script fills in later
is not in the page as sent: use `render`, or the address the script asks.

#### A page that a script fills in

With `render` every look starts pine's browser (fetched by `pine init` and
`pine browser-install`) without a window and with an empty profile, waits until the page has
loaded and gone quiet (five seconds at most), takes what a reader sees, and closes it.

```json
"fridge": { "type": "http", "url": "https://shop.example/fridge-3000", "render": true, "select": ".product-detail .price", "every": "30m" }
```

`select` then takes any CSS (`li:nth-child(2) .price`), and no match is `null`; `match` looks only
in the text a reader sees. Two browsers run at a time for all sources; a look may take 45 seconds.
Refused with `render`: `path`, `values`, `method`, `body`, `headers`, `token`, `tokenHeader` (the
browser would send them everywhere the page loads from, so a page behind a login cannot be
watched), and `local: true`. Where the page's script gets its value from a JSON address (your
browser's network tab shows it), watching that with `path` is lighter.

The page's scripts run (the dialog says so), through the browser tools' guard
([security.md](security.md)): the internet is reachable, your network and this computer are not,
except the page's own address when it says by itself that it is local (`localhost`, `.local`, a
private IP), and then that host and port only. A name that only looks up to a local address, and
pine's control port, are never opened. A redirect to another host is a failed look. Nothing is
kept between looks: no cookies, no logins, no downloads, no permissions.

The status names why a look failed: `pine's browser is not installed on this computer` (run
`pine browser-install`), `the page did not finish loading within 45 s`, `it sends on to <host>`,
`it answered 403`. `found nothing with the selector` is no failure: the selector is wrong or the
page fills the element in later.

#### An amount as a number

A value that reads as a number or an amount also arrives as `number` (and `previousNumber`), for
`when`: `{ "payload.number": { "lt": 500 } }`.

| The value | `number` |
|---|---|
| `"12,5"`, `"87 %"`, `"-3,5 °C"`, `"3 GB"` | 12.5, 87, -3.5, 3 |
| `"$1,299.00"`, `"1.299,00 €"`, `"1 299,00 kr"`, `"1'299.50"` | 1299, 1299, 1299, 1299.5 |
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
(`{ "payload.values.stock": { "gt": 0 } }`). What a POST sends is shown to you before set-up.

#### Limits of a look

An answer is read up to 1 MB within 20 seconds, following up to five redirects on the same host.
From the second look on, an address with `ETag` or `Last-Modified` is asked "anything new
since?" (so are `feed` and `calendar`). A key in the address (`?apikey=`) is stored and shown like
the rest. Refused at set-up: a user name or password in the address, more than one of `path`,
`values`, `match`, `select`, `attr` without `select`, an unreadable selector, `body` without
`POST`, `values` empty, over twenty, or under names that are not plain words.

### command

A command run again and again, for what only a command can tell: free disk space, a build, a
branch, whether a machine answers.

```json
"disk": { "type": "command", "run": "df -h /", "match": "([0-9]+)%", "every": "10m", "description": "how full the disk is" }
```

| Option | Default | |
|---|---|---|
| `run` | | The command line, up to 2000 characters, run by bash from the source's agent's workspace. |
| `every` | `"1m"` | At least `"5s"` when an agent sets it up. |
| `match` | | Watch what this regular expression finds in the output (its first group). |
| `timeout` | `"30s"` | At least `"1s"`. |

Event `changed`: `{ command, code, previousCode?, value, previous }` with `match`, or `{ command,
code, previousCode?, added, removed, more? }` without. `previousCode` comes when the exit code
changed, so `test -f build/done` reports by how it ends.

It always runs **as a shell command in `safe` mode**, also for an agent in `auto`: in the agent's
sandbox, with its private home, no network unless `sandbox.network`, nothing of your home beyond
`sandbox.read`. A source of all agents runs as the main agent. You see the command line before
set-up. Without a sandbox on the machine a `command` source does not run; `pine check` says so.

#### Following a command that keeps running

With `follow` the command is started once and every line it prints is an event: the type for any
protocol that has a command line client.

```json
"backup": { "type": "command", "run": "tail -n 0 -F ~/Library/Logs/backup.log", "follow": true, "match": "ERROR (.*)", "description": "errors in the backup log" }
```

| Option | Default | |
|---|---|---|
| `follow` | `false` | `true`: keep it running, report each line. Not with `every` or `timeout`. Not on Linux. |
| `perMinute` | `30` | At most this many lines a minute, 1 to 600; the rest are counted in `dropped`. |
| `match` | | Only lines it finds something in; its first group is `value`. |

| Event | | |
|---|---|---|
| `line` | `{ command, line, value?, dropped? }` | One line, without terminal codes, cut at 2000 characters. `value` is the `match`, or the parsed line if it is JSON (`{"payload.value.status": "die"}`). |
| `ended` | `{ command, code?, error?, ran }` | It ended (`ran` in seconds, `error` the end of its error output) and is started again after a growing pause; one that ends at once is reported once. |

Commands to follow: `tail -n 0 -F /path/app.log`, `log stream --style ndjson --predicate '...'`,
`docker events --format '{{json .}}'`, `kubectl get pods -w -o json`, `ssh nas journalctl -f -o
json`, `redis-cli --raw subscribe alerts`, `nats sub 'orders.>'`, `kcat -C -b broker -t topic -o
end`, `ssh nas inotifywait -m -e close_write /volume1/scans`. The same sandbox holds: a log file
needs `sandbox.read`, a network client `sandbox.network`. When the source stops, the command ends
with everything it started. On Linux `follow` is refused (the sandbox cleans up only after a
command ends): use `every` with a `match`, or send the lines to `syslog` or `webhook`.

### feed

Each entry of a feed that was not there before is one event.

```json
"node": { "type": "feed", "url": "https://github.com/nodejs/node/releases.atom", "every": "1h", "description": "releases of Node.js" }
```

| Option | Default | |
|---|---|---|
| `url` | | The feed itself, not the page linking to it. |
| `every` | `"15m"` | At least `"1m"` when an agent sets it up. |
| `match` | | Only entries whose title or text this regular expression finds: `"security\|CVE"`. |
| `headers` | | Not for secrets. |
| `token` | | Sent as `Authorization: Bearer <token>`. Kept in `.env`. |
| `tokenHeader` | | Send the token as this header instead. |
| `local` | `false` | On your network under a name that does not say so. |

| Event | | |
|---|---|---|
| `entry` | `{ feed, title, link, id, published?, author?, summary, media?, more? }` | `feed` the feed's title, `summary` the text (1500 characters), `published` in UTC, `media` a podcast's file. |

Ten entries a look at most, oldest first; with more, the newest ten, the last carrying `more`. An
entry is known by its id, else link, else title and date; one that leaves and returns is not new.
RSS 2.0, RSS 1.0, Atom and JSON Feed. An answer that is a web page, or a redirect to another host,
is a failed look; up to 1 MB is read.

| For | Address |
|---|---|
| GitHub | `https://github.com/<owner>/<repo>/releases.atom`, `.../commits/<branch>.atom`, `.../tags.atom` |
| YouTube | `https://www.youtube.com/feeds/videos.xml?channel_id=<id>` (`?playlist_id=` for a playlist) |
| A blog | Usually `/feed`, `/rss.xml`, `/atom.xml`, `/index.xml` |
| arXiv | `https://export.arxiv.org/rss/<category>` |
| Reddit | `https://www.reddit.com/r/<name>/.rss`, `https://www.reddit.com/search.rss?q=<words>` |
| Hacker News | `https://hnrss.org/frontpage`, `https://hnrss.org/newest?q=<words>`, `https://hnrss.org/newest?points=300` |
| A status page | `/history.atom` or `/history.rss` (`https://www.githubstatus.com/history.atom`) |
| Mastodon | `https://<instance>/@<name>.rss` |

### calendar

Reports entries of an iCalendar (`.ics`) address that were added, changed or removed.

```json
"family": { "type": "calendar", "url": "https://calendar.google.com/calendar/ical/.../basic.ics", "ahead": "30d", "description": "the family calendar" }
```

| Option | Default | |
|---|---|---|
| `url` | | `https://...` or `webcal://...` (read over https). |
| `every` | `"15m"` | At least `"1m"` when an agent sets it up. |
| `ahead` | `"60d"` | Only entries beginning within this; at least `"1h"`. What is added further away is never reported. |
| `headers` | | Not for secrets. |
| `token` | | Sent as `Authorization: Bearer <token>`. Kept in `.env`. |
| `tokenHeader` | | Send the token as this header instead. |
| `local` | `false` | On your network under a name that does not say so. |

| Event | | |
|---|---|---|
| `added` | `{ calendar, uid, summary, start, end?, allDay?, zone?, location?, description?, repeats? }` | A new entry. |
| `changed` | the same, with `was: { summary, start, end?, location? }` | Title, time or place changed (not the description alone). |
| `removed` | `{ calendar, uid, summary, start }` | An entry still ahead is gone or cancelled. |

`start` is `2026-12-24T17:00:00Z` (UTC), `2026-12-24T18:00:00` with `zone` (that zone's clock) or
without it (floating), or `2026-12-24` with `allDay` (`end` is then the last day). It never fires
because an entry is about to begin, and a past entry leaves silently: a reminder is a schedule the
agent adds with `add_schedule` (`at`). A repeating entry is one entry with its rule in `repeats`;
a moved date of it is its own entry with the same `uid`. Twenty changes a look at most (`more`).
Over 8 MB is a failed look. A Google "secret address in iCal format" is a key in itself, stored
and shown like any address.

### stream

pine connects once and the service pushes, over Server-Sent Events (`https://`) or a WebSocket
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
| `url` | | `https://` for Server-Sent Events, `wss://` for a WebSocket; `http://` and `ws://` only on your network. |
| `kind` | by the address | `"sse"` or `"websocket"`, for a WebSocket at an `https://` address. |
| `hello` | | WebSocket only: messages sent after connecting (one or a list, text or JSON). `{{token}}` is replaced by the token. |
| `token` | | Sent as `Authorization: Bearer <token>`, or only where `hello` says `{{token}}`. Kept in `.env`. |
| `tokenHeader` | | Send the token as this header instead: `"x-gotify-key"`. |
| `headers` | | Not for secrets. |
| `event` | | Server-Sent Events only: only events of this name. |
| `path` | | For JSON: take this field; a message without it is left out. |
| `match` | | Only messages it finds something in; a group's match is the value. |
| `changed` | `false` | Report a value only when it differs from the last. |
| `perMinute` | `30` | 1 to 600; the rest are dropped and counted. |
| `local` | `false` | On your network under a name that does not say so. |

| Event | | |
|---|---|---|
| `message` | `{ value, event?, id?, previous?, dropped? }` | `value` is the JSON, the text, or what `path` and `match` picked, cut to 4000 characters. |
| `down` | `{ url, error }` | After three failed connection attempts, once. |
| `up` | `{ url }` | Connected again. |

Nothing sent before or while disconnected is reported, except what an SSE service resends for
`Last-Event-ID`. Reconnects start after a second and double up to five minutes. A WebSocket is
pinged every 45 seconds; an event stream silent for five minutes is reconnected. A message over
256 KB is left out.

#### What a stream reaches

| Service | Entry | What arrives |
|---|---|---|
| ntfy | `{ "type": "stream", "url": "https://ntfy.sh/my-topic/sse", "event": "message", "path": "message" }` | Each notification's text. A protected topic takes a `token`. |
| Gotify | `{ "type": "stream", "url": "wss://gotify.example.com/stream", "token": "${GOTIFY_CLIENT_TOKEN}", "tokenHeader": "x-gotify-key" }` | `{ title, message, priority, appid }`. |
| Home Assistant | the example above | One entity's state. `subscribe_events` with `state_changed` gives every change (add `match`, a low `perMinute`). Token: a long-lived access token from your profile. |
| signal-cli | `{ "type": "stream", "url": "http://127.0.0.1:8080/api/v1/events", "event": "receive", "path": "envelope" }` | Each Signal message, for `signal-cli daemon --http 127.0.0.1:8080`. |
| Mastodon | `{ "type": "stream", "url": "https://mastodon.social/api/v1/streaming/user", "event": "notification", "token": "${MASTODON_TOKEN}" }` | Mentions, boosts, follows. Use your instance's streaming address. |
| Bluesky (Jetstream) | `{ "type": "stream", "url": "wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post&wantedDids=did:plc:...", "path": "commit.record.text" }` | One account's posts. |
| smee.io relay | `{ "type": "stream", "url": "https://smee.io/your-channel", "path": "body" }` | Webhooks for a machine without a public address. Anyone knowing the channel can write to it. |
| Kraken ticker | `{ "type": "stream", "url": "wss://ws.kraken.com/v2", "hello": { "method": "subscribe", "params": { "channel": "ticker", "symbol": ["BTC/EUR"] } }, "path": "data.0.last", "changed": true, "perMinute": 2 }` | The last price, twice a minute at most. |
| Nostr relay | `{ "type": "stream", "url": "wss://relay.damus.io", "hello": [["REQ", "pine", { "kinds": [1], "authors": ["<public key in hex>"] }]], "path": "2.content" }` | One author's notes. |

A page an agent makes for you offers what is pressed as such a stream ([interfaces.md](interfaces.md)).

### mail

A mailbox over IMAP: every new mail the moment the server says so (IDLE), with text and
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
| `password` | | Kept in `.env`; usually an app password. An agent leaves it out and pine asks you. Not with `signIn`. |
| `signIn` | | `"microsoft"`, for Outlook.com, Hotmail, Live and Microsoft 365. See "A Microsoft mailbox". |
| `clientId` | | With `signIn`: your Microsoft app's Application (client) ID. |
| `tenant` | `"common"` | With `signIn`: `"common"`, `"consumers"` (private accounts), `"organizations"`, or one organisation's domain or id. |
| `port` | `993` | `143` with `security` `"starttls"` or `"none"`. |
| `security` | `"tls"` | `"starttls"`, or `"none"` for a server on your network only. |
| `mailbox` | `"INBOX"` | The folder, as the server spells it (`"[Gmail]/All Mail"`). |
| `from` | everyone | Only mail claiming to be from an address or `@domain`. A filter, not a proof. |
| `subject` | | Only subjects this regular expression finds. Capitals do not matter. |
| `maxMb` | `10` | Attachments kept up to this size (50 at most). |
| `keepDays` | `7` | Kept attachments are deleted after this many days. |
| `smtpHost` | | For sending; only with `sendTo`. |
| `smtpPort` | `465` | Other ports (`587`) use STARTTLS. |
| `sendTo` | none | Addresses an agent may write to. |
| `sender` | `user` | The address mail is sent as. |
| `insecureTls` | `false` | Accept a self-made certificate. |
| `local` | `false` | On your network under a name that does not say so. |

| Event | | |
|---|---|---|
| `mail` | `{ from, fromName?, to, subject, date?, text, attachments, images?, cut? }` | `text` up to 6000 characters (an HTML mail as a reader sees it). `attachments`: `{ file, path?, type, size }`; no `path` means over `maxMb`. `cut`: the mail was larger than what is fetched. |

Up to four pictures are shown to a model that can see; files lie in the source's folder ("Files a
source received" in [sources.md](sources.md)). What arrived while pine was down is reported later
(200 at most). A sender can be forged, so mail is always outside content; `trust: "owner"` on a
mailbox is named by `pine check`.

**Sending**: with `smtpHost` and `sendTo`, `send` takes `{"to": "...", "subject": "...", "text":
"..."}` (plain text, no files; `to` optional with one address), only to `sendTo`. After outside
content it is asked about.

| Provider | `host` | `smtpHost` | Password |
|---|---|---|---|
| Gmail, Google Workspace | `imap.gmail.com` | `smtp.gmail.com` | An app password |
| iCloud | `imap.mail.me.com` | `smtp.mail.me.com`, `smtpPort` 587 | An app-specific password |
| Fastmail | `imap.fastmail.com` | `smtp.fastmail.com` | An app password with IMAP (and SMTP) |
| GMX, WEB.DE, mailbox.org, Posteo | `imap.gmx.net`, `imap.web.de`, `imap.mailbox.org`, `posteo.de` | `mail.gmx.net`, `smtp.web.de`, `smtp.mailbox.org`, `posteo.de` | The account's; switch IMAP on at GMX and WEB.DE |
| Proton Mail | `127.0.0.1`, `port` 1143, `"starttls"`, `insecureTls` | `127.0.0.1`, `smtpPort` 1025 | The Bridge's |
| Outlook.com, Microsoft 365 | filled in | filled in (587) | None: `signIn` |

Refused at set-up: a `host` with scheme, port or path; `"none"` for a non-local server; `sendTo`
without `smtpHost` or the other way round. A refused login is shown as why the source is not
running. An unreachable server is retried up to five minutes apart.

#### A Microsoft mailbox: signing in instead of a password

```json
"outlook": {
  "type": "mail", "user": "me@outlook.com", "signIn": "microsoft",
  "clientId": "11111111-2222-3333-4444-555555555555", "tenant": "consumers",
  "from": ["@school.example"], "description": "mail from the school"
}
```

On first start pine shows a dialog (also in the status line): open
https://microsoft.com/devicelogin, enter the code, sign in. pine connects once you have, within
about fifteen minutes. It never sees your password; what Microsoft hands over is kept in pine's
database and renewed at each connection, until you sign the app out, change your password, or
the source is unused for about ninety days. Removing the source deletes it.

`clientId` is an app you register at Microsoft, once, for free:

| Step | Where |
|---|---|
| Register | entra.microsoft.com, "App registrations", "New registration"; include personal accounts for a private mailbox; no redirect address. |
| `clientId` | The app's "Overview": "Application (client) ID". |
| Codes | "Authentication", "Allow public client flows": Yes. |
| Permissions | "API permissions", "Office 365 Exchange Online", "Delegated": `IMAP.AccessAsUser.All`, and `SMTP.Send` to send. |

`tenant` must fit the registration. In an organisation, IMAP or "Authenticated SMTP" switched off
for the mailbox stands in the way, and the status says which. Refused at set-up: `signIn` other
than `"microsoft"`, without `clientId` or with a `password`; `clientId` or `tenant` without
`signIn`. Gmail has no such sign-in: use an app password.

### slack

A Slack workspace through an app in Socket Mode (it connects out; no port). Reports messages in
channels and direct messages, all or by mention, keyword or sender, and on request reactions,
edits, joins, channel changes, pins, slash commands and other apps' posts. An agent can post,
react and send files where you list.

```json
"work": {
  "type": "slack", "appToken": "${SLACK_APP_TOKEN}", "token": "${SLACK_TOKEN}",
  "channels": ["ops"], "mentions": ["me"], "keywords": ["outage"], "bots": true,
  "from": ["U0456RAINER"], "sendTo": ["C0123OPS"],
  "description": "what is written in Slack that concerns me"
}
```

To be told what is written to you, use a **user token** (`xoxp-`): it sees what you see. A **bot
token** (`xoxb-`) sees the channels the bot was invited to and messages to the bot. `"me"` is the
token's account. With `mentions` or `keywords`, a channel message counts only when one matches; a
direct message always counts. What you write yourself is never reported.

| Option | Default | |
|---|---|---|
| `appToken` | | The app-level token (`xapp-...`) with `connections:write`. Kept in `.env`. |
| `token` | | A bot (`xoxb-`) or user (`xoxp-`) token of the app. Needed for names, channels by name, `"me"`, files and sending; without it events carry ids and it only listens. Kept in `.env`; pine asks you for it. |
| `events` | `["message"]` | `"message"`, `"reaction"`, `"edit"`, `"member"`, `"channel"`, `"pin"`, `"command"`, `"other"`. |
| `channels` | every channel the app sees | By name (needs `token`) or id. |
| `mentions` | | User ids, `"me"`, `"here"`, `"channel"`, `"everyone"`, or a user group id (`S...`). |
| `keywords` | | Words; capitals do not matter. |
| `from` | | User or app ids whose messages always count, anywhere. `"me"` reports your own. |
| `dms` | `true` | Direct messages count without mention or keyword. |
| `bots` | `false` | Other apps' posts count, with `bot: true`. |
| `ignore` | | User or app ids never reported. |
| `sendTo` | none | Channel (`C...`) and person (`U...`) ids an agent may write to. Ids only. Needs `token`. |
| `perMinute` | `60` | 1 to 600; the rest are counted in `dropped`. |
| `history` | `true` | With a `token`: `read_source`, thread `context`, and catching up after a disconnect. |
| `context` | `3` | Earlier thread messages that come with an answer in a thread, 0 to 10. |
| `maxMb` | `10` | Files fetched up to this size (50 at most). |
| `keepDays` | `7` | Fetched files are deleted after this many days. |
| `apiBase` | `https://slack.com/api` | A compatible server: https, or on this machine. |

A person's id is under "Copy member ID" in their profile; a channel's is the end of its link. Pick
with `when`: `{ "payload.why": { "contains": "mention" } }`, `{"payload.from": true}`.

#### The kinds of event

| `events` | Event | Fields |
|---|---|---|
| `"message"` | `message` | `{ text, user, userName?, channel, channelName?, kind, ts, thread?, reply?, bot?, mention?, keyword?, from?, files?, images?, why, context?, late?, dropped? }` |
| `"reaction"` | `reaction` | `{ reaction, added, user, userName?, channel, channelName?, ts, author?, authorName? }` |
| `"edit"` | `edited`, `deleted` | `{ text, previous?, user, ..., ts }`; `{ channel, channelName?, ts, previous? }` |
| `"member"` | `joined`, `left` | `{ user, userName?, channel?, channelName? }` (no `channel`: joined the workspace) |
| `"channel"` | `channel` | `{ what, channel, channelName? }`: created, renamed, archived, unarchived, deleted |
| `"pin"` | `pin` | `{ added, channel, channelName?, ts?, user, userName? }` |
| `"command"` | `command` | `{ command, text, user, userName?, channel, channelName? }`; the typist reads "Passed on." |
| `"other"` | `event` | `{ type, data }`, cut at 4000 characters |
| always | `gap` | `{ text, from, to, seconds, found, looked, complete, missing? }`: see "After a time without a connection" |

In a `message`: `text` is cut to 4000 characters with `@Name` for mentions and links as `words
(address)`; `kind` is `"dm"`, `"group"` or `"channel"`; `ts` names the message, `thread` its
thread; `why` lists `"dm"`, `"mention"`, `"keyword"`, `"from"` or `"channel"`; `late` marks one
caught up after a disconnect; `files` (ten at most) have a `path` in the source's folder when
fetched; up to four `images` are shown to the model.

Order of what counts: never your own app's posts or `ignore`; other apps' only with `bots`;
`from` always; direct messages with `dms`; else only in `channels` and, with `mentions` or
`keywords`, only when one matches. `mentions` and `keywords` apply to messages and edits only.

#### Making the Slack app

At api.slack.com/apps, "Create New App", "From scratch": switch on "Socket Mode"; under "Basic
Information" make an app-level token with `connections:write` (`appToken`); under "Event
Subscriptions" add the events (as bot events, or "on behalf of users" for a user token); add
scopes under "OAuth & Permissions"; "Install to Workspace" gives `token`. Reinstall after adding
events or scopes.

| To get | Event subscription | Scope |
|---|---|---|
| public, private channels, DMs, group DMs | `message.channels`, `message.groups`, `message.im`, `message.mpim` | `channels:history`, `groups:history`, `im:history`, `mpim:history` |
| only mentions of the bot | `app_mention` | `app_mentions:read` |
| other apps' posts, edits, deletions | the `message.*` ones | as above |
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

A missing scope only drops what needs it (a name, a file, a send, part of a catch-up), except a
channel given by name, which needs `channels:read` to start.

#### Reading what was written before

`read_source` with `{"channel": "C0123ABCD"}` reads the last 20 messages (`"limit"` up to 50,
`"before": "<ts>"` further back), `{"channel": "U0123ABCD"}` a direct conversation (via `im:write`
if that person has not written since set-up), `"thread": "<ts>"` a thread. It reads only where
the source listens, marks nothing read, and marks the conversation as having read outside
content. `"history": false` turns it off.

**Sending** with `send`: `text`, `file`, and `data` `{"channel": "C0123OPS"}`, plus `"thread"` to
answer in a thread or `"ts"` and `"react": "eyes"` for an emoji. With one `sendTo` entry `channel`
may be left out; a person on `sendTo` includes their direct conversation. `@channel`, `@here`,
`@everyone` ping nobody. Slack's refusals come back in its own word with what to do
(`not_in_channel`: invite the app).

#### After a time without a connection

pine remembers when the connection last worked and, once back, asks Slack for what was written
since, where the source listens: messages come with `late: true`, oldest first. After a minute or
more a `gap` event comes first, with a sentence in `text`. `complete: false` means not everything
is known, and `missing` says why: scopes to read or list conversations (add them and reinstall),
no `token` or `history: false`, more than `perMinute` or 200 messages in a conversation (read the
rest with `read_source`), more than 200 conversations, and always reactions and edits, which
Slack cannot give afterwards. An agent passes that on instead of "nothing new". A gap under a
minute is made up quietly without a `gap`.

#### Limits, and what is refused

One source is one app in one workspace. Interactivity (buttons, forms) is not reported. Slack
never speaks for you (no `trust: "owner"`). Refused at set-up: an `appToken` not `xapp-`, a
`token` not `xoxb-` or `xoxp-` (no rotating `xoxe`), names where ids belong, unknown `events`,
`perMinute` outside 1 to 600, `maxMb` over 50. Refused at start, shown in the status: `"me"` or a
channel name without `token`, an unknown channel name (`there is no channel named "opps" that the
app can see`), a token Slack refuses (`invalid_auth`).

### matrix

A Matrix account: messages in the rooms it joined, all or by mention or keyword. Long polling, no
port.

```json
"family": {
  "type": "matrix", "homeserver": "https://matrix.org", "token": "${MATRIX_TOKEN}",
  "rooms": ["!AbCdEfGh:matrix.org"], "mentions": ["@paul:matrix.org"],
  "description": "the family room"
}
```

| Option | Default | |
|---|---|---|
| `homeserver` | | `https://...` (`http://` only on your network). |
| `token` | | An access token (Element: Settings, Help & About, Advanced). Kept in `.env`. |
| `rooms` | every joined room | Room ids (`!...`), not aliases. |
| `mentions` | | User ids (`@name:server`). |
| `keywords` | | Words; capitals do not matter. |
| `ignore` | | User ids never reported. |
| `sendTo` | none | Room ids an agent may write to: `{"room": "!...", "text": "..."}`. |
| `local` | `false` | On your network under a name that does not say so. |

Event `message`: `{ text, user, room, roomName?, kind, id, mention?, keyword?, dropped? }`, `kind`
`"dm"` or `"room"`. 60 a minute at most. What was written while pine was down is reported later
(50 a room). The token is the key to the account: take it from a private-window session you close
without logging out, or use an account made for pine. **Encrypted rooms cannot be read**: their
messages are only counted in the status. A refused token shows as `M_UNKNOWN_TOKEN`.

### discord

A Discord bot: messages in its servers and direct messages to it, all or by mention or keyword.

```json
"community": {
  "type": "discord", "token": "${DISCORD_BOT_TOKEN}",
  "channels": ["1234567890123456789"], "keywords": ["release"],
  "description": "announcements on our Discord server"
}
```

| Option | Default | |
|---|---|---|
| `token` | | The bot's token. Kept in `.env`. |
| `channels` | every readable channel | Channel ids. |
| `guilds` | every server | Server ids. |
| `mentions` | `false` | `true`: in servers, only messages mentioning the bot. |
| `keywords` | | In servers; with `mentions`, either is enough. |
| `dms` | `true` | Direct messages count. |
| `bots` | `false` | Other bots' and webhooks' messages count. |
| `sendTo` | none | Channel ids an agent may write to: `{"channel": "...", "text": "..."}`. |
| `apiBase` | `https://discord.com/api/v10` | A compatible server: https, or on this machine. |

Ids are long numbers ("Developer Mode", then "Copy ID"); names are refused. Event `message`: `{
text, user, userName, channel, channelName?, guild?, guildName?, kind, id, mention?, keyword?,
files?, dropped? }`; `files` lists attachments without contents. 60 a minute at most.

**Making the bot** at discord.com/developers/applications: "New Application", "Bot", "Reset
Token" (`token`); switch on **Message Content Intent** under "Privileged Gateway Intents" (without
it Discord closes the connection and the status says so); "OAuth2", "URL Generator", `bot` with
"View Channels", "Read Message History" (and "Send Messages"), then open the address to invite it.
Long texts go out as several messages and ping nobody.

### zulip

A Zulip organization: channel messages and direct messages to the bot, all or by mention or
keyword.

```json
"zulip": {
  "type": "zulip", "site": "https://example.zulipchat.com",
  "email": "${ZULIP_EMAIL}", "key": "${ZULIP_API_KEY}",
  "streams": ["releases"], "keywords": ["release"],
  "description": "the releases channel on Zulip"
}
```

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
| `local` | `false` | On your network under a name that does not say so. |

Event `message`: `{ text, user, name, stream, topic, kind, id, mention?, keyword?, dropped? }`,
`kind` `"dm"` or `"stream"`. 60 a minute at most. A dropped connection resumes; if Zulip let the
queue expire, what was written meanwhile is not reported.

### smtp

A small mail server for devices whose only way to report is e-mail; each mail becomes an event.

```json
"nas": { "type": "smtp", "port": 2525, "user": "nas", "password": "${NAS_MAIL_PASSWORD}", "to": ["alerts@pine.home"], "description": "alerts the NAS sends" }
```

| Option | Default | |
|---|---|---|
| `port` | | `2525` (below 1024 many systems want root). |
| `user` | `"device"` | Filled in when an agent sets it up; in a file you write, give it with a password. |
| `password` | made by pine | 8 characters or more; made when an agent sets it up without one, in `.env` as `PINE_SOURCE_<NAME>_<AGENT>_PASSWORD`. Left out with `allow`, no login is asked. |
| `allow` | everyone who logs in | Client address prefixes: `["192.168.1.40", "192.168.2."]`. |
| `host` | `"0.0.0.0"` | The address to listen on. |
| `to` | any | Recipients accepted; others are refused. They need not exist. |
| `maxMb` | `10` | Largest message (50 at most). |
| `keepDays` | `7` | Attachments are deleted after this many days. |

Event `mail`: `{ from, fromName?, to, subject, text, attachments, images?, client }`; `client` is
the address it really came from. In the device: this computer as SMTP server, the port, **no
encryption**, the user and password. A printer that cannot log in gets `allow` and no password.
Linux servers relay root's mail here with `msmtp` (`tls off`) or a Postfix `relayhost`. It relays
nothing and writes attachments under its own names into its folder. One of `password` and `allow`
is required. Refused: over `maxMb`, a recipient not on `to`, a client not on `allow`, three wrong
passwords, over 20 connections, a minute of silence, over 30 messages a minute ("try again
later").

### syslog

Takes the log lines devices send to a "remote log server" and reports those that matter.

```json
"router": { "type": "syslog", "port": 5514, "allow": ["192.168.1.1"], "match": "link down|PPP|login failed", "severity": "notice", "description": "the router's log" }
```

| Option | Default | |
|---|---|---|
| `port` | | `5514` (514 often needs root). |
| `host` | `"0.0.0.0"` | The address to listen on. |
| `protocol` | `"udp"` | `"tcp"` or `"both"`. |
| `allow` | anyone | Sender address prefixes. Syslog has no login: without `allow` the dialog warns. |
| `match` | | Only lines it finds something in. |
| `severity` | `"warning"` | Least severe level reported: `emerg` ... `debug`. `"debug"` reports every matching line. |
| `perMinute` | `20` | 1 to 600; the rest are counted and dropped. |

Event `line`: `{ host, app?, severity, facility, message, from, time?, dropped? }`; `from` is the
real sender, `message` up to 2000 characters. RFC 3164 and RFC 5424 are read; other lines come
with severity `notice`. TCP: 20 connections, 8 KB lines. Linux: rsyslog `*.warn @<address>:5514`
(`@@` for TCP); MikroTik: `/system logging action set remote remote=<address> remote-port=5514`.
Set a `throttle` ("5m") on the subscription so a burst wakes the agent once.

### onvif

A network camera's own detections over ONVIF (Profile S and T): motion, a person, tampering, a
line crossed, a doorbell button.

```json
"gate": { "type": "onvif", "host": "192.168.1.40", "port": 8000, "user": "pine", "password": "${GATE_CAMERA_PASSWORD}", "topics": ["Motion", "People", "Visitor"], "description": "what the camera at the gate detects" }
```

| Option | Default | |
|---|---|---|
| `host` | | The camera's address, without `http://` or port. |
| `user`, `password` | | A camera account with the least rights that read events. Password in `.env`. |
| `port` | `80` | Reolink 8000, Tapo 2020, Hikvision, Dahua and Axis 80, others 8080 or 8899. |
| `path` | `"/onvif/device_service"` | Where the ONVIF service is. |
| `topics` | everything | Words a topic must contain (up to 20), capitals ignored. |
| `perMinute` | `20` | 1 to 120. |
| `local` | `false` | A name on your network that does not say so. |

Event `event`: `{ topic, source, data, time?, active?, dropped? }`. `topic` as the camera names it
(`RuleEngine/CellMotionDetector/Motion`), `source` which camera of a recorder, `data` the values
(`{ "IsMotion": true }`), `active` the one yes-or-no value when there is one (subscribe with
`{"payload.active": true}` for starts only). Topics: `Motion`, `People`/`Person`/`Vehicle`/`DogCat`,
`Tamper`, `LineDetector/Crossed`, `FieldDetector/ObjectsInside`, `Visitor`, `DigitalInput`; they
differ by make, so start without `topics` and watch `pine events --topic 'source/gate/#'`.

Hikvision and Axis need an ONVIF user added in their ONVIF settings; Tapo's camera account is the
user. pine keeps a pull point open, so the camera needs no way to reach pine. The first state is
the starting point; an unchanged state is not reported again. Of addresses the camera names only
the path is used, never another host. The password travels as an ONVIF digest. It changes nothing
on the camera and brings no picture (use `ftp` for that). Not supported: digest-only HTTP
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
| `local` | `false` | A name on your network that does not say so. |

| Key of a `read` entry | Default | |
|---|---|---|
| `name` | | A short word: the event carries it. |
| `address` | | Register number from 0. A list counting from 40001 or 30001 means minus that; "base 1" minus 1. |
| `kind` | `"holding"` | `"input"`, `"coil"`, `"discrete"` (the last two are `true`/`false`). |
| `type` | `"u16"` | `"i16"`, `"u32"`, `"i32"`, `"f32"` (the last three take two registers). |
| `scale` | `1` | Multiplier: `0.1` for tenths. |
| `step` | | Report only after moving this far since the last report. |
| `words` | `"be"` | For 32 bits: `"le"` if the low half comes first. |

Event `changed`: `{ name, value, previous }`; filter with `{"payload.name": "soc", "payload.value":
{"lt": 20}}`. The register list comes from the maker ("<model> Modbus register map"; SunSpec for
most inverters). It sends only read functions (1 to 4) over one short connection per look. A
refused register or no answer within five seconds is a failed look.

### serial

The lines a device prints on a serial port (USB or cable). macOS and Linux only.

```json
"greenhouse": { "type": "serial", "port": "/dev/cu.usbmodem1101", "baud": 115200, "match": "temp=([0-9.]+)", "changed": true, "description": "the temperature in the greenhouse" }
```

| Option | Default | |
|---|---|---|
| `port` | | `/dev/cu.*` on a Mac (`ls /dev/cu.*`), `/dev/ttyUSB0`, `/dev/ttyACM0` or `/dev/serial/by-id/...` on Linux. |
| `baud` | `9600` | 9600, 19200, 38400, 57600, 115200 and the other usual ones. |
| `match` | | Only lines it finds; its first group is `value`. |
| `changed` | `false` | Only when the line or value differs from the last. |
| `perMinute` | `30` | 1 to 600. |

Event `line`: `{ port, line, value?, previous?, dropped? }`; without `match`, `value` is the JSON or
number a line is. A P1 smart meter: 115200 baud, `"match": "1-0:1\\.7\\.0\\(([0-9.]+)"` (kW now). A
GPS: 9600 baud, `"^\\$G.GGA,(.*)"`. Nothing is written to the port, so a device that must be asked
stays silent; 8N1. Terminals and anything not a serial device under `/dev` are refused. An
unplugged device is waited for. On Linux pine's user needs the port (group `dialout`). Lines are cut
at 1000 characters.

### presence

Reports devices joining and leaving your own network.

```json
"home": { "type": "presence", "hosts": { "phone": "192.168.1.23", "tv": "192.168.1.30" }, "services": ["_ipp._tcp"], "away": "10m", "description": "who is at home: my phone, the TV, and any printer" }
```

| Option | Default | |
|---|---|---|
| `hosts` | | Name and address (a private IP or `.local` name), up to 32. |
| `services` | | Bonjour (mDNS) service types, up to 16; each device is reported by its name. |
| `every` | `"30s"` | At least `"10s"`. |
| `away` | `"10m"` | Silence before a device counts as gone; not shorter than `every`. |

| Event | | |
|---|---|---|
| `arrived` | `{ name, address?, service?, awayFor? }` | `awayFor` in seconds: `{"payload.awayFor": {"gt": 3600}}` for a real absence. |
| `left` | `{ name, address?, service?, lastSeen }` | Silent for `away`. |

A host is there when it answers a ping or a connection. Give a phone a fixed address (a DHCP
reservation) and switch off "Private Wi-Fi Address" on an iPhone; lengthen `away` if it flickers.
Services: `_ipp._tcp` (printers), `_airplay._tcp`, `_googlecast._tcp`, `_sonos._tcp`,
`_spotify-connect._tcp`, `_hap._tcp` (HomeKit), `_smb._tcp`. A guest network or client isolation
hides everything; on a Mac the system may ask once for local network access. Without network on
this computer the look fails and nobody "leaves". Linux needs Avahi with `nss-mdns` for `.local`
names.

### system

This computer: sleep, lock, power, network, disks, and named apps, on macOS, Linux and Windows.

```json
"mac": { "type": "system", "watch": ["lock", "sleep", "power"], "apps": ["Xcode"], "battery": 15, "description": "what this Mac does: lock, sleep, power, Xcode" }
```

| Option | Default | |
|---|---|---|
| `watch` | all five | `"sleep"`, `"lock"`, `"power"`, `"network"`, `"volumes"`. |
| `apps` | none | Up to 30. Mac: name or bundle id (`"us.zoom.xos"`); Windows: program name, with or without `.exe`. Not on Linux. |
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

Needs `gdbus` (`libglib2.0-bin` or `glib2`): logind for sleep and the lock (as your desktop
reports it), UPower for power, NetworkManager or systemd-networkd for the network, and mounts
under `/media`, `/run/media`, `/mnt` plus network shares. What is missing is named in the status
(`cannot hear power: UPower is not running`).

#### system on Windows

Built with the C# compiler Windows carries. `ups` counts as mains. Apps are looked at every two
seconds: started with the first process of a name, quit with the last. A disk is named by its
label or letter. pine in WSL hears little (no lock, no battery).

## What there is no type for

| Wanted | Instead |
|---|---|
| A calendar's "ten minutes before" | A schedule ([events.md](events.md), "Schedules"). |
| Bluetooth sensors | A bridge to MQTT (Theengs Gateway, OpenMQTTGateway) and `mqtt`. |
| iMessage, WhatsApp | No type. Signal through signal-cli and `stream`. |
| KNX, Zigbee, Z-Wave, HomeKit, Matter | The hub (Home Assistant, zigbee2mqtt), by `mqtt` or `stream`. |
| A command line client | `command` with `follow`. |
| Something of your own | A source type of your own ([sources.md](sources.md), "A source type of your own"); the main agent can write one. |
