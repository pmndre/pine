import { type ComponentProps, type ComponentType, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HoverTooltip } from "@/components/hover-tooltip";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type Selected = { text: string; rect: DOMRect };

const GAP = 8;
const MARGIN = 8;

function within(root: HTMLElement, node: Node | null): boolean {
	if (!node || !root.contains(node)) return false;
	const el = node instanceof Element ? node : node.parentElement;
	return !el?.closest("input, textarea, [contenteditable=''], [contenteditable='true']");
}

function read(root: HTMLElement | null): Selected | undefined {
	const sel = window.getSelection();
	if (!root || !sel || sel.isCollapsed || !sel.rangeCount) return undefined;
	if (!within(root, sel.anchorNode) || !within(root, sel.focusNode)) return undefined;
	const text = sel.toString();
	if (!text.trim()) return undefined;
	const range = sel.getRangeAt(0);
	const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
	const all = range.getBoundingClientRect();
	if (!rects.length) return { text, rect: all };
	const top = Math.min(...rects.map((r) => r.top));
	const first = rects.filter((r) => r.top < top + r.height / 2);
	const left = Math.min(...first.map((r) => r.left));
	const right = Math.max(...first.map((r) => r.right));
	return { text, rect: new DOMRect(left, top, right - left, all.bottom - top) };
}

export function useTextSelection(root: RefObject<HTMLElement | null>): [Selected | undefined, () => void] {
	const [selected, setSelected] = useState<Selected | undefined>();
	const shown = useRef(false);
	shown.current = Boolean(selected);
	const pressing = useRef(false);
	const hide = useCallback(() => setSelected(undefined), []);
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const settle = (wait: number) => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				if (!pressing.current) setSelected(read(root.current));
			}, wait);
		};
		const down = (e: MouseEvent) => {
			if (e.button !== 0 || (e.target instanceof Element && e.target.closest("[data-slot=selection-toolbar]"))) return;
			pressing.current = true;
			setSelected(undefined);
		};
		const up = () => {
			if (!pressing.current) return;
			pressing.current = false;
			settle(0);
		};
		const changed = () => {
			if (pressing.current) return;
			if (!read(root.current)) return setSelected(undefined);
			settle(150);
		};
		const key = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || !shown.current) return;
			e.stopPropagation();
			setSelected(undefined);
		};
		const scrolled = (e: Event) => {
			if (shown.current && e.target instanceof Node && root.current?.contains(e.target)) setSelected(undefined);
		};
		document.addEventListener("mousedown", down, true);
		document.addEventListener("mouseup", up, true);
		document.addEventListener("selectionchange", changed);
		document.addEventListener("keydown", key, true);
		document.addEventListener("scroll", scrolled, { capture: true, passive: true });
		window.addEventListener("resize", hide);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("mousedown", down, true);
			document.removeEventListener("mouseup", up, true);
			document.removeEventListener("selectionchange", changed);
			document.removeEventListener("keydown", key, true);
			document.removeEventListener("scroll", scrolled, true);
			window.removeEventListener("resize", hide);
		};
	}, [root, hide]);
	return [selected, hide];
}

type Place = { top: number; left: number; below: boolean };

function place(rect: DOMRect, size: { width: number; height: number }, bounds?: DOMRect): Place {
	const area = bounds ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
	const half = size.width / 2;
	const center = rect.left + rect.width / 2;
	const left = Math.min(Math.max(center, area.left + half + MARGIN), Math.max(area.left + half + MARGIN, area.right - half - MARGIN));
	const below = rect.top - GAP - size.height < area.top + MARGIN;
	const top = below ? Math.min(rect.bottom + GAP, area.bottom - size.height - MARGIN) : rect.top - GAP - size.height;
	return { top, left: left - half, below };
}

export function SelectionToolbar({ rect, bounds, className, style, children, ...props }: ComponentProps<"div"> & { rect?: DOMRect; bounds?: RefObject<HTMLElement | null> }) {
	const ref = useRef<HTMLDivElement>(null);
	const [at, setAt] = useState<Place>();
	useLayoutEffect(() => {
		const el = ref.current;
		if (!rect || !el) return setAt(undefined);
		setAt(place(rect, { width: el.offsetWidth, height: el.offsetHeight }, bounds?.current?.getBoundingClientRect()));
	}, [rect, bounds]);
	const bar = (
		<ButtonGroup
			ref={ref}
			role="toolbar"
			aria-orientation="horizontal"
			aria-label="Selected text"
			data-slot="selection-toolbar"
			data-side={at?.below ? "bottom" : "top"}
			onMouseDown={(e) => e.preventDefault()}
			className={cn("z-50 gap-0.5 rounded-lg border bg-popover p-0.5 text-popover-foreground shadow-md select-none", rect && "fixed animate-in fade-in-0 zoom-in-95", rect && !at && "invisible", className)}
			style={rect ? { top: at?.top ?? 0, left: at?.left ?? 0, ...style } : style}
			{...props}
		>
			{children}
		</ButtonGroup>
	);
	return rect ? createPortal(bar, document.body) : bar;
}

export function SelectionToolbarButton({ icon: Icon, label, ...props }: ComponentProps<typeof Button> & { icon: ComponentType; label: string }) {
	return (
		<HoverTooltip>
			<TooltipTrigger render={<Button variant="ghost" size="sm" className="rounded-md!" {...props} />}>
				<Icon data-icon="inline-start" />
				{label}
			</TooltipTrigger>
			<TooltipContent>{label} the selected text</TooltipContent>
		</HoverTooltip>
	);
}
