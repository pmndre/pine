import type { Meta, StoryObj } from "@storybook/react-vite";
import { GlobeIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SideSheet } from "./side-sheet.tsx";

// Something beside a conversation: a resizable column where the window has room, a sheet over it where it has none.
const meta = {
	title: "Components/SideSheet",
	component: SideSheet,
	args: {
		id: "story-panel",
		slot: "story-panel",
		title: "Browser",
		sheet: false,
		defaultWidth: 360,
		barClassName: "pl-3 text-sm font-medium",
		onClose: () => {},
		bar: (
			<>
				<GlobeIcon className="size-3.5 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate">Browser</span>
				<Button variant="ghost" size="icon-xs" aria-label="Close the browser"><XIcon /></Button>
			</>
		),
		children: <p className="p-3 text-sm text-muted-foreground">What the panel shows.</p>,
	},
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SideSheet>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Beside the conversation, in a window with room: its edge drags it wider or narrower. */
export const Column: Story = {
	render: (args) => (
		<div className="flex h-96 p-1.5">
			<ResizablePanelGroup orientation="horizontal">
				<ResizablePanel id="view" className="flex" minSize={200}>
					<p className="p-3 text-sm">The conversation.</p>
				</ResizablePanel>
				<SideSheet {...args} />
			</ResizablePanelGroup>
		</div>
	),
};

/** Beside the conversation at a wider saved width. */
export const WideColumn: Story = {
	render: Column.render,
	args: { defaultWidth: 520 },
};

/** Over the conversation, in a window without room for a column. */
export const Sheet: Story = { args: { sheet: true } };
