// "Setup Pine": a home whose main agent has no model opens the main agent's conversation `setup`,
// pinned and in front, where pine's own steps (src/setup/) lead to a model. Nothing of them is
// written into the conversation's history: they are derived from the daemon's state, and a reload
// draws them again. The subscription's sign-in runs on the daemon's stand-in for a browser sign-in
// (`PINE_LOGIN_STAND_IN`, for tests only: it shows a page and a code, and signs in once the test
// writes the key into the file it names).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import { launchApp, patient } from "./support/app.ts";

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-setup-conv-")));
const browserDone = path.join(home, "browser-signed-in");
let app: any;
let page: any;

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};
const sees = (selector: string, timeout = patient(20_000)) => page.waitForSelector(selector, { timeout });
const api = (method: string, url: string, body?: unknown) => page.evaluate(([m, u, b]: [string, string, unknown]) => (window as any).pine.call(m, u, b).then((r: any) => r.data), [method, url, body]);
const shot = async (name: string) => {
	if (!process.env.PINE_DESKTOP_SHOTS) return;
	fs.mkdirSync(process.env.PINE_DESKTOP_SHOTS, { recursive: true });
	await page.screenshot({ path: path.join(process.env.PINE_DESKTOP_SHOTS, `${name}.png`) });
};
const opened = () => app.evaluate(() => (globalThis as any).quiet.opened as string[]);
const card = "[data-slot=composer-question] [data-slot=questionnaire]";
const question = (text: string) => sees(`${card} [data-slot=questionnaire-title] >> text=${text}`);
const pick = (label: string) => page.locator(`${card} [data-slot=questionnaire-choice]`, { hasText: label }).click();
const activeTab = () => page.$$eval("[data-slot=tab][aria-selected=true]", (els: Element[]) => els[0]?.textContent ?? "");

before(async () => {
	// A home as `pine init` leaves it, without a model: pine.json names none, and nobody signed in anywhere.
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { mode: "safe", introduce: false, thinking: "off" }, security: { askAccess: false } }, null, 2));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent: it administers pine.\n\nYou are the main agent.\n");
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	app = await launchApp({ ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"), PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "", PINE_LOGIN_STAND_IN: browserDone });
	page = await app.firstWindow();
	await page.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
});

after(async () => {
	await app?.close().catch(() => {});
	fs.rmSync(home, { recursive: true, force: true });
});

test("a home with no model opens Setup Pine, pinned and in front, with pine's welcome and the first card", async () => {
	// The question about the browser for the web tools comes at the start: put off, it lies over nothing.
	await sees("[data-slot=dialog-title] >> text=/The browser for the web tools/");
	await page.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Not now" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await sees("[data-slot=conversation-head] >> text=Setup Pine");
	await sees("[data-slot=setup-welcome]");
	await question("How should your agents run?");
	const options = await page.$$eval(`${card} [data-slot=questionnaire-choice] [data-slot=question-card-label]`, (els: Element[]) => els.map((e) => e.textContent));
	assert.deepEqual(options, ["A subscription", "An API key", "A model on this computer"]);
	// pine's own first card marks the way it would pick.
	assert.equal(await page.locator(card).getByText("recommended").count(), 1);
	assert.match((await page.$$eval(`${card} [data-slot=questionnaire-choice]`, (els: Element[]) => els[0]?.textContent)) ?? "", /A subscription[\s\S]*recommended/);
	// Pinned: a star on its line in the side bar, and the daemon keeps the pin.
	await sees("[data-sidebar=menu-button]:has-text('Setup Pine') svg.lucide-star");
	const pinned = () => {
		const db = new DatabaseSync(path.join(home, "data", "pine.db"));
		db.exec("PRAGMA busy_timeout = 5000");
		const row = db.prepare("SELECT value FROM kv WHERE key = ?").get("conversations:pinned") as { value: string } | undefined;
		db.close();
		return row ? (JSON.parse(row.value) as string[]) : [];
	};
	for (let i = 0; i < 50 && !pinned().includes("main:setup"); i++) await new Promise((r) => setTimeout(r, 100));
	assert.ok(pinned().includes("main:setup"), "the daemon keeps the pin");
	assert.match(String(await activeTab()), /Setup Pine/);
	await shot("setup-01-first-card");
});

