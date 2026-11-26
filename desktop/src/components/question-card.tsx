import { CheckIcon, MessageCircleQuestionIcon, XIcon } from "lucide-react";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from "@/components/ui/item";
import {
	Questionnaire,
	QuestionnaireActions,
	QuestionnaireChoice,
	QuestionnaireChoiceDescription,
	QuestionnaireChoices,
	QuestionnaireItem,
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
 * viewport) rather than ending at a hard edge.
 */
export const COMPOSER_QUESTION = "flex min-h-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade-y";

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
 * `Questionnaire` with one item, in an `Item` shell on the Confirmation pattern (a few words over it
 * as a `Badge`, the question, Later and No answer), as shadcn's example puts a questionnaire in a
 * card. The questionnaire brings the radios or checkboxes, each option's number and its key, the
 * arrows and Enter. What is pine's: a single answer is given as soon as an option is picked by a
 * click, its number or Space (the arrows only move, and Enter answers with the option they reached),
 * so there is no Submit; several are ticked and sent with Send; "recommended" on the first option of
 * a single answer where the asker orders its options so (`recommended`). There is no field for the
 * owner's own words: the composer below is that (`type`, through the host). The same card for an
 * agent's `question` and for what pine asks itself.
 */
export function QuestionCard({ question, header, from, options, multiple, recommended, autoFocus, actions, type, placeholder, onAnswer, onNoAnswer, onLater }: {
	question: string;
	/** A few words over the question, such as "Database". */
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
	/** The answer: the numbers of the options picked, counted from 1, in the order shown. */
	onAnswer: (picked: number[]) => void;
	onNoAnswer?: () => void;
	onLater?: () => void;
}) {
	const title = useId();
	const item = useRef<HTMLFieldSetElement>(null);
	const [ticked, setTicked] = useState(false);
	// The arrows check a radio as they move to it: only a pick by another hand answers at once.
	const moving = useRef(false);
	useHostedCard({ options, multiple, answer: onAnswer, type, placeholder });
	useEffect(() => {
		// The questionnaire's own place for the keyboard: its item, from which the arrows reach the options.
		if (autoFocus) item.current?.focus();
	}, [autoFocus]);
	// The card may stay on screen after an answer (a step that opens a dialog): it is cleared once the
	// questionnaire has taken the pick in, so that the same option answers again.
	const answer = (form: HTMLFormElement | null, picked: number[]) => {
		onAnswer(picked);
		setTimeout(() => form?.reset());
	};
	return (
		<Questionnaire
			defaultItem="answer"
			shortcuts="numbers"
			onKeyDownCapture={(e) => {
				moving.current = e.key.startsWith("Arrow");
			}}
			onPointerDownCapture={() => {
				moving.current = false;
			}}
			onSubmit={(e) => {
				e.preventDefault();
				const picked = new FormData(e.currentTarget).getAll("answer").map(Number);
				if (picked.length) answer(e.currentTarget, picked.sort((a, b) => a - b));
			}}
		>
			<QuestionnaireItem ref={item} name="answer" multiple={multiple} aria-labelledby={title} onStatusChange={(status) => setTicked(status === "answered")}>
				<Item variant="outline" size="sm" data-slot="question-card" data-multiple={multiple ? "" : undefined}>
					<ItemMedia variant="icon">
						<MessageCircleQuestionIcon />
					</ItemMedia>
					<ItemContent>
						{header || from ? (
							<ItemDescription className="flex items-center gap-2">
								{header ? <Badge variant="outline">{header}</Badge> : null}
								{from}
							</ItemDescription>
						) : null}
						<QuestionnaireTitle id={title} render={<ItemTitle className="line-clamp-none whitespace-pre-wrap select-text" data-slot="question-card-question" />}>
							{question}
						</QuestionnaireTitle>
					</ItemContent>
					<ItemActions>
						{actions}
						{onLater ? <Button size="sm" variant="ghost" onClick={onLater}>Later</Button> : null}
						{onNoAnswer ? <Button size="sm" variant="ghost" onClick={onNoAnswer}>No answer</Button> : null}
					</ItemActions>
					{options.length ? (
						<ItemFooter className="flex-col items-stretch">
							<QuestionnaireChoices>
								{options.map((o, i) => (
									<QuestionnaireChoice
										key={i}
										value={String(i + 1)}
										onChange={(e) => {
											if (!multiple && e.currentTarget.checked && !moving.current) answer(e.currentTarget.form, [i + 1]);
										}}
									>
										<span className="flex flex-wrap items-center gap-2">
											<span className="font-medium" data-slot="question-card-label">{o.label}</span>
											{/* What the agent would pick: one option, so not on a question with several answers. */}
											{i === 0 && recommended && !multiple ? <Badge variant="secondary">recommended</Badge> : null}
										</span>
										{o.description ? <QuestionnaireChoiceDescription>{o.description}</QuestionnaireChoiceDescription> : null}
									</QuestionnaireChoice>
								))}
							</QuestionnaireChoices>
							{multiple ? (
								<QuestionnaireActions>
									<QuestionnaireSubmit size="sm" disabled={!ticked}>Send</QuestionnaireSubmit>
								</QuestionnaireActions>
							) : null}
						</ItemFooter>
					) : null}
				</Item>
			</QuestionnaireItem>
		</Questionnaire>
	);
}
