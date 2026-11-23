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
				{ value: "anthropic/claude", label: "anthropic/claude", about: "signed in" },
				{ value: "studio/qwen", label: "studio/qwen", about: "a model server of your own" },
			],
			done: () => {},
		},
	},
};

/** Opened at once while what it lists is asked for: skeleton lines. */
export const PickDialogLoading: Story = { args: { p: { title: "Model for main", loading: true, items: [], done: () => {} } } };

/** A long list gets a field that narrows it. */
export const PickDialogTyped: Story = {
	args: { p: { title: "New conversation with", done: () => {}, items: ["main", "scout", "books", "home", "mail", "notes", "news", "garden"].map((id) => ({ value: id, label: id, about: `the agent ${id}` })) } },
};

/** A choice that cannot be taken back makes it an alert dialog. */
export const PickDialogRemoving: Story = {
	args: {
		p: {
			title: "Remove the agent spare?",
			done: () => {},
			items: [
				{ value: "erase", label: "Remove it with everything it has", about: "its 2 conversations, sources, schedules, servers, skills and its folder. This cannot be undone", tone: "bad" },
				{ value: "keep", label: "Remove it, but keep its folder", about: "the folder is moved to removed/ in pine's home" },
				{ value: "no", label: "Cancel" },
			],
		},
	},
};
