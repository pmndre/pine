// What the web bridge reads of a pairing link, and the name it gives this browser for the
// computer it pairs with.
import assert from "node:assert/strict";
import test from "node:test";
import { isPaired, PAIRED } from "../../desktop/src/machines.ts";
import { deviceName, pairedFingerprint, takePairLink } from "../src/pairing.ts";

const ID = "Zm9vYmFyLWJhei1xdXV4LTAxMjM0NTY3ODktYWJjZGVm".slice(0, 43);
const CODE = "AAECAwQFBgcICQoLDA0ODw";

/** An address and the record of what replaced it. */
function address(href: string) {
	const u = new URL(href);
	const replaced: string[] = [];
	return { at: { href: u.href, hash: u.hash }, replaced, replace: (url: string) => void replaced.push(url) };
}

test("a pairing link's fragment is read and taken out of the address", () => {
	const a = address(`https://pine.example.workers.dev/#pair=${ID}.${CODE}`);
	assert.deepEqual(takePairLink(a.at, a.replace), { link: { id: ID, code: CODE } });
	assert.deepEqual(a.replaced, ["https://pine.example.workers.dev/"]);
});

test("a pairing link is read from a live address, whose fragment is gone once it is replaced", () => {
	// As `location` is: replacing the address (history.replaceState) changes what it says at once.
	const live = { href: `https://pine.example.workers.dev/#pair=${ID}.${CODE}`, hash: `#pair=${ID}.${CODE}` };
	const replace = (url: string) => Object.assign(live, { href: url, hash: "" });
	assert.deepEqual(takePairLink(live, replace), { link: { id: ID, code: CODE } });
	assert.equal(live.href, "https://pine.example.workers.dev/");
});

test("a malformed pairing link is taken out all the same, and ignored with a message", () => {
	for (const bad of [`#pair=${ID}`, `#pair=${ID}.short`, `#pair=${ID.slice(1)}.${CODE}`, `#pair=${ID}.${CODE}.x`, `#pair=${ID}.${CODE.slice(0, 21)}!`, "#pair="]) {
		const a = address(`https://pine.example/web/${bad}`);
		const taken = takePairLink(a.at, a.replace);
		assert.equal(taken.link, undefined, bad);
		assert.ok(taken.problem, `${bad}: said to be no good`);
		assert.deepEqual(a.replaced, ["https://pine.example/web/"], bad);
	}
});

test("an address without a pairing link is left as it is", () => {
	for (const hash of ["", "#", "#other=1"]) {
		const a = address(`https://pine.example/${hash}`);
		assert.deepEqual(takePairLink(a.at, a.replace), {});
		assert.deepEqual(a.replaced, []);
	}
});

test("a machine id is the fingerprint of the computer's host key, in the form OpenSSH prints", () => {
	assert.equal(pairedFingerprint("ab-_cd" + "x".repeat(37)), `SHA256:ab+/cd${"x".repeat(37)}`);
});

test("this browser's name for the computer it pairs with: the browser and the system", () => {
	const named: [string, string, string][] = [
		["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36", "Chrome", "Android"],
		["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", "Safari", "iPhone"],
		["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1", "Chrome", "iPhone"],
		["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15", "Firefox", "iPad"],
		["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15", "Safari", "Mac"],
		["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0", "Edge", "Windows"],
		["Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0", "Firefox", "Linux"],
		["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "Chrome", "ChromeOS"],
		["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/114.0.0.0", "Opera", "Windows"],
	];
	for (const [agent, browser, system] of named) assert.ok(deviceName(agent).includes(browser) && deviceName(agent).includes(system), `${agent}: ${deviceName(agent)}`);
	// A user agent that says nothing it knows still gets a name, in words of pine's own and none of the agent's.
	for (const agent of ["", "Something\u0007odd/1.0"]) assert.ok(/^[\w ]+$/.test(deviceName(agent)) && !deviceName(agent).includes("odd"), JSON.stringify(deviceName(agent)));
});

test("a paired computer is written paired: and its machine id among the machines; nothing else is one", () => {
	assert.equal(PAIRED, "paired:");
	assert.equal(isPaired(`paired:${ID}`), true);
	for (const other of [`mac:${ID}`, `paired:${ID.slice(1)}`, `paired:${ID}x`, "me@box.example", ID]) assert.equal(isPaired(other), false, other);
});

test("a pairing link that cannot be read says what to do in words that fit any computer", () => {
	const a = address("https://pine.example/#pair=bad");
	assert.doesNotMatch(takePairLink(a.at, a.replace).problem ?? "", /\bMac\b/);
});
