# The web client: how it is built, deployed and tested

For contributors. What an owner needs is in [references/web.md](../references/web.md); why it is
built so is in [ADR 0003](../adr/0003-web-client.md) and [ADR 0004](../adr/0004-browser-access.md).

`web/` is a package of its own, not part of what goes to npm. `web/relay/` is the Cloudflare
Worker that serves the build, the SSH relay and the meeting service.

## How it works

| Part | What it is |
|---|---|
| The web bridge | The top-level document (`web/src/bridge-main.ts`, `host.ts`). It holds the browser's key (a non-extractable WebCrypto key in IndexedDB), the machines and trusted host keys, the SSH connection and the daemon's token, and makes every call to the control API: the part `desktop/electron/main.ts` plays in the desktop app |
| The page | The desktop page (`desktop/src`), built for the browser, in an iframe sandboxed with scripts only, under an opaque origin. It asks the bridge by message; the bridge answers only that iframe, only a method of the fixed list (`web/src/protocol.ts`), with each argument checked. It carries the desktop page's content security policy. With no Web Storage of its own, what it keeps there (panel widths, what is folded) is kept by the bridge (`storage` in its prefs) and handed back at the next start |
| The relay | `/ssh` (`web/relay/src/relay.ts`): bytes between the browser's WebSocket and a TCP connection, nothing else. The browser has to open with `SSH-2.0-`, the server answer with `SSH-` within a few seconds. Public addresses only (no private, loopback, link-local or Cloudflare ones, checked after the name is looked up); to a Tailscale Funnel name (`.ts.net`, ports 443, 8443, 10000) it connects by that name through TLS and checks the certificate. 20 connections a minute per client address (the `LIMITER` binding, shared with the meeting routes and by all channels through one `namespace_id`). No state, no logs |
| The meeting service | Routes under `/meet/` (`web/relay/src/meet.ts`; one Durable Object per machine id in `meet-object.ts`). The computer waits under its key's fingerprint after signing a challenge with that key; a browser asks for that fingerprint; at most 64 messages of 16 KiB each cross within 30 seconds. No storage (its state is the open sockets), no logs |
| The peer transport | A WebRTC data channel between the web bridge and the Pine app (`web/src/peer.ts`; the computer's end is `desktop/electron/access/`), carrying SSH bytes as the relay's WebSocket does, in the top-level document, never in the iframe. STUN servers come from `GET /meet/config`. The service hands on each server's `urls` alone, so a TURN entry there is useless, and the Pine app drops it; the owner's own relay is set in the Pine app |

Over SSH the bridge runs `pine service` as `src/remote.ts` does (`web/src/remote-command.ts`, the
login shell's PATH) and reaches the daemon through a direct-tcpip channel to the server's loopback
and nowhere else: a service line that names another address is refused. Media are fetched by the
bridge through the same tunnel under the desktop app's rules (`MEDIA` in
`desktop/electron/daemon.ts`) and handed to the page as bytes. Addresses are opened by the bridge,
`http(s)` only, in a new tab with `noopener`.

A paired computer is reached the same way over its data channel: the Pine app's access server
answers that same command with its own daemon's line, opens a direct-tcpip channel to that
daemon's loopback port, and refuses everything else (a shell, file transfer, another command,
another port). It accepts only keys allowed at that computer.

## Deploying it

`wrangler.jsonc` has one configuration and no environment. Every deployment is a Worker of its
own made from it, named with `--name`, at `https://<name>.<account>.workers.dev`; without `--name`
it is `pine-dev`. `workers_dev: true`, `preview_urls: false` (a Worker that holds a Durable Object
gets no version preview addresses, which is why each channel is a Worker of its own), and Workers
Logs off.

| Step | Command |
|---|---|
| Install | `npm install` in `web/` and in `web/relay/` |
| Build | `npm run build` in `web/` (into `web/dist`) |
| Deploy | `npx wrangler deploy --name <yours>` in `web/relay/` |
| Try it on this computer | `npm run dev` in `web/relay/`: the same deployment on the loopback. Its relay still refuses this computer's addresses |

