import type { Meta, StoryObj } from "@storybook/react-vite";
import { XIcon } from "lucide-react";
import { fn } from "storybook/test";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "./agent-avatar.tsx";
import { TabMenu } from "./tab-menu.tsx";

// The menu of a tab in the title bar, opened as the owner opens it: with a right click on the tab.
const meta = { title: "Components/TabMenu", component: TabMenu } satisfies Meta<typeof TabMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

const tab = (agent: string, name?: string) => (
	<div data-slot="tab" className="flex h-8 w-52 items-center gap-2 rounded-md bg-background pr-1.5 pl-2.5 text-foreground ring-1 ring-border">
		<AgentAvatar agent={{ id: agent, color: "#5a8de0" }} size="sm" />
		<span className="truncate">
			<b className="font-medium">{agent}</b>
			{name ? ` · ${name}` : null}
		</span>
		<span className="flex-1" />
		<Button variant="ghost" size="icon-xs" aria-label="Close this tab"><XIcon /></Button>
	</div>
);

// At the tab, as a mouse would: the menu opens where the pointer is.
const rightClick: Story["play"] = async ({ canvas, userEvent }) => {
	const target = canvas.getByText(/scout/);
	const at = target.getBoundingClientRect();
	await userEvent.pointer({ keys: "[MouseRight]", target, coords: { clientX: at.left + 8, clientY: at.bottom - 4 } });
};

/** A conversation that is not pinned, with tabs on both sides: every entry can be chosen, and Pin is offered. */
export const Conversation: Story = {
	args: { trigger: tab("scout", "the landing page"), pin: "pin", onAction: fn() },
	play: rightClick,
};

/** A pinned conversation in the last tab: Unpin is offered, and there is nothing to its right to close. */
export const PinnedLast: Story = {
	args: { trigger: tab("scout", "release notes"), pin: "unpin", right: false, onAction: fn() },
	play: rightClick,
};

/** An agent's main conversation, the only tab: it can be closed, and Pin is there but cannot be chosen, since main always stays. */
export const MainAlone: Story = {
	args: { trigger: tab("scout"), pin: "main", others: false, right: false, onAction: fn() },
	play: rightClick,
};

/** A conversation tab in the desktop app, where `Move to New Window` splits it out into a window of its own. */
export const MoveToNewWindow: Story = {
	args: { trigger: tab("scout", "the landing page"), pin: "pin", moveToWindow: true, onAction: fn() },
	play: rightClick,
};
