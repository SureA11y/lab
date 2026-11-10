# Scan Grouping by URL Pattern — Design Notes

> Status: **Built** (§10, steps 1 to 9): the grouping facade and the URL
> source; the "Scan groups" section under a run's scans list, where patterns
> are chosen, named, their scans included or excluded, and merged into one
> scan (§9), each saying what its scans fail together and apart, merged
> groups changed by hand and groups made by hand; the shared fold that
> merges them; and what the run merged, unmerged or with a context taken
> out (§8). §11 keeps what is still open.

## 1. Motivation

A shop has 500 product pages and one product template. A run that scans them
all reports the template's broken "Add to cart" button 500 times, and the few
issues that really belong to one product (an image with no alternative text, a
description pasted with broken headings) are lost among them. The same happens
with blog posts, categories, search results, user profiles: any set of pages
made from one template.

The person reviewing a finished run wants to see those pages as the group they
are, decide what to do with the group as a whole (keep one representative,
drop the rest from the report), and still look inside it when it matters.

Nobody knows in advance which templates a site has, so the app proposes the
groups from the URLs of the run's scans, and the person decides.

What they decide is not only what to leave out. A group is something to act
on: exclude every product but one, or **merge** the scans of all the products
into one scan that stands for the template, where an issue of the template is
one failure "on all 500 pages" and an issue of one product's content stays
that product's (§9).

## 2. Decisions

