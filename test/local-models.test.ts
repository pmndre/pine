import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { harness } from "./support/harness.ts";

// What the owner is offered as "a model on this computer" (`GET /models/local`, src/models.ts
// `lookAround`): the usual ports of this computer asked what they serve, Pinecone told apart by
// its MCP port. A test moves the usual ports to stand-ins on port 0 (`PINE_LOCAL_PORTS`).

const listen = async (t: { after(fn: () => void): void }, handler: http.RequestListener) => {
	const server = http.createServer(handler);
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	t.after(() => server.close());
	return (server.address() as any).port as number;
};

const models = (ids: string[], key?: string): http.RequestListener => (req, res) => {
	if (key && req.headers.authorization !== `Bearer ${key}`) return void res.writeHead(401).end("{}");
	if (req.url === "/v1/models") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: ids.map((id) => ({ id, context_length: 32000 })) }));
	res.writeHead(404).end("{}");
};

/** A port nothing listens on. */
const closed = async () => {
	const server = http.createServer();
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const port = (server.address() as any).port as number;
	await new Promise((r) => server.close(r));
	return port;
};

test("the usual local ports are asked what they serve, Pinecone known by its MCP port, nothing where nothing listens", async (t) => {
	const llama = await listen(t, models(["qwen3"]));
	const mcp = await listen(t, (req, res) => {
		if (req.method === "POST" && req.url === "/mcp") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "pinecone" } } }));
		res.writeHead(404).end();
	});
	const studio = await listen(t, models(["gemma"], "sk-studio-1"));
	const nobody = await closed();

	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: {} } });
	t.after(() => h.close());
	const base = `http://127.0.0.1:${h.pine.http!.port}`;
	const ask = async () => (await (await fetch(`${base}/models/local`, { headers: { authorization: `Bearer ${h.pine.token}` } })).json()) as any;

	process.env.PINE_LOCAL_PORTS = `8080=${llama},8090=${mcp},11434=${nobody},1234=${studio}`;
	t.after(() => delete process.env.PINE_LOCAL_PORTS);
	const found = (await ask()).found;
	assert.deepEqual(found, [
		{ id: "pinecone", title: "Pinecone", url: `http://127.0.0.1:${llama}/v1`, locked: false, models: ["qwen3"], mcp: `http://127.0.0.1:${mcp}/mcp` },
		{ id: "lmstudio", title: "LM Studio", url: `http://127.0.0.1:${studio}/v1`, locked: true, models: [] },
	]);

	// Without its MCP port the server on 8080 is llama.cpp; and pine's own control port is never asked.
	process.env.PINE_LOCAL_PORTS = `8080=${llama},8090=${nobody},11434=${h.pine.http!.port}`;
	assert.deepEqual((await ask()).found, [{ id: "llamacpp", title: "llama.cpp", url: `http://127.0.0.1:${llama}/v1`, locked: false, models: ["qwen3"] }]);

	process.env.PINE_LOCAL_PORTS = `8080=${nobody}`;
	assert.deepEqual((await ask()).found, []);
});
