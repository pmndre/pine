// The owner's terminal beside a conversation (electron/terminal.ts): xterm.js draws it, the main
// process runs the shell. It starts in the conversation's folder, or in its agent's workspace, and
// goes on while the app runs: closing the panel or drawing it again only hands back what it printed.
// A code block that the owner runs from an answer (its Run button, markdown.tsx) waits in `tab.runs`
// until the shell is there; the main process types it, follows it to its end and says how it went,
// which the conversation is told (`onTermRun` in model.ts).
import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as Xterm, type ITheme } from "@xterm/xterm";
import { RotateCwIcon, SquareTerminalIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { HoverTooltip } from "@/components/hover-tooltip";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyView } from "@/components/empty-view";
import { Skeleton } from "@/components/ui/skeleton";
import { bridge } from "./bridge.ts";
import { SUB } from "./CodePanel.tsx";
import { store, type Tab, useModel } from "./model.ts";
import { errText, macKeys, tilde } from "./text.ts";
import { cn } from "@/lib/utils";

/** A color of the page's tokens, as xterm.js takes it: the browser says what any CSS color is in sRGB. */
function resolved(css: string, fallback: string): string {
	const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
	if (!ctx || !css.trim()) return fallback;
	ctx.fillStyle = fallback;
	ctx.fillStyle = css.trim();
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
	return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

const ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

/** The terminal's colors: the theme's (`--term-*`, set with the rest of the theme in theme.ts). */
function theme(): ITheme {
	const style = getComputedStyle(document.documentElement);
	const token = (name: string, fallback: string) => resolved(style.getPropertyValue(name), fallback);
	const colors: Record<string, string> = {};
	ANSI.forEach((name, i) => {
		colors[name] = token(`--term-${i}`, "#808080");
		colors[`bright${name[0].toUpperCase()}${name.slice(1)}`] = token(`--term-${i + 8}`, colors[name]);
	});
	return {
		...colors,
		background: token("--term-bg", token("--background", "#1b1e28")),
		foreground: token("--term-fg", token("--foreground", "#e4f0fb")),
		cursor: token("--term-cursor", token("--code-cursor", "#e4f0fb")),
		selectionBackground: token("--term-select", "rgba(113, 124, 180, 0.3)"),
	};
}

/** A terminal while its shell starts: a few short lines, from stock Skeleton blocks. */
export function TerminalSkeleton({ className }: { className?: string }) {
	return (
		<div data-slot="terminal-skeleton" className={cn("flex flex-col gap-2 bg-background p-3", className)}>
			<Skeleton className="h-3.5 w-1/2" />
			<Skeleton className="h-3.5 w-1/3" />
			<Skeleton className="h-3.5 w-2/5" />
		</div>
	);
}

/** The terminal of the conversation in `tab`. */
export function TerminalView({ tab }: { tab: Tab }) {
	useModel(tab);
	const host = useRef<HTMLDivElement>(null);
	const term = useRef<Xterm>(undefined);
	// A new shell after the last one ended, or after Restart: drawn again from nothing.
	const [round, setRound] = useState(0);
	const [state, setState] = useState<{ cwd?: string; ended?: number; error?: string }>({});
	const id = tab.key;

	useEffect(() => {
		const xterm = new Xterm({ fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--mono") || "monospace", fontSize: 12, lineHeight: 1.2, cursorBlink: true, allowProposedApi: false, scrollback: 5000, theme: theme(), macOptionIsMeta: true });
		const fit = new FitAddon();
		xterm.loadAddon(fit);
		xterm.open(host.current!);
		fit.fit();
		term.current = xterm;
		let gone = false;
		let open = false;
		setState({});
		// Off a Mac the app's shortcuts are Ctrl chords, as the shell's own keys are (Ctrl-W, Ctrl-K, Ctrl-R...): while the
		// terminal has the keyboard, the main process leaves those to the shell (`shellKeeps` in electron/terminal.ts).
		// Copying and pasting are Ctrl+Shift+C and Ctrl+Shift+V there, as in the system's own terminals.
		const keyboard = (has: boolean) => bridge.termFocus?.(has);
		const focused = () => keyboard(true);
		const blurred = () => keyboard(false);
		xterm.textarea?.addEventListener("focus", focused);
		xterm.textarea?.addEventListener("blur", blurred);
		if (!macKeys()) {
			xterm.attachCustomKeyEventHandler((e) => {
				if (e.type !== "keydown" || !e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return true;
				if (e.code === "KeyC") {
					if (xterm.hasSelection()) void navigator.clipboard.writeText(xterm.getSelection());
					e.preventDefault();
					return false;
				}
				// The browser pastes it as plain text into the terminal's input, which xterm.js takes as a paste.
				return e.code !== "KeyV";
			});
		}
		const typed = xterm.onData((data) => void bridge.termWrite(id, data));
		const sized = xterm.onResize(({ cols, rows }) => void bridge.termResize(id, cols, rows));
		const stopData = bridge.onTermData((which: string, data: string) => which === id && xterm.write(data));
		const stopExit = bridge.onTermExit((which: string, code: number) => which === id && setState((s) => ({ ...s, ended: code })));
		const resize = new ResizeObserver(() => {
			try {
				fit.fit();
			} catch {
				// not laid out yet
			}
		});
		resize.observe(host.current!);
		const recolor = () => (xterm.options.theme = theme());
		// A new theme (Settings > General) sets the root element's variables (its style attribute).
		const restyled = new MutationObserver(recolor);
		restyled.observe(document.documentElement, { attributes: true });
		bridge
			.termOpen(id, tab.folder ?? tab.workspace, xterm.cols, xterm.rows)
			.then((r) => {
				if (gone) return;
				if (r.kept) xterm.write(r.kept);
				open = true;
				setState({ cwd: r.cwd });
				drain();
				xterm.focus();
			})
			.catch((e) => !gone && setState({ error: errText(e) }));
		// Code the owner ran from an answer, once the shell is there. The main process types it and follows it to its end.
		const drain = () => {
			if (!open || gone) return;
			for (const code of tab.runs.splice(0)) void bridge.termRun(id, code).catch((e) => store.flash(errText(e), "warn", 8000));
		};
		const runs = tab.subscribe(drain);
		return () => {
			gone = true;
			runs();
			typed.dispose();
			sized.dispose();
			stopData();
			stopExit();
			resize.disconnect();
			restyled.disconnect();
			xterm.textarea?.removeEventListener("focus", focused);
			xterm.textarea?.removeEventListener("blur", blurred);
			if (xterm.textarea === document.activeElement) keyboard(false);
			xterm.dispose();
			term.current = undefined;
		};
	}, [id, round]);

	const restart = async () => {
		await bridge.termClose(id);
		setRound((n) => n + 1);
	};

	return (
		<>
			<div className={SUB}>
				<SquareTerminalIcon className="size-3.5 flex-none" aria-hidden />
				<span data-slot="terminal-cwd" className="min-w-0 flex-1 truncate font-mono">
					{state.cwd ? tilde(state.cwd) : "Starting…"}
					{state.ended !== undefined ? ` · ended${state.ended ? ` (${state.ended})` : ""}` : ""}
				</span>
				<HoverTooltip>
					<TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Start the shell again" onClick={() => void restart()}><RotateCwIcon /></Button>} />
					<TooltipContent>Start the shell again</TooltipContent>
				</HoverTooltip>
			</div>
			{state.error ? (
				<EmptyView icon={SquareTerminalIcon} title="The terminal did not start">{state.error}</EmptyView>
			) : (
				<div className="relative flex min-h-0 flex-1 flex-col bg-background p-1.5" onClick={() => term.current?.focus()}>
					<div ref={host} data-slot="terminal" className={cn("min-h-0 flex-1", !state.cwd && "opacity-0")} />
					{/* xterm.js needs its host laid out from the start, and focusable (opacity, not visibility): the skeleton lies over it while the shell starts. */}
					{state.cwd ? null : <TerminalSkeleton className="absolute inset-0" />}
					{state.ended !== undefined ? (
						<div className="flex flex-none items-center justify-center gap-2 py-1.5 text-xs text-muted-foreground">
							The shell ended.
							<Button variant="outline" size="xs" onClick={() => void restart()}>Start it again</Button>
						</div>
					) : null}
				</div>
			)}
		</>
	);
}
