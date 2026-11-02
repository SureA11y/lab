# Feed a dashboard

**For** anyone who reports accessibility over time or across products: an
accessibility lead, a programme office, a quality dashboard. **You get** the
results as data, in a format that stays stable.

## What there is to read

| File | What it holds | Described by |
| --- | --- | --- |
| `payload.json` (a run's report) | Every scan, what it checked against, every finding and element, scores | `schemas/report.v4.schema.json` |
| `diff.json` (a compared run) | What changed since the baseline | `schemas/diff.v1.schema.json` |
| `batch.json` (a batch) | Each run of the batch, with its counts | — |
| `summary.md` | The run in prose, for people | — |

Each run is kept in its own folder (`a11y-runs/<name>/runs/<time>/`), so a
folder of runs is a time series as it stands.

## A spreadsheet or BI tool

`examples/integrations/findings-to-csv.js` turns a report into rows, one per
failing element: run, time, scan, profile, page, rule, severity, WCAG
criterion, element and occurrence id.

```bash
for run in a11y-runs/Demo-shop-tour/runs/*/; do
  node examples/integrations/findings-to-csv.js "$run/payload.json"
done > failures.csv
```

Load it in a spreadsheet, a notebook or a BI tool, and chart failures by
month, by product, by criterion. `--outcome cantTell` lists what needs a
person instead.

## Straight from the JSON

The report's schema is strict on what a dashboard relies on (the run's
identity, what each scan checked against, findings and their elements) and
says which parts may still grow, so a reader written against it keeps
working. Each finding is in its scan (`scans[].canonical.findings`): a
report does not repeat them by outcome, and the rule catalogue each scan ran
with is kept once (`ruleCatalogs`, which each scan names by index in
`canonical.rulesCatalog`). Reports of versions 1 to 3 (older ones) are read
by the lab as version 4; a reader of your own can check `reportVersion`.

## In the lab itself

Up to 24 reports make a dashboard in the **compare** tab: what each cleared
and introduced, and how long each problem has been open. Download it as a
page to share.

## See also

[Reports and their format](../report-package.md) ·
[Compare releases and environments](compare-releases-and-environments.md)
