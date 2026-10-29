# Catch regressions every night

**For** teams that ship often and want to know, the morning after, whether a
change broke accessibility. **You get** a run every night compared with the
one before, a short summary of what changed, and an exit code a scheduler
acts on.

## Steps

1. Have a workflow that covers the journeys that matter: built in the app
   and exported (**Export config**), or written as a spec
   (`examples/specs/site-tour.spec.json`).
2. Run it once by hand, to have a first run to compare with:

   ```bash
   node src/cli/run-workflow.js accessibility/site-tour.spec.json --baseline auto
   ```

   `--baseline auto` compares each run with the previous one of the same
   workflow, kept in `a11y-runs/<name>/runs/`. The first run has nothing to
   compare with, and says so.
3. Schedule it. With cron, every night at 3:

   ```cron
   0 3 * * *  cd /srv/surea11y-lab && node src/cli/run-workflow.js accessibility/site-tour.spec.json --baseline auto --keep 30 >> /var/log/a11y.log 2>&1
   ```

   `--keep 30` keeps the last 30 runs and deletes older ones.
4. Act on the exit code, or read `summary.md` in the run's folder:

   | Exit | Means |
   | --- | --- |
   | 0 | Nothing new |
   | 3 | New failures since the last run |
   | 4 | The run covered less than the workflow asked (a step failed, a page did not load): its comparison cannot be trusted |
   | 1 | The run failed |

   `comparison.html` beside it is the comparison to read; `diff.json` the
   same for software.

## A baseline that does not move

Comparing with last night shows what changed overnight, but a problem that
stays is only new once. To compare every run with a fixed reference, a
release say, keep one as a named baseline:

```bash
node src/cli/run-workflow.js accessibility/site-tour.spec.json --promote release-4.2
node src/cli/run-workflow.js accessibility/site-tour.spec.json --baseline @release-4.2
```

A run that failed or covered less than asked is never promoted.

## Variations

- Run a [batch](check-many-pages.md) nightly: each page is compared with its
  own run in the previous batch.
- Send `summary.md` on: to a chat channel, by mail, or as the body of a
  ticket. The runner writes it and leaves where it goes to you.
- File the new failures as issues and close the fixed ones
  ([track issues](track-issues.md)).
- Run it in a container ([container guide](../container.md)) or in a
  scheduled CI job ([CI guide](../ci-action.md)) instead of on a server of
  your own.

## See also

[The runner's guide](../scheduled-scans-guide.md): exit codes, baselines,
`--keep`, `--fail-on-lean` and every option in full.
