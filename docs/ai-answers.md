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
| `img-alt-decorative` | 1.1.1 | Is an image purely decorative? |
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
   focus, how much of it is covered, and a small picture. For 2.4.13, when the
   scan asks it, an exact picture focused and later unfocused, to measure.
3. It ends when focus leaves the page, comes back to an earlier stop (a
   possible trap) or reaches the limit.
4. Focus and scroll are put back, and the page is compared with how it was. If
   it is not the same, the focus answers are dropped and the run log warns
   that the next steps may meet a different page.
5. It looks, read only, for controls a mouse can use that Tab never reached,
   and takes a picture of the whole page.

It takes from about 1.5 to 3 seconds a page. One thing it cannot put back:
when nothing had focus, a later Tab in the workflow starts from the top of the
page.

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
| `A11Y_AI_ENDPOINT_PICTURE` | `on`: the endpoint also gets the pictures. Never to the built-in call. |
| `A11Y_AI_ALLOWED_SITES` | The sites questions may be sent about, by host, comma-separated (a host includes its subdomains). Any other site sends nothing. Unset: every site. |
| `A11Y_AI_MASK` | `off` turns off masking. On by default: e-mail addresses, IBANs, card-like and phone-like numbers are masked in what is sent (not in the report). |
| `A11Y_AI_PREVIEW` | `on`: every run previews, whatever its steps say. |

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

The pass's summary (`ai` in the scan's result) also counts, per check, the
questions it answered and the ones it left open (`byCheck`), so you can see
which checks the AI does not take.

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
