// Bundled MCP server "browser": a real browser (Playwright) for pages that need JavaScript,
// clicks, forms or a login.
//
// This file is a guard around Microsoft's Playwright MCP server, which it starts as a child:
//
//   - Every request the browser makes goes through a small proxy in this process. The proxy
//     refuses private, loopback and link-local addresses (checked on the address it actually
//     connects to), so a page cannot reach your router, your NAS or pine's control port.
//     The one exception is an address the owner allowed for the conversation: the daemon asks
//     them when the agent opens a local address, and writes the yes into `localFile`.
//   - Tools that would run code on this machine or read local files are removed from the tool
//     list and refused if called anyway.
//   - The browser's file access is confined to a scratch folder.
//
//   - The browser has no window unless `headed` is set. In the owner's own conversations the agent
//     can put it on the owner's screen and take it off again (browser_show, browser_hide): the
//     browser is started anew, on the same page, with the same logins.
//
//   - A window of the owner's own that shows the browser itself (the Pine app, beside a
//     conversation) gets it as pictures and hands back what the owner does in them: clicks, keys,
//     an address. That goes through a door for the daemon alone (startViewDoor), and only in the
//     owner's own conversations. The browser stays the same one, behind the same guard, without
//     a window; browser_show then opens none.
//
// Everything a browser returns is outside content; pine marks sessions that use it as tainted.
//
// options: {
//   headed?, profile?, tools?: "core" | "all" | string[], block?: string[], images?,
//   allowHosts?, denyHosts?, allowPrivate?, browser?, executablePath?, caps?, viewport?, extraArgs?
// }
import { type ChildProcess, spawn } from "node:child_process";
import crypto from "node:crypto";
import dns from "node:dns";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { onLines, options } from "./lib.ts";
import { hostPort, isLocalName, isPrivateAddress } from "../src/net.ts";

interface BrowserOptions {
	headed?: boolean;
	/** Folder for a persistent profile (cookies, logins). Default: a fresh profile every time. */
	profile?: string;
	tools?: "core" | "all" | string[];
	block?: string[];
	/** false: a screenshot comes back without its picture. For a model that cannot see. Default true. */
	images?: boolean;
	allowHosts?: string[];
	denyHosts?: string[];
	allowPrivate?: boolean;
	/**
	 * Set by pine, not by the owner: a file in pine's home with the local addresses ("host:port")
	 * the owner allowed for this conversation. Agents cannot write there.
	 */
	localFile?: string;
	/**
	 * Set by pine, not by the owner: this is one of the owner's own conversations, so the agent may
	 * put the browser on the owner's screen (browser_show, browser_hide).
	 */
	window?: boolean;
	/**
	 * Set by pine, not by the owner: a file in pine's home in which this server says where its door
	 * for the owner's own window is (startViewDoor). Only an owner's conversation has one.
	 */
	viewFile?: string;
	/**
	 * Set by pine, not by the owner: a file in pine's home in which the daemon says where the Pine app's
	 * own browser is (desktop/electron/browser-host.ts), while the app runs on this computer. Where it
	 * is, this browser is that one: a page in the app's window, beside the conversation.
	 */
	hostFile?: string;
	/** Set by pine with hostFile: the conversation this browser is for, which names its tabs in the app. */
	room?: string;
	browser?: string;
	executablePath?: string;
	caps?: string;
	viewport?: string;
	extraArgs?: string[];
}

/** Never offered: they execute code in this process or hand local files to a page. */
export const ALWAYS_BLOCKED = ["browser_run_code_unsafe", "browser_file_upload", "browser_drop", "browser_install", "browser_storage_state", "browser_set_storage_state"];
/**
 * This server asks Playwright for its "storage" tools to carry a login from a hidden browser to a
 * visible one. To an agent they are offered only where the owner asked for them (`caps`).
 */
const STORAGE_TOOLS = /^browser_(cookie|localstorage|sessionstorage)_/;
/**
 * And for its tools that act at a place in the picture ("vision"), to turn the wheel where the
 * owner turns it in their own window. To an agent they are offered only where the owner asked for them.
 */
const VISION_TOOLS = /^browser_mouse_/;
const hasCap = (caps: string | undefined, cap: string) => (caps ?? "").split(",").some((c) => c.trim() === cap);
/** pine's own: the browser as a window on the owner's screen. */
export const WINDOW_TOOLS = [
	{
		name: "browser_show",
		description:
			"Open the browser as a window on your owner's screen, on the page you are on, with the same logins. Use it when your owner wants to watch, or has to do something themselves: log in, solve a captcha, confirm a payment. You keep working in the same window. The page is loaded again, so text typed into a form is gone.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "browser_hide",
		description: "Close the browser's window on your owner's screen and carry on without one, on the same page, with the same logins.",
		inputSchema: { type: "object", properties: {} },
	},
];
const isWindowTool = (name: string) => WINDOW_TOOLS.some((t) => t.name === name);
/** Enough to read and operate a page; keeps the tool list short for small models. */
export const CORE_TOOLS = [
	"browser_navigate", "browser_navigate_back", "browser_snapshot", "browser_find", "browser_click", "browser_type", "browser_fill_form",
	"browser_press_key", "browser_select_option", "browser_hover", "browser_wait_for", "browser_tabs", "browser_handle_dialog", "browser_close",
	// To look at a page the way a person does, and to see why it does not work: an agent that builds a page needs both.
	"browser_take_screenshot", "browser_console_messages",
];

export function toolAllowed(name: string, o: Pick<BrowserOptions, "tools" | "block" | "window" | "caps">): boolean {
	if (ALWAYS_BLOCKED.includes(name) || (o.block ?? []).includes(name)) return false;
	if (isWindowTool(name)) return o.window === true;
	if (STORAGE_TOOLS.test(name) && !hasCap(o.caps, "storage")) return false;
	if (VISION_TOOLS.test(name) && !hasCap(o.caps, "vision")) return false;
	const tools = o.tools ?? "core";
	return tools === "all" ? true : (tools === "core" ? CORE_TOOLS : tools).includes(name);
}

const hostMatches = (list: string[] | undefined, host: string) => (list ?? []).some((h) => host === h || host.endsWith(`.${h}`));

type GuardOptions = Pick<BrowserOptions, "allowHosts" | "denyHosts" | "allowPrivate" | "localFile">;

