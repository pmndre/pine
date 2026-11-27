import type { Meta, StoryObj } from "@storybook/react-vite";
import { PickDialog as Dialog } from "./PickDialog.tsx";

// No docs page: it would open every story's dialog at once, one over the other.
const meta = { component: Dialog, tags: ["!autodocs"], parameters: { layout: "fullscreen" } } satisfies Meta<typeof Dialog>;
export default meta;

type Story = StoryObj<typeof meta>;

export const PickDialog: Story = {
	args: {
		p: {
			title: "Model for main",
			placeholder: "Search models",
			current: "mock/m",
			items: [
				{ value: "mock/m", label: "mock/m" },
				{ value: "fireworks/accounts/my-company/routers/deepseek-v4-instruct-turbo", label: "fireworks/accounts/my-company/routers/deepseek-v4-instruct-turbo" },
				{ value: "anthropic/claude", label: "anthropic/claude", about: "signed in" },
				{ value: "studio/qwen", label: "studio/qwen", about: "a model server of your own" },
			],
			done: () => {},
		},
	},
};

/** Opened at once while what it lists is asked for: skeleton lines under its title. */
export const PickDialogLoading: Story = { args: { p: { title: "Model for main", loading: true, items: [], done: () => {} } } };

/** A longer list, narrowed by the field every picker has. */
export const PickDialogLong: Story = {
	args: { p: { title: "New conversation with", done: () => {}, items: ["main", "scout", "books", "home", "mail", "notes", "news", "garden"].map((id) => ({ value: id, label: id, about: `the agent ${id}` })) } },
};

/** A name of the owner's own, taken with Enter: no list under the title. */
export const PickDialogFree: Story = { args: { p: { title: "Rename the conversation", placeholder: "New name", free: true, items: [], done: () => {} } } };

/** A choice that cannot be taken back makes it an alert dialog, drawn like the others. */
export const PickDialogRemoving: Story = {
	args: {
		p: {
			title: "Remove the agent spare?",
			done: () => {},
			items: [
				{ value: "erase", label: "Remove the agent and everything it owns", about: "the agent's 2 conversations, sources, schedules, servers, skills and folder. This cannot be undone", tone: "bad" },
				{ value: "keep", label: "Remove the agent but keep the folder", about: "the folder is moved to removed/ in pine's home" },
				{ value: "no", label: "Cancel" },
			],
		},
	},
};
