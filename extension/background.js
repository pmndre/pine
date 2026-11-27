// pine in the owner's own browser (Chrome, Brave, Edge and their relatives).
//
// A conversation of pine's gets a tab group here. Its agent works in the tabs of that group and in
// no other: the ones it opened and the ones the owner dragged in. A tab that is dragged out again,
// or whose "Cancel" the owner pressed on Chrome's own bar, is the owner's alone from then on.
//
// This worker decides nothing. It is a pair of hands for pine's host (mcp/chrome.ts), a program
// that Chrome starts by its registered name and nobody else can talk to (native messaging): the
// host says which tab to open, attach to or close, and which command of the DevTools protocol goes
// to which tab; this worker carries it out with chrome.debugger and hands back what came of it.
// It keeps no key, reaches no address by itself and never touches a tab outside pine's groups.

const HOST = "dev.pmndre.pine";
/** What host and extension have to agree on. A host that speaks another is not listened to. */
const PROTOCOL = 1;
const COLOR = "green";

/** The port to pine's host, while there is one. */
let port;
/** The host answered, and speaks this protocol. */
let connected = false;
/** Why there is no connection, in Chrome's own words. */
let why = "";
/** The tabs this worker is attached to: tabId -> the conversation whose group it is in. */
const tabs = new Map();
/** The conversations whose browser is here now: room -> { title }. */
const rooms = new Map();
/** Tabs this worker is putting into a group itself: their move is not the owner's. */
const pending = new Set();
/** Messages of the host that came in pieces: id -> the pieces so far. */
const parts = new Map();

// What outlives this worker while the browser runs: which group is whose, and which tabs pine opened.
let groups = {};
let mine = new Set();
const ready = chrome.storage.session.get(["groups", "mine"]).then((kept) => {
	groups = kept.groups && typeof kept.groups === "object" ? kept.groups : {};
	mine = new Set(Array.isArray(kept.mine) ? kept.mine : []);
});
const save = () => void chrome.storage.session.set({ groups, mine: [...mine] }).catch(() => {});

const text = (e) => {
	const said = e instanceof Error ? e.message : String(e);
	// chrome.debugger says what the protocol said, as JSON.
	try {
		const inner = JSON.parse(said);
		if (typeof inner?.message === "string") return inner.message;
	} catch {}
	return said;
};

function send(message) {
	try {
		port?.postMessage(message);
	} catch {}
}

function brand() {
	const names = (navigator.userAgentData?.brands ?? []).map((b) => b.brand);
	return names.find((n) => !/chromium|not.?a.?brand/i.test(n)) ?? "Chromium";
}

// ---- the connection to pine --------------------------------------------------------------------

function connect() {
	if (port) return;
	let p;
	try {
		p = chrome.runtime.connectNative(HOST);
	} catch (e) {
		why = text(e);
		return;
	}
	port = p;
	p.onMessage.addListener((m) => void fromHost(m));
	p.onDisconnect.addListener(() => {
		const said = chrome.runtime.lastError?.message ?? "";
		if (port !== p) return;
		port = undefined;
		connected = false;
		why = said;
		void releaseAll();
	});
	send({ ev: "hello", protocol: PROTOCOL, version: chrome.runtime.getManifest().version, agent: navigator.userAgent, browser: brand() });
}

async function fromHost(m) {
	if (m?.part) {
		// A message larger than Chrome takes from a host in one piece.
		const { id, i, n, data } = m.part;
		const have = parts.get(id) ?? [];
		have[i] = data;
		parts.set(id, have);
		if (have.filter((x) => x !== undefined).length < n) return;
		parts.delete(id);
		const bytes = Uint8Array.from(atob(have.join("")), (c) => c.charCodeAt(0));
		m = JSON.parse(new TextDecoder().decode(bytes));
	}
	if (m?.ev === "hello") return void hello(m);
	if (!connected || typeof m?.id !== "number") return;
	// In the order they came: a command is handed to the tab before anything is waited for.
	if (m.do === "cdp") return command(m);
	await ready;
	try {
		send({ id: m.id, ...((await request(m)) ?? {}) });
	} catch (e) {
		send({ id: m.id, error: text(e) });
	}
}

