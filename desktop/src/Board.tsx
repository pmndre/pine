// The Board tab of the panel beside a conversation: the tasks and notes that the conversation, its
// sub-agents and the agents it hands work to share (docs/references/boards.md). The owner sees who
// has which task and what was found, adds a task, takes one back, answers one that waits for them.
// Everything is read and changed through the control API. What is on a board was written by agents
// (and can repeat outside content): it is drawn as plain text, never as markup.
import { CircleCheckIcon, CircleHelpIcon, CircleIcon, CircleXIcon, ClipboardListIcon, EllipsisIcon, HourglassIcon, PlusIcon, SendIcon, StickyNoteIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Pulse } from "@/components/pulse";
import { api, type BoardBrief, type BoardItem, type BoardView } from "./api.ts";
import { store, type Tab, useModel } from "./model.ts";
import { plural } from "./text.ts";
import { useLoad } from "./use-load.ts";

const SUB = "flex min-h-9 flex-none items-center gap-1.5 border-b border-line-soft px-2.5 py-1.5 text-sm text-muted-foreground";

/** A board as the owner calls it. */
export const boardLabel = (b: BoardBrief) => (b.scope === "global" ? `${b.name} · all agents` : b.scope === "agent" ? `${b.name} · all of ${b.agent}'s conversations` : b.name || "This conversation");

/** Where a task stands, in a few words. */
export function taskLine(t: BoardItem): string {
	if (t.state === "taken") return t.sub ? `A sub-agent of ${t.holder ?? "the agent"} is working on it` : `${t.holder ?? "An agent"} is working on it`;
	if (t.state === "open") return t.waits.length ? `Waiting for ${t.waits.map((w) => `#${w}`).join(", ")}` : "Open";
	return t.state === "done" ? "Done" : t.state === "failed" ? "Failed" : "Waiting for an answer";
}

function TaskIcon({ task }: { task: BoardItem }) {
	if (task.state === "taken") return <Pulse label="In progress" className="bg-primary" />;
	if (task.state === "done") return <CircleCheckIcon className="text-primary" />;
	if (task.state === "failed") return <CircleXIcon className="text-destructive" />;
	if (task.state === "blocked") return <CircleHelpIcon className="text-warn" />;
	return task.waits.length ? <HourglassIcon className="text-faint" /> : <CircleIcon className="text-faint" />;
}

/** One line to type into, with a button: a task to add, an answer to give. */
function Entry({ entry, label, placeholder, icon: Icon, send }: { entry: "answer" | "add"; label: string; placeholder: string; icon: typeof PlusIcon; send: (text: string) => Promise<unknown> | void }) {
	const [text, setText] = useState("");
	const go = () => {
		const said = text.trim();
		if (!said) return;
		setText("");
		void send(said);
	};
	return (
		<InputGroup>
			<InputGroupInput data-entry={entry} aria-label={label} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && go()} />
			<InputGroupAddon align="inline-end">
				<InputGroupButton size="icon-xs" aria-label={label} disabled={!text.trim()} onClick={go}>
					<Icon />
				</InputGroupButton>
			</InputGroupAddon>
		</InputGroup>
	);
}

/** The fields of a note or a task, each as a small label: what agents compare without reading prose. */
/** Task numbers the way a person writes them: "2–7, 9". */
export function spans(ids: number[]): string {
	const sorted = [...new Set(ids)].sort((a, b) => a - b);
	const out: string[] = [];
	for (let i = 0; i < sorted.length; i++) {
		let j = i;
		while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
		out.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
		i = j;
	}
	return out.join(", ");
}

/** A field as words: the tasks a pool's note came with are said as "for tasks 2–7", everything else as it is. */
function fieldText(k: string, v: unknown): string {
	if (k === "tasks" && Array.isArray(v) && v.every((x) => typeof x === "number")) return `for task${v.length === 1 ? "" : "s"} ${spans(v as number[])}`;
	// An answer says which question it answers.
	if (k === "question" && typeof v === "string") return `answers: ${v}`;
	return `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`;
}

function Fields({ data }: { data?: Record<string, unknown> }) {
	const fields = Object.entries(data ?? {}).slice(0, 8);
	if (!fields.length) return null;
	return (
		<span className="flex flex-wrap gap-1">
			{fields.map(([k, v]) => (
				<Badge variant="outline" key={k} className="max-w-full">
					<span className="truncate font-mono">{fieldText(k, v)}</span>
				</Badge>
			))}
		</span>
	);
}

