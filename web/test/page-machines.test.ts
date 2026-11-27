// What the page draws of machines, read from the states and preferences the bridges hand it
// (desktop/src/machines.ts): a paired computer by its name, never its id; a pairing under way on the
// first screen; how a pairing ended; where the home-screen suggestion is offered; and which view of
// the screen that asks which pine to use is shown, with which controls.
import assert from "node:assert/strict";
import { test } from "node:test";
import { firstScreen, homeScreenKeeps, isDesktopBrowser, isPaired, machineName, machinesView, meetingLine, noMachineSaid, pairingEnded, reachedThrough, relayLine } from "../../desktop/src/machines.ts";

const PAIRED = "paired:q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x-_";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

test("a paired computer is written paired:<machine id>, and nothing else is one", () => {
	assert.equal(isPaired(PAIRED), true);
	assert.equal(isPaired("mac:q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x-_"), false);
	assert.equal(isPaired("paired:short"), false);
	assert.equal(isPaired("me@box.example"), false);
});

test("a paired computer is named by the name kept for it, or 'your computer'; never by its id; a user@host machine by its host unless renamed", () => {
	assert.equal(machineName(PAIRED, { [PAIRED]: "Studio Mac" }), "Studio Mac");
	assert.equal(machineName(PAIRED, {}), "your computer");
	assert.equal(machineName(PAIRED), "your computer");
	assert.equal(machineName("me@box.example", {}), "me@box.example");
	assert.equal(machineName("me@box.example", { "me@box.example": "Box" }), "Box");
});

test("the first screen during a pairing: what to do before the computer answered, then the four digits and 'Confirm on your computer'", () => {
	const before = firstScreen({ status: "starting", pairing: { name: "Chrome on Android" } });
	assert.equal(before?.title, "Pairing with your computer");
	assert.equal(before?.code, undefined);
	const asked = firstScreen({ status: "starting", pairing: { code: "4821", name: "Chrome on Android" } });
	assert.equal(asked?.title, "Confirm on your computer");
	assert.equal(asked?.code, "4821");
	assert.match(asked?.about ?? "", /Chrome on Android/);
	assert.match(asked?.about ?? "", /4821/);
	assert.match(asked?.about ?? "", /Allow/);
	assert.doesNotMatch(`${before?.title} ${before?.about} ${asked?.title} ${asked?.about}`, /\bMac\b/);
	// The computer's own name, once it gave it with the digits (a computer found on the network was only "Pine").
	const named = firstScreen({ status: "starting", pairing: { code: "4821", name: "Pine on Pixel 9", computer: "Studio Mac" } }, "phone");
	assert.equal(named?.title, "Confirm on Studio Mac");
	assert.match(named?.about ?? "", /^Studio Mac asks whether "Pine on Pixel 9" may connect/);
	// No pairing: the first screen is drawn as before.
	assert.equal(firstScreen({ status: "starting" }), undefined);
	assert.equal(firstScreen({ status: "starting", host: PAIRED }), undefined);
});

test("how a pairing ended, from the state before and the one after: paired when a machine is reached next, failed on an error with no machine", () => {
	const asking = { status: "starting", pairing: { code: "4821", name: "Chrome on Android" } } as const;
	assert.equal(pairingEnded(asking, { status: "starting", host: PAIRED }), "paired");
	assert.equal(pairingEnded(asking, { status: "error", kind: "ssh", message: "Your computer refused this browser." }), "failed");
	assert.equal(pairingEnded({ status: "starting", pairing: {} }, { status: "error", kind: "ssh", message: "expired" }), "failed");
	// Still pairing, or no pairing at all: nothing ended.
	assert.equal(pairingEnded({ status: "starting", pairing: {} }, asking), undefined);
	assert.equal(pairingEnded({ status: "starting", host: PAIRED }, { status: "error", kind: "ssh", host: PAIRED, message: "x" }), undefined);
	assert.equal(pairingEnded({ status: "starting" }, { status: "error", kind: "ssh", message: "x" }), undefined);
});

test("the home-screen suggestion is offered only where an installed web app keeps the browser's data: Android, not iOS or iPadOS, not a computer", () => {
	assert.equal(homeScreenKeeps(ANDROID), true);
	assert.equal(homeScreenKeeps(IPHONE), false);
	assert.equal(homeScreenKeeps(IPAD, 5), false);
	assert.equal(homeScreenKeeps(DESKTOP), false);
	assert.equal(homeScreenKeeps(""), false);
});

