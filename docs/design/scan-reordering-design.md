# Scan Reordering — Design Notes

> Status: **Single-move reordering shipped.** Group moving is designed and its
> requirements are settled, but not built. This records the measurements behind
> the performance work and the alternatives rejected for grouping, so they are
> not re-proposed. Outstanding work is in §8.

## 1. Motivation

A finished workflow, or a loaded report, lists its scans in workflow order.
Users reorder them: to put a scan where it belongs after the fact, and to bring
related scans next to each other when the workflow visited them far apart.

Two problems. Moving one scan one position was slow enough to be unusable on
large reports, and there was no way to move a scan more than one position at a
time, or to move several at once.

## 2. What was wrong

`moveScan` swapped two entries in `payload.scans`, then called
`recomputeDerivedReportData` followed by `renderActiveBucket` — a full teardown
and rebuild of every scan card, findings table and metrics panel.

The array swap was never the cost. Measured on a 300-scan report:

| Operation | Cost |
| --- | --- |
| Swapping two entries in the scans array | 0.0003 ms |
| Deep-cloning the payload (`prepareDataForReport`) | 12 ms |
| One move, synchronous | 519 ms |
| Reordering the same cards via the sort path | 6–20 ms |

That report holds **223,004 DOM nodes**, all rebuilt to swap two neighbours. The
viewport also jumped roughly 512 px per click: the restore ran against a page
that had briefly collapsed during the rebuild, so `scrollTo(previousScrollY)`
landed in the wrong place.

## 3. Why the fast path is safe

A reorder is a **pure permutation**. No count, metric or finding changes, and
`payload.metrics` is a set of order-independent sums.

`a11yGlobalFindings` is the one derived value whose order follows the scans,
because `getA11yGlobalFindings` builds its maps by iterating them. It is never
displayed — it exists for export and for the Compare tab, and both rebuild it
(`buildExportPayload` calls `recomputeDerivedReportData` on its clone). So the
move path recomputes nothing.

## 4. What shipped

`moveScan` restamps the `data-sort-order` of the two affected scans and swaps
their card elements wherever both are rendered as siblings — the results list,
the summary rows, and the all-scans grid. Every other card is untouched.

| | Before | After |
| --- | --- | --- |
| One move, synchronous | 519 ms | 9 ms |
| Twenty moves | — | 41 ms (2 ms each) |
| Scroll position | jumps ~512 px | unchanged |

Two supporting changes the approach depends on:

- **Move buttons keep their click listener while disabled.** They were bound
  only when enabled; since ends are now re-enabled in place rather than
  re-rendered, a button bound that way went inert as soon as another scan moved
  past it.
- **All-scans cards carry `data-scan-id`**, so a reorder can retarget them
  instead of rebuilding the dialog.

Under a non-default sort the sort key still owns the visible order, so that path
re-sorts the pair rather than swapping it.

Reaching 9 ms took a second pass. The first attempt sat at 275 ms because
`syncScanMoveButtons` issued roughly 600 document-wide selector queries, and
`applyScanSort` re-appended all 300 cards when only two had moved.

## 5. Requirements for group moving

- **R1** — The grouped order must **survive export**. It has to reach the
  exported JSON and HTML, not just the on-screen view.
- **R2** — Groups are **arbitrary**. They are "these specific scans", with no
  property, tag or metric that describes the set.
- **R3** — Moving several scans must preserve their relative order.
- **R4** — Every action must be reachable by keyboard and announced, to the same
  standard as the rest of the report UI.

## 6. Rejected alternatives

**Group-by-tag as a sort key.** Adding a `by tag` entry to `SORT_KEYS` would
cluster related scans with no manual moving, and is by far the cheapest option.
Rejected on **R1**: a sort is a view. It reorders rendered cards and never
touches `payload.scans`, so the exported report keeps the original order. It
would also need work regardless — `compareByKey` coerces both sides with
`toInt`, so a string key needs a group index or a comparator change.

**Collecting the tag-filtered set.** The tag filter already computes a matching
set, so "bring every matching scan together" needs no new selection UI at all,
and composes with per-scan tag editing. Rejected on **R2**: a filter can only
describe a group that shares something. It stays a good shortcut for the cases
that *do* share a tag, and could be added later beside multi-select.

**Drag and drop in the report view.** Rejected as the primary mechanism: it is
the most work, the worst fit for hundreds of scans — dragging full-height cards
through a 223,000-node page — and it needs a keyboard equivalent anyway, which
is the multi-select and move-to-position work below. Worth revisiting inside the
all-scans dialog (§7).

## 7. Agreed design

**Selection.** A checkbox per scan in the header controls and the matching
summary row, addressed by scan id like the existing move, rename and tag
controls. Shift-click extends a range from the last one clicked. Selection is a
Set of scan ids on `resultsState`, so it survives the in-place refreshes.

A scan hidden by the tag filter but selected still moves — selection applies to
the data, not the view — and the toolbar states that when it happens, so it is
never silent.

**Actions**, in a toolbar shown only when the selection is non-empty and
announced through the existing `aria-live` status channel:

- **Group together** — the selected scans become contiguous
- Move selected up / down by one
- Move selected to top / to bottom
- Clear selection

**Move to position** — a number, or "move before/after a named scan" — works with or
without a selection, and is the precision tool that replaces a long run of
single moves without needing a pointer.

All of these permute `payload.scans` and then re-sequence the cards, exactly as
the single move does, which is what satisfies **R1**.

The movement itself is now cheap: a group move is one array splice and one DOM
pass. **The cost is the selection model and its accessibility**, and that same
model is what bulk tag editing needs, so it is not spent once.

**Open alternative.** If the scan header becomes too crowded, put selection and
grouping **only in the all-scans dialog**. It is a better surface for hundreds of
scans — many visible at once, compact cards already carrying ids and sort
attributes — and it leaves the report view unchanged.

## 8. Outstanding work

- Build the selection model and the group actions in §7.
- Confirm three choices, currently proposed rather than settled:
  1. the group lands at the **topmost selected scan's position** (alternatives:
     bottom-most, or the top of the report)
  2. **relative order within the group is preserved** — selecting 5, 9 and 2 and
     grouping yields 2, 5, 9 rather than click order
  3. the **checkbox is always visible**, rather than hidden behind a selection
     mode
- Decide between the report view and the all-scans dialog as the host surface.

## 9. Note on measuring this

A browser tab driven over CDP reports `document.visibilityState === 'hidden'`,
which pauses `requestAnimationFrame`. Any measurement that waits for a frame to
settle will never resolve and looks like a hang, before and after any fix.
Measure synchronous cost, or make the tab visible first.
