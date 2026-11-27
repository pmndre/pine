import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, waitFor, within } from "storybook/test";
import type { ServiceState } from "./bridge.ts";
import type { NearbyFound } from "./machines.ts";
import { Gate } from "./App.tsx";
import { store } from "./model.ts";

// What the window shows before a pine answers (`Gate` in App.tsx), under a bridge with no local
// machine (a phone, a browser): there the machines are the only way to a pine, so they are listed below the
// message, with the client's own key, as Settings > Environments lists them.

window.pine.deviceKey = async () => ({ key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq3lYcVb0mXkJ2yq8rV6tZsP4dW1nE9fKcH7uR2aB3m pine-android", copy: async () => {}, share: async () => {} });

function Before({ state, hosts, loadError, names, canAddHost = true, canPair = false, serviceHost, pairFailed = false, phone = false, nearby, openApp = false, read = true }: { state: ServiceState; hosts: string[]; loadError?: string; names?: Record<string, string>; canAddHost?: boolean; canPair?: boolean; serviceHost?: string; pairFailed?: boolean; phone?: boolean; nearby?: NearbyFound; openApp?: boolean; read?: boolean }) {
	// `nearby`: what a phone whose app looks on the network finds (the bridge tells it at once); none: a bridge that does not look.
	// (False, not undefined: the stand-in bridge answers a name it does not have with a function.)
	Object.assign(window.pine, {
		nearby: nearby ? (fn: (found: NearbyFound) => void) => (fn(nearby), () => {}) : false,
		pairNearby: nearby ? fn(async () => {}) : false,
	});
	store.canOpenApp = openApp;
	// `read`: whether the bridge has answered `state()`; until it has, the first screen is a skeleton.
	store.stateRead = read;
	// `phone`: the mobile app's bridge, which pairs from a link in the owner's hand (`pair`) where it says `canPair`.
	store.platform = phone ? "android" : "darwin";
	store.pairsFromHand = phone;
	store.local = false;
	store.prefs = { ...store.prefs, hosts, use: state.host, names };
	store.service = state;
	store.loadError = loadError;
	store.canAddHost = canAddHost;
	store.canPair = canPair;
	store.serviceHost = serviceHost;
	store.pairFailed = pairFailed;
	return (
		<div className="flex h-dvh w-full">
			<Gate />
		</div>
	);
}

const meta = {
	component: Before,
	parameters: { layout: "fullscreen" },
	// What a story sets on the store is put back after it: the next story starts from the store as it was.
	beforeEach: () => {
		const { stateRead, local, service, prefs, loadError, canAddHost, canPair, serviceHost, machinesChosen, pairFailed, platform, pairsFromHand, canOpenApp } = store;
		return () => void Object.assign(store, { stateRead, local, service, prefs, loadError, canAddHost, canPair, serviceHost, machinesChosen, pairFailed, platform, pairsFromHand, canOpenApp });
	},
	// Nothing of a local machine, and the machines listed: they are the only way to a pine.
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('[data-slot="gate-machines"]')).not.toBeNull();
		await expect(canvasElement.querySelector('[data-environment="local"]')).toBeNull();
		await expect(within(canvasElement).queryAllByText(/This (Mac|computer)|Use this (Mac|computer)|Set up pine/)).toHaveLength(0);
	},
} satisfies Meta<typeof Before>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The first start: no machine yet, the client's key to put on one, and the field to add it. */
export const NoMachineYet: Story = {
	args: { hosts: [], state: { status: "error", kind: "ssh", message: "Add the machine whose pine this device is to use, as you would write it after ssh: user@host, or user@host:port. Put this device's key into ~/.ssh/authorized_keys there first." } },
	// Nothing to pair with (the mobile app, a deployment without the meeting service): the SSH view alone, no back control, no relay named.
	play: async (context) => {
		await meta.play(context);
		const { canvasElement } = context;
		await expect(canvasElement.querySelector("input")).not.toBeNull();
		await expect(canvasElement.querySelector('[data-slot="pair-how-to"]')).toBeNull();
		await expect(canvasElement.querySelector('[data-slot="back-to-pairing"]')).toBeNull();
		await expect(canvasElement.querySelector('[data-slot="ssh-instead"]')).toBeNull();
		await expect(canvasElement.querySelector('[data-slot="relay-line"]')).toBeNull();
	},
};

