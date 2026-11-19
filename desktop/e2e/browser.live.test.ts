// The agent's browser in the panel beside a conversation, with the real browser behind it: the
// agent opens a page, the app shows it, and what is clicked and typed in the picture arrives in
// the page. The page is one of the test's own on the loopback; nothing here reaches the web.
//
//   PINE_LIVE=1 node --test e2e/browser.live.test.ts     (needs the browser `pine init` fetches)
//   PINE_DESKTOP_SHOTS=<folder>                            also saves a picture of each step there
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { mockMsg, startMock } from "../../baseline/tests/mock.mjs";
import { launchApp } from "./support/app.ts";

const shots = process.env.PINE_DESKTOP_SHOTS;
const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

test("live: the agent's real browser is shown in the panel, and the owner's hand reaches its page", { skip: !process.env.PINE_LIVE, timeout: 180_000 }, async () => {
	const site = http.createServer((req, res) =>
		res.writeHead(200, { "content-type": "text/html" }).end(`<title>Okapi ${req.url}</title><body style="margin:0;font:22px sans-serif;background:#eef"><h1 style="margin:30px 40px">Okapi shop ${req.url}</h1><input id=i placeholder="your name" style="margin-left:40px;width:240px;height:34px;font:inherit"><p id=o style="margin-left:40px">nothing typed</p><a href="/two" style="margin-left:40px">second page</a><div style="height:3000px"></div><script>i.oninput=()=>o.textContent="typed: "+i.value</script>`),
	);
	await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
	const at = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
	const mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-browser-")));
	let app: any;
	try {
		write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
		write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false }, mcp: { browser: { pine: "browser" } } }));
		write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
		write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n\nYou are the main agent.\n");
		app = await launchApp({ ...process.env, PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "" });
		const page = await app.firstWindow();
		const shot = async (name: string) => shots && (fs.mkdirSync(shots, { recursive: true }), await page.screenshot({ path: path.join(shots, `${name}.png`) }));
		const say = async (words: string, steps: unknown[], done: string) => {
			await page.fill("[data-slot=composer] textarea", mockMsg(steps, `${words} `));
			await page.keyboard.press("Enter");
			return page.waitForSelector(`[data-slot=markdown] >> text=${done}`, { timeout: 60_000 });
		};
		const toolSaid = () => JSON.stringify(mock.state.requests.at(-1).body.messages.filter((m: any) => m.role === "tool").at(-1)?.content ?? "");
		const address = (end: string) => page.waitForFunction((e: string) => (document.querySelector("[data-slot=browser] input[aria-label=Address]") as HTMLInputElement | null)?.value.endsWith(e), end, { timeout: 15_000 });
		await page.waitForSelector("[data-slot=empty] h1", { timeout: 60_000 });
		const notNow = page.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Not now" });
		if (await notNow.count()) await notNow.click();

		// The agent opens a page (a local one: the owner says yes) and wants its owner to see the browser.
		const opened = say("open the shop", [{ tools: [{ name: "mcp__browser__browser_navigate", args: { url: `${at}/one` } }] }, { tools: [{ name: "mcp__browser__browser_show", args: {} }] }, { text: "It is open." }], "It is open.");
		const allow = page.locator("[data-slot=dialog-content][data-tone=warn]").getByRole("button", { name: /^Allow/ });
		await allow.waitFor({ timeout: 30_000 });
		await allow.click();
		await opened;
		// No window was opened for that: the panel is where it is, and it came to the front by itself.
		assert.match(toolSaid(), /Your owner sees the browser in the Pine app/);
		await page.waitForSelector("[data-slot=browser] canvas[data-drawn]", { timeout: 20_000 });
		await address("/one");
		// The page is laid out for the room the panel has, and drawn point for point.
		await page.waitForFunction(() => {
			const c = document.querySelector("[data-slot=browser] canvas") as HTMLCanvasElement;
			const room = document.querySelector("[data-slot=browser] [data-slot=scroll-area]:has(canvas)")!.getBoundingClientRect();
			return c.width === Math.round(room.width) && c.height === Math.round(room.height);
		}, undefined, { timeout: 15_000 });
		await shot("b1-page");

		// The owner clicks into the page's field and types. The agent reads what was typed when it next looks.
		const box = await page.$eval("[data-slot=browser] canvas", (c: HTMLCanvasElement) => ({ x: c.getBoundingClientRect().left, y: c.getBoundingClientRect().top }));
		await page.mouse.click(box.x + 100, box.y + 112);
		await page.waitForTimeout(900);
		await page.keyboard.type("Paula", { delay: 30 });
		await page.waitForTimeout(1500);
		await shot("b2-typed");
		await say("look", [{ tools: [{ name: "mcp__browser__browser_snapshot", args: {} }] }, { text: "Looked." }], "Looked.");
		assert.match(toolSaid(), /typed: Paula/);

		// A link in the picture, an address typed above it, and back.
		await page.mouse.click(box.x + 90, box.y + 215);
		await address("/two");
		await page.fill("[data-slot=browser] input[aria-label=Address]", `${at.replace("http://", "")}/three`);
		await page.press("[data-slot=browser] input[aria-label=Address]", "Enter");
		await address("/three");
		await page.locator("[data-slot=browser]").getByRole("button", { name: "Back", exact: true }).click();
		await address("/two");
		await shot("b3-second");

		// The agent left the browser on /one. A call of its that would act is not carried out on a page it has not seen.
		await say("go back", [{ tools: [{ name: "mcp__browser__browser_navigate_back", args: {} }] }, { text: "Told." }], "Told.");
		assert.match(toolSaid(), /Not done: the browser is not where you left it[\s\S]*\/two/);

		// The owner closes the last tab: the browser has no page any more, the view is empty, and what the agent opened is offered again.
		await page.click("[data-slot=browser] [data-slot=tabs-list] button[aria-label^='Close']");
		await page.waitForSelector("[data-slot=browser] [data-slot=empty] >> text=No page is open", { timeout: 15_000 });
		const again = page.locator("[data-slot=browser] [data-offer=visited] button").first();
		await again.waitFor({ timeout: 15_000 });
		await shot("b4-closed");
		await again.click();
		await page.waitForSelector("[data-slot=browser] canvas[data-drawn]", { timeout: 20_000 });
		await address("/one");
	} finally {
		await app?.close().catch(() => {});
		await mock.close?.().catch(() => {});
		site.close();
		fs.rmSync(home, { recursive: true, force: true });
	}
});
