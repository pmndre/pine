# Designing pine's page

pine's page (the Pine app, the web client and the mobile app draw the same `src/`) is stock shadcn
on Base UI with Tailwind v4, in the style `components.json` names. The shadcn skill says how shadcn
works; this file says how pine holds to it. Read the skill (`.agents/skills/shadcn/SKILL.md` and
its `rules/`), then this, before you change `src/` and when you review such a change, and hold
the change to both.

Where a rule is easy to get wrong, an example illustrates it; it is not the code of any page.

## Stock is the design

**Compose before you write.** Every part is stock components, composed the way shadcn's docs and
examples compose them, with their own variants, sizes and gaps. A page of a kind (settings, a
list, an empty state as `Empty`, a framed block as `Card`, a conversation) is the stock composition of that kind: find
shadcn's example for it and follow it. A good page reads like a shadcn example with pine's words
in it. Each part keeps its meaning: `Field` and `FieldSet` hold what is filled in, while what is
only read is an `Item` or plain HTML (`dl`, `section`); a dialog's words are its `Description`; a
confirmation's yes is `AlertDialogAction`, with the variant the action calls for, and
`AlertDialogCancel` only ever backs out.

```tsx
// Do: a settings page as shadcn composes a form.
<FieldGroup>
  <FieldSet>
    <FieldLegend>Updates</FieldLegend>
    <Field orientation="horizontal">…</Field>
  </FieldSet>
  <FieldSeparator />
  <FieldSet>…</FieldSet>
</FieldGroup>

// Don't: the same page as headings and boxes of your own.
<div className="flex flex-col gap-6">
  <h3 className="text-sm font-medium">Updates</h3>
  <div className="rounded-lg border p-4">…</div>
</div>
```

**The registry owns `components/ui`.** Its files are what the shadcn CLI writes for
`components.json`, and change only through the CLI. What stock cannot say in place is a
composition in `src/components/` that wraps the stock part; a wrapper that only renames or
bundles stock parts has no place. The chat components come from shadcn's registry too: AI Elements
is shadcn's pages of patterns, to compose in pine's own files, never the `@ai-elements` registry,
which is written on Radix.

**`className` places, the component styles.** A class says what the component cannot know: how
wide, where it aligns, whether it wraps, grows or truncates. Colour, type and spacing inside a
component are the component's: a monospaced value goes in a `code` or `span` inside the part,
not on the part. An icon outside a stock part carries `shrink-0`; inside one, the part sizes it.
Classes are on Tailwind's default scale; an arbitrary value is only for what no utility can say.

**Type has one base.** The root keeps the browser's 16px, each top-level part of the app (the
window, a side bar, a panel, a page) sets `text-sm` once on its root, and nothing below sets a
base size of its own: the stock parts carry their sizes. The one other base is the reading part's,
`text-read` (see "Reading comes first").

**Colour is a role.** Where shadcn has a token for the role, use shadcn's (`bg-muted`, `bg-accent`);
where it has none, add the role to the theme (`src/index.css`), never a colour to the markup, so
that every theme reaches it.

**Space comes from containers, and makes one rhythm.** Vertical rhythm is the stock containers'
own gaps, nested as shadcn nests them: the deeper a level, the tighter its gap, and things at the
same level always stand the same step apart. A gap of your own is for parts no stock container
holds, and takes a step the stock ones use: Tailwind's scale, in `gap-*` on the parent, never a
margin on a child. Edges line up: a page's parts share one column and one inset, the inset its
containers already carry, so that text starts at the same place from top to bottom. A part with
nothing to show is not rendered: an empty wrapper still takes its gap.

```tsx
// Don't: margins that fight it, and steps that differ between equals.
<FieldGroup>
  <Field className="mb-5">…</Field>
  <Field className="mt-1">…</Field>
</FieldGroup>

// Do: one column, the inset the card already has.
<div className="flex w-full max-w-2xl flex-col gap-6">
  <Card>…</Card>
  <Card>…</Card>
</div>

// Don't: a padding of its own on each block, so their text starts at different places.
<Card className="px-6">…</Card>
<Card className="px-3">…</Card>
```

