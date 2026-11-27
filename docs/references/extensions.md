# Extensions

An extension is a program that runs inside pine and gives agents more: new tools, changed
instructions, a hook on what a model is sent or what a tool does. pine is built on the pi
coding agent, and an extension is a pi extension. People also say plugin, add-on or package.
A pi package is how extensions are shared: one npm package or git repository that carries
extensions, and often skills that go with them.

An extension is not contained. It runs with your rights, outside the sandbox, in every
conversation of the agents it is for, and it can read what pine reads. Install only what you
trust. Most things an agent needs are a skill, an MCP server or an event source instead, and
those are contained ([setup.md](setup.md)).

## Installing one

| Way | How |
|---|---|
| In the Pine app | Settings > Extensions > **Install extension** |
| By asking | Tell the main agent: "install the extension npm:name" |

A source says where an extension comes from:

| Source | Example | What is installed |
|---|---|---|
| npm | `npm:pi-tools`, `npm:pi-tools@1.2.3` | That package, at the version npm gives now or the one named |
| git | `git:github.com/owner/repo`, with `@tag` or `@commit` | That repository, at the commit it is at now or the one named |
| A file or folder | `/Users/me/ext/hello.ts`, a package folder | A copy of it as it is now |

pine looks the source up first and shows what it found: the name, the exact version and what
the package says about itself. What you confirm is what is installed, pinned to that version.
An extension never updates by itself; **Check for an update** in Settings, or
`update_extension`, moves it to the newest version after you confirm.

An extension is for all agents or for one agent. It is loaded by each conversation from its
next message on.

npm does not run a package's install scripts unless you turn that on for the installation
(the switch in the dialog, `scripts: true` on `add_extension`). A package that builds
something while it is installed needs it; most do not.

Of what a package carries, pine loads its extensions and its skills. pi's prompt templates and
terminal themes are not used, and Settings says so on the extension.

## The tools

Only the main agent has them. Each change is put to you in every mode, and none is possible in
a conversation that has read outside content.

| Tool | What it does |
|---|---|
| `extensions` | Lists the installed extensions: for whom, from where, which version, what each brings |
| `add_extension` `source` [`agent`] [`scripts`] | Installs one from npm, git, or a file or folder in the agent's workspace; for all agents, or for `agent` |
| `update_extension` `source` [`agent`] | Brings one to its newest version; says so when it is that already |
| `remove_extension` `source` [`agent`] | Removes one, with what it gave agents |

`pine extensions` lists them in a shell, and `pine check` names each one.

## Where they are kept

| Place | For whom |
|---|---|
| `<home>/packages/` | All agents |
| `<home>/agents/<id>/packages/` | That agent |

Each holds what was installed (`npm/`, `git/`, `local/`) and a `settings.json` that lists it.
No agent can write there. An agent that is removed takes its extensions along.

Extensions you place yourself are loaded too, and pine lists them without changing them: a
file in `agents/<id>/extensions/`, and paths under `extensions` in `pine.json` or an
`agent.json` ([configuration.md](configuration.md)).

## Extensions pi has

pine never loads from pi's own folder (`~/.pi`). Other programs write there, and what lies
there is for every pi session, not for one agent. Settings > Extensions lists what pi has that
pine does not, under **In pi**, and **Install** copies one into pine at the version pi has.

## Writing one

A file with a default export that is given pi's API:

```ts
export default function (pi) {
	pi.on("before_agent_start", async (event) => ({ systemPrompt: `${event.systemPrompt}\n\nCite the paragraph for every legal claim.` }));
}
```

pi's guide is `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`. What it says
about pi's terminal UI (commands, shortcuts, renderers) does nothing in pine. A tool an
extension registers passes pine's approval gate like any other tool.
