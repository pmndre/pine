# Technology

What pine runs on, the system programs it uses and what happens without each, and what has not been
verified yet. How pine is built on pi, for contributors: [docs/dev/stack.md](../dev/stack.md).

## What pine is made of

pine is a daemon on Node 24 or later, built on the pi coding agent (`@earendil-works/pi-coding-agent`),
which runs each conversation: model calls, tools, compaction, retries, MCP. Everything pine keeps
for itself (events, tasks, shared state, which conversations have read outside content, goals,
what `/undo` can take back) is one SQLite file, `data/pine.db`.

## System programs

| Program | What for | Without it |
|---|---|---|
| `sandbox-exec` (macOS), `bwrap` (Linux) | The sandbox of `safe` and `manual` mode and of every run started from outside ([security.md](security.md), "3. The sandbox") | No `safe` mode; `pine init` installs bubblewrap on Linux |
| `git` | The code pane's changes, worktrees, and `/undo` ([coding.md](coding.md)) | Those features are missing |
| Chromium, through `@playwright/mcp` | The bundled browser and the `http` source's `render` | `pine init` downloads it; web search and page reading work without it |
| `swiftc` | pine's helpers on macOS (app control, dictation, the `system` source), compiled on first use ([computer.md](computer.md)) | Install Apple's command line developer tools (`xcode-select --install`); the Pine app carries the helpers built |
| `sips`, `ffmpeg` | Pictures and video in the terminal UI: `sips` on macOS, `ffmpeg` for video and on Linux | Only png pictures; no video frames |
| `ffmpeg`, `afconvert` | The bars beside a sound in the terminal UI: a wav file is read as it is, any other kind (mp3, m4a, ogg, flac) is decoded first, by `ffmpeg` or on macOS by `afconvert` | Only wav files have bars (on Linux without `ffmpeg`). The Pine app decodes sound itself |
| `osascript` (macOS); `ffplay`, `mpv`, `pw-play`, `paplay`, `aplay` (Linux, the first one installed) | Playing a sound in the terminal UI | No sound in the terminal UI |
| `claude -p` | Optional development model: `pine dev-model`, and a home whose model is `dev/...` | Not needed with any other model |

## Not verified yet

1. **A real llama-server**: whether it accepts `store` and `max_completion_tokens` (`pine model add`
   switches both off with `compat`), two user messages in a row after an aborted run, and how its
   chat template renders tool calls.
2. **A quantised local model**: how reliably a 2 to 3 bit quantisation calls tools, delegates
   and resists text that tells it what to do.
3. **Hosted providers**: no automatic test reaches them; their sign-in flows (`pine login`) are
   tried by hand.
4. **Throughput**: `limits.maxConcurrentRuns` against a llama-server's slots, and sub-agents when
   slots are scarce.
5. **Long uptimes**: weeks of running, database and session file growth, MCP servers that die
   and reconnect.
6. **Linux beyond Ubuntu 24.04**: pine is tested on Ubuntu 24.04 (x64 and arm64) with the sandbox
   that `pine init` sets up. `pine init` with dnf, yum, pacman, zypper or apk, Podman, and the
   terminal UI in a real Linux terminal have not been tried.
