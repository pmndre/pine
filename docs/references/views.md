# Views

A view draws all of pine at a glance in the Pine app: the agents and what each works on, where
work came from and who handed what to whom, sub-agents, the tools, MCP servers and skills in use,
event sources and who listens, schedules, each agent's conversations with branches and worktrees,
boards, and what waits for you. It is a script of yours, a `.ts` (or `.js`) file in the `views`
folder of pine's home, shown in a panel at the right of the window (`⇧⌘O`, View > Toggle View, or
the radar at the top right). The panel itself: [desktop.md](desktop.md), "The view".

pine comes with three:

| View | What it is |
|---|---|
| `office` | pine as a little tower house in pixels: a room and a robot for each agent, main under the roof |
| `workshop` | Santa's workshop at the North Pole: the main agent is Santa, the others elves in workshops of their own |
| `overview` | A page to read: what triggers agents, the agents and what each is doing, the tools they use, side by side (one under the other in a panel taller than wide), with a line between two while something happens there. It lays itself out anew when the panel changes size. An agent leading a swarm says so on its card ("swarm · round 2 of 8"). The default |

These three are pine's and kept up to date: a home gets them when pine starts without a `views`
folder, and a newer version replaces the old one at the next start. Every other file is yours.

- To change one, copy it under a name of your own (`my-office.ts`) and change the copy.
- If you change `office.ts`, `workshop.ts` or `overview.ts` itself, the next start puts pine's
  back and keeps yours as a view of its own (`office-mine.ts`).
- Take one out and it stays out.

