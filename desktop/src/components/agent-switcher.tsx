import type { ReactNode } from "react";
import { ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { AgentAvatar } from "@/components/agent-avatar";
import { type Standing, StatusMark } from "@/components/status-mark";

type Agent = { id: string; color?: string; main?: boolean; description?: string; model?: string };

const WEIGHT: Record<Standing, number> = { waits: 3, working: 2, unread: 1 };

/** The weightiest of what several lines call for. */
export function weightiest(all: Array<Standing | undefined>): Standing | undefined {
	return all.reduce<Standing | undefined>((most, one) => (one && (!most || WEIGHT[one] > WEIGHT[most]) ? one : most), undefined);
}

/**
 * The agent the side bar shows, and the way to another, as shadcn's sidebar switches teams: the agent's avatar, its
 * name and what it is for, and a menu with every agent (each with what it calls for), the current one's actions
 * (`children`, groups of menu items) and New agent. What another agent calls for shows on the trigger too, so that
 * nothing is missed while the side bar shows one agent. Put it in a `SidebarMenuItem`. `onClosed` comes once the menu
 * is gone, for an action that opens something of its own in its place; such an action sets `returnFocus` to false,
 * so that the focus the menu gives back, to its trigger or whatever had it before, does not take it from that thing.
 */
export function AgentSwitcher({ agents, current, standing, onSelect, onNewAgent, onClosed, returnFocus = true, children }: { agents: Agent[]; current: Agent; standing?: (id: string) => Standing | undefined; onSelect: (id: string) => void; onNewAgent: () => void; onClosed?: () => void; returnFocus?: boolean; children?: ReactNode }) {
	const others = weightiest(agents.filter((a) => a.id !== current.id).map((a) => standing?.(a.id)));
	const about = current.description || current.model;
	return (
		<DropdownMenu onOpenChangeComplete={(open) => !open && onClosed?.()}>
			<DropdownMenuTrigger render={<SidebarMenuButton size="lg" data-slot="agent-switcher" data-agent={current.id} data-standing={others} aria-label={`${current.id}: switch to another agent`} />}>
				<AgentAvatar agent={current} />
				<span className="grid min-w-0 flex-1 leading-tight">
					<span data-slot="agent-name" className="truncate font-medium">{current.id}</span>
					{about ? <span className="truncate text-xs text-muted-foreground">{about}</span> : null}
				</span>
				<StatusMark standing={others} />
				<ChevronsUpDownIcon className="text-muted-foreground" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="min-w-56" finalFocus={returnFocus}>
				<DropdownMenuGroup>
					<DropdownMenuLabel>Agents</DropdownMenuLabel>
					<DropdownMenuRadioGroup value={current.id}>
						{agents.map((a) => (
							<DropdownMenuRadioItem key={a.id} value={a.id} closeOnClick onClick={() => onSelect(a.id)} data-slot="agent-option" data-agent={a.id} data-standing={standing?.(a.id)}>
								<AgentAvatar agent={a} size="sm" />
								<span className="min-w-0 flex-1 truncate">{a.id}</span>
								<StatusMark standing={standing?.(a.id)} />
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuGroup>
				{children ? (
					<>
						<DropdownMenuSeparator />
						{children}
					</>
				) : null}
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem data-action="new-agent" onClick={onNewAgent}>
						<PlusIcon />
						New agent…
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
