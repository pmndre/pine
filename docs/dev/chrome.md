# The owner's own browser

What an owner reads is in [mcp.md](../references/mcp.md), "Your own browser". This is how it is
built.

## The parts

| Part | Where | What it does |
|---|---|---|
| The extension | `extension/` | Manifest v3, plain JavaScript, no build step. A service worker (`background.js`) and a popup that says whether pine is connected. It makes a tab group per conversation, attaches `chrome.debugger` to the tabs of that group, forwards protocol commands and events, and draws the agent's pointer (through the debugger too, in a world of the page that is the pointer's alone). It decides nothing |
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
extension an id of its own, at the moment the item is made and before any review: the Chrome Web
Store's is `pgfllnbofabjfobfgpejjlombgfpolba`, the second entry of `EXTENSION_IDS`.

## Publishing

The Chrome Web Store is the one store that matters: Brave, Vivaldi and Arc install from it, Edge
too once other stores are allowed, and Chrome on macOS and Windows installs an extension from
nowhere else. The store's own pages cannot be operated by an extension, so the developer console
is used by hand.

| Step | How |
|---|---|
| Account | Developer console > Account: the publisher name is `pmndre`. Names are not reserved there: a publisher is told apart by a verified site, so verify `pmnd.re` (it asks for the site in Google Search Console) for the mark beside the name |
| Pack | `node scripts/extension.mjs` writes `build-extension/pine-extension-<version>.zip`: the folder without the manifest's `key` and without `PRIVACY.md` |
| First upload | Developer console > New item > the zip. The item's id is in its address |
| Tell pine | Add that id to `EXTENSION_IDS` (`mcp/chrome.ts`) and set `STORE` (`src/chrome.ts`) to `https://chromewebstore.google.com/detail/<id>`. Release pine: an installed pine registers the new id with the browsers at its next start |
| Listing | The texts below, and at least one picture of 1280×800 without transparency (a page an agent works in, with its pointer). The privacy policy is `https://pine.pmnd.re/privacy/`: the text of `extension/PRIVACY.md` as a page of pine's website (`site/privacy/index.html` in pmndre/pine-website), since the store's check does not reach a file on GitHub. Change both together |
| Review | Submit. `debugger` gets a closer look: days, sometimes weeks. The extension asks for no site (no host permission, no `scripting`, no `tabs`): what it does in a page, the pointer included, goes through the debugger, and the store's notice about broad host permissions stays away. Keep it so |
| An update | Raise `version` in the manifest (and `PROTOCOL` in both files when a message changes meaning), pack, upload, submit |

Once `STORE` is set, the app's Settings row and `pine chrome` offer the store instead of the
folder, and the Pine app asks once at the start whether to get the extension (`checkOwnBrowser`
in `desktop/src/model.ts`), while a browser is there and the extension does not answer.
`PINE_CHROME_STORE` stands in for `STORE` in a test.

### The listing

| Field | Text |
|---|---|
| Name | Pine |
| Summary | Lets your pine agents work in this browser: in a tab group of their own, with the tabs you put there. |
| Category | Developer Tools |
| Language | English |
| Single purpose | Lets the AI agents of pine, a program the user runs on their own computer, operate browser tabs: the tabs of a tab group the extension makes for them, and the tabs the user drags into that group. |
| `debugger` | The extension's purpose is to let the user's own agent read and operate web pages. It attaches the debugger only to tabs inside pine's tab groups, and uses the DevTools protocol to read the page, take pictures of it, send clicks and keys, exactly as an automated browser does, and draw a pointer that shows the user where the agent clicks. |
| `tabGroups` | To create and name a tab group for each conversation, and to notice when the user drags a tab into it or out of it. |
| `nativeMessaging` | To talk to pine, which runs on the user's own computer. This is the extension's only connection: it contacts no server. |
| `storage` | To remember, while the browser runs, which tab group belongs to which conversation and which tabs the agent opened. |
| `alarms` | To look for pine again every half minute when it was not running. |
| Remote code | No. All code is in the package. |
| Data usage | Website content: yes (the content of tabs in pine's groups is passed to pine on the user's own computer). Everything else: no. Not sold, not used for anything but the single purpose, not used for creditworthiness or lending. |

Description:

```text
Pine is a program you run on your own computer: AI agents that work for you, in conversations and on events. This extension lets those agents work in your browser.

An agent normally browses in a browser of pine's own, which has none of your logins and which some sites refuse. With this extension it can work in your browser instead:

• A tab group per conversation. The agent sees and uses the tabs of its group and no other tab.
• Drag a tab into the group to hand it to the agent. Drag it out to take it back.
• The agent works in the background, behind the tab you are using. A pointer labelled "pine" shows where it clicks.
• The browser shows "Pine started debugging this browser" while an agent is attached. Cancel there takes every tab back at once.

The extension talks only to pine on your own computer. It has no server, no analytics and no remote code.

It needs pine: https://github.com/pmndre/pine
In the Pine app, open Settings > General > Your own browser and press Connect. In a terminal: pine chrome install. Then say to an agent "use my browser".
```

## Trying it

`npm run test:live` runs the `live:` test of `test/chrome.test.ts`: the real extension in the
Chromium Playwright has, in a profile of its own. By hand, in your own browser: `node src/cli.ts
chrome install`, load `~/.pine/chrome/extension` at `chrome://extensions`, and tell an agent to
use your browser. The extension's worker logs at `chrome://extensions` > Pine > "service worker".
An extension loaded from the folder reloads itself when pine brought a newer version.
