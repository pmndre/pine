import { useMemo, useState } from "react";
import { cn } from "cn";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNamedLine } from "./lists.tsx";
import type { Picker } from "./model.ts";
import { fuzzy } from "./text.ts";
import { Skeleton } from "@/components/ui/skeleton";

export function PickDialog({ p }: { p: Picker }) {
	const [query, setQuery] = useState("");
	const shown = useMemo(() => (query && !p.free ? p.items.map((i) => ({ i, rank: Math.min(...[fuzzy(query, i.label), fuzzy(query, i.about ?? "") + 10].filter((r) => r >= 0), 99) })).filter((x) => x.rank < 99).sort((a, b) => a.rank - b.rank).map((x) => x.i) : p.items), [query, p]);
	// The list starts on the one in use.
	const line = useNamedLine(query, p.current, !p.loading);
	// A short list is chosen from with the arrows; its field is there for the keyboard and for screen readers, unseen.
	const typing = !p.loading && (p.free || p.items.length > 7);
	const list = (
		<Command
			{...line}
			shouldFilter={false}
			loop
			onKeyDown={(e) => {
				// Words of the owner's own count before the list where both are possible.
				if (e.key === "Enter" && p.free && query.trim()) (e.preventDefault(), p.done(query.trim()));
			}}
		>
			<div className={typing ? undefined : "sr-only"}>
				<CommandInput placeholder={p.placeholder ?? "Type to narrow the list"} value={query} onValueChange={setQuery} />
			</div>
			<CommandList className="scroll-fade" aria-busy={p.loading || undefined}>
				{p.loading ? (
					<div className="flex flex-col gap-1 p-1">
						{["w-1/2", "w-2/3", "w-2/5"].map((w) => (
							<div key={w} className="flex h-8 items-center px-2"><Skeleton className={`h-4 ${w}`} /></div>
						))}
					</div>
				) : shown.length ? (
					<CommandGroup>
						{shown.map((i) => (
							<CommandItem key={i.value} value={i.value} data-checked={i.value === p.current} onSelect={() => p.done(i.value)}>
								<span className={cn("max-w-3/5 flex-none truncate", i.tone === "bad" && "text-destructive")}>{i.label}</span>
								{i.about ? <span className="min-w-0 truncate text-xs text-muted-foreground">{i.about}</span> : null}
							</CommandItem>
						))}
					</CommandGroup>
				) : null}
				{p.free || p.loading ? null : <CommandEmpty>Nothing fits.</CommandEmpty>}
			</CommandList>
		</Command>
	);
	const close = (open: boolean) => open || p.done(undefined);
	if (p.items.some((i) => i.tone === "bad"))
		return (
			<AlertDialog open onOpenChange={close}>
				<AlertDialogContent className="data-[size=default]:sm:max-w-xl">
					<AlertDialogHeader>
						<AlertDialogTitle>{p.title}</AlertDialogTitle>
					</AlertDialogHeader>
					{list}
				</AlertDialogContent>
			</AlertDialog>
		);
	return (
		<Dialog open onOpenChange={close}>
			<DialogContent showCloseButton={false} className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{p.title}</DialogTitle>
				</DialogHeader>
				{list}
			</DialogContent>
		</Dialog>
	);
}
