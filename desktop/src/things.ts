// What Settings and the Agent tab of the side panel share about the things an agent can be given (sources,
// schedules, routes, skills, MCP servers): how one is said in words, whom it concerns, the sign that a list
// changed, and the one dialog a route, a schedule or a skill opens in, wherever its row was clicked.
// No React and no page: Settings.tsx draws the dialog (`ThingDialog`), App.tsx holds it over whatever is in front.
import type { AskQuestion, Route, Schedule, Skill } from "./api.ts";
import { Model, store } from "./model.ts";
import type { Place } from "./settings-index.ts";
import { short } from "./text.ts";

/** A route, a schedule or a skill to open in its dialog: one there is, or a new one (for `agent`, or for all agents). */
export type Thing =
	| { kind: "route"; route?: Route; agent?: string }
	| { kind: "schedule"; schedule?: Schedule; agent?: string }
	| { kind: "skill"; skill?: Skill; agent?: string };

class Opened extends Model {
	thing?: Thing;
}
/** The thing whose dialog is open, if one is. */
export const OPENED = new Opened();
export const openThing = (thing: Thing | undefined) => ((OPENED.thing = thing), OPENED.touch());

/** A schedule's times in a few words, for a row with little room: "every 6h", "once, 2026-12-24 17:00", or its cron line. */
export const whenShort = (x: Schedule) => (x.every ? `every ${x.every}` : x.at ? `once, ${x.at}` : (x.cron ?? x.when));

/** Says that one of the lists changed, so that every list on screen asks again: a page and its "Agents' own". */
export const LISTS = new Model();
export const changed = () => LISTS.touch();

/** A line of a source's subscribers ("books", "books/side", "books (a fresh conversation …)") as the agent and conversation it is. */
export const subscriber = (who: string) => {
	const agent = who.split(/[/ ]/)[0];
	return { agent, session: who.includes("/") ? who.slice(agent.length + 1) : who.includes("(") ? "new" : "main" };
};

// A time in milliseconds as pine.json writes it: 5m, 30s, 2h.
export const span = (ms: number) => (ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : ms % 60_000 === 0 ? `${ms / 60_000}m` : ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`);

export const conversationOf = (session: string | undefined) => (!session || session === "main" ? "in the main conversation" : session === "new" ? "in a new conversation" : `in the conversation ${session}`);

// The three kinds of answer a decision has (src/ask.ts), and what a filter on each looks like.
export const DECIDE_ANSWERS = {
	yesno: { label: "Yes or no", said: "yes or no", field: "yes", filter: '{"gte": 0.8}', about: "The answer is how likely a yes is, from 0 to 1." },
	choice: { label: "One of several", said: "one of", field: "choice", filter: '"invoice"', about: "The answer is the name of the option that fits best." },
	score: { label: "A level", said: "a level of", field: "score", filter: '{"gte": 1}', about: "The answer is the level that fits and its position, where 0 is the lowest." },
} as const;

export const decideSaid = (questions: Record<string, AskQuestion>) =>
	Object.entries(questions)
		.map(([name, q]) => `${name}: “${short(q.question, 80)}” (${DECIDE_ANSWERS[q.type]?.said ?? q.type}${q.options ? ` ${Object.keys(q.options).join(", ")}` : q.levels ? ` ${q.levels.join(", ")}` : ""})`)
		.join(" and ");

/** A route in the words of the form that makes one: when what arrives, then what happens. */
export function routeSaid(r: Route): { when: string; then: string } {
	const when = [
		r.on.join(" or "),
		r.when ? `only if ${JSON.stringify(r.when)}` : "",
		r.throttleMs ? `at most one per ${span(r.throttleMs)}` : "",
		r.debounceMs ? `the last of a burst, after ${span(r.debounceMs)} without another` : "",
	].filter(Boolean).join(", ");
	const then = [
		r.set ? `set ${Object.entries(r.set).map(([k, v]) => `${k} to ${JSON.stringify(v)}`).join(" and ")}` : "",
		r.call ? `ask ${r.call.model ?? "the default model"} once: “${short(r.call.prompt, 80)}”` : "",
		r.ask ? `decide with ${r.ask.model ?? "the default model"}, ${decideSaid(r.ask.questions)}` : "",
		r.run ? `run “${short(r.run.command, 80)}”${r.run.agent ? ` as ${r.run.agent}` : ""}` : "",
		r.publish ? (r.ask && r.publish.payload === undefined ? `publish the answers as ${r.publish.topic}` : r.call && r.publish.payload === undefined ? `publish the answer as ${r.publish.topic}` : `publish ${r.publish.topic}${r.publish.payload !== undefined ? ` with ${short(JSON.stringify(r.publish.payload), 60)}` : ""}`) : "",
		r.agent ? `wake ${r.agent} ${conversationOf(r.session)}${r.prompt ? `: “${short(r.prompt, 100)}”` : ", with the event"}` : "",
	].filter(Boolean).join(", then ");
	return { when, then };
}

// Whom a schedule wakes, in the words of the form that makes one.
export const wakes = (scope: string, session?: string) => (scope === "global" ? "all agents, each in its main conversation" : `${scope} ${conversationOf(session)}`);

/** Whether a route concerns an agent: the agent made it, it wakes the agent, or it runs in the agent's sandbox. */
export const routeOf = (r: Route, agent: string) => r.of === agent || r.agent === agent || r.run?.agent === agent;

/** Where a thing found in Settings is: its page opens, and the page shows it (see Settings below). */
export function goTo(place: Place): void {
	store.settingsFind = place.find || place.filter ? { find: place.find, filter: place.filter } : undefined;
	store.openSettings(place.section, place.agent);
}
