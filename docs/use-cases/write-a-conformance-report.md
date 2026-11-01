# Write a conformance report

**For** whoever has to answer "is it accessible?" for procurement, a public
body or a customer. **You get** an Accessibility Conformance Report in the
layout of the VPAT 2.5 (WCAG and EU edition), as HTML and as Word: a table
per WCAG level and the EN 301 549 chapters, each criterion with its
conformance level and remarks.

A conformance report is a person's statement, not a scanner's output. The lab
drafts what the scans can say and keeps the rest for a reviewer: the draft
never says "Supports", since automated checks test only part of each
criterion. A failure on some page is "Does Not Support", nothing on the
scanned pages to apply to is "Not Applicable", and everything else is "Not
Evaluated", with what the scans asked a person to check. What the reviewer
decides takes the draft's place, criterion by criterion.

## Steps

1. Run the pages and flows the report is about, as in
   [Audit a user journey](audit-a-journey.md): a scan of every state that
   matters, against the standard you answer to.
2. In the report, press **Review conformance**. Fill in the product: its name,
   version, a description, a contact, who reviewed it and how.
3. Go through the criteria. Each shows the automated draft, and what the
   scans found; set its **Conformance level** and say why in **Remarks**.
   Leave a criterion on the draft until someone has decided it. Chapters 4
   and 12 of EN 301 549 (functional performance, documentation and support)
   are for you to answer: no scan can.
4. What you record is saved in the report as you go. **Download report** to
   keep it: opening the report again brings it back.
5. In the Download menu, **Conformance report** gives the HTML, and
   **Conformance report (Word)** the `.docx` to edit and sign. Each row says
   whether it is reviewed or still the automated draft.

[The example in the gallery](../gallery/README.md) is the demo shop's, with
an example review of a few criteria.

## The next release

A review is worth keeping from one release to the next: most of it still
holds.

- In the app: run the new release, press **Review conformance**, then **Copy
  the review of another report** and pick the last reviewed report. It fills
  in what the new report has not decided, and keeps what it has; review again
  what the new run changed.
- From the command line, unattended: `--format acr` writes the run's
  conformance report into `exports/` beside SARIF and JUnit, and the review
  carries on from the baseline the run is compared with, or from `--review`:

  ```bash
  node src/cli/run-workflow.js spec.json --baseline @release-1 --format acr
  node src/cli/run-workflow.js spec.json --review release-1.zip --format acr
  ```

  The review is saved in the run's `payload.json`, so the next run carries it
  on too.

## What it can and cannot say

- It covers what was scanned: the pages and states of the runs, listed in the
  report. A criterion "Not Applicable" on those pages may apply elsewhere in
  the product.
- Automated checks find failures; they cannot establish conformance. A
  "Supports" in the report is the reviewer's, and so is the report.
- It is not a certification. [How far to trust the scans](../../README.md#how-far-to-trust-it)
  says what surea11y is tested against.

## See also

[The lab app](../app.md#a-conformance-report) ·
[Check against a standard](check-against-a-standard.md) ·
[The design](../design/conformance-report-design.md)
