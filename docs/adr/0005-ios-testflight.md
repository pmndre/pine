# 0005: The iOS app on TestFlight, signed by the maintainer's Apple team

Status: accepted. Supersedes in part ADR 0002: what it says about Apple signing, secrets and
TestFlight. The rest of ADR 0002 stands.

## Context

ADR 0002 made the iOS app sideload only: every release attaches an unsigned
`Pine-<version>.ipa`, which an owner signs with their own Apple ID through AltStore or Sideloadly.
It said so because "the only paid account is somebody else's".

That path asks a lot of an owner: a computer, a cable or the same Wi-Fi, trusting a developer
certificate, Developer Mode, and with a free Apple ID a renewal every seven days. Most owners
who want pine on an iPhone stop there.

The maintainer now has a paid Apple Developer Program membership of his own: an individual team.
TestFlight's external testing with a public link gives an install from the iPhone
alone, kept for 90 days per build, with every later build arriving as an update.

## Decision

**TestFlight beside sideloading.** Every release from `main` is also built signed by the
maintainer's team, uploaded to App Store Connect, added to the external group `Public`, whose public
link the README and the release page give, and submitted to Beta App Review. Every preview from
`next` goes to the internal group `Maintainers` (the maintainer's own devices), with no review, so
that a preview is tried on a real iPhone before `next` is moved to `main`. The unsigned IPA stays
the sideloading way and keeps no secret and no environment. (Since 0.49.1 it is built by hand: the
job `ios` was taken out because the core's `swift test` did not pass on GitHub's Xcode 27 preview
image. The job `testflight` runs on the same image and does not run `swift test` either.)

**One App Store Connect API key, cloud-managed signing.** The key (role Admin: cloud-managed
signing needs it, App Manager is not enough) is the only Apple secret. `xcodebuild` signs automatically with it (`-allowProvisioningUpdates`), with Apple's
cloud-managed distribution certificate: no `.p12`, no provisioning profile, no fastlane, nothing
to rotate by hand. The team and the bundle id are given on the command line of the signed
build only (`DEVELOPMENT_TEAM`, `PRODUCT_BUNDLE_IDENTIFIER`), never committed into the project, so the unsigned and simulator builds are
unchanged. The archive is exported for App Store Connect with destination `upload`. A small Node
script with no dependency then talks to the App Store Connect API: it waits for processing, sets
"What to Test" to the release's commit subject, and adds the build to its group (and, from
`main`, submits it for review). A build already in its group or already submitted is no error.

