// A sound in a conversation: one line with play and pause, a row of bars, its name and how long
// it runs. It behaves as the sound line of the terminal UI does (src/tui/picture.ts): one sound
// plays at a time, a pause holds it where it is, at the end it is back at the start, and the bars
// show its levels at the place being heard.
//
// The bars are worked out in the page, from bytes the daemon serves: Chromium decodes them (into
// samples, not to a loudspeaker) and the levels are measured by the code the terminal UI measures
// them with (src/tui/levels.ts), so that a sound looks the same in both. The page reads no file.
//
// The sound that plays is held here and not by the line that shows it: it goes on when its line
// leaves the screen (another conversation is opened) and the line finds it again when it is back.
import { MusicIcon, PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useId, useReducer, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { BANDS, heights, type Levels, Meter, STEP } from "../../../src/tui/levels.ts";

/** What the decoder is asked for: 16000 samples a second show everything up to 8 kHz, which is all the bars cover. */
const RATE = 16_000;
/** Seconds. A longer sound plays without bars: decoded, it would take hundreds of megabytes of the page's memory. */
const LONGEST = 600;
/** How often the line looks where the sound is while it plays; the bars change ten times a second. */
const LOOK_MS = 50;

/** Handed to the sound that may start by itself: whichever line takes it first plays, and nothing plays for it a second time. */
export interface Heard {
	heard: boolean;
}

interface Sounding {
	id: string;
	audio: HTMLAudioElement;
	/** Undefined: not measured yet. Null: there are none to be had. */
	levels?: Levels | null;
}

let sounding: Sounding | undefined;
const lines = new Set<() => void>();
const changed = () => lines.forEach((line) => line());

/** Nothing plays: every bar lies flat. */
const FLAT: Levels = { bands: BANDS, step: STEP, rows: 0, data: new Uint8Array(0) };

async function measure(bytes: ArrayBuffer): Promise<Levels | null> {
	// An offline context decodes without a loudspeaker, and hands the samples back at its own rate.
	const sound = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(bytes);
	if (sound.duration > LONGEST) return null;
	const channels = Array.from({ length: sound.numberOfChannels }, (_, c) => sound.getChannelData(c));
	const meter = new Meter(sound.sampleRate);
	for (let i = 0; i < sound.length; i++) {
		let sum = 0;
		for (const channel of channels) sum += channel[i];
		meter.add(sum / channels.length);
		// A minute at a time, so that a long sound does not hold up the page.
		if (i % (RATE * 60) === RATE * 60 - 1) await new Promise((r) => setTimeout(r));
	}
	return meter.done() ?? null;
}

/** Back to the start, as at its end. */
function stop(): void {
	const was = sounding;
	if (!was) return;
	sounding = undefined;
	was.audio.onended = was.audio.onerror = null;
	was.audio.pause();
	try {
		was.audio.currentTime = 0;
	} catch {
		// nothing was loaded of it
	}
	changed();
}

/** Play, or go on after a pause. One sound at a time: another one that is playing stops. */
function play(id: string, audio: HTMLAudioElement, bytes?: () => Promise<ArrayBuffer>): void {
	if (sounding && sounding.audio !== audio) stop();
	if (!sounding) {
		const now: Sounding = { id, audio };
		sounding = now;
		const over = () => sounding === now && stop();
		audio.onended = over;
		audio.onerror = over;
		// Not before it is known how long it runs: a sound that is too long is not even fetched for its bars.
		const bars = () => {
			if (sounding !== now) return;
			void (bytes && audio.duration <= LONGEST ? bytes().then(measure) : Promise.resolve(null))
				.catch(() => null)
				.then((levels) => {
					now.levels = levels;
					if (sounding === now) changed();
				});
		};
		if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) bars();
		else audio.addEventListener("loadedmetadata", bars, { once: true });
	}
	// A file that cannot be played says so itself (`error`, above).
	void audio.play().catch(() => {});
	changed();
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/**
 * `id`: a name for this place that stays the same while the page lives, by which the line finds
 * its sound again when it was off screen. `bytes`: the sound as bytes, for its bars; without it
 * the line has none. `auto`: see Heard.
 */
type SoundProps = { src: string; name: string; id?: string; bytes?: () => Promise<ArrayBuffer>; auto?: Heard; className?: string; skeleton?: false };

export function Sound(props: SoundProps | { src?: undefined; name?: undefined; className?: string; /** While the sound is not known yet: its line's shape. */ skeleton: true }) {
	// The line's hooks must not run for a skeleton, so the two are separate components.
	if (props.skeleton || props.src === undefined) return <SoundSkeleton className={props.className} />;
	return <SoundLine {...(props as SoundProps)} />;
}

/** The play button's square (icon-sm, size-7), a strip as tall as the bars, and a bar for the name. */
function SoundSkeleton({ className }: { className?: string }) {
	return (
		<span data-slot="sound" data-sound="skeleton" className={cn("inline-flex max-w-full items-center gap-2.5 align-middle text-sm", className)}>
			<Skeleton className="size-7 shrink-0" />
			{/* BANDS bars of w-1 with gap-px: about w-30. */}
			<Skeleton className="h-6 w-30 shrink-0" />
			<Skeleton className="h-4 w-28" />
		</span>
	);
}

function SoundLine({ src, name, id, bytes, auto, className }: SoundProps) {
	const own = useId();
	const key = id ?? own;
	const [, redraw] = useReducer((n: number) => n + 1, 0);
	const [audio, setAudio] = useState<HTMLAudioElement>();

	useEffect(() => {
		// The sound that plays under this name is this line's: it was off screen. Any other line
		// has an element of its own, which fetches only the start of the file: how long it runs.
		const mine = sounding?.id === key ? sounding.audio : Object.assign(new Audio(), { preload: "metadata", src });
		const events = ["loadedmetadata", "durationchange", "play", "playing", "pause", "timeupdate", "seeked", "error"];
		for (const event of events) mine.addEventListener(event, redraw);
		lines.add(redraw);
		setAudio(mine);
		return () => {
			for (const event of events) mine.removeEventListener(event, redraw);
			lines.delete(redraw);
			// An address of the page's own (a blob) dies with the line that made it, and its sound with it.
			if (sounding?.audio === mine && src.startsWith("blob:")) stop();
			if (sounding?.audio !== mine) {
				mine.removeAttribute("src");
				mine.load();
			}
		};
	}, [key, src]);

	const now = audio && sounding?.audio === audio ? sounding : undefined;
	const state = !now || !audio ? "idle" : audio.paused ? "paused" : "playing";

	useEffect(() => {
		if (!audio || !auto || auto.heard) return;
		auto.heard = true;
		play(key, audio, bytes);
	}, [audio, auto]);

	useEffect(() => {
		if (state !== "playing") return;
		const timer = setInterval(redraw, LOOK_MS);
		return () => clearInterval(timer);
	}, [state]);

	const failed = Boolean(audio?.error);
	const total = audio && Number.isFinite(audio.duration) ? audio.duration : undefined;
	const at = now && audio ? Math.min(audio.currentTime, total ?? Infinity) : 0;
	const time = failed ? "cannot be played here" : state !== "idle" ? `${clock(at)}${total ? ` / ${clock(total)}` : ""}` : total ? clock(total) : "";
	// Flat while nothing plays and until the levels are there; no row at all where there are none to be had.
	const bars = !bytes || failed || now?.levels === null ? undefined : heights(now?.levels ?? FLAT, state === "idle" ? -1 : at);

	return (
		<span data-slot="sound" data-sound={state} className={cn("inline-flex max-w-full items-center gap-2.5 align-middle text-sm", className)}>
			<Button variant="outline" size="icon-sm" className="shrink-0" disabled={!audio || failed} aria-label={`${state === "playing" ? "Pause" : "Play"} ${name}`} onClick={() => audio && (state === "playing" ? audio.pause() : play(key, audio, bytes))}>
				{state === "playing" ? <PauseIcon /> : <PlayIcon />}
			</Button>
			{bars ? (
				// One bar for each range of pitch, low to high. The lowest a bar gets is an eighth, the flat row of the terminal.
				<span data-slot="sound-bars" aria-hidden className={cn("flex h-6 shrink-0 items-end gap-px", state === "idle" ? "text-muted-foreground/40" : "text-primary")}>
					{bars.map((level, i) => (
						<span key={i} className="w-1 rounded-xs bg-current transition-[height] duration-100 ease-linear" style={{ height: `${((1 + (level / 255) * 7) / 8) * 100}%` }} />
					))}
				</span>
			) : null}
			<span className="flex min-w-0 items-center gap-1.5 text-muted-foreground" title={failed ? "There is no such file, or it is of a kind that is not played here." : undefined}>
				<MusicIcon className="size-3.5 shrink-0" aria-hidden />
				<span className="truncate">{name}</span>
				{time ? <span data-slot="sound-time" className="shrink-0 text-faint tabular-nums">{time}</span> : null}
			</span>
		</span>
	);
}
