import type { Meta, StoryObj } from "@storybook/react-vite";
import { EventLines, Events as View } from "./Events.tsx";
import { Tab } from "./model.ts";

// The event log without a daemon: each story sets its tab as the store would.
const meta = { component: View, parameters: { layout: "fullscreen" }, decorators: [(Story) => <div className="flex h-96 p-2"><Story /></div>] } satisfies Meta<typeof View>;
export default meta;

type Story = StoryObj<typeof meta>;

const tab = (set: (t: Tab) => void) => {
	const t = new Tab("events", "events", "");
	t.loaded = true;
	set(t);
	return t;
};

export const Events: Story = {
	args: {
		tab: tab((t) => {
			t.log = [
				{ id: 1, ts: Date.UTC(2026, 0, 1, 9), topic: "agent/main/task", source: "daemon", trust: "owner", payload: { task: 1, status: "running" } },
				{ id: 2, ts: Date.UTC(2026, 0, 1, 9, 1), topic: "schedule/fired", source: "scheduler", trust: "other", payload: { name: "morning" } },
			] as Tab["log"];
		}),
	},
};

/** The first fetch is still out: skeleton lines, not "No events yet". */
export const EventsLoading: Story = { args: { tab: tab((t) => (t.logLoading = true)) } };

/** The fetch failed: said, with a way to ask again. */
export const EventsError: Story = { args: { tab: tab((t) => (t.logError = "The daemon did not answer")) } };

/** Loaded, and nothing was published yet. */
export const EventsEmpty: Story = { args: { tab: tab(() => {}) } };

/** The skeleton lines alone. */
export const EventLinesSkeleton: StoryObj<typeof EventLines> = { render: () => <EventLines skeleton /> };
