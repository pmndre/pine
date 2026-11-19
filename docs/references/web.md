# The web client: pine from a browser

The web client is the Pine app's page in a web browser, on any computer, connected to your own
pine on another machine over SSH: from a work laptop, a borrowed computer or a tablet, where you
cannot install anything. Nothing is installed on the computer you use: you open the
address of a deployment of the web client, and you are in your conversations, tabs, settings
and theme, as in the desktop app ([desktop.md](desktop.md)). It is for a pine that runs on a
server, a Mac mini at home or a VPS, which you reach with `ssh` from the internet, or a machine
on your Tailscale network that Tailscale Funnel publishes (see "A machine on a tailnet").

It is a package of its own in pine's repository (`web/`), not part of what goes to npm. Whoever
runs a deployment of it builds it and deploys it by hand; the address is theirs to choose. A pull
request to pine that changes the web client gets a preview address of its own (see "Previews of a
pull request").

## Using it

| What | How |
|---|---|
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

## How it works

Three parts, served as one deployment from one address (why it is built so: [ADR 0003](../adr/0003-web-client.md)):

| Part | What it is |
|---|---|
| The web bridge | The top-level document (`web/src/bridge-main.ts`, `host.ts`). It holds the browser's key (a non-extractable WebCrypto key in IndexedDB), the machines and trusted host keys, the SSH connection and the daemon's token, and makes every call to the control API. It plays the part the desktop app's main process plays (`desktop/electron/main.ts`) |
| The page | The Pine app's page (`desktop/src`), built for the browser, in an iframe sandboxed with scripts only. It runs under an opaque origin, so nothing it draws (an answer can repeat a web page) can read the bridge's storage, key or token. It asks the bridge by message, and the bridge answers only that iframe, only a method of a fixed list (`web/src/protocol.ts`), with its arguments checked one by one. It carries the same content security policy as the desktop page: it loads nothing from the web. Under its opaque origin the page has no Web Storage of its own, which would keep nothing across a reload: what it keeps there (the side panel's widths, what is folded) is kept by the web bridge instead (`storage` in its prefs) and handed back at the next start |
| The relay | A Cloudflare Worker at `/ssh` (`web/relay`) that carries bytes between the browser's WebSocket and a TCP connection to your server, and nothing else. SSH runs in the browser, end to end, so the relay sees neither key nor token. It carries only SSH (the browser has to open with `SSH-2.0-`, the server answer with `SSH-` within a few seconds), reaches only public addresses (no private, loopback, link-local or Cloudflare ones, checked after a name is looked up), opens TLS to a Tailscale Funnel name (`.ts.net`, connected to by that name, its certificate checked for it), caps connections per client address, keeps no state and logs nothing of what it carries |

Over SSH the bridge runs `pine service` as `src/remote.ts` does (the PATH of your login shell
there), which attaches to the daemon that runs there or starts one. The daemon's port is reached
through a direct-tcpip channel to the server's loopback and nowhere else: a service line that
names another address is refused. So the control API stays closed to the network there, as it
is on any machine. Pictures, video and sound are fetched by the bridge through the same tunnel,
under the desktop app's rules for media (`MEDIA` in `desktop/electron/daemon.ts`), and handed to
the page as bytes. An address to open is opened by the bridge, only `http(s)`, in a new tab
that has no hold on the client (`noopener`).

## Deploying it

| Step | Command |
|---|---|
| Install | `npm install` in `web/` and in `web/relay/` |
| Build the page and the bridge into `web/dist` | `npm run build` in `web/` |
| Deploy the Worker with `web/dist` as its static files | `npx wrangler deploy` in `web/relay/` (with your Cloudflare account; `wrangler.jsonc` names the Worker, its rate limit and its files) |
| Try it on this computer | `npm run dev` in `web/relay/` serves the same deployment on the loopback; its relay still refuses this computer's addresses |

No workflow deploys it: the Worker's live version changes only by hand. The configuration that
is deployed turns Workers Logs off, so that nothing of the bytes carried is kept, and gives the
Worker no live address on `workers.dev` (`workers_dev: false`), only preview addresses.

## Previews of a pull request

| What | How |
|---|---|
| `web-preview.yml` | The workflow `.github/workflows/web-preview.yml`, on every pull request that changes one of the paths listed in it (`web/` and every input of the page's build) |
| The gates | `npm run check` and `npm test` in `web/` and in `web/relay/`, then `npm run build` in `web/`, as by hand. The SSH core's tests run on an `sshd` and a Chrome for Testing that the job installs |
| The preview | `npx wrangler versions upload --preview-alias pr-<number>` in `web/relay/`: a version of the Worker with that build, not made live, at `https://pr-<number>-pine-relay.<account>.workers.dev`. Each push uploads a new version under the same alias, so the address stays the same |
| The comment | The address is posted on the pull request as one comment, which each push updates |
| `web-preview` | The GitHub environment that holds `CLOUDFLARE_API_TOKEN` (a token that can edit Workers scripts on that account) and `CLOUDFLARE_ACCOUNT_ID`. Only the job that uploads names it, and only its upload step is given the two: its `npm ci` runs without install scripts and without them |
| A pull request from a fork | Built and tested, never previewed: the job that uploads runs only for a branch of pine's own repository, and a fork never gets the secrets |
| Without the secrets | The job passes and says "nothing deployed", on the pull request and in its summary |

Nothing is deployed from `next` or `main`, and the Release workflow has no part in it. A preview
reaches what any deployment reaches, a machine with a public SSH address or one on a tailnet
through Tailscale Funnel (see "A machine on a tailnet"), and keeps nothing.

## Working on it

| Command (in `web/` unless said) | What it does |
|---|---|
| `npm test` | The web bridge as the page calls it, in Node with a stand-in for SSH: the fixed list of methods, messages from another window ignored, host-key trust and change, `local: false`, media and link rules, reconnecting. And the SSH core against a real `sshd` on a loopback port in headless Chrome for Testing |
| `npm run check` | Type check |
| `npm test`, `npm run check` in `web/relay/` | The relay's fetch handler with a stand-in TCP server: SSH only both ways, refused addresses, the cap per client address, TLS to a Funnel name and to nothing else; and that no deployed configuration opens the loopback |
| `npm run smoke` | After `npm run build`: the deployment under `wrangler dev`, headless Chrome for Testing, a `sshd` of its own on the loopback running the real `pine service` on a home of its own with the scripted model server. Named checks, each of which fails the run: the page cannot read the bridge's IndexedDB or the daemon's token; a message to the bridge from another window is ignored; the first connect asks for the fingerprint before the key is offered; a conversation answers; a picture shows; a link opens in a new tab; the client connects again after the relay restarts; a frame that navigates itself makes the whole client start anew, and its new document is told nothing unasked. Run it by hand before a release that changes `web/` |

The smoke's relay has to reach `sshd` on this computer, which a relay refuses:

| Name | What it is |
|---|---|
| `RELAY_ALLOW_LOOPBACK` | The smoke's one way to the loopback. `npm run smoke` gives `wrangler dev` `RELAY_ALLOW_LOOPBACK=1` on its command line: it lets a relay that is itself served on the loopback reach the loopback, and nothing else. It is never in a deployed configuration: `web/relay/src/relay.test.ts` fails when `wrangler.jsonc`, `.dev.vars` or `.env` names it |
