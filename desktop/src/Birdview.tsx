// The bird's-eye view: every agent and what it is doing, drawn from the model (birdview.ts). It
// does no I/O: the model comes in, clicks go out as callbacks that only navigate. The drawing itself
// is a direction passed as children (the switchboard or the constellation), so that both share the
// layers, the hover line and the activity strip.
import { useState, type ReactNode } from "react";
import { ActivityStrip } from "@/components/activity-strip";
import { HoverLine } from "@/components/hover-line";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { BirdviewModel } from "./birdview.ts";
import { DEFAULT_LAYERS, describe, LAYERS, type Layer, pick, withLayers } from "./birdview-layout.ts";

/** What a direction of the view is handed to draw. */
export interface DrawProps {
	/** The model with only the layers that are on. */
	model: BirdviewModel;
	/** The id under the pointer: a node, `link:<id>` or `pulse:<id>`. */
	hovered?: string;
	onHover: (id: string | undefined) => void;
	onPick: (id: string) => void;
}

export interface BirdviewProps {
	model: BirdviewModel;
	/** The layers on at first; the app keeps the owner's choice. */
	defaultLayers?: Layer[];
	onLayersChange?: (layers: Layer[]) => void;
	/** An agent was clicked: open its agent panel. */
	onAgent?: (agent: string) => void;
	/** A conversation, a sub-agent or a delegation was clicked: open that conversation. */
	onConversation?: (agent: string, session: string) => void;
	/** A source or a schedule was clicked (`source:<key>`, `schedule:<key>`): open its Settings page. */
	onSetting?: (id: string) => void;
	/** A pulse was clicked: open the Events tab on its topic. */
	onEvents?: (topic: string) => void;
	children: (props: DrawProps) => ReactNode;
}

export function Birdview({ model, defaultLayers = DEFAULT_LAYERS, onLayersChange, onAgent, onConversation, onSetting, onEvents, children }: BirdviewProps) {
	const [layers, setLayers] = useState<Layer[]>(defaultLayers);
	const [hovered, setHovered] = useState<string>();
	const shown = withLayers(model, layers);
	const choose = (id: string) => {
		const p = pick(shown, id);
		if (p?.to === "agent") onAgent?.(p.agent);
		else if (p?.to === "conversation") onConversation?.(p.agent, p.session);
		else if (p?.to === "setting") onSetting?.(p.id);
		else if (p?.to === "events") onEvents?.(p.topic);
	};
	return (
		<div data-slot="birdview" className="flex size-full min-h-0 flex-col bg-background text-foreground">
			<div className="flex items-center gap-2 overflow-x-auto border-b px-4 py-2">
				<ToggleGroup
					multiple
					size="sm"
					variant="outline"
					spacing={0}
					aria-label="Layers"
					value={layers}
					onValueChange={(value) => {
						const next = value as Layer[];
						setLayers(next);
						onLayersChange?.(next);
					}}
				>
					{LAYERS.map((l) => (
						<ToggleGroupItem key={l.id} value={l.id}>
							{l.label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</div>
			<div className="relative min-h-0 flex-1">{children({ model: shown, hovered, onHover: setHovered, onPick: choose })}</div>
			<div className="flex flex-col gap-2 border-t px-4 py-2">
				<HoverLine line={hovered ? describe(shown, hovered) : undefined} />
				<ActivityStrip histogram={model.histogram} />
			</div>
		</div>
	);
}
