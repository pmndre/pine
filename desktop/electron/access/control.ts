// Browser access as the app holds it: the owner's preferences (on or off, the meeting service's
// address, open at login), the file of the host key and the paired devices, the access host while
// it is on, the pairing that is open and the question to the owner, all read by the page as one
// state and changed by its calls. No Electron here, so that the tests drive it without a window:
// the app's main process hands it the keychain as the cipher, its notifications, the login item
// and the daemon of this computer.
import path from "node:path";
import { computerWord, OFFICIAL_SERVICE } from "../../src/machines.ts";
import { ACCESS_FILE, type AccessHost, type AccessHostOptions, type Cipher, fileVault, type HostStatus, startAccessHost } from "./host.ts";
import { createPairing, type Pairing, type PairingRequest } from "./pairing.ts";
import net from "node:net";
import { type PeerPath, type RelayServer, type RelayTry, tryRelay } from "./peer.ts";
import { AccessStore, type Device } from "./store.ts";

/**
 * The owner's choices, kept in the app's preferences. No `service`: the official one. `relay`: the
 * address and user name of the owner's relay (TURN) server; its password is never here, but in the
 * sealed file with the host key.
 */
export interface AccessPrefs {
	enabled: boolean;
	/** Announced on the local network while browser access is on, so that a phone finds it (ADR 0005). Left out: on. */
	visible?: boolean;
	service?: string;
	openAtLogin: boolean;
	relay?: { address: string; username: string };
}

/** The longest address taken. */
const ADDRESS_LENGTH = 200;
/** The longest user name and password of a relay taken. */
const CREDENTIAL_LENGTH = 200;

const RELAY_FORM = "Write the relay's address as turn:host:port, for example turn:relay.example.com:3478. The user name and password go in their own fields.";

/**
 * A relay server's address as the owner wrote it, checked: `turn:`, a host name or an IP address
 * (IPv6 in brackets), a port (3478 when none is written), and `?transport=udp` and nothing else.
 * TURN over TCP or TLS (`turns:`, `?transport=tcp`) is refused: the library pine connects with
 * (node-datachannel on libjuice) skips such a server without a word. The address as it is kept,
 * and what the library is handed.
 */
export function relayAddress(value: string): { address: string; hostname: string; port: number } {
	const text = value.trim();
	const match = text.length <= ADDRESS_LENGTH ? /^(turns?):(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+)(?::(\d{1,5}))?(?:\?transport=(udp|tcp))?$/.exec(text) : null;
	if (!match) throw new Error(RELAY_FORM);
	const [, scheme, host, portText, transport] = match;
	const hostname = host.startsWith("[") ? host.slice(1, -1) : host;
	if (host.startsWith("[") && !net.isIPv6(hostname)) throw new Error(RELAY_FORM);
	if (!host.startsWith("[") && (!/[A-Za-z0-9]/.test(hostname) || hostname.startsWith(".") || hostname.startsWith("-"))) throw new Error(RELAY_FORM);
	const port = portText ? Number(portText) : 3478;
	if (port < 1 || port > 65535) throw new Error(RELAY_FORM);
	if (scheme === "turns" || transport === "tcp") throw new Error(`Browser access can only use turn: over UDP today, not TCP or TLS: write the relay's UDP address instead, for example turn:${host}:3478, without ?transport=tcp.`);
	return { address: `turn:${host}:${port}${transport ? `?transport=${transport}` : ""}`, hostname, port };
}

/** A relay's user name as kept: plain text, short. */
const relayUser = (value: unknown) => (typeof value === "string" ? value.replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, CREDENTIAL_LENGTH) : "");

/** A meeting service's address as the owner wrote it, checked: `http(s)`, a host, no name or password. Its origin. */
export function serviceAddress(value: string): string {
	const text = value.trim();
	let url: URL;
	try {
		if (text.length > ADDRESS_LENGTH) throw new Error("too long");
		url = new URL(text);
	} catch {
		throw new Error("Write the address of the service as it opens in a browser, starting with https://");
	}
	if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname || url.username || url.password) throw new Error("Write the address of the service as it opens in a browser, starting with https://");
	return url.origin;
}

