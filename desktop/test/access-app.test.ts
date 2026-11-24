// Browser access through the real app: the page's calls, made from the page itself, to the main
// process, which runs browser access on its stand-in (PINE_DESKTOP_ACCESS_STAND_IN: no network,
// a phone of the stand-in's own that pairs over an in-memory stream). The login item and the
// notifications are noted instead of reaching the system, and the keychain is Chromium's mock one.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import jsQR from "jsqr";
import { startMock } from "../../baseline/tests/mock.mjs";
import { launchApp } from "./support/app.ts";
import { startTurn, TURN_PASSWORD, TURN_USER } from "./support/turn.ts";

const SERVICE = "https://pine.example.invalid";

let app: any;
let page: any;
let mock: any;
let home: string;
let data: string;

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

/** A call of the page's bridge, made in the page. */
const bridge = (name: string, ...args: unknown[]) => page.evaluate(([n, a]: [string, unknown[]]) => (window as any).pine[n](...a), [name, args]);

/** What the page was told of browser access, last first. */
const told = () => page.evaluate(() => (window as any).__access as any[]);
const noted = () => app.evaluate(() => (globalThis as any).noted);

async function until(what: string, ok: () => Promise<boolean>, ms = 15_000) {
	const end = Date.now() + ms;
	while (!(await ok())) {
		if (Date.now() > end) throw new Error(`timed out: ${what}. Told: ${JSON.stringify((await told())?.at(-1))}`);
		await new Promise((r) => setTimeout(r, 50));
	}
}

before(async () => {
	mock = await startMock({});
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-access-")));
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe", introduce: false }, security: { askAccess: false } }));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n\nYou are the main agent.\n");
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	data = path.join(home, "desktop-data");
	// The stand-in reaches no network: an address of the owner's own is named, never the official service.
	write(path.join(data, "prefs.json"), JSON.stringify({ updates: false, access: { service: SERVICE } }));

	// The stand-in phone uses a pairing link 4 s after it is opened: time for the window's test to read the QR code first.
	app = await launchApp({ ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"), PINE_HOME: home, PINE_DESKTOP_DATA: data, PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "", PINE_DESKTOP_ACCESS_STAND_IN: "4000" });
	page = await app.firstWindow();
	await app.evaluate(({ app, BrowserWindow, Notification }: any) => {
		const noted = ((globalThis as any).noted = { login: [] as unknown[], notified: [] as unknown[] });
		app.setLoginItemSettings = (settings: unknown) => void noted.login.push(settings);
		Notification.prototype.show = function (this: any) {
			noted.notified.push({ title: this.title, body: this.body });
		};
		// What the app does while its window is not in front, also where the tests show it (the virtual
		// screen of Linux, where a window that is never shown gets no keys) and where the system has no
		// notifications of its own to offer (a virtual screen has none).
		Notification.isSupported = () => true;
		BrowserWindow.prototype.isFocused = () => false;
	});
	await page.waitForFunction(() => Boolean((window as any).pine?.access));
	await page.evaluate(() => {
		(window as any).__access = [];
		(window as any).pine.onAccess((s: unknown) => (window as any).__access.push(s));
	});
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	if (home) fs.rmSync(home, { recursive: true, force: true });
});

test("browser access in the app: off at first, nothing written; on, it waits; a device pairs with one notification; removed, it is gone; off again", async () => {
	const first = await bridge("access");
	assert.equal(first.enabled, false);
	assert.equal(first.status, "off");
	assert.equal(first.service, SERVICE);
	assert.deepEqual(first.devices, []);
	assert.equal(first.problem, undefined, `no problem: ${JSON.stringify(first.problem)}`);
	assert.ok(!fs.existsSync(path.join(data, "access.bin")), "no host key before it is turned on");
	await assert.rejects(bridge("openPairing"), /Turn browser access on first/);

	const on = await bridge("setAccess", { enabled: true, openAtLogin: true });
	assert.equal(on.enabled, true);
	assert.equal(on.openAtLogin, true);
	assert.deepEqual((await noted()).login, [{ openAtLogin: true }]);
	assert.ok(fs.existsSync(path.join(data, "access.bin")), "the host key is kept in the app's data folder");
	assert.ok(!fs.readFileSync(path.join(data, "access.bin")).includes("OPENSSH"), "encrypted");
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, "prefs.json"), "utf8")).access, { enabled: true, service: SERVICE, openAtLogin: true });
	assert.ok(!fs.existsSync(path.join(home, "access.bin")) && !fs.readdirSync(home).some((f) => f.startsWith("access")), "nothing in pine's home");
	await until("the page is told it waits", async () => (await told()).some((s) => s.status === "waiting"));

	const opened = await bridge("openPairing");
	assert.ok(opened.link.startsWith(`${SERVICE}/#pair=`), opened.link);
	assert.equal((await bridge("access")).pairing.link, opened.link);
	await until("the owner is asked", async () => (await told()).at(-1)?.request !== undefined);
	const { request } = (await told()).at(-1);
	assert.equal(request.name, "Stand-in phone");
	assert.match(request.code, /^\d{4}$/);
	await assert.rejects(bridge("answerPairing", true, "not-this-one"), /no longer the one asking/);
	await bridge("answerPairing", true, request.id);
	await until("the device is connected", async () => (await told()).at(-1)?.devices[0]?.connected !== undefined);
	const now = (await told()).at(-1);
	assert.equal(now.devices[0].name, "Stand-in phone");
	assert.deepEqual(now.devices[0].connected, { path: "lan" });
	assert.equal(now.request, undefined);
	// The window is not in front (a test's never is): the question was said by the system too, with the digits and no Allow; then the device added.
	assert.deepEqual((await noted()).notified, [
		{ title: "Stand-in phone wants to connect", body: `Allow it in Pine if the device shows ${request.code}.` },
		{ title: "Browser access", body: "Stand-in phone can now access Pine." },
	]);

	assert.equal(await bridge("removeDevice", now.devices[0].id), true);
	assert.deepEqual((await bridge("access")).devices, []);
	await assert.rejects(bridge("removeDevice", "../../etc"), /not a device/);

	const off = await bridge("setAccess", { enabled: false, openAtLogin: false });
	assert.equal(off.status, "off");
	assert.deepEqual((await noted()).login, [{ openAtLogin: true }, { openAtLogin: false }]);
	assert.equal((await noted()).notified.length, 2, "one notification for the question, one for the one device added");
});