const fingerprint = "SHA256:Xv2k0yq3pZ8bW9cQm1sT4uE7rN6aL5dH2fJ0gK3iO8Y";
const trusted = fn();

/** A machine met for the first time: its host key's fingerprint, and Trust this key, the owner's yes to exactly that one (Try again only connects again). */
export const HostKeyToConfirm: Story = {
	args: {
		hosts: ["me@build-box"],
		state: { status: "error", kind: "ssh", host: "me@build-box", fingerprint, changed: false, message: `This device does not know me@build-box yet. Its host key's fingerprint is ${fingerprint}. If that is what the machine shows (ssh-keygen -lf on its /etc/ssh/ssh_host_*_key.pub), trust it and connect.` },
	},
	beforeEach: () => {
		trusted.mockClear();
		window.pine.trustHostKey = trusted;
		return () => void delete (window.pine as Partial<typeof window.pine>).trustHostKey;
	},
	play: async (context) => {
		await meta.play(context);
		const { canvasElement, userEvent } = context;
		const gate = canvasElement.querySelector<HTMLElement>('[data-slot="gate-machines"]')!.parentElement!;
		await expect(gate.querySelector('[data-slot="host-key-fingerprint"]')).toHaveTextContent(fingerprint);
		await userEvent.click(gate.querySelector<HTMLElement>(':scope > div > [data-slot="trust-host-key"]')!);
		await expect(trusted).toHaveBeenCalledTimes(1);
		await expect(trusted).toHaveBeenCalledWith("me@build-box", fingerprint);
		// The machine's row says it too, with a button of its own.
		const row = canvasElement.querySelector<HTMLElement>('[data-environment="me@build-box"]')!;
		await expect(row.querySelector('[data-slot="host-key-fingerprint"]')).toHaveTextContent(fingerprint);
		await expect(row.querySelector('[data-slot="trust-host-key"]')).not.toBeNull();
		// Its three buttons go below the text where they would squeeze it into a column (a phone, and the Gate's narrow card at any width).
		const text = row.querySelector<HTMLElement>('[data-slot="item-content"]')!;
		await expect(text.getBoundingClientRect().width).toBeGreaterThan(row.getBoundingClientRect().width / 2);
	},
};

/** A machine whose host key changed: never offered to trust, only to forget and add again. */
export const HostKeyChanged: Story = {
	args: {
		hosts: ["me@build-box"],
		state: { status: "error", kind: "ssh", host: "me@build-box", fingerprint, changed: true, message: `The host key of me@build-box changed: it is now ${fingerprint}. If you know why, forget the machine and add it again.` },
	},
	play: async (context) => {
		await meta.play(context);
		await expect(context.canvasElement.querySelector('[data-slot="trust-host-key"]')).toBeNull();
	},
};

const disconnected = fn(async () => ({ ...store.prefs, use: undefined }));
/** The bridge offers Disconnect for the story, and takes it back after. */
const offerDisconnect = () => {
	disconnected.mockClear();
	window.pine.disconnect = disconnected;
	return () => void delete (window.pine as Partial<typeof window.pine>).disconnect;
};

/** A machine being reached, which can take a minute: the machines stay listed, to switch to another, and Disconnect lets go of this one. */
export const Connecting: Story = {
	args: { hosts: ["me@build-box", "studio"], state: { status: "starting", host: "me@build-box" } },
	beforeEach: offerDisconnect,
	play: async (context) => {
		await meta.play(context);
		const { canvasElement, userEvent } = context;
		// Only on the row of the machine being reached.
		await expect(canvasElement.querySelector('[data-environment="studio"] [data-slot="disconnect"]')).toBeNull();
		await userEvent.click(canvasElement.querySelector<HTMLElement>('[data-environment="me@build-box"] [data-slot="disconnect"]')!);
		await expect(disconnected).toHaveBeenCalledTimes(1);
	},
};

