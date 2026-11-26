# Control API

The HTTP API that the Pine app, the terminal UI and `pine` use, for your own scripts and programs too, on
`127.0.0.1:7463`. Every request needs
`Authorization: Bearer <token>` (in `data/http-token`); POST bodies are JSON. An error answers
`{ "error": "..." }`. `session` is a conversation's name; left out, it is `main`.

| Request | Purpose |
|---|---|
| `GET /health` | Liveness (no token) |
| `GET /status`, `/agents`, `/approvals` | As the CLI commands. An agent whose model cannot answer has `modelProblem`, saying why |
| `GET /models` | Models that have credentials, as `provider/id` |
| `GET /mcp` | Configured MCP servers |
| `POST /mcp` `{ name, server, agent? }` or `{ name, remove: true, agent? }` | Add or remove a server while the daemon runs |
| `POST /mcp/refresh` | Close idle sessions so they start again with the current servers |
| `POST /agents` `{ id, instructions, description?, color?, model?, tools? }`, `POST /agents/<id>/update` `{ color?, scroll?, instructions?, soul?, tooling?, model?, thinking?, mode?, tools?, delegates?, network?, read?, write?, forget? }`, `POST /agents/<id>/id` `{ agent, to }`, `POST /agents/<id>/erase` `{ agent, keepFiles? }` | Create an agent, change it, give it another id (409 while it works), remove it with everything it has. `id` and `erase` repeat the id in `agent`. What `pine agent add`, `update`, `rename` and `remove` call |
| `POST /models/refresh` | Read `models.json` and `.env` again |
| `GET /agents/<id>/sessions` | The agent's conversations: name, messages, last use, pin, tab, folder, when it will be removed, `branch` (`from`, `at`), `worktree`, `group` |
| `POST /agents/<id>/pin` `{ session, pinned? }` | Pin a conversation so it is kept; `pinned: false` unpins |
| `POST /agents/<id>/rename` `{ session, to }` | Rename a conversation; also while it works |
| `POST /agents/<id>/remove` `{ session }` | Remove a conversation for good. Not the main one, not while it works |
| `POST /agents/<id>/close` `{ session }` | A UI closed the conversation's tab: ends what it was subscribed to on its own |
| `GET /agents/<id>/groups` | The agent's groups (`name`, `conversations`) and `order` (`recent` or `name`). See [agents.md](agents.md#groups-of-conversations) |
| `POST /agents/<id>/group` `{ session, group }` | Put a conversation with its branches into a group (made if needed); `group: null` takes it out. 409 for a branch alone |
| `POST /agents/<id>/groups` `{ action, name?, to? }` | `add` a group, `rename` it `to`, `remove` it with its conversations but the main one (409 while one works), `order` the list (`to`: `recent` or `name`) |
| `POST /agents/<id>/branch` `{ session, at?, to?, worktree? }` | Branch after your message `at` (a task number; without it, all of it) into `to`. Answers `session`, `tasks`, `outside`, and `worktree` with `worktree: true`. Not while it works. See [agents.md](agents.md#branching-a-conversation) |
| `GET /agents/<id>/bookmarks?session=`, `POST /agents/<id>/bookmarks` `{ session, action: "add", text, source, start, end }` or `{ session, action: "remove", id }` | The Pine app's bookmarks in a conversation (at most 200, `text` at most 10,000 characters) |
| `GET /agents/<id>/worktree?session=` | The conversation's worktree or `null`: `branch`, `base`, `path`, `repo`, `ahead`, `behind`, `dirty`, `merged`, `mergeable`. See [coding.md](coding.md#a-worktree-for-a-conversation) |
| `POST /agents/<id>/worktree` `{ session, name? }` | Move the conversation into a new worktree of its folder's repository. Not while it works, not without a folder |
| `POST /agents/<id>/worktree/merge` `{ session, how?, message? }` | Merge the worktree into its base (`how`: `merge` or `squash`). A conflict answers 409 with `conflicts` and changes nothing |
| `POST /agents/<id>/worktree/update` `{ session }` | Bring the base's new commits into the worktree; or `conflicts`, changing nothing |
| `POST /agents/<id>/worktree/remove` `{ session, keepBranch? }` | Discard the worktree (and its branch unless `keepBranch`) |
| `GET /worktrees` | Every worktree of pine's, with `orphan` for one no conversation holds |
| `GET /agents/<id>/folder?session=`, `GET /agents/<id>/folders`, `POST /agents/<id>/folder` `{ session, folder }` | The folder a conversation works in; all of the agent's; open one (`null` closes it). Refused for pine's home and code, other agents' workspaces, and while it works |
| `GET /agents/<id>/goal?session=`, `POST /agents/<id>/goal` `{ session, objective }` or `{ session, action }` | Goal mode ([agents.md](agents.md), "Goal mode"). `GET`: `{ goal }` with `objective`, `status` (`active`, `paused`, `met`, `blocked`, `limit`), round, note, the judge's reason. `objective` sets a goal and starts; `action` is `pause`, `resume` or `clear`. Changes are events on `agent/<id>/goal` |
| `GET /agents/<id>/swarm?session=`, `POST /agents/<id>/swarm` `{ session, objective }` or `{ session, action }` | A swarm ([boards.md](boards.md), "A swarm"). `GET`: `{ swarm }` with `objective`, `status` (`active`, `waiting`, `done`, `paused`, `limit`), round, `checking`, note. `objective` starts one; `action` is `pause`, `resume` or `clear`. Changes are events on `agent/<id>/swarm` |
| `GET /agents/<id>/browser?session=` | The conversation's bundled browser, for a UI that shows it: `{ open, tabs: [{ title, url }], current, window, visited? }` (`visited`: the last 12 addresses the agent opened). Starts nothing. Only your own conversations |
| `GET /agents/<id>/browser/frame?session=` | That browser's page as a JPEG; 404 while there is none |
| `POST /agents/<id>/browser/input` `{ session, ops }` | What you did in that picture, in order: `click` (`x`, `y`, `button?`, `count?`), `move`, `drag` (`x2`, `y2`), `wheel` (`dx`, `dy`), `text`, `key` (`Enter`, `Shift+Tab`, `Meta+KeyA`), `back`, `forward`, `reload`, `tab`/`closetab` (`index`), `newtab`, `size` (`w`, `h`). Each `{ do: "...", ... }`; what does not fit is left out |
| `POST /agents/<id>/browser/open` `{ session, url }` | Open an address there, through the browser's guard. A local address is allowed for the conversation by this call; pine's control port never. Starts the conversation's browser if needed, without a turn |
| `POST /browser/embedded` `{ host? }` | A UI shows the browser itself: for 90 seconds `browser_show` opens no window. The Pine app on this computer also names its own browser (`host`), which then holds the browsers of your conversations |
| `GET /agents/<id>/programs?session=`, `POST /agents/<id>/programs/stop` `{ session, id }` | What the conversation's commands left running (with `background: true` and `output` for one in the background), and stopping one of them |
| `GET /agents/<id>/view/changes?session=`, `/view/diff?session=&path=`, `/view/tree?session=&path=`, `/view/file?session=&path=`, `/view/find?session=&q=`, `/view/grep?session=&q=` | Read-only views of a conversation's folder (or the agent's workspace): git changes, a diff, a folder, a file (256 KB; `&max=` up to 2 MB), file names, file contents |
| `POST /agents/<id>/view/files` `{ session?, op, … }` | Make, rename, copy, move or delete in that folder (`op`: `folder`, `file`, `rename`, `copy`, `move`, `delete`). See [coding.md](coding.md) |
| `GET /agents/<id>/view/turn?session=`, `/view/turndiff?session=&path=` | What your last message changed in the folder (what `/undo` takes back): `{ task, prompt, root, files, more, note? }`, at most 300 files; and one file's diff |
| `POST /agents/<id>/model` `{ model }` | Switch an agent's model and save it |
| `POST /agents/<id>/thinking` `{ level }` | Set an agent's reasoning level and save it |
| `POST /agents/<id>/mode` `{ mode, session?, anyway? }` | Switch an agent's mode. `anyway: true` with a `session` keeps bypass there after outside content |
| `GET /agents/<id>/todos?session=` | The agent's list of steps in that conversation |
| `GET /boards`, `GET /boards/<id>`, `GET /agents/<id>/boards?session=`, `POST /agents/<id>/boards/post`, `POST /boards/<id>/post`, `POST /boards/items/<n>`, `POST /boards/<id>/remove` | Boards. See [boards.md](boards.md), "From the control API" |
| `POST /agents/<id>/compact` `{ session? }` | Summarise a conversation's earlier part. Queued like a message; answers the task id |
| `GET /tasks?agent=&session=&status=&limit=`, `GET /tasks/<id>` | Tasks. Kind `notify` is a note of pine's to the agent (a command ended, a delegated task was answered), never your message; `meta.label` heads it, `meta.body` is what a client shows |
| `GET /tasks/<id>/transcript` | What a task did, step by step, with the start of each tool result; `?full=1` gives whole results (up to 200,000 characters) |
| `GET /events?topic=&after=&limit=` | The event log; `after=<id>` pages forward |
| `GET /events/stream?topic=` | Live events as server-sent events |
| `POST /events` `{ topic, payload, trust? }` | Publish an event as owner; `"trust": "untrusted"` lowers it |
| `GET /state?key=`, `POST /state` `{ key, value }` | Shared state; `null` deletes |
| `POST /agents/<id>/prompt` `{ prompt, session?, wait?, attachments?, whenBusy?, mentions?, quotes?, via?, cancelOnDisconnect? }` | Give a task; waits for the result unless `wait: false`. See "Giving a task" |
| `POST /tasks/<id>/now` | A message steered into running work and not read yet: stop the step under way so the work reads it now. Answers `{ sent }` |
| `POST /tasks/<id>/cancel` | Cancel a task |
| `POST /agents/<id>/terminal` `{ session, command, state, code?, seconds?, output? }` | The Pine app: a command you ran from an answer with ▶ is `running` or has `ended`. The conversation gets pine's note with the end of the output. Not for a conversation outside content started |
| `POST /agents/<id>/reset` `{ session? }` | Start a conversation over; its own subscriptions end |
| `POST /agents/<id>/undo` `{ session? }`, `POST /agents/<id>/redo` `{ session? }` | Take back your last message with the files it changed, or bring it back. See [coding.md](coding.md) |
| `GET /ui/tabs`, `POST /ui/tabs` `{ tabs, active, code?, notify? }` | The terminal UI's open tabs (at most 50), code pane and bell, kept for next time. A conversation open in a tab is not removed for being unused |
| `GET /media/tool/<id>` | A picture a tool returned (ids in `images` of `agent/<id>/tool` events and transcript steps) |
| `GET /tasks/<id>/images/<n>` | The n-th picture that came with a task |
| `GET /agents/<id>/image?path=&session=` | A picture, video or sound file in the agent's workspace or the conversation's folder; anything else is "not found" |
| `POST /images/fetch` `{ url }` | Fetch a picture (20 MB), video or sound (100 MB) from a public https address, for display |
| `GET /sources`, `GET /agents/<id>/sources[?session=]` | Event sources and their state; those the agent can subscribe to, with how (`agent`, `global`, and with `session` also `local`) |
| `POST /agents/<id>/subscribe` `{ source, session?, note?, when?, throttle?, debounce?, separate? }`, `POST /agents/<id>/unsubscribe` `{ source, session? }` | Change an agent's subscriptions; `session` makes it one conversation's |
| `POST /subscribe` `{ source, ... }`, `POST /unsubscribe` `{ source }` | The subscription of all agents |
| `POST /approvals/<id>` `{ allow, always?, values? }` | Answer an approval. See "Answering an approval" |
| `POST /hook/<name>` | Webhook: a hook in `http.hooks` ([events.md](events.md)) or a `webhook` source ([source-types.md](source-types.md)). No token; each has its own secret unless `"open": true`. Refused from a web page (`Origin` or `Sec-Fetch-Site`) |

