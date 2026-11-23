import type { Meta, StoryObj } from "@storybook/react-vite";
import { Sound } from "./sound.tsx";

/** A wav file made here: a tone that climbs and swells for four seconds, so that the bars have something to show. */
function chirp(): Blob {
	const rate = 16_000;
	const samples = new Int16Array(rate * 4);
	let phase = 0;
	for (let i = 0; i < samples.length; i++) {
		const t = i / rate;
		phase += (2 * Math.PI * (150 + 900 * t)) / rate;
		samples[i] = Math.round((Math.sin(phase) + 0.4 * Math.sin(phase * 3)) * 9000 * Math.abs(Math.sin(t * 4)));
	}
	const head = new DataView(new ArrayBuffer(44));
	const text = (at: number, s: string) => [...s].forEach((c, i) => head.setUint8(at + i, c.charCodeAt(0)));
	text(0, "RIFF");
	head.setUint32(4, 36 + samples.byteLength, true);
	text(8, "WAVEfmt ");
	head.setUint32(16, 16, true);
	head.setUint16(20, 1, true);
	head.setUint16(22, 1, true);
	head.setUint32(24, rate, true);
	head.setUint32(28, rate * 2, true);
	head.setUint16(32, 2, true);
	head.setUint16(34, 16, true);
	text(36, "data");
	head.setUint32(40, samples.byteLength, true);
	return new Blob([head, samples], { type: "audio/wav" });
}

const blob = chirp();
const src = URL.createObjectURL(blob);

// A sound in a conversation: play and pause, its bars, its name and how long it runs. Press play to
// see the bars move; they lie flat while nothing plays.
const meta = {
	title: "Components/Sound",
	component: Sound,
	args: { src, name: "hello world", bytes: () => blob.arrayBuffer() },
	parameters: { layout: "padded" },
} satisfies Meta<typeof Sound>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A sound whose levels are not to be had (no bytes to measure): the line without bars. */
export const WithoutBars: Story = { args: { bytes: undefined } };

/** A file that is not there, or of a kind that is not played here. */
export const CannotBePlayed: Story = { args: { src: "nothing.wav", name: "gone" } };

/** A long name in a narrow place is cut; the control, the bars and the time keep their room. */
export const Narrow: Story = { args: { name: "the briefing for Monday morning, read aloud, second take", className: "w-72" } };

/** While it loads: its own shape, from stock Skeleton blocks. */
export const SoundSkeleton: Story = { args: { skeleton: true } as never };