/** A machine not reached: the bridge keeps trying it, so Disconnect lets go of it and keeps its host key, which Forget would drop. */
export const NotReached: Story = {
	args: { hosts: ["me@build-box", "studio"], state: { status: "error", kind: "ssh", host: "me@build-box", message: "Connection refused." } },
	beforeEach: offerDisconnect,
	play: async (context) => {
		await meta.play(context);
		const { canvasElement, userEvent } = context;
		await expect(within(canvasElement).getByText(/Could not reach/)).toHaveTextContent("Could not reach me@build-box over SSH");
		await expect(canvasElement.querySelector('[data-environment="me@build-box"] [data-slot="badge"]')).toHaveTextContent("unreachable");
		await userEvent.click(canvasElement.querySelector<HTMLElement>('[data-environment="me@build-box"] [data-slot="disconnect"]')!);
		await expect(disconnected).toHaveBeenCalledTimes(1);
	},
};

/** A long host (a Tailscale Funnel name and its port): it wraps between its parts, and the badge goes onto a line of its own, inside the row. */
export const LongHost: Story = {
	args: {
		hosts: ["someone@machine.tailnet1234.ts.net:10000", "someone@other.tailnet1234.ts.net:10000"],
		state: { status: "starting", host: "someone@machine.tailnet1234.ts.net:10000" },
	},
	play: async (context) => {
		await meta.play(context);
		const rows = [...context.canvasElement.querySelectorAll<HTMLElement>("[data-environment]")];
		await expect(rows).toHaveLength(2);
		for (const row of rows) await expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
		const row = rows[0]!;
		const badge = row.querySelector<HTMLElement>('[data-slot="badge"]')!;
		await expect(badge.getBoundingClientRect().right).toBeLessThanOrEqual(row.getBoundingClientRect().right);
	},
};

const ready: ServiceState = { status: "ready", mode: "on build-box", started: false, home: "build-box:~/.pine", version: "0.40.0", from: "ssh me@build-box", host: "me@build-box", label: "build-box" };

/** The machine's pine answered and its agents are being asked for over SSH: the same screen as while it was reached, so connecting reads as one wait. */
export const LoadingAgents: Story = {
	args: { hosts: ["me@build-box", "studio"], state: ready },
	beforeEach: offerDisconnect,
	play: async (context) => {
		await meta.play(context);
		const { canvasElement, userEvent } = context;
		const canvas = within(canvasElement);
		await expect(canvas.getByText(/Connecting to/)).toHaveTextContent("Connecting to me@build-box");
		await expect(canvas.getByText("Loading the agents…")).toBeInTheDocument();
		await expect(canvasElement.querySelector('[data-environment="me@build-box"] [data-slot="badge"]')).toHaveTextContent("connecting");
		await userEvent.click(canvasElement.querySelector<HTMLElement>('[data-environment="me@build-box"] [data-slot="disconnect"]')!);
		await expect(disconnected).toHaveBeenCalledTimes(1);
	},
};

const reloaded = fn(async () => {});

/** The machine's pine answered and its agents could not be loaded: what went wrong, Try again, and the machines to switch or disconnect. */
export const LoadFailed: Story = {
	args: { hosts: ["me@build-box", "studio"], state: ready, loadError: "The channel to the daemon was closed." },
	beforeEach: () => {
		reloaded.mockClear();
		store.reload = reloaded;
		return () => void delete (store as Partial<typeof store>).reload;
	},
	play: async (context) => {
		await meta.play(context);
		const { canvasElement, userEvent } = context;
		const canvas = within(canvasElement);
		await expect(canvas.getByText(/Could not load the agents on/)).toHaveTextContent("me@build-box");
		await expect(canvas.getByText("The channel to the daemon was closed.")).toBeInTheDocument();
		await expect(canvasElement.querySelector('[data-environment="me@build-box"] [data-slot="disconnect"]')).not.toBeNull();
		// No wait shown on the row: it answered, and did not load.
		await expect(canvasElement.querySelector('[data-environment="me@build-box"] [data-slot="badge"]')).toHaveTextContent("not loaded");
		await userEvent.click(canvasElement.querySelector<HTMLElement>('[data-slot="gate-reload"]')!);
		await expect(reloaded).toHaveBeenCalledTimes(1);
	},
};

// ---- Computers paired by their code (the web client's) ----