/** What the agent is told when a local address is refused in a conversation where the owner can be asked. */
export const ASK_HINT = "A local address needs your owner's yes. Open it with browser_navigate (for example http://localhost:3000) and your owner is asked";

/** The local addresses the owner allowed for this conversation. Read each time: a yes applies at once. */
function allowedLocal(o: GuardOptions): string[] {
	if (!o.localFile) return [];
	try {
		const list = JSON.parse(fs.readFileSync(o.localFile, "utf8"));
		return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
	} catch {
		return [];
	}
}

/**
 * Resolve a host and return what the browser may connect to, or throw. For a public name that is
 * the address it resolved to; for a local address the owner allowed (host and port), the host as given.
 */
export async function vet(host: string, o: GuardOptions, port?: number): Promise<string> {
	const name = host.replace(/^\[|\]$/g, "").toLowerCase();
	if (hostMatches(o.denyHosts, name)) throw new Error(`${name} is on the deny list`);
	if (o.allowHosts?.length && !hostMatches(o.allowHosts, name)) throw new Error(`${name} is not on the allow list`);
	if (!o.allowPrivate && (isLocalName(name) || (net.isIP(name) && isPrivateAddress(name)))) {
		// Only a host that is local by its own name can be allowed: a name that has to be looked up
		// could point somewhere else tomorrow.
		if (port !== undefined && allowedLocal(o).includes(hostPort(name, port))) return name;
		throw new Error(`${name} is a ${isLocalName(name) ? "local name" : "private address"}`);
	}
	const addrs = net.isIP(name) ? [{ address: name }] : await dns.promises.lookup(name, { all: true });
	if (!addrs.length) throw new Error(`${name} does not resolve`);
	if (!o.allowPrivate && addrs.some((a) => isPrivateAddress(a.address))) throw new Error(`${name} resolves to a private address`);
	return addrs[0].address;
}

/**
 * A proxy carries what a browser asks it to carry, and a browser has roads of its own that never
 * ask: WebRTC opens UDP sockets itself, QUIC is UDP, and a name can be looked up without a
 * request. These switches close them in the browser, for every way pine starts one.
 */
export const NO_WAY_AROUND = [
	"--disable-quic",
	// WebRTC makes its own connections. Only what goes through the proxy is left, which for this proxy is nothing over UDP.
	"--webrtc-ip-handling-policy=disable_non_proxied_udp",
	"--enforce-webrtc-ip-permission-check",
	// The proxy looks names up, not the browser: a lookup of the browser's own finds nothing.
	"--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
	"--dns-prefetch-disable",
	"--no-pings",
];

/** A forward proxy that only lets vetted destinations through. */
export async function startGuardProxy(o: GuardOptions, log: (line: string) => void = () => {}) {
	const refused: string[] = [];
	/** Records a refusal and returns the sentence for the agent. */
	const deny = (what: string, why: unknown) => {
		const reason = why instanceof Error ? why.message : String(why);
		// Where the owner can be asked, say how. Elsewhere there is nothing the agent can do.
		const line = `${what}: ${reason}${o.localFile && / is a (local name|private address)$/.test(reason) ? `. ${ASK_HINT}` : ""}`;
		refused.push(line);
		if (refused.length > 200) refused.shift();
		log(`refused ${line}`);
		return line;
	};
	const server = http.createServer(async (req, res) => {
		// Plain http through the proxy arrives as an absolute URL.
		let url: URL;
		try {
			url = new URL(req.url ?? "");
			if (url.protocol !== "http:") throw new Error("only http and https are proxied");
			const address = await vet(url.hostname, o, Number(url.port || 80));
			const headers = { ...req.headers };
			delete headers["proxy-connection"];
			delete headers["proxy-authorization"];
			const upstream = http.request({ host: address, port: Number(url.port || 80), method: req.method, path: url.pathname + url.search, headers: { ...headers, host: url.host } }, (up) => {
				res.writeHead(up.statusCode ?? 502, up.headers);
				up.pipe(res);
			});
			upstream.on("error", () => res.writeHead(502).end());
			req.pipe(upstream);
		} catch (e) {
			res.writeHead(403, { "content-type": "text/plain" }).end(`pine: this address is not reachable from the browser (${deny(req.url ?? "?", e)})`);
		}
	});
	server.on("connect", async (req, client: net.Socket, head) => {
		const m = (req.url ?? "").match(/^(.+):(\d+)$/);
		try {
			if (!m) throw new Error("bad CONNECT target");
			const address = await vet(m[1], o, Number(m[2]));
			const upstream = net.connect(Number(m[2]), address, () => {
				client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
				if (head.length) upstream.write(head);
				upstream.pipe(client);
				client.pipe(upstream);
			});
			const close = () => (upstream.destroy(), client.destroy());
			upstream.on("error", close);
			client.on("error", close);
		} catch (e) {
			deny(req.url ?? "?", e);
			client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
		}
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return { port: (server.address() as net.AddressInfo).port, refused, close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))) };
}

/**
 * Playwright writes page snapshots and logs to files and returns links to them. An agent cannot
 * follow those links, so put the content of files from the scratch folder into the result itself.
 */
export function inlineFiles(text: string, scratch: string, limit = 24_000): string {
	const root = fs.realpathSync(scratch);
	// A file's path, as Playwright writes it: /… or, on Windows, C:\….
	return text.replace(/\[([^\]\n]+)\]\(((?:\/|[A-Za-z]:\\)[^)\s#]+)(#[^)\s]*)?\)/g, (whole, label, file) => {
		try {
			const real = fs.realpathSync(file);
			if (!real.startsWith(root + path.sep)) return whole;
			const bytes = fs.readFileSync(real);
			// A screenshot or a PDF: the picture itself comes with the result, its bytes are not text.
			if (bytes.subarray(0, 4096).includes(0)) return `${label}: saved as ${real}`;
			const content = bytes.toString("utf8");
			const max = /snapshot/i.test(label) ? limit : 2000;
			const body = content.length > max ? `${content.slice(0, max)}\n[cut: ${content.length - max} more characters; use browser_find to locate things on a long page]` : content;
			return `${label}:\n${body.trimEnd()}`;
		} catch {
			return whole;
		}
	});
}

