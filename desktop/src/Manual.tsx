// pine's manual, for the owner to read: the same docs/ the agents search with their `manual` tool (src/manual.ts),
// handed over by the daemon (`GET /manual`, `/manual/chapter`, `/manual/search`). The chapters and their sub
// chapters on the left, the chapter in the middle, what is on this page on the right; the search at the top of
// the left column looks through all of it as an agent's search does. The text is pine's own docs, drawn by
// `markdown.tsx` like an answer, with its links to other files of the manual followed inside this tab.
import { BookOpenIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sidebar as SidebarRoot, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { api, type ManualChapter, type ManualHit, type ManualText } from "./api.ts";
import { Markdown } from "./markdown.tsx";
import { store, useModel, useSignal } from "./model.ts";
import { useLoad } from "./use-load.ts";

/** A link of the manual's own, to one of its files or a heading in one ("sources.md#a-first-example", "../SKILL.md", "#modes"). */
const OWN_LINK = /^(?:(?:\.\.?\/)*(?:references\/)?[A-Za-z0-9-]+\.md)?(?:#[^#\s]+)?$/;

/** Letters and digits alone: a heading's anchor as GitHub writes it and as the manual cuts it compare the same. */
const bare = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Where a link of the manual leads: the chapter (its file's name; SKILL.md is the index, "pine") and the section in it. */
function resolve(href: string, here: string, book: ManualChapter[] | undefined, text: ManualText | undefined): { chapter: string; section?: string } | undefined {
	const [file, anchor] = href.split("#");
	const name = file ? file.split("/").at(-1)!.replace(/\.md$/, "") : here;
	const chapter = name === "SKILL" ? "pine" : name;
	if (book && !book.some((c) => c.id === chapter)) return undefined;
	if (!anchor) return { chapter };
	const exact = `${chapter}#${anchor}`;
	const sections = chapter === text?.id ? text.sections.map((x) => ({ id: x.id, title: x.title })) : (book?.find((c) => c.id === chapter)?.sections.flatMap((x) => [x, ...x.sections]) ?? []);
	const found = sections.find((x) => x.id === exact) ?? sections.find((x) => bare(x.title) === bare(anchor));
	return { chapter, section: found?.id ?? exact };
}

/** The line a search matched, as words: the table's bars and the code marks of Markdown taken out. */
const plainLine = (line: string) => line.replace(/`/g, "").replace(/\s*\|\s*/g, " · ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();

export function Manual() {
	const s = useModel(store);
	const at = s.manualAt;
	const book = useLoad(() => api.manual(), []);
	const chapters = book.data;
	const chapterId = chapters && !chapters.some((c) => c.id === at.chapter) ? chapters[0]?.id ?? at.chapter : at.chapter;
	const text = useLoad(() => api.manualChapter(chapterId), [chapterId]);
	const shown = text.data?.id === chapterId ? text.data : undefined;
	const [query, setQuery] = useState("");
	const searching = query.trim() !== "";
	const [hits, setHits] = useState<{ q: string; list: ManualHit[] }>();
	const [current, setCurrent] = useState<string>();
	const [open, setOpen] = useState<Set<string>>(() => new Set([at.chapter]));
	// The search is in the left column where there is room and above the text where there is not: two fields, one shown.
	const wide = useRef<HTMLInputElement>(null);
	const narrow = useRef<HTMLInputElement>(null);
	const field = () => (wide.current?.offsetParent ? wide.current : narrow.current);
	const root = useRef<HTMLDivElement>(null);
	const nav = useRef<HTMLDivElement>(null);
	const page = useRef<HTMLDivElement>(null);

	// ⌘F (the menu's Find) searches the manual while it is in front.
	useSignal("find", () => (field()?.focus(), field()?.select()));

	// The search asks the daemon once the typing pauses; what it found stays until the next answer.
	useEffect(() => {
		const q = query.trim();
		if (!q) return setHits(undefined);
		let live = true;
		const t = setTimeout(() => void api.manualSearch(q).then((list) => live && setHits({ q, list }), () => live && setHits({ q, list: [] })), 150);
		return () => ((live = false), clearTimeout(t));
	}, [query]);

	// The chapter in front is open in the list on the left, and in sight there.
	// Block bodies: a newer Chromium's scrollIntoView returns a promise, which React would take for the effect's clean-up.
	useEffect(() => {
		setOpen((o) => (o.has(chapterId) ? o : new Set(o).add(chapterId)));
	}, [chapterId]);
	useEffect(() => {
		void nav.current?.querySelector(`[data-chapter="${CSS.escape(chapterId)}"]`)?.scrollIntoView({ block: "nearest" });
	}, [chapterId, Boolean(chapters)]);

	const viewport = () => page.current?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]") ?? undefined;

	// Once the chapter is drawn, it is shown where the move asked: a section, the row of a table in it, or its top.
	useEffect(() => {
		if (searching || !shown) return;
		const view = viewport();
		if (!view) return;
		const section = at.section ? view.querySelector<HTMLElement>(`[data-part="${CSS.escape(at.section)}"]`) : null;
		if (!section) {
			view.scrollTop = 0;
			setCurrent(undefined);
			return;
		}
		section.scrollIntoView({ block: "start" });
		setCurrent(at.section);
		if (!at.row) return;
		const row = [...section.querySelectorAll<HTMLElement>("tr")].find((tr) => tr.querySelector("td")?.textContent?.trim() === at.row);
		if (!row) return;
		row.scrollIntoView({ block: "center" });
		row.setAttribute("data-found", "");
		const t = setTimeout(() => row.removeAttribute("data-found"), 1600);
		return () => clearTimeout(t);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [at.n, shown, searching]);

	// What is on the page follows the reading: the last section whose top has passed the top of the page.
	useEffect(() => {
		const view = viewport();
		if (!view || searching || !shown) return;
		let frame = 0;
		const look = () => {
			frame = 0;
			const top = view.getBoundingClientRect().top + 24;
			let last: string | undefined;
			for (const el of view.querySelectorAll<HTMLElement>("[data-part]")) {
				if (el.getBoundingClientRect().top > top) break;
				last = el.dataset.part;
			}
			setCurrent(last === chapterId ? undefined : last);
		};
		const onScroll = () => (frame ||= requestAnimationFrame(look));
		view.addEventListener("scroll", onScroll, { passive: true });
		return () => (view.removeEventListener("scroll", onScroll), cancelAnimationFrame(frame));
	}, [shown, searching, chapterId]);

	const go = (to: { chapter: string; section?: string; row?: string }) => (setQuery(""), store.openManual(to));
	const follow = useMemo(() => ({ can: (href: string) => OWN_LINK.test(href), go: (href: string) => {
		const to = resolve(href, chapterId, chapters, shown);
		if (to) go(to);
		else store.flash("That file is not a part of the manual.", "muted");
	} }), [chapterId, chapters, shown]);
	const pick = (h: ManualHit) => go({ chapter: h.chapter, section: h.section, row: h.row ? h.title : undefined });
	const keys = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter" && hits?.list[0]) (e.preventDefault(), pick(hits.list[0]));
		else if (e.key === "ArrowDown") (e.preventDefault(), root.current?.querySelector<HTMLElement>("[data-result]")?.focus());
		else if (e.key === "Escape" && query) (e.preventDefault(), e.stopPropagation(), setQuery(""));
	};
	const index = chapters?.findIndex((c) => c.id === chapterId) ?? -1;
	const before = index > 0 ? chapters![index - 1] : undefined;
	const after = index >= 0 ? chapters![index + 1] : undefined;
	const titleOf = (id: string) => chapters?.find((c) => c.id === id)?.title ?? id;
	// Within a sub chapter, the sub chapter is marked on the left; within one of its parts, that part on the right.
	const sub = (id?: string) => (id ? chapters?.find((c) => c.id === chapterId)?.sections.find((x) => x.id === id || x.sections.some((y) => y.id === id))?.id : undefined);

	// Three columns where there is room (measured on the manual itself, not the window): the chapters, the
	// text, what is on this page. Narrower, the page's own list goes first, then the chapters become a choice above the text.
	return (
		<div ref={root} data-slot="manual" className="@container/manual flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border bg-background text-sm **:data-found:outline-2 **:data-found:-outline-offset-2 **:data-found:outline-ring">
			<SidebarProvider open className="min-h-0 w-full min-w-0 flex-1">
				<SidebarRoot collapsible="none" className="hidden w-64 flex-none border-r @3xl/manual:flex">
					<SidebarHeader className="px-2 pt-4 pb-0">
						<Search field={wide} query={query} setQuery={setQuery} keys={keys} />
					</SidebarHeader>
					<SidebarContent>
						<ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade">
							<div ref={nav} role="navigation" aria-label="Chapters">
								{chapters ? (
									partsOf(chapters).map((part) => (
										<SidebarGroup key={part.title ?? ""}>
											{part.title ? <SidebarGroupLabel>{part.title}</SidebarGroupLabel> : null}
											<SidebarGroupContent>
												<SidebarMenu>
													{part.chapters.map((c) => (
														<Collapsible key={c.id} open={open.has(c.id)} onOpenChange={(now) => setOpen((o) => { const n = new Set(o); if (now) n.add(c.id); else n.delete(c.id); return n; })} render={<SidebarMenuItem data-chapter={c.id} />}>
																<SidebarMenuButton isActive={!searching && c.id === chapterId && !sub(current)} aria-current={!searching && c.id === chapterId ? "page" : undefined} title={c.title} onClick={() => go({ chapter: c.id })}>
																	<span className="truncate">{c.title}</span>
																</SidebarMenuButton>
																{c.sections.length ? (
																	<>
																		<CollapsibleTrigger render={<SidebarMenuAction className="data-panel-open:rotate-90" aria-label={`${open.has(c.id) ? "Hide" : "Show"} the parts of ${c.title}`} />}>
																			<ChevronRightIcon />
																		</CollapsibleTrigger>
																		<CollapsibleContent>
																			<SidebarMenuSub>
																				{c.sections.map((x) => (
																					<SidebarMenuSubItem key={x.id}>
																						<SidebarMenuSubButton render={<button type="button" />} isActive={!searching && c.id === chapterId && sub(current) === x.id} title={x.title} onClick={() => go({ chapter: c.id, section: x.id })}>
																							<span className="truncate">{x.title}</span>
																						</SidebarMenuSubButton>
																					</SidebarMenuSubItem>
																				))}
																			</SidebarMenuSub>
																		</CollapsibleContent>
																	</>
																) : null}
															</Collapsible>
													))}
												</SidebarMenu>
											</SidebarGroupContent>
										</SidebarGroup>
									))
								) : (
									<SidebarGroup>
										<SidebarGroupContent>
											<SidebarMenu>{Array.from({ length: 12 }, (_, i) => <SidebarMenuItem key={i}><SidebarMenuSkeleton /></SidebarMenuItem>)}</SidebarMenu>
										</SidebarGroupContent>
									</SidebarGroup>
								)}
							</div>
						</ScrollArea>
					</SidebarContent>
				</SidebarRoot>
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					{/* Narrower than three columns: the search and the chapter as a choice, above the text. */}
					<div className="flex flex-none flex-wrap items-center gap-2 border-b px-3 py-2.5 @3xl/manual:hidden">
						<Search field={narrow} query={query} setQuery={setQuery} keys={keys} className="max-w-72 min-w-40 flex-1" />
						{chapters ? (
							<Select value={chapterId} onValueChange={(v) => v && go({ chapter: v })} items={chapters.map((c) => ({ value: c.id, label: c.title }))}>
								<SelectTrigger aria-label="Chapter" className="max-w-72 min-w-40 flex-1"><SelectValue /></SelectTrigger>
								<SelectContent>
									{partsOf(chapters).map((part) => (
										<SelectGroup key={part.title ?? ""}>
											{part.title ? <SelectLabel>{part.title}</SelectLabel> : null}
											{part.chapters.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
										</SelectGroup>
									))}
								</SelectContent>
							</Select>
						) : <Skeleton className="h-8 w-48" />}
					</div>
					<div className="flex min-h-0 min-w-0 flex-1">
						<ScrollArea ref={page} className="flex min-h-0 min-w-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade" key={searching ? "search" : "text"}>
							{searching ? (
								<Found query={query} hits={hits} titleOf={titleOf} pick={pick} back={() => field()?.focus()} />
							) : book.error || text.error ? (
								<Empty className="h-full">
									<EmptyHeader>
										<EmptyMedia variant="icon"><BookOpenIcon /></EmptyMedia>
										<EmptyTitle>The manual did not load</EmptyTitle>
										<EmptyDescription>{book.error ?? text.error}</EmptyDescription>
									</EmptyHeader>
								</Empty>
							) : shown ? (
								// An answer may break a word anywhere, to stay in a narrow column; the manual's tables keep a word whole ("token", not "toke n").
								<article data-slot="manual-chapter" className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-8 pb-10 text-read select-text @lg/manual:px-10 [&_table]:wrap-break-word [&_table_:is(a,code)]:wrap-break-word">
									{shown.sections.map((x) => (
										<section key={x.id} data-part={x.id} className="scroll-mt-4">
											<Markdown text={`${"#".repeat(Math.min(x.level, 3))} ${x.title}\n\n${x.text}`} follow={follow} />
										</section>
									))}
									<nav aria-label="Other chapters" className="mt-8 flex flex-wrap justify-between gap-2">
										{before ? <Button variant="outline" onClick={() => go({ chapter: before.id })}><ChevronLeftIcon data-icon="inline-start" /><span className="truncate">{before.title}</span></Button> : <span />}
										{after ? <Button variant="outline" onClick={() => go({ chapter: after.id })}><span className="truncate">{after.title}</span><ChevronRightIcon data-icon="inline-end" /></Button> : null}
									</nav>
								</article>
							) : (
								<div aria-busy="true" aria-label="Loading the chapter" className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 pt-8 @lg/manual:px-10">
									<Skeleton className="h-8 w-2/3" />
									{["w-full", "w-11/12", "w-4/5", "w-full", "w-3/5"].map((w, i) => <Skeleton key={i} className={cn("h-4", w)} />)}
								</div>
							)}
						</ScrollArea>
						{/* What is on this page, where there is room for it beside the text. */}
						{!searching && shown && shown.sections.length > 1 ? (
							<nav aria-label="On this page" className="hidden w-56 flex-none flex-col border-l @5xl/manual:flex">
								<ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade">
									<SidebarGroup className="pt-6">
										<SidebarGroupLabel>On this page</SidebarGroupLabel>
										<SidebarGroupContent>
											<SidebarMenu>
												{(chapters?.find((c) => c.id === chapterId)?.sections ?? []).map((x) => (
													<SidebarMenuItem key={x.id}>
														<SidebarMenuButton size="sm" isActive={current === x.id} title={x.title} onClick={() => go({ chapter: chapterId, section: x.id })}>
															<span className="truncate">{x.title}</span>
														</SidebarMenuButton>
														{x.sections.length ? (
															<SidebarMenuSub>
																{x.sections.map((y) => (
																	<SidebarMenuSubItem key={y.id}>
																		<SidebarMenuSubButton render={<button type="button" />} size="sm" isActive={current === y.id} title={y.title} onClick={() => go({ chapter: chapterId, section: y.id })}>
																			<span className="truncate">{y.title}</span>
																		</SidebarMenuSubButton>
																	</SidebarMenuSubItem>
																))}
															</SidebarMenuSub>
														) : null}
													</SidebarMenuItem>
												))}
											</SidebarMenu>
										</SidebarGroupContent>
									</SidebarGroup>
								</ScrollArea>
							</nav>
						) : null}
					</div>
				</div>
			</SidebarProvider>
		</div>
	);
}

function Search({ field, query, setQuery, keys, className }: { field: React.RefObject<HTMLInputElement | null>; query: string; setQuery: (q: string) => void; keys: (e: React.KeyboardEvent<HTMLInputElement>) => void; className?: string }) {
	return (
		<InputGroup className={className}>
			<InputGroupAddon>
				<SearchIcon />
			</InputGroupAddon>
			<InputGroupInput ref={field} type="search" aria-label="Search the manual" placeholder="Search the manual" data-slot="manual-search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={keys} />
		</InputGroup>
	);
}

/** What a search found, the best first: where each part stands and the line of it that matched. */
function Found({ query, hits, titleOf, pick, back }: { query: string; hits?: { q: string; list: ManualHit[] }; titleOf: (id: string) => string; pick: (h: ManualHit) => void; back: () => void }) {
	// Up and down go from one to the next; up from the first goes back to the field.
	const move = (e: React.KeyboardEvent<HTMLDivElement>) => {
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
		const all = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-result]")];
		const at = all.indexOf(document.activeElement as HTMLElement);
		e.preventDefault();
		if (e.key === "ArrowUp" && at <= 0) return back();
		all[Math.min(all.length - 1, e.key === "ArrowDown" ? at + 1 : at - 1)]?.focus();
	};
	return (
		<div data-slot="manual-results" className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-8 pb-10 @lg/manual:px-10">
			<header className="flex flex-col gap-1">
				<h1 className="text-xl font-semibold tracking-tight">{`“${query.trim()}”`}</h1>
				{hits?.list.length ? <p className="text-muted-foreground">The parts of the manual that fit best. Pick one to read it.</p> : null}
			</header>
			{!hits ? (
				<ItemGroup aria-busy="true" aria-label="Searching the manual">
					{[0, 1, 2].map((i) => (
						<Item key={i} variant="outline" size="sm">
							<ItemContent className="gap-2">
								<Skeleton className="h-4 w-40" />
								<Skeleton className="h-3.5 w-3/4" />
							</ItemContent>
						</Item>
					))}
				</ItemGroup>
			) : hits.list.length ? (
				<ItemGroup onKeyDown={move}>
					{hits.list.map((h) => (
						<Item key={h.id} data-result={h.id} variant="outline" size="sm" render={<button type="button" />} onClick={() => pick(h)}>
							<ItemContent className="min-w-0">
								<ItemTitle className="flex-wrap">{h.title}</ItemTitle>
								<ItemDescription className="line-clamp-1">{[titleOf(h.chapter), ...h.where.split(" › ").slice(1)].filter(Boolean).join(" › ")}</ItemDescription>
								<ItemDescription className="line-clamp-2">{plainLine(h.line)}</ItemDescription>
							</ItemContent>
						</Item>
					))}
				</ItemGroup>
			) : (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon"><SearchIcon /></EmptyMedia>
						<EmptyTitle>Nothing in the manual fits</EmptyTitle>
						<EmptyDescription>Try other words: the manual says "event source" for what watches something, "schedule" for what happens at a time, "approval" for what asks you. You can also ask the main agent.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			)}
		</div>
	);
}

/** The chapters in the parts of the manual the index names ("Start here", "Reference"), in their order; a chapter of no part stands alone. */
function partsOf(chapters: ManualChapter[]): Array<{ title?: string; chapters: ManualChapter[] }> {
	const parts: Array<{ title?: string; chapters: ManualChapter[] }> = [];
	for (const c of chapters) {
		const last = parts.at(-1);
		if (last && last.title === c.group) last.chapters.push(c);
		else parts.push({ title: c.group, chapters: [c] });
	}
	return parts;
}
