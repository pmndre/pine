import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, waitFor, within } from "storybook/test";
import type { AgentDetail, AgentInfo, McpServer, Overview, Route, Schedule, Setting } from "./api.ts";
import { store } from "./model.ts";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { NewRoute, NewSchedule, Routes, Schedules, Settings, SettingsItem, ThemePicker } from "./Settings.tsx";
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

/** The page of the agent scout: its color (coral) among the presets, and the rest of what can be changed. */
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
	// Signed in to one provider, and two model servers of the owner's own: one with several models and a number of
	// runs of its own, one as it comes.
	"/models/providers": [
		{ id: "anthropic", name: "Anthropic", signedIn: true, oauth: true, models: 6 },
		{ id: "openai", name: "OpenAI", signedIn: false, oauth: true, models: 12 },
	],
	"/models/servers": [
		{ name: "local", baseUrl: "http://127.0.0.1:8080/v1", key: "none", runs: 8, models: [{ id: "qwen3-coder", contextWindow: 65536, images: false, reasoning: true }, { id: "gemma-4-vision", contextWindow: 32768, images: true, reasoning: false, limit: 1 }, { id: "nomic-embed-text-v2-moe-long-name-of-a-model", contextWindow: 8192, images: false, reasoning: false }] },
		{ name: "studio", baseUrl: "http://studio.local:1234/v1", key: "PINE_MODEL_STUDIO_API_KEY in .env", runs: 8, models: [{ id: "glm-5.3", contextWindow: 131072, images: true, reasoning: true }] },
	],
	"/mcp": mcp,
	"/mcp/states": { linear: "needs sign-in", notes: "connected" },
	"/routes": routes,
	"/schedules": schedules,
	// The files for all agents, under the list on the Agents page: one written, two still empty.
	"/shared": [
		{ name: "AGENTS.md", about: "Traits and behaviour for all agents: how every agent is to be and to act.", text: "Answer in English, briefly.\n" },
		{ name: "TOOLS.md", about: "Tooling for all agents: defaults and preferences for the tools, and other technical details of your setup.", text: "" },
		{ name: "USER.md", about: "What every agent knows about you.", text: "" },
	],
};

window.pine.call = async (_method, url) => (url in answers ? { ok: true, status: 200, data: answers[url] } : { ok: false, status: 404, data: { error: `no stand-in for ${url}` } });

function Tab({ section, agent, local = true }: { section: string; agent?: string; local?: boolean }) {
	// What the bridge's `state()` says: false under a bridge with no "this computer" (a phone, a browser).
	store.local = local;
	store.section = section;
	store.settingsAgent = agent;
	store.agents = agents;
	return (
		<div className="flex h-180 w-full max-w-250">
			<Settings />
		</div>
	);
}

const meta = {
	component: Tab,
	parameters: { layout: "padded" },
	// What a story sets on the store is put back after it: the next story starts from the store as it was.
	beforeEach: () => {
		const { local, service, prefs, connected, section, settingsAgent, agents } = store;
		return () => void Object.assign(store, { local, service, prefs, connected, section, settingsAgent, agents });
	},
} satisfies Meta<typeof Tab>;

/** Nothing of a local machine on the page: no row for it, no "This Mac" or "This computer", nothing to use or set up there. */
async function noLocalMachine(root: HTMLElement) {
	await expect(root.querySelector('[data-environment="local"]')).toBeNull();
	await expect(within(root).queryAllByText(/This (Mac|computer)|Use this (Mac|computer)|Set up pine/)).toHaveLength(0);
}
export default meta;
type Story = StoryObj<typeof meta>;

/** pine's own settings: the version and home, a note on the setup, and a control of each kind. */
export const General: Story = { args: { section: "general" } };

/** General while pine has not answered yet: a skeleton card for the overview and skeleton groups for the settings, no Pulse. */
export const GeneralLoading: Story = {
	args: { section: "general" },
	beforeEach: () => {
		const call = window.pine.call;
		// The overview and the settings never answer: the page stays on its first load.
		window.pine.call = (method, url) => (url === "/overview" || url === "/settings" ? new Promise(() => {}) : call(method, url));
		return () => void (window.pine.call = call);
	},
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector("[data-slot=settings-overview-skeleton]")).not.toBeNull();
		await expect(canvasElement.querySelectorAll("[data-slot=settings-group-skeleton]").length).toBeGreaterThan(0);
		await expect(canvasElement.querySelectorAll("[data-slot=settings-page] [data-slot=pulse]")).toHaveLength(0);
	},
};

