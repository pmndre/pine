import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AgentInfo, McpServer, Overview, Setting } from "./api.ts";
import { store } from "./model.ts";
import { Colours as ColoursSection, Settings } from "./Settings.tsx";
import { DEFAULT_PALETTE } from "./theme.ts";

// The settings tab as the app shows it, without a daemon: the bridge's `call` is a stand-in that
// answers each address with what is written below, as the control API would. An address it does
// not know answers 404, which a page shows as its error.

const overview: Overview = {
	version: "0.38.0",
	home: "/Users/owner/.pine",
	main: "main",
	platform: "darwin",
	sandbox: true,
	browser: true,
	warnings: ["The agent scout works in bypass mode: it has your whole account, without a sandbox."],
	modelNotes: [],
	log: "/Users/owner/.pine/data/pine.log",
};

const settings: Setting[] = [
	{ key: "defaults.model", title: "Model", about: "The model an agent runs on when its agent.json names none.", kind: "model", now: "anthropic/claude-sonnet", live: true },
	{ key: "defaults.mode", title: "Mode", about: "How much an agent asks, and how far it reaches.\nsafe and manual work in the sandbox; auto and bypass without one.", kind: { one: ["manual", "safe", "auto", "bypass"] }, now: "safe", live: true },
	{ key: "limits.taskTimeout", title: "Time for a task", about: "How long one task may run before pine stops it.", kind: "duration", now: "10m", live: true },
	{ key: "limits.parallel", title: "Model slots", about: "How many requests go to the models at once.", kind: { from: 1, to: 16 }, now: "4", live: false },
	{ key: "security.askAccess", title: "Ask for access", about: "Ask you when a command needs more than its sandbox gives it.", kind: "boolean", now: "true", live: true },
	{ key: "security.bypassWhenTainted", title: "Bypass after outside content", about: "Whether bypass mode still asks nothing once a conversation has read outside content.", kind: "boolean", now: "false", live: true },
];

const models = ["anthropic/claude-sonnet", "anthropic/claude-haiku", "local/qwen3-coder"];

const agents: AgentInfo[] = [
	{ id: "main", main: true, description: "Your assistant: it runs pine and hands work to the others.", workspace: "/Users/owner/.pine/agents/main/workspace", model: "anthropic/claude-sonnet", mode: "safe", thinking: "medium", delegates: ["scout", "mail"] },
	{ id: "scout", main: false, description: "Looks things up on the web and reports what it found.", workspace: "/Users/owner/.pine/agents/scout/workspace", model: "local/qwen3-coder", mode: "bypass", thinking: "low", delegates: [] },
	{ id: "mail", main: false, description: "", workspace: "/Users/owner/.pine/agents/mail/workspace", model: "anthropic/claude-haiku", mode: "auto", thinking: "off", delegates: [] },
];

const mcp: McpServer[] = [
	{ name: "browser", scope: "global", agents: ["main", "scout", "mail"], target: "bundled:browser", remote: false, taints: true, approve: "never", enabled: true },
	{ name: "linear", scope: "global", agents: ["main"], target: "https://mcp.linear.app/mcp", remote: true, taints: false, approve: "never", enabled: true },
	{ name: "notes", scope: "scout", agents: ["scout"], target: "npx -y @example/notes-mcp@1.2.0 --root ~/notes", remote: false, taints: false, approve: "always", enabled: true },
	{ name: "calendar", scope: "main", session: "planning", agents: ["main"], target: "https://calendar.example.com/mcp", remote: true, taints: false, approve: "never", enabled: false },
];

const answers: Record<string, unknown> = {
	"/overview": overview,
	"/settings": settings,
	"/models": models,
	"/mcp": mcp,
	"/mcp/states": { linear: "needs sign-in", notes: "connected" },
};

window.pine.call = async (_method, url) => (url in answers ? { ok: true, status: 200, data: answers[url] } : { ok: false, status: 404, data: { error: `no stand-in for ${url}` } });

function Tab({ section }: { section: string }) {
	store.section = section;
	store.settingsAgent = undefined;
	store.agents = agents;
	return (
		<div className="flex h-180 w-full max-w-250">
			<Settings />
		</div>
	);
}

const meta = { component: Tab, parameters: { layout: "padded" } } satisfies Meta<typeof Tab>;
export default meta;
type Story = StoryObj<typeof meta>;

/** pine's own settings: the version and home, a note on the setup, and a control of each kind. */
export const General: Story = { args: { section: "general" } };

/** The list of agents, each a row to open: main, its mode, its model and workspace. */
export const Agents: Story = { args: { section: "agents" } };

/** MCP servers in each scope and state, with Sign in and Remove, above the form that adds one. */
export const McpServers: Story = { args: { section: "mcp" } };

/** This computer and two machines added over SSH, the app on one of them: in use there, Use and Forget on the others. */
export const Environments: Story = {
	args: { section: "environments" },
	render: (args) => {
		store.prefs = { ...store.prefs, hosts: ["me@build-box", "studio"], use: "me@build-box" };
		store.service = { status: "ready", mode: "on build-box", started: false, home: "build-box:~/.pine", version: "0.23.0", from: "ssh me@build-box", host: "me@build-box", label: "build-box" };
		store.connected = true;
		return <Tab {...args} />;
	},
};

// The app's preferences as the main process keeps them: what is set is answered back, as `pine:prefs` does.
window.pine.prefs = async (change) => ({ ...store.prefs, ...change });

/** The Colours section of the App page with a palette of the owner's: colour match off, so the scheme can be chosen, and Reset on. */
export const Colours: Story = {
	args: { section: "app" },
	render: () => {
		store.prefs = { ...store.prefs, palette: { ...DEFAULT_PALETTE, source: "#3366cc", colorMatch: false, scheme: "vibrant", contrast: 0.5 } };
		return (
			<div className="w-full max-w-200">
				<ColoursSection />
			</div>
		);
	},
};

/** The Colours section on pine's own palette: colour match off, the tonal spot scheme, nothing to reset. */
export const ColoursDefault: Story = {
	args: { section: "app" },
	render: () => {
		store.prefs = { ...store.prefs, palette: undefined };
		return (
			<div className="w-full max-w-200">
				<ColoursSection />
			</div>
		);
	},
};

/** The Colours section with code in dark kept on poimandres: "Code follows the palette" off. */
export const ColoursCodePoimandres: Story = {
	args: { section: "app" },
	render: () => {
		store.prefs = { ...store.prefs, palette: undefined, codeFollowsPalette: false };
		return (
			<div className="w-full max-w-200">
				<ColoursSection />
			</div>
		);
	},
};
