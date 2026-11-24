// Settings: everything about pine that is otherwise a command in a shell or a sentence to the
// main agent. Each page asks the daemon what there is and tells it what to change; the daemon
// checks every change as it checks the main agent's, and nothing here writes a file itself.
import { ArrowLeftIcon, AudioLinesIcon, BookIcon, MonitorSmartphoneIcon, LaptopIcon, ServerIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, ChevronLeftIcon, ClockIcon, CpuIcon, ExternalLinkIcon, FolderIcon, GitBranchIcon, InfoIcon, MessageSquareIcon, PlugIcon, PlusIcon, RotateCwIcon, SearchIcon, SlidersHorizontalIcon, Trash2Icon, TriangleAlertIcon, Undo2Icon, UsersIcon, XIcon, ZapIcon, TerminalSquareIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Sidebar as SidebarRoot, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from "@/components/ui/sidebar";
import { Pulse } from "@/components/pulse";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "cn";
import { type ComponentProps, Fragment, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { type AgentDetail, api, type LoginState, type ModelServer, type Provider, type Route, type Setting, type SourceType } from "./api.ts";
import { bridge } from "./bridge.ts";
import { Editor } from "./CodePanel.tsx";
import { store, type UpdatePhase, useModel, useSignal } from "./model.ts";
import { ago, errText, MODES, newApp, plural, REASONING, short, tilde } from "./text.ts";
import type { DialogRootActions } from "@base-ui/react/dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { HoverTooltip } from "@/components/hover-tooltip";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyView } from "@/components/empty-view";
import { useLoad } from "./use-load.ts";
import { APP_DOWNLOAD, computerWord, isPaired, meetingLine, type NearbyFound, reachedThrough, relayLine } from "./machines.ts";
import { Textarea } from "@/components/ui/textarea";
import { type Look, type ThemeEntry } from "./theme.ts";
import { AgentAvatar } from "@/components/agent-avatar";
import { ModelNotice } from "@/components/model-notice";
import { AgentColorPicker, AgentNameInput } from "@/components/agent-identity";
import { BrowserAccess } from "./BrowserAccess.tsx";
import { Control, CONTROL, Page, Section } from "./settings-parts.tsx";
import { type Entry, entries, GROUPS, LABELS, type Lists, type Place, search } from "./settings-index.ts";
import { NearbyComputers, PairLinkField } from "./Pairing.tsx";

const SECTIONS: Array<{ id: string; label: string; icon: LucideIcon }> = (
	[
		["general", SlidersHorizontalIcon],
		["agents", UsersIcon],
		["models", CpuIcon],
		["mcp", PlugIcon],
		["skills", BookIcon],
		["events", ZapIcon],
		["environments", ServerIcon],
		["access", MonitorSmartphoneIcon],
	] as const
).map(([id, icon]) => ({ id, label: LABELS[id], icon }));

/**
 * Whether Settings > Browser access is offered: only by the desktop app's bridge, which has its calls,
 * and only while the app uses this computer's pine. Browser access is this computer's door: the web client,
 * the mobile apps and another machine's pine have none to show.
 */
const offersAccess = (s: { local: boolean; remote?: string }) => s.local && !s.remote && typeof bridge.access === "function";

/** The sections the navigation lists for this state: every one, but Browser access only where it is offered. */
const offeredSections = (s: { local: boolean; remote?: string }) => SECTIONS.filter((x) => x.id !== "access" || offersAccess(s));

function Access() {
	return (
		<Page title="Browser access" lead={`Your conversations in a browser on your phone or another computer, with this ${computerWord(store.platform)}'s pine. A device is let in once by scanning a code here, and connects by itself from then on.`}>
			<BrowserAccess />
		</Page>
	);
}

// Every page is made of stock Item, Field, Badge and Alert, written out where they are used. Some
// carry a class the desktop tests look for (set-group, item, name, ctl, form, log, tag, notice,
// good, warn, mono): it carries no style. An Item's description is shown whole and broken anywhere
// (`line-clamp-none wrap-anywhere`): stock cuts it after two lines, and here it is what explains
// the thing (a path, an address, a list of models). A Badge's variant follows its tone: default
// for a state that is good (connected, signed in), outline for warn, destructive for bad, secondary for
// none. A choice is not a state: a mode is secondary, and only bypass, where nothing asks, is destructive.

/**
 * A setting's text as pine writes it: a first paragraph, then lines that say what each value means
 * ("safe: in the sandbox, …"). Those are drawn as a short list with the value in front.
 */
function About({ text }: { text: string }) {
	const [first, ...rest] = text.split("\n");
	const values = rest.map((line) => /^([^:]{1,24}): (.+)$/.exec(line)).filter((m): m is RegExpExecArray => m !== null);
	return (
		<>
			<span className="block">{first}</span>
			{values.length === rest.length && values.length ? (
				<span className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
					{values.map((m) => (
						<Fragment key={m[1]}>
							<span className="font-medium text-foreground">{m[1]}</span>
							<span>{m[2]}</span>
						</Fragment>
					))}
				</span>
			) : rest.length ? (
				<span className="block whitespace-pre-line">{rest.join("\n")}</span>
			) : null}
		</>
	);
}

/** Who something can be for, as the items of a Select: all agents ("") or one. */
const whom = (agents: Array<{ id: string }>) => [{ value: "", label: "all agents" }, ...agents.map((a) => ({ value: a.id, label: a.id }))];

const scopeText = (scope: string, session?: string) => (scope === "global" ? "all agents" : session && session !== "main" ? `${scope} · ${session}` : scope);

// The fields of a form: two to a row where the settings are wide enough, one to a row where they are not
// (a phone, or a wide panel beside), measured on the settings themselves, not on the window.
const FORM_GRID = "grid grid-cols-1 @lg/settings:grid-cols-2";

/**
 * One out of a few in a form, as a stock Select across the form's width. Pressed buttons were hard to tell
 * apart in some themes; a select says the choice in words.
 */
function Choose<T extends string>({ id, items, value, onChange }: { id: string; items: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void }) {
	return (
		<Select items={items} value={value} onValueChange={(v) => v && onChange(v as T)}>
			<SelectTrigger id={id} className="w-full">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectGroup>
					{items.map((o) => (
						<SelectItem key={o.value} value={o.value}>
							{o.label}
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}

// ---- general ----------------------------------------------------------------------------------------

type SettingsItemProps = Omit<ComponentProps<typeof Item>, "title" | "variant" | "size"> &
	(
		| {
				skeleton?: false;
				title: ReactNode;
				/** One line, or a few, each an ItemDescription; `children` follow them, for lines of another shape. */
				description?: ReactNode | ReactNode[];
				media?: ReactNode;
				mediaVariant?: ComponentProps<typeof ItemMedia>["variant"];
				actions?: ReactNode;
				titleClassName?: string;
				descriptionClassName?: string;
				contentClassName?: string;
				actionsClassName?: string;
				/** data-* attributes of the actions, for a test to find a setting by. */
				actionsProps?: { [data: `data-${string}`]: string };
			}
		| { skeleton: true; title?: undefined; description?: undefined; media?: undefined; actions?: undefined }
	);

/**
 * The outline row the Settings lists are made of: a title (with its badges), a line or a few below it,
 * and actions at its end. With `skeleton`, bars of the same shape while its list loads.
 */
export function SettingsItem(props: SettingsItemProps) {
	if (props.skeleton) {
		const { skeleton: _, title: _t, description: _d, media: _m, actions: _a, children: _c, ...rest } = props;
		return (
			<Item data-slot="settings-item" variant="outline" size="sm" {...rest}>
				<ItemContent className="min-w-0 gap-2">
					<Skeleton className="h-4 w-32" />
					<Skeleton className="h-3.5 w-3/4" />
				</ItemContent>
				<ItemActions><Skeleton className="h-8 w-20" /></ItemActions>
			</Item>
		);
	}
	// A real row keeps Item's own data-slot (item): the tests find rows by it.
	const { skeleton: _, title, description, media, mediaVariant, actions, titleClassName, descriptionClassName, contentClassName, actionsClassName, actionsProps, children, ...rest } = props;
	const lines = Array.isArray(description) ? description : description === undefined ? [] : [description];
	return (
		<Item variant="outline" size="sm" {...rest}>
			{media ? <ItemMedia variant={mediaVariant}>{media}</ItemMedia> : null}
			<ItemContent className={cn("min-w-0", contentClassName)}>
				<ItemTitle className={titleClassName}>{title}</ItemTitle>
				{lines.map((line, i) => <ItemDescription key={i} className={descriptionClassName}>{line}</ItemDescription>)}
				{children}
			</ItemContent>
			{actions ? <ItemActions className={actionsClassName} {...actionsProps}>{actions}</ItemActions> : null}
		</Item>
	);
}

/** A select whose options are still loading: its place, pending, rather than a partial list. */
function SelectPending({ id }: { id?: string }) {
	return <Skeleton id={id} data-pending="" className={cn(CONTROL, "h-8")} />;
}

/** A field of Settings whose value comes late: its title and line as bars, holding its place. */
function FieldSkeleton(props: ComponentProps<"div">) {
	return (
		<Field orientation="responsive" {...props}>
			<FieldContent className="min-w-0 gap-2">
				<Skeleton className="h-4 w-36" />
				<Skeleton className="h-3.5 w-3/4" />
			</FieldContent>
			<Skeleton className="h-8 w-24" />
		</Field>
	);
}

/** A Settings list on its first load: a few skeleton rows in place of its items. */
function SettingsItemsSkeleton({ count = 3 }: { count?: number }) {
	return Array.from({ length: count }, (_, i) => <SettingsItem key={i} skeleton />);
}

/** A group of General's settings while they load: its title and a few rows of bars. */
function SettingsGroupSkeleton() {
	return (
		<section data-slot="settings-group-skeleton" className="flex flex-col gap-3">
			<div className="flex flex-col gap-1.5">
				<Skeleton className="h-5 w-40" />
				<Skeleton className="h-4 w-2/3" />
			</div>
			<FieldGroup>
				{[0, 1, 2].map((i) => (
					<div key={i} className="flex items-center justify-between gap-4">
						<div className="flex min-w-0 flex-1 flex-col gap-1.5">
							<Skeleton className="h-4 w-36" />
							<Skeleton className="h-3.5 w-3/4" />
						</div>
						<Skeleton className="h-8 w-40" />
					</div>
				))}
			</FieldGroup>
		</section>
	);
}

function SettingRow({ s, models, reload }: { s: Setting; models?: string[]; reload: () => void }) {
	const [draft, setDraft] = useState<string>();
	const id = useId();
	const name = s.title ?? s.key;
	const set = async (value: unknown) => {
		const done = await store.attempt(() => api.setSetting(s.key, value));
		if (!done) return;
		setDraft(undefined);
		store.flash(done.live ? `${name}: ${done.now}.` : `${name} is saved. It takes effect when pine restarts.`, "good", 3000);
		reload();
		void store.refreshTaints();
		store.agents = await store.askAgents().catch(() => store.agents);
		store.touch();
	};
	const k = s.kind;
	const saved = (s as Setting & { saved?: string }).saved;
	const unset = /^not set/.test(s.now) || s.now === "none";
	let control: ReactNode;
	if (k === "boolean") control = <Switch id={id} checked={s.now === "true"} onCheckedChange={(on) => void set(on)} />;
	else if (k === "model" && !models) control = <SelectPending id={id} />;
	else if (k === "model" || (typeof k === "object" && "one" in k)) {
		const items =
			k === "model"
				? [{ value: "", label: unset ? s.now.replace(/^not set \((.+)\)$/, "$1") : "pine's default" },...(!unset && !models!.includes(s.now) ? [s.now] : []).concat(models!).map((m) => ({ value: m, label: m }))]
				: [...(k.one.includes(s.now) ? [] : [{ value: "", label: s.now }]), ...k.one.map((v) => ({ value: v, label: v }))];
		const value = k === "model" ? (unset ? "" : s.now) : k.one.includes(s.now) ? s.now : "";
		control = (
			<Select items={items} value={value} onValueChange={(v) => void set(v || "default")}>
				<SelectTrigger id={id} className={CONTROL}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent alignItemWithTrigger={false} align="end">
					<SelectGroup>
						{items.map((o) => (
							<SelectItem key={o.value} value={o.value}>
								{o.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		);
	} else {
		const hint = typeof k === "object" ? `A whole number from ${k.from} to ${k.to}. Enter to save.` : "A time such as 90s or 5m. Enter to save.";
		// Saved on Enter or when the field is left: no button that comes and goes beside it.
		const commit = () => (draft === undefined || draft.trim() === s.now ? setDraft(undefined) : void set(draft.trim()));
		control = (
			<HoverTooltip>
				<TooltipTrigger render={<Input id={id} className={cn(CONTROL, "font-mono")} value={draft ?? s.now} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => (e.key === "Enter" ? commit() : e.key === "Escape" ? setDraft(undefined) : undefined)} />} />
				<TooltipContent>{hint}</TooltipContent>
			</HoverTooltip>
		);
	}
	return (
		<Field orientation={k === "boolean" ? "horizontal" : "responsive"} data-setting-key={s.key}>
			<FieldContent className="min-w-0">
				<FieldLabel htmlFor={id}>
					{s.title ? (
						<HoverTooltip>
							<TooltipTrigger render={<span>{s.title}</span>} />
							<TooltipContent>
								In pine.json: <span className="font-mono">{s.key}</span>. The main agent knows the setting by this name.
							</TooltipContent>
						</HoverTooltip>
					) : (
						<span className="font-mono">{s.key}</span>
					)}
					{s.live ? null : <Badge variant="secondary">after a restart</Badge>}
					{saved ? <Badge variant="outline">after a restart: {saved}</Badge> : null}
				</FieldLabel>
				<FieldDescription>
					<About text={s.about} />
				</FieldDescription>
			</FieldContent>
			<Control>{control}</Control>
		</Field>
	);
}


function General() {
	const s = useModel(store);
	const overview = useLoad(() => api.overview());
	const settings = useLoad(() => api.settings());
	const models = useLoad(() => api.models());
	const notes = overview.data ? [...overview.data.warnings, ...overview.data.modelNotes] : [];
	return (
		<Page title="General" lead="This app, the pine it uses, and what all agents start from. pine checks each change before it saves it.">
			<AppSections overview={overview.data} />
			{notes.length ? (
				<Section title="Worth a look" about="pine noticed these about this setup.">
					<div className="flex flex-col gap-2">
						{notes.map((w, i) => (
							<Alert key={i}>
								<TriangleAlertIcon />
								<AlertDescription className="wrap-anywhere">{w}</AlertDescription>
							</Alert>
						))}
					</div>
				</Section>
			) : null}
			{!overview.data && !overview.error ? <div data-slot="settings-overview-skeleton"><SettingsItem skeleton /></div> : null}
			{overview.error ? <Alert variant="destructive"><TriangleAlertIcon /><AlertDescription>{overview.error}</AlertDescription></Alert> : null}
			{settings.data ? (
				GROUPS.map((g) => (
					<Section key={g.prefix} title={g.title} about={g.about}>
						<FieldGroup>
							{settings.data!.filter((x) => x.key.startsWith(g.prefix)).map((x) => <SettingRow key={x.key} s={x} models={models.data ?? (models.error ? [] : undefined)} reload={settings.reload} />)}
						</FieldGroup>
					</Section>
				))
			) : settings.error ? (
				<Alert variant="destructive"><TriangleAlertIcon /><AlertDescription>{settings.error}</AlertDescription></Alert>
			) : (
				GROUPS.map((g) => <SettingsGroupSkeleton key={g.prefix} />)
			)}
			<p className="text-muted-foreground">Pine {s.versions.app}{s.local ? ` · Electron ${s.versions.electron}` : ""}</p>
		</Page>
	);
}

// ---- agents -----------------------------------------------------------------------------------------

/**
 * Several out of a list, as stock Checkboxes in two columns where there is room: each with its name and,
 * where there is one, a few words on it.
 */
function CheckList({ label, items, onToggle }: { label: string; items: Array<{ value: string; label: ReactNode; about?: string; checked: boolean; disabled?: boolean }>; onToggle: (value: string, on: boolean) => void }) {
	const id = useId();
	return (
		<FieldGroup role="group" aria-label={label} className="grid grid-cols-1 gap-3 @md/field-group:grid-cols-2">
			{items.map((x) => (
				<Field key={x.value} orientation="horizontal" data-disabled={x.disabled || undefined}>
					<Checkbox id={`${id}-${x.value}`} checked={x.checked} disabled={x.disabled} onCheckedChange={(on) => onToggle(x.value, on === true)} />
					<FieldContent>
						<FieldLabel htmlFor={`${id}-${x.value}`} className="font-normal">{x.label}</FieldLabel>
						{x.about ? <FieldDescription>{x.about}</FieldDescription> : null}
					</FieldContent>
				</Field>
			))}
		</FieldGroup>
	);
}

/** What each built-in tool does, in a few words for the agent's page. */
const TOOL_ABOUT: Record<string, string> = {
	read: "Read files",
	bash: "Run shell commands",
	edit: "Change part of a file",
	write: "Write whole files",
	grep: "Search inside files",
	find: "Find files by name",
	ls: "List a folder",
};

const FILES: Array<{ key: "instructions" | "soul" | "tooling" | "memory" | "rules"; label: string; name: string; about: string; edit: boolean }> = [
	{ key: "instructions", label: "AGENTS.md", name: "AGENTS.md", about: "What the agent is for and how it works. The agent keeps this file up to date, and you can change it here.", edit: true },
	{ key: "soul", label: "SOUL.md", name: "SOUL.md", about: "The agent's character and tone.", edit: true },
	{ key: "tooling", label: "TOOLS.md", name: "TOOLS.md", about: "How this agent prefers to use tools, on top of the notes for all agents. May be empty.", edit: true },
	{ key: "memory", label: "MEMORY.md", name: "MEMORY.md", about: "What the agent wrote down to remember between conversations. Only the agent changes it.", edit: false },
	{ key: "rules", label: "Your rules", name: "agents/<id>/AGENTS.md", about: "Your rules for this agent, which the agent reads and cannot change. Edit the file in pine's home.", edit: false },
];

/** Files to read and change, one tab each: what the file is for, and the file in an editor. */
function FileTabs<K extends string>({ files, value, onChange, children }: { files: Array<{ key: K; label: string; about?: string }>; value: K; onChange: (v: K) => void; children: (key: K) => ReactNode }) {
	return (
		<Tabs value={value} onValueChange={onChange}>
			<TabsList activateOnFocus>
				{files.map((f) => (
					<TabsTrigger key={f.key} value={f.key}>
						{f.label}
					</TabsTrigger>
				))}
			</TabsList>
			{files.map((f) => (
				<TabsContent key={f.key} value={f.key} className="flex flex-col gap-2">
					{f.about ? <p className="text-muted-foreground">{f.about}</p> : null}
					{children(f.key)}
				</TabsContent>
			))}
		</Tabs>
	);
}

/**
 * An agent's avatar and name at the top of its page, each the place where it is changed: the avatar
 * opens its color, the name turns into a field that renames it. Both are saved at once, apart from
 * the page's other changes.
 */
function AgentHeading({ id, color }: { id: string; color?: string }) {
	const [editing, setEditing] = useState(false);
	return (
		<span className="flex items-center gap-2">
			<AgentColorPicker agent={{ id, color, main: store.agent(id)?.main }} onChange={(c) => void store.colorAgent(id, c)} trigger={<Button variant="ghost" size="icon" className="rounded-full" aria-label={`Color of ${id}`} title="Change the agent's color" />}>
				<AgentAvatar agent={{ id, color, main: store.agent(id)?.main }} />
			</AgentColorPicker>
			{editing ? (
				<AgentNameInput id={id} className="max-w-60" onDone={(to) => (setEditing(false), to && void store.renameAgent(id, to))} />
			) : (
				<Button variant="ghost" className="-mx-1 h-auto px-1 text-xl font-semibold tracking-tight" title="Rename it" onClick={() => setEditing(true)}>
					{id}
				</Button>
			)}
		</span>
	);
}

/** An agent's page on its first load: its heading, a group of fields and the files' editor, as bars. */
function AgentPageSkeleton() {
	return (
		<div data-slot="agent-page-skeleton" className="flex flex-col gap-6">
			<div className="flex items-center gap-3">
				<Skeleton className="size-10 rounded-full" />
				<Skeleton className="h-6 w-40" />
			</div>
			<SettingsGroupSkeleton />
			<FilesSkeleton />
		</div>
	);
}

/** A set of file tabs over an editor, on its first load. */
function FilesSkeleton() {
	return (
		<div data-slot="files-skeleton" className="flex flex-col gap-2">
			<div className="flex gap-2">
				<Skeleton className="h-8 w-28" />
				<Skeleton className="h-8 w-24" />
				<Skeleton className="h-8 w-24" />
			</div>
			<Skeleton className="h-72 w-full" />
		</div>
	);
}

function AgentPage({ id, back }: { id: string; back: () => void }) {
	const detail = useLoad(() => api.agentDetail(id), [id]);
	const models = useLoad(() => api.models());
	const [change, setChange] = useState<Record<string, unknown>>({});
	const [file, setFile] = useState<(typeof FILES)[number]["key"]>("instructions");
	const [texts, setTexts] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const field = useId();
	const d = detail.data;
	useEffect(() => (setChange({}), setTexts({})), [id, d]);
	if (!d)
		return (
			<Page title={id} back={{ label: "Agents", onClick: back }}>
				{detail.error ? <Alert variant="destructive"><TriangleAlertIcon /><AlertDescription>{detail.error}</AlertDescription></Alert> : <AgentPageSkeleton />}
			</Page>
		);
	const now = <K extends keyof AgentDetail>(key: K): AgentDetail[K] => (key in change ? (change[key as string] as AgentDetail[K]) : d[key]);
	const put = (key: string, value: unknown) => setChange({ ...change, [key]: value });
	const dirtyFiles = FILES.filter((f) => f.edit && texts[f.key] !== undefined && texts[f.key] !== (d.files[f.key] ?? ""));
	const dirty = Object.keys(change).length > 0 || dirtyFiles.length > 0;
	const save = async () => {
		setBusy(true);
		const body = { ...change, ...Object.fromEntries(dirtyFiles.map((f) => [f.key, texts[f.key]])) };
		const done = await store.attempt(() => api.updateAgent(id, body));
		setBusy(false);
		if (!done) return;
		store.flash(`Updated ${id}; the change applies from the next message on.${done.warnings.length ? ` Note: ${done.warnings.join("; ")}` : ""}`, done.warnings.length ? "warn" : "good", done.warnings.length ? 9000 : 3500);
		detail.reload();
		store.agents = await store.askAgents().catch(() => store.agents);
		store.touch();
	};
	const remove = async () => {
		if (await store.removeAgent(id)) back();
	};
	const addFolder = async (kind: "read" | "write") => {
		const dir = await store.chooseFolder(kind === "write" ? `A folder ${id} may read and change` : `A folder ${id} may read`);
		if (dir) put(kind, [...((change[kind] as string[]) ?? []), dir]);
	};
	const others = store.agents.filter((a) => a.id !== id).map((a) => a.id);
	const mode = now("mode");
	const forget = (change.forget as string[]) ?? [];
	const modelItems = [{ value: "", label: d.defaultModel ? `${d.defaultModel} (the default)` : "the default" }, ...(d.model && !(models.data ?? []).includes(d.model) ? [d.model] : []).concat(models.data ?? []).map((m) => ({ value: m, label: m }))];
	const reasoningItems = REASONING.map((r) => ({ value: r, label: r }));
	const modeItems = MODES.map((m) => ({ value: m.value, label: m.label }));
	const modeAbout = MODES.find((m) => m.value === mode)?.about;
	const tools = now("tools");
	const delegates = now("delegates");
	const all = delegates.includes("*");
	const toggle = (list: string[], value: string, on: boolean) => (on ? [...list.filter((x) => x !== value), value] : list.filter((x) => x !== value));
	// The folders it has, and those added since the last save: one list, each saying which it is.
	const folders = [
		...d.read.map((p) => ({ p, write: false, added: false })),
		...d.write.map((p) => ({ p, write: true, added: false })),
		...((change.read as string[]) ?? []).map((p) => ({ p, write: false, added: true })),
		...((change.write as string[]) ?? []).map((p) => ({ p, write: true, added: true })),
	];
	const leaveOut = (p: string, write: boolean) => put(write ? "write" : "read", ((change[write ? "write" : "read"] as string[]) ?? []).filter((x) => x !== p));
	const select = (fieldId: string, items: Array<{ value: string; label: string }>, value: string, onChange: (v: string) => void) => (
		<Control>
			<Select items={items} value={value} onValueChange={(v) => onChange(v ?? "")}>
				<SelectTrigger id={fieldId} className={CONTROL}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent alignItemWithTrigger={false} align="end">
					<SelectGroup>
						{items.map((o) => (
							<SelectItem key={o.value} value={o.value}>
								{o.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</Control>
	);
	return (
		<Page
			back={{ label: "Agents", onClick: back }}
			title={<AgentHeading id={d.id} color={(store.agent(d.id) ?? d).color} />}
			lead={d.main ? "The main agent. It sets up pine for you and can delegate tasks to all other agents." : d.description || `Works in ${tilde(d.workspace)}.`}
			actions={<Button variant="outline" onClick={() => void store.openTab(id, "main")}><MessageSquareIcon data-icon="inline-start" />Open conversation</Button>}
		>
			<Section title="Model">
				<FieldGroup>
					<Field orientation="responsive" data-find="agent-model">
						<FieldContent className="min-w-0">
							<FieldLabel htmlFor={`${field}-model`}>Model</FieldLabel>
							<FieldDescription>The model this agent thinks with.</FieldDescription>
						</FieldContent>
						{models.data || models.error ? select(`${field}-model`, modelItems, (change.model as string) ?? d.model ?? "", (v) => put("model", v || "default")) : <SelectPending id={`${field}-model`} />}
					</Field>
					<Field orientation="responsive" data-find="agent-reasoning">
						<FieldContent className="min-w-0">
							<FieldLabel htmlFor={`${field}-reasoning`}>Reasoning</FieldLabel>
							<FieldDescription>How long the model thinks before it answers. A higher level takes longer.</FieldDescription>
						</FieldContent>
						{select(`${field}-reasoning`, reasoningItems, now("thinking"), (v) => put("thinking", v))}
					</Field>
				</FieldGroup>
			</Section>

			<Section title="Instructions" about="The files the agent reads with each message." data-find="agent-instructions">
				<FileTabs files={FILES.filter((f) => f.edit || d.files[f.key] !== undefined)} value={file} onChange={setFile}>
					{(key) => {
						const meta = FILES.find((f) => f.key === key)!;
						return (
							<div className="flex h-72 overflow-hidden rounded-lg border">
								<Editor key={`${id}:${key}`} file={`${key}.md`} text={texts[key] ?? d.files[key] ?? ""} readOnly={!meta.edit} onChange={(v) => setTexts((was) => ({ ...was, [key]: v }))} onSave={() => void save()} />
							</div>
						);
					}}
				</FileTabs>
			</Section>

			<Section title="Permissions" about="What the agent may do without asking you.">
				<FieldGroup>
					<Field orientation="responsive" data-find="agent-mode">
						<FieldContent className="min-w-0">
							<FieldLabel htmlFor={`${field}-mode`}>Mode</FieldLabel>
							<FieldDescription>{modeAbout}</FieldDescription>
						</FieldContent>
						{select(`${field}-mode`, modeItems, mode, (m) => m && put("mode", m))}
					</Field>
					<Field orientation="horizontal" data-find="agent-network">
						<FieldContent className="min-w-0">
							<FieldLabel htmlFor={`${field}-network`}>Network for shell commands</FieldLabel>
							<FieldDescription>In safe and manual mode, the agent's commands have no network unless this is on. With it on, a command can send what the agent has read anywhere.</FieldDescription>
						</FieldContent>
						<Switch id={`${field}-network`} checked={now("network")} onCheckedChange={(on) => put("network", on)} />
					</Field>
					<FieldSet data-find="agent-tools">
						<FieldLegend variant="label">Built-in tools</FieldLegend>
						<FieldDescription>Without bash, edit and write, the agent can only read.</FieldDescription>
						<CheckList label="Built-in tools" items={d.allTools.map((t) => ({ value: t, label: <span className="font-mono">{t}</span>, about: TOOL_ABOUT[t], checked: tools.includes(t) }))} onToggle={(t, on) => put("tools", toggle(tools, t, on))} />
					</FieldSet>
					<FieldSet data-find="agent-delegates">
						<FieldLegend variant="label">Can delegate to</FieldLegend>
						<FieldDescription>Agents it can hand a task to. A delegated task runs in the stricter of the two agents' modes.</FieldDescription>
						{others.length ? (
							<CheckList
								label="Can delegate to"
								items={[
									{ value: "*", label: d.main ? "All other agents" : "All agents except the main one", checked: all },
									// "*" is every agent but the main one: the main agent stays a choice of its own.
									...others.map((o) => {
										const covered = all && !store.agent(o)?.main;
										return { value: o, label: o, checked: covered || delegates.includes(o), disabled: covered };
									}),
								]}
								onToggle={(v, on) => put("delegates", v === "*" ? (on ? ["*"] : []) : toggle(delegates, v, on))}
							/>
						) : (
							<FieldDescription>There is no other agent yet.</FieldDescription>
						)}
					</FieldSet>
				</FieldGroup>
			</Section>

			<Section
				title="Folders outside the workspace"
				data-find="agent-folders"
				about="Other folders the agent may use in safe and manual mode. In auto and bypass mode the agent reaches all your files anyway."
				actions={
					<DropdownMenu>
						<DropdownMenuTrigger render={<Button variant="outline" />}>
							<PlusIcon data-icon="inline-start" />
							Add folder
							<ChevronDownIcon data-icon="inline-end" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuGroup>
								<DropdownMenuItem onClick={() => void addFolder("read")}>Read only…</DropdownMenuItem>
								<DropdownMenuItem onClick={() => void addFolder("write")}>Read and write…</DropdownMenuItem>
							</DropdownMenuGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				}
			>
				{folders.length ? (
					<ItemGroup>
						{folders.map(({ p, write, added }) => {
							const dropped = forget.includes(p);
							const action = added ? "Leave it out" : dropped ? "Keep it" : "Take it away";
							return (
								<SettingsItem
									key={`${added ? "new" : "had"}:${write}:${p}`}
									media={added ? <PlusIcon /> : <FolderIcon />}
									mediaVariant="icon"
									title={tilde(p)}
									titleClassName={cn("font-mono", dropped && "line-through")}
									actions={<>
										<Badge variant="secondary">{`${write ? "read and write" : "read only"}${added ? ", not saved yet" : ""}`}</Badge>
										<HoverTooltip>
											<TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={action} onClick={() => (added ? leaveOut(p, write) : put("forget", dropped ? forget.filter((x) => x !== p) : [...forget, p]))}>{dropped ? <Undo2Icon /> : <XIcon />}</Button>} />
											<TooltipContent>{action}</TooltipContent>
										</HoverTooltip>
									</>}
								/>
							);
						})}
					</ItemGroup>
				) : (
					<EmptyView icon={FolderIcon} title="No other folders">The agent works in the agent's own workspace only.</EmptyView>
				)}
			</Section>

			<Section data-find="agent-holdings" title="What this agent has" about="Ask the agent, or use the other pages of Settings, to add or remove any of these.">
				<FieldGroup>
					{(
						[
							["Conversations", d.holdings.conversations],
							["Event sources", d.holdings.sources],
							["MCP servers", d.holdings.servers],
							["Schedules", d.holdings.schedules],
							["Skills", d.holdings.skills],
							["Routes that wake it", d.holdings.routes],
						] as Array<[string, string[]]>
					).map(([label, list]) => (
						<Field key={label} orientation="responsive">
							<FieldContent className="min-w-0">
								<FieldTitle>{label}</FieldTitle>
								<FieldDescription className="wrap-anywhere">{list?.length ? list.join(", ") : "none"}</FieldDescription>
							</FieldContent>
						</Field>
					))}
					<Field orientation="responsive">
						<FieldContent className="min-w-0">
							<FieldTitle>Workspace</FieldTitle>
							<FieldDescription className="font-mono wrap-anywhere">{`${tilde(d.workspace)} · ${plural(d.holdings.files, "file")}`}</FieldDescription>
						</FieldContent>
						{store.remote ? null : (
							<Control>
								<Button variant="outline" onClick={() => void bridge.reveal(d.workspace)}><ExternalLinkIcon data-icon="inline-start" />Show</Button>
							</Control>
						)}
					</Field>
				</FieldGroup>
			</Section>

			{d.main ? null : (
				<Section data-find="agent-remove">
					<FieldGroup>
						<Field orientation="responsive">
							<FieldContent className="min-w-0">
								<FieldTitle>Remove this agent</FieldTitle>
								<FieldDescription>{`Removes the agent with all conversations, sources, schedules, servers and skills, the routes that wake it, and the agent's folder and private home.${d.holdings.outside ? " The workspace lies outside pine's home and is left as it is." : ""}`}</FieldDescription>
							</FieldContent>
							<Control>
								<Button variant="destructive" onClick={() => void remove()}><Trash2Icon data-icon="inline-start" />Remove…</Button>
							</Control>
						</Field>
					</FieldGroup>
				</Section>
			)}

			{/* While something is changed, the way to keep it stays in sight at the foot of the page, wherever the change was made. */}
			{dirty ? (
				<div data-slot="unsaved" className="sticky bottom-4 z-10 flex items-center gap-2 rounded-lg border bg-popover py-2 ps-4 pe-2 text-popover-foreground shadow-lg">
					<span className="grow">Unsaved changes</span>
					<Button variant="ghost" disabled={busy} onClick={() => (setChange({}), setTexts({}))}>Discard</Button>
					<Button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save changes"}</Button>
				</div>
			) : null}
		</Page>
	);
}

/**
 * The dialog that makes a new agent, over whatever is in front (`store.newAgent`): the side bar's + and
 * Settings > Agents open it. Once it is made, the agent's conversation opens in a tab: that is where
 * its owner meets it, and the card at its top leads on to its settings.
 */
export function NewAgent({ close, made }: { close: () => void; made: (id: string) => void }) {
	const models = useLoad(() => api.models());
	const [f, setF] = useState({ id: "", instructions: "", model: "" });
	const name = useRef<HTMLInputElement>(null);
	const field = useId();
	const modelItems = [{ value: "", label: "pine's default" }, ...(models.data ?? []).map((m) => ({ value: m, label: m }))];
	const create = async () => {
		const done = await store.attempt(() => api.createAgent({ id: f.id.trim(), instructions: f.instructions.trim(), model: f.model || undefined }));
		if (!done) return;
		store.agents = await store.askAgents().catch(() => store.agents);
		void store.refreshConversations();
		store.flash(`Created the agent ${done.id}.`, "good");
		made(done.id);
	};
	return (
		<Dialog open onOpenChange={(open) => open || close()}>
			<DialogContent showCloseButton={false} initialFocus={name} className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>A new agent</DialogTitle>
				</DialogHeader>
				<ScrollArea className="-mx-4 flex max-h-(--dialog-scroll) min-w-0 wrap-break-word min-h-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade">
					<FieldGroup className="px-4 select-text">
						<Field>
							<FieldLabel htmlFor={`${field}-name`}>Name</FieldLabel>
							<Input id={`${field}-name`} ref={name} className="font-mono" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value.toLowerCase() })} />
							<FieldDescription>Lowercase letters, digits, - and _ (for example research, home, books).</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor={`${field}-instructions`}>Instructions</FieldLabel>
							<Textarea id={`${field}-instructions`} className="min-h-24 max-h-64" value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} placeholder={`You are ${f.id || "books"}. You keep the household's accounts.\n\nHow you work: …`} />
							<FieldDescription>What the new agent is for and how it should work. This becomes the agent's AGENTS.md, which the agent keeps up to date afterwards. Other agents read the first paragraph when they decide who to give work to.</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor={`${field}-model`}>Model</FieldLabel>
							{models.data || models.error ? (
								<Select items={modelItems} value={f.model} onValueChange={(model) => setF({ ...f, model: model ?? "" })}>
								<SelectTrigger id={`${field}-model`}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{modelItems.map((o) => (
											<SelectItem key={o.value} value={o.value}>
												{o.label}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
							) : <SelectPending id={`${field}-model`} />}
						</Field>
					</FieldGroup>
				</ScrollArea>
				<DialogFooter><Button variant="outline" onClick={close}>Cancel</Button><Button disabled={!f.id.trim() || !f.instructions.trim()} onClick={() => void create()}>Create agent</Button></DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function Agents() {
	const s = useModel(store);
	// Which agent's page is open is the app's to say: the side bar and an agent's card open one too.
	const open = s.settingsAgent;
	const setOpen = (id?: string) => ((s.settingsAgent = id), s.touch());
	// The dialog that makes one is the app's (App.tsx), the same one the side bar's + opens.
	const setAdding = (on: boolean) => ((s.newAgent = on), s.touch());
	if (open && s.agents.some((a) => a.id === open)) return <AgentPage id={open} back={() => setOpen(undefined)} />;
	return (
		<Page title="Agents" lead="Each agent has separate instructions, a model, a workspace folder and conversations. Open an agent to change what it may do." actions={<Button variant="outline" onClick={() => setAdding(true)}><PlusIcon data-icon="inline-start" />New agent</Button>}>
			<ItemGroup>
				{s.agents.map((a) => (
					<SettingsItem
						key={a.id}
						render={<button type="button" />}
						onClick={() => setOpen(a.id)}
						title={<>
								{a.id}
								{/* Said as on the agent's card: what makes it the main agent, not a word the owner has to look up. */}
								{a.main ? <Badge variant="outline">administers pine</Badge> : null}
								{/* A mode is a fact, gray like the mode everywhere else; only bypass, where nothing asks, is marked. */}
								<Badge variant={a.mode === "bypass" ? "destructive" : "secondary"}>{a.mode}</Badge>
						</>}
						description={a.description || "no description"}
						actions={<ChevronRightIcon />}
					>
						<ItemDescription className="truncate font-mono">{[a.model || "no model yet", `reasoning ${a.thinking}`, tilde(a.workspace)].join(" · ")}</ItemDescription>
					</SettingsItem>
				))}
			</ItemGroup>
			<SharedInstructions />
		</Page>
	);
}

// ---- models -----------------------------------------------------------------------------------------

/**
 * pi's sign-in, shown step by step: a page to open, a code to type there, or a key to paste here. It is the
 * content of a stock Dialog, which unmounts it when it closes: a sign-in that is not done then is cancelled.
 */
function SignIn({ provider, type, reload }: { provider: string; type?: "api_key" | "oauth"; reload: () => void }) {
	const [id, setId] = useState<string>();
	const [state, setState] = useState<LoginState>();
	const [answer, setAnswer] = useState("");
	const [error, setError] = useState<string>();
	const opened = useRef<string>(undefined);
	const field = useId();
	useEffect(() => {
		let live = true;
		// A dialog closed before the sign-in had started still ends it: nothing else knows its id.
		api.login(provider, type).then((r) => (live ? setId(r.id) : void api.loginAnswer(r.id, { cancel: true }).catch(() => {})), (e) => live && setError(errText(e)));
		return () => {
			live = false;
		};
	}, [provider, type]);
	useEffect(() => {
		if (!id) return;
		let live = true;
		let done = false;
		const look = async () => {
			try {
				const next = await api.loginState(id);
				if (!live) return;
				done = next.done;
				setState(next);
				// The page is opened here, where the owner sits; once.
				if (next.url && opened.current !== next.url) (opened.current = next.url), void bridge.open(next.url);
				if (!next.done) timer = window.setTimeout(look, 700);
			} catch (e) {
				if (live) setError(errText(e));
			}
		};
		let timer = window.setTimeout(look, 150);
		return () => {
			live = false;
			window.clearTimeout(timer);
			if (!done) void api.loginAnswer(id, { cancel: true }).catch(() => {});
		};
	}, [id]);
	const send = async (text: string) => {
		if (!id) return;
		setAnswer("");
		await api.loginAnswer(id, { answer: text }).catch((e) => setError(errText(e)));
	};
	const q = state?.question;
	return (
		<>
			<DialogHeader>
				<DialogTitle>Sign in to {provider}</DialogTitle>
			</DialogHeader>
			<ScrollArea className="-mx-4 flex max-h-(--dialog-scroll) min-w-0 wrap-break-word min-h-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade">
				<div className="flex flex-col gap-3 px-4 select-text">
					{error || state?.error ? <Alert variant="destructive"><TriangleAlertIcon /><AlertDescription>{error ?? state?.error}</AlertDescription></Alert> : null}
					{state?.lines.length ? (
						<CodeBlock size="sm">
							<CodeBlockContent wrap className="max-h-60 select-text">{state.lines.join("\n")}</CodeBlockContent>
						</CodeBlock>
					) : null}
					{state?.url && !state.done ? <div className="flex items-center gap-2"><Button variant="outline" onClick={() => void bridge.open(state.url!)}><ExternalLinkIcon data-icon="inline-start" />Open the sign-in page again</Button>{state.code ? <span>Code: <b className="cursor-auto font-mono">{state.code}</b></span> : null}</div> : null}
					{q && !state?.done ? (
						q.options?.length ? (
							<FieldSet>
								<FieldLegend variant="label">{q.message}</FieldLegend>
								<ItemGroup>
									{q.options.map((o) => (
										<SettingsItem key={o.id} render={<button type="button" />} onClick={() => void send(o.id)} title={o.label} description={o.description || undefined} />
									))}
								</ItemGroup>
							</FieldSet>
						) : (
							<Field>
								<FieldLabel htmlFor={`${field}-answer`}>{q.message}</FieldLabel>
								<div className="flex items-center gap-2">
									<Input id={`${field}-answer`} autoFocus className="font-mono" type={q.secret ? "password" : "text"} autoComplete="off" spellCheck={false} value={answer} onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => e.key === "Enter" && answer.trim() && void send(answer.trim())} />
									<Button disabled={!answer.trim()} onClick={() => void send(answer.trim())}>Continue</Button>
								</div>
								{q.secret ? <FieldDescription>It is not shown, and is stored in auth.json in pine's home, where agents cannot read it.</FieldDescription> : null}
							</Field>
						)
					) : !state?.done && !error ? (
						<div className="flex items-center gap-2 text-muted-foreground"><Pulse label="Loading" /> {state?.url ? "Waiting for you to sign in in the browser…" : "Starting…"}</div>
					) : null}
					{state?.done && !state.error ? (
						<Alert data-tone="good">
							<CheckIcon />
							<AlertDescription>{state.models?.length ? `${plural(state.models.length, "model")} available, for example ${state.models.slice(0, 4).join(", ")}.` : "Signed in."}</AlertDescription>
						</Alert>
					) : null}
					{/* Where the agents' model could not answer, pine took one of the new ones (src/owner.ts, settleModel), and says so; else the choice is offered here, where they were just made available. */}
					{state?.done && !state.error && state.chosen ? <div className="flex items-center gap-2"><span>Your agents run on <b className="font-mono">{state.chosen}</b> now.</span><DialogClose render={<Button variant="outline" />} onClick={() => void store.chooseDefaultModel(state.models).then(reload)}>Another one…</DialogClose></div> : null}
					{state?.done && !state.error && !state.chosen && state.models?.length ? <div className="flex items-center gap-2"><DialogClose render={<Button variant="outline" />} onClick={() => void store.chooseDefaultModel(state.models).then(reload)}>Choose the model your agents run on…</DialogClose><span className="text-muted-foreground">Or later: Change, on the Models page.</span></div> : null}
				</div>
			</ScrollArea>
			<DialogFooter><DialogClose render={<Button variant={state?.done ? "default" : "outline"} />}>{state?.done ? "Done" : "Cancel"}</DialogClose></DialogFooter>
		</>
	);
}

/**
 * Subscriptions people are likely to have already, by the provider's id in pi: shown first, with words they know.
 * Only where the sign-in is the subscription itself (OAuth); everything else is found by searching.
 */
const SUBSCRIPTIONS: Record<string, { title: string; about: string }> = {
	anthropic: { title: "Claude", about: "Sign in with your Claude Pro or Max subscription" },
	"openai-codex": { title: "ChatGPT", about: "Sign in with your ChatGPT Plus or Pro subscription" },
	"github-copilot": { title: "GitHub Copilot", about: "Sign in with your GitHub Copilot subscription" },
};

/** One provider: whether you are signed in, and the way in (a sign-in in the browser, or an API key). */
function ProviderRow({ p, reload }: { p: Provider; reload: () => void }) {
	const sub = SUBSCRIPTIONS[p.id];
	const about = p.signedIn ? `Signed in · ${plural(p.models, "model")}` : sub?.about ?? (p.oauth ? "Sign in with your account, or use an API key" : "Needs an API key");
	return (
		<SettingsItem
			data-provider={p.id}
			title={<>
					{sub?.title ?? p.name ?? p.id}
					{p.signedIn ? <Badge>signed in</Badge> : null}
				</>}
			description={about}
			descriptionClassName="line-clamp-none wrap-anywhere"
			actions={<>
				{p.signedIn ? (
					<AlertDialog>
						<AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>Sign out</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Sign out of {sub?.title ?? p.name ?? p.id}?</AlertDialogTitle>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogCancel variant="destructive" onClick={() => void store.attempt(() => api.logout(p.id)).then((r) => r && reload())}>Sign out</AlertDialogCancel>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				) : null}
				{!p.signedIn && p.oauth ? (
					<Dialog onOpenChange={(open) => open || reload()}>
						<DialogTrigger render={<Button variant="outline" size="sm" />}>Sign in</DialogTrigger>
						<DialogContent showCloseButton={false} className="sm:max-w-xl"><SignIn provider={p.id} type="oauth" reload={reload} /></DialogContent>
					</Dialog>
				) : null}
				<Dialog onOpenChange={(open) => open || reload()}>
					<DialogTrigger render={<Button variant="outline" size="sm" />}>{p.signedIn ? "New API key" : "API key"}</DialogTrigger>
					<DialogContent showCloseButton={false} className="sm:max-w-xl"><SignIn provider={p.id} type="api_key" reload={reload} /></DialogContent>
				</Dialog>
			</>}
		/>
	);
}

/** The content of a stock Dialog: a model server of your own, by its address and a short name. */
function NewModelServer({ made }: { made: () => void }) {
	const [f, setF] = useState({ name: "", url: "", key: "", context: "" });
	const [locked, setLocked] = useState(false);
	const [busy, setBusy] = useState(false);
	const field = useId();
	const add = async () => {
		setBusy(true);
		try {
			const done = await api.addModelServer({ name: f.name.trim(), url: f.url.trim(), key: f.key.trim() || undefined, context: Number(f.context) > 0 ? Number(f.context) : undefined });
			store.flash(`Connected ${f.name} with ${done.models.join(", ")}.${done.chosen ? ` Your agents use ${done.chosen} now.` : ""}`, "good");
			made();
		} catch (e: any) {
			if (e?.data?.locked) setLocked(true);
			store.flash(errText(e), "bad");
		}
		setBusy(false);
	};
	return (
		<>
			<DialogHeader>
				<DialogTitle>Connect a model server</DialogTitle>
				<DialogDescription>A model you run yourself with LM Studio, Ollama or llama.cpp. Start the server first; pine asks it which models it has.</DialogDescription>
			</DialogHeader>
			<ScrollArea className="-mx-4 flex max-h-(--dialog-scroll) min-w-0 wrap-break-word min-h-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade">
				<FieldGroup className="px-4 select-text">
					<Field>
						<FieldLabel htmlFor={`${field}-url`}>Address</FieldLabel>
						<Input id={`${field}-url`} autoFocus className="font-mono" placeholder="http://127.0.0.1:1234/v1" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
						<FieldDescription>LM Studio: http://127.0.0.1:1234/v1. Ollama: http://127.0.0.1:11434/v1.</FieldDescription>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${field}-name`}>Name</FieldLabel>
						<Input id={`${field}-name`} className="font-mono" placeholder="studio" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.toLowerCase() })} />
						<FieldDescription>A short name of your choice. Its models are then called {f.name.trim() || "studio"}/model.</FieldDescription>
					</Field>
					{locked || f.key ? (
						<Field>
							<FieldLabel htmlFor={`${field}-key`}>API key</FieldLabel>
							<Input id={`${field}-key`} className="font-mono" type="password" autoComplete="off" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} />
							<FieldDescription>The server asks for a key. pine keeps it in the .env file in pine's home.</FieldDescription>
						</Field>
					) : null}
					<Field>
						<FieldLabel htmlFor={`${field}-context`}>Context size (tokens)</FieldLabel>
						<Input id={`${field}-context`} className="font-mono" placeholder="ask the server" value={f.context} onChange={(e) => setF({ ...f, context: e.target.value.replace(/\D/g, "") })} />
						<FieldDescription>Optional. Leave it empty and pine asks the server; fill it in only if the server cannot tell.</FieldDescription>
					</Field>
				</FieldGroup>
			</ScrollArea>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
				<Button disabled={!f.name.trim() || !f.url.trim() || busy} onClick={() => void add()}>{busy ? <><Pulse label="Loading" data-icon="inline-start" />Asking the server…</> : "Connect"}</Button>
			</DialogFooter>
		</>
	);
}

/**
 * Settings > Models, in the order a newcomer needs it: what is missing, which model the agents use once there is
 * one, the subscriptions they may have, and a model on their own computer.
 */
/** How many runs a model may be given at a time, as the choices of a select: pine's own limit first. */
const RUNS = [1, 2, 3, 4, 6, 8, 12, 16];

/**
 * A model server of the owner's own: where it is, each of its models on a line of its own with what it can do,
 * who uses it, and for each model how many runs it takes at a time: pine's own limit unless it was given a number.
 * A model on one's own computer serves one or two requests at once, and one server's models are set up differently.
 */
function ModelServerCard({ server: x, inUse, fallback, reload }: { server: ModelServer; inUse: string[]; fallback?: string; reload: () => void }) {
	const runs = x.runs ?? 8;
	const numbers = (own?: number) => [...new Set([...RUNS, ...(own ? [own] : [])])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: `${n} at a time` }));
	const set = (v: string, model: string) => void store.attempt(() => api.limitModel(x.name, model, v === "default" ? null : Number(v))).then((r) => r && reload());
	return (
		<ItemGroup data-find={`model-server:${x.name}`} data-server={x.name}>
			<SettingsItem
				media={<ServerIcon />}
				mediaVariant="icon"
				title={x.name}
				description={x.baseUrl}
				descriptionClassName="font-mono wrap-anywhere"
				actions={
					<AlertDialog>
						<AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>Remove</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Remove the model server {x.name}?</AlertDialogTitle>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogCancel variant="destructive" onClick={() => void store.attempt(() => api.removeModelServer(x.name)).then((r) => r && (store.flash(`Removed ${x.name}.`), reload()))}>Remove</AlertDialogCancel>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				}
			>
				{inUse.length ? <ItemDescription>Used by {inUse.join(", ")}.</ItemDescription> : null}
				{x.models.length ? null : <ItemDescription>This server lists no models.</ItemDescription>}
			</SettingsItem>
			{/* (Each model says how many agents may use it at once, pine's own limit unless it was given a number: one server can serve models that are set up differently.) */}
			{x.models.map((m) => {
				const ref = `${x.name}/${m.id}`;
				return (
					<SettingsItem
						key={m.id}
						data-model={ref}
						contentClassName="basis-full @lg/settings:basis-0"
						titleClassName="font-mono wrap-anywhere"
						title={<>
								{m.id}
								{ref === fallback ? <Badge variant="secondary" className="font-sans">default</Badge> : null}
							</>}
						description={[m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k context` : "", m.images ? "sees pictures" : "text only", m.reasoning ? "can reason" : ""].filter(Boolean).join(" · ")}
						actionsClassName="w-full @lg/settings:w-48 @lg/settings:shrink-0"
						actionsProps={{ "data-setting": `model-runs:${ref}` }}
						actions={<Choose id={`model-runs-${ref}`} items={[{ value: "default", label: `Pine default (${runs})` }, ...numbers(m.limit)]} value={m.limit ? String(m.limit) : "default"} onChange={(v) => set(v, m.id)} />}
					/>
				);
			})}
		</ItemGroup>
	);
}

function Models() {
	const providers = useLoad(() => api.providers());
	const servers = useLoad(() => api.modelServers());
	// A provider picked in the search of Settings is shown by the search of this page: without words it lists only a few.
	const [query, setQuery] = useState(() => store.settingsFind?.filter ?? "");
	const connecting = useRef<DialogRootActions>(null);
	const s = useModel(store);
	const fallback = useLoad(() => api.settings().then((all) => all.find((x) => x.key === "defaults.model")?.now));
	// Only the first load shows a skeleton: a reload with no default set keeps what is there.
	const [fallbackSeen, setFallbackSeen] = useState(false);
	if (!fallbackSeen && !fallback.loading) setFallbackSeen(true);
	const stuck = s.agents.filter((a) => a.modelProblem);
	const reload = () => (providers.reload(), servers.reload(), fallback.reload(), void store.refreshAgents());
	const mine = new Set((servers.data ?? []).map((x) => x.name));
	const hosted = (providers.data ?? []).filter((p) => !mine.has(p.id) && p.id !== "mock");
	const q = query.trim().toLowerCase();
	const nameOf = (p: Provider) => SUBSCRIPTIONS[p.id]?.title ?? p.name ?? p.id;
	// Without a search: what you are signed in to, then the subscriptions people have. With one: each provider whose
	// name or id has the words.
	const rank = (p: Provider) => (p.signedIn ? 0 : SUBSCRIPTIONS[p.id] ? 1 : p.oauth ? 2 : 3);
	const listed = (q ? hosted.filter((p) => `${nameOf(p)} ${p.id}`.toLowerCase().includes(q)) : hosted.filter((p) => rank(p) < 2)).sort((a, b) => rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b)));
	const more = hosted.length - listed.length;
	const anyModel = Boolean(fallback.data) && !stuck.some((a) => !a.model);
	return (
		<Page title="Models" lead="Your agents need a model to think with. Sign in with a subscription you already have, use an API key, or connect a model that runs on your own computer.">
			{/* With no model at all, connecting one is said once, not for every agent. */}
			{stuck.some((a) => !a.model) ? <ModelNotice agent="" problem="" /> : null}
			{stuck.filter((a) => a.model).map((a) => (
				<ModelNotice key={a.id} agent={a.id} model={a.model} problem={a.modelProblem!} />
			))}

			{!fallbackSeen ? (
				<Section title="Default model">
					<ItemGroup><SettingsItemsSkeleton count={1} /></ItemGroup>
				</Section>
			) : anyModel ? (
				<Section title="Default model">
					<FieldGroup>
						<Field orientation="responsive" data-setting="fallback-model">
							<FieldContent className="min-w-0">
								<FieldTitle className="font-mono">{fallback.data}</FieldTitle>
								<FieldDescription>All agents use this model, unless you pick another one for an agent on the agent's page, or in the bar under a conversation.</FieldDescription>
							</FieldContent>
							<Control>
								<Button variant="outline" onClick={() => void store.chooseDefaultModel().then(reload)}>Change…</Button>
							</Control>
						</Field>
					</FieldGroup>
				</Section>
			) : null}

			<Section title="Subscriptions and API keys" about="A model from a provider on the internet." data-find="providers">
				<InputGroup>
					<InputGroupAddon>
						<SearchIcon />
					</InputGroupAddon>
					<InputGroupInput aria-label="Search providers" placeholder={`Search ${hosted.length || ""} providers: Gemini, Mistral, OpenRouter…`} value={query} onChange={(e) => setQuery(e.target.value)} />
				</InputGroup>
				<ItemGroup>
					{providers.data ? (
						listed.length ? listed.map((p) => <ProviderRow key={p.id} p={p} reload={reload} />) : <EmptyView icon={SearchIcon} title="No provider by that name">Try another word, or connect a model of your own below.</EmptyView>
					) : providers.error ? (
						<Alert variant="destructive"><TriangleAlertIcon /><AlertDescription>{providers.error}</AlertDescription></Alert>
					) : (
						<SettingsItemsSkeleton />
					)}
				</ItemGroup>
				{providers.data && !q && more > 0 ? <p className="text-muted-foreground">{plural(more, "more provider")} with an API key or an account. Search to find one.</p> : null}
			</Section>

			<Section
				title="Models on your own computer"
				data-find="model-servers"
				about="Run a model yourself with LM Studio, Ollama or llama.cpp, then connect it here. Set how many agents use a model at once: on your own computer usually 1 or 2."
				actions={
					<Dialog actionsRef={connecting}>
						<DialogTrigger render={<Button variant="outline" />}><PlusIcon data-icon="inline-start" />Connect a server</DialogTrigger>
						<DialogContent showCloseButton={false} className="sm:max-w-xl"><NewModelServer made={() => (connecting.current?.close(), reload())} /></DialogContent>
					</Dialog>
				}
			>
				{servers.data?.length ? (
					<div className="flex flex-col gap-6">
						{servers.data.map((x) => (
							<ModelServerCard key={x.name} server={x} inUse={s.agents.filter((a) => (a.model ?? fallback.data ?? "").startsWith(`${x.name}/`)).map((a) => a.id)} fallback={fallback.data} reload={reload} />
						))}
					</div>
				) : servers.error ? (
					<Alert variant="destructive"><TriangleAlertIcon /><AlertDescription>{servers.error}</AlertDescription></Alert>
				) : servers.data ? null : (
					<ItemGroup><SettingsItemsSkeleton count={1} /></ItemGroup>
				)}
			</Section>
		</Page>
	);
}

// ---- MCP servers ------------------------------------------------------------------------------------

/** A command line cut into its words, with quotes kept together. */
function words(line: string): string[] {
	const out: string[] = [];
	const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
	for (let m = re.exec(line); m; m = re.exec(line)) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : (m[2] ?? m[3]));
	return out;
}

/** The content of a stock Dialog: an MCP server, remote by its address or a program on this computer. */
function NewMcpServer({ made }: { made: () => void }) {
	const [f, setF] = useState({ name: "", kind: "remote" as "remote" | "local", target: "", agent: "", description: "", taints: false });
	const s = useModel(store);
	const field = useId();
	const forItems = whom(s.agents);
	const add = async () => {
		const argv = words(f.target);
		const server = f.kind === "remote" ? { url: f.target.trim() } : { command: argv[0], args: argv.slice(1) };
		const done = await store.attempt(() => api.addMcp(f.name.trim(), { ...server, ...(f.description.trim() ? { description: f.description.trim() } : {}), ...(f.taints ? { taints: true } : {}) }, f.agent || undefined));
		if (!done) return;
		store.flash(`Added ${f.name} for ${f.agent || "all agents"}.${f.kind === "remote" ? " If it needs a sign-in, press Sign in on the server's row." : ""}`, "good", 6000);
		made();
	};
	return (
		<>
			<DialogHeader>
				<DialogTitle>Add an MCP server</DialogTitle>
				<DialogDescription>The server's documentation gives an address or a command to run. Paste it here.</DialogDescription>
			</DialogHeader>
			<ScrollArea className="-mx-4 flex max-h-(--dialog-scroll) min-w-0 wrap-break-word min-h-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade">
				<FieldGroup className="px-4 select-text">
					<Field>
						<FieldLabel htmlFor={`${field}-kind`}>Kind</FieldLabel>
						<Choose id={`${field}-kind`} items={[{ value: "remote" as const, label: "On the internet (an https address)" }, { value: "local" as const, label: "A program on this computer" }]} value={f.kind} onChange={(kind) => setF({ ...f, kind, target: "" })} />
					</Field>
					<Field>
						<FieldLabel htmlFor={`${field}-target`}>{f.kind === "remote" ? "Address" : "Command"}</FieldLabel>
						<Input id={`${field}-target`} className="font-mono" placeholder={f.kind === "remote" ? "https://mcp.example.com/mcp" : "npx -y @example/mcp@latest"} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />
						<FieldDescription>{f.kind === "remote" ? "The server's https address." : "The program and its arguments. One program, no shell operators such as | or &&. It runs where the agent's commands run: in the sandbox in safe and manual mode."}</FieldDescription>
					</Field>
					<FieldGroup className={FORM_GRID}>
						<Field>
							<FieldLabel htmlFor={`${field}-name`}>Name</FieldLabel>
							<Input id={`${field}-name`} className="font-mono" placeholder="home_link" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
							<FieldDescription>Lowercase letters, digits and _.</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor={`${field}-for`}>For</FieldLabel>
							<Select items={forItems} value={f.agent} onValueChange={(agent) => setF({ ...f, agent: agent ?? "" })}>
								<SelectTrigger id={`${field}-for`} className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{forItems.map((o) => (
											<SelectItem key={o.value} value={o.value}>
												{o.label}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
							<FieldDescription>Which agents get its tools.</FieldDescription>
						</Field>
					</FieldGroup>
					<Field>
						<FieldLabel htmlFor={`${field}-description`}>What it offers</FieldLabel>
						<Input id={`${field}-description`} placeholder="Reads and writes my notes" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
						<FieldDescription>Optional. One sentence that tells the agents when to use it.</FieldDescription>
					</Field>
					<Field orientation="horizontal">
						<FieldContent>
							<FieldLabel htmlFor={`${field}-taints`}>Brings in outside content</FieldLabel>
							<FieldDescription>Turn on for a server that reads the web, mail or other people's messages. pine then treats what it returns like a web page, and asks before the agent sends anything out.</FieldDescription>
						</FieldContent>
						<Switch id={`${field}-taints`} checked={f.taints} onCheckedChange={(taints) => setF({ ...f, taints })} />
					</Field>
				</FieldGroup>
			</ScrollArea>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
				<Button disabled={!f.name.trim() || !f.target.trim()} onClick={() => void add()}>Add server</Button>
			</DialogFooter>
		</>
	);
}

function Mcp() {
	const servers = useLoad(() => api.mcp());
	const states = useLoad(() => api.mcpStates());
	const [busy, setBusy] = useState<string>();
	const [out, setOut] = useState<string>();
	const adding = useRef<DialogRootActions>(null);
	const reload = () => (servers.reload(), states.reload());
	const login = async (name: string, agent?: string) => {
		setBusy(name);
		setOut(undefined);
		const r = await store.attempt(() => api.mcpLogin(name, agent));
		setBusy(undefined);
		if (r) (setOut(r.out.trim() || (r.code === 0 ? "Signed in." : `It ended with exit ${r.code}.`)), reload());
	};
	return (
		<Page
			title="MCP servers"
			lead="MCP servers give your agents more tools: a calendar, a database, a service you use. A server is on the internet, reached by its address, or a program on this computer."
			actions={
				<Dialog actionsRef={adding}>
					<DialogTrigger render={<Button variant="outline" />}><PlusIcon data-icon="inline-start" />Add server</DialogTrigger>
					<DialogContent showCloseButton={false} className="sm:max-w-2xl"><NewMcpServer made={() => (adding.current?.close(), reload())} /></DialogContent>
				</Dialog>
			}
		>
			<Section>
				<ItemGroup>
					{servers.data ? (
						servers.data.length ? (
							servers.data.map((x) => {
								const state = !x.enabled ? "turned off" : (states.data?.[x.name] ?? (states.loading ? undefined : x.remote ? "unknown" : "local"));
								const agent = x.scope === "global" ? undefined : x.scope;
								const tone = state === undefined ? undefined : /connected|ok|local|authenticated/i.test(state) ? "good" : /needs|error|fail|unauth/i.test(state) ? "warn" : undefined;
								return (
									<SettingsItem
										key={`${x.scope}:${x.name}`}
										data-find={`mcp:${x.scope}:${x.name}`}
										title={<>
												{x.name}
												{state === undefined ? <Skeleton className="h-5 w-16 rounded-full" /> : <Badge variant={tone === "good" ? "default" : tone === "warn" ? "outline" : "secondary"}>{state}</Badge>}
												<Badge variant="secondary" className="h-auto max-w-full whitespace-normal">{x.scope === "global" ? "all agents" : x.session ? `${x.scope}, one conversation (${x.session})` : x.scope}</Badge>
												{x.taints ? <Badge variant="outline">brings in outside content</Badge> : null}
												{x.approve !== "never" ? <Badge variant="secondary">asks first: {x.approve}</Badge> : null}
											</>}
										description={x.target}
										descriptionClassName="line-clamp-none font-mono wrap-anywhere"
										actions={<>
											{x.remote ? <Button variant="outline" size="sm" disabled={busy === x.name} onClick={() => void login(x.name, agent)}>{busy === x.name ? <><Pulse label="Loading" data-icon="inline-start" />In your browser…</> : "Sign in"}</Button> : null}
											{x.target.startsWith("bundled:") ? null : <AlertDialog>
												<AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>Remove</AlertDialogTrigger>
												<AlertDialogContent>
													<AlertDialogHeader>
														<AlertDialogTitle>Remove the MCP server {x.name}?</AlertDialogTitle>
													</AlertDialogHeader>
													<AlertDialogFooter>
														<AlertDialogCancel>Cancel</AlertDialogCancel>
														<AlertDialogCancel variant="destructive" onClick={() => void store.attempt(() => api.removeMcp(x.name, agent)).then((r) => r && (store.flash(`Removed ${x.name}.`), reload()))}>Remove</AlertDialogCancel>
													</AlertDialogFooter>
												</AlertDialogContent>
											</AlertDialog>}
										</>}
									/>
								);
							})
						) : (
							<EmptyView icon={PlugIcon} title="No MCP servers yet">Add one with its address or command, or ask an agent to add one for you.</EmptyView>
						)
					) : servers.error ? (
						<Alert variant="destructive"><TriangleAlertIcon /><AlertDescription>{servers.error}</AlertDescription></Alert>
					) : (
						<SettingsItemsSkeleton />
					)}
				</ItemGroup>
				{out ? (
					<CodeBlock size="sm">
						<CodeBlockContent wrap className="max-h-60 select-text">{out}</CodeBlockContent>
					</CodeBlock>
				) : null}
			</Section>
		</Page>
	);
}

// ---- skills -----------------------------------------------------------------------------------------

function Skills() {
	const skills = useLoad(() => api.skills());
	const [edit, setEdit] = useState<{ name: string; description: string; instructions: string; agent: string; isNew: boolean; managed: boolean }>();
	const s = useModel(store);
	const field = useId();
	const forItems = whom(s.agents);
	const save = async () => {
		if (!edit) return;
		const done = await store.attempt(() => api.addSkill({ name: edit.name.trim(), description: edit.description.trim(), instructions: edit.instructions, agent: edit.agent || undefined }));
		if (!done) return;
		store.flash(`${done.replaced ? "Replaced" : "Added"} the skill ${done.name}.`, "good");
		setEdit(undefined);
		skills.reload();
	};
	if (edit)
		return (
			<Page back={{ label: "Skills", onClick: () => setEdit(undefined) }} title={edit.isNew ? "A new skill" : edit.name} lead="A skill is a way of doing something, written down so that an agent can do it again: a name, a sentence on when to use it, and the steps." actions={edit.managed ? <Button disabled={!edit.name.trim() || !edit.description.trim() || !edit.instructions.trim()} onClick={() => void save()}>Save skill</Button> : undefined}>
				{edit.managed ? null : (
					<Alert>
						<InfoIcon />
						<AlertDescription>This skill is in a folder of yours that pine.json points to. pine shows it here but does not change it.</AlertDescription>
					</Alert>
				)}
				<FieldGroup className={FORM_GRID}>
					<Field>
						<FieldLabel htmlFor={`${field}-name`}>Name</FieldLabel>
						<Input id={`${field}-name`} className="font-mono" disabled={!edit.isNew} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value.toLowerCase() })} placeholder="invoices" />
						<FieldDescription>Lowercase letters, digits and single hyphens.</FieldDescription>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${field}-for`}>For</FieldLabel>
						{edit.isNew ? (
							<Select items={forItems} value={edit.agent} onValueChange={(agent) => setEdit({ ...edit, agent: agent ?? "" })}>
								<SelectTrigger id={`${field}-for`}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{forItems.map((o) => (
											<SelectItem key={o.value} value={o.value}>
												{o.label}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
						) : (
							<Input id={`${field}-for`} disabled value={edit.agent || "all agents"} />
						)}
					</Field>
					<Field className="col-span-full">
						<FieldLabel htmlFor={`${field}-description`}>When to use it</FieldLabel>
						<Textarea id={`${field}-description`} className="min-h-14 max-h-30" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} readOnly={!edit.managed} />
						<FieldDescription>The agent always sees this line, and reads the steps below only when it fits.</FieldDescription>
					</Field>
				</FieldGroup>
				<div className="flex h-104 overflow-hidden rounded-lg border">
					<Editor file="SKILL.md" text={edit.instructions} readOnly={!edit.managed} onChange={(instructions) => setEdit((was) => (was ? { ...was, instructions } : was))} onSave={() => void save()} />
				</div>
			</Page>
		);
	return (
		<Page title="Skills" lead="Ways of doing things that your agents can reuse. An agent writes one when you ask it to (“make a skill for this”). Here you can read, change and add them." actions={<Button variant="outline" onClick={() => setEdit({ name: "", description: "", instructions: "", agent: "", isNew: true, managed: true })}><PlusIcon data-icon="inline-start" />New skill</Button>}>
			<ItemGroup>
				{skills.data ? (
					skills.data.length ? (
						skills.data.map((x) => {
							const managed = x.managed && x.scope !== "local";
							return (
								<SettingsItem
									key={x.dir}
									data-find={`skill:${x.dir}`}
									title={<>
											{x.name}
											<Badge variant="secondary">{x.scope === "global" ? "all agents" : x.scope === "agent" ? x.agent : `${x.agent} · ${x.session}`}</Badge>
											{x.managed ? null : <Badge variant="secondary">from your own folder</Badge>}
										</>}
									description={short(x.description, 220)}
									descriptionClassName="line-clamp-none wrap-anywhere"
									actions={<>
										<Button variant="outline" size="sm" onClick={() => setEdit({ name: x.name, description: x.description, instructions: x.instructions ?? "", agent: x.agent ?? "", isNew: false, managed })}>{managed ? "Edit" : "Read"}</Button>
										{x.managed ? <AlertDialog>
											<AlertDialogTrigger render={<Button variant="ghost" size="sm" aria-label="Remove this skill" />}>Remove</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>Remove the skill {x.name}?</AlertDialogTitle>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>Cancel</AlertDialogCancel>
													<AlertDialogCancel variant="destructive" onClick={() => void store.attempt(() => api.removeSkill(x.name, x.agent, x.session)).then((r) => r && (store.flash(`Removed the skill ${x.name}.`), skills.reload()))}>Remove</AlertDialogCancel>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog> : null}
									</>}
								/>
							);
						})
					) : (
						<EmptyView icon={BookIcon} title="No skills yet">An agent writes one when you ask it to, or add one here.</EmptyView>
					)
				) : skills.error ? (
					<Alert variant="destructive"><TriangleAlertIcon /><AlertDescription>{skills.error}</AlertDescription></Alert>
				) : (
					<SettingsItemsSkeleton />
				)}
			</ItemGroup>
		</Page>
	);
}

// ---- events: sources, schedules, routes -----------------------------------------------------------------

/** One option of a source type, drawn by what its schema says it is. */
function OptionField({ name, schema, required, value, onChange }: { name: string; schema: any; required: boolean; value: unknown; onChange: (v: unknown) => void }) {
	const type = schema?.type ?? (schema?.anyOf ? "any" : "string");
	const label = `${name}${required ? " *" : ""}`;
	const hint: string | undefined = schema?.description;
	const id = useId();
	if (type === "boolean")
		return (
			<Field orientation="horizontal" className="col-span-full">
				<FieldContent>
					<FieldLabel htmlFor={id}>{label}</FieldLabel>
					{hint ? <FieldDescription>{hint}</FieldDescription> : null}
				</FieldContent>
				<Switch id={id} checked={value === true} onCheckedChange={onChange} />
			</Field>
		);
	if (Array.isArray(schema?.enum)) {
		const items = [{ value: "", label: "not set" }, ...schema.enum.map((v: string) => ({ value: v, label: v }))];
		return (
			<Field>
				<FieldLabel htmlFor={id}>{label}</FieldLabel>
				<Select items={items} value={String(value ?? "")} onValueChange={(v) => onChange(v || undefined)}>
					<SelectTrigger id={id}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{items.map((o) => (
								<SelectItem key={o.value} value={o.value}>
									{o.label}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
				{hint ? <FieldDescription>{hint}</FieldDescription> : null}
			</Field>
		);
	}
	if (type === "number" || type === "integer")
		return (
			<Field>
				<FieldLabel htmlFor={id}>{label}</FieldLabel>
				<Input id={id} className="font-mono" value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} inputMode="decimal" />
				{hint ? <FieldDescription>{hint}</FieldDescription> : null}
			</Field>
		);
	if (type === "array")
		return (
			<Field className="col-span-full">
				<FieldLabel htmlFor={id}>{label}</FieldLabel>
				<Input id={id} className="font-mono" value={Array.isArray(value) ? value.join(", ") : ""} onChange={(e) => onChange(e.target.value.trim() ? e.target.value.split(",").map((x) => x.trim()).filter(Boolean) : undefined)} />
				<FieldDescription>{`${hint ?? ""} Several: separate them with commas.`.trim()}</FieldDescription>
			</Field>
		);
	if (type === "object" || type === "any")
		return (
			<Field className="col-span-full">
				<FieldLabel htmlFor={id}>{label}</FieldLabel>
				<Input id={id} className="font-mono" value={typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} />
				<FieldDescription>{`${hint ?? ""} As JSON.`.trim()}</FieldDescription>
			</Field>
		);
	return (
		<Field className={String(hint ?? "").length > 90 ? "col-span-full" : undefined}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Input id={id} className="font-mono" value={String(value ?? "")} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} />
			{hint ? <FieldDescription>{hint}</FieldDescription> : null}
		</Field>
	);
}

/** The content of a stock Dialog: a new source in two steps, its options then what it will do. */
function NewSource({ types, made }: { types: SourceType[]; made: () => void }) {
	const [f, setF] = useState({ name: "", type: "", description: "", agent: "", own: false, note: "" });
	const [options, setOptions] = useState<Record<string, unknown>>({});
	const [plan, setPlan] = useState<Awaited<ReturnType<typeof api.proposeSource>>>();
	const [values, setValues] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const s = useModel(store);
	const field = useId();
	const forItems = whom(s.agents);
	const typeItems = [{ value: "", label: "Choose what it watches…" }, ...types.map((t) => ({ value: t.name, label: `${t.name}: ${short(t.summary, 80)}` }))];
	const type = types.find((t) => t.name === f.type);
	const props = Object.entries<any>(type?.options?.properties ?? {}).filter(([, schema]) => schema?.secret !== true);
	const required = new Set(type?.options?.required ?? []);
	// What was typed as JSON is handed on as what it says.
	const clean = () => Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined).map(([k, v]) => {
		const kind = type?.options?.properties?.[k]?.type;
		if (typeof v === "string" && (kind === "object" || kind === undefined && type?.options?.properties?.[k]?.anyOf)) {
			try {
				return [k, JSON.parse(v)];
			} catch {
				return [k, v];
			}
		}
		return [k, v];
	}));
	const check = async () => {
		setBusy(true);
		const p = await store.attempt(() => api.proposeSource({ name: f.name.trim(), type: f.type, options: clean(), agent: f.agent || undefined }));
		setBusy(false);
		if (p) (setPlan(p), setValues({}));
	};
	const add = async () => {
		setBusy(true);
		const done = await store.attempt(() => api.addSource({ name: f.name.trim(), type: f.type, description: f.description.trim() || type?.summary || f.type, options: clean(), agent: f.agent || undefined, own: f.own || undefined, values: plan?.needs.length ? values : undefined }));
		if (done && f.note.trim()) {
			const note = f.note.trim();
			await store.attempt(() => (f.agent ? api.subscribe(f.agent, done.name, { note }) : api.subscribeAll(done.name, { note })));
		}
		setBusy(false);
		if (!done) return;
		store.flash(`Added the event source ${done.name}.${done.tell ? ` ${done.tell}` : ""}`, "good", done.tell ? 12_000 : 4000);
		made();
	};
	return (
		<>
			<DialogHeader>
				<DialogTitle>A new event source</DialogTitle>
			</DialogHeader>
			<ScrollArea className="-mx-4 flex max-h-(--dialog-scroll) min-w-0 wrap-break-word min-h-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade">
				<div className="flex flex-col gap-3 px-4 select-text">
					{plan ? (
						<>
							<div><b>{f.name}</b> ({f.type}) for {f.agent || "all agents"} will:</div>
							<ul className="list-disc pl-5">{plan.does.map((d, i) => <li key={i}>{d}</li>)}</ul>
							{plan.owner ? (
								<Alert>
									<TriangleAlertIcon />
									<AlertDescription>What it reports is treated as your own words: the agent it wakes has all tools available.</AlertDescription>
								</Alert>
							) : null}
							<FieldGroup>
								{plan.needs.map((n) => {
									const at = n.label.indexOf(": ");
									return (
										<Field key={n.name}>
											<FieldLabel htmlFor={`${field}-need-${n.name}`}>{at > 0 ? n.label.slice(0, at) : n.name}</FieldLabel>
											<Input id={`${field}-need-${n.name}`} className="font-mono" type="password" autoComplete="off" value={values[n.name] ?? ""} onChange={(e) => setValues({ ...values, [n.name]: e.target.value })} />
											<FieldDescription>{`${at > 0 ? n.label.slice(at + 2) : ""} It is not shown, goes into pine's .env file, and never reaches an agent.`.trim()}</FieldDescription>
										</Field>
									);
								})}
								<Field>
									<FieldLabel htmlFor={`${field}-note`}>Subscribe right away</FieldLabel>
									<Input id={`${field}-note`} placeholder="for example: file the scan and tell me what it is" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
									<FieldDescription>{`What is to be done when it reports something. With a note, the source's events wake ${f.agent || "all agents"}; without one, nobody is subscribed yet.`}</FieldDescription>
								</Field>
							</FieldGroup>
						</>
					) : (
						<FieldGroup className={FORM_GRID}>
							<Field>
								<FieldLabel htmlFor={`${field}-name`}>Name</FieldLabel>
								<Input id={`${field}-name`} autoFocus className="font-mono" placeholder="scans" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.toLowerCase() })} />
								<FieldDescription>Lowercase letters, digits, - and _.</FieldDescription>
							</Field>
							<Field>
								<FieldLabel htmlFor={`${field}-for`}>For</FieldLabel>
								<Select items={forItems} value={f.agent} onValueChange={(agent) => setF({ ...f, agent: agent ?? "" })}>
									<SelectTrigger id={`${field}-for`}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											{forItems.map((o) => (
												<SelectItem key={o.value} value={o.value}>
													{o.label}
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
							</Field>
							<Field className="col-span-full">
								<FieldLabel htmlFor={`${field}-type`}>Type</FieldLabel>
								<Select items={typeItems} value={f.type} onValueChange={(next) => (setF({ ...f, type: next ?? "" }), setOptions({}))}>
									<SelectTrigger id={`${field}-type`}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											{typeItems.map((o) => (
												<SelectItem key={o.value} value={o.value}>
													{o.label}
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
								{type?.summary ? <FieldDescription>{type.summary}</FieldDescription> : null}
							</Field>
							{type ? (
								<Field className="col-span-full">
									<FieldLabel htmlFor={`${field}-description`}>What it reports</FieldLabel>
									<Input id={`${field}-description`} placeholder={type.summary} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
								</Field>
							) : null}
							{props.map(([name, schema]) => <OptionField key={name} name={name} schema={schema} required={required.has(name)} value={options[name]} onChange={(v) => setOptions({ ...options, [name]: v })} />)}
							{type ? (
								<Field orientation="horizontal" className="col-span-full">
									<FieldContent>
										<FieldLabel htmlFor={`${field}-own`}>It is my own</FieldLabel>
										<FieldDescription>Only for a device or folder nobody else can put content into: what it reports is then trusted like your own messages.</FieldDescription>
									</FieldContent>
									<Switch id={`${field}-own`} checked={f.own} onCheckedChange={(own) => setF({ ...f, own })} />
								</Field>
							) : null}
							{type ? <FieldDescription className="col-span-full">A password or token it needs is asked for in the next step.</FieldDescription> : null}
						</FieldGroup>
					)}
				</div>
			</ScrollArea>
			<DialogFooter>{plan ? <><Button variant="outline" onClick={() => setPlan(undefined)}>Back</Button><Button disabled={busy || plan.needs.some((n) => !values[n.name]?.trim())} onClick={() => void add()}>Add source</Button></> : <><DialogClose render={<Button variant="outline" />}>Cancel</DialogClose><Button disabled={busy || !f.name.trim() || !f.type} onClick={() => void check()}>Continue</Button></>}</DialogFooter>
		</>
	);
}

function Sources() {
	const s = useModel(store);
	const sources = useLoad(() => api.sources());
	const types = useLoad(() => api.sourceTypes());
	const adding = useRef<DialogRootActions>(null);
	const subscribe = async (name: string) => {
		const agent = await store.pick({ title: `Who wakes on ${name}?`, items: [{ value: "*", label: "All agents", about: "each in their main conversation" }, ...s.agents.map((a) => ({ value: a.id, label: a.id, about: "in the main conversation" }))] });
		if (!agent) return;
		const note = await store.pick({ title: "What is to be done when it reports something?", items: [{ value: "-", label: "Nothing in particular", about: "the agent decides by the event" }], free: true, placeholder: "A note that is shown with each event" });
		if (note === undefined) return;
		const details = note === "-" ? {} : { note };
		const done = await store.attempt(() => (agent === "*" ? api.subscribeAll(name, details) : api.subscribe(agent, name, details)));
		if (done) (store.flash(`${agent === "*" ? "All agents are" : `${agent} is`} subscribed to ${name}.`, "good"), sources.reload());
	};
	const unsubscribe = async (name: string, who: string) => {
		const [agent, session] = who.split("/");
		const done = await store.attempt(() => (who === "*" || who === "all agents" ? api.unsubscribeAll(name) : api.unsubscribe(agent, name, session ?? "main")));
		if (done) sources.reload();
	};
	return (
		<Section
			title="Sources"
			data-find="sources"
			about="Something that can wake an agent: a folder, a web page, a chat, a device. A source does nothing until an agent is subscribed to it."
			actions={
				<Dialog actionsRef={adding}>
					<DialogTrigger render={<Button variant="outline" disabled={!types.data} />}><PlusIcon data-icon="inline-start" />New source</DialogTrigger>
					<DialogContent showCloseButton={false} className="sm:max-w-2xl">{types.data ? <NewSource types={types.data} made={() => (adding.current?.close(), sources.reload())} /> : null}</DialogContent>
				</Dialog>
			}
		>
			<ItemGroup>
				{sources.data ? (
					sources.data.length ? (
						sources.data.map((x) => (
							<SettingsItem
								key={`${x.scope}:${x.name}`}
								data-find={`source:${x.scope}:${x.name}`}
								media={<span className={cn("size-2 rounded-full", x.error ? "bg-destructive" : x.running ? "bg-primary" : "bg-muted-foreground")} />}
								title={<>
										{x.name}
										<Badge variant="secondary">{x.type}</Badge>
										<Badge variant="secondary">{scopeText(x.scope)}</Badge>
										{x.trust === "owner" ? <Badge>yours</Badge> : null}
									</>}
								description={<>
										{x.description ? <>{x.description}<br /></> : null}
										{x.error ? `not running: ${x.error}` : x.running ? (x.status ?? "running") : "idle, nobody is subscribed"} · {x.last ? `last event ${ago(x.last.ts)}, ${x.events} since start` : "no events since start"}
									</>}
								descriptionClassName="line-clamp-none wrap-anywhere"
								actions={
									<AlertDialog>
										<AlertDialogTrigger render={<Button variant="ghost" size="sm" aria-label="Remove this source" />}>Remove</AlertDialogTrigger>
										<AlertDialogContent>
											<AlertDialogHeader>
												<AlertDialogTitle>Remove the event source {x.name}?</AlertDialogTitle>
											</AlertDialogHeader>
											<AlertDialogFooter>
												<AlertDialogCancel>Cancel</AlertDialogCancel>
												<AlertDialogCancel variant="destructive" onClick={() => void store.attempt(() => api.removeSource(x.name, x.scope === "global" ? undefined : x.scope)).then((r) => r && (store.flash(`Removed the event source ${x.name}.`), sources.reload()))}>Remove</AlertDialogCancel>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog>
								}
							>
								<div className="flex flex-wrap items-center gap-1">
										{x.subscribers.map((who) => (
											<HoverTooltip key={who}>
												<TooltipTrigger render={<Button variant="outline" size="sm" aria-label={`End the subscription of ${who}`} onClick={() => void unsubscribe(x.name, who)}>{who}<XIcon data-icon="inline-end" /></Button>} />
												<TooltipContent>End the subscription of {who}</TooltipContent>
											</HoverTooltip>
										))}
										<Button variant="outline" size="sm" onClick={() => void subscribe(x.name)}><PlusIcon data-icon="inline-start" />Subscribe</Button>
									</div>
							</SettingsItem>
						))
					) : (
						<EmptyView icon={ZapIcon} title="No event sources yet">Add one, or ask an agent: “watch ~/Scans”, “tell me when the price drops”.</EmptyView>
					)
				) : sources.error ? (
					<Alert variant="destructive"><TriangleAlertIcon /><AlertDescription>{sources.error}</AlertDescription></Alert>
				) : (
					<SettingsItemsSkeleton />
				)}
			</ItemGroup>
		</Section>
	);
}

const WHEN: Record<"cron" | "every" | "at" | "in", { label: string; name: string; hint: string; example: string }> = {
	cron: { label: "At set times", name: "Times", example: "0 7 * * 1-5", hint: "minute hour day month weekday: 0 7 * * 1-5 is weekdays at seven, 30 18 * * * every evening at half past six" },
	every: { label: "Every", name: "Interval", example: "6h", hint: "An interval of at least a minute: 30m, 6h, 1d" },
	at: { label: "Once, at", name: "Moment", example: "2026-12-24 17:00", hint: "A local time, once" },
	in: { label: "Once, in", name: "From now", example: "20m", hint: "Once, after this long: 20m, 2h" },
};

// A time in milliseconds as pine.json writes it: 5m, 30s, 2h.
const span = (ms: number) => (ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : ms % 60_000 === 0 ? `${ms / 60_000}m` : ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`);

const conversationOf = (session: string | undefined) => (!session || session === "main" ? "in the main conversation" : session === "new" ? "in a new conversation" : `in the conversation ${session}`);

/** A route in the words of the form that makes one: when what arrives, then what happens. */
function routeSaid(r: Route): { when: string; then: string } {
	const when = [
		r.on.join(" or "),
		r.when ? `only if ${JSON.stringify(r.when)}` : "",
		r.throttleMs ? `at most one per ${span(r.throttleMs)}` : "",
		r.debounceMs ? `the last of a burst, once ${span(r.debounceMs)} passed without another` : "",
	].filter(Boolean).join(", ");
	const then = [
		r.set ? `set ${Object.entries(r.set).map(([k, v]) => `${k} to ${JSON.stringify(v)}`).join(" and ")}` : "",
		r.call ? `ask ${r.call.model ?? "the default model"} once: “${short(r.call.prompt, 80)}”` : "",
		r.publish ? (r.call && r.publish.payload === undefined ? `publish the answer as ${r.publish.topic}` : `publish ${r.publish.topic}${r.publish.payload !== undefined ? ` with ${short(JSON.stringify(r.publish.payload), 60)}` : ""}`) : "",
		r.agent ? `wake ${r.agent} ${conversationOf(r.session)}${r.prompt ? `: “${short(r.prompt, 100)}”` : ", with the event"}` : "",
	].filter(Boolean).join(", then ");
	return { when, then };
}

// What a route does when its event arrives: one of four, and the form shows the fields of that one only.
// `takes` is what of the form goes to POST /routes for it (checkRoute in src/admin.ts).
const ROUTE_DOES = {
	wake: { label: "Wake an agent", about: "The agent gets the event as a task, in the conversation you name.", takes: ["agent", "session", "prompt"] },
	set: { label: "Set shared state", about: "A value is written where agents and other routes read it (state.<key>). No agent is woken.", takes: ["set"] },
	publish: { label: "Publish an event", about: "Another event goes out, for another route, an agent subscribed to it, or a source that sends (out/source/<name>).", takes: ["publish_topic", "publish_payload"] },
	ask: { label: "Ask a model", about: "One model call, without tools or history. The answer goes out as an event of your own, the answer in payload.text.", takes: ["call_prompt", "call_system", "call_model", "publish_topic"] },
} as const;

// How often a route fires: every event, one and then a pause (throttle), or the last of a burst (debounce).
const ROUTE_PACE = {
	every: { label: "Each event", time: "", about: "" },
	throttle: { label: "Limit how often", time: "At most one per", about: "After one event, the next ones are ignored for this long. For an alarm that repeats." },
	debounce: { label: "Wait for a burst to end", time: "Once quiet for", about: "Waits until no event has come for this long, then handles the last one. For a camera that uploads five pictures." },
} as const;

/** The form for a new schedule, in a dialog: When (set times, an interval, or once), Then (whom it wakes, with what task), a name. */
export function NewSchedule({ made }: { made: () => void }) {
	const s = useModel(store);
	const [f, setF] = useState({ name: "", kind: "cron" as keyof typeof WHEN, when: "", task: "", agent: "" });
	const [busy, setBusy] = useState(false);
	const field = useId();
	const forItems = [{ value: "", label: "All agents, each in their main conversation" }, ...s.agents.map((a) => ({ value: a.id, label: `${a.id}, in the main conversation` }))];
	const add = async () => {
		setBusy(true);
		const done = await store.attempt(() => api.addSchedule({ name: f.name.trim(), task: f.task.trim(), [f.kind]: f.when.trim(), agent: f.agent || undefined } as any));
		setBusy(false);
		if (!done) return;
		store.flash(`Scheduled ${done.name}: ${done.when}.`, "good");
		made();
	};
	return (
		<>
			<DialogHeader>
				<DialogTitle>A new schedule</DialogTitle>
				<DialogDescription>When it is time, then an agent is woken with a task, in your name.</DialogDescription>
			</DialogHeader>
			<ScrollArea className="-mx-4 flex max-h-(--dialog-scroll) min-w-0 wrap-break-word min-h-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade">
				<FieldGroup className="px-4">
					<FieldSet>
						<FieldLegend>When</FieldLegend>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor={`${field}-kind`}>It is time</FieldLabel>
								<Choose id={`${field}-kind`} items={Object.entries(WHEN).map(([value, w]) => ({ value: value as keyof typeof WHEN, label: w.label }))} value={f.kind} onChange={(kind) => setF({ ...f, kind, when: "" })} />
							</Field>
							<Field>
								<FieldLabel htmlFor={`${field}-when`}>{WHEN[f.kind].name}</FieldLabel>
								<Input id={`${field}-when`} className="font-mono" placeholder={WHEN[f.kind].example} value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} />
								<FieldDescription>{WHEN[f.kind].hint}</FieldDescription>
							</Field>
						</FieldGroup>
					</FieldSet>
					<FieldSeparator />
					<FieldSet>
						<FieldLegend>Then</FieldLegend>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor={`${field}-for`}>Wake</FieldLabel>
								<Select items={forItems} value={f.agent} onValueChange={(agent) => setF({ ...f, agent: agent ?? "" })}>
									<SelectTrigger id={`${field}-for`}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											{forItems.map((o) => (
												<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
							</Field>
							<Field>
								<FieldLabel htmlFor={`${field}-task`}>With the task</FieldLabel>
								<Textarea id={`${field}-task`} className="min-h-14 max-h-44" placeholder="Look at my calendar for today and tell me what is coming." value={f.task} onChange={(e) => setF({ ...f, task: e.target.value })} />
								<FieldDescription>Write it so it stands alone: the agent reads it with nothing else.</FieldDescription>
							</Field>
						</FieldGroup>
					</FieldSet>
					<FieldSeparator />
					<Field>
						<FieldLabel htmlFor={`${field}-name`}>Name</FieldLabel>
						<Input id={`${field}-name`} className="font-mono" placeholder="morning" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.toLowerCase() })} />
						<FieldDescription>For the list and the log: lowercase letters, digits, - and _.</FieldDescription>
					</Field>
				</FieldGroup>
			</ScrollArea>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
				<Button disabled={busy || !f.name.trim() || !f.when.trim() || !f.task.trim()} onClick={() => void add()}>Add schedule</Button>
			</DialogFooter>
		</>
	);
}

// Whom a schedule wakes, in the words of the form that makes one.
const wakes = (scope: string, session?: string) => (scope === "global" ? "all agents, each in their main conversation" : `${scope} ${conversationOf(session)}`);

/** Settings › Events › Schedules: what a schedule is, each one as When and Then, and New schedule. */
export function Schedules() {
	const list = useLoad(() => api.schedules());
	const adding = useRef<DialogRootActions>(null);
	return (
		<Section
			title="Schedules"
			data-find="schedules"
			about="A task for an agent at set times, every so often, or once, as if you had sent it. You can also just ask an agent: “every morning at seven …”, “remind me at five”."
			actions={
				<Dialog actionsRef={adding}>
					<DialogTrigger render={<Button variant="outline" />}><PlusIcon data-icon="inline-start" />New schedule</DialogTrigger>
					<DialogContent showCloseButton={false} className="sm:max-w-2xl"><NewSchedule made={() => (adding.current?.close(), list.reload())} /></DialogContent>
				</Dialog>
			}
		>
			<ItemGroup>
				{list.data ? (
					list.data.length ? (
						list.data.map((x) => (
							<SettingsItem
								key={`${x.scope}:${x.name}`}
								data-find={`schedule:${x.scope}:${x.name}`}
								title={<>
										{x.name}
										{x.next ? <Badge variant="secondary">next {new Date(x.next).toLocaleString("sv-SE").slice(0, 16)}</Badge> : null}
									</>}
								description={[
									<><span className="font-medium text-foreground">When</span> {x.when}</>,
									<><span className="font-medium text-foreground">Then</span> {x.task ? `wake ${wakes(x.scope, x.session)}: “${short(x.task, 160)}”` : `publish ${x.topic}`}</>,
								]}
								descriptionClassName="line-clamp-none wrap-anywhere"
								actions={
									<AlertDialog>
										<AlertDialogTrigger render={<Button variant="ghost" size="sm" aria-label="Remove this schedule" />}>Remove</AlertDialogTrigger>
										<AlertDialogContent>
											<AlertDialogHeader>
												<AlertDialogTitle>Remove the schedule {x.name}?</AlertDialogTitle>
											</AlertDialogHeader>
											<AlertDialogFooter>
												<AlertDialogCancel>Cancel</AlertDialogCancel>
												<AlertDialogCancel variant="destructive" onClick={() => void store.attempt(() => api.removeSchedule(x.name, x.scope === "global" ? undefined : x.scope)).then((r) => r && list.reload())}>Remove</AlertDialogCancel>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog>
								}
							/>
						))
					) : (
						<EmptyView icon={ClockIcon} title="Nothing is scheduled">An agent schedules something when you ask it to, or add one here.</EmptyView>
					)
				) : list.error ? (
					<Alert variant="destructive"><TriangleAlertIcon /><AlertDescription>{list.error}</AlertDescription></Alert>
				) : (
					<SettingsItemsSkeleton />
				)}
			</ItemGroup>
		</Section>
	);
}

/** The form for a new route, in a dialog: When (topic, condition, pace), Then (one of four actions), a name. */
export function NewRoute({ made, does: first = "wake" }: { made: () => void; does?: keyof typeof ROUTE_DOES }) {
	const s = useModel(store);
	const models = useLoad(() => api.models());
	const [f, setF] = useState({ name: "", on: "", when: "", pace: "every" as keyof typeof ROUTE_PACE, time: "", does: first, agent: "", session: "", prompt: "", set: "", publish_topic: "", publish_payload: "", call_prompt: "", call_system: "", call_model: "" });
	const [busy, setBusy] = useState(false);
	const field = useId();
	const agentItems = s.agents.map((a) => ({ value: a.id, label: a.id }));
	const modelItems = [{ value: "", label: "The default model" }, ...(models.data ?? []).map((m) => ({ value: m, label: m }))];
	const does = ROUTE_DOES[f.does];
	const pace = ROUTE_PACE[f.pace];
	const ready = f.name.trim() && f.on.trim() && (f.pace === "every" || f.time.trim()) && { wake: f.agent, set: f.set.trim(), publish: f.publish_topic.trim(), ask: f.call_prompt.trim() && f.publish_topic.trim() }[f.does];
	const add = async () => {
		// Only the chosen action's fields are sent: one typed under another action and left there would add a second action.
		const body: Record<string, string> = { name: f.name, on: f.on, when: f.when, ...(f.pace === "every" ? {} : { [f.pace]: f.time }) };
		for (const key of does.takes) body[key] = f[key];
		setBusy(true);
		const done = await store.attempt(() => api.addRoute(Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v.trim() || undefined]))));
		setBusy(false);
		if (!done) return;
		store.flash(`Added the route ${done.name}: ${done.lines.join("; ")}.${done.wider ? ` Note: ${done.wider}` : ""}`, done.wider ? "warn" : "good", 8000);
		made();
	};
	return (
		<>
			<DialogHeader>
				<DialogTitle>A new route</DialogTitle>
				<DialogDescription>When an event arrives, then one thing happens.</DialogDescription>
			</DialogHeader>
			<ScrollArea className="-mx-4 flex max-h-(--dialog-scroll) min-w-0 wrap-break-word min-h-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade">
				<FieldGroup className="px-4">
					<FieldSet>
						<FieldLegend>When</FieldLegend>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor={`${field}-on`}>An event arrives on</FieldLabel>
								<Input id={`${field}-on`} className="font-mono" placeholder="source/door/message" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
								<FieldDescription>The event's topic, as the event log shows it. Several: commas between. + is one part (cam/+/motion), # all below (source/door/#).</FieldDescription>
							</Field>
							<Field>
								<FieldLabel htmlFor={`${field}-when`}>Only if</FieldLabel>
								<Input id={`${field}-when`} className="font-mono" placeholder={'{"payload.value.open": true}'} value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} />
								<FieldDescription>{'Optional, as JSON: a value, or a condition such as {"payload.value.temperature": {"gt": 30}}.'}</FieldDescription>
							</Field>
							<Field>
								<FieldLabel htmlFor={`${field}-pace`}>How often</FieldLabel>
								<Choose id={`${field}-pace`} items={Object.entries(ROUTE_PACE).map(([value, p]) => ({ value: value as keyof typeof ROUTE_PACE, label: p.label }))} value={f.pace} onChange={(pace) => setF({ ...f, pace })} />
							</Field>
							{f.pace === "every" ? null : (
								<Field>
									<FieldLabel htmlFor={`${field}-time`}>{pace.time}</FieldLabel>
									<Input id={`${field}-time`} className="font-mono" placeholder="5m" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
									<FieldDescription>{pace.about}</FieldDescription>
								</Field>
							)}
						</FieldGroup>
					</FieldSet>
					<FieldSeparator />
					<FieldSet>
						<FieldLegend>Then</FieldLegend>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor={`${field}-does`}>What happens</FieldLabel>
								<Choose id={`${field}-does`} items={Object.entries(ROUTE_DOES).map(([value, d]) => ({ value: value as keyof typeof ROUTE_DOES, label: d.label }))} value={f.does} onChange={(does) => setF({ ...f, does })} />
								<FieldDescription>{does.about}</FieldDescription>
							</Field>
							{f.does === "wake" ? (
								<>
									<Field>
										<FieldLabel htmlFor={`${field}-agent`}>Agent</FieldLabel>
										<Select items={agentItems} value={f.agent || null} onValueChange={(agent) => setF({ ...f, agent: agent ?? "" })}>
											<SelectTrigger id={`${field}-agent`}>
												<SelectValue placeholder="Choose an agent…" />
											</SelectTrigger>
											<SelectContent>
												<SelectGroup>
													{agentItems.map((o) => (
														<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
													))}
												</SelectGroup>
											</SelectContent>
										</Select>
									</Field>
									<Field>
										<FieldLabel htmlFor={`${field}-session`}>In the conversation</FieldLabel>
										<Input id={`${field}-session`} className="font-mono" placeholder="main" value={f.session} onChange={(e) => setF({ ...f, session: e.target.value })} />
										<FieldDescription>Empty: the agent's main conversation. “new”: a fresh one for each event. Or a name of your own.</FieldDescription>
									</Field>
									<Field>
										<FieldLabel htmlFor={`${field}-prompt`}>Telling it</FieldLabel>
										<Textarea id={`${field}-prompt`} className="min-h-14 max-h-44" placeholder="The front door opened at {{time}}." value={f.prompt} onChange={(e) => setF({ ...f, prompt: e.target.value })} />
										<FieldDescription>{"Optional: without it the agent gets the event itself. {{payload.field}} stands for a value of the event, {{time}} for when it came."}</FieldDescription>
									</Field>
								</>
							) : f.does === "set" ? (
								<Field>
									<FieldLabel htmlFor={`${field}-set`}>Shared state</FieldLabel>
									<Input id={`${field}-set`} className="font-mono" placeholder={'{"house/mode": "{{payload.value}}"}'} value={f.set} onChange={(e) => setF({ ...f, set: e.target.value })} />
									<FieldDescription>{"As JSON: each key and what it is set to. {{payload.field}} stands for a value of the event; null deletes the key."}</FieldDescription>
								</Field>
							) : f.does === "publish" ? (
								<>
									<Field>
										<FieldLabel htmlFor={`${field}-topic`}>Topic</FieldLabel>
										<Input id={`${field}-topic`} className="font-mono" placeholder="house/door" value={f.publish_topic} onChange={(e) => setF({ ...f, publish_topic: e.target.value })} />
										<FieldDescription>A topic of your own. out/source/&lt;name&gt; sends through that source.</FieldDescription>
									</Field>
									<Field>
										<FieldLabel htmlFor={`${field}-payload`}>Payload</FieldLabel>
										<Input id={`${field}-payload`} className="font-mono" placeholder={'{"open": "{{payload.value.open}}"}'} value={f.publish_payload} onChange={(e) => setF({ ...f, publish_payload: e.target.value })} />
										<FieldDescription>Optional, JSON or text. Without it the event's own payload is passed on.</FieldDescription>
									</Field>
								</>
							) : (
								<>
									<Field>
										<FieldLabel htmlFor={`${field}-call`}>Asking it</FieldLabel>
										<Textarea id={`${field}-call`} className="min-h-14 max-h-44" placeholder="Is this message urgent? Answer YES or NO. {{payload.text}}" value={f.call_prompt} onChange={(e) => setF({ ...f, call_prompt: e.target.value })} />
										<FieldDescription>{"{{payload.field}} stands for a value of the event. A picture of the event goes with it if the model takes pictures."}</FieldDescription>
									</Field>
									<Field>
										<FieldLabel htmlFor={`${field}-system`}>Instructions</FieldLabel>
										<Input id={`${field}-system`} placeholder="Answer in one line." value={f.call_system} onChange={(e) => setF({ ...f, call_system: e.target.value })} />
										<FieldDescription>Optional: the system prompt of the call.</FieldDescription>
									</Field>
									<Field>
										<FieldLabel htmlFor={`${field}-model`}>Model</FieldLabel>
										{models.data || models.error ? (
											<Select items={modelItems} value={f.call_model} onValueChange={(m) => setF({ ...f, call_model: m ?? "" })}>
											<SelectTrigger id={`${field}-model`}>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectGroup>
													{modelItems.map((o) => (
														<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
													))}
												</SelectGroup>
											</SelectContent>
										</Select>
							) : <SelectPending id={`${field}-model`} />}
									</Field>
									<Field>
										<FieldLabel htmlFor={`${field}-answer`}>Publish the answer as</FieldLabel>
										<Input id={`${field}-answer`} className="font-mono" placeholder="mail/urgent" value={f.publish_topic} onChange={(e) => setF({ ...f, publish_topic: e.target.value })} />
										<FieldDescription>A topic of your own. A second route on it can wake an agent, with “Only if” on the answer: {'{"payload.text": {"regex": "^YES"}}'}.</FieldDescription>
									</Field>
								</>
							)}
						</FieldGroup>
					</FieldSet>
					<FieldSeparator />
					<Field>
						<FieldLabel htmlFor={`${field}-name`}>Name</FieldLabel>
						<Input id={`${field}-name`} className="font-mono" placeholder="front-door" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.toLowerCase() })} />
						<FieldDescription>For the list and the log: lowercase letters, digits, - and _.</FieldDescription>
					</Field>
				</FieldGroup>
			</ScrollArea>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
				<Button disabled={busy || !ready} onClick={() => void add()}>Add route</Button>
			</DialogFooter>
		</>
	);
}

/** Settings › Events › Routes: when a route is needed at all, each route as When and Then, and New route. */
export function Routes() {
	const list = useLoad(() => api.routes());
	const adding = useRef<DialogRootActions>(null);
	return (
		<Section
			title="Routes"
			data-find="routes"
			about="A rule: when an event arrives, one thing happens, often without waking an agent. Most setups need none: to react to a source, subscribe an agent to it; to do something at a time, add a schedule."
			actions={
				<Dialog actionsRef={adding}>
					<DialogTrigger render={<Button variant="outline" />}><PlusIcon data-icon="inline-start" />New route</DialogTrigger>
					<DialogContent showCloseButton={false} className="sm:max-w-2xl"><NewRoute made={() => (adding.current?.close(), list.reload())} /></DialogContent>
				</Dialog>
			}
		>
			<ItemGroup>
				{list.data ? (
					list.data.length ? (
						list.data.map((r) => {
							const said = routeSaid(r);
							return (
								<SettingsItem
									key={r.name}
									data-find={`route:${r.name}`}
									title={<>
											{r.name}
											{r.trust === "owner" ? <Badge variant="outline">counts as your words</Badge> : null}
										</>}
									description={[
										<><span className="font-medium text-foreground">When</span> {said.when}</>,
										<><span className="font-medium text-foreground">Then</span> {said.then}</>,
									]}
									descriptionClassName="line-clamp-none wrap-anywhere"
									actions={
										<AlertDialog>
											<AlertDialogTrigger render={<Button variant="ghost" size="sm" aria-label="Remove this route" />}>Remove</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>Remove the route {r.name}?</AlertDialogTitle>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>Cancel</AlertDialogCancel>
													<AlertDialogCancel variant="destructive" onClick={() => void store.attempt(() => api.removeRoute(r.name)).then((x) => x && list.reload())}>Remove</AlertDialogCancel>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog>
									}
								/>
							);
						})
					) : (
						<EmptyView icon={GitBranchIcon} title="No routes">You don’t need any to start.</EmptyView>
					)
				) : list.error ? (
					<Alert variant="destructive"><TriangleAlertIcon /><AlertDescription>{list.error}</AlertDescription></Alert>
				) : (
					<SettingsItemsSkeleton />
				)}
			</ItemGroup>
		</Section>
	);
}

function EventsPage() {
	return (
		<Page title="Events" lead="What starts your agents without you typing a message: sources that report something, schedules at set times, and routes that pass events on." actions={<Button variant="outline" onClick={() => void store.openEvents()}><AudioLinesIcon data-icon="inline-start" />Event log</Button>}>
			{/* All three at once, each with what it has: nothing set up is hidden behind a tab. Routes last, the one few need. */}
			<Sources />
			<Schedules />
			<Routes />
		</Page>
	);
}

// ---- instructions for all agents -------------------------------------------------------------------------

/**
 * The files for all agents in pine's home (AGENTS.md, TOOLS.md, USER.md), at the foot of Settings > Agents: one
 * tab each, and the bar of unsaved changes as on an agent's page, which saves every file that was changed.
 */
function SharedInstructions() {
	const files = useLoad(() => api.shared());
	const [name, setName] = useState("AGENTS.md");
	const [texts, setTexts] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const changed = (files.data ?? []).filter((f) => texts[f.name] !== undefined && texts[f.name] !== f.text);
	const save = async () => {
		if (!changed.length) return;
		setBusy(true);
		for (const f of changed) {
			const done = await store.attempt(() => api.setShared(f.name, texts[f.name]));
			if (!done) return setBusy(false);
		}
		setBusy(false);
		store.flash(`Saved ${changed.map((f) => f.name).join(", ")}. All agents read the change from their next message on.`, "good");
		setTexts({});
		files.reload();
	};
	return (
		<Section data-find="shared-instructions" title="Instructions for all agents" about="Notes that all agents read with each message. The main agent keeps them up to date when you tell it something meant for everybody, and you can change them here. Something for one agent only goes into that agent's own files: open the agent above.">
			{files.data ? (
				<FileTabs files={files.data.map((f) => ({ key: f.name, label: f.name, about: f.about }))} value={name} onChange={setName}>
					{(key) => (
						<div className="flex h-72 overflow-hidden rounded-lg border">
							<Editor key={key} file={key} text={texts[key] ?? files.data!.find((f) => f.name === key)?.text ?? ""} onChange={(v) => setTexts((was) => ({ ...was, [key]: v }))} onSave={() => void save()} />
						</div>
					)}
				</FileTabs>
			) : files.error ? (
				<Alert variant="destructive"><TriangleAlertIcon /><AlertDescription>{files.error}</AlertDescription></Alert>
			) : (
				<FilesSkeleton />
			)}
			{changed.length ? (
				<div data-slot="unsaved" className="sticky bottom-4 z-10 flex items-center gap-2 rounded-lg border bg-popover py-2 ps-4 pe-2 text-popover-foreground shadow-lg">
					<span className="grow">Unsaved changes in {changed.map((f) => f.name).join(", ")}</span>
					<Button variant="ghost" disabled={busy} onClick={() => setTexts({})}>Discard</Button>
					<Button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save changes"}</Button>
				</div>
			) : null}
		</Section>
	);
}

// ---- the app itself ----------------------------------------------------------------------------------------

/** A theme's look in a few colors: the page, the text, the accent and three kinds of code. */
function Swatch({ colors }: { colors: Record<string, string> }) {
	const dots = [colors.brand, colors["code-keyword"], colors["code-string"], colors["code-function"]];
	return (
		<span aria-hidden className="inline-flex flex-none items-center gap-0.5 rounded-sm border px-1 py-0.5" style={{ backgroundColor: colors.bg }}>
			<span className="text-[0.625rem] font-semibold leading-none" style={{ color: colors.text }}>Aa</span>
			{dots.map((c, i) => <span key={i} className="size-1.5 rounded-full" style={{ backgroundColor: c }} />)}
		</span>
	);
}

/**
 * The theme of the window: a VS Code color theme from the themes folder of pine's home, chosen as
 * pine's setting `ui.theme`. The colors are pine's (theme.ts): the page draws nothing a file says
 * but colors. A file pine cannot read is named with what is wrong with it.
 */
export function ThemePicker() {
	const s = useModel(store);
	const id = useId();
	const usable = s.themes.filter((t): t is Look => !("problem" in t));
	const broken = s.themes.filter((t): t is Extract<ThemeEntry, { problem: string }> => "problem" in t);
	const items = usable.map((t) => ({ value: t.id, label: t.name }));
	const folder = s.service.status === "ready" ? `${tilde(s.service.home)}/themes` : "the themes folder of pine's home";
	return (
		<>
			<Field orientation="responsive" data-setting="theme">
				<FieldContent className="min-w-0">
					<FieldLabel htmlFor={id}>Theme</FieldLabel>
					<FieldDescription className="wrap-anywhere">To add a VS Code color theme, put its .json file into {folder}. The choice is saved in pine, so all Pine apps that use this pine show it.</FieldDescription>
				</FieldContent>
				<Control>
					{s.themesRead ? <Select items={items} value={s.theme} onValueChange={(v) => v && v !== s.theme && void s.setTheme(v)} disabled={!usable.length}>
						<SelectTrigger id={id} className={CONTROL}>
							<SelectValue />
						</SelectTrigger>
						{/* Below the trigger, not over it: a long list next to the window's edge stays on screen. */}
						<SelectContent alignItemWithTrigger={false} align="end" className="min-w-60">
							{(["dark", "light"] as const).map((kind, i) => {
								const of = usable.filter((t) => t.kind === kind);
								return of.length ? (
									<SelectGroup key={kind}>
										{i && usable.some((t) => t.kind === "dark") ? <SelectSeparator /> : null}
										<SelectLabel>{kind === "dark" ? "Dark" : "Light"}</SelectLabel>
										{of.map((t) => (
											<SelectItem key={t.id} value={t.id}>
												<Swatch colors={t.colors} />
												{t.name}
											</SelectItem>
										))}
									</SelectGroup>
								) : null;
							})}
						</SelectContent>
					</Select> : <SelectPending id={id} />}
				</Control>
			</Field>
			{broken.length ? (
				<Alert variant="destructive">
					<TriangleAlertIcon />
					<AlertDescription>
						{broken.map((t) => <p key={t.id}>{t.id}.json: {t.problem}</p>)}
					</AlertDescription>
				</Alert>
			) : null}
		</>
	);
}

// ---- environments: the pine of this computer, or of another machine ------------------------------------

/**
 * The bridge's own SSH key (the phone's), with Copy and Share: what goes into ~/.ssh/authorized_keys
 * on a machine. Nothing under a bridge that has none (the desktop app uses the owner's ssh).
 */
function DeviceKey() {
	// Undefined while it is asked, null when the bridge has none.
	const [key, setKey] = useState<{ key: string; copy: () => Promise<void>; share: () => Promise<void> } | null>();
	// (Asked by its answer: Storybook's stand-in answers every name with a function that gives no key.)
	useEffect(() => {
		if (typeof bridge.deviceKey !== "function") return setKey(null);
		Promise.resolve(bridge.deviceKey()).then((k) => setKey(typeof k?.key === "string" ? k : null), () => setKey(null));
	}, []);
	if (key === undefined) return <SettingsItem skeleton data-slot="device-key-skeleton" />;
	if (!key) return null;
	return (
		<SettingsItem
			data-slot="device-key"
			// The key takes the whole line, and the buttons go under it: beside it they would squeeze it into a column.
			contentClassName="basis-full"
			title="This device's key"
			actions={<>
				<Button variant="outline" size="sm" onClick={() => void key.copy().then(() => store.flash("The key is on the clipboard.", "good", 3000), (e: unknown) => store.flash(errText(e), "bad"))}>Copy</Button>
				<Button variant="outline" size="sm" onClick={() => void store.attempt(() => key.share())}>Share</Button>
			</>}
		>
			<ItemDescription className="line-clamp-none font-mono text-xs wrap-anywhere select-text">{key.key}</ItemDescription>
			<ItemDescription className="line-clamp-none">Add it as a line of ~/.ssh/authorized_keys of the user you sign in as on each machine.</ItemDescription>
		</SettingsItem>
	);
}

/**
 * A host as text that may break after its `@` and before each `.` and `:` (user@machine.tailnet.ts.net:10000),
 * so that a long one wraps between its parts rather than inside a word; `wrap-anywhere` around it is the fallback.
 */
export function Breakable({ host }: { host: string }) {
	const parts = host.split(/(?<=@)|(?=[.:])/);
	return <>{parts.map((part, i) => <Fragment key={i}>{i ? <wbr /> : null}{part}</Fragment>)}</>;
}

/**
 * The machines whose pine the app can use, their state, and a field to add one: Settings >
 * Environments, and the Gate under a bridge with no local machine, where it is the only way to a pine.
 */
export function MachineList() {
	const s = useModel(store);
	const [host, setHost] = useState("");
	const [error, setError] = useState<string>();
	const field = useId();
	const state = s.service;
	const key = s.keyToTrust;
	const here = `This ${computerWord(s.platform)}`;
	// How to pair, or the user@host machines over SSH: never both at once (`machinesView`).
	const shown = s.machinesShown;
	// WSL on Windows: the distributions this computer has, and what the app says when it brings pine into one.
	const [distros, setDistros] = useState<string[]>([]);
	const [installed, setInstalled] = useState<{ distro: string; sandbox: string }>();
	const [installing, setInstalling] = useState<string>();
	useEffect(() => {
		// (A bridge without WSL, or a stand-in, may answer with anything: only a list of names counts.)
		if (s.local)
			Promise.resolve(bridge.wslDistros?.())
				.then((d) => setDistros(Array.isArray(d) ? d.filter((x): x is string => typeof x === "string") : []))
				.catch(() => setDistros([]));
	}, [s.local]);
	const addWsl = async (d: string) => {
		setError(undefined);
		try {
			s.prefs = await bridge.addHost(`wsl:${d}`);
			s.touch();
		} catch (e) {
			setError(errText(e));
		}
	};
	const install = async (d: string) => {
		setError(undefined);
		setInstalling(d);
		try {
			const r = await bridge.wslInstall!(d);
			setInstalled({ distro: d, sandbox: r.sandbox });
			void bridge.retry();
		} catch (e) {
			setError(errText(e));
		} finally {
			setInstalling(undefined);
		}
	};
	const add = async () => {
		setError(undefined);
		try {
			s.prefs = await bridge.addHost(host);
			setHost("");
			s.touch();
		} catch (e) {
			setError(errText(e));
		}
	};
	// A paired computer is asked about first: forgetting it here leaves its access open (`forgetMachine`).
	const forget = (h: string) => s.forgetMachine(h);
	/** How the pine of a row is, when it is the one the app uses; nothing is asked of the others. */
	const status = (h?: string) => {
		if (state.host !== h) return null;
		// Ready, with its agents still being loaded: the event stream may not be up yet, which is no loss.
		if (state.status === "starting" || (state.status === "ready" && !s.opened && !s.loadError)) return <Badge variant="outline"><Pulse label="Loading" data-icon="inline-start" />connecting</Badge>;
		// It answered and its agents did not load: no wait to show, the Gate says why and offers Try again.
		if (state.status === "ready" && s.loadError) return <Badge variant="destructive">not loaded</Badge>;
		if (state.status === "error") return <Badge variant="destructive">not reached</Badge>;
		return <Badge variant={s.connected ? "default" : "outline"}>{s.connected ? "in use" : "not answering"}</Badge>;
	};
	/** What a row says of its machine when nothing is wrong: a paired computer by its name (its id says nothing), user@host as written. */
	const about = (h: string) => (isPaired(h) ? <>The pine of the Pine app on {s.nameOf(h)}, paired with this {s.device}.</> : <>The pine on <Breakable host={h} />, over SSH.</>);
	const row = (h: string | undefined) => (
		<SettingsItem
			key={h ?? ""}
			data-environment={h ?? "local"}
			media={h?.startsWith("wsl:") ? <TerminalSquareIcon /> : h && !isPaired(h) ? <ServerIcon /> : <LaptopIcon />}
			mediaVariant="icon"
			// The text asks for 20rem before it shares its line: where the buttons would leave it less (a phone, the Gate, the four of a machine in error), the Item wraps them onto a line of their own.
			contentClassName="flex-[1_1_20rem]"
			// A long host (a Tailscale Funnel name and its port) wraps where it breaks naturally, and the badge goes onto the next line: neither spills out of the row. `flex` again after `line-clamp-none`, which sets `display: block`.
			titleClassName="name line-clamp-none flex w-full min-w-0 flex-wrap"
			title={<>
					{/* A machine with a name (a paired computer, one the owner renamed) is shown by it; user@host without one as written, in mono. */}
					<span className={cn("min-w-0 wrap-anywhere", h && !isPaired(h) && !h.startsWith("wsl:") && !s.prefs.names?.[h] && "font-mono")}>{h?.startsWith("wsl:") ? `${h.slice(4)} (WSL)` : h ? isPaired(h) || s.prefs.names?.[h] ? s.nameOf(h) : <Breakable host={h} /> : here}</span>
					{status(h)}
				</>}
			description={state.host === h && state.status === "error" ? state.message : h?.startsWith("wsl:") ? `The pine in ${h.slice(4)}, a Linux of WSL on this computer, where pine has its sandbox.` : h ? about(h) : "The pine on this computer: the one that runs, or one this app starts."}
			descriptionClassName="line-clamp-none wrap-anywhere"
			actions={<>
				{key && key.host === h ? <Button size="sm" data-slot="trust-host-key" onClick={() => void s.trustHostKey(key)}>Trust this key</Button> : null}
				{h?.startsWith("wsl:") && state.host === h && state.status === "error" && /is not installed in/.test(state.message ?? "") && bridge.wslInstall ? (
					<Button size="sm" data-slot="wsl-install" disabled={installing === h.slice(4)} onClick={() => void install(h.slice(4))}>
						{installing === h.slice(4) ? <Pulse label="Installing" data-icon="inline-start" /> : null}Bring pine in
					</Button>
				) : null}
				{state.host === h && state.status === "error" ? <Button variant="outline" size="sm" onClick={() => void bridge.retry()}>Try again</Button> : null}
				{state.host === h ? null : <Button variant="outline" size="sm" onClick={() => void s.useMachine(h)}>Use</Button>}
				{state.host === h && s.canDisconnect ? <Button variant="outline" size="sm" data-slot="disconnect" onClick={() => void s.disconnect()}>Disconnect</Button> : null}
				{h && s.canRename ? <Button variant="outline" size="sm" data-slot="rename-machine" onClick={() => void s.renameMachine(h)}>Rename</Button> : null}
				{/* With no local machine to fall back on, the one in use may go when it is not reached (its host key changed, say). */}
				{h && (state.host !== h || (!s.local && state.status === "error")) ? <Button variant="ghost" size="sm" onClick={() => void forget(h)}>Forget</Button> : null}
			</>}
		>
				{h && reachedThrough(h, s.serviceHost) ? <ItemDescription className="line-clamp-none wrap-anywhere" data-slot="reached-through">{reachedThrough(h, s.serviceHost)}</ItemDescription> : null}
				{key && key.host === h ? <ItemDescription className="line-clamp-none font-mono text-xs break-all select-text" data-slot="host-key-fingerprint">{key.fingerprint}</ItemDescription> : null}
		</SettingsItem>
	);
	return (
		<>
			<div className="flex flex-col gap-3">
				{shown.back ? (
					<Button variant="ghost" size="icon-sm" className="self-start" data-slot="back-to-pairing" aria-label="Back to pairing" onClick={() => s.showMachines("pair")}>
						<ArrowLeftIcon />
					</Button>
				) : null}
				<ItemGroup>
					{s.local ? row(undefined) : null}
					{s.prefs.hosts.map(row)}
				</ItemGroup>
				{installed ? (
					<Alert data-slot="wsl-installed">
						<InfoIcon />
						<AlertDescription>
							<p>pine is in {installed.distro}, with a home. Its sandbox needs bubblewrap there, which takes the password of your user in {installed.distro}: run this once in a terminal of Windows, and answer its question.</p>
							<p className="font-mono text-xs select-text">{installed.sandbox}</p>
						</AlertDescription>
					</Alert>
				) : null}
				{distros.filter((d) => !s.prefs.hosts.includes(`wsl:${d}`)).length ? (
					<FieldSet data-slot="wsl-distros">
						<FieldLegend>WSL on this computer</FieldLegend>
						<FieldDescription>A Linux of WSL runs pine with its sandbox, which pine on Windows itself does not have yet.</FieldDescription>
						<ItemGroup>
							{distros
								.filter((d) => !s.prefs.hosts.includes(`wsl:${d}`))
								.map((d) => (
									<Item key={d} variant="outline" data-environment={`wsl:${d}`}>
										<ItemMedia variant="icon"><TerminalSquareIcon /></ItemMedia>
										<ItemContent><ItemTitle>{d}</ItemTitle></ItemContent>
										<ItemActions><Button variant="outline" size="sm" onClick={() => void addWsl(d)}><PlusIcon data-icon="inline-start" />Add</Button></ItemActions>
									</Item>
								))}
						</ItemGroup>
					</FieldSet>
				) : null}
				{/* The pairing view has no user@host to add, nor a key for one. */}
				{shown.view === "pair" ? <PairHowTo /> : s.local ? null : <DeviceKey />}
				{shown.toSsh ? (
					<Button variant="link" size="sm" className="self-start px-0" data-slot="ssh-instead" onClick={() => s.showMachines("ssh")}>
						Or connect to a server over SSH
					</Button>
				) : null}
			</div>
			{shown.view === "ssh" ? <Section title="Add a machine" data-find="add-machine">
				<FieldGroup>
					<Field>
						<FieldLabel htmlFor={`${field}-host`}>Host</FieldLabel>
						<div className="flex items-center gap-2">
							<Input id={`${field}-host`} className="font-mono" placeholder="you@server" value={host} onChange={(e) => setHost(e.target.value)} onKeyDown={(e) => e.key === "Enter" && host.trim() && void add()} />
							<Button variant="outline" disabled={!host.trim()} onClick={() => void add()}><PlusIcon data-icon="inline-start" />Add</Button>
						</div>
						<FieldDescription>{s.local ? "As you would write it after ssh: host, user@host, or a name from ~/.ssh/config. It is connected to when you pick it." : "As you would write it after ssh: user@host, or user@host:port. It is connected to when you pick it."}</FieldDescription>
					</Field>
					{error ? <Alert variant="destructive"><TriangleAlertIcon /><AlertDescription>{error}</AlertDescription></Alert> : null}
					{/* Where a relay is in play (the web client), it is said plainly, so that nobody forgets it. */}
					{s.serviceHost ? <FieldDescription data-slot="relay-line">{relayLine(s.serviceHost)}</FieldDescription> : null}
				</FieldGroup>
			</Section> : null}
		</>
	);
}

/**
 * The computers on this network, looked for while this is shown (and only then: a phone asks for the
 * local network the first time, never at launch). A tap asks the computer without a code.
 */
function PairNearby() {
	const s = useModel(store);
	const [found, setFound] = useState<NearbyFound>({ computers: [] });
	useEffect(() => {
		const stop = bridge.nearby!((next) => setFound({ computers: Array.isArray(next?.computers) ? next.computers : [], denied: next?.denied === true }));
		return () => void (typeof stop === "function" && stop());
	}, []);
	return <NearbyComputers found={found} device={s.device} onPick={(c) => void s.pairNearby(c)} />;
}

/**
 * How a device is paired with a computer: first the computers found on this network where the bridge
 * looks (the mobile app's), or the Pine app on this computer where the browser runs beside it (the
 * web client's on a computer); then the code, in short, and where the Pine app is for a computer
 * without it. Under a bridge that takes a link from the owner's hand (the mobile app's), the field to
 * paste one into.
 */
function PairHowTo() {
	const s = useModel(store);
	return (
		<>
			{s.canFindNearby ? <PairNearby /> : null}
			{s.canOpenApp ? (
				<div className="flex flex-col items-start gap-1" data-slot="open-app">
					<Button data-slot="open-pine-here" onClick={() => void store.attempt(() => bridge.openApp!())}><ExternalLinkIcon data-icon="inline-start" />Open Pine on this computer</Button>
					<p className="text-sm text-muted-foreground">Where Pine runs on this computer with Browser access on, it opens a pairing and sends its link to this browser.</p>
				</div>
			) : null}
		<SettingsItem
			data-slot="pair-how-to"
			contentClassName="basis-full"
			title={s.canFindNearby ? "Or pair with a code" : "Pair with your computer"}
			actions={<Button variant="outline" size="sm" data-slot="get-the-app" onClick={() => void store.attempt(() => bridge.open(APP_DOWNLOAD))}><ExternalLinkIcon data-icon="inline-start" />Get the Pine app</Button>}
		>
				<ol className="list-decimal ps-5 text-sm text-muted-foreground">
					<li>On your computer: Pine &gt; Add a device.</li>
					<li>{s.canPasteLink ? "Scan the code with this phone's camera and open it in Pine, or paste the link it gives below." : "Scan the code with this device's camera, or open the link it gives in this browser."}</li>
				</ol>
				{s.canPasteLink ? <PairLinkField onLink={(text) => s.askToPair(text)} /> : null}
				{s.serviceHost ? <ItemDescription className="line-clamp-none wrap-anywhere" data-slot="meeting-line">{meetingLine(s.serviceHost)}</ItemDescription> : null}
		</SettingsItem>
		</>
	);
}

function Environments() {
	const s = useModel(store);
	const pairing = s.machinesShown.view === "pair";
	const needs = s.local
		? [
				<>The machine needs pine, set up there with <span className="font-mono">pine init</span>.</>,
				<>SSH has to sign you in without a password: a key in ssh-agent, or Tailscale SSH. Connect once from a terminal (<span className="font-mono">ssh</span> and the machine's name) so that SSH knows the machine.</>,
				<>pine there stays closed to the network: the app runs pine over SSH and forwards a port of this computer to it.</>,
				<>Switching shows the other pine and stops neither; agents at work go on. A pine the app started on a machine stops when the app quits.</>,
				<>With another machine's pine, a conversation's folder is a path on that machine, and the terminal and the Run buttons, which run on this computer, are not offered.</>,
			]
		: [
				<>The machine needs pine, set up there with <span className="font-mono">pine init</span>.</>,
				<>Add this device's key as a line of <span className="font-mono">~/.ssh/authorized_keys</span> of the user you sign in as.</>,
				<>The first time, the app shows the machine's host key fingerprint. Compare it with what the machine shows, then trust it.</>,
			];
	return (
		<Page title="Environments" lead={s.local ? "Where the pine this app uses runs: on this computer, or on another machine that you reach over SSH. Switch between them at the bottom of the side bar." : pairing ? `The pine this ${s.device} uses: the Pine app's pine on a computer paired with it. Switch between them at the bottom of the side bar.` : "The pine this app uses, on a machine that you reach over SSH. Switch between them at the bottom of the side bar."}>
			<MachineList />
			{/* In the pairing view, the list's how-to is all there is to say. */}
			{!pairing ? (
				<Section title="What a machine needs" data-find="machine-needs">
					<ul className="flex list-disc flex-col gap-1 ps-5 text-muted-foreground">
						{needs.map((line, i) => <li key={i}>{line}</li>)}
					</ul>
				</Section>
			) : null}
		</Page>
	);
}

/** What Settings > General says of a newer app, by where its update stands (`Store.updatePhase`). */
const UPDATE_TEXT: Record<UpdatePhase["phase"], (u: UpdatePhase) => string> = {
	waiting: () => "The new app is downloaded, and Pine restarts to update once no conversation is at work. Call off the wait to restart or quit when you like. Your pine home stays as it is.",
	ready: () => "The new app is downloaded. Restart to update, or it is installed when you next quit Pine. Your pine home stays as it is.",
	downloading: () => "The new app is being downloaded.",
	link: (u) => `${u.reason ? `${u.reason} ` : ""}The new app is ${newApp().what} on the release's page on GitHub: ${newApp().how}. Your pine home stays as it is.`,
};

/**
 * The top of Settings > General: this app (theme, updates, notifications) and the pine it uses (its state,
 * the log, Keep running, the command, the browser build, the home folder).
 */
function AppSections({ overview }: { overview?: Awaited<ReturnType<typeof api.overview>> }) {
	const s = useModel(store);
	const set = async (change: Record<string, unknown>) => {
		s.prefs = await bridge.prefs(change);
		s.touch();
	};
	const service = s.service.status === "ready" ? s.service : undefined;
	const update = s.updatePhase;
	// `pine` for a terminal: what the shell has, as the app's main process sees it.
	// (null: the bridge failed to answer, and the field is left out.)
	const [command, setCommand] = useState<{ state: "none" | "here" | "other" | "unavailable"; why?: string; managed?: boolean; text: string } | null>();
	// Under a bridge with no local machine (`s.local`), what only this computer has is neither asked nor shown:
	// its home folder, Keep running, Restart, the pine command, the browser build, the Electron version.
	const local = s.local;
	useEffect(() => void (local && bridge.command().then(setCommand, () => setCommand(null))), [local]);
	// (Looked at again whenever this page is opened: the browser may have been fetched in a terminal.)
	useEffect(() => void (local && store.checkBrowser()), [local]);
	// (And the themes: a file may have been put into the folder by hand.)
	useEffect(() => void store.refreshThemes(), []);
	const field = useId();
	return (
		<>
			<Section title="This app">
				<FieldGroup>
					<ThemePicker />
					{s.updates ? (
						<Field orientation="responsive" data-setting="updates">
							<FieldContent>
								<FieldTitle>
									Pine {s.versions.app}
									{update ? <Badge variant="outline">{update.version} is available</Badge> : s.update?.status === "latest" ? <Badge>the latest version</Badge> : null}
								</FieldTitle>
								<FieldDescription>
									{update ? UPDATE_TEXT[update.phase](update) : s.selfUpdate ? "The app looks on GitHub for a newer release, downloads it, and installs it when you restart or quit." : "The app does not update itself. It looks on GitHub for a newer release and tells you when there is one."}
								</FieldDescription>
							</FieldContent>
							<Control>
								{update?.phase === "waiting" ? <Button variant="outline" onClick={() => s.cancelUpdateWait()}><XIcon data-icon="inline-start" />Call off the wait</Button> : null}
								{update?.phase === "ready" ? <Button onClick={() => void s.restartToUpdate()}><RotateCwIcon data-icon="inline-start" />Restart to update</Button> : null}
								{update?.phase === "link" ? <Button variant="outline" onClick={() => void bridge.open(update.url)}><ExternalLinkIcon data-icon="inline-start" />Release page</Button> : null}
								<Button variant="outline" disabled={s.updateLooking} onClick={() => void s.lookForUpdate(true)}><RotateCwIcon data-icon="inline-start" />Check now</Button>
							</Control>
						</Field>
					) : null}
					{s.updates ? (
						<Field orientation="horizontal" data-find="updates-at-start">
							<FieldContent>
								<FieldLabel htmlFor={`${field}-updates`}>Check for updates at start</FieldLabel>
								<FieldDescription>One request to GitHub each time the app starts. It sends nothing about this {computerWord(s.platform)} or your pine.</FieldDescription>
							</FieldContent>
							<Switch id={`${field}-updates`} checked={s.prefs.updates} onCheckedChange={(updates) => void set({ updates })} />
						</Field>
					) : null}
					{s.updates && s.selfUpdate ? (
						<Field orientation="horizontal" data-find="auto-update">
							<FieldContent>
								<FieldLabel htmlFor={`${field}-auto-update`}>Update automatically</FieldLabel>
								<FieldDescription>A newer release is downloaded in the background and installed when you restart or quit Pine, never while you work. Off: the app links to the release page instead.</FieldDescription>
							</FieldContent>
							<Switch id={`${field}-auto-update`} checked={s.prefs.autoUpdate !== false} onCheckedChange={(autoUpdate) => void set({ autoUpdate })} />
						</Field>
					) : null}
					<Field orientation="horizontal" data-find="notifications">
						<FieldContent>
							<FieldLabel htmlFor={`${field}-notify`}>Notifications</FieldLabel>
							<FieldDescription>While the window is in the background: when an agent is done, stops with an error, needs your approval or asks you something. The text is pine's, never the agent's.</FieldDescription>
						</FieldContent>
						<Switch id={`${field}-notify`} checked={s.prefs.notify} onCheckedChange={(notify) => void set({ notify })} />
					</Field>
				</FieldGroup>
			</Section>
			<Section title="pine" about="The program behind the app that runs your agents.">
				{service?.olderThan ? (
					<Alert data-notice="older-pine">
						<TriangleAlertIcon />
						<AlertDescription>{`This pine is ${service.version}, older than the pine of this app (${service.olderThan}). The app did not start it, so it leaves it as it is: restart that pine on ${service.olderThan} (update it with "pine update" if it was installed separately), or stop it and the app starts the pine it came with.`}</AlertDescription>
					</Alert>
				) : null}
				<FieldGroup>
					<Field orientation="responsive" data-find="pine">
						<FieldContent className="min-w-0">
							<FieldTitle>
								{service ? `pine ${service.version ?? ""}` : "pine"}
								<Badge variant={s.connected ? "default" : "outline"}>{s.connected ? "connected" : "not connected"}</Badge>
							</FieldTitle>
							{overview ? <FieldDescription>{`Main agent: ${overview.main} · ${overview.sandbox ? "sandbox available" : "no sandbox on this system"}`}</FieldDescription> : null}
							<FieldDescription>{service?.host ? `The pine on ${service.host}, over SSH (see Environments). ${service.started ? "This app started it there; it stops when the app quits." : "It was already running there, and keeps running when this app quits."}` : service ? (service.started ? `Started by this app (${service.mode}), from ${service.from}. It stops when the app quits, unless the switch below is on.` : "Already running when the app started. It keeps running when this app quits.") : "Not running."}</FieldDescription>
						</FieldContent>
						{(service?.started && local) || (overview && !s.remote) ? (
							<Control>
								{overview && !s.remote ? <Button variant="outline" onClick={() => void bridge.reveal(overview.log)}><ExternalLinkIcon data-icon="inline-start" />Show log</Button> : null}
								{service?.started && local ? <Button variant="outline" onClick={() => void s.attempt(() => bridge.restart())}><RotateCwIcon data-icon="inline-start" />Restart</Button> : null}
							</Control>
						) : null}
					</Field>
					{local ? (
						<Field orientation="horizontal" data-find="keep-running">
							<FieldContent>
								<FieldLabel htmlFor={`${field}-keep-running`}>Keep pine running after the app quits</FieldLabel>
								<FieldDescription>Schedules, sources and Telegram keep working while the window is closed. Takes effect the next time the app starts pine.</FieldDescription>
							</FieldContent>
							<Switch id={`${field}-keep-running`} checked={s.prefs.keepRunning} onCheckedChange={(keepRunning) => void set({ keepRunning })} />
						</Field>
					) : null}
					{local && command === undefined ? <FieldSkeleton data-find="command" /> : null}
					{local && command && (command.state !== "unavailable" || command.why) ? (
						<Field orientation="responsive" data-find="command">
							<FieldContent>
								<FieldTitle>
									The pine command in a terminal
									{command.state === "here" ? <Badge>set up</Badge> : null}
								</FieldTitle>
								<FieldDescription>{command.text}</FieldDescription>
							</FieldContent>
							{(command.state === "none" || command.state === "here") && !command.managed ? (
								<Control>
									{command.state === "none" ? <Button variant="outline" onClick={() => void bridge.command("install").then(setCommand)}>Set up</Button> : <Button variant="outline" onClick={() => void bridge.command("remove").then(setCommand)}>Remove</Button>}
								</Control>
							) : null}
						</Field>
					) : null}
					{local && !s.browserChecked && !s.browserFetching ? <FieldSkeleton data-setting="browser" /> : null}
					{local && (s.browser !== undefined || s.browserFetching) ? (
						<Field orientation="responsive" data-setting="browser">
							<FieldContent>
								<FieldTitle>
									Browser for the web tools
									<Badge variant={s.browser ? "default" : "outline"}>{`${s.browser ? "on" : "not on"} this ${computerWord(s.platform)}`}</Badge>
								</FieldTitle>
								<FieldDescription>{s.browser ? "The browser your agents open web pages with." : "Each version of pine uses one browser build, and the one for this version is not here yet. It is about 600 MB, fetched once. Until then the browser tools do not work; web search and reading a page do."}</FieldDescription>
								{!s.browser && s.initLines.length ? (
									<CodeBlock size="sm">
										<CodeBlockContent wrap className="max-h-60 select-text">{s.initLines.slice(-12).join("\n")}</CodeBlockContent>
									</CodeBlock>
								) : null}
							</FieldContent>
							{s.browser ? null : (
								<Control>
									<Button variant="outline" disabled={s.browserFetching} onClick={() => void s.fetchBrowser()}>{s.browserFetching ? <><Pulse label="Loading" data-icon="inline-start" />Fetching…</> : "Fetch it"}</Button>
								</Control>
							)}
						</Field>
					) : null}
					{local ? (
						<Field orientation="responsive" data-find="home">
							<FieldContent className="min-w-0">
								<FieldTitle>Home folder</FieldTitle>
								<FieldDescription>
									<span className="block font-mono wrap-anywhere">{tilde((service?.host ? undefined : service?.home) ?? s.prefs.home ?? "~/.pine")}</span>
									Where pine keeps agents and settings on this computer. Another folder is another pine with agents of its own. Changing it restarts a pine this app started.
								</FieldDescription>
							</FieldContent>
							<Control>
								{s.prefs.home ? <Button variant="outline" onClick={() => void set({ home: "" }).then(() => !s.remote && bridge.retry())}>Use ~/.pine</Button> : null}
								<Button variant="outline" onClick={() => void bridge.pickFolder("A pine home folder").then((dir: string | undefined) => dir && set({ home: dir }).then(() => (s.remote ? undefined : service?.started ? bridge.restart() : bridge.retry())))}><FolderIcon data-icon="inline-start" />Choose…</Button>
							</Control>
						</Field>
					) : null}
				</FieldGroup>
			</Section>
		</>
	);
}

// ---- search -----------------------------------------------------------------------------------------

/** Where a thing found in Settings is: its page opens, and the page shows it (see Settings below). */
export function goTo(place: Place): void {
	store.settingsFind = place.find || place.filter ? { find: place.find, filter: place.filter } : undefined;
	store.openSettings(place.section, place.agent);
}

/**
 * Everything the search of Settings can find, for as long as `on`: the lists are asked for when the search
 * starts and again each time it starts anew, so that what was added since is found too.
 */
export function useSettingsIndex(on: boolean): Entry[] {
	const s = useModel(store);
	const [lists, setLists] = useState<Lists>({});
	useEffect(() => {
		if (!on) return;
		let live = true;
		const ask = <K extends keyof Lists>(key: K, p: Promise<Lists[K]>) => void p.then((v) => live && setLists((was) => ({ ...was, [key]: v })), () => undefined);
		ask("settings", api.settings());
		ask("providers", api.providers());
		ask("modelServers", api.modelServers());
		ask("mcp", api.mcp());
		ask("skills", api.skills());
		ask("sources", api.sources());
		ask("schedules", api.schedules());
		ask("routes", api.routes());
		return () => void (live = false);
	}, [on]);
	const access = offersAccess(s);
	return useMemo(
		() => entries({ local: s.local, updates: s.updates, selfUpdate: s.selfUpdate, access }, { ...lists, agents: s.agents, machines: s.prefs.hosts.map((host) => ({ host, name: s.nameOf(host) })) }),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[lists, s.agents, s.prefs.hosts, s.local, s.updates, s.selfUpdate, access],
	);
}

/** What fits the words, as a page of its own in place of the page that was open. */
function Found({ query, list, pick, back }: { query: string; list: Entry[]; pick: (e: Entry) => void; back: () => void }) {
	// Up and down go from one to the next; up from the first goes back to the field.
	const move = (e: React.KeyboardEvent<HTMLDivElement>) => {
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
		const all = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-result]")];
		const at = all.indexOf(document.activeElement as HTMLElement);
		e.preventDefault();
		if (e.key === "ArrowUp" && at <= 0) return back();
		all[Math.min(all.length - 1, e.key === "ArrowDown" ? at + 1 : at - 1)]?.focus();
	};
	return (
		<Page title={`“${query.trim()}”`} lead={list.length ? `${plural(list.length, "place")} in Settings. Pick one to go there.` : undefined}>
			{list.length ? (
				<ItemGroup data-slot="settings-results" onKeyDown={move}>
					{list.slice(0, 60).map((e) => (
						<SettingsItem
							key={e.id}
							data-result={e.id}
							render={<button type="button" />}
							onClick={() => pick(e)}
							title={e.title}
							description={[e.path.join(" › "), e.about].filter(Boolean).join(" · ")}
							descriptionClassName="truncate"
							actions={<ChevronRightIcon />}
						/>
					))}
				</ItemGroup>
			) : (
				<EmptyView icon={SearchIcon} title="Nothing in Settings fits">Try another word, or fewer of them. You can also ask the main agent: it knows every setting.</EmptyView>
			)}
		</Page>
	);
}

export function Settings() {
	const s = useModel(store);
	const sections = offeredSections(s);
	// A section chosen while it was offered (Browser access, before the app went to another machine's pine) opens General, which the navigation marks.
	// Pages that were folded into others open where they went: App into General, Instructions into Agents.
	const asked = s.section === "app" ? "general" : s.section === "instructions" ? "agents" : s.section;
	const section = sections.some((x) => x.id === asked) ? asked : "general";
	const [query, setQuery] = useState("");
	const searching = query.trim() !== "";
	const index = useSettingsIndex(searching);
	const found = searching ? search(index, query) : [];
	const hits = new Set(found.map((e) => e.place.section));
	const field = useRef<HTMLInputElement>(null);
	const root = useRef<HTMLDivElement>(null);
	// ⌘F (the menu's Find) looks in Settings while they are in front.
	useSignal("find", () => (field.current?.focus(), field.current?.select()));
	const pick = (e: Entry) => (setQuery(""), goTo(e.place));
	// What was picked is shown once its page has drawn it: scrolled to the middle and marked for a moment. A page
	// draws what it asked the daemon for a moment later, so it is looked for a few times; then the page stays at its top.
	const want = s.settingsFind;
	useEffect(() => {
		if (searching || !want) return;
		let tries = 0;
		let unmark: ReturnType<typeof setTimeout> | undefined;
		const look = setInterval(() => {
			const el = want.find ? root.current?.querySelector<HTMLElement>(`[data-slot=settings-page] ${want.find}`) : undefined;
			if (!el && ++tries < 30) return;
			clearInterval(look);
			if (store.settingsFind === want) store.settingsFind = undefined;
			if (!el) return;
			el.scrollIntoView({ block: "center" });
			el.setAttribute("data-found", "");
			unmark = setTimeout(() => el.removeAttribute("data-found"), 1600);
		}, 100);
		return () => (clearInterval(look), clearTimeout(unmark));
	}, [want, searching, section, s.settingsAgent]);
	const keys = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter" && found[0]) (e.preventDefault(), pick(found[0]));
		else if (e.key === "ArrowDown") (e.preventDefault(), root.current?.querySelector<HTMLElement>("[data-result]")?.focus());
		else if (e.key === "Escape" && query) (e.preventDefault(), e.stopPropagation(), setQuery(""));
	};
	// The sections are a column beside the page where there is room, and a row above it where there is not
	// (a narrow window, or a wide panel beside): measured on the settings themselves, not on the window.
	// An item's title wraps (its badges go under its name where the row is narrow): set once here for every row.
	// What the search picked is outlined for a moment (`data-found`).
	return (
		<div ref={root} className="@container/settings flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border bg-background **:data-[slot=item-title]:flex-wrap **:data-found:rounded-md **:data-found:outline-2 **:data-found:outline-offset-4 **:data-found:outline-ring">
			<div className="flex min-h-0 min-w-0 flex-1 flex-col @3xl/settings:flex-row">
				{/* A provider of its own, as in shadcn's sidebar in a dialog: the page needs one where no app side bar is around it (Storybook).
				    Its ⌘B listener changes nothing here (open is fixed and the side bar cannot collapse); the app's provider still gets the key. */}
				<SidebarProvider open className="min-h-0 w-full flex-none @3xl/settings:w-auto">
					<SidebarRoot collapsible="none" className="w-full border-b border-line-soft bg-transparent @3xl/settings:w-50 @3xl/settings:border-r @3xl/settings:border-b-0">
						<SidebarHeader className="px-2 pt-2 pb-0 @3xl/settings:pt-4">
							<InputGroup>
								<InputGroupAddon>
									<SearchIcon />
								</InputGroupAddon>
								<InputGroupInput ref={field} type="search" aria-label="Search Settings" placeholder="Search" data-slot="settings-search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={keys} />
							</InputGroup>
						</SidebarHeader>
						<SidebarContent>
							<ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade-x @3xl/settings:*:data-[slot=scroll-area-viewport]:scroll-fade">
								<SidebarGroup role="navigation" className="py-2">
									<SidebarGroupContent>
										<SidebarMenu className="flex-row @3xl/settings:flex-col">
											{sections.map((x) => (
												<SidebarMenuItem key={x.id} className="flex-none @3xl/settings:flex-initial">
													{/* While searching, a section with nothing that fits fades, as in the system's settings; a click on one ends the search. */}
													<SidebarMenuButton isActive={!searching && section === x.id} aria-current={!searching && section === x.id ? "page" : undefined} className={cn(searching && !hits.has(x.id) && "opacity-50")} onClick={() => (setQuery(""), (s.section = x.id), (s.settingsAgent = undefined), s.touch())}><x.icon />{x.label}</SidebarMenuButton>
												</SidebarMenuItem>
											))}
										</SidebarMenu>
									</SidebarGroupContent>
								</SidebarGroup>
							</ScrollArea>
						</SidebarContent>
					</SidebarRoot>
				</SidebarProvider>
				<ScrollArea className="flex min-h-0 min-w-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade" key={searching ? "search" : section}>
					{searching ? (
						<Found query={query} list={found} pick={pick} back={() => field.current?.focus()} />
					) : section === "agents" ? <Agents /> : section === "models" ? <Models /> : section === "mcp" ? <Mcp /> : section === "skills" ? <Skills /> : section === "events" ? <EventsPage /> : section === "environments" ? <Environments /> : section === "access" ? <Access /> : <General />}
				</ScrollArea>
			</div>
		</div>
	);
}