const PAIRED = "paired:q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x-_";

/** A pairing link being paired with, the computer asking the owner: the four digits it shows too, and where to answer. Its name is not known yet. */
export const PairingConfirmOnComputer: Story = {
	args: { hosts: [], state: { status: "starting", pairing: { code: "4821", name: "Chrome on Android" } } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("Confirm on your computer")).toBeInTheDocument();
		await expect(canvasElement).not.toHaveTextContent(/\bMac\b/);
		await expect(canvasElement.querySelector('[data-slot="pairing-code"]')).toHaveTextContent("4821");
		await expect(canvas.getByText(/Chrome on Android/)).toBeInTheDocument();
	},
};

/** A pairing link that expired or was used: said, with what to do next. */
export const PairingExpired: Story = {
	args: { hosts: [], canAddHost: false, pairFailed: true, state: { status: "error", kind: "ssh", message: "This pairing link has expired or was used already. Open Pine on your computer and add this device again." } },
	play: async (context) => {
		await meta.play(context);
		const canvas = within(context.canvasElement);
		await expect(canvas.getByText("Pairing failed")).toBeInTheDocument();
		await expect(canvas.getByText(/expired or was used already/)).toBeInTheDocument();
	},
};

const opened = fn(async () => {});

/** A deployment whose relay is off, nothing paired yet: how to pair in two lines (Pine > Add a device, then the code) and where the app is; no user@host field, no key for one, no link to SSH. */
export const PairFirst: Story = {
	args: { hosts: [], canAddHost: false, state: { status: "error", kind: "ssh", message: "Pair this browser with the Pine app on your computer: on your computer, choose Pine > Add a device, and scan the code it shows." } },
	beforeEach: () => {
		opened.mockClear();
		const was = window.pine.open;
		window.pine.open = opened;
		return () => void (window.pine.open = was);
	},
	play: async (context) => {
		await meta.play(context);
		const { canvasElement, userEvent } = context;
		await expect(within(canvasElement).getByText("Pair this browser with your computer")).toBeInTheDocument();
		await expect(canvasElement).not.toHaveTextContent(/\bMac\b/);
		await expect(canvasElement.querySelectorAll('[data-slot="pair-how-to"] li')).toHaveLength(2);
		await expect(canvasElement.querySelector('[data-slot="pair-how-to"]')).toHaveTextContent("On your computer: Pine > Add a device.");
		await expect(canvasElement.querySelector("input")).toBeNull();
		await expect(canvasElement.querySelector('[data-slot="device-key"]')).toBeNull();
		await expect(within(canvasElement).queryAllByText(/user@host/)).toHaveLength(0);
		// The relay is off: no link to SSH.
		await expect(canvasElement.querySelector('[data-slot="ssh-instead"]')).toBeNull();
		await userEvent.click(canvasElement.querySelector<HTMLElement>('[data-slot="get-the-app"]')!);
		await expect(opened).toHaveBeenCalledWith("https://github.com/pmndre/pine/releases/latest");
	},
};

const renamed = fn(async () => {});

/** A paired computer that does not answer: by its name, never its id, with what the owner is told and Rename and Forget on its row. */
export const PairedComputerNotReached: Story = {
	args: { hosts: [PAIRED], canAddHost: false, names: { [PAIRED]: "Studio Mac" }, state: { status: "error", kind: "ssh", host: PAIRED, message: "Studio Mac does not answer: it is off, asleep, or Pine is closed. This browser keeps trying, and connects when Studio Mac is back." } },
	beforeEach: () => {
		renamed.mockClear();
		window.pine.renameHost = async () => store.prefs;
		const was = store.renameMachine;
		store.renameMachine = renamed;
		return () => {
			delete (window.pine as Partial<typeof window.pine>).renameHost;
			store.renameMachine = was;
		};
	},
	play: async (context) => {
		await meta.play(context);
		const { canvasElement, userEvent } = context;
		await expect(within(canvasElement).getByText(/^Could not reach/)).toHaveTextContent("Could not reach Studio Mac");
		await expect(within(canvasElement).queryAllByText(/q1w2e3r4/)).toHaveLength(0);
		const row = canvasElement.querySelector<HTMLElement>(`[data-environment="${PAIRED}"]`)!;
		await expect(row).toHaveTextContent("Studio Mac");
		await expect(row).toHaveTextContent(/Studio Mac does not answer/);
		await userEvent.click(row.querySelector<HTMLElement>('[data-slot="rename-machine"]')!);
		await expect(renamed).toHaveBeenCalledWith(PAIRED);
		await expect(within(row).getByText("Forget")).toBeInTheDocument();
	},
};

