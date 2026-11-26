# Source types: how they are built

For contributors. What an owner or an agent needs is in
[references/source-types.md](../references/source-types.md) and
[references/sources.md](../references/sources.md).

## Where a type lives

A built-in type is `src/sources/<type>.ts`, listed in `SOURCE_TYPES` (`src/config.ts`). Its
`type` export (`SourceType`, `src/source-types.ts`) holds the one-line `summary`, the options
as a typebox schema, and `plan()`, which checks options and says what the set-up would do
(`does`, `opens`, `tell`, `owner`). The default export starts the source. A type is described
for three readers, on purpose:

| Reader | Where |
|---|---|
| The model that sets one up | The type's `summary` and option descriptions. Only `EVERYDAY_TYPES` are spelled out in `add_source`; the others are named there and in `BRIEF` (`src/catalogue.ts`), and their options become the manual part `source-type#<name>` |
| The owner | `docs/references/source-types.md` |
| A contributor | This file |

A new built-in type goes into `SOURCE_TYPES`, into that line of `BRIEF`, and into
`references/source-types.md`.

## What the types share

| What | Where |
|---|---|
| Looking again and again: one poll per source, never two looks at once, ±10% jitter, a failed look backs off doubling up to 15 minutes (`POLL_BACKOFF_MAX`) or the interval, the status line | `poll` in `src/sources.ts` |
| Asking a web address: `askable` (checks at set-up), `ask` (1 MB, 20 s, five same-host redirects, `ETag`/`Last-Modified`), `guardFor` (public-only agent), `lineDiff` (30 lines), `numberOf`, the CSS `selector` subset, `harmless` for status lines | `src/watching.ts` |
| A rendered look: a helper of its own (`mcp/render.ts`, started by `rendered`), two at a time (`RENDER_AT_ONCE`), 45 s (`RENDER_TIMEOUT`), the one local host:port written to `local.json` in the source's data folder | `src/watching.ts`, `src/sources/http.ts` |
| A held connection: `hold` (reconnect from 1 s, or 50 ms on loopback, doubling to 5 minutes; settled after 30 s; `down` after three failed attempts), one WebSocket, status words | `src/sources/stream.ts`, used by `slack`, `matrix`, `discord`, `zulip` |
| The cap on reports a minute | `capped` in `src/watching.ts` |
| A followed command (`command` with `follow`): lines over 4000 characters cut by the host, refused on Linux (`Guard`) | `follow` in `src/sources.ts` |

## Helpers of the `system` type

| System | Helper |
|---|---|
| macOS | `src/sources/system.swift`, built with `swiftc` into the source's data folder the first time; the Pine app carries it built (`src/prebuilt.ts`) |
| Windows | `src/sources/system.cs`, built with the `csc.exe` of .NET Framework 4 (`src/csharp.ts`) |
| Linux | `src/sources/system-linux.ts`, run by Node; listens through `/usr/bin/gdbus` (logind, UPower, NetworkManager or networkd) and reads `/proc/self/mounts` every two seconds |

Each repeats what the system says and decides nothing. The program the daemon runs is never a
source option; a test puts its stand-in into the module (`standIn`).

## `slack` on Slack's SDK

The type runs on `@slack/web-api` and `@slack/socket-mode`, and pine keeps what the SDK does not
give: Web API calls go through a `fetch` of pine's own (address guard, no redirect, the token only
to the API host and `*.slack.com`, the upload form rebuilt), the SDK's reconnect is off and `hold`
reconnects, rate limits are waited for by pine, sockets are cut by pine when the source stops.
Two SDK internals are relied on: the `ws_message` event and a throw from an `authenticated`
listener. Look at both on an SDK upgrade and run `test/chat.test.ts`.

## `mail` with a Microsoft sign-in

Microsoft's device code flow and IMAP/SMTP `XOAUTH2`. The authority is fixed in code
(`oauth.authority` in `src/sources/mail.ts`, moved only by a test); what Microsoft hands over is
kept in `source.kv` and renewed at every connection. The page and the code shown to the owner are
checked to be what they claim. Tested against stand-ins for all three servers. The registration
steps in the reference follow Microsoft's documentation, whose page names change.

## Other notes

- `onvif` was written against the ONVIF specification and a stand-in camera; it sends
  WS-UsernameToken digests and uses only the path of addresses a camera names.
- `serial` reads through `cat` and `stty`, by absolute path; not on Windows.
- `presence` sends one ping (`/sbin/ping` and the like) and connects to ports 7, 80 and 62078;
  on a Mac it browses services with `/usr/bin/dns-sd`, elsewhere it sends its own mDNS query.

## Tests

The types are tested on stand-ins that run on any system without network: a web server whose
answers the test changes (`test/watch.test.ts`, `test/feeds.test.ts`), a hand-written WebSocket
server (`test/support/ws.ts`), scripted IMAP, SMTP, Modbus and camera servers on a loopback port,
hand-made DNS packets, and a script in place of the `system` helper. A source in a test's
configuration may look more often than a model may set (`every: "40ms"`): the limit is in
`plan()`, which a configuration file does not pass through. The `live:` test in
`test/system.test.ts` builds the real helper.
