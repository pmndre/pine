# Views for the Pine app

A view is a script of yours that draws all of pine at a glance in the Pine app's panel: agents and
their work, who handed what to whom, sub-agents, tools, MCP servers, skills, event sources,
schedules, conversations, boards, and what waits for you. The panel is in
[desktop.md](desktop.md), "The view".

## The views pine comes with

| View | What it is |
|---|---|
| `overview` | The default: a page to read with triggers, agents and their tools side by side (stacked in a tall panel), joined by a line while something happens. A swarm's lead says so on its card ("swarm · round 2 of 8") |
| `office` | pine as a little tower house in pixels: a room and a robot for each agent, main under the roof |
| `workshop` | Santa's workshop at the North Pole: the main agent is Santa, the others elves |

A newer pine replaces these three at its next start. Every other file in the folder is yours. To
change one, copy it under your own name (`my-office.ts`). If you edit `office.ts`, `workshop.ts` or
`overview.ts` itself, pine puts its own back and keeps yours as `office-mine.ts`. One you delete
stays deleted.

| | |
|---|---|
| Where | `~/.pine/views/<name>.ts` (or `.js`). Names: lowercase letters, digits, `.`, `-`, `_`, starting with a letter or digit |
| Which one is shown | Picked by name at the top of the panel (`⇧⌘O`, View > Toggle View, or the radar), kept as `ui.view` in `pine.json`. The main agent's `set_setting` can set it after asking you. Default `overview`, else the first. `off`: no panel |
| Where it runs | Only in the Pine app on a computer, not the mobile app or the web client |
| A change to the file | Close and open the panel to run it again |

## Writing a view

A view is one file that imports only from `pine/view` and exports the view as default:

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

`views/.pine/view.ts` (the module, updated at every start) and `views/tsconfig.json` give types and
completion when you open `~/.pine/views`. `views/AGENTS.md` is the guide to writing a view, for you
or a coding agent opened there. pine's own agents do not read it and cannot write a view. A new
pine rewrites the guide and keeps one you edited as `AGENTS.before.md`.

The app strips the TypeScript, so use only erasable syntax: no `enum`, no `namespace`, no
parameter properties.

| Name | What it is |
|---|---|
| `defineView` | `defineView((host) => { ... })`, the default export. Called once when the panel opens, and what it returns is called when it closes |
| `ViewHost`, `host.root`, `host.state`, `host.on`, `host.select`, `host.open` | `root` is the element to draw in, sized by the panel. `state()` is all of pine now. `on("state", fn)` fires at most five times a second while something changes, every few seconds while quiet (keep your own clock); `on("happening", fn)` fires per event. Both return a stop function. `select({ agent })`, `select({ work })` or `select({ board, task? })` describes it under the view (`select()` shows the log), and returns as `state.selected`. `open(...)` opens an agent or work in a tab |
| `Detail`, `detailAt` | `detailAt(zoom, was?, at?)`: `far` below 0.5, `mid`, `near` above 1.2 (1 is the drawn size). With `was` it holds a level near a limit, so it does not flicker |
| `running`, `unsettled`, `progress`, `tasksOf`, `frame`, `ease`, `union`, `inside`, `along`, `lengthOf`, `seeded`, `hashOf`, `mix`, `shade`, `rgb` | Helpers: `running(state.work)` (work not ended), `unsettled(board)` (open, taken or waiting tasks), `progress(board)` (0 to 1), `tasksOf(board)` (the newest 200); a camera that frames a box (`frame(aim, view, whole, { zMax, min, step?, zMin? })`, `step: 1` for whole pixels) and moves a frame on (`ease(cam, target, ms)`); boxes and paths; repeatable random numbers and a number from a name; `#rrggbb` colors mixed, lighter or darker, or as numbers |
| `tiling`, `stages` | A board's tasks as a picture. `tiling(board, width, height, sizes, between?)` lays them out as square tiles, a column per task that follows nothing, with what follows below; `sizes` lists tile sizes with gaps, largest first (`[[8, 2], [6, 2], [4, 1]]`). It returns `{ size, gap, tiles: [{ task, x, y }], height, more }`. `stages(board)` gives the tasks as rows in order |

## What a view is told

A view is told the shape of pine, never its content: no prompt, task or board text, answer, error
text, tool arguments or subject (a path, a command), question, conversation or branch name, path,
model, secret, goal objective, swarm job, to-do step or event text. It is told the names of agents,
MCP servers, skills, event sources, schedules and boards. For a selected task the panel shows the
text, and the view is told none of it.

