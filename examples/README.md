# Examples

Everything here runs as it is, against a small demo shop that comes with it,
so you can try each piece of surea11y-lab before pointing it at your own site.
The use-case guides (`docs/use-cases/`) build on these files.

| Folder | What is in it |
| --- | --- |
| `demo-site/` | A made-up shop with accessibility problems on purpose, and `release-2/`, the same shop with some fixed and one new |
| `specs/` | Workflows: run specs and a batch spec |
| `configs/` | A configuration as the app saves it |
| `integrations/` | Small scripts around the lab's formats: issues to file and close, a CSV, a batch from a sitemap, a run over HTTP |
| `ci/` | A GitHub Actions workflow that checks every pull request |
| `container/` | The app and the runner with Docker Compose |

## Before you start

From the repository's root, once:

```bash
npm ci
npm run build:report      # the report's styles and script, for comparison.html
```

Then start the demo shop, and leave it running:

```bash
node examples/serve-demo-site.js
# Demo shop: release 1 on http://localhost:8780/, release 2 on http://localhost:8781/
```

Release 2 is on its own port at the same paths, as a staging copy of a site
would be, so comparisons match each page and element with its counterpart.

## The workflows

Each runs with `node src/cli/run-workflow.js <file>`, and opens in the app
with **Load config**. `--check` checks one without opening a browser.

| File | What it shows |
| --- | --- |
| `specs/home.spec.json` | The smallest workflow: accept the cookie banner, scan the page |
| `specs/shopping-flow.spec.json` | A flow through the shop, scanning each state on the way: a list, a product, the product added to the cart, the cart. Scans limited to `main` with `context`; a screenshot |
| `specs/login.spec.json` | Logging in with the password read from the environment (`{"$env": "DEMO_SHOP_PASSWORD"}`), so the file holds none |
| `specs/standards.spec.json` | One page against WCAG 2.2 AA, EN 301 549 (V4.1.1 and V3.2.1) and WCAG 2.2 AAA, a scan each |
| `specs/every-product.spec.json` | A loop over every product link, and a custom step (accept the cookie banner when it shows) used twice |
| `specs/site-tour.spec.json` | Home, products, log in and cart by following the shop's own links: the same workflow on either release |
| `specs/all-pages.batch.json` | One workflow over six pages, a row each, as the app's Batch section runs them |
| `configs/shopping-flow.a11y-config.json` | `shopping-flow` as the app's **Export config** writes it |

```bash
node src/cli/run-workflow.js examples/specs/home.spec.json
DEMO_SHOP_PASSWORD=anything node src/cli/run-workflow.js examples/specs/login.spec.json
node src/cli/run-workflow.js examples/specs/all-pages.batch.json
```

Each run lands in `a11y-runs/<name>/runs/<time>/`: `payload.json` (the
report; load it in the app's **Open report** tab), `summary.md` and
`run.log.jsonl`. A batch lands in `a11y-runs/<name>/batches/<time>/`, a folder
per row beside `batch.json`.

## Comparing two releases

Run the tour on release 1 and keep it as a baseline, then run it on release 2
against it:

```bash
node src/cli/run-workflow.js examples/specs/site-tour.spec.json --promote release-1
node src/cli/run-workflow.js examples/specs/site-tour.spec.json \
  --url http://localhost:8781/ --baseline @release-1
```

The second run says what changed:

```
Rules       0 new, 4 resolved, 2 persistent
Instances   1 new, 8 fixed, 1 still failing
Comparison  a11y-runs/Demo-shop-tour/runs/<time>/comparison.html
```

and exits 3, because release 2 brought a failure release 1 did not have (the
cart's unnamed button). `comparison.html` is the comparison to read; it is the
page the app's Compare tab downloads. `diff.json` has the same for software.

## Reading what the lab writes

`integrations/` holds small scripts that use only the published formats
(`schemas/`), not the lab's code: the starting point for your own.

```bash
# The new failures as issues to file, each with the id it keeps while it fails
node examples/integrations/new-issues.js a11y-runs/Demo-shop-tour/runs/<time>
node examples/integrations/new-issues.js a11y-runs/Demo-shop-tour/runs/<time> --json

# Every failure of a report as CSV, a row per element
node examples/integrations/findings-to-csv.js a11y-runs/Demo-shop-tour/runs/<time>/payload.json > failures.csv

# ... and the ones it no longer has: the issues to close
node examples/integrations/new-issues.js a11y-runs/Demo-shop-tour/runs/<time> --fixed

# A batch over every page a sitemap lists (or those matching --match)
node examples/integrations/sitemap-to-batch.js http://localhost:8780/sitemap.xml \
  examples/specs/home.spec.json > pages.batch.json

# A run on a lab server over its HTTP API (npm start first)
node examples/integrations/run-over-http.js examples/specs/home.spec.json report.json --server http://127.0.0.1:3000
```

## In CI and in a container

- `ci/accessibility.yml` is a GitHub Actions workflow to copy into the site's
  repository: it runs a spec on every pull request, compares it with the last
  run on `main`, writes the summary into the checks, and fails on new failures.
  `docs/ci-action.md` explains its inputs.
- `container/compose.yml` runs the app and its HTTP API in a container, and
  the runner on demand. `docs/container.md` explains the image.

```bash
docker compose -f examples/container/compose.yml up -d lab        # http://127.0.0.1:3000
docker compose -f examples/container/compose.yml run --rm runner \
  examples/specs/home.spec.json --url http://host.docker.internal:8780/
```

## What the demo shop gets wrong

On purpose, so the scans have something to find:

| Where | Problem | Release 2 |
| --- | --- | --- |
| Home | Hero image with no alternative text | Fixed (marked decorative) |
| Home | Promotion text too faint (low contrast) | Fixed |
| Products | A product link whose only content is an image with no alternative text | Fixed |
| Product pages | Product image with no alternative text | — |
| Product pages | An icon-only "add to cart" button with no name | Fixed |
| Log in | A password field with no label | Fixed |
| Cart | A faint "Continue to checkout" link | — |
| Cart | A promotion code field labelled only by its placeholder: the scan asks a person to confirm it | — |
| Cart | — | New: an icon-only "save for later" button with no name |

A scan also hands some checks to a person on every page (keyboard use, focus
order and visibility, whether the title describes the page): the report lists
them under what needs review, apart from the failures.

The examples are a few of the ways to use the lab, not the list: the use-case
guides (`docs/use-cases/`) show more, and the pieces combine in ways neither
covers.

## Tests

`examples/examples.test.js`, part of `npm test`, keeps the examples working:
every spec passes `--check` and fits its schema, the scripts read what the lab
writes, and the demo shop serves both releases.