async function hello(m) {
	if (m.protocol !== PROTOCOL) {
		why = "This extension and pine are of different versions. Update both.";
		port?.disconnect();
		port = undefined;
		connected = false;
		return;
	}
	connected = true;
	why = "";
	// An extension loaded from pine's own folder: when pine brought a newer one, load it.
	const version = chrome.runtime.getManifest().version;
	if (typeof m.extension !== "string" || m.extension === version) return;
	const self = await chrome.management.getSelf().catch(() => undefined);
	if (self?.installType !== "development") return;
	const { reloaded } = await chrome.storage.local.get("reloaded");
	if (reloaded === m.extension) return;
	await chrome.storage.local.set({ reloaded: m.extension });
	chrome.runtime.reload();
}

/** One command of the DevTools protocol, to a tab of pine's (or a frame or worker inside one). */
function command(m) {
	if (!tabs.has(m.tabId)) return send({ id: m.id, error: "No tab with given id" });
	if (!m.sessionId && m.method === "Input.dispatchMouseEvent") pointer(m.tabId, m.params ?? {});
	chrome.debugger.sendCommand(m.sessionId ? { tabId: m.tabId, sessionId: m.sessionId } : { tabId: m.tabId }, m.method, m.params ?? {}).then(
		(result) => send({ id: m.id, result: result ?? {} }),
		(e) => send({ id: m.id, error: text(e) }),
	);
}

async function request(m) {
	if (m.do === "enter") return { tabs: await enter(String(m.room), String(m.title ?? "pine")) };
	if (m.do === "open") return open(String(m.room), String(m.title ?? "pine"), typeof m.url === "string" ? m.url : "about:blank");
	if (m.do === "close") return close(m.tabId);
	if (m.do === "leave") return leave(String(m.room), m.closeMine === true);
	throw new Error(`unknown request ${m.do}`);
}

// ---- a conversation's group --------------------------------------------------------------------

/** The group of a conversation, if it is still there. */
async function groupOf(room) {
	const id = groups[room];
	if (id === undefined) return undefined;
	try {
		await chrome.tabGroups.get(id);
		return id;
	} catch {
		delete groups[room];
		save();
		return undefined;
	}
}

const roomOfGroup = (groupId) => Object.keys(groups).find((room) => groups[room] === groupId);

/** Attaches to a tab. Nothing when Chrome does not let anybody attach there (its own pages, the web store). */
async function attach(tabId, room) {
	try {
		await chrome.debugger.attach({ tabId }, "1.3");
	} catch (e) {
		if (!/already attached/i.test(text(e))) return undefined;
	}
	try {
		const { targetInfo } = await chrome.debugger.sendCommand({ tabId }, "Target.getTargetInfo");
		tabs.set(tabId, room);
		return targetInfo;
	} catch {
		await chrome.debugger.detach({ tabId }).catch(() => {});
		return undefined;
	}
}

/** A conversation's browser is here from now on: every tab of its group is its agent's. */
async function enter(room, title) {
	rooms.set(room, { title });
	const groupId = await groupOf(room);
	const found = [];
	if (groupId === undefined) return found;
	for (const tab of await chrome.tabs.query({ groupId })) {
		const targetInfo = await attach(tab.id, room);
		if (targetInfo) found.push({ tabId: tab.id, targetInfo });
	}
	return found;
}

