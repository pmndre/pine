# Tests

pine moves fast and its UI changes constantly. A test must survive that. A test that breaks when
a button is reworded, a sentence is rephrased, a color shifts or a box moves a few pixels is not
protecting anything — it is a tax on every commit, and fixing it burns hours and tokens for no
gain. Those tests are **forbidden**. Every new test must meet the rules below.

The one question to ask before writing any assertion: **would this still pass if a designer
reworded the copy and nudged the layout, without changing what the software does?** If the answer
is no, the assertion is wrong — rewrite it to check the behaviour, not the surface.

## Forbidden

An agent must not add a test that does any of these. A reviewer must reject one that does.

- **Pixel and layout assertions.** No widths, heights, font sizes, font-size ratios, margins,
  paddings, offsets or coordinates. "Is it 14px" is never a test. Layout is the design's to change.
- **Exact UI copy.** No asserting a full sentence of on-screen prose, and no anchored
  (`/^…entire sentence…$/`) matches on a label, heading, status line, explainer or toast. Wording
  is the writer's to change.
- **Screenshot / visual-diff regression.** No image comparison that fails on any rendered-pixel
  change. (Saving a screenshot as a debugging artefact is fine; asserting on one is not.)
- **Incidental DOM shape.** No asserting tag names, class names, element nesting depth or child
  order that the feature does not actually depend on.
- **Order and timing that the code does not guarantee.** No relying on a sleep to make a race come
  out right, and no asserting an order the implementation is free to change.

## Required

Assert on what the software *commits to*, which outlives the UI:

- **State and structure the code owns.** Key on the stable hooks: `data-slot`, `data-task`,
  `data-state`, `data-item`, `role`, `aria-*`, a route's response, a stored value, a tool call and
  its arguments. These change only when behaviour changes. If a state distinction is currently
  visible only in prose, add a machine-readable hook to the component (e.g. `data-state="checking"`)
  and assert on that — do not assert the prose.
- **Data the test itself supplied.** A name, message, count or id the test fed in is a stable
  contract — matching it back is fine, because the test controls it. (`text=` matching an agent
  name you created, or a message you typed, is robust. `text=` matching a static label is not.)
- **The established rule, in full.** Invariants are meant to be pinned hard: a security property,
  a protocol, an API shape, a documented behaviour (the files in `docs/references/`, the rules in
  `AGENTS.md`). Assert these exactly and let them fail loudly — that is their job. A changed
  invariant is a real change, not churn.
- **A distinct outcome by its stable token, not its sentence.** When a test must prove the *right*
  error or state was surfaced, match the one distinctive token (a fingerprint, `over http`,
  `not installed`, a `value`/`tone` field), not the whole message. Loosen the wording, keep the
  distinction.

## Three systems

pine runs on Windows, macOS and Linux, and CI runs every test on all three. A test written on one
of them must not assume it. A test that passes on a Mac and fails on Windows for a reason that has
nothing to do with what it tests is fragile in the same way a pixel test is.

- **Paths.** Never write a path with a separator in an expected value. Build what you expect the
  way the code builds it (`path.join`, `path.relative`, `path.sep`), or compare after
  `path.normalize` / `path.resolve` on both sides. Where pine *hands a path out* (a control API
  answer, an event, a tool result, a stored value) it uses `/` on every system: that is the
  product's contract, so the fix for a `\` there is in the product, and the test then pins `/`.
  A path that is opened on this computer stays native and is compared natively.
- **Line endings and case.** Split lines with `/\r?\n/`. Do not rely on a file system telling
  `A.txt` from `a.txt`, nor on it not doing so.
- **Temp, home and the environment.** `os.tmpdir()`, `os.homedir()`, `harness()`: never `/tmp`,
  `~` or `$HOME` written out. macOS's temp folder is a link (`fs.realpathSync` it before comparing),
  Windows' has a short and a long name.
- **Files in use.** Windows refuses to rename, replace or delete a file another process has open.
  A test that swaps a file under a running stand-in retries for that moment, and a clean-up
  removes with `force` and does not fail the test.
- **Shell, programs and signals.** No `/bin/sh`, `ls`, `cat`, `kill -9` or a signal's name in a
  test that is to run everywhere: start `process.execPath` with a script, and end a process with
  what the harness gives. Links (`fs.symlinkSync`) need a right on Windows that a runner may lack.
- **What a system cannot do.** A test of something one system does not have (the sandbox on
  Windows, a Swift helper off a Mac) skips itself with the reason, in words
  (`skip: process.platform === "win32" && "no sandbox on Windows"`), never silently and never by
  failing. Everything else runs on all three: do not skip a test because making it portable is work.
- **Speed.** A runner is slower than a desk and Windows' is the slowest. No time limit a test sets
  for itself is a measurement taken on a Mac: wait for a condition, with `PINE_TEST_PATIENCE`.

Before pushing a test, read it once as each of the three systems would.

## In practice

- The desktop page is driven through its real DOM: prefer `[data-slot=…]`, `[data-task=…]`,
  `[data-state=…]` and `getByRole` over `text=` with a sentence. A `text=` filter is for data the
  test created, not for static copy. When the component lacks a hook you need, add one — a
  `data-*` attribute is a test contract, not a style change, and does not need a story.
- Backend notices (swarm/goal lifecycle, status lines) carry a stable `status`/`kind`/`state`
  field; the human `note` is prose. Render the state as `data-state` and assert on it.
- Confirmations and pickers: assert the choices offered (`value`, `tone`, that a destructive
  action and a cancel exist), not the dialog's title or body copy.
- When an assertion on text is genuinely about behaviour (a privacy guarantee that a name does
  *not* leak, that an error reached the page at all), say so in the assertion message and match
  the smallest token that proves it.

A test that fails on CI for a harmless wording or layout change is a bug in the test. Remove it or
rewrite it to the rules above; do not re-pin it to the new copy.
