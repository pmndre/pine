import type { ReactElement } from "react";
import { shortcut } from "../text.ts";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";

export type TabMenuAction = "close" | "others" | "right" | "all" | "pin" | "unpin" | "move-to-window" | "split-right" | "split-down";

/**
 * The menu of a tab, opened with a right click on the tab, as in VS Code: the ways to close tabs, splitting its
 * group (the tab goes into a new group beside it or under it), moving the tab to a new window (on desktop), and
 * pinning the conversation the tab shows. `closeMany` leaves out the ways to close other tabs (a pane's tab);
 * `split` offers the splits (a group with more than one tab, in a window wide enough for groups). `trigger` is the tab itself;
 * it is drawn as it is and opens the menu. `pin` says which of Pin and Unpin is offered: "main" for an agent's main
 * conversation, which always stays (the entry is there and cannot be chosen), nothing for a tab that shows no
 * conversation (the entry is left out).
 */
export function TabMenu({ trigger, pin, moveToWindow = false, others = true, right = true, closeMany = true, split = false, open, onAction }: { trigger: ReactElement; pin?: "pin" | "unpin" | "main"; moveToWindow?: boolean; others?: boolean; right?: boolean; closeMany?: boolean; split?: boolean; open?: boolean; onAction: (action: TabMenuAction) => void }) {
	return (
		<ContextMenu open={open}>
			<ContextMenuTrigger render={trigger} />
			<ContextMenuContent aria-label="Tab" className="min-w-48">
				<ContextMenuGroup>
					<ContextMenuItem onClick={() => onAction("close")}>
						Close<ContextMenuShortcut>{shortcut("⌘W")}</ContextMenuShortcut>
					</ContextMenuItem>
					{closeMany ? (
						<>
							<ContextMenuItem disabled={!others} onClick={() => onAction("others")}>Close Others</ContextMenuItem>
							<ContextMenuItem disabled={!right} onClick={() => onAction("right")}>Close to the Right</ContextMenuItem>
							<ContextMenuItem onClick={() => onAction("all")}>Close All</ContextMenuItem>
						</>
					) : null}
				</ContextMenuGroup>
				{split ? (
					<>
						<ContextMenuSeparator />
						<ContextMenuGroup>
							<ContextMenuItem onClick={() => onAction("split-right")}>Split Right</ContextMenuItem>
							<ContextMenuItem onClick={() => onAction("split-down")}>Split Down</ContextMenuItem>
						</ContextMenuGroup>
					</>
				) : null}
				{moveToWindow ? (
					<>
						<ContextMenuSeparator />
						<ContextMenuGroup>
							<ContextMenuItem onClick={() => onAction("move-to-window")}>Move to New Window</ContextMenuItem>
						</ContextMenuGroup>
					</>
				) : null}
				{pin ? (
					<>
						<ContextMenuSeparator />
						<ContextMenuGroup>
							<ContextMenuItem disabled={pin === "main"} title={pin === "main" ? "An agent's main conversation is always kept" : undefined} onClick={() => onAction(pin === "unpin" ? "unpin" : "pin")}>
								{pin === "unpin" ? "Unpin" : "Pin"}
							</ContextMenuItem>
						</ContextMenuGroup>
					</>
				) : null}
			</ContextMenuContent>
		</ContextMenu>
	);
}
