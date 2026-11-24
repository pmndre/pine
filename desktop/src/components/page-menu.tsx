import { Fragment, useEffect, useRef, useState } from "react";
import { bridge } from "../bridge.ts";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type MenuEntry = { id: string; label: string; enabled?: boolean; separator?: boolean; danger?: boolean; checked?: boolean };

type Request = { items: MenuEntry[]; at: { x: number; y: number }; done: (id?: string) => void };

let at = { x: 0, y: 0 };
let show: ((r: Request) => void) | undefined;

window.addEventListener("contextmenu", (e) => void (at = { x: e.clientX, y: e.clientY }), true);

export function contextMenu(items: MenuEntry[]): Promise<string | undefined> {
	if (bridge.contextMenu) return bridge.contextMenu(items);
	if (!show) return Promise.resolve(undefined);
	const open = show;
	return new Promise((done) => open({ items, at: { ...at }, done }));
}

export function PageMenus() {
	const [shown, setShown] = useState<Request & { key: number }>();
	useEffect(() => {
		let key = 0;
		show = (r) => setShown((was) => (was?.done(), { ...r, key: ++key }));
		return () => void (show = undefined);
	}, []);
	if (!shown) return null;
	return <PageMenu key={shown.key} items={shown.items} at={shown.at} onDone={shown.done} onGone={() => setShown((was) => (was?.key === shown.key ? undefined : was))} />;
}

export function PageMenu({ items, at, onDone, onGone }: { items: MenuEntry[]; at: { x: number; y: number }; onDone: (id?: string) => void; onGone?: () => void }) {
	const [open, setOpen] = useState(true);
	const [back] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
	const ended = useRef(false);
	const end = (id?: string) => {
		if (ended.current) return;
		ended.current = true;
		setOpen(false);
		onDone(id);
	};
	const runs = items.reduce<MenuEntry[][]>((all, i) => (i.separator ? all.push([]) : all[all.length - 1].push(i), all), [[]]).filter((run) => run.length);
	const entry = (i: MenuEntry) =>
		typeof i.checked === "boolean" ? (
			<DropdownMenuRadioItem key={i.id} value={i.id} closeOnClick disabled={i.enabled === false} onClick={() => end(i.id)}>
				{i.label}
			</DropdownMenuRadioItem>
		) : (
			<DropdownMenuItem key={i.id} variant={i.danger ? "destructive" : "default"} disabled={i.enabled === false} onClick={() => end(i.id)}>
				{i.label}
			</DropdownMenuItem>
		);
	return (
		<DropdownMenu open={open} onOpenChange={(now) => now || queueMicrotask(() => end())} onOpenChangeComplete={(now) => now || onGone?.()}>
			<DropdownMenuTrigger render={<button type="button" tabIndex={-1} aria-hidden className="pointer-events-none fixed size-0" style={{ left: at.x, top: at.y }} />} />
			<DropdownMenuContent className="w-auto min-w-48" finalFocus={back ? { current: back } : false}>
				{runs.map((run, n) => (
					<Fragment key={n}>
						{n ? <DropdownMenuSeparator /> : null}
						{run.some((i) => typeof i.checked === "boolean") ? (
							<DropdownMenuRadioGroup value={run.find((i) => i.checked)?.id ?? ""}>{run.map(entry)}</DropdownMenuRadioGroup>
						) : (
							<DropdownMenuGroup>{run.map(entry)}</DropdownMenuGroup>
						)}
					</Fragment>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
