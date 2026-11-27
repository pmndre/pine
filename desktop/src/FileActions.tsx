// What the owner does with files in the side panel's tree and in its search results: the context
// menu, the keys of the same actions, and cut, copy and paste. Every change goes through the daemon
// (`api.changeFiles`, which does it in a sandbox that writes in the folder alone); nothing here
// touches a file itself.

import { useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { contextMenu, type MenuEntry } from "@/components/page-menu";
import { api, type FileChange } from "./api.ts";
import { bridge } from "./bridge.ts";
import { store, type Tab } from "./model.ts";
import { macKeys, plural } from "./text.ts";

/** What "Show in …" is called on each system. */
export const SHOW_IN: Record<string, string> = { darwin: "Show in Finder", win32: "Show in Explorer", linux: "Show in Files" };

/** The shortcuts, the Mac's and everybody else's (as VS Code has them), written as `shortcut()` takes them. */
const KEYS: Record<string, [mac: string, other: string]> = {
	open: ["↩", "↩"],
	reveal: ["⌥⌘R", "⇧⌥R"],
	cut: ["⌘X", "⌘X"],
	copy: ["⌘C", "⌘C"],
	paste: ["⌘V", "⌘V"],
	path: ["⌥⌘C", "⇧⌥C"],
	relative: ["⌥⇧⌘C", "⌃⇧⌥C"],
	rename: ["F2", "F2"],
	delete: ["⌘⌫", "⌦"],
};
const keysOf = (id: string) => KEYS[id]?.[macKeys() ? 0 : 1];

/** Whether a key press is the shortcut written so: ⌘ is the Mac's Command and Ctrl elsewhere, a letter is the key it lies on. */
function pressed(e: KeyboardEvent, keys: string): boolean {
	const m = /^([⌃⌥⇧⌘]*)(.+)$/.exec(keys);
	if (!m) return false;
	const mac = macKeys();
	const want = { meta: mac && m[1].includes("⌘"), ctrl: m[1].includes("⌃") || (!mac && m[1].includes("⌘")), alt: m[1].includes("⌥"), shift: m[1].includes("⇧") };
	if (e.metaKey !== want.meta || e.ctrlKey !== want.ctrl || e.altKey !== want.alt || e.shiftKey !== want.shift) return false;
	// The key's place, not its letter: with ⌥ held a Mac types another letter.
	const code = /^[A-Z]$/.test(m[2]) ? `Key${m[2]}` : ({ "↩": "Enter", "⌫": "Backspace", "⌦": "Delete" } as Record<string, string>)[m[2]] ?? m[2];
	return e.code === code;
}

/**
 * An agent's own files at the top of its workspace (`WORKSPACE_FILES` in src/config.ts): edited and
 * copied, never deleted, moved or renamed here. The daemon keeps them too; this says so before asking it.
 */
const OWN = ["AGENTS.md", "SOUL.md", "TOOLS.md", "MEMORY.md"];

/** Files cut or copied, waiting to be pasted: one place for the whole page, and only into the folder they came from. */
let clip: { root: string; op: "copy" | "move"; paths: string[] } | undefined;

const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const nameOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** A name the owner typed for a file or a folder, checked: names joined by "/" where folders may be on the way, and nothing that climbs out. */
function checkName(typed: string, nested: boolean): string | undefined {
	const name = typed.trim().replace(/\/+$/, "");
	const parts = name.split("/");
	if (!name || name.startsWith("/") || name.includes("\0") || parts.some((x) => !x || x === "." || x === "..")) return void store.flash("That is not a valid file or folder name.", "bad");
	if (!nested && parts.length > 1) return void store.flash("A name cannot contain “/”. To move the item to another folder, cut it and paste it there.", "bad");
	return name;
}

export interface FileHost {
	tab: Tab;
	/** The conversation's folder, absolute; undefined while it is not known. */
	root?: string;
	isDir: (path: string) => boolean;
	open: (path: string) => void;
	selected: string[];
	select: (paths: string[]) => void;
	/** After a change: what was renamed or moved where (old → new), what is gone, a folder to open so that a new name shows. */
	changed: (moved: Array<[string, string]>, gone: string[], reveal?: string) => void;
}

/**
 * The actions on files for a list or a tree that shows them: `menu` for a right click (on a row, or on
 * the empty space, which is the folder's top), `keys` and the clipboard's events for its keys, and the
 * dialog that asks before deleting. A list that uses it gives each row `data-path`.
 */
export function useFileActions(host: FileHost) {
	const { tab, root, isDir, open, selected, select, changed } = host;
	const [deleting, setDeleting] = useState<string[]>();
	const local = !store.remote;
	const showIn = SHOW_IN[store.platform] ?? SHOW_IN.darwin;
	const abs = (p: string) => (p ? `${root}/${p}` : root!);
	// Only in the agent's workspace (no folder opened): elsewhere an AGENTS.md is the project's own.
	// The tree lists a name as it lies on disk, so it is compared as it is (the daemon decides by the file itself).
	const own = (p: string) => !tab.folder && OWN.includes(p);
	const keptSaid = (kept: string[], what: string) => kept.length && store.flash(`${kept.join(", ")} ${kept.length === 1 ? "stays" : "stay"} where ${kept.length === 1 ? "it is" : "they are"}. The agent's own files can be edited but not ${what}.`, "warn", 6000);
	/** Where a new name or a paste goes: into a folder, or beside a file; the top for nothing. */
	const dirFor = (paths: string[]) => (paths.length === 1 ? (isDir(paths[0]) ? paths[0] : parentOf(paths[0])) : "");
	const canPaste = (paths: string[]) => Boolean(clip && root && clip.root === root && paths.length <= 1);
	const change = async (c: FileChange) => {
		const done = await store.attempt(() => api.changeFiles(tab.agent, tab.session, c));
		tab.codeTick++;
		tab.touch();
		return done;
	};

	const entries = (paths: string[]): MenuEntry[] => {
		const one = paths.length === 1;
		const some = paths.length > 0;
		const movable = paths.filter((p) => !own(p)).length;
		const entry = (id: string, label: string, enabled: boolean, more: Partial<MenuEntry> = {}): MenuEntry => ({ id, label, enabled, keys: keysOf(id), ...more });
		const sep = (id: string): MenuEntry => ({ id, label: "", separator: true });
		return [
			...(some ? [entry("open", "Open", one && !isDir(paths[0]))] : []),
			// The system's file manager can only show what lies on this computer.
			...(local && root ? [entry("reveal", showIn, !some || one)] : []),
			sep("s1"),
			entry("new-file", "New File…", paths.length <= 1, { keys: undefined }),
			entry("new-folder", "New Folder…", paths.length <= 1, { keys: undefined }),
			sep("s2"),
			...(some ? [entry("cut", "Cut", movable > 0), entry("copy", "Copy", true)] : []),
			entry("paste", clip && clip.paths.length > 1 ? `Paste ${clip.paths.length} Items` : "Paste", canPaste(paths)),
			sep("s3"),
			entry("path", "Copy Path", Boolean(root)),
			...(some ? [entry("relative", "Copy Relative Path", true)] : []),
			...(some ? [sep("s4"), entry("rename", "Rename…", one && movable === 1), entry("delete", movable > 1 ? `Delete ${movable} Items` : "Delete", movable > 0, { danger: true })] : []),
		];
	};

	const toClipboard = async (text: string, said: string) => {
		try {
			await navigator.clipboard.writeText(text);
			store.flash(said);
		} catch {
			store.flash("Could not copy to the clipboard.", "bad");
		}
	};

	const run = async (id: string | undefined, paths: string[]) => {
		const dir = dirFor(paths);
		switch (id) {
			case "open":
				if (paths.length === 1 && !isDir(paths[0])) open(paths[0]);
				return;
			case "reveal":
				if (root) void bridge.reveal(abs(paths[0] ?? ""));
				return;
			case "new-file":
			case "new-folder": {
				const file = id === "new-file";
				const typed = await store.pick({ title: `New ${file ? "file" : "folder"} in ${dir || nameOf(root ?? "") || "the folder"}`, items: [], free: true, placeholder: file ? "A name, like notes.md or docs/notes.md" : "A name" });
				const name = typed && checkName(typed, true);
				if (!name) return;
				const done = await change({ op: file ? "file" : "folder", path: join(dir, name) });
				if (!done) return;
				changed([], [], parentOf(done.paths[0]));
				select(done.paths);
				if (file) open(done.paths[0]);
				return;
			}
			case "cut":
			case "copy": {
				// What is cut is moved, and an agent's own files are not: they are left out, with a word why.
				const kept = id === "cut" ? paths.filter(own) : [];
				const taken = paths.filter((p) => !kept.includes(p));
				if (!root || !taken.length) return void keptSaid(kept, "moved");
				clip = { root, op: id === "cut" ? "move" : "copy", paths: taken };
				store.flash(`${id === "cut" ? "Cut" : "Copied"} ${taken.length === 1 ? nameOf(taken[0]) : plural(taken.length, "item")}. Paste ${taken.length === 1 ? "it" : "them"} into a folder.`);
				keptSaid(kept, "moved");
				tab.touch();
				return;
			}
			case "paste": {
				if (!clip || !canPaste(paths)) return;
				const { op, paths: from } = clip;
				const done = await change({ op, paths: from, into: dir });
				if (!done) return;
				keptSaid(done.kept ?? [], "moved");
				// What was cut is pasted once; what was copied can be pasted again.
				if (op === "move") clip = undefined;
				changed(op === "move" ? from.map((p, i) => [p, done.paths[i]] as [string, string]) : [], [], dir);
				select(done.paths);
				return;
			}
			case "path":
				return void toClipboard((paths.length ? paths : [""]).map(abs).join("\n"), paths.length > 1 ? `Copied ${plural(paths.length, "path")}.` : "Copied the path.");
			case "relative":
				return void toClipboard(paths.join("\n"), paths.length > 1 ? `Copied ${plural(paths.length, "path")}.` : "Copied the path.");
			case "rename": {
				if (paths.length !== 1) return;
				if (own(paths[0])) return void store.flash(`${paths[0]} is the agent's own file. It can be edited but not renamed.`, "warn");
				const was = nameOf(paths[0]);
				const dot = was.lastIndexOf(".");
				const typed = await store.pick({ title: `Rename ${was}`, items: [], free: true, placeholder: "New name", initial: was, selected: dot > 0 && !isDir(paths[0]) ? dot : was.length });
				const name = typed && checkName(typed, false);
				if (!name || name === was) return;
				const done = await change({ op: "rename", path: paths[0], to: join(parentOf(paths[0]), name) });
				if (!done) return;
				changed([[paths[0], done.paths[0]]], [], undefined);
				select(done.paths);
				return;
			}
			case "delete": {
				// The rest of the selection is deleted; an agent's own files in it are kept, and the dialog says so.
				const taken = paths.filter((p) => !own(p));
				if (taken.length) setDeleting(taken);
				else keptSaid(paths, "deleted");
				return;
			}
		}
	};

	const remove = async (paths: string[]) => {
		setDeleting(undefined);
		const done = await change({ op: "delete", paths });
		if (!done) return;
		keptSaid([...skipped, ...(done.kept ?? [])], "deleted");
		if (clip) clip.paths = clip.paths.filter((p) => !paths.some((g) => p === g || p.startsWith(`${g}/`)));
		changed([], paths, undefined);
		select([]);
	};

	/** The menu for a right click: on a row, which joins the selection or replaces it; or beside the rows, for the folder's top. */
	const menu = async (e: MouseEvent) => {
		e.preventDefault();
		const at = (e.target as Element).closest("[data-path]")?.getAttribute("data-path") ?? undefined;
		let paths: string[] = [];
		if (at !== undefined) {
			paths = selected.includes(at) ? selected : [at];
			if (paths !== selected) select(paths);
		}
		await run(await contextMenu(entries(paths)), paths);
	};

	/** The shortcuts of the menu, while the list has the keyboard. Cut, copy and paste come as the clipboard's own events. */
	const keys = (e: KeyboardEvent) => {
		const id = ["reveal", "path", "relative", "rename", "delete"].find((k) => pressed(e, keysOf(k)!));
		if (!id || (id === "reveal" && !(local && root)) || (id === "rename" && selected.length !== 1) || (id === "delete" && !selected.length)) return;
		e.preventDefault();
		e.stopPropagation();
		void run(id, selected);
	};
	// The clipboard's events, which a Mac's Edit menu sends as well as the keys: the files are kept for a paste, their paths go on the clipboard.
	const onCopy = (e: ClipboardEvent) => {
		if (!selected.length || !root) return;
		e.preventDefault();
		e.clipboardData.setData("text/plain", selected.map(abs).join("\n"));
		void run("copy", selected);
	};
	const onCut = (e: ClipboardEvent) => {
		if (!selected.length || !root) return;
		e.preventDefault();
		e.clipboardData.setData("text/plain", selected.map(abs).join("\n"));
		void run("cut", selected);
	};
	const onPaste = (e: ClipboardEvent) => {
		if (!canPaste(selected)) return;
		e.preventDefault();
		void run("paste", selected);
	};

	const names = deleting?.map(nameOf) ?? [];
	// What of the selection is kept from the deletion: said in the dialog, and once more after it.
	const skipped = deleting ? selected.filter(own) : [];
	const dialog = (
		<AlertDialog open={Boolean(deleting)} onOpenChange={(now) => now || setDeleting(undefined)}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete {names.length === 1 ? names[0] : plural(names.length, "item")}?</AlertDialogTitle>
					<AlertDialogDescription>
						{names.length > 1 ? `${names.slice(0, 5).join(", ")}${names.length > 5 ? ` and ${names.length - 5} more` : ""}. ` : ""}
						{deleting?.some(isDir) ? "Deleting a folder deletes everything in it. " : ""}
						{names.length > 1 ? "They are" : "It is"} deleted permanently, not moved to the trash.
						{skipped.length ? ` ${skipped.join(", ")} ${skipped.length === 1 ? "is" : "are"} kept. The agent's own files can be edited but not deleted.` : ""}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction variant="destructive" onClick={() => deleting && void remove(deleting)}>Delete</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);

	/** Whether a row is cut and waits to be pasted: drawn faded, as editors draw it. */
	const isCut = (p: string) => Boolean(clip && clip.op === "move" && clip.root === root && clip.paths.includes(p));
	return { menu, keys, onCopy, onCut, onPaste, dialog, isCut, own };
}
