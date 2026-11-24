import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PageMenu } from "./page-menu.tsx";

const meta = { title: "Components/PageMenu", component: PageMenu } satisfies Meta<typeof PageMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Conversation: Story = {
	args: {
		at: { x: 48, y: 48 },
		onDone: fn(),
		items: [
			{ id: "open", label: "Open" },
			{ id: "branch", label: "Branch" },
			{ id: "pin", label: "Pin" },
			{ id: "rename", label: "Rename…" },
			{ id: "move", label: "Move to Group…" },
			{ id: "sep", label: "", separator: true },
			{ id: "remove", label: "Remove…" },
		],
	},
};

export const Choices: Story = {
	args: {
		at: { x: 48, y: 48 },
		onDone: fn(),
		items: [
			{ id: "new", label: "New conversation with scout" },
			{ id: "group", label: "New Group…" },
			{ id: "sep0", label: "", separator: true },
			{ id: "recent", label: "Sort by Last Used", checked: true },
			{ id: "name", label: "Sort by Name", checked: false },
			{ id: "sep", label: "", separator: true },
			{ id: "remove", label: "Remove scout…", enabled: false },
		],
	},
};
