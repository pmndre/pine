# The desktop app

pine has an app with a window of its own, for macOS, Linux and Windows: **Pine**. It does what the terminal UI
does (conversations in tabs, the work of a turn, approvals, the code panel) and adds an editor
for the files of a conversation's folder, a settings panel for everything that is otherwise a
`pine` command or a sentence to the main agent, pictures, video and sound shown and played as
they are, menus and system notifications.

It lies in `desktop/` of pine's repository and is built on Electron, so that the same app runs
on the three systems. It is a client of the daemon and nothing more: everything
it shows and changes goes through the control API ([operations.md](operations.md)), as with
the terminal UI and the `pine` commands. A conversation you have in the app is the same one
the terminal UI or Telegram shows.

## Getting it

The app is attached to pine's releases, a file for each system and kind of processor:
<https://github.com/pmndre/pine/releases/latest>

| File | For |
|---|---|
| `Pine-<version>-arm64.dmg` | A Mac with Apple silicon (M1 and later) |
| `Pine-<version>-x64.dmg` | A Mac with an Intel processor |
| `Pine-<version>-x64.AppImage`, `Pine-<version>-arm64.AppImage` | Linux, any distribution: one file that runs where it lies (make it executable first: `chmod +x`) |
| `Pine-<version>-x64.deb`, `Pine-<version>-arm64.deb` | Debian and Ubuntu: installed with `sudo apt install ./Pine-<version>-x64.deb`, into `/opt/Pine`, started as Pine from the system's list of apps |
| `Pine-<version>-x64-setup.exe`, `Pine-<version>-arm64-setup.exe` | Windows 10 and 11: an installer for your user alone, which asks for no administrator. It puts Pine into `%LOCALAPPDATA%\Programs\Pine` (or a folder you choose) and into the Start menu |

On a Mac, open the image and drag Pine into Applications. Nothing else has to be installed: no
Node, no `npm install`, no developer tools. The Mac app is signed and notarised, and the app
carries on every system

| | |
|---|---|
| pine | The same package that goes to npm, with what it depends on. The app and the pine inside it have one version |
| Node | The Node that pine runs on, as nodejs.org hands it out. The pine of the app runs on it, whatever Node the Mac has or lacks |
| pine's helpers | The small programs for dictating, app control and the `system` event source. On a Mac they are Swift programs, built for both kinds of Mac. On Windows they are C# programs, built with the compiler every Windows carries; the app carries them built. On Linux they are pine's own code (Node and Python) and use what the system has (D-Bus, AT-SPI, whisper.cpp): nothing is built |
| `pine` for a terminal | See below |

An Android phone has an app of its own in the same release, for the pine of another machine
([mobile.md](mobile.md)).

### A newer version

The app does not update itself: it says when there is a newer one and where it is. To get it,
download the new file from the release's page, quit Pine and put the new app in place of the
old one (on Windows, run the new installer). Your pine home (`~/.pine`: agents, conversations, settings) is not in the app and
stays as it is.

| | |
|---|---|
| At the start | The app asks GitHub once for pine's last release. When that is newer than the app, a line at the foot of the side bar says so (`Pine <version> is available`); a click opens the release's page on GitHub in your browser. Nothing is said when the app is the latest, or when nobody answers |
| `Check for Updates…` | In the **Pine** menu (and `updates` in the command palette): asks again now and says what it found, with the link to the release's page when there is a newer app |
| Settings > App | The app's version and whether it is the latest, **Check now**, and the switch **Look for a newer version at the start** for the question at the start. The menu asks whatever the switch says |

A release counts as a newer app once its file for your system and processor is attached to it
(the disk image on a Mac, the AppImage on Linux, the installer on Windows), which is some minutes
after pine itself is published. A preview of pine is not a release, and
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
there. With it, everything in [operations.md](operations.md) works in a terminal on that
computer: the terminal UI, `pine status`, `pine agent add`. On a Mac and on Linux the command is
a link in a folder of your shell's PATH to a small launcher inside the app, which runs the app's
pine on the app's Node. On Windows the installer puts the app's folder of that launcher
(`resources\bin`, with `pine.cmd`) into your user's PATH instead.

| When | What happens |
|---|---|
| The first start of the app from Applications | The link is made by itself where that needs no password: in `~/.local/bin` or `~/bin` if your PATH has one of them, else in `/usr/local/bin` or `/opt/homebrew/bin` if you may write there |
| No such folder | Nothing is done by itself. **Pine > pine in a Terminal…** in the menu, or Settings > App, sets it up in `/usr/local/bin`; macOS asks for your password |
| Your shell already has a `pine` (from npm, from a checkout) | It is left alone, and the app says where it is. The app still runs its own |
| The app was opened from the disk image or from Downloads | Nothing is set up: macOS runs it from a place that changes. Move it into Applications first |
| The app was moved | The old link leads nowhere. Set it up again in Settings > App |

Settings > App shows where the link is and takes it away again (Remove). Only a link the app
made is ever removed or replaced.

On Linux and Windows:

