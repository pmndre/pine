// What the page draws of the machines it can use, read from the states and preferences a bridge
// hands it: a computer paired with the web client by its name (its id is a fingerprint, which says
// nothing to the owner, and the browser does not know what kind of computer it is), a pairing under way on the first screen, how a pairing ended, and where
// the suggestion to add the web client to the home screen is worth making. Nothing here reads
// the window or the bridge, so that the web client's tests drive it with the states its bridge says.
import type { ServiceState } from "./bridge.ts";

/**
 * The word for the computer the Pine app runs on, as the app says it of itself ("This Mac", "this
 * computer"): "Mac" on macOS, "computer" on any other system, and in the web client, which cannot
 * tell what it runs on.
 */
export const computerWord = (platform: string): "Mac" | "computer" => (platform === "darwin" ? "Mac" : "computer");

/** How a computer paired by its link is written among the machines: `paired:` and its machine id. */
export const PAIRED = "paired:";
/** A machine id: SHA-256 of the paired computer's SSH public key blob, base64url without padding. */
export const MACHINE_ID = /^[A-Za-z0-9_-]{43}$/;

/** Whether a machine of the list is a computer paired by its link (`paired:<machine id>`), rather than a user@host one. */
export const isPaired = (host: string): boolean => host.startsWith(PAIRED) && MACHINE_ID.test(host.slice(PAIRED.length));

/**
 * The address of the project's own service (the web client and the meeting service), which the
 * Pine app uses unless the owner names another: the Worker `pine-main` of web/relay, deployed from
 * every push to `main`, on the project's workers.dev account. A browser's key and its paired computers belong to this address, so
 * changing it makes every owner pair again.
 */
export const OFFICIAL_SERVICE = "https://pine-main.drcmda.workers.dev";

/** A pairing code: 16 random bytes, base64url without padding. */
const PAIR_CODE = /^[A-Za-z0-9_-]{22}$/;

/** A pairing link as the page reads it: the service's origin (`https` only), the machine id and the code. */
export type PairLink = { service: string; id: string; code: string };

/**
 * The `https` origin of an address, written in lower case and without `:443`; none for another
 * scheme, a name or password, a host in brackets or port 0. Path, query and fragment are the
 * caller's to refuse.
 */
function httpsOrigin(text: string): string | undefined {
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return undefined;
	}
	if (url.protocol !== "https:" || !url.hostname || url.hostname.startsWith("[") || url.port === "0" || url.username || url.password) return undefined;
	return url.origin;
}

/**
 * A pairing link, as the QR code of the Pine app carries it (`<service origin>/#pair=<machine id>.<code>`,
 * the web client's) or as the web client hands it to the mobile app
 * (`pine://pair?service=<percent-encoded https origin>&id=<machine id>&code=<code>`). Anything else,
 * and a service that is not `https`, is no pairing link: none. The page reads it to ask the owner
 * (and to name a service that is not the official one); the bridge and the native side read it again.
 */
