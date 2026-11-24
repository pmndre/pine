// The browser of a conversation, in an aside of its own at the right of the window. It is the browser the agent works in:
// another process, behind pine's guard, without a window. What is shown here is a picture of its
// page that the daemon hands over again and again, and what is done in the picture (a click, the
// wheel, keys, an address) goes back to it through the daemon. Nothing of a web page is loaded
// into this window: the picture is drawn, and its address and title are text.
import { ChevronLeftIcon, ChevronRightIcon, EyeIcon, GlobeIcon, PlusIcon, RotateCwIcon, ShieldIcon, XIcon } from "lucide-react";
import { useMediaQuery } from "usehooks-ts";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { SideSheet } from "@/components/side-sheet";
import { ButtonGroup } from "@/components/ui/button-group";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEffect, useRef, useState } from "react";
import { api, type BrowserState, media } from "./api.ts";
import { bridge } from "./bridge.ts";
import { ROOM, store, type Tab, useModel } from "./model.ts";
import { errText, macKeys, shortcut } from "./text.ts";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { HoverTooltip } from "@/components/hover-tooltip";
import { EmptyView } from "@/components/empty-view";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Pulse } from "@/components/pulse";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Op = Record<string, unknown> & { do: string };

/**
 * A key as the browser's own keyboard names it, with what is held down with it; nothing for a key that only types its letter.
 * The key of shortcuts here (⌘ on a Mac, Ctrl elsewhere) goes as the shortcut key of the system the agent's browser runs
 * on (`ControlOrMeta`, which that browser's Playwright resolves), so that select all or undo mean the same with a pine on
 * another machine. The other of the two goes as itself.
 */
