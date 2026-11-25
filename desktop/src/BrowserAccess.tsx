// Settings > Browser access: the owner's side of reaching this computer's pine from a browser. The
// switch, whether this computer is visible on the network, whether the app waits at the meeting
// service, "Add a device" (whose dialog and the question when a device asks are DevicePairing.tsx's,
// shown anywhere in the app), and the paired devices. The state is the main process's
// (electron/access/control.ts), read through the bridge and told again each time it changes.
import { LaptopIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useInterval } from "usehooks-ts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { EmptyView } from "@/components/empty-view";
import { useAccessState } from "./access-state.ts";
import { type AccessChange, type AccessDevice, type AccessState, bridge } from "./bridge.ts";
import { computerWord } from "./machines.ts";
import { store } from "./model.ts";
import { Section } from "./settings-parts.tsx";
import { ago, errText } from "./text.ts";

/** What the section does: each a call of the bridge in the app, a stand-in in a story. */
export interface AccessActions {
	set(change: AccessChange): Promise<void>;
	/** Opens a pairing; the Add a device dialog shows it. */
	add(): void;
	remove(id: string): void;
}

const STATUS = {
	off: { text: "off", variant: "secondary" },
	waiting: { text: "waiting", variant: "default" },
	unreachable: { text: "cannot reach the service", variant: "outline" },
} as const;

/** How a device is connected, in the owner's words. */
const PATH = { lan: "same network", ipv4: "direct, IPv4", ipv6: "direct, IPv6", relay: "relayed" } as const;

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

/** What a device row says under its name: the day it was paired, and its last connection or how it is connected now. */
function deviceLine(d: AccessDevice, now: number): string {
	const paired = `Paired ${day(d.paired)}`;
	if (d.connected) return d.connected.path ? `${paired} · ${PATH[d.connected.path]}` : paired;
	return d.seen ? `${paired} · last connected ${ago(Date.parse(d.seen), now)}` : `${paired} · never connected`;
}

/**
 * The section as it is drawn from a state: the page's own state stays in the dialogs (the address
 * being written, the checkbox of the first turn on). `now` is the clock the time left is counted on.
 * `platform` names this computer: "This Mac" on macOS, "This computer" elsewhere.
 */
