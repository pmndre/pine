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
