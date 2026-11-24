import type { ReactElement } from "react";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";

export type TabMenuAction = "close" | "others" | "right" | "saved" | "all" | "move" | "pin" | "unpin";

/**
 * The menu of a tab in the title bar, opened with a right click on the tab, as in VS Code: the ways to close tabs,
 * moving the tab to a new window, and pinning the conversation the tab shows. `trigger` is the tab itself; it is drawn
 * as it is and opens the menu. `pin` says which of Pin and Unpin is offered: "main" for an agent's main conversation,
 * which always stays (the entry is there and cannot be chosen), nothing for a tab that shows no conversation (the entry
 * is left out). `move` offers `Move to New Window` when the tab can be moved out into a window of its own.
 */
export function TabMenu({ trigger, pin, move = false, others = true, right = true, open, onAction }: { trigger: ReactElement; pin?: "pin" | "unpin" | "main"; move?: boolean; others?: boolean; right?: boolean; open?: boolean; onAction: (action: TabMenuAction) => void }) {
	return (
		<ContextMenu open={open}>
			<ContextMenuTrigger render={trigger} />
			<ContextMenuContent aria-label="Tab" className="min-w-48">
				<ContextMenuGroup>
					<ContextMenuItem onClick={() => onAction("close")}>
						Close<ContextMenuShortcut>⌘W</ContextMenuShortcut>
					</ContextMenuItem>
					<ContextMenuItem disabled={!others} onClick={() => onAction("others")}>Close Others</ContextMenuItem>
					<ContextMenuItem disabled={!right} onClick={() => onAction("right")}>Close to the Right</ContextMenuItem>
					<ContextMenuItem onClick={() => onAction("saved")}>Close Saved</ContextMenuItem>
					<ContextMenuItem onClick={() => onAction("all")}>Close All</ContextMenuItem>
				</ContextMenuGroup>
				{move || pin ? (
					<>
						<ContextMenuSeparator />
						<ContextMenuGroup>
							{move ? <ContextMenuItem onClick={() => onAction("move")}>Move to New Window</ContextMenuItem> : null}
							{pin ? (
								<ContextMenuItem disabled={pin === "main"} title={pin === "main" ? "An agent's main conversation always stays" : undefined} onClick={() => onAction(pin === "unpin" ? "unpin" : "pin")}>
									{pin === "unpin" ? "Unpin" : "Pin"}
								</ContextMenuItem>
							) : null}
						</ContextMenuGroup>
					</>
				) : null}
			</ContextMenuContent>
		</ContextMenu>
	);
}
