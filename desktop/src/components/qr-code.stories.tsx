import type { Meta, StoryObj } from "@storybook/react-vite";
import { QrCode as Code } from "./qr-code.tsx";

// A pairing link of Settings > Browser access, as its dialog draws it: a phone's camera opens it.
const meta = { title: "Components/QrCode", component: Code } satisfies Meta<typeof Code>;
export default meta;
type Story = StoryObj<typeof meta>;

const LINK = "https://pine.example.workers.dev/#pair=x8Qk2vJp1mZl3nRt5yWb7cDf9gHs0aEu4iOq6eTr2wA.Zm9vYmFyYmF6cXV4cXV1eA";

export const QrCode: Story = { args: { value: LINK, label: "QR code of the pairing link", className: "size-56 rounded-lg" } };

/** A short text makes a small code, drawn as large: the modules grow, the quiet zone stays four of them. */
export const Short: Story = { args: { value: "https://pine.example", label: "QR code of a short address", className: "size-56 rounded-lg" } };

/** While it loads: its own shape, from stock Skeleton blocks. */
export const QrCodeSkeleton: Story = { args: { skeleton: true, className: "size-56 rounded-lg" } as never };
