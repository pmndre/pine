import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { available, BUILDING, buildHelper, computer, grantText, NO_COMPILER, type Node, outline, parseKeys, pickWindow, PICTURE_TOOLS, TOOLS, toolsOffered, toScreen, unavailable } from "./computer.ts";
import { APP_LOOK, computerSession } from "../src/computer.ts";
import { until } from "../testing/harness.ts";
import { FAKE_HELPER } from "../testing/computer.ts";

// ---- what needs no helper ------------------------------------------------------------------------

test("computer: a window becomes an outline a small model can read, with a reference on what can be used", () => {
	const window: Node = {
		role: "AXWindow",
		title: "Untitled",
		children: [
			{ role: "AXStaticText", value: "Untitled" },
			{ role: "AXButton", subrole: "AXCloseButton", ref: "e1", press: true },
			{
				role: "AXToolbar",
				children: [
					{ role: "AXGroup", children: [{ role: "AXButton", title: "Bold", ref: "e2", press: true, children: [{ role: "AXStaticText", value: "Bold" }] }] },
					{ role: "AXPopUpButton", desc: "Font", value: "Helvetica", ref: "e3", press: true },
					{ role: "AXCheckBox", title: "Wrap", value: 1, ref: "e4", press: true },
					{ role: "AXButton", title: "Send", ref: "e5", press: true, disabled: true },
				],
			},
			{ role: "AXScrollArea", children: [{ role: "AXTextArea", ref: "e6", edit: true, focused: true, value: "Dear Ada,\nthe figures are attached.\n", more: 120 }] },
			{ role: "AXTextField", subrole: "AXSearchField", ref: "e7", edit: true, placeholder: "Search" },
			{ role: "AXGroup", children: [{ role: "AXGroup" }] },
			{ role: "AXTable", children: [{ role: "AXRow", ref: "e8", selected: true, children: [{ role: "AXCell", children: [{ role: "AXStaticText", value: "notes.txt" }] }, { role: "AXCell", children: [{ role: "AXStaticText", value: "4 KB" }] }] }] },
		],
	};
	const text = outline(window);
	assert.equal(
		text,
		[
			"- close button [ref=e1]",
			"- toolbar",
			'  - button "Bold" [ref=e2]',
			'  - pop-up button "Font" [ref=e3]: "Helvetica"',
			'  - checkbox "Wrap" [ref=e4] (checked)',
			'  - button "Send" [ref=e5] (disabled)',
			"- text area [ref=e6] (focused), holds:",
			"    Dear Ada,",
			"    the figures are attached.",
			"    [120 more characters are not shown]",
			'- search field [ref=e7] (empty, shows "Search")',
			"- row [ref=e8] (selected)",
			'  - text "notes.txt"',
			'  - text "4 KB"',
		].join("\n"),
	);
	assert.ok(!text.includes("Untitled"), "the title bar says what the heading of the result says already");
	const long = outline({ role: "AXWindow", children: Array.from({ length: 400 }, (_, i) => ({ role: "AXButton", title: `Button number ${i}`, ref: `e${i}`, press: true })) }, 2000);
	assert.ok(long.length < 2300 && /\[cut: 3\d\d more lines\./.test(long), long.slice(-200));
	assert.equal(outline({ role: "AXWindow" }), "(the window is empty)");
});

test("computer: keys and shortcuts are read the way people write them", () => {
	assert.deepEqual(parseKeys("cmd+s"), [{ key: "s", mods: ["cmd"] }]);
	assert.deepEqual(parseKeys("Command+Shift+Z"), [{ key: "z", mods: ["cmd", "shift"] }]);
	assert.deepEqual(parseKeys("cmd+a delete, Enter"), [{ key: "a", mods: ["cmd"] }, { key: "delete", mods: [] }, { key: "return", mods: [] }]);
	assert.deepEqual(parseKeys("ctrl+option+Page_Down esc"), [{ key: "pagedown", mods: ["ctrl", "alt"] }, { key: "escape", mods: [] }]);
	assert.deepEqual(parseKeys("cmd++ ctrl+- +"), [{ key: "+", mods: ["cmd"] }, { key: "-", mods: ["ctrl"] }, { key: "+", mods: [] }]);
	assert.throws(() => parseKeys("hello"), /"hello" is not a key\..*To type text, use app_type/);
	assert.throws(() => parseKeys("hyper+s"), /"hyper" in "hyper\+s" is not a modifier key/);
	assert.throws(() => parseKeys(""), /Say which key/);
});

test("computer: a position in a picture becomes the right point on the screen", () => {
	// A Retina window, 800 by 600 points at 100, 50, sent as a picture of 1280 by 960 pixels.
	const retina = { width: 1280, height: 960, x: 100, y: 50, w: 800, h: 600 };
	assert.deepEqual(toScreen(retina, 0, 0), { x: 100.3, y: 50.3 });
	assert.deepEqual(toScreen(retina, 640, 480), { x: 500.3, y: 350.3 });
	assert.deepEqual(toScreen(retina, 1279, 959), { x: 899.7, y: 649.7 }, "the last pixel is still inside the window");
	// A second display to the left of the main one and above it: its points are negative.
	const second = { width: 1280, height: 800, x: -1920, y: -200, w: 1920, h: 1200 };
	assert.deepEqual(toScreen(second, 0, 0), { x: -1919.2, y: -199.2 });
	assert.deepEqual(toScreen(second, 640, 400), { x: -959.2, y: 400.8 });
	// A picture that is larger than what it shows (never made here, but a ratio is a ratio).
	assert.deepEqual(toScreen({ width: 200, height: 100, x: 0, y: 0, w: 100, h: 50 }, 100, 50), { x: 50.3, y: 25.3 });
});

test("computer: a window is found by its number or by a part of its title", () => {
	const windows = [{ index: 1, ref: "w1", title: "Untitled" }, { index: 2, ref: "w2", title: "Letter to Ada.rtf" }, { index: 3, ref: "w3", title: "ada", minimized: true }];
	assert.equal(pickWindow(windows, undefined), undefined, "nothing asked for: the front one");
	assert.equal(pickWindow(windows, "")?.ref, undefined);
	assert.equal(pickWindow(windows, 2)?.ref, "w2");
	assert.equal(pickWindow(windows, "2")?.ref, "w2");
	assert.equal(pickWindow(windows, "letter")?.ref, "w2");
	assert.equal(pickWindow(windows, "Ada")?.ref, "w3", "the whole title before a part of one");
	assert.throws(() => pickWindow(windows, "invoice"), /There is no window "invoice"\. The windows are: 1 "Untitled", 2 "Letter to Ada\.rtf", 3 "ada" \(minimized\)\./);
	assert.throws(() => pickWindow([], 1), /has no window open/);
});

test("computer: on a system that is not macOS nothing is offered, and a call is answered in plain words", async (t) => {
	for (const system of ["linux", "win32", "freebsd"]) {
		assert.deepEqual(toolsOffered({}, system), [], system);
		assert.equal(available({}, system), false);
	}
	assert.match(unavailable("linux"), /^App control is not available on this system \(Linux\)\. It works on macOS only\./);
	assert.equal(computerSession({ owner: true, level: "auto", dataDir: "/home/x/data", platform: "linux" }), undefined, "the daemon does not start the server there");
	assert.equal(toolsOffered({}, "darwin").length, TOOLS.length);
	// A stand-in for the helper runs anywhere: that is how the rest of this file runs on Linux.
	assert.ok(available({ helper: "/x" }, "linux") && computerSession({ owner: true, level: "auto", dataDir: "/d", platform: "linux", standIn: true }));

	// The server as a process. Where it has no helper to build, this is the whole of it.
	if (process.platform === "darwin") return;
	const child = spawn(process.execPath, [path.resolve(import.meta.dirname, "computer.ts")], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, PINE_MCP_OPTIONS: "{}" } });
	t.after(() => child.kill());
	const lines: any[] = [];
	child.stdout.on("data", (d) => lines.push(...String(d).split("\n").filter(Boolean).map((l) => JSON.parse(l))));
	for (const [id, method, params] of [[1, "initialize", {}], [2, "tools/list", {}], [3, "tools/call", { name: "app_click", arguments: { app: "TextEdit", x: 1, y: 1 } }]] as const) child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
	await until(() => lines.length === 3, 5000, "the server's answers");
	assert.match(lines[0].result.instructions, /not available on this system/);
	assert.deepEqual(lines[1].result.tools, []);
	assert.ok(lines[2].result.isError && /App control is not available on this system \(Linux\)/.test(lines[2].result.content[0].text), JSON.stringify(lines[2]));
});

