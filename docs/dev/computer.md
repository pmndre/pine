# App control: the helpers

For contributors. What an owner or an agent needs is in
[references/computer.md](../references/computer.md).

`mcp/computer.ts` is the MCP server: it decides which app a call may act in (a reference belongs
to the named app, a position lies in one of its windows, never the app pine runs in nor the Pine
app: `answersHere`), maps picture positions to the screen and words every answer. Who gets the
server and which app a call is about is `src/computer.ts` (`computerSession`, `appTarget`),
shared with the gate in `src/agents.ts` and `classify()` in `src/actions.ts`. Node cannot reach
the accessibility APIs or make input events, so a helper per system does that and decides
nothing. All three speak the same line protocol, so the checks in `computer.ts` are the same on
every system; the tests drive the server with a stand-in that speaks it (`FAKE_HELPER` in
`test/computer.test.ts`).

| System | Helper | What it uses |
|---|---|---|
| macOS | `mcp/computer.swift` | The accessibility API, CGEvent for mouse and keys (sent to the app's process), window pictures. Built with `swiftc` on first use into `data/computer/` of pine's home; the Pine app carries it built (`src/prebuilt.ts`) |
| Windows | `mcp/computer.cs` | UI Automation for the outline, `SendInput` for mouse and keys, `PrintWindow` for pictures (a window it draws black is taken from the screen after the app came to the front). Built with the `csc.exe` every Windows carries (C# 5, `src/csharp.ts`). Store apps are drawn in `ApplicationFrameHost`'s frame and counted as the app's; elevated processes are detected and refused; `app_open` resolves names through `App Paths`, Windows' own programs and Start menu entries |
| Linux (X11) | `mcp/computer-linux.py` | The system's `python3` with `pyatspi` (AT-SPI) and `python-xlib`; `/usr/bin/xdotool` for mouse and keys, ImageMagick's `/usr/bin/import` for pictures. The app pine runs in is the first process above pine with a window, or the window `WINDOWID` names |

Windows and Linux cannot send keys to a process: there the helper checks right before each key
that the named app is in front, and before each click that the window under the point is that
app's, and stops otherwise. `hasDesktop()` in `src/computer.ts` says where the server is
registered at all (macOS, Windows, Linux with `DISPLAY` and not Wayland).

The `live:` tests build the real helper and drive its own demo window (`--demo`), which needs no
grant; the tests that operate TextEdit skip themselves without the Accessibility and Screen
Recording grants.

The app pine runs in, where it never acts: on a Mac the Pine app or the terminal app the daemon
was started from; on Windows the console window it was started from or the terminal app above it;
on Linux the first process above pine with a window, or the window `WINDOWID` names. Windows'
menus show their entries only while open, so `app_menu` opens them on the screen; pictures there
come from `PrintWindow`, and a window it cannot draw is photographed from the screen.
