// The steps of "Setup Pine" that are not the engine's own, in the order they are offered. A new
// way to a model is a module of its own (its card, what it derives from the daemon's state) and
// one line in BRANCHES; a step once a model answers is one line in AFTER.
import { apiKey } from "./api-key.tsx";
import { handoff } from "./handoff.tsx";
import { localBranch } from "./local.tsx";
import { subscription } from "./subscription.tsx";
import type { SetupBranch, SetupStage } from "./types.ts";

/** The ways to a model, the recommended one first: the options of "How should your agents run?". */
export const BRANCHES: SetupBranch[] = [subscription, apiKey, localBranch];

/** The steps once a model answers, after the model is kept. */
export const AFTER: SetupStage[] = [handoff];
