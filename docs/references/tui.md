# The terminal UI

```bash
pine
```

opens a full-screen chat with your agents (`pine tui` is the same). It attaches to a running
daemon, or starts one inside the same process (log in `data/pine.log`) and stops it when you
quit. A new home has no model: the main conversation's welcome says how to connect one
([operations.md](operations.md), "Choosing a model").

```
 pine  1 ★ main ×  2 main·notes × ⠹  3 events ×  +                 ▤ code  ← tabs, and the code pane's button
──────────────────────────────────────────────────────────────────────────
 what is on the front page of example.com?                                 ← you

 ▸ 2 tool calls so far · browser_navigate · delegate · 1 thought · click to see all  ← this turn's work; click to open
 ▸ thought for 6s · click to read                                          ← what the model thought; click to open
 ✓ browser_navigate https://example.com 1.2 s                              ← tool call, finished
 ● delegate scout                                                          ← tool call, running
   ↳ scout delegated task #8: summarise the page ▸ open                    ← work handed on; click to look at it
   ✓ scout delegated task #8 answered (3.4 s, 2 tool calls) ▸ open

 The page is IANA's placeholder for documentation examples ...             ← answer, streamed

 ⠹ working · 12s · 2 tool calls · 1 sub-task running · 2140↑ (92% cached) 96↓ · ↑ 1.4k t/s ↓ 42 t/s · esc to stop
──────────────────────────────────────────────────────────────────────────
 /mo                                                                       ← input
──────────────────────────────────────────────────────────────────────────
 → model       [provider/id] — Show or switch this agent's model          ← command suggestions
 main · main · no folder · opencode-go/deepseek-v4.1-flash · reasoning off · auto · context 12% · ↑ 1.4k t/s ↓ 42 t/s      /help
```

`pine .` or `pine <folder>` adds a tab with a conversation that works in that folder. Folders,
worktrees and the code pane beside a conversation are in [coding.md](coding.md).

## The pine of another machine

```bash
pine --ssh you@server
```

opens the same UI on the pine of another machine. Write the machine as you would after `ssh`
(`server`, `user@server`, a name from `~/.ssh/config`); anything else, such as an ssh option, is
refused. No pine home is needed on this computer. One ssh connection runs `pine service` there
and forwards a port of this computer to that pine's loopback only, as the Pine app does
([desktop.md](desktop.md)). A pine the connection started stops when you quit; one that was
running goes on.

| | |
|---|---|
| Needs | ssh that signs in without a password (a key in `ssh-agent`, or Tailscale SSH), a host ssh already knows (connect once with `ssh`), and a pine with a home there (`pine init`; `pine update` for one without `pine service`) |
| Folders | Paths on that machine: `pine --ssh you@server ~/projects/site`, `/folder <path>` (`~` is the home there). The folder chooser and a folder dropped on the terminal are not offered |
| Attachments, dictation, links, pictures, sound | This computer's files, microphone, browser and player |
| `/mcp` | That pine's servers. A browser sign-in happens there: `ssh you@server pine mcp login <name>` |
| Commands | `--ssh` is for the UI only. Run a command there: `ssh you@server pine status` |

## Mouse

Everything in the two bars reacts to a click.

| Click | What happens |
|---|---|
| A tab | It comes forward |
| The `×` after a tab's name | The tab closes. The conversation is kept; what it alone was subscribed to ends (not for an agent's main conversation) |
| `+` at the end of the tab bar | A new conversation with the same agent |
| The agent name in the bottom bar | A list of agents; below them the sub-agents and delegated tasks this conversation started, to open their work |
| A `↳ ... ▸ open` line | A tab with that sub-agent's or delegated task's work |
| The conversation name | This agent's conversations, and "+ new conversation" |
| The folder (`no folder`, a path, or `⎇ pine/<name>`) | The folder this conversation works in, or what can be done with its worktree ([coding.md](coding.md)) |
| `▤ code` at the right of the tab bar | Opens or closes the code pane ([coding.md](coding.md), "The code pane") |
| The model | The models you have credentials for |
| `reasoning <level>` | How much the model thinks: off, minimal, low, medium, high, xhigh, max |
| The mode | The five modes |
| The `🎤` at the right of the input | Starts or ends dictating, like `ctrl+r` |
| Beside an open list | It closes, and the click does nothing else. Beside an approval dialog or a question: nothing, it stays until answered or put off with `esc` |
| A `▸` line: a turn's tool calls, a thought, a folded part of an answer | It opens; a click on it (anywhere on a thought) or on `▴ close` closes it |
| A web address | It opens in your browser (only `http` and `https`) |
| A picture or a video; `▶ play` / `‖ pause`; `▸ load picture` | See "Pictures" |
| The `×` after an attached file | Removes the file |

