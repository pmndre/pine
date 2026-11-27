// The web bridge: the top-level document's part of the web client, the counterpart of the desktop
// app's main process (desktop/electron/main.ts) and of the mobile app's native plugin. It holds the browser's
// SSH key, the machines and their trusted host keys, the SSH connection and the daemon's token, and
// makes every call to the control API for the page, which asks through serve.ts and never sees
// the token. The browser has no pine of its own (`local: false`).
import { MEDIA } from "../../desktop/electron/daemon.ts";
import type { AppState, Prefs, ServiceState } from "../../desktop/src/bridge.ts";
import { isPaired, PAIRED, YOUR_COMPUTER } from "../../desktop/src/machines.ts";
import { cleanLook, type Look } from "../../desktop/src/theme.ts";
import { FUNNEL_PORTS, isFunnel } from "../relay/src/addresses.ts";
import { CLOSE } from "../relay/src/relay.ts";
import { daemonPath, type BridgeEvent } from "./protocol.ts";
import { REMOTE_COMMAND } from "./remote-command.ts";
import { askToPair, cleanName, deviceName, pairedFingerprint, PAIRED_USER, pairUser, type PairLink } from "./pairing.ts";
import { generateKey, PeerClosed, publicKeyLine, RelayClosed, SshRefused, type Channel, type Connection, type ConnectOptions, type OpenStream } from "./ssh.ts";
import { callDaemon, followEvents, loopbackEnd, mediaOf, runService, ServiceTrouble, type Daemon } from "./tunnel.ts";

/** Where the bridge keeps what it remembers: IndexedDB in a browser (idb-store.ts), a map in the tests. Values are structured-cloned, CryptoKeys included. */
export type Store = {
	get(name: string): Promise<unknown>;
	set(name: string, value: unknown): Promise<void>;
};

export type WebBridgeDeps = {
	/** The SSH core's `connect` (ssh.ts), or a stand-in. */
	connect(options: ConnectOptions): Promise<Connection>;
	store: Store;
	/** The transport to a host and port through the relay: its WebSocket (ssh.ts `relayStream`). */
	relay(host: string, port: number): OpenStream;
	/**
	 * The transport to a paired computer by its machine id: a data channel made through the meeting
	 * service (peer.ts). Its opener throws `PeerClosed` when there is no way to it. None: a paired
	 * computer cannot be reached from this browser, and saying so is all the bridge does.
	 */
	peer?(id: string): OpenStream;
	/** The pairing link the address carried when the document loaded, already taken out of it (pairing.ts `takePairLink`). */
	pairLink?: PairLink;
	/**
	 * On an iPhone or iPad: asks the owner whether the Pine app pairs with the link instead
	 * (app-choice.ts `chooseApp`), and resolves once this browser is to pair. Until then the link's
	 * code is not used. None: this browser pairs at once.
	 */
	choose?(link: PairLink): Promise<void>;
	/** The browser's user agent, of which the paired computer is told this browser's name ("Chrome on Android"). */
	userAgent?: string;
	/**
	 * Reads the deployment's configuration (`GET /meet/config`: `{ice, relay}`). An answer says the
	 * deployment has the meeting service, so a computer can be paired with. `null` (a 404) says it
	 * has none, for good: there is nothing to pair with, and user@host machines can be added. A
	 * failed read (it throws: offline, a 429, a 5xx) says neither, and is read again.
	 */
	config?(): Promise<unknown>;
	/** Puts a text on the clipboard. */
	clipboard(text: string): Promise<void>;
	/** Hands a text to the system's share sheet; none: the clipboard. */
	share?(title: string, text: string): Promise<void>;
	/** The host of this deployment (the document's address), which the page names as the relay's and the meeting service's. */
	serviceHost?: string;
	/** The web client's version. */
	version: string;
	/** Waits between attempts to connect again (the tests make them short); none: a timer. */
	wait?(ms: number): Promise<void>;
	/** How long `pine service` has to say where its daemon answers; none: a minute. */
	serviceMs?: number;
	/** Opens an address of the web in a new tab of the browser, with nothing of this document handed to it (`noopener`). */
	open?(url: string): void;
	/** Hands a text to the browser as a file to save (a download), under that name. */
	save?(name: string, text: string): void;
	/** Opens `pine://pair`, the Pine app on this computer (ADR 0005); none where the browser is not on a computer. */
	openApp?(): void;
};

