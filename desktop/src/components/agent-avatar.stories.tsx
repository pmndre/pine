import type { Meta, StoryObj } from "@storybook/react-vite";
import { AGENT_COLOURS } from "../theme.ts";
import { AgentAvatar as Avatar } from "./agent-avatar.tsx";

// An agent's initial: the stock avatar without a colour of its own, drawn in its colour with one.
const meta = { title: "Components/AgentAvatar", component: Avatar } satisfies Meta<typeof Avatar>;
export default meta;
type Story = StoryObj<typeof meta>;

/** An agent without a colour: the stock avatar, as every agent had before. */
export const AgentAvatar: Story = { args: { agent: { id: "main" } } };

/** An agent in coral. */
export const AgentAvatarColoured: Story = { args: { agent: { id: "scout", color: "#e0805a" }, size: "lg" } };

/** Every preset at the side bar's size, beside an agent without one. */
export const AgentAvatarPresets: Story = {
	args: { agent: { id: "main" }, size: "sm" },
	render: (args) => (
		<div className="flex items-center gap-2">
			<Avatar {...args} />
			{AGENT_COLOURS.map((c) => (
				<Avatar key={c.hex} agent={{ id: c.name, color: c.hex }} size={args.size} />
			))}
		</div>
	),
};
