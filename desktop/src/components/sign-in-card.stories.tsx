import type { Meta, StoryObj } from "@storybook/react-vite";
import { SignInCard } from "./sign-in-card.tsx";

// A sign-in in the browser, as it stands above the composer of the setup conversation.
const meta = {
	title: "Components/SignInCard",
	component: SignInCard,
	decorators: [(Story) => <div className="mx-auto max-w-3xl p-7 text-sm"><Story /></div>],
	args: {
		provider: "Claude",
		onOpen: () => {},
		onCopy: () => {},
		onAnswer: () => {},
		onCancel: () => {},
	},
	parameters: { layout: "padded" },
} satisfies Meta<typeof SignInCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Before the provider's flow named its page. */
export const Starting: Story = {};

/** The page opened in the browser; pine waits for the owner to sign in there. */
export const Waiting: Story = { args: { url: "https://claude.ai/oauth/authorize" } };

/** A device-code sign-in: the code to enter on the page, with Copy. */
export const DeviceCode: Story = { args: { provider: "GitHub Copilot", url: "https://github.com/login/device", code: "8F2C-41DA" } };

/** The flow asks for something to type, such as the code the page shows after signing in. */
export const AsksToType: Story = { args: { url: "https://claude.ai/oauth/authorize", question: { message: "Paste the authorization code", secret: false } } };

/** The flow asks for a choice: a question card of its own, with Cancel. */
export const AsksToChoose: Story = {
	args: {
		provider: "GitHub Copilot",
		question: {
			message: "Which GitHub?",
			secret: false,
			options: [
				{ id: "github.com", label: "GitHub.com", description: "The public GitHub" },
				{ id: "enterprise", label: "GitHub Enterprise", description: "Your company's own GitHub server" },
			],
		},
	},
};

/** The sign-in did not go through. */
export const Failed: Story = { args: { error: "The sign-in ended, and no model came with it." } };
