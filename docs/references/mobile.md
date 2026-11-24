# The Android and iOS app

pine has an app for Android phones and tablets and for iPhones: **Pine**, the desktop app's page
on a phone ([desktop.md](desktop.md)). It shows the pine of another machine: a computer that runs
the Pine app, paired by the QR code that app shows, with nothing to set up (see "Pairing with a
computer that runs the Pine app"); or any machine you reach over SSH: your Mac, a desktop at
home, a server (see "Adding a machine"). The same agents, conversations, approvals,
questions, code pane, browser panel and settings as on the Mac, in light and dark (the status
bar, and on Android the navigation bar, take the theme's color), at the phone's width.

The app is a client and nothing more. No pine runs on the phone: the machine you add runs it,
and the app talks to that pine's control API through an SSH connection, as the desktop app's
Settings > Environments does. To a paired computer that SSH connection runs inside a direct
connection between the two devices (a WebRTC data channel), as it does for a paired browser. It lies in `mobile/` of pine's repository and is built with
Capacitor around the page of `desktop/`: the same page and the same app on both systems.

## Getting it

A release of pine has the Android app attached, next to the Mac disk images:
<https://github.com/pmndre/pine/releases/latest>. The iPhone app is not attached for now: it is
built by hand (`npm run ipa`, below), and a release that has one lists it there.

| File | For |
|---|---|
| `Pine-<version>.apk` | A phone or tablet with Android 8 or later |
| `Pine-<version>.ipa` | An iPhone with iOS 17 or later |

### On Android

Open the file on the phone. Android asks once whether the app you opened it with (the browser,
Files) may install apps: allow it. The app is signed with pine's release key, so a later
version installs over this one and keeps your machines and your key. There is no Play Store
version yet.

### On an iPhone

There is no App Store or TestFlight version. The IPA is not signed: you sign it with your own
Apple ID as you install it, with a sideloading tool on a computer. A free Apple ID will do; nobody
else's developer account is involved.

| Tool | How |
|---|---|
| AltStore | Install AltServer on your Mac or PC and AltStore on the iPhone from it (altstore.io), then open `Pine-<version>.ipa` in AltStore (My Apps, +) |
| Sideloadly | On your Mac or PC (sideloadly.io): connect the iPhone, drop the IPA on it, sign in with your Apple ID and Start |

The first time, iOS asks you to trust your own developer certificate (Settings > General > VPN &
Device Management) and to turn on Developer Mode (Settings > Privacy & Security) before the app
opens.

On a free Apple ID an app installed this way runs for 7 days. AltStore renews it by itself while
the iPhone and the computer running AltServer are on the same Wi-Fi (or with Refresh All in
AltStore); with Sideloadly, install it again before the 7 days are over. A paid developer
account's install lasts a year. A renewal, or a newer IPA installed under the same Apple ID,
keeps your machines and your key.

## The phone's key

On its first start the app makes an SSH key for this phone (Ed25519). The private key never
leaves the app and is not in the phone's backups: on Android it is stored encrypted with a key
of the Android Keystore, on an iPhone it is kept in the iOS Keychain, on this device only and
readable after the phone's first unlock. Settings > Environments shows the public key, under "This device's key", with
Copy and Share.

The same key serves both ways in. For a paired computer you do nothing with it: pairing hands it
to that computer, which keeps it when you press Allow there. For a machine over SSH it goes into
`~/.ssh/authorized_keys` of the user you sign in as, on each server or computer the phone is to
reach, one line per key. For example, on that machine:

```bash
echo 'ssh-ed25519 AAAA... pine' >> ~/.ssh/authorized_keys
```

The app signs in with this key and nothing else: no password, no key of yours imported.

On an iPhone the key belongs to the Apple ID that signed the app. After a reinstall under
another Apple ID (or with a tool that changed the app's bundle ID), the app cannot read the old
key and makes a new one, so your machines refuse the iPhone until you add the new public key to
their `authorized_keys` (and remove the line of the old one). A paired computer says "This phone
is no longer known": pair the iPhone again, and take its old entry off the list in the Pine app
(Settings > Browser access).

## Pairing with a computer that runs the Pine app

With the Pine app on your computer, the phone needs no SSH, no address and no key in
`authorized_keys`. On the same network it finds that computer by itself and pairs without a code
(see "A computer on this network"); anywhere else by the QR code the Pine app shows. From then
on it reaches its pine directly, peer to peer, from anywhere: the meeting service only introduces
the two devices, as it does for a paired browser
([web.md](web.md#a-computer-paired-by-qr-code-a-browser-with-no-ssh-to-set-up)). This is what the
app's first screen offers; a machine over SSH is behind its link "Or connect to a server over SSH".

1. On the computer, in the Pine app: switch on Settings > Browser access once, then choose Pine >
   Add a device (`⌘⇧D`; [desktop.md](desktop.md#pairing-a-device)).
2. Scan the QR code with the phone's own camera. Whether the link then opens the app depends on
   the phone (see "How the link reaches the app"). Where it does not, press Copy link at the
   computer, send the link to the phone, and paste it into the field `Pairing link` of the app.
3. The app asks first, "Pair with this computer?", and names the meeting service when it is not
   Pine's own. Nothing is used before you press Pair.
4. The app shows four digits; the computer shows the same four beside the phone's name. Press
   Allow at the computer only if they are the same. While it waits, Cancel ends the pairing on
   the phone, and nothing is kept.
5. The computer is in the app's list of machines, by the name it gave, beside your `user@host`
   machines, and it is the one in use.

| What | How |
|---|---|
| `Pairing link` | The field on the app's first screen for a link that did not open the app. It takes the link Copy link gives (`https://pine-main.drcmda.workers.dev/#pair=...`, or the address of a service of your own) and a `pine:` address. Anything else is said not to be a pairing link, and nothing starts |
| The phone's name | What the computer shows when it asks, and lists in Settings > Browser access: "Pine on" and the phone's model. On Android the model Android gives ("Pine on Pixel 9"); on an iPhone or iPad "Pine on iPhone" or "Pine on iPad", since iOS tells an app no model name. Cut to 60 characters |
| The phone's key | The same Ed25519 key as for SSH (see "The phone's key"). There is no second key |
| The computer's identity | The link carries the fingerprint of the computer's host key. The app checks the key the computer presents against it before it offers the phone's key, so a computer that answers with another key is refused ("nothing was trusted") and there is no fingerprint to compare by hand. Once paired, a computer that presents another key is refused for good: forget it and pair again |
| The meeting service | The service the link names: Pine's own, `https://pine-main.drcmda.workers.dev`, or a deployment of your own ([web.md](web.md#deploying-it)). The app remembers it with the computer, since every reconnection goes through it. It takes `https` only: a link whose service is `http` (a `wrangler dev` on a computer) is refused, and said so plainly. No setting of the app accepts `http` |
| Twenty machines | The app keeps 20 machines at most, paired and `user@host` together: forget one before you pair another |

### A computer on this network

While the pairing view is shown, the app looks for computers that run the Pine app on the same
network, and lists them at its top, under "On this network". The computer has to have Browser
access and "Visible on this network" on (both are on once Browser access is,
[desktop.md](desktop.md#without-scanning-a-code)). Below the list the code and the `Pairing link` field
are as before.

| What | How |
|---|---|
| `On this network` | Each computer found, as "Pine" and the first six characters of its key's fingerprint: the computer does not say its name to the network. "Through <host>, not Pine's own service" under one that waits at a meeting service of its owner's own. While none is found, a spinner and "No computer found on this network yet. Pine must be open, with Browser access on." |
| A tap | Asks that computer without a code. The app shows "Confirm on" and the computer's name, which the computer tells only once the connection is made, and four digits; the computer shows the same four beside the phone's name. Press Allow there only if they are the same, and only if the question is on your computer's screen: any computer on the network can announce itself as "Pine". The rest is as with a code |
| The computer's identity | What the network said is not trusted. The app reaches the computer through the meeting service, as with a link, and checks the key the computer presents against the fingerprint it was announced with, so another computer cannot answer in its place. The computer then says which meeting service it waits at: the app keeps that one, and stops when the announcement named another |
| The random word | Each announcement carries a random word that changes every five minutes, and the app names it when it asks: only a phone on the same network can ask a computer without a code |
| `Local Network` | On an iPhone, iOS asks once whether Pine may find devices on your local network, the first time the pairing view is shown, never at launch. Refused, the list says "Pine cannot look on this network" and how to allow it: Settings > Pine > Local Network. On Android nothing is asked |
| When it is looked for | Only while the pairing view is on screen: the app does not look on the network otherwise |
| No computer is listed | Pine must be open on the computer, with Browser access and Visible on this network on, and the phone on the same Wi-Fi. A Wi-Fi that keeps its devices apart (for guests, in an office) lists nothing. After three requests that ended without a yes (refused, or left or run out at the phone) the computer stops showing itself for an hour. Pair with the code meanwhile |

### How the link reaches the app

The app has no scanner and asks for no camera, on either system: the phone's own camera reads the
QR code, and the system decides what the link opens.

| What | How |
|---|---|
| `App Links` | On Android. The app declares Pine's own service, `https://pine-main.drcmda.workers.dev/`, as an address it opens. Once Android has checked the statement the service serves for it (`/.well-known/assetlinks.json`, which names the key pine's releases are signed with), a scanned link opens the app instead of the browser, at its start or brought to the front while it runs. This holds only for Pine's own service and an APK of a release: the project's other channels (`pine-next`, a pull request's `pine-pr-<number>`), a service of your own, or an APK built from a checkout, opens the browser, which then pairs itself; use Copy link and the field `Pairing link` instead. Android checks the statement when the app is installed or updated |
| `Open in the Pine app` | On an iPhone or iPad. iOS cannot open a web address in an app that each owner signs at install (universal links need the team that signed the app named by the website), so the link opens Safari. There the web client asks before it uses the code: "Open in the Pine app" or "Continue in this browser" ([web.md](web.md#a-computer-paired-by-qr-code-a-browser-with-no-ssh-to-set-up)). If the app did not open, it is not on this device: continue in the browser. The code works once, so whichever pairs first uses it; the other is then told that the link expired |
| `pine:` | The app's own scheme on iOS, which "Open in the Pine app" opens: `pine://pair?service=<the service's address>&id=<the computer's fingerprint>&code=<the code>`. The app reads it as it reads a pasted link (an `https` service, a fingerprint of 43 characters, a code of 22, nothing else), and asks before anything is used. Any app or page can open a `pine:` address; nothing happens without your Pair |

### A paired computer

| What | How |
|---|---|
| Coming back | When the app comes back to the front it checks the connection, and a dead one is made again whole: a new meeting, a new direct connection, a new SSH session. No QR code again |
| In the background | Nothing is kept alive: a locked phone, or the app in the background, simply drops the connection, and it is made again when you return. Work goes on at the computer meanwhile |
| A lost connection | Tried again by itself, waiting a second at first and twice as long each time, up to 30 seconds, as long as that computer is the one shown. "does not answer", "no direct connection" and "over its limits" keep trying; "no longer known" and a computer that presents another key stop |
| `Forget` | On the computer's line in Settings > Environments. It removes the computer from this phone's list, with its name and its service, and nothing else: the computer still lets this phone in until you press Remove in the Pine app (Settings > Browser access). The app says so before it forgets |
| Removed at the computer | Remove in the Pine app cuts the phone's connection at once, and the app says "This phone is no longer known to" the computer: pair again to use it |
| Pictures, video and sound | As over SSH |
| A relay server | The app uses the STUN servers the meeting service names for finding a way. A TURN server a service names cannot be used, by the app or by any client today: only each server's address is carried, never a user name or a credential. A relay the computer's owner names in the Pine app (`Relay server (TURN)` in [desktop.md](desktop.md#a-relay-server-of-your-own-for-a-phone-that-cannot-connect-from-mobile-data)) is used by the computer's side and needs nothing of the phone. The app has no relay setting of its own |

### When a paired computer does not answer

The first screen tells why, with the computer's name where the table says "Studio Mac", and
"your computer" while it is being paired:

| It says | What to do |
|---|---|
| Studio Mac does not answer: it is off, asleep, or Pine is closed | Wake the computer or open Pine; check that Browser access is on. The phone keeps trying |
| Studio Mac is there, but no direct connection could be made from this network | Some networks, often a phone's data, do not let two devices connect directly. Try another Wi-Fi, or the phone's data instead of the Wi-Fi; the computer's owner can name a relay server of their own. The phone keeps trying |
| The meeting service is over its limits for now | Wait and try again; the phone keeps trying |
| The meeting service could not be reached | The phone has no network, or the service is down. Check the network |
| This phone is no longer known to Studio Mac | The phone was taken off the list in the Pine app, or its key is new (an iPhone reinstalled under another Apple ID). Pair again |
| This pairing link has expired or was used already | Press New code on the computer and scan again |
| Your computer refused this phone | Refuse was pressed, or the four digits were not the same. Add the device again |
| The computer that answered is not the one this pairing link names | Nothing was trusted. Add the device again at the computer |

## Adding a machine

Settings > Environments, under "Add a machine" (on the first screen, behind the link under
pairing): type
the machine as `user@host` or `user@host:port`, and Add. The user is needed, since a phone has
no user name of its own. Anything else (an option for ssh, spaces, `;`) is refused. The machine
is connected to when you pick it.

| Needs | |
|---|---|
| The phone's key | In `~/.ssh/authorized_keys` there (see above) |
| A pine with `pine service` | An older pine is not reached: update it there with `pine update` |
| A pine home there | `pine init` on that machine first |
| A way from the phone to the machine | See "Making a machine reachable" |

The app runs `pine service` there, as the desktop app does: it attaches to the pine that runs,
or starts one, which the connection then holds. Pick another machine at the foot of the side
bar, as on the Mac. The app remembers the machines and the one in use, and opens on it next
time. Forget on a machine's line removes it, with its host key; the machine in use too, when
it is not reached, so that the first screen lists the others again.

On an iPhone, the first time the app reaches a machine on your Wi-Fi, iOS asks whether Pine may
find and connect to devices on your local network ("Pine looks for your computer on this network
so that you can pair with it without scanning a code, and connects to the machines you add
there"); the pairing view asks it first, when it looks for computers. Allow it: without it a machine on the local
network is not reached. You can change it later in Settings > Privacy & Security > Local Network.

When a machine is not reached, the first screen says why, in the words of the desktop app:
the machine does not answer, pine is not installed there, pine there is too old, there is no
pine home, or the key was refused.

## The machine's host key

The first time the app reaches a machine, it stops and shows the fingerprint of the machine's
host key (SHA256, as OpenSSH prints it). Compare it with what the machine says:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

If it is the same, press **Trust this key**: the app trusts exactly that key, for that host and
port, and connects. If it is not, do not press it: something else answers in the machine's
place. Try again only connects again; it never trusts a key.

When the host key of a known server changed, the app refuses to connect and says so: another
machine may stand in for it. If you reinstalled that machine, or its SSH server got new keys,
forget the machine and add it again; the app then asks about the new key.

A paired computer has no fingerprint to compare: the pairing link carries it (see "Pairing with a
computer that runs the Pine app"). When such a computer presents another key, the app says that
its host key changed and refuses it for good: someone may stand between the two devices. Forget
it, then add this device again at the computer.

## Making a machine reachable

To reach the computer at home, or a server, from the phone when you are out, the phone has to
reach that machine's SSH port. How is your network's business, not pine's:

| Where you are | How |
|---|---|
| Same Wi-Fi | The machine's address on the network (`you@192.168.1.20`, or `you@mac.local`). On a Mac, turn on System Settings > General > Sharing > Remote Login |
| Anywhere, with a VPN | A VPN that puts the phone and the machine on one network: Tailscale, ZeroTier or WireGuard. Install it on both and use the machine's address or name in that network (`you@my-mac` with Tailscale's names). Nothing is opened to the internet |
| A server with public SSH | A VPS or a server you already reach with `ssh`: its address, as for any SSH client |

Tailscale SSH (signing in without a key) is not supported yet: use Tailscale as a network and
the phone's key for SSH.

From a browser, which joins no VPN, the web client reaches a machine that is only on a tailnet
through Tailscale Funnel: see "A machine on a tailnet" in [web.md](web.md#a-machine-on-a-tailnet).

pine's control API stays closed to the network in every case: the app talks to it through the
SSH connection, and the daemon takes requests for its own loopback only.

## What the phone does not do

| | |
|---|---|
| A pine on the phone | The app runs no daemon: it shows the pine of a machine you add |
| This computer's things | No "This Mac", no home folder, no restart of pine, no `pine` command, no terminal or Run button, no dictation, no folder picker, no app updates (a new APK from the release instead) |
| Notifications while closed | None yet. When the app comes back it reconnects and shows what waited. Telegram is the way to be told while the app is closed ([source-types.md](source-types.md)) |
| Your SSH setup | No `~/.ssh/config` names, no ssh-agent, no jump hosts, no password, no imported key |
| The App Store | The iPhone app is sideloaded (see "On an iPhone"): there is no App Store or TestFlight version |

The Android back button closes the open dialog, sheet or menu, and otherwise leaves the app. An
iPhone has no back button: close a sheet with its own button.

## What the app is careful about

The page is the desktop app's, and the same rules hold ([desktop.md](desktop.md), "What the app
is careful about"). On the phone:

| | |
|---|---|
| The page has no token | The daemon's token stays in the app's native part (a Capacitor plugin: `PinePlugin.kt` on Android, `PinePlugin.swift` on iOS), which makes every call for the page, as the Mac app's main process does |
| No port on the phone | Every request to the daemon goes through a channel of the SSH connection. No port is opened on the phone's loopback, where another app could use it |
| A paired computer | The calls to the daemon go through the direct connection, which lives in the native part too (Google's libwebrtc on Android, libdatachannel on iOS), never in the page, encrypted end to end: the meeting service passes the few messages that set up the connection, and sees neither key nor token |
| A link opened in it | Handed to the page as text and read by the same rules as a pasted link; the page asks you before anything is used, naming a service that is not Pine's own |
| `ACCESS_NETWORK_STATE` | On Android two permissions are asked for: the network, and this one, to read which networks the phone has. Google's libwebrtc reads them to find a way to a paired computer, and cannot run without it. Android grants it at install and never asks you; it reads and changes nothing. No camera, no microphone, nothing else. Finding a computer on the network needs nothing more: Android's own service (`NsdManager`) looks for it. On an iPhone only the local network is asked for |
| What the network announces | Only a fingerprint, an `https` meeting service and the random word that changes every few minutes are read from it (`_pine._tcp`, `v=1`); a record without the word is passed over, and it is not trusted: the key is checked against the fingerprint, and the four digits are compared on both screens |
| The page stays the app | It loads nothing from the web, cannot be taken to another address, opens no window and is given no permission. A link opens in your browser, `http` and `https` only. A photo is attached through the system's file chooser |
| Pictures, video and sound | Answered by the native part from the daemon, under the Mac app's rules: fixed addresses only, never SVG. On iOS they come through a scheme of the app's own (`pine-media:`), the only origin the page's policy allows for them |

## Building it

From a checkout, in `mobile/` (`npm install` there once).

### Android

It needs the Android SDK
(`ANDROID_HOME`, by default `~/Library/Android/sdk`) and a JDK of 21 or later (`JAVA_HOME`, by
default Android Studio's on a Mac).

| Command | What it does |
|---|---|
| `npm run apk` | A debug APK, in `android/app/build/outputs/apk/debug/` |
| `npm run apk:release` | A release APK. Signed when `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` name a key; unsigned otherwise. `PINE_VERSION` and `PINE_VERSION_CODE` set its version |
| `npm run test:core` | The Kotlin core on the JVM, against an SSH server in the test and a stand-in daemon, and against the Pine app's real access host for a paired computer (pairing, calls, reconnection, refusals, several megabytes each way). That part needs Node and `npm install` in `desktop/` |
| `npm run smoke` | Builds, installs on an emulator without a window and opens the app against a test machine of its own. It is the test of the WebView's hardening (no permission, no window, no file access, no navigation away), of Share, of the back button, of the return from the background, and of the system bars in a dark theme and a light one (`bars-dark.png`, `bars-light.png` beside its screenshot). It also pairs from end to end with the Pine app's real access host: first libwebrtc alone (an instrumented test, `LibWebRtcTest`, that pairs, connects and sends 2, 4 and 6 MiB each way), then the app by a pasted link, by an App Link while it runs and at its start, with a malformed link and an `http` service refused. `--transport-only` runs the libwebrtc test alone, `--pairing-only` that and the pairing. An emulator that starts cold on a busy computer says that its own apps (System UI, the keyboard) are not responding: the run waits for the system to settle, answers such a dialog with Wait, and fails only when the app itself is not responding. Run it before a release that changes `mobile/` or upgrades Capacitor |

The app takes an `https` meeting service only, and the run's access host is on this computer. So
the smoke run puts a TLS front with a certificate authority of its own before it, and the debug
build alone trusts that authority (Android's network security config, under `debug-overrides`,
from `-PpineSmokeAuthority`; without it, an authority whose private key was thrown away). A
release build has neither. Android can verify an App Link only against the service on the web,
which the run never reaches: it marks the link verified by hand (`pm set-app-links`, which
Android provides for tests) and opens it as a camera would.

Attaching a photo through the system's file chooser is not driven by the smoke run: check it by
hand on a phone or the emulator before such a release (attach a picture to a message, and see
it sent).

### iOS

It needs a Mac with Xcode 27 and, for the simulator, an iOS simulator runtime (Xcode > Settings >
Components).

| Command | What it does |
|---|---|
| `npm run sync:ios` | Builds the page for iOS (WebKit, media on `pine-media:`) and copies it into `ios/` |
| `npm run ios` | A debug build for the simulator, in `ios/DerivedData` |
| `npm run ios:run` | Builds the app and opens it in the Simulator app |
| `npm run ipa` | The IPA of a release, not signed, in `ios/App/output/Pine-<version>.ipa` (`npm run ipa -- 0.38.0`; 0.0.0 without a version). It fails unless the app inside is unsigned and arm64 |
| `npm run smoke:ios` | Builds the app and a test that runs inside it, starts a simulator of its own without a window, and drives the page against a test machine on the Mac's loopback. It is the test of the web view's hardening (the page's policy, no camera, microphone or motion sensors, no file access, the media scheme's rules and ranges, no window, no navigation away), of the page inside the safe area with and without the keyboard, of a host key's fingerprint within the screen's width, of the return from the background, of the status bar in a dark theme and a light one, and of the key kept across a relaunch. It also pairs from end to end with the Pine app's real access host, by a pasted link and by a `pine:` address, with a malformed address and an `http` service refused, behind a TLS front whose certificate authority the run adds to the simulator alone (`simctl keychain add-root-cert`). `--pairing-only` runs the pairing alone. Run it before a release that changes `mobile/` or upgrades Capacitor |
| `swift test` (in `ios-core/`) | The iOS app's Swift core on the Mac, against an OpenSSH `sshd` of the test's own and a stand-in daemon, and against the Pine app's real access host for a paired computer. That part needs Node and `npm install` in `desktop/`. It runs on Apple silicon only: the libdatachannel package has no Intel slice for macOS |

### What the tests do not cover

The libraries of the direct connection are proven on the JVM and the Mac (the cores' suites), on
the emulator (Google's libwebrtc, the Android app) and on the simulator (libdatachannel, the iOS
app). Not tried yet: a real phone, an Android phone that runs with 16 KB memory pages (the
64-bit libraries are built for them), cellular networks, AltStore and Sideloadly installing the
IPA that carries libdatachannel, the iOS app started cold by a `pine:` address, and finding a
computer on a real network (`NsdManager`, `NWBrowser`): the cores' suites test reading the
announcement and the pairing without a code against the real access host, not the looking.

To try the app on the simulator against the pine of your own Mac: turn on Remote Login (System
Settings > General > Sharing), run `npm run ios:run`, add the simulator's key (Settings >
Environments) to your `~/.ssh/authorized_keys`, and add the machine as `you@127.0.0.1`. The
simulator shares the Mac's network, so its loopback is the Mac's, and iOS does not ask about the
local network for it. A simulator build is signed to run locally (Xcode does it, without an
account): the Keychain refuses an app that is not signed at all.

## In a release

The Release workflow (`.github/workflows/release.yml`) builds the release APK for every release
from `main` and attaches it to the GitHub release, with `versionName` the release's version and
`versionCode` major × 1 000 000 + minor × 1 000 + patch. It takes the key from four secrets of
the environment `release`; without them it builds no APK and says so. The release APK carries
libwebrtc for the two kinds of processor phones have (arm64-v8a, armeabi-v7a), about 22 MB in
all; the job fails when a native library in it kept its debug symbols. A debug APK carries all
four, for emulators.

The release does not build the IPA for now: the core's `swift test` did not pass on GitHub's
Xcode 27 preview image. On a Mac with Xcode 27, `npm run ipa -- <version>` in `mobile/` makes
`Pine-<version>.ipa`, whose build number is Android's `versionCode`; run `npm test` there and
`swift test` in `mobile/ios-core/` first. The IPA carries libdatachannel inside the app and
OpenSSL as a framework beside it (about 7 MB in all); the script takes its vendor's signature off
that framework, so that nothing in the IPA is signed before you sign it.

To build the APK of a release again, run the workflow by hand from `main` with that
release's version: `gh workflow run release.yml -f version=0.38.0`.