/** How long to wait before the attempt after the `n`th failed one to connect again: doubling from a second, at most half a minute. */
export const backoff = (n: number) => Math.min(1000 * 2 ** n, 30_000);
/** Failed attempts to connect again before the page is told what is wrong; until then it stays in its conversations, shown as not connected. */
const QUIET_TRIES = 3;
/** Losses of the event stream in a row, with SSH still up, after which pine there is taken for gone and the connection is made again (as desktop/electron/main.ts does). */
const STREAM_LOSSES = 5;
/** Reads of the deployment's configuration before the page is first answered; a configuration still not read is read again at the next state read. */
const CONFIG_TRIES = 3;
/** A read of the configuration that said nothing: it failed, or took too long. */
const UNREAD = Symbol("unread");

/** A picture, video or sound of the daemon's, by its path and query: one of `MEDIA`'s paths, nothing that could be read as another request. */
function mediaTarget(target: string): string {
	const q = target.indexOf("?");
	const path = q < 0 ? target : target.slice(0, q);
	if (!daemonPath(target) || !MEDIA.some((m) => m.test(path))) throw new Error(`That is not a picture, a video or a sound of pine's: ${target.slice(0, 80)}`);
	return target;
}

/** Only pages on the web open, as desktop/electron/main.ts's `openOutside`: a link never starts a program, opens a file or runs a script. */
function webAddress(url: string): string {
	let u: URL | undefined;
	try {
		u = new URL(url);
	} catch {}
	if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) throw new Error(`Only an address of the web (http or https) opens: ${url.slice(0, 80)}`);
	return u.href;
}

/** The last part of a file's name, so that a name never says where the file goes. */
function fileName(name: string): string {
	return (name.split(/[\\/]/).pop() ?? "").replace(/[\0-\x1f\x7f]/g, "").slice(0, 200) || "pine.txt";
}

/** The page's own preferences, as the bridge keeps them. */
type PagePrefs = { notify: boolean; updates: boolean; keepRunning: boolean; questionCards: boolean; look?: Look; storage?: PageStorage };

/**
 * What the page keeps in its Web Storage (the side panel's widths, what is folded), which its
 * opaque origin does not keep across a reload: the page hands all of it over with `prefs`
 * (page-storage.ts) and is given it back with the state. Only the page's own keys, as text.
 */
type PageStorage = Record<string, string>;
const STORAGE_KEY = /^pine\.[A-Za-z0-9._-]{1,80}$/;
const STORAGE_KEYS = 64;
const STORAGE_VALUE = 8192;

/** The page's storage as it may be kept: entries that are not its keys or not text within bounds are left out; too many keys is refused. */
function cleanStorage(value: unknown): PageStorage | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const entries = Object.entries(value).filter(([k, v]) => STORAGE_KEY.test(k) && typeof v === "string" && v.length <= STORAGE_VALUE);
	if (entries.length > STORAGE_KEYS) throw new Error(`The page asked to keep too much: at most ${STORAGE_KEYS} entries.`);
	return Object.fromEntries(entries) as PageStorage;
}
type Kept = { prefs: PagePrefs; hosts: string[]; use?: string; names: Record<string, string> };

const DEFAULTS: PagePrefs = { notify: false, updates: false, keepRunning: false, questionCards: true };
const MAX_HOSTS = 20;
const KEY_COMMENT = "pine-web";

/** A machine as the owner names it: user@host or user@host:port. The host is a name, an IPv4 address or an IPv6 one in brackets. */
export function parseHost(value: string): { user: string; hostname: string; port: number; label: string } {
	const m = /^([A-Za-z0-9_][A-Za-z0-9_.-]{0,31})@([A-Za-z0-9](?:[A-Za-z0-9.-]{0,252})|\[[0-9A-Fa-f:.]{2,45}\])(?::(\d{1,5}))?$/.exec(value);
	const port = m?.[3] ? Number(m[3]) : 22;
	if (!m || port < 1 || port > 65535) throw new Error(`"${value.slice(0, 80)}" is not a machine for this browser. Write it as user@host, or user@host:port.`);
	const hostname = m[2].replace(/^\[|\]$/g, "");
	const label = /^[\d.]+$/.test(hostname) || hostname.includes(":") ? hostname : hostname.split(".")[0];
	return { user: m[1], hostname, port, label };
}

// A paired computer is named in these texts as the owner knows it: by the name it gave when it was
// paired (or the owner's own), and "your computer" before that. The browser cannot tell what kind
// of computer is at the other end, so no text names one.

/** A paired computer's label at the start of a sentence: a name as it was given, "Your computer" for one without. */
const atStart = (label: string) => (label === YOUR_COMPUTER ? "Your computer" : label);

