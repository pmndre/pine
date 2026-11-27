# The terminal UI

The terminal UI is a full-screen chat with your agents. `pine` (or `pine tui`) opens it. It
attaches to a running daemon, which goes on after you quit. If none runs, it starts one inside
itself and stops it when you quit (log in `data/pine.log`; queued tasks run at the next start).
`pine <folder>` (or `pine .`) adds a tab for a conversation in that folder ([coding.md](coding.md)).
The UI uses the control API (`http` in `pine.json`), so your messages go through the same events,
tasks and approvals as Telegram or `pine send`. The Pine app shows the same conversations in a
window ([desktop.md](desktop.md)).

```
 pine  1 ★ main ×  2 main·notes × ⠹  3 events ×  +                 ▤ code  ← tabs, and the code pane's button
──────────────────────────────────────────────────────────────────────────
 what is on the front page of example.com?                                 ← you
 ▸ 2 tool calls so far · browser_navigate · delegate · 1 thought · click to see all  ← this turn's work; click to open
 The page is IANA's placeholder for documentation examples ...             ← answer, streamed
 ⠹ working · 12s · 2 tool calls · 1 sub-task running · 2140↑ (92% cached) 96↓ · ↑ 1.4k t/s ↓ 42 t/s · esc to stop
──────────────────────────────────────────────────────────────────────────
 /mo                                                                       ← input
 main · main · no folder · opencode-go/deepseek-v4.1-flash · reasoning off · auto · context 12% · ↑ 1.4k t/s ↓ 42 t/s      /help
```

## Models to try it with

A new home has no model. The main conversation's welcome says how to connect one
(`pine login <provider>` or `pine model add`). The first model you connect becomes the default, and
`/model` switches ([operations.md](operations.md), "Choosing a model").

## Tabs

A tab is one conversation (an agent and a session). The first tab is the main agent's `main`.

| In the tab bar | Means |
|---|---|
| `★` | Kept for good: an agent's main conversation, or a pinned one |
| `•` | Something arrived while you were elsewhere |
| A spinner | The agent works |
| `!` | It waits for your approval |