// ---- A service with both: pairing first, SSH behind a link ----

const SERVICE = "pine-main.drcmda.workers.dev";

/** A browser on a computer: "Open Pine on this computer" first (`pine://pair`), the code below. */
export const BrowserOnAComputer: Story = {
	args: { hosts: [], canPair: true, openApp: true, serviceHost: SERVICE, state: { status: "error", kind: "ssh", message: "Add the machine whose pine this browser is to use, as user@host or user@host:port. Put this browser's key into ~/.ssh/authorized_keys there first." } },
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByRole("button", { name: "Open Pine on this computer" })).toBeInTheDocument();
		await expect(canvasElement.querySelector('[data-slot="pair-how-to"]')).toHaveTextContent("On your computer: Pine > Add a device.");
		await expect(canvasElement.querySelector('[data-slot="pair-nearby"]')).toBeNull();
	},
};

/** The official service, nothing added yet: how to pair, and a discreet link to SSH. Drawn still: nothing is clicked. */
export const PairOrSsh: Story = {
	args: { hosts: [], canPair: true, serviceHost: SERVICE, state: { status: "error", kind: "ssh", message: "Add the machine whose pine this browser is to use, as user@host or user@host:port. Put this browser's key into ~/.ssh/authorized_keys there first." } },
	play: async (context) => {
		await meta.play(context);
		const { canvasElement } = context;
		const canvas = within(canvasElement);
		// The pairing view: never the SSH view beside it.
		await expect(canvas.getByText("Pair this browser with your computer")).toBeInTheDocument();
		await expect(canvasElement).not.toHaveTextContent(/\bMac\b/);
		await expect(canvasElement.querySelector('[data-slot="pair-how-to"]')).not.toBeNull();
		await expect(canvasElement.querySelector('[data-slot="meeting-line"]')).toHaveTextContent(`Found through ${SERVICE}. The two devices then connect directly, or through a relay server that the computer's owner chose.`);
		await expect(canvasElement.querySelector("input")).toBeNull();
		await expect(canvasElement.querySelector('[data-slot="device-key"]')).toBeNull();
		await expect(canvasElement.querySelector('[data-slot="back-to-pairing"]')).toBeNull();
		await expect(canvas.getByRole("button", { name: "Or connect to a server over SSH" })).toBeInTheDocument();
	},
};

/** From Pair Or Ssh, the link to SSH shows the SSH view (the back control at its top, the field, the key, and the relay named), and the back control returns. */
export const PairToSshAndBack: Story = {
	args: PairOrSsh.args,
	play: async (context) => {
		await meta.play(context);
		const { canvasElement, userEvent } = context;
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Or connect to a server over SSH" }));
		// The SSH view: the back control, the field, the key, the relay named; no pairing.
		await expect(canvas.getByText("Choose a machine")).toBeInTheDocument();
		await expect(canvas.getByRole("button", { name: "Back to pairing" })).toBeInTheDocument();
		await expect(canvasElement.querySelector("input")).not.toBeNull();
		await expect(canvasElement.querySelector('[data-slot="device-key"]')).not.toBeNull();
		await expect(canvasElement.querySelector('[data-slot="relay-line"]')).toHaveTextContent(`Connections go through the relay at ${SERVICE}. The relay carries only SSH and cannot read it.`);
		await expect(canvasElement.querySelector('[data-slot="pair-how-to"]')).toBeNull();
		await expect(canvasElement.querySelector('[data-slot="ssh-instead"]')).toBeNull();
		await userEvent.click(canvas.getByRole("button", { name: "Back to pairing" }));
		await expect(canvasElement.querySelector('[data-slot="pair-how-to"]')).not.toBeNull();
		await expect(canvasElement.querySelector("input")).toBeNull();
	},
};

