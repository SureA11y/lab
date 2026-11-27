# AI answers (experimental)

A scan leaves some questions to a person: it marks them **can't tell**
("Review" in the report). With **AI answers** on, a scan step asks a model to
answer the ones it can settle, right after the scan. Each answer sits beside
the scan's own result, which never changes, with the model's reasoning and
what it was given. A person then reviews the answers in **Review AI answers**,
and only a person's answer counts in the conformance report.

This page is the guide: how to turn it on, every option of the field, the
server's settings, and how to review and measure the answers. Before using it
on a customer's site, read [design/ai-cant-tell-data-and-agents.md](design/ai-cant-tell-data-and-agents.md):
what leaves the lab, and how to set it up well. The reasoning behind the
feature is in [design/ai-cant-tell-design.md](design/ai-cant-tell-design.md).

## Turn it on

1. **A model.** In the app: **Run settings** (the sliders button beside the
   URL), **AI answers (experimental)**, **Claude API key**, then **Use this
   key**. The lab keeps it in memory only, until **Forget the key** or until it
   stops. Or, on the server, see [The server's settings](#the-servers-settings).
2. **The scan step.** Open the **A11y scan** step, **Show more options**, and
   type the options in the **AI answers** field: `{}` for the defaults.
   Empty is off. Do it on each scan step you want answered.
3. **Run**, then press **Review AI answers (n)** in the results' toolbar.

In a workflow file, the same field is the scan step's `ai`:

```json
{ "type": "a11yScan", "label": "Products", "ai": { "focus": true } }
```

## The options of the AI answers field

The field takes an object (in the app, typed as JSON). Every option can be
left out.

| Option | What it does | Default |
| --- | --- | --- |
| `budget` | `{ "calls": n, "seconds": n }`. `calls`: the most questions sent to the model in the whole **run** (all scan steps together); the rest stay open, marked "the call budget was used up". `seconds`: the time the AI may take on each **scan**. | `{ "calls": 10, "seconds": 60 }` |
| `maxCalls`, `seconds` | The same as `budget.calls` and `budget.seconds`, at the top level. | |
| `minConfidence` | From 0 to 1: an answer less sure than this stays open ("not sure enough"). | `0.6` |
| `preview` | `true`: sends **nothing**. Each question is kept exactly as it would be sent, to see what would leave; needs no model. See [Preview](#preview-see-what-would-leave). | off |
| `lessons` | The path, on the server, of a lessons file exported from **Review AI answers** (`ai-lessons.json`): house rules and corrected examples the model is given, as data. See [Lessons](#lessons). | none |
| `focus` | `true`: also answers the focus and keyboard questions, from a walk through the page with Tab. The one option that acts on the page. See [Focus and keyboard](#focus-and-keyboard-focus-true). | off |
| `focusStops` | The most Tab presses in that walk (up to 200). | `40` |
| `open` | `true` (with `focus`): after the walk, also **presses** each control that says it opens something on the page (a menu, a disclosure, a lightbox), to see whether the keyboard can use and close what opens. `"buttons"`: plain buttons too (most dialogs open from one), except those whose name says they act. It operates the page, within limits. See [Opening menus and dialogs](#opening-menus-and-dialogs-open-true). | off |
| `openControls` | The most controls pressed (up to 50). | `10` |
| `forms` | `true`: on a test system the server lists (`A11Y_AI_FORM_HOSTS`), the pass may **use the page's forms**: today, it tries a paste into a sign-in field with a paste handler, and puts the field back. Anywhere else nothing is tried and the question is answered from the handler's markup. See [Forms](#forms-forms-true). | off |
| `pictures` | `true`: the questions that use one (the image and text alternative questions, `image-of-text`, a control named by its tooltip) also send the **picture of the element**, so the model sees it. Sent only where the server allows it (`A11Y_AI_PICTURES`); a picture showing a value typed in a field is never sent. See [Pictures](#pictures-pictures-true). | off |
| `answer` | No effect: it names the kind of result answered, `"cantTell"`, the only kind there is. | |

Examples:

| You want | Type |
| --- | --- |
| The defaults | `{}` |
| See what would be sent, send nothing | `{ "preview": true }` |
| More questions and time, for a long workflow | `{ "budget": { "calls": 40, "seconds": 120 } }` |
| Only confident answers | `{ "minConfidence": 0.8 }` |
| The focus and keyboard questions too | `{ "focus": true }` |
| Everything, on a long page | `{ "focus": true, "focusStops": 80, "budget": { "calls": 20, "seconds": 120 } }` |
| A preview of everything, focus walk included | `{ "preview": true, "focus": true }` |
| Menus and dialogs opened too | `{ "focus": true, "open": true }` |
| Dialogs opened from plain buttons too | `{ "focus": true, "open": "buttons" }` |
| Paste tried in sign-in fields, on a test system | `{ "forms": true }` (with `A11Y_AI_FORM_HOSTS` on the server) |
| The model sees the images it is asked about | `{ "pictures": true }` (with `A11Y_AI_PICTURES` on the server) |
| With your lessons | `{ "lessons": "C:/audits/acme/ai-lessons.json" }` |

The model, the sites it may be used for and what is masked are **not** in this
field: they are the server's, so a workflow or a report shared with you cannot
change them.

## What it answers

By reading the page (always):

| Check | WCAG | The question |
| --- | --- | --- |
| `page-title-patterns` | 2.4.2 | Does the page title say what the page is about? |
| `img-alt-quality` | 1.1.1 | Is an image's alt text accurate in its context? |
| `svg-text-alternative-quality` | 1.1.1 | Is an inline SVG's name (aria-label, aria-labelledby or its title) accurate for what it shows, or for what its link or button does? (The model gets its title, desc, the symbol it draws, its classes and any text in it; path data is left out.) |
| `area-alt-quality` | 1.1.1 | Does an image map area's name say where its link leads, for the part of the picture it covers? (The model gets the area's place on the picture, the map's other areas and the picture itself.) |
| `input-image-alt-quality` | 1.1.1 | Does an image button's name say what the button does? (With the button's picture.) |
| `input-image-alt-decorative` | 1.1.1 | An image button with `alt=""` named by aria-label, aria-labelledby or title: does that name say what it does? |
| `object-text-alternative-quality`, `embed-text-alternative-quality` | 1.1.1 | Does an `<object>`'s or `<embed>`'s text alternative describe what it shows? (With what it embeds, and the picture when that is an image.) |
| `canvas-text-alternative-quality` | 1.1.1 | Does a `<canvas>`'s text alternative convey what it draws? (With what is drawn on it, read from its pixels.) |
| `video-poster-text-alternative-present` | 1.1.1 | A video with a poster and no name: does something near it (a caption, a heading) identify it? |
| `image-redundant-alt` | best practice | Does an image's alt only repeat the text beside it (read twice)? Asked only with **Include best-practice rules** on the scan step. |
| `heading-quality` | 2.4.6 | Does a heading that looks like a placeholder, a file name or an address describe its section? |
| `form-control-label-quality` | 2.4.6 | Can a field be told apart from the others with the same label (or a placeholder one)? (With the fields the checker found sharing it.) |
| `label-in-name` | 2.5.3 | Does a control's name contain its visible label (hyphens, abbreviations, icon glyphs, symbols)? |
| `link-name-quality-link-only` | 2.4.9 (AAA) | Does a generic link's text alone say where it leads? Asked with an AAA profile. |
| `identical-links-same-purpose` | 2.4.9 (AAA) | Do links with the same name and different addresses serve the same purpose? Asked with an AAA profile. |
| `identical-iframes-same-purpose` | 4.1.2 | Do frames with the same name and different content serve the same purpose? |
| `control-name-title-only` | best practice | A control named only by its tooltip: is its purpose visible without it? |
| `landmark-unique` | best practice | Do landmarks of the same role that share a name (or none) need names to be told apart? |
| `form-group-name-present` | 1.3.1 | Do ungrouped radio buttons or checkboxes answer one question that must be tied to them? |
| `form-control-single-label` | 3.3.2 | Is a field named by two or more labels still clearly named? |
| `table-fake-caption`, `td-has-header`, `table-th-has-data-cells` | 1.3.1 | Is a first row really a title; is a table without headers a data table; is a header with no cells wrong? (With the table's first rows, cell by cell.) |
| `bypass-blocks-present` | 2.4.1 | Does a page with nothing to skip by need a way past repeated blocks? (With the page's landmarks and skip links.) |
| `empty-table-header`, `heading-order`, `page-zones-landmark`, `region`, `focus-order-semantics`, `presentation-role-conflict`, `accesskeys` | best practice | Empty or hidden header cells, skipped heading levels (with the page's outline), header or footer blocks not exposed as landmarks and content outside them (with the landmarks), focusable elements with a non-interactive role, presentation roles that do not hold, shared access keys. |
| `contrast-minimum`, `contrast-enhanced` | 1.4.3, 1.4.6 | Text below its ratio that the checker could not judge: is a symbol text that matters, is it logo text, does a contrast switch count, does a placeholder say more than its label? Reasons that need a measurement (text stroke or shadow, semibold sizes) stay open. |
| `symbol-graphic-contrast` | 1.4.11 | Do low-contrast symbols (an arrow, stars) carry information a person needs? |
| `css-orientation-lock` | 1.3.4 | Does a rotation or a block hidden in one orientation keep the page from being used in it? |
| `tabindex`, `skip-link` | best practice | Does a positive tabindex pull the keyboard away; does a skip link with a missing or hidden target still work? |
| `focus-not-removed-by-script`, `iframe-focusable-content`, `scrollable-region-focusable`, `mouse-only-event-handlers`, `server-side-image-map-absent` | 2.1.1 | Does a focus handler take focus away; is a frame's content reachable; does a scrolling box need the keyboard; do pointer-only handlers do something a keyboard user needs; are a server-side map's places offered as links? (From what the checker reported, including its own runtime probe.) |
| `css-hidden-focus` | 2.4.7 | Does focus land on something hidden by CSS? |
| `aria-expanded-state-mismatch`, `aria-checked-state-mismatch`, `aria-hidden-focus`, `nested-interactive-controls-absent` | 4.1.2 | Is a screen reader told the wrong state; can focus land inside aria-hidden; is a control nested in another? |
| `contrast-computable` | 1.4.3, 1.4.6 | Text over a background image, a gradient, a blend or a filter, whose contrast the checker cannot compute: measured from a picture of the text as drawn (the contrast against the pixels behind it, and how much of the box is near the text colour). |
| `link-in-text-block` | 1.4.1 | A link told apart by colour alone: does focus (with `focus: true`) add an underline or another cue? |
| `text-spacing-content-loss`, `avoid-inline-spacing` | 1.4.12 | With the text spacing applied, is content lost (cut, overlapping), or is spacing forced in a way that matters? |
| `reflow-horizontal-scroll`, `resize-text-content-loss`, `meta-viewport-zoom-enabled` | 1.4.10, 1.4.4 | Is wide content excepted (a data table, a map) or lost; is resized text cut; does the viewport tag browsers apply allow zoom? |
| `target-size-minimum`, `target-size-enhanced` | 2.5.8, 2.5.5 (AAA) | Does an exception hold for a small target (a sentence, an equivalent, an essential size)? |
| `image-of-text` | 1.4.5 | Does an image button, or an image showing an SVG with text, hold text that could be real text? (From the SVG's source; for a picture-only button, with `pictures`.) |
| `invalid-field-error-message` | 3.3.1 | A field marked invalid with no shown message tied to it: does text the user meets with it say what is wrong? (With its label, description and error message, each with whether it is shown and heard, and the text of its row.) |
| `password-paste-enabled` | 3.3.8 | Does a sign-in field's paste handler stop pasting? (From the handler; with `forms`, from a paste tried.) |
| `live-region-announcements` | 4.1.3 | A live region hidden, busy, or added with its text: does the page rely on it for a status message users need? |
| `img-alt-decorative` | 1.1.1 | Is an image purely decorative? (The model is told what the picture shows: blank, one colour, or how many; an image from another site cannot be read and says so.) |
| `p-as-heading` | 1.3.1 | Is a bold paragraph really a heading? |
| `link-name-quality` | 2.4.4 | Does a link's text say where it goes? |
| `form-control-programmatic-label-quality` | 3.3.2 | Does a field's label say what to enter? |

From the focus walk (with `focus: true`):

| Check | WCAG | What it has to go on |
| --- | --- | --- |
| `focus-visible` | 2.4.7 | What looked different at each stop while focused |
| `focus-order` | 2.4.3 | The stops in order, with position, landmark and heading |
| `focus-not-obscured` | 2.4.11 | How much of each stop something else was on top of |
| `focus-not-obscured-enhanced-page` | 2.4.12 (AAA) | The same; any part hidden counts |
| `focus-appearance` | 2.4.13 (AAA) | The indicator measured: pixels changed at 3:1 contrast against a 2 px outline's area |
| `keyboard` | 2.1.1 | What a mouse can use that Tab never reaches; a focus trap. The AI may answer "fail", **never "pass"**: reaching is not using |

The scanner also asks some of these about one element rather than the page,
and the walk answers those too:

| Check | WCAG | Asked about | What it has to go on |
| --- | --- | --- | --- |
| `focus-visible-element` | 2.4.7 | A link or control whose focus outline a style removes | Its stop: what changed on focus, its picture |
| `focus-appearance-element` | 2.4.13 (AAA) | The same element | Its stop's measurement |
| `focus-contrast-element` | 1.4.11 | The same element | The same measurement: the pixels that changed on focus, those at 3:1 or more against what was there, and a 1 px line around it for scale (1.4.11 sets no size). No change at all is no indicator: a fail |
| `keyboard-element` | 2.1.1, 2.1.3 | A control with a click handler or a widget role | Whether Tab reached it, and why not. Never "pass" |
| `focus-not-obscured-box` | 2.4.11 | A fixed or sticky box (a header, a chat button) | The stops it was on top of, and how much |
| `focus-not-obscured-enhanced-box` | 2.4.12 (AAA) | The same box | The same; any part counts |

Which questions a page gets depends on what the scan leaves open: on a page
where the scan settles focus not obscured itself, for instance, it asks
nothing about it. The AAA questions (2.4.12, 2.4.13) come only with an AAA
profile (`"profile": "wcag22-aaa"` on the scan step).

The AI is asked only what the scan left as can't tell. A question the scan
decided itself (for instance 2.4.11 marked as passed) is not asked again.
Everything else (keyboard operation, captions, colour alone...) stays a
person's.

## Focus and keyboard (`focus: true`)

Once per page, after the questions answered by reading:

1. The walk remembers which element has focus and every scroll position.
2. From before the first element of the page's Tab order (elements with a
   positive `tabindex` first, as a browser does) it presses **only Tab** (never Enter, Space or an
   arrow key, so nothing is clicked or submitted), up to `focusStops` times.
   At each stop: the element, its name, landmark and heading, what changed on
   focus, how much of it is covered, and a small picture. For 2.4.13 or 1.4.11, when the
   scan asks it, an exact picture focused and later unfocused, to measure.
3. It ends when focus leaves the page, comes back to an earlier stop (a
   possible trap) or reaches the limit.
4. Focus and scroll are put back, and the page is compared with how it was:
   what it shows (its elements, its text, what is visible), its address,
   storage, cookies, focus and scroll. An attribute a component sets as focus
   passes does not count. If it is not the same, the focus answers are
   dropped and the run log warns that the next steps may meet a different
   page.
5. It looks, read only, for controls a mouse can use that Tab never reached,
   and takes a picture of the whole page.

It takes from about 1.5 to 3 seconds a page. One thing it cannot put back:
when nothing had focus, a later Tab in the workflow starts from the top of the
page.

## Opening menus and dialogs (`open: true`)

The walk only presses Tab, so what shows once a control is used is out of its
reach: a lightbox whose close button cannot take focus, one Escape does not
close, a dialog that does not take focus. With `{ "focus": true, "open": true }`,
after the walk (and only if it put the page back):

1. **What it presses:** only controls Tab reaches that say they open something
   on this page: with `aria-expanded`, `aria-haspopup` or `aria-controls`, a
   link to `#` (or to `javascript:`), or a link with `role="button"`. Never a
   submit button or a control in a form. A plain button only with
   `open: "buttons"`, and never one whose name says it acts (delete, discard,
   buy, pay, order, checkout, send, save, sign out, subscribe, accept...).
   At most `openControls` of them.
2. **Nothing leaves the page:** while it runs, a link's navigation is
   cancelled, a form is not sent, and any other navigation of the page (a
   script setting `location`) is stopped at the request; each is recorded as
   where it would have gone. Any request that could change something on a
   server (anything but GET, HEAD or OPTIONS) is stopped too, and recorded:
   a dialog that loads its content still opens, an action does not happen.
3. **Each control** is pressed with its key: Enter, or Space for a link with
   `role="button"` (then Enter if Space did nothing). Recorded: whether
   anything happened, what appeared (how much can take focus, its close
   control and whether that can take focus), where focus went, whether Tab
   reaches into it and stays there, and whether Escape closes it. For a
   control that names what it controls (`aria-controls`), only that counts as
   what opened.
4. **Closed again:** with Escape, else the control again, else its close
   control ("Close", "X", "×", "Cancel", "No"...); a control whose
   `aria-expanded` changed is pressed back to how it was (an accordion section
   open from the start stays open); then focus and scroll are put back, and
   the page is compared with how it was, by what it shows. A page its own script changed for good (some lightboxes move
   themselves to the end of the page) cannot be put back: what was seen is
   kept, and the run log warns that the next steps may meet a different page.

The keyboard question (still never answered "pass" by the AI) and the focus
order question get it as evidence, and the review lists it under the stops.
Turn it on for pages you may operate: it presses real controls. Requests
that change something on a server are stopped, but what a control does in
the browser (a preference saved in local storage) is only detected, not
undone. Arrow keys are not pressed: a menubar's submenus, reached with them,
are not opened.

## The server's settings

Set where the lab runs, as environment variables (also in
[Configuration](configuration.md)):

| Setting | What it does |
| --- | --- |
| `ANTHROPIC_API_KEY` | A Claude API key, if not given in **Run settings** (a key given there is used first). |
| `A11Y_AI_MODEL` | The Claude model (default `claude-sonnet-5-5`). |
| `A11Y_AI_PROMPT_CACHE` | `off` stops the Claude call from marking a page's evidence for caching. By default it is marked, so the three page-level focus questions (keyboard, focus order, focus visible), which share one walk of thousands of tokens, pay for it once and read it from the cache after. A service at `A11Y_AI_ENDPOINT` gets each question whole and can cache as it likes. |
| `A11Y_AI_ENDPOINT` | A service of your own that answers instead of the built-in Claude call: any model, or an agent with its own knowledge. It gets each question as data; the contract is in the design note, under "Plugging in another model or an agent", with an example in `docs/design/ai-cant-tell-spike/example-endpoint.js`. Used before the Claude key. |
| `A11Y_AI_ENDPOINT_KEY`, `A11Y_AI_ENDPOINT_NAME` | The endpoint's key (sent as a bearer token) and the name the report gives it. |
| `A11Y_AI_ENDPOINT_PICTURE` | `on`: the endpoint gets the pictures with every question (without it, only with the questions a step sends them with, below). |
| `A11Y_AI_FORM_HOSTS` | The hosts (test systems), comma-separated, where a step's `forms` may use the page's forms. Unset: nowhere; there is no `on`, a host must be named. |
| `A11Y_AI_PICTURES` | Whether a step's `pictures` may send the element's picture to the model, built-in call or endpoint. Unset or `off`: never. `on`: on every site questions may be sent about. Hosts, comma-separated: on those only (and their subdomains), for instance your test systems. |
| `A11Y_AI_ALLOWED_SITES` | The sites questions may be sent about, by host, comma-separated (a host includes its subdomains). Any other site sends nothing. Unset: every site. |
| `A11Y_AI_MASK` | `off` turns off masking. On by default: e-mail addresses, IBANs, card-like and phone-like numbers are masked in what is sent (not in the report). |
| `A11Y_AI_PREVIEW` | `on`: every run previews, whatever its steps say. |

## Pictures (`pictures: true`)

By default the model gets **text only**: the element's markup, the text
around it and what was read of its picture (blank, its colours, an SVG's
source). Some questions are settled faster by seeing it: is this photo what
the alt says, is there text in this image button. With `{ "pictures": true }`
those questions also send the element's **picture** as the page shows it
(the one in the review, at most 1000 by 700 pixels), as an image beside the
evidence.

- Only the questions that use one: the image and text alternative questions,
  `image-of-text`, and `control-name-title-only` (an icon named by its tooltip).
- Only where the server allows it: `A11Y_AI_PICTURES` (`on`, or the hosts).
  Unset, nothing is sent, and the step's summary says `pictures:
  "not-allowed"`. A site not in `A11Y_AI_ALLOWED_SITES` sends nothing at all.
- Never a picture that shows a value typed in a field (a password, a filled
  text field): the picture of such an element stays in the review only.
  Masking covers text, not pictures, so turn pictures on only for pages whose
  images you may send.
- The answer says so: **Answered by … , who saw the picture of the
  element.** In a preview, each question says `picture: true` and holds the
  picture.

## Forms (`forms: true`)

The engine asks about forms in three ways; the AI answers each.

- **A field marked invalid** (`invalid-field-error-message`). The page is in
  that state only after a submission with errors, so put it there with the
  workflow's own steps (fill, click **Submit**) before the scan step. The
  question is then answered by reading: the field's label, description and
  error message (whether each is shown, and heard by a screen reader) and
  the text of its row. No option needed.
- **A live region that may not speak** (`live-region-announcements`):
  answered by reading what the engine and its live-region hook saw.
- **A sign-in field with a paste handler** (`password-paste-enabled`). A
  handler that only cancels the paste (`return false`) is answered by
  reading; one that calls other script cannot be read. With `{ "forms": true
  }`, on a host in `A11Y_AI_FORM_HOSTS`, the pass **tries a paste**: it sends
  the field a paste event with test digits, sees whether the page cancels it
  and whether its own script fills the field (a split one-time code does),
  dismisses any alert, and puts every field of the form back as it was. On
  any other host nothing is tried. The tries come after the reading
  questions, and what they left changed is said (`forms.leftChanged`), as for
  the open walk.

Nothing is submitted: the pass never sends a form, and data a user typed is
never sent to the model (only whether a field holds a value).

## Preview: see what would leave

With `{ "preview": true }` (or `A11Y_AI_PREVIEW` on), nothing is sent. Each
question is logged exactly as it would be sent:

- a command-line run writes `ai-sent.json` beside `payload.json`;
- in the app, **Review AI answers** has **What was sent to the AI**, which
  downloads the same file.

Without preview, the same log is the record of what did leave, kept with the
report.

## Reviewing the answers

**Review AI answers (n)** opens a card per question: what the page says, the
proof (pictures; for the focus questions the stops, and the page with the
stops numbered on it), then your answer: pass, fail or unsure, and **Why**
when you differ from the AI. The AI's answer stays hidden until you answer,
unless you tick **Show the AI's answer before I decide**. Its buttons:
**Export my answers (CSV)**, **Export lessons for the AI**, **What was sent to
the AI**. The rows of the report show **AI answered n of m**, and **View
details** shows the AI's answer for that element too.

Under the counts, **By check** (collapsed) shows, per check, the questions
the AI answered and the ones it left open, and, per rule, the can't-tell
questions it does not take at all: what stays a person's whatever the AI
does (on a page scanned without `focus`, the focus and keyboard questions;
always, the ones no check above covers). The pass's summary (`ai` in each
scan's result) has the same counts for its scan in `byCheck`, by the
question asked.

Your answers are saved in the report: press **Download report** to keep them.
In **Review conformance**, a criterion with fails you confirmed offers **Add
to the remarks**; the conformance level stays your choice.

## Lessons

**Export lessons for the AI** writes `ai-lessons.json` from the questions you
answered pass or fail with a reason. Give it to later runs with
`{ "lessons": "path/to/ai-lessons.json" }`. Keep one per customer: it holds
their pages' content. Before relying on lessons, measure them.

## Measuring how far to trust it

```bash
npm run ai:agreement -- report.zip --lessons ai-lessons.json
```

It asks the questions you labelled again (no page is opened) and compares the
AI with you per check, above all how often it said pass where you said fail.
With `--lessons` it asks twice and accepts the lessons only if they lose no
agreement and add no such pass. `--preview` sends nothing. It writes
`agreement.md`, `agreement.json` and `ai-sent.json`; `--help` lists the rest.
Label 30 to 50 questions per check before trusting a check.

## Try it on the demo

The examples come with pages that make the scan ask every question above,
with the correct answers written down
([examples/demo-site/ai/expected.json](../examples/demo-site/ai/expected.json)):

```bash
node examples/serve-demo-site.js &
```

```bash
node src/cli/run-workflow.js examples/specs/ai-answers.spec.json --out runs/ai-demo
```

```bash
node examples/ai-demo-score.js runs/ai-demo/payload.json --why
```

Or open `runs/ai-demo/payload.json` in the app's **Open report**, then
**Review AI answers**. How it was evaluated, and how to evaluate the AI on a
real site (the W3C's Before and After Demonstration, ready to run), is in
[design/ai-cant-tell-eval/](design/ai-cant-tell-eval/README.md).
