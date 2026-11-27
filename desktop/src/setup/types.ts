// What the steps of "Onboarding" are made of (src/setup/). The engine (engine.tsx) walks them; a
// way to a model is a branch of its own (subscription.tsx, and one module for each other way),
// listed once in branches.ts. A branch holds what it is doing (a sign-in under way) and nothing
// that has to outlive the page: what is done is read back from the daemon (`SetupFacts`).
import type { ReactNode } from "react";
import type { AgentInfo, ModelServer, Provider } from "../api.ts";

/** What the steps are derived from: the daemon's state, read anew when the page is loaded and when it may have changed. */
export interface SetupFacts {
	/** The main agent, with its model and why it cannot answer (`modelProblem`). */
	main: AgentInfo;
	providers: Provider[];
	servers: ModelServer[];
}

/** A question the owner answered, for the line it folds into. */
export interface SetupAnswer {
	question: string;
	answer: string;
}

/** What a branch's card is given. */
export interface SetupContext {
	facts: SetupFacts;
	/** Note an answer of the owner's: it folds into a line above, until the page is reloaded. */
	said(question: string, answer: string): void;
	/** Leave this branch: the first card is back. */
	back(): void;
	/** Something may have changed on the daemon (a sign-in ended, a server was added): ask again. */
	changed(): Promise<void>;
}

/** A way to a model, offered on the first card ("How should your agents run?"). */
export interface SetupBranch {
	id: string;
	/** Its option on the first card. The first branch listed is the recommended one. */
	label: string;
	description: string;
	/**
	 * The answers that led to the model the agents run on, when it came this way, derived from the
	 * facts: what the steps fold into after a reload. Nothing when it came another way.
	 */
	derive?(facts: SetupFacts): SetupAnswer[] | undefined;
	/** Its card above the composer, while it is picked and no model answers yet. */
	Card(props: { ctx: SetupContext }): ReactNode;
	/** The owner left it, or a model answers now: what it has under way is let go. */
	leave?(): void;
}
