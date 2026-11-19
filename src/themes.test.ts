import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listThemes, seedThemes, themeInForce } from "./themes.ts";
import { type Harness, harness, until } from "../testing/harness.ts";

// The themes of the owner's UIs (src/themes.ts, src/theme-colors.ts): VS Code color theme files in
// <home>/themes, resolved into pine's colors, chosen with `ui.theme`.

const BUNDLED = path.resolve(import.meta.dirname, "../examples/home/themes");

const tmp = (t: { after(fn: () => void): void }) => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-themes-")));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
};

test("a home gets pine's themes once; after that the folder is the owner's, and pmndre is there even when its file is gone", (t) => {
	const home = tmp(t);
	seedThemes(home);
	const dir = path.join(home, "themes");
	assert.ok(fs.existsSync(path.join(dir, "pmndre.json")));
	assert.equal(fs.statSync(path.join(dir, "dracula.json")).mode & 0o777, 0o600);
	fs.rmSync(path.join(dir, "dracula.json"));
	fs.rmSync(path.join(dir, "pmndre.json"));
	seedThemes(home);
	assert.ok(!fs.existsSync(path.join(dir, "dracula.json")), "a theme taken out stays out");
	fs.writeFileSync(path.join(dir, "broken.json"), "{ nope");
	fs.writeFileSync(path.join(dir, "Upper Case.json"), "{}");
	fs.symlinkSync(path.join(BUNDLED, "nord.json"), path.join(dir, "linked.json"));
	const list = listThemes(home);
	const by = (id: string) => list.find((x) => x.id === id) as any;
	assert.equal(by("pmndre").name, "pmndre", "pine's own copy");
	assert.equal(by("dracula"), undefined);
	assert.match(by("broken").problem, /not JSON/);
	assert.match(by("Upper Case").problem, /lowercase/);
	assert.match(by("linked").problem, /not a file/, "a link is not followed");
	assert.equal(themeInForce(home, "broken", list).id, "pmndre", "what cannot be drawn gives way to pmndre");
	assert.equal(themeInForce(home, "nord", list).id, "nord");
});

test("the owner's UI lists the themes and sets ui.theme; a theme that is not there or cannot be drawn is refused; a UI is told", async () => {
	const h: Harness = await harness({ pine: { http: { port: 0 } }, agents: { main: {} } });
	const base = `http://127.0.0.1:${h.pine.http!.port}`;
	const call = async (method: string, url: string, body?: unknown) => {
		const res = await fetch(base + url, { method, headers: { authorization: `Bearer ${h.pine.token}`, "content-type": "application/json" }, body: body !== undefined ? JSON.stringify(body) : undefined });
		return { status: res.status, body: (await res.json()) as any };
	};
	const told: unknown[] = [];
	h.pine.bus.subscribe("pine/settings", (e) => void told.push(e.payload));

	const first = (await call("GET", "/themes")).body;
	assert.equal(first.theme, "pmndre");
	assert.equal(first.chosen, null);
	assert.ok(first.themes.some((x: any) => x.id === "github-light" && x.kind === "light" && /^#[0-9a-f]{6}$/.test(x.colors.bg)));
	assert.equal((await call("GET", "/settings")).body.find((s: any) => s.key === "ui.theme").now, "pmndre");

	assert.equal((await call("POST", "/settings", { key: "ui.theme", value: "dracula" })).status, 200);
	assert.equal(JSON.parse(fs.readFileSync(path.join(h.home, "pine.json"), "utf8")).ui.theme, "dracula");
	assert.equal((await call("GET", "/themes")).body.theme, "dracula");
	await until(() => told.length === 1);
	assert.deepEqual(told[0], { key: "ui.theme" });

	fs.writeFileSync(path.join(h.home, "themes", "half.json"), JSON.stringify({ name: "Half", colors: {} }));
	const broken = await call("POST", "/settings", { key: "ui.theme", value: "half" });
	assert.equal(broken.status, 400);
	assert.match(broken.body.error, /cannot be drawn/);
	const missing = await call("POST", "/settings", { key: "ui.theme", value: "solarized-dark" });
	assert.equal(missing.status, 400);
	assert.match(missing.body.error, /there is no theme "solarized-dark"\. Themes: .*dracula/);
	assert.equal((await call("POST", "/settings", { key: "ui.theme", value: "../pine" })).status, 400);
	assert.equal(JSON.parse(fs.readFileSync(path.join(h.home, "pine.json"), "utf8")).ui.theme, "dracula");

	// "default" takes the entry out: pmndre again.
	await call("POST", "/settings", { key: "ui.theme", value: "default" });
	assert.equal(JSON.parse(fs.readFileSync(path.join(h.home, "pine.json"), "utf8")).ui?.theme, undefined);
	assert.equal((await call("GET", "/themes")).body.theme, "pmndre");
	await h.close();
});
