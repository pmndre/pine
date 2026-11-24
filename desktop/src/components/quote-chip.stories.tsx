import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { QuoteChip as Chip } from "./quote-chip.tsx";

const meta = { title: "Components/QuoteChip", component: Chip } satisfies Meta<typeof Chip>;
export default meta;
type Story = StoryObj<typeof meta>;

const text = "The first failed because the cache held an old copy of the lockfile, so the install took the versions of last week.";

export const QuoteChip: Story = { args: { text, onOpen: fn(), onRemove: fn() } };

/** In a sent message: no ×. */
export const Sent: Story = { args: { text, onOpen: fn() } };

export const Short: Story = { args: { text: "Clearing the cache", onOpen: fn() } };
