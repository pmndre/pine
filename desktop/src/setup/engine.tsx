// "Onboarding": the main agent's conversation `setup`, which leads a new owner to a model, and on
// from there. Until a model answers and the owner chose the default model, the steps are pine's own: a few lines and question cards,
// derived from the daemon's state (the main agent's `modelProblem`, the providers signed in to, the
// model servers) and written into no history, so that a reload draws them again and steps that are
// done show as done. What the owner picked on this page (a branch, an answer) is kept only while
// the page lives. The ways to a model are listed in branches.ts. Once the default model is chosen,
// pine posts one fixed message of the owner's (`GO_ON`) and the main agent goes on with its own
// questions. Until a
// model answers, what the owner types in the composer here is matched against the card on screen
// (`Setup.type`), and nothing is sent: there is nobody to send it to.
import { CpuIcon } from "lucide-react";
import { Fragment, useEffect } from "react";
import { COMPOSER_QUESTION, type HostedCard, QuestionCard, QuestionCardHost, type QuestionCardHostValue, QuestionTrace, useHostedCard } from "@/components/question-card";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageContent } from "@/components/ui/message";
import type { ModelServer, Provider } from "../api.ts";
import { api } from "../api.ts";
import { Model, store, type Tab, useModel } from "../model.ts";
import { BRANCHES } from "./branches.ts";
import type { SetupAnswer, SetupContext, SetupFacts } from "./types.ts";

const FIRST = "How should your agents run?";
const DEFAULT = "Which default model should your agents run on?";
/** How many models of the provider pine chose from the card offers besides pine's choice: with "Another…", six options at most. */
const OTHERS = 4;
/** The owner's message once the default model is chosen, as theirs: the main agent takes over from it. */
export const GO_ON = "My agents have a model now. I am new to pine, so do not give me too much at once. Look at what is already set up, then ask me, with one question where I can tick several, about the few things most worth setting up first, and give me a way to leave it for later.";
/** pine's one line for what the owner typed that names no option, while no model can answer it. */
export const NO_MODEL_LINE = "There is no model yet to answer that. Pick one of the options, or type an option's name. Each description explains what the option means.";

/** Text and labels compared as the owner may type them: any case, spaces at the ends and in between not counted. */
const plain = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** What the steps hold while the page lives: what was picked here. Everything else is asked of the daemon. */
class Setup extends Model {
	providers: Provider[] = [];
	servers: ModelServer[] = [];
	/** The models that can be used now, for the card of the default model. */
	models: string[] = [];
	/** The branch picked on the first card, while no model answers. */
	picked?: string;
	/** What the owner answered here, in order. */
	answers: SetupAnswer[] = [];
	/** The default model the owner answered with here. */
	chose?: string;
	/** What the owner typed that named no option, each after the answers given before it. Kept as `answers` are. */
	typed: Array<{ text: string; after: number }> = [];
	/** The card a step drew above the composer, as it registered with the steps' host: what typed text is matched against. */
	shown?: HostedCard;

	/**
	 * The host the steps' cards register with, between them and the conversation's: it keeps the card
	 * for `type`, and draws the steps again only when what the composer takes from it changes: whether it
	 * holds a secret, and what the composer says under it.
	 */
	host: QuestionCardHostValue = {
		register: (card) => {
			this.shown = card;
			this.looksChanged();
			return () => {
				if (this.shown !== card) return;
				this.shown = undefined;
				this.looksChanged();
			};
		},
	};

	/** Whether the card on screen holds a secret, as the steps were last drawn with it. */
	secret = false;
	/** What the card on screen asks the composer to say, as the steps were last drawn with it. */
	placeholder?: string;
	/** Whether the card on screen has options that typed text can name, as the steps were last drawn with it. */
	pickable = false;

	// Looked at once the effects have run: a card drawn again goes and comes back in one go, which changes nothing.
	private looksChanged(): void {
		queueMicrotask(() => {
			const secret = Boolean(this.shown?.secret);
			const placeholder = this.shown?.placeholder;
			const pickable = Boolean(this.shown?.answer && this.shown.options?.length);
			if (secret === this.secret && placeholder === this.placeholder && pickable === this.pickable) return;
			this.secret = secret;
			this.placeholder = placeholder;
			this.pickable = pickable;
			this.touch();
		});
	}

