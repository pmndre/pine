import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActivityStrip } from "./activity-strip.tsx";

// How much happened over the bird's-eye view's fifteen minutes, read only.
const meta = { title: "Birdview/ActivityStrip", component: ActivityStrip, decorators: [(Story) => <div className="w-full max-w-xl p-4">{Story()}</div>] } satisfies Meta<typeof ActivityStrip>;
export default meta;
type Story = StoryObj<typeof meta>;

const size = 10_000;
const end = 1_800_000_000_000;

export const Quiet: Story = { args: { histogram: { end, size, counts: Array.from({ length: 90 }, (_, i) => (i % 17 === 3 ? 2 : 0)) } } };

export const WithABurst: Story = { args: { histogram: { end, size, counts: Array.from({ length: 90 }, (_, i) => (i > 44 && i < 52 ? 12 + (i % 3) * 4 : i % 7 === 0 ? 3 : 1)) } } };
