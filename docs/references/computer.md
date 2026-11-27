# Operating apps on the computer

The bundled MCP server `computer` lets an agent use the apps on the computer pine runs on as a
person does: read a window, press a button, fill in a field, pick from a menu, click and type. It
is for what has no command line or web page: a note in Notes, a setting, an app you built.

It works on macOS, Windows, and Linux with X11. Under Wayland or without a screen the tools are
missing (`pine check` says so on the agent's `apps` line). `pine init` writes the entry
`"computer": { "pine": "computer" }` into `pine.json`; remove it or set `"enabled": false` to turn
app control off.

## Who has it

App control acts with your whole account, so only an agent in `auto` or `bypass` mode has it (the
main agent by default), in a conversation with you, asked once per app. Its sub-agents have it too,
with `subagents.mcp` on (the default), under the conversation's answers. An agent in `safe` or
`manual` mode never has it, nor does a run started from outside (a mail, a webhook, somebody
else's message). `request_access` does not give it: put the agent in `auto` mode (`/mode auto`, or
`mode` in its `agent.json`; [security.md](security.md), "The whole account").

## Two ways to work

With any model, `app_snapshot` returns a window as a text outline from the accessibility tree:

```
TextEdit, window 1 "Untitled".
- button "Bold" [ref=e7]
- text area [ref=e2] (focused): "Dear Ada"
```

A reference stays valid while its control exists; take a new snapshot after a change.

With a model that can see, `app_screenshot` returns a picture, and `app_click`, `app_drag` and
`app_scroll` take `x`, `y` in its pixels, wherever the window is now. A covered window is pictured
too; an open menu or sheet brings the app to the front.

Use the outline where it works. Use pictures for drawings, maps, custom views, apps that describe
themselves poorly (some games draw their own window), or to check how something looks. Apps built
on a browser (Slack, Visual Studio Code) describe more from the second snapshot on.

## The tools

Named `mcp__computer__apps`, `mcp__computer__app_open` and so on. Every tool but `apps` takes
`app`: the name as `apps` lists it, in any case (`TextEdit`), a bundle id (`com.apple.TextEdit`),
or on Windows and Linux the program or window class (`notepad`, `gedit`).

| Tool | What it does |
|---|---|
| `apps` | Running apps and their windows, front first, and the screens. Not asked about |
| `app_open` | Opens an app by name (not a path), or brings it to the front |
| `app_snapshot` | A window as an outline (`window`: number or part of the title). Cut at 24,000 characters |
| `app_press` | Presses control `ref` (button, checkbox, link, tab, list row) |
| `app_set_text` | Makes text field `ref` hold `text`. A search field then needs `app_key` `return` |
| `app_menu` | Picks `path` like `File > Save`. Without `path`: the menus; with a menu's name: its entries |
| `app_screenshot` | A picture of a window (`app`, `window`), or without `app` of the screen (`screen`) |
| `app_click` | Clicks at `x`, `y` in the last picture. `count`: 2 or 3; `button`: `"right"` |
| `app_drag` | From `x`, `y` to `to_x`, `to_y` |
| `app_scroll` | At `x`, `y`; `direction` `up`, `down`, `left`, `right`; `amount` in lines, default 5 |
| `app_type` | Types `text` at the cursor; a line break presses return. The app may autocorrect; `app_set_text` writes exactly |
| `app_key` | Presses `keys`: `return`, `tab`, `escape`, `space`, `delete`, arrows, `home`, `end`, `pageup`, `pagedown`, `f1`-`f12`, a character, with `cmd`, `ctrl`, `alt`, `shift`, `fn` (`cmd+shift+z`); several separated by spaces. On Windows and Linux `cmd` is `ctrl` and `fn` is refused |

Calls run one at a time, in view; you can take over at any time.

## What the owner is asked

- Once per app and conversation, at the first call that names it. A yes holds for the conversation
  and its sub-agents until a reset or restart; "Always here" covers every app. After a no the agent
  tries no other way.
- The whole screen (`app_screenshot` without `app`): once per conversation. `apps`: never.
- Bypass mode asks nothing; manual mode asks each action, not looking; plan mode only looks.
  `"approve": "always"` asks at every call.

A window's content is outside content and marks the conversation ([security.md](security.md), "4.
Taint and approvals"). An action lands in the named app or nowhere: a reference must belong to it,
a position must lie in its window, keys go to it alone. pine only looks at the app it runs in (the
terminal it started from) and at the Pine app, where you answer its questions. There is no list of
forbidden apps: a yes for a terminal or the Finder reaches everything you reach.

## Options

| Option | Default | Meaning |
|---|---|---|
| `images` | `true` | `false`: no picture tools (`app_screenshot`, `app_click`, `app_drag`, `app_scroll`) |
| `imageSize` | `1280` | Longer side of a picture in pixels (at most about 1.15 million pixels) |
| `block` | none | Tools to leave out: `["app_type", "app_key"]` |

`description`, `enabled`, `agents`, `approve` and `timeout` work as for every MCP server
([mcp.md](mcp.md)).

## What macOS has to be told, once

The app pine runs in (the Pine app, or the daemon's terminal) needs two permissions, under System
Settings > Privacy & Security. The tool's answer names one that is missing.

| Grant | Needed for | Where |
|---|---|---|
| Accessibility | All but `apps` and `app_open` | Accessibility |
| Screen Recording | `app_screenshot` | Screen & System Audio Recording (or Screen Recording). Then reopen that app and restart pine |

## The helper, and what it needs

A small helper reads windows and sends input. On a Mac pine builds it with `swiftc` on first use
(half a minute; meanwhile "try again in a moment"); the Pine app carries it built. Without Apple's
command line developer tools, run `xcode-select --install`.

## Windows

No system setting is needed. Input goes to the window in front: pine brings the app forward and
checks again before every key and click, and stops if another window took its place. An app running
as administrator is out of reach (start pine as administrator). `app_menu` opens a menu to read it
(`app_key` `escape` closes it); a menu outside a window shows only in a screenshot of the whole
screen. `app_open` takes a program (`excel`, `notepad`) or a Start menu entry. pine in WSL has no
app control of Windows' apps.

## Linux

It needs an X11 session (Ubuntu: "Ubuntu on Xorg" at login) and these programs (the tool's answer
names missing ones):

```bash
sudo apt install python3-pyatspi python3-xlib xdotool imagemagick
```

Input and pictures work as on Windows, with the window brought to the front. An app has to describe
itself (GTK, Qt, Firefox, LibreOffice do); some only with the accessibility service on
(`gsettings set org.gnome.desktop.interface toolkit-accessibility true`, then log in again). Many
GNOME apps have no menu bar, so `app_menu` lists nothing; the menu button is in the outline.

## When something does not work

| What the agent is told | What it means |
|---|---|
| "macOS does not let pine operate apps yet" | Accessibility permission missing |
| "macOS does not let pine take pictures of the screen yet" | Screen Recording permission missing |
| "App control needs Apple's command line developer tools" | `xcode-select --install` |
| "pine is building the helper for app control" | First use; try again shortly |
| "Another window came to the front ..." | Windows, Linux: someone else uses the screen |
| "does not describe its windows" | No accessibility support, or started before the service: use pictures, or restart the app |
| "At that position is ..., not ..." | Another app is there: new `app_screenshot`, or name that app |
| "... is the app pine itself runs in", "... is the Pine app" | pine does not act where you answer its questions |
| "... could not be brought to the front" | A system dialog or full-screen app holds the screen |
| "Operating apps uses your owner's whole account, which this conversation does not have" | `safe` or `manual` mode; switch to `auto` |
| The tools are not in the list | `safe` or `manual` mode, a run from outside, no usable desktop (Wayland), or no server entry |
