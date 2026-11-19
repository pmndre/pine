import assert from "node:assert/strict";
import { test } from "node:test";
import { addresses, decodeWords, fileName, headerParams, parseMail } from "./mime.ts";
import { png } from "../testing/png.ts";

const crlf = (s: string) => s.replace(/\r?\n/g, "\r\n");

test("mime: who it says it is from, its subject and its text, in whatever way they were written down", () => {
	// Encoded words, a name in quotes, folded headers, quoted-printable in latin1.
	const m = parseMail(
		Buffer.from(
			crlf(
				'From: "M\xfcller, J\xf6rg" <Joerg.Mueller@Example.ORG>\nTo: =?UTF-8?B?QW5uYSBNw7xsbGVy?= <anna@example.net>, bob@example.net (Bob)\nCc: carl@example.net\nSubject: =?iso-8859-1?Q?Gr=FC=DFe_aus?=\n =?utf-8?B?IE3DvG5jaGVu?=\nDate: Mon, 16 Nov 2026 09:30:00 +0100\nMessage-ID: <1@example.org>\nContent-Type: text/plain; charset=iso-8859-1\nContent-Transfer-Encoding: quoted-printable\n\nSch=F6ne Gr=FC=DFe,=\n das ist eine lange Zeile.\nPreis: 12=3D13\n',
			),
			"latin1",
		),
	);
	assert.deepEqual([m.from, m.fromName, m.to, m.cc, m.subject, m.date, m.messageId], ["joerg.mueller@example.org", "Müller, Jörg", ["anna@example.net", "bob@example.net"], ["carl@example.net"], "Grüße aus München", "2026-11-16T08:30:00.000Z", "<1@example.org>"]);
	assert.equal(m.text, "Schöne Grüße, das ist eine lange Zeile.\nPreis: 12=13");
	assert.deepEqual(m.attachments, []);

	// The pieces themselves.
	assert.equal(decodeWords("=?utf-8?Q?a_b=C3=A4?= plain =?utf-8?B?w7w=?="), "a bä plain ü");
	assert.equal(decodeWords("=?no-such-charset?Q?abc=E4?="), "abc\xe4", "an unknown character set is read byte by byte");
	assert.deepEqual(addresses('"Doe, Jane" <jane@x.org>, plain@y.org; <third@z.org>'), [{ address: "jane@x.org", name: "Doe, Jane" }, { address: "plain@y.org" }, { address: "third@z.org" }]);
	assert.deepEqual(headerParams("attachment; filename*0*=utf-8''Rechnung%20; filename*1*=M%C3%A4rz.pdf").params.filename, "Rechnung März.pdf");
	assert.deepEqual(headerParams('text/plain; charset="UTF-8"; format=flowed'), { value: "text/plain", params: { charset: "UTF-8", format: "flowed" } });
	// A name is a name: no folders, no dots in front, nothing invisible.
	assert.deepEqual(["../../etc/passwd", "C:\\Users\\x\\a.pdf", "..hidden", "ok name.pdf", "\x00\x1f", ""].map((n) => fileName(n, "fallback.bin")), ["passwd", "a.pdf", "hidden", "ok name.pdf", "fallback.bin", "fallback.bin"]);

	// No headers at all, a header with nothing behind it, bytes that are nothing: read, not thrown.
	assert.equal(parseMail(Buffer.from("\r\njust text")).text, "just text");
	assert.deepEqual([parseMail(Buffer.from("Subject: x")).subject, parseMail(Buffer.from("Subject: x")).text], ["x", ""]);
	assert.equal(parseMail(Buffer.alloc(0)).from, "");
	assert.equal(parseMail(Buffer.from([0xff, 0xfe, 0x00, 0x0d, 0x0a, 0x0d, 0x0a, 0x80])).subject, "");
});

