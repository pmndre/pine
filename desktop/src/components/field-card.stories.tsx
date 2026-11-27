import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@/components/ui/button";
import { FieldCard, FormCard } from "./field-card.tsx";

// A card above the composer that asks for one value, in the question card's family.
const meta = {
	title: "Components/FieldCard",
	component: FieldCard,
	decorators: [(Story) => <div className="mx-auto max-w-3xl p-7 text-sm"><Story /></div>],
	args: {
		title: "The address of your model server",
		about: "A server that speaks OpenAI's API, as LM Studio, Ollama and llama.cpp do.",
		label: "Address",
		type: "url",
		help: "For example http://127.0.0.1:8080",
		button: "Connect",
		start: <Button size="sm" variant="ghost">Back</Button>,
		onSend: () => {},
	},
	parameters: { layout: "padded" },
} satisfies Meta<typeof FieldCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** An address to type. */
export const Address: Story = {};

/** A key: a password field, emptied once sent. */
export const Key: Story = {
	args: {
		title: "Your API key for Anthropic",
		about: "Paste the key you made on the provider's site. pine checks it when your agents first use it.",
		label: "API key",
		type: "password",
		help: "It is not shown, and goes straight to pine's store of keys: no agent and no model reads it.",
		button: "Save",
		start: <Button size="sm" variant="ghost">Cancel</Button>,
	},
};

/** What was sent did not go through, and the card is at work again. */
export const ErrorAndBusy: Story = {
	args: {
		title: "LM Studio wants a key",
		about: "The server was started with a key and answers only requests that include it.",
		label: "Key for LM Studio",
		type: "password",
		help: undefined,
		button: "Unlock",
		error: "LM Studio did not accept that key.",
		busy: "Asking the server…",
	},
};

/** A card with no field: something under way, a way back, and what is waiting. */
export const Waiting: Story = {
	render: () => (
		<FormCard
			title="Looking for model servers on this computer"
			about="llama.cpp, Ollama, LM Studio and Pinecone, on their usual ports…"
			start={<Button size="sm" variant="ghost">Back</Button>}
		/>
	),
};
