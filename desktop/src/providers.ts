// What people call the model providers pi knows, for the Models page and the search of Settings. pi names a
// provider after its company ("Google", "xAI"), people search for the model or the product ("Gemini", "Grok").
// No React, no store: the search index and its tests use it too.
import type { Provider } from "./api.ts";

/**
 * Subscriptions people are likely to have already, by the provider's id in pi: shown first, with words they know.
 * Only where the sign-in is the subscription itself (OAuth); everything else is found by searching.
 */
export const SUBSCRIPTIONS: Record<string, { title: string; about: string }> = {
	anthropic: { title: "Claude", about: "Sign in with your Claude Pro or Max subscription" },
	"openai-codex": { title: "ChatGPT", about: "Sign in with your ChatGPT Plus or Pro subscription" },
	"github-copilot": { title: "GitHub Copilot", about: "Sign in with your GitHub Copilot subscription" },
};

/** Providers that are better known by another name, and what to say about them on their row. */
const KNOWN: Record<string, { title?: string; about?: string; words: string }> = {
	// pi took out the sign-in with a Gemini subscription (Gemini CLI, Antigravity): searching for one finds this row,
	// which says what works instead.
	google: { title: "Google Gemini", about: "Needs an API key from Google AI Studio: there is no sign-in with a Gemini or Antigravity subscription", words: "gemini antigravity gemini-cli ai studio" },
	"google-vertex": { words: "gemini" },
	anthropic: { words: "claude anthropic" },
	"openai-codex": { words: "chatgpt codex gpt" },
	openai: { words: "chatgpt gpt" },
	"github-copilot": { words: "copilot" },
	xai: { words: "grok" },
	moonshotai: { words: "kimi" },
	"moonshotai-cn": { words: "kimi" },
	zai: { words: "glm zhipu" },
	"zai-coding-cn": { words: "glm zhipu" },
	meta: { words: "llama" },
	"qwen-token-plan": { words: "qwen alibaba" },
	"qwen-token-plan-individual": { words: "qwen alibaba" },
};

/** The name a provider is shown by. */
export const providerName = (p: Provider) => SUBSCRIPTIONS[p.id]?.title ?? KNOWN[p.id]?.title ?? p.name ?? p.id;

/** What a provider's row says when you are not signed in to it, where there is more to say than how to sign in. */
export const providerAbout = (p: Provider) => SUBSCRIPTIONS[p.id]?.about ?? KNOWN[p.id]?.about;

/** Every word a provider is found by: its name, its id and what people call it. */
export const providerWords = (p: Provider) => `${providerName(p)} ${p.name ?? ""} ${p.id} ${KNOWN[p.id]?.words ?? ""}`.toLowerCase();
