# The web client

The web client is the Pine app's page in a web browser, on any computer, with nothing to install:
from a work laptop, a borrowed computer or a tablet. This chapter covers using it, reaching a
machine with it, and what the service behind it sees.

You open the address of a deployment and are in your conversations, tabs, settings and theme, as
in the desktop app ([desktop.md](desktop.md)). It reaches your pine two ways:

- **Over SSH**: a pine on a server, a Mac mini at home or a VPS that you reach with `ssh` from the
  internet, or a machine on your tailnet published by Tailscale Funnel (see "A machine on a
  tailnet").
- **Paired by QR code** with a computer that runs the Pine app, with no SSH to set up, connected
  to it directly (see "A computer paired by QR code"). The mobile app pairs the same way
  ([mobile.md](mobile.md#pairing-with-a-computer-that-runs-the-pine-app)).

The official service is `https://pine-main.drcmda.workers.dev`: the web client, the SSH relay and
the meeting service, and the address the Pine app uses by default. You can also run your own (see
"Deploying it").

## Using it

| What | How |
|---|---|
| Open it | The deployment's address, in Chrome 137 or later, Firefox 130 or later, or Safari 17 or later. Another browser is told which browsers work, and nothing starts |
| The first screen | How to pair a computer, and under it the link "Or connect to a server over SSH" to the SSH view: your machines, this device's key, the field to add a `user@host` machine, and the relay it goes through. A browser that has a `user@host` machine already starts on the SSH view. A deployment without the meeting service shows the SSH view alone; one whose relay is off shows pairing alone |
| This device's key | On first use the browser makes an SSH key of its own (Ed25519). The start screen shows its public half as a line of `authorized_keys`, with Copy and Share: add it to `~/.ssh/authorized_keys` of the user you sign in as. The key is kept in the browser's storage for this site; its private half cannot be read or exported by you or by any script, so a web page an answer shows cannot steal it. No other key can be used (no pasted key, no ssh-agent, no security key) |
| Add a machine | Type `user@host`, or `user@host:port`, and Add. The host must have a public name or address: the relay refuses private, loopback and link-local addresses. A server on your home network is reached from the desktop app instead, or through Tailscale Funnel |
| The host key | The first time, the machine's host key fingerprint (`SHA256:...`) is shown before anything of yours is sent. Compare it with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server, and trust it. From then on only that key is accepted: a changed key is refused with the old and the new fingerprint, until you forget the machine and add it again |
| Disconnect | Lets go of the machine in use and goes back to the list. The machine and its trusted host key stay (unlike Forget); Use connects again. In the title bar's machines menu and on the machine's line in Settings > Environments |
| Forget a machine | Forget on its line. Its trusted host key goes with it |
| What is remembered | In this browser only: its key, your machines, their host keys, the one in use, and the page's preferences (theme, panel widths, what is folded). Clearing the site's data forgets all of it, the key included: add the new key to the server again |
| A pine with no model | Opens **Setup Pine** ([desktop.md](desktop.md#setup-pine-getting-started)). It looks for model servers on the machine pine runs on, not on the computer in front of you |
| Pictures, video and sound | Shown and played as in the desktop app |
| Links in answers | Open in a new tab, with their address shown beside them. The page itself never navigates away |
| A dropped connection | The client connects again by itself, waiting a little longer each time, and the conversation goes on where it was. It tries at once when the network comes back or the tab is shown again |
| What it cannot do | What needs a pine on the computer in front of you: this computer's pine, the terminal beside a conversation, voice input, picking a folder of this computer, starting or updating pine |

When a machine is not reached, the start screen says why:

| It says | What to check |
|---|---|
| The relay did not open a connection | The address is a public one. The relay allows a browser a few connections a minute: wait a minute |
| could not be reached on port ... | The machine is on, SSH listens on that port, and its firewall lets connections in from the internet |
| answers ..., but not with SSH | The port |
| did not answer through Tailscale Funnel | Funnel is on for that port on the machine, and the machine is on (see "A machine on a tailnet") |
| did not accept this browser's key | The line of This device's key is in `~/.ssh/authorized_keys` of that user |
| pine is not installed ... / too old | Install or update pine there (`pine update`); it must be on the PATH of the login shell |
| pine ... is not answering | `pine status` there, or restart it |

## A machine on a tailnet

A machine that is only on your Tailscale network has no address the relay may reach: Tailscale's
addresses (`100.64.0.0/10`) are refused like any private one. Tailscale Funnel publishes the
machine's `sshd` on the internet instead, behind Tailscale's TLS, at
`<machine>.<tailnet>.ts.net`. The relay opens TLS to such a name, checks its certificate, and
carries SSH inside it: SSH, the host key and this browser's key stay end to end.

| What | How |
|---|---|
| Turn it on | On the machine: `tailscale funnel --bg --tls-terminated-tcp=10000 tcp://localhost:22`. Funnel has to be allowed for the tailnet and the machine (Tailscale asks the first time) |
| The machine to add | `user@<machine>.<tailnet>.ts.net:10000`. The full name is in `tailscale funnel status` |
| `tailscale funnel` ports | Funnel serves only ports 443, 8443 and 10000; the relay refuses a `.ts.net` name on any other port |
| Turn it off | `tailscale funnel --tls-terminated-tcp=10000 off`, or `tailscale funnel reset` |
| What it opens | The machine's `sshd` on the internet, for anyone, behind Tailscale's TLS. Have it take keys only (`PasswordAuthentication no` in `sshd_config`) |

## A computer paired by QR code: a browser with no SSH to set up

With the Pine app on your computer, a browser needs no SSH, no key in `authorized_keys` and no
address. Turn on Settings > Browser access in the app once, then Add a device
([desktop.md](desktop.md#browser-access-a-browser-with-no-ssh-to-set-up)). The browser and the
computer then talk directly, peer to peer, from anywhere; the service only introduces them.

| What | How |
|---|---|
| `https://pine-main.drcmda.workers.dev` | The official service. Its start screen says how to pair ("On your computer: Pine > Add a device", then scan the code), offers "Get the Pine app", "Open Pine on this computer" in a browser on a computer, and SSH behind a link. When the service is over its limits it says so: try again later |
| Pair | Scan the QR code with the phone's camera, or open the link Copy link gave on the device. The page shows four digits and "Confirm on" the computer's name; the computer shows the same four and asks. Press Allow only if they match. The link works once and for two minutes, and leaves the address bar at once, so no history entry or bookmark keeps it |
| `Open Pine on this computer` | On the start screen in a browser on a computer (not a phone or tablet): pairs this browser with the Pine app on the same computer, with no camera and no link to copy. The browser asks first whether to open Pine; with Browser access on, Pine opens a pairing and sends its link to your default browser. Without the Pine app, or with Browser access off, nothing happens. The web client cannot look for computers on the network: only the mobile app does ([mobile.md](mobile.md#a-computer-on-this-network)) |
| `Open in the Pine app` | On an iPhone or iPad only, where a scanned link always opens the browser: before it uses the code, the page asks "Pair with your computer". "Open in the Pine app" opens the app by its `pine:` address and uses nothing in the browser; the choice stays on screen, so you can still go on without the app. `Continue in this browser` pairs this browser. The code works once: whichever pairs first uses it, and the other is told the link expired |
| The computer's identity | The link carries the fingerprint of the computer's host key: the web client trusts it for that computer alone, without asking you, and refuses a computer that answers with another key. A fingerprint it keeps already is never replaced by a link |
| Its name | The name the computer gave when paired; "your computer" until then. Rename in Settings > Environments gives it another; Forget there drops it from this browser's list. Only Remove in the Pine app shuts the device out |
| Coming back | By itself, each time the web client is opened, and after the phone was locked or the network changed |
| `Add to Home screen` | Suggested once after the first pairing, on Android only, where the installed web app keeps this browser's key. Not on iOS, where it would not keep the key and would have to pair again |
| `user@host` and paired computers | Side by side. Settings > Environments says how each is reached: a paired computer is "Found through" the deployment, the connection then made "directly or through a relay server the computer's owner named"; a `user@host` machine goes "Through the relay at" the deployment |

### When a paired computer does not answer

The start screen (on a phone: the mobile app's first screen) says why, with the computer's name
where this table says "Studio Mac", and "your computer" while pairing:

| It says | What to do |
|---|---|
| Studio Mac does not answer: it is off, asleep, or Pine is closed | Wake the computer or open Pine; check that Browser access is on. It keeps trying |
| Studio Mac is there, but no direct connection could be made from this network | Some networks, often a phone's mobile data, do not let two devices connect directly. Try another Wi-Fi, or mobile data instead of the Wi-Fi. The computer's owner can name a relay server of their own in the Pine app ([desktop.md](desktop.md#a-relay-server-of-your-own-for-a-phone-that-cannot-connect-from-mobile-data)); the browser or phone needs nothing for it. It keeps trying |
| The meeting service is over its limits for now | Wait; it keeps trying |
| The meeting service could not be reached | There is no network here, or the service is down. Check the network |
| This browser (or phone) is no longer known to Studio Mac | It was removed in the Pine app, or its key was lost. Add this device again at the computer |
| This pairing link has expired or was used already | Press New code on the computer and scan again |
| Your computer refused this browser (or phone) | Refuse was pressed, or the four digits did not match. Add the device again |
| The computer that answered is not the one this pairing link names | Nothing was trusted. Add the device again at the computer |

## How it works

One deployment serves three parts from one address. None of them can read your conversations.

| Part | What it sees |
|---|---|
| The web client | The page you use, in a sandboxed frame that cannot reach the browser's key or the daemon's token: what it draws (an answer can repeat a web page) cannot steal them. It loads nothing from the web |
| The relay | For `user@host` machines: carries bytes between the browser and your server's SSH port, and nothing else. SSH runs in the browser, end to end, so the relay sees neither key nor token. It carries only SSH, reaches only public addresses (and Tailscale Funnel names), allows 20 connections a minute per client address, and keeps and logs nothing |
| The meeting service | For paired computers: the computer waits there under its key's fingerprint, after proving it holds that key; the few messages that set up the direct connection cross it, and then it is out of it. It never carries the conversation, keeps no storage and logs nothing |

To a paired computer, SSH runs inside the direct connection (a WebRTC data channel), end to end
as through the relay. The Pine app's side answers only pine's own command and lets the browser
reach only that computer's pine. The service names no relay of the bytes (TURN) for anybody; a
relay the computer's owner names in the Pine app is used by the computer's side alone.

Either way the control API stays closed to the network: the browser reaches the daemon through
SSH, on the machine's loopback.

## Deploying it

To run a deployment of your own: `npm install` in `web/` and `web/relay/`, `npm run build` in
`web/`, then `npx wrangler deploy --name <yours>` in `web/relay/` with your Cloudflare account. It
serves the web client, the relay and the meeting service at
`https://<yours>.<account>.workers.dev`. Write that address in the Pine app's Settings > Browser
access (`Service address`), so that your computer waits there and its QR codes point there. A
browser's key and its paired computers belong to an address: moving to another makes it pair
again. The configuration's variables and the project's own deployments are in
[docs/dev/web.md](../dev/web.md).
