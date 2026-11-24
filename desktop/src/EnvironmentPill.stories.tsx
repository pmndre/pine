import type { Meta, StoryObj } from "@storybook/react-vite";
import { EnvironmentPill } from "./App.tsx";
import type { ServiceState } from "./bridge.ts";
import { store } from "./model.ts";

function PillPreview({ service, connected = true, hosts = ["me@build-box", "studio"] }: { service: ServiceState; connected?: boolean; hosts?: string[] }) {
	store.platform = "darwin";
	store.prefs = { ...store.prefs, hosts };
	store.service = service;
	store.connected = connected;
	return (
		<div className="flex h-11 items-center justify-end rounded-lg border bg-sidebar px-3">
			<EnvironmentPill />
		</div>
	);
}

const meta = { component: PillPreview, parameters: { layout: "padded" } } satisfies Meta<typeof PillPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Title bar environment pill when viewing a remote SSH machine. */
export const Remote: Story = {
	args: {
		service: { status: "ready", mode: "on build-box", started: false, home: "build-box:~/.pine", version: "0.23.0", from: "ssh me@build-box", host: "me@build-box", label: "build-box" },
	},
};

/** Title bar environment pill on this computer when the sidebar is collapsed. */
export const LocalCollapsed: Story = {
	args: {
		service: { status: "ready", mode: "safe", started: true, home: "/Users/owner/.pine", version: "0.23.0", from: "checkout" },
	},
};

/** Title bar environment pill while connecting to a remote machine. */
export const Connecting: Story = {
	args: {
		service: { status: "starting", host: "studio" },
		connected: false,
	},
};

/** Title bar environment pill when a remote machine could not be reached. */
export const Error: Story = {
	args: {
		service: { status: "error", kind: "ssh", message: "Permission denied (publickey).", host: "studio" },
		connected: false,
	},
};
