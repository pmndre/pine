import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { FieldCard, FormCard } from "@/components/field-card";
import { Pulse } from "@/components/pulse";
import { QuestionCard } from "@/components/question-card";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

/** What a provider's sign-in flow asks the owner while it runs: a choice, or a line to type (a code, a key). */
export interface SignInQuestion {
	message: string;
	secret: boolean;
	options?: Array<{ id: string; label: string; description?: string }>;
}

/**
 * A sign-in in the browser, as a card above the composer of the setup conversation, in the question
 * card's family (`FormCard`): the provider's page, which was opened once already, with a button to
 * open it again; the code to enter there, with Copy, when the provider gives one; that pine is
 * waiting; Cancel. A question the flow asks is a question card of its own when it offers a choice,
 * and a field card when something is to be typed: a field for a secret is not shown.
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
	const [copied, setCopied] = useState(false);
	const cancel = <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>;
	if (question?.options?.length) {
		const options = question.options;
		return <QuestionCard question={question.message} header="Sign-in" from={provider} options={options.map((o) => ({ label: o.label, description: o.description }))} autoFocus actions={cancel} onAnswer={([n]) => onAnswer(options[n - 1].id)} />;
	}
	// Something to type: the field is the card, and the page stays one press away.
	if (question)
		return (
			<FieldCard
				data-card="sign-in-card"
				title={`Sign in to ${provider}`}
				error={error}
				label={question.message}
				type={question.secret ? "password" : "text"}
				help={question.secret ? "It is not shown, and goes straight to the sign-in: no agent and no model reads it." : undefined}
				button="Continue"
				start={cancel}
				onSend={onAnswer}
			>
				{url ? (
					<Button size="sm" variant="outline" className="self-start" onClick={onOpen}>
						<ExternalLinkIcon data-icon="inline-start" />
						Open the sign-in page again
					</Button>
				) : null}
			</FieldCard>
		);
	return (
		<FormCard
			data-card="sign-in-card"
			title={`Sign in to ${provider} in your browser`}
			about={code ? "Enter the code below on the page that opened, then come back here." : url ? "The sign-in page opened in your browser. Sign in there, then come back here." : "Starting the sign-in…"}
			error={error}
			start={cancel}
			end={
				url ? (
					<Button size="sm" variant="outline" onClick={onOpen}>
						<ExternalLinkIcon data-icon="inline-start" />
						Open the sign-in page again
					</Button>
				) : null
			}
		>
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
			<span className="flex items-center gap-2 text-muted-foreground">
				<Pulse label="Loading" />
				{url ? "Waiting for you to sign in in the browser…" : "Starting…"}
			</span>
		</FormCard>
	);
}
