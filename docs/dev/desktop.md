# The desktop app: for contributors

How the Pine app (`desktop/`) is run from a checkout, packed, signed and changed. What an owner
does with it is in [references/desktop.md](../references/desktop.md). Before you change
`desktop/src`, read `desktop/.agents/skills/shadcn/SKILL.md` with its `rules/`, and
`desktop/DESIGN.md` (see the repository's `AGENTS.md`).

## Starting it from a checkout

`npm install` in `desktop/` once (it has its own `package.json` and `node_modules`).

| Command (in `desktop/`) | What it does |
|---|---|
| `npm start` | Builds the app and opens it |
| `npm run dev` | Opens it with the page served by Vite, reloading on every change. It ends, with the app and the daemon it started, when whatever started it is gone (`scripts/leash.mjs`). The page is served at the checkout's own port; `$PORT` overrides it, and the next free one is taken when it is in use |
| `npm run dev:preview` | The page in an ordinary browser on a throwaway pine. `-- --home <dir>` uses that home instead. See "The page in a browser" |
| `npm run dev:preview:home` | The same on `~/.pine`, at the next port. Its agents are your real ones |
| `npm run check` | Type check |
| `npm test` | The app from end to end (`scripts/test.mjs`): see "Tests" |
| `npm run pack` | The app for this system, with pine, Node and the helpers inside. See "Packing and signing" |
| `npm run dist` | The same, and what is handed out: a disk image, an AppImage and a .deb, an installer |
| `node scripts/smoke.mjs` | Starts a packed app from a folder of its own on a home of its own, and checks that it answers with the pine and Node it carries, that the terminal runs and a Run block reports, that `pine` works through its link (`pine.cmd` on Windows), and on a Mac that pine finds the helpers in the app. Run it on the system the app was packed for |
| `npm run storybook`, `npm run build-storybook` | See "Stories" |

On a Mac, `npm start` and `npm run dev` run a copy of Electron named Pine, with Pine's icon and
signed again for this Mac, so that the menu bar and the Dock say Pine
(`scripts/dev-electron.mjs`, made once per Electron version in `node_modules/.cache/pine-dev`).

An app from a checkout has View > Reload and View > Toggle Developer Tools, which a packed app
lacks: `⌘R` and `⌥⌘I` on a Mac, `F5` and `Ctrl+Alt+I` elsewhere (`Ctrl+R` is Dictate Message there,
and `Ctrl+Shift+I` the side panel's Agent view). It asks nobody about updates and installs nothing.
It is the handler of `pine:` addresses only with `PINE_DESKTOP_PROTOCOL=1` (a packed app always is).

Which pine the app runs, in this order: what `PINE_CLI` names; the checkout the app lies in; the
pine packed into the app; the `pine` of the owner's shell. pine runs on Node 24 or newer, never on
Electron. A packed app's pine runs on the Node it carries. Otherwise the app finds `node` the way
the login shell does (it asks the login shell for its environment, since an app started from the
Finder has none), and a packed app falls back to its own Node.

## The page in a browser

`npm run dev:preview` serves the app's page at `http://localhost:<port>`, for an editor's preview
pane or any browser, without the window. It is a tool for working on the app, not a way to use
pine. The port is the checkout's own, from a hash of its path into 176 blocks of four ports between
5200 and 5902 (`scripts/launch-json.mjs`), so that two worktrees rarely share one. `$PORT` wins.
When the port is taken the preview refuses to start; `PORT=<another>` starts it. It ends, with its
throwaway pine, when whatever started it is gone.

| How it is started | What it runs on |
|---|---|
| `npm run dev:preview` | A throwaway pine: a temp home with `main` and `scout` and the scripted model of pine's tests, removed when the preview stops |
| `npm run dev:preview -- --home <dir>` | That home. A running daemon is used; otherwise one is started that goes on after the preview. The preview never stops it and never removes the home |
| `npm run dev:preview:home` | `--home ~/.pine`, at the port after the throwaway one's. A message is a real one, to your real agents |

`.claude/launch.json` has an entry for each (`desktop-preview`, `desktop-preview-home`), so that
Claude Code's preview pane starts the one you name. It is not in git: `npm install` in `desktop/`
writes it with the checkout's ports, keeping entries of other names; `node
desktop/scripts/launch-json.mjs` does it by hand. Run that after pulling, or when the pane lists no
`desktop-preview`.

The throwaway pine has no web browser and no real model: look at the agent's browser and real
answers on `desktop-preview-home`.

The preview's server (`scripts/preview.ts`) stands where the main process stands: it holds the
token and makes every call for the page through the same module (`electron/daemon.ts`), with the
same checks, only for a POST of JSON from the page's own loopback origin. The page's stand-in for
the bridge is `src/preview-bridge.ts`, which exists only in that mode, calls the server under
`/__pine/`, and must never reach a build (`test/preview.test.ts`). What only the app can do does
nothing there: menus, notifications, the dock badge, dictation, updates, `pine` for a terminal,
restarting pine, setting pine up. A right click's menu is drawn by the page itself, as in the web
client. A folder is opened by typing its path.

## Packing and signing

`node scripts/pack.mjs` (`npm run pack`) makes the app that is handed out. An app for Linux is
packed on Linux, one for Windows on Windows.

| Flag | What it does |
|---|---|
| `--dir` | The app alone, as a folder (the default): what `--prepackaged` takes. `release/mac-arm64/Pine.app` (`release/mac/` on Intel), `release/linux-unpacked/` (`linux-arm64-unpacked`), `release/win-unpacked/` (`win-arm64-unpacked`) |
| `--dist` | Also what is handed out: `release/Pine-<version>-<arch>.dmg` on a Mac with what its updater reads (`Pine-<version>-<arch>.zip`, zipped after the ticket is stapled, and the feed `Pine-<arch>.json`); `Pine-<version>-<arch>.AppImage` and `.deb` on Linux; `Pine-<version>-<arch>-setup.exe` on Windows |
| `--dmg` | The same as `--dist` (what the Mac release job runs) |
| `--prepackaged <folder>` | Packages an app packed before with `--dir`, without building again: a release signs the Windows app's programs in between |
| `--arch` | `arm64` or `x64`. Default: the processor it is packed on. On a Mac the helpers are built for both either way |
| `--no-pine` | Without pine, Node and the helpers: the app then uses the owner's `pine` |
| `--out` | Another folder than `release/` |

The app's resources (`Pine.app/Contents/Resources` on a Mac, `resources/` elsewhere):

| Folder | What it is |
|---|---|
| `pine/` | The package `npm run build` makes, with its dependencies, and on a Mac the helpers built by `scripts/helpers.mjs` in `prebuilt/` folders beside their sources (`src/prebuilt.ts`); on Windows the C# helpers |
| `node/` | Node and its licence from nodejs.org (`bin/node`, `node.exe` on Windows), the version that runs the pack script, checked against nodejs.org's checksums |
| `bin/pine` | The terminal launcher (`scripts/pine.sh`); on Windows `bin/pine.cmd` (`scripts/pine.cmd`), whose folder the installer adds to the user's PATH (`scripts/installer.nsh`) |
| `wsl/` | On Windows: Node for Linux, for the pine the app brings into a WSL distribution (`electron/wsl.ts`) |

The macOS minimum is the older of Electron's and the carried Node's (`oldestMacOsForApp`). On Linux
the program is `pine-desktop`, not `pine` (a .deb puts it into `/usr/bin`). Nothing is signed on
Linux and Windows here; a release signs the Windows programs between `--dir` and `--prepackaged`
(SignPath, `desktop/signpath/`).

The Mac app is always signed with the hardened runtime. Whom for is set in the environment:

| Variable | What it is |
|---|---|
| (none) | Ad hoc, for this Mac only. Another Mac refuses it |
| `CSC_NAME` | The name of a "Developer ID Application" identity in the keychain |
| `CSC_LINK` | That certificate with its key as a `.p12` (a path, or base64), with `CSC_KEY_PASSWORD` |
| `APPLE_API_KEY` | An App Store Connect API key (`.p8`). With `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` the app is notarised, which a downloaded app needs to open |
| `PINE_VERSION` | The version of the app and its pine. Default: `package.json`'s |

The Release workflow (`.github/workflows/release.yml`, job `app`) does this for every release from
`main`, takes the five values from the environment `release` (without them it builds nothing and
says so), and attaches disk images, zips and feeds. To rebuild a release's app:
`gh workflow run release.yml -f version=<version>` from `main`. The helpers need the macOS 26 SDK.
The repository's `AGENTS.md`, "Releases", covers the Linux, Windows and Android jobs.

## Updates

`electron/updates.ts` asks GitHub for the last release (user agent `Pine`, nothing else) and makes
the release page's link and the update feed's address itself from the version and the kind of Mac,
whatever was answered. `electron/updater.ts` is Electron's `autoUpdater` (Squirrel.Mac) on that
feed; the zip is fetched by macOS's updater, whose user agent names the app's and macOS's versions.
A release counts once its disk image and feed for that Mac are attached. `scripts/update-feed.ts`
names the zip and the feed. With **Update automatically** turned off after a download, macOS may
still install that update at the next quit. Stand-ins for tests: `PINE_DESKTOP_RELEASES`,
`PINE_DESKTOP_DOWNLOADS`, `PINE_DESKTOP_UPDATER`.

## How the app reaches a pine

- This computer's: `electron/service.ts` runs `pine service`, attaches to or starts the daemon,
  starts again one it started that stops answering, and stops one by closing its input so that it
  closes its database first.
- Another machine's: `src/remote.ts`. One ssh connection (`BatchMode=yes`) runs `pine service` with
  the PATH of the login shell there (sh, bash, zsh, fish, csh, tcsh; nvm's node). A local port is
  forwarded through its control socket (`ssh -O forward`), which ssh binds itself; a taken port is
  reported at once and another tried. A service line that names anything but the remote loopback is
  refused. On Windows, WSL is reached the same way (`connectWsl`; paths translated in
  `electron/wsl.ts`).
- `prefs.json` (`electron/prefs-file.ts`): `hosts`, `use`, `windows` (each window's environment,
  bounds, tabs and layout), `layout`, `look` (the last theme, made safe by `cleanLook`), `access`.
  Written whole or not at all; an unreadable one is moved to `prefs.json.unreadable`; `prefs.log`
  says why a machine was dropped.
- What the app starts (the daemon, `pine init`, the login shell, the terminal's shell) gets none of
  the app's open files: on Linux, where Chromium leaves them open across a start, each starts behind
  `bash`, which closes all but stdio and becomes the program (`electron/fds.ts`).

## The agent's browser in the window

With this computer's pine the browser of an owner's conversation is a set of tabs in the window
(`electron/browser-host.ts`): each a `WebContentsView` with a session of its own, sandboxed, no
preload, laid over the panel. Playwright reaches them through a WebSocket on the loopback with a
word, built from each tab's own debugger, which reaches only the tabs of the conversation the
connection names. Every tab's session goes through the connecting server's guard proxy. If two
windows show the same tab, the focused one holds the live page and the other the picture stream.
While a dialog or menu covers the panel, a still picture stands in. Elsewhere (another machine, the
phone, the web client) the page is a picture drawn by `src/Browser.tsx`, and what the owner did is
handed to the browser's server, which checks it piece by piece. Rule 8 in `AGENTS.md` has the
invariants.

## The terminal's hooks

`electron/terminal.ts` runs the owner's shell; `electron/shell-hooks.ts` marks when a command starts
and ends: zsh and bash after the owner's startup files, PowerShell after the profile by wrapping
its prompt and PSReadLine's line (as VS Code's shell integration does). Another integration's marks
are read for the exit code too: WezTerm's (`/etc/profile.d/wezterm.sh`) writes `D;<code>;aid=<pid>`,
and one without a code does not hide pine's. A report goes to `POST /agents/<id>/terminal`
(`terminalNotice` in `src/background.ts`) as a `notify` task with the output quoted. A message
written in the app sends `"via": "app"`, which the agent's note turns into "read in the Pine app".
Test stand-ins: `PINE_DESKTOP_SHELL`, `PINE_DESKTOP_STILL_RUNNING_MS`.

## Browser access

What an owner sees of it is in [references/desktop.md](../references/desktop.md), "Browser access:
a browser with no SSH to set up"; why it is built so, in [ADR 0004](../adr/0004-browser-access.md)
and [ADR 0005](../adr/0005-pairing-from-nearby-devices.md). The code is `electron/access/`.

- The access server is an SSH server on `ssh2` with two permissions (rule 10 in `AGENTS.md`): at
  most 8 connections (`MAX_CONNECTIONS`), 20 seconds to authenticate (`AUTH_TIMEOUT_MS`), a device
  name of at most 60 characters.
- The host key, the paired devices and a relay's password are in `access.bin`, sealed with
  Electron's safe storage; the switches, the service address and the relay's address and user name
  are in `prefs.json` (`access`).
- The announcement on the local network (`nearby.ts`) is a Bonjour record `_pine._tcp` named
  "Pine", carrying the start of the host key's fingerprint, the service's address and a word that
  changes every five minutes, which a request without a code has to name. Nothing listens behind
  it: a phone still goes through the meeting service and checks the key.

## Layout

```
desktop/
  electron/        the main process
    main.ts        the window, menus, dialogs, notifications; the daemon's token and every call
    daemon.ts      what the page may ask the daemon for, without Electron: the check and forwarding,
                   media straight from the daemon (MEDIA), live events in batches, the page's CSP
    preload.ts     the bridge: the short list of what the page may ask the main process for
    browser-host.ts the agents' browsers in the window
    service.ts     finds node and pine, runs `pine service`, keeps the daemon it started
    fds.ts         what a started program gets of the app's open files (Linux)
    command.ts     `pine` for a terminal: the link, made and removed (Windows: only looked for)
    terminal.ts, shell-hooks.ts  the owner's terminal and its hooks
    updates.ts, updater.ts  whether there is a newer app; the app's own update
    wsl.ts         pine in WSL on Windows: install, paths
    access/        browser access, without Electron: server.ts (ssh2: the remote command answered
                   with the service line, direct-tcpip to that port, nothing else), store.ts (host
                   key, paired devices), pairing.ts (one-time code, requests without a code and
                   their limits, the four digits), nearby.ts (Bonjour, `pine://pair`), peer.ts
                   (WebRTC data channel, node-datachannel), host.ts (waits at the meeting service),
                   control.ts (the switch, the address, what the page reads), stand-in.ts (tests:
                   PINE_DESKTOP_ACCESS_STAND_IN)
  src/             the page (React)
    model.ts       what the page knows: tabs, conversations, live events
    api.ts         the control API, typed
    App.tsx        the window: side bar, tab groups, dialogs for keys, updates and the browser
    dock.ts        a window's arrangement of tabs: a tree of splits and groups (no DOM)
    ApprovalDialog.tsx, components/question-card.tsx  an approval; an agent's question
    Palette.tsx, PickDialog.tsx  everything by name; a choice from a list
    Conversation.tsx, Composer.tsx, markdown.tsx  a conversation, the input, an answer drawn
    CodePanel.tsx  the side panel; Board.tsx its Board tab; Browser.tsx its browser
    View.tsx       the view's panel. view-world.ts is pine as the page knows it; view-state.ts what a
                   view is told (names and states, no text); view-frame.ts (view.html) the frame
    Settings.tsx   the settings pages; settings-index.ts what their search finds
    AgentFiles.tsx an agent's instruction files as tabs over an editor, the same part on the agent's page
                   in Settings and in the side panel's Agent tab; Editor.tsx the editor itself (CodeMirror)
    things.ts      what Settings and the side panel's Agent tab (AgentView.tsx) share about sources,
                   schedules, routes, skills and servers: how one is said in words, the sign that a list
                   changed (`LISTS`), and `openThing`, which opens a route, a schedule or a skill in the
                   one dialog App.tsx holds (`ThingDialog` in Settings.tsx)
    Manual.tsx     the Manual tab: pine's manual from the daemon (`GET /manual`), its parts, chapters, a chapter, its search
    sign-in.ts     a provider sign-in as the page follows it; components/sign-in-card.tsx its card
    setup/         Setup Pine's steps: engine.tsx walks them, types.ts, branches.ts (`BRANCHES`: one
                   module per way to a model, subscription.tsx, api-key.tsx, local.tsx; `AFTER`:
                   handoff.tsx, the card "Next"). A new way is a module and one line there
    BrowserAccess.tsx, machines.ts, DevicePairing.tsx, Pairing.tsx  browser access and pairing
    commands.ts    one list of commands for the palette, the menus and the slash
    components/ui/ shadcn's components, as its CLI added them
    components/    only what stock cannot express in place, and pine's own small parts
    lists.tsx      ui-sdk's tree and lists, with the side bar's row look
    index.css      the only stylesheet: tokens and base rules
    theme.ts       a theme made safe (`cleanLook`) and applied (`applyLook`); agent colors
    preview-bridge.ts  the bridge's stand-in, preview only
  scripts/         build, dev, pack, smoke, preview, test runner, launch-json, leash, update-feed,
                   pine.sh / pine.cmd (the launchers), installer.nsh
  test/            the app from end to end through its real window; support/ (app.ts, window.ts,
                   daemon.ts)
```

## Rules for changing the app

- The page asks for something new through `preload.ts` and a handler in `main.ts` that checks the
  call comes from the app's own page, never by getting more of the system. `src/preview-bridge.ts`
  implements the same `Bridge` type, so a missing method fails `npm run check`; if it needs the
  daemon, `scripts/preview.ts` routes it under `/__pine/`.
- The page is also the mobile app's (`mobile/src/mobile-bridge.ts`) and the web client's
  (`web/src/frame-bridge.ts`), on the same `Bridge` type. Only those two give `local: false` (no
  machine of its own: the page hides This Mac, Use this Mac, Set up pine and the local parts of
  Settings), `mediaBase`, `deviceKey` and `trustHostKey`; only the web client `disconnect`,
  `renameHost` and `openApp`; only the mobile app `pair`, `stopPairing`, `onPairLink`, `nearby` and
  `pairNearby`; only the desktop app browser access, its own update and its browser. `contextMenu`
  (the system's menu) comes from the desktop and mobile apps; elsewhere the page draws it
  (`src/components/page-menu.tsx`). A change of the page is checked in all three: `npm run check`
  in `desktop/`, `mobile/` and `web/`.
- What the daemon can do is added to the control API (`src/http.ts`, `src/owner.ts`) with a test,
  then to `api.ts`. The app never does the daemon's work itself.
- Text from an answer or a tool is drawn through `markdown.tsx` or as plain text, never set as HTML
  elsewhere. `markdown.tsx` replaces three of Streamdown's unsafe defaults: the cleaning rules
  (`CLEAN`), links and pictures. After a Streamdown upgrade, read its defaults again and run the
  desktop suite: its markdown test fails without each of the three.
- A new thing the owner can see or do gets a test in `desktop/test/`.
- A new thing the main process does outside its window goes into `quiet` (tests note it instead of
  doing it).

## How the page is drawn

React, Tailwind v4 (its Vite plugin), shadcn on Base UI. No hand-written stylesheet: utilities in
the components, and `index.css` holds only tokens and base rules. `desktop/DESIGN.md` has the
guidelines.

A button's look says what it does:

| Look | For | Examples |
|---|---|---|
| Filled (primary) | The one action that finishes what you are doing; at most one in view | Submit a dialog, Save changes, Restart to update, Trust this key, Allow |
| Outline | Opens, adds, changes or shows something | New agent, Add server, Sign in, Change…, Rename, Show |
| Ghost | Takes something away or backs out | Remove on a row (it asks first), Sign out, Forget, Discard, back |
| Destructive (red) | The last step of something that cannot be undone | Remove… on an agent's page, the button that confirms a removal |

A button in a list row is a size smaller. A key shown on a filled or red button is a darker shade
of it.

| Piece | What it is for |
|---|---|
| shadcn (`src/components/ui/`) | Every control and overlay |
| shadcn's chat components, composed per AI Elements' patterns | The conversation (`Conversation.tsx`: Message Scroller, Message, Bubble, Attachment, Trace, Code Block, Item, Marker, Hover Card, Progress) and the input (`Composer.tsx`: the Prompt Input pattern). AI Elements' registry is Radix-only and is never added |
| Streamdown | Answers from markdown, code colored by Shiki; `markdown.tsx` draws its parts as stock components |
| lucide | Every icon; the pine logo is `components/logo.tsx` |
| usehooks-ts | `useMediaQuery` for the 1024-pixel breakpoint (`ROOM`) |
| ui-sdk (`@ui-sdk/react`) | Only what shadcn lacks: the file tree and lists of rows (`src/lists.tsx`) |

- Stock shadcn components are never edited: add or update them with `npx shadcn@latest add <name>`
  (`--diff` shows upstream changes). Everything is on Base UI; nothing imports Radix.
- Use the stock component where it is used. The one exception is `Pulse`
  (`src/components/pulse.tsx`), a grey dot that fades in step, in place of Spinner. No wrapper that
  only renames or bundles stock components; `src/components/` holds only compositions stock cannot
  express in place.
- Sizes and spacing are Tailwind's scale and shadcn's defaults. Text is `text-sm` on each part's
  root, small labels `text-xs`, answers, messages and the message box `text-read` with
  `leading-snug` (15px, the one step `index.css` adds; the message box stays 16px in a narrow window
  so iOS does not zoom). The font is the system's (`--font-sans`, `--font-mono`). Room for the
  window's buttons: `pl-window-buttons` (Mac) and `pr-window-controls` (Windows, Linux), from
  `titleBarOverlay` in `electron/main.ts`.
- Every color is one of pine's roles in `index.css` (`--bg`, `--surface`, `--raised`, `--sunk`,
  `--side`, `--hover`, `--press`, `--line`, `--line-soft`, `--text`, `--text-muted`, `--faint`,
  `--brand`, `--warn`, `--warn-soft`, `--bad`, `--info`, `--plan`, `--add`, `--del`, `--select`).
  shadcn's tokens point at them (`--background` `--bg`, `--primary` `--brand`, `--secondary`
  `--raised`, `--muted` `--sunk`, `--accent` `--hover`, `--sidebar-accent` `--press`, `--ring`
  `--faint`), and components use shadcn's tokens. Roles shadcn has no name for have utilities:
  `text-warn`, `bg-warn-soft`, `text-info`, `text-faint`, `border-line-soft`, `text-add`,
  `text-del`. A new color points at a role, never a literal. `index.css`'s values are pmndre's.
- `index.css` holds only what cannot be a `className`: the window buttons' room, the chrome on
  `body`, `::selection`, find highlights, and `-webkit-app-region: no-drag` on Base UI's portals. No
  rule there restyles a stock component. Drag regions are written where they apply
  (`[-webkit-app-region:drag]`). After a change to the frame (`TitleBar`, `Sidebar`, `Gate` in
  `App.tsx`, the side panel's sheet in `CodePanel.tsx`, the window options in `electron/main.ts`),
  look at it in light and dark, and with the side panel open below 1024 pixels: no test shows the
  real title bar.
- A theme: the daemon resolves the file (`src/theme-colors.ts`) into the roles, `--code-*` and
  `--term-*` as `#rrggbb[aa]` (`GET /themes`); the page checks them again (`cleanLook`) and sets them
  on the root, with `.dark` for a dark theme (`applyLook`). A theme is never CSS. The code colors are
  read by the editor and by Shiki's theme for answers (`CODE_THEME` in `markdown.tsx`); the terminal
  reads `--term-*`. The page asks for themes on connect, when Settings > General opens, and on
  `pine/settings`. The main process keeps the last theme (`look`) so the window opens in it and
  Electron's native theme follows its kind.
- An agent's color (`color` in `agent.json`) is its avatar's only: `AgentAvatar`
  (`src/components/agent-avatar.tsx`) draws the initial on it with white or near-black (`onColor`).
  The color popover and the rename field are `src/components/agent-identity.tsx`.
- Tests and the few rules that reach into a component select by `data-slot` and roles, never by
  utility classes. Pine's own elements that need one carry their own `data-slot` (`composer`,
  `code-panel`, `tab`).