| System | What happens |
|---|---|
| Linux, from the .deb | As on a Mac, with Linux's folders: `~/.local/bin` first, then `~/bin`, then `/usr/local/bin` where you may write there. Otherwise **Set up** puts it into `/usr/local/bin`, and the system asks for your password (`pkexec`); on a system without `pkexec` Settings > App says the command to type with `sudo` |
| Linux, from an AppImage | The AppImage runs from a folder under `/tmp` that is another one at each start, so the link leads to the AppImage file itself. Started by the name `pine`, the AppImage runs the pine it carries instead of the app. Move the AppImage where it is to stay before you set the command up: moved later, the link leads nowhere. It needs a desktop session (the app's program starts the command) |
| Windows | Nothing to set up: the installer puts the folder into your PATH, and uninstalling takes it out again; only your user's PATH is changed, never the system's. Open a new terminal after installing. Settings > App says whether the folder is on the PATH, and whether another pine (from npm) comes first there. In PowerShell, cmd.exe and Git Bash alike, `pine` is `pine.cmd` |

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

That writes the app for the system it runs on: `desktop/release/mac-arm64/Pine.app` on a Mac
(`release/mac/Pine.app` on an Intel Mac), `release/linux-unpacked/` (`linux-arm64-unpacked` on
arm64) on Linux, `release/win-unpacked/` (`win-arm64-unpacked`) on Windows. `npm run dist` also
makes what is handed out there: the disk image, the AppImage and the .deb, the installer. On a
Mac it is signed for the Mac it was built on. See "Packing and signing" for what it carries and
how it is signed for others. An app for Linux is packed on Linux, one for Windows on Windows.

| Command (in `desktop/`) | What it does |
|---|---|
| `npm start` | Builds the app and opens it |
| `npm run dev` | Opens it with the page served by Vite, reloading on every change. It ends, with the app and the daemon the app started, when whatever started it is gone. Its page is served at this checkout's own port (`scripts/launch-json.mjs`); `$PORT` overrides it, and the next free one is taken when it is in use |
| `npm run dev:preview` | The app's page in an ordinary browser, reloading on every change, on a throwaway pine. `-- --home <dir>` puts it on that pine home instead. See below |
| `npm run dev:preview:home` | The same on your own pine home, `~/.pine`, at the port after the throwaway one's, so that it runs beside it. Its agents are your real ones. See below |
| `npm run check` | Type check |
| `npm test` | The app from end to end: the real app on a pine home of its own with a scripted model. Needs a screen. The app is built once for the run, into a temp folder of its own that every test starts (`scripts/test.mjs`, `test/support/app.ts`), two test files at a time, two minutes at most for a test. A test file run on its own with `node --test` builds for itself. With `PINE_LIVE=1` on a Mac it also dictates with the real voice helper, from a recording |
| `npm run pack` | The app for this system (`release/mac-arm64/Pine.app`, `release/linux-unpacked/`, `release/win-unpacked/`), with pine, Node and on a Mac the helpers inside |
| `npm run dist` | The same, and what is handed out: a disk image, an AppImage and a .deb, an installer |
| `node scripts/smoke.mjs` | Starts a packed app from a folder of its own, on a home of its own, and checks that it answers a message with the pine and the Node it carries, that the terminal runs and a Run block reports, that `pine` works through a link (on Windows through `pine.cmd`), and on a Mac that pine finds the helpers in the app. On the system the app was packed for |

pine itself runs on Node 24 or newer, also when the app starts it, and never on the app's own
Electron. The pine of a packed app runs on the Node the app carries. From a checkout the app
looks for `node` the way your shell finds it (it asks your login shell for its environment,
since an app started from the Finder has none of it); a packed app does the same for a pine
that is not its own, and falls back to its own Node where the Mac has none.

### The page in a browser

`npm run dev:preview` serves the app's page at `http://localhost:<port>`, for an editor's preview
pane or any browser, without the app's window. It is a tool for working on the app, not a way to
use pine. The port is the checkout's own, made from its path (`scripts/launch-json.mjs`: between
5200 and 5902), so that two checkouts on one Mac (git worktrees) rarely share one: there are 176
blocks of ports, picked by a hash of the path. `$PORT` wins. When the port is taken, the preview
refuses to start, and `PORT=<another port>` starts it. The preview says where it answers. It ends, with its throwaway pine, when whatever
started it is gone, also when that was not a signal (an editor or an agent session that ended).

| How it is started | What it runs on |
|---|---|
| `npm run dev:preview` | A throwaway pine: a home in a temp folder with two agents (`main` and `scout`) and the scripted model of pine's tests. The home and its daemon are removed when the preview stops |
| `npm run dev:preview -- --home <dir>` | That pine home, with its own models and conversations. The daemon that runs there is used; if none runs, one is started that goes on after the preview, as with the app's "keep pine running". The preview never stops that daemon and never removes the home. `~` in `<dir>` is your home folder |
| `npm run dev:preview:home` | `--home ~/.pine`, at the port after the throwaway preview's (`$PORT` still wins). What you do in the page, your real agents do, with your real models, sources and files: a message is a real one |

`.claude/launch.json` has one entry for each, so that the preview pane of Claude Code starts the
one you name, and both can run side by side. It is not kept in git: `npm install` in `desktop/`
writes it with the checkout's ports (`node scripts/launch-json.mjs` does it by hand, and the
preview writes it when it is missing), keeping any entry of another name. The preview pane needs
the file before it can start the preview: after pulling this change (git removes the file it
tracked before), or when the pane lists no `desktop-preview`, run `node desktop/scripts/launch-json.mjs`
from the root, or `npm install` in `desktop/`.

| Entry | Command | Port |
|---|---|---|
| `desktop-preview` | `npm run dev:preview` (the throwaway pine) | the checkout's own |
| `desktop-preview-home` | `npm run dev:preview:home` (your pine home) | the next one |

The throwaway pine has neither a web browser nor your models, so what needs them (the agent's
browser in the side panel, an answer of a real model) is seen on `desktop-preview-home`.

The preview's server stands where the app's main process stands: it holds the daemon's token
and makes every call for the page, with the same checks, and it answers only the page on the
same computer. What only the app can do does nothing in a browser: menus, system
notifications, the dock badge, dictation, update checks, `pine` for a terminal, restarting
pine, setting pine up. To open a folder for a conversation you type its path.

