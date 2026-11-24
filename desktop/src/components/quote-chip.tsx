import { QuoteIcon, XIcon } from "lucide-react";
import type { MouseEvent } from "react";
import { HoverTooltip } from "@/components/hover-tooltip";
import { Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentMedia, AttachmentTitle, AttachmentTrigger } from "@/components/ui/attachment";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function opening(text: string, max = 40): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max).trimEnd()}…` : line;
}

export function QuoteChip({ text, onOpen, onRemove, className }: { text: string; onOpen?: (event: MouseEvent<HTMLButtonElement>) => void; onRemove?: () => void; className?: string }) {
	return (
		<Attachment size="sm" data-slot="quote-chip" className={cn("max-w-72 min-w-0", className)}>
			<HoverTooltip>
				<TooltipTrigger render={<AttachmentTrigger onClick={onOpen} aria-label={`Go to where you quoted: ${opening(text)}`} />} />
				<TooltipContent className="max-w-sm">
					<div className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words">{text}</div>
				</TooltipContent>
			</HoverTooltip>
			<AttachmentMedia><QuoteIcon /></AttachmentMedia>
			<AttachmentContent>
				<AttachmentTitle>{opening(text)}</AttachmentTitle>
			</AttachmentContent>
			{onRemove ? (
				<AttachmentActions>
					<HoverTooltip>
						<TooltipTrigger render={<AttachmentAction onClick={onRemove} aria-label="Remove quote" />}><XIcon /></TooltipTrigger>
						<TooltipContent>Remove quote</TooltipContent>
					</HoverTooltip>
				</AttachmentActions>
			) : null}
		</Attachment>
	);
}
