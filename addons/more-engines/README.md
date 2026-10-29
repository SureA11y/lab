# More engines

surea11y-lab scans with surea11y, built in. This add-on adds more engines that
a scan step can run with instead:

| Engine id | Engine | Checks by | License of the engine |
| --- | --- | --- | --- |
| `axe` | [axe-core](https://github.com/dequelabs/axe-core) | WCAG version and level | MPL-2.0 |
| `alfa` | [Alfa](https://alfa.siteimprove.com) (Siteimprove) | WCAG level | MIT |
| `pa11y` | [Pa11y](https://github.com/pa11y/pa11y), running axe-core | WCAG level | LGPL-3.0-only |
| `pa11y-htmlcs` | Pa11y, running HTML_CodeSniffer | WCAG level | LGPL-3.0-only |
| `qualweb` | [QualWeb](https://github.com/qualweb/qualweb): WCAG techniques and ACT rules | WCAG level | ISC |
| `qualweb-act` | QualWeb: ACT rules | WCAG level | ISC |
| `qualweb-wcag` | QualWeb: WCAG techniques | WCAG level | ISC |
| `qualweb-bp` | QualWeb: best practices | — | ISC |

Install it when you want to compare engines on the same pages, or check with
one your team already uses. Everything else stays as it is: one workflow, one
report, and the same comparisons, with each finding saying which engine found
it.

## Install

From the repository's root:

```bash
npm run addon:install -- more-engines
```

Then restart the lab's server. The scan step's Engine field appears in the
step editor, listing every engine; without the add-on there is nothing to
choose, and the field does not show.

```bash
npm run addon:list                    # the add-ons, and which are installed
npm run addon:remove -- more-engines  # back to surea11y alone
A11Y_ENGINE_ADDONS=off npm start      # leave every add-on out, without removing it
```

In the container image, build with `--build-arg ADDONS=more-engines`
(`docs/container.md`). In the GitHub Action, set `addons: more-engines`
(`docs/ci-action.md`).

## What each engine can check

Each engine checks the profiles it can express: axe-core a WCAG version and
level, and Alfa, Pa11y and QualWeb a WCAG level only, so all of them the
WCAG 2.2 profiles and EN 301 549 V4.1.1. Only surea11y applies a standard in full (EN 301 549's version
details). The step editor offers each scan only the
profiles its engine can check, and `--check` says when a saved one cannot.

A step that names an engine of this add-on, where it is not installed, does
not quietly run with surea11y: the step editor shows the engine as not
installed, and a run stops before it starts, saying which add-on to install.

## Licenses

The add-on's own code (the adapters in `engines/`) is under the lab's license
(`LICENSE` at the repository's root). The engines it installs are under their
own licenses, listed above: installing the add-on is accepting them. Check
them before you redistribute anything built with it.

## Tests

```bash
npm run test:addons   # from the repository's root, with the add-on installed
```

The lab's own tests run without the add-on; the few that compare engines are
skipped then, and say why.
