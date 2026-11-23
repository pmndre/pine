import type { Meta, StoryObj } from "@storybook/react-vite";
import { Listbox } from "@ui-sdk/react/listbox";
import { Tree, TreeItem } from "@ui-sdk/react/tree";
import { ChangeRow, DirRow } from "./CodePanel.tsx";
import { LISTBOX, TREE_ITEM } from "./lists.tsx";

// The rows of the code panel: a changed file in Changes and Last turn, and a row of the file tree.
const meta = {
	title: "CodePanel",
	parameters: { layout: "padded" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ChangeRowDefault: Story = {
	render: () => (
		<Listbox aria-label="Changed files" className="outline-none" {...LISTBOX}>
			<ChangeRow c={{ path: "src/model.ts", status: "M", added: 12, removed: 3 }} />
			<ChangeRow c={{ path: "README.md", status: "?", added: 40, removed: 0 }} />
		</Listbox>
	),
};

/** While the list loads: rows of its shape, from stock Skeleton blocks. */
export const ChangeRowSkeleton: Story = { render: () => <div className="flex flex-col">{[0, 1, 2].map((i) => <ChangeRow key={i} skeleton />)}</div> };

export const DirRowDefault: Story = {
	render: () => (
		<Tree aria-label="Files" className="outline-none">
			<TreeItem value="src" label="src" branch className={TREE_ITEM}><DirRow name="src" dir size={0} depth={0} open /></TreeItem>
			<TreeItem value="src/main.ts" label="main.ts" className={TREE_ITEM}><DirRow name="main.ts" dir={false} size={2048} depth={1} /></TreeItem>
		</Tree>
	),
};

/** While a folder is read: rows of its shape, at its depth. */
export const DirRowSkeleton: Story = { render: () => <div className="flex flex-col">{[0, 1, 2].map((i) => <DirRow key={i} depth={1} skeleton />)}</div> };