## The daemon: started or reused

You do not have to start pine first: the app starts it, on a Mac, on Linux and on Windows alike.
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
| Theme | The window's colors: one of the themes in the `themes` folder of pine's home, dark ones and light ones. It is pine's setting `ui.theme` (see "Themes" below), so every Pine app on that pine shows it, and the main agent can change it when you ask. A theme file pine cannot read is named under the list, with what is wrong with it |
| Notifications | A system notification when an agent is done, stops with an error, needs your approval or asks you something while the window is not in front. The words are pine's own ("main is done"), never the agent's |

Closing the window does not quit the app on a Mac: it, and a daemon it started, stay until
you quit (`⌘Q`). On Linux and Windows closing the window quits the app. A daemon the app
started that stops answering is started again; one it started is stopped by closing its input,
so that it closes its database before it ends, on every system.

## Themes

A theme is a VS Code color theme: the `.json` file nearly every editor theme is published as, with
`type` (dark or light), `colors` (the editor's surfaces, text and accents) and `tokenColors` (code, by
TextMate scope). They lie in the `themes` folder of pine's home, one file each, and a theme is named
by its file: `one-dark-pro.json` is `one-dark-pro`. `ui.theme` in `pine.json` says which one is in
force; pmndre when it names none.

| Theme | Kind |
|---|---|
| `pmndre` | dark, pine's own and the default: poimandres with pine's colors |
| `one-dark-pro`, `dracula`, `tokyo-night`, `catppuccin-mocha`, `nord`, `github-dark`, `gruvbox-dark` | dark |
| `github-light`, `one-light`, `catppuccin-latte`, `solarized-light`, `rose-pine-dawn` | light |

pine puts these into the folder the first time it starts without one (and `pine init` does).
After that the folder is yours: a theme you delete stays deleted, and pmndre is there even without
its file. To add a theme, copy its `.json` into the folder and pick it in Settings > App: a theme's
file is in its VS Code extension (in its repository, usually under `themes/`), and Shiki's
collection (`@shikijs/themes`, the `tm-themes` repository) has many more. Comments and trailing
commas in the file are fine. A theme that builds on another file (`include`) cannot be read; use one
that holds all of its colors.

pine reads the colors that mean the same as one of its own (`editor.background`,
`editor.foreground`, `descriptionForeground`, `sideBar.background`, `editor.selectionBackground`,
the accent from `button.background`, `activityBarBadge.background`, `progressBar.background`,
`textLink.foreground` or `focusBorder`, whichever is a color and stands out, `editorError.foreground`,
`gitDecoration.*`, `terminal.ansi*`) and code by scope (`keyword`, `keyword.control`, `storage.type`,
`string`, `constant.numeric`, `entity.name.function`, `entity.name.type`, `comment`...), and derives
the rest from those. A theme can say what pine should use for any of its colors in an object of
its own, which editors ignore:

```json
{ "name": "Mine", "type": "dark", "colors": { ... }, "tokenColors": [ ... ],
  "pine": { "brand": "#7aa2f7", "faint": "#565f89", "code-keyword": "#bb9af7" } }
```

| `pine` key | What it colors |
|---|---|
| `bg`, `surface`, `raised`, `sunk`, `composer`, `side` | The page, cards and the input, buttons, what lies below (the side bar off a Mac), the side bar on a Mac (translucent) |
| `text`, `text-muted`, `faint` | Text, quieter text, the quietest (hints, times, icons) |
| `line`, `line-soft`, `hover`, `press`, `select` | Borders, soft dividers, a row under the pointer, a row in front, selected text |
| `brand`, `brand-soft`, `on-accent` | The accent (what is on or at work), its tint, text on it |
| `warn`, `bad`, `info`, `plan`, `add`, `del` (and `warn-soft`, `bad-soft`, `add-bg`, `del-bg`) | Warnings, errors, renamed files, keywords, added and removed lines |
| `code-<kind>` | Code: `text`, `comment`, `keyword`, `control`, `definition`, `modifier`, `string`, `regexp`, `literal`, `null`, `name`, `attribute`, `function`, `call`, `type`, `namespace`, `tag`, `operator`, `punctuation`, `heading`, `link`, `inserted`, `deleted`, `gutter`, `cursor`, `match`; `code-meta-style` and `code-attribute-style` are `italic` or `normal` |
| `term-0` … `term-15`, `term-bg`, `term-fg` | The terminal's sixteen colors, its page and its text |

