# Privacy policy of the Pine app

This policy covers Pine, the app of pine for iPhone, iPad and Android, whether installed from
TestFlight, from the APK or IPA of a release, or built from the source. Pine is open source:
<https://github.com/pmndre/pine>.

## What Pine collects

Nothing. Pine sends no data to its maintainer or to anybody else. It has no analytics, no crash
reporting, no advertising, no tracking and no account. It does not use the advertising
identifier. In App Store Connect its privacy details are "Data Not Collected".

## What stays on your device

To work, the app keeps on the device itself, and nowhere else:

- the SSH key it made for this device (on an iPhone or an iPad in the iOS Keychain, on this
  device only and in no backup; on Android encrypted with a key of the Android Keystore);
- the machines you added (user, host and port), the host key you trusted for each, and which one
  is in use;
- the computers you paired by QR code: the name each gave, the fingerprint of its key, and the
  meeting service that introduces the two devices;
- settings of the app, such as its theme.

Removing the app removes them.

## Where your data goes

Only to the machines you add yourself. The app connects over SSH to each machine you add and
shows the pine that runs there: your conversations, files and settings are on that machine, and
the app reads and writes them only there. Pine's maintainer runs none of those machines and sees
none of it.

A computer you paired by QR code is reached peer to peer, over a direct connection encrypted end
to end. To set it up, the app and the computer exchange a few small messages through the meeting
service the pairing link names: Pine's own (`https://pine.drcmda.workers.dev`, run on Cloudflare; the
service stores none of them) or a deployment of your own. It sees neither key nor token, nor
anything you do with your pine. The STUN servers that service names see your device's network
address, as any connection does.

When an agent on your machine uses a model provider, a web page or another service, that is your
pine's doing, on your machine, under your configuration, and that service's own policy applies.

Apple and GitHub, which distribute the app, may keep their own records of downloads and installs
under their own policies. Through TestFlight, a crash report or feedback reaches the maintainer
only when you choose to send it.

## Children

Pine is not directed at children and collects nothing from anybody.

## Changes

A change to this policy is made in this file, in pine's repository, where its history is public.

## Contact

Open an issue at <https://github.com/pmndre/pine/issues>.
