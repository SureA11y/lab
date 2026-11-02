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
- WAI-ARIA 1.2 comes as the pack `@surea11y/pack-wai-aria`: install it, or
  name it in `A11Y_PACKS` ([configuration](../configuration.md#standards)).
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