/** The preferences as prefs.json keeps them: what is not one of them is left out. Off by default. */
export function readAccessPrefs(raw: unknown): AccessPrefs {
	const said = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	let service: string | undefined;
	try {
		service = typeof said.service === "string" && said.service ? serviceAddress(said.service) : undefined;
	} catch {
		// an address that is not one is not used
	}
	let relay: AccessPrefs["relay"];
	const kept = said.relay && typeof said.relay === "object" ? (said.relay as Record<string, unknown>) : undefined;
	try {
		if (kept && typeof kept.address === "string") relay = { address: relayAddress(kept.address).address, username: relayUser(kept.username) };
	} catch {
		// nor a relay's
	}
	return { enabled: said.enabled === true, ...(said.visible === false ? { visible: false } : {}), service, openAtLogin: said.openAtLogin === true, ...(relay ? { relay } : {}) };
}

/** A paired device as the page shows it. `connected`: it is connected now, by this kind of path (unknown while the path is being chosen). */
export interface AccessDevice {
	id: string;
	name: string;
	paired: string;
	seen?: string;
	connected?: { path?: PeerPath };
}

/**
 * Why browser access cannot be on: `keychain`, the system's keychain cannot encrypt the host key
 * here; `address`, no service address is known; `replaced`, another copy of this computer's key waits
 * at the service; `failed`, the host could not start (`message` says why).
 */
export interface AccessProblem {
	kind: "keychain" | "address" | "replaced" | "failed";
	message: string;
}

/** What the page reads: the contract's state, and `problem` when there is one. */
export interface AccessState {
	enabled: boolean;
	/** "Visible on this network": announced there while browser access is on, and codeless requests let in. */
	visible: boolean;
	/** Visibility is suspended after too many refusals, until then (an ISO date). */
	paused?: string;
	/** The address in use: the owner's, or the official one (empty while there is none). */
	service: string;
	openAtLogin: boolean;
	/** `off` while no host runs; `waiting` at the meeting service; `unreachable` otherwise (also while it first connects). */
	status: "off" | "waiting" | "unreachable";
	devices: AccessDevice[];
	/** The open pairing: the link the QR code encodes, and when it stops working (an ISO date). */
	pairing?: { link: string; expires: string };
	/** The question to the owner: the device's name and the four digits its screen shows. */
	request?: PairingRequest;
	problem?: AccessProblem;
	/** The owner's relay server: its address and user name, whether a password is kept (never the password), and what its last try found. */
	relay?: AccessRelay;
}

/**
 * The relay as the page reads it. `check`: the try made when it was saved; `trying` while it runs,
 * `usable` when the relay gave this computer an address, `failed` otherwise, with the reason in
 * `message`. A relay that failed is kept all the same.
 */
export interface AccessRelay {
	address: string;
	username: string;
	password: boolean;
	check?: { result: "trying" | "usable" | "failed"; message: string };
}

/**
 * A change the page asks for. `service`: an address, or empty for the official one. `relay`: an
 * address, a user name and a password; an empty address removes the relay and its password, and an
 * empty password keeps the one that is kept for the same address and user name, and forgets it for
 * another.
 */
export interface AccessChange {
	enabled?: boolean;
	/** On: also ends a suspension after too many refusals. */
	visible?: boolean;
	service?: string;
	openAtLogin?: boolean;
	relay?: { address: string; username?: string; password?: string };
}

/**
 * What this computer announces on the local network (Bonjour, `_pine._tcp`): its machine id and the
 * meeting service a device joins it at. Nothing else: its name is told only over the connection.
 */
export interface Announcement {
	id: string;
	service: string;
	/** A random word that changes every few minutes (`NONCE_MS`): a codeless request names it, so only a device that hears the announcement can ask. */
	nonce: string;
}

/** How often the announcement's nonce changes while it is announced. The one before keeps working until the next change. */
export const NONCE_MS = 5 * 60_000;

/** The access host as the control drives it. `opened` is the stand-in's alone: it tells a stand-in phone the link. */
export type Host = AccessHost & { opened?(link: string): void };

