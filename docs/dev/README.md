# Developer docs

What only a contributor needs: how pine and its apps are built, packed, signed, tested and
released, and how parts work inside. The manual (`docs/SKILL.md` and `docs/references/`) is
what owners and agents read; the `manual` tool does not index this folder. The repository's
[AGENTS.md](../../AGENTS.md) has the commands, the layout and the rules that keep pine safe.

| File | What it holds |
|---|---|
| [overview.md](overview.md) | Inside the daemon: an event's fields, topics only a UI uses |
| [operations.md](operations.md) | Running pine from a checkout, `pine dev-model`, how a version reaches an owner |
| [stack.md](stack.md) | The libraries, how pi is embedded, what the baseline found, the request pi sends |
| [security.md](security.md) | The gate, action classes, levels and variants, the sandbox on macOS and Linux, writes on the owner's behalf |
| [agents.md](agents.md) | Tool families, a request that begins the same, llama.cpp slots |
| [boards.md](boards.md) | Where boards live in the code; the pool benchmark |
| [coding.md](coding.md) | Folders, worktrees, background commands and undo inside |
| [tui.md](tui.md) | The terminal UI's files, the `dev` provider, the voice helpers, its tests |
| [desktop.md](desktop.md) | The Pine app from a checkout, the page in a browser, packing and signing, updates, its layout, how the page is drawn |
| [mobile.md](mobile.md) | Building, testing and releasing the Android and iOS app |
| [web.md](web.md) | The web client's parts, deploying it, previews, working on it |
| [source-types.md](source-types.md) | Where a source type lives, what types share, the `system` helpers, Slack's SDK, mail's Microsoft sign-in |
| [chrome.md](chrome.md) | The owner's own browser: the extension, the host, their protocol, the id and key, trying and publishing it |
| [computer.md](computer.md) | App control's helpers on macOS, Windows and Linux |
