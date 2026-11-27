// The last of pine's own steps in "Setup Pine": once a model answers and is kept, the card "Next"
// asks what else to set up now, every item optional. Its Send posts an ordinary message of the
// owner's in `setup`, fixed text made from the ticks, through the composer's own way of sending: the
// main agent answers it (with its introduction, the first time it is written to) and goes on with its
// own tools. "Nothing for now" opens `main`. Done once something was said in `setup`, which the
// daemon's list of conversations says: nothing of it is kept on the page.
import { QuestionCard } from "@/components/question-card";
import { Button } from "@/components/ui/button";
import { SETUP, store } from "../model.ts";
import { TRY_EVENTS } from "../WelcomeLetter.tsx";
import type { SetupFacts, SetupStage } from "./types.ts";

const NEXT = "What would you like to set up now?";

/** One thing the owner may tick: its option on the card, and its line in the message they send. */
interface Next {
	/** What it is, in a word that stays when its label is reworded. */
	id: string;
	label: string;
	description: string;
	line: string;
	/** Only where pine runs on a Mac. */
	mac?: boolean;
}

const ALL: Next[] = [
	{ id: "mode", label: "The mode", description: "How much your agents ask before they act, and whether they work in a sandbox.", line: "The mode: how much my agents ask before they act." },
	{ id: "folder", label: "A working folder", description: "One of your folders, such as a project, for a conversation to work in.", line: "A working folder: a folder of mine for a conversation to work in." },
	{ id: "telegram", label: "Telegram", description: "Talk to your agents from your phone, through your own bot.", line: "Telegram: so that I can talk to my agents from my phone." },
	{ id: "agent", label: "A first agent", description: `Your own agent for one job, for example: ${TRY_EVENTS}`, line: `A first agent of my own, for example: ${TRY_EVENTS}` },
	{ id: "theme", label: "The theme", description: "How the app looks: light, dark, or one of pine's other themes.", line: "The theme of the app." },
	{ id: "pinecone", label: "Pinecone", description: "Models and tools that run on this Mac, free and private. Your main agent helps you install it.", line: "Pinecone: help me install it on this Mac, for models and tools that run here.", mac: true },
];

/** What the card offers here. */
const offered = (): Next[] => ALL.filter((n) => !n.mac || store.platform === "darwin");

/** The owner's message for what they ticked: fixed text, one line for each. */
export function nextMessage(ticked: Next[]): string {
	return ["Help me set up the rest of pine, one thing at a time, with a question where I have a choice:", ...ticked.map((n) => `- ${n.line}`)].join("\n");
}

function said(facts: SetupFacts): boolean {
	return !!store.conversations.get(facts.main.id)?.some((c) => c.session === SETUP);
}

export const handoff: SetupStage = {
	id: "handoff",
	done: said,
	Card: ({ ctx, finish }) => {
		const items = offered();
		const main = ctx.facts.main.id;
		return (
			<QuestionCard
				key="next"
				id="next"
				question={NEXT}
				header="Next"
				from="pine asks"
				options={items.map((n) => ({ id: n.id, label: n.label, description: n.description }))}
				multiple
				autoFocus
				actions={
					<Button
						size="sm"
						variant="ghost"
						data-action="nothing"
						onClick={() => {
							finish();
							void store.openTab(main, "main");
						}}
					>
						Nothing for now
					</Button>
				}
				onAnswer={(picked) => {
					const tab = store.tabs.find((t) => t.agent === main && t.session === SETUP);
					if (!tab) return;
					finish();
					void store.submit(tab, nextMessage(picked.map((n) => items[n - 1])));
				}}
			/>
		);
	},
};
