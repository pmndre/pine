# The phone app

**Pine** for Android phones and tablets and for iPhones is the desktop app's page on a phone
([desktop.md](desktop.md)): the same agents, conversations, approvals, questions, code pane,
browser panel and settings, at the phone's width, in light and dark. It shows the pine of another
machine: a computer that runs the Pine app, paired by its QR code or found on the same network, or
any machine you reach over SSH (your Mac, a desktop at home, a server).

No pine runs on the phone. The app talks to the machine's control API through SSH. With a paired
computer, SSH runs inside a direct connection between the two devices.

## Getting it

Releases of pine are at <https://github.com/pmndre/pine/releases/latest>. Every release carries the
Android app. A release that carries the iPhone app lists it there too.

| File | For |
|---|---|
| `Pine-<version>.apk` | Android 8 or later, phone or tablet |
| `Pine-<version>.ipa` | An iPhone with iOS 17 or later |

### On Android

Open the file on the phone, and allow the app you opened it with (the browser, Files) to install
apps when Android asks. A later version installs over this one and keeps your machines and key.
There is no Play Store version.

### On an iPhone

There is no App Store or TestFlight version. To install pine on an iPhone, you sign the IPA with
your own Apple ID (a free one will do) as you install it, with a sideloading tool on a computer.

- AltStore (altstore.io): install AltServer on your Mac or PC and AltStore on the iPhone from it,
  then open the IPA in AltStore (My Apps, +).
- Sideloadly (sideloadly.io): on your Mac or PC, connect the iPhone, drop the IPA on it, sign in
  with your Apple ID, press Start.

The first time, trust your developer certificate (Settings > General > VPN & Device Management)
and turn on Developer Mode (Settings > Privacy & Security).

With a free Apple ID the app runs for 7 days (a paid developer account: a year). AltStore renews it
while the iPhone and AltServer's computer share a Wi-Fi (or with Refresh All). With Sideloadly,
install it again within the 7 days. A renewal or newer IPA under the same Apple ID keeps your
machines and key.

## The phone's key

On its first start the app makes an SSH key (Ed25519) for this phone. The private key never leaves
the app and is not in backups: Android encrypts it with an Android Keystore key, an iPhone keeps
it in the Keychain on this device only. Settings > Environments shows the public key under "This
device's key", with Copy and Share.

Pairing hands the key over by itself. For a server or computer over SSH, add the public key to
`~/.ssh/authorized_keys` of the user you sign in as:

```bash
echo 'ssh-ed25519 AAAA... pine' >> ~/.ssh/authorized_keys
```

The app signs in with this key only: no password, no imported key.

On an iPhone the key belongs to the Apple ID that signed the app: a reinstall under another Apple
ID (or bundle ID) makes a new key. Add the new key to your servers' `authorized_keys` and remove
the old line. A paired
computer then says "This phone is no longer known": pair again, and remove the old entry in the
Pine app (Settings > Browser access).

## Pairing with a computer that runs the Pine app

With the Pine app on your computer, the phone needs no SSH, address or key. Once paired, it
reaches that pine directly, peer to peer, from anywhere. The meeting service only introduces the
two. Pairing is the app's first screen, with SSH behind "Or connect to a server over SSH".

