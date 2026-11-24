import { type ReactNode, useState } from "react";
import { ResizableHandle, ResizablePanel } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/** What in a sheet takes Escape for itself: the editor (its search), a field, the page in the browser. */
export const ESCAPE_KEEPERS = ".cm-editor, input, textarea, [contenteditable], [data-slot=browser] canvas";

/**
 * Something shown beside a conversation (the side panel, the browser's aside): a bar on top and a
 * body under it. Where the window has room it is a stock resizable column, as wide as the owner
 * last left it (`widthKey`, written by the panel group's owner); where it has none (`sheet`) it is
 * a stock sheet over the conversation, from the right, and putting the sheet away is `onClose`.
 */
export function SideSheet({ id, slot, title, sheet, widthKey, defaultWidth, initialWidth, minSize = 320, bar, barClassName, onClose, children }: {
	/** The column's id in the panel group, by which its width is kept. */
	id: string;
	/** The frame's `data-slot`. */
	slot: string;
	/** Its name, said to a screen reader when it is a sheet, and in the handle's tooltip. */
	title: string;
	sheet: boolean;
	widthKey: string;
	defaultWidth: number;
	/** Per-window width resolved by the caller when widths are stored per window instead of `localStorage`. */
	initialWidth?: number;
	minSize?: number;
	/** What the bar on top holds. */
	bar: ReactNode;
	barClassName?: string;
	onClose: () => void;
	children: ReactNode;
}) {
	const [width] = useState(() => initialWidth ?? (Number(localStorage.getItem(widthKey)) || defaultWidth));
	const frame = (
		<div data-slot={slot} className={cn("flex min-w-0 flex-1 flex-col overflow-hidden bg-background", !sheet && "rounded-xl border")}>
			{/* A sheet as wide as a phone-wide window reaches under the window's buttons at the top left on a Mac. */}
			<div className={cn("flex h-10 flex-none items-center gap-1.5 border-b border-line-soft px-2", barClassName, sheet && "max-sm:pl-window-buttons")}>{bar}</div>
			{children}
		</div>
	);
	if (sheet)
		return (
			<Sheet open onOpenChange={(open, details) => {
				if (open) return;
				// Base UI closes on any Escape, even one the editor's search, an address field or the page in the browser
				// took for itself: that Escape is theirs. Escape anywhere else in the sheet still closes it.
				if (details.reason === "escape-key" && details.event.target instanceof Element && details.event.target.closest(ESCAPE_KEEPERS)) return details.cancel();
				onClose();
			}}>
				{/* The sheet lies over the title bar's drag region, which Electron honours whatever is drawn on top:
				    without this a click in the sheet would move the window on a Mac. */}
				<SheetContent side="right" showCloseButton={false} className="app-no-drag gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
					<SheetTitle className="sr-only">{title}</SheetTitle>
					{frame}
				</SheetContent>
			</Sheet>
		);
	return (
		<>
			<ResizableHandle className="w-1.5 bg-transparent" disableDoubleClick title={`Drag to make the ${title.toLowerCase()} wider or narrower`} />
			<ResizablePanel id={id} className="flex" defaultSize={width} minSize={minSize} groupResizeBehavior="preserve-pixel-size">
				{frame}
			</ResizablePanel>
		</>
	);
}
