import { useEffect, useRef, useState } from "react";
import { type AccessState, bridge } from "./bridge.ts";

/** Whether an answer of the bridge is a state of browser access (Storybook's stand-in answers every call with a function). */
export const isState = (s: unknown): s is AccessState => typeof s === "object" && s !== null && Array.isArray((s as AccessState).devices);

/**
 * Browser access as the app tells it: read once, then every state it pushes. A call's answer was read
 * when the call was made, and arrives after any state the app pushed meanwhile: it is taken only when
 * no push came while the call was out. Otherwise a late answer would show a state that has passed
 * ("cannot reach the service" after "waiting") until something changed again.
 */
export function useAccessState(options: { on?: boolean; told?: (s: AccessState) => void; failed?: (e: unknown) => void } = {}) {
	const { on = true } = options;
	const [state, setState] = useState<AccessState>();
	const pushes = useRef(0);
	const latest = useRef(options);
	latest.current = options;

	/** Takes the state a call answered with, unless the app pushed a newer one while it was out. */
	const answered = async (call: Promise<AccessState> | AccessState | undefined) => {
		const before = pushes.current;
		const s = await call;
		if (pushes.current === before && isState(s)) setState(s);
	};

	useEffect(() => {
		if (!on) return;
		const stop = bridge.onAccess?.((s: AccessState) => {
			pushes.current++;
			setState(s);
			latest.current.told?.(s);
		});
		answered(bridge.access?.()).catch((e: unknown) => latest.current.failed?.(e));
		return () => void (typeof stop === "function" && stop());
	}, [on]);

	return [state, answered] as const;
}
