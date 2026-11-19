# The desktop app

pine has an app with a window of its own, for macOS: **Pine**. It does what the terminal UI
does (conversations in tabs, the work of a turn, approvals, the code panel) and adds an editor
for the files of a conversation's folder, a settings panel for everything that is otherwise a
`pine` command or a sentence to the main agent, pictures, video and sound shown and played as
they are, menus and system notifications.

It lies in `desktop/` of pine's repository and is built on Electron, so that the same app can
be made for Linux and Windows later. It is a client of the daemon and nothing more: everything
it shows and changes goes through the control API ([operations.md](operations.md)), as with
the terminal UI and the `pine` commands. A conversation you have in the app is the same one
the terminal UI or Telegram shows.

## Getting it

Every release of pine has the app attached, as a disk image for each kind of Mac:
<https://github.com/pmndre/pine/releases/latest>

| File | For |
|---|---|
| `Pine-<version>-arm64.dmg` | A Mac with Apple silicon (M1 and later) |
| `Pine-<version>-x64.dmg` | A Mac with an Intel processor |

Open the image and drag Pine into Applications. Nothing else has to be installed: no Node, no
`npm install`, no developer tools. The app is signed and notarised, and it carries

| | |
|---|---|
| pine | The same package that goes to npm, with what it depends on. The app and the pine inside it have one version |
| Node | The Node that pine runs on, as nodejs.org hands it out. The pine of the app runs on it, whatever Node the Mac has or lacks |
| pine's helpers | The small programs for dictating, app control and the `system` event source, built for both kinds of Mac. Elsewhere pine builds them on first use, which needs Apple's command line developer tools |
| `pine` for a terminal | See below |

### A newer version

The app does not update itself: it says when there is a newer one and where it is. To get it,
download the new image from the release's page, quit Pine and put the new app in place of the
old one. Your pine home (`~/.pine`: agents, conversations, settings) is not in the app and
stays as it is.

| | |
|---|---|
| At the start | The app asks GitHub once for pine's last release. When that is newer than the app, a line at the foot of the side bar says so (`Pine <version> is available`); a click opens the release's page on GitHub in your browser. Nothing is said when the app is the latest, or when nobody answers |
| `Check for Updates…` | In the **Pine** menu (and `updates` in the command palette): asks again now and says what it found, with the link to the release's page when there is a newer app |
| Settings > App | The app's version and whether it is the latest, **Check now**, and the switch **Look for a newer version at the start** for the question at the start. The menu asks whatever the switch says |

A release counts as a newer app once its disk image for your kind of Mac is attached to it,
which is some minutes after pine itself is published. A preview of pine is not a release, and
the app never points at one. The app fetches and installs nothing. `pine update` in a pine that
came with the app says the same in a terminal. An app started from a checkout is no release
and asks nobody.

### The first start

Two things the app does not carry: a sign-in to whoever does the thinking, and the browser the
web tools drive. It asks for each where it is missing.

