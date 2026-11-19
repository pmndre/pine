import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { BirdviewDemo } from "../birdview-demo.tsx";

// Direction A of the bird's-eye view: agents on a ring, conversations orbiting, sources outside.
// Each story loops a stretch of fake activity; in Chromatic it stands still at `at`.
const meta = {
	title: "Birdview/Constellation",
	component: BirdviewDemo,
	tags: ["!autodocs"],
	parameters: { layout: "fullscreen" },
	args: { direction: "constellation", onAgent: fn(), onConversation: fn(), onSetting: fn(), onEvents: fn() },
} satisfies Meta<typeof BirdviewDemo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Calm: Story = { args: { scene: "calm", from: 0, to: 20, at: 10 } };

export const Busy: Story = { args: { scene: "busy", from: 0, to: 20, at: 8.6 } };

export const Delegation: Story = { args: { scene: "story", from: 7.5, to: 12.5, at: 9.2 } };

export const OutsideContent: Story = { args: { scene: "story", from: 0.5, to: 5, at: 3.2 } };

export const ApprovalWaiting: Story = { args: { scene: "story", from: 4.5, to: 9.4, at: 6.5 } };
