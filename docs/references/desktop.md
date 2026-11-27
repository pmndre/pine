# The Pine app

**Pine** is pine's app with a window, for macOS, Linux and Windows. This chapter is its user's
guide: getting it, the window and its tabs, the side panel with files, terminal and browser, the
view, Settings, the pine of another machine, and browser access for a phone.

The app does what the terminal UI does (conversations in tabs, the work of each turn, approvals)
and adds an editor, a terminal, a settings panel, pictures, video and sound, menus and system
notifications. It is a client of the daemon: a conversation in the app is the same one the
terminal UI or Telegram shows. How the app is built, packed and tested is in
[dev/desktop.md](../dev/desktop.md).

## Getting it

The app is attached to pine's releases: <https://github.com/pmndre/pine/releases/latest>

| File | For |
|---|---|
| `Pine-<version>-arm64.dmg` | A Mac with Apple silicon |
| `Pine-<version>-x64.dmg` | A Mac with an Intel processor |
| `Pine-<version>-x86_64.AppImage`, `Pine-<version>-arm64.AppImage` | Linux, any distribution: one file that runs where it lies (`chmod +x` it first) |
| `Pine-<version>-amd64.deb`, `Pine-<version>-arm64.deb` | Debian and Ubuntu: `sudo apt install ./Pine-<version>-amd64.deb`, into `/opt/Pine`, started as Pine from the list of apps |
| `Pine-<version>-x64-setup.exe`, `Pine-<version>-arm64-setup.exe` | Windows 10 and 11: an installer for your user alone (no administrator), into `%LOCALAPPDATA%\Programs\Pine` or a folder you choose |