Lists are filtered as you type; `enter` or a click picks, `esc` closes. The same lists open with
`/agent`, `/sessions`, `/model`, `/reasoning`, `/mode` and `/folder` without an argument. The
wheel scrolls the conversation.

The bottom bar also shows:

| Shown | Means |
|---|---|
| `context 37%` | How full the conversation's context window is; yellow from 65%, red from 85%. When it fills, pi summarises the older part by itself. `/compact` does it now, `/reset` empties it |
| `cache 94%` | The share of the last request the model server took from its cache; yellow below 50% |
| `↑ 1.4k t/s ↓ 42 t/s` | How fast the model was over the last task. See "How fast the model is" |
| `outside content` (yellow) | The conversation has read something from outside ([security.md](security.md)) |

In a narrow terminal `/help` goes first, then the speed, `cache`, `context`, then the end of the
names. The mode and `outside content` go last.

Web addresses are printed in full, also behind a link's text, and a wrapped address opens whole.
Dragging selects text through the UI; hold Option (Terminal, iTerm) or Shift (most others) to use
the terminal's own selection.

## Pointing at a file

Type `@` and a few letters: a list offers the files of the conversation's folder (else the
agent's workspace) whose name fits; letters in order are enough (`@agts` finds
`src/agents.ts`). `enter` or `tab` takes one. Add `#120-160` (or `#120`) for lines.

The message goes out as written, with a line from pine that names the file (and lines) and
tells the agent to read it first. The file is not attached: the agent reads it with its own
tools. Only a name the list offered counts, so `@somebody` in a sentence adds nothing. In a git
repository the list holds what git knows or would add; elsewhere hidden folders and
`node_modules` are skipped.

## Attachments

Drag files onto the terminal. They appear above the input and go out with your next message:

```
 attached: contract.pdf 212 KB ×  site-plan.png 1.4 MB ×
```

| | |
|---|---|
| `/attach <path>` | Attach a file from the keyboard |
| `/detach`, `/detach 2` | Remove all, or the second |
| `/paste`, `ctrl+v` | Attach the picture on the clipboard (a screenshot); `ctrl+v` only where the terminal passes it on |
| Limits | 10 files a message, 20 MB each, about 48 MB together |

The files are saved into `inbox/` in the agent's workspace and the message names them. Images
of at most 10 MB are also shown to a model that takes images. A folder dropped on the terminal
is not attached: it is opened for the conversation ([coding.md](coding.md)).

## Tabs