| | |
|---|---|
| Where | `~/.pine/views/<name>.ts` is the view `<name>`. A name is lowercase letters, digits, `.`, `-` and `_` |
| Which one is shown | The one picked by name at the top of the panel, kept as `ui.view` in `pine.json` (the main agent's `set_setting` can set it, after asking you). Not set: `overview`, else the first. `off`: no panel |
| No view | With no view in the folder, or `ui.view` `off`, the app shows no button for the panel |
| Where it runs | Only in the Pine app on a computer; the mobile app and the web client show none |
| A change to the file | Close and open the panel to run it again |

## Writing a view

A view is one file. It imports from `pine/view` and nothing else, and its default export is the
view:

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

The folder holds what an editor needs: `views/.pine/view.ts` (the module, brought up to date at
every start) and a `views/tsconfig.json` that points `pine/view` at it, so types and completion
work when you open `~/.pine/views`. It also holds `views/AGENTS.md`, the guide to writing a view
(the rules, the smallest view, what the host gives, how to try it), for you or a coding agent
opened in that folder; pine's own agents do not read it and cannot write a view. pine writes the
guide anew when a new version changed it, keeping one you edited as `AGENTS.before.md`.

The TypeScript is stripped before the app runs a view, so only erasable syntax: no `enum`, no
`namespace`, no parameter properties.

| Name | What it is |
|---|---|
| `defineView` | `defineView((host) => { ... })`, the default export. Called once when the panel opens; what it returns is called when it closes |
| `ViewHost`, `host.root`, `host.state`, `host.on`, `host.select`, `host.open` | `root`: the element to draw in, sized by the panel (canvas, SVG or HTML). `state()`: all of pine now, a `ViewState`. `on("state", fn)`: every new state, at most five times a second while something changes, every few seconds while quiet (count time from your own clock); `on("happening", fn)`: each thing as it happens; both return a stop function. `select({ agent })`, `select({ work })` or `select({ board, task? })` shows that under the view in words, `select()` the log again; it comes back as `state.selected`. For a task the panel shows what it says, and the view is told none of it. `open(...)` opens an agent or a piece of work in a tab |
| `Detail`, `detailAt` | `detailAt(zoom, was?, at?)` gives `far` (below 0.5), `mid` or `near` (above 1.2) for a zoom where 1 is the drawn size; with `was` it holds a level until the zoom is clearly past a limit, so it does not flicker |
| `running`, `unsettled`, `progress`, `tasksOf`, `frame`, `ease`, `union`, `inside`, `along`, `lengthOf`, `seeded`, `hashOf`, `mix`, `shade`, `rgb` | Helpers. `running(state.work)`: work not ended. `frame(aim, view, whole, { zMax, min, step?, zMin? })`: where a camera looks to show a box (`step: 1` zooms in whole steps, for whole pixels); `ease(cam, target, ms)` moves it a frame's time on. Boxes and paths: the box around boxes, a point in a box, a point along a path, a path's length. `seeded(n)`: repeatable random numbers; `hashOf(name)`: a number from a name. Colors as `#rrggbb`: between two, lighter or darker, as numbers |
| `tiling`, `stages` | A board's tasks as a picture. `tiling(board, width, height, sizes, between?)` lays them out as square tiles, a column per task that comes after nothing, what comes after it below; `sizes` are the tile sizes a view can draw, largest first, each with its gap (`[[8, 2], [6, 2], [4, 1]]`). Returns `{ size, gap, tiles: [{ task, x, y }], height, more }`. `stages(board)` gives the tasks as rows that follow one another |

## What a view is told

The shape of pine, never its content. A view never sees a prompt, a task's text, an answer, an
error's text, a tool's arguments or subject (a path, a command), a question's text, a
conversation's or branch's name, a path, a model, a secret, a goal's objective, a swarm's job, a
to-do list's steps, what stands on a board, or what an event said. It is told the names of
agents, MCP servers, skills, event sources, schedules and boards.

| Name | What it is |
|---|---|
| `ViewState` | `{ at, agents, work, inputs, schedules, boards, selected?, dark, focused }`. Times are the page's clock in milliseconds (`Date.now()`); `dark`: the app is drawn dark; `focused`: its window is in front (an animating view can draw seldom otherwise) |
| `ViewAgent`, `ViewConversation` | An agent: `{ id, main, color, mode, mcp, skills, sources, schedules, conversations }`: its color as `#rrggbb`, its mode, the names of its MCP servers, skills, sources and schedules; the main agent first, then by name. A conversation: `{ id, main, branchOf?, worktree, busy, outside, goal?, swarm? }`: a number (stable while the panel is open, never its name), the conversation it was branched from, whether it works in a worktree, has work running or read outside content, its goal's status (`active`, `paused`, `met`, `blocked`, `limit`) and its swarm as `{ status, round, until, checking }` (`active`, `waiting` for your answer, `done`, `paused`, `limit`) |
| `ViewInput` | A way in: `{ id, kind, name, type?, count, last?, agents, failing }`; `kind` is `you`, `clock`, `source` or `outside`, `type` a source's type (`mail`), `agents` who listens, `failing` a source that could not start or lost its connection |
| `ViewSchedule` | `{ name, agent?, when?, next?, last? }`: the agent it wakes (none for one for all), how it was set (a cron line, `every 30m`, a time), when it runs next and last ran while the panel was open. The next first |
| `ViewBoard` | A board ([boards.md](boards.md)): `{ id, scope, name?, agent?, conversation?, open, taken, done, failed, blocked, notes, workers, tasks }`. `scope` is `conversation`, `agent` or `all`; then how many tasks are open, taken, done, failed or waiting for an answer, how many notes, and the work that holds a task now. Boards with work first. `unsettled(board)`: tasks open, taken or waiting; `progress(board)`: 0 to 1 |
| `ViewTask` | A task, never what it says: `{ id, state, after, worker?, agent?, by?, posted?, since?, notes?, asked?, outside? }`. `state` is `open`, `waiting` (after tasks not done), `taken`, `blocked` (its worker asked), `done` or `failed`; `after` the tasks it comes after; `worker` and `agent` who has it; `by` who posted it (an agent or `you`); `asked` `open` or `answered`; `outside` posted by work that read outside content. `tasksOf(board)`: the newest 200 |
| `ViewWork`, `ViewFrom`, `ViewDoing` | A piece of work, running or ended in the last half hour: `id`, `agent`, `copy` (a sub-agent), `parent`, `depth`, `from`, `doing`, `tool` and `mcp` (the tool it is in), `skill` (one it reads), `steps` (`{ done, total }`), `round` (of a goal), `board` (whose task it holds), `waitingOn`, `started`, `finished`, `tools` (how many calls), `calls` (its last dozen, each a `ViewCall` `{ tool, mcp?, at, ms?, ok? }`), `asking` (waits for you), `mode`, `held` (held to a stricter mode than its agent's), `outside`, `conversation`, `branch`, `worktree`, `swarm` (`lead` or `check`). `from`: `{ k: "you" }`, `{ k: "clock", name? }`, `{ k: "source", name }`, `{ k: "outside", name }` (a webhook, a route), `{ k: "agent", id }`, `{ k: "copy", id }`, `{ k: "pine" }`. `doing`: `thinking`, `tool`, `writing`, `waiting`, `asking`, `done`, `failed`, `cancelled` |
| `ViewHappening` | `started`, `ended` (`failed`), `tool` (`mcp`), `toolEnded` (`ok`), `skill`, `steps`, `event` (an input brought something), `scheduled` (`name`, `agent`), `handed` and `answered` (between agents), `copied`, `asked`, `decided` (you said yes or no), `said` (you wrote to running work), `sent` (an agent sent something out), `board` (`change`: `posted`, `taken`, `released`, `settled`, `removed`; `task` and `state` for a task), `branched` (`from`, `worktree`), `worktree` (`made` or gone), `goal` (`status`), `swarm` (`status`, `checking`), `outside` (a conversation read outside content the first time) |

## What a view cannot do

The app runs a view in a frame of its own, sandboxed with scripts and nothing else, under a
policy that allows no address. A view reaches neither the app, nor pine, nor the web: no `fetch`,
no picture from an address, no storage, no cookies, no other frame or window, no import but
`pine/view`. It cannot tell anybody what it saw. What it asks the panel to show or open is
checked against what the panel knows; anything else is ignored.

A view that throws is stopped, and the panel says why. A file pine cannot hand on (capitals or
spaces in its name, over a megabyte) is greyed out in the list with what is wrong; one whose
TypeScript cannot be erased shows "cannot be shown" with the reason.

The folder lies in pine's home, which no agent writes: no agent can put a view there or change
one.
