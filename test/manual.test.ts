import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { createManual, loadManual, partsOf, showRead, showSearch, stem } from "../src/manual.ts";
import { harness, mockMsg } from "./support/harness.ts";

const run = promisify(execFile);
const CLI = path.resolve(import.meta.dirname, "../src/cli.ts");
const DOCS = path.resolve(import.meta.dirname, "../docs");

test("manual: a file is cut into a part per heading and a part per row that describes a named thing", () => {
	const parts = partsOf(
		"demo",
		"---\nname: demo\n---\n\n# Demo\n\nIntro.\n\n## Keys\n\n| Key | Default | Meaning |\n|---|---|---|\n| `bashTimeoutSec` | `300` | Longest shell command. |\n| plain | x | not a named thing |\n\n```md\n## not a heading\n```\n\n### Deeper\n\nText.\n\n## Keys\n\nAgain.\n",
	);
	assert.deepEqual(parts.map((p) => [p.id, p.kind, p.path.join(" › ")]), [
		["demo", "section", "Demo"],
		["demo#keys", "section", "Demo › Keys"],
		["demo#keys/bashtimeoutsec", "row", "Demo › Keys › bashTimeoutSec"],
		["demo#deeper", "section", "Demo › Keys › Deeper"],
		["demo#keys-2", "section", "Demo › Keys"],
	]);
	assert.equal(parts[2].text, "`bashTimeoutSec`\nDefault: `300`\nMeaning: Longest shell command.");
	assert.ok(parts[1].text.includes("## not a heading"), "a heading inside a code block is text");
	assert.deepEqual(parts[1].children, ["demo#deeper"]);
	assert.deepEqual(["subscribes", "subscribed", "subscribing", "subscribe"].map(stem), ["subscrib", "subscrib", "subscrib", "subscrib"]);
	assert.deepEqual(["schedules", "scheduled", "scheduling", "policies", "boxes"].map(stem), ["schedul", "schedul", "schedul", "policy", "box"]);
});

