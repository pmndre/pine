// Stand-ins for the windows of the web client: the top-level document (the web bridge), the
// page's iframe, and a stranger, any other window that can post to the top. A message is
// delivered later, as a copy, with the window that sent it as its `source`, as a browser does.

type Listener = (event: { data: unknown; source: unknown }) => void;

export class FakeWindow {
	private listeners = new Set<Listener>();
	/**
	 * What arrives through `postMessage` on this window itself comes from this: for the frame, the
	 * top as the frame sees it (its `window.parent`), which is one object in a browser.
	 */
	poster: unknown;
	addEventListener(_type: "message", listener: Listener) {
		this.listeners.add(listener);
	}
	removeEventListener(_type: "message", listener: Listener) {
		this.listeners.delete(listener);
	}
	postMessage(data: unknown, _origin: string) {
		this.deliver(data, this.poster);
	}
	deliver(data: unknown, from: unknown) {
		const copy = structuredClone(data);
		setTimeout(() => this.listeners.forEach((fn) => fn({ data: copy, source: from })), 0);
	}
}

/** `target` as `sender` holds it: what is posted on it arrives from `sender`. */
export function seenBy(target: FakeWindow, sender: FakeWindow) {
	return { postMessage: (data: unknown, _origin: string) => target.deliver(data, sender) };
}

/** The top, the page's frame (posted to by the top), and a stranger. */
export function windows() {
	const top = new FakeWindow();
	const frame = new FakeWindow();
	const parentOfFrame = seenBy(top, frame);
	frame.poster = parentOfFrame;
	const stranger = new FakeWindow();
	return { top, frame, stranger, parentOfFrame, topFromStranger: seenBy(top, stranger) };
}
