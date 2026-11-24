# Source types: what each one watches, what it takes, what it is for

A source reports what happens somewhere else, and an agent that is subscribed to it is woken
with each report. What a source and a subscription are, who is woken, what trust an event has
and how secrets are kept is in [sources.md](sources.md). This file is the catalogue: every
type there is, the options it takes, the events it reports with their fields, and the services
and devices each one reaches, with an entry to copy for each.

## Which type for what

Two kinds of type exist. One **is told**: it listens on a port or holds a connection open, and
an event arrives the moment something happens. The other **looks**: it asks again and again
and reports what is different from the last look. A look that finds nothing new costs
nothing: no event, nothing stored, no model woken.

| Type | Told or looks | Reports | For |
|---|---|---|---|
| `folder` | told | a new or changed file | scans, downloads, exports, a project folder |
| `webhook` | told | a request another service sends to pine | GitHub, Home Assistant, a shortcut on a phone, anything that can call a web address |
| `stream` | told | each message a service pushes over Server-Sent Events or a WebSocket | ntfy, Gotify, Home Assistant, Mastodon, Bluesky, exchange tickers, webhook relays, signal-cli |
| `mqtt` | told | messages on the topics of a broker | Zigbee and Z-Wave hubs, sensors, plugs, printers |
| `telegram` | told | what you write to your bot | talking to an agent from anywhere |
| `mail` | told | a new mail in a mailbox | invoices, notifications of services that only write mail, a shared inbox |
| `slack` | told | what happens in a Slack workspace: messages (by channel, mention, keyword or sender, also those of other apps), reactions, edits, people joining, channels, pins, slash commands | being told when somebody needs you, an alert bot posts, a customer reacts; answering in a thread, with a reaction or a file |
| `matrix` | told | messages in the rooms of a Matrix account | Element rooms, bridges to other networks |
| `discord` | told | messages in the channels a bot can see | a server's channels, direct messages to the bot |
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

What should happen at a time is not a source but a schedule ([events.md](events.md),
"Schedules"). A `calendar` source reports that an entry was added or moved; "ten minutes
before it starts" is a schedule the agent sets when it is told of the entry.

### Looking again and again

`http`, `command`, `feed`, `calendar`, `modbus` and `presence` cannot be told when something
happens; they go and look. Three things hold for every source that does:

- **The first look is the starting point.** Setting a source up reports nothing. Only what is
  different at a later look does.
- **A look that finds nothing new costs nothing.** No event, nothing stored, no model woken.
  This is the difference to waking an agent every few minutes to check: an agent's turn is
  spent only when there is something to act on.
