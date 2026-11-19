// The colours the bird's-eye view's directions share, as Tailwind classes on the app's tokens, so
// that light and dark follow the theme. Written out whole: Tailwind finds a class only as a literal.
import type { PulseKind, State } from "../birdview.ts";

export interface Tone {
	stroke: string;
	fill: string;
	bg: string;
}

const PRIMARY: Tone = { stroke: "stroke-primary", fill: "fill-primary", bg: "bg-primary" };
const INFO: Tone = { stroke: "stroke-chart-2", fill: "fill-chart-2", bg: "bg-chart-2" };
const PLAN: Tone = { stroke: "stroke-chart-3", fill: "fill-chart-3", bg: "bg-chart-3" };
const WARN: Tone = { stroke: "stroke-chart-4", fill: "fill-chart-4", bg: "bg-chart-4" };
const ERROR: Tone = { stroke: "stroke-destructive", fill: "fill-destructive", bg: "bg-destructive" };
const QUIET: Tone = { stroke: "stroke-muted-foreground", fill: "fill-muted-foreground", bg: "bg-muted-foreground" };

/** One colour per kind of source, the way a transit map gives each line its own; amber and red stay for approvals and failures. */
const LINES: Tone[] = [INFO, PRIMARY, PLAN];

/** The colour of a source type's lines, from its place among the types there are. */
export function lineTone(types: string[], type: string): Tone {
	const i = [...new Set(types)].sort().indexOf(type);
	return LINES[Math.max(0, i) % LINES.length];
}

export const SCHEDULE_TONE = QUIET;
export const DELEGATION_TONE = PLAN;

export const STATE_TONE: Record<State, Tone> = { idle: QUIET, queued: QUIET, working: PRIMARY, waiting: WARN };

/** The flash on a node when something happens to it. */
export const PULSE_TONE: Partial<Record<PulseKind, Tone>> = { queued: QUIET, started: PRIMARY, done: PRIMARY, failed: ERROR, approval: WARN, tool: PLAN };
