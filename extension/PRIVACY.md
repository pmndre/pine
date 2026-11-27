# Privacy: the Pine browser extension

The Pine extension lets the agents of [pine](https://github.com/pmndre/pine), a program you run
on your own computer, work in your browser: in a tab group of their own, in the tabs they open
there and the tabs you drag into it.

## What it sends, and where

- **Nothing to us.** The extension has no server. It has no analytics, no telemetry, no
  advertising and no remote code. We receive nothing from it.
- **To pine on your own computer, and nowhere else.** The extension talks to one program: pine's
  host, which your browser starts on your computer (native messaging). Nothing leaves your
  computer through the extension.

## What it handles

Only the tabs in pine's tab groups. For those tabs, the extension passes to pine what an agent
asks for (the page's content, pictures of the page, what the page logs) and carries out what the
agent does there (opening an address, clicks, typing). A tab outside pine's groups is never read
or touched. Dragging a tab out of a group, or pressing Cancel on the browser's "started debugging
this browser" bar, takes it back at once.

What pine does with a page an agent read is pine's own: it gives it to the AI model **you** set
up in pine. If that is a model of a provider on the internet, the provider receives what the
agent read, under that provider's terms. With a model on your own computer, it stays there.

In those tabs an agent is signed in wherever you are, because it is your browser. The extension
does not read, copy or store your passwords or cookies.

## What it keeps

In the browser's own extension storage, on your computer: which tab group belongs to which
conversation, which tabs an agent opened itself, and one version number. No page content and
nothing about you. It is gone when you remove the extension.

## Permissions

| Permission | Why |
|---|---|
| `debugger` | To read and operate the pages in pine's tab groups, as an agent's browser does |
| `tabs`, `tabGroups` | To make a tab group for a conversation and know which tabs are in it |
| `nativeMessaging` | To talk to pine on your computer |
| `scripting`, access to all sites | To draw the agent's pointer in a page it works in. An agent may be handed a tab of any site |
| `storage` | To remember which group is whose while the browser runs |
| `alarms` | To look for pine again when it was not running |

## Changes and contact

Changes to this text are in the repository's history. Questions and reports:
https://github.com/pmndre/pine/issues
