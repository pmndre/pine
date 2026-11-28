import { Badge } from "@/components/ui/badge";
import { Pulse } from "@/components/pulse";

/** What a conversation, a group or an agent calls for, the weightiest first (`standing` in model.ts). */
export type Standing = "waits" | "working" | "unread";

/**
 * What a side-bar line calls for, as every line draws it: a red `!` where the owner is waited for, the pulse where an
 * agent works, a dot where there is something new. Nothing when it calls for nothing.
 */
export function StatusMark({ standing }: { standing?: Standing }) {
	if (standing === "waits") return <Badge variant="destructive" data-standing="waits" className="size-4 p-0">!</Badge>;
	if (standing === "working") return <Pulse data-standing="working" />;
	if (standing === "unread") return <Badge data-standing="unread" className="size-2 p-0" />;
	return null;
}
