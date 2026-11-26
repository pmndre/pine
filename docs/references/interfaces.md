# Recipe: a page as an agent's control panel

How an agent makes a web page for its owner to use (a board to play on, switches for the lights,
a form, a dashboard), and how each click reaches the agent. The owner clicks in the page in the
agent's browser; what was clicked arrives as an event in the conversation where the page was
made, and the agent answers by changing the page.

> Make tic tac toe in your browser. You are X, I am O. Tell me when I have won.

It is three things pine has anyway, put together:

| Piece | What it is | Where it is described |
|---|---|---|
| The page and its server | Files in the agent's workspace, and a small program that serves them and keeps running | "Commands in the background" in [coding.md](coding.md) |
| The way back | The server offers what the page reports as an event stream. A `stream` event source listens to it and wakes the agent | `stream` in [source-types.md](source-types.md) |
| The window | The agent's browser. In the Pine app it is beside the conversation, at the right of the window; elsewhere `browser_show` puts it on the screen | [mcp.md](mcp.md), [desktop.md](desktop.md) |

A click that only needs a fixed reaction (a decision shown, a value written) does not need the
agent at all: a route with `run` on the stream source's events runs a script that writes
`state.json`, in a fraction of a second, and the agent is not woken ([events.md](events.md),
"Running a script"). Leave the conversation unsubscribed then.

## The steps

For the agent that is asked for such a page. Each step is a tool call it has.

1. **Write three files** into a folder of the workspace, for example `ui/`: `index.html` (the
   page), `state.json` (what the page shows), `server.mjs` (below).
2. **Network.** In `safe` and `manual` mode the shell has no network, and a server cannot
   listen: it ends with `listen EPERM`. Ask for it once with `request_access` (`network: true`,
   and say why). In `auto` and `bypass` mode nothing has to be asked.
3. **Start the server in the background**: the `bash` tool with `background: true` and
   `node ui/server.mjs`. It keeps running after the turn. Read its output file if the page does
   not answer.
4. **Listen to it**: `add_source` with `type: "stream"`, `options: { "url":
   "http://127.0.0.1:4173/events" }`, a `description`, a `note` that says what to do when
   something is pressed, and `throttle: "0s"`. The owner is asked once. With the note the
   conversation is subscribed at once. Without `throttle: "0s"` a subscription ignores the
   source for ten seconds after each event that woke the agent, and a click in that time is
   lost: the owner presses a cell and nothing happens.
5. **Show the page**: `browser_navigate` to `http://127.0.0.1:4173/` (the owner is asked once,
   because the address is on this computer), then `browser_show`.
6. **Play.** Each thing the owner presses arrives as an event `message` whose `value` is what
   the page reported, for example `{ "cell": 4 }`. Answer by writing `state.json` anew: the
   page looks at it every second and draws what it says.

**One port for everything.** Your owner's yes for the page is for one host and one port, so the
page, its state and its event stream come from one server on one port, as below. A page that
reaches for another port on this computer (a WebSocket server of its own, an API) is refused by
the browser's guard: the request fails, and a WebSocket fails with `Establishing a tunnel via
proxy server failed`. On the allowed port a WebSocket works. Use one port, or open the second
address once with `browser_navigate` so that your owner is asked.

| Name | What it is |
|---|---|
| `server.mjs` | The page's server: serves `index.html`, hands out `state.json` at `/state`, takes what the page reports at `POST /event` and passes it on at `/events` as Server-Sent Events. Listens on this computer only |
| `state.json` | What the page shows. The agent changes the page by writing this file with its ordinary file tools; no browser tool and no network is needed for that |
| `/events` | The address the `stream` source is given: one line of JSON for each thing that was pressed |

## The server

The example is for Node. Where the shell has no `node` (the Pine app's pine brings its own, which
a shell does not see), write the same in Python or whatever is there: `/events` answers with
`content-type: text/event-stream` and writes `data: <one line of JSON>` and an empty line for
each report.

```js
// server.mjs: serves the page, and passes on what the page reports as an event stream.
import fs from "node:fs";
import http from "node:http";

