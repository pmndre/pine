# The owner's own browser

What an owner reads is in [mcp.md](../references/mcp.md), "Your own browser". This is how it is
built.

## The parts

| Part | Where | What it does |
|---|---|---|
| The extension | `extension/` | Manifest v3, plain JavaScript, no build step. A service worker (`background.js`) and a popup that says whether pine is connected. It makes a tab group per conversation, attaches `chrome.debugger` to the tabs of that group, forwards protocol commands and events, and draws the agent's pointer. It decides nothing |
| The host | `mcp/chrome.ts` | Started by the browser for the extension (native messaging), over stdin and stdout. A WebSocket on the loopback that Playwright's server connects to with `--cdp-endpoint`, as it connects to the Pine app's `browser-host.ts`: a browser made of one conversation's tabs |
| Registration | `src/chrome.ts` | Writes the native messaging manifest into each browser's folder (the registry on Windows), a launcher into `<home>/chrome/host`, and a copy of the extension into `<home>/chrome/extension`. Only when the owner asks; a start of pine refreshes it |
| The browser server | `mcp/browser.ts` | `browser_to_chrome`, `browser_to_pine`, and the move (`moveNow`). Reads where the host is from `<data>/chrome/host.json`, which the host rewrites every five seconds |

## The protocol between host and extension

JSON messages in the browser's framing (a 32-bit length, then the bytes). A message from the
host that is longer than the browser takes (1 MB) goes in base64 pieces (`framed`), which the
extension joins. Both sides say `hello` with `PROTOCOL`; raise it in both files when a message
changes meaning.

| From the host | Answer |
|---|---|
| `enter {room, title}` | `tabs`: the tabs of the room's group, each attached, with its `targetInfo` |
| `open {room, title, url}` | A new tab in the group (made with its first tab), attached, never in front |
| `close {tabId}` | The tab is closed |
| `leave {room}` | Detached from every tab of the room. Nothing is closed |
| `clear {room}` | The tabs pine opened for the room are closed. The owner's stay |
| `cdp {tabId, sessionId?, method, params}` | `result` or `error` |

| From the extension | Meaning |
|---|---|
| `cdp {tabId, sessionId?, method, params}` | An event of a tab, or of a frame or worker in it |
| `joined {room, tabId, targetInfo}` | The owner dragged a tab into the room's group |
| `gone {tabId}` | Closed, dragged out, or cancelled on the browser's bar |

A background tab is hidden and stops drawing, which stalls Playwright's clicks. The extension
sends `Emulation.setFocusEmulationEnabled` on attach and after each main-frame navigation, which
keeps the page awake without bringing it to the front.

## The id and the key

`extension/manifest.json` has a `key`, so an extension loaded from a folder has the id in
`EXTENSION_IDS` (`mcp/chrome.ts`). The private half is not in the repository. A store gives the
extension an id of its own: add it to `EXTENSION_IDS`, set `STORE` in `src/chrome.ts` to the
store page, and the app's Settings and `pine chrome` offer the store instead of the folder. A
store may refuse a manifest with a `key`: take it out of the copy that is uploaded.

## Trying it

`npm run test:live` runs the `live:` test of `test/chrome.test.ts`: the real extension in the
Chromium Playwright has, in a profile of its own. By hand, in your own browser: `node src/cli.ts
chrome install`, load `~/.pine/chrome/extension` at `chrome://extensions`, and tell an agent to
use your browser. The extension's worker logs at `chrome://extensions` > Pine > "service worker".
An extension loaded from the folder reloads itself when pine brought a newer version.
