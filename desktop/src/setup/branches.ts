// The ways to a model in "Onboarding", in the order they are offered. A new way is a module of its
// own (its card, what it derives from the daemon's state) and one line in BRANCHES.
import { apiKey } from "./api-key.tsx";
import { localBranch } from "./local.tsx";
import { subscription } from "./subscription.tsx";
import type { SetupBranch } from "./types.ts";

/** The ways to a model, the recommended one first: the options of "How should your agents run?". */
export const BRANCHES: SetupBranch[] = [subscription, apiKey, localBranch];