The same tabs open again at the next start, with the same one in front. Closing a tab keeps its
conversation, and messages from Telegram, `pine send` or a route show in its tab too. The main agent
can open, close, rename, pin and remove conversations for you
([setup.md](setup.md#conversations-and-tabs)); a tab it opens appears behind yours, marked new.

pine removes a conversation after `limits.conversationDays` (7; `0` keeps all) without a message,
unless something keeps it ([agents.md](agents.md#sessions)). The list (`/sessions`, or a click on
the conversation's name) says why each is kept (`pinned`, `kept in a group`, `open in a tab`, ...)
or when it goes (`goes in 5 days`).

| In the list | What it does |
|---|---|
| `enter`, or a click on a name | Opens it in a tab |
| `▸ name` after a name | Its group. Type a group's name to find its conversations |
| `pin` / `unpin`, or `ctrl+p` | Pins it or takes the pin off. Pinned ones come first |
| `×`, or `ctrl+x` | Removes it for good after a second press (`remove? ×`), with its history, permissions, subscriptions and what was set up for it alone. Not while it works |
| `reset` on the agent's `main`, or `ctrl+x` on it | Starts it over like `/reset`, after a second press. The main conversation cannot be removed |

## Keys

| Key | What it does |
|---|---|
| `enter` | Send. While the agent works, it reads the message at its next step, answers briefly and goes on ([agents.md](agents.md), "A message while the agent works"). On an empty line, reopens a waiting approval |
| `alt+enter` | Send, but let the message wait until the agent is done |
| `shift+enter` | New line |
| `up` / `down` | Earlier inputs |
| `esc` | Stop the agent and pause a goal or swarm. A message typed meanwhile is answered next; a second `esc` within three seconds leaves it running. With a list or dialog open, only closes that |
| `shift+tab` | Next mode (input empty) |
| `tab`, `alt+1` ... `alt+9` | Next tab (input empty), or that tab |
| `ctrl+t`, `ctrl+w` | New conversation with the same agent; close the tab (the last one stays) |
| `ctrl+g` | Open or close the code pane |
| `ctrl+r` | Start or end dictating |
| `ctrl+v` | Attach the clipboard's picture, where the terminal passes the key on |
| `pgup` / `pgdn`, mouse wheel | Scroll |
| `ctrl+c` | Clear the input; twice on an empty input quits |
| `ctrl+d` | Quit (input empty) |

## Mouse

Everything in the two bars reacts to a click.

| Click | What it does |
|---|---|
| A tab | Brings it forward |
| `+` at the end of the tab bar | New conversation with the same agent |
| The `×` after a tab's name | Closes the tab and keeps the conversation. Subscriptions of that conversation alone end (not for a main conversation) |
| The agent name | The agents, and the sub-agents and delegated tasks this conversation started |
| The conversation name | This agent's conversations, and "+ new conversation" |
| The folder (`no folder`, a path, `⎇ pine/<name>`) | The conversation's folder or worktree ([coding.md](coding.md)) |
| The model, `reasoning <level>`, the mode | A list to switch: the models you have credentials for, the reasoning levels, the five modes |
| A `▸` line | Opens a turn's tool calls, a thought or a folded part. A click on it or on `▴ close` closes it |
| A web address | Opens in your browser (`http` and `https` only) |
| Beside an open list | Closes the list. Approval dialogs and questions stay until answered or put off with `esc` |

Lists filter as you type; `enter` or a click picks, `esc` closes. `/agent`, `/sessions`, `/model`,
`/reasoning`, `/mode` and `/folder` without an argument open the same lists.

The bottom bar also shows:

| Shown | Means |
|---|---|
| `context 37%` | How full the context window is (yellow from 65%, red from 85%). pi summarises the older part when it fills; `/compact` does it now |
| `cache 94%` | The share of the last request the model server took from its cache (yellow below 50%) |
| `↑ 1.4k t/s ↓ 42 t/s` | Model speed over the last task ("How fast the model is") |
| `outside content` (yellow) | The conversation has read outside content ([security.md](security.md)) |

In a narrow terminal the mode and `outside content` stay longest. Web addresses are printed in full, also behind a link's
text. Dragging selects text through the UI; hold Option (Terminal, iTerm) or Shift (most others)
for the terminal's own selection.

## Commands

Type `/` for the list; keep typing to narrow it.

| Command | What it does |
|---|---|
| `/help` | Commands and keys |
| `/new [name]` | New conversation in a new tab |
| `/new --worktree [name]` | The same, in a worktree of the front conversation's folder ([coding.md](coding.md#a-worktree-for-a-conversation)) |
| `/agent [id] [session]` | Opens a tab with an agent; alone, a list |
| `/sessions [name]` | Opens one of this agent's conversations; alone, the list |
| `/tab <n>`, `/close` | Switch to, or close, a tab |
| `/rename <name>` | Renames this conversation and its tab, keeping everything, running work included. Not for a main conversation |
| `/branch [--worktree] [name]` | A new conversation from one of your messages, picked from a list (with a name: all of it). `--worktree` (`-w`) gives it its own worktree ([agents.md](agents.md#branching-a-conversation)) |
| `/pin`, `/unpin` | Keep this conversation however long it is unused, or stop |
| `/group [name\|-]` | Puts this conversation and its branches into a group, made if new; `-` takes it out ([agents.md](agents.md#groups-of-conversations)) |
| `/reset` | Starts this conversation fresh and clears "outside content" |
| `/undo` | Takes back your last message, to ask again differently: stops what the agent did, reverts the files it changed, puts your text back in the input. Repeat for earlier ones ([coding.md](coding.md), "Taking a message back") |
| `/redo` | Brings back what `/undo` took, until you send a new message |
| `/compact` | Shortens the conversation: the earlier part becomes a summary, freeing context. Waits its turn like a message |
| `/notify [on\|off]` | A bell and a notification when the agent is done, fails or needs you while the terminal is in the background. On by default; Terminal.app only rings |
| `/copy` | Copies the last answer as Markdown |
| `/export [copy] [full]` | Saves the conversation as `pine-<agent>-<conversation>-<date>.md` in the folder pine started in. `copy`: to the clipboard. `full`: with thoughts and tool calls |
| `/folder [path\|none]` | Opens a folder for this conversation; `none` (`off`, `-`) closes it ([coding.md](coding.md#a-folder-for-a-conversation)) |
| `/worktree [name]` | Moves this conversation into a worktree; in one, a list: merge, squash, update, ask the agent to commit, discard ([coding.md](coding.md#a-worktree-for-a-conversation)) |
| `/code [changes\|turn\|files\|output\|running\|board\|off]` | The code pane on that view (`turn`: what your last message changed); alone, opens or closes it |
| `/board` | The board's tasks in the code pane (`○` to do, `●` in progress, `?` waiting, `✓` done, `✗` failed) and notes. To answer a task, tell the agent or use the Pine app ([boards.md](boards.md)) |
| `/stop` | Stops what the agent is doing |
| `/goal [objective\|pause\|resume\|clear]` | Goal mode: the agent works round after round until a judge says the objective is met ("Goals") |
| `/swarm [what is to be done\|pause\|resume\|clear]` | The agent leads sub-agents through a job on the board, and its answer is checked ("Swarms") |
| `/model [provider/id]` | Switches the agent's model, saved in its `agent.json`; alone, a list to search |
| `/reasoning [level]` | How much the model thinks: off, minimal, low, medium, high, xhigh, max. Saved like the model |
| `/mode [auto\|safe\|manual\|bypass\|plan]` | How much the agent does without asking ("Modes") |
| `/voice [language]` | Dictate (`ctrl+r`). A language (`/voice de-DE`) holds from then on |
| `/attach <path>`, `/detach [n]` | Attach files to the next message, or remove them |
| `/paste` | Attach the clipboard's picture (paste text with the terminal's own paste) |
| `/mcp`, `/mcp login [name]` | MCP servers, their state and whom each is for ([mcp.md](mcp.md)); `login` signs in to a remote one in the browser |
| `/status` | Model slots, running tasks, live sessions |
| `/sources` | Event sources, whether they run, who is subscribed |
| `/subscribe [local\|agent\|global] <source> [what to do]`, `/unsubscribe [local\|agent\|global] <source>` | Wake on a source's events, or stop. Without a scope: this conversation until its tab closes (in the main conversation, the agent) ([sources.md](sources.md)) |
| `/tasks` | This agent's recent tasks |
| `/task <id>` | A tab with one task's steps (sub-agents, delegated tasks) |
| `/events` | The live event log in a tab |
| `/approve [id] [always]`, `/deny [id]` | Answer an approval request; `always` stops the question for this conversation |
| `/state [pattern]` | Shared state |
| `/emit <topic> [json]` | Publish an event as yourself |
| `/clear` | Clears the view; the conversation stays |
| `/quit`, `/exit` | Leave; the tabs open again next time |

## Pointing at a file

Type `@` and a few letters to pick a file of the conversation's folder (else of the agent's
workspace); letters in order are enough (`@agts` finds `src/agents.ts`). Add `#120-160` (or `#120`)
for lines. pine adds a line that tells the agent to read that file first; the file is not attached.
Only a name picked from the list counts, so `@somebody` in a sentence adds nothing. In a git
repository the list holds what git knows or would add; elsewhere it skips hidden folders and
`node_modules`.

## Attachments

Drag files onto the terminal. They go out with your next message:

```
 attached: contract.pdf 212 KB ×  site-plan.png 1.4 MB ×
```

| | |
|---|---|
| `/attach <path>` | Attach a file |
| `/detach`, `/detach 2` | Remove all, or the second (or click its `×`) |
| `/paste`, `ctrl+v` | Attach the clipboard's picture |
| Limits | 10 files a message, 20 MB each, about 48 MB together |

Files go into `inbox/` in the agent's workspace. A model that takes images also sees images up to
10 MB. A dropped folder is opened for the conversation instead ([coding.md](coding.md)).

## Dictating a message

Click the `🎤` right of the input, press `ctrl+r` or type `/voice`, and speak. The words appear in
the input as they are recognised.

- `enter` or `ctrl+r` ends listening. The text stays to correct; `enter` again sends it.
- `esc` throws away what was heard. A key that types ends listening and is typed.
- Not started after 20 seconds, it ends and says why (often the system waiting for your answer
  about the microphone).
- It listens in your system's language. `/voice de-DE` picks another until the UI closes.

Nothing is sent until you press `enter`, and recognition happens on this computer only.

| System | Recognition and what it needs |
|---|---|
| macOS | On-device speech recognition, through pine's helper **pine voice**, which pine builds with Apple's command line developer tools (`xcode-select --install`). Before macOS 26, Dictation must be on in System Settings > Keyboard. A new language is downloaded once |
| Windows | System.Speech, through a helper pine builds once with the C# compiler of .NET Framework 4. Needs Speech recognition for the language (Settings > Time & language > Language & region) and "Let desktop apps access your microphone" |
| Linux | whisper.cpp's `whisper-cli`, a model and a recorder, all installed by you (below) |
| Anything else | None; `ctrl+r` and `/voice` say so |

When a piece is missing, the input has no `🎤`, and `ctrl+r` names what to install (on a Mac the
first try says so). macOS asks once whether **pine voice** may use the microphone, and may ask again
after a pine update; your terminal app doesn't get that permission. The Pine app carries the helper
built.

| On Linux | Where pine looks | How to get it |
|---|---|---|
| A recorder | `parecord` (PulseAudio, PipeWire), else `arecord` (ALSA), in `/usr/bin` and on your `PATH` | `sudo apt install pulseaudio-utils`, or `alsa-utils` |
| `whisper-cli` (or `whisper-cpp`) | `~/.local/share/pine/voice`, `~/.local/bin`, your `PATH`, `/usr/local/bin`, `/usr/bin`, a build in `~/whisper.cpp` or `/opt/whisper.cpp` | No Ubuntu package: `sudo apt install git cmake build-essential`, `git clone https://github.com/ggml-org/whisper.cpp`, in its folder `cmake -B build` and `cmake --build build --config Release`, then link `build/bin/whisper-cli` into `~/.local/bin` |
| A model | `~/.local/share/pine/voice` (or `$XDG_DATA_HOME/pine/voice`), named `ggml-<size>.bin` | `ggml-base.en.bin` (English) or `ggml-base.bin` (all languages) from [huggingface.co/ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp). pine prefers English models for English, and `base` over slower sizes |

On Linux the words arrive a few seconds late, because pine cuts the sound at each pause (after six
seconds at the latest). It skips silence.

| It says | What to do |
|---|---|
| `pine may not use the microphone` | System Settings > Privacy & Security > Microphone: switch on **pine voice** |
| `this Mac has no microphone to listen with`, `Windows has no microphone to listen with` | Connect a microphone, or choose one under Sound > Input in the system's settings |
| `this Mac has no speech recognition for <language>`, `Windows has no speech recogniser for <language>` | Use a language it lists. On Windows you can install Speech recognition for it |
| `the system could not fetch its speech model` | Connect the Mac to the network once |
| `speech recognition is switched off on this Mac` | Before macOS 26: turn on Dictation in System Settings > Keyboard |
| `Voice input needs Apple's command line developer tools` | `xcode-select --install` |
| `Voice input on Windows needs the C# compiler of .NET Framework 4` | "Turn Windows features on or off": switch on .NET Framework 4.8 Advanced Services |
| `Voice input on Linux recognises speech on this computer with whisper.cpp, and it needs …` | Install what it names |
| `the sound could not be recorded` | Linux: connect a microphone and choose it as the input |
| `whisper.cpp could not recognise what was said` | Linux: the model file is broken. Download it again |

## Modes

The bottom bar shows the agent's mode. Change it with a click, `shift+tab` or `/mode`. Details:
[security.md](security.md), "Modes: how much an agent does without asking".

| Mode | In short |
|---|---|
| `auto` | No sandbox: your whole account and the network. Asks before critical actions, and before sending out after outside content. The main agent's default |
| `safe` (green) | Inside its own folders (its sandbox), no network; asks for more. Other agents' default |
| `plan` (magenta) | Reads and asks, changes nothing, answers with a plan |
| `manual` (cyan) | Sandbox, and a dialog before every command, edit or message until "Always here" |
| `bypass` (red) | No sandbox, no dialogs |

`auto`, `safe` and `manual` are saved in `agent.json`; `bypass` and `plan` last until pine
restarts. When a conversation in bypass reads outside content, the bar shows `bypass (paused)` and
the agent works as in `auto`. Choosing bypass in such a conversation offers a new, clean
conversation (recommended) or bypass here anyway.

## Approvals

When an agent needs your say ([security.md](security.md), "What asks you"), a dialog shows the
agent, the tool, its arguments and the reason.

| Key | Answer |
|---|---|
| `a` or `y` | Allow once. Where the yes holds for the whole conversation (a folder, the network, a local address, an app), the button says so |
| `s` | Always here: no more questions in this conversation for this tool or MCP server, or for this kind of critical action. Not offered where asking every time is configured |
| `d` or `n` | Deny |
| `esc` | Later. It stays open until `security.approvalTimeout` (5 minutes), then counts as denied. `enter` on an empty line reopens it |

A request in a tab behind yours marks it `!`, and the status line names the tab. When the action
needs a value only you have (a bot's token, a device's password), the dialog has a field for it. A
secret goes into pine's `.env` and never reaches the agent or its model (a Telegram pairing code
shows as typed and is not stored). `enter` saves and allows, `tab` or a click moves between fields,
`ctrl+u` empties one, and Deny is a button. With Telegram set up, the request arrives there too and
the first answer counts, except for a request with a field.

## When the agent asks you something

Before it goes on, an agent can ask you to choose between options with its `question` tool. The
dialog lists the options, the recommended one first. Pick one with a digit, `enter` or a click, or type your own answer. Where
several may be picked, tick the boxes (`[ ]`) by number (`1,3`) or click, then press `enter`. `esc`
puts it off: `/approve` reopens it, and `/deny` tells the agent there is no answer, so it goes on
with an assumption it names. With Telegram set up, the question arrives there too. The tool works in
every mode, `plan` too, but not in a run an outside event started.

## The agent's list of steps

For work with several steps an agent keeps a list (its `todo` tool): `✓` done, `◐` in work, `☐` to
do, and `step 2 of 5` in the status line. The list survives a restart; `/reset` clears it. pine
reminds the agent of open steps with your next message and after six tool calls without a change.
With the code pane open, up to six steps stand at its top.

## The tool calls of a turn

A turn's thoughts, tool calls, handed-on work and words in between fold into one line. Click it to
open:

| When | Shown |
|---|---|
| While the agent works | `▸ 6 tool calls so far · bash ×4 · read ×2 · 1 thought · click to see all`, and the last six calls under it (`●` running, `✓`, `✗`) |
| When the turn is over | `▸ 12 tool calls · bash ×6 · read ×4 · edit · +1 more · 2 thoughts · 1 failed · 48s · click to open`, with the answer under it |
| Opened (`▾`) | Every call with its time (a failed one with its error), thoughts, sub-tasks with `▸ open`, and the words between. Stays open |

A turn with a single call or thought shows just that. Approval requests, questions, messages you
typed meanwhile, the list of steps and pictures from tools are never folded away. Tool calls show
only while pine runs; after a restart, look in the code pane's Output view ([coding.md](coding.md),
"The code pane") or the task's tab (`/task <id>`).

## Sub-agents and delegated tasks

A sub-agent or delegated task shows as a `↳` line among the turn's calls, with its own calls
indented. Click it or use `/task <id>` for a read-only tab with all its work, live. `esc` there
stops only that task.

## What a model thinks

A model that reasons (`/reasoning`) sends its thoughts before the answer:

| When | Shown |
|---|---|
| While it thinks | `▸ thinking 4s` and the last four lines |
| When it is done | `▸ thought for 12s`, then its speed: `▸ thought for 12s · ↑ 1.4k t/s ↓ 42 t/s` |
| After a click | `▾` and the whole thought; a click anywhere on it closes it |

Thoughts are not kept across a restart. A sub-agent's are in its tab. A model that sends none (some
hosted ones) shows `thinking` in the status line only. Hold Option or Shift to select text in a
thought.

### How fast the model is

pine times every model call, on any model server:

| Figure | What it is |
|---|---|
| `↑ 1.4k t/s` | Prompt processing: new (uncached) tokens, from sending the call to its first token. Hidden below 200 new tokens |
| `↓ 42 t/s` | Generation, thinking included, from the first token to the end. Hidden for a few tokens or an answer in one piece |

A `▸ thought for` line shows its own call, the status line the call that ended last, and the bottom
bar and a sub-task tab's last line the whole task. pine's log has them for every task. They include
the way to the server and back, so the server's own figures can differ a little.

## How answers are drawn

| In the answer | On screen |
|---|---|
| A code block | A bar on its left with the language above, colored for about 190 languages |
| A `diff` or `patch` block | Removed lines red, added green |
| A table | A grid aligned as its second line says (`---:`, `:---:`); `<br>` breaks a line; cells wrap |
| Headings | Bold and colored, without `#`; the first level underlined |
| A `<details>` block | One line to click open ("Folded parts of an answer") |

Lists, quotes, links, emphasis and inline code show as such. Other HTML, footnotes and tables too
wide even at one character per column show as written. `NO_COLOR` turns colors off.

## Folded parts of an answer

An agent can fold something long (a full message, a log) into one line, `▸ Full message · click to
open`. It writes:

```markdown
The keys are with the caretaker.

<details><summary>Full message</summary>

Dear Ms Okapi, the keys are with the caretaker until Friday.

</details>
```

| In the answer | What it does |
|---|---|
| `<details>` ... `</details>` | Folds what is between them. Without the closing tag it runs to the end |
| `<summary>` ... `</summary>` | Right after `<details>`: the line shown. Without it the line reads `Details` |
| `<details open>` | Starts open |

A click opens the part as indented markdown; another click, or `▴ close` after parts longer than six
lines, folds it. Opened parts stay open while the tab is open. Parts can nest, tags inside code are
text, and a link inside shows its address. `/copy` and `/export` keep the tags. Telegram folds
nothing.

## Pictures

The conversation draws pictures you attach, pictures that come with an event (a Telegram photo, a
camera image), pictures a tool returns, and png, jpg, gif or webp files in the workspace or folder
that the agent shows with `![caption](path)`.

| | |
|---|---|
| kitty, Ghostty, WezTerm, Warp | The real picture (Kitty graphics protocol) |
| Other terminals, and under a menu or beside the code pane | Colored half blocks, at most 44 characters by 14 lines |
| Converting | Half blocks, jpg, gif and webp need `sips` (macOS) or `ffmpeg` (Linux). Without them only png shows, as a real picture |
| A click | Enlarges or shrinks it |
| After a restart | Pictures in messages and answers return; a tool's are in its task tab |
| At a web address | Loaded only on a click on `▸ load picture https://...`, since an address can carry information out |

A video (`![caption](clip.mp4)`: mp4, mov or webm, up to 100 MB) plays at ten frames a second
without sound and needs `ffmpeg`; without it you see a still. One that arrives while you look plays
by itself. `▸ open in player` opens the system's player, with sound.

pine plays sound itself (`![caption](hello.wav)`: wav, mp3, m4a, ogg, flac or aiff, up to 100 MB),
one at a time. A new one plays at once, an earlier one on a click:

```
 ‖ pause  ▁▃▆█▇▅▃▅▆▄▅▅▄▃▃▂▂▃▂▂▁▁▂▁  ♪ hello world · 0:01 / 0:03   ▸ open in player
```

The bars are 24 pitch bands from 80 Hz to 8 kHz, each as high as that band is loud now. pine reads
wav itself and decodes other kinds with `ffmpeg` (or `afconvert` on macOS); a file nothing decodes
plays without bars. The player is macOS's own (through `osascript`), or on Linux the first of
`ffplay`, `mpv`, `pw-play`, `paplay`, `aplay`. Sound at a web address loads on a click
(`▸ load sound https://...`).

The player and converters have no network and write only to the temp folder. A remote MCP server's
files are fetched first ([mcp.md](mcp.md), "Files and pictures from a remote server").

## Goals

`/goal <objective>` sends the objective as your message. After each turn a judge says whether it
is met; if not, pine calls the agent again ([agents.md](agents.md), "Goal mode"). The status line
shows the round, and each verdict appears with the judge's reason, which only you see:

```
 ◎ goal · round 3 of 20 · checking whether it is met · esc to pause
 ◎ goal not met yet: round 2 of 20 starts
   the tests were not run
 ✓ goal met after 4 rounds
```

`‖` marks a goal that waits for you (paused, blocked or at its limit). `/goal resume` goes on and
`/goal clear` removes it. `esc` or a message you type pauses it. Every UI on the daemon shows the
same goal.

## Swarms

`/swarm <what is to be done>` sends the job as your message, and the agent leads it. It coordinates
sub-agents on the conversation's board instead of doing the work itself (a small job it does
itself). pine calls it again while tasks are open, and at the end a sub-agent that did none of the
work checks the answer ([boards.md](boards.md), "A swarm").

```
 ◎ swarm · round 2 of 8 · checking the answer · esc to pause
 ✓ swarm done after 2 rounds: 16 tasks, and the answer was checked
```

`‖` marks a swarm that waits for you (paused, at its limit, or its lead asked you something).
`/swarm resume` goes on; `/swarm clear` removes it and keeps the board. `esc` pauses it; a check
under way finishes. `/board` shows the tasks.

## The pine of another machine

`pine --ssh you@server` opens the UI on another machine's pine, with no pine home needed here. Name
the machine as after `ssh` (`server`, `user@server`, a name from `~/.ssh/config`); pine refuses ssh
options. One ssh connection runs `pine service` there and forwards a port of this computer to that
pine's loopback only. A pine it started stops when you quit.

| | |
|---|---|
| Needs | ssh without a password (a key in `ssh-agent`, or Tailscale SSH), a host ssh knows, and a pine with a home there (`pine init`; `pine update` if it lacks `pine service`) |
| Folders | Paths there: `pine --ssh you@server ~/projects/site`, `/folder <path>`. No folder chooser or dropped folders |
| Attachments, dictation, links, pictures, sound | Use this computer |
| `/mcp` | That pine's servers. Sign in there: `ssh you@server pine mcp login <name>` |
| Commands | `--ssh` is for the UI only. Run commands with `ssh you@server pine status` |
