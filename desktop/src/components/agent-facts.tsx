import { CpuIcon, ShieldIcon, SparkleIcon } from "lucide-react";
import type { ReactNode } from "react";
import { HoverTooltip } from "@/components/hover-tooltip";
import { Badge } from "@/components/ui/badge";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MODES } from "../text.ts";

/** What of an agent the badges say. */
export interface AgentFactsOf {
	model?: string;
	thinking: string;
	mode: string;
	main?: boolean;
	delegates: string[];
}

/** Whom an agent delegates to, in words: "*" is every agent but the main one, which is a choice of its own. */
export const delegatesTo = (agent: Pick<AgentFactsOf, "main" | "delegates">, mainId?: string) =>
	agent.delegates.includes("*") ? (agent.main ? "all other agents" : `all agents except ${mainId ?? "the main one"}`) : agent.delegates.join(", ");

/**
 * What an agent runs on and may do, as badges: its model, how long it reasons, its mode and what that
 * reaches, that it administers pine (the main agent), and whom it delegates to. One wording wherever an
 * agent is summed up: the card at the top of its conversation and the side panel's Agent tab. With `pick`,
 * a badge is the button that changes what it says. The badges are handed back without a row around them,
 * for the row they stand in (which may hold more). The words carry their own spaces: the gap between a
 * badge's parts is only drawn, and a screen reader reads the text.
 */
export function AgentFacts({ agent, mainId, pick }: { agent: AgentFactsOf; /** The main agent's name, for "all agents except …". */ mainId?: string; pick?: { model?: () => void; reasoning?: () => void; mode?: () => void } }) {
	const wide = agent.mode === "auto" || agent.mode === "bypass";
	const fact = (about: ReactNode, onPick: (() => void) | undefined, children: ReactNode) => (
		<HoverTooltip>
			<TooltipTrigger render={<Badge variant="outline" data-slot="agent-fact" render={onPick ? <button type="button" onClick={onPick} /> : undefined} />}>{children}</TooltipTrigger>
			<TooltipContent>{about}</TooltipContent>
		</HoverTooltip>
	);
	return (
		<>
			{fact("The model this agent runs on", pick?.model, <><CpuIcon data-icon="inline-start" /><b>{agent.model || "no model"}</b></>)}
			{fact("How long the model thinks before answering", pick?.reasoning, <><SparkleIcon data-icon="inline-start" />{"reasoning "}<b>{agent.thinking}</b></>)}
			{fact(MODES.find((m) => m.value === agent.mode)?.about ?? "How often the agent asks you, and what it can reach", pick?.mode, <><ShieldIcon data-icon="inline-start" /><b>{agent.mode}</b>{wide ? " your account, no sandbox" : " in a sandbox"}</>)}
			{agent.main ? fact("Creates and changes other agents and pine's settings when you ask", undefined, "administers pine") : null}
			{agent.delegates.length ? fact("Agents this agent can delegate to", undefined, <>{"delegates to "}<b>{delegatesTo(agent, mainId)}</b></>) : null}
		</>
	);
}