An agent can have a color of its own (on its page under Agents, or ask the main agent: "make scout
blue"). Its avatar is drawn in it in every theme, in the side bar, on its tabs and on its
page; the rest of the window keeps the theme's colors.

A value is a hex color, `#rrggbb` or `#rrggbbaa`. Settings > App lists a file pine cannot read with
what is wrong with it. The theme is pine's setting, not the app's: every Pine app that uses this pine
shows it, the main agent can set it (`set_setting ui.theme`), and with another machine's pine
(Settings > Environments) the window takes that pine's theme.

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
| Connecting | Connecting to another machine's pine is one wait: the first screen says "Connecting to <host>", with the list of machines, and stays until that pine's agents are loaded ("Loading its agents…"), so the window never shows an empty pine in between |
| One that is not reached | The first screen says why (ssh's own words, and what to do), with Try again and Use this Mac, or Disconnect where it is offered |
| Agents that do not load | When the pine was reached but its agents could not be loaded, the first screen says "Could not load the agents of <host>" ("Could not load your agents" for this computer's) with the reason, Try again, and the list of machines with Disconnect where it is offered |
| Forget a machine | Forget on its line (not the one in use). Its connection ends |
| Disconnect | Only where the page runs without a machine of its own and its bridge offers it (`disconnect`): the web client today, not the Pine app, and not the mobile app yet. It lets go of the machine in use and goes back to the list of machines; the machine and its trusted host key stay, unlike Forget. It is in the machines menu of the title bar, on the line of the machine in use in Settings > Environments, and on the first screen, also while the machine is not reached or its agents did not load |
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

On Linux and Windows the window has no title bar of the system's: the bar of tabs reaches the
top, as on a Mac, and the system draws its window controls (minimise, maximise, close) over its
right end, in the theme's colors; the bar keeps room for them. The menus are not shown there:
everything in them is in the palette (`Ctrl+K`), and their keys work. The keys are the Mac's
with `Ctrl` for `⌘`, written the system's way: `⌘T` is `Ctrl+T`, `⇧⌘T` `Ctrl+Shift+T`, `⌥⌘B`
`Ctrl+Alt+B`, and the app says them so in its tooltips, menus and the palette. Where this manual
says `⌘`, read `Ctrl` there. A folder dropped on the app's icon, or given to it in a terminal
(`Pine <folder>`), opens a conversation that works in it. The taskbar button on Windows has a dot
while something waits for you; on Linux the number is shown where the desktop shows numbers on
an app's icon.

**The side bar is your agents.** Each agent is a group: its name and what it is for, and under
it its conversations. Everything that starts something new stands on the agent's own line, so
it is never a question whom it is for.

| On an agent's line | What it does |
|---|---|
| A click on the agent | Folds its conversations away, or shows them again. The app remembers which groups are folded. A folded agent still shows that it is at work (a grey dot that pulses), waits for you (`!`) or has something new (a dot) |
| `+` | A new conversation with that agent |
| The folder (when the pointer is on the line) | Opens a folder of yours for a new conversation with that agent |
| The gear (when the pointer is on the line) | That agent's page in the settings |
| A right click | A new conversation, a folder, **Rename** (its name in the side bar turns into a field: Enter or leaving it renames the agent, Escape keeps the name), **Color** (its colors open over its avatar, and a pick is kept at once) and the settings as a menu, and **Remove** for every agent but the main one, which administers pine and stays. Remove asks first, and how: with everything the agent has, or with its folder kept |
| `+` beside "Agents" | A new agent |

An agent that somebody else makes while the app is open (the main agent when you ask it to,
`pine agent add`, the terminal UI) appears in the side bar within a few seconds, and one that
is removed goes, with its tabs. A conversation in which an agent is at work has a grey dot that pulses
whether or not a tab shows it; every such dot in the window pulses in step.

Where no agent is named, the app goes by the tab in front, and asks when that is not an
agent's:

| You do | With whom |
|---|---|
| `⌘T`, or `+` at the end of the tabs | The agent of the tab in front (the button says which). From the settings or the event log you are asked with whom |
| `⌘O`, or a folder put on the app's icon | With one agent, that one. With several you are asked which agent works in the folder; the one in front is offered first |
| `⇧⌘T` | Always asks with whom |

| Part | What it is |
|---|---|
| Side bar | Search at the top, then your agents (see above). Drag its right edge to make it wider or narrower, or focus the edge with Tab and use the arrow keys (a double click on the edge sets it back), `⌘B` hides it and shows it again (in a window narrower than 768 pixels it opens it over the page instead: see the table below), and it is after a restart as you left it; where nothing is to click, it moves the window. Under an agent come its groups of conversations, each with its conversations, then the conversations in no group. In each, an agent's own conversation (`main conversation`) comes first, then pinned ones, then by when they were last used, or by name: the agent's right click chooses (Sort by Last Used, Sort by Name), and the groups are sorted the same way. A click on a conversation opens it in a tab, and so does Enter: Tab reaches an agent's line (Enter or Space folds it), then a group's line (the same), then the conversations, where the arrow keys move; a right click offers Pin, Rename, Move to Group…, Remove (or Start over for an agent's own). Groups: see the next row At the bottom: the event log, the settings, and whether pine answers |
| Groups of conversations | A group keeps an agent's conversations in order, one level deep, and keeps them however long they are not used ([agents.md](agents.md#groups-of-conversations)). Make one with New Group… in the agent's right click. Drag a conversation onto a group's line or into its list to put it there, onto the agent's line or among the conversations in no group to take it out; it takes its branches along, and a branch is not dragged by itself. Without a mouse: Move to Group… in a conversation's right click, or `Move conversation to group` in the palette (`/group` in the input), for the conversation in front. A group's right click: New Conversation in it, Rename…, Remove Group…, which removes the group and every conversation in it for good after you confirm (an agent's own conversation stays, in no group). A folded group still shows when something in it waits for you, works or is new |
| Tabs | One conversation each, with its agent's initial, as in the terminal UI: a grey dot that pulses while the agent works, a dot when something arrived while you were elsewhere, `!` when it waits for your approval, `★` for a conversation that is kept for good. Drag a tab to move it. A right click on a tab offers Close (`⌘W`), Close Others, Close to the Right, Close All, and Pin or Unpin for its conversation; they are in the palette too (Close other tabs, Close tabs to the right, Close all tabs). Closing a tab only closes the view: the conversation stays in the side bar, and what was typed in its input and not sent is there again when you open it. Any tab can be closed, the agent's own conversation's and the last one too; with none open, the window says so and offers a new conversation or the main agent's. What waits for your answer is never left without a place: Close Others, Close to the Right and Close All leave a tab that waits open and say so, a tab closed by itself hands what it waits for to another tab (of the same agent if one is open, else the one in front), where its `!` and its buttons are, and the last tab that waits stays until it is answered. An approval that arrives with no tab open opens the agent's main conversation. They are the same tabs the terminal UI opens: the daemon keeps the list; when the app starts with none, it opens the main agent's conversation |
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
| `/emit <topic> [json]` | The same, and `/emit` alone or Publish… in the event log opens a form: the topic, and the payload in a field of its own, checked to be JSON before anything is sent |
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
| Themes | Any VS Code color theme, chosen in Settings > App: the window, code in answers, diffs and the editor, and the terminal all follow it. See "Themes" |
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
line numbers, colors for the common languages, search (`⌘F` in the editor) and undo.
`⌘S` saves. A file the agent changes while you look at it is shown anew; if you have typed
meanwhile, the app says that the file changed on disk and lets you take the new one. Files
over 2 MB and binary files are shown and not edited.

Saving goes through the daemon like everything else (`POST /agents/<id>/view/write`). The
daemon writes the file inside a sandbox that reaches only that folder, so that a link an agent
planted in its folder cannot make your save land somewhere else ([security.md](security.md)).
On a system without a sandbox the daemon does not write, and the app says so.

### The terminal

The Terminal view is a shell of your own beside the conversation, as in Terminal.app: your login shell (`$SHELL`) with your
environment, started in the conversation's folder (else the agent's workspace). Without `$SHELL` it is zsh on a Mac, your
account's shell on Linux (else bash), and on Windows PowerShell (`pwsh.exe`, PowerShell 7, where it is installed, else
the `powershell.exe` every Windows has). It is not the
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
| How the end is known | The shell is started with hooks that mark when a command starts and ends: zsh and bash (Git Bash's `bash.exe` too), after your own startup files; PowerShell after your profile, by wrapping its prompt and the line PSReadLine hands over, as VS Code's shell integration does (without PSReadLine nothing is reported). Another shell (cmd.exe, fish) runs ▶ blocks but does not report them |
| Keys in the terminal, off a Mac | The app's keys are `Ctrl` chords there, and so are the shell's own (`Ctrl+W` deletes a word, `Ctrl+K` the rest of the line, `Ctrl+R` searches). While the terminal has the keyboard, `Ctrl` and a letter go to the shell; `Ctrl+Shift`, `Ctrl+Alt`, `Ctrl` and a digit, `Ctrl+Tab`, `Ctrl+,` and `` Ctrl+` `` stay the app's. `Ctrl+Shift+C` copies what is selected in the terminal and `Ctrl+Shift+V` pastes, as in the system's own terminals |
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
| Agents | Every agent. On an agent's page: at the top its avatar, which opens its color (None, a preset, or Other with any color, kept at once: its avatar in the side bar, on its tabs, in its panel and on an empty conversation is drawn in it, and the window takes its primary while its conversation is in front), and its name, which a click turns into a field that renames it (Enter or leaving the field; Escape keeps the name); then its model, reasoning, mode, built-in tools, whom it may hand work to, network from its shell, folders outside its workspace, and the files it is told (`AGENTS.md`, `SOUL.md`, `TOOLS.md`; its `MEMORY.md` and your rules for it are shown). What it is for, beside its name in the side bar and in the list, is the first paragraph of its `AGENTS.md`. New agent (a name and its instructions, the first paragraph saying what it is for); Remove, with or without its folder | `create_agent`, `update_agent`, `rename_agent`, `remove_agent`; `pine agent …` |
| Models | Model servers of your own (add by name and address, with its key when it wants one; remove). Providers: sign in through the browser or with an API key, sign out; after a sign-in, the choice of the model your agents run on. That model (`defaults.model`) with Change, and each agent whose model cannot answer with the reason. The models you can use now | `add_model_server`; `pine model …`, `pine login`, `pine logout`; `set_setting` |
| MCP servers | Every server with whom it is for and whether it connects. Add a remote one (its https address) or a program on this computer, for all agents or one. Sign in to a remote one through the browser. Remove | `add_mcp_server`; `pine mcp …` |
| Skills | Every skill with whom it is for. Read one, change it, add one for all agents or one agent, remove one. A skill that lies in a folder of yours that the configuration names is shown and not changed | `add_skill`, `remove_skill`; `pine skills` |
| Events | **Sources**: what runs, who is subscribed, the last event; add one by type (the type's options as a form, what it will do said before it is added, a password or token typed into a field of its own), subscribe an agent or all agents, end a subscription, remove. **Schedules**: each schedule said as When and Then (whom it wakes, with what task); New schedule opens a form in the same words: When (at set times, every so often, once at a time, once after a while), Then which agent (or every agent) and the task, then a name; remove. **Routes**: first when you need one at all (an agent that reacts to a source is subscribed to it, a time is a schedule); each route said as When and Then; New route opens a form in the same words: When (the topic, an optional condition, how often), Then one of wake an agent, set shared state, publish an event, ask a model once and publish its answer, with only that one's fields shown and sent; remove | `add_source`, `subscribe`, `add_schedule`, `add_route`; `pine sources`, `pine subscribe`, `pine schedules` |
| Instructions | The three files for all agents in pine's home: `AGENTS.md`, `TOOLS.md`, `USER.md` | Telling the main agent something that is for all agents |
| Environments | This computer and the machines whose pine the app can use, over SSH: add one by its host, use one, forget one. See "Environments: the pine of another machine" | `ssh` to the machine and `pine` there |
| App | The app's own settings (the theme, notifications, whether there is a newer app and whether that is asked at the start), and the pine it talks to: started here or attached, restart, home folder, the `pine` command for a terminal, and whether the browser of the web tools is on this Mac, with Fetch it when it is not | `pine browser-install` |

A secret you type on these pages (a model server's key, a source's token, a provider's API
key) goes from the field to the daemon and from there into pine's `.env` or `auth.json`. It is
not shown again, not kept by the app, and never reaches an agent or a model.

An app that is newer than the pine it attached to says so where a page needs something that
pine does not know yet ("this pine does not know that yet: it is older than the app"): update
pine and restart it.

## Dictating a message

The microphone in the bar under the input (or `⌃R`, `Ctrl+R` on Windows and Linux, or
`/voice [language]`) dictates the message, with the helper the terminal UI uses: the words are
recognised on this computer itself (macOS's speech recognition, Windows' desktop recogniser,
whisper.cpp on Linux), and what is heard is text in the input until you send it. `↩` ends the
listening, `esc` throws away what was heard, and a key that types ends it too. It listens on
the computer the app runs on, also while the app uses the pine of another machine or of WSL.
Everything under "Dictating a message" in [tui.md](tui.md) holds here, also what each system
needs, what the first use asks for and what to do when it does not work: where a piece is
missing (whisper.cpp on Linux, a recogniser for the language on Windows), the microphone says
what to install. The phone apps have no microphone in the bar.

## What the app is careful about

The page in the window draws what agents write, and an answer can repeat what a web page told
the agent to write. So:

| | |
|---|---|
| The page has no token and no Node | The daemon's token stays in the app's main process, which makes each call for the page. The page runs in the browser's sandbox, without access to files or programs |
| An answer is content, not a page | It is drawn from markdown (Streamdown, with code colored on the page by Shiki) and cleaned of everything that could act or restyle: scripts, styles, forms, frames, svg, media tags, style, class and id attributes, `javascript:` links. A small picture written into the text (`data:` png, jpeg, gif, webp) is shown. The window's own policy lets it load nothing from the web |
| A link says where it leads | The address stands next to a link whose words are not the address, and only `http` and `https` addresses open, in your browser |
| Nothing is fetched because an answer contains it | A picture at a web address is a line to click (`Load picture · https://…`); the daemon then fetches it, with its guard against addresses in your network. A picture at a path in the agent's workspace is shown from there |
| Nothing plays because an answer contains an address | A sound plays by itself only where it is a file of the agent's workspace, which the daemon serves, and its answer has just arrived. One at a web address is a line to click, like a picture |
| What is drawn straight from the daemon | Only pictures, video and sound, by fixed addresses of the control API. The bars of a sound are measured from the same bytes, which the app asks the daemon for; the page reads no file |
| Notifications and the window's title | pine's own words only |
| What is heard | Text for the input: never sent by itself |
| A code block's Run button | Only your click types a block into your terminal, and only a block whose every character shows as itself: an answer cannot run anything by itself, nor hide a part of what it runs. What the agent hears back is that block's output, quoted, and nothing you typed |
| The window stays the app | It cannot be taken to another address, and opens no further windows |
| What the app starts | The daemon, `pine init`, the login shell it asks for your environment, and the shell in the terminal get none of the app's open files, sockets and pipes. On Linux a program keeps whatever its parent did not mark to be closed, and Chromium marks little: there each starts behind `bash`, which closes all but the three standard ones and then becomes the program. So nothing you start in the terminal, and nothing a profile leaves running (`ssh-agent`), holds the app's files after it has quit |
| The agent's browser beside a conversation | A picture, drawn; its address and titles as text. The browser is the agent's own, another program behind pine's guard: the app hands the daemon what you did in the picture (places, keys, an address), and the browser's own server checks each piece before anything is done |
| What the app itself asks the web | One thing: GitHub, for pine's last release (see "A newer version"). The question carries nothing about this Mac, your pine or the app's version. Of the answer only the release's number is used, and the link you get is made by the app and leads to pine's releases on GitHub, whatever was answered |

The app does not reach into pine's home: it reads no configuration file and no token file
itself. What it knows, the daemon told it.

## Packing and signing

`node scripts/pack.mjs` (in `desktop/`; `npm run pack`) makes the app that is handed out.

| Flag | What it does |
|---|---|
| `--dist` | Also what is handed out on this system: a disk image `release/Pine-<version>-<arch>.dmg` on a Mac, `Pine-<version>-<arch>.AppImage` and `Pine-<version>-<arch>.deb` on Linux, the installer `Pine-<version>-<arch>-setup.exe` on Windows |
| `--dmg` | The same as `--dist` (what the release of the Mac app runs) |
| `--dir` | The app alone, as a folder (the default): what `--prepackaged` takes |
| `--prepackaged <folder>` | The packages of an app that was packed before with `--dir`, without building anything again: for a release that signs the Windows app's programs in between and makes the installer of what was signed |
| `--arch` | `arm64` or `x64`: the kind of processor the app is for. Without it, the kind it is packed on. On a Mac the helpers are built for both either way |
| `--no-pine` | Without pine, Node and the helpers: the app then uses the `pine` of the owner's shell |
| `--out` | Into another folder than `release/`, for a build beside one that is open |

What goes into the app's resources (`Pine.app/Contents/Resources` on a Mac, `resources/` beside
the program on Linux and Windows):

| Folder | What it is |
|---|---|
| `pine/` | The package `npm run build` makes, with its dependencies installed, and on a Mac the helpers built by `scripts/helpers.mjs` in `prebuilt/` folders beside their sources (pine looks there before it builds one: `src/prebuilt.ts`) |
| `node/` | Node and its licence from nodejs.org, as it is handed out for that system (`bin/node`; `node.exe` on Windows), in the version of the Node that runs the pack script, checked against the checksums nodejs.org publishes |
| `bin/pine` | The launcher for a terminal (`scripts/pine.sh`); on Windows `bin/pine.cmd` (`scripts/pine.cmd`), whose folder the installer puts into the user's PATH (`scripts/installer.nsh`) |

On Linux the program is `pine-desktop` (not `pine`: a .deb puts it into `/usr/bin`, where the
pine command may be). Nothing is signed on Linux and Windows here; a release signs the Windows
app between `--dir` and `--prepackaged`.

The Mac app is always signed with the hardened runtime, so that what is tried on the Mac it was
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
    fds.ts         what a program the app starts gets of the app's own open files: on Linux, where
                   Chromium leaves them open across a start, nothing but its stdio: it starts
                   behind bash, which closes the rest and becomes the program (`withoutFds`)
    command.ts     `pine` for a terminal: the link into the shell's PATH, made and removed (on
                   Windows only looked for: the installer puts it there)
    terminal.ts, shell-hooks.ts  the owner's terminal beside a conversation, and the hooks of zsh,
                   bash and PowerShell that say how a command ended
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
                   own small parts (logo.tsx: the logo; empty-view.tsx: a view with nothing in it;
                   agent-avatar.tsx: an agent's initial on the stock avatar, in its own color);
                   no part there only renames or bundles a stock one
    use-load.ts    loading what a view shows
    lists.tsx      the look of a row of the tree of files and of the lists to open a row from,
                   which are ui-sdk's, used directly (shadcn has neither); and the chosen line of
                   a palette's list, named to screen readers (`useNamedLine`)
    index.css      the only stylesheet: pine's color roles (pmndre's values, until a theme sets
                   them), shadcn's tokens pointed at them, the code colors (`--code-*`), the
                   terminal's (`--term-*`), the page's density and a few base rules
                   (components.json is shadcn's configuration: Base UI, lucide icons)
    theme.ts       a theme as pine hands it over (`Look`), made safe (`cleanLook`: names of roles,
                   values that are colors) and set on the root element (`applyLook`: its variables,
                   and `.dark` for a dark theme); the preset colors of an agent (`AGENT_COLORS`), what
                   reads on a color (`onColor`)
    preview-bridge.ts  the page's stand-in for the preload's bridge, in the preview only
                   (`npm run dev:preview`): it calls the preview's server under `/__pine/`
  .agents/skills/  shadcn's agent skill, as `npx skills add shadcn/ui` installed it (locked in
                   skills-lock.json; .claude/skills links to it for Claude Code)
  scripts/         build, dev, pack, the icon, the smoke test of a packed app, pine.sh (the
                   launcher that becomes Resources/bin/pine), pine.cmd (Windows' launcher) and
                   installer.nsh (what the Windows installer adds: that folder in the PATH), preview.ts (the page in an ordinary
                   browser, `npm run dev:preview`: Vite's server makes every call for the page,
                   on a throwaway pine or the home `--home` names), test.mjs (`npm test`: the
                   app built once for the run), launch-json.mjs (the checkout's ports and
                   .claude/launch.json), leash.mjs (a preview or `dev` ends with its starter)
  test/            the app from end to end, driven through its real window; command.test.ts,
                   updates.test.ts, daemon.test.ts, preview.test.ts and fds.test.ts need no window.
                   support/: the build a test starts (app.ts), and a daemon of the test's own
                   told from another run's by its token (daemon.ts)
```

- The page asks for something new through `preload.ts` and a handler in `main.ts`, never by
  getting more of the system. A handler checks that the call comes from the app's own page.
  `src/preview-bridge.ts` implements it too: it returns the `Bridge` type, so a missing method
  fails `npm run check`. If it needs the daemon, `scripts/preview.ts` routes it under `/__pine/`.
- The page is also the Android and iOS app's ([mobile.md](mobile.md)): `mobile/src/mobile-bridge.ts`
  returns the same `Bridge` type, and so does the web client's (`web/src/frame-bridge.ts`,
  [web.md](web.md)). Four parts of the bridge are optional and only those two give them: `local: false` in `state()` (no machine of its own: the page hides This Mac, Use
  this Mac, Set up pine, the local row of Settings > Environments, the local-only parts of
  Settings > App and the palette's "Use the pine on this Mac", and never sends `use(undefined)`),
  `mediaBase` (where pictures, video and sound are fetched, in place of `pine-media://daemon`)
  `deviceKey` (the client's own SSH key, with Copy and Share in Settings > Environments) and
  `trustHostKey` (the owner's yes to the host key's fingerprint the page showed). A fifth,
  `disconnect` (let go of the machine in use and show the list of machines), only the web
  client gives; without it the page shows no Disconnect. Absent, the
  page is the desktop's as before. A change of the page is checked in all three: `npm run check`
  in `desktop/`, in `mobile/` and in `web/`.
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
| shadcn's core chat components (`src/components/ui/`), composed per shadcn's AI Elements patterns | The conversation, composed in `Conversation.tsx`: Message Scroller (the thread), Message, Bubble and Attachment (the turns), Trace (the work of a turn, tool calls, thoughts, sub-tasks, steps), Code Block (what a tool returned), Item (a request waiting for you), Marker (notes, dividers, the goal, the line above the input, the point to take back to), Hover Card and Progress (how full the context is). The input, in `Composer.tsx`, is the Prompt Input pattern: an Input Group with the attached files as Attachments above the text, the goal and dictation as Alerts, and the reasoning and the mode as the Model Selector pattern's Dropdown Menus. The code pane's output (`CodePanel.tsx`) is a Code Block, with the terminal's colors. AI Elements' own registry serves code written on Radix and has none on Base UI, so it is never added: its pages say which core components a pattern uses, and pine composes them in its own files. |
| Streamdown | Answers drawn from markdown, with code colored by Shiki. `markdown.tsx` replaces three of its defaults (see below). |
| lucide | Every icon. The pine logo is the one drawing of pine's own (`Logo` in `components/logo.tsx`). |
| usehooks-ts | `useMediaQuery`: the breakpoint of the side panel and the browser (`ROOM`). Nothing that stock shadcn already has a hook for. |
| ui-sdk (`@ui-sdk/react`) | Only what shadcn has no component for: the tree of files and the lists of rows (`src/lists.tsx`). Never a piece shadcn has (no second dialog, button or select). |

- A stock shadcn component is never edited. Add and update them with the shadcn CLI
  (`npx shadcn@latest add <name>`; `--diff` shows what changed upstream); the project's style is
  declared in `components.json`. Everything is on Base UI: no file of the page imports Radix.
- Prefer the stock component as it is, with its own look, written where it is used: a confirmation
  is stock AlertDialog at its place. Work in progress is the one exception, `Pulse`
  (`src/components/pulse.tsx`): a grey dot that fades out and in, every one in step, in place of stock Spinner. There is no wrapper that only
  renames or bundles stock components. `src/components/` holds only a composition stock cannot
  express in place, and wraps the stock one; add one or a style override only for what stock
  cannot do.
- Sizes and spacing are Tailwind's default scale and shadcn's defaults, never arbitrary values.
  The page's density is one `font-size` on `:root` in `index.css`: every rem size (text, spacing,
  components) follows it, so no component sets a font size of its own. Corners come from shadcn's
  `--radius`. The sizes that are not on the scale are the room for the window's buttons at the ends
  of a bar along the top, tokens in `index.css`: `pl-window-buttons` at the start for a Mac's, and
  `pr-window-controls` at the end for the window controls Windows and Linux draw over the page. The
  window says where they are (`titleBarOverlay` in `electron/main.ts`, read as `env(titlebar-area-x)`
  and `env(titlebar-area-width)`), so each is none where there are no such buttons: in full screen,
  in an ordinary browser (the preview, Storybook), and on the other systems.
- Every color is one of pine's roles, a variable in `index.css` (`--bg`, `--surface`, `--raised`,
  `--sunk`, `--side`, `--line`, `--line-soft`, `--text`, `--text-muted`, `--faint`, `--brand`,
  `--warn`, `--bad`, `--info`, `--plan`, `--add`, `--del` and their soft variants, `--select`,
  `--scrim`). shadcn's tokens point at them (`--background` is `--bg`, `--primary` `--brand`,
  `--accent` `--hover`, `--ring` `--faint`: what the keyboard was taken to is grey, never the accent;
  a click draws no ring, and a text field looks the same with the caret in it as without), and the
  ones shadcn has no name for are utilities of their own (`text-faint`, `border-line-soft`,
  `bg-press`, `bg-hover`, `text-warn`, `text-add`...). A new color points at a role, never at a
  literal color. The values in `index.css` are pmndre's: what the window shows before a theme is set,
  and in a page that has none.
- A theme sets them all. The daemon resolves the theme file (src/theme-colors.ts) into the roles, the
  code colors (`--code-*`) and the terminal's (`--term-*`), and hands the app only those, as
  `#rrggbb[aa]` (`GET /themes`). The page checks them again (`cleanLook` in `theme.ts`: a role's name,
  a color or a font style, nothing else) and sets them on the root element with `.dark` for a dark
  theme (`applyLook`). A theme is never CSS: no value from a file reaches the page as anything but a
  color.
- The code colors (`--code-*`) are read by the editor's theme and highlight style (`CodePanel.tsx`)
  and by the highlighter's theme for code in answers (`CODE_THEME` in `markdown.tsx`, a Shiki theme
  whose colors are those variables), so code looks the same everywhere and follows the theme. The
  terminal (`Terminal.tsx`) reads `--term-*`, the theme's own sixteen colors.