export interface AccessControlOptions {
	/** The app's data folder: the file of browser access lies there. */
	folder: string;
	/** The keychain's encryption, or undefined where it cannot be used. */
	cipher: () => Cipher | undefined;
	prefs: { read(): AccessPrefs; write(prefs: AccessPrefs): void };
	/** The address used when the owner named none (`OFFICIAL_SERVICE`). */
	official?: string;
	/** This computer's daemon, as the app's own window gets it: `pine service`'s line. */
	daemon: () => Promise<string>;
	/** Sets or clears the app's login item. */
	loginItem: (open: boolean) => void;
	/** A device was added (the app's notification). Not called for a device that connects again. */
	paired: (device: Device) => void;
	/** The state changed. */
	changed: (state: AccessState) => void;
	/** The name a paired browser stores for this computer. */
	computerName?: () => string;
	/** Starts the access host (`startAccessHost`; a test's stand-in). */
	start?: (options: AccessHostOptions) => Promise<Host>;
	/** Tries a relay when it is saved (`tryRelay`). */
	tryRelay?: (relay: RelayServer) => Promise<RelayTry>;
	/** Announces this computer on the local network, or with none stops (the app's Bonjour). Called when what is announced changes. */
	announce?: (what: Announcement | undefined) => void;
	/** How often the nonce changes (`NONCE_MS`; a test's own). */
	nonceMs?: number;
	/** The owner is asked about a device (the app's notification while it is in the background). */
	asked?: (request: PairingRequest) => void;
}

export interface AccessControl {
	state(): Promise<AccessState>;
	set(change: AccessChange): Promise<AccessState>;
	/** Opens a pairing (closing the one that was open): the link, and when it stops working. */
	openPairing(): Promise<{ link: string; expires: string }>;
	cancelPairing(): Promise<void>;
	/** The owner's answer to the question about a device. */
	answer(yes: boolean, id?: string): Promise<void>;
	remove(id: string): Promise<boolean>;
	/** At the app's start: the host starts when browser access was left on. */
	start(): Promise<void>;
	/** At the app's end: the host stops. */
	stop(): Promise<void>;
}

// The page shows these as they are: they name this computer as the page does ("this Mac" on macOS).
const COMPUTER = computerWord(process.platform);
const NO_KEYCHAIN = `This ${COMPUTER}'s keychain cannot be used here, and browser access keeps this ${COMPUTER}'s key encrypted by it: browser access cannot be turned on.`;
const NO_ADDRESS = "Browser access needs the address of the service a browser opens: write the address of your own deployment of pine's web client.";
const REPLACED = `Another copy of Pine with this ${COMPUTER}'s key waits at the service now, so this one stopped. Turn browser access off and on again to wait here.`;

/** What a try of the relay found, said under its field. Nothing here repeats the user name or the password. */
const TRIED: Record<RelayTry | "trying", { result: "trying" | "usable" | "failed"; message: string }> = {
	trying: { result: "trying", message: "Trying the relay..." },
	usable: { result: "usable", message: `This relay works: it gave this ${COMPUTER} an address.` },
	refused: { result: "failed", message: "Could not use this relay: it refused the user name or password. It is kept; check them and save again." },
	silent: { result: "failed", message: "Could not use this relay: it did not answer. It is kept and used when it answers; check the address and that the server is running." },
	unknown: { result: "failed", message: "Could not use this relay: no server was found under that name. It is kept; check the address." },
	unavailable: { result: "failed", message: "Could not try this relay: browser access cannot connect on this system." },
};

/** The relay of the preferences as the host is handed it, without its password. */
const relayOf = (prefs: AccessPrefs): Omit<RelayServer, "password"> | undefined => {
	if (!prefs.relay) return undefined;
	const { hostname, port } = relayAddress(prefs.relay.address);
	return { hostname, port, username: prefs.relay.username };
};

