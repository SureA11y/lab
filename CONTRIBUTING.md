# Contributing

Thank you for helping. This explains how to set up, how the code is
organised, and what a change needs before it is merged.

## Proposing a change

- **A bug or an idea:** open an issue; the forms ask for what helps.
- **A wrong finding, or a problem missed:** that is surea11y's, the engine
  the lab runs: report it to [SureA11y/core](https://github.com/SureA11y/core/issues).
- **A security problem:** report it privately ([SECURITY.md](SECURITY.md)).
- **A change of some size:** open an issue first, to agree on the approach
  before the work.

A pull request says what it changes and why, comes with its tests, and keeps
the whole suite passing; the template lists what to check. Contributions are
accepted under the lab's license, the GNU AGPL-3.0 ([LICENSE](LICENSE)).

## Setting up

Node.js 22.13 or later (or 24 or later), and npm.

```bash
npm ci
npm run dev        # builds the assets, then starts the server, restarting it on changes
```

`npm run dev` restarts the server whenever a server file changes, which
interrupts a batch in the queue; `npm start` does not restart. The watcher
polls modification times (`legacyWatch` in `nodemon.json`): on Windows, the
default watcher also reports files that were only read.

The demo shop (`node examples/serve-demo-site.js`) is a site to try changes
on; [the examples](examples/README.md) run against it.

## Tests

```bash
npm test             # every unit and DOM test (jsdom), without a browser
npm run test:dom     # the tests that drive a real browser
```

A change comes with tests for what it changes, and the whole suite passes.
For a change to the app, check it in a browser too: the tests do not see
layout, focus or what a screen reader announces.

## How the code is organised

| Folder | What lives there | Loads as |
| --- | --- | --- |
| `src/workflow/` | The workflow engine, and `action-definitions.js`, the one definition of every step | Node |
| `src/server-side/` | Running scans in a browser, the engine facade and surea11y's adapter, metrics, the queue | Node |
| `src/cli/` | The command-line runner | Node |
| `src/shared/` | Code the server, the app, the runner and the extension all use: reports, diffs, run specs, schemas | Node and browser (UMD) |
| `src/js/` | The app | Browser (ES modules) |
| `src/report/` | The downloadable report and comparison | Browser |
| `extension/` | The browser extension; its copies of shared modules come from `npm run build:extension-shared` | Browser |

`src/shared/tier-boundaries.test.js` keeps the tiers apart: browser code does
not reach into the server, and the server does not reach into the app.

Some files are generated, and their tests fail when they are out of date:

| Run | When you change | It writes |
| --- | --- | --- |
| `npm run build:action-docs` | A step's definition, or a schema's source | `docs/step-definitions.html`, `docs/configuration_contract.json`, `schemas/*.json` |
| `npm run build:extension-shared` | A shared module the extension uses | `extension/*.js` copies |
| `npm run build:report` | The report's styles or script | `src/report/*.min.*` (not committed) |

## Writing

Code comments, documentation and messages say what something does and why,
in plain words. The app's messages say what happened and what to do about it.
User-facing text follows the same accessibility the lab checks for: labels
for every control, text alternatives, no meaning carried by colour alone.

## Design notes

A feature of some size starts with a note in `docs/design/`: the problem, the
options, what was chosen and why, and what was left out on purpose. They stay
as the record of how it came to be.

## The engine

The lab runs one engine: surea11y, [`@surea11y/core`](https://github.com/SureA11y/core).
What a scan finds, and how, is core's: a change there belongs in core, not
in the lab. The lab's side of it is its adapter,
`src/server-side/engines/a11y-labs-engine.js`.
