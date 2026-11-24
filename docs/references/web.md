# The web client: pine from a browser

The web client is the Pine app's page in a web browser, on any computer, connected to your own
pine on another machine over SSH: from a work laptop, a borrowed computer or a tablet, where you
cannot install anything. Nothing is installed on the computer you use: you open the
address of a deployment of the web client, and you are in your conversations, tabs, settings
and theme, as in the desktop app ([desktop.md](desktop.md)). It is for a pine that runs on a
server, a Mac mini at home or a VPS, which you reach with `ssh` from the internet, or a machine
on your Tailscale network that Tailscale Funnel publishes (see "A machine on a tailnet").
It is also how a phone or another computer uses the pine of the Pine app, with no SSH to set
up: paired by a QR code the app shows, and connected to it directly (see "A computer paired by
QR code"). The Pine app runs on a Mac today. The mobile app pairs with it the same way, with the
same QR code ([mobile.md](mobile.md#pairing-with-a-computer-that-runs-the-pine-app)).

It is a package of its own in pine's repository (`web/`), not part of what goes to npm. The
project runs it as one Worker for each channel, all from the same configuration and each a whole
deployment: `https://pine-main.drcmda.workers.dev`, the official service, deployed from every push
to `main`, for computers paired with the Pine app and for machines reached over SSH;
`https://pine-next.drcmda.workers.dev` from every push to `next`; and for a pull request to pine
that changes the web client, `https://pine-pr-<number>.drcmda.workers.dev`, deleted when it is
closed (see "Previews of a pull request"). Whoever runs another builds it and deploys it by hand,
at an address of their choosing.

## Using it

| What | How |
|---|---|
| The first screen | Every deployment of `wrangler.jsonc` offers both ways in, the official service included: two views, never shown together. First, how to pair a computer, with "Found through" and the deployment's address under it, and under that a discreet link, "Or connect to a server over SSH". That link shows the SSH view: a back control at its top ("Back to pairing"), the list of machines, this device's key and the field to add a `user@host` machine, with one line under it that names the relay: "Connections go through the relay at" the deployment's address, which "carries SSH only and cannot read it". A deployment whose configuration dropped the meeting service shows the SSH view alone; one whose relay is off shows the pairing view alone, without the link. A browser that has a `user@host` machine already starts on the SSH view. The view you chose lasts for the visit and is not kept |
| Open it | The deployment's address, in Chrome 137 or later, Firefox 130 or later, or Safari 17 or later. Another browser, without Ed25519 in WebCrypto, is told which browsers work and nothing else starts |
| This device's key | On first use the browser makes an SSH key of its own (Ed25519) and keeps it. The start screen shows its public half as a line of `authorized_keys`, with Copy and Share. Add that line to `~/.ssh/authorized_keys` of the user you sign in as on your server. The key is kept in the browser's own storage for this site, where the page cannot reach it: its private half cannot be read or exported, by you or by any script, and a web page an answer shows cannot steal it; no other key can be used (no pasted key, no ssh-agent, no security key) |
| Add a machine | Type it as `user@host`, or `user@host:port` for SSH on another port, and Add. A host is a name or an address on the internet: the relay refuses private, loopback and link-local addresses, so a server on your home network is reached from the desktop app instead, or through Tailscale Funnel (see "A machine on a tailnet") |
| The host key | The first time, the machine's host key fingerprint (`SHA256:...`) is shown before anything of yours is sent. Compare it with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server, and trust it. From then on that fingerprint and no other is accepted: a changed key is refused with the old and the new fingerprint, and nothing connects until you forget the machine and add it again |
| Disconnect | Disconnect lets go of the machine in use and goes back to the list of machines. The machine and its trusted host key stay, unlike Forget, and Use connects to it again. It is in the machines menu of the title bar, on the line of the machine in use in Settings > Environments, and on the start screen |
| Forget a machine | Forget on its line. Its trusted host key goes with it |
| What is remembered | In this browser only: its key, your machines, their trusted host keys, the one in use, and the page's own preferences (theme, the side panel's widths, what is folded). Clearing the site's data in the browser forgets all of it, the key included: add the new key to the server again |
| Pictures, video and sound | Shown and played as in the desktop app |
| Links in answers | Open in a new tab of the browser, with their address shown beside them. The page itself never goes anywhere |
| A dropped connection | The network, a Wi-Fi change or a new deployment of the relay: the client connects again by itself, waiting a little longer each time, and the conversation goes on where it was. It tries at once when the network comes back or the tab is shown again |
| What it cannot do | What needs a pine on the computer in front of you: this computer's pine, the terminal beside a conversation, voice input, picking a folder of this computer, starting or updating pine. The page knows it has no machine of its own (`local: false`) and does not offer them |

When a machine is not reached, the start screen says why, in words that say what to do:

| It says | What to check |
|---|---|
| The relay did not open a connection | The address is a public one; the relay allows a browser a few connections a minute: wait a minute |
| could not be reached on port ... | The machine is on, SSH listens on that port, and its firewall lets connections in from the internet |
| answers ..., but not with SSH | The port |
| did not answer through Tailscale Funnel | Funnel is on for that port on the machine (see "A machine on a tailnet"), and the machine is on |
| did not accept this browser's key | The line of This device's key is in `~/.ssh/authorized_keys` of that user |
| pine is not installed ... / too old | Install or update pine there (`pine update`); it must be on the PATH of the login shell |
| pine ... is not answering | `pine status` there, or restart it |

## A machine on a tailnet

A machine that is only on your Tailscale network (a tailnet) has no address the relay may
reach: Tailscale's own addresses (`100.64.0.0/10`) are refused like any private one. Tailscale
Funnel publishes the machine's `sshd` on the internet instead, behind Tailscale's TLS, at the
machine's name in the tailnet, `<machine>.<tailnet>.ts.net`. The relay opens TLS to any host
whose name ends in `.ts.net`, checks the certificate for that name, and carries SSH inside it:
SSH, the host key and this browser's key are end to end as for any machine.

| What | How |
|---|---|
| Turn it on | On the machine: `tailscale funnel --bg --tls-terminated-tcp=10000 tcp://localhost:22`. Funnel has to be allowed for the tailnet and the machine (Tailscale asks the first time, with a link to its admin console) |
| The machine to add | `user@<machine>.<tailnet>.ts.net:10000`, in the web client's machines as any other. The full name is in `tailscale funnel status` on the machine |
| `tailscale funnel` ports | Funnel serves only ports 443, 8443 and 10000. The relay refuses a `.ts.net` name on any other port, and opens TLS on these to `.ts.net` names only |
| Turn it off | `tailscale funnel --tls-terminated-tcp=10000 off`, or `tailscale funnel reset` for everything Funnel serves on the machine |
| What it opens | The machine's `sshd` on the internet, for anyone, behind Tailscale's TLS. Have it take keys only (`PasswordAuthentication no` in `sshd_config`), as for any machine the web client reaches |

## A computer paired by QR code: a browser with no SSH to set up

With the Pine app on your computer there is a second way in, which needs no SSH, no key in
`authorized_keys` and no address: the app's pine, paired by scanning a QR code. Turn on Settings >
Browser access in the app once, then choose Pine > Add a device ([desktop.md](desktop.md#browser-access-a-browser-with-no-ssh-to-set-up)). The
phone and the computer talk directly, peer to peer, from anywhere; the service only introduces
them (why: [ADR 0004](../adr/0004-browser-access.md)).

| What | How |
|---|---|
| `https://pine-main.drcmda.workers.dev` | The project's own service, the official one: the web client, the meeting service and the SSH relay, at the address the Pine app uses by default, deployed from every push to `main`. Its start screen says how to pair ("On your computer: Pine > Add a device", then scan the code), with "Open Pine on this computer" in a browser on a computer, a link to the Pine app, and SSH behind a link (see "The first screen"). It costs the project nothing; at the free plan's limits it says so and you try again later |
| Pair | Scan the QR code on the computer with the phone's camera, or open the link Copy link gave on the device. The page shows four digits and "Confirm on" the computer's name, which the computer gives with the digits ("your computer" where an older Pine app gives none); the computer shows the same four and asks. After Allow you are in your conversations. The link works once and for two minutes, and leaves the address bar at once, so no history entry or bookmark keeps it |
| `Open Pine on this computer` | On the start screen, in a browser on a computer (not on a phone or a tablet), to pair this browser with the Pine app on the same computer, with no camera and no link to copy. It opens `pine://pair`, and the browser asks first whether to open Pine. Where Pine runs with Browser access on, it opens a pairing and sends its link to your default browser, which pairs as a scanned link does; the app shows the same code in its Add a device dialog, for a browser that is not the default one. Without the Pine app, or with Browser access off, nothing happens. The web client cannot look for computers on the network itself: only the mobile app finds one without a code ([mobile.md](mobile.md#a-computer-on-this-network)) |
| `Open in the Pine app` | On an iPhone or iPad only, where a scanned link always opens the browser (the Pine app there is signed by each owner, so iOS cannot hand it a web address): before it uses the code, the page asks "Pair with your computer" with two buttons. "Open in the Pine app" opens the app by its `pine:` address, which carries the service's address, the computer's fingerprint and the code, and uses nothing in the browser; the choice stays on screen with a note, so that an owner without the app can still go on. `Continue in this browser` pairs this browser, as on any other device. The code works once: whichever pairs first uses it, and the other is told that the link expired. Every other device sees no choice. On Android the app opens the link itself, when it is installed (see `/.well-known/assetlinks.json` under "Deploying it") |
| The computer's identity | The link carries the fingerprint of the computer's host key: the web client trusts it for that computer alone, with no question to you, and refuses a computer that answers with another. A fingerprint it keeps already is never replaced by a link |
| Its name | The name the computer gave when it was paired (`paired:` and the fingerprint inside). The browser does not know what kind of computer is at the other end: it says "your computer" until the pairing, and that name from then on, in the list and in what the start screen says. Rename in Settings > Environments gives it another; Forget there drops it from the list here. Only Remove in the app shuts the device out |
| Coming back | By itself, each time the web client is opened, and after the phone was locked or the network changed, waiting a little longer each time |
| `Add to Home screen` | Suggested once after the first pairing, on Android only, where the installed web app keeps this browser's key. Not on iOS, where an installed web app may not keep the key of the Safari tab that paired |
| `user@host` and paired computers | Side by side on a deployment with the relay on and the meeting service, which every deployment of `wrangler.jsonc` is (see "Deploying it"), the official service included. Settings > Environments says of each machine how it is reached: a paired computer is "Found through" the deployment's address, and the connection is then made between the two devices, "directly or through a relay server the computer's owner named"; a `user@host` machine goes "Through the relay at" that address |

### When a paired computer does not answer

The start screen says why, with the computer's name where the table says "Studio Mac" (a name
an owner gave theirs), and "your computer" while it is being paired:

| It says | What to do |
|---|---|
| Studio Mac does not answer: it is off, asleep, or Pine is closed | Wake the computer or open Pine; check that Browser access is on. The browser keeps trying |
| Studio Mac is there, but no direct connection could be made from this network | Some networks, often a phone's data, do not let two devices connect directly. Try another Wi-Fi, or the phone's data instead of the Wi-Fi. The project runs no relay, but the owner of the computer can name one of their own in the Pine app (Settings > Browser access, `Relay server (TURN)` in [desktop.md](desktop.md#a-relay-server-of-your-own-for-a-phone-that-cannot-connect-from-mobile-data)): the connection then goes through it, and the browser needs nothing for it |
| The meeting service is over its limits for now | Wait and try again; the browser keeps trying |
| This browser is no longer known to Studio Mac | The device was removed in the app, or the key was lost. Open Pine on the computer and add this device again |
| This pairing link has expired or was used already | Press New code on the computer and scan again |
| Your computer refused this browser | Refuse was pressed, or the four digits were not the same. Add the device again |

### Two more things it can say while pairing

| It says | What to do |
|---|---|
| The meeting service could not be reached | There is no network here, or the service is down. Check the network, then try again |
| The computer that answered is not the one this pairing link names | Nothing was trusted. Pair again with a new code |

## How it works

The parts, served as one deployment from one address (why it is built so: [ADR 0003](../adr/0003-web-client.md)):

| Part | What it is |
|---|---|
| The web bridge | The top-level document (`web/src/bridge-main.ts`, `host.ts`). It holds the browser's key (a non-extractable WebCrypto key in IndexedDB), the machines and trusted host keys, the SSH connection and the daemon's token, and makes every call to the control API. It plays the part the desktop app's main process plays (`desktop/electron/main.ts`) |
| The page | The Pine app's page (`desktop/src`), built for the browser, in an iframe sandboxed with scripts only. It runs under an opaque origin, so nothing it draws (an answer can repeat a web page) can read the bridge's storage, key or token. It asks the bridge by message, and the bridge answers only that iframe, only a method of a fixed list (`web/src/protocol.ts`), with its arguments checked one by one. It carries the same content security policy as the desktop page: it loads nothing from the web. Under its opaque origin the page has no Web Storage of its own, which would keep nothing across a reload: what it keeps there (the side panel's widths, what is folded) is kept by the web bridge instead (`storage` in its prefs) and handed back at the next start |
| The relay | A Cloudflare Worker at `/ssh` (`web/relay`) that carries bytes between the browser's WebSocket and a TCP connection to your server, and nothing else. SSH runs in the browser, end to end, so the relay sees neither key nor token. It carries only SSH (the browser has to open with `SSH-2.0-`, the server answer with `SSH-` within a few seconds), reaches only public addresses (no private, loopback, link-local or Cloudflare ones, checked after a name is looked up), opens TLS to a Tailscale Funnel name (`.ts.net`, connected to by that name, its certificate checked for it), caps connections per client address, keeps no state and logs nothing of what it carries. Switched by `RELAY` in the Worker's configuration: on in every configuration of `wrangler.jsonc`, the official service included. There it is an SSH relay open to anyone: limited to 20 connections a minute per client address, SSH only, public addresses only |
| The meeting service | Routes of the same Worker under `/meet/` (`web/relay/src/meet.ts`, one Durable Object per paired computer in `meet-object.ts`), on every deployment of `wrangler.jsonc`, a pull request's included. The computer waits there under the fingerprint of its key, after it signed a challenge with that key; a browser asks for that fingerprint; the few messages that set up a direct connection cross (at most 64, of 16 KiB each, within 30 seconds), and the service is out of it. It never carries the conversation, keeps no storage (its state is the open sockets) and logs nothing |
| The peer transport | A WebRTC data channel between the web bridge and the Pine app (`web/src/peer.ts`; the computer's end is `desktop/electron/access/`), which carries SSH bytes as the relay's WebSocket does: SSH stays end to end, in the top-level document, never in the page's iframe. The servers that help two devices find a way (STUN) come from the service (`/meet/config`). The service names no relay of the bytes (TURN), and one it named could not be used: the service and the web bridge keep only each server's address, never a user name or a credential; the computer's owner may name one of their own in the Pine app ([desktop.md](desktop.md#a-relay-server-of-your-own-for-a-phone-that-cannot-connect-from-mobile-data)), which only the computer's side uses: the browser is given nothing for it |

Over SSH the bridge runs `pine service` as `src/remote.ts` does (the PATH of your login shell
there), which attaches to the daemon that runs there or starts one. The daemon's port is reached
through a direct-tcpip channel to the server's loopback and nowhere else: a service line that
names another address is refused. So the control API stays closed to the network there, as it
is on any machine. Pictures, video and sound are fetched by the bridge through the same tunnel,
under the desktop app's rules for media (`MEDIA` in `desktop/electron/daemon.ts`), and handed to
the page as bytes. An address to open is opened by the bridge, only `http(s)`, in a new tab
that has no hold on the client (`noopener`).

A paired computer is reached the same way, over its data channel: the Pine app's access server
answers that same command itself with the line of that computer's own daemon, opens a direct-tcpip
channel to that daemon's loopback port and nowhere else, and refuses everything else (a shell,
file transfer, another command, another port). It accepts only the keys allowed at that computer.

## Deploying it

| Step | Command |
|---|---|
| Install | `npm install` in `web/` and in `web/relay/` |
| Build the page and the bridge into `web/dist` | `npm run build` in `web/` |
| Deploy the Worker with `web/dist` as its static files | `npx wrangler deploy --name <yours>` in `web/relay/` (with your Cloudflare account; `wrangler.jsonc` holds the Worker's rate limit, its files, the meeting service's Durable Object and its variables): the web client, the relay and the meeting service side by side, at `https://<yours>.<account>.workers.dev`. Then write that address in the Pine app's Settings > Browser access, so that your computer waits there and its QR codes point there. Without `--name` the Worker is `pine-dev` |
| `--name` | The Worker's name, and so its address. `wrangler.jsonc` has one configuration and no environment: the project's channels are that configuration under the names `pine-main`, `pine-next` and `pine-pr-<number>`, deployed by the workflow (see "Previews of a pull request"). A browser's key and its paired computers belong to an address: moving the official one makes every owner pair again |
| `RELAY` | `on` serves the SSH relay at `/ssh`; anything else refuses it. On a deployment with the meeting service the web client then offers no `user@host` field and no link to it, only pairing; on one without, it still shows the `user@host` field, whose machines the relay refuses |
| `ICE` | The servers that help a browser and a paired computer connect directly, as `RTCIceServer`s, handed to both by `GET /meet/config`: a public STUN server by default. The list of STUN servers is the service's configuration. A relay of the bytes (TURN) in that list cannot be used: the service hands on each server's `urls` alone, without a user name or a credential, so it reaches every client without them, and the Pine app drops it, keeping only `stun:` and `stuns:` addresses. A computer's owner who needs a relay sets one of their own in the Pine app (`Relay server (TURN)` in [desktop.md](desktop.md#a-relay-server-of-your-own-for-a-phone-that-cannot-connect-from-mobile-data)) |
| `ANDROID_CERT_SHA256` | The SHA-256 fingerprint of the key the Android app's releases are signed with (`AA:BB:...`, as `keytool -list -v` or `apksigner verify --print-certs` writes it). Public: a variable in `wrangler.jsonc`, not a secret. With it the service serves `/.well-known/assetlinks.json`, and its pairing links open the Pine app on Android. Without it, or with a value that is not such a fingerprint, they open the browser |
| `/.well-known/assetlinks.json` | The statement Android reads before it lets the Pine app open the service's links (App Links): the app `dev.pmndre.pine`, signed with the key `ANDROID_CERT_SHA256` names. 404 where none is named. Only the official service's address is declared by the app, so a deployment of your own that serves it opens the browser all the same |
| The official service's statement | Done once by the maintainer: take the release key's fingerprint (`keytool -list -v -keystore release.jks -alias <alias>`, the line "SHA256:", or `apksigner verify --print-certs` on a released APK), write it as `ANDROID_CERT_SHA256` under `vars` in `web/relay/wrangler.jsonc`, push it to `main` (the workflow deploys `pine-main`), and check that `https://pine-main.drcmda.workers.dev/.well-known/assetlinks.json` answers it. A phone that installed the app before checks again at the app's next update |
| Try it on this computer | `npm run dev` in `web/relay/` serves the same deployment on the loopback, the meeting service included. Its relay still refuses this computer's addresses |

The configuration turns Workers Logs off, so that nothing of the bytes carried is kept. It gives
each Worker its address on `workers.dev` (`workers_dev: true`) and no version preview addresses
(`preview_urls: false`): a Worker that holds a Durable Object gets none. That is why each channel
is a Worker of its own rather than a version of one Worker, and why a pull request's deployment
has the meeting service and can pair like the official one.

## Previews of a pull request, of `next` and of `main`

| What | How |
|---|---|
| `web-preview.yml` | The workflow `.github/workflows/web-preview.yml`, on every pull request that changes one of the paths listed in it (`web/` and every input of the page's build), and on every push to `next` or `main` that does |
| The gates | `npm run check` and `npm test` in `web/` and in `web/relay/`, then `npm run build` in `web/`, as by hand. The SSH core's tests run on an `sshd` and a Chrome for Testing that the job installs |
| The preview | `npx wrangler deploy --name pine-pr-<number>` in `web/relay/`: a Worker of its own with that build, the web client, the relay and the meeting service, at `https://pine-pr-<number>.<account>.workers.dev`. Each push deploys it again, so the address stays the same. Pairing can be tried there: give that address as the `Service address` in the Pine app's Settings > Browser access |
| When the pull request is closed | the Worker `pine-pr-<number>` is deleted through Cloudflare's API (`DELETE .../workers/scripts/pine-pr-<number>?force=true`), merged or not. A Worker that was never deployed (no secrets then) is said not to exist, and the job passes |
| `next` and `main` | A push to either deploys the Worker of its branch: `https://pine-next.<account>.workers.dev` and `https://pine-main.<account>.workers.dev`, each the latest build of that branch. `pine-main` is the official service. The address is in the run's summary |
| The comment | The address is posted on the pull request as one comment, which each push updates |
| `web-preview` | The GitHub environment that holds `CLOUDFLARE_API_TOKEN` (a token that can edit Workers scripts on that account) and `CLOUDFLARE_ACCOUNT_ID`. Only the jobs that deploy and delete name it, and only their deploy and delete steps are given the two: their `npm ci` runs without install scripts and without them |
| A pull request from a fork | Built and tested, never deployed: the jobs that deploy and delete run only for a branch of pine's own repository, and a fork never gets the secrets |
| Without the secrets | The job passes and says "nothing deployed" (or "nothing deleted"), on the pull request and in its summary |

One run at a time deploys a channel: a newer push to a pull request, or its closing, replaces the
run before it. The Release workflow has no part in it. A deployment reaches what any deployment
reaches, a machine with a public SSH address or one on a tailnet through Tailscale Funnel (see
"A machine on a tailnet"), and keeps nothing. The channels share one rate limit per client address
(the same `namespace_id`).

## Working on it

| Command (in `web/` unless said) | What it does |
|---|---|
| `npm test` | The web bridge as the page calls it, in Node with a stand-in for SSH: the fixed list of methods, messages from another window ignored, host-key trust and change, `local: false`, media and link rules, reconnecting, a pairing link and a paired computer, and the choice on an iPhone or iPad (the code unused before the choice, each button doing what it says, no choice on other devices). The SSH core against a real `sshd` on a loopback port in headless Chrome for Testing. And the peer transport there too: the real bridge pairs with and reaches the Pine app's real access host under Node, through the meeting module on a loopback port |
| `npm run check` | Type check |
| `npm test`, `npm run check` in `web/relay/` | The relay's fetch handler with a stand-in TCP server: SSH only both ways, refused addresses, the cap per client address, TLS to a Funnel name and to nothing else; and that no deployed configuration opens the loopback. The meeting module under Node with stand-in sockets: the computer's proof, the limits, a newer socket in place of an older one; and the Worker's routes, `/meet/config`, the relay's switch and the statement for App Links (served for a fingerprint, 404 without one) |
| `npm run smoke` | After `npm run build`: the deployment under `wrangler dev`, headless Chrome for Testing, a `sshd` of its own on the loopback running the real `pine service` on a home of its own with the scripted model server. Named checks, each of which fails the run: the page cannot read the bridge's IndexedDB or the daemon's token; a message to the bridge from another window is ignored; the first screen shows how to pair first, its link leads to the SSH view, which names the deployment's host as the relay's, and its back control returns; the first connect asks for the fingerprint before the key is offered; a conversation answers; a picture shows; a link opens in a new tab; the client connects again after the relay restarts; a frame that navigates itself makes the whole client start anew, and its new document is told nothing unasked. Then a computer paired by link on the same deployment, the meeting service beside the relay: the Pine app's access host under Node beside the same home's `pine service`, and a second browser. The meeting routes answer; pairing completes with the four digits the browser shows; the computer is listed under the name it gave; a conversation answers over a data channel, and no `/ssh` socket was opened for it; the page's policy and the iframe's sandbox are unchanged; after the access host restarts the browser connects again by itself. No STUN server outside this computer is asked. Run it by hand before a release that changes `web/`, `web/relay/` or `desktop/electron/access/` |

The smoke's relay has to reach `sshd` on this computer, which a relay refuses:

| Name | What it is |
|---|---|
| `RELAY_ALLOW_LOOPBACK` | The smoke's one way to the loopback. `npm run smoke` gives `wrangler dev` `RELAY_ALLOW_LOOPBACK=1` on its command line: it lets a relay that is itself served on the loopback reach the loopback, and nothing else. It is never in a deployed configuration: `web/relay/test/loopback.test.ts` fails when `wrangler.jsonc`, `.dev.vars` or `.env` names it |