export function createAccessControl(options: AccessControlOptions): AccessControl {
	const official = options.official ?? OFFICIAL_SERVICE;
	const file = path.join(options.folder, ACCESS_FILE.sealed);
	const startHost = options.start ?? startAccessHost;

	let host: Host | undefined;
	let pairing: Pairing | undefined;
	let asking: { request: PairingRequest; resolve: (yes: boolean) => void } | undefined;
	let failure: AccessProblem | undefined;
	/** What the last try of the relay found, and how many were started (the last one's result is the one shown). */
	let check: AccessRelay["check"];
	let tries = 0;
	let expiry: ReturnType<typeof setTimeout> | undefined;
	/** The end of a suspension of visibility, when the announcement comes back. */
	let pauseEnd: ReturnType<typeof setTimeout> | undefined;
	/** The nonce's change, every `NONCE_MS` while the host runs: each one is announced anew. */
	let rotation: ReturnType<typeof setInterval> | undefined;
	/** What is announced now, as a key: announced again only when it changes. */
	let announced = "";
	/** Starting and stopping the host, one after the other. */
	let queue: Promise<unknown> = Promise.resolve();
	const serial = <T>(work: () => Promise<T>): Promise<T> => {
		const next = queue.then(work, work);
		queue = next.catch(() => {});
		return next;
	};

	let scheduled = false;
	// The state is read asynchronously: a read that started earlier can end later, and the page would
	// be told a state that has passed ("cannot reach the service" after "waiting"). Only the newest read is sent.
	let newest = 0;
	const emit = () => {
		if (scheduled) return;
		scheduled = true;
		setImmediate(() => {
			scheduled = false;
			announce();
			const mine = ++newest;
			void state().then((s) => {
				if (mine === newest) options.changed(s);
			}, () => {});
		});
	};

	const visibleOf = (prefs: AccessPrefs) => prefs.visible !== false;

	/** Announced while the host waits at the service, browser access and visibility are on, and no suspension holds. */
	function announce(): void {
		const prefs = options.prefs.read();
		let what: Announcement | undefined;
		if (host && prefs.enabled && visibleOf(prefs) && host.status() === "waiting" && !pairing?.suspendedUntil()) what = { id: host.store.machineId(), service: serviceOf(prefs), nonce: pairing!.nearbyNonce() };
		const key = what ? `${what.id} ${what.service} ${what.nonce}` : "";
		if (key === announced) return;
		announced = key;
		try {
			options.announce?.(what);
		} catch {
			// The network's announcement is a convenience: the code and the link work without it.
		}
	}

	const serviceOf = (prefs: AccessPrefs) => prefs.service ?? official;

	/** What keeps browser access from being turned on, whatever the owner chose. */
	const blocked = (prefs: AccessPrefs): AccessProblem | undefined => {
		if (!options.cipher()) return { kind: "keychain", message: NO_KEYCHAIN };
		if (!serviceOf(prefs)) return { kind: "address", message: NO_ADDRESS };
		return undefined;
	};

	/** The kept devices while no host runs: read from the file when there is one; none is made. */
	async function kept(): Promise<AccessStore | undefined> {
		const cipher = options.cipher();
		if (!cipher) return undefined;
		const vault = fileVault(file, cipher);
		// Read and decrypted once: the store opens on what was read, and still saves to the file.
		const text = await vault.load();
		if (text === undefined) return undefined;
		return AccessStore.open({ load: async () => text, save: (next) => vault.save(next) });
	}

	async function state(): Promise<AccessState> {
		const prefs = options.prefs.read();
		let devices: Device[] = [];
		let password = false;
		try {
			const store = host ? host.store : await kept();
			devices = store?.devices() ?? [];
			password = Boolean(store?.relayPassword());
		} catch {
			// a file that cannot be read shows no devices; starting the host says why
		}
		const relay: AccessRelay | undefined = prefs.relay && { address: prefs.relay.address, username: prefs.relay.username, password, ...(check ? { check: { ...check } } : {}) };
		const live = new Map((host?.connected() ?? []).map((c) => [c.id, c.path]));
		const status = host?.status();
		const problem = blocked(prefs) ?? (status === "replaced" ? { kind: "replaced" as const, message: REPLACED } : failure);
		const opened = pairing?.current();
		const paused = pairing?.suspendedUntil();
		return {
			enabled: prefs.enabled,
			visible: visibleOf(prefs),
			...(paused ? { paused: paused.toISOString() } : {}),
			service: serviceOf(prefs),
			openAtLogin: prefs.openAtLogin,
			status: !host ? "off" : status === "waiting" ? "waiting" : "unreachable",
			devices: devices.map((d) => ({ id: d.id, name: d.name, paired: d.paired, ...(d.seen ? { seen: d.seen } : {}), ...(live.has(d.id) ? { connected: { path: live.get(d.id) } } : {}) })),
			...(opened ? { pairing: { link: opened.link, expires: opened.expires.toISOString() } } : {}),
			...(asking ? { request: { ...asking.request } } : {}),
			...(problem ? { problem } : {}),
			...(relay ? { relay } : {}),
		};
	}

	/**
	 * Keeps the relay's password in the sealed file, or forgets it: while no host runs, so that the
	 * host's own copy of the file is not written over. A file is made for it if there is none.
	 */
	async function keepPassword(password: string | undefined): Promise<void> {
		const cipher = options.cipher();
		if (!cipher) throw new Error(NO_KEYCHAIN);
		if (!password && !(await kept())) return;
		const store = await AccessStore.open(fileVault(file, cipher));
		await store.setRelayPassword(password);
	}

	/** Tries the relay of the preferences, and says the result in the state. A newer save makes an older try's result moot. */
	async function tryKept(prefs: AccessPrefs): Promise<void> {
		const mine = ++tries;
		const server = relayOf(prefs);
		if (!server) {
			check = undefined;
			return emit();
		}
		check = TRIED.trying;
		emit();
		let found: RelayTry;
		try {
			const password = (await kept())?.relayPassword() ?? "";
			found = await (options.tryRelay ?? tryRelay)({ ...server, password });
		} catch {
			found = "unavailable";
		}
		if (mine !== tries) return;
		check = TRIED[found] ?? TRIED.unavailable;
		emit();
	}

	/** The owner is asked about a device: the question stands until answered or withdrawn. */
	const ask = (request: PairingRequest, signal: AbortSignal) =>
		new Promise<boolean>((resolve) => {
			const mine = { request: { id: request.id, name: request.name, code: request.code, ...(request.kind ? { kind: request.kind } : {}) }, resolve };
			asking = mine;
			options.asked?.({ ...mine.request });
			signal.addEventListener(
				"abort",
				() => {
					if (asking === mine) asking = undefined;
					resolve(false);
					emit();
				},
				{ once: true },
			);
			emit();
		});

	async function up(prefs: AccessPrefs): Promise<void> {
		if (host || !prefs.enabled || blocked(prefs)) return;
		failure = undefined;
		try {
			host = await startHost({
				service: serviceOf(prefs),
				vault: fileVault(file, options.cipher()!),
				relay: relayOf(prefs),
				daemon: options.daemon,
				admit: ({ store, service, cut }) =>
					(pairing = createPairing({
						store,
						service,
						cut,
						ask,
						computerName: options.computerName,
						// Read at each request: turning visibility off shuts the door at once, whatever was announced.
						nearby: () => {
							const now = options.prefs.read();
							return now.enabled && visibleOf(now);
						},
						suspended: (until) => {
							clearTimeout(pauseEnd);
							// The announcement comes back by itself when the hour is over.
							pauseEnd = setTimeout(emit, Math.max(0, until.getTime() - Date.now()) + 50);
							emit();
						},
						paired: (device) => {
							options.paired(device);
							emit();
						},
					})).admit,
				onStatus: (_status: HostStatus) => emit(),
				report: () => emit(),
			});
			clearInterval(rotation);
			rotation = setInterval(() => {
				pairing?.rotateNearbyNonce();
				emit();
			}, options.nonceMs ?? NONCE_MS);
		} catch (e) {
			failure = { kind: "failed", message: `Browser access could not start: ${e instanceof Error ? e.message : String(e)}` };
		}
		emit();
	}

	async function down(): Promise<void> {
		clearInterval(rotation);
		clearTimeout(expiry);
		clearTimeout(pauseEnd);
		pairing?.cancel();
		pairing = undefined;
		asking = undefined;
		const was = host;
		host = undefined;
		await was?.stop();
		emit();
	}

	return {
		state,
		async set(change) {
			const prefs = { ...options.prefs.read() };
			if (change.service !== undefined) prefs.service = String(change.service).trim() ? serviceAddress(String(change.service)) : undefined;
			if (typeof change.enabled === "boolean") prefs.enabled = change.enabled;
			if (typeof change.visible === "boolean") {
				if (change.visible) delete prefs.visible;
				else prefs.visible = false;
			}
			if (prefs.enabled && change.enabled === true) {
				const problem = blocked(prefs);
				if (problem) throw new Error(problem.message);
			}
			const moved = serviceOf(prefs) !== serviceOf(options.prefs.read());
			// The relay: checked before anything is written. An empty address removes it, and its password with it.
			let password: { keep: true } | { set: string | undefined } = { keep: true };
			if (change.relay !== undefined) {
				const address = String(change.relay.address ?? "").trim();
				if (address) {
					prefs.relay = { address: relayAddress(address).address, username: relayUser(change.relay.username) };
					const given = typeof change.relay.password === "string" ? change.relay.password.slice(0, CREDENTIAL_LENGTH) : "";
					const before = relayOf(options.prefs.read());
					const now = relayOf(prefs)!;
					const same = before !== undefined && before.hostname === now.hostname && before.port === now.port && before.username === now.username;
					// A kept password is the one relay's it was given for: another server, port or user
					// name saved without one is saved without a password, never with the old one.
					if (given) password = { set: given };
					else if (!same) password = { set: undefined };
				} else {
					delete prefs.relay;
					password = { set: undefined };
				}
				if (!options.cipher()) throw new Error(NO_KEYCHAIN);
			}
			// Set every time it is asked: the owner may have taken the item out in the system's settings.
			if (typeof change.openAtLogin === "boolean") {
				options.loginItem(change.openAtLogin);
				prefs.openAtLogin = change.openAtLogin;
			}
			await serial(async () => {
				// A new relay means a new host, with the new servers; the devices stay as they are.
				if (change.relay !== undefined) {
					if (host) await down();
					try {
						if ("set" in password) await keepPassword(password.set);
					} catch (e) {
						// Nothing was changed: the host comes back as it was.
						await up(options.prefs.read());
						throw new Error(`The relay's password could not be kept, so nothing was changed: ${e instanceof Error && e.message === NO_KEYCHAIN ? NO_KEYCHAIN : "the password file could not be written. Try again."}`);
					}
				}
				options.prefs.write(prefs);
				// Turned on by the owner: a suspension after refusals ends now.
				if (change.visible === true) {
					pairing?.resume();
					clearTimeout(pauseEnd);
				}
				if (host && (!prefs.enabled || moved)) await down();
				await up(prefs);
			});
			// Not waited for: a relay that is down for a moment is kept all the same, and the try says so.
			if (change.relay !== undefined) void tryKept(prefs);
			emit();
			return state();
		},
		async openPairing() {
			if (!host || !pairing) throw new Error("Turn browser access on first.");
			const opened = pairing.open();
			clearTimeout(expiry);
			// The page is told when the code stops working.
			expiry = setTimeout(emit, Math.max(0, opened.expires.getTime() - Date.now()) + 50);
			host.opened?.(opened.link);
			emit();
			return { link: opened.link, expires: opened.expires.toISOString() };
		},
		async cancelPairing() {
			clearTimeout(expiry);
			pairing?.cancel();
			emit();
		},
		async answer(yes, id) {
			const now = asking;
			if (!now) throw new Error("No device is waiting for an answer now.");
			// The answer is to the question the owner saw: never to another one that took its place meanwhile.
			if (id !== now.request.id) throw new Error("That device is no longer the one asking: look at the question again.");
			asking = undefined;
			now.resolve(yes === true);
			emit();
		},
		async remove(id) {
			let removed: boolean;
			if (host) removed = await host.remove(id);
			else removed = (await (await kept())?.remove(id)) ?? false;
			emit();
			return removed;
		},
		start: () => serial(() => up(options.prefs.read())),
		stop: () => serial(down),
	};
}