function keyOf(e: React.KeyboardEvent): string | undefined {
	const mac = macKeys();
	const held = `${(mac ? e.metaKey : e.ctrlKey) ? "ControlOrMeta+" : ""}${mac && e.ctrlKey ? "Control+" : ""}${!mac && e.metaKey ? "Meta+" : ""}${e.altKey ? "Alt+" : ""}`;
	const named = ["Enter", "Backspace", "Tab", "Escape", "Delete", "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "F5"].includes(e.key);
	if (named) return `${held}${e.shiftKey ? "Shift+" : ""}${e.key}`;
	// A letter or a digit with Cmd or Ctrl: select all, copy inside the page, undo.
	if ((e.metaKey || e.ctrlKey) && /^(Key[A-Z]|Digit[0-9])$/.test(e.code)) return `${held}${e.shiftKey ? "Shift+" : ""}${e.code}`;
	return undefined;
}

export function BrowserView({ tab }: { tab: Tab }) {
	useModel(tab);
	const canvas = useRef<HTMLCanvasElement>(null);
	const line = useRef<HTMLInputElement>(null);
	const [state, setState] = useState<BrowserState>();
	const [lookError, setLookError] = useState<string>();
	const [address, setAddress] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [drawn, setDrawn] = useState(false);
	/** What was done and is not sent yet: typing and the wheel come in bursts, and go as one. */
	const pending = useRef<{ ops: Op[]; timer?: number; sending: boolean }>({ ops: [], sending: false });
	/** When the owner last did something in the page: pictures come one right after another for a while after it. */
	const lastAct = useRef(0);
	/** Asks where the browser is now (the look below). */
	const lookNow = useRef<() => void>(undefined);
	/** How many pixels of the picture make one point of the page (2: as sharp as a Retina display draws). */
	const scale = useRef(1);
	scale.current = state?.scale ?? 1;
	/** The app could not lay its own browser over the panel (another machine's pine): pictures, then. */
	const [noPage, setNoPage] = useState(false);
	/** The browser is the app's own, and this bridge lays its page over the panel: the page itself is there, not pictures. */
	const inApp = state?.open && state.room && bridge?.browserShow && !noPage ? state.room : undefined;
	const hosted = Boolean(state?.room);
	const front = state?.tabs[state.current];
	/** What the empty view offers: the ports of the conversation's running programs, and what the agent opened that is not one of those. */
	const running = tab.programs.flatMap((p) => p.ports.map((port) => ({ port, command: p.command })));
	const visited = (state?.visited ?? []).filter((url) => !running.some((r) => new RegExp(`^https?://(localhost|127\\.0\\.0\\.1):${r.port}/?$`).test(url)));

	const took = (next: BrowserState | undefined) => {
		if (!next) return;
		setState(next);
		if (next.error) store.flash(next.error, "warn", 6000);
	};

	// Where the browser is: asked while this view is open, and again after the agent used it.
	useEffect(() => {
		let over = false;
		const look = () => void api.browser(tab.agent, tab.session).then(
			(s) => {
				if (over) return;
				setState(s);
				setLookError(undefined);
			},
			(e) => !over && setLookError(errText(e)),
		);
		look();
		lookNow.current = look;
		// (The page in the app's own browser goes elsewhere without a word to this view: its address is asked for more often.)
		const timer = window.setInterval(look, hosted ? 700 : 1500);
		return () => {
			over = true;
			window.clearInterval(timer);
		};
	}, [tab.agent, tab.session, tab.codeTick, hosted]);

	// The picture: one after another while a page is open, each drawn when it is whole.
	const open = state?.open === true;
	useEffect(() => {
		if (!open || inApp) return void setDrawn(false);
		let over = false;
		let n = 0;
		let timer: number | undefined;
		const next = (after: number) => (timer = window.setTimeout(load, after));
		const load = () => {
			if (over) return;
			// A window that is not looked at asks for nothing.
			if (document.hidden) return next(1000);
			const picture = new Image();
			picture.onload = () => {
				if (over) return;
				const c = canvas.current;
				if (c) {
					if (c.width !== picture.naturalWidth || c.height !== picture.naturalHeight) [c.width, c.height] = [picture.naturalWidth, picture.naturalHeight];
					c.getContext("2d")?.drawImage(picture, 0, 0);
					setDrawn(true);
				}
				// Right after the owner's hand, one picture after another, so that the page is seen answering it.
				next(performance.now() - lastAct.current < 2000 ? 0 : 120);
			};
			// No picture this time (the page is busy, or it was closed): the last one stays, and it is asked again.
			picture.onerror = () => next(700);
			picture.src = media.browser(tab.agent, tab.session, ++n);
		};
		load();
		return () => {
			over = true;
			window.clearTimeout(timer);
		};
	}, [open, tab.agent, tab.session, inApp]);

	// The page is laid out for the room it has here, so that it is shown point for point: said when the
	// view opens and when the panel is made wider or narrower.
	const room = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = room.current;
		if (!open || inApp || !el) return;
		const fit = () => {
			const box = el.getBoundingClientRect();
			const [w, h] = [Math.round(box.width), Math.round(box.height)];
			const c = canvas.current;
			// (The picture has scale pixels for a point of the room.)
			if (w >= 320 && h >= 240 && c && (Math.round(c.width / scale.current) !== w || Math.round(c.height / scale.current) !== h)) act({ do: "size", w, h }, 250);
		};
		fit();
		const watch = new ResizeObserver(fit);
		watch.observe(el);
		return () => watch.disconnect();
	}, [open, inApp]);

	const flush = async () => {
		const p = pending.current;
		window.clearTimeout(p.timer);
		p.timer = undefined;
		if (p.sending || !p.ops.length) return;
		p.sending = true;
		const ops = p.ops.splice(0);
		try {
			took(await api.browserInput(tab.agent, tab.session, ops));
			// A click or a key may take the page somewhere else after the answer came: the address is asked again then.
			if (ops.some((op) => !["move", "wheel", "text", "size"].includes(op.do))) window.setTimeout(() => lookNow.current?.(), 700);
		} catch (e) {
			store.flash(errText(e), "bad");
		}
		p.sending = false;
		if (p.ops.length) void flush();
	};
	/** Queue something that was done. `wait`: how long more of the same may still join it. */
	const act = (op: Op, wait = 0) => {
		const p = pending.current;
		// (Not the pointer passing over the page: a picture after another would be taken all the while it rests there.)
		if (op.do !== "size" && op.do !== "move") lastAct.current = performance.now();
		const last = p.ops.at(-1);
		// Letters join the letters before them, the wheel adds up, and of the pointer's way only the end counts.
		if (op.do === "text" && last?.do === "text") last.text = `${last.text}${op.text}`;
		else if (op.do === "wheel" && last?.do === "wheel") [last.dx, last.dy] = [Number(last.dx) + Number(op.dx), Number(last.dy) + Number(op.dy)];
		else if (op.do === "move" && last?.do === "move") [last.x, last.y] = [op.x, op.y];
		else if (op.do === "size" && last?.do === "size") [last.w, last.h] = [op.w, op.h];
		else p.ops.push(op);
		window.clearTimeout(p.timer);
		if (wait) p.timer = window.setTimeout(() => void flush(), wait);
		else void flush();
	};

	/** A place in the window as a place in the page: the picture is the page, scale pixels for a point, drawn smaller or larger. */
	const at = (e: { clientX: number; clientY: number }) => {
		const c = canvas.current!;
		const box = c.getBoundingClientRect();
		const [w, h] = [c.width / scale.current, c.height / scale.current];
		return { x: Math.round(((e.clientX - box.left) * w) / box.width), y: Math.round(((e.clientY - box.top) * h) / box.height) };
	};
	const down = useRef<{ x: number; y: number }>(undefined);

	const go = async (url: string) => {
		if (!url.trim()) return;
		setBusy(true);
		try {
			took(await api.browserOpen(tab.agent, tab.session, url.trim()));
			setAddress(undefined);
			canvas.current?.focus();
		} catch (e) {
			store.flash(errText(e), "bad");
		}
		setBusy(false);
	};

	return (
		<div data-slot="browser" className="flex min-h-0 flex-1 flex-col overflow-hidden">
			{open && state.tabs.length ? (
				<div className="flex flex-none items-center gap-0.5 border-b border-line-soft px-2 pt-1">
					{/* The row scrolls sideways only. The padding is the room for the line under the tab in front, which stock draws
					    below the list: without it the row is taller than its room, and a vertical bar shows with nothing to scroll. */}
					<ScrollArea className="flex min-h-0 min-w-0 flex-initial flex-col *:data-[slot=scroll-area-viewport]:scroll-fade-x">
						<div className="pb-1.5">
						<Tabs value={state.current} onValueChange={(i) => i !== state.current && act({ do: "tab", index: i as number })}>
							<TabsList variant="line">
					{state.tabs.map((t, i) => (
						<div key={i} className="group/tab flex h-full min-w-15 flex-initial basis-44 items-center" title={t.url}>
							<TabsTrigger value={i} className="min-w-0 justify-start">
								<span className="min-w-0 flex-1 truncate text-left">{t.title || (t.url === "about:blank" ? "New tab" : t.url)}</span>
							</TabsTrigger>
							{/* (Closing the last tab leaves the browser up without a page: the view is empty again.) */}
							<Button variant="ghost" size="icon-xs" aria-label={state.tabs.length > 1 ? "Close this tab" : "Close the page"} className={cn(i !== state.current && "invisible group-hover/tab:visible")} onClick={() => act({ do: "closetab", index: i })}><XIcon /></Button>
						</div>
					))}
							</TabsList>
						</Tabs>
						</div>
					</ScrollArea>
					<HoverTooltip>
						<TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="A new tab" onClick={() => (act({ do: "newtab" }), line.current?.focus())} />}><PlusIcon /></TooltipTrigger>
						<TooltipContent>A new tab</TooltipContent>
					</HoverTooltip>
				</div>
			) : null}
			<div className="flex flex-none items-center gap-0.5 border-b border-line-soft px-2 py-1.5">
				<ButtonGroup>
					<HoverTooltip>
						<TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Back" disabled={!open} onClick={() => act({ do: "back" })} />}><ChevronLeftIcon /></TooltipTrigger>
						<TooltipContent>Back</TooltipContent>
					</HoverTooltip>
					<HoverTooltip>
						<TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Forward" disabled={!open} onClick={() => act({ do: "forward" })} />}><ChevronRightIcon /></TooltipTrigger>
						<TooltipContent>Forward</TooltipContent>
					</HoverTooltip>
					<HoverTooltip>
						<TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Load the page again" disabled={!open} onClick={() => act({ do: "reload" })} />}><RotateCwIcon /></TooltipTrigger>
						<TooltipContent>Load the page again</TooltipContent>
					</HoverTooltip>
				</ButtonGroup>
				<InputGroup className="ml-1 min-w-0 flex-1">
					<InputGroupInput
						aria-label="Address"
						className="min-w-0"
						spellCheck={false}
						placeholder="An address: example.com, or localhost:3000"
						ref={line}
						value={address ?? (front?.url === "about:blank" ? "" : (front?.url ?? ""))}
						onChange={(e) => setAddress(e.target.value)}
						onFocus={(e) => e.target.select()}
						onBlur={() => setAddress(undefined)}
						onKeyDown={(e) => {
							if (e.key === "Enter") void go(e.currentTarget.value);
							if (e.key === "Escape") (setAddress(undefined), e.currentTarget.blur());
						}}
					/>
					{busy ? <InputGroupAddon align="inline-end"><Pulse label="Loading" /></InputGroupAddon> : null}
				</InputGroup>
			</div>
			{inApp ? (
				<HostedPage room={inApp} index={state?.current ?? 0} title={front?.title} refused={() => setNoPage(true)} />
			) : open ? (
				<ScrollArea ref={room} className="flex min-h-0 flex-1 flex-col bg-press *:data-[slot=scroll-area-viewport]:scroll-fade">
					{/* The page keeps its shape: as wide as the panel, and scrolled down to when it is taller than the room. */}
					<canvas
						ref={canvas}
						tabIndex={0}
						data-drawn={drawn || undefined}
						className={cn("block h-auto w-full cursor-default bg-white outline-none", !drawn && "invisible")}
						title={front?.title}
						onMouseDown={(e) => {
							e.currentTarget.focus();
							down.current = at(e);
						}}
						onMouseUp={(e) => {
							const from = down.current;
							down.current = undefined;
							if (!from) return;
							const to = at(e);
							// The button held down over a way is a drag (a slider, a selection); let go where it went down, a click.
							if (Math.abs(to.x - from.x) + Math.abs(to.y - from.y) > 8) act({ do: "drag", ...from, x2: to.x, y2: to.y });
							else act({ do: "click", ...to, button: e.button === 2 ? "right" : e.button === 1 ? "middle" : "left", count: Math.min(3, Math.max(1, e.detail)) });
						}}
						onMouseMove={(e) => !down.current && act({ do: "move", ...at(e) }, 120)}
						onContextMenu={(e) => e.preventDefault()}
						onWheel={(e) => act({ do: "wheel", dx: e.deltaX, dy: e.deltaY }, 60)}
						onPaste={(e) => {
							e.preventDefault();
							const text = e.clipboardData.getData("text/plain");
							if (text) act({ do: "text", text });
						}}
						onKeyDown={(e) => {
							// Pasting is the window's own business: what is in the clipboard arrives as text (onPaste).
							if ((e.metaKey || e.ctrlKey) && e.code === "KeyV") return;
							const key = keyOf(e);
							if (key) (e.preventDefault(), act({ do: "key", key }));
							else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) (e.preventDefault(), act({ do: "text", text: e.key }, 90));
						}}
					/>
					{drawn ? null : <BrowserSkeleton className="absolute inset-0" />}
				</ScrollArea>
			) : !state ? (
				lookError ? <EmptyView icon={EyeIcon} title="The browser cannot be reached">{lookError}</EmptyView> : <BrowserSkeleton className="min-h-0 flex-1" />
			) : (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<EyeIcon />
						</EmptyMedia>
						<EmptyTitle>No page is open</EmptyTitle>
						<EmptyDescription>This is the browser the agent of this conversation works in. A page it opens is shown here as it is, and you can use it too: click, type, log in. Type an address above to open one yourself.</EmptyDescription>
					</EmptyHeader>
					{/* What the conversation's own programs listen on (the code pane's Running): a server the agent started is one click away. */}
					{running.length ? (
						<EmptyContent data-offer="running">
							<EmptyDescription>Running in this conversation</EmptyDescription>
							{running.map((r) => (
								<HoverTooltip key={r.port}>
									<TooltipTrigger render={<Button variant="link" size="xs" className="max-w-full font-mono" disabled={busy} onClick={() => void go(`http://localhost:${r.port}`)} />}><span className="truncate">localhost:{r.port}</span></TooltipTrigger>
									<TooltipContent>{r.command}</TooltipContent>
								</HoverTooltip>
							))}
						</EmptyContent>
					) : null}
					{visited.length ? (
						<EmptyContent data-offer="visited">
							<EmptyDescription>Opened by the agent before</EmptyDescription>
							{/* (An address is text an agent chose: drawn as text, whole in the tooltip, and opened only by this click.) */}
							{visited.map((url) => (
								<HoverTooltip key={url}>
									<TooltipTrigger render={<Button variant="link" size="xs" className="max-w-full font-mono" disabled={busy} onClick={() => void go(url)} />}><span className="truncate">{url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span></TooltipTrigger>
									<TooltipContent>{url}</TooltipContent>
								</HoverTooltip>
							))}
						</EmptyContent>
					) : null}
				</Empty>
			)}
			{open ? <div className="flex flex-none items-center gap-1.5 border-t border-line-soft px-2.5 py-1 text-xs text-faint"><ShieldIcon size={11} /><span className="truncate">The agent's browser, behind pine's guard. What you do here, the agent sees when it next looks.</span></div> : null}
		</div>
	);
}

