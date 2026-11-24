# Working on pine

pine is an event-driven multi-agent daemon on top of the pi coding agent SDK. Read
[docs/SKILL.md](docs/SKILL.md) for the index of the documentation; this file covers what you need
to change the code.

## Commands

| Command | What it does |
|---|---|
| `npm test` | All tests against the scripted model server. About ten seconds. Run it after every change. The Test workflow (`.github/workflows/test.yml`) runs it for every pull request and push to `next` on Linux (x64 and arm64, with the sandbox set up by `pine init`), macOS and Windows; a test that cannot run on a system skips itself and says why. |
| `npm run build` | Makes the npm package in `build/`: the sources compiled to JavaScript at the same paths, plus docs and examples. Node runs TypeScript directly in a checkout but not inside `node_modules`, so only the package is compiled. Code that names one of pine's own module files at run time uses `EXT` from `src/config.ts` (".ts" or ".js"). |
| `npm run release` | What the Release workflow runs on every push to `main` and to `next` (`.github/workflows/release.yml`): works out the next version, builds, publishes to npm, and marks the release with a tag. From `next` it is a preview (`--next` by hand). `node scripts/release.mjs --dry-run` shows the version and checks the package without publishing. The checkout's `package.json` is marked private so that the sources are never published uncompiled. |
| `npm run check` | Type check (`tsc --noEmit`). |
| `npm run test:live` | End-to-end through `claude -p`, plus the real browser and, on a Mac, the real app control helper and the helper of the `system` source. Slow, uses a Claude plan and the network. Run it when you change prompts, tool descriptions, `src/dev/claude-model.ts`, `mcp/browser.ts`, `mcp/computer.ts` or `mcp/computer.swift`. The tests that operate TextEdit skip themselves unless the terminal app they run in has the Accessibility and Screen Recording grants. |
| `npm run baseline` | The 59 pi SDK checks in `baseline/`. Run it after upgrading pi. |
| `node src/cli.ts <command>` | The CLI without installing it. |
| `npm run desktop` | The desktop app (`desktop/`, Electron), built and opened. It has its own `package.json` and `node_modules`: `npm install` in `desktop/` once. `npm run dev` there reloads the page as you edit. On a Mac both start a copy of Electron's app named Pine, with Pine's icon and signed again for this Mac, so that the menu bar and the Dock say Pine (`desktop/scripts/dev-electron.mjs`, made once per Electron version in `desktop/node_modules/.cache/pine-dev`). |
| `npm run desktop:test` | The desktop app from end to end: the real app, through its real window, on a pine home of its own with the scripted model server. It builds the app once for the run into a temp folder of its own and every test starts that build (`desktop/scripts/test.mjs`, `desktop/test/support/app.ts`), so runs of several checkouts at once never test each other's build. The app's window is drawn and never shown, so a run takes no place on the screen and the owner's pointer and keys never reach a test (`PINE_DESKTOP_SHOW=1` shows the windows, to watch a test). As many files side by side as the computer has room for (one for every two idle processors, six at most, two at least), two minutes at most a test; a file with a failure is run again alone, and one that passes then is named and does not fail the run. Under a minute. The Test workflow runs it on macOS and on Linux under `xvfb-run` when those change. Run it when you change `desktop/`, the control API the app uses (`src/http.ts`, `src/owner.ts`) or `pine service`. `npm run check` in `desktop/` is its type check. |
| `npm run dev:preview` (in `desktop/`) | The app's page in an ordinary browser on a throwaway pine; `dev:preview:home` on `~/.pine`, whose daemon it never stops. Each checkout has ports of its own, from its path (`desktop/scripts/launch-json.mjs`), and `.claude/launch.json` is written with them by `npm install` in `desktop/` (it is not in git). After pulling, or when the preview pane lists no `desktop-preview`, run `node desktop/scripts/launch-json.mjs` (or `npm install` in `desktop/`). A preview and `npm run dev` end with whatever started them (`desktop/scripts/leash.mjs`). |
| `npm run storybook` (in `desktop/`) | Storybook for the parts of the app's page, at port 6006: a story sits beside the file of what it shows (`desktop/src/<File>.stories.tsx`, `desktop/src/components/<name>.stories.tsx`: `desktop/src/ApprovalDialog.stories.tsx`, `desktop/src/components/printed.stories.tsx`, `desktop/src/components/logo.stories.tsx`); `npm run build-storybook` builds it. Chromatic publishes the stories on every pull request and every push to `next`, whose build is accepted as the baseline (`.github/workflows/chromatic.yml`, secret `CHROMATIC_PROJECT_TOKEN`), each in light and dark at a phone's width (360) and the window's (1280) through its modes (`desktop/.storybook/modes.ts`), so no dark or phone twin of a story is written. Add or update a story when you change a part in `desktop/src/components/` (outside `ui/`, which is stock). |
| `npm run desktop:pack` | On a Mac `desktop/release/mac-arm64/Pine.app` (`mac/` on Intel); on Linux and Windows the app's folder (`linux-unpacked`, `win-unpacked`), and with `--dist` an AppImage and a deb, or an NSIS installer (`desktop/scripts/pack.mjs`). On a Mac: with the package of `npm run build` and its dependencies, the Node it runs on, pine's helpers built (`scripts/helpers.mjs`) and `pine` for a terminal inside, signed with the hardened runtime. `node desktop/scripts/smoke.mjs` starts that app from a folder of its own and checks that it runs on the pine and the Node it carries. Run both when you change `desktop/scripts/`, a helper's build function, `src/prebuilt.ts`, a native module of browser access (`ssh2`, `node-datachannel`) or `desktop/electron/service.ts`, and the smoke test also after a change to the page's markup that it finds the page by (`data-slot` names): no workflow runs it. |
| `npm test`, `npm run check` (in `mobile/`) | The mobile app's bridge and both builds of its page (Android, iOS) under `node:test`, and its type check against the desktop page's `Bridge`. `npm install` in `mobile/` once. Run both when you change `mobile/src`, the page's bridge (`desktop/src/bridge.ts`) or what the page reads from it. The `android` job of the Release workflow runs both before it builds the APK; run them yourself before you build the IPA by hand. |
| `npm run test:core` (in `mobile/`) | The native plugin's Kotlin core on the JVM: an SSH server in the test (Apache MINA sshd) and a stand-in daemon, and for a paired computer the Pine app's real access host under Node (`mobile/test/support/access-host.ts`, so it needs Node and `npm install` in `desktop/`), with libdatachannel's JVM binding behind the core's `WebRtc` interface. Run it when you change `mobile/core/`, `mobile/cases/`, `src/remote.ts` or `desktop/electron/access/`. |
| `swift test` (in `mobile/ios-core/`) | The iOS plugin's Swift core on the Mac: a real OpenSSH `sshd` started by the test on a loopback port and a stand-in daemon, the same cases as the Kotlin core (`mobile/cases/`), and for a paired computer the same access host helper (Node and `npm install` in `desktop/`). Apple silicon only: libdatachannel's xcframework has no Intel slice for macOS. Run it when you change `mobile/ios-core/`, `mobile/cases/`, `src/remote.ts` or `desktop/electron/access/`. No workflow runs it for now. |
| `npm run ipa`, `npm run smoke:ios`, `npm run ios:run` (in `mobile/`) | The IPA of a release, not signed (`scripts/ipa.ts`: `npm run ipa -- <version>`, written to `ios/App/output/`, checked unsigned and arm64); the iOS app from end to end on a simulator of its own without a window, against the Android smoke run's test SSH server, and paired with the real access host behind a TLS front whose authority the run adds to that simulator (`--pairing-only` for that alone); and the app opened in the Simulator app, by hand. The smoke test is the test of the web view's hardening in `PineViewController.swift` and `PinePlugin.swift`, of pairing by a pasted link and by a `pine:` address, of the return from the background and of the key kept in the Keychain: run it before a release that changes `mobile/` or upgrades Capacitor. No workflow runs it. They need Xcode 27 with an iOS simulator runtime, and the smoke run a JDK as `npm run smoke` does. |
| `npm run apk`, `npm run apk:release`, `npm run smoke` (in `mobile/`) | A debug APK; a release APK (signed when `ANDROID_KEYSTORE_FILE` and the three other variables of the release job name a key, versioned by `PINE_VERSION` and `PINE_VERSION_CODE`); and the app from end to end on an emulator without a window, against a test SSH server of its own running the real `pine service`, and paired with the real access host behind a TLS front whose authority only the debug build trusts (`-PpineSmokeAuthority`; `--transport-only` for the libwebrtc check, `--pairing-only` for that and pairing). The smoke test is the test of the WebView's hardening in `PinePlugin.kt`, of libwebrtc (`LibWebRtcTest`, the only test of it), of pairing by a pasted link and by an App Link, and of the back button and the app's return from the background: run it before a release that changes `mobile/` or upgrades Capacitor. No workflow runs it. The Gradle commands need the Android SDK (`ANDROID_HOME`, default `~/Library/Android/sdk`) and a JDK of 21 or later: `JAVA_HOME`, default Android Studio's (`/Applications/Android Studio.app/Contents/jbr/Contents/Home`), since a Mac has no `java` on its PATH by default. |
| `npm test`, `npm run check`, `npm run build` (in `web/`) | The web client: the web bridge as the page calls it, in Node with a stand-in for SSH, and its SSH core in headless Chrome for Testing against a `sshd` of the test's own on a loopback port, and peer to peer with the Pine app's real access host (`desktop/electron/access/`), so it needs `npm install` in `desktop/` too; its type check; and its build into `web/dist` (the bridge's document, and the desktop page built for the browser under `page/`). `npm install` in `web/` once. Run them when you change `web/`, `desktop/electron/access/`, the page's bridge (`desktop/src/bridge.ts`) or what the page reads from it. |
| `npm test`, `npm run check` (in `web/relay/`) | The relay Worker's fetch handler with a stand-in TCP server on a loopback port, the meeting module and its routes, and its type check. `npm install` in `web/relay/` once. `wrangler.jsonc` has one configuration and no environment: the web client, the relay and the meeting service side by side, a whole deployment. Every deployment is a Worker of its own made from it, named with `--name`, at `pine-<channel>.<account>.workers.dev`: `pine-main` (the project's service, the apps' default), `pine-next`, and `pine-pr-<number>` for a pull request; a deployment of one's own uses it under a name of its own. `npm run dev` there serves the deployment (relay, meeting service and `web/dist`) under `wrangler dev`. A pull request that changes one of the paths listed in `.github/workflows/web-preview.yml` (`web/` and every input of the page's build) runs `.github/workflows/web-preview.yml`: the gates of `web/` and `web/relay/` and the build, then `wrangler deploy --name pine-pr-<number>`, whose address it posts on the pull request in one comment that each push updates; when the pull request is closed, `pine-pr-<number>` is deleted through Cloudflare's API. A push to `next` or `main` that changes one of those paths runs it too and deploys `pine-next` or `pine-main`, its address in the run's summary: a push to `main` is how the project's service changes. A Worker that holds a Durable Object gets no version preview addresses, which is why each channel is a Worker of its own. The secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) are in the environment `web-preview`, which a fork's pull request never reaches, and are given to the deploy and delete steps alone; without them the jobs pass and say nothing was deployed or deleted. |
| `npm run smoke` (in `web/`) | After `npm run build`: the page and the relay as one deployment under `wrangler dev`, in headless Chrome for Testing, against a `sshd` of its own on the loopback running the real `pine service` on a home of its own with the scripted model server; then, on the same deployment (the meeting service beside the relay), the Pine app's access host under Node beside that home's `pine service`, and a second browser paired by link, peer to peer. Named checks, each of which fails the run. It is the one test of the page's isolation in a real browser, and the one test of pairing from end to end. Run it before a release that changes `web/`, `web/relay/` or `desktop/electron/access/`; no workflow runs it. |

There is no build step. Node runs the TypeScript directly (the compiled parts, pine's Swift
helpers such as `mcp/computer.swift`, are built by pine on the Mac it runs on, on first use;
only the Pine app carries them built), so:

- only erasable syntax: no `enum`, no `namespace`, no constructor parameter properties;
- relative imports carry the `.ts` extension;
- `import type` for types.

## Layout

```
src/
  cli.ts            command line; the only file that calls process.exit
  pine.ts           startPine(): builds and wires everything, returns a handle with stop()
  config.ts         loads and validates pine.json, agent.json, .env; all defaults live here
  store.ts          SQLite: event log (Bus), shared state (State), private storage (Kv), tasks
  boards.ts         boards: tasks and notes that several runs share (a conversation and its sub-agents, several
                    agents). The tables, who may use which board, a task taken in one step and given back when
                    its run ends. No bus, no agent in it: the tools (src/tools.ts) and the control API use it
  agents.ts         AgentManager: task queue, pi sessions, conversations, the policy gate, the download tool, context block
  tools.ts          the tools pine gives an agent: delegate, subagent, publish_event, send, read_source, request_access, state_get,
                    state_set, question, todo, stop_program, manual; the board tools (boards, board_read, board_post,
                    board_claim, board_done, board_answer, board_remove) and the pool of sub-agents that works through a board (`workPool`),
                    which comes back to its conversation when a sub-agent asks or fails;
                    the lists of what it has (sources, schedules,
                    mcp_servers, skills, models); and the setup tools (subscribe, unsubscribe, add_/remove_ source, source_type,
                    mcp_server, skill, schedule, model_server; create_agent); and the main agent's tools for
                    agents (update_agent, rename_agent, remove_agent) and for conversations (conversations,
                    read_conversation, set_conversation, remove_conversation, rename_group, remove_group)
  agent-admin.ts    create_agent: checks a proposed agent and writes its folder
  admin.ts          what only the main agent administers: a change to an agent (`checkAgentChange`), pine's settings
                    (`SETTINGS`), routes (`checkRoute`), everything that goes with a removed agent (`eraseAgent`)
                    and everything that follows a renamed one (`renameAgent`)
  security.ts       the sandbox's rules (macOS profile; `sandboxArgv` for either system), the level an agent works at (`levelOf`), path checks, approvals, redaction, configuration audit
  sandbox-linux.ts  the same rules as bubblewrap mounts; what a mount cannot forbid is removed after the command (`Guard`)
  sandbox-setup.ts  what `pine init` does on Linux: installs bubblewrap, the AppArmor rule and the browser's libraries after one yes
  sandbox-fs.ts     read/write/edit/grep/find/ls executed inside the sandbox (as they are, in a mode that has none)
  access.ts         what a call needs beyond its sandbox, found so that the owner can be asked: the paths a command
                    names (`reaches`), the system's reports of what a sandbox refused (`Denials`, macOS), a failed command's words
  sources.ts        event sources and subscriptions: starts a source on its first subscriber, turns a subscription into a route
  manual.ts         pine's manual made searchable: docs/ cut into parts, BM25 over them, synonyms; the `manual` tool and `pine manual`
  skills.ts         skills by tool call: where one lies says whom it is for (all agents, an agent, a conversation)
  source-types.ts   what a source type module declares: summary, options schema, plan()
  sources/          the built-in source types (`SOURCE_TYPES` in config.ts). That look: http, command, feed, calendar,
                    modbus, presence. That are told: folder, mqtt, webhook, ftp, telegram, stream, mail, slack, matrix,
                    discord, smtp, syslog, serial, onvif, system (its helpers repeat what the system says and decide
                    nothing: system.swift on macOS, system.cs on Windows, system-linux.ts on D-Bus), and command with `follow`
  watching.ts       what the types that look share: fetching an address, picking a value (a field, a pattern, a
                    selector, a number), line differences, a page's text; and `capped`, the limit on how often a type that is told may report
  mime.ts           an e-mail message read into sender, subject, text and attachments, for the mail and smtp types
  env-file.ts       sets and removes entries in .env (secrets of sources that agents set up)
  themes.ts         the themes of the owner's UIs: VS Code color theme files in <home>/themes (seeded once from
                    examples/home/themes), listed for `GET /themes`, the one `ui.theme` names
  views.ts          the views of the Pine app's panel: scripts of the owner's in <home>/views, listed, handed over
                    with their types stripped (never run by the daemon), `ui.view`; pine's own (examples/home/views: office, workshop, overview) given to a home and kept up to date there at every start, a version the owner changed kept beside it as a view of its own (`seedOwn`),
                    with the guide to writing one (`views/AGENTS.md`, for the owner or a coding agent opened there;
                    no agent of pine's reads it), which is written anew when it or `view-kit.ts` changed (`seedGuide`).
                    Keep that guide true to `view-kit.ts`: `test/views.test.ts` checks its names
  view-kit.ts       `pine/view`, what a view imports: the types of what a view is told, `defineView`, helpers. No
                    Node, no DOM: the app's view frame runs it, and pine copies it into <home>/views/.pine for editors
  theme-colors.ts   a VS Code color theme resolved into pine's color roles, as hex colors and nothing else (no
                    fs: Storybook uses it too); a theme's `pine` object overrides a role by name
  update.ts         `pine update`: brings pine up to date the way it was installed (git or npm) and fetches what the new version needs;
                    a pine inside the Pine app says where the new app is
  prebuilt.ts       where a helper that was built with pine lies (beside its source, in prebuilt/), for the Pine app
  browser-build.ts  whether the browser build pine's Playwright drives is on this computer: Playwright's installer is asked where
                    it would put it, and told to fetch nothing. For `pine check`, the control API's overview and the Pine app
  net.ts            address guard (no private ranges) and fetchToFile, used by the download tool and mcp/web.ts
  router.ts         routes: filter, debounce, set / publish / call / agent
  timers.ts         the scheduler: cron, intervals and one-offs; a schedule with a task wakes an agent
  goals.ts          goal mode (`/goal`): a conversation's objective, the judge that says whether it is met, the task that calls the agent again
  swarm.ts          a swarm (`/swarm`): a job the conversation's agent leads. What the lead is told, and what pine does each time
                    the lead ends a turn, going by the conversation's board alone: call it again while tasks are not done, put a
                    check of the lead's answer on the board when all are and start the sub-agent that does it, call the lead
                    when that check failed, wait for the owner's answer
  hatch.ts          agents introduce themselves once, in their answer to the owner's first message to them: the note in front
                    of it (`INTRODUCE`). No agent starts a conversation by itself
  browser-view.ts   the bundled browser of a conversation for a UI that shows it itself (the Pine app's panel): the
                    daemon's way through the door of the browser's server, for the control API alone
  programs.ts       what a conversation's commands left running: found by process group, listed, stopped;
                    commands in the background: started, found again after a restart, seen to end
  background.ts     what an agent reads about commands in the background: the shell tool's words, the message when one has ended
  actions.ts        what a tool call is (`classify`), the protected paths, and what a shell without a sandbox is refused (`pineOwn`)
  computer.ts       app control: who gets the server (`computerSession`) and which app a call is about (`appTarget`); shared by the gate, classify() and the server
  workspace-view.ts what the code pane reads: git changes and diffs (git contained in a sandbox), folder listings, file text
  snapshots.ts      the state of a folder as a git tree in a git directory of pine's own: recorded, compared, restored
  worktrees.ts      a conversation's worktree (.pine/worktrees/<name>, branch pine/<name>): made, merged, updated, removed by git
                    in the helper sandbox with the repository's filters and merge drivers replaced; what a run in one may touch (`gitRights`)
  undo.ts           taking back the owner's last message: turns and their steps, what waits for a redo, pi's session file
  http.ts           control API and webhooks
  owner.ts          what the owner does through the control API that the main agent does by tool: pine's settings,
                    agents in full, the files for all agents, skills, schedules, routes, sources, model servers and
                    sign-ins, an MCP sign-in, and writing a file of a conversation's folder. The same check and apply
                    functions as the tools, without the question (the token is the owner)
  service.ts        `ensureDaemon`: the daemon of a home, found or started in this process. The terminal UI uses it
                    directly, another program through `pine service`
  csharp.ts         pine's helpers on Windows: a C# program built with the compiler every Windows carries (csc.exe, C# 5),
                    into prebuilt/ beside its source or a folder of pine's, as the Swift helpers are built on a Mac
  remote.ts         the pine of another machine over SSH (and, on Windows, of a WSL distribution through wsl.exe: `connectWsl`): the host checked to be no option, `pine service` run there,
                    a port of this computer forwarded to its loopback and nowhere else. Node's own modules only: the
                    Pine app's main process carries it (Settings > Environments); `pine --ssh` uses it for the terminal UI
  limiter.ts        model slots with priority
  catalogue.ts      how tools are declared to the model in the owner's conversations: families (one declared tool for a group, an
                    action for each tool, the call carried out by the tool itself), short declarations, arguments that are
                    nearly right taken as meant (`ease`, `fit`), `find_tools`
  slots.ts          which slot of a llama.cpp server a conversation's requests go to (`SlotBook`), and the idle ones pine fills
  login.ts          `pine login`: pi's sign-in flows, stored in <home>/auth.json
  models.ts         pi's model runtime on pine's home; fills a "$NAME" key in models.json from .env;
                    model servers of the owner's own: asking one what it serves, adding and removing it
  mcp-config.ts     add/remove/list MCP servers in the files; runs pi's `mcp` CLI for state and OAuth sign-in
  tui/              terminal UI: app.ts (tabs, commands, rendering), client.ts (API + event stream), run.ts
                    (this home's daemon, or with `--ssh` another machine's through src/remote.ts),
                    code-pane.ts (the pane beside a conversation: changes, files, tool output),
                    undo.ts (what the conversation says after /undo and /redo),
                    theme.ts (colors, markdown, and the parts of an answer that are folded into a line: `Answer`), highlight.ts (code colors),
                    picture.ts (pictures, video and sound: conversion with sips or ffmpeg, Kitty-protocol or half-block drawing, the system's player for sound),
                    levels.ts (the bars of a sound: its levels by frequency band for each tenth of a second, from a wav file or a decoder's samples;
                    the Pine app's page is built with this file too, so nothing in it runs or imports Node's own when it is loaded),
                    welcome.ts (pine's welcome at the top of the main agent's empty main conversation, as the Pine app's
                    `desktop/src/WelcomeLetter.tsx` says it),
                    voice.ts (dictating a message, recognised on the device: voice.swift on macOS, voice.cs on Windows
                    (System.Speech), voice-linux.ts and voice-whisper.ts on Linux (whisper.cpp); a sentence where a piece is missing)
  types.ts, util.ts shared types; topics, templates, filters, durations, logger; the folded parts of a text (`foldsIn`, for the
                    terminal UI, and `unfolded` for a place that folds nothing)
  dev/claude-model.ts   OpenAI-compatible server backed by `claude -p` (development only)
mcp/                bundled MCP servers (separate processes): web, browser, commands, computer; lib.ts is what they share
                    (computer.cs and computer-linux.py are computer.ts's helpers on Windows and on Linux with X11)
                    (render.ts is not a server: the helper of the http source's `render`, one look at a page with the browser)
                    (computer.swift is the macOS helper of computer.ts: accessibility tree, mouse and key events, pictures; it decides nothing)
examples/home/      what `pine init` copies
test/               node:test files; support/harness.ts builds a temp home and a daemon
baseline/           pi SDK behaviour checks and their results; the mock model server lives here
docs/               SKILL.md index and references/
desktop/            the desktop app (Electron; a package of its own, not part of what goes to npm): electron/ is the
                    main process (the window, the daemon's token, `pine service`, `pine` for a terminal, the look for a newer app and its own update;
                    electron/access/ is browser access, without Electron: the access server on ssh2, this computer's host key and
                    the paired devices, pairing, the WebRTC data channel on node-datachannel, the host that waits at the
                    meeting service, and the control the page's Settings > Browser access reads), src/ the
                    page (React, Tailwind v4, shadcn on Base UI, shadcn's core chat components composed per shadcn's AI Elements
                    patterns for the conversation and the input, Streamdown for answers, lucide icons,
                    usehooks-ts for the side panel's breakpoint; ui-sdk only for what shadcn lacks), test/ the app driven through its real window, scripts/ what builds, tests, previews and packs it.
                    The stock components are src/components/ui and nothing else, all from shadcn's own registry in the
                    style components.json names, the chat components included (`npx shadcn add message`, not
                    `@ai-elements/message`). AI Elements means shadcn's pages of patterns (ui.shadcn.com/docs/ai-elements),
                    which are code to compose, not a package. Vercel's earlier `@ai-elements` registry, which shadcn's
                    pages replace, serves one version written on Radix for every style: it is never added. A stock component is never edited: add and
                    update them with the shadcn CLI and components.json. Stock is used directly where it is needed:
                    no wrapper that only renames or bundles stock components. src/components/ holds only a
                    composition stock cannot express in place, and wraps the stock one. No hand-written stylesheet:
                    utilities on Tailwind's default scale, tokens and one root font-size in src/index.css.
                    docs/references/desktop.md describes it and its layout.
                    shadcn's agent skill lies in desktop/.agents/skills (desktop/.claude/skills links to it, skills-lock.json pins it):
                    read it before you change the page; `npx skills update` in desktop/ brings it up to date
mobile/             the Android and iOS app (Capacitor; a package of its own, not part of what goes to npm): the desktop
                    page on a phone, for the pine of another machine over SSH or of a computer paired with the Pine app,
                    no daemon on the phone. src/ is the
                    mobile bridge (`mobile-bridge.ts`: returns the `Bridge` type, forwards to the native plugin),
                    the plugin's contract (`plugin.ts`) and the entry that installs the bridge before the desktop
                    page (`install.ts`, `main.ts`); vite.config.ts builds desktop/src for it. core/ is the native
                    plugin's Kotlin core, with no Android in it (a Gradle build of its own, tested on the JVM):
                    SSH with sshj, `pine service` run as `remoteCommand()` of src/remote.ts runs it, calls to the
                    control API and media under the desktop's rules, the event stream, the phone's key and host keys;
                    for a paired computer the meeting and the data channel SSH runs on (`Peer.kt`), behind the
                    `WebRtc` interface (`WebRtc.kt`: libdatachannel's JVM binding in the tests only), pairing
                    (`Pairing.kt`) and the link's rules (`Paired.kt`).
                    android/ is the Capacitor app: `PinePlugin.kt` joins the core to the page (the Android
                    Keystore, the WebView's media, links, App Links, the back button), `LibWebRtc.kt` implements
                    `WebRtc` on Google's libwebrtc (LiveKit's build), and `androidTest/` holds its one test. ios-core/ is the same core in Swift
                    (a Swift package on Apple's swift-nio-ssh, no UIKit, tested by `swift test` on the Mac), with
                    its secrets behind `SecretStore` (the Keychain in the app), and for a paired computer
                    libdatachannel bridged into NIO by a socket pair (`Peer.swift`, `PeerRemote.swift`,
                    `Pairing.swift`, `Paired.swift`). ios/ is the Capacitor iOS app:
                    `PinePlugin.swift` joins that core to the page, `PineViewController.swift` hardens the web view
                    and registers the `pine-media:` scheme (`MediaScheme.swift`), `SceneDelegate.swift` hands it
                    `pine:` addresses, AppTests/ is the smoke run's hosted test. cases/ holds the table cases
                    both cores replay (the page replays `pair-links.json` too), and the remote command they run.
                    test/support/access-host.ts runs the Pine app's access host under Node for the cores' tests
                    and the smoke runs; its line protocol is at its top.
                    `vite build` makes Android's page, `vite build --mode ios` the iOS one (WebKit, its own policy).
                    scripts/ runs Gradle (`gradle.mjs`), derives the release's versionCode (`version-code.ts`),
                    drives the emulator (`smoke.mjs`) and the simulator (`smoke-ios.mjs`), and makes the IPA (`ipa.ts`).
                    docs/references/mobile.md describes it; docs/adr/0001-mobile-app.md and 0002-ios-app.md say why it is so
                    (and 0004-browser-access.md for pairing)
web/                the web client (a package of its own, not part of what goes to npm): the desktop page in a
                    browser, for the owner's own pine over SSH, or the Pine app's pine on a computer paired by QR code, no daemon in
                    the browser. src/ is the web bridge,
                    the top-level document (`bridge-main.ts`, `host.ts`: the browser's key, machines, trusted host
                    keys, the SSH connection and the daemon's token), its door for the page's messages (`serve.ts`,
                    the fixed list in `protocol.ts`), SSH in the browser (`ssh.ts`: @microsoft/dev-tunnels-ssh with
                    Ed25519 on WebCrypto), what runs over it (`tunnel.ts`, `remote-command.ts`), and what the page
                    carries inside its sandboxed iframe (`frame-bridge.ts`, `page-*.ts`); a paired computer's link and
                    pairing request (`pairing.ts`) and the data channel that carries SSH to it (`peer.ts`). scripts/
                    builds it and runs the smoke. relay/ is the relay, a Cloudflare Worker of its own package that
                    carries SSH (while `RELAY` is on) and serves the build beside it, and the meeting service
                    (`meet.ts`, with no Cloudflare in it; `meet-object.ts`, its Durable Object), all in the one
                    configuration of wrangler.jsonc that every channel deploys (`pine-main`, `pine-next`, `pine-pr-<n>`). docs/references/web.md describes it; docs/adr/0003-web-client.md
                    and 0004-browser-access.md say why it is so
```

## What agents know about pine

An agent is told little about pine in its prompt and looks the rest up: its `manual` tool
searches `docs/` (`src/manual.ts`), cut into a part per heading and a part per table row that
describes a named thing. For a change this means:

- What an agent has to know to use a feature goes into `docs/references/`. What is not there,
  agents do not know. Do not put it into the base prompt instead.
- A thing with a name (a key, a tool, a command, an option) gets a row in a table whose first
  cell is that name in backticks. Such a row is found by the name alone.
- Words people use for it that the manual does not use go into `SYNONYMS` in `src/manual.ts`.
- `test/manual.test.ts` holds questions and the part that has to answer each. Add one for a new
  feature, in the words of somebody who does not know what it is called.
- A source type is described three times, on purpose, for three readers. The model that sets
  one up reads the type's own `summary` and option descriptions; only the everyday types
  (`EVERYDAY_TYPES` in `src/config.ts`) are spelled out with their options in `add_source`,
  the others are named there (and in the line for `add_source` in `BRIEF`, `src/catalogue.ts`)
  and what one takes is a part of the manual made from its schema (`source-type#<name>`) and
  the answer to a call that leaves a needed option out. The owner reads
  `docs/references/source-types.md`: what it is for, which services it reaches, examples. A
  new built-in type goes into `SOURCE_TYPES`, into that line of `BRIEF`, and into that file.

## Rules that keep it safe

These are invariants. A change that breaks one needs a test that shows why it is still safe.

1. **Nothing an agent can write is ever executed or trusted by the daemon.** Agents write only
   to their workspace, their sandbox home and temp. Extensions, `agent.json` and
   `pine.json` live elsewhere in pine's home, which the sandbox closes: in `safe` and `manual`
   mode, and in every run started from outside. In `auto` and `bypass` mode there is no
   sandbox (rule 2), and pine's home and code are kept from the agent by `checkPath` for the
   file tools and by `pineOwn` in `src/actions.ts` for the shell. `pineOwn` reads the command
   line: it is a net, said to be one in the manual, and not a wall. Do not widen what those
   two let through. Agents change
   configuration only through the setup tools in `src/tools.ts`. There are four things an
   agent can be given, each with the same three scopes (a conversation, the agent, all agents):
   events (`add_source`, `remove_source`, `subscribe`, `unsubscribe`), MCP servers
   (`add_mcp_server`, `remove_mcp_server`; `mcp_servers` lists them), skills (`add_skill`, `remove_skill`) and schedules
   (`add_schedule`, `remove_schedule`); the main
   agent also has `create_agent`, `add_source_type` and `remove_source_type`, `add_model_server` and
   `remove_model_server`, and the sign-ins `sign_in`, `sign_out` and `sign_in_mcp_server`, which run
   the flows Settings runs and put every question of the flow to the owner as a question of pine's
   (a key in a hidden field, `ApprovalDecision.values`), so that nothing typed passes a model. What an agent has of the four it is told by a tool, never by a file:
   `sources`, `mcp_servers`, `skills`, `schedules`; a new kind of thing gets its list too. Each validates its input, writes only
   the entry it is for, and asks the owner where `docs/references/setup.md` says so. A server
   is a remote URL, or a command that runs where the commands of the agent that uses it run
   (`sandboxed`, set by `add_mcp_server` and wrapped where the session registers it): inside
   that agent's sandbox in `safe` and `manual` mode, with the owner's rights in `auto` and
   `bypass`, which the owner's dialog says. Never a program with the daemon's environment,
   and never through a shell. Global scope, agent creation and new source types are
   refused to every agent but the main one. Removing something must leave things as they were
   before it was added.
   The main agent is pine's administrator: besides `create_agent` it has `agents`,
   `update_agent`, `rename_agent`, `remove_agent`, `settings`, `set_setting`, `routes`, `add_route` and
   `remove_route` (`src/admin.ts`), and for the conversations there are (the owner's tabs and
   each agent's list, with its groups) `conversations`, `read_conversation`, `set_conversation`,
   `remove_conversation`, `rename_group` and `remove_group`. Those go through the functions the
   control API has for the owner's own hand (`pinSession`, `renameSession`, `removeSession`,
   `setGroup`, `renameGroup`, `removeGroup`), never a second road.
   `read_conversation` hands on the messages and the answers and of a tool call only its name
   and subject, never what the tool returned (another agent's files are closed to the main
   agent), and marks the reading conversation when the one it reads holds outside content
   (`outsideMark`). No tool sets a conversation's folder or goal (rules 3 and 11). An agent that is removed leaves nothing: `eraseAgent` is the
   one place that knows what carries an agent's name (routes, lists of others, secrets, stored
   keys, folders under `data/`, its folder and private home), for the tool, the control API and
   `pine agent remove` alike, and `test/admin.test.ts` looks for anything named after a removed
   agent. Whatever is added to pine that is kept by agent goes into `eraseAgent` too, and into
   `renameAgent` beside it, which is the same list the other way round: what one takes away, the
   other moves (`rename_agent`, the control API and `pine agent rename` alike). Each change is
   a few named values that are checked one by one, never text into a file; it is put to the
   owner in every mode; the configuration is read back through `loadConfig` and the file put
   back if it does not load; and the ones that change something are refused in a tainted
   conversation without asking. A new setting gets an entry in `SETTINGS` with what a value has
   to be, never a way to write a key by name. For another agent the main agent uses the tools
   that agent has itself (`FOR_ANY_AGENT`, the end of `pineTools`): the call is handed to that
   agent's own tool with a stand-in for its conversation, so there is one implementation and
   one set of rules. Do not write a second road for "the admin does X to agent Y". What takes
   something away from another agent asks the owner in every case. A new kind of thing an agent can set up follows the same scopes and
   wording (`scopeOf`, `forWhom`, `whoIs` in `src/tools.ts`), not rules of its own.
   What an agent writes and pine reads back is text for a prompt, never code or
   configuration: `AGENTS.md`, `SOUL.md`, `TOOLS.md` and `MEMORY.md` at the top of its workspace
   (`WORKSPACE_FILES`; the main agent replaces another agent's with `update_agent`), and for
   the main agent the files for all agents in pine's home (`AGENTS.md`, `TOOLS.md`, `USER.md`:
   `SHARED_FILES` in `src/config.ts`), the only files there an agent may write, and text for
   every agent's prompt. A new file of that kind goes into that list and nowhere else. A
   conversation of the owner's writes them also after it has handled outside content, and
   nothing checks what it writes there: the manual says so under "What is not solved"
   (`ownFiles` and `roots.ownOpen` in `src/security.ts` open exactly these files in the
   sandbox, and nothing else that is read as instructions). A run started from outside never does.
   Skills are instructions too, and need no configuration entry: where the folder lies says
   whom it is for (`src/skills.ts`). They are written by `add_skill` into pine's home, which
   the agent reads and cannot write. In a tainted conversation `add_skill` is put to the
   owner with its instructions, as `add_schedule` does with a task.
