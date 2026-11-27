// An agent's instruction files (AGENTS.md, SOUL.md, TOOLS.md, MEMORY.md, and your rules for it), one tab each
// over an editor: the same part on the agent's page in Settings and in the side panel's Agent tab. With it, the
// tabs themselves (also for the files for all agents), their shape while they load, and the bar that keeps
// unsaved changes in sight.
import type { ReactNode } from "react";
import { useState } from "react";
import { Pulse } from "@/components/pulse";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AgentDetail } from "./api.ts";
import { Editor } from "./Editor.tsx";

export type AgentFileKey = keyof AgentDetail["files"];

/** The files of an agent, in the order of their tabs: which the owner changes here, and which only the agent or the owner's own hand does. */
export const AGENT_FILES: Array<{ key: "instructions" | "soul" | "tooling" | "memory" | "rules"; label: string; name: string; about: string; edit: boolean }> = [
	{ key: "instructions", label: "AGENTS.md", name: "AGENTS.md", about: "What the agent is for and how it works. The agent keeps this file up to date, and you can change it here.", edit: true },
	{ key: "soul", label: "SOUL.md", name: "SOUL.md", about: "The agent's character and tone.", edit: true },
	{ key: "tooling", label: "TOOLS.md", name: "TOOLS.md", about: "How this agent prefers to use tools, on top of the notes for all agents. May be empty.", edit: true },
	{ key: "memory", label: "MEMORY.md", name: "MEMORY.md", about: "Notes the agent keeps to remember things between conversations. Only the agent changes this file.", edit: false },
	{ key: "rules", label: "Your rules", name: "agents/<id>/AGENTS.md", about: "Your rules for this agent, which the agent reads and cannot change. Edit the file in pine's home.", edit: false },
];

/** The files whose text was changed here and not saved yet: only those that are changed here at all. */
export const changedFiles = (files: AgentDetail["files"], texts: Partial<Record<AgentFileKey, string>>) => AGENT_FILES.filter((f) => f.edit && texts[f.key] !== undefined && texts[f.key] !== (files[f.key] ?? ""));

/**
 * An agent's files, one tab each: what the file is for, and the file in an editor, read only where the owner
 * does not change it here. `texts` holds what was typed and not saved, which the page keeps: it knows what
 * else is unsaved, and saves all of it at once (`onSave`, also ⌘S in the editor).
 */
export function AgentFiles({ id, files, texts, onText, onSave }: { id: string; files: AgentDetail["files"]; texts: Partial<Record<AgentFileKey, string>>; onText: (key: AgentFileKey, text: string) => void; onSave: () => void }) {
	const [file, setFile] = useState<AgentFileKey>("instructions");
	return (
		// The agent's four files always have their tab, MEMORY.md also before the agent wrote one; your rules only when there are some.
		<FileTabs files={AGENT_FILES.filter((f) => f.key !== "rules" || files.rules !== undefined)} value={file} onChange={setFile}>
			{(key) => (
				<div className="flex h-72 overflow-hidden rounded-lg border">
					<Editor key={`${id}:${key}`} file={`${key}.md`} text={texts[key] ?? files[key] ?? ""} readOnly={!AGENT_FILES.find((f) => f.key === key)!.edit} onChange={(v) => onText(key, v)} onSave={onSave} />
				</div>
			)}
		</FileTabs>
	);
}

/** Files to read and change, one tab each: what the file is for, and the file in an editor. */
export function FileTabs<K extends string>({ files, value, onChange, children }: { files: Array<{ key: K; label: string; about?: string }>; value: K; onChange: (v: K) => void; children: (key: K) => ReactNode }) {
	return (
		<Tabs value={value} onValueChange={onChange}>
			<TabsList activateOnFocus className="gap-1">
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

/** A set of file tabs over an editor, on its first load. */
export function FilesSkeleton() {
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

/**
 * The bar that keeps a page's unsaved changes in sight at its foot, wherever the change was made: what is
 * changed, Discard and Save changes. It sticks over the page as it scrolls, so it has the page's own ground
 * and a shadow, and stays above what scrolls under it.
 */
export function UnsavedBar({ busy, discard, save, children }: { busy: boolean; discard: () => void; save: () => void; children: ReactNode }) {
	return (
		<Item variant="outline" size="sm" data-unsaved="" className="sticky bottom-4 z-10 bg-background shadow-lg">
			<ItemContent>
				<ItemTitle>{children}</ItemTitle>
			</ItemContent>
			<ItemActions>
				<Button variant="ghost" disabled={busy} onClick={discard}>Discard</Button>
				<Button disabled={busy} onClick={save}>{busy ? <><Pulse label="Saving" data-icon="inline-start" />Saving…</> : "Save changes"}</Button>
			</ItemActions>
		</Item>
	);
}