- **D1: per run.** Grouping and the exclusions made through it belong to the
  run being reviewed. A reusable rule on the workflow ("always collapse
  `/products/*`") may come later; it is not part of this design.
- **D2: the person decides, the app proposes.** The app never excludes a scan
  by itself. It finds the patterns; the person chooses the ones to group by,
  looks at them, and includes or excludes.
- **D3: exclusion is the existing per-scan flag.** A scan already has
  `includedInReport`, toggled from its card, saved in the report
  (`src/js/report-fields.js`) and honoured by the summary, issue dispersion and
  the conformance report. A group's "Exclude" sets that flag on each of its
  scans; nothing new decides what the report counts. Excluding by group and by
  card are the same thing, and either can undo the other.
- **D4: patterns are computed, not stored.** Like issue dispersion
  (`issue-dispersion-design.md` D4), the patterns are derived from the scans'
  URLs when the report is shown. The JSON format does not change for them.
- **D5: host-aware.** The host is part of every pattern. `www.example.com` and
  `m.example.com`, or a shop and its blog subdomain, never fall into one
  pattern by accident. The person can still select patterns of both hosts.
- **D6: query keys count, query values do not.** `product.php?id=42` and
  `product.php?id=43` share the pattern `product.php?id=…`; `search?q=shoes`
  and `search?q=shoes&page=2` do not. Tracking keys (§4) are ignored.
- **D7: patterns nest.** `/blog/accessibility/{*}` is a refinement of
  `/blog/{*}/{*}`, not a competitor of it. The patterns form a tree, a URL
  matches every pattern on its path through it, and the person groups at
  whatever level suits the site (§5, §6).
- **D8: the final URL.** A scan records the URL it ended on, after redirects
  (`url`, set in `src/server-side/a11y-runner.js`). That is the page that was
  scanned, so it is what is grouped. Scans that all redirect to one login or
  error page share one URL, so they form no pattern (D9) and stay ungrouped.
- **D9: a pattern is a repetition, or it is nothing.** A pattern is only
  proposed when several different URLs share a shape under a common, literal
  part of the path: the evidence of a template. One scan is never a pattern,
  several scans of one URL are not either, and pages that merely sit side by
  side (`/about`, `/contact`) are not. A run without such repetition gets no
  patterns at all, and the app says so rather than offering groups that mean
  nothing (§5.3).
- **D10: merging is a view, and it can be undone.** Merging a group does not
  replace its scans in the report. The report keeps every scan and records
  that the group is merged; the merged scan is built from them whenever the
  report is shown, as the groups themselves are (D4). Unmerging gives the
  scans back as they were, a download keeps them, and the person can group
  them another way later (§9).
- **D11: what the run merged can be unmerged too.** A scan a Merged scan step
  made (one view in several contexts) is one scan for grouping and merging:
  it can be a member of a group and of a merged group, its contexts with it.
  In the report view it is also a merged group of its own, whose members are
  its contexts: it can be unmerged into them, and a context can be taken out
  of it, as a group merged in the report view can (§8). For that the run
  keeps each context's findings in the merged scan; a report saved before it
  did keeps its merged scans as they are, and says why.

## 3. What already exists

- `scan.url`: the final URL of every scan. The requested URL is not recorded.
- `scan.includedInReport`: the manual exclude (D3). Excluded cards are dimmed
  and dropped from every aggregate.
- The tag and profile filters: a view lens that hides cards without touching
  `includedInReport` (`applyScanFilterVisibility` in `src/js/report-view.js`).
- Merged scans: one scan per view, folded from its contexts. The scan's `url`
  is the first context's; each entry of `contexts` keeps its own `url`
  (`merged-scan-design.md` §4).
- Issue dispersion already names a rule failing in most scans a "broken
  template". Grouping is the scan-side counterpart: it says which scans share
  the template.

## 4. The signature of a URL

Each scan's URL is reduced to a signature before any pattern is looked for:

- **Host**: lowercased, default port dropped. Nothing else is folded: `www.`
  is kept (D5).
- **Path segments**: split on `/`, percent-decoded, empty segments dropped, so
  a trailing slash does not make another page. Case is kept, as servers may
  treat it as meaningful.
- **Query keys**: the set of keys, sorted, values dropped. Keys that only track
  a visit are left out: `utm_*`, `gclid`, `fbclid`, `msclkid`, `mc_cid`,
  `mc_eid`, `_ga`. The list lives in one place in the module.
- **Fragment**: dropped, except a hash route (a fragment starting with `#/` or
  `#!/`), whose segments are appended after the path's, as that is where such
  a site keeps its pages.

A scan without a usable URL (`about:blank`, a skipped scan, a `data:` page)
has no signature and goes to the "Not grouped" bucket (§5).

## 5. The pattern tree

### 5.1 What a pattern is

A pattern is a host, a sequence of segments each either literal or a wildcard
`{*}`, a set of query keys, and a kind:

- **shape** (`/blog/{*}/{*}`): URLs with exactly that many segments, matching
  the literal ones.
- **prefix** (`/blog/…`): every URL below a path, at any depth. It is what
  holds `/blog/{*}` (the categories) and `/blog/{*}/{*}` (the posts) together.

The host heads its tree but is not itself a pattern: "everything on this
site" is not a template, and is not offered as a group.

### 5.2 Containment

Pattern A is **inside** pattern B when every URL A can match, B matches too:
same host and query keys, and B is a prefix of A's literal path, or B has the
same length with a wildcard wherever A differs. Every pattern has at most one
**parent**: the most specific pattern containing it. That makes a tree per
host:

```
shop.example.com                       612 scans
├─ /products/{*}                       487
├─ /blog/…                              64
│  ├─ /blog/{*}                          6   (categories)
│  └─ /blog/{*}/{*}                     58   (posts)
│     ├─ /blog/accessibility/{*}        31
│     └─ /blog/news/{*}                 19
├─ /search?q=…                          12
└─ Not grouped                          49
```

A scan matches every pattern on the path from its leaf to the root. A post
about accessibility is in `/blog/accessibility/{*}`, `/blog/{*}/{*}`,
`/blog/…` and the host.

### 5.3 Finding the patterns

From the signatures, per host and query-key set:

1. Build a trie of the literal path segments, counting the distinct URLs
   below each node and at each depth below it. Scans are counted too, but it
   is distinct URLs that make a pattern (D9).
2. **Shape patterns**: at a node with at least `minVariants` distinct
   children, propose `node/{*}` and, for each depth below it reached by at
   least `minUrls` distinct URLs, `node/{*}/{*}…`. A segment at a fixed
   position that all members share stays literal (`/products/{*}/reviews`).
3. **Prefix patterns**: `node/…` only when it holds at least two shape
   patterns that survive pruning (the blog's categories and its posts).
   A prefix with one pattern under it is that pattern, and a prefix with none
   is a bag of unrelated pages.
4. **Prune**, until nothing changes:
   - a pattern with fewer than `minUrls` distinct URLs;
   - a pattern **without a literal anchor**: a wildcard must sit under at
     least one literal path segment (`/products/{*}`), or be followed by one
     (`/{*}/reviews`), or the pattern must carry query keys
     (`product.php?id=…`, where the file name is the anchor). `/{*}` alone,
     which every top-level page matches, is never proposed;
   - of two patterns with the same members, the less specific one, as the
     more specific one says more (`/blog/accessibility/{*}` over
     `/blog/{*}/{*}` when accessibility is the only category scanned);
   - a pattern **seen sideways**: `/products/a/{*}` over `/products/a/reviews`
     and `/products/a/specs`, when the other products have reviews and specs
     too. Its wildcard runs over a fixed vocabulary, not over content; the
     template is `/products/{*}/reviews`, and keeping it would give one group
     per product. A pattern is dropped when every value its wildcard takes
     also appears under another parent at that place. `/blog/a11y/{*}` stays
     as long as some of its posts are its own;
   - a prefix that holds every URL of its host: it is the host, which is not
     a group (§5.1).

**No patterns is a normal answer.** Five scans of `/`, `/about`, `/contact`,
`/pricing` and `/blog/hello` give none: no two of them share a shape under a
literal segment. The view then says the run's URLs show no repeated pattern
and offers no grouping, rather than one group per scan. Scans outside every
pattern are listed as "Not grouped" only when there is at least one pattern
to set them against.

The defaults are `minUrls` 2 and `minVariants` 2: two products under
`/products/` are already a template, because the literal anchor carries the
evidence that `/about` and `/contact` lack. They are parameters of the
module, checked by the tests on real URL lists (§10 step 1), which include
runs that must come out with no patterns.

The paths are bucketed in one pass, and each candidate pattern is checked
against the paths of its own host and query keys. A run of a few thousand
scans is grouped in well under a tenth of a second, and tens of thousands in
about a second; a test holds a 4 000-scan run to that order.

### 5.4 Labels

A wildcard is shown as `{*}` by default. When every value at a position is a
number it reads `{id}`, and when every value is a lowercase hyphenated word it
reads `{slug}`, which tells the person at a glance what varies. The person can
rename a pattern ("Product pages"); the name is the run's (§7).

### 5.5 Built to take other ways of telling

URL patterns are the first way of telling which scans belong together, not
the last: the markup a scan's page was built from, or anything else, may
follow. So the grouping is two layers:

- **The facade**, `src/shared/scan-groups.js` (`findGroups`), knows nothing
  about URLs. It takes the items to group (the run's scans; it reads them by
  id, so other items could be grouped too) and a list of **sources**, asks
  each one for the
  groups it sees, and puts them together: it drops what cannot be a group
  (fewer than two members), keeps one group of any two with the same members
  (the more specific, naming the other as its equivalent), nests them by
  their members alone (a group's parent is the smallest group holding all of
  it), and lists the items in no group. A group from one source can sit
  inside a group from another.
- **Sources**, each `{ id, propose(items, context) }`, returning
  `[{ key, label, members, specificity, evidence }]`. A source owns its rules
  of what is a group (D9) and its thresholds. The URL source,
  `src/shared/scan-url-groups.js` (`createUrlGroupSource`), is the first; its
  thresholds and tracking keys are options, so the noise can be tuned without
  touching the rules, and the URL it reads is `getUrl(item)`, so contexts can
  be grouped by their own URLs.

The view, and the saved choice of groups (§7), only ever see the facade's
result, so a new source adds groups without changing them. A group's key is
its source id and the source's own key (`url:shop.example.com/products/{*}`),
stable across reloads, which is what a saved choice is stored by.

## 6. Grouping with levels

The tree is the offer; the person chooses which nodes to group by. Any set of
nodes can be chosen, at any levels:

- A scan is shown under the **most specific chosen pattern** that matches it,
  so it appears once. A chosen parent shows its own scans not taken by a
  chosen child as "Other in /blog/…".
- An action on a group acts on **all its scans, nested groups included**.
  Exclude `/blog/…`, then include `/blog/accessibility/{*}`, and the result is
  the blog without everything but the accessibility posts. As exclusion is a
  per-scan flag (D3), overlapping groups need no rule of their own: the last
  action on a scan wins.
- A group shows how many of its scans are included: all, none or some ("31 of
  58 included"), so a mixed group after card-by-card changes is visible.
- **Keep one**: excludes every scan of the group but one, the usual way to
  keep a template represented once. The one kept is the first in report
  order that is already included, so a page picked by hand to stand for the
  template stays; with none included, the first comes back.

Grouping is a view: it orders and nests the scan cards but does not change the
report's scan order, which issue dispersion and the exports follow
(`issue-dispersion-design.md` D6).

## 7. What is saved

- The exclusions, as the scans list's Exclude already saves them: a download
  of the report **leaves the excluded scans out** (its package holds the
  included scans only), so excluding is what a download makes final. A
  report reopened from it has fewer scans, and a pattern may no longer repeat
  in them.
- The chosen patterns and their names, so the person finds their grouping
  again when the report is reopened: a run-level field,
  `scanGrouping: { patterns: [{ key, name, merge, add, remove, members }] }`,
  `key` being the group's key
  (`url:shop.example.com/products/{*}`), in the order they were chosen. With
  §9: `merge`, true for a merged group; `add` and `remove`, the ids of the
  scans added to it and taken out of it by hand; `members`, the scan ids of a
  group by hand (key `manual:…`), which has no pattern to find them by. A
  run's merged scan (key `run:…`, §8) is saved only once the person changes
  it: `merge: false` when unmerged, `remove` with the indexes of the contexts
  taken out. It is
  in the report schema (v3 and v4) and kept by every download. Reports opened
  together and merged into one carry every group any of them chose, the
  first name given to it kept. A key that matches none of the scans (a
  pattern that no longer repeats, after a merge or a download that left
  scans out) is not shown, but stays in the field: merged with a report that
  has those scans again, the group comes back.

## 8. Merged scans and their contexts

A merged scan is one scan and is grouped by its `url`. Its contexts nearly
always share that URL; when they do not (a redirect to an `m.` site), the scan
already carries a note saying so, and it is grouped by the first context's.

What the run merged can be undone in the report view (D11), with the same
actions as a group merged there (§9.2, §9.4):

- **Unmerge** shows the merged scan's contexts as scans of their own, each
  named by its context ("Product page · Dark · mobile"), in the merged scan's
  place and in context order. They can then be excluded, grouped and merged
  again like any scan; their URLs are one page's, so they form no URL pattern
  (D9), but they can be merged by hand.
- **Remove a context** leaves one context out of the merged scan, which is
  folded again from the others.
- **Merge again** puts the scan back as the run made it.

**What the run keeps.** Today a merged scan keeps, per context, only its
name, URL, tags, whether it was skipped, and its outcome counts. It will also
keep each context's scan as it was collected, its findings and metrics
(`contexts[i].scan`), without its screenshots, which the merged scan already
holds, each labelled by its context. The merged scan itself, its findings, its
counts and its place in the report, does not change: every reader that does
not know about contexts still sees one scan, and the CLI's exports are
written from it as before.

**How it is shown.** A run's merged scan is, in the scans as shown (§9.5), a
merged group whose members are its contexts, with the key `run:` and its scan
id. Unmerged or with a context removed, its contexts' scans are folded again,
by the same shared fold (§9.3), without the one left out. The choice is saved
in `scanGrouping` as any other (`{ key: 'run:…', merge: false }`, or
`remove` naming contexts by their index), and only once changed: merged as
the run made it, a scan has no entry. Unmerged, a context can be excluded
on its own (`exclude`, by index); its name and tags are its run's, and
renaming or tagging it says so.

The section lists these under **Merged by the run**, each with a Merged
into one scan switch and its contexts to take out or put back; the last
context left in it stays. A context shown on its own says whose context it
is; the merged scan's contexts line says which are taken out. Moving a
context moves its merged scan, as the order as shown is kept (§9.4).

A report saved before the run kept its contexts' scans can't be unmerged:
the merged scan says, where Unmerge would be, that this report did not keep
its contexts.

## 9. Merging a group

### 9.1 What it is for

A run that scanned 500 product pages has one template to fix and, perhaps, a
few products whose content is broken. Excluding all but one product shows the
template, but hides the content issues of the other 499. Merging the group
shows both: one scan, "Product pages", in which a failure of the template is
listed once, on all 500 pages, and a failure of one product's description is
listed on that product's page alone. The report counts the group as one scan,
so the template stops weighing 500 times in the totals, the dispersion and the
comparisons, and the content issues are still there to read.

### 9.2 What the person does

A chosen group gets a **Merge** switch beside its actions. On, the group's
scans are shown as one merged scan, in the scans list and in the report, named
by the group's name (or its pattern). Off, they are back as they were. The
choice is saved with the others (`merge: true`, §7).

Once merged, a group's scans can be changed by hand:

- **Add scans.** Any scan of the run can be added to a merged group, whether
  its URL matches the pattern or not: the template page at another address,
  a product reached through a search.
- **Remove scans.** Any scan of a merged group can be taken out of it, and is
  shown as its own scan again. A scan removed from a merged group is still in
  the pattern's group, for choosing and for the other actions; it is only no
  longer in the merged scan.
- **Unmerge** gives back every scan, the added ones included, as they were.

And scans can be merged without a pattern: choosing scans in **Group scans by
hand**, at the end of the Scan groups section, makes a **group by hand**, named
by the person, merged into one scan unless they say not to, that is then like
any other merged group. It is removed with its own Remove group, having no
pattern to unchoose, and goes when fewer than two of its scans are left. A group by hand comes from a source of its own
(§5.5), `manual`, which proposes the groups the report saved, so it nests and
shows beside the URL groups without either knowing the other.

### 9.3 How the scans are folded

The fold is the one a Merged scan step already does at the end of a run
(`merged-scan-design.md` §4), with **pages** where that one has contexts. It
needs one change. There, two occurrences are the same failure when they are on
the same page, of the same element, failing for the same reasons; across the
pages of a template the page always differs, so nothing would join. Here the
page is left out of that identity and kept beside it instead:

- **An occurrence with the same result on several pages is one failure on
  those pages**, listed with them ("On all 500 pages", "On 3 of 500 pages"),
  as a merged scan's occurrence lists its contexts. The same result is what it
  is there: the same element (its target and shadow hosts, ids set aside as
  they are there), the same outcome, summary, hint, uncertainty and measured
  values. So a contrast failure of the price badge at 2.1:1 everywhere is one
  failure on every page, and a product photo whose caption is unreadable on
  one page is a failure on that page.
- **A check counts once, with the worst outcome any page gave it**, so the
  merged scan's rules and criteria read as the worst page does.
- **Outcome counts, coverage and the accessibility summary** are worked out
  again from the merged findings, with the functions a single scan uses.
- **Occurrence ids** are per page (they hash the page's path). A merged
  occurrence keeps its first page's; the others stay with their own scans,
  which the report keeps (D10), and the scans it lists lead to them.
- **Members that are merged scans themselves** (a product scanned in light and
  dark) keep their contexts: an occurrence then says both where and under
  what conditions it fails ("On 3 of 500 pages, in Dark · mobile").

The fold is pure and shared, `src/shared/scan-fold.js` (`mergeCanonicals`),
so the runner and the report view use the same code. Its `dimension` says
which fold it is: `contexts` for the runner (the default, as before), `scans`
for a merged group. What an occurrence lists is then the **scans** it is on,
by id (`scans`, `scansTotal`, and `scanTargets` for an element whose ids
differ by page), not page URLs: two scans can be of one page, reached in two
flows, and are two members. "On all 500 pages" is what the view makes of it,
counting the pages of those scans. A picture says which scan it was taken in
(`elementScreenshot.scan`), as it says its context.

surea11y's own result, which only the CLI's exports read, is folded by
contexts only: the report view has none to fold.

### 9.4 Rules

- **Only the group's included scans are merged.** Excluding and merging are
  two ways to reduce a group, and they combine: exclude the products that do
  not matter, merge the rest. A merged group none of whose scans is included
  is shown as one excluded scan.
- **A scan is in one merged scan at most.** Merged groups can be chosen inside
  one another; the outermost merged group wins, and a merged group inside it
  is shown as merged into it, its switch kept, so unmerging the outer one
  brings the inner one back merged.
- **A scan added to a merged group leaves any other merged group it was in**,
  so the last place it was put is where it is. Adding a scan says which group
  it came from.
- **What the person added or removed is kept apart from the pattern.** A
  merged group's scans are the pattern's, plus those added, minus those
  removed; a later run of the same workflow, grouped by the same pattern,
  gets the new pages of the pattern without the person adding them.
- **Including and excluding the merged scan** from the scans list acts on all
  its scans, as Include all and Exclude all do.
- **Renaming the merged scan** renames its group. **Its tags** are its scans'
  together, and editing them sets them on each of its scans.
- **Its place** in the report's order is its first scan's. With merged groups
  in a report, scans move in the order as shown: a merged scan moves with all
  its scans as one block, and a scan moved past a merged scan goes past all
  of it. The scans of a merged group then sit together in the report's order,
  where it is shown, so they stay there once unmerged.
- **Its pictures** are its first scan's: a template looks the same on every
  page.
- **Its id** is the group's key, so it is the same in every redraw and every
  download, and a link to it, or a comparison with another run merged the
  same way, finds it.

### 9.5 One list of scans for everything

Every part of the report that reads the scans (the summary and its totals,
issue dispersion, the conformance report, the exports, the comparisons) reads
them through one function: the report's scans **as shown**, with each merged
group in place of its scans. It is the same idea as the Profiles selector's
view of a scan (`viewScan`), one level up. Nothing reads `payload.scans`
directly to count, so a merged group cannot be counted as one scan in one
place and as 500 in another. The grouping itself keeps reading the scans as
they are, so its groups do not change when one of them is merged.

A download holds the scans as they are and the choice to merge (D10). The lab
shows it merged again when it is opened; a reader that does not know
`scanGrouping` sees the scans as they were, which is still a true report of
the run.

## 10. Steps

1. **Grouping facade and URL source** (built). `src/shared/scan-groups.js`
   and `src/shared/scan-url-groups.js` (§5.5): signatures (§4) and the pattern
   tree (§5), pure, with unit tests on fixture URL lists: a shop, a blog with
   categories, sub-pages under every product, a query-string router
   (`product.php?id=`), a hash-routed single-page app, several hosts,
   tracking keys, and small sites with no repetition, which must come out
   with no patterns. The facade is tested with stand-in sources, to hold it
   to knowing nothing about URLs. No UI.
2. **Read-only grouping view** (built). "Scan groups", a section of the run
   summary under its scans list (`src/js/run-summary-ui.js`), drawn by
   `src/shared/scan-groups-view.js` from the facade's result: the tree, each
   group's scans, distinct URLs and how many are included, its scans linked
   to their cards (a parent lists only those no child holds), and the scans
   in no group. Closed to start with; what was open stays open when the
   summary is redrawn (a scan excluded, renamed or moved). Over every scan,
   excluded ones too; a skipped scan is not grouped. The grouping is found
   again only when the scans' ids or URLs change. No actions; this is where
   the thresholds are checked on real runs. Not yet in the exported report
   or the extension's panel.
3. **Choosing and acting** (built). The section has two parts. "Patterns
   found" is the tree of step 2 with a checkbox per pattern. "Your groups",
   once one is chosen, lists each scan under the narrowest chosen group
   holding it (`chooseGroups` in the facade, by keys only), each group with a
   name field (Enter or leaving it saves, Escape puts back the saved name)
   and Include all, Exclude all and Keep one. The actions are planned in
   `src/shared/scan-group-choice.js` (`planAction`, only the scans whose state
   changes) and applied by `applyScanInclusion` in `src/js/a11y-ui.js`, which
   sets `includedInReport` and draws the report once; an action with nothing
   to change says so and leaves the report alone, so its button never has to
   be disabled. Choosing and naming draw only the section again
   (`refreshScanGroups`), as renaming and moving a scan now do. Focus comes
   back to the same control after every redraw (`data-sg-focus`). Events are
   handled in `src/js/scan-groups-ui.js`.
4. **The fold across pages** (built, §9.3). The pure fold moved from
   `src/server-side/merged-scan.js` to `src/shared/scan-fold.js`, which loads
   in a page with nothing else; the runner keeps what only it needs (its
   collected scans, screenshots as buffers, the live counts) and re-exports
   what its callers imported, so they and its tests run unchanged. The fold
   takes a dimension, `contexts` or `scans`; folding scans, the page leaves
   an occurrence's identity and the contexts of a member already merged by
   its run join it. Tested on its own (`scan-fold.test.js`). No UI.
5. **Merging a group** (built, §9.2, §9.4, §9.5). `scansAsShown` in
   `src/shared/scan-group-merge.js` builds a merged scan per merged group
   (the fold by scans, the score on the member with the most elements,
   coverage made again with each criterion's automation from the saved
   summary, the occurrences' `pageUrls` and `pagesTotal`); `shownScans` and
   `viewPayload` in `src/js/run-summary-ui.js` keep it while nothing it
   depends on changes. The report's totals, global findings, metrics, issue
   dispersion, scans list and cards read the view; the grouping, the edits
   and the downloads read the scans themselves. A change to a merged group's
   scans draws the report again whole, the Scan groups section keeping what
   was open and focus going back to the control that had it. An occurrence
   says "On all 5 pages" or "On 2 of 5 pages" and lists them; the card says
   which scans it was merged from. The Merge switch is in each chosen group;
   `merge: true` is saved in `scanGrouping` and in the report schema.
   The conformance report, the checklist and the comparisons are made from
   the scans as saved (§11).
6. **Shared and unique issues per group** (built). For each chosen group,
   "What its scans fail": the rules failing on every scan (the template's)
   and those failing on some only (their content's), each with its elements
   and, for the second, which scans, so the person sees what excluding would
   hide and what merging would keep. `groupIssues` in
   `src/shared/scan-group-merge.js` reads it off the same fold by scans,
   without merging; failures only, as issue dispersion counts them, and every
   scan of the group, excluded ones too. Kept per group while its scans are
   the same objects (`run-summary-ui.js`).
7. **Changing a merged group by hand** (built, §9.2, §9.4). A merged group
   lists its scans as left by hand, each with Take out; those taken out, with
   Put back; and Add a scan, a list of the run's other scans. Groups by hand
   are made in a form of the Scan groups section rather than from the scans
   list, beside the other actions on groups and without the list growing
   checkboxes; they come through the `manual` source
   (`createManualGroupSource` in `src/shared/scan-group-choice.js`), whose
   groups say more than any pattern about their scans, and show under Your
   groups, not among the patterns found. The rules (`membersOf`, `addScan`,
   `removeScan`, `putBack`, `addManualGroup`) are pure and shared; Include
   all, Exclude all, Keep one and the counts act on the scans as left by
   hand. `add`, `remove` and `members` are saved in `scanGrouping` and the
   report schema; reports merged together carry what any of them changed.
   Unchoosing a merged group now draws the report again, as it unmerges it.
8. **The run keeps its contexts' scans** (built, §8). A Merged scan step
   saves each context's scan in the merged scan (`contexts[i].scan`,
   `contextScanOf` in `src/server-side/merged-scan.js`), made by the payload
   builder as any scan is (`contextPayload`), less what the merged scan
   already holds: no id, pictures, metric definitions or rule catalogue (one
   run, the same engines; the catalogue was three quarters of a context's
   scan). The report schema says so. The merged scan and the CLI's exports
   are unchanged, which the runner's tests hold. Measured on the demo site,
   a run whose one scan is merged from two contexts saves a payload 59%
   larger (460 KB to 733 KB): each context's findings, passes and
   not-applicable ones included, and its coverage.
9. **Unmerging what the run merged** (built, §8, D11). `expandRunMerges` in
   `src/shared/scan-group-merge.js`, run first in the scans as shown: a
   run's merged scan unmerged into its contexts' scans (ids `<scan id>~<n>`,
   with the merged scan's rule catalogue and the pictures of their
   context), or folded again by contexts without those taken out, which
   follow it, scored as a merged group is. A group merged here holds a
   run's merged scan as it is shown. The rules (`setRunMerged`,
   `setRunContextOut`, `setRunContextExcluded`) are in
   `src/shared/scan-group-choice.js`; the section's Merged by the run part is
   drawn even for a report of one scan, which the run merged. Tried on a real
   run's report of the demo site: unmerged, a context excluded, merged
   again, a context taken out, saved and opened again.

## 11. Open questions

- **Locale prefixes.** `/en/products/{*}` and `/es/productos/{*}` are one
  template in two languages. They stay two patterns (they differ in literal
  segments); a later step may propose a pattern across them.
- **Comparisons.** Two runs compared with different exclusions compare
  different sets of scans. This is already true of card-by-card exclusion;
  grouping makes it easier to do at scale, so the comparison views may need to
  say how many scans each side excluded.
- **What a merged group scores.** A Merged scan step divides by its largest
  context's DOM metrics, as its contexts are one page. A group's pages are
  different pages of one template; the largest page is the likely choice
  again (the template, as fully as any page shows it), but a score that
  should stand for the template is to be settled with real runs in step 5.
- **The size of a report that keeps its contexts' scans.** Measured in step 8:
  about 30% more per context for the scans that are merged, the rule
  catalogue being kept once. Screenshots, the largest part of a report with
  pictures, are not doubled (§8). If it is too much, a context could keep
  only its failing and undecided findings, and its coverage be made again
  from the merged scan's, as a merged group's is (§9.3).
- **Keeping the contexts' scans by default.** Step 8 keeps them for every
  Merged scan step. A workflow whose merges are never undone pays for them;
  an option on the step could leave them out.
- **Scan ids after reports are merged.** What was added, removed or merged
  by hand is saved by scan id, and opening several reports as one renames a
  scan whose id another report already uses (`ensureUniqueImportedScanIds`).
  The ids saved by a report then have to be renamed with its scans, or they
  name nothing (and are ignored, as a pattern that matches nothing is).
- **Downloads made from the scans as saved.** The conformance report, the
  manual checklist and the comparisons read the report's scans, not the
  scans as shown: a merged group counts there as its pages. The report's own
  download shows it merged (its page is drawn as shown) and keeps the scans
  and the choice (D10).
- **Comparing a merged run with an unmerged one.** The merged scan has its own
  id, so it matches nothing on the other side. The comparison may need to
  match it with the scans it was made from.
- **Where the view lives** (settled in step 2): a section of the run summary
  under the scans list, as it is about scans, not findings. Step 3 may turn
  it into a mode of the scans list, once its rows carry actions.

## 12. Rejected alternatives

- **A new exclusion layer next to the results.** The per-scan flag exists,
  is saved, and every aggregate honours it (D3). A second mechanism would have
  to be kept in agreement with it everywhere.
- **Grouping as a partition.** One level of non-overlapping groups cannot hold
  both "all posts" and "accessibility posts" (D7).
- **Patterns typed by the person as regular expressions.** Hard to write and
  to read, and the person does not know the site's URL scheme in advance. The
  proposed patterns can be renamed; editing them by hand may come later if
  the proposals fall short.
- **Grouping by page structure** (a fingerprint of the DOM), as the first
  way. It finds templates whose URLs say nothing, but needs data the scans do
  not keep and is far harder to explain. URL patterns come first; structure
  may follow as another source (§5.5).
- **A pattern for one URL scanned several times** (a single-page app's states,
  a page visited in several flows). It is one page, not a template: its scans
  differ by state, not by content, and grouping them is a different question
  from this one (D9).
- **A group for every scan when nothing repeats.** It makes the view look
  busy without saying anything; no patterns is the honest result (§5.3).
- **Merging by replacing the scans.** Folding a group into one scan for good,
  in the report itself, would spare every reader the scans-as-shown function,
  but it is one way only: the pages' own scans would be gone from the report
  and its downloads, the group could not be unmerged or grouped another way,
  and a later run could not be compared page by page (D10).
- **Writing a run's contexts as scans of their own** in the report, with the
  merge as a `scanGrouping` choice, as the report view saves its own merges.
  It would make the two kinds of merge one, but every reader that does not
  know `scanGrouping` (the CLI's diff, older versions of the lab, other
  tools) would read four scans where the run made one. The merged scan stays
  as it is, and holds its contexts (§8).
- **Reusing the Merged scan step's fold unchanged.** Its identity includes the
  page, which is right for contexts of one page and joins nothing across the
  pages of a template (§9.3).
- **Excluding automatically.** A group of near-identical pages can still hold
  one page's real issues; only the person can decide they are noise (D2).
