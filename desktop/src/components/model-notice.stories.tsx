import type { Meta, StoryObj } from "@storybook/react-vite";
import { ModelNotice } from "./model-notice.tsx";

const meta = {
	component: ModelNotice,
	decorators: [(Story) => <div className="mx-auto max-w-xl p-7"><Story /></div>],
	args: { agent: "main", problem: "No model yet.", onSetup: () => {} },
} satisfies Meta<typeof ModelNotice>;
export default meta;

type Story = StoryObj<typeof meta>;

/** A new home: nothing connected yet. */
export const NoModelYet: Story = {};

/** A model is set, but nobody is signed in to its provider. */
export const CannotAnswer: Story = {
	args: { agent: "books", model: "opencode/big-pickle", problem: "opencode/big-pickle needs a sign-in to opencode or a key for it, and there is none." },
};

/** After a message that was not answered for it. */
export const AfterAMessage: Story = {
	args: { retry: true },
};

/** In Settings > Models, where the way there is not needed. */
export const InSettings: Story = {
	args: { agent: "books", model: "opencode/big-pickle", problem: "opencode/big-pickle needs a sign-in to opencode or a key for it, and there is none.", onSetup: undefined },
};
