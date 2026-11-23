import type { Meta, StoryObj } from "@storybook/react-vite";
import { ZapIcon } from "lucide-react";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { AgentSection as Section } from "./AgentView.tsx";

// One section of the Agent panel: loaded, loading, failed and empty.
const meta = { title: "AgentView/AgentSection", component: Section, args: { title: "Listens to" } } satisfies Meta<typeof Section>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Loaded, with one row. */
export const AgentSection: Story = {
	args: {
		count: 1,
		children: (
			<Item size="xs">
				<ItemMedia><ZapIcon /></ItemMedia>
				<ItemContent>
					<ItemTitle>scans</ItemTitle>
					<ItemDescription>a file lands in ~/Scans</ItemDescription>
				</ItemContent>
			</Item>
		),
	},
};

/** While it first loads: its title and a few row bars. */
export const AgentSectionSkeleton: Story = { args: { skeleton: true } };

/** It failed to load: the reason, in place of its rows. */
export const AgentSectionError: Story = { args: { error: "pine did not answer: connection refused" } };

/** Loaded and empty. */
export const AgentSectionEmpty: Story = { args: { count: 0, children: <div className="px-3.5 py-0.5 text-faint">Nothing wakes it by itself.</div> } };
