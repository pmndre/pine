// The agent, beside its conversation: who it is, what it runs on, what it is doing, and what it
// has been given (what it listens to, its schedules, skills and servers, what it remembers).
// A conversation in pine is a conversation with an agent; this is the agent.
import { TriangleAlertIcon, CheckIcon, CpuIcon, SettingsIcon, ShieldIcon, SparkleIcon, BookIcon, ClockIcon, PlugIcon, ZapIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "./api.ts";
import { CODE_LINES } from "./lists.tsx";
import { store, type Tab, useModel } from "./model.ts";
import { childKind, MODES, oneLine, short } from "./text.ts";
import { useLoad } from "./use-load.ts";
import { Pulse } from "@/components/pulse";
import { HoverTooltip } from "@/components/hover-tooltip";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Printed } from "@/components/printed";
import { AgentAvatar } from "@/components/agent-avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReactNode } from "react";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";

const NONE = "px-3.5 py-0.5 text-faint wrap-anywhere";
/** A section: its title over its rows. A heading, not a FieldSet: the rows are read, there is nothing in them to fill in. */
const SECTION = "flex min-w-0 flex-col";
const TITLE = "mt-1.5 mb-1 flex min-h-6 w-full items-center gap-2 pr-2 pl-3.5 text-xs font-semibold text-faint";

/**
 * One section of the Agent panel: its title, a count, an action, and its rows. With `skeleton` it
 * draws its title and a few row bars while it first loads; with `error` it says why it failed, in
 * place of its rows, so a failure reads apart from loading and from empty.
 */
export function AgentSection({ title, count, action, skeleton = false, error, children }: { title: ReactNode; count?: number; action?: ReactNode; skeleton?: boolean; error?: string; children?: ReactNode }) {
	return (
		<section className={SECTION} data-slot="agent-section">
			<h3 className={TITLE}>
				{title}
				{skeleton ? <Skeleton className="h-4 w-5" /> : count !== undefined && !error ? <Badge variant="secondary">{count}</Badge> : null}
				{action ? <><span className="min-w-0 flex-1" />{action}</> : null}
			</h3>
			{skeleton ? (
				<div className="flex flex-col gap-2 px-3.5 py-1">
					<Skeleton className="h-4 w-2/3" />
					<Skeleton className="h-4 w-1/2" />
				</div>
			) : error ? (
				<Alert variant="destructive" className="mx-3.5 w-auto"><TriangleAlertIcon /><AlertDescription className="wrap-anywhere">{error}</AlertDescription></Alert>
			) : children}
		</section>
	);
}

/** What a section of useLoad shows: its skeleton on the first load only, then its error or its rows. */
function state(load: { data?: unknown; error?: string }) {
	return { skeleton: load.data === undefined && load.error === undefined, error: load.data === undefined ? load.error : undefined };
}

