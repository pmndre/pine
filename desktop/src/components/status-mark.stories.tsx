import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusMark as Mark } from "./status-mark.tsx";

// What a side-bar line calls for: the owner is waited for, an agent works, something is new.
const meta = { title: "Components/StatusMark", component: Mark } satisfies Meta<typeof Mark>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A conversation waits for the owner: an approval or a question. */
export const StatusMarkWaits: Story = { args: { standing: "waits" } };

/** An agent is at work. */
export const StatusMarkWorking: Story = { args: { standing: "working" } };

/** Something new that the owner has not seen. */
export const StatusMarkUnread: Story = { args: { standing: "unread" } };