/** A new tab in the conversation's group, which is made with its first tab. Never in front: the owner may be typing elsewhere. */
async function open(room, title, url) {
	let groupId = await groupOf(room);
	let windowId;
	if (groupId !== undefined) windowId = (await chrome.tabGroups.get(groupId)).windowId;
	else windowId = (await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => undefined))?.id;
	let tab;
	if (windowId === undefined) {
		// No window at all: the browser runs without one (on a Mac, after the last one was closed).
		const created = await chrome.windows.create({ url: "about:blank", focused: false });
		tab = created.tabs[0];
		windowId = created.id;
	} else tab = await chrome.tabs.create({ windowId, url: "about:blank", active: false });
	pending.add(tab.id);
	try {
		if (groupId === undefined) {
			groupId = await chrome.tabs.group({ tabIds: [tab.id], createProperties: { windowId } });
			await chrome.tabGroups.update(groupId, { title, color: COLOR });
			groups[room] = groupId;
		} else await chrome.tabs.group({ tabIds: [tab.id], groupId });
		mine.add(tab.id);
		save();
		const targetInfo = await attach(tab.id, room);
		if (!targetInfo) throw new Error("the browser did not let pine use the new tab");
		if (url !== "about:blank" && /^https?:/i.test(url)) await chrome.tabs.update(tab.id, { url });
		return { tabId: tab.id, targetInfo };
	} catch (e) {
		mine.delete(tab.id);
		await chrome.tabs.remove(tab.id).catch(() => {});
		throw e;
	} finally {
		pending.delete(tab.id);
	}
}

async function close(tabId) {
	if (!tabs.has(tabId)) throw new Error("No tab with given id");
	tabs.delete(tabId);
	mine.delete(tabId);
	save();
	await chrome.tabs.remove(tabId).catch(() => {});
	return {};
}

/** A conversation's browser is here no longer. Its group stays; the tabs pine opened go if asked. */
async function leave(room, closeMine) {
	rooms.delete(room);
	for (const [tabId, of] of [...tabs]) {
		if (of !== room) continue;
		tabs.delete(tabId);
		await chrome.debugger.detach({ tabId }).catch(() => {});
		if (closeMine && mine.delete(tabId)) await chrome.tabs.remove(tabId).catch(() => {});
	}
	save();
	return {};
}

/** pine is gone: nothing stays attached. The groups and their tabs stay as they are. */
async function releaseAll() {
	rooms.clear();
	for (const tabId of [...tabs.keys()]) {
		tabs.delete(tabId);
		await chrome.debugger.detach({ tabId }).catch(() => {});
	}
}

/** A tab is no longer pine's. */
function gone(tabId) {
	if (!tabs.delete(tabId)) return;
	if (mine.delete(tabId)) save();
	send({ ev: "gone", tabId });
}

chrome.debugger.onEvent.addListener((source, method, params) => {
	if (source.tabId === undefined || !tabs.has(source.tabId)) return;
	send({ ev: "cdp", tabId: source.tabId, ...(source.sessionId ? { sessionId: source.sessionId } : {}), method, params });
});

