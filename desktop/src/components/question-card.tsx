import { CheckIcon, XIcon } from "lucide-react";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Questionnaire,
	QuestionnaireActions,
	QuestionnaireChoice,
	QuestionnaireChoiceDescription,
	QuestionnaireChoices,
	QuestionnaireDescription,
	QuestionnaireItem,
	QuestionnaireProgress,
	QuestionnaireSkip,
	QuestionnaireSubmit,
	QuestionnaireTitle,
} from "@/components/ui/questionnaire";

/**
 * A question once it is settled, folded into one line of the conversation: what was asked, and what
 * was answered (or that it was not).
 */
export function QuestionTrace({ question, answer, answered, by, ...props }: React.ComponentProps<typeof Trace> & {
	question: string;
	/** What was answered, when the page knows it (it was answered here). */
	answer?: string;
	answered: boolean;
	/** Who answered, such as "you" or "telegram". */
	by?: string;
}) {
	const about = [answered && answer ? answer : "", by ? `(${by})` : ""].filter(Boolean).join(" · ");
	return (
		<Trace {...props}>
			<TraceLine>
				<TraceIcon>{answered ? <CheckIcon /> : <XIcon />}</TraceIcon>
				<TraceTitle className="select-text" title={question}>
					{answered ? "Answered" : "No answer"} · {question.replace(/\s+/g, " ")}
				</TraceTitle>
				{about ? <TraceDescription className="select-text">{about}</TraceDescription> : null}
			</TraceLine>
		</Trace>
	);
}

/**
 * Where a card above the composer sits: a stock `ScrollArea` with this class. In a short pane (a split
 * view, a small window) it gets what the thread and the composer leave and scrolls inside, so that the
 * composer is never pushed out of the pane; the column under the thread is a flex column down to it,
 * whose gap stands it apart from the composer. A cut option fades out (stock `scroll-fade-y` on the
 * viewport) rather than ending at a hard edge. The viewport clips what it holds, a field's focus ring
 * too: it is padded by the ring's width (stock `ring-3`), and the slot reaches out by as much, so
 * that the card keeps the column's edges and its ring is whole.
 */
export const COMPOSER_QUESTION = "-m-[3px] flex min-h-0 flex-col *:data-[slot=scroll-area-viewport]:p-[3px] *:data-[slot=scroll-area-viewport]:scroll-fade-y";

/** One answer a question offers: a label, and a line that says what it means. */
export interface QuestionCardOption {
	label: string;
	description?: string;
}

/**
 * What a card above the composer tells the composer under it while it is on screen. The composer
 * asks this, and nothing else, about what lies above it.
 */
export interface HostedCard {
	/** A question card's options, for a host that answers it from typed text (pine's own setup steps). */
	options?: QuestionCardOption[];
	multiple?: boolean;
	answer?: (picked: number[]) => void;
	/** What the owner typed in the composer and sent: true when the card took it, and nothing is then sent. */
	type?: (text: string) => boolean;
	/** The card holds a secret field: what is typed in the composer is neither shown nor kept, and pine says to paste it in the card. */
	secret?: true;
	/** What the composer says while this card takes what is typed. */
	placeholder?: string;
}

/** Where a card registers while it is on screen: `register` returns what to call when it goes. */
export interface QuestionCardHostValue {
	register: (card: HostedCard) => () => void;
}

/**
 * The one way from a card above the composer to the composer: every card there registers with the
 * nearest host (`useHostedCard`). A conversation's host is a `ComposerCardSlot`, which its composer
 * reads; pine's setup steps put a host of their own in between, which adds how typed text answers
 * their cards.
 */
export const QuestionCardHost = createContext<QuestionCardHostValue | undefined>(undefined);

/** Register a card with the nearest host while it is on screen (nothing for `undefined`). */
export function useHostedCard(card: HostedCard | undefined): void {
	const host = useContext(QuestionCardHost);
	useEffect(() => (card ? host?.register(card) : undefined), [host, card]);
}

/**
 * A conversation's host: the card registered last that is still on screen. The composer is told
 * only when what it draws from the card changes (whether the card takes typed text, a secret, the
 * placeholder), so that a card drawn again does not draw the composer again.
 */
export class ComposerCardSlot implements QuestionCardHostValue {
	private cards: HostedCard[] = [];
	private listeners = new Set<() => void>();
	private shown = "";

	get card(): HostedCard | undefined {
		return this.cards.at(-1);
	}

	register = (card: HostedCard): (() => void) => {
		this.cards.push(card);
		this.changed();
		return () => {
			this.cards = this.cards.filter((c) => c !== card);
			this.changed();
		};
	};

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => void this.listeners.delete(listener);
	};

	/** What the composer draws from the card, as a text that changes only when that does (`useSyncExternalStore`). */
	looks = (): string => {
		const c = this.card;
		return c ? JSON.stringify([Boolean(c.type), Boolean(c.secret), c.placeholder ?? ""]) : "";
	};

	// Looked at once the effects have run: a card drawn again goes and comes back in one go, which changes nothing.
	private changed(): void {
		queueMicrotask(() => {
			const now = this.looks();
			if (now === this.shown) return;
			this.shown = now;
			for (const l of this.listeners) l();
		});
	}
}

/**
 * A question put to the owner, inline above the composer of its conversation: shadcn's
 * `Questionnaire` with one item, laid out flat as shadcn's examples lay one out, with no frame of its
 * own: the question as its title, who asks (with the few words the asker put to it, such as "Model")
 * as its description, the options as its rows, and its actions row at the bottom: the asker's own
 * ways out ("Back", "Cancel") at the start, where Previous stands, then No answer (the
 * questionnaire's Skip: skipping its one item submits it with nothing picked) and Send (its Submit).
 * The questionnaire brings the radios or checkboxes, each option's number and its key, the arrows,
 * and Enter, which sends what is picked. As stock, a pick is only a pick until Send, so that the owner
 * can change their mind ("2" then Enter is the quick way). What is pine's: "recommended" on the first
 * option of a single answer where the asker orders its options so (`recommended`). There is no field
 * for the owner's own words: the composer below is that (`type`, through the host). The same card
 * for an agent's `question` and for what pine asks itself.
 */
