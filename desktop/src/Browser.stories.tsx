import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { BrowserSkeleton } from "./Browser.tsx";

// The browser's own view needs a conversation and the daemon; its skeleton is drawn alone.
const meta = {
	component: BrowserSkeleton,
	render: () => (
		<div className="flex h-96 flex-col">
			<BrowserSkeleton className="min-h-0 flex-1" />
		</div>
	),
} satisfies Meta<typeof BrowserSkeleton>;
export default meta;
type Story = StoryObj<typeof meta>;

/** While the browser is looked for, and before the first picture of its page: a page-shaped skeleton. */
export const BrowserViewSkeleton: Story = {
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector("[data-slot=browser-skeleton] [data-slot=skeleton]")).not.toBeNull();
	},
};
