# A report as a package

A downloaded report needs no lab: it opens without a server, offline, with
all its pictures — the page and workflow screenshots and the pictures of
each flagged element (fail and can't tell). The pictures stay files, which
whoever gets the report can open, reuse and share on their own.

## The downloads

In the run workflow and open report tabs, the report's download button:

| Option | What you get |
|---|---|
| **Download report** (zip) | The whole report: `<name>.html`, `styles/report.css`, `images/`, `<name>.a11y-report.json` and `<name>.a11y-config.json`. Open the HTML in any browser; load the zip in the app (open report, compare). |
| Download all scans (zip) | The same, with the scans the tag filter hides. |
| Download as a single file | One `.html` with its styles and pictures inline. Above 50 MB it asks first, as a browser is slow to open a file that large, and offers the zip instead. |

Each download lists its steps in the activity panel as it goes, with
Cancel; a single file over 50 MB asks there first (`docs/design/activity-panel.md`).

There is no JSON-only download: the zip holds the report's JSON, for scripts
and tools as well as for the app, so every download a report has is complete.

## The package

```
Checkout.zip
├── Checkout.html               the report, to read
├── styles/report.css
├── images/
│   ├── 3f2a…e1.jpg             a page screenshot
│   └── 9c04…7b.png             an element picture
├── Checkout.a11y-report.json   the report, to load in the app
└── Checkout.a11y-config.json   the configuration it ran
```

Each picture is stored once, named by its content (the first 20 hex digits
of its SHA-256) and its type, so a picture the report shows a hundred times,
or in its HTML and its JSON, is one file. The JSON names it by its path in
the package wherever the report held it: a screenshot's `dataUrl` or
`publicUrl`, an occurrence's `elementScreenshot.url`, and so on, e.g.
`"elementScreenshot": { "url": "images/9c04…7b.png" }`.

Packing (`src/js/report-package.js`, `packPayloadImages`) turns into such a
path every string in the report that is a picture: an inline data URL (a page
screenshot), a link the lab serves (`/reports/...`, an element picture,
fetched once) or a link the app made from a package it loaded (`blob:`). A
`/reports/` link to something that is not a picture (an HTML report) is left
as it is. A picture the lab no longer has keeps its link and is logged.

## One format wherever a report is saved

A report saved anywhere is in this format, and loads anywhere: the open
report tab, Compare, or a package's own HTML.

- **Download report**, in the run workflow and open report tabs: the package
  above.
- **Compare → Download with the reports (zip)**: the comparison's HTML,
  `comparison.json`, and each report under `reports/` as a package's JSON,
  their pictures in one shared `images/` folder (`writeComparisonZip`). A
  report Compare loaded from a package shows its pictures from `blob:`
  links that only live in the page; saved as they were, it would load back
  broken, so they are packed again. The open report tab loads such a zip's
  reports too.

- **Queue → Download all**: the batch's folder, which the lab keeps as a
  package (`src/server-side/batch-package.js`): each run's result, its
  `images/` shared by all of them, `batch.json` and `metrics.jsonl`. **A run's
  Download** is its own package: its result and only the pictures it names.

What a comparison or batch zip does not have is each report's own HTML: that
is drawn from the report view, one report at a time. A report in either opens
in the app, and downloads from there as a whole package.

## What the JSON says

The report's JSON (`*.a11y-report.json`, and a CLI run's `payload.json`) is
described by `schemas/report.v3.schema.json`, so something outside the lab (a
dashboard, a script, a tool that files tickets) can read it without reading
the lab. It is strict on what such a reader relies on and open on the rest
(metrics, diagnostics, engine detail), which grows with the lab.

- `reportVersion` is `3`. A report without one is version 1, saved before.
- Each finding is written once, in its scan (`scans[].canonical.findings`).
  The findings by outcome across scans, one rule merged across them, are not
  saved: whoever needs them builds them from the scans, as the app and the
  CLI's summary do. Version 2 also saved them, as `findings` (and the app's
  copy as `a11yGlobalFindings`): two thirds of a large report.
