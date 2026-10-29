# Use cases

Some of the things the lab is good for, each written up step by step with
files you can run. They are a starting point, not the list.

The lab is made of pieces that each do one thing and work with the others:
workflows that drive a browser through a site, scans that check what it
shows against a standard, reports and comparisons in published formats, and
ways to run all of it (the app, the command line, an HTTP API, a container,
CI). The guides below combine them in ways we found useful; yours may combine
them differently. If you build something the guides do not cover, we would
like to hear about it.

## Checking a site

| Guide | When |
| --- | --- |
| [Audit a user journey](audit-a-journey.md) | You need to know how accessible a flow is (sign-up, checkout, a booking), not just a page |
| [Check many pages at once](check-many-pages.md) | Every product page, every page of a sitemap, every country's version |
| [Check behind a login](check-behind-a-login.md) | What matters is behind an account, and the password must stay out of files |
| [Check against a standard](check-against-a-standard.md) | You answer to EN 301 549, not only WCAG |

## Over time

| Guide | When |
| --- | --- |
| [Catch regressions every night](catch-regressions-nightly.md) | You want to know the morning after a change broke something |
| [Check every pull request](check-every-pull-request.md) | A change should not merge if it brings new failures |
| [Compare releases and environments](compare-releases-and-environments.md) | Staging against live, before and after a redesign, two variants of a page |

## With other tools

| Guide | When |
| --- | --- |
| [Track issues in your tracker](track-issues.md) | Each failure should be a ticket, opened once and closed when fixed |
| [Feed a dashboard](feed-a-dashboard.md) | You report accessibility over time, across products or teams |
| [Generate workflows](generate-workflows.md) | Workflows should come from somewhere else: a script, a test suite, an AI assistant |
| [Run the lab as a service](run-it-as-a-service.md) | Other tools, or other teams, should start runs and take reports without the app |
| [Share results](share-results.md) | A report or a comparison has to reach people who do not run the lab |

## Ideas the guides do not cover

A few more, to show how far the pieces stretch:

- Check every story of a component library, one workflow per component state,
  to catch problems before they reach a page.
- Check a page in dark mode, at 400% zoom, with a vision deficiency emulated
  and on a phone-sized screen, as scans of one workflow.
- Turn an end-to-end test suite's journeys into workflows, so the paths that
  are tested for function are tested for accessibility too.
- Draft an accessibility statement from a report and the answers a person
  gives to what the scans could not decide.
- Write a summary per audience from the same report: a status line for
  management, a fix list by component for developers.
