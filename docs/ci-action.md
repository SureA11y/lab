# The lab in GitHub Actions

`action.yml` at the repository's root is a GitHub Action: it installs the lab,
runs a spec, batch spec or saved configuration with the runner, writes its
`summary.md` into the job's summary, and fails the step on the exit codes you
choose. Its work is `ci/github-action.sh`, which runs the same outside GitHub.

```yaml
jobs:
  accessibility:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      # Keep the run store between workflow runs, so each run is compared
      # with the last one.
      - uses: actions/cache@v4
        with:
          path: a11y-store
          key: a11y-store-${{ github.run_id }}
          restore-keys: a11y-store-

      - uses: SureA11y/lab@v1   # a release; or a full tag (@v1.0.0), or a commit
        id: a11y
        env:
          SHOP_PASSWORD: ${{ secrets.SHOP_PASSWORD }}
        with:
          spec: specs/checkout.json
          out: a11y-store/checkout/runs/{stamp}
          baseline: auto
          args: --format sarif
          fail-on: '1 2 3 4'

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: accessibility
          path: ${{ steps.a11y.outputs.out-dir }}
```

| Input | Default | What it is |
| --- | --- | --- |
| `spec` | (required) | The file to run, relative to the workspace. |
| `out` | `a11y-out` | Where the run's files go. `{stamp}` becomes the time: keep runs side by side in a cached folder (`a11y-store/<name>/runs/{stamp}`, or `/batches/{stamp}` for a batch) for `baseline: auto` to find the last one. |
| `store` | | The run store, for `@name` baselines (`--store`). |
| `baseline` | | `auto`, `@name`, or a path to a `payload.json`. |
| `args` | | More options for the runner, e.g. `--format sarif --fail-on-lean`. |
| `fail-on` | `1 2 3 4 130` | The exit codes that fail the step: 1 the run failed, 2 the spec cannot run, 3 new failures (any failure on a first run, with `--fail-on-failures` in `args`), 4 a degraded run, 5 new likely failures (only with `--fail-on-lean`), 130 cancelled. |
| `node-version` | `24` | The Node.js the lab runs on. |

Outputs: `exit-code`, the runner's, and `out-dir`, where its files are.

The browser is the one Puppeteer installs with the lab. Secrets a spec reads
from the environment (`{"$env": "NAME"}`) come from the step's `env`, as above,
so they stay in the repository's secrets. A batch writes one summary per row,
each in the job's summary.
