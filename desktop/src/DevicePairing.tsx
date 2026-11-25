// Adding a device, from anywhere in the app (ADR 0004, 0005): the Add a device dialog with the QR code of
// a pairing link, opened from Settings > Browser access, the menu, the Dock or `pine://pair`; the
// question when a device asks, as a toast that never takes the keyboard (an Enter typed in the
// composer must not answer it); and the toast that says visibility was paused after refusals. They
// are mounted beside the app, not in Settings, so that they show wherever the owner is. The state is
// the main process's (electron/access/control.ts); only the desktop app's bridge has it.
import { CopyIcon, MonitorSmartphoneIcon, RotateCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useInterval } from "usehooks-ts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createToastManager, Toast, ToastContent, ToastDescription, ToastPortal, ToastProvider, ToastTitle, ToastViewport, toast, useToastManager } from "@/components/ui/toast";
import { QrCode } from "@/components/qr-code";
import { useAccessState } from "./access-state.ts";
import { type AccessState, bridge } from "./bridge.ts";
import { computerWord } from "./machines.ts";
import { store, useModel } from "./model.ts";
import { errText } from "./text.ts";

/** The pairing the dialog shows: the link and when it stops working, and whether a device has asked with it. */
export interface Opened {
	link: string;
	expires: string;
	asked?: boolean;
}

/** What a device asking looks like: its name, as plain text, and the four digits its screen shows. */
export type Request = NonNullable<AccessState["request"]>;