/** What the owner is told when the way to the paired computer `label` cannot be opened. All three may pass by themselves, so the bridge keeps trying. */
function peerTrouble(label: string, reason: PeerClosed["reason"]): string {
	if (reason === "absent") return `${atStart(label)} does not answer: it is off, asleep, or Pine is closed. This browser keeps trying, and connects when ${label} is back.`;
	if (reason === "no-path") return `${atStart(label)} is there, but no direct connection could be made from this network. Try another network (another Wi-Fi, or your phone's data); this browser keeps trying meanwhile.`;
	return "The meeting service is over its limits for now. Try again later; this browser keeps trying meanwhile.";
}
/** The same, while pairing, when no name is known yet: nothing is tried again, since the link is for one use and two minutes. */
const PAIR_TROUBLE: Record<PeerClosed["reason"], string> = {
	absent: "Your computer does not answer: it is off, asleep, or Pine is closed. Open Pine on your computer and add this device again.",
	"no-path": "Your computer is there, but no direct connection could be made from this network. Try another network (another Wi-Fi, or your phone's data), then add this device again at your computer.",
	limits: "The meeting service is over its limits for now. Try again later: add this device again at your computer.",
};
const notKnown = (label: string) => `This browser is no longer known to ${label}. Open Pine on ${label} and add this device again.`;
const PAIR_EXPIRED = "This pairing link has expired or was used already. Open Pine on your computer and add this device again.";
const NO_PEER = "This browser cannot reach a paired computer: this version of the web client has no way to it.";

const NO_MACHINE: ServiceState = {
	status: "error",
	kind: "ssh",
	message: "Add the machine whose pine this browser is to use, as user@host or user@host:port. Put this browser's key into ~/.ssh/authorized_keys there first.",
};
/** The same where user@host machines cannot be added (a deployment whose relay is off): only a computer paired by its code can be used. */
const NO_PAIRED: ServiceState = {
	status: "error",
	kind: "ssh",
	message: "Pair this browser with the Pine app on your computer: on your computer, choose Pine > Add a device, and scan the code it shows.",
};

/** What `pine service` there could not do, in words that say what to do. */
function serviceTrouble(host: string, e: ServiceTrouble): string {
	if (/unknown command "service"/.test(e.stderr)) return `The pine on ${host} is too old to be reached this way: it has no "service" command. Update it there with "pine update", then try again.`;
	if (e.exitStatus === 127) return `pine is not installed on ${host}, or not on the PATH of its login shell. ${e.stderr.trim()}`;
	if (e.message === "timeout") return `pine on ${host} is not answering: "pine service" there said nothing within a minute. Look at what it does there with "pine status", or restart it, then try again.`;
	if (e.message === "ended") return e.stderr.trim() || `The command on ${host} ended (exit ${e.exitStatus ?? "unknown"}) without saying why. Run "pine service" there in a terminal to see what it says, then try again.`;
	return `${host} ${e.message}`;
}

/** What the relay's closing means for the machine, in words that say what to check. Code 0: the WebSocket never opened. */
function relayTrouble(host: string, e: RelayClosed): string {
	const { hostname, port } = parseHost(host);
	// A machine of a tailnet, published by Tailscale Funnel: the relay reaches it through TLS, which Funnel only gives on a port it was turned on for.
	if (isFunnel(hostname) && [0, CLOSE.unreachable, CLOSE.tls].includes(e.code)) {
		const funnel = `tailscale funnel --bg --tls-terminated-tcp=${port} tcp://localhost:22`;
		const ports = `${FUNNEL_PORTS.slice(0, -1).join(", ")} or ${FUNNEL_PORTS.at(-1)}`;
		if (e.code === 0) return `The relay did not open a connection to ${hostname}. A machine of a tailnet is reached through Tailscale Funnel, on port ${ports}: check the port, and that Funnel is on there (${funnel}). Then wait a minute and try again.`;
		return `${hostname} did not answer through Tailscale Funnel on port ${port}. Check that the machine is on and that Funnel is on there for that port: ${funnel}.`;
	}
	if (e.code === 0) return `The relay did not open a connection to ${hostname}. It may be down, or it refused: it reaches only machines with a public address, and allows a browser a few connections a minute. Check the address, wait a minute, and try again.`;
	if (e.code === CLOSE.unreachable) return `${hostname} could not be reached on port ${port}. Check that the machine is on, that SSH listens on that port, and that its firewall lets connections in from the internet.`;
	if (e.code === CLOSE.serverNotSsh) return `${hostname} answers on port ${port}, but not with SSH. Check the port.`;
	if (e.code === CLOSE.timeout) return `${hostname} did not answer with SSH on port ${port} within a few seconds. Check that SSH listens on that port, then try again.`;
	if (e.code === CLOSE.notSsh) return "The relay carries only SSH, and refused what this browser sent. Reload the page and try again.";
	return `The connection to ${host} was closed: ${e.message}`;
}