test("computer: a model that cannot see gets no tools that need eyes; the owner can leave tools out", () => {
	const names = (o: Record<string, unknown>) => toolsOffered(o, "darwin").map((t) => t.name);
	assert.deepEqual(names({}), ["apps", "app_open", "app_snapshot", "app_press", "app_set_text", "app_menu", "app_screenshot", "app_click", "app_drag", "app_scroll", "app_type", "app_key"]);
	assert.deepEqual(names({ images: false }), ["apps", "app_open", "app_snapshot", "app_press", "app_set_text", "app_menu", "app_type", "app_key"]);
	assert.ok(PICTURE_TOOLS.every((t) => !names({ images: false }).includes(t)));
	assert.deepEqual(names({ block: ["app_type", "app_key", "app_drag"] }).length, 9);
	// What only looks says so, which is what lets it through unasked in manual mode.
	assert.deepEqual(TOOLS.filter((t) => (t as any).annotations?.readOnlyHint).map((t) => t.name), APP_LOOK);
	for (const t of TOOLS) assert.ok(t.description.length < 330, `${t.name}: a description a small model reads every turn stays short`);
});

test("computer: the helper is built once, and a Mac without the compiler is told what to install", async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pine-computer-build-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const source = path.join(dir, "helper.swift");
	fs.writeFileSync(source, "print(1)\n");
	const out = path.join(dir, "bin");
	const ran: string[] = [];
	const tools = (code: number, compile: (target: string) => { code: number; stderr: string }) => async (file: string, args: string[]) => {
		ran.push(path.basename(file));
		if (file.endsWith("xcode-select")) return { code, stdout: code ? "" : `${dir}\n`, stderr: code ? "xcode-select: error: unable to get active developer directory" : "" };
		return { stdout: "", ...compile(args[args.indexOf("-o") + 1]) };
	};
	const works = (target: string) => (fs.writeFileSync(target, "#!/bin/sh\n"), { code: 0, stderr: "" });

	// No developer tools: no compiler is started (it would only open a window), and the message says what to type.
	await assert.rejects(() => buildHelper(out, source, tools(2, works)), (e: Error) => e.message === NO_COMPILER && /xcode-select --install/.test(e.message) && !/at .*\(.*:\d+/.test(e.message));
	assert.deepEqual(ran, ["xcode-select"]);
	// A compiler that fails: its reason, not a stack trace.
	await assert.rejects(() => buildHelper(out, source, tools(0, () => ({ code: 1, stderr: "helper.swift:1:1: error: no such module 'AppKit'\nnote: something\n" }))), /pine could not build its helper for app control \(helper\.swift:1:1: error: no such module 'AppKit'\)\. Tell your owner/);
	assert.deepEqual(fs.existsSync(out) ? fs.readdirSync(out) : [], [], "nothing half-built is left");

	const built = await buildHelper(out, source, tools(0, works));
	assert.match(path.basename(built), /^pine-computer-[0-9a-f]{12}$/);
	ran.length = 0;
	assert.equal(await buildHelper(out, source, tools(0, works)), built);
	assert.deepEqual(ran, [], "the second time it is only found");
	// Another source (an update of pine) is another program, and the old one goes.
	fs.writeFileSync(source, "print(2)\n");
	const next = await buildHelper(out, source, tools(0, works));
	assert.notEqual(next, built);
	assert.deepEqual(fs.readdirSync(out), [path.basename(next)]);
});

