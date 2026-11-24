import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Pulse } from "@/components/pulse";
import { Textarea } from "@/components/ui/textarea";
import { store } from "./model.ts";
import { shortcut } from "./text.ts";

/** What is wrong with a topic, if anything. The old one-line form split at the first space, so a topic never had one. */
function topicError(topic: string): string | undefined {
	if (!topic.trim()) return "Name the topic.";
	if (/\s/.test(topic.trim())) return "A topic has no spaces: use / between the parts, such as house/mode.";
}

/** What is wrong with a payload, if anything: nothing at all is no payload, anything else has to be JSON. */
function payloadError(text: string): string | undefined {
	if (!text.trim()) return;
	try {
		JSON.parse(text);
	} catch (e) {
		return `This is not JSON: ${(e as Error).message}`;
	}
}

/**
 * Publishing an event as the owner: a topic, and a payload in JSON if it carries one. The control
 * API gets `{ topic, payload }`, the payload null when there is none, as from `/emit`.
 */
export function PublishDialog({ topic: firstTopic = "", payload: firstPayload = "", checked = false }: { topic?: string; payload?: string; checked?: boolean }) {
	const [topic, setTopic] = useState(firstTopic);
	const [payload, setPayload] = useState(firstPayload);
	// A field says what is wrong once it was left or the form was sent, not while the first letters are typed.
	const [left, setLeft] = useState({ topic: checked, payload: checked });
	const [sending, setSending] = useState(false);
	const wrong = { topic: topicError(topic), payload: payloadError(payload) };
	const close = () => store.setPublishing(false);
	const send = async () => {
		setLeft({ topic: true, payload: true });
		if (wrong.topic || wrong.payload || sending) return;
		setSending(true);
		const done = await store.publish(topic.trim(), payload.trim() ? JSON.parse(payload) : null);
		setSending(false);
		if (done) close();
	};
	const showTopic = left.topic && wrong.topic;
	const showPayload = left.payload && wrong.payload;
	return (
		<Dialog open onOpenChange={(open) => open || close()}>
			<DialogContent className="sm:max-w-lg">
				{/* Not a form: the web client's page runs in a frame that may not submit one (no `allow-forms`,
				    AGENTS.md rule 10). Publish sends by its click, Enter in the topic and ⌘↩ in the payload by their keys. */}
				<div data-slot="publish-form" className="contents">
					<DialogHeader>
						<DialogTitle>Publish an event</DialogTitle>
						<DialogDescription>It is published as yours, as the owner: routes and agents subscribed to that topic get it.</DialogDescription>
					</DialogHeader>
					<FieldGroup>
						<Field data-invalid={showTopic ? true : undefined}>
							<FieldLabel htmlFor="publish-topic">Topic</FieldLabel>
							<Input id="publish-topic" autoFocus className="font-mono" placeholder="house/mode" spellCheck={false} autoComplete="off" value={topic} aria-invalid={showTopic ? true : undefined} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && (e.preventDefault(), void send())} onBlur={() => topic && setLeft((l) => ({ ...l, topic: true }))} />
							{showTopic ? <FieldError>{wrong.topic}</FieldError> : null}
						</Field>
						<Field data-invalid={showPayload ? true : undefined}>
							<FieldLabel htmlFor="publish-payload">Payload <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel>
							<Textarea
								id="publish-payload"
								className="max-h-60 min-h-24 font-mono"
								placeholder={'{"value": "away"}'}
								spellCheck={false}
								value={payload}
								aria-invalid={showPayload ? true : undefined}
								onChange={(e) => setPayload(e.target.value)}
								onBlur={() => setLeft((l) => ({ ...l, payload: true }))}
								onKeyDown={(e) => {
									if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.preventDefault(), void send());
								}}
							/>
							{showPayload ? <FieldError>{wrong.payload}</FieldError> : <FieldDescription>JSON: an object, a list, a string in quotes, a number, true or false. Empty publishes the event without one.</FieldDescription>}
						</Field>
					</FieldGroup>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={close}>Cancel</Button>
						<Button disabled={sending} onClick={() => void send()}>{sending ? <Pulse label="Loading" data-icon="inline-start" /> : null}Publish <Kbd className="bg-black/15 text-current">{shortcut("⌘↩")}</Kbd></Button>
					</DialogFooter>
				</div>
			</DialogContent>
		</Dialog>
	);
}
