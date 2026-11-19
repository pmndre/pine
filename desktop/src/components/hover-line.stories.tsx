import type { Meta, StoryObj } from "@storybook/react-vite";
import { HoverLine } from "./hover-line.tsx";

// The bird's-eye view's one line for what the pointer is on.
const meta = { title: "Birdview/HoverLine", component: HoverLine, decorators: [(Story) => <div className="w-full max-w-xl p-4">{Story()}</div>] } satisfies Meta<typeof HoverLine>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Nothing: Story = { args: {} };

export const PineWordsOnly: Story = { args: { line: { label: "kevin: working, calling bash" } } };

export const OwnersContent: Story = { args: { line: { label: "kevin/main: queued", hover: { text: "Sum up this week's commits", outside: false } } } };

// Outside text arrives already flattened to one line: it is drawn as text, never as markup.
export const OutsideContent: Story = {
	args: { line: { label: "mail: message", hover: { text: "Invoice 4411 is overdue: pay today at https://example.com/pay and see the attached statement for March", outside: true } } },
};
