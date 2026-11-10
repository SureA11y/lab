# Scan Grouping by URL Pattern — Design Notes

> Status: **Planned.** Nothing here is built yet. §9 lists the steps in the
> order they are meant to ship; each one is useful and testable on its own.

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
  scanned, so it is what is grouped. A run whose scans redirect to a login or
  error page will show them as one group, which is the truth about that run.

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

- **exact** (`/products/red-shirt`): one URL. Only proposed when several scans
  share it, as a single-page app's states or a page scanned in several flows
  do.
- **shape** (`/blog/{*}/{*}`): URLs with exactly that many segments, matching
  the literal ones.
- **prefix** (`/blog/…`): every URL below a path, at any depth. It is what
  holds `/blog/{*}` (the categories) and `/blog/{*}/{*}` (the posts) together.

The host alone is the root prefix of its tree.

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

1. Build a trie of the literal path segments, counting the scans below each
   node and at each depth below it.
2. **Shape patterns**: at a node with at least `minVariants` (2) distinct
   children, propose `node/{*}` and, for each depth below it reached by at
   least `minMembers` (2) scans, `node/{*}/{*}…`. A segment at a fixed position
   that all members share stays literal (`/products/{*}/reviews`).
3. **Prefix patterns**: at a node whose scans reach more than one depth below
   it, propose `node/…`.
4. **Exact patterns**: a signature shared by at least `minMembers` scans.
5. **Prune**: drop a pattern with fewer than `minMembers` scans, and of two
   patterns with the same members keep the more specific one, which says more
   (`/blog/accessibility/{*}` over `/blog/{*}/{*}` when accessibility is the
   only category scanned).

The trie is built in one pass over the scans and every step walks it once, so
a run of thousands of scans is grouped in milliseconds. The thresholds are
parameters of the module, set by the tests on real URL lists rather than
fixed in this note.

### 5.4 Labels

A wildcard is shown as `{*}` by default. When every value at a position is a
number it reads `{id}`, and when every value is a lowercase hyphenated word it
reads `{slug}`, which tells the person at a glance what varies. The person can
rename a pattern ("Product pages"); the name is the run's (§7).

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
- **Keep one**: excludes every scan of the group but the first in report
  order, the usual way to keep a template represented once.

Grouping is a view: it orders and nests the scan cards but does not change the
report's scan order, which issue dispersion and the exports follow
(`issue-dispersion-design.md` D6).

## 7. What is saved

- The exclusions, as `includedInReport` already is.
- The chosen patterns and their names, so the person finds their grouping
  again when the report is reopened. This is a small run-level field
  (`scanGrouping: { patterns: [{ key, name }] }`, where `key` is the pattern
  written out), added in the step that adds the choosing (§9 step 3). Patterns
  that no longer match anything after a merge of reports are dropped quietly.

## 8. Merged scans and their contexts

A merged scan is one scan and is grouped by its `url`. Its contexts nearly
always share that URL; when they do not (a redirect to an `m.` site), the scan
already carries a note saying so, and it is grouped by the first context's.

Including or excluding a **context** of a merged scan is a separate feature
that will use the same grouping view, grouping by context name instead of by
URL ("Dark · mobile" across all merged scans). It needs groundwork first:
today the merged scan keeps, per context, only its outcome counts, so leaving
a context out after the run means keeping each context's findings and folding
again without it (`mergedScan`'s folding is pure, so folding again is cheap).
That storage change is its own step (§9 step 5) and its own design note.

## 9. Steps

1. **Pattern module.** `src/shared/scan-url-patterns.js`: signatures (§4) and
   the pattern tree (§5), pure, with unit tests on fixture URL lists: a shop,
   a blog with categories, a query-string router (`product.php?id=`), a
   hash-routed single-page app, several hosts, tracking keys. No UI.
2. **Read-only grouping view.** The proposed tree shown on a finished run, with
   the members of each pattern. No actions; this is where the thresholds are
   checked on real runs.
3. **Choosing and acting.** Choose patterns, name them, include, exclude and
   keep one, through `includedInReport`. Save the choice (§7).
4. **Shared and unique issues per group.** For each group, the rules failing in
   all its scans (the template's) and those failing in only some (the
   content's), so the person sees what excluding would hide.
5. **Per-context findings in merged scans.** Keep them, then fold again when a
   context is left out.
6. **Grouping by context.** The same view and actions over the contexts of
   merged scans.

## 10. Open questions

- **Locale prefixes.** `/en/products/{*}` and `/es/productos/{*}` are one
  template in two languages. They stay two patterns (they differ in literal
  segments); a later step may propose a pattern across them.
- **Comparisons.** Two runs compared with different exclusions compare
  different sets of scans. This is already true of card-by-card exclusion;
  grouping makes it easier to do at scale, so the comparison views may need to
  say how many scans each side excluded.
- **Where the view lives.** A mode of the scans list, or a panel of its own
  beside it. To be settled with a mockup in step 2.

## 11. Rejected alternatives

- **A new exclusion layer next to the results.** The per-scan flag exists,
  is saved, and every aggregate honours it (D3). A second mechanism would have
  to be kept in agreement with it everywhere.
- **Grouping as a partition.** One level of non-overlapping groups cannot hold
  both "all posts" and "accessibility posts" (D7).
- **Patterns typed by the person as regular expressions.** Hard to write and
  to read, and the person does not know the site's URL scheme in advance. The
  proposed patterns can be renamed; editing them by hand may come later if
  the proposals fall short.
- **Grouping by page structure** (a fingerprint of the DOM). It finds templates
  whose URLs say nothing, but needs data the scans do not keep and is far
  harder to explain. URL patterns come first; structure may complement them.
- **Excluding automatically.** A group of near-identical pages can still hold
  one page's real issues; only the person can decide they are noise (D2).