**Giving a task** (`POST /agents/<id>/prompt`):

- `whenBusy: "steer"`: a message for a conversation that is working goes into that work instead of
  waiting (the answer carries `steered`).
- `mentions`: files of the conversation's folder the message points at with `@` (`"src/a.ts"`,
  `"src/a.ts#20-45"`); the agent is told to read them.
- `quotes`: what you quoted, at most 20, each `{ text, source, reply? }` (10,000 characters each;
  `source` is `{ task, part }` with `part` `"prompt"` or `"answer"`, or `"letter"`, `"welcome"`).
  Each goes before `prompt` as a markdown quote, followed by `reply`; `prompt` may then be empty.
  Kept in the task's `meta.quotes` and `meta.body`.
- `attachments`: `{ name, data }` with base64 data, at most 10 files of 20 MB, saved to `inbox/`
  in the agent's workspace.
- `via: "app"`: you read the answer in the Pine app, where a `bash` code block gets a Run button.
- `cancelOnDisconnect: true`: the task is cancelled when the caller hangs up while waiting.

**Answering an approval** (`POST /approvals/<id>`): a request that lists `inputs` (a token, a
password) is allowed only with `values: { <name>: "..." }`. A question from the agent's `question`
tool (`tool: "question"`, with `options` `{ label, description? }`, `choices`, `multiSelect`,
`header`) is answered with `values: { "answer": "..." }`: a label, labels joined by ", ", or option
numbers from 1 (`2`, `1,3`). Anything else reaches the agent as your own words. `allow: false`
gives no answer.

