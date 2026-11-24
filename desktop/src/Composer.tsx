// Where the owner writes: the message, the files that go with it, and under it what the
// conversation runs on (folder, model, reasoning, mode), each a click away.
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { ArrowUpIcon, ChevronDownIcon, ClockIcon, CpuIcon, EyeIcon, FileIcon, FolderIcon, MicIcon, PlusIcon, ShieldIcon, SparkleIcon, SquareIcon, XIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Attachment as Chip, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle } from "@/components/ui/attachment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxContent, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { HoverTooltip } from "@/components/hover-tooltip";
import { QuoteChip } from "@/components/quote-chip";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "usehooks-ts";
import { api } from "./api.ts";
import { bridge } from "./bridge.ts";
import { COMMANDS, runSlash } from "./commands.ts";
import { type Attachment, REASONING_ABOUT, store, type Tab, useModel, useSignal } from "./model.ts";
import { baseName, MODES, shortcut, size, tilde } from "./text.ts";

const MAX_FILE = 20 * 1024 * 1024;
const MAX_FILES = 10;
/**
 * The systems on which the app listens (src/tui/voice.ts in its main process): not a phone. Where a
 * piece is missing there (whisper.cpp on Linux, a recogniser for the language on Windows), the
 * press says in a sentence what to install, and nothing is started.
 */
const DICTATES = ["darwin", "win32", "linux"];

const toBase64 = (buf: ArrayBuffer) => {
	const bytes = new Uint8Array(buf);
	let out = "";
	for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(out);
};

/** Files for the next message. A folder is not attached: it is opened for the conversation. */
export async function attach(tab: Tab, files: File[]): Promise<void> {
	for (const file of files) {
		if (tab.attachments.length >= MAX_FILES) return store.flash("At most 10 files per message.", "bad");
		if (file.size > MAX_FILE) {
			store.flash(`${file.name} is larger than 20 MB.`, "bad");
			continue;
		}
		const name = file.name || `pasted-${Date.now()}.png`;
		if (tab.attachments.some((a) => a.name === name && a.size === file.size)) continue;
		const item: Attachment = { name, size: file.size, data: toBase64(await file.arrayBuffer()) };
		if (/^image\/(png|jpeg|gif|webp)$/.test(file.type)) item.preview = URL.createObjectURL(file);
		tab.attachments.push(item);
	}
	tab.touch();
}

interface Suggestion {
	value: string;
	label: string;
	about?: string;
}

/** A key event that went through Base UI: `preventBaseUIHandler` keeps the combobox's own handling out of it. */
type ListKeyEvent = React.KeyboardEvent<HTMLTextAreaElement> & { preventBaseUIHandler: () => void };