A tab is one conversation: an agent and a session. The first tab is the main agent's `main`.
In the tab bar `★` marks a conversation kept for good (an agent's main one, or a pinned one),
`•` that something arrived while you were elsewhere, a spinner that the agent works, `!` that
it waits for your approval. `ctrl+t` opens a new conversation with the same agent, `ctrl+w`
closes the tab (the last one stays), `tab` (input empty) and `alt+1` ... `alt+9` switch;
`/agent`, `/sessions`, `/rename`, `/branch`, `/pin`, `/group` and `/events` are under "Commands".

When you quit and start again the same conversation tabs open, in the same order, with the same
one in front (not the events tab or task tabs). Closing a tab does not end its conversation.
Messages that reach the conversation from elsewhere (Telegram, `pine send`, a route) show in its
tab too. The main agent can open, close, rename, pin and remove conversations when you ask
([setup.md](setup.md#conversations-and-tabs)); a tab it opens appears behind yours, marked new.

A conversation nobody wrote in for `limits.conversationDays` (7; `0` keeps all) is removed with
its history, unless it is an agent's main one, pinned, in a group, open in a tab, subscribed to
a source or has a schedule of its own ([agents.md](agents.md#sessions)). The list (`/sessions`,
or a click on the conversation's name) says for each: `the agent's own, always kept`, `pinned`,
`kept in a group`, `open in a tab`, `kept`, or when it goes (`goes in 5 days`, `goes soon`).
A conversation nothing was said in is not listed.

| In the list | Does |
|---|---|
| `enter`, or a click on a name | Opens it in a tab |
| `▸ name` after a name | The group it is in. Conversations in no group come first, then each group's; typing a group's name finds its conversations |
| `pin` / `unpin`, or `ctrl+p` | Pins it or takes the pin off. Pinned ones have `★` and come first |
| `×`, or `ctrl+x` | Removes it for good, after a second click or key (`remove? ×`). Not while it works |
| `reset` on the agent's `main`, or `ctrl+x` on it | Starts it over like `/reset`, after a second click (`reset? ×`). The main conversation cannot be removed |

Removing cannot be undone: the history, what it was allowed, what it listens to and whatever was
set up for it alone (sources, schedules, MCP servers, skills, its folder) go.

## Commands

Type `/` for the list; keep typing to narrow it, `enter` runs the command.

| Command | What it does |
|---|---|
| `/help` | Commands and keys |
| `/new [name]` | New conversation in a new tab |
| `/new --worktree [name]` | A new conversation in a worktree of the folder of the one in front ([coding.md](coding.md#a-worktree-for-a-conversation)) |
| `/agent [id] [session]` | Open a tab with an agent; without an id, a list |
| `/sessions [name]` | Open one of this agent's conversations; without a name, the list |
| `/tab <n>`, `/close` | Switch to, or close, a tab |
| `/rename <name>` | Rename this conversation and its tab; history, pin and subscriptions go along, running work goes on. Not for an agent's main conversation |
| `/branch [--worktree] [name]` | A new conversation that goes on from one of your messages; this one stays as it is. Without a name, pick the message (or "all of it") from a list; with a name, all of it. `--worktree` (`-w`): in a worktree of its own ([agents.md](agents.md#branching-a-conversation)) |
| `/pin`, `/unpin` | Keep this conversation however long it is unused, or let it go again |
| `/group [name\|-]` | Put this conversation (with its branches) into a group, made if new; `-` takes it out, alone it says which ([agents.md](agents.md#groups-of-conversations)) |
| `/reset` | Forget this conversation and start fresh (also clears "outside content") |
| `/undo` | Take back your last message: its work is stopped, the files it changed are restored, its text is back in the input. Again for the one before ([coding.md](coding.md), "Taking a message back") |
| `/redo` | Bring back what the last `/undo` took, one message at a time, until you send a new message |
| `/compact` | Shorten this conversation: the earlier part becomes a summary, the recent part stays. Frees the model's context; useful with a small local model. Waits its turn like a message |
| `/notify [on\|off]` | A bell and a notification when the agent is done, fails, needs your approval or asks you something while the terminal is not in front. On by default, remembered. Terminal.app only rings; Ghostty, iTerm, Kitty and others show a system notification. Its text is pine's, never the agent's |
| `/copy` | Copy the agent's last answer to the clipboard, as Markdown |
| `/export [copy] [full]` | Save this conversation as `pine-<agent>-<conversation>-<date>.md` in the folder pine was started in. `copy`: to the clipboard instead; `full`: with thoughts and tool calls |
| `/folder [path\|none]` | Open a folder of yours for this conversation; `none` (or `off`, `-`) closes it; alone, a list ([coding.md](coding.md#a-folder-for-a-conversation)) |
| `/worktree [name]` | Move this conversation into a worktree of its folder's repository; in one, a list: merge, squash, update, ask the agent to commit, discard ([coding.md](coding.md#a-worktree-for-a-conversation)) |
| `/code [changes\|turn\|files\|output\|running\|board\|off]` | The code pane on that view; alone it opens and closes it. `turn`: what your last message changed |
| `/board` | The tasks of the conversation's boards, shown in the terminal's code pane (`/code board`): each task with its state (`○` to do, `●` in progress, `?` waiting for an answer, `✓` done, `✗` failed) and the notes; a click shows a task in full. Only shows: to answer or take back a task, tell the agent or use the Pine app ([boards.md](boards.md)) |
| `/stop` | Stop what the agent is doing |
| `/goal [objective\|pause\|resume\|clear]` | Goal mode: the agent works round after round until a judge says the objective is met. Alone it shows where the goal stands. See "Goals" |
| `/swarm [what is to be done\|pause\|resume\|clear]` | The agent leads a job worked through by sub-agents on the board, and its answer is checked. Alone it shows where the swarm stands. See "Swarms" |
| `/model [provider/id]` | Switch the agent's model; alone, a list to search (`/model deepseek` narrows it). Saved in its `agent.json` |
| `/reasoning [level]` | How much the model thinks before answering; alone, a list. Saved like the model. A model that cannot reason ignores it |
| `/mode [auto\|safe\|manual\|bypass\|plan]` | How much this agent does without asking; alone, a list. See "Modes" |
| `/voice [language]` | Dictate the message (`ctrl+r`). With a language (`/voice de-DE`) it listens for that one from then on. See "Dictating a message" |
| `/attach <path>`, `/detach [n]` | Attach files to the next message, or remove them |
| `/paste` | Attach the picture on the clipboard. Text is pasted with the terminal's own paste |
| `/mcp`, `/mcp login [name]` | The MCP servers, their state and whom each is for (all agents, one agent, `only this conversation`, or another conversation: [mcp.md](mcp.md)). `login` signs in to a remote one through the browser |
| `/status` | Model slots, running tasks, live sessions |
| `/sources` | Event sources: what can wake an agent, whether it runs, who is subscribed |
| `/subscribe [local\|agent\|global] <source> [what to do]`, `/unsubscribe [local\|agent\|global] <source>` | Wake on a source's events, or stop that. Without a scope: this conversation, ending when its tab is closed; in the main conversation, the agent ([sources.md](sources.md)) |
| `/tasks` | Recent tasks of this tab's agent |
| `/task <id>` | A tab with one task's work, step by step: for sub-agents and delegated tasks |
| `/events` | The live event log in its own tab |
| `/approve [id] [always]`, `/deny [id]` | Answer an approval request; `always` stops the question for the rest of the conversation |
| `/state [pattern]` | Shared state |
| `/emit <topic> [json]` | Publish an event as yourself |
| `/clear` | Clear the view (the conversation is kept) |
| `/quit`, `/exit` | Leave. The tabs open again at the next start |

A model or reasoning level you pick is saved in the agent's `agent.json`. So is a mode when it is
`auto`, `safe` or `manual`; `bypass` and `plan` last until pine restarts, so an agent never
comes back up in bypass unless its `agent.json` says so.

## Goals

`/goal <objective>` sends the objective as your message, and each time the agent ends a turn a
judge says whether it is met; if not, the agent is called again. How it works and when it stops:
[agents.md](agents.md), "Goal mode".

The status line starts with the goal, and the conversation gets a line for each verdict with the
judge's reason under it:

```
 ⠹ goal · round 3 of 20 · working · 41s · 6 tool calls · esc to stop
 ◎ goal · round 3 of 20 · checking whether it is met · esc to pause

 ◎ goal set: main works on it until it is met, for at most 20 rounds
 ◎ goal not met yet: round 2 of 20 starts
   the tests were not run
 ‖ goal stopped after 2 rounds: main needs something from you. Answer it, then /goal resume
   it needs to know which of the two databases to migrate
 ✓ goal met after 4 rounds
   all tests pass and the README has the command
```

`‖` is a goal that waits for you: paused, blocked, or at its limit. `/goal resume` goes on,
`/goal clear` takes it off. `esc`, or a message you type, pauses it (`esc` also stops the round
that runs). The judge's reason is shown to you, never to the agent. Every UI on the same daemon
shows the same goal.

## Swarms

`/swarm <what is to be done>` sends the job as your message; the agent leads it, coordinating
sub-agents on the conversation's board instead of doing the work itself (a small job it does itself), pine calls it again while
tasks are not done, and then has its answer checked by a sub-agent that did none of the work.
All of it: [boards.md](boards.md), "A swarm".

```
 ⠹ swarm · round 2 of 8 · working · 38s · 2 tool calls · 4 sub-tasks running · esc to stop
 ◎ swarm · round 2 of 8 · looking at the board · esc to pause
 ◎ swarm · round 2 of 8 · checking the answer · esc to pause

 ◎ swarm started: main leads it
 ◎ swarm the answer is being checked by a sub-agent that did none of the work
 ✓ swarm done after 2 rounds: 16 tasks, and the answer was checked
```

`‖` is a swarm that waits for you: paused, at its limit, or its lead asked you something (your
answer is its next turn). `/swarm resume` goes on, `/swarm clear` takes it off; the board stays.
`esc` pauses it and stops the round that runs; a check under way ends by itself. `/board` shows
the tasks beside the conversation.

## Keys

| Key | Does |
|---|---|
| `enter` | Send. While the agent works, the message goes into that work and is read at its next step; the agent answers it briefly first, then goes on ([agents.md](agents.md), "A message while the agent works"). If the work ends first, it is answered next. On an empty line with a request waiting: opens the approval dialog again |
| `alt+enter` | Send, but let the message wait until the agent is done |
| `shift+enter` | New line |
| `up` / `down` | Earlier inputs |
| `esc` | Stop the agent (`■ stopped`), and pause a goal or a swarm. A message you typed while it worked is answered next; for three seconds a second `esc` leaves it alone. While a list or dialog is open, `esc` only closes that |
| `shift+tab` | Next mode: auto, plan, safe, manual, bypass (input empty) |
| `tab` | Next tab (input empty) |
| `alt+1` ... `alt+9` | Go to that tab |
| `ctrl+t`, `ctrl+w` | New conversation; close the tab |
| `ctrl+g` | Open or close the code pane |
| `ctrl+r` | Dictate: start listening, and end it |
| `ctrl+v` | Attach the picture on the clipboard (where the terminal passes the key on) |
| `pgup` / `pgdn`, mouse wheel | Scroll |
| `ctrl+c` | Clear the input; twice on an empty input quits |
| `ctrl+d` | Quit (input empty) |

## Dictating a message

Click the `🎤` at the right of the input, press `ctrl+r` or type `/voice`, speak, and press
`enter` when you are done:

```
 ● listening · speak · enter when you are done · esc to throw it away
──────────────────────────────────────────────────────────────────
 About the scans: which bill is due first                              🎤 ← appears as you speak
```

| | |
|---|---|
| Where the words go | Into the input, after what you typed, as they are recognised |
| `enter` or `ctrl+r` while it listens | Ends listening. The text stays in the input to read and correct; `enter` again sends it |
| `esc` while it listens | Throws away what was heard |
| A key that types, or backspace | Ends listening, and the key is typed. Dictating never holds the input |
| Not started after 20 seconds | It ends and says why that may be (the system waiting for your answer about the microphone) |
| Language | Your system's. `/voice de-DE` (or `fr-FR`, ...) listens for another until the UI is closed |

Nothing heard is sent by itself: it is text in the input until you press `enter`. Recognition
happens on this computer only; nothing that is heard is sent to a server.

| System | What recognises | What it needs |
|---|---|---|
| macOS | The speech recognition macOS has on the device | Nothing on macOS 26 and later (a new language is fetched once, which needs the network). Before: Dictation on in System Settings > Keyboard, with the language |
| Windows | Windows' desktop speech recogniser (System.Speech) | Speech recognition installed for the language (Settings > Time & language > Language & region > the language's options), and "Let desktop apps access your microphone" on |
| Linux | whisper.cpp's `whisper-cli` and a model, fed by a recorder | All three installed by you (below); pine installs and downloads none of it |
| Anything else | Nothing | `ctrl+r` and `/voice` say so |

Where a piece is missing (on Linux a recorder, `whisper-cli` or a model; on Windows the C#
compiler), the input has no `🎤`, and `ctrl+r` and `/voice` answer with one line that names what
to install (the table at the end of this section). On a Mac the `🎤` is always there; without
the developer tools the first try says so.

On a Mac, the first time, macOS asks whether **pine voice** may use the microphone: a small
helper pine builds with Apple's command line developer tools (`xcode-select --install` if they
are missing). Your terminal app is not given the microphone. After an update the helper is built
anew and macOS may ask again. The Pine app carries it built. On Windows pine builds its helper
once with the C# compiler of .NET Framework 4 that Windows carries
(`%LOCALAPPDATA%\pine-voice`).

On Linux pine finds three things you install:

| | Where pine looks | How to get it |
|---|---|---|
| A recorder | `parecord` (PulseAudio, PipeWire), else `arecord` (ALSA), in `/usr/bin` and on your `PATH` | `sudo apt install pulseaudio-utils`, or `alsa-utils` |
| `whisper-cli` (or `whisper-cpp`) | `~/.local/share/pine/voice`, `~/.local/bin`, your `PATH`, `/usr/local/bin`, `/usr/bin`, a build in `~/whisper.cpp` or `/opt/whisper.cpp` | Ubuntu has no package: `sudo apt install git cmake build-essential`, `git clone https://github.com/ggml-org/whisper.cpp`, in its folder `cmake -B build` and `cmake --build build --config Release`, then link `build/bin/whisper-cli` into `~/.local/bin` |
| A model | `~/.local/share/pine/voice` (or `$XDG_DATA_HOME/pine/voice`), named `ggml-<size>.bin` | `ggml-base.en.bin` (English) or `ggml-base.bin` (every language) from [huggingface.co/ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp). pine prefers an English model for English, and `base` over slower sizes |

On Linux the words arrive a few seconds after you said them: pine cuts the sound where you pause
(at most every six seconds) and skips silence.

| It says | What to do |
|---|---|
| `pine may not use the microphone` | System Settings > Privacy & Security > Microphone: switch on **pine voice** |
| `this Mac has no microphone to listen with` | Connect one, or choose one in System Settings > Sound > Input |
| `this Mac has no speech recognition for <language>` | Use a language it lists, with `/voice <language>` |
| `the system could not fetch its speech model` | The Mac needs the network once for a new language |
| `speech recognition is switched off on this Mac` | Before macOS 26: turn on Dictation in System Settings > Keyboard |
| `Voice input needs Apple's command line developer tools` | `xcode-select --install`, then try again |
| `Windows has no speech recogniser for <language>` | Install Speech recognition for it, or use one it lists |
| `Windows has no microphone to listen with` | Connect one, or choose one in Settings > System > Sound > Input |
| `Voice input on Windows needs the C# compiler of .NET Framework 4` | "Turn Windows features on or off": switch on .NET Framework 4.8 Advanced Services |
| `Voice input on Linux recognises speech on this computer with whisper.cpp, and it needs …` | Install what it names (above) |
| `the sound could not be recorded` | Linux: connect a microphone and choose it as the input |
| `whisper.cpp could not recognise what was said` | Linux: the model file is broken or not whisper.cpp's: download it again |

## Modes

The bottom bar shows the agent's mode. Change it with a click on it, `shift+tab` (input empty)
or `/mode`. What each mode reaches and asks: [security.md](security.md), "Modes: how much an
agent does without asking".

| Mode | In short |
|---|---|
| `auto` | No sandbox: your whole account and the network. Asks before a critical action, and before sending something out after outside content. The main agent's default |
| `safe` (green) | Keeps the agent inside its own folders (its sandbox), no network; asks for anything beyond. Every other agent's default |
| `plan` (magenta) | Looks, reads and asks, changes nothing; its answer is a plan. Switch to another mode to have it carried out |
| `manual` (cyan) | In its sandbox, and a dialog before every command, edit or message, until "Always here" |
| `bypass` (red) | No sandbox and no dialogs |

When a conversation in bypass reads outside content, a yellow note appears, the bar shows
`bypass (paused)`, and the agent works as in `auto`. Choosing bypass in such a conversation asks
whether you want a new, clean conversation in bypass (recommended) or bypass here anyway.

## Approvals

When an agent needs your say ([security.md](security.md), "What asks you"), a dialog opens over
the conversation with the agent, the tool, its arguments and the reason. Several requests come
one after the other.

| Key | Answer |
|---|---|
| `a` or `y` | Allow once. Where a yes holds for the whole conversation (a folder, the network, a local address, an app) the button reads "Allow" and says so |
| `s` | Always here: no more questions in this conversation about this MCP server or tool (`bash`); for a critical action, about that kind of action. Not offered for actions configured to ask every time |
| `d` or `n` | Deny |
| `esc` | Later: it stays open until `security.approvalTimeout` (5 minutes), then counts as denied. `enter` on an empty line, `/approve` or `/deny` answer it meanwhile |

A request in a tab that is not in front opens no dialog there: the tab gets `!`, and your status
line says which tab waits (`alt+<n>` goes there).

When the action needs a value only you have (a bot's token, a device's password), the dialog has
a field for each, numbered "1 of 2" when there are several. A secret shows as dots, goes into
pine's `.env` and never reaches the agent or its model (a Telegram pairing code shows as typed
and is not stored). `enter` saves and allows; `tab`, `shift+tab`, `up`, `down` or a click move
between fields; `ctrl+u` empties one; `esc` is Later. Letters are typed, so Deny is a button to
click.

If Telegram is set up, the same request arrives there too; the first answer counts. A request
with a field is not sent to Telegram.

### The agent's list of steps

For work with several steps an agent keeps a list (its `todo` tool), shown in the conversation
and updated in place: `✓` done, `◐` in work, `☐` to do. The status line says `step 2 of 5`. The
list belongs to the conversation: it survives a restart, the agent is reminded of open steps
with your next message, and `/reset` clears it. An agent whose list stood still for six tool
calls is reminded of it. While the code pane is open, the steps stand at its top (up to six,
the one in work among them).

### When the agent asks you something

An agent that needs your decision asks with its `question` tool. A dialog shows the question and
the answers it offers, the recommended one first, each with a line on what it means. A digit,
`enter` on the highlighted line or a click picks one; whatever you type instead is your own
answer, sent with `enter`. Where several may be picked, each has a box (`[ ]`): type their
numbers (`1,3`) or click to tick, then `enter`. `esc` leaves it for later (`/approve` opens it
again, `/deny` tells the agent there is no answer, and it goes on with an assumption it names).
If Telegram is set up, a question with answers arrives there too, as buttons or numbered
answers. The tool is there in every mode, `plan` too, and not in a run an outside event started.

## How answers are drawn

| In the answer | On screen |
|---|---|
| A code block | A bar down its left with the language above it; colored for about 190 languages by the name after the backticks. Without a language: no colors |
| A `diff` or `patch` block | Removed lines red, added green |
| A table | A grid, aligned as the table's second line says (`---:`, `:---:`); `<br>` breaks a line; cells wrap when it is too wide |
| Headings | Bold and colored, without `#`; the first level underlined |
| Lists, task lists, quotes, rules, links, bold, italic, strikethrough, inline code | As such |
| A `<details>` block | One line to click open. See "Folded parts of an answer" |

Other HTML tags, footnotes and a table too wide even at one character per column are shown as
written. Code uses the terminal's sixteen colors. `NO_COLOR` turns colors off.

## Folded parts of an answer

An agent folds away something long that goes with its answer (a full message, a log, a long
list), and the conversation shows one line for it:

```
 ▸ Full message · click to open
```

A click opens it under the line, drawn as markdown and set in by two columns; a second click, or
`▴ close` at the end of a part of more than six lines, folds it again. There is no key for it.
What you opened stays open while the tab is open; after a restart every part is as the answer
wrote it.

What the agent writes (every agent is told so in its prompt):

```markdown
The landlord agrees to the date. The keys are with the caretaker.

<details><summary>Full message</summary>

Dear Ms Okapi,

the keys are with the caretaker until Friday.

</details>
```

| In the answer | What it does |
|---|---|
| `<details>` ... `</details>` | Folds what stands between them. Capitals and attributes do not matter; without the closing tag it runs to the end |
| `<summary>` ... `</summary>` | Right after `<details>`: the one line shown. Without it the line reads `Details` |
| `<details open>` | The part starts open |

A part inside a part folds the same way. Tags inside code are printed as text. A link inside a
folded part shows its address; a picture it points at is drawn under the answer. `/copy` and
`/export` keep the tags. On Telegram nothing folds: the summary is a line with the text under it.

## Pictures

Pictures are drawn in the conversation: ones you attach, ones that come with an event (a photo
on Telegram, a camera's image in a watched folder), ones a tool returns (a browser screenshot;
the agent does not show these again), and ones the agent points at with `![caption](path)`: a
png, jpg, gif or webp file in its workspace or the conversation's folder.

| | |
|---|---|
| kitty, Ghostty, WezTerm, Warp | The real picture (Kitty graphics protocol) |
| Other terminals (Terminal, iTerm2, anything in tmux) | A thumbnail of colored half blocks, at most 44 characters by 14 lines |
| Converting | Half blocks, jpg, gif and webp need macOS's `sips` or, on Linux, `ffmpeg`; without them only png shows, and only as a real picture |
| A click | Enlarges it; another shrinks it |
| Under a menu, or with the code pane open | Half blocks, since a real picture lies over all text and needs the left edge of a full line |
| After a restart | Pictures of messages and answers come back; a tool's are in the task's tab (`/task <id>`) |
| At a web address | Fetched only on a click on `▸ load picture https://...`, since an address can carry information out |

**Video**: one you attach, or `![caption](clip.mp4)` (mp4, mov or webm, up to 100 MB). One that
arrives while you look plays by itself, an earlier one shows a still. It plays at ten frames a
second without sound, one at a time, and needs `ffmpeg` (`brew install ffmpeg`); without it
there is the still. `▸ open in player` hands it to the system's player, with sound.

```
 ‖ pause · clip · 0:07 / 0:42 · no sound · click the picture to enlarge   ▸ open in player
```

**Sound**: `![caption](hello.wav)` (wav, mp3, m4a, ogg, flac or aiff, up to 100 MB), played by
pine itself. One that arrives while you look plays at once, an earlier one waits for a click;
one plays at a time.

```
 ‖ pause  ▁▃▆█▇▅▃▅▆▄▅▅▄▃▃▂▂▃▂▂▁▁▂▁  ♪ hello world · 0:01 / 0:03   ▸ open in player
```

| | |
|---|---|
| The bars | 24 bands of pitch from 80 Hz (left) to 8 kHz (right), each as high as that band is loud now, against the loudest moment of the sound; flat and grey while nothing plays. Worked out from the file, so they can be a moment off. Fewer in a narrow terminal, none with room for fewer than eight |
| Bars need | wav is read by pine; other kinds are decoded by `ffmpeg`, or on macOS by `afconvert`. On Linux without `ffmpeg` only wav has bars; a file nothing decodes plays without them |
| Player | macOS: the system's own (through `osascript`). Linux: the first of `ffplay`, `mpv`, `pw-play`, `paplay`, `aplay`. Without one the line says so; `▸ open in player` still works |
| At a web address | `▸ load sound https://...`, on a click |

The player and the converters run confined: no network, writing only to the temp folder. Sound a
remote MCP server made is fetched first ([mcp.md](mcp.md), "Files and pictures from a remote
server"). All of this is display: the model gets the actual picture if it takes images.

## The tool calls of a turn

Between your message and the answer the agent thinks, calls tools, writes a sentence about what
it does next and hands work on. The conversation folds all of that into one line, so that the
tool calls do not clutter the conversation; once the answer came, only that line is left, and a
click on it shows the tool calls again:

| When | What is shown |
|---|---|
| While the agent works | `▸ 6 tool calls so far · bash ×4 · read ×2 · 1 thought · click to see all`, and under it the last six lines: the call that runs (`●`) and those that ended (`✓`, `✗`) |
| When the turn is over | `▸ 12 tool calls · bash ×6 · read ×4 · edit · +1 more · 2 thoughts · 1 failed · 48s · click to open`, with the answer under it |
| After a click on it | `▾` and everything in order: each call with its time, a failed one with the start of its error, thoughts, sub-tasks with `▸ open`, the words the agent wrote in between. Stays open when the turn ends |
| A click on the line again, or on `▴ close` | The one line again |
| A turn with a single call or thought | That call or thought alone |

The line names the three tools called most (`+N more` for the rest). Words the agent writes and
then goes on working are folded in; the text after which nothing more happens is the answer.

Never folded away: an approval request, a question of the agent's, a message you typed while it
worked, its list of steps, and a picture a tool returned. The calls before one become a line
there, and those after it a block of their own.

Tool calls are shown while pine runs. After a restart an earlier turn is your message and the
answer; the calls of the last messages are in the code pane's Output view ([coding.md](coding.md),
"The code pane"), and a task's tab (`/task <id>`) shows all its calls.

## What a model thinks

A model that reasons (`/reasoning`) thinks before it answers and sends its thoughts ahead of the
answer. The conversation shows what the model was thinking:

| When | What is shown |
|---|---|
| While it thinks | `▸ thinking 4s` and the last four lines, moving on |
| When it is done | `▸ thought for 12s`, and once the call ended its speed: `▸ thought for 12s · ↑ 1.4k t/s ↓ 42 t/s` |
| After a click | `▾` and the whole thought. A click anywhere on it closes it |

A thought is folded in with the tool calls of its turn. Thoughts are not kept: after a restart
they are gone. A sub-agent's thoughts are in its own tab. A model that sends no thoughts (some
hosted ones) shows `thinking` in the status line only. Since a click closes a thought, select
text in it with Option or Shift held.

### How fast the model is

pine times every call of the model, with any model server:

| Figure | What it is |
|---|---|
| `↑ 1.4k t/s` | Prompt processing: new tokens read (cached ones not counted), from the call going out to its first token. Left out below 200 new tokens |
| `↓ 42 t/s` | Generation, thinking included: from the first token to the end. Left out for a few tokens or an answer in one piece |

| Where | Which call |
|---|---|
| On a `▸ thought for` line | The call that thought was part of |
| The status line, while it works | The call that ended last |
| The bottom bar | The last task as a whole (tokens over time). Stays when the work is done |
| A sub-task's tab, its last line (`── done · 12.3 s · 2 tool calls · 30205↑ 180↓ · ↑ 1.4k t/s ↓ 42 t/s ──`) | That task as a whole |

pine's log has them with every task. They include the way to the server and back, so a server's
own figures can differ a little.

## Sub-agents and delegated tasks

A sub-agent or a task handed to another agent shows as a `↳` line, its tool calls (indented) and
a line when it answers, among the tool calls of the turn. Its thoughts and words are in its own
tab: click the line or use `/task <id>`. The tab shows the task in full, follows a running task
live, and is read-only; `esc` there stops only that task, `ctrl+w` closes it.

## Models to try it with

A new home has no model; the first one you connect becomes the default, and the bottom bar shows
the model of the tab's agent. `pine login <provider>` or `pine model add` connects one, `/model`
picks it: [operations.md](operations.md), "Choosing a model". The main conversation begins with
pine's welcome until something is said in it, and every agent introduces itself in its first
answer to you ([agents.md](agents.md), "Meeting an agent").

## Notes

- The UI is a client of the daemon and needs the control API (`http` in `pine.json`).
- Quitting an attached UI leaves the daemon running; quitting one that started its own stops it,
  and queued tasks run at the next start.
- Everything it does goes through the same events, tasks and approvals as Telegram or `pine send`.
- The Pine app shows the same conversations in a window of its own: [desktop.md](desktop.md).
