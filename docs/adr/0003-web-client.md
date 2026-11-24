# 0003: The web client

Status: accepted. Supersedes what ADR 0001 says about a page served to a browser. Amended by
[ADR 0004](0004-browser-access.md): a second way a host key is trusted, and what the Worker
carries besides SSH (see "Amended by ADR 0004" at the end).

## Context

ADR 0001 kept a PWA in reserve and said why it was not the first choice: a page served to a
browser cannot keep the token from the page, cannot hold an SSH connection, and would need the
control API on a network. The Pine app's page, though, is content from outside (an answer can
repeat a web page), and rule 10 in `AGENTS.md` holds every client to keep the token from it.

Owners asked for pine from a work laptop, a borrowed computer or a tablet: places where nothing
can be installed, and where neither the desktop app nor the phone app runs. Two things changed
what a browser can do:

- WebCrypto has Ed25519 in every current engine (Chrome 137, Firefox 130, Safari 17), with keys
  that can be made non-extractable and kept in IndexedDB.
- A browser cannot open TCP, but a small Worker can carry a WebSocket to a TCP connection, so an
  SSH client written for the browser can reach `sshd` with SSH end to end inside it.

## Decision

**A web client in `web/`, a package of its own, beside `desktop/` and `mobile/`.** It is the Pine
app's page, built for the browser, for the owner's own pine over SSH. No daemon runs in the
browser, and the control API stays on the loopback of the machine.

**The top-level document holds key and token.** The web bridge (`web/src/host.ts`) plays the part
`desktop/electron/main.ts` plays: it holds the browser's SSH key, the machines and their trusted
host keys, the SSH connection and the daemon's token, and makes every call to the control API.

**The page runs in an iframe sandboxed with scripts only, under an opaque origin.** What it draws
reaches neither the bridge's IndexedDB, nor the key, nor the token. The bridge answers messages
from that iframe's window alone, only a method of a fixed list (`web/src/protocol.ts`), with its
arguments checked one by one. The iframe gets no other permission, `allow-same-origin` least of
all. Media reach the page as bytes under `MEDIA`'s rules, and only `http(s)` addresses are
opened, in a new tab with `noopener`.

**SSH runs in the browser.** On `@microsoft/dev-tunnels-ssh`, with Ed25519 on WebCrypto. The key
is made non-extractable and only its public half is ever exported. A host key is trusted only as
the owner confirmed it, by the exact fingerprint shown, before the key is offered; a changed one
is refused. The daemon is reached through a direct-tcpip channel to the machine's loopback and
nowhere else, after `pine service` was run as `remoteCommand()` in `src/remote.ts` says.

**The relay carries SSH and nothing else.** A Cloudflare Worker (`web/relay`) between the
browser's WebSocket and a TCP connection: it sees neither key nor token, checks that both sides
speak SSH, reaches public addresses only (checked after the name is looked up), caps connections
per client address, and keeps and logs nothing. The same Worker serves the build.

**A tailnet machine through Tailscale Funnel.** A browser joins no VPN, and the relay refuses the
addresses of a tailnet. Funnel publishes a machine's `sshd` behind Tailscale's TLS at its name in
the tailnet; the relay connects to a `.ts.net` name, on Funnel's ports alone, by that name through
TLS with the certificate checked for it, after the name's addresses passed the same check. SSH
stays end to end inside that TLS.

## Alternatives considered

**A PWA as ADR 0001 pictured it, with the token in the page.** Rejected: whatever the page draws
could read it.

**The control API on a network, behind a login.** Rejected: rule 10 and the daemon's loopback-only
control API stay as they are. SSH already authenticates the owner and protects the bytes.

**A relay that terminates SSH, or a server that holds the key.** Rejected: the relay would then
hold what reaches the owner's machine. A relay that carries bytes it cannot read holds nothing.

**Reaching the loopback or private addresses from the relay.** Rejected: a public relay would
become a way into whatever network it runs beside. Its one way to the loopback,
`RELAY_ALLOW_LOOPBACK`, is the smoke's, given to `wrangler dev` on its command line, and a test
fails when a deployed configuration sets it.

## Consequences

- The page stayed in `desktop/src`, and `web/` builds it from there, under `page/`: the `app/`
  package that [0001](0001-mobile-app.md) planned for a third client was not made.
- Rule 10 has a fourth holder of the token: the web bridge, beside `main.ts`, the preview's server
  and the mobile app's native plugin.
- The page's bridge has a third implementation (`web/src/frame-bridge.ts`); a change of the page is
  checked in `desktop/`, `mobile/` and `web/`.
- The page can do nothing that needs a pine on the computer in front of the owner (`local: false`):
  no terminal, no voice input, no folder of this computer.
- Clearing the site's data in the browser forgets the key; the owner adds the new one to each
  machine again.
- What no suite of `npm test` reaches (the opaque origin, a message from another window, the token
  kept from the page) is proven by `npm run smoke` in `web/`, by hand before a release.
- Each pull request that touches the web client gets a deployment of its own, a Worker
  `pine-pr-<number>` deleted when it is closed, and `next` and `main` get theirs, `pine-next` and
  `pine-main`, on every push (amended by ADR 0004: these were first versions of one Worker under
  preview aliases, and the live version was deployed by hand).

## Amended by ADR 0004

Browser access adds a second kind of machine, a computer paired with the Pine app, reached peer to
peer. Two sentences above no longer hold as written:

- **"A host key is trusted only as the owner confirmed it."** There is now a second way: a
  pairing link (`#pair=<machine id>.<code>`, in the fragment, which no server sees) names the
  fingerprint of that computer's host key, which the owner scanned at that computer. It is accepted once, for
  the machine that link names alone, and never over a key kept for it already. Machines added as
  `user@host` keep the owner's confirmation, and a changed key is refused for both.
- **"The relay carries SSH and nothing else."** The same Worker carries SSH for the relay, which
  a configuration switches off (`RELAY`; on in every configuration of the repository, the official service included), and, for the meeting
  service, small opaque messages that set up a direct connection (at most 64 of 16 KiB each, for
  30 seconds). It keeps no storage and logs nothing: a Durable Object per paired computer holds that
  meeting's open sockets and nothing else. The conversation never passes through it.

The daemon is still reached through a direct-tcpip channel to a loopback and nowhere else; for
a paired computer that channel is opened by the Pine app's access server, which answers the remote
command itself. The bridge, the page in its iframe and the policies are unchanged.
