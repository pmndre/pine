// The agent, beside its conversation: who it is, what it runs on, what it is doing, and what this
// conversation has been given (skills, servers, what wakes it), and the files it reads with each message. A conversation in pine
// is a conversation with an agent; this is the agent.
//
// The tab is an overview, and Settings is where things are kept: each part has the name and the order of
// its part on the agent's page in Settings, one way there ("Manage"), and rows that open the thing itself,
// in the same dialog Settings opens (`openThing`) or at its place in Settings. A row says whom the thing is
// for only when that is not this agent: "all agents" or "this conversation".
import { BlocksIcon, BookIcon, CheckIcon, ChevronRightIcon, ClockIcon, FolderIcon, GitBranchIcon, PlugIcon, SettingsIcon, TriangleAlertIcon, ZapIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { AgentAvatar } from "@/components/agent-avatar";
import { AgentFacts } from "@/components/agent-facts";
import { Pulse } from "@/components/pulse";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { type AgentFileKey, AgentFiles, changedFiles, FilesSkeleton, UnsavedBar } from "./AgentFiles.tsx";
import { api } from "./api.ts";
import { bridge } from "./bridge.ts";
import { store, type Tab, useModel } from "./model.ts";
import { childKind, oneLine, plural, tilde } from "./text.ts";
import { goTo, LISTS, openThing, routeOf, routeSaid, whenShort } from "./things.ts";
import { useLoad } from "./use-load.ts";

// One inset for the whole tab: every row, heading and line starts where a stock xs Item starts (px-2.5).
const INSET = "px-2.5";

/**
 * A row of the tab: what the thing is (an icon), its name, a line about it, and whom it is for when that is
 * not this agent. With `onOpen` the whole row is a button that opens it.
 */
export function AgentRow({ media, title, about, tag, onOpen }: { media: ReactNode; title: ReactNode; about?: ReactNode; tag?: string; onOpen?: () => void }) {
	return (
		<Item size="xs" render={onOpen ? <button type="button" onClick={onOpen} /> : undefined}>
			{/* An icon's box (size-4), also for a dot smaller than an icon, so that it sits on the title's line. */}
			<ItemMedia variant="icon" className="size-4">{media}</ItemMedia>
			<ItemContent className="min-w-0 text-left">
				<ItemTitle className="max-w-full">{title}</ItemTitle>
				{about ? <ItemDescription className="wrap-anywhere">{about}</ItemDescription> : null}
			</ItemContent>
			{tag || onOpen ? (
				<ItemActions>
					{tag ? <Badge variant="secondary">{tag}</Badge> : null}
					{onOpen ? <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" /> : null}
				</ItemActions>
			) : null}
		</Item>
	);
}

/**
 * One part of the tab: its heading, one way on to where its things are kept (`manage`), then its rows, or a
 * line when it has none (`empty`). With `skeleton` it draws bars of a row's shape while it first loads; with
 * `error` it says why it failed, so that a failure reads apart from loading and from empty.
 */
export function AgentSection({ title, manage, skeleton = false, error, empty, children }: { title: ReactNode; manage?: () => void; skeleton?: boolean; error?: string; empty?: ReactNode; children?: ReactNode }) {
	return (
		<section className="flex min-w-0 flex-col gap-1" data-slot="agent-section">
			<div className={cn("flex h-7 items-center justify-between gap-2", INSET)}>
				<h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
				{manage ? <Button variant="ghost" size="xs" className="-mr-1.5" onClick={manage}>Manage</Button> : null}
			</div>
			{skeleton ? (
				<Item size="xs">
					<ItemContent className="gap-2">
						<Skeleton className="h-4 w-1/3" />
						<Skeleton className="h-3.5 w-2/3" />
					</ItemContent>
				</Item>
			) : error ? (
				<div className={INSET}>
					<Alert variant="destructive"><TriangleAlertIcon /><AlertDescription className="wrap-anywhere">{error}</AlertDescription></Alert>
				</div>
			) : empty ? (
				// A row without a name: the line stands where a row's description stands, at its size.
				<Item size="xs">
					<ItemContent>
						<ItemDescription className="line-clamp-none wrap-anywhere">{empty}</ItemDescription>
					</ItemContent>
				</Item>
			) : (
				children
			)}
		</section>
	);
}

/** What a part shows of its load: bars on the first load only, then its error or its rows. */
function state(load: { data?: unknown; error?: string }) {
	return { skeleton: load.data === undefined && load.error === undefined, error: load.data === undefined ? load.error : undefined };
}

export function AgentView({ tab }: { tab: Tab }) {
	useModel(tab);
	useModel(LISTS);
	const s = useModel(store);
	const info = s.agent(tab.agent);
	const id = tab.agent;
	// Each list is asked for by itself, so that one that fails says so in its own part and the others still
	// show; and again when a dialog or Settings changed one (LISTS).
	const again = [tab.codeTick, LISTS.v];
	const detail = useLoad(() => api.agentDetail(id), [id, ...again]);
	const sources = useLoad(() => api.agentSources(id, tab.session), [tab.key, ...again]);
	const schedules = useLoad(() => api.schedules(), [id, ...again]);
	const routes = useLoad(() => api.routes(), [id, ...again]);
	const skills = useLoad(() => api.skills(), [id, ...again]);
	const extensions = useLoad(() => api.extensions(), [id, ...again]);
	const servers = useLoad(() => api.mcp(), [id, ...again]);
	const [texts, setTexts] = useState<Partial<Record<AgentFileKey, string>>>({});
	const [busy, setBusy] = useState(false);
	useEffect(() => setTexts({}), [id]);
	if (!info) return null;
	// What this conversation has: the agent's own, what is for all agents, and what is for this conversation alone.
	const listens = (sources.data ?? []).filter((x) => x.local || x.agent || x.global);
	const could = (sources.data ?? []).length - listens.length;
	const timed = (schedules.data ?? []).filter((x) => x.scope === id || (x.scope === "global" && x.task));
	const ruled = (routes.data ?? []).filter((r) => routeOf(r, id));
	const knows = (skills.data ?? []).filter((x) => x.scope === "global" || (x.agent === id && (x.scope === "agent" || x.session === tab.session)));
	const loads = (extensions.data ?? []).filter((x) => x.scope === "global" || x.agent === id);
	const tools = (servers.data ?? []).filter((x) => x.enabled && x.agents.includes(id) && (!x.session || x.session === tab.session));
	const helpers = [...tab.children].reverse().slice(0, 8);
	const elsewhere = [...s.busy].filter(([key, tasks]) => tasks.size && key.startsWith(`${id}:`) && key !== tab.key).map(([key]) => key.slice(id.length + 1));
	// What was typed into the agent's files and not saved yet. It is kept while the lists are asked again
	// (after each turn), and dropped with the agent.
	const unsaved = detail.data ? changedFiles(detail.data.files, texts) : [];
	const save = async () => {
		if (!unsaved.length) return;
		setBusy(true);
		const done = await store.attempt(() => api.updateAgent(id, Object.fromEntries(unsaved.map((f) => [f.key, texts[f.key]]))));
		setBusy(false);
		if (!done) return;
		store.flash(`Saved ${unsaved.map((f) => f.name).join(", ")}. ${id} reads the change from the next message on.${done.warnings.length ? ` Note: ${done.warnings.join("; ")}` : ""}`, done.warnings.length ? "warn" : "good", done.warnings.length ? 9000 : 3500);
		setTexts({});
		detail.reload();
	};
	// Where a part's things are kept: its part of the agent's page in Settings.
	const manage = (part: string) => () => goTo({ section: "agents", agent: id, find: `[data-find="agent-${part}"]` });
	// Whom a thing is for, said only when it is not this agent as a whole.
	const forWhom = (scope: string, session?: string) => (scope === "global" ? "all agents" : session && session !== "main" ? (session === tab.session ? "this conversation" : `in “${session}”`) : undefined);
	return (
		<ScrollArea className="flex min-h-0 flex-1 cursor-auto flex-col select-text *:data-[slot=scroll-area-viewport]:scroll-fade">
			<div className="flex flex-col gap-4 p-1.5 pb-4">
				<header className="flex flex-col gap-2">
					<Item size="xs">
						<ItemMedia>
							<AgentAvatar agent={{ id, color: info.color, main: info.main }} size="lg" />
						</ItemMedia>
						<ItemContent className="min-w-0">
							<ItemTitle>{id}</ItemTitle>
							<ItemDescription>{info.description || "no description"}</ItemDescription>
						</ItemContent>
						<ItemActions>
							<Button variant="outline" size="xs" onClick={() => s.openSettings("agents", id)}><SettingsIcon data-icon="inline-start" />Settings</Button>
						</ItemActions>
					</Item>
					<div className={cn("flex flex-wrap gap-1.5", INSET)}>
						<AgentFacts agent={info} mainId={store.agents.find((a) => a.main)?.id} pick={{ model: () => void s.pickModel(tab), reasoning: () => void s.pickReasoning(tab), mode: () => void s.pickMode(tab) }} />
					</div>
				</header>

				{tab.busy || helpers.length || elsewhere.length ? (
					<AgentSection title="At work">
						<ItemGroup>
							{tab.busy ? <AgentRow media={<Pulse />} title="this conversation" about={`${tab.thinking ? "thinking" : "working"}${tab.toolCalls ? ` · ${plural(tab.toolCalls, "tool call")}` : ""}`} /> : null}
							{helpers.map(([task, c]) => <AgentRow key={task} media={c.running ? <Pulse /> : <CheckIcon />} title={c.agent} about={`${childKind(c.kind)} #${task}: ${c.label}`} onOpen={() => void s.openTask(task)} />)}
							{elsewhere.map((session) => <AgentRow key={session} media={<Pulse />} title={session} about={`another conversation with ${id}`} onOpen={() => void s.openTab(id, session)} />)}
						</ItemGroup>
					</AgentSection>
				) : null}

				<AgentSection title="Skills" manage={manage("skills")} {...state(skills)} empty={knows.length ? undefined : `No skills. Ask ${id} to “make a skill of this”.`}>
					<ItemGroup>
						{knows.map((x) => <AgentRow key={x.dir} media={<BookIcon />} title={x.name} about={x.description || undefined} tag={forWhom(x.scope === "global" ? "global" : id, x.session)} onOpen={() => openThing({ kind: "skill", skill: x })} />)}
					</ItemGroup>
				</AgentSection>

				{/* Shown only when there is one: most agents have none, and a row that says so every time is noise. */}
				{loads.length ? (
					<AgentSection title="Extensions" manage={manage("extensions")}>
						<ItemGroup>
							{loads.map((x) => <AgentRow key={`${x.agent ?? ""}:${x.source}`} media={<BlocksIcon />} title={x.name} about={x.description || x.version || undefined} tag={forWhom(x.scope === "global" ? "global" : id)} onOpen={() => openThing({ kind: "extension", extension: x })} />)}
						</ItemGroup>
					</AgentSection>
				) : null}

				<AgentSection title="MCP servers" manage={manage("mcp")} {...state(servers)} empty={tools.length ? undefined : "No MCP servers."}>
					<ItemGroup>
						{tools.map((x) => (
							<AgentRow
								key={`${x.scope}:${x.name}`}
								media={<PlugIcon />}
								title={x.name}
								about={x.target || undefined}
								tag={forWhom(x.scope, x.session)}
								onOpen={() => goTo(x.scope === "global" ? { section: "mcp", find: `[data-find="mcp:global:${x.name}"]` } : { section: "agents", agent: id, find: `[data-find="mcp:${x.scope}:${x.name}"]` })}
							/>
						))}
					</ItemGroup>
				</AgentSection>

				<AgentSection
					title="Sources"
					manage={manage("sources")}
					{...state(sources)}
					empty={listens.length ? undefined : `Nothing wakes ${id} yet. ${could > 0 ? `It could listen to ${plural(could, "source")}: ask it to watch one, or press Manage.` : "Ask it to watch something, such as “tell me when a file lands in ~/Scans”."}`}
				>
					<ItemGroup>
						{listens.map((x) => (
							<AgentRow
								key={x.name}
								media={<ZapIcon />}
								title={x.name}
								about={(x.local ?? x.agent ?? x.global)?.note || x.description || x.type}
								tag={x.local ? "this conversation" : x.agent ? undefined : "all agents"}
								// Its row on the agent's page, which lists the agent's own sources and the shared ones it listens to.
								onOpen={() => goTo({ section: "agents", agent: id, find: `[data-find^="source:"][data-find$=":${x.name}"]` })}
							/>
						))}
					</ItemGroup>
				</AgentSection>

				<AgentSection title="Schedules" manage={manage("schedules")} {...state(schedules)} empty={timed.length ? undefined : `Nothing is scheduled. Ask ${id}, for example “every morning at seven…”.`}>
					<ItemGroup>
						{timed.map((x) => <AgentRow key={`${x.scope}:${x.name}`} media={<ClockIcon />} title={x.name} about={`${whenShort(x)}${x.task ? ` · ${oneLine(x.task)}` : ""}`} tag={forWhom(x.scope, x.session)} onOpen={() => openThing({ kind: "schedule", schedule: x })} />)}
					</ItemGroup>
				</AgentSection>

				{/* Most agents have no route: the part is there only when one concerns this agent. */}
				{ruled.length ? (
					<AgentSection title="Routes" manage={manage("routes")}>
						<ItemGroup>
							{ruled.map((r) => {
								const said = routeSaid(r);
								return <AgentRow key={r.name} media={<GitBranchIcon />} title={r.name} about={`when ${said.when}: ${said.then}`} onOpen={() => openThing({ kind: "route", route: r })} />;
							})}
						</ItemGroup>
					</AgentSection>
				) : null}

				{/* The agent's own files, as on its page in Settings: read, changed and saved here too. */}
				<AgentSection title="Instructions" manage={manage("instructions")} error={state(detail).error}>
					<div className={INSET}>
						{detail.data ? <AgentFiles id={id} files={detail.data.files} texts={texts} onText={(key, v) => setTexts((was) => ({ ...was, [key]: v }))} onSave={() => void save()} /> : <FilesSkeleton />}
					</div>
				</AgentSection>

				{detail.data ? (
					<AgentSection title="Workspace">
						<AgentRow
							media={<FolderIcon />}
							title={<span className="min-w-0 truncate" title={detail.data.workspace}>{tilde(detail.data.workspace)}</span>}
							about={tab.folder ? "The Files tab shows this conversation's folder instead." : "The Files tab shows it."}
							onOpen={store.remote ? undefined : () => void bridge.reveal(detail.data!.workspace)}
						/>
					</AgentSection>
				) : null}
				{/* While a file is changed, the way to keep it stays in sight at the foot of the tab. */}
				{unsaved.length ? <UnsavedBar busy={busy} discard={() => setTexts({})} save={() => void save()}>Unsaved: {unsaved.map((f) => f.name).join(", ")}</UnsavedBar> : null}
			</div>
		</ScrollArea>
	);
}
