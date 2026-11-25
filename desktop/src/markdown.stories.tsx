import type { Meta, StoryObj } from "@storybook/react-vite";
import { Markdown } from "./markdown.tsx";

const table = [
	"Compared:",
	"",
	"| | Local model | Hosted model |",
	"|---|---|---|",
	"| First token | ~7-15 min (long prompt) | ~1-3 s |",
	"| Complex reasoning | fine for everyday tasks, slower on long contexts | very good |",
].join("\n");

const wide = [
	"| Model | First token | Speed | Context | Cost | Note |",
	"|---|---|---|---|---|---|",
	"| Local model | ~7-15 min (long prompt) | 12 tok/s | 128k | free | slow on long contexts |",
	"| Hosted model | ~1-3 s | 80 tok/s | 1M | paid | very good reasoning |",
	"| https://example.com/a/very/long/path/with/no/space/at/all | `a-long-identifier-in-code` | y | z | w | v |",
].join("\n");

// Markdown in an answer. A table is shadcn's Table: at a phone's width it scrolls sideways, its cells break
// between words, and an address or code breaks anywhere.
const meta = {
	title: "Components/Markdown",
	component: Markdown,
	args: { text: table },
	parameters: { layout: "padded" },
	render: (args) => (
		<section className="text-base leading-snug">
			<Markdown {...args} />
		</section>
	),
} satisfies Meta<typeof Markdown>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Table: Story = {};

/** More columns than a phone has room for: the table scrolls sideways in a ScrollArea, the page does not, and the side with more beyond it fades. */
export const WideTable: Story = { args: { text: wide } };

/** Lists: the marker stands outside, so a wrapped line starts under the text; an item's two paragraphs stay two. */
export const Lists: Story = {
	args: {
		text: [
			"- An item long enough to wrap onto a second line in a narrow window, which starts under its text.",
			"",
			"  Its second paragraph.",
			"",
			"- Another item",
			"  - nested",
			"",
			"1. First step",
			"2. Second step",
		].join("\n"),
	},
};

/** Code blocks: the stock Code Block, titled with the file the opening line names, else the language, else "text". */
export const CodeBlocks: Story = {
	args: {
		text: ['```ts title="src/app.ts"', "// a comment", "export const answer = 42;", "```", "", "```bash", "echo hello", "```", "", "```", "no language", "```", "", "Inline `code` too."].join("\n"),
	},
};

/** A footnote: its number in the text and the note below a separator, without addresses of places in the page. */
export const Footnotes: Story = { args: { text: "A claim[^1] and another[^2].\n\n[^1]: Its source.\n[^2]: Another source." } };