export function Composer({ tab }: { tab: Tab }) {
	useModel(tab);
	useModel(store);
	const area = useRef<HTMLTextAreaElement>(null);
	const picker = useRef<HTMLInputElement>(null);
	const [over, setOver] = useState(false);
	const [items, setItems] = useState<Suggestion[]>([]);
	const highlighted = useRef<Suggestion | undefined>(undefined);
	const [kind, setKind] = useState<"slash" | "file" | undefined>();
	const recall = useRef(-1);
	// Dictating: what is heard is put after what was typed, and is text in the input and nothing
	// more. It is never sent by itself.
	const [voice, setVoice] = useState<"off" | "starting" | "listening">("off");
	const [voiceNote, setVoiceNote] = useState("");
	const typed = useRef("");
	const hearing = useRef(false);
	const text = tab.draft;
	const info = store.agent(tab.agent);

	const set = (value: string) => {
		tab.draft = value;
		tab.touch();
	};

	const close = () => {
		setItems([]);
		setKind(undefined);
	};

	// On a touch screen a focus nobody asked for raises the on-screen keyboard, which covers half the
	// page and pushes it under the status bar: there the owner taps into the input when they write.
	const touch = useMediaQuery("(pointer: coarse)");
	useEffect(() => {
		if (!touch) area.current?.focus();
	}, [tab.id, touch]);

	const heard = (said: string) => `${typed.current}${typed.current && !/\s$/.test(typed.current) && said ? " " : ""}${said}`;
	/** `cancel`: nothing more is put into the input. Otherwise "that was all": the last words still arrive. */
	const endVoice = (cancel: boolean) => {
		if (cancel) {
			hearing.current = false;
			setVoice("off");
			setVoiceNote("");
		}
		void bridge.voiceStop(cancel);
	};
	const dictate = async () => {
		if (voice !== "off") return endVoice(false);
		if (!DICTATES.includes(store.platform)) return store.flash("Voice input needs macOS, Windows or Linux, which recognise speech on the computer itself.");
		typed.current = tab.draft;
		hearing.current = true;
		setVoice("starting");
		try {
			await bridge.voiceStart(store.voiceLanguage);
		} catch (e) {
			hearing.current = false;
			setVoice("off");
			store.flash(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "bad", 9000);
		}
	};
	useEffect(
		() =>
			bridge.onVoice((m: { type: string; text?: string; state?: string; error?: string }) => {
				if (!hearing.current) return;
				if (m.type === "ready") setVoice("listening");
				else if (m.type === "model") setVoiceNote(m.state === "downloading" ? "macOS is downloading the speech model for this language, once" : "");
				else if (m.type === "partial") set(heard(m.text ?? ""));
				else if (m.type === "done") {
					hearing.current = false;
					setVoice("off");
					setVoiceNote("");
					if (m.text) set(heard(m.text));
					if (m.error) store.flash(m.error, "bad", 8000);
					area.current?.focus();
				}
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[tab],
	);
	// Leaving the conversation ends the listening.
	useEffect(() => () => void (hearing.current && bridge.voiceStop(true)), []);

	// A menu asked for something only this part can do.
	useSignal("voice", () => void dictate());
	useSignal("attach", () => picker.current?.click());
	useSignal("focus-input", () => area.current?.focus());

	/** What is being typed right before the cursor: a command at the start of the input, or a file after an @. */
	const suggest = async (value: string, cursor: number) => {
		const before = value.slice(0, cursor);
		if (/^\/[a-z]*$/i.test(before)) {
			const word = before.slice(1).toLowerCase();
			setKind("slash");
			return setItems(COMMANDS.filter((c) => c.name.startsWith(word)).map((c) => ({ value: c.name, label: `/${c.name}${c.hint ? ` ${c.hint}` : ""}`, about: c.about })));
		}
		const mention = /(?:^|\s)@([^\s@]*)$/.exec(before);
		if (mention) {
			const found = await api.find(tab.agent, tab.session, mention[1].split("#")[0]).catch(() => ({ files: [] as string[] }));
			// What was typed meanwhile decides whether the answer is still wanted.
			if (area.current && area.current.value.slice(0, area.current.selectionStart) !== before) return;
			for (const f of found.files) tab.files.add(f);
			setKind("file");
			return setItems(found.files.slice(0, 12).map((f) => ({ value: f, label: f })));
		}
		close();
	};

	const take = (s: Suggestion) => {
		const el = area.current!;
		const cursor = el.selectionStart;
		const before = text.slice(0, cursor);
		const next = kind === "slash" ? `/${s.value} ` : `${before.replace(/@([^\s@]*)$/, `@${s.value} `)}`;
		const whole = kind === "slash" ? next : next + text.slice(cursor);
		const pos = kind === "slash" ? whole.length : next.length;
		set(whole);
		close();
		// The caret goes after what was picked at once: a key typed before the next frame would land at the
		// end, and the caret be put back in front of it. (React writes no value that the field already has.)
		el.value = whole;
		el.focus();
		el.setSelectionRange(pos, pos);
		// The list, closing, may still move it: put back once more, unless something was typed meanwhile.
		requestAnimationFrame(() => {
			if (el.value !== whole) return;
			el.focus();
			el.setSelectionRange(pos, pos);
		});
	};

	const send = async (whenBusy: "steer" | "queue") => {
		const value = text.trim();
		const command = value.startsWith("/") && !value.startsWith("//");
		if (!value && !tab.quotes.length) return;
		recall.current = -1;
		close();
		if (command) {
			tab.inputs.push(value);
			set("");
			return runSlash(value.slice(1), tab);
		}
		await store.submit(tab, value, whenBusy);
	};

	const onKey = (e: ListKeyEvent) => {
		if (e.nativeEvent.isComposing) return;
		if (voice !== "off") {
			// Enter says "that was all" and sends nothing; escape throws away what was heard.
			if (e.key === "Enter") return (e.preventBaseUIHandler(), e.preventDefault(), endVoice(false));
			if (e.key === "Escape") return (e.preventBaseUIHandler(), e.preventDefault(), endVoice(true), set(typed.current));
		}
		// While suggestions show, the arrows, Enter and Escape are the combobox's: they move the
		// highlight, pick it (`take`) and close the list. Everything else is the composer's.
		// The list highlights its first line by itself, a moment after it shows: a Tab in that moment takes that line too.
		const s = highlighted.current ?? (e.key === "Tab" ? items[0] : undefined);
		if (items.length && s && !e.altKey) {
			if (e.key === "Tab" && !e.shiftKey) {
				e.preventBaseUIHandler();
				e.preventDefault();
				return take(s);
			}
			// A command typed out whole is run, not picked again.
			const whole = e.key === "Enter" && !e.shiftKey && kind === "slash" && s.value === text.slice(1).trim();
			if (!whole && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Escape" || (e.key === "Enter" && !e.shiftKey))) return;
		}
		e.preventBaseUIHandler();
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			return void send(e.altKey ? "queue" : "steer");
		}
		if (e.key === "Escape" && tab.busy) {
			e.preventDefault();
			return void store.stop(tab);
		}
		// Next mode, as in the terminal UI: while the input is empty.
		if (e.key === "Tab" && e.shiftKey && !text) {
			e.preventDefault();
			const order = ["auto", "plan", "safe", "manual", "bypass"];
			return void store.setMode(tab, order[(order.indexOf(store.modeOf(tab)) + 1) % order.length]);
		}
		// Earlier inputs, while nothing was typed or one of them is shown.
		if ((e.key === "ArrowUp" || e.key === "ArrowDown") && tab.inputs.length && (!text || recall.current >= 0) && !text.includes("\n")) {
			const next = e.key === "ArrowUp" ? (recall.current < 0 ? tab.inputs.length - 1 : Math.max(0, recall.current - 1)) : recall.current + 1;
			if (e.key === "ArrowDown" && recall.current < 0) return;
			e.preventDefault();
			if (next >= tab.inputs.length) {
				recall.current = -1;
				return set("");
			}
			recall.current = next;
			return set(tab.inputs[next]);
		}
	};

	const onDrop = async (e: React.DragEvent) => {
		e.preventDefault();
		setOver(false);
		const list = [...e.dataTransfer.items].filter((i) => i.kind === "file");
		const files: File[] = [];
		for (const entry of list) {
			const file = entry.getAsFile();
			if (!file) continue;
			// A folder is opened for the conversation, as with /folder.
			if (entry.webkitGetAsEntry()?.isDirectory) {
				// A folder from the Finder is one of this computer's, which another machine's pine does not have.
				if (store.remote) store.flash(`That folder is on this computer, and ${tab.agent} works on ${store.remote}: choose a folder there instead.`, "warn", 7000);
				else {
					const dir = bridge.pathOf(file);
					if (dir) await store.setFolder(tab, dir);
				}
			} else files.push(file);
		}
		if (files.length) await attach(tab, files);
		area.current?.focus();
	};

	const mode = store.modeOf(tab);
	const paused = store.bypassPaused(tab);
	const tainted = store.taints.get(`${tab.agent}:${tab.session}`);
	const goal = tab.goal && tab.goal.status !== "met" ? tab.goal : undefined;
	const swarm = tab.swarm && (tab.swarm.status === "paused" || tab.swarm.status === "limit") ? tab.swarm : undefined;

	const model = info?.model ?? "none";
	const thinking = info?.thinking ?? "medium";
	// A menu's popup lies elsewhere on the page but inside the Input Group's addon for React, so a
	// click in it would reach the addon's own handler (a click there puts focus into the input) and
	// take focus from the button the menu gives it back to.
	const inMenu = (e: React.MouseEvent) => e.stopPropagation();

	// shadcn's Prompt Input pattern: an Input Group with the files above the text and the tools
	// under it; the reasoning and the mode are the Model Selector pattern's menus.
	return (
		<>
			{goal && goal.status !== "active" ? (
				<Alert className="mb-2">
					<ClockIcon />
					<AlertTitle>Goal {goal.status === "paused" ? "paused" : goal.status === "blocked" ? "waits for you" : "limit reached"}</AlertTitle>
					<AlertDescription className="truncate">{goal.note}</AlertDescription>
					<AlertAction>
						<Button variant="link" size="xs" onClick={() => void store.setGoal(tab, "resume")}>Resume</Button>
						<Button variant="link" size="xs" onClick={() => void store.setGoal(tab, "clear")}>Clear</Button>
					</AlertAction>
				</Alert>
			) : null}
			{swarm ? (
				<Alert className="mb-2">
					<ClockIcon />
					<AlertTitle>Swarm {swarm.status === "paused" ? "paused" : "limit reached"}</AlertTitle>
					<AlertDescription className="truncate">{swarm.note}</AlertDescription>
					<AlertAction>
						<Button variant="link" size="xs" onClick={() => void store.setSwarm(tab, "resume")}>Resume</Button>
						<Button variant="link" size="xs" onClick={() => void store.setSwarm(tab, "clear")}>Clear</Button>
					</AlertAction>
				</Alert>
			) : null}
			{voice !== "off" ? (
				<Alert className="mb-2">
					<MicIcon />
					<AlertTitle>{voice === "starting" ? "getting ready to listen…" : "listening"}</AlertTitle>
					<AlertDescription>{voice === "starting" ? "" : "speak · ↩ when you are done · esc to throw it away"}{voiceNote ? ` · ${voiceNote}` : ""}</AlertDescription>
				</Alert>
			) : null}
			{/* The files are pine's own (`attach`: its limits, a folder opened instead, base64 for the daemon).
			    Not a form: the web client's page runs in a frame that may not submit one (no `allow-forms`,
			    AGENTS.md rule 10), so the Send button sends by its click and Enter by `onKey`. */}
			<div
				data-slot="composer"
				onDragOver={(e) => {
					if (![...e.dataTransfer.types].includes("Files")) return;
					e.preventDefault();
					setOver(true);
				}}
				onDragLeave={() => setOver(false)}
				onDrop={(e) => void onDrop(e)}
			>
				<InputGroup>
					{tab.attachments.length || tab.quotes.length || over ? (
						<InputGroupAddon align="block-start" className="flex-wrap">
							{tab.quotes.map((q, i) => (
								<QuoteChip key={`quote:${q.id}`} text={q.text} onOpen={() => store.showQuote(q.tab, q.source)} onRemove={() => (tab.quotes.splice(i, 1), tab.touch())} />
							))}
							{tab.attachments.map((f, i) => (
								<Chip size="sm" key={`${f.name}:${i}`}>
									<AttachmentMedia variant={f.preview ? "image" : "icon"}>{f.preview ? <img src={f.preview} alt="" /> : <FileIcon />}</AttachmentMedia>
									<AttachmentContent>
										<AttachmentTitle>{f.name}</AttachmentTitle>
										<AttachmentDescription>{size(f.size)}</AttachmentDescription>
									</AttachmentContent>
									<AttachmentActions>
										<HoverTooltip>
											<TooltipTrigger render={<AttachmentAction onClick={() => (tab.attachments.splice(i, 1), tab.touch())} aria-label={`Remove ${f.name}`} />}><XIcon /></TooltipTrigger>
											<TooltipContent>Remove {f.name}</TooltipContent>
										</HoverTooltip>
									</AttachmentActions>
								</Chip>
							))}
							{/* While files are dragged over the input: where they go, as an attachment still to come. */}
							{over ? (
								<Chip size="sm" state="idle">
									<AttachmentMedia><PlusIcon /></AttachmentMedia>
									<AttachmentContent>
										<AttachmentTitle>Drop to attach</AttachmentTitle>
										<AttachmentDescription>a folder is opened for the conversation</AttachmentDescription>
									</AttachmentContent>
								</Chip>
							) : null}
						</InputGroupAddon>
					) : null}
					{/* The `/` commands and `@` files: pine finds them (`suggest`) and the combobox shows them. */}
					<Combobox<Suggestion>
						items={items}
						filter={null}
						autoHighlight
						open={items.length > 0}
						onOpenChange={(open) => void (!open && close())}
						inputValue={text}
						value={null}
						onValueChange={(s) => void (s && take(s))}
						onItemHighlighted={(s) => void (highlighted.current = s)}
						itemToStringLabel={(s) => s.label}
					>
						<ComboboxPrimitive.Input
							ref={area as unknown as React.Ref<HTMLInputElement>}
							render={<InputGroupTextarea rows={1} className="max-h-48 p-3 leading-snug md:text-base md:leading-snug" />}
							placeholder={tab.busy ? `Say something to ${tab.agent} while it works…` : `Message ${tab.agent} · / for commands · @ for files`}
							onChange={(e) => {
								// A key that types ends the listening: what was heard stays, and nothing more is put into the input.
								if (voice !== "off") endVoice(true);
								recall.current = -1;
								set(e.target.value);
								void suggest(e.target.value, e.target.selectionStart ?? e.target.value.length);
							}}
							onKeyDown={(e) => onKey(e as unknown as ListKeyEvent)}
							onPaste={(e) => {
								const files = [...e.clipboardData.files];
								if (!files.length) return;
								e.preventDefault();
								void attach(tab, files);
							}}
						/>
						<ComboboxContent side="top">
							<ComboboxList>
								{(s: Suggestion) => (
									<ComboboxItem key={s.value} value={s}>
										<span data-part="label" className="shrink-0 font-mono">{s.label}</span>
										{s.about ? <span className="truncate text-muted-foreground">{s.about}</span> : null}
									</ComboboxItem>
								)}
							</ComboboxList>
						</ComboboxContent>
					</Combobox>
					{/* A narrow input keeps every button on one line and whole: only the model's and the folder's
					    names are cut, and what has no room for its words stands as its sign alone, with the words in its tooltip. */}
					<InputGroupAddon align="block-end" className="@container/bar">
						<HoverTooltip>
							<TooltipTrigger render={<InputGroupButton size="icon-sm" variant="outline" className="rounded-full" onClick={() => picker.current?.click()} aria-label="Attach files (or drop them here)" />}><PlusIcon /></TooltipTrigger>
							<TooltipContent>Attach files (or drop them here)</TooltipContent>
						</HoverTooltip>
						<HoverTooltip>
							<TooltipTrigger render={<InputGroupButton size="sm" className="min-w-0 shrink" onClick={() => void store.pickModel(tab)} aria-label={`Model: ${model}`} />}>
								<CpuIcon />
								<span className="truncate @max-md/bar:hidden">{info?.model?.split("/").pop() ?? "model"}</span>
							</TooltipTrigger>
							<TooltipContent>Model: {model}</TooltipContent>
						</HoverTooltip>
						<DropdownMenu>
							<HoverTooltip>
								<TooltipTrigger render={<DropdownMenuTrigger render={<InputGroupButton size="sm" aria-label={`Reasoning: ${thinking}, how much the model thinks before it answers`} />} />}>
									<SparkleIcon />
									<span className="@max-md/bar:hidden">{thinking}</span>
									<ChevronDownIcon className="@max-md/bar:hidden" />
								</TooltipTrigger>
								<TooltipContent>Reasoning: {thinking}, how much the model thinks before it answers</TooltipContent>
							</HoverTooltip>
							<DropdownMenuContent side="top" className="w-72" onClick={inMenu}>
								<DropdownMenuGroup>
									<DropdownMenuLabel>Reasoning for {tab.agent}</DropdownMenuLabel>
									<DropdownMenuRadioGroup value={thinking} onValueChange={(level: string) => void store.setReasoning(tab, level)}>
										{/* Two columns, each row on one line: the level, and what it means beside it. */}
										{Object.entries(REASONING_ABOUT).map(([level, about]) => (
											<DropdownMenuRadioItem key={level} value={level} closeOnClick>
												<span className="w-16 shrink-0">{level}</span>
												<span className="truncate text-muted-foreground">{about}</span>
											</DropdownMenuRadioItem>
										))}
									</DropdownMenuRadioGroup>
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
						<DropdownMenu>
							<HoverTooltip>
								<TooltipTrigger render={<DropdownMenuTrigger render={<InputGroupButton size="sm" variant={mode === "bypass" && !paused ? "destructive" : "ghost"} aria-label={`Mode: ${mode}${paused ? " (paused)" : ""}, how much this agent does without asking`} />} />}>
									<ShieldIcon />
									<span className="@max-xl/bar:hidden">{mode}{paused ? " (paused)" : ""}</span>
									<ChevronDownIcon className="@max-md/bar:hidden" />
								</TooltipTrigger>
								<TooltipContent>Mode: {mode}{paused ? " (paused)" : ""}, how much this agent does without asking</TooltipContent>
							</HoverTooltip>
							<DropdownMenuContent side="top" className="w-80" onClick={inMenu}>
								<DropdownMenuGroup>
									<DropdownMenuLabel>Mode for {tab.agent}</DropdownMenuLabel>
									<DropdownMenuRadioGroup value={mode} onValueChange={(next: string) => void store.setMode(tab, next)}>
										{MODES.map((m) => (
											<DropdownMenuRadioItem key={m.value} value={m.value} closeOnClick>
												<span className="flex flex-col">
													{m.label}
													<span className="text-muted-foreground">{m.about}</span>
												</span>
											</DropdownMenuRadioItem>
										))}
									</DropdownMenuRadioGroup>
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
						<HoverTooltip>
							<TooltipTrigger render={<InputGroupButton size="sm" className="min-w-0 shrink" onClick={() => void store.pickFolder(tab)} aria-label={tab.folder ? `Works in ${tab.folder}` : "Where this conversation works: the agent's own workspace, or a folder of yours"} />}>
								<FolderIcon />
								<span className="truncate @max-sm/bar:hidden">{tab.folder ? baseName(tab.folder) : "workspace"}</span>
							</TooltipTrigger>
							<TooltipContent>{tab.folder ? `Works in ${tab.folder}` : "Where this conversation works: the agent's own workspace, or a folder of yours"}</TooltipContent>
						</HoverTooltip>
						{tainted ? (
							<HoverTooltip>
								<TooltipTrigger render={<Badge variant="outline" className="min-w-0 shrink" tabIndex={0} />}>
									<EyeIcon data-icon="inline-start" />
									<span className="truncate @max-xl/bar:hidden">outside content</span>
								</TooltipTrigger>
								<TooltipContent>This conversation has read outside content ({tainted}): the agent asks before it sends something out.</TooltipContent>
							</HoverTooltip>
						) : null}
						<span className="ml-auto" />
						{DICTATES.includes(store.platform) ? (
							<HoverTooltip>
								<TooltipTrigger render={<InputGroupButton size="icon-sm" variant={voice !== "off" ? "destructive" : "ghost"} onClick={() => void dictate()} aria-label={voice === "off" ? "Dictate the message" : "End the listening"} />}><MicIcon /></TooltipTrigger>
								<TooltipContent>
									{voice === "off" ? "Dictate the message" : "End the listening"}
									{voice === "off" ? <Kbd>{shortcut("⌃R")}</Kbd> : null}
								</TooltipContent>
							</HoverTooltip>
						) : null}
						{tab.busy && !text.trim() && !tab.quotes.length ? (
							<HoverTooltip>
								<TooltipTrigger render={<InputGroupButton size="icon-sm" variant="default" className="rounded-full" onClick={() => void store.stop(tab)} aria-label="Stop" />}><SquareIcon /></TooltipTrigger>
								<TooltipContent>
									Stop
									<Kbd>esc</Kbd>
								</TooltipContent>
							</HoverTooltip>
						) : (
							<HoverTooltip>
								{/* Said as disabled, not disabled: a disabled button inside an InputGroup dims the whole
								    composer (`has-disabled:`). With nothing to send, `send` does nothing. */}
								<TooltipTrigger render={<InputGroupButton size="icon-sm" variant="default" className="rounded-full aria-disabled:opacity-50" onClick={() => void send("steer")} aria-disabled={(!text.trim() && !tab.quotes.length) || undefined} aria-label={tab.busy ? `Give it to the agent while it works · ${shortcut("⌥↩")} waits until it is done` : "Send"} />}><ArrowUpIcon /></TooltipTrigger>
								<TooltipContent>
									{tab.busy ? `Give it to the agent while it works · ${shortcut("⌥↩")} waits until it is done` : "Send"}
									<Kbd>{shortcut("↩")}</Kbd>
								</TooltipContent>
							</HoverTooltip>
						)}
					</InputGroupAddon>
				</InputGroup>
			</div>
			<input ref={picker} type="file" multiple hidden onChange={(e) => (void attach(tab, [...(e.target.files ?? [])]), (e.target.value = ""))} />
			{tab.folder && !tab.items.length ? <div className="px-1 pt-1.5 text-faint text-xs">{tab.agent}'s tools start in {tilde(tab.folder)} and may read and change what is in it.</div> : null}
		</>
	);
}