export function QuestionCard({ question, header, from, options, multiple, recommended, autoFocus, actions, type, placeholder, place, onAnswer, onNoAnswer }: {
	question: string;
	/** A few words about the question, such as "Database", said with who asks. */
	header?: string;
	/** Who asks, such as "main asks". */
	from?: string;
	options: QuestionCardOption[];
	/** Several may be picked, and are sent together. */
	multiple?: boolean;
	/**
	 * The first option is the one the asker would pick, and is marked so: an agent's `question` (the
	 * recommended one first) and pine's own first card. Off for lists of what was found or offered.
	 */
	recommended?: boolean;
	/** Takes the keyboard as it is shown: the arrows then reach the options, and a digit answers. */
	autoFocus?: boolean;
	/** Ways out other than an answer, before Later and No answer: "Back" in pine's own steps, "Cancel" in a sign-in. */
	actions?: React.ReactNode;
	/** What the owner typed in the composer below answers this card: true when it was taken (`HostedCard.type`). */
	type?: (text: string) => boolean;
	/** What the composer says while `type` takes what is typed. */
	placeholder?: string;
	/** Where this question stands among several asked together: stock `QuestionnaireProgress`, told the count, since the card holds one of them. */
	place?: { at: number; of: number };
	/** The answer: the numbers of the options picked, counted from 1, in the order shown. */
	onAnswer: (picked: number[]) => void;
	onNoAnswer?: () => void;
}) {
	const title = useId();
	const item = useRef<HTMLFieldSetElement>(null);
	const [ticked, setTicked] = useState(false);
	useHostedCard({ options, multiple, answer: onAnswer, type, placeholder });
	useEffect(() => {
		// The questionnaire's own place for the keyboard: its item, from which the arrows reach the options.
		// Without scrolling: in a short pane the card's slot would otherwise start scrolled, its top cut and faded.
		if (autoFocus) item.current?.focus({ preventScroll: true });
	}, [autoFocus]);
	// The card may stay on screen after an answer (a step that opens a dialog): it is cleared once the
	// questionnaire has taken the pick in, so that the same option answers again.
	const settle = (form: HTMLFormElement | null, picked: number[]) => {
		if (picked.length) onAnswer(picked);
		else onNoAnswer?.();
		setTimeout(() => form?.reset());
	};
	const about = [header, from].filter(Boolean).join(" · ");
	return (
		<Questionnaire
			defaultItem="answer"
			shortcuts="numbers"
			onSubmit={(e) => {
				e.preventDefault();
				// Submitted with nothing picked is the questionnaire's Skip: Send and Enter submit only an answer.
				settle(e.currentTarget, new FormData(e.currentTarget).getAll("answer").map(Number).sort((a, b) => a - b));
			}}
		>
			{place ? (
				<QuestionnaireProgress aria-valuenow={place.at} aria-valuemax={place.of} aria-valuetext={`Question ${place.at} of ${place.of}`}>
					Question {place.at} of {place.of}
				</QuestionnaireProgress>
			) : null}
			<QuestionnaireItem ref={item} name="answer" multiple={multiple} aria-labelledby={title} onStatusChange={(status) => setTicked(status === "answered")}>
				<QuestionnaireTitle id={title} className="whitespace-pre-wrap select-text">
					{question}
				</QuestionnaireTitle>
				{about ? <QuestionnaireDescription>{about}</QuestionnaireDescription> : null}
				{options.length ? (
					<QuestionnaireChoices>
						{options.map((o, i) => (
							<QuestionnaireChoice key={i} value={String(i + 1)}>
								<span className="flex flex-wrap items-center gap-2">
									<span className="font-medium" data-slot="question-card-label">{o.label}</span>
									{/* What the agent would pick: one option, so not on a question with several answers. */}
									{i === 0 && recommended && !multiple ? <Badge variant="secondary">recommended</Badge> : null}
								</span>
								{o.description ? <QuestionnaireChoiceDescription>{o.description}</QuestionnaireChoiceDescription> : null}
							</QuestionnaireChoice>
						))}
					</QuestionnaireChoices>
				) : null}
			</QuestionnaireItem>
			{actions || onNoAnswer || options.length ? (
				<CardActions start={actions}>
					{onNoAnswer ? <QuestionnaireSkip size="sm">No answer</QuestionnaireSkip> : null}
					{options.length ? <QuestionnaireSubmit size="sm" disabled={!ticked}>Send</QuestionnaireSubmit> : null}
				</CardActions>
			) : null}
		</Questionnaire>
	);
}

/**
 * The actions row at the bottom of a card above the composer: stock `QuestionnaireActions`, whose
 * grid has three places (Previous, Skip, Next). A card here holds more, so the row flows instead,
 * with the asker's own ways out (`start`: Back, Cancel) at the start where Previous stands, and the
 * rest at the end. Plain buttons take the stock buttons' touch height on a narrow screen, so that the
 * row keeps one height.
 */
export function CardActions({ start, children }: { start?: React.ReactNode; children?: React.ReactNode }) {
	return (
		<QuestionnaireActions className="flex flex-wrap justify-end [&_[data-slot=button]]:min-h-11 sm:[&_[data-slot=button]]:min-h-0">
			{start ? <div className="me-auto flex flex-wrap items-center gap-2">{start}</div> : null}
			{children}
		</QuestionnaireActions>
	);
}
