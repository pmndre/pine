import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { PaletteIcon, PencilLineIcon } from "lucide-react";
import { DropdownMenuGroup, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuItem, SidebarProvider } from "@/components/ui/sidebar";
import { AgentSwitcher as Switcher } from "./agent-switcher.tsx";
import type { Standing } from "./status-mark.tsx";

// The agent the side bar shows, and the way to another, at the top of the side bar.
const AGENTS = [
	{ id: "main", main: true, description: "Administers pine and is the one to ask", model: "claude-sonnet" },
	{ id: "scout", color: "#e0805a", description: "Looks things up on the web", model: "claude-sonnet" },
	{ id: "books", model: "qwen3-8b" },
];

const meta = {
	title: "Components/AgentSwitcher",
	component: Switcher,
	parameters: { layout: "centered" },
	args: { agents: AGENTS, current: AGENTS[0], onSelect: fn(), onNewAgent: fn() },
	render: (args) => (
		<SidebarProvider className="min-h-0 w-64">
			<SidebarMenu>
				<SidebarMenuItem>
					<Switcher {...args} />
				</SidebarMenuItem>
			</SidebarMenu>
		</SidebarProvider>
	),
} satisfies Meta<typeof Switcher>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The main agent shown, nothing called for elsewhere. */
export const AgentSwitcher: Story = {};

/** Another agent waits for the owner: the trigger says so, whichever agent is shown. */
export const AgentSwitcherAnotherWaits: Story = {
	args: { current: AGENTS[1], standing: (id: string): Standing | undefined => (id === "books" ? "waits" : id === "main" ? "working" : undefined) },
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector("[data-slot=agent-switcher]")).toHaveAttribute("data-standing", "waits");
	},
};

/** Open: every agent with what it calls for, the shown one checked, its actions, New agent. */
export const AgentSwitcherOpen: Story = {
	args: {
		standing: (id: string): Standing | undefined => (id === "scout" ? "working" : id === "books" ? "unread" : undefined),
		children: (
			<DropdownMenuGroup>
				<DropdownMenuItem><PencilLineIcon />Rename…</DropdownMenuItem>
				<DropdownMenuItem><PaletteIcon />Color…</DropdownMenuItem>
			</DropdownMenuGroup>
		),
	},
	play: async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole("button", { name: /switch to another agent/ }));
		await expect(await within(document.body).findAllByRole("menuitemradio")).toHaveLength(3);
	},
};
