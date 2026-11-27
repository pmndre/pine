import type { Meta, StoryObj } from "@storybook/react-vite";
import { ClockIcon, ZapIcon } from "lucide-react";
import { ItemGroup } from "@/components/ui/item";
import { AgentRow, AgentSection as Section } from "./AgentView.tsx";

// One part of the side panel's Agent tab: loaded, loading, failed and empty.
const meta = { title: "AgentView/AgentSection", component: Section, args: { title: "Sources", manage: () => {} } } satisfies Meta<typeof Section>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Loaded: a row that opens its thing, and one that says whom it is for when that is not this agent. */
export const AgentSection: Story = {
	args: {
		children: (
			<ItemGroup>
				<AgentRow media={<ZapIcon />} title="scans" about="a file lands in ~/Scans" onOpen={() => {}} />
				<AgentRow media={<ZapIcon />} title="mail" about="tell me what needs an answer today" tag="all agents" onOpen={() => {}} />
			</ItemGroup>
		),
	},
};

/** A row that only says something: nothing to open. */
export const AgentSectionRead: Story = { args: { title: "At work", manage: undefined, children: <AgentRow media={<ClockIcon />} title="this conversation" about="working · 3 tool calls" /> } };

/** While it first loads: bars of a row's shape. */
export const AgentSectionSkeleton: Story = { args: { skeleton: true } };

/** It failed to load: the reason, in place of its rows. */
export const AgentSectionError: Story = { args: { error: "pine did not answer: connection refused" } };

/** Loaded and empty: a line that says so, and how to get one. */
export const AgentSectionEmpty: Story = { args: { empty: "Nothing wakes scout yet. Ask it to watch something, such as “tell me when a file lands in ~/Scans”." } };
