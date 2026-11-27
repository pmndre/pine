import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, waitFor, within } from "storybook/test";
import { OFFICIAL_SERVICE, readPairLink } from "./machines.ts";
import { PairConfirm, PairLinkField } from "./Pairing.tsx";

// Pairing the mobile app with a computer from a link in the owner's hand: the field a link is pasted
// into (in the pairing view's how-to), and the owner's yes before the link's code is used.

const ID = "q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x-_";
const CODE = "abcdefghijklmnopqrstuv";
const LINK = `${OFFICIAL_SERVICE}/#pair=${ID}.${CODE}`;

const meta = { title: "Pairing", parameters: { layout: "centered" } } satisfies Meta;
export default meta;

/** The field, empty: Pair waits for a link. A text that is not a pairing link is said so, in the field's own error. */
export const PasteField: StoryObj<{ onLink: (text: string) => string | undefined }> = {
	args: { onLink: fn((text: string) => (readPairLink(text) ? undefined : "That is not a pairing link. On your computer, choose Pine > Add a device, and copy the link shown there.")) },
	render: (args) => (
		<div className="w-96">
			<PairLinkField {...args} />
		</div>
	),
	play: async ({ canvasElement, args, userEvent }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("button", { name: "Pair" })).toBeDisabled();
		const field = canvas.getByLabelText("Pairing link");
		// Pasted, as a link copied from the Pine app is.
		await userEvent.click(field);
		await userEvent.paste("https://example.com/");
		await waitFor(() => expect(canvas.getByRole("button", { name: "Pair" })).toBeEnabled());
		await userEvent.click(canvas.getByRole("button", { name: "Pair" }));
		await expect(canvas.getByText(/That is not a pairing link/)).toBeInTheDocument();
		await userEvent.clear(field);
		await userEvent.paste(LINK);
		await waitFor(() => expect(field).toHaveValue(LINK));
		await userEvent.click(canvas.getByRole("button", { name: "Pair" }));
		await expect(args.onLink).toHaveBeenLastCalledWith(LINK);
		await expect(canvas.getByLabelText("Pairing link")).toHaveValue("");
	},
};

type Confirm = { link: string; onPair: () => void; onCancel: () => void };
const confirm = (args: Confirm) => <PairConfirm link={readPairLink(args.link)!} device="phone" onPair={args.onPair} onCancel={args.onCancel} />;

/** A link of the official service: the owner's yes, nothing else to say. No docs page: it would open every story's dialog at once. */
export const Confirmation: StoryObj<Confirm> = {
	tags: ["!autodocs"],
	parameters: { layout: "fullscreen" },
	args: { link: LINK, onPair: fn(), onCancel: fn() },
	render: confirm,
	play: async ({ canvasElement, args, userEvent }) => {
		const page = within(canvasElement.ownerDocument.body);
		await expect(page.getByText("Pair with this computer?")).toBeInTheDocument();
		await expect(canvasElement.ownerDocument.querySelector('[data-slot="pair-service"]')).toBeNull();
		await userEvent.click(page.getByRole("button", { name: "Pair" }));
		await expect(args.onPair).toHaveBeenCalled();
	},
};

/** A link of a service of the owner's own: its host is named before the yes, since every connection goes through it. */
export const ConfirmationOtherService: StoryObj<Confirm> = {
	tags: ["!autodocs"],
	parameters: { layout: "fullscreen" },
	args: { link: `https://pine.example.org/#pair=${ID}.${CODE}`, onPair: fn(), onCancel: fn() },
	render: confirm,
	play: async ({ canvasElement, args, userEvent }) => {
		const page = within(canvasElement.ownerDocument.body);
		await expect(canvasElement.ownerDocument.querySelector('[data-slot="pair-service"]')).toHaveTextContent("pine.example.org");
		await userEvent.click(page.getByRole("button", { name: "Cancel" }));
		await expect(args.onCancel).toHaveBeenCalled();
		await expect(args.onPair).not.toHaveBeenCalled();
	},
};
