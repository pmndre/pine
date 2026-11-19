import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { test } from "node:test";
import { harness, until } from "../../testing/harness.ts";
import { png } from "../../testing/png.ts";

const userText = (req: any) => {
	const m = req.body.messages.filter((x: any) => x.role === "user").at(-1);
	const text = typeof m.content === "string" ? m.content : m.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n");
	// Without the per-turn note pine puts in front (time, mode).
	return text.replace(/<pine-note>[\s\S]*?<\/pine-note>\s*/g, "");
};

const freePort = () =>
	new Promise<number>((resolve) => {
		const s = net.createServer().listen(0, "127.0.0.1", () => {
			const p = (s.address() as net.AddressInfo).port;
			s.close(() => resolve(p));
		});
	});

/** Just enough FTP client to do what a camera does: log in, open a passive connection, upload. */
async function ftpClient(port: number) {
	const sock = net.connect(port, "127.0.0.1");
	sock.setEncoding("utf8");
	const lines: string[] = [];
	let buffer = "";
	sock.on("data", (d: string) => {
		buffer += d;
		let i: number;
		while ((i = buffer.indexOf("\r\n")) >= 0) {
			lines.push(buffer.slice(0, i));
			buffer = buffer.slice(i + 2);
		}
	});
	sock.on("error", () => {});
	const reply = async () => {
		await until(() => lines.some((l) => /^\d{3} /.test(l)), 3000, "an FTP reply");
		const i = lines.findIndex((l) => /^\d{3} /.test(l));
		return lines.splice(0, i + 1).at(-1)!;
	};
	const cmd = async (line: string) => (sock.write(`${line}\r\n`), reply().then((r) => (process.env.FTP_DEBUG && console.log(line, "=>", r), r)));
	const passive = async () => {
		const m = (await cmd("PASV")).match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/)!;
		return net.connect(Number(m[5]) * 256 + Number(m[6]), "127.0.0.1");
	};
	return { greeting: await reply(), cmd, reply, passive, close: () => sock.destroy() };
}

test("sources: an FTP drop takes uploads from a device that knows the password, and nothing else", async () => {
	const free = await freePort();
	const h = await harness({
		pine: { sources: { door: { type: "ftp", host: "127.0.0.1", port: free, user: "cam", password: "front-door-pass", maxFileMb: 0.01, description: "the front door camera" }, weak: { type: "ftp", port: free + 1, user: "cam", password: "123" } } },
		agents: { main: { agent: { subscribe: { door: { note: "Say who is at the door.", throttle: "0s", separate: true } } } } },
	});
	await assert.rejects(h.pine.sources.subscribe("main", "weak"), /"password" of 8 characters or more/);

	const cam = await ftpClient(free);
	assert.match(cam.greeting, /^220 /);
	assert.match(await cam.cmd("STOR x.jpg"), /^530 /, "nothing before logging in");
	await cam.cmd("USER cam");
	assert.match(await cam.cmd("PASS wrong-password"), /^530 /);
	await cam.cmd("USER cam");
	assert.match(await cam.cmd("PASS front-door-pass"), /^230 /);
	await cam.cmd("TYPE I");
	assert.match(await cam.cmd("MKD 2026/11/10"), /^257 /);
	await cam.cmd("CWD 2026/11/10");

	// An upload: the picture lands in pine's own folder under a name pine chose, and the agent is woken with it.
	const picture = png(48, 32);
	const data = await cam.passive();
	assert.match(await cam.cmd("STOR ../../etc/Front Door_001.png"), /^150 /);
	data.end(picture);
	assert.match(await cam.reply(), /^226 /);
	await until(() => h.pine.tasks.list({ session: "on-door~u" }).some((x: any) => x.status === "done"), 6000, "the upload to wake the agent");
	assert.ok(!h.toolsOffered(h.mock.state.requests.at(-1)).includes("bash"), "kept separate: a conversation of its own and the reduced tool set");
	const e = h.pine.bus.query({ topic: "source/door/upload" })[0];
	const p = e.payload as any;
	assert.equal(p.size, picture.length);
	assert.ok(p.path.startsWith(path.join(h.home, "data", "sources", "door", "files") + path.sep) && /-Front_Door_001\.png$/.test(p.path), p.path);
	assert.ok(fs.readFileSync(p.path).equals(picture));
	const req = h.mock.state.requests.at(-1);
	const content = req.body.messages.filter((m: any) => m.role === "user").at(-1).content;
	assert.equal(content.filter((x: any) => x.type === "image_url").length, 1, "the model is shown the picture");
	assert.ok(userText(req).includes("Your note for this subscription: Say who is at the door."));
	assert.ok(!JSON.stringify(h.pine.bus.query({})).includes("front-door-pass"));

	// It only receives: nothing is listed or given back, and a file that is too large is refused.
	const listing = await cam.passive();
	let listed = "";
	listing.on("data", (d) => (listed += d));
	assert.match(await cam.cmd("LIST"), /^150 /);
	assert.match(await cam.reply(), /^226 /);
	assert.equal(listed, "");
	assert.match(await cam.cmd("RETR Front Door_001.png"), /^550 /);
	const big = await cam.passive();
	assert.match(await cam.cmd("STOR big.bin"), /^150 /);
	big.on("error", () => {});
	big.end(Buffer.alloc(40_000));
	assert.match(await cam.reply(), /^552 /);
	assert.equal(fs.readdirSync(path.join(h.home, "data", "sources", "door", "files")).length, 1);
	cam.close();
	await h.close();
});