const PORT = 4173;
const file = (name) => fs.readFileSync(new URL(name, import.meta.url));
const listeners = new Set();

http
	.createServer((req, res) => {
		if (req.url === "/events") {
			// pine's stream source listens here.
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
			res.write(": connected\n\n");
			listeners.add(res);
			req.on("close", () => listeners.delete(res));
		} else if (req.url === "/event" && req.method === "POST") {
			// The page reports here: one JSON object for each thing that was pressed.
			let body = "";
			req.on("data", (chunk) => (body += chunk));
			req.on("end", () => {
				for (const listener of listeners) listener.write(`data: ${body.replace(/\s+/g, " ")}\n\n`);
				res.writeHead(204).end();
			});
		} else if (req.url === "/state") {
			res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(file("./state.json"));
		} else {
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(file("./index.html"));
		}
	})
	.listen(PORT, "127.0.0.1", () => console.log(`the page is at http://127.0.0.1:${PORT}/`));

// A line now and then, so that a quiet stream is not taken for a dead one.
setInterval(() => {
	for (const listener of listeners) listener.write(": still here\n\n");
}, 30_000);
```

## The page

It draws what `state.json` says and reports what is pressed. This one is a board of nine
cells; `state.json` for it is `{ "cells": ["", "", "", "", "", "", "", "", ""], "says": "Your move." }`.

```html
<!doctype html>
<meta charset="utf-8" />
<title>Board</title>
<style>
	body { font: 16px system-ui; margin: 24px; }
	#board { display: grid; grid-template-columns: repeat(3, 72px); gap: 6px; }
	#board button { height: 72px; font-size: 32px; }
</style>
<p id="says"></p>
<div id="board"></div>
<script>
	const board = document.getElementById("board");
	const says = document.getElementById("says");
	let drawn = "";
	// Draw what state.json says. The agent changes the page by writing that file.
	async function draw() {
		const text = await (await fetch("/state")).text();
		if (text === drawn) return;
		drawn = text;
		const state = JSON.parse(text);
		says.textContent = state.says ?? "";
		board.replaceChildren(
			...state.cells.map((mark, i) => {
				const cell = document.createElement("button");
				cell.textContent = mark;
				// Report what was pressed: the server passes it on to pine.
				cell.onclick = () => fetch("/event", { method: "POST", body: JSON.stringify({ cell: i }) });
				return cell;
			}),
		);
	}
	draw();
	setInterval(() => draw().catch(() => {}), 1000);
</script>
```

Text from `state.json` is put on the page with `textContent`, never as HTML: what the agent
writes there may repeat something it read elsewhere.

## What to know

| | |
|---|---|
| Where the events arrive | In the conversation that set the source up, as a message of pine's own that says it is an event, not the owner's words |
| Outside content | What the page reports is outside content: the conversation is marked, and from then on pine asks before the agent sends something out ([security.md](security.md)). Anything on this computer that reaches the port can report, so a report is no proof that the owner pressed something |
| A click that is not answered | Nearly always the subscription's throttle (ten seconds unless given), during which events are ignored and not kept. Subscribe again with `throttle: "0s"`. In the event log the click is there, and no turn followed it |
| How many | A `stream` source passes on at most 30 reports a minute and drops the rest. For a page that is pressed more often, give `perMinute` in its options (up to 600) |
| The agent's own clicks | What the agent does in the page with its browser tools is reported like the owner's clicks. Change the page through `state.json`; a page the agent clicks in itself has to tell the two apart |
| The server keeps running | Listed under Running in the code pane, with its port; stopped there or with `stop_program`. Resetting or removing the conversation stops it, and removing the conversation removes its own source. A `stream` source whose server is gone says so where sources are listed, and reconnects when the server is back |
| On Linux | A conversation that has read outside content cannot start a command in the background. Start the server before the first event arrives |
| Other browsers | The page is an ordinary web page. It works in the agent's browser in the Pine app, in the window `browser_show` opens, and in your own browser on this computer |
| A state that changes by itself | The same way round: an event from another source (a Zigbee hub over `mqtt`, a sensor) wakes the agent, the agent writes `state.json`, and the page shows the room as it is now |
