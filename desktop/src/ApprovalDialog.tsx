import { TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Printed } from "@/components/printed";
import type { Approval } from "./api.ts";
import { store } from "./model.ts";

/** A label that reads "name: what it is" or "NAME (what it is)" is its name and, under it, the rest. */
const labelParts = (label: string): [string, string] => {
	const m = label.match(/^([\w.-]+): ([\s\S]+)$/) ?? label.match(/^([\w.-]+) \(([\s\S]+)\)$/);
	return m ? [m[1], m[2]] : [label, ""];
};

/** A request for the owner's approval. Values only the owner has are typed here and go straight to the daemon. */
export function ApprovalDialog({ req }: { req: Approval }) {
	const s = store;
	const fields = req.inputs ?? [];
	const [values, setValues] = useState<Record<string, string>>({});
	// The first value asked for, where there is one; past what is to be approved, which comes first.
	const first = useRef<HTMLInputElement>(null);
	const allow = (always = false) => {
		if (fields.length) {
			const empty = fields.find((f) => !values[f.name]?.trim());
			if (empty) return void document.getElementById(`ap-${empty.name}`)?.focus();
			return void s.decide(req.id, true, false, Object.fromEntries(fields.map((f) => [f.name, values[f.name].trim()])));
		}
		void s.decide(req.id, true, always);
	};
	useEffect(() => {
		if (fields.length) return;
		// Letters answer while nothing is to be typed, as in the terminal UI.
		const key = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (e.key === "a" || e.key === "y") allow();
			else if (e.key === "s" && req.remember) allow(true);
			else if (e.key === "d" || e.key === "n") void s.decide(req.id, false);
			else return;
			e.preventDefault();
		};
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [req.id]);
	return (
		<Dialog open onOpenChange={(open) => open || s.closeAsking()}>
			<DialogContent data-tone="warn" showCloseButton={false} initialFocus={fields.length ? first : true} className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2"><TriangleAlertIcon className="text-warn" /> {fields.length ? "Approval needed, and something only you have" : "Approval needed"}</DialogTitle>
				</DialogHeader>
				<ScrollArea className="-mx-4 max-h-(--dialog-scroll) min-w-0 wrap-break-word flex min-h-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade">
				<div className="flex flex-col gap-3 px-4 select-text">
					<div className="flex items-center gap-2 text-muted-foreground">
						<span>{req.agent}</span>
						{req.task ? <span className="text-faint">task #{req.task}</span> : null}
						<Badge variant="secondary" className="font-mono">{req.tool}</Badge>
					</div>
					<Printed sm text={req.summary} />
					<div className="text-xs text-muted-foreground">
						Why you are asked: {req.why}
						{req.holds ? <div>“Allow” holds for {req.holds}: you are not asked about it again there.</div> : null}
						{req.remember ? <div>“Always here” stops asking about {req.remember} in this conversation.</div> : null}
						{!req.remember && !req.holds && !fields.length ? <div>This one is asked every time: there is no “always” for it.</div> : null}
					</div>
					{fields.map((f, i) => {
						const [name, about] = labelParts(f.label ?? f.name);
						return (
							<Field key={f.name}>
								<FieldLabel htmlFor={`ap-${f.name}`}>{name}{fields.length > 1 ? <span className="text-faint"> · {i + 1} of {fields.length}</span> : null}</FieldLabel>
								{about ? <FieldDescription>{about}</FieldDescription> : null}
								<Input id={`ap-${f.name}`} ref={i === 0 ? first : undefined} className="font-mono" type={f.secret !== false ? "password" : "text"} autoComplete="off" spellCheck={false} value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} onKeyDown={(e) => e.key === "Enter" && allow()} />
							</Field>
						);
					})}
					{fields.length ? <FieldDescription>{fields.some((f) => f.secret !== false) ? "What you type is not shown, goes into pine's .env file, and never reaches the agent or its model." : "Without it, this cannot be allowed."}</FieldDescription> : null}
				</div>
				</ScrollArea>
				<DialogFooter>
					<Button variant="ghost" onClick={() => s.closeAsking()}>Later <Kbd>esc</Kbd></Button>
					<span className="min-w-0 flex-1" />
					<Button variant="destructive" onClick={() => void s.decide(req.id, false)}>Deny{fields.length ? "" : <Kbd>d</Kbd>}</Button>
					{req.remember && !fields.length ? <Button variant="outline" onClick={() => allow(true)}>Always here <Kbd>s</Kbd></Button> : null}
					<Button onClick={() => allow()}>{fields.length ? "Save and allow" : req.holds ? "Allow" : "Allow once"}{fields.length ? "" : <Kbd>a</Kbd>}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
