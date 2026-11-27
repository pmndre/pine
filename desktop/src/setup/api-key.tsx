// The way to a model with an API key: which provider (the most common ones, and every other one
// through the pick dialog's search), then a card with a secret field of its own, whose key goes
// straight to pi's sign-in for that provider through the control API Settings > Models uses
// (`/models/login` with `api_key`), so that the daemon chooses the agents' model as it does there.
// The key is held by the field alone and handed to the sign-in: what the conversation shows is
// that a key was saved for the provider, never a character of it.
import { useEffect, useState } from "react";
import { FieldCard, FormCard } from "@/components/field-card";
import { type HostedCard, QuestionCard, useHostedCard } from "@/components/question-card";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import type { Provider } from "../api.ts";
import { Model, store, useModel } from "../model.ts";
import { KEY_PROVIDERS, providerAbout, providerName, providerWords } from "../providers.ts";
import { SignInRun } from "../sign-in.ts";
import type { SetupBranch, SetupContext } from "./types.ts";

const WHICH = "Which provider?";
const ANOTHER = "Another…";

/** A provider by the name people know it by here: the company's, since the key comes from it. */
const nameOf = (id: string, providers: Provider[]) => {
	const p = providers.find((x) => x.id === id);
	return KEY_PROVIDERS[id]?.title ?? (p ? providerName(p) : id);
};

/** The line the key folds into: it says where the key went, and nothing of the key. */
const savedLine = (name: string) => ({ question: `Your API key for ${name}`, answer: `Key saved for ${name}` });

/** The sign-in under way, while this branch is picked: kept here so that it goes on while another tab is in front. */
class Picked extends Model {
	run?: SignInRun;
	name = "";
	/** Counts the sign-ins started, so that a new one ("Try again") has a fresh card and what was typed in the last goes. */
	serial = 0;
	/** Where the line about the saved key goes, once a key was handed to the sign-in. */
	private say?: SetupContext["said"];
	/** The run whose saved key the conversation was told of already. */
	private told?: SignInRun;

	start(provider: string, name: string): void {
		this.run?.end();
		this.run = new SignInRun(provider, "api_key");
		this.name = name;
		this.serial++;
		this.say = undefined;
		this.touch();
	}

	/** A key goes to the sign-in: its line is said once it is stored. */
	sent(say: SetupContext["said"]): void {
		this.say = say;
	}

	/**
	 * The key is stored: the conversation says so, once. Called when the sign-in is seen done, and
	 * when a model answers, which may be seen first (the agents are asked on other occasions than
	 * this card's), since the daemon chooses one only after the key was stored.
	 */
	tell(): void {
		const run = this.run;
		if (!run || !this.say || this.told === run || run.error || run.state?.error) return;
		this.told = run;
		const line = savedLine(this.name);
		this.say(line.question, line.answer);
	}

	stop(): void {
		this.run?.end();
		this.run = undefined;
		this.touch();
	}
}

const picked = new Picked();

/** The providers on the card: the common ones pine knows of, in that order. */
const common = (providers: Provider[]) => Object.keys(KEY_PROVIDERS).filter((id) => providers.some((p) => p.id === id));

async function another(ctx: SetupContext): Promise<void> {
	const all = ctx.facts.providers;
	const id = await store.pick({
		title: WHICH,
		placeholder: "Search providers, such as Mistral or Kimi",
		items: all.map((p) => ({ value: p.id, label: nameOf(p.id, all), about: providerAbout(p) ?? p.name, words: providerWords(p) })),
	});
	if (!id) return;
	ctx.said(WHICH, nameOf(id, all));
	picked.start(id, nameOf(id, all));
}

/** What the composer is told while the key's field is open. */
const SECRET: HostedCard = { secret: true, placeholder: "Paste the key in the field above, not here" };