test("mime: parts inside parts, the text a reader sees, files under plain names, and limits a message cannot move", () => {
	const picture = png(4, 4);
	const raw = Buffer.from(
		crlf(
			[
				"From: shop@example.org",
				"Subject: Your order",
				'Content-Type: multipart/mixed; boundary="outer"',
				"",
				"--outer",
				'Content-Type: multipart/alternative; boundary="inner"',
				"",
				"--inner",
				"Content-Type: text/plain; charset=utf-8",
				"Content-Transfer-Encoding: base64",
				"",
				Buffer.from("Danke für die Bestellung.\n.. two dots\n").toString("base64"),
				"--inner",
				"Content-Type: text/html; charset=utf-8",
				"",
				"<html><body><h1>Danke</h1><script>track()</script></body></html>",
				"--inner--",
				"--outer",
				'Content-Type: image/png; name="../../Front Door.png"',
				"Content-Disposition: attachment; filename=\"../../Front Door.png\"",
				"Content-Transfer-Encoding: base64",
				"",
				picture.toString("base64").replace(/.{1,60}/g, "$&\n").trimEnd(),
				"--outer",
				"Content-Type: application/pdf",
				"Content-Disposition: attachment; filename*=utf-8''Rechnung%20M%C3%A4rz.pdf",
				"",
				"%PDF-1.4 not really",
				"--outer",
				"Content-Type: text/plain",
				'Content-Disposition: attachment; filename="notes.txt"',
				"",
				"a text file is a file",
				"--outer--",
				"",
			].join("\n"),
		),
	);
	const m = parseMail(raw);
	assert.equal(m.text, "Danke für die Bestellung.\n.. two dots");
	assert.deepEqual(m.attachments.map((a) => [a.name, a.type, a.size]), [["Front Door.png", "image/png", picture.length], ["Rechnung März.pdf", "application/pdf", 19], ["notes.txt", "text/plain", 21]]);
	assert.ok(m.attachments[0].bytes.equals(picture));

	// Only HTML: what a reader sees of it.
	assert.equal(parseMail(Buffer.from(crlf("Content-Type: text/html\n\n<p>Hello <b>you</b></p><style>p{}</style><p>Bye &amp; thanks</p>"))).text, "Hello you\nBye & thanks");

	// A file larger than the limit is named and not kept; the others are.
	const small = parseMail(raw, { attachmentBytes: 30 });
	assert.deepEqual(small.attachments.map((a) => [a.name, a.skipped ?? false, a.bytes.length]), [["Front Door.png", true, 0], ["Rechnung März.pdf", false, 19], ["notes.txt", false, 21]]);
	assert.equal(small.attachments[0].size > 30, true);
	// More files than are taken, more text than is kept.
	assert.equal(parseMail(raw, { attachments: 1 }).attachments.length, 1);
	assert.equal(parseMail(raw, { text: 5 }).text, "Danke");
	// A message that was cut off in the middle of a file is read as far as it goes.
	const cut = parseMail(raw.subarray(0, raw.indexOf("--outer", raw.indexOf("image/png")) - 40));
	assert.deepEqual([cut.text, cut.attachments.map((a) => a.name)], ["Danke für die Bestellung.\n.. two dots", ["Front Door.png"]]);

	// Parts in parts in parts: looked at to a depth, and no further. A thousand parts: a handful are read.
	const nest = (n: number): string => (n === 0 ? "Content-Type: text/plain\n\nthe bottom\n" : `Content-Type: multipart/mixed; boundary="b${n}"\n\n--b${n}\n${nest(n - 1)}\n--b${n}--\n`);
	assert.equal(parseMail(Buffer.from(crlf(nest(5)))).text, "the bottom");
	assert.equal(parseMail(Buffer.from(crlf(nest(40)))).text, "");
	const many = `Content-Type: multipart/mixed; boundary="x"\n\n${Array.from({ length: 1000 }, (_, i) => `--x\nContent-Type: text/plain\n\nline ${i}\n`).join("")}--x--\n`;
	const started = Date.now();
	const read = parseMail(Buffer.from(crlf(many)));
	assert.equal(read.text.split("\n\n").length, 59, "the parts that are read, and not one more");
	// Megabytes of nothing in a header, and a boundary that never ends, cost little.
	parseMail(Buffer.concat([Buffer.from("Subject: "), Buffer.alloc(3_000_000, "a"), Buffer.from("\r\n\r\nx")]));
	parseMail(Buffer.from(`Content-Type: multipart/mixed; boundary="q"\r\n\r\n${"--q\r\n".repeat(200_000)}`));
	assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
});
