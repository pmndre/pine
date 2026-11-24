import type { ReactElement } from "react";
import { shortcut } from "../text.ts";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";

/** Action chosen from a tab's right-click menu. */
export type TabMenuAction = "close" | "others" | "right" | "all" | "pin" | "unpin" | "move-window";

type TabMenuProps = {
	/** Tab element that opens the context menu on right-click. */
	trigger: ReactElement;
	/** Whether Pin or Unpin is offered (`"main"` disables Pin for an agent's main conversation; `undefined` omits it). */
	pin?: "pin" | "unpin" | "main";
	/** Whether `Move to New Window` is offered for this tab. */
	moveToWindow?: boolean;
	/** Whether other tabs exist to close. */
	others?: boolean;
	/** Whether tabs exist to the right of this one. */
	right?: boolean;
	/** Controlled open state when driven externally. */
	open?: boolean;
	/** Fires with the chosen tab menu action. */
	onAction: (action: TabMenuAction) => void;
};

/**
 * The menu of a tab in the title bar, opened with a right click on the tab, as in VS Code: the ways to close tabs,
 * moving a conversation tab into a new window, and pinning the conversation the tab shows.
 */
export function TabMenu({ trigger, pin, moveToWindow, others = true, right = true, open, onAction }: TabMenuProps) {
	return (
		<ContextMenu open={open}>
			<ContextMenuTrigger render={trigger} />
			<ContextMenuContent aria-label="Tab" className="min-w-48">
				<ContextMenuGroup>
					<ContextMenuItem onClick={() => onAction("close")}>
						Close<ContextMenuShortcut>{shortcut("⌘W")}</ContextMenuShortcut>
					</ContextMenuItem>
					<ContextMenuItem disabled={!others} onClick={() => onAction("others")}>Close Others</ContextMenuItem>
					<ContextMenuItem disabled={!right} onClick={() => onAction("right")}>Close to the Right</ContextMenuItem>
					<ContextMenuItem onClick={() => onAction("all")}>Close All</ContextMenuItem>
				</ContextMenuGroup>
				{moveToWindow ? (
					<>
						<ContextMenuSeparator />
						<ContextMenuGroup>
							<ContextMenuItem onClick={() => onAction("move-window")}>Move to New Window</ContextMenuItem>
						</ContextMenuGroup>
					</>
				) : null}
				{pin ? (
					<>
						<ContextMenuSeparator />
						<ContextMenuGroup>
							<ContextMenuItem disabled={pin === "main"} title={pin === "main" ? "An agent's main conversation always stays" : undefined} onClick={() => onAction(pin === "unpin" ? "unpin" : "pin")}>
								{pin === "unpin" ? "Unpin" : "Pin"}
							</ContextMenuItem>
						</ContextMenuGroup>
					</>
				) : null}
			</ContextMenuContent>
		</ContextMenu>
	);
}
