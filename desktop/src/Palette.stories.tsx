import type { Meta, StoryObj } from "@storybook/react-vite";
import { Palette as Dialog } from "./Palette.tsx";
import { store } from "./model.ts";

// The palette lists what the app has: here, without a daemon, its commands and the settings' pages.
// No docs page: it would open every story's palette at once, one over the other.
const meta = { component: Dialog, tags: ["!autodocs"], parameters: { layout: "fullscreen" } } satisfies Meta<typeof Dialog>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Every source is in: a query that fits nothing says "Nothing fits." */
export const Palette: Story = {
	beforeEach: () => {
		store.titled = true;
	},
};

/** What was said (and the conversations) is still loading: skeleton lines in place of "Nothing fits.". */
export const PaletteLoading: Story = {
	beforeEach: () => {
		store.titled = false;
	},
};