/** How an attempt to connect ended: ready, a trouble that may pass by itself (the network, the relay, a slow pine), one only the owner can fix, or another attempt took its place. */
type Outcome = "ready" | "passing" | "final" | "superseded";

export function webBridge(deps: WebBridgeDeps) {
	const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const listeners = new Map<BridgeEvent, Set<(value: unknown) => void>>();
	const emit = (event: BridgeEvent, value: unknown) => listeners.get(event)?.forEach((fn) => fn(value));

	let kept: Kept = { prefs: { ...DEFAULTS }, hosts: [], names: {} };
	let hostKeys: Record<string, string> = {};
	// Whether user@host machines can be added: the deployment's configuration says, and a read that fails leaves them.
	let canAddHost = true;
	// Whether a computer can be paired with: the deployment answered its configuration, so it has the meeting service.
	let canPair = false;
	const noMachine = () => (canAddHost ? NO_MACHINE : NO_PAIRED);
	// Whether the configuration said what the deployment has: an answer or a 404 is kept for the visit; a failed read is not.
	let configKnown = !deps.config;
	let loaded: Promise<void> | undefined;
	const load = () =>
		(loaded ??= (async () => {
			const [stored, keys] = (await Promise.all([deps.store.get("prefs"), deps.store.get("hostKeys"), learnConfig(1)])) as [Partial<Kept> | undefined, Record<string, string> | undefined, void];
			const names = stored?.names && typeof stored.names === "object" ? stored.names : {};
			kept = { prefs: { ...DEFAULTS, ...stored?.prefs }, hosts: Array.isArray(stored?.hosts) ? stored.hosts : [], names, ...(stored?.use ? { use: stored.use } : {}) };
			hostKeys = keys ?? {};
			if (deps.pairLink) state = { status: "starting", pairing: {} };
			else if (!kept.use) state = noMachine();
			// Not read: the first answer does not wait for more tries, which go on meanwhile.
			if (!configKnown) relearning = learnConfig(CONFIG_TRIES - 1, true).finally(() => (relearning = undefined));
		})());
	/** The configuration; `UNREAD` when it could not be read within a few seconds, or the read failed. */
	const readConfig = async (): Promise<unknown> => {
		if (!deps.config) return null;
		let timer: Parameters<typeof clearTimeout>[0];
		const late = new Promise<typeof UNREAD>((resolve) => (timer = setTimeout(() => resolve(UNREAD), 5000)));
		try {
			return await Promise.race([deps.config(), late]);
		} catch {
			return UNREAD;
		} finally {
			clearTimeout(timer);
		}
	};
	/**
	 * Reads the configuration, up to `tries` times with a wait between (`waitFirst`: before the
	 * first too), until it says what the deployment has. The first screen follows what it says.
	 */
	const learnConfig = async (tries: number, waitFirst = false) => {
		for (let n = 0; n < tries && !configKnown; n++) {
			if (n > 0 || waitFirst) await wait(backoff(n));
			const config = await readConfig();
			if (config === UNREAD) continue;
			configKnown = true;
			canPair = !!config && typeof config === "object" && !Array.isArray(config);
			canAddHost = !(canPair && (config as { relay?: unknown }).relay === false);
			if (state === NO_MACHINE || state === NO_PAIRED) setState(noMachine());
		}
	};
	// The reads under way after the first one failed; a state read waits for them, or makes one more.
	let relearning: Promise<void> | undefined;
	let answered = false;
	/** A configuration not known yet at a later state read is read again (never for the first answer, which `load` read for). */
	const relearn = async () => {
		if (configKnown || !answered) return;
		await (relearning ??= learnConfig(1).finally(() => (relearning = undefined)));
	};
	const save = () => deps.store.set("prefs", kept);
	const saveKeys = () => deps.store.set("hostKeys", hostKeys);
	const prefsOut = (): Prefs => ({ ...kept.prefs, hosts: [...kept.hosts], names: { ...kept.names }, ...(kept.use ? { use: kept.use } : {}) });
	/** What the owner calls a machine: the name kept for it, else for a paired computer "your computer", else for user@host its host's first label. */
	const labelOf = (host: string) => kept.names[host] ?? (isPaired(host) ? YOUR_COMPUTER : parseHost(host).label);
	const opener = (host: string): Pick<ConnectOptions, "open" | "user"> => {
		if (isPaired(host)) {
			if (!deps.peer) throw new Error(NO_PEER);
			return { open: deps.peer(host.slice(PAIRED.length)), user: PAIRED_USER };
		}
		const { user, hostname, port } = parseHost(host);
		return { open: deps.relay(hostname, port), user };
	};

	// The browser's key: made once, kept in the store as CryptoKeys that WebCrypto will not hand out.
	let pair: Promise<CryptoKeyPair> | undefined;
	const key = () =>
		(pair ??= (async () => {
			const stored = (await deps.store.get("key")) as CryptoKeyPair | undefined;
			if (stored?.privateKey && stored.publicKey) return stored;
			const made = await generateKey();
			await deps.store.set("key", made);
			return made;
		})());
	const keyLine = async () => publicKeyLine((await key()).publicKey, KEY_COMMENT);

	let state: ServiceState = { status: "starting" };
	let connected = false;
	const setState = (next: ServiceState) => {
		state = next;
		emit("service", state);
	};
	const setConnected = (up: boolean) => {
		if (up === connected) return;
		connected = up;
		emit("connection", up);
	};

	// The connection in use: its SSH, the channel that holds pine service, the daemon, the event stream.
	let current: { connection: Connection; service?: Channel; daemon?: Daemon; events?: AbortController } | undefined;
	let round = 0;
	const letGo = async () => {
		const c = current;
		current = undefined;
		c?.events?.abort();
		setConnected(false);
		await c?.service?.close().catch(() => {});
		await c?.connection.close().catch(() => {});
	};

	/**
	 * Connects to `host`, runs pine service there and follows its events. `again`: the connection in
	 * use was lost, so the page stays where it is (state "ready", not connected) and is told a
	 * trouble that may pass only when `say`. A trouble only the owner can fix is always told.
	 */
	const connectTo = async (host: string, again?: { say: boolean }): Promise<Outcome> => {
		const mine = ++round;
		await letGo();
		const say = !again || again.say;
		const passing = (message: string): Outcome => {
			if (say) setState({ status: "error", kind: "ssh", host, message });
			// A first attempt that fails for a reason that may pass (the relay, the network) is tried
			// again like a lost connection, so that the network coming back (`wake`) connects.
			if (!again) void reconnect(host, 1);
			return "passing";
		};
		const final = (next: ServiceState): Outcome => {
			setState(next);
			return "final";
		};
		if (!again) setState({ status: "starting", host });
		const known = hostKeys[host];
		const paired = isPaired(host);
		let connection: Connection;
		try {
			// With no key trusted yet, a fingerprint no key has: the core stops at the host key and says which it saw, before the browser's key is offered.
			connection = await deps.connect({ ...opener(host), key: await key(), hostFingerprint: known ?? "none" });
		} catch (e) {
			if (mine !== round) return "superseded";
			if (paired) {
				// A paired computer's key came from its link and is never asked about: another one is refused for good.
				if (e instanceof SshRefused && e.reason === "host-key")
					return final({ status: "error", kind: "ssh", host, fingerprint: e.hostFingerprint, changed: true, message: `The host key of ${labelOf(host)} changed: it was ${known ?? "none"}, it is now ${e.hostFingerprint ?? "unknown"}. Someone may stand between this browser and ${labelOf(host)}. Forget it here, then open Pine on ${labelOf(host)} and add this device again.` });
				if (e instanceof SshRefused) return final({ status: "error", kind: "ssh", host, message: notKnown(labelOf(host)) });
				if (e instanceof PeerClosed) return passing(peerTrouble(labelOf(host), e.reason));
				if (e instanceof Error && e.message === NO_PEER) return final({ status: "error", kind: "ssh", host, message: NO_PEER });
				return passing(`Could not connect to ${labelOf(host)}. ${e instanceof Error ? e.message : String(e)}`);
			}
			if (e instanceof SshRefused && e.reason === "host-key" && e.hostFingerprint) {
				const seen = e.hostFingerprint;
				if (known)
					return final({ status: "error", kind: "ssh", host, fingerprint: seen, changed: true, message: `The host key of ${host} changed: it was ${known}, it is now ${seen}. Someone may stand between this browser and the machine, or the machine was set up anew. If you know why, forget the machine and add it again.` });
				return final({ status: "error", kind: "ssh", host, fingerprint: seen, changed: false, message: `This browser does not know ${host} yet. Its host key's fingerprint is ${seen}. If that is what the machine shows (ssh-keygen -lf on its /etc/ssh/ssh_host_*_key.pub), trust it and connect.` });
			}
			if (e instanceof SshRefused && e.reason === "not-authorized")
				return final({ status: "error", kind: "ssh", host, message: `${host} did not accept this browser's key. Add it as a line of ~/.ssh/authorized_keys of that user there: ${await keyLine()}` });
			if (e instanceof RelayClosed) return passing(relayTrouble(host, e));
			return passing(`Could not connect to ${host} over SSH. ${e instanceof Error ? e.message : String(e)}`);
		}
		if (mine !== round) {
			void connection.close().catch(() => {});
			return "superseded";
		}
		let dropped = false;
		void connection.closed.then(() => (dropped = true));
		const held: NonNullable<typeof current> = (current = { connection });
		const label = labelOf(host);
		try {
			const { said, channel } = await runService(connection, REMOTE_COMMAND, deps.serviceMs);
			if (mine !== round) {
				void channel.close().catch(() => {});
				return "superseded";
			}
			held.service = channel;
			if (said.error) throw new Error(`The pine on ${label} did not start: ${said.error}`);
			const far = loopbackEnd(said.base);
			held.daemon = { connection, host: far.host, port: far.port, token: String(said.token) };
			setState({ status: "ready", mode: `on ${label}`, started: said.started === true, home: `${label}:${String(said.home ?? "~/.pine")}`, version: typeof said.version === "string" ? said.version : undefined, from: paired ? `paired ${label}` : `ssh ${host}`, host, label });
			const events = (held.events = new AbortController());
			// Lost: the connection ended, or pine there stopped answering with SSH still up. Either way it is made again.
			const lost = () => {
				if (current === held) void reconnect(host);
			};
			void connection.closed.then(lost);
			followEvents(held.daemon, events.signal, { batch: (b) => emit("events", b), connection: setConnected, lost: (times) => (times >= STREAM_LOSSES ? (lost(), true) : false) });
			return "ready";
		} catch (e) {
			if (mine !== round) return "superseded";
			const cut = dropped;
			await letGo();
			if (mine !== round) return "superseded";
			if (e instanceof ServiceTrouble && e.message === "timeout") return passing(serviceTrouble(paired ? label : host, e));
			// The connection went while pine service was asked: the network, not the machine.
			if (cut) return passing(`The connection to ${paired ? label : host} was lost while pine there was asked to start.`);
			if (e instanceof ServiceTrouble) return final({ status: "error", kind: "ssh", host, message: serviceTrouble(paired ? label : host, e) });
			return final({ status: "error", kind: "failed", host, message: e instanceof Error ? e.message : String(e) });
		}
	};

	// Connecting again: after a loss at once, then after each failure a longer wait (`backoff`),
	// cut short by `wake()`. It ends when connected, at a trouble only the owner can fix, or when
	// anything else connects or lets go (`round` moved on). A newer loop ends the one before.
	// `failed`: attempts that failed already and were told (a first one); then every trouble is told,
	// since the page is not in its conversations.
	let nudge: (() => void) | undefined;
	let loops = 0;
	const reconnect = async (host: string, failed = 0) => {
		const me = ++loops;
		nudge?.();
		for (let n = failed; ; n++) {
			if (n > 0) {
				const before = round;
				await Promise.race([wait(backoff(n - 1)), new Promise<void>((r) => (nudge = r))]);
				if (me !== loops || round !== before) return;
			}
			const outcome = await connectTo(host, { say: failed > 0 || n >= QUIET_TRIES - 1 });
			if (outcome !== "passing" || me !== loops) return;
		}
	};

	/** Lets go of the machine in use: nothing connects to it again until the owner chooses one. Its place in the list and its host key stay. */
	const leave = async () => {
		const { use: _gone, ...rest } = kept;
		kept = rest;
		round++;
		await letGo();
		setState(noMachine());
	};

	/**
	 * Pairs with the computer a pairing link names: a pairing session that expects exactly the host
	 * key the link names (the core refuses any other before the browser's key is offered), the
	 * pairing request, and the owner's answer at that computer. Only a yes keeps anything: the
	 * computer under the name it gave, made the machine in use, and the link's fingerprint as its host key for that
	 * machine alone, unless one is kept for it already. Then it is connected to as a paired browser.
	 */
	const pairWith = async (link: PairLink) => {
		const mine = ++round;
		await letGo();
		const host = `${PAIRED}${link.id}`;
		const name = deviceName(deps.userAgent ?? "");
		const stop = (message: string) => mine === round && setState({ status: "error", kind: "ssh", message });
		setState({ status: "starting", pairing: { name } });
		let connection: Connection;
		try {
			const peer = deps.peer;
			if (!peer) throw new Error(NO_PEER);
			// Whether the channel opened, and whether the computer sent a byte over it. One that ended
			// before the computer said anything (it can let go of a channel that is slow to reach it)
			// never got to authentication: the link's one-time code is unused, and one more session may try it.
			let opened = false;
			let heard = false;
			const open: OpenStream = async () => {
				const transport = await peer(link.id)();
				opened = true;
				return { ...transport, onData: (next) => transport.onData((bytes) => ((heard = true), next(bytes))) };
			};
			const attempt = async () => {
				opened = heard = false;
				return deps.connect({ open, user: pairUser(link.code), key: await key(), hostFingerprint: pairedFingerprint(link.id) });
			};
			try {
				connection = await attempt();
			} catch (e) {
				if (!opened || heard || e instanceof SshRefused || mine !== round) throw e;
				connection = await attempt();
			}
		} catch (e) {
			if (e instanceof SshRefused && e.reason === "host-key") return stop("The computer that answered is not the one this pairing link names: nothing was trusted. Open Pine on your computer and add this device again.");
			if (e instanceof SshRefused) return stop(PAIR_EXPIRED);
			if (e instanceof PeerClosed) return stop(PAIR_TROUBLE[e.reason]);
			return stop(`Could not reach your computer to pair with it. ${e instanceof Error ? e.message : String(e)}`);
		}
		let answer: Awaited<ReturnType<typeof askToPair>>;
		try {
			answer = await askToPair(connection, name, (code, computer) => mine === round && setState({ status: "starting", pairing: { code, name, ...(computer ? { computer } : {}) } }));
		} catch (e) {
			void connection.close().catch(() => {});
			return stop(`The pairing with your computer did not go through. ${e instanceof Error ? e.message : String(e)}`);
		}
		void connection.close().catch(() => {});
		if (mine !== round) return;
		if (!answer.ok) return stop(answer.reason === "refused" ? "Your computer refused this browser: nothing was kept. To pair it after all, open Pine on your computer and add this device again." : PAIR_EXPIRED);
		if (!kept.hosts.includes(host) && kept.hosts.length >= MAX_HOSTS) return stop(`There are ${MAX_HOSTS} machines already: forget one first, then add this device again at your computer.`);
		kept = { ...kept, hosts: kept.hosts.includes(host) ? kept.hosts : [...kept.hosts, host], names: { ...kept.names, [host]: answer.name }, use: host };
		hostKeys[host] ??= pairedFingerprint(link.id);
		await Promise.all([save(), saveKeys()]);
		if (mine === round) void connectTo(host);
	};

	let started = false;
	const bridge = {
		on(event: BridgeEvent, fn: (value: unknown) => void) {
			let set = listeners.get(event);
			if (!set) listeners.set(event, (set = new Set()));
			set.add(fn);
		},
		async state(): Promise<AppState> {
			await load();
			await relearn();
			answered = true;
			return { state, connected, home: state.status === "ready" ? state.home : undefined, prefs: prefsOut(), platform: "web", focused: true, updates: false, versions: { app: deps.version, electron: "none" }, local: false, canAddHost, canPair, ...(canPair && deps.openApp ? { canOpenApp: true } : {}), ...(deps.serviceHost ? { serviceHost: deps.serviceHost } : {}) };
		},
		/** The page has started: it is told the state as it is now, and the pairing link is paired with, or else the machine in use connected to (once). */
		async ready() {
			await load();
			emit("service", state);
			if (started) return;
			started = true;
			const link = deps.pairLink;
			if (link) void (deps.choose ? deps.choose(link) : Promise.resolve()).then(() => pairWith(link));
			else if (kept.use) void connectTo(kept.use);
		},
		async retry() {
			await load();
			if (kept.use) void connectTo(kept.use);
			else setState(noMachine());
		},
		async call(method: string, url: string, body?: unknown) {
			return callDaemon(state.status === "ready" ? current?.daemon : undefined, method, url, body);
		},
		/** Checked as main.ts checks the owner's change; the machines change by their own methods only. */
		async prefs(change: Record<string, unknown>) {
			await load();
			const flag = (k: "notify" | "updates" | "keepRunning" | "questionCards") => (typeof change[k] === "boolean" ? (change[k] as boolean) : kept.prefs[k]);
			const next: PagePrefs = { notify: flag("notify"), updates: flag("updates"), keepRunning: flag("keepRunning"), questionCards: flag("questionCards") };
			const look = "look" in change ? cleanLook(change.look) : kept.prefs.look;
			if (look) next.look = look;
			const storage = "storage" in change ? cleanStorage(change.storage) : kept.prefs.storage;
			if (storage) next.storage = storage;
			kept = { ...kept, prefs: next };
			await save();
			return prefsOut();
		},
		async use(host?: string) {
			await load();
			if (!host) throw new Error("This browser has no pine of its own: choose one of your machines.");
			if (!kept.hosts.includes(host)) throw new Error(`${host} is not one of your machines: add it first.`);
			kept = { ...kept, use: host };
			await save();
			void connectTo(host);
		},
		/** A user@host machine; a paired computer is added by its pairing link only. */
		async addHost(host: string) {
			await load();
			if (!canAddHost) throw new Error("This address reaches no user@host machines: pair a computer instead, from Settings > Browser access in the Pine app on it.");
			parseHost(host);
			if (!kept.hosts.includes(host)) {
				if (kept.hosts.length >= MAX_HOSTS) throw new Error(`There are ${MAX_HOSTS} machines already: forget one first.`);
				kept = { ...kept, hosts: [...kept.hosts, host] };
				await save();
			}
			return prefsOut();
		},
		/** A machine forgotten takes its name and its host key along, and its connection when it is the one in use. */
		async forgetHost(host: string) {
			await load();
			const { [host]: _name, ...names } = kept.names;
			kept = { ...kept, hosts: kept.hosts.filter((h) => h !== host), names };
			delete hostKeys[host];
			if (kept.use === host) await leave();
			await Promise.all([save(), saveKeys()]);
			return prefsOut();
		},
		/** The name the owner sees for a machine of the list, as text: no control characters, at most 60 characters. */
		async renameHost(host: string, name: string) {
			await load();
			if (!kept.hosts.includes(host)) throw new Error(`${host.slice(0, 80)} is not one of your machines: nothing was renamed.`);
			const clean = cleanName(name);
			if (!clean) throw new Error("A machine's name needs at least one letter: nothing was renamed.");
			kept = { ...kept, names: { ...kept.names, [host]: clean } };
			await save();
			return prefsOut();
		},
		/** Back to the machines: the one in use is let go of, and kept with its host key for the next time. */
		async disconnect() {
			await load();
			if (kept.use) {
				await leave();
				await save();
			}
			return prefsOut();
		},
		/** The owner's yes to exactly the fingerprint the page was shown for that host; never to a key that changed. */
		async trustHostKey(host: string, fingerprint: string) {
			const s = state;
			// A paired computer's key comes from its pairing link alone, never from a press here.
			if (isPaired(host) || s.status !== "error" || s.host !== host || s.fingerprint !== fingerprint || s.changed !== false) throw new Error(`That is not the key ${host} showed: nothing was trusted.`);
			hostKeys[host] = fingerprint;
			await saveKeys();
			void connectTo(host);
		},
		/** One of the daemon's pictures, videos or sounds, as bytes the page makes its own object URL of. */
		async media(target: string) {
			const checked = mediaTarget(target);
			const daemon = state.status === "ready" ? current?.daemon : undefined;
			if (!daemon) throw new Error("not found: pine is not connected. Wait until it is, or choose a machine in Settings > Environments.");
			return mediaOf(daemon, checked);
		},
		/** The Pine app on this computer is asked to add this browser: it opens a pairing and sends its link here. */
		async openApp() {
			if (!deps.openApp) throw new Error("Open Pine on your computer and choose Pine > Add a device.");
			deps.openApp();
		},
		async open(url: string) {
			const href = webAddress(url);
			if (!deps.open) throw new Error("This browser cannot open another tab: copy the address and open it yourself.");
			deps.open(href);
		},
		/** What the page saves goes to the browser's downloads: the page is told the name it was given. */
		async saveText(name: string, text: string) {
			const named = fileName(name);
			if (!deps.save) throw new Error("This browser cannot save a file: copy the text instead.");
			deps.save(named, text);
			return named;
		},
		deviceKey: () => keyLine(),
		copyKey: async () => deps.clipboard(await keyLine()),
		shareKey: async () => {
			const line = await keyLine();
			return deps.share ? deps.share("This browser's SSH key", line) : deps.clipboard(line);
		},
		/** The network is back or the tab is shown again: a connection being made again is tried now, not after its wait. */
		wake() {
			nudge?.();
		},
		/** Lets go of the connection (the tests; a closed tab ends it anyway). */
		stop() {
			round++;
			void letGo();
		},
	};
	return bridge;
}