export interface BoardActions {
	post(text: string): Promise<unknown> | void;
	act(item: number, action: "reopen" | "answer" | "done" | "remove", text?: string): Promise<unknown> | void;
}

/** What is on a board: its tasks, each with where it stands and what the owner can do with it, then the notes. */
export function BoardList({ view, actions }: { view: BoardView; actions: BoardActions }) {
	const [open, setOpen] = useState<Set<number>>(new Set());
	const toggle = (id: number) => setOpen((was) => new Set(was.has(id) ? [...was].filter((x) => x !== id) : [...was, id]));
	const notesOf = (task: number) => view.notes.filter((n) => n.about === task);
	const loose = view.notes.filter((n) => n.about === undefined || !view.tasks.some((t) => t.id === n.about));
	return (
		<ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade">
			<div className="flex min-h-full flex-col gap-3 p-2">
				{view.tasks.length ? (
					<ItemGroup data-slot="board-tasks">
						{view.tasks.map((t) => {
							const shown = open.has(t.id) || t.state === "blocked";
							const about = notesOf(t.id);
							const result = t.result ? <p className="whitespace-pre-wrap text-muted-foreground select-text">{t.result}</p> : null;
							return (
								<Item size="sm" key={t.id} data-task={t.id} data-state={t.state} data-by={t.by}>
									<ItemMedia variant="icon">
										<TaskIcon task={t} />
									</ItemMedia>
									{/* The task's text opens the rest of it, by a click or the keyboard. A task that waits for the owner stays open. */}
									<Collapsible open={shown} onOpenChange={() => t.state !== "blocked" && toggle(t.id)} render={<ItemContent />}>
										<CollapsibleTrigger nativeButton={false} render={<ItemTitle className="w-full cursor-default rounded-sm text-left outline-none select-text focus-visible:ring-3 focus-visible:ring-ring/50" />}>
											<span className={shown ? "whitespace-pre-wrap" : "line-clamp-2"}>
												<span className="text-faint">#{t.id}</span> {t.text}
											</span>
										</CollapsibleTrigger>
										<ItemDescription>
											{taskLine(t)}
											{t.by === "owner" ? " · yours" : null}
											{about.length ? ` · ${plural(about.length, "note")}` : null}
										</ItemDescription>
										{t.outside ? <Badge variant="outline">from outside content</Badge> : null}
										<CollapsibleContent className="flex flex-col gap-1">
											<Fields data={t.data} />
											{result}
											{about.map((n) => <Note note={n} key={n.id} />)}
										</CollapsibleContent>
										{!shown && t.state === "failed" ? result : null}
										{t.state === "blocked" ? <Entry entry="answer" label={`Answer task ${t.id}`} placeholder="Your answer" icon={SendIcon} send={(text) => actions.act(t.id, "answer", text)} /> : null}
									</Collapsible>
									<ItemActions>
										<DropdownMenu>
											<DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" data-action="task-menu" aria-label={`Actions for task ${t.id}`} />}>
												<EllipsisIcon />
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuGroup>
													{t.state === "taken" ? <DropdownMenuItem onClick={() => void actions.act(t.id, "reopen")}>Take it back</DropdownMenuItem> : null}
													{t.state === "done" || t.state === "failed" || t.state === "blocked" ? <DropdownMenuItem onClick={() => void actions.act(t.id, "reopen")}>Reopen</DropdownMenuItem> : null}
													{t.state !== "done" ? <DropdownMenuItem onClick={() => void actions.act(t.id, "done")}>Mark as done</DropdownMenuItem> : null}
												</DropdownMenuGroup>
												<DropdownMenuSeparator />
												<DropdownMenuGroup>
													<DropdownMenuItem variant="destructive" data-action="remove" onClick={() => void actions.act(t.id, "remove")}>
														Remove
													</DropdownMenuItem>
												</DropdownMenuGroup>
											</DropdownMenuContent>
										</DropdownMenu>
									</ItemActions>
								</Item>
							);
						})}
					</ItemGroup>
				) : null}
				{loose.length ? (
					<div className="flex flex-col gap-2 px-2" data-slot="board-notes">
						<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
							<StickyNoteIcon className="size-3.5 shrink-0" />
							{plural(loose.length, "note")}
						</span>
						{loose.map((n) => (
							<Note note={n} key={n.id} remove={() => void actions.act(n.id, "remove")} />
						))}
					</div>
				) : null}
				{!view.tasks.length && !loose.length ? <Empty><EmptyHeader><EmptyMedia variant="icon"><ClipboardListIcon /></EmptyMedia><EmptyTitle>Nothing on this board yet</EmptyTitle><EmptyDescription>Add a task below, or ask the agent to split a job among sub-agents.</EmptyDescription></EmptyHeader></Empty> : null}
			</div>
		</ScrollArea>
	);
}