On a Mac, open the image and drag Pine into Applications. It needs macOS 13.5 or later. Nothing
else has to be installed: no Node, no `npm install`, no developer tools. The app carries pine
itself (the same version as the app), the Node it runs on, and pine's helpers for dictation, app
control and the `system` event source. It can also give your shell the `pine` command (see "`pine`
in a terminal").

With Homebrew (this repository is its own tap; a cask named `pine` is another program):

```bash
brew tap pmndre/pine https://github.com/pmndre/pine
```

```bash
brew install --cask pmndre/pine/pmndre-pine
```

Install it by its full name: Homebrew refuses a cask from another tap (`brew install --cask
pmndre-pine` alone) until you trust it with `brew trust`. The app updates itself, so `brew upgrade`
leaves it alone. `brew uninstall --zap --cask pmndre-pine` also removes the app's files under
`~/Library`, never pine's home (`~/.pine`).

Android phones and iPhones have an app of their own in the same release, which pairs with this
computer (see "Browser access" and [mobile.md](mobile.md)).

### A newer version

On a Mac the app updates itself: it downloads a newer release in the background and installs it
only when you say so (**Restart to update**, or at the next quit). It never restarts by itself.
On Linux and Windows it says that there is a newer one and opens the release's page: download the
new file, quit Pine and put the new app in place of the old one (on Windows, run the new
installer). An AppImage can also be updated in place with AppImageUpdate or Gear Lever. Your pine
home (`~/.pine`) is not in the app and stays as it is.

| | |
|---|---|
| At the start | The app asks GitHub once for pine's last release. A newer one is downloaded without a dialog; the foot of the side bar says **Downloading Pine <version>…**, then **Restart to update** |
| `Restart to update` | At the foot of the side bar, in Settings > General and in the dialog of **Check for Updates…**. Every pine this app started is stopped first and started again by the new app. A pine the app only attached to (started in a terminal or at login) is left alone: restart it yourself. While agents work it warns how many conversations would be cut off: **Restart now**, **Restart when they are done** or **Cancel** |
| `Restart when they are done` | **Restarts when the work is done** stays at the foot of the side bar until then. Click it, or **Call off the wait** in Settings > General, to call it off |
| `Check for Updates…` | In the **Pine** menu (Help elsewhere), and `updates` in the palette: asks again now |
| Settings > General | The version and whether it is the latest, **Check now**, **Check for updates at start**, and **Update automatically** (on unless you turn it off) |
| `Pine <version> is available` | Said instead when the app does not update itself: **Update automatically** is off, or the download or install failed. A click opens the release's page |

A release counts as newer once its file for your system is attached, some minutes after pine
itself is published. A preview of pine is never offered. An app run from the disk image or from a
folder it cannot write cannot replace itself: it says so (move it to Applications). `pine update`
in the app's pine says that the app updates itself.

### The first start

| What the app finds | What it does |
|---|---|
| No pine home | It offers to set pine up (`pine init`): the example home is copied and the browser is fetched (about 600 MB, once). On Linux the sandbox needs an administrator (bubblewrap, sometimes an AppArmor rule): the app shows the commands to run in a terminal, then **Try again**. Until then pine works without the sandbox |
| The welcome | The app opens on the main agent's own conversation, which begins with pine's welcome: the main agent is pine's administrator and the one to ask; make an agent for each purpose (coding, work, automation, chat); the first conversation is kept and others are cleared after a while unless pinned; what pine is for (chatting, code, a folder, acting on events); a prompt to try (one that watches the Downloads folder); and where pine keeps everything. pine wrote it, and it is never sent to a model |
| Nothing to answer with | The app opens **Setup Pine** (below) whenever the main agent has no model that answers. The main conversation shows **Connect a model first**, with **Set up a model…**; another agent's card says the same. Settings > Models lists every agent that cannot answer, and why. A message sent meanwhile says so: send it again once a model is there |
| A sign-in in Settings > Models | A Claude, ChatGPT or Copilot subscription is signed in to through the browser (**Sign in**), any provider with an API key. When the model in force cannot answer, pine switches to the provider's usual one and says which, with **Another one…**. Otherwise the dialog offers **Choose the model your agents run on**. It is kept as `defaults.model`, with **Change** |
| The first message | No agent writes first. Each agent introduces itself once, in its answer to your first message to it; `defaults.introduce` turns it off ([agents.md](agents.md), "Meeting an agent") |
| The browser of the web tools is missing | Each version of pine drives a browser build of its own. The app asks once per version whether to fetch it; Settings > General shows whether it is there, with **Fetch it** (`pine browser-install`). Until then the browser tools do not work; web search and reading a page do |

### Setup Pine: getting started

**Setup Pine** is where pine is set up and the one place to connect a model. It is a
conversation of the main agent, `setup`, pinned in the side bar. The app opens it in front after
pine was set up and whenever the main agent has no model that answers (a new home, a sign-out, a
model server removed). It works the same in the Pine app, the mobile app and the web client.

Until a model answers, the steps are pine's own: question cards above the input, drawn from what
pine knows (your sign-ins, your model servers). No model reads them and nothing of them is kept;
reload and they are drawn again, with the steps that are done shown as done.

Typing works before any model does: what you send picks the open card's option whose name it is,
in any case ("a subscription", "claude"). Anything else gets one line from pine, "There is no
model yet to answer that. Pick one of the options, or type its name: what each one means is in
its description.", and goes nowhere. While the field for an API key is open, what you type in the
input is neither shown nor kept: paste the key into the card's field. Once a model answers, the
input sends ordinary messages again.

| Step | What it asks |
|---|---|
| How should your agents run? | **A subscription** (recommended: Claude, ChatGPT or GitHub Copilot, signed in to in your browser), **An API key**, or **A model on this computer** |
| Which subscription? | Claude, ChatGPT or GitHub Copilot. **Back** returns to the first question |
| Which server? | What pine found on this computer's usual ports (llama.cpp, Ollama, LM Studio, **Pinecone**), and **Another address**. A server that wants a key asks for it in a secret field; one that does not say its context size asks for it. See [setup.md](setup.md), "A model server on this computer" |
| The sign-in | The provider's page opens in your browser (**Open the sign-in page again**), with a code to enter there and **Copy** when the provider gives one. **Cancel** brings the first question back. Nothing typed there reaches a model |
| Which provider? | With **An API key**: Anthropic, OpenAI, Google Gemini, OpenRouter, xAI, and **Another…**, a searchable list of every provider ("kimi", "grok") |
| Your API key for … | A field of its own: the key is not shown, goes to the sign-in with **Save**, and is stored in `auth.json` in pine's home, where no agent reads it. The conversation says only **Key saved for …**. A refused key says why, with **Try again** |
| Your agents run on … | Which model your agents now run on. **Keep this model?**: **Go on**, or **Choose another model** |
| What would you like to set up now? | The card **Next**, every item optional: **The mode**, **A working folder**, **Telegram**, **A first agent**, **The theme**, and on a Mac **Pinecone**. **Send** sends a message with one line per item, and the main agent takes each in turn. **Nothing for now** opens the main conversation; the card comes back at the next start until something is said in Setup Pine |

### `pine` in a terminal

If you installed only the app, your shell has no `pine` command until the app puts one there.
With it, everything in [commands.md](commands.md) works in a terminal: the terminal UI,
`pine status`, `pine agent add`. It runs the app's pine on the app's Node.

| When | What happens |
|---|---|
| The first start of the app from Applications (Mac), or from the .deb (Linux) | A link is made where that needs no password: `~/.local/bin` or `~/bin` if your PATH has one, else `/usr/local/bin` (or `/opt/homebrew/bin` on a Mac) if you may write there |
| No such folder | **Pine > pine in a Terminal…** or Settings > General sets it up in `/usr/local/bin`, asking for your password (`pkexec` on Linux; without it, Settings shows the `sudo` command to type) |
| Your shell already has a `pine` (npm, a checkout) | It is left alone, and Settings says where it is. The app still runs its own |
| The app runs from the disk image or Downloads (Mac) | Nothing is set up: move it into Applications first |
| The app was moved | The old link leads nowhere: set it up again in Settings > General |
| Linux, an AppImage | The link leads to the AppImage file. Put the AppImage where it is to stay first |
| Windows | Nothing to set up: the installer puts the app's `pine.cmd` on your user's PATH, and uninstalling takes it out. Open a new terminal after installing. Settings > General says whether another pine comes first on the PATH |

Settings > General shows where the command is, with **Remove** for the app's link. Only a link the
app made is ever removed or replaced.

## The daemon: started or reused

You do not have to start pine first: the app asks `pine service` ([commands.md](commands.md), "A
UI of its own") for the daemon of your home.

| What it finds | What happens |
|---|---|
| A pine runs for this home (started in a terminal, at login, by the terminal UI) | The app attaches to it; the side bar says `attached`. Quitting the app leaves it running |
| `An older pine runs` | The pine it attached to is older than the app's. Said at the foot of the side bar and in Settings > General, with both versions. Restart that pine on the newer version, or stop it and let the app start its own |
| Nothing runs | The app starts one, logging to `data/pine.log`; the side bar says `started here`. Quitting the app stops it cleanly. One that stops answering is started again |
| No pine home yet | A first screen offers to set pine up (`pine init`) |
| No Node, or no pine | A screen says what to install |

| Setting (Settings > General) | What it does |
|---|---|
| Keep pine running after the app quits | A pine the app started goes on when the app is closed: schedules fire, sources report, Telegram answers. `pine status` finds it; the next start of the app attaches to it |
| Home folder | Another pine home than `~/.pine`. Another home is another pine |
| Notifications | A system notification when an agent is done, fails, needs your approval or asks you something while the window is not in front, in pine's own words ("main is done"), never the agent's |

On a Mac, closing a window does not quit the app: it and a daemon it started stay until you quit
(`⌘Q`). On Linux and Windows closing the last window quits.

An app newer than the pine it attached to says so where a page needs something that pine does
not know yet: update pine and restart it.

## The window

The side bar at the left lists your agents and their conversations; the event log, Settings, the
Manual and whether pine answers are at its foot. Tabs hold conversations, Settings, the event log, the side
panel and the view. The side panel at the right holds the files, terminal and browser of a
conversation.

On Linux and Windows the tab bar reaches the top of the window and there is no menu bar: the menu
button (☰) at the right of the bar opens the same menus. The keys are the Mac's with `Ctrl` for
`⌘` (`⇧⌘T` is `Ctrl+Shift+T`), and the app writes them that way; where this chapter says `⌘`,
read `Ctrl` there. A folder dropped on the app's icon, or `Pine <folder>` in a terminal, opens a
conversation that works in it. The app's icon shows the number of conversations that wait for you.

**The side bar.** One line per agent with one conversation, a group for one with more. Under an
agent: its groups, then its own conversation (`main conversation`), pinned ones, then the rest by
last use or by name. Drag the side bar's edge to resize it; `⌘B` hides it.

| On an agent's line | What it does |
|---|---|
| A click | With one conversation: opens it. With more: folds its conversations away or shows them. A pulsing grey dot: the agent works; `!`: it waits for you; a dot: something new |
| `+` | A new conversation with that agent |
| The folder | Opens a folder of yours for a new conversation with that agent |
| The gear | That agent's page in Settings |
| A right click | New conversation, a folder, New Group…, Sort by Last Used or Sort by Name, **Rename**, **Color**, the settings, and **Remove** (not for the main agent), which asks whether to keep its folder. With one conversation, that conversation's entries come first |
| `+` beside "Agents" | A new agent: a dialog (name, instructions, model). Its conversation opens in a tab |

A conversation's right click in the side bar: Open, Pin, Rename, Branch, Move to Group…, Open in
New Window, Remove (Start over for an agent's own). An agent made or removed elsewhere (by the
main agent, `pine agent add`, the terminal UI) appears or goes within a few seconds.

**Groups of conversations** keep a long list tidy ([agents.md](agents.md#groups-of-conversations)).
New Group… is in the agent's right click. Drag a conversation onto a group to put it there, onto
the agent's line to take it out; its branches go along. Without a mouse: Move to Group…, or `Move
conversation to group` in the palette (`/group`). A group's right click has New Conversation,
Rename… and Remove Group…, which removes the group and every conversation in it for good after
you confirm.

**Tabs.** A tab shows a pulsing grey dot while the agent works, a dot when something new arrived,
`!` when it waits for you, `★` for a conversation kept for good. The `⌄` after a row's last tab
lists that row's tabs. Drag a tab to reorder it, into another group, or to another window. A
tab's right click: Close (`⌘W`), Close Others, Close to the Right, Close All, Split Right, Split
Down, Move to New Window, Pin or Unpin.

Closing a tab only closes the view: the conversation stays in the side bar with your unsent text.
With no tab open the window offers a new conversation, and `⌘W` again closes the window. A tab
that waits for your answer is never lost: Close Others and the like leave it open. An approval
that arrives with no tab open opens the agent's main conversation.

**With the keyboard.** Tab reaches an agent's line, a group's line, then its conversations; the
arrow keys move and Enter opens. A row of tabs is one Tab stop: the arrow keys move, Enter or
Space brings one to the front. The buttons on a side bar line (an agent's gear and folder, a
group's `+`, a conversation's remove) show while the pointer or the keyboard is on the line, and
always in a narrow window; each is a Tab stop right after its line. An agent's `+` always shows.

**A conversation.** An empty one shows who its agent is: what it is for, model and mode, whom it
hands work to, and how many skills, sources, schedules and MCP servers it has. Then come your
messages, the answers, and the work of each turn (tool calls, thoughts, sub-tasks) folded into one
line that a click opens. A `↳ … ↗` line opens a sub-agent's or delegated task's work in a tab.
Above your last message, **Take back** (`/undo`). Scrolled up, the view holds still, and a button
brings you back to the end. The line at the top says which conversation (`main / notes`), its
folder, and how full its context is (hover for the cache share and speed).

When you send, your message moves to the top and the answer is written below it. An agent set to
follow the answer ("When you send a message" on its page in Settings > Agents) keeps your message
at the end and follows the answer, as a terminal does.

**The input.**

| Key or part | What it does |
|---|---|
| `↩` | Sends. While the agent works, the message goes to that work; under it stands "not read yet" or "read 14:03", and **send now** stops the step under way so that the work reads it at once ([agents.md](agents.md#a-message-while-the-agent-works)) |
| `⌥↩` | Sends a message that waits its turn |
| `⇧↩`, `↑`, `esc` | A new line; earlier inputs; stops the agent |
| `/`, `@` | Commands; the folder's files |
| The bar under the input | `+` attaches files (or drop them: up to 10 of 20 MB each; a dropped folder is opened for the conversation), the microphone, the model, reasoning, mode, and where the conversation works. `outside content` shows once the conversation has read something from outside |
| The top right of the window | Buttons for the side panel (`⌥⌘B`) and the view (`⇧⌘O`): a click opens it, closes it, or brings it to the front of its group |

`⌘T` (or `+` at the end of the tabs) starts a conversation with the agent of the tab in front;
`⌘O` opens a folder for one; `⇧⌘T` always asks which agent. Where the tab in front has no agent
(Settings, the event log) and there are several, you are asked.

**A narrow window.** The window can be as narrow as a phone (360 pixels), to put it beside another
app. Below 1024 pixels one row holds every tab and the tab in front fills the window; widen it and
everything is back as it was.

| Window | Side bar | Side panel and view |
|---|---|---|
| 1024 pixels and wider | A column | Tabs in their groups |
| 768 to 1023 | A column | A sheet from the right, one at a time; `esc`, a click beside it or `×` puts it away |
| Narrower than 768 | A sheet from the left, by its button or `⌘B`; picking a conversation, `esc` or a click beside it puts it away | As above, the whole width below 640 pixels |

Settings narrower than about 720 pixels show the list of pages as a row along the top. Zoom with
`⌘+`, `⌘-` and `⌘0`.

### Groups of tabs

A window 1024 pixels and wider arranges its tabs in groups, as VS Code does: each group has its
row of tabs and shows one, side by side or one above another. The side panel and the view each
open in a group of their own at the right. To put two conversations side by side, Split Right.

| You do | What happens |
|---|---|
| Drag a tab onto another tab, or to the end of a row | It goes before or after it, or last, in that group |
| Drag a tab over a group | The middle puts it into the group, an edge into a new group on that side |
| Drag a tab to an edge of the window | A new group along that whole edge |
| Split Right, Split Down | In a tab's right click: the tab gets a group of its own beside or under it |
| Drag the edge between two groups | Resizes them (or Tab to it and use the arrow keys; a double click shares equally) |
| Click into a group | New tabs (`⌘T`) go there, and `⌃Tab` and `⌘1` to `⌘9` go through its tabs |
| Close a group's last tab | The group goes, and its neighbour takes its room |

The arrangement is the window's and is kept across restarts. A tab that moves keeps what it shows
(a conversation its place, the terminal its shell). The agent's `browser_show`, a port's link
under Running, and a link in an answer open the browser in the side panel.

### Multiple windows

Open as many windows as you need, on different machines or on the same pine. Each window has its
own tabs, groups and side bar.

| Action | How |
|---|---|
| Open a new window | `⌘N`, File > New Window, the Dock's New Window, or New window in the palette. A second window on the same pine starts with no tab open |
| Open another machine in a new window | **Open in new window** in Settings > Environments, or `⌘`-click in the machine menu |
| Move a tab or a conversation to a new window | **Move to New Window** in a tab's right click (with its unsent text, attachments, quotes and terminal), or **Open in New Window** in a conversation's right click in the side bar |
| Drag a tab out | Let a conversation's tab go outside every Pine window: it opens in a new window there |
| Drag a tab to another window | Onto its tabs, or onto a window with none. Only between windows on the same pine |
| Close a tab or window | `⌘W` closes the tab (the window when none is open); `⇧⌘W` closes the window |
| Quit and reopen | Quitting (`⌘Q`) keeps every window and restores them all. With every window closed, reopening opens one window on the last machine used |
| Notifications and badges | Go to the window that holds that conversation. The Dock or taskbar badge counts what waits for you on every machine |

### Finding a conversation

`⌘K` (or Search at the top of the side bar) is one box for everything:

| It finds | By |
|---|---|
| A conversation | Its name, and what was said in it, by you and the agent. Opened from a match, the words are marked (`↩` the one before, `⇧↩` the next) |
| An open tab, an agent, a settings page | Its name |
| A command | Its name, or what it does |
| A setting | Under In Settings, as Settings' own search does |

What was said is searched in the last thousand tasks of all agents; for an older message, open its
conversation and use `⌘F` there. A conversation with no name is called by the first thing you
said in it; Rename (right click, or `/rename`) gives it one.

### Quoting part of a conversation

Select text in the conversation, a sentence of an answer for example: a small bar offers **Quote**,
**Reply** and **Bookmark**.

- **Quote** puts it as a badge above the input (hover shows it, a click goes back to where it was
  taken, `×` removes it). Quote several pieces, or send quotes with no text of your own.
- **Reply** also opens a field under the badges for your reply to that quote; `↩` or `esc` closes
  it, and replies go with the message.

The agent reads each quote as a markdown quote (`> `) before your text, followed by its reply.
Quotes too long are cut (`…`), never your own text. A message you take back (`/undo`) gives its
quotes back.

### Bookmarks

**Bookmark** keeps the selected text as a bookmark of the conversation, for you alone: the agent
is not told. A conversation with bookmarks shows a bookmark button with their number beside its
title: a click on one goes to it, `×` removes it. Bookmarks follow a renamed conversation, go when
it is reset or removed, and a branch takes those of the messages it holds.

### Branches and worktrees

"Branch from here" in a right click on one of your messages makes a new conversation with what was
said up to the end of that turn; Branch in a conversation's menu in the side bar takes all of it.
The branch stands under its original in the side bar ("… · branch") until you rename it. The line
at the top of a conversation is a path: what it was branched from, then itself, then where it
works; a click on an earlier one opens it. What a branch takes along:
[agents.md](agents.md#branching-a-conversation).

A conversation can work in a worktree of its folder's repository, so that several conversations on
one project do not overwrite each other ([coding.md](coding.md#a-worktree-for-a-conversation)).
File > New Conversation in a Worktree… (`⌥⌘T`) starts one; Conversation > Worktree… moves the
conversation in front into one; "Branch from here into a worktree" and "Branch into a Worktree"
branch into one. Its header shows the branch (`pine/<name>`). A click on it, or Conversation >
Worktree…, offers merge, squash, update, ask the agent to commit, and discard. Changes in the side
panel says how many commits it is ahead.

### The terminal UI's commands in the app

Modes, goals, swarms, approvals, questions, the list of steps, sub-agents and `/undo` work as in
[tui.md](tui.md). A swarm is started with `/swarm` and the job, or Swarm in the palette; the line
above the input shows its round and whether the answer is being checked, with a pause button, and
Resume and Clear when it is paused. Its tasks are in the side panel's Board.

| In the terminal UI | In the app |
|---|---|
| `/model`, `/reasoning`, `/mode`, `/folder` | Also the bar under the input, and the Conversation menu |
| `/sessions`, the conversation list | The side bar |
| `/code` | The side panel (`⌥⌘B`) |
| `/mcp`, `/sources`, `/subscribe` | Also Settings > MCP servers and Settings > Events |
| `/attach <path>`, `/paste` | Drop files on the input, paste a picture, or `+` under the input |
| `/export` | Asks where to save the file |
| `/emit <topic> [json]` | The same; `/emit` alone or Publish… in the event log opens a form |
| `/voice`, `ctrl+r` | The microphone under the input, or `⌃R` |
| `/quit` | `⌘Q` |
| `shift+tab` (next mode) | The same, while the input is empty |
| `alt+1` … `alt+9` | `⌘1` … `⌘9`; `⌃⇥` is the next tab |

Everything is also in the menu bar with its key (off a Mac, in the ☰ menu), and `⌘F` finds text
in the conversation.

### When the agent asks you something

A question an agent asks with its `question` tool ([setup.md](setup.md)) is a card above the input
of its conversation, never a dialog that opens by itself. It shows the question and the answers
offered, each with its number and what it means; the agent's own pick is marked `recommended`. A
click, its digit or Space answers at once; the arrow keys and `↩` work too. A question with several
answers (`multiSelect`) is answered by ticking, then **Send**. The card takes the keyboard only
while the input is empty.

| | |
|---|---|
| **No answer** | Tells the agent there is none; it goes on with an assumption it names |
| **Later** | Puts the card away; the line above the input says a question waits, and **Open** (or `/approve`) brings it back |
| Typing instead | While the card is there, what you send answers it in your own words. That is how you answer a question with nothing to pick, or ask something back ("what is the difference?"): the agent answers and may ask again. A `/command` stays a command. If the question was answered elsewhere meanwhile (Telegram, another window), your words go as an ordinary message |
| Another conversation's question | Never answered from the tab in front: the line above the input says it waits, with **Go there** |

Once answered, the card folds into a line that says what was asked and what you answered. An
approval (a permission) opens a dialog.

A sign-in that asks you to choose (the main agent's `sign_in`, such as Amazon Bedrock's "Bearer
token" or "AWS profile") is the same card, with no `recommended` and no answer in your own words;
**No answer** stops the sign-in. What it then asks you to type (a key) opens the approval dialog
with its field.

### Dictating a message

The microphone in the bar under the input (or `⌃R`, `Ctrl+R` on Windows and Linux, or
`/voice [language]`) dictates the message. What is heard becomes text in the input until you send
it: `↩` ends the listening, `esc` throws away what was heard, and typing ends it too. It listens on
the computer the app runs on, also while the app uses another machine's pine. What is recognised,
on which system, and what to do when it does not work is in [tui.md](tui.md), "Dictating a
message"; where something is missing, the microphone says what to install. The phone apps have no
microphone in the bar.

### A sound in an answer

A picture an answer points at is shown, and a click enlarges it; a video gets the system's player.
An agent points at a sound file in its workspace the same way, `![caption](hello.wav)` (wav, mp3,
m4a, ogg or flac, up to 100 MB). The conversation shows a line with a play/pause button, bars, its
name, the time and length.

- A sound in an answer that arrives while you look at its conversation plays at once. Anything
  older waits for a click: nothing starts when you open a conversation or restart the app. Of
  several sounds in one answer the first plays.
- One sound plays at a time; starting another stops the first. A sound goes on while you look
  elsewhere in the app. To stop it, pause it in its line or start another. It ends with the app.
- The bars show the sound's loudness from low (left) to high (right) while it plays. A sound
  longer than ten minutes plays without bars.

| Unlike the terminal UI ([tui.md](tui.md), "Pictures") | |
|---|---|
| An aiff file, or a file that is not there | The line says "cannot be played here" |
| A sound at a web address | A line to click, `Load audio · https://…`; the daemon fetches it then |
| A sound file opened in the side panel's Files | The system's player, which does not start by itself |
| `▸ open in player` | Not in the app |

## The code panel and the editor

The side panel (`⌥⌘B`) works on the folder of the conversation last in front (the folder you
opened for it, else the agent's workspace). Put it beside the conversation to watch files change
while the agent works.

| View | Shows |
|---|---|
| Files | The folder as a tree, a search by name or content, and the editor. In a git repository changed and new files are colored as in Changes. See "Files" |
| Changes | **All changes**: what differs from the last commit, each file with its diff. **Last turn**: what your last message changed, with "Take back" (`/undo`); `/code turn` opens it |
| Output | The tool calls of the last messages, with everything they printed |
| Terminal | A shell of your own in the folder (`` ⌃` ``, View > Terminal, `/terminal`). See "The terminal" |
| Browser | The conversation's browser (`⇧⌘B`). See "The browser" |
| Agent | The agent: what it is for, its model, reasoning and mode (a click changes each), whom it hands work to, what is at work now, what it listens to, its schedules, skills and MCP servers, and its `MEMORY.md`, with buttons to the settings pages |
| Running | What the conversation's commands left running (a dev server): its ports as links (opened in the conversation's browser), its last output, and Stop. Shown while something runs; `/code running` opens it before that |
| Board | The conversation's board: see "The Board tab". Shown while there is one; `/code board` opens it before that |

While an agent keeps a list of steps, the open steps stand at the top of the panel.

### The Board tab

A board tracks a job that several work on at once: its tasks, who has each, what came of them, and
the notes they left ([boards.md](boards.md)). The tab appears when an agent starts one, with the
number of tasks not yet settled.

| On the tab | Meaning |
|---|---|
| A task | Its number, text and state: open, waiting for other tasks, being worked on (by a sub-agent or a named agent), done, failed, or "Waits for an answer". A click shows all of it, its result and its notes |
| "Waits for an answer" | Its worker needs a decision. The agent that gave out the work answers what it can; what is left is yours: answer on the line under the task, and the task is open again |
| The menu at a task's right | "Take it back" (its sub-agent is stopped and a new one takes it), "Open it again", "Mark as done", "Remove" |
| Notes | What workers found or decided, with who wrote it. "from outside content" marks a note by a run that had read outside content. Each has Remove |
| The line at the bottom | A task of your own. A running pool takes it; otherwise it waits for the agent |
| The list at the top left | Which board, where the conversation can use more than one |
| Clear | Removes the board and everything on it |

### Files

Select files in the tree or the search's results and rename, copy, move or delete them from a
right click, as in an editor. A click selects, a double click (or Enter) opens a file in the
editor; Shift-click selects a range, `⌘`-click adds or removes a row, `⌘A` selects every row shown.
A right click beside the rows is about the folder itself.

The search finds files by name; with the button at its right also by the words inside them (case
ignored; in a git repository the files git knows or would add, elsewhere all but what `.gitignore`
leaves out, never `node_modules`).

An agent's own files at the top of its workspace (`AGENTS.md`, `SOUL.md`, `TOOLS.md`, `MEMORY.md`)
have grey names: pine reads them as instructions, so they are edited and copied but never deleted,
cut or renamed, and a selection leaves them out. In a folder you opened, `AGENTS.md` is an
ordinary file.

| Entry | What it does | Mac | Windows, Linux |
|---|---|---|---|
| Open | Opens the file in the editor (or the player) | `↩` | Enter |
| Show in the Finder (Explorer, Files) | Shows it in the system's file manager, for a folder on this computer | `⌥⌘R` | Alt+Shift+R |
| New File…, New Folder… | Makes it in the folder (beside a file); `docs/notes.md` makes the folders on the way | | |
| Cut, Copy | Keeps the rows for Paste, and puts their paths on the clipboard | `⌘X`, `⌘C` | Ctrl+X, Ctrl+C |
| Paste | Copies or moves them here. A copy that would cover a name gets another (`notes copy.md`); such a move is refused. Only within the same conversation's folder | `⌘V` | Ctrl+V |
| Copy Path, Copy Relative Path | The paths on the clipboard, one a line | `⌥⌘C`, `⌥⇧⌘C` | Alt+Shift+C, Ctrl+Alt+Shift+C |
| Rename… | Asks for the new name | F2 | F2 |
| Delete | Asks first, then deletes for good (no trash) | `⌘⌫` | Delete |

**The editor.** A double click on a file (or "Edit" on a diff) opens it with line numbers,
colors, search (`⌘F`) and undo; `⌘S` saves. A file the agent changes while you look is shown anew;
if you typed meanwhile, the app says so and lets you take the new one. Files over 2 MB and binary
files are shown, not edited.

Saving and the file changes go through the daemon, which writes inside a sandbox that reaches only
that folder, so a link an agent planted there cannot lead your change elsewhere
([security.md](security.md)). On a system without a sandbox the daemon does not write, and the
app says so.

### The terminal

The Terminal view is a shell of your own, as in Terminal.app: your login shell (`$SHELL`) with
your environment, started in the conversation's folder (else the agent's workspace). Without
`$SHELL`: zsh on a Mac, your account's shell (else bash) on Linux, PowerShell on Windows. It is
not the agent's: no sandbox, no mode, no approvals. The agent sees nothing you type there.

| | |
|---|---|
| One per window and conversation | Starts when first shown and keeps running, with its scrollback, while its window stays on this computer. Moving the tab to another window takes the shell along |
| ↻ | Ends the shell and starts a new one. After `exit`, **Start it again** |
| When it ends | When its tab or window closes, the window switches to another machine, or Pine quits |
| Keys, off a Mac | While the terminal has the keyboard, `Ctrl` and a letter go to the shell (`Ctrl+W`, `Ctrl+R`); `Ctrl+Shift`, `Ctrl+Alt`, `Ctrl` and a digit, `Ctrl+Tab`, `Ctrl+,` and `` Ctrl+` `` stay the app's. `Ctrl+Shift+C` copies and `Ctrl+Shift+V` pastes |

**Run (▶).** A shell code block in an answer (`bash`, `sh`, `zsh`, `shell`, `fish`, `ksh`) has ▶
beside its copy button: it types the block into the terminal and presses Enter. Nothing runs
without that press, and a block still being written has none. A block with a character that does
not show as itself (a control character, an escape sequence, a direction override, a zero-width
character) is refused, with the character named. While a command runs in the terminal, ▶ is
refused: wait, or stop it with Ctrl-C.

**The agent hears how it went.** When a block run with ▶ ends, the conversation gets a note from
pine, `terminal: ended`, with the command, how it ended (exit code or Ctrl-C) and its last 30
lines of output, and the agent goes on from there. A block still running after 10 seconds (a dev
server) is reported once as running, and again when it ends. The agent never waits for the
terminal. Only blocks run with ▶ are reported, never what you type yourself. zsh, bash (Git Bash
too) and PowerShell report; another shell (cmd.exe, fish) runs ▶ blocks without reporting them.

For an agent: to hand the owner a command to run, put it in a block marked `bash`. In Pine it gets
▶ and you are told how it went; elsewhere it is a block to copy. The note in front of a message
written in the app says it is read in the Pine app. Give a series of commands one at a time, the
next once you have heard how the last went.

## The browser

The browser is part of the side panel (`⇧⌘B`, `/browser`, `/code browser`, View > Toggle
Browser): the browser of the conversation the panel shows, the same one the agent opens pages in,
with its logins. In the app no other window opens for it. Put the side panel beside the
conversation to see the page and the answers together.

| | |
|---|---|
| What you see | With this computer's pine, the page itself, live: you click, scroll, type and paste in it while the agent drives it. With another machine's pine, on the phone and in the web client, a picture of the page, a few times a second. The page is laid out for the panel's size; widen the panel to widen the page. The browser's tabs are a row above the page |
| What you can do | Click, type, scroll, drag, paste, go back and forward, reload, open (`+`), choose and close tabs, and type an address. Enough to log in to a site for the agent, solve a captcha or confirm something yourself |
| An address of your own | Goes through pine's guard like any other. One on this computer or your network (`localhost:3000`) is allowed for this conversation by your typing it. pine's own control port stays closed |
| When the agent wants you to look | It calls `browser_show`: the side panel opens on the browser |
| What the agent knows | It sees what you did when it next looks at the page; when you took the browser elsewhere, it is told before it acts ([mcp.md](mcp.md), "Seeing the browser, and logging in yourself") |
| No page | The browser is empty until the agent or you open a page. It closes after the conversation has been idle for 15 minutes and when pine restarts; opening an address starts it again, logins kept |
| Running in this conversation | While no page is open, the ports of programs this conversation left running, to open with a click |
| Opened by the agent before | While no page is open, the last 12 addresses the agent opened in this conversation, newest first, to get back to the page it had open. Never one the agent was refused |

A page the agent made for you (a board, switches, a form) is shown here too, and what you press on
it wakes the agent ([interfaces.md](interfaces.md)).

The page asks for no permission (camera, microphone, location and passkeys are refused) and keeps
no download; its logins are separate from the browser pine starts while the app is closed. As a
picture (another machine, the phone, the web client) there is no download, no file upload, no
copying out of the page, and no input method; for those, ask the agent in the terminal UI to show
the browser, or set `"headed": true` for the browser ([mcp.md](mcp.md)).

## The view

The view (`⇧⌘O`, View > Toggle View, the radar at the top right, or "View" in the palette) shows
all of pine at a glance, in a tab of its own: every agent, the work each does right now, where it
came from, who handed what to whom, the sub-agents at work, and what waits for you. It needs no
conversation.

What it draws is a view: a script in the `views` folder of pine's home, chosen by the name at the
top of the panel (`ui.view`). pine comes with three: `overview` (the default, everything in words),
`office` (pine as a little house full of robots) and `workshop` (Santa's workshop). Writing your
own is in [views.md](views.md). With no view in the folder, or `ui.view` set to `off`, there is no
button and no panel. The mobile app and the web client show no view.

| | |
|---|---|
| On top | What an agent asks you right now, each with **Answer**, whatever the view |
| The view | In the middle; a click in it shows an agent or a piece of work below, or opens it |
| What happened | Below, newest first, in plain words: what woke whom, what was handed on, who answered, what you were asked and said. A click shows a line's work, a double click opens it. Drag the line above it to share the room |
| Looking closer | An agent or piece of work chosen in the view or the list is shown below it: for an agent its mode, its work, its open conversations and what it did lately; for a piece of work where it came from, what it does, its mode, whether it read outside content, what it handed on, what it asks you, and each step with the tokens it used. **Open** opens it. For a board or a task: what it says, its state, result or question, and notes |

The words below the view are the app's own. The view itself is told only the shape of pine, never
a prompt, an answer, a path or what an event said ([views.md](views.md), "What a view cannot do").

In every view the `?` at the top right shows what its signs mean, and the pointer over anything
says what it is. A camera follows where agents work; scroll, drag or pinch to look yourself, and
the eye button follows again. The view zooms in and out by itself while the camera follows.

**`office`** draws pine as a cut-open tower house in pixels: the main agent under the roof, the others
on the floors below, you at your desk in the hall. Each agent has a room, a robot in its color, and
a door plate with its name and mode. A robot's bubble says what it does ("reading a file", "waiting
for scout", "needs your answer"). The sky follows your clock and the season; at night an agent at
rest sleeps.

| In the house | What it is |
|---|---|
| A robot paces its room | It thinks |
| A robot at its shelf with a book | It reads or searches files. A starred book is a skill the agent has; a robot with one reads that skill |
| A robot at its desk, the screen full of lines | It runs a command, edits a file, or writes its answer |
| A robot at the rack | It uses an MCP server's tool. Each lit slot is an MCP server it has; the one in use blinks |
| A robot on its chair, an hourglass | It waits for a delegated task or its sub-agents |
| A robot jumps, a red "!" | It asks you. The bell on your desk rings |
| Small robots beside it | Sub-agents |
| A letter with wings flies from one robot to another | A task handed on (`delegate`); the answer flies back with a tick, or a cross if it failed |
| A capsule in the glass tube | An event: from your desk, a source's box in the hall, or the clock in the turret when a schedule is due |
| Alarm clocks over a desk | The agent's schedules |
| The board on the wall | Its conversations: a fork per branch, a leaf for a worktree, a flag for a goal |
| A cork board on a trolley; a notice board in the hall | The board its sub-agents work through, a card per task: paper to do, the agent's color in progress, green done, amber a question, red failed. The notice board is a board for all agents ([boards.md](boards.md)) |
| A letter flies up to the dish on the roof | The agent sent something out (`send`, `publish_event`) |
| Shield, lock, bolt, warning sign, blueprint on a door plate | The mode: `safe`, `manual`, `auto`, `bypass`, `plan` |
| An amber lamp, amber eyes | The work read outside content: sending something out asks you from now on |
| A robot throws its arms up; droops under a puff of smoke | Work is done; work failed |

### The workshop

`workshop` draws the same as Santa's workshop at the North Pole: the main agent is Santa under the
roof, every other agent an elf with a cap in its color, each in a bay of its own; you stand at the
mail room's counter. The bubbles say the same as in `office`, and most signs have a twin there:

| In the workshop | What it is |
|---|---|
| Santa checks a long list | The main agent is at rest (at night he sleeps) |
| An elf with a hammer, a brush or a wrench; an elf ties a ribbon round a parcel | It runs a command or edits a file; it writes its answer |
| An elf at the gumball machine; Santa at his tree | An MCP server's tool. Each gumball, or bauble, is an MCP server; the one in use lights up |
| A glass of sand on the bench | It waits for others |
| A jack-in-the-box with a red "!" | It asks you; your counter's bell rings |
| A present flies from one to another; up to the sleigh | A delegated task; the agent sent something out |
| A sweet in the glass chute | An event |
| Bells on a wall; a little tree with a star | Schedules; a goal |
| Snow globe, cookie jar, wind-up key, sparkler, gingerbread house | The modes `safe`, `manual`, `auto`, `bypass`, `plan` |
| An amber lantern, a cap's bobble glowing amber | The work read outside content |
| A stocking per agent in Santa's room | Glows while that agent works, red while it asks |
| Presents under Santa's tree; the big wheel | More presents the more work in the last half hour; the wheel turns faster while anybody works |

### The overview

`overview` is all of pine on one board, in words: what triggers agents, the agents and what each
does, and the tools and boards they use ([views.md](views.md) says how it is laid out).

| On the board | What it is |
|---|---|
| An agent's card | What it does now ("Running a command", "Waiting for scout", "Needs your answer", "Idle"), why ("for you", "delegated by main", "triggered by inbox"), how far ("step 2 of 5"), its sub-agents as lines under it, and its mode as a badge |
| A board's card | Whose it is, how far ("7/24"), what happens ("3 in progress · 14 to do"), and a tile per task, colored by its state |
| A colored border and tint | Something happens there now, in the agent's color; a question for you, or a source that is down, in its own color |
| A line between two boxes | Something happens between them now: a trigger to the agent it started, an agent to the tool it uses or to one it delegated to, an agent to you while it waits for your answer. A dot runs along it the way things go. The pointer over a box shows all its lines |
| A click; a double click | Shows an agent, a board or a task under the view; opens it |
| Dragging, scrolling, pinching | Moves and zooms the board (pinch, or scroll with `ctrl` or `cmd`); the camera then stays where you put it |
| The eye, at the top right | Follow activity (on at first): the camera follows what happens again. A double click on the empty board does the same; the button beside the eye shows the whole board |
| Zooming out; zooming in | Far out every box is one line, a name and its state (`working`, `waiting`, `asks you`, `idle`); close in it says all: each piece of work with its time and tools, and every task of a board with its worker |

## The manual

**Manual**, at the foot of the side bar (also **Help › Pine Manual**, and `Manual` in the palette),
opens pine's manual, its documentation, in a tab of its own to read yourself. It is the text the
agents look up with their `manual` tool, from the pine the app uses, so it fits that version.

| Part | What it is |
|---|---|
| Chapters, on the left | Every chapter under its part of the manual (Start here, Where you talk to pine, Agents, Reacting to the world, Setting pine up, Reference), in the order of the index. The open chapter shows its sections; the arrow beside a chapter shows or hides them, a click on one goes there |
| The chapter, in the middle | One chapter whole. A link to another chapter or heading opens it in this tab. At its end, the chapters before and after it |
| On this page, on the right | The chapter's headings; the one you are at is marked as you scroll |
| Search the manual | At the top of the chapters (`⌘F` while the manual is in front). It finds sections as the agents' search does, each with where it stands and the line that fits; Enter opens the first, the arrow keys go through them. A key, tool or command is found by its name and opens at its table row |
| The palette | `⌘K` lists what the manual says about the words you type, under "In the manual" |

Narrower than about 720 pixels, the chapters are a choice above the text; "On this page" shows where
the manual has about 1000 pixels. Pictures in the manual are shown as their description.

## Settings

`⌘,` opens the settings panel in a tab (the same key puts it away). It is pine's configuration,
changed by clicking. The daemon checks a change as it checks the main agent's, writes it, reads
the configuration back, and undoes what does not load. Nothing asks you to confirm: the app is your
own hand, like a `pine` command.

**Search** at the top of the list of pages (`⌘F` while Settings is in front) finds a setting by its
name, a word of what it does or its key in `pine.json`, and also what pine has: an agent and its
fields, a provider, a model server, an MCP server, a skill, a source, a schedule, a route, a
machine. Enter or a click goes there and outlines it. The palette (`⌘K`) lists the same under In
Settings.

| Page | What you do there | The same by command or by asking the main agent |
|---|---|---|
| General | **This app**: theme, version and updates, notifications. **pine**: its version, started here or attached, whether there is a sandbox, Show log, Restart, Keep pine running after the app quits, the `pine` command in a terminal, the browser of the web tools (Fetch it), the home folder. **Worth a look**: what `pine check` would say. Then pine's settings in **Defaults for agents**, **Limits** and **Security**: the model, reasoning and mode agents start from, how long a command and a task may run, how many agents work at once, and what pine asks you about. Point at a setting's name to see its key. Settings that only tune pine to a model server are written into `pine.json` by hand ([setup.md](setup.md), "pine's settings") | `set_setting`; `pine check`; `pine browser-install` |
| Agents | Every agent, and **New agent**. An agent's page: its avatar (a click picks its color) and its name (a click renames it); Model (model and reasoning); Conversation (When you send a message: Message to the top, or Follow the answer); Instructions (`AGENTS.md`, `SOUL.md`, `TOOLS.md`; `MEMORY.md` and your rules shown); Permissions (mode, network for its shell, built-in tools, agents it can delegate to); Folders outside the workspace (Add folder, read only or read and write); What this agent has; Remove. Changes wait in a bar, Unsaved changes, with Discard and Save changes. Under the list, **Instructions for all agents**: `AGENTS.md`, `TOOLS.md`, `USER.md` of pine's home | `create_agent`, `update_agent`, `rename_agent`, `remove_agent`; `pine agent …` |
| Models | First what is missing: **Connect a model first**, or each agent whose model cannot answer, and why. **Default model** (`defaults.model`), with Change. **Subscriptions and API keys**: Claude, ChatGPT, GitHub Copilot and what you are signed in to; a search finds the others; sign in through the browser or with a key, sign out. **Models on your own computer**: your model servers, their models and how many agents may use each at once (`limits.models`, else `limits.maxConcurrentRuns`), Remove, and **Connect a server** (an address, a name, a key if needed). **Decision models**: models that answer routes' typed questions fast ([events.md](events.md), "Typed questions") | `add_model_server`, `add_model`, `configure_model`, `remove_model`, `add_decision_model`; `pine model …`, `pine login`, `pine logout` |
| MCP servers | Every server, whom it is for and whether it connects. **Add server**: a remote one (an https address) or a program on this computer, for all agents or one. Sign in to a remote one through the browser. Remove | `add_mcp_server`; `pine mcp …` |
| Skills | Every skill and whom it is for: read, change, add (for all agents or one), remove. A skill in a folder of yours that the configuration names is shown, not changed | `add_skill`, `remove_skill`; `pine skills` |
| Events | **Sources**: what runs, who is subscribed, the last event; add one by type (its options as a form, a secret in a field of its own), subscribe an agent or all agents, unsubscribe, remove. **Schedules**: each as When and Then; New schedule (at set times, every so often, once at a time, once after a while; which agent and the task). **Routes** (often not needed: an agent reacts to a source by subscribing, a time is a schedule): each as When and Then; New route: the topic, an optional condition, how often (each event, limit how often, wait for a burst to end), then wake an agent, set shared state, publish an event, ask a model, or make a decision | `add_source`, `subscribe`, `add_schedule`, `add_route`; `pine sources`, `pine subscribe`, `pine schedules` |
| Environments | This computer and your SSH machines: add, use, forget. See "Environments: the pine of another machine" | `ssh` to the machine and `pine` there |
| Browser access | Paired devices and the switches that let them in. See "Browser access" | None: it is the app's own |

A secret you type on these pages (a model server's key, a source's token, an API key) goes to the
daemon and into pine's `.env` or `auth.json`. It is not shown again, not kept by the app, and
never reaches an agent or a model.

## Themes

A theme is a VS Code color theme (the `.json` file nearly every editor theme is published as).
Pick one in Settings > General, or ask the main agent ("make it dracula"). It is pine's setting
`ui.theme`, not the app's: every Pine app on that pine shows it, and with another machine's pine
the window takes that pine's theme. There is no separate light, dark or system setting: pick a
light theme for a light window.

| Theme | Kind |
|---|---|
| `pmndre` | dark, pine's own and the default |
| `one-dark-pro`, `dracula`, `tokyo-night`, `catppuccin-mocha`, `nord`, `github-dark`, `gruvbox-dark` | dark |
| `github-light`, `one-light`, `catppuccin-latte`, `solarized-light`, `rose-pine-dawn` | light |

Themes lie in the `themes` folder of pine's home, one file each, named by the file:
`one-dark-pro.json` is `one-dark-pro`. pine puts these into the folder once; after that the folder
is yours. To add a theme, copy its `.json` into the folder: it is in the theme's VS Code extension
(usually under `themes/`), and Shiki's collection (`@shikijs/themes`) has many more. Comments and
trailing commas are fine. A theme that uses `include` cannot be read. Settings > General names a
file pine cannot read, and why.

pine takes the editor colors that match its own (`editor.background`, `editor.foreground`,
`sideBar.background`, `button.background`, `gitDecoration.*`, `terminal.ansi*` and others) and code
colors by TextMate scope, and derives the rest. A theme can set any of pine's colors in an object
of its own, which editors ignore. A value is `#rrggbb` or `#rrggbbaa`:

```json
{ "name": "Mine", "type": "dark", "colors": { ... }, "tokenColors": [ ... ],
  "pine": { "brand": "#7aa2f7", "faint": "#565f89", "code-keyword": "#bb9af7" } }
```

| `pine` key | What it colors |
|---|---|
| `bg`, `surface`, `raised`, `sunk`, `side` | The page, cards and popovers, buttons, what lies below, the side bar |
| `text`, `text-muted`, `faint` | Text, quieter text, the quietest (hints, times, icons) |
| `line`, `line-soft`, `hover`, `press`, `select` | Borders, soft dividers, a row under the pointer, the side bar's row in front, selected text |
| `brand`, `on-accent` | The accent (what is on or at work), text on it |
| `warn`, `warn-soft`, `bad`, `info`, `plan`, `add`, `del` | Warnings, errors, renamed files, keywords, added and removed lines |
| `code-<kind>` | Code: `text`, `comment`, `meta`, `keyword`, `control`, `definition`, `modifier`, `string`, `regexp`, `literal`, `null`, `name`, `attribute`, `function`, `call`, `type`, `namespace`, `tag`, `operator`, `punctuation`, `heading`, `emphasis`, `link`, `inserted`, `deleted`, `gutter`, `gutter-active`, `active-line`, `cursor`, `match`, `match-line`; `code-meta-style` and `code-attribute-style` are `italic` or `normal` |
| `term-0` … `term-15`, `term-bg`, `term-fg`, `term-cursor`, `term-select` | The terminal's sixteen colors, background, text, cursor and selection |

An agent can have a color of its own (on its page under Settings > Agents, Color in the side bar's
menu, or ask the main agent: "make scout blue"). Only its avatar is drawn in it, in every theme.

## Environments: the pine of another machine

The app can use the pine of another machine you reach over SSH (a server, a desktop at home),
beside or instead of this computer's. Each window chooses its own pine. The foot of the side bar
says which (`pine 0.23.0 · started here`, `pine 0.23.0 · server`), and so does a pill in the title
bar while a window views another machine. In a terminal, `pine --ssh <host>` does the same for the
terminal UI ([tui.md](tui.md#the-pine-of-another-machine)). On Windows, pine in WSL is reached the
same way ([operations.md](operations.md), "On Windows").

| What | How |
|---|---|
| Add a machine | Settings > Environments: the host as you would type it after `ssh` (`server`, `user@server`, a name from `~/.ssh/config`), then Add. Anything else (ssh options, spaces, `;`) is refused |
| Use another pine | Pick it at the foot of the side bar or in the pill, Use in Settings > Environments, or "Use the pine on …" in the palette. Only that window switches. **Open in new window** (or `⌘`-click in the machine menu) opens it in a window of its own |
| Switch back | The pine you left goes on, and its agents finish their work. Its approvals and notices wait until a window uses it |
| Connecting | The first screen says "Connecting to <host>", then "Loading the agents…" |
| One that is not reached | The first screen says why (ssh's own words), with Try again and Use this Mac (Disconnect where offered) |
| Agents that do not load | "Could not load the agents of <host>" with the reason, Try again and the list of machines |
| Forget a machine | Forget on its line in Settings > Environments. One open in another window asks first: **Close its window and forget** |
| Disconnect | Only in the web client: lets go of the machine in use and goes back to the list, keeping the machine and its host key (unlike Forget). In the machine menu, Settings > Environments and the first screen |
| Quitting | Every connection ends. A pine the app started on another machine stops; one already running there goes on |

The app connects with one ssh connection that runs `pine service` there and forwards a port of
this computer to that daemon. The control API there stays closed to the network, and its token
stays in the app. A broken connection is made again.

| Needs | |
|---|---|
| A key, not a password | The app cannot type a password: use a key in `ssh-agent` (`ssh-add`), or an SSH service that signs you in by itself (Tailscale SSH) |
| A machine ssh knows | Connect once from a terminal (`ssh user@server`) and accept its key |
| A pine with `pine service` | `pine update` there if it is older |
| A pine home there | `pine init` on that machine first |

With another machine's pine:

| | |
|---|---|
| Folders | A conversation's folder is a path on that machine: you type it, a folder dropped from the Finder is refused, and Show in the Finder is not offered |
| The terminal and Run | They are shells of this computer, so they are not offered |
| The browser | The side panel shows the browser on that machine; `localhost:3000` there is that machine's |
| Settings > General | Is about the app and this computer's pine |
| Opening from the system | A folder from the Finder (`Pine <folder>`), a `pine://pair` address and the Dock's **Add a Device…** go to the last active window on this computer, or open a new local window |

**A machine you added is missing.** The app keeps your machines in its `prefs.json` (on a Mac in
`~/Library/Application Support/Pine`), with the open windows, their tabs and layout. A file that
cannot be read is never written over: it is moved to `prefs.json.unreadable`. `prefs.log` beside
it says when and why a machine was dropped (forgotten, or no host for ssh).

## Browser access: a browser with no SSH to set up

Browser access lets a phone, a tablet or another computer use this computer's pine from its
browser or the Pine app on the phone, with no SSH to set up: scan a QR code on this computer with
the phone's camera, press Allow here, and the phone is in your conversations. From then on that
device connects by itself. The two talk directly, peer to peer; the service in between only
introduces them. The app calls this computer "This Mac" on macOS and "This computer" elsewhere.
The browser's side is in [web.md](web.md#a-computer-paired-by-qr-code-a-browser-with-no-ssh-to-set-up).

### From a phone without SSH

Pair the Pine app on the phone, or the phone's browser, with the same QR code. On an iPhone Safari
offers to open the app; on Android the code opens the browser, which pairs by itself, or copy the
link into the app ([mobile.md](mobile.md#pairing-with-a-computer-that-runs-the-pine-app)). On the
same Wi-Fi the app on the phone needs no code: it lists this computer under "On this network"
(while **Visible on this network** is on), and a tap asks. The phone is listed here by its name
("Pine on Pixel 9").

### Pairing a device

Settings > Browser access, under This Mac (This computer on another system), shown only while the
window uses this computer's own pine. Until you switch it on, the app contacts no service,
announces nothing on the network and lets nobody in.

| What | How |
|---|---|
| `Browser access` | The switch. On: the app waits at the service for your paired devices while Pine is open. Off: it contacts no service and accepts nobody; your devices are kept. The badge says waiting, off, or that the service cannot be reached (it retries by itself) |
| `Open Pine at login` | Offered the first time you switch it on, so that this computer can be reached after a restart. The computer has to be awake and Pine open |
| `Service address` | Where browsers open the web client and find this computer. Default `https://pine-main.drcmda.workers.dev`; a deployment of your own goes here ([web.md](web.md#deploying-it)). Changing it means pairing again |
| `Add a device` | Here, **Add a Device…** in the Pine menu (File elsewhere), `⇧⌘D`, the Dock's menu, or `device` in the palette. Shows a QR code, and Copy link for a computer without a camera. The code works once, for two minutes, until you close the dialog; New code makes another; five wrong codes close it |
| `Allow` and `Refuse` | When a device asks, the app names it ("Chrome on Android") and shows four digits; the device shows the same four. Allow only if they match. The question is a toast at the top of the window wherever you are, and with the window behind others also a system notification. Refuse, two minutes without an answer, or a device that leaves keep nothing. A notification says each device that was added |
| `Devices` | Each paired device, when it was paired and last connected, and "connected now" with how (same network, direct, or relayed through your relay server) |
| `Remove` | Removes a paired phone, tablet or computer, so that it can no longer reach this Mac or PC: a connection it has is cut at once, and its key is refused from then on. To use it again, add it again |

### Without scanning a code

A phone with the Pine app on the same network finds this computer and asks; a browser on this
computer opens Pine by a link. Either way you compare four digits and press Allow.

| What | How |
|---|---|
| `Visible on this network` | On unless you turn it off. While browser access is on, the app announces this computer on the local network (Bonjour) so that the Pine app on a phone on the same Wi-Fi can ask without a code. The announcement carries the start of this computer's key fingerprint, never its name. Off: nothing is announced and such requests are refused; Add a device still works |
| `Requests without a code` | Only from a phone on the same network, one at a time. A request that ends without your yes is followed by 30 seconds in which such requests are refused; three in ten minutes pause visibility for an hour, with a toast "Visibility paused after 3 refusals" and **Turn on now**. Refused requests are never shown to you |
| `pine://pair` | What "Open Pine on this computer" in the web client opens. While browser access is on, the app opens a pairing in your default browser and shows the same code in the Add a device dialog. Off, nothing happens. Nothing is kept without Allow |

### What a paired browser can do

| | |
|---|---|
| This computer's pine | Its conversations, tabs, settings and theme, as in the window, also while the window uses another machine. Work started from the phone goes on when the phone is locked |
| Nothing else | The app answers paired devices with an SSH server of its own (not the system's), which accepts only keys you allowed here, never a password: no shell, no file transfer, no other port or machine |
| This computer's identity | The QR code carries the fingerprint of this computer's key, and the device refuses any other key. The key is kept encrypted by the system's keychain; where the keychain cannot be used, the switch stays off and says why |

The settings and paired devices are kept by the app; nothing is written into pine's home.

### A relay server of your own, for a phone that cannot connect from mobile data

Some networks (often mobile data) do not let two devices connect directly. Then a relay (TURN)
server of your own carries the connection. The project runs none; leave this empty if you have
none.

| What | How |
|---|---|
| `Relay server (TURN)` | Below the service address: `turn:host:port` over UDP (TCP and TLS, `turns:` or `?transport=tcp`, are refused), a user name and a password. A direct path is still preferred, and the device needs nothing. A device that uses it is listed as relayed |
| The line under it | Saved, the relay is tried at once: it works, or why not (no answer, wrong user name or password, name not found). One that fails is kept |
| What is kept | The password is kept encrypted and never shown again. Saving the fields empty removes the relay. Devices stay paired |

### When a paired device does not connect

| It says | What to do |
|---|---|
| "<name> does not answer" | This computer is asleep or off, Pine is closed, or browser access is off. The phone keeps trying |
| "no direct connection could be made from this network" | Try another Wi-Fi, or mobile data instead of the Wi-Fi, or set a `Relay server (TURN)` |
| "This browser is no longer known to <name>" ("This phone" in the mobile app) | The device was removed here, or the browser's data was cleared. Add it again |
| The section says the service cannot be reached | The app is offline or the service address is wrong. The rest of the app works |
| macOS asks whether a browser, or Pine, may find devices on the local network | Allow it, for a direct connection on the same Wi-Fi and to be found. Without it, pair with the code |
| Nothing finds this computer on the same Wi-Fi | Browser access and Visible on this network must be on, and Pine open. A guest or office Wi-Fi that keeps devices apart shows nothing. After three refusals visibility is paused for an hour |

## What the app is careful about

An answer can repeat what a web page told the agent, so the window treats what agents write as
content, never as a page of its own. The browser, the view, the terminal's Run button and browser
access each say above how they are kept apart.

| | |
|---|---|
| The page has no token | The daemon's token stays in the app's main process, which makes every call for the page. The page has no access to files or programs |
| An answer is content | It is drawn from markdown and cleaned of everything that could act or restyle: scripts, styles, forms, frames, svg, media tags, `javascript:` links. A small inline picture (`data:` png, jpeg, gif, webp) is shown |
| A link says where it leads | The address stands next to a link whose words differ, and only `http` and `https` open. A click on a web address opens it in the conversation's browser, where the agent sees it too; an address on this computer or your network opens in your own browser instead. `⌘`-click or `⌥`-click opens any link in your own browser; the right click offers both and Copy Address |
| Nothing is fetched because an answer contains it | The window loads nothing from the web. A picture or sound at a web address is a line to click (`Load picture · https://…`); the daemon then fetches it through its guard against local addresses |
| What the page may ask the system for | Writing to the clipboard and nothing else: no camera, microphone, location, or reading the clipboard |
| Notifications and the window's title | pine's own words only |
| What the app asks the web | GitHub, for pine's last release and its update. While browser access is on, its service, which introduces devices; conversations never pass through it |

The app reads none of pine's files, configuration or token: what it knows, the daemon told it.
