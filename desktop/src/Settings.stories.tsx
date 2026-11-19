import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AgentDetail, AgentInfo, McpServer, Overview, Route, Schedule, Setting } from "./api.ts";
import { store } from "./model.ts";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AgentAccent, NewRoute, NewSchedule, Routes, Schedules, Settings, ThemePicker } from "./Settings.tsx";
import { THEMES } from "../.storybook/themes.ts";
import type { ThemeEntry } from "./theme.ts";

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
	{ id: "scout", main: false, description: "Looks things up on the web and reports what it found.", color: "#e0805a", workspace: "/Users/owner/.pine/agents/scout/workspace", model: "local/qwen3-coder", mode: "bypass", thinking: "low", delegates: [] },
	{ id: "mail", main: false, description: "", workspace: "/Users/owner/.pine/agents/mail/workspace", model: "anthropic/claude-haiku", mode: "auto", thinking: "off", delegates: [] },
];

const mcp: McpServer[] = [
	{ name: "browser", scope: "global", agents: ["main", "scout", "mail"], target: "bundled:browser", remote: false, taints: true, approve: "never", enabled: true },
	{ name: "linear", scope: "global", agents: ["main"], target: "https://mcp.linear.app/mcp", remote: true, taints: false, approve: "never", enabled: true },
	{ name: "notes", scope: "scout", agents: ["scout"], target: "npx -y @example/notes-mcp@1.2.0 --root ~/notes", remote: false, taints: false, approve: "always", enabled: true },
	{ name: "calendar", scope: "main", session: "planning", agents: ["main"], target: "https://calendar.example.com/mcp", remote: true, taints: false, approve: "never", enabled: false },
];

/** The page of the agent scout: its colour (coral) among the presets, and the rest of what can be changed. */
const scout: AgentDetail = {
	id: "scout",
	main: false,
	description: "Looks things up on the web and reports what it found.",
	color: "#e0805a",
	workspace: "/Users/owner/.pine/agents/scout/workspace",
	dir: "/Users/owner/.pine/agents/scout",
	model: "local/qwen3-coder",
	defaultModel: "anthropic/claude-sonnet",
	thinking: "low",
	mode: "bypass",
	tools: ["read", "bash", "grep"],
	allTools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
	delegates: [],
	network: true,
	read: [],
	write: [],
	holdings: { conversations: ["main"], sources: [], servers: ["notes"], schedules: [], skills: [], routes: [], files: 3, outside: true },
	files: { instructions: "You look things up on the web.\n" },
};

/** One route of each kind: state set without an agent, a model's look passed on, an agent woken on that, a pause between alarms. */
const routes: Route[] = [
	{ name: "mode", on: ["source/house/message"], when: { "payload.topic": "house/mode" }, set: { "house/mode": "{{payload.value}}" } },
	{ name: "classify", on: ["source/cam/added"], debounceMs: 4000, call: { prompt: "Camera file {{payload.file}}", system: "Answer PERSON, VEHICLE, ANIMAL or NOTHING." }, publish: { topic: "cam/classified" } },
	{ name: "intruder", on: ["cam/classified"], when: { "payload.text": { regex: "^PERSON" }, "state.house/mode": "away" }, agent: "main", session: "new", prompt: "The camera saw somebody while the house is empty: {{payload.text}}" },
	{ name: "smoke", on: ["source/house/message", "hook/smoke"], throttleMs: 300_000, agent: "scout", trust: "owner" },
];

/** A schedule of each kind: set times for one agent, an interval in a side conversation, once for all agents. */
const schedules: Schedule[] = [
	{ name: "morning", scope: "main", session: "main", when: 'at the times "0 7 * * 1-5" (minute hour day month weekday)', task: "Look at my calendar for today and tell me what is coming.", next: Date.UTC(2026, 10, 20, 6, 0), topic: "timer/morning@main" },
	{ name: "prices", scope: "scout", session: "shopping", when: "every 6h", task: "Look whether the price of the bike on my list has dropped below 900 euros.", next: Date.UTC(2026, 10, 19, 18, 0), topic: "timer/prices@scout" },
	{ name: "dentist", scope: "global", when: "once, at 2026-11-20 17:00", task: "Remind me to call the dentist.", next: Date.UTC(2026, 10, 20, 16, 0), topic: "timer/dentist" },
];