- Breakpoints: stock `useIsMobile` (768) for the side bar, `useMediaQuery` (1024, `ROOM` in
  `model.ts`) for the groups and panes, container queries (`@container/settings`) for Settings. A
  new breakpoint uses one of these three.
- In the side bar, each agent's list is a ui-sdk list drawn as stock `SidebarMenu`, each row a stock
  `SidebarMenuButton` drawn as the list's option. Its colors are the `--sidebar*` tokens.

## Loading

What loads and has a known shape shows a stock shadcn `Skeleton` of that shape
(`data-slot=skeleton`), never edited. `Pulse` stays for what is at work and for what has no known
shape yet (the Gate before a host connects).

- A composition in `src/components/` (and in a view's own file) takes `skeleton?: boolean` and then
  draws its own shape from `Skeleton` blocks (`SidebarMenuSkeleton` for a side bar row) and reads no
  data. Callers write `<AgentAvatar skeleton />`. Never on `components/ui/`.
- A view that loads its own data (Browser, Terminal, BrowserAccess, the view's frame, the
  conversation) exports `<View>Skeleton` (`BrowserSkeleton`, `ViewFrameSkeleton`,
  `ConversationSkeleton`).
- A skeleton shows on the first load only, while `useLoad` has neither data nor error; a reload
  keeps what is shown. Empty is shown only once the data is there.
- Each skeleton is a story beside its part (`<Name>Skeleton`); a dialog loading inside its frame
  names that state `<Name>Loading` (`PickDialogLoading`, `PaletteLoading`).
- The app test that forbids an endless animation while agents work lets `[data-slot=skeleton]`
  through, and only it.

## Stories

A story sits beside what it shows: `src/<File>.stories.tsx`, `src/components/<name>.stories.tsx`
(titled `Components/<Name>`). One story per part and state, named after it (`PickDialogRemoving`).
Stock shadcn components have no stories. None needs Electron or a daemon: the bridge in
`.storybook/preview.tsx` does nothing. Add or update a story when you change a part in
`src/components/` (outside `ui/`).

| Command (in `desktop/`) | What it does |
|---|---|
| `npm run storybook` | Storybook at http://localhost:6006 |
| `npm run build-storybook` | The stories built into `storybook-static/` |

Storybook is for looking, not a test, and nothing publishes it. Its toolbar draws a story in any of
pine's themes (`.storybook/themes.ts`) and at 360 and 1280 pixels (`.storybook/modes.ts`), so no
dark or phone twin is written.

## Tests

`npm test` in `desktop/` (`scripts/test.mjs`) builds the app once into a temp folder of the run's
own and starts the real app from it on a pine home of its own with the scripted model, drawn and
never shown (`PINE_DESKTOP_HEADLESS`; `PINE_DESKTOP_SHOW=1` shows it). Files run side by side (one
per two idle processors, two to six), two minutes at most a test; a file that failed is run again
alone. A file run alone with `node --test` builds for itself. `command.test.ts`, `updates.test.ts`,
`daemon.test.ts`, `preview.test.ts` and `fds.test.ts` need no window; `setup.test.ts` starts the
app on a stand-in pine without a home. With `PINE_LIVE=1` on a Mac it also dictates with the real
voice helper from a recording. The repository's `AGENTS.md`, "Tests", has the rest.
