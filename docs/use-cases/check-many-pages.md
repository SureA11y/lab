# Check many pages at once

**For** teams with many pages of the same kind: every product, every article,
every country's version of the home page. **You get** one report per page,
run by the same workflow, kept together, with a summary of all of them.

A **batch** runs one workflow once per row: each row gives the run its name,
the page it starts on, and variables its steps can read as `{var:name}`.

## From a list, in the app

1. Build the workflow for one page: accept the banner, wait for the content,
   scan.
2. Open the **Batch** section and paste the rows:

   ```json
   [
     { "name": "Canvas shoes", "url": "http://localhost:8780/product-shoes.html" },
     { "name": "Weekend bag",  "url": "http://localhost:8780/product-bag.html" }
   ]
   ```

3. **Enable batch**, then **Run**: the runs go to the **queue** tab, a few at a
   time, each kept on the server as it finishes. **Send to Compare** shows
   them side by side; the batch downloads as one zip.

## From a list, on the command line

A batch spec is the workflow and its rows in one file
(`examples/specs/all-pages.batch.json`):

```bash
node src/cli/run-workflow.js examples/specs/all-pages.batch.json
```

Each row runs in turn, in its own folder under
`a11y-runs/<batch>/batches/<time>/`, with `batch.json` beside them listing
every run with its counts. A configuration saved from the app with its batch
on runs the same way.

## From a sitemap

`examples/integrations/sitemap-to-batch.js` turns a sitemap into a batch: the
workflow you give runs on every page it lists, or those matching `--match`.

```bash
node examples/integrations/sitemap-to-batch.js https://www.example.com/sitemap.xml \
  my-page-check.spec.json --match /products/ --limit 100 > products.batch.json
node src/cli/run-workflow.js products.batch.json
```

## Variations

- Use the rows' variables to vary more than the page: a language, a test
  account, the product to search for (`"vars": { "query": "shoes" }`, read as
  `{var:query}`).
- Name runs from their variables with a **run name pattern**
  (`"namePattern": "Product {var:sku}"`).
- Run the batch nightly with `--baseline auto`: each row is compared with its
  own run in the previous batch ([nightly runs](catch-regressions-nightly.md)).
- When the pages are found by following links rather than listed, a single
  workflow can crawl them: the **Crawl queue** and **Iterate** steps
  (`examples/specs/every-product.spec.json`).

## See also

[The runner's guide: running a batch](../scheduled-scans-guide.md#running-a-batch) ·
[The lab app: batches and the queue](../app.md#batches-and-the-queue)
