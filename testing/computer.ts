// A stand-in for the helper of the app control server (mcp/computer.swift): a Node script that speaks its protocol.
// Two apps and the terminal pine runs in. TextEdit's window is 640 by 400 points at 100, 50; a
// picture of it is 1280 by 800 pixels. Everything right of x = 1000 on the screen belongs to Notes.
export const FAKE_HELPER = `
import fs from "node:fs";
import readline from "node:readline";
const [log, ...flags] = process.argv.slice(2);
const note = (line) => fs.appendFileSync(log, line + "\\n");
note("start");
const apps = { textedit: { name: "TextEdit", pid: 100, bundle: "com.apple.TextEdit" }, notes: { name: "Notes", pid: 200, bundle: "com.apple.Notes" }, terminal: { name: "Terminal", pid: 300, bundle: "com.apple.Terminal", host: !flags.includes("no-host") } };
const windows = { 100: [{ index: 1, ref: "w1", title: "Untitled", main: true, x: 100, y: 50, w: 640, h: 400 }, { index: 2, ref: "w2", title: "Letter.rtf", x: 300, y: 300, w: 400, h: 300 }], 200: [{ index: 1, ref: "w3", title: "Notes", x: 1000, y: 0, w: 800, h: 600 }], 300: [{ index: 1, ref: "w4", title: "pine", x: 0, y: 700, w: 800, h: 400 }], 400: [] };
const refs = { e2: 100, e3: 100, e9: 100, e20: 200, e30: 300, m11: 100, m12: 100, m14: 100 };
let text = "Hello";
let front = 0, moved = false;
const granted = (kind) => !flags.includes("no-" + kind) || fs.existsSync(log + ".granted");
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
	const m = JSON.parse(line);
	const ok = (r = {}) => send({ id: m.id, ok: true, ...r });
	const fail = (code, error = "") => send({ id: m.id, ok: false, code, error });
	const info = (a) => ({ host: false, hidden: false, ...a, front: front === a.pid });
	const input = ["at", "click", "drag", "scroll", "type", "key"].includes(m.cmd);
	if ((input || ["windows", "tree", "menu"].includes(m.cmd)) && !granted("access")) return fail("accessibility");
	switch (m.cmd) {
		case "status":
			if (m.ask) note("status ask=" + m.ask);
			return ok({ accessibility: granted("access"), screen: granted("screen"), host: flags.includes("no-host") ? undefined : info(apps.terminal) });
		case "apps":
			return ok({ accessibility: granted("access"), apps: Object.values(apps).map((a) => ({ ...info(a), ...(granted("access") ? { windows: windows[a.pid] } : {}) })), displays: [{ index: 1, x: 0, y: 0, w: 2560, h: 1440, main: true }, { index: 2, x: -1920, y: 0, w: 1920, h: 1080 }] });
		case "find": {
			const a = apps[String(m.app).toLowerCase()];
			return ok(a ? { running: true, ...info(a) } : { running: false });
		}
		case "open": {
			const key = String(m.app).toLowerCase();
			if (apps[key]) return ok({ ...info(apps[key]), launched: false });
			if (key !== "calculator") return fail("not_found", "Unable to find application named '" + m.app + "'");
			apps.calculator = { name: "Calculator", pid: 400, bundle: "com.apple.calculator" };
			note("open " + m.app);
			return ok({ ...info(apps.calculator), launched: true });
		}
		case "activate":
			note("activate " + m.pid + (m.ref ? " " + m.ref : ""));
			if (flags.includes("stuck")) return ok({ front: false });
			front = m.pid;
			return ok({ front: true });
		case "windows":
			return ok({ windows: windows[m.pid] ?? [] });
		case "frame": {
			const w = Object.values(windows).flat().find((x) => x.ref === m.ref);
			if (!w || flags.includes("closed")) return fail("gone");
			return ok(moved ? { x: w.x + 500, y: w.y + 100, w: w.w, h: w.h } : { x: w.x, y: w.y, w: w.w, h: w.h });
		}
		case "tree": {
			const all = windows[m.pid] ?? [];
			const w = all[(m.window ?? 1) - 1];
			if (!w) return ok({ windows: all });
			const root = m.pid === 100
				? { role: "AXWindow", title: w.title, children: [{ role: "AXButton", title: "Bold", ref: "e3", press: true }, { role: "AXImage", desc: "Seal", ref: "e9", press: true }, { role: "AXScrollArea", children: [{ role: "AXTextArea", ref: "e2", edit: true, value: text }] }] }
				: { role: "AXWindow", title: w.title, children: [{ role: "AXButton", title: m.pid === 300 ? "Allow" : "New Note", ref: m.pid === 300 ? "e30" : "e20", press: true }] };
			return ok({ windows: all, window: w, root, cut: false });
		}
		case "whose":
			if (!refs[m.ref]) return fail("gone");
			return ok({ pid: refs[m.ref], role: m.ref.startsWith("m") ? "AXMenuItem" : m.ref === "e2" ? "AXTextArea" : m.ref === "e9" ? "AXImage" : "AXButton", title: { e3: "Bold", e9: "Seal", e20: "New Note", e30: "Allow" }[m.ref] });
		case "press":
			if (!refs[m.ref]) return fail("gone");
			if (m.ref === "e9") return ok({ done: false, x: 400, y: 200 });
			note("press " + m.ref);
			return ok({ done: true, ...(m.ref === "m12" ? { unsure: true } : {}) });
		case "set":
			if (flags.includes("typed-only")) return ok({ done: false, x: 400, y: 250 });
			note("set " + m.ref + " " + JSON.stringify(m.text));
			text = m.text;
			return ok({ done: true });
		case "menu":
			if (!m.ref) return ok({ items: [{ ref: "m0", title: "Apple", submenu: true }, { ref: "m1", title: "File", submenu: true }, { ref: "m2", title: "Format", submenu: true }] });
			if (m.ref === "m1") return ok({ items: [{ ref: "m11", title: "New", shortcut: "cmd+n" }, { ref: "m12", title: "Save…", shortcut: "cmd+s" }, { ref: "m13", title: "Open Recent", submenu: true }, { ref: "m14", title: "Revert To", disabled: true }] });
			if (m.ref === "m13") return ok({ items: [{ ref: "m131", title: "Letter.rtf" }] });
			return ok({ items: [{ ref: "m21", title: "Wrap to Page", mark: "✓" }] });
		case "at":
			return ok(m.x < 1000 ? { pid: 100, name: "TextEdit", role: "AXButton", title: "Bold", wpid: 100, wname: "TextEdit" } : { pid: 200, name: "Notes", role: "AXGroup", wpid: 200, wname: "Notes" });
		case "click":
			note("click " + m.x + "," + m.y + " " + m.button + " x" + m.count);
			return ok();
		case "drag":
			note("drag " + m.x + "," + m.y + " to " + m.x2 + "," + m.y2);
			return ok();
		case "scroll":
			note("scroll " + m.x + "," + m.y + " dx=" + m.dx + " dy=" + m.dy);
			return ok();
		case "type":
			note("type " + JSON.stringify(m.text) + " to=" + m.pid + " front=" + front);
			return ok();
		case "key":
			note("key " + [...m.mods, m.key].join("+") + " to=" + m.pid + " front=" + front);
			return ok();
		case "shot": {
			if (!granted("screen")) return fail("screen");
			if (flags.includes("after-shot-moved") && (!flags.includes("menu-open") || front === m.pid)) moved = true;
			const file = m.dir + "/shot-" + Date.now() + ".jpg";
			const real = flags.find((f) => f.startsWith("picture="));
			if (real) fs.copyFileSync(real.slice(8), file);
			else fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
			note("shot " + (m.ref ?? "display " + (m.display ?? 1)) + " edge=" + m.edge);
			if (m.ref) {
				const w = Object.values(windows).flat().find((x) => x.ref === m.ref);
				// A menu hangs out of the window, to the left and below: the picture is of that part of the screen.
				if (flags.includes("menu-open")) return front === m.pid ? ok({ file, width: (w.w + 40) * 2, height: (w.h + 100) * 2, x: w.x - 40, y: w.y, w: w.w + 40, h: w.h + 100, wx: w.x, wy: w.y, more: true }) : fail("behind");
				return ok({ file, width: w.w * 2, height: w.h * 2, x: w.x, y: w.y, w: w.w, h: w.h, wx: w.x, wy: w.y });
			}
			return (m.display ?? 1) === 2 ? ok({ file, width: 1280, height: 720, x: -1920, y: 0, w: 1920, h: 1080, display: 2, displays: 2 }) : ok({ file, width: 1280, height: 720, x: 0, y: 0, w: 2560, h: 1440, display: 1, displays: 2 });
		}
	}
	fail("failed", "unknown command " + m.cmd);
});
`;
