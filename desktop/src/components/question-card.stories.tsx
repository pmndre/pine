import type { Meta, StoryObj } from "@storybook/react-vite";
import { QuestionCard, QuestionTrace } from "./question-card.tsx";

// A question put to the owner, as it stands above the composer, and the line it folds into once answered.
const meta = {
	title: "Components/QuestionCard",
	component: QuestionCard,
	decorators: [(Story) => <div className="mx-auto max-w-3xl p-7 text-sm"><Story /></div>],
	args: {
		question: "Which database?",
		from: "main asks",
		options: [{ label: "the old one" }, { label: "the new one" }],
		onAnswer: () => {},
		onNoAnswer: () => {},
		onLater: () => {},
	},
	parameters: { layout: "padded" },
} satisfies Meta<typeof QuestionCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One answer, from plain labels. */
export const Single: Story = {};

/** A few words over it, a line under each option that says what it means, and the first marked as the one the asker would pick. */
export const WithDescriptions: Story = {
	args: {
		header: "Model",
		recommended: true,
		question: "How should your agents run?",
		options: [
			{ label: "A subscription", description: "Claude, ChatGPT or Copilot, signed in through your browser" },
			{ label: "An API key", description: "Pay for what you use, at a provider you choose" },
			{ label: "A model on this computer", description: "Free and private; needs a model server running here" },
		],
	},
};

/** Several may be ticked, and are sent together. */
export const Multiple: Story = {
	args: {
		header: "Next",
		question: "What do you want to set up now?",
		multiple: true,
		options: [{ label: "The mode", description: "How much your agents ask before they act" }, { label: "A working folder" }, { label: "Telegram", description: "Talk to your agents from your phone" }, { label: "A first agent" }],
	},
};

/** Once answered: one line in the conversation that says what was answered. */
export const Answered: Story = {
	render: () => (
		<div className="flex flex-col gap-2">
			<QuestionTrace question="Which database?" answer="the new one" answered by="you" />
			<QuestionTrace question="What do you want to set up now?" answer="The mode, Telegram" answered by="you" />
			<QuestionTrace question="Which font?" answered={false} by="you" />
		</div>
	),
};