**Loading has the shape of what comes.** While a part waits for what it shows, it draws stock
`Skeleton`s shaped like it, inside the same stock frame, so that nothing jumps when the real part
takes their place and no screen flashes in between. A part whose shape is not known yet, and work
under way, show that something is at work instead: loading and working read apart.

```tsx
// Do: the frame of the screen to come, with skeletons where its text will be.
<Empty>
  <EmptyHeader>
    <Skeleton className="h-5 w-48" />
    <Skeleton className="h-4 w-64" />
  </EmptyHeader>
</Empty>

// Don't: a different screen first ("Starting…"), or a spinner where the shape is known.
<div className="flex h-full items-center justify-center"><Spinner /></div>
```

**The stylesheet is a bridge.** `src/index.css` holds stock Tailwind and shadcn, the theme's
tokens, and what no `className` can reach. A look belongs in the markup.

**Every hand reaches it.** What the pointer can do, the keyboard can do: a control of your own is
the stock part that brings the keyboard with it (a `Button`, `Tabs`, a `Collapsible`, a link), and
shows focus with the stock ring, never one of its own. What appears on hover also appears on
keyboard focus, and is always shown where there is no hover (a narrow, touch screen).

```tsx
// Do: a stock part, which brings the keyboard and the focus ring with it.
<CollapsibleTrigger render={<Button variant="ghost" />}>Details</CollapsibleTrigger>

// Don't: something only a mouse can use, with a focus of its own.
<div onClick={toggle} className="cursor-pointer focus:outline-2">Details</div>
```

## When pine departs from stock

pine departs from stock only for a reason that holds across the page, never for one screen. These
are the reasons; a departure that fits none of them is not made.

**Valid and usable come before stock structure.** Where stock composition would make invalid HTML
or the wrong behaviour, the HTML and the behaviour win, and the look stays as close to stock as
it can: a row with two actions is two side-by-side buttons, since a button cannot hold a button;
a choice that must not be dismissed by a click outside stays an `AlertDialog`, even where it looks
like a palette.

**Reading comes first.** Text the owner reads at length is at the reading size, `text-read`
(15px, with a relaxed line height: room between its lines, as shadcn's typography gives running
text); the controls around it stay stock. Headings in it follow shadcn's typography (`markdown.tsx`):
each level a clear step above the next, more room above a heading than below it. The reading size is a step of the type scale,
set once in the theme (`src/index.css`), not a size in the markup: the browser's 16px
(`text-base`) reads a size larger than Claude and the apps beside pine, and moving the root
instead would move every stock size with it. The reading part says it on its root, to the stock
parts inside by their slot (`[&_[data-slot=message]]:text-read`), and never in the `className` of
a stock part that has a size of its own: `cn` knows Tailwind's scale and not this step, so it
keeps both sizes and the stock one wins. A stock behaviour that serves the reader is kept
even when it looks like something to fix: fields at 16px on small screens, so that iOS does not
zoom on focus (a field that reads at the reading size takes it from `md:` up, from its group:
`md:[&_[data-slot=input-group-control]]:text-read`); a conversation
that fades at the bottom only, where the newest text arrives.

```tsx
// Do: the reading part sets the reading size once, on its root; the controls in it stay stock.
<section className="text-read">
  <Message>…</Message>
  <Button variant="ghost" size="sm">Copy</Button>
</section>

// Don't: the size written into the markup, the controls grown to match the text, or the text
// shrunk to match the controls.
<section className="text-[15px]">…</section>
<Button variant="ghost" size="sm" className="text-read">Copy</Button>
<Message className="text-xs">…</Message>
```

**Shapes stay put.** A part keeps its shape and its line when its state or its room changes: a
badge does not raise the line it sits on, a button that loses its label stays a button, a field's
text keeps the form's font, items in a row stay apart enough to read as several.

**Quiet over busy.** Nothing draws attention it has not earned: no focus ring where focus is
always, and what runs all the time costs nearly nothing to draw
(a stepped fade rather than a shimmer that repaints every frame: measure it).

**Content is not chrome.** The theme colours the app, not what the app shows: a QR code, a web
page or a picture keeps its own colours.

## When a request and stock disagree

Stock wins, unless one of the reasons above covers the request. Build the stock version and name
the gap in your answer: what was asked, what stock does instead, what departing would cost. When
the owner chooses to depart, the change says which reason it follows, or adds a reason here.
