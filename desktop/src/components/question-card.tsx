import { CheckIcon, EyeIcon, MessageCircleQuestionIcon, XIcon } from "lucide-react";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import {
	Questionnaire,
	QuestionnaireActions,
	QuestionnaireChoice,
	QuestionnaireChoiceDescription,
	QuestionnaireChoices,
	QuestionnaireDescription,
	QuestionnaireItem,
	QuestionnaireNext,
	QuestionnairePrevious,
	QuestionnaireProgress,
	QuestionnaireSkip,
	QuestionnaireSubmit,
	QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import { cn } from "@/lib/utils";
import type { AskedQuestion } from "../api.ts";

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
 * for the owner's own words: the composer below is that, and a host that answers a card from typed
 * text does it through `HostedCard.type`. The card for what pine asks itself (its setup steps, a
 * sign-in's choice); an agent's questions are `QuestionsCard`.
 */
export function QuestionCard({ question, header, from, options, multiple, recommended, autoFocus, actions, onAnswer, onNoAnswer }: {
	question: string;
	/** A few words about the question, such as "Database", said with who asks. */
	header?: string;
	/** Who asks, such as "main asks". */
	from?: string;
	options: QuestionCardOption[];
	/** Several may be picked, and are sent together. */
	multiple?: boolean;
	/**
	 * The first option is the one the asker would pick, and is marked so: pine's own first card. Off
	 * for lists of what was found or offered.
	 */
	recommended?: boolean;
	/** Takes the keyboard as it is shown: the arrows then reach the options, and a digit answers. */
	autoFocus?: boolean;
	/** Ways out other than an answer, before Later and No answer: "Back" in pine's own steps, "Cancel" in a sign-in. */
	actions?: React.ReactNode;
	/** The answer: the numbers of the options picked, counted from 1, in the order shown. */
	onAnswer: (picked: number[]) => void;
	onNoAnswer?: () => void;
}) {
	const title = useId();
	const item = useRef<HTMLFieldSetElement>(null);
	const [ticked, setTicked] = useState(false);
	useHostedCard({ options, multiple, answer: onAnswer });
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

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** A question's few words and who asks, as its description says them. */
const aboutOf = (q: AskedQuestion, from: string) => [q.header, from].filter(Boolean).join(" · ");

/**
 * What the questions' card sends, as the owner's message: for a question alone, the label picked (the
 * ticks joined by ", "); for several, one line per question answered, "<question> <answer>". A
 * question skipped, or one without options, adds nothing. `picked` holds the numbers of the options
 * picked for each question, counted from 1.
 */
export function answerText(questions: AskedQuestion[], picked: number[][]): string {
	const answers = questions.map((q, i) => (picked[i] ?? []).map((n) => q.options?.[n - 1]?.label).filter(Boolean).join(", "));
	if (questions.length === 1) return answers[0] ?? "";
	return questions.flatMap((q, i) => (answers[i] ? [`${oneLine(q.question)} ${answers[i]}`] : [])).join("\n");
}

/**
 * The questions an agent's latest turn asked, inline above the composer of its conversation: shadcn's
 * `Questionnaire` with one item per question, in the order they were asked, laid out flat as
 * `QuestionCard` is. Each item: the question as its title, its few words and who asks as its
 * description, its options as rows. Several go one by one with Previous, Skip and Next, and stock
 * `QuestionnaireProgress` says where the owner is ("1 / 2"; its value text still "Question 1 of 2")
 * at the top right of the item, on the title's line, where shadcn's Card example puts it in the
 * header's corner; Send is on the last. A question alone has its options and Send. Send hands
 * `onSend` one message (`answerText`), which goes as the owner's own: there is no "No answer" and no
 * field for words, since what is typed in the composer below is always a message of its own. A
 * question without options says to answer by typing. With `outside`, a quiet line says that the
 * conversation has read outside content, which the questions may come from.
 */
export function QuestionsCard({ questions, from, outside, autoFocus, onSend }: {
	questions: AskedQuestion[];
	/** Who asks, such as "main asks". */
	from: string;
	/** The conversation carries the outside-content mark. */
	outside?: boolean;
	/** Takes the keyboard as it is shown: the arrows then reach the options, and a digit picks. */
	autoFocus?: boolean;
	onSend: (text: string) => void;
}) {
	const several = questions.length > 1;
	const [current, setCurrent] = useState(0);
	const [answered, setAnswered] = useState<boolean[]>([]);
	const first = useRef<HTMLFieldSetElement>(null);
	const id = useId();
	// Only as it is shown: the turn goes on after it asked, and the card is drawn again while the owner types below.
	const [focusFirst] = useState(autoFocus);
	useEffect(() => {
		// Without scrolling: in a short pane the card's slot would otherwise start scrolled, its top cut and faded.
		if (focusFirst) first.current?.focus({ preventScroll: true });
	}, [focusFirst]);
	const lone = !several && !questions[0]?.options?.length;
	return (
		<Questionnaire
			defaultItem="q0"
			shortcuts="numbers"
			className={cn(several && "relative")}
			onItemChange={(name) => setCurrent(Number(name.slice(1)) || 0)}
			onSubmit={(e) => {
				e.preventDefault();
				const form = new FormData(e.currentTarget);
				const text = answerText(questions, questions.map((_, i) => form.getAll(`q${i}`).map(Number).sort((a, b) => a - b)));
				if (text) onSend(text);
			}}
		>
			{several ? (
				<QuestionnaireProgress className="absolute end-0 top-0.5 min-w-0">
					{current + 1} / {questions.length}
				</QuestionnaireProgress>
			) : null}
			{questions.map((q, i) => (
				<QuestionnaireItem key={i} ref={i === 0 ? first : undefined} name={`q${i}`} multiple={q.multiSelect} aria-labelledby={`${id}-${i}`} onStatusChange={(status) => setAnswered((a) => Object.assign([...a], { [i]: status === "answered" }))}>
					<QuestionnaireTitle id={`${id}-${i}`} className={cn("whitespace-pre-wrap select-text", several && "pe-12")}>
						{q.question}
					</QuestionnaireTitle>
					<QuestionnaireDescription>{aboutOf(q, from)}</QuestionnaireDescription>
					{q.options?.length ? (
						<QuestionnaireChoices>
							{q.options.map((o, n) => (
								<QuestionnaireChoice key={n} value={String(n + 1)}>
									<span className="flex flex-wrap items-center gap-2">
										<span className="font-medium" data-slot="question-card-label">{o.label}</span>
										{/* The agent puts the option it would pick first: one option, so not on a question with several answers. */}
										{n === 0 && !q.multiSelect ? <Badge variant="secondary">recommended</Badge> : null}
									</span>
									{o.description ? <QuestionnaireChoiceDescription>{o.description}</QuestionnaireChoiceDescription> : null}
								</QuestionnaireChoice>
							))}
						</QuestionnaireChoices>
					) : (
						<QuestionnaireDescription>Answer it by typing in the box below.</QuestionnaireDescription>
					)}
				</QuestionnaireItem>
			))}
			{outside ? (
				<p data-slot="questions-outside" className="flex items-center gap-1.5 text-muted-foreground">
					<EyeIcon className="size-4 shrink-0" />
					This conversation has read outside content: these questions may come from it.
				</p>
			) : null}
			{lone ? null : (
				<QuestionnaireActions>
					{several ? (
						<>
							<QuestionnairePrevious size="sm" />
							<QuestionnaireSkip size="sm" />
							<QuestionnaireNext size="sm" />
						</>
					) : null}
					<QuestionnaireSubmit size="sm" disabled={!answered[current]}>Send</QuestionnaireSubmit>
				</QuestionnaireActions>
			)}
		</Questionnaire>
	);
}

/**
 * A turn's questions in the conversation, one line each, "Asked · <question>": while their card is
 * open above the composer (which shows them in full), and once the owner's next message answered
 * them or the agent's next turn left them behind (that message follows in the thread).
 */
export function AskedLines({ questions, ...props }: React.ComponentProps<typeof Trace> & { questions: AskedQuestion[] }) {
	return (
		<Trace {...props}>
			{questions.map((q, i) => (
				<TraceLine key={i}>
					<TraceIcon><MessageCircleQuestionIcon /></TraceIcon>
					<TraceTitle className="select-text" title={q.question}>Asked · {oneLine(q.question)}</TraceTitle>
				</TraceLine>
			))}
		</Trace>
	);
}

/**
 * A turn's questions in full, read only, in the conversation while their card is folded away: each
 * an Item with the question, its few words and who asks, and its options with what each means.
 */
export function AskedInFull({ questions, from, ...props }: React.ComponentProps<typeof ItemGroup> & { questions: AskedQuestion[]; from: string }) {
	return (
		<ItemGroup {...props}>
			{questions.map((q, i) => (
				<Item key={i} variant="outline" size="sm">
					<ItemMedia variant="icon"><MessageCircleQuestionIcon /></ItemMedia>
					<ItemContent>
						<ItemTitle className="whitespace-pre-wrap select-text">{q.question}</ItemTitle>
						<ItemDescription>{aboutOf(q, from)}</ItemDescription>
						{q.options?.length ? (
							<ol className="flex flex-col gap-1 select-text">
								{q.options.map((o, n) => (
									<li key={n}>
										<span className="font-medium">{n + 1}. {o.label}</span>
										{o.description ? <span className="text-muted-foreground"> · {o.description}</span> : null}
									</li>
								))}
							</ol>
						) : null}
					</ItemContent>
				</Item>
			))}
		</ItemGroup>
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