- **A failed look is not an event.** The pause before the next one doubles with each failure in
  a row, up to 15 minutes (or the source's own interval, if that is longer), and goes back to
  normal with the first look that works.

How a polling source is doing is said wherever sources are listed (`pine sources`, `/sources`,
the agent's `sources` tool): `last looked 14:02:11`, or `failing since 14:02:11 (4 looks): it
answered 503`, followed by what it found. What it found is repeated there only when it is a
number or a single word; anything longer is only counted, because that line is read by agents
without the mark that outside content gets.

Two looks of one source never run at the same time, and each waits a little shorter or longer
than its interval, so that sources set to the same interval do not all fire together.

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
| Slack | `slack` | An app in Socket Mode (through Slack's own SDK). Also the way to what other tools post into Slack: with `bots`, the messages of GitHub, PagerDuty or an alert bot are reported. |
| Discord | `discord` | A bot. |
| Matrix (Element) | `matrix` | An access token of an account. |
| Telegram | `telegram` | A bot, paired with your account. |
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

## How every type is used

Say what you want watched. The agent picks the type, pine shows you what the source will do,
and you confirm:

> Tell me on Telegram when pmndre/pine has a new release.

Or write the entry yourself, under `sources` in `pine.json` or in an agent's `agent.json`, with
the options of the type next to `type`, and subscribe an agent to it. Each type below has an
entry to copy.

What holds whatever the type is in [sources.md](sources.md): the keys every source has
("Configuring sources"), what all types have in common, subscribing and its filter `when`
("Being woken only for what counts"), how a password or token is kept ("Secrets"), what an
event looks like, and whose words an event counts as ("Trust").

## The types

### folder

A folder: reports every new or changed file once it has stopped growing.

```json
"scans": { "type": "folder", "dir": "~/Scans", "mask": "*.pdf" }
```

| Option | Default | |
|---|---|---|
| `dir` | | The folder. `~` and paths relative to the configuration file work. |
| `mask` | | Only files whose name matches, as in a shell: `*.pdf`, `*.{png,jpg}`, `report-??.csv`. Several are separated by commas. Capitals do not matter. |
| `pattern` | | Only files whose full path matches this regular expression, for what a mask cannot say (`/src/.*\\.ts$`). Capitals do not matter. |
| `ignore` | version control, dependencies, editor leftovers | Never files whose path matches this one. The default skips `.git`, `node_modules`, `.DS_Store`, build folders, and files ending in `~`, `.swp`, `.tmp`, `.part`. |
| `settle` | `"1.5s"` | How long a file must stay unchanged before it counts as complete. |
| `recursive` | `true` | Also folders inside it. |

Event `added`: `{ path, file, size, images? }`. For jpg, png, webp and gif under 10 MB the
picture is shown to the agent if its model can look at images.

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
| `publish` | none | Topics an agent may send to, to act on a device: `["zigbee2mqtt/+/set"]`. Without it the source only listens. See "Sending through a source" in [sources.md](sources.md). |
| `username`, `password`, `clientId` | | As the broker wants them. |
| `minInterval` | | Drop messages that follow the last one on the same topic sooner than this. Use it for devices that report every second. |
| `insecureTls` | `false` | Accept a certificate that cannot be verified, as devices with self-made ones need. |

Event `message`: `{ topic, value }`, where `value` is the parsed JSON, or the text.

The example is a Bambu printer in LAN mode: it is its own broker on port 8883, the user is
`bblp`, the password is the access code from the printer's screen.

### webhook

A web address other services can call: `POST http://<pine's control address>/hook/<name>`.

```json
"github": { "type": "webhook", "secret": "${GITHUB_HOOK_SECRET}", "description": "pushes and issues of my repositories" }
```

| Option | |
|---|---|
| `secret` | The caller proves itself with it: `Authorization: Bearer <secret>`, or a signature of the body (HMAC SHA-256 in `X-Hub-Signature-256` or `X-Signature`, as GitHub sends it). |
| `open` | `true` instead of a secret: accept anyone who can reach the port. Only for a port nobody else can reach. |

Event `received`: `{ body, headers }`. `body` is the parsed JSON, or `{ text }`. Of the headers
only a few that say what kind of request it is are kept (`content-type`, `user-agent`,
`x-github-event` and the like), never the secret.

The address has the source's name as it is in the event topics: `/hook/<name>` for a source in
`pine.json`, `/hook/<name>@<agent>` for one in an agent's own `agent.json` (which is where a
source that an agent sets up goes, unless it is for all agents).

It needs the control API (`http` in `pine.json`), which listens on `127.0.0.1` by default. A
service on the internet reaches it only through a tunnel or reverse proxy that you set up. While
nobody is subscribed the address answers "not found".

### ftp

An FTP drop: a small FTP server that accepts uploads and nothing else. For cameras, doorbells,
scanners and other devices whose way of sending a file is "upload to FTP server".

```json
"door": { "type": "ftp", "port": 2121, "user": "cam", "password": "${CAMERA_FTP_PASSWORD}", "allow": ["192.168.1.40"], "description": "pictures from the front door camera when it sees motion" }
```

| Option | Default | |
|---|---|---|
| `port`, `user`, `password` | | What you enter in the device. The password needs 8 characters or more. When an agent sets the source up, `user` is `device` unless you name one, and a password you do not give is made by pine. |
| `host` | `"0.0.0.0"` | The address to listen on. Devices on your network have to reach it. |
| `allow` | everyone | Only these clients: a full address (`"192.168.1.40"`), or a prefix that ends in a dot (`"192.168.2."`). |
| `pasvPorts` | any | `[from, to]`: the ports for data connections, if a firewall has to know them. |
| `maxFileMb` | `50` | Largest file accepted. |
| `keepDays` | `7` | Received files are deleted after this many days. |

Event `upload`: `{ file, path, size, from, images? }`. `file` is the name the device gave it,
`path` is where it lies now (`data/sources/<name>/files/`, or `data/sources/<name>@<agent>/files/`
for an agent's own source). A picture is shown to the agent with the event. A video or any
other file is not: the agent reads it from `path` (see "Files a source received" in
[sources.md](sources.md)).

It speaks plain FTP, as these devices do, so the password crosses your network unencrypted. It
only receives: nothing can be listed, read, changed or deleted through it, and every file lands
under a name of pine's choosing in the source's own folder. Set the device to passive mode.

### telegram

A Telegram bot: you write to it from wherever you are, and the agent that subscribed answers
there. It is how you reach your agents when you are away, and how they reach you.

> Watch Telegram. You are my assistant there, and what you want to tell me while I am away
> goes to that chat.

The agent calls `add_source`. The dialog you confirm has a field for the bot's token: you type
or paste it there, where it is not shown and does not pass through the agent or its model (see
"Secrets" in [sources.md](sources.md)). Then the agent tells you the one remaining step, which ties the bot to your account:

1. Open the bot in Telegram and write anything to it.
2. The bot answers that account with a six-digit code.
3. pine shows a question on your computer that names the account and has a field for the code.
   Type the code from your phone and press enter.

From then on that account is the only one the bot listens to. The code is the point: it shows
that the person at pine's keyboard holds that Telegram account. A stranger who finds the bot
can make the question appear, but does not see your screen, and you do not have their code; a
key pressed by accident cannot say yes. An account you deny is not put to you again, and only
one question is open at a time.

Anyone can write to a bot; that is how Telegram works. What they write reaches no agent. Before
you have paired, an unknown account gets the code message (and a line if the code that was
typed was wrong) and nothing else. After you have,
unknown accounts get no answer at all and cause no question.

```json
"telegram": { "type": "telegram", "token": "${PINE_SOURCE_TELEGRAM_MAIN_TOKEN}", "trust": "owner", "description": "my Telegram" }
```

| Option | Default | |
|---|---|---|
| `token` | | The bot's token. Create a bot by writing `/newbot` to @BotFather in Telegram; it answers with the token. Kept in `.env`. |
| `allow` | pairing | Telegram user ids that may talk to the bot, if you know yours. Without it the bot is paired as described above. With several ids, what the agent sends unasked and the approval requests go to the first. |
| `approvals` | `true` | Approval requests are also sent to that chat, with buttons to answer them: Allow, Deny and, where a yes can be remembered for the conversation, Always. A bot that is one agent's own carries that agent's requests and questions and no other agent's, and answers none of theirs; a bot for all agents carries every agent's. `/allow` and `/deny` work too (with the request's id when more than one is open). A question the agent asks with its `question` tool arrives the same way when it offers answers to pick from, with one button for each and one for "No answer"; an answer in your own words, and a question without answers to pick from, you type in the terminal UI. A request that needs a secret typed is never sent there. |
| `apiBase` | Telegram's | The address of a Bot API server of your own. |

Event `message`: `{ text, name, username, chatId, messageId, images? }`. A photo you send (up
to 10 MB) is shown to the model. The bot listens only in its private chat with you: what is
written in a group it was added to reaches no agent.

What an agent sends there, and its answers, are Markdown, and Telegram shows them formatted:
bold, italic, strikethrough, code and code blocks, quotes. A heading becomes a bold line, a list
bullets, a table monospace text. A link shows its address beside its text, since an answer can
repeat a page and a link's text can name another place than it goes to. Tags an agent writes
itself (HTML) are shown as text. Should Telegram refuse the formatting, the message is sent as
it was written. Approval requests and the pairing messages are plain text: they show exactly
what is asked.

What makes it different from the other types:

- **It is a conversation.** Your message reaches the agent as your message, not as a report
  about one, in the conversation that subscribed. The answer is sent back to the chat and is
  also in that conversation in the terminal UI, so both show the same thread.
- **It speaks for you.** Telegram vouches for the account and you proved it is yours, so what
  it writes counts as your own words: full tools, no "outside content" mark. That is why
  pairing takes a code and why the set-up is always put to you.
- **It can send.** The agent writes to you on its own with the `send` tool, with a picture or
  a video if it has one to show, and without a question to you; see "Sending through a
  source" in [sources.md](sources.md).
- **Messages are not held back.** The ten-second pause between events that protects a model from
  a chatty device does not apply unless the subscription sets a `throttle` itself.

Who the bot listens to is said wherever sources are listed: `pine sources`, `/sources` in the
terminal UI, and the agent's `sources` tool show "listens to nobody yet", or the account you
paired with its name and Telegram id. A bot never learns a phone number; the account's id is
what Telegram vouches for. To pair with another account, remove the source and set it up
again: the pairing goes with the source.

Messages are fetched by long polling: one request that Telegram answers the moment something
arrives. Nothing listens on a port, so it works behind any router. Only one program can poll a
bot at a time; a second one makes both miss messages.

### http

A web address that is looked at again and again. For what cannot call you: a price, a version,
a status page, a device on your network that has a state page.

> Watch https://shop.example/fridge-3000 and tell me when the price drops below 500.

```json
"price": { "type": "http", "url": "https://shop.example/fridge-3000", "match": "Price: ([0-9.,]+)", "every": "30m", "description": "the price of the fridge" }
```

| Option | Default | |
|---|---|---|
| `url` | | The address, `https://...` (`http://` for a device on the local network). |
| `every` | `"5m"` | How often to look. At least `"30s"` when an agent sets it up, and at least `"2m"` with `render`. |
| `path` | | For an answer in JSON: watch only this field, `"data.price"` or `"items.0.state"`. `path`, `values`, `match` and `select` are four ways to say what counts in the answer; a source takes one of them. |
| `match` | | For a page or text: watch only what this regular expression finds, its first group if it has one. It is looked for in what a reader of the page sees, then in the page's source. |
| `select` | | For a page: watch only the text of the first element this CSS selector matches, `".product .price"` or `"#stock > span"`. With `render` it is any selector a browser reads. |
| `attr` | | With `select`: the value of this attribute of the element instead of its text, `"content"` for a meta tag, `"data-price"`. |
| `render` | `false` | `true` for a page that a script fills in after loading: every look opens the page in pine's browser, without a window, and takes what a reader sees then. See "A page that a script fills in". Not together with `path`, `values`, `method`, `body`, `headers`, `token` or `tokenHeader`. |
| `values` | | For an answer in JSON: several fields at once, each under a name of your own: `{ "price": "data.price", "stock": "data.stock.count" }`. Twenty at most. |
| `method` | `"GET"` | `"POST"` for an address that is asked by sending something. Nothing else: a source only looks. |
| `body` | | With `POST`: what to send, as text. Sent as JSON when it is JSON. Not for secrets. |
| `headers` | | Headers to send, `{ "accept": "application/json" }`. Not for secrets. |
| `token` | | An access token or key, sent as `Authorization: Bearer <token>`. Kept in `.env`. |
| `tokenHeader` | | Send the token as this header instead, as it is: `"x-api-key"`, `"cookie"`. |
| `local` | `false` | The address is on your own network under a name that does not say so (`nas.home`, `ha.lan`). Not needed for an IP address, `localhost` or a `.local` name. |

| Event | | |
|---|---|---|
| `changed` | `{ url, value, previous, number?, previousNumber? }` | With `path`, `match` or `select`: the value now and before. |
| `changed` | `{ url, values, previous, changed }` | With `values`: all the fields now and before, and the names of those that differ. |
| `changed` | `{ url, added, removed, more? }` | Without: the lines that are new and the lines that are gone, up to 30 of each. |
| `down` | `{ url, error, looks }` | After three failed looks in a row, once. |
| `up` | `{ url }` | When it answers again. |

Without `path`, `values`, `match` or `select` the whole answer counts. For a page that is its text as a reader
sees it: scripts, styles and markup are left out, so a counter in a script does not report a
change at every look. A page that shows the time still does; give it a `match`.

#### One element of a page

`match` finds a value by the text around it; `select` finds it by where it stands in the page,
which holds better when the words around a price change with the language or the season:

```json
"fridge": { "type": "http", "url": "https://shop.example/fridge-3000", "select": ".product-detail .price", "every": "30m", "description": "the price of the fridge" }
```

A selector is made of tags (`span`), ids (`#total`), classes (`.price`), attributes (`[itemprop]`,
`[itemprop=price]`, also `~=`, `^=`, `$=`, `*=`), put together (`span.price`, `li.item.sale`) and
nested with a space (somewhere inside) or `>` (directly inside); a comma separates alternatives.
Nothing with a colon (`:first-child`, `:not(...)`) and no `+` or `~`: such a selector is refused
with what it takes instead. The first element in the page that matches counts. Many shops also
state the price for machines, which changes less often than the layout:

```json
"fridge": { "type": "http", "url": "https://shop.example/fridge-3000", "select": "meta[property=product:price:amount]", "attr": "content" }
```

The page is read as the server sends it. What a script fills in after loading is not
there: for such a page set `render`, or watch the address the script itself asks (see "A
page that a script fills in").

#### A page that a script fills in

Many pages arrive almost empty, and a script of the page then fetches the price or the state
and writes it in. A plain look reads the page as the server sends it, so it finds the
placeholder ("loading", an empty element, nothing at all) and never the value. With `render`
the look is made by a browser:

> The price on https://shop.example/fridge-3000 only shows up after the page has loaded. Watch
> it and tell me when it drops.

```json
"fridge": { "type": "http", "url": "https://shop.example/fridge-3000", "render": true, "select": ".product-detail .price", "every": "30m", "description": "the price of the fridge" }
```

At every look pine starts its browser (the one the browser tools use, which `pine init` and
`pine browser-install` fetch), without a window and with an empty profile, opens the address,
waits until the page has loaded and then until it has stopped asking for things (five seconds
at most), and takes what a reader sees. Then the browser is closed. What counts is chosen as
without `render`:

| With | What counts |
|---|---|
| `select` | The text of the first element the selector matches, as the browser shows it. The browser reads the selector, so everything CSS has works: `li:nth-child(2) .price`, `.offer:not(.sold-out)`, `h1 + p`. No element matches: the value is `null`. |
| `select` and `attr` | The value of that attribute of the element. |
| `match` | What the regular expression finds in the text a reader sees. The page's source is not looked at. |
| neither | The whole text of the page, line by line; an event names the lines that are new and gone. |

The events are the same, and an amount arrives as `number` as described below.

**What it costs.** A plain look is one request and takes a moment. A rendered look starts a
browser, runs the page's scripts and loads everything the page loads: a second or two and a
few hundred megabytes of memory while it lasts, at every look. So:

- `every` is at least `"2m"` when an agent sets the source up.
- Two browsers run at a time, for all sources together. A look that finds them busy waits.
- A look may take 45 seconds. After that it is ended and counts as failed.
- There is no "nothing new" answer (see below): the page is loaded in full each time.

**When the plain look is the better choice.** A script that fills a page in gets the value
from somewhere, usually an address that answers JSON. If you can find it (the network tab of
your browser's developer tools shows what the page asks), watch that address without `render`
and with `path`: it is faster, it can be asked every 30 seconds, a number arrives as a number,
it can take a `token`, and it does not break when the shop changes its layout. Use `render`
when there is no such address, when it cannot be asked from outside the page, or when what you
want is what the page shows.

**What does not go with it.** A set-up with one of these and `render` is refused, with the
reason:

| Option | Why not |
|---|---|
| `path`, `values` | They read an answer in JSON. There is no page to render. Leave `render` out. |
| `method`, `body` | A rendered page is asked the way a reader's browser asks it. |
| `headers`, `token`, `tokenHeader` | The browser would send them with every request the page makes, to every address the page loads from. So a page behind a login cannot be watched this way. |
| `local: true` | See below: a name that has to be looked up is not opened on your network. |

**What the page can reach.** The page's own scripts run in that browser, as they would in
yours, and the dialog you confirm says so. What they can reach is narrower than in yours:

- Every connection of that browser goes through the same guard as the browser tools'
  ([security.md](security.md)). The public internet is reachable. Your own network and this
  computer are not: not for the page, and not for anything the page loads or its scripts ask.
- One exception, which is the page itself: an address that says by itself that it is local
  (`localhost`, a `.local` name, an IP address in a private range) is opened, and the browser
  then reaches exactly that host and port and nothing else on your network. The dialog names
  it.
- A name that only turns out to be local when it is looked up (`nas.home`, `ha.lan`) is not
  opened with `render`, also not with `local: true`: what such a name points at can change,
  and a page's scripts would run there. Give the device by its IP address.
- pine's own control port is never opened.
- The look counts only if the browser ends up on the host that was set up. A page that sends
  it on to another host is a failed look that names the host.
- The browser keeps nothing from one look to the next (no cookies, no logins), downloads
  nothing, and grants the page no permission (camera, location, notifications). A window the
  page opens is closed.

What such a source reports is outside content, like everything an `http` source reports.

**When a look fails.** A failed look is retried with a growing pause, and `pine sources` shows
since when it fails and why; after three in a row the source reports `down`, and `up` when the
page opens again.

| The status says | What it means |
|---|---|
| `pine's browser is not installed on this computer` | Type `pine browser-install` into a terminal. `pine init` and `pine update` do it too. |
| `the page did not finish loading within 45 s` | The page is slow, or never finishes. |
| `"select" is not a CSS selector the browser can read` | The selector has a mistake in it. |
| `it sends on to <host>, which is not the address that was confirmed` | The page moved. Set the source up with the address it leads to, if that is the right one. |
| `<host> leads to an address on your own network` | The name points into your network. With `render` only an address that says so itself is opened there. |
| `it answered 403` (or another number) | The site turned the browser away. Some sites do that to a browser without a window. |
| `the browser could not load it (...)` | No connection, an invalid certificate, or the like; the words in brackets are the browser's. |

`found nothing with the selector` is not a failed look: the page opened and no element matched.
If the value is there in your own browser, the selector is wrong, or the page fills the
element in later than the look waits.

#### An amount as a number

A value that reads as a number or an amount, and nothing else, also arrives as `number` (and
the one before as `previousNumber`), so that a subscription can compare it:

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

The one case that can be read two ways is a single separator followed by exactly three digits,
and the last two rows are how it is decided. Where that is not what the page means, take the
digits apart with `match` (`"([0-9]+)[.,][0-9]{3} "`) and compare the text.

#### Several fields, and an address that is asked with POST

```json
"fridge": {
  "type": "http", "url": "https://shop.example/graphql", "method": "POST",
  "body": "{\"query\": \"{ product(id: 7) { price stock { count } } }\"}",
  "values": { "price": "data.product.price", "stock": "data.product.stock.count" },
  "every": "30m", "description": "price and stock of the fridge"
}
```

One event says which of the fields changed: `{ "values": { "price": 479, "stock": 3 },
"previous": { "price": 499, "stock": 3 }, "changed": ["price"] }`. A field that is not in the
answer is `null`. Since these are the values of the JSON itself, numbers are numbers and
`when` compares them directly: `{ "payload.values.stock": { "gt": 0 } }`.

A `POST` is for asking, and what it sends is shown to you in full before the source is set up:
a source repeats it on a clock, with nobody there.

#### Nothing new

An address that names a version of its answer (`ETag`, `Last-Modified`) is asked "anything new
since?" from the second look on, and answers with one line when there is not. That is a look
like any other, only cheaper for both sides. `feed` and `calendar` ask the same way. A look
with `render` loads the page in full every time.

#### Which addresses it asks

An address on your own network or this computer is said to be one in the dialog you confirm.
Any other address has to stay on the public internet: if its name one day leads into your
network, the look fails and says so instead of fetching from there.

A redirect is followed only on the same host. One that leads to another host is a failed look
that says where it leads: you confirmed one address, and the token is for that one. An answer
is read up to 1 MB. A key that is part of the address (`?apikey=...`) is not a secret to pine:
it is stored and shown like the rest of the address.

Refused when it is set up: a user name or password in the address, `path` and `match`
together, and a header that carries a secret (`authorization`, `cookie`), which belongs into
`token`. Also more than one of `path`, `values`, `match` and `select`; `attr` without
`select`; a selector that cannot be read; a `method` other than `GET` and `POST`; a `body`
without `POST` or longer than 20000 characters; `values` that are empty, more than twenty, or
under a name that is not a plain word. One look may take 20 seconds and follow five redirects.

### command

A command that is run again and again. For what only a command can tell: free disk space, a
build, a branch that moved, the end of a log, whether a machine answers.
A command that keeps running and prints a line whenever something happens is followed instead
of run again and again: see "Following a command that keeps running" below.

> Tell me when the disk is more than 90% full.

```json
"disk": { "type": "command", "run": "df -h /", "match": "([0-9]+)%", "every": "10m", "description": "how full the disk is" }
```

| Option | Default | |
|---|---|---|
| `run` | | The command line. bash runs it from the workspace of the agent the source belongs to. |
| `every` | `"1m"` | How often. At least `"5s"` when an agent sets it up. |
| `match` | | Watch only what this regular expression finds in what the command prints. |
| `timeout` | `"30s"` | How long one run may take before it is stopped. |

Event `changed`: `{ command, code, previousCode?, value, previous }` with `match`, or
`{ command, code, previousCode?, added, removed, more? }` without. `code` is the exit code;
`previousCode` is there when it changed, so `test -f build/done` or `ping -c1 nas` report by
how they end.

The command runs **like a command in the shell of an agent in `safe` mode**: in the
agent's sandbox, with its private home folder and without your environment, also for an agent
that works in `auto` mode and has your whole account in your conversations (nobody is there to answer for what a
command on a clock does). It reaches the agent's own folders and nothing else: no network
unless `sandbox.network` is set, none of your home folder beyond `sandbox.read`, none of
pine's files. A source of all agents runs as the main agent. You are shown the
command line before it is set up, every time. A command that cannot be started or runs out of
time is a failed look (see "Looking again and again"), not an event. `timeout` is at least `"1s"`, and a command
line of more than 2000 characters is refused (put it into a script). The command always runs in
the agent's sandbox, whatever its mode: on a machine without a sandbox a `command` source does
not run, its status says so, and `pine check` names it.

#### Following a command that keeps running

Some commands tell by themselves when something happens: `tail -F` a log, `log stream`,
`docker events`, `kubectl get pods -w`, the client of a broker or a database. With `follow`
the command is started once and kept running, and every line it prints is an event as it
comes. This is the type for every protocol that has a command line client and no source type
of its own.

> Tell me when the backup log says ERROR.

```json
"backup": { "type": "command", "run": "tail -n 0 -F ~/Library/Logs/backup.log", "follow": true, "match": "ERROR (.*)", "description": "errors in the backup log" }
```

| Option | Default | |
|---|---|---|
| `follow` | `false` | `true`: start the command once, keep it running, report each line it prints. `every` and `timeout` are refused with it. |
| `perMinute` | `30` | With `follow`: report at most this many lines a minute, 1 to 600. The rest are counted, and the next line that is reported carries the count as `dropped`. |
| `match` | | With `follow`: only lines in which this regular expression finds something. Its first group is the line's `value`. |

| Event | | |
|---|---|---|
| `line` | `{ command, line, value?, dropped? }` | One line the command printed. `value` is what `match` found, or the parsed line when it is JSON. |
| `ended` | `{ command, code?, error?, ran }` | The command ended (`ran`: after how many seconds, `error`: the end of what it wrote as errors). It is started again, after a pause that grows while it keeps ending at once. A command that ends the moment it is started is reported once, not at every try. |

| What to follow | `run` |
|---|---|
| A log file | `tail -n 0 -F /path/app.log` (`-n 0`: only what is written from now on; `-F`: also after the file was rotated) |
| The Mac's own log | `log stream --style ndjson --predicate 'subsystem == "com.apple.TimeMachine"'` |
| Docker | `docker events --format '{{json .}}'` |
| Kubernetes | `kubectl get pods -w -o json`, `kubectl get events -w` |
| systemd's journal, on another machine | `ssh nas journalctl -f -p warning -o json` |
| PostgreSQL `LISTEN` | a few lines of script around a client library that print each notification as a line |
| Redis | `redis-cli --raw subscribe alerts` |
| NATS, Kafka, RabbitMQ | `nats sub 'orders.>'`, `kcat -C -b broker -t topic -o end`, `amqp-consume -q queue cat` |
| A folder on another machine | `ssh nas inotifywait -m -e close_write /volume1/scans` |

A line is cleaned of the color codes a terminal would act on and cut at 2000 characters; a
line that is JSON also arrives parsed, so a subscription's `when` can look into it
(`{"payload.value.status": "die"}` for a container that stopped).

The command runs in the same sandbox as one that is run again and again: the agent's own, as
in `safe` mode. That is why most of the examples above need something from you first: the log
file has to be readable by the agent (`sandbox.read`), and a client that talks to the network
needs `sandbox.network`. The dialog shows the command line, and that it will keep running.

On Linux `follow` is refused. The sandbox there cannot forbid a running command to make a file
that is read as instructions; pine takes such a file away after a command has ended, and a
followed command does not end. Run it again and again instead (`every`, with a `match`), or
have the command's lines sent to a `syslog` or `webhook` source.

When the source stops (the last subscriber left, or pine stops), the command and everything
it started is ended with it.

### feed

A feed that is read again and again: each entry that was not there before is one event. For
everything that publishes itself as RSS or Atom, which is more than it looks like: releases,
blogs, video channels, podcasts, searches, status pages.

> Tell me when a new version of Node comes out.

```json
"node": { "type": "feed", "url": "https://github.com/nodejs/node/releases.atom", "every": "1h", "description": "releases of Node.js" }
```

| Option | Default | |
|---|---|---|
| `url` | | The address of the feed itself, `https://...`. Not the web page that links to it. |
| `every` | `"15m"` | How often to read it. At least `"1m"` when an agent sets it up. |
| `match` | | Only entries whose title or text this regular expression finds: `"security\|CVE"`, `"^v[0-9]+\\.0"`. The others are passed over without a word. |
| `headers` | | Headers to send. Not for secrets. |
| `token` | | An access token or key, sent as `Authorization: Bearer <token>`. Kept in `.env`. |
| `tokenHeader` | | Send the token as this header instead, as it is: `"x-api-key"`. |
| `local` | `false` | The address is on your own network under a name that does not say so. Not needed for an IP address, `localhost` or a `.local` name. |

| Event | | |
|---|---|---|
| `entry` | `{ feed, title, link, id, published?, author?, summary, media?, more? }` | One for each new entry. `feed` is the feed's title, `summary` the entry's text as a reader sees it (up to 1500 characters), `published` a time in UTC, `media` the sound or video file of a podcast episode. |

The entries that are in the feed when the source is set up are the starting point and are not
reported. After that every look reports what is new, oldest first, ten entries at most: when
there were more (a feed that was moved, a week without power), the newest ten are reported and
the last one carries `more`, the number that was left out. An entry is known by its id (`guid`
in RSS, `id` in Atom), else by its link, else by its title and date. One that leaves the feed
and comes back is not new: the last 500 that left are remembered.

It reads RSS 2.0, RSS 1.0, Atom and JSON Feed. A feed that can say "nothing new since you last
asked" is asked that way, so a look at a quiet feed costs it one line.

| What it is for | The feed's address |
|---|---|
| Releases of a project on GitHub | `https://github.com/<owner>/<repo>/releases.atom` |
| Commits on a branch on GitHub | `https://github.com/<owner>/<repo>/commits/<branch>.atom` |
| Tags on GitHub | `https://github.com/<owner>/<repo>/tags.atom` |
| A YouTube channel | `https://www.youtube.com/feeds/videos.xml?channel_id=<id>` (the id starts with `UC`; a playlist: `?playlist_id=<id>`) |
| A blog | Usually `/feed`, `/rss.xml`, `/atom.xml` or `/index.xml` on the blog's address. The page names it in a `<link rel="alternate">` tag. |
| A podcast | The address a podcast directory shows as "RSS feed". The episode's file is in `media`. |
| arXiv | `https://export.arxiv.org/rss/<category>`, e.g. `cs.AI`. It has entries on working days only. |
| A subreddit, a Reddit search | `https://www.reddit.com/r/<name>/.rss`, `https://www.reddit.com/search.rss?q=<words>` |
| Hacker News | `https://hnrss.org/frontpage`, `https://hnrss.org/newest?q=<words>` (stories that mention the words), `https://hnrss.org/newest?points=300` |
| A status page | Most have `/history.atom` or `/history.rss` (GitHub: `https://www.githubstatus.com/history.atom`). |
| A Mastodon account | `https://<instance>/@<name>.rss` |
| Weather warnings, earthquakes, court decisions, job boards, classifieds | Whatever the site offers as RSS or Atom. Many searches have a feed of their own results. |

With a pattern the agent is woken only for what your owner cares about, without a model
reading the rest:

```json
"cves": { "type": "feed", "url": "https://hnrss.org/newest?points=100", "match": "(?i:postgres|sqlite)", "description": "stories about databases on Hacker News" }
```

What it says where sources are listed is a count (`now: 25 entries`), never a title: that line
is read by agents without the mark that outside content gets.

Refused when it is set up: an address that is not `http(s)`, a user name or password in the
address, a header that carries a secret (it belongs into `token`), a `match` that is not a
regular expression. A failed look and not an event: an address that answers with a web page
instead of a feed (the page is not searched for its feed; set the source up with the feed's own
address, or watch the page with an `http` source), and a redirect to another host. An answer is
read up to 1 MB, which for a long feed is its newest entries. Like every source that looks, it
follows the rules under "Looking again and again".

### calendar

A calendar that is read again and again: reports the entries that were added, changed or
removed. For any calendar that has an address of its own in iCalendar format (`.ics`), which
nearly every calendar service can give you: a shared family calendar, a team's, a school's, a
club's fixtures, the waste collection.

> Keep an eye on the family calendar and tell me when somebody adds or moves something this month.

```json
"family": { "type": "calendar", "url": "https://calendar.google.com/calendar/ical/.../basic.ics", "ahead": "30d", "description": "the family calendar" }
```

| Option | Default | |
|---|---|---|
| `url` | | The calendar's address in iCalendar format, `https://...` or `webcal://...` (which is the same address, read over https). |
| `every` | `"15m"` | How often to read it. At least `"1m"` when an agent sets it up. |
| `ahead` | `"60d"` | Only entries that begin within this from now. What is added further away is not reported, also not later when it comes nearer. At least `"1h"`. |
| `headers` | | Headers to send. Not for secrets. |
| `token` | | An access token or key, sent as `Authorization: Bearer <token>`. Kept in `.env`. |
| `tokenHeader` | | Send the token as this header instead, as it is. |
| `local` | `false` | The address is on your own network under a name that does not say so (a Nextcloud at `cloud.home`). |

| Event | | |
|---|---|---|
| `added` | `{ calendar, uid, summary, start, end?, allDay?, zone?, location?, description?, repeats? }` | An entry that was not in the calendar at the last look. |
| `changed` | the same, with `was: { summary, start, end?, location? }` | Its title, its time or its place is different. A new description alone is not reported. |
| `removed` | `{ calendar, uid, summary, start }` | An entry that was still ahead is gone, or was cancelled. |

How a time is written says what kind it is:

| `start` | Means |
|---|---|
| `2026-12-24T17:00:00Z` | A moment in UTC. |
| `2026-12-24T18:00:00` with `zone: "Europe/Berlin"` | That time on the clocks of that zone. |
| `2026-12-24T18:00:00` without `zone` | That time wherever the reader is ("floating"). |
| `2026-12-24` with `allDay: true` | The whole day. `end` is then the last day, and is left out for a single day. |

**It reports changes to the calendar and never fires on a clock.** That an entry begins in ten
minutes is not an event of this source. What should happen at a time is a schedule: an agent
that is to remind you before an appointment adds one when the entry is reported (`add_schedule`
with `at`), and removes it when the entry is reported `removed`. In the same way an entry that
has simply passed is not `removed`: it leaves without a word.

A repeating entry is one entry. It is not unfolded into its dates: `repeats` carries its rule
as the calendar writes it (`FREQ=WEEKLY;BYDAY=MO`), and it counts as inside `ahead` for as long
as it runs. One date of it that was moved is an entry of its own with the same `uid`.

The entries that are in the calendar when the source is set up are the starting point. One look
reports twenty changes at most, earliest first; the last one carries `more` when there were
more (a calendar that was emptied and filled again).

| What it is for | Where its address is |
|---|---|
| Google Calendar | Settings of the calendar, "Integrate calendar", "Secret address in iCal format". Google refreshes that file only every few hours. |
| iCloud | Share the calendar as a "Public Calendar" and copy the link (`webcal://...`). |
| Outlook, Microsoft 365 | Settings, "Shared calendars", "Publish a calendar", the ICS link. |
| Nextcloud | The calendar's menu, "Copy subscription link" (add `?export` to a share link). |
| Fastmail, Proton, Zoho and others | The calendar's sharing settings, as "iCal", "ICS" or "subscription" link. |
| Schools, clubs, leagues, public holidays, waste collection, cinema and concert programmes | A "subscribe" or "add to calendar" link on their site. |

A secret address like Google's is a key in itself, and pine does not treat it as one: it is
stored and shown like any address. Give such a link only where you would give the calendar.

Refused when it is set up: an address that is not `https://`, `http://` or `webcal://`, a user
name or password in the address, a header that carries a secret, `ahead` under an hour. A
failed look and not an event: an answer that is not a calendar (a web page with a "subscribe"
button is not one), a redirect to another host, and a calendar of more than 8 MB, which is not
read in part because half a calendar would make the other half look removed. A zone under a
name only the program that wrote the calendar knows (`W. Europe Standard Time`) is read as this
computer's own zone. Like every source that looks, it follows the rules under "Looking again
and again".

### stream

A service that pushes: pine connects to it once, stays connected, and the service says by
itself when something happens. Two ways of doing that are understood: Server-Sent Events (one
long answer to a web request, `https://`) and a WebSocket (`wss://`). For what would otherwise
have to be asked again and again, and for the many services whose only way out is such a
stream.

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
| `url` | | The address of the stream: `https://...` for Server-Sent Events, `wss://...` for a WebSocket. `http://` and `ws://` only for an address on your own network or this computer. |
| `kind` | by the address | `"sse"` or `"websocket"`. Only needed for a WebSocket that is given as an `https://` address. |
| `hello` | | For a WebSocket: what is sent right after connecting, to log in or to say what is wanted. One message or a list; each is a text or a JSON object. `{{token}}` in it is replaced by the token, so the token itself is never in the configuration. |
| `token` | | An access token or key, sent as `Authorization: Bearer <token>` when connecting. Kept in `.env`. When `hello` says `{{token}}`, it goes there and is not sent as a header as well. |
| `tokenHeader` | | Send the token as this header instead, as it is: `"x-gotify-key"`, `"x-api-key"`. |
| `headers` | | Headers to send when connecting. Not for secrets. |
| `event` | | For Server-Sent Events: only events of this name (`"notification"`). Without it every event counts. |
| `path` | | For messages in JSON: take only this field of each, `"event.data.new_state.state"` or `"data.0.last"`. A message that does not have it is left out. |
| `match` | | Only messages this regular expression finds something in (in the field, if `path` is given). If it has a group, what the group finds is the value; without a group it only says which messages count. |
| `changed` | `false` | Report a value only when it differs from the last one. The first value is the starting point and is not reported. For a stream that repeats a state. |
| `perMinute` | `30` | At most this many reports a minute, 1 to 600. What comes on top is dropped and counted. |
| `local` | `false` | The address is on your own network under a name that does not say so (`ha.lan`). Not needed for an IP address, `localhost` or a `.local` name. |

| Event | | |
|---|---|---|
| `message` | `{ value, event?, id?, previous?, dropped? }` | One message of the service. `value` is the parsed JSON, or the text, or what `path` and `match` picked, cut to 4000 characters. `event` and `id` are what Server-Sent Events call them; `previous` comes with `changed`; `dropped` says how many messages the cap left out before this one. |
| `down` | `{ url, error }` | After three attempts in a row that did not connect, once. |
| `up` | `{ url }` | When it is connected again. |

It reports what the service sends from the moment it is connected: nothing that was sent
before, and nothing that was sent while it was not connected, unless the service itself makes
up for that (Server-Sent Events can: pine says which event was the last it got, as
`Last-Event-ID`, when it connects again).

**Staying connected.** A connection that ends is made again: after a second, then after two,
four and so on up to five minutes, and from a second again once a connection has lasted. A
service on this computer is asked again sooner. A hang-up that is mended this way is not an
event; only three failed attempts in a row are (`down`). Where the sources are listed the line
says `connected since 14:02:11`, or `cannot connect since 14:02:11 (4 attempts): it answered
503`. A WebSocket is pinged every 45 seconds so that a line that died without a word is
noticed; an event stream that says nothing for five minutes is connected to again.

**Not too much.** A stream can say a great deal. `path`, `match`, `event` and `changed` decide
what counts; `perMinute` is the limit for what is left. Neither a filter nor the cap costs a
model turn: only a reported message wakes the agent, and the subscription's own `throttle`
applies on top.

An address that is not on your own network has to be `https://` or `wss://`, and has to stay
on the public internet: a name that leads into your network is refused, with a sentence that
says so. A redirect is followed only on the same host, and the token is sent to that host
only. Refused when it is set up: a user name or password in the address, a header that
carries a secret (`authorization`, `cookie`; it belongs into `token`), `hello` for
Server-Sent Events, `event` for a WebSocket. One message may be 256 KB long; longer ones are
left out.

#### What a stream reaches

Each line is an entry for `"sources"`; an agent sets the same up with `add_source` (type
`stream`), and is asked for nothing but the token.

| Service | Entry | What arrives |
|---|---|---|
| ntfy (a topic on ntfy.sh or your own server) | `{ "type": "stream", "url": "https://ntfy.sh/my-topic/sse", "event": "message", "path": "message" }` | The text of every notification on the topic. Without `path`: title, priority, tags as well. A protected topic takes a `token`. |
| Gotify | `{ "type": "stream", "url": "wss://gotify.example.com/stream", "token": "${GOTIFY_CLIENT_TOKEN}", "tokenHeader": "x-gotify-key" }` | Every message of the server: `{ title, message, priority, appid }`. |
| Home Assistant | the example above | The new state of one entity. With `{ "id": 1, "type": "subscribe_events", "event_type": "state_changed" }` in `hello` instead: every state change of the house, which wants a `match` and a low `perMinute`. The token is a long-lived access token from your profile page. |
| signal-cli (Signal messages on this machine) | `{ "type": "stream", "url": "http://127.0.0.1:8080/api/v1/events", "event": "receive", "path": "envelope" }` | Each Signal message the account gets, for `signal-cli daemon --http 127.0.0.1:8080`. |
| Mastodon | `{ "type": "stream", "url": "https://mastodon.social/api/v1/streaming/user", "event": "notification", "token": "${MASTODON_TOKEN}" }` | Mentions, boosts, follows. Use the streaming address your instance names: a redirect to another host is not followed. |
| Bluesky (Jetstream) | `{ "type": "stream", "url": "wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post&wantedDids=did:plc:...", "path": "commit.record.text" }` | What one account posts. |
| A webhook relay (smee.io) | `{ "type": "stream", "url": "https://smee.io/your-channel", "path": "body" }` | Webhooks for a machine that has no public address: GitHub, Stripe and the like call the relay, and pine reads them from it. Whoever knows the channel's address can write to it, so treat it like any outside content. |
| A ticker of an exchange (Kraken) | `{ "type": "stream", "url": "wss://ws.kraken.com/v2", "hello": { "method": "subscribe", "params": { "channel": "ticker", "symbol": ["BTC/EUR"] } }, "path": "data.0.last", "changed": true, "perMinute": 2 }` | The last price, at most twice a minute. With `when` on the subscription: only below or above a number. |
| A Nostr relay | `{ "type": "stream", "url": "wss://relay.damus.io", "hello": [["REQ", "pine", { "kinds": [1], "authors": ["<public key in hex>"] }]], "path": "2.content" }` | The notes of one author. (`hello` is a list of messages, and a Nostr message is itself a list.) |
| Wikimedia's public event stream, to try it | `{ "type": "stream", "url": "https://stream.wikimedia.org/v2/stream/recentchange", "path": "title", "perMinute": 2 }` | The title of a page somebody just edited, twice a minute, with `dropped` saying how many edits were left out. |

A page an agent makes for its owner to click in is listened to this way too: the page's own
small server offers what is pressed as an event stream on this computer
([interfaces.md](interfaces.md)).

What has no stream of its own but can call a web address is a `webhook` source; what can only
be asked is an `http` source; what has a command that prints as things happen (`tail -f`,
`docker events`) is a `command` source.

### mail

A mailbox: reports every new mail the moment the mail server says there is one, with its text
and the files that came with it. It reads over IMAP and only reads: nothing is marked as read,
moved or deleted, so your mail program shows the same as before.

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
| `host` | | The IMAP server, by name alone: `imap.gmail.com`. No `imap://`, no port, no path. Needed, except with `signIn`. |
| `user` | | The user name of the mailbox, usually the e-mail address. |
| `password` | | The password. Kept in `.env`. Most providers want an app password made for this, see the table below. An agent that sets a mailbox up leaves it out, and pine asks you for it. Not used with `signIn`. |
| `signIn` | | `"microsoft"`: no password. You sign in at Microsoft in your browser, once, with a code pine shows you. For Outlook.com, Hotmail, Live and Microsoft 365, which take no password over IMAP. See "A Microsoft mailbox" below. |
| `clientId` | | With `signIn`: the Application (client) ID of an app you registered at Microsoft. Not a secret. |
| `tenant` | `"common"` | With `signIn`: whose accounts the app signs in. `"common"`: any. `"consumers"`: private accounts. `"organizations"`: work and school accounts. Or the domain or id of one organisation. |
| `port` | `993` | `143` with `security` `"starttls"` or `"none"`. |
| `security` | `"tls"` | `"tls"`: encrypted from the start. `"starttls"`: encrypted after connecting. `"none"`: only for a server on this computer or your own network. |
| `mailbox` | `"INBOX"` | The folder to watch, as the server names it. |
| `from` | everyone | Only mail that says it is from one of these: an address (`"bank@example.com"`) or a whole domain (`"@example.com"`). |
| `subject` | | Only mail whose subject this regular expression finds. Capitals do not matter. |
| `maxMb` | `10` | Attachments are kept up to this size (50 at most). A larger one is named in the event, without a file. |
| `keepDays` | `7` | Kept attachments are deleted after this many days. |
| `smtpHost` | | For sending: the provider's SMTP server. Only together with `sendTo`. |
| `smtpPort` | `465` | `465` is encrypted from the start; any other port (`587`) uses STARTTLS. |
| `sendTo` | none | The addresses an agent may write to: `["me@example.com"]`. Without it the source only reads. |
| `sender` | `user` | The address mail is sent as. |
| `insecureTls` | `false` | Accept a certificate that cannot be verified, as a server of your own with a self-made one needs. |
| `local` | `false` | The server is on your own network or this computer under a name that does not say so (`mail.home`). Not needed for an IP address, `localhost` or a `.local` name. |

| Event | | |
|---|---|---|
| `mail` | `{ from, fromName?, to, subject, date?, text, attachments, images?, cut? }` | One for every new mail that passes `from` and `subject`. `text` is the plain text, or for a mail that is only HTML what a reader sees of it, up to 6000 characters. `attachments` is a list of `{ file, path?, type, size }`: `file` is the name the mail gave it, `path` where pine put it. A file without a `path` was larger than `maxMb`. `cut` says that the mail was larger than what is fetched of one. |

Pictures among the attachments (jpg, png, webp, gif under 10 MB, four at most) are shown to
the agent if its model can look at images. The files lie in the source's own folder under
names pine makes, and the agents subscribed to the source can read them there (see "Files a
source received"); to keep one, the agent copies it into its workspace.

**The mail that is in the mailbox when the source first connects is the starting point** and is
not reported. From then on every new one is, also what arrived while pine was not running or
the connection was down: the source remembers the last mail it reported, not a time. If more
than 200 mails arrived meanwhile, the oldest of them are left out.

**Who a mail says it is from can be forged.** The sender line is what the sender wrote, and
anyone can write any address there. So a mail is always outside content, whoever it claims to
come from: it wakes the agent the way a web page it read would, and after it the agent asks
before it sends anything out. `from` is a filter that keeps noise away, not a proof, and there
is no way to make a mailbox speak for you (`trust: "owner"` on a mailbox would hand your agent
to whoever knows your address; pine does not stop you writing it into the file, and
`pine check` names it under its security notes).

| Provider | `host` | `smtpHost` | The password |
|---|---|---|---|
| Gmail, Google Workspace | `imap.gmail.com` | `smtp.gmail.com` | An app password (Google account, Security, 2-Step Verification, App passwords). The account's own is refused. |
| iCloud Mail | `imap.mail.me.com` | `smtp.mail.me.com`, `smtpPort` 587 | An app-specific password from account.apple.com. |
| Fastmail | `imap.fastmail.com` | `smtp.fastmail.com` | An app password (Settings, Privacy & Security, Integrations) with IMAP, and SMTP if it sends. |
| GMX, WEB.DE, mailbox.org, Posteo | `imap.gmx.net`, `imap.web.de`, `imap.mailbox.org`, `posteo.de` | `mail.gmx.net`, `smtp.web.de`, `smtp.mailbox.org`, `posteo.de` | The account's password; at GMX and WEB.DE, IMAP has to be switched on in the settings first. |
| A server of your own (Dovecot, Mailcow, Synology MailPlus) | its name | its name | The mailbox's password. On your own network: `"local": true` if the name does not say so, `insecureTls` for a self-made certificate. |
| Proton Mail | `127.0.0.1`, `port` 1143, `security` `"starttls"`, `insecureTls` | `127.0.0.1`, `smtpPort` 1025 | Through Proton's Bridge running on this machine, with the password the Bridge shows. |
| Outlook.com, Hotmail, Live, Microsoft 365 | filled in: `outlook.office365.com` | filled in: `smtp.office365.com`, port 587 | None: Microsoft takes no password over IMAP any more. `"signIn": "microsoft"` and a `clientId`, see "A Microsoft mailbox" below. |

#### A Microsoft mailbox: signing in instead of a password

Outlook.com, Hotmail, Live and Microsoft 365 mailboxes take no password over IMAP. For these
you sign in at Microsoft yourself, and Microsoft gives pine a sign-in for that one mailbox:

> Watch my Outlook mailbox me@outlook.com and tell me when the school writes.

```json
"outlook": {
  "type": "mail", "user": "me@outlook.com", "signIn": "microsoft",
  "clientId": "11111111-2222-3333-4444-555555555555", "tenant": "consumers",
  "from": ["@school.example"], "description": "mail from the school"
}
```

What happens when the source starts for the first time:

1. pine asks Microsoft for a code and shows you a dialog: "Open
   https://microsoft.com/devicelogin in your browser, enter the code ABCD-EFGH, and sign in as
   me@outlook.com". The same is in the source's status line (`pine sources`), so you find the
   code again if the dialog is gone.
2. You open that page on any device, enter the code and sign in the way you always do, with
   your password and second factor. Microsoft shows what the app asks for: reading the mailbox
   over IMAP, and sending if the source has `sendTo`.
3. pine notices by itself that you have signed in, closes the dialog and connects. You have
   about fifteen minutes; "no" in the dialog gives up.

pine never sees your password. What Microsoft hands over lets pine open that mailbox, is
renewed by pine whenever it connects, without asking you, and is kept in pine's own database
in its home folder, where no agent reads. You are asked again only when Microsoft no longer
takes it: after you signed the app out, changed your password, or the source was not used for
about ninety days. You take the access away at Microsoft (account.microsoft.com, Privacy,
"Apps and services you've given access to"; for a work account myapps.microsoft.com) or by
removing the source, which deletes what pine kept.

`clientId` names an app that you register at Microsoft, once, for free. pine does not ship
one of its own: an app id says who is asking for your mail, and that should be you.

| Step | Where |
|---|---|
| Register an app | entra.microsoft.com, "App registrations", "New registration". Any name ("pine mail"). Supported account types: the choice that includes personal Microsoft accounts if the mailbox is a private one. No redirect address. |
| Copy its id | The app's "Overview" page: "Application (client) ID". That is `clientId`. |
| Allow signing in with a code | "Authentication", "Allow public client flows": Yes. Without it Microsoft refuses to give a code. |
| Allow reading mail | "API permissions", "Add a permission", "APIs my organization uses", "Office 365 Exchange Online", "Delegated permissions": `IMAP.AccessAsUser.All`, and `SMTP.Send` if the source sends. For a private account the question at sign-in is enough; in an organisation an administrator may have to agree. |

`tenant` has to fit how the app was registered: `"consumers"` for an app that is only for
private accounts, the organisation's domain for one that is only for that organisation,
`"common"` (the default) for one that takes both.

In an organisation two settings of the mailbox can stand in the way, and the status line says
which: IMAP switched off for the mailbox, and for sending "Authenticated SMTP" switched off
(Microsoft 365 admin center, the user, "Mail", "Manage email apps"). An organisation that
forbids apps its users registered themselves cannot be reached this way at all.

Refused when it is set up: `signIn` other than `"microsoft"`, `signIn` without a `clientId` or
together with a `password`, `clientId` or `tenant` without `signIn`. A wrong `clientId` or
`tenant` is found out when the source starts, and is why it is not running.

This follows Microsoft's device code flow and the XOAUTH2 login of IMAP and SMTP, and is
tested against stand-ins for all three. The steps in the table are from Microsoft's
documentation; the names of the pages there change now and then.

Gmail has no sign-in of this kind for mail (its device sign-in does not cover the mailbox);
an app password works there, also for a Google Workspace account unless its administrator
turned app passwords off.

**Sending.** With `smtpHost` and `sendTo` an agent can write an e-mail through the source:
`{"to": "me@example.com", "subject": "...", "text": "..."}` with its `send` tool. It reaches
the addresses on `sendTo` and nobody else; the type checks that itself, whatever a call names.
With one address on the list, `to` can be left out. Mail can reach anybody, so unlike a
Telegram message to you it counts as information leaving: after outside content the agent asks
before it sends (see "Sending through a source" in [sources.md](sources.md)). The text goes as plain text; no files.

Refused when it is set up: a `host` with a scheme, port or path in it, `"security": "none"` for
a server that is not local, a `from` entry that is neither an address nor `@domain`, `sendTo`
without `smtpHost` and the other way round, `maxMb` above 50. A server on the public internet
has to stay there: if its name one day leads into your network the connection fails and says
so. A password is never sent unencrypted to a server that is not local, when reading and when
sending.

A refused login (a wrong password, a mailbox that does not exist) is why the source is not
running, shown where sources are listed; fix it and subscribe again or restart. A server that
cannot be reached right now is tried again, after one second at first and up to five minutes
between tries, and the status line says since when. It waits with IMAP IDLE, renewed every 25
minutes; a server without IDLE is asked once a minute. Folder names with other than plain
letters are written as the server spells them (`"INBOX.Rechnungen"`, `"[Gmail]/All Mail"`).

### slack

A Slack workspace: reports what is written in channels and in direct messages, all of it or
only what mentions somebody, contains a word, or comes from certain people, and if you ask
for it also reactions, edits, who joins and leaves, changes to channels, pins, the slash
commands of your app, and what other apps post (alerts, GitHub). An agent can answer through
it: post to the channels and people you list, put an emoji on a message, send a file. It uses
Slack's Socket Mode: your Slack app connects out to Slack and is told what happens where it
may look. Nothing listens on a port, so it works behind any router. The connection and every
call are made with Slack's own SDK.

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

The four things most people want, each with the one setting it takes. They need a **user
token** (see "Making the Slack app"), because they are about what is written to you:

| You want to know when | Set | The event says |
|---|---|---|
| somebody writes, anywhere you are | nothing: this is what it does without filters | `why: ["channel"]`, or `["dm"]` |
| somebody writes to you personally | nothing (`dms` is on) | `kind: "dm"`, `why: ["dm"]` |
| somebody tags you | `"mentions": ["me"]` | `why: ["mention"]`, `mention`: your id |
| somebody writes about a topic | `"keywords": ["invoice", "outage"]` | `why: ["keyword"]`, `keyword`: the word |

With `mentions` or `keywords` set, a message in a channel counts only when one of them is
found; a direct message always counts. So `"mentions": ["me"], "keywords": ["outage"]` is
"what is written to me, what tags me, and what is about an outage", and nothing else. A
message that is several of these says so (`why: ["dm", "mention"]`), and a subscription can
be woken for some and not for others:

```json
"subscribe": [{ "source": "work", "when": { "payload.why": { "contains": "mention" } }, "note": "Somebody tagged me: tell me on Telegram, with who and where." }]
```

What you write yourself is never reported to you.

| Option | Default | |
|---|---|---|
| `appToken` | | The app-level token of your Slack app (`xapp-...`), with the scope `connections:write`. Socket Mode connects with it. Kept in `.env`. |
| `token` | | A bot token (`xoxb-...`) or a user token (`xoxp-...`) of the same app. With it people and channels have names in the events, a channel can be given by its name, `"me"` is known, the files of a message are fetched, and things can be sent. Without it events carry ids only and the source only listens. Kept in `.env`. An agent that sets a source up leaves it out, and pine asks you for it. |
| `events` | `["message"]` | Which kinds of thing are reported: `"message"`, `"reaction"`, `"edit"`, `"member"`, `"channel"`, `"pin"`, `"command"`, `"other"`. See "The kinds of event". A kind that is not listed is not reported. |
| `channels` | every channel the app sees | Only these channels, by name (`"ops"`, `"#ops"`) or by id (`"C0123ABCD"`; a private channel's starts with `G` or `C`). A name is looked up when the source starts and needs `token`. |
| `mentions` | | Only messages that mention one of these: user ids, `"me"`, `"here"`, `"channel"`, `"everyone"` (somebody wrote @here, @channel, @everyone), or the id of a user group (`S...`). |
| `keywords` | | Only messages that contain one of these words. Capitals do not matter. |
| `from` | | User ids whose messages always count, in any channel and whatever they say. An app's id (`B...`) is taken too. `"me"` here has your own messages reported, which they are not otherwise. |
| `dms` | `true` | Direct messages count, without having to mention anybody or contain a keyword. |
| `bots` | `false` | `true`: what other apps and integrations post counts too, as a message with `bot: true`. What your own app posts is never reported. |
| `ignore` | | User ids that are never reported: a colleague's bot account, a channel's chatterbox. An app's id (`B...`) is taken too. What the token's own account writes (with a user token: you) is left out without being listed. |
| `sendTo` | none | Where an agent may write, by id only: channels (`"C0123ABCD"`) and people (`"U0123ABCD"`, a direct message). Without it the source only listens. Needs `token`. See "Sending" below. |
| `perMinute` | `60` | At most this many reports a minute, 1 to 600. What comes on top is counted and dropped, and the next report says how many were (`dropped`). |
| `history` | `true` | With a `token`: an agent may read what was written earlier where the source listens (`read_source`), an answer in a thread comes with the messages it answers, and what was written while the source was not connected is asked for afterwards. `false` turns all three off. |
| `context` | `3` | How many earlier messages of a thread come with an answer in it, the thread's first message among them. `0` for none, `10` at most. |
| `maxMb` | `10` | Files that come with a message are fetched up to this size (50 at most). A larger one is named in the event, without a `path`. Needs `token`. |
| `keepDays` | `7` | Fetched files are deleted after this many days. |
| `apiBase` | `https://slack.com/api` | A Slack-compatible server of your own: reached over https, or on this machine. |

**`"me"`** is the account the `token` belongs to. With a user token that is you; with a bot
token it is the bot. So `"mentions": ["me"]` with a user token is "when somebody mentions me",
and with a bot token "when somebody mentions the bot".

**Names and ids.** `channels` takes names; `mentions`, `from`, `ignore` and `sendTo` take ids
(and `"me"`). A person's id is in their profile under "Copy member ID"; a channel's id is the
last part of its link ("Copy link"). `sendTo` takes ids only because it is the list that says
where an agent may write: a name can be given to another channel tomorrow, an id cannot. A
channel name that the app cannot find is why the source does not start, and the reason is
shown where the sources are listed: `there is no channel named "opps" that the app can see`.

#### The kinds of event

| `events` | Event | Fields | When |
|---|---|---|---|
| `"message"` | `message` | `{ text, user, userName?, channel, channelName?, kind, ts, thread?, reply?, bot?, mention?, keyword?, from?, files?, images?, why, context?, late?, dropped? }` | Somebody wrote something that counts. |
| `"reaction"` | `reaction` | `{ reaction, added, user, userName?, channel, channelName?, ts, author?, authorName? }` | Somebody put an emoji on a message (`added: true`) or took it away (`false`). `ts` is the message, `author` who wrote it. |
| `"edit"` | `edited` | `{ text, previous?, user, userName?, channel, channelName?, kind, ts, mention?, keyword?, from? }` | A message was changed. `previous` is what it said before. The preview Slack puts under a link is not an edit. |
| `"edit"` | `deleted` | `{ channel, channelName?, ts, previous? }` | A message was deleted. `previous` is what it said. |
| `"member"` | `joined`, `left` | `{ user, userName?, channel?, channelName? }` | Somebody joined or left a channel. Without `channel`: somebody joined the workspace. |
| `"channel"` | `channel` | `{ what, channel, channelName? }` | A channel was `"created"`, `"renamed"`, `"archived"`, `"unarchived"` or `"deleted"`. After `"renamed"`, `channelName` is the new name. |
| `"pin"` | `pin` | `{ added, channel, channelName?, ts?, user, userName? }` | A message was pinned (`added: true`) or unpinned. |
| `"command"` | `command` | `{ command, text, user, userName?, channel, channelName? }` | Somebody typed a slash command of your app: `command` is `"/deploy"`, `text` what followed it. Whoever typed it reads "Passed on." |
| `"other"` | `event` | `{ type, data }` | Any other event your app is subscribed to. `type` is Slack's name for it, `data` the event as Slack sent it, cut at 4000 characters. |
| always | `gap` | `{ text, from, to, seconds, found, looked, complete, missing? }` | The source was not connected for a minute or longer, and is again. `text` says it in a sentence. `complete: false` means that not everything from that time is known, and `missing` lists why. See "After a time without a connection". |

Any event can carry `dropped`: how many reports were left out before it, when more than
`perMinute` counted in a minute.

The fields of a `message`:

| Field | |
|---|---|
| `text` | What was written, as a reader sees it, cut to 4000 characters. `<@U0123>` in it is written as `@Name` (with a `token`), a link as `its words (https://its.address)`. For a message of an app (`bots`) it is put together from its text, its attachments and its blocks, since an alert often says nothing in the text itself. |
| `user`, `userName` | Who wrote it: the id, and with a `token` the name. For an app the id is the app's (`B...` or its user id), and `userName` what it posts as. |
| `channel`, `channelName` | Where: the id, and for a channel the name. |
| `kind` | `"dm"` for a direct message, `"group"` for a group conversation or a private channel, `"channel"` for a public one. |
| `ts` | Slack's time stamp of the message. It is what names a message: `send` takes it to react to it. |
| `thread`, `reply` | For an answer in a thread: `reply: true`, and `thread` is the time stamp of the thread. `thread` is what `send` takes to answer in that thread. |
| `context` | For an answer in a thread: what it answers, as a list of `{ user, userName?, text, ts }`, oldest first. The thread's first message and the last ones before the answer, `context` of them (3). Not there with `history: false`, without a `token`, or when the app may not read history. |
| `bot` | `true` when an app or integration posted it. |
| `late` | `true` when it was written while the source was not connected, and pine asked Slack for it afterwards. `ts` says when it was written. |
| `why` | Why it is reported, a word for each reason: `"dm"` (written to you directly), `"mention"`, `"keyword"`, `"from"` (its sender is on `from`), or `"channel"` when it is none of these and simply was written where the source listens. A list, since a message can be several: a subscription picks with `"payload.why": { "contains": "mention" }`. |
| `mention`, `keyword` | Which entry of `mentions` it mentions (for `"me"`: the id), and which word on `keywords` it contains. |
| `from` | `true` when its sender is on `from`. |
| `files` | Files that came with it, ten at most: `[{ name, type, size, path? }]`. With a `token`, `path` is where pine put the file. A file without a `path` could not be had: larger than `maxMb`, not readable with this token, or the source has no token. |
| `images` | The pictures among those files (jpg, png, webp, gif, four at most), which are shown to the agent if its model can look at images. |

The files lie in the source's own folder under names pine makes, and the agents subscribed to
the source can read them there (see "Files a source received" in [sources.md](sources.md));
to keep one, the agent copies it into its workspace. A file is fetched from Slack's file host
(`files.slack.com`) and from nowhere else, whatever address a message names, and a redirect
is not followed.

**Which message counts**, in this order:

1. Never: a post of your own app, and a message of somebody on `ignore`.
2. Never, unless `bots` is on: a message of another app or integration.
3. A message of somebody on `from` counts, wherever it was written.
4. A direct message counts when `dms` is on.
5. Any other message must be in a channel on `channels`, if there is such a list.
6. If `mentions` or `keywords` are given, it must mention one of those or contain one of
   those words. If neither is given, every message in the channel counts.

The other kinds go the same way as far as they have somebody who did it and a channel:
`ignore`, `from`, `dms` and `channels` apply to a reaction, a pin, somebody joining, a slash
command. `mentions` and `keywords` apply to messages and to edits only. An event without a
channel (somebody joined the workspace) is not held back by `channels`.

What counts beyond that is a subscription's business: `when` picks among the events
(`{"payload.from": true}`, `{"payload.kind": "dm"}`, `{"payload.bot": true}`,
`{"payload.channel": "C0123OPS"}`), and the note says what to do with each.

#### Making the Slack app

On api.slack.com/apps, "Create New App", "From scratch":

1. "Socket Mode": switch it on.
2. "Basic Information", "App-Level Tokens": make a token with the scope `connections:write`.
   That is `appToken`.
3. "Event Subscriptions": switch on, and under "Subscribe to bot events" (or "on behalf of
   users", see below) add the events for what you want reported, from the table.
4. "OAuth & Permissions": add the scopes from the table. Slack adds the ones an event needs
   by itself; those for names, files and sending you add.
5. For slash commands: "Slash Commands", "Create New Command".
6. "Install to Workspace". The token shown then is `token`. After adding an event or a scope
   later, install the app again.

| To get | Event subscription | Scope |
|---|---|---|
| the connection | | `connections:write`, on the app-level token |
| messages in public channels | `message.channels` | `channels:history` |
| messages in private channels | `message.groups` | `groups:history` |
| direct messages | `message.im` | `im:history` |
| group conversations | `message.mpim` | `mpim:history` |
| only messages that mention the bot, without reading channels | `app_mention` | `app_mentions:read` |
| what other apps post (`bots`), edits and deletions (`"edit"`) | the `message.*` ones above: they arrive as messages | as above |
| reactions (`"reaction"`) | `reaction_added`, `reaction_removed` | `reactions:read` |
| who joins and leaves a channel (`"member"`) | `member_joined_channel`, `member_left_channel` | `channels:read`, and `groups:read` for private channels |
| who joins the workspace (`"member"`) | `team_join` | `users:read` |
| changes to channels (`"channel"`) | `channel_created`, `channel_rename`, `channel_archive`, `channel_unarchive`, `channel_deleted`; for private channels `group_rename`, `group_archive`, `group_unarchive`, `group_deleted` | `channels:read`, `groups:read` |
| pins (`"pin"`) | `pin_added`, `pin_removed` | `pins:read` |
| slash commands (`"command"`) | none: the command is made under "Slash Commands" | `commands` |
| anything else (`"other"`) | the event you want | the scope Slack names for it |
| names of people | | `users:read` |
| names of channels, and `channels` by name | | `channels:read`, and `groups:read` for private channels |
| the files of a message | | `files:read` |
| what was written while it was not connected, in conversations it has seen a message in | | the `...:history` scope of that kind of conversation, which being told of messages there needs anyway |
| the same in conversations it has not seen a message in yet (somebody who writes to you for the first time) | | `im:read` for direct conversations; without a list of `channels` also `channels:read`, `groups:read` and `mpim:read` |
| posting a message | | `chat:write` (and `chat:write.public` to post in a public channel the bot is not in) |
| a direct message to a person on `sendTo` | | `chat:write`, `im:write` |
| an emoji on a message | | `reactions:write` |
| sending a file | | `files:write` |

A scope that is missing does not stop the source, with one exception: a name is left out, a
file has no `path`, a `send` says which scope Slack wants, and after a time without a
connection the `gap` event names what could not be looked at. The exception is a channel
given by its name, which cannot be found without `channels:read`.

A **bot token** (`xoxb-`) sees the channels the bot was invited to (`/invite @yourapp`) and
direct messages written to the bot. A **user token** (`xoxp-`, with the events subscribed "on
behalf of users" and the scopes added as user scopes) sees what you see: every channel you
are in and your own direct messages. To be told when somebody writes to *you*, it has to be a
user token. What you write yourself is then left out by itself (put `"me"` on `from` if you
want it reported all the same). What is sent with a user token is sent in your name.

#### Reading what was written before

A message often cannot be understood by itself: "what does Claude say about that?" needs the
thread it stands in. So an answer in a thread arrives with its `context`, and an agent can
read further with `read_source`:

| `data` | Reads |
|---|---|
| `{"channel": "C0123ABCD"}` | The last 20 messages of that channel or conversation, oldest first. `channel` is what an event had: an id that starts with C, G or D. |
| `{"channel": "U0123ABCD"}` | The direct conversation with that person. pine knows which conversation that is from when the person last wrote to you. For somebody who has not written since the source was set up, Slack has to be asked, which needs the permission `im:write`; without it, give the `channel` of one of their messages. |
| `{"channel": "...", "thread": "1712345678.000100"}` | That thread: `thread` is the `thread` of an event, or the `ts` of the message a thread began with. |
| `"limit": 50` | More at once, 50 at most. |
| `"before": "1712345678.000100"` | Further back: the messages before that one. The answer says which `ts` to give. |

Each line is one message with when, who, its `ts`, and for a message that began a thread how
many answers it has. What other apps posted is read like in an event; somebody joining or
leaving is left out.

It reads **where the source listens**: every channel the token sees when `channels` is not
set, only those channels when it is, and direct conversations unless `dms` is off. With a user
token that is what you can read yourself. Nothing is marked as read by it. It needs the same
permissions as being told of messages there (`channels:history`, `groups:history`,
`im:history`, `mpim:history`; for a user token among the User Token Scopes), so an app that
reports messages can usually read them too; where one is missing, the answer names it.

What is read is other people's words: the conversation counts as having read outside content
afterwards, and sending is then put to you. `"history": false` turns reading off.

#### Sending

An agent sends with the `send` tool: `text` for the message, `file` for a file from its
workspace, and everything else in `data`.

| To | The agent passes |
|---|---|
| post in a channel on `sendTo` | `text`, and `data`: `{"channel": "C0123OPS"}` |
| answer in a thread | the same with `"thread"`: the `thread` of the event, or the `ts` of the message that starts one |
| write to a person on `sendTo` directly | `text`, and `data`: `{"channel": "U0456RAINER"}` |
| put an emoji on a message | `data`: `{"channel": "C0123OPS", "ts": "1712345678.000100", "react": "eyes"}` |
| send a file | `file`, with `text` as the message beside it, and `data`: `{"channel": "C0123OPS"}` |

With one entry on `sendTo`, `channel` can be left out. Where things may go is the source's to
decide, not the agent's: a channel or a person that is not on `sendTo` is refused, whatever
the call names. The one thing beside the list: when a person is on it, the direct conversation
with them counts as on it too, so that an agent can answer where their message came from
(`"channel"`: the `channel` of that event). `@channel`, `@here` and `@everyone` in what an
agent writes are sent as plain words and call on nobody.

A Slack channel reaches other people, so a `send` through it is asked about after outside
content like any other, and what Slack reports is other people's words, never yours: its
events are outside content whatever `trust` says about your other sources. What the agent
sent comes back from Slack as a message like anybody's; it is not reported.

What Slack refuses, the agent is told in Slack's own word, with what to do where pine knows
it: `Slack refused chat.postMessage: not_in_channel. The app is not in that channel: somebody
there writes /invite and its name`.

#### Staying connected

If the connection ends it is made again, as described under `stream` ("Staying connected").
Slack itself closes it now and then and says so beforehand; pine connects again at once.
Slack is pinged every few seconds, so a line that died without a word is noticed. A machine
that slept does not trust the line it finds open when it wakes: pine connects again. When
Slack says "slow down" to a call, pine waits as long as Slack says and asks again.

Where the sources are listed, the line says how things stand: `connected since 14:02:11.
listening to 2 channels and direct messages, for messages, reactions`, or `cannot connect
since 14:02:11 (3 attempts): Slack refused apps.connections.open: invalid_auth`. A `token`
that Slack does not take, and a channel name it does not know, are why a source does not
start at all.

#### After a time without a connection

Slack does not send again what was written while nobody was connected: the machine was
asleep, the network was gone, pine was not running. So pine notes when the connection last
worked (also across a restart), and when it is connected again it asks Slack for what was
written since, where the source listens and nowhere else:

- Each message that counts is reported like any other, with `late: true`, oldest first. An
  answer in a thread is found when the thread began among the last 50 messages of its channel.
- After a minute or more, a `gap` event comes first:

```json
{ "text": "Slack was not connected from 2026-03-02 14:02:11 to 2026-03-02 14:07:30 (5 minutes). 2 messages written in that time follow, marked \"late\". It looked through all 14 conversations it listens to.",
  "from": "2026-03-02 14:02:11", "to": "2026-03-02 14:07:30", "seconds": 319, "found": 2, "looked": 14, "complete": true }
```

`complete: false` means that the time is not fully known, and `missing` says why, each reason
a sentence. An agent that tells you what came in passes that on, and does not say "nothing
new" for a time it could not look at:

| `missing` says | Why | What helps |
|---|---|---|
| `direct conversations this source had not seen a message in were not looked at (the app lacks the scope im:read)` | pine knows a conversation from the first message it saw in it. Which others there are, it has to ask Slack, and the app may not. The same for `public channels` (`channels:read`), `private channels` (`groups:read`) and `group conversations` (`mpim:read`) when the source has no list of `channels`. | Add the scope to the Slack app (for a user token among the User Token Scopes) and install the app again. |
| `1 direct conversation could not be read (the app lacks the scope im:history)` | The app may not read what was written earlier in that kind of conversation. | Add that scope. |
| `3 conversations could not be read (not_in_channel)` | Slack refused, in its own word, or could not be reached. | For `not_in_channel`: invite the app to the channel. |
| `this source has no token, so it could not ask Slack what was written in that time` | Asking needs the `token`. | Set the source up again with a `token`. |
| `this source was set up not to read what was written earlier ("history": false)` | | |
| `2 more messages from that time were left out, since at most 60 are reported in a minute` | `perMinute`. | The agent reads the rest with `read_source`. |
| `what else happened in that time (reactions, edits) cannot be asked for afterwards` | Slack keeps messages, and not who reacted, joined or edited when. A source that reports such things always says this. | |
| `what the people on "from" wrote outside the listed channels was not looked for` | With a list of `channels`, only those and direct conversations are asked for. | |
| `in 2 conversations more was written than the last 200 messages, and the older ones were not looked at` | A long gap in a busy channel. | The agent reads further back with `read_source`. |
| `12 more conversations were not looked at: 200 is the most at once` | | |

A gap shorter than a minute (Slack renewing the connection, which it does now and then and
which takes a moment) is made up for quietly: pine asks in the listed `channels` and in the conversations
it has seen a message in, 40 at most, and reports no `gap`. After a longer one it also asks
Slack which conversations there are, 200 at most. Reactions, edits and the other kinds are
never made up for.

Where the sources are listed, the last gap is said too: `connected since 14:07:30. listening
to ... Not connected from 2026-03-02 14:02:11 to 2026-03-02 14:07:30: not everything from
then is known`. A subscription that picks with `when` (`"payload.why": { "contains":
"mention" }`) is not woken by a `gap`, which has no `why`: an agent that is asked what came
in looks at that line.

#### Coming from the old Slack monitor

The OpenClaw plugin `openclaw-slack-monitor`:

| There | Here |
|---|---|
| `appToken`, `userToken` | `appToken`, `token` |
| `watchChannels` | `channels` (ids as before, or names) |
| `watchUserIds` | `mentions` (who has to be mentioned; `"me"` for yourself). Your own messages are left out without a setting. |
| `watchKeywords` | `keywords` |
| `watchDMs` | `dms` |
| `urgentUserIds` | `from` |
| `notifyChannel`, `notifyTo` | the subscription's note: "tell me on Telegram who wrote and what" |
| `urgentPrefix`, `urgentRepeat`, `urgentRouteOnly` | the note again: "when `from` is true, say so first and send it twice", or a conversation of its own subscribed with `"when": {"payload.from": true}` |
| `urgentCooldownSec` | `throttle` on that subscription |

The one difference in what counts: a user on `ignore` is never reported, also not in a
channel when a keyword is found in what they wrote.

#### Limits, and what is refused

- One source is one Slack app in one workspace. For a second workspace, a second source.
- What happens while it is connected is reported. Of what was written while it was not, only
  messages are asked for afterwards (see "After a time without a connection"); reactions, edits
  and the other kinds are not. Earlier messages are read only when an agent asks (`read_source`)
  or as the `context` of an answer in a thread, and not at all with `"history": false`.
- A message's text is cut at 4000 characters, its files at ten, its pictures at four. A name
  is looked up once and kept until pine restarts; a renamed channel is noticed when the app
  is subscribed to `channel_rename`.
- Files are fetched from `files.slack.com` only, with the `token`. A file larger than `maxMb`
  is not fetched; one that turns out larger than Slack said is given up while reading.
- A button somebody presses and a form somebody fills in (Slack's "interactivity") are
  acknowledged and not reported.
- A slash command is answered with "Passed on." and nothing else: what the agent has to say,
  it sends as a message.
- It never speaks for you by itself: there is no `trust: "owner"` for what is written in
  Slack, and nothing is sent anywhere that is not on `sendTo`.
- Refused when it is set up: an `appToken` that does not start with `xapp-`, a `token` that
  does not start with `xoxb-` or `xoxp-` (a token that rotates, `xoxe...`, is not taken), a
  name where an id belongs (`mentions`, `from`, `ignore`, `sendTo`), a kind in `events` that
  there is none of, `perMinute` outside 1 to 600, `maxMb` above 50, and an `apiBase` that is
  neither https nor on this machine.
- Refused when it starts: `"me"` or a channel by name without a `token`, a channel name that
  is not found or an app that may not list channels (the scope `channels:read`), and a `token`
  Slack does not take. The reason is shown where the sources are listed.

### matrix

A Matrix account: reports what is written in the rooms it has joined, all of it or only what
mentions somebody or contains a word. It asks the homeserver with one request that is
answered the moment something arrives, so nothing listens on a port.

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
| `homeserver` | | The address of the server the account is on: `https://matrix.org`. `http://` only for one on your own network or this computer. |
| `token` | | An access token of the account. Kept in `.env`. |
| `rooms` | every joined room | Only these rooms, by id (`!AbCdEfGh:matrix.org`). |
| `mentions` | | User ids (`@paul:matrix.org`): only messages that mention one of them. |
| `keywords` | | Only messages that contain one of these words. Capitals do not matter. |
| `ignore` | | User ids that are never reported. What the account itself writes never is. |
| `sendTo` | none | Room ids an agent may write to. Without it the source only listens. See "Sending through a source" in [sources.md](sources.md). |
| `local` | `false` | The homeserver is on your own network under a name that does not say so. |

Event `message`: `{ text, user, room, roomName?, kind, id, mention?, keyword?, dropped? }`.
`kind` is `"dm"` for a room the account keeps as a direct chat, else `"room"`; `id` is the
event's id; `mention` and `keyword` say which entry of those lists was found. Edits of a
message are not reported a second time.

**Where the access token is.** In Element: "All settings", "Help & About", "Advanced",
"Access Token". It is the key to the whole account, so it is best taken from a session of its
own (log in once in a private window, copy the token, and close the window without logging
out: logging out ends the token). An account made only for pine, invited to the rooms it is
to read, is the cleaner way.

**The starting point.** The first look only notes where "now" is: what was written before is
not reported. From then on pine remembers how far it has read, also across a restart, so what
was written while pine was not running is reported when it is back (up to 50 messages a
room).

**Encrypted rooms cannot be read.** pine holds no keys. Messages in a room with end-to-end
encryption are counted, and where the sources are listed the line says how many: `connected
since 14:02:11. 3 messages in encrypted rooms could not be read`. For such a room, use one
that is not encrypted, or a bridge.

Sending writes to a room on `sendTo` and nowhere else, as the account: `{"room":
"!AbCdEfGh:matrix.org", "text": "..."}`. What is written in a room is other people's words:
its events are outside content.

Refused when it is set up: a room given by its alias (`#family:matrix.org`) instead of its id
(the id is in the room's settings under "Advanced"), a user id that is not of the form
`@name:server`, and a homeserver outside your network that is not `https://`. A token the
homeserver does not take shows as `cannot connect since ...: the homeserver refused:
M_UNKNOWN_TOKEN`.

### discord

A Discord bot: reports what is written in the servers it was invited to and in direct
messages to it, all of it or only what mentions the bot or contains a word. It connects out
to Discord's gateway, so nothing listens on a port.

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
| `keywords` | | In servers, only messages that contain one of these words. Capitals do not matter. With `mentions` as well, either is enough. |
| `dms` | `true` | Direct messages to the bot count, without a mention or a keyword. |
| `bots` | `false` | What other bots and webhooks write counts too. |
| `sendTo` | none | Channel ids an agent may write to. Without it the source only listens. See "Sending through a source" in [sources.md](sources.md). |
| `apiBase` | `https://discord.com/api/v10` | A Discord-compatible server of your own: reached over https, or on this machine. |

Ids are long numbers. With "Developer Mode" on (User Settings, Advanced), a right click on a
channel or a server offers "Copy ID". A name is refused when the source is set up.

Event `message`:
`{ text, user, userName, channel, channelName?, guild?, guildName?, kind, id, mention?, keyword?, files?, dropped? }`.
`kind` is `"dm"` for a direct message to the bot and `"channel"` for one in a server; `mention`
is `true` when the bot is mentioned; `files` lists what was attached (`[{ name, type, size }]`,
not the contents). In `text`, `<@123...>` is written as `@name` and `<#123...>` as `#channel`.
What the bot itself writes is never reported, and neither is somebody joining or a pinned
message.

**Making the bot.** On discord.com/developers/applications:

1. "New Application", then "Bot": "Reset Token" shows the token once. That is `token`.
2. On the same page, under "Privileged Gateway Intents", switch on **Message Content
   Intent**. Without it Discord closes the connection, and the source says so where the
   sources are listed: `the bot is not allowed to read messages yet: switch on "Message
   Content Intent" ...`.
3. "OAuth2", "URL Generator": tick `bot`, and under "Bot Permissions" tick "View Channels" and
   "Read Message History" (and "Send Messages" if an agent is to write). Open the address it
   makes and pick your server: that is the invitation.

The bot sees the channels its role may read. A private channel has to let the bot in.

The connection is kept the way Discord asks: a heartbeat at the interval Discord names, and a
session that is taken up again after the line dropped, so that what was written in the
meantime still arrives. If the session is gone, a new one is started, and what was written
while the bot was away is not reported. See `stream`, "Staying connected", for how often it
tries.

Sending writes to a channel on `sendTo` and nowhere else, as the bot: `{"channel":
"1234567890123456789", "text": "..."}`. A text of more than 2000 characters goes out as
several messages, and it pings nobody: no `@everyone`, no role, no person. A Discord channel reaches
other people, and what is written there is other people's words: its events are outside
content.

### smtp

A mail drop: a small mail server that accepts messages and nothing else. For devices and
programs whose only way of reporting is "send an e-mail": they are told this computer as their
mail server, and what they send becomes an event instead of a mail.

> My NAS can only send e-mail alerts. Take them and tell me on Telegram when a disk is failing.

```json
"nas": { "type": "smtp", "port": 2525, "user": "nas", "password": "${NAS_MAIL_PASSWORD}", "to": ["alerts@pine.home"], "description": "alerts the NAS sends" }
```

| Option | Default | |
|---|---|---|
| `port` | | The port to listen on, `2525`. (25, 465 and 587 are the usual ones; below 1024 many systems want root.) |
| `user` | `"device"` | The user name the device logs in with. |
| `password` | made by pine | The password the device logs in with, 8 characters or more. Left out, pine makes one and keeps it in `.env`. Left out together with `allow` given, no login is asked for. |
| `allow` | everyone who logs in | Only these client addresses, as prefixes: `["192.168.1.40", "192.168.2."]`. For a device that cannot log in, give its address here and no password. |
| `host` | `"0.0.0.0"` | The address to listen on. The default lets devices on your network reach it. |
| `to` | any | Recipient addresses it accepts: `["alerts@pine.home"]`. Mail for any other is refused. The address does not have to exist anywhere; it is only what you enter in the device. |
| `maxMb` | `10` | The largest message accepted (50 at most). |
| `keepDays` | `7` | Received attachments are deleted after this many days. |

| Event | | |
|---|---|---|
| `mail` | `{ from, fromName?, to, subject, text, attachments, images?, client }` | One for every message. `from` is what the message says, `to` the recipients the device named, `client` the address it really came from. `attachments` and `images` as for `mail`. |

In the device, enter this computer's address as the mail (SMTP) server, the port, **no
encryption** (no SSL, no TLS, no STARTTLS), the user and the password, and any sender and
recipient address (one from `to`, if you set that). The agent that set the source up tells you
where the password is: in pine's `.env`, as `PINE_SOURCE_<NAME>_<AGENT>_PASSWORD`.

| What it is for | How |
|---|---|
| Synology DSM, QNAP QTS | Control Panel, Notification, Email: a custom SMTP server, this computer and the port, no secure connection. Disk, volume, UPS and backup alerts. |
| TrueNAS, Proxmox, Unraid | Their e-mail settings take an SMTP server with user and password ("outgoing mail server", "notification target"). |
| UniFi, routers | UniFi's Network application takes a custom SMTP server in its e-mail settings; a Fritz!Box under System, Push Service, Sender, with the box for a secure connection left unticked. |
| Printers and scanners | "Scan to e-mail": the scan arrives as an attachment, a PDF or a picture, and the agent can file it. Most cannot log in: give `allow` with the printer's address and no password. |
| UPS units, network cards of UPS units | APC, Eaton and CyberPower mail on power loss and low battery. |
| Cameras and recorders | A snapshot by mail on motion (Reolink, Hikvision, Dahua). The picture is shown to the agent. A camera that can upload by FTP is better served by `ftp`. |
| A Linux server | cron, smartd, unattended-upgrades, fail2ban and mdadm all mail to root. With `msmtp` (`/etc/msmtprc`: `host`, `port`, `auth on`, `user`, `password`, `tls off`) or a Postfix `relayhost` that mail arrives here. |
| Your own scripts | Anything that can call `sendmail`, `mail` or `curl smtp://`. |

It speaks plain SMTP, as these devices do: the password and the mail cross your network
unencrypted, so it is for your own network. It **only receives**. Nothing is passed on to
anybody (it is no relay), nothing can be listed or read back, and every attachment lands under
a name of pine's choosing inside the source's own folder, whatever the mail called it. It
answers EHLO, HELO, AUTH (PLAIN and LOGIN), MAIL, RCPT, DATA, RSET, NOOP and QUIT, and says
"not implemented" to everything else.

What a mail says is outside content, also from your own NAS: who it is "from" is a line the
sender wrote. For a device nobody else can reach, on an address you fixed with `allow`, you can
say `own` when you ask the agent to set it up (or `"trust": "owner"` in the file), as for any
source of yours.

One of `password` and `allow` is needed, or the source does not start: without either, anyone
on your network could hand text to an agent. Refused: a message above `maxMb`, a recipient not
on `to`, a client not on `allow` (the connection is closed without a greeting), three wrong
passwords in a row (the connection is closed), more than 20 connections at a time, a connection
that says nothing for a minute, and more than 30 messages in a minute, which get "try again
later", so that a device in a loop does not fill a conversation; a mail program sends them
again by itself. The status line counts what was received and what was refused.

### syslog

A syslog listener: takes the log lines that routers, firewalls, switches, access points and NAS
boxes send once they are told a "remote log server", and reports the ones that matter.

> Have the router send its log here and tell me when the internet line goes down or somebody
> fails to log in.

```json
"router": { "type": "syslog", "port": 5514, "allow": ["192.168.1.1"], "match": "link down|PPP|login failed", "severity": "notice", "description": "the router's log" }
```

| Option | Default | |
|---|---|---|
| `port` | | The port to listen on, `5514`. (514 is the usual one, which on many systems only root may open.) |
| `host` | `"0.0.0.0"` | The address to listen on. The default lets devices on your network reach it. |
| `protocol` | `"udp"` | `"udp"` is what most devices send. `"tcp"`, or `"both"`. |
| `allow` | anyone | Only these sender addresses, as prefixes: `["192.168.1.1", "192.168.2."]`. |
| `match` | | Only lines in which this regular expression finds something. |
| `severity` | `"warning"` | The least severe level still reported: `emerg`, `alert`, `crit`, `err`, `warning`, `notice`, `info`, `debug`. `"warning"` reports warnings and everything worse. |
| `perMinute` | `20` | At most this many reports a minute (1 to 600). What comes on top is counted and dropped. |

| Event | | |
|---|---|---|
| `line` | `{ host, app?, severity, facility, message, from, time?, dropped? }` | One for every line that is severe enough and matches. `host` and `app` are what the line says about itself (`host` is the sender's address when the line names none), `from` is the address it really came from, `message` the text up to 2000 characters. `dropped` says how many lines were left out by `perMinute` since the last report. |

A line has to pass both `severity` and `match`. To report every line that matches, whatever its
level, set `"severity": "debug"`. Both formats in use are read: the older one (RFC 3164,
`<13>Oct 11 22:14:15 router dnsmasq[1873]: ...`), also where a device leaves out the time or
its name, and the newer one (RFC 5424), whose `time` is passed on. A line that is neither is
reported as it is, with the severity `notice`. Over TCP a line ends with a line break or has
its length in front; both are read.

| What it is for | How |
|---|---|
| OpenWrt | System, System, Logging: "External system log server" and its port; or `uci set system.@system[0].log_ip=<address>` and `log_port=5514`. |
| UniFi | In the Network application's settings: "Remote syslog server" (called "SIEM server" in newer versions), with the address and the port. |
| MikroTik RouterOS | `/system logging action set remote remote=<address> remote-port=5514`, then `/system logging add topics=error action=remote`, one such line for each topic you want. |
| pfSense, OPNsense | Status, System Logs, Settings, "Remote log servers" (pfSense); System, Settings, Logging, Targets (OPNsense). |
| Synology DSM | Log Center, Log Sending: the server, the port, UDP or TCP, format BSD or IETF. |
| A Linux server | rsyslog: a line `*.warn @<address>:5514` in `/etc/rsyslog.d/pine.conf` (one `@` is UDP, `@@` is TCP). systemd-journald alone cannot send; rsyslog or syslog-ng does it. |
| Switches, access points, printers, IP phones | Almost all have a "syslog server" field in their settings. |

**Syslog has no login.** Whoever can reach the port can write a line under any host name.
Without `allow` the dialog you confirm says so in capitals; with it, lines from other addresses
are counted and dropped. Over UDP even the sender's address can be forged by somebody on the
same network, so a line is outside content like everything else a source reports. It only
receives: nothing is answered, nothing is stored but the events.

A device that logs many times a second costs little: a line that is not severe enough or does
not match is counted and nothing else, and what passes is capped by `perMinute`. The status
line says how many were reported, how many were not severe enough or did not match, how many
were over the limit and how many came from addresses not allowed; it never repeats a line.
Also set a `throttle` on the subscription that fits ("5m"), so that a burst wakes the agent
once. Up to 20 TCP connections at a time, lines up to 8 KB.

### onvif

A network camera's own detections: motion, a person, a vehicle, tampering, a line crossed, a
doorbell's button. The camera does the looking; this source asks it what it saw, in the
language most cameras and recorders share (ONVIF, Profile S and T).

> When the camera at the gate sees a person, tell me on Telegram.

```json
"gate": { "type": "onvif", "host": "192.168.1.40", "port": 8000, "user": "pine", "password": "${GATE_CAMERA_PASSWORD}", "topics": ["Motion", "People", "Visitor"], "description": "what the camera at the gate detects" }
```

| Option | Default | |
|---|---|---|
| `host` | | The camera's address on your network: `192.168.1.40`. |
| `user`, `password` | | An account on the camera. Make one for pine with the lowest rights that may read events. The password is kept in `.env`. |
| `port` | `80` | The camera's ONVIF port. See the table of makes below. |
| `path` | `"/onvif/device_service"` | Where its ONVIF service is. Nearly every camera uses this one. |
| `topics` | everything | Only events whose topic contains one of these words; capitals do not matter. `["Motion", "Person"]`. |
| `perMinute` | `20` | At most this many reports a minute. What comes on top is dropped, and the next event says how many in `dropped`. |
| `local` | `false` | The address is a name on your own network that does not say so (`gate.lan`). Not needed for an IP address or a `.local` name. |

Event `event`: `{ topic, source, data, time?, active?, dropped? }`.

| Field | |
|---|---|
| `topic` | What kind of thing happened, as the camera calls it: `RuleEngine/CellMotionDetector/Motion`. |
| `source` | Which part of the camera it is about, as names and values: `{ "VideoSourceConfigurationToken": "1" }`. A recorder with eight cameras tells them apart here. |
| `data` | What it says: `{ "IsMotion": true }`. `true`, `false` and numbers come as such. |
| `active` | When `data` holds exactly one yes-or-no value, that value: `true` when motion starts, `false` when it ends. To be woken only at the start, subscribe with the filter `{"payload.active": true}`. |
| `time` | The camera's own time for it. |

| Make | Port | To switch on |
|---|---|---|
| Reolink | 8000 | Settings › Network › Advanced › Port settings: ONVIF. |
| Hikvision | 80 | Network › Advanced › Integration protocol: enable ONVIF and add an ONVIF user there (it is separate from the camera's own users). |
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

The names differ from make to make. Set the source up without `topics` first, walk past the
camera, and look at what arrives (`pine events --topic 'source/gate/#'`); then narrow it down.

pine asks the camera for a subscription and then keeps one question open with it, which the
camera answers the moment something happens (a "pull point"). The camera needs no way to reach
pine, and nothing has to be opened in a firewall. If the camera restarts or forgets the
subscription, a new one is made, after a pause that grows while the camera stays away.

**The first thing a camera says is where things stand**: no motion, not tampered with. That is
the starting point and is not reported; a change from it is. A state that is said again
without having changed is not reported either. Something that just happens rather than is (a
line crossed) is reported every time.

Every request goes to the host and port you confirmed. A camera names addresses in its
answers (where its event service is, where the subscription lives); of those only the path is
used, never the host. The password never crosses the network: what is sent is a digest over a
random number, the camera's time and the password, which is what ONVIF prescribes. The rest
is plain HTTP, as cameras speak it on a local network. What a camera writes into an error is
not repeated where agents read the state of a source.

It only listens: nothing on the camera is changed, moved or switched. It brings the event, not
a picture. For the picture, let the camera upload one when it sees something (the `ftp` type),
or have the agent fetch a snapshot when it is woken.

This type was written against the ONVIF specification and a stand-in for a camera, and has
not been tried on every make. Two things it does not do: cameras that accept only HTTP
digest authentication for ONVIF (a setting on some Axis and Hikvision models: choose "digest
and WS-UsernameToken"), and ONVIF over HTTPS.

### modbus

A device that speaks Modbus TCP, read again and again: reports each value when it changes. For
what sits in the cellar or on the roof and has a network socket but no way of telling anybody
anything: a solar inverter, a battery, a heat pump, a wall box, an energy meter.

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
| `read` | | The values to read, 1 to 32 of them. See the next table. |
| `port` | `502` | The port. Nearly always 502; SolarEdge inverters use 1502. |
| `unit` | `1` | The device's unit id, which some call slave id. A gateway that fronts several devices tells them apart by it. |
| `every` | `"30s"` | How often to read. At least `"2s"` when an agent sets it up. |
| `local` | `false` | The address is a name on your own network that does not say so (`inverter.lan`). Not needed for an IP address or a `.local` name. |

Each entry of `read`:

| Key | Default | |
|---|---|---|
| `name` | | A short word for the value: `power`, `soc`. It is what the event carries, and what a filter names. |
| `address` | | The register's number as the protocol counts it, from 0. A register list that counts from 40001 (holding registers) or 30001 (input registers) means the number minus that; one that says "base 1" means the number minus 1. |
| `kind` | `"holding"` | `"holding"`, `"input"`, `"coil"` or `"discrete"`: which of the device's four tables the value is in. The register list says so; `coil` and `discrete` are single bits and come as `true` or `false`. |
| `type` | `"u16"` | How the register is read: `"u16"`, `"i16"` (may be negative), `"u32"`, `"i32"`, `"f32"` (a floating-point number). The last three are two registers. |
| `scale` | `1` | The raw value is multiplied by it: `0.1` for a voltage given in tenths of a volt. |
| `step` | | Report the value only when it has moved at least this far since it was last reported: `200` for a power in watts that never stands still. Without it every change is an event. |
| `words` | `"be"` | For a 32-bit value: `"be"` if the first register is the high half (most devices), `"le"` if it is the low half. A value that reads as nonsense with one is right with the other. |

Event `changed`: `{ name, value, previous }`, one for each value that moved. To be woken only
below a threshold, subscribe with a filter: `{"payload.name": "soc", "payload.value": {"lt": 20}}`.

The example is a Victron GX device (Cerbo, Venus OS). Its system values are at unit 100:
register 843 is the battery's state of charge in percent, 842 the battery's power in watts
(negative while it discharges), 820 the power drawn from the grid on the first phase, 840 the
battery voltage in tenths of a volt. Modbus TCP is switched on under Settings › Services, and
Victron publishes the whole list as a spreadsheet ("CCGX Modbus TCP register list").

| What it is for | How |
|---|---|
| Solar inverters and batteries (SolarEdge, Fronius, SMA, Huawei, Sungrow, Victron) | Most speak SunSpec, a common register layout, over Modbus TCP once it is switched on in the device's settings or installer menu. The maker's "Modbus" or "SunSpec" document lists the registers. |
| Heat pumps (Stiebel Eltron, Nibe, Vaillant, Daikin with a gateway) | Flow and outside temperature, operating state, a fault code. Usually an extra network module, and its manual has the register list. |
| Wall boxes (go-e, Keba, Wallbox, openWB) | Whether a car is plugged in, charging power, energy of the session. |
| Energy meters (Eastron SDM, Shelly Pro 3EM, a smart meter gateway) | Power per phase, energy totals. Meters with only a serial bus (Modbus RTU) need a small RTU-to-TCP gateway in front. |
| Anything with a PLC | A coil or a discrete input is a pump that runs, a door that is open, an alarm contact. |

The device's register list is the one thing this type cannot know. Ask for the document by
the device's exact model ("... Modbus register map"); an agent can read it and pick the
registers. Where the list gives a value a scale in a register of its own (SunSpec's `_SF`
registers), read the value raw and the scale beside it, or use the device's floating-point
registers if it has them.

**It only reads.** Of the protocol's functions only the four that read are ever sent (1 to 4),
so nothing can be switched, set or charged through this source, whatever an agent is told.
Each look is one short connection: several devices allow only one Modbus connection at a
time, and one that is held would lock a home automation system out.

A device that says no to a register (`illegal data address`: the number is not one it has),
does not answer within five seconds or closes the connection is a failed look, shown with its
reason wherever sources are listed, and not an event. The address has to be on your own
network, or it has to stay on the public internet for good, as with `http`.

Refused when it is set up: more than 32 values, two values of one name, an address above
65535, a `type` or `kind` that does not exist, `every` below `"2s"`.

### serial

A serial port: reports the lines a device prints on it. For what is plugged into this computer
by USB or a serial cable and writes text: a microcontroller that prints its readings, a smart
meter, a GPS receiver, a weather station, a UPS.

> The Arduino on the USB port prints the greenhouse temperature every second. Tell me when it
> goes above 35.

```json
"greenhouse": { "type": "serial", "port": "/dev/cu.usbmodem1101", "baud": 115200, "match": "temp=([0-9.]+)", "changed": true, "description": "the temperature in the greenhouse" }
```

| Option | Default | |
|---|---|---|
| `port` | | The device: `/dev/cu.usbserial-1420` or `/dev/cu.usbmodem1101` on a Mac (`ls /dev/cu.*` lists them), `/dev/ttyUSB0` or `/dev/ttyACM0` on Linux, or its lasting name under `/dev/serial/by-id/`. |
| `baud` | `9600` | The speed the device sends at: 9600, 19200, 38400, 57600, 115200 and the other usual ones. With the wrong one nothing readable arrives. |
| `match` | | Report only lines this regular expression finds. Its first group becomes `value`, as a number when it is one. |
| `changed` | `false` | Report a line (or its `value`) only when it differs from the one before. For a device that prints the same reading every second. |
| `perMinute` | `30` | At most this many reports a minute. What comes on top is dropped, and the next event says how many in `dropped`. |

Event `line`: `{ port, line, value?, previous?, dropped? }`. Without `match`, `value` is there
when the line is JSON (`{"temp": 21.5}`) or a number. With `changed`, `previous` is what it was
before. To be woken only above a threshold, subscribe with a filter:
`{"payload.value": {"gt": 35}}`.

| What it is for | How |
|---|---|
| An Arduino, ESP32 or Pico that prints readings | `Serial.println()` in its sketch is all it takes. Print one reading a line, as `name=value` or as JSON. |
| A smart meter's P1 port (Dutch and Belgian meters, many others) | A USB P1 cable, 115200 baud. It sends a block of lines every second or ten; `"match": "1-0:1\\.7\\.0\\(([0-9.]+)"` is the power drawn right now in kW, `1-0:1.8.1` and `1-0:1.8.2` are the meter readings. |
| A GPS receiver | NMEA sentences at 9600 baud (4800 for old ones); `"match": "^\\$G.GGA,(.*)"` is one position a second. |
| A weather station or a sensor with a data cable | Whatever its manual says it prints. |
| A UPS with a serial or USB cable | The ones that print status lines. Most want to be asked first, which this type does not do: use the maker's tool or NUT with the `command` type instead. |

**It only listens.** Nothing is ever written to the port, so a device that has to be asked
before it answers stays silent. The port is read as 8 data bits, no parity, one stop bit,
which is what nearly everything uses.

Only a serial port is read, and it is told by its name: `/dev/cu.*` or `/dev/tty.*` on a Mac,
`/dev/ttyUSB0`, `/dev/ttyACM0`, `/dev/ttyS0`, `/dev/ttyAMA0`, `/dev/rfcomm0` and the like on
Linux. A terminal is a device of the same kind, and reading from one would take away what
somebody types there; those are called otherwise and are refused, like every path that is not
a device under `/dev`.

A device that is unplugged is not an error: the source waits, looks for it again with a
growing pause (a minute at most), and says `waiting for cu.usbmodem1101: it is not there
(unplugged?)` where sources are listed. On Linux the user pine runs as has to be allowed to
read the port (the group `dialout` on most systems). Lines are cleaned of control characters
and cut at 1000 characters; a device that never ends its line is cut every 4096.

### presence

Who is on your own network: reports when a device joins it and when it has left. For "is my
phone home", a TV or a games console that was switched on, a printer that came online.

> When my phone comes home after having been away for more than an hour, switch the hallway
> light on.

```json
"home": { "type": "presence", "hosts": { "phone": "192.168.1.23", "tv": "192.168.1.30" }, "services": ["_ipp._tcp"], "away": "10m", "description": "who is at home: my phone, the TV, and any printer" }
```

| Option | Default | |
|---|---|---|
| `hosts` | | The devices to look for, as name and address: an IP address on your network, or a `.local` name. Up to 32. |
| `services` | | Kinds of device that announce themselves on the network (Bonjour, also called mDNS), by their service type. Every device of that kind is reported under its own name. Up to 16. |
| `every` | `"30s"` | How often to look. At least `"10s"` when an agent sets it up. |
| `away` | `"10m"` | How long a device must have been silent before it counts as gone. |

At least one of `hosts` and `services`.

| Event | | |
|---|---|---|
| `arrived` | `{ name, address?, service?, awayFor? }` | It is there again. `awayFor` is how long it was gone, in seconds; to be woken only after a real absence, subscribe with the filter `{"payload.name": "phone", "payload.awayFor": {"gt": 3600}}`. |
| `left` | `{ name, address?, service?, lastSeen }` | It has not answered for as long as `away` says. `lastSeen` is when it last did. |

| What it is for | How |
|---|---|
| Is my phone home | `hosts`, with the phone's address. Tell the router to always give the phone the same address (a "DHCP reservation"), and on an iPhone switch off "Private Wi-Fi Address" for the home network, or it changes. |
| A TV, a console or a computer that was switched on | `hosts`: it answers while it is on and is silent in standby. With `away` at `"1m"` you know within a minute or two. |
| A printer, a speaker, a media player that came online | `services`: `_ipp._tcp` (printers), `_airplay._tcp` (Apple TV, HomePod, AirPlay TVs), `_googlecast._tcp` (Chromecast, Google speakers), `_sonos._tcp`, `_spotify-connect._tcp`, `_hap._tcp` (HomeKit accessories), `_smb._tcp` (file shares, a NAS). |
| A device whose address you do not know | `services`, if it announces itself; or its `.local` name under `hosts`. |

A host is there when it answers one ping, or when it answers a connection at all, even by
refusing it. Services are asked for on the whole network at once: on a Mac through the
system's own Bonjour browser, elsewhere with a question to the network that every device of
that kind answers.

**Who is there at the start is the starting point** and is not reported. From then on an
arrival is reported at the next look, and a departure once the device has been silent for
`away`. That pause is there for phones: one that sleeps answers only now and then, and
without it a phone on the sofa would leave and arrive all evening. If a phone still flickers,
make `away` longer. A device that says goodbye when it is switched off (announced services
do) is reported gone at once.

Limits:

- It sees your own network and nothing else. An address on the internet is refused; whether
  one of those answers is what the `http` type's `down` and `up` are for.
- A guest network or a router setting that keeps devices from seeing each other ("client
  isolation") hides everything from it.
- A phone is at home when it is on the Wi-Fi, not when its owner is. One with Wi-Fi off, or
  a flat battery, has left.
- When this computer itself has no network, nobody answering says nothing about who is at
  home: the look fails and says so, and no departures are reported.
- On a Mac the system may ask once whether the app pine runs in may find devices on your
  local network. Without a yes nothing answers.

It sends one ping and three connection attempts to each host per look, and one question
about services to the network. Nothing else is sent to any device, and nothing on a device
is read or changed. On Linux a `.local` name needs the system to resolve such names (Avahi
with `nss-mdns`); an IP address always works.

### system

This computer: it reports when it goes to sleep and wakes, when its screen is locked and
unlocked, when it changes between mains and battery or runs low, when its network comes and
goes, when a disk is plugged in or taken out, and when an app you named starts or quits. On
macOS, Linux and Windows, with the same events; what one system does not tell is left out there
(see "system on Linux" and "system on Windows" below).

> When I unlock the Mac in the morning, tell me what happened overnight.

```json
"mac": { "type": "system", "watch": ["lock", "sleep", "power"], "apps": ["Xcode"], "battery": 15, "description": "what this Mac does: lock, sleep, power, Xcode" }
```

| Option | Default | |
|---|---|---|
| `watch` | all five | What to report: `"sleep"`, `"lock"`, `"power"`, `"network"`, `"volumes"`. |
| `apps` | none | Apps whose start and end are reported. On a Mac by name or bundle id: `["Xcode", "us.zoom.xos"]`; on Windows by program name, as the Details tab of the Task Manager shows it, with or without `.exe`: `["Zoom", "Teams"]`. Not on Linux. Without it no app is reported. |
| `battery` | `20` | Report `battery-low` once when the charge falls to this many percent while on battery. |

| Event | | `watch` |
|---|---|---|
| `sleeping`, `woke` | `{}` | `sleep`: the computer goes to sleep, and is awake again. |
| `display-off`, `display-on` | `{}` | `sleep`: the screens go dark, and light up again. Not on Linux. |
| `locked`, `unlocked` | `{}` | `lock`: the screen lock. |
| `power` | `{ on, percent? }` | `power`: the supply changed. `on` is `"ac"`, `"battery"` or `"ups"`. |
| `battery-low` | `{ percent }` | `power`: once per discharge, said again only after it was charged. |
| `network` | `{ online, via? }` | `network`: the connection came, went, or changed its way (`"wifi"`, `"ethernet"`, `"cellular"`, `"other"`). |
| `mounted`, `unmounted` | `{ name, path? }` | `volumes`: a disk, a memory card, a disk image, a network share. |
| `app-started`, `app-quit` | `{ app, bundle? }` | Only for the apps on `apps`. Not on Linux. |

| What it is for | How |
|---|---|
| A summary when you sit down | `watch: ["lock"]`, and a note: "when it is unlocked after more than an hour, say what came in". |
| Something to do when the backup disk is plugged in | `watch: ["volumes"]`, subscribed with `when: {"payload.name": "BACKUP"}`. |
| Finish work before the battery is empty | `watch: ["power"]`, `battery: 15`. |
| Know that the connection dropped | `watch: ["network"]`. An agent that needs the network waits for `online: true`. |
| Start something when a meeting begins | `apps: ["zoom.us"]`: `app-started`, and `app-quit` when it is over. |

How things are when the source starts (on mains or battery, online or not) is the starting
point and is not reported; only what changes afterwards is. The charge moves all day and is no
event: `power` is reported when the supply changes, and carries the charge it had then.

The system tells a small helper program of pine's, which only repeats what the system says.
It gets none of pine's environment, and no agent can change it: it is pine's own code, or built
from it into the source's folder in pine's data folder, where no agent can write. It needs no
permission from you: none of this is behind a privacy grant.

On a Mac pine builds the helper from its own source with `swiftc` the first time the source
starts (a few seconds, and Apple's command line developer tools have to be installed:
`xcode-select --install`). A pine that came with the Pine app carries the helper built, inside
the app, and builds nothing.

What it does not report: the name of the Wi-Fi network (macOS gives that only to an app with
access to your location), other apps' notifications, and what you type or look at. A disk's
name is text from outside like a file name, so these events are outside content unless you
mark the source as your own.

### system on Linux

The helper is a small program of pine's in JavaScript, run by the Node pine runs on; nothing is
built. It listens on D-Bus's system bus through `gdbus` (the package `libglib2.0-bin` on Debian
and Ubuntu, `glib2` elsewhere):

| | What it hears |
|---|---|
| Sleep | `sleeping` and `woke`, from systemd-logind. There is no `display-off` or `display-on`: no service tells that for every desktop. |
| The lock | `locked` and `unlocked`, of your own sessions, as the desktop tells logind (GNOME, KDE Plasma and most others do; a bare window manager with a locker of its own may not). |
| Power | UPower (the package `upower`, there on every desktop). |
| The network | NetworkManager, or systemd-networkd on a server. Online is connected beyond the local network. |
| Disks | The kernel's table of mounts, read every two seconds: what is mounted under `/media`, `/run/media` and `/mnt`, and network shares (`cifs`, `nfs`, `sshfs`) anywhere. |

`apps` is refused: Linux has no clean way to hear apps start and quit. Where something is
missing (no system bus in a container, no UPower on a server) the source still runs, and its
status says what it cannot hear and why: `cannot hear power: UPower is not running`. A service
that starts later is heard from then on.

### system on Windows

pine builds the helper from its own source with the C# compiler every Windows carries (.NET
Framework 4) the first time the source starts, in a few seconds. Sleep and wake, the screens,
the lock, the battery and disks are what Windows tells a window of the helper's that is never
shown; the network is an interface that is up and has a gateway (`wifi`, `ethernet`,
`cellular`, `other`). `ups` is not told apart from mains. Apps are the programs running in your
own session, looked at every two seconds: `app-started` when the first process of a name
starts, `app-quit` when the last one ends, so a browser of thirty processes is one app. Their
`app` is the program's name without `.exe`, and there is no `bundle`. A disk is named by its
label, or by its letter (`E:`) when it has none, and its `path` is the drive (`E:\`).

On Windows, pine in WSL is a Linux: there the Linux helper runs, and hears what WSL's Linux
has, which is little (no lock, no battery).

## What there is no type for

| Wanted | Instead |
|---|---|
| A page that a script fills in after loading | It has no type of its own: `http` with `render` has a browser make the look (see "A page that a script fills in" under `http`). Where the page's script asks an address that answers JSON, watching that with `path` is lighter. |
| A calendar's "ten minutes before" | A schedule the agent sets when `calendar` reports the entry ([events.md](events.md), "Schedules"). |
| Bluetooth sensors and beacons | A bridge that publishes them to MQTT (Theengs Gateway, OpenMQTTGateway), and the `mqtt` type. |
| iMessage, WhatsApp | No type. Signal works through signal-cli and `stream`; Telegram, Slack, Matrix and Discord have types. |
| KNX, Z-Wave, Zigbee, HomeKit, Matter | Through the hub that speaks them (Home Assistant, zigbee2mqtt, zwave-js-ui), by `mqtt` or `stream`. |
| Something with a command line client and nothing else | `command` with `follow` (see "Following a command that keeps running" under `command`). |
| Something of your own | A source type of your own is a small module ([sources.md](sources.md), "A source type of your own"); the main agent can write and register one when you ask it. |
