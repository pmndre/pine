import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ConfigError, effectiveMcp, loadConfig } from "./config.ts";
import { harness } from "../testing/harness.ts";

test("configuration problems are reported together and name the file", async () => {
	const h = await harness({ agents: { main: {} }, start: false });
	fs.writeFileSync(path.join(h.home, "pine.json"), JSON.stringify({ main: "nobody", routes: [{ on: "x", agent: "ghost" }, { on: "y" }], mcp: { bad: {} }, http: { hooks: { open: {} } }, plugins: ["pine:telegram"] }));
	fs.writeFileSync(path.join(h.home, "agents", "main", "agent.json"), JSON.stringify({ delegates: ["ghost"], token: "${PINE_TEST_UNSET_VAR}" }));
	assert.throws(() => loadConfig(h.home), (e: any) => {
		assert.ok(e instanceof ConfigError);
		const all = e.problems.join("\n");
		for (const expected of ['main agent "nobody"', 'unknown agent "ghost"', "needs one of agent, call, publish, set", 'mcp.bad needs "command", "url" or "pine"', "PINE_TEST_UNSET_VAR is not set", 'needs a "secret"', "pine.json: plugins: plugins are gone. Telegram, MQTT and watched folders are event sources now", "no model"]) assert.ok(all.includes(expected), `missing: ${expected}\n${all}`);
		return true;
	});
	await h.close();
});

test("secrets from .env fill the configuration but never enter the process environment", async () => {
	const h = await harness({
		pine: { mcp: { g: { command: "x", env: { KEY: "${PINE_TEST_SECRET}" } } } },
		agents: { main: {} },
		files: { ".env": "PINE_TEST_SECRET=s3cr3t-value-123\n" },
		start: false,
	});
	const cfg = loadConfig(h.home);
	assert.equal(cfg.mcp.g.env?.KEY, "s3cr3t-value-123");
	assert.equal(process.env.PINE_TEST_SECRET, undefined);
	assert.ok(cfg.secrets.includes("s3cr3t-value-123"));
	await h.close();
});

test("MCP servers: global ones reach the agents they name, own ones only their agent", async () => {
	const h = await harness({
		pine: { mcp: { everyone: { command: "a" }, onlyb: { command: "b", agents: ["b"] }, off: { command: "c", enabled: false } } },
		agents: { a: { agent: { mcp: { mine: { command: "d" } } } }, b: { agent: { globalMcp: ["everyone"] } }, c: { agent: { globalMcp: false, mcp: { everyone: { command: "override" } } } } },
		start: false,
	});
	const cfg = loadConfig(h.home);
	assert.deepEqual(Object.keys(effectiveMcp(cfg, cfg.agents.a)).sort(), ["everyone", "mine"]);
	assert.deepEqual(Object.keys(effectiveMcp(cfg, cfg.agents.b)), ["everyone"]);
	assert.deepEqual(effectiveMcp(cfg, cfg.agents.c), { everyone: { command: "override" } });
	await h.close();
});
