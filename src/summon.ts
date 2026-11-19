/**
 * A summon: the owner calls pine, or one of its agents, from a text written somewhere else
 * ("/pine kevin brainstorm this"). The shape is `<trigger> [agent] [#conversation] <request>`.
 * This module only reads that shape; who may summon is the source's business, and where a summon
 * runs is the router's.
 */
export interface Summon {
	/** The trigger that was found, in the case it was configured with. */
	trigger: string;
	/** The agent named right after the trigger, when there is one by that name. Lower case. */
	agent?: string;
	/** A `#name` after the trigger (and the agent): the conversation the owner named. */
	conversation?: string;
	/**
	 * What follows the trigger and the agent, as it was written. A `#name` stays in it: nothing
	 * moves a summon by that name unless the owner allowed it, and then it is taken out there.
	 * An unknown word after the trigger stays too, so that a typo does not lose the request.
	 */
	request: string;
}

/**
 * The text of an event that a trigger is looked for in: its `text`, or for a source that reports
 * a body (`webhook`), the body's `text` or the body itself when it is text.
 */
export function summonText(payload: unknown): string {
	const p = payload as any;
	if (typeof p === "string") return p;
	if (typeof p?.text === "string") return p.text;
	if (typeof p?.body === "string") return p.body;
	if (typeof p?.body?.text === "string") return p.body.text;
	return "";
}

/** The conversation a summon runs in: one of its own, named after the event, listed like any other. */
export const summonSession = (eventId: number | string) => `summon-${eventId}`;

const escape =(s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The summon a text carries, or nothing. The first trigger in the text counts; what comes before
 * it is context, not the request, and a trigger later on is part of the request. A trigger is a
 * word of its own: "/pine" is not found in "/pineapple", nor "@pine" in "x@pine.com". Case does
 * not matter, for the trigger nor for the agent's name.
 */
export function parseSummon(text: string, triggers: string[], agents: string[]): Summon | undefined {
	if (!text) return undefined;
	let found: { trigger: string; end: number; at: number } | undefined;
	for (const trigger of triggers) {
		if (!trigger.trim()) continue;
		const m = new RegExp(`(?:^|[^\\w@/.])(${escape(trigger.trim())})(?![\\w-])`, "i").exec(text);
		if (!m) continue;
		const at = m.index + m[0].length - m[1].length;
		if (!found || at < found.at) found = { trigger: trigger.trim(), at, end: at + m[1].length };
	}
	if (!found) return undefined;
	let rest = text.slice(found.end).trim();
	const summon: Summon = { trigger: found.trigger, request: "" };
	const word = /^(\S+)/.exec(rest)?.[1];
	const name = word?.replace(/[,:;.!?]+$/, "").toLowerCase();
	if (name && agents.some((a) => a.toLowerCase() === name)) {
		summon.agent = name;
		rest = rest.slice(word!.length).trim();
	}
	const conversation = /^#([\w.-]+)(?=\s|$)/.exec(rest)?.[1];
	if (conversation) summon.conversation = conversation;
	summon.request = rest;
	return summon;
}