const answers: Record<string, unknown> = {
	"/overview": overview,
	"/agents/scout/detail": scout,
	"/settings": settings,
	"/models": models,
	"/mcp": mcp,
	"/mcp/states": { linear: "needs sign-in", notes: "connected" },
	"/routes": routes,
	"/schedules": schedules,
};

window.pine.call = async (_method, url) => (url in answers ? { ok: true, status: 200, data: answers[url] } : { ok: false, status: 404, data: { error: `no stand-in for ${url}` } });

function Tab({ section, agent }: { section: string; agent?: string }) {
	store.section = section;
	store.settingsAgent = agent;
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

/** One agent's page: its colour (a preset, coral) beside None and Other, then its model, mode, tools and files. */
export const AgentPage: Story = { args: { section: "agents", agent: "scout" } };

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

/** Events › Schedules: what a schedule is, then each schedule said as When and Then, with New schedule. */
export const ScheduleList: Story = {
	args: { section: "events" },
	render: () => {
		store.agents = agents;
		return (
			<div className="flex w-full max-w-250 flex-col gap-6">
				<Schedules />
			</div>
		);
	},
};

/** The form for a new schedule as it opens: When (set times, an interval, once), Then whom it wakes with what task, a name. */
export const NewScheduleForm: Story = {
	args: { section: "events" },
	render: () => {
		store.agents = agents;
		return (
			<Dialog open>
				<DialogContent showCloseButton={false} className="sm:max-w-2xl"><NewSchedule made={() => {}} /></DialogContent>
			</Dialog>
		);
	},
};

/** Events › Routes: when a route is needed at all, then each route said as When and Then, with New route. */
export const RouteList: Story = {
	args: { section: "events" },
	render: () => {
		store.agents = agents;
		return (
			<div className="flex w-full max-w-250 flex-col gap-6">
				<Routes />
			</div>
		);
	},
};

/** The form for a new route as it opens: When (a topic, an optional condition, how often), Then waking an agent, a name. */
export const NewRouteWake: Story = {
	args: { section: "events" },
	render: () => {
		store.agents = agents;
		return (
			<Dialog open>
				<DialogContent showCloseButton={false} className="sm:max-w-2xl"><NewRoute made={() => {}} /></DialogContent>
			</Dialog>
		);
	},
};

/** The same form with Then set to Ask a model: the question, its instructions, the model and the topic its answer goes out on. */
export const NewRouteAsk: Story = {
	args: { section: "events" },
	render: () => {
		store.agents = agents;
		return (
			<Dialog open>
				<DialogContent showCloseButton={false} className="sm:max-w-2xl"><NewRoute made={() => {}} does="ask" /></DialogContent>
			</Dialog>
		);
	},
	// The dialog scrolls at half the window's height: what this story is about begins at Then.
	play: async () => {
		await new Promise(requestAnimationFrame);
		const viewport = document.querySelector("[data-slot=dialog-content] [data-slot=scroll-area-viewport]");
		const then = [...document.querySelectorAll("[data-slot=dialog-content] legend")].find((l) => l.textContent === "Then");
		if (viewport && then) viewport.scrollTop += then.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
	},
};

// The app's preferences as the main process keeps them: what is set is answered back, as `pine:prefs` does.
window.pine.prefs = async (change) => ({ ...store.prefs, ...change });

/** The theme of the App page: pine's themes, pmndre in force, and a file in the folder that is not a theme. */
export const Theme: Story = {
	args: { section: "app" },
	render: () => {
		store.themes = [...THEMES, { id: "half-done", name: "half-done", problem: 'it names no colour for the page: a theme needs "editor.background" and "editor.foreground" in "colors"' } satisfies ThemeEntry];
		store.theme = "pmndre";
		return (
			<div className="w-full max-w-200">
				<ThemePicker />
			</div>
		);
	},
};

/** The switch for the colour of the agent in front, turned off: the theme's accent stays whoever is in front. */
export const AgentAccentOff: Story = {
	args: { section: "app" },
	render: () => {
		store.prefs = { ...store.prefs, agentAccent: false };
		return (
			<div className="w-full max-w-200">
				<AgentAccent />
			</div>
		);
	},
};
