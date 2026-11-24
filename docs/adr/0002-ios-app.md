# 0002: The Pine app on iOS

Status: accepted

## Context

ADR 0001 put the Pine app on phones as a client of a pine reachable over SSH, Android first, and
left the details of iOS for when that step starts. The Android app is built: the `mobile/` package
wraps the desktop page in Capacitor, and a native plugin on a Kotlin core (`mobile/core/`) holds
the token, reaches the other machine over SSH, runs `pine service` there and makes every call for
the page (rule 10 in `AGENTS.md`).

Owners with an iPhone have nothing but Telegram. Three facts shape what iOS can be:

- The only paid Apple Developer account at hand belongs to somebody else. Certificates,
  provisioning profiles, TestFlight and the App Store all go through such an account.
- The owner has no iPhone and tests on the iOS simulator; a person with an iPhone tests on a
  device.
- WKWebView will not let an app serve its page over `https`: Capacitor's page on iOS is at
  `capacitor://localhost`, and a scheme the web view handles itself cannot be taken over.

## Decision

**Sideload only.** Every release from `main` attaches an unsigned `Pine-<version>.ipa` next to the
APK. Whoever installs it signs it with their own Apple ID at install time, with AltStore or
Sideloadly, free or paid. Nothing about signing lives in the repository or its secrets: no
certificate, no provisioning profile, no TestFlight, no App Store, because the only paid account is
somebody else's. On a free Apple ID an install lasts 7 days, and AltStore renews it.

**An unsigned IPA.** The release job archives the app with code signing off, zips
`Payload/App.app` into the IPA, and fails when the app inside is signed or has no arm64 binary.
It needs no secret and no `environment: release`. TestFlight stays possible later without a change
to the code: it is a signing and upload step around the same archive.

**The same `mobile/` package.** Capacitor's iOS platform is added beside Android's, around the same
page and the same TypeScript bridge, with the platform taken from Capacitor (`"ios"` or
`"android"`). The page needs no change for iOS. The `ios/` project is committed as `android/` is,
with Swift Package Manager as Capacitor 8 sets it up, and iOS 17 as its deployment target.

**A Swift core that mirrors the Kotlin one.** `mobile/ios-core/` is a Swift package with no UIKit
and no Capacitor, built and tested by `swift test` on a Mac. It has the same responsibilities file
by file as `mobile/core/`: hosts, links, media rules, keys and known hosts, the remote command and
its service line, the daemon client, events, the held session and the state machine of machines.
The native plugin (`PinePlugin.swift`) implements the same contract (`plugin.ts`) on it. The remote
command is read from one text file that both cores read (`mobile/cases/remote-command.txt`), so the
root test that pins it to `remoteCommand()` in `src/remote.ts` covers iOS too.

**SSH on Apple's `swift-nio-ssh`, used directly.** With swift-nio and swift-crypto, all Apple's. The
core uses it for Ed25519 user authentication, a server-authentication delegate for trust on first
use, an exec channel whose stdin stays open as the daemon's leash, and a `direct-tcpip` channel per
request. Keepalive is TCP keepalive on the connection's socket (about 15 seconds, as on Android),
plus the `/health` check when the app returns to the foreground.