export interface Tabs {
	tabs: Array<{ title: string; url: string }>;
	current: number;
}

/** Playwright's list of tabs ("- 0: (current) [Title](address)"), read. */
export function readTabs(text: string): Tabs {
	const tabs: Tabs["tabs"] = [];
	let current = 0;
	for (const m of text.matchAll(/^- (\d+):( \(current\))? \[(.*)\]\((\S*)\)\s*$/gm)) {
		if (m[2]) current = tabs.length;
		tabs.push({ title: m[3], url: m[4] });
	}
	return { tabs, current };
}

/**
 * Which tab somebody other than the agent changed, if any: a tab that was not there (the last
 * such one), else the agent's own tab if its address is another now, else another tab whose
 * address changed. Undefined when everything is as the agent last saw it.
 */
export function changedTab(before: Tabs, now: Tabs): number | undefined {
	if (!now.tabs.length) return undefined;
	if (now.tabs.length > before.tabs.length) return now.tabs.length - 1;
	// A page that only moves within itself (the part after #) is the same page.
	const bare = (url: string | undefined) => url?.replace(/#.*$/, "");
	const moved = now.tabs.map((t, i) => (bare(t.url) !== bare(before.tabs[i]?.url) ? i : -1)).filter((i) => i >= 0);
	if (!moved.length) return now.tabs.length < before.tabs.length || now.current !== before.current ? now.current : undefined;
	return moved.includes(now.current) ? now.current : moved.at(-1);
}

/** Calls that only look at a page. Everything else acts on it or leaves it. */
const LOOKS = ["browser_snapshot", "browser_take_screenshot", "browser_console_messages", "browser_find", "browser_network_requests", "browser_network_request"];
const looksOnly = (params: any) => LOOKS.includes(String(params?.name)) || (params?.name === "browser_tabs" && params?.arguments?.action === "list");

// ---- the owner's own window: what it is shown, and what the owner does in it ------------------------

/** What the owner did in the picture of a page. Places are in the picture's own points, which are the page's. */
export type ViewOp =
	| { do: "click"; x: number; y: number; button: "left" | "right" | "middle"; count: number }
	| { do: "move"; x: number; y: number }
	| { do: "drag"; x: number; y: number; x2: number; y2: number }
	| { do: "wheel"; dx: number; dy: number }
	| { do: "text"; text: string }
	| { do: "key"; key: string }
	| { do: "back" | "forward" | "reload" }
	| { do: "tab"; index: number }
	| { do: "newtab" }
	| { do: "closetab"; index: number }
	/** The room the picture has in the owner's window: the page is laid out for it, so that it is shown point for point. */
	| { do: "size"; w: number; h: number };

export interface ViewState {
	/** A page is open. Without one there is no picture, and nothing is opened to make one. */
	open: boolean;
	tabs: Array<{ title: string; url: string }>;
	current: number;
	/** The browser is a window on the owner's screen as well. */
	window: boolean;
	/** How many pixels of the picture make one point of the page: a place in the picture, divided by it, is a place in the page. */
	scale: number;
	/** The browser is the Pine app's own, a page in its window (hostFile): the app shows it there itself. */
	hosted?: boolean;
	/** Why the last thing the owner asked for was not done. */
	error?: string;
}

export interface BrowserView {
	state(): Promise<ViewState>;
	/** The page as a picture (JPEG), or nothing while no page is open. */
	frame(): Promise<Buffer | undefined>;
	input(ops: unknown): Promise<ViewState>;
	/** The owner opens an address. It goes through the guard like any other. */
	open(address: unknown): Promise<ViewState>;
	/** The owner's own window shows this browser from now on (or no longer). */
	embed(on: boolean): void;
}

/** A page's own words (a title, an address) for a line in the owner's window: one line, and not endless. */
const shown = (text: unknown, max: number) => String(text ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").slice(0, max);

/** What is typed into an address line, as an address of the web; nothing else is opened. */
export function webAddress(given: unknown): string | undefined {
	const text = typeof given === "string" ? given.trim() : "";
	if (!text || text.length > 2000 || /\s/.test(text)) return undefined;
	try {
		const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `${/^(localhost|127\.|\[::1\])/i.test(text) ? "http" : "https"}://${text}`);
		return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
	} catch {
		return undefined;
	}
}

/** What the owner did, checked piece by piece: only what is known, numbers that are places, keys that are names of keys. */
export function cleanOps(given: unknown): ViewOp[] {
	const ops: ViewOp[] = [];
	const place = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(20_000, Math.max(0, Math.round(v))) : undefined);
	const turn = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(5000, Math.max(-5000, Math.round(v))) : 0);
	for (const raw of Array.isArray(given) ? given.slice(0, 60) : []) {
		const op = (raw ?? {}) as Record<string, unknown>;
		const [x, y] = [place(op.x), place(op.y)];
		if (op.do === "click" && x !== undefined && y !== undefined) ops.push({ do: "click", x, y, button: op.button === "right" || op.button === "middle" ? op.button : "left", count: op.count === 2 || op.count === 3 ? op.count : 1 });
		else if (op.do === "move" && x !== undefined && y !== undefined) ops.push({ do: "move", x, y });
		else if (op.do === "drag" && x !== undefined && y !== undefined && place(op.x2) !== undefined && place(op.y2) !== undefined) ops.push({ do: "drag", x, y, x2: place(op.x2)!, y2: place(op.y2)! });
		else if (op.do === "wheel" && (turn(op.dx) || turn(op.dy))) ops.push({ do: "wheel", dx: turn(op.dx), dy: turn(op.dy) });
		else if (op.do === "text" && typeof op.text === "string" && op.text) ops.push({ do: "text", text: op.text.slice(0, 4000) });
		// A key by its name, with what is held down with it: "Enter", "Shift+Tab", "Meta+KeyA".
		else if (op.do === "key" && typeof op.key === "string" && /^[A-Za-z0-9]{1,20}(\+[A-Za-z0-9]{1,20}){0,4}$/.test(op.key)) ops.push({ do: "key", key: op.key });
		else if (op.do === "back" || op.do === "forward" || op.do === "reload") ops.push({ do: op.do });
		else if ((op.do === "tab" || op.do === "closetab") && Number.isInteger(op.index) && (op.index as number) >= 0 && (op.index as number) < 100) ops.push({ do: op.do, index: op.index as number });
		else if (op.do === "newtab") ops.push({ do: "newtab" });
		else if (op.do === "size" && place(op.w) !== undefined && place(op.h) !== undefined) ops.push({ do: "size", w: Math.min(2560, Math.max(320, place(op.w)!)), h: Math.min(2000, Math.max(240, place(op.h)!)) });
	}
	return ops;
}

