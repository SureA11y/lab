# The activity panel

Some actions take a while and go through steps: downloading a large report,
loading a zip of reports, sending a batch to Compare. The activity panel
(`src/js/activity.js`) shows them as they go, top right: one card per
action, its steps listed as each starts, with a spinner, and a check once
done.

```
┌───────────────────────────────────────┐
│ ◌ Download report "Checkout"   4.1s ✕ │
│  ✓ Copying the report            0.2s │
│  ✓ Adding the pictures           1.3s │
│    11 pictures                        │
│  ◌ Compressing                        │
│    80%                                │
│  [Cancel]                             │
└───────────────────────────────────────┘
```

## What it is for

An action the user started, that takes more than about a second, goes
through steps and ends with a result: a file downloaded, a report loaded, a
batch deleted. Not for scans and runs, which have the run view and the queue
panel, nor for a field's error, which belongs beside the field, nor for an
instant action such as Save configuration.

| Action | Steps |
|---|---|
| Download report (zip), Download all scans | Drawing the last scans · Copying the report · Adding the pictures · Packing the pictures · Adding the report data · Compressing |
| Download as a single file | The same up to Adding the pictures; over 50 MB it asks (below) |
| Compare → Download comparison, Download with the reports | Building the comparison · one step per report · Compressing |
| Open report: picking files | Reading each zip · Checking each report |
| Open report: Load selected | Reading each report · Merging · Drawing the report |
| Compare: loading files | Reading each zip · Adding each report · Drawing the comparison |
| Load configuration | Reading the file · Setting up the workflow |
| Queue: opening a result, Send to Compare | Downloading the result or adding each run · Drawing |
| Queue: Delete, Resume | Removing its files · Finding the passwords it needs · Queuing its runs again |

Queue → Download all is not listed: the server streams the zip as soon as it
is asked, so the browser's own download shows it from the start.

## How a card behaves

- **It shows once the action has taken 400 ms.** A quicker one never flashes
  a card; it is still in the Activity list.
- **A step that ends with a problem is a warning**, such as a picture the lab
  no longer has, or a file in a zip that is not a report. The action then
  ends "Done with warnings".
- **It ends with one line**: "Downloaded Checkout.zip", "2 reports loaded…",
  or what went wrong.
- **A card that ended well goes after 5 seconds**, not while the pointer is
  over the panel or focus is in it. One with a warning or an error stays
  until it is closed.
- **Cancel**, on the downloads, stops at the next step. Compressing cannot
  stop half-way, so Cancel takes effect once it is done.
- **✕ on a running card hides it**: the action goes on. Pressing the button
  that started it shows it again, briefly outlined.
- **The newest three cards stay open.** Older ones fold to their title line,
  which opens them again.
- **A question** replaces a confirm dialog where the action cannot go on
  without an answer. The card shows at once, its first choice takes focus,
  and focus goes back after the answer:
  - a single file over 50 MB: Download it anyway, Get the zip instead,
    Cancel;
  - a comparison zip loaded over reports already in Compare: Replace them,
    Keep them.

The button that started an action stays where it was and keeps focus: it
reads as unavailable (`aria-disabled`) and shows a spinner (`busy.js`). It is
no longer `disabled`, which dropped focus to the top of the page, and its
label no longer changes with each step.

## Accessibility

- **Only the start and the end are announced**, in a polite live region,
  never a step or a percentage. An error is announced at once (`role=alert`).
  An action whose tab already says the same in its own status line (loading
  in Open report and Compare, Load configuration, the queue's actions) is
  quiet: the card shows, and the status line does the announcing, so nothing
  is said twice. A question is always announced.
- **It never takes focus**, except for a question, as the confirm it replaces
  did.
- **Nothing is lost when a card goes.** The Activity button in the header,
  beside the colour theme, opens the panel itself with every action of this
  page, newest first, each with when it started, its steps and its result.
  It is not a dialog: the page stays usable, the button says it is open
  (`aria-expanded`), focus goes to the panel's title, and Escape (back to the
  button), the button again or a press elsewhere closes it. While it is open
  no card leaves; once closed, the cards that had gone go again. The button
  shows how many actions are in progress. Reloading the page clears the list.
- **In that list, a finished action is one line**: its icon, its title (cut
  short if need be, whole on hover), when it started and how long it took.
  Pressing it shows its steps and result; each opening of the list starts
  them folded again. An action in progress shows its steps.
- **✕ on a finished action in the list removes it from the list for good**
  ("Remove from the list: …"), said politely; focus goes to the next action,
  or to the list's title when none is left. An action in progress has no ✕
  there.
- **It never hides the control in focus** (WCAG 2.4.11). When focus moves to
  something under the panel, the panel shrinks to a chip ("1 action in
  progress") that opens it again. It sits below the header's buttons, never
  over them.
- **Each step's state is text** for a screen reader ("Done:", "In
  progress:"), not only an icon.
- With reduced motion, the spinners stand still. In forced colours, the icons
  and edges take the system colours.
- At phone width it is a strip along the bottom, at most half the screen
  high.

## Using it

```js
import {getActivity} from './activity.js';

const task = getActivity().start('Download report "Checkout"', {cancellable: true});
const step = task.step('Packing the pictures');
step.update('120 of 340');
step.warn('3 pictures could not be had');   // or step.done(detail)
task.throwIfCancelled();                    // between steps
const choice = await task.ask('This single file is 62 MB…', [
    {label: 'Download it anyway', value: 'file'},
    {label: 'Cancel', value: null},
]);
task.done('Downloaded Checkout.zip');       // or task.fail(error), task.cancel()
```

A new step ends the one before it as done. `getActivity().run(title, async
(task) => …)` ends the task as the work does: done, failed with what it
threw, or cancelled. Pass `quiet: true` when the page already says the start
and the end in a status line of its own.