| What the app finds | What it does |
|---|---|
| No pine home | It offers to set pine up (`pine init`): the example home is copied, and the browser is fetched (about 600 MB, once) |
| Nothing to answer with | A conversation in which nothing was said yet says why and has a button to Settings > Models; that page lists everyone it holds for. Two reasons are found without sending anything: nobody is signed in to the provider, or it is `dev/claude-haiku`, what the example home starts with (Claude through the `claude` command of Claude Code, on the subscription Claude Code is signed in to), on a Mac that has no such command |
| A sign-in in Settings > Models | A Claude, ChatGPT or Copilot subscription is signed in to through the browser (**Sign in**), any provider with an API key. Nothing switches by itself, so the dialog then offers **Choose the model your agents run on**, from what the sign-in brought. The page keeps that choice (`defaults.model`) with **Change** |
| The browser is not there in the build this pine drives | Each version of pine drives a browser build of its own. A home that an older pine set up, or a new app in place of an old one, has the old build or none. The app asks once for each version of pine whether to fetch it, and Settings > App shows whether it is there, with **Fetch it** (`pine browser-install`, run by the app's pine). Until then the browser tools do not work; web search and reading a page do |

### `pine` in a terminal

If you installed only the app, your shell has no `pine` command until the app puts one
there. With it, everything in [operations.md](operations.md) works in a terminal on that Mac:
the terminal UI, `pine status`, `pine agent add`. The command is a link in a folder of your
shell's PATH to a small launcher inside the app, which runs the app's pine on the app's Node.

| When | What happens |
|---|---|
| The first start of the app from Applications | The link is made by itself where that needs no password: in `~/.local/bin` or `~/bin` if your PATH has one of them, else in `/usr/local/bin` or `/opt/homebrew/bin` if you may write there |
| No such folder | Nothing is done by itself. **Pine > pine in a Terminal…** in the menu, or Settings > App, sets it up in `/usr/local/bin`; macOS asks for your password |
| Your shell already has a `pine` (from npm, from a checkout) | It is left alone, and the app says where it is. The app still runs its own |
| The app was opened from the disk image or from Downloads | Nothing is set up: macOS runs it from a place that changes. Move it into Applications first |
| The app was moved | The old link leads nowhere. Set it up again in Settings > App |

Settings > App shows where the link is and takes it away again (Remove). Only a link the app
made is ever removed or replaced.

## Starting it from a checkout

From a checkout of pine:

```bash
cd desktop
```

```bash
npm install
```

```bash
npm start
```

`npm run dev` is the same with the page reloading as you edit it. To make an app that can be
put into Applications:

```bash
npm run pack
```

That writes `desktop/release/mac-arm64/Pine.app` (on an Intel Mac `release/mac/Pine.app`;
`npm run dist` also makes a disk image). It is the app as it is handed out, signed for the Mac
it was built on. See "Packing and signing" for what it carries and how it is signed for others.

| Command (in `desktop/`) | What it does |
|---|---|
| `npm start` | Builds the app and opens it |
| `npm run dev` | Opens it with the page served by Vite, reloading on every change |
| `npm run dev:preview` | The app's page in an ordinary browser, reloading on every change, on a throwaway pine. `-- --home <dir>` puts it on that pine home instead. See below |
| `npm run dev:preview:home` | The same on your own pine home, `~/.pine`, at port 5174, so that it runs beside the throwaway one. Its agents are your real ones. See below |
| `npm run check` | Type check |
| `npm test` | The app from end to end: the real app on a pine home of its own with a scripted model. Needs a screen. With `PINE_LIVE=1` on a Mac it also dictates with the real voice helper, from a recording |
| `npm run pack` | `release/mac-arm64/Pine.app`, with pine, Node and the helpers inside |
| `npm run dist` | The same, and a disk image |
| `node scripts/smoke.mjs` | Starts a packed app from a folder of its own, on a home of its own, and checks that it answers a message with the pine and the Node it carries, that `pine` works through a link, and that pine finds the helpers in the app |

pine itself runs on Node 24 or newer, also when the app starts it, and never on the app's own
Electron. The pine of a packed app runs on the Node the app carries. From a checkout the app
looks for `node` the way your shell finds it (it asks your login shell for its environment,
since an app started from the Finder has none of it); a packed app does the same for a pine
that is not its own, and falls back to its own Node where the Mac has none.

### The page in a browser

`npm run dev:preview` serves the app's page at `http://localhost:5173` (the port from `$PORT`),
for an editor's preview pane or any browser, without the app's window. It is a tool for
working on the app, not a way to use pine.

| How it is started | What it runs on |
|---|---|
| `npm run dev:preview` | A throwaway pine: a home in a temp folder with two agents (`main` and `scout`) and the scripted model of pine's tests. The home and its daemon are removed when the preview stops |
| `npm run dev:preview -- --home <dir>` | That pine home, with its own models and conversations. The daemon that runs there is used and left running; if none runs, one is started and stopped with the preview. The home is never removed. `~` in `<dir>` is your home folder |
| `npm run dev:preview:home` | `--home ~/.pine` at `http://localhost:5174` (`$PORT` still wins). What you do in the page, your real agents do, with your real models, sources and files: a message is a real one |

`.claude/launch.json` has one entry for each, so that the preview pane of Claude Code starts the
one you name, and both can run side by side:

| Entry | Command | Port |
|---|---|---|
| `desktop-preview` | `npm run dev:preview` (the throwaway pine) | 5173 |
| `desktop-preview-home` | `npm run dev:preview:home` (your pine home) | 5174 |

The throwaway pine has neither a web browser nor your models, so what needs them (the agent's
browser in the side panel, an answer of a real model) is seen on `desktop-preview-home`.

The preview's server stands where the app's main process stands: it holds the daemon's token
and makes every call for the page, with the same checks, and it answers only the page on the
same computer. What only the app can do does nothing in a browser: menus, system
notifications, the dock badge, dictation, update checks, `pine` for a terminal, restarting
pine, setting pine up. To open a folder for a conversation you type its path.

## The daemon: started or reused

When the app opens it asks `pine service` ([operations.md](operations.md), "A UI of its own")
for the daemon of your home:

| What it finds | What happens |
|---|---|
| A pine is running for this home (started in a terminal, at login, by the terminal UI) | The app attaches to it. The side bar says `attached`. Quitting the app leaves it running |
| Nothing runs | The app starts one, as the terminal UI does, logging to `data/pine.log`. The side bar says `started here`. Quitting the app stops it, cleanly |
| There is no pine home yet | A first screen offers to set pine up (`pine init`): the example home and the browser its web tools drive |
| No Node, or no pine | A screen that says what to install |

Which pine it runs, in this order: what `PINE_CLI` names; the checkout the app lies in; the
pine packed into the app; the `pine` of your shell.

| Setting (Settings > App) | What it does |
|---|---|
| Keep pine running after the app quits | A pine the app starts goes on in the background when the app is closed: schedules fire, sources report and Telegram answers. It then runs until it is stopped (`pine status` finds it; the next start of the app attaches to it) |
| Home folder | Another pine home than `~/.pine`. Another home is another pine |
| pine in a terminal | Whether your shell has the `pine` command and whose it is; Set up and Remove for the app's own. See "`pine` in a terminal". Only in an app that carries pine |
| Appearance | Light, dark, or what the system is set to |
| Colours | The palette the window's colours are made from: the source colour (the accent), the neutral colour (the tint of the surfaces), the neutral variant colour (the tint of muted text and outlines), colour match, the scheme (while colour match is off), the contrast, the warning, info and keyword colours (their hue is kept, their shade follows light or dark), and whether code follows the palette (on by default: code in dark draws with the scheme's roles; off, it keeps the poimandres theme's own colours). Each change redraws the window at once; Reset brings back pine's palette. Kept with the app's other preferences, like Appearance: not in pine's configuration, and no agent sees it |
| Notifications | A system notification when an agent is done, stops with an error, needs your approval or asks you something while the window is not in front, also for a summon that no tab shows; a click opens that conversation. The words are pine's own ("main is done"), never the agent's |

Closing the window does not quit the app on a Mac: it, and a daemon it started, stay until
you quit (`⌘Q`). A daemon the app started that stops answering is started again.

## Environments: the pine of another machine

The app can use the pine of another machine instead of the one on this computer: a server, a
desktop at home, anything you reach with `ssh`. It uses one pine at a time. The foot of the side
bar says which (`pine 0.23.0 · started here`, or `pine 0.23.0 · server`): a click on it lists
This Mac and the machines you added, and Environments… leads to Settings > Environments, where
machines are added and forgotten. The palette (`⌘K`) has "Use the pine on …" too. In a terminal,
`pine --ssh <host>` does the same for the terminal UI ([tui.md](tui.md#the-pine-of-another-machine)).

| What | How |
|---|---|
| Add a machine | Settings > Environments: type the host as you would after `ssh` (`server`, `user@server`, a name from `~/.ssh/config`) and Add. Anything else (an option for ssh, spaces, `;`) is refused before ssh ever runs. It is connected to when you pick it |
| Use another pine | Pick it at the foot of the side bar, or Use on its line in Settings > Environments. The window shows that pine's agents, conversations and settings, and the tabs that pine keeps. The app remembers which one it used, and uses it again at its next start |
| Switch back | The pine you left goes on: switching stops nothing, so an agent at work there finishes its task. Going back to it is immediate. Approvals and notices of a pine you are not looking at wait until you switch to it |
| One that is not reached | The first screen says why (ssh's own words, and what to do), with Try again and Use this Mac |
| Forget a machine | Forget on its line (not the one in use). Its connection ends |
| Quitting | Every connection ends. A pine the app started on another machine stops with it; one that was already running there goes on. This computer's pine follows Keep pine running, as before |

What is chosen is kept in the app's `prefs.json`: `hosts`, the machines you added, and `use`,
the one in use (none: this computer's).

How it connects (`src/remote.ts`): one ssh connection to the machine runs `pine service` there,
with the PATH of your login shell there (sh, bash, zsh, fish, csh or tcsh) and nvm's node when
pine was installed with it. It attaches to the daemon that runs there or starts one, which that
connection then holds, as the app holds the one it starts here. Through the same connection a
port of this computer is forwarded to the daemon's port (`ssh -O forward` through its control
socket, so there is one sign-in): ssh binds that port itself, and when somebody else took it,
ssh says so at once and another is tried, so nothing is sent to a port that is not ssh's. The
forward ends at the other machine's loopback and nowhere else: a service line that names
another address is refused. So the control API there stays closed to the network, as it is
here: it takes requests for `127.0.0.1` only, and its token stays in the app's main process. A
connection that breaks is made again.

| Needs | |
|---|---|
| A key, not a password | The app has no terminal to type a password in (`BatchMode=yes`): a key in `ssh-agent` (`ssh-add`), or an SSH service that signs you in by itself, such as Tailscale SSH |
| A machine ssh knows | The app cannot answer ssh's question whether a new machine's key is the right one: connect to it once from a terminal (`ssh user@server`) and accept the key |
| A pine with `pine service` | An older pine is not reached: update it there with `pine update` |
| A pine home there | `pine init` on that machine first |

What is this computer's stays this computer's. With another machine's pine:

| | |
|---|---|
| Folders | A conversation's folder is a path on that machine: choosing one asks for the path instead of opening the Finder, and a folder dropped from the Finder is refused. Show in the Finder is not offered |
| The terminal and Run | The terminal beside a conversation and the Run button of a command in an answer are shells of this computer: they are not offered, and that pine's agents are not told about them |
| The browser | The Browser aside shows the browser on that machine; an address you type there (`localhost:3000`) is one of that machine |
| Settings > App | About the app and this computer's pine (home folder, Keep pine running, the browser build). It says which machine's pine is in use |

## The window

```
 ● ● ●          ◧   M main   M main · notes ×   ⚙ Settings   +           ← tabs
 ⌕ Search and commands ╭──────────────────────────────╮ ╭───────────────────────╮
 Agents              + │ M main / notes   ▢ ~/dev/x  7% ◨ │ Changes Last turn Files … │
 ▾ M main            + │                              │ │                       │
     the main agent    │        what do the notes say?│ │  M index.ts  src +1 −1│
     ★ main conversation ▸ 1 tool call · read · 148 ms│ │                       │
     ○ notes           │ The notes say first line.    │ │                       │
 ▸ B books     ⠹     + │ ╭──────────────────────────╮ │ │                       │
 ▾ S scout           + │ │ Message main · / · @     │ │ │                       │
     ★ main conversation │ + ▣ m  ✳ off  ⛨ safe  ▢ x ↑│ │ │                       │
 ⌇ Events  ⚙ Settings  │ ╰──────────────────────────╯ │ │                       │
 ● pine 0.22 · started here ──────────────────────────╯ ╰───────────────────────╯
```

The panels lie as cards on the window: the conversation, beside it the code panel, and at the
far right the browser.

**The side bar is your agents.** Each agent is a group: its name and what it is for, and under
it its conversations. Everything that starts something new stands on the agent's own line, so
it is never a question whom it is for.

| On an agent's line | What it does |
|---|---|
| A click on the agent | Folds its conversations away, or shows them again. The app remembers which groups are folded. A folded agent still shows that it is at work (a spinner), waits for you (`!`) or has something new (a dot) |
| `+` | A new conversation with that agent |
| The folder (when the pointer is on the line) | Opens a folder of yours for a new conversation with that agent |
| The gear (when the pointer is on the line) | That agent's page in the settings |
| A right click | A new conversation, a folder and the settings as a menu, and **Remove** for every agent but the main one, which administers pine and stays. Remove asks first, and how: with everything the agent has, or with its folder kept |
| `+` beside "Agents" | A new agent |

An agent that somebody else makes while the app is open (the main agent when you ask it to,
`pine agent add`, the terminal UI) appears in the side bar within a few seconds, and one that
is removed goes, with its tabs. A conversation in which an agent is at work has a spinner
whether or not a tab shows it.

**Summons** are listed below the agents, in a group of their own: the conversations that a
summon started (an event of a source you subscribed with trigger words, such as
`/pine kevin summarise this`; see "Summoning pine from somewhere else" in the sources
reference), whichever agent took it, newest first. Each line names the agent and what you asked.
A summon opens no tab and does not interrupt what you are doing. When a summoned agent is done,
stops with an error, needs your approval or asks you something, a system notification says so
in pine's own words ("main is done with a summon"), even though no tab shows it, and its line
in the group carries `!` while it waits. A click on the notification, or on the line, opens
that conversation, and what it waits for is asked there.

Where no agent is named, the app goes by the tab in front, and asks when that is not an
agent's:

| You do | With whom |
|---|---|
| `⌘T`, or `+` at the end of the tabs | The agent of the tab in front (the button says which). From the settings or the event log you are asked with whom |
| `⌘O`, or a folder put on the app's icon | With one agent, that one. With several you are asked which agent works in the folder; the one in front is offered first |
| `⇧⌘T` | Always asks with whom |

| Part | What it is |
|---|---|
| Side bar | Search at the top, then your agents, then your summons (see above). Drag its right edge to make it wider or narrower, or focus the edge with Tab and use the arrow keys (a double click on the edge sets it back), `⌘B` hides it and shows it again (in a window narrower than 768 pixels it opens it over the page instead: see the table below), and it is after a restart as you left it; where nothing is to click, it moves the window. An agent's own conversation (`main conversation`) comes first, then pinned ones, then by when they were last used. A click on a conversation opens it in a tab, and so does Enter: Tab reaches an agent's line (Enter or Space folds it) and then its conversations, where the arrow keys move; a right click offers Pin, Rename, Remove (or Start over for an agent's own). At the bottom: the event log, the settings, and whether pine answers |
| Tabs | One conversation each, with its agent's initial, as in the terminal UI: a spinner while the agent works, a dot when something arrived while you were elsewhere, `!` when it waits for your approval, `★` for a conversation that is kept for good. Drag a tab to move it. They are the same tabs the terminal UI opens: the daemon keeps the list |
| Conversation | A conversation in which nothing was said yet shows who its agent is: what it is for, its model and mode, whom it hands work to, and how many skills, event sources, schedules and MCP servers it has. Then your messages, the agent's answers drawn as markdown, and the work of each turn (tool calls, thoughts, sub-tasks, what it said on the way) folded into one line that a click opens (it stays open while the turn runs, with its last lines). A `↳ … ↗` line opens a sub-agent's or delegated task's work in a tab of its own. A request of the agent's waits in the conversation with its buttons until it is answered, then becomes a line. Above your last message a line offers to take it back (**Take back**, `/undo`). Scrolled up, the conversation holds still while the answer goes on, and a button at its foot brings you back to the end |
| Input | `↩` sends; while the agent works the message is given to that work, and `⌥↩` makes it wait its turn. `⇧↩` is a new line, `↑` brings back earlier inputs, `esc` stops the agent. `/` offers the commands of the terminal UI, `@` the files of the conversation's folder |
| The line at the top of a conversation | Whose it is and which (`main / notes`), the folder it works in, how full its context is (tokens read and the share of the window; hover for the cache share and speed) |
| The top right of the title bar | Two buttons: the side panel (`⌥⌘B`) and the browser (`⇧⌘B`). Each is pressed while what it shows is open. A click opens what is closed, closes what is in front, and brings to the front one that is open but behind the other (in a window narrower than 1024 pixels the sheet covers these buttons: there `⌥⌘B` and `⇧⌘B` do it). On a tab that is not a conversation (Settings, Events) both stay in their place and cannot be pressed |
| The bar under the input | `+` attaches files (or drop them on the input; a dropped folder is opened for the conversation); then the agent's model, how much it reasons and its mode, and where the conversation works (the agent's own workspace, or a folder of yours). The model and the folder open a list to search, the reasoning and the mode a menu right above the button. `outside content` appears when the conversation has read something from outside; each button says what it is in a tooltip |
| Side panel | Beside a conversation (`⌥⌘B`): the agent, then its files, changes and output. See "The code panel and the editor" |
| Browser | At the far right of the window, after the side panel (`⇧⌘B`): the browser the agent of the conversation works in. Drag its left edge to make it wider or narrower; its width is its own, apart from the side panel's. Its `×` closes it. See "The browser" |
| Search | `⌘K`, or Search in the side bar: see "Finding a conversation" |

The window can be made as narrow as a phone (360 pixels). Where there is no room for columns,
the side bar, the side panel and the browser lie over the conversation instead of beside it. What you chose
(side bar shown or hidden, side panel and browser open or closed) and how wide you dragged them is kept, and a
wide window puts them back as they were. Whether the side panel and the browser are open is the same
for every conversation.

| Window | Side bar | Side panel and browser |
|---|---|---|
| 1024 pixels and wider | A column | A column each. Both at once where the room beside the side bar is 1100 pixels or more; with less, only the one you opened last, the other open behind it |
| 768 to 1023 | A column | Over the conversation, from the right: `esc`, a click beside it or its `×` closes it. With both open, only the one you opened last lies there, and the other stays open behind it. The sheet covers the buttons of the title bar, so its key (`⌥⌘B` or `⇧⌘B`) brings the other to the front. Closing the one in front does not bring the other up: it stays open behind, shown as a column when the window is wide again, or as a sheet by its key |
| Narrower than 768 | Over the page, from the left, when its button at the top left or `⌘B` asks for it. Picking a conversation, `esc` or a click beside it puts it away; `⌘B` there does not hide the column of a wide window | As above: the whole width of a window narrower than 640 pixels, and at most 540 pixels wide from 640 to 767 |

With both the side panel and the browser open and less room than they need side by side (a sheet each,
or less than 1100 pixels beside the side bar), neither comes first: the one you opened last shows, and
the other is open behind it. Its button is pressed more lightly. In a window 1024 pixels and wider a
click on that button brings it to the front and puts the other behind, and a click on the button of
the one in front closes it, which shows the other again. Below 1024 pixels each is a sheet over the
conversation, which covers the buttons of the title bar: there only `⌥⌘B` and `⇧⌘B` switch, and
closing the sheet in front does not bring the other up. The other stays open behind, and shows as a
column when the window is wide enough, or as a sheet by its key. The agent's `browser_show` and a port's link under Running open the browser in front.
Narrowing the window never closes anything: when there is room again, both show without a click.

Settings follow the room they have, not the window: narrower than about 720 pixels, the list of
pages is a row along the top that scrolls sideways, and a setting's control goes under its text.

### Finding a conversation

`⌘K` (or Search at the top of the side bar) is one box for everything. Type a few words:

| It finds | By |
|---|---|
| A conversation | Its name, and what was said in it: your messages and the agent's answers. A conversation found by what was said opens with the words marked in it (`↩` goes to the one before, `⇧↩` to the next) |
| An open tab, an agent, a settings page | Its name |
| A command | Its name, or what it does |

What fits by its name comes first, then the conversations in which the words were said (each
with who said it and the place), then the rest. The search over what was said covers the last
thousand tasks of all agents, which is what the daemon hands out at once; an older message is
found by opening its conversation and using `⌘F` there.

A conversation you only started (`+`) has no name of its own. The app calls it by how it
began: the first thing you said in it, in the side bar, on its tab and in the search. Give it a
name with Rename (a right click, or `/rename`) and that name is used.

A right click on one of your messages offers "Branch from here": a new conversation with what
was said up to the end of that message's turn, opened in a tab, while the original stays as it
was. Branch in the menu of a conversation in the side bar does the same with all of it.
A branch stands under the conversation it was made from in the side bar, with the branch
sign, and is called after it ("… · branch") until you rename it. The line at the top of a
conversation is a path: the conversations it was branched from, oldest first, then the
conversation itself, then where it works (its worktree's branch or its folder); a click on one
before it opens that conversation. A sub-agent's task shows the conversation it worked for and
the task that started it the same way. What a branch takes along
and what it does not is in [agents.md](agents.md#branching-a-conversation).

A conversation can work in a worktree of its folder's repository: a checkout of its own, so
that conversations working on one project at once do not write over each other's files
([coding.md](coding.md#a-worktree-for-a-conversation)). File › New Conversation in a
Worktree… (⌥⌘T) starts one, from the folder of the conversation in front or one you pick;
Conversation › Worktree… moves the conversation in front into one, and "Branch from here into a
worktree" (a right click on a message of yours) or "Branch into a Worktree" (the menu of a
conversation in the side bar) branches into one. Its header shows the branch (`pine/<name>`)
instead of the folder, and the side bar the branch sign. A click on the branch, Conversation ›
Worktree… or "Worktree…" in the side bar's menu opens what can be done with it: merge or squash
it into what it was made from, update it from there, ask the agent to commit, discard it. The
Changes view of the panel says how many commits it is ahead, with a button to merge.

Everything in [tui.md](tui.md) about modes, goals, approvals, an agent's questions, its list
of steps, sub-agents, `/undo` and what a conversation is holds here unchanged: it is the
daemon's doing. What differs is how it is drawn and reached.

| In the terminal UI | In the app |
|---|---|
| `/model`, `/reasoning`, `/mode`, `/folder` | Also the bar under the input, and the Conversation menu |
| `/sessions`, the conversation list | The side bar |
| `/code` | The side panel (`⌥⌘B`), which begins with the agent and also edits |
| `/mcp`, `/sources`, `/subscribe` | Also Settings > MCP servers and Settings > Events |
| `/attach <path>`, `/paste` | Files from the Finder put on the input, a picture pasted into it, or the `+` in the bar under the input |
| `/export` | Asks where to save the file |
| `/voice`, `ctrl+r` | The microphone in the bar under the input, or `⌃R` |
| `/quit` | `⌘Q` |
| `shift+tab` (next mode) | The same, while the input is empty |
| `alt+1` … `alt+9` | `⌘1` … `⌘9`; `⌃⇥` is the next tab |

### What the app adds

| | |
|---|---|
| Pictures, video, sound | A picture an answer points at is shown as it is; a click enlarges it. A video gets the system's own player controls, with sound. A sound is a line of its own, with bars, that plays by itself when its answer arrives: see "A sound in an answer" below |
| Files from the Finder | Files put on the input with the mouse are attached to the next message (up to 10 files of 20 MB each); a folder put there is opened for the conversation, as with `/folder`. A folder put on the app's icon in the Dock opens a conversation that works in it, as `pine <folder>` does |
| Menus and keys | Everything is in the menu bar, with its key |
| Notifications | See the settings above. The app's icon carries the number of conversations that wait for you |
| Find | `⌘F` marks what you look for in the conversation |
| A Material 3 palette | Every colour of the window is a role of one Material 3 scheme, generated from poimandres' mint (the source), night blue (the neutral) and blue grey (the neutral variant), light and dark alike, or from your own colours (Settings > App > Colours). Code in an answer, in a diff and in the editor follows the palette too, in light and dark; turn off "Code follows the palette" to keep poimandres' own colours for code in dark |
| Several views at once | A conversation, its changes and a file in the editor side by side |
| A terminal | A shell of yours beside each conversation, and ▶ on an answer's shell code blocks to run them in it: see "The terminal" |
| `/browser` | A command of the app's own, which the terminal UI does not have: the browser at the right of the window (`⇧⌘B`, View > Toggle Browser). See "The browser" |

### A sound in an answer

An agent points at a sound file in its workspace the way it points at a picture,
`![caption](hello.wav)` (wav, mp3, m4a, ogg or flac, up to 100 MB), and the conversation shows
one line for it: a button to play and to pause, a row of bars, its name (the caption, or the
file's name), where it is and how long it runs. It is the sound line of the terminal UI
([tui.md](tui.md), "Pictures"), and it behaves the same:

- A sound in an answer that arrives while you are looking at its conversation is played at
  once. One from earlier waits for a click: nothing starts when you open a conversation again
  or start the app again, and nothing starts for an answer that arrived in a conversation that
  was not in front. Of several sounds in one answer the first is played.
- The button pauses, and goes on from there. At the end the line is back at the start. One
  sound plays at a time: starting another stops the first, which goes back to its start.
- A sound goes on while you look at something else in the app, and its line shows where it is
  when you come back. To stop it, pause it in its line or start another one. It ends with the
  app.
- The bars show the sound itself while it plays: 24 of them, one for each range of pitch from
  low (80 Hz, on the left) to high (8 kHz, on the right), each as high as that range is loud
  at the moment being heard. They move while it plays, stand still at a pause, and lie flat
  and grey while nothing plays. Their height is measured against the loudest moment of that
  sound, so a quiet recording moves as much as a loud one.

The bars are worked out by the app when a sound is first played, from the file as the daemon
serves it: the app decodes it itself and measures it with the code the terminal UI uses, so
the bars are the same in both and nothing has to be installed for them (no `ffmpeg`). They
can come a moment after the sound started. A sound longer than ten minutes plays without
bars.

What is different from the terminal UI:

| | |
|---|---|
| An aiff file | The app does not play it; its line says "cannot be played here". The terminal UI does |
| A file that is not there | The same line, "cannot be played here" |
| A sound at a web address | A line to click, `Load audio · https://…`, as for a picture: the daemon fetches it then, and it plays when it is there |
| A sound file opened in the code panel (Files) | Has the system's own player controls, and does not start by itself |
| `▸ open in player` | Not in the app |

## The code panel and the editor

The panel beside a conversation (`⌥⌘B`) begins with the agent and goes on to its work. The
work is that of the folder the conversation works in (the folder you opened for it, else the
agent's workspace):

| View | Shows |
|---|---|
| Agent | The agent of this conversation: what it is for, its model, reasoning and mode (a click changes each), whom it hands work to; what is at work right now (this conversation, the sub-agents and delegated tasks it started, the agent's other conversations), each to open; what it listens to (event sources, and whether this conversation, the agent or all agents are subscribed); its schedules, skills and MCP servers; and what it remembers (its `MEMORY.md`). Buttons lead to the settings pages where each is changed |
| Files | The folder as a tree, a search by name, and the editor. The tree is one Tab stop: the arrow keys move, open and close folders, typing goes to a name, Enter opens a file; the search's results and the changes are lists the arrow keys move in the same way |
| Changes | What differs from the last commit (git): each file with its counts, and its diff on a click |
| Last turn | What your last message changed, whatever git says, with "Take back" (`/undo`) |
| Output | The tool calls of the last messages, each with all it printed |
| Running | What the conversation's commands left running (a dev server, a watcher): its ports as links, its last output, and Stop. A port's link opens that address in the conversation's browser, at the right of the window, where the agent sees the same page; only where the conversation has no browser does it open in your own |
| Terminal | A shell of your own for the conversation, in its folder: see "The terminal" below (`` ⌃` ``, View > Terminal, `/terminal`) |

While an agent keeps a list of steps, the open steps stand at the top of the panel.

**The editor.** A click on a file in Files (or "Edit" on a diff) opens it in an editor with
line numbers, colours for the common languages, search (`⌘F` in the editor) and undo.
`⌘S` saves. A file the agent changes while you look at it is shown anew; if you have typed
meanwhile, the app says that the file changed on disk and lets you take the new one. Files
over 2 MB and binary files are shown and not edited.

Saving goes through the daemon like everything else (`POST /agents/<id>/view/write`). The
daemon writes the file inside a sandbox that reaches only that folder, so that a link an agent
planted in its folder cannot make your save land somewhere else ([security.md](security.md)).
On a system without a sandbox the daemon does not write, and the app says so.

### The terminal

The Terminal view is a shell of your own beside the conversation, as in Terminal.app: your login shell (`$SHELL`) with your
environment, started in the conversation's folder (else the agent's workspace). It is not the
agent's: no sandbox, no mode, no approvals. The agent sees nothing of what you type there; it
hears only how a block you ran with ▶ went (below).

| | |
|---|---|
| One per conversation | Starts when the view is first shown, and keeps running while Pine runs: another view or tab leaves it as it is, with its scrollback |
| ↻ | Ends the shell and starts a new one. After `exit` it says so, with **Start it again** |
| When it ends | With the conversation's last tab, and when Pine quits |

**Run (▶, a play button).** A shell command block in an answer (```` ```bash ````, `sh`, `zsh`, `shell`, `fish`,
`ksh`) has ▶ beside its copy button: it shows the terminal and types the block there as a
paste, then Enter. Nothing runs without that press, and a block still streaming has none. A
block holding a character that does not show as itself (a control character, an escape
sequence, a direction override, a zero-width character) is refused, with the character named.
Other languages get no ▶. While a command runs in the terminal, ▶ is refused (the block would
go to that command): wait for it, or stop it with Ctrl-C.

**The agent hears how it went.** When a block run with ▶ has ended, the conversation gets a
message from pine with the command, how it ended (exit code, or Ctrl-C) and its last 30 lines of
output, and the agent goes on from there: it reads an error and says what to do next, or takes
the next step. A block that is still running after 10 seconds (a dev server, a watcher) is
reported once as running, with its output so far, and again when it ends. The agent never waits
for the terminal: its turn is over when it has written the block, and a report is a message that
comes later, after whatever it is doing. A command that never ends never ends anything else.

| | |
|---|---|
| What is reported | Only blocks run with ▶. What you type yourself is never reported |
| How the end is known | The shell is started with hooks that mark when a command starts and ends (zsh and bash, after your own startup files). Another shell runs ▶ blocks but does not report them |
| The report | A message of pine's own, not yours, with every line of output marked as output (`POST /agents/<id>/terminal`, [operations.md](operations.md)). In a conversation that has read outside content it keeps that mark |

For an agent: to hand the owner a command to run, put it in a block marked `bash`. In Pine it
gets ▶, and you are told how it went; elsewhere it is a block to copy. A message written in the
app says so to the agent (the app sends `"via": "app"`, and the agent's note says it is read in
the Pine app), so the agent writes such a block instead of a script to open or a command it runs
itself. For a series of commands that you have to run one after another, the agent is told to
give one at a time and the next one when it has heard how the last went, so that the next
command is always at the bottom of the conversation and not somewhere above.

## The browser

The browser (`⇧⌘B`, `/browser`, or its button at the top right of the title bar) shows the browser
of the conversation at the right of the window, after the side panel: the same one the agent opens
pages in, with its logins. In the terminal UI that browser has no window until the agent puts
one on your screen (`browser_show`); in the app it is in its own place beside the conversation,
and no other window opens. The side panel and the browser can be open at once, to watch the page
and the agent's changes together.

| | |
|---|---|
| What you see | The page the agent is on, as it is right now, a few times a second. The page is laid out for the room the browser has, so it is shown at its real size; drag its edge to make it wider and the page gets wider. The browser's tabs are a row of tabs above the page, the agent's and yours alike |
| What you can do | Click, type, turn the wheel, drag, paste (`⌘V` types what is in your clipboard), go back and forward, load again, open a tab (`+`), choose one, close one (closing the last one leaves the browser without a page, with its logins kept), and type an address into the line above the page. Enough to log in, solve a captcha or confirm something yourself |
| An address of your own | Opened like any other, through pine's guard. One on this computer or your network (`localhost:3000`) is allowed for this conversation by your typing it, as a yes to the agent's question would. pine's own control port stays closed |
| When the agent wants you to look | It calls `browser_show`: the browser opens at the right of the window, in front where there is room for one only. While the app runs, that call opens no window on your screen |
| What the agent knows | What you do there, it sees when it next looks at the page. When you took the browser to another page, the agent is told so before it acts, and does not act on a page it has not seen ([mcp.md](mcp.md), "Seeing the browser, and logging in yourself") |
| No page | Until the agent opens one, or you open an address, there is nothing to show. The browser of a conversation closes when the conversation has been idle for a while (`idleMs`, 15 minutes) and when pine restarts. Opening an address starts it again, without a turn of the agent's; its logins are kept |
| Running in this conversation | While no page is open, the view lists the ports of the programs this conversation left running (a dev server the agent started), as under Running. A click opens `localhost:<port>` in this browser |
| Opened by the agent before | While no page is open, the view lists the last addresses the agent opened in this conversation, newest first, at most 12. A click opens one. Only a page that came is listed, and never an address the agent was refused. The list is the conversation's: it goes when the conversation is reset or removed |

A page the agent made for you to use (a board, switches, a form) is shown here like any other,
and what you press on it wakes the agent ([interfaces.md](interfaces.md)).

It is a picture of the page, and not the page: nothing of a web page is loaded into the app's
window. So what a browser does around a page is not there: no downloads to your disk, no file
to choose for an upload, no passkey or system dialog, no copying out of the page, and text is
typed without an input method. For those, close the app's browser and ask the agent in
the terminal UI to show the browser, or set `"headed": true` for the browser.

## Settings

`⌘,` opens the settings panel in a tab of its own, beside the conversations (the same key puts
it away again; the event log is a tab in the same way). It is pine's configuration, changed by
clicking instead of by a command or by asking an agent. Each page asks the daemon what there is and tells it what to change.
The daemon checks a change as it checks the main agent's (the same code), writes it, reads the
configuration back, and undoes what does not load. You are not asked to confirm in a dialog
of pine's: the app is your own hand, like a `pine` command.

| Page | What you do there | The same by command or by asking the main agent |
|---|---|---|
| General | pine's settings, each by a name with its key in `pine.json` beside it and a sentence on what it does: the model, reasoning and mode agents start from, how long a command and a task may run, how many agents work at once, and what pine asks you about. What only tunes pine to a model server is not there: that is written into `pine.json` by hand ([setup.md](setup.md), "pine's settings"). And the notes `pine check` would print about this setup | `set_setting`; `pine check` |
| Agents | Every agent. On an agent's page: what it is for, its model, reasoning, mode, built-in tools, whom it may hand work to, network from its shell, folders outside its workspace, and the files it is told (`AGENTS.md`, `SOUL.md`, `TOOLS.md`; its `MEMORY.md` and your rules for it are shown). New agent; Remove, with or without its folder | `create_agent`, `update_agent`, `remove_agent`; `pine agent …` |
| Models | Model servers of your own (add by name and address, with its key when it wants one; remove). Providers: sign in through the browser or with an API key, sign out; after a sign-in, the choice of the model your agents run on. That model (`defaults.model`) with Change, and each agent whose model cannot answer with the reason. The models you can use now | `add_model_server`; `pine model …`, `pine login`, `pine logout`; `set_setting` |
| MCP servers | Every server with whom it is for and whether it connects. Add a remote one (its https address) or a program on this computer, for all agents or one. Sign in to a remote one through the browser. Remove | `add_mcp_server`; `pine mcp …` |
| Skills | Every skill with whom it is for. Read one, change it, add one for all agents or one agent, remove one. A skill that lies in a folder of yours that the configuration names is shown and not changed | `add_skill`, `remove_skill`; `pine skills` |
| Events | **Sources**: what runs, who is subscribed, the last event; add one by type (the type's options as a form, what it will do said before it is added, a password or token typed into a field of its own), subscribe an agent or all agents, end a subscription, remove. **Schedules**: add (at set times, every so often, once), remove. **Routes**: add, remove | `add_source`, `subscribe`, `add_schedule`, `add_route`; `pine sources`, `pine subscribe`, `pine schedules` |
| Instructions | The three files for all agents in pine's home: `AGENTS.md`, `TOOLS.md`, `USER.md` | Telling the main agent something that is for all agents |
| Environments | This computer and the machines whose pine the app can use, over SSH: add one by its host, use one, forget one. See "Environments: the pine of another machine" | `ssh` to the machine and `pine` there |
| App | The app's own settings (appearance, colours, notifications, whether there is a newer app and whether that is asked at the start), and the pine it talks to: started here or attached, restart, home folder, the `pine` command for a terminal, and whether the browser of the web tools is on this Mac, with Fetch it when it is not | `pine browser-install` |

A secret you type on these pages (a model server's key, a source's token, a provider's API
key) goes from the field to the daemon and from there into pine's `.env` or `auth.json`. It is
not shown again, not kept by the app, and never reaches an agent or a model.

An app that is newer than the pine it attached to says so where a page needs something that
pine does not know yet ("this pine does not know that yet: it is older than the app"): update
pine and restart it.

## Dictating a message

On a Mac the microphone in the bar under the input (or `⌃R`, or `/voice [language]`) dictates
the message, with the helper the terminal UI uses: the words are recognised on the Mac itself,
and what is heard is text in the input until you send it. `↩` ends the listening, `esc` throws
away what was heard, and a key that types ends it too. Everything under "Dictating a message"
in [tui.md](tui.md) holds here, also what the first use asks for and what to do when it does
not work. On another system there is no microphone in the bar.

## What the app is careful about

The page in the window draws what agents write, and an answer can repeat what a web page told
the agent to write. So:

| | |
|---|---|
| The page has no token and no Node | The daemon's token stays in the app's main process, which makes each call for the page. The page runs in the browser's sandbox, without access to files or programs |
| An answer is content, not a page | It is drawn from markdown (Streamdown, with code coloured on the page by Shiki) and cleaned of everything that could act or restyle: scripts, styles, forms, frames, svg, media tags, style, class and id attributes, `javascript:` links. A small picture written into the text (`data:` png, jpeg, gif, webp) is shown. The window's own policy lets it load nothing from the web |
| A link says where it leads | The address stands next to a link whose words are not the address, and only `http` and `https` addresses open, in your browser |
| Nothing is fetched because an answer contains it | A picture at a web address is a line to click (`Load picture · https://…`); the daemon then fetches it, with its guard against addresses in your network. A picture at a path in the agent's workspace is shown from there |
| Nothing plays because an answer contains an address | A sound plays by itself only where it is a file of the agent's workspace, which the daemon serves, and its answer has just arrived. One at a web address is a line to click, like a picture |
| What is drawn straight from the daemon | Only pictures, video and sound, by fixed addresses of the control API. The bars of a sound are measured from the same bytes, which the app asks the daemon for; the page reads no file |
| Notifications and the window's title | pine's own words only |
| What is heard | Text for the input: never sent by itself |
| A code block's Run button | Only your click types a block into your terminal, and only a block whose every character shows as itself: an answer cannot run anything by itself, nor hide a part of what it runs. What the agent hears back is that block's output, quoted, and nothing you typed |
| The window stays the app | It cannot be taken to another address, and opens no further windows |
| The agent's browser beside a conversation | A picture, drawn; its address and titles as text. The browser is the agent's own, another program behind pine's guard: the app hands the daemon what you did in the picture (places, keys, an address), and the browser's own server checks each piece before anything is done |
| What the app itself asks the web | One thing: GitHub, for pine's last release (see "A newer version"). The question carries nothing about this Mac, your pine or the app's version. Of the answer only the release's number is used, and the link you get is made by the app and leads to pine's releases on GitHub, whatever was answered |

The app does not reach into pine's home: it reads no configuration file and no token file
itself. What it knows, the daemon told it.

## Packing and signing

`node scripts/pack.mjs` (in `desktop/`; `npm run pack`) makes the app that is handed out.

| Flag | What it does |
|---|---|
| `--dmg` | Also a disk image, `release/Pine-<version>-<arch>.dmg` |
| `--arch` | `arm64` or `x64`: the kind of Mac the app is for. Without it, the kind it is packed on. The helpers are built for both either way |
| `--no-pine` | Without pine, Node and the helpers: the app then uses the `pine` of the owner's shell |
| `--out` | Into another folder than `release/`, for a build beside one that is open |

What goes into `Pine.app/Contents/Resources`:

| Folder | What it is |
|---|---|
| `pine/` | The package `npm run build` makes, with its dependencies installed, and the helpers built by `scripts/helpers.mjs` in `prebuilt/` folders beside their sources (pine looks there before it builds one: `src/prebuilt.ts`) |
| `node/` | `bin/node` and its licence from nodejs.org, in the version of the Node that runs the pack script, checked against the checksums nodejs.org publishes |
| `bin/pine` | The launcher for a terminal (`scripts/pine.sh`) |

The app is always signed with the hardened runtime, so that what is tried on the Mac it was
built on is what is shipped. Whom it is signed for is set in the environment:

| Variable | What it is |
|---|---|
| (none) | Signed for this Mac only ("ad hoc"). Another Mac refuses to open it |
| `CSC_NAME` | The name of a "Developer ID Application" identity in the keychain |
| `CSC_LINK` | The same certificate with its key as a `.p12` file: a path, or the file as base64. With `CSC_KEY_PASSWORD`, its password |
| `APPLE_API_KEY` | The path of an App Store Connect API key (`.p8`). With `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` the signed app is notarised by Apple, which a downloaded app needs to open |
| `PINE_VERSION` | The version of the app and of the pine inside it. Without it, the version in the checkout's `package.json` |

The Release workflow (`.github/workflows/release.yml`) does this for every release from
`main`, on a runner for each kind of Mac, and attaches the two disk images to the GitHub
release. It takes the five values from secrets of an environment named `release`. Without
them it builds no app and says so. To build the app of a release again (after a job that
failed), run the workflow by hand from `main` with that release's version:
`gh workflow run release.yml -f version=0.38.0`. Nothing is published; the disk images are
attached to that release. Building the helpers takes the macOS 26 SDK or a newer one.

## For changing the app

```
desktop/
  electron/
    main.ts        the main process: the window, menus, dialogs, notifications; the daemon's token
                   and every call of the control API; the two addresses the page may load from
    daemon.ts      what the page may ask the daemon for, without Electron: a call's check and
                   forwarding, the media served straight from the daemon (`MEDIA`), the live events
                   in batches, the page's content security policy
    preload.ts     the bridge: the short list of things the page may ask the main process for
    service.ts     finds node and pine, runs `pine service`, keeps the daemon it started
    command.ts     `pine` for a terminal: the link into the shell's PATH, made and removed
    updates.ts     whether there is a newer app: GitHub asked for the last release, the link to its page
  src/             the page (React)
    model.ts       what the page knows: tabs, what each conversation shows, the daemon's live events
    api.ts         the control API, typed
    App.tsx        the window: side bar, tabs, the dialogs for keys, updates and the browser
    ApprovalDialog.tsx, QuestionDialog.tsx     a request for the owner's approval, a question of an agent's
    Palette.tsx, PickDialog.tsx  everything by name, a choice from a list
    Conversation.tsx, Composer.tsx, markdown.tsx     a conversation, the input, an answer drawn (a picture
                   in either opens larger in a stock Dialog of its own)
    CodePanel.tsx  changes, files and the editor, output, what is running
    Browser.tsx    the agent's browser in its aside: its page as a picture, and what is done in it handed back
    Settings.tsx   the settings pages
    commands.ts    the commands: one list for the palette, the menus and what is typed after a slash
    components/ui/ shadcn's components, as its CLI added them (`npx shadcn@latest add <name>`)
    components/    only what stock components cannot express when composed in place (printed.tsx:
                   what a tool or a program printed, a Code Block that follows its end; sound.tsx:
                   a sound's line, its player and its bars, measured with src/tui/levels.ts), and pine's
                   own small parts (logo.tsx: the logo; empty-view.tsx: a view with nothing in it);
                   no part there only renames or bundles a stock one
    use-load.ts    loading what a view shows
    lists.tsx      the look of a row of the tree of files and of the lists to open a row from,
                   which are ui-sdk's, used directly (shadcn has neither); and the chosen line of
                   a palette's list, named to screen readers (`useNamedLine`)
    index.css      the only stylesheet: pine's mapping of shadcn's tokens to M3 roles on top of
                   material-theme-builder's, the code colours (`--code-*`: M3 roles, and poimandres in
                   `.dark[data-code=poimandres]`), the page's density and a few base rules
                   (components.json is shadcn's configuration: Base UI, lucide icons)
    theme.ts       the `.dark` class on the root element, from the Appearance setting: Light or Dark
                   by itself, System by the system's appearance; pine's palette (`DEFAULT_PALETTE`), which
                   `<Mtb>` turns into the M3 scheme in main.tsx and in Storybook's preview; and
                   `cleanPalette`, which makes a stored or sent palette safe field by field
    preview-bridge.ts  the page's stand-in for the preload's bridge, in the preview only
                   (`npm run dev:preview`): it calls the preview's server under `/__pine/`
  .agents/skills/  shadcn's agent skill, as `npx skills add shadcn/ui` installed it (locked in
                   skills-lock.json; .claude/skills links to it for Claude Code)
  scripts/         build, dev, pack, the icon, the smoke test of a packed app, pine.sh (the
                   launcher that becomes Resources/bin/pine), preview.ts (the page in an ordinary
                   browser, `npm run dev:preview`: Vite's server makes every call for the page,
                   on a throwaway pine or the home `--home` names)
  test/            the app from end to end, driven through its real window; command.test.ts,
                   updates.test.ts, daemon.test.ts and preview.test.ts need no window
```

- The page asks for something new through `preload.ts` and a handler in `main.ts`, never by
  getting more of the system. A handler checks that the call comes from the app's own page.
  `src/preview-bridge.ts` implements it too: it returns the `Bridge` type, so a missing method
  fails `npm run check`. If it needs the daemon, `scripts/preview.ts` routes it under `/__pine/`.
- What the daemon can do is added to the control API (`src/http.ts`, `src/owner.ts`) with a
  test there, then to `api.ts`. The app never does a daemon's work itself.
- Text an answer or a tool produced is drawn through `markdown.tsx` or as plain text, never
  set as HTML anywhere else. `markdown.tsx` replaces three of Streamdown's defaults, which are
  not safe here: the cleaning rules (`CLEAN`), links and pictures. After an upgrade of
  Streamdown, read its defaults again and run the desktop suite: its markdown test fails
  without each of the three.
- A new thing the owner can see or do gets a test in `desktop/test/`, which starts the real
  app on a home of its own.

### How the page is drawn

The page is React with Tailwind v4 (through its Vite plugin) and shadcn's components on Base UI.
There is no hand-written stylesheet: everything is utilities in the components, and `index.css`
holds only tokens and base rules.

| Piece | What it is for |
|---|---|
| shadcn (`src/components/ui/`) | Every control and overlay: buttons, switches, fields, selects, tabs, dialogs, alert dialogs, the command palette, notices (Toast), the combobox, resizable panels, collapsibles, badges, alerts. |
| shadcn's core chat components (`src/components/ui/`), composed per shadcn's AI Elements patterns | The conversation, composed in `Conversation.tsx`: Message Scroller (the thread), Message, Bubble and Attachment (the turns), Trace (the work of a turn, tool calls, thoughts, sub-tasks, steps), Code Block (what a tool returned), Item (a request waiting for you), Marker (notes, dividers, the goal, the line above the input, the point to take back to), Hover Card and Progress (how full the context is). The input, in `Composer.tsx`, is the Prompt Input pattern: an Input Group with the attached files as Attachments above the text, the goal and dictation as Alerts, and the reasoning and the mode as the Model Selector pattern's Dropdown Menus. The code pane's output (`CodePanel.tsx`) is a Code Block, with the terminal's colours. AI Elements' own registry serves code written on Radix and has none on Base UI, so it is never added: its pages say which core components a pattern uses, and pine composes them in its own files. |
| Streamdown | Answers drawn from markdown, with code coloured by Shiki. `markdown.tsx` replaces three of its defaults (see below). |
| lucide | Every icon. The pine logo is the one drawing of pine's own (`Logo` in `components/logo.tsx`). |
| usehooks-ts | `useMediaQuery`: the breakpoint of the side panel and the browser (`ROOM`). Nothing that stock shadcn already has a hook for. |
| ui-sdk (`@ui-sdk/react`) | Only what shadcn has no component for: the tree of files and the lists of rows (`src/lists.tsx`). Never a piece shadcn has (no second dialog, button or select). |

- A stock shadcn component is never edited. Add and update them with the shadcn CLI
  (`npx shadcn@latest add <name>`; `--diff` shows what changed upstream); the project's style is
  declared in `components.json`. Everything is on Base UI: no file of the page imports Radix.
- Prefer the stock component as it is, with its own look, written where it is used: a confirmation
  is stock AlertDialog at its place, work in progress is stock Spinner. There is no wrapper that only
  renames or bundles stock components. `src/components/` holds only a composition stock cannot
  express in place, and wraps the stock one; add one or a style override only for what stock
  cannot do.
- Sizes and spacing are Tailwind's default scale and shadcn's defaults, never arbitrary values.
  The page's density is one `font-size` on `:root` in `index.css`: every rem size (text, spacing,
  components) follows it, so no component sets a font size of its own. Corners come from shadcn's
  `--radius`. The one size that is not on the scale is the room for a Mac's window buttons at the
  start of a bar along the top (`pl-window-buttons`, a token in `index.css`): the window says where
  the buttons end (`titleBarOverlay` in `electron/main.ts`, read as `env(titlebar-area-x)`), so it is
  none in full screen, in an ordinary browser (the preview, Storybook) and on another system.
- Colours come from Material 3, through material-theme-builder. `<Mtb>` (from
  `material-theme-builder/react`) wraps the page in `main.tsx` and every story in
  `.storybook/preview.tsx`; it writes the scheme of pine's palette (`DEFAULT_PALETTE` in `theme.ts`:
  source `#5de4c7`, poimandres' mint; neutral `#1b1e28`, its night blue; neutral variant `#767c9d`,
  its blue grey; colour match off and the tonal spot scheme; and the custom colours `warn`, `info` and
  `plan`, the warning, info and keyword colours, whose hue is kept while the shade follows light or
  dark) into the page as `--md-sys-color-*`, light on `:root` and dark on `.dark`. Colour match is off
  because with it the package uses M3's content variant, as Google's Material Theme Builder does, and
  that variant divides a neutral's chroma by 8: the night blue would come out grey.
  pine has no colour names of its own. A component uses shadcn's token where one means the same
  (`text-foreground`, `text-muted-foreground`, `bg-muted`, `border-border`, `bg-primary`,
  `text-destructive`, `bg-accent`...), and otherwise an M3 role through the package's Tailwind plugin
  (`material-theme-builder/tailwind`: `text-outline` for faint text, `bg-surface-container-high`,
  `border-surface-container-high` for a soft line, `text-warn`, `text-info`, `text-plan`); where a
  name is both, shadcn's wins. A tint or a state layer is a role with Tailwind's opacity modifier:
  `bg-primary/12` for a soft background, `bg-on-surface/8` for hover and `bg-on-surface/12` for press.
  A role of the scheme, never a literal colour, is what a new colour points at.
  shadcn's tokens come from the package's `shadcn.css`, and pine overrides them in `index.css`, after
  it and with its doubled selectors. That mapping is pine's own reading of the bridge between shadcn
  and M3, chosen token by token as the role closest to how the app looked before M3, not the
  package's: popovers are surface container low, secondary surface container high with the text
  colour on it, muted surface container, the border, the side bar's border and inputs surface
  container highest, the charts the primary, info, plan, warn and error. The focus ring is the
  outline (grey, never the primary), the side bar is surface container low made translucent, hover
  and press (`--accent`, `--sidebar-accent`) are state layers of the text colour over the surface,
  and the side bar's text is muted. Light has one refinement of its own on top of the generated
  scheme (`:root:not(.dark)` in `index.css`, which wins over the package's `:root` and never touches
  dark): tonalSpot at contrast 0 gives light a near-white, cool-violet, nearly flat band where the
  shell, the cards and the inputs read as one grey and hairlines vanish, so pine sets light's surface
  ramp, on-surface, outline and primary itself — a cleaner, faintly teal-cool neutral with room between
  its steps, so a card lifts off the shell and a border is seen, and a primary a shade fresher than the
  generated deep teal while it stays AA on white. The other literal colours are the shadows and the
  poimandres `--p-*` values, which colour code in dark only while the owner keeps them for it.
- The code colours (`--code-*` in `index.css`) are read by the editor's theme and highlight style
  (`CodePanel.tsx`) and by the highlighter's theme for code in answers (`CODE_THEME` in
  `markdown.tsx`, a Shiki theme whose colours are those variables, one theme for both looks), so
  code looks the same everywhere. In light they are M3 roles; in dark too while "Code follows the
  palette" is on (`codeFollowsPalette` in `prefs.json`, on unless it is `false`), with the plain text
  on surface variant below the names on surface, and regular expressions, attributes and namespaces
  on tertiary, as poimandres tells them apart. Off, the page puts `data-code="poimandres"` on the root
  element (`Themed` in `main.tsx`) and dark code is poimandres, token by token.
- The owner's palette (Settings > App > Colours) is an app preference, kept by the main process in
  `prefs.json` in the app's data folder (`palette`, beside `theme`) and set through the same `prefs`
  call. The main process checks each field when it is set and when it is read (`cleanPalette`: a
  colour is `#rrggbb`, colour match a boolean, the scheme one of material-theme-builder's variants,
  the contrast in [-1, 1], the custom colours exactly `warn`, `info` and `plan`); a field that is
  wrong is pine's default. Reset stores no palette. The page hands the stored palette, or
  `DEFAULT_PALETTE`, to `<Mtb>`. The window's background before the page draws is the palette's
  surface for the appearance, computed with material-theme-builder's `builder` (on a Mac the window
  is transparent behind its vibrancy). The preview keeps the palette in its stand-in for the bridge,
  in memory.
- Dark mode is the `.dark` class on the root element (`dark:` utilities), which `theme.ts` sets from
  the Appearance setting: Light or Dark by itself, System by `prefers-color-scheme`. The page reads
  the setting and not only the query because in the preview nothing drives the query; in the app the
  same setting also sets Electron's native theme, for the window and the system's own controls.
- Tests and the few rules that reach into a component select by shadcn's `data-slot` attributes
  and by roles, not by utility classes. Where nothing stock tells one of pine's own elements
  apart, it carries a `data-slot` of its own (`composer`, `code-panel`, `tab`...), never a bare class.
- Streamdown's defaults are not safe here (pictures from the web, a download button, links opened
  by the page, cleaning rules that drop `data:` pictures). `markdown.tsx` replaces three of them:
  the cleaning rules (`CLEAN`), the link and the picture. On every upgrade of Streamdown, read its
  defaults again and run the desktop suite: its markdown test fails without each of the three.

### Stories and Chromatic

Buttons, switches, inputs, fields, toggle groups (the segmented controls), selects, the edges that resize
the side bar, the code panel and the browser (Resizable), the side bar itself (Sidebar, fixed in place with
`collapsible="none"` in a wide window and stock's own sheet, `offcanvas` with its `openMobile` and the
breakpoint of its `useIsMobile`, in a narrow one: its header, groups, menu buttons, badges and actions),
the side panel and the browser over a conversation in a narrow window (Sheet), the title bar's buttons for them (Toggle) and the agents' groups in it
(Collapsible) are shadcn's own components (`src/components/ui/`, added with the shadcn CLI and left as they are), and the icons
are lucide's. The page has three ways to follow the window's width, each in one place: stock `useIsMobile`
(768 pixels) for the side bar in `App.tsx`, `useMediaQuery` of usehooks-ts (1024 pixels, `ROOM` in `model.ts`) for the side panel in
`CodePanel.tsx` and the browser in `Browser.tsx`, and container queries on their own width (`@container/settings`) for the settings. A new
breakpoint uses one of the three, not a fourth way. They have no stories of their own. What shadcn has no primitive for (a tree, a list
of rows to open) is ui-sdk's (`@ui-sdk/react`), used directly, with the row's look from `src/lists.tsx`; ui-sdk is never used for a
piece shadcn has. The two meet in the side bar: each agent's list is a ui-sdk list drawn as the
stock `SidebarMenu` (`render`), and each row is the stock `SidebarMenuButton` drawn as the list's
option, so the rows look like the side bar's and the arrow keys move between them.
The side bar's colours are the `--sidebar*` tokens in `index.css`, set from M3 roles: rows are
muted (on surface variant), the one in front pressed (the text colour at 12%), and its background is left to the window behind it (the system's
material on a Mac). A story sits beside the file of what it shows: `src/<File>.stories.tsx`
for a file of `src/`, `src/components/<name>.stories.tsx` for a composition there (titled
`Components/<Name>`: `Components/Logo`, `Components/EmptyView`). One story per part and state,
named after it (`PickDialogRemoving`); a dialog or a whole view is in its own
(`src/PickDialog.stories.tsx`, `src/Composer.stories.tsx`).
None needs Electron or a daemon. A view that calls `api.ts` or the bridge is drawn on
stand-ins: the bridge in `.storybook/preview.tsx` is one whose every call does nothing.

| Command (in `desktop/`) | What it does |
|---|---|
| `npm run storybook` | Storybook at http://localhost:6006. The Theme menu in its toolbar shows light or dark whatever the system says (it sets the `.dark` class), or follows the system. |
| `npm run build-storybook` | The stories built into `storybook-static/`. |

Every pull request and every push to `next` publishes the stories to Chromatic
(`.github/workflows/chromatic.yml`), which shows what changed in a picture for review. It
needs the repository secret `CHROMATIC_PROJECT_TOKEN`; without it the job says so and passes.
Chromatic takes each story in light and dark, each at a phone's width (360, the window's
smallest) and at the window's first width (1280), through its modes (`.storybook/modes.ts`,
which set the `theme` global and a viewport), so no dark or phone twin of a story is written:
four snapshots a story. The same two widths are the Viewport menu in Storybook's toolbar.