export function BrowserAccessView({ state, now, platform, actions }: { state: AccessState; now: number; platform: string; actions: AccessActions }) {
	const computer = computerWord(platform);
	const field = useId();
	const [service, setService] = useState(state.service);
	const [serviceError, setServiceError] = useState<string>();
	const [turningOn, setTurningOn] = useState(false);
	const [login, setLogin] = useState(true);
	const [error, setError] = useState<string>();
	useEffect(() => setService(state.service), [state.service]);
	// The relay's fields: the address and user name as kept; the password field always starts empty, and says when one is kept.
	const [relay, setRelay] = useState({ address: state.relay?.address ?? "", username: state.relay?.username ?? "", password: "" });
	const [relayError, setRelayError] = useState<string>();
	useEffect(() => setRelay({ address: state.relay?.address ?? "", username: state.relay?.username ?? "", password: "" }), [state.relay?.address, state.relay?.username]);
	const relayMoved = relay.address.trim() !== (state.relay?.address ?? "") || relay.username.trim() !== (state.relay?.username ?? "");
	const relayChanged = relayMoved || relay.password !== "";
	// A kept password belongs to the relay it was given for: saved with another address or user name, it is forgotten.
	const passwordHint = !state.relay?.password ? "" : relayMoved && relay.address.trim() ? "Not kept for another address or user name: enter the password again" : "Kept. Write a new one to change it";
	const saveRelay = async () => {
		setRelayError(undefined);
		try {
			await actions.set({ relay });
			setRelay((r) => ({ ...r, password: "" }));
		} catch (e) {
			setRelayError(errText(e));
		}
	};
	const check = state.relay?.check;

	const status = STATUS[state.status];
	/** A change from a switch or a dialog; what went wrong is said under the switch. */
	const change = (what: AccessChange) => void actions.set(what).then(() => setError(undefined), (e: unknown) => setError(errText(e)));
	// "Open Pine at login" is offered when access is turned on the first time: no device yet, and the app not opened at login.
	const first = state.devices.length === 0 && !state.openAtLogin;
	const turn = (on: boolean) => (on && first ? (setLogin(true), setTurningOn(true)) : change({ enabled: on }));
	const saveService = async () => {
		setServiceError(undefined);
		try {
			await actions.set({ service });
		} catch (e) {
			setServiceError(errText(e));
		}
	};

	return (
		<>
			<Section title={`This ${computer}`} data-find="access-computer">
				<FieldGroup>
					<Field orientation="horizontal" data-setting="access">
						<FieldContent>
							<FieldLabel htmlFor={`${field}-on`}>
								Browser access
								<Badge data-slot="access-status" variant={status.variant}>{status.text}</Badge>
							</FieldLabel>
							<FieldDescription>
								{state.status === "unreachable"
									? `The app cannot reach the service where browsers find this ${computer}. It tries again by itself; the rest of the app works as before.`
									: "A browser you paired opens your conversations from anywhere, peer to peer. Turned off, the app contacts no service and lets nobody in; your devices are kept."}
							</FieldDescription>
						</FieldContent>
						<Switch id={`${field}-on`} data-slot="access-switch" checked={state.enabled} disabled={state.problem?.kind === "keychain"} onCheckedChange={turn} />
					</Field>
					<Field orientation="horizontal" data-setting="access-visible" data-disabled={state.enabled ? undefined : true}>
						<FieldContent>
							<FieldLabel htmlFor={`${field}-visible`}>Visible on this network</FieldLabel>
							<FieldDescription>
								{state.paused
									? `Paused until ${new Date(state.paused).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} after 3 refusals. Turn it on to end the pause now.`
									: `The Pine app on a phone on this network finds this ${computer} and can ask to connect without a code. You still allow it here, after comparing four digits. Off: pair with the code of Add a device.`}
							</FieldDescription>
						</FieldContent>
						<Switch id={`${field}-visible`} data-slot="access-visible" checked={state.visible && !state.paused} disabled={!state.enabled} onCheckedChange={(visible) => change({ visible })} />
					</Field>
					{state.problem || error ? (
						<Alert variant="destructive" data-slot="access-problem">
							<TriangleAlertIcon />
							<AlertDescription>{error ?? state.problem?.message}</AlertDescription>
						</Alert>
					) : null}
					<Field orientation="horizontal" data-setting="access-login">
						<FieldContent>
							<FieldLabel htmlFor={`${field}-login`}>Open Pine at login</FieldLabel>
							<FieldDescription>So that this {computer} can be reached after a restart without your opening the app.</FieldDescription>
						</FieldContent>
						<Switch id={`${field}-login`} data-slot="access-login" checked={state.openAtLogin} onCheckedChange={(openAtLogin) => change({ openAtLogin })} />
					</Field>
					<Field data-setting="access-service" data-invalid={serviceError ? true : undefined}>
						<FieldLabel htmlFor={`${field}-service`}>Service address</FieldLabel>
						<div className="flex items-center gap-2">
							<Input id={`${field}-service`} className="font-mono" placeholder="https://" value={service} aria-invalid={serviceError ? true : undefined} onChange={(e) => setService(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void saveService()} />
							<Button variant="outline" disabled={service.trim() === state.service} onClick={() => void saveService()}>Save</Button>
						</div>
						<FieldDescription>Where browsers open the web client and find this {computer}. Changing it makes the paired browsers that use the old address pair again.</FieldDescription>
						{serviceError ? <FieldError>{serviceError}</FieldError> : null}
					</Field>
				</FieldGroup>
			</Section>

			<Section title="Devices" data-find="access-devices" actions={<Button variant="outline" disabled={state.status === "off"} onClick={actions.add}><PlusIcon data-icon="inline-start" />Add a device</Button>}>
				{state.devices.length ? (
					<ItemGroup>
						{state.devices.map((d) => (
							<Item key={d.id} variant="outline" size="sm" data-slot="access-device">
								<ItemMedia variant="icon"><LaptopIcon /></ItemMedia>
								<ItemContent className="min-w-0">
									{/* `flex` again after `line-clamp-none`, which sets `display: block`: the badge keeps its gap, and goes under a long name. */}
									<ItemTitle className="line-clamp-none flex w-full min-w-0 flex-wrap">
										<span className="min-w-0 wrap-anywhere">{d.name}</span>
										{d.connected ? <Badge>connected now</Badge> : null}
									</ItemTitle>
									<ItemDescription className="line-clamp-none">{deviceLine(d, now)}</ItemDescription>
								</ItemContent>
								<ItemActions>
									<AlertDialog>
										<AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>Remove</AlertDialogTrigger>
										<AlertDialogContent>
											<AlertDialogHeader>
												<AlertDialogTitle className="wrap-anywhere">Remove {d.name}?</AlertDialogTitle>
												<AlertDialogDescription>The device is disconnected now, and can only connect again if you add it again.</AlertDialogDescription>
											</AlertDialogHeader>
											<AlertDialogFooter>
												<AlertDialogCancel>Cancel</AlertDialogCancel>
												<AlertDialogCancel variant="destructive" onClick={() => actions.remove(d.id)}>Remove</AlertDialogCancel>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog>
								</ItemActions>
							</Item>
						))}
					</ItemGroup>
				) : (
					<EmptyView icon={LaptopIcon} title="No device is paired">Add one by scanning a code with the device's camera, or with a link you open in the device's browser.</EmptyView>
				)}
			</Section>

			{/* A set of its own: inside the group of This Mac, its fields were drawn with no height once the try's line appeared. */}
			<Section title="Relay server (TURN)" about="Used when no direct connection can be made, for example from some mobile networks. Leave it empty if you have none." data-setting="access-relay" data-invalid={relayError ? true : undefined}>
				<FieldGroup>
					<Field>
						<FieldLabel htmlFor={`${field}-relay`}>Address</FieldLabel>
						<Input id={`${field}-relay`} data-slot="relay-address" className="font-mono" placeholder="turn:relay.example.com:3478" autoComplete="off" spellCheck={false} value={relay.address} aria-invalid={relayError ? true : undefined} onChange={(e) => setRelay({ ...relay, address: e.target.value })} />
					</Field>
					<Field>
						<FieldLabel htmlFor={`${field}-relay-user`}>User name</FieldLabel>
						<Input id={`${field}-relay-user`} data-slot="relay-username" autoComplete="off" spellCheck={false} value={relay.username} onChange={(e) => setRelay({ ...relay, username: e.target.value })} />
					</Field>
					<Field>
						<FieldLabel htmlFor={`${field}-relay-password`}>Password</FieldLabel>
						<Input id={`${field}-relay-password`} data-slot="relay-password" type="password" autoComplete="new-password" placeholder={passwordHint} value={relay.password} onChange={(e) => setRelay({ ...relay, password: e.target.value })} onKeyDown={(e) => e.key === "Enter" && relayChanged && void saveRelay()} />
					</Field>
					<div>
						<Button variant="outline" disabled={!relayChanged} onClick={() => void saveRelay()}>Save</Button>
					</div>
					{relayError ? <FieldError>{relayError}</FieldError> : check ? <FieldDescription data-slot="relay-check" data-result={check.result} className="data-[result=failed]:text-destructive">{check.message}</FieldDescription> : null}
				</FieldGroup>
			</Section>

			{/* Turned on the first time: open at login is offered, checked. */}
			<AlertDialog open={turningOn} onOpenChange={setTurningOn}>
				<AlertDialogContent>
					<div data-slot="access-turn-on" className="contents">
						<AlertDialogHeader>
							<AlertDialogTitle>Turn on browser access?</AlertDialogTitle>
							<AlertDialogDescription>This {computer} waits at the service for the browsers you pair. It can be reached while Pine is open.</AlertDialogDescription>
						</AlertDialogHeader>
						<Field orientation="horizontal">
							<Checkbox id={`${field}-login-first`} checked={login} onCheckedChange={setLogin} />
							<FieldLabel htmlFor={`${field}-login-first`}>Open Pine at login</FieldLabel>
						</Field>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogCancel variant="default" onClick={() => change({ enabled: true, openAtLogin: login })}>Turn on</AlertDialogCancel>
						</AlertDialogFooter>
					</div>
				</AlertDialogContent>
			</AlertDialog>

		</>
	);
}

/** The section while its state loads: its three sections, each a title and the shape of its rows, from stock Skeleton blocks. */
export function BrowserAccessSkeleton() {
	return (
		<>
			{[3, 1, 3].map((rows, i) => (
				<section key={i} data-slot="access-skeleton" className="flex flex-col gap-3">
					<Skeleton className="h-5 w-40" />
					{Array.from({ length: rows }, (_, r) => (
						<div key={r} className="flex items-center gap-4">
							<div className="flex flex-1 flex-col gap-1.5">
								<Skeleton className="h-4 w-1/3" />
								<Skeleton className="h-4 w-2/3" />
							</div>
							<Skeleton className="h-5 w-9 rounded-full" />
						</div>
					))}
				</section>
			))}
		</>
	);
}

/** The state could not be read: what went wrong, where the section would be. */
export function BrowserAccessFailed({ error }: { error: string }) {
	return (
		<Alert variant="destructive" data-slot="access-load-error">
			<TriangleAlertIcon />
			<AlertDescription>Browser access could not be read: {error}</AlertDescription>
		</Alert>
	);
}

/** The section in the app: the state from the bridge, told again on every change; the calls made through it. */
export function BrowserAccess() {
	const [loadError, setLoadError] = useState<string>();
	const [state, answered] = useAccessState({ failed: (e) => setLoadError(errText(e)) });
	const [now, setNow] = useState(Date.now);
	useInterval(() => setNow(Date.now()), state?.devices.length ? 1000 : null);

	if (!state) return loadError ? <BrowserAccessFailed error={loadError} /> : <BrowserAccessSkeleton />;
	const actions: AccessActions = {
		async set(change) {
			await answered(bridge.setAccess!(change));
		},
		add: () => void store.addDevice(),
		remove: (id) => void store.attempt(() => bridge.removeDevice!(id)),
	};
	return <BrowserAccessView state={state} now={now} platform={store.platform} actions={actions} />;
}
