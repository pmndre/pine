import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { test } from "node:test";
import { harness, mockMsg, sleep, until } from "../../testing/harness.ts";
import { png } from "../../testing/png.ts";

const owner = { trust: "owner" as const };

const call = (name: string, args: any) => ({ name, args });

const crlf = (s: string) => s.replace(/\r?\n/g, "\r\n");

const b64 = (s: string) => Buffer.from(s).toString("base64");

const freePort = () =>
	new Promise<number>((resolve) => {
		const s = net.createServer().listen(0, "127.0.0.1", () => {
			const p = (s.address() as net.AddressInfo).port;
			s.close(() => resolve(p));
		});
	});

/** A device's side of an SMTP conversation: one line out, one reply back (all its lines). */
async function smtpClient(port: number) {
	const sock = net.connect(port, "127.0.0.1");
	sock.on("error", () => {});
	let buffer = "";
	let waiting: (() => void) | undefined;
	let closed = false;
	sock.on("data", (d) => {
		buffer += d.toString("utf8");
		waiting?.();
	});
	sock.on("close", () => {
		closed = true;
		waiting?.();
	});
	const reply = async (): Promise<string> => {
		const end = Date.now() + 4000;
		for (;;) {
			const lines = buffer.split("\r\n");
			const last = lines.findIndex((l) => /^\d{3}(?: |$)/.test(l));
			if (last >= 0 && last < lines.length - 1) {
				buffer = lines.slice(last + 1).join("\r\n");
				return lines.slice(0, last + 1).join("\n");
			}
			if (closed) return "closed";
			if (Date.now() > end) throw new Error(`no reply; got ${JSON.stringify(buffer)}`);
			await new Promise<void>((r) => {
				const timer = setTimeout(r, 200);
				waiting = () => (clearTimeout(timer), r());
			});
		}
	};
	const greeting = await reply();
	return { greeting, reply, write: (raw: string | Buffer) => sock.write(raw), cmd: (line: string) => (sock.write(`${line}\r\n`), reply()), close: () => sock.destroy(), isClosed: () => closed };
}

