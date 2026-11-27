# Technology

What pine runs on, which system programs it uses, and what is not verified yet. How pine is built on
pi, for contributors: [docs/dev/stack.md](../dev/stack.md).

## What pine is made of

pine is a daemon on Node 24 or later, built on the pi coding agent
(`@earendil-works/pi-coding-agent`), which runs each conversation: model calls, tools, compaction,
retries, MCP. pine keeps its own data (events, tasks, shared state, outside-content marks, goals,
what `/undo` can take back) in one SQLite file, `data/pine.db`.

## System programs

| Program | What for | Without it |
|---|---|---|
| `sandbox-exec` (macOS), `bwrap` (Linux) | The sandbox of `safe` and `manual` mode and of runs started from outside ([security.md](security.md), "3. The sandbox") | No `safe` mode. `pine init` installs bubblewrap on Linux |
| `git` | The code pane's changes, worktrees, `/undo` ([coding.md](coding.md)) | Those features are missing |
| Chromium, through `@playwright/mcp` | The bundled browser and the `http` source's `render` | `pine init` downloads it. Web search and page reading work without |
| `swiftc` | pine's helpers on macOS (app control, dictation, the `system` source), compiled on first use ([computer.md](computer.md)) | Install the command line developer tools (`xcode-select --install`). The Pine app carries the helpers built |
| `sips`, `ffmpeg` | Pictures and video in the terminal UI: `sips` on macOS, `ffmpeg` for video and on Linux | Only png pictures, no video frames |
| `ffmpeg`, `afconvert` | The bars beside a sound in the terminal UI. Wav is read as it is; mp3, m4a, ogg and flac are decoded by `ffmpeg`, or on macOS `afconvert` | Only wav files have bars (on Linux without `ffmpeg`). The Pine app decodes sound itself |
| `osascript` (macOS); `ffplay`, `mpv`, `pw-play`, `paplay`, `aplay` (Linux, the first one installed) | Playing a sound in the terminal UI | No sound there |
| `claude -p` | Optional development model: `pine dev-model`, and a home whose model is `dev/...` | Not needed otherwise |

## Not verified yet

- A real llama-server: whether it accepts `store` and `max_completion_tokens` (`pine model add`
  turns both off with `compat`), two user messages in a row after an aborted run, how its chat
  template renders tool calls.
- How reliably a 2 to 3 bit quantised local model calls tools, delegates and resists text that tells
  it what to do.
- Hosted providers: no automatic test reaches them. Their sign-in flows (`pine login`) are tried by
  hand.
- Throughput: `limits.maxConcurrentRuns` against a llama-server's slots, and sub-agents when slots
  are scarce.
- Weeks of uptime: database and session file growth, MCP servers that die and reconnect.
- Linux beyond Ubuntu 24.04 (x64 and arm64, with the sandbox `pine init` sets up): `pine init` with
  dnf, yum, pacman, zypper or apk, Podman, and the terminal UI in a real Linux terminal.
