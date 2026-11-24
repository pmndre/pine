// The rows of the lists the keyboard walks: the code pane's tree of folders and files and its lists
// of files, and the side bar's conversations. shadcn has neither primitive, and AI Elements' file tree
// gives every row a tab stop and no arrow keys, so both are ui-sdk's (`Tree`, `Listbox`), used directly,
// which keeps them one tab stop with the arrows, typing and Enter of the ARIA patterns. The lists of
// the palette and of the pick dialog are cmdk's (shadcn's Command): `useNamedLine` names their chosen line.

import { useEffect, useRef } from "react";

/** The props every keyboard list shares: Enter or a click opens a row, and no row stays selected (what is open is the app's state, shown by `rowClass`). */
export const LISTBOX = { activation: "manual", value: null } as const;

/** Hands a list's picked value on as the string it is, for `onValueChange`. */
export const onPick = (set: (value: string) => void) => (value: unknown) => {
	if (typeof value === "string") set(value);
};

/**
 * The class of a tree's item. In the tree the focus is on the item around the row, so the item draws no
 * outline and the row inside it shows the focus (`rowClass`).
 */
export const TREE_ITEM = "outline-none";

/**
 * A row of a list or of the tree: highlighted while it is the one open. The lists are one tab stop each, so
 * the row that has the keyboard shows it, also where the focus is on the tree's item around it (`TREE_ITEM`).
 */
export function rowClass(on?: boolean) {
	return `flex h-7 flex-none items-center gap-2 whitespace-nowrap px-2.5 text-xs outline-primary/60 -outline-offset-2 focus-visible:outline-2 [[data-slot=tree-item]:focus-visible>&]:outline-2 ${on ? "bg-press" : "hover:bg-accent"}`;
}

/** A value no line has: the list starts with no line chosen, until useNamedLine chooses one. */
const NO_LINE = "\u0000";

/**
 * The line a cmdk list has chosen, named to screen readers. The list is cmdk's own (uncontrolled):
 * it chooses the first line itself, the arrows and the pointer move it. But cmdk 1.1.1 names a line in
 * aria-activedescendant only when it is chosen from outside its own scheduling (a key, the pointer):
 * the line it chooses as the list is drawn or the text changes, and one handed to it with
 * `defaultValue`, are drawn chosen and not named. So the line is chosen once more as the pointer
 * would choose it, in cmdk's own store:
 * - as the list is put on the page, `start` (the line in use) or the first. The list starts on a value
 *   no line has (`defaultValue`), so that this choice is a change; it is made just after React puts
 *   the list there and before it is painted (during, cmdk would look for the line before it is drawn
 *   chosen and name none). A ref and not an effect: the dialog draws its content after itself.
 * - after the text changed (`redo`), once cmdk has chosen the first line: if it is not named, another
 *   line and then it, since cmdk ignores a choice of the line it has. A list of one line cannot be
 *   moved off it: its line is named on the field directly.
 * Returns the Command's `ref` and `defaultValue`.
 */
export function useNamedLine(redo: unknown, start?: string, ready = true) {
	const root = useRef<HTMLDivElement | null>(null);
	const point = (line: Element | null | undefined) => line?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
	const pointStart = (el: HTMLDivElement) => queueMicrotask(() => point(el.querySelector(start === undefined ? "[cmdk-item]" : `[cmdk-item][data-value="${CSS.escape(start)}"]`) ?? el.querySelector("[cmdk-item]")));
	const ref = (el: HTMLDivElement | null) => {
		if (!el || root.current) return;
		root.current = el;
		pointStart(el);
	};
	// A list first shown while its lines load (a picker opened before its data came) has no line to
	// start on when it is put on the page: point at `start` once the lines are there.
	const wasReady = useRef(ready);
	useEffect(() => {
		if (ready && !wasReady.current && root.current) pointStart(root.current);
		wasReady.current = ready;
	}, [ready]);
	const first = useRef(true);
	useEffect(() => {
		if (first.current) return void (first.current = false);
		const frame = requestAnimationFrame(() => {
			const el = root.current;
			const chosen = el?.querySelector('[cmdk-item][aria-selected="true"]');
			if (!el || !chosen || el.querySelector("[cmdk-input]")?.getAttribute("aria-activedescendant") === chosen.id) return;
			const other = [...el.querySelectorAll("[cmdk-item]")].find((line) => line !== chosen);
			if (other) (point(other), point(chosen));
			// A list of one line cannot be moved off it: its line is named here. React leaves the attribute
			// alone while cmdk's own value for it does not change, and cmdk names the next line it chooses.
			else el.querySelector("[cmdk-input]")?.setAttribute("aria-activedescendant", chosen.id);
		});
		return () => cancelAnimationFrame(frame);
	}, [redo]);
	return { ref, defaultValue: NO_LINE };
}