test("a subscription: which one, the sign-in card (page opened once, its code with Copy), Cancel brings the first card back", async () => {
	await pick("A subscription");
	await question("Which subscription?");
	// A list of what pine offers: none of it is marked as the one to pick.
	assert.equal(await page.locator(card).getByText("recommended").count(), 0);
	await pick("Claude");
	await sees("[data-card=sign-in-card] [data-sign-in=code][value=PINE-1234]");
	await sees("[data-card=sign-in-card] >> text=/Waiting for you to sign in/");
	await shot("setup-02-sign-in");
	for (let i = 0; i < 50 && !(await opened()).length; i++) await new Promise((r) => setTimeout(r, 100));
	assert.deepEqual(await opened(), ["https://sign-in.example/device"], "the sign-in page is opened once, by itself");
	await page.locator("[data-card=sign-in-card]").getByRole("button", { name: "Open the sign-in page again" }).click();
	assert.equal((await opened()).length, 2);
	await page.locator("[data-card=sign-in-card]").getByRole("button", { name: "Copy" }).click();
	await page.locator("[data-card=sign-in-card]").getByRole("button", { name: "Cancel" }).click();
	await question("How should your agents run?");
	assert.equal(await page.$("[data-card=sign-in-card]"), null);
});

test("a subscription reaches a model: pine names the one its agents run on now, and offers to change it", async () => {
	await pick("A subscription");
	await question("Which subscription?");
	await pick("Claude");
	await sees("[data-card=sign-in-card] [data-sign-in=code]");
	// The owner signs in in the browser.
	fs.writeFileSync(browserDone, "sk-ant-not-a-real-key-0123456789");
	await sees("[data-slot=setup-model] >> text=/Your agents now run on anthropic\\//");
	await question("Keep this model?");
	const options = await page.$$eval(`${card} [data-slot=questionnaire-choice] [data-slot=question-card-label]`, (els: Element[]) => els.map((e) => e.textContent));
	assert.deepEqual(options, ["Go on", "Choose another model"]);
	const agents = (await api("GET", "/agents")) as any[];
	const main = agents.find((a) => a.main);
	assert.match(main.model, /^anthropic\//);
	assert.equal(main.modelProblem, undefined);
	assert.doesNotMatch(await page.textContent("[data-slot=message-scroller-content]"), /sk-ant-not-a-real-key/);
	// What was answered is folded into lines above.
	await sees("[data-slot=message-scroller-content] [data-item=setup-answer] >> text=A subscription");
	await sees("[data-slot=message-scroller-content] [data-item=setup-answer] >> text=Claude");
	await shot("setup-03-model");
});

test("a reload draws the steps again from the daemon's state, and nothing of them is in the conversation's history", async () => {
	await page.reload();
	await sees("[data-slot=conversation-head] >> text=Setup Pine");
	await sees("[data-slot=setup-welcome]");
	await sees("[data-slot=setup-model] >> text=/Your agents now run on anthropic\\//");
	await sees("[data-slot=message-scroller-content] [data-item=setup-answer] >> text=Claude");
	await question("Keep this model?");
	const history = (await api("GET", "/tasks?agent=main&session=setup&limit=40")) as any[];
	assert.deepEqual(history, []);
	await pick("Go on");
	// What comes next is setup-handoff.test.ts's.
	await question("What would you like to set up now?");
});

test("a model that is gone opens Setup Pine again, and the no-model notice leads there", async () => {
	await page.click("[data-slot=tab] >> nth=0");
	await api("POST", "/models/logout", { provider: "anthropic" });
	// The page asks which agents there are when the window comes to the front.
	await app.evaluate(({ BrowserWindow }: any) => {
		const p = BrowserWindow.getAllWindows()[0].webContents;
		p.send("pine:focus", true);
		p.send("pine:focus", false);
	});
	await question("How should your agents run?");
	assert.match(String(await activeTab()), /Setup Pine/);
	// main's card says it in a toast that stays, whose button leads there; not as a notice on the card.
	await page.click("[data-slot=tab] >> nth=0");
	const toast = page.locator("[data-slot=toast]", { hasText: "Connect a model first" });
	await toast.waitFor({ timeout: 20_000 });
	assert.equal(await page.$("[data-slot=empty] [data-slot=model-notice]"), null);
	await toast.getByRole("button", { name: "Set up a model…" }).click();
	await question("How should your agents run?");
	assert.match(String(await activeTab()), /Setup Pine/);
});
