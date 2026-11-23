import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { AgentDetail, JobLine, ViewFrameSkeleton as Frame } from "./View.tsx";

// The view's parts while the world is seeded and the view's code loads: no daemon, no frame.
const meta = {
	component: Frame,
} satisfies Meta<typeof Frame>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The view's frame until the view says it is ready. */
export const ViewFrameSkeleton: Story = {
	render: () => (
		<div className="relative h-80">
			<Frame className="absolute inset-0" />
		</div>
	),
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector("[data-slot=view-frame-skeleton] [data-slot=skeleton]")).not.toBeNull();
	},
};

/** A line of work while the world is seeded: the feed shows these, not "Nothing yet". */
export const JobLineSkeleton: Story = {
	render: () => (
		<div className="flex w-96 flex-col gap-1.5 p-3 text-xs">
			<JobLine skeleton />
			<JobLine skeleton />
			<JobLine skeleton />
		</div>
	),
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelectorAll("[data-slot=job-line-skeleton]")).toHaveLength(3);
		await expect(canvasElement).not.toHaveTextContent(/Nothing yet/);
	},
};

/** An agent chosen while the world is seeded. */
export const AgentDetailSkeleton: Story = {
	render: () => (
		<div className="flex w-96 flex-col gap-1.5 p-3 text-xs">
			<AgentDetail skeleton />
		</div>
	),
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector("[data-slot=agent-detail-skeleton]")).not.toBeNull();
	},
};
