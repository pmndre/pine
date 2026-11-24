import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Approval } from "./api.ts";
import { ConversationSkeleton as ConversationSkeletonView, OwnerTurn, Row, Welcome } from "./Conversation.tsx";
import { type Item, Tab } from "./model.ts";

// A conversation as the app draws it: each item is a Row, the way the transcript lists them.
// The items are made by hand, as the model would make them from what the daemon says.
type Made = Item extends infer I ? (I extends Item ? Omit<I, "id" | "v"> : never) : never;

function Items({ items, running }: { items: Made[]; /** Tasks at work in the conversation. */ running?: number[] }) {
	const tab = new Tab("chat", "main", "main");
	for (const id of running ?? []) tab.running.add(id);
	for (const item of items) tab.add(item as never);
	return (
		<div className="flex w-full max-w-160 flex-col gap-3.5">
			{tab.items.map((item) => <Row key={item.id} item={item} v={item.v} tab={tab} />)}
		</div>
	);
}

const now = Date.now();
const conversation: Made[] = [
	{ t: "user", text: "What do the notes say?", files: ["notes.md"], task: 1 },
	{
		t: "work",
		done: true,
		open: true,
		startedAt: now,
		ms: 4200,
		parts: [
			{ p: "thought", text: "The owner wants the notes. I read the file first.", done: true, ms: 1200, startedAt: now },
			{ p: "tool", key: "1", tool: "read", subject: "notes.md", status: "ok", ms: 40, depth: 0 },
			{ p: "words", text: "Let me look at the notes first." },
			{ p: "tool", key: "2", tool: "bash", subject: "grep -n TODO notes.md", status: "fail", ms: 90, depth: 0, preview: "grep: notes.md: No such file or directory" },
			{ p: "child", task: 12, agent: "scout", kind: "subagent", label: "look it up", status: "done", depth: 1 },
		],
	},
	{ t: "steps", task: 1, items: [{ text: "Read the notes", status: "done" }, { text: "Sum them up", status: "in_progress" }, { text: "Say what is missing", status: "pending" }] },
	{ t: "answer", task: 1, agent: "main", live: false, text: "The notes say **first line**.\n\n```ts\nconst a = 1;\n```\n\n[the docs](https://example.com/docs)" },
];

const approval: Approval = { id: "a1", agent: "main", task: 1, tool: "bash", summary: "echo hello", why: "You listed bash under approve: it asks in every mode.", expires: 0, remember: "bash" };
const question: Approval = { id: "q1", agent: "main", task: 1, tool: "question", summary: "Which database?", why: "", expires: 0, choices: ["the old one", "the new one"] };
const asks: Made[] = [
	{ t: "approval", req: approval, state: "open" },
	{ t: "approval", req: question, state: "open" },
	{ t: "approval", req: { ...approval, id: "a2" }, state: "allowed", by: "you" },
	{ t: "approval", req: { ...question, id: "q2" }, state: "allowed", by: "you" },
	{ t: "approval", req: { ...approval, id: "a3", summary: "rm -rf build" }, state: "denied", by: "you" },
	{ t: "approval", req: { ...approval, id: "a4" }, state: "gone" },
];

const meta = { component: Items, parameters: { layout: "padded" } } satisfies Meta<typeof Items>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Conversation: Story = { args: { items: conversation } };

/** What the agent asks: an approval and a question, open, then as they were answered. */
export const Ask: Story = { args: { items: asks } };

/** A turn at work: its last lines under the head, the call that runs and the thought that goes on. */
const working: Made[] = [
	{ t: "user", text: "Clean up the build folder." },
	{
		t: "work",
		done: false,
		open: false,
		startedAt: now,
		parts: [
			{ p: "tool", key: "1", tool: "ls", subject: "build", status: "ok", ms: 12, depth: 0 },
			{ p: "thought", text: "The folder holds old bundles. I remove them and keep the config.", done: false, startedAt: now },
			{ p: "tool", key: "2", tool: "bash", subject: "rm -rf build/assets", status: "run", depth: 0 },
			{ p: "child", task: 14, agent: "scout", kind: "delegate", label: "check the links", status: "run", depth: 1 },
		],
	},
	// Messages given to the work while it runs: one it read, one it has not read yet.
	{ t: "user", text: "keep the config folder", steer: { task: 8, into: 7, read: now } },
	{ t: "user", text: "how far along are you?", steer: { task: 9, into: 7 } },
];
export const Working: Story = { args: { items: working, running: [7] } };

