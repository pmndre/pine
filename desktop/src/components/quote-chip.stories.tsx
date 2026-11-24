import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { QuoteChip as Chip, QuoteReply } from "./quote-chip.tsx";

const meta = { title: "Components/QuoteChip", component: Chip } satisfies Meta<typeof Chip>;
export default meta;
type Story = StoryObj<typeof meta>;

const text = "The first failed because the cache held an old copy of the lockfile, so the install took the versions of last week.";
const reply = "Then clear it in the workflow before every install, and say how much longer the build takes.";

export const QuoteChip: Story = { args: { text, onOpen: fn(), onReply: fn(), onRemove: fn() } };

/** With a reply written for it: its opening is a second line, and a click on it opens the reply again. */
export const Replied: Story = { args: { text, reply, onOpen: fn(), onReply: fn(), onRemove: fn() } };

/** The badge whose reply is open under the badges. */
export const Replying: Story = { args: { text, reply, replying: true, onOpen: fn(), onReply: fn(), onRemove: fn() } };

/** In a sent message: no ×, no reply button. */
export const Sent: Story = { args: { text, onOpen: fn() } };

export const Short: Story = { args: { text: "Clearing the cache", onOpen: fn() } };

function Editing({ start }: { start: string }) {
	const [value, setValue] = useState(start);
	return (
		<div className="max-w-xl">
			<QuoteReply text={text} value={value} onChange={setValue} onDone={fn()} />
		</div>
	);
}

/** Where a reply to a quote is written, under the badges above the input: ↩ closes it, ⇧↩ is a new line. */
export const Reply: Story = { args: { text }, render: () => <Editing start="" /> };

export const ReplyWritten: Story = { args: { text }, render: () => <Editing start={`${reply}\nAnd keep the cache for the test job.`} /> };
