# Security: how it works inside

For contributors. What an owner or an agent needs is in `docs/references/security.md`; this file
is not indexed by the `manual` tool. The invariants are the "Rules that keep it safe" in the
repository's `AGENTS.md`; this file only says where the mechanism lives.

## The gate (`coreExtension` in `src/agents.ts`)

Every tool call passes the `tool_call` handler, in this order:

1. For `bash`: `bashDeny`, the `find /` refusal in a sandbox, the time limit capped at
   `bashTimeoutSec`, `background` refused where no conversation can be told (`backgroundRefused`),
   no shell in `safe` mode on a machine without a sandbox, and without a sandbox `pineOwn`
   (`src/actions.ts`), which reads the command line for pine's home, program, the `pine` program
   and the control port.
2. Plan mode: anything `classify()` does not call `look` is refused with `PLAN_REFUSAL`.
3. `ownAsks`: in `safe` and `manual` mode after outside content, the first change to the agent's
   own files is put to the owner once per conversation (`askOnce`), kept by `ownKept`/`decideOwn`.
4. File tools: `checkPath`; where the path is outside what the conversation has and `canAsk()`,
   `seek` asks the owner (`outsidePath`, `grantPath`).
5. Shell in a sandbox: `named()` (`reaches` in `src/access.ts`) asks before the command; a `~`
   that means the owner's home is refused with the path written out.
6. The browser's local addresses (`localTarget`, `allowLocal`) and app control (`appTarget`,
   `allowApp`), asked once per address or app per conversation.
7. `classify()` gives the class; then, in this order: `bypass` asks nothing; the `approve` list or
   a server's `"approve": "always"` asks every time; `critical` asks unless "always" was given for
   that kind (`critical:<note>`); read-only tools and a remembered "always" pass; `manual` asks;
   after outside content `send` and `subscribe` ask. A sub-agent (`profile.leaf`) is refused with
   `SUBAGENT_CANNOT_ASK` wherever it would ask.
8. `isTaintSource` marks the conversation after a call whose result is outside content.

"Always" answers are kept in `AgentManager.allowed` by `Live.perm` as `clean` or `tainted`: a
`clean` one stops counting once the conversation is tainted.

## Classes (`classify` in `src/actions.ts`)

`look`, `local`, `reach`, `send`, `tell`, `own`, `critical`, `setup`. `LOOK_TOOLS` only read;
`SETUP_TOOLS` ask by their own rules; `approveWhenTainted` makes a tool `send`, and a `send`
whose source `tellsOwner` is `tell`. `criticalCommand` and `PROTECTED_HOME`,
`PROTECTED_ANYWHERE`, `PROTECTED_IN_COMMAND` are the patterns for critical actions;
`readOnlyCommand` decides which shell commands only look (also for plan mode).

## Levels and variants (`src/security.ts`, `src/config.ts`)

- `Level` is `manual | safe | auto | bypass`; `plan` lies on top (`AgentConfig.level`).
  `levelOf()` gives an agent whose mode nobody chose `auto` where there is no sandbox.
  `effectiveLevel()` holds a run from outside to `safe` and pauses `bypass` after outside
  content (`security.bypassWhenTainted`, `bypassAnyway`). `stricter()` caps a delegated task.
- `live.variant()` picks the profile per call: normal or restricted (after outside content), or
  `open` / `open-restricted` without a sandbox, where the session's `jail` is an empty prefix.
- `shellEnv()` builds a child's environment from an allow-list; without a sandbox it is the
  owner's own, minus the daemon's variables and names matching `SECRET_NAME`. On macOS it sets
  `CFFIXED_USER_HOME` and `CLANG_MODULE_CACHE_PATH` to the private home.

## The sandbox

- `sandboxArgv()` is the only place that names `sandbox-exec` or `bwrap`; `helperArgv()` is the
  sandbox for helpers that touch bytes from anywhere (no network, write only where named).
- macOS: `sandboxProfile()` starts from deny-all and allows the roots (`Roots`). Each command's
  profile carries its own text in `with message`, so `Denials` (`src/access.ts`) can read the
  system log (`log stream`, kept running only while commands run, plus `idleMs`) and ask the owner
  after the fact; a mark denial after each command tells "nothing reported" from "not yet read".
  The GPU and neural engine are opened by IOKit user client class and mach name.
- Linux: `bwrapArgs()` binds `/` read-only, puts a tmpfs over the owner's home and pine's home and
  binds the agent's roots back, gives a `/dev` and `/proc` of its own, `--unshare-net` without the
  network, `--unshare-pid`, `--unshare-ipc`, `--die-with-parent`, `--new-session`, and drops
  capabilities (`POWERLESS`). Without the network a seccomp filter (a BPF program passed on fd 9)
  refuses `socket(AF_UNIX)`; sockets in `/run` are covered with `/dev/null`.
- What a mount cannot forbid (a file that does not exist yet) the `Guard` removes after the
  command: `protectedNow()` looks `DEPTH` (6) levels deep, skipping `SKIP` (node_modules, dist,
  build, target, ...), up to `MAX_DIRS` (20 000) folders; `cutShort` makes the file tools refuse.
  That is why a command in the background, and `follow` of the `command` source, are refused on
  Linux after outside content.
- The file tools run their I/O inside the sandbox (`src/sandbox-fs.ts`), so a path check is only
  an early, clear error. Never add a tool that reads or writes a model-chosen path in the daemon.
- `pine init` on Linux (`src/sandbox-setup.ts`) installs bubblewrap, writes
  `/etc/apparmor.d/bwrap` and loads it:

  ```
  abi <abi/4.0>,
  include <tunables/global>

  profile bwrap /usr/bin/bwrap flags=(unconfined) {
    userns,
  }
  ```

  An existing file is only loaded again. Setting `kernel.apparmor_restrict_unprivileged_userns=0`
  would allow namespaces for every program; pine does not do that. The container flags in the
  reference were each found necessary by leaving it out.

## Writing on the owner's behalf

- The editor's save (`writeText`, `putInto`) and the file tree's changes (`changeFiles`, `inFolder`)
  run a fixed shell script per change behind `helperArgv([folder])`, writing beside the target and
  moving over it; never `fs` on a path an agent can influence.
- Undo (`src/snapshots.ts`, `src/undo.ts`) and worktrees (`src/worktrees.ts`) run git through the
  `git()` helper of `src/workspace-view.ts`: `GIT_CONFIG_GLOBAL` neutral, `info/attributes` turns
  filters off, filters and merge drivers replaced (`neutral`), `gitRights` from pine's record.

## Tests

`test/security.test.ts`, `test/access.test.ts` (with `security.askAccess` on and a stand-in for the
log), `test/actions.test.ts` and the sandbox tests skip themselves where `sandboxAvailable()` is
false. A new security property needs a test that fails without the code that provides it.
