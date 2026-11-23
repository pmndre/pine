import type { Meta, StoryObj } from "@storybook/react-vite";
import { Printed } from "./printed.tsx";

const lines = Array.from({ length: 30 }, (_, i) => `\u001b[32mok\u001b[0m line ${i + 1} of what the program printed`).join("\n");

// What a tool or a program printed, with its terminal colors; `sm` caps its height where several follow each other.
const meta = {
	title: "Components/Printed",
	component: Printed,
	args: { text: "$ npm test\n\u001b[32m✔\u001b[0m 42 tests passed" },
	parameters: { layout: "padded" },
} satisfies Meta<typeof Printed>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Failed: Story = { args: { text: "$ npm test\n\u001b[31m✖\u001b[0m 1 test failed", failed: true } };

export const Small: Story = { args: { text: lines, sm: true } };

/** While it loads: its own shape, from stock Skeleton blocks. */
export const PrintedSkeleton: Story = { args: { skeleton: true } as never };
