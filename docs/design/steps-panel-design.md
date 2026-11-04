# Steps panel — design notes

A panel beside the Workflow and Custom steps editors that maps the steps, finds
them, and selects several at once to turn them off or on or to change them
together.

## The problem

A long config is hard to move around in. The steps nest (Group, Condition,
Iterate, Switch and its Cases, Repeat), five or six levels deep is common, and
the editor shows them as one long column of cards. Finding "every scan" means
opening each container in turn and scrolling; changing them all means doing it
once per step, and missing one is easy. Custom steps are worse: the editor shows
one definition at a time.

What exists today is the Step tree dialog (`#step-tree-open-btn`): a modal list
of every step that jumps to one and closes. It finds, but it does not stay, does
not filter, and the dialog has to be opened again for the next step.

## What was decided

Worked out on clickable prototypes before any code:

1. **A panel per section, always there.** Workflow and Custom steps each get
   their own panel at the left of their editor. They are not mixed: each
   selects and edits only its own steps. A filter in one says how many steps
   match in the other ("2 more in Custom steps →") and leads there.
2. **It is for navigating first.** Clicking a step scrolls the editor to it,
   opens its parent containers and its card, and highlights it. As the editor
   scrolls, the panel highlights the step in view; its own list never moves
   by itself (below). The step clicked keeps a stronger highlight than the
   one in view.
3. **Find and filter.** A text box (label, selector, URL, `{var:…}`, type) and
   type chips (All, A11y scan, Click, Containers, Disabled) with their counts;
   a chip names one type exactly (A11y scan is not Merged scan).
   Matches are bold; their parent containers stay, dimmed, so each match shows
   where it lives. Previous and next go through the matches.
4. **Hidden to a rail.** `‹` collapses the panel to a narrow rail at the left
   that keeps the way back, where you are and the number of matches. The choice
   is kept **in the browser, for each section**, like the theme and the last
   tab, never in the config: a config is a file people share and commit, and
   where one person keeps a panel is not part of it.
5. **Selecting is a mode.** A Select button turns on checkboxes; Done turns
   them off and clears the selection. Ticking a container selects that
   container only, never the steps inside it.
6. **The selection view.** While selecting, the editor shows only the selected
   steps, in the order they run, each with its path. While selecting, a click on a
   step in the panel only ticks or unticks it: the editor stays where it is
   and focus stays on the row. Enter shows the step's card, focus staying
   in the panel.
7. **Disable and Enable** sit on the selection bar from one selected step, each
   counting only the steps it would change ("Disable 4", "Enable 1").
8. **Edit together** is a bar on top of the selection view, closed by default
   and disabled until two steps are selected. It shows the fields the selected
   steps share, with what each holds now ("Mixed: WCAG 2.2 AA ×5, AAA ×1").
   Changing a field there marks each card with its old value struck out and the
   new one; the cards are the review, so there is no separate dialog. Apply
   writes every change as **one** history entry: one Undo puts it all back.
   Steps of several types show only the fields they all have.
9. **Custom steps say where they are used.** Each definition in the Custom
   steps panel reads "runs at 4, 6.3" or "not used"; its header in the editor
   links to each call, and a call in the workflow links to its definition.
   Edit together on steps inside a custom step warns that every call gets the
   change, and names them.

Left out on purpose:

- **Run results in the panel** (passed, failed, skipped). The panel is about
  the config, not a run. It may come later.
- **Repeating an edit in the other section** ("do the same in Custom steps").
  Each section keeps its own selection and edit; this can come later if people
  find themselves repeating edits.

## How it fits the code

- **The tree comes from the editor's lines, not from `getValue()`.** Reading
  every step from the form costs about 180 ms at 1000 steps (see
  `scheduleHistorySync` in `a11y-ui.js`); the panel needs only each step's
  type, title, label, number, disabled state and nesting, which the lines
  already carry: `data-action-type`, `data-base-title`, `data-alias`,
  `data-action-index-path`, `data-explicit-disabled`, the `label` field, and the
  nested `.actions-subcontainer`s (`getDirectActionLines`,
  `getDirectNestedActionContainers` in `action-tree.js`). It is rebuilt after
  edits pause, as Undo and Redo are.
- **Going to a step** reuses what the Step tree dialog does (`goToStep`): open
  the ancestors, expand the line, `focusLineForNavigation`. The panel holds the
  line itself, so it does not resolve paths again.