**A GitHub environment of its own.** The key lives in the environment `testflight`, whose
deployment branches are `main` and `next`, as three secrets: `ASC_KEY` (the `.p8` file's content),
`ASC_KEY_ID` and `ASC_ISSUER_ID`. The release job `testflight` runs in it for both channels and for
`workflow_dispatch`. The environment `release` (the Mac and Android signing keys) stays restricted
to `main`. Without the three secrets the job passes and says that nothing was uploaded, so a fork
or a fresh setup does not fail, and a failed upload holds back neither npm nor the other apps.

**The team and the bundle id are configuration.** The signing team is the repository variable
`IOS_TEAM_ID`, the bundle id of the TestFlight build the variable `IOS_BUNDLE_ID`, by default
`dev.pmndre.pine`, the project's own, registered on the team for iPhone and iPad. Neither is in
the code, so another maintainer's team takes over by changing those two variables and the three
secrets, with no commit. Without the secrets and the team the job uploads nothing; with only some
of them it fails. The sideloaded IPA and the Android app stay `dev.pmndre.pine`. The public link is
kept in the repository variable `TESTFLIGHT_LINK`, not in the code.

**Build numbers that order previews and releases.** `CFBundleShortVersionString` is always
`X.Y.Z`. `CFBundleVersion` is Android's `versionCode(X.Y.Z)` × 1000 + N, where N is the `N` of a
preview `X.Y.Z-next.N` (1 to 998) and 999 for the release `X.Y.Z`: a release sorts after all its
previews, and a rebuild of a tag gives the same number, which App Store Connect recognises as
uploaded already. The unsigned IPA carries the same number. Android's `versionCode` is unchanged.

**Exempt encryption.** The app uses encryption only through standard algorithms for
authentication and for securing its own connections (SSH on Apple's swift-nio-ssh and
swift-crypto, HTTPS through the system), in a mass-market app: the kind of use that export rules
exempt. The app declares `ITSAppUsesNonExemptEncryption = NO`, so that App Store Connect does not
hold each build on the export compliance question. This is the project's reading of those rules,
not legal advice.

**Nothing collected.** App Privacy is "Data Not Collected", and the privacy policy is
[docs/privacy.md](../privacy.md), whose GitHub address is the one App Store Connect gives. The
app carries a privacy manifest (UserDefaults, reason `CA92.1`; no tracking, no collected data)
and arm64 as its required device capability.

**Two Apple teams.** The Mac app stays signed and notarised by the team it is signed by now; iOS
is signed by the maintainer's individual team. The two are separate on purpose, and nothing in
either build depends on the other.

## Alternatives considered

**Sideloading only (ADR 0002).** Kept as a way, no longer the only one: it loses most owners at
the first step.

**The App Store.** Left for a later decision: a listing, screenshots and a full review, for an
app that shows a machine of the owner's own. TestFlight's public link reaches owners now, and the
same signed archive can go to the App Store later.

**fastlane, or a certificate and profile kept as secrets.** Rejected: cloud-managed signing with
one API key needs neither, and keeps one secret to rotate instead of three that expire.

**Ad Hoc distribution, or the EU's alternative distribution.** Rejected: Ad Hoc needs every
device's identifier in advance, and alternative distribution reaches the EU only.

**An organisation's team now.** Not needed for TestFlight. A later move is an App Transfer of the
app record to that organisation: TestFlight testers and builds do not carry over, so owners on the
public link open the new team's link once, and since the Keychain's access group follows the
team, the app makes a new key there too.

An App Transfer needs a version released on the App Store, which a TestFlight-only app does not
have. Without one, another maintainer's team takes over by setting it up again, which is what this
decision did once and costs the owners the same as a transfer (a new link, a new key):

1. On the new team: accept the Program License Agreement, create an App Store Connect API key with
   the Admin role, register the bundle id, create the app record and the groups `Public` (public
   link on) and `Maintainers`, and fill the beta review information.
2. The bundle id `dev.pmndre.pine` stays registered on the old team while its app record exists.
   Either the old team removes the app record and the bundle id first, or the new team registers
   another bundle id and sets it as `IOS_BUNDLE_ID`.
3. In GitHub: the variables `IOS_TEAM_ID` and `IOS_BUNDLE_ID`, the three secrets of the
   environment `testflight` and the variable `TESTFLIGHT_LINK`. No commit.
4. The old team's public link is turned off, and the README and the release notes give the new one.

## Consequences

- An owner with an iPhone or an iPad installs Pine from a link and gets every release as an
  update, with no computer and no renewal by hand.
- The phone's key is kept in the Keychain under the team that signed the app. A TestFlight install
  and a sideloaded one hold different keys: switching from one to the other means adding the new
  public key to `authorized_keys` on every machine. The manual says so.
- The repository has Apple signing secrets, in the environment `testflight` only, and whose team
  signs is a variable. Nothing about them is in the code or the project file.
- A release reaches TestFlight's public group after Apple's review of its build, which can take
  a day; a preview reaches the internal group minutes after its push.
- Each TestFlight build expires 90 days after its upload: a project without a release in 90 days
  leaves owners on TestFlight with an app that does not open until the next one.
- Signing and upload have no automated test: they are verified on the maintainer's Mac with the
  real key, then by the first push to `next`. The distribution script and the build numbers are
  tested on their own.
