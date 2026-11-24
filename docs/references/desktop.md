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

Android phones and iPhones have an app of their own in the same release, for the pine of another
machine, this computer's included: it pairs as a browser does (see "Browser access" and
[mobile.md](mobile.md)).

### A newer version

The app updates itself. When there is a newer release, it downloads it in the background, from
that release on GitHub, and installs it with macOS's own updater, only when you say so: press
**Restart to update**, or quit Pine and the update is installed on the way out. It never
restarts by itself. Your pine home (`~/.pine`: agents, conversations, settings) is not in the
app and stays as it is.

| | |
|---|---|
| At the start | The app asks GitHub once for pine's last release. When that is newer than the app, it is downloaded without a dialog; a line at the foot of the side bar says **Downloading Pine <version>…**, then **Restart to update**. Nothing is said when the app is the latest, or when nobody answers |
| `Restart to update` | At the foot of the side bar, in Settings > General and in the dialog of **Check for Updates…**. Every pine this app started in this run is stopped first, also one kept with **Keep pine running**, so that it does not go on with the old version; the new app starts it again. A pine the app only attached to (started in a terminal or at login) is left alone: restart it yourself. While agents are working it first warns how many conversations would be cut off |
| `Restart when they are done` | The warning's choice beside **Restart now** and **Cancel**: **Restarts when the work is done** stays at the foot of the side bar until then. Click it there to call it off |
| Quitting | With an update downloaded, quitting Pine installs it. What stops with the app is what stops at any quit |
| `Check for Updates…` | In the **Pine** menu (and `updates` in the command palette): asks again now and says what it found. A newer release is downloaded, or ready to install with a restart |
| Settings > General | The app's version and whether it is the latest, **Check now**, the switch **Check for updates at start** for the question at the start, and the switch **Update automatically** (on unless you turn it off). The menu asks whatever the first switch says |
| `Pine <version> is available` | What the app says instead when it does not update itself: **Update automatically** is off, or the download or the install failed (one line says so, in the app's own words). A click opens the release's page on GitHub in your browser: download the disk image there, quit Pine and put the new app in place of the old one |

A release counts as a newer app once its disk image and its update feed for your kind of Mac
are attached to it, which is some minutes after pine itself is published. A preview of pine is
not a release, and the app never points at one. The address of the update is made by the app
from the release's version and your kind of Mac, on pine's GitHub releases, and macOS installs
only an app signed by the same developer as the one you run. The question and the update's feed
send the user agent `Pine` and nothing else; the zip itself is fetched by macOS's updater, whose
user agent names the app's version and the version of macOS. An app run from the disk image, or
from a folder it cannot write, cannot replace itself: it says so and links to the release's
page (move it to Applications). When **Update automatically** is turned off after an update
was downloaded, the app shows the release's link again, but macOS may still install that update
at the next quit. `pine update` in a pine that came with the app says that the app updates
itself, and links to the release's page. An app started from a checkout is no release, asks nobody and
installs nothing.

### The first start

Two things the app does not carry: a sign-in to whoever does the thinking, and the browser the
web tools drive. It asks for each where it is missing.

| What the app finds | What it does |
|---|---|
| No pine home | It offers to set pine up (`pine init`): the example home is copied, and the browser is fetched (about 600 MB, once) |
| The welcome | The app opens on the main agent's own conversation (`main` in a new home, with pine's mark as its picture), which begins with pine's welcome: that the main agent is pine's administrator and the one to ask, that agents come first (ask it for one for each purpose: coding, work, automation, chat), that the first conversation is kept and the others are cleared after a while unless pinned, the things pine is for (chatting, code, a folder, acting on events), a prompt to try (one that watches the Downloads folder, which puts its words into the input), and where pine keeps everything (its home, shown in the Finder with a click). pine wrote it, and it is never sent to a model. The terminal UI shows the same there while nothing was said in it yet |
| Nothing to answer with | A new home has nothing to run on: the agent's card at the top of a conversation says **Connect a model first**, with a button to Settings > Models (the main agent's too, above pine's welcome); that page lists every agent that cannot answer, with the reason (nothing connected yet, or nobody signed in to its provider). A message sent meanwhile says so; send it again once a model is there |
| A sign-in in Settings > Models | A Claude, ChatGPT or Copilot subscription is signed in to through the browser (**Sign in**), any provider with an API key. Where the choice in force cannot answer, pine switches to the provider's usual one (pi's choice) and the dialog says which, with **Another one…**; so does adding a server of your own. Otherwise nothing switches by itself and the dialog offers **Choose the model your agents run on**. The page keeps it (`defaults.model`) with **Change** |
| The first message | No agent writes first. Main, and every other agent, introduces itself in its answer to the first message you write to it. Once each; `defaults.introduce` turns it off ([agents.md](agents.md), "Meeting an agent") |
| The browser is not there in the build this pine drives | Each version of pine drives a browser build of its own. A home that an older pine set up, or a new app in place of an old one, has the old build or none. The app asks once for each version of pine whether to fetch it, and Settings > General shows whether it is there, with **Fetch it** (`pine browser-install`, run by the app's pine). Until then the browser tools do not work; web search and reading a page do |

### `pine` in a terminal

If you installed only the app, your shell has no `pine` command until the app puts one
there. With it, everything in [operations.md](operations.md) works in a terminal on that Mac:
the terminal UI, `pine status`, `pine agent add`. The command is a link in a folder of your
shell's PATH to a small launcher inside the app, which runs the app's pine on the app's Node.

| When | What happens |
|---|---|
| The first start of the app from Applications | The link is made by itself where that needs no password: in `~/.local/bin` or `~/bin` if your PATH has one of them, else in `/usr/local/bin` or `/opt/homebrew/bin` if you may write there |
| No such folder | Nothing is done by itself. **Pine > pine in a Terminal…** in the menu, or Settings > General, sets it up in `/usr/local/bin`; macOS asks for your password |
| Your shell already has a `pine` (from npm, from a checkout) | It is left alone, and the app says where it is. The app still runs its own |
| The app was opened from the disk image or from Downloads | Nothing is set up: macOS runs it from a place that changes. Move it into Applications first |
| The app was moved | The old link leads nowhere. Set it up again in Settings > General |

Settings > General shows where the link is and takes it away again (Remove). Only a link the app
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
| `npm run dev` | Opens it with the page served by Vite, reloading on every change. It ends, with the app and the daemon the app started, when whatever started it is gone. Its page is served at this checkout's own port (`scripts/launch-json.mjs`); `$PORT` overrides it, and the next free one is taken when it is in use |
| `npm run dev:preview` | The app's page in an ordinary browser, reloading on every change, on a throwaway pine. `-- --home <dir>` puts it on that pine home instead. See below |
| `npm run dev:preview:home` | The same on your own pine home, `~/.pine`, at the port after the throwaway one's, so that it runs beside it. Its agents are your real ones. See below |
| `npm run check` | Type check |
| `npm test` | The app from end to end: the real app on a pine home of its own with a scripted model. Needs a screen. The app is built once for the run, into a temp folder of its own that every test starts (`scripts/test.mjs`, `test/support/app.ts`), two test files at a time, two minutes at most for a test. A test file run on its own with `node --test` builds for itself. With `PINE_LIVE=1` on a Mac it also dictates with the real voice helper, from a recording |
| `npm run pack` | `release/mac-arm64/Pine.app`, with pine, Node and the helpers inside |
| `npm run dist` | The same, and a disk image |
| `node scripts/smoke.mjs` | Starts a packed app from a folder of its own, on a home of its own, and checks that it answers a message with the pine and the Node it carries, that `pine` works through a link, and that pine finds the helpers in the app |

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

When the app starts it asks `pine service` ([operations.md](operations.md), "A UI of its own")
for the daemon of your home, so you never have to start pine first:

| What it finds | What happens |
|---|---|
| A pine is running for this home (started in a terminal, at login, by the terminal UI) | The app attaches to it. The side bar says `attached`. Quitting the app leaves it running |
| `An older pine runs` | The pine the app attached to is older than the pine the app carries. Said at the foot of the side bar and in Settings > General, with both versions. Restart that pine on the newer version yourself, or stop it and let the app start its own. Never said of a pine the app started |
| Nothing runs | The app starts one, as the terminal UI does, logging to `data/pine.log`. The side bar says `started here`. Quitting the app stops it, cleanly |
| There is no pine home yet | A first screen offers to set pine up (`pine init`): the example home and the browser its web tools drive |
| No Node, or no pine | A screen that says what to install |

Which pine it runs, in this order: what `PINE_CLI` names; the checkout the app lies in; the
pine packed into the app; the `pine` of your shell.

| Setting (Settings > General) | What it does |
|---|---|
| Keep pine running after the app quits | A pine the app starts goes on in the background when the app is closed: schedules fire, sources report and Telegram answers. It then runs until it is stopped (`pine status` finds it; the next start of the app attaches to it) |
| Home folder | Another pine home than `~/.pine`. Another home is another pine |
| The pine command in a terminal | Whether your shell has the `pine` command and whose it is; Set up and Remove for the app's own. See "`pine` in a terminal". Only in an app that carries pine |
| Theme | The window's colors: one of the themes in the `themes` folder of pine's home, dark ones and light ones. It is pine's setting `ui.theme` (see "Themes" below), so every Pine app on that pine shows it, and the main agent can change it when you ask. A theme file pine cannot read is named under the list, with what is wrong with it |
| Notifications | A system notification when an agent is done, stops with an error, needs your approval or asks you something while the window is not in front. The words are pine's own ("main is done"), never the agent's |

Closing the window does not quit the app on a Mac: it, and a daemon it started, stay until
you quit (`⌘Q`). A daemon the app started that stops answering is started again.

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
its file. To add a theme, copy its `.json` into the folder and pick it in Settings > General: a theme's
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

A value is a hex color, `#rrggbb` or `#rrggbbaa`. Settings > General lists a file pine cannot read with
what is wrong with it. The theme is pine's setting, not the app's: every Pine app that uses this pine
shows it, the main agent can set it (`set_setting ui.theme`), and with another machine's pine
(Settings > Environments) the window takes that pine's theme.

## Environments: the pine of another machine

The app can use the pine of another machine instead of the one on this computer ("This Mac" on
macOS, "This computer" on another system): a pine running on a server, on a desktop at home, on
anything you reach over SSH (with `ssh`). Each window chooses its own pine, so you can switch a
window from one machine to another or keep several windows open side by side on different
machines at the same time (see "Several windows" below). The foot of the side bar says which pine
that window uses (`pine 0.23.0 · started here`, or `pine 0.23.0 · server`), and when the window
uses another machine (or its side bar is hidden) a pill in the title bar says the machine too: a
click on either lists This Mac (This computer elsewhere) and the machines you added, and
Environments… leads to Settings > Environments, where machines are added, opened in a new window
and forgotten. The palette (`⌘K`) has "Use the pine on …" too. In a terminal, `pine --ssh <host>`
does the same for the terminal UI ([tui.md](tui.md#the-pine-of-another-machine)).

| What | How |
|---|---|
| Add a machine | Settings > Environments: type the host as you would after `ssh` (`server`, `user@server`, a name from `~/.ssh/config`) and Add. Anything else (an option for ssh, spaces, `;`) is refused before ssh ever runs. It is connected to when you pick it |
| Use another pine | Pick it at the foot of the side bar, from the machine pill in the title bar, or Use on its line in Settings > Environments. That window shows that pine's agents, conversations, settings and theme, while any other open windows keep theirs |
| `Open in new window` | On every row in Settings > Environments (this computer's and the current window's included), or in the machine menu of the side bar and the title bar (`⌘`-click, `Ctrl`-click off macOS, or the new-window button on a row): opens another window on that machine alongside the current one |
| Switch back | The pine you left goes on: switching stops nothing, so an agent at work there finishes its task, and going back to it is immediate. While windows are open on more than one pine, approvals, questions and notifications come from every connected pine, and the app's badge counts all unique open requests across them |
| Connecting | Connecting to another machine's pine is one wait: the first screen says "Connecting to <host>", with the list of machines, and stays until that pine's agents are loaded ("Loading its agents…"), so the window never shows an empty pine in between |
| One that is not reached | The first screen says why (ssh's own words, and what to do), with Try again and Use this Mac (Use this computer elsewhere), or Disconnect where it is offered |
| Agents that do not load | When the pine was reached but its agents could not be loaded, the first screen says "Could not load the agents of <host>" ("Could not load your agents" for this computer's) with the reason, Try again, and the list of machines with Disconnect where it is offered |
| Forget a machine | Forget on its line (not the current window's own machine). When another open window uses that machine, the row shows `in another window` and Forget asks first (**Close its window and forget** / **Cancel**), then closes those windows and ends its connection |
| Disconnect | Only where the page runs without a machine of its own and its bridge offers it (`disconnect`): the web client today, not the Pine app, and not the mobile app yet. It lets go of the machine in use and goes back to the list of machines; the machine and its trusted host key stay, unlike Forget. It is in the machines menu of the title bar, on the line of the machine in use in Settings > Environments, and on the first screen, also while the machine is not reached or its agents did not load |
| Quitting | Every connection ends, and the set of open windows is remembered for the next start. A pine the app started on another machine stops with it; one that was already running there goes on. This computer's pine follows Keep pine running, as before |

What is chosen is kept in the app's `prefs.json`: `hosts`, the machines you added, `windows`, the
windows that were open when the app quit, and `use`, the last active window's machine (none: this
computer's).

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

What is this computer's stays this computer's. With another machine's pine in a window:

| | |
|---|---|
| Folders | A conversation's folder is a path on that machine: choosing one in that window asks for the path instead of opening the Finder, and a folder dropped onto that window is refused. Opening a local folder from the system (dropped on the app's icon, or from the file manager) or pairing a device (`pine://pair`, the Dock's Add a Device…) goes to the most recently active window on this computer, or opens a new local window when only SSH windows are open |
| The terminal and Run | The terminal beside a conversation and the Run button of a command in an answer are shells of this computer: they are not offered in an SSH window, and that pine's agents are not told about them |
| The browser | The Browser aside shows the browser on that machine; an address you type there (`localhost:3000`) is one of that machine |
| Settings > General | About the app and this computer's pine (home folder, Keep pine running, the browser build). It says which machine's pine that window uses |

## Browser access: a browser with no SSH to set up

Browser access lets a phone, a tablet or another computer use this computer's pine from its web
browser, with no SSH to set up: you scan a QR code on this computer with the phone's camera,
press Allow here, and the phone is in your conversations. From then on that browser opens the
web client's address and connects by itself. The browser and this computer talk directly, peer
to peer; the service in between only introduces them. The app calls this computer "This Mac" on
macOS and "This computer" on another system; the browser, which cannot tell what kind of
computer it reaches, says "your computer" until it is paired and then the name this computer gave
it (its computer name). The Pine app on a phone on the same network needs no code at all: it finds
this computer and asks, and you still allow it here. What the browser side looks like is in
[web.md](web.md#a-computer-paired-by-qr-code-a-browser-with-no-ssh-to-set-up), and why it is built so in
[ADR 0004](../adr/0004-browser-access.md) and [ADR 0005](../adr/0005-pairing-from-nearby-devices.md).

### From a phone without SSH

A phone needs no SSH for this computer's pine: pair the Pine app on the phone, or the phone's
browser, with the same QR code. On Android the code opens the app when it is installed; on an
iPhone it opens Safari, which offers to open the app instead
([mobile.md](mobile.md#pairing-with-a-computer-that-runs-the-pine-app)). On the same Wi-Fi the
app needs no code: it lists this computer under "On this network" while "Visible on this network"
is on, and a tap asks it. The app is listed here as a device like a browser, by the phone's name
("Pine on Pixel 9", "Pine on iPhone").

### Pairing a device

It is in Settings > Browser access, under This Mac (This computer on another system), shown only
while the app uses this computer's own pine. Until you switch it on, the app contacts no
service, says nothing on the local network and lets nobody in. Add a device and the question
when a device asks are not tied to that section: they show wherever you are in the app.

| What | How |
|---|---|
| `Browser access` | The switch. On, the app waits at the service for the browsers you paired, while Pine is open. Switched back, it contacts no service and accepts nobody; your devices are kept, so switching it on again needs no new scan. The badge beside it says waiting, off, or that the service cannot be reached (the app then tries again by itself, and nothing else stops) |
| `Open Pine at login` | Offered, checked, the first time you switch browser access on, and changed here later: so that this computer can be reached after a restart with no need to open the app. The computer has to be awake and Pine open |
| `Service address` | Where browsers open the web client and find this computer. By default the project's own service, `https://pine-main.drcmda.workers.dev`. Write the address of a deployment of your own instead (see "Deploying it" in [web.md](web.md#deploying-it)), or of one of the project's other channels, `https://pine-next.drcmda.workers.dev` or a pull request's `https://pine-pr-<number>.drcmda.workers.dev`, to try pairing there. Only `https://` and `http://` addresses are kept. Changing it makes the browsers paired at the old address pair again: a browser's key and its machines belong to the address it opened |
| `Add a device` | Here, or anywhere: `Add a Device…` in the Pine menu (File on another system), `⌘⇧D`, the Dock's menu on a Mac, `device` in the palette. Shows a QR code, and Copy link for a computer that has no camera (send yourself the link and open it in that browser). The code works once, for two minutes, and stops when you close the dialog; New code makes another. Five wrong codes close it. Only one is open at a time. With browser access off it says to turn it on first |
| `Allow` and `Refuse` | When a device asks, with the code or from the network, the app names it ("Chrome on Android", "Pine on Pixel 9") and shows four digits; the device shows the same four. Allow it only if they are the same. The question is a toast at the top of the window, wherever you are, that never takes the keyboard and stays while the question stands; with the window behind others, a system notification with the digits, whatever the notification setting, whose click brings Pine forward. Allow keeps its key and the device is in your conversations; Refuse, two minutes with no answer, or a device that leaves keep nothing. A notification says each device that was added |
| `Devices` | Each paired browser by its name, the day it was paired and its last connection; "connected now" and how (same network, direct IPv4, direct IPv6, or relayed through your relay server) while it is connected. No notification for a reconnection |
| `Remove` | Removes a paired phone, tablet or computer, so that the phone can no longer reach this computer, and a connection it has is cut at once. Its key is refused from then on; to use it again, add it again |

### Without scanning a code

A phone with the Pine app on the same network finds this computer and asks; a browser on this
computer opens Pine by a link. Either way you still compare four digits and press Allow here
([ADR 0005](../adr/0005-pairing-from-nearby-devices.md)).

| What | How |
|---|---|
| `Visible on this network` | Under the switch, on unless you turn it off. While browser access is on, the app announces this computer on the local network (Bonjour), so that the Pine app on a phone on the same Wi-Fi lists it and can ask to connect without a code. You still allow it here, after comparing four digits. Off: nothing is announced and a request without a code is refused; the code of Add a device works as before. Turning it on ends a pause after refusals |
| `Requests without a code` | From a phone that found this computer on the network. It has to name the random word the announcement carries, which changes every five minutes, so only a phone on the same network can ask. Only while `Visible on this network` is on, and one at a time: none while another is under way or while you are asked about a code's request, and a few seconds at least between two. A request that ends without your yes (you refused it, or the phone hung up or let it run out) is followed by 30 seconds in which every request without a code is refused; three in ten minutes pause visibility for an hour (nothing is announced, no request without a code is let in), and a toast says "Visibility paused after 3 refusals", with Turn on now. What is refused that way is refused without a word: you see only the requests that reach you. Allow waits a second after a question appears, and answers only that question |
| `pine://pair` | What "Open Pine on this computer" opens, in the web client on this computer ([web.md](web.md#a-computer-paired-by-qr-code-a-browser-with-no-ssh-to-set-up)). The browser asks first whether to open Pine. While browser access is on, the app opens a pairing, opens its link in your default browser, and shows the same code in the Add a device dialog, for a browser that is not the default one. With browser access off nothing happens, and so for any other `pine:` address. Any site can open it: the link goes only to this computer's browser, and nothing is kept without Allow. The app is the handler of `pine:` once it is installed (packed); from a checkout only with `PINE_DESKTOP_PROTOCOL=1` |

### What a paired browser can do

| | |
|---|---|
| This computer's pine | Its conversations, tabs, settings and theme, as in the window. The app's own daemon serves it, started if needed, also while the window uses another machine's pine. A browser that leaves ends nothing: work started from the phone goes on when the phone is locked |
| Nothing else | No shell, no file transfer, no other command, no way to another port or machine: this computer's SSH access to other machines is not the browser's |
| Pictures, video and sound | As in the window |
| This computer's identity | The QR code carries the fingerprint of this computer's key: the browser refuses any computer whose key differs, so there is no fingerprint to compare by hand. The key is kept encrypted by the system's keychain in the app's data folder (`access.bin`), so a copy of that folder does not carry this computer's identity. Where the keychain cannot be used, the switch stays off and the section says why |

What is kept: the switch, Visible on this network (only when off), the service address and Open
Pine at login in the app's `prefs.json` (`access`); this computer's key and the paired devices in `access.bin` beside it. Nothing
is written into pine's home.

### A relay server of your own, for a phone that cannot connect from mobile data

Below the service address in Settings > Browser access. The project runs no relay; leave it empty
if you have none.

| What | How |
|---|---|
| `Relay server (TURN)` | A relay server of your own, used when no direct connection can be made, for example from mobile data on some mobile networks: its address (`turn:host:port`, over UDP; TURN over TCP or TLS, `turns:` or `?transport=tcp`, is refused, since the app cannot use it today), a user name and a password. This computer reserves an address on it and offers it beside its direct ones; a direct path is still preferred, and the browser needs nothing. A device connected through it is listed as relayed |
| The line under it | Saved, the relay is tried at once: it works, or why not (it did not answer, it refused the user name or password, or its name was not found). A relay that fails the try is kept, since its server may be down for a moment |
| What is kept | The address and user name in `prefs.json`, the password in `access.bin`, encrypted by the keychain. The password is never shown again: the field says one is kept, and a new one replaces it. It is the password of that address and user name only: saved with another host, port or user name and no password, the relay is kept without one, and the field says so. Saving the fields empty removes the relay and its password. Devices stay paired |

### When a paired device does not connect

| It says | What to do |
|---|---|
| The phone says "<name> does not answer", by the name it was given at pairing ("Your computer" before) | It is asleep or shut down, Pine is closed, or the switch of browser access is not on. The phone keeps trying and connects when it is back |
| The phone says "no direct connection could be made from this network" | Some networks (often a phone's data) do not let two devices connect directly. Try another Wi-Fi, or the phone's data instead of the Wi-Fi, or name a relay server of your own (`Relay server (TURN)`) |
| The phone says "This browser is no longer known to <name>" ("This phone" in the mobile app) | Its device was removed here, or the browser's data was cleared there (the mobile app's key is new: an iPhone reinstalled under another Apple ID). Add it again |
| The section says the service cannot be reached | The app is offline, or the service address is wrong. Everything else in the app works |
| A browser on a Mac asks about the local network | macOS may ask whether that browser may find devices on the local network. Allow it for a direct connection on the same Wi-Fi |
| Nothing finds this computer on the same Wi-Fi | Browser access and Visible on this network must be on, and Pine open. A Wi-Fi that keeps its devices apart (for guests, in an office) shows nothing. After three refusals visibility is paused for an hour: turn it on again here. The code of Add a device works meanwhile |
| macOS asks whether Pine may find devices on the local network | macOS 15 and later may ask the first time Pine announces this computer. Allow it to be found on the network; without it, pair with the code |

## The window

```
 ● ● ●          ◧   M main   M main · notes ×   ⚙ Settings   +           ← tabs
 ⌕ Search and commands ╭──────────────────────────────╮ ╭───────────────────────╮
 Agents              + │ M main / notes   ▢ ~/dev/x  7% ◨ │ Files Changes Output …   │
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

**The side bar is your agents.** An agent with one conversation is one line: its name and what
it is for, and a click opens that conversation. An agent with more than one is a group: its line
says how many it holds (`3 conversations`) before what it is for, and under it are its
conversations. The line turns into a group when a second conversation is started, and back into
one line when only one is left; an agent with a group of conversations is always a group.
Everything that starts something new stands on the agent's own line, so it is never a question
whom it is for.

| On an agent's line | What it does |
|---|---|
| A click on the agent | With one conversation: opens it in a tab. The line shows what that conversation's row would: that the agent is at work (a grey dot that pulses), waits for you (`!`) or has something new (a dot), else when it was last used. With more: folds its conversations away, or shows them again. The app remembers which groups are folded. A folded agent still shows that it is at work, waits for you or has something new |
| `+` | A new conversation with that agent |
| The folder (when the pointer is on the line) | Opens a folder of yours for a new conversation with that agent |
| The gear (when the pointer is on the line) | That agent's page in the settings |
| A right click | A new conversation, a folder, a new group, how its conversations are sorted (with more than one), **Rename** (its name in the side bar turns into a field: Enter or leaving it renames the agent, Escape keeps the name), **Color** (its colors open over its avatar, and a pick is kept at once) and the settings as a menu, and **Remove** for every agent but the main one, which administers pine and stays. Remove asks first, and how: with everything the agent has, or with its folder kept. On the line of an agent with one conversation, what a right click on that conversation offers comes first: Open, Open in New Window, Branch, Move to Group…, Start over |
| `+` beside "Agents" | A new agent: a dialog over whatever is in front (a name, its instructions, a model), without opening Settings. Once it is made, its conversation opens in a tab. The card at the top of an agent's empty conversation (its name, what it is for, its model and mode) has **Agent settings**, which opens its page in Settings |

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
| Side bar | Search at the top, then your agents (see above). Drag its right edge to make it wider or narrower, or focus the edge with Tab and use the arrow keys (a double click on the edge sets it back), `⌘B` hides it and shows it again (in a window narrower than 768 pixels it opens it over the page instead: see the table below), and it is after a restart as you left it; where nothing is to click, it moves the window. Under an agent with more than one conversation come its groups of conversations, each with its conversations, then the conversations in no group. In each, an agent's own conversation (`main conversation`) comes first, then pinned ones, then by when they were last used, or by name: the agent's right click chooses (Sort by Last Used, Sort by Name), and the groups are sorted the same way. A click on a conversation opens it in a tab, and so does Enter: Tab reaches an agent's line (Enter or Space folds it, or opens its conversation when it has only one), then a group's line (the same), then the conversations, where the arrow keys move; a right click offers Open, Open in New Window, Pin, Rename, Move to Group…, Remove (or Start over for an agent's own). Groups: see the next row. At the bottom: the event log, the settings, and whether pine answers |
| Groups of conversations | A group keeps an agent's conversations in order, one level deep, and keeps them however long they are not used ([agents.md](agents.md#groups-of-conversations)). Make one with New Group… in the agent's right click. Drag a conversation onto a group's line or into its list to put it there, onto the agent's line or among the conversations in no group to take it out; it takes its branches along, and a branch is not dragged by itself. Without a mouse: Move to Group… in a conversation's right click, or `Move conversation to group` in the palette (`/group` in the input), for the conversation in front. A group's right click: New Conversation in it, Rename…, Remove Group…, which removes the group and every conversation in it for good after you confirm (an agent's own conversation stays, in no group). A folded group still shows when something in it waits for you, works or is new |
| Tabs | One conversation each, with its agent's initial, as in the terminal UI: a grey dot that pulses while the agent works, a dot when something arrived while you were elsewhere, `!` when it waits for your approval, `★` for a conversation that is kept for good. Drag a tab to move it. A right click on a tab offers Close (`⌘W`), Move to New Window, Close Others, Close to the Right, Close All, and Pin or Unpin for its conversation; they are in the palette too (Close other tabs, Close tabs to the right, Close all tabs). Closing a tab only closes the view: the conversation stays in the side bar, and what was typed in its input and not sent is there again when you open it. Any tab can be closed, the agent's own conversation's and the last one too; with none open, the window says so and offers a new conversation or the main agent's. What waits for your answer is never left without a place: Close Others, Close to the Right and Close All leave a tab that waits open and say so, a tab closed by itself hands what it waits for to another tab (of the same agent if one is open, else the one in front), where its `!` and its buttons are, and the last tab that waits stays until it is answered. An approval that arrives with no tab open opens the agent's main conversation. They are the same tabs the terminal UI opens: the daemon keeps the list; when the app starts with none, it opens the main agent's conversation |
| Conversation | A conversation in which nothing was said yet shows who its agent is: what it is for, its model and mode, whom it hands work to, and how many skills, event sources, schedules and MCP servers it has. Then your messages, the agent's answers drawn as markdown, and the work of each turn (tool calls, thoughts, sub-tasks, what it said on the way) folded into one line that a click opens (it stays open while the turn runs, with its last lines). A `↳ … ↗` line opens a sub-agent's or delegated task's work in a tab of its own. A request of the agent's waits in the conversation with its buttons until it is answered, then becomes a line. Above your last message a line offers to take it back (**Take back**, `/undo`). Scrolled up, the conversation holds still while the answer goes on, and a button at its foot brings you back to the end |
| Input | `↩` sends; while the agent works the message is given to that work, and `⌥↩` makes it wait its turn. `⇧↩` is a new line, `↑` brings back earlier inputs, `esc` stops the agent. `/` offers the commands of the terminal UI, `@` the files of the conversation's folder |
| The line at the top of a conversation | Whose it is and which (`main / notes`), the folder it works in, how full its context is (tokens read and the share of the window; hover for the cache share and speed) |
| The top right of the title bar | Up to three buttons: the side panel (`⌥⌘B`), the browser (`⇧⌘B`) and the view (`⇧⌘O`, where there is one), each a panel of its own at the right. Each is pressed while what it shows is open. A click opens what is closed, closes what is in front, and brings to the front one that is open but behind the others (in a window narrower than 1024 pixels the sheet covers these buttons: there `⌥⌘B`, `⇧⌘B` and `⇧⌘O` do it). On a tab that is not a conversation (Settings, Events) the side panel's and the browser's stay in their place and cannot be pressed; the view needs no conversation |
| The bar under the input | `+` attaches files (or drop them on the input; a dropped folder is opened for the conversation); then the agent's model, how much it reasons and its mode, and where the conversation works (the agent's own workspace, or a folder of yours). The model and the folder open a list to search, the reasoning and the mode a menu right above the button. `outside content` appears when the conversation has read something from outside; each button says what it is in a tooltip |
| Side panel | Beside a conversation (`⌥⌘B`): the agent, then its files, changes and output. See "The code panel and the editor" |
| View | At the right of the window, after the browser (`⇧⌘O`): all agents and their work at a glance, drawn by a view of yours. See "The view" |
| Browser | At the right of the window, after the side panel (`⇧⌘B`): the browser the agent of the conversation works in. Drag its left edge to make it wider or narrower; its width is its own, apart from the side panel's. Its `×` closes it. See "The browser" |
| Search | `⌘K`, or Search in the side bar: see "Finding a conversation" |

The window can be made as narrow as a phone (360 pixels), to put it beside another app. Where
there is no room for columns, the side bar (the list of conversations), the side panel and the
browser lie over the conversation instead of beside it. What you chose (side bar shown or hidden,
side panel and browser open or closed) and how wide you dragged them is kept, and a wide window
puts them back as they were. Whether the side panel and the browser are open is the same for every
conversation.

| Window | Side bar | Side panel and browser |
|---|---|---|
| 1024 pixels and wider | A column | A column each. Two at once where the room beside the side bar is 1100 pixels or more, all three (with the view) from 1500; with less, the ones you opened last, the others open behind them |
| 768 to 1023 | A column | Over the conversation, from the right: `esc`, a click beside it or its `×` closes it. With both open, only the one you opened last lies there, and the other stays open behind it. The sheet covers the buttons of the title bar, so its key (`⌥⌘B` or `⇧⌘B`) brings the other to the front. Closing the one in front does not bring the other up: it stays open behind, shown as a column when the window is wide again, or as a sheet by its key |
| Narrower than 768 | Over the page, from the left, when its button at the top left or `⌘B` asks for it. Picking a conversation, `esc` or a click beside it puts it away; `⌘B` there does not hide the column of a wide window | As above: the whole width of a window narrower than 640 pixels, and at most 540 pixels wide from 640 to 767 |

With more of the side panel, the browser and the view open than there is room for side by
side (a sheet each, less than 1100 pixels beside the side bar for two, less than 1500 for three), none
comes first: the ones you opened last show, and the others are open behind them. Its button is pressed more lightly. In a window 1024 pixels and wider a
click on that button brings it to the front and puts the other behind, and a click on the button of
the one in front closes it, which shows the other again. Below 1024 pixels each is a sheet over the
conversation, which covers the buttons of the title bar: there only `⌥⌘B` and `⇧⌘B` switch, and
closing the sheet in front does not bring the other up. The other stays open behind, and shows as a
column when the window is wide enough, or as a sheet by its key. The agent's `browser_show` and a port's link under Running open the browser in front.
Narrowing the window never closes anything: when there is room again, both show without a click.

Settings follow the room they have, not the window: narrower than about 720 pixels, the list of
pages is a row along the top that scrolls sideways, and a setting's control goes under its text.

### Several windows

You can open as many Pine windows side by side across monitors as you like — two windows on two
different machines at the same time (for example this computer on one screen and an SSH server on
another), or two windows on the same pine with different conversations in each. Every window keeps
its own tabs, active tab, side bar, side panel, browser aside and view panel widths, folded groups,
and window size and position; across windows on the same pine, the daemon keeps the union of open
tabs so no open conversation expires, and a tab-scoped subscription ends only when the last window
holding that conversation closes its tab. Each window's title names its active tab and, on another
machine, that machine (`main — server — Pine`), and its title bar shows a clickable machine pill
whenever the window is on another machine or its side bar is hidden.

| Action | What it does |
|---|---|
| `⌘N` (`Ctrl+N` off macOS), File > New Window, Dock > New Window, or `New window` in `⌘K` | Opens another window cascaded from the focused one on the same pine. When a window is already open on that pine, the new one starts on **No tab is open**; when none is open on that pine yet, it opens that pine's saved tabs |
| `Open in new window` | On any row in Settings > Environments, or in the machine menu at the foot of the side bar and in the title bar (`⌘`-click, `Ctrl`-click, or the row's new-window button): opens a window on that machine without changing the current window |
| `Move to New Window` | In a conversation tab's right-click menu: closes the tab in this window and opens it in a new window on the same pine, carrying over any unsent draft, attachments and local conversation terminal |
| `Open in New Window` | In the right-click menu of a conversation in the side bar (or an agent with one conversation): opens that conversation in a separate window on the same pine |
| `⌘W` (`Ctrl+W`, File > Close Tab) | Closes the tab in front; pressed again with no tab open (**No tab is open**, or the first screen), closes that window |
| `⇧⌘W` (`Ctrl+Shift+W`, File > Close Window) | Closes the focused window directly, without stopping any pine |
| Quitting and reopening (`⌘Q` / `Ctrl+Q`) | Quitting while windows are open saves every open window — its machine, bounds, open tabs, active tab and panels — and restores all of them when you reopen the app. Closing all windows one by one before quitting (or clicking the Dock icon on macOS with zero windows open) reopens a single window on the last-used machine and bounds, seeded from that pine's saved tabs |

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

Everything in [tui.md](tui.md) about modes, goals, swarms, approvals, an agent's questions, its list
of steps, sub-agents, `/undo` and what a conversation is holds here unchanged: it is the
daemon's doing. What differs is how it is drawn and reached. A swarm is started by typing
`/swarm` and the job into the input, or with the command Swarm of the palette: the conversation
gets a line for each thing pine does about it, the line above the input says which round it is
in and whether the answer is being checked, with a button to pause it, and a swarm that is paused or at its limit shows above the input
with Resume and Clear. Its tasks are in the Board tab of the side panel.

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
| Themes | Any VS Code color theme, chosen in Settings > General: the window, code in answers, diffs and the editor, and the terminal all follow it. See "Themes" |
| Several views at once | A conversation, its changes and a file in the editor side by side |
| A terminal | A shell of yours beside each conversation, and ▶ on an answer's shell code blocks to run them in it: see "The terminal" |
| `/browser` | A command of the app's own, which the terminal UI does not have: the browser at the right of the window (`⇧⌘B`, View > Toggle Browser). See "The browser" |
| `/view` | A command of the app's own: the view at the right of the window (`⇧⌘O`, View > Toggle View). See "The view" |

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

The panel beside a conversation (`⌥⌘B`) opens on the files. First come the views that are
always there, in the order they are used: the folder (Files, Changes), what ran (Output, your
Terminal), then the agent. After them the two that are there only while they hold something,
Running and Board. The work is that of the folder the conversation works in (the folder you
opened for it, else the agent's workspace):

| View | Shows |
|---|---|
| Files | The folder as a tree, a search by name, and the editor. The tree is one Tab stop: the arrow keys move, open and close folders, typing goes to a name, Enter opens a file; the search's results and the changes are lists the arrow keys move in the same way |
| Changes | Two ranges, chosen at the top of the view. **All changes**: what differs from the last commit (git), each file with its counts, and its diff on a click. **Last turn**: what your last message changed, whatever git says, with "Take back" (`/undo`); `/code turn` opens it |
| Output | The tool calls of the last messages, each with all it printed |
| Terminal | A shell of your own for the conversation, in its folder: see "The terminal" below (`` ⌃` ``, View > Terminal, `/terminal`) |
| Agent | The agent of this conversation: what it is for, its model, reasoning and mode (a click changes each), whom it hands work to; what is at work right now (this conversation, the sub-agents and delegated tasks it started, the agent's other conversations), each to open; what it listens to (event sources, and whether this conversation, the agent or all agents are subscribed); its schedules, skills and MCP servers; and what it remembers (its `MEMORY.md`). Buttons lead to the settings pages where each is changed |
| Running | What the conversation's commands left running (a dev server, a watcher): its ports as links, its last output, and Stop. A port's link opens that address in the conversation's browser, at the right of the window, where the agent sees the same page; only where the conversation has no browser does it open in your own. The tab is there while something is running, with how many, and `/code running` opens it before that |
| Board | The tasks and notes this conversation shares with its sub-agents and with the agents it hands work to: see "The Board tab" below. The tab is there while the conversation has a board, and `/code board` opens it before that |

While an agent keeps a list of steps, the open steps stand at the top of the panel.

### The Board tab

A board is where a job that several work on at once is kept track of: its tasks, who has
each, what became of it, and the notes they left for each other ([boards.md](boards.md)). An
agent starts one when it splits a job among a pool of sub-agents; the tab appears then, with
the number of tasks that are not settled yet beside its name.

| On the tab | Meaning |
|---|---|
| A task | Its number and text, and where it stands: open, waiting for other tasks, somebody working on it (a sub-agent, or an agent by name), done, failed, or "Waits for an answer". A click on the text shows all of it, its result and the notes about it |
| "Waits for an answer" | A task whose worker could not go on without a decision. The agent that gave out the work is asked first and answers what it can; what stays here is yours. The question stands under the task with a line to answer in: the answer becomes a note on the task, and the task is open again for whoever takes it next |
| The menu at a task's right | "Take it back" from whoever has it (a sub-agent the pool started for it is stopped, and the task is given to a new one), "Open it again" after it was settled, "Mark as done", "Remove" |
| Notes | What the workers found or decided, each with who wrote it and its fields (a file, a line) as small labels. "from outside content" marks a post by a run that had read a web page or other outside content |
| The line at the bottom | A task of your own. While a pool runs it is worked like the others; otherwise it waits for the agent to take it |
| The list at the top left | Where the conversation can use more than one board (one with a name, of the agent or for all agents): which one is shown |
| Clear | Removes the board with everything on it |

What stands on a board was written by agents and can repeat what they read: the app draws it
as plain text. The terminal UI has no such tab.

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
environment, started in the conversation's folder (else the agent's workspace). It is not the
agent's: no sandbox, no mode, no approvals. The agent sees nothing of what you type there; it
hears only how a block you ran with ▶ went (below).

| | |
|---|---|
| One per conversation | Starts when the view is first shown, and keeps running while Pine runs: another view or tab leaves it as it is, with its scrollback. Each local window keeps its own shells, and **Move to New Window** carries a tab's running shell along to the new window |
| ↻ | Ends the shell and starts a new one. After `exit` it says so, with **Start it again** |
| When it ends | With the conversation's tab in that window, when that window closes or switches to another machine, and when Pine quits |

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
| No page | Until the agent opens one, or you open an address, the browser in the app is empty (**No page is open**) and offers the pages below so you can get back to the page your agent had open. The browser of a conversation closes when the conversation has been idle for a while (`idleMs`, 15 minutes) and when pine restarts. Opening an address starts it again, without a turn of the agent's; its logins are kept |
| Running in this conversation | While the browser is empty and no page is open, the view lists the ports of the programs this conversation left running (a dev server the agent started), as under Running. A click opens `localhost:<port>` in this browser |
| Opened by the agent before | While the browser is empty and no page is open, the view lists the last addresses the agent had open in this conversation, newest first, at most 12. A click gets back to that page. Only a page that came is listed, and never an address the agent was refused. The list is the conversation's: it goes when the conversation is reset or removed |

A page the agent made for you to use (a board, switches, a form) is shown here like any other,
and what you press on it wakes the agent ([interfaces.md](interfaces.md)).

With this computer's pine, the app lays the conversation's own browser page (`WebContentsView`, in
its own sandboxed session behind pine's guard) over the panel at that window's bounds and zoom:
several local windows on different conversations show their pages at the same time, and when two
local windows view the exact same browser tab at once, the focused window gets the live page while
the other draws live pictures and takes the page over when focused. Closing a window detaches its
view without closing the agent's browser tab. With another machine's pine (and on the phone or in
the web client), it is a picture of the page, drawn, and nothing of a web page is loaded into the
window: no downloads to your disk, no file to choose for an upload, no passkey or system dialog,
no copying out of the page, and text is typed without an input method. For those on another
machine, close the app's browser and ask the agent in the terminal UI to show the browser, or set
`"headed": true` for the browser.

## The view

The view (`⇧⌘O`, View > Toggle View, the radar at the top right of the title bar, or "View" in the
palette) shows all of pine at a glance, in a panel of its own at the right of the window: every agent,
the work each one does right now, where that work came from, who handed what to whom, the copies
(sub-agents) at work, and what waits for you. It needs no conversation: it opens with Settings or the
event log in front too, and stays open beside the side panel and the browser where there is room (see
the table above).

What the panel draws is a view: a script of yours in the `views` folder of pine's home, chosen with
the view's name at the top of the panel, which is a list of the views in the folder (`ui.view`). pine
comes with three: `overview`, a page that says everything in words and is shown until you pick
another, `office`, pine as a little house full of robots, and `workshop`, pine as Santa's
workshop at the North Pole. How to write
one, and what a view is told, is in [views.md](views.md). With no view in the folder, or the setting
`off`, there is no button and no panel. The mobile app and the web client show no view.

| | |
|---|---|
| Needs you | On top, whatever the view: what an agent asks you right now, each with **Answer** |
| The view | In the middle, in a frame of its own: it draws pine as it likes, and a click in it can show an agent or a piece of work below, or open it |
| What happened | Below the view, newest first, in plain words: what woke whom, what was handed on, who answered, what you were asked and what you said |
| Looking closer | An agent or a piece of work chosen in the view, or in what happened, is shown below the view instead: for an agent its mode, its work, the conversations pine has open and what it did lately; for a piece of work where it came from, what it does now, the mode it runs in, whether its conversation read outside content, the time, what it handed on, and what it asks you. **Open** opens the conversation, or the task by itself |

The words below the view are the app's own, and say everything. The view is told only the shape of
pine: it never sees a prompt, an answer, a path or what an event said, and it reaches neither the app,
nor pine, nor the web ([views.md](views.md), "What a view cannot do").

`office` draws pine as a little tower house, cut open, in pixels: the main agent lives under the
roof, the others on the floors below, you sit at your desk in the hall. Each agent has a room and a
robot of its own look, in its color, and a plate at the door with its name and a sign for its mode. A
robot's bubble says what it does, in words: "thinking...", "reading a file", "running a command",
"browser: navigate", "skill: invoices", "waiting for scout", "needs your answer". What it does also shows in
where it stands:

| In the house | What it is |
|---|---|
| A robot paces its room | It thinks |
| A robot at its shelf with a book; a book with a star | It reads or searches files; it reads one of its skills. Each starred book on the shelf is a skill the agent has |
| A robot at its desk, the screen full of lines | It runs a command, edits a file, or writes its answer |
| A robot at the rack | It uses a tool of an MCP server. Each lit slot of the rack is an MCP server the agent has; the one in use blinks |
| A robot on its chair, legs swinging, an hourglass | It waits for a task it delegated or for its sub-agents |
| A robot jumps, a red "!" | It asks you. The bell on your desk in the hall rings, and the panel has the question on top |
| Small robots beside it | Sub-agents, for as long as they work |
| A letter with wings flies from one robot to another | A task handed on (`delegate`). A dashed line joins the two rooms while the work lasts; the answer flies back with a tick, or a cross if it failed |
| A capsule in the glass tube | An event: from your desk (what you asked; the answer comes back down), from the box of an event source in the hall, or down from the clock in the turret when a schedule is due |
| Alarm clocks over a desk; the clock in the turret | The agent's schedules; the turret's clock shows your time, and above it the schedule that runs next. They ring when one is due |
| The board on the wall | The agent's conversations: a line for the main one, a fork for each branch, a leaf on one that works in a worktree, a small flag on one with a goal |
| Pips under a bubble; a flag on the desk | The steps of its to-do list that are done, or, while its sub-agents work through a board, the tasks of that board that are done ("board: 3 of 12 done" under the bubble); a goal that pine calls it for again and again |
| A cork board on a trolley, under the window | The board the agent's sub-agents work through ([boards.md](boards.md)), for as long as it has work on it: a card for each task in the order they were posted, what comes after a task (a check of it) hanging under it. Paper is a task to do (dim while it waits for another), the agent's color one that a sub-agent works on, green one that is done, amber one whose worker asked a question (a "?" stands over the board until it is answered), red one that failed. The strip along its top is how far the board is. The pointer over it says the numbers |
| A notice board in the hall, with a name under it | A board for all agents, drawn the same way |
| A word at a task board: "new task", "task taken", "task done", "a question", "task failed" | What just happened on it |
| A letter flies up to the dish on the roof | The agent sent something out (`send`, `publish_event`) |
| Shield, lock, bolt, warning sign, blueprint on a door plate | The agent's mode: `safe`, `manual`, `auto`, `bypass` (with hazard tape and a beacon in the room), `plan` |
| An amber lamp in a room, amber eyes | The work read outside content: sending something out asks you from now on. A shield on a robot's chest is work held to a stricter mode |
| A robot throws its arms up; a robot droops under a puff of smoke | Work is done; work failed |

The `?` at the top right shows this key in the view itself, and the pointer over anything says what
it is: over a rack the names of the MCP servers, over a shelf the skills, over the clocks the schedules
and when each runs next, over the board how many conversations and branches, over a box in the hall
which agents the source wakes. The sky follows your clock and the year: dawn, day, the golden hour,
dusk and night with the moon in its phase, and the trees of the season. At night an agent at rest
sleeps at its desk. A camera goes where agents work, in whole steps so that pixels stay whole; scroll,
drag or pinch to look yourself, the eye follows again, and the frame beside it shows the whole house.

### The workshop

`workshop` draws the same as Santa's workshop at the North Pole. The main agent is Santa, under the
roof; every other agent is an elf of its own look, its pointed cap in the agent's color, in a bay that
is a workshop of another kind each. You stand at the counter of the mail room. The bubbles say the same
words as in `office`; their signs are sweets, and the `?` shows what each stands for.

| In the workshop | What it is |
|---|---|
| Santa checks a long list | The main agent is at rest. At night he sleeps in his chair |
| An elf paces; a plan on blue paper on its bench | It thinks |
| An elf at its shelf with a book | It reads or searches. A starred book is a skill: on an elf's shelf, on Santa's mantel |
| An elf at its bench with a hammer, a brush or a wrench | It runs a command or edits a file |
| An elf ties a ribbon round a parcel | It writes its answer |
| An elf at the machine full of gumballs; Santa at his tree | A tool of an MCP server. Each gumball, each bauble on the tree, is an MCP server; the one in use lights up |
| A glass of sand on the bench | It waits for others |
| A jack-in-the-box with a red "!" | It asks you; the bell on your counter rings |
| Small elves | Sub-agents |
| A cork board on a trolley in a bay; an order board in the mail room | The board an agent's sub-agents work through, and a board for all agents: a card for each task, as in `office` |
| A present flies from one to another | A delegated task; the answer flies back with a tick or a cross |
| A sweet in the glass chute | An event, from your counter, a letter box of the mail room, or the clock in the tower |
| Bells on a wall | The agent's schedules |
| A little tree with a star on the bench | A goal |
| A present flies up to the sleigh on the roof | The agent sent something out |
| Snow globe, cookie jar, wind-up key, sparkler, gingerbread house | The modes `safe`, `manual`, `auto`, `bypass`, `plan` |
| An amber lantern, a cap's bobble glowing amber | The work read outside content |
| A stocking for each agent in Santa's room, where it is wide | It glows while that agent works, red while it asks |
| Presents under Santa's tree; the big wheel on the wall | More presents the more work was done in the last half hour; the wheel turns faster while anybody works |

It is winter there all year. The sky follows your clock, with northern lights at night; reindeer fly
a sleigh across it, elves on skis and a polar bear with its cub go by, and floes drift on the sea.

### The overview

`overview` is all of pine on one board, in words. There is nothing to learn first: three columns, and
everything in them says what it is. It looks like the app around it: the same font, cards and badges, each
agent with its avatar, on the panel's own ground in whatever theme you use.

| On the board | What it is |
|---|---|
| The left column, "Triggers" | What starts an agent's work: you, every event source, every schedule and every webhook, each with whom it triggers ("inbox, triggers books") and, for a schedule, when it is due. A source that is down says so, in the color of what failed. A question for you is said at "You" |
| The middle column, "Agents" | Every agent, those that work on top and the idle ones below them (when one starts or stops, the boxes glide to their new places). Under its name what it is doing right now ("Running a command", "Using web: search", "Waiting for scout", "Needs your answer", "Idle"), under that why ("for you", "delegated by main", "triggered by inbox") and how far ("step 2 of 5"). Each of its sub-agents is a line of its own under it, and a sub-agent that one of them started stands in under that one. Its mode stands beside its name |
| The right column, "Tools" | On top, under "Boards", a card for every board that has work on it and every board with a name: whose it is, how far it is ("7/24"), what happens on it in words ("3 in progress · 14 to do", or "Waits for an answer", which also counts as a question at "You"), a bar of how its tasks stand, and a tile for each task in the order they were posted, what comes after a task (a check of it) under it. An outlined tile is a task to do (faint while it waits for another), one in the agent's color is in progress, one in the text's color is done, one in the color of a question waits for an answer, one in the color of what failed did. The pointer over a tile says which task it is and how it stands. While sub-agents of an agent have tasks of a board, a line joins that agent and the board, the agent's card says how far the board is, and each of those sub-agents is called by its task ("Task 7: reading a file"). Under the boards every MCP server and every skill |
| An agent's card | Its avatar and name, and its mode as a badge at the right (`bypass` in the color of what warns). While it works, a small dot beside its name fades out and in, as it does on its tab |
| A colored border and a tint | Something happens there right now, in the agent's color. A question for you is in the theme's color for a question, a source that is down in its color for what failed. Everything else has a plain border |
| A line between two things | Something happens between them right now, in the color of the agent it happens to: from a trigger to the agent it started, from an agent to the MCP server or skill it is using, beside the agents from one to the agent it delegated a task to, and in the color of a question from an agent to you while it waits for your answer. A line starts with a dot and ends with an arrowhead, and a dot runs along it the way things go. Every line has a lane of its own and turns at 45 degrees, so no two lie on top of each other |
| A line at the right of the agents | The answer to a delegated task on its way back: when the task ends, a line runs for a few seconds from the agent that did it to the agent that delegated it, in the color of what failed if it did. The task went out at the left of the agents, its answer comes back at their right. What you asked an agent for comes back to "You" the same way |
| The pointer over something | Thin lines to all it is wired to (for an agent its sources, schedules, MCP servers and skills; for a source or a server, everybody who has it), and the rest fades. The line on top of the panel says what it is |
| A click on an agent | Unfolds it: a line for each of its conversations, a branch set in under what it was branched from, with "in a worktree" and its goal where it has one. The agent is shown under the view; a double click opens it |
| The eye, at the top right | Follow activity, on at first: the camera keeps everything that something happens at in view and moves there softly; with nothing happening it shows the board from its top, as wide as the panel. A double click on the empty board turns it on again |
| Dragging, scrolling, pinching | Moves the board, and zooms it (a pinch, or scrolling with `ctrl` or `cmd` held, around where the pointer is). The camera then stays where you put it and no longer follows |
| Zooming out | From far away every box is one line: a name and how it stands. An agent says `working`, `waiting`, `asks you` or `idle`; a board how far it is and its bar. All of pine fits in the panel that way |
| Zooming in | From close by every box says all there is. An agent: under each piece of work and each sub-agent how long it has run, how many tools it called and its last tool calls by name (one that failed in the color of what failed, the one it is in now in the agent's color), what it finished lately, what it has (sources, schedules, MCP servers, skills) and its conversations. A board: a row for every task with its number, what its worker is doing and for how long, what it waits for, and at the right its notes, whether it had an answer, and whether it carries outside content; a task that comes after another stands under it. A trigger says how many events it brought and when the last one came, a schedule how it is set and when it last ran, a tool who has it and who is using it |
| A click on a board, or on one of its tasks | Shows it under the view: for a task what it says, how it stands, its result or its question, and the notes about it; for the card, the whole board with every task. A click on a task there goes to it |
| The button beside the eye | Show everything: the whole board in the panel, from far if that is what it takes to read it |

It has no timeline: what happened, in order, is the list the panel shows under every view.

## Settings

`⌘,` opens the settings panel in a tab of its own, beside the conversations (the same key puts
it away again; the event log is a tab in the same way). It is pine's configuration, changed by
clicking instead of by a command or by asking an agent. Each page asks the daemon what there is and tells it what to change.
The daemon checks a change as it checks the main agent's (the same code), writes it, reads the
configuration back, and undoes what does not load. You are not asked to confirm in a dialog
of pine's: the app is your own hand, like a `pine` command.

**Search** at the top of the list of sections (`⌘F` while Settings are in front) finds a
setting by its name, by a word of what it does or by its key in `pine.json`, and also what pine
has: an agent and each of its fields, a provider, a model server, an MCP server, a skill, a
source, a schedule, a route, a machine. The results are listed best first, each with the way to
it (General › Limits), and the sections with nothing that fits fade. Enter or a click goes
there, scrolls to it and outlines it for a moment. Escape empties the field. The palette (`⌘K`)
lists the same results under In Settings.

| Page | What you do there | The same by command or by asking the main agent |
|---|---|---|
| General | From the top: **This app** (the theme, the app's version and whether there is a newer one with Check now, whether that is asked at the start, Update automatically, notifications); **pine**, the pine the app talks to (its version, started here or attached, the main agent, whether there is a sandbox, Show log, Restart, Keep pine running after the app quits, the `pine` command for a terminal, whether the browser of the web tools is on this computer with Fetch it, the home folder); **Worth a look**, the notes `pine check` would print about this setup; then pine's settings in three framed groups, **Defaults for agents**, **Limits** and **Security**: the model, reasoning and mode agents start from, how long a command and a task may run, how many agents work at once, and what pine asks you about. Each setting has a name and a sentence on what it does; its key in `pine.json` is shown when you point at the name. A number or a time is saved with Enter or when you leave the field. What only tunes pine to a model server is not there: that is written into `pine.json` by hand ([setup.md](setup.md), "pine's settings") | `set_setting`; `pine check`; `pine browser-install` |
| Agents | Every agent. On an agent's page: at the top its avatar, which opens its color (None, a preset, or Other with any color, kept at once: its avatar in the side bar, on its tabs, in its panel and on an empty conversation is drawn in it, and the window takes its primary while its conversation is in front), and its name, which a click turns into a field that renames it (Enter or leaving the field; Escape keeps the name); then Model (model and reasoning), Instructions (the files it reads: `AGENTS.md`, `SOUL.md`, `TOOLS.md`; its `MEMORY.md` and your rules for it are shown), Permissions (mode, network for its shell commands, built-in tools and the agents it can delegate to, as checkboxes), Folders outside the workspace (with Add folder, read only or read and write), What this agent has, and Remove. A change waits in a bar at the foot of the page, Unsaved changes, with Discard and Save changes. What it is for, beside its name in the side bar and in the list, is the first paragraph of its `AGENTS.md`. New agent (a name and its instructions, the first paragraph saying what it is for; the same dialog as `+` beside "Agents" in the side bar, and the new agent's conversation opens in a tab); Remove, with or without its folder. Under the list, **Instructions for all agents**: the three files in pine's home that every agent reads (`AGENTS.md`, `TOOLS.md`, `USER.md`), one tab each, saved with the same bar | `create_agent`, `update_agent`, `rename_agent`, `remove_agent`; `pine agent …`; telling the main agent something that is for all agents |
| Models | First what is missing: **Connect a model first**, or each agent whose model cannot answer, with the reason. **Subscriptions and API keys**: Claude, ChatGPT and GitHub Copilot, and whatever you are signed in to; a search finds the other providers. Sign in through the browser or with an API key, sign out; after a sign-in, the choice of the default model. **Default model** (`defaults.model`), once there is a model: the one agents use unless one is set for an agent, with Change. **Subscriptions and API keys** as above. **Models on your own computer**: model servers you connected, each with its address, its models on lines of their own, each with how many agents use it at the same time (`limits.models`; Pine default is `limits.maxConcurrentRuns`), removed with Remove, and **Connect a server**, a dialog that takes an address and a name (and a key when the server wants one) | `add_model_server`; `pine model …`, `pine login`, `pine logout`; `set_setting` |
| MCP servers | Every server with whom it is for and whether it connects. **Add server** opens a dialog: a remote one (its https address) or a program on this computer, for all agents or one. Sign in to a remote one through the browser. Remove | `add_mcp_server`; `pine mcp …` |
| Skills | Every skill with whom it is for. Read one, change it, add one for all agents or one agent, remove one. A skill that lies in a folder of yours that the configuration names is shown and not changed | `add_skill`, `remove_skill`; `pine skills` |
| Events | Three sections one under the other, so that nothing set up is out of sight, each with its button to add one. **Sources**: what runs, who is subscribed, the last event; add one by type (the type's options as a form, what it will do said before it is added, a password or token typed into a field of its own), subscribe an agent or all agents, end a subscription, remove. **Schedules**: each schedule said as When and Then (whom it wakes, with what task); New schedule opens a form in the same words: When (at set times, every so often, once at a time, once after a while), Then which agent (or every agent) and the task, then a name; remove. **Routes**: first when you need one at all (an agent that reacts to a source is subscribed to it, a time is a schedule); each route said as When and Then; New route opens a form in the same words: When (the topic, an optional condition, how often), Then one of wake an agent, set shared state, publish an event, ask a model once and publish its answer, with only that one's fields shown and sent; remove | `add_source`, `subscribe`, `add_schedule`, `add_route`; `pine sources`, `pine subscribe`, `pine schedules` |
| Environments | This computer and the machines whose pine the app can use, over SSH: add one by its host, use one, forget one. See "Environments: the pine of another machine" | `ssh` to the machine and `pine` there |
| Browser access | Devices paired by a QR code or on the network, and the switches that let them in. Its section follows Environments | None: it is the app's own, not pine's |

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
| An answer is content, not a page | It is drawn from markdown (Streamdown, with code colored on the page by Shiki) and cleaned of everything that could act or restyle: scripts, styles, forms, frames, svg, media tags, style, class and id attributes, `javascript:` links. A small picture written into the text (`data:` png, jpeg, gif, webp) is shown. The window's own policy lets it load nothing from the web |
| A link says where it leads | The address stands next to a link whose words are not the address, and only `http` and `https` addresses open, in your browser |
| Nothing is fetched because an answer contains it | A picture at a web address is a line to click (`Load picture · https://…`); the daemon then fetches it, with its guard against addresses in your network. A picture at a path in the agent's workspace is shown from there |
| Nothing plays because an answer contains an address | A sound plays by itself only where it is a file of the agent's workspace, which the daemon serves, and its answer has just arrived. One at a web address is a line to click, like a picture |
| What is drawn straight from the daemon | Only pictures, video and sound, by fixed addresses of the control API. The bars of a sound are measured from the same bytes, which the app asks the daemon for; the page reads no file |
| Notifications and the window's title | pine's own words only |
| What is heard | Text for the input: never sent by itself |
| A code block's Run button | Only your click types a block into your terminal, and only a block whose every character shows as itself: an answer cannot run anything by itself, nor hide a part of what it runs. What the agent hears back is that block's output, quoted, and nothing you typed |
| The window stays the app | A link or answer cannot take a window to another address or open a window of its own; only your own window actions open Pine windows |
| The agent's browser beside a conversation | With this computer's pine, the page itself: the app has the agent's browser, a view of its own in each local window laid over the panel (its own session, sandboxed, nothing of the app's in it), which you use as any browser and the agent drives at the same time; a second local window on the same browser tab draws pictures until focused, and closing a window detaches the view without closing the tab. All of it goes through pine's guard, the same as the browser pine starts itself, which the agent goes back to when the app is closed; logins made in one are not in the other. Its address and titles are text in the app. While a dialog or a menu of the app's lies over the panel, a still picture of the page stands in for it. With another machine's pine, on the phone and in the web client: a picture, drawn, and the app hands the daemon what you did in it (places, keys, an address), which the browser's own server checks piece by piece |
| Browser access | Off until you turn it on. Then the app's SSH server of its own (not the system's SSH server, Remote Login on macOS) accepts only the keys you allowed at this computer, by key and never by password, and gives them this computer's pine and nothing else; at most 8 connections at a time, and one that has not signed in within 20 seconds is closed. A device's name is shown as plain text, 60 characters at most. See "Browser access" |
| On the local network | While browser access and Visible on this network are on, a Bonjour record (`_pine._tcp`) named "Pine" and the start of this computer's key fingerprint, never its name, with that fingerprint, the service's address and a random word that changes every five minutes, which a request without a code has to name. Nothing listens behind it: a phone still goes through the service and checks the key, and the four digits are what you compare. Requests without a code are one at a time and paused after refusals. While visibility is off the app has no socket on port 5353 |
| What the app itself asks the web | GitHub, for pine's last release and, when it is newer, its update (see "A newer version"). The question and the update's feed send the user agent `Pine` and nothing else; the update's zip is fetched by macOS's updater, whose user agent names the app's version and the version of macOS. Of the answer only the release's number is used, and the link and the update's address are made by the app and lead to pine's releases on GitHub, whatever was answered. And, only while browser access is on, its service: this computer waits there under its key's fingerprint, and a browser that asks for it is introduced; the conversations never pass through it |

The app does not reach into pine's home: it reads no configuration file and no token file
itself. What it knows, the daemon told it.

## Packing and signing

`node scripts/pack.mjs` (in `desktop/`; `npm run pack`) makes the app that is handed out.

| Flag | What it does |
|---|---|
| `--dmg` | Also a disk image, `release/Pine-<version>-<arch>.dmg`; the app zipped after its ticket is stapled, `Pine-<version>-<arch>.zip`; and the update feed that points at the zip, `Pine-<arch>.json` |
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
`main`, on a runner for each kind of Mac, and attaches the disk images, the zips and the
update feeds to the GitHub release. It takes the five values from secrets of an environment named `release`. Without
them it builds no app and says so. To build the app of a release again (after a job that
failed), run the workflow by hand from `main` with that release's version:
`gh workflow run release.yml -f version=0.38.0`. Nothing is published; the disk images, zips and
feeds are attached to that release. Building the helpers takes the macOS 26 SDK or a newer one.

## For changing the app

```
desktop/
  electron/
    main.ts        the main process: the windows, menus, dialogs, notifications; the daemons' tokens
                   and every call of the control API; the two addresses the page may load from
    daemon.ts      what the page may ask the daemon for, without Electron: a call's check and
                   forwarding, the media served straight from the daemon (`MEDIA`), the live events
                   in batches, the page's content security policy
    preload.ts     the bridge: the short list of things the page may ask the main process for
    browser-host.ts the agents' browsers in local windows: each tab a view of its own laid over the panel,
                   behind the guard of the browser server that drives it through a WebSocket with a word
    service.ts     finds node and pine, runs `pine service`, keeps the daemon it started
    command.ts     `pine` for a terminal: the link into the shell's PATH, made and removed
    updates.ts     whether there is a newer app: GitHub asked for the last release, the link to its page
                   and the address of its update feed (stand-ins for tests: PINE_DESKTOP_RELEASES,
                   PINE_DESKTOP_DOWNLOADS)
    updater.ts     the app's own update: Electron's autoUpdater (Squirrel.Mac) on that feed, downloaded
                   in the background, installed at Restart to update or at quit; a stand-in for tests
                   (PINE_DESKTOP_UPDATER)
    access/        browser access, without Electron (they run under plain Node in tests and in the
                   web client's smoke): server.ts the access server (ssh2 on any duplex stream: the
                   remote command answered with this computer's service line, direct-tcpip to that loopback
                   port, nothing else), store.ts this computer's host key and the paired devices,
                   pairing.ts the one-time code, the request without a code and its limits, and the four
                   digits, nearby.ts this computer on the local network (Bonjour) and `pine://pair`,
                   peer.ts the WebRTC data channel
                   (node-datachannel), host.ts what waits at the meeting service and hands each
                   channel to the server, control.ts the switch, the address and what the page reads
                   (`OFFICIAL_SERVICE`), stand-in.ts a host without network for the app's tests
                   (PINE_DESKTOP_ACCESS_STAND_IN)
  src/             the page (React)
    model.ts       what the page knows: tabs, what each conversation shows, the daemon's live events
    api.ts         the control API, typed
    App.tsx        the window: side bar, tabs, the dialogs for keys, updates and the browser
    ApprovalDialog.tsx, QuestionDialog.tsx     a request for the owner's approval, a question of an agent's
    Palette.tsx, PickDialog.tsx  everything by name, a choice from a list
    Conversation.tsx, Composer.tsx, markdown.tsx     a conversation, the input, an answer drawn (a picture
                   in either opens larger in a stock Dialog of its own)
    CodePanel.tsx  changes, files and the editor, output, what is running
    Board.tsx      the Board tab: the tasks and notes a conversation shares with its sub-agents
    Browser.tsx    the agent's browser in its aside: the app's own browser laid over it (electron/browser-host.ts), or its page as a picture, and what is done in it handed back
    View.tsx       the view's panel: what asks you, the view in its sandboxed frame, what happened, what is
                   chosen. view-world.ts is pine as the page knows it, made from the live events; view-state.ts
                   is what a view is told of it (names and states, no text); view-frame.ts (view.html) is the
                   frame a view runs in, with "pine/view" (../src/view-kit.ts)
    Settings.tsx   the settings pages; settings-index.ts is what their search finds and where it is
    BrowserAccess.tsx, machines.ts  Settings > Browser access; how the page names a machine and draws a
                   pairing on the first screen
    DevicePairing.tsx  the Add a device dialog (its QR code, components/qr-code.tsx), the toast when a
                   device asks, and the one when visibility is paused, beside the app wherever you are
    Pairing.tsx    a pasted pairing link, and the computers found on the network (the mobile app's)
    commands.ts    the commands: one list for the palette, the menus and what is typed after a slash
    components/ui/ shadcn's components, as its CLI added them (`npx shadcn@latest add <name>`)
    components/    only what stock components cannot express when composed in place (printed.tsx:
                   what a tool or a program printed, a Code Block that follows its end; sound.tsx:
                   a sound's line, its player and its bars, measured with src/tui/levels.ts), and pine's
                   own small parts (logo.tsx: the logo; empty-view.tsx: a view with nothing in it;
                   agent-avatar.tsx: an agent's initial on the stock avatar, in its own color; pine's mark for the main agent);
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
                   launcher that becomes Resources/bin/pine), preview.ts (the page in an ordinary
                   browser, `npm run dev:preview`: Vite's server makes every call for the page,
                   on a throwaway pine or the home `--home` names), test.mjs (`npm test`: the
                   app built once for the run, a temp folder of the run's own, a file that
                   failed run again alone), launch-json.mjs (the checkout's ports and
                   .claude/launch.json), leash.mjs (a preview or `dev` ends with its starter),
                   update-feed.ts (the names of a release's zip and update feed, and the feed)
  test/            the app from end to end, driven through its real window, which is drawn
                   and never put on the screen; command.test.ts, updates.test.ts,
                   daemon.test.ts and preview.test.ts need no window.
                   support/: the build a test starts, without a screen (app.ts), the one
                   window of app.test.ts and app-around.test.ts (window.ts), and a daemon
                   of the test's own told from another run's by its token (daemon.ts)
```

- The page asks for something new through `preload.ts` and a handler in `main.ts`, never by
  getting more of the system. A handler checks that the call comes from the app's own page.
  `src/preview-bridge.ts` implements it too: it returns the `Bridge` type, so a missing method
  fails `npm run check`. If it needs the daemon, `scripts/preview.ts` routes it under `/__pine/`.
- The page is also the Android and iOS app's ([mobile.md](mobile.md)): `mobile/src/mobile-bridge.ts`
  returns the same `Bridge` type, and so does the web client's (`web/src/frame-bridge.ts`,
  [web.md](web.md)). Four parts of the bridge are optional and only those two give them: `local: false` in `state()` (no machine of its own: the page hides This Mac (This computer
  off macOS), Use this Mac, Set up pine, the local row of Settings > Environments, the local-only parts of
  Settings > General and the palette's "Use the pine on this Mac" (each of these names this computer by
  `computerWord` in `src/machines.ts`: Mac on macOS, computer elsewhere), and never sends `use(undefined)`),
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

A button's look says what it does, the same on every page:

| Look | For | Examples |
|---|---|---|
| Filled (the theme's primary color) | The one action that finishes what you are doing. At most one in view | The button that submits a dialog, Save changes, Restart to update, Trust this key, Allow |
| Outline | Everything that opens, adds, changes or shows something | New agent, Add server, New source, Connect a server, Sign in, API key, Change…, Subscribe, Rename, Show, Event log |
| Ghost | Taking something away or backing out | Remove on a row (it asks first), Sign out, Forget, Discard, the way back above a page's title |
| Destructive (red) | The last step of something that cannot be undone | Remove… on an agent's page, the button that confirms a removal |

A button inside a row of a list is a size smaller than the others. A key shown on a filled or red
button (Allow `a`, New conversation `⌘T`) is a darker shade of that button, in the button's own
text color. Settings keeps to this; other parts of the page are brought to it as they are changed.

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
  The page's density is one `font-size` on `:root` in `index.css` (15px): every rem size (text,
  spacing, components) follows it, so no component sets a font size of its own. On that root the
  scale's `text-sm` and `text-xs` are set to 14px and 12px (`@theme` in `index.css`), the app's own
  text and its small labels; a conversation (answers, your messages, the message box) is
  `text-base` with `leading-snug`, 15px on lines of 20.6px. Corners come from shadcn's
  `--radius`. The one size that is not on the scale is the room for a Mac's window buttons at the
  start of a bar along the top (`pl-window-buttons`, a token in `index.css`): the window says where
  the buttons end (`titleBarOverlay` in `electron/main.ts`, read as `env(titlebar-area-x)`), so it is
  none in full screen, in an ordinary browser (the preview, Storybook) and on another system.
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
- The model asks pine for its themes when it connects, when Settings > General is opened, and when pine
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

### Loading

What loads and has a known final shape shows a Skeleton of that shape while it loads: stock
shadcn `Skeleton` (`data-slot=skeleton`), with its own smooth `animate-pulse`, never edited. Pulse
stays for what is at work (a busy agent, an action in flight inside a button or a badge) and for
what has no known shape yet (the Gate before a host connects), so "working" still reads apart
from "loading".

- A composition of pine's (`src/components/`, and the ones drawn in a view's own file) takes
  `skeleton?: boolean`: with it, it draws its own shape from stock `Skeleton` blocks (and
  `SidebarMenuSkeleton` for a side bar row), at its real size, and reads none of its data, whose
  props are then optional. A caller writes `<AgentAvatar skeleton />`, not placeholder blocks by
  hand. Never on a file of `components/ui/`.
- A view that loads its own data (Browser, Terminal, BrowserAccess, the view's frame, the
  conversation body) draws its own exported `<View>Skeleton` (`BrowserSkeleton`,
  `ViewFrameSkeleton`, `ConversationSkeleton`) in place of its body; the `skeleton` prop is for the
  compositions a caller places.
- A skeleton shows on the first load only, while `useLoad` has neither data nor an error. A reload
  keeps what is shown, and there is no delay before a skeleton appears.
- Loading is told apart from empty: an empty state shows only once the data is there.
- Each composition's or view's skeleton is a story of its own beside it, `<Name>Skeleton`
  (`AgentAvatarSkeleton`, `BrowserSkeleton`); a dialog that loads its list inside its own frame
  names that state `<Name>Loading` (`PickDialogLoading`, `PaletteLoading`).
- The app test that forbids an animation running smoothly forever while agents work lets
  `[data-slot=skeleton]` through, and only it: a skeleton lasts only while content first loads.

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
(`.github/workflows/chromatic.yml`), which shows what changed in a picture for review. A
build of `next` is accepted as it is (`autoAcceptChanges`) and becomes the baseline a pull
request is compared with, so a pull request shows only its own changes. It needs the repository secret `CHROMATIC_PROJECT_TOKEN`; without it the job says so and passes.
Chromatic takes each story in light and dark, each at a phone's width (360, the window's
smallest) and at the window's first width (1280), through its modes (`.storybook/modes.ts`,
which set the `theme` global and a viewport), so no dark or phone twin of a story is written:
four snapshots a story. The same two widths are the Viewport menu in Storybook's toolbar.
