// The agent, beside its conversation: who it is, what it runs on, what it is doing, and what it
// has been given (what it listens to, its schedules, skills and servers, what it remembers).
// A conversation in pine is a conversation with an agent; this is the agent.
import { CheckIcon, CpuIcon, SettingsIcon, ShieldIcon, SparkleIcon, BookIcon, ClockIcon, PlugIcon, ZapIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "./api.ts";
import { store, type Tab, useModel } from "./model.ts";
import { childKind, MODES, oneLine, short } from "./text.ts";
import { useLoad } from "./use-load.ts";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Printed } from "@/components/printed";
import { AgentAvatar } from "@/components/agent-avatar";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";

const NONE = "px-3.5 py-0.5 text-faint wrap-anywhere";
/** A section's title over its rows: stock FieldSet and FieldLegend, as the settings sections are. */
const SECTION = "min-w-0 gap-0";
const TITLE = "mt-1.5 mb-1 flex min-h-6 w-full items-center gap-2 pr-2 pl-3.5 text-xs font-semibold text-faint";

export function AgentView({ tab }: { tab: Tab }) {
	useModel(tab);
	const s = useModel(store);
	const info = s.agent(tab.agent);
	// Each is asked by itself: an older pine answers only some of them, and what it does not know is left out.
	const quiet = <T,>(ask: () => Promise<T>) => () => ask().catch(() => undefined);
	const detail = useLoad(quiet(() => api.agentDetail(tab.agent)), [tab.agent, tab.codeTick]);
	const sources = useLoad(quiet(() => api.agentSources(tab.agent, tab.session)), [tab.key, tab.codeTick]);
	const schedules = useLoad(quiet(() => api.schedules()), [tab.agent, tab.codeTick]);
	const skills = useLoad(quiet(() => api.skills()), [tab.agent, tab.codeTick]);
	const servers = useLoad(quiet(() => api.mcp()), [tab.agent, tab.codeTick]);
	if (!info) return null;
	const mode = MODES.find((m) => m.value === info.mode);
	const listens = (sources.data ?? []).filter((x) => x.local || x.agent || x.global);
	const could = (sources.data ?? []).length - listens.length;
	const timed = (schedules.data ?? []).filter((x) => x.scope === tab.agent || (x.scope === "global" && x.task));
	const knows = (skills.data ?? []).filter((x) => x.scope === "global" || (x.agent === tab.agent && (x.scope === "agent" || x.session === tab.session)));
	const tools = (servers.data ?? []).filter((x) => x.enabled && x.agents.includes(tab.agent) && (!x.session || x.session === tab.session));
	const helpers = [...tab.children].reverse().slice(0, 8);
	const elsewhere = [...s.busy].filter(([key, tasks]) => tasks.size && key.startsWith(`${tab.agent}:`) && key !== tab.key).map(([key]) => key.slice(tab.agent.length + 1));
	const memory = detail.data?.files.memory?.trim();
	return (
		<ScrollArea className="flex min-h-0 flex-1 cursor-auto flex-col text-xs select-text *:data-[slot=scroll-area-viewport]:scroll-fade">
		<div className="flex flex-col gap-3 pb-2">
			<Item className="px-3.5 pt-4 pb-0.5">
				<ItemMedia>
					<AgentAvatar agent={{ id: tab.agent, color: store.agent(tab.agent)?.color }} size="lg" />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>{tab.agent}{info.main ? <Badge>main</Badge> : null}</ItemTitle>
					<ItemDescription>{info.description || "no description"}</ItemDescription>
				</ItemContent>
				<ItemActions>
					<Button variant="outline" size="xs" onClick={() => s.openSettings("agents", tab.agent)}><SettingsIcon data-icon="inline-start" />Settings</Button>
				</ItemActions>
			</Item>
			<div className="mt-0.5 flex flex-wrap gap-1.5 px-3.5">
				<Tooltip><TooltipTrigger render={<Badge variant="outline" render={<button type="button" onClick={() => void s.pickModel(tab)} />}><CpuIcon data-icon="inline-start" />{info.model}</Badge>} /><TooltipContent>The model it runs on</TooltipContent></Tooltip>
				<Tooltip><TooltipTrigger render={<Badge variant="outline" render={<button type="button" onClick={() => void s.pickReasoning(tab)} />}><SparkleIcon data-icon="inline-start" />reasoning {info.thinking}</Badge>} /><TooltipContent>How much its model thinks before it answers</TooltipContent></Tooltip>
				<Tooltip><TooltipTrigger render={<Badge variant="outline" render={<button type="button" onClick={() => void s.pickMode(tab)} />}><ShieldIcon data-icon="inline-start" />{info.mode} · {info.mode === "auto" || info.mode === "bypass" ? "your account" : "in its sandbox"}</Badge>} /><TooltipContent>{mode?.about ?? "How much it asks and how far it reaches"}</TooltipContent></Tooltip>
				{info.delegates.length ? <Badge variant="outline">hands work to {info.delegates.includes("*") ? "every agent" : info.delegates.join(", ")}</Badge> : null}
			</div>

			{tab.busy || helpers.length || elsewhere.length ? (
				<FieldSet className={SECTION}>
					<FieldLegend className={TITLE}>At work</FieldLegend>
					{tab.busy ? (
						<Item size="xs">
							<ItemMedia><Spinner aria-label="Working" className="size-3" /></ItemMedia>
							<ItemContent>
								<ItemTitle>this conversation</ItemTitle>
								<ItemDescription>{`${tab.thinking ? "thinking" : "working"}${tab.toolCalls ? ` · ${tab.toolCalls} tool calls` : ""}`}</ItemDescription>
							</ItemContent>
						</Item>
					) : null}
					{helpers.map(([id, c]) => (
						<Item key={id} size="xs" render={<button type="button" onClick={() => void s.openTask(id)} />}>
							<ItemMedia>{c.running ? <Spinner aria-label="Working" className="size-3" /> : <CheckIcon />}</ItemMedia>
							<ItemContent>
								<ItemTitle>{c.agent}</ItemTitle>
								<ItemDescription>{`${childKind(c.kind)} #${id}: ${c.label}`}</ItemDescription>
							</ItemContent>
							<ItemActions><Badge variant="secondary">open</Badge></ItemActions>
						</Item>
					))}
					{elsewhere.map((session) => (
						<Item key={session} size="xs" render={<button type="button" onClick={() => void s.openTab(tab.agent, session)} />}>
							<ItemMedia><Spinner aria-label="Working" className="size-3" /></ItemMedia>
							<ItemContent>
								<ItemTitle>{session}</ItemTitle>
								<ItemDescription>another conversation of {tab.agent}</ItemDescription>
							</ItemContent>
							<ItemActions><Badge variant="secondary">open</Badge></ItemActions>
						</Item>
					))}
				</FieldSet>
			) : null}

			{sources.data ? (
				<FieldSet className={SECTION}>
					<FieldLegend className={TITLE}>
						Listens to
						<Badge variant="secondary">{listens.length}</Badge>
						<span className="min-w-0 flex-1" />
						<Button variant="ghost" size="xs" onClick={() => s.openSettings("events")}>Events</Button>
					</FieldLegend>
					{listens.length ? listens.map((x) => (
						<Item key={x.name} size="xs">
							<ItemMedia><ZapIcon /></ItemMedia>
							<ItemContent>
								<ItemTitle>{x.name}</ItemTitle>
								<ItemDescription>{(x.local ?? x.agent ?? x.global)?.note || x.description || x.type}</ItemDescription>
							</ItemContent>
							<ItemActions><Badge variant="secondary">{x.local ? "this conversation" : x.agent ? "as an agent" : "all agents"}</Badge></ItemActions>
						</Item>
					)) : <div className={NONE}>Nothing wakes it by itself.{could > 0 ? ` ${could} event source${could === 1 ? "" : "s"} could: ask it to watch one, or subscribe it under Events.` : " Ask it to watch something (“tell me when a file lands in ~/Scans”)."}</div>}
				</FieldSet>
			) : null}
			{schedules.data ? (
				<FieldSet className={SECTION}>
					<FieldLegend className={TITLE}>
						Schedules
						<Badge variant="secondary">{timed.length}</Badge>
					</FieldLegend>
					{timed.length ? timed.map((x) => {
						const tag = x.scope === "global" ? "all agents" : x.session && x.session !== "main" ? x.session : undefined;
						return (
							<Item key={`${x.scope}:${x.name}`} size="xs">
								<ItemMedia><ClockIcon /></ItemMedia>
								<ItemContent>
									<ItemTitle>{x.name}</ItemTitle>
									<ItemDescription>{`${x.when}${x.task ? ` · ${oneLine(x.task)}` : ""}`}</ItemDescription>
								</ItemContent>
								{tag ? <ItemActions><Badge variant="secondary">{tag}</Badge></ItemActions> : null}
							</Item>
						);
					}) : <div className={NONE}>Nothing is scheduled. Ask it (“every morning at seven …”).</div>}
				</FieldSet>
			) : null}
			{skills.data ? (
				<FieldSet className={SECTION}>
					<FieldLegend className={TITLE}>
						Skills
						<Badge variant="secondary">{knows.length}</Badge>
						<span className="min-w-0 flex-1" />
						<Button variant="ghost" size="xs" onClick={() => s.openSettings("skills")}>Skills</Button>
					</FieldLegend>
					{knows.length ? knows.map((x) => {
						const tag = x.scope === "global" ? "all agents" : x.scope === "local" ? "this conversation" : undefined;
						return (
							<Item key={x.dir} size="xs">
								<ItemMedia><BookIcon /></ItemMedia>
								<ItemContent>
									<ItemTitle>{x.name}</ItemTitle>
									{x.description ? <ItemDescription>{x.description}</ItemDescription> : null}
								</ItemContent>
								{tag ? <ItemActions><Badge variant="secondary">{tag}</Badge></ItemActions> : null}
							</Item>
						);
					}) : <div className={NONE}>No skills yet. Ask it to “make a skill for this”.</div>}
				</FieldSet>
			) : null}
			{servers.data ? (
				<FieldSet className={SECTION}>
					<FieldLegend className={TITLE}>
						MCP servers
						<Badge variant="secondary">{tools.length}</Badge>
						<span className="min-w-0 flex-1" />
						<Button variant="ghost" size="xs" onClick={() => s.openSettings("mcp")}>Servers</Button>
					</FieldLegend>
					{tools.length ? tools.map((x) => {
						const tag = x.scope === "global" ? "all agents" : x.session ? "this conversation" : undefined;
						return (
							<Item key={`${x.scope}:${x.name}`} size="xs">
								<ItemMedia><PlugIcon /></ItemMedia>
								<ItemContent>
									<ItemTitle>{x.name}</ItemTitle>
									{x.target ? <ItemDescription>{x.target}</ItemDescription> : null}
								</ItemContent>
								{tag ? <ItemActions><Badge variant="secondary">{tag}</Badge></ItemActions> : null}
							</Item>
						);
					}) : <div className={NONE}>No MCP servers.</div>}
				</FieldSet>
			) : null}
			{memory !== undefined ? (
				<FieldSet className={SECTION}>
					<FieldLegend className={TITLE}>What it remembers</FieldLegend>
					{memory ? <Printed sm text={short(memory, 6000)} className="mx-3.5 w-auto" /> : <div className={NONE}>Its MEMORY.md is empty.</div>}
				</FieldSet>
			) : null}
			{detail.data ? <div className={cn(NONE, "pb-4")}>Its workspace is {detail.data.workspace}; the Files view shows {tab.folder ? "the folder this conversation works in" : "it"}.</div> : null}
		</div>
		</ScrollArea>
	);
}
