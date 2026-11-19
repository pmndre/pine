import http from "node:http";
import { sleep } from "./harness.ts";

export const TOKEN = "123456:FAKE-TOKEN-abcdefghijklmnop";
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/** Enough of the Telegram Bot API for the source: who the bot is, long polling, sending, buttons, a photo. */
export async function fakeTelegram() {
	const queue: any[] = [];
	const calls: Array<{ method: string; body: any }> = [];
	let updateId = 100;
	let messageId = 500;
	// As Telegram does: what was fetched once with a later offset is gone, also for a client that starts from nothing.
	let confirmed = 0;
	const server = http.createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const c of req) chunks.push(c as Buffer);
		const raw = Buffer.concat(chunks).toString("latin1");
		if (req.url === `/file/bot${TOKEN}/photos/p.jpg`) return void res.writeHead(200).end(PNG);
		// A file comes as a form: its fields by name, and for the file its name, type and size.
		const form = /^multipart\/form-data/.test(req.headers["content-type"] ?? "");
		const body = !raw ? {} : form ? Object.fromEntries([...raw.matchAll(/name="(\w+)"(?:; filename="([^"]*)")?\r\n(?:Content-Type: ([^\r]*)\r\n)?\r\n([\s\S]*?)\r\n--/g)].map((p) => [p[1], p[2] ? { name: p[2], type: p[3], size: Buffer.byteLength(p[4], "latin1") } : p[4]])) : JSON.parse(Buffer.concat(chunks).toString("utf8"));
		const m = (req.url ?? "").match(/^\/bot([^/]+)\/(\w+)$/);
		const reply = (result: unknown, ok = true) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(ok ? { ok, result } : { ok, description: result }));
		if (!m || m[1] !== TOKEN) return reply("Unauthorized", false);
		if (m[2] === "getMe") return reply({ id: 1, username: "pine_test_bot" });
		if (m[2] === "getFile") return reply({ file_path: "photos/p.jpg" });
		if (m[2] === "getUpdates") {
			confirmed = Math.max(confirmed, Number(body.offset) || 0);
			const end = Date.now() + 100;
			while (Date.now() < end && !queue.some((u) => u.update_id >= confirmed)) await sleep(5);
			return reply(queue.filter((u) => u.update_id >= confirmed));
		}
		calls.push({ method: m[2], body });
		return reply(m[2] === "sendMessage" ? { message_id: messageId++ } : true);
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const from = (id: number) => ({ id, first_name: id === 1001 ? "Alex" : "Mallory", username: id === 1001 ? "alex" : "mallory" });
	return {
		apiBase: `http://127.0.0.1:${(server.address() as any).port}`,
		calls,
		sent: () => calls.filter((c) => c.method === "sendMessage").map((c) => c.body),
		message: (userId: number, text: string, extra: any = {}) => queue.push({ update_id: updateId++, message: { message_id: messageId++, from: from(userId), chat: { id: userId, type: "private" }, text, ...extra } }),
		callback: (userId: number, data: string) => queue.push({ update_id: updateId++, callback_query: { id: `cb${updateId}`, from: from(userId), data } }),
		close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))),
	};
}