/** The list of agents, each a row to open: main, its mode, its model and workspace. */
export const Agents: Story = { args: { section: "agents" } };

/** One agent's page: at the top its avatar in its color (coral), which opens the color, and its name, which renames it; then its model, mode, tools and files. */
export const AgentPage: Story = { args: { section: "agents", agent: "scout" } };

/** MCP servers in each scope and state, with Sign in and Remove, above the form that adds one. */
export const McpServers: Story = { args: { section: "mcp" } };

/** Models: the default, the providers signed in to, and the owner's own model servers, each with its models on lines of their own, and for each model how many runs it takes at a time. */
export const Models: Story = {
	args: { section: "models" },
	play: async ({ canvasElement }) => {
		const local = await within(canvasElement).findByText("qwen3-coder");
		await expect(local.closest("[data-server]")).toHaveAttribute("data-server", "local");
		await expect(canvasElement.querySelectorAll('[data-server="local"] [data-model]')).toHaveLength(3);
		await expect(within(canvasElement).getByText("66k context · text only · can reason")).toBeInTheDocument();
		// Each model says its number: one has its own, the others what holds everywhere. No number for a whole server.
		await expect(canvasElement.querySelector('[data-setting^="server-runs:"]')).toBeNull();
		await expect(canvasElement.querySelector('[data-setting="model-runs:studio/glm-5.3"] [data-slot=select-trigger]')).toHaveTextContent("Pine default (8)");
		await expect(canvasElement.querySelector('[data-setting="model-runs:local/gemma-4-vision"] [data-slot=select-trigger]')).toHaveTextContent("1 at a time");
		await expect(canvasElement.querySelector('[data-setting="model-runs:local/qwen3-coder"] [data-slot=select-trigger]')).toHaveTextContent("Pine default (8)");
	},
};

/** The search at the top of the navigation, with words typed: what fits in place of the page, best first, and the pages with nothing that fits faded. */
export const Search: Story = {
	args: { section: "general" },
	play: async ({ canvas, userEvent }) => {
		await userEvent.type(await canvas.findByRole("searchbox", { name: "Search Settings" }), "mode");
		await canvas.findByText("“mode”");
		await expect(await canvas.findByText("General › Defaults for agents · How much an agent asks, and how far it reaches.")).toBeVisible();
	},
};

/** Words that fit nothing in Settings. */
export const SearchFindsNothing: Story = {
	args: { section: "general" },
	play: async ({ canvas, userEvent }) => {
		await userEvent.type(await canvas.findByRole("searchbox", { name: "Search Settings" }), "zzqqxx");
		await canvas.findByText("Nothing in Settings fits");
	},
};

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

