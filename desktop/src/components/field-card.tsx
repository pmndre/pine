import { TriangleAlertIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Pulse } from "@/components/pulse";
import { CardActions } from "@/components/question-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Questionnaire, QuestionnaireDescription, QuestionnaireInput, QuestionnaireItem, QuestionnaireSubmit, QuestionnaireTitle } from "@/components/ui/questionnaire";

/**
 * A card above the composer that is not a choice (a sign-in that waits in the browser, a server
 * being looked for), drawn as the question card is: shadcn's `Questionnaire` with one item, its
 * title, its description, what it shows under them, and its actions row at the bottom (`start`: the
 * ways out, `end`: the rest). Its props go to the questionnaire, a data attribute that names the card
 * among them.
 */
export function FormCard({ title, about, error, children, start, end, ...props }: Omit<React.ComponentProps<typeof Questionnaire>, "title" | "children"> & {
	title: React.ReactNode;
	about?: React.ReactNode;
	/** What went wrong, from the daemon or the provider: shown above what the card holds. */
	error?: string;
	children?: React.ReactNode;
	start?: React.ReactNode;
	end?: React.ReactNode;
}) {
	const id = useId();
	return (
		<Questionnaire defaultItem="value" {...props}>
			<QuestionnaireItem name="value" aria-labelledby={id}>
				<QuestionnaireTitle id={id} className="select-text">{title}</QuestionnaireTitle>
				{about ? <QuestionnaireDescription className="select-text">{about}</QuestionnaireDescription> : null}
				{error ? (
					<Alert variant="destructive">
						<TriangleAlertIcon />
						<AlertDescription className="select-text">{error}</AlertDescription>
					</Alert>
				) : null}
				{children}
			</QuestionnaireItem>
			{start || end ? <CardActions start={start}>{end}</CardActions> : null}
		</Questionnaire>
	);
}


/**
 * A card above the composer that asks for one value (an address, a key, a number): a `FormCard`
 * whose item holds a stock `Field` (its label, stock `QuestionnaireInput`, a line under it that
 * says what to give, `help`, and what went wrong, `error`), and the questionnaire's Submit
 * (`button`) at the end of its actions row. Enter in the field sends it too. A password field is
 * emptied once sent, so that a key is never kept on screen. What else the card shows goes under the
 * field (`children`).
 */
export function FieldCard({ label, type = "text", help, error, button, busy, waiting, input, onSend, children, ...props }: Omit<React.ComponentProps<typeof FormCard>, "end" | "onSubmit"> & {
	label: string;
	type?: "text" | "url" | "password" | "number";
	help?: React.ReactNode;
	button: string;
	/** Something is under way: what is said beside the button while it is, and the button waits. */
	busy?: string;
	/** The card cannot take a value yet (a sign-in that has not asked for it): the button waits, with no words. */
	waiting?: boolean;
	/** More attributes for the field, such as one that names it. */
	input?: Record<`data-${string}`, string>;
	onSend: (value: string) => void;
}) {
	const [typed, setTyped] = useState("");
	const field = useRef<HTMLInputElement>(null);
	const id = useId();
	const ready = !busy && !waiting;
	useEffect(() => {
		// Without scrolling: in a short pane the card's slot would otherwise start scrolled, its title cut and faded.
		field.current?.focus({ preventScroll: true });
	}, []);
	return (
		<FormCard
			{...props}
			onSubmit={(e) => {
				e.preventDefault();
				const text = typed.trim();
				if (!text || !ready) return;
				if (type === "password") setTyped("");
				onSend(text);
			}}
			end={
				<>
					{busy || waiting ? (
						<span className="flex items-center gap-2 text-muted-foreground">
							<Pulse label="Loading" />
							{busy}
						</span>
					) : null}
					<QuestionnaireSubmit size="sm" disabled={!typed.trim() || !ready}>{button}</QuestionnaireSubmit>
				</>
			}
		>
			<Field data-invalid={error ? true : undefined}>
				<FieldLabel htmlFor={id}>{label}</FieldLabel>
				<QuestionnaireInput
					ref={field}
					id={id}
					type={type}
					autoComplete="off"
					spellCheck={false}
					aria-invalid={error ? true : undefined}
					value={typed}
					onChange={(e) => setTyped(e.target.value)}
					{...input}
				/>
				{help ? <FieldDescription>{help}</FieldDescription> : null}
				{error ? <FieldError className="select-text">{error}</FieldError> : null}
			</Field>
			{children}
		</FormCard>
	);
}