test("smtp: a drop that takes mail from the device that proves itself, for the recipient it is for, and nothing else", async () => {
	const [p1, p2, p3, p4] = [await freePort(), await freePort(), await freePort(), await freePort()];
	const h = await harness({
		pine: {
			sources: {
				nas: { type: "smtp", host: "127.0.0.1", port: p1, user: "nas", password: "nas-mail-pass", to: ["alerts@pine.home"], maxMb: 0.02, start: "always", description: "what the NAS reports" },
				printer: { type: "smtp", host: "127.0.0.1", port: p2, allow: ["127.0.0.1"], start: "always" },
				fenced: { type: "smtp", host: "127.0.0.1", port: p3, user: "x", password: "fenced-pass-1", allow: ["10.9.9."], start: "always" },
				anyone: { type: "smtp", host: "127.0.0.1", port: p4, start: "always" },
			},
		},
		agents: { main: {} },
	});
	const events = (name: string): any[] => h.pine.bus.query({ topic: `source/${name}/#` }).sort((a: any, b: any) => a.id - b.id);
	const info = (name: string) => h.pine.sources.list().find((s) => s.name === name)!;
	// Neither a login nor a list of addresses: it does not start, and says what it needs.
	assert.deepEqual([info("anyone").running, /or "allow" with the addresses of the devices: without either anyone on the network could hand mail to your agents/.test(info("anyone").error ?? "")], [false, true]);

	const nas = await smtpClient(p1);
	assert.match(nas.greeting, /^220 /);
	const hello = await nas.cmd("EHLO diskstation");
	assert.match(hello, /250-SIZE 20971\b[\s\S]*250-AUTH PLAIN LOGIN/);
	assert.ok(!/STARTTLS/.test(hello));
	// Not before it has logged in.
	assert.match(await nas.cmd("MAIL FROM:<nas@diskstation.local>"), /^530 /);
	assert.match(await nas.cmd(`AUTH PLAIN ${b64("\0nas\0wrong-password")}`), /^535 /);
	assert.match(await nas.cmd("AUTH CRAM-MD5"), /^504 /);
	assert.match(await nas.cmd("AUTH LOGIN"), /^334 VXNlcm5hbWU6$/);
	assert.match(await nas.cmd(b64("nas")), /^334 UGFzc3dvcmQ6$/);
	assert.match(await nas.cmd(b64("nas-mail-pass")), /^235 /);
	// Too large by its own word, a recipient this drop is not for, things in the wrong order.
	assert.match(await nas.cmd("MAIL FROM:<nas@diskstation.local> SIZE=99999999"), /^552 /);
	assert.match(await nas.cmd("RCPT TO:<alerts@pine.home>"), /^503 /);
	assert.match(await nas.cmd("MAIL FROM:<NAS@diskstation.local> SIZE=2000"), /^250 /);
	assert.match(await nas.cmd("DATA"), /^503 /);
	assert.match(await nas.cmd("RCPT TO:<somebody@gmail.com>"), /^550 /);
	assert.match(await nas.cmd("RCPT TO:<Alerts@Pine.Home>"), /^250 /);
	assert.match(await nas.cmd("DATA"), /^354 /);
	const picture = png(6, 6);
	const body = crlf(
		[
			'From: "DiskStation" <nas@diskstation.local>',
			"To: alerts@pine.home",
			"Subject: =?utf-8?B?Vm9sdW1lIDEgZmFzdCB2b2xsOiA5MiAl?=",
			'Content-Type: multipart/mixed; boundary="xx"',
			"",
			"--xx",
			"Content-Type: text/plain; charset=utf-8",
			"",
			"Volume 1 is 92 % full.",
			"..a line that began with a dot",
			"--xx",
			'Content-Type: image/png; name="../../usage chart.png"',
			"Content-Transfer-Encoding: base64",
			"",
			picture.toString("base64"),
			"--xx--",
		].join("\n"),
	);
	// The end of the message in two pieces, as a network may deliver it.
	nas.write(`${body}\r\n.`);
	await sleep(30);
	nas.write("\r\n");
	assert.match(await nas.reply(), /^250 /);
	await until(() => events("nas").length === 1, 3000, "the mail to be reported");
	const e = events("nas")[0];
	assert.deepEqual([e.topic, e.trust, e.payload.from, e.payload.fromName, e.payload.to, e.payload.subject, e.payload.text, e.payload.client], ["source/nas/mail", "untrusted", "nas@diskstation.local", "DiskStation", ["alerts@pine.home"], "Volume 1 fast voll: 92 %", "Volume 1 is 92 % full.\n.a line that began with a dot", "127.0.0.1"]);
	const files = path.join(h.home, "data", "sources", "nas", "files");
	const kept = e.payload.attachments[0];
	assert.deepEqual([kept.file, kept.type, kept.size], ["usage chart.png", "image/png", picture.length]);
	assert.ok(kept.path.startsWith(files + path.sep) && /^[a-z0-9]+-usage_chart\.png$/.test(path.basename(kept.path)), kept.path);
	assert.ok(fs.readFileSync(kept.path).equals(picture));
	assert.deepEqual(e.payload.images, [{ path: kept.path, mimeType: "image/png" }]);

	// It only receives: no encryption to ask for, nobody to look up, nothing passed on, and what it does not know it says so.
	for (const line of ["STARTTLS", "VRFY root", "EXPN staff", "TURN", "HELP"]) assert.match(await nas.cmd(line), /^502 /);
	assert.match(await nas.cmd("NOOP"), /^250 /);
	// A message larger than the limit is read to its end, refused, and leaves nothing behind.
	assert.match(await nas.cmd("MAIL FROM:<nas@diskstation.local>"), /^250 /);
	assert.match(await nas.cmd("RCPT TO:<alerts@pine.home>"), /^250 /);
	assert.match(await nas.cmd("DATA"), /^354 /);
	nas.write(`Subject: big\r\n\r\n${"0123456789abcdef".repeat(2000)}\r\n.\r\n`);
	assert.match(await nas.reply(), /^552 /);
	assert.match(await nas.cmd("RSET"), /^250 /);
	assert.match(await nas.cmd("QUIT"), /^221 /);
	assert.equal(events("nas").length, 1);
	assert.equal(fs.readdirSync(files).length, 1);
	assert.match(info("nas").status!, /^accepting mail on port \d+ from the user nas\. 1 received, 4 refused$/);

	// Three wrong passwords and the connection is gone.
	const guess = await smtpClient(p1);
	await guess.cmd("HELO x");
	assert.match(await guess.cmd(`AUTH PLAIN ${b64("\0nas\0aaaaaaaa")}`), /^535 /);
	assert.match(await guess.cmd("AUTH PLAIN"), /^334 /);
	assert.match(await guess.cmd(b64("\0nas\0bbbbbbbb")), /^535 /);
	assert.match(await guess.cmd(`AUTH LOGIN ${b64("nas")}`), /^334 /);
	assert.match(await guess.cmd(b64("cccccccc")), /^535 Bye/);
	await until(() => guess.isClosed(), 2000, "the connection to be closed");

	// A device that cannot log in is known by its address: everything in one packet, no login asked for.
	const printer = await smtpClient(p2);
	assert.ok(!/AUTH/.test(await printer.cmd("EHLO printer")));
	printer.write(crlf("MAIL FROM:<scan@printer.local>\nRCPT TO:<whoever@example.org>\nDATA\nSubject: Scan\n\n..\n.\nMAIL FROM:<scan@printer.local>\nRCPT TO:<a@b.c>\nDATA\n.\n"));
	for (const re of [/^250 /, /^250 /, /^354 /, /^250 /, /^250 /, /^250 /, /^354 /, /^250 /]) assert.match(await printer.reply(), re);
	await until(() => events("printer").length === 2, 3000, "both mails");
	assert.deepEqual(events("printer").map((x: any) => [x.payload.from, x.payload.to, x.payload.subject, x.payload.text, x.payload.attachments]), [["scan@printer.local", ["whoever@example.org"], "Scan", ".", []], ["scan@printer.local", ["a@b.c"], "", "", []]]);
	assert.match(await printer.cmd("AUTH PLAIN abc"), /^503 /);
	// More than a device has to say in a minute: it is told to come back later.
	printer.write(crlf("MAIL FROM:<s@p>\nRCPT TO:<a@b.c>\nDATA\nSubject: again\n\nx\n.\n").repeat(30));
	const answers: string[] = [];
	for (let i = 0; i < 120; i++) answers.push((await printer.reply()).slice(0, 3));
	assert.deepEqual([answers.filter((a) => a === "451").length, events("printer").length], [2, 30]);
	printer.close();

	// From an address that is not on the list: not even a greeting.
	const stranger = await smtpClient(p3);
	assert.equal(stranger.greeting, "closed");
	assert.match(info("fenced").status!, /0 received, 1 refused$/);
	// The password is in no event and no status line.
	assert.ok(!JSON.stringify([h.pine.bus.query({}), h.pine.sources.list()]).includes("nas-mail-pass"));
	await h.close();
});