/** A value as it is written in code. (JSON, with the two line ends JSON leaves as they are written out.) */
const literal = (value: unknown) => JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/**
 * The owner's hand in the page: run by Playwright's server, in the tab the agent works in. The
 * text is fixed; __OPS__ is replaced by what cleanOps let through, as a value. Nothing a page or
 * an agent wrote is part of it, and it hands nothing of the page back.
 */
const OWNER_HAND = `async (page) => {
	const ops = __OPS__;
	for (const o of ops) {
		if (o.do === "click") await page.mouse.click(o.x, o.y, { button: o.button, clickCount: o.count });
		else if (o.do === "drag") {
			await page.mouse.move(o.x, o.y);
			await page.mouse.down();
			await page.mouse.move(o.x2, o.y2, { steps: 12 });
			await page.mouse.up();
		} else if (o.do === "text") await page.keyboard.type(o.text);
		else if (o.do === "key") await page.keyboard.press(o.key);
		else if (o.do === "back") await page.goBack({ timeout: 10000 }).catch(() => {});
		else if (o.do === "forward") await page.goForward({ timeout: 10000 }).catch(() => {});
		else if (o.do === "reload") await page.reload({ timeout: 15000 }).catch(() => {});
		else if (o.do === "size") await page.setViewportSize({ width: o.w, height: o.h });
	}
	return true;
}`;

/**
 * The door for the owner's own window. A small server on the loopback that answers the daemon
 * and nobody else: it writes where it listens and the word to say into `file`, which lies in
 * pine's home where no agent reads, and whoever does not say the word gets nothing. The browser
 * itself cannot come here either: its guard refuses the loopback.
 */