2. **The mode says whether there is a sandbox, and where there is one the OS enforces file
   access, not a path check.** One setting says how much an agent asks and how far it reaches
   (`Level` in `src/config.ts`): `safe` and `manual` work in the sandbox, `auto` and `bypass`
   without one, with the owner's whole account, in the owner's own conversations only
   (`live.wide()`, from `effectiveLevel()` in `src/agents.ts`). `plan` lies on top of a level
   (`AgentConfig.level`). A run started from outside is held to `safe` whatever the agent's
   mode. Do not add a second setting that decides the sandbox, and do not add another way to
   work without one.
   In the sandbox, shell commands and all six file tools run behind `sandboxArgv()`:
   `sandbox-exec` with the profile from `sandboxProfile()` on macOS, `bwrap` with the mounts
   from `bwrapArgs()` on Linux. A rule goes into both or into neither, and a helper that
   touches bytes from anywhere goes behind `helperArgv()`; nothing else names either program.
   What the OS enforces there depends on what the conversation has read: `live.variant()`
   picks the normal or restricted profile for each call, and access the owner granted with
   `request_access` is written into that session's profiles. `checkPath()` only produces a
   clear error early there; do not rely on it. Never add a tool that reads or writes files in
   the daemon process on a path the model chose.
   Without a sandbox (`live.variant()` is `open` or `open-restricted`, and the session's
   `jail` is an empty prefix) the same tools run as they are. pine's home and pine's code stay
   closed all the same, by `checkPath` and `pineOwn` (rule 1); after outside content the file
   tools refuse what is read as instructions, and nothing looks at the shell (rule 5).
   App control (`mcp/computer.ts`) is the same reach by another road: it acts in the owner's
   apps, outside any sandbox. So it follows the modes without a sandbox and adds nothing to
   them: `computerSession()` gives the server only to an agent in `auto` or `bypass` mode, in
   the owner's own conversations, and the gate refuses it where `live.wide()` is false.
   A conversation that has read outside content keeps what its mode gives it: outside
   content takes no reach away. What changes is what is asked (rule 5). A run started from
   outside never has any of it.
   Windows has no sandbox of pine's: an AppContainer cannot run Git's bash or git, and `safe`
   mode there is pine in WSL (`docs/adr/0004-three-systems.md`). Do not add a sandbox for
   Windows that does not run the shell and the git an agent uses.
   On a machine without a sandbox `safe` cannot be had. `levelOf()` in `src/security.ts`
   gives an agent whose mode nobody chose `auto` there, and `audit()` names it; an agent that
   was set to `safe` gets no shell (the gate), and a run started from outside gets none
   (`profileFor`). Never start a shell for a run from outside where there is no sandbox, and
   never move an agent that was set to `safe` out of it.
   One part of pine's data folder is an agent's to read: the folders in which its event sources
   keep the files they received (`Roots.sources`). Which they are, the daemon says, for every
   call: what the running sources declared with `media` (`SourceHost.filesFor`: the agent's own
   sources and those it is subscribed to), let through by `received()` in `src/security.ts`,
   which opens nothing else in pine's home and nothing of another agent's. They are read and
   never written, in every variant: the profile and the mounts allow reading only, and
   `checkPath` and `pineOwn` follow. Do not open anything else under `data/` that way.
   What a call needs beyond its sandbox, pine asks the owner for (`seek` in `coreExtension`):
   before the call for what a file tool is given or a command names (`reaches` in
   `src/access.ts`), after a command for what the system reports the sandbox refused it
   (`Denials`: a text of the command's own in the profile, read back from the macOS log). Both
   only find whom to ask and what to say. The answer is a grant like `request_access` gives
   (`live.grant`), which the sandbox enforces, or a no that is kept for the conversation
   (`AgentManager.refused`). Nothing they find allows or refuses a call by itself, a run
   started from outside is never asked about, and what no answer can open (pine's home, pine's
   code, another agent's files: `grantable`) is never put to the owner.
3. **Trust comes from where an event entered, never from what it says.** Out of the box three
   things publish `trust: "owner"`: a Telegram account the owner paired in pine (or listed), the
   authenticated control API, and a schedule. Everything else is `untrusted`
   unless the configuration opts in (`trust` on a route or on a source). A source type may vouch
   for its sender (`owner` in its plan), which the owner is told before confirming. `audit()`
   reports the opt-ins on routes and on sources other than Telegram. A schedule acts in the
   owner's name, so one made from a tainted conversation is always put to the owner with its
   task (`add_schedule`). Time is the scheduler's business (`src/timers.ts`): there is no timer
   source, and nothing else should fire on a clock of its own. Children
   inherit the weaker trust (`AgentManager.submit`).
   A goal (`src/goals.ts`) calls an agent again in the owner's name too. Only the owner sets,
   resumes or clears one, through the control API; there is no tool for it, and a run started
   from outside has none. The task that continues the agent holds the owner's objective and
   fixed text of pine's (`continuePrompt`), never a word of the agent's answer or of the
   judge's reason: the answer may repeat outside content, and the judge has read it. No
   verdict pauses the goal; it never counts as "go on".
   A swarm (`src/swarm.ts`) calls an agent again in the owner's name in the same way: only the
   owner starts, pauses, resumes or clears one, through the control API, there is no tool for
   it, and a run started from outside has none. The task that calls the lead again holds the
   owner's job and fixed text of pine's with the numbers of tasks (`continuePrompts`), never a
   word of the lead's answer, of a sub-agent's result or of what a check found (the lead reads
   that from the board with `board_read`, which marks its run). What decides whether it is called
   again is the board (tasks that are not done, a check of the lead's answer that failed), never
   a model. The check pine posts (`checkTask`) holds the lead's answer, and what the owner said while the
   swarm worked with the lead's question beside it (`Swarm.told`): it is a task on the board
   with the mark of the lead's run (rule 14), which is how any task the lead writes reaches a
   sub-agent, and never a prompt in the owner's voice. pine starts the sub-agent for it itself
   (`startBoardTask` in `src/agents.ts`), on the model the owner set for it where they set one
   (`defaults.checker`, like the judge's `defaults.judge`): a sub-agent of that conversation under the lead's turn,
   with that turn's mark, the conversation's permissions and no way to ask the owner, whose run
   holds the task like a pool's. Nothing else is started that way.
4. **Untrusted runs get their capabilities by registration.** Tools and MCP servers that the
   untrusted profile does not list are not registered in that session at all, and the session
   key gets `~u` so history is never shared with the owner's session. The app control server
   is never registered for such a run, whatever the profile lists (`profileFor`). Where its
   profile gives it sub-agents, they are copies and nothing else: `model` and `thinking` of
   `subagent` are the owner's conversations' to give, and are not declared to such a run.
5. **Every tool call passes `tool_call` in `coreExtension()`, and has a class.** That is where
   deny patterns, the bash time limit, path checks, taint marking and approvals happen.
   `classify()` in `src/actions.ts` is the one place that says what a call is (look, local,
   reach, send, tell, own, critical, setup); the gate decides by class and mode. A new tool gets its
   class there, not a check of its own somewhere else: one that sends information out is
   added to the default `approveWhenTainted` list in `config.ts` (class `send`), one that only
   reads to `LOOK_TOOLS`. No model judges a call: pine has no reviewer, and
   none is to be added. What asks is the owner, and the list is short on purpose: a `critical`
   call in every conversation, a `send` call (and `subscribe`) after outside content, the
   owner's own `approve` list, and everything in manual mode. A `send` through a source whose
   type reaches the owner and nobody else (`toOwner`, Telegram) is class `tell`, not `send`:
   a message to the owner is not information leaving, and an agent that watches something
   has to be able to say what it saw with nobody there. Do not make `tell` ask outside manual
   mode and the `approve` list, and do not give `toOwner` to a type that can reach anybody else. "Always here" is offered wherever
   the same question would come again; for a critical call it is kept by the kind of action
   (`action.note`), not for the whole tool. Do not make `reach`, `local` or `own` ask outside
   manual mode. A sub-agent never waits for the owner: where anything would ask, a sub-agent's
   session is refused with `SUBAGENT_CANNOT_ASK` (`lone` in `coreExtension`, `profile.leaf` in
   `src/tools.ts`), and its conversation can ask. A new place that asks does the same. A
   sub-agent differs from its conversation in the model it runs on and how much it reasons
   (`TaskMeta.model`, `.thinking`; `modelOf`), and in nothing the gate looks at.
   A tool of the app control server has its class from `ctx.app`: looking is
   `look`, acting is `local`, so that a click is not asked about. What stands in for that is
   the owner's yes per app (rule 13); do not take one away without the other.
6. **Secrets stay in `.env`.** They are interpolated into the configuration and never exported to
   `process.env`; `shellEnv()` builds the environment for child processes from an allow-list.
   With the whole account it is the owner's own environment instead, without the daemon's
   variables and without anything whose name looks like a credential.
   Anything a source holds should be registered with `source.secret()` so it is redacted from
   events and logs. A secret an agent passes to `add_source` was typed into a conversation
   first: `SourceHost.add` redacts it from then on and scrubs it from stored events and tasks.
   The way that avoids this is the default: a tool leaves the secret out, the approval request
   lists it under `inputs`, and the owner's answer brings the value straight to the tool
   (`ApprovalDecision.values`, never in an event). A new tool that needs a secret does the same.
   A sign-in a source makes itself (`mail` with `signIn`: the owner signs in at Microsoft with
   a code, pine is handed something it renews at every connection) is not a value anybody typed, and it
   changes all the time: it is kept in the source's own storage (`source.kv`, pine's database
   in its home) and goes when the source is removed. It is sent to the address it is for and
   to no other: where that is, is fixed in the code (`oauth.authority` in
   `src/sources/mail.ts`, which only a test moves) and never an option of a source. What the
   owner is shown of such a sign-in (the page, the code) is checked to be what it claims;
   nothing else the sign-in server writes is shown, logged or put into a status line. Waiting
   for the owner never holds up the start of a source: at boot it would hold up pine.
   A remote MCP server's `headers` are its key. Besides the server's own calls they go with one
   thing: a `download` of an address that one of that server's tools returned in the same
   conversation, as it was returned (`noteLinks` and `keyFor` in `coreExtension`). Not with an
   address the agent wrote itself, not along a redirect, and not for a server that `taints`.
7. **A source that sends decides where to.** Telegram sends only to the owner's chat; MQTT
   publishes only to `publish` topics. That check is also what `toOwner` of a type rests on
   (rule 5): the type's own code refuses every other recipient, whatever a call names. Do not move those checks into routes, prompts or the
   `send` tool. There is one way to connect pine to something outside, in or out: a source
   type in `src/sources/` with a schema. Do not add a second mechanism beside it.
   A type that has to go and look uses `source.poll` and `source.changed`, never timers of its
   own: the first look reports nothing, an unchanged look does nothing, a failed look backs off
   and shows in the status. A status line is read by agents without the outside-content mark,
   so it never repeats outside text (`harmless()` in `watching.ts`). A type that runs a command
   uses `source.exec`, which is the sandbox of the agent the source belongs to, and for a
   command that keeps running `source.follow`, which is the same sandbox and is refused on
   Linux for the reason rule 12 gives (`Guard` protects nothing while a command runs on).
   A type that is told things (a listener, a held connection) bounds what it passes on: each
   event's text is cut (`clip`, `shown`), and how many a minute is capped (`capped`), so that
   a device that talks all day fills neither the event log nor a conversation.
   An address a type connects to is the one the owner confirmed: public unless it says by
   itself that it is local or `local` was set (`publicOnlyAgent` for fetch, `reachOptions` in
   `src/net.ts` for a socket), a redirect only on the same host, an address a device hands
   back never followed to another host (onvif), and a token only to the host it was given for.
   A type that listens on a port (ftp, smtp, syslog) receives and nothing else, and needs a
   password or a list of client addresses, or says in the owner's dialog that anyone on the
   network can write to it.
   A type that needs a program of its own (system) builds it from pine's source into the
   source's folder in pine's data, where no agent writes, and starts it by its path with
   fixed arguments. Where pine carries the program built (the Pine app: `src/prebuilt.ts`),
   it is the one beside the source in pine's own code, found by the source's hash, and no
   other place is looked in. Which program the daemon runs is never an option of a source: a test puts
   its stand-in into the module (`standIn` in `src/sources/system.ts`). The same holds for
   the system's own tools a type starts (`ping`, `stty`): an absolute path, a fixed list of
   arguments, and what comes from the options checked to be exactly what it claims.
   The `slack` type runs on Slack's SDK (`@slack/web-api`, `@slack/socket-mode`), and pine
   keeps what the SDK does not give: the Web API goes through a `fetch` of pine's own (the
   address guard, no redirect, the token only to the API host and `*.slack.com`, an upload
   form rebuilt because the SDK's does not survive undici's fetch), the SDK's own reconnect is
   off and `hold` reconnects (a failed reconnect of the SDK's is thrown where nothing catches
   it), rate limits are waited for by pine so that the wait ends with the source, and sockets
   are cut by pine when the source stops. Two SDK internals are relied on, the `ws_message`
   event and a throw from an `authenticated` listener: look at both when the SDK is upgraded,
   and run `test/chat.test.ts`, which fails without each of these.
   After a time without a connection the `slack` type asks for what was written meanwhile
   (`catchUp`): only where it listens, and every message it finds goes through `written()`,
   so the same filters and the same cap hold as for one it was told. What it could not look
   at is said in the `gap` event (`missing`), never left out: a new reason why something was
   not looked at goes there. The gap in the status line is fixed text and times.
   A source that can be asked (`reads` on the type, `onRead` in the source, the agent's
   `read_source`) decides what may be read as it decides where it sends: never more than it
   was set up to listen to, checked in the type's own code whatever the call names (slack:
   `listensTo`). `read_source` is class `look` and is not asked about, and what it returns
   always marks the conversation (`isTaintSource`): it is other people's words. It is
   registered only in the owner's own conversations, never for a run started from outside,
   and never for a sub-agent. A new type that can be read keeps all three.
   A type that reads what people write (mail, slack, matrix, discord) is a watcher: never
   `talks`, never `toOwner`, never `owner` in its plan. A sender line can be forged, and a
   channel reaches other people. What it sends goes only where the owner listed (`sendTo`).
   A new type is a program inside the daemon: `add_source_type` is the main agent's, refuses in
   a tainted conversation, asks the owner in every mode, and runs the copy pine took, not the
   agent's file. Keep all four.
8. **Web access never reaches the local network.** The `http` source does only for an address
   the owner confirmed as local; a public one goes through `publicOnlyAgent`. `mcp/web.ts` checks addresses when it
   connects; `mcp/browser.ts` sends all browser traffic through its guard proxy and withholds the
   Playwright tools in `ALWAYS_BLOCKED`. When Playwright MCP is upgraded, list its tools again
   and add anything that runs code in the server or reads local files.
   The browser has no window unless the owner's conversation asks for one (`browser_show`,
   `browser_hide` in `mcp/browser.ts`): the daemon says which sessions may (`window`, set where
   the server is registered, never for a run started from outside), and the guard proxy and
   the blocked tools are the same with a window as without.
   A proxy carries only what a browser asks it to carry. What a browser sends without asking
   (WebRTC's own UDP, QUIC, name lookups of its own) is switched off in the browser itself,
   for every way pine starts one (`NO_WAY_AROUND` in `mcp/browser.ts`). The `live:` test
   "reaches nothing nearby" in `test/browser.test.ts` listens on a UDP port for anything that
   gets out: run it (`npm run test:live`) when Playwright MCP is upgraded, since the switches
   are Chromium's and a new build can rename one.
   The Pine app on this computer has the agent's browser itself: while it runs, the browser of an
   owner's conversation is a set of tabs in the app's window (`desktop/electron/browser-host.ts`),
   each a `WebContentsView` with a session of its own, sandboxed, with no preload and no way to the
   app's page or its main process, laid over the panel beside the conversation. The owner uses the
   page itself there. The app says where it is with its heartbeat (`/browser/embedded`, `host`,
   only to this computer's pine), the daemon writes that into pine's data (`BrowserViews.host`,
   read by the browser servers of an owner's conversations with a door: `hostFile`, `room`), and
   `mcp/browser.ts` starts Playwright's server against it (`--cdp-endpoint`) instead of a Chromium
   of its own, and moves back to that one when the app is gone (`move`: the page is opened again,
   the logins go along when the browser that is left still answers). What Playwright talks to is a
   browser made of each tab's own debugger, behind a WebSocket on the loopback with a word: it
   reaches the tabs of the conversation the connection names and nothing else, never the app's own
   page, where the owner answers pine's questions. Never turn on Chromium's remote debugging port
   for the app instead. Every tab's session goes through the connecting server's guard proxy,
   loopback included (`<-loopback>`), what goes around a proxy is switched off for the whole app
   (`BROWSER_SWITCHES`, and each tab's WebRTC policy), a tab asks for no permission, keeps no
   download and goes to nothing but `http(s)` by itself, and the blocked tools are the same. Since
   the owner can act in that page at any time, every call of the agent's is guarded there as with
   a window (`guarded`). Elsewhere (the phone, the web client, another machine's pine, pine
   without the app) a UI that shows the browser gets it as pictures and hands back what the owner
   did in them. The browser stays the one the agent has: the same process, the same guard proxy,
   the same blocked tools, no window. `mcp/browser.ts` has a door for that (`startViewDoor`): a server on the loopback that
   answers only who says the word it wrote into a file in pine's data (`viewFile`, which
   `browserSession` hands to an owner's conversation and to nothing else: no run started from
   outside, no sub-agent). The daemon goes through it for the control API alone
   (`src/browser-view.ts`); no agent has a tool for it, and what the door says about a page (an
   address, a title) is handed on as one line of text each. What the owner did is checked piece
   by piece by the browser's server (`cleanOps`, `webAddress`) and goes into code of the server's
   own as values (`OWNER_HAND`), or, for a single click, a key and plain letters, to Playwright's
   own input tools as values: `browser_run_code_unsafe` and the tools that act at a place in
   the picture are used by the server for this and stay closed to the agent (`ALWAYS_BLOCKED`,
   `VISION_TOOLS`). Never put text from a page, an agent or the owner into that code as code,
   and never give the door a road that does more than look and act in the page. An address on
   this computer that the owner types there is allowed for the conversation by it
   (`browserOpen`: the control API is the owner); pine's control port is refused there too.
   Where that conversation's browser is not up, `browserOpen` brings its session up as a
   message of the owner's would, without a turn (`wakeBrowser`): only for a conversation there
   is, only as the owner's, and nothing else of the view starts anything. The addresses an
   agent opened are kept for that view (`visit`, kv `visited:`): only a navigation that ended
   well in an owner's conversation, so never one that was refused, as an address of the web
   without a name and password (`keptAddress`), and handed on as lines of text that only the
   owner's click opens.
   After the owner's hand was in the browser, the agent's next call is checked against what it
   last saw, as with a window (`shared`, `guarded`). While such a UI says it is there
   (`browserEmbedded`), the gate tells the browser's server before `browser_show`, which then
   opens no window.
   The `http` source with `render` looks at a page with the same browser, in a helper of its
   own (`mcp/render.ts`, started by `rendered` in `src/watching.ts`), behind the same guard
   proxy, loopback included, and with what goes around a proxy switched off (QUIC, WebRTC
   outside the proxy, the browser's own name lookups). It has no tools. Of a source's options
   it is handed an address, a selector and an attribute name, and those reach the page as
   values, never as script. A local address is opened only where it is local by its own name
   (`localTarget`), and then exactly that host and port, which the source writes into its own
   folder in pine's data; a name that needs a lookup is refused together with `render`, also
   with `local: true`, and so is pine's control port. A look counts only on the host that was
   confirmed (`sameSite`). The helper gets none of the daemon's environment, is read one
   bounded line from, and is gone with its browser when the look ends, whatever ends it
   (`sweep` for a helper that had to be killed outright). Never give it a token or a header:
   the browser would send it to every address the page loads from. It cannot go behind
   `helperArgv()`, which has no network: like the browser server, what contains it is
   Chromium's own sandbox and the proxy.
   The browser has one exception, and it is the owner's: when an agent itself opens an address
   that is local by its own name (`localTarget` in `src/net.ts`), the gate in `coreExtension`
   asks, and a yes allows that host and port for the conversation (`AgentManager.allowLocal`
   writes it into pine's home, where the guard reads it and no agent can write). Nothing a page
   reaches by itself is asked about, a run started from outside cannot ask, a name that needs a
   lookup cannot be allowed, and pine's control port is refused without a question.
9. **The terminal UI shows where a link goes.** Markdown is rendered with hyperlinks off, so a
   link's target is printed next to its text, and `Linked` makes only printed `http(s)`
   addresses clickable. Do not render agent output in a way that hides a link's target.
10. **The terminal UI is only a client.** It uses the control API like the CLI; it must not reach
   into the daemon, so that attached and embedded modes behave the same. What the main agent
   changes about a conversation reaches it as an event (`pine/conversation`, a topic only pine
   publishes on), and its tabs follow (`followed`): a tab opened that way never takes the place
   of the one the owner is in. The same event says that the owner gave a conversation another
   folder or a worktree in another UI (`folder`, from `setFolder` in `src/agents.ts`). It names
   the conversation and nothing else; where it works now, each UI asks the control API.
   The desktop app (`desktop/`) is a client in the same way, and a stricter one: it does not
   load pine's code and reads none of pine's files, the token included. It asks `pine service`
   (`src/service.ts`) for a daemon and is told where it answers; from then on it uses the
   control API. Whatever a settings page changes, the daemon changes, in `src/owner.ts`, with
   the check and apply functions the main agent's tools use: do not give the app a way to
   write a configuration file, and do not write a second check for the owner's hand. What the
   app's page draws is content from outside (an answer can repeat a web page), so the page
   holds no token and has no Node: `desktop/electron/main.ts` makes every call for it, takes
   calls from the app's own page only, serves nothing but pictures, video and sound straight
   from the daemon (`MEDIA`; where the page of an agent's browser is a picture, it is drawn by
   `desktop/src/Browser.tsx` and never loaded into the app's page: the app's own browser is a view
   of its own laid over it, rule 8), opens only `http(s)` addresses and only in the owner's browser,
   and sets the policy that lets the page load nothing from the web. Text from an agent or a
   tool is drawn by `desktop/src/markdown.tsx` (parsed, cleaned, links with their address
   beside them, a picture on the web as a line to click) or as plain text, nowhere as HTML.
   It renders with Streamdown, whose defaults are not safe here, and replaces three of them:
   its cleaning rules (`CLEAN`), its link component and its image component. On every upgrade
   of Streamdown read its defaults again and run `npm run desktop:test`.
   `desktop/test/app.test.ts` has a test for it; keep it failing without each of the three.
   A view of the owner's (<home>/views, `src/views.ts`, docs/references/views.md) is the one script
   the page runs that is not the app's, and it runs in the page's one frame (`desktop/view.html`,
   `desktop/src/view-frame.ts`): sandboxed with `allow-scripts` and nothing else, so its origin is
   nobody's, under a policy of its own that allows no address (`VIEW_CSP` in `desktop/electron/daemon.ts`;
   the page's own policy allows that frame and no other). It is handed the state that
   `desktop/src/view-state.ts` builds anew from an allow-list (names, modes, states, tool names: never a
   prompt, an answer, a path, a tool's arguments, an event's text), and what it asks the panel to show or
   open is checked against what the panel knows (`knownTarget`). Never add `allow-same-origin` or another
   permission to the frame, never hand it the bridge, the token or text, and never let it import more
   than `pine/view`. `desktop/test/view-app.test.ts` has a view that tries to reach the bridge, the top
   window, storage and an address on this computer, and looks for a word from a prompt and a path; it
   fails without the sandbox. Only the desktop app's bridge says it can run a view (`AppState.views`);
   the mobile app and the web client build no frame and show no view.
   The terminal beside a conversation (`desktop/electron/terminal.ts`) is the owner's own shell,
   run by the main process; the page only types into it. What an answer holds reaches it only by
   the owner's press on a code block's Run button, and only a block whose every character shows
   as itself (`desktop/src/runnable.ts`): nothing types into it by itself, and the preview has none.
   How such a block went goes back to the conversation (`POST /agents/<id>/terminal`,
   `terminalNotice` in `src/background.ts`) as a `notify` task in pine's words with the output
   quoted, like a background command's end: only for blocks run with the button, never what the
   owner typed, and the agent never waits for it.
   The page in an ordinary browser (`npm run dev:preview` in `desktop/`, a development tool and
   no part of the app) is held to the same: Vite's server (`desktop/scripts/preview.ts`) stands
   where `main.ts` stands, holds the token and makes every call through the same module
   (`desktop/electron/daemon.ts`), only for a POST of JSON from the page's own loopback origin,
   and sends the same policy. The page's stand-in for the bridge (`desktop/src/preview-bridge.ts`)
   exists only in that dev mode and in no build; `desktop/test/preview.test.ts` fails without
   the check of the origin and the content type, and when the stand-in reaches a build.
   The mobile app (`mobile/`) is another holder of the token, beside `main.ts` and the preview's
   server, and is held to the same: its
   native plugin (`mobile/android/.../PinePlugin.kt` on `mobile/core` on Android,
   `mobile/ios/App/App/PinePlugin.swift` on `mobile/ios-core` on iOS) plays `main.ts`'s part.
   It makes every call for the page through a channel of its SSH connection (no port on the
   phone, where any app could reach it), serves the page only pictures, video and sound under
   `MEDIA`'s rules (`mobile/core/.../Media.kt`), opens only `http(s)` addresses outside, lets
   the page navigate nowhere, open no window and have no permission, and the page there carries
   the same policy. The mobile bridge gives the page these things the preload does not, and
   only these: `local: false` in `state()` (no machine of its own), `mediaBase` (the address
   the plugin answers media at), `deviceKey` (the phone's public SSH key), `trustHostKey` (the
   owner's press on "Trust this key", for the fingerprint shown), and for pairing (below)
   `canPair` in `state()`, `pair`, `stopPairing`, `onPairLink` and `names` in the stored
   preferences. Those hand text and nothing more: `onPairLink` passes on a link the system
   opened the app with and starts nothing, `pair` is called only after the owner confirmed the
   link in the page and the plugin reads it again before it uses the code, `stopPairing` ends
   the pairing that is open, and `names` are the names paired computers gave, for the page to
   show. The token and the phone's key never reach the page on any of them. A host key is
   trusted only as the owner confirmed it in the page, exactly the fingerprint shown, and a
   changed one is refused. `mobile/test/build.test.ts` fails when a build carries the other's
   stand-in. What the WebView is kept from (permissions, `onCreateWindow`, a second window, file
   access, navigation) no suite of `npm test` reaches: `npm run smoke` in `mobile/` proves each
   as a named check, and is run before a release that changes `mobile/` or upgrades Capacitor.
   On iOS the same holds with WebKit's names: `PineViewController.swift` wraps Capacitor's UI
   delegate (camera, microphone and motion refused, `createWebViewWith` gives nothing and hands
   only `http(s)` to Safari) and turns link previews and, in a release build, the inspector off;
   `PinePlugin.swift`'s `shouldOverrideLoad` cancels every navigation off `capacitor://localhost`;
   media come only through the `pine-media:` scheme under the same rules (`MediaScheme.swift`
   on the core's `mediaRequest`), the one media origin of the iOS page's policy. The phone's key
   is kept in the Keychain on this device only. `npm run smoke:ios` proves each as a named check.
   The mobile app also pairs with the Pine app's access host (browser access, below), and the
   same holds on that path. The data channel lives in the native plugin's core, never in the
   WebView (`Peer.kt` behind `WebRtc`, Google's libwebrtc in `LibWebRtc.kt` on Android;
   `Peer.swift` on libdatachannel on iOS), and only SSH runs over it, end to end; the token and
   the phone's key stay native, and the phone signs in with the key it already has. A pairing
   link, whether pasted, opened as an App Link (`https://pine-main.drcmda.workers.dev/` only, for the
   release-signed APK, once the relay serves the statement) or as a `pine:` address
   (`pine://pair?service=&id=&code=`, exactly those three), is handed to the page as text, read
   by one parser on every side (`readPairLink` in `desktop/src/machines.ts`, `pairLink` in
   `Paired.kt` and `Paired.swift`, all three replaying `mobile/cases/pair-links.json`), and starts
   nothing until the owner's yes in the page; a service that is not Pine's own is named in that
   question. The service is `https` and nothing else, checked before anything is reached
   (`meetingService` in `Peer.kt`, `openPeer` in `Peer.swift`): the tests reach the access host's
   `http` service through a route that only a test's constructor can pass, and a smoke run's TLS
   front through an authority that only a debug build (Android's `debug-overrides`) or the smoke's
   own simulator trusts. The computer's host key must be the link's machine id during key
   exchange, before the phone's key is offered, and a paired computer is refused for good when it
   presents another. The app has no scanner and asks for no camera on either system; on Android
   the manifest asks for `INTERNET` and `ACCESS_NETWORK_STATE` (libwebrtc aborts without it) and
   nothing else, and has the one App Link filter (`mobile/test/config.test.ts`). The cores' suites
   prove pairing, refusals (another host key, a changed key, an `http` service, a malformed
   link) and removal against the real access host on the JVM and the Mac; the smoke runs prove
   it in the real apps, with every hardening check above unchanged.
   The web client (`web/`) is the fourth holder of the token, beside `main.ts`, the preview's
   server and the mobile app's native plugin, and is held to the same: its web bridge (`web/src/host.ts`) plays `main.ts`'s
   part as the top-level document, and the page runs in an iframe sandboxed with scripts only,
   under an opaque origin, so that what it draws reaches neither the bridge's IndexedDB, nor the
   browser's key, nor the token. The bridge answers messages from that iframe's window alone,
   only a method of the fixed list (`web/src/protocol.ts`), with its arguments checked one by one
   as `main.ts` checks its IPC; never add `allow-same-origin`, or any other permission, to the
   iframe. The browser's key is made non-extractable by WebCrypto and only its public half is ever
   exported. A host key is trusted only as the owner confirmed it in the page, exactly the
   fingerprint shown, before the key is offered, and a changed one is refused. The daemon is
   reached through a direct-tcpip channel to the server's loopback and nowhere else, media come to
   the page as bytes under `MEDIA`'s rules, and only `http(s)` addresses are opened, in a new tab
   with `noopener`. The page carries the desktop page's policy and loads nothing from the web. The
   relay (`web/relay`) sees neither key nor token: it carries SSH and nothing else, to public
   addresses only, capped per client address, and keeps and logs nothing. To a Tailscale Funnel
   name (`.ts.net`, on Funnel's ports alone) it connects by that name through TLS, the
   certificate checked for it, after the name's addresses passed the same check. Its one way to the
   loopback, `RELAY_ALLOW_LOOPBACK`, is the smoke's, given to `wrangler dev` on its command line;
   `web/relay/test/loopback.test.ts` fails when a configuration that is deployed sets it. What no
   suite of `npm test` reaches (the opaque origin, a message from another window, the token kept
   from the page, a frame that navigates itself making the whole client start anew) `npm run smoke` in `web/` proves as named checks.
   Browser access (`desktop/electron/access/`, `docs/adr/0004-browser-access.md`) lets a browser,
   or the mobile app, paired at the computer that runs the Pine app reach that app's own pine, peer to peer
   (the mobile app's side of it is the end of the mobile app's part above). The access server in the app's
   main process is an SSH server with two permissions and no third: it answers the exact string of
   `remoteCommand()` (compared, never run) with the service line of this computer's own daemon (its
   token included, handed to a client that signed in, as `sshd` would hand it), and
   opens direct-tcpip channels to exactly that line's loopback host and port. Every other request
   (a shell, a pty, a subsystem, another command, another destination, a password,
   keyboard-interactive) is refused, it accepts only Ed25519 keys paired at that computer, at most 8
   connections at a time and 20 seconds to authenticate; do not widen it without a test that
   shows why it is still safe. A key is paired only by the owner's Allow at the computer, after a
   one-time code from the QR code (compared in constant time, consumed on first use) and four
   digits shown on both sides; refused or expired, nothing is stored, and a removed device's
   sessions are cut at once. The host key is kept encrypted with the keychain (Electron's safe
   storage), and a device's name is plain text of 60 characters at most. A relay (TURN) server the
   owner names in the app is the computer's alone, beside the service's STUN servers (a TURN entry
   from the service is dropped): its password is kept like the host key, in that encrypted file and
   never in `prefs.json`, and never reaches the page (which is told only that one is kept), a log,
   a status line or an error text. The pairing link
   (`#pair=<machine id>.<code>`, in the fragment, which no server sees) is the second way a host
   key is trusted in the web client, beside the owner's press on "Trust this key": the machine id
   is the fingerprint of that computer's host key, accepted once, for the machine that link names alone,
   never over a key kept for it already; the bridge takes it out of the address before anything
   else (`takePairLink`). The data channel lives in the web bridge, never in the page's iframe,
   and carries SSH end to end. On an iPhone or iPad the bridge asks, before it uses the code,
   whether the Pine app or this browser pairs (`web/src/app-choice.ts`, drawn by the bridge's
   document over the iframe); "Open in the Pine app" opens the `pine:` address and uses nothing.
   The relay serves `/.well-known/assetlinks.json` only when `ANDROID_CERT_SHA256` is one
   SHA-256 fingerprint, for the package `dev.pmndre.pine` alone (`web/relay/src/site.ts`). The Worker carries SSH for the relay (while `RELAY` is on: on in
   the configuration of `wrangler.jsonc`, so on every channel's deployment, the official service included, where it is open to
   anyone, capped per client address, SSH only and public addresses only; the page names it in the
   SSH view, `relayLine` in `desktop/src/machines.ts`, so that the owner knows it is there) and, for meetings, small opaque messages (`web/relay/src/meet.ts`: at
   most 64 of 16 KiB each, for 30 seconds), and keeps no storage: a computer waits under a machine id
   only after it signed the service's challenge with that key, and the Durable Object's state is
   its open sockets. The smoke proves pairing from end to end, and that the page's policy and its
   iframe's sandbox are unchanged on that path.
11. **Only the owner opens a folder for a conversation, and looking at one runs nothing.**
   `setFolder` in `src/agents.ts` is reached from the control API only; there is no tool for it.
   It refuses pine's home, pine's code and other agents' workspaces in either direction, and a
   run started by outside content does not get the folder. A task one agent hands to another
   (`delegate`, without a thread) is done in the conversation's folder for that one run
   (`TaskMeta.folder`); a conversation the other agent keeps never gets it that way. `src/workspace-view.ts` serves the
   code pane: every path is resolved and must stay inside the folder, and `git` runs behind
   `helperArgv()` without write access or network and with everything a repository's
   configuration could make it start turned off. Keep new git calls on that `git()` helper.
   A worktree (`src/worktrees.ts`) is a folder of the same kind: only the owner makes, merges,
   updates and discards one, through the control API (`makeWorktree` and the others in
   `src/agents.ts`); a sub-agent's or a delegated task's (`worktree` of `subagent` and
   `delegate`) is made from the folder the owner opened for its conversation. What a run in a
   worktree may touch of the repository's shared git folder comes from pine's record of it
   (`gitRights`, `Roots.fixed`), never from a file in the worktree, and goes into both sandboxes.
   pine's git calls for it run behind `helperArgv()` and replace every filter and merge driver
   the repository names (`neutral`): its configuration is one an agent may have written.
   Undo is the owner's in the same way (`AgentManager.undo` and `.redo`, `src/undo.ts`): the
   control API only, no tool, and only a message the owner typed is taken back
   (`ownerMessage`), never a run that outside content started. It is the one place where the
   daemon's side writes a folder. `src/snapshots.ts` records the folder as git trees in a git
   directory under `data/snapshots`, which no agent can write, and restores through the same
   `git()` helper with `write` naming that directory and the folder: the sandbox keeps it
   inside, not a path check. That git reads neither the folder's settings nor the owner's
   (`GIT_CONFIG_GLOBAL`), and its `info/attributes` turns off filters and text conversion. A
   restore sets only paths that two recorded trees differ in, through git, which does not
   write through a link. Taking a message back puts the conversation's outside-content mark
   and what the owner allowed it (`setRights`) back to what they were before that message,
   never to more.
   An editor in a UI saves a file of a conversation's folder through the control API
   (`POST /agents/<id>/view/write`, `writeText` in `src/workspace-view.ts`): the owner's own
   hand, no tool. The folder is one an agent writes in, so a path there is never taken at its
   word. The bytes are put into place by `putInto`, a helper behind `helperArgv([folder])`
   that writes a new file beside the target and moves it over it: the sandbox keeps the write
   inside the folder whatever a path has become, and a link or a second name of a file
   elsewhere is never written through. Without a sandbox it writes nothing. Do not write there
   with `fs`, and do not add a second place that writes a folder for a UI.

12. **What an agent left running is found by the daemon, not reported by the agent.** Every
   shell command notes its process group before its sandbox starts (`Programs.note`, fixed
   text that runs with the daemon's rights: nothing an agent wrote goes into it), in a file in
   pine's home that no agent can write. A program is one of a conversation's when its group is
   on that conversation's list and the shell that led the group is gone. `stop` ends only such
   a group, for the control API and for the agent's `stop_program` alike: never a process id
   somebody names.
   A command the agent puts into the background (`background` on the shell tool) is started by
   the daemon itself (`Programs.start`): the shell that waits for it is fixed text (`WATCH`),
   the agent's command is one argument of the shell inside the conversation's sandbox, and the
   group is noted from what the system said at the start. While that shell lives the command
   counts as running, and it is known by its command line, which names the record pine keeps
   in its home. Its output is the agent's file: the daemon reads the end of it through the
   agent's sandbox (`tailOf` in `src/background.ts`) and hands it to the conversation as
   quoted output inside a message of pine's own (`endedNotice`), in a `notify` task, which is
   never taken for the owner's words. A run started from outside has no `background`
   (the gate refuses it), and on Linux neither has a conversation that read outside content:
   what `Guard` takes away after a command protects nothing while a command runs on.

13. **App control acts in the app that was named, and the owner said yes to that app.** The
   gate asks once per app in a conversation, by the name in the call (`appTarget` in
   `src/computer.ts`; the yes is kept in `AgentManager.grants`, like a local address of the
   browser). `mcp/computer.ts` makes the name true: a reference has to belong to that app, a
   position has to lie in one of its windows (`landsIn`), keys are sent to its process alone. It never
   clicks, types or presses in the app pine itself runs in, nor in the Pine app wherever it runs
   (`answersHere`: the helper's `host`, or the Pine app's bundle id, `PINE_APP`, which the copy of
   Electron a checkout starts carries too), where the owner answers pine's questions. That is
   pine's own place, not a list of forbidden apps: there is none, on purpose, and none is to be added. The helper only
   does what it is told; a check that decides who may do what belongs in `computer.ts`, where
   the tests reach it with a stand-in for the helper. Windows and Linux cannot send keys to a
   process: there the helper checks, right before each key, that the named app is in front, and
   before each click that the window under the point is that app's, and stops otherwise
   (`mcp/computer.cs`, `mcp/computer-linux.py`). Where there is no desktop it can act in (Linux
   under Wayland or without a display, any other system) the server is not registered, and
   started by hand it offers nothing and says so.

14. **A board is no way around the outside-content mark, and nothing on it stays taken.** A post
   (`src/boards.ts`) carries the trust and the mark of the run that wrote it, a result that of the
   run that settled it, and whatever shows a post to a run marks that run (`shown` in
   `src/tools.ts`): `board_read`, the notes at the end of the other board tools' answers, the
   answer of a pool, and a sub-agent the pool starts for a task that such a run posted, or with such
   a run's note or result (the notes for all, and what came of the tasks its own waited for, go
   with its task; and the note with which a failed check gives its work out again, `Boards.rework`,
   which carries the mark of the check's run). A new place that hands board text to a model goes through `shown`. An event of a board
   (`boardChanged` in `src/agents.ts`, on `board/<name>/...`, a reserved topic) has the trust of
   what was written, never more. The board tools are registered where `Profile.board` says so:
   in the owner's conversations, and for a run from outside only where its agent's `untrusted`
   profile opts in; such a run makes no board beyond its own conversation, and neither does a
   sub-agent. A task is held by a run of pine's, never by an agent's word: `boardsAfter` settles
   or gives back what a run still holds when it ends, and `init` gives back everything after a
   restart. Do not add a claim that outlives its run, and do not let a tool settle a task for
   another run. Two things are no exception to that, since they touch nobody's claim: the owner's
   hand through the control API, and the conversation that gave out the work closing a task of
   its own board that no run holds (a question it can settle itself: `board_done`). A question on a
   board is answered by whoever gave out the work, never by a sub-agent (`board_answer` refuses
   one): workers of equal standing do not steer each other. A pool's sub-agents may outlive the
   call that started them (it comes back when one asks) and the turn, but not their conversation:
   `stopPool` ends them when it is stopped. A board holds
   text and opens no file; whatever is kept by agent or by conversation goes with it
   (`dropConversation`, `dropAgent` from `eraseAgent`, the renames). A UI is told on `pine/board`
   which board changed and which post, by its number and how a task stands, never a word of what
   is on it; and a view of the owner's is told numbers, states, times, a board's name and who posted
   a task (an agent's name or "you") and nothing else (`boards` in `desktop/src/view-state.ts`, from the
   task list without texts that `boardBrief` makes). What a task says is shown by the panel under the
   view when the view names a board and a task by their numbers (`knownTarget`, `BoardDetail` in
   `desktop/src/View.tsx`): the app reads it from pine and draws it as text, and the view is told none of it. `test/boards.test.ts` and
   `desktop/test/view-state.test.ts` fail without each of these.

## pi behaviours pine depends on

The baseline suite found these; each has a mitigation in the code. Re-check them when you
upgrade pi (`npm run baseline`, then `npm test`).

| pi behaviour | Where pine handles it |
|---|---|
| SDK sessions trust the project by default | `SettingsManager.create(..., { projectTrusted: agent.trustWorkspace })` in `agents.ts` |
| A stream that goes silent after its headers hangs | `installModelTimeouts()` in `pine.ts` |
| `session.dispose()` leaves MCP servers running | sessions are `AgentSessionRuntime`s; `dispose()` goes through the runtime |
| `mcp.json` is read from the global agent dir | `pi.registerMcpServer()` per session; `PI_CODING_AGENT_DIR` points into `data/pi`; `createMcpExtension({ loadConfig })` returns nothing, so no file there can add a server. `pine mcp login` writes a temporary `mcp.json` there for pi's CLI |
| Sessions default to the global agent dir | explicit `sessionDir` under `agents/<id>/sessions/` |
| bash has no default timeout | the gate caps `input.timeout` at `bashTimeoutSec` |
| bash ends a command at its timeout (`killProcessTree` in its `exec`) and cannot let go of one that is running: it owns the process and the pipes its output comes through | a command for the background never goes through pi's tool: `Programs.start` runs it, and the timeout message tells the agent to start it that way (`TIMEOUT_HINT`) |
| `AGENTS.md` is read once, and `session.reload()` to read it again starts every extension anew, which stops the session's MCP servers (the browser the owner sees among them) | in the owner's conversations `steady()` reads the files itself at every request and `refresh()` does not reload; a run started from outside is reloaded when a file's mtime changed |
| pi looks for instruction files in the working folder and the folders above it | `agentsFilesOverride` ignores what pi found and hands it `instructionFiles()`: the owner's `agents/<id>/AGENTS.md`, the agent's own `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `MEMORY.md` (`WORKSPACE_FILES` in `src/config.ts`) and the home's `AGENTS.md`, `TOOLS.md` and `USER.md` (`SHARED_FILES`) |
| `prompt()` resolves on model failure | `execute()` inspects the last assistant message |
| A session opened from its file stands at the last entry written; `branch()` moves it in memory only | `rewind()` in `undo.ts` works on the closed session and appends an entry of pine's own (`pine-undo`, no message) at the place it went back to |
| Skills and `AGENTS.md` are discovered in the user's home and above the workspace | `skillsOverride` / `agentsFilesOverride` keep only configured locations |
| `tools: [...]` is a strict allow-list that hides extension tools | `excludeTools` for built-ins instead |
| The default system prompt describes a coding assistant inside pi and points at pi's manuals | `systemPromptOverride` supplies `BASE_PROMPT`; `docs/` is searched by every agent with the `manual` tool |
| pi's choice of model for each provider (`defaultModelPerProvider`) is not exported | `piDefaults()` in `src/models.ts` reads it from pi's `core/model-resolver.js`; when that fails, `suggestModel` takes the provider's first model. `test/hatch.test.ts` signs in to a provider and checks that one of its models is taken |

## Releases

Work goes to `next`, the repository's default branch, and `main` is what was released. Every
push to `next` is a preview of the release it leads up to, and every push to `main` a release.
A release's version follows from the commit messages since the last one
(`scripts/version.mjs`, tested in `test/release.test.ts`):

| A commit since the last release | Raises |
|---|---|
| has `BREAKING CHANGE` in its message, or `!` before the colon of its subject (`feat!: ...`) | the major number (the minor one while pine is below 1.0.0) |
| has a subject that starts with `feat:` or `feat(scope):` | the minor number |
| anything else | the patch number |

So an ordinary push is a patch release, and the subject line is how you say that it is more.
The subject line is also what an owner reads after `pine update` ("What changed since ..."):
the package carries the subjects of its last releases (`scripts/changes.mjs` writes
`changes.json` when it is built). Write it as a sentence that says what is different for them.
To pick a version by hand, set it in `package.json`: it is used as it is while it is ahead of
what the commits call for. A commit message that contains `[skip release]` publishes nothing.

A push to `next` is published as `<the release it would be>-next.<N>` under npm's tag `next`
(`previewOf`), and as a pre-release on GitHub: `npm install -g @pmndre/pine` never gets one,
and a pine that is a preview follows that tag (`pine update`). To release what was tried,
move `main` forward to `next`:

```bash
git push origin next:main
```

Always forward and never with a merge commit: what a release changed is read from `main`'s
own line of commits (`git log --first-parent` in `scripts/build.mjs`), and a merge commit
there would stand in for all the commits it brought.

A release from `main` also gets the Pine app, attached to its GitHub release as a disk image
for each kind of Mac, with what the app updates itself from: the app zipped after notarisation
(`Pine-<version>-<arch>.zip`) and its Squirrel.Mac feed (`Pine-<arch>.json`, made by
`desktop/scripts/update-feed.ts`, tested in `desktop/test/update-feed.test.ts`). The job `app` in
`release.yml`: `desktop/scripts/pack.mjs --dmg`, then Apple's own check of the signed app, then the upload. The job does not start the app:
`smoke.mjs` drives its window, and a test that drives the window does not belong in a release,
where a renamed part of the page holds back the disk images of an app that runs. Run it on a
Mac of your own before a release that changed how the app is packed or its page is built
(the commands above). Signing and notarising
take five secrets in an environment `release`, which the top of `release.yml` lists; without
them the job builds nothing and says so. An app that is not signed and notarised is never
uploaded. npm does not wait for the app: a release has no disk images for the minutes Apple
takes. The app of a release can be built again by hand, without publishing anything
(`gh workflow run release.yml -f version=0.38.0`, from `main`): from that release's tag, with
the workflow as it is on `main` now, which is the way to repair a release whose `app` job
failed. The helpers need the macOS 26 SDK, so the job selects the newest Xcode on the runner.

A release from `main` gets the Pine app for Linux (`app-linux`: an AppImage and a deb for x64 and
arm64, started under a virtual screen, with checksums and GitHub's attestation) and for Windows
(`app-windows` packs and starts each, `app-windows-sign` has both folders and then both installers
signed through SignPath Foundation: two approvals a release at signpath.io; four secrets in the
environment `release`, listed above the job; without them the installers go out unsigned). Only pine's own
programs are signed (`desktop/signpath/`, whose README says how it is set up), and each has to say
"Pine" and the release's version: the `pack` job of `test.yml` checks that on Windows. The signing
is tried from any branch without a release (`gh workflow run release.yml --ref <branch> -f
version=0.0.1 -f signing_trial=true`): only the two Windows jobs, with the environment
`signing-trial` and SignPath's test certificate, the installers an artifact of the run. The Windows
app talks to pine in WSL as to another machine (`desktop/electron/wsl.ts`), and no runner of
GitHub's has WSL: `desktop/test/wsl.test.ts` tests it on a stand-in, and a real round trip is by
hand on a Windows computer.

A release from `main` gets the Android app too (the job `android` in `release.yml`, on the
same skeleton as `app`, on Linux): `npm run apk:release` in `mobile/`, signed with the release
key, `versionName` the release's version and `versionCode` major·1 000 000 + minor·1 000 +
patch (`mobile/scripts/version-code.ts`, tested in `mobile/test/version.test.ts`), checked with
`apksigner verify`, uploaded as `Pine-<version>.apk`. The key takes four secrets in the
environment `release`: `ANDROID_KEYSTORE` (the keystore file, as base64), `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. Without any of them the job builds nothing and
says so; with only some it fails. The keystore file is removed whatever happens, and none is
ever committed. Keep that key: Android installs an update only over an app signed with the
same one. The release APK packs its native libraries (Google's libwebrtc) for arm64-v8a and
armeabi-v7a alone, stripped by the NDK `mobile/android/variables.gradle` pins, and the job fails
when one still carries `.debug_info`. Before the APK is built the job runs `npm run check` and `npm test` in `mobile/`. The
smoke test is not run there (`npm run smoke`, on a computer of your own, with an emulator).

A release from `main` does not get the iOS app for now: the job that built it was taken out of
`release.yml` because the core's `swift test` did not pass on GitHub's `xcode-27` preview image.
The IPA is made by hand on a Mac (`npm run ipa -- <version>` in `mobile/`): not signed,
`Pine-<version>.ipa`, which whoever installs it signs with their own Apple ID (AltStore,
Sideloadly; docs/adr/0002-ios-app.md). Nothing about Apple signing is ever stored in the
repository or its secrets. Run `npm run check` and `npm test` in `mobile/` and `swift test` in
`mobile/ios-core/` before building it. `scripts/ipa.ts` archives for devices with code signing
off and the packages at their committed versions (`-onlyUsePackageVersionsFromResolvedFile`:
swift-collections is held where it compiles on Xcode 27), sets `CFBundleShortVersionString` to
the version and `CFBundleVersion` to Android's versionCode, and fails unless nothing inside the
IPA is signed (the vendor's signature on the embedded `OpenSSL.framework`, which libdatachannel
needs, is taken off), the app binary is arm64, and libdatachannel and OpenSSL are inside. The
smoke test is `npm run smoke:ios`, on a Mac of your own.

Publishing needs no stored secret: on npmjs.com the package names this repository and
`release.yml` as a trusted publisher. A repository secret `NPM_TOKEN` is used instead if one exists.

## Tests

- Every test builds its own home in a temp folder with `harness()` and talks to the scripted
  model server from `baseline/tests/mock.mjs`. A prompt containing `<<MOCK {"steps":[...]}>>`
  scripts the model's next replies; `@@REF:name@@` refers to `mock.state.scripts[name]` (use it
  for child agents). Without a directive the model echoes.
- Do not put `>>` inside a directive (use `tee` instead of `>>` in shell commands); the directive
  ends at the first `>>`.
- Keep tests fast: no sleeps above a few hundred milliseconds, no network, no real model. Time
  limits accept fractions (`taskTimeoutSec: 0.25`).
- Where steps of several scripted runs have to come in an order, say so with `until` on a step
  (a function: the mock answers the step when it returns true), not with `delayMs`: a delay that
  is long enough on an idle machine is not on a busy one, and test files run side by side.
- Test files run in parallel. Use port 0 and temp folders; never a fixed port or a shared path.
- UI tests type, click (`term.click(x, y)`) and drop files (`term.paste(path)`) on `FakeTerminal`
  and assert on `app.screen()`. Send keys one at a time
  (`term.type("text")` does) and wait with `sees()`, not with sleeps.
- `pine init` downloads the browser. A test that runs it sets `PINE_SKIP_DOWNLOADS=1` (see
  `test/cli.test.ts`); the variable exists for tests only and is not a user option.
- `npm test` passes `--test-force-exit`, so a leaked handle cannot hang the run; a test that
  fails must still not leave a daemon behind (see the `after` hooks in `test/support/harness.ts`).
- The source types are tested on stand-ins that run on any system and need no network: a web
  server whose answers the test changes (`test/watch.test.ts`, `test/feeds.test.ts`), a
  WebSocket server written by hand (`test/support/ws.ts`), scripted IMAP, SMTP, Modbus and
  camera servers on a loopback port, hand-made DNS packets, and for `system` a script in place
  of its helper (`standIn`). A source in a test's configuration may look more often than a
  model is allowed to set (`every: "40ms"`): the limit is in `plan()`, which a configuration
  file does not pass through. The `live:` test in `test/system.test.ts` builds the real helper.
- App control is tested on a stand-in for its helper (`FAKE_HELPER` in `test/computer.test.ts`),
  a script that speaks the helper's protocol and runs on any system; the server's `helper`
  option names it. No test in the ordinary suite touches a real app or needs macOS. The `live:`
  tests build the real helper and drive its own demo window (`--demo`), which needs no grant.
- Voice input is tested on a stand-in for its helper (`standIn` in `test/voice.test.ts`), a
  script that writes the helper's lines and runs on any system; the `voice` option of the UI
  names it. What is not macOS is tested by handing the UI `voiceTools("linux")`. Only the
  `live:` test builds the real helper, and it reads a recording, not the microphone.
- A model call pine makes itself, without tools (the judge of goal mode), is scripted with the
  mock's `withoutTools` option: see `judged()` in `test/goals.test.ts`.
- A swarm's lead is scripted by round: its job names a script (`@@REF:lead@@`) whose steps a getter
  picks by the round the swarm is in, and the check pine posts, which quotes the job and so finds
  the same script, is told apart by how its task begins: see `swarm()` in `test/swarm.test.ts`. The
  same way a check and the work it checks are told apart in `test/boards.test.ts` (the check's
  own words name a script of their own, which comes first in its task).
- pine's own question for what a call needs outside the sandbox (`security.askAccess`) is off in
  `harness()`, so that a test about the sandbox meets the sandbox and not a question. The tests
  about it (`test/access.test.ts`) turn it on, set `HOME` to a folder of their own for "the
  owner's files", and say what "the system reports" through a stand-in for the log (`standIn`).
- What pine does with a llama.cpp server (slots, filling idle ones, files for conversations that left their
  slot) is tested on the mock: `props` is what the server says about itself at `/props`, a request that
  is not streamed is answered in one piece, and with `slotFiles` it writes and reads slot files
  (`state.slotActions`). The `live:` test at the end of `test/live.test.ts` asserts the same on a real
  server (`PINE_LIVE_URL`), by the tokens the server says it read and kept.
- The desktop app has its own tests in `desktop/test/`, run by `npm run desktop:test` and not
  by `npm test`: they start the real app (Electron, driven by Playwright through its window)
  on a temp home with the mock model server, and a daemon of its own on port 0, so a pine the
  developer has running is left alone. They start the build of the run (`launchApp` in
  `desktop/test/support/app.ts`), never `desktop/dist`. `launchApp` starts the app without a
  screen (`PINE_DESKTOP_HEADLESS`, for tests only: `electron/main.ts` makes the window and never
  shows it, and the page goes on drawing as in a window in front), so a run can be left alone
  on a computer that is being used, and nothing the owner does there reaches a test. It also
  notes what the app would do in the owner's own session instead of doing it (`quiet`: a
  notification, the clipboard, an address opened in the browser, a file shown in the Finder,
  open at login, a dialog of the system's), in `globalThis.quiet` of the main process; a test
  about one of them replaces it again. A new thing the main process does outside its window
  goes into `quiet`. Start the app only with `launchApp`. The runner (`desktop/scripts/test.mjs`)
  gives a run a temp folder of its own (`TMPDIR`), ends what a test left running and removes
  the folder, and runs a file with a failure again, alone: a wait that ran out on a busy
  computer passes then and is named, a broken test fails twice. A test never waits for what
  may not come with Playwright's default of 30 seconds (`page.textContent(...).catch()` on a
  part that is not there): ask for what is there (`$`, `$$eval`). A test that reads a file the
  daemon writes reads it so that an empty one is "not yet" (`json()` in `desktop/test/support/window.ts`).
  The tests of the app's one window are two files, `app.test.ts` (the start, a conversation, the
  panel beside it, the settings) and `app-around.test.ts` (the side bar, the palette, tabs, a
  narrow window, another machine), which run side by side, each with an app and a home of its
  own made by `desktop/test/support/window.ts`; what both use to look at the window and drive it
  is there too. Within a file the tests follow each other in the one window; nothing in one
  file may need what the other set up. A file of these that grows past half a minute is split
  the same way: the longest file is how long a run takes. A test that waits for a daemon, or for one
  to be gone, asks `/overview` with the test home's token (`desktop/test/support/daemon.ts`), never
  `/health`, which any daemon answers: runs of several checkouts start daemons side by side. `sees()` there waits for something on screen and says
  what is there instead when it does not come. What a menu item does is sent as the menu
  sends it (`menu()`): keys typed into the page do not reach the system's menus. Voice input
  is tested with a stand-in for the helper (`PINE_DESKTOP_VOICE`, for tests only); the `live:`
  test in `desktop/test/voice-live.test.ts` (`PINE_LIVE=1`) puts the real helper behind it,
  listening to a recording. No test shows the app's real window with its title bar (only
  `view-perf.test.ts` puts a window on the screen, to measure it in front): after a
  change to the frame (`app-drag` and `app-no-drag` in `src/index.css`, the parts of
  `src/App.tsx` that carry them: `TitleBar`, `Sidebar` and `Gate`; the side panel's sheet in a
  narrow window, in `src/CodePanel.tsx`, whose header lies under the Mac window buttons and over
  the title bar's drag area; the window's options in `electron/main.ts`: `titleBarStyle`,
  `trafficLightPosition`, `vibrancy`), look at it once in light and dark, with the side panel
  open in a window narrower than 1024 pixels too.
- What the view costs is measured by `desktop/test/view-perf.test.ts`, skipped unless `PINE_PERF=1`: the app's
  CPU as the system counts it (`top`, its own processes, not its pine) with the view's panel closed, open
  at rest, open while three agents work and open with the window behind, and the frames the view draws.
  The window has to be in front to measure the view as it draws in front. Run it after a change to how a
  view is drawn or fed (`desktop/src/View.tsx`, `view-state.ts`, `examples/home/views/office.ts`, `workshop.ts`, `overview.ts`).
- Whether there is a newer app (`desktop/electron/updates.ts`) is asked of a stand-in for GitHub
  on a loopback port, without a window in `desktop/test/updates.test.ts` and through the app in
  `app.test.ts` (`PINE_DESKTOP_RELEASES`, for tests only: an app from a checkout asks nobody).
  No test reaches GitHub, and what would open in a browser is noted instead (`shell.openExternal`).
  The app's own update (`desktop/electron/updater.ts`) runs on a stand-in for macOS's updater in
  `desktop/test/self-update.test.ts` (`PINE_DESKTOP_UPDATER`, for tests only: a folder with what it
  is to do and the calls it was given); a real install is tried by hand, from release N to N+1,
  with the feed and the zip on a stand-in for the release's downloads (`PINE_DESKTOP_DOWNLOADS`,
  for tests only, beside `PINE_DESKTOP_RELEASES`).
- The browser in the app's panel is tested without a browser: the relay on its stand-in for
  Playwright's server (`FAKE_BROWSER` in `test/browser.test.ts`, which also plays the owner's
  hand), the control API and the app on a stand-in for the browser's door (a file in the test
  home's `data/browser-view/` that names a server of the test's own). The `live:` test in
  `desktop/test/browser-live.test.ts` (`PINE_LIVE=1`) puts the real browser behind the real
  app, on a page of its own on the loopback.
- The terminal beside a conversation is tested without a window on a real pseudo-terminal with
  `/bin/sh`, `/bin/bash` and `/bin/zsh` (`desktop/test/terminal.test.ts`: the shell hooks of
  `desktop/electron/shell-hooks.ts`, what a run reports, what a Run button refuses), and in the app
  with `PINE_DESKTOP_SHELL=/bin/bash` (for tests only, like `PINE_DESKTOP_STILL_RUNNING_MS`). A shell
  named that way reads none of the developer's startup files.
- `pine` for a terminal (`desktop/electron/command.ts`) is tested without a window
  (`desktop/test/command.test.ts`), on folders of the test's own as the PATH and the home:
  no test writes into a folder of the real PATH, and none runs what asks for a password.
- Browser access is tested without a network. `desktop/test/access-*.test.ts` run the access host
  and its parts under plain Node, with an in-memory stream or the Worker's meeting module served on
  a loopback port, and `desktop/test/peer.test.ts` joins two peers on this computer by hand, with no
  STUN server. The owner's relay is tested on a TURN server in the test (`node-turn` on a loopback
  UDP port, `desktop/test/support/turn.ts`), through which two peers that offer nothing but relay
  candidates pass bytes. The app's tests put the stand-in host behind the app (`PINE_DESKTOP_ACCESS_STAND_IN`,
  for tests only, `desktop/electron/access/stand-in.ts`), which also switches the app to Chromium's
  mock keychain. `web/test/peer.test.ts` pairs the web bridge with the real access host. Real
  networks (cellular, carrier NAT) are tried by hand.
- The Android app has its own suites in `mobile/`, not run by `npm test` at the root. `npm run
  check` and `npm test` there are run by the `android` job of the Release workflow before it
  builds the APK; `npm run test:core` and `npm run smoke` by no workflow. `npm test` there: the mobile bridge with a fake native plugin in place of
  Capacitor's (`test/bridge.test.ts`), Capacitor's configuration (`test/config.test.ts`), both
  builds of the page, each without the other's stand-in (`test/build.test.ts`), and the
  release's versionCode (`test/version.test.ts`). `npm run test:core`: the Kotlin core on the
  JVM (JUnit), against an SSH server in the test (Apache MINA sshd) whose exec handler checks the
  command and a stand-in daemon (a local HTTP server); its cases mirror `test/remote.test.ts`
  and `desktop/test/daemon.test.ts`. For a paired computer it runs the Pine app's real access host
  under Node (`mobile/test/support/access-host.ts`, one helper for both cores, tested by
  `mobile/test/access-host.test.ts` in `npm test` there) and drives the core above its `WebRtc`
  interface on libdatachannel's JVM binding (`LibDataChannelRtc`, a test dependency only, which
  needs sshj's window at 512 KiB: the binding's 0.24.1 against the Pine app's 0.24.6 loses bursts
  above about 1 MiB). If that binding ever breaks these tests, `dev.onvoid.webrtc:webrtc-java`
  can take its place behind the same interface. The helper's service is `http` on the loopback:
  the tests name `https://pine.test` and reach it through a route that only `Remote`'s internal
  constructor takes, and a test fails when the public one accepts `http`. One root test,
  `test/mobile-remote.test.ts`, fails when the command the core runs over SSH differs from
  `remoteCommand()`. `npm run smoke` is by hand:
  an emulator without a window, a test SSH server on this computer (`SmokeMachine.kt`) running
  the real `pine service` on a home of its own with the scripted model server. It is the one
  test of the WebView's hardening in `PinePlugin.kt` (permission denial, `onCreateWindow`, no
  second window, no file access, the navigation rules), each a named check that fails the run,
  and of the back button (closes the open sheet, then leaves) and the return from the
  background (still connected after back and after HOME). It is also the one test of Google's
  libwebrtc (`androidTest/.../LibWebRtcTest.kt`: pairs, connects, and sends 2, 4 and 6 MiB each
  way against the real access host behind a TLS front at `https://10.0.2.2:<port>`), and of
  pairing in the app: a pasted link, an App Link while running and at start (verified by hand with
  `pm set-app-links`, since Android verifies only against the service on the web), a malformed
  link and an `http` service refused. The TLS front's authority is trusted by the debug build
  alone (`src/debug/`, from `-PpineSmokeAuthority`); a release build has neither the config nor
  the file. Run it before a release that changes `mobile/` or upgrades Capacitor.