test("browser access in the app: an address that is not http(s) is refused and not kept", async () => {
	await assert.rejects(bridge("setAccess", { service: "file:///etc/passwd" }), /https:\/\//);
	assert.equal((await bridge("access")).service, SERVICE);
});

/** Waits for a selector to be on screen, and says what the section shows when it does not come. */
async function sees(selector: string, ms = 15_000) {
	try {
		await page.waitForSelector(selector, { timeout: ms });
	} catch {
		const there = await page.evaluate(() => ({ page: (document.querySelector("[data-slot=settings-page]") as HTMLElement | null)?.innerText?.slice(0, 1500), dialog: [...document.querySelectorAll("[data-slot=dialog-content], [data-slot=alert-dialog-content]")].map((d) => (d as HTMLElement).innerText.slice(0, 600)) }));
		throw new Error(`not seen: ${selector}. There: ${JSON.stringify(there)}`);
	}
}

/** The text a QR code on screen says: its picture taken from the window and read back, as a camera would. */
async function scanned(selector: string): Promise<string | undefined> {
	const png: Buffer = await page.locator(selector).screenshot();
	const { width, height, bgra } = await app.evaluate(({ nativeImage }: any, b64: string) => {
		const image = nativeImage.createFromBuffer(Buffer.from(b64, "base64"));
		// Made at scale 1: its size is the picture's own pixels.
		const { width, height } = image.getSize();
		return { width, height, bgra: image.toBitmap().toString("base64") };
	}, png.toString("base64"));
	const pixels = Buffer.from(bgra, "base64");
	const rgba = new Uint8ClampedArray(pixels.length);
	for (let i = 0; i < pixels.length; i += 4) (rgba[i] = pixels[i + 2]), (rgba[i + 1] = pixels[i + 1]), (rgba[i + 2] = pixels[i]), (rgba[i + 3] = pixels[i + 3]);
	return jsQR(rgba, width, height)?.data;
}

const menu = (command: string) => app.evaluate(({ BrowserWindow }: any, c: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", c), command);

test("Settings > Browser access through the window: turned on with open at login offered, a device added by its QR code and allowed, listed as connected now, removed", async () => {
	const section = "[data-slot=settings-page]";
	// The test home has no browser build: that is asked once at the start, and put off.
	await page.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Not now" }).click();
	await menu("settings");
	await page.locator("[data-sidebar=menu-button]", { hasText: "Browser access" }).click();
	await sees(`${section} h1 >> text=Browser access`);
	await sees(`${section} [data-slot=access-status] >> text=off`);

	// Turned on the first time: "Open Pine at login" is offered, checked.
	await page.locator(`${section} [data-slot=access-switch]`).click();
	await sees("[data-slot=access-turn-on] [data-slot=checkbox][data-checked]");
	await page.locator("[data-slot=access-turn-on]").getByRole("button", { name: "Turn on" }).click();
	await sees(`${section} [data-slot=access-status] >> text=waiting`);
	assert.equal((await bridge("access")).openAtLogin, true);
	assert.deepEqual((await noted()).login.at(-1), { openAtLogin: true });

	// Add a device: the QR code says the pairing link, Copy link puts it on the clipboard, and the time left is shown.
	await page.locator(section).getByRole("button", { name: "Add a device" }).click();
	await sees("[data-slot=pairing-dialog] [data-slot=qr-code]");
	const { pairing } = await bridge("access");
	assert.ok(pairing?.link.startsWith(`${SERVICE}/#pair=`), JSON.stringify(pairing));
	assert.equal(await scanned("[data-slot=pairing-dialog] [data-slot=qr-code]"), pairing.link);
	await sees("[data-slot=pairing-dialog] [data-slot=pairing-time] >> text=/\\d:\\d\\d/");
	await page.locator("[data-slot=pairing-dialog]").getByRole("button", { name: "Copy link" }).click();
	await until("the link is on the clipboard", async () => (await app.evaluate(({ clipboard }: any) => clipboard.readText())) === pairing.link, 3000);

	// The stand-in phone uses the link: the computer asks, with the device's name and its four digits.
	await sees("[data-slot=pairing-request]");
	const { request } = await bridge("access");
	await sees(`[data-slot=pairing-request] [data-slot=pairing-device] >> text=${request.name}`);
	assert.equal(await page.textContent("[data-slot=pairing-request] [data-slot=pairing-code]"), request.code);
	await page.locator("[data-slot=pairing-request]").getByRole("button", { name: "Allow" }).click();
	await page.waitForSelector("[data-slot=pairing-request], [data-slot=pairing-dialog]", { state: "detached" });
	await sees(`${section} [data-slot=access-device] >> text=Stand-in phone`);
	await sees(`${section} [data-slot=access-device] >> text=connected now`);
	await sees(`${section} [data-slot=access-device] >> text=same network`);

	// Remove asks once, then the device is gone.
	await page.locator(`${section} [data-slot=access-device]`).getByRole("button", { name: "Remove" }).click();
	await page.locator("[data-slot=alert-dialog-content]").getByRole("button", { name: "Remove" }).click();
	await page.waitForSelector(`${section} [data-slot=access-device]`, { state: "detached" });
	assert.deepEqual((await bridge("access")).devices, []);

	// A dialog closed cancels its pairing.
	await page.locator(section).getByRole("button", { name: "Add a device" }).click();
	await sees("[data-slot=pairing-dialog] [data-slot=qr-code]");
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=pairing-dialog]", { state: "detached" });
	await until("the pairing is cancelled", async () => (await bridge("access")).pairing === undefined);

	// Off again from the switch: no question, the devices kept (none here), the status off.
	await page.locator(`${section} [data-slot=access-switch]`).click();
	await sees(`${section} [data-slot=access-status] >> text=off`);
});

test("Settings > Browser access: the open-at-login switch and the service address are changed in the section", async () => {
	const section = "[data-slot=settings-page]";
	await sees(`${section} h1 >> text=Browser access`);
	await page.locator(`${section} [data-slot=access-login]`).click();
	await until("open at login is off", async () => (await bridge("access")).openAtLogin === false);
	const address = page.locator(`${section} [data-setting=access-service] input`);
	await address.fill("ftp://nowhere");
	await page.locator(`${section} [data-setting=access-service]`).getByRole("button", { name: "Save" }).click();
	await sees(`${section} [data-setting=access-service] [data-slot=field-error] >> text=https://`);
	await address.fill("https://pine.other.invalid");
	await page.locator(`${section} [data-setting=access-service]`).getByRole("button", { name: "Save" }).click();
	await until("the address is kept", async () => (await bridge("access")).service === "https://pine.other.invalid");
	// The page has it too (nothing left to save): what is typed before that is put back to what the page is told was kept.
	await page.locator(`${section} [data-setting=access-service] button:disabled`, { hasText: "Save" }).waitFor();
	await address.fill(SERVICE);
	await page.locator(`${section} [data-setting=access-service]`).getByRole("button", { name: "Save" }).click();
	await until("the address is back", async () => (await bridge("access")).service === SERVICE);
});

test("Settings > Browser access: a relay server is saved from its fields and tried; its password is kept sealed, never shown, and never told to the page", async () => {
	const turn = await startTurn();
	try {
		const section = "[data-slot=settings-page]";
		const relay = `${section} [data-setting=access-relay]`;
		await sees(`${relay} >> text=Relay server (TURN)`);
		await sees(`${relay} >> text=Used when no direct connection can be made, for example from some mobile networks. Leave it empty if you have none.`);
		await page.locator(`${relay} [data-slot=relay-address]`).fill(`turn:127.0.0.1:${turn.port}`);
		await page.locator(`${relay} [data-slot=relay-username]`).fill(TURN_USER);
		await page.locator(`${relay} [data-slot=relay-password]`).fill(TURN_PASSWORD);
		await page.locator(relay).getByRole("button", { name: "Save" }).click();
		await sees(`${relay} [data-slot=relay-check][data-result=usable] >> text=This relay works`);

		// The password field is empty again, and says one is kept; nothing on the page or in the page's state holds it.
		assert.equal(await page.locator(`${relay} [data-slot=relay-password]`).inputValue(), "");
		assert.match(await page.locator(`${relay} [data-slot=relay-password]`).getAttribute("placeholder"), /^Kept/);
		const state = await bridge("access");
		assert.deepEqual({ address: state.relay.address, username: state.relay.username, password: state.relay.password }, { address: `turn:127.0.0.1:${turn.port}`, username: TURN_USER, password: true });
		assert.ok(!JSON.stringify(state).includes(TURN_PASSWORD) && !JSON.stringify(await told()).includes(TURN_PASSWORD), "the page is never told the password");
		assert.ok(!JSON.stringify((await bridge("state")).prefs).includes(TURN_PASSWORD), "nor through the app's preferences");
		assert.ok(!(await page.content()).includes(TURN_PASSWORD), "nor drawn");
		// Kept: the address and user name in prefs.json, the password in the sealed file only.
		assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, "prefs.json"), "utf8")).access.relay, { address: `turn:127.0.0.1:${turn.port}`, username: TURN_USER });
		assert.ok(!fs.readFileSync(path.join(data, "prefs.json"), "utf8").includes(TURN_PASSWORD));
		assert.ok(!fs.readFileSync(path.join(data, "access.bin")).includes(TURN_PASSWORD), "sealed");

		// A wrong password: the relay is kept, and the line says what is wrong.
		await page.locator(`${relay} [data-slot=relay-password]`).fill("not-the-password");
		await page.locator(relay).getByRole("button", { name: "Save" }).click();
		await sees(`${relay} [data-slot=relay-check][data-result=failed] >> text=refused the user name or password`);
		assert.equal((await bridge("access")).relay.address, `turn:127.0.0.1:${turn.port}`);

		// Saved empty, the relay is gone.
		await page.locator(`${relay} [data-slot=relay-address]`).fill("");
		await page.locator(`${relay} [data-slot=relay-username]`).fill("");
		await page.locator(relay).getByRole("button", { name: "Save" }).click();
		await until("the relay is removed", async () => (await bridge("access")).relay === undefined);
		assert.equal(JSON.parse(fs.readFileSync(path.join(data, "prefs.json"), "utf8")).access.relay, undefined);
	} finally {
		await turn.close();
	}
});

