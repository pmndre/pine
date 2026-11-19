import http from "node:http";

/**
 * A minimal remote (streamable HTTP) MCP server with one tool, `lookup`. With `token`, it answers
 * 401 without it; with `filesNeedToken` its files want it too. With `picture`, every answer of a
 * tool comes with that picture. With `readOnly`, it has a second tool, `peek`, that declares itself read-only.
 * With `speak`, it has a tool of that name that makes "a sound": it answers with a file name and a link, and
 * with what to do next in the words of a real media server, which says "play, show or attach" and not how.
 */
const NEXT = "This answer is not the file, and you do not have it yet. Do not put `url` into your reply as a link, picture or sound: it will not load there. Step 1: save the file with your download tool (url: the `url` below, path: the `file` name). Step 2: play, show or attach the copy you saved. Only to use it in another tool of this server, pass `file` and skip the download.";
export async function httpMcp(opts: { token?: string; readOnly?: boolean; delayMs?: number; files?: Record<string, Buffer>; redirects?: Record<string, string>; filesNeedToken?: boolean; picture?: Buffer; /** A third tool, `speak`, which answers as a media server does: the name of this file of the server's and a link to it. */ speak?: string } = {}) {
	const calls: Array<{ method: string; auth?: string }> = [];
	/** What was asked for under /files, and with which key. */
	const gets: Array<{ name: string; auth?: string }> = [];
	const server = http.createServer(async (req, res) => {
		// Download links, as a server that hands out files would serve them.
		const name = decodeURIComponent((req.url ?? "").replace(/^\/files\//, ""));
		const file = req.method === "GET" && (req.url ?? "").startsWith("/files/");
		if (file) gets.push({ name, auth: req.headers.authorization });
		if (file && opts.filesNeedToken && req.headers.authorization !== `Bearer ${opts.token}`) return void res.writeHead(401, { "www-authenticate": "Bearer" }).end();
		if (req.method === "GET" && opts.redirects?.[name]) return void res.writeHead(302, { location: opts.redirects[name] }).end();
		if (req.method === "GET" && opts.files?.[name]) return void res.writeHead(200, { "content-type": "application/octet-stream" }).end(opts.files[name]);
		if (req.method !== "POST") return void res.writeHead(req.method === "GET" ? 404 : 405).end();
		let raw = "";
		for await (const c of req) raw += c;
		const msg = JSON.parse(raw);
		calls.push({ method: msg.method, auth: req.headers.authorization });
		if (opts.token && req.headers.authorization !== `Bearer ${opts.token}`) return void res.writeHead(401, { "www-authenticate": "Bearer" }).end();
		if (msg.id === undefined) return void res.writeHead(202).end();
		const result =
			msg.method === "initialize"
				? { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "http-stub", version: "1" } }
				: msg.method === "tools/list"
					? { tools: [{ name: "lookup", description: "Look something up", inputSchema: { type: "object", properties: { q: { type: "string" } } } }, ...(opts.readOnly ? [{ name: "peek", description: "Read something", annotations: { readOnlyHint: true }, inputSchema: { type: "object", properties: { q: { type: "string" } } } }] : []), ...(opts.speak ? [{ name: "speak", description: "Say a text aloud: makes a sound file on this server.", inputSchema: { type: "object", properties: { text: { type: "string", description: "What to say" } }, required: ["text"] } }] : [])] }
					: msg.method === "tools/call" && msg.params.name === "speak" && opts.speak
						? { content: [{ type: "text", text: `${NEXT}\n${JSON.stringify({ file: opts.speak, url: `http://${req.headers.host}/files/${opts.speak}`, seconds: 2 })}` }] }
						: msg.method === "tools/call"
						? { content: [{ type: "text", text: `${msg.params.name === "peek" ? "peeked" : "looked up"}: ${msg.params.arguments?.q}` }, ...(opts.picture ? [{ type: "image", data: opts.picture.toString("base64"), mimeType: "image/png" }] : [])] }
						: {};
		if (opts.delayMs && msg.method === "tools/call") await new Promise((r) => setTimeout(r, opts.delayMs));
		if (res.destroyed) return;
		res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return {
		url: `http://127.0.0.1:${(server.address() as any).port}/mcp`,
		calls,
		gets,
		close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))),
	};
}