/**
 * Before the bridge has answered (`bridge.state()`): the logo, a skeleton for the title and one for the column's card,
 * where the first screen comes a frame later. No screen it would leave: not "Starting pine", not the machines.
 */
export const BeforeTheBridgeAnswers: Story = {
	args: { ...PairOrSsh.args, read: false },
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('[data-slot="gate-skeleton"]')).not.toBeNull();
		await expect(canvasElement.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
		await expect(canvasElement.querySelector('[data-slot="gate-machines"]')).toBeNull();
		await expect(canvasElement).not.toHaveTextContent(/Starting pine|Pair this|Choose a machine/);
	},
};

/** A browser with machines of both kinds lands on the SSH view, and each row says how its machine is reached through the service. */
export const ThroughTheService: Story = {
	args: { hosts: [PAIRED, "me@build-box"], canPair: true, serviceHost: SERVICE, names: { [PAIRED]: "Studio" }, state: { status: "starting", host: "me@build-box" } },
	play: async (context) => {
		await meta.play(context);
		const { canvasElement } = context;
		await expect(canvasElement.querySelector('[data-slot="back-to-pairing"]')).not.toBeNull();
		await expect(canvasElement.querySelector('[data-environment="me@build-box"] [data-slot="reached-through"]')).toHaveTextContent(`Through the relay at ${SERVICE}.`);
		await expect(canvasElement.querySelector(`[data-environment="${PAIRED}"] [data-slot="reached-through"]`)).toHaveTextContent(`Found through ${SERVICE}. The two devices then connect directly, or through a relay server that the computer's owner chose.`);
	},
};

/**
 * A browser with one paired computer and no user@host machine, none in use (it let go of it): the
 * pairing view, so the bridge's sentence for the SSH view (add user@host, authorized_keys) is not
 * drawn above the pairing how-to, where no user@host field is on screen.
 */
export const PairedNoneInUse: Story = {
	args: { hosts: [PAIRED], canPair: true, serviceHost: SERVICE, names: { [PAIRED]: "Studio" }, state: { status: "error", kind: "ssh", message: "Add the machine whose pine this browser is to use, as user@host or user@host:port. Put this browser's key into ~/.ssh/authorized_keys there first." } },
	play: async (context) => {
		await meta.play(context);
		const { canvasElement } = context;
		const canvas = within(canvasElement);
		await expect(canvas.getByText("Choose a machine")).toBeInTheDocument();
		await expect(canvasElement.querySelector('[data-slot="pair-how-to"]')).not.toBeNull();
		await expect(canvasElement.querySelector("input")).toBeNull();
		await expect(canvasElement).not.toHaveTextContent(/user@host|authorized_keys/);
	},
};

// ---- The mobile app, pairing from a link in the owner's hand ----

const NO_MACHINE = "Add the machine whose pine this phone is to use, as you would write it after ssh: user@host, or user@host:port. Put this phone's key into ~/.ssh/authorized_keys there first.";

/** A phone whose app pairs, nothing added yet: pairing first, with a field to paste a link that did not open the app, and SSH behind a link. */
export const PhonePairFirst: Story = {
	args: { hosts: [], canPair: true, phone: true, state: { status: "error", kind: "ssh", message: NO_MACHINE } },
	play: async (context) => {
		await meta.play(context);
		const { canvasElement } = context;
		const canvas = within(canvasElement);
		await expect(canvas.getByText("Pair this phone with your computer")).toBeInTheDocument();
		await expect(canvasElement.querySelector('[data-slot="pair-how-to"]')).toHaveTextContent(/this phone's camera/);
		await expect(canvasElement.querySelector('[data-slot="pair-link-field"]')).not.toBeNull();
		await expect(canvasElement.querySelector('[data-slot="ssh-instead"]')).not.toBeNull();
		// No service is named for the whole app: each paired computer has its own.
		await expect(canvasElement.querySelector('[data-slot="meeting-line"]')).toBeNull();
	},
};

/** The computer shows the four digits beside the phone's name; the owner can end the pairing from the phone. */
export const PhonePairing: Story = {
	args: { hosts: [], canPair: true, phone: true, state: { status: "starting", pairing: { code: "4821", name: "Pine on Pixel 9" } } },
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('[data-slot="pairing-code"]')).toHaveTextContent("4821");
		await expect(within(canvasElement).getByText(/Pine on Pixel 9/)).toBeInTheDocument();
		await expect(canvasElement.querySelector('[data-slot="cancel-pairing"]')).not.toBeNull();
	},
};

