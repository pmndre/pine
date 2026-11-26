# App control: operating the apps on the computer

The bundled MCP server `computer` lets an agent use the apps on the computer pine runs on as a
person at the screen does: open an app, read a window, press a button, fill in a field, pick from
a menu, click, type. It is for what has no command line and no web page: a note in Notes, a
setting in an app, a document in TextEdit, an app you built and want tried out.

It works on macOS, on Windows, and on Linux with an X11 desktop. Under Wayland, and where pine
runs without a screen (a server, a daemon started outside the desktop session), the tools are not
there; `pine check` says so on the agent's `apps` line.

```json
"computer": { "pine": "computer" }
```

`pine init` writes this entry into `pine.json`. To take app control away, remove it or set
`"enabled": false`.

## Who has it

| Who | App control |
|---|---|
| The main agent, in a conversation with you | Yes. You are asked once per app |
| Another agent in `auto` or `bypass` mode, in a conversation with you | Yes, the same way |
| An agent in `safe` or `manual` mode (every agent but the main one, unless configured otherwise) | No. Operating apps acts with your whole account, which an agent in its sandbox does not have |
| A run started by an event from outside (a mail, a webhook, a message from somebody else) | Never, whatever its `untrusted` profile lists |
| Sub-agents of a conversation that has it | Yes, when the agent's `subagents.mcp` is on (the default); they use the conversation's answers and ask for no app themselves |

An agent without the tools cannot get them by asking (`request_access` does not give app
control). You give it by putting the agent in `auto` mode (`/mode auto`, or `mode` in its
`agent.json`; [security.md](security.md), "The whole account").

## Two ways to work

**By outline** (any model). `app_snapshot` returns a window as indented text from the
accessibility tree, the description apps keep of their windows for screen readers:

```
TextEdit, window 1 "Untitled".
Controls with [ref=...] can be used: app_press presses one, app_set_text writes into a text field.

- close button [ref=e4]
- toolbar
  - button "Bold" [ref=e7]
  - pop-up button "Font" [ref=e8]: "Helvetica"
- text area [ref=e2] (focused): "Dear Ada"
```

A control that can be used has a reference, kept from one snapshot to the next for as long as it
exists. `app_press` presses one, `app_set_text` writes into a text field, `app_menu` picks from
the menu bar by name. After something changed (a dialog opened, another view), take a new
snapshot.

**By picture** (a model that can see). `app_screenshot` returns a picture of a window, or of the
whole screen, with its size. `app_click`, `app_drag` and `app_scroll` take positions in that
picture (`x`, `y`: pixels from its top left corner); pine maps them to the screen, whatever the
resolution, wherever the window is, also on a second display, and also after the window moved.

