# Cases both native cores replay

The rules of the mobile app's native core that fit in a table live here, once, for both
platforms: the Android core (`mobile/core`, Kotlin) and the iOS core replay every file. A rule
changed in one core and not the other fails that other core's tests. A file added here has to be
replayed by both: `CasesTest` in `mobile/core` fails when a file has no replay there.

## Format

One JSON file per subject:

```json
{
	"about": "what the subject is, what each field of a case means",
	"cases": [
		{ "name": "a unique name", "...input fields...": "...", "expect": "..." }
	]
}
```

- `name` is unique in its file; a core names its test of the case after it.
- The input fields are flat strings, numbers, booleans or `null`, named in the file's `about`.
- `expect` is what both platforms expect, or, where they differ, an object with exactly the two
  keys `android` and `ios`, one expectation each:
  `"expect": { "android": true, "ios": false }`. No other expectation has those two keys.
- In an expected message, `{given}` stands for the machine as the owner wrote it and `{label}`
  for its short name, as the replaying test connected to it.

Where the platforms differ: the page's origin is `https://localhost` on Android and
`capacitor://localhost` on iOS, and the daemon's media are requested under
`https://localhost/_pine_media` on Android and `pine-media://daemon` on iOS.

| File | Subject |
|---|---|
| `hosts.json` | What may name the other machine (`sshHost`) |
| `loopback.json` | Where its daemon may answer (`loopbackEnd`) |
| `links.json` | What opens outside, what the page's origin is, which requests are media |
| `media-paths.json` | Which media requests are asked of the daemon at all |
| `media-types.json` | Which media answers reach the page |
| `fingerprints.json` | A host key's fingerprint as OpenSSH prints it |
| `service-lines.json` | The line `pine service` writes, and why one is not taken |
| `failures.json` | The words of a failure when no service line comes |
| `remote-command.txt` | The command run on the other machine: `remoteCommand()` of `src/remote.ts`, character for character, without a line break at the end (`src/remote.test.ts` holds it equal). Both cores read this file. |
