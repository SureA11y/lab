# Spike: can a model answer "can't tell" from a saved report?

Step 1 of the plan in [ai-cant-tell-design.md](ai-cant-tell-design.md). Scripts
and data are in [ai-cant-tell-spike/](ai-cant-tell-spike/).

## Method

1. Ran `examples/specs/site-tour.spec.json` on the demo shop, release 1 and
   release 2, and read the `cantTell` occurrences from each `payload.json`
   (`extract.js`): 43 instances.
2. Set aside 24 that are the page-level manual checks (keyboard, focus order,
   focus visible: 8 each). They carry no element and need interaction, so they
   belong to the live prototype.
3. Built an evidence pack for the other 19 (`pack.js`): the element's HTML, the
   tool's question, `howToCheck` with `passWhen`/`failWhen`, details, 700
   characters of surrounding page source and, for images, the SVG source.
4. A model (a Sonnet subagent) judged each case blind: no release, no lean,
   no labels. It could answer pass, fail or unsure.
5. Compared with labels written before seeing its answers (`truth.json`).

## Result

| Check | Cases | Agreed | Unsure | Wrong |
| --- | --- | --- | --- | --- |
| p-as-heading | 4 | 4 | 0 | 0 |
| page-title-patterns | 8 | 6 | 2 | 0 |
| img-alt-quality | 3 | 3 | 0 | 0 |
| img-alt-decorative | 2 | 2 | 0 | 0 |
| form-control label quality | 2 | 2 | 0 | 0 |
| **Total** | **19** | **17** | **2** | **0** |

No wrong pass or fail. The two "unsure" are the home page's title, "Demo
Shop", which a person could also call borderline. The one tricky case, a
16px heart icon marked `aria-hidden` as the only content of a button (no
accessible name), was caught as a fail with 0.9 confidence.

## What it does not show

- **Tiny, easy sample.** 19 cases from one made-up shop, 17 of them the same
  few patterns repeated across pages. It shows the approach works, not how
  accurate it is.
- **The labels are mine, not a professional's**, written from the demo
  shop's source. The comparison the plan asks for still needs a person to
  label a real sample.
- **Data the tool does not give a model today:** `cantTell` occurrences have
  no element screenshot (only failures do), so the model judged images from
  their SVG source. Real photos need the screenshot saved for `cantTell` too.
- **24 of 43 instances (56%) are page-level manual checks** that no saved
  report can answer. They are the case for the live page.

## Next

- Save element screenshots for `cantTell` occurrences, to try image rules on
  real photos.
- Run the same pack on real sites, and have a person label a sample (30 to
  50 cases), including the rules this shop never triggers.
- Start the live prototype for the page-level checks.