| Name | What it is |
|---|---|
| `ViewState` | `{ at, agents, work, inputs, schedules, boards, selected?, dark, focused }`. Times are `Date.now()` milliseconds. `dark`: the app is drawn dark. `focused`: the window is in front (an animating view can draw seldom otherwise) |
| `ViewAgent`, `ViewConversation` | `{ id, main, color, mode, mcp, skills, sources, schedules, conversations }` (color as `#rrggbb`), main agent first. A conversation is `{ id, main, branchOf?, worktree, busy, outside, goal?, swarm? }`, its `id` a number stable while the panel is open, never its name. `outside`: it read outside content. `goal`: `active`, `paused`, `met`, `blocked`, `limit`. `swarm`: `{ status, round, until, checking }`, status `active`, `waiting` (for you), `done`, `paused`, `limit` |
| `ViewInput` | A way in: `{ id, kind, name, type?, count, last?, agents, failing }`, `kind` one of `you`, `clock`, `source`, `outside`, `type` a source's type (`mail`). `failing`: a source that could not start or lost its connection |
| `ViewSchedule` | `{ name, agent?, when?, next?, last? }`, next run first. `when`: a cron line, `every 30m` or a time. No `agent` for a schedule for all agents. `last` is set only while the panel was open |
| `ViewBoard` | A board ([boards.md](boards.md)): `{ id, scope, name?, agent?, conversation?, open, taken, done, failed, blocked, notes, workers, tasks }`, `scope` one of `conversation`, `agent`, `all`. `blocked` counts tasks waiting for an answer, and `workers` is the work holding a task. Boards with work first |
| `ViewTask` | A task without its text: `{ id, state, after, worker?, agent?, by?, posted?, since?, notes?, asked?, outside? }`. `state`: `open`, `waiting` (after unfinished tasks), `taken`, `blocked` (its worker asked), `done`, `failed`. `by`: an agent or `you`. `asked`: `open` or `answered`. `outside`: posted by work that read outside content |
| `ViewWork`, `ViewFrom`, `ViewDoing` | Work running or ended in the last half hour: `id`, `agent`, `copy` (a sub-agent), `parent`, `depth`, `from`, `doing`, `tool`, `mcp`, `skill`, `steps` (`{ done, total }`), `round`, `board` (whose task it holds), `waitingOn`, `started`, `finished`, `tools` (a count), `calls` (the last dozen `ViewCall` `{ tool, mcp?, at, ms?, ok? }`), `asking` (waits for you), `mode`, `held` (stricter than its agent's mode), `outside`, `conversation`, `branch`, `worktree`, `swarm` (`lead`, `check`). `from`: `{ k: "you" }`, `{ k: "clock", name? }`, `{ k: "source", name }`, `{ k: "outside", name }` (a webhook, a route), `{ k: "agent", id }`, `{ k: "copy", id }`, `{ k: "pine" }`. `doing`: `thinking`, `tool`, `writing`, `waiting`, `asking`, `done`, `failed`, `cancelled` |
| `ViewHappening` | `started`, `ended` (`failed`), `tool` (`mcp`), `toolEnded` (`ok`), `skill`, `steps`, `event`, `scheduled` (`name`, `agent`), `handed`, `answered`, `copied`, `asked`, `decided` (your yes or no), `said` (you wrote to running work), `sent` (an agent sent something out), `board` (`change`: `posted`, `taken`, `released`, `settled`, `removed`; `task`, `state`), `branched` (`from`, `worktree`), `worktree` (`made` or gone), `goal` (`status`), `swarm` (`status`, `checking`), `outside` (a conversation's first outside content) |

## What a view cannot do

A view runs in a frame of its own, sandboxed with scripts only, under a policy that allows no
address. It reaches neither the app, pine nor the web: no `fetch`, no picture from an address, no
storage or cookies, no other frame or window, no import but `pine/view`. It cannot tell anybody
what it saw. The panel ignores any request to show or open something it does not know. The views
folder is in pine's home, which no agent can write.

## When a view does not show

| What you see | Why |
|---|---|
| The panel says the view stopped, and why | It threw an error. Fix it, then close and open the panel |
| The view is greyed out in the list | Capitals or spaces in its name, or over a megabyte |
| "Could not show the view", with the reason | Its TypeScript cannot be erased (`enum`, `namespace`, parameter properties) |
| No button for the panel | No view in the folder, or `ui.view` is `off` |
| Your change to `office.ts` is gone after an update | pine kept it as `office-mine.ts` ("The views pine comes with") |
