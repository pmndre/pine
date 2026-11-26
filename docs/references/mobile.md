# The phone app

**Pine** for Android phones and tablets and for iPhones is the desktop app's page on a phone
([desktop.md](desktop.md)): the same agents, conversations, approvals, questions, code pane,
browser panel and settings, at the phone's width, in light and dark. It shows the pine of another
machine:

- a computer that runs the Pine app, paired by the QR code that app shows, or found on the same
  network (see "Pairing with a computer that runs the Pine app");
- any machine you reach over SSH: your Mac, a desktop at home, a server (see "Adding a machine").

No pine runs on the phone. The app talks to that machine's control API through an SSH
connection; to a paired computer, that SSH connection runs inside a direct connection between
the two devices.

## Getting it

The Android app is attached to every release of pine:
<https://github.com/pmndre/pine/releases/latest>. The iPhone app is not attached for now; a release
that has one lists it there.

| File | For |
|---|---|
| `Pine-<version>.apk` | A phone or tablet with Android 8 or later |
| `Pine-<version>.ipa` | An iPhone with iOS 17 or later |

### On Android

Open the file on the phone. Android asks once whether the app you opened it with (the browser,
Files) may install apps: allow it. A later version installs over this one and keeps your machines
and your key. There is no Play Store version.

### On an iPhone

There is no App Store or TestFlight version. The IPA is not signed: you sign it with your own
Apple ID as you install it, with a sideloading tool on a computer. A free Apple ID will do.

| Tool | How |
|---|---|
| AltStore | Install AltServer on your Mac or PC and AltStore on the iPhone from it (altstore.io), then open `Pine-<version>.ipa` in AltStore (My Apps, +) |
| Sideloadly | On your Mac or PC (sideloadly.io): connect the iPhone, drop the IPA on it, sign in with your Apple ID and Start |

The first time, iOS asks you to trust your developer certificate (Settings > General > VPN &
Device Management) and to turn on Developer Mode (Settings > Privacy & Security).

On a free Apple ID the app runs for 7 days. AltStore renews it by itself while the iPhone and the
computer running AltServer are on the same Wi-Fi (or with Refresh All in AltStore); with
Sideloadly, install it again before the 7 days are over. A paid developer account's install lasts
a year. A renewal, or a newer IPA under the same Apple ID, keeps your machines and your key.

## The phone's key

On its first start the app makes an SSH key for this phone (Ed25519). The private key never
leaves the app and is not in backups: on Android it is encrypted with a key of the Android
Keystore, on an iPhone it is in the Keychain, on this device only. The app shows the public key
in Settings > Environments, under "This device's key", with Copy and Share.

For a paired computer you do nothing with it: pairing hands it over. For a server or computer
over SSH, add the key to `~/.ssh/authorized_keys` of the user you sign in as, on each machine the
phone is to reach:

```bash
echo 'ssh-ed25519 AAAA... pine' >> ~/.ssh/authorized_keys
```

The app signs in with this key and nothing else: no password, no imported key.