/** What the app draws itself and lays over everything, the page in its panel among it: a dialog, a sheet, wherever it lies. */
const COVERS = "[data-slot=dialog-content],[data-slot=alert-dialog-content],[data-slot=sheet-content]";
/** What the app draws over a part of the window: a menu, a popover, a tooltip, a toast. */
const OVER = ["popover-content", "dropdown-menu-content", "dropdown-menu-sub-content", "context-menu-content", "context-menu-sub-content", "select-content", "combobox-content", "hover-card-content", "tooltip-content", "toast-content"].map((s) => `[data-slot=${s}]`).join(",");

/** Whether something of the app's own lies over the place of the page: the page, a window of its own above the app's, would hide it. */
function covered(el: HTMLElement, r: DOMRect): boolean {
	for (const o of document.querySelectorAll(COVERS)) if (!o.contains(el) && o.getClientRects().length) return true;
	for (const o of document.querySelectorAll(OVER)) {
		const b = o.getBoundingClientRect();
		if (b.width && b.height && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top) return true;
	}
	return false;
}

/**
 * The agent's browser as the app's own (electron/browser-host.ts): its page is laid over this place by the main
 * process, the page itself with its cursor, its scrolling and its keys. Followed every frame while the panel moves or
 * changes size. While something of the app's own lies over it (a dialog, a menu), the page is taken away and a still
 * picture of it stands in its place, so that what the app shows is seen and can be answered.
 */