// ---- The mobile app, pairing with a computer found on the network ----

const ID = "x8Qk2vJp1mZl3nRt5yWb7cDf9gHs0aEu4iOq6eTr2wA";
const NONCE = "Zm9vYmFyYmF6cXV4cXV1eA";

/** Two computers found on this network, each "Pine" and the start of its id; one through a service of its owner's own. Below, the code as before. */
export const PhoneNearbyFound: Story = {
	args: { hosts: [], canPair: true, phone: true, state: { status: "error", kind: "ssh", message: NO_MACHINE }, nearby: { computers: [{ id: ID, service: "https://pine-main.drcmda.workers.dev", nonce: NONCE }, { id: `Zq${ID.slice(2)}`, service: "https://pine.example.org", nonce: NONCE }] } },
	play: async ({ canvasElement }) => {
		// What the bridge found arrives once the list listens (an effect), after the first drawing.
		await waitFor(() => expect(canvasElement.querySelectorAll('[data-slot="pair-nearby-computer"]')).toHaveLength(2));
		const found = canvasElement.querySelectorAll('[data-slot="pair-nearby-computer"]');
		await expect(found[0]).toHaveTextContent("Pine x8Qk2v");
		await expect(found[1]).toHaveTextContent(/Through pine\.example\.org/);
		await expect(within(canvasElement).getByText("Or pair with a code")).toBeInTheDocument();
		await expect(canvasElement.querySelector('[data-slot="pair-link-field"]')).not.toBeNull();
	},
};

/** Looking, nothing found yet: a spinner, and what the computer needs. */
export const PhoneNearbyEmpty: Story = {
	args: { hosts: [], canPair: true, phone: true, state: { status: "error", kind: "ssh", message: NO_MACHINE }, nearby: { computers: [] } },
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('[data-slot="pair-nearby-empty"]')).toHaveTextContent("No computer found on this network yet. Pine must be open there, with Browser access turned on.");
	},
};

/** iOS refused the app the local network: how to allow it, and the code below still works. */
export const PhoneNearbyRefused: Story = {
	args: { hosts: [], canPair: true, phone: true, state: { status: "error", kind: "ssh", message: NO_MACHINE }, nearby: { computers: [], denied: true } },
	play: async ({ canvasElement }) => {
		await waitFor(() => expect(canvasElement.querySelector('[data-slot="pair-nearby-denied"]')).toHaveTextContent(/Settings > Pine/));
		await expect(canvasElement.querySelector('[data-slot="pair-link-field"]')).not.toBeNull();
	},
};

/** A computer found on the network answered: its own name now, with the four digits. */
export const PhoneNearbyConfirm: Story = {
	args: { hosts: [], canPair: true, phone: true, state: { status: "starting", pairing: { code: "4821", name: "Pine on iPhone", computer: "Studio Mac" } }, nearby: { computers: [] } },
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByText("Confirm on Studio Mac")).toBeInTheDocument();
		await expect(canvasElement.querySelector('[data-slot="pairing-code"]')).toHaveTextContent("4821");
	},
};

/** A phone whose app does not say it can pair (a platform whose native side is not done): the SSH view as before, nothing of pairing. */
export const PhoneWithoutPairing: Story = {
	args: { hosts: [], phone: true, state: { status: "error", kind: "ssh", message: NO_MACHINE } },
	play: async (context) => {
		await meta.play(context);
		const { canvasElement } = context;
		await expect(within(canvasElement).getByText("Choose a machine")).toBeInTheDocument();
		await expect(canvasElement.querySelector("input")).not.toBeNull();
		for (const slot of ["pair-how-to", "pair-link-field", "ssh-instead", "back-to-pairing", "cancel-pairing"]) await expect(canvasElement.querySelector(`[data-slot="${slot}"]`)).toBeNull();
	},
};
