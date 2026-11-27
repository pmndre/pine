# The Pine app

**Pine** is pine's desktop app for macOS, Linux and Windows. It does what the terminal UI does
(conversations in tabs, each turn's work, approvals) and adds an editor, a terminal, a browser,
settings, pictures, video and sound, menus and notifications. It is a client of the daemon, so a
conversation in the app is the same one the terminal UI or Telegram shows. How the app is built and
tested is in [dev/desktop.md](../dev/desktop.md).

## Getting it

Download the app from <https://github.com/pmndre/pine/releases/latest>:

| File | For |
|---|---|
| `Pine-<version>-arm64.dmg` | A Mac with Apple silicon |
| `Pine-<version>-x64.dmg` | A Mac with an Intel processor |
| `Pine-<version>-x86_64.AppImage`, `Pine-<version>-arm64.AppImage` | Linux, any distribution. Runs where it lies (`chmod +x` it first) |
| `Pine-<version>-amd64.deb`, `Pine-<version>-arm64.deb` | Debian and Ubuntu: `sudo apt install ./Pine-<version>-amd64.deb`, into `/opt/Pine` |
| `Pine-<version>-x64-setup.exe`, `Pine-<version>-arm64-setup.exe` | Windows 10 and 11. Installs for your user alone (no administrator), into `%LOCALAPPDATA%\Programs\Pine` or a folder you choose |

On a Mac, open the image and drag Pine into Applications (macOS 13.5 or later). Nothing else needs
installing: no Node, no `npm install`, no developer tools. The app carries pine (the same version
as the app), its Node, and pine's helpers for dictation, app control and the `system` event source.

With Homebrew (a cask named `pine` is another program):

```bash
brew tap pmndre/pine https://github.com/pmndre/pine
```

```bash
brew install --cask pmndre/pine/pmndre-pine
```

Use the full name: Homebrew refuses `brew install --cask pmndre-pine` from another tap until you
trust it with `brew trust`. `brew upgrade` leaves the app alone, since it updates itself.
`brew uninstall --zap --cask pmndre-pine` also removes the app's files under `~/Library`, never
pine's home (`~/.pine`).

Android phones and iPhones have their own app in the same release ([mobile.md](mobile.md)), which pairs with this
computer ([Browser access](#browser-access-a-browser-with-no-ssh-to-set-up)).

### A newer version

On a Mac the app updates itself. At the start it asks GitHub once for pine's latest release and
downloads a newer one without a dialog. The side bar's foot says **Downloading Pine <version>…**,
then **Restart to update**. The update installs when you click that or at the next quit; the app
never restarts by itself.

On Linux and Windows the app opens the new release's page. Download the new file, quit Pine and put
it in place of the old app (on Windows, run the new installer). AppImageUpdate or Gear Lever can
update an AppImage in place. Your pine home (`~/.pine`) is not in the app and stays as it is.

| | |
|---|---|
| `Restart to update` | In the side bar's foot, Settings > General and **Check for Updates…**. The new app restarts every pine the old one started. A pine it only attached to (started in a terminal or at login) you restart yourself. While agents work, it warns how many conversations would be cut off: **Restart now**, **Restart when they are done** or **Cancel** |
| `Restart when they are done` | **Restarts when the work is done** waits in the side bar's foot. Click it, or **Cancel the wait** in Settings > General, to cancel |
| `Check for Updates…` | Asks again now. In the **Pine** menu (Help elsewhere), or `updates` in the palette |
| Settings > General | The version, **Check now**, **Check for updates at start**, and **Update automatically** (on by default) |
| `Pine <version> is available` | Shown when the app does not update itself (**Update automatically** off, or the download or install failed). A click opens the release's page |

A release counts once its file for your system is attached, a few minutes after pine is published.
Previews of pine are never offered. An app run from the disk image, or from a folder it cannot
write, cannot replace itself and asks you to move it to Applications. `pine update` in the app's
pine says that the app updates itself.

### The first start

| What the app finds | What it does |
|---|---|
| No pine home | Offers `pine init`: copies the example home and fetches the browser (about 600 MB, once). On Linux the sandbox needs an administrator (bubblewrap, sometimes an AppArmor rule): the app shows the commands, then **Try again**. Until then pine runs without the sandbox |
| The welcome | The main agent's own conversation opens with pine's welcome: the main agent is the administrator to ask; make one agent per purpose (coding, work, automation, chat); the first conversation is kept, others are cleared after a while unless pinned; what pine is for; a prompt to try (watching the Downloads folder); where pine keeps everything. pine wrote it and no model sees it |
| Nothing to answer with | While the main agent has no model that answers, the app opens **Setup Pine**. Conversations show **Connect a model first** with **Set up a model…**, and Settings > Models lists each agent that cannot answer, and why. A message you send meanwhile says it was not answered. Send it again once a model is there |
| A sign-in in Settings > Models | Sign in to a Claude, ChatGPT or Copilot subscription in the browser, or any provider with an API key. If the current model cannot answer, pine switches to the provider's usual one and says which (**Another one…**); else it offers **Choose the model your agents run on**. The choice is `defaults.model` |
| The first message | No agent writes first. Each introduces itself once, in its answer to your first message; `defaults.introduce` turns this off ([agents.md](agents.md), "Meeting an agent") |
| The browser of the web tools is missing | Each pine version drives its own browser build. When it is not on this computer, the app asks once per version to fetch it (**Download** in Settings > General, `pine browser-install`). Until then the browser tools fail; web search and reading a page work |

### Setup Pine: getting started

**Setup Pine** is where you set pine up and the one place to connect a model: the main agent's
conversation `setup`, pinned in the side bar. The app brings it to the front after pine is set up
and whenever the main agent has no model that answers (a new home, a sign-out, a removed model
server). It works the same in the Pine app, the mobile app and the web client.

Until a model answers, pine runs the steps itself as question cards above the input. No model reads
them and nothing of them is kept; a reload draws them again, finished steps marked done. Typing
works: a message that names an option of the open card picks it, in any case ("claude"). Anything
else gets "There is no model yet to answer that. Pick one of the options, or type its name: what
each one means is in its description." While the API key field is open, the input neither shows
nor keeps what you type: paste the key into the field.

| Step | What it asks |
|---|---|
| How should your agents run? | **A subscription** (recommended: Claude, ChatGPT or GitHub Copilot), **An API key**, or **A model on this computer** |
| Which subscription? | Claude, ChatGPT or GitHub Copilot. **Back** returns |
| Which server? | Servers found on this computer's usual ports (llama.cpp, Ollama, LM Studio, **Pinecone**), or **Another address**; a key or context size where needed ([setup.md](setup.md), "A model server on this computer") |
| The sign-in | The provider's page opens in your browser (**Open the sign-in page again**), with a code and **Copy** when there is one. **Cancel** goes back. Nothing typed reaches a model |
| Which provider? | Anthropic, OpenAI, Google Gemini, OpenRouter, xAI, or **Another…** (a search of every provider) |
| Your API key for … | A hidden field. **Save** stores the key in `auth.json` in pine's home, where no agent reads it; the conversation says only **Key saved for …**. A refused key says why, with **Try again** |
| Your agents now run on … | The model now in use: **Go on** or **Choose another model** |
| What would you like to set up now? | Optional items: **The mode**, **A working folder**, **Telegram**, **A first agent**, **The theme**, on a Mac **Pinecone**. **Send** hands them to the main agent one by one. **Nothing for now** opens the main conversation; the card returns at each start until you say something in Setup Pine |

### `pine` in a terminal

If you installed only the app, it can give your shell a `pine` command that runs the app's pine,
so everything in [commands.md](commands.md) works in a terminal (`pine status`, `pine agent add`).

| When | What happens |
|---|---|
| The first start from Applications (Mac) or the .deb (Linux) | The app links `pine` into `~/.local/bin` or `~/bin` if your PATH has one, else `/usr/local/bin` (or `/opt/homebrew/bin` on a Mac) if writable |
| No such folder | **Pine > pine in a Terminal…** or Settings > General installs it in `/usr/local/bin` with your password (`pkexec` on Linux; without it, Settings shows the `sudo` command) |
| Your shell already has a `pine` (npm, a checkout) | Left alone; Settings says where it is |
| The app runs from the disk image or Downloads (Mac) | Nothing. Move it into Applications first |
| The app was moved, or Linux, an AppImage | The link points at the app (or the AppImage file). Put it where it is to stay first; after a move, set the link up again in Settings > General |
| Windows | The installer puts `pine.cmd` on your user's PATH (open a new terminal); uninstalling removes it. Settings > General says whether another pine comes first |

Settings > General shows where the command is, with **Remove**. The app only removes or replaces a
link it made.

## The daemon: started or reused

You don't have to start pine first. The app asks `pine service` ([commands.md](commands.md), "A UI
of its own") for the daemon of your home.

| What it finds | What happens |
|---|---|
| A pine runs for this home (started in a terminal, at login, by the terminal UI) | The app attaches (`attached` in the side bar). Quitting the app leaves it running |
| `An older pine is running` | The attached pine is older than the app's; the side bar's foot and Settings > General show both versions. Restart it on the newer version, or stop it and let the app start its own |
| Nothing runs | The app starts one (`started here`), logging to `data/pine.log`, restarts it if it stops answering, and stops it when you quit |
| No pine home yet; no Node or pine | A screen offers `pine init`; a screen says what to install |

In Settings > General:

| Setting | What it does |
|---|---|
| Keep pine running after the app quits | Schedules fire, sources report and Telegram answers after you close the app; the next start attaches again |
| Home folder | A pine home other than `~/.pine` (another home is another pine) |
| Notifications | When an agent is done, fails, needs your approval or asks you something while the window is not in front. Always in pine's own words ("main is done"), never the agent's |

On a Mac, closing the window doesn't quit the app or a daemon it started (`⌘Q` does). On Linux and
Windows, closing the last window quits. If the app is newer than the attached pine, a page that
needs something new says so: update pine and restart it.

## The window

The side bar at the left lists agents and conversations, with the event log, Settings, the Manual
and whether pine answers at its foot. Tabs hold conversations, Settings, the event log, the side
panel (a conversation's files, terminal and browser) and the view.

On Linux and Windows the menu button (☰) at the right of the tab bar replaces the menu bar, and
`Ctrl` replaces `⌘` in every key (`⇧⌘T` is `Ctrl+Shift+T`). Drop a folder on the app's icon, or
type `Pine <folder>` in a terminal, for a conversation that works in it. The icon's badge counts
conversations that wait for you.

**The side bar.** An agent with several conversations is a group. It lists the agent's groups, its
own conversation (`main conversation`), pinned ones, then the rest by last use or name. Drag the edge to resize;
`⌘B` hides it.

| On an agent's line | What it does |
|---|---|
| A click | Opens its one conversation, or folds its list. A pulsing grey dot: it works; `!`: it waits for you; a dot: something new |
| `+`, the folder, the gear | A new conversation; one in a folder you pick; the agent's page in Settings |
| A right click | New conversation, a folder, New Group…, sorting, **Rename**, **Color**, settings, and **Remove** (not the main agent; asks whether to keep its folder) |
| `+` beside "Agents" | A new agent (name, instructions, model); its conversation opens in a tab |

A conversation's right click: Open, Pin, Rename, Branch, Move to Group…, Open in New Window, Remove
(Start over for an agent's own). Agents made or removed elsewhere (by the main agent, `pine agent add`, the terminal UI) show up or
go within seconds.

**Groups of conversations** ([agents.md](agents.md#groups-of-conversations)): New Group… is in the
agent's right click. Drag a conversation onto a group, or onto the agent's line to take it out; its
branches go along. Without a mouse: Move to Group…, or `Move conversation to group` in the palette
(`/group`). A group's Remove Group… asks, then removes the group and all its conversations for good.

**Tabs.** A tab shows the same dot and `!` as the side bar, and `★` for a conversation kept for
good. `⌄` after a row lists its tabs. Drag a tab to reorder it, into another group or window. Its
right click: Close (`⌘W`), Close Others, Close to the Right, Close All, Split Right, Split Down,
Move to New Window, Pin or Unpin. Closing a tab keeps the conversation and your unsent text in the
side bar. With no tab open, `⌘W` closes the window. Close Others and the like keep a tab that waits
for your answer, and an approval with no tab open opens the agent's main conversation.

**With the keyboard.** Tab moves through agents, groups and conversations. Arrows move and Enter
opens. A row of tabs is one Tab stop (arrows, then Enter or Space). A line's buttons (gear, folder,
a group's `+`, remove) show on hover or keyboard focus, always in a narrow window, and are Tab stops
after their line. An agent's `+` always shows.

**A conversation.** An empty one shows its agent: purpose, model, mode, whom it delegates to, and
its skills, sources, schedules and MCP servers. Each turn's work (tool calls, thoughts, sub-tasks)
is one line that a click opens; `↳ … ↗` opens a sub-agent's or delegated task's work in a tab.
**Undo** (`/undo`) stands above your last message. Scrolled up, the view holds still, and a
button brings you back to the end. The top line shows the conversation (`main / notes`), its folder and how full
its context is (hover: cache share, speed). Your sent message moves to the top with the answer
below it, unless the agent follows the answer ("When you send a message" in Settings > Agents):
then your message stays at the bottom, as in a terminal.

**The input.**

| Key or part | What it does |
|---|---|
| `↩` | Sends. While the agent works, the message goes into that work, marked "not read yet" or "read 14:03"; **send now** stops the current step so it is read at once ([agents.md](agents.md#a-message-while-the-agent-works)) |
| `⌥↩` | Sends a message that waits its turn |
| `⇧↩`, `↑`, `esc` | A new line; earlier inputs; stops the agent |
| `/`, `@` | Commands; the folder's files |
| The bar under the input | `+` attaches files (or drop up to 10, 20 MB each; a dropped folder is opened for the conversation), the microphone, model, reasoning, mode and folder. `outside content` shows once the conversation has read something from outside |
| The top right of the window | The side panel (`⌥⌘B`) and the view (`⇧⌘O`): open, close, or bring to front |

`⌘T` (or `+` after the tabs) starts a conversation with the agent of the tab in front, `⌘O` one in
a folder. `⇧⌘T` always asks which agent, as does `⌘T` from a tab without one.

**A narrow window.** The window can be as narrow as a phone (360 pixels). Below 1024 pixels, one row
holds every tab, the tab in front fills the window, and the side panel and the view open as a sheet
from the right, one at a time. Below 768 pixels the side bar becomes a sheet from the left (its
button or `⌘B`). Below 640 pixels a sheet takes the whole width. `esc`, a click beside a sheet, `×`
or picking a conversation puts it away. Below about 720 pixels Settings shows its pages as a row
along the top. Zoom with `⌘+`, `⌘-`, `⌘0`.

### Groups of tabs

From 1024 pixels the window arranges tabs in groups, as VS Code does, side by side or stacked. The
side panel and the view open in groups of their own at the right. Split Right puts two
conversations side by side.

| You do | What happens |
|---|---|
| Drag a tab onto a tab, a row's end, or a group's middle | It goes there, in that group |
| Drag a tab to a group's edge or the window's edge | A new group on that side |
| Split Right, Split Down | The tab gets its own group beside or under |
| Drag the edge between groups | Resizes (or Tab to it and use arrows; a double click shares equally) |
| Click into a group | `⌘T`, `⌃Tab` and `⌘1` to `⌘9` work there |

A group without tabs closes. The arrangement survives restarts, and a moved tab keeps its place or
shell. `browser_show`, a port's link under Running, and a link in an answer open the browser in the
side panel.

### Multiple windows

Each window has its own tabs, groups, side bar and machine.

| Action | How |
|---|---|
| Open a new window | `⌘N`, File > New Window, the Dock's New Window, or the palette. A second window on the same pine starts empty |
| Open another machine in a new window | **Open in new window** in Settings > Environments, or `⌘`-click in the machine menu |
| Move a tab or a conversation to a new window | **Move to New Window** on a tab (with its unsent text, attachments, quotes and terminal), or **Open in New Window** in the side bar |
| Drag a tab out | Pull a conversation's tab outside every Pine window, and it opens in its own new window there, as in a web browser |
| Drag a tab to another window | Onto its tabs, or onto a window with none. Only between windows on the same pine |
| Close a tab or window | `⌘W` closes the tab, or the window when it has none; `⇧⌘W` closes the window |
| Quit and reopen | `⌘Q` keeps and restores every window. With all closed, reopening opens one on the last machine |
| Notifications and badges | Open the window that holds the conversation. The badge counts what waits on every machine |

### Finding a conversation

`⌘K` (or Search at the top of the side bar) finds conversations by name and by what was said in
them, plus open tabs, agents, settings pages, commands and settings (under In Settings). In a
conversation opened from a match, `↩` and `⇧↩` step through the marked words. It searches the last
thousand tasks of all agents; for older messages, open the conversation and use `⌘F`. A
conversation without a name is called by your first words in it; Rename (right click, `/rename`)
names it.

### Quoting part of a conversation

Select text, a sentence of an answer for example, and a small bar offers **Quote**, **Reply** and
**Bookmark**. **Quote** puts it as a badge above the input (hover shows it, a click goes to its
place, `×` removes it); quote several pieces, with or without text of your own. **Reply** adds a
field under the badge for your reply to that quote (`↩` or `esc` closes it). The agent reads each
quote as markdown (`> `) before your text, followed by its reply. Long quotes are cut (`…`), never
your own text. `/undo` gives quotes back.

### Bookmarks

**Bookmark** keeps the selection as a bookmark for you alone; the agent is not told. A button with
their number beside the title lists them: a click goes there, `×` removes one. They follow a
rename, go with a reset or removal, and a branch takes those of the messages it holds.

### Branches and worktrees

"Branch from here" in the right click on one of your messages makes a new conversation with
everything up to the end of that turn; Branch in the side bar takes all of it. The branch stands
under its original ("… · branch") until renamed. The top line is a path (original, branch, folder)
whose parts open with a click. What a branch takes: [agents.md](agents.md#branching-a-conversation).

A conversation can work in a worktree of its folder's repository, so conversations on one project
don't overwrite each other ([coding.md](coding.md#a-worktree-for-a-conversation)). File > New
Conversation in a Worktree… (`⌥⌘T`) starts one, Conversation > Worktree… moves the current one into
one, and "Branch from here into a worktree" and "Branch into a Worktree" branch into one. The header
shows the branch (`pine/<name>`); a click on it offers merge, squash, update, ask the agent to
commit, and discard. Changes in the side panel says how many commits it is ahead.

### The terminal UI's commands in the app

Modes, goals, swarms, approvals, questions, the steps list, sub-agents and `/undo` work as in
[tui.md](tui.md). A swarm (`/swarm` and the job, or Swarm in the palette) shows its round and
checking above the input, with pause, Resume and Clear; its tasks are in the side panel's Board.

| In the terminal UI | In the app |
|---|---|
| `/model`, `/reasoning`, `/mode`, `/folder` | Also the bar under the input, and the Conversation menu |
| `/sessions`, the conversation list | The side bar |
| `/code` | The side panel (`⌥⌘B`) |
| `/mcp`, `/sources`, `/subscribe` | Also Settings > MCP servers and Settings > Events |
| `/attach <path>`, `/paste` | Drop files, paste a picture, or `+` under the input |
| `/export` | Asks where to save the file |
| `/emit <topic> [json]` | The same; `/emit` alone or Publish… in the event log opens a form |
| `/voice`, `ctrl+r` | The microphone under the input, or `⌃R` |
| `/quit` | `⌘Q` |
| `shift+tab` (next mode) | The same, while the input is empty |
| `alt+1` … `alt+9` | `⌘1` … `⌘9`; `⌃⇥` is the next tab |

Everything is also in the menus with its key. `⌘F` finds text in the conversation.

### When the agent asks you something

An agent's `question` tool ([setup.md](setup.md)) shows a card above the input, never a dialog that
opens by itself. It lists the answers with their numbers and meanings; the agent's pick is marked
`recommended`. A click, a digit or Space answers (arrows and `↩` work too); for `multiSelect`, tick
and **Send**. The card takes the keyboard only while the input is empty.

| | |
|---|---|
| **No answer** | The agent goes on with an assumption it names |
| **Later** | Hides the card; **Open** (or `/approve`) above the input brings it back |
| Typing instead | A message typed instead of picking an answer answers in your own words, also to ask back ("what is the difference?"). A `/command` stays a command. If someone answered elsewhere meanwhile, it goes as an ordinary message |
| Another conversation's question | Never answered from here; the line above the input offers **Go there** |

An answered card folds into one line. An approval (a permission) opens a dialog. A sign-in that
asks you to choose (the main agent's `sign_in`, such as Amazon Bedrock's "Bearer token" or "AWS
profile") uses the same card, without `recommended` or own words; **No answer** stops it, and a key
it needs is typed in the approval dialog.

### Dictating a message

The microphone under the input (`⌃R`, `Ctrl+R` on Windows and Linux, `/voice [language]`) types
what you say into the input; you send it. `↩` ends listening, `esc` discards, typing ends it too.
It listens on this computer, also with another machine's pine. What is recognised and what to do
when it fails: [tui.md](tui.md), "Dictating a message". Where something is missing, the microphone says what to install.
The phone apps have no microphone.

### A sound in an answer

Pictures in an answer are shown (a click enlarges), videos get the system's player. A sound file in
the workspace, `![caption](hello.wav)` (wav, mp3, m4a, ogg or flac, up to 100 MB), gets a line with
play/pause, bars, name, time and length.

- A sound that arrives while you look at its conversation plays at once (the first, of several).
  An older one doesn't start by itself: it waits for a click, also after a restart.
- One sound plays at a time and goes on while you look elsewhere. Pause it or start another to stop
  it. It ends with the app.
- The bars show loudness from low (left) to high (right). Sounds over ten minutes have none.

| Unlike the terminal UI ([tui.md](tui.md), "Pictures") | |
|---|---|
| An aiff file, or a file that is not there | "cannot be played here" |
| A sound at a web address | A line to click, `Load audio · https://…`; the daemon fetches it then |
| A sound file opened in the side panel's Files | The system's player, which does not start by itself |
| `▸ open in player` | Not in the app |

## The code panel and the editor

The side panel (`⌥⌘B`) works on the folder of the conversation last in front (its opened folder,
else the agent's workspace). Put it beside the conversation to watch files change.

| View | Shows |
|---|---|
| Files | The folder as a tree, a search by name or content, and the editor; changed files colored in a git repository ("Files") |
| Changes | **All changes** since the last commit, with diffs. **Last turn**: what your last message changed, with "Undo" (`/undo`, `/code turn`) |
| Output | The last messages' tool calls with all they printed |
| Terminal | A shell of your own in the folder (`` ⌃` ``, View > Terminal, `/terminal`; "The terminal") |
| Browser | The conversation's browser (`⇧⌘B`; "The browser") |
| Agent | The agent's purpose, model, reasoning and mode (a click changes each), delegates and current work. Then what this conversation has, in the order of the agent's page in Settings: skills, MCP servers, sources it listens to, schedules, routes (when one concerns the agent), then **Instructions** (`AGENTS.md`, `SOUL.md`, `TOOLS.md` and `MEMORY.md` as on the agent's page: read, change, **Save changes**; `MEMORY.md` is read only) and the workspace. A row says "all agents" or "this conversation" when the thing is not the agent's own. A skill, schedule or route opens from its row in the dialog Settings opens it in; a source or server row goes to its place in Settings; **Manage** goes to that part of the agent's page |
| Running | What the conversation's commands left running (a dev server): ports as links, last output, Stop. Shown while something runs, or with `/code running` |
| Board | The conversation's board ("The Board tab"). Shown while there is one, or with `/code board` |

An agent's open steps stand at the top of the panel.

### The Board tab

A board tracks a job that several workers do at once ([boards.md](boards.md)). The tab appears with
the board, counting unsettled tasks.

| On the tab | Meaning |
|---|---|
| A task | Number, text and state: open, waiting for other tasks, being worked on (by a sub-agent or a named agent), done, failed, or "Waiting for an answer". A click shows its result and notes |
| "Waiting for an answer" | Its worker needs a decision. The agent that gave out the work answers what it can, and you answer the rest on the line under the task. The task then opens again |
| The menu at a task's right | "Take it back" (stops its sub-agent; a new one takes it), "Reopen", "Mark as done", "Remove" |
| Notes | Findings and decisions with their writer, each with Remove. "from outside content" marks one by a run that read outside content |
| The line at the bottom | Adds your own task; a running pool takes it, else it waits for the agent |
| The list at the top left, Clear | Picks the board where there are several; Clear removes the board and everything on it |

### Files

Select files in the tree or search results to rename, copy, move or delete them from the right
click. A double click or Enter opens a file; Shift-click selects a range, `⌘`-click toggles a row,
`⌘A` selects all shown. A right click beside the rows acts on the folder.

The search finds names, and with the button at its right the words inside files (case ignored): in
a git repository the files git knows or would add, elsewhere all that `.gitignore` doesn't exclude,
never `node_modules`.

An agent's own files at the top of its workspace (`AGENTS.md`, `SOUL.md`, `TOOLS.md`, `MEMORY.md`)
are grey: pine reads them as instructions, so you can edit and copy them but not delete, cut or
rename them, and a selection skips them. In a folder you opened, `AGENTS.md` is an ordinary file.

| Entry | What it does | Mac | Windows, Linux |
|---|---|---|---|
| Open | In the editor (or the player) | `↩` | Enter |
| Show in Finder (Explorer, Files) | In the system's file manager, for a folder on this computer | `⌥⌘R` | Alt+Shift+R |
| New File…, New Folder… | `docs/notes.md` makes the folders on the way | | |
| Cut, Copy | Keeps the rows for Paste and puts their paths on the clipboard | `⌘X`, `⌘C` | Ctrl+X, Ctrl+C |
| Paste | Within the conversation's folder. A copy onto a taken name is renamed (`notes copy.md`); a move onto one is refused | `⌘V` | Ctrl+V |
| Copy Path, Copy Relative Path | One path a line | `⌥⌘C`, `⌥⇧⌘C` | Alt+Shift+C, Ctrl+Alt+Shift+C |
| Rename… | Asks for the new name | F2 | F2 |
| Delete | Asks, then deletes for good (no trash) | `⌘⌫` | Delete |

**The editor.** A double click (or "Edit" on a diff) opens a file with line numbers, colors, search
(`⌘F`) and undo; `⌘S` saves. When the agent changes the file, the editor shows the new version, or,
if you typed meanwhile, offers it. Files over 2 MB and binary files are shown, not edited.

The daemon writes your changes inside a sandbox that reaches only that folder, so a link an agent
planted cannot redirect them ([security.md](security.md)). Without a sandbox it doesn't write, and
the app says so.

### The terminal

The Terminal view is your own login shell (`$SHELL`, else zsh on a Mac, your account's shell or
bash on Linux, PowerShell on Windows) with your environment, in the conversation's folder (else the
agent's workspace). It is not the agent's: no sandbox, mode or approvals, and the agent sees
nothing you type.

| | |
|---|---|
| One per window and conversation | Keeps running with its scrollback, and moves with its tab. It ends when its tab or window closes, the window switches machine, or Pine quits |
| ↻ | Starts a new shell. After `exit`, **Restart** |
| Keys, off a Mac | `Ctrl` and a letter go to the shell (`Ctrl+W`, `Ctrl+R`); `Ctrl+Shift`, `Ctrl+Alt`, `Ctrl` and a digit, `Ctrl+Tab`, `Ctrl+,` and `` Ctrl+` `` stay the app's. `Ctrl+Shift+C` copies, `Ctrl+Shift+V` pastes |

**Run (▶).** A shell code block in an answer (`bash`, `sh`, `zsh`, `shell`, `fish`, `ksh`) has a
play button, ▶, that types it into the terminal and presses Enter. Nothing runs without that press,
and a block still being written has none. A block with a character that does not show as itself
(a control character, an escape sequence, a direction override, a zero-width character) is refused
and the character named. While a command runs, ▶ is refused: wait, or stop it with Ctrl-C.

**The agent hears how it went.** When a ▶ block ends, pine adds `terminal: ended` to the
conversation with the command, exit code or Ctrl-C and the last 30 lines of output, and the agent
goes on. A block running after 10 seconds (a dev server) is reported as running, then again when it
ends. The agent never waits for the terminal, and what you type yourself is never reported. zsh,
bash (Git Bash too) and PowerShell report; cmd.exe and fish run ▶ blocks without reporting.

For an agent: to hand the owner a command, put it in a block marked `bash`. In Pine it gets ▶ and
you are told how it went; elsewhere it is a block to copy. The note in front of a message written
in the app says it is read in the Pine app. Give commands one at a time, the next after you heard
how the last went.

## The browser

The side panel's browser (`⇧⌘B`, `/browser`, `/code browser`, View > Toggle Browser) is the
conversation's own, the one the agent opens pages in, with its logins. No other window opens for
it.

| | |
|---|---|
| What you see | With this computer's pine, the live page, which you use while the agent drives it. With another machine's pine, the phone or the web client, a picture of it a few times a second. The page fits the panel's width; its tabs are a row above it |
| What you can do | Click, type, scroll, drag, paste, go back and forward, reload, open (`+`) and close tabs, type an address: enough to log in for the agent, solve a captcha or confirm something |
| An address of your own | Goes through pine's guard. Typing one on this computer or your network (`localhost:3000`) allows it for this conversation; pine's control port stays closed |
| When the agent wants you to look | It calls `browser_show` and the panel opens on the browser |
| What the agent knows | It sees your changes at its next look, and is told before it acts when you went elsewhere ([mcp.md](mcp.md), "Seeing the browser, and logging in yourself") |
| No page | Empty until someone opens a page. It closes after 15 idle minutes and when pine restarts; opening an address starts it again, logins kept |
| Running in this conversation | While no page is open: ports of programs this conversation left running |
| Opened earlier by the agent | While no page is open: the agent's last 12 addresses in this conversation, newest first, to get back to its page. Never one it was refused |

Pages the agent made for you (a board, switches, a form) show here too, and pressing on them wakes
the agent ([interfaces.md](interfaces.md)). The page gets no permission (camera, microphone,
location, passkeys) and keeps no download, and its logins are separate from the browser pine starts
while the app is closed. As a picture there is no download, upload, copying or input method; for
those, have the agent show the browser in the terminal UI, or set `"headed": true` ([mcp.md](mcp.md)).

## The view

The view (`⇧⌘O`, View > Toggle View, the radar at the top right, "View" in the palette) shows all of
pine at a glance in its own tab: every agent and its current work, who handed what to whom, the
sub-agents, and what waits for you. A view is a script in the `views` folder of pine's home, picked
at the top of the panel (`ui.view`). pine has three: `overview` (the default, in words), `office`
(a house of robots) and `workshop` (Santa's workshop). To write your own, see [views.md](views.md).
With no view, or `ui.view` set to `off`, there is no button or panel. The mobile app and the web
client have no view.

| | |
|---|---|
| On top | Each question an agent asks you now, with **Answer** |
| The view | A click shows an agent or a piece of work below; a double click opens it |
| Activity | Newest first, in plain words: what woke whom, what was handed on, who answered, what you were asked and said. Drag its top edge to resize |
| Looking closer | The chosen agent (mode, work, conversations, recent work), piece of work (origin, mode, outside content, hand-offs, questions, steps with tokens; **Open**), board or task (text, state, result, notes) |

The words below the view are the app's. The script learns only the shape of pine, never a prompt,
an answer, a path or an event's text ([views.md](views.md), "What a view cannot do"). In every view
`?` explains the signs and the pointer names things. A camera follows where agents work and zooms
in and out by itself; scroll, drag or pinch to look yourself, and the eye button follows again.

**`office`** is a cut-open tower house in pixels: the main agent under the roof, the others below,
you at your desk in the hall. Each agent has a room, a robot in its color and a door plate with name
and mode; a bubble says what it does ("waiting for scout"). The sky follows your clock and season,
and idle agents sleep at night.

| In the house | What it is |
|---|---|
| A robot paces; sits at its desk, the screen full of lines | It thinks; it runs a command, edits a file or writes its answer |
| A robot at its shelf with a book | It reads or searches files. A starred book is a skill; a robot holding one reads that skill |
| A robot at the rack | It uses an MCP server's tool. Each lit slot is one of its MCP servers; the one in use blinks |
| An hourglass; a jump and a red "!" | It waits for delegated work or sub-agents; it asks you, and your desk's bell rings |
| Small robots beside it | Sub-agents |
| A letter with wings flies from one robot to another | A task handed on (`delegate`); the answer flies back with a tick, or a cross if it failed |
| A letter flies up to the dish on the roof | The agent sent something out (`send`, `publish_event`) |
| A capsule in the glass tube | An event, from your desk, a source's box in the hall, or the turret clock (a schedule) |
| Alarm clocks; the board on the wall | Its schedules; its conversations (a fork per branch, a leaf for a worktree, a flag for a goal) |
| A cork board on a trolley; a notice board in the hall | Its sub-agents' board, a card per task (paper to do, its color in progress, green done, amber a question, red failed); a board for all agents ([boards.md](boards.md)) |
| Shield, lock, bolt, warning sign, blueprint on a door plate | The mode: `safe`, `manual`, `auto`, `bypass`, `plan` |
| An amber lamp, amber eyes | The work read outside content, so sending out now asks you |
| Arms thrown up; a puff of smoke | Done; failed |

### The workshop

`workshop` shows the same as Santa's Christmas workshop at the North Pole: the main agent is Santa
under the roof, other agents are elves with caps in their color, and you stand at the mail room's
counter. Bubbles say the same as in `office`.

| In the workshop | What it is |
|---|---|
| Santa checks a long list | The main agent at rest (he sleeps at night) |
| Hammer, brush or wrench; tying a ribbon | A command or file edit; writing the answer |
| The gumball machine; Santa's tree | MCP tools. Each gumball or bauble is an MCP server; the one in use lights up |
| A glass of sand; a jack-in-the-box with "!" | Waiting for others; it asks you (your bell rings) |
| A flying present; one up to the sleigh | A delegated task; something sent out |
| A sweet in the glass chute; bells; a little tree with a star | An event; schedules; a goal |
| Snow globe, cookie jar, wind-up key, sparkler, gingerbread house | The modes `safe`, `manual`, `auto`, `bypass`, `plan` |
| An amber lantern or bobble | The work read outside content |
| Stockings; presents under the tree; the big wheel | One per agent (glowing while it works, red while it asks); work in the last half hour; turns faster while anybody works |

### The overview

`overview` lays out all of pine on one board in words: triggers, agents and their work, tools and
boards ([views.md](views.md) describes the layout).

| On the board | What it is |
|---|---|
| An agent's card | What it does ("Running a command", "Needs your answer", "Idle"), why ("delegated by main", "triggered by inbox"), how far ("step 2 of 5"), sub-agents below, mode as a badge |
| A board's card | Owner, progress ("7/24", "3 in progress · 14 to do") and a tile per task colored by state |
| A colored border and tint | Activity, in the agent's color; questions and failed sources have their own colors |
| A line between two boxes | Something happening between them now (trigger to agent, agent to tool or delegate, agent waiting on you), with a dot running the way things go. Hover a box for all its lines |
| A click; a double click | Shows an agent, board or task under the view; opens it |
| Dragging, scrolling, pinching | Moves and zooms (pinch, or scroll with `ctrl` or `cmd`); the camera stays put |
| The eye, at the top right | Follow activity (on at first), as does a double click on the empty board; the button beside it shows the whole board |
| Zooming out; zooming in | Far out, a name and state per box (`working`, `waiting`, `asks you`, `idle`); close in, every piece of work with time and tools, every task with its worker |

## The manual

**Manual** at the foot of the side bar (also **Help › Pine Manual**, `Manual` in the palette) opens
pine's manual, its documentation, for you to read yourself in a tab. It is the text the agents
search with their `manual` tool, from the pine the app uses, so it fits that version.

| Part | What it is |
|---|---|
| Chapters, on the left | Every chapter by part (Start here, Where you talk to pine, Agents, Reacting to the world, Setting pine up, Reference). The open one lists its sections; the arrow shows or hides them |
| The chapter, in the middle | One chapter; links open in this tab; the next and previous chapters at its end |
| On this page, on the right | Its headings, marking where you are |
| Search the manual | At the top of the chapters (`⌘F`), the agents' search, with each hit's place and line. Enter opens the first, arrows step. A key, tool or command opens at its table row |
| The palette | `⌘K` lists manual hits under "In the manual" |

Below about 720 pixels the chapters are a menu above the text; "On this page" needs about 1000
pixels. Pictures show as their description.

## Settings

`⌘,` opens (and closes) the settings panel in a tab, where you change pine's configuration by clicking. The daemon checks a
change as it checks the main agent's, writes it, reloads the configuration and undoes what does not
load. Nothing asks you to confirm: the app is your own hand, like a `pine` command.

**Search** (`⌘F` in Settings, also under In Settings in `⌘K`) finds a setting by name, by a word of
what it does or by its key in `pine.json`, and anything pine has (an agent and its fields, a
provider, a model server, an MCP server, a skill, a source, a schedule, a route, a machine). Enter
goes there and outlines it.

Each thing is listed where it belongs. The pages MCP servers, Skills and Events hold what is for all
agents, and end with **Agents' own**: the agents that have their own, each a link to its page. An
agent's page holds its own skills, MCP servers, sources, schedules and routes, and those of its
conversations (marked "only in" the conversation), each with its add button. A route or a schedule
opens from its row: change it and **Save changes**, or **Remove** it. A route that does more than the
form shows (a command, two actions) opens read only.

| Page | What you do there | By command or the main agent |
|---|---|---|
| General | **This app**: theme, updates, notifications. **pine**: version, started or attached, sandbox, Show log, Restart, Keep pine running after the app quits, the `pine` command, the web tools' browser, the home folder. **Worth a look**: what `pine check` says. **Defaults for agents**, **Limits**, **Security**: starting model, reasoning and mode, time limits, how many agents work at once, what pine asks. Hover a name for its key. Model-server tuning goes into `pine.json` by hand ([setup.md](setup.md), "pine's settings") | `set_setting`; `pine check`; `pine browser-install` |
| Agents | Every agent and **New agent**. An agent's page edits its color, name, model and reasoning, "When you send a message", instructions (`AGENTS.md`, `SOUL.md`, `TOOLS.md`; `MEMORY.md`, and your rules when there are some, shown), permissions (mode, shell network, built-in tools, delegates), folders outside the workspace (read only or read and write); lists its own skills, MCP servers, sources (and the sources for all agents it listens to, with **Listen to**), schedules and routes (its own, and those that wake it); opens its conversations; and removes it. **Instructions for all agents**: `AGENTS.md`, `TOOLS.md`, `USER.md` of pine's home | `create_agent`, `update_agent`, `rename_agent`, `remove_agent`; `pine agent …` |
| Models | What is missing and why, **Default model** (`defaults.model`), subscriptions and API keys (sign in by browser or key, sign out), your model servers with how many agents may use each model at once (`limits.models`, else `limits.maxConcurrentRuns`) and **Connect a server**, and **Decision models** for routes' typed questions ([events.md](events.md), "Typed questions") | `add_model_server`, `add_model`, `configure_model`, `remove_model`, `add_decision_model`; `pine model …`, `pine login`, `pine logout` |
| MCP servers | Servers for all agents, whether each connects. **Add server**: an https address or a program on this computer, for all agents or one; browser sign-in for remote ones | `add_mcp_server`; `pine mcp …` |
| Skills | Skills for all agents: open one to read, change or remove it; add one for all or one agent. One in a folder your configuration names is read only | `add_skill`, `remove_skill`; `pine skills` |
| Events | What is for all agents: **Sources** (status, who listens, last event; add by type with a form and a secret in its own field, subscribe, unsubscribe, remove), **Schedules** (at set times, every so often, once at a time, once after a while), **Routes** (often unneeded: subscribe instead, or use a schedule), shown as When and Then. A route has a topic, an optional condition, a pace (each event, limited, after a burst) and an action (wake an agent, set state, publish, ask a model, decide) | `add_source`, `subscribe`, `add_schedule`, `add_route`; `pine sources`, `pine subscribe`, `pine schedules` |
| Environments | This computer and your SSH machines: add, use, forget ("Environments: the pine of another machine") | `ssh` to the machine and `pine` there |
| Browser access | Paired devices and their switches ([Browser access](#browser-access-a-browser-with-no-ssh-to-set-up)) | None: it is the app's own |

A secret typed here (a server key, a source's token, an API key) goes to the daemon, into pine's
`.env` or `auth.json`. The app doesn't keep or show it again, and no agent or model sees it.

## Themes

A theme is a VS Code color theme (`.json`). Pick one in Settings > General or ask the main agent
("make it dracula"). It is pine's setting `ui.theme`, so every Pine app on that pine shows it, and a
window on another machine shows that pine's theme. There is no separate light, dark or system color
scheme: pick a light theme for a light window.

| Theme | Kind |
|---|---|
| `pmndre` | dark, pine's own and the default |
| `one-dark-pro`, `dracula`, `tokyo-night`, `catppuccin-mocha`, `nord`, `github-dark`, `gruvbox-dark` | dark |
| `github-light`, `one-light`, `catppuccin-latte`, `solarized-light`, `rose-pine-dawn` | light |

Themes are files in the `themes` folder of pine's home (`one-dark-pro.json` is `one-dark-pro`),
put there once and then yours. To add one, copy in its `.json` from its VS Code extension (usually
`themes/`) or from `@shikijs/themes`. Comments and trailing commas work; `include` does not.
Settings > General names a file it cannot read, and why.

pine maps the matching editor colors (`editor.background`, `editor.foreground`,
`sideBar.background`, `button.background`, `gitDecoration.*`, `terminal.ansi*` and others) and code
colors by TextMate scope, and derives the rest. A `pine` object, which editors ignore, sets any of
pine's own colors as `#rrggbb` or `#rrggbbaa`:

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

An agent's own color (its Settings page, Color in the side bar, or "make scout blue" to the main
agent) colors only its avatar, in every theme.

## Environments: the pine of another machine

The app can use the pine of a machine you reach over SSH, beside or instead of this computer's.
Each window picks its own pine; the side bar's foot names it
(`pine 0.23.0 · started here`, `pine 0.23.0 · server`), and a pill in the title bar marks another
machine. `pine --ssh <host>` does the same for the terminal UI ([tui.md](tui.md#the-pine-of-another-machine));
on Windows, pine in WSL is reached this way ([operations.md](operations.md), "On Windows").

| What | How |
|---|---|
| Add a machine | In Settings > Environments, the host as typed after `ssh` (`server`, `user@server`, a name from `~/.ssh/config`), then Add. Options, spaces and `;` are refused |
| Use another pine | Pick it in the side bar's foot or the pill, Use in Settings > Environments, or "Use the pine on …" in the palette. Only that window switches; **Open in new window** (or `⌘`-click) opens it in its own |
| Switch back | The pine you left keeps working; its approvals and notices wait until a window uses it |
| Connecting, or not reached | "Connecting to <host>", then "Loading the agents…". If unreachable, ssh's reason with Try again and Use this Mac (and Disconnect where offered) |
| Agents that do not load | "Could not load the agents on <host>", the reason, Try again and the machine list |
| Forget a machine | Forget on its line; if it is open in another window, **Close the window and forget** |
| Disconnect | Web client only: logs out of the machine in use but keeps it and its host key, unlike Forget. In the machine menu, Settings > Environments and the first screen |
| Quitting | Ends every connection. A pine the app started remotely stops; one already running there goes on |

One ssh connection runs `pine service` there and forwards a port of this computer to that daemon;
the control API stays closed to the network and its token stays in the app. A broken connection is
remade.

| Needs | |
|---|---|
| A key, not a password | The app cannot type a password: use a key in `ssh-agent` (`ssh-add`), or an SSH that signs you in itself (Tailscale SSH) |
| A machine ssh knows | Connect once from a terminal (`ssh user@server`) and accept its key |
| A pine with `pine service` | `pine update` there if it is older |
| A pine home there | `pine init` on that machine first |

With another machine's pine, a conversation's folder is a path there that you type (no dropped
folders, no Show in Finder). The terminal and Run are not offered, since they are this
computer's shells. The browser runs there, so `localhost:3000` is that machine's. Settings > General
is about the app and this computer's pine. A folder opened from the Finder (`Pine <folder>`), a
`pine://pair` address and the Dock's **Add a Device…** go to the last local window, or a new one.

**A machine you added is missing.** The app keeps machines, windows, tabs and layout in its
`prefs.json` (on a Mac in `~/Library/Application Support/Pine`). An unreadable file is never
overwritten but moved to `prefs.json.unreadable`. `prefs.log` beside it says when and why a machine
was dropped (forgotten, or no host for ssh).

## Browser access: a browser with no SSH to set up

Browser access lets a phone, tablet or other computer use this computer's pine from a browser or
the phone's Pine app, with no SSH to set up. Scan a QR code on this computer with the phone, press
Allow here, and the phone is in your conversations; from then on it connects by itself. The two
talk peer to peer; the service in between only introduces them. The app calls this computer "This
Mac" on macOS and "This computer" elsewhere. The browser's side:
[web.md](web.md#a-computer-paired-by-qr-code-a-browser-with-no-ssh-to-set-up).

### From a phone without SSH

The Pine app on the phone and the phone's browser pair with the same QR code. On an iPhone Safari
offers to open the app; on Android the code opens the browser, which pairs, or you copy the link
into the app ([mobile.md](mobile.md#pairing-with-a-computer-that-runs-the-pine-app)). On the same
Wi-Fi the phone app needs no code: it lists this computer under "On this network" (while
**Visible on this network** is on) and a tap asks. The phone then appears here by name ("Pine on
Pixel 9").

### Pairing a device

In Settings > Browser access, under This Mac (This computer elsewhere), shown while the window uses
this computer's pine. Until you switch it on, the app contacts no service, announces nothing and
lets nobody in.

| What | How |
|---|---|
| `Browser access` | The switch. On: the app waits at the service for paired devices while Pine is open. Off: no service, nobody in, devices kept. The badge says waiting, off, or service unreachable (it retries) |
| `Open Pine at login` | Offered when you first switch on, so this computer is reachable after a restart (awake, Pine open) |
| `Service address` | Where browsers open the web client and find this computer. Default `https://pine-main.drcmda.workers.dev`, or your own deployment ([web.md](web.md#deploying-it)). Changing it means pairing again |
| `Add a device` | Here, **Add a Device…** in the Pine menu (File elsewhere), `⇧⌘D`, the Dock, or `device` in the palette. A QR code (Copy link for a computer without a camera) that works once, for two minutes, until the dialog closes; New code makes another, five wrong codes close it |
| `Allow` and `Refuse` | The asking device is named ("Chrome on Android") with four digits it shows too: Allow only if they match. The question is a toast in the window, and a notification while it is behind. Refuse, two minutes without an answer, or a leaving device keep nothing. A notification names each device added |
| `Devices` | Each device, when paired and last connected, and "connected now" with how (same network, direct, or relayed) |
| `Remove` | Removes a paired phone, tablet or computer so it can no longer reach this Mac or PC: its connection is cut at once and its key refused. Add it again to use it |

### Without scanning a code

A phone app on the same network finds this computer and asks; a browser on this computer opens Pine
by a link. Either way you compare four digits and press Allow.

| What | How |
|---|---|
| `Visible on this network` | On by default. While browser access is on, the app announces this computer on the local network (Bonjour) so a phone app on the same Wi-Fi can ask without a code. The announcement carries the start of the key fingerprint, never the computer's name. Off: nothing announced, such requests refused; Add a device still works |
| `Requests without a code` | Only from the same network, one at a time. A request that ends without your yes blocks others for 30 seconds; three in ten minutes pause visibility for an hour ("Visibility paused after 3 refusals", **Turn on now**). Refused requests are never shown |
| `pine://pair` | What "Open Pine on this computer" in the web client opens. With browser access on, the app opens a pairing in your default browser and shows its code in the Add a device dialog; off, nothing happens. Nothing is kept without Allow |

### What a paired browser can do

| | |
|---|---|
| This computer's pine | Its conversations, tabs, settings and theme, even while the window uses another machine. Work started from the phone goes on when the phone locks |
| Nothing else | The app's own SSH server (not the system's) accepts only keys you allowed, never a password: no shell, file transfer, other port or machine |
| This computer's identity | The QR code carries this computer's key fingerprint and the device refuses any other key. The keychain keeps the key encrypted; without a usable keychain the switch stays off and says why |

The app keeps these settings and devices itself, nothing in pine's home.

### A relay server of your own, for a phone that cannot connect from mobile data

Some networks (often mobile data) block direct connections between devices. A relay (TURN) server
of your own can carry them; the project runs none, so leave this empty if you have none.

| What | How |
|---|---|
| `Relay server (TURN)` | Below the service address: `turn:host:port` over UDP (TCP and TLS, `turns:` or `?transport=tcp`, are refused), a user name and a password. A direct path still comes first, and devices need nothing. Devices using it are listed as relayed |
| The line under it | On save, the relay is tested at once: works, or why not (no answer, wrong user name or password, name not found). A failing one is still kept |
| What is kept | The password, encrypted and never shown again. Saving empty fields removes the relay; devices stay paired |

### When a paired device does not connect

| It says | What to do |
|---|---|
| "<name> does not answer" | This computer is asleep or off, Pine is closed, or browser access is off. The phone keeps trying |
| "no direct connection could be made from this network" | Try another Wi-Fi or mobile data, or set a `Relay server (TURN)` |
| "This browser is no longer known to <name>" ("This phone" in the mobile app) | It was removed here, or the browser's data was cleared. Add it again |
| The section says the service cannot be reached | The app is offline or the service address is wrong. The rest works |
| macOS asks whether a browser, or Pine, may find devices on the local network | Allow it, for direct connections and to be found on the same Wi-Fi; else pair with the code |
| Nothing finds this computer on the same Wi-Fi | Browser access and Visible on this network must be on and Pine open. Guest or office Wi-Fi that isolates devices shows nothing. Three refusals pause visibility for an hour |

## What the app is careful about

An answer can repeat what a web page told the agent, so the window treats agents' text as content,
never as a page of its own.

| | |
|---|---|
| The page has no token | The daemon's token stays in the app's main process, which makes every call; the page cannot reach files or programs |
| An answer is content | Drawn from markdown, cleaned of anything that acts or restyles: scripts, styles, forms, frames, svg, media tags, `javascript:` links. Small inline pictures (`data:` png, jpeg, gif, webp) show |
| A link says where it leads | The address shows beside a link whose words differ; only `http` and `https` open. A web address opens in the conversation's browser, a local one in your own browser. `⌘`-click or `⌥`-click opens any link in your own browser; the right click offers both and Copy Address |
| Nothing is fetched because an answer contains it | The window loads nothing from the web. A picture or sound at a web address is a line to click (`Load picture · https://…`), then fetched by the daemon through its guard against local addresses |
| What the page may ask the system for | Writing to the clipboard only: no camera, microphone, location, or reading the clipboard |
| Notifications and the window's title | pine's own words only |
| What the app asks the web | GitHub, for releases and updates. While browser access is on, its service, which introduces devices; conversations never pass through it |

The app reads none of pine's files, configuration or token: all it knows, the daemon told it.