export function AgentView({ tab }: { tab: Tab }) {
	useModel(tab);
	const s = useModel(store);
	const info = s.agent(tab.agent);
	// Each is asked by itself, so one that fails says so in its own section and the others still show.
	const detail = useLoad(() => api.agentDetail(tab.agent), [tab.agent, tab.codeTick]);
	const sources = useLoad(() => api.agentSources(tab.agent, tab.session), [tab.key, tab.codeTick]);
	const schedules = useLoad(() => api.schedules(), [tab.agent, tab.codeTick]);
	const skills = useLoad(() => api.skills(), [tab.agent, tab.codeTick]);
	const servers = useLoad(() => api.mcp(), [tab.agent, tab.codeTick]);
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
		<ScrollArea className="flex min-h-0 flex-1 cursor-auto flex-col select-text *:data-[slot=scroll-area-viewport]:scroll-fade">
		<div className="flex flex-col gap-3 pb-2">
			<Item className="px-3.5 pt-4 pb-0.5">
				<ItemMedia>
					<AgentAvatar agent={{ id: tab.agent, color: store.agent(tab.agent)?.color, main: store.agent(tab.agent)?.main }} size="lg" />
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
				<HoverTooltip><TooltipTrigger render={<Badge variant="outline" render={<button type="button" onClick={() => void s.pickModel(tab)} />}><CpuIcon data-icon="inline-start" />{info.model}</Badge>} /><TooltipContent>The model this agent runs on</TooltipContent></HoverTooltip>
				<HoverTooltip><TooltipTrigger render={<Badge variant="outline" render={<button type="button" onClick={() => void s.pickReasoning(tab)} />}><SparkleIcon data-icon="inline-start" />reasoning {info.thinking}</Badge>} /><TooltipContent>How long the model thinks before answering</TooltipContent></HoverTooltip>
				<HoverTooltip><TooltipTrigger render={<Badge variant="outline" render={<button type="button" onClick={() => void s.pickMode(tab)} />}><ShieldIcon data-icon="inline-start" />{info.mode} · {info.mode === "auto" || info.mode === "bypass" ? "your account" : "in a sandbox"}</Badge>} /><TooltipContent>{mode?.about ?? "How often the agent asks you, and what it can reach"}</TooltipContent></HoverTooltip>
				{info.delegates.length ? <Badge variant="outline">delegates to {info.delegates.includes("*") ? (info.main ? "all other agents" : `all agents except ${store.agents.find((a) => a.main)?.id ?? "the main one"}`) : info.delegates.join(", ")}</Badge> : null}
			</div>

			{tab.busy || helpers.length || elsewhere.length ? (
				<section className={SECTION}>
					{/* Each ItemMedia here is an icon's box (size-4): ItemMedia puts its content at the top beside a title with a
					   description, and a dot smaller than an icon would sit above the middle of the title's line. */}
					<h3 className={TITLE}>Working</h3>
					{tab.busy ? (
						<Item size="xs">
							<ItemMedia className="size-4"><Pulse /></ItemMedia>
							<ItemContent>
								<ItemTitle>this conversation</ItemTitle>
								<ItemDescription>{`${tab.thinking ? "thinking" : "working"}${tab.toolCalls ? ` · ${tab.toolCalls} tool calls` : ""}`}</ItemDescription>
							</ItemContent>
						</Item>
					) : null}
					{helpers.map(([id, c]) => (
						<Item key={id} size="xs" render={<button type="button" onClick={() => void s.openTask(id)} />}>
							<ItemMedia className="size-4">{c.running ? <Pulse /> : <CheckIcon />}</ItemMedia>
							<ItemContent>
								<ItemTitle>{c.agent}</ItemTitle>
								<ItemDescription>{`${childKind(c.kind)} #${id}: ${c.label}`}</ItemDescription>
							</ItemContent>
							<ItemActions><Badge variant="secondary">open</Badge></ItemActions>
						</Item>
					))}
					{elsewhere.map((session) => (
						<Item key={session} size="xs" render={<button type="button" onClick={() => void s.openTab(tab.agent, session)} />}>
							<ItemMedia className="size-4"><Pulse /></ItemMedia>
							<ItemContent>
								<ItemTitle>{session}</ItemTitle>
								<ItemDescription>another conversation with {tab.agent}</ItemDescription>
							</ItemContent>
							<ItemActions><Badge variant="secondary">open</Badge></ItemActions>
						</Item>
					))}
				</section>
			) : null}

			{
				<AgentSection title="Listens to" count={listens.length} {...state(sources)} action={<Button variant="ghost" size="xs" onClick={() => s.openSettings("events")}>Events</Button>}>
					{listens.length ? listens.map((x) => (
						<Item key={x.name} size="xs">
							<ItemMedia><ZapIcon /></ItemMedia>
							<ItemContent>
								<ItemTitle>{x.name}</ItemTitle>
								<ItemDescription>{(x.local ?? x.agent ?? x.global)?.note || x.description || x.type}</ItemDescription>
							</ItemContent>
							<ItemActions><Badge variant="secondary">{x.local ? "this conversation" : x.agent ? "this agent" : "all agents"}</Badge></ItemActions>
						</Item>
					)) : <div className={NONE}>Nothing wakes this agent yet.{could > 0 ? ` It can listen to ${could} event source${could === 1 ? "" : "s"}. Ask it to watch one, or subscribe it under Events.` : " Ask it to watch something, like “tell me when a file lands in ~/Scans”."}</div>}
				</AgentSection>
			}
			{
				<AgentSection title="Schedules" count={timed.length} {...state(schedules)}>
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
					}) : <div className={NONE}>Nothing is scheduled. Ask the agent, for example “every morning at seven …”.</div>}
				</AgentSection>
			}
			{
				<AgentSection title="Skills" count={knows.length} {...state(skills)} action={<Button variant="ghost" size="xs" onClick={() => s.openSettings("skills")}>Skills</Button>}>
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
					}) : <div className={NONE}>No skills yet. Ask the agent to “make a skill for this”.</div>}
				</AgentSection>
			}
			{
				<AgentSection title="MCP servers" count={tools.length} {...state(servers)} action={<Button variant="ghost" size="xs" onClick={() => s.openSettings("mcp")}>Servers</Button>}>
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
				</AgentSection>
			}
			{detail.data && memory === undefined ? null : (
				<AgentSection title="Memory" {...state(detail)}>
					{memory ? <Printed capped text={short(memory, 6000)} className="mx-3.5 w-auto" contentClassName={CODE_LINES} /> : <div className={NONE}>MEMORY.md is empty.</div>}
				</AgentSection>
			)}
			{detail.data ? <div className={cn(NONE, "pb-4")}>The agent's workspace is {detail.data.workspace}. The Files view shows {tab.folder ? "this conversation's folder instead" : "it"}.</div> : null}
		</div>
		</ScrollArea>
	);
}
