// The bird's-eye view on fake activity, replayed on a clock and looped, for its stories. Only the
// stories use it: the live view feeds the same Birdview from the control API.
import isChromatic from "chromatic/isChromatic";
import { useState } from "react";
import { useInterval } from "usehooks-ts";
import { Constellation } from "@/components/constellation";
import { Switchboard } from "@/components/switchboard";
import { fakeActivity, fakeBusy, fakeCalm, type Fake, replayAt } from "./birdview-fake.ts";
import { Birdview, type BirdviewProps } from "./Birdview.tsx";

/** A fixed start, so that every run of a story draws the same. */
const T0 = 1_800_000_000_000;

const SCENES = {
	/** Nobody works; the last fifteen minutes are the faded trail. */
	calm: fakeCalm(T0),
	/** Three agents: a mail, an approval, a delegation and a schedule. */
	story: { ...fakeCalm(T0), events: fakeActivity(T0).events },
	/** Six agents and work from every side. */
	busy: fakeBusy(T0),
} satisfies Record<string, Fake>;

export interface BirdviewDemoProps extends Omit<BirdviewProps, "model" | "children"> {
	direction: "switchboard" | "constellation";
	scene: keyof typeof SCENES;
	/** The stretch of the scene that loops, in seconds from its start. */
	from: number;
	to: number;
	/** The moment it stands still at, in seconds: in Chromatic, or when `paused`. */
	at: number;
	paused?: boolean;
}

export function BirdviewDemo({ direction, scene, from, to, at, paused, ...handlers }: BirdviewDemoProps) {
	const [began] = useState(() => performance.now());
	const [tick, setTick] = useState(began);
	const still = paused || isChromatic();
	useInterval(() => setTick(performance.now()), still ? null : 40);
	const seconds = still ? at : from + (((tick - began) / 1000) % (to - from));
	const model = replayAt(SCENES[scene], T0 + seconds * 1000);
	const Draw = direction === "constellation" ? Constellation : Switchboard;
	return (
		<div className="h-screen">
			<Birdview model={model} {...handlers}>
				{(props) => <Draw {...props} />}
			</Birdview>
		</div>
	);
}