- The model asks pine for its themes when it connects, when Settings > App is opened, and when pine
  says a setting changed (`pine/settings`, published when the owner or the main agent sets one): the
  window follows a theme chosen in another UI. The main process keeps the last theme (`look` in
  `prefs.json`, made safe by `cleanLook` when it is set and when it is read): the window opens in it
  before pine answers, Electron's native theme (the window's frame, the Mac's materials, the system's
  own controls) is its kind, and off a Mac the window's background before the page draws is its page
  color. There is no light, dark or system setting: a theme is dark or light. Storybook draws the
  stories in pine's own themes (`.storybook/themes.ts`, resolved as pine resolves them), pmndre and
  GitHub Light for Chromatic's dark and light modes, and any of them from the toolbar.
- An agent may have a color of its own (`color` in its `agent.json`, picked on its avatar at the top
  of its page in Settings > Agents or with Color in the side bar's menu: None, nine presets apart
  from each other and from the mint, or Other with any color, saved as it is picked). The popover
  and the field that renames an agent in place are `src/components/agent-identity.tsx`; in the side
  bar, where the avatar lies inside the button that folds the group, the popover is anchored to a
  mark over the avatar that only the menu opens.
  `AgentAvatar` (`src/components/agent-avatar.tsx`) draws an agent's initial wherever the window
  shows one: without a color it is the stock avatar; with one, its fallback is the color itself with
  white or a near-black on it, whichever reads better (`onColor`), the same in every theme.
  An agent's color is its avatar's and nothing else's: the window keeps the theme's colors whoever
  is in front.
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
The side bar's colors are the `--sidebar*` tokens in `index.css`, set from pine's own: rows are
muted, the one in front pressed, and its background is left to the window behind it (the system's
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
