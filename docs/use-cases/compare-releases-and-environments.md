# Compare releases and environments

**For** anyone asking "is the new version better or worse?": before and after
a redesign, staging against live, one release against the next, variant A
against variant B. **You get** what was fixed, what is new and what still
fails, rule by rule and element by element.

Two runs are compared by matching each page by its path and query, and each
failure by its rule and element: the address's host does not count, so a
staging site compares with the live one.

## On the command line

Run the workflow on one, keep it, then run it on the other against it. With
the demo shop, whose release 2 runs on another port:

```bash
node src/cli/run-workflow.js examples/specs/site-tour.spec.json --promote release-1
node src/cli/run-workflow.js examples/specs/site-tour.spec.json \
  --url http://localhost:8781/ --baseline @release-1
```

```
Rules       0 new, 4 resolved, 2 persistent
Instances   1 new, 8 fixed, 1 still failing
```

`--url` points the same workflow at another environment, so one workflow
serves staging and live. `comparison.html` is the comparison to read.

## In the app

The **compare** tab takes any reports: from files, from a run just made, or
from the queue.

- Two reports are compared side by side.
- From three to 24, a dashboard: what each cleared and introduced, how long
  each problem has been open, which criteria moved.

Say what they are (**runs over time**, **versions** or **variants**) and the
comparison reads accordingly: problems "fixed" and "newly failing" for runs
over time, "fails only on A" and "only on B" for variants. Name and annotate it, then download it, as a
page or with its reports.

## Variations

- Compare a whole release across many pages: run a [batch](check-many-pages.md)
  on each, then compare the batches' runs, row by row.
- Track a trend: the reports of the last months, up to 24, in one dashboard
  ([feed a dashboard](feed-a-dashboard.md) for longer series).

## A limit to know

A failure is matched by its element's selector. An element whose selector
changes between the two (a renamed class, a reordered list) reads as one
failure fixed and another new.

## See also

[The lab app: comparing reports](../app.md#comparing-reports) ·
[Reports and their format](../report-package.md)