A picture of a window shows that window alone, also while another app covers it, and does not
bring the app to the front. When the app has something open over the window (a menu, a sheet, a
bubble), the app is brought to the front and the picture holds that too ("and what is open over
it"); what lies beside the app on the screen is left grey.

**For both.** `app_type` types where the cursor is, `app_key` presses a key or shortcut,
`app_open` starts an app or brings it to the front, `apps` lists what runs.

Use the outline wherever it works: it is exact, small and needs no eyes. Take a picture when the
outline does not show what matters (a drawing, a map, a custom view, an app that describes its
window poorly), or to check how something looks.

## The tools

They appear as `mcp__computer__apps`, `mcp__computer__app_open` and so on. Every tool but `apps`
takes `app`: the name as `apps` lists it (`TextEdit`), in any case; a bundle id
(`com.apple.TextEdit`) works too, on Windows the program's name (`notepad`, `notepad.exe`), on
Linux the program or its window class (`gedit`).

| Tool | What it does |
|---|---|
| `apps` | Lists the running apps and their windows, the one in front first, and the screens when there are several. Not asked about |
| `app_open` | Opens an app by name, or brings it to the front; a window put away into the Dock comes back. A name, not a path |
| `app_snapshot` | Reads a window as an outline with references. `window`: its number or a part of its title when the app has several; else the front one. Cut at 24,000 characters; tables show their visible rows |
| `app_press` | Presses the control `ref`: a button, a checkbox, a link, a tab; a row of a list is selected. A control with nothing to press by name is clicked in its middle |
| `app_set_text` | Makes the text field `ref` hold `text`, replacing what was in it. A search or address field acts only on return: `app_key` with `return` afterwards |
| `app_menu` | Brings the app to the front and picks from its menu bar: `path` is the menu names from the top, separated by ` > ` (`File > Save`, `Format > Font > Bold`). Without `path` it lists the menus; with a menu's name, what is in it, with shortcuts |
| `app_screenshot` | A picture of an app's window (`app`, and `window` as for `app_snapshot`), or of the whole screen without `app` (`screen`: which one). The answer gives the size in pixels. An open menu or sheet of the app is in it; other apps are not |
| `app_click` | Clicks at `x`, `y` in the last picture. `count`: 2 for a double click, 3 for a triple one. `button`: `"right"` for the context menu |
| `app_drag` | Presses at `x`, `y` in the last picture, moves to `to_x`, `to_y` and lets go |
| `app_scroll` | Turns the scroll wheel over `x`, `y` in the last picture. `direction`: `up`, `down`, `left`, `right`. `amount`: lines, 5 unless given |
| `app_type` | Types `text` into the app where its cursor is. A line break presses return, which in a chat app sends the message. The app may capitalize or correct as it does for a person; `app_set_text` writes exactly |
| `app_key` | Presses `keys`: `return`, `tab`, `escape`, `space`, `delete`, `up`, `down`, `left`, `right`, `home`, `end`, `pageup`, `pagedown`, `f1` to `f12`, a single character, or these with `cmd`, `ctrl`, `alt`, `shift`, `fn` in front (`cmd+s`, `cmd+shift+z`). Several, separated by spaces, are pressed in order. The keyboard layout is respected. On Windows and Linux `cmd` means `ctrl`, `fn` is refused, and the Windows key is never pressed |

Calls run one after another: there is one mouse and one keyboard. While an agent works in an app,
the app is in front on your screen and the pointer moves; you see it all and can take over.

## What the owner is asked

App control acts as you, so you say where.

- **Once per app, per conversation.** The first call that names an app, whether it looks or acts,
  is put to you: "operate the app TextEdit". A yes holds for that app in that conversation and its
  sub-agents until the conversation is reset or the daemon restarts.
- **"Always here"** in the dialog stops the question for every app in that conversation.
- **The whole screen** (`app_screenshot` without `app`) is asked about once per conversation: such
  a picture shows every open app.
- **`apps`** is not asked about.
- A **no** blocks the call. The agent says what it wanted and does not try another way.
- In **bypass** mode nothing is asked. In **manual** mode every action waits for your go-ahead;
  looking (`apps`, `app_snapshot`, `app_screenshot`) does not, once the app was allowed. In
  **plan** mode the agent only looks, after the same yes per app; every other tool (`app_menu`
  also when it would only list) is refused.
- To be asked about every call, set `"approve": "always"` on the server ([mcp.md](mcp.md)).

What a window shows was written by whoever wrote the mail, page or document in it: it is outside
content, and a conversation that used app control is marked like one that used the browser
([security.md](security.md), "Taint and approvals").

The action lands in the named app or nowhere: a reference has to belong to that app, a position
has to lie in one of its windows (otherwise the answer says which app is there), and keys go to
that app alone, after it was brought to the front.

pine does not click, type or press in **the app pine itself runs in** (the Pine app when it
started pine, else the terminal app the daemon was started from), nor in **the Pine app** wherever
it runs: that is where you answer pine's questions. Looking at them is allowed; `apps` marks them
"pine runs in it" and "the Pine app".

There is no list of forbidden apps. An app that can run commands or show files (a terminal, the
Finder, an editor) reaches everything you reach, including what the sandbox keeps from the
agent's shell. The yes for such an app is your decision.

## Windows

Nothing has to be allowed in the system's settings.

- **Keys and clicks go to the window in front.** pine brings the app to the front first, refuses
  when it does not get there, and looks again before each piece of text, each key and each click:
  when another window has come to the front, or lies under a click, it stops ("Another window
  came to the front") and nothing more is typed.
- **An app that runs as administrator** cannot be clicked or typed in by a program without those
  rights. Start pine as administrator, or do that step by hand.
- **Menus** show what is in them only while open: looking into one with `app_menu` opens it on
  the screen; `app_key` with `escape` closes it.
- **Pictures** of a window show it also while covered. A menu that hangs out of the window is not
  in the window's picture: take one of the whole screen.
- **Store apps** (Calculator, Photos) are drawn inside a frame of Windows'; pine counts the
  window as the app's.
- `app_open` takes a name: a program registered with Windows (`excel`), one of Windows' own
  (`notepad`, `mspaint`), or a Start menu entry (`Visual Studio Code`).
- The app pine runs in is the console window it was started from, or the terminal app above it.

pine in WSL has no app control of Windows' apps.

## Linux

App control needs an X11 desktop: on Ubuntu the session "Ubuntu on Xorg", chosen at the login
screen. Under Wayland a program may neither see other apps' windows nor send them keys, so the
tools are not offered and the agent is told why.

It needs `python3` with AT-SPI (the accessibility service of GNOME, KDE and others), `xdotool`
and ImageMagick. What is missing, the tool's answer names; on Ubuntu and Debian:

```bash
sudo apt install python3-pyatspi python3-xlib xdotool imagemagick
```

- **Keys and clicks go to the window in front**, with the same look before each piece of input
  as on Windows.
- **An app has to describe itself.** GTK (GNOME), Qt (KDE), Firefox and LibreOffice do. Some only
  when the accessibility service is on, once: `gsettings set org.gnome.desktop.interface
  toolkit-accessibility true`, then log out and in. An app that describes nothing is answered with
  "does not describe its windows": use pictures.
- **Pictures** are taken from the screen, so pine brings the window to the front first.
- Many GNOME apps have no menu bar (their menu is a button in the window): `app_menu` lists
  nothing, and the menu button is in the outline.
- The app pine runs in is the terminal it was started from.

## What macOS has to be told, once

macOS lets a program operate other apps only when you allowed it. What asks is the app pine runs
in: the Pine app when it started pine, else the terminal app the daemon was started from
(Terminal, iTerm, Ghostty, an editor's terminal).

| Grant | Needed for | Where |
|---|---|---|
| Accessibility | Everything but `apps` and `app_open` | System Settings > Privacy & Security > Accessibility: switch on the app pine runs in |
| Screen Recording | `app_screenshot` | System Settings > Privacy & Security > Screen & System Audio Recording (older systems: Screen Recording): switch on the app pine runs in. macOS then wants that app quit and opened again, so pine has to be started again too |

When a grant is missing, the tool's answer says which and where, and macOS opens its own window
that leads to the switch. The agent tells you and tries again when you say it is done. Without
Screen Recording, everything that works by reference still works.

## The helper, and what it needs

A small helper program does the reading, clicking and typing, one for each system; pine decides
everything else, the same way on every system. On a Mac pine builds it from source the first
time app control is used, with Apple's `swiftc` (up to half a minute, once, and again after an
update that changes it); a call meanwhile is answered "try again in a moment". The Pine app
carries the helper built. The compiler comes with Apple's command line developer tools, which a
Mac with `git` has already. Where they are missing, the tool's answer says so:

```bash
xcode-select --install
```

On Windows the helper is built with the C# compiler every Windows has; on Linux it runs on the
system's `python3`.

## Options

Under `options` of the server's entry.

| Option | Default | Meaning |
|---|---|---|
| `images` | `true` | `false`: for a model that cannot see pictures. `app_screenshot`, `app_click`, `app_drag` and `app_scroll` are left out, which leaves eight tools that work by outline |
| `imageSize` | `1280` | The longer side of a picture in pixels (and about 1.15 million pixels at most). Positions are mapped back whatever the size |
| `block` | none | Tools to leave out, by name: `["app_type", "app_key"]` |

`description`, `enabled`, `agents`, `approve` and `timeout` work as for every MCP server
([mcp.md](mcp.md)).

## When something does not work

| What the agent is told | What it means |
|---|---|
| "macOS does not let pine operate apps yet" | The Accessibility grant is missing |
| "macOS does not let pine take pictures of the screen yet" | The Screen Recording grant is missing |
| "App control needs Apple's command line developer tools" | `xcode-select --install` |
| "pine is building the helper for app control" | The first use; try again in a moment |
| "Another window came to the front ..." | Windows and Linux: the app was no longer in front, or another window lay under the click. Somebody may be using the computer |
| "That app runs as administrator" | Windows: pine cannot act in an app with more rights than its own |
| "App control on Linux needs a few programs" | Install what the answer names |
| "does not describe its windows" | No accessibility support, or the app started before the accessibility service: use pictures, or start it again |
| "this Linux desktop runs Wayland" | App control works with X11 only |
| "That reference does not exist any more" | The window changed: take a new `app_snapshot` |
| "At that position is ..., not ..." | Another app's window is where the click would land: take a new `app_screenshot`, or name that app |
| "... is the app pine itself runs in", "... is the Pine app" | pine does not act where its own questions are answered |
| "... could not be brought to the front" | Something holds the screen: a system dialog, an app in full screen |
| "not approved" | You said no to that app in this conversation |
| "Not done: you are in plan mode" | The agent may look at apps and acts in none. Switch the mode when the plan is to be carried out |
| "Operating apps uses your owner's whole account, which this conversation does not have" | The agent is in `safe` or `manual` mode; switch it to `auto` |
| The tools are not in the agent's list | `safe` or `manual` mode, a run started from outside, no desktop pine can reach (Wayland, no screen), or the server is not configured |

An app that draws its window itself (some games, some cross-platform apps) describes little of
it: the outline is short or empty; use pictures. Apps built on a browser (Slack, Visual Studio
Code) describe their windows once asked, which pine does; the first snapshot can be thinner than
the second.