chrome.debugger.onDetach.addListener((source, reason) => {
	if (source.tabId === undefined || source.sessionId || !tabs.has(source.tabId)) return;
	gone(source.tabId);
	// The owner pressed Cancel on Chrome's bar: the tab is theirs alone again, and says so by leaving the group.
	if (reason === "canceled_by_user") void chrome.tabs.ungroup(source.tabId).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => gone(tabId));

// The owner drags a tab into a conversation's group, or out of it.
chrome.tabs.onUpdated.addListener(async (tabId, change) => {
	if (change.groupId === undefined || pending.has(tabId)) return;
	await ready;
	const room = roomOfGroup(change.groupId);
	const was = tabs.get(tabId);
	if (was !== undefined && was !== room) {
		gone(tabId);
		await chrome.debugger.detach({ tabId }).catch(() => {});
	}
	if (room === undefined || !rooms.has(room) || tabs.has(tabId)) return;
	const targetInfo = await attach(tabId, room);
	if (targetInfo) send({ ev: "joined", room, tabId, targetInfo });
});

chrome.tabGroups.onRemoved.addListener(async (group) => {
	await ready;
	const room = roomOfGroup(group.id);
	if (room === undefined) return;
	delete groups[room];
	save();
});

// ---- the pointer -------------------------------------------------------------------------------

/** Where the agent's pointer is, drawn into the page so that the owner sees what it does. */
function pointer(tabId, p) {
	if (typeof p.x !== "number" || typeof p.y !== "number" || !/^mouse(Moved|Pressed)$/.test(String(p.type))) return;
	chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", func: paint, args: [p.x, p.y, p.type === "mousePressed"] }).catch(() => {});
}

/**
 * Runs in the page, in a world of the extension's own. The pointer is a picture and nothing else:
 * it takes no click, is no part of what the agent reads of the page, and fades when nothing moves.
 */
function paint(x, y, pressed) {
	const SVG = "http://www.w3.org/2000/svg";
	let c = globalThis.pinePointer;
	if (!c || !c.host.isConnected) {
		const host = document.createElement("div");
		host.setAttribute("aria-hidden", "true");
		host.style.cssText = "all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none";
		const root = host.attachShadow({ mode: "closed" });
		const style = document.createElement("style");
		style.textContent =
			".p{position:fixed;left:0;top:0;opacity:0;transition:transform 160ms cubic-bezier(.2,.8,.2,1),opacity 300ms;will-change:transform;pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}" +
			".n{position:absolute;left:14px;top:16px;padding:1px 6px;border-radius:8px;background:#1c7c54;color:#fff;font:600 11px/16px system-ui,sans-serif;white-space:nowrap}" +
			".r{position:fixed;left:0;top:0;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;border:2px solid #1c7c54;opacity:0;pointer-events:none}";
		const el = document.createElement("div");
		el.className = "p";
		const svg = document.createElementNS(SVG, "svg");
		svg.setAttribute("width", "18");
		svg.setAttribute("height", "22");
		svg.setAttribute("viewBox", "0 0 18 22");
		const arrow = document.createElementNS(SVG, "path");
		arrow.setAttribute("d", "M1.5 1.5v16l4.3-3.9 2.9 6.4 2.7-1.2-2.9-6.3h5.9z");
		arrow.setAttribute("fill", "#1c7c54");
		arrow.setAttribute("stroke", "#fff");
		arrow.setAttribute("stroke-width", "1.5");
		arrow.setAttribute("stroke-linejoin", "round");
		svg.append(arrow);
		const name = document.createElement("span");
		name.className = "n";
		name.textContent = "pine";
		el.append(svg, name);
		const ring = document.createElement("div");
		ring.className = "r";
		root.append(style, el, ring);
		document.documentElement.append(host);
		c = globalThis.pinePointer = { host, el, ring, timer: 0 };
	}
	c.el.style.transform = `translate(${x}px,${y}px)`;
	c.el.style.opacity = "1";
	if (pressed) {
		c.ring.style.transform = `translate(${x}px,${y}px)`;
		c.ring.animate([{ opacity: 0.9, scale: "0.3" }, { opacity: 0, scale: "1.4" }], { duration: 420, easing: "ease-out" });
	}
	clearTimeout(c.timer);
	c.timer = setTimeout(() => (c.el.style.opacity = "0"), 5000);
}

// ---- what the popup asks -----------------------------------------------------------------------

chrome.runtime.onMessage.addListener((m, _sender, reply) => {
	if (m?.ask === "connect") connect();
	if (m?.ask !== "state" && m?.ask !== "connect") return;
	void ready.then(async () => {
		const list = [];
		for (const room of Object.keys(groups)) {
			const groupId = await groupOf(room);
			if (groupId === undefined) continue;
			const group = await chrome.tabGroups.get(groupId).catch(() => undefined);
			const inGroup = await chrome.tabs.query({ groupId }).catch(() => []);
			list.push({ title: group?.title || "pine", tabs: inGroup.length, working: rooms.has(room) });
		}
		reply({ connected, why, groups: list });
	});
	return true;
});

// ---- staying connected -------------------------------------------------------------------------

// pine may start after the browser did: look again now and then. An open port keeps this worker awake.
chrome.alarms.create("pine", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => alarm.name === "pine" && connect());
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
