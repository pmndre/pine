# Views

A view draws all of pine at a glance in the Pine app: which agents there are, what each works on,
where the work came from, who handed what to whom, the copies (sub-agents) at work, which tools, MCP
servers and skills are in use, the event sources and who listens to them, the schedules and when each
runs next, each agent's conversations with their branches and worktrees, and what waits for you. It is a script of yours, a `.ts` (or `.js`) file
in the `views` folder of pine's home, and the app shows it in a panel at the right of the window
(`⇧⌘O`, View > Toggle View, the radar at the top right of the title bar). See "The view" in
[desktop.md](desktop.md) for the panel itself.

pine comes with three views. `office` is pine as a little tower house in pixels, a room and a robot for
each agent, main under the roof. `workshop` is the same pine as Santa's workshop at the North Pole:
the main agent is Santa, the others are elves, each in a workshop of another kind. `overview` is no
picture but a page to read: what triggers agents, the agents with what each is doing, and the tools
they use, with a line between two of them while something happens there. The three stand side by
side; in a panel that is taller than wide, one under the other, with the cards of each side by side
in rows as wide as the panel. When the panel changes size, it glides to show everything, laid out anew so that all of it is
as large as the panel allows. An agent that leads a
swarm says so on its card ("swarm · round 2 of 8", "Checking the answer", "Swarm needs your
answer") and stays among the agents at work between its turns. It is the one the
panel shows until you pick another ([desktop.md](desktop.md), "The view", says what is what in each). These
three are pine's own, and pine keeps them up to date: a home gets all of them when pine starts
without a `views` folder, one that pine gets later at the next start, and one that pine has
redrawn in place of the one it had. Every other file in the folder is yours: put one in and it
can be chosen.

- To change one of pine's views, copy it under a name of your own (`my-office.ts`) and change
  the copy: pine never touches a file it did not bring.
- If you change `office.ts`, `workshop.ts` or `overview.ts` itself, the next start puts pine's
  back and keeps your version beside it as a view of its own (`office-mine.ts`), which you can
  choose like any other.
- Take one of the three out and it stays out.
- A home from before pine kept its views up to date has its three replaced once at the first
  start; what was there is kept in `views/.pine/replaced/`.

| | |
|---|---|
| Where | `~/.pine/views/<name>.ts`: the view `<name>`. A name is lowercase letters, digits, `.`, `-` and `_` |
| Which one is shown | The one picked with the view's name at the top of the panel: a list of the views in the folder, read again each time it opens. That choice is `ui.view` in pine.json, which the main agent's `set_setting` can set too. Not set: `overview`, and in a folder without it the view whose name comes first. `off` (in pine.json): no panel |
| No view | With no view in the folder, or `ui.view` set to `off`, the app shows no button for the panel |
| Where it runs | Only in the Pine app on a computer. The mobile app and the web client show no view |
| A change to the file | Close and open the panel to run it again |

## Writing a view

A view is one file. It imports from `pine/view` and nothing else, and its default export is the view:

```ts
import { defineView, running } from "pine/view";

export default defineView((host) => {
	const list = document.createElement("ul");
	host.root.append(list);
	const draw = () => {
		const s = host.state();
		list.replaceChildren(
			...s.agents.map((a) => {
				const li = document.createElement("li");
				const busy = running(s.work).filter((w) => w.agent === a.id).length;
				li.textContent = `${a.id} (${a.mode}): ${busy ? `${busy} at work` : "at rest"}`;
				li.style.color = a.color;
				li.onclick = () => host.select({ agent: a.id });
				return li;
			}),
		);
	};
	draw();
	const stop = host.on("state", draw);
	return () => stop();
});
```

pine keeps the module a view imports beside the views, as `views/.pine/view.ts`, and writes a
`views/tsconfig.json` that points `pine/view` at it: open `~/.pine/views` in your editor and the types,
the completion and the checks are there. `.pine/` is pine's, brought up to date at every start, and the
tsconfig is put there when there is none; they are no views.

The folder also has a guide, `views/AGENTS.md`: the rules of a view, the smallest one, what the host
gives it and how to try it. It is there for you and for a coding agent you open in that folder to
have a view written; pine's own agents do not read it, and none of them can write a view (the folder
lies in pine's home). pine puts it there when there is none, and again when what it describes has
changed with a new version of pine (the guide itself, or the module a view imports). In between it
is yours: a change of yours is kept. When pine writes the guide anew over one you changed, yours is
kept beside it as `AGENTS.before.md`.

The TypeScript is taken away before the app runs a view (Node's own type stripping), so a view uses
types that can simply be erased: no `enum`, no `namespace`, no parameter properties.

| Name | What it is |
|---|---|
| `defineView` | `defineView((host) => { ... })`, the default export of every view. Called once when the panel opens, with the `host`; what it returns is called when the panel closes |
| `ViewHost`, `host.root`, `host.state`, `host.on`, `host.select`, `host.open` | What the panel gives a view. `root`: the element to draw in, the middle of the panel, empty and sized by it; a canvas, SVG or HTML. `state()`: all of pine now, a `ViewState`. `on("state", fn)`: `fn(state)` with every new state, at most five times a second while something changes and every few seconds while all is quiet (a view that animates counts time from its own clock); `on("happening", fn)`: what just happened, as it happens, for a view that animates. Both return the function that stops them. `select({ agent: "books" })`, `select({ work: 12 })` or `select({ board: 7, task: 3 })` (a board, with or without one of its tasks) shows that under the view with its details in words, `select()` the log again; what is selected comes back as `state.selected`. For a task, the panel shows there what the task says, its result and its notes: the app draws them itself, and the view that asked is told none of it. `open(...)` opens an agent, or a piece of work on its own, in a tab |
| `Detail`, `detailAt` | Levels of detail, for a view that shows more the closer it is looked at. `detailAt(zoom, was?, at?)` gives `far`, `mid` or `near` for a zoom, where 1 is the size the view was drawn for: `far` below `at.far` (0.5), `near` above `at.near` (1.2). Give the level the view is at as `was`, and it is kept until the zoom is clearly past a limit, so that the picture does not flicker at one. What each level shows is the view's own business. Levels are one way; pine's `overview` has none: its cards keep their size at each zoom while their words keep theirs, so a card looked at more closely has more room, and fills it the way a page fills a wider window, the most important first |
| `running`, `unsettled`, `progress`, `tasksOf`, `frame`, `ease`, `union`, `inside`, `along`, `lengthOf`, `seeded`, `hashOf`, `mix`, `shade`, `rgb` | Helpers. `running(state.work)`: the work that has not ended. A camera: `frame(aim, view, whole, { zMax, min, step?, zMin? })` says where to look to show a box (`step: 1` zooms in whole steps, for pixels that are to stay whole), `ease(cam, target, ms)` moves a camera a frame's time towards another. Boxes and paths: the box around boxes, a point in a box, a point along a path of straight pieces, a path's length. `seeded(n)`: random numbers that are the same for the same seed, `hashOf(name)`: a number from a name, for a look that is the same every time. Colors as `#rrggbb`: between two, lighter or darker, as numbers |

## What a view is told

A view is told the shape of pine and nothing of its content. It never sees a prompt, a task's text, an
answer, an error's text, a tool's arguments or subject (a path, a command), the text of a question you
are asked, a conversation's name, a git branch's name, a path, a model, a secret, a goal's objective, a swarm's job, a
to-do list's steps, what stands on a board (a task, a note, a result), or what an event said. It is told
names that are part of the setup: of agents, MCP servers, skills, event sources, schedules and boards.

| Name | What it is |
|---|---|
| `ViewState` | `{ at, agents, work, inputs, schedules, boards, selected?, dark, focused }`. Times are the page's clock in milliseconds (`Date.now()`); `dark` says whether the app is drawn dark; `focused` whether its window is in front, so that a view that animates can draw seldom while it is not |
| `ViewAgent`, `ViewConversation` | An agent: `{ id, main, color, mode, mcp, skills, sources, schedules, conversations }`, its color as `#rrggbb`, its mode (`manual`, `safe`, `auto`, `bypass`, `plan`) and the names of its MCP servers, skills, event sources and schedules; the main agent at the top, then by name. `conversations`: your conversations with it, the main one first, then the one used last, each `{ id, main, branchOf?, worktree, busy, outside, goal?, swarm? }`: a number for it (the same while the panel is open, never its name), the number of the conversation it was branched from, whether it works in a worktree, whether work runs in it, whether it read outside content, where its goal stands (`active`, `paused`, `met`, `blocked`, `limit`), and its swarm as `{ status, round, until, checking }`: `active`, `waiting` (for your answer), `done`, `paused` or `limit`, the turn of its lead it is in and the last one it gets, and whether a sub-agent checks the lead's answer right now |
| `ViewInput` | A way in: `{ id, kind, name, type?, count, last?, agents, failing }`, `kind` one of `you`, `clock`, `source`, `outside`, `type` an event source's type (`mail`, `webhook`), `agents` the agents that listen to a source, `failing` a source that could not start or lost its connection |
| `ViewSchedule` | A schedule: `{ name, agent?, when?, next?, last? }`: the agent it wakes (none for one that is for all), how it was set (a cron line, `every 30m`, or a time), when it runs next and when it last ran while the panel was open. `state.schedules` has them all, the one that runs next first |
| `ViewBoard` | A board ([boards.md](boards.md)): `{ id, scope, name?, agent?, conversation?, open, taken, done, failed, blocked, notes, workers }`. `scope` is `conversation`, `agent` or `all`; `name` only for a board that has one; `conversation` the number of the conversation it belongs to; then how many of its tasks nobody has yet, somebody works on, are done, failed, or wait for your answer, and how many notes it holds; `workers` the pieces of work that have one of its tasks now; `tasks` each task (below). `state.boards` has them all, those with work on them first. A piece of work that has taken a task names the board in `ViewWork.board`. `unsettled(board)` is how many of its tasks are open, taken or waiting for an answer; `progress(board)` how far it is, from 0 to 1 |
| `ViewTask` | A task of a board, never what it says: `{ id, state, after, worker?, agent?, by?, posted?, since?, notes?, asked?, outside? }`. `id` is its number and its place in the order the tasks were posted in. `state` is `open`, `waiting` (it comes after tasks that are not done), `taken`, `blocked` (its worker asked a question), `done` or `failed`. `after` are the numbers of the tasks it comes after: a check comes after the work it checks. `worker` and `agent` are the piece of work that has it and that work's agent. `by` is who posted it (an agent's name, or `you`), `posted` when, and `since` since when it stands as it does. `notes` is how many notes are about it, `asked` whether it asked something (`open` while it waits, `answered` once it had an answer), `outside` whether it was posted by work that had read outside content. `tasksOf(board)` gives them, the newest 200 |
| `tiling`, `stages` | A board's tasks as a picture. `tiling(board, width, height, sizes, between?)` lays them out as square tiles: a column for each task that comes after nothing, what comes after it under it, the columns wrapped into bands; `sizes` are the tiles a view can draw, largest first, each with its gap (`[[8, 2], [6, 2], [4, 1]]`). It returns `{ size, gap, tiles: [{ task, x, y }], height, more }`, with the tasks that did not fit counted in `more`. `stages(board)` gives the tasks in rows that follow one another, for a view that lays them out itself |
| `ViewWork`, `ViewFrom`, `ViewDoing` | A piece of work: `id`, `agent`, `copy` (a sub-agent), `parent` and `depth` (the work that started it), `from`, `doing`, `tool` and `mcp` (the name of the tool it is in, and its MCP server), `skill` (the skill it is reading, if its agent has it), `steps` (`{ done, total }` of its to-do list), `round` (of its conversation's goal), `waitingOn`, `started`, `finished`, `tools` (how many calls), `calls` (its last tool calls, a dozen at most, the newest last: each a `ViewCall`, `{ tool, mcp?, at, ms?, ok? }`, the tool's name, when it began, and once it ended how long it took and whether it went well; never what a call was about), `asking` (it waits for you), `mode` (the mode it runs in now), `held` (stricter than its agent's own: handed on from work in that mode), `outside` (it has read content from elsewhere), `conversation` (the number of the conversation it runs in or for), `branch` and `worktree` (that conversation is a branch; it works in a worktree), `swarm` (its part in its conversation's swarm: `lead` for a turn of the agent that leads it, `check` for the sub-agent that checks the answer). Running work and what ended in the last half hour. `from` is `{ k: "you" }`, `{ k: "clock", name? }` (a schedule), `{ k: "source", name }`, `{ k: "outside", name }` (a webhook, a route), `{ k: "agent", id }` (handed on, or the result coming back), `{ k: "copy", id }` or `{ k: "pine" }`. `doing` is `thinking`, `tool`, `writing`, `waiting` (for work it handed on or copies), `asking`, `done`, `failed` or `cancelled` |
| `ViewHappening` | `started`, `ended` (with `failed`), `tool` (with `mcp`) and `toolEnded` (with `ok`), `skill` (an agent read one of its skills), `steps` (its to-do list moved on), `event` (an input brought something in), `scheduled` (a schedule was due: its `name` and `agent`), `handed` and `answered` (between two agents), `copied` (a copy started), `asked` (you are asked something), `decided` (you said yes or no), `said` (you wrote to work under way), `sent` (an agent sent something out), `board` (something changed on a board: its number and `change`, one of `posted`, `taken`, `released`, `settled`, `removed`; for a task also its number in `task` and how it stands now in `state`), `branched` (a conversation was branched: its number, the one it came `from`, whether into a `worktree`), `worktree` (one was `made` or is gone), `goal` (a goal's `status` changed), `swarm` (a swarm's `status` changed, or its answer is being checked: `checking`), `outside` (a conversation read outside content for the first time) |

## What a view cannot do

The app runs a view in a frame of its own, sandboxed with scripts and nothing else, under a policy that
allows no address. So a view reaches neither the app, nor pine, nor the web: no `fetch`, no picture from
an address, no storage, no cookies, no other frame, no window of its own, no import but `pine/view`. It
cannot tell anybody what it saw. What it asks the panel to show or open is checked against the agents and
work the panel knows; anything else is ignored.

A view that throws is stopped, and the panel says why under it. A file pine cannot hand on (a name with
capitals or spaces, more than a megabyte) is greyed out in the list at the top of the panel, with
what is wrong with it. A view whose TypeScript cannot be erased is shown in the panel as "cannot
be shown", with the reason.

The folder lies in pine's home, which no agent writes: an agent cannot put a view there or change one.
The main agent can choose which view is shown (`ui.view`), and you are asked first.