- The iOS app's suites are in `mobile/` too. `npm test` there covers the iOS bridge and the iOS
  page's policy. `swift test` in `mobile/ios-core/` (run by hand: no workflow runs it for now) drives the Swift core
  as the Kotlin tests drive theirs, against a real OpenSSH `sshd` the test starts on a loopback
  port with a forced command that checks the remote command, and a stand-in daemon; it replays
  the same JSON cases in `mobile/cases/` as `npm run test:core`, so a case added for one core is
  run by both. `npm run smoke:ios` is by hand: a simulator of its own booted with `simctl` (never
  the Simulator app), the app built signed to run locally (the Keychain needs it), and a hosted
  XCTest (`ios/App/AppTests/SmokeTests.swift`) that evaluates JavaScript in the real page against
  the same `SmokeMachine.kt` at `127.0.0.1`. It is the one test of the web view's hardening on
  iOS (the policy, the UI delegate's refusals, no file access, the media scheme and its ranges,
  no window, the navigation rules), each a named check that fails the run, of the return from
  the background, of the status bar, and of the Keychain key across a relaunch. Its `testPairing`
  pairs with the real access host (behind a TLS front whose authority `simctl keychain
  add-root-cert` adds to that simulator alone) by a pasted link and by `pine:` addresses, which it
  opens with `UIApplication.shared.open` from inside the app, since SpringBoard's "Open in Pine?"
  cannot be answered by a hosted test; a cold start by a `pine:` address is therefore not covered.
  `swift test` drives the Swift core against the same access host helper.