- **The model is plain data** (`steps-panel-model.js`): nodes, matching, counts,
  the ancestors kept for context, match navigation. It has no DOM, so it is
  tested in Node; the panel (`steps-panel.js`) draws it and wires it.
- **Accessibility.** The list is an ARIA tree (`role="tree"`, `treeitem`s with
  `aria-level`, `aria-setsize`, `aria-posinset`), one tab stop with a roving
  `tabindex`: Up and Down move, Home and End jump, Enter or Space goes to the
  step. The clicked step is `aria-current="true"`. The match count is a
  polite live region. The rail's button says what it does ("Show the steps
  panel"). Nothing is told apart by colour alone: matches are bold, context
  rows dimmed and marked as context for screen readers, disabled steps
  struck through and labelled "(disabled)".
- **Bulk changes go through the builder.** Disable and Enable use
  `setLineExplicitDisabled`; Edit together writes the new values into each
  line's fields and pushes one history entry, so Undo and Redo work as they do
  for any edit.
- **The selection view hides, it does not move.** A class on the editor hides
  every line that is neither selected nor an ancestor of a selected one, and
  ancestors show only their header, as the path. Lines are never moved, so
  nothing about saving, numbering or history changes.

## Custom steps

The editor shows one custom step at a time, so the panel cannot read them
all from the page:

- **Each custom step is a heading row**, with its steps under it. A text
  filter finds it by name; the type chips and the step counts leave it out,
  as it is not a step.
- **The one open in the editor is read from its lines; the others from
  their saved steps** (`readActionNodes`), numbered and keyed as the editor
  numbers them (number and the lists it is in), so a step keeps its row when
  its custom step is opened. Going to a step of one that is not open opens
  it first.
- **Where each runs** comes from the Workflow panel's steps (each call notes
  the custom step it runs) and from the other custom steps' saved steps,
  the open one's from its lines: reading it with `getValue()` once a custom
  step was the slow read the panel avoids.
- The panel took the place of the list of custom steps: their add, paste,
  undo and redo buttons are in it, and the editor is a region named by the
  custom step open in it ("Custom step: Log in"), as there are no tabs to
  name it any more.
- The Step tree dialog is gone: the two panels do all it did, and stay.

## Selecting

- **⌘-click on a Mac, Ctrl-click elsewhere,** on a step turns Select on with
  the current step and the clicked one, and while selecting adds or drops a
  step without scrolling. On a Mac, Ctrl-click is the right click: the
  panel names the key each system uses. From the keyboard, Space picks or
  drops the focused step, ⌘/Ctrl-A takes every one listed, Escape ends.
- **Disable and Enable** count only the steps they would change: a step off
  only because its container is off is not turned on by Enable.
- **Every custom step's steps can be selected,** open in the editor or not,
  as the filter finds them all. Those with no card are changed in the
  custom steps' saved steps: the one open is saved first, and the change
  is one change of the Custom steps, which the panel's Undo puts back. The
  selection view shows the open one's cards; the bar says how many selected
  steps are elsewhere.
- **A step is known by its number and the lists it is in, not by its card.**
  Undo and Redo draw every card again, and the selection, the current step
  and the folded containers must still be the same steps after. A card that
  is still there after a change (a step moved, or one before it removed) is
  followed to its new number; a removed one drops out of the selection.

## Folding

Containers fold in the list, from their caret or with Left and Right as in
any tree; `aria-expanded` says which. A filter shows every match whatever
the folding, so no match hides in a folded container. The step in view,
folded away, is shown by the nearest container listed.

## The list never scrolls by itself

The panel highlights the step in view and the current step, but never
moves its list to show them: not while the editor scrolls, not when going
to a step, not when stepping through matches. A list that moved on its
own took the row from under the pointer and lost the reader's place. The
one exception is focus: moving through the list with the keyboard, the
browser keeps the focused row in sight, or someone at the keyboard would
lose it (WCAG 2.4.11).

## Edit together

- A bar on top of the selection view, closed by default and disabled until
  two steps are selected. It lists the fields the selected steps all have,
  alike (same name and type), leaving out a step's own name, secrets, and
  the steps inside containers; the ones a card shows before "Show more
  options" come first, the rest behind "More fields".
- Each field is the field as the steps have it (Profile's choices, Tags'
  chips), made by the editor's own field maker, and opens with "Change …";
  until then each step keeps its own. It says what the steps hold now
  ("Mixed: WCAG 2.2 AA ×2, AAA ×1") and how many steps it would change. A
  list (Tags) adds or removes items rather than replacing them, so each step
  keeps its own.
