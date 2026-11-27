# The web client

The web client is the Pine app's page ([desktop.md](desktop.md)) in any web browser, with nothing
to install: on a work laptop, a borrowed computer, a tablet. It reaches your pine in two ways:

- Over SSH: a machine you reach with `ssh` from the internet, or a tailnet machine published by
  Tailscale Funnel ("A machine on a tailnet").
- Paired by QR code with a computer that runs the Pine app, directly, with no SSH to set up
  ([below](#a-computer-paired-by-qr-code-a-browser-with-no-ssh-to-set-up)). The mobile app pairs
  the same way ([mobile.md](mobile.md#pairing-with-a-computer-that-runs-the-pine-app)).

The official service, `https://pine-main.drcmda.workers.dev`, serves the web client, the SSH relay
and the meeting service, and is the Pine app's default ("Deploying it" for your own).

## Using it

| What | How |
|---|---|
| Open it | Chrome 137, Firefox 130 or Safari 17 or later. Other browsers are told which work |
| The first screen | How to pair a computer, and the link "Or connect to a server over SSH" to the SSH view: your machines, this device's key, the field for `user@host`, and the relay used. A browser with a `user@host` machine starts there. A deployment without the meeting service or the relay shows only the other |
| This device's key | The browser makes its own SSH key (Ed25519), kept in its storage for this site. Add the public half (Copy, Share) to `~/.ssh/authorized_keys` of the user you sign in as. Neither you nor a script can read or export the private half, so a web page an answer shows cannot steal it. No other key works |
| Add a machine | Type `user@host` or `user@host:port`. The relay refuses private, loopback and link-local addresses: reach a home server from the desktop app, or through Tailscale Funnel |
| The host key | Before anything of yours is sent, the client shows the host key fingerprint (`SHA256:...`). Compare it with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server and trust it. A changed key is refused, showing both, until you forget and add the machine again |
| Disconnect | Lets go of the machine but keeps it and its host key. Forget removes both. Both are on the machine's line in Settings > Environments, Disconnect also in the title bar's machines menu |
| What is remembered | Kept in this browser only: its key, machines, host keys, the one in use, and the page's preferences. Clearing the site's data forgets all of it: add the new key to the server again |
| A pine with no model | **Onboarding** opens ([desktop.md](desktop.md#onboarding-getting-started)), looking on pine's machine |
| Links in answers | Open in a new tab, their address shown. The page never navigates away. Pictures, video and sound play as in the desktop app |
| A dropped connection | Reconnects by itself, waiting a little longer each time, and at once when the network or the tab comes back |
| What it cannot do | What needs a pine on the computer in front of you: this computer's pine, the terminal, voice input, picking a local folder, starting or updating pine |

When a machine is not reached, the start screen says why:

| It says | What to check |
|---|---|
| The relay did not open a connection | The address is public. The relay allows a few connections a minute: wait a minute |
| could not be reached on port ... | The machine is on, SSH listens there, and its firewall lets the internet in |
| answers ..., but not with SSH | The port |
| did not answer through Tailscale Funnel | Funnel is on for that port, and the machine is on |
| did not accept this browser's key | This device's key is in that user's `~/.ssh/authorized_keys` |
| pine is not installed ... / too old | `pine update` there. pine must be on the login shell's PATH |
| pine ... is not answering | `pine status` there, or restart it |

## A machine on a tailnet

A machine only on your Tailscale network has no address the relay may reach: it refuses
Tailscale's addresses (`100.64.0.0/10`) like any private one. Tailscale Funnel
publishes the machine's `sshd` on the internet behind Tailscale's TLS, at
`<machine>.<tailnet>.ts.net`. The relay checks that name's certificate and carries SSH, end to
end, inside the TLS.

| What | How |
|---|---|
| Turn it on | `tailscale funnel --bg --tls-terminated-tcp=10000 tcp://localhost:22` on the machine. Tailscale asks to allow Funnel the first time |
| The machine to add | `user@<machine>.<tailnet>.ts.net:10000` (the name is in `tailscale funnel status`) |
| `tailscale funnel` ports | 443, 8443 and 10000 only. The relay refuses a `.ts.net` name on other ports |
| Turn it off | `tailscale funnel --tls-terminated-tcp=10000 off`, or `tailscale funnel reset` |
| What it opens | `sshd` on the internet, for anyone. Have it take keys only (`PasswordAuthentication no` in `sshd_config`) |

## A computer paired by QR code: a browser with no SSH to set up

With the Pine app on your computer, a browser needs no SSH, key or address. Turn on Settings >
Browser access in the app, then Add a device
([desktop.md](desktop.md#browser-access-a-browser-with-no-ssh-to-set-up)). The two then talk
peer to peer from anywhere. The service only introduces them.

| What | How |
|---|---|
| `https://pine-main.drcmda.workers.dev` | The official service. Its start screen says how to pair, offers "Get the Pine app" (and "Open Pine on this computer" on a computer), with SSH behind a link. Over its limits, it says so |
| Pair | Scan the QR code with the phone's camera, or open the link from Copy link on the device. Press Allow only if both show the same four digits. The link works once, for two minutes, and leaves the address bar at once, so no history or bookmark keeps it |
| `Open Pine on this computer` | In a browser on a computer, pairs it with the Pine app there, if Browser access is on: Pine sends a pairing link to your default browser. Only the mobile app looks for computers on the network ([mobile.md](mobile.md#a-computer-on-this-network)) |
| `Open in the Pine app`, `Continue in this browser` | On an iPhone or iPad, where a scanned link opens the browser, the page asks first. "Open in the Pine app" opens its `pine:` address and uses nothing here. The choice stays on screen. The code works once: whichever pairs first uses it, and the other is told it expired |
| The computer's identity | The link carries the computer's host key fingerprint, trusted for that computer alone without asking you. Another key is refused, and a link never replaces a fingerprint already kept |
| Its name | The name the computer gave ("your computer" until then). Rename and Forget are in Settings > Environments. Only Remove in the Pine app shuts the device out |
| Coming back | Automatic, whenever the web client opens or the phone or network comes back |
| `Add to Home screen` | Suggested once after the first pairing, on Android only, where the installed app keeps the key. Not on iOS, where it would have to pair again |
| `user@host` and paired computers | Side by side in Settings > Environments, "Through the relay at" or "Found through" the deployment |

### When a paired computer does not answer

The start screen (the phone app's first screen) says why, with the computer's name for "Studio
Mac" ("your computer" while pairing). It keeps trying.

| It says | What to do |
|---|---|
| Studio Mac does not answer: it is off, asleep, or Pine is closed | Wake it or open Pine, with Browser access on |
| Studio Mac is there, but no direct connection could be made from this network | The network, often mobile data, blocks direct connections. Try another network, or set a relay server in the Pine app ([desktop.md](desktop.md#a-relay-server-of-your-own-for-a-phone-that-cannot-connect-from-mobile-data)) |
| The meeting service is over its limits for now | Wait |
| The meeting service could not be reached | Check the network, or the service may be down |
| This browser (or phone) is no longer known to Studio Mac | It was removed in the Pine app, or its key was lost. Add it again at the computer |
| This pairing link has expired or was used already | New code on the computer, and scan again |
| Your computer refused this browser (or phone) | Refused, or the digits did not match. Add it again |
| The computer that answered is not the one this pairing link names | Nothing was trusted. Add it again at the computer |

## How it works

One deployment serves three parts from one address. None of them can read your conversations.

| Part | What it sees |
|---|---|
| The web client | A sandboxed frame that cannot reach the browser's key or the daemon's token, and loads nothing from the web |
| The relay | For `user@host`, it carries SSH bytes to public addresses and Tailscale Funnel names only. SSH runs in the browser, so the relay sees neither key nor token. 20 connections a minute per client address. It keeps and logs nothing |
| The meeting service | For paired computers, which wait there under their key's fingerprint after proving they hold it. Only the messages that set up the direct connection cross it, never the conversation. It keeps no storage and logs nothing |

To a paired computer, SSH runs end to end inside a WebRTC data channel, and the Pine app's side
answers only pine's own command, for that computer's pine. The service names no relay (TURN). One
the computer's owner names is used by the computer alone. Either way the control API stays closed
to the network: the browser reaches the daemon through SSH, on the machine's loopback.

## Deploying it

Run `npm install` in `web/` and `web/relay/`, `npm run build` in `web/`, then
`npx wrangler deploy --name <yours>` in `web/relay/` with your Cloudflare account. It serves all
three parts at `https://<yours>.<account>.workers.dev`. Put that address in the Pine app's
Settings > Browser access (`Service address`), so your computer waits there and its QR codes point
there. A browser's key and paired computers belong to one address: after a move, pair again.
Variables and the project's deployments: [docs/dev/web.md](../dev/web.md).