// ---- the server's logic, on a stand-in for the helper --------------------------------------------

function fakeHelper(t: { after(fn: () => void): void }, o: Record<string, unknown> = {}, ...flags: string[]) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pine-computer-test-"));
	const script = path.join(dir, "helper.mjs");
	const log = path.join(dir, "log.txt");
	const scratch = path.join(dir, "scratch");
	fs.mkdirSync(scratch);
	fs.writeFileSync(script, FAKE_HELPER);
	fs.writeFileSync(log, "");
	const server = computer(o as any, { launch: async () => spawn(process.execPath, [script, log, ...flags], { stdio: ["pipe", "pipe", "pipe"] }), scratch });
	t.after(() => (server.close(), fs.rmSync(dir, { recursive: true, force: true })));
	const lines = () => fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
	return {
		script,
		log,
		scratch,
		lines,
		/** What reached the machine: everything but looking and bringing forward. */
		did: () => lines().filter((l) => !/^(start|activate|shot|status)/.test(l)),
		call: async (name: string, args: Record<string, unknown> = {}) => {
			const r = await server.call(name, args);
			return typeof r === "string" ? r : r.map((p) => (p.type === "text" ? p.text : `[${p.mimeType} ${p.data}]`)).join("\n");
		},
		fails: async (name: string, args: Record<string, unknown> = {}) => {
			try {
				await server.call(name, args);
			} catch (e) {
				return (e as Error).message;
			}
			throw new Error(`${name} ${JSON.stringify(args)} was expected to be refused`);
		},
		server,
	};
}

