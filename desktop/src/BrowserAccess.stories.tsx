import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { AccessState } from "./bridge.ts";
import { BrowserAccessFailed, BrowserAccessSkeleton as AccessSkeleton, BrowserAccessView } from "./BrowserAccess.tsx";

// Settings > Browser access drawn from a state, as the main process tells it: no bridge, the calls
// are stand-ins, and the clock is fixed so that the time left and "last connected" stay the same.
const NOW = Date.parse("2026-11-20T10:00:00Z");
const SERVICE = "https://pine.example.workers.dev";

const off: AccessState = { enabled: false, visible: true, service: SERVICE, openAtLogin: false, status: "off", devices: [] };
const devices: AccessState["devices"] = [
	{ id: "d1", name: "Chrome on Android", paired: "2026-11-02T08:12:00Z", seen: "2026-11-20T09:58:00Z", connected: { path: "lan" } },
	{ id: "d2", name: "Safari on iPhone", paired: "2026-10-14T19:40:00Z", seen: "2026-11-19T22:05:00Z" },
	{ id: "d3", name: "Firefox on Linux, the laptop in the kitchen that everybody uses on Sundays", paired: "2026-11-20T09:30:00Z", connected: { path: "ipv6" } },
];
const waiting: AccessState = { ...off, enabled: true, openAtLogin: true, status: "waiting", devices };

const meta = {
	component: BrowserAccessView,
	// No docs page: it would open every story's dialog at once, one over the other.
	tags: ["!autodocs"],
	parameters: { layout: "fullscreen" },
	args: { state: off, now: NOW, platform: "darwin", actions: { set: fn(async () => {}), add: fn(), remove: fn() } },
	render: (args) => (
		<div className="@container/settings mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-6 pb-16">
			<BrowserAccessView {...args} />
		</div>
	),
} satisfies Meta<typeof BrowserAccessView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Off, as a fresh app has it: nothing contacted, no device. On a Mac the section is about "This Mac". */
export const Off: Story = {
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByText("This Mac")).toBeInTheDocument();
	},
};

/** The app on another system than macOS: the section is about "This computer", and no text says Mac. */
export const NotAMac: Story = {
	args: { state: waiting, platform: "linux" },
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByText("This computer")).toBeInTheDocument();
		await expect(canvasElement).not.toHaveTextContent(/\bMac\b/);
	},
};

/** Turned on the first time: "Open Pine at login" is offered, checked. */
export const TurningOn: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(within(canvasElement).getByRole("switch", { name: /Browser access/ }));
		const dialog = await within(document.body).findByRole("alertdialog");
		await expect(within(dialog).getByRole("checkbox", { name: "Open Pine at login" })).toBeChecked();
	},
};

/** No service address (a build that names no official one): the problem is said under the switch. */
export const NeedsAnAddress: Story = {
	args: { state: { ...off, service: "", problem: { kind: "address", message: "Browser access needs the address of the service that a browser opens. Enter the address of your own deployment of pine's web client." } } },
};

/** On and waiting at the service, with devices: one connected on the same network, one seen yesterday, one connected directly over IPv6 with a long name. */
export const Waiting: Story = { args: { state: waiting } };

/** On, and the service cannot be reached. */
export const Unreachable: Story = { args: { state: { ...waiting, status: "unreachable" } } };

/** Add a device asks the app to open a pairing; the dialog is DevicePairing.tsx's, shown anywhere in the app. */
export const AddADevice: Story = {
	args: { state: waiting },
	play: async ({ canvasElement, args }) => {
		await userEvent.click(within(canvasElement).getByRole("button", { name: /Add a device/ }));
		await expect(args.actions.add).toHaveBeenCalled();
	},
};

/** Not visible on this network: phones on it do not find this Mac; the code still works. */
export const NotVisible: Story = {
	args: { state: { ...waiting, visible: false } },
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByRole("switch", { name: "Visible on this network" })).not.toBeChecked();
	},
};

/** Visibility paused after three refusals: said under the switch, which turns it back on at once. */
export const VisibilityPaused: Story = {
	args: { state: { ...waiting, paused: new Date(NOW + 3_000_000).toISOString() } },
	play: async ({ canvasElement, args }) => {
		const visible = within(canvasElement).getByRole("switch", { name: "Visible on this network" });
		await expect(visible).not.toBeChecked();
		await expect(canvasElement).toHaveTextContent(/after 3 refusals/);
		await userEvent.click(visible);
		await expect(args.actions.set).toHaveBeenCalledWith({ visible: true });
	},
};

/** No relay server: its fields are empty, with the sentence that says when one is used. */
export const NoRelay: Story = {
	args: { state: waiting },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("Relay server (TURN)")).toBeInTheDocument();
		await expect(canvas.getByText(/Used when a direct connection is not possible/)).toBeInTheDocument();
		await expect(canvas.getByLabelText("Address")).toHaveValue("");
		await expect(canvasElement.querySelector("[data-slot=relay-check]")).toBeNull();
	},
};

const RELAY = { address: "turn:relay.example.com:3478", username: "pine" };

/** A relay that gave this Mac an address, and a device connected through it. The password field shows that one is kept, never the password. */
export const RelayUsable: Story = {
	args: {
		state: {
			...waiting,
			devices: [{ ...devices[0], connected: { path: "relay" } }, devices[1]],
			relay: { ...RELAY, password: true, check: { result: "usable", message: "This relay works. It gave this Mac an address." } },
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByLabelText("Password")).toHaveValue("");
		await expect(canvas.getByLabelText("Password")).toHaveAttribute("placeholder", expect.stringMatching(/^Kept/));
		await expect(canvas.getByText(/relayed/)).toBeInTheDocument();
	},
};

/** Another address typed over a relay whose password is kept: the field says that password is not kept for it. */
export const RelayMoved: Story = {
	args: { state: { ...waiting, relay: { ...RELAY, password: true } } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const address = canvas.getByLabelText("Address");
		await userEvent.clear(address);
		await userEvent.type(address, "turn:other.example.com:3478");
		await expect(canvas.getByLabelText("Password")).toHaveAttribute("placeholder", expect.stringMatching(/^The saved password was for another address/));
	},
};

/** A relay that refused the user name or password: it is kept, and the line under it says what to check. */
export const RelayRefused: Story = {
	args: {
		state: { ...waiting, relay: { ...RELAY, password: true, check: { result: "failed", message: "Could not use this relay because it refused the user name or password. The relay is saved. Check both and save again." } } },
	},
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByText(/refused the user name or password/)).toBeInTheDocument();
	},
};

/** While the state loads: its three sections as skeleton. */
export const BrowserAccessSkeleton: Story = {
	render: () => (
		<div className="@container/settings mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-6 pb-16">
			<AccessSkeleton />
		</div>
	),
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelectorAll("[data-slot=access-skeleton]")).toHaveLength(3);
		await expect(canvasElement.querySelector("[data-slot=skeleton]")).not.toBeNull();
	},
};

/** The state could not be read: the error is said, not a blank page. */
export const BrowserAccessLoadError: Story = {
	render: () => (
		<div className="@container/settings mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-6 pb-16">
			<BrowserAccessFailed error="The main process did not answer." />
		</div>
	),
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByText(/did not answer/)).toBeInTheDocument();
	},
};
