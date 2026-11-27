import type { Meta, StoryObj } from "@storybook/react-vite";
import { Composer } from "./Composer.tsx";
import { store, Tab } from "./model.ts";

// The message box as a conversation shows it, without a daemon: what the agent runs on reads
// "model" and "auto" here, as for an agent the app does not know yet.
function Box({ draft = "", files = false, quotes = false, replying = false, outside = false, paused = false, swarm = false, hidden = false }: { draft?: string; files?: boolean; quotes?: boolean; replying?: boolean; outside?: boolean; paused?: boolean; swarm?: boolean; hidden?: boolean }) {
	const tab = new Tab("chat", "main", "main");
	tab.draft = draft;
	if (paused) tab.goal = { agent: "main", session: "main", objective: "File every invoice of March", status: "paused", round: 3, until: 10, note: "paused by you after round 3" };
	if (swarm) tab.swarm = { agent: "main", session: "main", objective: "Write a test file for each module in src/", status: "limit", round: 8, until: 8, note: "stopped after 8 rounds, which is the limit (limits.swarmRounds), with work left. /swarm resume gives it 8 more" };
	if (files) tab.attachments.push({ name: "invoice-2026-03.pdf", size: 182_400, data: "" }, { name: "notes.md", size: 2_100, data: "" });
	if (quotes)
		tab.quotes.push(
			{ id: 1, tab: tab.key, source: { task: 1, part: "answer" }, text: "The March invoices are all filed except the one from Northwind, which still waits for a purchase order number." },
			{ id: 2, tab: tab.key, source: { task: 2, part: "answer" }, text: "Total: 4 812.50 EUR\n\nDue on 15 April.", reply: "Pay it this week" },
		);
	if (quotes && replying) {
		tab.quotes[0].reply = "Ask Northwind for the number today.\nCopy accounts in.";
		tab.replying = 1;
	}
	if (hidden) {
		// The latest turn asked, and the owner folded the card away.
		tab.roots.add(1);
		tab.add({ t: "questions", task: 1, agent: "main", asked: [{ question: "Which shade?", options: [{ label: "green" }, { label: "blue" }] }] });
		tab.folded = 1;
	}
	if (outside) store.taints.set("main:main", "a web page");
	else store.taints.delete("main:main");
	return (
		<div className="relative w-full max-w-160">
			<Composer tab={tab} />
		</div>
	);
}

const meta = { component: Box, parameters: { layout: "padded" } } satisfies Meta<typeof Box>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { args: {} };

/** A message being written, with files attached, in a conversation that has read outside content. */
export const Written: Story = { args: { draft: "Sum up the invoice and say what is missing from @notes.md", files: true, outside: true } };

/** Parts of the conversation quoted from its selection toolbar, as badges above the input beside a file. */
export const Quoted: Story = { args: { draft: "Why is that one still open?", quotes: true, files: true } };

export const Replying: Story = { args: { draft: "And file the rest.", quotes: true, replying: true } };

/** A goal that waits: its banner (an Alert) above the input, with Resume and Clear. */
export const GoalPaused: Story = { args: { paused: true } };

/** A swarm that stopped with work left: its banner above the input, with Resume and Clear. */
export const SwarmStopped: Story = { args: { swarm: true } };

/** A question the owner folded away: the button on the input's top edge (chevron up) brings its card back. */
export const QuestionHidden: Story = { args: { hidden: true } };