	/**
	 * What the owner typed in the composer of "Onboarding" while no model answers: it picks the option
	 * of the card on screen that it names, or gets pine's one line. Nothing is sent: there is nobody to
	 * send it to. Offered to the composer only while no model answers (`SetupCard`).
	 */
	type(tab: Tab, text: string): boolean {
		tab.inputs.push(text.trim());
		const card = this.shown;
		// A card without options (an address, a number) is answered in its own field: typed text names nothing there.
		const labels = card?.options?.map((o) => plain(o.label)) ?? [];
		const named = (card?.multiple ? text.split(",") : [text]).map((part) => labels.indexOf(plain(part)) + 1);
		if (card?.answer && labels.length > 0 && named.every((n) => n > 0)) {
			card.answer([...new Set(named)].sort((a, b) => a - b));
			return true;
		}
		this.typed.push({ text: text.trim(), after: this.answers.length });
		this.touch();
		return true;
	}

	async refresh(): Promise<void> {
		const [providers, servers, models] = await Promise.all([api.providers().catch(() => undefined), api.modelServers().catch(() => undefined), api.models().catch(() => undefined)]);
		if (providers) this.providers = providers;
		if (servers) this.servers = servers;
		if (models) this.models = models;
		this.touch();
	}

	facts(): SetupFacts | undefined {
		const main = store.agents.find((a) => a.main);
		return main && { main, providers: this.providers, servers: this.servers };
	}

	said(question: string, answer: string): void {
		this.answers.push({ question, answer });
		this.touch();
	}

	/** Back to the first card: the branch picked lets go of what it had under way. */
	back(): void {
		BRANCHES.find((b) => b.id === this.picked)?.leave?.();
		this.picked = undefined;
		this.answers = [];
		this.typed = [];
		this.touch();
	}

	/** A sign-in ended, a server was added: the daemon is asked again, the agents first. */
	changed = async (): Promise<void> => {
		await store.refreshAgents();
		await this.refresh();
	};

	context(facts: SetupFacts): SetupContext {
		return { facts, said: (q, a) => this.said(q, a), back: () => this.back(), changed: this.changed };
	}
}

export const setup = new Setup();

/**
 * Whether the default model was chosen: answered on this page, or derived, so that it is not asked
 * again on every reload once the setup went on from there (something was said in "Onboarding").
 */
function chosenNow(tab: Tab): boolean {
	return setup.chose !== undefined || tab.items.length > 0;
}

/** The models the card of the default model lists: pine's choice first, then a few others of the same provider. */
function listed(now: string): string[] {
	const provider = now.split("/")[0];
	return [now, ...setup.models.filter((m) => m !== now && m.startsWith(`${provider}/`)).slice(0, OTHERS)];
}

/** The default model is chosen: noted, and the owner's fixed message is posted, which the main agent answers. */
function chosen(tab: Tab, model: string): void {
	setup.chose = model;
	setup.touch();
	void store.submit(tab, GO_ON);
}

/** The answers that led to the model the agents run on: given here, or derived from the daemon's state after a reload. */
function answersNow(facts: SetupFacts): SetupAnswer[] {
	if (setup.answers.length || facts.main.modelProblem) return setup.answers;
	for (const b of BRANCHES) {
		const more = b.derive?.(facts);
		if (more) return [{ question: FIRST, answer: b.label }, ...more];
	}
	return [];
}

/** What the owner typed after the answers before it, each with pine's line: no model was there to answer it. */
function Typed({ after }: { after: number }) {
	return setup.typed
		.filter((t) => t.after === after)
		.map((t, i) => (
			<Fragment key={i}>
				<Message align="end" data-item="setup-typed">
					<MessageContent>
						<Bubble align="end" variant="muted">
							<BubbleContent className="whitespace-pre-wrap select-text">{t.text}</BubbleContent>
						</Bubble>
					</MessageContent>
				</Message>
				<Message data-slot="setup-no-model">
					<MessageContent className="select-text">
						<p>{NO_MODEL_LINE}</p>
					</MessageContent>
				</Message>
			</Fragment>
		));
}