/** Minutes and seconds left, as a clock: 1:58. */
const left = (ms: number) => {
	const s = Math.max(0, Math.ceil(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Whether the dialog's code no longer works: its time is over, or the device that used it went away without an answer. */
export const isStale = (opened: Opened, state: AccessState | undefined, now: number) => now >= Date.parse(opened.expires) || Boolean(opened.asked && !state?.request && state?.pairing?.link !== opened.link);

/** Add a device: the QR code of the pairing link while it works, and a new one once it does not. Closing it cancels the pairing. */
export function AddDeviceDialog({ opened, stale, now, onClose, onNew, onCopy }: { opened?: Opened; stale: boolean; now: number; onClose: () => void; onNew: () => void; onCopy: () => void }) {
	return (
		<Dialog open={Boolean(opened)} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-sm">
				<div data-slot="pairing-dialog" className="contents">
					<DialogHeader>
						<DialogTitle>Add a device</DialogTitle>
						<DialogDescription>{stale ? "This code no longer works: it was used, or the two minutes are over." : "Scan the code with the device's camera, or send yourself the link and open it in the device's browser."}</DialogDescription>
					</DialogHeader>
					{opened && !stale ? (
						<>
							<QrCode value={opened.link} label="QR code of the pairing link" className="mx-auto w-full max-w-56 rounded-lg" />
							<p className="text-center text-sm text-muted-foreground">Works once, for <span data-slot="pairing-time" className="font-mono tabular-nums">{left(Date.parse(opened.expires) - now)}</span> more.</p>
						</>
					) : null}
					<DialogFooter>
						{opened && !stale ? <Button variant="outline" onClick={onCopy}><CopyIcon data-icon="inline-start" />Copy link</Button> : <Button onClick={onNew}><RotateCwIcon data-icon="inline-start" />New code</Button>}
					</DialogFooter>
				</div>
			</DialogContent>
		</Dialog>
	);
}

/** The questions' own toasts: apart from the passing notices, so that a notice never pushes a question out of sight. */
const questions = createToastManager();

/** How long Allow stays inert after a question appears: a click meant for what was there before never allows a device. */
export const ALLOW_AFTER_MS = 1000;

/** Allow, inert for a moment after the question it answers is shown. A new question is a new toast, and so a new wait. */
function AllowButton({ onAllow }: { onAllow: () => void }) {
	const [ready, setReady] = useState(false);
	useEffect(() => {
		const t = setTimeout(() => setReady(true), ALLOW_AFTER_MS);
		return () => clearTimeout(t);
	}, []);
	return <Button size="sm" data-slot="pairing-allow" disabled={!ready} onClick={onAllow}>Allow</Button>;
}

/** The toasts on screen: each a device asking, with the four digits large, Refuse and Allow. Each answer names its question. */
function QuestionList({ answer }: { answer: (yes: boolean, request: Request) => void }) {
	const { toasts } = useToastManager();
	return toasts.map((t) => {
		const request = (t.data as { request: Request }).request;
		return (
			// No swipe: a question goes when it is answered, withdrawn or over, never by a gesture.
			<Toast key={t.id} toast={t} swipeDirection={[]} className="top-0 bottom-auto origin-top data-starting-style:[transform:translateY(-150%)] [&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:translateY(-150%)]">
				<ToastContent data-slot="pairing-request" className="flex-col items-stretch gap-3">
					<div className="flex items-start gap-3">
						<MonitorSmartphoneIcon aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />
						<div className="flex min-w-0 flex-col gap-1">
							<ToastTitle className="wrap-anywhere"><span data-slot="pairing-device">{request.name}</span> wants to connect</ToastTitle>
							<ToastDescription>Allow it only if the device's screen shows these four digits:</ToastDescription>
						</div>
					</div>
					<p data-slot="pairing-code" className="text-center font-mono text-3xl font-semibold tracking-widest tabular-nums select-text">{request.code}</p>
					<div className="flex justify-end gap-2">
						<Button variant="outline" size="sm" data-slot="pairing-refuse" onClick={() => answer(false, request)}>Refuse</Button>
						<AllowButton key={request.id} onAllow={() => answer(true, request)} />
					</div>
				</ToastContent>
			</Toast>
		);
	});
}

/**
 * The question when a device asks: a toast at the top of the window for as long as the question
 * stands (the main process ends it when it is answered, expires or is withdrawn). Base UI's toasts
 * never move the focus, so what the owner types goes on where it went.
 */
export function PairingQuestion({ request, answer }: { request?: Request; answer: (yes: boolean, request: Request) => void }) {
	useEffect(() => {
		if (!request) return;
		// Not "high": Base UI hides a high-priority toast from assistive technology (its live region says it instead), and the buttons with it.
		const id = questions.add({ timeout: 0, data: { request } });
		return () => questions.close(id);
	}, [request?.id]);
	return (
		<ToastProvider toastManager={questions}>
			<ToastPortal>
				{/* Under the title bar, where the window's buttons are. */}
				<ToastViewport data-slot="pairing-questions" className="top-12 bottom-auto">
					<QuestionList answer={answer} />
				</ToastViewport>
			</ToastPortal>
		</ToastProvider>
	);
}

/** Visibility was paused after refusals: said once, with a way to turn it back on now. On the passing notices' toaster. */
function usePausedNotice(state: AccessState | undefined, platform: string, resume: () => void) {
	const paused = state?.paused;
	useEffect(() => {
		if (!paused) return;
		const id = toast.add({
			title: "Visibility paused after 3 refusals",
			description: `For an hour, this ${computerWord(platform)} is not announced on this network and takes no request without a code.`,
			type: "warning",
			timeout: 0,
			actionProps: { children: "Turn on now", onClick: resume },
		});
		return () => toast.close(id);
	}, [paused]);
}

/** The parts above, wired to the bridge and the store. Nothing where the bridge has no browser access (the web client, the mobile app). */
export function DevicePairing() {
	const s = useModel(store);
	const has = typeof bridge.onAccess === "function";
	const [state, answered] = useAccessState({
		on: has,
		told: (next) => {
			if (next.request && store.devicePairing && !store.devicePairing.asked) {
				store.devicePairing = { ...store.devicePairing, asked: true };
				store.touch();
			}
		},
	});
	const [now, setNow] = useState(Date.now);
	const opened = s.devicePairing;
	useInterval(() => setNow(Date.now()), opened ? 1000 : null);
	useEffect(() => setNow(Date.now()), [opened?.link]);
	usePausedNotice(state, s.platform, () => void store.attempt(() => answered(bridge.setAccess!({ visible: true }))));
	if (!has) return null;

	const answer = (yes: boolean, request: Request) => {
		if (store.devicePairing) (store.devicePairing = undefined), store.touch();
		void store.attempt(() => bridge.answerPairing!(yes, request.id));
	};
	return (
		<>
			{/* Put away while a device asks, so that nothing stands over the question. */}
			<AddDeviceDialog
				opened={state?.request ? undefined : opened}
				stale={opened ? isStale(opened, state, now) : false}
				now={now}
				onClose={() => s.closePairing()}
				onNew={() => void s.addDevice()}
				onCopy={() => void bridge.copyPairingLink!().then(() => store.flash("The link is on the clipboard.", "good", 3000), (e: unknown) => store.flash(errText(e), "bad"))}
			/>
			<PairingQuestion request={state?.request} answer={answer} />
		</>
	);
}