- Each card it would change says what it will get, old value struck out and
  the new one, before anything is written. Apply writes only the fields that
  change, through the editor's own field setter, so the fields drawn as
  widgets take them too, and as one change: one Undo puts them all back.
- In Custom steps, it says every place that runs the custom step gets the
  change, and names them.
- What decides which fields are shared and what each step would get is
  plain data (`steps-bulk-edit.js`), tested on its own.

## Narrow screens

Below 900 px there is no room beside the editor. The panel is a bar at the
top of its section ("Steps · at 3.2"), the whole of which opens the panel
as a sheet: a modal `<dialog>`, which keeps focus in it, closes on Escape
and shades the page behind. Going to a step closes it, as the step is
behind it; while selecting it stays open until closed. Widening the window
puts the panel back beside the editor. Where fingers point, rows and chips
are larger targets.

## Find steps from anywhere

The spec had Ctrl+K open a box to go to any step. Ctrl/⌘+K was already the
Add step palette's, and a second search over the steps would have
repeated the panel's. Instead, **Ctrl+Shift+F** (⌘⇧F on a Mac) takes focus
to Find in the panel of the section focus is in, opening the section, the
panel or its sheet as needed; Escape in an empty Find takes focus back to
where it was. A single-key shortcut ("/") was left out: WCAG 2.1.4 asks
that those can be turned off. The field says its shortcut to screen readers
(`aria-keyshortcuts`) and shows it beside its label.

## What a thousand steps taught

The panel was stress-tested on a config of 981 steps, eleven levels deep.
The editor is a very large page, and it already takes over a second to
scroll at that size; the panel must add nothing to that. These keep it so,
and the later steps of the work keep to them too:

- **No layout reads while the editor scrolls.** The step in view comes from
  an `IntersectionObserver` on a one-pixel band at the reading line; the
  row to keep visible in the panel is worked out from its index and the
  height of one row, measured once. Reading places on scroll laid the whole
  editor out again, a third of a second each time.
- **Text changes edit the text node.** Other parts of the app watch the page
  for added and removed nodes (`scroll-reach.js` then scans every scroll
  box); replacing a text on each scroll made every scroll cost such a scan.
- **The panel never changes width.** A flex item grows to its widest
  content unless told otherwise (`min-width: 0`); a deep row widened the
  panel, squeezed the editor, and every card laid its buttons out again.
- **Controls are changed in place, not drawn again.** A chip or a row drawn
  again loses focus, and putting focus back lays the page out.
- **Only what is needed is read.** What a text filter looks in is read
  when the browser is idle, not on each rebuild.
- **Names wrap; nothing is cut.** Cut text is lost to someone who spaces
  text out (WCAG 1.4.12). A deep step's name moves to a line of its own.
- **No style rule asks about the whole page.** `html:has(dialog[open])` and
  its like were matched again at every change anywhere; a long workflow
  changes at each step it scrolls into view, as its buttons move into its
  menu. Classes on `<html>` say instead whether a dialog is open, the mode
  bar there, the totals card floating. Scrolling a screen went from a third
  of a second to about a tenth.
- **Watchers of the page ignore a step's own buttons.** The panel, Undo and
  Redo, and the scrolling boxes look again only at a change of the steps or
  of a box, not at buttons moving in and out of a step's menu; the menu
  reads the width it is given, not a measure that lays the page out.

## Order of the work

1. **Workflow steps panel, navigating** (done): the tree, find and chips, previous and
   next, going to a step, following the scroll, hiding to the rail and
   remembering it. The Step tree dialog stays until step 2 covers custom steps.
2. **Custom steps panel** (done): the same panel, with the definitions as the top
   level (replacing the list of definitions), where each is used, the links
   between calls and definitions, and the "N more in …" links between the two
   panels. The Step tree dialog goes.
3. **Selecting** (done): Select and Done, checkboxes, Select all matches, the
   selection view, Disable and Enable; with ⌘/Ctrl-click, and folding.
4. **Edit together** (done): the bar, the shared fields, the previews on the
   cards, Apply with one Undo, the warning for custom steps.
5. **Narrow screens and Find steps** (done): below 900 px the panel is a
   bar at the top of its section that opens it as a sheet; Ctrl+Shift+F
   (⌘⇧F) goes to Find from anywhere.

The prototypes these come from are kept with the design work, outside the
repository.