1. In the Pine app, switch on Settings > Browser access once, then Add a device
   ([desktop.md](desktop.md#pairing-a-device)).
2. Scan the QR code with the phone's camera. If the link does not open the app ("How the link
   reaches the app"), press Copy link, send it to the phone, and paste it into `Pairing link`.
3. The app asks "Pair with this computer?", naming the meeting service if it is not Pine's own.
   Nothing is used before you press Pair.
4. Both show the same four digits. Press Allow at the computer only if they match. Cancel on the
   phone keeps nothing.
5. The computer joins the app's machines under its name and becomes the one in use.

| What | How |
|---|---|
| `Pairing link` | The first screen's field for the link from Copy link (`https://pine-main.drcmda.workers.dev/#pair=...` or your own service) or a `pine:` address. Anything else is refused |
| The phone's name | "Pine on Pixel 9", "Pine on iPhone", "Pine on iPad". At most 60 characters |
| The computer's identity | The link carries the computer's host key fingerprint, checked before the phone's key is offered. Another key is refused, now and later: forget it and pair again |
| The meeting service | Pine's own (`https://pine-main.drcmda.workers.dev`) or your own deployment ([web.md](web.md#deploying-it)), kept with the computer for every reconnection. `https` only |
| Twenty machines | At most 20 machines, paired and `user@host` together |

### A computer on this network

While the pairing view is open, the app lists computers on the same network that run the Pine app
with Browser access and "Visible on this network" on ([desktop.md](desktop.md#without-scanning-a-code)).

| What | How |
|---|---|
| `On this network` | Each one as "Pine" and the first six characters of its key's fingerprint (never its name), with "Through <host>" for another meeting service |
| A tap | Asks without a code. Both show four digits: press Allow only if they match and the question is on your own computer, since any computer can call itself "Pine". The announcement (a fingerprint, an `https` meeting service, a random word that changes every five minutes) is not trusted: the app checks the key through the meeting service |
| `Local Network` | iOS asks once. If refused, the list says "Pine cannot search this network": turn on Settings > Pine > Local Network. Android asks nothing |
| No computer is listed | Pine must be open with Browser access and Visible on this network on, on the same Wi-Fi. Guest and office Wi-Fi often keep devices apart. Three requests without a yes in ten minutes hide the computer for an hour: pair with the code |

### How the link reaches the app

The app has no scanner and asks for no camera: the phone's camera reads the code, and the system
decides what the link opens.

| What | How |
|---|---|
| `App Links` | On Android, the app opens `https://pine-main.drcmda.workers.dev/` links only if the service serves `/.well-known/assetlinks.json` naming pine's release key. The official service serves none, so a scanned link opens the browser, which pairs by itself (or use `Pairing link`). Other services and checkout builds always open the browser |
| `Open in the Pine app` | On an iPhone or iPad a scanned link opens Safari, where the web client asks "Open in the Pine app" or "Continue in this browser" ([web.md](web.md#a-computer-paired-by-qr-code-a-browser-with-no-ssh-to-set-up)). If the app does not open, it is not installed. The code works once |
| `pine:` | The app's iOS address: `pine://pair?service=<service>&id=<fingerprint>&code=<code>`. Read like a pasted link. Nothing happens until you press Pair |

### A paired computer

| What | How |
|---|---|
| Coming back | A locked phone or the app in the background drops the connection, and work goes on at the computer. Back in front, the app reconnects with no QR code |
| A lost connection | Retried after 1 second, doubling up to 30 seconds, while that computer is shown. Stops at "no longer known" or another key |
| `Forget` | In Settings > Environments, removes the computer from this phone only. The computer lets the phone in until you press Remove in the Pine app (Settings > Browser access) |
| Removed at the computer | The phone is cut off at once and told it "is no longer known". Pair again |
| A relay server | Set only in the Pine app ([desktop.md](desktop.md#a-relay-server-of-your-own-for-a-phone-that-cannot-connect-from-mobile-data)), not on the phone |

### When a paired computer does not answer

The first screen says why, with the same messages as a browser
([web.md](web.md#when-a-paired-computer-does-not-answer)). On a phone, "This phone is no longer
known" can also mean a new key ("The phone's key"), and "No direct connection could be made" often
means mobile data: try a Wi-Fi.

## Adding a machine

In Settings > Environments (on the first screen, behind "Or connect to a server over SSH"), type
`user@host` or `user@host:port` under "Add a machine" and press Add. The user is required, and other
forms are refused.

| Needs | |
|---|---|
| The phone's key | In `~/.ssh/authorized_keys` there |
| A pine home there | `pine init` first |
| A pine with `pine service` | Older ones are not reached: `pine update` |
| A way from the phone to the machine | "Making a machine reachable". On an iPhone, allow Pine on the local network (Settings > Privacy & Security > Local Network), or machines on your Wi-Fi are not reached |
| A model | Else **Onboarding** opens ([desktop.md](desktop.md#onboarding-getting-started)), looking on that machine |

The app runs `pine service` there, which attaches to the running pine or starts one. Switch
machines at the foot of the side bar. Forget removes one with its host key. When a machine is not
reached, the first screen says why.

## The machine's host key

The first time, the app shows the machine's host key fingerprint (SHA256). Compare it on the
machine:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

If it matches, press **Trust this key**: the app trusts exactly that key for that host and port.
If not, don't: something else answers in the machine's place. Try again never trusts a key.

When a known server's host key changes, the app refuses to connect. If you reinstalled the machine
or gave its SSH server new keys, forget the machine and add it again. A paired computer's key comes
with the pairing link.

## Making a machine reachable

To reach the computer at home or a server from the phone when you are out, the phone needs a way
to that machine's SSH port:

| Where you are | How |
|---|---|
| Same Wi-Fi | Its local address (`you@192.168.1.20`, `you@mac.local`). On a Mac, turn on System Settings > General > Sharing > Remote Login |
| Anywhere, with a VPN | Tailscale, ZeroTier or WireGuard on both, and the machine's name there (`you@my-mac`). Nothing is opened to the internet |
| A server with public SSH | Its address |

Tailscale SSH (signing in without a key) is not supported: use Tailscale as a network with the
phone's key. A browser reaches a tailnet machine through Tailscale Funnel instead
([web.md](web.md#a-machine-on-a-tailnet)). pine's control API stays closed to the network either
way.

## What the phone does not do

The app runs no daemon, and has no "This Mac", restart of pine, `pine` command, terminal or Run
button, dictation, folder picker or app updates (install a new APK). No notifications while it is
closed: use Telegram ([source-types.md](source-types.md)). No `~/.ssh/config` names, ssh-agent,
jump hosts or password.

The Android back button closes the open dialog, sheet or menu, then leaves the app. On an iPhone,
close a sheet with its own button.

## What the app is careful about

The page follows the desktop app's rules ([desktop.md](desktop.md), "What the app is careful
about"). On the phone:

| | |
|---|---|
| The page has no token | The token and the direct connection stay in the app's native part, which makes every call through SSH, encrypted end to end. Nothing listens on the phone for another app to use. The meeting service sees neither key nor token |
| `ACCESS_NETWORK_STATE` | Android's second permission besides the network: it reads which networks the phone has, to find a way to a paired computer, and is granted at install. No camera, microphone or other permission |
| The page stays the app | It loads nothing from the web, navigates nowhere, opens no window. Links open in your browser (`http`, `https`). Photos come through the system's file chooser. The native part serves pictures, video and sound |

Building the apps, their tests and releases: [docs/dev/mobile.md](../dev/mobile.md).
