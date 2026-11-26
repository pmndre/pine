import { Listbox, ListboxItem, ListboxItemIndicator } from "@ui-sdk/react/listbox";
import { CheckIcon, MessageCircleQuestionIcon, XIcon } from "lucide-react";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Kbd } from "@/components/ui/kbd";

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

/** One answer a question offers: a label, and a line that says what it means. */
export interface QuestionCardOption {
	label: string;
	description?: string;
}

/**
 * A question put to the owner, inline above the composer of its conversation (shadcn's Confirmation
 * pattern on an `Item`): a few words over it as a `Badge`, the question, and its options in ui-sdk's
 * `Listbox`, each a row with its number, its label, its line and, on the first, "recommended". One
 * answer is given by a click, its digit, or the arrows and Enter; several by ticking (a click, a digit,
 * Space or Enter) and Send. There is no field for the owner's own words: the composer below is that.
 * The same card for an agent's `question` and for what pine asks itself.
 */
export function QuestionCard({ question, header, from, options, multiple, autoFocus, actions, onAnswer, onNoAnswer, onLater }: {
	question: string;
	/** A few words over the question, such as "Database". */
	header?: string;
	/** Who asks, such as "main asks". */
	from?: string;
	options: QuestionCardOption[];
	/** Several may be picked, and are sent together. */
	multiple?: boolean;
	/** Takes the keyboard as it is shown, on its first option. */
	autoFocus?: boolean;
	/** Ways out other than an answer, before Later and No answer: "Back" in pine's own steps, "Cancel" in a sign-in. */
	actions?: React.ReactNode;
	/** The answer: the numbers of the options picked, counted from 1, in the order shown. */
	onAnswer: (picked: number[]) => void;
	onNoAnswer?: () => void;
	onLater?: () => void;
}) {
	const [ticked, setTicked] = useState<string[]>([]);
	const list = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (autoFocus) list.current?.querySelector<HTMLElement>("[role=option]")?.focus();
	}, [autoFocus]);
	const send = (values: string[]) => onAnswer(values.map(Number).sort((a, b) => a - b));
	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.metaKey || e.ctrlKey || e.altKey || !/^[1-9]$/.test(e.key) || Number(e.key) > options.length) return;
		e.preventDefault();
		if (!multiple) return onAnswer([Number(e.key)]);
		setTicked((was) => (was.includes(e.key) ? was.filter((v) => v !== e.key) : [...was, e.key]));
	};
	const rows = options.map((o, i) => (
		<ListboxItem
			key={i}
			value={String(i + 1)}
			label={o.label}
			render={(props, state) => <Item {...props} size="xs" variant={state.highlighted ? "muted" : "default"} />}
		>
			<ItemMedia>
				<Kbd>{i + 1}</Kbd>
			</ItemMedia>
			<ItemContent>
				{/* An answer is read whole, however long: it is not cut to one line. */}
				<ItemTitle className="line-clamp-none text-left">{o.label}</ItemTitle>
				{o.description ? <ItemDescription className="line-clamp-none text-left">{o.description}</ItemDescription> : null}
			</ItemContent>
			{i === 0 || multiple ? (
				<ItemActions>
					{i === 0 ? <Badge variant="secondary">recommended</Badge> : null}
					{multiple ? <ListboxItemIndicator><CheckIcon /></ListboxItemIndicator> : null}
				</ItemActions>
			) : null}
		</ListboxItem>
	));
	return (
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
				<ItemTitle className="line-clamp-none whitespace-pre-wrap select-text" data-slot="question-card-question">{question}</ItemTitle>
			</ItemContent>
			<ItemActions>
				{actions}
				{onLater ? <Button size="sm" variant="ghost" onClick={onLater}>Later</Button> : null}
				{onNoAnswer ? <Button size="sm" variant="ghost" onClick={onNoAnswer}>No answer</Button> : null}
			</ItemActions>
			<ItemFooter className="flex-col items-stretch">
				{multiple ? (
					<Listbox ref={list} aria-label={question} multiple activation="manual" className="outline-none" value={ticked} onValueChange={(v) => setTicked((v as string[] | null) ?? [])} onKeyDown={onKeyDown} render={<ItemGroup />}>
						{rows}
					</Listbox>
				) : (
					<Listbox ref={list} aria-label={question} activation="manual" className="outline-none" value={null} onValueChange={(v) => typeof v === "string" && onAnswer([Number(v)])} onKeyDown={onKeyDown} render={<ItemGroup />}>
						{rows}
					</Listbox>
				)}
				{multiple ? (
					<div className="flex justify-end">
						<Button size="sm" disabled={!ticked.length} onClick={() => send(ticked)}>Send</Button>
					</div>
				) : null}
			</ItemFooter>
		</Item>
	);
}