test("adding a device from anywhere: pine://pair opens a pairing and its link in the browser, with the dialog; the device's question is a toast that replaces the dialog and takes no focus; the menu opens the dialog too", async () => {
	const opened = () => app.evaluate(() => (globalThis as any).quiet?.opened as string[]);
	const openUrl = (url: string) => app.evaluate(({ app }: any, u: string) => app.emit("open-url", { preventDefault() {} }, u), url);

	// Off: the address is ignored.
	await bridge("setAccess", { enabled: false });
	const before = (await opened()).length;
	await openUrl("pine://pair");
	await new Promise((r) => setTimeout(r, 300));
	assert.equal((await opened()).length, before);
	assert.equal((await bridge("access")).pairing, undefined);

	await bridge("setAccess", { enabled: true });
	await until("it waits", async () => (await bridge("access")).status === "waiting");
	// Away from Settings, in a conversation, with the composer focused.
	await menu("new");
	await sees("[data-slot=composer] textarea");
	await page.focus("[data-slot=composer] textarea");

	// Anything else under pine: is ignored, the mobile app's links among them.
	await openUrl("pine://pair?service=https%3A%2F%2Fpine.example.invalid&id=x&code=y");
	await new Promise((r) => setTimeout(r, 300));
	assert.equal((await bridge("access")).pairing, undefined);

	await openUrl("pine://pair");
	await until("a pairing is open", async () => (await bridge("access")).pairing !== undefined);
	const { pairing } = await bridge("access");
	await until("its link went to the browser", async () => (await opened()).at(-1) === pairing.link);
	await sees("[data-slot=pairing-dialog] [data-slot=qr-code]");
	assert.equal(await scanned("[data-slot=pairing-dialog] [data-slot=qr-code]"), pairing.link, "the dialog shows the pairing whose link was sent, not another one");
	// Sent again while that pairing is open (any site may send the address): nothing changes, the owner's pairing stays.
	const sent = (await opened()).length;
	await openUrl("pine://pair");
	await new Promise((r) => setTimeout(r, 300));
	assert.equal((await bridge("access")).pairing?.link, pairing.link);
	assert.equal((await opened()).length, sent);

	// The stand-in phone uses the link: the question is a toast, the dialog is put away.
	await sees("[data-slot=pairing-request] [data-slot=pairing-code]");
	await page.waitForSelector("[data-slot=pairing-dialog]", { state: "detached" });
	const { request } = await bridge("access");
	assert.equal(await page.textContent("[data-slot=pairing-request] [data-slot=pairing-code]"), request.code);
	// The focus stayed in the composer: an Enter typed there answers nothing.
	await page.focus("[data-slot=composer] textarea");
	assert.equal(await page.evaluate(() => document.activeElement?.closest("[data-slot=composer]") !== null), true);
	await page.keyboard.press("Enter");
	await new Promise((r) => setTimeout(r, 200));
	assert.equal(await page.evaluate(() => document.activeElement?.closest("[data-slot=composer]") !== null), true, "the toast took no focus");
	assert.equal((await bridge("access")).request?.code, request.code, "still asked");
	await page.locator("[data-slot=pairing-request]").getByRole("button", { name: "Refuse" }).click();
	await page.waitForSelector("[data-slot=pairing-request]", { state: "detached" });
	assert.deepEqual((await bridge("access")).devices, []);

	// The menu (and the Dock's) opens the dialog wherever the owner is; closed, its pairing is cancelled.
	await menu("add-device");
	await sees("[data-slot=pairing-dialog] [data-slot=qr-code]");
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=pairing-dialog]", { state: "detached" });
	await until("the pairing is cancelled", async () => (await bridge("access")).pairing === undefined);
	await bridge("setAccess", { enabled: false });
});