test("computer: by outline. An app's window is read as text and its controls are used by reference", async (t) => {
	const c = fakeHelper(t);
	const apps = await c.call("apps");
	assert.equal(apps, 'Running apps:\n- TextEdit: windows 1 "Untitled", 2 "Letter.rtf"\n- Notes: window 1 "Notes"\n- Terminal (pine runs in it): window 1 "pine"\n\nScreens: 1 (2560 by 1440, main), 2 (1920 by 1080)');

	const snap = await c.call("app_snapshot", { app: "textedit" });
	assert.ok(snap.startsWith('TextEdit, window 1 "Untitled". Other windows: 2 "Letter.rtf".\nControls with [ref=...] can be used'), snap);
	assert.ok(snap.endsWith('- button "Bold" [ref=e3]\n- image "Seal" [ref=e9]\n- text area [ref=e2]: "Hello"'), snap);
	assert.match(await c.call("app_snapshot", { app: "TextEdit", window: "letter" }), /^TextEdit, window 2 "Letter\.rtf"\. Other windows: 1 "Untitled"\./);
	assert.match(await c.fails("app_snapshot", { app: "TextEdit", window: "invoice" }), /There is no window "invoice"/);

	assert.equal(await c.call("app_set_text", { app: "TextEdit", ref: "e2", text: "Dear Ada" }), 'The text area in TextEdit now holds "Dear Ada".');
	assert.match(await c.call("app_press", { app: "TextEdit", ref: "[ref=e3]" }), /^Pressed the button "Bold" in TextEdit\. Take a new app_snapshot/);
	assert.ok((await c.call("app_snapshot", { app: "TextEdit" })).endsWith('- text area [ref=e2]: "Dear Ada"'), "the result is read back");
	assert.deepEqual(c.did(), ['set e2 "Dear Ada"', "press e3"]);

	// A control with nothing to press by name is clicked in its middle, in the app, in front.
	assert.match(await c.call("app_press", { app: "TextEdit", ref: "e9" }), /^Clicked the image "Seal" in TextEdit\./);
	assert.deepEqual(c.lines().slice(-2), ["activate 100", "click 400,200 undefined xundefined"]);
	// A field that cannot be written into directly: clicked, everything selected, typed over.
	const typed = fakeHelper(t, {}, "typed-only");
	await typed.call("app_set_text", { app: "TextEdit", ref: "e2", text: "x" });
	assert.deepEqual(typed.did(), ["click 400,250 undefined xundefined", "key cmd+a to=100 front=100", 'type "x" to=100 front=100']);

	// A reference from before the window changed, or no reference at all.
	assert.match(await c.fails("app_press", { app: "TextEdit", ref: "e77" }), /That reference does not exist any more: the window has changed\. Take a new app_snapshot/);
	assert.match(await c.fails("app_press", { app: "TextEdit" }), /Say which control/);
	assert.match(await c.fails("app_snapshot", { app: "Pages" }), /Pages is not running\. Open it with app_open/);
	assert.match(await c.fails("app_snapshot", {}), /Say which app/);
	assert.match(await c.call("app_snapshot", { app: "Calculator" }).catch((e) => e.message), /Calculator is not running/);
	assert.match(await c.call("app_open", { app: "Calculator.app" }), /^Calculator was opened and is in front\. It has no window open\./);
	assert.match(await c.call("app_snapshot", { app: "Calculator" }), /^Calculator has no window open\..*app_menu/);
	assert.match(await c.call("app_open", { app: "notes" }), /^Notes was already running and is in front\. Its window: 1 "Notes"\./);
	assert.match(await c.fails("app_open", { app: "Nope" }), /No app called "Nope" was found on this Mac/);
	assert.match(await c.fails("app_open", { app: "/tmp/evil.app" }), /Give the app's name, for example Safari, not a path/);
});

test("computer: menus are listed level by level and an entry is picked by its path", async (t) => {
	const c = fakeHelper(t);
	assert.equal(await c.call("app_menu", { app: "TextEdit" }), 'The menus of TextEdit:\n- File >\n- Format >\nGive path to look into one or to pick an entry. Example: path "File > Save".');
	assert.equal(await c.call("app_menu", { app: "TextEdit", path: "file" }), '"file" in TextEdit holds:\n- New   cmd+n\n- Save…   cmd+s\n- Open Recent >\n- Revert To (not available now)');
	assert.equal(await c.call("app_menu", { app: "TextEdit", path: "Format" }), '"Format" in TextEdit holds:\n- Wrap to Page (ticked)');
	assert.deepEqual(c.did(), [], "looking into menus presses nothing");
	assert.equal(await c.call("app_menu", { app: "TextEdit", path: "File > New" }), 'Picked "File > New" in TextEdit.');
	assert.match(await c.call("app_menu", { app: "TextEdit", path: "File > Save..." }), /^Picked "File > Save\.\.\." in TextEdit\. The app has not answered yet, which often means a dialog has opened\./);
	assert.deepEqual(c.did(), ["press m11", "press m12"]);
	assert.match(await c.fails("app_menu", { app: "TextEdit", path: "File > Export" }), /There is no "Export" in "File"\. There is:\n- New/);
	assert.match(await c.fails("app_menu", { app: "TextEdit", path: "Edit > Copy" }), /There is no "Edit" in the menu bar of TextEdit/);
	assert.match(await c.fails("app_menu", { app: "TextEdit", path: "File > New > Blank" }), /"File > New" is an entry, not a menu/);
	assert.match(await c.fails("app_menu", { app: "TextEdit", path: "File > Revert To" }), /is not available right now/);
	assert.deepEqual(c.did(), ["press m11", "press m12"]);
});

test("computer: by picture. A position in the picture the model was given is clicked at the right point of the screen", async (t) => {
	const c = fakeHelper(t, { imageSize: 1000 });
	// No picture yet: there is nothing a position could mean.
	assert.match(await c.fails("app_click", { app: "TextEdit", x: 10, y: 10 }), /you have not taken one yet\. Take one with app_screenshot first/);

	const shot = await c.call("app_screenshot", { app: "TextEdit" });
	assert.ok(shot.startsWith('Picture of TextEdit, window 1 "Untitled": 1280 by 800 pixels. For app_click, app_drag and app_scroll, x and y are pixels in this picture, counted from its top left corner (x from 0 to 1279, y from 0 to 799).'), shot);
	assert.ok(shot.endsWith(`[image/jpeg ${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64")}]`), "the picture itself goes to the model");
	assert.deepEqual(fs.readdirSync(c.scratch), [], "and does not stay on the disk");
	assert.equal(c.lines().at(-1), "shot w1 edge=1000");

	// The window is 640 points wide at x = 100, the picture 1280 pixels: half a point per pixel.
	assert.match(await c.call("app_click", { app: "TextEdit", x: 640, y: 400 }), /^Clicked the button "Bold" at 640, 400 in TextEdit\./);
	assert.deepEqual(c.lines().slice(-2), ["activate 100 w1", "click 420.3,250.3 left x1"]);
	await c.call("app_click", { app: "TextEdit", x: 0, y: 0, count: 2 });
	assert.equal(c.lines().at(-1), "click 100.3,50.3 left x2");
	assert.match(await c.call("app_click", { app: "TextEdit", x: 1279, y: 799, button: "right" }), /^Right-clicked/);
	assert.equal(c.lines().at(-1), "click 739.8,449.8 right x1");
	await c.call("app_drag", { app: "TextEdit", x: 100, y: 100, to_x: 300, to_y: 500 });
	assert.equal(c.lines().at(-1), "drag 150.3,100.3 to 250.3,300.3");
	assert.match(await c.call("app_scroll", { app: "TextEdit", x: 640, y: 400, direction: "down" }), /^Scrolled down by 5 lines/);
	assert.equal(c.lines().at(-1), "scroll 420.3,250.3 dx=0 dy=-5");
	await c.call("app_scroll", { app: "TextEdit", x: 640, y: 400, direction: "left", amount: 2 });
	assert.equal(c.lines().at(-1), "scroll 420.3,250.3 dx=2 dy=0");

	// Outside the picture, or not numbers.
	assert.match(await c.fails("app_click", { app: "TextEdit", x: 1280, y: 10 }), /outside the last picture, which is 1280 by 800 pixels: x goes from 0 to 1279/);
	assert.match(await c.fails("app_click", { app: "TextEdit", x: "left", y: 10 }), /x and y must be numbers/);
	assert.match(await c.fails("app_scroll", { app: "TextEdit", x: 1, y: 1, direction: "sideways" }), /direction is up, down, left or right/);

	// The whole screen, and a second screen left of the main one.
	const screen = await c.call("app_screenshot");
	assert.match(screen, /^Picture of the whole screen 1 of 2: 1280 by 720 pixels\./);
	await c.call("app_click", { app: "TextEdit", x: 200, y: 100 });
	assert.equal(c.lines().at(-1), "click 401,201 left x1", "a pixel of this picture is two points of the screen");
	await c.call("app_screenshot", { screen: 2 });
	await c.call("app_click", { app: "TextEdit", x: 0, y: 0 });
	assert.equal(c.lines().at(-1), "click -1919.2,0.8 left x1");

	// A window that was moved after its picture was taken is clicked where it is now.
	const moved = fakeHelper(t, {}, "after-shot-moved");
	await moved.call("app_screenshot", { app: "TextEdit" });
	await moved.call("app_click", { app: "TextEdit", x: 640, y: 400 });
	assert.equal(moved.lines().at(-1), "click 920.3,350.3 left x1");

	// With a menu open the picture holds more than the window, and a window alone cannot be
	// photographed: the app comes to the front first, and positions count from where the picture starts.
	const menu = fakeHelper(t, {}, "menu-open");
	assert.match(await menu.call("app_screenshot", { app: "TextEdit" }), /^Picture of TextEdit, window 1 "Untitled", and what is open over it: 1360 by 1000 pixels\./);
	assert.deepEqual(menu.lines().slice(-3), ["shot w1 edge=1280", "activate 100 w1", "shot w1 edge=1280"]);
	await menu.call("app_click", { app: "TextEdit", x: 80, y: 0 });
	assert.equal(menu.lines().at(-1), "click 100.3,50.3 left x1", "40 points of menu lie left of the window");
	const both = fakeHelper(t, {}, "menu-open", "after-shot-moved");
	await both.call("app_screenshot", { app: "TextEdit" });
	await both.call("app_click", { app: "TextEdit", x: 80, y: 0 });
	assert.equal(both.lines().at(-1), "click 600.3,150.3 left x1");
	const closed = fakeHelper(t, {}, "closed");
	await closed.call("app_screenshot", { app: "TextEdit" });
	assert.match(await closed.fails("app_click", { app: "TextEdit", x: 640, y: 400 }), /The window in the last picture is gone\. Take a new app_screenshot/);
});

test("computer: an action lands in the app that was named, or not at all", async (t) => {
	const c = fakeHelper(t);
	// A reference of another app's control.
	assert.match(await c.fails("app_press", { app: "TextEdit", ref: "e20" }), /The reference e20 is not a control of TextEdit/);
	assert.match(await c.fails("app_set_text", { app: "Notes", ref: "e2", text: "x" }), /The reference e2 is not a control of Notes/);
	// A position in a picture of another app.
	await c.call("app_screenshot", { app: "TextEdit" });
	assert.match(await c.fails("app_click", { app: "Notes", x: 10, y: 10 }), /The last picture shows TextEdit, not Notes\. Take a picture of Notes first/);
	// A position on the whole screen where another app's window is.
	await c.call("app_screenshot");
	assert.match(await c.fails("app_click", { app: "TextEdit", x: 600, y: 100 }), /At that position is Notes, not TextEdit, so nothing was done\..*To act in Notes, name it as app/);
	assert.match(await c.fails("app_drag", { app: "TextEdit", x: 600, y: 100, to_x: 10, to_y: 10 }), /At that position is Notes, not TextEdit/);
	assert.match(await c.fails("app_scroll", { app: "TextEdit", x: 600, y: 100, direction: "down" }), /At that position is Notes/);
	assert.match(await c.call("app_click", { app: "Notes", x: 600, y: 100 }), /^Clicked the group at 600, 100 in Notes/);
	// Keys are sent to the app that was named and to no other, after it was brought to the front.
	await c.call("app_type", { app: "Notes", text: "Milk\nEggs" });
	await c.call("app_key", { app: "TextEdit", keys: "cmd+a delete" });
	assert.deepEqual(c.lines().slice(-5), ["activate 200", 'type "Milk\\nEggs" to=200 front=200', "activate 100", "key cmd+a to=100 front=100", "key delete to=100 front=100"]);
	assert.deepEqual(c.did().filter((l) => l.startsWith("click")), ["click 1201,201 left x1"], "nothing was clicked for any of the refusals");

	// An app that cannot be brought forward is not typed at.
	const stuck = fakeHelper(t, {}, "stuck");
	assert.match(await stuck.fails("app_type", { app: "TextEdit", text: "x" }), /TextEdit could not be brought to the front, so nothing was done in it/);
	assert.match(await stuck.fails("app_key", { app: "TextEdit", keys: "return" }), /could not be brought to the front/);
	assert.deepEqual(stuck.did(), []);
});

test("computer: pine does not click or type in the app it runs in, where its own questions are answered", async (t) => {
	const c = fakeHelper(t);
	// Looking is allowed.
	assert.match(await c.call("app_snapshot", { app: "Terminal" }), /- button "Allow" \[ref=e30\]/);
	assert.match(await c.call("app_screenshot", { app: "Terminal" }), /^Picture of Terminal/);
	assert.match(await c.call("app_menu", { app: "Terminal", path: "File" }), /holds:/);
	const refusal = /Terminal is the app pine itself runs in\. pine does not click, type or press there: that is where your owner answers pine's questions\. You can look at it \(app_snapshot, app_screenshot\)\. To run a command, use your own shell\./;
	for (const [name, args] of [
		["app_press", { ref: "e30" }],
		["app_set_text", { ref: "e30", text: "y" }],
		["app_type", { text: "y\n" }],
		["app_key", { keys: "return" }],
		["app_click", { x: 10, y: 10 }],
		["app_drag", { x: 10, y: 10, to_x: 20, to_y: 20 }],
		["app_scroll", { x: 10, y: 10, direction: "down" }],
		["app_menu", { path: "File > New" }],
	] as const) assert.match(await c.fails(name, { app: "terminal", ...args }), refusal, name);
	assert.deepEqual(c.did(), [], "nothing reached it");
	// Where pine does not run in an app with windows (a server, a service), there is no such app.
	const none = fakeHelper(t, {}, "no-host");
	assert.match(await none.call("app_type", { app: "Terminal", text: "ls" }), /^Typed 2 characters into Terminal/);
});

test("computer: a missing grant is said in plain words, with where to click, and macOS is asked to show its window once", async (t) => {
	const c = fakeHelper(t, {}, "no-access", "no-screen");
	const access = await c.fails("app_snapshot", { app: "TextEdit" });
	assert.equal(access, 'macOS does not let pine operate apps yet. Your owner has to allow it, once: open System Settings > Privacy & Security > Accessibility and switch on "Terminal", the app pine runs in. macOS has just put a window on their screen that leads there. Nothing was done. Tell your owner this, and try again when they say it is done.');
	const again = await c.fails("app_type", { app: "TextEdit", text: "x" });
	assert.ok(again.includes("System Settings > Privacy & Security > Accessibility") && !again.includes("has just put a window"), `macOS is not made to ask a second time: ${again}`);
	const screen = await c.fails("app_screenshot", { app: "TextEdit" });
	assert.ok(screen.includes("macOS does not let pine operate apps yet"), "a window's picture needs the window, which needs the same grant");
	const whole = await c.fails("app_screenshot");
	assert.match(whole, /^macOS does not let pine take pictures of the screen yet\. .*System Settings > Privacy & Security > Screen & System Audio Recording \(on older systems: Screen Recording\) and switch on "Terminal", the app pine runs in\. .*read windows with app_snapshot, which needs no picture\.$/);
	assert.deepEqual(c.lines().filter((l) => l.startsWith("status ask")), ["status ask=accessibility", "status ask=screen"]);
	assert.deepEqual(c.did(), []);
	// Without the grant the apps are still listed, without their windows, and it says why.
	const apps = await c.call("apps");
	assert.ok(apps.startsWith("Running apps:\n- TextEdit\n- Notes\n- Terminal (pine runs in it)\n") && apps.includes("\n\nThe windows are not listed: macOS does not let pine operate apps yet."), apps);
	// An app can be opened without it.
	assert.match(await c.call("app_open", { app: "Calculator" }), /^Calculator was opened and is in front\. Read a window with app_snapshot/);

	// Each refusal ended the helper: the one started for the next call sees what the owner has switched on since.
	const starts = c.lines().filter((l) => l === "start").length;
	assert.ok(starts >= 4, `${starts} helpers were started`);
	fs.writeFileSync(`${c.log}.granted`, "");
	assert.match(await c.call("app_snapshot", { app: "TextEdit" }), /- button "Bold"/);
	assert.match(await c.call("app_screenshot"), /^Picture of the whole screen/);

	assert.match(grantText("accessibility", undefined, false), /switch on the app pine runs in \(the terminal app pine was started from\)\./);
});

test("computer: a helper that is still being built, cannot be started, or dies says so and the next call starts anew", async (t) => {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pine-computer-test-"));
	t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
	let release!: (e: Error) => void;
	let launches = 0;
	const slow = computer({}, { scratch, patience: 30, launch: () => (++launches === 1 ? new Promise((_, reject) => (release = reject)) : Promise.reject(new Error("no compiler here"))) });
	await assert.rejects(() => slow.call("apps", {}), (e: Error) => e.message === BUILDING);
	await assert.rejects(() => slow.call("apps", {}), (e: Error) => e.message === BUILDING);
	assert.equal(launches, 1, "the build that is running is waited for, not started again");
	release(new Error("the build failed"));
	await new Promise((r) => setImmediate(r));
	await assert.rejects(() => slow.call("apps", {}), /no compiler here/);
	assert.equal(launches, 2, "after a failure the next call tries again");

	// A helper that ends in the middle of a call.
	let n = 0;
	const dying = computer({}, { scratch, launch: async () => spawn(process.execPath, ["-e", ++n === 1 ? 'process.stdin.once("data", () => { console.error("Segmentation fault"); process.exit(3); })' : 'process.stdin.on("data", (d) => console.log(JSON.stringify({ id: JSON.parse(String(d)).id, ok: true, apps: [] })))'], { stdio: ["pipe", "pipe", "pipe"] }) });
	t.after(() => dying.close());
	await assert.rejects(() => dying.call("apps", {}), /pine's helper for app control stopped: Segmentation fault\. Try once more\./);
	assert.equal(await dying.call("apps", {}), "Running apps:\n(none)");
	await assert.rejects(() => dying.call("app_fly", {}), /The tool app_fly is not available/);
	const blind = computer({ images: false }, { scratch, launch: async () => spawn(process.execPath, ["-e", ""]) });
	await assert.rejects(() => blind.call("app_click", { app: "TextEdit", x: 1, y: 1 }), /The tool app_click is not available/);
});
