// On an iPhone or iPad a pairing link opens the browser, never the Pine app: universal links cannot
// be had with an app each owner signs themselves. So before the browser uses the link's one-time
// code, the web bridge's own document asks the owner whether the app pairs instead ("Open in the
// Pine app", a `pine:` address that carries the link) or this browser does ("Continue in this
// browser", as on every other device). The page in its iframe draws none of it and never holds the
// code: the choice is the top-level document's, drawn over the iframe.
import type { PairLink } from "./pairing.ts";

/**
 * Whether this browser runs on an iPhone, an iPod or an iPad. iPadOS's Safari says "Macintosh" in
 * its user agent, as a Mac does; only its touch screen tells it apart (a Mac has no touch points).
 */
export function onIosDevice(userAgent: string, maxTouchPoints: number): boolean {
	if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return true;
	return /\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1;
}

/**
 * The address that hands a pairing link to the Pine app on iOS:
 * `pine://pair?service=<percent-encoded origin>&id=<machine id>&code=<code>`. The machine id and the
 * code are base64url and need no encoding; the service is the origin of this deployment, whose
 * meeting service the app then uses.
 */
export function appAddress(service: string, link: PairLink): string {
	return `pine://pair?service=${encodeURIComponent(new URL(service).origin)}&id=${link.id}&code=${link.code}`;
}

/** What draws the choice and tells which button was pressed: the DOM of the bridge's document (`choiceView`), a stand-in in the tests. */
export type ChoiceView = {
	/** Draws the two buttons; each press is handed to `pressed`. */
	show(pressed: { app(): void; browser(): void }): void;
	/** Says, after "Open in the Pine app", what to do when the app did not open. */
	tried(): void;
	/** Takes the choice away: this browser pairs. */
	close(): void;
};

/**
 * Asks the owner whether the Pine app or this browser pairs with the link, and resolves once this
 * browser is to pair, not before. "Open in the Pine app" navigates to the app's address and uses
 * nothing: the choice stays, so that an owner without the app can still continue in the browser.
 */
export function chooseApp(link: PairLink, service: string, view: ChoiceView, navigate: (url: string) => void): Promise<void> {
	return new Promise((resolve) => {
		view.show({
			app() {
				navigate(appAddress(service, link));
				view.tried();
			},
			browser() {
				view.close();
				resolve();
			},
		});
	});
}

/** The choice drawn into the bridge's document, over the page's iframe, with text only and buttons. */
export function choiceView(doc: Document): ChoiceView {
	const box = doc.createElement("div");
	box.className = "choice";
	box.setAttribute("role", "dialog");
	box.setAttribute("aria-labelledby", "choice-title");
	const title = doc.createElement("h1");
	title.id = "choice-title";
	title.textContent = "Pair with your computer";
	const says = doc.createElement("p");
	says.textContent = "Is the Pine app on this device? Open the link in it to pair the app, or continue to pair this browser.";
	const app = doc.createElement("button");
	app.type = "button";
	app.dataset.choice = "app";
	app.textContent = "Open in the Pine app";
	const browser = doc.createElement("button");
	browser.type = "button";
	browser.dataset.choice = "browser";
	browser.textContent = "Continue in this browser";
	const note = doc.createElement("p");
	note.className = "note";
	note.hidden = true;
	note.textContent = "If the Pine app did not open, it is not on this device: continue in this browser.";
	box.append(title, says, app, browser, note);
	return {
		show(pressed) {
			app.addEventListener("click", () => pressed.app());
			browser.addEventListener("click", () => pressed.browser());
			doc.body.append(box);
			app.focus();
		},
		tried() {
			note.hidden = false;
		},
		close() {
			box.remove();
		},
	};
}

// Throwaway: checks a pull request's preview from end to end. Never merged.
