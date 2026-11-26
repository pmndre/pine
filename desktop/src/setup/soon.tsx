// A way to a model that the setup conversation offers and does not lead through yet: its card says
// where it is done meanwhile (Settings > Models). The API key and the model on this computer are
// this until their own modules take their line in branches.ts.
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { store } from "../model.ts";
import type { SetupBranch } from "./types.ts";

export function soon(id: string, label: string, description: string): SetupBranch {
	return {
		id,
		label,
		description,
		Card: ({ ctx }) => (
			<Item variant="outline" size="sm" data-slot="setup-soon">
				<ItemContent>
					<ItemTitle>{label}</ItemTitle>
					<ItemDescription className="line-clamp-none">This is set up in Settings › Models for now. Come back here once your agents have a model.</ItemDescription>
				</ItemContent>
				<ItemActions>
					<Button size="sm" variant="ghost" onClick={ctx.back}>Back</Button>
					<Button size="sm" variant="outline" onClick={() => store.openSettings("models")}>Settings › Models</Button>
				</ItemActions>
			</Item>
		),
	};
}
