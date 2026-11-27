// The way to a model with a subscription the owner has already (Claude, ChatGPT, Copilot): which
// one, then pi's sign-in for it in the browser, through the control API Settings > Models uses, so
// that the daemon chooses the agents' model as it does there (`settleModel`).
import { useEffect } from "react";
import { QuestionCard } from "@/components/question-card";
import { SignInCard } from "@/components/sign-in-card";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Model, store, useModel } from "../model.ts";
import { SUBSCRIPTIONS } from "../providers.ts";
import { SignInRun } from "../sign-in.ts";
import type { SetupBranch, SetupContext } from "./types.ts";

const WHICH = "Which subscription?";

/** The sign-in under way, while this branch is picked: kept here so that it goes on while another tab is in front. */
class Picked extends Model {
	run?: SignInRun;

	start(provider: string): void {
		this.run?.end();
		this.run = new SignInRun(provider, "oauth");
		this.touch();
	}

	stop(): void {
		this.run?.end();
		this.run = undefined;
		this.touch();
	}
}

const picked = new Picked();

function Card({ ctx }: { ctx: SetupContext }) {
	useModel(picked);
	const run = picked.run;
	useModel(run ?? picked);
	const done = run?.state?.done;
	const failed = run?.state?.error;
	const { changed } = ctx;
	useEffect(() => {
		// Signed in: what the daemon chose now is read back, once, and the steps go on from there.
		if (run && done && !failed) void changed();
	}, [run, done, failed, changed]);
	if (!run) {
		const ids = Object.keys(SUBSCRIPTIONS);
		return (
			<QuestionCard
				question={WHICH}
				header="Model"
				from="pine asks"
				options={ids.map((id) => ({ label: SUBSCRIPTIONS[id].title, description: SUBSCRIPTIONS[id].about }))}
				autoFocus
				actions={<Button size="sm" variant="ghost" onClick={ctx.back}>Back</Button>}
				onAnswer={([n]) => {
					const id = ids[n - 1];
					ctx.said(WHICH, SUBSCRIPTIONS[id].title);
					picked.start(id);
				}}
			/>
		);
	}
	const name = SUBSCRIPTIONS[run.provider]?.title ?? run.provider;
	const s = run.state;
	// Signed in, and pine chose no model by itself (the agents' choice could answer, or none of the new ones fits):
	// the choice is the owner's, among the new ones. Once a model answers, the engine goes on.
	if (s?.done && !s.error && !run.error)
		return (
			<Item variant="outline" size="sm" data-slot="setup-signed-in">
				<ItemContent>
					<ItemTitle>Signed in to {name}</ItemTitle>
					<ItemDescription className="line-clamp-none">{s.chosen ? `Your agents now run on ${s.chosen}.` : "Choose the model your agents run on."}</ItemDescription>
				</ItemContent>
				{s.chosen ? null : (
					<ItemActions>
						<Button size="sm" onClick={() => void store.chooseDefaultModel(s.models).then(changed)}>Choose a model…</Button>
					</ItemActions>
				)}
			</Item>
		);
	// A sign-in that ended without a model (cancelled elsewhere, refused): said on the card, which stays until Cancel.
	const error = run.error ?? (s?.done ? (s.error ?? "The sign-in finished, but no model came with it.") : undefined);
	return (
		<SignInCard
			provider={name}
			url={s?.done ? undefined : s?.url}
			code={s?.done ? undefined : s?.code}
			question={s?.done ? undefined : s?.question}
			error={error}
			onOpen={() => run.openPage()}
			onCopy={(code) => void navigator.clipboard.writeText(code).then(() => store.flash("Code copied.", "good", 3000), () => store.flash("Could not copy the code.", "bad"))}
			onAnswer={(answer) => void run.answer(answer)}
			onCancel={() => {
				picked.stop();
				ctx.back();
			}}
		/>
	);
}

export const subscription: SetupBranch = {
	id: "subscription",
	label: "A subscription",
	description: "Claude, ChatGPT or GitHub Copilot, if you already pay for one. You sign in in your browser, with no key to copy.",
	derive: (facts) => {
		const provider = facts.main.model?.split("/")[0] ?? "";
		const sub = SUBSCRIPTIONS[provider];
		if (!sub || !facts.providers.some((p) => p.id === provider && p.via === "oauth")) return undefined;
		return [{ question: WHICH, answer: sub.title }];
	},
	Card,
	leave: () => picked.stop(),
};
