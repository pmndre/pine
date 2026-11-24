import { BookmarkIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { opening } from "@/components/quote-chip";

export type BookmarkRow = { id: string; text: string };

export function BookmarkList<T extends BookmarkRow>({ bookmarks, onOpen, onRemove, defaultOpen }: { bookmarks: T[]; onOpen: (bookmark: T) => void; onRemove: (bookmark: T) => void; defaultOpen?: boolean }) {
	const [open, setOpen] = useState(Boolean(defaultOpen));
	if (!bookmarks.length) return null;
	const label = `${bookmarks.length} bookmark${bookmarks.length === 1 ? "" : "s"}`;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger render={<Button variant="ghost" size="xs" data-slot="bookmarks-button" aria-label={`${label} in this conversation`} title={`${label} in this conversation`} />}>
				<BookmarkIcon data-icon="inline-start" />
				<Badge variant="secondary" className="h-4 min-w-4 px-1 tabular-nums">{bookmarks.length}</Badge>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 gap-1.5 p-1.5" data-slot="bookmark-list">
				<PopoverHeader className="px-1.5 pt-1">
					<PopoverTitle className="text-xs text-muted-foreground">{label}</PopoverTitle>
				</PopoverHeader>
				<ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
					{bookmarks.map((b) => (
						<li key={b.id} data-slot="bookmark-row" className="flex items-start gap-1 rounded-md hover:bg-muted">
							<button type="button" className="min-w-0 flex-1 cursor-pointer rounded-md px-1.5 py-1 text-left text-sm leading-snug outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-label={`Go to the bookmark: ${opening(b.text)}`} onClick={() => (setOpen(false), onOpen(b))}>
								<span className="line-clamp-2 break-words">{b.text.replace(/\s+/g, " ").trim()}</span>
							</button>
							<Button variant="ghost" size="icon-xs" className="mt-0.5 mr-0.5 shrink-0 text-muted-foreground" aria-label={`Remove the bookmark: ${opening(b.text)}`} title="Remove bookmark" onClick={() => onRemove(b)}>
								<XIcon />
							</Button>
						</li>
					))}
				</ul>
			</PopoverContent>
		</Popover>
	);
}