| Name | What it is |
|---|---|
| `RELAY` | `on` serves the SSH relay at `/ssh`; anything else refuses it. With the meeting service and the relay off, the web client offers pairing alone. On in `wrangler.jsonc`, so on every channel |
| `ICE` | The servers that help two devices connect directly, as `RTCIceServer`s, handed out by `GET /meet/config`. Default: `stun:stun.cloudflare.com:3478`. Only `urls` is handed on, so a TURN entry cannot work |
| `ANDROID_CERT_SHA256` | The SHA-256 fingerprint of the Android release key (`AA:BB:...`, from `keytool -list -v` or `apksigner verify --print-certs`). Public: a variable, not a secret. With it the service serves `/.well-known/assetlinks.json` and its pairing links open the Pine app on Android; without it, or with a value that is not a fingerprint, they open the browser. Not set in `wrangler.jsonc` yet |
| `/.well-known/assetlinks.json` | The App Links statement: the app `dev.pmndre.pine`, signed with the key `ANDROID_CERT_SHA256` names; 404 without one. The app declares only `pine-main`'s address, so another deployment that serves it still opens the browser |
| `RELAY_ALLOW_LOOPBACK` | The smoke's one way to the loopback, given to `wrangler dev` on its command line: a relay itself served on the loopback may reach the loopback. Never in a deployed configuration: `web/relay/test/loopback.test.ts` fails when `wrangler.jsonc`, `.dev.vars` or `.env` names it |

To make the official service's links open the Android app: take the release key's fingerprint,
write it as `ANDROID_CERT_SHA256` under `vars` in `web/relay/wrangler.jsonc`, push to `main`, and
check that `https://pine-main.drcmda.workers.dev/.well-known/assetlinks.json` answers it. Phones
check again at the app's next install or update.

## Previews of a pull request, of `next` and of `main`

| What | How |
|---|---|
| `web-preview.yml` | `.github/workflows/web-preview.yml`, on every pull request that changes a path listed in it (`web/` and every input of the page's build), and on every push to `next` or `main` that does |
| The gates | `npm run check` and `npm test` in `web/` and `web/relay/`, then `npm run build` in `web/`. The SSH core's tests run on an `sshd` and a Chrome for Testing the job installs |
| The preview | `npx wrangler deploy --name pine-pr-<number>`: the web client, the relay and the meeting service at `https://pine-pr-<number>.<account>.workers.dev`, deployed again on each push. Pairing can be tried there: give that address as `Service address` in the Pine app |
| The comment | The address is posted on the pull request as one comment, which each push updates |
| When the pull request is closed | `pine-pr-<number>` is deleted through Cloudflare's API (`DELETE .../workers/scripts/pine-pr-<number>?force=true`), merged or not. One never deployed is said not to exist, and the job passes |
| `next` and `main` | A push deploys `pine-next` or `pine-main`; the address is in the run's summary. `pine-main` is the official service: a push to `main` is how it changes. Moving its address makes every owner pair again |
| `web-preview` | The GitHub environment with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Only the deploy and delete steps get them; their `npm ci` runs without install scripts and without them |
| A pull request from a fork | Built and tested, never deployed: it never reaches the secrets |
| Without the secrets | The job passes and says "nothing deployed" (or "nothing deleted") |

One run at a time deploys a channel: a newer push, or the closing, replaces the run before it. The
Release workflow has no part in it.

## Working on it

| Command (in `web/` unless said) | What it does |
|---|---|
| `npm test` | The web bridge as the page calls it, in Node with a stand-in for SSH: the fixed list of methods, messages from another window ignored, host-key trust and change, `local: false`, media and link rules, reconnecting, a pairing link and a paired computer, and the choice on an iPhone or iPad. The SSH core against a real `sshd` on a loopback port in headless Chrome for Testing. The peer transport: the real bridge pairs with and reaches the Pine app's real access host under Node, through the meeting module on a loopback port (needs `npm install` in `desktop/`) |
| `npm run check` | Type check |
| `npm test`, `npm run check` in `web/relay/` | The relay with a stand-in TCP server: SSH only both ways, refused addresses, the cap per client address, TLS to a Funnel name and nothing else, and that no deployed configuration opens the loopback. The meeting module under Node: the computer's proof, the limits, a newer socket replacing an older one. The Worker's routes: `/meet/config`, the relay's switch, the App Links statement |
| `npm run smoke` | After `npm run build`: the deployment under `wrangler dev`, headless Chrome for Testing, an `sshd` of its own running the real `pine service` on a home of its own with the scripted model server. Named checks, each failing the run: the page cannot read the bridge's IndexedDB or the token; a message from another window is ignored; the first screen, its link to the SSH view and back; the fingerprint asked before the key is offered; a conversation answers; a picture shows; a link opens in a new tab; reconnecting after the relay restarts; a frame that navigates itself makes the whole client start anew. Then a computer paired by link on the same deployment (the access host under Node beside the same home's `pine service`, and a second browser): the meeting routes, pairing with the four digits, the computer's name, a conversation over a data channel with no `/ssh` socket, the policy and sandbox unchanged, reconnecting after the access host restarts. No outside STUN server is asked. Run it by hand before a release that changes `web/`, `web/relay/` or `desktop/electron/access/` |
