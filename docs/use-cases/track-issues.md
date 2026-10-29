# Track issues in your tracker

**For** teams who work from tickets. **You get** one ticket per failing
element, opened when it first fails and closed when it is fixed, never
duplicated however often the check runs.

Every failure in a report has an **occurrence id**: `occ_` and 14 characters,
the same in every run while the same rule fails on the same element of the
same page. It is what a tracker keys tickets by.

## Steps

1. Run a workflow against a baseline, so the run says what is new and what is
   fixed ([nightly](catch-regressions-nightly.md) or
   [per pull request](check-every-pull-request.md)).
2. Take the new failures, as tickets to open, and the fixed ones, as tickets
   to close:

   ```bash
   node examples/integrations/new-issues.js a11y-runs/<name>/runs/<time> --json
   node examples/integrations/new-issues.js a11y-runs/<name>/runs/<time> --fixed --json
   ```

   ```json
   [
     {
       "id": "occ_896adb2a042edd",
       "title": "Name, role, value: accessible name: html > body > main > p > button",
       "rule": "wcag-4.1.2-name",
       "wcag": "4.1.2",
       "severity": "serious",
       "page": "http://localhost:8781/cart.html",
       "element": "html > body > main > p > button"
     }
   ]
   ```

3. For each new one, look for a ticket labelled with its id; open one if
   there is none. For each fixed one, close the ticket with its id. Most
   trackers do both with one call each from their API or command line.

Without the script, the same data is in the run's `diff.json`: each row is a
rule, and each of its `occ` entries an element, with its `occurrenceId` and
a `tag` (`new`, `fixed` or `still`). `schemas/diff.v1.schema.json` describes
it.

## Variations

- Open a ticket per rule and page instead, listing the elements: group the
  entries by `rule` and `page`.
- Track everything that fails, not only what is new: read every failure's
  `occurrenceId` from the report itself (`findings-to-csv.js` lists them).

## A limit to know

The id comes from the element's selector: an element whose selector changes
(a renamed class) gets a new id, so its old ticket closes and a new one
opens.

## See also

[Reports and their format: occurrence ids](../report-package.md#what-the-json-says)
