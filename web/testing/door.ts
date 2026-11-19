// The way between the page in its iframe and the web bridge at the top, on stand-in windows, with
// a bridge that records each call: for the tests of the door (src/serve.ts) and of the page's
// bridge (src/frame-bridge.ts). src/host.test.ts has the real bridge.
import { frameBridge } from "../src/frame-bridge.ts";
import { serve, type Served } from "../src/serve.ts";
import { windows } from "./windows.ts";

export const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

/** A bridge that records each call and answers with its name. */
function recorder() {
	const calls: [string, unknown[]][] = [];
	const listeners = new Map<string, Set<(value: unknown) => void>>();
	const bridge = new Proxy({} as Served, {
		get: (_t, name: string) => {
			if (name === "on")
				return (event: string, fn: (value: unknown) => void) => {
					const set = listeners.get(event) ?? new Set();
					listeners.set(event, set.add(fn));
				};
			return async (...args: unknown[]) => {
				calls.push([name, args]);
				return `answer of ${name}`;
			};
		},
	});
	const emit = (event: string, value: unknown) => listeners.get(event)?.forEach((fn) => fn(value));
	return { bridge, calls, emit };
}

/** The recording bridge served at the top, and the page's bridge in the frame talking to it. */
export function door() {
	const w = windows();
	const { bridge, calls, emit } = recorder();
	serve(bridge, w.top, () => w.frame);
	const page = frameBridge(w.parentOfFrame, w.frame);
	return { ...w, page, calls, emit };
}