export async function startViewDoor(view: BrowserView, file: string): Promise<{ port: number; token: string; close(): void }> {
	const token = crypto.randomBytes(32).toString("hex");
	const allowed = (said: string | undefined) => {
		const [a, b] = [Buffer.from(said ?? ""), Buffer.from(`Bearer ${token}`)];
		return a.length === b.length && crypto.timingSafeEqual(a, b);
	};
	const body = (req: http.IncomingMessage) =>
		new Promise<any>((resolve, reject) => {
			let text = "";
			req.on("data", (chunk) => {
				text += chunk;
				if (text.length > 200_000) reject(new Error("too long"));
			});
			req.on("end", () => {
				try {
					resolve(JSON.parse(text || "{}"));
				} catch (e) {
					reject(e);
				}
			});
			req.on("error", reject);
		});
	const server = http.createServer(async (req, res) => {
		const json = (value: unknown, status = 200) => res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(value));
		// A page in some browser never gets here with the word; one that tries says where it comes from.
		if (!allowed(req.headers.authorization) || req.headers.origin !== undefined) return json({ error: "not for you" }, 401);
		try {
			const at = `${req.method} ${(req.url ?? "").split("?")[0]}`;
			if (at === "GET /state") return json(await view.state());
			if (at === "GET /frame") {
				const picture = await view.frame();
				return picture ? res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" }).end(picture) : res.writeHead(204).end();
			}
			if (at === "POST /input") return json(await view.input((await body(req)).ops));
			if (at === "POST /open") return json(await view.open((await body(req)).url));
			if (at === "POST /embed") return view.embed((await body(req)).on === true), json({ ok: true });
			json({ error: "not found" }, 404);
		} catch (e) {
			json({ error: e instanceof Error ? e.message : String(e) }, 400);
		}
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const port = (server.address() as net.AddressInfo).port;
	fs.mkdirSync(path.dirname(file), { recursive: true });
	// Whole or not at all: the daemon may be reading at this moment.
	fs.writeFileSync(`${file}.tmp`, JSON.stringify({ port, token, pid: process.pid }), { mode: 0o600 });
	fs.renameSync(`${file}.tmp`, file);
	return {
		port,
		token,
		close: () => {
			fs.rmSync(file, { force: true });
			server.closeAllConnections();
			server.close();
		},
	};
}

export interface BrowserServer {
	/** Starts Playwright's server, with a window or without, or on the Pine app's browser at `host`. */
	launch(headed: boolean, host?: string): ChildProcess;
	/** One message for the client. */
	send(msg: unknown): void;
	/** A folder the browser may write into; a login is kept there for the moment of a restart. */
	scratch: string;
	/** What the guard refused, newest last. */
	refused: string[];
	/** Playwright's server ended by itself. */
	ended(): void;
	/** How many pixels a browser without a window draws for one point of a page (VIEW_SCALE where the owner's window may show it). Default 1. */
	scale?: number;
	/** Where the Pine app's own browser is now, if it is there (hostFile, and it answers); looked at again and again. */
	host?(): Promise<string | undefined>;
}

/**
 * Pixels for one point of a page while the owner's own window may show the browser: the picture is
 * as sharp as a Retina display draws, and on any other display it is drawn smaller. The agent's own
 * screenshots stay in the page's points (Playwright's default), so its places are the same as without it.
 */
export const VIEW_SCALE = 2;

/** Plain letters, digits and signs: each is a key of the browser's own keyboard, and is typed by itself without waiting for the page. */
const KEYS = /^[\x20-\x7e]{1,40}$/;

/**
 * The conversation between pine and Playwright's server: the tool list is filtered, blocked calls
 * are refused, calls run one after another, and the browser is restarted when its window is to
 * appear or to go. Returns what takes the client's lines.
 */
export function relay(o: BrowserOptions, io: BrowserServer): { line(line: string): void; close(): void; child(): ChildProcess; view: BrowserView } {
	let headed = !!o.headed;
	/** The Pine app's own browser this one is now (io.host), while the app runs: a page in its window, which the owner uses too. */
	let hosted: string | undefined;
	/** The owner's own window shows this browser (the Pine app): browser_show opens no other. */
	let embedded = false;
	/** The owner's hand was in the browser since the agent last looked. */
	let shared = false;
	/** The address of the page that is open, to open it again after a restart. */
	let page: string | undefined;
	/** The client's first message, said again to a browser that is started later. */
	let hello: any;
	const retired = new Set<ChildProcess>();
	const own = new Map<string, (msg: any) => void>();
	let ownIds = 0;
	/** The tabs as the agent last saw them, while the browser has a window. */
	let seen: Tabs | undefined;
	const listIds = new Set<unknown>();
	// A browser is one page at a time: calls that a model issues in parallel are run one after another,
	// otherwise the second navigation would abort the first.
	const waiting: any[] = [];
	let inFlight: any;

	const start = (): ChildProcess => {
		const c = io.launch(headed, hosted);
		c.on("exit", () => {
			if (retired.delete(c)) return;
			for (const answer of own.values()) answer({ error: { message: "the browser ended" } });
			io.ended();
		});
		onLines(c.stdout!, (line) => fromBrowser(c, line));
		return c;
	};
	let child = start();
	const write = (msg: unknown) => child.stdin!.write(`${JSON.stringify(msg)}\n`);

	/** A request of this server's own; the answer does not go to the client. */
	const ask = (method: string, params: unknown, ms = 30_000) =>
		new Promise<any>((resolve) => {
			const id = `pine-${++ownIds}`;
			const timer = setTimeout(() => own.get(id)?.({ error: { message: "the browser did not answer" } }), ms);
			own.set(id, (msg) => (clearTimeout(timer), own.delete(id), resolve(msg)));
			write({ jsonrpc: "2.0", id, method, params });
		});
	const textOf = (msg: any) => (msg.result?.content ?? []).filter((p: any) => p.type === "text").map((p: any) => String(p.text)).join("\n") || String(msg.error?.message ?? "");
	const call = async (name: string, args: unknown) => {
		const msg = await ask("tools/call", { name, arguments: args });
		return { ok: !msg.error && !msg.result?.isError, text: inlineFiles(textOf(msg), io.scratch) };
	};

	/** The tabs as they are: their addresses in order, and which one the agent works in. */
	const tabsNow = async (): Promise<Tabs | undefined> => {
		const r = await call("browser_tabs", { action: "list" });
		return r.ok ? readTabs(r.text) : undefined;
	};
	/**
	 * With a window, the owner uses the same browser. Before a call of the agent's, look whether
	 * the tabs are still as the agent last saw them. If not, the agent is moved to the tab that
	 * changed, and a call that would act is not carried out: the agent gets the page as it is now
	 * instead, so it never leaves or changes a page it has not seen.
	 */
	const guarded = async (msg: any) => {
		const now = seen ? await tabsNow() : undefined;
		const front = now && seen ? changedTab(seen, now) : undefined;
		if (!now || front === undefined) return write(msg);
		if (front !== now.current) await call("browser_tabs", { action: "select", index: front });
		const tab = now.tabs[front];
		const where = `${tab.title || "a page"} (${tab.url})`;
		if (looksOnly(msg.params)) {
			// The note is this server's own and stays here: Playwright's server answers only a message
			// that is exactly a request, and one with a field more it drops without a word.
			msg.notice = `The browser has changed since you last looked (your owner uses this window too). You are now on: ${where}.`;
			return write({ jsonrpc: msg.jsonrpc, id: msg.id, method: msg.method, params: msg.params });
		}
		const page = await call("browser_snapshot", {});
		seen = await tabsNow();
		answered({
			jsonrpc: "2.0",
			id: msg.id,
			result: {
				content: [
					{
						type: "text",
						text: `Not done: the browser is not where you left it. Your owner uses the same window and has probably opened this page: ${where}.\nIf what your owner asked for can be done on this page or this site, do it here. For anything else open a new tab (browser_tabs with action "new") instead of leaving their page. This is the page now:\n\n${page.text}`,
					},
				],
			},
		});
	};
	const next = () => {
		if (inFlight !== undefined || !waiting.length) return;
		// A picture is taken beside the calls (view.frame). One that may end the page or the browser waits for it:
		// a picture taken after the browser closed would open it again.
		if (framing && ends(waiting[0])) return void framing.finally(next);
		inFlight = waiting.shift();
		if (inFlight.job) return void inFlight.job().finally(() => ((inFlight = undefined), next()));
		if (isWindowTool(String(inFlight.params?.name))) return void turn(inFlight);
		if (headed || hosted || shared) return void guarded(inFlight);
		write(inFlight);
	};
	/** The local addresses a page reached for by itself and was refused, that the agent has not been told yet: each once, a few at a time. */
	const told = new Set<string>();
	const unsaid = (): string[] => {
		const fresh: string[] = [];
		for (const line of io.refused) {
			const what = line.match(/^(.*?): \S+ is a (?:local name|private address)/)?.[1];
			if (!what) continue;
			let address = what;
			try {
				if (/^https?:\/\//i.test(what)) address = new URL(what).host;
			} catch {
				continue;
			}
			// A host and a port, and nothing else of what the page wrote.
			if (!/^[A-Za-z0-9.\-:[\]]{1,80}$/.test(address) || told.has(address)) continue;
			told.add(address);
			if (fresh.length < 3) fresh.push(address);
		}
		return fresh;
	};
	/** A call of the agent's that may close a tab or the browser, or start the browser anew. */
	const ends = (msg: any) => !msg.job && (isWindowTool(String(msg.params?.name)) || ["browser_close", "browser_tabs"].includes(String(msg.params?.name)));
	let framing: Promise<Buffer | undefined> | undefined;
	/** Something this server does itself (what the owner did, where the browser is): it waits its turn like a call of the agent's. */
	const between = <T>(job: () => Promise<T>): Promise<T> =>
		new Promise<T>((resolve, reject) => {
			waiting.push({ job: () => job().then(resolve, reject) });
			next();
		});
	const answered = (msg: unknown) => {
		io.send(msg);
		inFlight = undefined;
		next();
	};

	/** Ends the browser and starts it again, with a window or without, or as the app's (`host`). */
	const restart = async (window: boolean, host: string | undefined) => {
		const old = child;
		const gone = new Promise((r) => old.once("exit", r));
		retired.add(old);
		await ask("tools/call", { name: "browser_close", arguments: {} }, 5000);
		old.kill();
		await gone;
		headed = window;
		hosted = host;
		child = start();
		if (hello) {
			await ask("initialize", hello.params);
			write({ jsonrpc: "2.0", method: "notifications/initialized" });
		}
	};

	/** browser_show and browser_hide. The login goes along in a file that exists only for the restart. */
	const turn = async (msg: any) => {
		const show = msg.params.name === "browser_show";
		const say = (text: string, isError = false) => answered({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) } });
		// The app shows the browser beside the conversation, or the browser is the app's own.
		const inApp = embedded || hosted !== undefined;
		if (headed === show) return say(show ? "The browser is already a window on your owner's screen." : inApp ? "The browser has no separate window. Your owner sees it in the Pine app, at the right of this conversation's window." : "The browser has no window.");
		// The owner's own window shows the browser already: nothing is started anew, and no second window opens.
		if (show && inApp) {
			if (page !== undefined) seen ??= await tabsNow();
			shared = true;
			return say(
				`Your owner sees the browser in the Pine app, in the browser at the right of this conversation's window, and uses it there too: they open pages in it, log in, solve a captcha, confirm something. Tell them to look there. From now on, what they ask you to find or do on the web, do on the page they are on; look at it first (browser_snapshot), because they may have changed it. When they have to do something themselves, wait until they say they are done.${page === undefined ? " No page is open yet: open the one they are to see." : ""}`,
			);
		}
		const at = page;
		const state = path.join(io.scratch, `state-${process.pid}-${Date.now()}.json`);
		try {
			const kept = at !== undefined && (await call("browser_storage_state", { filename: state })).ok;
			const open = async (window: boolean) => {
				await restart(window, hosted);
				if (kept) await call("browser_set_storage_state", { filename: state });
				// A browser that was not told to open anything has no window yet.
				return call("browser_navigate", { url: at ?? "about:blank" });
			};
			let now = await open(show);
			if (show && !now.ok) {
				const why = now.text.split("\n").find((l) => /error/i.test(l) && l.trim().length > 12) ?? now.text.split("\n")[0] ?? "";
				now = await open(false);
				return say(`A window could not be opened on this computer (${why.trim().slice(0, 200)}). The browser carries on without one. If pine runs on a machine without a screen, there is no window to show.\n\n${now.text}`, true);
			}
			seen = show ? await tabsNow() : undefined;
			say(
				`${show ? "The browser is now a window on your owner's screen, and they use it too: they open pages in it, log in, solve a captcha, confirm something. Tell them it is open. From now on, what they ask you to find or do on the web, do in this window, on the page they are on; look at it first (browser_snapshot), because they may have changed it. When they have to do something themselves, wait until they say they are done. browser_hide closes the window and keeps the logins." : "The window is closed. The browser carries on without one, with the same logins."}\n\n${now.text}`,
			);
		} catch (e) {
			say(`The browser could not be ${show ? "shown" : "hidden"}: ${e instanceof Error ? e.message : String(e)}`, true);
		} finally {
			fs.rmSync(state, { force: true });
		}
	};

	const fromBrowser = (from: ChildProcess, line: string) => {
		if (!line.trim()) return;
		let msg: any;
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}
		const mine = typeof msg.id === "string" ? own.get(msg.id) : undefined;
		if (from !== child) return; // the last words of a browser that was replaced
		for (const part of msg.result?.content ?? []) {
			if (part.type !== "text" || typeof part.text !== "string") continue;
			const url = part.text.match(/^- Page URL: (\S+)/m)?.[1];
			if (url) page = url === "about:blank" ? undefined : url;
		}
		if (mine) return mine(msg);
		if (listIds.delete(msg.id) && Array.isArray(msg.result?.tools)) msg.result.tools = [...msg.result.tools.filter((t: any) => toolAllowed(t.name, o)), ...WINDOW_TOOLS.filter((t) => toolAllowed(t.name, o))];
		const current = inFlight !== undefined && msg.id !== undefined && msg.id === inFlight.id ? inFlight : undefined;
		// A page that is still loading its fonts makes a screenshot give up after five seconds. Once more does it.
		if (current?.params?.name === "browser_take_screenshot" && msg.result?.isError && !current.again && /Timeout/.test(textOf(msg))) {
			current.again = true;
			return void write({ jsonrpc: current.jsonrpc, id: current.id, method: current.method, params: current.params });
		}
		const closed = current?.params?.name === "browser_close" && !msg.result?.isError;
		if (closed) page = undefined;
		for (const part of msg.result?.content ?? []) if (part.type === "text" && typeof part.text === "string") part.text = inlineFiles(part.text, io.scratch);
		if (msg.result?.content && io.refused.length && msg.result.isError) msg.result.content.push({ type: "text", text: `pine: the browser was refused ${io.refused.at(-1)}` });
		// What a page reached for by itself and did not get, the agent would otherwise only meet as an
		// error of the page's own ("Establishing a tunnel via proxy server failed") and take for something else.
		const reached = current && Array.isArray(msg.result?.content) ? unsaid() : [];
		if (reached.length && !msg.result.isError) {
			msg.result.content.push({
				type: "text",
				text: `pine: the page reached for ${reached.map((a) => `"${a}"`).join(", ")} and the browser's guard refused it: that is on this computer or your owner's network, and nobody allowed it. A yes is for one host and one port, so a page on localhost:3000 does not reach localhost:3001 by it. In the page this shows as a failed request, or for a WebSocket as "Establishing a tunnel via proxy server failed".${o.localFile ? " Serve everything the page needs from the address that is allowed, or open the other address once with browser_navigate so that your owner is asked." : ""}`,
			});
		}
		if (current?.notice && Array.isArray(msg.result?.content)) msg.result.content.unshift({ type: "text", text: current.notice });
		if (!current) return io.send(msg);
		// What the tabs are after the agent's own call is what it has seen. (A closed browser is not asked: asking would open it again.)
		// Without a window the agent has now seen what the owner's hand left: nothing is compared again until it moves.
		if ((!headed && !hosted) || closed) return (seen = undefined), (shared = false), answered(msg);
		void tabsNow().then((tabs) => ((seen = tabs), answered(msg)));
	};

	// ---- the owner's own window ------------------------------------------------------------------

	/** Where the browser is, without waking one that has no page: asking a closed browser would open it. */
	const where = async (error?: string): Promise<ViewState> => {
		const tabs = page === undefined ? undefined : await tabsNow();
		const front = tabs?.tabs[tabs.current];
		if (front && front.url !== "about:blank") page = front.url;
		return { open: page !== undefined, tabs: (tabs?.tabs ?? []).map((t) => ({ title: shown(t.title, 200), url: shown(t.url, 2000) })), current: tabs?.current ?? 0, window: headed, scale: headed || hosted ? 1 : (io.scale ?? 1), ...(hosted ? { hosted: true } : {}), ...(error ? { error: shown(error, 300) } : {}) };
	};
	/** Before the owner's hand moves: what the agent last saw is kept, so that its next call notices. */
	const touch = async () => {
		// (With no page open the agent saw no tab at all: one the owner opens is new to it.)
		if (!headed && !shared) seen = page === undefined ? { tabs: [], current: 0 } : await tabsNow();
		shared = true;
	};
	const failure = (msg: any) => (msg.error || msg.result?.isError ? (textOf(msg).split("\n").find((l) => l.trim() && !l.startsWith("###")) ?? "the browser did not do it").replace(/^Error: /, "") : undefined);
	const shot = `pine-view-${process.pid}.jpeg`;
	const view: BrowserView = {
		embed: (on) => void (embedded = on),
		state: () => between(() => where()),
		// Looking takes no turn: the picture is taken while the agent or the owner's hand is busy (a click waits
		// for the page to settle), so that what they do is seen as it happens. Not beside a call that may end the
		// page; one of those that comes meanwhile waits for the picture (next).
		frame: () =>
			(framing ??= (async () => {
				if (page === undefined || (inFlight !== undefined && ends(inFlight))) return undefined;
				// In the device's pixels: the browser draws io.scale of them for a point (VIEW_SCALE). With a window,
				// in the page's points, which ViewState.scale says.
				const msg = await ask("tools/call", { name: "browser_take_screenshot", arguments: { type: "jpeg", filename: shot, scale: headed || hosted ? "css" : "device" } }, 10_000);
				// The file's path, /… or, on Windows, C:\….
				const file = failure(msg) ? undefined : textOf(msg).match(/\]\(((?:\/|[A-Za-z]:[\\/])[^)\s#]+)\)/)?.[1];
				if (!file) return undefined;
				try {
					// Only a picture this server asked for, where it asked for it.
					const real = fs.realpathSync(file);
					return real.startsWith(fs.realpathSync(io.scratch) + path.sep) && path.basename(real) === shot ? fs.readFileSync(real) : undefined;
				} catch {
					return undefined;
				}
			})().finally(() => (framing = undefined))),
		input: (given) =>
			between(async () => {
				// The app's own browser has the panel's size already: nothing is laid out for a picture.
				const ops = cleanOps(given).filter((op) => !(hosted && op.do === "size"));
				if (page === undefined || !ops.length) return where();
				// Looking is not touching: the pointer over the page, the wheel and the size of the room leave the agent's page where it was.
				if (ops.some((op) => !["move", "wheel", "size"].includes(op.do))) await touch();
				let error: string | undefined;
				const tool = async (name: string, args: unknown, ms = 10_000) => void (error = failure(await ask("tools/call", { name, arguments: args }, ms)) ?? error);
				// In the order they were done. The wheel and the pointer move often and change no page; a click, a key
				// and plain letters are what the owner does most. They go the short way, Playwright's own tools with the
				// values cleanOps let through, which do not wait for the page to settle (half a second after each, and
				// longer while it loads): the owner sees the page answer in the pictures, and the next key is not held up.
				// The rest (a double click, a drag, Enter, other letters, going back, the size) goes together, as values
				// into code that is this server's own and fixed.
				let hand: ViewOp[] = [];
				const done = async () => {
					if (hand.length) await tool("browser_run_code_unsafe", { code: OWNER_HAND.replace("__OPS__", () => literal(hand)) }, 40_000);
					hand = [];
				};
				for (const op of ops) {
					const short = (op.do === "click" && op.count === 1) || (op.do === "key" && op.key !== "Enter") || (op.do === "text" && KEYS.test(op.text));
					if (!short && op.do !== "wheel" && op.do !== "move" && op.do !== "tab" && op.do !== "newtab" && op.do !== "closetab") {
						hand.push(op);
						continue;
					}
					await done();
					if (op.do === "click") {
						await tool("browser_mouse_move_xy", { x: op.x, y: op.y });
						await tool("browser_mouse_down", { button: op.button });
						await tool("browser_mouse_up", { button: op.button });
					} else if (op.do === "key") await tool("browser_press_key", { key: op.key });
					// (A character is a key name only alone: "+" by itself is the key "+".)
					else if (op.do === "text") for (const c of op.text) await tool("browser_press_key", { key: c });
					else if (op.do === "wheel") await tool("browser_mouse_wheel", { deltaX: op.dx, deltaY: op.dy });
					else if (op.do === "move") await tool("browser_mouse_move_xy", { x: op.x, y: op.y });
					else if (op.do === "newtab") await tool("browser_tabs", { action: "new" });
					else if (op.do === "closetab" && ((await tabsNow())?.tabs.length ?? 0) <= 1) {
						// The last tab is emptied and not closed: a browser without a tab would open one again by
						// itself. The browser stays up with its logins, and there is no page any more.
						const before = error;
						await tool("browser_navigate", { url: "about:blank" }, 20_000);
						if (error === before) page = undefined;
					} else await tool("browser_tabs", { action: op.do === "tab" ? "select" : "close", index: op.index });
				}
				await done();
				return where(error);
			}),
		open: (address) =>
			between(async () => {
				const url = webAddress(address);
				if (!url) return where("That is no web address.");
				await touch();
				const msg = await ask("tools/call", { name: "browser_navigate", arguments: { url } }, 60_000);
				const error = failure(msg);
				return where(error && io.refused.length ? `the browser was refused ${io.refused.at(-1)}` : error);
			}),
	};

	/**
	 * The browser becomes the app's own (a host), or the one this server starts when the app is gone. Between two
	 * calls, like anything this server does itself. The page that was open is opened again there, and the logins go
	 * along where the browser that is left still answers (an app that quit does not).
	 */
	const move = (host: string | undefined) =>
		between(async () => {
			if (host === hosted) return;
			const at = page;
			const state = path.join(io.scratch, `state-${process.pid}-${Date.now()}.json`);
			try {
				const kept = at !== undefined && !failure(await ask("tools/call", { name: "browser_storage_state", arguments: { filename: state } }, 5000));
				await restart(false, host);
				page = undefined;
				if (kept) await ask("tools/call", { name: "browser_set_storage_state", arguments: { filename: state } }, 10_000);
				if (at !== undefined && !failure(await ask("tools/call", { name: "browser_navigate", arguments: { url: at } }, 60_000))) page = at;
				// The app's browser is the owner's too: from now on the agent is told when it was moved there.
				seen = host && page !== undefined ? await tabsNow() : undefined;
				shared = false;
			} finally {
				fs.rmSync(state, { force: true });
			}
		});
	if (io.host) {
		let moving = false;
		const look = async () => {
			if (moving) return;
			const want = await io.host!();
			if (want === hosted) return;
			moving = true;
			await move(want).catch(() => {});
			moving = false;
		};
		void look();
		setInterval(() => void look(), 2000).unref();
	}

	return {
		view,
		child: () => child,
		close: () => child.stdin!.end(),
		line(line: string) {
			if (!line.trim()) return;
			let msg: any;
			try {
				msg = JSON.parse(line);
			} catch {
				return void child.stdin!.write(`${line}\n`);
			}
			if (msg.method === "initialize") hello = msg;
			if (msg.method === "tools/list") listIds.add(msg.id);
			if (msg.method === "tools/call" && !toolAllowed(String(msg.params?.name), o)) {
				return io.send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `The tool ${msg.params?.name} is not available.` }], isError: true } });
			}
			if (msg.method === "tools/call" && msg.id !== undefined) {
				waiting.push(msg);
				return next();
			}
			write(msg);
		},
	};
}

