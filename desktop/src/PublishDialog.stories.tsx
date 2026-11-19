import type { Meta, StoryObj } from "@storybook/react-vite";
import { PublishDialog as Dialog } from "./PublishDialog.tsx";

// No docs page: it would open every story's dialog at once, one over the other.
const meta = { component: Dialog, tags: ["!autodocs"], parameters: { layout: "fullscreen" } } satisfies Meta<typeof Dialog>;
export default meta;

type Story = StoryObj<typeof meta>;

export const PublishDialog: Story = { args: {} };

/** Filled in: a topic and a payload that is JSON. */
export const PublishDialogFilled: Story = { args: { topic: "house/mode", payload: '{\n  "value": "away"\n}' } };

/** What is wrong is said under the field it is in, and nothing is sent. */
export const PublishDialogWrong: Story = { args: { topic: "house mode", payload: "{value: away}", checked: true } };