function Note({ note, remove }: { note: BoardItem; remove?: () => void }) {
	return (
		<div className="flex flex-col gap-1 border-l-2 border-line-soft pl-2" data-note={note.id}>
			<span className="flex items-center gap-1.5 text-faint">
				<span>
					#{note.id} · {note.by === "owner" ? "you" : note.by}
				</span>
				{note.outside ? <Badge variant="outline">from outside content</Badge> : null}
				<span className="flex-1" />
				{remove ? (
					<Button variant="ghost" size="xs" onClick={remove}>
						Remove
					</Button>
				) : null}
			</span>
			<p className="whitespace-pre-wrap select-text">{note.text}</p>
			<Fields data={note.data} />
		</div>
	);
}

/** How a board stands, in a line. */
function countsLine(b: BoardBrief): string {
	const c = b.counts;
	const parts = [c.taken ? `${c.taken} in progress` : "", c.open ? `${c.open} open` : "", c.blocked ? `${c.blocked} waiting for an answer` : "", c.failed ? `${c.failed} failed` : "", c.done ? `${c.done} done` : ""].filter(Boolean);
	return parts.join(" · ") || (c.notes ? plural(c.notes, "note") : "empty");
}

export function BoardTab({ tab }: { tab: Tab }) {
	useModel(tab);
	const [picked, setPicked] = useState<number>();
	useEffect(() => setPicked(undefined), [tab.key]);
	const board = tab.boards.find((b) => b.id === picked) ?? tab.boards[0];
	const view = useLoad(async () => (board ? await api.board(board.id) : undefined), [tab.key, board?.id, tab.boardTick]);
	const done = () => store.refreshBoards(tab);
	const actions: BoardActions = {
		post: (text) => store.attempt(() => api.boardPost(board ? board.id : { agent: tab.agent, session: tab.session }, text)).then(done),
		act: (item, action, text) => store.attempt(() => api.boardAct(item, action, text)).then(done),
	};
	const add = (
		<div className="flex-none border-t border-line-soft p-2">
			<Entry entry="add" label="Add a task" placeholder="Add a task for whoever takes it next" icon={PlusIcon} send={actions.post} />
		</div>
	);
	if (!board)
		return (
			<>
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<ClipboardListIcon />
						</EmptyMedia>
						<EmptyTitle>No board yet</EmptyTitle>
						<EmptyDescription>
							A board tracks a job that several agents share: the tasks, who has each one, and what they found. The agent starts a board when it splits a job among sub-agents, or you can add the first task here.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
				{add}
			</>
		);
	const items = tab.boards.map((b) => ({ value: String(b.id), label: boardLabel(b) }));
	return (
		<>
			<div className={SUB} data-slot="board-bar">
				{tab.boards.length > 1 ? (
					<Select items={items} value={String(board.id)} onValueChange={(v) => setPicked(Number(v))}>
						<SelectTrigger size="sm" aria-label="Which board">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{items.map((o) => (
									<SelectItem key={o.value} value={o.value}>
										{o.label}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				) : (
					<span className="text-foreground">{boardLabel(board)}</span>
				)}
				<span className="min-w-0 flex-1 truncate">{countsLine(board)}</span>
				<AlertDialog>
					<AlertDialogTrigger render={<Button variant="ghost" size="xs" data-action="clear" />}>Clear</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Remove this board?</AlertDialogTitle>
							<AlertDialogDescription>This also deletes the board's tasks, results and notes. A sub-agent still working on one of the tasks finishes without the board.</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogPrimitive.Close render={<AlertDialogAction variant="destructive" />} onClick={() => void store.attempt(() => api.boardRemove(board.id)).then(done)}>
								Remove
							</AlertDialogPrimitive.Close>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
			{view.data ? <BoardList view={view.data} actions={actions} /> : view.error ? <Empty><EmptyHeader><EmptyMedia variant="icon"><ClipboardListIcon /></EmptyMedia><EmptyTitle>Could not load the board</EmptyTitle><EmptyDescription>{view.error}</EmptyDescription></EmptyHeader></Empty> : <Pulse label="Loading" className="m-auto" />}
			{add}
		</>
	);
}
