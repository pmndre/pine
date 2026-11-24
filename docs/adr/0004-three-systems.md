# 0004: pine on macOS, Linux and Windows

Status: accepted.

## Context

pine and the Pine app came from the Mac. Linux had pine's sandbox already (bubblewrap,
`src/sandbox-linux.ts`), but no app, and no workflow had ever run the tests there. Windows had
neither: no sandbox, so no shell in `safe` mode, no git for the code pane, worktrees or undo
(their helpers run in the sandbox), and a process model (groups, `ps`, `kill(-pgid)`) Windows
does not have.

The owner wants the three systems to be equal: the daemon, its sandbox, the app, and their builds.

## Decision

**Every pull request is tested on all three** (`.github/workflows/test.yml`): Linux x64 and arm64
with the sandbox set up as `pine init` sets it up, macOS, and Windows. A test that cannot run on a
system skips itself and says why.

**Linux is a system like macOS.** The app is packed as an AppImage and a deb for x64 and arm64,
with checksums and GitHub's attestation (a release job `app-linux`). What the Linux sandbox does
not forbid but takes away after a command (`Guard`) stays as `docs/references/security.md` says.

**On Windows, pine runs in WSL first.** A Linux distribution of WSL runs pine with its Linux
sandbox, unchanged. The Pine app for Windows reaches it as it reaches another machine
(`connectWsl` in `src/remote.ts`, with `wsl.exe` in place of `ssh`), brings the pine it carries
into the distribution, and translates folders between `C:\` and `/mnt/c`. The installer is signed
through SignPath Foundation (a release job `app-windows`).

**pine on Windows itself runs without a sandbox, as on any system that has none** (rule 2 of
`AGENTS.md`): an agent whose mode nobody chose works in `auto`, one set to `safe` gets no shell, a
run started from outside gets none. What a command leaves running is found by its process tree
(`src/programs.ts`): a command's shell notes its process id, and a program belongs to it when its
chain of parents leads there.

## What was tried for a sandbox on Windows itself

An AppContainer, started by a helper of pine's written in C# and built with the compiler every
Windows carries. A workflow ran programs in it on GitHub's Windows runner, one at a time (both are
in the history of the pull request that brought this ADR). What it found:

| | In the AppContainer |
|---|---|
| cmd, PowerShell, Node | start |
| writing where it was given the right | works; elsewhere refused |
| reading the owner's files it was not given | refused |
| the network | refused without a capability; with one the internet, never this computer's loopback |
| the null device (`NUL`, `/dev/null`) | refused: git and every program that opens it fail |
| Git's bash and its programs (MSYS) | do not start: the runtime makes a folder of named objects in the global namespace, which an AppContainer may not, and a folder made for it by pine-box was not enough |

So an AppContainer cannot run the shell and the git that a coding agent needs, and the
AppContainer was taken out again. The way left is the one OpenAI took for Codex: a local account
of pine's own for commands, made once with an administrator's yes, whose token is restricted
further, with permissions on the owner's folders as the sandbox's roots and the Windows Filtering
Platform for the network. It would be a second sandbox on Windows beside WSL's, written and
tested on Windows alone, for what WSL gives already. It is not built: `safe` mode on Windows
means pine in WSL.

## Consequences

- An owner on Windows who wants `safe` mode uses the pine in WSL, which the app sets up.
- Agents in WSL run Linux's programs; Windows' folders are slower through `/mnt/c`, and app
  control of Windows' apps is not there.
- pine's helpers on Windows (the `system` source, voice, app control) are C# programs built with
  the compiler every Windows carries (`src/csharp.ts`), as the Swift helpers are built on a Mac.
