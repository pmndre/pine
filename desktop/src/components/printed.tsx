import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockLine } from "@/components/ui/code-block";
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from "@/components/ui/message-scroller";
import { Skeleton } from "@/components/ui/skeleton";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import { cn } from "@/lib/utils";

/**
 * What a tool or a program printed: a stock Code Block, as shadcn's Terminal pattern shows a
 * command's output, with the terminal's colors read by the stock highlighter ("ansi"; the chat rule
 * says not to highlight tool output, but these colors are the program's own). The panel is already
 * the viewer, so there is no Trace line around it. `capped` caps it where several follow each other (the
 * pattern's `max-h-64`); `sm` caps it and draws it at the stock block's small size too. `contentClassName`
 * goes on its lines, for a place that sets code tighter than the stock block (the side panel).
 */
export function Printed(props: { text: string; failed?: boolean; sm?: boolean; capped?: boolean; className?: string; contentClassName?: string; skeleton?: false } | { text?: undefined; failed?: undefined; sm?: boolean; capped?: boolean; className?: string; /** While the output loads: a bordered block with a few line bars. */ skeleton: true }) {
	// The hook below must not run for a skeleton, so the two are separate components.
	if (props.skeleton || props.text === undefined) return <PrintedSkeleton className={props.className} />;
	return <PrintedText {...props} text={props.text} />;
}

function PrintedSkeleton({ className }: { className?: string }) {
	return (
		<CodeBlock data-slot="printed-skeleton" className={className}>
			<CodeBlockContent tabIndex={-1}>
				<span className="flex flex-col gap-2">
					<Skeleton className="h-4 w-3/4" />
					<Skeleton className="h-4 w-1/2" />
					<Skeleton className="h-4 w-2/3" />
				</span>
			</CodeBlockContent>
		</CodeBlock>
	);
}

/** The stock block's focus ring, for the scroller that holds its content when it is capped. */
const SCROLLER_FOCUS = "has-[[data-slot=message-scroller-viewport]:focus-visible]:border-ring has-[[data-slot=message-scroller-viewport]:focus-visible]:ring-3 has-[[data-slot=message-scroller-viewport]:focus-visible]:ring-ring/50";

function PrintedText({ text, failed = false, sm = false, capped = sm, className, contentClassName }: { text: string; failed?: boolean; sm?: boolean; capped?: boolean; className?: string; contentClassName?: string }) {
	const lines = useHighlightedCode(text, "ansi");
	const content = (
		// Inside the scroller, the scroller is what takes the focus and scrolls.
		// A line is an item of the stock block's grid, which is as wide as its longest word unless told otherwise: an address would push every line out of the block.
		<CodeBlockContent wrap tabIndex={capped ? -1 : undefined} className={cn("[&_[data-slot=code-block-line]]:min-w-0", contentClassName)}>
			{lines.map((line, i) => <CodeBlockLine key={i}>{line}</CodeBlockLine>)}
		</CodeBlockContent>
	);
	return (
		<CodeBlock variant={failed ? "destructive" : "default"} size={sm ? "sm" : "default"} className={cn(capped && SCROLLER_FOCUS, className)} data-status={failed ? "fail" : "ok"}>
			<CodeBlockActions>
				<CodeBlockCopyButton value={text} />
			</CodeBlockActions>
			{capped ? (
				// Capped, it scrolls. A program that is still running keeps printing: like a terminal, the block
				// follows its end while it is scrolled to there, and holds still once the owner scrolled up to
				// read. That is Message Scroller's to do, with its button back to the end.
				<MessageScrollerProvider autoScroll defaultScrollPosition="end">
					<MessageScroller>
						<MessageScrollerViewport aria-label="Output" className="max-h-64 outline-none">
							<MessageScrollerContent className="gap-0">
								<MessageScrollerItem>{content}</MessageScrollerItem>
							</MessageScrollerContent>
						</MessageScrollerViewport>
						<MessageScrollerButton size="icon-xs" />
					</MessageScroller>
				</MessageScrollerProvider>
			) : (
				content
			)}
		</CodeBlock>
	);
}
