# Example reports

What the lab makes, from the demo shop in [examples/](../../examples/README.md),
a small shop with accessibility problems on purpose. Its tour
([site-tour.spec.json](../../examples/specs/site-tour.spec.json)) accepts the
cookie banner and scans the home page, the products, the log-in page and the
cart. It ran on release 1, and then on release 2, which fixes some problems
and adds one, as in [Getting started](../getting-started.md).

| File | What it is |
| --- | --- |
| [release-1.html](release-1.html) | The tour of release 1: each page's failures and the questions to check by hand, with screenshots and pictures of the flagged elements |
| [release-2.html](release-2.html) | The same tour of release 2 |
| [comparison.html](comparison.html) | Release 2 against release 1: what it fixed, what it broke, what is still failing |

Each is one file that opens in any browser, offline, with its pictures inside:
the reports as the app's **Download as a single file** makes them, the
comparison as the command-line runner writes it. Download one and open it. The
addresses in them are the demo shop's, which runs on your computer
(`node examples/serve-demo-site.js`).

These files, and the screenshots in the documentation, are made by
`npm run build:showcase` ([src/scripts/showcase.js](../../src/scripts/showcase.js)),
which runs the tour and opens its results in the app. Run it again after a
change to what they show.