test("smtp by asking: pine makes the password, says what to enter in the device, and a device without a login needs its address", async () => {
	const port = await freePort();
	const h = await harness({ agents: { main: {} } });
	const asked: any[] = [];
	h.pine.bus.subscribe("approval/requested", (e) => {
		asked.push(e.payload);
		h.pine.approvals.decide((e.payload as any).id, true, "test");
	});
	const add = (name: string, options: any) => call("add_source", { name, type: "smtp", description: "x", options });
	const r = await h.pine.agents.run({
		agent: "main",
		prompt: mockMsg([
			{ tools: [add("a", { port: 0 }), add("b", { port, password: "short" }), add("c", { port, allow: ["the printer"] }), add("d", { port, to: ["nobody"] }), add("e", { port, allow: ["192.168.1.40"], user: "x" })] },
			{ tools: [add("nas", { port, host: "127.0.0.1", to: ["Alerts@pine.home"] }), add("printer", { port: port + 1, host: "127.0.0.1", allow: ["192.168.1.40"] })] },
		]),
		...owner,
	});
	assert.equal(r.status, "done");
	const refused = h.toolResults(h.mock.state.requests[1]);
	for (const [i, re] of [/"port" must be a port number, for example 2525/, /the password must have 8 characters or more/, /"the printer" in "allow" is not an address or the beginning of one/, /"nobody" in "to" is not an e-mail address/, /"user" without a "password" does nothing/].entries()) assert.match(refused[i], re);
	assert.equal(asked.length, 2);
	assert.match(asked[0].summary, new RegExp(`It will: open a mail server on port ${port} of this computer that accepts mail from the user "device" with a password made now, addressed to alerts@pine\\.home, and passes nothing on to anybody; speak plain SMTP as these devices do: the password and the mail cross your network unencrypted; treat every mail as outside content, whoever it says it is from\\.`));
	assert.match(asked[1].summary, /accepts mail without a login from the addresses 192\.168\.1\.40, and passes nothing on to anybody; speak plain SMTP as these devices do: the mail cross your network unencrypted/);
	const done = h.toolResults().slice(-2);
	assert.match(done[0], new RegExp(`Added the event source "nas" \\(smtp\\)\\. In the device, enter this computer's address as the mail \\(SMTP\\) server, port ${port}, without encryption \\(no SSL, no TLS\\), and the user "device"\\. The password is in pine's \\.env file as PINE_SOURCE_NAS_MAIN_PASSWORD, where your owner reads it\\. The recipient must be alerts@pine\\.home; the sender address can be anything\\.`));
	assert.match(done[1], /and no login\. Any recipient address will do/);
	const env = fs.readFileSync(path.join(h.home, ".env"), "utf8");
	const made = /PINE_SOURCE_NAS_MAIN_PASSWORD=(\S+)/.exec(env)![1];
	assert.ok(made.length >= 12 && !JSON.stringify(h.mock.state.requests).includes(made), "a password pine made never passes a model");
	const sources = JSON.parse(fs.readFileSync(path.join(h.home, "agents", "main", "agent.json"), "utf8")).sources;
	assert.deepEqual([sources.nas.password, sources.nas.user, sources.printer.password, sources.printer.user], ["${PINE_SOURCE_NAS_MAIN_PASSWORD}", "device", undefined, undefined]);
	await h.close();
});
