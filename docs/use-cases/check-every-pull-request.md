# Check every pull request

**For** teams that review changes before they merge. **You get** a check on
each pull request that runs your workflows against the change, writes what
changed into the checks page, and fails when the change brings new failures.

## Steps

1. Keep the workflows in the site's repository, like other tests
   (`accessibility/site-tour.spec.json`). `--check` validates them without a
   browser; worth running in the same job.
2. Copy `examples/ci/accessibility.yml` to `.github/workflows/` and change
   three things in it: how the site starts in the job (its build and start
   command, or a preview URL), the spec, and the version of the lab.
3. Open a pull request. The job:
   - starts the site and runs the spec on it;
   - compares the run with the last run on `main`, kept between jobs in a
     cache;
   - writes `summary.md` into the job's summary page;
   - uploads the run's files, `comparison.html` among them;
   - fails when there are new failures (exit 3) or the run covered less than
     asked (exit 4), as `fail-on` says.

## Choosing what fails the check

| `fail-on` | The check fails when |
| --- | --- |
| `1 2 3 4` (the example's) | The run fails, the spec is wrong, something new fails, or the run covered less than asked |
| `1 2 4` | The same, but new failures only warn: for a first period, while the backlog is being worked through |
| `1 2 3 4 5` | Also when surea11y's checks that lean towards failing are new (with `--fail-on-lean` in `args`) |
| `1 2 3 4`, with `--fail-on-failures` in `args` | Also on a first run, with no baseline yet, when anything fails |

## Variations

- Upload the SARIF export to GitHub code scanning, so failures show as
  annotations: `args: --format sarif`, then the `upload-sarif` action on the
  run's `exports/` folder.
- Check a deployed preview instead of starting the site in the job: point the
  spec at it with `args: --url https://preview-123.example.com/`.
- Run a [batch](check-many-pages.md) when one workflow is not enough.
- Not on GitHub? `ci/github-action.sh` is the action's whole job, and runs in
  any CI: set its `LAB_*` variables and call it.

## See also

[The GitHub Action](../ci-action.md) ·
[Catch regressions every night](catch-regressions-nightly.md)
