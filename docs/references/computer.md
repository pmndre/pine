# Operating apps on the computer

The bundled MCP server `computer` lets an agent use the apps on the computer pine runs on as a
person does: open an app, read a window, press a button, fill in a field, pick from a menu,
click, type. For what has no command line or web page: a note in Notes, a setting, a document in
TextEdit, an app you built.

It works on macOS, Windows, and Linux with X11. Under Wayland or without a screen the tools are
not there; `pine check` says so on the agent's `apps` line. `pine init` writes the entry
`"computer": { "pine": "computer" }` into `pine.json`; remove it or set `"enabled": false` to
take app control away.

## Who has it

| Who | App control |
|---|---|
| The main agent, or any agent in `auto` or `bypass` mode, in a conversation with you | Yes, asked once per app |
| An agent in `safe` or `manual` mode (every agent but the main one, unless configured otherwise) | No: it acts with your whole account, which a sandboxed agent does not have |
| A run started from outside (a mail, a webhook, somebody else's message) | Never |
| Sub-agents of a conversation that has it | Yes, with `subagents.mcp` on (the default); they use the conversation's answers |

`request_access` does not give it. Put the agent in `auto` mode instead (`/mode auto`, or `mode` in
its `agent.json`; [security.md](security.md), "The whole account").

## Two ways to work

**By outline** (any model). `app_snapshot` returns a window as text from the accessibility tree:

```
TextEdit, window 1 "Untitled".
Controls with [ref=...] can be used: app_press presses one, app_set_text writes into a text field.

- close button [ref=e4]
- toolbar
  - button "Bold" [ref=e7]
  - pop-up button "Font" [ref=e8]: "Helvetica"
- text area [ref=e2] (focused): "Dear Ada"
```

A reference stays while its control exists; take a new snapshot after something changed.

**By picture** (a model that can see). `app_screenshot` returns a picture and its size;
`app_click`, `app_drag` and `app_scroll` take `x`, `y` in pixels of that picture, and pine maps
them to the screen wherever the window is now. A window's picture shows it also while covered;
when the app has a menu or sheet open, the app comes to the front and the picture holds that too.

Use the outline wherever it works; take a picture for drawings, maps, custom views, apps that
describe their windows poorly, or to check how something looks.

## The tools

Named `mcp__computer__apps`, `mcp__computer__app_open` and so on. Every tool but `apps` takes
`app`: the name as `apps` lists it, in any case (`TextEdit`); also a bundle id
(`com.apple.TextEdit`), on Windows the program (`notepad`), on Linux the program or window class
(`gedit`).

| Tool | What it does |
|---|---|
| `apps` | The running apps and their windows, front first, and the screens. Not asked about |
| `app_open` | Opens an app by name (not a path), or brings it to the front |
| `app_snapshot` | A window as an outline with references. `window`: number or part of the title; default the front one. Cut at 24,000 characters |
| `app_press` | Presses control `ref`: a button, checkbox, link, tab; selects a list row |
| `app_set_text` | Makes text field `ref` hold `text`. A search or address field then needs `app_key` `return` |
| `app_menu` | Picks from the menu bar: `path` like `File > Save`. Without `path` lists the menus; with a menu's name, its entries |
| `app_screenshot` | A picture of an app's window (`app`, `window`), or of the whole screen without `app` (`screen`: which one) |
| `app_click` | Clicks at `x`, `y` in the last picture. `count`: 2 or 3; `button`: `"right"` |
| `app_drag` | From `x`, `y` to `to_x`, `to_y` in the last picture |
| `app_scroll` | Scroll wheel over `x`, `y`. `direction`: `up`, `down`, `left`, `right`; `amount`: lines, default 5 |
| `app_type` | Types `text` where the cursor is; a line break presses return. The app may autocorrect; `app_set_text` writes exactly |
| `app_key` | Presses `keys`: `return`, `tab`, `escape`, `space`, `delete`, arrows, `home`, `end`, `pageup`, `pagedown`, `f1`-`f12`, a character, with `cmd`, `ctrl`, `alt`, `shift`, `fn` (`cmd+shift+z`); several separated by spaces. On Windows and Linux `cmd` means `ctrl` and `fn` is refused |

Calls run one after another. You see the app come to the front and the pointer move, and can take
over at any time.

## What the owner is asked

- **Once per app, per conversation**: the first call naming an app ("operate the app TextEdit").
  A yes holds for the conversation and its sub-agents until reset or restart. **"Always here"**
  covers every app in the conversation. **The whole screen** (`app_screenshot` without `app`) is
  asked once per conversation. `apps` is not asked.
- A **no** blocks the call; the agent tries no other way.
- Bypass mode asks nothing; manual mode asks each action but not looking; plan mode only looks
  (after the yes per app). `"approve": "always"` on the server asks every call.

A window's content is outside content: the conversation is marked as after the browser
([security.md](security.md), "4. Taint and approvals"). An action lands in the named app or
nowhere: a reference must belong to it, a position must lie in its window, keys go to it alone.
pine never clicks, types or presses in the app it runs in (the Pine app, or the terminal it was
started from), nor in the Pine app; it may look at them. There is no list of forbidden apps: a yes
for a terminal or the Finder reaches everything you reach.

## Windows

Nothing has to be allowed in the system's settings.

- Input goes to the window in front: pine brings the app forward and checks again before every
  key and click; if another window came in front or lies under the click, it stops.
- An app running as administrator cannot be operated: start pine as administrator, or do it by hand.
- `app_menu` opens a menu on the screen to read it; `app_key` `escape` closes it. A menu hanging
  out of a window is only in a picture of the whole screen.
- `app_open` takes a registered program (`excel`), one of Windows' own (`notepad`), or a Start
  menu entry (`Visual Studio Code`).
- pine in WSL has no app control of Windows' apps.

## Linux

Needs an X11 session (Ubuntu: "Ubuntu on Xorg" at the login screen) and, as the tool's answer
says when they are missing:

```bash
sudo apt install python3-pyatspi python3-xlib xdotool imagemagick
```

- Input goes to the window in front, checked as on Windows; pictures are taken from the screen,
  with the window brought to the front.
- An app has to describe itself (GTK, Qt, Firefox, LibreOffice do). Some only with the
  accessibility service on: `gsettings set org.gnome.desktop.interface toolkit-accessibility
  true`, then log out and in.
- Many GNOME apps have no menu bar: `app_menu` lists nothing; the menu button is in the outline.

## What macOS has to be told, once

The app pine runs in (the Pine app, or the terminal the daemon was started from) needs two grants:

| Grant | Needed for | Where |
|---|---|---|
| Accessibility | Everything but `apps` and `app_open` | System Settings > Privacy & Security > Accessibility |
| Screen Recording | `app_screenshot` | System Settings > Privacy & Security > Screen & System Audio Recording (older: Screen Recording). Then quit and reopen that app, and start pine again |

A missing grant is named in the tool's answer, and macOS shows its own window to the switch.

## The helper, and what it needs

A small helper per system does the reading and input. On a Mac pine builds it with `swiftc` on
first use (about half a minute; meanwhile "try again in a moment"); the Pine app carries it built.
Without Apple's command line developer tools the answer says to run:

```bash
xcode-select --install
```

## Options

| Option | Default | Meaning |
|---|---|---|
| `images` | `true` | `false`: no picture tools (`app_screenshot`, `app_click`, `app_drag`, `app_scroll`), for a model that cannot see |
| `imageSize` | `1280` | Longer side of a picture in pixels (at most about 1.15 million pixels) |
| `block` | none | Tools to leave out: `["app_type", "app_key"]` |

`description`, `enabled`, `agents`, `approve` and `timeout` work as for every MCP server
([mcp.md](mcp.md)).

## When something does not work

| What the agent is told | What it means |
|---|---|
| "macOS does not let pine operate apps yet" | Accessibility grant missing |
| "macOS does not let pine take pictures of the screen yet" | Screen Recording grant missing |
| "App control needs Apple's command line developer tools" | `xcode-select --install` |
| "pine is building the helper for app control" | First use; try again in a moment |
| "Another window came to the front ..." | Windows, Linux: someone else is using the screen |
| "That app runs as administrator" | Windows: pine cannot act there |
| "App control on Linux needs a few programs" | Install what it names |
| "does not describe its windows" | No accessibility support, or started before the service: use pictures, or restart the app |
| "this Linux desktop runs Wayland" | X11 only |
| "That reference does not exist any more" | Take a new `app_snapshot` |
| "At that position is ..., not ..." | Another app is there: new `app_screenshot`, or name that app |
| "... is the app pine itself runs in", "... is the Pine app" | pine does not act where you answer its questions |
| "... could not be brought to the front" | A system dialog or full-screen app holds the screen |
| "not approved" | You said no to that app here |
| "Not done: you are in plan mode" | Plan mode only looks |
| "Operating apps uses your owner's whole account, which this conversation does not have" | `safe` or `manual` mode; switch to `auto` |
| The tools are not in the list | `safe` or `manual` mode, a run from outside, no usable desktop, or no server entry |

An app that draws its own window (some games) describes little: use pictures. Apps built on a
browser (Slack, Visual Studio Code) describe more from the second snapshot on.
