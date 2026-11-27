import { useMemo, useState } from "react";
import { cn } from "cn";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useNamedLine } from "./lists.tsx";
import type { Picker } from "./model.ts";
import { narrow } from "./text.ts";
import { Skeleton } from "@/components/ui/skeleton";

export function PickDialog({ p }: { p: Picker }) {
	const [query, setQuery] = useState(p.initial ?? "");
	// A name to change starts selected up to its extension, as a file's name is renamed elsewhere; once the dialog has put the focus in it.
	const select = (el: HTMLInputElement | null) => {
		if (el && p.initial && p.selected !== undefined) requestAnimationFrame(() => el.setSelectionRange(0, p.selected!));
	};
	const shown = useMemo(() => (p.free ? p.items : narrow(query, p.items)), [query, p]);
	// The list starts on the one in use. A label with a line beside it gets three fifths of the row and is cut there; one
	// alone (a model's name, which can be longer than the dialog) has the row and wraps, so that it is read whole.
	const line = useNamedLine(query, p.current, !p.loading);
	const description = p.free ? "Type a name and press Enter." : "Type to narrow the list, or choose with the arrows and Enter.";
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
			<CommandInput ref={select} placeholder={p.placeholder ?? "Type to narrow the list"} value={query} onValueChange={setQuery} />
			<CommandList className="scroll-fade" aria-busy={p.loading || undefined}>
				{/* The title shows as the group's heading: the dialog's own title is for screen readers. */}
				<CommandGroup heading={p.title}>
					{p.loading
						? ["w-1/2", "w-2/3", "w-2/5"].map((w) => (
								<div key={w} className="flex h-8 items-center px-2">
									<Skeleton className={cn("h-4", w)} />
								</div>
							))
						: shown.map((i) => (
								<CommandItem key={i.value} value={i.value} data-checked={i.value === p.current} onSelect={() => p.done(i.value)}>
									<span className={cn(i.about ? "max-w-3/5 flex-none truncate" : "min-w-0 wrap-break-word", i.tone === "bad" && "text-destructive")}>{i.label}</span>
									{i.about ? <span className="min-w-0 truncate text-xs text-muted-foreground">{i.about}</span> : null}
								</CommandItem>
							))}
				</CommandGroup>
				{p.free || p.loading ? null : <CommandEmpty>No matches.</CommandEmpty>}
			</CommandList>
		</Command>
	);
	const close = (open: boolean) => open || p.done(undefined);
	// A choice that cannot be taken back stays an alert dialog: announced as one, and not closed by a click beside it.
	// Its padding is the Command's alone, as in CommandDialog, so that both look alike.
	if (p.items.some((i) => i.tone === "bad"))
		return (
			<AlertDialog open onOpenChange={close}>
				<AlertDialogContent className="top-1/3 translate-y-0 gap-0 overflow-hidden p-0 data-[size=default]:sm:max-w-xl">
					<AlertDialogHeader className="sr-only">
						<AlertDialogTitle>{p.title}</AlertDialogTitle>
						<AlertDialogDescription>{description}</AlertDialogDescription>
					</AlertDialogHeader>
					{list}
				</AlertDialogContent>
			</AlertDialog>
		);
	return (
		<CommandDialog open onOpenChange={close} title={p.title} description={description} className="sm:max-w-xl">
			{list}
		</CommandDialog>
	);
}
