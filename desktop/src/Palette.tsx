import { useMemo, useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { COMMANDS } from "./commands.ts";
import { computerWord } from "./machines.ts";
import { useNamedLine } from "./lists.tsx";
import { store, useModel } from "./model.ts";
import { ago, fuzzy, shortcut } from "./text.ts";
import { goTo, useSettingsIndex } from "./Settings.tsx";
import { search } from "./settings-index.ts";
import { Skeleton } from "@/components/ui/skeleton";

export function Palette() {
	const s = store;
	const [query, setQuery] = useState("");
	const line = useNamedLine(query);
	useModel(s);
	// What Settings has, found by the same search as in Settings: asked for once the palette opens.
	const index = useSettingsIndex(true);
	type Row = { id: string; group: string; label: string; about?: string; keys?: string; run: () => void; conv?: { agent: string; session: string } };
	const all = useMemo(() => {
		const chat = s.active?.kind === "chat";
		const rows: Row[] = [];
		for (const t of s.tabs) rows.push({ id: `t:${t.id}`, group: "Open tabs", label: t.kind === "chat" ? `${t.agent} · ${s.titleOf(t.agent, t.session)}` : t.kind === "task" ? `${t.agent} task #${t.task}` : t.kind === "settings" ? "Settings" : "Events", run: () => s.activate(t), conv: t.kind === "chat" ? { agent: t.agent, session: t.session } : undefined });
		for (const [agent, convs] of s.conversations) for (const c of convs) if (!s.tabs.some((t) => t.kind === "chat" && t.agent === agent && t.session === c.session)) rows.push({ id: `s:${agent}:${c.session}`, group: "Conversations", label: `${agent} · ${s.titleOf(agent, c.session)}`, about: `${ago(c.last)}${c.folder ? ` · ${c.folder}` : ""}`, run: () => void s.openTab(agent, c.session), conv: { agent, session: c.session } });
		for (const c of COMMANDS) if (!c.chat || chat) rows.push({ id: `c:${c.name}`, group: "Commands", label: c.title, about: c.about, keys: c.keys, run: () => void c.run("", s.active) });
		for (const a of s.agents) rows.push({ id: `a:${a.id}`, group: "Agents", label: `New conversation with ${a.id}`, about: a.description, run: () => void s.newConversation(a.id) });
		for (const [id, label] of [["general", "General"], ["agents", "Agents"], ["models", "Models"], ["mcp", "MCP servers"], ["skills", "Skills"], ["events", "Events"], ["environments", "Environments"]]) rows.push({ id: `p:${id}`, group: "Settings", label: `Settings: ${label}`, run: () => void s.command(`settings:${id}`) });
		// The machines whose pine the app can use (Settings > Environments), but the one it uses; this computer only where there is one.
		for (const host of [...(s.local ? [undefined] : []), ...s.prefs.hosts]) if (host !== s.service.host) rows.push({ id: `e:${host ?? ""}`, group: "Environments", label: `Use the pine on ${host ? s.nameOf(host) : `this ${computerWord(s.platform)}`}`, run: () => void s.useMachine(host) });
		return rows;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [s.titles, s.titled, [...s.conversations.values()].reduce((n, c) => n + c.length, s.conversations.size)]);
	// Until every agent's conversations and what was said are in, a query that fits nothing may yet fit one of them.
	const loading = !s.titled || s.agents.some((a) => !s.conversations.has(a.id));
	// What fits by its name comes first; then the conversations in which the words were said; then
	// what only fits by its description, and last what fits by letters in order.
	const shown = useMemo(() => {
		if (!query.trim()) return all;
		const q = query.trim().toLowerCase();
		const named: Row[] = [];
		const described: Row[] = [];
		const loose: Row[] = [];
		for (const r of all) {
			if (r.label.toLowerCase().includes(q)) named.push(r);
			else if ((r.about ?? "").toLowerCase().includes(q)) described.push(r);
			else if (fuzzy(q, r.label) >= 0) loose.push(r);
		}
		// A conversation is listed once. One that fits by its name and also holds the words opens at the words.
		const found = s.searchSaid(q);
		const holds = (r: Row) => (r.conv ? found.find((m) => m.agent === r.conv!.agent && m.session === r.conv!.session) : undefined);
		const listed = new Set<string>();
		const here = (r: Row): Row => {
			const m = holds(r);
			if (!m) return r;
			listed.add(`${m.agent}:${m.session}`);
			return { ...r, about: `${m.who}: ${m.snippet}`, keys: ago(m.ts), run: () => void s.openFound(m.agent, m.session, query.trim()) };
		};
		const byName = named.map(here);
		const settings: Row[] = search(index, q).slice(0, 8).map((e) => ({ id: `f:${e.id}`, group: "In Settings", label: e.title, about: e.path.join(" › "), run: () => goTo(e.place) }));
		const said: Row[] = found.filter((m) => !listed.has(`${m.agent}:${m.session}`)).map((m) => ({ id: `m:${m.agent}:${m.session}`, group: "Said in conversations", label: `${m.agent} · ${s.titleOf(m.agent, m.session)}`, about: `${m.who}: ${m.snippet}`, keys: ago(m.ts), run: () => void s.openFound(m.agent, m.session, query.trim()) }));
		return [...byName, ...settings, ...said, ...described.filter((r) => !holds(r) || !listed.has(`${r.conv!.agent}:${r.conv!.session}`)), ...loose.filter((r) => !r.conv || !listed.has(`${r.conv.agent}:${r.conv.session}`))].slice(0, 80);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [query, all, s.said, index]);
	// Rows that follow each other under the same heading are one group.
	const groups: Array<{ name: string; rows: Row[] }> = [];
	for (const r of shown) groups.at(-1)?.name === r.group ? groups.at(-1)!.rows.push(r) : groups.push({ name: r.group, rows: [r] });
	const close = () => ((s.palette = false), s.touch());
	const run = (r: Row) => (close(), r.run());
	return (
		<Dialog open onOpenChange={(open) => open || close()}>
			<DialogContent showCloseButton={false} className="gap-0 p-0 sm:max-w-xl">
				<DialogTitle className="sr-only">Search everything</DialogTitle>
				<Command {...line} shouldFilter={false} loop>
					<CommandInput placeholder="Search conversations (by name or by what was said), commands, agents" value={query} onValueChange={setQuery} />
					<CommandList className="scroll-fade">
						{groups.map((g, n) => (
							<CommandGroup key={`${n}:${g.name}`} heading={g.name}>
								{g.rows.map((r) => (
									<CommandItem key={r.id} value={r.id} onSelect={() => run(r)}>
										<span className="max-w-3/5 flex-none truncate">{r.conv && !s.titleKnown(r.conv.agent, r.conv.session) ? <>{r.conv.agent} · <Skeleton className="inline-block h-3 w-24 align-middle" /></> : r.label}</span>
										{r.about ? <span className="min-w-0 truncate text-xs text-muted-foreground">{r.about}</span> : null}
										{r.keys ? <CommandShortcut>{shortcut(r.keys)}</CommandShortcut> : null}
									</CommandItem>
								))}
							</CommandGroup>
						))}
						{loading ? (
							shown.length ? null : (
								<div aria-busy="true" aria-label="Loading conversations" className="flex flex-col gap-1 p-1">
									{["w-1/2", "w-2/3", "w-2/5"].map((w) => <div key={w} className="flex h-8 items-center px-2"><Skeleton className={`h-4 ${w}`} /></div>)}
								</div>
							)
						) : (
							<CommandEmpty>Nothing fits.</CommandEmpty>
						)}
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
