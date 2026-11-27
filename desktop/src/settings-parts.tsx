// The parts every page of Settings is made of, so that all of them look alike: Settings.tsx and
// BrowserAccess.tsx draw their pages with these and stock components, and nothing else frames a page.
import { ChevronLeftIcon } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FieldContent, FieldDescription, FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field";

// One grid for every page: a header (a way back above the title, the title, one line on what the page is
// for, the page's buttons on the right), then its parts in a stock FieldGroup. A section is a stock FieldSet
// (its legend, a line, its buttons on the right, and what it holds), with a stock FieldSeparator between two
// sections that follow each other. What a section holds is one of three things, the same on every page:
// - settings: stock Fields in a FieldGroup, no frame. A row has its text on the left and its control on the
//   right, in one column of one width (CONTROL, inside Control); a wide control (a toggle group, an editor)
//   goes under its label.
// - a list of things: an ItemGroup of outline Items of size sm, each with its buttons (sm) on the right; the
//   button that adds one is in the section's header.
// - a note: a stock Alert.
// Every control and every button outside a list is the stock height (h-8); in a list `sm`, an icon alone
// `icon-sm`. Forms that add something open in a Dialog.
// A button's variant says what it does (docs/dev/desktop.md, "How the page is drawn"):
// - default (filled): the one action that finishes something (a dialog's submit, Save changes). At most one in view.
// - outline: everything that opens, adds, changes or shows something (New…, Add…, Connect…, Sign in, Change…).
// - ghost: taking something away or backing out (Remove on a row, which asks first; Sign out; Discard; the way back).
// - destructive: the last step of what cannot be undone (Remove… on an agent's page, a removal's confirmation).

export function Page({ title, lead, children, actions, back }: { title: ReactNode; lead?: ReactNode; children: ReactNode; actions?: ReactNode; back?: { label: string; onClick: () => void } }) {
	return (
		<div data-slot="settings-page" className="flex w-full max-w-3xl flex-col gap-8 px-4 pt-6 pb-16 text-sm select-text @lg/settings:px-9 @lg/settings:pt-8">
			<header className="flex flex-col gap-1">
				{back ? (
					<Button variant="ghost" size="sm" className="-ml-2.5 self-start" onClick={back.onClick}>
						<ChevronLeftIcon data-icon="inline-start" />
						{back.label}
					</Button>
				) : null}
				<div className="flex flex-wrap items-start gap-x-4 gap-y-3">
					<div className="flex min-w-0 grow basis-80 flex-col gap-1">
						<h1 data-slot="settings-title" className="text-xl font-semibold tracking-tight">{title}</h1>
						{lead ? <p className="max-w-2xl text-muted-foreground">{lead}</p> : null}
					</div>
					{actions ? <div className="flex flex-none items-center gap-2">{actions}</div> : null}
				</div>
			</header>
			<FieldGroup>{children}</FieldGroup>
		</div>
	);
}

/**
 * A part of a page: a stock FieldSet with its FieldLegend and FieldDescription, its buttons on the right, then
 * what it holds. A page puts a stock FieldSeparator between two sections that follow each other.
 */
export function Section({ title, about, actions, children, ...rest }: { title?: ReactNode; about?: ReactNode; actions?: ReactNode; children: ReactNode } & Omit<ComponentProps<"fieldset">, "title" | "about">) {
	const legend = useId();
	if (!actions)
		return (
			<FieldSet className="min-w-0" {...rest}>
				{title ? <FieldLegend>{title}</FieldLegend> : null}
				{about ? <FieldDescription>{about}</FieldDescription> : null}
				{children}
			</FieldSet>
		);
	// With buttons beside the title the legend is not the set's first child, so it names the set by its id.
	return (
		<FieldSet className="min-w-0" aria-labelledby={title ? legend : undefined} {...rest}>
			<div className="flex flex-wrap items-end gap-x-4 gap-y-2">
				<FieldContent className="min-w-0 grow basis-80">
					{title ? <FieldLegend id={legend}>{title}</FieldLegend> : null}
					{about ? <FieldDescription>{about}</FieldDescription> : null}
				</FieldContent>
				<div className="flex flex-none items-center gap-2">{actions}</div>
			</div>
			{children}
		</FieldSet>
	);
}

/** The width of a control in a row: one column for all of them, the whole row where it is narrow. */
export const CONTROL = "w-full @md/field-group:w-52";

/**
 * The width of a select's list: at least its control's, as wide as its longest option where there is room,
 * and never wider than the room. Stock draws the list as wide as the control, and a model's name
 * (`fireworks/accounts/<account>/routers/<model>`) is wider than a column, so it was cut in the list too and
 * could be read nowhere. An option that does not fit even so wraps (`Wrapped`).
 */
export const LIST = "w-auto min-w-(--anchor-width) max-w-(--available-width)";

/** An option's text that wraps where the list has no room for it, rather than being cut: stock keeps it on one line. */
export function Wrapped({ children }: { children: ReactNode }) {
	return <span className="min-w-0 whitespace-normal wrap-break-word">{children}</span>;
}

/** Where a row's control goes: right-aligned, with whatever buttons go with it. */
export function Control({ children }: { children: ReactNode }) {
	return <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>;
}

