// "Setup Pine" once a model answers: the card "Next", where the owner ticks what to set up now. Its
// Send posts an ordinary message of the owner's in `setup`, fixed text made from the ticks, which the
// main agent answers there; "Nothing for now" opens `main`. The home starts without a model, and gets
// the scripted model server as a model server of its own on the way, as an owner adds one.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { startMock } from "../../baseline/tests/mock.mjs";
import { launchApp, patient } from "./support/app.ts";

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-setup-next-")));
let app: any;
let page: any;
let mock: any;

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
const card = "[data-slot=composer-question] [data-slot=question-card]";
const question = (text: string) => sees(`${card} [data-slot=question-card-question] >> text=${text}`);
const pick = (label: string) => page.locator(`${card} [data-slot=questionnaire-choice]`, { hasText: label }).click();
const options = () => page.$$eval(`${card} [data-slot=questionnaire-choice] [data-slot=question-card-label]`, (els: Element[]) => els.map((e) => e.textContent));
const activeTab = () => page.textContent("[data-slot=tab][aria-selected=true]").catch(() => "");
const visit = () =>
	app.evaluate(({ BrowserWindow }: any) => {
		const p = BrowserWindow.getAllWindows()[0].webContents;
		p.send("pine:focus", true);
		p.send("pine:focus", false);
	});

/** The question about the browser for the web tools, which comes again with a page loaded anew: put off, it lies over nothing. */
async function notNow(wait = 5000): Promise<void> {
	const asked = await page.waitForSelector("[data-slot=dialog-title] >> text=/The browser for the web tools/", { timeout: patient(wait) }).then(() => true, () => false);
	if (!asked) return;
	await page.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Not now" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
}

/** Back to "Setup Pine" after a reload: the model is kept again, and the card "Next" is open. */
async function toNext(): Promise<void> {
	await page.reload();
	await notNow();
	await sees("[data-slot=sidebar] >> text=Setup Pine");
	await page.locator("[data-sidebar=menu-button]", { hasText: "Setup Pine" }).click();
	await question("Keep this model?");
	await pick("Go on");
	await question("What would you like to set up now?");
}

before(async () => {
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { mode: "safe", introduce: false, thinking: "off" }, security: { askAccess: false } }, null, 2));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent: it administers pine.\n\nYou are the main agent.\n");
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	app = await launchApp({ ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"), PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "" });
	page = await app.firstWindow();
	await page.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.();
	fs.rmSync(home, { recursive: true, force: true });
});

test("once a model answers and is kept, the card Next offers what to set up, Pinecone on a Mac only", async () => {
	await notNow(20_000);
	await question("How should your agents run?");
	// The owner adds a model server of their own (the scripted one), and pine runs on it.
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	await api("POST", "/models/refresh", {});
	await visit();
	await sees("[data-slot=setup-model] >> text=/Your agents run on mock\\/m/");
	await question("Keep this model?");
	await pick("Go on");
	await question("What would you like to set up now?");
	assert.equal(await page.getAttribute(card, "data-multiple"), "");
	const offered = await options();
	const everywhere = ["The mode", "A working folder", "Telegram", "A first agent", "The theme"];
	assert.deepEqual(offered, process.platform === "darwin" ? [...everywhere, "Pinecone"] : everywhere);
	const text = await page.textContent(card);
	assert.match(text, /Make an agent that tells me about each new file in Downloads\./, "the first agent's example is the welcome letter's");
	await shot("setup-next-01-card");
});

test("Nothing for now opens main", async () => {
	await page.locator(card).getByRole("button", { name: "Nothing for now" }).click();
	await sees("[data-slot=tab][aria-selected=true]:not(:has-text('Setup Pine'))");
	assert.doesNotMatch(String(await activeTab()), /Setup Pine/);
	assert.match(String(await activeTab()), /main/i);
	// Nothing was said in `setup`.
	assert.deepEqual(await api("GET", "/tasks?agent=main&session=setup&limit=40"), []);
});

test("ticking and sending posts the owner's message in setup, the main agent answers there, and Next is done", async () => {
	await toNext();
	await pick("The mode");
	await pick("A first agent");
	await page.locator(card).getByRole("button", { name: "Send" }).click();
	const said = "Help me set up the rest of pine, one thing at a time, with a question where I have a choice:\n- The mode: how much my agents ask before they act.\n- A first agent of my own, for example: Make an agent that tells me about each new file in Downloads.";
	// The owner's message, as theirs, and the answer of the main agent (the scripted model echoes it).
	await sees("[data-slot=message-scroller-content] >> text=Help me set up the rest of pine");
	let history: any[] = [];
	for (let i = 0; i < 100; i++) {
		history = (await api("GET", "/tasks?agent=main&session=setup&limit=40")) as any[];
		if (history.some((t) => t.status === "done")) break;
		await new Promise((r) => setTimeout(r, 100));
	}
	const task = history.find((t) => t.status === "done");
	assert.ok(task, `the main agent answered in setup: ${JSON.stringify(history)}`);
	assert.equal(task.prompt, said);
	assert.equal(task.meta.trust, "owner");
	assert.match(String(await activeTab()), /Setup Pine/);
	await page.waitForSelector(card, { state: "detached" });
	await shot("setup-next-02-sent");
	// Done for good: after a reload, the steps end with the model, kept or not, and no card Next.
	await page.reload();
	await notNow();
	await sees("[data-slot=sidebar] >> text=Setup Pine");
	await page.locator("[data-sidebar=menu-button]", { hasText: "Setup Pine" }).click();
	await question("Keep this model?");
	await pick("Go on");
	await page.waitForSelector(card, { state: "detached" });
});
