# Getting started

This takes you from nothing to a scan in the app, a workflow of your own, a
run from the command line, and a comparison between two runs: about fifteen
minutes. It uses the demo shop that comes with the examples, so nothing here
touches a real site.

## 1. Install

You need Node.js 22.13 or later (or 24 or later) and npm. A browser
comes with the install.

```bash
git clone https://github.com/SureA11y/lab.git
cd lab
npm ci
```

## 2. Start the demo shop

In a terminal of its own, leave this running:

```bash
node examples/serve-demo-site.js
```

It serves a small shop on http://localhost:8780/, with accessibility problems
on purpose, and its "release 2", with some of them fixed, on
http://localhost:8781/.

## 3. A first scan in the app

```bash
npm start
```

Open http://127.0.0.1:3000. The **run workflow** tab opens with a workflow of
one step, a scan of the whole page. Type `http://localhost:8780/` as the URL
and press **Run**. When it finishes, the report shows under the workflow:
what failed, against which WCAG criteria, on which elements, and what a
person still has to check.

Every failure shows the element it is about, with its HTML and a
screenshot of it, and, where a person has to look, how to check it by hand.
How far to trust what it finds, and what it cannot find:
[How far to trust it](../README.md#how-far-to-trust-it).

## 4. A workflow of your own

Most problems are not on the first page: they are behind the cookie banner,
in a menu, in the cart. Add steps before and after the scan:

1. In the workflow, add **Click**, with selector `#accept-cookies`, and move
   it above the scan.
2. Add **Click by text**, with text `Products`, then **Wait for selector**,
   `.products`, then another **A11y scan** labelled `Products`.
3. Press **Run**. The report now has two scans, one per state of the shop.

Press **Dry run** instead to take every step without scanning: it says which
steps would fail, quickly, when a site has changed.

**Export config** downloads the workflow as a file (`*.a11y-config.json`),
which **Load config** opens again, in the app or on another machine.

[The lab app](app.md) covers the rest: custom steps, loops, conditions,
batches, the queue, and reading and downloading reports.

## 5. The same from the command line

Workflows run without the app too. The examples have one ready:

```bash
node src/cli/run-workflow.js examples/specs/site-tour.spec.json
```

It prints a summary, and keeps the run in
`a11y-runs/Demo-shop-tour/runs/<time>/`: the report (`payload.json`, which
the app's **Open report** tab opens), `summary.md` and the run's log. A
configuration saved from the app runs the same way.

## 6. Compare two releases

Keep that run as a baseline, then run the tour on release 2 against it:

```bash
node src/cli/run-workflow.js examples/specs/site-tour.spec.json --promote release-1
node src/cli/run-workflow.js examples/specs/site-tour.spec.json \
  --url http://localhost:8781/ --baseline @release-1
```

The second run says what changed, eight failures fixed and one new, and
exits with code 3 because something new fails: what a CI job or a nightly
check acts on. `comparison.html`, beside the report, is the comparison to
read.

In the app, the **compare** tab does the same with reports you load: two side
by side, or up to 24 as a dashboard.

## Next

- [Use cases](use-cases/README.md): pick what you want to do.
- [Examples](../examples/README.md): more workflows to copy.
- [The command-line runner](scheduled-scans-guide.md): baselines, schedules,
  exit codes and batches in full.
