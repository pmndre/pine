# The Android and iOS app: building, testing, releasing

For contributors. What an owner needs is in [references/mobile.md](../references/mobile.md); why
the app is built so is in [ADR 0001](../adr/0001-mobile-app.md), [ADR 0002](../adr/0002-ios-app.md),
[ADR 0004](../adr/0004-browser-access.md) and [ADR 0005](../adr/0005-pairing-from-nearby-devices.md).

The app lies in `mobile/`: Capacitor around the page of `desktop/`, the same page on both systems.
The native part (`PinePlugin.kt` on Android, `PinePlugin.swift` on iOS, on the cores in
`mobile/core` and `mobile/ios-core`) holds the token and the phone's key and makes every call for
the page. The direct connection to a paired computer is Google's libwebrtc on Android and
libdatachannel on iOS, never in the page. Computers on the network are found with `NsdManager`
(Android) and `NWBrowser` (iOS), `_pine._tcp` with TXT `v=1`.

Run everything in `mobile/` (`npm install` there once).

## Android

Needs the Android SDK (`ANDROID_HOME`, default `~/Library/Android/sdk`) and a JDK of 21 or later
(`JAVA_HOME`, default Android Studio's on a Mac).

| Command | What it does |
|---|---|
| `npm run apk` | A debug APK, in `android/app/build/outputs/apk/debug/` |
| `npm run apk:release` | A release APK. Signed when `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` name a key, unsigned otherwise. `PINE_VERSION` and `PINE_VERSION_CODE` set its version |
| `npm run test:core` | The Kotlin core on the JVM, against an SSH server in the test and a stand-in daemon, and for a paired computer against the Pine app's real access host (pairing, calls, reconnection, refusals, several megabytes each way). That part needs Node and `npm install` in `desktop/` |
| `npm run smoke` | Builds, installs on an emulator without a window and drives the app against a test machine of its own. The one test of the WebView's hardening (no permission, no window, no file access, no navigation away), Share, the back button, the return from the background, and the system bars in dark and light (`bars-dark.png`, `bars-light.png`). It pairs end to end with the real access host: first libwebrtc alone (`LibWebRtcTest`: pairs, connects, sends 2, 4 and 6 MiB each way), then the app by a pasted link and by an App Link while running and at start, with a malformed link and an `http` service refused. `--transport-only` runs the libwebrtc test alone, `--pairing-only` that and the pairing. A cold emulator on a busy computer may say its own apps are not responding: the run answers Wait and fails only when the app itself is not responding. Run it before a release that changes `mobile/` or upgrades Capacitor |

The app takes `https` meeting services only, and the smoke's access host is on this computer. So
the run puts a TLS front with a certificate authority of its own before it, which only the debug
build trusts (network security config under `debug-overrides`, from `-PpineSmokeAuthority`;
without it, an authority whose private key was thrown away). A release build has neither. Android
verifies an App Link only against the service on the web, so the run marks the link verified by
hand (`pm set-app-links`) and opens it as a camera would.

Attaching a photo through the system's file chooser is not driven by the smoke run: check it by
hand before such a release.

## iOS

Needs a Mac with Xcode 27 and, for the simulator, an iOS simulator runtime (Xcode > Settings >
Components).

| Command | What it does |
|---|---|
| `npm run sync:ios` | Builds the page for iOS (WebKit, media on `pine-media:`) and copies it into `ios/` |
| `npm run ios` | A debug build for the simulator, not signed, in `ios/DerivedData` |
| `npm run ios:run` | Builds the app and opens it in the Simulator app |
| `npm run ipa` | The IPA of a release, not signed, in `ios/App/output/Pine-<version>.ipa` (`npm run ipa -- 0.38.0`; 0.0.0 without a version). Fails unless the app inside is unsigned and arm64 |
| `npm run smoke:ios` | A simulator of its own without a window, the app and a test inside it, driven against a test machine on the Mac's loopback. The one test of the web view's hardening on iOS (the page's policy, no camera, microphone or motion, no file access, the media scheme and its ranges, no window, no navigation away), the safe area with and without the keyboard, a fingerprint within the screen's width, the return from the background, the status bar in dark and light, and the key kept across a relaunch. It pairs end to end with the real access host by a pasted link and a `pine:` address, with a malformed address and an `http` service refused, behind a TLS front whose authority it adds to that simulator alone (`simctl keychain add-root-cert`). `--pairing-only` runs the pairing alone. Run it before a release that changes `mobile/` or upgrades Capacitor |
| `swift test` (in `ios-core/`) | The Swift core on the Mac, against an OpenSSH `sshd` of the test's own and a stand-in daemon, and against the real access host (Node and `npm install` in `desktop/`). Apple silicon only: libdatachannel has no Intel slice for macOS |

### The app on the simulator against your own pine

Turn on Remote Login (System Settings > General > Sharing), run `npm run ios:run`, add the
simulator's key (Settings > Environments) to your `~/.ssh/authorized_keys`, and add the machine as
`you@127.0.0.1`. The simulator shares the Mac's network and loopback, and iOS does not ask about
the local network there. `ios:run` signs the build to run locally (no account needed): the
Keychain refuses an app that is not signed at all.

## What the tests do not cover

The direct connection's libraries are proven on the JVM and the Mac (the cores' suites), on the
emulator and on the simulator. Not tried yet: a real phone, an Android phone with 16 KB memory
pages, cellular networks, AltStore and Sideloadly installing the IPA that carries libdatachannel,
the iOS app started cold by a `pine:` address, and finding a computer on a real network
(`NsdManager`, `NWBrowser`): the suites test reading the announcement and pairing without a code,
not the looking. Try these by hand before a release that changes that path.

## In a release

The Release workflow (`.github/workflows/release.yml`, job `android`) builds the release APK for
every release from `main` and attaches it as `Pine-<version>.apk`: `versionName` the release's
version, `versionCode` major × 1 000 000 + minor × 1 000 + patch. It takes the key from four
secrets of the environment `release`; without them it builds no APK and says so. The release APK
carries libwebrtc for arm64-v8a and armeabi-v7a only, and the job fails when a native library kept
its debug symbols. A debug APK carries all four ABIs, for emulators.

To build a release's APK again: `gh workflow run release.yml -f version=0.38.0 -f apps=android`
from `main`.

The release does not build the IPA for now: the core's `swift test` did not pass on GitHub's
Xcode 27 image. On a Mac with Xcode 27, run `npm test` in `mobile/` and `swift test` in
`mobile/ios-core/`, then `npm run ipa -- <version>`. Its build number is Android's `versionCode`.
The IPA carries libdatachannel and OpenSSL as a framework; the script takes the vendor's signature
off that framework, so that nothing in the IPA is signed before the owner signs it.

The App Links statement that lets a scanned link open the Android app is served by the meeting
service when `ANDROID_CERT_SHA256` is set ([dev/web.md](web.md), "Deploying it").
