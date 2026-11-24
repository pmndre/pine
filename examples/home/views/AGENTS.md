# Writing a view

This folder holds pine's views. A view is one file here, `<name>.ts` (or `.js`): a script that draws
all of pine at a glance in the panel of the Pine app (`⇧⌘O`). The app lists the files of this folder
at the top of the panel, and the one picked there is shown.

This file is for whoever writes one: you, or a coding agent you open in this folder. pine itself does
not read it.

## The rules

- One file is one view. Its name is lowercase letters, digits, `.`, `-` and `_`, and it is at most a
  megabyte.
- It imports from `pine/view` and from nothing else. That module is `.pine/view.ts` in this folder:
  read it first. It is the whole API, with a comment on every type and function.
- Its default export is `defineView((host) => { ... })`. What that function returns is called when
  the panel closes: stop timers and listeners there.
- TypeScript whose types can simply be erased: no `enum`, no `namespace`, no constructor parameter
  properties.
- Do not edit `.pine/` or `tsconfig.json`: they are pine's, and `.pine/view.ts` is written anew at
  every start.

## What a view can and cannot do

A view runs in a frame of its own with scripts and nothing else. So:

- Draw into `host.root` with HTML, SVG or a canvas. Put a `<style>` element there for CSS.
- No `fetch`, no picture or font from an address, no storage, no cookies, no worker, no other
  import, no window of its own. A picture has to be drawn by the script or be a `data:` address.
- A view is told the shape of pine and nothing of its content: agents, what each piece of work does,
  where it came from, the names of tools, MCP servers, skills, event sources and schedules, and of
  the boards where each task stands (its number, its state, what it comes after, who has it, who
  posted it and when, how many notes it has). Never
  a prompt, an answer, a path, a conversation's name, what a task or a note on a board says, or what
  an event said. Do not design a view that needs those.

## The smallest view

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
				const busy = running(s.work).filter((w) => w.agent === a.id);
				li.textContent = `${a.id} (${a.mode}): ${busy.length ? busy.map((w) => w.tool ?? w.doing).join(", ") : "at rest"}`;
				li.style.color = a.color;
				li.onclick = () => host.select({ agent: a.id });
				li.ondblclick = () => host.open({ agent: a.id });
				return li;
			}),
		);
	};
	draw();
	const stop = host.on("state", draw);
	return () => stop();
});
```

## What the host gives you

| | |
|---|---|
| `host.root` | The element to draw in: the middle of the panel, empty, sized by the panel. Read its size with `clientWidth` and `clientHeight`, and follow it with a `ResizeObserver` |
| `host.state()` | All of pine now, a `ViewState`: `agents` (with their MCP servers, skills, sources, schedules and conversations), `work` (running, and what ended in the last half hour), `inputs` (you, the clock, each event source), `schedules` (with when each runs next), `boards` (the boards agents share work on: whose each is, how many of its tasks are open, taken, done, failed or waiting for an answer, and in `tasks` each task's number, state, what it comes after and who has it), `selected`, `dark`, `focused` |
| `host.on("state", fn)` | `fn(state)` with every new state: at most five times a second while something changes, every few seconds while all is quiet: count time from your own clock. Returns the function that stops it |
| `host.on("happening", fn)` | What just happened, as it happens (a `ViewHappening`): work started or ended, a tool, a skill, an event, a schedule due, a task handed on or answered, a copy, a question to you, a branch, a change on a board, a swarm that started, is being checked or is done. For a view that animates |
| `host.select(target)` | Shows an agent (`{ agent: "books" }`), a piece of work (`{ work: 12 }`) or a board or one of its tasks (`{ board: 7, task: 3 }`) under the view, in words; `select()` shows the log again. It comes back as `state.selected`. For a task the panel shows what it says: your view is not told that, the panel draws it |
| `host.open(target)` | Opens the agent's conversation, or the piece of work, in a tab |

Times in a state are the page's clock in milliseconds (`Date.now()`). A piece of work says what it
does in `doing` (`thinking`, `tool`, `writing`, `waiting`, `asking`, `done`, `failed`, `cancelled`),
and while it is in a tool, its name in `tool`, the MCP server in `mcp`, and a skill it reads in
`skill`. `copy` is a sub-agent; `from` says where the work came from; `parent` is the work that
started it; `swarm` is its part in a swarm (`lead`, or `check` for the sub-agent that checks the
answer), and a conversation's `swarm` says where that swarm stands and which round it is in; `calls` are its last tool calls by name, with how long each took and whether it went well.

The helpers of `pine/view` need nothing but the language: `running`; for boards `unsettled` (the tasks
that are not settled), `progress` (how far a board is, 0 to 1), `tasksOf`, `tiling` (a board's tasks
laid out as square tiles, a check under the work it checks) and `stages` (the same as rows that follow
one another); a camera (`frame`, `ease`) and `detailAt`, which says for a zoom whether to show little
(`far`), the usual (`mid`) or everything (`near`), for a view that tells more the closer it is looked at;
boxes and paths (`union`, `inside`, `along`, `lengthOf`), a look that is the same every time for the
same name (`hashOf`, `seeded`), and colors (`mix`, `shade`, `rgb`).

## A view that animates

- Draw with `requestAnimationFrame`, and not more often than you need: sleep between frames, and
  draw seldom while `state.focused` is false. A view that draws sixty times a second for nothing
  costs the battery.
- Keep what you draw a function of the state and the clock. The state can change under you at any
  time: an agent can be removed, a piece of work can be gone.
- Follow `state.dark` if your view has a light and a dark look.
- Say what the picture shows in words too (a hidden list in the page), for a screen reader.
- An error thrown by a view stops it, and the panel says why under it.

## Trying it

Save the file, then close the panel and open it again: the view is read anew each time the panel
opens. Pick it with the name at the top of the panel. A file pine cannot hand on (a wrong name, too
large, TypeScript that cannot be erased) is greyed out in that list, with what is wrong with it.

`office.ts`, `workshop.ts` and `overview.ts` are pine's own views: a house full of robots, Santa's
workshop full of elves, and a page of boxes that say in words what happens. They are long, and a view
can be twenty lines; read them for how a state is turned into something that moves, not as a
template. `overview.ts` is the shortest and the plainest of them. These three are pine's: it
brings them up to date when it starts. To change one, copy it under a name of your own
(`my-office.ts`) and change the copy. If you do change one of the three, pine keeps your version
as a view of its own (`office-mine.ts`) when it puts its own back.

More, also what the panel around a view shows: `pine manual "write a view"`, or
`docs/references/views.md` in pine's repository.
