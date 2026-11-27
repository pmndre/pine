# Control API

The daemon's HTTP API, used by the Pine app, the terminal UI, `pine` and your own programs. It
answers on `127.0.0.1:7463` (`http.host`, `http.port`). A program that needs a daemon runs
`pine service` ([commands.md](commands.md), "A UI of its own").

Every request needs `Authorization: Bearer <token>` (from `data/http-token`). Bodies are JSON;
errors are `{ "error": "..." }`. `session` names a conversation and defaults to `main`.

## The daemon

| Request | Purpose |
|---|---|
| `GET /health` | Liveness (no token) |
| `GET /status`, `/agents`, `/approvals` | As the CLI commands; `modelProblem` says why an agent's model cannot answer. `/status` has `approvals` (open approvals) and `questions` (open questions of agents: those of a conversation's latest turn, until you write again) |
| `GET /models` | Models with credentials, as `provider/id` |
| `POST /models/refresh` | Reads `models.json` and `.env` again |
| `GET /manual` | The manual's chapters in index order, with their part (`group`) and sections, for the Manual tab |
| `GET /manual/chapter?id=<id>` | One chapter: each section's id, title, heading level and Markdown |
| `GET /manual/search?q=<words>` | A search like the agents' `manual` tool: chapter, section and matching line per hit |
| `GET /mcp` | Configured MCP servers |
| `POST /mcp` `{ name, server, agent? }` or `{ name, remove: true, agent? }` | Adds or removes a server while the daemon runs |
| `POST /mcp/refresh` | Closes idle sessions so they restart with the current servers |

## Agents

| Request | Purpose |
|---|---|
| `POST /agents` `{ id, instructions, description?, color?, model?, tools? }`, `POST /agents/<id>/update` `{ color?, scroll?, instructions?, soul?, tooling?, model?, thinking?, mode?, tools?, delegates?, network?, read?, write?, forget? }`, `POST /agents/<id>/id` `{ agent, to }`, `POST /agents/<id>/erase` `{ agent, keepFiles? }` | Create, change, rename (409 while it works) or remove an agent with everything it has, as `pine agent add`, `update`, `rename`, `remove`. `id` and `erase` repeat the id in `agent` |
| `POST /agents/<id>/model` `{ model }` | Sets and saves the agent's model |
| `POST /agents/<id>/thinking` `{ level }` | Sets and saves its reasoning level |
| `POST /agents/<id>/mode` `{ mode, session?, anyway? }` | Sets its mode; `anyway: true` with a `session` keeps bypass there after outside content |
| `GET /agents/<id>/todos?session=` | The agent's list of steps in that conversation |

## Conversations

