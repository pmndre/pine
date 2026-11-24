import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, waitFor, within } from "storybook/test";
import { useEffect } from "react";
import { SidebarFooter, SidebarMenu, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import type { AgentInfo, Conversation } from "./api.ts";
import { AgentGroup, ConversationRow, Machines, Sidebar, TitleBar } from "./App.tsx";
import { store } from "./model.ts";

// The foot of the side bar, open on its list of machines, without a daemon: the store is set as
// the bridge's state would set it. `local` stands for what the bridge's `state()` says: false
// under a bridge with no "this computer" (the phone), where the list holds only the machines added.

function Foot({ local }: { local: boolean }) {
	store.local = local;
	store.prefs = { ...store.prefs, hosts: ["me@build-box", "studio"], use: "me@build-box" };
	store.service = { status: "ready", mode: "on build-box", started: false, home: "build-box:~/.pine", version: "0.23.0", from: "ssh me@build-box", host: "me@build-box", label: "build-box" };
	store.connected = true;
	return (
		<SidebarProvider className="min-h-0 w-64">
			<SidebarFooter className="w-full">
				<SidebarMenu>
					<Machines />
				</SidebarMenu>
			</SidebarFooter>
		</SidebarProvider>
	);
}

const meta = {
	component: Foot,
	parameters: { layout: "padded" },
	// What a story sets on the store is put back after it: the next story starts from the store as it was.
	beforeEach: () => {
		const { local, service, prefs, connected, agents, conversations, groups, busy, folded, titled } = store;
		return () => void Object.assign(store, { local, service, prefs, connected, agents, conversations, groups, busy, folded, titled });
	},
	// Opened, so that the snapshot shows the list of machines.
	play: async ({ canvas, userEvent }) => await userEvent.click(canvas.getByRole("button", { name: /The pine the app uses/ })),
} satisfies Meta<typeof Foot>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The desktop app: this computer first, then the machines added in Settings > Environments, the one in use checked. */
export const MachinesWithThisComputer: Story = {
	args: { local: true },
	play: async (context) => {
		await meta.play(context);
		const items = await within(document.body).findAllByRole("menuitemradio");
		await expect(items.filter((item) => !item.hasAttribute("data-host"))).toHaveLength(1);
		// This computer is there to go back to: nothing to disconnect.
		await expect(within(document.body).queryByRole("menuitem", { name: "Disconnect" })).toBeNull();
	},
};

const disconnected = fn(async () => ({ ...store.prefs, use: undefined }));

/** A bridge with no local machine: only the machines added, no "This Mac" or "This computer" to pick, and Disconnect, back to the list (the web client's). */
export const MachinesWithoutLocal: Story = {
	args: { local: false },
	beforeEach: () => {
		disconnected.mockClear();
		window.pine.disconnect = disconnected;
		return () => void delete (window.pine as Partial<typeof window.pine>).disconnect;
	},
	play: async (context) => {
		await meta.play(context);
		// The menu is drawn outside the story's root.
		const items = await within(document.body).findAllByRole("menuitemradio");
		await expect(items.map((item) => item.getAttribute("data-host"))).toEqual(["me@build-box", "studio"]);
		await expect(within(document.body).queryAllByText(/This (Mac|computer)/)).toHaveLength(0);
		await context.userEvent.click(await within(document.body).findByRole("menuitem", { name: "Disconnect" }));
		await expect(disconnected).toHaveBeenCalledTimes(1);
		// Opened again for the snapshot.
		await meta.play(context);
	},
};

/**
 * The page as it is drawn on a system: what the bridge's `state()` says (`store.platform`, and
 * `data-platform` on the root element, which the shortcuts are written by). Put back after the story.
 */
const onSystem = (platform: string) => () => {
	const was = { store: store.platform, root: document.documentElement.dataset.platform };
	store.platform = platform;
	document.documentElement.dataset.platform = platform;
	return () => {
		store.platform = was.store;
		if (was.root === undefined) delete document.documentElement.dataset.platform;
		else document.documentElement.dataset.platform = was.root;
	};
};

/** The bar along the top, without tabs: its buttons, and the tooltip of the one that starts a conversation, with its key. */
const bar = (key: string): Story => ({
	args: { local: true },
	parameters: { layout: "fullscreen" },
	render: () => (
		<SidebarProvider className="min-h-0 w-full" open={false}>
			<div className="flex w-full flex-col bg-sunk">
				<TitleBar />
			</div>
		</SidebarProvider>
	),
	// Reached with the keyboard, as a tooltip shows for a button the keyboard brought it to.
	play: async ({ canvas, userEvent }) => {
		// (In a phone-wide window the button that shows the side bar comes first.)
		const button = canvas.getByRole("button", { name: /^New conversation/ });
		for (let i = 0; i < 4 && document.activeElement !== button; i++) await userEvent.tab();
		await expect(document.activeElement).toBe(button);
		// A tooltip opens after a moment, the first one of a page later than the next, and fades in.
		const shown = await within(document.body).findByText(key, undefined, { timeout: 4000 });
		await waitFor(() => expect(shown).toBeVisible());
		// Off a Mac the window has no menu bar: the bar has a button that opens its menus.
		if (key.startsWith("⌘")) await expect(canvas.queryByRole("button", { name: "Menu" })).toBeNull();
		else await expect(canvas.getByRole("button", { name: "Menu" })).toBeVisible();
	},
});

/** On a Mac: the keys as the Mac writes them. */
export const TitleBarOnMac: Story = { ...bar("⌘T"), beforeEach: onSystem("darwin") };

/**
 * Off a Mac (Windows here; Linux is drawn the same): the keys are Ctrl chords, the menu button (☰) opens the app's
 * menus, which the window shows in no menu bar there, and the bar keeps room at its right for
 * the system's window controls, which the window draws over it there (`pr-window-controls`; in an ordinary browser,
 * which has no such controls, the room is the bar's own).
 */
export const TitleBarOffMac: Story = { ...bar("Ctrl+T"), beforeEach: onSystem("win32") };

// The side bar itself, with agents as the daemon would list them. An agent with one conversation is one
// line that opens it; one with more is a group that says how many it holds.

const agent = (id: string, description: string, main = false): AgentInfo => ({ id, main, description, workspace: `/home/agents/${id}`, model: "claude-sonnet", mode: "safe", thinking: "medium", delegates: [] });
const AGENTS = [agent("main", "Administers pine and is the one to ask", true), agent("scout", "Looks things up on the web"), agent("books", "Keeps the books")];
const HOUR = 3_600_000;
const said = (session: string, hoursAgo: number, more: Partial<Conversation> = {}): Conversation => ({ session, tasks: 4, last: Date.now() - hoursAgo * HOUR, pinned: false, open: false, ...more });

/** In a phone-wide window the side bar is a sheet, closed until it is asked for: opened here, so that the snapshot shows it. */
function Opened() {
	const { isMobile, setOpenMobile } = useSidebar();
	useEffect(() => void (isMobile && setOpenMobile(true)), [isMobile, setOpenMobile]);
	return null;
}

function Side({ conversations, working = [] }: { conversations: Record<string, Conversation[]>; working?: string[] }) {
	store.local = true;
	store.service = { status: "ready", mode: "started here", started: true, home: "~/.pine", version: "0.23.0" } as typeof store.service;
	store.connected = true;
	store.agents = AGENTS;
	// Every agent's conversations are loaded, and what was said: no skeleton here.
	store.conversations = new Map(AGENTS.map((a) => [a.id, conversations[a.id] ?? []]));
	store.titled = true;
	store.groups = new Map([["books", { order: "recent", groups: conversations.books?.some((c) => c.group) ? [{ name: "Taxes", conversations: 2 }] : [] }]]);
	store.busy = new Map(working.map((key) => [key, new Set([1])]));
	store.folded = new Set();
	return (
		<SidebarProvider className="h-140 min-h-0 w-72 rounded-lg border bg-sidebar">
			<Opened />
			<Sidebar />
		</SidebarProvider>
	);
}

const side = { args: { local: true }, parameters: { layout: "centered" } } as const;

/** Every agent has one conversation: each is one line, with nothing to fold. The first was used two hours ago, the second is at work, the third was never said anything to. */
export const OneConversationEach: Story = {
	...side,
	render: () => <Side conversations={{ main: [said("main", 2)], scout: [said("main", 0)] }} working={["scout:main"]} />,
	play: async () => {
		const page = within(document.body);
		await page.findByText("Keeps the books");
		await expect(document.querySelectorAll("[data-slot=agent-conversation]")).toHaveLength(3);
		await expect(document.querySelector("[data-slot=collapsible]:has([data-slot=agent-label])")).toBeNull();
		await expect(page.queryByText(/conversations?$/)).toBeNull();
	},
};

/** An agent with more than one conversation is a group that says how many it holds; so is one with a group of conversations. The agent with one stays one line. */
export const SomeWithSeveral: Story = {
	...side,
	render: () => (
		<Side
			conversations={{
				main: [said("main", 2), said("release notes", 5), said("the okapi invoice", 30, { pinned: true })],
				scout: [said("main", 1)],
				books: [said("main", 50), said("vat 2026", 3, { group: "Taxes" }), said("receipts", 26, { group: "Taxes" })],
			}}
			working={["books:vat 2026"]}
		/>
	),
	play: async () => {
		const page = within(document.body);
		await expect((await page.findAllByText("3 conversations")).length).toBe(2);
		await expect(document.querySelectorAll("[data-slot=collapsible]:has(> ul [data-slot=agent-label])")).toHaveLength(2);
		await expect(document.querySelectorAll("[data-slot=agent-conversation]")).toHaveLength(1);
	},
};

/** A conversation's row in the side bar while the conversations load. */
export const ConversationRowSkeleton: Story = {
	args: { local: true },
	play: async () => {},
	render: () => (
		<SidebarProvider className="min-h-0 w-64">
			<SidebarMenu>
				<ConversationRow skeleton />
			</SidebarMenu>
		</SidebarProvider>
	),
};

/** An agent's line and its conversations in the side bar while they load. */
export const AgentGroupSkeleton: Story = {
	args: { local: true },
	play: async () => {},
	render: () => (
		<SidebarProvider className="min-h-0 w-64">
			<AgentGroup skeleton />
		</SidebarProvider>
	),
};