/**
 * Where the Pine app's own browser is, as the daemon wrote it into `file` while the app says so, and if it answers:
 * an address on the loopback with the word to say. Nothing when the app is gone or says nothing any more.
 */
export async function appBrowser(file: string): Promise<string | undefined> {
	let url: string;
	try {
		const said = JSON.parse(fs.readFileSync(file, "utf8"));
		if (typeof said.url !== "string" || !/^ws:\/\/127\.0\.0\.1:\d{1,5}\/[0-9a-f]{64}$/.test(said.url) || !(Number(said.until) > Date.now())) return undefined;
		url = said.url;
	} catch {
		return undefined;
	}
	const port = Number(new URL(url).port);
	const answers = await new Promise<boolean>((resolve) => {
		const socket = net.connect(port, "127.0.0.1");
		const done = (yes: boolean) => (socket.destroy(), resolve(yes));
		socket.setTimeout(1000, () => done(false));
		socket.once("connect", () => done(true));
		socket.once("error", () => done(false));
	});
	return answers ? url : undefined;
}

if (import.meta.main) {
	const o = options<BrowserOptions>();
	const cli = path.join(path.dirname(createRequire(import.meta.url).resolve("@playwright/mcp")), "cli.js");
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pine-browser-"));
	const proxy = await startGuardProxy(o, (line) => process.stderr.write(`[pine browser] ${line}\n`));
	const caps = [...new Set(["storage", "vision", ...(o.caps ?? "").split(",").map((c) => c.trim()).filter(Boolean)])].join(",");
	// Playwright's server takes switches for the browser from a configuration file only.
	const sealed = path.join(scratch, "pine-browser.json");
	fs.writeFileSync(sealed, JSON.stringify({ browser: { launchOptions: { args: NO_WAY_AROUND } } }));
	// Without a window, where the owner's own window may show the browser, it draws VIEW_SCALE pixels for a point
	// (a window keeps the screen's own, and Playwright takes no scale for a window that is as large as it is).
	const scale = o.viewFile && o.window ? VIEW_SCALE : 1;
	const dense = path.join(scratch, "pine-browser-dense.json");
	fs.writeFileSync(dense, JSON.stringify({ browser: { launchOptions: { args: NO_WAY_AROUND }, contextOptions: { deviceScaleFactor: scale } } }));
	const args = (headed: boolean, host?: string) => [
		cli,
		"--config", headed ? sealed : dense,
		"--output-dir", scratch,
		"--ignore-roots",
		"--file-paths", "absolute",
		"--block-service-workers",
		// Tools that a page declares are outside content with a name; none of them is offered.
		"--no-webmcp",
		"--image-responses", o.images === false ? "omit" : "allow",
		"--caps", caps,
		...(o.extraArgs ?? []),
		// The app's browser: its tabs of this conversation, which the app puts behind this server's guard (the proxy's port goes along).
		...(host ? ["--cdp-endpoint", `${host}/${encodeURIComponent(o.room!)}?proxy=${proxy.port}`] : own(headed)),
	];
	const own = (headed: boolean) => [
		"--proxy-server", `http://127.0.0.1:${proxy.port}`,
		...(headed ? [] : ["--headless"]),
		...(o.profile ? ["--user-data-dir", o.profile] : ["--isolated"]),
		// Playwright's own Chromium build by default; "chrome" or "msedge" use an installed browser.
		"--browser", o.browser ?? "chromium",
		...(o.executablePath ? ["--executable-path", o.executablePath] : []),
		...(o.viewport ? ["--viewport-size", o.viewport] : []),
	];
	let door: { close(): void } | undefined;
	const stop = () => {
		door?.close();
		server.child().kill();
		fs.rmSync(scratch, { recursive: true, force: true });
		process.exit(0);
	};
	const server = relay(o, {
		launch: (headed, host) => spawn(process.execPath, args(headed, host), { cwd: scratch, stdio: ["pipe", "pipe", "inherit"] }),
		send: (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`),
		scratch,
		refused: proxy.refused,
		ended: () => stop(),
		scale,
		host: o.hostFile && o.room && o.window && o.viewFile ? () => appBrowser(o.hostFile!) : undefined,
	});
	process.on("SIGTERM", stop);
	process.on("SIGINT", stop);
	if (o.viewFile && o.window) door = await startViewDoor(server.view, o.viewFile).catch(() => undefined);
	onLines(process.stdin, (line) => server.line(line), () => server.close());
}
