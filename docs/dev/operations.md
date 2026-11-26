# Running pine from a checkout, and how versions are made

For contributors. What an owner needs is in [references/operations.md](../references/operations.md);
how to build, test and release is in the repository's `AGENTS.md` ("Commands", "Releases").

## A checkout

```bash
git clone https://github.com/pmndre/pine ~/dev/pine
```

```bash
~/dev/pine/bin/pine init
```

- `bin/pine` (and `bin/pine.js`, which npm's link starts) runs the TypeScript sources in `src/`
  as they are; the npm package holds them compiled. A fresh checkout installs its dependencies
  (`npm install`) on the first run.
- `npm link` in the checkout puts that copy on your PATH.
- `pine update` in a checkout is `git pull --ff-only` and `npm install`; it never rewrites your
  commits or changes. If `npm install` fails after the pull, it says how to go back
  (`git reset --keep <where it was>`).
- `pine version` says "checkout in <path>"; `pine update --next` and `--release` do nothing there:
  a checkout follows its branch.

## `pine dev-model`

`pine dev-model [--port 7464] [--model haiku]` serves an OpenAI-compatible API backed by
`claude -p` (`src/dev/claude-model.ts`), with model ids `claude-haiku`, `claude-sonnet`,
`claude-opus`. A configuration whose model is `dev/...` uses it; `pine service` starts it when
nothing serves it. For development and the live tests only.

## How a version reaches an owner

- Every push to `next` is published to npm as a preview (`<release>-next.<N>`, tag `next`); every
  push to `main` is a release. The version follows from the commit subjects (`scripts/version.mjs`):
  see `AGENTS.md`, "Releases".
- The subjects of the last releases travel with the package (`changes.json`, written by
  `scripts/changes.mjs`); `pine update` prints them as "What changed since ...", `feat:` as "new",
  `fix:` as "fixed", at most 25 lines. Write a subject as a sentence an owner can read.
- The channel a pine follows is `data/update-channel` in its home (`next` or `release`); without
  it, a version with `-next.` follows previews. `newer()` in `src/update.ts` puts a release after
  all its previews.
- npm may report a new version for a few minutes before it installs it; `pine update` checks the
  version on disk afterwards and says so instead of claiming success.
- The pine inside the Pine app (`installKind` "app": `Pine.app/Contents/Resources/pine`, or
  `resources/pine` beside `app.asar`) is never replaced by `pine update`; the app updates itself.