/** A long thought that goes on: its box at its full height, at the end of the text, faded above. */
const reasons = [
	"The owner asks for every feature that makes pine look like a coding agent.",
	"I start with modes: safe and manual work in the sandbox, auto and bypass without one, plan only reads.",
	"Approvals come next: once, always for this conversation, or no, from the app, Telegram or the command line.",
	"Worktrees: a conversation can move into one, and its work is merged from the panel.",
	"The code pane shows the changes of the folder, its files and what each tool returned.",
	"Undo takes back the owner's last message and puts the folder back as it was.",
	"Sub-agents run beside the conversation, each in a tab of its own.",
];
const thinking: Made[] = [
	{ t: "user", text: "List every feature that makes pine similar to a coding agent." },
	{
		t: "work",
		done: false,
		open: false,
		startedAt: now,
		parts: [
			{ p: "tool", key: "1", tool: "manual", subject: "modes", status: "ok", ms: 336, depth: 0 },
			{ p: "thought", text: [...reasons, ...reasons, ...reasons].map((r) => `- ${r}`).join("\n"), done: false, startedAt: now },
		],
	},
];
export const Thinking: Story = { args: { items: thinking } };

/** What pine says between turns: notes in each tone, an event, the goal, a swarm, a divider. */
const notes: Made[] = [
	{ t: "divider", text: "yesterday" },
	{ t: "note", tone: "muted", text: "The model changed to mock/m." },
	{ t: "note", tone: "warn", text: "The answer was cut: the model ran out of room." },
	{ t: "note", tone: "bad", text: "The model server did not answer.", action: { label: "Settings", run: () => {} } },
	{ t: "note", tone: "accent", text: "↶ Taken back: your last message", lines: [{ text: "2 files restored" }, { text: "notes.md was changed since", tone: "warn" }] },
	{ t: "event", label: "folder · changed", body: "~/notes/today.md was written" },
	{ t: "goal", goal: { agent: "main", session: "main", objective: "Every link in the notes works", status: "met", note: "met after 2 rounds", round: 2, until: 5, reason: "All twelve links answer." } },
	{ t: "swarm", swarm: { agent: "main", session: "main", objective: "Write a test file for each module in src/", status: "active", note: "3 tasks are not done: round 2 of 8 starts", round: 2, until: 8 }, full: true },
	{ t: "swarm", swarm: { agent: "main", session: "main", objective: "Write a test file for each module in src/", status: "done", note: "done after 2 rounds: 16 tasks, and the answer was checked", round: 2, until: 8 } },
];
export const Notes: Story = { args: { items: notes } };

// A picture of 480 by 320, drawn here: the page loads nothing from the web.
const PICTURE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#5de4c7"/><circle cx="240" cy="160" r="90" fill="#1b1e28"/></svg>')}`;

/** A picture in the conversation: a click opens it larger over the page. */
const picture: Made[] = [{ t: "media", kind: "image", name: "okapi.svg", url: PICTURE }];
export const Picture: Story = { args: { items: picture } };

/** The same picture, clicked: larger over the page. No docs page: it would open over the other stories. */
export const PictureLarger: Story = {
	args: { items: picture },
	tags: ["!autodocs"],
	play: async ({ canvas, userEvent }) => await userEvent.click(canvas.getByRole("button", { name: "okapi.svg" })),
};

const quoted: Made[] = [
	{ t: "answer", task: 1, agent: "main", live: false, text: "The build passed on the second run. The first failed because the cache held an old copy of the lockfile.\n\nClearing the cache before the install keeps it from happening again." },
	{
		t: "user",
		text: "Can you do that in the workflow?",
		task: 2,
		quotes: [
			{ text: "The first failed because the cache held an old copy of the lockfile.", source: { task: 1, part: "answer" } },
			{ text: "Clearing the cache", source: { task: 1, part: "answer" } },
		],
	},
	{ t: "user", text: "", task: 3, quotes: [{ text: "The build passed on the second run.", source: { task: 1, part: "answer" } }] },
	{ t: "user", text: "> Typed as a quote by hand, without the Quote button: it stays text.", task: 4 },
];

/** Quotes sent with a message stay badges at the top of its bubble: a click goes back to where they were taken from. */
export const Quoted: Story = { args: { items: quoted } };

/** A conversation that has not loaded yet: its shape, from stock Skeleton blocks. */
export const ConversationSkeleton: Story = { args: { items: [] }, render: () => <ConversationSkeletonView /> };

/** The owner's turn while it loads. */
export const OwnerTurnSkeleton: Story = { args: { items: [] }, render: () => <OwnerTurn skeleton /> };

/** Where a conversation begins, while the agent is not known yet. */
export const WelcomeSkeleton: Story = { args: { items: [] }, render: () => <Welcome skeleton /> };
