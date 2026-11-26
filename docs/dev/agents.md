# Agents: how it works inside

For contributors. What an owner or an agent needs is in `docs/references/agents.md`; this file is
not indexed by the `manual` tool.

## Families (`src/catalogue.ts`)

- `DECLARED` are declared one by one; `GROUPS` are the families, each a router tool with an
  `action` and one line per action in its description (`BRIEF`); `LISTS` are the lists, one tool
  (`pine_list`) that takes several in `what`, because a model sends two calls of one tool in two
  answers about half the time.
- The main agent has about eighty tools. Declared one by one they were about 25 000 tokens,
  as families about 11 500 (measured when families were introduced; not re-measured).
- A family's arguments are typed, with enums listed, so a server that constrains output to the
  schema (llama.cpp) cannot be given an argument that does not exist.
- `ease()` and `fit()` take a call that is nearly right as meant: a name with capitals or spaces,
  a number or list written as text, `path` for a folder source's `dir`, a setting named by its last
  word, an action asked of the wrong family (`pine_schedules` with `schedules`).
- A call with wrong arguments returns the whole description of that action.
- `classify()` calls a family `look`; the tool it routes to (`ctx.executeTool`) passes the gate
  under its own name.

## A request that begins the same (`steady()` in `src/agents.ts`)

| Part of the request | How it stays the same |
|---|---|
| The tools | One order (`shortDeclarations`), fixed wording, the same for every conversation of an agent. No description names what changes (agents, sources): that is in the note. |
| The system prompt | `SHORT_PROMPT` only, the same for every conversation of the agent, across restarts. |
| The instruction files | The conversation's first message, in `<instructions>`, frozen when it began (kv `prefix:<agent>:<key>`). Lines added later are told once in the note ("New in your MEMORY.md since this conversation began"). A rewritten `MEMORY.md` up to `REWRITTEN_IN_NOTE` (8 000 characters) is told in the note as it now reads. A rules file that lost or changed lines, or a longer rewritten memory, makes the conversation take its instructions anew (`retakes()`): that conversation is read again once; tools and pine's text before it are not. |
| What changes | `contextNote()`, in front of the message, only when something other than the time changed. |

The cache tests in `test/catalogue.test.ts` and `test/agents.test.ts` fail when a request stops
being an extension of the one before.

A sub-agent is declared exactly what its conversation is declared, also the tools that are not its
to use; calling one of those returns `NOT_A_SUBAGENTS`. So it begins with what the server has read.

## Slots (`src/slots.ts`, `takeSlot`, `warm()`, `page()`, `lookAtSlots()`)

- `SlotBook` keeps, per server ("origin|model"), who each slot holds and how many tokens.
- A conversation goes back to its slot; one without takes a slot pine filled (`WARM`), else an
  empty one, else the cheapest to read again; never a busy one.
- `lookAtSlots` reads `GET /slots` (at most every two seconds, only when `/props` says this model
  is loaded) and marks slots held by another client as `OTHER`: not empty, not filled, taken last
  among slots of their size.
- A slot that kept nothing of a long conversation means the server restarted: pine then takes the
  other slots for empty too.
- `warm()` fills an idle slot after `limits.warmAfterMs` with what a conversation of the last
  agent begins with; one slot at a time, only while no agent works with that model, only when
  `/props` says the model is loaded. Refilled when instruction files changed.
- `page()` saves an evicted conversation of at least 2 048 tokens to
  `pine-<hash of server>-<n>.bin` through `POST /slots/<n>?action=save` and restores it on return.
  Not for warm slots, another client's, or a sub-agent's. A server that answers 501 or mentions
  `slot-save-path` is not asked again while pine runs.
- The goal judge (`src/goals.ts`) takes a slot of its own on a llama.cpp server.

## Smaller things

- Introductions (`src/hatch.ts`): kv `introduced:<agent>`, set when the owner's first prompt turn
  ends well. `introducedBefore()` marks agents that already answered the owner before the feature
  existed.
- `purposeOf()` (`src/config.ts`) reads the first paragraph of `workspace/AGENTS.md`
  (`PURPOSE_MAX` 240 characters) with `O_NOFOLLOW` and only when the file has one link, so a link
  cannot make pine show another file.
- `skillsOverride` and `agentsFilesOverride` keep pi from picking up `~/.agents/skills` and
  instruction files above the workspace; `instructionFiles()` is the one list, and it drops empty
  files and files that hold only what pine once wrote (`ownText`).
- A delegation held to a stricter level gets the session `<name>~<level>` (`submit()`), so it
  never shares history or MCP servers with the agent's own.