function HostedPage({ room, index, title, refused }: { room: string; index: number; title?: string; refused: () => void }) {
	const place = useRef<HTMLDivElement>(null);
	const [still, setStill] = useState<string>();
	useEffect(() => {
		const show = bridge!.browserShow!;
		let over = false;
		let last = "";
		let misses = 0;
		let frame = 0;
		let timer: number | undefined;
		const hide = () => void show(undefined, 0, undefined).catch(() => {});
		const tick = async () => {
			const el = place.current;
			let wait = 0;
			if (el) {
				const r = el.getBoundingClientRect();
				const box = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
				const away = box.width < 1 || box.height < 1 || covered(el, r);
				const now = away ? "away" : `${index} ${box.x} ${box.y} ${box.width} ${box.height}`;
				if (now !== last) {
					const was = last;
					last = now;
					if (away) {
						if (was && was !== "away") {
							const picture = await bridge!.browserPicture?.().catch(() => undefined);
							if (!over) setStill(picture);
						}
						hide();
					} else {
						const shown = await show(room, index, box).catch(() => false);
						if (over) return hide();
						if (shown) (setStill(undefined), (misses = 0));
						else {
							// The tab is not there yet (the browser is being moved into the app), or never will be.
							last = "";
							wait = 300;
							if (++misses > 20) return refused();
						}
					}
				}
			}
			if (over) return;
			if (wait) timer = window.setTimeout(() => void tick(), wait);
			else frame = requestAnimationFrame(() => void tick());
		};
		void tick();
		return () => {
			over = true;
			cancelAnimationFrame(frame);
			window.clearTimeout(timer);
			hide();
		};
	}, [room, index]);
	return (
		<div ref={place} data-slot="browser-page" title={title} className="relative min-h-0 flex-1 bg-white">
			{still ? <img src={still} alt="" className="absolute inset-0 size-full object-cover object-left-top" /> : null}
		</div>
	);
}

