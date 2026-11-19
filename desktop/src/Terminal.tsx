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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyView } from "@/components/empty-view";
import { bridge } from "./bridge.ts";
import { SUB } from "./CodePanel.tsx";
import { store, type Tab, useModel } from "./model.ts";
import { errText, tilde } from "./text.ts";

/** A colour of the page's tokens, as xterm.js takes it: the browser says what any CSS colour is in sRGB. */
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

/** The terminal's colours: the theme's (`--term-*`, set with the rest of the theme in theme.ts). */
function theme(): ITheme {
	const style = getComputedStyle(document.documentElement);
	const token = (name: string, fallback: string) => resolved(style.getPropertyValue(name), fallback);
	const colours: Record<string, string> = {};
	ANSI.forEach((name, i) => {
		colours[name] = token(`--term-${i}`, "#808080");
		colours[`bright${name[0].toUpperCase()}${name.slice(1)}`] = token(`--term-${i + 8}`, colours[name]);
	});
	return {
		...colours,
		background: token("--term-bg", token("--background", "#1b1e28")),
		foreground: token("--term-fg", token("--foreground", "#e4f0fb")),
		cursor: token("--term-cursor", token("--code-cursor", "#e4f0fb")),
		selectionBackground: token("--term-select", "rgba(113, 124, 180, 0.3)"),
	};
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
		const recolour = () => (xterm.options.theme = theme());
		// A new theme (Settings > App) sets the root element's variables (its style attribute).
		const restyled = new MutationObserver(recolour);
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
				<Tooltip>
					<TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Start the shell again" onClick={() => void restart()}><RotateCwIcon /></Button>} />
					<TooltipContent>Start the shell again</TooltipContent>
				</Tooltip>
			</div>
			{state.error ? (
				<EmptyView icon={SquareTerminalIcon} title="The terminal did not start">{state.error}</EmptyView>
			) : (
				<div className="flex min-h-0 flex-1 flex-col bg-background p-1.5" onClick={() => term.current?.focus()}>
					<div ref={host} data-slot="terminal" className="min-h-0 flex-1" />
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
