# Conformance report (VPAT 2.5, WCAG and EU)

An Accessibility Conformance Report (ACR) in the layout of the ITI VPAT 2.5,
built from a report's runs and finished by a person in the app. It is what
procurement, a public body or a customer asks for, and it is written in the
standard's terms (criteria and clauses), not the scanner's (rules).

## Decisions

- **Layout:** VPAT 2.5, the edition that covers both WCAG and EN 301 549
  ("EU" and "WCAG" in one): a WCAG 2.x table per level (A, AA; AAA if asked)
  and the EN 301 549 tables.
- **Manual checks are recorded in the app:** a Conformance view of a report,
  where a reviewer sets each criterion's conformance level and remarks,
  starting from the automated draft. What they record is saved in the
  report's JSON, so it travels with the report.
- **Output:** one HTML file (opens anywhere, prints to PDF, accessible
  itself) and a Word document (.docx), which many procurement teams edit and
  sign. The .docx is written with JSZip, which the lab already ships, so no
  new dependency.

## What automation may say, and what it may not

The draft never claims more than the scans show:

| What the scans show for a criterion | Draft conformance level | Remarks |
| --- | --- | --- |
| A failure on some page | Does Not Support | The failures, on which pages, by rule |
| Nothing it applies to, on any scanned page | Not Applicable | "Nothing on the scanned pages this applies to; confirm for the rest of the product." |
| No failure, but questions (`cantTell`) | Not Evaluated | The questions, with the steps to check by hand |
| No failure and no question | Not Evaluated | "Automated checks found no failure; they check only part of this criterion." |
| Not checked by any rule | Not Evaluated | "Only a person can check this." |

"Supports" and "Partially Supports" are a person's verdicts, never the
draft's: core checks only part of each criterion (no EN 301 549 clause passes
on automation alone). Every row says whether its level is the automated draft
or a reviewer's, and a reviewer's level is kept when a later run is applied.

## The tables

- **WCAG 2.x:** the criteria of the report's target version (2.2 by default,
  2.1 or 2.0 when the target says so), Level A, then AA (then AAA if asked),
  each with its number, name, level, conformance level and remarks.
- **EN 301 549 chapter 9 (Web):** the same verdicts under their clause
  numbers. Chapter 9 restates WCAG clause by clause (9.1.4.3 is 1.4.3);
  V3.2.1 restates WCAG 2.1 with 4.1.1, V4.1.1 WCAG 2.2.
- **EN 301 549 chapters 4 (functional performance) and 12 (documentation and
  support):** listed for the author, as the target version numbers them
  (V4.1.1 renumbered chapter 12); no scan can judge them.
- **Chapters 5 to 8, 10, 11 and 13** (generic requirements, two-way voice or
  real-time communication, video, hardware, non-web documents, software,
  relay and emergency services): one line each that the author can mark Not
  Applicable for web content, or fill in.
- With a core that has test procedures and the EN 301 549 pack that gives
  them, each of these rows, like each WCAG criterion, shows how to check it
  by hand and takes an answer per check.

Product details on the report's first page: name and version, the report's
date, what was evaluated (the pages and flows the runs covered, read from
the report), the evaluation methods (the automated runs, with the engine and
its version, and the manual review, with who did it), contact, and notes.

## Steps

1. **Model and HTML** (`src/shared/conformance-report.js`,
   `src/shared/conformance-report-html.js`): the draft built from a report,
   and the HTML file, downloadable from a report in the app. Done.
2. **Recording in the app** (`src/js/conformance-review.js`): the
   Conformance view, a dialog opened by **Review conformance**, saved in the
   report's JSON (`conformanceReview`, described in the report schema) as
   the reviewer goes. **Copy the review of another report** carries an
   earlier review onto a later run, filling in only what it has not decided.
   Done.
3. **Word (.docx)** from the same model (`src/shared/conformance-report-docx.js`):
   written part by part with JSZip, with Title and Heading styles, a
   caption before every table, header rows repeated on every page, and the
   title and language set. Checked by opening it in LibreOffice. Done.
4. **Documentation, an example in the gallery, and the command-line runner.**
   `--format acr` writes the run's report into `exports/` (HTML and Word),
   and the review carries on from the baseline or from `--review <report>`,
   saved in the run's `payload.json` (`src/cli/conformance-export.js`). The
   gallery holds the demo shop's, with an example review, made by
   `npm run build:showcase`; `docs/use-cases/write-a-conformance-report.md`
   walks through it. Done.
