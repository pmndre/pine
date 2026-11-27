# Recipe: a page as an agent's control panel

An agent can make a web page for you: a game board, light switches, a form, a dashboard. You click
in it in the agent's browser. Each click arrives as an event in the conversation that made the
page, and the agent answers by changing the page.

> Make tic tac toe in your browser. You are X, I am O. Tell me when I have won.

The recipe combines three things pine has: a page and a small server that keeps running
("Commands in the background" in [coding.md](coding.md)), a `stream` event source that listens to
the server and wakes the agent ([source-types.md](source-types.md)), and the agent's browser
([mcp.md](mcp.md), [desktop.md](desktop.md)).

A click that needs only a fixed reaction doesn't need the agent: a route with `run` on the stream
source's events runs a script that writes `state.json` ([events.md](events.md), "Running a
script"). Then leave the conversation unsubscribed.

## The steps

These steps are for the agent. Each is a tool call.

1. **Write three files** into a folder of the workspace, such as `ui/`: `index.html` (the page),
   `state.json` (what the page shows) and `server.mjs` (below). The server listens on this
   computer only. It serves the page and `state.json` at `/state`, takes what the page reports at
   `POST /event`, and passes it on at `/events` as Server-Sent Events, one line of JSON per press.
2. **Ask for the network.** In `safe` and `manual` mode the shell has no network, and the server
   ends with `listen EPERM`. Ask once with `request_access` (`network: true`, and say why). In
   `auto` and `bypass` mode, skip this.
3. **Start the server in the background** with the `bash` tool, `background: true` and
   `node ui/server.mjs`. It keeps running after the turn. If the page does not answer, read the
   server's output file.
4. **Listen to it** with `add_source`: `type: "stream"`, `options: { "url":
   "http://127.0.0.1:4173/events" }`, a `description`, a `note` that says what to do on a press,
   and `throttle: "0s"`. pine asks your owner once, and the `note` subscribes the conversation.
   Without `throttle: "0s"`, the subscription ignores the source for ten seconds after each event
   that woke the agent, and a click then is lost.
5. **Show the page** with `browser_navigate` to `http://127.0.0.1:4173/`, then `browser_show`.
   pine asks your owner once, because the address is on this computer.
6. **Play.** Each press arrives as an event `message` whose `value` is what the page reported,
   such as `{ "cell": 4 }`. Answer by writing `state.json` with your file tools. The page reads it
   every second.

**One port for everything.** Your owner's yes covers one host and one port, so serve the page,
its state and its event stream from one server. The browser's guard refuses any other port on
this computer, such as a WebSocket server of its own: the request fails, and a WebSocket fails
with `Establishing a tunnel via proxy server failed`. A WebSocket on the allowed port works. For a
second port, open its address once with `browser_navigate` so that pine asks your owner.

## The server

The example is for Node. If the shell has no `node` (the Pine app's pine brings its own, which a
shell does not see), write the same in Python: `/events` answers with
`content-type: text/event-stream` and writes `data: <one line of JSON>` and an empty line per
report.

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
cells, and `state.json` for it is `{ "cells": ["", "", "", "", "", "", "", "", ""], "says": "Your move." }`.

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

The page sets text with `textContent`, never as HTML, because `state.json` may repeat something
the agent read elsewhere.

## What to know

| | |
|---|---|
| Where the events arrive | In the conversation that set up the source, as pine's message saying it is an event, not your words |
| Outside content | Reports are outside content: they mark the conversation, and pine then asks before the agent sends something out ([security.md](security.md)). Anything on this computer can report to the port, so a report does not prove that you pressed |
| A click that is not answered | Nearly always the throttle (ten seconds unless set), which drops events. The event log shows the click with no turn after it. Subscribe again with `throttle: "0s"` |
| How many | A `stream` source passes on at most 30 reports a minute. Raise `perMinute` in its options, up to 600 |
| The agent's own clicks | They are reported like yours, so the agent changes the page through `state.json`, not by clicking |
| The server keeps running | The code pane lists it under Running, with its port. Stop it there or with `stop_program`. Resetting or removing the conversation stops it, and removing also removes its source. While the server is gone, the source says so in its status, and it reconnects when the server is back |
| On Linux | A conversation that has read outside content cannot start a background command, so start the server before the first event |
| Other browsers | It is an ordinary page, which also works in your own browser on this computer |
| A state that changes by itself | Another source's event (a Zigbee hub over `mqtt`, a sensor) can wake the agent, which writes `state.json`, and the page shows the room as it is |
