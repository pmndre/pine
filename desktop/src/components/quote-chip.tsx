import { QuoteIcon, ReplyIcon, XIcon } from "lucide-react";
import type { KeyboardEvent, MouseEvent, Ref } from "react";
import { HoverTooltip } from "@/components/hover-tooltip";
import { Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentMedia, AttachmentTitle, AttachmentTrigger } from "@/components/ui/attachment";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function opening(text: string, max = 40): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max).trimEnd()}…` : line;
}

export function QuoteChip({ text, reply, replying, onOpen, onReply, onRemove, className }: { text: string; reply?: string; replying?: boolean; onOpen?: (event: MouseEvent<HTMLButtonElement>) => void; onReply?: () => void; onRemove?: () => void; className?: string }) {
	const said = reply?.trim();
	return (
		<Attachment size="sm" data-slot="quote-chip" data-replying={replying || undefined} className={cn("max-w-72 min-w-0", replying && "border-primary/60", className)}>
			<HoverTooltip>
				<TooltipTrigger render={<AttachmentTrigger onClick={onOpen} aria-label={`Go to where you quoted: ${opening(text)}`} />} />
				<TooltipContent className="max-w-sm">
					<div className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words">{text}</div>
				</TooltipContent>
			</HoverTooltip>
			<AttachmentMedia><QuoteIcon /></AttachmentMedia>
			<AttachmentContent>
				<AttachmentTitle>{opening(text)}</AttachmentTitle>
				{said && onReply ? (
					<button type="button" data-slot="quote-chip-reply" onClick={onReply} aria-label={`Edit your reply: ${opening(said)}`} className="relative z-20 mt-0.5 flex max-w-full min-w-0 items-center gap-1 text-left text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground">
						<ReplyIcon className="size-3 shrink-0" />
						<span className="truncate">{opening(said)}</span>
					</button>
				) : said ? (
					<span data-slot="quote-chip-reply" className="mt-0.5 flex max-w-full min-w-0 items-center gap-1 text-muted-foreground">
						<ReplyIcon className="size-3 shrink-0" />
						<span className="truncate">{opening(said)}</span>
					</span>
				) : null}
			</AttachmentContent>
			{onReply || onRemove ? (
				<AttachmentActions>
					{onReply ? (
						<HoverTooltip>
							<TooltipTrigger render={<AttachmentAction onClick={onReply} aria-label={said ? "Edit your reply to this quote" : "Reply to this quote"} />}><ReplyIcon /></TooltipTrigger>
							<TooltipContent>{said ? "Edit your reply to this quote" : "Reply to this quote"}</TooltipContent>
						</HoverTooltip>
					) : null}
					{onRemove ? (
						<HoverTooltip>
							<TooltipTrigger render={<AttachmentAction onClick={onRemove} aria-label="Remove quote" />}><XIcon /></TooltipTrigger>
							<TooltipContent>Remove quote</TooltipContent>
						</HoverTooltip>
					) : null}
				</AttachmentActions>
			) : null}
		</Attachment>
	);
}

export function QuoteReply({ text, value, onChange, onDone, inputRef, autoFocus, className }: { text: string; value: string; onChange: (value: string) => void; onDone: () => void; inputRef?: Ref<HTMLTextAreaElement>; autoFocus?: boolean; className?: string }) {
	const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.nativeEvent.isComposing) return;
		if ((e.key === "Enter" && !e.shiftKey) || e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			onDone();
		}
	};
	return (
		<div data-slot="quote-reply" onClick={(e) => e.stopPropagation()} className={cn("flex w-full min-w-0 cursor-auto flex-col gap-1 rounded-lg border bg-card px-2.5 py-2 font-normal text-card-foreground select-text", className)}>
			<div className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
				<QuoteIcon className="size-3.5 shrink-0" />
				<HoverTooltip>
					<TooltipTrigger render={<span className="min-w-0 flex-1 truncate" />}>{opening(text, 120)}</TooltipTrigger>
					<TooltipContent className="max-w-sm">
						<div className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words">{text}</div>
					</TooltipContent>
				</HoverTooltip>
				<HoverTooltip>
					<TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="-my-1 -mr-1 shrink-0" onClick={onDone} aria-label="Done with this reply" />}><XIcon /></TooltipTrigger>
					<TooltipContent>
						Done with this reply
						<Kbd>↩</Kbd>
					</TooltipContent>
				</HoverTooltip>
			</div>
			<Textarea
				ref={inputRef}
				data-slot="quote-reply-input"
				rows={1}
				autoFocus={autoFocus}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={onKey}
				placeholder="Your reply to this quote · ↩ done · ⇧↩ new line"
				aria-label={`Your reply to: ${opening(text)}`}
				className="max-h-40 min-h-0 resize-none rounded-none border-0 bg-transparent p-0 text-sm leading-snug shadow-none focus-visible:ring-0 dark:bg-transparent md:text-sm"
			/>
		</div>
	);
}
