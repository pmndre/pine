import { type ReactElement, type ReactNode, useId, useRef, useState } from "react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AGENT_COLORS, isHex } from "../theme.ts";
import { AgentAvatar } from "./agent-avatar.tsx";

/** What an agent id may be: the daemon checks the same (`checkAgentId` in src/admin.ts). */
export const AGENT_ID = /^[a-z][a-z0-9_-]{1,30}$/;

/**
 * An agent's color, picked on its avatar: a popover with None (the stock avatar), the presets drawn as
 * its avatar would be in each, and any other color. Every pick is the change, at once ("none" takes the
 * color away). `trigger` is what opens it: the avatar as a button on the agent's settings page; in the side
 * bar, where the avatar lies inside the button that folds the group, a mark over it that only the menu opens.
 */
export function AgentColorPicker({ agent, onChange, trigger, nativeButton = true, open, onOpenChange, children }: { agent: { id: string; color?: string; main?: boolean }; onChange: (color: string) => void; trigger: ReactElement; nativeButton?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; children?: ReactNode }) {
	const field = useId();
	const color = isHex(agent.color) ? agent.color.toLowerCase() : undefined;
	const choice = !color ? "none" : AGENT_COLORS.some((c) => c.hex === color) ? color : "other";
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger render={trigger} nativeButton={nativeButton}>
				{children}
			</PopoverTrigger>
			<PopoverContent align="start" className="w-auto" data-slot="agent-color">
				<PopoverHeader>
					<PopoverTitle>Color of {agent.id}</PopoverTitle>
					<PopoverDescription>Used for the agent's avatar, wherever it is drawn.</PopoverDescription>
				</PopoverHeader>
				<ToggleGroup aria-label={`Color of ${agent.id}`} variant="outline" size="sm" className="flex-wrap" value={[choice]} onValueChange={(v) => v[0] && v[0] !== "other" && onChange(v[0])}>
					<ToggleGroupItem value="none">None</ToggleGroupItem>
					{AGENT_COLORS.map((c) => (
						<ToggleGroupItem key={c.hex} value={c.hex} aria-label={c.name} title={c.name}>
							<AgentAvatar agent={{ id: agent.id, color: c.hex, main: agent.main }} size="sm" />
						</ToggleGroupItem>
					))}
				</ToggleGroup>
				<Field orientation="horizontal">
					<FieldLabel htmlFor={`${field}-other`}>Other</FieldLabel>
					{/* Without a color of its own the input shows a neutral grey, which is no change until one is set there. */}
					<Input id={`${field}-other`} name="color" type="color" className="w-10 p-0.5" value={color ?? "#808080"} onChange={(e) => onChange(e.target.value)} />
				</Field>
			</PopoverContent>
		</Popover>
	);
}

/**
 * An agent's name made editable where it is shown. Enter or leaving the field renames it, Escape keeps
 * the name. What is typed is written as an id is (lower case, "-" for a space), and one that cannot be an
 * id is marked and not sent.
 */
export function AgentNameInput({ id, onDone, className }: { id: string; onDone: (to?: string) => void; className?: string }) {
	const [value, setValue] = useState(id);
	// Enter ends it, and so does the blur that may follow: it is answered once.
	const ended = useRef(false);
	const valid = AGENT_ID.test(value);
	const finish = (keep: boolean) => {
		if (ended.current) return;
		ended.current = true;
		onDone(keep && valid && value !== id ? value : undefined);
	};
	return (
		<Input
			autoFocus
			aria-label={`New name for ${id}`}
			aria-invalid={!valid || undefined}
			className={className}
			value={value}
			onFocus={(e) => e.currentTarget.select()}
			onChange={(e) => setValue(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
			onKeyDown={(e) => {
				if (e.key === "Enter") (e.preventDefault(), finish(true));
				if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), finish(false));
			}}
			onBlur={() => finish(true)}
		/>
	);
}
