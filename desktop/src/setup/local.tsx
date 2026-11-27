// The way to a model on the computer pine runs on (this one, for the Pine app on its own pine): the
// daemon asks the usual ports (llama.cpp, Ollama, LM Studio) what they serve (`GET /models/local`),
// the owner picks what answered, or gives an address when nothing did; a server that wants a key
// asks for it in a secret field of the card. The server
// is added through the route Settings > Models uses, so that the daemon chooses the agents' model as
// it does there (`settleModel`). Pinecone (llama.cpp on 8080 with its MCP server on 8090) adds its
// MCP server for all agents too, through the owner's own route for MCP servers.
import { useEffect } from "react";
import { FieldCard, FormCard } from "@/components/field-card";
import { Pulse } from "@/components/pulse";
import { type HostedCard, QuestionCard, useHostedCard } from "@/components/question-card";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { api, ApiError, type LocalServer } from "../api.ts";
import { Model, store, useModel } from "../model.ts";
import { errText } from "../text.ts";
import type { SetupBranch, SetupContext } from "./types.ts";

const WHICH = "Which server?";
const OTHER = "Another address";
/** What a server pine adds is called by the name it was found under; one given by its address is "local". */
const TITLES: Record<string, string> = { pinecone: "Pinecone", llamacpp: "llama.cpp", ollama: "Ollama", lmstudio: "LM Studio" };

/** A server the owner chose, on its way to being added. */
interface Chosen {
	id: string;
	title: string;
	url: string;
	mcp?: string;
	/** What the steps fold into once it is added: its name, or the address given. */
	answer: string;
	key?: string;
	context?: number;
}

/** What this branch has under way while it is picked: kept here, so that it goes on while another tab is in front. */
class Local extends Model {
	/** What answered on this computer, once asked. */
	found?: LocalServer[];
	/** The owner chose to give an address. */
	typing = false;
	chosen?: Chosen;
	/** What the server still needs before it can be added. */
	needs?: "key" | "context";
	busy = false;
	error?: string;
	/** Added, and the models it brought, for the owner to choose among when the daemon chose none. */
	added?: string[];
	private asked = 0;

	async look(): Promise<void> {
		const ask = ++this.asked;
		const found = await api.localServers().then((r) => r.found, () => [] as LocalServer[]);
		if (ask !== this.asked) return;
		this.found = found;
		this.touch();
	}

	choose(chosen: Chosen, ctx: SetupContext): void {
		this.chosen = chosen;
		this.error = undefined;
		this.needs = undefined;
		this.touch();
		void this.add(ctx);
	}

	async add(ctx: SetupContext): Promise<void> {
		const c = this.chosen;
		if (!c || this.busy) return;
		this.busy = true;
		this.error = undefined;
		this.touch();
		try {
			// The same server added already (a step done before a reload): nothing is added twice.
			const there = ctx.facts.servers.find((s) => s.baseUrl === c.url);
			let models = there?.models.map((m) => `${there.name}/${m.id}`);
			if (!there) {
				const taken = new Set([...ctx.facts.servers.map((s) => s.name), ...ctx.facts.providers.map((p) => p.id)]);
				let name = c.id;
				for (let n = 2; taken.has(name); n++) name = `${c.id}-${n}`;
				models = (await api.addModelServer({ name, url: c.url, key: c.key, context: c.context })).models;
			}
			if (c.mcp) await api.addMcp("pinecone", { url: c.mcp });
			// Said once it is added: an address that answered nothing is no answer.
			ctx.said(WHICH, c.answer);
			this.added = models;
			this.needs = undefined;
			await ctx.changed();
		} catch (e) {
			// What it still needs, as the daemon says it (`locked`, `unsized`), never read from its words:
			// a key it refused asks for the key again, with what it said.
			const text = errText(e);
			const data = e instanceof ApiError ? e.data : undefined;
			if (data?.locked) {
				this.needs = "key";
				if (c.key) this.error = text;
			} else if (data?.unsized) this.needs = "context";
			else this.error = text;
		} finally {
			this.busy = false;
			this.touch();
		}
	}

	stop(): void {
		this.asked++;
		this.found = undefined;
		this.typing = false;
		this.chosen = undefined;
		this.needs = undefined;
		this.busy = false;
		this.error = undefined;
		this.added = undefined;
		this.touch();
	}
}

const local = new Local();

/**
 * Where pine looks: the computer its daemon runs on, which is this one only for the Pine app on its own
 * pine. From the mobile app, the web client or another machine's pine, it is that machine.
 */
const where = () => (store.local && !store.remote ? "this computer" : "the computer pine runs on");

/**
 * What the composer says under each card: the value goes into the card's own field, and what is typed
 * below picks nothing (these cards have no options). A key's card holds a secret: what is typed below
 * is neither shown nor kept.
 */
const HOSTED: Record<"address" | "key" | "context", HostedCard> = {
	address: { placeholder: "Type the address in the field above" },
	key: { secret: true, placeholder: "Paste the key in the field above, not here" },
	context: { placeholder: "Type the context in the field above" },
};

/** The usual name of a server given by its address, by its port, so that it reads like one that was found. */
function idFor(url: string): string {
	const port = (() => {
		try {
			return new URL(url).port;
		} catch {
			return "";
		}
	})();
	return { "8080": "llamacpp", "11434": "ollama", "1234": "lmstudio" }[port] ?? "local";
}

/**
 * The card for one value the server needs: its address, its key (a secret field: never shown, and
 * sent straight to the daemon, never to a model), or the context of its models.
 */
