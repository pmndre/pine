import type { Meta, StoryObj } from "@storybook/react-vite";
import isChromatic from "chromatic/isChromatic";
import { useState } from "react";
import { fn } from "storybook/test";
import { useInterval } from "usehooks-ts";
import { type Fake, fakeActivity, fakeBusy, fakeCalm, replayAt } from "../birdview-fake.ts";
import { Birdview, type BirdviewProps } from "../Birdview.tsx";
import { River } from "./river.tsx";

/** A fixed start, so that every run of a story draws the same. */
const T0 = 1_800_000_000_000;

const SCENES = {
	calm: fakeCalm(T0),
	story: { ...fakeCalm(T0), events: fakeActivity(T0).events },
	busy: fakeBusy(T0),
} satisfies Record<string, Fake>;

interface RiverDemoProps extends Omit<BirdviewProps, "model" | "children"> {
	scene: keyof typeof SCENES;
	/** The stretch of the scene that loops, in seconds from its start. */
	from: number;
	to: number;
	/** The moment it stands still at, in seconds: in Chromatic, or when `paused`. */
	at: number;
	paused?: boolean;
}

/** The river on fake activity, replayed on a clock and looped, as the other directions' stories do. */
function RiverDemo({ scene, from, to, at, paused, ...handlers }: RiverDemoProps) {
	const [began] = useState(() => performance.now());
	const [tick, setTick] = useState(began);
	const still = paused || isChromatic();
	useInterval(() => setTick(performance.now()), still ? null : 40);
	const seconds = still ? at : from + (((tick - began) / 1000) % (to - from));
	const model = replayAt(SCENES[scene], T0 + seconds * 1000);
	return (
		<div className="h-screen">
			<Birdview model={model} {...handlers}>
				{(props) => <River {...props} />}
			</Birdview>
		</div>
	);
}

// Round 2, direction "river": a Sankey flow from inputs through agents to outputs, band width the
// volume over the window, a particle per event. Each story loops a stretch; in Chromatic it stands still at `at`.
const meta = {
	title: "Birdview/River",
	component: RiverDemo,
	tags: ["!autodocs"],
	parameters: { layout: "fullscreen" },
	args: { paused: false, onAgent: fn(), onConversation: fn(), onSetting: fn(), onEvents: fn() },
	argTypes: { paused: { control: "boolean" } },
} satisfies Meta<typeof RiverDemo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Calm: Story = { args: { scene: "calm", from: 0, to: 20, at: 10 } };

export const Busy: Story = { args: { scene: "busy", from: 0, to: 20, at: 8.6 } };

export const Delegation: Story = { args: { scene: "story", from: 7.5, to: 12.5, at: 8.9 } };

export const OutsideContent: Story = { args: { scene: "story", from: 0.5, to: 5, at: 2.2 } };

export const ApprovalWaiting: Story = { args: { scene: "story", from: 4.5, to: 9.4, at: 6.5 } };
