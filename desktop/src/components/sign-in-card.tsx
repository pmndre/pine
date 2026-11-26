import { CheckIcon, CopyIcon, ExternalLinkIcon, LogInIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";
import { Pulse } from "@/components/pulse";
import { QuestionCard } from "@/components/question-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from "@/components/ui/item";

/** What a provider's sign-in flow asks the owner while it runs: a choice, or a line to type (a code, a key). */
export interface SignInQuestion {
	message: string;
	secret: boolean;
	options?: Array<{ id: string; label: string; description?: string }>;
}

/**
 * A sign-in in the browser, as a card above the composer of the setup conversation (the question
 * card's family: an `Item` on shadcn's Confirmation pattern). The provider's page, which was opened
 * once already, with a button to open it again; the code to enter there, with Copy, when the
 * provider gives one; that pine is waiting; Cancel. A question the flow asks is a question card of
 * its own when it offers a choice, and a field of this card when something is to be typed: a field
 * for a secret is not shown.
 */
export function SignInCard({ provider, url, code, question, error, onOpen, onCopy, onAnswer, onCancel }: {
	/** The provider by the name people know, such as "Claude". */
	provider: string;
	/** The sign-in page, once the flow named it. */
	url?: string;
	/** A code to enter on that page. */
	code?: string;
	question?: SignInQuestion;
	error?: string;
	onOpen: () => void;
	onCopy: (code: string) => void;
	/** An answer to `question`: an option's id, or what was typed. */
	onAnswer: (answer: string) => void;
	onCancel: () => void;
}) {
	const [typed, setTyped] = useState("");
	const [copied, setCopied] = useState(false);
	const field = useId();
	const cancel = <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>;
	if (question?.options?.length) {
		const options = question.options;
		return <QuestionCard question={question.message} header="Sign-in" from={provider} options={options.map((o) => ({ label: o.label, description: o.description }))} autoFocus actions={cancel} onAnswer={([n]) => onAnswer(options[n - 1].id)} />;
	}
	const send = () => {
		const text = typed.trim();
		if (!text) return;
		setTyped("");
		onAnswer(text);
	};
	return (
		<Item variant="outline" size="sm" data-slot="sign-in-card">
			<ItemMedia variant="icon">
				<LogInIcon />
			</ItemMedia>
			<ItemContent>
				<ItemTitle>Sign in to {provider} in your browser</ItemTitle>
				<ItemDescription className="line-clamp-none select-text">
					{code ? "Enter the code below on the page that opened, then come back here." : url ? "The sign-in page opened in your browser. Sign in there, then come back here." : "Starting the sign-in…"}
				</ItemDescription>
			</ItemContent>
			<ItemActions>{cancel}</ItemActions>
			<ItemFooter className="flex-col items-stretch">
				{error ? (
					<Alert variant="destructive">
						<TriangleAlertIcon />
						<AlertDescription className="select-text">{error}</AlertDescription>
					</Alert>
				) : null}
				{code ? (
					<InputGroup>
						<InputGroupInput data-sign-in="code" readOnly aria-label="The code to enter" value={code} />
						<InputGroupAddon align="inline-end">
							<InputGroupButton onClick={() => (onCopy(code), setCopied(true))}>
								{copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
								Copy
							</InputGroupButton>
						</InputGroupAddon>
					</InputGroup>
				) : null}
				{question ? (
					<Field>
						<FieldLabel htmlFor={`${field}-answer`}>{question.message}</FieldLabel>
						<InputGroup>
							<InputGroupInput id={`${field}-answer`} autoFocus type={question.secret ? "password" : "text"} autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
							<InputGroupAddon align="inline-end">
								<InputGroupButton variant="default" disabled={!typed.trim()} onClick={send}>Continue</InputGroupButton>
							</InputGroupAddon>
						</InputGroup>
						{question.secret ? <FieldDescription>It is not shown, and goes straight to the sign-in: no agent and no model reads it.</FieldDescription> : null}
					</Field>
				) : null}
				<div className="flex flex-wrap items-center gap-2">
					{url ? (
						<Button size="sm" variant="outline" onClick={onOpen}>
							<ExternalLinkIcon data-icon="inline-start" />
							Open the sign-in page again
						</Button>
					) : null}
					{!question ? (
						<span className="flex items-center gap-2 text-muted-foreground">
							<Pulse label="Loading" />
							{url ? "Waiting for you to sign in in the browser…" : "Starting…"}
						</span>
					) : null}
				</div>
			</ItemFooter>
		</Item>
	);
}