// The client's own SSH key, as a bridge with an SSH of its own gives it (the mobile and the web bridge) (the desktop's bridge has none, and shows no row for it).
window.pine.deviceKey = async () => ({ key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq3lYcVb0mXkJ2yq8rV6tZsP4dW1nE9fKcH7uR2aB3m pine-android", copy: async () => {}, share: async () => {} });

/** A bridge with no local machine (a phone's, a browser's): only the machines added, no row for this computer, nothing about a port of it or its terminal, and the client's key to copy or share. */
export const EnvironmentsWithoutLocal: Story = {
	args: { section: "environments", local: false },
	render: Environments.render,
	play: async ({ canvasElement, canvas }) => {
		await canvas.findByText("This device's key");
		await expect(canvasElement.querySelector('[data-environment="me@build-box"]')).not.toBeNull();
		await noLocalMachine(canvasElement);
	},
};

const fingerprint = "SHA256:Xv2k0yq3pZ8bW9cQm1sT4uE7rN6aL5dH2fJ0gK3iO8Y";
const trusted = fn();

/** A machine met for the first time, under a bridge that keeps host keys of its own: its row shows the host key's fingerprint and Trust this key, the owner's yes to exactly that one. */
export const EnvironmentsHostKeyToConfirm: Story = {
	args: { section: "environments", local: false },
	render: (args) => {
		store.prefs = { ...store.prefs, hosts: ["me@build-box", "studio"], use: "me@build-box" };
		store.service = { status: "error", kind: "ssh", host: "me@build-box", fingerprint, changed: false, message: `This device does not know me@build-box yet. Its host key's fingerprint is ${fingerprint}. If that is what the machine shows, trust it and connect.` };
		store.connected = false;
		return <Tab {...args} />;
	},
	beforeEach: () => {
		trusted.mockClear();
		window.pine.trustHostKey = trusted;
		return () => void delete (window.pine as Partial<typeof window.pine>).trustHostKey;
	},
	play: async ({ canvasElement, userEvent }) => {
		const row = canvasElement.querySelector<HTMLElement>('[data-environment="me@build-box"]')!;
		await expect(row.querySelector('[data-slot="host-key-fingerprint"]')).toHaveTextContent(fingerprint);
		// At a phone's width the three buttons go below the text instead of squeezing it into a column.
		await expect(row.querySelector('[data-slot="item-content"]')!.getBoundingClientRect().width).toBeGreaterThan(row.getBoundingClientRect().width / 2);
		await expect(canvasElement.querySelector('[data-environment="studio"] [data-slot="trust-host-key"]')).toBeNull();
		await userEvent.click(row.querySelector<HTMLElement>('[data-slot="trust-host-key"]')!);
		await expect(trusted).toHaveBeenCalledTimes(1);
		await expect(trusted).toHaveBeenCalledWith("me@build-box", fingerprint);
		await noLocalMachine(canvasElement);
	},
};

/** General under a bridge with no local machine: the theme, the agent accent, notifications and the pine in use, without what only this computer has (its home folder, Keep running, Restart, the pine command, the browser build, the Electron version). */
export const AppWithoutLocal: Story = {
	args: { section: "general", local: false },
	play: async ({ canvasElement, canvas }) => {
		await canvas.findByText("Theme");
		await noLocalMachine(canvasElement);
	},
};

// The app's preferences as the main process keeps them: what is set is answered back, as `pine:prefs` does.
window.pine.prefs = async (change) => ({ ...store.prefs, ...change });
// `pine` for a terminal, as General asks about it on this computer: not set up. (Without this the stand-in's answer
// is a function and no promise, and the page of every story with a local machine throws.)
window.pine.command = async () => ({ state: "none", text: "" });

/** The theme picker of General: pine's themes, pmndre in force, and a file in the folder that is not a theme. */
export const Theme: Story = {
	args: { section: "general" },
	render: () => {
		store.themes = [...THEMES, { id: "half-done", name: "half-done", problem: 'it names no color for the page: a theme needs "editor.background" and "editor.foreground" in "colors"' } satisfies ThemeEntry];
		store.theme = "pmndre";
		return (
			<div className="w-full max-w-200">
				<ThemePicker />
			</div>
		);
	},
};

/** The entries of the settings' navigation, by their label. */
const entries = (root: HTMLElement) => [...root.querySelectorAll("[data-slot=sidebar-menu-button]")].map((b) => b.textContent);

/** The page drawn for a section that is not offered: General, marked as the entry in use, never a page with no entry lit. */
async function generalInstead(root: HTMLElement) {
	await expect(entries(root)).not.toContain("Browser access");
	await expect(root.querySelector("[data-slot=sidebar-menu-button][aria-current=page]")).toHaveTextContent("General");
}

/** The desktop app on this computer's pine: Browser access is in the navigation, after Environments. (App is no entry of its own any more: it is a part of General.) */
export const AccessOffered: Story = {
	args: { section: "general" },
	play: async ({ canvasElement }) => {
		await expect(entries(canvasElement).slice(-2)).toEqual(["Environments", "Browser access"]);
	},
};

/** A bridge with no local machine (the web client, a phone): no Browser access in the navigation, and the section once chosen opens General. */
export const AccessNotOfferedWithoutLocal: Story = {
	args: { section: "access", local: false },
	play: async ({ canvasElement }) => await generalInstead(canvasElement),
};

/** The desktop app on another machine's pine: Browser access is this computer's door, so it is not offered there. */
export const AccessNotOfferedOnAnotherMachine: Story = {
	args: { section: "access" },
	render: Environments.render,
	play: async ({ canvasElement }) => await generalInstead(canvasElement),
};

/** A bridge that has no calls for Browser access (Storybook's stand-in answers every name, so the story takes it away). */
export const AccessNotOfferedWithoutBridgeCalls: Story = {
	args: { section: "access" },
	beforeEach: () => {
		(window.pine as unknown as Record<string, unknown>).access = false;
		return () => void delete (window.pine as Partial<typeof window.pine>).access;
	},
	play: async ({ canvasElement }) => await generalInstead(canvasElement),
};

/** The outline row of the Settings lists: a title with its badges, lines below it, and actions. */
export const SettingsItemDefault: Story = {
	args: { section: "general" },
	render: () => <SettingsItem title="linear" description={["https://mcp.linear.app/mcp", "for main"]} actions={<span>Sign in</span>} />,
};

/** The same row while its list loads: a bar for the title, bars for the lines, a block for the actions. */
export const SettingsItemSkeleton: Story = {
	args: { section: "general" },
	render: () => <SettingsItem skeleton />,
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector("[data-slot=settings-item] [data-slot=skeleton]")).not.toBeNull();
	},
};

