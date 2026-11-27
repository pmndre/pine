import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@/components/ui/button";
import type { AskedQuestion } from "../api.ts";
import { AskedInFull, AskedLines, QuestionCard, QuestionsCard, QuestionTrace } from "./question-card.tsx";

// A question put to the owner, as it stands above the composer, and the line it folds into once answered:
// pine's own (QuestionCard: its setup steps, a sign-in's choice) and an agent's (QuestionsCard, from its turn).
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
	},
	parameters: { layout: "padded" },
} satisfies Meta<typeof QuestionCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One answer, from plain labels. */
export const Single: Story = {};

/** A few words said with who asks, a line under each option that says what it means, and the first marked as the one the asker would pick. */
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

const database: AskedQuestion = { question: "Which database?", header: "Database", options: [{ label: "the old one", description: "Nothing to move" }, { label: "the new one", description: "Faster, after a migration" }] };
const colors: AskedQuestion = { question: "Which colors should the theme use?", header: "Theme", multiSelect: true, options: [{ label: "green" }, { label: "blue" }, { label: "red" }] };
const name: AskedQuestion = { question: "What should the new project be called?" };

/** An agent's question, as its turn asked it: the options, the first the one it would pick, and Send. Send posts the label as the owner's message. */
export const AgentAsks: Story = {
	render: () => <QuestionsCard questions={[database]} from="main asks" onSend={() => {}} />,
};

/** Several questions of one turn: one at a time, "1 / 3" at the top right, Previous, Skip and Next, Send on the last. A question without options says to answer by typing. */
export const AgentAsksSeveral: Story = {
	render: () => <QuestionsCard questions={[database, colors, name]} from="main asks" onSend={() => {}} />,
};

/** In a conversation that has read outside content: a quiet line says so. */
export const AgentAsksAfterOutsideContent: Story = {
	render: () => <QuestionsCard questions={[database]} from="main asks" outside onSend={() => {}} />,
};

/** An agent's questions in the thread: one line each while the card shows them or once answered, and in full while the card is folded away. */
export const AgentAskedInThread: Story = {
	render: () => (
		<div className="flex flex-col gap-4">
			<AskedLines questions={[database, colors]} />
			<AskedInFull questions={[database, colors, name]} from="main asks" />
		</div>
	),
};

/** One of pine's own steps: a way back at the start of the actions row, before Later and No answer. */
export const WithBack: Story = {
	args: {
		header: "API key",
		from: "pine asks",
		question: "Which provider is your key for?",
		options: [{ label: "Anthropic" }, { label: "OpenAI" }, { label: "OpenRouter" }],
		actions: <Button size="sm" variant="ghost">Back</Button>,
	},
};

/** pine's card for the default model in Onboarding: its choice first and recommended, a few others of the provider, and a search of all. */
export const DefaultModel: Story = {
	args: {
		header: "Default model",
		from: "pine asks",
		recommended: true,
		onNoAnswer: undefined,
		question: "Which default model should your agents run on?",
		options: [
			{ label: "anthropic/claude-sonnet-4-5", description: "pine's choice. Keep it and go on." },
			{ label: "anthropic/claude-opus-4-1" },
			{ label: "anthropic/claude-haiku-4-5" },
			{ label: "Another…", description: "Search every model your agents can use now." },
		],
	},
};

/** Several may be ticked, and are sent together. */
export const Multiple: Story = {
	args: {
		header: "Set up",
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
