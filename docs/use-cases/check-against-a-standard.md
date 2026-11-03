# Check against a standard

**For** teams that answer to a regulation or a procurement requirement:
EN 301 549 in the EU. **You get**
reports that name the standard's own requirements (its clauses or criteria),
not only WCAG's, and say how much of the standard automated checks can reach.

## Profiles

A scan checks against a **profile**: WCAG 2.2 at a level, or a standard.

| Profile | Checks | WCAG it comes to |
| --- | --- | --- |
| `wcag22-a`, `wcag22-aa`, `wcag22-aaa` | WCAG 2.2 at that level | 2.2 |
| `en301549-v4.1.1` | EN 301 549 V4.1.1, the current EU standard | 2.2 AA |
| `en301549-v3.2.1` | EN 301 549 V3.2.1, its earlier version | 2.1 AA, with 4.1.1 Parsing |
| `wai-aria-1.2` | WAI-ARIA 1.2's author requirements: names, roles, states and properties, owned and context roles | none: WAI-ARIA restates no WCAG criterion |

surea11y applies each standard in full, EN 301 549's version details
included. Each finding names the requirement it is about in the standard's
terms (an EN 301 549 clause).

Each scan step sets its own **Profile** (a spec's scan step, its
`"profile"`), WCAG 2.2 AA unless it says otherwise, so several scans of the
same page can check it against several: `examples/specs/standards.spec.json`
does that.

### Several profiles in one scan

One scan can also check against several at once: a WCAG level and any
standards, such as WCAG 2.2 AA with WAI-ARIA 1.2. In the step, choose the
level under **WCAG 2.2** (or **Don’t check WCAG**) and tick the
**Standards**; in a spec, give a list:

```json
{ "type": "a11yScan", "label": "Home", "profile": ["wcag22-aa", "wai-aria-1.2"] }
```

- **One WCAG level at most.** Each level includes the ones below it, so
  `["wcag22-a", "wcag22-aa"]` is refused before the run starts.
- **Each profile judges the page as a scan of it alone would.** The report
  lists each one's requirements: WCAG's criteria and WAI-ARIA's own. An
  unnamed `role="grid"` stays a question under WCAG 4.1.2 and is a failure
  of WAI-ARIA's name requirement.
- **A failure under any of them fails the scan.** Its counts and score read
  every profile's requirements together.
- **EN 301 549 restates WCAG Level A and AA.** Beside a WCAG level, it checks
  those criteria again, under its clauses' names. The step says so.
- **A profile that didn't run** (its pack didn't load, say) is named under
  the scan's header and in a notice; the others still ran. A report keeps
  every profile in the scan's `profiles` and the missing ones in
  `profilesNotRun` ([the report package](../report-package.md)).
- **From a variable.** A variable can hold one profile, or several separated
  by commas (`wcag22-aa,wai-aria-1.2`). Each one is checked when the scan
  comes, and a scan whose variable names something that is no profile stops
  with an error rather than checking WCAG 2.2 AA instead.

Reports of scans checked against different profiles are compared on the
profiles they all share, and the comparison says which, and what it left
out:

- WCAG 2.2 AA + WAI-ARIA 1.2 beside WCAG 2.2 AA alone is compared on WCAG
  2.2 AA: WAI-ARIA's requirements are left out, and a rule finding counts as
  WCAG judges it.
- WCAG levels nest, so a WCAG 2.2 AAA report beside an AA one is read at AA,
  its AAA criteria left out.
- Each report's own score is left out, since it was made from everything
  that report checked.

Reports that share no profile (EN 301 549 alone beside WAI-ARIA alone) are
compared as they are, and the comparison says they were checked against
different things, since their rows don't line up. The same profiles in
another order are the same.

## What automated checks can and cannot say

A scan decides what can be decided from the page: a missing text alternative,
a contrast too low, a field with no name. Much of every standard needs a
person: whether a text alternative is a good one, whether the focus order
makes sense. The report keeps the two apart:

- **Failures** are definite.
- **Needs review** is what a person still has to check, with how to check it.
- The summary says how much of the profile's requirements automated checks
  reach at all.

Passing every automated check does not make a site conform. Use the report
as the automated part of an audit, and its review list as the start of the
manual part.

## Variations

- EN 301 549 comes to surea11y as a pack, `@surea11y/pack-en301549`,
  installed with the lab.
- WAI-ARIA 1.2 comes as the pack `@surea11y/pack-wai-aria`, installed with
  the lab as an optional dependency ([configuration](../configuration.md#standards)).
  It reads surea11y's ARIA findings by WAI-ARIA's own wording, so a finding
  WCAG only asks about can fail there: an unnamed `role="grid"` is a question
  for WCAG 4.1.2 and a failure of WAI-ARIA's "Roles that require an
  accessible name have one". A requirement no rule fails is a question,
  never a pass.
- Group a report's findings by groups of your own in the standard's terms
  ([the lab app](../app.md#reading-a-report)).

## See also

[Reports and their format](../report-package.md) ·
[The metrics](../a11y-metrics-reference.html)
