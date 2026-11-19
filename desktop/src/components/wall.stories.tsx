import type { Meta, StoryObj } from "@storybook/react-vite";
import isChromatic from "chromatic/isChromatic";
import { useState } from "react";
import { fn } from "storybook/test";
import { useInterval } from "usehooks-ts";
import { fakeActivity, fakeBusy, fakeCalm, type Fake, replayAt } from "../birdview-fake.ts";
import { Birdview, type BirdviewProps } from "../Birdview.tsx";
import { Wall } from "./wall.tsx";

// Direction C of the bird's-eye view: a mission-control wall of agent tiles, sized by activity,
// with sources in a strip along the top. Each story loops a stretch of fake activity, as the
// other directions' do (birdview-demo.tsx); in Chromatic it stands still at `at`.

const T0 = 1_800_000_000_000;
const SCENES = {
	calm: fakeCalm(T0),
	story: { ...fakeCalm(T0), events: fakeActivity(T0).events },
	busy: fakeBusy(T0),
} satisfies Record<string, Fake>;

interface WallDemoProps extends Omit<BirdviewProps, "model" | "children"> {
	scene: keyof typeof SCENES;
	from: number;
	to: number;
	at: number;
	paused?: boolean;
}

function WallDemo({ scene, from, to, at, paused, ...handlers }: WallDemoProps) {
	const [began] = useState(() => performance.now());
	const [tick, setTick] = useState(began);
	const still = paused || isChromatic();
	useInterval(() => setTick(performance.now()), still ? null : 40);
	const seconds = still ? at : from + (((tick - began) / 1000) % (to - from));
	const model = replayAt(SCENES[scene], T0 + seconds * 1000);
	return (
		<div className="h-screen">
			<Birdview model={model} {...handlers}>
				{(props) => <Wall {...props} />}
			</Birdview>
		</div>
	);
}

const meta = {
	title: "Birdview/Wall",
	component: WallDemo,
	tags: ["!autodocs"],
	parameters: { layout: "fullscreen" },
	args: { onAgent: fn(), onConversation: fn(), onSetting: fn(), onEvents: fn() },
} satisfies Meta<typeof WallDemo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Calm: Story = { args: { scene: "calm", from: 0, to: 20, at: 10 } };

export const Busy: Story = { args: { scene: "busy", from: 0, to: 20, at: 8.6 } };

export const Delegation: Story = { args: { scene: "story", from: 7.5, to: 12.5, at: 9.2 } };

export const OutsideContent: Story = { args: { scene: "story", from: 0.5, to: 5, at: 3.2 } };

export const ApprovalWaiting: Story = { args: { scene: "story", from: 4.5, to: 9.4, at: 6.5 } };