**Ed25519, its seed in the Keychain.** On first start the app makes an Ed25519 key and keeps its
32-byte seed in the iOS Keychain, in the data protection keychain, readable only on this device and
only after its first unlock (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`): it is in no
backup and no other app reads it. The public key is shown in OpenSSH format to copy or share into
`authorized_keys`. Host keys are trusted on first use, by the exact SHA256 fingerprint shown, and a
changed one is refused, as on Android. The core reaches secrets through a `SecretStore` protocol: in
memory for `swift test`, the Keychain in the app. The key survives an AltStore renewal under the
same Apple ID; a reinstall under another Apple ID makes a new key, since the Keychain's access
group follows the team that signed the app.

**Shared table cases.** `mobile/cases/` holds JSON files, one per subject (hosts, the loopback check,
media paths and types, links, fingerprints, service lines, the words of a failure), each case an
input and an expected output. The Kotlin tests and the Swift tests replay the same files, so the
two cores cannot drift apart on what the cases cover. An expectation that differs by platform (the
app's origin in link cases) is keyed by platform in the case.

**Media on a scheme of its own.** The page cannot load media from its own origin on iOS, since
Capacitor's handler for `capacitor://` maps paths to files and cannot be replaced. The plugin
registers `pine-media://daemon` on the web view's configuration, which is already the desktop
page's default media base. Its handler applies the core's media rules (the `MEDIA` allow-list, GET
only, `image/`, `video/` and `audio/` but never SVG, `no-store`, `nosniff`) and answers range
requests, so that video and sound can seek. The page built for iOS lists `pine-media:` as its media
origin in its policy; Android's is unchanged.

**The web view hardened as on Android.** A subclass of Capacitor's bridge view controller registers
the plugin and wraps Capacitor's UI delegate, whose defaults grant the camera, the microphone and
device orientation and open any scheme: media capture and orientation are denied, a new window is
never made, and only `http(s)` addresses open, in Safari. Every navigation that is not the app's
origin is cancelled. No `server.url`, no `allowNavigation`, no link previews, no web inspector in
release builds. The only usage description is the local network one.

**The smoke run is a hosted XCTest.** `npm run smoke:ios` in `mobile/`, by hand like Android's
`npm run smoke`, builds the app for the simulator and runs an XCTest inside it that evaluates
JavaScript in the real page. It reaches the same `SmokeMachine.kt` the Android run uses, at
`127.0.0.1` from the simulator. Each point of the web view's hardening is a named check that fails
the run, as is the path from first start to the agents and the Keychain store. No workflow runs it.

## Alternatives considered

**TestFlight or the App Store.** Rejected for now: both need a paid account of the owner's, and the
only one at hand is somebody else's. Nothing in the decision closes the door.

**Citadel.** The Swift SSH client that was the first choice. Rejected: it depends on a personal
fork of swift-nio-ssh instead of Apple's, and lacks keepalive and closing stdin, the two things the
daemon's leash and a phone's network need. What it adds over swift-nio-ssh is thin for what the
core uses.

**Kotlin Multiplatform.** One core for both apps. Rejected: it rewrites the Android core, which is
built and tested, and SSH on iOS would still need a native library under it.

**libssh2.** Rejected: C, to cross-compile for the device and the simulator and to wrap, for less
than swift-nio-ssh gives.

**A key in the Secure Enclave.** Rejected for now: the Secure Enclave has P-256 keys only, none on
the simulator, which is where the app is tested, and it would mean two code paths and two key types
beside Android's Ed25519. It may come later, for both apps at once.

**One build of the page with both media origins.** Left to the implementation of the platform: the
build test covers what ships for each platform either way.

## Consequences

- The plugin contract (`plugin.ts`) has two native implementations, Kotlin and Swift; the shared
  cases and the pin of the remote command hold the parts both cover together, and what they do not
  cover (SSH, events, the state machine) is held by two suites that mirror each other.
- Rule 10 has a third holder of the token: the Swift plugin, beside `main.ts` and `PinePlugin.kt`.
- The release workflow gains a job `ios` on a macOS runner with an Xcode able to build the project.
  It needs no secret, so a release always has its IPA. (Taken out again in 0.49.1: the core's
  `swift test` did not pass on GitHub's Xcode 27 preview image. The IPA is built by hand meanwhile.)
- The owner installs and renews the app with their own Apple ID; the manual says how, and that a
  free Apple ID means a renewal every 7 days.
- A reinstall under another Apple ID means adding the new key to every machine again.
- iOS asks once for the local network when a machine on the Wi-Fi is reached.
- What is proven only on the simulator (the hardening, the Keychain) is not proven by any workflow:
  the smoke run is run by hand before a release that changes the iOS app or upgrades Capacitor.

## Amended: pairing, the `pine:` scheme and an embedded library

The app now pairs with a computer that runs the Pine app ([0001](0001-mobile-app.md), "Amended:
the app pairs with the Pine app"). What that changed on iOS:

- **The `pine:` scheme.** Universal links need the app signed by a team the website names, which
  an IPA that each owner signs cannot have. So the app registers `pine:` (`CFBundleURLTypes`),
  and the web client, on an iPhone or iPad only, offers "Open in the Pine app" or "Continue in
  this browser" before it uses a pairing code; the first opens
  `pine://pair?service=<percent-encoded https origin>&id=<machine id>&code=<code>`. `SceneDelegate`
  hands such an address to the plugin, at start or while running, and never to the web view; the
  page reads it with the same parser as a pasted link and asks the owner before anything is used.
  Any app can open a `pine:` address, so that question is the guard.
- **libdatachannel, linked in.** The data channel is libdatachannel (`libdatachannel-xcframework`,
  static, wrapped in Swift), bridged into a NIO channel by a socket pair so that swift-nio-ssh gets
  what it gets over TCP. It needs OpenSSL, embedded as `OpenSSL.framework`; the IPA script takes
  that framework's vendor signature off and checks that nothing in the IPA is signed. Re-signing
  as a sideloading tool does was tried with a throwaway identity and passes `codesign --verify`;
  installing with AltStore or Sideloadly was not tried. The xcframework has no Intel slice for
  macOS, so `swift test` runs on Apple silicon only.
- **No TCP keepalive on this path.** The loss of a paired connection is taken from the data
  channel's and the peer connection's own state, and the health check on return.
- **The Keychain key pairs too.** The phone presents the key it keeps in the Keychain; there is no
  second key. A reinstall under another Apple ID means pairing again, and removing the old device
  at the computer.
- **The device's name** is "Pine on iPhone" or "Pine on iPad": iOS gives an app no model name
  without a table of hardware ids, and the owner's own device name needs an entitlement.
- **The local network sentence** now speaks of the machines the owner adds or pairs with.
  (Changed again by [0005](0005-pairing-from-nearby-devices.md): it says first that Pine looks for
  the owner's computer on this network, and iOS asks when the pairing view is first shown.)
