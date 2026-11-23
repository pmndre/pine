import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { TerminalSkeleton as Shape } from "./Terminal.tsx";

// The terminal itself needs the main process's shell; its skeleton is drawn alone.
const meta = {
	component: Shape,
	render: () => (
		<div className="flex h-64 flex-col">
			<Shape className="min-h-0 flex-1" />
		</div>
	),
} satisfies Meta<typeof Shape>;
export default meta;
type Story = StoryObj<typeof meta>;

/** While the shell starts: a few skeleton lines. */
export const TerminalSkeleton: Story = {
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelectorAll("[data-slot=terminal-skeleton] [data-slot=skeleton]").length).toBeGreaterThan(0);
	},
};
