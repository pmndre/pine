// Pairing a device with a computer from a link the owner holds (the mobile app's): the field a link
// is pasted into, and the owner's yes to a link before its code is used; and the computers found on
// this network, which pair without a code (ADR 0005). They take what they show
// as props, so that their stories need no bridge; the store is wired in by the parts that use them.
import { LaptopIcon, LinkIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { type NearbyComputer, type NearbyFound, OFFICIAL_SERVICE, otherService, type PairLink, shortId } from "./machines.ts";

/**
 * A field to paste a pairing link into, for a link that did not open the app. `onLink` reads it and
 * says why when it is not a pairing link; otherwise the owner is asked next, and the field empties.
 */
export function PairLinkField({ onLink }: { onLink: (text: string) => string | undefined }) {
	const [text, setText] = useState("");
	const [error, setError] = useState<string>();
	const id = useId();
	const go = () => {
		const why = onLink(text);
		setError(why);
		if (!why) setText("");
	};
	return (
		<Field data-slot="pair-link-field" data-invalid={error ? true : undefined}>
			<FieldLabel htmlFor={id}>Pairing link</FieldLabel>
			<InputGroup>
				<InputGroupInput id={id} className="font-mono" placeholder="https://…/#pair=…" autoComplete="off" autoCapitalize="off" spellCheck={false} aria-invalid={error ? true : undefined} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && go()} />
				<InputGroupAddon align="inline-end">
					<InputGroupButton variant="outline" disabled={!text.trim()} onClick={go}>
						<LinkIcon data-icon="inline-start" />
						Pair
					</InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
			{error ? <FieldError>{error}</FieldError> : <FieldDescription>If scanning the code did not open this app, copy the link shown beside the code in the Pine app and paste it here.</FieldDescription>}
		</Field>
	);
}

/**
 * The owner's yes to a pairing link, before its code reaches the computer: the code is for one use,
 * so nothing is sent before it. A service that is not the official one is named, since every
 * connection to that computer goes through it.
 */
export function PairConfirm({ link, device, onPair, onCancel }: { link: PairLink; device: "phone" | "browser"; onPair: () => void; onCancel: () => void }) {
	const other = otherService(link);
	return (
		<AlertDialog open onOpenChange={(open) => open || onCancel()}>
			<AlertDialogContent data-slot="pair-confirm">
				<AlertDialogHeader>
					<AlertDialogTitle>Pair with this computer?</AlertDialogTitle>
					<AlertDialogDescription>
						This {device} will ask the computer named in the link to let it in. The computer then shows four digits beside this {device}'s name. Press Allow there if they match the digits shown here.
					</AlertDialogDescription>
					{other ? (
						<AlertDialogDescription data-slot="pair-service">
							The computer is found through <span className="font-mono wrap-anywhere text-foreground">{other}</span>, which is not Pine's own service. All connections to that computer go through it. Pair only if the computer's owner set up that service.
						</AlertDialogDescription>
					) : null}
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<Button data-slot="pair-confirm-yes" onClick={onPair}>Pair</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

/**
 * The computers found on this network, live: each is "Pine" and the start of its machine id (its name
 * is told only once the connection is made), with the service it is found through when that is not
 * Pine's own. A tap asks it without a code. While none is found, a spinner and what the computer
 * needs; where the system refused the local network (iOS), how to allow it.
 */
export function NearbyComputers({ found, device, onPick }: { found: NearbyFound; device: "phone" | "browser"; onPick: (computer: NearbyComputer) => void }) {
	return (
		<FieldSet data-slot="pair-nearby">
			<FieldLegend variant="label">On this network</FieldLegend>
			{found.denied ? (
				<Alert data-slot="pair-nearby-denied">
					<TriangleAlertIcon />
					<AlertTitle>Pine cannot search this network</AlertTitle>
					<AlertDescription>To find your computer here, turn on Local Network in Settings &gt; Pine on this {device}. Or pair with the code below.</AlertDescription>
				</Alert>
			) : found.computers.length ? (
				<ItemGroup>
					{found.computers.map((c) => (
						<Item key={c.id} variant="outline" size="sm" data-slot="pair-nearby-computer" render={<button type="button" />} onClick={() => onPick(c)}>
							<ItemMedia variant="icon"><LaptopIcon /></ItemMedia>
							<ItemContent className="min-w-0 text-start">
								<ItemTitle>Pine <span className="font-mono text-muted-foreground">{shortId(c.id)}</span></ItemTitle>
								{c.service !== OFFICIAL_SERVICE ? <ItemDescription className="wrap-anywhere">Through {new URL(c.service).host}, not Pine's own service</ItemDescription> : null}
							</ItemContent>
						</Item>
					))}
				</ItemGroup>
			) : (
				<Empty data-slot="pair-nearby-empty" className="border">
					<EmptyHeader>
						<EmptyMedia><Spinner /></EmptyMedia>
						<EmptyDescription>No computer found on this network yet. Pine must be open there, with Browser access turned on.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			)}
		</FieldSet>
	);
}
