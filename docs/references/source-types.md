# Source types: what each one watches, what it takes, what it is for

A source reports what happens somewhere else, and an agent subscribed to it is woken with each
report. This file is the catalogue: every type, its options, its events and their fields, the
services it reaches, and an entry to copy. What a source and a subscription are, the keys every
source has, the filter `when`, secrets, trust, and what holds for every type (the first look is
the starting point, texts and rates are capped, an address is the one you confirmed, a source
sends only where you listed) is in [sources.md](sources.md), "What all types have in common".

Say what you want watched ("tell me on Telegram when pmndre/pine has a new release"): the agent
picks the type, pine shows you what the source will do, and you confirm. Or write the entry
yourself under `sources` in `pine.json` or an agent's `agent.json`, with the type's options next
to `type`, and subscribe an agent to it.

## Which type for what

A type either **is told** (it listens on a port or holds a connection, and an event arrives the
moment something happens) or **looks** (it asks again and again and reports what changed).

| Type | Told or looks | Reports | For |
|---|---|---|---|
| `folder` | told | a new or changed file | scans, downloads, exports, a project folder |
| `webhook` | told | a request another service sends to pine | GitHub, Home Assistant, a shortcut on a phone, anything that can call a web address |
| `stream` | told | each message a service pushes over Server-Sent Events or a WebSocket | ntfy, Gotify, Home Assistant, Mastodon, Bluesky, exchange tickers, webhook relays, signal-cli |
| `mqtt` | told | messages on the topics of a broker | Zigbee and Z-Wave hubs, sensors, plugs, printers |
| `telegram` | told | what you write to your bot | talking to an agent from anywhere |
| `mail` | told | a new mail in a mailbox | invoices, services that only write mail, a shared inbox |
| `slack` | told | messages (by channel, mention, keyword or sender, also other apps'), reactions, edits, joins, channels, pins, slash commands | being told when somebody needs you or an alert bot posts; answering in a thread, with a reaction or a file |
| `matrix` | told | messages in the rooms of a Matrix account | Element rooms, bridges to other networks |
| `discord` | told | messages in the channels a bot can see | a server's channels, direct messages to the bot |
| `zulip` | told | messages in a Zulip organization's channels and direct messages | a team's channels, direct messages to the bot |
| `ftp` | told | a file a device uploads | cameras, doorbells, scanners |
| `smtp` | told | a mail a device sends | NAS boxes, printers, UPS units, routers, cron jobs |
| `syslog` | told | the log lines of a device | routers, firewalls, switches, access points, NAS boxes |
| `onvif` | told | what a network camera detects | motion, a person, a vehicle, tampering, a doorbell button |
| `serial` | told | lines from a serial port | an Arduino, a smart meter's P1 port, a GPS receiver |
| `system` | told | what this computer does | sleep, wake, lock, power, network, disks, apps |
| `command` with `follow` | told | each line a command prints while it runs | logs, `docker events`, `kubectl -w`, any broker or database with a client |
| `http` | looks | a change of a page or of one value in it | a price, a version, a status, a device's state page, an API |
| `feed` | looks | new entries of an RSS, Atom or JSON feed | releases, blogs, videos, podcasts, papers, status pages |
| `calendar` | looks | entries of a calendar that are new, moved or gone | appointments, school and club calendars, waste collection |
| `command` | looks | a change in what a command prints or how it ends | disk space, a build, a branch, whether a machine answers |
| `modbus` | looks | a change of a value in a Modbus device | solar inverters, heat pumps, wall boxes, energy meters |
| `presence` | looks | a device joining or leaving your network | a phone coming home, a TV switched on, a printer online |

What should happen at a time is a schedule, not a source ([events.md](events.md),
"Schedules"). A `calendar` source reports that an entry was added or moved; "ten minutes before
it starts" is a schedule the agent sets when it is told of the entry.

### Looking again and again

`http`, `command`, `feed`, `calendar`, `modbus` and `presence` go and look:

- **The first look is the starting point.** Setting a source up reports nothing; only what is
  different at a later look does.
- **A look that finds nothing new costs nothing**: no event, nothing stored, no model woken. An
  agent's turn is spent only when there is something to act on.
- **A failed look is not an event.** The pause before the next look doubles with each failed
  look in a row, up to 15 minutes (or the source's own interval, if longer), and is back to
  normal with the first look that works.
- Two looks of one source never run at once, and each comes a little earlier or later than its
  interval, so sources with the same interval do not all fire together.

Where sources are listed (`pine sources`, `/sources`, the agent's `sources` tool) the line says
`last looked 14:02:11` or `failing since 14:02:11 (4 looks): it answered 503`, then what it
found. What it found is repeated only when it is a number or one word; anything longer is
counted, because agents read that line without the outside-content mark.

## Which type for which service

| Service or device | Type | How |
|---|---|---|
| GitHub: releases, commits, tags of a repository | `feed` | `https://github.com/<owner>/<repo>/releases.atom` (or `commits.atom`, `tags.atom`). No account needed for a public repository. |
| GitHub: pushes, issues, pull requests as they happen | `webhook` | A webhook of the repository, with the secret. On a machine without a public address: a relay (smee.io) and a `stream` source. |
| YouTube channel, podcast, blog, arXiv, Reddit, Hacker News | `feed` | The feed's address. |
| A shop's price, a version number, a status page without a feed | `http` | `match`, `select` or `path` for the one value that counts. |
| A page that only shows its content after its scripts ran | `http` | `render`: pine's browser opens the page at every look. |
| An API that is asked with POST (GraphQL) | `http` | `method: "POST"` and `body`. |
| Home Assistant | `stream`, `mqtt` or `webhook` | Its WebSocket API (`stream` with `hello`), its MQTT broker, or an automation that calls pine's webhook. |
| Zigbee and Z-Wave devices | `mqtt` | Through zigbee2mqtt or zwave-js-ui. |
| ntfy, Gotify | `stream` | The topic's `/sse` address; Gotify's `/stream`. |
| Signal | `stream` | signal-cli's HTTP daemon on this machine, which sends events over SSE. |
| Mastodon, Bluesky, Nostr | `stream` | The streaming API, Jetstream, a relay. A Mastodon account's posts alone: `feed` (`https://<server>/@<name>.rss`). |
| Slack | `slack` | An app in Socket Mode. With `bots`, also what GitHub, PagerDuty or an alert bot post into Slack. |
| Discord | `discord` | A bot. |
| Matrix (Element) | `matrix` | An access token of an account. |
| Telegram | `telegram` | A bot, paired with your account. |
| Zulip | `zulip` | A bot's email address and API key from Settings, Bots. |
| Gmail, iCloud, Fastmail, your own mail server | `mail` | IMAP with an app password. |
| Outlook.com, Hotmail, Microsoft 365 | `mail` | `"signIn": "microsoft"`: you sign in at Microsoft in your browser, pine holds no password. |
| Google Calendar, iCloud, Outlook, Nextcloud | `calendar` | The calendar's iCal address. |
| Synology, QNAP, TrueNAS, Proxmox, UniFi, a UPS, a printer | `smtp` | The device's "send notifications by e-mail" setting, pointed at pine. |
| A router, firewall, switch or NAS that can send its log | `syslog` | The device's "remote log server" setting, pointed at pine. |
| A camera or doorbell that uploads pictures | `ftp` | The camera's "upload to FTP server" setting. |
| A camera's motion, person and tamper detection | `onvif` | The camera's ONVIF user. |
| A solar inverter, heat pump, wall box, energy meter | `modbus` | The device's Modbus TCP port and its register list. |
| A 3D printer | `mqtt` | Bambu printers are their own broker; OctoPrint and Klipper publish through an MQTT plug-in. |
| An Arduino, an ESP32 on USB, a smart meter's P1 cable, a GPS | `serial` | The device under `/dev`. |
| "Is my phone home", a TV switched on | `presence` | The device's fixed address on your network. |
| This computer: lock, sleep, battery, network, disks | `system` | Nothing to set up. |
| A log file, Docker, Kubernetes, journald | `command` with `follow` | `tail -F`, `docker events`, `kubectl get -w`, `journalctl -f`. |
| PostgreSQL, Redis, NATS, Kafka, RabbitMQ | `command` with `follow` | The system's command line client, printing one line per message. |
| Anything with a command that prints its state | `command` | Run again and again; a change is the event. |

## The types

### folder

A folder: reports every new or changed file once it has stopped growing.

```json
"scans": { "type": "folder", "dir": "~/Scans", "mask": "*.pdf" }
```

| Option | Default | |
|---|---|---|
| `dir` | | The folder. `~` and paths relative to the configuration file work. Not inside pine's home (the agent's own workspace aside). |
| `mask` | | Only files whose name matches, as in a shell: `*.pdf`, `*.{png,jpg}`, `report-??.csv`. Several are separated by commas. Capitals do not matter. |
| `pattern` | | Only files whose full path matches this regular expression (`/src/.*\\.ts$`). Capitals do not matter. |
| `ignore` | version control, dependencies, editor leftovers | Never files whose path matches this regular expression. The default skips `.git`, `node_modules`, `.DS_Store`, build folders (`.build`, `DerivedData`, `__pycache__`, `.venv`), and files ending in `~`, `.swp`, `.tmp`, `.part`, `.crdownload`. |
| `settle` | `"1.5s"` | How long a file must stay unchanged before it counts as complete. |
| `recursive` | `true` | Also folders inside it. |

Event `added`: `{ path, file, size, images? }`. A jpg, png, webp or gif under 10 MB is shown to
the agent if its model can look at images. A folder outside the agent's workspace can be read by
the agent along with the source.

An empty file is waited for longer and then reported with `size` 0 (a marker); written into
later, it is reported again. When the folder cannot be watched (removed, rights taken away, the
system's limit of watched folders reached), the status says so with the system's error code and
it tries again, less often each time, up to once a minute.

### mqtt

An MQTT broker: reports the messages on the topics you name.

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
| `topics` | | One MQTT topic filter or a list. |
| `publish` | none | Topics an agent may send to, to act on a device: `["zigbee2mqtt/+/set"]`. Without it the source only listens. The agent sends `{"topic": "lamp/set", "message": "on"}`; never to a filter (`+`, `#`). See "Sending through a source" in [sources.md](sources.md). |
| `username`, `password`, `clientId` | | As the broker wants them. |
| `minInterval` | | Drop messages that follow the last one on the same topic sooner than this. For devices that report every second. |
| `insecureTls` | `false` | Accept a certificate that cannot be verified, as devices with self-made ones need. |

Event `message`: `{ topic, value }`, where `value` is the parsed JSON, or the text.

The example is a Bambu printer in LAN mode: its own broker on port 8883, user `bblp`, the
access code from the printer's screen as password.

### webhook

A web address other services can call: `POST http://<pine's control address>/hook/<name>`.

```json
"github": { "type": "webhook", "secret": "${GITHUB_HOOK_SECRET}", "description": "pushes and issues of my repositories" }
```

| Option | |
|---|---|
| `secret` | The caller proves itself with it: `Authorization: Bearer <secret>`, or an HMAC SHA-256 signature of the body in `X-Hub-Signature-256` or `X-Signature`, as GitHub sends it. An agent that leaves it out gets one made by pine, kept in `.env`. |
| `open` | `true` instead of a secret: accept anyone who can reach the port. Only for a port nobody else can reach. |

Event `received`: `{ body, headers }`. `body` is the parsed JSON, or `{ text }`. Of the headers
only those that say what kind of request it is are kept (`content-type`, `user-agent`,
`x-github-event` and the like), never the secret.

The address carries the source's name as in event topics: `/hook/<name>` for a source in
`pine.json`, `/hook/<name>@<agent>` for one in an agent's `agent.json` (where a source an agent
sets up goes, unless it is for all agents). It needs the control API (`http` in `pine.json`),
which listens on `127.0.0.1` by default: a service on the internet reaches it only through a
tunnel or reverse proxy you set up. While nobody is subscribed the address answers "not found".

### ftp

An FTP drop: a small FTP server that accepts uploads and nothing else, for cameras, doorbells
and scanners whose way of sending a file is "upload to FTP server".

```json
"door": { "type": "ftp", "port": 2121, "user": "cam", "password": "${CAMERA_FTP_PASSWORD}", "allow": ["192.168.1.40"], "description": "pictures from the front door camera when it sees motion" }
```

| Option | Default | |
|---|---|---|
| `port` | | The port to listen on, entered in the device. |
| `user` | `"device"` | The user name the device logs in with. The default is filled in when an agent sets the source up; in a file you write, give it. |
| `password` | made by pine | 8 characters or more. When an agent sets it up without one, pine makes one and keeps it in `.env`. |
| `host` | `"0.0.0.0"` | The address to listen on. Devices on your network have to reach it. |
| `allow` | everyone | Only these clients: a full address (`"192.168.1.40"`), or a prefix ending in a dot (`"192.168.2."`). |
| `pasvPorts` | any | `[from, to]`: the ports for data connections, if a firewall has to know them. |
| `maxFileMb` | `50` | Largest file accepted. |
| `keepDays` | `7` | Received files are deleted after this many days. |

Event `upload`: `{ file, path, size, from, images? }`. `file` is the name the device gave it,
`path` where it lies now (`data/sources/<name>/files/`, or `<name>@<agent>` for an agent's own
source). A picture is shown to the agent with the event. A video or any other file is not: the
agent reads it from `path` ("Files a source received" in [sources.md](sources.md)).

It speaks plain FTP, as these devices do, so the password crosses your network unencrypted. It
only receives: nothing can be listed, read, changed or deleted, and every file lands under a
name of pine's choosing in the source's folder. At most 20 connections at a time. Set the device
to passive mode.

### telegram

A Telegram bot: you write to it from wherever you are, and the agent that subscribed answers
there. It is how you reach your agents when you are away, and how they reach you.

> Watch Telegram. You are my assistant there, and what you want to tell me while I am away
> goes to that chat.

The agent calls `add_source`. The dialog you confirm has a field for the bot's token, which does
not pass through the agent or its model ("Secrets" in [sources.md](sources.md)). Then you pair
the bot with your account:

1. Open the bot in Telegram and write anything to it.
2. The bot answers that account with a six-digit code.
3. pine shows a question on your computer that names the account and has a field for the code.
   Type the code from your phone and press enter.

From then on that account is the only one the bot listens to. The code shows that the person at
pine's keyboard holds that Telegram account: a stranger who finds the bot can make the question
appear but does not see your screen, and a key pressed by accident cannot say yes. An account
you deny is not put to you again, and only one question is open at a time. Before pairing, an
unknown account gets the code message (and a line if the typed code was wrong) and nothing
else; after it, unknown accounts get no answer and cause no question. To pair another account,
remove the source and set it up again.

```json
"telegram": { "type": "telegram", "token": "${PINE_SOURCE_TELEGRAM_MAIN_TOKEN}", "trust": "owner", "description": "my Telegram" }
```

| Option | Default | |
|---|---|---|
| `token` | | The bot's token: write `/newbot` to @BotFather in Telegram and it answers with one. Kept in `.env`. |
| `allow` | pairing | Telegram user ids that may talk to the bot, if you know yours; then nothing is paired. With several, what the agent sends unasked and approval requests go to the first. |
| `approvals` | `true` | Approval requests also go to that chat, with buttons: Allow, Deny and, where a yes can be kept for the conversation, Always. `/allow` and `/deny` work too (with the request's id when several are open). A bot that is one agent's own carries that agent's requests and questions only; a bot for all agents carries every agent's. A request that needs a secret typed is never sent there. |
| `apiBase` | Telegram's | The address of a Bot API server of your own: https, or on this machine. |

A question an agent asks with its `question` tool arrives there too when it offers answers: one
button per answer and one for "No answer". With several answers allowed, the answers are
numbered and your next message is the answer ("1,3", or your own words). An answer in your own
words to a one-answer question, and a question without answers to pick, you type in the terminal
UI or the Pine app.

Event `message`: `{ text, name, username, chatId, messageId, images? }`. A photo you send (up to
10 MB) is shown to the model. The bot listens only in its private chat with you: what is written
in a group it was added to reaches no agent.

- **It is a conversation.** Your message reaches the agent as your message, in the conversation
  that subscribed; the answer goes back to the chat and is also in that conversation.
- **It speaks for you.** Telegram vouches for the account and you proved it is yours, so what
  it writes counts as your own words: full tools, no outside-content mark. That is why pairing
  takes a code and the set-up is always put to you.
- **It can send.** The agent writes to you on its own with `send`, with a picture, a video or a
  sound file (50 MB at most), without a question to you ("Sending through a source" in
  [sources.md](sources.md)).
- **Messages are not held back.** The ten-second `throttle` that subscriptions have by default
  does not apply unless the subscription sets one itself.
- **Formatting.** What an agent sends is Markdown, shown with Telegram's formatting: bold,
  italic, strikethrough, code, quotes; a heading becomes a bold line, a table monospace text. A
  link shows its address beside its text. HTML an agent writes is shown as text. Approval
  requests and pairing messages are plain text.

Where sources are listed, the status says "listens to nobody yet" or the paired account with its
name and Telegram id (a bot never learns a phone number). Messages are fetched by long polling,
so nothing listens on a port and it works behind any router. Telegram gives a bot's messages to
one reader only: when another program reads them (another pine with this token, a script), this
source gets nothing and its status says so. Stop the other one, or make a new token with
BotFather (`/revoke`) and set the source up again.

### http

A web address that is looked at again and again, for what cannot call you: a price, a version,
a status page, a device on your network that has a state page.

> Watch https://shop.example/fridge-3000 and tell me when the price drops below 500.

```json
"price": { "type": "http", "url": "https://shop.example/fridge-3000", "match": "Price: ([0-9.,]+)", "every": "30m", "description": "the price of the fridge" }
```

| Option | Default | |
|---|---|---|
| `url` | | `https://...` (`http://` for a device on the local network). |
| `every` | `"5m"` | How often to look. At least `"30s"` when an agent sets it up, `"2m"` with `render`. |
| `path` | | For an answer in JSON: watch only this field, `"data.price"` or `"items.0.state"`. |
| `values` | | For an answer in JSON: several fields, each under a name of yours: `{ "price": "data.price", "stock": "data.stock.count" }`. Twenty at most. |
| `match` | | Watch only what this regular expression finds (its first group, if it has one): first in the text a reader sees, then in the page's source. |
| `select` | | For a page: the text of the first element this CSS selector matches, `".product .price"`. See "One element of a page". |
| `attr` | | With `select`: this attribute of the element instead of its text: `"content"`, `"data-price"`. |
| `render` | `false` | `true` for a page a script fills in: every look opens it in pine's browser. See "A page that a script fills in". |
| `method` | `"GET"` | `"POST"` for an address asked by sending something. Nothing else: a source only looks. |
| `body` | | With `POST`: what to send, as text, at most 20000 characters. Sent as JSON when it is JSON. Not for secrets. |
| `headers` | | Headers to send, `{ "accept": "application/json" }`. Not for secrets: `authorization` and `cookie` are refused here. |
| `token` | | An access token or key, sent as `Authorization: Bearer <token>`, only to that host. Kept in `.env`. |
| `tokenHeader` | | Send the token as this header instead, as it is: `"x-api-key"`, `"cookie"`. |
| `local` | `false` | The address is on your own network under a name that does not say so (`nas.home`, `ha.lan`). Not needed for an IP address, `localhost` or a `.local` name. |

`path`, `values`, `match` and `select` are four ways to say what counts; a source takes one.
Without any, the whole answer counts: for a page, its text as a reader sees it (scripts, styles
and markup left out). A page that shows the time changes at every look; give it a `match`.

| Event | | |
|---|---|---|
| `changed` | `{ url, value, previous, number?, previousNumber? }` | With `path`, `match` or `select`: the value now and before. |
| `changed` | `{ url, values, previous, changed }` | With `values`: all fields now and before, and the names of those that differ. |
| `changed` | `{ url, added, removed, more? }` | Without: the lines that are new and gone, up to 30 of each. |
| `down` | `{ url, error, looks }` | After three failed looks in a row, once. |
| `up` | `{ url }` | When it answers again. |

#### One element of a page

`select` finds a value by where it stands in the page, which holds better than `match` when the
words around a price change with the language or the season:

```json
"fridge": { "type": "http", "url": "https://shop.example/fridge-3000", "select": ".product-detail .price", "every": "30m", "description": "the price of the fridge" }
```

Without `render` a selector takes tags (`span`), ids (`#total`), classes (`.price`) and
attributes (`[itemprop]`, `[itemprop=price]`, also `~=`, `^=`, `$=`, `*=`), put together
(`span.price`) and nested with a space (inside) or `>` (directly inside); a comma separates
alternatives. Nothing with a colon (`:first-child`, `:not(...)`) and no `+` or `~`: such a
selector is refused with what it takes instead. The first match counts. Many shops also state
the price for machines, which changes less often than the layout:

```json
"fridge": { "type": "http", "url": "https://shop.example/fridge-3000", "select": "meta[property=product:price:amount]", "attr": "content" }
```

The page is read as the server sends it. What a script fills in later is not there: set
`render`, or watch the address the script asks.

#### A page that a script fills in

Many pages arrive almost empty and a script then fetches the price and writes it in; a plain
look finds only the placeholder. With `render` the look is made by a browser:

```json
"fridge": { "type": "http", "url": "https://shop.example/fridge-3000", "render": true, "select": ".product-detail .price", "every": "30m", "description": "the price of the fridge" }
```

At every look pine starts its browser (the one the browser tools use, fetched by `pine init`
and `pine browser-install`) without a window and with an empty profile, opens the address, waits
until the page has loaded and stopped asking for things (five seconds at most), takes what a
reader sees, and closes the browser.

| With | What counts |
|---|---|
| `select` | The text of the first element the selector matches. Any CSS works: `li:nth-child(2) .price`, `.offer:not(.sold-out)`, `h1 + p`. No match: the value is `null`. |
| `select` and `attr` | That attribute of the element. |
| `match` | What the regular expression finds in the text a reader sees. The source is not looked at. |
| neither | The whole text of the page, line by line. |

The events are the same. A rendered look takes a second or two and a few hundred megabytes while
it lasts, so:

- `every` is at least `"2m"` when an agent sets it up.
- Two browsers run at a time, for all sources together; a look that finds them busy waits.
- A look may take 45 seconds; then it is ended and counts as failed.
- The page is loaded in full each time (no "nothing new" answer).

Where the page's script gets its value from an address that answers JSON (your browser's
developer tools show it in the network tab), watching that address with `path` is faster, can be
asked every 30 seconds, can take a `token`, and survives a new layout. Use `render` when there is
no such address or what you want is what the page shows.

Refused with `render`: `path` and `values` (they read JSON), `method`, `body`, `headers`, `token`
and `tokenHeader` (the browser would send them to every address the page loads from, so a page
behind a login cannot be watched this way), and `local: true`.

**What the page can reach.** Its scripts run in that browser, and the dialog says so. Every
connection goes through the browser tools' guard ([security.md](security.md)): the internet is
reachable, your network and this computer are not. One exception is the page itself: an address
that says by itself that it is local (`localhost`, a `.local` name, a private IP address) is
opened, and the browser reaches exactly that host and port. A name that only turns out local
when looked up (`nas.home`) is not opened; give the device's IP address. pine's control port is
never opened. A page that sends the browser to another host is a failed look. The browser keeps
nothing between looks (no cookies, no logins), downloads nothing, grants no permission, and
closes windows the page opens.

A failed rendered look says why in the status: `pine's browser is not installed on this
computer` (run `pine browser-install`), `the page did not finish loading within 45 s`, `it sends
on to <host>, which is not the address that was confirmed` (the page moved), `it answered 403`
(some sites turn away a browser without a window). `found nothing with the selector` is no
failure: the page opened and nothing matched, so the selector is wrong or the page fills the
element in later than the look waits.

#### An amount as a number

A value that reads as a number or an amount, and nothing else, also arrives as `number` (and the
one before as `previousNumber`), so that a subscription can compare it:

```json
"subscribe": [{ "source": "fridge", "when": { "payload.number": { "lt": 500 } }, "note": "Tell me: the fridge is under 500 now." }]
```

| The value | `number` |
|---|---|
| `12.5`, `"12.5"`, `"12,5"`, `"87 %"`, `"-3,5 °C"`, `"3 GB"` | 12.5, 12.5, 12.5, 87, -3.5, 3 |
| `"$1,299.00"`, `"1.299,00 €"`, `"1 299,00 kr"`, `"1'299.50"` | 1299, 1299, 1299, 1299.5 |
| `"1,299"`, `"1.299"` | 1299 and 1.299: as a program writes numbers |
| `"1.299 €"`, `"1,299 €"` | 1299 and 1.299: next to `€`, `zł`, `kr` or `Kč` a dot groups thousands and a comma is the decimal point |
| `"1.2.3"`, `"12:30"`, `"2026-05-01"`, `"about 5"`, `"sold out"` | none |

A single separator followed by exactly three digits is the one ambiguous case; the two middle
rows show how it is decided. Where that is wrong for a page, take the digits apart with `match`
(`"([0-9]+)[.,][0-9]{3} "`) and compare the text.

#### Several fields, and an address that is asked with POST

```json
"fridge": {
  "type": "http", "url": "https://shop.example/graphql", "method": "POST",
  "body": "{\"query\": \"{ product(id: 7) { price stock { count } } }\"}",
  "values": { "price": "data.product.price", "stock": "data.product.stock.count" },
  "every": "30m", "description": "price and stock of the fridge"
}
```

One event says which fields changed: `{ "values": { "price": 479, "stock": 3 }, "previous": {
"price": 499, "stock": 3 }, "changed": ["price"] }`. A field missing from the answer is `null`.
Numbers in the JSON are numbers, so `when` compares them directly:
`{ "payload.values.stock": { "gt": 0 } }`. What a `POST` sends is shown to you in full before the
source is set up.

#### Limits of a look

- An address that names a version of its answer (`ETag`, `Last-Modified`) is asked "anything new
  since?" from the second look on; `feed` and `calendar` do the same.
- A local address is said to be one in the dialog. Any other has to stay on the public internet:
  if its name one day leads into your network, the look fails and says so.
- A redirect is followed only on the same host, five at most; one to another host is a failed
  look that says where it leads. An answer is read up to 1 MB; a look may take 20 seconds.
- A key that is part of the address (`?apikey=...`) is stored and shown like the rest of it.
- Refused at set-up: a user name or password in the address, more than one of `path`, `values`,
  `match` and `select`, `attr` without `select`, a selector that cannot be read, a `method` other
  than `GET` and `POST`, a `body` without `POST`, `values` that are empty, more than twenty, or
  under a name that is not a plain word.

### command

A command run again and again, for what only a command can tell: free disk space, a build, a
branch that moved, whether a machine answers. A command that keeps running and prints a line
whenever something happens is followed instead (see "Following a command that keeps running").

> Tell me when the disk is more than 90% full.

```json
"disk": { "type": "command", "run": "df -h /", "match": "([0-9]+)%", "every": "10m", "description": "how full the disk is" }
```

| Option | Default | |
|---|---|---|
| `run` | | The command line, at most 2000 characters (put more into a script). bash runs it from the workspace of the agent the source belongs to. |
| `every` | `"1m"` | How often. At least `"5s"` when an agent sets it up. |
| `match` | | Watch only what this regular expression finds in what the command prints (its first group, if it has one). |
| `timeout` | `"30s"` | How long one run may take before it is stopped. At least `"1s"`. |

Event `changed`: `{ command, code, previousCode?, value, previous }` with `match`, or
`{ command, code, previousCode?, added, removed, more? }` without. `code` is the exit code;
`previousCode` is there when it changed, so `test -f build/done` or `ping -c1 nas` report by how
they end. A command that cannot start or runs out of time is a failed look, not an event.

The command always runs **like a shell command of an agent in `safe` mode**: in the agent's
sandbox, with its private home and without your environment, also for an agent in `auto` mode
(nobody is there to answer for a command on a clock). It reaches the agent's own folders and
nothing else: no network unless `sandbox.network` is set, none of your home beyond
`sandbox.read`, none of pine's files. A source of all agents runs as the main agent. You are
shown the command line every time before it is set up. On a machine without a sandbox a
`command` source does not run; its status says so, and `pine check` names it.

#### Following a command that keeps running

Some commands tell by themselves when something happens: `tail -F` on a log, `log stream`,
`docker events`, `kubectl get pods -w`, the client of a broker or a database. With `follow` the
command is started once and kept running, and every line it prints is an event. This is the type
for any protocol that has a command line client and no type of its own.

```json
"backup": { "type": "command", "run": "tail -n 0 -F ~/Library/Logs/backup.log", "follow": true, "match": "ERROR (.*)", "description": "errors in the backup log" }
```

| Option | Default | |
|---|---|---|
| `follow` | `false` | `true`: start the command once, keep it running, report each line. `every` and `timeout` are refused with it. Not on Linux. |
| `perMinute` | `30` | With `follow`: at most this many lines a minute, 1 to 600. The rest are counted, and the next reported line carries the count as `dropped`. |
| `match` | | With `follow`: only lines in which this regular expression finds something; its first group is the line's `value`. |

| Event | | |
|---|---|---|
| `line` | `{ command, line, value?, dropped? }` | One line, cleaned of terminal color codes and cut at 2000 characters. `value` is what `match` found, or the parsed line when it is JSON, so `when` can look into it (`{"payload.value.status": "die"}`). |
| `ended` | `{ command, code?, error?, ran }` | The command ended (`ran`: after how many seconds, `error`: the end of its error output). It is started again after a pause that grows while it keeps ending at once; one that ends the moment it starts is reported once, not at every try. |

| What to follow | `run` |
|---|---|
| A log file | `tail -n 0 -F /path/app.log` (`-n 0`: only what is written from now on; `-F`: also after rotation) |
| The Mac's own log | `log stream --style ndjson --predicate 'subsystem == "com.apple.TimeMachine"'` |
| Docker | `docker events --format '{{json .}}'` |
| Kubernetes | `kubectl get pods -w -o json`, `kubectl get events -w` |
| systemd's journal, on another machine | `ssh nas journalctl -f -p warning -o json` |
| PostgreSQL `LISTEN` | a few lines of script around a client library that print each notification as a line |
| Redis | `redis-cli --raw subscribe alerts` |
| NATS, Kafka, RabbitMQ | `nats sub 'orders.>'`, `kcat -C -b broker -t topic -o end`, `amqp-consume -q queue cat` |
| A folder on another machine | `ssh nas inotifywait -m -e close_write /volume1/scans` |

It runs in the same sandbox, so most of these need something from you first: a log file readable
by the agent (`sandbox.read`), a client that talks to the network `sandbox.network`. The dialog
shows the command line and that it will keep running. When the source stops, the command and
everything it started end with it.

On Linux `follow` is refused: the sandbox there removes files that are read as instructions only
after a command ends, and a followed command does not end. Run it again and again instead
(`every` with a `match`), or send its lines to a `syslog` or `webhook` source.

### feed

A feed read again and again: each entry that was not there before is one event. For everything
that publishes RSS or Atom: releases, blogs, video channels, podcasts, searches, status pages.

> Tell me when a new version of Node comes out.

```json
"node": { "type": "feed", "url": "https://github.com/nodejs/node/releases.atom", "every": "1h", "description": "releases of Node.js" }
```

| Option | Default | |
|---|---|---|
| `url` | | The feed itself, `https://...`, not the web page that links to it. |
| `every` | `"15m"` | How often to read it. At least `"1m"` when an agent sets it up. |
| `match` | | Only entries whose title or text this regular expression finds: `"security\|CVE"`, `"^v[0-9]+\\.0"`. |
| `headers` | | Headers to send. Not for secrets. |
| `token` | | An access token or key, sent as `Authorization: Bearer <token>`. Kept in `.env`. |
| `tokenHeader` | | Send the token as this header instead, as it is: `"x-api-key"`. |
| `local` | `false` | The address is on your own network under a name that does not say so. |

| Event | | |
|---|---|---|
| `entry` | `{ feed, title, link, id, published?, author?, summary, media?, more? }` | One for each new entry. `feed` is the feed's title, `summary` the entry's text as a reader sees it (up to 1500 characters), `published` a time in UTC, `media` a podcast episode's sound or video file. |

Each look reports what is new, oldest first, ten at most: when there were more (a moved feed, a
week without power), the newest ten are reported and the last carries `more`, the number left
out. An entry is known by its id (`guid`, Atom `id`), else its link, else title and date; one that
leaves the feed and comes back is not new (the last 500 that left are remembered). It reads RSS
2.0, RSS 1.0, Atom and JSON Feed. The status shows a count, never a title.

| What it is for | The feed's address |
|---|---|
| Releases of a project on GitHub | `https://github.com/<owner>/<repo>/releases.atom` |
| Commits on a branch on GitHub | `https://github.com/<owner>/<repo>/commits/<branch>.atom` |
| Tags on GitHub | `https://github.com/<owner>/<repo>/tags.atom` |
| A YouTube channel | `https://www.youtube.com/feeds/videos.xml?channel_id=<id>` (the id starts with `UC`; a playlist: `?playlist_id=<id>`) |
| A blog | Usually `/feed`, `/rss.xml`, `/atom.xml` or `/index.xml`; the page names it in a `<link rel="alternate">` tag. |
| A podcast | The address a podcast directory shows as "RSS feed". The episode's file is in `media`. |
| arXiv | `https://export.arxiv.org/rss/<category>`, e.g. `cs.AI`. Entries on working days only. |
| A subreddit, a Reddit search | `https://www.reddit.com/r/<name>/.rss`, `https://www.reddit.com/search.rss?q=<words>` |
| Hacker News | `https://hnrss.org/frontpage`, `https://hnrss.org/newest?q=<words>`, `https://hnrss.org/newest?points=300` |
| A status page | Most have `/history.atom` or `/history.rss` (GitHub: `https://www.githubstatus.com/history.atom`). |
| A Mastodon account | `https://<instance>/@<name>.rss` |
| Weather warnings, earthquakes, court decisions, job boards, classifieds | Whatever the site offers as RSS or Atom; many searches have a feed of their results. |

With a pattern the agent is woken only for what counts, without a model reading the rest:

```json
"cves": { "type": "feed", "url": "https://hnrss.org/newest?points=100", "match": "(?i:postgres|sqlite)", "description": "stories about databases on Hacker News" }
```

Refused at set-up: an address that is not `http(s)`, a user name or password in it, a header that
carries a secret (it goes into `token`), a `match` that is not a regular expression. A failed look,
not an event: an answer that is a web page instead of a feed (it is not searched for its feed),
and a redirect to another host. An answer is read up to 1 MB, which for a long feed is its newest
entries.

### calendar

A calendar read again and again: reports entries that were added, changed or removed. For any
calendar with an iCalendar address (`.ics`): a shared family calendar, a team's, a school's, a
club's fixtures, the waste collection.

> Keep an eye on the family calendar and tell me when somebody adds or moves something this month.

```json
"family": { "type": "calendar", "url": "https://calendar.google.com/calendar/ical/.../basic.ics", "ahead": "30d", "description": "the family calendar" }
```

| Option | Default | |
|---|---|---|
| `url` | | The iCalendar address, `https://...` or `webcal://...` (the same address, read over https). |
| `every` | `"15m"` | How often to read it. At least `"1m"` when an agent sets it up. |
| `ahead` | `"60d"` | Only entries that begin within this from now; what is added further away is not reported, also not later. At least `"1h"`. |
| `headers` | | Headers to send. Not for secrets. |
| `token` | | An access token or key, sent as `Authorization: Bearer <token>`. Kept in `.env`. |
| `tokenHeader` | | Send the token as this header instead, as it is. |
| `local` | `false` | The address is on your own network under a name that does not say so (a Nextcloud at `cloud.home`). |

| Event | | |
|---|---|---|
| `added` | `{ calendar, uid, summary, start, end?, allDay?, zone?, location?, description?, repeats? }` | An entry that was not there at the last look. |
| `changed` | the same, with `was: { summary, start, end?, location? }` | Its title, time or place changed. A new description alone is not reported. |
| `removed` | `{ calendar, uid, summary, start }` | An entry still ahead is gone, or was cancelled. |

| `start` | Means |
|---|---|
| `2026-12-24T17:00:00Z` | A moment in UTC. |
| `2026-12-24T18:00:00` with `zone: "Europe/Berlin"` | That time on the clocks of that zone. |
| `2026-12-24T18:00:00` without `zone` | That time wherever the reader is ("floating"). |
| `2026-12-24` with `allDay: true` | The whole day. `end` is then the last day, left out for a single day. |

**It reports changes and never fires on a clock.** That an entry begins in ten minutes is no
event. An agent that is to remind you adds a schedule when the entry is reported (`add_schedule`
with `at`) and removes it when the entry is `removed`. An entry that has simply passed leaves
without a word.

A repeating entry is one entry, not unfolded into dates: `repeats` carries its rule as the
calendar writes it (`FREQ=WEEKLY;BYDAY=MO`), and it counts as inside `ahead` while it runs. One
moved date of it is an entry of its own with the same `uid`. One look reports twenty changes at
most, earliest first; the last carries `more` when there were more.

| What it is for | Where its address is |
|---|---|
| Google Calendar | Settings of the calendar, "Integrate calendar", "Secret address in iCal format". Google refreshes that file only every few hours. |
| iCloud | Share the calendar as a "Public Calendar" and copy the link (`webcal://...`). |
| Outlook, Microsoft 365 | Settings, "Shared calendars", "Publish a calendar", the ICS link. |
| Nextcloud | The calendar's menu, "Copy subscription link" (add `?export` to a share link). |
| Fastmail, Proton, Zoho and others | The calendar's sharing settings, as "iCal", "ICS" or "subscription" link. |
| Schools, clubs, leagues, public holidays, waste collection, cinema and concert programmes | A "subscribe" or "add to calendar" link on their site. |

A secret address like Google's is a key in itself, but pine stores and shows it like any address:
give it only where you would give the calendar.

Refused at set-up: an address that is not `https://`, `http://` or `webcal://`, a user name or
password in it, a header that carries a secret, `ahead` under an hour. A failed look, not an
event: an answer that is not a calendar, a redirect to another host, and a calendar over 8 MB
(half a calendar would make the other half look removed). A zone named only by the program that
wrote the calendar (`W. Europe Standard Time`) is read as this computer's zone.

### stream

A service that pushes: pine connects once, stays connected, and the service says by itself when
something happens, over Server-Sent Events (`https://`) or a WebSocket (`wss://`).

> Tell me when somebody opens the front door. Home Assistant knows.

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
| `url` | | `https://...` for Server-Sent Events, `wss://...` for a WebSocket. `http://` and `ws://` only for an address on your network or this computer. |
| `kind` | by the address | `"sse"` or `"websocket"`. Only needed for a WebSocket given as an `https://` address. |
| `hello` | | For a WebSocket: what is sent right after connecting, to log in or say what is wanted. One message or a list, each a text or a JSON object. `{{token}}` in it is replaced by the token, so the token is never in the configuration. |
| `token` | | An access token or key, sent as `Authorization: Bearer <token>` when connecting, only to that host; when `hello` says `{{token}}`, only there. Kept in `.env`. |
| `tokenHeader` | | Send the token as this header instead, as it is: `"x-gotify-key"`, `"x-api-key"`. |
| `headers` | | Headers to send when connecting. Not for secrets. |
| `event` | | For Server-Sent Events: only events of this name (`"notification"`). |
| `path` | | For messages in JSON: take only this field, `"event.data.new_state.state"` or `"data.0.last"`. A message without it is left out. |
| `match` | | Only messages this regular expression finds something in (in the field, with `path`). With a group, what it finds is the value. |
| `changed` | `false` | Report a value only when it differs from the last one; the first is the starting point. For a stream that repeats a state. |
| `perMinute` | `30` | At most this many reports a minute, 1 to 600. The rest are dropped and counted. |
| `local` | `false` | The address is on your own network under a name that does not say so (`ha.lan`). |

| Event | | |
|---|---|---|
| `message` | `{ value, event?, id?, previous?, dropped? }` | One message. `value` is the parsed JSON, the text, or what `path` and `match` picked, cut to 4000 characters. `event` and `id` as Server-Sent Events name them; `previous` with `changed`; `dropped` how many the cap left out before this one. |
| `down` | `{ url, error }` | After three attempts in a row that did not connect, once. |
| `up` | `{ url }` | Connected again. |

It reports what the service sends while connected, nothing from before; Server-Sent Events can
make up for a gap, since pine sends `Last-Event-ID` when it reconnects.

**Staying connected.** A connection that ends is made again after a second, then two, four and
so on up to five minutes, and from a second again once a connection has lasted; a service on this
computer is asked again sooner. Only three failed attempts in a row are an event (`down`). The
status says `connected since 14:02:11` or `cannot connect since 14:02:11 (4 attempts): it
answered 503`. A WebSocket is pinged every 45 seconds; an event stream silent for five minutes is
connected to again.

`path`, `match`, `event` and `changed` decide what counts and `perMinute` caps the rest, without
a model turn; the subscription's `throttle` applies on top. Refused at set-up: a user name or
password in the address, `http://` or `ws://` for an address that is not local, a header that
carries a secret, `hello` for Server-Sent Events, `event` for a WebSocket. A message over 256 KB
is left out.

#### What a stream reaches

Each line is an entry for `"sources"`; an agent sets the same up with `add_source` and asks you
for nothing but the token.

| Service | Entry | What arrives |
|---|---|---|
| ntfy (a topic on ntfy.sh or your own server) | `{ "type": "stream", "url": "https://ntfy.sh/my-topic/sse", "event": "message", "path": "message" }` | The text of every notification on the topic. Without `path`: title, priority, tags as well. A protected topic takes a `token`. |
| Gotify | `{ "type": "stream", "url": "wss://gotify.example.com/stream", "token": "${GOTIFY_CLIENT_TOKEN}", "tokenHeader": "x-gotify-key" }` | Every message of the server: `{ title, message, priority, appid }`. |
| Home Assistant | the example above | The new state of one entity. With `{ "id": 1, "type": "subscribe_events", "event_type": "state_changed" }` in `hello` instead: every state change of the house, which wants a `match` and a low `perMinute`. The token is a long-lived access token from your profile page. |
| signal-cli (Signal messages on this machine) | `{ "type": "stream", "url": "http://127.0.0.1:8080/api/v1/events", "event": "receive", "path": "envelope" }` | Each Signal message the account gets, for `signal-cli daemon --http 127.0.0.1:8080`. |
| Mastodon | `{ "type": "stream", "url": "https://mastodon.social/api/v1/streaming/user", "event": "notification", "token": "${MASTODON_TOKEN}" }` | Mentions, boosts, follows. Use the streaming address your instance names: a redirect to another host is not followed. |
| Bluesky (Jetstream) | `{ "type": "stream", "url": "wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post&wantedDids=did:plc:...", "path": "commit.record.text" }` | What one account posts. |
| A webhook relay (smee.io) | `{ "type": "stream", "url": "https://smee.io/your-channel", "path": "body" }` | Webhooks for a machine without a public address: GitHub, Stripe and the like call the relay, and pine reads them from it. Whoever knows the channel's address can write to it. |
| A ticker of an exchange (Kraken) | `{ "type": "stream", "url": "wss://ws.kraken.com/v2", "hello": { "method": "subscribe", "params": { "channel": "ticker", "symbol": ["BTC/EUR"] } }, "path": "data.0.last", "changed": true, "perMinute": 2 }` | The last price, at most twice a minute. With `when` on the subscription: only below or above a number. |
| A Nostr relay | `{ "type": "stream", "url": "wss://relay.damus.io", "hello": [["REQ", "pine", { "kinds": [1], "authors": ["<public key in hex>"] }]], "path": "2.content" }` | The notes of one author. (`hello` is a list of messages, and a Nostr message is itself a list.) |
| Wikimedia's public event stream, to try it | `{ "type": "stream", "url": "https://stream.wikimedia.org/v2/stream/recentchange", "path": "title", "perMinute": 2 }` | The title of a page somebody just edited, twice a minute, with `dropped` saying how many were left out. |

A page an agent makes for you to click in is listened to this way too: its small server offers
what is pressed as an event stream on this computer ([interfaces.md](interfaces.md)).

### mail

A mailbox: reports every new mail the moment the server says there is one (IMAP IDLE), with its
text and attachments. It only reads: nothing is marked as read, moved or deleted.

> Watch my mailbox and tell me on Telegram when the bank sends a statement. Put the PDF into
> ~/Documents/Bank.

```json
"inbox": {
  "type": "mail", "host": "imap.fastmail.com", "user": "me@example.com", "password": "${MAIL_APP_PASSWORD}",
  "from": ["@bank.example"], "subject": "statement|kontoauszug",
  "description": "statements from the bank"
}
```

| Option | Default | |
|---|---|---|
| `host` | | The IMAP server by name alone: `imap.gmail.com`. No `imap://`, port or path. Needed, except with `signIn`. |
| `user` | | The mailbox's user name, usually the e-mail address. |
| `password` | | Kept in `.env`. Most providers want an app password (table below). An agent leaves it out, and pine asks you for it. Not with `signIn`. |
| `signIn` | | `"microsoft"`: no password; you sign in at Microsoft once, with a code. For Outlook.com, Hotmail, Live and Microsoft 365. See "A Microsoft mailbox". |
| `clientId` | | With `signIn`: the Application (client) ID of an app you registered at Microsoft. Not a secret. |
| `tenant` | `"common"` | With `signIn`: whose accounts the app signs in. `"common"`: any. `"consumers"`: private accounts. `"organizations"`: work and school. Or one organisation's domain or id. |
| `port` | `993` | `143` with `security` `"starttls"` or `"none"`. |
| `security` | `"tls"` | `"tls"`: encrypted from the start. `"starttls"`: encrypted after connecting. `"none"`: only for a server on this computer or your network. |
| `mailbox` | `"INBOX"` | The folder to watch, as the server spells it (`"INBOX.Rechnungen"`, `"[Gmail]/All Mail"`). |
| `from` | everyone | Only mail that says it is from one of these: an address (`"bank@example.com"`) or a domain (`"@example.com"`). |
| `subject` | | Only mail whose subject this regular expression finds. Capitals do not matter. |
| `maxMb` | `10` | Attachments are kept up to this size (50 at most). A larger one is named in the event, without a file. |
| `keepDays` | `7` | Kept attachments are deleted after this many days. |
| `smtpHost` | | For sending: the provider's SMTP server. Only with `sendTo`. |
| `smtpPort` | `465` | `465` is encrypted from the start; any other port (`587`) uses STARTTLS. |
| `sendTo` | none | The addresses an agent may write to: `["me@example.com"]`. Without it the source only reads. |
| `sender` | `user` | The address mail is sent as. |
| `insecureTls` | `false` | Accept a certificate that cannot be verified (a server of your own with a self-made one). |
| `local` | `false` | The server is on your network or this computer under a name that does not say so (`mail.home`). |

| Event | | |
|---|---|---|
| `mail` | `{ from, fromName?, to, subject, date?, text, attachments, images?, cut? }` | One for every new mail that passes `from` and `subject`. `text` is the plain text, or what a reader sees of an HTML-only mail, up to 6000 characters. `attachments` lists `{ file, path?, type, size }`: `file` the name in the mail, `path` where pine put it; no `path` means larger than `maxMb`. `cut`: the mail was larger than what is fetched of one. |

Pictures among the attachments (jpg, png, webp, gif under 10 MB, four at most) are shown to the
agent if its model can look at images. The files lie in the source's folder, readable by the
subscribed agents ("Files a source received" in [sources.md](sources.md)); to keep one, the agent
copies it into its workspace.

The mail in the mailbox at the first connection is the starting point. After that every new one
is reported, also what arrived while pine was not running (the source remembers the last mail,
not a time); of more than 200 meanwhile, the oldest are left out.

**A sender can be forged.** Anyone can write any address in the sender line, so a mail is
always outside content: after it the agent asks before it sends anything out. `from` is a filter,
not a proof. `trust: "owner"` on a mailbox would hand your agent to whoever knows your address;
`pine check` names it under its security notes.

| Provider | `host` | `smtpHost` | The password |
|---|---|---|---|
| Gmail, Google Workspace | `imap.gmail.com` | `smtp.gmail.com` | An app password (Google account, Security, 2-Step Verification, App passwords). The account's own is refused. Workspace: unless its administrator turned app passwords off. |
| iCloud Mail | `imap.mail.me.com` | `smtp.mail.me.com`, `smtpPort` 587 | An app-specific password from account.apple.com. |
| Fastmail | `imap.fastmail.com` | `smtp.fastmail.com` | An app password (Settings, Privacy & Security, Integrations) with IMAP, and SMTP if it sends. |
| GMX, WEB.DE, mailbox.org, Posteo | `imap.gmx.net`, `imap.web.de`, `imap.mailbox.org`, `posteo.de` | `mail.gmx.net`, `smtp.web.de`, `smtp.mailbox.org`, `posteo.de` | The account's password; at GMX and WEB.DE, switch IMAP on in the settings first. |
| A server of your own (Dovecot, Mailcow, Synology MailPlus) | its name | its name | The mailbox's password. On your network: `"local": true` if the name does not say so, `insecureTls` for a self-made certificate. |
| Proton Mail | `127.0.0.1`, `port` 1143, `security` `"starttls"`, `insecureTls` | `127.0.0.1`, `smtpPort` 1025 | Through Proton's Bridge on this machine, with the password the Bridge shows. |
| Outlook.com, Hotmail, Live, Microsoft 365 | filled in: `outlook.office365.com` | filled in: `smtp.office365.com`, port 587 | None: `"signIn": "microsoft"` and a `clientId`, see "A Microsoft mailbox". |

**Sending.** With `smtpHost` and `sendTo` an agent writes with `send`:
`{"to": "me@example.com", "subject": "...", "text": "..."}`, as plain text, no files. It reaches
the addresses on `sendTo` and nobody else, whatever a call names; with one address on the list,
`to` can be left out. Mail can reach anybody, so after outside content the agent asks before it
sends ("Sending through a source" in [sources.md](sources.md)).

Refused at set-up: a `host` with a scheme, port or path, `"security": "none"` for a server that
is not local, a `from` entry that is neither an address nor `@domain`, `sendTo` without
`smtpHost` and the other way round, `maxMb` above 50. A password is never sent unencrypted to a
server that is not local. A refused login is why the source is not running, shown where sources
are listed; fix it and subscribe again or restart. A server that cannot be reached is tried again,
from a second up to five minutes apart. IDLE is renewed every 25 minutes; a server without it is
asked once a minute.

#### A Microsoft mailbox: signing in instead of a password

Outlook.com, Hotmail, Live and Microsoft 365 take no password over IMAP. You sign in at
Microsoft yourself, and Microsoft gives pine a sign-in for that one mailbox:

```json
"outlook": {
  "type": "mail", "user": "me@outlook.com", "signIn": "microsoft",
  "clientId": "11111111-2222-3333-4444-555555555555", "tenant": "consumers",
  "from": ["@school.example"], "description": "mail from the school"
}
```

When the source first starts:

1. pine shows a dialog: "Open https://microsoft.com/devicelogin in your browser, enter the code
   ABCD-EFGH, and sign in as me@outlook.com". The same is in the source's status line.
2. You open that page on any device, enter the code and sign in as always. Microsoft shows what
   the app asks for: reading the mailbox over IMAP, and sending if the source has `sendTo`.
3. pine notices the sign-in, closes the dialog and connects. You have about fifteen minutes; "no"
   in the dialog gives up.

pine never sees your password. What Microsoft hands over opens that mailbox, is renewed at every
connection, and is kept in pine's database in its home, where no agent reads. You are asked again
only when Microsoft no longer takes it: after you signed the app out, changed your password, or
the source was unused for about ninety days. Take the access away at Microsoft
(account.microsoft.com, Privacy, "Apps and services you've given access to"; for a work account
myapps.microsoft.com) or by removing the source.

`clientId` names an app you register at Microsoft, once, for free; pine ships none of its own, so
the app that asks for your mail is yours.

| Step | Where |
|---|---|
| Register an app | entra.microsoft.com, "App registrations", "New registration". Any name ("pine mail"). Supported account types: the choice that includes personal Microsoft accounts if the mailbox is a private one. No redirect address. |
| Copy its id | The app's "Overview" page: "Application (client) ID". That is `clientId`. |
| Allow signing in with a code | "Authentication", "Allow public client flows": Yes. Without it Microsoft refuses to give a code. |
| Allow reading mail | "API permissions", "Add a permission", "APIs my organization uses", "Office 365 Exchange Online", "Delegated permissions": `IMAP.AccessAsUser.All`, and `SMTP.Send` if the source sends. For a private account the question at sign-in is enough; in an organisation an administrator may have to agree. |

`tenant` has to fit the registration: `"consumers"` for an app only for private accounts, the
organisation's domain for one only for it, `"common"` for one that takes both. In an
organisation, IMAP switched off for the mailbox, or "Authenticated SMTP" switched off for sending
(Microsoft 365 admin center, the user, "Mail", "Manage email apps"), stand in the way, and the
status says which. An organisation that forbids apps its users registered cannot be reached this
way.

Refused at set-up: `signIn` other than `"microsoft"`, `signIn` without a `clientId` or with a
`password`, `clientId` or `tenant` without `signIn`. A wrong `clientId` or `tenant` is found when
the source starts and shown as why it is not running. Gmail has no such sign-in for mail; use an
app password there.

### slack

A Slack workspace: reports what is written in channels and direct messages (all of it, or what
mentions somebody, contains a word, or comes from certain people), and on request reactions,
edits, joins, channel changes, pins, your app's slash commands, and what other apps post. An
agent can answer: post to the channels and people you list, react with an emoji, send a file. It
uses Socket Mode: your Slack app connects out to Slack, so nothing listens on a port.

> Watch the #ops channel in Slack. Tell me on Telegram when somebody mentions me or writes
> "outage", when an alert comes in there, and always when Rainer writes anything, anywhere.
> Put :eyes: on what you have passed on.

```json
"work": {
  "type": "slack", "appToken": "${SLACK_APP_TOKEN}", "token": "${SLACK_TOKEN}",
  "channels": ["ops"], "mentions": ["me"], "keywords": ["outage"], "bots": true,
  "from": ["U0456RAINER"], "sendTo": ["C0123OPS"],
  "description": "what is written in Slack that concerns me"
}
```

What most people want needs a **user token** (see "Making the Slack app"), because it is about
what is written to you:

| You want to know when | Set | The event says |
|---|---|---|
| somebody writes, anywhere you are | nothing: this is what it does without filters | `why: ["channel"]`, or `["dm"]` |
| somebody writes to you personally | nothing (`dms` is on) | `kind: "dm"`, `why: ["dm"]` |
| somebody tags you | `"mentions": ["me"]` | `why: ["mention"]`, `mention`: your id |
| somebody writes about a topic | `"keywords": ["invoice", "outage"]` | `why: ["keyword"]`, `keyword`: the word |

With `mentions` or `keywords` set, a channel message counts only when one of them is found; a
direct message always counts. A message that is several of these says so (`why: ["dm",
"mention"]`), and a subscription can pick:

```json
"subscribe": [{ "source": "work", "when": { "payload.why": { "contains": "mention" } }, "note": "Somebody tagged me: tell me on Telegram, with who and where." }]
```

What you write yourself is never reported to you.

| Option | Default | |
|---|---|---|
| `appToken` | | The app-level token of your Slack app (`xapp-...`), with the scope `connections:write`. Socket Mode connects with it. Kept in `.env`. |
| `token` | | A bot token (`xoxb-...`) or user token (`xoxp-...`) of the same app. With it, people and channels have names in events, channels can be given by name, `"me"` is known, files are fetched, and things can be sent. Without it events carry ids only and the source only listens. Kept in `.env`; an agent leaves it out and pine asks you. |
| `events` | `["message"]` | Which kinds are reported: `"message"`, `"reaction"`, `"edit"`, `"member"`, `"channel"`, `"pin"`, `"command"`, `"other"`. See "The kinds of event". |
| `channels` | every channel the app sees | Only these channels, by name (`"ops"`, `"#ops"`) or id (`"C0123ABCD"`; a private channel's starts with `G` or `C`). A name is looked up at start and needs `token`. |
| `mentions` | | Only messages that mention one of these: user ids, `"me"`, `"here"`, `"channel"`, `"everyone"` (somebody wrote @here, @channel, @everyone), or a user group's id (`S...`). |
| `keywords` | | Only messages that contain one of these words. Capitals do not matter. |
| `from` | | User ids whose messages always count, anywhere and whatever they say. An app's id (`B...`) too. `"me"` here has your own messages reported. |
| `dms` | `true` | Direct messages count without a mention or keyword. |
| `bots` | `false` | `true`: what other apps and integrations post counts too, with `bot: true`. Your own app's posts are never reported. |
| `ignore` | | User ids never reported (an app's `B...` too). The token's own account is left out without being listed. |
| `sendTo` | none | Where an agent may write, by id only: channels (`"C0123ABCD"`) and people (`"U0123ABCD"`, a direct message). Without it the source only listens. Needs `token`. See "Sending". |
| `perMinute` | `60` | At most this many reports a minute, 1 to 600. The rest are counted and dropped, and the next report says how many (`dropped`). |
| `history` | `true` | With a `token`: an agent may read earlier messages where the source listens (`read_source`), a thread answer comes with what it answers, and what was written while disconnected is asked for afterwards. `false` turns all three off. |
| `context` | `3` | How many earlier messages of a thread come with an answer in it, its first message among them. `0` to `10`. |
| `maxMb` | `10` | Files of a message are fetched up to this size (50 at most). A larger one is named without a `path`. Needs `token`. |
| `keepDays` | `7` | Fetched files are deleted after this many days. |
| `apiBase` | `https://slack.com/api` | A Slack-compatible server of your own: over https, or on this machine. |

**`"me"`** is the account the `token` belongs to: with a user token you, with a bot token the
bot. **Names and ids**: `channels` takes names; `mentions`, `from`, `ignore` and `sendTo` take
ids (and `"me"`). A person's id is in their profile under "Copy member ID"; a channel's is the
last part of its link ("Copy link"). `sendTo` takes ids only because a name can be given to
another channel tomorrow. A channel name the app cannot find is why the source does not start:
`there is no channel named "opps" that the app can see`.

#### The kinds of event

| `events` | Event | Fields | When |
|---|---|---|---|
| `"message"` | `message` | `{ text, user, userName?, channel, channelName?, kind, ts, thread?, reply?, bot?, mention?, keyword?, from?, files?, images?, why, context?, late?, dropped? }` | Somebody wrote something that counts. |
| `"reaction"` | `reaction` | `{ reaction, added, user, userName?, channel, channelName?, ts, author?, authorName? }` | An emoji put on a message (`added: true`) or taken away. `ts` is the message, `author` who wrote it. |
| `"edit"` | `edited` | `{ text, previous?, user, userName?, channel, channelName?, kind, ts, mention?, keyword?, from? }` | A message was changed; `previous` is what it said. A link preview is not an edit. |
| `"edit"` | `deleted` | `{ channel, channelName?, ts, previous? }` | A message was deleted. |
| `"member"` | `joined`, `left` | `{ user, userName?, channel?, channelName? }` | Somebody joined or left a channel; without `channel`, joined the workspace. |
| `"channel"` | `channel` | `{ what, channel, channelName? }` | A channel was `"created"`, `"renamed"`, `"archived"`, `"unarchived"` or `"deleted"`. After `"renamed"`, `channelName` is the new name. |
| `"pin"` | `pin` | `{ added, channel, channelName?, ts?, user, userName? }` | A message was pinned (`added: true`) or unpinned. |
| `"command"` | `command` | `{ command, text, user, userName?, channel, channelName? }` | A slash command of your app: `command` is `"/deploy"`, `text` what followed. Whoever typed it reads "Passed on."; the agent answers with a message. |
| `"other"` | `event` | `{ type, data }` | Any other event your app is subscribed to: Slack's name for it and the event, cut at 4000 characters. |
| always | `gap` | `{ text, from, to, seconds, found, looked, complete, missing? }` | The source was not connected for a minute or longer, and is again. See "After a time without a connection". |

Any event can carry `dropped`. In a `message`:

- `text` is what a reader sees, cut to 4000 characters: `<@U0123>` as `@Name` (with a
  `token`), a link as `its words (https://its.address)`; an app's message is put together from
  its text, attachments and blocks. `userName` and `channelName` need a `token`.
- `kind` is `"dm"`, `"group"` (a group conversation or private channel) or `"channel"`.
- `ts` names the message (`send` takes it to react); in a thread, `reply: true` and `thread` is
  the thread's time stamp (`send` takes it to answer there).
- `context`, for an answer in a thread: the thread's first message and the last ones before the
  answer, as `{ user, userName?, text, ts }`, oldest first. Not with `history: false`, without a
  `token`, or when the app may not read history.
- `bot`: an app posted it. `late`: written while disconnected and asked for afterwards. `from`:
  its sender is on `from`. `mention`, `keyword`: which entry matched (for `"me"`, the id).
- `files`: up to ten, `[{ name, type, size, path? }]`, fetched from `files.slack.com` only into
  the source's folder ("Files a source received" in [sources.md](sources.md)); no `path` means
  larger than `maxMb`, unreadable with this token, or no token. `images`: the pictures among them
  (four at most), shown to a model that can look at images.

**Which message counts**, in this order:

1. Never: a post of your own app, and a message of somebody on `ignore`.
2. Never, unless `bots` is on: a message of another app or integration.
3. A message of somebody on `from` counts, wherever it was written.
4. A direct message counts when `dms` is on.
5. Any other message must be in a channel on `channels`, if there is such a list.
6. If `mentions` or `keywords` are given, it must match one of them; else every message counts.

`ignore`, `from`, `dms` and `channels` apply to the other kinds as far as they have a person and a
channel; `mentions` and `keywords` to messages and edits only. An event without a channel
(somebody joined the workspace) is not held back by `channels`. Beyond that, `when` on the
subscription picks (`{"payload.from": true}`, `{"payload.kind": "dm"}`, `{"payload.bot": true}`).

#### Making the Slack app

On api.slack.com/apps, "Create New App", "From scratch":

1. "Socket Mode": switch it on.
2. "Basic Information", "App-Level Tokens": make a token with the scope `connections:write`.
   That is `appToken`.
3. "Event Subscriptions": switch on, and under "Subscribe to bot events" (or "on behalf of
   users", see below) add the events for what you want reported.
4. "OAuth & Permissions": add the scopes from the table. Slack adds those an event needs; those
   for names, files and sending you add.
5. For slash commands: "Slash Commands", "Create New Command".
6. "Install to Workspace". The token shown is `token`. After adding an event or scope later,
   install again.

| To get | Event subscription | Scope |
|---|---|---|
| the connection | | `connections:write`, on the app-level token |
| messages in public channels | `message.channels` | `channels:history` |
| messages in private channels | `message.groups` | `groups:history` |
| direct messages | `message.im` | `im:history` |
| group conversations | `message.mpim` | `mpim:history` |
| only messages that mention the bot, without reading channels | `app_mention` | `app_mentions:read` |
| what other apps post (`bots`), edits and deletions (`"edit"`) | the `message.*` ones above | as above |
| reactions (`"reaction"`) | `reaction_added`, `reaction_removed` | `reactions:read` |
| who joins and leaves a channel (`"member"`) | `member_joined_channel`, `member_left_channel` | `channels:read`, and `groups:read` for private channels |
| who joins the workspace (`"member"`) | `team_join` | `users:read` |
| changes to channels (`"channel"`) | `channel_created`, `channel_rename`, `channel_archive`, `channel_unarchive`, `channel_deleted`; for private channels `group_rename`, `group_archive`, `group_unarchive`, `group_deleted` | `channels:read`, `groups:read` |
| pins (`"pin"`) | `pin_added`, `pin_removed` | `pins:read` |
| slash commands (`"command"`) | none: made under "Slash Commands" | `commands` |
| anything else (`"other"`) | the event you want | the scope Slack names for it |
| names of people | | `users:read` |
| names of channels, and `channels` by name | | `channels:read`, and `groups:read` for private channels |
| the files of a message | | `files:read` |
| what was written while disconnected, in conversations it has seen a message in | | the `...:history` scope of that kind of conversation |
| the same in conversations it has not seen a message in yet | | `im:read` for direct conversations; without a `channels` list also `channels:read`, `groups:read` and `mpim:read` |
| posting a message | | `chat:write` (and `chat:write.public` for a public channel the bot is not in) |
| a direct message to a person on `sendTo` | | `chat:write`, `im:write` |
| an emoji on a message | | `reactions:write` |
| sending a file | | `files:write` |

A missing scope does not stop the source: a name is left out, a file has no `path`, a `send` says
which scope Slack wants, a `gap` names what could not be looked at. The exception is a channel
given by name, which cannot be found without `channels:read`.

A **bot token** (`xoxb-`) sees the channels the bot was invited to (`/invite @yourapp`) and
direct messages to the bot. A **user token** (`xoxp-`, events subscribed "on behalf of users",
scopes added as user scopes) sees what you see: every channel you are in and your own direct
messages. To be told when somebody writes to *you*, it has to be a user token. What is sent with
a user token is sent in your name.

#### Reading what was written before

An answer in a thread arrives with its `context`, and an agent reads further with `read_source`:

| `data` | Reads |
|---|---|
| `{"channel": "C0123ABCD"}` | The last 20 messages of that channel or conversation, oldest first. `channel` is what an event had: an id starting with C, G or D. |
| `{"channel": "U0123ABCD"}` | The direct conversation with that person. pine knows it from when the person last wrote; otherwise Slack is asked, which needs `im:write`, or give the `channel` of one of their messages. |
| `{"channel": "...", "thread": "1712345678.000100"}` | That thread: the `thread` of an event, or the `ts` of the message it began with. |
| `"limit": 50` | More at once, 50 at most. |
| `"before": "1712345678.000100"` | Further back: the messages before that one. The answer says which `ts` to give. |

Each line is one message with when, who, its `ts`, and the number of answers of a message that
began a thread. It reads only where the source listens (the channels on `channels`, or every
channel the token sees, and direct conversations unless `dms` is off), marks nothing as read, and
needs the same `...:history` scopes as being told of messages. What is read is other people's
words: the conversation counts as having read outside content, and sending is then put to you.
`"history": false` turns reading off.

#### Sending

An agent sends with `send`: `text` for the message, `file` for a file from its workspace, the rest
in `data`.

| To | The agent passes |
|---|---|
| post in a channel on `sendTo` | `text`, and `data`: `{"channel": "C0123OPS"}` |
| answer in a thread | the same with `"thread"`: the `thread` of the event, or the `ts` of the message that starts one |
| write to a person on `sendTo` directly | `text`, and `data`: `{"channel": "U0456RAINER"}` |
| put an emoji on a message | `data`: `{"channel": "C0123OPS", "ts": "1712345678.000100", "react": "eyes"}` |
| send a file | `file`, with `text` beside it, and `data`: `{"channel": "C0123OPS"}` |

With one entry on `sendTo`, `channel` can be left out. A channel or person not on `sendTo` is
refused, whatever the call names; when a person is on it, the direct conversation with them counts
too. `@channel`, `@here` and `@everyone` in an agent's text call on nobody. A Slack `send` is asked
about after outside content, and Slack's events are outside content whatever `trust` says. What
the agent sent is not reported back. What Slack refuses, the agent is told in Slack's word with
what to do: `Slack refused chat.postMessage: not_in_channel. The app is not in that channel:
somebody there writes /invite and its name`.

#### Staying connected

A connection that ends is made again as for `stream`. Slack is pinged every few seconds; after
the machine slept, pine connects anew; when Slack says "slow down", pine waits as long as it says.
The status says `connected since 14:02:11. listening to 2 channels and direct messages, for
messages, reactions`, or `cannot connect since 14:02:11 (3 attempts): Slack refused
apps.connections.open: invalid_auth`. A `token` Slack does not take, and a channel name it does
not know, are why a source does not start.

#### After a time without a connection

Slack does not resend what was written while nobody was connected. pine notes when the
connection last worked (also across a restart) and, when connected again, asks Slack for what was
written since, where the source listens:

- Each message that counts is reported with `late: true`, oldest first. A thread answer is found
  when its thread began among the last 50 messages of its channel.
- After a minute or more, a `gap` event comes first:

```json
{ "text": "Slack was not connected from 2026-03-02 14:02:11 to 2026-03-02 14:07:30 (5 minutes). 2 messages written in that time follow, marked \"late\". It looked through all 14 conversations it listens to.",
  "from": "2026-03-02 14:02:11", "to": "2026-03-02 14:07:30", "seconds": 319, "found": 2, "looked": 14, "complete": true }
```

`complete: false` means the time is not fully known, and `missing` says why, one sentence each.
An agent passes that on and does not say "nothing new" for a time it could not look at. The
reasons, and what helps:

| `missing` is about | What helps |
|---|---|
| conversations it had not seen a message in, not looked at for lack of `im:read` (or `channels:read`, `groups:read`, `mpim:read` without a `channels` list) | Add the scope (for a user token among the User Token Scopes) and install the app again. |
| conversations that could not be read: a missing `...:history` scope, or Slack's own word (`not_in_channel`) | Add the scope; invite the app to the channel. |
| no `token`, or `"history": false` | Set the source up with a `token` and history. |
| messages over `perMinute`, or more than the last 200 in a conversation | The agent reads the rest with `read_source`. |
| more than 200 conversations | |
| reactions, edits and the other kinds, which Slack cannot give afterwards; and, with a `channels` list, what people on `from` wrote elsewhere | |

A gap shorter than a minute (Slack renewing the connection) is made up quietly, in the listed
`channels` and up to 40 conversations it has seen a message in, without a `gap`. After a longer
one it also asks which conversations there are, 200 at most. The status line names the last gap.
A subscription that picks with `when` on `why` is not woken by a `gap`, which has no `why`.

#### Limits, and what is refused

- One source is one Slack app in one workspace.
- Of what was written while disconnected, only messages are asked for; reactions, edits and the
  other kinds are not.
- A message's text is cut at 4000 characters, its files at ten, its pictures at four. A name is
  looked up once and kept until pine restarts; a renamed channel is noticed when the app is
  subscribed to `channel_rename`.
- A file larger than `maxMb` is not fetched; one that turns out larger than Slack said is given up.
- Buttons and forms (Slack's "interactivity") are acknowledged and not reported.
- It never speaks for you: no `trust: "owner"` for Slack, and nothing goes anywhere not on `sendTo`.
- Refused at set-up: an `appToken` not starting with `xapp-`, a `token` not starting with `xoxb-`
  or `xoxp-` (a rotating `xoxe...` token is not taken), a name where an id belongs (`mentions`,
  `from`, `ignore`, `sendTo`), an unknown kind in `events`, `perMinute` outside 1 to 600, `maxMb`
  above 50, an `apiBase` that is neither https nor on this machine.
- Refused at start: `"me"` or a channel by name without a `token`, a channel name not found or an
  app that may not list channels (`channels:read`), and a `token` Slack does not take.

### matrix

A Matrix account: reports what is written in the rooms it has joined, all of it or what mentions
somebody or contains a word. It long-polls the homeserver, so nothing listens on a port.

> Keep an eye on the family room on Matrix and tell me when somebody asks for me.

```json
"family": {
  "type": "matrix", "homeserver": "https://matrix.org", "token": "${MATRIX_TOKEN}",
  "rooms": ["!AbCdEfGh:matrix.org"], "mentions": ["@paul:matrix.org"],
  "description": "the family room"
}
```

| Option | Default | |
|---|---|---|
| `homeserver` | | The account's server: `https://matrix.org`. `http://` only for one on your network or this computer. |
| `token` | | An access token of the account. Kept in `.env`. |
| `rooms` | every joined room | Only these rooms, by id (`!AbCdEfGh:matrix.org`), not by alias. |
| `mentions` | | User ids (`@paul:matrix.org`): only messages that mention one of them. |
| `keywords` | | Only messages that contain one of these words. Capitals do not matter. |
| `ignore` | | User ids never reported. The account's own messages never are. |
| `sendTo` | none | Room ids an agent may write to: `{"room": "!AbCdEfGh:matrix.org", "text": "..."}`. Without it the source only listens. |
| `local` | `false` | The homeserver is on your network under a name that does not say so. |

Event `message`: `{ text, user, room, roomName?, kind, id, mention?, keyword?, dropped? }`.
`kind` is `"dm"` for a room the account keeps as a direct chat, else `"room"`; `id` is the
event's id. Edits are not reported again. At most 60 reports a minute; `dropped` counts the rest.

**The access token.** In Element: "All settings", "Help & About", "Advanced", "Access Token".
It is the key to the whole account: take it from a session of its own (log in in a private
window, copy the token, close the window without logging out, which would end the token), or
better, use an account made for pine and invited to the rooms it reads.

The first look only notes where "now" is. From then on pine remembers how far it has read, also
across a restart, so what was written while pine was down is reported when it is back (up to 50
messages a room).

**Encrypted rooms cannot be read**: pine holds no keys. Such messages are counted in the status
(`3 messages in encrypted rooms could not be read`). Use an unencrypted room, or a bridge.

Room messages are other people's words: outside content. Refused at set-up: a room alias
(`#family:matrix.org`; the id is in the room's settings under "Advanced"), a user id not of the
form `@name:server`, a homeserver outside your network that is not `https://`. A token the
homeserver refuses shows as `cannot connect since ...: the homeserver refused: M_UNKNOWN_TOKEN`.

### discord

A Discord bot: reports what is written in the servers it was invited to and in direct messages
to it, all of it or what mentions the bot or contains a word. It connects out to Discord's
gateway, so nothing listens on a port.

> Watch #announcements on our Discord and tell me when a release is mentioned.

```json
"community": {
  "type": "discord", "token": "${DISCORD_BOT_TOKEN}",
  "channels": ["1234567890123456789"], "keywords": ["release"],
  "description": "announcements on our Discord server"
}
```

| Option | Default | |
|---|---|---|
| `token` | | The bot's token from the Developer Portal. Kept in `.env`. |
| `channels` | every channel the bot can read | Only these channels, by id. |
| `guilds` | every server the bot is in | Only these servers, by id. |
| `mentions` | `false` | `true`: in servers, only messages that mention the bot. |
| `keywords` | | In servers, only messages that contain one of these words. Capitals do not matter. With `mentions` too, either is enough. |
| `dms` | `true` | Direct messages to the bot count without a mention or keyword. |
| `bots` | `false` | What other bots and webhooks write counts too. |
| `sendTo` | none | Channel ids an agent may write to: `{"channel": "1234567890123456789", "text": "..."}`. Without it the source only listens. |
| `apiBase` | `https://discord.com/api/v10` | A Discord-compatible server of your own: over https, or on this machine. |

Ids are long numbers: with "Developer Mode" on (User Settings, Advanced), right-click a channel
or server, "Copy ID". A name is refused.

Event `message`:
`{ text, user, userName, channel, channelName?, guild?, guildName?, kind, id, mention?, keyword?, files?, dropped? }`.
`kind` is `"dm"` or `"channel"`; `mention` is `true` when the bot is mentioned; `files` lists
attachments (`[{ name, type, size }]`, not the contents). In `text`, `<@123...>` becomes `@name`
and `<#123...>` `#channel`. The bot's own messages, people joining and pins are not reported. At
most 60 reports a minute.

**Making the bot.** On discord.com/developers/applications:

1. "New Application", then "Bot": "Reset Token" shows the token once. That is `token`.
2. On the same page, under "Privileged Gateway Intents", switch on **Message Content Intent**.
   Without it Discord closes the connection, and the status says `the bot is not allowed to read
   messages yet: switch on "Message Content Intent" ...`.
3. "OAuth2", "URL Generator": tick `bot`, and under "Bot Permissions" "View Channels" and "Read
   Message History" (and "Send Messages" if an agent writes). Open the address and pick your
   server.

The bot sees the channels its role may read; a private channel has to let it in. After a dropped
line the session is resumed, so what was written meanwhile still arrives; if Discord dropped the
session, what was written while away is not reported. A text over 2000 characters is sent as
several messages, and pings nobody (no `@everyone`, role or person). Channel messages are
outside content.

### zulip

A Zulip organization: reports what is written in its channels and in direct messages to the
bot, all of it or what mentions the bot or contains a word. It long-polls Zulip, so nothing
listens on a port.

> Watch #releases on Zulip and tell me when somebody mentions a release.

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
| `site` | | The organization's address, e.g. `https://example.zulipchat.com`. |
| `email` | | The bot's email address. Its own messages are never reported. |
| `key` | | The bot's API key, from Settings, Bots. Kept in `.env`. |
| `streams` | every channel public to the bot | Only these channels, by name. Direct messages to the bot are reported either way. |
| `mentions` | `false` | `true`: only messages that mention the bot, by name or a group it is in (not `@all`). Zulip marks a mention in a channel only for its subscribers: add the bot to the channel. |
| `keywords` | | Only messages that contain one of these words. Capitals do not matter. With `mentions` too, either is enough. |
| `ignore` | | Sender email addresses never reported. |
| `sendTo` | none | Channels an agent may write to: `{"stream": "releases", "topic": "pine", "text": "..."}` (topic `pine` if left out). Without it the source only listens. |
| `local` | `false` | The address is on your network under a name that does not say so. |

Event `message`: `{ text, user, name, stream, topic, kind, id, mention?, keyword?, dropped? }`.
`kind` is `"dm"` or `"stream"` (then `stream` and `topic` say where); `mention` is `true` when
the bot was mentioned. The first look is the starting point. At most 60 reports a minute.

**Making the bot.** In your organization, Settings, Bots, "Add a bot": copy the email address and
the API key it shows (`email` and `key`).

A dropped connection picks up where it left off; when Zulip has let the bot's event queue
expire, only what is written from then on is reported. An agent's answer is not posted by itself:
it writes with `send`, which asks you once the conversation has read what somebody wrote. The
source joins and creates no channel. Channel messages are outside content.

### smtp

A mail drop: a small mail server that accepts messages and nothing else. For devices and programs
whose only way of reporting is "send an e-mail": they are given this computer as their mail
server, and what they send becomes an event.

> My NAS can only send e-mail alerts. Take them and tell me on Telegram when a disk is failing.

```json
"nas": { "type": "smtp", "port": 2525, "user": "nas", "password": "${NAS_MAIL_PASSWORD}", "to": ["alerts@pine.home"], "description": "alerts the NAS sends" }
```

| Option | Default | |
|---|---|---|
| `port` | | The port to listen on, `2525`. (25, 465 and 587 are the usual ones; below 1024 many systems want root.) |
| `user` | `"device"` | The user name the device logs in with. The default is filled in when an agent sets the source up; in a file you write, give it with a password. |
| `password` | made by pine | 8 characters or more. When an agent sets it up without one, pine makes one and keeps it in `.env` as `PINE_SOURCE_<NAME>_<AGENT>_PASSWORD`. Left out with `allow` given, no login is asked for. |
| `allow` | everyone who logs in | Only these client addresses, as prefixes: `["192.168.1.40", "192.168.2."]`. For a device that cannot log in, give its address and no password. |
| `host` | `"0.0.0.0"` | The address to listen on. |
| `to` | any | Recipient addresses it accepts: `["alerts@pine.home"]`; mail for any other is refused. The address need not exist anywhere. |
| `maxMb` | `10` | The largest message accepted (50 at most). |
| `keepDays` | `7` | Received attachments are deleted after this many days. |

| Event | | |
|---|---|---|
| `mail` | `{ from, fromName?, to, subject, text, attachments, images?, client }` | One per message. `from` is what the message says, `to` the recipients the device named, `client` the address it really came from. `attachments` and `images` as for `mail`. |

In the device, enter this computer's address as the SMTP server, the port, **no encryption** (no
SSL, TLS or STARTTLS), the user and password, and any sender and recipient (one from `to`, if
set).

| What it is for | How |
|---|---|
| Synology DSM, QNAP QTS | Control Panel, Notification, Email: a custom SMTP server, this computer and the port, no secure connection. Disk, volume, UPS and backup alerts. |
| TrueNAS, Proxmox, Unraid | Their e-mail settings take an SMTP server with user and password ("outgoing mail server", "notification target"). |
| UniFi, routers | UniFi's Network application takes a custom SMTP server in its e-mail settings; a Fritz!Box under System, Push Service, Sender, with secure connection unticked. |
| Printers and scanners | "Scan to e-mail": the scan arrives as an attachment the agent can file. Most cannot log in: give `allow` with the printer's address and no password. |
| UPS units, network cards of UPS units | APC, Eaton and CyberPower mail on power loss and low battery. |
| Cameras and recorders | A snapshot by mail on motion (Reolink, Hikvision, Dahua). A camera that can upload by FTP is better served by `ftp`. |
| A Linux server | cron, smartd, unattended-upgrades, fail2ban and mdadm mail to root. With `msmtp` (`/etc/msmtprc`: `host`, `port`, `auth on`, `user`, `password`, `tls off`) or a Postfix `relayhost` that mail arrives here. |
| Your own scripts | Anything that can call `sendmail`, `mail` or `curl smtp://`. |

It speaks plain SMTP, so password and mail cross your network unencrypted: it is for your own
network. It **only receives**: it relays nothing, nothing can be read back, and every attachment
lands under a name of pine's choosing in the source's folder. What a mail says is outside
content, also from your own NAS; for a device nobody else can reach, fixed with `allow`, you can
say `own` when you ask the agent to set it up (or `"trust": "owner"` in the file).

One of `password` and `allow` is needed, or the source does not start. Refused: a message over
`maxMb`, a recipient not on `to`, a client not on `allow` (closed without a greeting), three wrong
passwords in a row, more than 20 connections at a time, a connection silent for a minute, and
more than 30 messages a minute ("try again later": a mail program resends by itself). The status
counts what was received and refused.

### syslog

A syslog listener: takes the log lines routers, firewalls, switches, access points and NAS boxes
send to a "remote log server", and reports the ones that matter.

> Have the router send its log here and tell me when the internet line goes down or somebody
> fails to log in.

```json
"router": { "type": "syslog", "port": 5514, "allow": ["192.168.1.1"], "match": "link down|PPP|login failed", "severity": "notice", "description": "the router's log" }
```

| Option | Default | |
|---|---|---|
| `port` | | The port to listen on, `5514`. (514 is usual, which on many systems only root may open.) |
| `host` | `"0.0.0.0"` | The address to listen on. |
| `protocol` | `"udp"` | `"udp"` (what most devices send), `"tcp"`, or `"both"`. |
| `allow` | anyone | Only these sender addresses, as prefixes: `["192.168.1.1", "192.168.2."]`. |
| `match` | | Only lines in which this regular expression finds something. |
| `severity` | `"warning"` | The least severe level still reported: `emerg`, `alert`, `crit`, `err`, `warning`, `notice`, `info`, `debug`. `"debug"` reports every line that matches. |
| `perMinute` | `20` | At most this many reports a minute (1 to 600). The rest are counted and dropped. |

| Event | | |
|---|---|---|
| `line` | `{ host, app?, severity, facility, message, from, time?, dropped? }` | One for every line severe enough that matches. `host` and `app` are what the line says (`host` is the sender's address when the line names none), `from` where it really came from, `message` the text up to 2000 characters. |

Both formats are read: RFC 3164 (`<13>Oct 11 22:14:15 router dnsmasq[1873]: ...`, also without
time or name) and RFC 5424, whose `time` is passed on. Any other line is reported as it is, with
severity `notice`. Over TCP a line ends with a line break or has its length in front. Up to 20
TCP connections, lines up to 8 KB.

| What it is for | How |
|---|---|
| OpenWrt | System, System, Logging: "External system log server" and its port; or `uci set system.@system[0].log_ip=<address>` and `log_port=5514`. |
| UniFi | Network application settings: "Remote syslog server" ("SIEM server" in newer versions), address and port. |
| MikroTik RouterOS | `/system logging action set remote remote=<address> remote-port=5514`, then `/system logging add topics=error action=remote`, one line per topic. |
| pfSense, OPNsense | Status, System Logs, Settings, "Remote log servers" (pfSense); System, Settings, Logging, Targets (OPNsense). |
| Synology DSM | Log Center, Log Sending: the server, port, UDP or TCP, format BSD or IETF. |
| A Linux server | rsyslog: `*.warn @<address>:5514` in `/etc/rsyslog.d/pine.conf` (`@` is UDP, `@@` TCP). journald alone cannot send; rsyslog or syslog-ng does. |
| Switches, access points, printers, IP phones | Almost all have a "syslog server" field. |

**Syslog has no login**: whoever reaches the port can write any line. Without `allow` the dialog
says so in capitals; with it, lines from other addresses are counted and dropped. Over UDP even
the sender's address can be forged on the same network, so a line is outside content. It only
receives and stores nothing but the events. Lines that fail `severity` or `match` are only
counted; the status says how many passed, failed, were over the limit, or came from addresses not
allowed, and never repeats a line. Set a `throttle` on the subscription ("5m") so a burst wakes
the agent once.

### onvif

A network camera's own detections: motion, a person, a vehicle, tampering, a line crossed, a
doorbell's button. The camera does the looking; this source asks it what it saw over ONVIF
(Profile S and T), which most cameras and recorders speak.

> When the camera at the gate sees a person, tell me on Telegram.

```json
"gate": { "type": "onvif", "host": "192.168.1.40", "port": 8000, "user": "pine", "password": "${GATE_CAMERA_PASSWORD}", "topics": ["Motion", "People", "Visitor"], "description": "what the camera at the gate detects" }
```

| Option | Default | |
|---|---|---|
| `host` | | The camera's address on your network: `192.168.1.40`, without `http://` or port. |
| `user`, `password` | | An account on the camera; make one for pine with the lowest rights that may read events. The password is kept in `.env`. |
| `port` | `80` | The camera's ONVIF port (table below). |
| `path` | `"/onvif/device_service"` | Where its ONVIF service is; nearly every camera uses this. |
| `topics` | everything | Only events whose topic contains one of these words (up to 20); capitals do not matter. `["Motion", "Person"]`. |
| `perMinute` | `20` | At most this many reports a minute, 1 to 120. The rest are dropped; the next event says how many in `dropped`. |
| `local` | `false` | The address is a name on your network that does not say so (`gate.lan`). |

Event `event`: `{ topic, source, data, time?, active?, dropped? }`.

| Field | |
|---|---|
| `topic` | What happened, as the camera calls it: `RuleEngine/CellMotionDetector/Motion`. |
| `source` | Which part of the camera, as names and values: `{ "VideoSourceConfigurationToken": "1" }`. A recorder with eight cameras tells them apart here. |
| `data` | What it says: `{ "IsMotion": true }`. Booleans and numbers come as such. |
| `active` | When `data` holds exactly one yes-or-no value, that value: `true` when motion starts, `false` when it ends. To be woken only at the start: `{"payload.active": true}`. |
| `time` | The camera's own time for it. |

| Make | Port | To switch on |
|---|---|---|
| Reolink | 8000 | Settings › Network › Advanced › Port settings: ONVIF. |
| Hikvision | 80 | Network › Advanced › Integration protocol: enable ONVIF and add an ONVIF user there (separate from the camera's own users). |
| Dahua, Amcrest | 80 | On by default on most; otherwise Network › Access platform › ONVIF. |
| Axis | 80 | System › ONVIF: add an ONVIF account. |
| TP-Link Tapo | 2020 | In the app: Advanced settings › Camera account. That account is the user here. |
| Others (Uniview, Foscam, Annke, most recorders) | 80, 8080 or 8899 | Look for "ONVIF" in the network settings. |

| What it reports | Topic contains |
|---|---|
| Motion | `Motion` (`CellMotionDetector/Motion` with `IsMotion`, or `VideoSource/MotionAlarm` with `State`) |
| A person, a vehicle, an animal | `People`, `Person`, `Vehicle`, `DogCat`, `FaceDetect`, depending on the make |
| Tampering: covered, moved, defocused | `Tamper` |
| A line crossed, somebody inside a zone | `LineDetector/Crossed`, `FieldDetector/ObjectsInside` |
| A doorbell's button | `Visitor` |
| A wired alarm input | `DigitalInput` |

Names differ by make: set the source up without `topics`, walk past the camera, look at what
arrives (`pine events --topic 'source/gate/#'`), then narrow it down.

pine subscribes at the camera and keeps one question open that the camera answers the moment
something happens (a "pull point"), so the camera needs no way to reach pine. If the camera
restarts or forgets the subscription, a new one is made. The first thing a camera says (no
motion, not tampered) is the starting point; a state said again unchanged is not reported;
something that just happens (a line crossed) is reported every time.

Every request goes to the host and port you confirmed; of addresses a camera names, only the
path is used. The password never crosses the network: ONVIF sends a digest of it. The rest is
plain HTTP. It only listens: nothing on the camera is changed, and it brings the event, not a
picture (for that, let the camera upload one with `ftp`, or have the agent fetch a snapshot).
Not tried on every make. Not supported: cameras that accept only HTTP digest authentication for
ONVIF (on some Axis and Hikvision models, choose "digest and WS-UsernameToken"), and ONVIF over
HTTPS.

### modbus

A device that speaks Modbus TCP, read again and again: reports each value when it changes. For a
solar inverter, a battery, a heat pump, a wall box, an energy meter.

> Tell me when the house battery drops below 20%, and when it is full again.

```json
"battery": {
  "type": "modbus", "host": "192.168.1.60", "unit": 100, "every": "1m",
  "read": [
    { "name": "soc", "address": 843 },
    { "name": "power", "address": 842, "type": "i16", "step": 200 },
    { "name": "grid", "address": 820, "type": "i16", "step": 200 },
    { "name": "voltage", "address": 840, "scale": 0.1, "step": 0.5 }
  ],
  "description": "the house battery: charge in percent, power in watts, power from the grid, voltage"
}
```

| Option | Default | |
|---|---|---|
| `host` | | The device's address on your network: `192.168.1.60`. |
| `read` | | The values to read, 1 to 32 (next table). |
| `port` | `502` | Nearly always 502; SolarEdge inverters use 1502. |
| `unit` | `1` | The unit id (slave id), 0 to 255. A gateway in front of several devices tells them apart by it. |
| `every` | `"30s"` | How often to read. At least `"2s"`. |
| `local` | `false` | The address is a name on your network that does not say so (`inverter.lan`). |

| Key of a `read` entry | Default | |
|---|---|---|
| `name` | | A short word for the value: `power`, `soc`. The event carries it; a filter names it. |
| `address` | | The register's number counted from 0. A list counting from 40001 (holding) or 30001 (input) means the number minus that; "base 1" means minus 1. |
| `kind` | `"holding"` | `"holding"`, `"input"`, `"coil"` or `"discrete"`, as the register list says. `coil` and `discrete` are bits and come as `true` or `false`. |
| `type` | `"u16"` | `"u16"`, `"i16"` (may be negative), `"u32"`, `"i32"`, `"f32"`. The last three take two registers. |
| `scale` | `1` | The raw value is multiplied by it: `0.1` for tenths of a volt. |
| `step` | | Report only when the value moved at least this far since its last report: `200` for watts. Without it every change is an event. |
| `words` | `"be"` | For a 32-bit value: `"be"` if the first register is the high half (most devices), `"le"` if the low. A value that reads as nonsense with one is right with the other. |

Event `changed`: `{ name, value, previous }`, one for each value that moved. To be woken below a
threshold: `{"payload.name": "soc", "payload.value": {"lt": 20}}`.

The example is a Victron GX device (Cerbo, Venus OS): system values at unit 100; register 843 the
battery's charge in percent, 842 its power in watts (negative while discharging), 820 the grid
power on the first phase, 840 the battery voltage in tenths of a volt. Modbus TCP is switched on
under Settings › Services; Victron publishes the list as "CCGX Modbus TCP register list".

Solar inverters and batteries (SolarEdge, Fronius, SMA, Huawei, Sungrow, Victron) mostly speak
SunSpec once Modbus TCP is switched on; heat pumps usually need an extra network module; a meter
with only a serial bus (Modbus RTU) needs an RTU-to-TCP gateway. The register list is the one
thing this type cannot know: ask for "<exact model> Modbus register map"; an agent can read it
and pick the registers. Where a value's scale is a register of its own
(SunSpec's `_SF`), read both raw, or use the device's floating-point registers.

**It only reads**: only the four read functions (1 to 4) are ever sent, so nothing can be
switched or set through it. Each look is one short connection, since many devices allow one
Modbus connection at a time. A refused register (`illegal data address`), no answer within five
seconds, or a closed connection is a failed look. Refused at set-up: more than 32 values, two of
one name, an address above 65535, an unknown `type` or `kind`, `every` below `"2s"`.

### serial

A serial port: reports the lines a device prints on it. For what is plugged in by USB or a serial
cable and writes text: a microcontroller, a smart meter, a GPS receiver, a weather station. On
macOS and Linux; not on Windows.

> The Arduino on the USB port prints the greenhouse temperature every second. Tell me when it
> goes above 35.

```json
"greenhouse": { "type": "serial", "port": "/dev/cu.usbmodem1101", "baud": 115200, "match": "temp=([0-9.]+)", "changed": true, "description": "the temperature in the greenhouse" }
```

| Option | Default | |
|---|---|---|
| `port` | | The device: `/dev/cu.usbserial-1420` or `/dev/cu.usbmodem1101` on a Mac (`ls /dev/cu.*`), `/dev/ttyUSB0` or `/dev/ttyACM0` on Linux, or its lasting name under `/dev/serial/by-id/`. |
| `baud` | `9600` | The device's speed: 9600, 19200, 38400, 57600, 115200 and the other usual ones. With the wrong one nothing readable arrives. |
| `match` | | Report only lines this regular expression finds. Its first group becomes `value`, a number when it is one. |
| `changed` | `false` | Report a line (or its `value`) only when it differs from the one before. |
| `perMinute` | `30` | At most this many reports a minute, 1 to 600. The rest are dropped; the next event says how many in `dropped`. |

Event `line`: `{ port, line, value?, previous?, dropped? }`. Without `match`, `value` is there
when the line is JSON (`{"temp": 21.5}`) or a number. With `changed`, `previous` is the value
before. To be woken above a threshold: `{"payload.value": {"gt": 35}}`.

| What it is for | How |
|---|---|
| An Arduino, ESP32 or Pico that prints readings | `Serial.println()` in its sketch. One reading a line, as `name=value` or JSON. |
| A smart meter's P1 port (Dutch and Belgian meters, many others) | A USB P1 cable, 115200 baud. A block of lines every second or ten; `"match": "1-0:1\\.7\\.0\\(([0-9.]+)"` is the power drawn now in kW, `1-0:1.8.1` and `1-0:1.8.2` the meter readings. |
| A GPS receiver | NMEA sentences at 9600 baud (4800 for old ones); `"match": "^\\$G.GGA,(.*)"` is one position a second. |
| A weather station or a sensor with a data cable | Whatever its manual says it prints. |
| A UPS with a serial or USB cable | Only the ones that print status lines. Most want to be asked first: use the maker's tool or NUT with the `command` type. |

**It only listens**: nothing is written to the port, so a device that must be asked stays silent.
The port is read as 8 data bits, no parity, one stop bit. Only a serial port by its name is read
(`/dev/cu.*` or `/dev/tty.*` on a Mac; `/dev/ttyUSB0`, `/dev/ttyACM0`, `/dev/ttyS0`,
`/dev/ttyAMA0`, `/dev/rfcomm0` and the like on Linux); a terminal and anything that is not a device
under `/dev` are refused. An unplugged device is not an error: the source waits, looks again with a
growing pause (a minute at most), and says `waiting for cu.usbmodem1101: it is not there
(unplugged?)`. On Linux the user pine runs as needs read access to the port (the group `dialout`
on most systems). Lines are cleaned of control characters and cut at 1000 characters; a device
that never ends its line is cut every 4096.

### presence

Who is on your own network: reports when a device joins and when it has left. For "is my phone
home", a TV or console switched on, a printer that came online.

> When my phone comes home after having been away for more than an hour, switch the hallway
> light on.

```json
"home": { "type": "presence", "hosts": { "phone": "192.168.1.23", "tv": "192.168.1.30" }, "services": ["_ipp._tcp"], "away": "10m", "description": "who is at home: my phone, the TV, and any printer" }
```

| Option | Default | |
|---|---|---|
| `hosts` | | The devices to look for, as name and address: an IP address on your network or a `.local` name. Up to 32. |
| `services` | | Kinds of device that announce themselves (Bonjour, mDNS), by service type. Every device of that kind is reported under its own name. Up to 16. |
| `every` | `"30s"` | How often to look. At least `"10s"`. |
| `away` | `"10m"` | How long a device must be silent to count as gone. Not shorter than `every`. |

At least one of `hosts` and `services`.

| Event | | |
|---|---|---|
| `arrived` | `{ name, address?, service?, awayFor? }` | It is there again. `awayFor` is how long it was gone, in seconds; after a real absence only: `{"payload.name": "phone", "payload.awayFor": {"gt": 3600}}`. |
| `left` | `{ name, address?, service?, lastSeen }` | It has not answered for `away`. `lastSeen` is when it last did. |

For a phone, have the router always give it the same address (a "DHCP reservation"), and on an
iPhone switch off "Private Wi-Fi Address" for the home network. A TV or console answers while on
and is silent in standby (`away: "1m"` tells within a minute or two). Service types:
`_ipp._tcp` (printers), `_airplay._tcp` (Apple TV, HomePod, AirPlay TVs), `_googlecast._tcp`
(Chromecast, Google speakers), `_sonos._tcp`, `_spotify-connect._tcp`, `_hap._tcp` (HomeKit),
`_smb._tcp` (file shares, a NAS).

A host is there when it answers a ping, or answers a connection at all, even by refusing it. Each
look sends one ping and three connection attempts per host and one question about services to
the network; nothing on a device is read or changed. Who is there at the start is the starting
point. An arrival is reported at the next look, a departure once the device was silent for `away`,
which keeps a sleeping phone from leaving and arriving all evening (if it still flickers, make
`away` longer). A device that says goodbye when switched off (announced services do) is gone at
once.

- It sees your own network only; an internet address is refused (the `http` type's `down` and
  `up` are for those).
- A guest network or "client isolation" on the router hides everything.
- A phone is home when it is on the Wi-Fi: with Wi-Fi off or a flat battery it has left.
- When this computer has no network, the look fails and no departures are reported.
- On a Mac the system may ask once whether the app pine runs in may find devices on your local
  network; without a yes nothing answers.
- On Linux a `.local` name needs the system to resolve such names (Avahi with `nss-mdns`); an IP
  address always works.

### system

This computer: reports sleep and wake, screen lock, mains and battery, the network, disks plugged
in or taken out, and apps you named starting or quitting. On macOS, Linux and Windows with the same
events; what a system does not tell is left out there.

> When I unlock the Mac in the morning, tell me what happened overnight.

```json
"mac": { "type": "system", "watch": ["lock", "sleep", "power"], "apps": ["Xcode"], "battery": 15, "description": "what this Mac does: lock, sleep, power, Xcode" }
```

| Option | Default | |
|---|---|---|
| `watch` | all five | What to report: `"sleep"`, `"lock"`, `"power"`, `"network"`, `"volumes"`. |
| `apps` | none | Apps whose start and end are reported, up to 30. On a Mac by name or bundle id: `["Xcode", "us.zoom.xos"]`; on Windows by program name as the Task Manager's Details tab shows it, with or without `.exe`: `["Zoom", "Teams"]`. Not on Linux. |
| `battery` | `20` | Report `battery-low` once when the charge falls to this many percent on battery (1 to 99). |

| Event | | `watch` |
|---|---|---|
| `sleeping`, `woke` | `{}` | `sleep`: the computer goes to sleep, and is awake again. |
| `display-off`, `display-on` | `{}` | `sleep`: the screens go dark and light up again. Not on Linux. |
| `locked`, `unlocked` | `{}` | `lock`: the screen lock. |
| `power` | `{ on, percent? }` | `power`: the supply changed. `on` is `"ac"`, `"battery"` or `"ups"`. |
| `battery-low` | `{ percent }` | `power`: once per discharge, again only after charging. |
| `network` | `{ online, via? }` | `network`: the connection came, went, or changed its way (`"wifi"`, `"ethernet"`, `"cellular"`, `"other"`). |
| `mounted`, `unmounted` | `{ name, path? }` | `volumes`: a disk, memory card, disk image, network share. |
| `app-started`, `app-quit` | `{ app, bundle? }` | Only for the apps on `apps`. Not on Linux. |

For example: `watch: ["volumes"]` with `when: {"payload.name": "BACKUP"}` for the backup disk;
`apps: ["zoom.us"]` for a meeting's start and end.

How things are at the start (mains or battery, online or not) is the starting point. The charge
alone is no event: `power` comes when the supply changes and carries the charge then. A small
helper of pine's repeats what the system says; it needs no privacy grant. It does not report the
Wi-Fi network's name, other apps' notifications, or what you type or look at. A disk's name is
text from outside, so these events are outside content unless you mark the source as your own.

On a Mac pine builds the helper the first time the source starts, which needs Apple's command
line developer tools (`xcode-select --install`); the Pine app carries it built.

#### system on Linux

The helper listens on D-Bus's system bus through `gdbus` (package `libglib2.0-bin` on Debian and
Ubuntu, `glib2` elsewhere):

| | What it hears |
|---|---|
| Sleep | `sleeping` and `woke`, from systemd-logind. No `display-off` or `display-on`. |
| The lock | `locked` and `unlocked` of your own sessions, as the desktop tells logind (GNOME, KDE Plasma and most others; a bare window manager with its own locker may not). |
| Power | UPower (package `upower`, on every desktop). |
| The network | NetworkManager, or systemd-networkd on a server. Online means connected beyond the local network. |
| Disks | Mounts under `/media`, `/run/media` and `/mnt`, and network shares (`cifs`, `nfs`, `sshfs`) anywhere, looked at every two seconds. |

`apps` is refused on Linux. Where something is missing (no system bus in a container, no UPower
on a server) the source still runs and its status says what it cannot hear: `cannot hear power:
UPower is not running`. A service that starts later is heard from then on.

#### system on Windows

pine builds the helper with the C# compiler Windows carries the first time the source starts.
`ups` is not told apart from mains. The network is an interface that is up and has a gateway.
Apps are the programs in your session, looked at every two seconds: `app-started` when the first
process of a name starts, `app-quit` when the last one ends; `app` is the program's name without
`.exe`, with no `bundle`. A disk is named by its label, or its letter (`E:`) when it has none, and
`path` is the drive (`E:\`). pine in WSL is a Linux and hears little there (no lock, no battery).

## What there is no type for

| Wanted | Instead |
|---|---|
| A page that a script fills in after loading | `http` with `render` (see "A page that a script fills in"), or the JSON address the page's script asks, with `path`. |
| A calendar's "ten minutes before" | A schedule the agent sets when `calendar` reports the entry ([events.md](events.md), "Schedules"). |
| Bluetooth sensors and beacons | A bridge that publishes them to MQTT (Theengs Gateway, OpenMQTTGateway), and `mqtt`. |
| iMessage, WhatsApp | No type. Signal works through signal-cli and `stream`; Telegram, Slack, Matrix and Discord have types. |
| KNX, Z-Wave, Zigbee, HomeKit, Matter | Through the hub that speaks them (Home Assistant, zigbee2mqtt, zwave-js-ui), by `mqtt` or `stream`. |
| Something with a command line client and nothing else | `command` with `follow` (see "Following a command that keeps running"). |
| Something that can call a web address | `webhook`. |
| Something of your own | A source type of your own is a small module ([sources.md](sources.md), "A source type of your own"); the main agent can write and register one when you ask it. |