- What no test has tried for the mobile app's pairing: a real phone, an Android phone with 16 KB
  memory pages, cellular networks, and AltStore or Sideloadly installing the IPA that carries
  libdatachannel and OpenSSL. Try them by hand before a release that changes that path.
- The web client has its own suites in `web/` and `web/relay/`, not run by `npm test` at the
  root but by the `build` job of `.github/workflows/web-preview.yml` on a pull request that
  touches `web/`, the desktop page or what it is built from, or the workflow, before its preview is deployed. `npm test` in `web/`: the web bridge through the contract the page calls, in Node with a
  stand-in for SSH (`test/support/fake-ssh.ts`): the message door (another window, a method not
  on the list, bad arguments), host-key trust and change, `local: false`, media and link rules,
  reconnecting, the choice on an iPhone or iPad (`test/app-choice.test.ts`: the code unused before
  it, no choice on other devices); and the SSH core in headless Chrome for Testing against a real `sshd` on a
  loopback port with its own host key and `authorized_keys` (`test/support/machine.ts`): no test
  touches `~/.ssh` or the system's sshd. `npm test` in `web/relay/`: the relay's fetch handler
  with `connect()`, the name lookup and the WebSocket pair handed in (a stand-in TCP server on a
  loopback port; a pair that delivers Blobs unless asked otherwise, as workerd does), and the
  statement for App Links (`test/app-links.test.ts`). One root
  test, `test/web-remote.test.ts`, fails when the command the web bridge runs over SSH differs
  from `remoteCommand()`. `npm run smoke` in `web/` is by hand: the deployment under `wrangler
  dev` (local, never logged in to Cloudflare, its files in a temp folder), headless Chrome for
  Testing with a throwaway profile, a `sshd` of its own running the real `pine service` on a
  home of its own with the scripted model server; each named check fails the run. Run it before
  a release that changes `web/` or upgrades wrangler, Chrome or the SSH library.
