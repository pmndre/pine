import { TriangleAlertIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * What pine says wherever an agent cannot answer for want of a model that answers: on its card at the top of a
 * conversation, after a message of yours that failed for it, and in Settings > Models. One notice, worded one way.
 * With no model at all it says what to do; with a model that cannot answer, why first. Its button leads to the
 * one way to connect a model, the setup conversation ("Setup Pine").
 */
export function ModelNotice({ agent, model, problem, retry, onSetup }: {
	agent: string;
	/** The model it is set to run on, if any. */
	model?: string;
	/** Why that model cannot answer, as the daemon says it (`modelProblem`). */
	problem: string;
	/** A message was not answered for it: say to send it again. */
	retry?: boolean;
	/** The way to the setup conversation; left out where it would lead nowhere new (Settings > Models). */
	onSetup?: () => void;
}) {
	return (
		<Alert className="select-text" data-slot="model-notice">
			{/* The stock alert draws its icon in the text's color: the warning's own color wins here. */}
			<TriangleAlertIcon className="text-warn!" />
			<AlertDescription>
				{model ? (
					<>
						<b>{agent}</b> cannot answer: {problem} Sign in to its provider, add a model server of your own, or choose another model.
					</>
				) : (
					"Connect a model first: sign in to a subscription or add a model server of your own."
				)}
				{retry ? " Then send your message again." : null}
			</AlertDescription>
			{onSetup ? (
				<AlertAction>
					<Button variant="outline" size="xs" onClick={onSetup}>Set up a model…</Button>
				</AlertAction>
			) : null}
		</Alert>
	);
}
