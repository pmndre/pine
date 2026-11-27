import { c } from "./theme.ts";

/** What the welcome offers to try, as the Pine app does: an agent that listens for something, made by main. */
export const TRY_EVENTS = "Make an agent that tells me about each new file in Downloads.";

/**
 * pine's welcome, at the top of the main agent's main conversation, as the Pine app shows it
 * (desktop/src/WelcomeLetter.tsx) in the terminal's words. pine wrote it, not a model, and it is no
 * part of what the model reads.
 */
export function welcome(main: string, problem: string | undefined, home: string): string {
	const lines = [c.bold("Welcome to pine!"), ""];
	if (problem) lines.push(`${c.yellow(c.bold("Connect a model first:"))} sign in to a subscription with pine login <provider> in another terminal, or add a model server of your own with pine model add.`, "");
	lines.push(
		`Let ${c.bold(main)} set pine up for you, consider it pine's administrator. Ask it if you are unsure about anything. In pine agents come first. You create your projects and tasks in them. Ask ${c.bold(main)} to create new agents for specific purposes: coding, work, automation, chat, etc.`,
		"The first session always persists. Other sessions get cleaned up after some time, unless you pin them, then they persist as well.",
		`Chat, code, work in a folder (/folder), or let agents act on events while you are away. Try: ${c.cyan(TRY_EVENTS)}`,
		`Agents browse in a browser of pine's own. To let them work in your Chrome or Brave too, with your logins: ${c.cyan("pine chrome install")}`,
		`Everything lives in ${home}, but telling ${c.bold(main)} is usually enough.`,
	);
	return lines.join("\n");
}