| Request | Purpose |
|---|---|
| `GET /agents/<id>/sessions` | Each conversation's name, messages, last use, pin, tab, folder, removal date, `branch` (`from`, `at`), `worktree`, `group` |
| `POST /agents/<id>/pin` `{ session, pinned? }` | Pins (keeps) a conversation; `pinned: false` unpins |
| `POST /agents/<id>/rename` `{ session, to }` | Renames a conversation, also while it works |
| `POST /agents/<id>/remove` `{ session }` | Removes one for good; not `main`, not while it works |
| `POST /agents/<id>/close` `{ session }` | A UI closed its tab; ends the subscriptions it alone had |
| `GET /agents/<id>/groups` | Groups (`name`, `conversations`) and `order` (`recent` or `name`) ([agents.md](agents.md#groups-of-conversations)) |
| `POST /agents/<id>/group` `{ session, group }` | Moves a conversation and its branches into a group; `null` takes it out; 409 for a branch alone |
| `POST /agents/<id>/groups` `{ action, name?, to? }` | `add`, `rename` (`to`), `remove` (with its conversations but `main`; 409 while one works), `order` (`to`: `recent` or `name`) |
| `POST /agents/<id>/branch` `{ session, at?, to?, worktree? }` | Branches after your message `at` (a task number; default all) into `to`. Answers `session`, `tasks`, `outside`, `worktree`. Not while it works ([agents.md](agents.md#branching-a-conversation)) |
| `POST /agents/<id>/compact` `{ session? }` | Summarises the earlier part; queued like a message, answers the task id |
| `POST /agents/<id>/reset` `{ session? }` | Starts over; the conversation's own subscriptions end |
| `POST /agents/<id>/undo` `{ session? }`, `POST /agents/<id>/redo` `{ session? }` | Takes back your last message with its file changes, or brings it back ([coding.md](coding.md)) |
| `GET /agents/<id>/goal?session=`, `POST /agents/<id>/goal` `{ session, objective }` or `{ session, action }` | Goal mode: `{ goal }` with `objective`, `status` (`active`, `paused`, `met`, `blocked`, `limit`), round, note, the judge's reason. `objective` starts one; `action`: `pause`, `resume`, `clear`. Events on `agent/<id>/goal` ([agents.md](agents.md), "Goal mode") |
| `GET /agents/<id>/swarm?session=`, `POST /agents/<id>/swarm` `{ session, objective }` or `{ session, action }` | A swarm: `{ swarm }` with `objective`, `status` (`active`, `waiting`, `done`, `paused`, `limit`), round, `checking`, note. `objective` starts one; `action` as for goals. Events on `agent/<id>/swarm` ([boards.md](boards.md), "A swarm") |
| `GET /agents/<id>/bookmarks?session=`, `POST /agents/<id>/bookmarks` `{ session, action: "add", text, source, start, end }` or `{ session, action: "remove", id }` | The Pine app's bookmarks: at most 200, `text` at most 10,000 characters |
| `GET /ui/tabs`, `POST /ui/tabs` `{ tabs, active, code?, notify? }` | The terminal UI's tabs (at most 50), code pane and bell, kept for next time. A conversation open in a tab is kept |

## Tasks

| Request | Purpose |
|---|---|
| `POST /agents/<id>/prompt` `{ prompt, session?, wait?, attachments?, whenBusy?, mentions?, quotes?, via?, cancelOnDisconnect? }` | Gives a task and waits for the result unless `wait: false` |
| `POST /tasks/<id>/now` | Stops the step under way so the work reads your steered message now; answers `{ sent }` |
| `POST /tasks/<id>/cancel` | Cancels a task |
| `GET /tasks?agent=&session=&status=&limit=`, `GET /tasks/<id>` | Tasks. Kind `notify` is pine's note to the agent, never your message (`meta.label`, `meta.body`). `meta.asked`: the questions that turn asked you, in call order (`question`, `header?`, `options?` `{ label, description? }`, `multiSelect?`) |
| `GET /tasks/<id>/transcript` | A task's steps with the start of each tool result; `?full=1` for whole results (up to 200,000 characters) |
| `POST /agents/<id>/terminal` `{ session, command, state, code?, seconds?, output? }` | The Pine app reports a command run with ▶ as `running` or `ended`; the conversation gets the output's end. Not for a conversation outside content started |

### Giving a task

| Field | Meaning |
|---|---|
| `whenBusy: "steer"` | Goes into running work instead of waiting; the answer carries `steered` |
| `mentions` | Files of the folder the message points at with `@` (`"src/a.ts#20-45"`); the agent is told to read them |
| `quotes` | Up to 20 `{ text, source, reply? }` of 10,000 characters, put before `prompt` as Markdown quotes, each followed by its `reply` (`prompt` may then be empty). `source` is `{ task, part }` (`part`: `"prompt"`, `"answer"`), `"letter"` or `"welcome"`. Kept in `meta.quotes` and `meta.body` |
| `attachments` | `{ name, data }` in base64, at most 10 files of up to 20 MB each, saved to `inbox/` in the workspace |
| `via: "app"` | The answer is read in the Pine app, where `bash` blocks get a Run button |
| `cancelOnDisconnect: true` | Cancels the task if the caller hangs up |

## Approvals

| Request | Purpose |
|---|---|
| `POST /approvals/<id>` `{ allow, always?, values? }` | Answers an approval |

`always: true` stops the same question for the conversation. A request with `inputs` (a token, a
password) needs `values: { <name>: "..." }`. An agent's `question` is no approval: it is answered by
`POST /agents/<id>/prompt` in its conversation, as any message.

## Folders, worktrees and files

| Request | Purpose |
|---|---|
| `GET /agents/<id>/folder?session=`, `GET /agents/<id>/folders`, `POST /agents/<id>/folder` `{ session, folder }` | A conversation's folder, all of the agent's, and opening one (`null` closes). Refused for pine's home and code, other agents' workspaces, and while it works |
| `GET /agents/<id>/worktree?session=` | The worktree or `null`: `branch`, `base`, `path`, `repo`, `ahead`, `behind`, `dirty`, `merged`, `mergeable` ([coding.md](coding.md#a-worktree-for-a-conversation)) |
| `POST /agents/<id>/worktree` `{ session, name? }` | Moves the conversation into a new worktree; needs a folder, not while it works |
| `POST /agents/<id>/worktree/merge` `{ session, how?, message? }` | Merges into the base (`how`: `merge`, `squash`); a conflict answers 409 with `conflicts` and changes nothing |
| `POST /agents/<id>/worktree/update` `{ session }` | Brings in the base's new commits, or answers `conflicts` and changes nothing |
| `POST /agents/<id>/worktree/remove` `{ session, keepBranch? }` | Discards the worktree and, unless `keepBranch`, its branch |
| `GET /worktrees` | All of pine's worktrees; `orphan` marks one no conversation holds |
| `GET /agents/<id>/view/changes?session=`, `/view/diff?session=&path=`, `/view/tree?session=&path=`, `/view/file?session=&path=`, `/view/find?session=&q=`, `/view/grep?session=&q=` | Read-only views of the folder (or workspace): git changes, a diff, a folder, a file (256 KB; `&max=` up to 2 MB), file names, contents |
| `POST /agents/<id>/view/files` `{ session?, op, … }` | `op`: `folder`, `file`, `rename`, `copy`, `move`, `delete` in that folder ([coding.md](coding.md)) |
| `POST /agents/<id>/view/write` `{ session?, path, text }` | Saves one text file of the folder (or workspace), at most 2 MB, into an existing folder, never outside ([coding.md](coding.md), "From a script") |
| `GET /agents/<id>/view/turn?session=`, `/view/turndiff?session=&path=` | What your last message changed (what `/undo` takes back): `{ task, prompt, root, files, more, note? }`, at most 300 files; one file's diff |
| `GET /agents/<id>/programs?session=`, `POST /agents/<id>/programs/stop` `{ session, id }` | Programs the conversation's commands left running (`background`, `output`), and stopping one |

## The browser

For a UI that shows and drives the bundled browser of one of your conversations ([mcp.md](mcp.md)).

| Request | Purpose |
|---|---|
| `GET /agents/<id>/browser?session=` | `{ open, tabs: [{ title, url }], current, window, visited? }` (`visited`: the agent's last 12 addresses). Starts nothing; your own conversations only |
| `GET /agents/<id>/browser/frame?session=` | The page as a JPEG; 404 while there is none |
| `POST /agents/<id>/browser/input` `{ session, ops }` | Your input in order, each `{ do: "...", ... }`: `click` (`x`, `y`, `button?`, `count?`), `move`, `drag` (`x2`, `y2`), `wheel` (`dx`, `dy`), `text`, `key` (`Shift+Tab`), `back`, `forward`, `reload`, `tab`/`closetab` (`index`), `newtab`, `size` (`w`, `h`). What does not fit is left out |
| `POST /agents/<id>/browser/open` `{ session, url }` | Opens an address through the browser's guard, starting the browser without a turn. Allows a local address for the conversation, never pine's control port |
| `POST /browser/embedded` `{ host? }` | A UI draws the browser itself, so for 90 seconds `browser_show` opens no window. On this computer the Pine app also names its own browser (`host`), which then holds the browsers of your conversations |

## Events, state and boards

| Request | Purpose |
|---|---|
| `GET /events?topic=&after=&limit=` | The event log; `after=<id>` pages forward |
| `GET /events/stream?topic=` | Every event as server-sent events, including streamed text and tool calls ([events.md](events.md), "Topics") |
| `POST /events` `{ topic, payload, trust? }` | Publishes as owner; `"trust": "untrusted"` lowers it |
| `GET /state?key=`, `POST /state` `{ key, value }` | Shared state; `null` deletes |
| `GET /boards`, `GET /boards/<id>`, `GET /agents/<id>/boards?session=`, `POST /agents/<id>/boards/post`, `POST /boards/<id>/post`, `POST /boards/items/<n>`, `POST /boards/<id>/remove` | Boards ([boards.md](boards.md), "From the control API") |
| `POST /hook/<name>` | A webhook of `http.hooks` or a `webhook` source. No token, but its own secret unless `"open": true`; refused from a web page (`Origin`, `Sec-Fetch-Site`) |

## Sources and subscriptions

| Request | Purpose |
|---|---|
| `GET /sources`, `GET /agents/<id>/sources[?session=]` | Sources and their state; those the agent can subscribe to, and how (`agent`, `global`, `local`) |
| `POST /agents/<id>/subscribe` `{ source, session?, note?, when?, throttle?, debounce?, separate? }`, `POST /agents/<id>/unsubscribe` `{ source, session? }` | An agent's subscriptions; `session` makes it one conversation's |
| `POST /subscribe` `{ source, ... }`, `POST /unsubscribe` `{ source }` | All agents' subscription |

## Pictures, video and sound

| Request | Purpose |
|---|---|
| `GET /media/tool/<id>` | A picture a tool returned (ids in `images` of `agent/<id>/tool` events and transcripts) |
| `GET /tasks/<id>/images/<n>` | The n-th picture of a task |
| `GET /agents/<id>/image?path=&session=` | A picture, video or sound file of the workspace or folder; anything else is "not found" |
| `POST /images/fetch` `{ url }` | Fetches a picture (20 MB), video or sound (100 MB) from a public https address |

## Setting pine up through the control API

What the main agent sets up by tool, a program does here, with the same checks and no question to
you: whoever has the token is you. Each POST matches the tool or command named.

| Request | Purpose |
|---|---|
| `GET /overview` | `{ version, home, main, platform, sandbox, browser, warnings, modelNotes, log }`: browser present, `pine check`'s security notes, model key problems, log file |
| `GET /settings` | Live settings as `{ key, title, about, kind, now, live, saved? }`; `kind` is `"model"`, `"theme"`, `"view"`, `"boolean"`, `"duration"`, `{ one: [...] }` or `{ from, to }`; `live` holds at once, `saved` from the next start (`settings`) |
| `POST /settings` `{ key, value }` | Changes one (`set_setting`); `"default"` removes it. Answers `{ key, now, live }` |
| `GET /themes` | Themes of the `themes` folder with colors, the one in force (`theme`), `chosen` |
| `GET /views`, `GET /views/<name>` | Views (`views`, `view`, `chosen`), and one view's code without types ([views.md](views.md)) |
| `GET /agents/<id>/detail` | `{ id, main, description, color?, scroll, workspace, dir, model?, defaultModel, thinking, mode, tools, allTools, delegates, network, read, write, holdings, files }`; `files` has `instructions`, `soul`, `tooling`, `memory`, `rules`. Change with `POST /agents/<id>/update` |
| `GET /shared`, `POST /shared` `{ name, text }` | The files for all agents (`AGENTS.md`, `TOOLS.md`, `USER.md`) as `{ name, about, text }`, and replacing one |
| `GET /skills` | Every skill with its `instructions` |
| `POST /skills` `{ name, description, instructions, agent? }`, `POST /skills/remove` `{ name, agent?, session? }` | Writes (`add_skill`) or removes a skill; one from a folder named in a configuration file is refused |
| `GET /schedules` | `{ name, scope, session?, when, task?, next?, topic }`; `scope` is `global` or an agent |
| `POST /schedules` `{ name, task, cron? \| every? \| at? \| in?, agent?, session?, replace? }`, `POST /schedules/remove` `{ name, agent? }` | Adds (`add_schedule`) with exactly one of `cron`, `every` (at least `1m`), `at` (`"2026-12-24 17:00"`), `in` (`"20m"`), or removes. With `replace`, the schedule of that name and agent is changed in place; if the change fails, it stays as it was |
| `GET /routes` | The routes of `pine.json`; `of` names the agent a route belongs to |
| `POST /routes` `{ name, on, ... }`, `POST /routes/remove` `{ name }` | Adds a route at once (`add_route`: `when`, `throttle`, `debounce`, `agent`, `prompt`, `session`, `set`, `publish_topic`, `publish_payload`, `call_prompt`, `call_system`, `call_model`, `ask_questions`, `ask_model`, `ask_data`, `run_command`, `run_agent`, `trust`, JSON values as text), answering `{ name, lines, wider? }`; or removes. `of` makes it an agent's own route (not the main agent's): it listens to that agent's sources and state, acts only within it, and goes when the agent goes. `replace` changes the route of that name in place, checked as if it were gone; an agent's route stays that agent's |
| `GET /decisions` | Decision models (`name`, `model`, `server`, `host`, `where`, `routes`) and the TypeSafe sign-in |
| `POST /decisions` `{ name, server? \| url?, model?, key?, local? }`, `POST /decisions/remove` `{ name }` | Adds (`add_decision_model`) or removes one; 409 while a route asks it ([configuration.md](configuration.md), "Decision models") |
| `POST /decisions/typesafe` `{ key }`, `POST /decisions/typesafe/remove` | Signs in to TypeSafe or out (`pine login typesafe`) |
| `GET /sources/types` | `{ name, summary, options, own }`: `options` is the schema (`secret: true` marks secrets), `own` registered here |
| `POST /sources/propose` `{ name, type, options, agent?, ask? }` | What a source would mean, writing nothing: `{ does, opens, needs, owner?, tell? }`; `needs` lists the secrets for `values` |
| `POST /sources` `{ name, type, description, options, agent?, own?, values?, ask? }`, `POST /sources/remove` `{ name, agent? }` | Sets up a source (`add_source`) with nobody subscribed; `values` go into `.env`, `own: true` takes its reports as your words. Removing takes subscriptions and secrets along |
| `GET /models/servers` | Your model servers (`pine model list`), each model with `limit`, each server with `runs` |
| `POST /models/servers` `{ name, url, key?, context?, reasoning? }`, `POST /models/servers/remove` `{ name }` | Adds a server (`pine model add`); 409 with `locked: true` until the right `key`. Removing answers 409 with `users` while a model is used |
| `POST /models/servers/limit` `{ name, model, limit }` | Runs at a time for a model (`limits.models`): 1 to 64, or `null` |
| `POST /models/model` `{ model, context? }` | Adds a model of your server as `server/id` (`add_model`) |
| `POST /models/model/set` `{ model, context?, maxTokens?, images?, reasoning?, runs? }` | Changes only what is given (`configure_model`); `runs` for any model (`0`: pine's limit). Answers `{ model, changed }`, 400 if nothing changes |
| `POST /models/model/remove` `{ model }` | Removes a model (`remove_model`); 409 while used, 400 for a server's last model |
| `GET /models/local` | Servers on this computer's usual ports (llama.cpp 8080, Ollama 11434, LM Studio 1234; Pinecone 8080 with MCP on 8090): `{ found }` of `{ id, title, url, locked, models, mcp? }` ([setup.md](setup.md), "A model server on this computer") |
| `GET /models/providers` | Model providers: `{ id, name, signedIn, via, models, oauth }`; `via` is `oauth` or `api_key`, `oauth` means a browser sign-in exists |
| `POST /models/login` `{ provider, type? }` | Starts a sign-in to a model provider (`pine login`; `type`: `api_key`, `oauth`); answers `{ id }` |
| `GET /models/login/<id>`, `POST /models/login/<id>` `{ answer }` or `{ cancel: true }` | The sign-in's state `{ lines, url?, code?, question?, done, error?, models? }`. Open `url`, enter `code`, answer `question` (`{ message, secret, options? }`); answers are kept nowhere |
| `POST /models/logout` `{ provider }` | Forgets a provider's credential |
| `GET /mcp/states` | Whether each MCP server connects (`pine mcp list`) |
| `POST /mcp/login` `{ name, agent? }` | Signs in to a remote MCP server (`pine mcp login`); answers `{ code, out }` when done |
