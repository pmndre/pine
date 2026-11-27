// The event log: everything pine publishes, as it happens. A line is a collapsible: it opens, by click or key, to its whole payload.
import { AudioLinesIcon, CircleAlertIcon, PlayIcon, SearchIcon, SquareIcon, Trash2Icon, ZapIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from "@/components/ui/message-scroller";
import { HoverTooltip } from "@/components/hover-tooltip";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Printed } from "@/components/printed";
import { useEffect, useState } from "react";
import type { PineEvent } from "./api.ts";
import { store, type Tab, useModel } from "./model.ts";
import { short } from "./text.ts";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** "agent/#" fits every topic under agent; "+" fits one level; a word without either is looked for anywhere. */
function fits(pattern: string, e: PineEvent): boolean {
	const p = pattern.trim();
	if (!p) return true;
	if (!/[#+/]/.test(p)) return e.topic.includes(p) || e.source.includes(p) || JSON.stringify(e.payload ?? "").includes(p);
	const want = p.split("/");
	const have = e.topic.split("/");
	for (let i = 0; i < want.length; i++) {
		if (want[i] === "#") return true;
		if (have[i] === undefined || (want[i] !== "+" && want[i] !== have[i])) return false;
	}
	return want.length === have.length;
}

export function Events({ tab }: { tab: Tab }) {
	useModel(tab);
	const [filter, setFilter] = useState(tab.logFilter);
	const [open, setOpen] = useState<number>();
	const [paused, setPaused] = useState(false);
	const [frozen, setFrozen] = useState<PineEvent[]>([]);
	const source = paused ? frozen : tab.log;
	const shown = source.filter((e) => fits(filter, e)).slice(-600);
	useEffect(() => {
		tab.logFilter = filter;
	}, [filter, tab]);
	return (
		<div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background text-sm">
			<div className="flex flex-none flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2.5">
				<InputGroup className="max-w-90">
					<InputGroupAddon>
						<SearchIcon />
					</InputGroupAddon>
					<InputGroupInput aria-label="Filter the events" placeholder="Filter by word or topic (agent/#)" value={filter} onChange={(e) => setFilter(e.target.value)} spellCheck={false} />
				</InputGroup>
				<span className="truncate text-faint">{shown.length} shown · text deltas are hidden</span>
				<span className="min-w-0 flex-1" />
				<Button variant="outline" size="xs" onClick={() => (setFrozen([...tab.log]), setPaused(!paused))}>{paused ? <PlayIcon data-icon="inline-start" /> : <SquareIcon data-icon="inline-start" />}{paused ? "Follow" : "Pause"}</Button>
				<Button variant="outline" size="xs" data-action="publish" onClick={() => store.setPublishing(true)}><ZapIcon data-icon="inline-start" />Publish…</Button>
				<HoverTooltip>
					<TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Clear the view" onClick={() => ((tab.log = []), tab.touch())} />}><Trash2Icon /></TooltipTrigger>
					<TooltipContent>Clear the view</TooltipContent>
				</HoverTooltip>
			</div>
			{/* The log follows its end while it is scrolled to there, and holds still while a line is open. Each line
			    is an item of the scroller, held at a line's height (not a message's) while it is out of sight. */}
			<MessageScrollerProvider autoScroll={open === undefined} defaultScrollPosition="end">
				<MessageScroller className="flex-1">
					<MessageScrollerViewport data-log="events" aria-label="Events">
						<MessageScrollerContent className="cursor-auto gap-0 py-1.5 font-mono text-xs select-text">
							{shown.length ? (
								shown.map((e, i) => (
									<MessageScrollerItem key={`${e.id}:${e.ts}:${i}`} className="[contain-intrinsic-size:auto_1.5rem]">
										<Collapsible open={open === i} onOpenChange={(now) => setOpen(now ? i : undefined)}>
											<CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-0.5 text-start whitespace-nowrap outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset data-panel-open:bg-accent">
												<span className="flex-none text-faint">{new Date(e.ts).toLocaleTimeString("sv-SE")}</span>
												<Badge variant={e.trust === "owner" ? "default" : "outline"} className="w-14">{e.trust === "owner" ? "owner" : "other"}</Badge>
												<span className="flex-none font-semibold">{e.topic}</span>
												<span className="truncate text-muted-foreground">{short(JSON.stringify(e.payload ?? null), 220)}</span>
											</CollapsibleTrigger>
											<CollapsibleContent>
												<Printed sm text={`#${e.id} · from ${e.source}\n${JSON.stringify(e.payload ?? null, null, 2)}`} className="mr-4 mb-1.5 ml-20" />
											</CollapsibleContent>
										</Collapsible>
									</MessageScrollerItem>
								))
							) : (
								// Nothing to list: the skeleton at the top, an empty state over the whole log.
								<MessageScrollerItem className={cn(!(tab.logLoading && !tab.log.length) && "flex flex-1 flex-col")}>
									{tab.logLoading && !tab.log.length ? (
										<EventLines skeleton />
									) : tab.logError && !tab.log.length ? (
										<Empty><EmptyHeader><EmptyMedia variant="icon"><CircleAlertIcon /></EmptyMedia><EmptyTitle>Could not load the events</EmptyTitle><EmptyDescription>{tab.logError}</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" size="xs" onClick={() => void store.fillEvents(tab)}>Try again</Button></EmptyContent></Empty>
									) : (
										<Empty><EmptyHeader><EmptyMedia variant="icon"><AudioLinesIcon /></EmptyMedia><EmptyTitle>{tab.log.length ? "No events match the filter" : "No events yet"}</EmptyTitle><EmptyDescription>Messages, tool calls, sources, schedules and approvals all appear here.</EmptyDescription></EmptyHeader></Empty>
									)}
								</MessageScrollerItem>
							)}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					<MessageScrollerButton />
				</MessageScroller>
			</MessageScrollerProvider>
		</div>
	);
}

/** The log's lines while its first fetch is out: rows of a line's shape (time, badge, topic, payload). */
export function EventLines(_: { skeleton: true }) {
	const widths = ["w-2/5", "w-3/5", "w-1/3", "w-1/2", "w-2/3", "w-1/4", "w-1/2", "w-3/5"];
	return (
		<div aria-busy="true" aria-label="Loading the events">
			{widths.map((w, i) => (
				<div key={i} className="flex items-center gap-3 px-4 py-1">
					<Skeleton className="h-3 w-14 flex-none" />
					<Skeleton className="h-4 w-14 flex-none rounded-full" />
					<Skeleton className="h-3 w-28 flex-none" />
					<Skeleton className={cn("h-3", w)} />
				</div>
			))}
		</div>
	);
}