On an iPhone the key belongs to the Apple ID that signed the app. After a reinstall under another
Apple ID (or with a tool that changed the app's bundle ID), the app makes a new key. Add the new
public key to your machines' `authorized_keys` (and remove the old line). A paired computer says
"This phone is no longer known": pair again, and remove the old entry in the Pine app (Settings >
Browser access).

## Pairing with a computer that runs the Pine app

With the Pine app on your computer, the phone needs no SSH, no address and no key in
`authorized_keys`. On the same network it finds the computer by itself (see "A computer on this
network"); anywhere else it pairs by the QR code. From then on it reaches that pine directly,
peer to peer, from anywhere; the meeting service only introduces the two devices. Pairing is the
app's first screen; a machine over SSH is behind its link "Or connect to a server over SSH".

1. On the computer, in the Pine app: switch on Settings > Browser access once, then Add a device
   ([desktop.md](desktop.md#pairing-a-device)).
2. Scan the QR code with the phone's own camera. If the link does not open the app (see "How the
   link reaches the app"), press Copy link at the computer, send the link to the phone, and paste
   it into the app's `Pairing link` field.
3. The app asks "Pair with this computer?", and names the meeting service when it is not Pine's
   own. Nothing is used before you press Pair.
4. The app shows four digits; the computer shows the same four beside the phone's name. Press
   Allow at the computer only if they match. Cancel on the phone ends the pairing and keeps
   nothing.
5. The computer joins the app's list of machines, by its name, and is the one in use.

| What | How |
|---|---|
| `Pairing link` | The field on the first screen for a link that did not open the app: the link Copy link gives (`https://pine-main.drcmda.workers.dev/#pair=...`, or a service of your own) or a `pine:` address. Anything else is refused as not a pairing link |
| The phone's name | What the computer shows and lists: "Pine on" and the model ("Pine on Pixel 9"); on an iPhone or iPad "Pine on iPhone" or "Pine on iPad". At most 60 characters |
| The computer's identity | The link carries the fingerprint of the computer's host key. The app checks the key the computer presents against it before it offers the phone's key, so there is nothing to compare by hand. A computer that answers with another key is refused, then and on every later connection: forget it and pair again |
| The meeting service | The service the link names: Pine's own, `https://pine-main.drcmda.workers.dev`, or a deployment of your own ([web.md](web.md#deploying-it)). The app keeps it with the computer, since every reconnection goes through it. `https` only: a link with an `http` service is refused |
| Twenty machines | The app keeps at most 20 machines, paired and `user@host` together: forget one before you add another |

### A computer on this network

While the pairing view is shown, the app looks for computers that run the Pine app on the same
network and lists them under "On this network". The computer needs Browser access and "Visible
on this network" on ([desktop.md](desktop.md#without-scanning-a-code)).

| What | How |
|---|---|
| `On this network` | Each computer found, as "Pine" and the first six characters of its key's fingerprint (it does not tell the network its name). "Through <host>, not Pine's own service" under one that uses another meeting service. While none is found: "No computer found on this network yet. Pine must be open, with Browser access on." |
| A tap | Asks that computer without a code. The app shows "Confirm on" and the computer's name and four digits; the computer shows the same four. Press Allow only if they match and the question is on your own computer's screen: any computer on the network can call itself "Pine" |
| The computer's identity | What the network announces is not trusted: the app reaches the computer through the meeting service and checks its key against the announced fingerprint |
| `Local Network` | On an iPhone, iOS asks once, the first time the pairing view is shown. Refused, the list says "Pine cannot look on this network": turn on Settings > Pine > Local Network. On Android nothing is asked |
| When it looks | Only while the pairing view is on screen |
| No computer is listed | Pine must be open on the computer with Browser access and Visible on this network on, and the phone on the same Wi-Fi. A Wi-Fi that keeps devices apart (guests, offices) lists nothing. After three requests without a yes within ten minutes, the computer stops showing itself for an hour. Pair with the code meanwhile |

### How the link reaches the app

The app has no scanner and asks for no camera: the phone's camera reads the QR code, and the
system decides what the link opens.

| What | How |
|---|---|
| `App Links` | On Android. The app declares Pine's own service, `https://pine-main.drcmda.workers.dev/`, as an address it opens, but Android lets it only once the service serves a statement naming the key pine's releases are signed with (`/.well-known/assetlinks.json`). The official service does not serve one yet, so for now a scanned link opens the browser, which can pair itself; or use Copy link and the `Pairing link` field. Other services (`pine-next`, a pull request's, your own) and an APK built from a checkout always open the browser |
| `Open in the Pine app` | On an iPhone or iPad the link always opens Safari: iOS cannot hand a web address to an app each owner signs. The web client there asks before it uses the code: "Open in the Pine app" or "Continue in this browser" ([web.md](web.md#a-computer-paired-by-qr-code-a-browser-with-no-ssh-to-set-up)). If the app does not open, it is not installed: continue in the browser. The code works once; whichever pairs first uses it |
| `pine:` | The app's own address on iOS, which "Open in the Pine app" opens: `pine://pair?service=<service>&id=<fingerprint>&code=<code>`. Read like a pasted link; any app or page can open one, and nothing happens without your Pair |

### A paired computer

| What | How |
|---|---|
| Coming back | When the app comes to the front it checks the connection and makes a dead one again: a new meeting, a new direct connection, a new SSH session. No QR code again |
| In the background | Nothing is kept alive: a locked phone or the app in the background drops the connection, and it is made again when you return. Work goes on at the computer |
| A lost connection | Tried again by itself, after 1 second, then twice as long each time up to 30 seconds, while that computer is the one shown. "no longer known" and a computer with another key stop it |
| `Forget` | On the computer's line in Settings > Environments. It removes the computer from this phone's list and nothing else: the computer still lets this phone in until you press Remove in the Pine app (Settings > Browser access). The app says so before it forgets |
| Removed at the computer | Remove in the Pine app cuts the phone off at once; the app says the phone "is no longer known". Pair again to use it |
| A relay server | The app needs no relay setting. A relay the computer's owner names in the Pine app ([desktop.md](desktop.md#a-relay-server-of-your-own-for-a-phone-that-cannot-connect-from-mobile-data)) is used by the computer's side alone |

### When a paired computer does not answer

The first screen says why. The messages and what to do are the same as in a browser: see
[web.md](web.md#when-a-paired-computer-does-not-answer). On the phone, "This phone is no longer
known" also follows a new key (an iPhone reinstalled under another Apple ID, see "The phone's
key"), and "no direct connection could be made" often means the phone's mobile data: try a Wi-Fi.

## Adding a machine

In Settings > Environments, under "Add a machine" (on the first screen, behind "Or connect to a
server over SSH"): type `user@host` or `user@host:port`, and Add. The user is needed: a phone
has no user name of its own. Anything that is not a plain `user@host[:port]` is refused.

| Needs | |
|---|---|
| The phone's key | In `~/.ssh/authorized_keys` there (see "The phone's key") |
| A pine home there | `pine init` on that machine first |
| A pine with `pine service` | An older pine is not reached: `pine update` there |
| A way from the phone to the machine | See "Making a machine reachable" |
| A model | A pine with no model opens **Setup Pine** ([desktop.md](desktop.md#setup-pine-getting-started)); it looks for model servers on that machine, not on the phone |

The app runs `pine service` there, as the desktop app does: it attaches to the pine that runs, or
starts one. Pick another machine at the foot of the side bar. The app opens on the machine in use
next time. Forget on a machine's line removes it with its host key.

On an iPhone, iOS asks once whether Pine may find and connect to devices on your local network.
Allow it, or a machine on your Wi-Fi is not reached (Settings > Privacy & Security > Local
Network).

When a machine is not reached, the first screen says why: it does not answer, pine is not
installed there or is too old, there is no pine home, or the key was refused.

## The machine's host key

The first time the app reaches a machine, it shows the fingerprint of the machine's host key
(SHA256, as OpenSSH prints it). Compare it with what the machine says:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

If it is the same, press **Trust this key**: the app trusts exactly that key, for that host and
port. If not, do not: something else answers in the machine's place. Try again never trusts a key.

When the host key of a known server changed, the app on the phone refuses to connect and says
so: another machine may stand in for it. If you reinstalled the machine or gave its SSH server new
keys, forget the machine and add it again; the app then asks about the new key.

A paired computer has no fingerprint to compare: the pairing link carries it. If it ever
presents another key, the app refuses it for good: forget it and add this device again at the
computer.

## Making a machine reachable

To reach the computer at home, or a server, from the phone when you are out, the phone has to
reach that machine's SSH port. How is your network's business:

| Where you are | How |
|---|---|
| Same Wi-Fi | The machine's address on the network (`you@192.168.1.20`, `you@mac.local`). On a Mac, turn on System Settings > General > Sharing > Remote Login |
| Anywhere, with a VPN | Tailscale, ZeroTier or WireGuard on both, and the machine's address or name in that network (`you@my-mac` with Tailscale). Nothing is opened to the internet |
| A server with public SSH | Its address, as for any SSH client |

Tailscale SSH (signing in without a key) is not supported: use Tailscale as a network and the
phone's key for SSH. A browser joins no VPN; it reaches a tailnet machine through Tailscale
Funnel ([web.md](web.md#a-machine-on-a-tailnet)).

pine's control API stays closed to the network: the app reaches it through the SSH connection.

## What the phone does not do

| | |
|---|---|
| A pine on the phone | The app runs no daemon |
| This computer's things | No "This Mac", no restart of pine, no `pine` command, no terminal or Run button, no dictation, no folder picker, no app updates (install a new APK) |
| Notifications while closed | None. When the app comes back it shows what waited. To be told while it is closed, use Telegram ([source-types.md](source-types.md)) |
| Your SSH setup | No `~/.ssh/config` names, no ssh-agent, no jump hosts, no password, no imported key |

The Android back button closes the open dialog, sheet or menu, and otherwise leaves the app. On
an iPhone, close a sheet with its own button.

## What the app is careful about

The page follows the desktop app's rules ([desktop.md](desktop.md), "What the app is careful
about"). On the phone:

| | |
|---|---|
| The page has no token | The daemon's token stays in the app's native part, which makes every call for the page |
| No port on the phone | Every request goes through the SSH connection; nothing listens on the phone's loopback, where another app could use it |
| A paired computer | The direct connection lives in the native part too, encrypted end to end: the meeting service passes the few messages that set it up and sees neither key nor token |
| A link opened in it | Handed to the page as text; nothing is used before you press Pair |
| `ACCESS_NETWORK_STATE` | On Android the app asks for two permissions: the network, and this one, to read which networks the phone has. The library of the direct connection (Google's libwebrtc) needs it to find a way to a paired computer. Android grants it at install without asking; it reads and changes nothing. No camera, no microphone, nothing else |
| What the network announces | Only a fingerprint, an `https` meeting service and a random word that changes every five minutes are read. None of it is trusted: the key is checked against the fingerprint and you compare the four digits |
| The page stays the app | It loads nothing from the web, goes to no other address, opens no window and gets no permission. Links open in your browser (`http`, `https` only). A photo is attached through the system's file chooser |
| Pictures, video and sound | Served by the native part under the desktop app's rules: fixed addresses only, never SVG |

Building the apps, their tests and releases: [docs/dev/mobile.md](../dev/mobile.md).
