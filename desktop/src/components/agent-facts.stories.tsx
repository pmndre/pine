import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentFacts } from "./agent-facts.tsx";

const meta = {
	component: AgentFacts,
	decorators: [(Story) => <div className="flex max-w-xl flex-wrap gap-1.5 p-7"><Story /></div>],
	args: { agent: { model: "anthropic/claude-sonnet-5-5", thinking: "medium", mode: "safe", main: false, delegates: [] } },
} satisfies Meta<typeof AgentFacts>;
export default meta;

type Story = StoryObj<typeof meta>;

/** An agent in the sandbox that delegates to nobody. */
export const InASandbox: Story = {};

/** The main agent: it administers pine, and "*" is every other agent. */
export const MainAgent: Story = { args: { agent: { model: "anthropic/claude-opus-5-5", thinking: "high", mode: "auto", main: true, delegates: ["*"] }, mainId: "main" } };

/** Another agent that delegates to all but the main one, and one with no model yet. */
export const DelegatesToAll: Story = { args: { agent: { thinking: "low", mode: "manual", delegates: ["*"] }, mainId: "main" } };

/** Each badge that says something changeable is the button that changes it. */
export const Pickable: Story = { args: { pick: { model: () => {}, reasoning: () => {}, mode: () => {} }, agent: { model: "mock/m", thinking: "medium", mode: "bypass", delegates: ["scout", "books"] } } };
