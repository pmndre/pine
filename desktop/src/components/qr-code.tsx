import { cn } from "cn";
import type { ComponentProps } from "react";
import { encode } from "uqr";
import { Skeleton } from "@/components/ui/skeleton";

/** The empty modules around the code that a reader needs to find it: four, as the standard asks. */
const QUIET_ZONE = 4;

/**
 * A QR code of `value`, drawn as SVG: one path of the dark modules on a light square, each module a
 * unit of the view box, so that it scales to any size without blurring. Black on white in every theme:
 * cameras read a dark code on a light ground, and many cannot read it inverted.
 */
export function QrCode({ value, label, className, skeleton, ...props }: ({ value: string; label: string; skeleton?: false } | { value?: undefined; label?: undefined; /** While the value loads: a square the code's size. */ skeleton: true }) & Omit<ComponentProps<"svg">, "children" | "viewBox">) {
	// The caller sizes the code through className; the square takes the same one.
	if (skeleton || value === undefined) return <Skeleton className={cn("aspect-square", className)} />;
	const { size, data } = encode(value, { ecc: "M", border: QUIET_ZONE });
	let modules = "";
	data.forEach((row, y) => row.forEach((dark, x) => dark && (modules += `M${x} ${y}h1v1h-1z`)));
	return (
		<svg data-slot="qr-code" role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" className={cn("aspect-square bg-white", className)} {...props}>
			<path d={modules} className="fill-black" />
		</svg>
	);
}