/** Nothing the page asks for answers: it stays on its first load, drawn as skeletons, with no Pulse and no "…". */
function neverAnswers(section: string, agent?: string): Story {
	return {
		args: { section, agent },
		beforeEach: () => {
			const call = window.pine.call;
			window.pine.call = () => new Promise(() => {});
			return () => void (window.pine.call = call);
		},
		play: async ({ canvasElement }) => {
			const page = canvasElement.querySelector("[data-slot=settings-page]")!;
			await expect(page.querySelectorAll("[data-slot=skeleton]").length).toBeGreaterThan(0);
			await expect(page.querySelectorAll("[data-slot=pulse]")).toHaveLength(0);
			// A value still to come is a bar, never an element that says only "…".
			await expect([...page.querySelectorAll("*")].filter((x) => x.textContent?.trim() === "…")).toHaveLength(0);
		},
	};
}

/** Models on its first load: the fallback model, the providers and the own servers as skeleton rows. */
export const ModelsLoading = neverAnswers("models");
/** MCP servers on their first load. */
export const McpLoading = neverAnswers("mcp");
/** Skills on their first load. */
export const SkillsLoading = neverAnswers("skills");
/** Events on their first load: sources, schedules and routes as skeleton rows. */
export const EventsLoading = neverAnswers("events");
/** One agent's page on its first load: its heading, fields and editor as skeletons. */
export const AgentPageLoading = neverAnswers("agents", "scout");
/** The shared instructions on their first load. */
export const InstructionsLoading = neverAnswers("instructions");

/** Only some addresses never answer: the rest of the page is drawn, and what waits on them is pending. */
function withholding(section: string, urls: string[]) {
	return {
		args: { section },
		beforeEach: () => {
			const call = window.pine.call;
			window.pine.call = (method, url) => (urls.includes(url) ? new Promise(() => {}) : call(method, url));
			return () => void (window.pine.call = call);
		},
	} satisfies Story;
}

/** MCP servers listed while their states are still asked: each state badge is a bar, not "…". */
export const McpStatesLoading: Story = {
	...withholding("mcp", ["/mcp/states"]),
	play: async ({ canvasElement }) => {
		await within(canvasElement).findByText("linear");
		const rows = canvasElement.querySelectorAll("[data-find^='mcp:']");
		await expect(rows.length).toBe(mcp.length);
		// The server turned off says so; the others wait on their state.
		await expect(canvasElement.querySelectorAll("[data-find^='mcp:'] [data-slot=skeleton]")).toHaveLength(mcp.filter((x) => x.enabled).length);
	},
};

/** General with its settings drawn while the models are still asked: the model select is pending, not a list of one. */
export const GeneralModelsLoading: Story = {
	...withholding("general", ["/models"]),
	play: async ({ canvasElement }) => {
		const row = await waitFor(() => canvasElement.querySelector('[data-setting-key="defaults.model"]') ?? Promise.reject(new Error("no model row")));
		await expect(row.querySelector("[data-pending]")).not.toBeNull();
		await expect(row.querySelector("[data-slot=select-trigger]")).toBeNull();
	},
};
