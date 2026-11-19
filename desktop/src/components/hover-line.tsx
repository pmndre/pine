import { Badge } from "@/components/ui/badge";
import type { Line } from "../birdview-layout.ts";

/**
 * The one line the bird's-eye view shows for what the pointer is on: pine's words for it, then the
 * content it carried as plain text, cut to one line, with an "outside" badge when the content did
 * not come from the owner. React writes it as text: nothing in it is markup, a link or a picture.
 */
export function HoverLine({ line }: { line?: Line }) {
	return (
		<p data-slot="hover-line" className="flex h-6 min-w-0 items-center gap-2 text-sm">
			{line ? (
				<>
					<span className="max-w-1/2 shrink-0 truncate font-medium">{line.label}</span>
					{line.hover ? <span className="min-w-0 truncate text-muted-foreground">{line.hover.text}</span> : null}
					{line.hover?.outside ? <Badge variant="outline">outside</Badge> : null}
				</>
			) : (
				<span className="truncate text-muted-foreground">Point at an agent, a line or a pulse to read what it is.</span>
			)}
		</p>
	);
}