- An occurrence does not repeat itself: `summary` is left out when it is its
  `failureSummary`, and `evidence.engineNode` (an engine's own record of the
  element) holds only what the occurrence does not say, so it is gone for
  surea11y's findings and keeps an add-on engine's extra detail. Read
  `failureSummary`, and `summary` only when there is no `failureSummary`.
- Each scan says what it was checked against: `profile` (`{ id, label }`,
  e.g. `{ "id": "en301549-v4.1.1", "label": "EN 301 549 V4.1.1" }`, or a WCAG 2.2 level
  as `wcag22-aa`) and `wcag` (`{ version, level }`, what that came to).
- Each occurrence has an `occurrenceId` (`occ_` and 14 hex digits): the same
  issue on the same element of the same page has the same id in every
  report, whatever the site's origin, so a staging run and a live one name it
  alike. It is a hash of the rule, the page's path and query, and the
  element's target, which is what comparisons match occurrences on, and
  compared occurrences carry it (in `diff.json` too). Its limit: an element
  whose selector changes (a renamed class) gets a new id, and reads as one
  issue fixed and another new.

A version 1 report recorded `wcagLevel`, `wcagVersion` and
`conformanceProfile` instead, and no ids. The app opens it as version 3
(`src/shared/report-format.js`, `upgradeReport`), giving its occurrences the
ids they would have had, so it shows, merges and compares like a new one; a
report merged from it, or saved again, is version 3. A version 2 report
opens the same way: its `findings` are dropped (the scans hold them) and its
occurrences lose what they repeat (`upgradeReport`).

The other files the lab writes for other software have schemas beside it:
`schemas/comparison.v1.schema.json` for a comparison zip's `comparison.json`,
and `schemas/diff.v1.schema.json` for a CLI run's `diff.json`. All three are
generated from `src/shared/report-schemas.js` by `npm run build:action-docs`.

## The configuration it ran

A report run from the app keeps the configuration it ran, as "Save
configuration" writes it (URL, workflow, custom steps; masked values
removed): in its JSON as `config`, and in its package as
`<name>.a11y-config.json`. A queue batch keeps its own, with every Batch
row, in its folder (`docs/design/workflow-queue-batch-design.md` §6), so Download
all carries it.

"Load configuration" takes a zip or a report as well as a configuration:

- a zip: its `.a11y-config.json` (the one nearest the top); failing that,
  one rebuilt from its `batch.json` (a batch saved before batches kept
  theirs); failing that, the `config` of a report in it;
- a report's JSON: its `config`. A report saved before reports kept it says
  so.

Hidden values, such as passwords, are never saved: the status asks to type
them again.

## Loading it

The open report tab takes a zip as well as JSON, picked or dropped. Each
report in the zip is staged on its own, named "zip › report". Compare reads
zips the same way (`readCompareZip`), and a comparison bundle's reports too.

Before a report's JSON is parsed, each `"images/<name>"` in it that the zip
has becomes a `blob:` link to that picture's bytes (`imageUrlsFromZip`,
`resolveImageRefs`). The links live as long as the page. Downloading a
report loaded this way packs its pictures again: `blob:` links are fetched
like the lab's.

Reports saved before packages load as they always did: pictures inline, or
links the lab serves.

## A picture that cannot be shown

A picture a report names but the page cannot show says why, in place of the
browser's broken-image icon (`src/js/missing-pictures.js`), "No picture:"
and:

- *it is not included with this copy of the report* — an `images/...` path
  with no package around it (the JSON taken out of its zip);
- *it was kept by the lab that ran the scan, which does not have it now* — a
  `/reports/...` link the lab cannot serve;
- *it could not be loaded* — anything else.

A picture that is a button (a screenshot that opens full size) is replaced
with its button.

## Not yet covered

- **Evidence captures** (the `evidenceCapture` step's PNG and MHTML) are
  written to `reports/evidence/<run>/` but no report names them, so no
  download carries them.
- **Batches saved before** batches were packages hold their results as the
  lab saved them then: page screenshots inline, element pictures as links to
  the lab, which open only where the lab still has them.