- The Test workflow runs on Linux (x64, arm64), macOS and Windows. A test that cannot run on a
  system skips itself with the reason (`skip: process.platform === "win32" && "..."`), never
  silently. Windows' helpers (`*.cs`) are built and run by tests gated on `win32`, which only CI
  runs; on Windows the tests' commands run in `auto` mode (`harness()`), since there is no sandbox.
  GitHub's runners are slower than a desk: `PINE_TEST_PATIENCE` multiplies every `until`.
- A new security property needs a test that fails without the code that provides it.

## Style

- Plain TypeScript, tabs, no framework (the desktop page aside: see its line in Layout). Prefer one clear function over an abstraction used once.
- Comments explain why, not what. Error messages say what to do next.
- Text an agent will read (tool descriptions, refusals, the `<pine>` block) is written for a
  small local model: short, concrete, no jargon.
- Nothing that changes from turn to turn goes into the system prompt (no clock, no counters):
  the model server's cache only covers a prompt whose beginning is unchanged, and on a local
  model a miss means reading the whole conversation again. Turn-dependent facts go into the
  `<pine-note>` that `contextNote()` puts in front of the incoming message. The two cache tests
  in `test/agents.test.ts` fail when a request stops being an extension of the one before; the
  mock's `prefixCache` option reports cached tokens the way a server would, and `strip` removes
  the notes from what the mock echoes.