/** pine's own lines at the top of "Onboarding": its welcome, what was answered, and the model the agents run on once there is one. */
export function SetupScript({ tab }: { tab: Tab }) {
	useModel(setup);
	useModel(store);
	const facts = setup.facts();
	const problem = facts?.main.modelProblem;
	// Asked when the conversation is shown, and again whenever the model comes or goes.
	useEffect(() => void setup.refresh(), [problem]);
	if (!facts) return null;
	return (
		<div className="flex flex-col gap-4">
			<Message data-slot="setup-welcome">
				<MessageContent className="select-text">
					<p>
						This conversation sets pine up. Your agents need a model to think with, and that is the one thing pine needs before they can answer you. Choose below how they should run. Once a model answers, {facts.main.id} takes over here and helps with the rest, as far as you want to go today.
					</p>
				</MessageContent>
			</Message>
			<Typed after={0} />
			{answersNow(facts).map((a, i) => (
				<Fragment key={i}>
					<QuestionTrace data-item="setup-answer" question={a.question} answer={a.answer} answered by="you" />
					<Typed after={i + 1} />
				</Fragment>
			))}
			{problem ? null : (
				<div data-slot="setup-model" data-model={facts.main.model}>
					<Marker className="select-text">
						<MarkerIcon>
							<CpuIcon />
						</MarkerIcon>
						<MarkerContent>
							Your agents now run on <b className="font-mono">{facts.main.model}</b>.
						</MarkerContent>
					</Marker>
				</div>
			)}
			{!problem && chosenNow(tab) ? <QuestionTrace data-item="setup-answer" question={DEFAULT} answer={setup.chose ?? facts.main.model} answered by="you" /> : null}
		</div>
	);
}

/** The step that is open, as a card above the composer of "Onboarding": nothing once every step is done. */
export function SetupCard({ tab }: { tab: Tab }) {
	useModel(setup);
	useModel(store);
	const facts = setup.facts();
	const problem = facts?.main.modelProblem;
	const branch = BRANCHES.find((b) => b.id === setup.picked);
	// A model answers now: the branch that was picked has nothing more to do.
	useEffect(() => {
		if (!problem && setup.picked) {
			BRANCHES.find((b) => b.id === setup.picked)?.leave?.();
			setup.picked = undefined;
			setup.touch();
		}
	}, [problem]);
	// What the composer is told: before a model, typed text answers the card on screen (or gets pine's line);
	// a card with a secret field keeps what is typed below from being shown or kept, model or not.
	useHostedCard(
		setup.secret
			? { secret: true, placeholder: setup.placeholder }
			: facts && problem
				? { type: (text) => setup.type(tab, text), placeholder: setup.placeholder ?? (setup.pickable ? "Type an option's name to pick it…" : undefined) }
				: undefined,
	);
	if (!facts) return null;
	const ctx = setup.context(facts);
	// The card takes the keyboard as it comes only when nothing is being typed in the composer.
	const free = !tab.draft.trim();
	let card;
	if (problem) {
		card = branch ? (
			<branch.Card ctx={ctx} />
		) : (
			<QuestionCard
				key="first"
				id="model"
				question={FIRST}
				recommended
				header="Model"
				from="pine asks"
				options={BRANCHES.map((b) => ({ id: b.id, label: b.label, description: b.description }))}
				autoFocus={free}
				onAnswer={([n]) => {
					const b = BRANCHES[n - 1];
					setup.answers = [{ question: FIRST, answer: b.label }];
					setup.picked = b.id;
					setup.touch();
				}}
			/>
		);
	} else if (!chosenNow(tab)) {
		const now = facts.main.model;
		const models = listed(now);
		card = (
			<QuestionCard
				key="default"
				id="default"
				question={DEFAULT}
				recommended
				header="Default model"
				from="pine asks"
				options={[
					...models.map((m, i) => ({ id: m, label: m, description: i === 0 ? "pine's choice. Keep it and go on." : undefined })),
					{ id: "another", label: "Another…", description: "Search every model your agents can use now." },
				]}
				autoFocus={free}
				onAnswer={([n]) => {
					if (n > models.length) return void store.chooseDefaultModel().then((m) => m && chosen(tab, m));
					const model = models[n - 1];
					if (model === now) return chosen(tab, model);
					void store.setDefaultModel(model).then((ok) => ok && chosen(tab, model));
				}}
			/>
		);
	} else return null;
	return (
		<ScrollArea data-slot="composer-question" className={COMPOSER_QUESTION}>
			{/* Whichever step drew the card, what the owner types is matched against it (`setup.type`) while no model answers. */}
			<QuestionCardHost.Provider value={setup.host}>{card}</QuestionCardHost.Provider>
		</ScrollArea>
	);
}