/** A page while it loads: a header bar, a title and lines of text, from stock Skeleton blocks. Shown while the browser is looked for and before the first picture. */
export function BrowserSkeleton({ className }: { className?: string }) {
	return (
		<div data-slot="browser-skeleton" className={cn("flex flex-col gap-3 bg-background p-4", className)}>
			<Skeleton className="h-8 w-full" />
			<Skeleton className="mt-2 h-6 w-2/3" />
			<Skeleton className="h-4 w-full" />
			<Skeleton className="h-4 w-5/6" />
			<Skeleton className="h-4 w-3/4" />
			<Skeleton className="mt-2 h-32 w-full" />
		</div>
	);
}

export const ASIDE_KEY = "pine.aside.width";

/**
 * The browser's aside, at the right of the window after the side panel: a bar with its name and
 * its close button, and the browser under it. Where the window has no room for columns it is a
 * sheet over the conversation, like the side panel, and putting the sheet away closes it.
 */
export function BrowserAside({ tab }: { tab: Tab }) {
	const sheet = !useMediaQuery(ROOM);
	return (
		<SideSheet
			id="browser-panel"
			slot="browser-aside"
			title="Browser"
			sheet={sheet}
			widthKey={ASIDE_KEY}
			defaultWidth={560}
			barClassName="pl-3 text-sm font-medium"
			onClose={() => void store.command("browser")}
			bar={
				<>
					<GlobeIcon className="size-3.5 text-muted-foreground" />
					<span className="min-w-0 flex-1 truncate">Browser</span>
					<HoverTooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={() => void store.command("browser")} aria-label="Close the browser"><XIcon /></Button>} /><TooltipContent>Close the browser<Kbd>{shortcut("⇧⌘B")}</Kbd></TooltipContent></HoverTooltip>
				</>
			}
		>
			<BrowserView tab={tab} />
		</SideSheet>
	);
}