- With families (`short()` in `src/agents.ts`) a request begins the same for every conversation of an
  agent, and `steady()` is the one place that sees to it: the tools in one order (`shortDeclarations`),
  pine's own text as the system prompt, the instruction files as the conversation's opening message,
  frozen when it began (kv `prefix:`), and what was added to a file since in the note. So nothing that
  differs between two conversations of an agent, or between today and tomorrow, goes into a tool's
  description or into `SHORT_PROMPT`: which agents and sources there are is said in `contextNote()`.
  The cache tests in `test/catalogue.test.ts` fail when a request stops being an extension of the one
  before it across a restart, a line in `MEMORY.md` or a new agent. A family is a router and nothing
  more: `classify()` calls it `look`, and the tool it hands the call to (`ctx.executeTool`) passes the
  gate under its own name. A new tool of pine's goes into a group in `GROUPS` with a line in `BRIEF`
  that is true to its description; one for every task is added to `DECLARED` instead; a new list
  (what there is of a kind, no arguments) goes into `LISTS`, the one tool that takes several at once.
- A request names its slot on a llama.cpp server (`takeSlot`, `src/slots.ts`), with families and
  for a run started from outside too. Filling idle slots (`warm()`) sends a request of pine's own: only
  while nobody works with that model, only when the server says its model is loaded (never what loads
  one), and with nothing in it but what a conversation begins with. What the server says its slots
  hold (`lookAtSlots`, `SlotBook.seen`) corrects pine's notes, so that another client's conversation is
  not taken for an empty slot. A conversation whose slot is taken
  is written into a file of the server and read back when it returns (`page()`, `limits.slotPages`):
  a few files with fixed names that pine chooses, never a name from a conversation, and never for a
  server whose loaded model is another one.
