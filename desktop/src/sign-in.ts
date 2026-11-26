// A sign-in to a model provider as the page follows it: started on the daemon (`/models/login`),
// asked how it stands until it is done, answered, or cancelled. Settings > Models draws one in a
// dialog, and the setup conversation as a card; both follow it with this. No React here: whoever
// shows it subscribes to it (`useModel`).
import { api, type LoginState } from "./api.ts";
import { bridge } from "./bridge.ts";
import { Model } from "./model.ts";
import { errText } from "./text.ts";

export class SignInRun extends Model {
	readonly provider: string;
	readonly type?: "api_key" | "oauth";
	id?: string;
	state?: LoginState;
	/** What went wrong in asking, rather than in the sign-in itself (that is `state.error`). */
	error?: string;
	private live = true;
	private timer = 0;
	/** The page is opened where the owner sits, once for each address the flow names. */
	private opened?: string;

	constructor(provider: string, type?: "api_key" | "oauth") {
		super();
		this.provider = provider;
		this.type = type;
		api.login(provider, type).then(
			(r) => {
				// Let go before it had started: it is still ended, since nothing else knows its id.
				if (!this.live) return void api.loginAnswer(r.id, { cancel: true }).catch(() => {});
				this.id = r.id;
				this.timer = window.setTimeout(() => void this.look(), 150);
				this.touch();
			},
			(e) => this.fail(e),
		);
	}

	get done(): boolean {
		return Boolean(this.state?.done);
	}

	private async look(): Promise<void> {
		if (!this.id || !this.live) return;
		try {
			const next = await api.loginState(this.id);
			if (!this.live) return;
			this.state = next;
			if (next.url && this.opened !== next.url) {
				this.opened = next.url;
				void bridge.open(next.url);
			}
			if (!next.done) this.timer = window.setTimeout(() => void this.look(), 700);
			this.touch();
		} catch (e) {
			this.fail(e);
		}
	}

	private fail(e: unknown): void {
		if (!this.live) return;
		this.error = errText(e);
		this.touch();
	}

	/** The sign-in page again, for an owner who closed it. */
	openPage(): void {
		if (this.state?.url) void bridge.open(this.state.url);
	}

	/** An answer to what the flow asks: an option's id, or what was typed. */
	async answer(text: string): Promise<void> {
		if (!this.id) return;
		this.error = undefined;
		this.touch();
		await api.loginAnswer(this.id, { answer: text }).catch((e) => this.fail(e));
	}

	/** Stop following it; one that is not done is cancelled on the daemon. */
	end(): void {
		if (!this.live) return;
		this.live = false;
		window.clearTimeout(this.timer);
		if (this.id && !this.done) void api.loginAnswer(this.id, { cancel: true }).catch(() => {});
	}
}