test("manual: questions in an agent's own words find the part of pine's manual that answers them", () => {
	const manual = createManual(loadManual(DOCS));
	assert.ok(manual.parts.length > 300, `${manual.parts.length} parts`);
	const top = (q: string, n = 3) => manual.search(q, n).hits.map((h) => h.id);
	// [what is asked, a part that must be among the first three]
	const cases: Array<[string, RegExp]> = [
		["telegram pairing code", /^source-types#telegram$/],
		["start the daemon from a desktop app and get its token", /^operations#(a-ui-of-its-own|commands\/pine-service)/],
		["change a setting over the control api from a script", /^operations#(setting-pine-up-through-the-control-api|the-control-api)/],
		["save a file from an editor through the daemon", /^(operations#setting-pine-up-through-the-control-api\/post-agents-id-view-write|security#3-the-sandbox|coding#from-a-script)/],
		["sign in to a model provider from another program", /^operations#setting-pine-up-through-the-control-api/],
		["alert my owner unattended without approval for each message", /^sources#telling-you-needs-no-approval$/],
		["send a photo or a video clip to my owner on telegram", /^sources#a-picture-or-a-video-with-the-message$/],
		["camera events pile up in my conversation and the context grows", /^sources#a-fresh-conversation-for-every-event$/],
		["what did another agent say in its chat", /^setup#conversations-and-tabs/],
		["open a tab for my owner on a conversation", /^setup#conversations-and-tabs/],
		["close a tab from a tool call", /^setup#conversations-and-tabs/],
		["remove_conversation", /^setup#conversations-and-tabs\/remove-conversation$/],
		["why does the model read the whole conversation again when I switch to another tab", /^(agents#what-the-model-server-keeps|operations#problems)/],
		["the first answer in a new conversation takes long", /^(agents#what-the-model-server-keeps|operations#problems)/],
		["the tools take too many tokens of the prompt, how do I make it smaller", /^(agents#how-tools-are-declared|operations#problems)/],
		["I do not have a tool called add_source, only pine_sources", /^(agents#how-tools-are-declared|pine#if-you-are-an-agent-running-inside-pine)/],
		["llama.cpp slots", /^agents#what-the-model-server-keeps/],
		["warmSlots", /limits-warmslots$/],
		["slotPages", /limits-slotpages$/],
		["I have more conversations than the model server has slots, is each read again", /^(agents#what-the-model-server-keeps|operations#problems)/],
		["can I talk to pine instead of typing", /^(tui|desktop)#(dictating-a-message|commands|keys)/],
		["is there an app with a window instead of the terminal", /^desktop/],
		["how do I search my old sessions for something that was said", /^desktop#finding-a-conversation/],
		["where did the list of conversations go when I made the pine window narrow, to put it beside another app", /^desktop#the-window/],
		["is there a settings panel where I can change pine's configuration by clicking", /^desktop#settings/],
		["an editor to change a file myself beside the conversation", /^desktop#the-code-panel-and-the-editor/],
		["can I run the commands the agent gives me with a play button", /^desktop#the-terminal/],
		["where do I type shell commands myself in the Pine app", /^desktop#the-terminal/],
		["does the mac app start pine or do I have to start it first", /^desktop#the-daemon-started-or-reused/],
		["where do I download the mac app, and do I have to install node first", /^desktop#getting-it/],
		["I only installed the app, how do I get the pine command in my shell", /^desktop#pine-in-a-terminal/],
		["does the mac app tell me when there is a newer version, or do I have to look myself", /^desktop#a-newer-version/],
		["check for updates", /^desktop#a-newer-version/],
		["the browser in the app is empty, how do I get back to the page my agent had open", /^desktop#the-browser/],
		["can I watch the page the agent has open inside the app, and click in it myself", /^desktop#(the-browser|the-code-panel-and-the-editor)/],
		["log in to a site for the agent in the mac app without a second window", /^(desktop#the-browser|mcp#)/],
		["make a web page with buttons my owner can click, and be told what was clicked", /^interfaces/],
		["build a user interface for my owner in the browser", /^interfaces/],
		["play tic tac toe with my owner in the browser, how do I get their moves", /^interfaces/],
		["my page server ends with listen EPERM", /^interfaces#the-steps/],
		["WebSocket connection failed: Establishing a tunnel via proxy server failed", /^(operations#problems|interfaces#the-steps|mcp#)/],
		["my page cannot reach its websocket server on another port in the browser", /^(operations#problems|interfaces#the-steps|mcp#)/],
		["I installed the mac app, how do I use my ChatGPT or Claude subscription with it", /^desktop#the-first-start/],
		["the app says the browser for the web tools is not on this Mac", /^(desktop#the-first-start|desktop#settings|operations#problems)/],
		["my agent says its model cannot answer because the claude command is missing", /^(desktop#the-first-start|operations#problems)/],
		["try the beta before it is released", /^operations#trying-a-version-before-it-is-released/],
		["code sign the mac app with my apple developer certificate and notarize it", /^desktop#packing-and-signing/],
		["use the app with pine running on my server over ssh", /^desktop#environments/],
		["switch the window between the pine on my laptop and the one on a remote machine", /^desktop#environments/],
		["open the terminal ui on the pine running on my server, from my laptop", /^(tui#the-pine-of-another-machine|operations#commands\/pine---ssh)/],
		["voice input does not work on linux", /^tui#dictating-a-message/],
		["how many tokens per second does my model make, and how fast does it process the prompt", /^tui#(how-fast-the-model-is|what-a-model-thinks)/],
		["how do I give an agent its own colour", /^(setup#(changing-and-removing-an-agent\/color|changing-and-removing-an-agent|creating-an-agent)|configuration#.*color)/],
		["my owner wants an agent deleted together with its folder", /^(setup#(changing-and-removing-an-agent|the-main-agent-administers-pine|the-tools)|pine#if-you-are-an-agent-running-inside-pine)/],
		["give another agent a different model and let it read a folder", /^setup#(changing-and-removing-an-agent|the-main-agent-administers-pine|the-tools)/],
		["set up a schedule for another agent instead of for myself", /^setup#(the-main-agent-administers-pine|the-tools|who-can-set-up-what)/],
		["add a rule that wakes an agent only when the door opens while nobody is home", /^(events#|setup#routes)/],
		["remove an agent from the command line", /^(operations#|setup#changing-and-removing-an-agent)/],
		["update an agent's settings from the command line", /^(setup#(the-main-agent-administers-pine|changing-and-removing-an-agent)|operations#commands)/],
		["my owner was asked to let me read a folder although I never asked for it", /^(security#(when-a-call-needs-something-outside|modes-how-much-an-agent-does-without-asking)|operations#problems)/],
		["ls says no such file for a folder in my owner's home that I wrote with ~", /^(security#when-a-call-needs-something-outside|operations#problems)/],
		["a command was refused a file it did not name, what happens then", /^security#when-a-call-needs-something-outside/],
		["how do I turn off the question pine asks itself when a command needs a folder outside the sandbox", /^(configuration#pine-json|security#when-a-call-needs-something-outside)/],
		["how do I see what the model was thinking before it answered", /^tui#what-a-model-thinks/],
		["the conversation is cluttered with tool calls, can they be collapsed so that I only see the answer", /^tui#the-tool-calls-of-a-turn/],
		["after the answer came the tool calls are gone and there is only one line, how do I see them again", /^tui#(the-tool-calls-of-a-turn|mouse)/],
		["a long message takes up the whole screen, can it be folded away", /^tui#folded-parts-of-an-answer/],
		["collapsible section in my answer that my owner can expand", /^(tui#folded-parts-of-an-answer|agents#)/],
		["the context window is nearly full, how do I shorten the conversation", /^tui#(commands|mouse)/],
		["save the conversation as a file", /^tui#commands/],
		["keep track of the steps of a long task so I do not lose my place", /^(setup#the-tools|tui#the-agent-s-list-of-steps)/],
		["let my owner choose between two options before I go on", /^(setup#the-tools|tui#when-the-agent-asks)/],
		["can the agent only propose what it would do, without changing any file yet", /^(tui#modes|security#|configuration#)/],
		["how do I point the agent at one file and a few lines of it", /^tui#pointing-at-a-file/],
		["tell me with a sound when the agent has finished", /^tui#commands/],
		["open the browser so my owner can see it and log in", /^mcp#seeing-the-browser/],
		["is the browser headless", /^mcp#(seeing-the-browser|bundled-browser)/],
		["remind me every morning at seven", /^events#(ask-the-agent|in-the-files|schedules)/],
		["cron job", /^(events#|operations#coming-from-openclaw)/],
		["set a reminder in 20 minutes", /^events#ask-the-agent/],
		["bashTimeoutSec", /^configuration#.*bashtimeoutsec$/],
		["bashtimeoutsec", /^configuration#.*bashtimeoutsec$/],
		["add_schedule", /add-schedule$|^events#ask-the-agent/],
		["who may set something up for all agents", /^setup(#who-can-set-up-what|#three-scopes)?$|^sources#ask-the-agent$/],
		["where do passwords and tokens go", /^sources#secrets|^configuration#secrets/],
		["watch a website for a price", /^source-types#http$/],
		// The types beyond the everyday ones, asked for by what they are for.
		["which kind of source do I need for a service or a device", /^source-types#(which-type-for-what|which-type-for-which-service|source-types)/],
		["tell my owner when a project on github publishes a new release", /^source-types#(feed|which-type-for-which-service)/],
		["rss", /^source-types#(feed|which-type)/],
		["be told when somebody adds or moves an appointment in a shared calendar", /^source-types#calendar/],
		["remind my owner ten minutes before a meeting from their calendar", /^(source-types#(calendar|which-type-for-what|what-there-is-no-type-for)|events#)/],
		["the price is inside a span with a class, how do I watch just that", /^source-types#(one-element-of-a-page|http)/],
		["the price only shows up after the page has loaded, and the source finds nothing", /^source-types#(a-page-that-a-script-fills-in|http|one-element-of-a-page)/],
		["watch a website that is built with javascript", /^source-types#/],
		["only wake me when the price is below 500", /^(source-types#(an-amount-as-a-number|http)|sources#being-woken-only-for-what-counts)/],
		["the api wants a POST with a graphql query", /^source-types#(several-fields-and-an-address-that-is-asked-with-post|http)/],
		["get push notifications from ntfy into an agent", /^source-types#(stream|what-a-stream-reaches|which-type-for-which-service)/],
		["a websocket that needs a login message after connecting", /^source-types#(stream|what-a-stream-reaches)/],
		["receive github webhooks on a machine that has no public address", /^(source-types#(stream|what-a-stream-reaches|which-type-for-which-service|webhook)|events#webhooks)/],
		["tell me when my boss writes in slack", /^source-types#slack/],
		["how do I call pine from my phone by writing /pine and a request", /^sources#summoning-pine-from-somewhere-else/],
		["ping an agent by name from a message so that it takes the request", /^sources#summoning-pine-from-somewhere-else/],
		["move a summon into one of my ongoing conversations", /^(sources#summoning-pine-from-somewhere-else|desktop#)/],
		["can /pine #todo go straight into my todo conversation", /^(sources#summoning-pine-from-somewhere-else|configuration#)/],
		["how do I call you from twitter?", /^source-types#x\b/],
		["can I summon an agent from a DM on X with a tweet-like message", /^source-types#x\b/],
		["what does it cost to read my twitter DMs", /^source-types#x\b/],
		["I replied to a tweet with /pine kevin, will kevin see the tweet I answered?", /^source-types#(x\b|reading-more-of-a-dm-conversation-or-a-thread)/],
		["the summoned agent wants to see more of the twitter thread above my reply", /^(source-types#(reading-more-of-a-dm-conversation-or-a-thread|x\b)|sources#reading-through-a-source)/],
		["a slack message refers to something said earlier in the thread, how do I see what", /^(source-types#(reading-what-was-written-before|slack)|sources#reading-through-a-source)/],
		["can I read the history of a slack channel or a direct conversation", /^(source-types#(reading-what-was-written-before|slack)|sources#reading-through-a-source)/],
		["read_source", /read-source$|^sources#reading-through-a-source|^source-types#reading-what-was-written-before/],
		["be told when somebody writes to me personally or tags me in slack", /^source-types#slack/],
		["wake me only for slack messages that mention me, not for the others", /^(source-types#slack|sources#being-woken-only-for-what-counts)/],
		["which scopes does the slack app need and what is the xapp token", /^source-types#slack/],
		["my laptop was asleep, did I miss slack messages that were written meanwhile", /^source-types#(after-a-time-without-a-connection|slack)/],
		["slack was disconnected for a while, is what came in during that time complete or incomplete", /^source-types#(after-a-time-without-a-connection|slack)/],
		["messages in an encrypted matrix room do not arrive", /^source-types#matrix/],
		["discord closes the connection, something about message content intent", /^source-types#discord/],
		["tell me when an email from my bank arrives", /^source-types#(mail|which-type)/],
		["does watching my inbox mark messages as read", /^source-types#mail/],
		["my NAS can only send email notifications", /^source-types#(smtp|which-type-for-which-service)/],
		["get the log of my router or firewall", /^source-types#(syslog|which-type)/],
		["my camera detects a person, can it tell pine without uploading a picture", /^source-types#(onvif|which-type)/],
		["read the power of my solar inverter over the network", /^source-types#(modbus|which-type)/],
		["my arduino prints temperatures over usb, can pine read them", /^source-types#(serial|which-type)/],
		["is my phone at home", /^source-types#(presence|which-type)/],
		["do something when the laptop is unlocked or runs on battery", /^source-types#(system|which-type)/],
		["follow a log file and wake me for every line that says error", /^source-types#(following-a-command-that-keeps-running|command|which-type)/],
		["docker events", /^source-types#(following-a-command-that-keeps-running|which-type)/],
		["perMinute", /perminute$/],
		["can the agent write an email, and to whom", /^source-types#mail/],
		["my mailbox is at outlook.com and the password is refused", /^source-types#(mail|a-microsoft-mailbox-signing-in-instead-of-a-password|which-type-for-which-service)/],
		["sign in to an Outlook mailbox", /^source-types#(a-microsoft-mailbox-signing-in-instead-of-a-password|mail)/],
		["clientId", /clientid$|^source-types#a-microsoft-mailbox/],
		["the camera uploaded a video and I cannot open the file", /^sources#files-a-source-received$/],
		["why is the clip not shown to me like the picture", /^(sources#files-a-source-received|source-types#ftp)$/],
		["access to uploads in pine's data folder blocked", /^sources#files-a-source-received$|^security#/],
		["run a command again and again to check disk space", /^source-types#command$/],
		["device with its own protocol new kind of source", /^sources#(a-source-type-of-your-own|ask-the-main-agent)/],
		["what counts as outside content", /^security#|^sources#trust|^configuration#pine-json\/security-taint/],
		["approval dialog always allow in this conversation", /^(security#4|tui#approvals)/],
		["write down how to do something as a skill", /^agents#(skills|ask-the-agent)/],
		["sub-agents in parallel", /^agents#sub-agents/],
		["run a helper on a different model than my own", /^agents#sub-agents/],
		["give a sub task to a bigger model with more reasoning", /^agents#sub-agents/],
		["can a sub-agent ask my owner for permission", /^(agents#sub-agents|security#)/],
		["which models can I use", /^(setup#|agents#sub-agents)/],
		["hand work to another agent", /^agents#handing-work-to-another-agent/],
		["open a project folder for a conversation", /^coding#a-folder-for-a-conversation/],
		["the agent messed up my files with its last change, how do I get them back the way they were", /^coding#(taking-a-message-back|what-is-restored)/],
		["revert what the agent just did and ask again differently", /^(coding#(taking-a-message-back|what-is-restored)|tui#commands\/undo)/],
		["/redo", /redo$/],
		["can I fork a chat to try something else without losing the original", /^(agents#branching-a-conversation|tui#.*branch|desktop#)/],
		["try a second way from an earlier point of the conversation without losing the first", /^agents#branching-a-conversation/],
		["/branch", /branch/],
		["two conversations working on the same repository at the same time without getting in each other's way", /^coding#a-worktree-for-a-conversation/],
		["my sub-agents overwrite each other's files when they change the same project", /^(agents#sub-agents|coding#a-worktree)/],
		["merge the work of a worktree back into main", /^coding#(a-worktree|merging)/],
		["/worktree", /worktree/],
		["what is manual auto bypass mode", /^(security#modes|tui#modes)/],
		["mqtt publish to a device", /^(source-types#mqtt|sources#sending-through-a-source)/],
		["poll failed looks back off", /^source-types#looking-again-and-again/],
		["create a new agent", /^(setup#creating-an-agent|agents#creating-an-agent)/],
		["what happens when a conversation is removed", /^(setup#|tui#|agents#sessions)/],
		["connect an mcp server", /^(mcp#|setup#)/],
		["which mcp servers do you have", /^(setup#the-tools|setup#what-an-agent-has|mcp)/],
		["list what I have been given", /^setup#what-an-agent-has/],
		["the server shows as connected but the agent says it does not have its tools", /^(mcp#|setup#the-tools)/],
		["the tool gave a file path but cp says no such file or directory", /^mcp#files-and-pictures-from-a-remote-server$/],
		["copy the file a remote mcp server made into my workspace", /^(mcp#files-and-pictures-from-a-remote-server|setup#the-tools)/],
		["play audio so that I can hear it", /^(tui#|agents#)/],
		["can pine play speech or music", /^(tui#|agents#)/],
		["the animated waveform next to a sound does not show for my mp3", /^(tui#pictures|stack#)/],
		["what do the moving bars beside a playing sound mean", /^tui#pictures/],
		["does the mac app start a voice message from the agent by itself, or do I have to click it", /^desktop#a-sound-in-an-answer/],
		["how do I stop audio that keeps playing in the desktop app", /^desktop#a-sound-in-an-answer/],
		["can I use my VS Code color theme in the app", /^desktop#themes/],
		["how do I make the app light instead of dark", /^desktop#themes/],
		["set a different color scheme", /^desktop#themes/],
		["install a local mcp server with npx command", /^(mcp#adding-a-server|setup#the-tools)/],
		["look at my dev server on localhost in the browser", /^mcp#local-addresses$/],
		["click a button in an application on my mac", /^(computer|mcp#bundled-computer)/],
		["control the desktop and use native programs", /^(computer|mcp#bundled-computer)/],
		["read what a window of TextEdit shows as text", /^computer#(two-ways-to-work|the-tools)/],
		["app_click", /^computer#the-tools\/app-click$/],
		["macos does not let pine operate apps accessibility permission", /^computer#(what-macos-has-to-be-told-once|when-something-does-not-work)/],
		["screen recording permission for screenshots", /^computer#(what-macos-has-to-be-told-once|when-something-does-not-work)/],
		["why does my agent not have the tools to operate apps", /^computer#(who-has-it|when-something-does-not-work)/],
		["how often am I asked before the agent uses an app", /^(computer#what-the-owner-is-asked|security#)/],
		["model cannot see pictures leave out screenshot tools", /^computer#options/],
		["app control on linux", /^(computer|mcp#bundled-computer)/],
		["swift compiler missing xcode command line tools", /^computer#(the-helper-and-what-it-needs|when-something-does-not-work)/],
		["kill operation not permitted cannot stop dev server it started", /^(operations#|security#the-whole-account)/],
		["let the agent work in my other projects and home folder", /^(security#(the-whole-account|3)|configuration#.*scope)/],
		["does the agent lose access to my files after reading a web page", /^(security#|tui#modes)/],
		["why am I asked before the agent runs sudo or a force push", /^(security#(what-asks-you|modes)|tui#modes|operations#problems)/],
		["the agent wants to send a telegram message after a web search and I am asked", /^(security#(what-asks-you|4-taint-and-approvals)|sources#|operations#problems)/],
		["which model decides whether a goal is met", /^(configuration#.*defaults-judge$|agents#goal-mode)/],
		["defaults.mode", /^configuration#.*defaults-mode$/],
		["change another agent's personality and how it sounds", /^(setup#changing-and-removing-an-agent|agents#the-files-an-agent-keeps-itself)/],
		// The mode is what says whether an agent works in a sandbox: asked by somebody who does not know that.
		["switch the sandbox off for an agent", /^(security#(3-the-sandbox|modes)|configuration#containment\/(mode|sandbox)|tui#modes)/],
		["which mode keeps an agent inside its own folders", /^(security#(3-the-sandbox|modes)|tui#modes)/],
		["give another agent my whole account like the main agent has", /^(setup#changing-and-removing-an-agent|security#(the-whole-account|modes|3-the-sandbox)|tui#modes|computer#who-has-it)/],
		["can an agent read pine's .env or token when it has no sandbox", /^security#(the-whole-account|pine-s-own-files-without-a-sandbox)/],
		["pine in docker without a sandbox what happens to the agents", /^(operations#in-a-container|security#(3-the-sandbox|on-linux))/],
		["which servers did the agent leave running and how do I stop them", /^(coding#what-an-agent-left-running|coding#the-code-pane|setup#the-tools|pine#if-you-are-an-agent-running-inside-pine)/],
		["stop_program", /stop-program$/],
		["run a long build without waiting for it to finish", /^coding#commands-in-the-background/],
		["run a command async and be notified when it finishes", /^coding#commands-in-the-background/],
		["command takes longer than the time limit", /^coding#commands-in-the-background/],
		["background", /^coding#commands-in-the-background\/background$/],
		["mcp server needs an api key", /^(mcp#adding-a-server|setup#the-tools)/],
		["a preference for a tool that only one agent should have", /^agents#(where-a-default-or-a-preference-goes|what-holds-for-all-agents|the-files-an-agent-keeps-itself|every-file-that-is-read-as-instructions)/],
		["which markdown files are read into an agent's prompt", /^agents#(every-file-that-is-read-as-instructions|what-an-agent-sees|the-files-an-agent-keeps-itself)/],
		["the difference between the TOOLS.md in pine's home and the one in my workspace", /^agents#(where-a-default-or-a-preference-goes|what-holds-for-all-agents|the-files-an-agent-keeps-itself|every-file-that-is-read-as-instructions)/],
		["the list of steps still says 0 of 6 done although the work is finished", /^(tui#|setup#the-tools)/],
		["the agent wrote a link to the sound file instead of playing it", /^(mcp#files-and-pictures-from-a-remote-server|tui#)/],
		["set a default voice for all agents", /^agents#what-holds-for-all-agents/],
		["a preference that every agent should follow", /^agents#what-holds-for-all-agents/],
		["is there a global instructions file injected into all agents", /^agents#(what-holds-for-all-agents|the-files-an-agent-keeps-itself)/],
		["global AGENTS.md", /^agents#(what-holds-for-all-agents|the-files-an-agent-keeps-itself)/],
		["where do I write which voice to speak with by default", /^agents#(what-holds-for-all-agents|where-a-default-or-a-preference-goes)/],
		["my owner told me a preference for a tool, which file does it go into", /^(agents#(what-holds-for-all-agents|where-a-default-or-a-preference-goes)|pine#if-you-are-an-agent-running-inside-pine)/],
		["cannot write MEMORY.md holds agent instructions outside content", /^(security#(4-taint-and-approvals|what-asks-you)|agents#)/],
		["new mcp tools not visible need a new chat", /^(mcp#adding-a-server|setup#)/],
		["browser refused not reachable local address", /^(mcp#local-addresses|operations#)/],
		// The first words of agents that knew nothing about pine, from runs with puzzles.
		["stretch reminder working days 6 pm recurring", /^events#ask-the-agent/],
		["nag stretch 6 pm every working day reminder", /^events#ask-the-agent/],
		["telegram stranger unknown sender bot owner connected", /^source-types#telegram$/],
		["one-off reminder missed pine not running startup", /^events#(ask-the-agent|in-the-files)/],
		["watcher all agents main agent", /^setup#(who-can-set-up-what|three-scopes)|^sources#ask-the-agent/],
		["shell command timeout default seconds per agent", /^configuration#/],
		["skill single conversation location on disk", /^(setup#what-is-written|agents#)/],
		["code pane open terminal columns beside conversation", /^coding#the-code-pane/],
		["web address watch failed checks unreachable down up", /^source-types#http/],
		["pine schedules list scheduled command", /^(operations#commands|events#ask-the-agent)/],
		["shell command list every skill list scheduled tasks", /^operations#commands/],
		["conversation removed renamed sources set up for one conversation", /^setup#(three-scopes|what-is-written|conversations-and-tabs)/],
		["sub-agents helpers run at the same time default concurrency", /^(agents#sub-agents|configuration#working-with-other-agents)/],
		["model runs agent no model named default model", /^configuration#/],
		["notify owner phone message away push", /^(source-types#telegram|sources#sending-through-a-source)/],
		["autonomy levels without asking", /^(security#modes|tui#modes)/],
		["drag folder onto terminal window drop", /^(coding#a-folder-for-a-conversation|tui#attachments)/],
		// Goal mode, asked for by somebody who does not know what it is called.
		["make the agent keep working by itself until the job is finished without me saying go on", /^(agents#goal-mode|tui#goals)/],
		["work autonomously towards an objective overnight", /^(agents#goal-mode|tui#goals)/],
		["the agent stops after each step and asks shall I go on", /^(agents#goal-mode|tui#goals|operations#problems)/],
		["who checks whether the objective is reached", /^(agents#goal-mode|tui#goals)/],
		["/goal", /^(agents#goal-mode|tui#goals|tui#commands\/goal)/],
		["limits.goalRounds", /^configuration#.*limits-goalrounds$/],
		["limits.goalIdleRounds", /^configuration#.*limits-goalidlerounds$/],
	];
	const missed = cases.filter(([q, want]) => !top(q).some((id) => want.test(id))).map(([q]) => `${q} → ${top(q).join(", ")}`);
	assert.deepEqual(missed, []);

	// A row answers by itself; a section with the sentence that matched.
	const key = manual.search("bashTimeoutSec").hits[0];
	assert.match(key.line, /`bashTimeoutSec` · Default: from `defaults` · Meaning: Longest shell command\./);
	assert.match(manual.search("looking again failed look").hits[0].line, /failed look/i);
	// Nothing found is said as what it is, and never as "pine cannot".
	assert.match(showSearch(manual, ["zzzqqq"]), /nothing in the manual has these words\. That does not mean pine cannot do it/);
	assert.equal(manual.search("the of and").hits.length, 0);
	// Reading: a part in full with what lies below it, a long one in pages, a wrong id with what is close.
	const read = showRead(manual, ["source-types#telegram"]);
	assert.ok(read.startsWith("## source-types#telegram   (source-types.md › The types › telegram)") && read.includes("six-digit code"));
	assert.match(showRead(manual, ["configuration#tools-and-extensions/bashtimeoutsec"]), /\(This is one row of a table in configuration#tools-and-extensions\. Read that part for what stands around it\.\)$/);
	assert.match(showRead(manual, ["sources"]), /Parts below this one: sources#a-first-example, sources#configuring-sources/);
	const long = createManual(partsOf("long", `# Long\n\n${Array.from({ length: 300 }, (_, i) => `Paragraph ${i} of a long part.\n`).join("\n")}`));
	assert.match(showRead(long, ["long"]), /^## long   \(long\.md › Long, page 1 of 2\)[\s\S]*\(continues: read long@2\)$/);
	assert.match(showRead(long, ["long@2"]), /page 2 of 2\)[\s\S]*Paragraph 299 of a long part\.$/);
	assert.match(showRead(manual, ["telegram"]), /^## source-types#telegram/, "the last piece of an id is enough when it is the only one");
	assert.match(showRead(manual, ["source-types#telegramm"]), /"source-types#telegramm" is not a part of the manual\. Close to it: [^\n]*source-types#telegram/);
	assert.match(manual.contents(), /^pine: pine\n[\s\S]*\nsources: Event sources and subscriptions\n    sources#a-first-example/);
});

test("manual: every agent has it as a tool instead of a skill in its prompt, and pine manual is the same search in a shell", async () => {
	const h = await harness({ pine: { main: "main", sourceTypes: { bell: "./sources/bell.ts" } }, files: { "sources/bell.ts": `export const type = { summary: "a doorbell on the network", options: { type: "object", properties: { url: { type: "string", description: "its address" } }, required: ["url"] } };\nexport default function () {}\n` }, agents: { main: {} } });
	const call = (args: any) => ({ name: "manual", args });
	await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call({ search: "telegram pairing code" }), call({ search: ["doorbell", "bashTimeoutSec"] }), call({ read: "source-types#telegram" }), call({})] }]), trust: "owner" });
	const [one, two, read, all] = h.toolResults().slice(-4);
	assert.match(one, /^"telegram pairing code": \d of \d+ parts, the best first\n1\. source-types#telegram /);
	assert.match(two, /"doorbell": [^\n]*\n1\. source-type#bell   \(this pine › bell, registered in this pine\)\n   `bell`: a doorbell on the network · Options: url \(required\): its address/, "what this installation has beyond the manual is found too");
	assert.match(two, /"bashTimeoutSec": [^\n]*\n1\. configuration#/);
	assert.ok(read.startsWith("## source-types#telegram") && all.startsWith("The parts of pine's manual."));
	const req = h.mock.state.requests[0];
	assert.ok(h.toolsOffered(req).includes("manual"));
	assert.ok(!h.system(req).includes("<name>pine</name>"), "the manual is not carried in the prompt");
	assert.ok(h.system(req).length < 9000, `the fixed part of a prompt stays small: ${h.system(req).length}`);
	await h.close();

	const found = await run(process.execPath, [CLI, "manual", "telegram", "pairing"]);
	assert.match(found.stdout, /^"telegram pairing": \d of \d+ parts, the best first\n1\. source-types#telegram /);
	const part = await run(process.execPath, [CLI, "manual", "--read", "source-types#telegram"]);
	assert.ok(part.stdout.startsWith("## source-types#telegram"));
});