export function readPairLink(text: string): PairLink | undefined {
	const link = text.trim();
	if (link.startsWith("pine:")) {
		const m = /^pine:\/\/pair\?([^#]*)$/.exec(link);
		if (!m) return undefined;
		const q = new URLSearchParams(m[1]);
		const keys = [...q.keys()];
		if (keys.length !== 3 || !["service", "id", "code"].every((k) => q.getAll(k).length === 1)) return undefined;
		const service = q.get("service")!;
		const id = q.get("id")!;
		const code = q.get("code")!;
		if (httpsOrigin(service) !== service || !MACHINE_ID.test(id) || !PAIR_CODE.test(code)) return undefined;
		return { service, id, code };
	}
	const at = link.indexOf("#");
	if (at < 0) return undefined;
	const base = link.slice(0, at);
	const hash = link.slice(at);
	// The origin and one slash, nothing more: no path, no query, no name before the host.
	if (!/^https:\/\/[^/?#@\s]+\/$/i.test(base) || !hash.startsWith("#pair=")) return undefined;
	const service = httpsOrigin(base);
	if (!service) return undefined;
	const [id, code, ...more] = hash.slice("#pair=".length).split(".");
	if (more.length || !MACHINE_ID.test(id ?? "") || !PAIR_CODE.test(code ?? "")) return undefined;
	return { service, id, code };
}

/**
 * The host of a pairing link's service when it is not the official one, which the owner is shown
 * before saying yes, so that they know where the device connects; none for the official service.
 */
export const otherService = (link: PairLink): string | undefined => (link.service === OFFICIAL_SERVICE ? undefined : new URL(link.service).host);

/**
 * The host of a pairing link's service when that service is on http: a link `readPairLink` refuses
 * (the web client of a test deployment offers one to the iOS app), whose refusal can then say why.
 * None for anything else.
 */
export function httpService(text: string): string | undefined {
	const link = text.trim();
	let service: string | null | undefined;
	if (link.startsWith("pine:")) {
		const m = /^pine:\/\/pair\?([^#]*)$/.exec(link);
		try {
			service = m ? new URLSearchParams(m[1]).get("service") : undefined;
		} catch {
			return undefined;
		}
	} else if (link.includes("#")) service = link.slice(0, link.indexOf("#"));
	if (!service) return undefined;
	try {
		const url = new URL(service);
		return url.protocol === "http:" && url.host ? url.host : undefined;
	} catch {
		return undefined;
	}
}

/**
 * What the page calls the device it runs on when it pairs: "phone" in the mobile app, "browser"
 * in the web client (and anywhere else, where nothing is paired).
 */
export const deviceWord = (platform: string): "phone" | "browser" => (platform === "android" || platform === "ios" ? "phone" : "browser");

/**
 * A computer that announces itself on this network (ADR 0005): its machine id, its meeting service's
 * https origin, and the nonce a request has to name. Unproven: the digits are.
 */
export type NearbyComputer = { id: string; service: string; nonce: string };
/** What a bridge that looks on the network found: every computer, and whether the system refused the app the local network (iOS). */
export type NearbyFound = { computers: NearbyComputer[]; denied?: boolean };

/** The start of a machine id, which tells two computers found on one network apart: they are all called "Pine" there. */
export const shortId = (id: string) => id.slice(0, 6);

/**
 * Whether the web client runs in a browser on a computer, where the Pine app may run beside it and
 * `pine://pair` can open it: not on a phone or a tablet (iPadOS says it is a Mac: told apart by its touch points).
 */
export function isDesktopBrowser(userAgent: string, touchPoints = 0): boolean {
	if (/iPhone|iPad|iPod|Android|Mobile/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) return false;
	return /Macintosh|Windows|X11|Linux|CrOS/.test(userAgent);
}

/** What a paired computer is called while no name is known for it: before the pairing, and where none was given. */
export const YOUR_COMPUTER = "your computer";

/** The name the owner sees for a machine: the one kept for it; else for a paired computer "your computer", for user@host the host as written. Never a machine id. */
export function machineName(host: string, names?: Record<string, string>): string {
	return names?.[host] ?? (isPaired(host) ? YOUR_COMPUTER : host);
}

/** Where the Pine app is downloaded, for a browser that is to pair with a computer that does not have it yet. */
export const APP_DOWNLOAD = "https://github.com/pmndre/pine/releases/latest";

/** The two views of the machines' screen: how to pair with a computer, or the user@host machines reached over SSH. */
export type MachinesViewName = "pair" | "ssh";

/**
 * Which view of the machines (the first screen, Settings > Environments) is shown, and with which
 * controls: `toSsh`, the link from the pairing view to the SSH view; `back`, the control from the
 * SSH view back to pairing. Both views are offered only where the bridge can pair (`canPair`) and
 * add user@host machines (`canAddHost`); then the owner's choice for the visit (`chosen`) wins, and
 * without one a browser with a user@host machine lands on the SSH view, any other on pairing.
 * Nothing to pair with (the desktop and mobile apps, a deployment without the meeting service):
 * the SSH view alone. No user@host machines (the relay is off): the pairing view alone.
 */
export function machinesView(o: { canPair: boolean; canAddHost: boolean; hosts: string[]; chosen?: MachinesViewName }): { view: MachinesViewName; toSsh: boolean; back: boolean } {
	if (!o.canAddHost) return { view: "pair", toSsh: false, back: false };
	if (!o.canPair) return { view: "ssh", toSsh: false, back: false };
	const view = o.chosen ?? (o.hosts.some((h) => !isPaired(h)) ? "ssh" : "pair");
	return { view, toSsh: view === "pair", back: view === "ssh" };
}

/**
 * What the SSH view says under the field that adds a user@host machine, where the bridge names its
 * service (`AppState.serviceHost`): the relay carries the SSH bytes, which are encrypted end to end.
 */
export const relayLine = (serviceHost: string) => `Connections go through the relay at ${serviceHost}. The relay carries only SSH and cannot read it.`;

/**
 * What the pairing view says: the meeting service passes the few messages that set up the
 * connection, and carries nothing after. The connection is direct, or goes through a relay server
 * (TURN) that the computer's owner named in the Pine app: true of every paired computer, connected or not.
 */
export const meetingLine = (serviceHost: string) => `Found through ${serviceHost}. The two devices then connect directly, or through a relay server that the computer's owner chose.`;

/**
 * The sentence the first screen draws under its title for an SSH trouble. The bridge's state with
 * no machine in use (one that names no machine, no pairing that failed) says what to do in the SSH
 * view (add user@host); in the pairing view its how-to is on screen and says it instead: none.
 */
export function noMachineSaid(state: ServiceState & { status: "error" }, view: MachinesViewName, pairFailed: boolean): string | undefined {
	if (state.kind === "ssh" && !state.host && !pairFailed && view === "pair") return undefined;
	return state.message;
}

/** How a machine of the list is reached, as plain secondary text on its row; none where the bridge names no service (the desktop and mobile apps). */
export function reachedThrough(host: string, serviceHost?: string): string | undefined {
	if (!serviceHost) return undefined;
	return isPaired(host) ? meetingLine(serviceHost) : `Through the relay at ${serviceHost}.`;
}

/** The first screen during a pairing: what it says, and the four digits once the computer showed them. None: no pairing under way. Its name is not known yet. */
export function firstScreen(state: ServiceState, device: "phone" | "browser" = "browser"): { title: string; about: string; code?: string } | undefined {
	if (state.status !== "starting" || !state.pairing) return undefined;
	const { code, name, computer } = state.pairing;
	if (!code) return { title: "Pairing with your computer", about: "Reaching your computer…" };
	// The computer's own name, once it gave it with the digits: a computer found on the network was only "Pine" before.
	const it = computer || "your computer";
	return { title: `Confirm on ${it}`, about: `${computer || "Your computer"} asks whether ${name ? `"${name}"` : `this ${device}`} may connect. Press Allow there if it shows ${code}, the same digits as here.`, code };
}

/**
 * How a pairing ended, from the state before and the one after: "paired" when the computer said yes
 * and the bridge goes on to reach it, "failed" when the bridge says why with no machine named
 * (refused, expired, used, not reached). None: no pairing ended.
 */
export function pairingEnded(before: ServiceState, after: ServiceState): "paired" | "failed" | undefined {
	if (before.status !== "starting" || !before.pairing) return undefined;
	if (after.status === "starting" && after.pairing) return undefined;
	if (after.host) return "paired";
	if (after.status === "error") return "failed";
	return undefined;
}

/**
 * Whether a web app added to the home screen keeps this browser's data, and so the key the paired
 * computer knows it by: on Android, where it shares the browser's storage. Not on iOS and iPadOS, where
 * an app on the home screen has storage of its own and would have to be paired again (iPadOS
 * says it is a Mac: told apart by its touch points). Not on a computer, which has no home screen.
 */
export function homeScreenKeeps(userAgent: string, touchPoints = 0): boolean {
	if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) return false;
	return /Android/.test(userAgent);
}