## Setting pine up through the control API

What the main agent sets up by tool and `pine` does in the files, a program of yours does with
these. The same checks apply, without the question to you: whoever has the token is you.

| Request | Purpose |
|---|---|
| `GET /overview` | `{ version, home, main, platform, sandbox, browser, warnings, modelNotes, log }`: `browser` whether the browser build is there, `warnings` the security notes of `pine check`, `modelNotes` problems with model keys, `log` the log file |
| `GET /settings` | The settings that can change while pine runs, each `{ key, title, about, kind, now, live, saved? }`. `kind`: `"model"`, `"theme"`, `"view"`, `"boolean"`, `"duration"`, `{ one: [...] }` or `{ from, to }`; `live`: holds at once; `saved`: a value in the file that holds from the next start. As the main agent's `settings` |
| `POST /settings` `{ key, value }` | Change one, as `set_setting`; `"default"` removes the entry. Answers `{ key, now, live }` |
| `GET /themes` | The themes in the home's `themes` folder with their colors, the one in force (`theme`) and `chosen` |
| `GET /views`, `GET /views/<name>` | The views in the `views` folder (`views`, `view` in force, `chosen`), and one view's code with its types taken out ([views.md](views.md)) |
| `GET /agents/<id>/detail` | One agent in full: `{ id, main, description, color?, scroll, workspace, dir, model?, defaultModel, thinking, mode, tools, allTools, delegates, network, read, write, holdings, files }`. `files` holds the text of `instructions`, `soul`, `tooling`, `memory` and your `rules`, where they exist. Changes go through `POST /agents/<id>/update` |
| `GET /shared`, `POST /shared` `{ name, text }` | The files for all agents (`AGENTS.md`, `TOOLS.md`, `USER.md`) as `{ name, about, text }`, and replacing one. `name` is one of the three |
| `GET /skills` | Every skill with its `instructions` |
| `POST /skills` `{ name, description, instructions, agent? }`, `POST /skills/remove` `{ name, agent?, session? }` | Write a skill for all agents or one agent, as `add_skill`; remove one. A skill from a folder named in a configuration file is refused |
| `GET /schedules` | `{ name, scope, session?, when, task?, next?, topic }` each; `scope` is `global` or an agent |
| `POST /schedules` `{ name, task, cron? \| every? \| at? \| in?, agent?, session? }`, `POST /schedules/remove` `{ name, agent? }` | Add a schedule as `add_schedule`: exactly one of `cron`, `every` (at least `1m`), `at` (`"2026-12-24 17:00"`), `in` (`"20m"`). Remove one |
| `GET /routes` | The routes of `pine.json` |
| `POST /routes` `{ name, on, ... }`, `POST /routes/remove` `{ name }` | Add a route with the values `add_route` takes: `when`, `throttle`, `debounce`, `agent`, `prompt`, `session`, `set`, `publish_topic`, `publish_payload`, `call_prompt`, `call_system`, `call_model`, `ask_questions`, `ask_model`, `ask_data`, `run_command`, `run_agent`, `trust` (JSON values as text). It acts at once. Answers `{ name, lines, wider? }`. Remove one |
| `GET /decisions` | Decision models (`name`, `model`, `server`, `host`, `where`, the `routes` that ask it) and whether pine is signed in to TypeSafe |
| `POST /decisions` `{ name, server? \| url?, model?, key?, local? }`, `POST /decisions/remove` `{ name }` | Add a decision model as `add_decision_model`, or remove one (409 while a route asks it). See [configuration.md](configuration.md), "Decision models" |
| `POST /decisions/typesafe` `{ key }`, `POST /decisions/typesafe/remove` | Sign in to TypeSafe with a key, or out, as `pine login typesafe` |
| `GET /sources/types` | The source types: `{ name, summary, options, own }`; `options` is the schema (`secret: true` on a secret), `own` registered here |
| `POST /sources/propose` `{ name, type, options, agent?, ask? }` | What setting that source up would mean, writing nothing: `{ does, opens, needs, owner?, tell? }`. `needs` lists the secrets to send as `values` |
| `POST /sources` `{ name, type, description, options, agent?, own?, values?, ask? }`, `POST /sources/remove` `{ name, agent? }` | Set up an event source as `add_source`, for all agents or one. `values` go into `.env`. `own: true` treats its reports as your words. Nobody is subscribed yet. Remove one with its subscriptions and secrets |
| `GET /models/servers` | Model servers of your own, as `pine model list`, each model with its `limit` and each server with `runs` |
| `POST /models/servers` `{ name, url, key?, context?, reasoning? }`, `POST /models/servers/remove` `{ name }` | Add a model server, as `pine model add`. One that wants a key answers 409 with `locked: true` until the right `key` is sent. Removing answers 409 with `users` while one of its models is used |
| `POST /models/servers/limit` `{ name, model, limit }` | Runs at a time for one model (`limits.models`): 1 to 64, or `null` for pine's limit |
| `POST /models/model` `{ model, context? }` | Add one more model of a server of yours, as `server/id`. As `add_model` |
| `POST /models/model/set` `{ model, context?, maxTokens?, images?, reasoning?, runs? }` | Change how a model is set up; only what is given. `runs` for any model (`0`: pine's limit). Answers `{ model, changed }`; 400 when nothing changes. As `configure_model` |
| `POST /models/model/remove` `{ model }` | Take one model of a server of yours out. 409 while used; 400 for a server's last model. As `remove_model` |
| `GET /models/local` | Model servers on this computer's usual ports (llama.cpp 8080, Ollama 11434, LM Studio 1234; Pinecone on 8080 with its MCP server on 8090): `{ found }`, each `{ id, title, url, locked, models, mcp? }`. See [setup.md](setup.md), "A model server on this computer" |
| `GET /models/providers` | Providers: `{ id, name, signedIn, via, models, oauth }`. `via`: `oauth` or `api_key`; `oauth`: a browser sign-in exists |
| `POST /models/login` `{ provider, type? }` | Start a sign-in, as `pine login` (`type`: `api_key` or `oauth`). Answers `{ id }` |
| `GET /models/login/<id>`, `POST /models/login/<id>` `{ answer }` or `{ cancel: true }` | Where the sign-in stands: `{ lines, url?, code?, question?, done, error?, models? }`. Open `url` yourself, enter `code`, answer `question` (`{ message, secret, options? }`). The answer is kept nowhere |
| `POST /models/logout` `{ provider }` | Forget a provider's credential |
| `GET /mcp/states` | Whether each MCP server connects, as `pine mcp list` |
| `POST /mcp/login` `{ name, agent? }` | Sign in to a remote MCP server, as `pine mcp login`. Answers `{ code, out }` when it is over |
| `POST /agents/<id>/view/write` `{ session?, path, text }` | Write one text file in a conversation's folder (or the agent's workspace), as an editor saves: at most 2 MB, into a folder that exists, never outside. See [coding.md](coding.md), "From a script" |
