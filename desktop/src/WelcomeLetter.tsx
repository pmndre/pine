import { ArrowUpRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";

/** What the letter offers to try: an agent that listens for something, made by main. It needs no sign-in and fires within seconds. */
export const TRY_EVENTS = "Make an agent that tells me about each new file in Downloads.";

export interface LetterProps {
	/** The main agent's name. */
	main: string;
	/** pine's home as the owner would write it (~/.pine). */
	home: string;
	/** Whether the home is on this computer, where it can be shown in the Finder. */
	here: boolean;
	/** Opens Settings, on a page and at a part of it (`find`, a selector the page marks the part with) where they are named. */
	settings: (section?: string, find?: string) => void;
	reveal: () => void;
	/** Put words into the input, for the owner to send or change. */
	say: (text: string) => void;
}

/**
 * pine's welcome, at the top of the main agent's main conversation. pine wrote it, not a model: it
 * is there before any model is, and it is no part of what the model reads. The main agent
 * introduces itself in its answer to the owner's first message (src/hatch.ts). What is missing to answer
 * (a model) the agent's card above it says, as on every agent's card.
 */
export function WelcomeLetter({ main, home, here, settings, reveal, say }: LetterProps) {
	return (
		<Message data-item="welcome">
			<MessageContent className="gap-3 select-text">
				<MessageHeader className="px-0">
					Welcome to pine!
				</MessageHeader>
				<p>
					Let <b>{main}</b> set pine up for you, consider it pine's administrator. Ask it if you are unsure about anything. In pine agents come first. You create your projects and tasks in them. Ask <b>{main}</b> to create new agents for specific purposes: coding, work, automation, chat, etc.
				</p>
				<p>The first session always persists. Other sessions get cleaned up after some time, unless you pin them, then they persist as well.</p>
				<p>Chat, code, work in a folder, or let agents act on events while you are away. Try:</p>
				<Item variant="outline" size="sm" className="text-left" render={<button type="button" />} onClick={() => say(TRY_EVENTS)} data-slot="welcome-try">
					<ItemContent>
						<ItemTitle>{TRY_EVENTS}</ItemTitle>
					</ItemContent>
					<ItemActions>
						<ArrowUpRightIcon className="text-muted-foreground" />
					</ItemActions>
				</Item>
				<p data-slot="welcome-browser">
					Agents browse in a browser of pine's own. To let them work in your Chrome or Brave too, with your logins, <Button variant="link" className="h-auto p-0 [font-size:inherit]" onClick={() => settings("general", "[data-setting=own-browser]")}>connect your browser</Button>.
				</p>
				<p>
					{/* Links in the text do something in the app and never open an address: the stock link button, at the size of the text around it. The home's path wraps inside the sentence: a long one would overflow a narrow window. */}
					Everything lives in {here ? <Button variant="link" className="inline h-auto shrink p-0 text-left [font-size:inherit] whitespace-normal wrap-anywhere" onClick={reveal}>{home}</Button> : <span className="font-mono text-xs wrap-anywhere">{home}</span>} and <Button variant="link" className="h-auto p-0 [font-size:inherit]" onClick={() => settings()}>Settings</Button>, but telling <b>{main}</b> is usually enough.
				</p>
			</MessageContent>
		</Message>
	);
}
