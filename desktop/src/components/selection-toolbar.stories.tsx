import type { Meta, StoryObj } from "@storybook/react-vite";
import { QuoteIcon } from "lucide-react";
import { useRef } from "react";
import { fn, within } from "storybook/test";
import { SelectionToolbar as Bar, SelectionToolbarButton, useTextSelection } from "./selection-toolbar.tsx";

const meta = { title: "Components/SelectionToolbar", component: Bar } satisfies Meta<typeof Bar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SelectionToolbar: Story = {
	args: {},
	render: (args) => (
		<Bar {...args}>
			<SelectionToolbarButton icon={QuoteIcon} label="Quote" onClick={fn()} />
		</Bar>
	),
};

function Selecting({ onQuote }: { onQuote: (text: string) => void }) {
	const root = useRef<HTMLDivElement>(null);
	const frame = useRef<HTMLDivElement>(null);
	const [selected, unselect] = useTextSelection(root);
	return (
		<div ref={frame} className="flex h-80 max-w-xl flex-col rounded-xl border bg-background">
			<div ref={root} className="flex-1 overflow-auto p-7 text-sm leading-relaxed">
				<p data-testid="answer">The build passed on the second run. The first failed because the cache held an old copy of the lockfile, so the install took the versions of last week.</p>
				<p className="mt-3">Clearing the cache before the install keeps it from happening again.</p>
			</div>
			{selected ? (
				<Bar rect={selected.rect} bounds={frame}>
					<SelectionToolbarButton icon={QuoteIcon} label="Quote" onClick={() => (onQuote(selected.text), window.getSelection()?.removeAllRanges(), unselect())} />
				</Bar>
			) : null}
		</div>
	);
}

export const OverSelectedText: Story = {
	args: {},
	render: () => <Selecting onQuote={fn()} />,
	play: async ({ canvas }) => {
		const text = canvas.getByTestId("answer").firstChild as Text;
		const range = document.createRange();
		range.setStart(text, 4);
		range.setEnd(text, 36);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);
		await within(document.body).findByRole("toolbar");
	},
};
