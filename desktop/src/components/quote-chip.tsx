import { CheckIcon, QuoteIcon, ReplyIcon, XIcon } from "lucide-react";
import type { KeyboardEvent, MouseEvent, Ref } from "react";
import { HoverTooltip } from "@/components/hover-tooltip";
import { Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentMedia, AttachmentTitle, AttachmentTrigger } from "@/components/ui/attachment";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
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
				<TooltipTrigger render={<AttachmentTrigger onClick={onOpen} data-action="open" aria-label={onOpen ? `Go to the quoted text: ${opening(text)}` : `Quoted text: ${opening(text)}`} />} />
				<TooltipContent className="max-w-sm">
					<QuoteText text={text} />
				</TooltipContent>
			</HoverTooltip>
			<AttachmentMedia><QuoteIcon /></AttachmentMedia>
			<AttachmentContent>
				<AttachmentTitle>{opening(text)}</AttachmentTitle>
				{said && onReply ? (
					<button type="button" tabIndex={-1} data-slot="quote-chip-reply" onClick={onReply} aria-label={`Edit your reply: ${opening(said)}`} className="relative z-20 mt-0.5 flex max-w-full min-w-0 items-center gap-1 text-left text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground">
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
							<TooltipTrigger render={<AttachmentAction onClick={onRemove} data-action="remove" aria-label="Remove quote" />}><XIcon /></TooltipTrigger>
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
		// The stock prompt shape (Input Group): what is quoted in the addon above, the reply in the textarea under it.
		<InputGroup data-quote-reply="" onClick={(e) => e.stopPropagation()} className={cn("cursor-auto font-normal select-text", className)}>
			<InputGroupAddon align="block-start" className="min-w-0 text-xs">
				<QuoteIcon />
				<HoverTooltip>
					<TooltipTrigger render={<span className="min-w-0 flex-1 truncate text-start font-normal" />}>{opening(text, 120)}</TooltipTrigger>
					<TooltipContent className="max-w-sm">
						<QuoteText text={text} />
					</TooltipContent>
				</HoverTooltip>
				<HoverTooltip>
					<TooltipTrigger render={<InputGroupButton size="icon-xs" onClick={onDone} aria-label="Done with this reply" />}><CheckIcon /></TooltipTrigger>
					<TooltipContent>
						Done with this reply
						<Kbd>↩</Kbd>
					</TooltipContent>
				</HoverTooltip>
			</InputGroupAddon>
			<InputGroupTextarea
				ref={inputRef}
				data-quote-reply-input=""
				rows={1}
				autoFocus={autoFocus}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={onKey}
				placeholder="Reply to this quote"
				aria-label={`Your reply to: ${opening(text)}`}
				className="max-h-40 min-h-0"
			/>
		</InputGroup>
	);
}

/** The whole of a quote, in its tooltip: up to a height, past which the rest is cut where the box ends. */
function QuoteText({ text }: { text: string }) {
	return (
		<ScrollArea className="flex max-h-60 min-h-0 flex-col">
			<div className="whitespace-pre-wrap break-words">{text}</div>
		</ScrollArea>
	);
}
