# The terminal UI: how it works inside

For contributors. What an owner or an agent needs is in `docs/references/tui.md`; this file is
not indexed by the `manual` tool.

## Where things are

| File | What it does |
|---|---|
| `src/tui/run.ts` | `runTui` (this home's daemon through `ensureDaemon`, which starts one in-process when none answers) and `runRemoteTui` (`pine --ssh`, through `src/remote.ts`) |
| `src/tui/app.ts` | `PineTui`: tabs, the slash commands (`this.commands`), keys (`handleInput`), the bottom bar (`renderFooter`), the status line, the approval and question dialogs, the conversation list (`ConversationList`), turn folding (`TAIL` = 6 lines while working, `KINDS` = 3 tools named), thoughts (`PEEK` = 4 lines) |
| `src/tui/code-pane.ts` | The code pane. Side by side from `SIDE_BY_SIDE` = 100 columns, the pane half the width, 44 to 96 |
| `src/tui/picture.ts`, `src/tui/levels.ts` | Pictures, video (`FPS` = 10) and sound; the bars (`BANDS` = 24, `FEWEST_BARS` = 8) |
| `src/tui/voice.ts`, `voice.swift`, `voice.cs`, `voice-linux.ts`, `voice-whisper.ts` | Dictation helpers per system |
| `src/util.ts` `callTiming` | The speed figures: prompt processing counted from 200 new tokens and 50 ms, generation from 8 tokens and 200 ms |

## The `dev` provider

A home whose `models.json` has a provider named `dev` that an agent uses also gets the
`claude -p` stand-in (`src/dev/claude-model.ts`) started by `ensureDaemon` when nothing serves
it. Development only.

## The voice helpers

- macOS: `voice.swift` is built with `swiftc` from Apple's command line tools into
  `~/Library/Caches/pine-voice/pine-voice-<hash>`, the hash of the source and its Info.plist, so a
  changed helper is a new file and older ones are removed. The Pine app carries it built
  (`src/prebuilt.ts`). On macOS 26 and later it uses `SpeechTranscriber`, before that the older
  on-device recogniser.
- Windows: `voice.cs`, built with the `csc.exe` of .NET Framework 4 (C# 5) into
  `%LOCALAPPDATA%\pine-voice`, against `System.Speech.dll`.
- Linux: `voice-whisper.ts` records 16 kHz mono with `parecord` or `arecord`, cuts pieces at a
  pause of 0.35 s after 1.5 s, at most 6 s, skips silence, and runs `whisper-cli` on each piece.
  Every program is started by its absolute path, never through a shell.
- The UI starts a helper and waits 20 seconds for it to say it listens (longer while a macOS
  speech model is being fetched).

## Tests

`test/tui.test.ts` drives `PineTui` on `FakeTerminal`: type keys one at a time, click with
`term.click(x, y)`, drop files with `term.paste(path)`, and wait with `sees()`. Voice is tested
on a stand-in helper (`test/voice.test.ts`), pictures in `test/pictures.test.ts`.