function AskCard({ title, about, field, label, help, secret, button, onSend, onBack }: {
	title: string;
	about: string;
	field: "address" | "key" | "context";
	label: string;
	help?: string;
	secret?: boolean;
	button: string;
	onSend: (value: string) => void;
	onBack: () => void;
}) {
	useModel(local);
	useHostedCard(HOSTED[field]);
	return (
		<FieldCard
			data-card="setup-local"
			title={title}
			about={about}
			error={local.error}
			label={label}
			type={secret ? "password" : field === "context" ? "number" : field === "address" ? "url" : "text"}
			input={{ "data-setup": field }}
			help={help}
			button={button}
			busy={local.busy ? "Asking the server…" : undefined}
			start={<Button size="sm" variant="ghost" data-action="back" onClick={onBack}>Back</Button>}
			onSend={onSend}
		/>
	);
}


function Card({ ctx }: { ctx: SetupContext }) {
	useModel(local);
	const { found, chosen } = local;
	useEffect(() => {
		if (!local.found) void local.look();
	}, []);
	const back = () => {
		local.stop();
		ctx.back();
	};
	// Added, and pine chose no model by itself: the choice is the owner's, among the server's. Once a model answers, the engine goes on.
	if (local.added && chosen && !local.busy && !local.needs && !local.error)
		return (
			<Item variant="outline" size="sm" data-slot="setup-local">
				<ItemContent>
					<ItemTitle>{chosen.title} is added</ItemTitle>
					<ItemDescription className="line-clamp-none">Choose the model your agents run on.</ItemDescription>
				</ItemContent>
				<ItemActions>
					<Button size="sm" onClick={() => void store.chooseDefaultModel(local.added).then(ctx.changed)}>Choose a model…</Button>
				</ItemActions>
			</Item>
		);
	if (chosen && local.needs === "key")
		return (
			<AskCard
				title={`${chosen.title} requires a key`}
				about="The server was started with a key and answers only requests that include it."
				field="key"
				label={`Key for ${chosen.title}`}
				help="What you type stays hidden and goes straight into pine's .env file. No agent or model reads it."
				secret
				button="Unlock"
				onSend={(key) => {
					chosen.key = key;
					void local.add(ctx);
				}}
				onBack={back}
			/>
		);
	if (chosen && local.needs === "context")
		return (
			<AskCard
				title={`How much context does ${chosen.title} give?`}
				about="The server does not report how many tokens one request may use. Enter the context size it was started with."
				field="context"
				label="Context, in tokens"
				help="For example 32768."
				button="Add"
				onSend={(text) => {
					chosen.context = Number(text);
					void local.add(ctx);
				}}
				onBack={back}
			/>
		);
	if (local.typing || (found && !found.length) || (chosen && local.error))
		return (
			<AskCard
				title={found?.length || local.typing ? "The address of your model server" : `pine found no model server on ${where()}`}
				about={found?.length || local.typing ? "A server that speaks OpenAI's API, as LM Studio, Ollama and llama.cpp do." : "pine checked the usual ports of llama.cpp (8080), Ollama (11434) and LM Studio (1234). If your server runs elsewhere, enter the address."}
				field="address"
				label="Address"
				help="For example http://127.0.0.1:8080"
				button="Connect"
				onSend={(url) => {
					const id = idFor(url);
					local.choose({ id, title: TITLES[id] ?? url, url, answer: url }, ctx);
				}}
				onBack={back}
			/>
		);
	if (!found || chosen)
		return (
			<FormCard
				data-card="setup-local"
				title={chosen ? `Adding ${chosen.title}` : `Looking for model servers on ${where()}`}
				about={chosen ? "Asking the server which models it has…" : "llama.cpp, Ollama, LM Studio and Pinecone, on their usual ports…"}
				start={<Button size="sm" variant="ghost" onClick={back}>Back</Button>}
				end={<Pulse label="Loading" />}
			/>
		);
	return (
		<QuestionCard
			id="server"
			question={WHICH}
			header="Model"
			from="pine asks"
			options={[
				...found.map((s) => ({ id: s.id, label: s.title, description: describe(s) })),
				{ id: "other", label: OTHER, description: `A server pine did not find on ${where()}. You enter the address.` },
			]}
			autoFocus
			actions={<Button size="sm" variant="ghost" data-action="back" onClick={back}>Back</Button>}
			onAnswer={([n]) => {
				const s = found[n - 1];
				if (!s) {
					local.typing = true;
					local.touch();
					return;
				}
				local.choose({ id: s.id, title: s.title, url: s.url, mcp: s.mcp, answer: s.title }, ctx);
			}}
		/>
	);
}

/** One line for a server that answered: where, what it serves, what picking it adds. */
function describe(s: LocalServer): string {
	const where = new URL(s.url).host;
	if (s.locked) return `${where}, requires a key.`;
	const models = s.models.length > 3 ? `${s.models.slice(0, 3).join(", ")} and ${s.models.length - 3} more` : s.models.join(", ");
	return s.mcp ? `${where}: ${models}, plus tools for all your agents.` : `${where}: ${models}.`;
}

export const localBranch: SetupBranch = {
	id: "local",
	// Read when the first card is drawn: where pine runs is known by then.
	get label() {
		return `A model on ${where()}`;
	},
	get description() {
		return where() === "this computer" ? "LM Studio, Ollama, llama.cpp or Pinecone, running here. Free and private, if this computer can run one." : "LM Studio, Ollama, llama.cpp or Pinecone, running on the computer pine runs on, not on this device. Free and private, if it can run one.";
	},
	derive: (facts) => {
		const name = facts.main.model?.split("/")[0] ?? "";
		const server = facts.servers.find((s) => s.name === name);
		if (!server) return undefined;
		return [{ question: WHICH, answer: TITLES[name.replace(/-\d+$/, "")] ?? server.baseUrl }];
	},
	Card,
	leave: () => local.stop(),
};
