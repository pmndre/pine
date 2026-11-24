// pine's ears on Linux: the helper the UI starts to dictate a message there, as it starts
// voice.swift on a Mac. It speaks the same lines; how it hears is in voice-linux.ts.
//   node voice-whisper.ts --recorder <path> --whisper <path> --model <path> [--locale de-DE] [--file <wav>]
import { listen } from "./voice-linux.ts";

void listen(process.argv.slice(2));