/** The key's own card: a secret field, Save, and what the sign-in said when it did not take the key. */
function KeyCard({ run, name, ctx }: { run: SignInRun; name: string; ctx: SetupContext }) {
	const [sent, setSent] = useState(false);
	const s = run.state;
	const q = s?.done ? undefined : s?.question;
	// The key goes into this card's field: what is typed in the composer below is neither shown nor kept.
	useHostedCard(q?.options?.length ? undefined : SECRET);
	const cancel = (
		<Button
			size="sm"
			variant="ghost"
			data-action="cancel"
			onClick={() => {
				picked.stop();
				ctx.back();
			}}
		>
			Cancel
		</Button>
	);
	// A provider whose flow asks a choice before the key (a region, a plan) asks it with the question card.
	if (q?.options?.length) {
		const options = q.options;
		return <QuestionCard question={q.message} header="API key" from={name} options={options.map((o) => ({ label: o.label, description: o.description }))} autoFocus actions={cancel} onAnswer={([n]) => void run.answer(options[n - 1].id)} />;
	}
	const error = run.error ?? s?.error;
	const card = {
		"data-card": "setup-api-key",
		"data-provider": run.provider,
		title: `Your API key for ${name}`,
		about: "Paste the key you made on the provider's site. pine checks it when your agents first use it.",
		error,
		start: cancel,
	};
	// The sign-in ended without the key (refused, or cancelled elsewhere): another try starts it again.
	if (s?.done) return <FormCard {...card} end={<Button size="sm" variant="outline" data-action="retry" onClick={() => picked.start(run.provider, name)}>Try again</Button>} />;
	return (
		<FieldCard
			{...card}
			label={q && !q.secret ? q.message : "API key"}
			type={q && !q.secret ? "text" : "password"}
			help="What you type stays hidden and goes straight to pine's key store. No agent or model reads it."
			button="Save"
			waiting={!q || sent}
			onSend={(key) => {
				setSent(true);
				picked.sent(ctx.said);
				void run.answer(key).then(() => setSent(false));
			}}
		/>
	);
}

function Card({ ctx }: { ctx: SetupContext }) {
	useModel(picked);
	const run = picked.run;
	useModel(run ?? picked);
	const done = run?.state?.done;
	const failed = run?.state?.error ?? run?.error;
	const { changed } = ctx;
	useEffect(() => {
		// The key is stored: the line says so, and what the daemon chose now is read back, once.
		if (!run || !done || failed) return;
		picked.tell();
		void changed();
	}, [run, done, failed, changed]);
	if (!run) {
		const ids = common(ctx.facts.providers);
		return (
			<QuestionCard
				id="provider"
				question={WHICH}
				header="API key"
				from="pine asks"
				options={[...ids.map((id) => ({ id, label: KEY_PROVIDERS[id].title, description: KEY_PROVIDERS[id].about })), { id: "another", label: ANOTHER, description: "Search all providers pine knows." }]}
				autoFocus
				actions={<Button size="sm" variant="ghost" data-action="back" onClick={ctx.back}>Back</Button>}
				onAnswer={([n]) => {
					const id = ids[n - 1];
					if (!id) return void another(ctx);
					ctx.said(WHICH, KEY_PROVIDERS[id].title);
					picked.start(id, KEY_PROVIDERS[id].title);
				}}
			/>
		);
	}
	// Stored, and pine chose no model by itself (none of the provider's fits, or the agents' own could answer): the choice is the owner's.
	if (done && !failed)
		return (
			<Item variant="outline" size="sm" data-slot="setup-signed-in">
				<ItemContent>
					<ItemTitle>Key saved for {picked.name}</ItemTitle>
					<ItemDescription className="line-clamp-none">{run.state?.chosen ? `Your agents now run on ${run.state.chosen}.` : "Choose the model your agents run on."}</ItemDescription>
				</ItemContent>
				{run.state?.chosen ? null : (
					<ItemActions>
						<Button size="sm" onClick={() => void store.chooseDefaultModel(run.state?.models).then(changed)}>Choose a model…</Button>
					</ItemActions>
				)}
			</Item>
		);
	return <KeyCard key={picked.serial} run={run} name={picked.name} ctx={ctx} />;
}

export const apiKey: SetupBranch = {
	id: "api-key",
	label: "An API key",
	description: "A key from a provider such as Anthropic, OpenAI or Google. You pay for what your agents use.",
	derive: (facts) => {
		// Signed in with a key (`via`): one signed in to in the browser is the subscription's to derive.
		const provider = facts.main.model?.split("/")[0] ?? "";
		const p = facts.providers.find((x) => x.id === provider && x.signedIn && x.via !== "oauth");
		if (!p || facts.servers.some((s) => s.name === provider)) return undefined;
		const name = nameOf(provider, facts.providers);
		return [{ question: WHICH, answer: name }, savedLine(name)];
	},
	Card,
	leave: () => {
		// Left because a model answers: the key that brought it is stored.
		picked.tell();
		picked.stop();
	},
};