- Permissions belong to a conversation, not to a session object: `Live.perm` is the key
  ("agent:session"), a sub-agent has its conversation's key, and `AgentManager.grants` and
  `.allowed` are looked up by it. Anything new that the owner can allow "for this conversation"
  goes there, so sub-agents get it and a reset clears it.
- Whatever the daemon writes on an agent's behalf goes into place through `sandboxExec`, never
  with `fs` on a path the agent chose: a path check in this process can be raced with a link.
- What is heard through the microphone (`src/tui/voice.ts`) is text for the input and nothing
  more: it is never sent by itself, it is cleaned of control characters like any text from
  outside the keyboard, and it is recognised on the device or not at all. Keep all three. A
  system without it gets a sentence (`voiceTools().unavailable`), never an attempt.
- The UI shows what an answer points at, and answers can carry text from outside. It must never
  fetch a web address because an answer contains it (pictures load on a click), and endpoints
  that take a path from an answer serve only what they are for.
- What a watcher reports is shown to the agent whole, as the event's fields (`RouteConfig.whole`,
  set by `SourceHost.route` for every type that does not `talks`): who wrote a message and
  where is not in its text. Only somebody writing to the agent (`talks`) arrives as their words alone.
- A source only reports (`emit`); it never starts agent work itself. Waking an agent is the
  subscription's job, which is a route added at runtime (`SourceHost.route`). Keep new source
  types free of agent, session or prompt logic, and make them start nothing until `setup` runs:
  an unsubscribed source must cost nothing and listen to nothing.
- The approval gate lives in one place, the `tool_call` handler in `coreExtension`
  (`src/agents.ts`). Plan mode comes before all of it: a call that is not class `look` is
  refused there and never asked about. Before that, for a shell without a sandbox, what is pine's own
  (`pineOwn`) is refused in every mode, bypass included. Then the order: bypass, then what is configured to always ask, then
  what is critical, then what never asks (read-only tools, a remembered "always"), then manual
  mode, then what sends something out after outside content.
- Keep the documentation in `docs/references/` in step with behaviour changes, and add new
  files to the tables in `docs/SKILL.md` and `README.md`. Agents read these files to answer
  their owners' questions about pine, so a wrong sentence there becomes a wrong answer.

## Agent skills

For the engineering skills of `mattpocock-skills` (`to-spec`, `to-tickets`, `implement-spec`,
`triage` and the others), if you use them.

### Issue tracker

Local markdown: specs and tickets are files under `.scratch/<feature>/`, which is gitignored, so
each contributor's stay on their machine. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles, each label equal to its name, written as a `Status:` line. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the root, made when a term or a decision
is first settled. See `docs/agents/domain.md`.
