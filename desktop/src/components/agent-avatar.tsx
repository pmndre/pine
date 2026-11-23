import type { CSSProperties } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Logo } from "@/components/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { isHex, onColor } from "../theme.ts";

/**
 * An agent's initial on the stock avatar. Without a color of its own it is the stock avatar. With one,
 * it is drawn in that color, with white or a near-black on it, whichever reads better (`onColor`):
 * the same in every theme, so that an agent is known by its color wherever it is. The main agent's mark is
 * half the avatar wherever it stands: `!`, since a sidebar button sizes every svg inside it (`[&_svg]:size-4`).
 */
type AgentAvatarProps = { size?: "default" | "sm" | "lg"; className?: string } & (
	| { agent: { id: string; color?: string; /** The main agent: pine's mark in place of its initial. */ main?: boolean }; skeleton?: false }
	/** While the agent is not known yet: a circle at the avatar's size, from stock Skeleton. */
	| { agent?: undefined; skeleton: true }
);

export function AgentAvatar({ agent, size = "default", className, skeleton }: AgentAvatarProps) {
	// The same sizes as stock Avatar's (size-6, size-8, size-10), so nothing moves when the agent lands.
	if (skeleton || !agent) return <Skeleton className={cn("shrink-0 rounded-full", { sm: "size-6", default: "size-8", lg: "size-10" }[size], className)} />;
	const color = isHex(agent.color) ? agent.color.toLowerCase() : undefined;
	const style = color ? ({ "--agent": color, "--agent-on": onColor(color) } as CSSProperties) : undefined;
	return (
		<Avatar size={size} data-agent={agent.id} className={className}>
			<AvatarFallback style={style} className={cn(color && "bg-(--agent) text-(--agent-on)")}>
				{agent.main ? <Logo className="size-1/2! text-current" /> : agent.id.slice(0, 1).toUpperCase()}
			</AvatarFallback>
		</Avatar>
	);
}
