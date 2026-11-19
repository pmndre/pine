import { cn } from "cn";
import type { Histogram } from "../birdview.ts";

/**
 * How much happened over the bird's-eye view's window, as bars, the newest on the right. Read
 * only: it says when pine was busy, and selecting a range in it does nothing.
 */
export function ActivityStrip({ histogram, className }: { histogram: Histogram; className?: string }) {
	const { counts, size } = histogram;
	const max = Math.max(1, ...counts);
	const total = counts.reduce((a, b) => a + b, 0);
	const minutes = Math.round((size * counts.length) / 60_000);
	return (
		<div data-slot="activity-strip" className={cn("flex flex-col gap-1", className)}>
			<div role="img" aria-label={`${total} events over the last ${minutes} minutes`} className="flex h-10 items-end gap-px">
				{counts.map((n, i) => (
					<div
						// The buckets are positions on the strip, not things that move.
						key={i}
						className={cn("flex-1 rounded-t-sm", i === counts.length - 1 ? "bg-primary" : "bg-primary/40")}
						style={{ height: n ? `${Math.max(8, (n / max) * 100)}%` : "1px" }}
					/>
				))}
			</div>
			<div className="flex justify-between text-xs text-muted-foreground">
				<span>{minutes} min ago</span>
				<span>{total} events</span>
				<span>now</span>
			</div>
		</div>
	);
}