test("the screen that asks which pine to use: how to pair first, with a link to SSH where the service offers both, and a back control in the SSH view", () => {
	const both = { canPair: true, canAddHost: true, hosts: [] };
	assert.deepEqual(machinesView(both), { view: "pair", toSsh: true, back: false });
	assert.deepEqual(machinesView({ ...both, chosen: "ssh" }), { view: "ssh", toSsh: false, back: true });
	assert.deepEqual(machinesView({ ...both, chosen: "pair" }), { view: "pair", toSsh: true, back: false });
});

test("where the service has no meeting service there is nothing to pair with: the SSH view, with no back control; the desktop and mobile apps' bridges say neither and get it too", () => {
	for (const chosen of [undefined, "pair", "ssh"] as const) {
		assert.deepEqual(machinesView({ canPair: false, canAddHost: true, hosts: [], chosen }), { view: "ssh", toSsh: false, back: false }, String(chosen));
	}
});

test("where the relay is off the pairing view has no link to SSH", () => {
	for (const chosen of [undefined, "pair", "ssh"] as const) {
		assert.deepEqual(machinesView({ canPair: true, canAddHost: false, hosts: [], chosen }), { view: "pair", toSsh: false, back: false }, String(chosen));
	}
	assert.deepEqual(machinesView({ canPair: false, canAddHost: false, hosts: [] }), { view: "pair", toSsh: false, back: false });
});

test("a browser that already has machines lands where it did: the SSH view when it has a user@host machine, the pairing view when it has only paired computers", () => {
	const both = { canPair: true, canAddHost: true };
	assert.equal(machinesView({ ...both, hosts: ["me@box.example"] }).view, "ssh");
	assert.equal(machinesView({ ...both, hosts: [PAIRED, "me@box.example"] }).view, "ssh");
	assert.equal(machinesView({ ...both, hosts: [PAIRED] }).view, "pair");
	// The owner's choice wins over that.
	assert.equal(machinesView({ ...both, hosts: ["me@box.example"], chosen: "pair" }).view, "pair");
});

test("with no machine in use the first screen's sentence follows the view shown: the bridge's (add user@host) in the SSH view, none in the pairing view, whose how-to says what to do", () => {
	const none = { status: "error", kind: "ssh", message: "Add the machine whose pine this browser is to use, as user@host or user@host:port. Put this browser's key into ~/.ssh/authorized_keys there first." } as const;
	// One paired computer and no user@host machine, with relay and meeting both on: the pairing view.
	const view = machinesView({ canPair: true, canAddHost: true, hosts: [PAIRED] }).view;
	assert.equal(view, "pair");
	assert.equal(noMachineSaid(none, view, false), undefined);
	// The owner switched to the SSH view: the bridge's sentence is the one for it.
	assert.equal(noMachineSaid(none, "ssh", false), none.message);
	// Anything else is said as the bridge says it: a pairing that failed, a machine in use that is not reached.
	const failed = { status: "error", kind: "ssh", message: "Your computer refused this browser." } as const;
	assert.equal(noMachineSaid(failed, "pair", true), failed.message);
	const lost = { status: "error", kind: "ssh", host: PAIRED, message: "Studio Mac does not answer." } as const;
	assert.equal(noMachineSaid(lost, "pair", false), lost.message);
});

test("the relay and the meeting service are said by the deployment's host: SSH through the relay, which cannot read it; a paired computer found there, then reached directly or through a relay server its owner named", () => {
	const host = "pine-main.drcmda.workers.dev";
	assert.equal(relayLine(host), "Connections go through the relay at pine-main.drcmda.workers.dev. The relay carries only SSH and cannot read it.");
	assert.equal(meetingLine(host), "Found through pine-main.drcmda.workers.dev. The two devices then connect directly, or through a relay server that the computer's owner chose.");
	assert.equal(reachedThrough("me@box.example", host), "Through the relay at pine-main.drcmda.workers.dev.");
	assert.equal(reachedThrough(PAIRED, host), meetingLine(host));
	// A bridge that names no service (the desktop and mobile apps) gets no such line.
	assert.equal(reachedThrough("me@box.example"), undefined);
	assert.doesNotMatch(`${relayLine(host)} ${meetingLine(host)}`, /\bMac\b/);
});

test("'Open Pine on this computer' is for a browser on a computer only: not a phone, not a tablet, not an iPad that says it is a Mac", () => {
	assert.equal(isDesktopBrowser(DESKTOP), true);
	assert.equal(isDesktopBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"), true);
	assert.equal(isDesktopBrowser("Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0"), true);
	assert.equal(isDesktopBrowser(ANDROID), false);
	assert.equal(isDesktopBrowser(IPHONE), false);
	assert.equal(isDesktopBrowser(IPAD, 5), false);
	assert.equal(isDesktopBrowser(IPAD, 0), true, "a Mac's Safari has no touch points");
});
